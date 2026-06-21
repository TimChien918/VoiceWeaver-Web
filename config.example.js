/*
 * Firebase 設定（雲端登入 + 自動記住金鑰/設定）。
 *
 * 用法：
 *   1. 到 https://console.firebase.google.com 建一個專案
 *   2. Build → Authentication → 開啟「Google」與「匿名」登入
 *   3. Build → Firestore Database → 建立資料庫（正式模式），規則見 README
 *   4. 專案設定 → 你的應用程式（Web）→ 複製 firebaseConfig
 *   5. 把這個檔案另存為 config.js，貼上你的設定
 *
 * 註：Firebase 的 web 設定（apiKey 等）本來就是公開可見的，安全靠 Auth + Firestore 規則。
 *     沒有 config.js 時，網頁仍可用，只是不會雲端同步（純本機 localStorage）。
 */
window.__FIREBASE_CONFIG__ = {
  apiKey: "貼上你的 apiKey",
  authDomain: "你的專案.firebaseapp.com",
  projectId: "你的專案",
  appId: "貼上你的 appId",
};
