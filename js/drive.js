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
//   VoiceWeaver/Models/<LANG>/<角色>/            語音模型（GPT-SoVITS 聲文權重）
//   VoiceWeaver/AcousticModels/<分類>/<id>.json  聲波模型（專屬發音的關鍵字樣板）
//
// 聲波模型的檔名是內部 id（唯一鍵；關鍵字是使用者隨時會改的東西，拿來當檔名
// 改一次就多一個孤兒檔）。看不看得懂交給資料夾——平放時使用者在自己的雲端硬碟
// 只會看到一排 5.json、6.json，完全認不出哪個是哪一句。

import { driveToken } from "./store.js?v=1.5.8";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const ROOT_FOLDER = "VoiceWeaver";
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

async function ensureFolder(name, parent){
  const found = await findId(name, parent, true);
  if(found) return found;
  const res = await api(`${FILES}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
  return (await res.json()).id;
}

/** 逐層走一條路徑。create=false 時任何一層缺就回 null。 */
export async function folderPath(parts, create){
  let parent = "root";
  for(const name of parts){
    parent = create ? await ensureFolder(name, parent) : await findId(name, parent, true);
    if(!parent) return null;
  }
  return parent;
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

/** 寫一個 JSON 檔（同名覆蓋）。multipart 一次送完，中斷不會留下 0 byte 空檔。 */
async function writeJson(name, parent, obj){
  const existing = await findId(name, parent, false);
  const meta = existing ? { name } : { name, parents: [parent] };
  const boundary = "vwdrive" + String(obj.id || name).replace(/\W/g, "");
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(obj) +
    `\r\n--${boundary}--`;
  const url = existing
    ? `${UPLOAD}/${existing}?uploadType=multipart&fields=id`
    : `${UPLOAD}?uploadType=multipart&fields=id`;
  await api(url, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

/**
 * 丟垃圾桶（不是永久刪除），使用者可在 Drive 自己還原。
 *
 * 只收 file id 不收「名稱＋父層」：聲波模型分層之後，同一個檔名可能落在
 * 根目錄或任何一個分類資料夾，呼叫端本來就得先列出來才知道它在哪一層。
 */
async function trashById(id){
  await api(`${FILES}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

// ── 聲波模型（專屬發音）────────────────────────────────────

// 底下不再分帳號 id：這是使用者自己的雲端硬碟，一個 Google 帳號一個，
// 而 Firebase 身分也是同一個 Google 帳號換來的。多包一層永遠只有一個子資料夾，
// 只是讓他多點一次、還看到一串沒有意義的亂碼。
const ACOUSTIC_PATH = [ROOT_FOLDER, ACOUSTIC_DIR];

// 檔案放在 AcousticModels/<分類>/<id>.json。
//
// 檔名維持內部 id（唯一鍵，關鍵字是使用者隨時會改的東西），看不看得懂
// 交給資料夾負責——平放時使用者在雲端硬碟只會看到一排 5.json、6.json。
//
// 舊版面（平放在 AcousticModels 底下）仍然要讀得到：少讀一層的後果不是
// 「少一筆」，而是網頁把它當成雲端沒有、存檔時整個蓋掉。
const DEFAULT_CATEGORY = 'Custom';

/** 檔名不能有 / ，前後空白會被吃掉，空字串建不出資料夾。與 App 端同一套規則。 */
function sanitizeCategory(raw){
  const cleaned = String(raw ?? '')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .trim().replace(/\s+/g, ' ')
    .slice(0, 48);
  return cleaned || DEFAULT_CATEGORY;
}

/** 根目錄本身 + 每個分類子資料夾裡的 .json，一次列完。 */
async function acousticFiles(parent){
  const kids = await listChildren(parent);
  const out = kids.filter(f => f.mimeType !== FOLDER_MIME && /\.json$/i.test(f.name))
                  .map(f => ({ ...f, parentId: parent }));
  for(const dir of kids.filter(f => f.mimeType === FOLDER_MIME)){
    const inner = await listChildren(dir.id);
    for(const f of inner){
      if(f.mimeType !== FOLDER_MIME && /\.json$/i.test(f.name)) out.push({ ...f, parentId: dir.id });
    }
  }
  return out;
}

export async function listAcoustic(){
  const parent = await folderPath(ACOUSTIC_PATH, false);
  if(!parent) return [];
  const out = [];
  for(const f of await acousticFiles(parent)){
    // 單筆壞掉不該讓整次取回失敗——其他筆是好的，使用者該拿得到
    try{ out.push(await readJson(f.id)); }catch{ /* 跳過這一筆 */ }
  }
  return out;
}

/**
 * 只讀一筆。存檔時要保住手機錄好的 exemplarBlob，但為了一個欄位把整個
 * 資料夾的檔案全下載一遍太浪費——三十句就是三十次下載，而只有一句要改。
 * 找不到回 null。
 */
export async function readAcoustic(id){
  const parent = await folderPath(ACOUSTIC_PATH, false);
  if(!parent) return null;
  const hit = (await acousticFiles(parent)).find(f => f.name === `${id}.json`);
  if(!hit) return null;
  try{ return await readJson(hit.id); }catch{ return null; }
}

export async function saveAcoustic(template){
  const root = await folderPath(ACOUSTIC_PATH, true);
  const category = sanitizeCategory(template.category);
  const parent = await folderPath([...ACOUSTIC_PATH, category], true);
  await writeJson(`${template.id}.json`, parent, { ...template, category });
  // 這一筆以前可能平放在根目錄、或歸在別的分類。留著的話同一個樣板會有兩份，
  // 而「雲端是主」會讓兩份都被拉回手機 → 使用者看到重複的觸發詞。
  await trashAcousticElsewhere(root, parent, `${template.id}.json`);
}

async function trashAcousticElsewhere(root, keep, name){
  for(const f of await acousticFiles(root)){
    if(f.name === name && f.parentId !== keep){
      try{ await trashById(f.id); }catch{ /* 清不掉不該讓存檔失敗 */ }
    }
  }
}

export async function deleteAcoustic(id){
  const parent = await folderPath(ACOUSTIC_PATH, false);
  if(!parent) return;
  // 不假設它在哪一層：根目錄與每個分類資料夾都找一次
  for(const f of await acousticFiles(parent)){
    if(f.name === `${id}.json`){
      try{ await trashById(f.id); }catch{ /* 略過 */ }
    }
  }
}

/**
 * 合併兩個來源的清單，**以觸發詞為鍵**去重。
 *
 * 有錄音的永遠勝過沒錄音的：沒錄音的那筆在手機上永遠不會命中，
 * 讓它蓋掉有錄音的等於把已經在用的功能弄壞，而使用者為了那段錄音講了 5 次。
 * 都有錄音就留新的。與 App 端 DriveAcousticMirror.merge 同一套規則。
 */
export function mergeShortcuts(...sources){
  const best = new Map();
  for(const list of sources) for(const x of (list || [])){
    const key = String(x.keyword || "").trim().toLowerCase();
    if(!key) continue;
    const prev = best.get(key);
    if(!prev) { best.set(key, x); continue; }
    if(!prev.hasRecording && x.hasRecording) best.set(key, x);
    else if(prev.hasRecording && !x.hasRecording) { /* 留 prev */ }
    else if((x.createdAt || 0) > (prev.createdAt || 0)) best.set(key, x);
  }
  return [...best.values()].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
}

// ── 語音模型（專屬聲音）────────────────────────────────────

/**
 * Drive 上語音模型的父資料夾。新版面是 VoiceWeaver/Models，
 * 舊版面（語言資料夾直接掛在 VoiceWeaver 底下）就回 VoiceWeaver 本身——
 * 與 Mac 端 emotion_models.models_root、App 端 DriveApi.modelsFolder 同一條規則。
 */
async function modelsParent(){
  const root = await folderPath([ROOT_FOLDER], false);
  if(!root) return null;
  const models = await findId(MODELS_DIR, root, true);
  if(models) return models;
  const kids = await listChildren(root, true);
  return kids.some(f => LANG_DIRS.includes(f.name.toUpperCase())) ? root : null;
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
export async function listVoiceModels(){
  const parent = await modelsParent();
  if(!parent) return [];
  const out = [];
  for(const lf of await listChildren(parent, true)){
    const lang = lf.name.toUpperCase();
    if(!LANG_DIRS.includes(lang)) continue;
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
        name: `${cf.name} ${lang}`, character: cf.name, lang,
        ready: hasGpt && hasSovits && emotions.length > 0,
        files, bytes, emotions: emotions.sort(),
      });
    }
  }
  out.sort((a, b) => (a.lang + a.character).localeCompare(b.lang + b.character));
  return out;
}
