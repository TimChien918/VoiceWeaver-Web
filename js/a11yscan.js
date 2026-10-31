// 無障礙操作：掃描（scanning）＋任意大開關＋眨眼選取＋滑鼠停留點選（dwell）。
//
// 設計書模組 2 要求「鼻控追蹤、停留點選、眨眼掃描、高對比、超大字」。鼻控在
// headcontrol.js、高對比與字級在偏好設定；這支補上另外兩種：
//
// ① 掃描＋開關：畫面自己一格一格往下高亮，使用者只要在「亮到對的那格」時按一次開關。
//    開關可以是空白鍵／Enter（外接的大按鈕開關多半就是模擬這兩個鍵）、點畫面任何地方、
//    或刻意的長眨眼（blink.js）。這是 AAC 對重度肢體障礙的標準做法（ASHA 的 switch scanning）：
//    手只要能做「一個動作」，就能操作整個介面。
//    採「先區塊、後項目」兩層掃描：一頁幾十顆按鈕逐一掃，等到要的那顆可能要半分鐘；
//    先選卡片、再選卡片裡的按鈕，平均等待時間短很多。項目層掃完一輪沒選，自動回到區塊層。
//    重度模式（kiosk）本來就是一次一張卡的逐張掃描，那裡開關＝選目前那張卡。
//
// ② 停留點選：滑鼠／觸控筆停在按鈕上 N 秒就自動點。給能移動指標、但按不下去
//    （或按下時會抖到旁邊）的人。秒數與鼻控共用（headcontrol.js 的 setDwellMs）。
import { t } from "./i18n.js?v=1.5.78";
import { state, save } from "./store.js?v=1.5.78";
import { setDwellMs } from "./headcontrol.js?v=1.5.78";
import { startBlink, stopBlink, blinkRunning, setBlinkHold } from "./blink.js?v=1.5.78";

const $ = (s) => document.querySelector(s);

// 可被掃描／停留點選的東西。只收真正的互動元素；文字輸入框不收——
// 用開關沒辦法打字，掃到它只是讓使用者多等一格。
const TARGETS = "button:not([disabled]), .chip, .acard, .sevmode, .setrow, .alt-opt, .kcard, a[href], input[type=checkbox]";
// 這些地方的點擊不當成開關：浮動控制列本身、重度模式給照護者的退出鍵與 PIN 鍵盤。
// 不放行的話，開了「點畫面任一處＝選取」之後，照護者就再也點不到「停止」。
const EXEMPT = "#scanBar, #kioskExitZone, #kioskPin, #kioskNext, #kioskTrail";

const DEF = { scanMs: 1500, blinkHoldMs: 400, dwellMs: 1000 };
const S = () => state.settings;

// ── 共用：觸發一個元素 ──────────────────────────────────
// 與 headcontrol.js 的 fire() 同一套：這個 App 的按鈕很多綁 pointerup（bindTap），
// 所以送成對的指標事件，再補一個 click。這些是**非信任事件**（isTrusted=false），
// 下面攔「點畫面任一處」時只攔信任事件，所以不會把自己送的點擊又當成開關。
function fire(el) {
  if (!el || !el.isConnected) return;
  if (el.matches("input[type=checkbox]")) { el.click(); return; }
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7 };
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o));
  el.dispatchEvent(new MouseEvent("click", o));
}

function visible(el) {
  if (!el || !el.isConnected || el.closest(".hidden")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
const targetsIn = (root) => [...root.querySelectorAll(TARGETS)].filter((el) => visible(el) && !el.closest(EXEMPT));

// ── 掃描 ────────────────────────────────────────────────
let scanning = false, timer = 0;
let level = "group";          // "group"＝在挑區塊；"item"＝在挑區塊裡的按鈕
let gIdx = -1, iIdx = -1, items = [], wrapped = false;
let hl = null;

function kioskOn() { const k = $("#kiosk"); return !!k && !k.classList.contains("hidden"); }
function openModal() { return [...document.querySelectorAll(".modal")].find((m) => !m.classList.contains("hidden")); }

/** 目前的區塊：彈窗開著＝只掃彈窗；否則＝頂端列、分頁列、目前分頁裡看得到的每張卡。 */
function groups() {
  const m = openModal();
  if (m) return [m.querySelector(".modal-card") || m].filter((g) => targetsIn(g).length);
  const panel = document.querySelector("main .panel:not(.hidden)");
  const list = [document.querySelector(".topbar"), document.querySelector("nav.tabs")];
  if (panel) {
    list.push(...panel.querySelectorAll(":scope > .card, :scope > #settingsCards > .card, :scope > #btnSettingsBack"));
  }
  return list.filter((g) => g && visible(g) && (g.matches(TARGETS) || targetsIn(g).length));
}

function highlight(el) {
  hl?.classList.remove("scan-hl");
  hl = el;
  if (!el) { setLabel(""); return; }
  el.classList.add("scan-hl");
  try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {}
  const txt = (el.getAttribute("aria-label") || el.innerText || el.value || "").replace(/\s+/g, " ").trim();
  setLabel(txt.length > 42 ? txt.slice(0, 40) + "…" : txt);
}

function tick() {
  if (!scanning) return;
  if (kioskOn()) { highlight(null); setLabel(t("scan.kiosk")); return; }   // 重度模式自己會換卡
  if (level === "item") {
    items = items.filter(visible);
    if (!items.length) { level = "group"; }
    else {
      iIdx++;
      if (iIdx >= items.length) {
        // 項目層掃完一輪都沒選：回區塊層（使用者可能選錯區塊，不能把他困在裡面）
        if (wrapped) { level = "group"; iIdx = -1; }
        else { iIdx = 0; wrapped = true; }
      }
      if (level === "item") { highlight(items[iIdx]); return; }
    }
  }
  const gs = groups();
  if (!gs.length) { highlight(null); return; }
  gIdx = (gIdx + 1) % gs.length;
  highlight(gs[gIdx]);
}

function restartTimer() {
  clearInterval(timer);
  timer = setInterval(tick, Math.max(500, +S().scanMs || DEF.scanMs));
}

/** 開關被按下（鍵盤、點畫面、眨眼都走這裡）。 */
export function scanSelect() {
  if (!scanning) return;
  if (kioskOn()) { fire($("#kioskCards .kcard")); return; }
  const el = hl;
  if (!el || !el.isConnected) { tick(); return; }
  if (level === "group") {
    const inner = el.matches(TARGETS) ? [el] : targetsIn(el);
    if (inner.length === 1) { fire(inner[0]); afterFire(); return; }
    // 進到區塊裡：從第一個項目開始，並重新計時（讓使用者有完整的一格時間反應）
    level = "item"; items = inner; iIdx = 0; wrapped = false;
    highlight(items[0]); restartTimer();
    return;
  }
  fire(el);
  afterFire();
}

// 選完回到區塊層、停在**同一個區塊**：連續點同一張卡裡的圖卡（組一句話）是最常見的操作，
// 回到第一個區塊從頭掃的話，每點一張都要再等一整輪。
function afterFire() {
  level = "group"; items = []; iIdx = -1;
  gIdx = Math.max(-1, gIdx - 1);   // 下一次 tick 會 +1，回到同一個區塊
  restartTimer();
  setTimeout(tick, 250);           // 等點擊造成的畫面變化（切分頁、開彈窗）先發生
}

export function startScan() {
  if (scanning) return;
  scanning = true; level = "group"; gIdx = -1; iIdx = -1;
  document.body.classList.add("scan-on");
  renderBar();
  tick(); restartTimer();
}

export function stopScan() {
  scanning = false;
  clearInterval(timer); timer = 0;
  highlight(null);
  document.body.classList.remove("scan-on");
  if (blinkRunning()) stopBlink();
  renderBar();
}

// 開關輸入：空白鍵／Enter。正在打字時不攔（那是在輸入，不是開關）。
function isEditable(el) {
  return !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|range)$/i.test(el.type)));
}
// 被當成開關的那一下，後面跟著的 pointerup 與 click 也要吞掉（各吞一次），
// 不然手指下面那顆按鈕還是會收到 click。只吞「同一下」的：用旗標而不是時間窗，
// 否則緊接著按「停止掃描」之後的第一下正常點擊也會被誤吞。
let _swallow = { up: false, click: false, until: 0 };
function bindSwitchInputs() {
  document.addEventListener("keydown", (e) => {
    if (!scanning || e.repeat || (e.key !== " " && e.key !== "Enter")) return;
    if (isEditable(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    scanSelect();
  }, true);
  // 點畫面任一處＝開關。在捕獲階段攔下信任事件，原本手指下面的那顆按鈕不會被點到——
  // 否則使用者想「選目前亮的那格」，結果點到的是手剛好壓到的另一顆。
  document.addEventListener("pointerdown", (e) => {
    if (!scanning || !e.isTrusted || e.target.closest?.(EXEMPT)) return;
    if (isEditable(e.target)) return;   // 照護者點輸入框是要打字，放行
    e.preventDefault(); e.stopPropagation();
    _swallow = { up: true, click: true, until: Date.now() + 1500 };
    scanSelect();
  }, true);
  for (const [type, flag] of [["pointerup", "up"], ["click", "click"]]) {
    document.addEventListener(type, (e) => {
      if (!e.isTrusted || !_swallow[flag]) return;
      _swallow[flag] = false;
      if (Date.now() > _swallow.until) return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
}

// ── 眨眼 ────────────────────────────────────────────────
async function enableBlink(chk) {
  setBlinkHold(+S().blinkHoldMs || DEF.blinkHoldMs);
  try {
    await startBlink({
      onBlink: () => scanSelect(),
      onStatus: (m) => { const el = $("#blinkStatus"); if (el) el.textContent = m; },
      onProgress: (p) => { const eye = $("#scanEye"); if (eye) eye.style.setProperty("--p", String(p)); },
    });
  } catch {
    if (chk) chk.checked = false;
    S().scanBlink = false; save();
  }
  renderBar();
}

// ── 停留點選（滑鼠／觸控筆）──────────────────────────────
let dwellEl = null, dwellStart = 0, dwellRaf = 0, dwellRing = null, dwellDone = null;
function ensureRing() {
  if (dwellRing) return dwellRing;
  dwellRing = document.createElement("div");
  dwellRing.id = "dwellRing";
  dwellRing.innerHTML = '<svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="16"/><circle class="ring" cx="18" cy="18" r="16"/></svg>';
  document.body.appendChild(dwellRing);
  return dwellRing;
}
function dwellFrame() {
  dwellRaf = 0;
  if (!dwellEl) return;
  const p = Math.min(1, (performance.now() - dwellStart) / (+S().dwellMs || DEF.dwellMs));
  ensureRing().style.setProperty("--p", String(p));
  if (p >= 1) {
    const el = dwellEl;
    dwellDone = el;              // 點過之後要先離開這顆才會再觸發，不然停著不動會一直連點
    clearDwell();
    fire(el);
    return;
  }
  dwellRaf = requestAnimationFrame(dwellFrame);
}
function clearDwell() {
  dwellEl?.classList.remove("head-hover");
  dwellEl = null;
  if (dwellRaf) { cancelAnimationFrame(dwellRaf); dwellRaf = 0; }
  dwellRing?.classList.remove("on");
}
function bindDwell() {
  document.addEventListener("pointermove", (e) => {
    if (!S().dwellMouse || e.pointerType === "touch") return;   // 觸控沒有「停在上面」這回事
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(TARGETS);
    const ring = ensureRing();
    ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (el === dwellEl) return;
    clearDwell();
    if (el !== dwellDone) dwellDone = null;
    if (!el || el === dwellDone || el.closest(EXEMPT + ", #headCursor")) return;
    dwellEl = el; dwellStart = performance.now();
    el.classList.add("head-hover");
    ring.classList.add("on");
    ring.style.setProperty("--p", "0");
    dwellRaf = requestAnimationFrame(dwellFrame);
  }, { passive: true });
  document.addEventListener("pointerleave", clearDwell);
}

// ── 浮動控制列 ───────────────────────────────────────────
function ensureBar() {
  let bar = $("#scanBar");
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "scanBar";
  bar.className = "scan-bar hidden";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span id="scanEye" class="scan-eye hidden" aria-hidden="true">👁</span>
    <span class="scan-text"><b id="scanLabel"></b><span id="scanHint" class="tiny"></span></span>
    <button id="scanBlinkResume" class="btn ghost hidden" type="button"></button>
    <button id="scanStop" class="btn ghost" type="button"></button>`;
  document.body.appendChild(bar);
  bar.querySelector("#scanStop").addEventListener("click", () => {
    S().scanMode = false; save();
    const chk = $("#s_scan"); if (chk) chk.checked = false;
    stopScan();
  });
  // 重新整理後不自動開鏡頭（相機一定要由使用者當下的動作啟動），所以在這裡給一顆恢復鍵
  bar.querySelector("#scanBlinkResume").addEventListener("click", () => enableBlink($("#s_blink")));
  return bar;
}
function setLabel(s) { const el = $("#scanLabel"); if (el) el.textContent = s; }

function renderBar() {
  const bar = ensureBar();
  bar.classList.toggle("hidden", !scanning);
  $("#scanStop").textContent = t("scan.stop");
  $("#scanHint").textContent = blinkRunning() ? t("scan.hintBlink") : t("scan.hint");
  $("#scanEye").classList.toggle("hidden", !blinkRunning());
  const resume = $("#scanBlinkResume");
  resume.textContent = t("blink.resume");
  resume.classList.toggle("hidden", !(scanning && S().scanBlink && !blinkRunning()));
}

function fmtSec(ms) { return (ms / 1000).toFixed(1) + "s"; }

/** 切語言時重畫（浮動列與滑桿數值都是動態文字）。 */
export function renderA11yScan() {
  renderBar();
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#scanSpeedVal", fmtSec(+S().scanMs || DEF.scanMs));
  set("#blinkHoldVal", fmtSec(+S().blinkHoldMs || DEF.blinkHoldMs));
  set("#dwellVal", fmtSec(+S().dwellMs || DEF.dwellMs));
}

let _bound = false;
export function setupA11yScan() {
  if (_bound) { renderA11yScan(); return; }
  _bound = true;
  bindSwitchInputs();
  bindDwell();
  const chkScan = $("#s_scan"), spd = $("#s_scanSpeed"), chkBlink = $("#s_blink"), hold = $("#s_blinkHold");
  const chkDwell = $("#s_dwell"), dwell = $("#s_dwellMs");
  if (chkScan) chkScan.checked = !!S().scanMode;
  if (spd) spd.value = (+S().scanMs || DEF.scanMs) / 1000;
  if (chkBlink) chkBlink.checked = !!S().scanBlink;
  if (hold) hold.value = (+S().blinkHoldMs || DEF.blinkHoldMs) / 1000;
  if (chkDwell) chkDwell.checked = !!S().dwellMouse;
  if (dwell) dwell.value = (+S().dwellMs || DEF.dwellMs) / 1000;
  setDwellMs(+S().dwellMs || DEF.dwellMs);

  chkScan?.addEventListener("change", (e) => {
    S().scanMode = e.target.checked; save();
    if (e.target.checked) startScan();
    else { stopScan(); if (chkBlink) chkBlink.checked = false; S().scanBlink = false; save(); }
  });
  spd?.addEventListener("input", (e) => {
    S().scanMs = Math.round(+e.target.value * 1000); save();
    renderA11yScan(); if (scanning) restartTimer();
  });
  chkBlink?.addEventListener("change", async (e) => {
    S().scanBlink = e.target.checked; save();
    if (e.target.checked) {
      // 眨眼是掃描的開關，沒有掃描就沒有東西可以選——一起打開
      if (!scanning) { S().scanMode = true; save(); if (chkScan) chkScan.checked = true; startScan(); }
      await enableBlink(chkBlink);
    } else { stopBlink(); const st = $("#blinkStatus"); if (st) st.textContent = ""; renderBar(); }
  });
  hold?.addEventListener("input", (e) => {
    S().blinkHoldMs = Math.round(+e.target.value * 1000); save();
    setBlinkHold(S().blinkHoldMs); renderA11yScan();
  });
  chkDwell?.addEventListener("change", (e) => { S().dwellMouse = e.target.checked; save(); if (!e.target.checked) clearDwell(); });
  dwell?.addEventListener("input", (e) => {
    S().dwellMs = Math.round(+e.target.value * 1000); save();
    setDwellMs(S().dwellMs); renderA11yScan();
  });

  renderA11yScan();
  // 掃描不用相機，重新整理後直接恢復（需要它的人不該每次都請別人幫忙打開）；
  // 眨眼要開相機，留給浮動列上的「開啟眨眼」由使用者按。
  if (S().scanMode) startScan();
}
