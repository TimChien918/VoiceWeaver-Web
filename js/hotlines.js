// 危機介入視窗要撥的兩支電話：自殺防治專線與緊急號碼。
//
// **為什麼有這個檔案：** 原本這兩支號碼寫死成 `tel:1925` 與 `tel:119`，英文標籤
// 直譯成 "1925 helpline" / "119 emergency"。人在美國、用英文介面、正處於危機當下
// 的使用者按下去，撥的是兩支在美國不存在的號碼——而旁邊的鎖定訊息還寫著
// 「call your local crisis line」。**求救按鈕撥不通比沒有按鈕更危險**，因為它讓人
// 以為求救已經送出去了。
//
// 兩個刻意的設計決定（與 App 端 CrisisHotlines.kt 一致）：
//
// ① **號碼一定顯示在按鈕上**（"988 Crisis line"、「1925 安心專線」）。國別萬一
//    判錯，照顧者一眼就能看出號碼不對；只寫用途的話，錯了也沒人發現。
// ② **判不出國別時不留空白**，退回介面語言對應的國家。危機當下沒有按鈕等於
//    沒有出口；因為①，猜錯至少是看得見的。

import { t } from "./i18n.js?v=1.5.77";

// 各國號碼表。**改之前請先查證**——這些號碼是要在最壞的時刻被撥出去的，
// 寫錯沒有任何測試抓得到。新增國家時附上查證來源與日期。
//   TW：1925 安心專線（衛福部）、119 消防
//   US：988 Suicide & Crisis Lifeline、911
//   JP：0570-064-556 こころの健康相談統一ダイヤル、119
//   KR：109 자살예방 상담전화、119
const BY_COUNTRY = {
  TW: { crisis: "1925", emergency: "119" },
  US: { crisis: "988", emergency: "911" },
  JP: { crisis: "0570-064-556", emergency: "119" },
  KR: { crisis: "109", emergency: "119" },
};

// 介面語言 → 國家。判不出所在國家時的退路。
// 用短碼當鍵：data-lang 可能是 "zh-TW" 也可能是 "zh"，取第一段就統一了。
const LANG_TO_COUNTRY = { zh: "TW", en: "US", ja: "JP", ko: "KR" };

function uiLangCountry() {
  const raw = document.documentElement.getAttribute("data-lang") || "en";
  return LANG_TO_COUNTRY[raw.split("-")[0]] || "US";
}

// 由 detectCountry() 寫入；其他人只讀。
let _observed = null;

/** 目前已知的國別（測試與除錯用）。 */
export function observedCountry() { return _observed; }

/** 記住一個國別。空值不覆蓋既有的。 */
export function rememberCountry(cc) {
  const v = String(cc || "").trim().toUpperCase();
  if (v) _observed = v;
}

/**
 * 依國別取號碼。查無時退回介面語言。
 * 不做任何定位動作——危機視窗要能立刻畫出來。
 */
export function hotlinesFor(countryCode) {
  const cc = String(countryCode || "").trim().toUpperCase();
  const country = BY_COUNTRY[cc] ? cc : uiLangCountry();
  const n = BY_COUNTRY[country];
  return {
    country,
    crisis: { number: n.crisis, label: `${n.crisis} ${t("crisis.purposeCrisis")}` },
    emergency: { number: n.emergency, label: `${n.emergency} ${t("crisis.purposeEmergency")}` },
  };
}

/** 用目前已知的國別取號碼。同步，可在畫面第一幀就呼叫。 */
export function currentHotlines() { return hotlinesFor(_observed); }

// 經緯度 → 國別。瀏覽器沒有離線的反查，所以只用邊界框。
// 順序有意義：韓國整個落在日本那個框裡面，KR 一定要排在 JP 前面，
// 否則首爾會被判成日本、撥到日本的專線。
export function countryFromCoords(lat, lon) {
  const inUs =
    (lat >= 24.0 && lat <= 49.5 && lon >= -125.0 && lon <= -66.0) ||
    (lat >= 18.5 && lat <= 22.5 && lon >= -161.0 && lon <= -154.0) ||
    (lat >= 51.0 && lat <= 72.0 && lon >= -170.0 && lon <= -129.0);
  if (inUs) return "US";
  if (lat >= 21.5 && lat <= 25.5 && lon >= 119.5 && lon <= 122.2) return "TW";
  if (lat >= 33.0 && lat <= 38.7 && lon >= 125.5 && lon <= 129.8) return "KR";
  if (lat >= 24.0 && lat <= 46.0 && lon >= 122.5 && lon <= 146.5) return "JP";
  return null;
}

/**
 * 用瀏覽器定位判斷所在國家。
 *
 * 逾時刻意設得短（6 秒）：這是在危機視窗開著的時候跑的，等不到就用退路，
 * 不能讓使用者對著一個沒有按鈕的畫面等定位。不要求高精度——國別只需要
 * 公里級的答案。
 *
 * @returns {Promise<string|null>} ISO 3166-1 alpha-2，判不出來時 null
 */
export async function detectCountry() {
  if (!navigator.geolocation) return null;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, enableHighAccuracy: false })
    );
    const cc = countryFromCoords(pos.coords.latitude, pos.coords.longitude);
    if (cc) rememberCountry(cc);
    return cc;
  } catch {
    return null;   // 沒授權／逾時／不支援：呼叫端會退回介面語言
  }
}
