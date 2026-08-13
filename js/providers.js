// 供應商目錄 + 呼叫器（同供應商可多把金鑰、可多選供應商，自動輪詢+備援）。
import { state } from "./store.js?v=1.5.68";
import { localHas, localText, localImage } from "./localtts.js?v=1.5.68";
import { sharedEntries, countSharedUse } from "./shared.js?v=1.5.68";
import { webgpuUsable, webgpuGenerate } from "./webgpu.js?v=1.5.68";
import { t } from "./i18n.js?v=1.5.68";

// 文字 LLM 供應商（標 cors 者較可能可在瀏覽器直接呼叫）
//
// pollinations 免金鑰，而且**永遠排在最後當保底**（見 llmEntries）：
// 沒有它的話，一個還沒貼金鑰的人按下重組只會看到「沒有可用的供應商」——
// 對照顧者而言那等於 App 是壞的。有它，打開就能講話；品質不如 Gemini，
// 但「有一句可以用的話」跟「什麼都沒有」是兩回事。
export const LLM_PROVIDERS = {
  pollinations:{ label:"Pollinations", labelKey:"prov.pollinationsFree", needsKey:false, model:"openai" },
  gemini:     { label:"Google Gemini", labelKey:"prov.geminiKey", needsKey:true, model:"gemini-3.5-flash" },
  groq:       { label:"Groq",           needsKey:true,  model:"qwen/qwen3.6-27b" },
  openrouter: { label:"OpenRouter",     needsKey:true,  model:"qwen/qwen3-14b" },
  deepseek:   { label:"DeepSeek",       needsKey:true,  model:"deepseek-chat" },
  mistral:    { label:"Mistral",        needsKey:true,  model:"mistral-small-latest" },
  together:   { label:"Together",       needsKey:true,  model:"meta-llama/Llama-3.3-70B-Instruct-Turbo-Free" },
  cohere:     { label:"Cohere",         needsKey:true,  model:"command-r-08-2024" },
  openai:     { label:"OpenAI",         needsKey:true,  model:"gpt-4o-mini" },
  // Cloudflare Workers AI。走它的 OpenAI 相容端點，所以沿用 openaiText 那一支。
  // needsAccount：它的網址裡有帳戶 ID，光有權杖打不到——設定頁會多一格給它填。
  cloudflare: { label:"Cloudflare Workers AI", needsKey:true, needsAccount:true,
                model:"@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
};
const OPENAI_BASE = {
  groq:"https://api.groq.com/openai/v1", openrouter:"https://openrouter.ai/api/v1",
  deepseek:"https://api.deepseek.com/v1", mistral:"https://api.mistral.ai/v1",
  together:"https://api.together.xyz/v1", openai:"https://api.openai.com/v1",
};

// 生圖供應商
export const IMAGE_PROVIDERS = {
  pollinations:{ label:"Pollinations", needsKey:false },
  gemini:      { label:"Gemini Imagen", labelKey:"prov.geminiImgKey", needsKey:true },
  huggingface: { label:"HuggingFace",            needsKey:true, model:"black-forest-labs/FLUX.1-schnell" },
  openai:      { label:"OpenAI (gpt-image-1)",   needsKey:true },
};

// 語音合成供應商（雲端 TTS）。
//
// 這一層擺在「專屬聲音（GPT-SoVITS）」與「瀏覽器內建語音」之間：
//   專屬聲音   —— 是使用者本人／家人的音色，有的話永遠優先，那是整個功能的意義所在，
//                 但要電腦或 Colab 開著。
//   雲端 TTS   —— 這一層。電腦沒開時的「好聽的聲音」。
//   瀏覽器語音 —— 永遠的保底，免金鑰、零延遲，出得了聲最重要。
//
// 沒有 pollinations 那種免金鑰保底項：瀏覽器內建語音本來就是保底，不必在清單裡再放一個。
export const TTS_PROVIDERS = {
  gemini:      { label:"Gemini TTS", labelKey:"prov.geminiTtsKey", needsKey:true, model:TTS_MODEL_DEFAULT() },
};
// 函式而不是常數：TTS_PROVIDERS 是模組載入時就求值的，寫在它上面才看得到。
//
// gemini-2.5-flash-preview-tts 是上一代（Google 的文件已標成 Legacy）。
// 現行的是 3.1：70+ 種語言、30 個內建嗓音，輸出一樣是 24kHz／16-bit 單聲道 PCM，
// 所以下面那個補 RIFF 檔頭的做法不必改。
function TTS_MODEL_DEFAULT(){ return "gemini-3.1-flash-tts-preview"; }

/** Gemini 內建嗓音（設定頁下拉用）。名稱是 API 的字面值，不翻譯。 */
export const TTS_VOICES = ["Kore","Puck","Charon","Fenrir","Aoede","Leda","Orus","Zephyr"];

/**
 * 把 HTTP 錯誤變成一句有線索的訊息。
 *
 * 原本只丟「Gemini 400」——而回應主體裡那句「API key not valid」才是使用者
 * 真正需要的東西。金鑰打錯、額度用完、模型不存在，三種在畫面上長得一模一樣，
 * 等於要他自己猜。
 */
async function httpError(label, res){
  let detail = "";
  try{
    const j = await res.json();
    detail = j?.error?.message || j?.error?.type || j?.message || "";
  }catch{
    try{ detail = (await res.text()).slice(0, 160); }catch{}
  }
  return new Error(`${label} ${res.status}${detail ? "：" + detail : ""}`);
}

let _rot = 0;
function rotate(list){ if(list.length<=1) return list; const o=_rot++%list.length; return list.slice(o).concat(list.slice(0,o)); }

// ── LLM 文字 ────────────────────────────────────────

/**
 * 打一次 Gemini generateContent。文字、視覺、TTS 共用同一支。
 *
 * **一律走 `?key=`。** generativelanguage.googleapis.com 不收使用者的 OAuth
 * 權杖——拿 Bearer 打會回 403「insufficient authentication scopes」，而且沒有
 * 任何範圍解得開。那個端點就是設計成收 API 金鑰的。
 */
export async function geminiCall(entry, body){
  const model = entry.model || LLM_PROVIDERS[entry.provider]?.model || LLM_PROVIDERS.gemini.model;
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const init = { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) };
  if(!entry.key) throw new Error("Gemini: no key");
  const r = await fetch(`${base}?key=${encodeURIComponent(entry.key)}`, init);
  if(!r.ok) throw await httpError("Gemini", r);
  return r.json();
}
function geminiTextOf(j){ return (j.candidates?.[0]?.content?.parts?.[0]?.text||"").trim(); }

async function geminiText(entry, sys, user, temp=0.5){
  const j = await geminiCall(entry, {
    system_instruction:{parts:[{text:sys}]}, contents:[{parts:[{text:user}]}],
    generationConfig:{ temperature:temp, maxOutputTokens:160 } });
  return geminiTextOf(j);
}
/**
 * 原生音訊理解：把錄音直接餵給模型，不經語音轉文字。
 *
 * 為什麼要有這條路：失語症患者的發音常常不標準，STT 會先把它「聽錯成別的字」，
 * 之後的重組就是在錯的文字上猜，錯誤被放大兩次。讓模型直接聽原始聲音，
 * 語調、停頓、含糊的音節都還在，判斷反而更準。
 *
 * 目前只有 Gemini 風格的供應商吃 inline audio；沒有這種金鑰時由呼叫端退回
 * 原本的「瀏覽器 STT → 文字重組」流程。
 */
/** 吃得下原生音訊的那幾筆（目前只有 Gemini 風格的供應商）。 */
export function geminiEntries(){
  return llmEntries().filter(e => e.provider === "gemini");
}
export function hasNativeAudio(){ return geminiEntries().length > 0; }

export async function runAudioLlm(sys, audioBase64, mime){
  const entry = geminiEntries()[0];
  if(!entry) throw new Error(t("err.noNativeAudio"));
  const j = await geminiCall(entry, {
    system_instruction:{ parts:[{ text: sys }] },
    contents:[{ parts:[{ inline_data:{ mime_type: mime, data: audioBase64 } }] }],
    generationConfig:{ temperature:0.4, maxOutputTokens:160 }
  });
  return geminiTextOf(j).replace(/^[「"']|[」"']$/g,"");
}

/**
 * 免金鑰的文字生成。兩條路都試：
 *   ① OpenAI 相容的 POST 端點（有 system/temperature，品質比較可控）
 *   ② 純文字 GET（回的是內文本身，不是 JSON）——①掛掉時的退路
 * 免費服務本來就比較不穩，多一條路換來的是「今天還能不能講話」。
 */
async function pollinationsText(entry, sys, user, temp=0.5){
  const model = entry.model || LLM_PROVIDERS.pollinations.model;
  try{
    const r = await fetch("https://text.pollinations.ai/openai", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ model, temperature:temp, max_tokens:300,
        messages:[{role:"system",content:sys},{role:"user",content:user}] }) });
    if(r.ok){
      const j = await r.json();
      const out = (j.choices?.[0]?.message?.content || "").trim();
      if(out) return out;
    }
  }catch(e){ console.warn("pollinations openai", e); }

  const r2 = await fetch(`https://text.pollinations.ai/${encodeURIComponent(user)}`
    + `?system=${encodeURIComponent(sys)}&model=${encodeURIComponent(model)}`);
  if(!r2.ok) throw new Error("Pollinations "+r2.status);
  return (await r2.text()).trim();
}

/** OpenAI 相容端點的網址。Cloudflare 的網址帶帳戶 ID，所以要現算。 */
function openaiBase(entry){
  if(entry.provider === "cloudflare"){
    const acct = (entry.account || "").trim();
    if(!acct) throw new Error(t("err.needCfAccount"));
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acct)}/ai/v1`;
  }
  return OPENAI_BASE[entry.provider];
}

async function openaiText(entry, sys, user, temp=0.5){
  const base = openaiBase(entry); const model = entry.model || LLM_PROVIDERS[entry.provider].model;
  const r = await fetch(base+"/chat/completions",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model, temperature:temp, max_tokens:160,
      messages:[{role:"system",content:sys},{role:"user",content:user}] }) });
  if(!r.ok) throw await httpError(entry.provider, r);
  const j = await r.json(); return (j.choices?.[0]?.message?.content||"").trim();
}
async function cohereText(entry, sys, user, temp=0.5){
  const r = await fetch("https://api.cohere.com/v2/chat",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model: entry.model||LLM_PROVIDERS.cohere.model,
      messages:[{role:"system",content:sys},{role:"user",content:user}], temperature:temp }) });
  if(!r.ok) throw await httpError("Cohere", r);
  const j = await r.json(); return (j.message?.content?.[0]?.text||"").trim();
}
function llmEntries(){
  // 只留 web 支援的供應商（手機可能同步來 web 沒有的，如 cerebras → 跳過不報錯）
  const list = (state.llmApis||[]).filter(e=>{
    const p = e.provider && LLM_PROVIDERS[e.provider];
    if(!p) return false;
    // 需要帳戶 ID 的（Cloudflare）少了它就打不到，當作還沒設定好直接跳過，
    // 不要每次都送一個註定失敗的請求。
    if(p.needsAccount && !(e.account||"").trim()) return false;
    return !!e.key || !p.needsKey;
  });
  // 活動期間借站方的金鑰。**只在使用者自己一把都沒有時才借**——
  // 他自己設了就用他自己的，額度算他的，不該去消耗別人的。
  // 插在最前面：借來的是正規金鑰，品質比免金鑰保底好。
  // 整份接進來（他分到的那把在最前面）。只接一把的話，那把額度用完或
  // 暫時故障時他就直接掉到免金鑰保底——但站方明明還有別把可以用。
  if(!list.length) list.unshift(...sharedEntries("llm"));
  // 永遠保底有一個免金鑰的（同 imageEntries 的做法）。**放在最後**：
  // 使用者自己貼的金鑰品質比較好，該先用；這一筆是「什麼都沒設也能講話」。
  if(!list.some(e => e.provider === "pollinations")) list.push({ provider:"pollinations", key:"", model:"" });
  return list;
}
/** 現在這一輪會不會用到借來的金鑰（使用者自己一把都沒有時才會）。 */
export function usingSharedKey(){
  return llmEntries().some(e => e.__shared);
}

// 有金鑰，或「電腦幫跑文字」可用 → 都算有文字能力
export function hasLlm(){ return llmEntries().length>0 || localHas("text") || webgpuUsable(); }
// opts.temperature：取樣溫度（評分類任務用低溫求穩定）；
// opts.stable：true＝不做負載輪替、永遠依固定順序嘗試 —— 復健評分必用，
//   否則連續兩次跟讀會輪到「不同模型」評分（各家標準不同），分數看起來像被上一次帶著跑。
export async function runLlm(sys, user, opts={}){
  const temp = opts.temperature ?? 0.5;
  let err;
  // ① 雲端供應商優先（stable＝固定順序；否則輪替分攤額度）
  //
  // 順序是反過來的：以前本機（Qwen, 9882）排第一，但那是跑在使用者自己電腦上的
  // 模型，比雲端 API 慢一個量級——而重組一次會**同時打三個**（self-consistency
  // 取樣），使用者等的是最慢的那一個。「按下重組要等很久」就是這樣來的。
  // 本機的價值在離線可用，不在速度，所以它該是退路而不是首選。
  // 保底那一筆不參與輪替——輪替是為了分攤額度，而它沒有額度可分；
  // 讓它固定留在最後，使用者自己的金鑰才會被優先用到。
  // 三段：自己的金鑰（輪替分攤額度）→ 借來的（照分配好的順序，不打亂）
  //       → 免金鑰保底（最後）。
  // 借來的那幾筆刻意不進輪替：輪替會把「這個人分到哪一把」洗掉，
  // 一人一把就不成立，各把的用量也會變回碰運氣。
  const all = llmEntries();
  const own    = all.filter(e => !e.__shared && e.provider !== "pollinations");
  const shared = all.filter(e => e.__shared);
  const free   = all.filter(e => e.provider === "pollinations");
  const list = (opts.stable ? own : rotate(own)).concat(shared, free);
  const online = navigator.onLine !== false;
  if(online){
    for(const e of list){
      try{
        const fn = e.provider==="gemini"?geminiText
                 : e.provider==="cohere"?cohereText
                 : e.provider==="pollinations"?pollinationsText : openaiText;
        const out = await fn(e, sys, user, temp);
        if(out){
          // 借來的金鑰才計數，而且**成功才算**——失敗不該吃掉使用者的額度。
          // 不 await：計數是記帳，不該讓使用者多等一趟 Firestore。
          if(e.__shared) countSharedUse();
          return out.replace(/^[「"']|[」"']$/g,"").trim();
        }
      }catch(x){ err=x; console.warn(e.provider, x); }
    }
  }
  // ② 本機 WebGPU：跟「電腦幫忙跑」同一層的退路，但不需要另一台電腦。
  // 排在雲端之後的理由與那一層相同——本機的價值在離線與隱私，不在速度。
  // 沒開、不支援、沒載好都會是 false，完全不影響其他人。
  if(webgpuUsable()){
    try{ const out = await webgpuGenerate(sys, user, temp); if(out) return out.replace(/^[「"']|[」"']$/g,"").trim(); }
    catch(x){ err=x; console.warn("webgpu", x); }
  }
  // ③ 電腦幫忙跑：沒網路、沒金鑰、或雲端全掛時的退路（慢，但至少能用）
  if(localHas("text")){
    try{ const out = await localText(sys, user, temp); if(out) return out.replace(/^[「"']|[」"']$/g,"").trim(); }
    catch(x){ err=x; console.warn("local text", x); }
  }
  if(!list.length && !localHas("text") && !webgpuUsable()) throw new Error(t("err.noProviders"));
  throw err || new Error(t("err.allProvidersFailed"));
}

// ── 生圖 ────────────────────────────────────────────

/**
 * 打一家生圖供應商。成功回圖片網址／dataURL，這一家不認得就回 null。
 *
 * 抽成一支是為了讓「測試」按鈕跟正式流程走**完全同一條路**——測試如果是
 * 另一份實作，就會出現「測起來過、實際上不通」，那比沒有測試更糟。
 */
export async function imageOnce(e, prompt){
  if(e.provider==="pollinations")
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
  if(e.provider==="gemini"){
    const base="https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict";
    const r = await fetch(`${base}?key=${encodeURIComponent(e.key)}`, {method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ instances:[{prompt}], parameters:{sampleCount:1} })});
    if(!r.ok) throw await httpError("Imagen", r);
    const b64=(await r.json()).predictions?.[0]?.bytesBase64Encoded;
    return b64 ? "data:image/png;base64,"+b64 : null;
  }
  if(e.provider==="huggingface"){
    const r=await fetch(`https://router.huggingface.co/hf-inference/models/${e.model||IMAGE_PROVIDERS.huggingface.model}`,
      {method:"POST",headers:{"Authorization":"Bearer "+e.key,"Content-Type":"application/json"},body:JSON.stringify({inputs:prompt})});
    if(!r.ok) throw await httpError("HuggingFace", r);
    return URL.createObjectURL(await r.blob());
  }
  if(e.provider==="openai"){
    const r=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",
      headers:{"Authorization":"Bearer "+e.key,"Content-Type":"application/json"},
      body:JSON.stringify({model:"gpt-image-1",prompt,size:"512x512"})});
    if(!r.ok) throw await httpError("OpenAI image", r);
    const b64=(await r.json()).data?.[0]?.b64_json;
    return b64 ? "data:image/png;base64,"+b64 : null;
  }
  return null;
}
function imageEntries(){
  const list = (state.imageApis||[]).filter(e=>{
    const p = e.provider && IMAGE_PROVIDERS[e.provider];
    if(!p) return false;
    return !!e.key || !p.needsKey;
  });
  // 活動期間借站方的金鑰（同 llmEntries 的理由：只在自己沒有時借）
  if(!list.some(e => e.key)) list.unshift(...sharedEntries("image"));
  // 永遠保底有 Pollinations（免金鑰）
  if(!list.some(e=>e.provider==="pollinations")) list.push({ provider:"pollinations", key:"" });
  return list;
}
export async function runImage(prompt){
  // ① 電腦幫忙跑（SD-Turbo, 9881）優先
  if(localHas("image")){
    try{ return await localImage(prompt); }
    catch(x){ console.warn("local image", x); }
  }
  for(const e of rotate(imageEntries())){
    try{
      const url = await imageOnce(e, prompt);
      if(url){ if(e.__shared) countSharedUse(); return url; }
    }catch(x){ console.warn("image",e.provider,x); }
  }
  // 全部失敗 → 退 Pollinations
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
}

// ── 語音合成（雲端 TTS）────────────────────────────────

function ttsEntries(){
  const list = (state.ttsApis||[]).filter(e=>{
    const p = e.provider && TTS_PROVIDERS[e.provider];
    if(!p) return false;
    return !!e.key || !p.needsKey;
  });
  // 活動期間借站方的金鑰（同上：只在自己沒有時借）
  if(!list.length) list.unshift(...sharedEntries("tts"));
  return list;
}

/** 有沒有設定好可用的雲端語音（app.js 用來決定要不要顯示相關提示）。 */
export function hasCloudTts(){ return ttsEntries().length > 0; }

/**
 * Gemini TTS 回來的是**裸 PCM**，不是可以直接丟給 <audio> 的檔案。
 *
 * mimeType 長得像 `audio/L16;codec=pcm;rate=24000`——沒有檔頭、沒有容器，
 * 直接當成 wav 播會是一片雜訊（前 44 個位元組會被當成取樣值）。
 * 補一個 44 bytes 的 RIFF 檔頭，取樣率從 mimeType 讀，讀不到才退 24000
 * （猜錯取樣率的症狀是聲音變快或變慢，不是不出聲，很難查）。
 */
function pcmToWavBlob(bytes, mimeType){
  const rate = +(/rate=(\d+)/.exec(mimeType||"")?.[1]) || 24000;
  const numCh = 1, bits = 16;
  const blockAlign = numCh * bits / 8;
  const buf = new ArrayBuffer(44 + bytes.length);
  const dv = new DataView(buf);
  const ascii = (off, s) => { for(let i=0;i<s.length;i++) dv.setUint8(off+i, s.charCodeAt(i)); };
  ascii(0, "RIFF");  dv.setUint32(4, 36 + bytes.length, true);  ascii(8, "WAVE");
  ascii(12, "fmt "); dv.setUint32(16, 16, true);                dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true);       dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);  dv.setUint16(34, bits, true);
  ascii(36, "data"); dv.setUint32(40, bytes.length, true);
  new Uint8Array(buf, 44).set(bytes);
  return new Blob([buf], { type:"audio/wav" });
}

function b64Bytes(b64){
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) a[i] = s.charCodeAt(i);
  return a;
}

// 同時只播一句：不停掉前一句的話，連按兩次朗讀會兩句疊在一起講。
let _audio = null;
export function stopCloudTts(){
  if(!_audio) return;
  try{ _audio.pause(); URL.revokeObjectURL(_audio.src); }catch{}
  _audio = null;
}

async function geminiTts(entry, text){
  const voice = state.settings.ttsVoice || TTS_VOICES[0];
  const j = await geminiCall({ ...entry, model: entry.model || TTS_PROVIDERS[entry.provider].model }, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if(!inline?.data) throw new Error("TTS no audio");
  const mime = inline.mimeType || inline.mime_type || "";
  const bytes = b64Bytes(inline.data);
  // L16/PCM 要自己包檔頭；哪天 API 改回傳 wav/mp3 就直接用它的容器。
  return /pcm|L16/i.test(mime) ? pcmToWavBlob(bytes, mime) : new Blob([bytes], { type: mime || "audio/wav" });
}

/**
 * 用雲端 TTS 唸一句。成功回 true、沒有可用供應商或全部失敗回 false
 * （呼叫端據此退回瀏覽器語音——發不出聲比音色差嚴重得多）。
 */
export async function runTts(text, { rate } = {}){
  const list = ttsEntries();
  if(!list.length || navigator.onLine === false) return false;
  for(const e of rotate(list)){
    try{
      const blob = await geminiTts(e, text);
      if(e.__shared) countSharedUse();
      stopCloudTts();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.playbackRate = rate || state.settings.rate || 1;
      _audio = audio;
      // 播完就把 blob 網址收掉，不然一個下午的對話會留下幾百個沒釋放的物件
      audio.addEventListener("ended", () => { if(_audio === audio) stopCloudTts(); }, { once:true });
      await audio.play();
      return true;
    }catch(x){ console.warn("tts", e.provider, x); }
  }
  return false;
}

// ── 測試一筆供應商設定 ──────────────────────────────
//
// 為什麼值得做：設定頁上填完金鑰之後，使用者唯一能確認「這把到底行不行」的
// 方法是回去重組一句話，而失敗時看到的是「重組失敗」——那句話不會告訴他
// 是哪一家壞了、是金鑰錯還是額度滿。一筆一顆測試鈕，答案就直接指到那一行。
//
// **一律走正式流程那幾支**（geminiText / openaiText / imageOnce / geminiTts）。
// 測試如果自己寫一份，就會出現「測起來過、實際上不通」，那比沒有測試更糟。

/** 這一家的文字呼叫器是哪一支（與 runLlm 的挑法保持一致）。 */
function textFnOf(provider){
  return provider === "gemini"       ? geminiText
       : provider === "cohere"       ? cohereText
       : provider === "pollinations" ? pollinationsText
       : openaiText;
}

/**
 * 測一筆設定。成功回一句可以顯示的摘要，失敗就把錯誤丟出去讓畫面顯示原文——
 * 那句原文（403、API key not valid、quota exceeded…）才是使用者要的線索。
 *
 * @param kind  "llm" | "image" | "tts"
 */
export async function testEntry(kind, entry){
  if(kind === "llm"){
    // 用最短的輸入、溫度 0：測的是「打不打得通」，不是品質，不必燒額度。
    const out = await textFnOf(entry.provider)(entry, "Reply with the single word: OK", "ping", 0);
    if(!out) throw new Error("empty response");
    return out.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  if(kind === "image"){
    const url = await imageOnce(entry, "a small red circle on white background");
    if(!url) throw new Error("no image");
    // Pollinations 是「組出網址就算成功」（真正的圖是 <img> 去抓的），
    // 所以這裡只回報拿到什麼形式，不假裝驗證過畫面。
    return url.startsWith("data:") ? "data URL" : url.slice(0, 48) + "…";
  }
  if(kind === "tts"){
    const blob = await geminiTts(entry, "測試");
    if(!blob || !blob.size) throw new Error("no audio");
    return Math.round(blob.size / 1024) + " KB";
  }
  throw new Error("unknown kind: " + kind);
}
