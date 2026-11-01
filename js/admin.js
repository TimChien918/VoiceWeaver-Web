// 開發者控制中心：限時活動（shared/apiKeys、grants/{uid}）與帳號名冊的管理介面。
//
// 以前這些文件只能由開發者電腦上的管理腳本（舊名 vw_admin.py）用服務帳戶私鑰寫入；那把私鑰
// 繞過所有規則、等於整個專案的最高權限，帶著它走來走去本身就是風險。
// 現在改成「開發者用自己的 Google 帳號在網頁上寫」，權限由 Firestore 規則的
// isAdmin() 把關——私鑰從此不必存在任何地方。
//
// **這支檔案裡的 isAdmin() 只決定「要不要把入口畫出來」，不是權限。**
// 改前端讓自己看到這一頁很容易，但寫入時資料庫那一層會用 request.auth.token
// 再比一次 email，對不上就拒絕。所以換管理員要改兩處：下面的 ADMIN_EMAILS
// 與 firestore.rules 的 isAdmin()——只改這裡只會得到一頁按了全部失敗的介面。
import { state, currentAuthUser, firestoreDb } from "./store.js?v=1.6.1";
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { LLM_PROVIDERS, IMAGE_PROVIDERS, TTS_PROVIDERS } from "./providers.js?v=1.6.1";
import { DAILY_LIMIT } from "./shared.js?v=1.6.1";
import { t } from "./i18n.js?v=1.6.1";

/** 開發者帳號（單一來源；firestore.rules 的 isAdmin() 要跟著同步）。 */
export const ADMIN_EMAILS = ["timchien918@gmail.com"];

/**
 * 現在登入的是不是開發者。
 *
 * 四個條件缺一不可：匿名帳號沒有 email；非 Google 的登入方式（例如日後若開了
 * email／密碼）可以拿任何字串註冊，要驗證過信箱才算數；所以限定 Google 登入、
 * emailVerified，再比對清單。規則那一側也是同一組條件。
 */
export function isAdmin(u = currentAuthUser()){
  if(!u || u.isAnonymous || !u.emailVerified) return false;
  if(!(u.providerData || []).some(p => p && p.providerId === "google.com")) return false;
  const mail = String(u.email || "").toLowerCase();
  return !!mail && ADMIN_EMAILS.some(e => e.toLowerCase() === mail);
}

// ── 小工具 ─────────────────────────────────────────────

const KINDS = ["llm", "image", "tts"];
const FIELD = { llm: "llmApis", image: "imageApis", tts: "ttsApis" };
const CATALOG = { llm: LLM_PROVIDERS, image: IMAGE_PROVIDERS, tts: TTS_PROVIDERS };

/**
 * 今天是哪一天。**必須跟 shared.js 的 today() 一模一樣**（UTC 切日）：
 * 用量文件 users/{uid}/usage/{日期} 的 id 就是它，切法不同就會讀到隔壁那一天。
 */
function utcDay(){ return new Date().toISOString().slice(0, 10); }

/** 跟 shared.js 的 toMs 同一套解讀（Timestamp 有 seconds；舊資料可能是字串或數字）。 */
function toMs(v){
  if(!v) return 0;
  if(typeof v === "number") return v;
  if(typeof v === "string") return Date.parse(v) || 0;
  if(typeof v.toMillis === "function") return v.toMillis();
  if(typeof v === "object" && v.seconds != null) return Number(v.seconds) * 1000;
  return 0;
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/** 金鑰遮蔽：只露前 6 後 4。太短的整串遮掉——露出 10 個字等於整把交出去。 */
export function maskKey(k){
  const s = String(k || "");
  if(!s) return "";
  if(s.length <= 12) return "•".repeat(Math.min(s.length, 8));
  return s.slice(0, 6) + "…" + s.slice(-4);
}

/**
 * 日期的解讀**跟 app.js 的 campaignDates() 一致：用瀏覽器本地時間。**
 * 畫面上的活動標記是 new Date(ms).toLocaleDateString()（本地），這裡若改用
 * UTC 或寫死台灣時間，填「11/1～11/7」存進去，標記卻可能顯示「10/31～11/6」。
 *
 * activeUntil 沿用既有慣例：存「最後一天的隔天 00:00」，所以「結束日（含當天）」
 * 要加一天；讀回來顯示時退一毫秒再取日期。
 */
function ymd(d){
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseYmd(s, plusDays = 0){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if(!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3] + plusDays);
  return isNaN(d) ? null : d;
}
function fmtDay(ms){ return ms ? new Date(ms).toLocaleDateString() : "—"; }
function fmtTime(ms){ return ms ? new Date(ms).toLocaleString() : "—"; }

/** 一份活動文件（全站或個人）現在的狀態。 */
function statusOf(d){
  if(!d) return "none";
  if(d.enabled === false) return "disabled";
  const now = Date.now(), from = toMs(d.activeFrom), until = toMs(d.activeUntil);
  if(now < from) return "scheduled";
  if(now >= until) return "ended";
  return "active";
}
const ST_KEY = { none:"adm.stNone", disabled:"adm.stDisabled", scheduled:"adm.stScheduled", ended:"adm.stEnded", active:"adm.stActive" };

/** 一份文件的一行摘要（狀態、期間、每日次數、各類金鑰數）。 */
function summaryOf(d){
  if(!d) return t("adm.stNone");
  const until = toMs(d.activeUntil);
  const n = Number(d.dailyLimit);
  return t("adm.summary")
    .replace("{status}", t(ST_KEY[statusOf(d)]))
    .replace("{from}", fmtDay(toMs(d.activeFrom)))
    .replace("{until}", fmtDay(until ? until - 1 : 0))
    .replace("{limit}", (Number.isFinite(n) && n > 0) ? n : DAILY_LIMIT)
    .replace("{llm}", (d.llmApis || []).length)
    .replace("{image}", (d.imageApis || []).length)
    .replace("{tts}", (d.ttsApis || []).length);
}

/** 文件裡的金鑰清單 → 編輯用的列（原金鑰留在記憶體，畫面只顯示遮蔽）。 */
function rowsFrom(list){
  return (Array.isArray(list) ? list : []).filter(e => e && e.key).map(e => ({
    provider: e.provider || "gemini", key: String(e.key), model: e.model || "",
    account: e.account || "", newKey: "",
  }));
}
function emptyKeys(){ return { llm: [], image: [], tts: [] }; }
function keysFromDoc(d){
  const k = emptyKeys();
  if(d) KINDS.forEach(kind => { k[kind] = rowsFrom(d[FIELD[kind]]); });
  return k;
}

/** 編輯中的列 → 要寫進 Firestore 的 {provider, key, model[, account]}。 */
function entryOf(r){
  const out = { provider: r.provider, key: (r.newKey || "").trim() || r.key, model: (r.model || "").trim() };
  if(CATALOG.llm[r.provider]?.needsAccount && r.account) out.account = r.account.trim();
  return out;
}

function draftFromDoc(d){
  const now = new Date();
  const from = toMs(d?.activeFrom), until = toMs(d?.activeUntil);
  const n = Number(d?.dailyLimit);
  return {
    enabled: d ? d.enabled !== false : true,
    from: from ? ymd(new Date(from)) : ymd(now),
    to: until ? ymd(new Date(until - 1)) : ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6)),
    limit: String((Number.isFinite(n) && n > 0) ? n : DAILY_LIMIT),
    keys: keysFromDoc(d),
  };
}

/**
 * 寫入前的欄位驗證。回傳 { err } 或整理好的值。
 *
 * 前端先擋，是為了讓錯誤講人話；規則那一層也會擋型別與先後（見 firestore.rules
 * 的 validCampaign），那是最後一道——兩邊都要有，前端改得掉、規則改不掉。
 */
export function validateDraft(d, { keys } = {}){
  const from = parseYmd(d.from), until = parseYmd(d.to, 1);
  if(!from || !until) return { err: "adm.errDates" };
  if(until.getTime() <= from.getTime()) return { err: "adm.errOrder" };
  const limit = Number(String(d.limit).trim());
  if(!Number.isInteger(limit) || limit < 1 || limit > 100000) return { err: "adm.errLimit" };
  const src = keys || d.keys;
  const lists = {};
  for(const kind of KINDS){
    lists[kind] = [];
    for(const r of (src[kind] || [])){
      const e = entryOf(r);
      if(!CATALOG[kind][e.provider]) return { err: "adm.errKeyEmpty" };
      if(!e.key || /\s/.test(e.key)) return { err: "adm.errKeyEmpty" };
      if(CATALOG[kind][e.provider].needsAccount && !e.account) return { err: "adm.errAccount" };
      lists[kind].push(e);
    }
  }
  const total = KINDS.reduce((n, k) => n + lists[k].length, 0);
  if(d.enabled && !total) return { err: keys ? "adm.errInherit" : "adm.errNoKeys" };
  if(d.enabled && until.getTime() <= Date.now()) return { err: "adm.errPast" };
  return { from, until, limit, lists };
}

/** 驗證過的值 → Firestore 文件（欄位名與 shared.js 的 toSource 一一對應）。 */
function docOf(d, v, extra = {}){
  const me = currentAuthUser();
  return {
    enabled: !!d.enabled,
    activeFrom: Timestamp.fromDate(v.from),       // 一定要 Timestamp：規則拿 request.time 跟它比，
    activeUntil: Timestamp.fromDate(v.until),     // 存成 ISO 字串的話比較永遠不成立
    dailyLimit: v.limit,
    llmApis: v.lists.llm, imageApis: v.lists.image, ttsApis: v.lists.tts,
    ...extra,
    updatedAt: serverTimestamp(),
    updatedBy: me?.email || "",
  };
}

/**
 * 停用／收回用的修補。用 merge 寫，但要把起訖順手正規化成 Timestamp：
 * 規則會驗證「合併之後的整份」，舊文件若是字串時間，只改 enabled 也會被拒。
 */
function disablePatch(old){
  const from = toMs(old?.activeFrom) || Date.now();
  let until = toMs(old?.activeUntil);
  if(!(until > from)) until = from + 1000;
  const me = currentAuthUser();
  return { enabled: false, activeFrom: Timestamp.fromMillis(from), activeUntil: Timestamp.fromMillis(until),
           updatedAt: serverTimestamp(), updatedBy: me?.email || "" };
}

// ── 帳號名冊（directory/{uid}）──────────────────────────
//
// 瀏覽器沒有 Admin SDK，列不出 Firebase Auth 裡有哪些使用者，所以由每個 Google
// 使用者登入時自己登記一筆。只有開發者讀得到（規則），本人只能寫自己那份、
// 而且 email 必須等於登入憑證裡的 email——不能替別人登記，也不能冒用別人的信箱。

const DIR_LS = "sml_dir_touch";

/** 登入後在背景登記名冊。一天最多寫一次；任何失敗都安靜略過（規則沒部署也一樣）。 */
export async function touchDirectory(){
  const u = currentAuthUser(), db = firestoreDb();
  if(!u || !db || u.isAnonymous || !u.email) return;
  const day = utcDay(), mark = `${u.uid}|${day}`;
  try{ if(localStorage.getItem(DIR_LS) === mark) return; }catch{}
  try{
    await setDoc(doc(db, "directory", u.uid), {
      email: u.email, name: u.displayName || "", photo: u.photoURL || "",
      lastSeen: serverTimestamp(),
    }, { merge: true });
    try{ localStorage.setItem(DIR_LS, mark); }catch{}
  }catch(e){ console.info("directory touch skipped", e?.code || e); }
}

// ── 介面狀態 ───────────────────────────────────────────

let _toast = () => {}, _toastErr = null;
const S = {
  loading: false, loadErr: "",
  shared: null, sharedExists: false,
  grants: [],            // [{uid, ...data}]
  dir: [],               // [{uid, email, name, lastSeen}]
  usage: {},             // uid → 今天次數
  day: "",
  sd: draftFromDoc(null),
  gd: { uid: "", who: "", ...draftFromDoc(null), inherit: true },
  q: "", aq: "",
};

function ok(key){ _toast(t(key)); }
function fail(e){
  const code = String(e?.code || e?.message || e || "");
  const msg = /permission/i.test(code) ? t("adm.denied") : t("adm.writeFail") + code;
  (_toastErr || _toast)(msg);
}

function whoOf(uid){
  const d = S.dir.find(x => x.uid === uid);
  const g = S.grants.find(x => x.uid === uid);
  return d?.email || g?.email || uid;
}

/**
 * 掛上（或拿掉）控制中心那張卡。設定索引是從 #settingsCards 底下的卡片自動產生的，
 * 所以只要卡片在不在 DOM，入口就跟著有沒有——非管理員的頁面裡根本沒有這張卡。
 * 回傳是否掛上；呼叫端之後要重建設定索引。
 */
export function mountAdminCenter({ toast, toastErr } = {}){
  if(toast) _toast = toast;
  if(toastErr) _toastErr = toastErr;
  let card = document.getElementById("adminCard");
  if(!isAdmin()){ card?.remove(); return false; }
  const wrap = document.getElementById("settingsCards");
  if(!wrap) return false;
  if(!card){
    card = document.createElement("div");
    card.id = "adminCard";
    card.className = "card admin-card hidden";
    card.dataset.setkey = "admin";
    wrap.appendChild(card);          // 放最後：前面卡片的索引編號不會因此位移
    bindCard(card);
    loadCss();
  }
  renderAdminCenter();
  return true;
}

/** 樣式只有管理員需要，就不讓每個人都多載一個檔；版本戳沿用本模組自己的 ?v=。 */
function loadCss(){
  if(document.getElementById("adminCss")) return;
  const l = document.createElement("link");
  l.id = "adminCss"; l.rel = "stylesheet";
  l.href = new URL("../css/admin.css" + new URL(import.meta.url).search, import.meta.url).href;
  document.head.appendChild(l);
}

// ── 讀取 ───────────────────────────────────────────────

/** 打開控制中心時讀一次全部（三份互不相干，一起發）。 */
export async function refreshAdmin(){
  const db = firestoreDb();
  if(!db || !isAdmin() || S.loading) return;
  S.loading = true; S.loadErr = ""; renderAdminCenter();
  try{
    const [sh, gs, ds] = await Promise.all([
      getDoc(doc(db, "shared", "apiKeys")),
      getDocs(collection(db, "grants")),
      getDocs(collection(db, "directory")),
    ]);
    S.sharedExists = sh.exists();
    S.shared = S.sharedExists ? sh.data() : null;
    S.sd = draftFromDoc(S.shared);
    S.grants = gs.docs.map(d => ({ uid: d.id, ...d.data() }));
    S.dir = ds.docs.map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => toMs(b.lastSeen) - toMs(a.lastSeen));
    await loadUsage(db);
  }catch(e){
    const code = String(e?.code || e?.message || e);
    S.loadErr = /permission/i.test(code) ? t("adm.denied") : t("adm.loadFail") + code;
  }finally{
    S.loading = false;
    renderAdminCenter();
  }
}

/** 名冊上每個人今天的用量。人多時只看最近上線的前 200 位，免得一次發幾千個讀取。 */
async function loadUsage(db){
  S.day = utcDay();
  S.usage = {};
  const list = S.dir.slice(0, 200);
  await Promise.all(list.map(async (u) => {
    try{
      const s = await getDoc(doc(db, "users", u.uid, "usage", S.day));
      S.usage[u.uid] = s.exists() ? (s.data().count || 0) : 0;
    }catch{ S.usage[u.uid] = null; }
  }));
}

// ── 寫入 ───────────────────────────────────────────────

async function saveShared(){
  const db = firestoreDb();
  if(!db || !isAdmin()) return;
  const v = validateDraft(S.sd);
  if(v.err) return _toast(t(v.err));
  const data = docOf(S.sd, v);
  if(!confirm(t("adm.confirmShared").replace("{summary}", summaryOf(data)))) return;
  try{
    await setDoc(doc(db, "shared", "apiKeys"), data);
    ok("adm.saved");
    await refreshAdmin();
  }catch(e){ fail(e); }
}

async function stopShared(){
  const db = firestoreDb();
  if(!db || !isAdmin() || !S.sharedExists) return;
  if(!confirm(t("adm.confirmStop"))) return;
  try{
    await setDoc(doc(db, "shared", "apiKeys"), disablePatch(S.shared), { merge: true });
    ok("adm.stopped");
    await refreshAdmin();
  }catch(e){ fail(e); }
}

async function saveGrant(){
  const db = firestoreDb();
  if(!db || !isAdmin()) return;
  const g = S.gd;
  if(!g.uid) return _toast(t("adm.errNoUser"));
  // 「沿用全站那份」是在儲存當下複製一份過來，不是留一個參照：
  // 使用者讀不到已過期或停用的全站文件，參照的話全站一關，他的加碼也跟著沒了。
  const v = validateDraft(g, g.inherit ? { keys: keysFromDoc(S.shared) } : {});
  if(v.err) return _toast(t(v.err));
  const d = S.dir.find(x => x.uid === g.uid);
  const data = docOf(g, v, { email: d?.email || g.who || "", name: d?.name || "" });
  const msg = t("adm.confirmGrant").replace("{who}", whoOf(g.uid)).replace("{summary}", summaryOf(data));
  if(!confirm(msg)) return;
  try{
    await setDoc(doc(db, "grants", g.uid), data);
    ok("adm.saved");
    await refreshAdmin();
  }catch(e){ fail(e); }
}

async function revokeGrant(uid){
  const db = firestoreDb();
  if(!db || !isAdmin()) return;
  if(!confirm(t("adm.confirmRevoke").replace("{who}", whoOf(uid)))) return;
  try{
    await setDoc(doc(db, "grants", uid), disablePatch(S.grants.find(x => x.uid === uid)), { merge: true });
    ok("adm.revoked");
    await refreshAdmin();
  }catch(e){ fail(e); }
}

async function deleteGrant(uid){
  const db = firestoreDb();
  if(!db || !isAdmin()) return;
  if(!confirm(t("adm.confirmDelete").replace("{who}", whoOf(uid)))) return;
  try{
    await deleteDoc(doc(db, "grants", uid));
    ok("adm.deleted");
    await refreshAdmin();
  }catch(e){ fail(e); }
}

/**
 * 把管理員自己設定頁裡的金鑰帶進編輯中的清單。重複的（同一把 key）略過，
 * 免金鑰的保底項（pollinations）本來就不需要借，也略過。
 */
function importMine(scope){
  const target = S[scope].keys;
  let n = 0;
  for(const kind of KINDS){
    const have = new Set(target[kind].map(r => (r.newKey || "").trim() || r.key));
    for(const e of (state[FIELD[kind]] || [])){
      const p = e && CATALOG[kind][e.provider];
      const key = String(e?.key || "").trim();
      if(!p || p.needsKey === false || !key || have.has(key)) continue;
      have.add(key);
      target[kind].push({ provider: e.provider, key, model: e.model || "", account: e.account || "", newKey: "" });
      n++;
    }
  }
  if(scope === "gd" && n) S.gd.inherit = false;
  _toast(n ? t("adm.imported").replace("{n}", n) : t("adm.importedNone"));
  renderAdminCenter();
}

function pickUser(uid){
  const d = S.dir.find(x => x.uid === uid);
  const g = S.grants.find(x => x.uid === uid);
  // 已經有發放的就把那份帶進表單（等於編輯），沒有的從空白開始。
  S.gd = { ...draftFromDoc(g || null), uid, who: d?.email || g?.email || uid,
           inherit: !g || !KINDS.some(k => (g[FIELD[k]] || []).length) };
  if(!g) S.gd.enabled = true;
  S.q = "";
  renderAdminCenter();
  document.querySelector("#adminCard .adm-grant")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── 畫面 ───────────────────────────────────────────────

function providerOptions(kind, sel){
  return Object.entries(CATALOG[kind])
    .filter(([, v]) => v.needsKey !== false)
    .map(([k, v]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v.labelKey ? t(v.labelKey) : v.label)}</option>`)
    .join("");
}

function keysHtml(scope){
  const keys = S[scope].keys;
  return KINDS.map(kind => {
    const rows = keys[kind].map((r, i) => {
      const p = CATALOG[kind][r.provider] || {};
      const keyPh = r.key ? t("adm.keyKeepPh").replace("{mask}", maskKey(r.key)) : t("adm.keyPh");
      return `<div class="adm-krow" data-scope="${scope}" data-kind="${kind}" data-i="${i}">
        <select data-f="provider">${providerOptions(kind, r.provider)}</select>
        ${r.key ? `<code class="adm-mask">${esc(maskKey(r.key))}</code>` : ""}
        <input data-f="newKey" type="password" autocomplete="off" placeholder="${esc(keyPh)}" value="${esc(r.newKey)}" />
        ${p.needsAccount ? `<input data-f="account" type="text" autocomplete="off" placeholder="${esc(t("adm.acctPh"))}" value="${esc(r.account)}" />` : ""}
        <input data-f="model" type="text" autocomplete="off" placeholder="${esc(t("adm.modelPh").replace("{model}", p.model || "—"))}" value="${esc(r.model)}" />
        <button type="button" class="btn ghost tiny" data-act="delKey">${esc(t("adm.delKey"))}</button>
      </div>`;
    }).join("");
    return `<div class="adm-kind">
      <div class="adm-kind-h"><span>${esc(t("adm.keys_" + kind))}</span>
        <button type="button" class="btn ghost tiny" data-act="addKey" data-scope="${scope}" data-kind="${kind}">${esc(t("adm.addKey"))}</button></div>
      ${rows || `<p class="tiny muted">${esc(t("adm.noKeys"))}</p>`}
    </div>`;
  }).join("");
}

function periodHtml(scope){
  const d = S[scope];
  return `<label class="row adm-check"><input type="checkbox" data-bind="${scope}.enabled"${d.enabled ? " checked" : ""}/> <span>${esc(t("adm.enabled"))}</span></label>
    <div class="adm-grid">
      <label><span class="lbl">${esc(t("adm.from"))}</span><input type="date" data-bind="${scope}.from" value="${esc(d.from)}"/></label>
      <label><span class="lbl">${esc(t("adm.to"))}</span><input type="date" data-bind="${scope}.to" value="${esc(d.to)}"/></label>
      <label><span class="lbl">${esc(t("adm.limit"))}</span><input type="number" min="1" step="1" inputmode="numeric" data-bind="${scope}.limit" value="${esc(d.limit)}"/></label>
    </div>`;
}

function sharedHtml(){
  return `<section class="adm-sec adm-shared">
    <h4>${esc(t("adm.secShared"))}</h4>
    <p class="adm-status st-${statusOf(S.shared)}">${esc(summaryOf(S.shared))}</p>
    ${S.shared?.updatedBy ? `<p class="tiny muted">${esc(t("adm.updated").replace("{who}", S.shared.updatedBy).replace("{t}", fmtTime(toMs(S.shared.updatedAt))))}</p>` : ""}
    ${periodHtml("sd")}
    ${keysHtml("sd")}
    <div class="adm-actions">
      <button type="button" class="btn ghost" data-act="importMine" data-scope="sd">${esc(t("adm.importMine"))}</button>
      <button type="button" class="btn primary" data-act="saveShared">${esc(t("adm.saveShared"))}</button>
      ${S.sharedExists && S.shared?.enabled !== false ? `<button type="button" class="btn danger" data-act="stopShared">${esc(t("adm.stopNow"))}</button>` : ""}
    </div>
  </section>`;
}

function matchUser(u, q){
  q = q.trim().toLowerCase();
  return !q || String(u.email || "").toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q) || u.uid === q;
}

function grantHtml(){
  const g = S.gd;
  const found = S.q.trim() ? S.dir.filter(u => matchUser(u, S.q)).slice(0, 8) : [];
  const results = S.q.trim()
    ? (found.length ? found.map(u => `<div class="adm-pick">
          <span><b>${esc(u.email)}</b> <span class="muted">${esc(u.name || "")}</span></span>
          <button type="button" class="btn ghost tiny" data-act="pick" data-uid="${esc(u.uid)}">${esc(t("adm.pick"))}</button></div>`).join("")
       : `<p class="tiny muted">${esc(t("adm.noMatch"))}</p>`)
    : "";
  const list = S.grants.length ? S.grants.map(x => `<div class="adm-item">
      <div><b>${esc(whoOf(x.uid))}</b><br><span class="tiny adm-status st-${statusOf(x)}">${esc(summaryOf(x))}</span></div>
      <div class="adm-item-act">
        <button type="button" class="btn ghost tiny" data-act="pick" data-uid="${esc(x.uid)}">${esc(t("adm.edit"))}</button>
        ${x.enabled !== false ? `<button type="button" class="btn ghost tiny" data-act="revoke" data-uid="${esc(x.uid)}">${esc(t("adm.revoke"))}</button>` : ""}
        <button type="button" class="btn danger tiny" data-act="delGrant" data-uid="${esc(x.uid)}">${esc(t("adm.delete"))}</button>
      </div></div>`).join("") : `<p class="tiny muted">${esc(t("adm.noGrants"))}</p>`;
  return `<section class="adm-sec adm-grant">
    <h4>${esc(t("adm.secGrant"))}</h4>
    <label class="lbl">${esc(t("adm.search"))}</label>
    <input type="search" data-bind="q" placeholder="${esc(t("adm.searchPh"))}" value="${esc(S.q)}" autocomplete="off"/>
    <div class="adm-results">${results}</div>
    <p class="adm-target">${g.uid ? esc(t("adm.selected").replace("{who}", g.who || g.uid)) : esc(t("adm.errNoUser"))}</p>
    ${periodHtml("gd")}
    <label class="row adm-check"><input type="checkbox" data-bind="gd.inherit"${g.inherit ? " checked" : ""}/> <span>${esc(t("adm.inherit"))}</span></label>
    ${g.inherit ? "" : keysHtml("gd")}
    <div class="adm-actions">
      ${g.inherit ? "" : `<button type="button" class="btn ghost" data-act="importMine" data-scope="gd">${esc(t("adm.importMine"))}</button>`}
      <button type="button" class="btn primary" data-act="saveGrant"${g.uid ? "" : " disabled"}>${esc(t("adm.saveGrant"))}</button>
    </div>
    <h5>${esc(t("adm.grantsList"))}</h5>
    <div class="adm-list">${list}</div>
  </section>`;
}

function accountsHtml(){
  const rows = S.dir.filter(u => matchUser(u, S.aq)).map(u => {
    const g = S.grants.find(x => x.uid === u.uid);
    const used = S.usage[u.uid];
    return `<div class="adm-item">
      <div><b>${esc(u.email)}</b> <span class="muted">${esc(u.name || t("adm.unnamed"))}</span><br>
        <span class="tiny muted">${esc(t("adm.lastSeen").replace("{t}", fmtTime(toMs(u.lastSeen))))}</span>
        · <span class="tiny">${esc(used == null ? t("adm.usageNA") : t("adm.usage").replace("{n}", used))}</span>
        · <span class="tiny ${g ? "adm-status st-" + statusOf(g) : "muted"}">${esc(g ? t("adm.hasGrant").replace("{status}", t(ST_KEY[statusOf(g)])) : t("adm.noGrant"))}</span></div>
      <div class="adm-item-act"><button type="button" class="btn ghost tiny" data-act="pick" data-uid="${esc(u.uid)}">${esc(t("adm.grantThis"))}</button></div>
    </div>`;
  }).join("");
  return `<section class="adm-sec adm-accounts">
    <h4>${esc(t("adm.secAccounts"))}</h4>
    <p class="tiny muted">${esc(t("adm.dirCount").replace("{n}", S.dir.length).replace("{day}", S.day || utcDay()))}</p>
    <input type="search" data-bind="aq" placeholder="${esc(t("adm.filterPh"))}" value="${esc(S.aq)}" autocomplete="off"/>
    <div class="adm-list">${rows || `<p class="tiny muted">${esc(t(S.dir.length ? "adm.noMatch" : "adm.noDir"))}</p>`}</div>
  </section>`;
}

/** 整張卡重畫（切語言時 app.js 也會叫）。輸入中的值都存在 S 裡，重畫不會掉。 */
export function renderAdminCenter(){
  const card = document.getElementById("adminCard");
  if(!card) return;
  // 搜尋框重畫後要把游標放回去，不然每打一個字就失焦一次
  const ae = document.activeElement;
  const focusBind = ae && card.contains(ae) ? ae.getAttribute("data-bind") : null;
  const caret = focusBind && typeof ae.selectionStart === "number" ? ae.selectionStart : null;
  card.innerHTML = `<h3 data-i18n="adm.title">${esc(t("adm.title"))}</h3>
    <p class="tiny muted">${esc(t("adm.desc"))}</p>
    <div class="adm-actions"><button type="button" class="btn ghost tiny" data-act="refresh"${S.loading ? " disabled" : ""}>${esc(S.loading ? t("adm.loading") : t("adm.refresh"))}</button>
      <span class="tiny muted">${esc(currentAuthUser()?.email || "")}</span></div>
    ${S.loadErr ? `<p class="err tiny">${esc(S.loadErr)}</p>` : ""}
    ${sharedHtml()}${grantHtml()}${accountsHtml()}`;
  if(focusBind){
    const el = card.querySelector(`[data-bind="${focusBind}"]`);
    if(el){ el.focus(); if(caret != null && el.setSelectionRange) try{ el.setSelectionRange(caret, caret); }catch{} }
  }
}

/** 事件一律委派在卡片本身：內容每次重畫都換新，綁在子元素上的會跟著消失。 */
function bindCard(card){
  card.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if(!b || b.disabled) return;
    const act = b.dataset.act, uid = b.dataset.uid;
    if(act === "refresh") return refreshAdmin();
    if(act === "addKey"){
      const kind = b.dataset.kind;
      const first = Object.entries(CATALOG[kind]).find(([, v]) => v.needsKey !== false)?.[0] || "gemini";
      S[b.dataset.scope].keys[kind].push({ provider: first, key: "", model: "", account: "", newKey: "" });
      return renderAdminCenter();
    }
    if(act === "delKey"){
      const row = b.closest(".adm-krow");
      S[row.dataset.scope].keys[row.dataset.kind].splice(+row.dataset.i, 1);
      return renderAdminCenter();
    }
    if(act === "importMine") return importMine(b.dataset.scope);
    if(act === "saveShared") return guard(b, saveShared);
    if(act === "stopShared") return guard(b, stopShared);
    if(act === "saveGrant") return guard(b, saveGrant);
    if(act === "pick") return pickUser(uid);
    if(act === "revoke") return guard(b, () => revokeGrant(uid));
    if(act === "delGrant") return guard(b, () => deleteGrant(uid));
  });
  const onField = (ev) => {
    const el = ev.target;
    const bind = el.getAttribute("data-bind");
    if(bind){
      const val = el.type === "checkbox" ? el.checked : el.value;
      const [a, f] = bind.split(".");
      if(f) S[a][f] = val; else S[a] = val;
      // 只有會改變版面的欄位才重畫（搜尋結果、沿用勾選）；日期與數字直接存著就好
      if(bind === "q" || bind === "aq" || bind === "gd.inherit") renderAdminCenter();
      return;
    }
    const row = el.closest(".adm-krow"), f = el.getAttribute("data-f");
    if(!row || !f) return;
    const r = S[row.dataset.scope].keys[row.dataset.kind][+row.dataset.i];
    if(!r) return;
    r[f] = el.value;
    if(f === "provider"){ r.account = ""; renderAdminCenter(); }
  };
  // 勾選框與下拉選單兩個事件都會發，只聽 change，免得同一次操作處理兩遍
  const isToggle = (el) => el.type === "checkbox" || el.tagName === "SELECT";
  card.addEventListener("input", (ev) => { if(!isToggle(ev.target)) onField(ev); });
  card.addEventListener("change", (ev) => { if(isToggle(ev.target)) onField(ev); });
}

/** 寫入期間把按鈕鎖住，連點兩下不要送兩次。 */
async function guard(btn, fn){
  if(btn.dataset.busy) return;
  btn.dataset.busy = "1"; btn.disabled = true;
  try{ await fn(); }
  finally{ delete btn.dataset.busy; btn.disabled = false; }
}
