// 重組 / 組句：走多供應商輪詢（providers.js）。
import { runLlm, hasLlm } from "./providers.js?v=1.4.7";
import { t as tr } from "./i18n.js?v=1.4.7";   // 別名：下方備援區塊有局部變數 t，避免遮蔽
import { DEFENSIVE_SYSTEM_PROMPT } from "./safety.js?v=1.4.7";

// 第一層防禦：黏在所有 system prompt 最前面，先要求模型別生成自傷／絕望字眼。
// 這只是「請求」不是保證——真正擋住的是 app.js 的分級閘門與 speech.js 的輸出消毒。
const SYS_RECONSTRUCT =
  DEFENSIVE_SYSTEM_PROMPT + "\n\n"+
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
  '只輸出 JSON：{"reconstructed":"完整繁體中文句子","confidence":0到100整數}';

/** 取樣次數／溫度：溫度太高模型容易編出碎詞裡沒有的內容，0.3 是多樣性與忠實度的折衷。 */
const RECONSTRUCT_SAMPLES = 3;
const RECONSTRUCT_TEMP = 0.3;

function parseCoT(raw){
  const j = extractJson(raw);
  if(j){
    try{
      const o = JSON.parse(j);
      const text = (o.reconstructed||"").trim();
      if(text) return { text, confidence: Math.max(0, Math.min(100, Math.round(o.confidence ?? 70)))/100 };
    }catch(e){ /* 落到下面用純文字 */ }
  }
  const t = (raw||"").trim().replace(/\s*\n\s*/g," ");
  return t ? { text: t, confidence: 0.6 } : null;
}

/**
 * 多數決排名：把 N 次取樣依「正規化後的文字」分組去重，
 * 依票數→組內平均信心度排序，最多回 3 個候選給「換一個說法」用。
 * 三次都各說各話時退化成依信心度排序的 best-of-3，不會比只呼叫一次差。
 */
function rankBySelfConsistency(samples){
  const norm = s => s.trim().replace(/[。！!?？，,]+$/,"").trim();
  const groups = new Map();
  for(const s of samples){
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
export async function reconstruct(fragments, context){
  const u = `碎詞：${fragments}\n${context?("情境："+context):""}`.trim();
  const results = await Promise.all(
    Array.from({length: RECONSTRUCT_SAMPLES}, () =>
      runLlm(SYS_RECONSTRUCT, u, { temperature: RECONSTRUCT_TEMP })
        .then(parseCoT).catch(()=>null))
  );
  const samples = results.filter(Boolean);
  if(!samples.length) throw new Error("重組失敗");
  const ranked = rankBySelfConsistency(samples);
  return { text: ranked[0].text, confidence: ranked[0].confidence, alternatives: ranked };
}
export function composeAac(items, context){
  const sys = DEFENSIVE_SYSTEM_PROMPT + "\n\n" +
    "你是失語症患者的溝通助理。使用者用圖卡點選了一串元素，組成一句自然、口語、有禮貌的繁體中文。只輸出一句話。";
  return runLlm(sys, `圖卡序列：${items.join(" → ")}\n${context?("場景："+context):""}`.trim());
}

const SYS_REHAB_EVAL =
  "你是失語症語言治療師，評估患者的口語跟讀表現。不要用字元差異計算，要從語意傳達與流暢自然的角度判斷。\n"+
  "這是一次完全獨立的評估：只依據下面「這一次」的目標句與患者語音判分，沒有任何先前的練習、分數或對話——不得參考、比較或延續任何過去的評估。\n"+
  "評分細則：語意完整性（50%，核心意思有沒有傳達、關鍵詞有沒有說到，即使用詞稍異但意思相同可給高分）；"+
  "流暢性（30%，有無重複、結巴、語氣是否連貫自然）；語氣語調（20%，是否符合句型如問句/請求/感謝）。\n"+
  '只回傳 JSON：{"score":整數0到100,"feedback":"一句繁體中文鼓勵或指引（20字以內）","wrongChars":["說得不準或漏掉的字"]}';

function extractJson(raw){
  const c = raw.replace(/```json/g,"").replace(/```/g,"").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  return s>=0 && e>s ? c.slice(s,e+1) : null;
}

// AI 評分：回 { score, feedback, wrongChars }。失敗時退回字元相似度估算（不擲例外）。
export async function scoreRehab(target, recognized){
  const user = `目標句：${target}\n患者說出的：${recognized || "（未偵測到聲音）"}`;
  try{
    const raw = await runLlm(SYS_REHAB_EVAL, user, { temperature: 0.1, stable: true });
    const j = JSON.parse(extractJson(raw) || "{}");
    const score = Math.max(0, Math.min(100, Math.round(j.score)));
    if(Number.isFinite(score)) return { score, feedback: (j.feedback||"").trim(), wrongChars: Array.isArray(j.wrongChars)?j.wrongChars:[] };
    throw new Error("分數無效");
  }catch(e){
    // 備援：純中文字重疊比例 + 找出沒被辨識到的字
    const t = (target||"").replace(/[^一-鿿]/g,"");
    const r = (recognized||"").replace(/[^一-鿿]/g,"");
    let m = 0; const wrong = [];
    for(const ch of t){ if(r.includes(ch)) m++; else if(!wrong.includes(ch)) wrong.push(ch); }
    const score = t.length ? Math.round(m/t.length*100) : 0;
    return { score, feedback: tr("llm.fallbackFeedback"), wrongChars: wrong };
  }
}

const SYS_REHAB_SUGGEST =
  "你是失語症語言復健助理。產生 4 句適合跟讀練習的繁體中文短句（5-10 字、日常生活情境、實用）。"+
  '只回傳 JSON：{"sentences":["...","...","...","..."]}';

/**
 * 故事講評：對患者說的故事給一句鼓勵＋一個具體的下一步建議。
 *
 * 分數不交給模型算（呼叫端用關鍵字命中率算好再傳進來）——同一段話讓模型打兩次
 * 會給不同分，患者看到分數跳動會失去信心。模型只負責「講評文字」。
 */
export async function reviewStory(storyTitle, userText, score){
  const sys = "你是失語症語言治療師，正在看患者「看圖說故事」的練習。"+
    "請用繁體中文回一句話（40 字以內）：先肯定他說出來的部分，再給一個具體、"+
    "做得到的下一步建議。語氣溫暖、不說教，不要提到分數，不要條列。";
  const u = `故事主題：${storyTitle}\n患者說的：${userText}\n（系統評分：${score}/100，僅供你判斷難度，別在回覆中提到）`;
  const raw = await runLlm(sys, u);
  return (raw || "").trim().replace(/^["「]|["」]$/g, "");
}

export async function suggestRehab(){
  try{
    const raw = await runLlm(SYS_REHAB_SUGGEST, "請給適合失語症患者的中等難度練習句。");
    const j = JSON.parse(extractJson(raw) || "{}");
    const arr = (j.sentences||[]).filter(s=>s && s.trim());
    if(arr.length) return arr;
  }catch(e){ console.warn("suggestRehab", e); }
  return ["幫我倒一杯水","我想要去廁所","謝謝你的幫忙","可以開窗嗎"];
}
