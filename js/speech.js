// TTS / STT 全用瀏覽器原生 Web Speech API（免金鑰、無本地模型運算）。
import { state } from "./store.js";

// 自然嗓音關鍵字：神經網路／線上嗓音通常比預設機械音「有人味」得多。
const _NATURAL_HINTS = ["natural","neural","wavenet","journey","online","premium","enhanced","google","siri","自然","線上"];
function _scoreVoice(v, lang){
  const L = (lang||"").toLowerCase(), base = L.split("-")[0];
  let s = 0;
  const vl = (v.lang||"").toLowerCase();
  if(vl === L) s += 100; else if(vl.startsWith(base)) s += 50;
  const name = (v.name||"").toLowerCase();
  if(_NATURAL_HINTS.some(h => name.includes(h))) s += 40;   // 自然/神經嗓音優先
  if(!v.localService) s += 12;                              // 線上嗓音通常較自然
  return s;
}
function _bestVoice(lang){
  const vs = speechSynthesis.getVoices();
  if(!vs.length) return null;
  const base = (lang||"").split("-")[0].toLowerCase();
  const pool = vs.filter(v => (v.lang||"").toLowerCase().startsWith(base));
  return (pool.length ? pool : vs).slice().sort((a,b)=>_scoreVoice(b,lang)-_scoreVoice(a,lang))[0] || null;
}

/** 供設定頁下拉用：列出（指定語言的）可用嗓音，最自然的排前面。 */
export function listVoices(lang){
  const base = (lang||"").split("-")[0].toLowerCase();
  return speechSynthesis.getVoices()
    .filter(v => !base || (v.lang||"").toLowerCase().startsWith(base))
    .sort((a,b)=>_scoreVoice(b,lang||"")-_scoreVoice(a,lang||""));
}

export function speak(text){
  if(!text) return;
  const doSpeak = () => {
    try{
      // 只有真的在講才 cancel —— iOS/部分 Android「每次都 cancel」會把新句子一起吃掉而不發聲
      if(speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = state.settings.lang || "zh-TW";
      u.rate = state.settings.rate || 0.95;
      u.pitch = 1.0;
      const vs = speechSynthesis.getVoices();
      // 使用者在設定頁選的嗓音優先；沒選就自動挑「最有人味」的那個
      const chosen = (state.settings.voice && vs.find(v => v.voiceURI === state.settings.voice)) || _bestVoice(u.lang);
      if(chosen){ u.voice = chosen; u.lang = chosen.lang || u.lang; }
      speechSynthesis.speak(u);
    }catch(e){ console.warn("TTS失敗", e); }
  };
  // 首次載入時 voices 可能還沒就緒 → 等一次 voiceschanged 再講，避免「沒聲音」
  if(speechSynthesis.getVoices().length) doSpeak();
  else speechSynthesis.addEventListener("voiceschanged", doSpeak, { once:true });
}

/** 多語朗讀：指定語言唸一句（重組結果一鍵中/英/日/韓）。 */
export function speakIn(text, lang){
  if(!text) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "zh-TW";
    u.rate = state.settings.rate || 0.95;
    const v = speechSynthesis.getVoices().find(v=>v.lang?.startsWith(u.lang.split("-")[0]));
    if(v) u.voice = v;
    speechSynthesis.speak(u);
  }catch(e){ console.warn("speakIn 失敗", e); }
}

export function sttSupported(){
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 回傳一個可呼叫 stop() 的物件；onResult(text)、onEnd()
export function listen({ onResult, onEnd, onError }){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ onError?.("此瀏覽器不支援語音輸入（建議 Chrome/Edge）"); return { stop(){} }; }
  const rec = new SR();
  rec.lang = state.settings.lang || "zh-TW";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e)=>{
    let interim = "";
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText += t; else interim += t;
    }
    onResult?.(finalText + interim);
  };
  rec.onerror = (e)=> onError?.(e.error || "語音輸入錯誤");
  rec.onend = ()=> onEnd?.(finalText.trim());
  rec.start();
  return { stop(){ try{ rec.stop(); }catch{} } };
}
