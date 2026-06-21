// 純 API 的 LLM 重組：Gemini / Groq / OpenRouter，依設定自動輪詢備援（瀏覽器可跨域的供應商）。
import { state } from "./store.js";

const SYS_RECONSTRUCT =
  "你是失語症患者的溝通助理。把使用者給的碎詞（可能還有地點、看到的物品）組成一句自然、口語、有禮貌的"+
  "話。規則：只輸出一句話、不要解釋、不要引號；不要憑空加入沒提到的東西；有強烈意圖（如求救）語氣要清楚但不誇張。";

async function callGemini(key, sys, user){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ system_instruction:{ parts:[{text:sys}] }, contents:[{ parts:[{text:user}] }],
      generationConfig:{ temperature:0.5, maxOutputTokens:120 } }) });
  if(!r.ok) throw new Error("Gemini "+r.status);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}
async function callOpenAIish(base, key, model, sys, user){
  const r = await fetch(base+"/chat/completions", { method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+key },
    body: JSON.stringify({ model, temperature:0.5, max_tokens:120,
      messages:[{role:"system",content:sys},{role:"user",content:user}] }) });
  if(!r.ok) throw new Error(model+" "+r.status);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || "").trim();
}

function providersInOrder(){
  const k = state.apiKeys, pref = state.settings.provider;
  const all = [];
  if(k.gemini)     all.push(["gemini", (s,u)=>callGemini(k.gemini,s,u)]);
  if(k.groq)       all.push(["groq",   (s,u)=>callOpenAIish("https://api.groq.com/openai/v1", k.groq, "llama-3.3-70b-versatile", s,u)]);
  if(k.openrouter) all.push(["openrouter",(s,u)=>callOpenAIish("https://openrouter.ai/api/v1", k.openrouter, "google/gemini-2.0-flash-exp:free", s,u)]);
  if(pref!=="auto"){ const hit=all.find(p=>p[0]===pref); if(hit) return [hit, ...all.filter(p=>p!==hit)]; }
  return all;
}

export function hasAnyLlmKey(){ return providersInOrder().length>0; }

async function run(sys, user){
  const list = providersInOrder();
  if(!list.length) throw new Error("尚未填入任何重組用的 API 金鑰（設定頁）");
  let lastErr;
  for(const [name, fn] of list){
    try{ const out = await fn(sys,user); if(out) return out.replace(/^[「"']|[」"']$/g,"").trim(); }
    catch(e){ lastErr = e; console.warn(name, e); }
  }
  throw lastErr || new Error("所有供應商都失敗");
}

export function reconstruct(fragments, context){
  const u = `碎詞：${fragments}\n${context?("情境："+context):""}`.trim();
  return run(SYS_RECONSTRUCT, u);
}
export function composeAac(items, context){
  const sys = "你是失語症患者的溝通助理。使用者用圖卡點選了一串元素，組成一句自然、口語、有禮貌的繁體中文。只輸出一句話。";
  return run(sys, `圖卡序列：${items.join(" → ")}\n${context?("場景："+context):""}`.trim());
}
