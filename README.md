<div align="center">

# 🗣️ VoiceWeaver 網頁版

**為失語症、語言復健與臨場表達困難者打造的 AI 溝通輔助網頁**

純 API／瀏覽器，免安裝、免本地運算；用同一個 Google 帳號與 Android App 雙向同步。

![Pages](https://img.shields.io/badge/GitHub%20Pages-Live-0a84ff)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?logo=firebase&logoColor=black)
![No backend](https://img.shields.io/badge/後端-無（純%20API）-lightgrey)

[🌐 Live Demo](https://timchien918.github.io/VoiceWeaver-Web/) ·
[Android App 原始碼](https://github.com/TimChien918/VoiceWeaver)

</div>

---

VoiceWeaver 有兩個版本，用同一個 Google 帳號登入即可雙向同步 API 金鑰與設定：

| 版本 | 說明 | 連結 |
| --- | --- | --- |
| **網頁輕量版**（本專案） | 純瀏覽器／API，免安裝，可直接用 | [Live Demo](https://timchien918.github.io/VoiceWeaver-Web/) |
| **Android App** | 完整功能：離線推理、相機、定位、鼻控、GPT-SoVITS | [原始碼](https://github.com/TimChien918/VoiceWeaver) |

## 功能總覽

| 分類 | 重點功能 |
| --- | --- |
| **語句重組** | 碎詞 → 自然句（Gemini / Groq / OpenRouter 自動輪詢備援）、語音輸入、地點／相機情境 |
| **結果操作** | TTS 朗讀、多語朗讀（🇹🇼中 / 🇺🇸EN / 🇯🇵日 / 🇰🇷한）、一鍵複製、原生分享、加入最愛 |
| **我的最愛** | 常用句快捷卡，點一下即朗讀 |
| **AAC 圖卡** | 分類點選 → 組合 → 朗讀／重組成自然句 |
| **語音復健** | AI 全判讀評分（Groq / Gemini，非字元差異）、錯誤字高亮、整段分句逐句練習、streak 連續天數 |
| **成績單** | 練習次數、平均分、連續天數、正向情緒統計、趨勢折線圖、CSV 匯出、Telegram 推送 |
| **生圖** | Pollinations 意圖圖卡（免金鑰） |
| **緊急通報** | 按 Esc 觸發，Telegram 發送（需填 Bot Token + Chat ID） |
| **雲端同步** | Firebase Firestore：API 金鑰、設定、最愛、復健日誌（與 Android App 同結構）自動同步 |
| **離線備援** | 無 Firebase 時退回 localStorage，功能完整可用 |

## 快速開始

### 1. 設定 Firebase（5 分鐘，選用）

> 跳過此步驟也能用——僅退回本機儲存，不會雲端同步。

1. 到 [Firebase Console](https://console.firebase.google.com) 建立專案。
2. **Authentication → Sign-in method**：啟用「**Google**」與「**匿名**」。
3. **Firestore Database → 建立資料庫**（正式模式），貼上以下規則：

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

4. **專案設定 → 一般 → 你的應用程式 → Web** → 複製 `firebaseConfig`。
5. 把 `config.example.js` 另存為 **`config.js`**，貼上你的 `firebaseConfig`。

### 2. 部署到 GitHub Pages

```bash
git clone https://github.com/TimChien918/VoiceWeaver-Web.git
cd VoiceWeaver-Web
# 填好 config.js 後：
git add config.js && git commit -m "add firebase config"
git push
```

GitHub repo → **Settings → Pages → Source: main / (root) → Save**。

等約 1 分鐘，網址會是 `https://<你的帳號>.github.io/VoiceWeaver-Web/`。

> **Google 登入授權網域**：回 Firebase → Authentication → Settings → Authorized domains，加入 `你的帳號.github.io`。

### 3. 填入 LLM 金鑰

登入後到「**設定**」分頁 → 新增文字供應商，填入 Gemini / Groq / OpenRouter 任一金鑰即可開始重組。

## 技術說明

- **語言**：純 ES6 模組（無打包工具），可直接用 GitHub Pages 靜態托管。
- **TTS / STT**：瀏覽器原生 Web Speech API（免金鑰、無本地模型）。
- **LLM**：多供應商輪詢備援（`js/llm.js`），失敗自動切下一家。
- **復健評分**：呼叫雲端 LLM（Groq / Gemini）語義判讀，回傳 `{score, feedback, wrongChars}`；無金鑰時退回字符重疊率計算。
- **Firestore 結構**：`users/{uid}/rehabLogs` 與 Android App 完全相同，兩端資料互通。

## 安全提醒

- LLM 金鑰儲存於使用者自己的瀏覽器（localStorage）與 Firestore，受 Firebase 安全規則保護，不存在程式碼中。
- 請使用**可隨時撤銷的個人金鑰**，並定期到各供應商後台確認用量。
- 部分供應商不允許瀏覽器直接呼叫（CORS）；本版預設使用可跨域的 Gemini / Groq / OpenRouter / Pollinations。

## 專案結構

```text
index.html              主介面（重組、復健、成績單、AAC、歷史、設定六個分頁）
style.css               深/淺色主題、響應式樣式
config.example.js    →  另存 config.js 填入 Firebase 設定
js/
├── app.js              主邏輯（分頁、重組、AAC、最愛、多語朗讀）
├── store.js            Firebase 登入 + Firestore 同步（無 Firebase 退 localStorage）
├── llm.js              多供應商 LLM 重組 + 復健 AI 評分 + AI 建議
├── speech.js           Web Speech TTS（含 speakIn 多語）/ STT
├── rehab.js            語音復健（整段分句、隊列練習、錯誤高亮、streak）
├── report.js           成績單（統計、趨勢圖、CSV 匯出、Telegram 推送）
├── aac.js              AAC 圖卡資料
├── extras.js           生圖 / 定位 / 相機辨識 / Telegram
└── providers.js        LLM / 生圖供應商清單
```

## 隱私與授權

- **無本地模型**：網頁版純靠 API，不下載任何 AI 模型到裝置。
- **金鑰不入版控**：`config.js` 含 Firebase 公開設定（不含 LLM 金鑰），LLM 金鑰由使用者登入後自行填寫，存在個人 Firestore，不在程式碼裡。
- 本專案程式碼本身尚未公開授權（保留所有權利）；如需重用請先聯絡作者。
