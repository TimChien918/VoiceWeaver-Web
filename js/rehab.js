// 語音復健：聽整句／點字卡發音／跟讀錄音 → AI 評分（語意/流暢，非字元差異）→ 寫日誌。
import { speak, listen, sttSupported } from "./speech.js";
import { scoreRehab, suggestRehab, hasAnyLlmKey } from "./llm.js";
import { addRehabLog, listRehabLogs } from "./store.js";

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
    .flatMap(p=>{ const out=[]; for(let i=0;i<p.length;i+=2) out.push(p.slice(i,i+2)); return out; })
    .filter(Boolean);
}

export function setupRehab(){
  $("#rehabSuggest").addEventListener("click", async ()=>{
    if(!hasAnyLlmKey()){ toast("需要 LLM 金鑰才能用 AI 推薦（設定頁）"); return; }
    const box = $("#rehabSuggestions"); box.classList.remove("hidden");
    box.innerHTML = '<span class="tiny muted">AI 生成中…</span>';
    const arr = await suggestRehab();
    box.innerHTML = arr.map(s=>`<span class="chip" data-s="${s.replace(/"/g,'&quot;')}">${s}</span>`).join("");
    box.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{
      $("#rehabTarget").value = c.dataset.s; box.classList.add("hidden");
    }));
  });

  $("#rehabStart").addEventListener("click", ()=>{
    const t = $("#rehabTarget").value.trim();
    if(!t){ toast("請先輸入或選擇目標句"); return; }
    queue = []; queueIdx = 0;
    beginPractice(t);
  });

  const pBtn = $("#rehabParagraph");
  if(pBtn) pBtn.addEventListener("click", ()=>{
    const t = $("#rehabTarget").value.trim();
    if(!t){ toast("請先貼上一段文章"); return; }
    queue = t.split(/(?<=[。！？!?\n])/).map(s=>s.trim()).filter(s=>s.length>=2);
    if(!queue.length){ beginPractice(t); return; }
    queueIdx = 0; beginPractice(queue[0]);
  });

  const nBtn = $("#rehabNext");
  if(nBtn) nBtn.addEventListener("click", ()=>{
    if(queueIdx+1 < queue.length){ queueIdx++; beginPractice(queue[queueIdx]); }
    else { toast("整段練習完成！🎉"); queue=[]; updateQueueBar(); }
  });

  $("#rehabListen").addEventListener("click", ()=>{ if(target) speak(target); });

  $("#rehabRecord").addEventListener("click", ()=>{
    if(mic){ mic.stop(); return; }
    if(!sttSupported()){ toast("此瀏覽器不支援語音輸入（建議 Chrome）"); return; }
    $("#rehabRecord").textContent = "● 收音中…點此停止";
    mic = listen({
      onResult:()=>{},
      onEnd: async (text)=>{
        mic = null; $("#rehabRecord").textContent = "🎤 開始跟讀";
        await doScore(text);
      },
      onError:(e)=>{ toast("語音："+e); mic=null; $("#rehabRecord").textContent="🎤 開始跟讀"; }
    });
  });
}

function beginPractice(t){
  target = t;
  $("#rehabTargetDisplay").textContent = t;
  $("#rehabChips").innerHTML = makeChips(t).map(c=>`<span class="chip" data-c="${c}">${c}</span>`).join("");
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
    bar.innerHTML = `📖 整段練習 ${queueIdx+1}/${queue.length}`;
    $("#rehabNext")?.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
    $("#rehabNext")?.classList.add("hidden");
  }
}

async function doScore(recognized){
  const area = $("#rehabScore");
  area.innerHTML = '<p class="tiny muted">AI 評分中…</p>';
  const { score, feedback, wrongChars } = await scoreRehab(target, recognized);
  const cls = score>=80 ? "good" : score>=50 ? "mid" : "low";
  const emoji = score>=80 ? "🎉" : score>=50 ? "👍" : "💪";
  const word = score>=80 ? "非常好！" : score>=50 ? "繼續加油！" : "再試一次";
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
      ${feedback?`<div class="score-fb">💬 ${feedback}</div>`:""}
      ${wrongChars&&wrongChars.length?`<div class="tiny" style="color:var(--danger)">🔴 加強：${wrongChars.join("、")}</div>`:""}
      ${recognized?`<div class="tiny muted">🎤 辨識：${recognized}</div>`:""}
    </div></div>`;
  await addRehabLog({ target, recognized, score, feedback });
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
      <div><div class="h-main">${l.targetSentence||""}</div>
      <div class="h-sub">${new Date(l.timestamp).toLocaleString()}</div></div></div></div>`;
  }).join("") : '<p class="tiny muted center">尚無練習紀錄</p>';
}
