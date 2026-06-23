// TTS / STT 全用瀏覽器原生 Web Speech API（免金鑰、無本地模型運算）。
import { state } from "./store.js";

function _pickVoice(lang){
  const vs = speechSynthesis.getVoices();
  if(!vs.length) return null;
  const L = lang.toLowerCase(), base = L.split("-")[0];
  return vs.find(v => v.lang?.toLowerCase() === L)
      || vs.find(v => v.lang?.toLowerCase().startsWith(base))
      || null;
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
      const v = _pickVoice(u.lang);
      if(v) u.voice = v;
      speechSynthesis.speak(u);
    }catch(e){ console.warn("TTS失敗", e); }
  };
  // 首次載入時 voices 可能還沒就緒 → 等一次 voiceschanged 再講，避免「沒聲音」
  if(speechSynthesis.getVoices().length) doSpeak();
  else speechSynthesis.addEventListener("voiceschanged", doSpeak, { once:true });
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
