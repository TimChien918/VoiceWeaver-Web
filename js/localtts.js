// 本地 GPT-SoVITS 語音橋接（透過 Mac/Windows「語音中心」的 9879 CORS 橋接端點）。
//
// 瀏覽器混合內容限制：本網頁掛在 HTTPS（github.io），只能連
//   ① http://localhost / 127.0.0.1（瀏覽器例外，限「開網頁的電腦＝語音中心電腦」）
//   ② https://<主機>.<tailnet>.ts.net（Tailscale serve 的真憑證網址，任何地方可連）
// 連不上時上層會自動退回瀏覽器原生語音。
import { state } from "./store.js";

let _base = null;   // 已確認可用的橋接 base URL
let _health = { voice: false, image: false, text: false };  // 電腦端三項運算可用性

// 候選位址：使用者手填（Tailscale https）優先，再試同機 localhost。
function candidates() {
  const list = [];
  const manual = (state.settings.localTtsUrl || "").trim().replace(/\/+$/, "");
  if (manual) list.push(manual);
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
export async function detectLocalTts(timeoutMs = 2500) {
  for (const base of candidates()) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(base + "/health", { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok) {
          _base = base;
          _health = { voice: !!j.voice, image: !!j.image, text: !!j.text };
          return { base, current: j.current || "", health: { ..._health } };
        }
      }
    } catch (e) { /* 試下一個 */ }
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

// 切換 GPT-SoVITS 模型（載權重，較慢；切一次之後連續講不必再切）
export async function localSwitch(name, lang) {
  if (!_base && !(await detectLocalTts())) throw new Error("未連線到語音中心");
  const r = await _fetch("/switch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, lang }),
  }, 120000);  // 載權重可能數十秒
  const j = await r.json();
  if (!j.ok) throw new Error(j.msg || j.error || "切換失敗");
  return j;
}

let _audio = null;
// 用目前載入的語音合成並播放（語言由載入的模型決定，不從 UI 帶）
export async function localSpeak(text) {
  if (!text) return;
  if (!_base && !(await detectLocalTts())) throw new Error("未連線到語音中心");
  const r = await _fetch("/speak", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }, 120000);
  if (!r.ok) {
    let e = ""; try { e = (await r.json()).error; } catch {}
    throw new Error(e || ("speak " + r.status));
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  if (_audio) { try { _audio.pause(); } catch {} }
  _audio = new Audio(url);
  _audio.onended = () => URL.revokeObjectURL(url);
  await _audio.play();
}

export function stopLocalSpeak() {
  if (_audio) { try { _audio.pause(); } catch {} }
}

// 電腦端生圖（SD-Turbo）→ 回 object URL
export async function localImage(prompt, steps = 2) {
  if (!_base && !(await detectLocalTts())) throw new Error("未連線到語音中心");
  const r = await _fetch("/image", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps }),
  }, 180000);
  if (!r.ok) { let e = ""; try { e = (await r.json()).error; } catch {} throw new Error(e || ("image " + r.status)); }
  return URL.createObjectURL(await r.blob());
}

// 電腦端文字推論（Qwen）→ 回字串
export async function localText(system, user) {
  if (!_base && !(await detectLocalTts())) throw new Error("未連線到語音中心");
  const r = await _fetch("/text", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, user }),
  }, 120000);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "文字推論失敗");
  return (j.text || "").trim();
}
