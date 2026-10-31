// 語音復健：聽整句／點字卡發音／跟讀錄音 → AI 評分（語意/流暢，非字元差異）→ 寫日誌。
import { speak, listen, sttSupported } from "./speech.js?v=1.5.78";
import { scoreRehab, suggestRehab, hasAnyLlmKey } from "./llm.js?v=1.5.78";
import { addRehabLog, listRehabLogs } from "./store.js?v=1.5.78";
import { t as tr } from "./i18n.js?v=1.5.78";

const esc = (x)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

let target = "";
let mic = null;
let toast = (m)=>console.log(m);
let queue = [];      // 整段練習佇列
let queueIdx = 0;

export function setRehabToast(fn){ toast = fn; }

// 字卡：標點切子句，子句內每 2 字一組（解破音字，與手機一致）
function makeChips(sentence){
  return sentence.replace(/[，。！？、,.!?；;：:\s]+/g,"|").split("|").filter(Boolean)
    .flatMap(p=>{
      if(/[A-Za-z0-9]/.test(p)) return [p];               // 拉丁詞整個一張卡（不可每 2 字硬切）
      const out=[]; for(let i=0;i<p.length;i+=2) out.push(p.slice(i,i+2)); return out;
    })
    .filter(Boolean);
}

export function setupRehab(){
  $("#rehabSuggest").addEventListener("click", async ()=>{
    if(!hasAnyLlmKey()){ toast(tr("rehab.needLlmSuggest")); return; }
    const box = $("#rehabSuggestions"); box.classList.remove("hidden");
    box.innerHTML = `<span class="tiny muted">${tr("rehab.generating")}</span>`;
    const arr = await suggestRehab();
    box.innerHTML = arr.map(s=>`<span class="chip" data-s="${esc(s)}">${esc(s)}</span>`).join("");
    box.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{
      $("#rehabTarget").value = c.dataset.s; box.classList.add("hidden");
    }));
  });

  $("#rehabStart").addEventListener("click", ()=>{
    const t = $("#rehabTarget").value.trim();
    if(!t){ toast(tr("rehab.enterTarget")); return; }
    queue = []; queueIdx = 0;
    beginPractice(t);
  });

  const pBtn = $("#rehabParagraph");
  if(pBtn) pBtn.addEventListener("click", ()=>{
    const t = $("#rehabTarget").value.trim();
    if(!t){ toast(tr("rehab.pasteParagraph")); return; }
    queue = t.split(/(?<=[。！？!?\n])/).map(s=>s.trim()).filter(s=>s.length>=2);
    if(!queue.length){ beginPractice(t); return; }
    queueIdx = 0; beginPractice(queue[0]);
  });

  const nBtn = $("#rehabNext");
  if(nBtn) nBtn.addEventListener("click", ()=>{
    if(queueIdx+1 < queue.length){ queueIdx++; beginPractice(queue[queueIdx]); }
    else { toast(tr("rehab.paragraphDone")); queue=[]; updateQueueBar(); }
  });

  $("#rehabListen").addEventListener("click", ()=>{ if(target) speak(target); });

  $("#rehabRecord").addEventListener("click", ()=>{
    if(mic){ mic.stop(); return; }
    if(!sttSupported()){ toast(tr("toast.sttUnsupported")); return; }
    $("#rehabRecord").textContent = tr("mic.recording");
    // 作答時間：按下「開始跟讀」→ 第一次聽到字（開口前停頓＝反應時間）→ 最後一次聽到字。
    // 只記時間戳，不碰聲音本身。瀏覽器語音辨識不會把錄音交給這支程式，
    // 所以這裡從頭到尾沒有任何錄音 Blob 可以存——評分只拿辨識出來的文字跟這兩個數字。
    const t0 = performance.now();
    let tFirst = null, tLast = null;
    mic = listen({
      onResult:(txt)=>{
        if(!txt) return;
        const now = performance.now();
        if(tFirst === null) tFirst = now;
        tLast = now;
      },
      onEnd: async (text)=>{
        mic = null; $("#rehabRecord").textContent = tr("rehab.record");
        const timing = tFirst === null ? {} : { latencyMs: tFirst - t0, durationMs: Math.max(0, tLast - tFirst) };
        await doScore(text, timing);
      },
      onError:(e)=>{ toast(tr("toast.sttPrefix")+e); mic=null; $("#rehabRecord").textContent=tr("rehab.record"); }
    });
  });
}

function beginPractice(t){
  target = t;
  $("#rehabTargetDisplay").textContent = t;
  $("#rehabChips").innerHTML = makeChips(t).map(c=>`<span class="chip" data-c="${esc(c)}">${esc(c)}</span>`).join("");
  $$("#rehabChips .chip").forEach(c=>c.addEventListener("click",()=>speak(c.dataset.c)));
  $("#rehabPractice").classList.remove("hidden");
  $("#rehabScore").innerHTML = "";
  updateQueueBar();
}

function updateQueueBar(){
  const bar = $("#rehabQueueBar");
  if(!bar) return;
  if(queue.length > 1){
    bar.classList.remove("hidden");
    bar.textContent = tr("rehab.queueBar").replace("{i}", queueIdx+1).replace("{n}", queue.length);
    $("#rehabNext")?.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
    $("#rehabNext")?.classList.add("hidden");
  }
}

// 三個細項的小長條：流暢度、語調、語意。沒有分數（備援評分、模型沒給）就顯示「—」，
// 不畫一條假的 0——0 分跟「沒評到」對患者是完全不同的訊息。
function subBars(sub){
  const rows = [["rehab.subSemantic", sub.semantic], ["rehab.subFluency", sub.fluency], ["rehab.subProsody", sub.prosody]];
  return `<div class="subscores">${rows.map(([k,v])=>{
    const ok = Number.isFinite(v);
    const cls = !ok ? "" : v>=80 ? "good" : v>=50 ? "mid" : "low";
    return `<div class="subscore"><span class="tiny">${esc(tr(k))}</span>
      <span class="subbar"><i class="${cls}" style="width:${ok?v:0}%"></i></span>
      <b class="tiny">${ok?v:"—"}</b></div>`;
  }).join("")}</div>`;
}

async function doScore(recognized, timing = {}){
  const area = $("#rehabScore");
  area.innerHTML = `<p class="tiny muted">${tr("rehab.scoring")}</p>`;
  const r = await scoreRehab(target, recognized, timing);
  const { score, feedback, wrongChars } = r;
  const extraWords = r.extraWords || [];
  const cls = score>=80 ? "good" : score>=50 ? "mid" : "low";
  const emoji = score>=80 ? "🎉" : score>=50 ? "👍" : "💪";
  const word = score>=80 ? tr("rehab.great") : score>=50 ? tr("rehab.keepGoing") : tr("rehab.tryAgain");
  // 錯誤字高亮：字卡內含 wrongChars → 加 .wrong 紅框
  if(wrongChars && wrongChars.length){
    $$("#rehabChips .chip").forEach(chip=>{
      if([...chip.dataset.c].some(c=>wrongChars.includes(c))) chip.classList.add("wrong");
      else chip.classList.remove("wrong");
    });
  } else {
    $$("#rehabChips .chip").forEach(chip=>chip.classList.remove("wrong"));
  }
  area.innerHTML = `<div class="scorebox ${cls}">
    <div class="score-num">${score}</div>
    <div class="score-info">
      <div class="score-head">${emoji} ${word}</div>
      ${feedback?`<div class="score-fb">💬 ${esc(feedback)}</div>`:""}
      ${wrongChars&&wrongChars.length?`<div class="tiny" style="color:var(--danger)">${tr("rehab.focus")}${esc(wrongChars.join("、"))}</div>`:""}
      ${extraWords.length?`<div class="tiny" style="color:var(--danger)">${tr("rehab.extraWords")}${esc(extraWords.join("、"))}</div>`:""}
      ${recognized?`<div class="tiny muted">${tr("rehab.recognizedLabel")}${esc(recognized)}</div>`:""}
      ${Number.isFinite(timing.latencyMs)?`<div class="tiny muted">${esc(tr("rehab.latency").replace("{s}", (timing.latencyMs/1000).toFixed(1)))}</div>`:""}
    </div></div>${subBars(r)}`;
  // 寫進日誌的只有文字與數字（目標句、辨識文字、分數、反應時間）——沒有聲音。
  await addRehabLog({ target, recognized, score, feedback,
    latencyMs: timing.latencyMs, fluency: r.fluency, prosody: r.prosody, semantic: r.semantic });
  await renderRehabLogs();
}

export async function renderRehabLogs(){
  const logs = (await listRehabLogs(0)).slice(0,10);
  const box = $("#rehabLogs");
  if(!box) return;
  box.innerHTML = logs.length ? logs.map(l=>{
    const cls = l.score>=80?"good":l.score>=50?"mid":"low";
    return `<div class="hitem"><div class="row" style="margin:0;gap:10px">
      <span class="score-pill ${cls}">${l.score}</span>
      <div><div class="h-main">${esc(l.targetSentence||"")}</div>
      <div class="h-sub">${new Date(l.timestamp).toLocaleString()}</div></div></div></div>`;
  }).join("") : `<p class="tiny muted center">${tr("rehab.noLogs")}</p>`;
}
