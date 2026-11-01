// 從 VoiceWeaver 更名為「拾語者 Speak My Life」後的本機資料搬遷。
//
// 舊版把設定、歷史、分頁記憶等存在 voiceweaver_web*／vw_* 這些鍵；新版改用 sml_*。
// 不搬的話，舊使用者一打開新版就像第一次用：語言、金鑰、歷史全部「不見」。
//
// **必須是整個程式最早執行的模組**：app.js 與 store.js 的第一行都 import 它，
// 而它自己不 import 任何東西——ES module 依深度優先、照 import 順序執行，
// 所以它一定跑在任何模組讀 localStorage 之前。
//
// 規則：新鍵不存在時才把舊值搬過去（新版寫過的值永遠優先），搬完刪掉舊鍵。
// 冪等：做完記一個 sml_migrated 旗標，之後每次啟動只看一眼旗標就返回。
// sessionStorage（Drive 權杖）是分頁層級的，另外用 sessionStorage 自己的旗標。

export const MIGRATED_FLAG = "sml_migrated";

/** 舊鍵 → 新鍵。不在對照表裡、但以 vw_ 開頭的鍵也一律改成 sml_ 前綴。 */
export const LEGACY_KEYS = {
  "voiceweaver_web":       "sml_web",         // 設定、金鑰、自訂圖卡（store.js 的 LS）
  "voiceweaver_web_hist":  "sml_web_hist",    // 本機歷史
  "voiceweaver_web_rehab": "sml_web_rehab",   // 本機復健紀錄
  "vw_tab":                "sml_tab",         // 上次停留的分頁
  "vw_aac_ranker":         "sml_aac_ranker",  // AAC 圖卡排序學習
  "vw_dir_touch":          "sml_dir_touch",   // 帳號名冊每日打卡
  "vw_demo_units":         "sml_demo_units",  // 示範模式選的段落
  "vw_drive_token":        "sml_drive_token",     // sessionStorage
  "vw_drive_scope_gen":    "sml_drive_scope_gen", // sessionStorage
};

export function newKeyFor(oldKey){
  if(Object.prototype.hasOwnProperty.call(LEGACY_KEYS, oldKey)) return LEGACY_KEYS[oldKey];
  if(oldKey.startsWith("vw_")) return "sml_" + oldKey.slice(3);
  if(oldKey.startsWith("voiceweaver_")) return "sml_" + oldKey.slice("voiceweaver_".length);
  return null;
}

/** 把一個 Storage 裡的舊鍵搬到新鍵。回傳搬了幾個（測試用）。 */
export function migrateStorage(store){
  if(!store) return 0;
  if(store.getItem(MIGRATED_FLAG)) return 0;
  const olds = [];
  for(let i = 0; i < store.length; i++){
    const k = store.key(i);
    if(k && newKeyFor(k)) olds.push(k);
  }
  let moved = 0, failed = false;
  for(const k of olds){
    const nk = newKeyFor(k);
    const v = store.getItem(k);
    if(v === null || store.getItem(nk) !== null){ store.removeItem(k); continue; }
    try{ store.setItem(nk, v); store.removeItem(k); moved++; continue; }catch{ /* 多半是配額滿 */ }
    // 歷史帶圖時值可能很大，同時存兩份會撞到配額上限：先騰出舊鍵的空間再寫。
    store.removeItem(k);
    try{ store.setItem(nk, v); moved++; }
    catch{ try{ store.setItem(k, v); }catch{} failed = true; }   // 還是寫不進去就放回原處，下次再試
  }
  if(!failed) store.setItem(MIGRATED_FLAG, "1");
  return moved;
}

// 無痕模式、封鎖網站資料時 Storage 存取會丟例外——搬不了就算了，絕不擋住啟動。
try{ migrateStorage(globalThis.localStorage); }catch{ /* 空 */ }
try{ migrateStorage(globalThis.sessionStorage); }catch{ /* 空 */ }
