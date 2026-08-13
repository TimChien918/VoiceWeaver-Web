#!/usr/bin/env node
/**
 * 把「限時活動的共用金鑰」寫進 Firestore 的 shared/apiKeys。
 *
 * 這是一次性的管理工作，所以做成在**你自己電腦上**跑的腳本，而不是網頁的功能——
 * 網頁端要能做這件事，就得把服務帳戶私鑰交給瀏覽器，那等於公開它。
 *
 * 用法：
 *   node tools/publish-shared-keys.mjs <服務帳戶.json> --key <金鑰> [--key <金鑰> ...]
 *
 *   # 或者直接沿用你自己帳號裡已經填好的那幾把（需要你的 uid）
 *   node tools/publish-shared-keys.mjs <服務帳戶.json> --from-user <你的uid>
 *
 *   # 看看會寫進去什麼，但不真的寫
 *   node tools/publish-shared-keys.mjs <服務帳戶.json> --key AIza... --dry-run
 *
 *   # 活動結束後把它清掉（比等規則過期更乾脆）
 *   node tools/publish-shared-keys.mjs <服務帳戶.json> --delete
 *
 * ⚠️ 兩件事這個腳本幫不了你：
 *   1. **安全規則要自己在主控台發布**。規則不能用 Firestore 資料 API 寫，
 *      而沒有規則的話這份文件對所有人都是預設拒絕，等於白建。規則內容見 README。
 *   2. **請用活動專用的新金鑰**，不要用你平常在用的那幾把。活動期間任何登入者
 *      都能從瀏覽器把它讀出來——那是這個機制的本質，不是實作不夠好。
 *
 * 跑完之後，服務帳戶私鑰請妥善保管（別進 git、別上傳到任何地方）。
 */

import crypto from "node:crypto";
import fs from "node:fs";

const args = process.argv.slice(2);
const saPath = args.find(a => !a.startsWith("--"));
const flag = (name) => args.includes("--" + name);
const values = (name) => args.reduce((acc, a, i) =>
  (a === "--" + name && args[i + 1] && !args[i + 1].startsWith("--")) ? [...acc, args[i + 1]] : acc, []);

if (!saPath) {
  console.error("用法：node tools/publish-shared-keys.mjs <服務帳戶.json> --key <金鑰> [--dry-run]");
  process.exit(1);
}

const SA = JSON.parse(fs.readFileSync(saPath, "utf8"));
const BASE = `https://firestore.googleapis.com/v1/projects/${SA.project_id}/databases/(default)/documents`;
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

/** 用服務帳戶換一把只能碰 Firestore 的存取權杖。 */
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: SA.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: SA.token_uri, iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(SA.private_key).toString("base64url");
  const res = await fetch(SA.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("換權杖失敗：" + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

// Firestore REST 的值都要標型別，所以要在 JS 物件與它的格式之間轉一次。
const toValue = (v) =>
  Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } }
  : v && typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } }
  : { stringValue: String(v ?? "") };

const fromValue = (v) =>
  v.arrayValue ? (v.arrayValue.values || []).map(fromValue)
  : v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]))
  : v.stringValue ?? "";

const mask = (k) => (k ? k.slice(0, 6) + "…" + k.slice(-4) : "(空)");

const token = await accessToken();
const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

if (flag("delete")) {
  const res = await fetch(`${BASE}/shared/apiKeys`, { method: "DELETE", headers: auth });
  console.log(res.ok ? "✅ 已刪除 shared/apiKeys" : "❌ 刪除失敗：" + (await res.text()).slice(0, 200));
  process.exit(res.ok ? 0 : 1);
}

// 金鑰來源：直接指定，或從你自己的使用者文件搬過來
let keys = values("key");
if (!keys.length && values("from-user").length) {
  const uid = values("from-user")[0];
  const res = await fetch(`${BASE}/users/${encodeURIComponent(uid)}`, { headers: auth });
  if (!res.ok) { console.error("❌ 讀不到 users/" + uid + "：" + (await res.text()).slice(0, 200)); process.exit(1); }
  const fields = (await res.json()).fields || {};
  const llm = fromValue(fields.llmApis || { arrayValue: {} });
  keys = llm.map(e => e.key).filter(Boolean);
  console.log(`從 users/${uid} 取到 ${keys.length} 把文字金鑰`);
}
if (!keys.length) { console.error("❌ 沒有金鑰可寫。用 --key <金鑰> 或 --from-user <uid>"); process.exit(1); }

const doc = {
  llmApis:   keys.map(key => ({ provider: "gemini", key, model: "" })),
  imageApis: keys.map(key => ({ provider: "gemini", key })),
  ttsApis:   keys.map(key => ({ provider: "gemini", key, model: "" })),
};

console.log("要寫入 shared/apiKeys：");
for (const [k, v] of Object.entries(doc)) console.log(`  ${k}: ${v.length} 筆 → ${v.map(x => mask(x.key)).join(", ")}`);

if (flag("dry-run")) { console.log("\n（--dry-run，沒有真的寫入）"); process.exit(0); }

const res = await fetch(`${BASE}/shared/apiKeys`, {
  method: "PATCH", headers: auth,
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, toValue(v)])) }),
});
if (!res.ok) { console.error("❌ 寫入失敗：" + (await res.text()).slice(0, 400)); process.exit(1); }

console.log("\n✅ 寫好了。");
console.log("⚠️  還沒完：安全規則要自己到 Firebase 主控台的「規則」分頁發布，");
console.log("    否則這份文件對所有人都是預設拒絕讀取。規則內容見 README「限時活動」那一節。");
