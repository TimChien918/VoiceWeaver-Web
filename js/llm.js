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

// 語音復健：請 LLM 產生「跟讀練習」情境句（易→難、貼近日常）。回傳字串陣列。
export async function suggestRehabSentences(){
  const sys =
    "你是語言治療師，為失語症患者設計『跟讀練習句』。產生 6 句難度由易到難、"+
    "貼近日常情境（用餐、就醫、購物、在家、外出、社交各一）的繁體中文短句，"+
    "每句 4–14 字、口語、可直接朗讀。只輸出 JSON 字串陣列，"+
    "例：[\"我想喝水\",\"請幫我開門\"]，不要任何其他文字或編號。";
  const out = await runLlm(sys, "請產生 6 句。");
  try{
    const m = out.match(/\[[\s\S]*\]/);
    const a = JSON.parse(m ? m[0] : out);
    if(Array.isArray(a)) return a.map(String).map(s=>s.trim()).filter(Boolean).slice(0,8);
  }catch{}
  // 不是 JSON → 逐行切，去掉編號/標點/引號
  return out.split(/\n+/).map(s=>s.replace(/^[\d.、)\-\s"「」']+/,"").trim()).filter(Boolean).slice(0,8);
}
