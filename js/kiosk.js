// 重症／高齡防呆模式（Kiosk）：去科技化全螢幕圖卡 + 單一情境鎖定。
//
// 設計原則（給看不懂手機、對科技排斥的長輩）：
//   • 畫面上「只有卡片」——無選單、無齒輪、無返回鍵，看起來像一張塑膠墊板。
//   • 怎麼按都不會跳走：唯一出口是照護者「右上角隱形區連點 5 下 → 輸入 PIN」。
//   • 點卡片＝立即朗讀＋放大微動畫（建立因果關係與信任）。
//   • 所有觸發都綁 pointerup + 防連點（顫抖誤觸只算一次），全面禁止長按。
import { state, save } from "./store.js?v=1.5.16";
import { speakUpbeat } from "./speech.js?v=1.5.16";
import { severeCore } from "./aac.js?v=1.5.16";
import { bindTap } from "./interaction.js?v=1.5.16";   // 共用觸控防呆（pointerup + 防連點 + 禁長按）

const $ = (s)=>document.querySelector(s);
const esc = (s)=>String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// 零門檻探索（Discovery）：點卡先給極短提示音——「我按了、它有反應」，
// 搭配放大動畫建立因果關係認知。音量低、時長 0.12s，不蓋過朗讀。
let _ac = null;
function tapBeep(){
  try{
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    if(_ac.state === "suspended") _ac.resume();
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.type = "sine"; o.frequency.value = 740;
    g.gain.setValueAtTime(0.12, _ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + 0.12);
    o.connect(g); g.connect(_ac.destination);
    o.start(); o.stop(_ac.currentTime + 0.13);
  }catch{}
}

export function kioskActive(){ return !$("#kiosk").classList.contains("hidden"); }

/** 重度卡片來源（整合自「大圖卡」，不再有獨立情境卡）：
 *  家人自建照片卡優先（最貼近病人、只有家人懂）；沒有就用核心生活必需卡。 */
function severeCards(){
  if((state.customCards||[]).length) return state.customCards.map(c=>({ img: c.img, word: c.word }));
  return severeCore().map(({ emoji, word })=>({ emoji, word }));
}

// 螢幕常亮：長輩盯著板子時螢幕不熄滅（熄了會恐慌）。頁面被切走再回來時自動續約。
let _wake = null;
async function grabWakeLock(){
  try{ _wake = await navigator.wakeLock?.request("screen"); }catch{ /* 不支援/被拒＝維持原樣 */ }
}
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "visible" && document.querySelector("#kiosk") && kioskActive()) grabWakeLock();
});

// ── 線索列 ──────────────────────────────────────────
// 設計核心：最嚴重的病人，最後是「熟悉家人去猜」，不是 AI 去講出正確答案。
// 點過的卡留在畫面頂端累積成一串「線索」，家人看著這串去猜病人的意思——
// 這裡完全不碰 AI、不組句、不解讀，只是把病人指過的東西留著、可重播。
let _trail = [];    // 線索：最近點的卡
const TRAIL_MAX = 6;

function pushTrail(card){
  _trail.push({ emoji: card.emoji, img: card.img, word: card.word });
  if(_trail.length > TRAIL_MAX) _trail = _trail.slice(-TRAIL_MAX);
  renderTrail();
}
function renderTrail(){
  const box = $("#kioskTrail");
  if(!box) return;
  if(!_trail.length){ box.innerHTML = ""; return; }
  box.innerHTML =
    `<button class="ktrail-ctl" data-act="replay" aria-label="replay">▶</button>` +
    `<button class="ktrail-ctl" data-act="clear" aria-label="clear">✕</button>` +
    _trail.map((c,i)=>
      `<div class="ktrail-item" data-i="${i}">${
        // emoji 與文字都跳脫了，img 卻沒有——自建照片卡會跨裝置同步過來，
        // 內容不是這支程式產生的就不能當成安全的。
        c.img ? `<img src="${esc(c.img)}" alt="" draggable="false" />` : `<span class="ke">${esc(c.emoji)}</span>`
      }<span class="kw">${esc(c.word)}</span></div>`).join("");
  // 點單張線索＝重唸那一個（幫家人確認）；整串重播；清空——都是家人操作，不碰 AI
  box.querySelectorAll(".ktrail-item").forEach(el=>bindTap(el, ()=>{
    tapBeep(); speakUpbeat(_trail[+el.dataset.i].word);
  }, 250));
  bindTap(box.querySelector('[data-act="replay"]'), replayTrail, 400);
  bindTap(box.querySelector('[data-act="clear"]'), ()=>{ _trail = []; renderTrail(); }, 300);
}
async function replayTrail(){
  for(const c of _trail){ speakUpbeat(c.word); await new Promise(r=>setTimeout(r, 950)); }
}

export function enterKiosk(){
  _trail = []; renderTrail();   // 每次進入是新的一段對話
  startScan();
  $("#kioskPin").classList.add("hidden");
  $("#kiosk").classList.remove("hidden");
  document.body.classList.add("kiosk-on");
  // 全螢幕：連瀏覽器網址列都收起來＝看起來就是一塊板子（重載自動進入時瀏覽器會拒絕，安靜略過）
  try{ document.documentElement.requestFullscreen?.()?.catch(()=>{}); }catch{}
  grabWakeLock();
}

export function exitKiosk(){
  stopScan();
  $("#kiosk").classList.add("hidden");
  $("#kioskPin").classList.add("hidden");
  document.body.classList.remove("kiosk-on");
  try{ _wake?.release(); }catch{} _wake = null;
  try{ if(document.fullscreenElement) document.exitFullscreen()?.catch(()=>{}); }catch{}
}

// ── 重度＝全螢幕識字卡「逐張掃描」＋特大字體 ──
// 一次只顯示一張大卡，每 3 秒自動換下一張（掃描）；家人／病人看到對的那張就點畫面唸出來、
// 也可按「下一張」手動翻。點卡＝唸＋進線索列。給無法在一堆卡裡準確指的最嚴重者。
let _scan = [];
let _idx = 0;
let _scanTimer = null;
const SCAN_MS = 3000;

function renderScanCard(){
  const box = $("#kioskCards");
  if(!box || !_scan.length) return;
  const c = _scan[_idx % _scan.length];
  box.dataset.n = 1;
  box.innerHTML =
    `<div class="kcard kscan" data-w="${esc(c.word)}">${
      c.img ? `<img class="kimg" src="${c.img}" alt="" draggable="false" />`
            : `<span class="kemoji">${esc(c.emoji)}</span>`
    }<span class="kword">${esc(c.word)}</span></div>`;
  const card = box.querySelector(".kcard");
  card.classList.remove("scanpulse"); void card.offsetWidth; card.classList.add("scanpulse");
  bindTap(card, ()=>{                       // 點目前這張＝唸出＋進線索，並讓掃描重新計時（別馬上跳走）
    card.classList.add("tapped");
    tapBeep(); speakUpbeat(c.word); pushTrail(c);
    restartScan();
  });
}
function advance(n){ if(_scan.length){ _idx = (_idx + n + _scan.length) % _scan.length; renderScanCard(); } }
function restartScan(){ clearInterval(_scanTimer); _scanTimer = setInterval(()=>advance(1), SCAN_MS); }
function startScan(){ _scan = severeCards(); _idx = 0; renderScanCard(); restartScan(); }
function stopScan(){ clearInterval(_scanTimer); _scanTimer = null; }

// ── 照護者退出：右上角按鈕 → PIN ──
let _pinBuf = "";
let _onExit = null;

function openPin(){
  _pinBuf = "";
  renderPinDots();
  $("#kioskPin").classList.remove("hidden");
}

function pressKey(d){
  if(d === "⌫"){ _pinBuf = _pinBuf.slice(0, -1); renderPinDots(); return; }
  _pinBuf = (_pinBuf + d).slice(0, 4);
  renderPinDots();
  if(_pinBuf.length === 4){
    if(_pinBuf === (state.settings.kioskPin || "1234")){
      state.settings.severityMode = "mild";   // 退出＝回照護者介面（重新整理也不會再進重度）
      document.body.classList.remove("sev-severe", "sev-moderate");
      save();
      exitKiosk();
      _onExit?.();
    } else {
      _pinBuf = "";
      const dots = $("#kioskPinDots");
      dots.classList.add("shake");
      setTimeout(()=>dots.classList.remove("shake"), 400);
      renderPinDots();
    }
  }
}

function renderPinDots(){
  $("#kioskPinDots").innerHTML = [0,1,2,3].map(i=>
    `<span class="kiosk-dot ${i < _pinBuf.length ? "full" : ""}"></span>`).join("");
}

/** 啟動時呼叫一次：綁退出熱區與 PIN 鍵盤。 */
export function setupKiosk({ onExit } = {}){
  _onExit = onExit || null;
  // 點一下就跳 PIN。以前要 3 秒內連點 5 下，照護者自己也常按不出來——
  // 而防呆本來就該由 PIN 負責，按鈕好按不影響安全性：沒有密碼一樣出不去。
  bindTap($("#kioskExitZone"), openPin, 300);
  const pad = $("#kioskPinPad");
  pad.innerHTML = [1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(d=>
    d === "" ? `<span></span>` : `<button class="kiosk-pin-key" data-d="${d}">${d}</button>`).join("");
  pad.querySelectorAll(".kiosk-pin-key").forEach(b=>bindTap(b, ()=>pressKey(b.dataset.d), 150));
  bindTap($("#kioskPinCancel"), ()=>$("#kioskPin").classList.add("hidden"), 150);
  // 手動「下一張」：家人也能自己翻，不必等自動掃描
  bindTap($("#kioskNext"), ()=>{ advance(1); restartScan(); }, 200);
}
