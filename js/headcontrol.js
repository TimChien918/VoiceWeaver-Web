// 鼻子頭控（Camera Mouse 式）——與 App 的 nose_tracker.html 同一套演算法。
//
// 給手部無法穩定操作的使用者：前鏡頭追鼻尖，轉頭移動游標，停在按鈕上約一秒
// 自動點擊（dwell）。App 是把這頁塞進 WebView 跑，網頁版直接原生跑同樣的東西。
//
// 幾個關鍵設計：
//  - 鼻尖位置取「相對雙眼中心」再除以臉寬正規化 → 使用者靠近或遠離螢幕都不影響。
//  - 中性姿勢會緩慢自適應（NEUTRAL_DRIFT）：坐姿慢慢變了不必一直重新校正，
//    但快速轉頭仍然反應得到。
//  - One-Euro 濾波：低速時抑制抖動（頭部本來就會微顫），快速移動時放行，
//    這是頭控最關鍵的一步；單純平均會變得又鈍又飄。
//  - dwell 觸發用「進度環」給視覺回饋，並在離開元素時歸零，避免誤觸。
import { t } from "./i18n.js?v=1.5.31";
import { state, save } from "./store.js?v=1.5.31";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";
const NOSE = 1, L_OUT = 33, R_OUT = 263;
const BASE_SENS_X = 4.5, BASE_SENS_Y = 6.0;
const NEUTRAL_DRIFT = 0.003;
const DWELL_MS = 1000;

let SENS_X = BASE_SENS_X, SENS_Y = BASE_SENS_Y;
let dx0 = NaN, dy0 = NaN;
let running = false, videoEl = null, stream = null, cursorEl = null;
let dwellTarget = null, dwellStart = 0, rafId = 0;
let onStatus = () => {};

function OneEuro(minCutoff, beta) {
  this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = 1.0;
  this.xPrev = NaN; this.dxPrev = 0; this.tPrev = 0;
}
OneEuro.prototype.alpha = function (cutoff, dt) {
  const r = 2 * Math.PI * cutoff * dt; return r / (r + 1);
};
OneEuro.prototype.filter = function (x, tMs) {
  if (isNaN(this.xPrev)) { this.xPrev = x; this.tPrev = tMs; return x; }
  let dt = (tMs - this.tPrev) / 1000; if (dt <= 0) dt = 1 / 30;
  this.tPrev = tMs;
  const dx = (x - this.xPrev) / dt;
  const aD = this.alpha(this.dCutoff, dt);
  const dxHat = aD * dx + (1 - aD) * this.dxPrev; this.dxPrev = dxHat;
  const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
  const a = this.alpha(cutoff, dt);
  const xHat = a * x + (1 - a) * this.xPrev; this.xPrev = xHat;
  return xHat;
};
let euroX = new OneEuro(0.6, 0.012), euroY = new OneEuro(0.6, 0.012);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export function setSensitivity(mult) {
  const m = Math.max(0.3, Math.min(3.0, Number(mult) || 1));
  SENS_X = BASE_SENS_X * m; SENS_Y = BASE_SENS_Y * m;
}
/** 重新置中：把目前的頭部姿勢當成中央。 */
export function recenter() {
  dx0 = NaN; dy0 = NaN;
  euroX = new OneEuro(0.6, 0.012); euroY = new OneEuro(0.6, 0.012);
  onStatus(t("head.recentered"));
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("load fail"));
    document.head.appendChild(s);
  });
}

function ensureCursor() {
  if (cursorEl) return cursorEl;
  cursorEl = document.createElement("div");
  cursorEl.id = "headCursor";
  cursorEl.innerHTML = '<svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="16"/>' +
                       '<circle class="ring" cx="18" cy="18" r="16"/></svg><i></i>';
  document.body.appendChild(cursorEl);
  return cursorEl;
}

// 游標下方可觸發的東西。只認真正的互動元素，避免停在空白處誤觸整塊卡片。
function hitTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest("button, .chip, .acard, .tab, .sevmode, a[href], input[type=checkbox]");
}

function onResults(res) {
  if (!running || !res.multiFaceLandmarks || !res.multiFaceLandmarks.length) return;
  const lm = res.multiFaceLandmarks[0];
  const nose = lm[NOSE];
  const ax = (lm[L_OUT].x + lm[R_OUT].x) / 2;
  const ay = (lm[L_OUT].y + lm[R_OUT].y) / 2;
  const fw = Math.hypot(lm[L_OUT].x - lm[R_OUT].x, lm[L_OUT].y - lm[R_OUT].y) + 1e-6;

  const dx = (nose.x - ax) / fw;
  const dy = (nose.y - ay) / fw;
  if (isNaN(dx0)) { dx0 = dx; dy0 = dy; }
  dx0 = dx0 * (1 - NEUTRAL_DRIFT) + dx * NEUTRAL_DRIFT;
  dy0 = dy0 * (1 - NEUTRAL_DRIFT) + dy * NEUTRAL_DRIFT;

  // 前鏡頭影像未鏡像：頭往右轉時鼻尖在影像中左移 → 用負號讓游標自然往右
  let cx = 0.5 - (dx - dx0) * SENS_X;
  let cy = 0.5 + (dy - dy0) * SENS_Y;
  const now = performance.now();
  cx = clamp01(euroX.filter(clamp01(cx), now));
  cy = clamp01(euroY.filter(clamp01(cy), now));

  const px = cx * window.innerWidth, py = cy * window.innerHeight;
  const c = ensureCursor();
  c.style.transform = `translate(${px}px, ${py}px)`;

  // ── dwell：停在同一個元素滿 DWELL_MS 就觸發 ──
  const target = hitTarget(px, py);
  if (target !== dwellTarget) {
    dwellTarget?.classList.remove("head-hover");
    dwellTarget = target;
    dwellStart = now;
    dwellTarget?.classList.add("head-hover");
    c.classList.toggle("armed", !!target);
  }
  if (dwellTarget) {
    const p = Math.min(1, (now - dwellStart) / DWELL_MS);
    c.style.setProperty("--p", String(p));
    if (p >= 1) {
      const el = dwellTarget;
      dwellTarget.classList.remove("head-hover");
      dwellTarget = null;
      c.classList.remove("armed");
      fire(el);
    }
  } else {
    c.style.setProperty("--p", "0");
  }
}

// 觸發：這個 App 的按鈕多半綁 pointerup（bindTap），所以送成對的指標事件，
// 再補一個 click 給用 addEventListener("click") 的元素。
function fire(el) {
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o));
  el.dispatchEvent(new MouseEvent("click", o));
}

export async function startHeadControl(statusFn) {
  if (running) return;
  onStatus = statusFn || (() => {});
  try {
    if (!window.isSecureContext) throw new Error(t("head.needsHttps"));
    onStatus(t("head.loading"));
    if (typeof window.FaceMesh === "undefined") await loadScript(`${MP}/face_mesh.js`);
    if (typeof window.FaceMesh === "undefined") throw new Error(t("head.loadFail"));

    const faceMesh = new window.FaceMesh({ locateFile: f => `${MP}/${f}` });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false,
                          minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    await faceMesh.initialize();
    faceMesh.onResults(onResults);

    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    videoEl = document.createElement("video");
    videoEl.playsInline = true; videoEl.muted = true;
    videoEl.style.cssText = "position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none;left:0;top:0";
    document.body.appendChild(videoEl);
    videoEl.srcObject = stream;
    await videoEl.play();

    running = true;
    ensureCursor().classList.add("on");
    setSensitivity(state.settings.noseSensitivity || 1);
    onStatus(t("head.tracking"));

    const pump = async () => {
      if (!running) return;
      if (videoEl.readyState >= 2) {
        try { await faceMesh.send({ image: videoEl }); } catch { /* 單幀失敗略過 */ }
      }
      rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);
  } catch (e) {
    stopHeadControl();
    onStatus(t("head.initFail") + (e.message || e));
    throw e;
  }
}

export function stopHeadControl() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  stream?.getTracks().forEach(tr => tr.stop());
  stream = null;
  videoEl?.remove(); videoEl = null;
  dwellTarget?.classList.remove("head-hover"); dwellTarget = null;
  cursorEl?.classList.remove("on", "armed");
  dx0 = NaN; dy0 = NaN;
}

export function setupHeadControl(statusFn) {
  const chk = document.querySelector("#s_head");
  const sens = document.querySelector("#s_headSens");
  const recal = document.querySelector("#s_headRecenter");
  if (!chk) return;
  chk.checked = !!state.settings.headControl;
  if (sens) sens.value = state.settings.noseSensitivity || 1;

  chk.addEventListener("change", async e => {
    state.settings.headControl = e.target.checked; save();
    if (e.target.checked) {
      try { await startHeadControl(statusFn); }
      catch { chk.checked = false; state.settings.headControl = false; save(); }
    } else { stopHeadControl(); statusFn?.(""); }
  });
  sens?.addEventListener("input", e => {
    state.settings.noseSensitivity = +e.target.value; save(); setSensitivity(+e.target.value);
  });
  recal?.addEventListener("click", recenter);

  // 重新整理後不自動開鏡頭：相機要由使用者當下的動作啟動，不能靜默開啟。
}
