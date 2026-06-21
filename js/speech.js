// TTS / STT 全用瀏覽器原生 Web Speech API（免金鑰、無本地模型運算）。
import { state } from "./store.js";

export function speak(text){
  if(!text) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.settings.lang || "zh-TW";
    u.rate = state.settings.rate || 0.95;
    // 盡量挑符合語言的嗓音
    const v = speechSynthesis.getVoices().find(v=>v.lang?.startsWith(u.lang.split("-")[0]));
    if(v) u.voice = v;
    speechSynthesis.speak(u);
  }catch(e){ console.warn("TTS失敗", e); }
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
