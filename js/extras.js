// 進階功能（全部純 API / 瀏覽器）：生圖、定位、相機雲端辨識、Telegram 通報。
import { state } from "./store.js";

// ── AI 生圖：優先 Pollinations（免金鑰），有 Gemini 金鑰也可用 ──
export async function generateImage(prompt){
  const en = prompt; // Pollinations 直接吃文字
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
  // 直接回傳 URL（瀏覽器 <img> 載入即生成），最輕量
  return url;
}

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
  const key = state.apiKeys.gemini;
  if(!key) throw new Error("需要 Gemini 金鑰才能用相機辨識（設定頁）");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ contents:[{ parts:[
      { text:"用繁體中文列出這張照片裡最主要的 3-5 個物品，只輸出名詞、用頓號分隔，不要解釋。" },
      { inline_data:{ mime_type:"image/jpeg", data: base64Jpeg } }
    ]}] }) });
  if(!r.ok) throw new Error("Vision "+r.status);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// ── Telegram 緊急通報 ──
export async function telegramNotify(text){
  const { tgtoken, tgchat } = state.apiKeys;
  if(!tgtoken || !tgchat) throw new Error("需先在設定頁填 Telegram Bot Token 與 Chat ID");
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
