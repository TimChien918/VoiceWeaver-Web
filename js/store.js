// 狀態保存：Firebase（登入 + Firestore 自動同步）；沒設定 Firebase 時退回 localStorage。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { t } from "./i18n.js";

const DEFAULTS = {
  settings: { theme: "auto", lang: "zh-TW", rate: 0.95, font: 1.0,
              // 本地 GPT-SoVITS 語音引擎（透過語音中心橋接）
              localTtsEnabled: false, localTtsUrl: "", localVoiceName: "", localVoiceLang: "" },
  // 單一欄位的金鑰（通報用）
  apiKeys:  { tgtoken: "", tgchat: "" },
  // 多供應商、多金鑰清單（每筆 {id, provider, key, model}）→ 重組/生圖自動輪詢
  llmApis:  [],
  imageApis:[],
};

let _idc = 0;
export function newId(){ return "k" + Date.now().toString(36) + (_idc++).toString(36); }

export const state = {
  uid: null, online: false,
  settings: structuredClone(DEFAULTS.settings),
  apiKeys: structuredClone(DEFAULTS.apiKeys),
  llmApis: [],
  imageApis: [],
  favorites: [],   // 我的最愛常用句
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
  return d;
}
function applyLoaded(d){
  state.settings = { ...DEFAULTS.settings, ...(d.settings||{}) };
  state.apiKeys  = { ...DEFAULTS.apiKeys,  ...(d.apiKeys||{}) };
  state.llmApis  = Array.isArray(d.llmApis) ? d.llmApis : [];
  state.imageApis= Array.isArray(d.imageApis) ? d.imageApis : [];
  state.favorites= Array.isArray(d.favorites) ? d.favorites : [];
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
    onUser({ uid:"local", anon:true, name:"本機（未連 Firebase）" });
    return;
  }
  _app = initializeApp(window.__FIREBASE_CONFIG__);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  onAuthStateChanged(_auth, async (u) => {
    if(u){
      state.uid = u.uid; state.online = true;
      await loadCloud(u.uid);
      onUser({ uid:u.uid, anon:u.isAnonymous, name: u.displayName || (u.isAnonymous?t("user.anon"):u.email) });
    } else {
      state.uid = null; state.online = false;
      onUser(null);
    }
  });
}

export async function loginGoogle(){
  if(!hasFirebase()) throw new Error(t("err.noFirebase"));
  await signInWithPopup(_auth, new GoogleAuthProvider());
}
export async function loginAnon(){
  if(!hasFirebase()){ return; } // 本機模式已等同登入
  await signInAnonymously(_auth);
}
export async function logout(){
  if(_auth) await signOut(_auth);
  else { location.reload(); }
}

// ── 載入 ───────────────────────────────────────────
function snapshot(){
  return { settings:state.settings, apiKeys:state.apiKeys, llmApis:state.llmApis, imageApis:state.imageApis, favorites:state.favorites };
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
