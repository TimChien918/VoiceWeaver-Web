// AAC 圖卡的「動態牆」排序引擎——與 App 的 AacUsageRanker.kt 同一套演算法。
//
// 為什麼要排序：預設圖卡庫兩百多張，但每個患者天天講的就是那十幾句。
// 社群平台解的是同一個問題（內容太多、注意力有限），配方是
// 「互動分數 × 時間衰減 ＋ 情境相關性」：
//
//  - 時間衰減：Σ 2^(-age/半衰期)，半衰期 7 天。上週開始常講的新需求很快浮上來，
//    上個月的舊話題自然沉下去；增量可維護，不必保留整串時間戳。
//  - 情境相關性：吃藥、吃飯有強烈時段性，醫療類在醫院才高頻 → 記「幾點按的」
//    「在哪按的」，同時段／同地點加成。
//  - 個人化不是黑箱：排序只影響「常用」推薦列與類別內順序，類別結構本身不動——
//    失語症患者靠位置記憶找卡，整個版面跟著演算法大風吹反而是災難。
//
// EdgeRank 式推薦指數（FB 動態牆骨架：affinity × weight × decay）：一張卡的分數
// 還會從相關的卡吸收——協同關聯（同一句一起出現過的卡互相拉抬）＋語意相似
// （概念詞群解冷啟動，第一次按「喝水」時「杯子」就已有加成）。傳播只做一層，
// 防止分數在圖上迴圈放大。
//
// 統計存 localStorage（對應 App 的 SharedPreferences）：量小、跨重啟持續學習、
// 壞掉就重新開始學，不影響主功能。

const LS_KEY = "vw_aac_ranker";
const HALF_LIFE_MS = 7 * 24 * 3600_000;   // 半衰期 7 天
const HOUR_BUCKETS = 6;                    // 一天切 6 桶（每 4 小時）
export const FEED_SIZE = 8;                // 「常用」推薦列最多幾張

let stats = {};   // itemId → { s:分數, t:更新時間, h:[時段桶], l:地點 }
let edges = {};   // "a|b"（字典序）→ { s:共現分, t:更新時間 }
let loaded = false;

function decayed(score, updatedAt, now) {
  if (!(score > 0) || !(updatedAt > 0)) return 0;
  return score * Math.pow(2, -Math.max(0, now - updatedAt) / HALF_LIFE_MS);
}
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const bucketOf = now => Math.floor(new Date(now).getHours() / (24 / HOUR_BUCKETS));

export function initRanker() {
  if (loaded) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      edges = o._edges || {};
      for (const k of Object.keys(o)) {
        if (k === "_edges") continue;
        const v = o[k];
        stats[k] = { s: +v.s || 0, t: +v.t || 0,
                     h: Array.isArray(v.h) ? v.h.slice(0, HOUR_BUCKETS) : new Array(HOUR_BUCKETS).fill(0),
                     l: v.l || "" };
        while (stats[k].h.length < HOUR_BUCKETS) stats[k].h.push(0);
      }
    }
  } catch { stats = {}; edges = {}; }   // 壞掉就重新學，不擋主功能
  loaded = true;
}

function persist() {
  try {
    const o = { _edges: edges };
    for (const [k, v] of Object.entries(stats)) o[k] = v;
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch { /* 配額滿：統計掉了不影響溝通本身 */ }
}

// 概念詞群（content similarity 的冷啟動知識），與 App 逐字一致。
// 用「詞包含關鍵字」比對——「喝水」「一杯水」「杯子」「口渴」都命中水群。
const CONCEPTS = [
  ["水","喝","渴","杯","飲","茶","咖啡","牛奶","吸管","冰","熱的","湯"],
  ["吃","飯","餓","麵","餐","食","水果","麵包","糖","菜單"],
  ["藥","醫","病","痛","暈","吐","燒","血","護理","診","處方","過敏"],
  ["錢","$","元","付","買","刷卡","現金","找零","貴","發票","收據","悠遊卡"],
  ["廁所","尿","清潔","衛生紙"],
  ["家","媽","爸","小孩","朋友"],
  ["車","站","機場","登機","司機","停車"],
  ["睡","累","休息","躺","毯子","床"],
  ["冷","熱","溫"],
  ["救","警","緊急","危險","跌倒","呼吸","噎"],
];
// 概念詞群是用繁體中文策劃的，所以語意相似一律拿**繁中原文**（label）比對。
// 卡片上的 word 是目前語言的詞面（顯示與朗讀用），拿它比對會讓英日韓語系
// 整組語意相似失效——換了語言，「喝水」就再也拉不出「杯子」。
const labelOf = it => it.label ?? it.word ?? "";

const _conceptCache = new Map();
function conceptsOf(label) {
  let c = _conceptCache.get(label);
  if (!c) {
    c = new Set();
    CONCEPTS.forEach((group, i) => { if (group.some(w => label.includes(w))) c.add(i); });
    _conceptCache.set(label, c);
  }
  return c;
}
/** 兩張卡的語意相似度：共享概念群 → 0.4（共享多群不再加，避免詞群重疊灌水）。 */
function similarity(a, b) {
  if (a.id === b.id) return 0;
  const ca = conceptsOf(labelOf(a)), cb = conceptsOf(labelOf(b));
  for (const x of ca) if (cb.has(x)) return 0.4;
  return 0;
}

/**
 * 患者按了一張卡：先把舊分數衰減到現在，再 +1。
 * companions＝目前句子裡已有的卡，跟新按的這張建立協同關聯
 * （同一句一起出現＝患者心裡這些概念是綁在一起的）。
 */
export function recordUse(itemId, locationTag = "", companions = []) {
  initRanker();
  const now = Date.now();
  const s = stats[itemId] || (stats[itemId] = { s: 0, t: 0, h: new Array(HOUR_BUCKETS).fill(0), l: "" });
  s.s = decayed(s.s, s.t, now) + 1;
  s.t = now;
  s.h[bucketOf(now)]++;
  if (locationTag) s.l = locationTag;
  for (const other of companions) {
    if (other === itemId) continue;
    const k = pairKey(itemId, other);
    const e = edges[k] || (edges[k] = { s: 0, t: 0 });
    e.s = decayed(e.s, e.t, now) + 1;
    e.t = now;
  }
  persist();
}

/**
 * 一張卡此刻的基礎分。情境加成用**乘法**——沒用過的卡（基底 0）不會只因時段對
 * 就冒出來，避免推薦列出現患者根本不認識的卡。
 */
function scoreOf(itemId, now, locationTag) {
  const s = stats[itemId];
  if (!s) return 0;
  let sc = decayed(s.s, s.t, now);
  if (sc <= 0) return 0;
  const total = s.h.reduce((a, b) => a + b, 0);
  if (total >= 3) {                                  // 時段加成
    const share = s.h[bucketOf(now)] / total;
    if (share >= 0.3) sc *= 1 + share;
  }
  if (locationTag && locationTag === s.l) sc *= 1.3;  // 地點加成
  return sc;
}

/** 全庫裡「有使用分」的卡（推薦指數的傳播來源）。 */
function usedOf(allItems, now, locationTag) {
  const out = [];
  for (const it of allItems) {
    const base = scoreOf(it.id, now, locationTag);
    if (base > 0) out.push([it, base]);
  }
  return out;
}

/**
 * EdgeRank 式推薦指數：
 *   rec(i) = base(i) + Σ_j base(j) × ( 共現(i,j)/(共現+2) + 語意相似(i,j) ) × 0.5
 * 共現分做拉普拉斯式壓縮永遠 < 1——學來的關聯再強也只能拉抬、不能超越本尊；
 * ×0.5 是單層傳播的阻尼。
 */
function recommendScore(item, used, now, locationTag) {
  let rec = scoreOf(item.id, now, locationTag);
  for (const [other, otherBase] of used) {
    if (other.id === item.id) continue;
    const e = edges[pairKey(item.id, other.id)];
    const co = e ? decayed(e.s, e.t, now) : 0;
    const affinity = co / (co + 2) + similarity(item, other);
    if (affinity > 0) rec += otherBase * affinity * 0.5;
  }
  return rec;
}

/**
 * 「常用」推薦列：全庫依推薦指數取前 N 張。不只是用過的卡——跟常用卡相關的
 * （喝水→杯子）也會浮進來。冷啟動回空陣列，UI 就不顯示這一列，不硬塞猜測。
 */
export function feed(allItems, locationTag = "", limit = FEED_SIZE) {
  initRanker();
  const now = Date.now();
  const used = usedOf(allItems, now, locationTag);
  if (!used.length) return [];
  return allItems
    .map(it => [it, recommendScore(it, used, now, locationTag)])
    .filter(([, sc]) => sc > 0.1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([it]) => it);
}

/**
 * 類別內排序：依推薦指數往前排、沒分數的維持原順序附在後面。
 * 用穩定排序，同分（都是 0）不互換——版面不大風吹。
 */
export function rankWithin(items, locationTag = "") {
  initRanker();
  const now = Date.now();
  const used = usedOf(items, now, locationTag);
  if (!used.length) return items;
  return items
    .map((it, i) => [it, recommendScore(it, used, now, locationTag), i])
    .sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]))
    .map(([it]) => it);
}

/** 目前仍有有效分數的卡有幾張（冷啟動門檻判斷用，同 App 的 activeItemCount）。 */
export function activeItemCount() {
  initRanker();
  const now = Date.now();
  return Object.values(stats).filter(s => decayed(s.s, s.t, now) >= 1).length;
}

/** 清空統計（設定頁「重置」用）。 */
export function clearRanker() {
  stats = {}; edges = {}; persist();
}
