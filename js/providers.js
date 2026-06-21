// 供應商目錄 + 呼叫器（同供應商可多把金鑰、可多選供應商，自動輪詢+備援）。
import { state } from "./store.js";

// 文字 LLM 供應商（標 cors 者較可能可在瀏覽器直接呼叫）
export const LLM_PROVIDERS = {
  gemini:     { label:"Google Gemini",  needsKey:true,  model:"gemini-2.0-flash" },
  groq:       { label:"Groq",           needsKey:true,  model:"llama-3.3-70b-versatile" },
  openrouter: { label:"OpenRouter",     needsKey:true,  model:"google/gemini-2.0-flash-exp:free" },
  deepseek:   { label:"DeepSeek",       needsKey:true,  model:"deepseek-chat" },
  mistral:    { label:"Mistral",        needsKey:true,  model:"mistral-small-latest" },
  together:   { label:"Together",       needsKey:true,  model:"meta-llama/Llama-3.3-70B-Instruct-Turbo-Free" },
  cohere:     { label:"Cohere",         needsKey:true,  model:"command-r-08-2024" },
  openai:     { label:"OpenAI",         needsKey:true,  model:"gpt-4o-mini" },
};
const OPENAI_BASE = {
  groq:"https://api.groq.com/openai/v1", openrouter:"https://openrouter.ai/api/v1",
  deepseek:"https://api.deepseek.com/v1", mistral:"https://api.mistral.ai/v1",
  together:"https://api.together.xyz/v1", openai:"https://api.openai.com/v1",
};

// 生圖供應商
export const IMAGE_PROVIDERS = {
  pollinations:{ label:"Pollinations（免金鑰）", needsKey:false },
  gemini:      { label:"Gemini Imagen",          needsKey:true },
  huggingface: { label:"HuggingFace",            needsKey:true, model:"black-forest-labs/FLUX.1-schnell" },
  openai:      { label:"OpenAI (gpt-image-1)",   needsKey:true },
};

let _rot = 0;
function rotate(list){ if(list.length<=1) return list; const o=_rot++%list.length; return list.slice(o).concat(list.slice(0,o)); }

// ── LLM 文字 ────────────────────────────────────────
async function geminiText(entry, sys, user){
  const model = entry.model || LLM_PROVIDERS.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(entry.key)}`;
  const r = await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ system_instruction:{parts:[{text:sys}]}, contents:[{parts:[{text:user}]}],
      generationConfig:{ temperature:0.5, maxOutputTokens:120 } }) });
  if(!r.ok) throw new Error("Gemini "+r.status);
  const j = await r.json(); return (j.candidates?.[0]?.content?.parts?.[0]?.text||"").trim();
}
async function openaiText(entry, sys, user){
  const base = OPENAI_BASE[entry.provider]; const model = entry.model || LLM_PROVIDERS[entry.provider].model;
  const r = await fetch(base+"/chat/completions",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model, temperature:0.5, max_tokens:120,
      messages:[{role:"system",content:sys},{role:"user",content:user}] }) });
  if(!r.ok) throw new Error(entry.provider+" "+r.status);
  const j = await r.json(); return (j.choices?.[0]?.message?.content||"").trim();
}
async function cohereText(entry, sys, user){
  const r = await fetch("https://api.cohere.com/v2/chat",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model: entry.model||LLM_PROVIDERS.cohere.model,
      messages:[{role:"system",content:sys},{role:"user",content:user}], temperature:0.5 }) });
  if(!r.ok) throw new Error("Cohere "+r.status);
  const j = await r.json(); return (j.message?.content?.[0]?.text||"").trim();
}
function llmEntries(){
  // 只留 web 支援的供應商（手機可能同步來 web 沒有的，如 cerebras → 跳過不報錯）
  return (state.llmApis||[]).filter(e=>e.provider && LLM_PROVIDERS[e.provider] && (e.key || !LLM_PROVIDERS[e.provider].needsKey));
}
export function hasLlm(){ return llmEntries().length>0; }
export async function runLlm(sys, user){
  const list = rotate(llmEntries());
  if(!list.length) throw new Error("尚未新增任何文字供應商（設定頁）");
  let err;
  for(const e of list){
    try{
      const fn = e.provider==="gemini"?geminiText : e.provider==="cohere"?cohereText : openaiText;
      const out = await fn(e, sys, user);
      if(out) return out.replace(/^[「"']|[」"']$/g,"").trim();
    }catch(x){ err=x; console.warn(e.provider, x); }
  }
  throw err || new Error("所有供應商都失敗");
}

// ── 生圖 ────────────────────────────────────────────
function imageEntries(){
  const list = (state.imageApis||[]).filter(e=>e.provider && IMAGE_PROVIDERS[e.provider] && (e.key || !IMAGE_PROVIDERS[e.provider].needsKey));
  // 永遠保底有 Pollinations（免金鑰）
  if(!list.some(e=>e.provider==="pollinations")) list.push({ provider:"pollinations", key:"" });
  return list;
}
export async function runImage(prompt){
  for(const e of rotate(imageEntries())){
    try{
      if(e.provider==="pollinations")
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
      if(e.provider==="gemini"){
        const url=`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(e.key)}`;
        const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ instances:[{prompt}], parameters:{sampleCount:1} })});
        if(!r.ok) throw 0; const j=await r.json(); const b64=j.predictions?.[0]?.bytesBase64Encoded;
        if(b64) return "data:image/png;base64,"+b64;
      }
      if(e.provider==="huggingface"){
        const r=await fetch(`https://router.huggingface.co/hf-inference/models/${e.model||IMAGE_PROVIDERS.huggingface.model}`,
          {method:"POST",headers:{"Authorization":"Bearer "+e.key,"Content-Type":"application/json"},body:JSON.stringify({inputs:prompt})});
        if(!r.ok) throw 0; const blob=await r.blob(); return URL.createObjectURL(blob);
      }
      if(e.provider==="openai"){
        const r=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",
          headers:{"Authorization":"Bearer "+e.key,"Content-Type":"application/json"},
          body:JSON.stringify({model:"gpt-image-1",prompt,size:"512x512"})});
        if(!r.ok) throw 0; const j=await r.json(); const b64=j.data?.[0]?.b64_json;
        if(b64) return "data:image/png;base64,"+b64;
      }
    }catch(x){ console.warn("image",e.provider,x); }
  }
  // 全部失敗 → 退 Pollinations
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
}
