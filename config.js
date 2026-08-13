// Firebase 設定（web config 為公開可見，安全靠 Auth + Firestore 規則）。
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyDawUNHovFwAjjxy3jfs55aSOjEnrtk4qQ",
  authDomain: "voiceweaver-af4da.firebaseapp.com",
  projectId: "voiceweaver-af4da",
  storageBucket: "voiceweaver-af4da.firebasestorage.app",
  messagingSenderId: "944612365052",
  appId: "1:944612365052:web:2954695303d1bfeb83fd79",
};

// 「用我的 Google 帳號額度」用的 OAuth 2.0 網頁用戶端 ID（選填）。
// 填了才有安靜續期（權杖過期時使用者不會被打斷）；留空一樣能用，
// 只是每小時要按一次「重新授權」。取得方式見 config.example.js。
window.__GOOGLE_OAUTH__ = { clientId: "" };
