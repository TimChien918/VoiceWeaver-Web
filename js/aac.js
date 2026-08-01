// AAC 圖卡：資料來自 aacdata.js（由 App 的 AacData.kt 轉出，兩邊逐字一致），
// 這裡只負責轉成畫面要的形狀，並補上網頁特有的詞性色碼。
//
// 詞性色碼＝費茲傑羅（Fitzgerald Key）："n"名詞→黃、"v"動詞→綠、"a"形容詞→藍，
// 省略＝中性（時間詞、問句、社交詞不上色）。視覺錨點幫助語法訓練（輕症模式）。
// App 的資料沒有這一欄，依分類給預設值——同一類的詞性絕大多數一致，
// 少數例外（動作類裡的「好」）比整片不上色好。
import { AAC_CATEGORIES, AAC_ITEMS, CURRENCIES } from "./aacdata.js?v=1.4.1";

export { AAC_CATEGORIES, AAC_ITEMS, CURRENCIES };

const POS_BY_CAT = {
  Products:"n", FoodDrink:"n", People:"n", Places:"n", Medical:"n",
  Actions:"v", Needs:"v",
  Emotions:"a",
  Money:"", Time:"", Questions:"", Emergency:"",
};

/** 分類 id 清單（順序＝App 的 enum 順序，患者靠位置記憶找卡，不可重排）。 */
export const AAC_CATS = AAC_CATEGORIES.map(c => c.id);
export const CAT_EMOJI = Object.fromEntries(AAC_CATEGORIES.map(c => [c.id, c.emoji]));

/** 某分類的卡片，統一成畫面用的形狀。 */
export function cardsOfCat(catId) {
  return AAC_ITEMS.filter(i => i.cat === catId).map(toCard);
}
export function toCard(i) {
  return { id: i.id, emoji: i.emoji, word: i.label, pos: POS_BY_CAT[i.cat] || "", strong: !!i.strong };
}
/** 全庫（推薦列與搜尋用）。 */
export const ALL_CARDS = AAC_ITEMS.map(toCard);

/** 搜尋：比對詞面，與 App 的 filterAacItems 同語意。 */
export function searchCards(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return ALL_CARDS.filter(c => c.word.toLowerCase().includes(q));
}

// 重度模式「逐張掃描」的備胎核心卡（純生活必需）：家人沒自建照片卡時用這組。
export const SEVERE_CORE = [
  ["💧","喝水"],["🍚","吃飯"],["🚻","上廁所"],["😴","休息"],
  ["🤕","不舒服"],["😣","痛"],["🙋","要人幫忙"],["🆘","救命"],
];
