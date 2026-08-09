// 危機介入視窗——與 App 的 CrisisConversationWindow / VoiceWeaverCore 同一套流程。
//
// 觸發時機：使用者按下求助，或偵測到自傷語句被鎖定時。畫面設計刻意「不像軟體」：
// 一顆會呼吸的圓、柔和的字、少量大按鈕。人在崩潰邊緣時，介面越複雜越幫倒忙。
//
// 做的事（與 App 一致）：
//   1. 立刻通知家人（Telegram），不等定位——那 6 秒是家人還不知道出事的 6 秒
//   2. 靜默擷取前後鏡頭傳給家人，讓家人一眼看到現場
//   3. 給一個免登入免輸名字的視訊房連結（Jitsi），家人點了就能面對面
//   4. 輪詢家人回覆並顯示；家人可下指令 /call（強制視訊）/camera（再拍）/end（結束）
//   5. 幾句「想對家人說」的快捷語 + 一段語音訊息，打不出字也能表達
//   6. 1925 安心專線與 119 直撥
//
// 結束由家人控制：使用者自己關不掉，家人在 Telegram 打 /end 才會關。
// 這是刻意的——會走到這個畫面的人，正是最不該讓他一個人把求救關掉的時候。
//
// 呼吸引導不是裝飾：等待家人回應的那幾分鐘最難熬，給一個節奏可以跟著做。
import { t } from "./i18n.js?v=1.5.36";
import { state, save } from "./store.js?v=1.5.36";
import {
  telegramSend, locationLine,
  telegramSendPhoto, telegramSendVoice, telegramPollReplies
} from "./extras.js?v=1.5.36";

const $ = s => document.querySelector(s);

// 免登入的社群實例：meet.jit.si 現在建立會議要登入，所以預設換一個。
// 網址後面那串 config 是為了「點開就進通話」——免輸名字、免預備頁。
const DEFAULT_VIDEO_BASE = "https://meet.jit.si";

function roomUrl() {
  const base = (state.settings.videoCallBaseUrl || DEFAULT_VIDEO_BASE).replace(/\/+$/, "");
  // 房名要不可猜（等於這場對話的密碼），但也不能每次重開就換掉。
  //
  // 產生之後**一定要存檔**：原本只寫進 state 沒有 save()，重新整理就重新產生一組，
  // 家人手上那個連結會連進一個沒有人的空房間——而他們正在等著看到人。
  if (!state.settings.crisisRoom) {
    state.settings.crisisRoom = "vw-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    save();
  }
  return `${base}/${state.settings.crisisRoom}#` +
    "config.prejoinPageEnabled=false&" +
    "config.prejoinConfig.enabled=false&" +
    "config.requireDisplayName=false&" +
    'userInfo.displayName=%22VoiceWeaver%22';
}

const QUICK = ["crisis.q1", "crisis.q2", "crisis.q3", "crisis.q4", "crisis.q5"];

let _breathTimer = null;
let _pollTimer = null;
let _pollOffset = 0;
let _active = false;
let _recording = false;

export function openCrisis() {
  const dlg = $("#crisisDlg");
  if (!dlg || _active) return;
  _active = true;
  dlg.classList.remove("hidden");
  $("#crisisStatus").textContent = t("crisis.contacting");
  setChips({ video: false, photo: false });

  // 快捷語句：點一下就傳給家人
  const box = $("#crisisQuick");
  box.innerHTML = QUICK.map((k, i) => `<span class="chip" data-i="${i}">${t(k)}</span>`).join("");
  box.querySelectorAll(".chip").forEach(c => c.addEventListener("click", async () => {
    const msg = t(QUICK[+c.dataset.i]);
    // 用 telegramSend 不用 telegramNotify：位置開窗時已送過，這裡再等 6 秒定位
    // 只會讓對話跟不上人——崩潰的人打一句話要等六秒才出去是不行的。
    try { await telegramSend(t("sos.prefix") + msg); pushMsg(msg, "me"); }
    catch { $("#crisisStatus").textContent = t("crisis.sendFail"); }
  }));

  $("#crisisLog").innerHTML = "";
  pushMsg(t("crisis.sysNotified"), "sys");
  pushMsg(t("crisis.sysVideoHint"), "sys");

  startBreathing();

  // 通知家人（失敗不擋畫面——專線按鈕還是要能按）。
  // 先送出、位置隨後補第二則：等定位會讓通報整整晚 6 秒才出去。
  const url = roomUrl();
  telegramSend(t("sos.prefix") + t("crisis.alertMsg") + "\n" + url)
    .then(async () => {
      $("#crisisStatus").textContent = t("crisis.notified");
      setChips({ video: true });
      // 家人要知道自己可以做什麼，否則收到連結也只會乾等
      telegramSend(t("crisis.familyHelp")).catch(() => {});
      const loc = await locationLine();
      // 拿不到位置就不補——只寫「位置未知」的第二則對家人是雜訊，人已經通知到了
      if (loc) telegramSend(t("sos.prefix") + loc).catch(() => {});
    })
    .catch(() => { $("#crisisStatus").textContent = t("crisis.sendFail"); });

  captureAndSend(false);
  startPolling();
}

// ── 現場快照 ─────────────────────────────────────────────────────────────
// 前鏡頭＝使用者本人，後鏡頭＝周遭環境。家人一眼就能判斷「現在是什麼狀況」，
// 比任何文字都快。拿不到鏡頭就安靜跳過——這是加分項，不能擋住通報。

async function snapshot(facingMode) {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true; video.playsInline = true;
    await video.play();
    // 等一到兩幀，不然抓到的是全黑畫面
    await new Promise(r => setTimeout(r, 350));
    const c = document.createElement("canvas");
    c.width = video.videoWidth || 640;
    c.height = video.videoHeight || 480;
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, "image/jpeg", 0.78));
  } catch { return null; }
  finally { stream?.getTracks().forEach(tr => tr.stop()); }
}

/** 擷取前後鏡頭並傳給家人。@param again 家人用 /camera 要求的再拍。 */
async function captureAndSend(again) {
  let sent = 0;
  const shots = [
    ["environment", again ? t("crisis.capBackAgain") : t("crisis.capBack")],
    ["user", again ? t("crisis.capFrontAgain") : t("crisis.capFront")],
  ];
  for (const [facing, caption] of shots) {
    const blob = await snapshot(facing);
    if (!blob) continue;
    try { await telegramSendPhoto(blob, caption); sent++; } catch {}
  }
  if (sent > 0) {
    setChips({ photo: true });
    pushMsg(again ? t("crisis.sysPhotoAgain") : t("crisis.sysPhotoSent"), "sys");
  } else if (again) {
    pushMsg(t("crisis.sysPhotoFail"), "sys");
  }
  return sent;
}

// ── 家人回覆輪詢 ─────────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  // 先快轉略過積壓：offset=-1 只取最後一則，拿到基準後丟棄內容。
  // 不這樣做的話，上一次危機家人打的 /end 會被重播，新視窗一開就被關掉。
  telegramPollReplies(-1)
    .then(r => { _pollOffset = r.offset; })
    .catch(() => {})
    .finally(() => {
      // 這裡是非同步回來的：使用者在等 offset 的這段時間可能已經關掉危機視窗，
      // 那時 stopPolling() 早就跑過了（而且什麼都沒清到，因為 timer 還沒建）。
      // 不擋的話會留下一個**沒有人清得掉**的 interval，每 3 秒打一次 Telegram
      // 打到這個分頁關掉為止；下一次危機再開，兩個 timer 會互搶同一個 offset，
      // 家人的回覆就會有一半掉在看不到的那一個。
      if (!_active) return;
      stopPolling();
      _pollTimer = setInterval(async () => {
        if (!_active) return;
        try {
          const { offset, replies } = await telegramPollReplies(_pollOffset);
          _pollOffset = offset;
          for (const r of replies) await handleFamilyReply(r);
          if (replies.length) $("#crisisStatus").textContent = t("crisis.familyHere");
        } catch {}
      }, 3000);
    });
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/** 家人的一則回覆：指令 /call /camera /end，其餘當成聊天訊息顯示給使用者看。 */
async function handleFamilyReply(raw) {
  const cmd = raw.trim().toLowerCase();
  if (cmd === "/call") {
    pushMsg(t("crisis.sysFamilyCall"), "sys");
    // 強制加入：直接開視訊房。瀏覽器可能擋彈窗，擋掉就把按鈕變成閃爍提示。
    const w = window.open(roomUrl(), "_blank", "noopener");
    if (!w) $("#crisisVideo")?.classList.add("urgent");
    telegramSend(t("crisis.familyCallAck")).catch(() => {});
  } else if (cmd.startsWith("/cam")) {          // /camera /camra 都接受
    pushMsg(t("crisis.sysFamilyCamera"), "sys");
    await captureAndSend(true);
  } else if (cmd === "/end") {
    pushMsg(t("crisis.sysFamilyEnd"), "sys");
    telegramSend(t("crisis.familyEndAck")).catch(() => {});
    setTimeout(closeCrisis, 1200);
  } else if (cmd.startsWith("/")) {
    pushMsg(t("crisis.sysUnknownCmd").replace("%s", raw), "sys");
  } else {
    pushMsg(raw, "family");
  }
}

// ── 語音訊息 ─────────────────────────────────────────────────────────────

/** 錄約 6 秒傳給家人。打不出字、也講不成句子的人，至少能讓家人聽見聲音。 */
async function recordVoice() {
  if (_recording) return;
  const btn = $("#crisisVoice");
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    pushMsg(t("crisis.sysNoMic"), "sys");
    return;
  }
  _recording = true;
  if (btn) { btn.disabled = true; btn.textContent = t("crisis.recording"); }
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start();
  await new Promise(r => setTimeout(r, 6000));
  rec.stop();
  await done;
  stream.getTracks().forEach(tr => tr.stop());
  _recording = false;
  if (btn) { btn.disabled = false; btn.textContent = t("crisis.voice"); }

  const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
  if (blob.size < 2000) { pushMsg(t("crisis.sysVoiceTooShort"), "sys"); return; }
  try {
    await telegramSendVoice(blob, t("crisis.voiceCaption"));
    pushMsg(t("crisis.sysVoiceSent"), "me");
  } catch {
    pushMsg(t("crisis.sysVoiceFail"), "sys");
  }
}

// ── 畫面小工具 ───────────────────────────────────────────────────────────

function pushMsg(text, kind) {
  const log = $("#crisisLog");
  if (!log) return;
  const d = document.createElement("div");
  d.className = "crisis-msg" + (kind === "me" ? " mine" : kind === "family" ? " family" : "");
  d.textContent = kind === "family" ? `👪 ${text}` : text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

/** 狀態小標：視訊連結已傳 / 畫面已傳。與 App 的 StatusChip 對應。 */
function setChips({ video, photo }) {
  const v = $("#crisisChipVideo"), p = $("#crisisChipPhoto");
  if (v && video !== undefined) v.classList.toggle("hidden", !video);
  if (p && photo !== undefined) p.classList.toggle("hidden", !photo);
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
  stopBreathing();          // 重複開啟時先清掉舊的，否則兩個 timer 會讓球忽大忽小
  _breathTimer = setInterval(tick, 4000);
}
function stopBreathing() {
  if (_breathTimer) { clearInterval(_breathTimer); _breathTimer = null; }
}

/** 只由家人的 /end 呼叫。使用者自己沒有關閉的入口。 */
function closeCrisis() {
  _active = false;
  stopBreathing();
  stopPolling();
  $("#crisisVideo")?.classList.remove("urgent");
  $("#crisisDlg")?.classList.add("hidden");
}

export function setupCrisis() {
  $("#crisisVideo")?.addEventListener("click", () => window.open(roomUrl(), "_blank", "noopener"));
  $("#crisisVoice")?.addEventListener("click", recordVoice);
  $("#crisisCall")?.addEventListener("click", () => {
    const num = (state.settings.familyPhone || "").trim();
    if (num) location.href = "tel:" + num;
    else $("#crisisStatus").textContent = t("crisis.noPhone");
  });
  $("#crisisHotline1925")?.addEventListener("click", () => { location.href = "tel:1925"; });
  $("#crisisHotline119")?.addEventListener("click", () => { location.href = "tel:119"; });
}
