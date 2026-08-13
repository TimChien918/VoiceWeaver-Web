// 限時活動：還沒有自己金鑰的人，直接借站方的金鑰用。
//
// 目的很單純——活動那幾天，任何人（含匿名「直接開始」）打開網頁就能用完整的 AI，
// 不必先去申請金鑰。活動結束就自動關掉。
//
// **關於安全，話要說在前面：**
// 金鑰一旦送進瀏覽器就等於交出去了。使用者可以打開 devtools 複製走，
// 然後直接呼叫 Google，完全繞過下面那個每日次數。所以：
//   · 到期日是**真的**擋得住的——它由 Firestore 規則強制（request.time），
//     改前端沒有用，資料庫那一層直接拒絕讀取。
//   · 每日 50 次是**有效防呆**，不是防護。擋得住一般使用者，擋不住刻意的人。
//     匿名使用者更是清掉瀏覽器資料就換一個身分。
// 因此這個機制只適合限時活動，而且活動結束後那幾把金鑰應該換掉。

import { readSharedKeys, bumpSharedUsage, readSharedUsage } from "./store.js?v=1.5.63";

/**
 * 活動結束的時間點（之後就借不到了）。
 *
 * 使用者說的是「美國時間 8/13 到 8/21」，取美國太平洋時間（8 月是 PDT，UTC-7），
 * 涵蓋到 8/21 那一整天結束 → 8/22 00:00 PDT ＝ 8/22 07:00 UTC。
 *
 * 這個常數只用來把畫面上的字講對（還剩幾天、過期了）。**真正的把關在
 * Firestore 規則**，兩邊要一起改；只改這裡的話規則還是會擋，只改規則的話
 * 畫面會說得不準。
 */
export const CAMPAIGN_END = Date.parse("2026-08-22T07:00:00Z");

/** 每人每天可以用幾次站方的金鑰。 */
export const DAILY_LIMIT = 50;

/** 今天是哪一天（用 UTC 切日，跟計數文件的 id 一致，不會因時區跳來跳去）。 */
function today(){ return new Date().toISOString().slice(0, 10); }

/** 活動還在進行中嗎（畫面用；真正的把關在 Firestore 規則）。 */
export function campaignActive(){ return Date.now() < CAMPAIGN_END; }

// 這次工作階段抽到的那一把。抽一次就固定：每次呼叫都重抽的話，
// 同一個人的連續請求會打到不同金鑰，配額看起來像隨機時好時壞。
let _picked = null;      // { llm:{provider,key,model}, image:…, tts:… }
let _loaded = false;
let _usedToday = 0;
let _usageDay = "";

/** 從一份清單裡隨機挑一筆（站方可能放了好幾把，分散負載）。 */
function pickOne(list){
  if(!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 準備好共用金鑰。登入完成後叫一次就好。
 *
 * 拿不到（活動結束、沒設定、沒登入、規則拒絕）都安靜地當作沒有這回事——
 * 使用者本來就還有免金鑰的保底供應商可以用，不該因為借不到而看到錯誤。
 */
export async function initShared(){
  if(_loaded) return;
  _loaded = true;
  if(!campaignActive()) return;
  const d = await readSharedKeys();
  if(!d) return;
  _picked = {
    llm:   pickOne(d.llmApis),
    image: pickOne(d.imageApis),
    tts:   pickOne(d.ttsApis),
  };
  _usageDay = today();
  _usedToday = await readSharedUsage(_usageDay);
}

/** 今天還能不能再借（次數還沒用完、活動還在）。 */
export function sharedAvailable(){
  return !!_picked && campaignActive() && _usedToday < DAILY_LIMIT;
}

/** 今天用掉幾次／上限，給畫面顯示。 */
export function sharedUsage(){ return { used: _usedToday, limit: DAILY_LIMIT }; }

/**
 * 借一筆指定用途的金鑰（kind: "llm" | "image" | "tts"）。
 *
 * 只有「使用者自己完全沒有這個用途的金鑰」時才該叫——自己的金鑰永遠優先，
 * 站方的金鑰是給沒有的人用的。
 */
export function sharedEntry(kind){
  if(!sharedAvailable()) return null;
  const e = _picked[kind];
  return e && e.key ? { ...e, __shared: true } : null;
}

/**
 * 記一次用量。回傳「這一次算不算數」——已經超過上限時回 false，
 * 呼叫端就不要再借了。
 *
 * 跨日自動歸零：日期一變就重讀那一天的計數（不是把記憶體裡的數字清成 0，
 * 那樣同一天換分頁會從頭算起）。
 */
export async function countSharedUse(){
  if(!_picked) return false;
  const day = today();
  if(day !== _usageDay){
    _usageDay = day;
    _usedToday = await readSharedUsage(day);
  }
  if(_usedToday >= DAILY_LIMIT) return false;
  const n = await bumpSharedUsage(day);
  _usedToday = n ?? (_usedToday + 1);
  return _usedToday <= DAILY_LIMIT;
}
