// 聲波比對（專屬發音）——App 端 com.example.aphasia.data.acoustic 的 JS 移植。
//
// 為什麼可以移植：那一整條管線是純數學、零相依（自己寫的 FFT + MFCC + DTW，
// 只用到 kotlin.math），唯一綁 Android 的是錄音那一段。瀏覽器用
// getUserMedia + AudioContext 拿到的就是同樣的單聲道 PCM。
//
// **精度：Kotlin 用的是 Float（32 位元），JS 的 Number 是 64 位元。**
// 所以這裡全程用 Float32Array 存陣列、用 Math.fround() 收斂中間的純量，
// 讓兩邊的捨入行為一致——不這樣做的話，同一段音在兩邊算出來的 MFCC 會有
// 微小差異，而樣板是跨裝置同步的：手機錄的樣板要能在網頁上比對得起來。
// 對照測試見 tools/parity（同一段合成訊號在兩邊的 MFCC 與 DTW 距離）。
//
// **這條路徑預設關閉。** 見設定裡的「網頁端聲波比對（實驗）」開關——
// 登錄與比對用不同麥克風時，由登錄錄音校準出來的門檻不一定還對得上，
// 所以要不要開由使用者決定，而且建議在網頁上重新登錄一組樣板。

const fr = Math.fround;

// ── FFT：原地 radix-2 Cooley–Tukey ──────────────────────────────

const _twiddle = new Map();
function twiddles(n) {
  let t = _twiddle.get(n);
  if (!t) {
    const half = n / 2;
    const c = new Float32Array(half), s = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      const angle = -2 * Math.PI * k / n;
      c[k] = fr(Math.cos(angle));
      s[k] = fr(Math.sin(angle));
    }
    t = [c, s];
    _twiddle.set(n, t);
  }
  return t;
}

export function nextPowerOfTwo(x) { let n = 1; while (n < x) n <<= 1; return n; }

export function fft(real, imag) {
  const n = real.length;
  if (n === 1) return;
  // 位元反轉重排
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j |= bit;
    if (i < j) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }
  const [cosT, sinT] = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len, half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let k = 0;
      for (let t = 0; t < half; t++) {
        const wr = cosT[k], wi = sinT[k];
        const ur = real[i + t], ui = imag[i + t];
        const vr = fr(fr(real[i + t + half] * wr) - fr(imag[i + t + half] * wi));
        const vi = fr(fr(real[i + t + half] * wi) + fr(imag[i + t + half] * wr));
        real[i + t] = fr(ur + vr);
        imag[i + t] = fr(ui + vi);
        real[i + t + half] = fr(ur - vr);
        imag[i + t + half] = fr(ui - vi);
        k += step;
      }
    }
  }
}

// ── MFCC ────────────────────────────────────────────────────────

export const SAMPLE_RATE_HZ = 16000;

/** 與 App 端 MfccExtractor.Config 逐項對齊。改任何一項都會讓兩邊的樣板對不起來。 */
export const MFCC_CONFIG = {
  sampleRateHz: SAMPLE_RATE_HZ,
  frameLengthMs: 25,
  frameShiftMs: 10,
  melFilterCount: 26,
  cepstralCount: 13,
  lowFreqHz: 20,
  highFreqHz: 8000,
  preEmphasis: 0.97,
  includeC0: false,             // c0 只反映響度，留著等於把音量差當成發音差
  cepstralMeanNormalization: false,  // 開了會讓關鍵字比對失效，見 App 端註解
  includeDelta: true,
  silenceTrimRatio: 0.02,
};

const cfg = MFCC_CONFIG;
const FRAME_LEN = (cfg.sampleRateHz * cfg.frameLengthMs / 1000) | 0;
const FRAME_SHIFT = (cfg.sampleRateHz * cfg.frameShiftMs / 1000) | 0;
const FFT_SIZE = nextPowerOfTwo(FRAME_LEN);
export const FEATURE_DIM =
  (cfg.includeC0 ? cfg.cepstralCount : cfg.cepstralCount - 1) * (cfg.includeDelta ? 2 : 1);

const hzToMel = (hz) => fr(2595 * Math.log10(1 + hz / 700));
const melToHz = (mel) => fr(700 * (Math.pow(10, mel / 2595) - 1));

const hamming = new Float32Array(FRAME_LEN);
for (let i = 0; i < FRAME_LEN; i++) {
  hamming[i] = fr(0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME_LEN - 1)));
}

const melFilters = (() => {
  const bins = FFT_SIZE / 2 + 1;
  const melLow = hzToMel(cfg.lowFreqHz);
  const melHigh = hzToMel(Math.min(cfg.highFreqHz, cfg.sampleRateHz / 2));
  const points = new Float32Array(cfg.melFilterCount + 2);
  for (let i = 0; i < points.length; i++) {
    points[i] = melToHz(fr(melLow + (melHigh - melLow) * i / (cfg.melFilterCount + 1)));
  }
  const binOf = new Int32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const v = ((points[i] / (cfg.sampleRateHz / 2)) * (bins - 1)) | 0;
    binOf[i] = Math.min(Math.max(v, 0), bins - 1);
  }
  const out = [];
  for (let m = 0; m < cfg.melFilterCount; m++) {
    const filter = new Float32Array(bins);
    const left = binOf[m], center = binOf[m + 1], right = binOf[m + 2];
    for (let i = left; i < center; i++) if (center > left) filter[i] = fr((i - left) / (center - left));
    for (let i = center; i < right; i++) if (right > center) filter[i] = fr((right - i) / (right - center));
    if (center >= 0 && center < filter.length) filter[center] = 1;
    out.push(filter);
  }
  return out;
})();

const dctMatrix = (() => {
  const out = [];
  for (let k = 0; k < cfg.cepstralCount; k++) {
    const row = new Float32Array(cfg.melFilterCount);
    for (let m = 0; m < cfg.melFilterCount; m++) {
      row[m] = fr(Math.cos(Math.PI * k * (m + 0.5) / cfg.melFilterCount) *
                  Math.sqrt(2 / cfg.melFilterCount));
    }
    out.push(row);
  }
  return out;
})();

/**
 * 一段語音 → 特徵序列。
 * @param {Float32Array} samples 單聲道 PCM，已正規化到 [-1,1]，16 kHz
 * @returns {{frames: Float32Array[], dim: number}}
 */
export function extractMfcc(samples) {
  const emphasized = preEmphasize(samples);
  const { frames, energies } = frameAndTransform(emphasized);
  const trimmed = trimSilence(frames, energies);
  if (!trimmed.length) return { frames: [], dim: FEATURE_DIM };
  const out = cfg.includeDelta ? withDelta(trimmed) : trimmed;
  return { frames: out, dim: FEATURE_DIM };
}

function preEmphasize(x) {
  if (!x.length) return x;
  const y = new Float32Array(x.length);
  y[0] = x[0];
  for (let i = 1; i < x.length; i++) y[i] = fr(x[i] - fr(cfg.preEmphasis * x[i - 1]));
  return y;
}

function frameAndTransform(signal) {
  if (signal.length < FRAME_LEN) return { frames: [], energies: new Float32Array(0) };
  const frameCount = ((signal.length - FRAME_LEN) / FRAME_SHIFT | 0) + 1;
  const frames = [];
  const energies = new Float32Array(frameCount);
  const real = new Float32Array(FFT_SIZE), imag = new Float32Array(FFT_SIZE);
  const power = new Float32Array(FFT_SIZE / 2 + 1);
  const melEnergies = new Float32Array(cfg.melFilterCount);

  for (let f = 0; f < frameCount; f++) {
    const offset = f * FRAME_SHIFT;
    let energy = 0;
    real.fill(0); imag.fill(0);
    for (let i = 0; i < FRAME_LEN; i++) {
      const s = signal[offset + i];
      energy = fr(energy + fr(s * s));
      real[i] = fr(s * hamming[i]);
    }
    energies[f] = fr(energy / FRAME_LEN);

    fft(real, imag);
    for (let i = 0; i < power.length; i++) {
      power[i] = fr(fr(real[i] * real[i]) + fr(imag[i] * imag[i]));
    }
    for (let m = 0; m < cfg.melFilterCount; m++) {
      let sum = 0;
      const filter = melFilters[m];
      for (let i = 0; i < filter.length; i++) sum = fr(sum + fr(power[i] * filter[i]));
      melEnergies[m] = fr(Math.log(Math.max(sum, 1e-10)));
    }
    const cep = new Float32Array(cfg.cepstralCount);
    for (let k = 0; k < cfg.cepstralCount; k++) {
      let sum = 0;
      const row = dctMatrix[k];
      for (let m = 0; m < cfg.melFilterCount; m++) sum = fr(sum + fr(melEnergies[m] * row[m]));
      cep[k] = sum;
    }
    frames.push(cfg.includeC0 ? cep : cep.slice(1));
  }
  return { frames, energies };
}

function trimSilence(frames, energies) {
  if (!frames.length || !energies.length) return frames;
  let peak = 0;
  for (const e of energies) if (e > peak) peak = e;
  if (peak <= 0) return frames;
  const threshold = fr(peak * cfg.silenceTrimRatio);
  let start = 0;
  while (start < frames.length && energies[start] < threshold) start++;
  let end = frames.length - 1;
  while (end > start && energies[end] < threshold) end--;
  if (start >= end) return frames;
  // 前後各留 2 幀：塞音的起音本來就低能量，切掉會變成另一個音
  const s = Math.max(0, start - 2);
  const e = Math.min(frames.length - 1, end + 2);
  return frames.slice(s, e + 1);
}

function withDelta(frames) {
  const n = frames.length, dim = frames[0].length;
  const denom = 2 * (1 + 4);
  const out = [];
  for (let t = 0; t < n; t++) {
    const row = new Float32Array(dim * 2);
    row.set(frames[t], 0);
    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let k = 1; k <= 2; k++) {
        const ahead = frames[Math.min(n - 1, t + k)][d];
        const behind = frames[Math.max(0, t - k)][d];
        sum = fr(sum + fr(k * fr(ahead - behind)));
      }
      row[dim + d] = fr(sum / denom);
    }
    out.push(row);
  }
  return out;
}

// ── DTW ─────────────────────────────────────────────────────────

export const BAND_RATIO = 0.10;
export const MIN_BAND_RADIUS = 5;
export const MAX_LENGTH_RATIO = 2.5;
export const MIN_KEYWORD_LENGTH_RATIO = 0.6;
export const MAX_KEYWORD_LENGTH_RATIO = 1.8;
export const KEYWORD_THRESHOLD_FACTOR = 0.85;
export const FULL_FREEDOM_RATIO = 2.0;
const MIN_RELATIVE_SPREAD = 0.25;
const MIN_ABSOLUTE_THRESHOLD = 0.05;

export const FLOAT_MAX = 3.4028234663852886e38;   // Kotlin Float.MAX_VALUE
const INF = FLOAT_MAX / 4;

/**
 * 兩幀之間的距離。**維度不同回 FLOAT_MAX，不是只比共同前綴。**
 * 只比前綴會算出距離 0（＝完全一樣），那個樣板就會命中所有聲音。
 */
function euclidean(a, b) {
  if (a.length !== b.length) return FLOAT_MAX;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = fr(a[i] - b[i]);
    sum = fr(sum + fr(d * d));
  }
  return fr(Math.sqrt(sum));
}

/** 正規化後的 DTW 距離（累積成本 / 路徑長度）。越小越像。 */
export function dtwDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return FLOAT_MAX;
  const ratio = Math.max(n, m) / Math.min(n, m);
  if (ratio > MAX_LENGTH_RATIO) return FLOAT_MAX;

  const radius = Math.max(MIN_BAND_RADIUS, Math.round(BAND_RATIO * Math.max(n, m)));
  let prevCost = new Float32Array(m + 1).fill(INF);
  let prevSteps = new Int32Array(m + 1);
  let curCost = new Float32Array(m + 1);
  let curSteps = new Int32Array(m + 1);
  prevCost[0] = 0;

  for (let i = 1; i <= n; i++) {
    curCost.fill(INF); curSteps.fill(0);
    const center = Math.floor(i * m / n);
    const lo = Math.max(1, center - radius);
    const hi = Math.min(m, center + radius);
    if (lo > hi) continue;
    const frameA = a[i - 1];
    for (let j = lo; j <= hi; j++) {
      const d = euclidean(frameA, b[j - 1]);
      let bestCost = prevCost[j - 1], bestSteps = prevSteps[j - 1];
      if (prevCost[j] < bestCost) { bestCost = prevCost[j]; bestSteps = prevSteps[j]; }
      if (curCost[j - 1] < bestCost) { bestCost = curCost[j - 1]; bestSteps = curSteps[j - 1]; }
      if (bestCost >= INF) continue;
      curCost[j] = fr(bestCost + d);
      curSteps[j] = bestSteps + 1;
    }
    let t = prevCost; prevCost = curCost; curCost = t;
    let t2 = prevSteps; prevSteps = curSteps; curSteps = t2;
  }
  const total = prevCost[m], steps = prevSteps[m];
  if (total >= INF || steps === 0) return FLOAT_MAX;
  return fr(total / steps);
}

/**
 * 子序列 DTW：**樣板必須走完，語音的起點與終點自由**。
 * 這是「關鍵字觸發」與「整段比對」的唯一差別。
 * 回 null＝找不到長度合理的命中。
 */
export function subsequenceDistance(template, stream,
                                    minLengthRatio = MIN_KEYWORD_LENGTH_RATIO,
                                    maxLengthRatio = MAX_KEYWORD_LENGTH_RATIO) {
  const n = template.length, m = stream.length;
  if (!n || !m) return null;
  if (m < n * minLengthRatio) return null;

  let prevCost = new Float32Array(m + 1);       // 第 0 列全 0 ＝ 起點自由
  let prevSteps = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prevStart[j] = j;
  let curCost = new Float32Array(m + 1);
  let curSteps = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    curCost[0] = INF; curSteps[0] = 0; curStart[0] = 0;
    const frameT = template[i - 1];
    for (let j = 1; j <= m; j++) {
      const d = euclidean(frameT, stream[j - 1]);
      let bestCost = prevCost[j - 1], bestSteps = prevSteps[j - 1], bestStart = prevStart[j - 1];
      if (prevCost[j] < bestCost) { bestCost = prevCost[j]; bestSteps = prevSteps[j]; bestStart = prevStart[j]; }
      if (curCost[j - 1] < bestCost) { bestCost = curCost[j - 1]; bestSteps = curSteps[j - 1]; bestStart = curStart[j - 1]; }
      if (bestCost >= INF) { curCost[j] = INF; curSteps[j] = 0; curStart[j] = 0; }
      else { curCost[j] = fr(bestCost + d); curSteps[j] = bestSteps + 1; curStart[j] = bestStart; }
    }
    let t = prevCost; prevCost = curCost; curCost = t;
    let t2 = prevSteps; prevSteps = curSteps; curSteps = t2;
    let t3 = prevStart; prevStart = curStart; curStart = t3;
  }

  let best = null;
  for (let j = 1; j <= m; j++) {
    if (prevCost[j] >= INF || prevSteps[j] === 0) continue;
    const start = prevStart[j];
    const matched = j - start;
    // 長度合理性：少了這道檢查，兩秒的語音幾乎必定生得出一個看起來很像的短窗口
    if (matched < n * minLengthRatio || matched > n * maxLengthRatio) continue;
    const normalized = fr(prevCost[j] / prevSteps[j]);
    if (!best || normalized < best.distance) best = { distance: normalized, startFrame: start, endFrame: j };
  }
  return best;
}

export function distanceToBest(query, exemplars) {
  let best = FLOAT_MAX;
  for (const e of exemplars) { const d = dtwDistance(query, e); if (d < best) best = d; }
  return best;
}

export function subsequenceToBest(stream, exemplars) {
  let best = null;
  for (const e of exemplars) {
    const hit = subsequenceDistance(e, stream);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/** 查詢遠長於樣板時要收緊門檻——子序列比對可以挑窗口，距離天生偏低。 */
export function keywordThresholdFactor(queryFrames, templateFrames) {
  if (templateFrames <= 0) return KEYWORD_THRESHOLD_FACTOR;
  const freedom = (queryFrames - templateFrames) / templateFrames;
  const t = Math.min(Math.max(freedom / FULL_FREEDOM_RATIO, 0), 1);
  return 1 - (1 - KEYWORD_THRESHOLD_FACTOR) * t;
}

/**
 * 由登錄錄音之間的「最近鄰距離」推出拒絕門檻（mean + kσ）。
 * 回 null＝樣本不足以估離散度，要請使用者多錄幾次。
 */
export function calibrateThreshold(exemplars, k = 2.8) {
  if (exemplars.length < 2) return null;
  const nearest = [];
  for (let i = 0; i < exemplars.length; i++) {
    let min = FLOAT_MAX;
    for (let j = 0; j < exemplars.length; j++) {
      if (i === j) continue;
      const d = dtwDistance(exemplars[i], exemplars[j]);
      if (d < FLOAT_MAX && d < min) min = d;
    }
    if (min < FLOAT_MAX) nearest.push(min);
  }
  if (nearest.length < 2) return null;
  // 砍掉最差的四分之一：一次錄壞就會把門檻整個拉高
  const sorted = [...nearest].sort((a, b) => a - b);
  const kept = sorted.slice(0, sorted.length - ((sorted.length / 4) | 0));
  const mean = fr(kept.reduce((s, x) => s + x, 0) / kept.length);
  const variance = kept.reduce((s, x) => s + (x - mean) * (x - mean), 0) / kept.length;
  const sigma = fr(Math.sqrt(variance));
  const spread = Math.max(fr(sigma * k), fr(mean * MIN_RELATIVE_SPREAD));
  const floor = fr(Math.max(...kept) * (1 + MIN_RELATIVE_SPREAD));
  // 絕對下限：mean 與 σ 同時為 0 時門檻會變成 0，而距離永遠 ≥ 0
  // ⇒ 樣板永遠不會命中，使用者看到「已啟用」卻怎麼叫都沒反應。
  return Math.max(Math.max(fr(mean + spread), floor), MIN_ABSOLUTE_THRESHOLD);
}

export function enrollmentSpread(exemplars) {
  if (exemplars.length < 2) return null;
  const nearest = [];
  for (let i = 0; i < exemplars.length; i++) {
    let min = FLOAT_MAX;
    for (let j = 0; j < exemplars.length; j++) {
      if (i === j) continue;
      const d = dtwDistance(exemplars[i], exemplars[j]);
      if (d < FLOAT_MAX && d < min) min = d;
    }
    if (min < FLOAT_MAX) nearest.push(min);
  }
  return nearest.length ? fr(nearest.reduce((s, x) => s + x, 0) / nearest.length) : null;
}

// ── 比對政策（對應 App 的 TemplateMatcher）────────────────────────

const MIN_MARGIN_SCALE = 0.5;

/**
 * 對所有樣板算分並排序。sensitivity >1 較容易命中。
 * @param {{frames:Float32Array[]}} query
 * @param {Array<{id, keyword, spokenPhrase, matchMode, exemplars, rejectionThreshold, marginThreshold}>} templates
 */
export function scoreAll(query, templates, sensitivity = 1) {
  const out = [];
  for (const tpl of templates) {
    if (!tpl.exemplars || !tpl.exemplars.length) continue;
    if (tpl.matchMode === "Whole") {
      const d = distanceToBest(query.frames, tpl.exemplars);
      if (d < FLOAT_MAX) {
        out.push({ template: tpl, distance: d, span: null,
                   threshold: tpl.rejectionThreshold * sensitivity });
      }
    } else {
      const hit = subsequenceToBest(query.frames, tpl.exemplars);
      if (!hit) continue;
      const avgTemplateFrames =
        tpl.exemplars.reduce((s, e) => s + e.length, 0) / Math.max(1, tpl.exemplars.length);
      const factor = keywordThresholdFactor(query.frames.length, avgTemplateFrames);
      out.push({ template: tpl, distance: hit.distance,
                 span: [hit.startFrame, hit.endFrame],
                 threshold: tpl.rejectionThreshold * factor * sensitivity });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * @returns {{kind:"hit"|"ambiguous"|"none"|"notSpeech", ...}}
 *
 * 誤觸發（替使用者說出他沒想說的話）比沒觸發（再試一次）危險得多，
 * 所以最佳與次佳太接近時寧可判成 ambiguous 讓他自己選。
 */
export function match(query, templates, { sensitivity = 1, ambiguityLimit = 3 } = {}) {
  if (!query.frames.length) return { kind: "notSpeech" };
  if (!templates.length) return { kind: "none" };
  const scored = scoreAll(query, templates, sensitivity);
  if (!scored.length) return { kind: "none" };
  const accepted = scored.filter(s => s.distance < s.threshold);
  if (!accepted.length) return { kind: "none", scored };

  const best = accepted[0];
  // 次佳要看「全部候選」而不是只看通過門檻的，而且要取 best 以外的第一個——
  // 寫死索引 1 會在 best 不是 scored[0] 時取到 best 自己，margin 恆為 0。
  const runnerUp = scored.find(s => s.template.id !== best.template.id);
  const margin = runnerUp
    ? (runnerUp.distance - best.distance) / Math.max(best.distance, MIN_MARGIN_SCALE)
    : Number.POSITIVE_INFINITY;

  if (margin >= (best.template.marginThreshold ?? 0.15)) {
    return { kind: "hit", template: best.template, distance: best.distance, margin, span: best.span, scored };
  }
  return { kind: "ambiguous", candidates: accepted.slice(0, ambiguityLimit), margin, scored };
}

// ── 與雲端樣板互通 ──────────────────────────────────────────────

// 與 App 端 VectorCodec 一致（little-endian）
const MAGIC_SEQUENCE = 0x56575351;   // "VWSQ"
const MAGIC_BUNDLE   = 0x56574255;   // "VWBU"

/**
 * 解碼 App 端 VectorCodec.encodeBundle 寫出來的 exemplarBlob（base64）。
 * 格式：MAGIC_BUNDLE(int) count(int) 之後每段 [len(int)][sequence bytes]。
 */
export function decodeExemplarBundle(base64) {
  if (!base64) return [];
  const bin = atob(base64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(buf);
  let off = 0;
  const magic = dv.getInt32(off, true); off += 4;
  if (magic !== MAGIC_BUNDLE) throw new Error("not an exemplar-bundle blob");
  const count = dv.getInt32(off, true); off += 4;
  if (count < 0 || count > 64) throw new Error("bad bundle count " + count);
  const out = [];
  for (let s = 0; s < count; s++) {
    const len = dv.getInt32(off, true); off += 4;
    out.push(decodeSequence(dv, off, len));
    off += len;
  }
  return out;
}

function decodeSequence(dv, off, byteLen) {
  const end = off + byteLen;
  /* eslint-disable no-unused-vars */
  const magic = dv.getInt32(off, true); off += 4;
  const frameCount = dv.getInt32(off, true); off += 4;
  const dim = dv.getInt32(off, true); off += 4;
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const row = new Float32Array(dim);
    for (let d = 0; d < dim; d++) { row[d] = dv.getFloat32(off, true); off += 4; }
    frames.push(row);
  }
  if (off > end) throw new Error("sequence overran its length");
  return frames;
}

/** 編碼成 App 端讀得回去的 base64 blob。 */
export function encodeExemplarBundle(sequences) {
  const parts = sequences.map(frames => {
    const dim = frames.length ? frames[0].length : FEATURE_DIM;
    const buf = new ArrayBuffer(12 + frames.length * dim * 4);
    const dv = new DataView(buf);
    let off = 0;
    dv.setInt32(off, MAGIC_SEQUENCE, true); off += 4;
    dv.setInt32(off, frames.length, true); off += 4;
    dv.setInt32(off, dim, true); off += 4;
    for (const row of frames) for (let d = 0; d < dim; d++) { dv.setFloat32(off, row[d], true); off += 4; }
    return new Uint8Array(buf);
  });
  const total = 8 + parts.reduce((s, p) => s + 4 + p.length, 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;
  dv.setInt32(off, MAGIC_BUNDLE, true); off += 4;
  dv.setInt32(off, parts.length, true); off += 4;
  for (const p of parts) { dv.setInt32(off, p.length, true); off += 4; bytes.set(p, off); off += p.length; }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
