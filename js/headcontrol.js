// 鼻子頭控（Camera Mouse 式）：前鏡頭追鼻尖，轉頭移動游標，停在按鈕上約一秒
// 自動點擊（dwell）。給手部無法穩定操作的使用者。
//
// 用 MediaPipe 的 **Tasks Vision FaceLandmarker**（現行 API），不是舊的
// face_mesh 0.4.x solutions 版。差別不只是版本號：
//   · runningMode:"VIDEO" 會吃時間戳做**跨幀追蹤**，舊版每一幀都當獨立影像重偵測，
//     landmark 會逐幀跳動——那個跳動最後全部變成游標抖動。
//   · GPU delegate，行動裝置上幀率高很多；頭控的手感直接來自幀率。
//   · 模型本身也比 0.4.x 那版新。
//
// 座標怎麼算（這一段才是準度的關鍵）：
//   1. 鼻尖取「相對雙眼中心」再除以雙眼距離 → 靠近或遠離螢幕都不影響。
//   2. **先補償頭部側傾（roll）**。使用者歪頭時雙眼連線是斜的，不補償的話
//      「往右轉」會被算成斜著走——躺著或側靠在枕頭上的人尤其明顯，而那正是
//      需要頭控的人常見的姿勢。
//   3. 中性姿勢自適應**只在靠近中性時進行**。原本不分狀況一直漂移，使用者
//      故意把頭轉去邊緣停留時，中性點會跟著跑過去，手一放游標就回不到中間。
//   4. 死區：頭部本來就會微顫，中性點附近的微小位移直接歸零，游標才停得住。
//   5. One-Euro 濾波：低速抑抖、快速放行。單純平均會又鈍又飄。
//
// 上面 2~4 都寫成純函式（不碰 DOM、不碰相機），下面 tools 的測試直接餵合成
// 座標驗證——鏡頭相關的部分沒辦法在 CI 裡驗，這幾段至少要能算得出來。
import { t } from "./i18n.js?v=1.5.77";
import { state, save } from "./store.js?v=1.5.77";
// 座標數學獨立一支：它不該依賴 i18n 或 store，抽開之後也才測得到。
import { noseOffset, driftNeutral, toCursor, clamp01 } from "./headmath.js?v=1.5.77";

const TASKS_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/" +
                  "face_landmarker/float16/1/face_landmarker.task";
// 舊版 solutions，只有在新版載不進來時才退回去用
const LEGACY_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";

const NOSE = 1, L_OUT = 33, R_OUT = 263;
const BASE_SENS_X = 4.5, BASE_SENS_Y = 6.0;
const DWELL_MS = 1000;


// ── One-Euro 濾波 ──────────────────────────────────

export function OneEuro(minCutoff, beta){
  this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = 1.0;
  this.xPrev = NaN; this.dxPrev = 0; this.tPrev = 0;
}
OneEuro.prototype.alpha = function (cutoff, dt){
  const r = 2 * Math.PI * cutoff * dt; return r / (r + 1);
};
OneEuro.prototype.filter = function (x, tMs){
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

// ── 執行期狀態 ─────────────────────────────────────

let SENS_X = BASE_SENS_X, SENS_Y = BASE_SENS_Y;
let dx0 = NaN, dy0 = NaN;
let running = false, videoEl = null, stream = null, cursorEl = null;
let dwellTarget = null, dwellStart = 0, rafId = 0;
let landmarker = null, legacy = null;
let onStatus = () => {};
let euroX = new OneEuro(0.6, 0.012), euroY = new OneEuro(0.6, 0.012);

export function setSensitivity(mult){
  const m = Math.max(0.3, Math.min(3.0, Number(mult) || 1));
  SENS_X = BASE_SENS_X * m; SENS_Y = BASE_SENS_Y * m;
}

/** 重新置中：把目前的頭部姿勢當成中央。 */
export function recenter(){
  dx0 = NaN; dy0 = NaN;
  euroX = new OneEuro(0.6, 0.012); euroY = new OneEuro(0.6, 0.012);
  onStatus(t("head.recentered"));
}

function ensureCursor(){
  if (cursorEl) return cursorEl;
  cursorEl = document.createElement("div");
  cursorEl.id = "headCursor";
  cursorEl.innerHTML = '<svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="16"/>' +
                       '<circle class="ring" cx="18" cy="18" r="16"/></svg><i></i>';
  document.body.appendChild(cursorEl);
  return cursorEl;
}

// 游標下方可觸發的東西。只認真正的互動元素，避免停在空白處誤觸整塊卡片。
function hitTarget(x, y){
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest("button, .chip, .acard, .tab, .sevmode, a[href], input[type=checkbox]");
}

/** 一組 landmark → 更新游標與 dwell。兩種 API 回來的格式在呼叫端先攤平成陣列。 */
function onLandmarks(lm){
  if (!running || !lm || !lm.length) return;
  const n = lm[NOSE], l = lm[L_OUT], r = lm[R_OUT];
  if (!n || !l || !r) return;

  const { dx, dy } = noseOffset(n.x, n.y, l.x, l.y, r.x, r.y);
  if (isNaN(dx0)) { dx0 = dx; dy0 = dy; }
  dx0 = driftNeutral(dx0, dx);
  dy0 = driftNeutral(dy0, dy);

  const { cx, cy } = toCursor(dx, dy, dx0, dy0, SENS_X, SENS_Y);
  const now = performance.now();
  const px = clamp01(euroX.filter(cx, now)) * window.innerWidth;
  const py = clamp01(euroY.filter(cy, now)) * window.innerHeight;

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
function fire(el){
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o));
  el.dispatchEvent(new MouseEvent("click", o));
}

function loadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("load fail"));
    document.head.appendChild(s);
  });
}

/**
 * 載入新版 FaceLandmarker。GPU 拿不到就退 CPU——某些舊機器的 WebGL 會失敗，
 * 那時 CPU 慢一點總比整個開不起來好。
 */
async function makeLandmarker(){
  const vision = await import(/* @vite-ignore */ `${TASKS_CDN}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);
  const opts = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",      // 吃時間戳做跨幀追蹤，landmark 才不會逐幀跳
    numFaces: 1,
  };
  try {
    return await vision.FaceLandmarker.createFromOptions(files, opts);
  } catch {
    opts.baseOptions.delegate = "CPU";
    return await vision.FaceLandmarker.createFromOptions(files, opts);
  }
}

/** 新版載不進來（CDN 被擋、瀏覽器太舊）時退回舊版，功能照舊只是抖一點。 */
async function makeLegacy(){
  if (typeof window.FaceMesh === "undefined") await loadScript(`${LEGACY_CDN}/face_mesh.js`);
  if (typeof window.FaceMesh === "undefined") throw new Error(t("head.loadFail"));
  const fm = new window.FaceMesh({ locateFile: f => `${LEGACY_CDN}/${f}` });
  fm.setOptions({ maxNumFaces: 1, refineLandmarks: false,
                  minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  await fm.initialize();
  fm.onResults(res => onLandmarks(res?.multiFaceLandmarks?.[0]));
  return fm;
}

export async function startHeadControl(statusFn){
  if (running) return;
  onStatus = statusFn || (() => {});
  try {
    if (!window.isSecureContext) throw new Error(t("head.needsHttps"));
    onStatus(t("head.loading"));

    try { landmarker = await makeLandmarker(); }
    catch (e) { console.warn("tasks-vision 載入失敗，退回舊版", e); legacy = await makeLegacy(); }

    // 解析度指定高一點：畫面越小，鼻尖的像素位移越小，量化誤差就越大。
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 },
               frameRate: { ideal: 30 } },
    });
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

    let lastTs = -1;
    const pump = () => {
      if (!running) return;
      if (videoEl.readyState >= 2) {
        if (landmarker) {
          // VIDEO 模式要求時間戳嚴格遞增，重複的一律跳過（丟進去會直接拋錯）
          const ts = Math.round(performance.now());
          if (ts > lastTs) {
            lastTs = ts;
            try { onLandmarks(landmarker.detectForVideo(videoEl, ts)?.faceLandmarks?.[0]); }
            catch { /* 單幀失敗略過，不要讓一幀壞掉就停掉整個追蹤 */ }
          }
        } else if (legacy) {
          legacy.send({ image: videoEl }).catch(() => {});
        }
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

export function stopHeadControl(){
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  stream?.getTracks().forEach(tr => tr.stop());
  stream = null;
  videoEl?.remove(); videoEl = null;
  try { landmarker?.close?.(); } catch { /* 關不掉就算了，下次會重建 */ }
  landmarker = null; legacy = null;
  dwellTarget?.classList.remove("head-hover"); dwellTarget = null;
  cursorEl?.classList.remove("on", "armed");
  dx0 = NaN; dy0 = NaN;
}

export function setupHeadControl(statusFn){
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
