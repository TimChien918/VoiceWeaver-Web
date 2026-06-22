<div align="center">

# 🗣️ VoiceWeaver — 網頁輕量版

**純瀏覽器／API 的失語溝通輔助，免安裝、開箱即用**

零碎的詞 → AI 重組成自然句 → 朗讀出來。登入後自動雲端記住你的設定，換裝置就還原。

![Live](https://img.shields.io/badge/Live-GitHub%20Pages-0a84ff)
![Stack](https://img.shields.io/badge/純前端-HTML%20%2F%20JS-f7df1e?logo=javascript&logoColor=black)
![Backend](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?logo=firebase&logoColor=black)
![No build](https://img.shields.io/badge/build-免打包-brightgreen)

[🌐 開啟 Live Demo](https://timchien918.github.io/VoiceWeaver-Web/) · [📱 Android 完整版](https://github.com/TimChien918/VoiceWeaver)

</div>

---

純 **API／瀏覽器** 的失語溝通輔助網頁——**不做任何本地運算**（沒有 GPT-SoVITS、沒有本地模型）。
登入後用 **Firebase** 自動記住你的 API 金鑰與設定，換裝置／瀏覽器登入即自動還原，並與 Android 版**即時雙向同步**。

> 這是**獨立專案**，與 Android／Mac 版分開，可直接部署到 **GitHub Pages**。用同一個 Google 帳號登入即可與 App 共用金鑰與供應商清單。

## 目錄

- [功能](#功能)
- [技術](#技術)
- [一、設定 Firebase（5 分鐘）](#一設定-firebase5-分鐘)
- [二、部署到 GitHub Pages](#二部署到-github-pages)
- [安全提醒](#安全提醒)
- [檔案結構](#檔案結構)

## 功能

- **語句重組**：碎詞 → 自然句（Gemini／Groq／OpenRouter，自動輪詢備援）
- **AAC 圖卡**：分類點選 → 朗讀／組成句子
- **語音復健**：選句（自訂或臨床題庫）→ 聽整句 → 字卡發音 → 跟讀錄音 → Levenshtein 評分 → 紀錄
- **朗讀／語音輸入**：瀏覽器內建 Web Speech（免金鑰）
- **AI 生圖**：意圖圖卡（Pollinations，免金鑰）
- **定位情境**：瀏覽器定位 + Overpass 找附近地點
- **相機辨識**：拍照 → Gemini Vision 認物品（需 Gemini 金鑰）
- **緊急通報**：Telegram（按 `Esc` 觸發；需填 Bot Token + Chat ID）
- **即時雲端同步**：API 金鑰／設定／使用紀錄用 Firestore `onSnapshot` 即時同步，歷史分頁附「🔄 更新」手動重抓
- 主題（深／淺／自動）、語言、語速、字體、供應商選擇——全部自動雲端保存

## 技術

| 層 | 用什麼 |
| --- | --- |
| 前端 | 原生 HTML / CSS / ES Module（無框架、無打包步驟） |
| 登入 | Firebase Authentication（Google／匿名） |
| 儲存 | Firestore（即時同步）；未設定 Firebase 時自動退回 `localStorage` |
| 語音 | 瀏覽器原生 Web Speech API（TTS／STT，免金鑰） |
| LLM | Gemini／Groq／OpenRouter（可跨域呼叫，自動輪詢備援） |
| 部署 | GitHub Pages（純靜態） |

## 一、設定 Firebase（5 分鐘）

1. 到 <https://console.firebase.google.com> 建立專案。
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

1. 在 GitHub 建一個 repo，把本資料夾推上去：
   ```bash
   git init && git add -A && git commit -m "VoiceWeaver web"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/VoiceWeaver-Web.git
   git push -u origin main
   ```
2. repo → **Settings → Pages → Source: Deploy from a branch → main /(root) → Save**。
3. 等 1 分鐘，網址會是 `https://<你的帳號>.github.io/VoiceWeaver-Web/`。
4. 回 Firebase **Authentication → Settings → Authorized domains**，把 `你的帳號.github.io` 加進去（Google 登入才會過）。

> `config.js` 需一起 commit 才能在 Pages 生效。Firebase 的 web 設定本來就是公開可見，安全靠上面的 Firestore 規則 + 登入；真正敏感的 LLM 金鑰是「使用者自己登入後填」，存在各自的 Firestore，不在程式碼裡。

## 安全提醒

- 網頁版的 LLM 金鑰本質上用戶端可見（存在使用者自己的瀏覽器與 Firestore）。請用**可隨時撤銷的個人金鑰**。
- 部分供應商不允許瀏覽器直接呼叫（CORS）；本版預設用可跨域的 **Gemini／Groq／OpenRouter／Pollinations**。

## 檔案結構

```text
index.html        介面
style.css         樣式（深／淺色）
config.example.js → 另存 config.js 填 Firebase
js/store.js       Firebase 登入 + Firestore 即時同步（無 Firebase 時退 localStorage）
js/llm.js         多供應商重組
js/providers.js   LLM／生圖供應商目錄
js/speech.js      Web Speech TTS／STT
js/aac.js         AAC 圖卡資料
js/rehab.js       語音復健（聽 → 字卡 → 跟讀 → 評分）
js/extras.js      生圖／定位／相機視覺／Telegram
js/app.js         主邏輯
```

---

> 隱私：不內建任何語音模型；語音合成走瀏覽器原生 TTS。LLM 金鑰由使用者自行填寫、存在個人 Firestore，程式碼與版控皆不含金鑰。
