// 從模型回應裡撈出「可以唸出來的那一句」。
//
// **刻意不 import 任何東西**——沒有 DOM、沒有網路，所以可以直接在 Node 裡測。
// 這裡是病人畫面與模型輸出之間唯一的一道關卡，那就該是測得到的。
//
// 要處理的現實：
//   · 推理模型會先吐 <think>…</think>。沒清掉的話，那一整段思考會被當成
//     「組好的句子」顯示出來，而使用者按下朗讀就是把模型的內心話唸給旁人聽。
//   · 輸出常被截斷，<think> 可能沒有結尾標籤；也有模型只吐 </think>。
//   · 模型會在思考裡「複述」要求的 JSON 格式，所以第一個 { 未必是答案。
//   · JSON 壞掉時寧可什麼都不給，也不要把殘骸當成話講出去。

const THINK_TAGS = "think|thinking|reasoning|scratchpad";

/**
 * 拿掉推理區塊。三種情況都要處理，因為輸出被截斷是常態而不是例外：
 *   1. 完整成對 <think>…</think>
 *   2. 只有開頭（後面被截斷）→ 從標籤起整段丟掉
 *   3. 只有結尾（有些模型不吐開頭標籤）→ 結束標籤之前的全部是思考
 */
export function stripThinking(raw){
  let s = String(raw ?? "");
  s = s.replace(new RegExp(`<(${THINK_TAGS})>[\\s\\S]*?<\\/\\1>`, "gi"), " ");
  // 只有結尾標籤：先切掉它前面的，再處理沒有結尾的那種
  const close = new RegExp(`<\\/(${THINK_TAGS})>`, "i");
  const m = s.match(close);
  if (m) s = s.slice(s.indexOf(m[0]) + m[0].length);
  s = s.replace(new RegExp(`<(${THINK_TAGS})>[\\s\\S]*$`, "i"), " ");
  return s.trim();
}

/** 掃出所有「括號成對」的 JSON 物件字串，依出現順序。 */
function balancedObjects(s){
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; }
      if (depth < 0) depth = 0;      // 多出來的右括號：當雜訊略過
    }
  }
  return out;
}

/**
 * 從回應裡取出 JSON 字串。
 *
 * **取「最後一個解析得動的物件」，不是第一個 { 到最後一個 }。** 模型常常在
 * 思考裡先複述一次要求的格式，那樣抓會把「範例」跟「答案」黏成一段壞掉的字串；
 * 而真正的答案照慣例在最後。全部都解析不動時，退回舊的寬鬆抓法讓搶救邏輯有東西可用。
 */
export function extractJson(raw){
  const c = stripThinking(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const objs = balancedObjects(c);
  for (let i = objs.length - 1; i >= 0; i--) {
    try { JSON.parse(objs[i]); return objs[i]; } catch { /* 換上一個 */ }
  }
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  return s >= 0 && e > s ? c.slice(s, e + 1) : null;
}

/**
 * 這串字看起來像「一句可以唸出來的話」嗎。
 *
 * 這是最後一道關卡：JSON 全壞時才走到這裡，而那時把任何東西直接當成句子交出去
 * 都是危險的——病人會把它唸給旁邊的人聽。所以寧可嚴格，撈不到就什麼都不給，
 * 讓上層顯示「重組失敗」而不是講出一段莫名其妙的話。
 *
 * 判斷依據就是「它不像一句話」的那些特徵，不是白名單：
 *   · 太長（正常組出來的句子是一句話，不是一段）
 *   · 還帶著標籤、JSON、markdown 標題或條列
 */
export function looksLikeSentence(s){
  const t = String(s ?? "").trim();
  if (!t || t.length > 120) return false;
  if (/[<>{}]/.test(t)) return false;                 // 標籤或 JSON 殘骸
  if (/"(candidates|reasoning|text|confidence)/i.test(t)) return false;
  if (/^\s*(\d+\.|[-*•]|#{1,6}\s)/.test(t)) return false;   // 條列或標題
  if (/\*\*/.test(t)) return false;                   // markdown 粗體＝在講解不是在說話
  return true;
}
