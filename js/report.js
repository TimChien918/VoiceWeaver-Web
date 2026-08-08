// 成績單：讀 Firestore rehabLogs，三段時間維度，統計 + 折線趨勢 + Telegram 匯出。
import { state } from "./store.js?v=1.5.23";
import { listRehabLogs } from "./store.js?v=1.5.23";
import { t } from "./i18n.js?v=1.5.23";
import { behaviorSummary } from "./behavior.js?v=1.5.23";

const esc = (x)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
let toast = (m)=>console.log(m);
let curRange = "month";

export function setReportToast(fn){ toast = fn; }

// 比對用關鍵字，**不可翻譯**：這是拿來掃描患者中文語料的，翻掉就統計不到了
// （同 App 的 I18n 規則：只翻顯示文字，比對用的中文關鍵字一律留原文）。
//
// **不可以放單獨一個「好」。** 舊版放了，而比對是純 indexOf 子字串搜尋，
// 所以「我不好」「不好意思」「我這裡好痛」全部被算成正向情緒。
// 「好痛」被記成正向，是把最需要被看見的疼痛訊號反向記進治療師的報表裡。
// 與 App 的 ReportAggregator.POSITIVE_WORDS 同一份清單、同一套否定詞規則。
const POSITIVE = ["謝謝","喜歡","開心","高興","幸福","舒服","加油",
                  "很好","好多了","太好了","好棒","好極了"];
/** 否定詞。緊接在正向詞前面時那一次不算——「不喜歡」跟「喜歡」是相反的意思。 */
const NEGATIONS = ["不","沒","別","無","未","毋"];
function countPositive(text){
  const s = text || "";
  return POSITIVE.reduce((n,w)=>{
    let i=0,c=0;
    while(true){
      const f = s.indexOf(w,i);
      if(f<0) break;
      if(!(f>0 && NEGATIONS.includes(s[f-1]))) c++;
      i = f + w.length;
    }
    return n+c;
  },0);
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
  $("#reportPdf")?.addEventListener("click", exportPdf);
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
  const rows = ["﻿" + t("report.csvHeader")];
  logs.sort((a,b)=>b.timestamp-a.timestamp).forEach(l=>{
    const dt = new Date(l.timestamp).toLocaleString(document.documentElement.lang || "zh-TW");
    rows.push(`${dt},${l.locationTag||""},"${(l.targetSentence||"").replace(/"/g,'""')}",${l.score}`);
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = t("report.csvName");
  a.click(); URL.revokeObjectURL(url);
  toast(t("report.csvDone"));
}

// PDF 匯出：開一個乾淨的列印視窗讓瀏覽器產生 PDF。
// 不引第三方函式庫——這頁本來就沒有打包流程，而且列印對話框本身就能存成 PDF，
// 中日韓字型也直接沿用系統的，不必自己嵌字型。
async function exportPdf(){
  const logs = await listRehabLogs(rangeFrom(curRange));
  if(!logs.length){ toast(t("report.nothingToExport")); return; }
  const label = t({ today:"report.today", month:"report.month", year:"report.year" }[curRange]);
  const bm = behaviorSummary();
  const lang = document.documentElement.lang || "zh-TW";
  const rows = logs.sort((a,b)=>b.timestamp-a.timestamp).map(l=>
    `<tr><td>${esc(new Date(l.timestamp).toLocaleString(lang))}</td>
         <td>${esc(l.locationTag||"")}</td>
         <td>${esc(l.targetSentence||"")}</td>
         <td style="text-align:right">${esc(l.score)}</td></tr>`).join("");
  const sessions = logs.length;
  const avg = Math.round(logs.reduce((s,l)=>s+(l.score||0),0)/sessions);
  const w = window.open("", "_blank");
  if(!w){ toast(t("report.nothingToExport")); return; }
  w.document.write(`<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
    <title>${esc(t("report.pdfTitle"))} · ${esc(label)}</title>
    <style>
      body{ font-family:-apple-system,"PingFang TC","Hiragino Sans","Malgun Gothic",system-ui,sans-serif;
            margin:32px; color:#111; }
      h1{ font-size:20px; margin:0 0 4px; } .sub{ color:#666; font-size:12px; margin-bottom:18px; }
      .grid{ display:flex; gap:24px; margin-bottom:18px; font-size:13px; }
      .grid div b{ display:block; font-size:20px; }
      table{ width:100%; border-collapse:collapse; font-size:12px; }
      th,td{ border-bottom:1px solid #ddd; padding:6px 4px; text-align:left; }
      th{ background:#f4f4f6; }
    </style></head><body>
    <h1>${esc(t("report.pdfTitle"))}</h1>
    <div class="sub">${esc(label)} · ${esc(new Date().toLocaleString(lang))}</div>
    <div class="grid">
      <div>${esc(t("report.sessions"))}<b>${sessions}</b></div>
      <div>${esc(t("report.avg"))}<b>${avg}</b></div>
      <div>${esc(t("report.bmReaction"))}<b>${bm.reactionSec==null?"—":bm.reactionSec.toFixed(1)+"s"}</b></div>
      <div>${esc(t("report.bmPick"))}<b>${bm.firstHitPct==null?"—":bm.firstHitPct+"%"}</b></div>
      <div>${esc(t("report.bmCard"))}<b>${bm.aacPct==null?"—":bm.aacPct+"%"}</b></div>
    </div>
    <table><thead><tr>
      <th>${esc(t("report.csvHeader").split(",")[0])}</th>
      <th>${esc(t("report.csvHeader").split(",")[1])}</th>
      <th>${esc(t("report.csvHeader").split(",")[2])}</th>
      <th style="text-align:right">${esc(t("report.csvHeader").split(",")[3])}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(), 300);   // 等字型與版面就緒再叫列印
}

export async function loadReport(){
  const logs = await listRehabLogs(rangeFrom(curRange));
  const sessions = logs.length;
  const avg = sessions ? Math.round(logs.reduce((s,l)=>s+(l.score||0),0)/sessions) : 0;
  const positive = logs.reduce((s,l)=>s+countPositive(l.targetSentence||""),0);

  // 行為數據（全期累計，不隨上面的期間切換）。沒有樣本顯示「—」，不假裝有 0。
  const bm = behaviorSummary();
  const setBm = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  setBm("#bmReaction", bm.reactionSec == null ? "—" : bm.reactionSec.toFixed(1) + "s");
  setBm("#bmPick",     bm.firstHitPct == null ? "—" : bm.firstHitPct + "%");
  setBm("#bmEdit",     bm.undoCount);
  setBm("#bmCard",     bm.aacPct == null ? "—" : bm.aacPct + "%");

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
  const label = t({ today:"report.today", month:"report.month", year:"report.year" }[curRange]);
  const msg = t("report.tgTitle").replace("{label}", label) + "\n─────────────\n"+
    t("report.tgSessions").replace("{v}", $("#statSessions").textContent) + "\n"+
    t("report.tgAvg").replace("{v}", $("#statAvg").textContent) + "\n"+
    t("report.tgPositive").replace("{v}", $("#statPositive").textContent) + "\n\n"+
    t("report.tgFrom");
  try{
    const r = await fetch(`https://api.telegram.org/bot${tgtoken}/sendMessage`,{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ chat_id: tgchat, text: msg }) });
    const j = await r.json();
    toast(j.ok ? t("report.tgSent") : t("report.tgFail")+" "+(j.description||""));
  }catch(e){ toast(t("report.tgFail")+"："+(e.message||e)); }
}
