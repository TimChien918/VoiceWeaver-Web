// 狀態保存：Firebase（登入 + Firestore 自動同步）；沒設定 Firebase 時退回 localStorage。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, getDocs, query, orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { t } from "./i18n.js?v=1.5.26";

const DEFAULTS = {
  settings: { theme: "auto", lang: "zh-TW", rate: 0.95, font: 1.0,
              // 使用模式（依嚴重程度，對齊 App）：
              //   mild 輕度＝鍵盤打字為主、完整功能
              //   moderate 中度＝超大圖卡預設展開、隱藏複雜設定
              //   severe 重度＝全螢幕識字卡逐張掃描＋特大字體
              severityMode: "mild",
              kioskPin: "1234",       // 重度退出 PIN（4 位數字）
              aacScale: 1,            // 圖卡字級 1~4（3=特大→2欄、4=巨大→1欄，網格自動降級）
              // 意圖確認大圖卡：組完句子先跳大 emoji＋大字確認，按「對」才唸出來。
              // 預設開——對不識字的使用者，這是發聲前唯一能攔下錯誤的一關。
              confirmCard: true,
              currency: "NTD",        // 自訂金額的預設幣別
              style: "tech",          // 視覺風格：tech／cute／anime／minimal（同 App）
              highContrast: false,    // 高對比（無障礙）：純黑底＋高彩文字
              currentLocationTag: "", // 最近一次定位的地點標籤（圖卡推薦排序的情境加成用）
              // 網頁端聲波比對。**預設關閉。**
              // 演算法本身與 App 完全一致（對照測試證實 DTW 距離相對誤差 3e-7、
              // 樣板 blob 位元相同），但「登錄與比對用不同麥克風」這件事沒有解——
              // 門檻是從登錄錄音的變異算出來的，換一支麥克風就不一定還對得上。
              // 所以要不要開由使用者決定，而且開了之後建議在網頁上重新登錄一組。
              acousticMatch: false,
              // 本地 GPT-SoVITS 語音引擎（透過語音中心橋接）
              localTtsEnabled: false, localTtsUrl: "", localComputeServers: [], localVoiceName: "", localVoiceLang: "", voiceEmotion: "" },
  // 單一欄位的金鑰（通報用）
  apiKeys:  { tgtoken: "", tgchat: "", ngrokToken: "", ngrokDomain: "", ngrokPairCode: "" },
  // 多供應商、多金鑰清單（每筆 {id, provider, key, model}）→ 重組/生圖自動輪詢
  llmApis:  [],
  imageApis:[],
};

let _idc = 0;
export function newId(){ return "k" + Date.now().toString(36) + (_idc++).toString(36); }

// 產生一組不可猜的配對碼（24 字），只產一次並存進帳號設定。
export function ensurePairCode(){
  if(!state.apiKeys.ngrokPairCode){
    // 這串等於 ngrok token 的密碼（誰拿到就讀得到 cloudbridge 那份文件），
    // 所以亂數缺席時**不能靜靜地產生一串 0**——那是一組人人都猜得到的碼。
    const a = new Uint8Array(18);
    if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(a);
    else for(let i=0;i<a.length;i++) a[i] = Math.floor(Math.random()*256);
    state.apiKeys.ngrokPairCode = "vw" + Array.from(a, b=>b.toString(36).padStart(2,"0")).join("").slice(0,22);
    save();   // 沒存檔的話下次載入又產一組新的，Colab 那端就再也對不上
  }
  return state.apiKeys.ngrokPairCode;
}

// 把 ngrok 授權碼／固定網域鏡射到 cloudbridge/{配對碼}，讓 Colab 用配對碼從雲端取用。
// token 本身不外流：只有拿到「不可猜的配對碼」才讀得到這份文件。
export async function pushNgrokBridge(){
  if(!_db || !state.uid || state.uid==="local") return false;   // 需登入 Firebase
  const code = ensurePairCode();
  try{
    await setDoc(doc(_db,"cloudbridge",code), {
      ngrokToken: state.apiKeys.ngrokToken || "",
      ngrokDomain: state.apiKeys.ngrokDomain || "",
      updatedAt: Date.now(),
    });
    return true;
  }catch(e){ console.warn("pushNgrokBridge failed", e); return false; }
}

export const state = {
  uid: null, online: false,
  settings: structuredClone(DEFAULTS.settings),
  apiKeys: structuredClone(DEFAULTS.apiKeys),
  llmApis: [],
  imageApis: [],
  favorites: [],   // 我的最愛常用句
  // 行為數據彙總（治療師評估用）：只存彙總不存逐筆；清歷史不影響它。
  behavior: {},
  // 自訂圖卡（拍照建檔）：[{id, word, pos, img(dataURL 縮圖)}]。
  // 讓長輩看到「自己熟悉的物品照片」建立信任；照片壓成小縮圖存設定文件。
  customCards: [],
};

/** 切換收藏一句（回傳是否為已加入）。 */
export function toggleFavorite(sentence){
  const s = (sentence||"").trim();
  if(!s) return false;
  const i = state.favorites.indexOf(s);
  if(i>=0){ state.favorites.splice(i,1); save(); return false; }
  state.favorites.unshift(s); state.favorites = state.favorites.slice(0,50); save(); return true;
}

// 舊版單一金鑰 → 自動轉成清單第一筆（相容升級）
function migrate(d){
  const ak = d.apiKeys || {};
  if((!d.llmApis || !d.llmApis.length)){
    const seed = [];
    for(const p of ["gemini","groq","openrouter"]) if(ak[p]) seed.push({ id:newId(), provider:p, key:ak[p], model:"" });
    if(seed.length) d.llmApis = seed;
  }
  if((!d.imageApis || !d.imageApis.length)) d.imageApis = [{ id:newId(), provider:"pollinations", key:"", model:"" }];
  // 舊「輕重症雙軌」uiMode → 新三段 severityMode（severe 保留、其餘視為輕度）
  if(d.settings && d.settings.uiMode && !d.settings.severityMode){
    d.settings.severityMode = d.settings.uiMode === "severe" ? "severe" : "mild";
  }
  return d;
}
function applyLoaded(d){
  state.settings = { ...DEFAULTS.settings, ...(d.settings||{}) };
  state.apiKeys  = { ...DEFAULTS.apiKeys,  ...(d.apiKeys||{}) };
  state.llmApis  = Array.isArray(d.llmApis) ? d.llmApis : [];
  state.imageApis= Array.isArray(d.imageApis) ? d.imageApis : [];
  state.favorites= Array.isArray(d.favorites) ? d.favorites : [];
  state.customCards = Array.isArray(d.customCards) ? d.customCards : [];
  state.behavior = (d.behavior && typeof d.behavior === "object") ? d.behavior : {};
  // 相容：舊版只有單一 localTtsUrl → 遷移成清單第一筆（只做一次）
  if(!Array.isArray(state.settings.localComputeServers)) state.settings.localComputeServers = [];
  if(!state.settings.localComputeServers.length && (state.settings.localTtsUrl||"").trim()){
    state.settings.localComputeServers = [{ name:t("lt.cloudN").replace("{n}","1"), url:state.settings.localTtsUrl.trim() }];
  }
}

let _app=null, _auth=null, _db=null, _saveTimer=null, _onSaved=()=>{};
const LS = "voiceweaver_web";

export function hasFirebase(){ return !!window.__FIREBASE_CONFIG__?.apiKey && !window.__FIREBASE_CONFIG__.apiKey.startsWith("貼上"); }

export function initAuth({ onUser, onSaved }){
  _onSaved = onSaved || _onSaved;
  if(!hasFirebase()){
    // 純本機：直接「登入」成本機使用者，讀 localStorage
    loadLocal();
    state.uid = "local"; state.online = false;
    onUser({ uid:"local", anon:true, name:"" });
    return;
  }
  _app = initializeApp(window.__FIREBASE_CONFIG__);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  try{ _driveToken = sessionStorage.getItem("vw_drive_token") || null; }catch{}   // 重新整理後沿用
  onAuthStateChanged(_auth, async (u) => {
    if(u){
      state.uid = u.uid; state.online = true;
      await loadCloud(u.uid);
      _email = u.email || "";
      onUser({ uid:u.uid, anon:u.isAnonymous, email:_email,
               name: u.displayName || (u.isAnonymous ? "" : u.email) });
    } else {
      state.uid = null; state.online = false;
      onUser(null);
    }
  });
}

// 登入合一：同一次 Google 登入既是 Firebase 身分，也拿到 Drive 權限（drive.file）。
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * 只讀「檔案清單」的權限。**列出專屬聲音一定要有這個。**
 *
 * drive.file 是逐檔授權：只看得到「本 App 自己建立的檔案」。專屬發音是網頁
 * 自己寫上去的，所以讀得回來；但語音模型是別的途徑進 Drive 的——Colab 掛載
 * Drive 寫的、或使用者自己在 Drive 網頁上拖進去的——對 drive.file 而言，
 * 那些檔案等同不存在。同一個帳號、同一個資料夾，差別只在「誰建立的」。
 * 這正是「專屬發音收得到、專屬聲音收不到」的原因，怎麼改資料夾邏輯都沒用。
 *
 * 為什麼是 metadata.readonly 而不是 drive.readonly：這個畫面要回答的問題
 * 只是「我有哪些聲音、哪些能用」——角色名、語言、情緒（從參考音檔名讀）、
 * 大小，全部都是 metadata。合成本來就在電腦或 Colab 上跑，網頁不需要、
 * 也不該有能力讀出使用者 Drive 裡任何一個檔案的**內容**。
 */
export const DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";

// 授權範圍改過之後，**舊的權杖不會自動變新的**——授權是登入當下決定的。
// 這種人打開專屬聲音會看到空清單，而曲庫好端端在 Drive 上，畫面卻說「還沒有」。
// 拿到權杖時蓋一個世代章，看得出這個權杖是不是在新範圍之後拿的。
// 以後再加範圍就把 SCOPE_GEN 往上加一號。
const DRIVE_SCOPE_MARK = "vw_drive_scope_gen";
const SCOPE_GEN = "2";

/** 目前這個 Drive 權杖是不是舊範圍拿的（需要重新授權才看得到語音模型）。 */
export function needsScopeUpgrade(){
  if(!_driveToken) return false;              // 沒權杖是另一回事，別蓋掉「請先授權」
  try{ return sessionStorage.getItem(DRIVE_SCOPE_MARK) !== SCOPE_GEN; }
  catch{ return false; }
}
let _driveToken = null;      // 這次工作階段的 Google OAuth access token（可呼叫 Drive API）

/** 目前可用的 Drive access token（沒登入或沒授權回 null）。 */
export function driveToken(){ return _driveToken; }

// 現在登入的是哪個 Google 帳號。
//
// 為什麼要露出來：drive.file 只看得到「本 App 在**這個帳號**建立的檔案」。
// 一個人有兩個 Google 帳號是很平常的事，而曲庫存在其中一個。登錯帳號時
// 畫面會說「Drive 上還沒有語音模型」——這句話本身是對的（這個帳號確實沒有），
// 但他看著另一個帳號裡滿滿的資料夾，只會覺得東西不見了。
// 講出信箱，一秒就看得出是不是登錯了。
let _email = "";
export function accountEmail(){ return _email; }

/** 換帳號：先登出，再開 Google 的帳號選擇畫面。 */
export async function switchAccount(){
  await logout();
  return loginGoogle({ chooseAccount: true });
}

/**
 * 同一個彈窗同時只能有一個。
 *
 * Firebase 在前一個 signInWithPopup 還沒結束時又收到一個，會把**前一個**
 * 取消掉並丟 auth/cancelled-popup-request。連點兩下就會這樣——而這個 App
 * 的使用者本來就常常手抖誤觸（其他按鈕都走 bindTap 防連點，登入鈕漏了）。
 */
let _popupPending = null;

export async function loginGoogle(opts = {}){
  if(!hasFirebase()) throw new Error(t("err.noFirebase"));
  if(_popupPending) return _popupPending;   // 第二次點就直接沿用第一次，不要再開一個彈窗
  _popupPending = (async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope(DRIVE_SCOPE);                       // 同一個同意畫面順便要 Drive 權限
    provider.addScope(DRIVE_METADATA_SCOPE);              // 看得到別的程式建立的語音模型
    // 換帳號時一定要強迫出現選擇畫面：Google 預設會直接用上次那個帳號登回去，
    // 於是使用者按了「換帳號」卻換不掉，畫面完全沒有變化。
    if(opts.chooseAccount) provider.setCustomParameters({ prompt: "select_account" });
    const res = await signInWithPopup(_auth, provider);
    // 從登入結果取出 Google OAuth access token → 之後可直接打 Drive API（存到自己的 Drive）
    const cred = GoogleAuthProvider.credentialFromResult(res);
    _driveToken = cred?.accessToken || null;
    try{
      if(_driveToken){
        sessionStorage.setItem("vw_drive_token", _driveToken);
        // 記下「這個權杖是在有要 metadata 範圍之後拿到的」。
        // 不去打 tokeninfo 問實際授了哪些範圍：那個端點只吃網址參數，
        // 等於把 access token 寫進 URL（會進各種紀錄檔）。為了一句提示，不值得。
        sessionStorage.setItem(DRIVE_SCOPE_MARK, SCOPE_GEN);
      }
    }catch{}
    return { uid: res.user?.uid, email: res.user?.email, drive: !!_driveToken };
  })();
  try { return await _popupPending; }
  finally { _popupPending = null; }
}

/**
 * 只補 Drive 授權，不動 Firebase 登入。
 *
 * 為什麼一定要有這個：**Firebase 登入狀態存在 IndexedDB（關掉分頁還在），
 * 而 Drive token 存在 sessionStorage（關掉分頁就沒了）。** 所以重開瀏覽器之後
 * 使用者是「已登入但沒有 Drive 權杖」的狀態——畫面不會跳登入頁，但每一個
 * Drive 功能都說「請重新登入」，而他明明就登入著。
 *
 * token 本身也大約一小時就過期，所以就算 sessionStorage 保住了也還是會遇到。
 *
 * 不把 token 改存 localStorage：OAuth access token 跨工作階段留存會擴大 XSS
 * 的曝險面，而它一小時就失效，留著換不到什麼。正解是給一個就地重新授權的入口。
 */
export async function reauthorizeDrive(){
  return loginGoogle();
}

/** 已經登入 Firebase、但這個分頁沒有 Drive 權杖 → 只需要重新授權，不是要重新登入。 */
export function needsDriveReauth(){
  return !!state.uid && state.uid !== "local" && !_driveToken;
}

/** 這個錯誤只是「使用者關掉了彈窗」或「連點了兩下」，不是真的失敗，不必嚇他。 */
export function isBenignAuthError(e){
  const code = (e && (e.code || e.message)) || "";
  return /cancelled-popup-request|popup-closed-by-user|user-cancelled|popup-blocked/i.test(code);
}
export async function loginAnon(){
  if(!hasFirebase()){ return; } // 本機模式已等同登入
  await signInAnonymously(_auth);
}
export async function logout(){
  _driveToken = null;
  _email = "";
  try{ sessionStorage.removeItem("vw_drive_token"); sessionStorage.removeItem(DRIVE_SCOPE_MARK); }catch{}
  if(_auth) await signOut(_auth);
  else { location.reload(); }
}

// ── 載入 ───────────────────────────────────────────
function snapshot(){
  return { settings:state.settings, apiKeys:state.apiKeys, llmApis:state.llmApis, imageApis:state.imageApis,
           favorites:state.favorites, customCards:state.customCards, behavior:state.behavior };
}
function loadLocal(){
  try{ applyLoaded(migrate(JSON.parse(localStorage.getItem(LS) || "{}"))); }
  catch{ applyLoaded(migrate({})); }
}
async function loadCloud(uid){
  try{
    const snap = await getDoc(doc(_db,"users",uid));
    if(snap.exists()){ applyLoaded(migrate(snap.data())); }
    else { applyLoaded(migrate({})); await setDoc(doc(_db,"users",uid), { ...snapshot(), updatedAt:Date.now() }); }
  }catch(e){ console.warn("loadCloud failed", e); loadLocal(); }
}

// ── 儲存（防抖：改動 800ms 後寫回；本機立即備份）──────
export function save(){
  try{ localStorage.setItem(LS, JSON.stringify(snapshot())); }catch{}
  // 送「翻譯鍵」而非寫死文字，由 app.js 用 t() 翻成目前語言
  if(!_db || !state.uid || state.uid==="local"){ _onSaved("save.local"); return; }
  clearTimeout(_saveTimer);
  _onSaved("save.saving");
  _saveTimer = setTimeout(async ()=>{
    // 先歸零再寫：不歸零的話 flushPendingSave 永遠看到一個「還有待寫入」的假訊號，
    // 之後每一次切分頁／隱藏視窗都會多打一次 Firestore——使用者只是在切視窗。
    _saveTimer = null;
    try{
      await setDoc(doc(_db,"users",state.uid), { ...snapshot(), updatedAt:Date.now() }, { merge:true });
      _onSaved("save.synced");
    }catch(e){ _onSaved("save.failed"); }
  }, 800);
}

// 頁面即將隱藏/關閉：若還有防抖中的雲端寫入，立刻送出（否則 800ms 內關頁 → 改動只在本機，
// 下次載入被雲端舊資料蓋回 → 使用者以為設定沒存到）。
function flushPendingSave(){
  if(!_saveTimer) return;
  clearTimeout(_saveTimer); _saveTimer = null;
  if(_db && state.uid && state.uid!=="local"){
    setDoc(doc(_db,"users",state.uid), { ...snapshot(), updatedAt:Date.now() }, { merge:true })
      .then(()=>_onSaved("save.synced")).catch(()=>_onSaved("save.failed"));
  }
}
window.addEventListener("pagehide", flushPendingSave);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") flushPendingSave(); });

// ── 歷史 ───────────────────────────────────────────
export async function addHistory(rec){
  rec = { ...rec, ts: Date.now() };
  if(_db && state.uid && state.uid!=="local"){
    try{ await addDoc(collection(_db,"users",state.uid,"history"), rec); }catch(e){ pushLocalHistory(rec); }
  } else pushLocalHistory(rec);
}
export async function listHistory(){
  if(_db && state.uid && state.uid!=="local"){
    try{
      const q = query(collection(_db,"users",state.uid,"history"), orderBy("ts","desc"), limit(100));
      return (await getDocs(q)).docs.map(d=>d.data());
    }catch(e){ return getLocalHistory(); }
  }
  return getLocalHistory();
}
function pushLocalHistory(rec){
  const h = getLocalHistory(); h.unshift(rec);
  // 配額滿時 setItem 會丟 QuotaExceededError（歷史帶圖時很容易滿）。
  // 讀取端全都有 try，寫入端漏了——而這個例外會一路往上炸掉呼叫它的流程。
  try{ localStorage.setItem(LS+"_hist", JSON.stringify(h.slice(0,100))); }
  catch{ try{ localStorage.setItem(LS+"_hist", JSON.stringify(h.slice(0,20))); }catch{} }
}
function getLocalHistory(){ try{ return JSON.parse(localStorage.getItem(LS+"_hist")||"[]"); }catch{ return []; } }

// ── 復健日誌（與手機 App 同結構：users/{uid}/rehabLogs）──
export async function addRehabLog({ target, recognized, score, feedback }){
  const rec = { timestamp: Date.now(), targetSentence: target, recognized: recognized||"",
                score, feedback: feedback||"", locationTag: "網頁版" };
  if(_db && state.uid && state.uid!=="local"){
    try{ await addDoc(collection(_db,"users",state.uid,"rehabLogs"), rec); }catch(e){ pushLocalRehab(rec); }
  } else pushLocalRehab(rec);
  return rec;
}
export async function listRehabLogs(fromTs=0){
  if(_db && state.uid && state.uid!=="local"){
    try{
      const q = query(collection(_db,"users",state.uid,"rehabLogs"),
                      where("timestamp",">=",fromTs), orderBy("timestamp","desc"), limit(300));
      return (await getDocs(q)).docs.map(d=>d.data());
    }catch(e){ console.warn("listRehabLogs", e); return getLocalRehab().filter(r=>r.timestamp>=fromTs); }
  }
  return getLocalRehab().filter(r=>r.timestamp>=fromTs);
}
function pushLocalRehab(rec){
  const h = getLocalRehab(); h.unshift(rec);
  try{ localStorage.setItem(LS+"_rehab", JSON.stringify(h.slice(0,300))); }
  catch{ try{ localStorage.setItem(LS+"_rehab", JSON.stringify(h.slice(0,50))); }catch{} }
}
function getLocalRehab(){ try{ return JSON.parse(localStorage.getItem(LS+"_rehab")||"[]"); }catch{ return []; } }

// ── 專屬發音（觸發詞 → 整句話）─────────────────────────
//
// 網頁版只管「文字設定」：哪幾個字要聽、聽到之後說哪一句。
// **聲音的部分不在這裡做。** 比對是拿使用者本人的錄音跑 DTW 波形對齊，
// 瀏覽器沒有那套實作，而且樣板是「認人」的——照顧者在電腦上錄自己的聲音
// 對患者完全沒用。所以這裡建的項目要在手機上補錄過才會生效。
//
// 這樣切分的價值是：打字這件事在電腦上快得多，照顧者可以一次把二三十句
// 設好，患者只要拿手機把每句錄幾次。

const SHORTCUTS_LS = LS + "_shortcuts";

function localShortcuts(){
  try{ return JSON.parse(localStorage.getItem(SHORTCUTS_LS) || "[]"); }catch{ return []; }
}
function saveLocalShortcuts(list){
  // 存不進去要讓呼叫端知道：專屬發音是使用者剛打進去的設定，
  // 靜靜地丟掉的話他下次打開會發現東西不見了，卻沒有任何線索。
  try{ localStorage.setItem(SHORTCUTS_LS, JSON.stringify(list)); }
  catch(e){ throw new Error(t("set.shortcutSaveFail")); }
}

// Drive 用動態 import：drive.js 反過來要 store.js 的 driveToken，
// 靜態互相 import 會踩到模組初始化順序。順便也讓沒用到 Drive 的人不必載這段。
async function _drive(){ return import("./drive.js?v=1.5.26"); }

/**
 * 兩個雲端來源都讀：Firestore（即時、免 Drive 授權）與使用者自己 Drive 的
 * `VoiceWeaver/AcousticModels/`。
 *
 * 為什麼要兩邊：Firestore 那份使用者看不到也拿不走；Drive 那份是他自己資料夾裡的
 * 檔案，備份得走、換帳號搬得動、也刪得掉。兩邊會不同步（匿名登入時沒有 Drive 權限），
 * 所以取回時合併、以觸發詞去重。
 *
 * 沒登入時也能編輯（存 localStorage），之後登入再一起推上去——
 * 不然照顧者得先處理帳號才能開始做事。
 */
export async function listShortcuts(){
  if(!(_db && state.uid && state.uid!=="local")) return localShortcuts();

  let fromCloud = [];
  try{
    const snap = await getDocs(collection(_db,"users",state.uid,"acousticTemplates"));
    fromCloud = snap.docs.map(d=>({
      id: d.id,
      keyword: d.data().keyword || "",
      spokenPhrase: d.data().spokenPhrase || "",
      // 手機錄過音才有。空的＝還沒錄，手機上不會生效。
      hasRecording: !!(d.data().exemplarBlob || "").length,
      createdAt: d.data().createdAt || 0,
    }));
  }catch(e){ fromCloud = localShortcuts(); }

  let fromDrive = [];
  try{
    const d = await _drive();
    if(d.driveReady()){
      fromDrive = (await d.listAcoustic()).map(x=>({
        id: String(x.id || ""),
        keyword: x.keyword || "",
        spokenPhrase: x.spokenPhrase || "",
        hasRecording: !!(x.exemplarBlob || "").length,
        createdAt: x.createdAt || 0,
      }));
    }
  }catch(e){ /* 沒授權 Drive／token 過期都很正常，Firestore 那份還在 */ }

  const d = await _drive();
  return d.mergeShortcuts(fromDrive, fromCloud);
}

export async function saveShortcut({ id, keyword, spokenPhrase }){
  keyword = (keyword||"").trim();
  spokenPhrase = (spokenPhrase||"").trim();
  // 少了任一個就沒有意義：不知道要聽什麼，或不知道要說什麼
  if(!keyword || !spokenPhrase) throw new Error(t("set.shortcutBlank"));

  // id 用時間戳：Android 端的 key 是資料庫的 Long id，字串化之後要能對得起來
  const docId = id || String(Date.now());
  const rec = {
    label: keyword,
    keyword,
    spokenPhrase,
    matchMode: "Keyword",
    // 門檻留 0：真正的值要等手機錄音之後才算得出來（那是照那支麥克風校準的）。
    // 寫一個假的進去會讓手機以為已經校準過。
    rejectionThreshold: 0,
    marginThreshold: 0.15,
    createdAt: Number(docId),
    updatedAt: Date.now(),
  };

  if(_db && state.uid && state.uid!=="local"){
    // merge：手機那邊已經錄過音的話，exemplarBlob 不能被這裡的空值蓋掉
    await setDoc(doc(_db,"users",state.uid,"acousticTemplates",docId), rec, { merge:true });
    await _driveWrite(docId, rec);
  }else{
    const list = localShortcuts().filter(x=>x.id!==docId);
    list.push({ id:docId, keyword, spokenPhrase, hasRecording:false, createdAt:rec.createdAt });
    saveLocalShortcuts(list);
  }
  return docId;
}

/**
 * 順手在使用者自己的 Drive 留一份。失敗不擋存檔——Firestore 那份已經成功，
 * 功能是完整的；為了「備份沒寫成」而告訴使用者存檔失敗，只會讓他重打一次。
 *
 * 這裡刻意**不覆蓋 exemplarBlob**：Drive 上那筆可能是手機錄好音寫上去的，
 * 網頁只改了文字就把錄音清掉的話，使用者要重錄 5 次才能救回來。
 * category 同理：那是手機端從語句庫帶上來的，決定它在雲端放哪個資料夾，
 * 網頁沒有這個概念，不保留的話每改一次文字就被丟回 Custom。
 */
async function _driveWrite(docId, rec){
  try{
    const d = await _drive();
    if(!d.driveReady()) return;
    const existing = await d.readAcoustic(docId);
    await d.saveAcoustic({
      ...rec,
      id: docId,
      exemplarBlob: (existing && existing.exemplarBlob) || "",
      rejectionThreshold: existing ? existing.rejectionThreshold : rec.rejectionThreshold,
      category: (existing && existing.category) || rec.category || "Custom",
    });
  }catch(e){ /* 沒授權／離線都很正常 */ }
}

export async function deleteShortcut(id){
  if(_db && state.uid && state.uid!=="local"){
    // 兩邊都要刪。少刪任何一邊，下次取回都會把使用者刻意刪掉的救回來——
    // 而他刪掉多半正是因為那筆會誤觸發。
    await deleteDoc(doc(_db,"users",state.uid,"acousticTemplates",String(id)));
    try{
      const d = await _drive();
      if(d.driveReady()) await d.deleteAcoustic(id);
    }catch(e){ /* 同上 */ }
  }else{
    saveLocalShortcuts(localShortcuts().filter(x=>String(x.id)!==String(id)));
  }
}

/**
 * 專屬聲音（語音模型）清單，直接從 Drive 讀。
 *
 * **錯誤刻意往上丟**，不吞成空陣列：「沒授權」「授權過期」「真的一個都沒有」
 * 三種情況要給使用者的話完全不同，全部畫成「還沒有語音模型」的話，
 * 一個明明錄好了聲音的人會以為自己的東西不見了。
 * 丟出的 message 是代碼（noDrive／driveExpired），由呼叫端翻譯。
 */
export async function listVoices(){
  const d = await _drive();
  if(!d.driveReady()) throw new Error("noDrive");
  return await d.listVoiceModels();
}
