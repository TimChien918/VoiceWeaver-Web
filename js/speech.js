// TTS / STT：預設用瀏覽器原生 Web Speech API（免金鑰）；
// 若開啟「本地語音引擎」且連得上語音中心，則改用 GPT-SoVITS 角色語音。
import { state } from "./store.js?v=1.5.17";
import { localTtsEnabled, localSpeak, stopLocalSpeak } from "./localtts.js?v=1.5.17";
import { t } from "./i18n.js?v=1.5.17";
import { sanitizeForSpeech } from "./safety.js?v=1.5.17";

// 讓上層（app.js）注入 toast，好把「本地語音失敗、已退回瀏覽器語音」的原因顯示出來，
// 不再靜默吞錯——否則使用者只覺得「連上了卻無法合成」，看不到真正原因。
let _onErr = null;
export function setSpeechToast(fn){ _onErr = fn; }

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

/**
 * @param {object} [opt]
 * @param {boolean} [opt.safetyChecked] 上游已用 AI 判定這句是「替別人求救／中性提及」。
 *   這種句子不可以消毒——「我朋友想自殺」被改成「我朋友想（請與家屬聯絡）」
 *   就求不了救了。預設 false，其餘所有路徑照樣消毒。
 */
export function speak(text, { safetyChecked = false } = {}){
  if(!text) return;
  // 第三層防禦：模型萬一還是吐出禁字，唸出來之前替換掉。
  // **每一個對外發聲的函式都要自己做這一步**（speak / speakUpbeat / speakIn）——
  // 曾經只有這裡做，另外兩條就這樣成了繞過整層防護的後門。
  if(!safetyChecked) text = sanitizeForSpeech(text);
  // 本地 GPT-SoVITS 角色語音優先；失敗則自動退回瀏覽器原生語音。
  if(localTtsEnabled()){
    localSpeak(text).catch(e=>{
      console.warn("本地語音失敗，改用瀏覽器語音", e);
      _onErr?.(t("err.localSpeakFell").replace("{err}", (e && e.message) || e));
      _webSpeak(text);
    });
    return;
  }
  _webSpeak(text);
}

/** 重症／高齡防呆模式專用：語調輕快化（消除機械沉悶感、建立正向反饋）。
 *  GPT-SoVITS 路徑＝改用「开心」情緒參考音（合成 wav 無法調 pitch，用情緒達成等價效果）；
 *  瀏覽器 TTS 路徑＝pitch 1.2 / rate 1.08。 */
export function speakUpbeat(text){
  if(!text) return;
  // 第三層防禦也要走。speak() 的註解說「所有發聲路徑都經過這裡，繞不過去」，
  // 但這條路徑根本沒經過——而它服務的正是重度模式的使用者。
  text = sanitizeForSpeech(text);
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
  // **這條路徑唸的是 LLM 的重組結果**——正是第三層防禦存在的唯一理由，
  // 卻是三個發聲函式裡唯一完全沒消毒的。一鍵切語言就繞過整層防護。
  text = sanitizeForSpeech(text);
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
