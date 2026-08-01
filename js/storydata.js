// 圖片說故事的題庫——由 App 的 StoryTraining.kt 轉出，四格與關鍵字逐字一致。
// 每題固定四格；keywords 是評分用的期望關鍵字，命中比例即分數。
export const STORY_PROMPTS = [
  {
    "id": "story_betel_sell",
    "title": "賣一包檳榔給客人",
    "frames": [
      {
        "emoji": "🏪",
        "hint": "客人走到攤位"
      },
      {
        "emoji": "🌿",
        "hint": "拿出包葉檳榔"
      },
      {
        "emoji": "💵",
        "hint": "客人付 100 元"
      },
      {
        "emoji": "🤲",
        "hint": "找零 50 元給客人"
      }
    ],
    "keywords": [
      "檳榔",
      "客人",
      "一百",
      "找零",
      "謝謝"
    ]
  },
  {
    "id": "story_feel_sick",
    "title": "覺得不舒服，找家人幫忙",
    "frames": [
      {
        "emoji": "😣",
        "hint": "胸口悶悶的"
      },
      {
        "emoji": "📞",
        "hint": "拿起電話"
      },
      {
        "emoji": "🏥",
        "hint": "決定去醫院"
      },
      {
        "emoji": "👨‍👩‍👧",
        "hint": "家人陪同"
      }
    ],
    "keywords": [
      "不舒服",
      "家人",
      "醫院",
      "陪",
      "幫忙"
    ]
  },
  {
    "id": "story_temple_drink",
    "title": "廟口買一杯結冰水",
    "frames": [
      {
        "emoji": "⛩️",
        "hint": "經過廟口"
      },
      {
        "emoji": "🥤",
        "hint": "看到飲料攤"
      },
      {
        "emoji": "💵",
        "hint": "拿出 50 元"
      },
      {
        "emoji": "😊",
        "hint": "喝到結冰水"
      }
    ],
    "keywords": [
      "廟",
      "結冰水",
      "飲料",
      "五十",
      "謝謝"
    ]
  }
];
