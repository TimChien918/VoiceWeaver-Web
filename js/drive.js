// Google Drive REST v3：網頁版直接讀寫使用者自己的 Drive。
//
// 為什麼網頁版要直接打 Drive，而不是透過電腦端的語音服務：
// 電腦端不一定開著。照顧者在辦公室用網頁版時，只是想看看「患者的專屬聲音有哪些」、
// 或先把幾十句觸發詞打好——這些不需要 GPU，卻被「電腦要開機」擋住就太可惜了。
//
// 權限是 drive.file（登入時就一起要了，見 store.js 的 DRIVE_SCOPE）：
// 只碰「這個 Google Cloud 專案自己建立的檔案」，使用者 Drive 裡的其他東西一律看不到。
// 手機 App 與 Mac 端用的是同一個專案，所以三邊看得到彼此建立的檔案。
//
// 資料夾結構（三端共用）：
//   Speak-My-Life/Models/<LANG>/<角色>/            語音模型（GPT-SoVITS 聲文權重）
//   Speak-My-Life/AcousticModels/<分類>/<id>.json  聲波模型（專屬發音的關鍵字樣板）
//
// 根資料夾原名 VoiceWeaver/（更名前）。找根時先找新名；只有舊名時把它改名成新名，
// 改名失敗就直接沿用舊資料夾——三端（App、電腦端、網頁）同一條規則，見 speakMyLifeRoot。
//
// 聲波模型的檔名是內部 id（唯一鍵；關鍵字是使用者隨時會改的東西，拿來當檔名
// 改一次就多一個孤兒檔）。看不看得懂交給資料夾——平放時使用者在自己的雲端硬碟
// 只會看到一排 5.json、6.json，完全認不出哪個是哪一句。

import { driveToken } from "./store.js?v=1.6.2";

const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const ROOT_FOLDER = "Speak-My-Life";
/** 更名前的根資料夾名。只用來找到舊曲庫並把它改名過來。 */
export const LEGACY_ROOT_FOLDER = "VoiceWeaver";
/** 網頁端要不要主動把舊資料夾改名。等所有裝置都更新到新版後才可以打開（見 speakMyLifeRoot）。 */
const RENAME_LEGACY_ROOT = false;
export const MODELS_DIR = "Models";
export const ACOUSTIC_DIR = "AcousticModels";
const LANG_DIRS = ["ZH", "EN", "JA", "KO"];

/** 有沒有 Drive 可用（登入時沒授權、或匿名登入時為 false）。 */
export function driveReady(){ return !!driveToken(); }

function q(s){ return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }

async function api(url, opts = {}){
  const token = driveToken();
  if(!token) throw new Error("noDrive");
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  if(!res.ok){
    // 401 幾乎都是 token 過期（存在 sessionStorage，重新登入就好）。
    // 分開回報，不然使用者只看到一個看不懂的數字。
    throw new Error(res.status === 401 ? "driveExpired" : `HTTP ${res.status}`);
  }
  return res;
}

async function findId(name, parent, folder){
  const mime = folder ? `and mimeType = '${FOLDER_MIME}'` : `and mimeType != '${FOLDER_MIME}'`;
  const query = `name = ${q(name)} and ${q(parent)} in parents and trashed = false ${mime}`;
  const url = `${FILES}?q=${encodeURIComponent(query)}&spaces=drive`
            + `&fields=${encodeURIComponent("files(id,name)")}&pageSize=10`;
  const j = await (await api(url)).json();
  return j.files && j.files.length ? j.files[0].id : null;
}

/**
 * 同名的資料夾**全部**列出來。
 *
 * Drive 沒有「同一層不能同名」這條規則——同一個父層底下可以有兩個 Speak-My-Life，
 * 在網頁介面上長得一模一樣。findId 只拿 files[0]，而這個查詢沒有指定排序，
 * 等於在兩者之間擲骰子：使用者的曲庫在 A，網頁卻一直在看 B。
 */
async function findFolders(name, parent){
  const query = `name = ${q(name)} and ${q(parent)} in parents and trashed = false `
              + `and mimeType = '${FOLDER_MIME}'`;
  const out = [];
  let pageToken = null;
  do{
    let url = `${FILES}?q=${encodeURIComponent(query)}&spaces=drive&pageSize=100`
            + `&fields=${encodeURIComponent("nextPageToken, files(id,name)")}`;
    if(pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const j = await (await api(url)).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || null;
  }while(pageToken);
  return out;
}

// 認定的 Speak-My-Life 根。挑根要多打好幾次 API（每個候選都得看一眼裡面有什麼），
// 而列聲音、讀索引、存聲波模型每一次都要用到它，一次畫面就會問好幾遍。
//
// 但**不能永久記住**：使用者照著提示把兩個資料夾合併之後，答案就變了。
// 記著舊的會讓他做完該做的事、畫面卻沒有變化，只好去猜是不是自己弄錯了。
// 60 秒夠短，重畫一次就會重新挑；也夠長，一次渲染不會重複問。
const ROOT_TTL_MS = 60_000;
let _rootId = null, _rootTok = "", _rootAt = 0;
let _rootName = ROOT_FOLDER;     // 目前用的根叫什麼（改名失敗、沿用舊資料夾時是舊名）
const _renameFailed = new Set(); // 這次工作階段改名失敗過的舊資料夾 id，不再每分鐘重試

/** 一個候選根「像不像正主」。分數高的贏；同分時保持 Drive 回來的順序。 */
async function rootScore(id){
  const kids = (await listChildren(id, true)).map(f => f.name.toUpperCase());
  if(kids.includes(MODELS_DIR.toUpperCase())) return 3;
  if(kids.some(n => LANG_DIRS.includes(n))) return 2;        // 舊版面
  if(kids.includes(ACOUSTIC_DIR.toUpperCase())) return 1;    // 只有網頁自己建的東西
  return 0;
}

/**
 * Speak-My-Life 根資料夾的 id。
 *
 * 為什麼不能直接 findId：Drive 允許同名資料夾，而這裡**真的會有兩個**——
 * 電腦端建過一個，網頁端因為 drive.file 逐檔授權看不到它，於是又自己建了一個。
 * 之後每次查詢都在兩者之間擲骰子，使用者就會看到「AcousticModels 存得進去、
 * 但曲庫永遠是空的」這種前後矛盾的狀態，而兩邊他在 Drive 上都看得到。
 *
 * 挑「裝著曲庫的那個」，不是「剛好排第一的那個」。
 */
async function pickRoot(cands){
  if(cands.length === 1) return cands[0].id;
  let id = null, bestScore = -1;
  for(const c of cands){
    const s = await rootScore(c.id);
    if(s > bestScore){ bestScore = s; id = c.id; }
  }
  return id;
}

/**
 * 把資料夾改名（files.update 只送 name）。成功回 true。
 * drive.file 允許改「本專案建立的檔案」；不是本專案建的（例如 Colab 掛載建的）會 403。
 */
async function renameFolder(id, name){
  try{
    await api(`${FILES}/${encodeURIComponent(id)}?fields=id,name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return true;
  }catch(e){
    console.warn("[drive] 舊曲庫資料夾改名失敗，沿用舊名：", e?.message || e);
    return false;
  }
}

/**
 * 更名搬遷（VoiceWeaver → Speak-My-Life），三端同一條規則：
 *   1. 有 Speak-My-Life → 用它（就算同時還有舊的 VoiceWeaver 也不動舊的）。
 *   2. 沒有新的、有舊的 → 把舊的改名成 Speak-My-Life 再用。
 *   3. 改名失敗 → 直接沿用舊資料夾。曲庫絕不能因為改名而「消失」。
 */
async function speakMyLifeRoot(){
  const tok = driveToken() || "";
  if(_rootId && _rootTok === tok && Date.now() - _rootAt < ROOT_TTL_MS) return _rootId;
  let id = null, name = ROOT_FOLDER;
  // 一個都沒有就回 null：網頁只讀不建根（建根是電腦端／手機的事）
  const cands = await findFolders(ROOT_FOLDER, "root");
  if(cands.length){
    id = await pickRoot(cands);
  }else{
    const legacy = await findFolders(LEGACY_ROOT_FOLDER, "root");
    if(legacy.length){
      id = await pickRoot(legacy);
      // 網頁版**只沿用、不改名**：網頁永遠比 App／電腦端先上線（推上去就部署），
      // 而還沒更新的舊版 App／電腦端只認 VoiceWeaver/。網頁先改名的話，那些裝置
      // 會找不到曲庫、甚至另建一個空的 VoiceWeaver/，曲庫就裂成兩份。
      // 改名交給使用者親手更新的電腦端／App 去做；網頁看到新名就跟著用新的。
      if(RENAME_LEGACY_ROOT){
        const ok = !_renameFailed.has(id) && await renameFolder(id, ROOT_FOLDER);
        if(!ok){ _renameFailed.add(id); name = LEGACY_ROOT_FOLDER; }
      } else name = LEGACY_ROOT_FOLDER;
    }
  }
  if(id){ _rootId = id; _rootTok = tok; _rootAt = Date.now(); _rootName = name; }
  return id;
}

/** 目前使用中的根資料夾名稱（通常是 Speak-My-Life；改名失敗時是舊名 VoiceWeaver）。 */
export function rootFolderName(){ return _rootName; }

/** 有幾個同名的根資料夾（0 或 1 代表沒有這個問題）。算的是目前使用中的那個名字。 */
export async function countRoots(){
  return (await findFolders(_rootName, "root")).length;
}

export async function listChildren(parent, foldersOnly){
  let query = `${q(parent)} in parents and trashed = false`;
  if(foldersOnly) query += ` and mimeType = '${FOLDER_MIME}'`;
  const out = [];
  let pageToken = null;
  do{
    let url = `${FILES}?q=${encodeURIComponent(query)}&spaces=drive&pageSize=200`
            + `&fields=${encodeURIComponent("nextPageToken, files(id,name,mimeType,size)")}`;
    if(pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const j = await (await api(url)).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || null;
  }while(pageToken);
  return out;
}

async function readJson(fileId){
  const res = await api(`${FILES}/${fileId}?alt=media`);
  return res.json();
}

// ── 語音模型（專屬聲音）────────────────────────────────────

/**
 * Drive 上語音模型的父資料夾。新版面是 Speak-My-Life/Models，
 * 舊版面（語言資料夾直接掛在根底下）就回根本身——
 * 與 Mac 端 emotion_models.models_root、App 端 DriveApi.modelsFolder 同一條規則。
 */
async function modelsParent(){
  const root = await speakMyLifeRoot();
  if(!root) return null;
  const models = await findId(MODELS_DIR, root, true);
  if(models) return models;
  const kids = await listChildren(root, true);
  return kids.some(f => LANG_DIRS.includes(f.name.toUpperCase())) ? root : null;
}

/** 曲庫索引檔的名稱。Mac 的 emotion_models.write_catalog 與 Colab 都產出這一份。 */
const CATALOG_NAME = "catalog.json";

/**
 * 讀曲庫索引 catalog.json。找不到或壞掉回 null。
 *
 * 為什麼要有這條路：走資料夾是「地面實況」，但它需要 N+1 次 API 呼叫，而且
 * 只要中間任何一層這個瀏覽器看不見（drive.file 是逐檔授權的），整批就會靜靜消失。
 * 索引是一個檔案、一次呼叫，而且是產生曲庫的那一端自己寫的——它知道有什麼。
 *
 * **兩個地方都要找**：Mac 端 upload_catalog 傳到 Speak-My-Life/，
 * Colab 直接掛載 Drive 寫在 Speak-My-Life/Models/。同一份東西兩個位置，
 * 只看其中一邊的話，另一端更新過的曲庫就會被當成不存在。
 * 兩邊都在時取 updatedAt 較新的那份。
 */
async function readCatalog(){
  const root = await speakMyLifeRoot();
  if(!root) return null;
  const models = await findId(MODELS_DIR, root, true);
  const ids = [];
  for(const parent of [models, root]){
    if(!parent) continue;
    const id = await findId(CATALOG_NAME, parent, false);
    if(id && !ids.includes(id)) ids.push(id);
  }
  let best = null;
  for(const id of ids){
    // 一份壞掉不該讓另一份也讀不到
    let cat; try{ cat = await readJson(id); }catch{ continue; }
    if(!cat || !Array.isArray(cat.characters)) continue;
    if(!best || Number(cat.updatedAt || 0) > Number(best.updatedAt || 0)) best = cat;
  }
  return best;
}

/** catalog.json 的一筆 → 與資料夾掃出來的同一種形狀。 */
function fromCatalogEntry(c){
  const lang = String(c.lang || "").toUpperCase();
  const character = String(c.character || c.name || "").trim();
  const refs = Array.isArray(c.refs) ? c.refs : [];
  const bytes = Number(c.bytes || 0) ||
    (Number(c.gpt?.size || 0) + Number(c.sovits?.size || 0) +
     refs.reduce((s, r) => s + Number(r.size || 0), 0));
  return {
    name: lang ? `${character} ${lang}` : character, character, lang,
    ready: c.ok !== undefined ? !!c.ok : !!(c.gpt && c.sovits && refs.length),
    files: (c.gpt ? 1 : 0) + (c.sovits ? 1 : 0) + refs.length,
    bytes,
    emotions: Array.isArray(c.emotions) ? [...c.emotions].sort() : [],
    fromCatalog: true,
  };
}

/**
 * 列出 Drive 上的專屬聲音。
 *
 * 只讀資料夾結構、不下載權重：一個角色動輒幾百 MB，而這裡要回答的問題
 * 只是「我有哪些聲音、哪些能用」。合成仍然在電腦端／Colab 做。
 *
 * 回 [{name, character, lang, ready, files, bytes, emotions[]}]。
 * ready=false 代表缺權重或缺參考音，那種在電腦端也合成不出來。
 */
/**
 * 「Drive 上還沒有語音模型」但使用者明明看得到——這支負責講出它實際看到什麼。
 *
 * 空清單有四種完全不同的原因（根資料夾看不到／沒有 Models／語言層是空的／
 * 角色資料夾裡沒東西），但畫面上長得一模一樣。沒有這個，使用者和我都只能猜。
 *
 * 只列資料夾名稱，不讀任何檔案內容。
 */
export async function diagnoseVoiceModels(){
  const root = await speakMyLifeRoot();
  if(!root) return { step: "noRoot", root: `${ROOT_FOLDER}（${LEGACY_ROOT_FOLDER}）`, rootName: ROOT_FOLDER };
  const rootName = _rootName;
  // 同名根的數量要一起講。它會讓所有其他症狀變得莫名其妙——
  // 「AcousticModels 存得進去，曲庫卻永遠是空的」在只看一個資料夾時完全講不通。
  let roots = 1;
  try{ roots = await countRoots(); }catch{ /* 問不到就當作一個 */ }
  const rootKids = (await listChildren(root, true)).map(f => f.name);
  const models = await findId(MODELS_DIR, root, true);
  if(!models){
    const legacy = rootKids.filter(n => LANG_DIRS.includes(n.toUpperCase()));
    return { step: legacy.length ? "legacy" : "noModels", rootKids, legacy, roots, rootName };
  }
  const modelKids = (await listChildren(models, true)).map(f => f.name);
  const langs = modelKids.filter(n => LANG_DIRS.includes(n.toUpperCase()));
  const chars = [];
  for(const lf of await listChildren(models, true)){
    for(const cf of await listChildren(lf.id, true)) chars.push(`${lf.name}/${cf.name}`);
  }
  // 索引看得到、資料夾看不到 → 就是 drive.file 逐檔授權擋住了，不是曲庫不見了。
  // 這是兩者最有鑑別力的一組對照，所以一起回報。
  let catalog = 0;
  try{ catalog = (await readCatalog())?.characters?.length || 0; }catch{ /* 沒有就沒有 */ }
  return { step: "walked", rootKids, modelKids, langs, chars, catalog, roots, rootName };
}

export async function listVoiceModels(){
  const parent = await modelsParent();
  if(!parent) return [];
  const out = [];
  const top = await listChildren(parent, true);
  // 正常版面是 Models/<LANG>/<角色>。但如果底下一個語言資料夾都沒有，
  // 那多半是使用者自己在 Drive 網頁上把角色資料夾直接拖進 Models/——
  // 舊版遇到這種情況會**整批靜靜跳過**，畫面顯示「還沒有語音模型」，
  // 而他明明看得到那些資料夾就在那裡。寧可用未知語言列出來讓他看到。
  const hasLang = top.some(f => LANG_DIRS.includes(f.name.toUpperCase()));
  const groups = hasLang
    ? top.filter(f => LANG_DIRS.includes(f.name.toUpperCase()))
         .map(f => ({ lang: f.name.toUpperCase(), id: f.id }))
    : [{ lang: "", id: parent }];
  for(const lf of groups){
    const lang = lf.lang;
    for(const cf of await listChildren(lf.id, true)){
      let bytes = 0, files = 0, hasGpt = false, hasSovits = false;
      const emotions = [];
      const stack = [cf.id];
      while(stack.length){
        for(const f of await listChildren(stack.pop())){
          if(f.mimeType === FOLDER_MIME){ stack.push(f.id); continue; }
          files++; bytes += Number(f.size || 0);
          const n = f.name.toLowerCase();
          if(n.endsWith(".ckpt")) hasGpt = true;
          else if(n.endsWith(".pth")) hasSovits = true;
          else if(/\.(wav|mp3|flac)$/.test(n)){
            const m = f.name.match(/^\s*[【[]\s*([^】\]]+?)\s*[】\]]/);
            const emo = m ? m[1] : "中立";
            if(!emotions.includes(emo)) emotions.push(emo);
          }
        }
      }
      out.push({
        name: lang ? `${cf.name} ${lang}` : cf.name, character: cf.name, lang,
        ready: hasGpt && hasSovits && emotions.length > 0,
        files, bytes, emotions: emotions.sort(),
      });
    }
  }
  return mergeWithCatalog(out);
}

/**
 * 資料夾掃出來的 ∪ 索引裡有的，以 (語言, 角色) 為鍵。
 *
 * 資料夾優先：那是此刻 Drive 上真正躺著的東西，索引可能是上次掃描的舊資料。
 * 但**索引獨有的也要列出來**——那代表產生曲庫的那一端知道有這個角色，
 * 只是這個瀏覽器看不到那些檔案（drive.file 逐檔授權，別的程式建的檔看不見）。
 * 這種時候顯示「還沒有語音模型」，對一個在 Drive 網頁上明明看得到資料夾的人
 * 是錯的：東西在，是這一端看不到，兩件事該講不一樣的話。
 */
async function mergeWithCatalog(walked){
  let cat = null;
  // 索引讀不到不該讓已經掃到的角色跟著消失
  try{ cat = await readCatalog(); }catch{ /* 就只用資料夾掃到的 */ }
  const key = (v) => `${(v.lang || "").toUpperCase()}/${(v.character || "").trim().toLowerCase()}`;
  const seen = new Map(walked.map(v => [key(v), v]));
  for(const c of (cat?.characters || [])){
    const v = fromCatalogEntry(c);
    if(!v.character || seen.has(key(v))) continue;
    seen.set(key(v), v);
  }
  return [...seen.values()]
    .sort((a, b) => (a.lang + a.character).localeCompare(b.lang + b.character));
}
