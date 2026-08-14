// 限時活動：還沒有自己金鑰的人，直接借站方的金鑰用。
//
// 目的很單純——活動那幾天，任何人（含匿名「直接開始」）打開網頁就能用完整的 AI，
// 不必先去申請金鑰。活動結束就自動關掉。
//
// 有兩種來源，**兩份可以同時生效**：
//   全站（shared/apiKeys）—— 一份文件，任何人都讀得到，含還沒登入過的人。
//   個人（grants/{uid}） —— 站方單獨發給某一個人的。
// 同時拿到兩份時，每日次數是**相加**的，金鑰也兩邊都能用（個人的先）。
// 不是取代關係：站方單獨發給某個人，通常就是因為他需要「額外」的量，
// 把全站那份蓋掉的話，加碼反而變成沒加。
//
// **關於安全，話要說在前面：**
// 金鑰一旦送進瀏覽器就等於交出去了。使用者可以打開 devtools 複製走，
// 然後直接呼叫 Google，完全繞過下面那個每日次數。所以：
//   · 到期日是**真的**擋得住的——它由 Firestore 規則強制（request.time），
//     改前端沒有用，資料庫那一層直接拒絕讀取。
//   · 每日次數是**有效防呆**，不是防護。擋得住一般使用者，擋不住刻意的人。
//     匿名使用者更是清掉瀏覽器資料就換一個身分。
// 因此這個機制只適合限時活動，而且活動結束後那幾把金鑰應該換掉。

import { state } from "./store.js?v=1.5.76";
import { readSharedKeys, readGrant, bumpSharedUsage, readSharedUsage } from "./store.js?v=1.5.76";

/** 每人每天可以用幾次站方的金鑰（個人活動可以自己指定，見 dailyLimit）。 */
export const DAILY_LIMIT = 50;

/**
 * 候選來源。**時間不在這裡判斷**——存的是原始的起訖，每次查詢才跟現在比。
 * 存成「目前有沒有效」的話，開著網頁跨過起始或結束時間就不會更新。
 *
 * 順序固定是個人在前、全站在後：個人那份是特地發給他的，金鑰理當先用。
 */
let _cand = [];
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

/** 今天是哪一天（用 UTC 切日，跟計數文件的 id 一致，不會因時區跳來跳去）。 */
function today(){ return new Date().toISOString().slice(0, 10); }

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

/** 一份文件 → 一個候選來源。壞掉或空的回 null。 */
function toSource(d, personal, uid){
  if(!d) return null;
  const n = Number(d.dailyLimit);
  return {
    personal,
    enabled: d.enabled !== false,          // 沒有這個欄位時視為開著（舊資料相容）
    from:  toMs(d.activeFrom)  || 0,
    until: toMs(d.activeUntil) || 0,
    limit: (Number.isFinite(n) && n > 0) ? n : DAILY_LIMIT,
    llm:   orderFor(d.llmApis,   uid),
    image: orderFor(d.imageApis, uid),
    tts:   orderFor(d.ttsApis,   uid),
  };
}

/** 現在真的生效的那幾份（個人在前）。 */
function live(){
  const t = Date.now();
  return _cand.filter(s => s.enabled && t >= s.from && t < s.until);
}

/**
 * 準備好共用金鑰。登入完成後叫一次就好。
 *
 * 兩份都讀——同時拿到就同時生效。拿不到（活動結束、沒設定、沒登入、規則拒絕）
 * 都安靜地當作沒有這回事：使用者本來就還有免金鑰的保底供應商可以用，
 * 不該因為借不到而看到錯誤。
 */
export async function initShared(){
  if(_loaded) return;
  _loaded = true;
  const uid = state.uid || "anon";
  // 兩份互不相干，一起發出去比較快；其中一份被規則拒絕不影響另一份。
  const [g, sh] = await Promise.all([
    readGrant().catch(() => null),
    readSharedKeys().catch(() => null),
  ]);
  _cand = [toSource(g, true, uid), toSource(sh, false, uid)].filter(Boolean);
  if(!campaignActive()) return;
  _usageDay = today();
  _usedToday = await readSharedUsage(_usageDay);
}

/** 活動還在進行中嗎（畫面用；真正的把關在 Firestore 規則）。 */
export function campaignActive(){ return live().length > 0; }

/**
 * 起訖時間（毫秒）。兩份期間不同時取聯集——那才是「這個人有得用」的整段。
 */
export function campaignStart(){
  const a = live();
  return a.length ? Math.min(...a.map(s => s.from)) : 0;
}
export function campaignEnd(){
  const a = live();
  return a.length ? Math.max(...a.map(s => s.until)) : 0;
}

/** 有沒有站方單獨發給這個人的那一份。 */
export function campaignPersonal(){ return live().some(s => s.personal); }
/** 全站與個人同時生效嗎（次數是相加的，畫面要講清楚）。 */
export function campaignBoth(){
  const a = live();
  return a.some(s => s.personal) && a.some(s => !s.personal);
}

/** 今天的上限＝生效中每一份的相加。 */
function limitNow(){ return live().reduce((n, s) => n + s.limit, 0); }

/** 今天還能不能再借（次數還沒用完、活動還在）。 */
export function sharedAvailable(){
  return campaignActive() && _usedToday < limitNow();
}

/** 今天用掉幾次／上限，給畫面顯示。 */
export function sharedUsage(){ return { used: _usedToday, limit: limitNow() }; }

/**
 * 這個人該用的那幾筆，依序（個人那份在前，各自都是他分到的那一把排第一）。
 * 呼叫端把整份接進備援鏈，第一把不行就自動換下一把。
 *
 * 兩份放了同一把金鑰時只留一筆——重複的那筆一定跟前一筆同時失敗，
 * 留著只是讓使用者多等一次逾時。
 */
export function sharedEntries(kind){
  if(!sharedAvailable()) return [];
  const out = [], seen = new Set();
  for(const s of live()){
    for(const e of (s[kind] || [])){
      if(!e || !e.key || seen.has(e.key)) continue;
      seen.add(e.key);
      out.push({ ...e, __shared: true });
    }
  }
  return out;
}

/** 只要第一把（相容既有呼叫端）。 */
export function sharedEntry(kind){
  return sharedEntries(kind)[0] || null;
}

/** 這個人分到的是第幾把（給畫面／除錯用；沒有活動時回 -1）。 */
export function sharedKeyIndex(kind){
  const s = live()[0];
  if(!s) return -1;
  const mine = (s[kind] || [])[0];
  return mine ? 0 : -1;
}

/**
 * 記一次用量。回傳「這一次算不算數」——已經超過上限時回 false，
 * 呼叫端就不要再借了。
 *
 * 跨日自動歸零：日期一變就重讀那一天的計數（不是把記憶體裡的數字清成 0，
 * 那樣同一天換分頁會從頭算起）。
 */
export async function countSharedUse(){
  if(!campaignActive()) return false;
  const day = today();
  if(day !== _usageDay){
    _usageDay = day;
    _usedToday = await readSharedUsage(day);
  }
  const limit = limitNow();
  if(_usedToday >= limit) return false;
  const n = await bumpSharedUsage(day);
  _usedToday = n ?? (_usedToday + 1);
  return _usedToday <= limit;
}
