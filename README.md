# VoiceWeaver 網頁輕量版

純 **API / 瀏覽器** 的失語溝通輔助網頁——**不做任何本地運算**（沒有 GPT-SoVITS、沒有本地模型）。
登入後用 **Firebase** 自動記住你的 API 金鑰與設定，換裝置/瀏覽器登入即自動還原。

> 這是**獨立專案**，與 Android／Mac 版分開。可直接部署到 **GitHub Pages**。

## 功能
- **語句重組**：碎詞 → 自然句（Gemini / Groq / OpenRouter，自動輪詢備援）
- **AAC 圖卡**：分類點選 → 朗讀 / 組成句子
- **朗讀 / 語音輸入**：瀏覽器內建 Web Speech（免金鑰）
- **AI 生圖**：意圖圖卡（Pollinations，免金鑰）
- **定位情境**：瀏覽器定位 + Overpass 找附近地點
- **相機辨識**：拍照 → Gemini Vision 認物品（需 Gemini 金鑰）
- **緊急通報**：Telegram（按 Esc 觸發；需填 Bot Token + Chat ID）
- **歷史紀錄**：Firestore 雲端同步
- 主題（深/淺/自動）、語言、語速、字體、供應商選擇——全部自動雲端保存

## 一、設定 Firebase（5 分鐘）
1. 到 https://console.firebase.google.com 建立專案。
2. **Authentication → Sign-in method**：啟用「**Google**」與「**匿名**」。
3. **Firestore Database → 建立資料庫**（正式模式），貼上規則（見下）。
4. **專案設定 → 一般 → 你的應用程式 → Web** → 複製 `firebaseConfig`。
5. 把 `config.example.js` 另存為 **`config.js`**，貼上你的 `firebaseConfig`。

> 沒有 `config.js` 也能用，但只會存在本機（不雲端同步）。

### Firestore 安全規則（只有本人能讀寫自己的資料）
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 二、部署到 GitHub Pages
1. 在 GitHub 建一個**新的空 repo**（例如 `voiceweaver-web`）。
2. 在本資料夾：
   ```bash
   git init && git add -A && git commit -m "VoiceWeaver web"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/voiceweaver-web.git
   git push -u origin main
   ```
3. GitHub repo → **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**。
4. 等 1 分鐘，網址會是 `https://<你的帳號>.github.io/voiceweaver-web/`。
5. 回 Firebase **Authentication → Settings → Authorized domains**，把 `你的帳號.github.io` 加進去（Google 登入才會過）。

> `config.js` 需要一起 commit 才能在 Pages 上生效。Firebase 的 web 設定本來就是公開可見的，安全靠上面的 Firestore 規則 + 登入；真正敏感的 LLM 金鑰是「使用者自己登入後填」，存在各自的 Firestore，不在程式碼裡。

## 三、安全提醒
- 網頁版的 LLM/金鑰本質上是用戶端可見（存在使用者自己的瀏覽器與 Firestore）。請用**可隨時撤銷的個人金鑰**。
- 部分供應商不允許瀏覽器直接呼叫（CORS）；本版預設用可跨域的 **Gemini / Groq / OpenRouter / Pollinations**。

## 檔案
```
index.html        介面
style.css         樣式（深/淺色）
config.example.js → 另存 config.js 填 Firebase
js/store.js       Firebase 登入 + Firestore 自動同步（無 Firebase 時退 localStorage）
js/llm.js         多供應商重組
js/speech.js      Web Speech TTS/STT
js/aac.js         AAC 圖卡資料
js/extras.js      生圖 / 定位 / 相機視覺 / Telegram
js/app.js         主邏輯
```
