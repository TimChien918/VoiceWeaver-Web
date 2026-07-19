// 本地 GPT-SoVITS 語音橋接（透過 Mac/Windows「語音中心」的 9879 CORS 橋接端點）。
//
// 瀏覽器混合內容限制：本網頁掛在 HTTPS（github.io），只能連
//   ① http://localhost / 127.0.0.1（瀏覽器例外，限「開網頁的電腦＝語音中心電腦」）
//   ② https://<主機>.<tailnet>.ts.net（Tailscale serve 的真憑證網址，任何地方可連）
// 連不上時上層會自動退回瀏覽器原生語音。
import { state } from "./store.js";
import { t } from "./i18n.js";

let _base = null;   // 已確認可用的橋接 base URL
let _health = { voice: false, image: false, text: false };  // 電腦端三項運算可用性

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

async function _fetch(path, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch((_base || "") + path, { ...opts, signal: ctrl.signal });
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
      const r = await fetch(base + "/health", { signal: ctrl.signal });
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

// 取得電腦上的語音模型清單 [{name, lang}]
export async function localVoices() {
  if (!_base && !(await detectLocalTts())) return [];
  try {
    const r = await _fetch("/voices", {}, 4000);
    const j = await r.json();
    return j && j.ok ? j.voices : [];
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

let _audio = null;
let _audioUrl = null;
// 合成並播放：帶上目前選定的角色語音，橋接若發現和已載入的不同會自動切換。
// opts.emotion 可強制指定情緒（重症防呆模式固定「开心」＝GPT-SoVITS 版的語調輕快化）。
export async function localSpeak(text, opts = {}) {
  if (!text) return;
  if (!_base && !(await detectLocalTts())) throw new Error(t("err.notConnected"));
  const body = { text };
  if (state.settings.localVoiceName) {
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
  _audio.onended = () => { try { URL.revokeObjectURL(url); } catch {} if (_audioUrl === url) _audioUrl = null; };
  await _audio.play();
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
