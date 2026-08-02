<div align="center">

# 🗣️ VoiceWeaver 網頁版

**為失語症、語言復健與臨場表達困難者打造的 AI 溝通輔助網頁**

純 API／瀏覽器，免安裝、免本地運算；用同一個 Google 帳號與 Android App 雙向同步，並可連上電腦或 Colab 的雲端曲庫。

![Pages](https://img.shields.io/badge/GitHub%20Pages-Live-0a84ff)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?logo=firebase&logoColor=black)
![Drive](https://img.shields.io/badge/曲庫-Google%20Drive-4285F4?logo=googledrive&logoColor=white)
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
| **語句重組** | 碎詞 → 自然句，多供應商自動輪詢備援（Gemini / Groq / OpenRouter / DeepSeek / Mistral / Together / Cohere / OpenAI）、自我一致性排序（同一句話取樣多次，選共識最高的重組結果）、語音輸入（辨識語言跟著介面語言走）、地點／相機情境、直接把錄音餵給支援原生音訊的模型（跳過語音轉文字，避免辨識先出錯） |
| **結果操作** | TTS 朗讀、多語朗讀（🇹🇼中 / 🇺🇸EN / 🇯🇵日 / 🇰🇷한）、一鍵複製、原生分享、加入最愛 |
| **我的最愛** | 常用句快捷卡，點一下即朗讀 |
| **AAC 圖卡** | 216 張卡、12 類別（商品／飲食／金額／動作／需求／人物／地點／醫療／時間／問句／情緒／緊急）、費茲傑羅詞性色碼（黃名詞／綠動詞／藍形容詞）、依使用頻率／時段／地點與詞語共現自動排序（「常用」快捷列＋類別內重排，類別順序本身固定不動）、整句緩衝（點卡進句、按朗讀一次連貫唸）、字級 A~A＋＋＋（特大 2 欄／巨大 1 欄自動降級）、📷 相機拍照自訂圖卡、自訂金額（NTD/USD/JPY/KRW/CNY/EUR） |
| **三段防呆介面** | 輕症（鍵盤打字為主）／中症（超大圖卡預設展開）／重症（去科技化全螢幕紙圖卡、單一情境鎖定、照護者 PIN＋**可見按鈕**退出），詳見下方章節 |
| **觸控防呆** | 全站互動只認手指放開那一刻、逐元素防手抖連點、捲動位移超過門檻不算點擊、全面禁止長按觸發選單 |
| **語音復健** | 臨床題庫（名詞／動詞／短句／情境句，離線可練）、AI 全判讀評分（語意／流暢／語氣三面向，非字元差異）、**跟讀辨識與評分跟著介面語言走**（英文介面就練英文，顯示／朗讀／辨識／評分同一語言）、AI 依程度推薦練習句、整段文章自動分句排隊逐句練、錯誤字／詞高亮、streak 連續天數 |
| **看圖說故事** | 3 組四格情境圖卡練習（賣檳榔／身體不適求助／廟口買冷飲），語音輸入講故事、關鍵字命中率算分（同一段話重評不會忽高忽低）、AI 給一句鼓勵＋具體下一步建議 |
| **成績單** | 練習次數、平均分、連續天數、正向情緒統計、趨勢折線圖、CSV 匯出（瀏覽器端產生，不經伺服器）、PDF 匯出（開新視窗走瀏覽器列印，中日韓字型渲染正確）、Telegram 推送 |
| **生圖** | Pollinations 意圖圖卡（免金鑰）／電腦或 Colab 的 SD-Turbo／Gemini／HuggingFace／OpenAI |
| **角色語音** | 讓電腦或 Colab 幫忙跑 GPT-SoVITS，依句子自動偵測情緒切換語氣；雲端曲庫瀏覽＋隨選下載 |
| **🆘 危機介入（雙向）** | 關鍵字攔截 → AI 判斷是本人求助還是代替他人求助（避免誤鎖住求救訊息）→ 立即通報家人（Telegram）＋前後鏡頭現場快照＋免登入視訊通話房；**家人可在 Telegram 回覆指令**：`/call` 強制加入視訊、`/camera` 要求再拍現場、`/end` 結束對話；使用者可傳安撫快捷語或錄約 6 秒語音訊息給家人；呼吸引導動畫陪伴等待；1925 安心專線／119／家人電話一鍵直撥；**對話視窗使用者無法自行關閉**，需家人 `/end` 才會結束 |
| **雲端同步** | Firebase Firestore：API 金鑰、設定、最愛、復健日誌（與 Android App 同結構）自動同步 |
| **離線備援** | 無 Firebase 時退回 localStorage，功能完整可用；LLM 全部失敗時句子重組退回規則模板、復健評分退回字元／詞語重疊率計算 |
| **簡轉繁校正** | 部分雲端模型即使提示詞要求繁體，偶爾仍會吐出簡體字；用 OpenCC 字元＋詞組雙層對照校正（round-trip 驗證過，不會誤改本來就正確的繁體字） |

## 🧓 三段防呆介面

- **🟩 輕症（語法訓練）**：鍵盤打字為主、完整功能。點卡「只進整句緩衝」不即時朗讀，組完按「🔊 朗讀」整句連貫唸出；費茲傑羅色碼＋使用頻率排序引導自然語序。
- **🟨 中症**：超大圖卡預設展開，隱藏複雜設定，介於輕重症之間。
- **🟥 重症／高齡防呆**：設定頁「進入防呆模式」→ 自動全螢幕、只剩鎖定情境的幾張超大卡（或照護者拍的照片卡），點卡立即輕快朗讀（GPT-SoVITS 走「開心」情緒／瀏覽器 TTS 提高音調）＋提示音＋放大動畫；螢幕常亮（Wake Lock）不熄滅；重新整理會自動回到防呆畫面，長輩不會迷路。
  - **退出方式**：畫面上有一顆明確標示的「✕ 關閉」按鈕，點下去要輸入 4 位 PIN（預設 `1234`）才能離開——刻意不做成「連點右上角隱形區」，因為連照護者自己在真正需要時都不見得能連點準；安全性完全靠 PIN，不靠「不好找」。

## 🆘 危機介入：偵測、通報、雙向對話

與 Android App 行為一致，三層防線：

1. **關鍵字攔截**：偵測到自傷／拒絕治療相關字眼即進入下一步判斷，容忍字元間夾雜空白。
2. **AI 判斷意圖**（而非只看關鍵字）：分類成「本人想自傷」「代替他人求助（例如『我朋友想自殺，快叫救護車』）」「與自傷無關」「無法判斷」。這個分類呼叫刻意不掛「拒絕危險字眼」的防禦提示詞——那會讓模型直接拒答，而分類任務不該被擋。
3. **通報與介入**：
   - 立刻發 Telegram 通知家人（不等定位——定位最慢 6 秒，那 6 秒是家人還不知道出事的時間），定位補在第二則訊息。
   - 靜默擷取前／後鏡頭快照傳給家人；拿不到鏡頭權限就安靜跳過，不擋住通報本身。
   - 給一個免登入免輸名字的視訊通話房連結（Jitsi Meet）。
   - **家人可在 Telegram 直接回覆指令**：`/call`（強制使用者加入視訊，彈窗被瀏覽器擋掉時按鈕會閃爍提示）、`/camera`（要求再拍一次現場）、`/end`（結束對話）；其他文字直接以「家人」對話框顯示給使用者看。
   - 開窗時會把這份指令說明也傳給家人——收到連結卻不知道能做什麼，家人只會乾等。
   - 使用者可傳幾句安撫快捷語或自訂文字，也能錄一段約 6 秒的語音訊息給家人。
   - 呼吸引導動畫（吸 4 秒吐 4 秒）陪伴等待家人回應的過程。
   - 1925 安心專線、119 直撥、改撥家人電話備援。
   - **對話視窗使用者無法自行關閉**，只有家人在 Telegram 輸入 `/end` 才會關閉——會走到這個畫面的人，正是最不該讓他一個人把求救關掉的時候。
   - 輪詢一開始會用 `offset=-1` 快轉略過 Telegram 的積壓訊息，避免上一次危機家人打過的 `/end` 被重播、新視窗一開就被誤關。

> **已知限制**：Telegram 的 `getUpdates` 是「誰先拿到誰吃掉」。手機 App 與網頁版若共用同一個 bot token、又同時開著危機視窗，家人的回覆只會被其中一邊收到。

## ☁️ 讓電腦或 Colab 幫忙跑運算

網頁本身不存模型、不做語音合成——語音、生圖、文字都是打「運算端」的 HTTP 橋接（port `9879`）代理過去：

- **同一台電腦**：開網頁的電腦＝跑語音中心（Mac/Win）的電腦 → 免填位址，直接「偵測連線」即可。
- **Colab 免費 GPU**：電腦沒空、或想用免費 GPU 時，執行 `VoiceWeaver_GPT_SoVITS_Colab.ipynb`，複製 ngrok 給的公開網址貼進設定頁，或直接按「☁️ 用此 Colab 網址連線」一鍵套用。
- **遠端電腦**：跑 `tailscale serve --bg 9879`（把橋接埠對外成 HTTPS），設定頁填 `https://主機.xxx.ts.net`。
- ⚠️ 瀏覽器混合內容限制：HTTPS 頁面連不到區網 `http://192.168.x.x`，僅「同機」「Colab（ngrok）」「Tailscale」三種連法可用。

**雲端曲庫**：不論連到電腦還是 Colab，看到的都是同一個 Google Drive 曲庫（`js/localtts.js` 的 `localCatalog()` / `localPrepare()`）——角色清單標示已下載／未下載，未下載的按「下載」請運算端先從 Drive 抓下來，之後合成不用等。

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

### 4.（選用）緊急通報

到「設定」分頁填入 Telegram Bot Token 與 Chat ID，才能使用求救／危機介入功能通知家人。

### 5.（選用）連上電腦或 Colab 跑語音

到「設定 → 讓電腦幫忙跑運算」啟用，同機直接偵測，或依上方「讓電腦或 Colab 幫忙跑運算」章節設定。

## 技術說明

- **語言**：純 ES6 模組（無打包工具），可直接用 GitHub Pages 靜態托管。
- **TTS / STT**：預設瀏覽器原生 Web Speech API（免金鑰），辨識語言跟著介面語言走；連上電腦／Colab 時 TTS 改用 GPT-SoVITS 角色聲音（`js/localtts.js`）。
- **LLM**：多供應商自動輪詢＋失敗換下一家（`js/providers.js`），復健評分會改用固定順序而非輪替，避免同一句話因為換了模型而分數飄動。
- **句子重組**：`js/llm.js` 對同一組碎詞平行取樣多次，每次回傳多個候選句，攤平後依「相同文意出現次數、再看平均信心」排序取前三；JSON 解析容忍截斷與格式錯誤，絕不把解析失敗的原始 JSON 當作一句話唸出來。
- **危機意圖分類**：`classifyCrisisIntent()` 獨立於句子重組之外呼叫，刻意不掛安全防禦提示詞，因為那會讓分類任務被模型拒答。
- **復健評分**：呼叫雲端 LLM 語義判讀，回傳 `{score, feedback, wrongChars}`；提示詞要求輸出語言跟著介面語言走；無金鑰或呼叫失敗時退回重疊率計算（中文按字、拉丁語言按詞）。
- **本機橋接協定**（`js/localtts.js` ↔ 電腦/Colab port 9879）：

  | 端點 | 用途 |
  | --- | --- |
  | `GET /health` | 偵測連線、回報語音／生圖／文字三項可用性 |
  | `GET /voices` | 角色清單（含語言、已下載狀態） |
  | `GET /catalog` | 完整雲端曲庫（Apple Music 式瀏覽用） |
  | `GET /prepare?character=&lang=` | 隨選下載：請運算端把角色從 Drive 抓下來 |
  | `POST /switch` | 切換角色（沒下載會自動先抓） |
  | `POST /detect_emotion` | 從文字偵測情緒 |
  | `POST /speak` | 合成 → `audio/wav`（帶 `X-Emotion` 標頭） |

- **Firestore 結構**：`users/{uid}/rehabLogs` 與 `users/{uid}/history` 與 Android App 完全相同，兩端資料互通。

## 安全提醒

- LLM 金鑰儲存於使用者自己的瀏覽器（localStorage）與 Firestore，受 Firebase 安全規則保護，不存在程式碼中。
- 請使用**可隨時撤銷的個人金鑰**，並定期到各供應商後台確認用量。
- 部分供應商不允許瀏覽器直接呼叫（CORS）；本版預設使用可跨域的 Gemini / Groq / OpenRouter / Pollinations。
- Telegram Bot Token／Chat ID 同樣只存在使用者自己的瀏覽器與 Firestore。
- ngrok 授權碼透過配對碼從你的帳號雲端取用，不會出現在 Colab notebook 或程式碼裡。

## 專案結構

```text
index.html              主介面（重組、復健、成績單、AAC、歷史、設定六個分頁 + 求救／鎖定彈窗）
style.css               深/淺色主題、響應式樣式、四種視覺風格
config.example.js    →  另存 config.js 填入 Firebase 設定
s2t_map.txt / s2t_phrases.txt   簡轉繁字元／詞組對照表（zhconv.js 用）
js/
├── app.js              主邏輯（分頁、重組、AAC、最愛、多語朗讀、雲端曲庫清單渲染、防呆模式切換）
├── store.js            Firebase 登入 + Firestore 同步（無 Firebase 退 localStorage）
├── safety.js            關鍵字攔截、風險分級（normal/confirm/lock）、輸出消毒
├── crisis.js            危機介入視窗（現場快照、家人指令、語音訊息、呼吸引導、專線）
├── llm.js               多供應商 LLM 重組（自我一致性排序）+ 危機意圖分類 + 復健 AI 評分 + AI 建議
├── localtts.js          電腦／Colab 橋接（偵測、角色切換、合成、曲庫瀏覽與下載）
├── providers.js         LLM / 生圖供應商清單與輪詢邏輯
├── speech.js            TTS（含 speakIn 多語）/ STT，跟著介面語言走
├── audiodirect.js       原生音訊直接理解（跳過 STT，餵給支援音訊的模型）
├── rehab.js             語音復健（整段分句、隊列練習、錯誤高亮、streak）
├── clinical.js          復健臨床題庫（名詞／動詞／短句／情境句）
├── story.js / storydata.js   看圖說故事訓練
├── aac.js / aacdata.js / aacrank.js   AAC 圖卡資料、費茲傑羅色碼、使用頻率排序
├── kiosk.js             高齡防呆全螢幕模式（PIN 退出）
├── interaction.js        全站觸控防呆（pointerup-only、防連點、捲動判斷）
├── headcontrol.js        鼻／頭部追蹤輔助操作
├── report.js             成績單（統計、趨勢圖、CSV/PDF 匯出、Telegram 推送）
├── behavior.js           行為數據彙總（反應時間、選句命中率、修改次數、輸入方式比例）
├── zhconv.js             簡轉繁校正（OpenCC 字元＋詞組對照）
└── extras.js             生圖 / 定位 / 相機辨識 / Telegram（通報、現場快照、語音訊息、家人回覆輪詢）
```

## 隱私與授權

- **無本地模型**：網頁版純靠 API／橋接，不下載任何 AI 模型到裝置本身。
- **語音模型存在使用者自己的 Google Drive**：網頁不碰 Drive，只是把文字送到你自己的電腦或 Colab，運算端才存取你自己帳號授權的曲庫。
- **金鑰不入版控**：`config.js` 含 Firebase 公開設定（不含 LLM 金鑰），LLM／Telegram 金鑰由使用者登入後自行填寫，存在個人 Firestore，不在程式碼裡。
- **危機通報**：現場快照與語音訊息僅傳給使用者自行設定的家人 Telegram，不經任何第三方伺服器。
- 本專案程式碼本身尚未公開授權（保留所有權利）；如需重用請先聯絡作者。
