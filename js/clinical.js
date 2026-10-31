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
  // 英文原本寫「go / walk」——那是給人看的註解，不是能唸的題目：斜線跟兩個詞都會被拿去
  // 比對，使用者照唸「walk」也只拿一半分數。題目一定要是一個唸得出來的字串。
  "走":["walk","歩く","걷다"],
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

// ── 各語言自己寫的補充題 ─────────────────────────────────────
// 上面那批是與 App 共用的核心題（中文出題、再附各語言譯文），情境句只有 4 題、
// 短句剛好 8 題，不夠一次完整的練習。這裡**直接用各語言寫**補上：
// 失語症復健常用的生活需求句與看圖描述句，用的是該語言日常真的會講的說法
// （例如日文用「〜てください」、韓文用「〜아/어 주세요」的請求句型），不是從中文逐字翻過去。
// 每級補完之後四種語言都至少 8 題（名詞 12／動作 10／短句 12／情境句 10）。
const NATIVE_EXTRA = {
  "zh": {
    "rehab.bankShort": ["我好冷", "請幫我開燈", "請叫我女兒來", "我想喝茶"],
    "rehab.bankSituational": ["爸爸在廚房煮晚餐", "奶奶坐在公園的椅子上看報紙", "小狗在草地上追球",
                              "下雨了，我們帶傘出門", "護理師正在幫爺爺量血壓", "我們全家一起吃晚餐"],
  },
  "en": {
    "rehab.bankShort": ["I'm cold", "Turn on the light, please", "Can you call my daughter?", "I'd like a cup of tea"],
    "rehab.bankSituational": ["Dad is cooking dinner in the kitchen", "Grandma is reading the paper on a park bench",
                              "The dog is chasing a ball on the grass", "It's raining, so we're taking an umbrella",
                              "The nurse is checking Grandpa's blood pressure", "The whole family is having dinner together"],
  },
  "ja": {
    "rehab.bankShort": ["寒いです", "電気をつけてください", "娘を呼んでください", "お茶が飲みたいです"],
    "rehab.bankSituational": ["お父さんが台所で晩ご飯を作っている", "おばあさんが公園のベンチで新聞を読んでいる",
                              "犬が芝生でボールを追いかけている", "雨が降っているので、傘を持って出かける",
                              "看護師さんがおじいさんの血圧を測っている", "家族みんなで晩ご飯を食べている"],
  },
  "ko": {
    "rehab.bankShort": ["추워요", "불 좀 켜 주세요", "딸 좀 불러 주세요", "차 한 잔 마시고 싶어요"],
    "rehab.bankSituational": ["아빠가 부엌에서 저녁을 만들고 있다", "할머니가 공원 벤치에서 신문을 읽고 있다",
                              "강아지가 잔디밭에서 공을 쫓아가고 있다", "비가 와서 우산을 들고 나간다",
                              "간호사가 할아버지의 혈압을 재고 있다", "온 가족이 함께 저녁을 먹고 있다"],
  },
};

// 四級的級別標籤：由易到難（單詞命名 → 動作 → 生活短句 → 情境描述），
// 對應臨床上從「詞」走到「句」再走到「描述」的復健階梯。
const LEVEL_KEYS = ["rehab.level1", "rehab.level2", "rehab.level3", "rehab.level4"];

/**
 * 當前介面語言的四級題庫：[{ key, levelKey, items:[題目字串] }]。
 * items 已經是該語言的字串，直接顯示、直接拿去練習與評分（兩者必須一致，見 practiceItem）。
 */
export function bankFor(lang){
  const L = (lang || document.documentElement.getAttribute("data-lang") || "zh-TW").split("-")[0];
  const extra = NATIVE_EXTRA[L] || NATIVE_EXTRA.zh;
  return CLINICAL_BANK.map((g, i) => {
    const items = g.items.map(zh => practiceItem(zh, L)).concat(extra[g.key] || []);
    return { key: g.key, levelKey: LEVEL_KEYS[i], items: [...new Set(items)] };
  });
}
