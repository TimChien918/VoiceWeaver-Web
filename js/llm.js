// 重組 / 組句：走多供應商輪詢（providers.js）。
import { runLlm, hasLlm } from "./providers.js";

const SYS_RECONSTRUCT =
  "你是失語症患者的溝通助理。把使用者給的碎詞（可能還有地點、看到的物品）組成一句自然、口語、有禮貌的"+
  "話。規則：只輸出一句話、不要解釋、不要引號；不要憑空加入沒提到的東西；有強烈意圖（如求救）語氣要清楚但不誇張。";

export function hasAnyLlmKey(){ return hasLlm(); }

export function reconstruct(fragments, context){
  const u = `碎詞：${fragments}\n${context?("情境："+context):""}`.trim();
  return runLlm(SYS_RECONSTRUCT, u);
}
export function composeAac(items, context){
  const sys = "你是失語症患者的溝通助理。使用者用圖卡點選了一串元素，組成一句自然、口語、有禮貌的繁體中文。只輸出一句話。";
  return runLlm(sys, `圖卡序列：${items.join(" → ")}\n${context?("場景："+context):""}`.trim());
}

const SYS_REHAB_EVAL =
  "你是失語症語言治療師，評估患者的口語跟讀表現。不要用字元差異計算，要從語意傳達與流暢自然的角度判斷。\n"+
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
    const raw = await runLlm(SYS_REHAB_EVAL, user);
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
    return { score, feedback: "（AI 評分暫不可用，改用相似度估算）", wrongChars: wrong };
  }
}

const SYS_REHAB_SUGGEST =
  "你是失語症語言復健助理。產生 4 句適合跟讀練習的繁體中文短句（5-10 字、日常生活情境、實用）。"+
  '只回傳 JSON：{"sentences":["...","...","...","..."]}';

export async function suggestRehab(){
  try{
    const raw = await runLlm(SYS_REHAB_SUGGEST, "請給適合失語症患者的中等難度練習句。");
    const j = JSON.parse(extractJson(raw) || "{}");
    const arr = (j.sentences||[]).filter(s=>s && s.trim());
    if(arr.length) return arr;
  }catch(e){ console.warn("suggestRehab", e); }
  return ["幫我倒一杯水","我想要去廁所","謝謝你的幫忙","可以開窗嗎"];
}
