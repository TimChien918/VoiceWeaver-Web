// 聲紋使用的知情同意（設計書第 6 點「聲紋需經同意」）。
//
// 為什麼要另外一道同意、不能「開了電腦運算就算同意」：
// GPT-SoVITS 複製的是一個真實的人的聲音——可能是患者病發前的聲音，也可能是家人的。
// 用那個聲音講出去的話，聽的人會以為是本人說的。這件事要由聲音的主人（或代為決定的人）
// 明確點頭，而且要知道三件事：拿來做什麼、存在哪裡、怎麼收回。
//
// 紀錄存在 state.settings.voiceConsent，跟其他設定一起走 save() 同步到帳號：
//   { granted:true,  at:同意時間 }                 → 已同意
//   { granted:false, at:當初同意時間, revokedAt }   → 已撤回（保留時間點，日後查得到曾經同意過）
//   沒有這個欄位                                     → 從沒同意過
// 撤回不刪除這筆紀錄而是改成 granted:false：Firestore 用 merge 寫入，刪欄位要另外處理，
// 而且「什麼時候撤回的」本身就是該留下的紀錄。
import { state, save } from "./store.js?v=1.6.1";
import { t } from "./i18n.js?v=1.6.1";

const $ = (s) => document.querySelector(s);

export function hasVoiceConsent() {
  return !!state.settings?.voiceConsent?.granted;
}

let _listeners = [];
/** 同意狀態改變時通知（設定頁要重畫狀態列、把開關收回去）。 */
export function onVoiceConsentChange(fn) { _listeners.push(fn); }
function notify() { _listeners.forEach((fn) => { try { fn(hasVoiceConsent()); } catch {} }); }

export function revokeVoiceConsent() {
  const prev = state.settings.voiceConsent || {};
  state.settings.voiceConsent = { granted: false, at: prev.at || null, revokedAt: Date.now() };
  save();
  renderVoiceConsent();
  notify();
}

function grant() {
  state.settings.voiceConsent = { granted: true, at: Date.now() };
  save();
  renderVoiceConsent();
  notify();
}

let _pending = null;   // 對話框開著時的 resolve；同時只會有一個

/**
 * 需要時跳出同意對話框。已同意就直接回 true，不重複打擾。
 * @returns {Promise<boolean>} 使用者是否同意
 */
export function requestVoiceConsent() {
  if (hasVoiceConsent()) return Promise.resolve(true);
  const dlg = $("#voiceConsentDlg");
  if (!dlg) return Promise.resolve(false);
  if (_pending) return _pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  _pending = { promise, resolve };
  const chk = $("#vcAgreeChk"), ok = $("#vcAgree");
  if (chk) chk.checked = false;
  if (ok) ok.disabled = true;     // 沒勾「我是本人／已取得本人同意」不能按同意
  dlg.classList.remove("hidden");
  return promise;
}

function closeDlg(result) {
  $("#voiceConsentDlg")?.classList.add("hidden");
  const p = _pending; _pending = null;
  if (result) grant();
  p?.resolve(result);
}

/** 設定頁的狀態列：已同意（何時）／已撤回／尚未同意，以及對應的按鈕。 */
export function renderVoiceConsent() {
  const lang = document.documentElement.lang || "zh-TW";
  const vc = state.settings?.voiceConsent;
  const line = hasVoiceConsent()
    ? t("vc.statusOn").replace("{date}", new Date(vc.at).toLocaleString(lang))
    : vc?.revokedAt
      ? t("vc.statusRevoked").replace("{date}", new Date(vc.revokedAt).toLocaleString(lang))
      : t("vc.statusOff");
  document.querySelectorAll(".vc-status").forEach((el) => {
    el.textContent = line;
    el.classList.toggle("vc-on", hasVoiceConsent());
  });
  document.querySelectorAll(".vc-grant").forEach((b) => b.classList.toggle("hidden", hasVoiceConsent()));
  document.querySelectorAll(".vc-revoke").forEach((b) => b.classList.toggle("hidden", !hasVoiceConsent()));
}

let _bound = false;
/** 綁一次事件。showApp 可能因登入狀態變化跑不只一次，重複綁會讓一次點擊觸發兩次。
 *  @returns {boolean} 這次是不是第一次綁（呼叫端據此決定要不要掛自己的監聽） */
export function setupVoiceConsent() {
  if (_bound) { renderVoiceConsent(); return false; }
  _bound = true;
  $("#vcAgreeChk")?.addEventListener("change", (e) => { const ok = $("#vcAgree"); if (ok) ok.disabled = !e.target.checked; });
  $("#vcAgree")?.addEventListener("click", () => closeDlg(true));
  $("#vcDecline")?.addEventListener("click", () => closeDlg(false));
  document.querySelectorAll(".vc-grant").forEach((b) => b.addEventListener("click", () => requestVoiceConsent()));
  document.querySelectorAll(".vc-revoke").forEach((b) => b.addEventListener("click", () => {
    if (confirm(t("vc.revokeConfirm"))) revokeVoiceConsent();
  }));
  renderVoiceConsent();
  return true;
}
