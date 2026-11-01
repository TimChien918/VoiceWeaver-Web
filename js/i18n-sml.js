// 拾語者（Speak My Life）功能補齊所新增的介面字串：無障礙掃描／眨眼／停留點選、
// 四級題庫、復健 AI 細項回饋、復健軌跡趨勢圖、聲紋同意、危機訊息收件人說明。
//
// 為什麼另開一支、不直接寫進 i18n.js：那支檔案很大、也有其他工作同時在改，
// 分開放可以避免互相覆蓋。合併方式是直接把鍵併進同一個 STRINGS 物件，
// 所以 t()、data-i18n、applyI18n 全部照舊運作，用起來跟寫在 i18n.js 裡沒有差別。
// app.js 在匯入 i18n.js 之前先匯入這支，確保第一次 applyI18n 時這些鍵已經在了。
import { STRINGS } from "./i18n.js?v=1.6.0";

Object.assign(STRINGS, {
  // ── 臨床題庫四級 ──
  "rehab.level1": { "zh-TW":"第 1 級", "en":"Level 1", "ja":"レベル1", "ko":"1단계" },
  "rehab.level2": { "zh-TW":"第 2 級", "en":"Level 2", "ja":"レベル2", "ko":"2단계" },
  "rehab.level3": { "zh-TW":"第 3 級", "en":"Level 3", "ja":"レベル3", "ko":"3단계" },
  "rehab.level4": { "zh-TW":"第 4 級", "en":"Level 4", "ja":"レベル4", "ko":"4단계" },

  // ── 復健 AI 細項回饋 ──
  "rehab.subSemantic": { "zh-TW":"語意", "en":"Meaning", "ja":"意味", "ko":"의미" },
  "rehab.subFluency":  { "zh-TW":"流暢度", "en":"Fluency", "ja":"流暢さ", "ko":"유창성" },
  "rehab.subProsody":  { "zh-TW":"語調", "en":"Intonation", "ja":"抑揚", "ko":"억양" },
  "rehab.extraWords":  { "zh-TW":"多說或說成：", "en":"Added or swapped: ", "ja":"言い足し・言い換え：", "ko":"덧붙이거나 바꾼 말: " },
  "rehab.latency":     { "zh-TW":"⏱ 開口前停頓 {s} 秒", "en":"⏱ Paused {s}s before speaking", "ja":"⏱ 話し始めるまで {s} 秒", "ko":"⏱ 말하기 전 {s}초 멈춤" },
  "rehab.privacyNote": { "zh-TW":"🔒 跟讀的聲音只用於這次辨識評分，評分完立即丟棄，不會存進本機或雲端；只保留文字與分數。",
                         "en":"🔒 Your voice is used only to recognise and score this attempt, then discarded right away. Nothing is saved on this device or in the cloud except the text and score.",
                         "ja":"🔒 音読の声は今回の認識と採点にだけ使い、採点後すぐに破棄します。端末にもクラウドにも保存されず、残るのは文字と点数だけです。",
                         "ko":"🔒 따라 읽은 목소리는 이번 인식과 채점에만 쓰이고 채점 후 바로 삭제됩니다. 기기나 클라우드에 저장되지 않으며 글자와 점수만 남습니다." },

  // ── 復健軌跡趨勢圖 ──
  "traj.title":         { "zh-TW":"📈 復健軌跡趨勢圖", "en":"📈 Rehabilitation trajectory", "ja":"📈 リハビリ推移グラフ", "ko":"📈 재활 추이 그래프" },
  "traj.reactionTitle": { "zh-TW":"⏱ 反應時間（秒，越低越好）", "en":"⏱ Response time (seconds, lower is better)", "ja":"⏱ 反応時間（秒・低いほど良い）", "ko":"⏱ 반응 시간 (초, 낮을수록 좋음)" },
  "traj.hitTitle":      { "zh-TW":"🎯 命中率（%，越高越好）", "en":"🎯 Hit rate (%, higher is better)", "ja":"🎯 的中率（%・高いほど良い）", "ko":"🎯 적중률 (%, 높을수록 좋음)" },
  "traj.note":          { "zh-TW":"反應＝開 App 到第一次發聲／跟讀時開口前的停頓 · 命中＝AI 第一候選被採用／跟讀得分 ≥ 80。沒有練習的日子是斷點，不算 0 分。",
                          "en":"Response = app open to first spoken output / pause before speaking in read-aloud practice · Hit = AI's first suggestion accepted / practice score ≥ 80. Days without practice are gaps, not zeros.",
                          "ja":"反応＝アプリを開いてから最初に発声するまで／音読で話し始めるまでの間 · 的中＝AI の第一候補が採用された率／音読の点数が 80 以上の率。練習しなかった日は 0 点ではなく空白になります。",
                          "ko":"반응 = 앱을 연 뒤 첫 발화까지 / 따라 읽기에서 말하기 전 멈춘 시간 · 적중 = AI 첫 번째 후보 채택률 / 따라 읽기 80점 이상 비율. 연습하지 않은 날은 0점이 아니라 빈칸으로 표시됩니다." },
  "traj.last7":         { "zh-TW":"（最近 7 天）", "en":"(last 7 days)", "ja":"（直近7日）", "ko":"(최근 7일)" },
  "traj.byDay":         { "zh-TW":"（逐日）", "en":"(daily)", "ja":"（日ごと）", "ko":"(일별)" },
  "traj.byMonth":       { "zh-TW":"（逐月）", "en":"(monthly)", "ja":"（月ごと）", "ko":"(월별)" },
  "traj.sReaction":     { "zh-TW":"開啟到首次發聲", "en":"Open → first speech", "ja":"起動→初発声", "ko":"실행→첫 발화" },
  "traj.sRehabLatency": { "zh-TW":"跟讀開口前停頓", "en":"Pause before reading aloud", "ja":"音読の話し始め", "ko":"따라 읽기 전 멈춤" },
  "traj.sPickHit":      { "zh-TW":"選句命中率", "en":"Sentence pick hit rate", "ja":"候補文の的中率", "ko":"문장 선택 적중률" },
  "traj.sRehabHit":     { "zh-TW":"跟讀命中率（≥80）", "en":"Practice hit rate (≥80)", "ja":"音読の的中率（80以上）", "ko":"따라 읽기 적중률(80+)" },
  "traj.csvHeader":     { "zh-TW":"日期,反應時間(秒),選句命中率(%),跟讀開口前停頓(秒),跟讀命中率(%)",
                          "en":"Date,Response time (s),Sentence pick hit rate (%),Pause before reading (s),Practice hit rate (%)",
                          "ja":"日付,反応時間(秒),候補文の的中率(%),音読の話し始め(秒),音読の的中率(%)",
                          "ko":"날짜,반응 시간(초),문장 선택 적중률(%),따라 읽기 전 멈춤(초),따라 읽기 적중률(%)" },

  // ── 聲紋同意 ──
  "vc.title":    { "zh-TW":"🗣 使用專屬聲音（聲紋）之前", "en":"🗣 Before using a personal voice (voiceprint)", "ja":"🗣 専用の声（声紋）を使う前に", "ko":"🗣 전용 목소리(성문)를 쓰기 전에" },
  "vc.what":     { "zh-TW":"用途：用 GPT-SoVITS 模仿一個真實的人的聲音（患者病發前的聲音，或家人的聲音），把患者確認過的句子用這個聲音唸出來。聽的人會以為是本人在說話，所以必須先取得聲音主人的同意。",
                   "en":"What it does: GPT-SoVITS imitates a real person's voice (the patient's voice from before the stroke, or a family member's) and reads the sentences the patient has confirmed in that voice. Listeners will hear it as that person speaking, so the owner of the voice must agree first.",
                   "ja":"用途：GPT-SoVITS で実在の人の声（発症前の患者本人の声、または家族の声）をまね、患者が確認した文をその声で読み上げます。聞く人は本人が話していると受け取るため、声の持ち主の同意が必要です。",
                   "ko":"용도: GPT-SoVITS로 실제 사람의 목소리(발병 전 환자 본인 또는 가족의 목소리)를 흉내 내어, 환자가 확인한 문장을 그 목소리로 읽어 줍니다. 듣는 사람은 본인이 말한다고 여기므로 목소리 주인의 동의가 먼저 필요합니다." },
  "vc.where":    { "zh-TW":"存放：聲音模型存在你自己的 Google Drive（Speak-My-Life/Models/），合成在你自己的電腦或 Colab 上進行。這個網頁不會上傳、也不會保存任何錄音；設定裡只記錄「是否同意、何時同意」。",
                   "en":"Where it lives: voice models stay in your own Google Drive (Speak-My-Life/Models/), and synthesis runs on your own computer or Colab. This web page never uploads or keeps any recording; your settings only record whether and when you agreed.",
                   "ja":"保存場所：声のモデルはあなた自身の Google ドライブ（Speak-My-Life/Models/）にあり、合成はあなたのパソコンか Colab で行います。このページが録音をアップロード・保存することはありません。設定に残るのは「同意したか・いつ同意したか」だけです。",
                   "ko":"보관 위치: 목소리 모델은 본인의 Google 드라이브(Speak-My-Life/Models/)에 있고, 합성은 본인의 컴퓨터나 Colab에서 이루어집니다. 이 웹페이지는 녹음을 업로드하거나 저장하지 않으며, 설정에는 '동의 여부와 동의한 시각'만 기록됩니다." },
  "vc.revoke":   { "zh-TW":"撤回：隨時可以在設定裡按「撤回聲紋同意」，撤回後立刻停用專屬聲音、改用一般語音。要徹底刪除聲音模型，請到 Google Drive 刪除對應資料夾。",
                   "en":"Withdrawing: you can tap “Withdraw voiceprint consent” in Settings at any time. The personal voice stops being used immediately and a standard voice takes over. To delete the voice model completely, remove its folder from Google Drive.",
                   "ja":"撤回：設定の「声紋の同意を撤回」でいつでも撤回できます。撤回するとすぐに専用の声は使われなくなり、通常の音声に切り替わります。声のモデルを完全に消すには、Google ドライブの該当フォルダを削除してください。",
                   "ko":"철회: 설정에서 언제든 '성문 동의 철회'를 누를 수 있습니다. 철회하면 전용 목소리 사용이 즉시 중단되고 일반 음성으로 바뀝니다. 목소리 모델을 완전히 지우려면 Google 드라이브에서 해당 폴더를 삭제하세요." },
  "vc.owner":    { "zh-TW":"我是這個聲音的本人，或已取得聲音本人（或其法定代理人）的同意。",
                   "en":"I am the owner of this voice, or I have the consent of the voice owner (or their legal representative).",
                   "ja":"私はこの声の本人です。または声の本人（もしくはその法定代理人）の同意を得ています。",
                   "ko":"나는 이 목소리의 본인이거나, 목소리 본인(또는 법정대리인)의 동의를 받았습니다." },
  "vc.agree":    { "zh-TW":"同意並啟用", "en":"Agree and enable", "ja":"同意して有効にする", "ko":"동의하고 사용" },
  "vc.decline":  { "zh-TW":"不同意", "en":"Don't agree", "ja":"同意しない", "ko":"동의 안 함" },
  "vc.grantBtn": { "zh-TW":"📝 閱讀並同意使用聲紋", "en":"📝 Read and consent to voiceprint use", "ja":"📝 声紋の利用について読んで同意する", "ko":"📝 성문 사용 안내 읽고 동의하기" },
  "vc.revokeBtn":{ "zh-TW":"撤回聲紋同意", "en":"Withdraw voiceprint consent", "ja":"声紋の同意を撤回", "ko":"성문 동의 철회" },
  "vc.statusOn": { "zh-TW":"✅ 已同意使用聲紋（{date}）", "en":"✅ Voiceprint consent given ({date})", "ja":"✅ 声紋の利用に同意済み（{date}）", "ko":"✅ 성문 사용 동의함 ({date})" },
  "vc.statusOff":{ "zh-TW":"⚠️ 尚未同意使用聲紋：專屬聲音不會被拿來朗讀。", "en":"⚠️ No voiceprint consent yet: the personal voice will not be used.", "ja":"⚠️ 声紋の利用に未同意：専用の声は読み上げに使われません。", "ko":"⚠️ 성문 사용 미동의: 전용 목소리로 읽지 않습니다." },
  "vc.statusRevoked": { "zh-TW":"⛔ 已於 {date} 撤回聲紋同意：專屬聲音已停用。", "en":"⛔ Voiceprint consent withdrawn on {date}: personal voice is off.", "ja":"⛔ {date} に声紋の同意を撤回：専用の声は停止中です。", "ko":"⛔ {date}에 성문 동의 철회: 전용 목소리 사용 중지." },
  "vc.revokeConfirm": { "zh-TW":"確定要撤回聲紋同意嗎？撤回後會立刻停用專屬聲音。", "en":"Withdraw voiceprint consent? The personal voice will stop being used immediately.", "ja":"声紋の同意を撤回しますか？撤回するとすぐに専用の声は使われなくなります。", "ko":"성문 동의를 철회할까요? 철회하면 전용 목소리 사용이 즉시 중단됩니다." },
  "vc.needed":   { "zh-TW":"需要先同意使用聲紋，才會用專屬聲音朗讀", "en":"Voiceprint consent is needed before the personal voice can be used", "ja":"専用の声を使うには先に声紋の利用への同意が必要です", "ko":"전용 목소리를 쓰려면 먼저 성문 사용에 동의해야 합니다" },
  "vc.granted":  { "zh-TW":"✅ 已記錄聲紋同意", "en":"✅ Voiceprint consent recorded", "ja":"✅ 声紋の同意を記録しました", "ko":"✅ 성문 동의를 기록했습니다" },
  "vc.revoked":  { "zh-TW":"已撤回聲紋同意，專屬聲音已停用", "en":"Consent withdrawn — personal voice turned off", "ja":"同意を撤回しました。専用の声は停止しました", "ko":"동의를 철회했습니다. 전용 목소리를 껐습니다" },
  "vc.layerNeed":{ "zh-TW":"需聲紋同意", "en":"Needs consent", "ja":"同意が必要", "ko":"동의 필요" },

  // ── 危機訊息收件人 ──
  "tgp.rule":  { "zh-TW":"🔒 求救與危機訊息（文字、位置、現場照片、語音）只會傳送到上面這個 Chat ID——也就是你指定的家人。沒有填就不會傳到任何地方，不會改送給開發者或其他人。",
                 "en":"🔒 Help and crisis messages (text, location, on-scene photos, voice) are sent only to the Chat ID above — the family member you chose. If it is empty, nothing is sent anywhere; messages are never redirected to the developers or anyone else.",
                 "ja":"🔒 救助・危機のメッセージ（文字、位置情報、現場の写真、音声）は上の Chat ID、つまりあなたが指定した家族にだけ送られます。未入力ならどこにも送られず、開発者や他の人に回されることもありません。",
                 "ko":"🔒 도움 요청·위기 메시지(글, 위치, 현장 사진, 음성)는 위의 Chat ID, 즉 지정한 가족에게만 전송됩니다. 비어 있으면 어디에도 보내지 않으며, 개발자나 다른 사람에게 대신 보내는 일도 없습니다." },
  "tgp.ready": { "zh-TW":"✅ 目前：危機訊息只會傳給指定家人（Chat ID {id}）", "en":"✅ Now: crisis messages go only to your chosen family member (Chat ID {id})", "ja":"✅ 現在：危機メッセージは指定した家族（Chat ID {id}）にだけ送られます", "ko":"✅ 현재: 위기 메시지는 지정한 가족(Chat ID {id})에게만 전송됩니다" },
  "tgp.none":  { "zh-TW":"⚠️ 目前：尚未指定家人——危機時不會傳出任何訊息，只能直接撥打專線。", "en":"⚠️ Now: no family member set — in a crisis no message will be sent; only the hotline buttons will work.", "ja":"⚠️ 現在：家族が未指定です。危機の際もメッセージは送られず、相談ダイヤルへの発信のみになります。", "ko":"⚠️ 현재: 가족이 지정되지 않았습니다. 위기 때 메시지가 전송되지 않으며 상담 전화만 걸 수 있습니다." },
  "crisis.noFamily": { "zh-TW":"尚未在設定指定家人，訊息沒有傳出去。請直接撥打下方專線。", "en":"No family contact is set up, so no message was sent. Please call a hotline below.", "ja":"設定で家族が指定されていないため、メッセージは送られていません。下の相談ダイヤルに電話してください。", "ko":"설정에 가족이 지정되지 않아 메시지를 보내지 않았습니다. 아래 전화로 바로 연락하세요." },

  // ── 無障礙操作 ──
  "a11y.title":  { "zh-TW":"♿ 無障礙操作（掃描／眨眼／停留點選）", "en":"♿ Accessibility (scanning / blink / dwell)", "ja":"♿ アクセシビリティ（スキャン／まばたき／ドウェル）", "ko":"♿ 접근성 (스캔 / 눈 깜박임 / 머무르기)" },
  "scan.enable": { "zh-TW":"掃描模式", "en":"Scanning mode", "ja":"スキャンモード", "ko":"스캔 모드" },
  "scan.desc":   { "zh-TW":"畫面自動逐一高亮區塊與按鈕；亮到想要的那格時，按空白鍵／Enter、或點畫面任何地方就選取。先選區塊、再選裡面的按鈕，一輪沒選會自動退回。",
                   "en":"The screen highlights sections and buttons one at a time. When the one you want lights up, press Space/Enter or tap anywhere to select it. Pick a section first, then a button inside it; if you pass a full round without choosing, it steps back out.",
                   "ja":"画面がエリアとボタンを順に強調表示します。目的のものが光ったら、スペース／Enter を押すか画面のどこかをタップして選択。まずエリア、次にその中のボタンを選びます。1周選ばなければ自動で戻ります。",
                   "ko":"화면이 영역과 버튼을 하나씩 강조합니다. 원하는 칸이 켜졌을 때 스페이스/Enter를 누르거나 화면 아무 곳이나 누르면 선택됩니다. 먼저 영역, 그다음 그 안의 버튼을 고르며, 한 바퀴 동안 고르지 않으면 자동으로 되돌아갑니다." },
  "scan.speed":  { "zh-TW":"掃描速度（每格停留）", "en":"Scan speed (time per item)", "ja":"スキャン速度（1項目の表示時間）", "ko":"스캔 속도 (항목당 시간)" },
  "scan.stop":   { "zh-TW":"⏹ 停止掃描", "en":"⏹ Stop scanning", "ja":"⏹ スキャン停止", "ko":"⏹ 스캔 중지" },
  "scan.hint":   { "zh-TW":"空白鍵／Enter／點畫面＝選取", "en":"Space / Enter / tap = select", "ja":"スペース／Enter／タップ＝選択", "ko":"스페이스 / Enter / 탭 = 선택" },
  "scan.hintBlink": { "zh-TW":"長眨眼／空白鍵／點畫面＝選取", "en":"Long blink / Space / tap = select", "ja":"長いまばたき／スペース／タップ＝選択", "ko":"길게 깜박임 / 스페이스 / 탭 = 선택" },
  "scan.kiosk":  { "zh-TW":"選取＝唸出目前這張卡", "en":"Select = speak the current card", "ja":"選択＝今のカードを読み上げ", "ko":"선택 = 지금 카드 읽기" },
  "blink.enable":{ "zh-TW":"眨眼選取", "en":"Blink to select", "ja":"まばたきで選択", "ko":"눈 깜박임으로 선택" },
  "blink.desc":  { "zh-TW":"前鏡頭偵測刻意的長眨眼（雙眼閉住超過設定時間）＝選取目前高亮的項目；一般自然眨眼不會觸發。會一併開啟掃描模式。",
                   "en":"The front camera watches for a deliberate long blink (both eyes closed longer than the set time) to select the highlighted item. Ordinary blinks don't count. Turns on scanning mode too.",
                   "ja":"フロントカメラで意図的な長いまばたき（両目を設定時間以上閉じる）を検出し、強調中の項目を選択します。普段のまばたきでは反応しません。スキャンモードも一緒にオンになります。",
                   "ko":"전면 카메라가 의도적인 긴 깜박임(두 눈을 설정 시간 이상 감기)을 감지해 강조된 항목을 선택합니다. 평소 깜박임은 반응하지 않습니다. 스캔 모드도 함께 켜집니다." },
  "blink.hold":  { "zh-TW":"閉眼多久算選取", "en":"How long to close your eyes", "ja":"目を閉じる長さ", "ko":"눈을 감는 시간" },
  "blink.tracking": { "zh-TW":"👁 眨眼偵測中：雙眼閉住 {s} 秒＝選取", "en":"👁 Watching for blinks: close both eyes for {s}s to select", "ja":"👁 まばたき検出中：両目を {s} 秒閉じると選択", "ko":"👁 깜박임 감지 중: 두 눈을 {s}초 감으면 선택" },
  "blink.resume":{ "zh-TW":"👁 開啟眨眼", "en":"👁 Start blink", "ja":"👁 まばたき開始", "ko":"👁 깜박임 시작" },
  "dwell.enable":{ "zh-TW":"停留點選（滑鼠／觸控筆）", "en":"Dwell click (mouse / stylus)", "ja":"ドウェルクリック（マウス／ペン）", "ko":"머무르기 클릭 (마우스 / 펜)" },
  "dwell.desc":  { "zh-TW":"指標停在按鈕上一段時間就自動點擊，不必按下去。停留時間也套用到鼻子頭控。",
                   "en":"Rest the pointer on a button for a moment and it clicks by itself — no need to press. The same dwell time is used for nose head control.",
                   "ja":"ポインタをボタンの上にしばらく置くと自動でクリックされ、押す必要はありません。同じ時間が鼻ヘッドコントロールにも使われます。",
                   "ko":"포인터를 버튼 위에 잠시 두면 누르지 않아도 자동으로 클릭됩니다. 같은 시간이 코 헤드 컨트롤에도 적용됩니다." },
  "dwell.time":  { "zh-TW":"停留時間", "en":"Dwell time", "ja":"ドウェル時間", "ko":"머무르는 시간" },
});
