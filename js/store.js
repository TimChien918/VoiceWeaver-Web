// 狀態保存：Firebase（登入 + Firestore 自動同步）；沒設定 Firebase 時退回 localStorage。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { t } from "./i18n.js?v=1.4.9";

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
    const a = new Uint8Array(18); (crypto||{}).getRandomValues?.(a);
    state.apiKeys.ngrokPairCode = "vw" + Array.from(a, b=>b.toString(36).padStart(2,"0")).join("").slice(0,22);
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
      onUser({ uid:u.uid, anon:u.isAnonymous, name: u.displayName || (u.isAnonymous ? "" : u.email) });
    } else {
      state.uid = null; state.online = false;
      onUser(null);
    }
  });
}

// 登入合一：同一次 Google 登入既是 Firebase 身分，也拿到 Drive 權限（drive.file）。
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let _driveToken = null;      // 這次工作階段的 Google OAuth access token（可呼叫 Drive API）

/** 目前可用的 Drive access token（沒登入或沒授權回 null）。 */
export function driveToken(){ return _driveToken; }

export async function loginGoogle(){
  if(!hasFirebase()) throw new Error(t("err.noFirebase"));
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);                       // 同一個同意畫面順便要 Drive 權限
  const res = await signInWithPopup(_auth, provider);
  // 從登入結果取出 Google OAuth access token → 之後可直接打 Drive API（存到自己的 Drive）
  const cred = GoogleAuthProvider.credentialFromResult(res);
  _driveToken = cred?.accessToken || null;
  try{ if(_driveToken) sessionStorage.setItem("vw_drive_token", _driveToken); }catch{}
  return { uid: res.user?.uid, email: res.user?.email, drive: !!_driveToken };
}
export async function loginAnon(){
  if(!hasFirebase()){ return; } // 本機模式已等同登入
  await signInAnonymously(_auth);
}
export async function logout(){
  _driveToken = null;
  try{ sessionStorage.removeItem("vw_drive_token"); }catch{}
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
  localStorage.setItem(LS+"_hist", JSON.stringify(h.slice(0,100)));
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
  localStorage.setItem(LS+"_rehab", JSON.stringify(h.slice(0,300)));
}
function getLocalRehab(){ try{ return JSON.parse(localStorage.getItem(LS+"_rehab")||"[]"); }catch{ return []; } }
