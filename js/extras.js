// 進階功能（全部純 API / 瀏覽器）：生圖、定位、相機雲端辨識、Telegram 通報。
import { state } from "./store.js";
import { runImage } from "./providers.js";
import { t } from "./i18n.js";

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
    const t = j.elements?.[0]?.tags;
    const name = t?.name || t?.amenity || t?.shop;
    return name ? `${name}` : `附近 (${lat.toFixed(4)},${lon.toFixed(4)})`;
  }catch{ return `位置 (${lat.toFixed(4)},${lon.toFixed(4)})`; }
}

// ── 相機雲端辨識：拍一張 → Gemini Vision 回傳看到的物品（中文，逗號分隔）──
export async function recognizePhoto(base64Jpeg){
  const key = geminiKey();
  if(!key) throw new Error(t("err.needGeminiVision"));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ contents:[{ role:"user", parts:[
      { text:"用繁體中文列出這張照片裡最主要的 3-5 個物品，只輸出名詞、用頓號分隔，不要解釋。" },
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
export async function telegramNotify(text){
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat) throw new Error(t("err.needTg"));
  let loc = "";
  try{
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:6000}));
    loc = `\n📍 https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
  }catch{ loc = "\n📍 位置未知"; }
  const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: tgchat, text: "🆘 VoiceWeaver 求助：" + text + loc }) });
  if(!r.ok) throw new Error("Telegram "+r.status);
  return true;
}
