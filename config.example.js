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

/*
 * 「用我的 Google 帳號額度」（OAuth 2.0，免 API 金鑰）用的網頁用戶端 ID。**選填。**
 *
 *   留空：一樣可以用，權杖改由 Firebase 的 Google 登入彈窗取得。
 *         代價是 access token 一小時到期，之後要使用者自己按一次「重新授權」。
 *   填了：改用 Google Identity Services，權杖過期時多半能安靜換一把新的，
 *         使用者講話講到一半不會被彈窗打斷。
 *
 * 去哪裡拿：
 *   1. Google Cloud Console → API 和服務 → 憑證
 *      （Firebase 專案本來就有一個「Web client (auto created by Google Service)」，
 *        直接用那個也可以）
 *   2. 「已授權的 JavaScript 來源」要加上你網站的網址
 *      （例如 https://你的帳號.github.io，本機測試再加 http://localhost:8000）
 *   3. 把用戶端 ID 貼進下面
 *
 * 註：用戶端 ID 跟 Firebase apiKey 一樣是公開可見的，安全靠「已授權來源」限制。
 */
window.__GOOGLE_OAUTH__ = { clientId: "" };
