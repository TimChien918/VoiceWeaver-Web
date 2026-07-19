// 動態候選字詞預測：依「上一個點的詞性」決定下一步優先顯示的詞性。
// 引導 SVO 語序（輕症語法訓練）：點了動詞 → 名詞優先；點了名詞 → 動詞優先；
// 點了形容詞 → 名詞優先。穩定排序：同詞性內維持原順序，不打亂使用者的空間記憶。
const NEXT = { v: "n", n: "v", a: "n" };

export function preferredNext(lastPos){ return NEXT[lastPos] || ""; }

export function orderCards(cards, lastPos){
  const want = preferredNext(lastPos);
  if(!want) return cards;
  return [...cards.filter(c=>c.pos === want), ...cards.filter(c=>c.pos !== want)];
}
