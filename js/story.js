// 圖片說故事——對應 App 的 StoryTrainingScreen。
//
// 看四格圖卡編一段故事，AI 老師即時講評打分。這是比「跟讀單句」更高階的練習：
// 跟讀只驗發音，說故事要自己組織語意順序，對敘事能力的復健更關鍵。
//
// 計分沿用 App：期望關鍵字的命中比例。刻意不交給 LLM 打分數——同一段話讓模型
// 打兩次會給不同分，患者看到分數跳動會失去信心。分數用規則算（穩定可複現），
// 只有講評文字交給 AI；沒有金鑰時退回依分數的固定鼓勵語，離線也能練。
import { t } from "./i18n.js?v=1.5.50";
import { STORY_PROMPTS, pickLang } from "./storydata.js?v=1.5.50";
import { reviewStory } from "./llm.js?v=1.5.50";
import { speak, listen, sttSupported } from "./speech.js?v=1.5.50";
import { addRehabLog } from "./store.js?v=1.5.50";

const $ = s => document.querySelector(s);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

let toast = m => console.log(m);
export function setStoryToast(fn) { toast = fn; }

let idx = 0;   // 目前題目

function prompt_() { return STORY_PROMPTS[idx % STORY_PROMPTS.length]; }
const curLang = () => document.documentElement.getAttribute("data-lang") || "zh-TW";
const titleOf = p => pickLang(p.title, curLang());
const kwOf    = p => pickLang(p.keywords, curLang()) || [];

export function renderStory() {
  const p = prompt_();
  const title = $("#storyTitle");
  if (!title) return;
  title.textContent = t("story.ask").replace("{title}", titleOf(p));
  $("#storyFrames").innerHTML = p.frames.map((f, i) =>
    `<div class="story-frame"><span class="story-idx">${i + 1}</span>
       <span class="emoji">${f.emoji}</span><span class="tiny muted">${esc(pickLang(f.hint, curLang()))}</span></div>`).join("");
  $("#storyFeedback").classList.add("hidden");
}

/** 命中的期望關鍵字比例＝分數（0–100）。 */
function scoreOf(text, p) {
  // 關鍵字要用「使用者當下的語言」比對，否則英日韓使用者永遠命中 0 分
  const kw = kwOf(p);
  if (!kw.length) return 0;
  const hay = text.toLowerCase();
  const hits = kw.filter(k => hay.includes(String(k).toLowerCase())).length;
  return Math.max(0, Math.min(100, Math.round(hits * 100 / kw.length)));
}

async function review() {
  const text = ($("#storyInput").value || "").trim();
  if (!text) { toast(t("story.needText")); return; }
  const p = prompt_();
  const score = scoreOf(text, p);

  const btn = $("#storyReview");
  btn.disabled = true;
  btn.textContent = t("story.reviewing");
  let feedback = "";
  try {
    feedback = await reviewStory(titleOf(p), text, score);
  } catch { /* 沒金鑰或連不上：下面退回依分數的固定鼓勵語，離線也能練 */ }

  if (!feedback) {
    feedback = score >= 80 ? t("story.great")
      : score >= 50 ? t("story.ok").replace("{kw}", kwOf(p)[0] || "")
      : t("story.tryAgain");
  }
  btn.disabled = false;
  btn.textContent = t("story.review");

  $("#storyScore").textContent = t("story.score").replace("{n}", score);
  $("#storyFeedbackText").textContent = feedback;
  $("#storyFeedback").classList.remove("hidden");
  speak(feedback);

  // 落一筆紀錄，讓成績單看得到故事練習
  try { await addRehabLog({ target: titleOf(p), recognized: text, score, feedback }); } catch { }
}

export function setupStory() {
  if (!$("#storyFrames")) return;
  renderStory();
  $("#storyShuffle")?.addEventListener("click", () => { idx++; renderStory(); $("#storyInput").value = ""; });
  $("#storyReview")?.addEventListener("click", review);
  const mic = $("#storyMic");
  if (mic) {
    if (!sttSupported()) mic.classList.add("hidden");
    mic.addEventListener("click", async () => {
      try {
        mic.textContent = t("mic.recording");
        const said = await listen();
        $("#storyInput").value = (($("#storyInput").value || "") + said).trim();
      } catch { toast(t("stt.error")); }
      finally { mic.textContent = t("story.mic"); }
    });
  }
}
