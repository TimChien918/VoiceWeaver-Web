// AAC 圖卡：資料來自 aacdata.js（卡片由 App 的 AacData.kt 轉出，另補多語詞面），
// 這裡把它轉成畫面要的形狀。
//
// 每張卡帶兩個詞面，用途不同、不可混用：
//   word  = 目前語言的詞面 → 顯示、朗讀、搜尋
//   label = 繁中原文       → 排序演算法的比對基準（概念詞群是中文策劃的，
//                            換成譯文整組語意相似會失效）
//
// 詞性色碼＝費茲傑羅（Fitzgerald Key）："n"名詞→黃、"v"動詞→綠、"a"形容詞→藍，
// 省略＝中性（時間詞、問句、社交詞不上色）。App 的資料沒有這一欄，依分類給預設值
// ——同一類的詞性絕大多數一致，少數例外也比整片不上色好。
import { AAC_CATEGORIES, AAC_ITEMS, CURRENCIES, labelIn } from "./aacdata.js?v=1.4.9";

export { AAC_CATEGORIES, AAC_ITEMS, CURRENCIES, labelIn };

const POS_BY_CAT = {
  Products:"n", FoodDrink:"n", People:"n", Places:"n", Medical:"n",
  Actions:"v", Needs:"v",
  Emotions:"a",
  Money:"", Time:"", Questions:"", Emergency:"",
};

/** 分類 id 清單（順序＝App 的 enum 順序，患者靠位置記憶找卡，不可重排）。 */
export const AAC_CATS = AAC_CATEGORIES.map(c => c.id);
export const CAT_EMOJI = Object.fromEntries(AAC_CATEGORIES.map(c => [c.id, c.emoji]));

const curLang = () => document.documentElement.getAttribute("data-lang") || "zh-TW";

export function toCard(i, lang) {
  const L = lang || curLang();
  return {
    id: i.id,
    emoji: i.emoji,
    word: labelIn(i, L),   // 顯示／朗讀／搜尋
    label: i.label,        // 繁中原文：排序演算法比對用
    pos: POS_BY_CAT[i.cat] || "",
    strong: !!i.strong,
  };
}

/** 某分類的卡片（依目前語言）。 */
export function cardsOfCat(catId, lang) {
  return AAC_ITEMS.filter(i => i.cat === catId).map(i => toCard(i, lang));
}

/**
 * 全庫（推薦列用）。做成函式而不是常數：語言是執行期才決定的，
 * 常數會把第一次載入時的語言凍在裡面。
 */
export function allCards(lang) {
  return AAC_ITEMS.map(i => toCard(i, lang));
}

/**
 * 搜尋：比對目前語言的詞面，也比對繁中原文——照護者可能在英文介面下
 * 用中文找卡，或反過來。
 */
export function searchCards(query, lang) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return allCards(lang).filter(c =>
    c.word.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
}

// 重度模式「逐張掃描」的備胎核心卡（純生活必需）：家人沒自建照片卡時用這組。
// 直接對應全庫裡的卡，所以自動跟著語言走。
const SEVERE_IDS = ["f_want_water", "f_meal", "n_toilet", "n_rest",
                    "md_sick", "n_pain", "q_help", "g_help"];
export function severeCore(lang) {
  return SEVERE_IDS
    .map(id => AAC_ITEMS.find(i => i.id === id))
    .filter(Boolean)
    .map(i => toCard(i, lang));
}
