// 圖片說故事的題庫。四格與情境沿用 App 的 StoryTraining.kt，另外補上多語版本。
//
// 為什麼標題、提示、關鍵字三者都要翻：關鍵字是拿來比對「使用者說出來的話」算分的。
// 只翻畫面不翻關鍵字的話，日文使用者用日文說完故事，比對中文關鍵字永遠命中 0，
// 分數固定掛零——那比不翻更糟。
export const STORY_PROMPTS = [
  {
    id: "story_betel_sell",
    title: {
      "zh-TW": "賣一包檳榔給客人",
      "en": "Selling a pack to a customer",
      "ja": "お客さんに一袋売る",
      "ko": "손님에게 한 봉지 팔기"
    },
    frames: [
      { emoji: "🏪", hint: { "zh-TW": "客人走到攤位", "en": "A customer comes to the stall", "ja": "お客さんが屋台に来る", "ko": "손님이 가게에 옴" } },
      { emoji: "🌿", hint: { "zh-TW": "拿出包葉檳榔", "en": "Take out the wrapped betel nut", "ja": "包み葉のビンロウを出す", "ko": "잎에 싼 빈랑을 꺼냄" } },
      { emoji: "💵", hint: { "zh-TW": "客人付 100 元", "en": "The customer pays 100", "ja": "お客さんが100元払う", "ko": "손님이 100원을 냄" } },
      { emoji: "🤲", hint: { "zh-TW": "找零 50 元給客人", "en": "Give 50 back as change", "ja": "50元をおつりで返す", "ko": "거스름돈 50원을 줌" } }
    ],
    keywords: {
      "zh-TW": ["檳榔", "客人", "一百", "找零", "謝謝"],
      "en": ["betel", "customer", "hundred", "change", "thank"],
      "ja": ["ビンロウ", "お客", "百", "おつり", "ありがとう"],
      "ko": ["빈랑", "손님", "백", "거스름", "감사"]
    }
  },
  {
    id: "story_feel_sick",
    title: {
      "zh-TW": "覺得不舒服，找家人幫忙",
      "en": "Feeling unwell, asking family for help",
      "ja": "具合が悪くて家族に頼る",
      "ko": "몸이 안 좋아 가족에게 도움 청하기"
    },
    frames: [
      { emoji: "😖", hint: { "zh-TW": "胸口悶悶的", "en": "A tight feeling in the chest", "ja": "胸が苦しい", "ko": "가슴이 답답함" } },
      { emoji: "📞", hint: { "zh-TW": "拿起電話", "en": "Pick up the phone", "ja": "電話を取る", "ko": "전화를 듦" } },
      { emoji: "🏥", hint: { "zh-TW": "決定去醫院", "en": "Decide to go to the hospital", "ja": "病院へ行くと決める", "ko": "병원에 가기로 함" } },
      { emoji: "👪", hint: { "zh-TW": "家人陪同", "en": "Family comes along", "ja": "家族が付き添う", "ko": "가족이 함께 감" } }
    ],
    keywords: {
      "zh-TW": ["不舒服", "家人", "醫院", "陪", "幫忙"],
      "en": ["unwell", "family", "hospital", "with", "help"],
      "ja": ["具合", "家族", "病院", "付き添", "手伝"],
      "ko": ["아프", "가족", "병원", "함께", "도움"]
    }
  },
  {
    id: "story_temple_drink",
    title: {
      "zh-TW": "廟口買一杯結冰水",
      "en": "Buying an iced drink by the temple",
      "ja": "廟の前で冷たい飲み物を買う",
      "ko": "사원 앞에서 얼음물 사기"
    },
    frames: [
      { emoji: "⛩", hint: { "zh-TW": "經過廟口", "en": "Walk past the temple", "ja": "廟の前を通る", "ko": "사원 앞을 지남" } },
      { emoji: "🥤", hint: { "zh-TW": "看到飲料攤", "en": "See a drinks stall", "ja": "飲み物の屋台を見つける", "ko": "음료 가판대를 봄" } },
      { emoji: "💵", hint: { "zh-TW": "拿出 50 元", "en": "Take out 50", "ja": "50元を出す", "ko": "50원을 꺼냄" } },
      { emoji: "🧊", hint: { "zh-TW": "喝到結冰水", "en": "Drink the iced water", "ja": "氷水を飲む", "ko": "얼음물을 마심" } }
    ],
    keywords: {
      "zh-TW": ["廟", "結冰水", "飲料", "五十", "謝謝"],
      "en": ["temple", "iced", "drink", "fifty", "thank"],
      "ja": ["廟", "氷", "飲み物", "五十", "ありがとう"],
      "ko": ["사원", "얼음", "음료", "오십", "감사"]
    }
  }
];

/** 取目前語言的值；查無退回繁中（跟 i18n 的 pick 同一套規則）。 */
export function pickLang(field, lang) {
  if (!field || typeof field === "string") return field || "";
  if (field[lang]) return field[lang];
  const base = (lang || "").split("-")[0];
  const hit = Object.keys(field).find(k => k.split("-")[0] === base);
  return hit ? field[hit] : field["zh-TW"];
}
