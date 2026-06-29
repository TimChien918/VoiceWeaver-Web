// 網頁介面多語系（繁中／英／日／韓）。介面語言＝朗讀語言，由設定頁的「語言」一鍵切換。
// 用法：HTML 元素加 data-i18n="key"（譯 textContent）、data-i18n-ph="key"（譯 placeholder）、
//       data-i18n-html="key"（譯 innerHTML，給含 <code> 的說明用）。

export const STRINGS = {
  // 登入
  "login.tagline": { "zh-TW":"輕量網頁版 · 失語溝通輔助", "en":"Lightweight web · aphasia communication aid", "ja":"軽量ウェブ版 · 失語コミュニケーション支援", "ko":"경량 웹 · 실어증 의사소통 보조" },
  "login.google":  { "zh-TW":"使用 Google 登入", "en":"Sign in with Google", "ja":"Google でログイン", "ko":"Google로 로그인" },
  "login.anon":    { "zh-TW":"匿名試用", "en":"Try anonymously", "ja":"匿名で試す", "ko":"익명으로 사용" },
  "login.note":    { "zh-TW":"登入後會自動記住你的 API 金鑰與設定，換裝置也能還原。", "en":"After signing in, your API keys and settings are saved and restored across devices.", "ja":"ログインすると API キーと設定が保存され、別の端末でも復元できます。", "ko":"로그인하면 API 키와 설정이 저장되어 다른 기기에서도 복원됩니다." },
  // 導覽
  "nav.compose":  { "zh-TW":"語句重組", "en":"Compose", "ja":"文の再構成", "ko":"문장 재구성" },
  "nav.rehab":    { "zh-TW":"語音復健", "en":"Speech Rehab", "ja":"発話リハビリ", "ko":"언어 재활" },
  "nav.aac":      { "zh-TW":"AAC 圖卡", "en":"AAC Cards", "ja":"AAC カード", "ko":"AAC 카드" },
  "nav.report":   { "zh-TW":"成績單", "en":"Report", "ja":"レポート", "ko":"리포트" },
  "nav.history":  { "zh-TW":"歷史", "en":"History", "ja":"履歴", "ko":"기록" },
  "nav.settings": { "zh-TW":"設定", "en":"Settings", "ja":"設定", "ko":"설정" },
  "logout":       { "zh-TW":"登出", "en":"Log out", "ja":"ログアウト", "ko":"로그아웃" },
  // 重組
  "compose.label": { "zh-TW":"碎詞／想說的（可用語音輸入）", "en":"Fragments / what you want to say (voice input ok)", "ja":"断片・言いたいこと（音声入力可）", "ko":"단어 조각 / 하고 싶은 말 (음성 입력 가능)" },
  "compose.ph":    { "zh-TW":"例：水 休息 現在", "en":"e.g. water rest now", "ja":"例：水 休憩 今", "ko":"예: 물 휴식 지금" },
  "btn.mic":     { "zh-TW":"🎤 語音輸入", "en":"🎤 Voice", "ja":"🎤 音声入力", "ko":"🎤 음성 입력" },
  "btn.loc":     { "zh-TW":"📍 加入地點", "en":"📍 Add location", "ja":"📍 場所を追加", "ko":"📍 위치 추가" },
  "btn.cam":     { "zh-TW":"📷 拍照辨識", "en":"📷 Photo", "ja":"📷 写真認識", "ko":"📷 사진 인식" },
  "btn.compose": { "zh-TW":"✨ 重組成自然句", "en":"✨ Compose sentence", "ja":"✨ 自然な文に", "ko":"✨ 자연스러운 문장으로" },
  "btn.composing": { "zh-TW":"重組中…", "en":"Composing…", "ja":"再構成中…", "ko":"재구성 중…" },
  "btn.speak":   { "zh-TW":"🔊 朗讀", "en":"🔊 Speak", "ja":"🔊 読み上げ", "ko":"🔊 읽기" },
  "btn.regen":   { "zh-TW":"重組一次", "en":"Redo", "ja":"もう一度", "ko":"다시 구성" },
  "btn.img":     { "zh-TW":"🖼 生成圖卡", "en":"🖼 Image", "ja":"🖼 画像生成", "ko":"🖼 이미지 생성" },
  "btn.copy":    { "zh-TW":"📋 複製", "en":"📋 Copy", "ja":"📋 コピー", "ko":"📋 복사" },
  "btn.share":   { "zh-TW":"🔗 分享", "en":"🔗 Share", "ja":"🔗 共有", "ko":"🔗 공유" },
  "btn.fav":     { "zh-TW":"⭐ 收藏", "en":"⭐ Save", "ja":"⭐ お気に入り", "ko":"⭐ 즐겨찾기" },
  "fav.label":   { "zh-TW":"⭐ 我的最愛（點一下朗讀）", "en":"⭐ Favorites (tap to speak)", "ja":"⭐ お気に入り（タップで読み上げ）", "ko":"⭐ 즐겨찾기 (탭하여 읽기)" },
  // 復健
  "rehab.targetLabel":   { "zh-TW":"練習句子", "en":"Practice sentence", "ja":"練習する文", "ko":"연습 문장" },
  "rehab.targetPh":      { "zh-TW":"輸入目標句，或讓 AI 推薦", "en":"Type a target, or let AI suggest", "ja":"目標文を入力、または AI に提案させる", "ko":"목표 문장 입력 또는 AI 추천" },
  "rehab.suggest":       { "zh-TW":"AI 推薦", "en":"AI suggest", "ja":"AI 提案", "ko":"AI 추천" },
  "rehab.start":         { "zh-TW":"開始練習", "en":"Start", "ja":"練習開始", "ko":"연습 시작" },
  "rehab.paragraph":     { "zh-TW":"📖 整段練習（自動分句逐句練）", "en":"📖 Paragraph (auto split, sentence by sentence)", "ja":"📖 段落練習（自動分割で一文ずつ）", "ko":"📖 단락 연습 (자동 분할, 문장별)" },
  "rehab.targetDisplay": { "zh-TW":"目標句（點字卡可單獨發音）", "en":"Target (tap a card to speak it)", "ja":"目標文（カードをタップで個別発音）", "ko":"목표 문장 (카드를 탭하면 개별 발음)" },
  "rehab.listen":        { "zh-TW":"🔊 聽整句", "en":"🔊 Listen", "ja":"🔊 全文を聞く", "ko":"🔊 전체 듣기" },
  "rehab.record":        { "zh-TW":"🎤 開始跟讀", "en":"🎤 Repeat", "ja":"🎤 復唱開始", "ko":"🎤 따라 말하기" },
  "rehab.next":          { "zh-TW":"下一句 ▶", "en":"Next ▶", "ja":"次の文 ▶", "ko":"다음 ▶" },
  "rehab.recent":        { "zh-TW":"最近練習", "en":"Recent practice", "ja":"最近の練習", "ko":"최근 연습" },
  // 成績單
  "report.today":  { "zh-TW":"今日", "en":"Today", "ja":"今日", "ko":"오늘" },
  "report.month":  { "zh-TW":"本月", "en":"This month", "ja":"今月", "ko":"이번 달" },
  "report.year":   { "zh-TW":"本年度", "en":"This year", "ja":"今年", "ko":"올해" },
  "report.sessions": { "zh-TW":"練習次數", "en":"Sessions", "ja":"練習回数", "ko":"연습 횟수" },
  "report.avg":      { "zh-TW":"平均分", "en":"Avg score", "ja":"平均点", "ko":"평균 점수" },
  "report.streak":   { "zh-TW":"連續天數", "en":"Streak", "ja":"連続日数", "ko":"연속 일수" },
  "report.positive": { "zh-TW":"正向字眼", "en":"Positive words", "ja":"前向きな言葉", "ko":"긍정적 표현" },
  "report.trend":    { "zh-TW":"分數趨勢", "en":"Score trend", "ja":"スコア推移", "ko":"점수 추세" },
  "report.recent10": { "zh-TW":"最近 10 筆練習", "en":"Last 10 sessions", "ja":"直近 10 件の練習", "ko":"최근 10건 연습" },
  // AAC
  "aac.selected": { "zh-TW":"已選", "en":"Selected", "ja":"選択中", "ko":"선택됨" },
  "aac.speak":    { "zh-TW":"🔊 朗讀", "en":"🔊 Speak", "ja":"🔊 読み上げ", "ko":"🔊 읽기" },
  "aac.compose":  { "zh-TW":"✨ 組成句子", "en":"✨ Make sentence", "ja":"✨ 文を作る", "ko":"✨ 문장 만들기" },
  "aac.clear":    { "zh-TW":"清空", "en":"Clear", "ja":"クリア", "ko":"지우기" },
  // 設定
  "set.llmTitle": { "zh-TW":"💬 文字供應商（重組／組句）", "en":"💬 Text providers (compose)", "ja":"💬 テキスト提供元（再構成）", "ko":"💬 텍스트 공급자 (재구성)" },
  "set.llmDesc":  { "zh-TW":"可加多個供應商、同一家也能放多把金鑰；使用時自動輪詢＋失敗備援。", "en":"Add multiple providers or multiple keys; auto round-robin with failover.", "ja":"複数の提供元・複数キーを追加可。自動ローテーション＋フェイルオーバー。", "ko":"여러 공급자·여러 키 추가 가능. 자동 순환＋장애 조치." },
  "set.addLlm":   { "zh-TW":"＋ 新增文字供應商", "en":"＋ Add text provider", "ja":"＋ テキスト提供元を追加", "ko":"＋ 텍스트 공급자 추가" },
  "set.imgTitle": { "zh-TW":"🖼 生圖供應商", "en":"🖼 Image providers", "ja":"🖼 画像生成の提供元", "ko":"🖼 이미지 공급자" },
  "set.imgDesc":  { "zh-TW":"Pollinations 免金鑰、永遠保底；可再加 Gemini／HuggingFace／OpenAI。", "en":"Pollinations is key-free and always available; add Gemini/HuggingFace/OpenAI.", "ja":"Pollinations はキー不要で常時利用可。Gemini／HuggingFace／OpenAI も追加可。", "ko":"Pollinations는 키 불필요·항상 사용 가능. Gemini/HuggingFace/OpenAI 추가 가능." },
  "set.addImg":   { "zh-TW":"＋ 新增生圖供應商", "en":"＋ Add image provider", "ja":"＋ 画像提供元を追加", "ko":"＋ 이미지 공급자 추가" },
  "set.tgTitle":  { "zh-TW":"🆘 緊急通報（Telegram，選用）", "en":"🆘 Emergency alert (Telegram, optional)", "ja":"🆘 緊急通報（Telegram・任意）", "ko":"🆘 긴급 알림 (Telegram, 선택)" },
  "set.tgChat":   { "zh-TW":"Chat ID（接收者）", "en":"Chat ID (recipient)", "ja":"Chat ID（受信者）", "ko":"Chat ID (수신자)" },
  "set.prefs":    { "zh-TW":"偏好", "en":"Preferences", "ja":"設定", "ko":"환경설정" },
  "set.theme":    { "zh-TW":"介面主題", "en":"Theme", "ja":"テーマ", "ko":"테마" },
  "theme.auto":   { "zh-TW":"跟隨系統", "en":"System", "ja":"システムに従う", "ko":"시스템 따름" },
  "theme.light":  { "zh-TW":"淺色", "en":"Light", "ja":"ライト", "ko":"라이트" },
  "theme.dark":   { "zh-TW":"深色", "en":"Dark", "ja":"ダーク", "ko":"다크" },
  "set.lang":     { "zh-TW":"語言（介面＋朗讀）", "en":"Language (UI + speech)", "ja":"言語（画面＋読み上げ）", "ko":"언어 (화면＋읽기)" },
  "set.rate":     { "zh-TW":"朗讀語速", "en":"Speech rate", "ja":"読み上げ速度", "ko":"읽기 속도" },
  "set.font":     { "zh-TW":"字體大小", "en":"Font size", "ja":"文字サイズ", "ko":"글자 크기" },
  "set.computeTitle": { "zh-TW":"🖥 讓電腦幫忙跑運算（語音／生圖／文字）", "en":"🖥 Let the computer compute (voice/image/text)", "ja":"🖥 PC に計算を任せる（音声／画像／テキスト）", "ko":"🖥 컴퓨터로 연산 (음성/이미지/텍스트)" },
  "set.computeDesc":  { "zh-TW":"像手機一樣把運算丟給電腦：語音用 GPT-SoVITS 角色聲音、生圖用 SD-Turbo、文字用本機 Qwen。連得上才會用，連不上自動退回雲端／瀏覽器。", "en":"Offload to your computer like the phone does: voice via GPT-SoVITS, images via SD-Turbo, text via local Qwen. Used when reachable, otherwise falls back to cloud/browser.", "ja":"スマホと同じく PC に計算を委ねます：音声は GPT-SoVITS、画像は SD-Turbo、テキストはローカル Qwen。接続できる時のみ使用し、不可ならクラウド／ブラウザに自動フォールバック。", "ko":"휴대폰처럼 컴퓨터에 연산을 맡깁니다: 음성 GPT-SoVITS, 이미지 SD-Turbo, 텍스트 로컬 Qwen. 연결될 때만 사용하고 안 되면 클라우드/브라우저로 자동 전환." },
  "set.computeEnable":{ "zh-TW":"啟用電腦運算", "en":"Enable computer compute", "ja":"PC 計算を有効化", "ko":"컴퓨터 연산 사용" },
  "set.detect":   { "zh-TW":"🔍 偵測連線", "en":"🔍 Detect", "ja":"🔍 接続を検出", "ko":"🔍 연결 감지" },
  "set.detectNot":{ "zh-TW":"尚未偵測", "en":"Not detected yet", "ja":"未検出", "ko":"아직 감지 안 됨" },
  "set.urlLabel": { "zh-TW":"語音中心位址（選填）", "en":"Voice center address (optional)", "ja":"ボイスセンターのアドレス（任意）", "ko":"보이스 센터 주소 (선택)" },
  "set.urlPh":    { "zh-TW":"同一台電腦免填；遠端填 Tailscale 網址，例 https://mac.xxx.ts.net", "en":"Leave blank on same computer; for remote use Tailscale URL e.g. https://mac.xxx.ts.net", "ja":"同じ PC なら空欄；遠隔は Tailscale URL（例 https://mac.xxx.ts.net）", "ko":"같은 컴퓨터면 비워두기; 원격은 Tailscale 주소 예 https://mac.xxx.ts.net" },
  "set.voiceLabel":{ "zh-TW":"角色語音", "en":"Character voice", "ja":"キャラクター音声", "ko":"캐릭터 음성" },
  "set.voiceFirst":{ "zh-TW":"（先偵測連線）", "en":"(detect connection first)", "ja":"（先に接続を検出）", "ko":"(먼저 연결 감지)" },
  "set.computeHint": { "zh-TW":'• <b>同一台電腦</b>：開網頁的電腦＝跑語音中心的電腦 → 免填位址，直接偵測即可。<br>• <b>Tailscale</b>：電腦先跑 <code>tailscale serve --bg 9879</code>（把橋接埠對外成 HTTPS），上面位址填你的 <code>https://主機.xxx.ts.net</code>（橋接會自動轉呼叫本機的 GPT-SoVITS，不必另外開 9880）。',
    "en":'• <b>Same computer</b>: the computer showing this page = the one running the voice center → leave the address blank and just detect.<br>• <b>Tailscale</b>: run <code>tailscale serve --bg 9879</code> on the computer (expose the bridge over HTTPS), then put your <code>https://host.xxx.ts.net</code> above (the bridge calls local GPT-SoVITS for you; no need to expose 9880).',
    "ja":'• <b>同じ PC</b>：このページを開く PC ＝ボイスセンターを動かす PC → アドレスは空欄で検出するだけ。<br>• <b>Tailscale</b>：PC で <code>tailscale serve --bg 9879</code> を実行（ブリッジを HTTPS で公開）し、上に <code>https://host.xxx.ts.net</code> を入力（ブリッジが自動でローカル GPT-SoVITS を呼ぶので 9880 の公開は不要）。',
    "ko":'• <b>같은 컴퓨터</b>: 이 페이지를 여는 컴퓨터 ＝ 보이스 센터 실행 컴퓨터 → 주소 비우고 감지만.<br>• <b>Tailscale</b>: 컴퓨터에서 <code>tailscale serve --bg 9879</code> 실행(브리지를 HTTPS로 공개) 후 위에 <code>https://host.xxx.ts.net</code> 입력(브리지가 로컬 GPT-SoVITS를 호출하므로 9880 공개 불필요).' },
  "footer": { "zh-TW":"VoiceWeaver 網頁輕量版 · 純 API/瀏覽器、無本地運算", "en":"VoiceWeaver web lite · API/browser only, no on-device compute", "ja":"VoiceWeaver ウェブ軽量版 · API/ブラウザのみ、端末計算なし", "ko":"VoiceWeaver 웹 라이트 · API/브라우저 전용, 기기 연산 없음" },
};

function pick(entry, lang){
  if(!entry) return null;
  if(entry[lang]) return entry[lang];
  const base = (lang||"").split("-")[0];
  const hit = Object.keys(entry).find(k => k.split("-")[0] === base);
  return hit ? entry[hit] : entry["zh-TW"];
}

// 取單一字串（給 JS 動態文字用）
export function t(key, lang){
  const L = lang || (document.documentElement.getAttribute("data-lang")) || "zh-TW";
  return pick(STRINGS[key], L) || key;
}

// 套用到整個 DOM
export function applyI18n(lang){
  const L = lang || "zh-TW";
  document.documentElement.setAttribute("data-lang", L);
  document.documentElement.setAttribute("lang", L);
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const v = pick(STRINGS[el.getAttribute("data-i18n")], L);
    if(v != null) el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>{
    const v = pick(STRINGS[el.getAttribute("data-i18n-ph")], L);
    if(v != null) el.setAttribute("placeholder", v);
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el=>{
    const v = pick(STRINGS[el.getAttribute("data-i18n-html")], L);
    if(v != null) el.innerHTML = v;
  });
}
