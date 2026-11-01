// 行為數據（治療師評估用）——與 App 的 BehaviorMetrics 同一組指標。
//
// 只存彙總值不存逐筆：治療師看的是趨勢，不需要逐次紀錄，而且彙總值小、
// 清歷史時也不該被連帶清掉（要清得用「一鍵重置」）。
//
// 四個指標：
//   反應＝開 App 到第一次發聲的平均耗時（每次開啟記一筆）
//   選句＝AI 第一候選被採用的比率（越高代表 AI 越貼近患者本意）
//   修改＝退回／刪卡的累計次數
//   圖卡＝圖卡輸入佔全部輸入的比例
import { state, save } from "./store.js?v=1.6.2";

const D = { firstSpeakCount:0, firstSpeakSumMs:0, candidateFirstHit:0, candidateTotal:0,
            undoCount:0, aacInputCount:0, textInputCount:0 };

function bm() {
  if (!state.behavior) state.behavior = { ...D };
  for (const k of Object.keys(D)) if (typeof state.behavior[k] !== "number") state.behavior[k] = 0;
  return state.behavior;
}

// ── 逐日累計（復健軌跡趨勢圖用）──
// 上面的彙總值只能回答「整體平均多少」，回答不了「有沒有在進步」——而後者才是
// 治療師要看的。所以另外按日累計一份：每天只存四個數字（不存逐筆），
// 一年也才幾百個小物件，跟著 behavior 一起走既有的 save() 同步到帳號。
//   fs/fsMs＝當天「開啟到第一次發聲」的次數與總毫秒；ct/ch＝當天選句總數與第一候選命中數。
// 日期鍵用**本機**日期：治療師看的是患者的「哪一天」，用 UTC 切的話台灣早上八點前
// 的練習會被算到前一天。
const DAILY_KEEP = 400;   // 留一年多就夠畫年度趨勢；更舊的就不再保留，避免設定文件無限長大

export function dayKey(ts = Date.now()){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function today(){
  const b = bm();
  if (!b.daily || typeof b.daily !== "object") b.daily = {};
  const k = dayKey();
  const cur = b.daily[k] || (b.daily[k] = { fs:0, fsMs:0, ct:0, ch:0 });
  for (const f of ["fs","fsMs","ct","ch"]) if (typeof cur[f] !== "number") cur[f] = 0;
  const keys = Object.keys(b.daily);
  if (keys.length > DAILY_KEEP) keys.sort().slice(0, keys.length - DAILY_KEEP).forEach(x => delete b.daily[x]);
  return cur;
}

/** 逐日資料（唯讀複本）：{ "YYYY-MM-DD": {fs, fsMs, ct, ch} }。 */
export function behaviorDaily(){
  const d = bm().daily;
  return (d && typeof d === "object") ? JSON.parse(JSON.stringify(d)) : {};
}

const _openedAt = Date.now();
let _firstSpeakDone = false;

/** 本次開啟後的第一次發聲——只記一次，之後的發聲不算「反應時間」。 */
export function markFirstSpeak() {
  if (_firstSpeakDone) return;
  _firstSpeakDone = true;
  const b = bm();
  b.firstSpeakCount++;
  const ms = Date.now() - _openedAt;
  b.firstSpeakSumMs += ms;
  const d = today(); d.fs++; d.fsMs += ms;
  save();
}

/** 選了第幾個候選：firstHit=true 代表採用了 AI 的第一候選。 */
export function recordCandidateChoice(firstHit) {
  const b = bm();
  b.candidateTotal++;
  if (firstHit) b.candidateFirstHit++;
  const d = today(); d.ct++; if (firstHit) d.ch++;
  save();
}

/** 退回／刪除圖卡。 */
export function recordUndo() { bm().undoCount++; save(); }

/** 一次輸入來自圖卡還是文字（打字／語音）。 */
export function recordInputSource(viaAac) {
  const b = bm();
  if (viaAac) b.aacInputCount++; else b.textInputCount++;
  save();
}

/** 給報表用的衍生值。沒有樣本時回 null，畫面顯示「—」而不是假的 0。 */
export function behaviorSummary() {
  const b = bm();
  const inputTotal = b.aacInputCount + b.textInputCount;
  return {
    reactionSec: b.firstSpeakCount > 0 ? (b.firstSpeakSumMs / b.firstSpeakCount / 1000) : null,
    firstHitPct: b.candidateTotal > 0 ? Math.round(b.candidateFirstHit / b.candidateTotal * 100) : null,
    undoCount: b.undoCount,
    aacPct: inputTotal > 0 ? Math.round(b.aacInputCount / inputTotal * 100) : null,
  };
}
