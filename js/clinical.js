// 臨床常用題庫（漢語標準失語症檢查表通用題）——與 App 的 AphasiaPractice 同源，
// 取的筆數也跟 App 畫面一致（名詞 12／動作 10／短句 8／情境句 4）。
// 離線可用：不需要 LLM 金鑰就能開始練。
export const CLINICAL_BANK = [
  { key:"rehab.bankNouns", items:["水", "杯子", "碗", "筷子", "湯匙", "毛巾", "牙刷", "牙膏", "肥皂", "梳子", "鏡子", "雨傘"] },
  { key:"rehab.bankVerbs", items:["坐", "站", "走", "跑", "躺", "睡", "吃", "喝", "吃飯", "喝水"] },
  { key:"rehab.bankShort", items:["我想喝水", "我要吃飯", "我想休息", "我想睡覺", "我要上廁所", "請給我藥", "我會痛", "我想回家"] },
  { key:"rehab.bankSituational", items:["媽媽準備給男孩講故事", "男孩在洗頭", "一個學生邊讀邊寫", "孩子們堆了一個大雪人"] },
];
