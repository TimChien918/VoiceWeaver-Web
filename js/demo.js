// 一鍵自動演示 ＋ 螢幕錄影（做簡報／報告用）。
//
// 設計上的三個硬性決定：
//
// ① **腳本化，不打任何外部請求。** 演示要能重播一百次都長一樣，而且不能在錄影
//    途中被 LLM 逾時、金鑰過期、網路抖動毀掉。所以畫面用的是真的元件、真的版面，
//    只有 AI 的回覆是預先寫好的樣本。更重要的是：緊急通報、危機介入這兩段**絕對
//    不能真的送出去**——演示一次就吵到家人一次。危機那一段是照著真畫面重演的。
// ② **不寫入任何資料。** 不呼叫 save()、不寫歷史、不碰 Firestore/Drive。
//    只改記憶體裡的 state，結束時還原。
// ③ **字幕與旁白一律英文**（報告用途）。旁白走電腦端 GPT-SoVITS；連不上才退回
//    瀏覽器語音——寧可音色差一點，也不能錄到一半沒有聲音。
import { state } from "./store.js?v=1.5.62";
import { speak } from "./speech.js?v=1.5.62";
import { applyI18n, t } from "./i18n.js?v=1.5.62";
import { localSynth, localVoices, detectLocalTts } from "./localtts.js?v=1.5.62";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每一步的最短停留時間。沒有這個下限，動作做完就立刻跳下一步——
// 十六個單元六十幾步會在一分鐘內衝完，觀眾連畫面變了什麼都看不清楚。
// 有旁白時通常是旁白比較長（下限很少生效）；純演示時它就是實際節奏。
const MIN_STEP_NARRATED = 3200;
const MIN_STEP_SILENT = 4200;
// 旁白唸完之後畫面再多停一下才換。零間隔看起來像「話還沒講完就跳掉」——
// 最後一個字的尾音、加上讀完字幕需要的一點時間，都落在這一段。
const TAIL_PAD = 900;

// 演示進行中的旗標。extras.js 的 Telegram 出口會讀它擋下所有外送。
export function demoRunning() { return !!window.__VW_DEMO__; }

// 「同一時間只准一個聲音」。畫面動作與旁白是並行跑的（畫面才不會等旁白講完
// 才動），但**聲音不能並行**——示範發聲會直接疊在旁白上，變成兩個人同時講話。
// 用一條 promise 鏈當發言權：後來的要等前一個放開。
let _audioChain = Promise.resolve();
function withAudioFloor(fn) {
  const next = _audioChain.then(fn, fn);
  _audioChain = next.catch(() => {});
  return next;
}

let _abort = false;          // 使用者按了 Stop
let _narrate = true;         // 旁白模式
let _voice = null;           // 旁白用的 EN 角色語音 {name, lang}
let _speakVoice = null;      // 示範發聲用的 EN 角色（花火），與旁白刻意不同
let _rec = null, _chunks = [], _recStream = null;
// 無聲版（同一次錄影的第二個輸出）
let _recSilent = null, _chunksSilent = [];

// ── 演示單元 ────────────────────────────────────────────────────────────
// 每個單元是獨立的一段，使用者自己勾。step.cap＝字幕/旁白，step.act＝畫面動作。
// est 是純演示（無旁白）的估計秒數；有旁白會更長，由語音長度決定。

function UNITS() {
  return [
    {
      id: "intro", icon: "🎬", title: "Title & overview", est: 12,
      steps: [
        { cap: "Aphasia damages the route from thought to speech, while the thought itself stays intact.", act: () => titleCard("VoiceWeaver", "How it works — browser build") },
        { cap: "This is the browser build — no install, no account required, running entirely on this page.", act: () => titleSub("No install · runs in the browser") },
        { cap: "Here is how each part of it works.", act: hideTitle },
      ],
    },
    {
      id: "compose", icon: "💬", title: "Sentence reconstruction", est: 31,
      steps: [
        { cap: "Input arrives as isolated content words, with the grammar missing.", act: () => goTab("compose"), focus: "#fragments" },
        { cap: "Typing, dictation, or a photograph all feed the same buffer.", act: () => typeInto("#fragments", "water  rest  now"), focus: "#fragments" },
        { cap: "A language model reconstructs the sentence, constrained by a defensive prompt.", act: async () => { await press("#btnCompose"); await reconstructWait(); }, focus: "#btnCompose" },
        { cap: "Self-consistency sampling returns three candidates rather than one best guess.", act: showCandidates, hold: 1600, focus: "#altList" },
        { cap: "Which candidate gets accepted is logged, and feeds the ranking of later phrasings.", act: pickCandidateDemo, hold: 1200, focus: "#altList" },
        // 確認卡**不是**每一句都會出現：它只擋 classifyRisk() 的 "confirm" 等級
        // （醫療／疼痛），而且可以在設定裡關掉（state.settings.confirmCard，預設開）。
        // "normal" 的日常需求是直接唸出來的。這兩句原本寫成「沒有一句話未經確認就被唸出」
        // ——那等於對外承諾每一句都要人工確認，實作並非如此。
        // 註：showConfirm() 是演示強制叫出這張卡，樣本句本身其實是 "normal"。
        { cap: "Medical or pain-related content raises a confirmation card before anything is spoken.", act: showConfirm, hold: 1600 },
        { cap: "Confirming sends it to the synthesiser; everyday requests are spoken directly.", act: confirmYes, focus: "#result" },
      ],
    },
    {
      id: "aac", icon: "🖼", title: "Picture cards (AAC)", est: 24,
      steps: [
        { cap: "For users with no reliable text output, the board replaces the keyboard entirely.", act: () => goTab("aac") },
        { cap: "Colours follow the Fitzgerald Key: yellow nouns, green verbs, blue adjectives.", hold: 1400, focus: "#aacCats" },
        { cap: "Selections accumulate in a buffer instead of firing one word at a time.", act: aacPickDemo },
        { cap: "The buffer can be spoken verbatim, or passed through the same reconstruction step.", hold: 1200, focus: "#aacCompose" },
        { cap: "Card size has four steps; the grid drops to two columns, then one, as the type grows.", act: aacScaleDemo },
      ],
    },
    {
      id: "customcards", icon: "📷", title: "Custom photo cards", est: 14,
      steps: [
        { cap: "Symbol sets are drawn for an average user, which is nobody in particular.", act: () => scrollTo("#ccList") },
        { cap: "Photographs taken by the family become cards, downscaled and stored in the account.", act: () => typeInto("#ccWord", "my grandson"), focus: "#ccWord" },
        { cap: "Recognition of familiar objects is what makes the board usable at all.", hold: 1400, focus: "#ccAdd" },
      ],
    },
    {
      id: "voice", icon: "🗣", title: "Personal voice (GPT-SoVITS)", est: 22,
      steps: [
        { cap: "Voice identity is usually lost along with speech, and rarely addressed.", act: () => goSetting("voice") },
        { cap: "A GPT-SoVITS model is trained from a few minutes of audio recorded before onset.", act: () => captionOnly() },
        { cap: "Weights live in the user's own Google Drive; synthesis runs on their own computer.", act: () => captionOnly() },
        // 這一段整段都在講「這是他自己的聲音」，所以一定要真的用 GPT-SoVITS 唸一句。
        // 用旁白的角色等於自己打自己的臉，用瀏覽器機器音更糟——那是在示範這個功能不存在。
        { cap: "Emotion is selected per sentence by choosing a matching reference clip.", act: () => speakInOwnVoice(SAMPLE.candidates[0]), hold: 1200 },
      ],
    },
    {
      id: "rehab", icon: "🏥", title: "Speech rehabilitation", est: 22,
      steps: [
        { cap: "Alongside communication, the same data supports structured rehabilitation.", act: () => goTab("rehab") },
        { cap: "The phrase bank is bundled, so practice works with no network and no key.", hold: 1400, focus: "#rehabBank" },
        { cap: "The target is spoken, repeated back, and compared.", act: rehabDemo, hold: 1200 },
        // 評分不是逐音節比對——那正是這個專案刻意不做的（llm.js 的 AI 評分看的是
        // 語意／流暢／語氣，字元重疊率只是沒金鑰時的退路）。高亮錯字才是真的。
        { cap: "Scoring is on meaning, fluency and tone, with mis-pronounced characters highlighted.", act: rehabScore, hold: 1800 },
      ],
    },
    {
      id: "story", icon: "📖", title: "Picture storytelling", est: 16,
      steps: [
        { cap: "Repetition tasks plateau quickly for milder presentations.", act: () => scrollTo("#storyFrames") },
        { cap: "Sequenced picture description requires the user to build the discourse themselves.", hold: 1400, focus: "#storyFrames" },
        { cap: "Feedback is graded on content, order and causality rather than on wording.", act: storyFeedback, hold: 1800 },
      ],
    },
    {
      id: "report", icon: "📊", title: "Progress report", est: 20,
      steps: [
        { cap: "All of the above is instrumented, without asking the user to record anything.", act: () => goTab("report") },
        { cap: "Session count, mean score, streak, and proportion of positive vocabulary.", hold: 1600, focus: ".stats" },
        { cap: "Reaction time, first-candidate acceptance and undo rate act as coping indicators.", act: () => scrollTo("#bmReaction"), hold: 1600 },
        { cap: "Exports as CSV or PDF for the treating clinician.", hold: 1400, focus: "#reportCsv" },
      ],
    },
    {
      id: "history", icon: "🕘", title: "History", est: 10,
      steps: [
        { cap: "Every produced sentence is retained with its context and confidence.", act: () => goTab("history") },
        { cap: "Frequently reused sentences are promoted to one-tap shortcuts.", act: () => captionOnly(), hold: 1400 },
      ],
    },
    {
      id: "crisis", icon: "🆘", title: "Crisis intervention", est: 22,
      steps: [
        { cap: "Post-stroke depression is common, and language loss is an independent risk factor.", act: () => goTab("compose") },
        { cap: "Every candidate sentence passes a risk classifier before synthesis.", act: () => captionOnly() },
        { cap: "A positive result blocks output — but blocking alone would leave the user stranded.", act: crisisMock, hold: 1800 },
        { cap: "So the interface changes: paced breathing, minimal controls, family contacted automatically.", hold: 2000, focus: "#crisisOrb" },
        { cap: "Dismissal requires the contact to respond.", act: crisisClose, hold: 1200 },
      ],
    },
    {
      id: "kiosk", icon: "🔒", title: "Severe mode (locked board)", est: 18,
      steps: [
        { cap: "At the severe end, even a grid presents too many simultaneous choices.", act: () => goTab("aac") },
        { cap: "Single-card scanning reduces the task to one yes-or-no decision at a time.", act: kioskMock, hold: 2600 },
        { cap: "Accepted cards accumulate as a trail, which a familiar listener can interpret.", act: kioskTrail, hold: 1800 },
        { cap: "Exit is PIN-gated so the device cannot be navigated away from accidentally.", act: kioskPin, hold: 1800 },
        { cap: "", act: kioskClose },
      ],
    },
    {
      id: "sos", icon: "🚨", title: "Emergency SOS", est: 14,
      steps: [
        { cap: "Composition latency is unacceptable in an emergency.", act: () => goTab("compose"), focus: "#quickSos" },
        { cap: "Fixed phrases are therefore pinned above every screen, independent of the current tab.", hold: 1600, focus: "#quickSos" },
        { cap: "The alert carries a location link.", hold: 1600, focus: "#btnSos" },
      ],
    },
    {
      id: "a11y", icon: "♿", title: "Accessibility & languages", est: 24,
      steps: [
        { cap: "Hemianopia and age-related low vision are common comorbidities after stroke.", act: () => goTab("settings") },
        { cap: "Type scales across the entire interface, including dialogs and settings.", act: fontScaleDemo, hold: 1400 },
        { cap: "Layouts reflow rather than clip, verified at the largest scale.", hold: 1200 },
        { cap: "The interface ships in Traditional Chinese, English, Japanese and Korean.", act: () => langDemo("ja-JP"), hold: 1800 },
        { cap: "Synthesis follows the interface language, using the same speaker across all four.", act: () => langDemo("ko-KR"), hold: 1800 },
        { cap: "", act: () => langDemo(null) },
      ],
    },
    {
      id: "learning", icon: "🧠", title: "It learns this person", est: 22,
      steps: [
        { cap: "Aphasia presentation varies widely, so static defaults serve almost nobody well.", act: () => goTab("aac") },
        { cap: "Card ranking combines frequency, time decay, and situational context.", act: () => spotSel("#aacFeedWrap") || spotSel("#aacCats"), hold: 1600 },
        { cap: "Accepted candidates feed back into phrasing preference over time.", hold: 1400 },
        { cap: "Acoustic templates, card set and voice model all remain specific to one user.", hold: 1400 },
      ],
    },
    {
      id: "cloud", icon: "☁️", title: "Cloud sync", est: 14,
      steps: [
        { cap: "Phone, browser and desktop share a single account.", act: () => goSetting("cloud") },
        { cap: "Voice models are stored in the user's own Drive; there is no developer-side storage.", act: () => captionOnly() },
        { cap: "No user content is transmitted to any server operated by this project.", act: () => captionOnly() },
      ],
    },
    {
      id: "outro", icon: "🏁", title: "Closing card", est: 8,
      steps: [
        { cap: "Aphasia damages language. It does not damage the person underneath it.", act: () => titleCard("VoiceWeaver", "Aphasia communication · rehabilitation · safety") },
        { cap: "", act: hideTitle },
      ],
    },
  ];
}

// ── 覆蓋層（字幕、標題卡、聚光燈、進度）─────────────────────────────────

function ui() { return $("#demoOverlay"); }

function buildOverlay() {
  if (ui()) return;
  const el = document.createElement("div");
  el.id = "demoOverlay";
  el.className = "demo-overlay hidden";
  el.innerHTML = `
    <div id="demoTitleCard" class="demo-titlecard hidden">
      <div id="demoTitleMain"></div>
      <div id="demoTitleSub"></div>
    </div>
    <div class="demo-hud" id="demoHud">
      <span id="demoProgress" class="demo-progress"></span>
      <button id="demoStop" class="demo-stop" type="button"></button>
    </div>
    <div id="demoPrep" class="demo-prep hidden">
      <div class="demo-prep-title" id="demoPrepTitle"></div>
      <div class="demo-prep-bar"><i id="demoPrepFill"></i></div>
      <div id="demoPrepNote" class="demo-prep-note"></div>
    </div>
    <div id="demoCaption" class="demo-caption hidden"></div>`;
  document.body.appendChild(el);
  $("#demoPrepTitle").textContent = t("demo.prep");
  $("#demoStop").textContent = t("demo.stop");
  $("#demoStop").addEventListener("click", () => { _abort = true; });
  // 錄影時畫面上沒有 Stop 鈕 → Esc 當中止出口（看不見，但隨時按得到）
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && window.__VW_DEMO__) _abort = true;
  });
}

function caption(text) {
  const c = $("#demoCaption");
  if (!c) return;
  // 純演示模式不出字幕（使用者要的「另一種只演示」），但進度仍留著，
  // 否則畫面看起來像卡住。
  if (!_narrate || !text) { c.classList.add("hidden"); c.textContent = ""; return; }
  c.textContent = text;
  c.classList.remove("hidden");
}
function captionOnly() { /* 這一步只有字幕，沒有畫面動作 */ }

function progress(txt) { const p = $("#demoProgress"); if (p) p.textContent = txt; }

function titleCard(main, sub) {
  const c = $("#demoTitleCard");
  $("#demoTitleMain").textContent = main;
  $("#demoTitleSub").textContent = sub || "";
  c.classList.remove("hidden");
}
function titleSub(sub) { $("#demoTitleSub").textContent = sub; }
function hideTitle() { $("#demoTitleCard")?.classList.add("hidden"); }

let _spotted = null;
function spot(el) {
  if (_spotted) _spotted.classList.remove("demo-spot");
  _spotted = el || null;
  if (el) {
    el.classList.add("demo-spot");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
function spotSel(sel) { spot($(sel)); }
function scrollTo(sel) { $(sel)?.scrollIntoView({ behavior: "smooth", block: "center" }); }
function clearSpot() { spot(null); }

// 按鈕「被按下去」的視覺回饋。**不觸發真的 click**——演示不做任何有副作用的事。
async function press(sel) {
  const el = $(sel);
  if (!el) return;
  spot(el);
  el.classList.add("demo-press");
  await sleep(220);
  el.classList.remove("demo-press");
}

// 打字機效果：一次貼上看起來像作弊，逐字打出來才看得懂使用者在做什麼。
async function typeInto(sel, text) {
  const el = $(sel);
  if (!el) return;
  spot(el);              // spot() 會 scrollIntoView，輸入框一定看得到
  await sleep(400);      // 但捲動是 smooth 的，不等它停的話前幾個字是在滑動中打的
  el.focus?.();
  el.value = "";
  for (const ch of text) {
    if (_abort) return;
    el.value += ch;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(55);
  }
}

/**
 * 錄影池：保證「這一步在講的東西」真的在畫面上。
 *
 * 以前是每發現一次「旁白在講某個東西、畫面上卻沒有它」就補一次 scrollTo——
 * 補到第三次就該把它變成規則。每一步用 focus 宣告自己在講哪個元素，
 * 開講之前捲出來、亮一下，捲完再量一次位置；真的不在畫面上就留一筆警告，
 * 不要靜靜地錄完一支對不上的影片。
 */
async function ensureVisible(sel, cap) {
  if (!sel) return;                       // 片頭、純解說沒有特定對象
  const el = $(sel);
  if (!el) { console.warn(`[demo] 錄影池：找不到「${sel}」 — 「${(cap||"").slice(0,48)}」`); return; }
  spot(el);                               // spot() 會 scrollIntoView({block:"center"})
  await sleep(FOCUS_SETTLE);              // 等 smooth 捲動停下來再量，否則會誤報
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw &&
                  r.width > 0 && r.height > 0;
  if (!visible) {
    console.warn(`[demo] 錄影池：「${sel}」不在畫面上 — 「${(cap||"").slice(0,48)}」`,
                 { top: Math.round(r.top), bottom: Math.round(r.bottom), viewportH: vh });
  }
}

// 捲動動畫跑完要一點時間。不等就開始講，觀眾看到的是「畫面還在滑」而旁白
// 已經在講那個東西了；而且太早量位置也會誤報。
const FOCUS_SETTLE = 650;

function goTab(name) {
  clearSpot();
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  btn?.click();          // 分頁切換沒有副作用，用真的按
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 設定分頁的子選單：走到某一張卡。key 對應卡片標題裡的關鍵字。
function goSetting(key) {
  goTab("settings");
  // 用卡片上的 data-setkey 找，不要拿標題文字比中文關鍵字：介面切成
  // 英文/日文/韓文之後一個都對不上，而且會靜靜地退回第一張卡——
  // 旁白講發音模型，畫面卻開著文字供應商設定。
  // cloud 指到「我的專屬聲音」，因為那張卡就是 Drive 曲庫，正是接下來兩句在講的東西。
  const want = { voice: "voice", cloud: "voice" }[key] || key;   // acoustic 那張卡已從網頁移除
  const rows = $$("#settingsIndex .setrow");
  const hit = rows.find((r) => r.dataset.setkey === want);
  if (!hit) { console.warn("[demo] 找不到設定卡", key); return; }
  hit.click(); spot(hit);
}

// ── 各單元的腳本內容（樣本資料，不打任何 API）──────────────────────────

const SAMPLE = {
  candidates: ["I would like some water, and I need to rest now.",
               "Can I have water? I want to lie down.",
               "Water please. I am tired."],
  aac: ["💧 water", "🍚 eat", "🛏 rest"],
  rehab: "I would like a glass of water.",
  story: "The AI teacher: good sequence and clear cause and effect. Try to add who the man was speaking to.",
};

// 按下重組之後真的要轉。候選句本身仍是固定樣本（錄影途中被 LLM 逾時或
// 網路一抖毀掉整支影片是不能接受的），但**等待不能假**：用的是真的那顆
// 按鈕的 disabled ＋「重組中…」文字，轉的是真實長度。直接跳出結果會讓
// 觀眾以為這個 App 是即時的。
const RECONSTRUCT_WAIT = 4500;

async function reconstructWait() {
  const btn = $("#btnCompose");
  if (!btn) { await sleep(RECONSTRUCT_WAIT); return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t("btn.composing");
  try { await sleep(RECONSTRUCT_WAIT); }
  finally { btn.disabled = false; btn.textContent = label; }
}

function showCandidates() {
  const res = $("#result"), txt = $("#resultText"), pick = $("#altPick"), list = $("#altList");
  if (!res) return;
  res.classList.remove("hidden");
  if (txt) txt.textContent = SAMPLE.candidates[0];
  // 用跟 renderAlts() 一樣的 class，模擬畫面才會和真的長得一模一樣
  if (list) list.innerHTML = SAMPLE.candidates
    .map((s, i) => `<button class="btn ghost block alt-opt${i === 0 ? " on" : ""}" type="button">${s}</button>`).join("");
  pick?.classList.remove("hidden");
  spot(res);
}

function showConfirm() {
  const dlg = $("#confirmDlg");
  if (!dlg) return;
  $("#confirmEmoji").textContent = "💧";
  $("#confirmText").textContent = SAMPLE.candidates[0];
  dlg.classList.remove("hidden");
  clearSpot();
}
async function confirmYes() {
  await press("#confirmYes");
  $("#confirmDlg")?.classList.add("hidden");
  // **一定要 await。** 不等的話這一句只是被排進發言權佇列，等它真的輪到、
  // 播出來的時候畫面早就換到下一段字幕了——看起來就是「字幕跟講的話對不上」。
  // 等它講完，這一步才算結束。
  await speakDemoSentence(SAMPLE.candidates[0]);
}

/** 在三個候選之間切換給人看，最後回到第一個。 */
async function pickCandidateDemo() {
  const opts = $$("#altList .alt-opt");
  const txt = $("#resultText");
  for (const i of [1, 2, 0]) {
    if (_abort) return;
    opts.forEach((o, j) => o.classList.toggle("on", j === i));
    if (txt && SAMPLE.candidates[i]) txt.textContent = SAMPLE.candidates[i];
    spot(opts[i] || null);
    await sleep(1300);
  }
}

async function aacPickDemo() {
  const combo = $("#aacCombo");
  if (!combo) return;
  combo.innerHTML = "";
  for (const w of SAMPLE.aac) {
    if (_abort) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = w;
    combo.appendChild(chip);
    await sleep(650);
  }
  spot(combo);
}

// 字級是靠 #aacItems 的 aac-s2/3/4 class 換版（s3 兩欄、s4 一欄），不是 CSS 變數。
// 這裡直接換 class，不按真的 chip——按下去會 save() 把字級寫進使用者設定。
async function aacScaleDemo() {
  const grid = $("#aacItems"), chips = $$(".aac-scale-chip");
  const base = _restore.aacGridCls ?? grid?.className;
  for (const s of [2, 4]) {
    if (_abort) break;
    const c = chips.find((x) => +x.dataset.s === s);
    chips.forEach((x) => x.classList.toggle("on", x === c));
    if (grid) grid.className = "cards-grid aac-s" + s;
    if (c) spot(c);
    await sleep(1000);
  }
  await sleep(300);
  if (grid && base) grid.className = base;
  chips.forEach((x) => x.classList.toggle("on", +x.dataset.s === (+state.settings.aacScale || 1)));
}

async function rehabDemo() {
  const card = $("#rehabPractice");
  if (!card) return;
  card.classList.remove("hidden");
  const disp = $("#rehabTargetDisplay");
  if (disp) disp.textContent = SAMPLE.rehab;
  const chips = $("#rehabChips");
  if (chips) chips.innerHTML = SAMPLE.rehab.split(" ")
    .map((w) => `<span class="chip">${w}</span>`).join("");
  spot(card);
  await speakDemoSentence(SAMPLE.rehab);   // 同樣要等講完才前進
}
function rehabScore() {
  const box = $("#rehabScore");
  if (!box) return;
  box.innerHTML = `<div class="scorebox good">
    <div class="score-num">86</div>
    <div class="score-info">
      <div class="score-head">🎉 Well done</div>
      <div class="score-fb">💬 Clear rhythm. “glass” came out soft — try it a little slower.</div>
      <div class="tiny muted">Heard: I would like a glass of water</div>
    </div></div>`;
  spot(box);
}

function storyFeedback() {
  const box = $("#storyFeedback");
  if (!box) return;
  box.classList.remove("hidden");
  const txt = $("#storyFeedbackText");
  if (txt) txt.textContent = SAMPLE.story;
  const sc = $("#storyScore");
  if (sc) sc.textContent = "Score 78 / 100";
  spot(box);
}

// 危機介入：**照著真畫面重演，絕不呼叫 openCrisis()**——那一支會立刻發 Telegram
// 給家人並開鏡頭拍照。演示只把同一個 DOM 填成通報成功的樣子。
function crisisMock() {
  const dlg = $("#crisisDlg");
  if (!dlg) return;
  dlg.classList.remove("hidden");
  const st = $("#crisisStatus");
  if (st) st.textContent = "Family notified · (simulated)";
  const log = $("#crisisLog");
  if (log) log.innerHTML = `
    <div class="crisis-msg">Your family has been notified.</div>
    <div class="crisis-msg">You can start a video call at any time.</div>
    <div class="crisis-msg family">👪 I am on my way. Stay with me.</div>`;
  const quick = $("#crisisQuick");
  if (quick) quick.innerHTML = ["I am scared", "Please come", "I am safe"]
    .map((s) => `<span class="chip">${s}</span>`).join("");
  clearSpot();
}
function crisisClose() {
  $("#crisisDlg")?.classList.add("hidden");
  const st = $("#crisisStatus"); if (st) st.textContent = "";
  const log = $("#crisisLog"); if (log) log.innerHTML = "";
  const quick = $("#crisisQuick"); if (quick) quick.innerHTML = "";
}

// 重度模式：不呼叫 enterKiosk()（它會要全螢幕與 wake lock，錄影時切全螢幕會讓
// 畫面跳掉）。直接顯示同一塊板子。
function kioskMock() {
  const k = $("#kiosk");
  if (!k) return;
  k.classList.remove("hidden");
  document.body.classList.add("kiosk-on");
  scanCard("💧", "water");
  const trail = $("#kioskTrail");
  if (trail) trail.innerHTML = "";
}
// 與 renderScanCard() 同一份 markup（.kcard/.kemoji/.kword＋scanpulse 動畫），
// 這樣演示看到的就是真的那塊板子，不是仿的。
function scanCard(emoji, word) {
  const box = $("#kioskCards");
  if (!box) return;
  box.dataset.n = 1;
  box.innerHTML = `<div class="kcard kscan scanpulse"><span class="kemoji">${emoji}</span><span class="kword">${word}</span></div>`;
}
async function kioskTrail() {
  const trail = $("#kioskTrail");
  const seen = [];
  for (const [emo, word] of [["🛏", "rest"], ["💊", "medicine"]]) {
    if (_abort) return;
    scanCard(emo, word);
    seen.push(`<div class="ktrail-item">${emo} ${word}</div>`);
    if (trail) trail.innerHTML =
      `<button class="ktrail-ctl" type="button">▶</button><button class="ktrail-ctl" type="button">✕</button>` + seen.join("");
    await sleep(1100);
  }
}
function kioskPin() { $("#kioskPin")?.classList.remove("hidden"); }
function kioskClose() {
  $("#kioskPin")?.classList.add("hidden");
  $("#kiosk")?.classList.add("hidden");
  document.body.classList.remove("kiosk-on");
  const trail = $("#kioskTrail"); if (trail) trail.innerHTML = "";
  const cards = $("#kioskCards"); if (cards) cards.innerHTML = "";
}

// 全域字級是 documentElement 的 --font（rem）。直接改變數即可，不動 state，
// 這樣不會 save()，也不必擔心演示中斷時把使用者的字級留在 1.6。
async function fontScaleDemo() {
  goTab("settings");
  const root = document.documentElement;
  for (const v of [1.4, 1.8, 2.2]) {
    if (_abort) break;
    root.style.setProperty("--font", v + "rem");
    await sleep(1000);
  }
  await sleep(600);
  root.style.setProperty("--font", (_restore.font || 1) + "rem");
}

function langDemo(lang) {
  state.settings.lang = lang || _restore.lang;   // null＝還原
  applyI18n();
}

// ── 旁白 ────────────────────────────────────────────────────────────────

// 演示裡「App 講出來的話」（不是旁白）。有預先合成就走混音軌——那條才錄得到；
// 沒有（沒接電腦端）才退回一般 TTS，至少現場聽得到。
// 演示裡「App 把句子唸出來」那一下：**固定用瀏覽器內建（Google）語音**，
// 不用 GPT-SoVITS。理由與 App 端相同——那條路要現場合成，CPU 上一句十幾秒，
// 畫面早就跳走了，聲音才姍姍來遲蓋在別的段落上。瀏覽器語音是即時的。
// 而且要等它真的唸完才回來，並且和旁白共用同一個發言權，不會互相疊。
// 專屬聲音「合成」的停頓。音檔是預錄好的，所以其實不必等，但真的按下去
// 是要等電腦跑 10～30 秒的——瞬間出聲會讓觀眾以為這個 App 是即時的。
// 停的長度是縮短的，但「要等」這件事本身不是演的。
const VOICE_SYNTH_DELAY = 2000;

/**
 * 演示裡「App 把句子唸出來」那一下：亮出合成指示 → 停 2 秒 → 播預錄好的那一段。
 *
 * **用的角色和旁白不同**（見 pickNarrationVoice：旁白用花火 EN，這裡取別的）。共用旁白角色的話，
 * 這句話聽起來就變成旁白在唸它，而不是 App 在講話——觀眾分不出哪一句是解說。
 *
 * 那 2 秒是給「合成需要時間」用的：真的按下去要等電腦跑 10～30 秒，
 * 瞬間出聲會讓觀眾以為這個 App 是即時的。音檔是預錄的，所以停的是 2 秒不是 30 秒。
 */
/**
 * 用**專屬聲音**（GPT-SoVITS 預錄檔）唸一句。給「我的專屬聲音」那一段用。
 *
 * 角色刻意不是旁白那個（見 pickNarrationVoice），觀眾才聽得出這是
 * 「他自己的聲音」，而不是旁白又講了一句。合不出來才退回瀏覽器語音。
 */
function speakInOwnVoice(text) {
  return withAudioFloor(async () => {
    const tag = showSynthesizing();
    try { await sleep(VOICE_SYNTH_DELAY); } finally { tag?.remove(); }
    const clip = _speakClips.get(text);
    if (clip) await playClip(clip, 1.0);
    else await browserNarrate(text);
  });
}

function speakDemoSentence(text) {
  return withAudioFloor(async () => {
    const tag = showSynthesizing();
    try { await sleep(VOICE_SYNTH_DELAY); } finally { tag?.remove(); }
    const clip = _speakClips.get(text);
    // 不加速：旁白拉到 1.22 倍是為了不拖節奏，但這一句是「App 正在講話」，
    // 加速會讓它聽起來像趕時間，也和真的按下去聽到的不一樣。
    if (clip) await playClip(clip, 1.0);
    else await browserNarrate(text);      // 連不到電腦端就退回瀏覽器語音（影片會沒這一句）
  });
}

/** 在結果卡下面掛一行「合成中…」，回傳那個節點讓呼叫端收掉。 */
function showSynthesizing() {
  const host = $("#result");
  if (!host || host.classList.contains("hidden")) return null;
  const el = document.createElement("div");
  el.className = "tiny muted";
  el.style.marginTop = "6px";
  el.textContent = t("btn.synthesizing");
  host.appendChild(el);
  return el;
}

function demoSpeak(text) {
  // 排進同一條發言權：前面的旁白一定先講完，才輪到這一句；
  // 這一句講完放開之後，下一句旁白才拿得到發言權。回傳 promise 讓呼叫端 await。
  return withAudioFloor(() => browserNarrate(text));
}

// 旁白固定用這個角色：整支影片同一個聲音，換台電腦、換個曲庫順序都一樣。
// 不指名的話「取第一個英文角色」會隨曲庫內容變動，每次錄出來的旁白都可能不同。
const NARRATION_VOICE_NAME = "花火";

async function pickNarrationVoice() {
  _voice = null;
  _speakVoice = null;
  try {
    if (!(await detectLocalTts(2000))) return;
    const vs = await localVoices();
    const en = vs.filter((v) => (v.lang || "").toUpperCase() === "EN");
    const narr = en.find((v) => (v.name || "").includes(NARRATION_VOICE_NAME)) || en[0];
    if (narr) _voice = { name: narr.name, lang: "EN" };
    // 「App 把句子唸出來」那一下要用**別的**角色。同一個聲音的話，那句話聽起來
    // 就像旁白在唸它，觀眾分不出哪一句是解說、哪一句是這個 App 講出來的。
    // 只有一個英文角色時就只好共用（總比沒有聲音好）。
    const sp = en.find((v) => v.name !== narr?.name) || narr;
    if (sp) _speakVoice = { name: sp.name, lang: "EN" };
  } catch { /* 連不上就退瀏覽器語音 */ }
}

// 旁白播放速度。GPT-SoVITS 的英文原速偏慢，聽起來像在唸稿。
// 用 <audio> 的 playbackRate ＋ preservesPitch 加速——不會變成花栗鼠音。
const NARRATION_RATE = 1.22;

// ── 預錄旁白的存放 ───────────────────────────────────────────────────────
// 存 IndexedDB，不是只放記憶體。放記憶體的話重新整理一次就全沒了，
// 等於每次開頁面都要重新合成一輪（CPU 上每句 25 秒）——那就不叫預錄了。
const DB_NAME = "vw_demo_narration";
const STORE = "clips";
let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => resolve(null);   // 無痕模式等情況拿不到 → 退回只用記憶體
  });
}

function dbGet(key) {
  return openDb().then((db) => db && new Promise((resolve) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  }));
}
function dbPut(key, blob) {
  return openDb().then((db) => db && new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = tx.onerror = () => resolve();
  }));
}

// 快取鍵要帶角色名：換了旁白角色就該重新合成，不然會播到上一個聲音。
function clipKey(text, voiceName) { return `${voiceName || _voice?.name || "browser"}|${text}`; }

// 記憶體層（同一次執行內免走 IndexedDB）：句子文字 → Blob。
//
// 存 AudioBuffer 而不是 <audio> 的網址，是為了能把聲音**直接混進錄影**：
// getDisplayMedia 的音訊要使用者自己記得勾「分享分頁音訊」才有，忘了就錄成默片；
// 而用麥克風收喇叭又會把房間的雜音一起錄進去。走 WebAudio 就沒有這兩個問題——
// 同一份聲音同時送去喇叭和錄影軌，錄到的是乾淨的原始音訊。
const _clips = new Map();
/** 示範發聲（花火 EN）的預錄快取，和旁白那份分開放。 */
const _speakClips = new Map();

let _ac = null;          // AudioContext（全程共用；每次 new 會被瀏覽器限制數量）
let _mixDest = null;     // 錄影用的音訊匯流點

function audioCtx() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === "suspended") _ac.resume().catch(() => {});
  return _ac;
}
function mixDest() {
  if (!_mixDest) _mixDest = audioCtx().createMediaStreamDestination();
  return _mixDest;
}

/** 把選到的單元裡所有旁白先合成好（先問 IndexedDB，缺的才合成）。回成功句數。 */
async function prepareNarration(units, onProgress) {
  // 兩批、兩個角色：
  //  ① 旁白 → _voice
  //  ② 「App 把句子唸出來」的示範句 → _speakVoice（花火 EN）
  // 分角色是為了讓觀眾分得出哪一句是解說、哪一句是這個 App 講出來的。
  // 示範句也一定要預錄：瀏覽器自己的 TTS 繞過 WebAudio，錄影的音軌收不到，
  // 影片裡會變成「畫面在唸但沒有聲音」。
  const spoken = [SAMPLE.candidates[0], SAMPLE.rehab];
  const jobs = [
    ...[...new Set(units.flatMap((u) => u.steps.map((s) => s.cap)).filter(Boolean))]
      .map((text) => ({ text, voice: _voice, store: _clips })),
    ..._speakVoice ? spoken.map((text) => ({ text, voice: _speakVoice, store: _speakClips })) : [],
  ].filter((j) => j.voice);

  // 先把上次存下來的撈回來——這一步是「為什麼第二次不用等」的關鍵。
  for (const j of jobs) {
    if (j.store.has(j.text)) continue;
    const hit = await dbGet(clipKey(j.text, j.voice.name));
    if (hit) j.store.set(j.text, hit);
  }
  const todo = jobs.filter((j) => !j.store.has(j.text));
  let ok = jobs.length - todo.length;
  for (let i = 0; i < todo.length; i++) {
    if (_abort) break;
    onProgress(i, todo.length);
    if (await synthJob(todo[i])) ok++;
  }
  // 補漏輪：整批跑完再收一次還缺的。走 Tailscale／ngrok(Colab) 時，最容易掉的
  // 是隧道剛拉起來的頭幾句；跑到這裡連線通常已經穩了，這一輪常常就補回來。
  const missed = todo.filter((j) => !j.store.has(j.text));
  for (let i = 0; i < missed.length && !_abort; i++) {
    onProgress(i, missed.length);
    if (await synthJob(missed[i])) ok++;
  }
  onProgress(todo.length, todo.length);
  return ok;
}

// 一句話合成幾次都不成才放棄。**不重試的代價不是「少一句」**——那一句會退回
// 瀏覽器機器音，於是簡報影片播到一半突然換了個聲音，而且錄完才會發現。
// 掉包的原因多半是暫時的（隧道冷啟動、換 DERP 中繼），值得再試。
const PREWARM_ATTEMPTS = 3;
const PREWARM_BACKOFF_MS = 1500;

async function synthJob(j) {
  for (let attempt = 0; attempt < PREWARM_ATTEMPTS; attempt++) {
    if (_abort) return false;
    try {
      const blob = await localSynth(j.text, { name: j.voice.name, lang: "EN", emotion: "中立" });
      if (blob) {
        j.store.set(j.text, blob);
        await dbPut(clipKey(j.text, j.voice.name), blob);   // 存起來，下次開頁面直接用
        return true;
      }
    } catch {
      // 落到下面的退避重試
    }
    // 剛掉包的下一秒通常還是掉包，立刻重打只是把三次機會一次用完。
    if (attempt < PREWARM_ATTEMPTS - 1) {
      await sleep(PREWARM_BACKOFF_MS * (attempt + 1));
    }
  }
  return false;
}

/**
 * 播一段預錄好的旁白：同時送喇叭與錄影軌，等真的播完才 resolve。
 *
 * 用 <audio> 而不是 AudioBufferSource，是為了 preservesPitch——
 * BufferSource 的 playbackRate 是直接改取樣率，加速會連音高一起拉高（花栗鼠）。
 * 走 media element 才有瀏覽器的變速不變調。
 */
function playClip(blob, rate = NARRATION_RATE) {
  return new Promise((resolve) => {
    const ac = audioCtx();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
    el.playbackRate = rate;
    let src = null;
    try {
      src = ac.createMediaElementSource(el);
      src.connect(ac.destination);   // 使用者聽得到
      src.connect(mixDest());        // 錄影錄得到
    } catch {
      /* 接不上 WebAudio 就直接播，至少現場聽得到（影片會沒這一句） */
    }
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      try { src?.disconnect(); } catch {}
      try { URL.revokeObjectURL(url); } catch {}
      resolve();
    };
    el.onended = el.onerror = fin;
    el.play().catch(fin);
  });
}

// 旁白一句。**一定要等講完**才走下一步，否則字幕跟畫面會愈跑愈前面。
async function narrate(text) {
  if (!_narrate || !text) return;
  const clip = _clips.get(text);
  if (clip) { await withAudioFloor(() => playClip(clip)); return; }
  await withAudioFloor(() => browserNarrate(text));   // 沒預錄成功的那幾句
}

function browserNarrate(text) {
  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.95;
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      u.onend = u.onerror = fin;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      // 保險：有些瀏覽器 onend 不會觸發。但這個時限**必須遠大於**實際唸完的時間，
      // 否則它會反過來把還在唸的句子切斷——那正是「音檔沒播完就跳下一步」。
      // 英文約每分鐘 160 字，抓三倍再加 5 秒當上限，只用來防卡死。
      const words = text.split(/\s+/).filter(Boolean).length;
      setTimeout(fin, 5000 + words / 160 * 60 * 1000 * 3);
    } catch { resolve(); }
  });
}

// ── 讓螢幕不要睡著 ──────────────────────────────────────────────────────
//
// 演示要跑好幾分鐘（加上旁白預錄可能更久），使用者多半按下去就走開。
// 螢幕一暗，錄下來就是半段黑畫面——而且分頁被系統休眠後畫面也不再更新。
// Screen Wake Lock 只在分頁可見時有效，切走再切回來要自己重新取得，
// 所以掛一個 visibilitychange 監聽補回來。
let _wake = null;

async function keepAwake() {
  if (!("wakeLock" in navigator)) return;          // Safari 舊版沒有，安靜略過
  try { _wake = await navigator.wakeLock.request("screen"); }
  catch { _wake = null; }                          // 電量過低等情況會被拒絕
}
function releaseAwake() {
  try { _wake?.release(); } catch {}
  _wake = null;
}
// ── 黑畫面防護 ─────────────────────────────────────────────────────────
//
// 分頁擷取在分頁被切走／最小化時，瀏覽器會停止繪製那個分頁——錄下來就是
// 一段全黑或凍住的畫面，而且是在錄完之後才會發現。Wake Lock 也只在分頁
// 可見時有效，切走就被系統收走了。
//
// 擋不住使用者切分頁（那是他的自由），但可以做到兩件事：
//   ① 切回來立刻把 Wake Lock 補上，別讓螢幕接著睡著；
//   ② 記下「這支影片中間有黑掉過」，錄完直接告訴他，不要讓他事後才發現。
let _wentHidden = false;

document.addEventListener("visibilitychange", () => {
  if (!window.__VW_DEMO__) return;
  if (document.visibilityState === "hidden") {
    _wentHidden = true;          // 這段時間的畫面多半是黑的
    releaseAwake();              // 反正系統已經收走了，把狀態對齊
  } else if (!_wake) {
    keepAwake();
  }
});

// ── 螢幕錄影 ────────────────────────────────────────────────────────────

function recSupported() {
  return !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
}

async function startRecording() {
  // 只錄「這一個分頁」，不要整個 Chrome。
  //
  // preferCurrentTab 會讓瀏覽器的分享視窗直接只給「目前分頁」一個選項——
  // 使用者不必在「整個螢幕／視窗／分頁」之間挑，也就不會不小心選到整個桌面。
  // 錄到的內容只有頁面本身：沒有網址列、沒有分頁列、沒有書籤列，也沒有其他視窗。
  // selfBrowserSurface:"include" 是允許擷取自己這個分頁（預設會排除）；
  // surfaceSwitching:"exclude" 拿掉錄影中那顆「改分享別的分頁」按鈕，
  // 免得演示到一半被切走。systemAudio:"exclude" 是因為旁白已經自己混進去了。
  //
  // 這些參數舊版瀏覽器不認得會直接忽略，不會報錯；真的不支援時使用者還是
  // 會看到原本的三選一，選「這個分頁」結果一樣。
  const wanted = {
    video: { frameRate: 30, displaySurface: "browser" },
    audio: false,              // 聲音不靠分頁音訊，改用下面的 WebAudio 混音軌
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  };
  let screen;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia(wanted);
  } catch (e) {
    // 使用者按取消要照實往上丟；只有「參數不支援」才退回最陽春的請求。
    if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) throw e;
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  }
  // 影像來自螢幕分享、聲音來自旁白的混音匯流點 → 使用者不必記得勾「分享分頁音訊」，
  // 也不會錄到房間的雜音。旁白播出去的同時就已經進了這條軌。
  const stream = new MediaStream([
    ...screen.getVideoTracks(),
    ...mixDest().stream.getAudioTracks(),
  ]);
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
  _chunks = [];
  _chunksSilent = [];
  _recStream = screen;         // 要停的是螢幕分享本身；混音軌是共用的，不能停
  _rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  _rec.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };

  // 第二份：同一條影像軌，不接旁白那條音軌 → 一次錄，兩個版本。
  // （簡報時想自己口頭講解就用這一份，不必再跑一次演示、也不必再等一次預錄。）
  // 影像軌是同一個 MediaStreamTrack，兩個 MediaRecorder 讀同一個來源，
  // 所以兩支影片的畫面內容與時間軸完全一致。
  // 建不起來就只出一份——為了第二份讓整次錄影失敗是本末倒置。
  _recSilent = null;
  try {
    const silentMime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const silentStream = new MediaStream(screen.getVideoTracks());
    _recSilent = new MediaRecorder(silentStream,
      silentMime ? { mimeType: silentMime, videoBitsPerSecond: 4_000_000 } : undefined);
    _recSilent.ondataavailable = (e) => { if (e.data && e.data.size) _chunksSilent.push(e.data); };
  } catch (e) {
    console.warn("[demo] 無聲版錄不起來，只輸出有旁白的那一份", e);
    _recSilent = null;
  }

  // 使用者在瀏覽器自己的分享列按「停止分享」→ 也要把檔案收好，不能就這樣丟掉。
  screen.getVideoTracks()[0].addEventListener("ended", () => { _abort = true; });
  _rec.start(1000);
  try { _recSilent?.start(1000); } catch { _recSilent = null; }
}

/** @returns {Promise<{narrated: Blob|null, silent: Blob|null}>} */
function stopRecording() {
  const stopOne = (rec, chunks) => new Promise((resolve) => {
    if (!rec) { resolve(null); return; }
    rec.onstop = () => resolve(chunks.length
      ? new Blob(chunks, { type: rec.mimeType || "video/webm" }) : null);
    try { rec.stop(); } catch { resolve(null); }
  });
  const a = _rec, b = _recSilent;
  _rec = null; _recSilent = null;
  // 兩個都停完才收掉螢幕分享——先停軌的話後面那個 recorder 會拿到半截檔案
  return Promise.all([stopOne(a, _chunks), stopOne(b, _chunksSilent)])
    .then(([narrated, silent]) => {
      try { _recStream?.getTracks().forEach((t) => t.stop()); } catch {}
      _recStream = null;
      return { narrated, silent };
    });
}

function download(blob, suffix = "") {
  if (!blob) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const name = `VoiceWeaver-Demo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${suffix}.webm`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── 執行 ────────────────────────────────────────────────────────────────

let _restore = {};

function snapshot() {
  _restore = {
    lang: state.settings.lang,
    font: state.settings.font || 1,
    tab: document.querySelector(".tab.active")?.dataset.tab || "compose",
    fragments: $("#fragments")?.value || "",
    ccWord: $("#ccWord")?.value || "",
    resultHidden: $("#result")?.classList.contains("hidden") ?? true,
    aacGridCls: $("#aacItems")?.className || "cards-grid",
    altHidden: $("#altPick")?.classList.contains("hidden") ?? true,
    altHtml: $("#altList")?.innerHTML || "",
    comboHtml: $("#aacCombo")?.innerHTML || "",
  };
}

function restore() {
  clearSpot();
  hideTitle();
  crisisClose();
  kioskClose();
  $("#confirmDlg")?.classList.add("hidden");
  const f = $("#fragments"); if (f) f.value = _restore.fragments;
  const w = $("#ccWord"); if (w) w.value = _restore.ccWord;
  if (_restore.resultHidden) $("#result")?.classList.add("hidden");
  const alt = $("#altList"); if (alt) alt.innerHTML = _restore.altHtml;
  if (_restore.altHidden) $("#altPick")?.classList.add("hidden");
  const combo = $("#aacCombo"); if (combo) combo.innerHTML = _restore.comboHtml;
  const grid = $("#aacItems"); if (grid && _restore.aacGridCls) grid.className = _restore.aacGridCls;
  $$(".aac-scale-chip").forEach((x) => x.classList.toggle("on", +x.dataset.s === (+state.settings.aacScale || 1)));
  const sc = $("#rehabScore"); if (sc) sc.innerHTML = "";
  $("#rehabPractice")?.classList.add("hidden");
  $("#storyFeedback")?.classList.add("hidden");
  document.documentElement.style.setProperty("--font", (_restore.font || 1) + "rem");
  if (state.settings.lang !== _restore.lang) { state.settings.lang = _restore.lang; applyI18n(); }
  document.querySelector(`.tab[data-tab="${_restore.tab}"]`)?.click();
  try { speechSynthesis.cancel(); } catch {}
}

async function run(ids, opts) {
  const all = UNITS();
  const units = all.filter((u) => ids.includes(u.id));
  if (!units.length) return;

  _abort = false;
  _narrate = !!opts.narrate;
  window.__VW_DEMO__ = true;
  keepAwake();                 // 預錄那一段最久，也最容易讓人走開 → 從這裡就開始
  buildOverlay();
  snapshot();
  ui().classList.remove("hidden");

  // 旁白一定要在**開始錄影之前**全部合成完。CPU 上一句要 20~30 秒，邊演邊合成
  // 等於把幾十分鐘的空白錄進影片裡。合成完再開錄，片子才是緊湊的。
  if (_narrate) {
    await pickNarrationVoice();
    if (_voice) {
      const prep = $("#demoPrep"), fill = $("#demoPrepFill"), note = $("#demoPrepNote");
      prep.classList.remove("hidden");
      const t0 = Date.now();
      await prepareNarration(units, (i, n) => {
        fill.style.width = n ? `${Math.round(i * 100 / n)}%` : "100%";
        const per = i ? (Date.now() - t0) / i : 0;
        const left = per ? Math.round(per * (n - i) / 1000) : 0;
        note.textContent = n
          ? `${i} / ${n} ${t("demo.lines")}${left ? ` · ${t("demo.left")} ${Math.floor(left / 60)}m ${left % 60}s` : ""}`
          : t("demo.ready");
      });
      prep.classList.add("hidden");
    }
  }
  if (_abort) {
    restore(); releaseAwake();
    ui().classList.add("hidden"); window.__VW_DEMO__ = false; return;
  }

  let recording = false;
  if (opts.record) {
    try { await startRecording(); recording = true; }
    catch (e) { alert("Screen recording was not started: " + (e?.message || e) + "\nThe demo will run without recording."); }
  }

  _wentHidden = false;
  if (recording) {
    // 錄影時把 HUD 收起來：進度膠囊與紅色 Stop 是給操作者看的，不是影片內容，
    // 錄進去就是「18/67」和一顆紅鈕壓在畫面上。中止改用 Esc（見下面的監聽）。
    $("#demoHud")?.classList.add("hidden");
    // 游標藏起來，並給一秒鐘把滑鼠移開畫面——分享畫面時游標一定會入鏡，
    // 停在某個按鈕上整支影片都跟著那顆按鈕發亮。
    document.body.classList.add("demo-nocursor");
    const tip = $("#demoPrepNote");
    $("#demoPrep")?.classList.remove("hidden");
    $("#demoPrepTitle").textContent = t("demo.getReady");
    if (tip) tip.textContent = "1";
    await sleep(1000);
    $("#demoPrep")?.classList.add("hidden");
  }

  const total = units.reduce((n, u) => n + u.steps.length, 0);
  let done = 0;
  try {
    for (const u of units) {
      if (_abort) break;
      for (const s of u.steps) {
        if (_abort) break;
        done++;
        progress(`${u.icon} ${u.title} · ${done}/${total}`);
        caption(s.cap);
        const t0 = Date.now();
        // 動作與旁白同時跑：先讓畫面動起來，旁白在講的同時使用者已經看到變化。
        const acting = Promise.resolve().then(() => s.act?.()).catch(() => {});
        // ── 錄影池 ──
        // 旁白開始講之前，先把這一步要講的地方露出來並確認它真的看得見。
        //
        // **一定要在 acting 之後**：切分頁是寫在 act 裡的（goTab），先檢查的話
        // 量到的是上一個分頁的畫面，會誤報而且捲錯地方。goTab 是同步的，
        // 所以 acting 這個 microtask 一排下去分頁就換好了。
        await ensureVisible(s.focus, s.cap);
        await Promise.all([acting, narrate(s.cap)]);
        if (_narrate && s.cap) await sleep(TAIL_PAD);   // 講完再讓畫面多停一下
        await sleep(s.hold ?? 0);
        // 補到最短停留。旁白比下限長時這裡是 0，不會拖慢。
        const floor = _narrate ? MIN_STEP_NARRATED : MIN_STEP_SILENT;
        const left = floor - (Date.now() - t0);
        if (left > 0) await sleep(left);
      }
      clearSpot();
    }
  } finally {
    restore();
    releaseAwake();
    document.body.classList.remove("demo-nocursor");
    $("#demoHud")?.classList.remove("hidden");
    ui().classList.add("hidden");
    window.__VW_DEMO__ = false;
    if (recording) {
      const out = await stopRecording();
      // 一次錄影兩份：有旁白的、以及同一段畫面但沒有聲音的。
      // 只出得來一份時就只下載那一份，不要跳出「下載失敗」嚇使用者。
      download(out.narrated, out.silent ? "-narrated" : "");
      download(out.silent, "-silent");
      // 錄完才發現中間黑掉一段，等於白錄一次。直接講。
      if (_wentHidden) alert(t("demo.wentHidden"));
    }
  }
}

// ── 設定頁裡的面板 ──────────────────────────────────────────────────────

const PICK_KEY = "vw_demo_units";

function loadPicked() {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch {}
  return UNITS().map((u) => u.id);          // 預設全選
}
function savePicked(ids) {
  try { localStorage.setItem(PICK_KEY, JSON.stringify(ids)); } catch {}
}

export function setupDemo() {
  const box = $("#demoUnits");
  if (!box) return;
  const picked = new Set(loadPicked());

  box.innerHTML = UNITS().map((u) => `
    <label class="demo-unit">
      <input type="checkbox" data-id="${u.id}"${picked.has(u.id) ? " checked" : ""} />
      <span class="demo-unit-ico">${u.icon}</span>
      <span class="demo-unit-txt">
        <span class="demo-unit-title">${u.title}</span>
        <span class="demo-unit-note">~${u.est}s${u.note ? " · " + u.note : ""}</span>
      </span>
    </label>`).join("");

  const boxes = () => $$("#demoUnits input[type=checkbox]");
  const chosen = () => boxes().filter((b) => b.checked).map((b) => b.dataset.id);

  // 估時直接從步數算，不用手寫的 est——手寫值與實際節奏一定會漂移，
  // 而使用者是靠這個數字決定要不要錄的。
  const stepMs = (cap, narrated) => {
    if (!narrated) return MIN_STEP_SILENT;
    const words = String(cap || "").split(/\s+/).filter(Boolean).length;
    return Math.max(MIN_STEP_NARRATED, (words / (2.6 * NARRATION_RATE)) * 1000) + TAIL_PAD;
  };
  const est = () => {
    const ids = new Set(chosen());
    const narrated = !!$("#demoNarrate")?.checked;
    const ms = UNITS().filter((u) => ids.has(u.id))
      .flatMap((u) => u.steps)
      .reduce((n, st) => n + stepMs(st.cap, narrated) + (st.hold ?? 0), 0);
    const total = Math.round(ms / 1000);
    $("#demoEst").textContent = `${ids.size} ${t("demo.unitsN")} · ${t("demo.about")} ${Math.floor(total / 60)}m ${total % 60}s`;
  };

  box.addEventListener("change", () => { savePicked(chosen()); est(); });
  $("#demoNarrate")?.addEventListener("change", est);
  // 估時那一行是自己組出來的字串，不吃 data-i18n → 換語言時要重算一次，
  // 否則會留在上一個語言（「2 個單元」跟旁邊的英文介面併排）。
  $("#s_lang")?.addEventListener("change", () => setTimeout(est, 0));
  $("#demoAll")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = true); savePicked(chosen()); est(); });
  $("#demoNone")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = false); savePicked(chosen()); est(); });

  if (!recSupported()) {
    const r = $("#demoRecord");
    if (r) { r.checked = false; r.disabled = true; }
    const hint = $("#demoRecHint");
    if (hint) hint.textContent = t("demo.noRec");
  }

  $("#demoStart")?.addEventListener("click", async () => {
    const ids = chosen();
    if (!ids.length) { alert(t("demo.pickOne")); return; }
    await run(ids, {
      narrate: !!$("#demoNarrate")?.checked,
      record: !!$("#demoRecord")?.checked,
    });
  });

  est();
}
