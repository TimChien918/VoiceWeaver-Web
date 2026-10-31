// 眨眼開關：前鏡頭偵測「刻意的長眨眼」，當成一顆選取鍵用（給眨眼掃描）。
//
// 對象是連頭都轉不太動、只剩眼睛能穩定控制的重度患者——鼻控（headcontrol.js）
// 對他們沒有用，但「閉眼半秒」通常還做得到。
//
// 為什麼不是「眨一下就算」：人一分鐘自然眨眼十幾次，每次約 0.1～0.15 秒。
// 眨一下就觸發的話，掃描到哪就選到哪，等於亂點。所以要**閉住超過門檻**
// （預設 0.4 秒，可在設定調）才觸發，而且要先睜開才能觸發下一次——閉著眼休息
// 不會一直連點。臉離開畫面（低頭、轉身）也不算閉眼，那時候直接歸零。
//
// 閉眼怎麼判斷：優先用 FaceLandmarker 的 blendshapes（eyeBlinkLeft/Right，
// 模型直接給的 0~1 閉眼程度，對眼型差異比幾何算法穩）；拿不到時退回眼睛縱橫比（EAR），
// 並以使用者自己睜眼時的數值當基準，不用寫死的門檻——每個人眼睛大小不一樣。
//
// 模型與 CDN 跟 headcontrol.js 同一套（Tasks Vision FaceLandmarker、VIDEO 模式跨幀追蹤）。
// 兩個同時開時會各跑一份推論，比較吃電；但兩者的使用者幾乎不重疊，合併的複雜度不划算。
import { t } from "./i18n.js?v=1.5.78";

const TASKS_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/" +
                  "face_landmarker/float16/1/face_landmarker.task";

// EAR 用的 landmark（MediaPipe Face Mesh 468 點）：眼角兩點＋上下眼瞼兩點
const L_EYE = [33, 133, 159, 145], R_EYE = [362, 263, 386, 374];
const BLEND_CLOSED = 0.5;      // blendshape 閉眼程度超過這個值算閉
const REFRACTORY_MS = 700;     // 觸發後的冷卻，避免一次長閉眼被算兩次

let running = false, landmarker = null, stream = null, videoEl = null, rafId = 0;
let holdMs = 400;
let closedSince = null, firedThisClose = false, lastFire = 0;
let earOpen = NaN;             // 使用者睜眼時的 EAR 基準（慢速追蹤）
let cb = { onBlink: () => {}, onStatus: () => {}, onProgress: () => {} };

export function blinkRunning() { return running; }

export function setBlinkHold(ms) {
  const v = Number(ms);
  if (Number.isFinite(v)) holdMs = Math.max(200, Math.min(1500, v));
}

function ear(lm, [a, b, c, d]) {
  const p = lm[a], q = lm[b], u = lm[c], w = lm[d];
  if (!p || !q || !u || !w) return NaN;
  const h = Math.hypot(p.x - q.x, p.y - q.y);
  return h > 0 ? Math.hypot(u.x - w.x, u.y - w.y) / h : NaN;
}

/** 這一幀眼睛是不是閉著。回 null 代表沒看到臉。 */
function eyesClosed(res) {
  const lm = res?.faceLandmarks?.[0];
  if (!lm) return null;
  const cats = res?.faceBlendshapes?.[0]?.categories;
  if (cats && cats.length) {
    const s = (name) => cats.find((c) => c.categoryName === name)?.score ?? 0;
    // 兩眼都要閉：偏癱患者常有一側眼瞼下垂，只看單眼會一直誤判成閉著
    return Math.min(s("eyeBlinkLeft"), s("eyeBlinkRight")) > BLEND_CLOSED;
  }
  const e = (ear(lm, L_EYE) + ear(lm, R_EYE)) / 2;
  if (!Number.isFinite(e)) return null;
  if (isNaN(earOpen)) earOpen = e;
  const closed = e < earOpen * 0.6;
  // 基準只在睜眼時慢慢更新：閉眼時也更新的話，基準會被拉低，之後就再也判不出閉眼
  if (!closed) earOpen = earOpen * 0.98 + e * 0.02;
  return closed;
}

function step(res, now) {
  const closed = eyesClosed(res);
  if (!closed) {                         // 睜眼或沒看到臉：歸零，下一次閉眼才能再觸發
    closedSince = null; firedThisClose = false; cb.onProgress(0);
    return;
  }
  if (closedSince === null) closedSince = now;
  const p = Math.min(1, (now - closedSince) / holdMs);
  cb.onProgress(firedThisClose ? 0 : p);
  if (p >= 1 && !firedThisClose && now - lastFire > REFRACTORY_MS) {
    firedThisClose = true; lastFire = now;
    cb.onBlink();
  }
}

async function makeLandmarker() {
  const vision = await import(/* @vite-ignore */ `${TASKS_CDN}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);
  const opts = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
  };
  try { return await vision.FaceLandmarker.createFromOptions(files, opts); }
  catch { opts.baseOptions.delegate = "CPU"; return await vision.FaceLandmarker.createFromOptions(files, opts); }
}

/** 開鏡頭開始偵測。必須由使用者的動作呼叫（勾選開關），不能在載入時靜默開相機。 */
export async function startBlink({ onBlink, onStatus, onProgress } = {}) {
  if (running) return;
  cb = { onBlink: onBlink || (() => {}), onStatus: onStatus || (() => {}), onProgress: onProgress || (() => {}) };
  try {
    if (!window.isSecureContext) throw new Error(t("head.needsHttps"));
    cb.onStatus(t("head.loading"));
    landmarker = await makeLandmarker();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    videoEl = document.createElement("video");
    videoEl.playsInline = true; videoEl.muted = true;
    videoEl.style.cssText = "position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none;left:0;top:0";
    document.body.appendChild(videoEl);
    videoEl.srcObject = stream;
    await videoEl.play();
    running = true;
    cb.onStatus(t("blink.tracking").replace("{s}", (holdMs / 1000).toFixed(1)));
    let lastTs = -1;
    const pump = () => {
      if (!running) return;
      if (videoEl.readyState >= 2) {
        const ts = Math.round(performance.now());
        if (ts > lastTs) {                // VIDEO 模式要求時間戳嚴格遞增
          lastTs = ts;
          try { step(landmarker.detectForVideo(videoEl, ts), ts); } catch { /* 單幀失敗略過 */ }
        }
      }
      rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);
  } catch (e) {
    stopBlink();
    cb.onStatus(t("head.initFail") + (e.message || e));
    throw e;
  }
}

export function stopBlink() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  videoEl?.remove(); videoEl = null;
  try { landmarker?.close?.(); } catch { /* 下次重建 */ }
  landmarker = null;
  closedSince = null; firedThisClose = false; earOpen = NaN;
  cb.onProgress(0);
}
