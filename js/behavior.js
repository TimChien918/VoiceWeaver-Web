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
import { state, save } from "./store.js?v=1.5.26";

const D = { firstSpeakCount:0, firstSpeakSumMs:0, candidateFirstHit:0, candidateTotal:0,
            undoCount:0, aacInputCount:0, textInputCount:0 };

function bm() {
  if (!state.behavior) state.behavior = { ...D };
  for (const k of Object.keys(D)) if (typeof state.behavior[k] !== "number") state.behavior[k] = 0;
  return state.behavior;
}

const _openedAt = Date.now();
let _firstSpeakDone = false;

/** 本次開啟後的第一次發聲——只記一次，之後的發聲不算「反應時間」。 */
export function markFirstSpeak() {
  if (_firstSpeakDone) return;
  _firstSpeakDone = true;
  const b = bm();
  b.firstSpeakCount++;
  b.firstSpeakSumMs += Date.now() - _openedAt;
  save();
}

/** 選了第幾個候選：firstHit=true 代表採用了 AI 的第一候選。 */
export function recordCandidateChoice(firstHit) {
  const b = bm();
  b.candidateTotal++;
  if (firstHit) b.candidateFirstHit++;
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

export function resetBehavior() { state.behavior = { ...D }; save(); }
