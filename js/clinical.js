// 臨床常用題庫（漢語標準失語症檢查表通用題）——與 App 的 AphasiaPractice 同源，
// 取的筆數也跟 App 畫面一致（名詞 12／動作 10／短句 8／情境句 4）。
// 離線可用：不需要 LLM 金鑰就能開始練。
export const CLINICAL_BANK = [
  { key:"rehab.bankNouns", items:["水", "杯子", "碗", "筷子", "湯匙", "毛巾", "牙刷", "牙膏", "肥皂", "梳子", "鏡子", "雨傘"] },
  { key:"rehab.bankVerbs", items:["坐", "站", "走", "跑", "躺", "睡", "吃", "喝", "吃飯", "喝水"] },
  { key:"rehab.bankShort", items:["我想喝水", "我要吃飯", "我想休息", "我想睡覺", "我要上廁所", "請給我藥", "我會痛", "我想回家"] },
  { key:"rehab.bankSituational", items:["媽媽準備給男孩講故事", "男孩在洗頭", "一個學生邊讀邊寫", "孩子們堆了一個大雪人"] },
];

// 各語言的題目。網頁版的語音辨識跟著介面語言走（speech.js：rec.lang = settings.lang），
// 所以英文介面就直接練英文句子——顯示、朗讀、辨識、評分全都是英文，不必再附中文。
// （手機 App 不一樣：那邊離線辨識只認中文，題目必須維持中文再附譯文。）
// 譯文與 App 的 AphasiaPracticeI18n 同一份，兩邊用字一致。
const GLOSS = {
  "水":["water","水","물"],
  "杯子":["cup","コップ","컵"],
  "碗":["bowl","お椀","그릇"],
  "筷子":["chopsticks","箸","젓가락"],
  "湯匙":["spoon","スプーン","숟가락"],
  "毛巾":["towel","タオル","수건"],
  "牙刷":["toothbrush","歯ブラシ","칫솔"],
  "牙膏":["toothpaste","歯磨き粉","치약"],
  "肥皂":["soap","石鹸","비누"],
  "梳子":["comb","櫛","빗"],
  "鏡子":["mirror","鏡","거울"],
  "雨傘":["umbrella","傘","우산"],
  "坐":["sit","座る","앉다"],
  "站":["stand","立つ","서다"],
  "走":["go / walk","歩く","가다"],
  "跑":["run","走る","달리다"],
  "躺":["lie down","横になる","눕다"],
  "睡":["sleep","寝る","자다"],
  "吃":["eat","食べる","먹다"],
  "喝":["drink","飲む","마시다"],
  "吃飯":["eat a meal","食事する","밥 먹다"],
  "喝水":["drink water","水を飲む","물 마시다"],
  "我想喝水":["I want to drink water","水が飲みたい","물 마시고 싶어요"],
  "我要吃飯":["I want to eat","ご飯が食べたい","밥 먹고 싶어요"],
  "我想休息":["I want to rest","休みたい","쉬고 싶어요"],
  "我想睡覺":["I want to sleep","寝たい","자고 싶어요"],
  "我要上廁所":["I need the toilet","トイレに行きたい","화장실 가고 싶어요"],
  "請給我藥":["Please give me my medicine","薬をください","약 주세요"],
  "我會痛":["It hurts","痛い","아파요"],
  "我想回家":["I want to go home","家に帰りたい","집에 가고 싶어요"],
  "媽媽準備給男孩講故事":["Mum is getting ready to tell the boy a story","お母さんが男の子に物語を読んであげる準備をしている","엄마가 남자아이에게 이야기를 들려주려 한다"],
  "男孩在洗頭":["The boy is washing his hair","男の子が髪を洗っている","남자아이가 머리를 감고 있다"],
  "一個學生邊讀邊寫":["A student is reading and writing at the same time","ある学生が読みながら書いている","한 학생이 읽으면서 쓰고 있다"],
  "孩子們堆了一個大雪人":["The children built a big snowman","子どもたちが大きな雪だるまを作った","아이들이 큰 눈사람을 만들었다"],
};

/**
 * 取當前介面語言的題目。繁中介面、或該題沒有譯文時回原本的中文。
 * 回傳值同時是「顯示的字」和「拿去辨識評分的目標」——兩者必須一致，
 * 不然使用者唸的是螢幕上的英文、卻拿中文去比對，分數會永遠是 0。
 */
export function practiceItem(zh, lang){
  const L = (lang || document.documentElement.getAttribute("data-lang") || "zh-TW").split("-")[0];
  const i = L === "en" ? 0 : L === "ja" ? 1 : L === "ko" ? 2 : -1;
  if(i < 0) return zh;
  return GLOSS[zh]?.[i] || zh;
}
