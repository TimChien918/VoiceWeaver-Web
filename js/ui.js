// 版面互動與「有意義的動畫」：導覽列的滑動指示器、分頁轉場方向、首頁（問候、功能卡、最近說過的話）、
// 重組的步驟條與「把碎詞拾起、織成句子」載入動畫、候選句依序浮現、錄音聲波、復健分數滾動與進度環、
// 圖卡點擊漣漪、危機視窗呼吸字樣淡入淡出。
//
// 設計原則：這支只「看」DOM（MutationObserver），不改任何狀態、不攔任何事件——
// 功能邏輯全在 app.js 等原本的模組裡。所以它壞掉或被拿掉，App 照樣能用，只是少了動畫。
// 減少動態（prefers-reduced-motion）時，所有位移／縮放改成單純淡入。
import { t } from "./i18n.js?v=1.6.0";
import { listHistory } from "./store.js?v=1.6.0";
import { speak } from "./speech.js?v=1.6.0";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => RM.matches;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shown = (el) => !!el && !el.classList.contains("hidden") && !el.closest(".hidden");
const watch = (el, opts, fn) => { if (el) new MutationObserver(fn).observe(el, opts); };

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
  const place = (animate = true) => {
    const a = nav.querySelector(".tab.active");
    if (!a || !a.offsetParent) { ink.style.opacity = "0"; return; }
    const useIcon = getComputedStyle(nav).getPropertyValue("--ink-target").trim() === "icon";
    const target = (useIcon && a.querySelector(".tab-ico")) || a;
    const nr = nav.getBoundingClientRect(), r = target.getBoundingClientRect();
    if (!animate || ink.style.opacity !== "1") ink.classList.add("no-anim");
    ink.style.width = r.width + "px";
    ink.style.height = r.height + "px";
    ink.style.transform = `translate(${r.left - nr.left - nav.clientLeft}px, ${r.top - nr.top - nav.clientTop}px)`;
    ink.style.opacity = "1";
    void ink.offsetWidth;
    ink.classList.remove("no-anim");
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

function init() {
  for (const f of [setupNav, setupHome, setupCompose, setupRecording, setupScore, setupAac, setupCrisis]) {
    try { f(); } catch (e) { console.warn("[ui]", f.name, e); }
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
