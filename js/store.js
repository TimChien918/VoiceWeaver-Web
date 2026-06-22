// 狀態保存：Firebase（登入 + Firestore 自動同步）；沒設定 Firebase 時退回 localStorage。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, addDoc, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULTS = {
  settings: { theme: "auto", lang: "zh-TW", rate: 0.95, font: 1.0 },
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
};

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
}

let _app=null, _auth=null, _db=null, _saveTimer=null, _onSaved=()=>{};
let _userUnsub=null, _onRemote=()=>{};   // 使用者文件即時監聽
const LS = "voiceweaver_web";

export function hasFirebase(){ return !!window.__FIREBASE_CONFIG__?.apiKey && !window.__FIREBASE_CONFIG__.apiKey.startsWith("貼上"); }

export function initAuth({ onUser, onSaved, onRemote }){
  _onSaved = onSaved || _onSaved;
  _onRemote = onRemote || _onRemote;
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
      watchCloud(u.uid);   // 即時監聽：API 金鑰／模型／設定一改就同步
      onUser({ uid:u.uid, anon:u.isAnonymous, name: u.displayName || (u.isAnonymous?"匿名使用者":u.email) });
    } else {
      if(_userUnsub){ _userUnsub(); _userUnsub=null; }
      state.uid = null; state.online = false;
      onUser(null);
    }
  });
}

export async function loginGoogle(){
  if(!hasFirebase()) throw new Error("尚未設定 Firebase（config.js）");
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
  return { settings:state.settings, apiKeys:state.apiKeys, llmApis:state.llmApis, imageApis:state.imageApis };
}
function loadLocal(){
  try{ applyLoaded(migrate(JSON.parse(localStorage.getItem(LS) || "{}"))); }
  catch{ applyLoaded(migrate({})); }
}
// 即時監聽使用者文件：任一裝置改 API 金鑰／模型／設定，其他裝置立即更新。
function watchCloud(uid){
  if(_userUnsub){ _userUnsub(); _userUnsub=null; }
  _userUnsub = onSnapshot(doc(_db,"users",uid), (snap)=>{
    // 自己剛寫入的回聲（尚未落地）略過，避免覆蓋正在編輯的內容
    if(snap.metadata.hasPendingWrites) return;
    if(snap.exists()){ applyLoaded(migrate(snap.data())); _onRemote("doc"); }
    else { applyLoaded(migrate({})); setDoc(doc(_db,"users",uid), { ...snapshot(), updatedAt:Date.now() }, { merge:true }); }
  }, (e)=>{ console.warn("watchCloud failed", e); loadLocal(); _onRemote("doc"); });
}

// 手動更新：強制重抓一次使用者文件（給「🔄 更新」按鈕用）
export async function refreshCloud(){
  if(!_db || !state.uid || state.uid==="local") return false;
  try{
    const snap = await getDoc(doc(_db,"users",state.uid));
    if(snap.exists()){ applyLoaded(migrate(snap.data())); _onRemote("doc"); }
    return true;
  }catch(e){ console.warn("refreshCloud failed", e); return false; }
}

// ── 儲存（防抖：改動 800ms 後寫回；本機立即備份）──────
export function save(){
  try{ localStorage.setItem(LS, JSON.stringify(snapshot())); }catch{}
  if(!_db || !state.uid || state.uid==="local"){ _onSaved("已存（本機）"); return; }
  clearTimeout(_saveTimer);
  _onSaved("儲存中…");
  _saveTimer = setTimeout(async ()=>{
    try{
      await setDoc(doc(_db,"users",state.uid), { ...snapshot(), updatedAt:Date.now() }, { merge:true });
      _onSaved("已雲端同步 ✓");
    }catch(e){ _onSaved("雲端儲存失敗（已存本機）"); }
  }, 800);
}

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
// 即時監聽歷史（使用紀錄）：新紀錄一寫入立即推給回呼。回傳 unsubscribe()。
export function watchHistory(cb){
  if(!_db || !state.uid || state.uid==="local"){ cb(getLocalHistory()); return ()=>{}; }
  const q = query(collection(_db,"users",state.uid,"history"), orderBy("ts","desc"), limit(100));
  return onSnapshot(q, (snap)=>cb(snap.docs.map(d=>d.data())), (e)=>{ console.warn("watchHistory", e); cb(getLocalHistory()); });
}
function pushLocalHistory(rec){
  const h = getLocalHistory(); h.unshift(rec);
  localStorage.setItem(LS+"_hist", JSON.stringify(h.slice(0,100)));
}
function getLocalHistory(){ try{ return JSON.parse(localStorage.getItem(LS+"_hist")||"[]"); }catch{ return []; } }
