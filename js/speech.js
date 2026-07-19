// TTS / STT：預設用瀏覽器原生 Web Speech API（免金鑰）；
// 若開啟「本地語音引擎」且連得上語音中心，則改用 GPT-SoVITS 角色語音。
import { state } from "./store.js";
import { localTtsEnabled, localSpeak, stopLocalSpeak } from "./localtts.js";
import { t } from "./i18n.js";

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
  if(!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  if(!vs.length) return null;
  const base = (lang||"").split("-")[0].toLowerCase();
  const pool = vs.filter(v => (v.lang||"").toLowerCase().startsWith(base));
  return (pool.length ? pool : vs).slice().sort((a,b)=>_scoreVoice(b,lang)-_scoreVoice(a,lang))[0] || null;
}

/** 供設定頁下拉用：列出（指定語言的）可用嗓音，最自然的排前面。 */
export function listVoices(lang){
  if(!("speechSynthesis" in window)) return [];
  const base = (lang||"").split("-")[0].toLowerCase();
  return speechSynthesis.getVoices()
    .filter(v => !base || (v.lang||"").toLowerCase().startsWith(base))
    .sort((a,b)=>_scoreVoice(b,lang||"")-_scoreVoice(a,lang||""));
}

export function speak(text){
  if(!text) return;
  // 本地 GPT-SoVITS 角色語音優先；失敗則自動退回瀏覽器原生語音。
  if(localTtsEnabled()){
    localSpeak(text).catch(e=>{ console.warn("本地語音失敗，改用瀏覽器語音", e); _webSpeak(text); });
    return;
  }
  _webSpeak(text);
}

/** 重症／高齡防呆模式專用：語調輕快化（消除機械沉悶感、建立正向反饋）。
 *  GPT-SoVITS 路徑＝改用「开心」情緒參考音（合成 wav 無法調 pitch，用情緒達成等價效果）；
 *  瀏覽器 TTS 路徑＝pitch 1.2 / rate 1.08。 */
export function speakUpbeat(text){
  if(!text) return;
  if(localTtsEnabled()){
    localSpeak(text, { emotion:"开心" })
      .catch(e=>{ console.warn("本地語音失敗，改用瀏覽器語音", e); _webSpeak(text, { pitch:1.2, rate:1.08 }); });
    return;
  }
  _webSpeak(text, { pitch:1.2, rate:1.08 });
}

function _webSpeak(text, opts = {}){
  if(!text) return;
  if(!("speechSynthesis" in window)) return;   // 老瀏覽器沒有 Web Speech → 靜默略過而非 ReferenceError
  stopLocalSpeak();                            // 停掉可能還在播的本地 GPT-SoVITS 音檔，避免疊音
  const doSpeak = () => {
    try{
      // 只有真的在講才 cancel —— iOS/部分 Android「每次都 cancel」會把新句子一起吃掉而不發聲
      if(speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = state.settings.lang || "zh-TW";
      u.rate = opts.rate ?? (state.settings.rate || 0.95);
      u.pitch = opts.pitch ?? 1.0;
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
  if(!("speechSynthesis" in window)) return;
  stopLocalSpeak();                            // 多語朗讀走瀏覽器聲音，先停本地音避免疊音
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
  if(!SR){ onError?.(t("toast.sttUnsupported")); return { stop(){} }; }
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
  rec.onerror = (e)=> onError?.(e.error || t("stt.error"));
  rec.onend = ()=> onEnd?.(finalText.trim());
  rec.start();
  return { stop(){ try{ rec.stop(); }catch{} } };
}
