// 語音復健：聽整句(TTS) → 點字卡發音 → 跟讀錄音(STT) → Levenshtein 評分 → 記錄。
// 全部走瀏覽器原生 Web Speech API + 純前端計分，免金鑰、免後端，與 App 端 RehabScreen 對齊。
import { speak, listen, sttSupported } from "./speech.js";
import { suggestRehabSentences, hasAnyLlmKey } from "./llm.js";

const $ = (s)=>document.querySelector(s);

// ── 臨床題庫（取自漢語標準失語症檢查表常用復述/命名範式，臨床通用內容）──
const BANK = {
  "字詞（名詞）": ["水","杯子","碗","筷子","毛巾","牙刷","雨傘","鑰匙","眼鏡","手機","椅子","冰箱"],
  "字詞（動作）": ["坐","站","走","吃飯","喝水","洗手","刷牙","開門","關燈","休息"],
  "短句": ["我想喝水","我要吃飯","我想休息","我要上廁所","我會痛","我想回家","請等一下","請再說一次"],
  "情境句": ["今天天氣很好，我想去公園走走","可以幫我打電話給家人嗎","請問現在幾點，我該吃藥了","我覺得有點不舒服，需要休息一下"],
};

const LOG_KEY = "voiceweaver_rehab_logs";

// ── 評分：與 App 的 PronunciationEvaluator 同演算法 ──
function normalize(s){ return (s||"").replace(/[^\p{L}\p{N}]/gu, ""); }
function levenshtein(a, b){
  const m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,i)=>i), curr=new Array(n+1);
  for(let i=1;i<=m;i++){
    curr[0]=i;
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      curr[j]=Math.min(prev[j]+1, curr[j-1]+1, prev[j-1]+cost);
    }
    [prev,curr]=[curr,prev];
  }
  return prev[n];
}
function score(target, recognized){
  const t=normalize(target), r=normalize(recognized);
  if(!t || !r) return 0;
  const maxLen=Math.max(t.length, r.length);
  return Math.max(0, Math.min(100, Math.round((1 - levenshtein(t,r)/maxLen)*100)));
}
// 回傳 hex（後面會接 "1f" 當淡背景的 alpha，故不可用 var()）
function scoreColor(s){ return s>=80?"#34c759":s>=50?"#ff9f0a":"#ff3b30"; }

// ── 記錄（localStorage，與 App 的本機復健日誌對齊）──
function getLogs(){ try{ return JSON.parse(localStorage.getItem(LOG_KEY)||"[]"); }catch{ return []; } }
function addLog(target, sc, heard){
  const logs=getLogs(); logs.unshift({ target, score:sc, heard, ts:Date.now() });
  localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0,50)));
}
function clearLogs(){ localStorage.removeItem(LOG_KEY); }

// ── 狀態 ──
let target = "";
let mic = null;
let toastFn = (m)=>console.log(m);

function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
// 中文逐字切；含空白（英文）則依空白切。標點不做成字卡。
function toChips(s){
  const t=(s||"").trim();
  return /\s/.test(t) ? t.split(/\s+/).filter(Boolean) : [...t].filter(c=>/[\p{L}\p{N}]/u.test(c));
}

// ── 渲染：挑句子 ──
function renderPicker(){
  $("#rehabPractice").classList.add("hidden");
  const picker = $("#rehabPicker");
  picker.classList.remove("hidden");
  picker.innerHTML = `
    <h3>🎯 選一句來練</h3>
    <p class="tiny muted">自己打一句、用 AI 推薦情境句，或點臨床常用題庫一鍵開始。</p>
    <textarea id="rehabInput" rows="2" placeholder="例：我想喝水"></textarea>
    <button id="rehabStart" class="btn primary big">▶ 用這句開始練習</button>
    <div style="margin-top:14px">
      <button id="rehabAi" class="btn" style="width:100%;background:#ff9f0a;color:#fff">✨ AI 推薦情境句</button>
      <div id="rehabAiList"></div>
    </div>
    <div id="rehabBank" style="margin-top:14px"></div>`;
  const bank = $("#rehabBank");
  bank.innerHTML = Object.entries(BANK).map(([label,items])=>`
    <p class="lbl" style="margin-top:10px">${label}</p>
    <div class="chips">${items.map(w=>`<span class="chip rehab-pick" data-w="${esc(w)}">${esc(w)}</span>`).join("")}</div>
  `).join("");
  $("#rehabStart").addEventListener("click", ()=>{
    const v=$("#rehabInput").value.trim(); if(v) start(v);
  });
  bank.querySelectorAll(".rehab-pick").forEach(c=>c.addEventListener("click", ()=>start(c.dataset.w)));
  // AI 推薦情境句
  $("#rehabAi").addEventListener("click", async ()=>{
    if(!hasAnyLlmKey()){ toastFn("需先到設定頁新增文字供應商金鑰才能用 AI 推薦"); return; }
    const btn=$("#rehabAi"), old=btn.textContent; btn.disabled=true; btn.textContent="產生中…";
    try{
      const sents = await suggestRehabSentences();
      const list=$("#rehabAiList");
      list.innerHTML = sents.length
        ? `<div class="chips" style="margin-top:8px">${sents.map(s=>`<span class="chip rehab-ai" data-w="${esc(s)}">${esc(s)}</span>`).join("")}</div>`
        : '<p class="tiny muted" style="margin-top:8px">沒有產生結果，再試一次</p>';
      list.querySelectorAll(".rehab-ai").forEach(c=>c.addEventListener("click", ()=>start(c.dataset.w)));
    }catch(e){ toastFn("AI 推薦失敗："+(e.message||e)); }
    finally{ btn.disabled=false; btn.textContent=old; }
  });
  renderLogs();
}

// ── 渲染：練習卡 ──
function renderPractice(){
  $("#rehabPicker").classList.add("hidden");
  const box = $("#rehabPractice");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="row" style="margin:0">
      <span class="tiny muted" style="flex:1">目標句</span>
      <span class="chip" id="rehabChange">換一句</span>
    </div>
    <div class="result-text" style="padding:8px 0 12px">${esc(target)}</div>
    <p class="tiny muted">① 先聽整句</p>
    <button id="rehabListen" class="btn primary" style="width:100%">🔊 播放整句</button>
    <p class="tiny muted" style="margin-top:12px">② 點字卡逐字聽發音</p>
    <div class="chips" id="rehabChips">${toChips(target).map((c,i)=>`<span class="chip rehab-chip" data-i="${i}">${esc(c)}</span>`).join("")}</div>
    <p class="tiny muted" style="margin-top:12px">③ 跟著唸一次，系統會評分</p>
    <button id="rehabRec" class="btn" style="width:100%;background:var(--accent2);color:#fff">🎤 開始跟讀</button>
    <div id="rehabResult"></div>`;
  $("#rehabChange").addEventListener("click", ()=>{ stopMic(); renderPicker(); });
  $("#rehabListen").addEventListener("click", ()=>speak(target));
  const chips = toChips(target);
  box.querySelectorAll(".rehab-chip").forEach(el=>el.addEventListener("click", ()=>speak(chips[+el.dataset.i])));
  $("#rehabRec").addEventListener("click", toggleRecord);
  renderLogs();
}

function start(s){ target=s; renderPractice(); speak(s); }

function stopMic(){ if(mic){ try{mic.stop();}catch{} mic=null; } }

function toggleRecord(){
  const btn=$("#rehabRec");
  if(mic){ stopMic(); btn.textContent="🎤 開始跟讀"; btn.style.background="var(--accent2)"; return; }
  if(!sttSupported()){ toastFn("此瀏覽器不支援語音輸入（建議 Chrome/Edge）"); return; }
  btn.textContent="● 收音中…點此停止"; btn.style.background="var(--danger)";
  mic = listen({
    onResult:()=>{},
    onEnd:(heard)=>{
      mic=null; btn.textContent="🎤 開始跟讀"; btn.style.background="var(--accent2)";
      const sc=score(target, heard);
      addLog(target, sc, heard);
      showResult(sc, heard);
      renderLogs();
    },
    onError:(e)=>{ mic=null; btn.textContent="🎤 開始跟讀"; btn.style.background="var(--accent2)"; toastFn("語音："+e); }
  });
}

function showResult(sc, heard){
  const c=scoreColor(sc);
  const tag = sc>=80?"很棒！":sc>=50?"不錯，再加油":"再試一次";
  $("#rehabResult").innerHTML = `
    <div style="margin-top:12px;padding:12px;border-radius:12px;border:1px solid ${c};background:${c}1f">
      <div class="row" style="margin:0;align-items:baseline">
        <span style="font-size:34px;font-weight:800;color:${c}">${sc}</span>
        <span style="color:${c};font-weight:700">分</span>
        <span class="spacer"></span>
        <span class="tiny" style="color:${c}">${tag}</span>
      </div>
      ${heard?`<p class="tiny muted" style="margin:6px 0 0">聽到：${esc(heard)}</p>`:""}
    </div>`;
}

// ── 渲染：紀錄 ──
function renderLogs(){
  const box=$("#rehabLogs"); const logs=getLogs();
  if(!logs.length){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="row" style="margin:0"><span class="tiny muted" style="flex:1">最近練習</span>
    <span class="chip" id="rehabClear" style="color:var(--danger)">清除</span></div>` +
    logs.slice(0,20).map(l=>{
      const c=scoreColor(l.score);
      return `<div class="hitem"><div class="row" style="margin:0;align-items:center">
        <span style="display:inline-flex;width:38px;height:38px;border-radius:8px;align-items:center;justify-content:center;font-weight:800;color:${c};border:1px solid ${c};background:${c}1f">${l.score}</span>
        <div style="flex:1;margin-left:10px"><div class="h-main" style="font-size:.9rem">${esc(l.target)}</div>
        <div class="h-sub">${new Date(l.ts).toLocaleString()}</div></div></div></div>`;
    }).join("");
  $("#rehabClear").addEventListener("click", ()=>{ clearLogs(); renderLogs(); });
}

export function setupRehab({ toast }){
  toastFn = toast || toastFn;
  renderPicker();
}
