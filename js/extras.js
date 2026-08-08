// 進階功能（全部純 API / 瀏覽器）：生圖、定位、相機雲端辨識、Telegram 通報。
import { state } from "./store.js?v=1.5.30";
import { runImage } from "./providers.js?v=1.5.30";
import { t } from "./i18n.js?v=1.5.30";

// ── AI 生圖：走多供應商輪詢（pollinations 免金鑰保底）──
export async function generateImage(prompt){ return runImage(prompt); }

// 從 LLM 清單找第一把 Gemini 金鑰（相機視覺用）
function geminiKey(){ return (state.llmApis||[]).find(e=>e.provider==="gemini" && e.key)?.key || ""; }

// ── 意圖→圖卡用的英文提示（簡單關鍵字對應，讓圖更貼切）──
export function intentPrompt(sentence){
  return `simple clear illustration, AAC communication card, ${sentence}, flat, friendly, white background`;
}

// ── 定位情境：瀏覽器 Geolocation + Overpass 找最近 POI 類別 ──
export async function detectLocation(){
  const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:8000,enableHighAccuracy:true}));
  const { latitude:lat, longitude:lon } = pos.coords;
  try{
    const q = `[out:json][timeout:8];(nwr(around:60,${lat},${lon})[amenity];nwr(around:60,${lat},${lon})[shop];);out tags 5;`;
    const r = await fetch("https://overpass-api.de/api/interpreter", { method:"POST", body:q });
    const j = await r.json();
    // 這裡原本叫 t，把 i18n 的 t() 整個遮蔽掉——沒有 name 時 `t("loc.nearby")`
    // 是在呼叫一個 tags 物件，一定拋 TypeError，那條訊息等於永遠不會出現。
    const tags = j.elements?.[0]?.tags;
    const name = tags?.name || tags?.amenity || tags?.shop;
    return name ? `${name}` : `${t("loc.nearby")} (${lat.toFixed(4)},${lon.toFixed(4)})`;
  }catch{ return `${t("loc.position")} (${lat.toFixed(4)},${lon.toFixed(4)})`; }
}

// 辨識結果要用「使用者正在看的語言」回，否則日文介面拍照卻跳出中文物品名。
const VISION_PROMPT = {
  "zh-TW": "用繁體中文列出這張照片裡最主要的 3-5 個物品，只輸出名詞、用頓號分隔，不要解釋。",
  "en":    "List the 3-5 main objects in this photo in English. Output nouns only, separated by commas, no explanation.",
  "ja":    "この写真の主な物を3〜5個、日本語で挙げてください。名詞のみ、読点区切り、説明不要。",
  "ko":    "이 사진의 주요 물건 3~5개를 한국어로 나열하세요. 명사만, 쉼표로 구분, 설명 없이."
};
function visionPrompt(){
  const L = document.documentElement.getAttribute("data-lang") || "zh-TW";
  return VISION_PROMPT[L] || VISION_PROMPT[L.split("-")[0]] || VISION_PROMPT["zh-TW"];
}

// ── 相機雲端辨識：拍一張 → Gemini Vision 回傳看到的物品（依介面語言，逗號分隔）──
export async function recognizePhoto(base64Jpeg){
  const key = geminiKey();
  if(!key) throw new Error(t("err.needGeminiVision"));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ contents:[{ role:"user", parts:[
      { text: visionPrompt() },
      { inline_data:{ mime_type:"image/jpeg", data: base64Jpeg } }
    ]}] }) });
  if(!r.ok){
    let msg = "Vision "+r.status;
    try{ const e = await r.json(); msg += "：" + (e?.error?.message || JSON.stringify(e)); }catch{}
    throw new Error(msg);
  }
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// ── Telegram 緊急通報 ──
// 純送出，不等定位。危機通報要用這個——定位最慢會吃掉 6 秒 timeout，
// 而那 6 秒是家人還不知道出事的 6 秒。
// 自動演示進行中一律不外送。求救與危機介入演示一次就吵到家人一次，
// 而且演示是要錄影給別人看的——真的把家人的聊天室洗版是不可接受的。
// 擋在這一層（而不是各個呼叫點）才擋得乾淨：SOS、危機介入、成績單推播都經過這裡。
function demoBlocked(what){
  if(!window.__VW_DEMO__) return false;
  console.info(`[demo] ${what} 已攔截（自動演示不外送）`);
  return true;
}

export async function telegramSend(text){
  if(demoBlocked("telegramSend")) return true;
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat) throw new Error(t("err.needTg"));
  const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: tgchat, text }) });
  if(!r.ok) throw new Error("Telegram "+r.status);
  return true;
}

// 取一行可貼進訊息的位置連結；拿不到回 null，讓呼叫端自己決定要不要寫「位置未知」。
export async function locationLine(){
  try{
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:6000}));
    return `\n📍 https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
  }catch{ return null; }
}

export async function telegramNotify(text){
  return telegramSend(t("sos.prefix") + text + (await locationLine() ?? t("sos.noLoc")));
}

// ── 危機介入用：媒體上傳與家人回覆輪詢（與 App 的 TelegramClient 同一組 API）──

async function telegramUpload(method, field, blob, filename, caption){
  if(demoBlocked("telegram " + method)) return true;
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat) throw new Error(t("err.needTg"));
  const fd = new FormData();
  fd.append("chat_id", tgchat);
  fd.append("caption", (caption||"").slice(0,1000));
  fd.append(field, blob, filename);
  const r = await fetch(`https://api.telegram.org/bot${tgtoken}/${method}`, { method:"POST", body: fd });
  if(!r.ok) throw new Error(`Telegram ${method} ${r.status}`);
  const j = await r.json();
  if(!j.ok) throw new Error(`Telegram ${method}: ${j.description || "rejected"}`);
  return true;
}

/** 現場照片（前／後鏡頭快照）傳給家人。 */
export function telegramSendPhoto(blob, caption){
  return telegramUpload("sendPhoto", "photo", blob, "crisis.jpg", caption);
}

/** 使用者主動錄的語音訊息傳給家人。 */
export function telegramSendVoice(blob, caption){
  // 用 sendAudio 而不是 sendVoice：sendVoice 只吃 OGG/OPUS，瀏覽器 MediaRecorder
  // 多半吐 webm/mp4，送 sendVoice 會被 Telegram 退。sendAudio 兩種都收。
  const ext = (blob.type||"").includes("mp4") ? "m4a" : "webm";
  return telegramUpload("sendAudio", "audio", blob, `crisis_voice.${ext}`, caption);
}

/**
 * 輪詢家人的回覆。回傳 { offset, replies }。
 *
 * offset = 最後一則 update_id + 1（Telegram 規範）。傳 -1 只會取回「最後一則」，
 * 危機一開始用它快轉略過積壓——不然上一次危機家人打的 /end 會被重播，
 * 新視窗一開就被關掉。
 *
 * 注意：getUpdates 與 webhook 互斥，而且同一個 bot token 同時被手機 App 和網頁
 * 輪詢時，訊息會被先拿到的一方吃掉。兩邊同時開著危機視窗時只會有一邊收到家人回覆。
 */
export async function telegramPollReplies(offset){
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat) throw new Error(t("err.needTg"));
  const url = `https://api.telegram.org/bot${tgtoken}/getUpdates?timeout=0`
    + `&allowed_updates=${encodeURIComponent('["message"]')}`
    + (offset ? `&offset=${offset}` : "");
  const r = await fetch(url);
  if(!r.ok) throw new Error("Telegram getUpdates "+r.status);
  const j = await r.json();
  if(!j.ok) throw new Error("getUpdates: "+(j.description||"rejected"));
  let newOffset = offset;
  const replies = [];
  for(const upd of (j.result||[])){
    if(upd.update_id + 1 > newOffset) newOffset = upd.update_id + 1;
    const msg = upd.message;
    if(!msg) continue;
    // 只收緊急聯絡人那個 chat 的文字訊息
    if(String(msg.chat?.id) === String(tgchat) && (msg.text||"").trim()){
      replies.push(msg.text.trim());
    }
  }
  return { offset: newOffset, replies };
}
