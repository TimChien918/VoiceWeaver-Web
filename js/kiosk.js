// 重症／高齡防呆模式（Kiosk）：去科技化全螢幕圖卡 + 單一情境鎖定。
//
// 設計原則（給看不懂手機、對科技排斥的長輩）：
//   • 畫面上「只有卡片」——無選單、無齒輪、無返回鍵，看起來像一張塑膠墊板。
//   • 怎麼按都不會跳走：唯一出口是照護者「右上角隱形區連點 5 下 → 輸入 PIN」。
//   • 點卡片＝立即朗讀＋放大微動畫（建立因果關係與信任）。
//   • 所有觸發都綁 pointerup + 防連點（顫抖誤觸只算一次），全面禁止長按。
import { state, save } from "./store.js";
import { speakUpbeat } from "./speech.js";
import { SCENARIOS } from "./aac.js";
import { bindTap } from "./interaction.js";   // 共用觸控防呆（pointerup + 防連點 + 禁長按）

const $ = (s)=>document.querySelector(s);

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

/** 目前鎖定情境的卡片，統一成 [{emoji?, img?, word}]。
 *  "__custom"＝照護者拍的「自己照片卡」（熟悉的東西最能建立信任）；沒設或設錯 → 第一個內建情境。 */
function currentScenarioCards(){
  if(state.settings.kioskScenario === "__custom" && (state.customCards||[]).length){
    return state.customCards.map(c=>({ img: c.img, word: c.word }));
  }
  const sc = SCENARIOS[state.settings.kioskScenario] || Object.values(SCENARIOS)[0];
  return sc.cards.map(([emoji, word])=>({ emoji, word }));
}

export function enterKiosk(){
  renderCards();
  $("#kioskPin").classList.add("hidden");
  $("#kiosk").classList.remove("hidden");
  document.body.classList.add("kiosk-on");
}

export function exitKiosk(){
  $("#kiosk").classList.add("hidden");
  $("#kioskPin").classList.add("hidden");
  document.body.classList.remove("kiosk-on");
}

function renderCards(){
  const cards = currentScenarioCards().slice(0, 4);    // 情境最多 4 張（2×2）
  const box = $("#kioskCards");
  box.dataset.n = cards.length;                        // CSS 依張數排 1×2 / 2×2
  box.innerHTML = cards.map(c=>
    `<div class="kcard" data-w="${c.word}">${
      c.img ? `<img class="kimg" src="${c.img}" alt="" draggable="false" />`
            : `<span class="kemoji">${c.emoji}</span>`
    }<span class="kword">${c.word}</span></div>`
  ).join("");
  box.querySelectorAll(".kcard").forEach(c=>bindTap(c, ()=>{
    c.classList.remove("tapped"); void c.offsetWidth;  // 重新觸發動畫
    c.classList.add("tapped");
    tapBeep();                                         // 因果提示音（Discovery）
    speakUpbeat(c.dataset.w);                          // 點擊立即「輕快」朗讀單字
  }));
}

// ── 照護者退出：右上角隱形區 3 秒內連點 5 下 → PIN ──
let _taps = [];
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
      state.settings.uiMode = "mild";   // 退出＝回照護者介面（重新整理也不會再進防呆）
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
  bindTap($("#kioskExitZone"), ()=>{
    const now = Date.now();
    _taps = _taps.filter(ts=>now - ts < 3000);
    _taps.push(now);
    if(_taps.length >= 5){ _taps = []; openPin(); }
  }, 120);   // 熱區容許快速連點（照護者刻意動作）
  const pad = $("#kioskPinPad");
  pad.innerHTML = [1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(d=>
    d === "" ? `<span></span>` : `<button class="kiosk-pin-key" data-d="${d}">${d}</button>`).join("");
  pad.querySelectorAll(".kiosk-pin-key").forEach(b=>bindTap(b, ()=>pressKey(b.dataset.d), 150));
  bindTap($("#kioskPinCancel"), ()=>$("#kioskPin").classList.add("hidden"), 150);
}
