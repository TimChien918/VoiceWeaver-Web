// 醫療級安全防護層——與 App 的 com.example.safety.SafetyGuard 同一套規則。
//
// 位於 LLM 與 UI 之間，三層縱深防禦：
//   1. DEFENSIVE_SYSTEM_PROMPT：黏在送進 LLM 的 system message 最前面，先限制模型別生成。
//   2. classifyRisk：在「要發聲之前」分級攔截。一般直接唸、醫療類跳確認、自傷類鎖住不唸。
//   3. sanitizeForSpeech：模型萬一還是吐出禁字，送進 TTS 前替換掉。
//
// 三層都要留著。不要因為信任 prompt 就拿掉第三層——prompt 是請求，不是保證。

/**
 * 中文／英文常見危機關鍵字。
 * 比對「包含」而非「等於」，而且字之間允許空白——使用者可能把字拆成片段
 * （「自 殺」）餵進重組區，或 STT 斷詞把字拆開。
 */
const CRISIS_PATTERNS = [
  /自\s*殺/, /自\s*殘/, /自\s*我\s*了\s*斷/,
  /想\s*死/, /不\s*想\s*活/, /結\s*束\s*生\s*命/,
  /跳\s*樓/, /上\s*吊/, /吞\s*藥/,
  /suicide/i, /kill\s*myself/i, /end\s*my\s*life/i, /self[-\s]?harm/i
];

/** 拒絕治療類：不觸發家人通報，但同樣屬於「不可發聲」。 */
const REFUSAL_PATTERNS = [
  /拒\s*絕\s*治\s*療/, /放\s*棄\s*治\s*療/, /不\s*要\s*救\s*我/,
  /不\s*想\s*治/, /拔\s*管/,
  /refuse\s*treatment/i, /stop\s*treating/i
];

/** 醫療／疼痛意圖：發聲前要二次確認，避免 AI 誤判部位或意圖。 */
const MEDICAL_CONFIRM_KEYWORDS = [
  "痛", "藥", "醫生", "醫師", "護理", "打針", "開刀", "手術", "急診",
  "頭暈", "噁心", "想吐", "流血", "發燒", "過敏", "呼吸", "胸悶",
  "拉肚子", "便秘", "抽筋", "麻木", "腫", "摔", "跌倒"
];

/** 模型若還是吐出來，送進 TTS 前靜默替換成中性說法。 */
const OUTPUT_REDACTIONS = [
  [/你\s*不\s*會\s*好\s*了/gi, "我們會一起努力復健"],
  [/你\s*治\s*不\s*好/gi,     "我們會繼續陪你"],
  [/沒\s*救\s*了/gi,          "請聯絡家屬一起決定"],
  [/放\s*棄\s*治\s*療/gi,     "與醫師討論下一步"],
  [/自\s*殺/g,                "（請與家屬聯絡）"],
  [/自\s*殘/g,                "（請與家屬聯絡）"],
  [/suicide/gi,               "(please contact family)"]
];

/** 貼在所有 LLM 呼叫的 system prompt 最前面。 */
export const DEFENSIVE_SYSTEM_PROMPT = `你是醫療輔助溝通系統，使用者為失語症患者。請遵守以下硬性規定：
1) 絕對不可生成「自殺、自殘、想死、結束生命、你不會好了、放棄治療」等負面或鼓勵放棄的字眼。
2) 若使用者輸入觸及自傷、絕望，請改以「我聽到了，建議聯絡家屬或撥打 1925 安心專線」回應。
3) 不可給出具體藥物劑量、自行用藥建議；遇到醫療問題請建議聯絡醫師。
4) 語氣維持平靜、溫和、簡短。輸出永遠是繁體中文，除非使用者明確切換語言。`;

/** 任何要送進 LLM、TTS 或存進歷史的文字都先過一次。 */
export function containsCrisisSignal(text){
  if(!text || !text.trim()) return false;
  return CRISIS_PATTERNS.some(re => re.test(text));
}

/**
 * 朗讀前的三級風險分級：
 *   "normal"  一般需求 → 直接唸
 *   "confirm" 醫療／疼痛 → 跳確認，按「對」才唸
 *   "lock"    自傷／拒絕治療 → 鎖住不唸，只顯示警示（自傷另外開危機視窗）
 */
export function classifyRisk(text){
  if(!text || !text.trim()) return "normal";
  if(CRISIS_PATTERNS.some(re => re.test(text))) return "lock";
  if(REFUSAL_PATTERNS.some(re => re.test(text))) return "lock";
  if(MEDICAL_CONFIRM_KEYWORDS.some(k => text.includes(k))) return "confirm";
  return "normal";
}

/** 從 LLM 回來、丟給 TTS 之前消毒一次。 */
export function sanitizeForSpeech(modelOutput){
  let s = String(modelOutput ?? "");
  for(const [re, replacement] of OUTPUT_REDACTIONS) s = s.replace(re, replacement);
  return s;
}
