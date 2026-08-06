// 「直接說給 AI 聽」——把錄音原封不動餵給模型，跳過語音轉文字。
//
// 為什麼需要這條路（和 App 同一個理由）：失語症患者的發音常常不標準，
// STT 會先把它聽錯成別的字，後面的重組就是在錯的文字上再猜一次，錯誤被放大兩次。
// 讓模型直接聽原始聲音，語調、停頓、含糊的音節都還在，判斷反而更準。
//
// 只有支援原生音訊的供應商（目前是 Gemini）走得通；沒有這種金鑰時
// 呼叫端會退回原本的「瀏覽器 STT → 文字重組」。
import { t } from "./i18n.js?v=1.5.1";
import { runAudioLlm, hasNativeAudio } from "./providers.js?v=1.5.1";

export { hasNativeAudio };

let _rec = null, _chunks = [], _stream = null;

export function isRecording() { return !!_rec && _rec.state === "recording"; }

/** 挑一個瀏覽器與 Gemini 都吃得下的容器格式。 */
function pickMime() {
  const prefer = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of prefer) {
    if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return "";
}

export async function startAudioCapture() {
  if (isRecording()) return;
  _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  _rec = new MediaRecorder(_stream, mime ? { mimeType: mime } : undefined);
  _chunks = [];
  _rec.ondataavailable = e => { if (e.data && e.data.size) _chunks.push(e.data); };
  _rec.start();
}

/** 停止錄音並把整段音訊送去理解，回傳模型聽懂的句子。 */
export async function stopAndInterpret(context) {
  if (!_rec) throw new Error("not recording");
  const rec = _rec;
  const blob = await new Promise((res, rej) => {
    rec.onstop = () => res(new Blob(_chunks, { type: rec.mimeType || "audio/webm" }));
    rec.onerror = rej;
    rec.stop();
  });
  _stream?.getTracks().forEach(tr => tr.stop());
  _rec = null; _stream = null; _chunks = [];

  // 太短多半是誤觸，送出去只會拿到亂猜的句子
  if (blob.size < 2000) throw new Error(t("audio.tooShort"));

  const b64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] || "");
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

  const sys =
    "你是失語症患者的溝通助理。使用者的發音可能不清楚、斷斷續續或用詞不完整。" +
    "請直接聽這段錄音，判斷他最可能想表達的意思，輸出一句自然、口語、有禮貌的" +
    t("audio.outputLang") + "。\n" +
    "規則：貼著他真的說出來的內容走，只補讓句子成立所需的語法零件，" +
    "不要新增他沒提到的事件、時間或對象。聽不清楚時給最貼近日常的說法，不要拒答。" +
    "只輸出那一句話，不要解釋。" +
    (context ? `\n情境參考：${context}` : "");

  const out = await runAudioLlm(sys, b64, blob.type.split(";")[0]);
  if (!out) throw new Error(t("audio.noResult"));
  return out;
}

/** 使用者中途取消：關麥克風、丟掉錄到的東西。 */
export function cancelAudioCapture() {
  try { _rec?.stop(); } catch { /* 已經停了 */ }
  _stream?.getTracks().forEach(tr => tr.stop());
  _rec = null; _stream = null; _chunks = [];
}
