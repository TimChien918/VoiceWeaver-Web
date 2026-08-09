// 重組 / 組句：走多供應商輪詢（providers.js）。
import { runLlm, hasLlm } from "./providers.js?v=1.5.48";
import { t as tr } from "./i18n.js?v=1.5.48";   // 別名：下方備援區塊有局部變數 t，避免遮蔽
import { DEFENSIVE_SYSTEM_PROMPT } from "./safety.js?v=1.5.48";
import { toTraditionalSync } from "./zhconv.js?v=1.5.48";

// 第一層防禦：黏在所有 system prompt 最前面，先要求模型別生成自傷／絕望字眼。
// 這只是「請求」不是保證——真正擋住的是 app.js 的分級閘門與 speech.js 的輸出消毒。
// 提示詞主體維持中文（模型對中文指令的遵從度實測比較穩），但「輸出什麼語言」
// 必須在執行期才決定，所以改成函式而不是常數——英文介面的使用者打英文碎詞，
// 唸出來卻是中文，就是因為這裡以前寫死了中文範例、又沒講輸出語言。
// 提示詞主體**用目標語言寫**，不是「中文指示 ＋ 最後補一句用英文回答」。
//
// 後者實測壓不住：整段規則是中文的，模型就整段跟著中文走——英文介面打英文碎詞，
// 三個候選回來兩個是中文。加指令沒有用，那是機率性的；把指示本身換成該語言才有效。
// 中文介面維持中文版（原本就正確，而且措辭是調過的）。
const RECONSTRUCT_RULES_ZH =
  "你是輔助失語症患者溝通的語言助理。請用碎詞、地點與看到的物品，重組患者最可能想表達的句子。\n"+
  "\n【最重要的原則：貼著碎詞走，不要腦補新內容】\n"+
  "句子裡每個實詞（名詞、動詞、形容詞）都必須能對應回碎詞本身，或明確對應到給定的地點／物件情境；\n"+
  "你只能補上讓句子成立所需的「語法零件」——代名詞（我、你）、助動詞（請、需要、想）、語助詞（了、嗎、呢）——\n"+
  "不可以新增碎詞裡完全沒提到的新事件、新時間、新對象或新問句。\n"+
  "例如碎詞「家人...快」只代表「家人動作要快」，應重組成「請家人快一點」這類貼近原意的句子；\n"+
  "不可以延伸成「我想知道家人什麼時候會到」——那是碎詞裡沒有的全新問句，屬於過度腦補。\n"+
  "\n輸入中的問句或疑問詞是硬約束，必須保留其語意；例如「什麼時候」「在哪裡」「可以嗎」「要等多久」不可刪掉。\n"+
  "碎詞很短甚至只有一個字（例如「十」「水」「痛」）時，仍要給出最可能的日常說法，不要拒答或回空句；\n"+
  "只補最貼近字面的語法零件：「水」→「我想喝水」、「痛」→「我這裡會痛」。\n"+
  "\nconfidence 是你對這句重組的把握（0-100）：80-100＝幾乎確定；50-79＝碎詞短或有歧義但給了合理猜測；1-49＝真的看不出想表達什麼。\n"+
  "\n只輸出 JSON：\n"+
  '{"candidates":[{"text":"最有把握的說法","confidence":0到100整數},{"text":"另一種說法","confidence":0到100整數},{"text":"再一種說法","confidence":0到100整數}]}\n'+
  "candidates 一定要給滿 3 個，而且要是真的不同的講法（用詞、語氣或詳略不同），\n"+
  "不可以只改標點或語助詞充數——使用者要從這 3 句裡挑一句講出去，三句一樣等於沒得挑。\n"+
  "每一句都必須遵守上面「貼著碎詞走、不腦補」的規則。第一句放你最有把握的。";

const RECONSTRUCT_RULES_EN =
  "You help a person with aphasia communicate. From their fragments, plus the place they are in and the objects they can see, reconstruct the sentence they most likely mean.\n"+
  "\nMOST IMPORTANT RULE: stay on the fragments. Do not invent content.\n"+
  "Every content word (noun, verb, adjective) in your sentence must trace back to a fragment, or to the given place/object context.\n"+
  "You may only add the grammatical glue needed to make it a sentence — pronouns, auxiliaries (please, need, want), articles and particles.\n"+
  "Never add a new event, time, person or question that the fragments did not mention.\n"+
  "Example: fragments \"family ... quick\" mean the family should hurry, so write \"Please tell my family to hurry.\"\n"+
  "Do NOT stretch it into \"I want to know when my family will arrive\" — that is a new question the fragments never contained.\n"+
  "\nQuestions and question words in the input are hard constraints and must survive: when, where, may I, how long.\n"+
  "When the fragments are very short, even a single word (\"ten\", \"water\", \"pain\"), still give the most likely everyday sentence. Never refuse and never return an empty string.\n"+
  "Add only the closest possible glue: \"water\" -> \"I would like some water.\", \"pain\" -> \"It hurts here.\"\n"+
  "\nconfidence is how sure you are (0-100): 80-100 = almost certain; 50-79 = short or ambiguous fragments but a reasonable guess; 1-49 = you genuinely cannot tell what they mean.\n"+
  "\nOutput JSON only:\n"+
  '{"candidates":[{"text":"the reading you are most sure of","confidence":0-100},{"text":"another way to say it","confidence":0-100},{"text":"a third way","confidence":0-100}]}\n'+
  "Always give exactly 3 candidates, and make them genuinely different (different wording, tone, or level of detail).\n"+
  "Do not pad the list by changing only punctuation — the user has to pick one of these 3 to say out loud, so three identical ones leave them no choice.\n"+
  "Every candidate must obey the \"stay on the fragments\" rule above. Put the one you are most sure of first.";

const sysReconstruct = () =>
  DEFENSIVE_SYSTEM_PROMPT + "\n\n"+
  // 語言指令放最前面，用目標語言自己寫（recency 之外再加 primacy）
  outputLanguageDirective("candidates[].text") + "\n\n" +
  (curLang() === "zh" ? RECONSTRUCT_RULES_ZH : RECONSTRUCT_RULES_EN) + "\n" +
  // 日／韓：規則用英文寫（比中文不容易把輸出拉去中文），語言指令再壓一次
  "\n" + outputLanguageDirective("candidates[].text");

/** 取樣次數／溫度：溫度太高模型容易編出碎詞裡沒有的內容，0.3 是多樣性與忠實度的折衷。 */
const RECONSTRUCT_SAMPLES = 3;
const RECONSTRUCT_TEMP = 0.3;

const clamp01 = c => Math.max(0, Math.min(100, Math.round(c ?? 70)))/100;
// 雲端模型就算 prompt 明寫繁體還是會偶爾漏簡體字（實測組出「請去医院」），
// 在解析出口統一轉一次，所有候選句都涵蓋。
// 只在中文介面轉——英／日／韓的輸出裡本來就不該有簡體字要修，
// 而日文漢字若被當成簡體字硬轉會被改壞。
const zh = s => (curLang() === "zh" ? toTraditionalSync(s) : s);

/** @returns {{text:string, confidence:number, alternatives:Array<{text,confidence}>}|null} */
function parseCoT(raw){
  const j = extractJson(raw);
  if(j){
    try{
      const o = JSON.parse(j);
      // 新版格式：一次回 3 種講法
      const list = (o.candidates||[])
        .map(c=>({ text: zh(String(c?.text??"").trim()), confidence: clamp01(c?.confidence) }))
        .filter(c=>c.text);
      if(list.length) return { ...list[0], alternatives: list.slice(1) };
      // 舊版格式：單一 reconstructed
      const text = zh((o.reconstructed||"").trim());
      if(text) return { text, confidence: clamp01(o.confidence), alternatives: [] };
    }catch(e){ /* 落到下面搶救 */ }
  }
  // JSON 壞掉或被截斷。先從殘缺文字裡撈句子；撈不到寧可回 null，
  // 不要把整包 JSON 當成句子——病人畫面會出現 {"reasoning":… 還被當成可以唸的話。
  const m = String(raw??"").match(/"(?:text|reconstructed)"\s*:\s*"((?:[^"\\]|\\.)*)/);
  const salvaged = m && m[1].replace(/\\"/g,'"').replace(/\\n/g,"\n").trim();
  if(salvaged) return { text: zh(salvaged), confidence: 0.6, alternatives: [] };
  const t = String(raw??"").trim().replace(/\s*\n\s*/g," ");
  if(!t || t.startsWith("{") || t.includes('"candidates"') || t.includes('"reasoning"')) return null;
  return { text: zh(t), confidence: 0.6, alternatives: [] };
}

/**
 * 多數決排名：把 N 次取樣依「正規化後的文字」分組去重，
 * 依票數→組內平均信心度排序，最多回 3 個候選給「換一個說法」用。
 * 三次都各說各話時退化成依信心度排序的 best-of-3，不會比只呼叫一次差。
 */
function rankBySelfConsistency(samples){
  const norm = s => s.trim().replace(/[。！!?？，,]+$/,"").trim();
  // 把每次取樣的「主句 + 同一次回應裡的其他講法」全部攤平：3 次取樣 × 3 句 = 最多 9 個。
  // 只用主句去重，在模型講得一致時會塌成 1 個候選，使用者就沒得挑。
  // 跨取樣重複出現的句子仍因票數較高而排前面，自我一致性的意義沒有丟。
  const flat = samples.flatMap(s => [{ text:s.text, confidence:s.confidence }, ...(s.alternatives||[])])
                      .filter(c => c.text);
  const groups = new Map();
  for(const s of flat){
    const k = norm(s.text);
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return [...groups.values()]
    .map(g => {
      const rep = g.reduce((a,b)=> b.confidence>a.confidence ? b : a);
      const avg = g.reduce((sum,x)=>sum+x.confidence,0)/g.length;
      return { votes: g.length, text: rep.text, confidence: avg };
    })
    .sort((a,b)=> b.votes-a.votes || b.confidence-a.confidence)
    .slice(0,3)
    .map(({text,confidence})=>({text,confidence}));
}

export function hasAnyLlmKey(){ return hasLlm(); }

/**
 * 重組句子。自我一致性：同一份碎詞平行取樣 N 次，用多數決挑最一致的結果，
 * 比單次呼叫更抗模型偶發幻覺。平行送出，總延遲不會變成 N 倍。
 * @returns {Promise<{text:string, confidence:number, alternatives:Array<{text,confidence}>}>}
 */
/**
 * 這句話的文字系統符不符合目標語言。
 *
 * 提示詞管不住模型——它是機率性的，而且整段指示是中文寫的，本來就會往中文偏。
 * 所以出口再擋一次：語言不對的候選句直接丟掉。使用者看到看不懂的語言，
 * 比少一個候選嚴重得多——那三句是要拿去對別人講出口的。
 */
function scriptMatches(text, lang){
  const t = String(text || "");
  if(!t.trim()) return false;
  const kana   = /[\u3040-\u309f\u30a0-\u30ff]/.test(t);
  const hangul = /[\uac00-\ud7af\u1100-\u11ff]/.test(t);
  const han    = /[\u4e00-\u9fff]/.test(t);
  switch(lang){
    case "en": return !kana && !hangul && !han;      // 英文句子不該出現任何漢字假名諺文
    case "ja": return kana || (han && !hangul);      // 日文一定有假名；純漢字也接受
    case "ko": return hangul;                        // 韓文一定有諺文
    default:   return han && !kana && !hangul;       // 中文要有漢字，且不能混假名諺文
  }
}

export async function reconstruct(fragments, context){
  const u = `碎詞：${fragments}\n${context?("情境："+context):""}`.trim();
  const results = await Promise.all(
    Array.from({length: RECONSTRUCT_SAMPLES}, () =>
      runLlm(sysReconstruct(), u, { temperature: RECONSTRUCT_TEMP })
        .then(parseCoT).catch(()=>null))
  );
  const samples = results.filter(Boolean);
  // 這個 message 會被 app.js toast 出來給使用者看，所以不能寫死中文——
  // 英文介面的人重組失敗時會收到一句他看不懂的中文。
  if(!samples.length) throw new Error(tr("toast.reconstructFail"));
  let ranked = rankBySelfConsistency(samples);

  // 出口把關：語言不對的丟掉。全部都不對時寧可留著也不要空白——
  // 語言錯的句子還能靠使用者自己看出來，一個候選都沒有他就完全無法溝通。
  const want = curLang();
  const kept = ranked.filter(c => scriptMatches(c.text, want));
  if(kept.length) ranked = kept;
  else console.warn("[llm] 候選句語言全部不符（想要 " + want + "），保留原樣", ranked.map(c=>c.text));

  return { text: ranked[0].text, confidence: ranked[0].confidence, alternatives: ranked };
}
/**
 * 危機語句的意圖分流：這句話裡「想自傷的是誰」。
 *
 * 為什麼需要：關鍵字比對分不出「我想自殺」和「我朋友想自殺，快叫救護車」。
 * 後者是替別人求救，擋下來等於害死另一個人——而講不出話的人沒有別的管道求救。
 *
 * 刻意「不」掛 DEFENSIVE_SYSTEM_PROMPT：那條 prompt 要模型迴避這類字眼，
 * 掛上去反而讓它拒答分類任務。這裡是分類、不是生成，明講用途讓模型願意回答。
 *
 * @returns {Promise<"self"|"other"|"none"|null>} null＝判斷失敗（沒網路／拒答）
 */
export async function classifyCrisisIntent(text){
  const sys =
    "你是醫療輔助溝通系統的安全分類器。判斷句子裡「想自傷或輕生的是誰」。\n"+
    "只輸出 JSON，不要解釋、不要加註、不要拒答：{\"who\":\"self\"}\n"+
    "self ＝說話者本人想自傷／輕生。\n"+
    "other＝說話者在描述別人的狀況或替別人求救，例如「我朋友想自殺，快叫救護車」。\n"+
    "none ＝只是提到這個詞，沒有人正處於危險，例如詢問防治專線電話、轉述新聞。\n"+
    "這是失語症患者的求救分流：判成 self 會鎖住他的語音，判錯會讓替人求救的人叫不到救護車。請務必分類。";
  const raw = await runLlm(sys, text, { temperature: 0 });
  const m = String(raw ?? "").match(/"who"\s*:\s*"(self|other|none)"/i);
  return m ? m[1].toLowerCase() : null;
}

export function composeAac(items, context){
  const sys = DEFENSIVE_SYSTEM_PROMPT + "\n\n" +
    `你是失語症患者的溝通助理。使用者用圖卡點選了一串元素，組成一句自然、口語、有禮貌的${outLang()}。只輸出一句話。\n` +
    outputLanguageDirective("回覆");
  return runLlm(sys, `圖卡序列：${items.join(" → ")}\n${context?("場景："+context):""}`.trim()).then(zh);
}

/**
 * 提示詞維持中文（模型對中文指令的遵從度實測比較穩），只把「要用哪種語言回覆」
 * 抽出來——英文介面的使用者練英文句子，評語不該跳出中文。
 */
const LANG_NAME = { "zh-TW":"繁體中文", "en":"英文", "ja":"日文", "ko":"韓文" };
/** 目前介面語言的短碼（zh / en / ja / ko）。 */
function curLang(){
  return (document.documentElement.getAttribute("data-lang") || "zh-TW").split("-")[0];
}
function outLang(){
  const L = document.documentElement.getAttribute("data-lang") || "zh-TW";
  return LANG_NAME[L] || LANG_NAME[L.split("-")[0]] || LANG_NAME["zh-TW"];
}

/**
 * 給 LLM 的輸出語言硬性指令，**用目標語言本身寫**。
 *
 * 為什麼不能只靠 outLang()：提示詞主體是中文，模型看到夾在中文句子裡的
 * 「用英文回答」很容易整段跟著中文走。用該語言自己的祈使句寫，模型才會照做；
 * 放在提示詞最後一行（recency）效果最穩。與 App 的 I18n.outputLanguageDirective 同一招。
 */
export function outputLanguageDirective(field){
  switch(curLang()){
    case "en": return `IMPORTANT: the "${field}" value MUST be written in English.`;
    case "ja": return `重要：「${field}」の値は必ず日本語で書いてください。`;
    case "ko": return `중요: "${field}" 값은 반드시 한국어로 작성하세요.`;
    default:   return `重要：「${field}」的內容必須用繁體中文書寫。`;
  }
}

function sysRehabEval(){
  return "你是失語症語言治療師，評估患者的口語跟讀表現。不要用字元差異計算，要從語意傳達與流暢自然的角度判斷。\n"+
  "這是一次完全獨立的評估：只依據下面「這一次」的目標句與患者語音判分，沒有任何先前的練習、分數或對話——不得參考、比較或延續任何過去的評估。\n"+
  "評分細則：語意完整性（50%，核心意思有沒有傳達、關鍵詞有沒有說到，即使用詞稍異但意思相同可給高分）；"+
  "流暢性（30%，有無重複、結巴、語氣是否連貫自然）；語氣語調（20%，是否符合句型如問句/請求/感謝）。\n"+
  `只回傳 JSON：{"score":整數0到100,"feedback":"一句${outLang()}鼓勵或指引（20字以內）","wrongChars":["說得不準或漏掉的字或詞"]}`;
}

function extractJson(raw){
  const c = raw.replace(/```json/g,"").replace(/```/g,"").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  return s>=0 && e>s ? c.slice(s,e+1) : null;
}

// AI 評分：回 { score, feedback, wrongChars }。失敗時退回字元相似度估算（不擲例外）。
export async function scoreRehab(target, recognized){
  const user = `目標句：${target}\n患者說出的：${recognized || "（未偵測到聲音）"}`;
  try{
    const raw = await runLlm(sysRehabEval(), user, { temperature: 0.1, stable: true });
    const j = JSON.parse(extractJson(raw) || "{}");
    const score = Math.max(0, Math.min(100, Math.round(j.score)));
    if(Number.isFinite(score)) return { score, feedback: (j.feedback||"").trim(), wrongChars: Array.isArray(j.wrongChars)?j.wrongChars:[] };
    throw new Error("分數無效");
  }catch(e){
    // 備援（沒金鑰或 LLM 掛掉時）：重疊比例 + 找出沒被辨識到的部分。
    // 中文按「字」比、拉丁語言按「詞」比——英文題目若照中文那樣先濾掉非漢字，
    // 目標句會變成空字串，分數會永遠是 0。
    const hasHan = /[一-鿿]/.test(target||"");
    const units = str => hasHan
      ? [...(str||"").replace(/[^一-鿿]/g,"")]
      : (str||"").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu," ").split(/\s+/).filter(Boolean);
    const t = units(target), r = units(recognized);
    let m = 0; const wrong = [];
    for(const u of t){ if(r.includes(u)) m++; else if(!wrong.includes(u)) wrong.push(u); }
    const score = t.length ? Math.round(m/t.length*100) : 0;
    return { score, feedback: tr("llm.fallbackFeedback"), wrongChars: wrong };
  }
}

function sysRehabSuggest(){
  return `你是失語症語言復健助理。產生 4 句適合跟讀練習的${outLang()}短句（長度相當於中文 5-10 字、日常生活情境、實用）。`+
  '只回傳 JSON：{"sentences":["...","...","...","..."]}';
}

/**
 * 故事講評：對患者說的故事給一句鼓勵＋一個具體的下一步建議。
 *
 * 分數不交給模型算（呼叫端用關鍵字命中率算好再傳進來）——同一段話讓模型打兩次
 * 會給不同分，患者看到分數跳動會失去信心。模型只負責「講評文字」。
 */
export async function reviewStory(storyTitle, userText, score){
  const sys = "你是失語症語言治療師，正在看患者「看圖說故事」的練習。"+
    `請用${outLang()}回一句話（40 字以內）：先肯定他說出來的部分，再給一個具體、`+
    "做得到的下一步建議。語氣溫暖、不說教，不要提到分數，不要條列。\n"+
    outputLanguageDirective("回覆");
  const u = `故事主題：${storyTitle}\n患者說的：${userText}\n（系統評分：${score}/100，僅供你判斷難度，別在回覆中提到）`;
  const raw = await runLlm(sys, u);
  return (raw || "").trim().replace(/^["「]|["」]$/g, "");
}

export async function suggestRehab(){
  try{
    const raw = await runLlm(sysRehabSuggest(), "請給適合失語症患者的中等難度練習句。");
    const j = JSON.parse(extractJson(raw) || "{}");
    const arr = (j.sentences||[]).filter(s=>s && s.trim());
    if(arr.length) return arr;
  }catch(e){ console.warn("suggestRehab", e); }
  // LLM 不可用時的離線備援，跟著介面語言走
  const L = (document.documentElement.getAttribute("data-lang") || "zh-TW").split("-")[0];
  return ({
    en: ["Please pour me a glass of water","I would like to go to the toilet","Thank you for your help","Could you open the window"],
    ja: ["水を一杯ください","トイレに行きたいです","手伝ってくれてありがとう","窓を開けてもらえますか"],
    ko: ["물 한 잔 주세요","화장실에 가고 싶어요","도와줘서 고마워요","창문을 열어 주시겠어요"],
  })[L] || ["幫我倒一杯水","我想要去廁所","謝謝你的幫忙","可以開窗嗎"];
}
