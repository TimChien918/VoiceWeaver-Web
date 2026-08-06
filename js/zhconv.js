// 簡體 → 繁體（台灣用字）轉換。
//
// 為什麼需要：雲端 LLM 就算 prompt 明寫「輸出繁體中文」，還是會偶爾漏簡體字
// （實測組出「我這裡會痛，請去医院。」）。使用者是台灣人，畫面與朗讀都該是繁體。
//
// 為什麼不是把 App 的 t2s 表反轉：繁→簡是多對一，反轉會製造錯字。
// 實測反轉法會把「干杯」轉成「干盃」——盃 是 杯 的異體字，正確的繁體反而被改壞。
//
// 這裡的兩份資料由 OpenCC（s2tw）產生：
//   s2t_map.txt     單字表，格式「簡繁簡繁…」交錯。已用回轉檢查排掉異體字正規化，
//                   所以 杯 這種「本來就是繁體」的字不會被動到。
//   s2t_phrases.txt 詞組表，格式「簡\t繁」每行一筆，只收**逐字轉會轉錯**的詞。
//                   單字表處理得了的詞就不收，檔案才不會變成 1MB。
//                   例：干杯→乾杯（逐字會轉成「幹杯」）、头发→頭髮（逐字會轉成「頭發」）。
//
// 轉換順序：先套詞組（長詞優先），再對剩下的字套單字表。

const VER = "?v=1.5.1";

let _chars = null;                 // Map<簡, 繁>
let _phrases = null;               // Map<簡詞, 繁詞>
let _maxPhraseLen = 0;
let _loading = null;

async function ensureLoaded(){
  if(_chars) return;
  if(_loading) return _loading;
  _loading = (async () => {
    try{
      const [packed, phraseTxt] = await Promise.all([
        fetch("s2t_map.txt" + VER).then(r => r.ok ? r.text() : ""),
        fetch("s2t_phrases.txt" + VER).then(r => r.ok ? r.text() : "")
      ]);
      const chars = new Map();
      for(let i = 0; i + 1 < packed.length; i += 2) chars.set(packed[i], packed[i + 1]);

      const phrases = new Map();
      let maxLen = 0;
      for(const line of phraseTxt.split("\n")){
        const tab = line.indexOf("\t");
        if(tab <= 0) continue;
        const simp = line.slice(0, tab), trad = line.slice(tab + 1);
        if(!simp || !trad) continue;
        phrases.set(simp, trad);
        if(simp.length > maxLen) maxLen = simp.length;
      }
      _chars = chars; _phrases = phrases; _maxPhraseLen = maxLen;
    }catch{
      _chars = new Map(); _phrases = new Map(); _maxPhraseLen = 0;   // 載入失敗＝原樣輸出，不擋功能
    }
  })();
  return _loading;
}

/** 預載對照表。啟動時呼叫一次，之後 toTraditionalSync 才有東西可用。 */
export function preloadZhConv(){ return ensureLoaded(); }

/**
 * 簡體 → 繁體。對照表還沒載入完就原樣回傳，不阻塞發聲。
 * 已經是繁體的字不會被動到（單字表產生時做過回轉檢查）。
 */
export function toTraditionalSync(text){
  if(!text || !_chars || (_chars.size === 0 && _phrases.size === 0)) return text;
  let out = "";
  let i = 0;
  while(i < text.length){
    // 詞組優先，長的先試——「长头发」要整組換成「長頭髮」，逐字會得到「長頭發」
    let matched = false;
    const maxTry = Math.min(_maxPhraseLen, text.length - i);
    for(let len = maxTry; len >= 2; len--){
      const hit = _phrases.get(text.substr(i, len));
      if(hit){ out += hit; i += len; matched = true; break; }
    }
    if(matched) continue;
    const ch = text[i];
    out += _chars.get(ch) ?? ch;
    i++;
  }
  return out;
}
