// 用「登入的那個 Google 帳號自己的額度」直接呼叫 Google 的 AI API（OAuth 2.0）。
//
// 為什麼要這條路：
// 原本每一家供應商都要使用者自己去申請一把 API 金鑰，貼進設定裡。對照顧者來說
// 那是一連串完全陌生的名詞（專案、金鑰、計費帳戶），光是「去哪裡申請」就會卡住，
// 而他要的只是「讓這個網頁能講話」。既然他已經用 Google 帳號登入了，就讓網頁
// 拿那個帳號的授權直接去打 Gemini——不必再有一把貼來貼去的金鑰。
//
// **OAuth 是用來「開通」，不是用來「呼叫」的。** 這一點繞了一大圈才弄清楚：
//
// generativelanguage.googleapis.com（Gemini API）**不收使用者的 OAuth 權杖**。
// 拿 Bearer token 去打 generateContent，一律回 403
// 「Request had insufficient authentication scopes」——而且沒有任何範圍能解，
// cloud-platform 也不行。那個端點就是設計成收 API 金鑰的。
// Google 自己的 Gemini CLI 走的是 cloudcode-pa.googleapis.com/v1internal，
// 一個沒有文件、request 格式不同的內部端點，不是第三方該依賴的東西。
// Google AI Studio 做得到「登入就用你的額度」，是因為它是 Google 第一方應用程式。
//
// 所以這裡的做法是：**用 OAuth 在使用者自己的專案裡開一把 API 金鑰**，
// 之後就拿那把金鑰打 Gemini（`?key=`，也就是那個端點唯一收的東西）。
// 對使用者來說結果一樣——他沒有去申請、沒有複製貼上任何東西，用量算在他自己
// 的專案上——但走的是 Google 真正支援的路。
//
// 副作用是好的：API 金鑰不會過期，所以日常呼叫不再受 access token「一小時到期」
// 的折磨；OAuth 只在第一次開通（挑專案、啟用 API、開金鑰）時用得到。
//
// 兩種拿權杖的方式，能用哪個就用哪個：
//   ① Google Identity Services（GIS）token client —— 要在 config.js 設 clientId。
//      好處是可以**安靜地續期**（prompt:""），權杖過期時使用者多半不會被打斷。
//   ② 沒設 clientId 時退回 Firebase 的 signInWithPopup，順便多要一個授權範圍。
//      不必額外設定就能用，代價是一小時到期後要使用者自己按一下重新授權
//      （跟 Drive 授權現在的處境一樣）。
//
// 關於授權範圍：cloud-platform 很大（等於整個 Google Cloud 的操作權）。
// 這不是我們想要的最小權限，但 Generative Language API 走使用者帳號時就是收這個。
// **登入時就一起要**（見 store.js 的 CLOUD_SCOPE）：不然使用者登入完會拿到一個
// 「還不能講話」的 App，得自己到設定裡找一張卡、按授權、選專案——而這個 App 的
// 使用者本來就不擅長在設定裡定位，等於預設是壞的。
// 不同意也不會卡住：拿不到權杖時帳號額度那幾筆供應商自動跳過，其餘功能照舊。
//
// 拿到權杖之後 autoSetup() 會在背景把剩下的鋪完（挑專案、啟用 API），
// 所以正常情況下使用者從頭到尾不用選任何東西；設定卡是給要改的人用的。

import { state, save, loginGoogle, CLOUD_SCOPE, clearCloudScopeBlock } from "./store.js?v=1.5.61";
import { t } from "./i18n.js?v=1.5.61";

export { CLOUD_SCOPE };

const TOKEN_LS = "vw_gq_token";
const EXP_LS   = "vw_gq_exp";
// 快到期就當作已經過期：權杖在「送出請求」與「Google 檢查」之間還要跑一段網路，
// 卡在最後幾秒送出去的那一次會拿到 401，而使用者只看得到「重組失敗」。
const SKEW_MS = 60_000;

let _token = "";
let _expAt = 0;
try{
  _token = sessionStorage.getItem(TOKEN_LS) || "";
  _expAt = +(sessionStorage.getItem(EXP_LS) || 0);
}catch{}

function remember(token, expiresInSec){
  _token = token || "";
  _expAt = token ? Date.now() + (expiresInSec || 3600) * 1000 : 0;
  // 存在 sessionStorage 而不是 localStorage：跟 Drive 權杖同一個理由——
  // access token 跨工作階段留存會擴大 XSS 的曝險面，而它一小時就失效。
  try{
    if(token){ sessionStorage.setItem(TOKEN_LS, token); sessionStorage.setItem(EXP_LS, String(_expAt)); }
    else { sessionStorage.removeItem(TOKEN_LS); sessionStorage.removeItem(EXP_LS); }
  }catch{}
}

function tokenAlive(){ return !!_token && Date.now() < _expAt - SKEW_MS; }

/** 忘掉目前的權杖（登出、或 Google 說它無效時）。 */
export function forgetToken(){ remember("", 0); }

/**
 * 收下一把從別處拿到的權杖。
 *
 * 一般登入（loginGoogle）本身就會要 cloud-platform，拿回來的那把權杖跟這裡
 * 自己去要的是同一種東西。收下它，使用者就不必為了同一件事再同意一次——
 * 「登入完就能用」靠的就是這一步。
 */
export function adoptToken(token, expiresInSec){
  if(token) remember(token, expiresInSec || 3600);
}

// ── 設定：使用者自己的 Google Cloud 專案 ──────────────────

function quotaCfg(){
  if(!state.settings.accountQuota || typeof state.settings.accountQuota !== "object"){
    state.settings.accountQuota = { project: "" };
  }
  return state.settings.accountQuota;
}

/** 額度要算在哪個 Google Cloud 專案（空字串＝還沒選）。 */
export function quotaProject(){ return (quotaCfg().project || "").trim(); }

/**
 * 本網頁在使用者專案裡自動開出來的 Gemini API 金鑰。
 *
 * 這把金鑰是「開通」的產物，不是要使用者保管的東西——他從頭到尾不會看到它，
 * 也不必知道它存在。存在設定裡（跟其他金鑰同一個地方）是因為它不會過期，
 * 存著就不必每次開頁都重新開一把。
 */
export function accountApiKey(){ return (quotaCfg().apiKey || "").trim(); }
export function setAccountApiKey(k){ quotaCfg().apiKey = (k || "").trim(); save(); }

export function setQuotaProject(id){
  quotaCfg().project = (id || "").trim();
  save();
}

/** 這個分頁手上有沒有還沒過期的權杖（＝授權那一步做完了）。 */
export function authorized(){ return tokenAlive(); }

/**
 * 現在就打得動 Gemini 嗎。
 *
 * 只看「專案選好了沒」與「金鑰開好了沒」，**不看 access token 還活著沒有**——
 * 金鑰不會過期，開通完成之後 OAuth 就功成身退了。這也是為什麼使用者不會再遇到
 * 「講到一半要重新授權」：那個一小時的限制只影響開通，不影響講話。
 */
export function accountQuotaReady(){ return !!quotaProject() && !!accountApiKey(); }

/** 開通做到一半（挑了專案卻還沒開出金鑰），而這個分頁又沒有權杖可以繼續。 */
export function needsReauth(){ return !!quotaProject() && !accountApiKey() && !tokenAlive(); }

// ── ① Google Identity Services ─────────────────────────

function gisClientId(){ return (window.__GOOGLE_OAUTH__?.clientId || "").trim(); }

/** 有沒有設 OAuth 用戶端 ID（有的話才有安靜續期）。 */
export function hasGisClient(){ return !!gisClientId(); }

let _gisLoading = null;
function loadGis(){
  if(window.google?.accounts?.oauth2) return Promise.resolve();
  if(_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    // 載不到就讓呼叫端退回 Firebase 那條路，不要整個功能死在這裡
    s.onerror = () => { _gisLoading = null; reject(new Error("gisLoadFailed")); };
    document.head.appendChild(s);
  });
  return _gisLoading;
}

let _tc = null;
async function gisToken(interactive){
  await loadGis();
  if(!_tc){
    _tc = window.google.accounts.oauth2.initTokenClient({
      client_id: gisClientId(),
      scope: CLOUD_SCOPE,
      callback: () => {},          // 每次請求前才換成當下那一組 resolve/reject
    });
  }
  return new Promise((resolve, reject) => {
    _tc.callback = (res) => {
      if(res && res.access_token){ remember(res.access_token, res.expires_in); resolve(res.access_token); }
      else reject(new Error(res?.error || "noToken"));
    };
    _tc.error_callback = (err) => reject(new Error(err?.type || err?.message || "gisError"));
    // prompt:"" ＝「已經同意過就不要再問一次」。使用者的 Google 工作階段還在時
    // 這一步不會打斷他；不在時會失敗，由呼叫端顯示「請重新授權」。
    try{ _tc.requestAccessToken({ prompt: interactive ? "consent" : "" }); }
    catch(e){ reject(e); }
  });
}

// ── ② Firebase 彈窗（沒設 clientId 時的退路）─────────────

async function firebaseToken(){
  // forceCloudScope：使用者是為了這件事才按下授權的，就算上次被擋過也要再試一次
  // ——擋人的多半是專案設定，而那是管理員隨時可能修好的東西。
  const res = await loginGoogle({ forceCloudScope: true });
  if(!res?.token) throw new Error("noToken");
  // Firebase 不會告訴我們這個權杖能活多久；Google 的 access token 一律是一小時。
  remember(res.token, 3600);
  return res.token;
}

// ── 對外：拿一個可用的權杖 ──────────────────────────────

/**
 * 目前可用的 access token。
 *
 * interactive=false：只做不打擾使用者的續期，失敗就丟錯（畫面顯示「請重新授權」）。
 * interactive=true ：該跳同意畫面就跳——只能從使用者的點擊裡呼叫，
 *                    否則彈窗會被瀏覽器擋掉。
 */
export async function googleToken({ interactive = false } = {}){
  if(tokenAlive()) return _token;
  if(hasGisClient()){
    try{ return await gisToken(interactive); }
    catch(e){
      // GIS 載不動（擋追蹤的外掛常常連 accounts.google.com 一起擋）才換另一條路；
      // 其他錯誤是這條路自己的問題（使用者關掉彈窗、工作階段過期），照實往上丟，
      // 不要拿 Firebase 彈窗去蓋掉它——那會變成關掉一個彈窗又跳出另一個。
      if(String(e.message) !== "gisLoadFailed") throw interactive ? e : authNeeded();
    }
  }
  if(!interactive) throw authNeeded();
  return firebaseToken();
}

/**
 * 「要重新授權」這件事。
 *
 * 訊息用譯好的句子而不是 needsAuth 這種代碼：這個錯誤會一路冒到畫面上
 * （設定卡的訊息列、重組失敗的提示），而使用者看到 needsAuth 只會困惑。
 * 要判斷型別的地方看 e.code，不要比對訊息文字——那會在換語言時失效。
 */
function authNeeded(){
  const e = new Error(t("gq.errExpired"));
  e.code = "needsAuth";
  return e;
}

/**
 * 安靜地試著拿一把權杖，拿不到就算了。
 *
 * 給「已經登入、但這個分頁沒有權杖」用（重開瀏覽器）。絕不跳同意畫面：
 * 那必須由使用者的點擊發動，否則彈窗會被瀏覽器擋掉，而且他只是開個網頁，
 * 不該無緣無故被 Google 的畫面打斷。
 */
export async function silentToken(){
  return googleToken({ interactive: false });
}

/** 使用者按下「授權」：一定跳同意畫面，回傳有沒有拿到權杖。 */
export async function authorize(){
  forgetToken();                       // 舊的可能是別的帳號或別的範圍拿的
  clearCloudScopeBlock();              // 他明確要求要試，把上次的黑名單記號清掉
  const tok = await googleToken({ interactive: true });
  return !!tok;
}

// ── 打 Google API：自動帶權杖與計費專案，401 自動續一次 ──

/**
 * 送一個帶著使用者身分的 Google API 請求。
 *
 * @param url      完整網址
 * @param opts     fetch 選項
 * @param withProject 要不要帶 x-goog-user-project（列專案清單時不能帶——
 *                    那時候還不知道要選哪個，帶一個空的或錯的反而整個請求被拒）
 */
export async function googleApiFetch(url, opts = {}, { withProject = true } = {}){
  const send = async (token) => {
    const headers = { ...(opts.headers || {}), Authorization: "Bearer " + token };
    const proj = quotaProject();
    if(withProject && proj) headers["x-goog-user-project"] = proj;
    return fetch(url, { ...opts, headers });
  };

  let res = await send(await googleToken());
  if(res.status === 401){
    // 權杖被撤銷或提早失效：清掉之後再要一次（GIS 那條路多半可以安靜換到新的）。
    forgetToken();
    // 換不到就把原本那個 401 交回去。硬把「換權杖失敗」丟出來的話，呼叫端
    // 就少了一個 Response 可以翻譯，畫面上會出現一句沒頭沒尾的技術訊息；
    // 401 走 googleApiError 反而會變成「授權過期了，請按重新授權」。
    try{ res = await send(await googleToken()); }
    catch{ return res; }
  }
  return res;
}

/**
 * 把 Google 的錯誤翻成使用者看得懂的一句話。
 *
 * 這裡值得多花力氣：這條路最常見的兩種失敗都不是「壞掉了」，而是「還差一個步驟」，
 * 但原文訊息長得像系統錯誤（SERVICE_DISABLED、PERMISSION_DENIED），
 * 照顧者看到只會以為是網頁有問題，然後放棄。
 */
export async function googleApiError(res){
  let body = null;
  try{ body = await res.json(); }catch{}
  const err = body?.error || {};
  const status = err.status || "";
  const msg = err.message || `HTTP ${res.status}`;
  const proj = quotaProject();

  if(res.status === 401) return new Error(t("gq.errExpired"));
  if(status === "PERMISSION_DENIED" && /SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg))
    return new Error(t("gq.errApiDisabled").replace("{project}", proj));
  if(status === "PERMISSION_DENIED" && /serviceusage\.services\.use|caller does not have permission/i.test(msg))
    return new Error(t("gq.errNoProjectPerm").replace("{project}", proj));
  if(status === "RESOURCE_EXHAUSTED") return new Error(t("gq.errQuota").replace("{project}", proj));
  if(status === "PERMISSION_DENIED" && /apikeys|api key/i.test(msg))
    return new Error(t("gq.errKeyPerm").replace("{project}", proj));
  return new Error(msg);
}

// ── 專案：列出使用者自己的 Google Cloud 專案 ────────────────

/**
 * 使用者名下的專案清單（只留活著的）。
 *
 * 為什麼要列而不是叫他自己打：專案 ID 跟專案名稱長得不一樣（「我的專案」的 ID
 * 可能是 my-project-418302），使用者手打十之八九會打錯，而打錯的症狀是
 * 一個看不懂的 403——他不會知道問題出在那一格。
 */
export async function listProjects(){
  const url = "https://cloudresourcemanager.googleapis.com/v1/projects?filter="
            + encodeURIComponent("lifecycleState:ACTIVE") + "&pageSize=200";
  const res = await googleApiFetch(url, {}, { withProject: false });
  if(!res.ok) throw await googleApiError(res);
  const j = await res.json();
  return (j.projects || []).map(p => ({ id: p.projectId, name: p.name || p.projectId }));
}

/** 在使用者的專案上啟用某個 API（沒啟用的話那個 API 每一次呼叫都會 403）。 */
export async function enableService(service){
  const proj = quotaProject();
  if(!proj) throw new Error(t("gq.errNoProject"));
  const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(proj)}`
            + `/services/${service}:enable`;
  const res = await googleApiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
                                   { withProject: false });
  if(!res.ok) throw await googleApiError(res);
  return true;
}

/** 啟用 Gemini API。 */
export async function enableGenerativeLanguage(){
  return enableService("generativelanguage.googleapis.com");
}

// ── 在使用者自己的專案裡開一把 Gemini 金鑰 ──────────────
//
// 這是整個功能真正work的地方。流程是 Google API Keys API v2：
//   建立 → 回一個 long-running Operation → 輪詢到 done → 回應裡才有 keyString。
// （ListKeys/GetKey 基於安全考量不會回 keyString，要另外打 GetKeyString。）

const KEY_LABEL = "VoiceWeaver";
const APIKEYS = "https://apikeys.googleapis.com/v2";

/** 這個專案裡本網頁之前開過的那把金鑰（找不到回 null）。 */
async function findExistingKey(proj){
  const res = await googleApiFetch(
    `${APIKEYS}/projects/${encodeURIComponent(proj)}/locations/global/keys`, {}, { withProject:false });
  if(!res.ok) return null;
  const j = await res.json();
  const hit = (j.keys || []).find(k => k.displayName === KEY_LABEL && !k.deleteTime);
  if(!hit) return null;
  // 清單不會給 keyString，要另外要一次
  const ks = await googleApiFetch(`${APIKEYS}/${hit.name}/keyString`, {}, { withProject:false });
  if(!ks.ok) return null;
  return (await ks.json()).keyString || null;
}

/** 建立一把新的，限定只能打 Gemini。 */
async function createKey(proj){
  const res = await googleApiFetch(
    `${APIKEYS}/projects/${encodeURIComponent(proj)}/locations/global/keys`,
    { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        displayName: KEY_LABEL,
        // 限定用途：這把金鑰只打得動 Gemini。萬一外流，能做的事就只有這一件。
        restrictions: { apiTargets: [{ service: "generativelanguage.googleapis.com" }] },
      }) },
    { withProject:false });
  if(!res.ok) throw await googleApiError(res);
  const op = await res.json();
  if(op.done && op.response?.keyString) return op.response.keyString;

  // 還沒好就輪詢那個 Operation。實測多半兩三秒內完成，給到約 30 秒。
  for(let i=0; i<15; i++){
    await new Promise(r => setTimeout(r, 2000));
    const chk = await googleApiFetch(`${APIKEYS}/${op.name}`, {}, { withProject:false });
    if(!chk.ok) continue;
    const o = await chk.json();
    if(o.error) throw new Error(o.error.message || "createKey failed");
    if(o.done) return o.response?.keyString || null;
  }
  throw new Error(t("gq.errKeySlow"));
}

/**
 * 確保使用者的專案裡有一把可用的 Gemini 金鑰，並記下來。
 *
 * 先找舊的再開新的：每次開頁都開一把新金鑰的話，使用者的專案裡會累積一堆
 * 同名金鑰，而他根本不知道那些是誰開的。
 */
export async function ensureApiKey(){
  if(accountApiKey()) return accountApiKey();
  const proj = quotaProject();
  if(!proj) throw new Error(t("gq.errNoProject"));

  // 開金鑰本身也要先啟用 API Keys API（跟 Gemini API 是兩回事）
  try{ await enableService("apikeys.googleapis.com"); }catch(e){ console.warn("enable apikeys", e); }

  let key = null;
  try{ key = await findExistingKey(proj); }catch(e){ console.warn("findExistingKey", e); }
  if(!key) key = await createKey(proj);
  if(!key) throw new Error(t("gq.errKeySlow"));
  setAccountApiKey(key);
  return key;
}

/** 真的打一次最小的請求，確認整條路（專案＋API 已啟用＋金鑰）是通的。 */
export async function testAccountQuota(model){
  const key = await ensureApiKey();      // 沒有就順手開一把
  // 用 ?key= 打，跟正式呼叫走同一條路——測試要測的是真的會用的那條，
  // 不是另外一條「測起來會過但實際上不通」的路。
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`
            + `:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }],
                           generationConfig: { maxOutputTokens: 1 } }),
  });
  if(!res.ok) throw await googleApiError(res);
  return true;
}

// ── 登入後自動把整條路鋪好 ────────────────────────────────

const AUTO_PREFIX = "voiceweaver-";   // 本網頁自己建的專案認得出來

/** 這個專案有沒有啟用 Generative Language API。問不到就當作沒有。 */
async function apiEnabled(projectId){
  try{
    const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
              + "/services/generativelanguage.googleapis.com";
    const res = await googleApiFetch(url, {}, { withProject: false });
    if(!res.ok) return false;
    return (await res.json()).state === "ENABLED";
  }catch{ return false; }
}

/**
 * 使用者一個 Google Cloud 專案都沒有時，幫他建一個。
 *
 * 為什麼敢這樣做：沒有專案就等於「這條路完全走不通」，而這時候沒有任何東西
 * 好讓使用者選——不是替他做決定，是把唯一的選項準備好。建出來的專案在他自己
 * 帳號底下，看得到也刪得掉，名字就叫 VoiceWeaver，一眼認得出是誰建的。
 *
 * 建立是非同步的（回一個 Operation），所以要等它真的好；等太久就放棄，
 * 由設定卡顯示「請自己建一個」——背景工作不該把使用者卡在那裡。
 */
async function createProject(){
  const id = AUTO_PREFIX + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const res = await googleApiFetch("https://cloudresourcemanager.googleapis.com/v1/projects",
    { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ projectId: id, name: "VoiceWeaver" }) },
    { withProject: false });
  if(!res.ok) throw await googleApiError(res);
  // 最多等約 30 秒。專案要「真的存在」之後才啟用得了 API。
  for(let i=0; i<10; i++){
    await new Promise(r => setTimeout(r, 3000));
    const chk = await googleApiFetch(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(id)}`,
      {}, { withProject: false });
    if(chk.ok && (await chk.json()).lifecycleState === "ACTIVE") return { id, name: "VoiceWeaver" };
  }
  throw new Error(t("gq.errCreateSlow"));
}

/**
 * 登入之後在背景把「用我的帳號額度」整條路鋪好，不用使用者自己選。
 *
 * 回傳一個狀態字串給畫面用：
 *   ready       —— 好了，可以直接講話
 *   noToken     —— 使用者沒同意 cloud-platform（或匿名登入）→ 安靜略過
 *   noKey       —— 專案有了，但開不出 API 金鑰（多半是沒有 apikeys 權限）
 *   noProjects  —— 一個專案都沒有，而且自動建立也失敗了
 *   listFailed  —— 列不出專案（多半是沒同意範圍）
 *
 * 全程失敗都不拋錯：這是背景工作，使用者只是想登入。走不通就退回原本的
 * 「瀏覽器語音＋自己貼金鑰」，不要在登入完的第一個畫面丟一串錯誤給他。
 */
export async function autoSetup(){
  if(!tokenAlive()) return "noToken";

  // 已經選好專案：只確認 API 開著（開過的話這一步幾乎是零成本）
  if(quotaProject()){
    if(!(await apiEnabled(quotaProject()))){
      try{ await enableGenerativeLanguage(); }catch{}
    }
    // 金鑰才是真正能打 Gemini 的東西，沒有就開一把
    if(!accountApiKey()){
      try{ await ensureApiKey(); }catch(e){ console.warn("autoSetup ensureApiKey", e); return "noKey"; }
    }
    return "ready";
  }

  let projects;
  try{ projects = await listProjects(); }
  catch{ return "listFailed"; }

  let pick = null;
  if(projects.length === 1) pick = projects[0];
  else if(projects.length > 1){
    // 挑「已經啟用過 Gemini API 的那個」——那多半就是他上次用的。
    // 問太多次會拖慢登入，所以只看前 10 個。
    for(const p of projects.slice(0, 10)){
      if(await apiEnabled(p.id)){ pick = p; break; }
    }
    // 都沒啟用過就挑本網頁自己建過的；再沒有就挑第一個。
    // 挑第一個是在「替他決定」沒錯，但設定卡上會明白寫出用的是哪一個，
    // 而且下拉隨時可以改——比讓他登入完發現不能講話好。
    pick = pick || projects.find(p => p.id.startsWith(AUTO_PREFIX)) || projects[0];
  } else {
    try{ pick = await createProject(); }
    catch(e){ console.warn("autoSetup createProject", e); return "noProjects"; }
  }

  setQuotaProject(pick.id);
  try{ await enableGenerativeLanguage(); }catch(e){ console.warn("autoSetup enable", e); }
  // 開金鑰要在啟用 Gemini API 之後：金鑰的用途限制指到那個服務，
  // 服務沒啟用時 Google 有機會拒絕這個限制。
  try{ await ensureApiKey(); }
  catch(e){ console.warn("autoSetup ensureApiKey", e); return "noKey"; }
  return "ready";
}
