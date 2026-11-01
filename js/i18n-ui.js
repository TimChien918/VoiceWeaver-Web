// 版面重構（首頁主控台、底部導覽、步驟流程、品牌開場）新增的介面字串。
//
// 跟 i18n-sml.js / i18n-admin.js 同一個做法：另開一支、直接把鍵併進同一個 STRINGS 物件，
// t()、data-i18n、applyI18n 全部照舊運作。i18n.js 很大、也有其他工作同時在改，
// 分開放可以避免互相覆蓋。app.js 在第一次 applyI18n 之前匯入這支。
import { STRINGS } from "./i18n.js?v=1.5.78";

Object.assign(STRINGS, {
  "nav.home": { "zh-TW":"首頁", "en":"Home", "ja":"ホーム", "ko":"홈" },

  // ── 首頁主控台 ──
  "home.morning":   { "zh-TW":"早安", "en":"Good morning", "ja":"おはようございます", "ko":"좋은 아침이에요" },
  "home.afternoon": { "zh-TW":"午安", "en":"Good afternoon", "ja":"こんにちは", "ko":"좋은 오후예요" },
  "home.evening":   { "zh-TW":"晚安", "en":"Good evening", "ja":"こんばんは", "ko":"좋은 저녁이에요" },
  "home.sub": { "zh-TW":"今天想說什麼？慢慢來，我們一起把話拾起來。",
                "en":"What would you like to say today? Take your time — we'll gather the words together.",
                "ja":"今日は何を伝えたいですか？ゆっくりで大丈夫、一緒に言葉を拾いましょう。",
                "ko":"오늘은 무슨 말을 하고 싶으세요? 천천히, 함께 말을 모아 봐요." },
  "home.cta": { "zh-TW":"✨ 開始說話", "en":"✨ Start speaking", "ja":"✨ 話し始める", "ko":"✨ 말하기 시작" },
  "home.features": { "zh-TW":"功能", "en":"Features", "ja":"機能", "ko":"기능" },
  "home.recent": { "zh-TW":"🕘 最近說過的話（點一下再唸一次）", "en":"🕘 Recently said (tap to say again)",
                   "ja":"🕘 最近話したこと（タップでもう一度）", "ko":"🕘 최근에 한 말 (탭하면 다시 읽기)" },
  "home.recentEmpty": { "zh-TW":"還沒有紀錄。組好的句子會出現在這裡。", "en":"Nothing yet. Sentences you compose will show up here.",
                        "ja":"まだ記録がありません。作った文がここに表示されます。", "ko":"아직 기록이 없어요. 만든 문장이 여기에 표시됩니다." },
  "home.allHistory": { "zh-TW":"全部紀錄 ›", "en":"All history ›", "ja":"すべての履歴 ›", "ko":"전체 기록 ›" },

  // ── 設計書的六張功能卡 ──
  "feat.compose": { "zh-TW":"句子重組", "en":"Sentence rebuild", "ja":"文の再構成", "ko":"문장 재구성" },
  "feat.composeD": { "zh-TW":"AI 將零散詞語重組為自然語句", "en":"AI turns scattered words into natural sentences",
                     "ja":"AIがばらばらの言葉を自然な文に", "ko":"AI가 흩어진 단어를 자연스러운 문장으로" },
  "feat.rehab": { "zh-TW":"語音復健", "en":"Speech rehab", "ja":"発話リハビリ", "ko":"발화 재활" },
  "feat.rehabD": { "zh-TW":"AI 評分、錯誤標示與連續發音追蹤", "en":"AI scoring, error marks and practice tracking",
                   "ja":"AI採点・誤りの表示・継続練習の記録", "ko":"AI 채점, 오류 표시, 연속 발음 추적" },
  "feat.aac": { "zh-TW":"AAC 符號卡", "en":"AAC symbol cards", "ja":"AAC シンボルカード", "ko":"AAC 기호 카드" },
  "feat.aacD": { "zh-TW":"依類別點選圖卡溝通", "en":"Communicate by tapping cards by category",
                 "ja":"カテゴリ別のカードで伝える", "ko":"범주별 카드를 눌러 소통" },
  "feat.report": { "zh-TW":"進度報告", "en":"Progress report", "ja":"進捗レポート", "ko":"진행 보고서" },
  "feat.reportD": { "zh-TW":"趨勢圖、CSV 匯出、Telegram 推送", "en":"Trend charts, CSV export, Telegram push",
                    "ja":"推移グラフ・CSV出力・Telegram送信", "ko":"추세 그래프, CSV 내보내기, 텔레그램 전송" },
  "feat.tts": { "zh-TW":"多語言 TTS/STT", "en":"Multilingual TTS/STT", "ja":"多言語 TTS/STT", "ko":"다국어 TTS/STT" },
  "feat.ttsD": { "zh-TW":"中英日韓語音輸入與朗讀", "en":"Speak and listen in 中文 · English · 日本語 · 한국어",
                 "ja":"中・英・日・韓の音声入力と読み上げ", "ko":"중·영·일·한 음성 입력과 읽기" },
  "feat.sync": { "zh-TW":"雲端同步", "en":"Cloud sync", "ja":"クラウド同期", "ko":"클라우드 동기화" },
  "feat.syncD": { "zh-TW":"Firebase 跨裝置同步", "en":"Firebase sync across devices",
                  "ja":"Firebase で端末間同期", "ko":"Firebase 기기 간 동기화" },

  // ── 各頁的頁首說明 ──
  "page.compose": { "zh-TW":"說出碎詞，AI 幫你織成句子，由你決定要說哪一句。", "en":"Say a few words — AI weaves them into sentences, and you choose what to say.",
                    "ja":"単語を伝えると AI が文に。どれを話すかはあなたが決めます。", "ko":"단어를 말하면 AI가 문장으로 엮고, 무엇을 말할지는 당신이 정해요." },
  "page.rehab": { "zh-TW":"選一句、跟著唸，AI 給你回饋。", "en":"Pick a sentence, say it along, and get AI feedback.",
                  "ja":"文を選んで声に出すと、AI がフィードバックします。", "ko":"문장을 골라 따라 말하면 AI가 피드백해요." },
  "page.aac": { "zh-TW":"點圖卡組成句子，按朗讀說出口。", "en":"Tap cards to build a sentence, then press Speak.",
                "ja":"カードをタップして文を作り、読み上げを押します。", "ko":"카드를 눌러 문장을 만들고 읽기를 누르세요." },
  "page.report": { "zh-TW":"復健軌跡與表達紀錄，給家人與治療師參考。", "en":"Rehab trends and communication records for family and therapists.",
                   "ja":"リハビリの推移と記録。家族や言語聴覚士の参考に。", "ko":"재활 추세와 표현 기록, 가족과 치료사 참고용." },
  "page.history": { "zh-TW":"組過的句子，點一下再唸一次。", "en":"Sentences you've composed — tap to say again.",
                    "ja":"作った文。タップでもう一度読み上げ。", "ko":"만든 문장들 — 탭하면 다시 읽어요." },
  "page.settings": { "zh-TW":"依需要調整介面、語音與無障礙操作。", "en":"Adjust display, voice and accessibility to fit your needs.",
                     "ja":"表示・音声・アクセシビリティを調整します。", "ko":"화면, 음성, 접근성을 필요에 맞게 조정해요." },

  // ── 步驟流程 ──
  "step.input":   { "zh-TW":"說出想說的", "en":"Say what you want", "ja":"伝えたいことを入力", "ko":"하고 싶은 말 입력" },
  "step.context": { "zh-TW":"加入情境（選填）", "en":"Add context (optional)", "ja":"状況を追加（任意）", "ko":"상황 추가 (선택)" },
  "step.pick":    { "zh-TW":"挑一句，確認後說出口", "en":"Pick one, confirm, then speak", "ja":"一つ選んで確認して話す", "ko":"하나 골라 확인 후 말하기" },
  "stage.input":   { "zh-TW":"輸入", "en":"Words", "ja":"入力", "ko":"입력" },
  "stage.context": { "zh-TW":"情境", "en":"Context", "ja":"状況", "ko":"상황" },
  "stage.pick":    { "zh-TW":"候選", "en":"Choose", "ja":"候補", "ko":"후보" },
  "stage.confirm": { "zh-TW":"確認", "en":"Confirm", "ja":"確認", "ko":"확인" },
  "step.choose":   { "zh-TW":"選一句來練習", "en":"Choose a sentence", "ja":"練習する文を選ぶ", "ko":"연습할 문장 고르기" },
  "step.practice": { "zh-TW":"跟讀與 AI 回饋", "en":"Say it & AI feedback", "ja":"音読と AI フィードバック", "ko":"따라 읽기와 AI 피드백" },

  // ── 設定：帳號 ──
  "acct.title": { "zh-TW":"帳號", "en":"Account", "ja":"アカウント", "ko":"계정" },

  // ── 品牌開場（登入頁）──
  "login.motto": { "zh-TW":"讓說不出口的話，\n被世界聽見。", "en":"Even without words,\nbe heard by the world.",
                   "ja":"言葉にできない想いを、\n世界に届ける。", "ko":"말하지 못한 마음이\n세상에 들리도록." },
  "login.p1": { "zh-TW":"把碎詞拾起，AI 織成三個候選句", "en":"Gather fragments — AI weaves three candidate sentences",
                "ja":"言葉のかけらを拾い、AI が3つの候補文に", "ko":"조각난 말을 모아 AI가 후보 문장 3개로" },
  "login.p2": { "zh-TW":"由你本人確認，才說出口", "en":"Nothing is spoken until you confirm it",
                "ja":"本人が確認してから話す", "ko":"본인이 확인해야 말해요" },
  "login.p3": { "zh-TW":"圖卡、語音復健與危機守護", "en":"Symbol cards, speech rehab and a crisis safety net",
                "ja":"シンボルカード・発話リハビリ・危機時の見守り", "ko":"기호 카드, 발화 재활, 위기 안전망" },
});
