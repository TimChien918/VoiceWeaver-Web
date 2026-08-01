// 危機介入視窗——與 App 的 CrisisConversationWindow 同一套流程。
//
// 觸發時機：使用者按下求助，或連續選錯後選擇通報。畫面設計刻意「不像軟體」：
// 一顆會呼吸的圓、柔和的字、少量大按鈕。人在崩潰邊緣時，介面越複雜越幫倒忙。
//
// 做四件事：
//   1. 立刻通知家人（Telegram）
//   2. 給一個免登入免輸名字的視訊房連結（Jitsi），家人點了就能面對面
//   3. 幾句「想對家人說」的快捷語，點一下就傳出去（打不出字也能表達）
//   4. 1925 安心專線與 119 直撥
//
// 呼吸引導不是裝飾：等待家人回應的那幾分鐘最難熬，給一個節奏可以跟著做。
import { t } from "./i18n.js?v=1.4.2";
import { state } from "./store.js?v=1.4.2";
import { telegramNotify } from "./extras.js?v=1.4.2";

const $ = s => document.querySelector(s);

// 免登入的社群實例：meet.jit.si 現在建立會議要登入，所以預設換一個。
// 網址後面那串 config 是為了「點開就進通話」——免輸名字、免預備頁。
const DEFAULT_VIDEO_BASE = "https://meet.jit.si";

function roomUrl() {
  const base = (state.settings.videoCallBaseUrl || DEFAULT_VIDEO_BASE).replace(/\/+$/, "");
  // 房名要不可猜（等於這場對話的密碼），但也不能每次重開就換掉。
  if (!state.settings.crisisRoom) {
    state.settings.crisisRoom = "vw-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return `${base}/${state.settings.crisisRoom}#` +
    "config.prejoinPageEnabled=false&" +
    "config.prejoinConfig.enabled=false&" +
    "config.requireDisplayName=false&" +
    'userInfo.displayName=%22VoiceWeaver%22';
}

const QUICK = ["crisis.q1", "crisis.q2", "crisis.q3", "crisis.q4", "crisis.q5"];

let _breathTimer = null;

export function openCrisis() {
  const dlg = $("#crisisDlg");
  if (!dlg) return;
  dlg.classList.remove("hidden");
  $("#crisisStatus").textContent = t("crisis.contacting");

  // 快捷語句：點一下就傳給家人
  const box = $("#crisisQuick");
  box.innerHTML = QUICK.map((k, i) => `<span class="chip" data-i="${i}">${t(k)}</span>`).join("");
  box.querySelectorAll(".chip").forEach(c => c.addEventListener("click", async () => {
    const msg = t(QUICK[+c.dataset.i]);
    try { await telegramNotify(msg); pushMsg(msg, true); }
    catch { $("#crisisStatus").textContent = t("crisis.sendFail"); }
  }));

  $("#crisisLog").innerHTML = "";
  pushMsg(t("crisis.sysNotified"), false);
  pushMsg(t("crisis.sysVideoHint"), false);

  startBreathing();

  // 通知家人（失敗不擋畫面——專線按鈕還是要能按）
  telegramNotify(t("crisis.alertMsg") + "\n" + roomUrl())
    .then(() => { $("#crisisStatus").textContent = t("crisis.notified"); })
    .catch(() => { $("#crisisStatus").textContent = t("crisis.sendFail"); });
}

function pushMsg(text, mine) {
  const log = $("#crisisLog");
  if (!log) return;
  const d = document.createElement("div");
  d.className = "crisis-msg" + (mine ? " mine" : "");
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

// 吸 4 秒、吐 4 秒的節奏，跟著圓的縮放做。
function startBreathing() {
  stopBreathing();
  const orb = $("#crisisOrb"), lbl = $("#crisisBreath");
  if (!orb) return;
  let inhale = true;
  const tick = () => {
    orb.style.transform = inhale ? "scale(1)" : "scale(0.72)";
    if (lbl) lbl.textContent = t(inhale ? "crisis.inhale" : "crisis.exhale");
    inhale = !inhale;
  };
  tick();
  _breathTimer = setInterval(tick, 4000);
}
function stopBreathing() {
  if (_breathTimer) { clearInterval(_breathTimer); _breathTimer = null; }
}

export function setupCrisis() {
  $("#crisisVideo")?.addEventListener("click", () => window.open(roomUrl(), "_blank", "noopener"));
  $("#crisisCall")?.addEventListener("click", () => {
    const num = (state.settings.familyPhone || "").trim();
    if (num) location.href = "tel:" + num;
    else $("#crisisStatus").textContent = t("crisis.noPhone");
  });
  $("#crisisHotline1925")?.addEventListener("click", () => { location.href = "tel:1925"; });
  $("#crisisHotline119")?.addEventListener("click", () => { location.href = "tel:119"; });
  $("#crisisClose")?.addEventListener("click", () => {
    stopBreathing();
    $("#crisisDlg").classList.add("hidden");
  });
}
