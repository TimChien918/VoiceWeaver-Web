// 把不可信的字串安全地放進 HTML。
//
// 不引任何東西進來，所以 Node 直接 import 就測得到（同 textparse.js / headmath.js）。
//
// **為什麼需要這支：** 這個 App 的資料會跨裝置同步。自建圖卡（state.customCards）
// 是使用者在另一台裝置上建的，經過 Firestore 回到這裡——也就是說，它的內容
// 不是這支程式產生的，不能當成安全的。只要 Firestore 規則有一絲鬆動，
// 那幾個欄位就是別人寫得進來的字串，而它們會直接進到患者畫面的 DOM。

/** HTML 跳脫。五個字元都要換，少換單引號的話單引號屬性一樣會被撐開。 */
export function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * 圖片網址的白名單。不合格就回空字串，呼叫端退回 emoji。
 *
 * 為什麼不是只做跳脫就好——跳脫擋得住「撐開屬性」，但它要求**每一個**算繪點
 * 都記得呼叫。實際上這個專案有四個地方算繪圖卡，其中三個忘了（kiosk.js 兩個
 * 只改了一個，相隔 55 行）。白名單是把關在值本身：就算之後有人新增第五個
 * 算繪點又忘了跳脫，這個值裡也不會有引號可以撐開屬性。
 *
 * 允許的只有兩種：
 *   · data:image/*;base64,...  —— App 自己產的就是這個（canvas.toDataURL）
 *   · https://...              —— 預留給之後可能的外部圖床
 * 刻意不收 http:（混合內容本來就載不到）、blob:（換頁就失效，不該被存起來）、
 * javascript: 與 data:text/html（那是攻擊，不是圖）。
 */
export function safeImgSrc(v){
  const s = String(v ?? "").trim();
  if(!s) return "";
  // base64 內容允許換行（有些編碼器會折行），但不允許引號、角括號與空白以外的雜訊。
  if(/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s;
  if(/^https:\/\/[^\s"'<>\\]+$/.test(s)) return s;
  return "";
}
