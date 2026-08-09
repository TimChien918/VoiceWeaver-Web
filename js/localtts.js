// 本地 GPT-SoVITS 語音橋接（透過 Mac/Windows「語音中心」的 9879 CORS 橋接端點）。
//
// 瀏覽器混合內容限制：本網頁掛在 HTTPS（github.io），只能連
//   ① http://localhost / 127.0.0.1（瀏覽器例外，限「開網頁的電腦＝語音中心電腦」）
//   ② https://<主機>.<tailnet>.ts.net（Tailscale serve 的真憑證網址，任何地方可連）
// 連不上時上層會自動退回瀏覽器原生語音。
import { state } from "./store.js?v=1.5.32";
import { t } from "./i18n.js?v=1.5.32";

let _base = null;   // 已確認可用的橋接 base URL

// 電腦端三項運算可用性。**初值必須是「未知」而不是 false。**
//
// localTtsEnabled() 判斷的是 `_health.voice !== false`——那個寫法的用意本來就是
// 「還沒偵測過就先試試看，真的連不上再退回瀏覽器語音」。但初值寫成 { voice:false }
// 之後，`false !== false` 是 false，於是在按下「偵測連線」之前它永遠回 false：
// 使用者開了電腦運算、選好角色語音，朗讀出來的還是瀏覽器的機械音，
// 而且每次重新整理都會退回這個狀態。專屬聲音等於完全沒作用。
let _health = {};   // undefined＝還沒偵測；true/false＝偵測過的結果

// 候選位址：使用者新增的雲端清單（可多台，逐一嘗試、第一個健康的即採用）＋ 同機 localhost。
function candidates() {
  const list = [];
  const norm = (u) => {
    let x = (u || "").trim().replace(/\/+$/, "");
    if (x && !/^https?:\/\//i.test(x)) x = "https://" + x;   // 使用者常忘記打協定
    return x;
  };
  for (const srv of (state.settings.localComputeServers || [])) {
    const u = norm(srv && srv.url);
    if (u) list.push(u);
  }
  const legacy = norm(state.settings.localTtsUrl);   // 相容舊單一欄位
  if (legacy) list.push(legacy);
  list.push("http://127.0.0.1:9879", "http://localhost:9879");
  return [...new Set(list)];
}

// 「讓電腦幫忙跑運算」總開關（語音／生圖／文字共用）
export function localComputeEnabled() {
  return !!state.settings.localTtsEnabled;
}
// 向後相容：語音是否走電腦
export function localTtsEnabled() {
  return localComputeEnabled() && _health.voice !== false;
}
export function localBase() { return _base; }
// 各項運算電腦端是否可用（需先 detectLocalTts 過一次）
export function localHas(kind) { return localComputeEnabled() && !!_health[kind]; }
export function localHealth() { return { ..._health }; }

// ngrok 免費版對「瀏覽器請求」會插一頁 HTML 警告攔截頁 → fetch 拿到 HTML、JSON 解析失敗
// → Colab 節點被誤判成死的。帶 ngrok-skip-browser-warning 標頭即可繞過。
// 只對 ngrok 網址帶（帶了會觸發 CORS preflight，別煩本機/Tailscale 的橋接）。
function _hdrs(base, extra) {
  const h = { ...(extra || {}) };
  if (/ngrok/i.test(base || "")) h["ngrok-skip-browser-warning"] = "1";
  return h;
}

async function _fetch(path, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch((_base || "") + path,
      { ...opts, headers: _hdrs(_base, opts.headers), signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

// 偵測可用的橋接位址；成功回 {base, current}，失敗回 null。
// 重點：不要「第一個回 ok 的就採用」——例如 Colab bridge 活著但服務全掛（voice/image/text
// 全 false、曲庫空）時，會永遠蓋掉真正有內容的本機。改成挑「有實際能力」的節點：
// 有任何一項運算(voice/image/text)可用者優先；全部都沒能力才退而求其次用第一個活著的。
export async function detectLocalTts(timeoutMs = 2500) {
  let fallback = null;   // 活著但沒任何運算能力（例如 Colab 服務還沒起）
  for (const base of candidates()) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(base + "/health", { headers: _hdrs(base), signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (!(j && j.ok)) continue;
      const health = { voice: !!j.voice, image: !!j.image, text: !!j.text };
      const capable = health.voice || health.image || health.text;
      if (capable) {
        _base = base; _health = health;
        return { base, current: j.current || "", health: { ...health } };
      }
      if (!fallback) fallback = { base, current: j.current || "", health };
    } catch (e) { /* 試下一個 */ }
  }
  if (fallback) {   // 全部節點都沒運算能力 → 用第一個活著的（至少能顯示狀態、之後服務起來就有）
    _base = fallback.base; _health = fallback.health;
    return { base: fallback.base, current: fallback.current, health: { ...fallback.health } };
  }
  _base = null;
  _health = { voice: false, image: false, text: false };
  return null;
}

// ── 文字語言 → 該用哪個角色 ────────────────────────────────────────────
//
// 以前這裡永遠送「使用者選定角色的語言」，不是「這句話的語言」。
// 於是選了中文角色時，英文句子被標成 text_lang=ZH 送進 GPT-SoVITS，
// 中文前端會把英文字母硬當中文唸——出來就是一段中文腔的怪聲。
// （使用者回報：「英文模式合成出來會是中文」。）
//
// 改成先看文字本身：有假名→JA、有諺文→KO、有漢字→ZH、其餘拉丁字母→EN。
// 再從電腦上已有的角色裡挑同語言的；能挑到同一個角色的該語言版本最好
// （同一個人的聲音，只是換語言模型），挑不到就用任何一個該語言的角色。
export function detectTextLang(text) {
  const s = String(text || "");
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(s)) return "JA";
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(s)) return "KO";
  if (/[\u4e00-\u9fff]/.test(s)) return "ZH";
  if (/[A-Za-z]/.test(s)) return "EN";
  return "";
}

let _voicesCache = [];
/** 依「這句話的語言」挑角色。回 {name, lang}；挑不到回 null（呼叫端就照舊）。 */
async function voiceForText(text) {
  const want = detectTextLang(text);
  if (!want) return null;
  const chosenName = state.settings.localVoiceName || "";
  const chosenLang = (state.settings.localVoiceLang || "").toUpperCase();
  if (chosenLang === want) return null;          // 選的角色本來就對，不必動
  if (!_voicesCache.length) _voicesCache = await localVoices();
  const same = _voicesCache.filter(v => (v.lang || "").toUpperCase() === want);
  if (!same.length) return null;                 // 電腦上沒有該語言的角色 → 只能沿用
  // 同一個角色的該語言版本優先（「花火 ZH」→「花火 EN」＝同一個人換語言）
  const base = chosenName.replace(/[ _](ZH|CN|EN|JA|JP|KO|KR)\b/i, "").trim();
  const sameChar = same.find(v => (v.name || "").replace(/[ _](ZH|CN|EN|JA|JP|KO|KR)\b/i, "").trim() === base);
  const pick = sameChar || same[0];
  return { name: pick.name, lang: want };
}

// 取得電腦上的語音模型清單 [{name, lang}]
export async function localVoices() {
  if (!_base && !(await detectLocalTts())) return [];
  try {
    const r = await _fetch("/voices", {}, 4000);
    const j = await r.json();
    const list = j && j.ok ? j.voices : [];
    if (list.length) _voicesCache = list;
    return list;
  } catch (e) { return []; }
}

// 雲端曲庫目錄索引（Apple Music 式）：整個 Drive 曲庫的角色，不限目前載入的。
// 回 [{name, character, lang, ok, emotions:[], bytes}]；連不上或無曲庫回 []。
export async function localCatalog() {
  if (!_base && !(await detectLocalTts())) return [];
  try {
    const r = await _fetch("/catalog", {}, 8000);
    const j = await r.json();
    const cat = j && j.ok ? j.catalog : null;
    return (cat && Array.isArray(cat.characters)) ? cat.characters : [];
  } catch (e) { return []; }
}

// 隨選下載：請運算端（電腦/Colab）把某角色從 Drive 拉到本地。回 {ok, bytes, files, error}。
export async function localPrepare(character, lang) {
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const q = "character=" + encodeURIComponent(character) + "&lang=" + encodeURIComponent(lang || "");
  const r = await _fetch("/prepare?" + q, {}, 300000);  // 大檔從 Drive 拉可能要一段時間
  try { return await r.json(); }
  catch (e) { return { ok: false, error: "prepare " + r.status }; }
}

// 切換 GPT-SoVITS 模型（載權重，較慢；切一次之後連續講不必再切）
export async function localSwitch(name, lang) {
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const r = await _fetch("/switch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, lang }),
  }, 120000);  // 載權重可能數十秒
  const j = await r.json();
  if (!j.ok) throw new Error(j.msg || j.error || t("err.switchFail"));
  return j;
}

// 只合成、不播放 → 回音訊 Blob。
// 自動演示要用：CPU 上每一句 GPT-SoVITS 要 20~30 秒，邊演邊合成的話錄出來
// 整支都是空白等待。先把整段旁白合成好、快取起來，錄影時才播得順。
export async function localSynth(text, opts = {}) {
  if (!text) return null;
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const body = { text };
  // 沒有明確指定角色時，依「這句話的語言」挑——不然英文會被當中文唸。
  const auto = opts.name ? null : await voiceForText(text).catch(() => null);
  if (auto) { opts = { ...opts, name: auto.name, lang: auto.lang }; }
  if (opts.name) { body.name = opts.name; body.lang = opts.lang || ""; }
  else if (state.settings.localVoiceName) {
    body.name = state.settings.localVoiceName;
    body.lang = state.settings.localVoiceLang || "";
  }
  const emo = opts.emotion || state.settings.voiceEmotion;
  if (emo) body.emotion = emo;
  const r = await _fetch("/speak", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 300000);   // 第一句要載權重，會比後面久很多
  if (!r.ok) {
    let e = ""; try { e = (await r.json()).error; } catch {}
    throw new Error(e || ("speak " + r.status));
  }
  return await r.blob();
}

let _audio = null;
let _audioUrl = null;
// 合成並播放：帶上目前選定的角色語音，橋接若發現和已載入的不同會自動切換。
// opts.emotion 可強制指定情緒（重症防呆模式固定「开心」＝GPT-SoVITS 版的語調輕快化）。
// opts.name/opts.lang 可蓋掉使用者選定的角色（自動演示的英文旁白要固定用 EN 角色，
//   不能跟著使用者當下選的中文語音跑）。
// opts.awaitEnd 為真時等到**播完**才 resolve；預設只等開始播。
//   演示的字幕與畫面要跟旁白對齊，只等 play() 會愈跑愈前面。
export async function localSpeak(text, opts = {}) {
  if (!text) return;
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const body = { text };
  // 沒有明確指定角色時，依「這句話的語言」挑——不然英文會被當中文唸。
  const auto = opts.name ? null : await voiceForText(text).catch(() => null);
  if (auto) { opts = { ...opts, name: auto.name, lang: auto.lang }; }
  if (opts.name) {
    body.name = opts.name;
    body.lang = opts.lang || "";
  } else if (state.settings.localVoiceName) {
    body.name = state.settings.localVoiceName;
    body.lang = state.settings.localVoiceLang || "";
  }
  const emo = opts.emotion || state.settings.voiceEmotion;
  if (emo) body.emotion = emo;   // 空＝橋接自動偵測情緒
  const r = await _fetch("/speak", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 120000);
  if (!r.ok) {
    let e = ""; try { e = (await r.json()).error; } catch {}
    throw new Error(e || ("speak " + r.status));
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  if (_audio) { try { _audio.pause(); } catch {} }
  if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch {} }   // 回收上一段（onended 沒觸發也不洩漏）
  _audioUrl = url;
  _audio = new Audio(url);
  const audio = _audio;
  const done = new Promise((resolve) => {
    const fin = () => { try { URL.revokeObjectURL(url); } catch {} if (_audioUrl === url) _audioUrl = null; resolve(); };
    audio.onended = fin;
    audio.onerror = fin;      // 播不出來也要放行，否則等它的人會永遠卡住
  });
  await audio.play();
  if (opts.awaitEnd) await done;
}

export function stopLocalSpeak() {
  if (_audio) { try { _audio.pause(); } catch {} }
}

// 電腦端生圖（SD-Turbo）→ 回 object URL
export async function localImage(prompt, steps = 2) {
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const r = await _fetch("/image", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps }),
  }, 180000);
  if (!r.ok) { let e = ""; try { e = (await r.json()).error; } catch {} throw new Error(e || ("image " + r.status)); }
  return URL.createObjectURL(await r.blob());
}

// 電腦端文字推論（Qwen）→ 回字串
export async function localText(system, user, temperature) {
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const body = { system, user };
  if (typeof temperature === "number") body.temperature = temperature;
  const r = await _fetch("/text", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 120000);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || t("err.textFail"));
  return (j.text || "").trim();
}
