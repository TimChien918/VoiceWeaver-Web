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
