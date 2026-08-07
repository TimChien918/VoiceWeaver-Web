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
  // 中文
  /自\s*殺/, /自\s*殘/, /自\s*我\s*了\s*斷/,
  /想\s*死/, /不\s*想\s*活/, /活\s*不\s*下\s*去/,
  /結\s*束\s*生\s*命/, /了\s*結\s*自\s*己/,
  /跳\s*樓/, /上\s*吊/, /吞\s*藥/, /割\s*腕/,
  // 英文。原本只有 suicide / kill myself / end my life / self-harm 四條，
  // 「I want to die」這個最常見的說法整個漏掉——而介面早就支援英文了。
  /suicid/i,
  /kill\s*(myself|my\s*self)/i,
  /end\s*(my|it\s*all)\b.*\blife|end\s*it\s*all/i,
  /take\s*my\s*(own\s*)?life/i,
  /self[-\s]?harm/i, /hurt\s*myself/i, /cut\s*myself/i,
  /want\s*(to\s*)?die/i, /wanna\s*die/i,
  /(don'?t|do\s*not)\s*want\s*to\s*live/i,
  /better\s*off\s*dead/i, /hang(ing)?\s*myself/i,
  // jump\s*off 不會命中 jumping off——動名詞才是實際講法（"thinking of jumping off"）
  /jump(ing|s|ed)?\s*off/i, /overdose/i,
  // 日文
  /死\s*に\s*たい/, /消\s*え\s*たい/, /生\s*き\s*た\s*く\s*な\s*い/,
  // 韓文
  /자\s*살/, /죽\s*고\s*싶/, /살\s*기\s*싫/,
];

/** 拒絕治療類：不觸發家人通報，但同樣屬於「不可發聲」。 */
const REFUSAL_PATTERNS = [
  /拒\s*絕\s*治\s*療/, /放\s*棄\s*治\s*療/, /不\s*要\s*救\s*我/,
  /不\s*想\s*治/, /拔\s*管/,
  /refuse\s*(the\s*)?treatment/i, /stop\s*(the\s*)?treat/i,
  /give\s*up\s*(on\s*)?(treatment|therapy)/i,
  /(don'?t|do\s*not)\s*(want|need)\s*(any\s*)?(more\s*)?(treatment|therapy)/i,
  /(don'?t|do\s*not)\s*(save|resuscitate)\s*me/i,
  /\bDNR\b/i, /pull\s*the\s*(plug|tube)/i,
  /治\s*療\s*を\s*やめ/, /치\s*료\s*를?\s*그만/,
];

/** 醫療／疼痛意圖：發聲前要二次確認，避免 AI 誤判部位或意圖。 */
const MEDICAL_CONFIRM_KEYWORDS = [
  // 中文
  "痛", "藥", "醫生", "醫師", "護理", "打針", "開刀", "手術", "急診",
  "頭暈", "噁心", "想吐", "流血", "發燒", "過敏", "呼吸", "胸悶",
  "拉肚子", "便秘", "抽筋", "麻木", "腫", "摔", "跌倒",
  // 日文／韓文
  "痛い", "薬", "医者", "看護", "手術", "救急", "めまい", "吐き気",
  "아파", "약", "의사", "간호", "수술", "응급", "어지", "메스꺼",
];

/**
 * 英文的醫療關鍵字要看「整個詞」而不是子字串——`ill` 會命中 `still`、`bill`，
 * 一般句子也被逼著按確認，按到最後使用者就不看內容直接按了，那一關等於白做。
 *
 * 原本這一整條不存在：英文介面說「my chest hurts」會被判成 normal 直接唸出去，
 * 而那道確認正是為了防止 AI 把部位講錯。
 */
const MEDICAL_CONFIRM_EN =
  /\b(pain|painful|hurts?|hurting|ache|aching|sore|medicine|medication|pills?|doctor|nurse|surgery|operation|injection|shot|emergency|dizzy|nausea|nauseous|vomit|bleed|bleeding|blood|fever|allergic|allergy|breathe|breathing|chest|diarrh?ea|constipat\w*|cramp|numb|swollen|swelling|fell|fallen|fall)\b/i;

/** 模型若還是吐出來，送進 TTS 前靜默替換成中性說法。 */
const OUTPUT_REDACTIONS = [
  [/你\s*不\s*會\s*好\s*了/gi, "我們會一起努力復健"],
  [/你\s*治\s*不\s*好/gi,     "我們會繼續陪你"],
  [/沒\s*救\s*了/gi,          "請聯絡家屬一起決定"],
  [/放\s*棄\s*治\s*療/gi,     "與醫師討論下一步"],
  [/自\s*殺/g,                "（請與家屬聯絡）"],
  [/自\s*殘/g,                "（請與家屬聯絡）"],
  // 英文原本只擋 suicide 一個詞
  [/suicid\w*/gi,             "(please contact family)"],
  [/kill\s*yourself/gi,       "(please contact family)"],
  [/you\s*(will\s*)?(never|won'?t)\s*(get\s*)?(better|recover)/gi,
                              "we will work on rehab together"],
  [/there'?s\s*no\s*hope/gi,  "please talk with your family"],
  [/give\s*up\s*(on\s*)?treatment/gi, "discuss the next step with your doctor"],
];

/** 貼在所有 LLM 呼叫的 system prompt 最前面。 */
export const DEFENSIVE_SYSTEM_PROMPT = `你是醫療輔助溝通系統，使用者為失語症患者。請遵守以下硬性規定：
1) 絕對不可生成「自殺、自殘、想死、結束生命、你不會好了、放棄治療」等負面或鼓勵放棄的字眼。
2) 若「使用者本人」表達自傷、絕望，請改以「我聽到了，建議聯絡家屬或撥打 1925 安心專線」回應。
   但若使用者是在替「別人」求救或描述他人處境（例如「我朋友想自殺，快叫救護車」），
   必須忠實重組成能對外求救的句子，不可以替換成上面那句安撫語——
   使用者講不出話，這是他唯一的求救管道，擋下來會害另一個人叫不到救護車。
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
  if(MEDICAL_CONFIRM_EN.test(text)) return "confirm";
  return "normal";
}

/** 從 LLM 回來、丟給 TTS 之前消毒一次。 */
export function sanitizeForSpeech(modelOutput){
  let s = String(modelOutput ?? "");
  for(const [re, replacement] of OUTPUT_REDACTIONS) s = s.replace(re, replacement);
  return s;
}
