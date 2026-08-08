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
import { state } from "./store.js?v=1.5.21";
import { speak } from "./speech.js?v=1.5.21";
import { applyI18n } from "./i18n.js?v=1.5.21";
import { localSynth, localVoices, detectLocalTts } from "./localtts.js?v=1.5.21";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 演示進行中的旗標。extras.js 的 Telegram 出口會讀它擋下所有外送。
export function demoRunning() { return !!window.__VW_DEMO__; }

let _abort = false;          // 使用者按了 Stop
let _narrate = true;         // 旁白模式
let _voice = null;           // 旁白用的 EN 角色語音 {name, lang}
let _rec = null, _chunks = [], _recStream = null;

// ── 演示單元 ────────────────────────────────────────────────────────────
// 每個單元是獨立的一段，使用者自己勾。step.cap＝字幕/旁白，step.act＝畫面動作。
// est 是純演示（無旁白）的估計秒數；有旁白會更長，由語音長度決定。

function UNITS() {
  return [
    {
      id: "intro", icon: "🎬", title: "Title & overview", est: 12,
      steps: [
        { cap: "VoiceWeaver — a communication aid for people with aphasia.", act: () => titleCard("VoiceWeaver", "Communication support for people with aphasia") },
        { cap: "It turns broken words into whole sentences, and speaks them in a familiar voice.", act: () => titleSub("Fragments → sentence → familiar voice") },
        { cap: "Here is a walkthrough of the main features.", act: hideTitle },
      ],
    },
    {
      id: "compose", icon: "💬", title: "Sentence reconstruction", est: 26,
      steps: [
        { cap: "A person with aphasia can often produce only isolated words.", act: () => goTab("compose") },
        { cap: "They type or say what they can — here: water, rest, now.", act: () => typeInto("#fragments", "water  rest  now") },
        { cap: "One tap rebuilds it into a natural sentence.", act: () => press("#btnCompose") },
        { cap: "The AI returns three candidates, so the user is never forced to accept a wrong guess.", act: showCandidates, hold: 1600 },
        { cap: "Before anything is spoken aloud, the intent is confirmed with a large picture card.", act: showConfirm, hold: 1600 },
        { cap: "Only after confirmation is the sentence spoken.", act: confirmYes },
      ],
    },
    {
      id: "aac", icon: "🖼", title: "Picture cards (AAC)", est: 24,
      steps: [
        { cap: "For users who cannot type at all, the picture board is the way in.", act: () => goTab("aac") },
        { cap: "Cards are colour-coded by part of speech and grouped by situation.", act: () => spotSel("#aacCats"), hold: 1400 },
        { cap: "Tapping cards builds a sentence buffer.", act: aacPickDemo },
        { cap: "The buffer can be spoken directly, or rewritten into a grammatical sentence.", act: () => spotSel("#aacCompose"), hold: 1200 },
        { cap: "Card size scales up for low vision and poor motor control.", act: aacScaleDemo },
      ],
    },
    {
      id: "customcards", icon: "📷", title: "Custom photo cards", est: 14,
      steps: [
        { cap: "Generic icons mean little to an older adult.", act: () => scrollTo("#ccList") },
        { cap: "A family member photographs the person's own things — their cup, their grandchild.", act: () => typeInto("#ccWord", "my grandson") },
        { cap: "Recognising your own belongings is what builds trust in the device.", act: () => spotSel("#ccAdd"), hold: 1400 },
      ],
    },
    {
      id: "acoustic", icon: "🎤", title: "Personal pronunciation model", est: 20,
      steps: [
        { cap: "Aphasic speech breaks ordinary speech recognition.", act: () => goSetting("acoustic") },
        { cap: "So the user records their own way of saying a few key words.", act: () => captionOnly() },
        { cap: "The app stores an acoustic template per keyword and matches against it with DTW.", act: () => captionOnly() },
        { cap: "It recognises the person in front of it — not an average speaker.", act: () => captionOnly() },
      ],
    },
    {
      id: "voice", icon: "🗣", title: "Personal voice (GPT-SoVITS)", est: 22,
      steps: [
        { cap: "Losing speech often means losing your own voice as well.", act: () => goSetting("voice") },
        { cap: "A GPT-SoVITS model is trained from a short recording made before the illness.", act: () => captionOnly() },
        { cap: "Models live in the user's own Google Drive and sync to phone, web and desktop.", act: () => captionOnly() },
        { cap: "The sentence is then spoken in the person's own voice, with the right emotion.", act: () => captionOnly() },
      ],
    },
    {
      id: "rehab", icon: "🏥", title: "Speech rehabilitation", est: 22,
      steps: [
        { cap: "Beyond communication, the app doubles as a daily practice tool.", act: () => goTab("rehab") },
        { cap: "A clinical phrase bank works offline — no API key required.", act: () => spotSel("#rehabBank"), hold: 1400 },
        { cap: "The user hears the target sentence, then reads it back.", act: rehabDemo, hold: 1200 },
        { cap: "Each attempt is scored per syllable, so progress is visible.", act: rehabScore, hold: 1800 },
      ],
    },
    {
      id: "story", icon: "📖", title: "Picture storytelling", est: 16,
      steps: [
        { cap: "Repeating single sentences is not enough for milder cases.", act: () => scrollTo("#storyFrames") },
        { cap: "A four-frame picture story asks the user to organise meaning themselves.", act: () => spotSel("#storyFrames"), hold: 1400 },
        { cap: "The AI comments like a therapist would, and gives a score.", act: storyFeedback, hold: 1800 },
      ],
    },
    {
      id: "report", icon: "📊", title: "Progress report", est: 20,
      steps: [
        { cap: "Everything the user does feeds a report their therapist can read.", act: () => goTab("report") },
        { cap: "Sessions, average score, streak, and use of positive language.", act: () => spotSel(".stats"), hold: 1600 },
        { cap: "Behavioural metrics show how the person is coping, not just how they scored.", act: () => scrollTo("#bmReaction"), hold: 1600 },
        { cap: "The report exports to CSV or PDF for a clinical visit.", act: () => spotSel("#reportCsv"), hold: 1400 },
      ],
    },
    {
      id: "history", icon: "🕘", title: "History", est: 10,
      steps: [
        { cap: "Every sentence the person managed to say is kept.", act: () => goTab("history") },
        { cap: "Frequent ones can be starred and reused instantly.", act: () => captionOnly(), hold: 1400 },
      ],
    },
    {
      id: "crisis", icon: "🆘", title: "Crisis intervention", est: 22,
      note: "Simulated — no message is sent.",
      steps: [
        { cap: "Losing speech carries a real risk of depression and self-harm.", act: () => goTab("compose") },
        { cap: "Every sentence is screened for crisis signals before it is spoken.", act: () => captionOnly() },
        { cap: "If one is detected the app does not just refuse — it stays with the person.", act: crisisMock, hold: 1800 },
        { cap: "A breathing orb, a few large buttons, and the family is contacted automatically.", act: () => spotSel("#crisisOrb"), hold: 2000 },
        { cap: "This screen cannot be dismissed by the user alone. In this demo nothing was sent.", act: crisisClose, hold: 1200 },
      ],
    },
    {
      id: "kiosk", icon: "🔒", title: "Severe mode (locked board)", est: 18,
      steps: [
        { cap: "For the most severely affected, a whole grid of cards is still too much.", act: () => goTab("aac") },
        { cap: "Severe mode turns the device into a single-card board that scans automatically.", act: kioskMock, hold: 2600 },
        { cap: "Tapping speaks the card and adds it to a clue trail the family can read.", act: kioskTrail, hold: 1800 },
        { cap: "Exit is behind a caregiver PIN, so the patient cannot get lost in the app.", act: kioskPin, hold: 1800 },
        { cap: "", act: kioskClose },
      ],
    },
    {
      id: "sos", icon: "🚨", title: "Emergency SOS", est: 14,
      note: "Simulated — no message is sent.",
      steps: [
        { cap: "In an emergency, composing a sentence is too slow.", act: () => goTab("compose") },
        { cap: "Fixed one-tap phrases sit at the top of the screen at all times.", act: () => spotSel("#quickSos"), hold: 1600 },
        { cap: "The SOS button messages the family with the current location. Not sent in this demo.", act: () => spotSel("#btnSos"), hold: 1600 },
      ],
    },
    {
      id: "a11y", icon: "♿", title: "Accessibility & languages", est: 20,
      steps: [
        { cap: "Text scales across the whole app, including inside settings.", act: fontScaleDemo, hold: 1400 },
        { cap: "The interface runs in Traditional Chinese, English, Japanese and Korean.", act: () => langDemo("ja-JP"), hold: 1600 },
        { cap: "Voice output follows the same language.", act: () => langDemo("ko-KR"), hold: 1600 },
        { cap: "", act: () => langDemo(null) },
      ],
    },
    {
      id: "cloud", icon: "☁️", title: "Cloud sync", est: 14,
      steps: [
        { cap: "Phone, web and desktop share one account.", act: () => goSetting("cloud") },
        { cap: "Voice models stay in the user's own Google Drive — never on a developer server.", act: () => captionOnly() },
        { cap: "Nothing here leaves the user's own account.", act: () => captionOnly() },
      ],
    },
    {
      id: "outro", icon: "🏁", title: "Closing card", est: 8,
      steps: [
        { cap: "VoiceWeaver — giving words back, in your own voice.", act: () => titleCard("VoiceWeaver", "Giving words back — in your own voice") },
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
    <div class="demo-hud">
      <span id="demoProgress" class="demo-progress"></span>
      <button id="demoStop" class="demo-stop" type="button">■ Stop</button>
    </div>
    <div id="demoPrep" class="demo-prep hidden">
      <div class="demo-prep-title">Preparing narration…</div>
      <div class="demo-prep-bar"><i id="demoPrepFill"></i></div>
      <div id="demoPrepNote" class="demo-prep-note"></div>
    </div>
    <div id="demoCaption" class="demo-caption hidden"></div>`;
  document.body.appendChild(el);
  $("#demoStop").addEventListener("click", () => { _abort = true; });
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
  spot(el);
  el.focus?.();
  el.value = "";
  for (const ch of text) {
    if (_abort) return;
    el.value += ch;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(55);
  }
}

function goTab(name) {
  clearSpot();
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  btn?.click();          // 分頁切換沒有副作用，用真的按
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 設定分頁的子選單：走到某一張卡。key 對應卡片標題裡的關鍵字。
function goSetting(key) {
  goTab("settings");
  const want = { acoustic: "發音", voice: "聲音", cloud: "同步" }[key] || "";
  const rows = $$("#settingsIndex .setrow");
  const hit = rows.find((r) => (r.textContent || "").includes(want)) || rows[0];
  if (hit) { hit.click(); spot(hit); }
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
  demoSpeak(SAMPLE.candidates[0]);
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

function rehabDemo() {
  const card = $("#rehabPractice");
  if (!card) return;
  card.classList.remove("hidden");
  const disp = $("#rehabTargetDisplay");
  if (disp) disp.textContent = SAMPLE.rehab;
  const chips = $("#rehabChips");
  if (chips) chips.innerHTML = SAMPLE.rehab.split(" ")
    .map((w) => `<span class="chip">${w}</span>`).join("");
  spot(card);
  demoSpeak(SAMPLE.rehab);
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
  for (const v of [1.3, 1.6]) {
    if (_abort) break;
    root.style.setProperty("--font", v + "rem");
    await sleep(900);
  }
  await sleep(400);
  root.style.setProperty("--font", (_restore.font || 1) + "rem");
}

function langDemo(lang) {
  state.settings.lang = lang || _restore.lang;   // null＝還原
  applyI18n();
}

// ── 旁白 ────────────────────────────────────────────────────────────────

// 演示裡「App 講出來的話」（不是旁白）——用一般 TTS，跟使用者平常聽到的一樣。
function demoSpeak(text) { try { speak(text); } catch { /* 沒有語音也不能擋住演示 */ } }

async function pickNarrationVoice() {
  _voice = null;
  try {
    if (!(await detectLocalTts(2000))) return;
    const vs = await localVoices();
    const en = vs.find((v) => (v.lang || "").toUpperCase() === "EN");
    if (en) _voice = { name: en.name, lang: "EN" };
  } catch { /* 連不上就退瀏覽器語音 */ }
}

// 旁白預先合成的快取：句子文字 → object URL。
// 跨次執行保留（同一份腳本每次都一樣），所以第二次跑幾乎不用等。
const _clips = new Map();

/** 把選到的單元裡所有旁白先合成好。回實際成功的句數。 */
async function prepareNarration(units, onProgress) {
  const texts = [...new Set(units.flatMap((u) => u.steps.map((s) => s.cap)).filter(Boolean))];
  const todo = texts.filter((x) => !_clips.has(x));
  let ok = _clips.size;
  for (let i = 0; i < todo.length; i++) {
    if (_abort) break;
    onProgress(i, todo.length);
    try {
      const blob = await localSynth(todo[i], { name: _voice.name, lang: "EN", emotion: "中立" });
      if (blob) { _clips.set(todo[i], URL.createObjectURL(blob)); ok++; }
    } catch {
      // 這一句合不出來就留給瀏覽器語音，不要為了一句放棄整段旁白
    }
  }
  onProgress(todo.length, todo.length);
  return ok;
}

function playClip(url) {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.onended = a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}

// 旁白一句。**一定要等講完**才走下一步，否則字幕跟畫面會愈跑愈前面。
async function narrate(text) {
  if (!_narrate || !text) return;
  const url = _clips.get(text);
  if (url) { await playClip(url); return; }
  await browserNarrate(text);   // 預先合成時失敗（或根本沒有橋接）的那幾句
}

function browserNarrate(text) {
  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.95;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      // 保險：有些瀏覽器 onend 不會觸發（長句尤其），估時後放行。
      setTimeout(resolve, 1200 + text.length * 75);
    } catch { resolve(); }
  });
}

// ── 螢幕錄影 ────────────────────────────────────────────────────────────

function recSupported() {
  return !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: true,               // 分享「分頁」並勾選音訊才錄得到旁白
  });
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
  _chunks = [];
  _recStream = stream;
  _rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  _rec.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
  // 使用者在瀏覽器自己的分享列按「停止分享」→ 也要把檔案收好，不能就這樣丟掉。
  stream.getVideoTracks()[0].addEventListener("ended", () => { _abort = true; });
  _rec.start(1000);
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!_rec) { resolve(null); return; }
    const rec = _rec; _rec = null;
    rec.onstop = () => {
      try { _recStream?.getTracks().forEach((t) => t.stop()); } catch {}
      _recStream = null;
      resolve(_chunks.length ? new Blob(_chunks, { type: rec.mimeType || "video/webm" }) : null);
    };
    try { rec.stop(); } catch { resolve(null); }
  });
}

function download(blob) {
  if (!blob) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const name = `VoiceWeaver-Demo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.webm`;
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
          ? `${i} / ${n} lines${left ? ` · about ${Math.floor(left / 60)}m ${left % 60}s left` : ""}`
          : "Already prepared";
      });
      prep.classList.add("hidden");
    }
  }
  if (_abort) { restore(); ui().classList.add("hidden"); window.__VW_DEMO__ = false; return; }

  let recording = false;
  if (opts.record) {
    try { await startRecording(); recording = true; }
    catch (e) { alert("Screen recording was not started: " + (e?.message || e) + "\nThe demo will run without recording."); }
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
        // 動作與旁白同時跑：先讓畫面動起來，旁白在講的同時使用者已經看到變化。
        const acting = Promise.resolve().then(() => s.act?.()).catch(() => {});
        await Promise.all([acting, narrate(s.cap)]);
        await sleep(_narrate ? (s.hold ?? 350) : (s.hold ?? 1100));
      }
      clearSpot();
    }
  } finally {
    restore();
    ui().classList.add("hidden");
    window.__VW_DEMO__ = false;
    if (recording) download(await stopRecording());
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

  const est = () => {
    const ids = new Set(chosen());
    const s = UNITS().filter((u) => ids.has(u.id)).reduce((n, u) => n + u.est, 0);
    const narrated = $("#demoNarrate")?.checked;
    // 有旁白時每一步要等語音講完，實測約 1.8 倍。
    const total = Math.round(s * (narrated ? 1.8 : 1));
    $("#demoEst").textContent = `${ids.size} sections · about ${Math.floor(total / 60)}m ${total % 60}s`;
  };

  box.addEventListener("change", () => { savePicked(chosen()); est(); });
  $("#demoNarrate")?.addEventListener("change", est);
  $("#demoAll")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = true); savePicked(chosen()); est(); });
  $("#demoNone")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = false); savePicked(chosen()); est(); });

  if (!recSupported()) {
    const r = $("#demoRecord");
    if (r) { r.checked = false; r.disabled = true; }
    const hint = $("#demoRecHint");
    if (hint) hint.textContent = "Screen recording is not available in this browser — use a desktop browser, or record with an external tool.";
  }

  $("#demoStart")?.addEventListener("click", async () => {
    const ids = chosen();
    if (!ids.length) { alert("Select at least one section."); return; }
    await run(ids, {
      narrate: !!$("#demoNarrate")?.checked,
      record: !!$("#demoRecord")?.checked,
    });
  });

  est();
}
