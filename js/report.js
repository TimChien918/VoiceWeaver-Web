// 成績單：讀 Firestore rehabLogs，三段時間維度，統計 + 折線趨勢 + Telegram 匯出。
import { state } from "./store.js";
import { listRehabLogs } from "./store.js";
import { t } from "./i18n.js";

const esc = (x)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
let toast = (m)=>console.log(m);
let curRange = "month";

export function setReportToast(fn){ toast = fn; }

const POSITIVE = ["謝謝","好","喜歡","開心","高興","幸福","舒服","加油"];
function countPositive(text){
  return POSITIVE.reduce((n,w)=>{ let i=0,c=0; while(true){const f=(text||"").indexOf(w,i); if(f<0)break; c++; i=f+w.length;} return n+c; },0);
}

function rangeFrom(range){
  const d = new Date();
  if(range==="today"){ d.setHours(0,0,0,0); }
  else if(range==="month"){ d.setDate(1); d.setHours(0,0,0,0); }
  else { d.setMonth(0,1); d.setHours(0,0,0,0); }
  return d.getTime();
}

export function setupReport(){
  $$("#reportRange .chip").forEach(c=>c.addEventListener("click",()=>{
    curRange = c.dataset.r;
    $$("#reportRange .chip").forEach(x=>x.classList.remove("on"));
    c.classList.add("on");
    loadReport();
  }));
  $("#reportTg").addEventListener("click", sendTelegram);
  $("#reportCsv")?.addEventListener("click", exportCsv);
}

function computeStreak(timestamps){
  if(!timestamps.length) return 0;
  const dayMs = 86400000;
  const dayIdx = t => Math.floor(new Date(new Date(t).setHours(0,0,0,0)).getTime()/dayMs);
  const days = new Set(timestamps.map(dayIdx));
  const today = dayIdx(Date.now());
  let cursor = days.has(today) ? today : (days.has(today-1) ? today-1 : null);
  if(cursor===null) return 0;
  let s = 0;
  while(days.has(cursor)){ s++; cursor--; }
  return s;
}

async function exportCsv(){
  const logs = await listRehabLogs(0);
  if(!logs.length){ toast(t("report.nothingToExport")); return; }
  const rows = ["﻿時間,場景,目標句,分數"];
  logs.sort((a,b)=>b.timestamp-a.timestamp).forEach(l=>{
    const dt = new Date(l.timestamp).toLocaleString("zh-TW");
    rows.push(`${dt},${l.locationTag||""},"${(l.targetSentence||"").replace(/"/g,'""')}",${l.score}`);
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "voiceweaver_成績報告.csv";
  a.click(); URL.revokeObjectURL(url);
  toast(t("report.csvDone"));
}

export async function loadReport(){
  const logs = await listRehabLogs(rangeFrom(curRange));
  const sessions = logs.length;
  const avg = sessions ? Math.round(logs.reduce((s,l)=>s+(l.score||0),0)/sessions) : 0;
  const positive = logs.reduce((s,l)=>s+countPositive(l.targetSentence||""),0);

  $("#statSessions").textContent = sessions;
  $("#statAvg").textContent = sessions ? avg : "—";
  $("#statPositive").textContent = positive;

  // 連續練習天數（用全部紀錄算，不受時間區間限制）
  const allLogs = await listRehabLogs(0);
  const streak = computeStreak(allLogs.map(l=>l.timestamp));
  const streakEl = $("#statStreak");
  if(streakEl) streakEl.textContent = streak > 0 ? `🔥${streak}` : "—";

  drawChart(logs, curRange);

  const list = logs.slice(0,10);
  $("#reportLogs").innerHTML = list.length ? list.map(l=>{
    const cls = l.score>=80?"good":l.score>=50?"mid":"low";
    return `<div class="hitem"><div class="row" style="margin:0;gap:10px">
      <span class="score-pill ${cls}">${l.score}</span>
      <div><div class="h-main">${esc(l.targetSentence||"")}</div>
      <div class="h-sub">${l.locationTag||""} · ${new Date(l.timestamp).toLocaleDateString()}</div></div></div></div>`;
  }).join("") : `<p class="tiny muted center">${t("report.noLogsRange")}</p>`;
}

function drawChart(logs, range){
  const cv = $("#reportChart");
  if(!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.clientWidth || 320, H = 150;
  cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
  cv.style.height = H+"px";
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,W,H);

  const css = (v)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const accent = css("--accent")||"#0a84ff", muted = css("--muted")||"#888", line = css("--line")||"#ddd";

  if(!logs.length){
    ctx.fillStyle = muted; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t("report.noData"), W/2, H/2); return;
  }

  // bucket by day（today 用時段、year 用月）
  const buckets = {};
  for(const l of logs){
    const d = new Date(l.timestamp);
    const key = range==="year" ? d.toLocaleDateString(document.documentElement.lang||"zh-TW",{month:"short"})
      : range==="today" ? `${String(d.getHours()).padStart(2,"0")}:00`
      : `${d.getMonth()+1}/${d.getDate()}`;
    (buckets[key] ||= []).push(l.score||0);
  }
  const keys = Object.keys(buckets).reverse();
  const vals = keys.map(k=>Math.round(buckets[k].reduce((a,b)=>a+b,0)/buckets[k].length));

  const pad = { l:32, r:12, t:10, b:22 };
  const gW = W-pad.l-pad.r, gH = H-pad.t-pad.b;
  const xStep = keys.length>1 ? gW/(keys.length-1) : 0;
  const xOf = (i)=> pad.l + (keys.length>1 ? i*xStep : gW/2);
  const yOf = (v)=> pad.t + gH - (v/100)*gH;

  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.font = "10px sans-serif";
  [0,25,50,75,100].forEach(v=>{
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+gW,y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(v, pad.l-4, y+3);
  });

  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
  vals.forEach((v,i)=>{ const x=xOf(i), y=yOf(v); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.stroke();

  ctx.fillStyle = accent;
  vals.forEach((v,i)=>{ ctx.beginPath(); ctx.arc(xOf(i),yOf(v),3.5,0,Math.PI*2); ctx.fill(); });

  ctx.fillStyle = muted; ctx.textAlign = "center";
  const step = Math.ceil(keys.length/7);
  keys.forEach((k,i)=>{ if(i%step===0||i===keys.length-1) ctx.fillText(k, xOf(i), H-6); });
}

async function sendTelegram(){
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat){ toast(t("report.needTg")); return; }
  const label = { today:"今日", month:"本月", year:"本年度" }[curRange];
  const msg = `📊 VoiceWeaver 成績單 · ${label}\n─────────────\n`+
    `🎯 練習次數：${$("#statSessions").textContent}\n`+
    `📈 平均分數：${$("#statAvg").textContent} / 100\n`+
    `💖 正向情緒字眼：${$("#statPositive").textContent} 次\n\n（由網頁版傳送）`;
  try{
    const r = await fetch(`https://api.telegram.org/bot${tgtoken}/sendMessage`,{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ chat_id: tgchat, text: msg }) });
    const j = await r.json();
    toast(j.ok ? t("report.tgSent") : t("report.tgFail")+" "+(j.description||""));
  }catch(e){ toast(t("report.tgFail")+"："+(e.message||e)); }
}
