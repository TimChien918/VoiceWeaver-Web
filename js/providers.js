// 供應商目錄 + 呼叫器（同供應商可多把金鑰、可多選供應商，自動輪詢+備援）。
import { state } from "./store.js?v=1.5.57";
import { localHas, localText, localImage } from "./localtts.js?v=1.5.57";
import { googleApiFetch, googleApiError, accountQuotaReady } from "./gauth.js?v=1.5.57";
import { t } from "./i18n.js?v=1.5.57";

// 文字 LLM 供應商（標 cors 者較可能可在瀏覽器直接呼叫）
//
// oauth:true 的那一個不用金鑰——它拿「使用者登入的那個 Google 帳號」的授權去打，
// 額度算在使用者自己的 Google Cloud 專案上（見 gauth.js）。對照顧者來說，
// 這是唯一一條不必先去申請一把 API 金鑰的路。
export const LLM_PROVIDERS = {
  googleQuota:{ label:"Google Gemini", labelKey:"prov.googleQuota", needsKey:false, oauth:true, model:"gemini-3.5-flash" },
  gemini:     { label:"Google Gemini",  needsKey:true,  model:"gemini-3.5-flash" },
  groq:       { label:"Groq",           needsKey:true,  model:"qwen/qwen3.6-27b" },
  openrouter: { label:"OpenRouter",     needsKey:true,  model:"qwen/qwen3-14b" },
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
  pollinations:{ label:"Pollinations", needsKey:false },
  googleQuota: { label:"Gemini Imagen", labelKey:"prov.googleQuotaImg", needsKey:false, oauth:true },
  gemini:      { label:"Gemini Imagen",          needsKey:true },
  huggingface: { label:"HuggingFace",            needsKey:true, model:"black-forest-labs/FLUX.1-schnell" },
  openai:      { label:"OpenAI (gpt-image-1)",   needsKey:true },
};

// 語音合成供應商（雲端 TTS）。
//
// 這一層擺在「專屬聲音（GPT-SoVITS）」與「瀏覽器內建語音」之間：
//   專屬聲音   —— 是使用者本人／家人的音色，有的話永遠優先，那是整個功能的意義所在，
//                 但要電腦或 Colab 開著。
//   雲端 TTS   —— 這一層。電腦沒開時的「好聽的聲音」，而且與文字、生圖走同一份帳號額度。
//   瀏覽器語音 —— 永遠的保底，免金鑰、零延遲，出得了聲最重要。
//
// 沒有 pollinations 那種免金鑰保底項：瀏覽器內建語音本來就是保底，不必在清單裡再放一個。
export const TTS_PROVIDERS = {
  googleQuota: { label:"Gemini TTS", labelKey:"prov.googleQuotaTts", needsKey:false, oauth:true, model:TTS_MODEL_DEFAULT() },
  gemini:      { label:"Gemini TTS", needsKey:true, model:TTS_MODEL_DEFAULT() },
};
// 函式而不是常數：TTS_PROVIDERS 是模組載入時就求值的，寫在它上面才看得到。
function TTS_MODEL_DEFAULT(){ return "gemini-2.5-flash-preview-tts"; }

/** Gemini 內建嗓音（設定頁下拉用）。名稱是 API 的字面值，不翻譯。 */
export const TTS_VOICES = ["Kore","Puck","Charon","Fenrir","Aoede","Leda","Orus","Zephyr"];

let _rot = 0;
function rotate(list){ if(list.length<=1) return list; const o=_rot++%list.length; return list.slice(o).concat(list.slice(0,o)); }

// ── LLM 文字 ────────────────────────────────────────

/**
 * 這一筆是不是走「使用者帳號額度」（OAuth）而不是金鑰。
 *
 * 認 provider 這個字，不是去查某一本目錄——geminiCall 同時服務文字、視覺、TTS
 * 三份清單，只查 LLM_PROVIDERS 的話，TTS 那筆會查不到而被當成要金鑰的，
 * 然後帶著一把空金鑰打過去。googleQuota 在三本目錄裡是同一件事。
 */
function isOauth(entry){ return entry.provider === "googleQuota"; }

/**
 * 打一次 Gemini generateContent，兩種身分共用。
 *
 * 差別只有「怎麼證明你是誰」：金鑰是 `?key=`，帳號額度是 `Authorization: Bearer`
 * ＋ `x-goog-user-project`（由 googleApiFetch 補上）。請求內容完全一樣，
 * 所以原生音訊、視覺那些呼叫不必為了兩種身分各寫一份。
 */
export async function geminiCall(entry, body){
  const model = entry.model || LLM_PROVIDERS[entry.provider]?.model || LLM_PROVIDERS.gemini.model;
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const init = { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) };
  if(isOauth(entry)){
    const r = await googleApiFetch(base, init);
    if(!r.ok) throw await googleApiError(r);
    return r.json();
  }
  const r = await fetch(`${base}?key=${encodeURIComponent(entry.key)}`, init);
  if(!r.ok) throw new Error("Gemini "+r.status);
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
/** 吃得下原生音訊的那幾筆（金鑰版與帳號額度版都是 Gemini，兩個都算）。 */
export function geminiEntries(){
  return llmEntries().filter(e => e.provider === "gemini" || e.provider === "googleQuota");
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

async function openaiText(entry, sys, user, temp=0.5){
  const base = OPENAI_BASE[entry.provider]; const model = entry.model || LLM_PROVIDERS[entry.provider].model;
  const r = await fetch(base+"/chat/completions",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model, temperature:temp, max_tokens:160,
      messages:[{role:"system",content:sys},{role:"user",content:user}] }) });
  if(!r.ok) throw new Error(entry.provider+" "+r.status);
  const j = await r.json(); return (j.choices?.[0]?.message?.content||"").trim();
}
async function cohereText(entry, sys, user, temp=0.5){
  const r = await fetch("https://api.cohere.com/v2/chat",{ method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+entry.key },
    body: JSON.stringify({ model: entry.model||LLM_PROVIDERS.cohere.model,
      messages:[{role:"system",content:sys},{role:"user",content:user}], temperature:temp }) });
  if(!r.ok) throw new Error("Cohere "+r.status);
  const j = await r.json(); return (j.message?.content?.[0]?.text||"").trim();
}
function llmEntries(){
  // 只留 web 支援的供應商（手機可能同步來 web 沒有的，如 cerebras → 跳過不報錯）
  return (state.llmApis||[]).filter(e=>{
    const p = e.provider && LLM_PROVIDERS[e.provider];
    if(!p) return false;
    // 帳號額度：沒授權或沒選專案時就當作「這一筆還不能用」，直接跳過去試下一家。
    // 不擋在這裡的話，每一次重組都會先打一個一定失敗的請求（還會跳授權彈窗），
    // 使用者只是想講一句話。
    if(p.oauth) return accountQuotaReady();
    return !!e.key || !p.needsKey;
  });
}
// 有金鑰，或「電腦幫跑文字」可用 → 都算有文字能力
export function hasLlm(){ return llmEntries().length>0 || localHas("text"); }
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
  const list = opts.stable ? llmEntries() : rotate(llmEntries());
  const online = navigator.onLine !== false;
  if(online){
    for(const e of list){
      try{
        const fn = (e.provider==="gemini"||e.provider==="googleQuota")?geminiText
                 : e.provider==="cohere"?cohereText : openaiText;
        const out = await fn(e, sys, user, temp);
        if(out) return out.replace(/^[「"']|[」"']$/g,"").trim();
      }catch(x){ err=x; console.warn(e.provider, x); }
    }
  }
  // ② 電腦幫忙跑：沒網路、沒金鑰、或雲端全掛時的退路（慢，但至少能用）
  if(localHas("text")){
    try{ const out = await localText(sys, user, temp); if(out) return out.replace(/^[「"']|[」"']$/g,"").trim(); }
    catch(x){ err=x; console.warn("local text", x); }
  }
  if(!list.length && !localHas("text")) throw new Error(t("err.noProviders"));
  throw err || new Error(t("err.allProvidersFailed"));
}

// ── 生圖 ────────────────────────────────────────────
function imageEntries(){
  const list = (state.imageApis||[]).filter(e=>{
    const p = e.provider && IMAGE_PROVIDERS[e.provider];
    if(!p) return false;
    if(p.oauth) return accountQuotaReady();     // 沒授權就跳過（同 llmEntries 的理由）
    return !!e.key || !p.needsKey;
  });
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
      if(e.provider==="pollinations")
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
      if(e.provider==="gemini" || e.provider==="googleQuota"){
        const base="https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict";
        const init={method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ instances:[{prompt}], parameters:{sampleCount:1} })};
        const r = IMAGE_PROVIDERS[e.provider].oauth
          ? await googleApiFetch(base, init)
          : await fetch(`${base}?key=${encodeURIComponent(e.key)}`, init);
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

// ── 語音合成（雲端 TTS）────────────────────────────────

function ttsEntries(){
  return (state.ttsApis||[]).filter(e=>{
    const p = e.provider && TTS_PROVIDERS[e.provider];
    if(!p) return false;
    if(p.oauth) return accountQuotaReady();     // 沒授權就跳過（同 llmEntries 的理由）
    return !!e.key || !p.needsKey;
  });
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
