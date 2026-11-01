// 版面互動與「有意義的動畫」：導覽列的滑動指示器、分頁轉場方向、首頁（問候、功能卡、最近說過的話）、
// 重組的步驟條與「把碎詞拾起、織成句子」載入動畫、候選句依序浮現、錄音聲波、復健分數滾動與進度環、
// 圖卡點擊漣漪、危機視窗呼吸字樣淡入淡出。
//
// 設計原則：這支只「看」DOM（MutationObserver），不改任何狀態、不攔任何事件——
// 功能邏輯全在 app.js 等原本的模組裡。所以它壞掉或被拿掉，App 照樣能用，只是少了動畫。
// 減少動態（prefers-reduced-motion）時，所有位移／縮放改成單純淡入。
//
// 1.6.2「靈動＋液態玻璃」：分頁指示器像一滴液體拉長後回彈地滑過去、選中的圖示小跳一下、
// 首頁功能卡懸停時微微 3D 傾斜＋光澤跟著游標（只限滑鼠）、報表數字滾動、Chromium 的玻璃折射濾鏡。
import { t } from "./i18n.js?v=1.6.2";
import { listHistory } from "./store.js?v=1.6.2";
import { speak } from "./speech.js?v=1.6.2";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => RM.matches;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shown = (el) => !!el && !el.classList.contains("hidden") && !el.closest(".hidden");
const watch = (el, opts, fn) => { if (el) new MutationObserver(fn).observe(el, opts); };
// 彈簧曲線：支援 CSS linear() 就用真正的阻尼彈簧（衝過頭一點再落定），否則退回 cubic-bezier。
const HAS_LINEAR = !!window.CSS?.supports?.("transition-timing-function", "linear(0, 1)");
const SPRING = HAS_LINEAR
  ? "linear(0, 0.029, 0.105, 0.213, 0.338, 0.47, 0.599, 0.719, 0.826, 0.916, 0.989, 1.045, 1.085, 1.11, 1.123, 1.126, 1.122, 1.111, 1.097, 1.081, 1.064, 1.048, 1.033, 1.02, 1.009, 1, 0.993, 0.989, 0.986, 0.984, 0.984, 0.985, 0.986, 0.988, 0.99, 0.992, 0.994, 0.996, 0.998, 0.999, 1)"
  : "cubic-bezier(.34,1.45,.64,1)";
const lerp = (a, b, k) => a + (b - a) * k;

// 分頁的前後順序：決定轉場從左邊還是右邊滑進來（往後的分頁從右邊進來，像翻頁）。
const ORDER = ["home", "compose", "rehab", "aac", "report", "history", "settings"];

/* ───────────── 導覽：滑動指示器＋轉場方向 ───────────── */
function setupNav() {
  const nav = $("nav.tabs");
  if (!nav) return;
  const ink = document.createElement("span");
  ink.className = "tab-ink";
  ink.setAttribute("aria-hidden", "true");
  nav.prepend(ink);
  nav.classList.add("has-ink");

  // 指示器的大小跟著版面走：手機底部列是圖示後面的小膠囊，桌面側欄是整列。
  // 由 CSS 的 --ink-target 決定，JS 不必知道現在是哪一種版面。
  // 液體般的移動：前緣先衝出去、後緣慢一拍跟上（中途拉長、橫向被擠扁一點），
  // 到站時用彈簧曲線回彈成原本的膠囊。只動這一顆小小的絕對定位元素，不影響版面。
  let last = null;
  const box = (b) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });
  const liquid = (p, n) => {
    const horiz = Math.abs(n.x - p.x) >= Math.abs(n.y - p.y);
    const LEAD = 0.72, TRAIL = 0.32;
    const m = {};
    if (horiz) {
      const fwd = n.x > p.x;
      const L = lerp(p.x, n.x, fwd ? TRAIL : LEAD), R = lerp(p.x + p.w, n.x + n.w, fwd ? LEAD : TRAIL);
      const ch = lerp(p.h, n.h, 0.5), sq = ch < 80 ? 0.82 : 0.94;
      Object.assign(m, { x: L, w: R - L, h: ch * sq, y: lerp(p.y + p.h / 2, n.y + n.h / 2, 0.5) - (ch * sq) / 2 });
    } else {
      const fwd = n.y > p.y;
      const T = lerp(p.y, n.y, fwd ? TRAIL : LEAD), B = lerp(p.y + p.h, n.y + n.h, fwd ? LEAD : TRAIL);
      const cw = lerp(p.w, n.w, 0.5), sq = cw < 80 ? 0.82 : 0.95;
      Object.assign(m, { y: T, h: B - T, w: cw * sq, x: lerp(p.x + p.w / 2, n.x + n.w / 2, 0.5) - (cw * sq) / 2 });
    }
    const dist = Math.hypot(n.x - p.x, n.y - p.y);
    ink.animate([
      { ...box(p), easing: "cubic-bezier(.4,0,.7,1)" },
      { ...box(m), offset: 0.34, easing: SPRING },
      box(n),
    ], { duration: Math.round(620 + Math.min(260, dist * 0.5)) });
  };
  const place = (animate = true) => {
    const a = nav.querySelector(".tab.active");
    if (!a || !a.offsetParent) { ink.style.opacity = "0"; last = null; return; }
    const useIcon = getComputedStyle(nav).getPropertyValue("--ink-target").trim() === "icon";
    const target = (useIcon && a.querySelector(".tab-ico")) || a;
    const nr = nav.getBoundingClientRect(), r = target.getBoundingClientRect();
    const next = { x: r.left - nr.left - nav.clientLeft, y: r.top - nr.top - nav.clientTop, w: r.width, h: r.height };
    const prev = last, wasShown = ink.style.opacity === "1";
    // 同一次切換會被每顆分頁的 MutationObserver 各叫一次：位置沒變就別打斷正在跑的液體動畫
    if (prev && wasShown && ["x", "y", "w", "h"].every((k) => Math.abs(prev[k] - next[k]) < 0.5)) return;
    last = next;
    ink.getAnimations?.().forEach((x) => x.cancel());
    if (!animate || !wasShown) ink.classList.add("no-anim");
    Object.assign(ink.style, box(next));
    ink.style.opacity = "1";
    void ink.offsetWidth;
    ink.classList.remove("no-anim");
    if (!animate || !wasShown || !prev || reduced() || !ink.animate) return;
    if (Math.abs(next.x - prev.x) < 1 && Math.abs(next.y - prev.y) < 1) return;
    liquid(prev, next);
  };
  // 選中的圖示小跳一下：往上彈、落下時微微壓扁、再回原形（約半秒）
  const hop = (tab) => {
    const ico = tab?.querySelector(".ico");
    if (!ico || reduced() || !ico.animate) return;
    ico.animate([
      { transform: "none" },
      { transform: "translateY(-5px) scale(1.16)", offset: 0.32 },
      { transform: "translateY(1px) scale(1.04, .92)", offset: 0.62 },
      { transform: "none" },
    ], { duration: 560, easing: "cubic-bezier(.3,.6,.4,1)" });
  };

  let cur = $(".tab.active")?.dataset.tab || "home";
  document.body.dataset.tab = cur;
  const onChange = () => {
    const next = $(".tab.active")?.dataset.tab;
    if (!next || next === cur) { place(); return; }
    const dir = Math.sign(ORDER.indexOf(next) - ORDER.indexOf(cur));
    const main = $("main");
    if (main) main.style.setProperty("--dx", reduced() ? "0px" : `${dir * 18}px`);
    cur = next;
    document.body.dataset.tab = next;
    place();
    hop($(".tab.active"));
    if (next === "report") rollStats(true);
    if (next === "home") renderHome();
    // 換頁回到頂端：長輩在新的一頁找不到開頭，是最常見的「迷路」。
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  $$(".tab").forEach((tab) => watch(tab, { attributes: true, attributeFilter: ["class"] }, onChange));
  addEventListener("resize", () => place(false));
  document.fonts?.ready.then(() => place(false));
  watch(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-style"] }, () => requestAnimationFrame(() => place(false)));
  watch($("#app"), { attributes: true, attributeFilter: ["class"] }, () => { requestAnimationFrame(() => place(false)); if (shown($("#app"))) renderHome(); });
  requestAnimationFrame(() => place(false));
}

/* ───────────── 首頁：問候、功能卡入口、最近說過的話 ───────────── */
function greet() {
  const el = $("#homeGreet");
  if (!el) return;
  const h = new Date().getHours();
  const key = h < 11 ? "home.morning" : h < 18 ? "home.afternoon" : "home.evening";
  el.dataset.i18n = key;          // 切換語言時 applyI18n 會用這個鍵重翻
  const v = t(key);
  if (v && v !== key) el.textContent = v;
}

// 空狀態插畫：一條暖黃絲線串著三顆還沒有字的「碎詞」——跟 logo 同一個意象。
const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 160 70" aria-hidden="true">
  <path class="ea-thread" d="M6 50 C 36 18, 60 64, 86 40 S 132 14, 154 34" pathLength="1"/>
  <rect x="22" y="22" width="30" height="20" rx="10"/><rect x="66" y="34" width="34" height="20" rx="10"/><rect x="112" y="14" width="28" height="20" rx="10"/></svg>`;

let _homeSeq = 0;
async function renderHome() {
  greet();
  const box = $("#homeRecent");
  if (!box) return;
  const seq = ++_homeSeq;
  let list = [];
  try { list = (await listHistory()) || []; } catch { list = []; }
  if (seq !== _homeSeq) return;                 // 連續觸發時只畫最後一次
  list = list.filter((h) => h && h.reconstructed).slice(0, 4);
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">${EMPTY_ART}<p>${esc(t("home.recentEmpty"))}</p></div>`;
    return;
  }
  box.innerHTML = list.map((h, i) => `<button type="button" class="recent-item" data-i="${i}">
      <span class="ri-text">${esc(h.reconstructed)}</span><span class="ri-play" aria-hidden="true">🔊</span></button>`).join("");
  $$(".recent-item", box).forEach((b) => b.addEventListener("click", () => speak(list[+b.dataset.i].reconstructed)));
}

function setupHome() {
  // 功能卡與「開始說話」：等同按對應的分頁（走 app.js 原本的切換邏輯）。
  document.addEventListener("click", (e) => {
    const g = e.target.closest?.("[data-go]");
    if (!g) return;
    $(`.tab[data-tab="${g.dataset.go}"]`)?.click();
    const sub = g.dataset.goSet;
    if (sub) setTimeout(() => $(`#settingsIndex .setrow[data-setkey="${sub}"]`)?.click(), 30);
  });
  greet();
  watch(document.documentElement, { attributes: true, attributeFilter: ["lang"] }, () => { if (shown($("#tab-home"))) renderHome(); });
}

/* ───────────── 重組：步驟條、織句載入動畫、候選句依序浮現 ───────────── */
function splitFragments(raw) {
  let parts = String(raw || "").split(/[\s,，、。.!?！？;；]+/).filter(Boolean);
  // 中文常常不打空格：一整串就兩個字一組切開，看起來才像「一個個碎詞」
  if (parts.length === 1 && parts[0].length > 4) parts = parts[0].match(/.{1,2}/gu) || parts;
  return parts.slice(0, 6).map((p) => (p.length > 8 ? p.slice(0, 8) + "…" : p));
}

function weaveLoader(words) {
  const el = document.createElement("div");
  el.className = "weave";
  el.setAttribute("aria-hidden", "true");      // 按鈕文字「重組中…」已經告訴讀屏了
  const n = words.length;
  el.innerHTML = `<div class="weave-words">${words.map((w, i) => {
    // 散落的位置：左右交錯、上下錯開，旋轉一點點——像被撒在桌上的字卡
    const x = Math.round((i - (n - 1) / 2) * -14 + (i % 2 ? 10 : -10));
    const y = (i % 3 === 0 ? -22 : i % 3 === 1 ? 18 : -8);
    const r = (i % 2 ? 1 : -1) * (6 + (i * 5) % 9);
    return `<span class="weave-word" style="--i:${i};--x:${x}px;--y:${y}px;--r:${r}deg">${esc(w)}</span>`;
  }).join("")}</div>
  <svg class="weave-thread" viewBox="0 0 300 22" preserveAspectRatio="none"><path pathLength="1" d="M4 12 C 40 2, 70 22, 110 12 S 180 2, 220 12 S 280 22, 296 12"/></svg>`;
  return el;
}

function setupCompose() {
  const panel = $("#tab-compose"), btn = $("#btnCompose"), frag = $("#fragments");
  const result = $("#result"), confirm = $("#confirmDlg"), alt = $("#altList"), text = $("#resultText");
  if (!panel || !btn) return;

  const STAGES = ["input", "context", "pick", "confirm"];
  const stage = () => {
    let s = "input";
    if (frag && frag.value.trim()) s = "context";
    if (shown(result) && panel.contains(result)) s = "pick";
    if (shown(confirm) && panel.contains(confirm)) s = "confirm";
    const k = STAGES.indexOf(s);
    panel.dataset.stage = s;
    $$(".stepper li", panel).forEach((li) => {
      const i = STAGES.indexOf(li.dataset.stage);
      li.classList.toggle("is-done", i < k);
      li.classList.toggle("is-current", i === k);
    });
  };
  frag?.addEventListener("input", stage);
  watch(result, { attributes: true, attributeFilter: ["class"] }, stage);
  watch(confirm, { attributes: true, attributeFilter: ["class"] }, stage);
  stage();

  let loader = null, before = "";
  watch(btn, { attributes: true, attributeFilter: ["disabled"] }, () => {
    if (btn.disabled) {
      before = text?.textContent || "";
      btn.classList.add("is-busy");
      const words = splitFragments(frag?.value);
      if (words.length && !loader) {
        loader = weaveLoader(words); btn.after(loader);
        loader.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" });   // 動畫在畫面外就等於沒有
      }
      return;
    }
    btn.classList.remove("is-busy");
    if (loader) {
      const l = loader; loader = null;
      if (reduced()) l.remove();
      else { l.classList.add("out"); setTimeout(() => l.remove(), 240); }
    }
    // 只有真的組出新句子才播「織好了」：失敗時結果卡沒有變，不該假裝有東西出來。
    if (!shown(result) || (text?.textContent || "") === before) return;
    result.classList.remove("just-woven"); text.classList.remove("weave-in"); alt?.classList.remove("alt-enter");
    void result.offsetWidth;
    result.classList.add("just-woven"); text.classList.add("weave-in"); alt?.classList.add("alt-enter");
    // 動畫播完就拿掉：之後點選候選句會整批重畫，不能每點一下就再浮現一次
    setTimeout(() => { result.classList.remove("just-woven"); text.classList.remove("weave-in"); alt?.classList.remove("alt-enter"); }, 1400);
    // 把視線帶到結果：結果卡在下面、手機上常常在畫面外
    const r = result.getBoundingClientRect();
    if (r.top > innerHeight * 0.7) result.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  });
}

/* ───────────── 錄音中的聲波 ───────────── */
function setupRecording() {
  const sync = (b) => {
    const on = b.classList.contains("recording");
    const w = $(".rec-wave", b);
    if (on && !w) b.insertAdjacentHTML("beforeend", `<span class="rec-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`);
    if (!on && w) w.remove();
  };
  watch(document.body, { attributes: true, attributeFilter: ["class"], subtree: true }, (ms) => {
    for (const m of ms) if (m.target.classList?.contains("btn")) sync(m.target);
  });
}

/* ───────────── 復健分數：數字滾動＋進度環 ───────────── */
function animateScore(box) {
  const num = $(".score-num", box);
  if (!num || num.closest(".score-ring")) return;
  const score = Math.max(0, Math.min(100, parseInt(num.textContent, 10) || 0));
  const ring = document.createElement("div");
  ring.className = "score-ring";
  ring.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="sr-track" cx="32" cy="32" r="27"/><circle class="sr-bar" cx="32" cy="32" r="27" pathLength="100"/></svg>`;
  num.replaceWith(ring);
  ring.appendChild(num);
  const bar = $(".sr-bar", ring);
  if (reduced()) { bar.style.strokeDashoffset = String(100 - score); return; }
  num.textContent = "0";
  const t0 = performance.now(), D = 1100;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);   // easeOutCubic：先快後慢，停得穩
    num.textContent = String(Math.round(score * e));
    bar.style.strokeDashoffset = String(100 - score * e);
    if (p < 1) requestAnimationFrame(step);
  };
  setTimeout(() => requestAnimationFrame(step), 220);   // 等卡片彈出來再開始滾
}
function setupScore() {
  const area = $("#rehabScore");
  watch(area, { childList: true }, () => { const b = $(".scorebox", area); if (b) animateScore(b); });
}

/* ───────────── 圖卡：點擊漣漪＋句子條新詞彈入 ───────────── */
function setupAac() {
  document.addEventListener("pointerdown", (e) => {
    const card = e.target.closest?.(".acard");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const s = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement("span");
    dot.className = "tap-ripple";
    dot.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${s}px;height:${s}px`;
    card.appendChild(dot);
    const kf = reduced() ? [{ opacity: 0.5 }, { opacity: 0 }]
                         : [{ transform: "translate(-50%,-50%) scale(0)", opacity: 0.6 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }];
    const a = dot.animate(kf, { duration: 560, easing: "cubic-bezier(.22,1,.36,1)" });
    a.onfinish = () => dot.remove();
  }, { passive: true });

  const combo = $("#aacCombo");
  let count = 0;
  watch(combo, { childList: true }, () => {
    const chips = $$(".chip", combo);
    if (chips.length > count && chips.length) {
      const last = chips[chips.length - 1];
      last.animate(reduced() ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "translateY(-14px) scale(.7)" }, { opacity: 1, transform: "none" }],
        { duration: 420, easing: "cubic-bezier(.34,1.45,.64,1)" });
    }
    count = chips.length;
  });
}

/* ───────────── 危機視窗：「吸氣／吐氣」字樣淡入 ───────────── */
function setupCrisis() {
  const lbl = $("#crisisBreath");
  watch(lbl, { childList: true, characterData: true, subtree: true }, () => {
    lbl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: "ease-out" });
  });
}

/* ───────────── 液態玻璃：Chromium 的折射濾鏡 ─────────────
   backdrop-filter: url(#svg) 目前只有 Chromium 會真的套用；Safari／Firefox 會讓整條宣告失效
   （連模糊都沒了），所以不能靠 @supports 判斷，改成偵測 Chromium 後才加 html.lg-refract。
   減少透明度時不加（CSS 那邊也會把玻璃換成實色）。 */
function setupGlass() {
  const isChromium = !!navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand));
  if (!isChromium) return;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  // 低頻雜訊先模糊成平滑的起伏，再拿去推擠背景像素：效果是「隔著一片有點厚度的玻璃」的輕微扭曲，不是水波。
  host.innerHTML = `<svg width="0" height="0" focusable="false"><filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.016" numOctaves="2" seed="11" result="noise"/>
    <feGaussianBlur in="noise" stdDeviation="2.5" result="soft"/>
    <feDisplacementMap in="SourceGraphic" in2="soft" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
  document.body.appendChild(host);
  const RT = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const sync = () => document.documentElement.classList.toggle("lg-refract", !RT.matches);
  sync();
  RT.addEventListener?.("change", sync);
}

/* ───────────── 首頁功能卡：懸停時微微 3D 傾斜＋光澤跟著游標 ─────────────
   只在「有滑鼠」的裝置（hover:hover 且 pointer:fine）而且沒開減少動態時才做；
   觸控裝置完全不碰（手指按下去卡片在動，長輩會以為按錯了）。 */
function setupTilt() {
  const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
  const MAX = 6;   // 最多傾斜 6 度：看得出立體，又不會讓字變形難讀
  let cur = null;
  const reset = (c) => {
    if (!c) return;
    c.classList.remove("is-tilt");
    c.style.removeProperty("--rx"); c.style.removeProperty("--ry");
  };
  document.addEventListener("pointermove", (e) => {
    const card = (e.pointerType === "mouse" && FINE.matches && !reduced()) ? e.target.closest?.(".feat") : null;
    if (card !== cur) { reset(cur); cur = card; }
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    card.classList.add("is-tilt");
    card.style.setProperty("--ry", `${((px - 0.5) * 2 * MAX).toFixed(2)}deg`);
    card.style.setProperty("--rx", `${((0.5 - py) * 2 * MAX).toFixed(2)}deg`);
    card.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    card.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  }, { passive: true });
  document.addEventListener("pointerleave", () => { reset(cur); cur = null; });
  document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { reset(cur); cur = null; } }, { passive: true });
}

/* ───────────── 報表數字：從舊值滾到新值 ─────────────
   不改元素的文字（讀屏、測試、匯出讀到的永遠是最終值），只在 CSS 的 ::after 疊一層滾動中的數字。
   只處理整數（含單位，如「12 天」）；小數、「—」直接顯示。 */
const _rollPrev = new WeakMap();
const parseRoll = (s) => { const m = String(s ?? "").trim().match(/^(-?\d{1,7})(\D{0,6})$/); return m ? { n: +m[1], suf: m[2] } : null; };
function roll(el, from, to) {
  if (reduced() || from.n === to.n) return;
  el.style.setProperty("--roll-from", String(from.n));
  el.style.setProperty("--roll", String(to.n));
  el.dataset.suffix = to.suf;
  el.classList.remove("rolling"); void el.offsetWidth; el.classList.add("rolling");
}
function rollStats(fromZero = false) {
  // 換到報表頁時：等報表畫完（report.js 是非同步讀資料）再從 0 滾上來
  setTimeout(() => $$(".stat-val").forEach((el) => {
    const v = parseRoll(el.textContent);
    if (v && shown(el)) roll(el, fromZero ? { n: 0 } : (_rollPrev.get(el) || { n: 0 }), v);
  }), 260);
}
function setupRoll() {
  $$(".stat-val").forEach((el) => {
    _rollPrev.set(el, parseRoll(el.textContent));
    watch(el, { childList: true, characterData: true, subtree: true }, () => {
      const v = parseRoll(el.textContent), old = _rollPrev.get(el);
      _rollPrev.set(el, v);
      if (v && shown(el)) roll(el, old || { n: 0 }, v);
    });
    el.addEventListener("animationend", (e) => { if (e.animationName === "roll-up") el.classList.remove("rolling"); });
  });
}

function init() {
  for (const f of [setupNav, setupHome, setupCompose, setupRecording, setupScore, setupAac, setupCrisis, setupGlass, setupTilt, setupRoll]) {
    try { f(); } catch (e) { console.warn("[ui]", f.name, e); }
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
