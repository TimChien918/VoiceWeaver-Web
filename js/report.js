// 成績單：讀 Firestore rehabLogs，三段時間維度，統計 + 折線趨勢 + Telegram 匯出。
import { state } from "./store.js?v=1.6.0";
import { listRehabLogs } from "./store.js?v=1.6.0";
import { t } from "./i18n.js?v=1.6.0";
import { behaviorSummary, behaviorDaily, dayKey } from "./behavior.js?v=1.6.0";

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
  // 復健軌跡（逐日／逐月）接在後面，空一行隔開：治療師拿去 Excel 畫圖時直接選這一段即可。
  const tr = await trajectorySeries(curRange);
  rows.push("", t("traj.csvHeader"));
  tr.buckets.forEach((b,i)=>{
    const f = (v, d=0) => v==null ? "" : v.toFixed(d);
    rows.push([b, f(tr.reaction[i],1), f(tr.pickHit[i]), f(tr.rehabLatency[i],1), f(tr.rehabHit[i])].join(","));
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
  // 復健軌跡：圖用同一支繪圖函式畫在離屏 canvas 上再轉成圖片，PDF 跟畫面上看到的是同一張圖
  const tr = await trajectorySeries(curRange);
  const img = (fn) => { const c = document.createElement("canvas"); fn(c, 640); return c.toDataURL("image/png"); };
  const imgReact = img((c,w)=>drawTrajectory(c, tr, "reaction", w));
  const imgHit = img((c,w)=>drawTrajectory(c, tr, "hit", w));
  const f = (v, d=0, u="") => v==null ? "—" : v.toFixed(d)+u;
  const trRows = tr.buckets.map((b,i)=>`<tr><td>${esc(b)}</td><td style="text-align:right">${f(tr.reaction[i],1,"s")}</td>
    <td style="text-align:right">${f(tr.pickHit[i],0,"%")}</td><td style="text-align:right">${f(tr.rehabLatency[i],1,"s")}</td>
    <td style="text-align:right">${f(tr.rehabHit[i],0,"%")}</td></tr>`).join("");
  const trHead = t("traj.csvHeader").split(",");
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
    <h2 style="font-size:15px;margin:18px 0 6px">${esc(t("traj.title"))}</h2>
    <div class="sub">${esc(t("traj.note"))}</div>
    <img src="${imgReact}" style="width:100%;max-width:640px;display:block;margin-bottom:6px" alt="">
    <img src="${imgHit}" style="width:100%;max-width:640px;display:block;margin-bottom:10px" alt="">
    <table style="margin-bottom:18px"><thead><tr>${trHead.map((h,i)=>`<th${i?' style="text-align:right"':""}>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${trRows}</tbody></table>
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
  // 復健軌跡趨勢圖：反應時間與命中率隨時間的變化（治療師追蹤用）
  try{
    const tr = await trajectorySeries(curRange);
    drawTrajectory($("#trajReaction"), tr, "reaction");
    drawTrajectory($("#trajHit"), tr, "hit");
    const lbl = $("#trajRange");
    if(lbl) lbl.textContent = t(curRange === "today" ? "traj.last7" : curRange === "year" ? "traj.byMonth" : "traj.byDay");
  }catch(e){ console.warn("trajectory", e); }

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

// ── 復健軌跡趨勢圖 ─────────────────────────────────────────────
// 設計書模組 3：把「反應時間」與「命中率」轉成隨時間變化的趨勢，給語言治療師參考。
// 兩種來源、各兩條線：
//   反應時間：開 App 到第一次發聲（behavior 逐日累計）／跟讀時開口前的停頓（rehabLogs.latencyMs）
//   命中率：  AI 第一候選被採用率（behavior 逐日累計）／跟讀得分 ≥ 80 的比例（rehabLogs.score）
// 時間軸跟著上方的期間切換：本月＝逐日、本年度＝逐月；「今日」只有一個點畫不出趨勢，
// 改看最近 7 天。沒有樣本的那一天是**斷點**而不是 0——沒練習跟練得很差是兩回事。

const HIT_SCORE = 80;   // 跟讀「命中」的門檻，與分數徽章的綠色（good）同一條線

function rangeDays(range){
  const end = new Date(); end.setHours(0,0,0,0);
  const start = new Date(end);
  if(range === "today") start.setDate(start.getDate() - 6);
  else if(range === "month") start.setDate(1);
  else start.setMonth(0, 1);
  return { start, end };
}

/** 期間內每個桶（逐日 YYYY-MM-DD／逐月 YYYY-MM）的四條數列。 */
export async function trajectorySeries(range){
  const { start, end } = rangeDays(range);
  const byMonth = range === "year";
  const keyOf = (ts) => byMonth ? dayKey(ts).slice(0, 7) : dayKey(ts);
  const buckets = [];
  for(const d = new Date(start); d <= end; byMonth ? d.setMonth(d.getMonth()+1) : d.setDate(d.getDate()+1)){
    const k = keyOf(d.getTime());
    if(!buckets.includes(k)) buckets.push(k);
  }
  const acc = Object.fromEntries(buckets.map(k=>[k, { fs:0, fsMs:0, ct:0, ch:0, n:0, hit:0, latN:0, latMs:0 }]));
  for(const [k, v] of Object.entries(behaviorDaily())){
    const a = acc[byMonth ? k.slice(0, 7) : k];
    if(!a) continue;
    a.fs += v.fs||0; a.fsMs += v.fsMs||0; a.ct += v.ct||0; a.ch += v.ch||0;
  }
  const logs = await listRehabLogs(start.getTime());
  for(const l of logs){
    const a = acc[keyOf(l.timestamp)];
    if(!a) continue;
    a.n++; if((l.score||0) >= HIT_SCORE) a.hit++;
    if(Number.isFinite(l.latencyMs)){ a.latN++; a.latMs += l.latencyMs; }
  }
  const lang = document.documentElement.lang || "zh-TW";
  const label = (k) => byMonth
    ? new Date(+k.slice(0,4), +k.slice(5,7)-1, 1).toLocaleDateString(lang, { month:"short" })
    : `${+k.slice(5,7)}/${+k.slice(8,10)}`;
  return {
    buckets,
    labels:       buckets.map(label),
    reaction:     buckets.map(k=>acc[k].fs ? acc[k].fsMs/acc[k].fs/1000 : null),
    rehabLatency: buckets.map(k=>acc[k].latN ? acc[k].latMs/acc[k].latN/1000 : null),
    pickHit:      buckets.map(k=>acc[k].ct ? acc[k].ch/acc[k].ct*100 : null),
    rehabHit:     buckets.map(k=>acc[k].n ? acc[k].hit/acc[k].n*100 : null),
  };
}

/**
 * 畫一張軌跡圖（與分數趨勢同一套畫法：canvas、同樣的格線與字級、主題色）。
 * kind="reaction" 畫秒數（兩條線），kind="hit" 畫百分比（兩條線）。
 * width 只有匯出 PDF 時給（離屏 canvas 沒有版面寬度可量）。
 */
export function drawTrajectory(cv, tr, kind, width){
  if(!cv) return;
  const ctx = cv.getContext("2d");
  const W = width || cv.clientWidth || 320, H = 170;
  const dpr = width ? 2 : devicePixelRatio;
  cv.width = W * dpr; cv.height = H * dpr;
  if(!width) cv.style.height = H+"px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,W,H);
  const css = (v)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const accent = css("--accent")||"#0a84ff", accent2 = css("--accent2")||"#34c759";
  const muted = css("--muted")||"#888", line = css("--line")||"#ddd";
  if(width){ ctx.fillStyle = "#fff"; ctx.fillRect(0,0,W,H); }   // PDF 用白底，深色主題下也印得出來

  const series = kind === "reaction"
    ? [{ name:t("traj.sReaction"), color:accent,  vals:tr.reaction },
       { name:t("traj.sRehabLatency"), color:accent2, vals:tr.rehabLatency }]
    : [{ name:t("traj.sPickHit"), color:accent,  vals:tr.pickHit },
       { name:t("traj.sRehabHit"), color:accent2, vals:tr.rehabHit }];
  const all = series.flatMap(s=>s.vals).filter(v=>v!=null);
  const pad = { l:34, r:12, t:24, b:22 };
  const gW = W-pad.l-pad.r, gH = H-pad.t-pad.b;

  // 圖例（左上，色塊＋名稱），標題由外面的卡片標籤負責
  ctx.font = "11px sans-serif"; ctx.textAlign = "left";
  let lx = pad.l;
  for(const s of series){
    ctx.fillStyle = s.color; ctx.fillRect(lx, 8, 10, 3);
    ctx.fillStyle = muted; ctx.fillText(s.name, lx+14, 13);
    lx += 14 + ctx.measureText(s.name).width + 14;
  }
  if(!all.length){
    ctx.fillStyle = muted; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t("report.noData"), W/2, pad.t + gH/2); return;
  }

  // y 軸：百分比固定 0~100；秒數取資料最大值往上取整（至少 5 秒，避免一點點波動被放大成大起大落）
  const yMax = kind === "hit" ? 100 : Math.max(5, Math.ceil(Math.max(...all) / 5) * 5);
  const ticks = [0, .25, .5, .75, 1].map(f=>f*yMax);
  const n = tr.labels.length;
  const xOf = (i)=> pad.l + (n>1 ? i*gW/(n-1) : gW/2);
  const yOf = (v)=> pad.t + gH - (v/yMax)*gH;
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.font = "10px sans-serif";
  ticks.forEach(v=>{
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+gW,y); ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(kind === "hit" ? `${Math.round(v)}%` : `${+v.toFixed(1)}s`, pad.l-4, y+3);
  });

  for(const s of series){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    let pen = false;
    s.vals.forEach((v,i)=>{
      if(v == null){ pen = false; return; }            // 沒資料的那天斷開，不連成假的趨勢
      const x = xOf(i), y = yOf(Math.min(v, yMax));
      pen ? ctx.lineTo(x,y) : ctx.moveTo(x,y); pen = true;
    });
    ctx.stroke();
    ctx.fillStyle = s.color;
    s.vals.forEach((v,i)=>{ if(v==null) return; ctx.beginPath(); ctx.arc(xOf(i), yOf(Math.min(v, yMax)), 3, 0, Math.PI*2); ctx.fill(); });
  }

  ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.font = "10px sans-serif";
  const step = Math.ceil(n/7);
  tr.labels.forEach((k,i)=>{ if(i%step===0||i===n-1) ctx.fillText(k, xOf(i), H-6); });
}
