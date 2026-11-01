// 一鍵自動演示 ＋ 螢幕錄影（評審現場播放／錄影參賽用）。
//
// 敘事順序照設計書（2027 TEYI 世界青少年發明展作品摘要）：
//   開場（拾語者是什麼、為誰）→ ① 語意織句引擎與情境感知補位 → ② 多模態無障礙介面
//   → ③ AI 語音復健與復健軌跡 → ④ 語意防護與主動式危機介入 → ⑤ 擬真聲紋與情感語音 → 收尾。
// 評審是照著設計書在看的，畫面順序跟書面一致，他們才對得上「這一頁在證明哪一項」。
//
// 設計上的三個硬性決定：
//
// ① **腳本化，不打任何外部請求。** 演示要能重播一百次都長一樣，而且不能在評審面前
//    被 LLM 逾時、金鑰過期、網路抖動毀掉。所以畫面用的是真的元件、真的版面，
//    只有 AI 的回覆是預先寫好的樣本。更重要的是：緊急通報、危機介入**絕對不能真的
//    送出去**——演示一次就吵到家人一次。危機那一段只照著真畫面重演，不呼叫 openCrisis()；
//    就算哪裡漏了，extras.js 的 Telegram 出口在 window.__VW_DEMO__ 期間也一律攔下。
// ② **不寫入任何資料。** 不呼叫 save()、不寫歷史、不碰 Firestore/Drive。
//    只改記憶體與 DOM，結束時還原（借用的節點整批搬走再搬回，事件監聽不會掉）。
// ③ **字幕與旁白跟著介面語言（中／英／日／韓）。** 評審可能是任何一國人，按下去之前
//    先把介面切成他的語言即可。旁白走電腦端 GPT-SoVITS 該語言的角色；連不上才退回
//    瀏覽器語音——寧可音色差一點，也不能錄到一半沒有聲音。
import { state } from "./store.js?v=1.5.78";
import { t } from "./i18n.js?v=1.5.78";
import { localSynth, localVoices, detectLocalTts } from "./localtts.js?v=1.5.78";
import { startScan, stopScan } from "./a11yscan.js?v=1.5.78";
import { bankFor } from "./clinical.js?v=1.5.78";
import { drawTrajectory, loadReport } from "./report.js?v=1.5.78";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// 排練／自動測試用的加速倍率（window.__VW_DEMO_SPEED__ = 8 就是八倍速）。
// 正式播放不設，等於 1。只縮短「等待」，不跳過任何一步——加速跑完沒卡住，原速就不會卡住。
const speed = () => Math.max(1, +window.__VW_DEMO_SPEED__ || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed()));

// 每一步的最短停留時間。沒有這個下限，動作做完就立刻跳下一步，評審連畫面變了什麼都看不清楚。
// 有旁白時通常是旁白比較長（下限很少生效）；純演示時它就是實際節奏。
const MIN_STEP_NARRATED = 3200;
const MIN_STEP_SILENT = 4200;
// 旁白唸完之後畫面再多停一下才換。零間隔看起來像「話還沒講完就跳掉」。
const TAIL_PAD = 900;

// 介面語言 → 演示語言（字幕、旁白、樣本句都跟著它）
const LANG_TAG = { zh: "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const LOCAL_LANG = { zh: "ZH", en: "EN", ja: "JA", ko: "KO" };
function demoLang() {
  const L = String(state.settings.lang || "en").split("-")[0];
  return LANG_TAG[L] ? L : "en";
}

// 「同一時間只准一個聲音」。畫面動作與旁白是並行跑的（畫面才不會等旁白講完才動），
// 但**聲音不能並行**——示範發聲會直接疊在旁白上，變成兩個人同時講話。
// 用一條 promise 鏈當發言權：後來的要等前一個放開。
let _audioChain = Promise.resolve();
function withAudioFloor(fn) {
  const next = _audioChain.then(fn, fn);
  _audioChain = next.catch(() => {});
  return next;
}

let _abort = false;          // 使用者按了 Stop／Esc
let _narrate = true;         // 旁白模式
let _lang = "en";            // 這一次演示的語言（開始時定下，途中不變）
let _voice = null;           // 旁白用的角色語音 {name, lang}
let _speakVoice = null;      // 「App 講話」用的角色，與旁白刻意不同
let _rec = null, _chunks = [], _recStream = null;
let _recSilent = null, _chunksSilent = [];   // 無聲版（同一次錄影的第二個輸出）

// ── 樣本資料（各語言一份；AI 的回覆是預先寫好的，不打任何 API）──────────────
function sample(L) {
  return {
    zh: {
      fragments: "水  休息  現在",
      place: "醫院復健科候診區", seen: "水杯、病床",
      candidates: ["我想喝點水，然後休息一下。", "可以給我一杯水嗎？我現在想躺下來休息。", "我口渴了，喝完水想先睡一下。"],
      medical: "我的頭很痛，需要吃止痛藥。",
      kiosk: [["💧", "水"], ["🛏", "休息"], ["💊", "吃藥"]],
      rehab: "我想喝一杯水。", heard: "我想喝一背水", wrong: ["杯"],
      rehabFb: "節奏很清楚，「杯」的聲調再上揚一點會更好。",
      crisis: "好累  不想活了",
      crisisLog: ["📍 目前位置已傳給家人", "📹 視訊連結已傳給家人", "👪 家人：我馬上過去，先跟著圓圈慢慢呼吸。"],
      crisisQuick: ["我好害怕", "請快來", "我現在安全"],
      own: "謝謝你們一直陪著我，我好多了。",
      emotions: ["😊 喜", "😠 怒", "😢 哀", "😄 樂"],
      sim: "已通知家人（演示模擬，未實際送出）",
    },
    en: {
      fragments: "water  rest  now",
      place: "Rehab clinic waiting area", seen: "cup, hospital bed",
      candidates: ["I'd like some water, then I need to rest.", "Could I have a glass of water? I want to lie down now.", "I'm thirsty — after some water I'd like a nap."],
      medical: "My head really hurts. I need a painkiller.",
      kiosk: [["💧", "water"], ["🛏", "rest"], ["💊", "medicine"]],
      rehab: "I would like a glass of water.", heard: "I would like a grass of water", wrong: ["glass"],
      rehabFb: "Clear rhythm. Watch the “l” in “glass” — try it a little slower.",
      crisis: "tired  don't want  to live",
      crisisLog: ["📍 Location sent to family", "📹 Video link sent to family", "👪 Family: I'm on my way. Breathe with the circle."],
      crisisQuick: ["I'm scared", "Please come", "I'm safe now"],
      own: "Thank you for staying with me. I feel much better.",
      emotions: ["😊 Happy", "😠 Angry", "😢 Sad", "😄 Cheerful"],
      sim: "Family notified (demo simulation — nothing sent)",
    },
    ja: {
      fragments: "水  休む  今",
      place: "リハビリ科の待合室", seen: "コップ、ベッド",
      candidates: ["お水を飲んで、少し休みたいです。", "お水を一杯もらえますか？今すぐ横になりたいです。", "のどが渇きました。水を飲んだら少し眠りたいです。"],
      medical: "頭がとても痛いです。痛み止めが必要です。",
      kiosk: [["💧", "みず"], ["🛏", "やすむ"], ["💊", "くすり"]],
      rehab: "お水を一杯ください。", heard: "お水を一敗ください", wrong: ["杯"],
      rehabFb: "リズムはとても良いです。「一杯」をもう少しはっきり言ってみましょう。",
      crisis: "つかれた  生きたくない",
      crisisLog: ["📍 現在地を家族に送信しました", "📹 ビデオ通話のリンクを家族に送信しました", "👪 家族：すぐ行くよ。丸に合わせてゆっくり呼吸してね。"],
      crisisQuick: ["こわい", "すぐ来て", "いまは大丈夫"],
      own: "いつもそばにいてくれてありがとう。だいぶ良くなりました。",
      emotions: ["😊 喜", "😠 怒", "😢 哀", "😄 楽"],
      sim: "家族に通知しました（デモの再現・実際には送信していません）",
    },
    ko: {
      fragments: "물  쉬다  지금",
      place: "재활의학과 대기실", seen: "컵, 병상",
      candidates: ["물 좀 마시고 잠깐 쉬고 싶어요.", "물 한 잔 주시겠어요? 지금 눕고 싶어요.", "목이 말라요. 물 마시고 좀 자고 싶어요."],
      medical: "머리가 너무 아파요. 진통제가 필요해요.",
      kiosk: [["💧", "물"], ["🛏", "쉬기"], ["💊", "약"]],
      rehab: "물 한 잔 주세요.", heard: "물 한 장 주세요", wrong: ["잔"],
      rehabFb: "리듬이 아주 좋아요. “잔”을 조금 더 또렷하게 말해 보세요.",
      crisis: "지쳤어  살기 싫어",
      crisisLog: ["📍 현재 위치를 가족에게 보냈습니다", "📹 영상 통화 링크를 가족에게 보냈습니다", "👪 가족: 지금 갈게. 원을 따라 천천히 숨 쉬어."],
      crisisQuick: ["무서워요", "빨리 와 주세요", "지금은 괜찮아요"],
      own: "늘 곁에 있어 줘서 고마워요. 많이 좋아졌어요.",
      emotions: ["😊 기쁨", "😠 분노", "😢 슬픔", "😄 즐거움"],
      sim: "가족에게 알렸습니다(데모 재현 · 실제로 보내지 않음)",
    },
  }[L];
}

// 品牌字一律「拾語者 Speak My Life」（標題卡）；旁白裡英文只唸 Speak My Life，
// 因為英文語音引擎碰到漢字會整段跳過或唸成亂碼。
const BRAND = "拾語者 Speak My Life";

// ── 演示單元 ────────────────────────────────────────────────────────────
// 每個單元是獨立的一段，使用者自己勾。step.cap＝字幕/旁白，step.act＝畫面動作，
// step.focus＝這一步在講的元素（選擇器或回傳元素的函式），開講前會先捲出來並確認看得見。
function UNITS(L = demoLang()) {
  const c = (zh, en, ja, ko) => ({ zh, en, ja, ko })[L] ?? en;
  const S = sample(L);
  return [
    {
      id: "intro", icon: "🎬", title: c("開場：拾語者是什麼", "Opening: what Speak My Life is", "オープニング：拾語者とは", "오프닝: Speak My Life란"),
      steps: [
        { act: () => titleCard(BRAND, t("login.tagline")),
          cap: c("全球每年約有一千兩百萬人新發生中風，其中約三成在急性期伴隨失語症。",
                 "Every year about twelve million people have a stroke, and roughly a third of them develop aphasia in the acute phase.",
                 "世界では毎年およそ1,200万人が脳卒中を発症し、その約3割が急性期に失語症を伴います。",
                 "전 세계에서 해마다 약 1,200만 명이 뇌졸중을 겪고, 그중 약 3분의 1이 급성기에 실어증을 동반합니다.") },
        { act: () => titleSub(c("失語症 · 言語失用症 · 吶語症", "Aphasia · Apraxia of speech · Dysarthria", "失語症 · 発語失行 · 構音障害", "실어증 · 말실행증 · 마비말장애")),
          cap: c("失語症、言語失用症、吶語症——他們心裡很清楚想說什麼，卻說不出口。",
                 "Aphasia, apraxia of speech, dysarthria — they know exactly what they want to say, but the words won't come out.",
                 "失語症、発語失行、構音障害。言いたいことははっきりしているのに、言葉にできないのです。",
                 "실어증, 말실행증, 마비말장애. 하고 싶은 말은 분명한데 입 밖으로 나오지 않습니다.") },
        { act: () => titleSub(t("login.tagline")),
          cap: c("拾語者 Speak My Life，是為中風失語者打造的 AI 溝通與居家復健系統。",
                 "Speak My Life is an AI communication and home-rehabilitation system for stroke survivors with aphasia.",
                 "拾語者 Speak My Life は、脳卒中後の失語症の方のための AI コミュニケーション・在宅リハビリシステムです。",
                 "Speak My Life(拾語者)는 뇌졸중 실어증 환자를 위한 AI 의사소통·재택 재활 시스템입니다.") },
        { cap: c("它把散落的碎詞拾起，重新組成自然、有溫度的句子，再由患者本人確認後說出口。",
                 "It picks up scattered words and weaves them into natural, warm sentences — spoken only after the patient confirms them.",
                 "ばらばらの言葉を拾い上げ、自然で温かい文に組み直し、ご本人が確認してから声にします。",
                 "흩어진 단어를 주워 자연스럽고 따뜻한 문장으로 엮고, 환자 본인이 확인한 뒤에야 소리 내어 말합니다.") },
        { act: hideTitle,
          cap: c("接下來，依五大功能模組實際操作一遍。", "Let's walk through its five core modules.",
                 "それでは、5つの主要モジュールを順にご覧ください。", "이제 다섯 가지 핵심 모듈을 차례로 보겠습니다.") },
      ],
    },
    {
      id: "semantic", icon: "💬", title: c("① 語意織句引擎・情境感知補位", "① Semantic sentence engine & context", "① 意味織文エンジンと状況補完", "① 의미 문장 엔진과 상황 보완"),
      steps: [
        { act: async () => { goTab("compose"); await typeInto("#fragments", S.fragments); }, focus: "#fragments",
          cap: c("模組一，語意織句引擎。患者只要打出、說出或點出幾個碎詞，例如「水、休息、現在」。",
                 "Module one: the semantic sentence engine. The patient only needs a few fragments — typed, spoken or tapped — like “water, rest, now”.",
                 "モジュール1、意味織文エンジン。入力は、打つ・話す・タップするなどした断片的な言葉だけ。たとえば「水、休む、今」。",
                 "모듈 1, 의미 문장 엔진. 환자는 “물, 쉬다, 지금”처럼 단어 몇 개만 입력하거나 말하거나 누르면 됩니다.") },
        { act: async () => { await press("#btnLoc"); setCtx(`📍 ${S.place}`); }, focus: "#btnLoc",
          cap: c("情境感知補位：GPS 判斷他正在醫院的復健科候診區，",
                 "Context awareness fills in the gaps: GPS places him in a rehab clinic waiting area,",
                 "状況認識が足りない部分を補います。GPSで、リハビリ科の待合室にいることがわかり、",
                 "상황 인식이 빈칸을 채웁니다. GPS로 재활의학과 대기실에 있다는 것을 알고,") },
        { act: async () => { await press("#btnCam"); setCtx(`📍 ${S.place} · 📷 ${S.seen}`); }, focus: "#btnCam",
          cap: c("相機也辨識出眼前的水杯和病床。", "and the camera recognises the cup and the bed in front of him.",
                 "カメラが目の前のコップとベッドを認識します。", "카메라는 눈앞의 컵과 병상을 알아봅니다.") },
        { act: async () => { await press("#btnCompose"); await reconstructWait(); showCandidates(S.candidates); }, focus: "#btnCompose", hold: 800,
          cap: c("大型語言模型把碎詞和情境織在一起，一次生成三個符合當下情境的候選句。",
                 "A large language model weaves the fragments and context together into three candidate sentences that fit the moment.",
                 "大規模言語モデルが言葉と状況を織り合わせ、その場に合った候補文を3つ生成します。",
                 "대규모 언어 모델이 단어와 상황을 엮어, 지금 상황에 맞는 후보 문장 세 개를 만듭니다.") },
        { act: () => pickCandidateDemo(S.candidates), focus: "#altList",
          cap: c("這就是語意確認機制：點選候選句只是選定、不會發聲，選哪一句由患者自己決定。",
                 "This is the semantic confirmation step: tapping a candidate only selects it — the patient decides which one is right.",
                 "ここが意味確認の仕組みです。候補をタップしても選ぶだけで、声にはなりません。どれにするかはご本人が決めます。",
                 "이것이 의미 확인 장치입니다. 후보를 눌러도 선택만 될 뿐 소리는 나지 않고, 어떤 문장인지는 환자가 직접 정합니다.") },
        { act: async () => { await press("#btnSpeak"); await speakDemoSentence(S.candidates[0]); }, focus: "#btnSpeak",
          cap: c("確認是這一句，按下朗讀，才真正說出口。", "Only when he confirms and presses Speak is the sentence said out loud.",
                 "これだと確かめて「読み上げ」を押したときだけ、声に出します。", "이 문장이 맞다고 확인하고 읽기를 눌러야 비로소 소리로 나옵니다.") },
        // 確認卡**不是**每一句都會出現：它擋的是 classifyRisk() 的 "confirm" 等級（醫療／疼痛），
        // 設定裡可以關（state.settings.confirmCard，預設開）。所以這裡換一句真的會觸發它的樣本，
        // 旁白也照實說「醫療或疼痛相關」，不對評審承諾每一句都要再確認一次。
        { act: () => showConfirm(S.medical), focus: "#confirmDlg", hold: 600,
          cap: c("跟醫療或疼痛有關的句子，還會再跳出大圖示確認卡，按「對」才唸出——把語言的選擇權還給患者。",
                 "Anything about pain or medicine gets an extra large-print confirmation card. Nothing is said until he taps Yes — the choice of words stays with the patient.",
                 "痛みや医療に関わる文には、大きな確認カードがもう一度出ます。「はい」を押すまで読み上げません。言葉を選ぶ権利は、ご本人に返します。",
                 "통증이나 의료와 관련된 문장은 큰 확인 카드가 한 번 더 뜨고, “네”를 눌러야 읽어 줍니다. 말을 고르는 권리를 환자에게 돌려줍니다.") },
        { act: () => confirmYes(S.medical), focus: "#confirmYes", cap: "" },
      ],
    },
    {
      id: "a11y", icon: "♿", title: c("② 多模態無障礙介面", "② Multimodal accessible interface", "② マルチモーダル・アクセシブルUI", "② 멀티모달 접근성 인터페이스"),
      steps: [
        { act: async () => { goSetting("care"); await sevModeDemo(); }, focus: "#sevModes",
          cap: c("模組二，多模態無障礙介面。中風常伴隨偏癱與視力退化，所以介面依輕、中、重度動態調整。",
                 "Module two: a multimodal, adaptive interface. Strokes often bring paralysis and low vision, so the interface adapts to mild, moderate and severe needs.",
                 "モジュール2、マルチモーダルな適応型インターフェース。脳卒中は片まひや視力低下を伴うことが多いため、軽度・中度・重度に合わせて画面が変わります。",
                 "모듈 2, 멀티모달 적응형 인터페이스. 뇌졸중은 편마비나 시력 저하를 동반하는 경우가 많아, 경도·중등도·중증에 맞춰 화면이 바뀝니다.") },
        { act: moderateDemo, focus: "#aacItems",
          cap: c("中度：圖卡放大成特大字，複雜的設定先收起來。",
                 "Moderate: picture cards grow to extra-large print, and complex settings are tucked away.",
                 "中度：絵カードは特大サイズになり、複雑な設定は隠れます。",
                 "중등도: 그림 카드가 아주 크게 바뀌고, 복잡한 설정은 숨겨집니다.") },
        { act: () => kioskMock(S.kiosk[0]), hold: 1200,
          cap: c("重度：全螢幕一次只出現一張大卡，自動逐張掃描，只要一個「是」的動作就能表達。",
                 "Severe: one large card fills the screen and scans automatically — a single “yes” action is enough to communicate.",
                 "重度：全画面に大きなカードが1枚ずつ表示され、自動で切り替わります。「はい」の動作ひとつで伝えられます。",
                 "중증: 큰 카드가 한 장씩 전체 화면에 나타나 자동으로 넘어가고, “예” 동작 하나만으로 의사를 전할 수 있습니다.") },
        { act: () => kioskTrail(S.kiosk), hold: 800,
          cap: c("選過的卡留成一串線索，熟悉的家人一看就懂。",
                 "Chosen cards stay as a trail of clues that family can read at a glance.",
                 "選んだカードは手がかりとして並び、家族はひと目で理解できます。",
                 "고른 카드는 단서처럼 남아 가족이 한눈에 알아볼 수 있습니다.") },
        { act: async () => { kioskClose(); restoreSeverity(); goSetting("prefs"); await noseDemo(); },
          focus: () => $("#s_head")?.closest("label"),
          cap: c("手不方便時，前鏡頭追蹤鼻尖來移動游標，停留約一秒就自動點擊——鼻控加上停留點選。",
                 "If the hands can't help, the front camera tracks the tip of the nose to move a cursor, and resting on a button for a second clicks it — nose control with dwell selection.",
                 "手が使えなくても、前面カメラが鼻先を追ってカーソルを動かし、ボタンの上で約1秒止まると自動でクリックします。鼻操作と停留クリックです。",
                 "손을 쓰기 어려우면 전면 카메라가 코끝을 따라 커서를 움직이고, 버튼 위에 1초쯤 머물면 자동으로 누릅니다. 코 조작과 머무름 선택입니다.") },
        { act: () => { goSetting("a11y"); scanDemoStart(); }, focus: () => $("#s_scan")?.closest("label"), hold: 1200,
          cap: c("連指標都無法移動的人，可以用掃描模式：畫面逐一高亮，按一下大開關就選取。",
                 "For those who can't move a pointer at all, switch scanning highlights each item in turn; one press of a big switch selects it.",
                 "ポインタも動かせない方には、スキャン操作。画面が順に強調表示され、大きなスイッチを一度押せば選べます。",
                 "포인터조차 움직이기 어려운 분은 스캔 모드를 씁니다. 화면이 하나씩 강조되고, 큰 스위치를 한 번 누르면 선택됩니다.") },
        { act: blinkMock, focus: "#scanBar", hold: 600,
          cap: c("開關也可以是刻意的長眨眼，自然眨眼不會誤觸。",
                 "The switch can even be a deliberate long blink — natural blinking won't trigger it.",
                 "スイッチは意図的な長いまばたきでも構いません。自然なまばたきでは反応しません。",
                 "스위치는 의도적인 긴 눈 깜빡임이어도 됩니다. 자연스러운 깜빡임에는 반응하지 않습니다.") },
        { act: async () => { scanDemoStop(); goSetting("prefs"); await visionDemo(); }, focus: () => $("#s_contrast")?.closest("label"),
          cap: c("再加上高對比與超大字，視力退化的長輩也看得清楚。",
                 "Add high contrast and extra-large type, and even low vision is no barrier.",
                 "さらに高コントラストと特大文字で、視力が落ちた方にも見やすくします。",
                 "여기에 고대비와 큰 글씨를 더해 시력이 약한 분도 잘 볼 수 있습니다.") },
      ],
    },
    {
      id: "rehab", icon: "🏥", title: c("③ AI 語音復健・復健軌跡", "③ AI speech rehab & progress tracking", "③ AI音声リハビリと推移グラフ", "③ AI 언어 재활과 재활 추이"),
      steps: [
        { act: () => { visionRestore(); goTab("rehab"); }, focus: "#rehabBank",
          cap: c("模組三，AI 語音復健。內建中、英、日、韓四種語言的四級題庫，從名詞、動作到情境句，由淺入深。",
                 "Module three: AI speech rehabilitation. A four-level exercise bank in Chinese, English, Japanese and Korean, from single nouns up to situational sentences.",
                 "モジュール3、AI音声リハビリ。中国語・英語・日本語・韓国語の4言語・4段階の問題集を内蔵し、名詞から場面の文まで段階的に練習できます。",
                 "모듈 3, AI 언어 재활. 중국어·영어·일본어·한국어 4개 언어, 4단계 문제은행이 들어 있어 명사부터 상황 문장까지 단계적으로 연습합니다.") },
        { act: showBanks, focus: "#demoBanks", hold: 800,
          cap: c("切換語言，題目和語音辨識也跟著換，沒有網路也能練。",
                 "Switch the language and both the items and speech recognition follow — and it all works offline.",
                 "言語を切り替えると、問題も音声認識も切り替わります。オフラインでも練習できます。",
                 "언어를 바꾸면 문항과 음성 인식도 함께 바뀌고, 인터넷 없이도 연습할 수 있습니다.") },
        { act: () => rehabDemo(S.rehab), focus: "#rehabTargetDisplay",
          cap: c("患者先聽示範，再跟著唸一次。", "The patient listens to the model sentence, then repeats it.",
                 "お手本を聞いてから、まねして言います。", "환자는 시범 문장을 듣고 따라 말합니다.") },
        { act: () => rehabScore(S), focus: "#rehabScore", hold: 1200,
          cap: c("AI 即時回饋語意、流暢度與語調三項分數，標出說錯的字，並記下開口前停頓了幾秒。",
                 "AI feedback arrives instantly: scores for meaning, fluency and intonation, the mispronounced word highlighted, and how long he paused before speaking.",
                 "AIがすぐにフィードバック。意味・流暢さ・抑揚の3項目を採点し、言い間違えた語を示し、話し始めるまでの時間も記録します。",
                 "AI가 바로 피드백합니다. 의미·유창성·억양 세 항목 점수와 잘못 말한 단어, 말하기 전 멈춘 시간까지 기록합니다.") },
        { focus: '#rehabPractice [data-i18n="rehab.privacyNote"]',
          cap: c("跟讀的錄音評分完立即刪除，只留下文字與分數。",
                 "The recording is discarded right after scoring; only text and scores are kept.",
                 "音声は採点後すぐに破棄され、残るのは文字と点数だけです。",
                 "녹음은 채점 직후 바로 삭제되고, 글자와 점수만 남습니다.") },
        { act: reportDemo, focus: "#trajReaction", hold: 800,
          cap: c("每一次的反應時間與命中率，會自動轉成復健軌跡趨勢圖。",
                 "Every response time and hit rate is turned automatically into a rehabilitation trajectory chart.",
                 "毎回の反応時間と正答率は、自動でリハビリ推移グラフになります。",
                 "매번의 반응 시간과 적중률은 자동으로 재활 추이 그래프가 됩니다.") },
        { act: async () => { spotSel("#trajHit"); await sleep(1600); spotSel("#reportCsv"); }, focus: "#trajHit",
          cap: c("語言治療師看得出進步的趨勢，也能匯出 CSV、PDF，或推送給家人。",
                 "Speech therapists can follow the trend, export it as CSV or PDF, or send it to the family.",
                 "言語聴覚士は改善の傾向を確認でき、CSVやPDFへの書き出し、家族への送信もできます。",
                 "언어치료사는 변화 추세를 확인하고 CSV·PDF로 내보내거나 가족에게 보낼 수 있습니다.") },
      ],
    },
    {
      id: "crisis", icon: "🆘", title: c("④ 語意防護・危機介入", "④ Semantic safeguard & crisis intervention", "④ 意味ガードと危機介入", "④ 의미 보호와 위기 개입"),
      steps: [
        { act: async () => { goTab("compose"); hideResult(); await typeInto("#fragments", S.crisis); }, focus: "#fragments",
          cap: c("模組四，語意防護。每一句話在說出口之前，都會先檢查語意。",
                 "Module four: the semantic safeguard. Every sentence is checked for meaning before it is spoken.",
                 "モジュール4、意味ガード。すべての文は、声にする前に意味をチェックします。",
                 "모듈 4, 의미 보호. 모든 문장은 말하기 전에 의미를 먼저 검사합니다.") },
        { act: async () => { await press("#btnCompose"); showLock(); }, focus: "#lockDlg .modal-card", hold: 600,
          cap: c("偵測到求救或自傷的語意時，不會唸出來，而是立刻啟動危機介入。",
                 "When it detects a cry for help or self-harm, it does not speak — it starts crisis intervention instead.",
                 "助けを求める言葉や自傷の意図を検知すると、読み上げずに危機介入を始めます。",
                 "도움 요청이나 자해 의도를 감지하면 읽지 않고 즉시 위기 개입을 시작합니다.") },
        { act: () => crisisMock(S), focus: "#crisisOrb", hold: 1400,
          cap: c("系統自動把 GPS 定位傳給指定的家人、開啟視訊連結，畫面換成跟著圓圈呼吸的引導。",
                 "It automatically sends the GPS location to the designated family member, opens a video link, and switches to a calming breathing guide.",
                 "指定した家族にGPSの位置を自動で送り、ビデオ通話のリンクを開き、画面は呼吸ガイドに切り替わります。",
                 "지정된 가족에게 GPS 위치를 자동으로 보내고 영상 통화 링크를 열며, 화면은 호흡 안내로 바뀝니다.") },
        { focus: () => $("#crisisHotlineEmergency")?.parentElement, hold: 1000,
          cap: c("下方可以一鍵直撥 119 和 1925 安心專線；這個畫面要家人確認後才會關閉。",
                 "Below, one tap dials emergency services or a crisis line — 119 and 1925 in Taiwan. The screen closes only after the family responds.",
                 "下のボタンで救急や相談窓口にワンタップで電話できます（台湾では119と1925）。この画面は家族が確認するまで閉じません。",
                 "아래 버튼으로 응급 번호와 위기 상담 전화에 바로 걸 수 있습니다(대만은 119와 1925). 이 화면은 가족이 확인해야 닫힙니다.") },
        { act: () => { crisisClose(); goTab("compose"); }, focus: "#quickSos",
          cap: c("平常在任何頁面右上角都有求救鈕，重組頁最上方也有一鍵發聲。演示中的通報都已攔截，不會真的送出。",
                 "The help button sits at the top of every screen, with one-tap emergency phrases on the compose page. In this demo every alert is intercepted — nothing is actually sent.",
                 "ふだんもすべての画面の右上にSOSボタンがあり、再構成ページの上部にはワンタップの緊急フレーズがあります。このデモでは通報はすべて止めてあり、実際には送信されません。",
                 "평소에도 모든 화면 오른쪽 위에 SOS 버튼이 있고, 재구성 화면 맨 위에는 한 번에 말하는 긴급 문구가 있습니다. 이 데모의 알림은 모두 차단되어 실제로 보내지지 않습니다.") },
      ],
    },
    {
      id: "voice", icon: "🗣", title: c("⑤ 擬真聲紋・情感語音", "⑤ Personal voice & emotional speech", "⑤ 本人の声と感情音声", "⑤ 실제 같은 목소리와 감정 음성"),
      steps: [
        { act: () => goSetting("voice"), focus: '[data-setkey="voice"] h3',
          cap: c("模組五，擬真聲紋。失去語言的同時，很多人也失去了自己的聲音。",
                 "Module five: a voice that sounds like you. Losing speech often means losing one's own voice, too.",
                 "モジュール5、本人そっくりの声。言葉を失うと、自分の声も失ってしまうことが多いのです。",
                 "모듈 5, 실제 같은 목소리. 말을 잃으면 자기 목소리도 함께 잃는 경우가 많습니다.") },
        { focus: "#voiceList",
          cap: c("拾語者用 GPT-SoVITS，從病發前的錄音或家人的聲音，複製出專屬聲音模型，存在使用者自己的 Google Drive。",
                 "Speak My Life uses GPT-SoVITS to clone a personal voice from recordings made before the stroke, or from a family member, and keeps it in the user's own Google Drive.",
                 "GPT-SoVITSで、発症前の録音や家族の声から専用の音声モデルを作り、ご本人のGoogleドライブに保存します。",
                 "GPT-SoVITS로 발병 전 녹음이나 가족의 목소리에서 전용 음성 모델을 만들어 사용자 본인의 Google 드라이브에 저장합니다.") },
        { act: consentMock, focus: () => $("#vcAgreeChk")?.closest("label"), hold: 800,
          cap: c("但聲紋一定要先經過本人或法定代理人同意；隨時可以撤回，撤回後立刻停用。",
                 "But a voiceprint is used only with consent from its owner or a legal guardian — and consent can be withdrawn at any time, taking effect immediately.",
                 "ただし声紋は、本人または法定代理人の同意があって初めて使えます。同意はいつでも撤回でき、撤回すればすぐに停止します。",
                 "단, 성문은 본인이나 법정대리인의 동의가 있어야만 쓸 수 있고, 언제든 철회할 수 있으며 철회하면 즉시 사용이 중지됩니다.") },
        { act: async () => { consentClose(); await emotionDemo(S); }, focus: "#demoEmotions", hold: 600,
          cap: c("說出口時，還會依句子的情緒，切換喜、怒、哀、樂的語氣。",
                 "And when it speaks, the tone follows the feeling of each sentence — happy, angry, sad or cheerful.",
                 "話すときは、文の感情に合わせて喜怒哀楽の口調を切り替えます。",
                 "말할 때는 문장의 감정에 맞춰 기쁨, 분노, 슬픔, 즐거움의 어조를 바꿉니다.") },
      ],
    },
    {
      id: "outro", icon: "🏁", title: c("收尾", "Closing", "エンディング", "마무리"),
      steps: [
        { act: () => titleCard(BRAND, c("從發聲走向語意重建 · AI 協助，由患者決定 · 介面隨能力調整",
                                          "Beyond pronunciation, to meaning · AI assists, the patient decides · Adapts to each ability",
                                          "発声から意味の再構築へ · AIが手助けし、本人が決める · 能力に合わせて変わる画面",
                                          "발성을 넘어 의미로 · AI는 돕고 결정은 환자가 · 능력에 맞춰 바뀌는 화면")),
          cap: c("拾語者：從發聲走向語意重建；AI 協助，但由患者決定；介面隨能力調整；",
                 "Speak My Life goes beyond pronunciation to rebuilding meaning. AI assists, but the patient decides. The interface adapts to each ability.",
                 "発声練習から意味の再構築へ。AIは手助けし、決めるのはご本人。画面は能力に合わせて変わります。",
                 "발성을 넘어 의미를 다시 세우고, AI는 돕되 결정은 환자가 하며, 화면은 능력에 맞춰 바뀝니다.") },
        { act: () => titleSub(c("跨裝置持續復健 · 復健歷程可追蹤 · 兼顧安全與隱私",
                                "Rehab across devices · Progress you can track · Safety and privacy built in",
                                "端末をまたいで続くリハビリ · 経過を追える · 安全とプライバシー",
                                "기기를 넘나드는 재활 · 추적 가능한 과정 · 안전과 개인정보 보호")),
          cap: c("跨裝置持續復健；復健歷程可追蹤；兼顧安全與隱私——聲紋需經同意、錄音評分後刪除、危機訊息只傳給指定家人。",
                 "Rehab continues across devices. Progress is tracked over time. And safety and privacy come first: voiceprints need consent, recordings are deleted after scoring, and crisis alerts go only to chosen family.",
                 "端末をまたいでリハビリを継続し、経過を記録し、安全とプライバシーを守ります。声紋は同意制、録音は採点後に削除、危機の通知は指定した家族だけに届きます。",
                 "기기를 넘나들며 재활을 이어 가고, 과정을 기록하며, 안전과 개인정보를 지킵니다. 성문은 동의가 필요하고, 녹음은 채점 후 삭제되며, 위기 알림은 지정한 가족에게만 갑니다.") },
        { act: () => titleSub(c("讓失語症患者即使無法說話，也能被世界聽見",
                                "Even without speech, heard by the world",
                                "話せなくても、世界に声が届くように",
                                "말할 수 없어도 세상에 들리도록")),
          hold: 1200,
          cap: c("讓失語症患者即使無法說話，也能被世界聽見。拾語者 Speak My Life。",
                 "So that people with aphasia, even when they cannot speak, can still be heard by the world. Speak My Life.",
                 "失語症の方が、たとえ話せなくても、世界に声を届けられるように。拾語者 Speak My Life。",
                 "실어증 환자가 말할 수 없어도 세상에 들릴 수 있도록. Speak My Life.") },
        { act: hideTitle, cap: "" },
      ],
    },
  ];
}

// ── 覆蓋層（字幕、標題卡、聚光燈、進度）─────────────────────────────────

function ui() { return $("#demoOverlay"); }

function buildOverlay() {
  if (ui()) return;
  const el = document.createElement("div");
  el.id = "demoOverlay";
  el.className = "demo-overlay hidden";
  el.innerHTML = `
    <div id="demoTitleCard" class="demo-titlecard hidden">
      <div id="demoTitleMain"></div>
      <div id="demoTitleSub"></div>
    </div>
    <div class="demo-hud" id="demoHud">
      <span id="demoProgress" class="demo-progress"></span>
      <button id="demoStop" class="demo-stop" type="button"></button>
    </div>
    <div id="demoPrep" class="demo-prep hidden">
      <div class="demo-prep-title" id="demoPrepTitle"></div>
      <div class="demo-prep-bar"><i id="demoPrepFill"></i></div>
      <div id="demoPrepNote" class="demo-prep-note"></div>
    </div>
    <div id="demoCaption" class="demo-caption hidden"></div>`;
  document.body.appendChild(el);
  $("#demoStop").addEventListener("click", () => { _abort = true; });
  // 錄影時畫面上沒有 Stop 鈕 → Esc 當中止出口（看不見，但隨時按得到）
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && window.__VW_DEMO__) _abort = true;
  });
}

function caption(text) {
  const c = $("#demoCaption");
  if (!c) return;
  // 純演示模式不出字幕，但進度仍留著，否則畫面看起來像卡住。
  if (!_narrate || !text) { c.classList.add("hidden"); c.textContent = ""; return; }
  c.textContent = text;
  c.classList.remove("hidden");
}

function progress(txt) { const p = $("#demoProgress"); if (p) p.textContent = txt; }

function titleCard(main, sub) {
  $("#demoTitleMain").textContent = main;
  $("#demoTitleSub").textContent = sub || "";
  $("#demoTitleCard").classList.remove("hidden");
}
function titleSub(sub) { $("#demoTitleSub").textContent = sub; }
function hideTitle() { $("#demoTitleCard")?.classList.add("hidden"); }

let _spotted = null;
function spot(el) {
  if (_spotted) _spotted.classList.remove("demo-spot");
  _spotted = el || null;
  if (el) {
    el.classList.add("demo-spot");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
function spotSel(sel) { spot($(sel)); }
function clearSpot() { spot(null); }

// 按鈕「被按下去」的視覺回饋。**不觸發真的 click**——演示不做任何有副作用的事。
async function press(sel) {
  const el = $(sel);
  if (!el) return;
  spot(el);
  el.classList.add("demo-press");
  await sleep(260);
  el.classList.remove("demo-press");
}

// 打字機效果：一次貼上看起來像作弊，逐字打出來才看得懂使用者在做什麼。
async function typeInto(sel, text) {
  const el = $(sel);
  if (!el) return;
  spot(el);              // spot() 會 scrollIntoView，輸入框一定看得到
  await sleep(400);      // 但捲動是 smooth 的，不等它停的話前幾個字是在滑動中打的
  el.value = "";
  for (const ch of text) {
    if (_abort) return;
    el.value += ch;
    await sleep(70);
  }
}

/**
 * 錄影池：保證「這一步在講的東西」真的在畫面上。
 *
 * 每一步用 focus 宣告自己在講哪個元素，開講之前捲出來、亮一下，捲完再量一次位置；
 * 真的不在畫面上就留一筆警告，不要靜靜地錄完一支對不上的影片。
 * focus 可以是選擇器，或回傳元素的函式（勾選框本身太小，要亮的是它外面那一行 label）。
 */
async function ensureVisible(focus, cap) {
  if (!focus) return;                     // 片頭、純解說沒有特定對象
  const el = typeof focus === "function" ? focus() : $(focus);
  const name = typeof focus === "function" ? "(fn)" : focus;
  if (!el) { console.warn(`[demo] 錄影池：找不到「${name}」 — 「${(cap || "").slice(0, 48)}」`); return; }
  spot(el);                               // spot() 會 scrollIntoView({block:"center"})
  await sleep(FOCUS_SETTLE);              // 等 smooth 捲動停下來再量，否則會誤報
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
  if (!visible) {
    console.warn(`[demo] 錄影池：「${name}」不在畫面上 — 「${(cap || "").slice(0, 48)}」`,
                 { top: Math.round(r.top), bottom: Math.round(r.bottom), viewportH: vh });
  }
}

// 捲動動畫跑完要一點時間。不等就開始講，觀眾看到的是「畫面還在滑」而旁白已經在講那個東西了。
const FOCUS_SETTLE = 650;

function goTab(name) {
  clearSpot();
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  btn?.click();          // 分頁切換沒有副作用，用真的按
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 設定分頁的子頁：用卡片上的 data-setkey 找（buildSettingsIndex 會把它帶到索引列上）。
// 不拿標題文字比關鍵字：介面一換成英文/日文/韓文就一個都對不上，而且會靜靜地開錯卡。
function goSetting(key) {
  goTab("settings");
  const hit = $$("#settingsIndex .setrow").find((r) => r.dataset.setkey === key);
  if (!hit) { console.warn("[demo] 找不到設定卡", key); return; }
  hit.click();
}

// 借用畫面上既有的容器時，把原本的子節點整批搬走、結束時搬回來。
// 不用 innerHTML 存字串再還原：那樣還原回來的按鈕身上已經沒有事件監聽，
// 演示結束後使用者點下去會沒有反應。
const _stashed = new Map();
function stash(el) {
  if (!el || _stashed.has(el)) return;
  const frag = document.createDocumentFragment();
  while (el.firstChild) frag.appendChild(el.firstChild);
  _stashed.set(el, frag);
}
function unstashAll() {
  for (const [el, frag] of _stashed) { el.textContent = ""; el.appendChild(frag); }
  _stashed.clear();
}

// ── ① 語意織句 ──────────────────────────────────────────────────────────

function setCtx(text) {
  const el = $("#ctx");
  if (!el) return;
  stash(el);
  el.textContent = text;
}

// 按下重組之後真的要轉。候選句本身是固定樣本（在評審面前被 LLM 逾時毀掉是不能接受的），
// 但**等待不能假**：用的是真的那顆按鈕的 disabled ＋「重組中…」文字，轉的是真實長度。
// 直接跳出結果會讓觀眾以為這個 App 是即時的。
const RECONSTRUCT_WAIT = 3500;

async function reconstructWait() {
  const btn = $("#btnCompose");
  if (!btn) { await sleep(RECONSTRUCT_WAIT); return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t("btn.composing");
  try { await sleep(RECONSTRUCT_WAIT); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// 與 renderAltList() 同一份 markup（.alt-opt、◉／○、aria-pressed），畫面才會和真的一模一樣
function altHtml(cands, on) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  return cands.map((s, i) => `<button class="btn ghost block alt-opt${i === on ? " on" : ""}" type="button" aria-pressed="${i === on}">${i === on ? "◉" : "○"}　${esc(s)}</button>`).join("");
}

function showCandidates(cands) {
  const res = $("#result"), txt = $("#resultText"), pick = $("#altPick"), list = $("#altList");
  if (!res) return;
  stash(txt); stash(list);
  res.classList.remove("hidden");
  if (txt) txt.textContent = cands[0];
  if (list) list.innerHTML = altHtml(cands, 0);
  pick?.classList.remove("hidden");
  spot(res);
}

/** 在三個候選之間切換給人看，最後回到第一個。 */
async function pickCandidateDemo(cands) {
  const list = $("#altList"), txt = $("#resultText");
  for (const i of [1, 2, 0]) {
    if (_abort) return;
    if (list) list.innerHTML = altHtml(cands, i);
    if (txt) txt.textContent = cands[i];
    spot(list?.children[i] || null);
    await sleep(1300);
  }
}

function hideResult() {
  $("#result")?.classList.add("hidden");
  $("#confirmDlg")?.classList.add("hidden");
}

// 確認卡平常住在結果卡裡，但從圖卡頁組句時 app.js 會把它搬到 #aacResult。
// 演示把它搬回結果卡，結束時再放回原處（搬節點不會掉事件監聽）。
function showConfirm(text) {
  const dlg = $("#confirmDlg"), host = $("#result");
  if (!dlg || !host) return;
  if (dlg.parentElement !== host) host.appendChild(dlg);
  stash($("#confirmEmoji")); stash($("#confirmText"));
  $("#confirmEmoji").textContent = "🤕💊";
  $("#confirmText").textContent = text;
  $("#confirmWarn")?.classList.remove("hidden");
  $("#confirmReject")?.classList.add("hidden");
  dlg.classList.remove("hidden");
}
async function confirmYes(text) {
  await press("#confirmYes");
  // **一定要 await。** 不等的話這一句只是被排進發言權佇列，等它真的播出來時
  // 畫面早就換到下一段了——看起來就是「字幕跟講的話對不上」。
  await speakDemoSentence(text);
  $("#confirmDlg")?.classList.add("hidden");
  $("#confirmWarn")?.classList.add("hidden");
}

// ── ② 無障礙 ────────────────────────────────────────────────────────────

// 三段模式只換外觀，不呼叫 applySeverity()——那一支會 save()，選到重度還會要全螢幕。
async function sevModeDemo() {
  const rows = $$("#sevModes .sevmode");
  for (const m of ["mild", "moderate", "severe"]) {
    if (_abort) return;
    rows.forEach((r) => r.classList.toggle("on", r.dataset.m === m));
    await sleep(900);
  }
}
function restoreSevRows() {
  const cur = state.settings.severityMode || "mild";
  $$("#sevModes .sevmode").forEach((r) => r.classList.toggle("on", r.dataset.m === cur));
}

// 中度＝body.sev-moderate（隱藏複雜項目）＋圖卡特大（#aacItems 的 aac-s3，兩欄）
function moderateDemo() {
  goTab("aac");
  document.body.classList.add("sev-moderate");
  const grid = $("#aacItems");
  if (grid) grid.className = "cards-grid aac-s3";
  $$(".aac-scale-chip").forEach((x) => x.classList.toggle("on", +x.dataset.s === 3));
}
function restoreSeverity() {
  const mode = state.settings.severityMode || "mild";
  document.body.classList.toggle("sev-moderate", mode === "moderate");
  document.body.classList.toggle("sev-severe", mode === "severe");
  const grid = $("#aacItems"); if (grid && _restore.aacGridCls) grid.className = _restore.aacGridCls;
  $$(".aac-scale-chip").forEach((x) => x.classList.toggle("on", +x.dataset.s === (+state.settings.aacScale || 1)));
  restoreSevRows();
}

// 重度模式：不呼叫 enterKiosk()（它會要全螢幕與 wake lock，錄影時切全螢幕會讓畫面跳掉）。
// 直接顯示同一塊板子，markup 與 renderScanCard() 相同（.kcard/.kemoji/.kword＋scanpulse）。
function kioskMock([emoji, word]) {
  const k = $("#kiosk");
  if (!k) return;
  k.classList.remove("hidden");
  document.body.classList.add("kiosk-on");
  scanCard(emoji, word);
  const trail = $("#kioskTrail");
  if (trail) trail.innerHTML = "";
}
function scanCard(emoji, word) {
  const box = $("#kioskCards");
  if (!box) return;
  box.dataset.n = 1;
  box.innerHTML = `<div class="kcard kscan scanpulse"><span class="kemoji">${emoji}</span><span class="kword">${word}</span></div>`;
}
async function kioskTrail(cards) {
  const trail = $("#kioskTrail");
  const seen = [];
  for (const [emo, word] of cards) {
    if (_abort) return;
    scanCard(emo, word);
    seen.push(`<div class="ktrail-item">${emo} ${word}</div>`);
    if (trail) trail.innerHTML =
      `<button class="ktrail-ctl" type="button">▶</button><button class="ktrail-ctl" type="button">✕</button>` + seen.join("");
    await sleep(1000);
  }
}
function kioskClose() {
  $("#kioskPin")?.classList.add("hidden");
  $("#kiosk")?.classList.add("hidden");
  document.body.classList.remove("kiosk-on");
  const trail = $("#kioskTrail"); if (trail) trail.innerHTML = "";
  const cards = $("#kioskCards"); if (cards) cards.innerHTML = "";
}

// 鼻控：不開相機（演示不碰任何裝置權限），畫一個與 #headCursor 同樣的游標，
// 從卡片左上滑到「重新置中」鈕上停住，進度環走滿一圈＝停留點選觸發（只做按下的樣子）。
let _nose = null;
function noseEl() {
  if (_nose) return _nose;
  _nose = document.createElement("div");
  _nose.id = "demoNose";
  _nose.style.cssText = "position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;pointer-events:none;z-index:9999;";
  _nose.innerHTML = `<svg viewBox="0 0 36 36" style="width:100%;height:100%;transform:rotate(-90deg)">
      <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3"/>
      <circle class="r" cx="18" cy="18" r="16" fill="none" stroke="var(--accent, #0a84ff)" stroke-width="3" stroke-dasharray="100.5" stroke-dashoffset="100.5"/></svg>
    <i style="position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--accent, #0a84ff);box-shadow:0 0 0 2px #fff"></i>`;
  document.body.appendChild(_nose);
  return _nose;
}
function noseRemove() { _nose?.remove(); _nose = null; }

async function noseDemo() {
  await sleep(FOCUS_SETTLE + 200);
  const target = $("#s_headRecenter"), from = $("#s_head")?.closest("label");
  if (!target || !from) return;
  const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
  const x0 = a.left + 20, y0 = a.top + 10, x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
  const el = noseEl(), ring = el.querySelector(".r");
  const N = 30;
  for (let i = 0; i <= N && !_abort; i++) {
    const k = i / N, e = k * k * (3 - 2 * k);           // smoothstep：頭的移動不會是等速直線
    const jitter = Math.sin(i * 1.7) * 3 * (1 - k);       // 頭控本來就會微微晃，完全筆直反而假
    el.style.transform = `translate(${x0 + (x1 - x0) * e + jitter}px, ${y0 + (y1 - y0) * e}px)`;
    await sleep(40);
  }
  target.classList.add("head-hover");
  for (let p = 0; p <= 20 && !_abort; p++) {
    ring?.setAttribute("stroke-dashoffset", String(100.5 * (1 - p / 20)));
    await sleep(50);
  }
  target.classList.remove("head-hover");
  target.classList.add("demo-press");
  await sleep(240);
  target.classList.remove("demo-press");
  await sleep(500);
  noseRemove();
}

// 掃描模式：用真的那一套（a11yscan.js 的 startScan），畫面上的高亮就是實際行為。
// 不勾設定裡的勾選框——那會 save()。結束時照使用者原本的狀態還原。
function scanDemoStart() { if (!document.body.classList.contains("scan-on")) startScan(); }
function scanDemoStop() { if (!_restore.scanOn) stopScan(); }
// 眨眼：不開相機，只把浮動列換成「眨眼中」的樣子（👁＋長眨眼的提示）。
function blinkMock() {
  $("#scanEye")?.classList.remove("hidden");
  const hint = $("#scanHint"); if (hint) hint.textContent = t("scan.hintBlink");
}

// 高對比＋超大字：直接改 <html> 的屬性與 --font，不動 state（不會 save）。
async function visionDemo() {
  await sleep(600);
  document.documentElement.setAttribute("data-contrast", "high");
  const root = document.documentElement;
  for (const v of [1.3, 1.6]) {
    if (_abort) break;
    root.style.setProperty("--font", v + "rem");
    await sleep(900);
  }
}
function visionRestore() {
  const el = document.documentElement;
  if (state.settings.highContrast) el.setAttribute("data-contrast", "high");
  else el.removeAttribute("data-contrast");
  el.style.setProperty("--font", (state.settings.font || 1) + "rem");
}

// ── ③ 復健 ──────────────────────────────────────────────────────────────

// 四語四級：在題庫下面另開一塊，依序列出四種語言各級的第一題（bankFor 是真的題庫）。
// 原本的題庫先藏起來、不改它——它身上綁著點一下開始練的事件。
function showBanks() {
  const bank = $("#rehabBank");
  if (!bank) return;
  $("#demoBanks")?.remove();
  const box = document.createElement("div");
  box.id = "demoBanks";
  const flag = { zh: "🇹🇼 中文", en: "🇺🇸 English", ja: "🇯🇵 日本語", ko: "🇰🇷 한국어" };
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
  box.innerHTML = Object.keys(LANG_TAG).map((L) => {
    const groups = bankFor(LANG_TAG[L]);
    return `<div style="margin-top:8px"><div class="tiny muted">${flag[L]}</div>
      <div class="chips" style="margin-top:4px">${groups.map((g) =>
        `<span class="chip" title="${esc(t(g.levelKey))}">${esc(t(g.levelKey))} · ${esc(g.items[0] || "")}</span>`).join("")}</div></div>`;
  }).join("");
  bank.style.display = "none";
  bank.after(box);
}
function hideBanks() {
  $("#demoBanks")?.remove();
  const bank = $("#rehabBank"); if (bank) bank.style.display = "";
}

// 與 rehab.js 的 makeChips 同一套切法：拉丁詞一張、中日韓每兩個字一張
function makeChips(sentence) {
  return sentence.replace(/[，。！？、,.!?；;：:\s]+/g, "|").split("|").filter(Boolean)
    .flatMap((p) => {
      if (/[A-Za-z0-9]/.test(p)) return [p];
      const out = []; for (let i = 0; i < p.length; i += 2) out.push(p.slice(i, i + 2)); return out;
    });
}

async function rehabDemo(sentence) {
  hideBanks();
  const card = $("#rehabPractice");
  if (!card) return;
  card.classList.remove("hidden");
  const disp = $("#rehabTargetDisplay"), chips = $("#rehabChips"), score = $("#rehabScore");
  stash(disp); stash(chips); stash(score);
  if (disp) disp.textContent = sentence;
  if (chips) chips.innerHTML = makeChips(sentence).map((w) => `<span class="chip" data-c="${w}">${w}</span>`).join("");
  await speakDemoSentence(sentence);   // 等講完才前進
}

// 與 rehab.js doScore() 同一份 markup（scorebox＋subscores 三條細項）
function rehabScore(S) {
  const box = $("#rehabScore");
  if (!box) return;
  $$("#rehabChips .chip").forEach((chip) =>
    chip.classList.toggle("wrong", S.wrong.some((w) => (chip.dataset.c || "").includes(w))));
  const bar = (k, v) => `<div class="subscore"><span class="tiny">${t(k)}</span>
      <span class="subbar"><i class="${v >= 80 ? "good" : v >= 50 ? "mid" : "low"}" style="width:${v}%"></i></span><b class="tiny">${v}</b></div>`;
  box.innerHTML = `<div class="scorebox good">
    <div class="score-num">84</div>
    <div class="score-info">
      <div class="score-head">🎉 ${t("rehab.great")}</div>
      <div class="score-fb">💬 ${S.rehabFb}</div>
      <div class="tiny" style="color:var(--danger)">${t("rehab.focus")}${S.wrong.join("、")}</div>
      <div class="tiny muted">${t("rehab.recognizedLabel")}${S.heard}</div>
      <div class="tiny muted">${t("rehab.latency").replace("{s}", "1.8")}</div>
    </div></div>
    <div class="subscores">${bar("rehab.subSemantic", 92)}${bar("rehab.subFluency", 81)}${bar("rehab.subProsody", 76)}</div>`;
}

// 復健軌跡：兩週的示範資料（反應時間變短、命中率變高，中間有沒練習的斷點）。
// 只畫在畫面上，不寫進任何紀錄；結束時 loadReport() 重畫回使用者真實的資料。
function sampleTrajectory() {
  const labels = [], reaction = [], rehabLatency = [], pickHit = [], rehabHit = [];
  const d = new Date(); d.setDate(d.getDate() - 13);
  for (let i = 0; i < 14; i++, d.setDate(d.getDate() + 1)) {
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    const gap = i === 4 || i === 9;                       // 沒練習的日子是斷點，不是 0
    const k = i / 13;
    reaction.push(gap ? null : +(6.4 - 3.6 * k + Math.sin(i) * 0.35).toFixed(2));
    rehabLatency.push(gap ? null : +(4.8 - 2.9 * k + Math.cos(i) * 0.3).toFixed(2));
    pickHit.push(gap ? null : Math.round(42 + 44 * k + Math.sin(i * 1.3) * 5));
    rehabHit.push(gap ? null : Math.round(30 + 48 * k + Math.cos(i * 1.1) * 6));
  }
  return { buckets: labels, labels, reaction, rehabLatency, pickHit, rehabHit };
}
let _reportDrawn = false;
async function reportDemo() {
  goTab("report");
  // 切到報表時 app.js 會自己跑一次 loadReport()。先等它畫完，否則示範圖會被真資料蓋掉。
  try { await loadReport(); } catch {}
  _reportDrawn = true;
  const tr = sampleTrajectory();
  drawTrajectory($("#trajReaction"), tr, "reaction");
  drawTrajectory($("#trajHit"), tr, "hit");
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#statSessions", "26"); set("#statAvg", "78"); set("#statStreak", "🔥6"); set("#statPositive", "41");
  set("#bmReaction", "2.9s"); set("#bmPick", "81%"); set("#bmEdit", "7"); set("#bmCard", "38%");
  set("#trajRange", t("traj.byDay"));
}

// ── ④ 危機 ──────────────────────────────────────────────────────────────

// 語音鎖定畫面：照真的 showLock() 的樣子填，不呼叫它（它會接著真的開危機視窗）。
function showLock() {
  const dlg = $("#lockDlg");
  if (!dlg) return;
  stash($("#lockBody"));
  $("#lockBody").textContent = t("safety.lockedCrisis");
  $("#lockBody").style.whiteSpace = "pre-line";
  dlg.classList.remove("hidden");
}
function hideLock() { $("#lockDlg")?.classList.add("hidden"); }

// 危機介入：**照著真畫面重演，絕不呼叫 openCrisis()**——那一支會立刻發 Telegram
// 給家人並開鏡頭拍照。演示只把同一個 DOM 填成通報成功的樣子。
let _breath = 0;
function crisisMock(S) {
  hideLock();
  const dlg = $("#crisisDlg");
  if (!dlg) return;
  dlg.classList.remove("hidden");
  const st = $("#crisisStatus"); if (st) st.textContent = S.sim;
  const log = $("#crisisLog");
  if (log) log.innerHTML = S.crisisLog.map((m, i) =>
    `<div class="crisis-msg${i === S.crisisLog.length - 1 ? " family" : ""}">${m}</div>`).join("");
  const quick = $("#crisisQuick");
  if (quick) quick.innerHTML = S.crisisQuick.map((s) => `<span class="chip">${s}</span>`).join("");
  $("#crisisChipVideo")?.classList.remove("hidden");
  $("#crisisChipPhoto")?.classList.remove("hidden");
  // 呼吸引導：吸 4 秒、吐 4 秒，與 crisis.js 的 startBreathing() 同一個節奏
  const orb = $("#crisisOrb"), lbl = $("#crisisBreath");
  let inhale = true;
  const tick = () => {
    if (orb) orb.style.transform = inhale ? "scale(1)" : "scale(0.72)";
    if (lbl) lbl.textContent = t(inhale ? "crisis.inhale" : "crisis.exhale");
    inhale = !inhale;
  };
  clearInterval(_breath); tick();
  _breath = setInterval(tick, 4000 / speed());
}
function crisisClose() {
  clearInterval(_breath); _breath = 0;
  hideLock();
  $("#crisisDlg")?.classList.add("hidden");
  const st = $("#crisisStatus"); if (st) st.textContent = "";
  const log = $("#crisisLog"); if (log) log.innerHTML = "";
  const quick = $("#crisisQuick"); if (quick) quick.innerHTML = "";
  const lbl = $("#crisisBreath"); if (lbl) lbl.textContent = "";
  const orb = $("#crisisOrb"); if (orb) orb.style.transform = "";
  $("#crisisChipVideo")?.classList.add("hidden");
  $("#crisisChipPhoto")?.classList.add("hidden");
}

// ── ⑤ 聲紋 ──────────────────────────────────────────────────────────────

// 同意書：打開真的那一張、勾起「我是本人或已取得同意」，但**不按同意**——
// 按下去會把同意紀錄寫進使用者設定。
function consentMock() {
  const dlg = $("#voiceConsentDlg");
  if (!dlg) return;
  dlg.classList.remove("hidden");
  setTimeout(() => {
    const chk = $("#vcAgreeChk"), btn = $("#vcAgree");
    if (chk) chk.checked = true;
    if (btn) btn.disabled = false;
  }, 1400 / speed());
}
function consentClose() {
  $("#voiceConsentDlg")?.classList.add("hidden");
  const chk = $("#vcAgreeChk"), btn = $("#vcAgree");
  if (chk) chk.checked = false;
  if (btn) btn.disabled = true;
}

// 喜怒哀樂四種語氣：在聲音卡裡掛一排標籤，唸的時候亮「樂」那一個。
async function emotionDemo(S) {
  $("#demoEmotions")?.remove();
  const list = $("#voiceList");
  if (!list) return;
  const box = document.createElement("div");
  box.id = "demoEmotions";
  box.className = "chips";
  box.style.marginTop = "8px";
  box.innerHTML = S.emotions.map((e) => `<span class="chip">${e}</span>`).join("");
  list.after(box);
  await sleep(700);
  const chips = [...box.children];
  for (const i of [0, 2, 3]) {
    if (_abort) return;
    chips.forEach((c, j) => c.classList.toggle("on", j === i));
    await sleep(500);
  }
  await speakInOwnVoice(S.own);
}

// ── 「App 講話」的聲音 ─────────────────────────────────────────────────

// 專屬聲音「合成」的停頓。音檔是預錄好的，所以其實不必等，但真的按下去是要等電腦跑
// 10～30 秒的——瞬間出聲會讓觀眾以為這個 App 是即時的。停的長度是縮短的，但「要等」不是演的。
const VOICE_SYNTH_DELAY = 1600;

/**
 * 演示裡「App 把句子唸出來」那一下：亮出合成指示 → 停一下 → 播預錄好的那一段。
 * **用的角色和旁白不同**（見 pickNarrationVoice），觀眾才分得出哪一句是解說、哪一句是 App 在講話。
 * 預錄不到才退回瀏覽器語音（那條聲音錄影收不到，但現場至少聽得到）。
 */
function speakDemoSentence(text) {
  return withAudioFloor(async () => {
    const tag = showSynthesizing();
    try { await sleep(VOICE_SYNTH_DELAY); } finally { tag?.remove(); }
    const clip = _speakClips.get(text);
    // 不加速：這一句是「App 正在講話」，加速會讓它聽起來像趕時間，也和真的按下去聽到的不一樣
    if (clip) await playClip(clip, 1.0);
    else await browserNarrate(text);
  });
}
const speakInOwnVoice = speakDemoSentence;

/** 在結果卡下面掛一行「合成中…」，回傳那個節點讓呼叫端收掉。 */
function showSynthesizing() {
  const host = $("#result");
  if (!host || host.classList.contains("hidden")) return null;
  const el = document.createElement("div");
  el.className = "tiny muted";
  el.style.marginTop = "6px";
  el.textContent = t("btn.synthesizing");
  host.appendChild(el);
  return el;
}

// ── 旁白 ────────────────────────────────────────────────────────────────

// 中文旁白優先用這個角色：整支影片同一個聲音，換台電腦、換個曲庫順序都一樣。
// 其他語言沒有指定角色時取該語言的第一個。
const NARRATION_VOICE_NAME = "花火";

async function pickNarrationVoice() {
  _voice = null;
  _speakVoice = null;
  try {
    if (!(await detectLocalTts(2000))) return;
    const want = LOCAL_LANG[_lang];
    const vs = (await localVoices()).filter((v) => (v.lang || "").toUpperCase() === want);
    const narr = vs.find((v) => (v.name || "").includes(NARRATION_VOICE_NAME)) || vs[0];
    if (narr) _voice = { name: narr.name, lang: want };
    // 「App 講話」要用**別的**角色；只有一個角色時就只好共用（總比沒有聲音好）。
    const sp = vs.find((v) => v.name !== narr?.name) || narr;
    if (sp) _speakVoice = { name: sp.name, lang: want };
  } catch { /* 連不上就退瀏覽器語音 */ }
}

// 旁白播放速度。GPT-SoVITS 原速偏慢，聽起來像在唸稿。
// 用 <audio> 的 playbackRate ＋ preservesPitch 加速——不會變成花栗鼠音。
const NARRATION_RATE = 1.15;

// ── 預錄旁白的存放 ───────────────────────────────────────────────────────
// 存 IndexedDB，不是只放記憶體：重新整理一次就全沒了的話，每次開頁面都要重新合成一輪
// （CPU 上每句 25 秒）——那就不叫預錄了。到評審現場前在家先跑一次，現場就不用等。
const DB_NAME = "vw_demo_narration";
const STORE = "clips";
let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => resolve(null);   // 無痕模式等情況拿不到 → 退回只用記憶體
  });
}
function dbGet(key) {
  return openDb().then((db) => db && new Promise((resolve) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  }));
}
function dbPut(key, blob) {
  return openDb().then((db) => db && new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = tx.onerror = () => resolve();
  }));
}

// 快取鍵要帶角色名：換了旁白角色就該重新合成，不然會播到上一個聲音。
function clipKey(text, voiceName) { return `${voiceName || "browser"}|${text}`; }

// 記憶體層（同一次執行內免走 IndexedDB）：句子文字 → Blob。
// 聲音走 WebAudio **直接混進錄影**：getDisplayMedia 的音訊要使用者自己記得勾「分享分頁音訊」，
// 忘了就錄成默片；用麥克風收喇叭又會把房間雜音錄進去。走 WebAudio 兩個問題都沒有。
const _clips = new Map();
const _speakClips = new Map();   // 「App 講話」那幾句，和旁白分開放（角色不同）

let _ac = null;          // AudioContext（全程共用；每次 new 會被瀏覽器限制數量）
let _mixDest = null;     // 錄影用的音訊匯流點

function audioCtx() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === "suspended") _ac.resume().catch(() => {});
  return _ac;
}
function mixDest() {
  if (!_mixDest) _mixDest = audioCtx().createMediaStreamDestination();
  return _mixDest;
}

/** 把選到的單元裡所有旁白與示範句先合成好（先問 IndexedDB，缺的才合成）。回成功句數。 */
async function prepareNarration(units, onProgress) {
  // 示範句也一定要預錄：瀏覽器自己的 TTS 繞過 WebAudio，錄影的音軌收不到，
  // 影片裡會變成「畫面在唸但沒有聲音」。
  const S = sample(_lang);
  const spoken = [S.candidates[0], S.medical, S.rehab, S.own];
  const jobs = [
    ...[...new Set(units.flatMap((u) => u.steps.map((s) => s.cap)).filter(Boolean))]
      .map((text) => ({ text, voice: _voice, store: _clips })),
    ...(_speakVoice ? spoken.map((text) => ({ text, voice: _speakVoice, store: _speakClips })) : []),
  ].filter((j) => j.voice);

  // 先把上次存下來的撈回來——這一步是「為什麼第二次不用等」的關鍵。
  for (const j of jobs) {
    if (j.store.has(j.text)) continue;
    const hit = await dbGet(clipKey(j.text, j.voice.name));
    if (hit) j.store.set(j.text, hit);
  }
  const todo = jobs.filter((j) => !j.store.has(j.text));
  let ok = jobs.length - todo.length;
  for (let i = 0; i < todo.length; i++) {
    if (_abort) break;
    onProgress(i, todo.length);
    if (await synthJob(todo[i])) ok++;
  }
  // 補漏輪：走 Tailscale／ngrok(Colab) 時最容易掉的是隧道剛拉起來的頭幾句；
  // 跑到這裡連線通常已經穩了，這一輪常常就補回來。
  const missed = todo.filter((j) => !j.store.has(j.text));
  for (let i = 0; i < missed.length && !_abort; i++) {
    onProgress(i, missed.length);
    if (await synthJob(missed[i])) ok++;
  }
  onProgress(todo.length, todo.length);
  return ok;
}

// 一句話合成幾次都不成才放棄。**不重試的代價不是「少一句」**——那一句會退回
// 瀏覽器機器音，影片播到一半突然換了個聲音，而且錄完才會發現。
const PREWARM_ATTEMPTS = 3;
const PREWARM_BACKOFF_MS = 1500;

async function synthJob(j) {
  for (let attempt = 0; attempt < PREWARM_ATTEMPTS; attempt++) {
    if (_abort) return false;
    try {
      const blob = await localSynth(j.text, { name: j.voice.name, lang: j.voice.lang, emotion: "中立" });
      if (blob) {
        j.store.set(j.text, blob);
        await dbPut(clipKey(j.text, j.voice.name), blob);   // 存起來，下次開頁面直接用
        return true;
      }
    } catch {
      // 落到下面的退避重試
    }
    // 剛掉包的下一秒通常還是掉包，立刻重打只是把三次機會一次用完。
    if (attempt < PREWARM_ATTEMPTS - 1) await sleep(PREWARM_BACKOFF_MS * (attempt + 1));
  }
  return false;
}

/**
 * 播一段預錄好的音檔：同時送喇叭與錄影軌，等真的播完才 resolve。
 * 用 <audio> 而不是 AudioBufferSource，是為了 preservesPitch——
 * BufferSource 的 playbackRate 是直接改取樣率，加速會連音高一起拉高。
 */
function playClip(blob, rate = NARRATION_RATE) {
  return new Promise((resolve) => {
    const ac = audioCtx();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
    el.playbackRate = rate;
    let src = null;
    try {
      src = ac.createMediaElementSource(el);
      src.connect(ac.destination);   // 現場聽得到
      src.connect(mixDest());        // 錄影錄得到
    } catch {
      /* 接不上 WebAudio 就直接播，至少現場聽得到（影片會沒這一句） */
    }
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      try { src?.disconnect(); } catch {}
      try { URL.revokeObjectURL(url); } catch {}
      resolve();
    };
    el.onended = el.onerror = fin;
    el.play().catch(fin);
  });
}

// 旁白一句。**一定要等講完**才走下一步，否則字幕跟畫面會愈跑愈前面。
async function narrate(text) {
  if (!_narrate || !text) return;
  const clip = _clips.get(text);
  if (clip) { await withAudioFloor(() => playClip(clip)); return; }
  await withAudioFloor(() => browserNarrate(text));   // 沒預錄成功的那幾句
}

// 一句話大約要講幾毫秒（估時與防卡死共用）。中日韓按字數、英文按字詞數。
function speechMs(text, L = _lang) {
  const s = String(text || "");
  if (L === "en") return s.split(/\s+/).filter(Boolean).length / 2.6 * 1000;
  const n = (s.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  return n / ({ zh: 4.2, ja: 6.5, ko: 5.5 }[L] || 4.5) * 1000;
}

function browserNarrate(text) {
  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANG_TAG[_lang];
      u.rate = 0.95;
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      u.onend = u.onerror = fin;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      // 保險：有些瀏覽器 onend 不會觸發。這個時限**必須遠大於**實際唸完的時間，
      // 否則會反過來把還在唸的句子切斷。抓三倍再加 5 秒，只用來防卡死。
      setTimeout(fin, (5000 + speechMs(text) * 3) / speed());
    } catch { resolve(); }
  });
}

// ── 讓螢幕不要睡著 ──────────────────────────────────────────────────────
// 演示要跑好幾分鐘，螢幕一暗，錄下來就是半段黑畫面。Screen Wake Lock 只在分頁可見時有效，
// 切走再切回來要自己重新取得，所以掛一個 visibilitychange 監聽補回來。
let _wake = null;

async function keepAwake() {
  if (!("wakeLock" in navigator)) return;          // Safari 舊版沒有，安靜略過
  try { _wake = await navigator.wakeLock.request("screen"); }
  catch { _wake = null; }                          // 電量過低等情況會被拒絕
}
function releaseAwake() {
  try { _wake?.release(); } catch {}
  _wake = null;
}
// ── 黑畫面防護 ─────────────────────────────────────────────────────────
// 分頁被切走時瀏覽器會停止繪製——錄下來就是一段全黑，而且錄完才會發現。
// 擋不住使用者切分頁，但可以：① 切回來立刻補上 Wake Lock；② 錄完直接告訴他中間黑掉過。
let _wentHidden = false;

document.addEventListener("visibilitychange", () => {
  if (!window.__VW_DEMO__) return;
  if (document.visibilityState === "hidden") {
    _wentHidden = true;
    releaseAwake();
  } else if (!_wake) {
    keepAwake();
  }
});

// ── 螢幕錄影 ────────────────────────────────────────────────────────────

function recSupported() {
  return !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
}

async function startRecording() {
  // 只錄「這一個分頁」：preferCurrentTab 讓分享視窗直接只給目前分頁，不會不小心選到整個桌面；
  // 錄到的只有頁面本身（沒有網址列、分頁列、其他視窗）。surfaceSwitching:"exclude" 拿掉錄影中
  // 「改分享別的分頁」那顆鈕；systemAudio:"exclude" 是因為旁白已經自己混進去了。
  // 舊版瀏覽器不認得這些參數會直接忽略，不會報錯。
  const wanted = {
    video: { frameRate: 30, displaySurface: "browser" },
    audio: false,              // 聲音不靠分頁音訊，改用 WebAudio 混音軌
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  };
  let screen;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia(wanted);
  } catch (e) {
    // 使用者按取消要照實往上丟；只有「參數不支援」才退回最陽春的請求。
    if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) throw e;
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  }
  const stream = new MediaStream([
    ...screen.getVideoTracks(),
    ...mixDest().stream.getAudioTracks(),
  ]);
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
  _chunks = [];
  _chunksSilent = [];
  _recStream = screen;         // 要停的是螢幕分享本身；混音軌是共用的，不能停
  _rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  _rec.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };

  // 第二份：同一條影像軌、不接旁白 → 一次錄，兩個版本（現場想自己口頭講解就用這一份）。
  // 建不起來就只出一份——為了第二份讓整次錄影失敗是本末倒置。
  _recSilent = null;
  try {
    const silentMime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((m) => MediaRecorder.isTypeSupported(m)) || "";
    _recSilent = new MediaRecorder(new MediaStream(screen.getVideoTracks()),
      silentMime ? { mimeType: silentMime, videoBitsPerSecond: 4_000_000 } : undefined);
    _recSilent.ondataavailable = (e) => { if (e.data && e.data.size) _chunksSilent.push(e.data); };
  } catch (e) {
    console.warn("[demo] 無聲版錄不起來，只輸出有旁白的那一份", e);
    _recSilent = null;
  }

  // 使用者在瀏覽器自己的分享列按「停止分享」→ 也要把檔案收好，不能就這樣丟掉。
  screen.getVideoTracks()[0].addEventListener("ended", () => { _abort = true; });
  _rec.start(1000);
  try { _recSilent?.start(1000); } catch { _recSilent = null; }
}

/** @returns {Promise<{narrated: Blob|null, silent: Blob|null}>} */
function stopRecording() {
  const stopOne = (rec, chunks) => new Promise((resolve) => {
    if (!rec) { resolve(null); return; }
    rec.onstop = () => resolve(chunks.length
      ? new Blob(chunks, { type: rec.mimeType || "video/webm" }) : null);
    try { rec.stop(); } catch { resolve(null); }
  });
  const a = _rec, b = _recSilent;
  _rec = null; _recSilent = null;
  // 兩個都停完才收掉螢幕分享——先停軌的話後面那個 recorder 會拿到半截檔案
  return Promise.all([stopOne(a, _chunks), stopOne(b, _chunksSilent)])
    .then(([narrated, silent]) => {
      try { _recStream?.getTracks().forEach((tr) => tr.stop()); } catch {}
      _recStream = null;
      return { narrated, silent };
    });
}

function download(blob, suffix = "") {
  if (!blob) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const name = `SpeakMyLife-Demo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${suffix}.webm`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── 執行 ────────────────────────────────────────────────────────────────

let _restore = {};

function snapshot() {
  const dlg = $("#confirmDlg");
  _restore = {
    tab: document.querySelector(".tab.active")?.dataset.tab || "compose",
    fragments: $("#fragments")?.value || "",
    resultHidden: $("#result")?.classList.contains("hidden") ?? true,
    altHidden: $("#altPick")?.classList.contains("hidden") ?? true,
    confirmParent: dlg?.parentElement || null,
    confirmHidden: dlg?.classList.contains("hidden") ?? true,
    confirmWarnHidden: $("#confirmWarn")?.classList.contains("hidden") ?? true,
    practiceHidden: $("#rehabPractice")?.classList.contains("hidden") ?? true,
    aacGridCls: $("#aacItems")?.className || "cards-grid",
    scanOn: document.body.classList.contains("scan-on"),
  };
}

function restore() {
  clearSpot();
  hideTitle();
  crisisClose();
  kioskClose();
  consentClose();
  noseRemove();
  hideBanks();
  $("#demoEmotions")?.remove();
  if (!_restore.scanOn && document.body.classList.contains("scan-on")) stopScan();
  else if (_restore.scanOn) $("#scanEye")?.classList.add("hidden");
  restoreSeverity();
  visionRestore();
  unstashAll();
  const lb = $("#lockBody"); if (lb) lb.style.whiteSpace = "";
  const f = $("#fragments"); if (f) f.value = _restore.fragments;
  $("#result")?.classList.toggle("hidden", _restore.resultHidden);
  $("#altPick")?.classList.toggle("hidden", _restore.altHidden);
  const dlg = $("#confirmDlg");
  if (dlg && _restore.confirmParent && dlg.parentElement !== _restore.confirmParent) _restore.confirmParent.appendChild(dlg);
  dlg?.classList.toggle("hidden", _restore.confirmHidden);
  $("#confirmWarn")?.classList.toggle("hidden", _restore.confirmWarnHidden);
  $$("#rehabChips .chip").forEach((c) => c.classList.remove("wrong"));
  $("#rehabPractice")?.classList.toggle("hidden", _restore.practiceHidden);
  // 設定頁停在某張子頁的話回到索引（不然下次點「設定」看到的是演示最後開的那張卡）
  const back = $("#btnSettingsBack");
  if (back && !back.classList.contains("hidden")) back.click();
  document.querySelector(`.tab[data-tab="${_restore.tab}"]`)?.click();
  // 報表上畫的是示範資料 → 重畫回使用者真實的資料（只讀，不寫）
  if (_reportDrawn) { _reportDrawn = false; loadReport().catch(() => {}); }
  try { speechSynthesis.cancel(); } catch {}
}

async function run(ids, opts) {
  _lang = demoLang();
  const units = UNITS(_lang).filter((u) => ids.includes(u.id));
  if (!units.length) return;

  _abort = false;
  _narrate = !!opts.narrate;
  window.__VW_DEMO__ = true;
  keepAwake();                 // 預錄那一段最久，也最容易讓人走開 → 從這裡就開始
  buildOverlay();
  $("#demoPrepTitle").textContent = t("demo.prep");
  $("#demoStop").textContent = t("demo.stop");
  snapshot();
  ui().classList.remove("hidden");

  // 旁白一定要在**開始錄影之前**全部合成完。CPU 上一句要 20~30 秒，邊演邊合成
  // 等於把幾十分鐘的空白錄進影片裡。合成完再開錄，片子才是緊湊的。
  if (_narrate) {
    await pickNarrationVoice();
    if (_voice) {
      const prep = $("#demoPrep"), fill = $("#demoPrepFill"), note = $("#demoPrepNote");
      prep.classList.remove("hidden");
      const t0 = Date.now();
      await prepareNarration(units, (i, n) => {
        fill.style.width = n ? `${Math.round(i * 100 / n)}%` : "100%";
        const per = i ? (Date.now() - t0) / i : 0;
        const left = per ? Math.round(per * (n - i) / 1000) : 0;
        note.textContent = n
          ? `${i} / ${n} ${t("demo.lines")}${left ? ` · ${t("demo.left")} ${Math.floor(left / 60)}m ${left % 60}s` : ""}`
          : t("demo.ready");
      });
      prep.classList.add("hidden");
    }
  }
  if (_abort) {
    restore(); releaseAwake();
    ui().classList.add("hidden"); window.__VW_DEMO__ = false; return;
  }

  let recording = false;
  if (opts.record) {
    try { await startRecording(); recording = true; }
    catch (e) { alert(t("demo.recFail") + (e?.message || e)); }
  }

  _wentHidden = false;
  if (recording) {
    // 錄影時把 HUD 收起來：進度膠囊與紅色 Stop 是給操作者看的，不是影片內容。中止改用 Esc。
    $("#demoHud")?.classList.add("hidden");
    // 游標藏起來，並給一秒鐘把滑鼠移開畫面——停在某個按鈕上整支影片都跟著那顆按鈕發亮。
    document.body.classList.add("demo-nocursor");
    $("#demoPrep")?.classList.remove("hidden");
    $("#demoPrepTitle").textContent = t("demo.getReady");
    const tip = $("#demoPrepNote"); if (tip) tip.textContent = "1";
    await sleep(1000);
    $("#demoPrep")?.classList.add("hidden");
  }

  const total = units.reduce((n, u) => n + u.steps.length, 0);
  let done = 0;
  try {
    for (const u of units) {
      if (_abort) break;
      for (const s of u.steps) {
        if (_abort) break;
        done++;
        progress(`${u.icon} ${u.title} · ${done}/${total}`);
        caption(s.cap);
        const t0 = Date.now();
        // 動作與旁白同時跑：先讓畫面動起來，旁白在講的同時觀眾已經看到變化。
        const acting = Promise.resolve().then(() => s.act?.())
          .catch((e) => console.warn("[demo] 動作失敗", u.id, e));
        // 錄影池：旁白開始講之前，先把這一步要講的地方露出來並確認它真的看得見。
        // **一定要在 acting 之後**：切分頁是寫在 act 裡的，先檢查的話量到的是上一個分頁。
        // goTab／goSetting 是同步的，所以 acting 這個 microtask 一排下去分頁就換好了。
        await ensureVisible(s.focus, s.cap);
        await Promise.all([acting, narrate(s.cap)]);
        if (_narrate && s.cap) await sleep(TAIL_PAD);   // 講完再讓畫面多停一下
        await sleep(s.hold ?? 0);
        // 補到最短停留。旁白比下限長時這裡是 0，不會拖慢。
        const floor = _narrate ? MIN_STEP_NARRATED : MIN_STEP_SILENT;
        const left = floor / speed() - (Date.now() - t0);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
      }
      clearSpot();
    }
  } finally {
    restore();
    releaseAwake();
    document.body.classList.remove("demo-nocursor");
    $("#demoHud")?.classList.remove("hidden");
    ui().classList.add("hidden");
    window.__VW_DEMO__ = false;
    if (recording) {
      const out = await stopRecording();
      // 一次錄影兩份：有旁白的、以及同一段畫面但沒有聲音的。只出得來一份時就只下載那一份。
      download(out.narrated, out.silent ? "-narrated" : "");
      download(out.silent, "-silent");
      if (_wentHidden) alert(t("demo.wentHidden"));
    }
  }
}

// ── 設定頁裡的面板 ──────────────────────────────────────────────────────

const PICK_KEY = "vw_demo_units";

function loadPicked() {
  const ids = UNITS().map((u) => u.id);
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) || "null");
    // 舊版的單元代號（compose、kiosk…）已經不存在：有任何一個對不上就當作沒存過、預設全選，
    // 不然使用者會只剩下碰巧同名的一兩段，還以為演示被刪短了。
    if (Array.isArray(v) && v.length && v.every((id) => ids.includes(id))) return v;
  } catch {}
  return ids;          // 預設全選
}
function savePicked(ids) {
  try { localStorage.setItem(PICK_KEY, JSON.stringify(ids)); } catch {}
}

export function setupDemo() {
  const box = $("#demoUnits");
  if (!box) return;

  const boxes = () => $$("#demoUnits input[type=checkbox]");
  const chosen = () => boxes().filter((b) => b.checked).map((b) => b.dataset.id);

  // 估時直接從步數與旁白長度算，不用手寫秒數——手寫值與實際節奏一定會漂移，
  // 而使用者是靠這個數字決定要選哪幾段的。
  const stepMs = (st, narrated) => {
    const base = narrated
      ? Math.max(MIN_STEP_NARRATED, speechMs(st.cap, demoLang()) / NARRATION_RATE) + (st.cap ? TAIL_PAD : 0)
      : MIN_STEP_SILENT;
    return base + (st.hold ?? 0) + (st.focus ? FOCUS_SETTLE : 0);
  };
  const unitMs = (u, narrated) => u.steps.reduce((n, st) => n + stepMs(st, narrated), 0);
  const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; };

  // 單元名稱跟著介面語言 → 切語言時整排重畫（保留勾選狀態）
  const render = () => {
    const picked = new Set(box.children.length ? chosen() : loadPicked());
    const narrated = !!$("#demoNarrate")?.checked;
    box.innerHTML = UNITS().map((u) => `
      <label class="demo-unit">
        <input type="checkbox" data-id="${u.id}"${picked.has(u.id) ? " checked" : ""} />
        <span class="demo-unit-ico">${u.icon}</span>
        <span class="demo-unit-txt">
          <span class="demo-unit-title">${u.title}</span>
          <span class="demo-unit-note">~${fmt(unitMs(u, narrated))}</span>
        </span>
      </label>`).join("");
    est();
  };
  const est = () => {
    const ids = new Set(chosen());
    const narrated = !!$("#demoNarrate")?.checked;
    const ms = UNITS().filter((u) => ids.has(u.id)).reduce((n, u) => n + unitMs(u, narrated), 0);
    $("#demoEst").textContent = `${ids.size} ${t("demo.unitsN")} · ${t("demo.about")} ${fmt(ms)}`;
  };

  box.addEventListener("change", () => { savePicked(chosen()); est(); });
  $("#demoNarrate")?.addEventListener("change", render);
  // 切語言：app.js 的處理先跑完（state.settings.lang 才是新的），再重畫
  $("#s_lang")?.addEventListener("change", () => setTimeout(render, 0));
  $("#demoAll")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = true); savePicked(chosen()); est(); });
  $("#demoNone")?.addEventListener("click", () => { boxes().forEach((b) => b.checked = false); savePicked(chosen()); est(); });

  if (!recSupported()) {
    const r = $("#demoRecord");
    if (r) { r.checked = false; r.disabled = true; }
    const hint = $("#demoRecHint");
    if (hint) hint.textContent = t("demo.noRec");
  }

  $("#demoStart")?.addEventListener("click", async () => {
    const ids = chosen();
    if (!ids.length) { alert(t("demo.pickOne")); return; }
    await run(ids, {
      narrate: !!$("#demoNarrate")?.checked,
      record: !!$("#demoRecord")?.checked,
    });
  });

  render();
}
