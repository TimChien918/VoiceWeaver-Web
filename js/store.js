// 狀態保存：Firebase（登入 + Firestore 自動同步）；沒設定 Firebase 時退回 localStorage。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULTS = {
  settings: { theme: "auto", lang: "zh-TW", rate: 0.95, font: 1.0, provider: "auto" },
  apiKeys:  { gemini: "", groq: "", openrouter: "", tgtoken: "", tgchat: "" },
};

export const state = {
  uid: null, online: false,
  settings: structuredClone(DEFAULTS.settings),
  apiKeys: structuredClone(DEFAULTS.apiKeys),
};

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
      onUser({ uid:u.uid, anon:u.isAnonymous, name: u.displayName || (u.isAnonymous?"匿名使用者":u.email) });
    } else {
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
function loadLocal(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS) || "{}");
    if(raw.settings) state.settings = { ...DEFAULTS.settings, ...raw.settings };
    if(raw.apiKeys)  state.apiKeys  = { ...DEFAULTS.apiKeys,  ...raw.apiKeys };
  }catch{}
}
async function loadCloud(uid){
  try{
    const snap = await getDoc(doc(_db,"users",uid));
    if(snap.exists()){
      const d = snap.data();
      state.settings = { ...DEFAULTS.settings, ...(d.settings||{}) };
      state.apiKeys  = { ...DEFAULTS.apiKeys,  ...(d.apiKeys||{}) };
    } else {
      // 首次登入 → 建預設文件
      await setDoc(doc(_db,"users",uid), { settings:state.settings, apiKeys:state.apiKeys, updatedAt:Date.now() });
    }
  }catch(e){ console.warn("loadCloud failed", e); loadLocal(); }
}

// ── 儲存（防抖：改動 800ms 後寫回；本機立即備份）──────
export function save(){
  try{ localStorage.setItem(LS, JSON.stringify({ settings:state.settings, apiKeys:state.apiKeys })); }catch{}
  if(!_db || !state.uid || state.uid==="local"){ _onSaved("已存（本機）"); return; }
  clearTimeout(_saveTimer);
  _onSaved("儲存中…");
  _saveTimer = setTimeout(async ()=>{
    try{
      await setDoc(doc(_db,"users",state.uid), { settings:state.settings, apiKeys:state.apiKeys, updatedAt:Date.now() }, { merge:true });
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
function pushLocalHistory(rec){
  const h = getLocalHistory(); h.unshift(rec);
  localStorage.setItem(LS+"_hist", JSON.stringify(h.slice(0,100)));
}
function getLocalHistory(){ try{ return JSON.parse(localStorage.getItem(LS+"_hist")||"[]"); }catch{ return []; } }
