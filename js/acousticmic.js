// 網頁端的錄音 → 16 kHz 單聲道 PCM，餵給 js/acoustic.js 的比對管線。
//
// 對應 App 端的 AudioCaptureManager（那支用 AudioRecord 直接拿 PCM16）。
// 瀏覽器這邊用 getUserMedia + OfflineAudioContext 重採樣到 16 kHz——
// **取樣率一定要一致**：MFCC 的每一個參數（幀長 25ms、mel 濾波器邊界、
// 高頻上限 8 kHz）都是以 16 kHz 算出來的，用 48 kHz 進去算出來的特徵
// 跟手機那批完全對不起來，而樣板是跨裝置同步的。
//
// 麥克風處理一律關掉（echoCancellation / noiseSuppression / autoGainControl）：
// 那些是為了「講電話讓對方聽得清楚」設計的，會動態改變頻譜與音量，
// 而這裡要比的正是頻譜的細節。自動增益尤其糟——它會把每次錄音的音量拉到一樣，
// 但登錄時的門檻是從「使用者實際的發音變異」算出來的，被它抹平之後就失準。

import { SAMPLE_RATE_HZ, extractMfcc, calibrateThreshold, enrollmentSpread } from "./acoustic.js?v=1.5.35";

/** 一次錄音最長幾秒。比這長多半是忘了放開，白算一大堆幀。 */
const MAX_SECONDS = 8;

/** 低於這個峰值視為沒出聲。跟 App 端 SpeechNoiseGuard 一樣訂得很低——
 *  把「真的講話」誤判成「沒講話」，等於告訴一個正在努力的人「你沒出聲」，
 *  那比偶爾放一段噪音進去嚴重得多。 */
export const MIN_PEAK = 600 / 32767;

let _stream = null, _rec = null, _chunks = [], _mime = "";

export function isSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

export function isRecording() { return !!_rec && _rec.state === "recording"; }

/** 開始錄音。呼叫端負責先確認 isSupported()。 */
export async function startCapture() {
  if (isRecording()) return;
  _stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  _chunks = [];
  _mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  _rec = _mime ? new MediaRecorder(_stream, { mimeType: _mime }) : new MediaRecorder(_stream);
  _rec.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
  _rec.start();
  // 忘了停就自己停，不要無限錄下去
  setTimeout(() => { if (isRecording()) stopCapture().catch(() => {}); }, MAX_SECONDS * 1000);
}

/**
 * 停止並取回 16 kHz 單聲道 PCM。
 * @returns {Promise<{samples: Float32Array, peak: number, durationMs: number}>}
 */
export async function stopCapture() {
  if (!_rec) throw new Error("not recording");
  const rec = _rec;
  const done = new Promise((res) => { rec.onstop = res; });
  if (rec.state !== "inactive") rec.stop();
  await done;
  _rec = null;
  try { _stream.getTracks().forEach((t) => t.stop()); } catch { /* 已經停了 */ }
  _stream = null;

  const blob = new Blob(_chunks, { type: _mime || "audio/webm" });
  _chunks = [];
  return decodeTo16k(await blob.arrayBuffer());
}

/** 中途取消：關麥克風、丟掉錄到的東西。 */
export function cancelCapture() {
  try { if (_rec && _rec.state !== "inactive") _rec.stop(); } catch { /* 已經停了 */ }
  _rec = null; _chunks = [];
  try { _stream?.getTracks().forEach((t) => t.stop()); } catch { /* 同上 */ }
  _stream = null;
}

/** 壓縮音檔 → 16 kHz 單聲道 Float32。 */
async function decodeTo16k(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const tmp = new Ctx();
  let decoded;
  try { decoded = await tmp.decodeAudioData(arrayBuffer); }
  finally { tmp.close().catch(() => {}); }

  // 先混成單聲道，再用 OfflineAudioContext 重採樣。
  // 直接丟多聲道進去重採樣的話，左右相位差會在混音時互相抵消掉一部分頻譜。
  const mono = toMono(decoded);
  const frames = Math.max(1, Math.round(mono.length * SAMPLE_RATE_HZ / decoded.sampleRate));
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE_HZ);
  const src = off.createBufferSource();
  const buf = off.createBuffer(1, mono.length, decoded.sampleRate);
  buf.copyToChannel(mono, 0);
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const samples = out.getChannelData(0).slice();
  let peak = 0;
  for (const s of samples) { const a = Math.abs(s); if (a > peak) peak = a; }
  return { samples, peak, durationMs: Math.round(samples.length * 1000 / SAMPLE_RATE_HZ) };
}

function toMono(audioBuffer) {
  const n = audioBuffer.length;
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0).slice();
  const out = new Float32Array(n);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += ch[i];
  }
  for (let i = 0; i < n; i++) out[i] /= audioBuffer.numberOfChannels;
  return out;
}

// ── 登錄 ────────────────────────────────────────────────────────

/** 至少要錄幾次才估得出離散度（同 App 的 MIN_ENROLLMENT_TAKES）。 */
export const MIN_TAKES = 3;

/**
 * 把幾次錄音變成一個樣板。
 * @param {Array<{samples:Float32Array}>} takes
 * @returns {{exemplars: Float32Array[][], threshold: number, spread: number}}
 * @throws 錄音太不一致而估不出門檻時（呼叫端要請使用者重錄）
 */
export function buildTemplate(takes) {
  const seqs = takes.map((t) => extractMfcc(t.samples).frames).filter((f) => f.length > 0);
  if (seqs.length < MIN_TAKES) {
    throw new Error(`only ${seqs.length} of ${takes.length} takes contained speech`);
  }
  const threshold = calibrateThreshold(seqs);
  // 門檻校準不出來就不要建樣板——硬給一個常數等於讓這個樣板的行為完全無法預測
  if (threshold == null) throw new Error("recordings too inconsistent to calibrate a threshold");
  return { exemplars: seqs, threshold, spread: enrollmentSpread(seqs) ?? 0 };
}
