// 在瀏覽器裡直接跑模型（WebGPU）。不經任何伺服器、不用金鑰、下載完可離線。
//
// 為什麼值得做：這個 App 的使用者講的常常是很私密的事——身體哪裡痛、想不想活。
// 那些句子目前都會送到某一家雲端供應商。跑在本機的話，一個字都不會離開這台裝置。
// 而且下載過一次之後沒有網路也能用，對帶著手機在外面的人是實際的差別。
//
// **為什麼預設關閉、而且一定要使用者自己按**：
// 模型動輒好幾百 MB。在行動網路上自動下載是不能接受的——那是別人的流量費。
// 所以這裡什麼都不預載，連函式庫本身都是按下去才去抓。
//
// 硬體門檻很現實：要有 WebGPU（Chrome/Edge 較新版、桌面較穩），而且手機上
// 就算跑得動也會比雲端慢很多。所以它是**選項**，不是取代——雲端仍然是預設，
// 這一層排在雲端之後（跟「電腦幫忙跑」同一個位置，理由也一樣：
// 本機的價值在離線與隱私，不在速度）。

import { state, save } from "./store.js?v=1.5.76";

// WebLLM：把 MLC 編譯好的模型跑在 WebGPU 上。用 ESM CDN 動態載入，
// 不進 repo、也不影響沒開這個功能的人（完全不會被下載到）。
const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm";

/**
 * 挑幾個「小到手機也許扛得住」的。參數量越大品質越好但下載越久、記憶體越吃。
 * id 是 WebLLM 的模型代號，換版本時只有這裡要改。
 */
export const WEBGPU_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B（約 1.0 GB・較快）" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",   label: "Qwen2.5 3B（約 1.9 GB・較好）" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B（約 0.9 GB・最省）" },
];

// 有沒有「真的能用」的 WebGPU。null＝還沒測過。
let _adapterOk = null;

/**
 * 探測一次。**不能只看 navigator.gpu 存不存在**——很多環境（無頭瀏覽器、
 * 沒有合適 GPU 的機器、被停用的顯示卡）物件在、requestAdapter() 卻回 null。
 * 只看物件的話，這張卡會對一台根本跑不動的裝置說「可以用」，
 * 使用者按下去等半天下載完才失敗。
 */
export async function probeWebgpu(){
  if(_adapterOk !== null) return _adapterOk;
  if(typeof navigator === "undefined" || !navigator.gpu){ _adapterOk = false; return false; }
  try{ _adapterOk = !!(await navigator.gpu.requestAdapter()); }
  catch{ _adapterOk = false; }
  return _adapterOk;
}

/** 探測結果（還沒探測過時回 false，寧可保守）。 */
export function webgpuSupported(){ return _adapterOk === true; }

/** 使用者有沒有開啟這個功能。 */
export function webgpuEnabled(){ return !!state.settings.webgpuEnabled; }

export function setWebgpuEnabled(on){
  state.settings.webgpuEnabled = !!on;
  save();
}

export function webgpuModel(){
  return state.settings.webgpuModel || WEBGPU_MODELS[0].id;
}
export function setWebgpuModel(id){
  state.settings.webgpuModel = id || "";
  // 換模型等於換一份權重，已經載好的那個要丟掉，否則會繼續用舊的。
  unload();
  save();
}

let _engine = null;      // 載好的引擎
let _loading = null;     // 正在載的那一次（避免同時載兩份）
let _loadedId = "";      // 目前載的是哪一個模型
let _onProgress = () => {};

/** 讓設定頁掛一個進度回呼（下載幾百 MB，沒有進度條使用者會以為當掉了）。 */
export function onWebgpuProgress(fn){ _onProgress = fn || (() => {}); }

/** 已經可以直接生成了嗎（載好且沒換模型）。 */
export function webgpuReady(){ return !!_engine && _loadedId === webgpuModel(); }

function unload(){
  // 只丟掉參考。WebLLM 的 engine 有自己的資源管理，重新 load 會接手；
  // 這裡不主動 terminate，因為正在生成到一半時 terminate 會炸在使用者面前。
  _engine = null;
  _loadedId = "";
}

/**
 * 載入模型。**只能從使用者的點擊呼叫**——它會下載好幾百 MB。
 *
 * 同一時間只載一份：使用者連按兩下就開兩條下載的話，流量加倍而且互相搶頻寬。
 */
export async function loadWebgpu(){
  if(webgpuReady()) return true;
  if(_loading) return _loading;
  if(!(await probeWebgpu())) throw new Error("noWebGPU");

  const id = webgpuModel();
  _loading = (async () => {
    const webllm = await import(/* @vite-ignore */ WEBLLM_CDN);
    const engine = await webllm.CreateMLCEngine(id, {
      initProgressCallback: (p) => {
        // p.progress 是 0~1，p.text 是英文的階段說明
        _onProgress({ progress: p?.progress ?? 0, text: p?.text || "" });
      },
    });
    _engine = engine;
    _loadedId = id;
    return true;
  })();

  try{ return await _loading; }
  finally{ _loading = null; }
}

/** 正在下載／初始化中嗎（畫面用來擋住重複點擊）。 */
export function webgpuLoading(){ return !!_loading; }

/**
 * 用本機模型生成一段文字。介面與 providers.js 的其他呼叫器一致，
 * 好讓 runLlm 可以一視同仁地把它排進備援順序裡。
 *
 * 沒載好就直接丟錯——**不在這裡自動下載**：這支會被重組、復健評分等等呼叫，
 * 那些都不是使用者按下「下載模型」的當下，偷偷開始抓幾百 MB 是不可接受的。
 */
export async function webgpuGenerate(sys, user, temp = 0.5){
  if(!webgpuReady()) throw new Error("webgpuNotLoaded");
  const res = await _engine.chat.completions.create({
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: temp,
    max_tokens: 300,
  });
  return (res?.choices?.[0]?.message?.content || "").trim();
}

/** 這一輪能不能用本機模型（開著、支援、而且已經載好）。 */
export function webgpuUsable(){
  return webgpuEnabled() && webgpuSupported() && webgpuReady();
}
