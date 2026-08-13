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

import { state } from "./store.js?v=1.5.68";
import { readSharedKeys, bumpSharedUsage, readSharedUsage } from "./store.js?v=1.5.68";

/**
 * 活動期間與開關，**存在 shared/apiKeys 那份文件裡**（enabled / activeFrom / activeUntil）。
 *
 * 為什麼不寫死：寫死的話每次要調整期間都得重新發布 Firestore 規則，
 * 那是站方才做得到、而且容易改錯的事。改成資料驅動之後，規則固定不動、
 * 只比對文件自己的欄位（resource.data.activeUntil），管理工具改資料就等於
 * 改期間——而把關仍然在規則那一層，前端改不動。
 *
 * 讀不到就當作沒有活動（保守），畫面照常走免金鑰的保底供應商。
 */
let _window = null;   // { enabled, from, until }（毫秒）

/** 每人每天可以用幾次站方的金鑰。 */
export const DAILY_LIMIT = 50;

/** 活動結束的時間點（毫秒）；沒有活動時回 0。 */
export function campaignEnd(){ return _window?.until || 0; }

/** 今天是哪一天（用 UTC 切日，跟計數文件的 id 一致，不會因時區跳來跳去）。 */
function today(){ return new Date().toISOString().slice(0, 10); }

/** 活動還在進行中嗎（畫面用；真正的把關在 Firestore 規則）。 */
export function campaignActive(){
  if(!_window || !_window.enabled) return false;
  const now = Date.now();
  return now >= _window.from && now < _window.until;
}

// 這次工作階段抽到的那一把。抽一次就固定：每次呼叫都重抽的話，
// 同一個人的連續請求會打到不同金鑰，配額看起來像隨機時好時壞。
let _picked = null;      // { llm:[…依這個人的順序], image:[…], tts:[…] }
let _all = null;         // 站方原本的清單（算「我分到第幾把」用）
let _loaded = false;
let _usedToday = 0;
let _usageDay = "";

/**
 * Firestore 的時間欄位可能是 ISO 字串或 {seconds} 形式，兩種都收。
 * 拿不到就回 0，由呼叫端當作「沒有設定」。
 */
function toMs(v){
  if(!v) return 0;
  if(typeof v === "number") return v;
  if(typeof v === "string") return Date.parse(v) || 0;
  if(typeof v === "object" && v.seconds != null) return Number(v.seconds) * 1000;
  return 0;
}

/**
 * 這個使用者分到第幾把。
 *
 * 用 uid 算雜湊而不是 Math.random()，理由是**穩定**：同一個人每次開網頁、
 * 換裝置都拿到同一把。隨機的話「一人一把」名不副實，出問題時也查不出他
 * 打的是哪一把。
 *
 * **不要以為這樣就分得比較平均。** 實測過（20 人 3 把是 4/12/4），uid 是隨機
 * 字串，雜湊之後的分佈跟直接亂數一樣是二項分佈，人少時本來就會歪。
 * 真正讓各把用量拉平的是下面 orderFor() 的備援順序：某一把額度用完或故障時
 * 會自動溢流到下一把，所以吃緊的那把會把流量往外推。人多時（100 人以上）
 * 分配本身就會收斂到 ±25% 以內。
 *
 * FNV-1a：短、夠均勻，而且不需要引任何東西進來。
 */
function assignIndex(uid, n){
  if(n <= 1) return 0;
  let h = 2166136261;
  for(let i = 0; i < uid.length; i++){
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

/**
 * 把清單轉成「這個人該用的順序」：他分到的那一把排第一，其餘依序接在後面。
 *
 * 為什麼要回整份而不是只回一把：他分到的那把可能剛好額度用完或暫時故障，
 * 只給一把的話他就直接掉到免金鑰保底去了——但站方明明還有別把可以用。
 * 排好順序交出去，備援就由既有的「一家失敗換下一家」自然接手，
 * 而且尖峰時的溢流也會往後攤，不會全部擠在同一把。
 */
function orderFor(list, uid){
  if(!Array.isArray(list) || !list.length) return [];
  const i = assignIndex(uid || "anon", list.length);
  return list.slice(i).concat(list.slice(0, i));
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
  // 先讀文件才知道有沒有活動——期間現在是文件裡的欄位，不是寫死的常數。
  // 期間過了的話規則會直接拒絕，這裡拿到 null，等同沒有活動。
  const d = await readSharedKeys();
  if(!d) return;
  _window = {
    enabled: d.enabled !== false,        // 沒有這個欄位時視為開著（舊資料相容）
    from:  toMs(d.activeFrom)  || 0,
    until: toMs(d.activeUntil) || 0,
  };
  if(!campaignActive()) return;
  // uid 決定順序：同一個人每次都拿到同一份排序，換裝置也一樣。
  const uid = state.uid || "anon";
  _picked = {
    llm:   orderFor(d.llmApis, uid),
    image: orderFor(d.imageApis, uid),
    tts:   orderFor(d.ttsApis, uid),
  };
  _all = { llm: d.llmApis || [], image: d.imageApis || [], tts: d.ttsApis || [] };
  _usageDay = today();
  _usedToday = await readSharedUsage(_usageDay);
}

/** 今天還能不能再借（次數還沒用完、活動還在）。 */
export function sharedAvailable(){
  return !!_picked && campaignActive() && _usedToday < DAILY_LIMIT;
}

/** 這個人分到的是第幾把（給畫面／除錯用；沒有活動時回 -1）。 */
export function sharedKeyIndex(kind){
  const all = _all?.[kind] || [];
  const mine = _picked?.[kind]?.[0];
  if(!all.length || !mine) return -1;
  return all.findIndex(e => e.key === mine.key);
}

/** 今天用掉幾次／上限，給畫面顯示。 */
export function sharedUsage(){ return { used: _usedToday, limit: DAILY_LIMIT }; }

/**
 * 借一筆指定用途的金鑰（kind: "llm" | "image" | "tts"）。
 *
 * 只有「使用者自己完全沒有這個用途的金鑰」時才該叫——自己的金鑰永遠優先，
 * 站方的金鑰是給沒有的人用的。
 */
/**
 * 這個人該用的那幾筆，依序（他分到的那一把在最前面）。
 * 呼叫端把整份接進備援鏈，第一把不行就自動換下一把。
 */
export function sharedEntries(kind){
  if(!sharedAvailable()) return [];
  return (_picked[kind] || []).filter(e => e && e.key).map(e => ({ ...e, __shared: true }));
}

/** 只要第一把（相容既有呼叫端）。 */
export function sharedEntry(kind){
  return sharedEntries(kind)[0] || null;
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
