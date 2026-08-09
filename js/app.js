import { state, newId, initAuth, loginGoogle, loginAnon, logout, save, addHistory, listHistory, toggleFavorite, ensurePairCode, pushNgrokBridge, saveShortcut, listVoices, reauthorizeDrive, needsDriveReauth, isBenignAuthError, accountEmail, switchAccount, needsScopeUpgrade } from "./store.js?v=1.5.49";
import { LLM_PROVIDERS, IMAGE_PROVIDERS } from "./providers.js?v=1.5.49";
import { reconstruct, composeAac, hasAnyLlmKey, classifyCrisisIntent } from "./llm.js?v=1.5.49";
import { speak, speakNow, speakIn, listen, sttSupported, setSpeechToast } from "./speech.js?v=1.5.49";
import { AAC_CATS, CAT_EMOJI, cardsOfCat, allCards, searchCards, CURRENCIES } from "./aac.js?v=1.5.49";
import { feed as rankFeed, rankWithin, recordUse, activeItemCount } from "./aacrank.js?v=1.5.49";
import { setupKiosk, enterKiosk } from "./kiosk.js?v=1.5.49";
import { bindTap } from "./interaction.js?v=1.5.49";
import { orderCards } from "./predict.js?v=1.5.49";
import { CLINICAL_BANK, practiceItem } from "./clinical.js?v=1.5.49";
import { markFirstSpeak, recordCandidateChoice, recordUndo, recordInputSource } from "./behavior.js?v=1.5.49";
import { openCrisis, setupCrisis } from "./crisis.js?v=1.5.49";
import { classifyRisk, containsCrisisSignal } from "./safety.js?v=1.5.49";
import { preloadZhConv, toTraditionalSync } from "./zhconv.js?v=1.5.49";
import { setupStory, renderStory, setStoryToast } from "./story.js?v=1.5.49";
import { setupHeadControl, stopHeadControl } from "./headcontrol.js?v=1.5.49";
import { startAudioCapture, stopAndInterpret, cancelAudioCapture, isRecording, hasNativeAudio } from "./audiodirect.js?v=1.5.49";
import { generateImage, intentPrompt, detectLocation, recognizePhoto, telegramNotify } from "./extras.js?v=1.5.49";
import { setupRehab, renderRehabLogs, setRehabToast } from "./rehab.js?v=1.5.49";
import { setupReport, loadReport, setReportToast } from "./report.js?v=1.5.49";
import { detectLocalTts, localVoices, localSwitch, localCatalog, localPrepare, localComputeEnabled } from "./localtts.js?v=1.5.49";
import { applyI18n, t } from "./i18n.js?v=1.5.49";
import { setupDemo } from "./demo.js?v=1.5.49";

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
let ctxText = "";          // 地點 / 相機辨識附加情境
let lastResult = "";
// 這批結果的來源碎詞已被 AI 判定為「替別人求救／中性提及」。
// 用來讓後續發聲跳過關鍵字消毒——求救句被消毒掉就求不了救。
let crisisCleared = false;

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.add("hidden"),2200); }

// ── 主題 / 字體 ──
function applyTheme(){
  const el = document.documentElement;
  const t = state.settings.theme;
  if(t==="auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
  // 視覺風格（科技／可愛／動漫／簡約，同 App）。
  // 科技風＝不覆寫顏色，深淺完全由上面的 theme 決定（跟隨系統／淺色／深色都有效）。
  // 其餘三種本身就綁定了深淺（可愛與簡約是淺色、動漫是深色），套用時才移除
  // data-theme，避免深淺設定跟風格互相打架。
  const style = state.settings.style || "tech";
  if(style === "tech"){
    el.removeAttribute("data-style");
  }else{
    el.setAttribute("data-style", style);
    el.removeAttribute("data-theme");
  }
  // 高對比是無障礙保底，壓過任何風格
  if(state.settings.highContrast) el.setAttribute("data-contrast","high");
  else el.removeAttribute("data-contrast");
  el.style.setProperty("--font", (state.settings.font||1)+"rem");
  const blurb = $("#styleBlurb");
  if(blurb) blurb.textContent = t2("blurb."+style);
}
// applyTheme 在 t() 之前就會被呼叫（初始化順序），包一層避免未定義時炸掉
function t2(k){ try{ return t(k); }catch{ return ""; } }

// 使用模式（依嚴重程度，對齊 App 三段）
const SEV_MODES = [
  ["mild",     "sev.mild",     "sev.mildDesc"],
  ["moderate", "sev.moderate", "sev.moderateDesc"],
  ["severe",   "sev.severe",   "sev.severeDesc"],
];
// 套用模式到介面：中/重度隱藏複雜設定（body class 控制）；重度＝進入全螢幕逐張掃描
function applySeverity(mode, { enter=false } = {}){
  state.settings.severityMode = mode;
  document.body.classList.toggle("sev-moderate", mode === "moderate");
  document.body.classList.toggle("sev-severe", mode === "severe");
  // 中度：圖卡預設放大（若使用者還沒自己調過就給特大）
  if(mode === "moderate" && (+state.settings.aacScale || 1) < 3){ state.settings.aacScale = 3; }
  save();
  renderSevModes();
  if(mode === "severe"){ if(enter){ enterKiosk(); toast(t("care.entered")); } }
  else if(mode === "moderate"){ renderAac(); $('.tab[data-tab="aac"]')?.click(); }
}
function renderSevModes(){
  const box = $("#sevModes"); if(!box) return;
  const cur = state.settings.severityMode || "mild";
  box.innerHTML = SEV_MODES.map(([k,nameKey,descKey])=>
    `<div class="sevmode${k===cur?" on":""}" data-m="${k}">
       <div class="sevmode-name">${t(nameKey)}${k===cur?' <span class="sevmode-tick">✓</span>':''}</div>
       <div class="sevmode-desc tiny muted">${t(descKey)}</div>
     </div>`).join("");
  box.querySelectorAll(".sevmode").forEach(el=>bindTap(el, ()=>applySeverity(el.dataset.m, { enter:true }), 250));
}

// ── 設定 UI 綁定 ──
function fillSettings(){
  $("#k_tgtoken").value = state.apiKeys.tgtoken;
  $("#k_tgchat").value = state.apiKeys.tgchat;
  $("#s_theme").value = state.settings.theme;
  $("#s_lang").value = state.settings.lang;
  $("#s_rate").value = state.settings.rate; $("#rateVal").textContent = state.settings.rate+"x";
  $("#s_font").value = state.settings.font; $("#fontVal").textContent = state.settings.font+"x";
  if($("#s_confirmCard")) $("#s_confirmCard").checked = state.settings.confirmCard !== false;
  if($("#s_style")) $("#s_style").value = state.settings.style || "tech";
  if($("#s_contrast")) $("#s_contrast").checked = !!state.settings.highContrast;
  if($("#k_familyPhone")) $("#k_familyPhone").value = state.settings.familyPhone || "";
  // 使用模式（依嚴重程度）三段選單 + 重度退出 PIN
  renderSevModes();
  if($("#care_pin")) $("#care_pin").value = state.settings.kioskPin || "1234";
  renderProviderList("#llmList", "llmApis", LLM_PROVIDERS);
  renderProviderList("#imgList", "imageApis", IMAGE_PROVIDERS);
  // 本地語音引擎
  $("#lt_enabled").checked = !!state.settings.localTtsEnabled;

  renderCloudList();
  // ngrok 雲端通道
  if($("#ng_token")){
    $("#ng_token").value = state.apiKeys.ngrokToken || "";
    $("#ng_domain").value = state.apiKeys.ngrokDomain || "";
    $("#ng_pair").value = ensurePairCode();
  }
  if(state.settings.localVoiceName){
    $("#lt_voice").innerHTML = `<option value="${escapeHtml(state.settings.localVoiceName+"|"+state.settings.localVoiceLang)}">${escapeHtml(state.settings.localVoiceName)}（${escapeHtml(state.settings.localVoiceLang||"?")}）</option>`;
  }
  if($("#lt_emotion")) $("#lt_emotion").value = state.settings.voiceEmotion || "";
}

// 介面語言（zh-TW/en-US/ja-JP/ko-KR）→ 語音標籤（ZH/EN/JA/KO）
function appLangToVoiceTag(l){
  const b = (l||"").toLowerCase().split("-")[0];
  return { zh:"ZH", en:"EN", ja:"JA", ko:"KO" }[b] || "ZH";
}

let _cachedVoices = null;   // 上次偵測到的完整語音清單（切語言時免重連即可重篩）

// 依目前介面語言，把快取裡符合的角色語音填進下拉（純前端、不連網）
function populateVoiceDropdown(){
  const sel = $("#lt_voice");
  if(!sel) return;
  if(!_cachedVoices){ return; }   // 尚未偵測過 → 不動
  const want = appLangToVoiceTag(state.settings.lang);
  const voices = _cachedVoices.filter(v => (v.lang||"").toUpperCase() === want);
  if(!voices.length){
    sel.innerHTML = `<option value="">${t("lt.noVoiceForLang").replace("{lang}",want)}</option>`;
    state.settings.localVoiceName = ""; state.settings.localVoiceLang = ""; save();
    return;
  }
  // 目前選的若不在此語言清單 → 改選第一個
  let cur = `${state.settings.localVoiceName}|${state.settings.localVoiceLang}`;
  if(!voices.some(v => `${v.name}|${v.lang}` === cur)){
    state.settings.localVoiceName = voices[0].name;
    state.settings.localVoiceLang = voices[0].lang;
    save();
    cur = `${voices[0].name}|${voices[0].lang}`;
  }
  // 雲端曲庫：標示哪些已下載到運算端（未下載的選了會先自動下載，需要等）
  sel.innerHTML = voices.map(v=>{
    const val = `${v.name}|${v.lang}`;
    const mark = v.downloaded === false ? "☁️ " : (v.downloaded ? "✅ " : "");
    return `<option value="${escapeHtml(val)}" ${val===cur?"selected":""}>${mark}${escapeHtml(v.name)}（${escapeHtml(v.lang||"?")}）</option>`;
  }).join("");
}

// 雲端／電腦清單：可自由新增多個端點（Colab、Tailscale、自家電腦…），偵測時逐一嘗試自動接手。
function renderCloudList(){
  const box = $("#lt_list");
  if(!box) return;
  const list = state.settings.localComputeServers || [];
  if(!list.length){
    box.innerHTML = `<p class="tiny muted">${t("lt.noClouds")}</p>`;
    return;
  }
  box.innerHTML = list.map((srv,i)=>{
    const shown = escapeHtml((srv.url||"").replace(/^https?:\/\//,""));
    const nm = escapeHtml(srv.name || `#${i+1}`);
    return `<div class="row" style="gap:8px;align-items:center">
      <span class="chip" style="flex:1;text-align:left;cursor:default">🖥 ${nm}<span class="tiny muted"> · ${shown}</span></span>
      <button class="btn ghost tiny" data-rm="${i}" title="${escapeHtml(t("lt.removeCloud"))}">✕</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click", ()=>{
    const i = +b.getAttribute("data-rm");
    state.settings.localComputeServers.splice(i,1); save(); renderCloudList();
  }));
}

// 把一個網址加進「雲端／電腦清單」並立刻偵測連線。回 true=已加入。
function addCloudUrl(raw){
  let url = (raw||"").trim().replace(/\/+$/,"");
  if(!url){ toast(t("lt.enterUrl")); return false; }
  if(!/^https?:\/\//i.test(url)) url = "https://" + url;   // 沒打協定自動補
  if(!Array.isArray(state.settings.localComputeServers)) state.settings.localComputeServers = [];
  if(state.settings.localComputeServers.some(s=>s.url===url)){ toast(t("lt.dupCloud")); return false; }
  const n = state.settings.localComputeServers.length + 1;
  state.settings.localComputeServers.push({ name: t("lt.cloudN").replace("{n}", n), url });
  save(); renderCloudList();
  toast(t("lt.cloudAdded"));
  refreshLocalVoices().catch(()=>{});
  return true;
}
function addCloudServer(){
  const inp = $("#lt_url");
  if(addCloudUrl(inp.value)) inp.value = "";
}

// 偵測語音中心、回報三項運算可用性、把「符合目前介面語言」的角色語音填進下拉
async function refreshLocalVoices(){
  const status = $("#lt_status"), sel = $("#lt_voice");
  status.textContent = t("lt.detecting");
  const d = await detectLocalTts();
  if(!d){ status.textContent = t("lt.cantConnect"); return; }
  const h = d.health || {};
  const caps = [t("cap.voice")+(h.voice?"✓":"✗"), t("cap.image")+(h.image?"✓":"✗"), t("cap.text")+(h.text?"✓":"✗")].join(" · ");
  const host = d.base.replace(/^https?:\/\//,"");
  if(h.voice){
    _cachedVoices = await localVoices();
    populateVoiceDropdown();
    renderCloudLibrary().catch(()=>{});
    status.textContent = t("lt.connected").replace("{host}",host).replace("{caps}",caps).replace("{lang}",appLangToVoiceTag(state.settings.lang));
  } else {
    _cachedVoices = null;
    sel.innerHTML = `<option value="">${t("lt.voiceSvcDown")}</option>`;
    const lib = $("#lib_list"); if(lib) lib.innerHTML = "";
    status.textContent = t("lt.connectedNoVoice").replace("{host}",host).replace("{caps}",caps);
  }
}

// 雲端曲庫（Apple Music 式）：列出整個 Drive 曲庫，每個角色可「預備」下載到運算端
function _sizeLabel(bytes){
  if(bytes >= 1048576) return Math.round(bytes/1048576)+" MB";
  if(bytes > 0) return Math.round(bytes/1024)+" KB";
  return "—";
}
const LANG_SECTIONS = [["ZH","🇹🇼 中文"],["EN","🇺🇸 English"],["JA","🇯🇵 日本語"],["KO","🇰🇷 한국어"]];
async function renderCloudLibrary(){
  const box = $("#lib_list"); if(!box) return;
  box.innerHTML = `<span class="tiny muted">${t("lib.loading")}</span>`;
  const all = await localCatalog();
  if(!all.length){ box.innerHTML = `<span class="tiny muted">${t("lib.empty")}</span>`; return; }
  box.innerHTML = "";
  // 語言分區（ZH/EN/JA/KO），區內「已下載在最上面」再按名稱排
  const known = new Set(LANG_SECTIONS.map(([k])=>k));
  const sections = [...LANG_SECTIONS, ["", t("lib.langOther")]];
  for(const [langKey, label] of sections){
    const chars = all
      .filter(c=>{ const L=(c.lang||"").toUpperCase(); return langKey ? L===langKey : !known.has(L); })
      .sort((a,b)=> (!!b.downloaded - !!a.downloaded) || String(a.character||a.name).localeCompare(String(b.character||b.name), "zh-Hant"));
    if(!chars.length) continue;
    const head = document.createElement("div");
    head.className = "tiny muted";
    head.style.cssText = "margin:8px 0 2px;font-weight:700";
    head.textContent = `${label}（${chars.filter(c=>c.downloaded).length}/${chars.length} ${t("lib.dlDone")}）`;
    box.appendChild(head);
    renderLibraryRows(box, chars);
  }
}
function renderLibraryRows(box, chars){
  for(const c of chars){
    const tag = c.lang ? c.lang.toUpperCase() : "";
    const emos = (c.emotions && c.emotions.length) ? c.emotions.join("／") : t("lib.noEmo");
    const dl = !!c.downloaded;                       // 雲端＝曲庫，本機只是快取
    const row = document.createElement("div");
    row.className = "row"; row.style.cssText = "gap:8px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.08)";
    row.innerHTML =
      `<span style="width:8px;height:8px;border-radius:4px;flex:0 0 auto;background:${dl?'#3ddc84':'#8a8f98'}"></span>`+
      `<div style="flex:1;min-width:0">`+
        `<div style="font-weight:600">${escapeHtml(c.character||c.name)}${tag?`<span class="tiny muted"> ${escapeHtml(tag)}</span>`:""}</div>`+
        `<div class="tiny muted">${dl?t("lib.dlDone"):t("lib.dlNone")} · ${_sizeLabel(c.bytes)} · ${escapeHtml(emos)}</div>`+
      `</div>`+
      `<button class="btn ghost tiny lib_prep"${dl?" disabled":""}>${dl?t("lib.dlDone"):t("lib.prepare")}</button>`;
    const btn = row.querySelector(".lib_prep");
    if(dl) btn.style.opacity = ".55";
    btn.addEventListener("click", async ()=>{
      btn.disabled = true; const old = btn.textContent; btn.textContent = t("lib.preparing");
      try{
        const r = await localPrepare(c.character||c.name, c.lang||"");
        if(r && r.ok){
          if(r.downloaded === undefined){
            // 舊版伺服器不回 downloaded → 下載了也不會亮綠燈，直接講明白免得使用者一直重按
            toast(t("lib.oldServer"));
          } else {
            const mb = Math.round((r.bytes||0)/1048576);
            toast(`✅ ${c.character||c.name}${tag?(" "+tag):""}：`+t("lib.ready").replace("{mb}",mb).replace("{n}",r.files||0));
          }
          renderCloudLibrary().catch(()=>{});   // 重繪，讓狀態變「已下載」
          refreshLocalVoices().catch(()=>{});   // 角色下拉的 ✅/☁️ 也跟著更新
        } else {
          toast("⚠️ "+((r&&r.error)||t("lib.prepFail")));
        }
      }catch(x){ toast("⚠️ "+(x.message||x)); }
      finally{ btn.disabled = false; btn.textContent = old; }
    });
    box.appendChild(row);
  }
}

function bindSettings(){
  $("#k_tgtoken").addEventListener("input", e=>{ state.apiKeys.tgtoken=e.target.value.trim(); save(); });
  $("#k_tgchat").addEventListener("input", e=>{ state.apiKeys.tgchat=e.target.value.trim(); save(); });
  $("#s_theme").addEventListener("change", e=>{ state.settings.theme=e.target.value; applyTheme(); save(); });
  $("#s_lang").addEventListener("change", e=>{ state.settings.lang=e.target.value;
    applyI18n(state.settings.lang);          // 先翻譯整個介面（含儲存狀態用的語言）
    populateVoiceDropdown();                  // 角色語音清單即時用快取重新篩選
    renderCombo();                            // AAC 組合區空狀態文字跟著新語言重繪
    renderSevModes();                         // 使用模式三段（名稱與說明都是動態產生）
    renderWho();                              // 頂端使用者名（匿名／本機）也要跟著新語言
    applyTheme();                             // 風格說明文字（blurb）也是動態產生
    renderQuickSos();                         // 快速求救三顆鈕的字
    { const b=$("#btnAudioDirect"); if(b && !isRecording()){ b.textContent=t("btn.audioDirect"); b.classList.toggle("hidden", !hasNativeAudio()); } }
    renderStory();                            // 故事題目與提示字
    renderCcList();                           // 自訂圖卡的空狀態文字
    renderProviderList("#llmList", "llmApis", LLM_PROVIDERS);   // 供應商清單的空狀態／免金鑰標示
    renderProviderList("#imgList", "imageApis", IMAGE_PROVIDERS);
    renderClinicalBank(s=>{ const inp=$("#rehabTarget"); if(inp){ inp.value=s; $('.tab[data-tab="rehab"]')?.click(); } });
    renderAac();                              // AAC 分類 chip（「我的」分類名要跟著翻）
    setShortcutMsg("");                       // 舊語言的存檔／錯誤訊息不該留在畫面上

    renderCloudList();                        // 雲端／電腦清單的空狀態（實機掃到它留在舊語言）
    renderVoices();                           // 專屬聲音的空狀態與「缺權重」提示
    buildSettingsIndex();                     // 設定索引的每一列都取自 h3 的譯文
    // 成績單內容是「載入當下」畫出來的（含圖表裡的「尚無資料」與空狀態），
    // 正在看報表時要重跑一次，否則畫面會留著舊語言的字。
    if($('.tab[data-tab="report"]')?.classList.contains("active")) loadReport();
    save(); });
  $("#s_rate").addEventListener("input", e=>{ state.settings.rate=+e.target.value; $("#rateVal").textContent=e.target.value+"x"; save(); });
  $("#s_font").addEventListener("input", e=>{ state.settings.font=+e.target.value; $("#fontVal").textContent=e.target.value+"x"; applyTheme(); save(); });
  $("#s_confirmCard")?.addEventListener("change", e=>{ state.settings.confirmCard = e.target.checked; save(); });
  $("#s_style")?.addEventListener("change", e=>{ state.settings.style = e.target.value; applyTheme(); save(); });
  $("#s_contrast")?.addEventListener("change", e=>{ state.settings.highContrast = e.target.checked; applyTheme(); save(); });
  $("#k_familyPhone")?.addEventListener("input", e=>{ state.settings.familyPhone = e.target.value.trim(); save(); });
  // 使用模式（三段選單在 renderSevModes 內綁 tap）＋重度退出 PIN
  if($("#care_pin")){
    $("#care_pin").addEventListener("change", e=>{
      const pin = (e.target.value||"").replace(/\D/g,"").slice(0,4);
      e.target.value = pin;
      if(pin.length===4){ state.settings.kioskPin = pin; save(); }
      else toast(t("care.pinBad"));
    });
  }
  setupShortcuts();
  setupVoices();
  $("#addLlm").addEventListener("click", ()=>{ state.llmApis.push({id:newId(),provider:Object.keys(LLM_PROVIDERS)[0],key:"",model:""}); save(); renderProviderList("#llmList","llmApis",LLM_PROVIDERS); });
  $("#addImg").addEventListener("click", ()=>{ state.imageApis.push({id:newId(),provider:"pollinations",key:"",model:""}); save(); renderProviderList("#imgList","imageApis",IMAGE_PROVIDERS); });
  // 本地語音引擎
  $("#lt_enabled").addEventListener("change", async e=>{
    state.settings.localTtsEnabled = e.target.checked; save();
    if(e.target.checked) await refreshLocalVoices();
  });
  $("#lt_add").addEventListener("click", addCloudServer);
  $("#lt_url").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); addCloudServer(); } });
  $("#lt_detect").addEventListener("click", refreshLocalVoices);

  if($("#lib_refresh")) $("#lib_refresh").addEventListener("click", ()=>renderCloudLibrary().catch(()=>{}));
  if($("#lt_emotion")) $("#lt_emotion").addEventListener("change", e=>{ state.settings.voiceEmotion = e.target.value; save(); });
  // ngrok 雲端通道：token/domain 存帳號雲端 + 鏡射到配對文件（Colab 用配對碼取）
  const pushNgrok = async ()=>{
    save();
    const st = $("#ng_status");
    if(!state.uid || state.uid==="local"){ if(st) st.textContent = t("ng.needLogin"); return; }
    if(st) st.textContent = t("ng.saving");
    const ok = await pushNgrokBridge();
    if(st) st.textContent = ok ? t("ng.saved") : t("ng.saveFail");
  };
  if($("#ng_token")){
    $("#ng_token").addEventListener("change", e=>{ state.apiKeys.ngrokToken = e.target.value.trim(); pushNgrok(); });
    $("#ng_domain").addEventListener("change", e=>{
      // 正規化成純網域：使用者常貼整串網址（https://xxx.ngrok-free.app/）——
      // ngrok 的 domain 參數帶 scheme/斜線會 ERR_NGROK_9038 開不了通道
      const d = e.target.value.trim().replace(/^https?:\/\//i,"").split("/")[0].replace(/\.$/,"");
      e.target.value = d;
      state.apiKeys.ngrokDomain = d; pushNgrok();
    });
    // 一鍵把 Colab 的 ngrok 固定網域加進連線清單並偵測（免手動複製到上面欄位）
    if($("#ng_use")) $("#ng_use").addEventListener("click", ()=>{
      const d = ($("#ng_domain").value||"").trim();
      if(!d){ toast(t("ng.needDomain")); return; }
      addCloudUrl(d);
    });
    $("#ng_copy").addEventListener("click", async ()=>{
      try{ await navigator.clipboard.writeText($("#ng_pair").value); toast(t("ng.copied")); }
      catch{ toast(t("ng.copyFail")); }
    });
  }
  $("#lt_voice").addEventListener("change", async e=>{
    const [name, lang] = (e.target.value||"").split("|");
    if(!name) return;
    state.settings.localVoiceName = name; state.settings.localVoiceLang = lang||""; save();
    toast(t("toast.voiceSwitching").replace("{name}", name));
    try{ await localSwitch(name, lang); toast(t("toast.voiceSwitched").replace("{name}", name)); }
    catch(x){ toast(t("toast.voiceSwitchFail")+(x.message||x)); }
  });
}

// 多供應商/多金鑰清單：供應商下拉 + 金鑰欄 + 刪除
function renderProviderList(containerId, listKey, catalog){
  const box = $(containerId); const list = state[listKey] || [];
  if(!list.length){ box.innerHTML = `<p class="tiny muted">${t("providers.none")}</p>`; return; }
  const opts = (sel)=>Object.entries(catalog).map(([k,v])=>`<option value="${k}" ${k===sel?'selected':''}>${v.label}</option>`).join("");
  box.innerHTML = list.map((e,i)=>{
    const needsKey = catalog[e.provider]?.needsKey !== false;
    return `<div class="prow" data-i="${i}" style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px">
      <div class="row" style="margin:0;gap:6px">
        <select class="p-prov" style="flex:1">${opts(e.provider)}</select>
        <span class="chip p-del" title="${t("providers.del")}">🗑</span>
      </div>
      ${needsKey?`<input class="p-key" type="password" placeholder="${t("providers.keyPh")}" value="${escapeHtml(e.key||"")}" autocomplete="off" style="margin-top:6px"/>`:`<p class="tiny muted" style="margin:6px 0 0">${t("providers.keyFree")}</p>`}
    </div>`;
  }).join("");
  box.querySelectorAll(".prow").forEach(row=>{
    const i = +row.dataset.i;
    row.querySelector(".p-prov").addEventListener("change", e=>{ state[listKey][i].provider=e.target.value; state[listKey][i].key=""; save(); renderProviderList(containerId,listKey,catalog); });
    row.querySelector(".p-key")?.addEventListener("input", e=>{ state[listKey][i].key=e.target.value.trim(); save(); });
    row.querySelector(".p-del").addEventListener("click", ()=>{ state[listKey].splice(i,1); save(); renderProviderList(containerId,listKey,catalog); });
  });
}

// ── 分頁 ──

// ── 設定：索引 → 子頁 ──────────────────────────────────────────
//
// 設定原本是一長串卡片一路往下堆，找一項要捲很久——而這個 App 的使用者
// 本來就不擅長在長頁面裡定位。改成 App 那種「一排可點的列 → 點進去才是內容」。
//
// 索引從 #settingsCards 底下每張卡的 h3 自動產生：新增一張卡就自動多一列，
// 不必兩邊各改一次（那種要同步維護的清單遲早會漏）。

/** 目前打開的是第幾張卡；-1 代表停在索引。 */
let _openCard = -1;

/** 開頭的 emoji 當作圖示，其餘當標題。抓得到 ZWJ 組合字（🧑‍⚕️ 是三個碼位）。 */
const ICON_RE = /^\s*(\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)\s*/u;

function settingsCards(){
  const wrap = $("#settingsCards");
  return wrap ? [...wrap.children].filter(el => el.classList.contains("card")) : [];
}

function buildSettingsIndex(){
  const idx = $("#settingsIndex");
  if(!idx) return;
  idx.innerHTML = settingsCards().map((c, i) => {
    const raw = (c.querySelector("h3")?.textContent || "").trim();
    const m = raw.match(ICON_RE);
    const icon = m ? m[1] : "⚙️";
    const label = (m ? raw.slice(m[0].length) : raw) || t("set.prefs");
    // 複雜項目在中重度模式要一起隱藏。CSS 是用 body.sev-* .complex 做的，
    // 所以把 complex 原封不動帶到列上，這條規則就自動涵蓋索引。
    // 卡片上的 data-setkey 原封不動帶到列上。自動演示要用它找到目標卡——
    // 以前是拿標題文字去比中文關鍵字，介面一換成英文/日文/韓文就一個都對不上，
    // 然後靜靜地退回第一張卡：旁白在講發音模型，畫面開的是文字供應商設定。
    const setkey = c.dataset.setkey ? ` data-setkey="${esc(c.dataset.setkey)}"` : "";
    return `<button type="button" class="setrow${c.classList.contains("complex") ? " complex" : ""}" data-i="${i}"${setkey}>
        <span class="setrow-ico">${esc(icon)}</span>
        <span class="setrow-label">${esc(label)}</span>
        <span class="setrow-chev" aria-hidden="true">›</span>
      </button>`;
  }).join("");
  idx.querySelectorAll(".setrow").forEach(b =>
    b.addEventListener("click", () => openSettingsCard(+b.dataset.i)));
  // 重建索引（切語言）時停在原本那一頁，不要把人踢回索引——
  // 他只是換個語言，不是想離開現在在看的東西。
  if(_openCard >= 0) openSettingsCard(_openCard); else closeSettingsCard();
}

function openSettingsCard(i){
  const cards = settingsCards();
  const card = cards[i];
  if(!card) return closeSettingsCard();
  _openCard = i;
  cards.forEach((c, n) => c.classList.toggle("hidden", n !== i));
  $("#settingsIndex")?.classList.add("hidden");
  const back = $("#btnSettingsBack");
  const raw = (card.querySelector("h3")?.textContent || "").trim();
  const m = raw.match(ICON_RE);
  $("#settingsBackLabel").textContent = m ? raw.slice(m[0].length) : raw;
  back?.classList.remove("hidden");
  // 子頁是新的一屏，從頭開始看
  window.scrollTo({ top: 0, behavior: "auto" });
}

function closeSettingsCard(){
  _openCard = -1;
  settingsCards().forEach(c => c.classList.add("hidden"));
  $("#settingsIndex")?.classList.remove("hidden");
  $("#btnSettingsBack")?.classList.add("hidden");
}

function setupSettingsSubpages(){
  $("#btnSettingsBack")?.addEventListener("click", () => {
    closeSettingsCard();
    window.scrollTo({ top: 0, behavior: "auto" });
  });
  buildSettingsIndex();
}

function setupTabs(){
  $$(".tab").forEach(t=>t.addEventListener("click", ()=>{
    $$(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    $$(".panel").forEach(p=>p.classList.add("hidden"));
    $("#tab-"+t.dataset.tab).classList.remove("hidden");
    try{ localStorage.setItem("vw_tab", t.dataset.tab); }catch{}   // 記住分頁，下次開啟直接回來
    if(t.dataset.tab==="history") renderHistory();
    if(t.dataset.tab==="rehab") renderRehabLogs();
    if(t.dataset.tab==="report") loadReport();
    if(t.dataset.tab==="settings"){
      // 回到設定一律從索引開始。停在上次那一頁的話，使用者會以為設定頁
      // 就只有那一區——他不知道要先按返回才看得到其他項目。
      closeSettingsCard();
      // 每次切進設定就重讀一次雲端，不然手機上剛錄好的東西要重新整理才看得到——
      // 而使用者不會想到要重新整理，只會覺得兩邊沒有同步。

      renderVoices().catch(()=>{});
    }
  }));
}

// 回到上次使用的分頁（長輩不用每次找「AAC 圖卡」在哪）
function restoreLastTab(){
  let k = "";
  try{ k = localStorage.getItem("vw_tab") || ""; }catch{}
  const btn = k && document.querySelector(`.tab[data-tab="${k}"]`);
  if(btn && !btn.classList.contains("active")) btn.click();
}

// ── 重組 ──
// 自我一致性一次取樣 3 個候選；不滿意可按「換一個說法」在候選間切換（不重打 API），
// 三個都看過還是不對，最後一顆會變成「重新生成」才真的重新呼叫 LLM。
let altList = [];       // 目前這批候選
let altIndex = 0;       // 正在顯示第幾個
let lastFrag = "";      // 重新生成時要用的原始碎詞

/**
 * 把候選句整批攤開（與 App 的做法一致）。
 *
 * 舊版是「一次顯示一句、按鈕輪播」，但按鈕上寫的是「三個都不對？重新生成」——
 * 使用者從頭到尾只看過一句，憑什麼判斷三個都不對。而且候選其實可能只有 1～2 句
 * （模型講得一致時會塌掉），「三個」是寫死的。
 *
 * 依信心度由高到低排：最可能對的排最上面，手指移動距離最短。
 * 點一下只是「選定」不發聲——挑的過程不該每點一次就送一次語音合成。
 */
function renderAltList(){
  const wrap = $("#altPick"), box = $("#altList"), btn = $("#btnAlt");
  if(!wrap || !box) return;
  if(altList.length <= 1){
    wrap.classList.add("hidden");
    box.innerHTML = "";
    if(btn) btn.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  if(btn){ btn.classList.remove("hidden"); btn.textContent = t("btn.regenerate"); }
  // 排序只做一次的效果：記住原始索引，選取狀態才不會跟著排序跑掉
  const ranked = altList.map((c,i)=>({ ...c, i }))
                        .sort((a,b)=>(b.confidence??0)-(a.confidence??0));
  box.innerHTML = ranked.map(c=>{
    const on = c.i === altIndex;
    return `<button class="btn ghost block alt-opt${on?" on":""}" data-i="${c.i}"
              aria-pressed="${on}">${on?"◉":"○"}　${escapeHtml(c.text)}</button>`;
  }).join("");
  box.querySelectorAll(".alt-opt").forEach(el=>{
    el.addEventListener("click", ()=>selectAlt(+el.dataset.i));
  });
}

/** 選定某一句（不發聲）。 */
function selectAlt(i){
  if(!altList[i]) return;
  altIndex = i;
  lastResult = altList[i].text;
  $("#resultText").textContent = lastResult;
  renderAltList();
}

/** 「都不對？重新生成」：真的再打一次 LLM。 */
async function cycleAlt(){ await doCompose(); }

async function doCompose(){
  const frag = $("#fragments").value.trim();
  if(!frag){ toast(t("toast.enterFragments")); return; }
  if(!hasAnyLlmKey()){ toast(t("toast.needLlm")); return; }
  // 輸入端攔截：只在「按朗讀」才擋是不夠的——打完字沒按朗讀就放著，家人永遠不會知道。
  // 但只有「本人想自傷」才停止重組；替別人求救的句子必須讓它組出來、講出去。
  crisisCleared = false;
  if(containsCrisisSignal(frag)){
    const who = await judgeCrisis(frag);
    if(who === "self"){
      showLock(t("safety.blockedCompose"));
      openCrisis();                              // 通報家人＋視訊＋專線
      return;
    }
    if(who === "unknown") notifyFamilyQuietly(frag);   // 判不出來：通報但不擋
    // 已判定成替人求救／中性提及 → 後面不可以再把關鍵字消毒掉，
    // 否則「我朋友想自殺」會變成「我朋友想（請與家屬聯絡）」，求救句就毀了。
    crisisCleared = true;
  }
  $("#btnCompose").disabled = true; $("#btnCompose").textContent = t("btn.composing");
  try{
    lastFrag = frag;
    const r = await reconstruct(frag, ctxText);
    altList = r.alternatives || [{ text: r.text, confidence: r.confidence }];
    altIndex = 0;
    lastResult = r.text;
    $("#resultText").textContent = lastResult;
    $("#result").classList.remove("hidden");
    $("#resultImg").classList.add("hidden");
    renderAltList();
    addHistory({ original: frag + (ctxText?(" | "+ctxText):""), reconstructed: lastResult });
    // **不自動唸。** 重組完就直接講出去等於替使用者決定他要說哪一句——
    // 而整個畫面的設計就是「給三個候選、讓他挑」。挑之前先唸，挑就沒有意義了。
    // 而且這條路繞過了 passesSpeechGate：醫療／疼痛類不會跳確認卡、
    // 也不會記錄他實際採納了哪一個候選（那是候選排序學習的唯一來源）。
    // 要發聲請按「🔊 朗讀」，那顆鈕該做的事都做了。
  }catch(e){ toast(t("toast.composeFail") + (e.message||e)); }
  finally{ $("#btnCompose").disabled=false; $("#btnCompose").textContent=t("btn.compose"); }
}

// ── 直接說給 AI 聽（跳過語音轉文字）──
// 講完直接得到句子：模型聽的是原始聲音，不是 STT 猜過一輪的文字。
function setupAudioDirect(){
  const btn = $("#btnAudioDirect");
  if(!btn) return;
  // 沒有支援原生音訊的金鑰就不顯示——按了只會報錯，不如不要出現
  btn.classList.toggle("hidden", !hasNativeAudio());
  const hint = $("#audioHint");
  const reset = () => { btn.textContent = t("btn.audioDirect"); btn.classList.remove("recording"); if(hint) hint.textContent=""; };

  btn.addEventListener("click", async ()=>{
    if(!isRecording()){
      try{
        await startAudioCapture();
        btn.textContent = t("btn.audioStop");
        btn.classList.add("recording");
        if(hint) hint.textContent = t("audio.recording");
      }catch{ toast(t("audio.needMic")); reset(); }
      return;
    }
    // 第二次按＝說完了
    btn.disabled = true;
    if(hint) hint.textContent = t("audio.thinking");
    try{
      const sentence = await stopAndInterpret(ctxText);
      lastResult = sentence;
      altList = [{ text: sentence, confidence: 0 }];   // 直接聽只有一個結果，不提供「換一個說法」
      altIndex = 0;
      $("#resultText").textContent = sentence;
      $("#result").classList.remove("hidden");
      $("#resultImg").classList.add("hidden");
      renderAltList();
      addHistory({ original: t("btn.audioDirect"), reconstructed: sentence });
      recordInputSource(true);   // 這條路是語音輸入
      // **不自動唸**（同 doCompose）。使用者沒按朗讀就發聲，等於替他決定要說什麼；
      // 而且會繞過 passesSpeechGate，還會在背景觸發電腦端合成——那要 10～30 秒，
      // 使用者感覺到的是「這個 App 好慢」，其實是在替他唸一句他還沒決定要說的話。
    }catch(e){
      cancelAudioCapture();
      toast(e.message || String(e));
    }finally{ btn.disabled = false; reset(); }
  });
}

// ── 相機（拍照→雲端辨識）──
function setupCamera(){
  const inp = document.createElement("input");
  inp.type="file"; inp.accept="image/*"; inp.capture="environment"; inp.style.display="none";
  document.body.appendChild(inp);
  $("#btnCam").addEventListener("click", ()=> inp.click());
  inp.addEventListener("change", async ()=>{
    const f = inp.files?.[0]; if(!f) return;
    toast(t("toast.recognizing"));
    try{
      const b64 = await fileToJpegBase64(f, 768);
      const items = await recognizePhoto(b64);
      if(items){ ctxText = (t("ctx.saw")+items); $("#ctx").textContent = "📷 "+items; toast(t("toast.recognized")); }
    }catch(e){ toast(t("toast.recognizeFail")+(e.message||e)); }
    inp.value="";
  });
}
function fileToJpegBase64(file, max){
  return new Promise((res,rej)=>{
    const img = new Image();
    img.onload = ()=>{
      const s = Math.min(1, max/Math.max(img.width,img.height));
      const c = document.createElement("canvas");
      c.width = img.width*s|0; c.height = img.height*s|0;
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      res(c.toDataURL("image/jpeg",0.8).split(",")[1]);
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}

// ── AAC ──
// 圖卡點擊全面走 bindTap（pointerup + 防連點 + 禁長按）——手抖誤觸只算一次。
// 自訂圖卡分類：ID 固定不隨語言變（它同時是 aacCat 的值與 chip 的 data-c），顯示名才翻譯。
const CC_CAT = "__custom__";
let aacCat = AAC_CATS[0];
let lastPos = "";             // 上一個點的詞性 → 候選詞預測（動詞後名詞優先…）
const combo = [];             // 整句緩衝（輕症：點卡只進緩衝，按「朗讀」才整句連貫唸）

const AMOUNT_CAT = "Money";   // 只有金額類顯示「自訂金額」入口
let aacSearch = "";           // 搜尋字串（有字時蓋掉分類瀏覽）

function aacCats(){
  return (state.customCards||[]).length ? [CC_CAT, ...AAC_CATS] : AAC_CATS;
}
const catLabel = c => c === CC_CAT ? t("cc.myCards") : (t("aac.cat."+c) + " " + (CAT_EMOJI[c]||""));

// 目前要顯示的卡片，統一成 {id?, emoji?, img?, word, pos}
function aacCards(cat){
  if(cat === CC_CAT) return (state.customCards||[]).map(c=>({ img:c.img, word:c.word, pos:c.pos||"" }));
  // 類別內也依推薦指數排（有分數的往前、沒分數的維持原順序）——
  // 但類別「結構」不動：患者靠位置記憶找卡，整片大風吹反而找不到。
  return rankWithin(cardsOfCat(cat), state.settings.currentLocationTag || "");
}

function cardHtml(c){
  return `<div class="acard${c.pos?` pos-${c.pos}`:""}" data-w="${escapeHtml(c.word)}" data-pos="${c.pos||""}" data-id="${escapeHtml(c.id||"")}">${
    c.img ? `<img class="aphoto" src="${c.img}" alt="" draggable="false" />`
          : `<span class="emoji">${c.emoji}</span>`
  }${escapeHtml(c.word)}</div>`;
}
// 點一張卡：進整句緩衝、記使用統計（含與句中其他卡的共現關聯，供推薦排序學習）
function bindCards(sel){
  // 只綁真正的詞卡：金額類尾巴那顆「自訂金額」入口雖然長得像卡，但它開的是
  // 對話框，若一起綁會在組合區多推一個空白詞。
  $$(sel+" .acard[data-w]").forEach(a=>bindTap(a, ()=>{
    a.classList.add("tapped");
    const id = a.dataset.id || "";
    if(id) recordUse(id, state.settings.currentLocationTag || "", combo.map(x=>x.id).filter(Boolean));
    combo.push({ word:a.dataset.w, id });
    const pos = a.dataset.pos || "";
    renderCombo();
    setTimeout(()=>{ const changed = pos !== lastPos; lastPos = pos; if(changed) renderAac(); }, 220);
  }));
}

function renderAac(){
  const cats = aacCats();
  if(!cats.includes(aacCat)) aacCat = cats[0];
  $("#aacCats").innerHTML = cats.map(c=>`<span class="chip ${c===aacCat?'on':''}" data-c="${escapeHtml(c)}">${escapeHtml(catLabel(c))}</span>`).join("");
  $$("#aacCats .chip").forEach(ch=>bindTap(ch, ()=>{ aacCat=ch.dataset.c; renderAac(); }, 250));
  // 字級：s2~s4 加在網格上（s3 兩欄、s4 一欄，自動降級）；字級切換 chip 同步高亮
  const s = Math.max(1, Math.min(4, +state.settings.aacScale || 1));
  const gridCls = "cards-grid" + (s > 1 ? ` aac-s${s}` : "");
  $("#aacItems").className = gridCls;
  $$(".aac-scale-chip").forEach(ch=>ch.classList.toggle("on", +ch.dataset.s === s));

  // ── 「常用」推薦列：冷啟動（有效統計 < 3 張）不顯示，不硬塞猜測 ──
  const feedWrap = $("#aacFeedWrap");
  if(feedWrap){
    const showFeed = !aacSearch && activeItemCount() >= 3;
    const items = showFeed ? rankFeed(allCards(), state.settings.currentLocationTag || "") : [];
    feedWrap.classList.toggle("hidden", !items.length);
    if(items.length){
      $("#aacFeed").className = gridCls;
      $("#aacFeed").innerHTML = items.map(cardHtml).join("");
      bindCards("#aacFeed");
    }
  }

  // ── 主網格：搜尋中就顯示全庫比對結果，否則顯示目前分類 ──
  let list;
  if(aacSearch){
    list = searchCards(aacSearch);
    $("#aacCats").classList.add("hidden");
  } else {
    $("#aacCats").classList.remove("hidden");
    // 動態候選詞預測：依上一個點的詞性重排（動詞後名詞優先…），引導 SVO 語序
    list = orderCards(aacCards(aacCat), lastPos);
  }
  if(!list.length){
    $("#aacItems").innerHTML = `<p class="tiny muted center" style="grid-column:1/-1">${t("aac.noMatch")}<br>${t("aac.searchHint")}</p>`;
    return;
  }
  $("#aacItems").innerHTML = list.map(cardHtml).join("")
    // 金額類尾巴掛「自訂金額」入口（找零／報價講不出來時直接打數字）
    + (!aacSearch && aacCat === AMOUNT_CAT
        ? `<div class="acard" id="aacAmountBtn"><span class="emoji">🔢</span>${escapeHtml(t("aac.customAmount"))}</div>` : "");
  bindCards("#aacItems");
  const ab = $("#aacAmountBtn");
  if(ab) bindTap(ab, openAmountDialog, 250);
}

// ── 自訂金額 ──
function openAmountDialog(){
  const sel = $("#amountCur");
  sel.innerHTML = CURRENCIES.map(c=>`<option value="${c.code}">${c.symbol} ${c.code} · ${escapeHtml(t("cur."+c.code))}</option>`).join("");
  sel.value = state.settings.currency || "NTD";
  $("#amountVal").value = "";
  $("#amountDlg").classList.remove("hidden");
  $("#amountVal").focus();
}
function renderCombo(){
  $("#aacCombo").innerHTML = combo.map((c,i)=>`<span class="chip on" data-i="${i}">${escapeHtml(c.word)} ✕</span>`).join("") || `<span class="tiny muted">${t("combo.empty")}</span>`;
  $$("#aacCombo .chip").forEach(c=>bindTap(c, ()=>{ combo.splice(+c.dataset.i,1); recordUndo(); renderCombo(); }, 250));
  // 沒設 LLM 金鑰時「✨組成句子」按了只會報錯 → 直接隱藏，少一顆干擾按鈕
  $("#aacCompose")?.classList.toggle("hidden", !hasAnyLlmKey());
}

// ── 自訂圖卡（拍照建檔）：原生相機 capture → canvas 縮圖 → 存帳號 ──
const CC_MAX = 12;            // 縮圖存設定文件（Firestore 單文件 1MB 上限），設個安全上限
let ccPending = "";           // 待加入的縮圖 dataURL
function fileToThumb(file, size=192){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = ()=>{
      const c = document.createElement("canvas");
      const sq = Math.min(img.width, img.height);        // 置中裁成正方形
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width-sq)/2, (img.height-sq)/2, sq, sq, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function renderCcList(){
  const list = state.customCards || [];
  $("#ccList").innerHTML = list.map(c=>
    `<div class="acard ccitem${c.pos?` pos-${c.pos}`:""}"><button class="cc-del" data-id="${c.id}">✕</button>` +
    `<img class="aphoto" src="${c.img}" alt="" draggable="false" />${escapeHtml(c.word)}</div>`).join("")
    || `<span class="tiny muted">${t("cc.empty")}</span>`;
  $$("#ccList .cc-del").forEach(b=>bindTap(b, ()=>{
    state.customCards = state.customCards.filter(c=>c.id !== b.dataset.id);
    save(); renderCcList(); renderAac();
  }, 250));
}
function setupCustomCards(){
  if(!$("#ccTake")) return;
  bindTap($("#ccTake"), ()=>$("#ccPhoto").click(), 250);
  $("#ccPhoto").addEventListener("change", async e=>{
    const f = e.target.files?.[0]; e.target.value = "";
    if(!f) return;
    try{
      ccPending = await fileToThumb(f);
      const pv = $("#ccPreview"); pv.src = ccPending; pv.classList.remove("hidden");
    }catch{ toast(t("cc.photoFail")); }
  });
  bindTap($("#ccAdd"), ()=>{
    const word = $("#ccWord").value.trim();
    if(!ccPending){ toast(t("cc.needPhoto")); return; }
    if(!word){ toast(t("cc.needWord")); return; }
    if((state.customCards||[]).length >= CC_MAX){ toast(t("cc.full")); return; }
    state.customCards.push({ id:newId(), word, pos:$("#ccPos").value, img:ccPending });
    ccPending = ""; $("#ccWord").value = ""; $("#ccPreview").classList.add("hidden");
    save(); renderCcList(); renderAac();
    toast(t("cc.added"));
  }, 250);
  renderCcList();
}

function setupAac(){
  renderAac(); renderCombo(); setupCustomCards();
  $$(".aac-scale-chip").forEach(ch=>bindTap(ch, ()=>{
    state.settings.aacScale = +ch.dataset.s; save(); renderAac();
  }, 250));
  // 整句緩衝一次連貫朗讀（Speak All）。強烈意圖（醫療／緊急）先跳確認大圖卡再唸。
  bindTap($("#aacSpeak"), ()=>{ if(combo.length) confirmThenSpeak(comboText()); });
  bindTap($("#aacClear"), ()=>{ combo.length=0; renderCombo(); });
  bindTap($("#aacCompose"), async ()=>{
    if(!combo.length){ toast(t("toast.pickCards")); return; }
    if(!hasAnyLlmKey()){ toast(t("toast.needLlmCompose")); return; }
    toast(t("toast.composing"));
    try{ const s = await composeAac(combo.map(c=>c.word), ctxText);
      confirmThenSpeak(s);
      $("#fragments").value = s; toast(t("toast.composed"));
      addHistory({ original:"AAC: "+combo.map(c=>c.word).join("+"), reconstructed:s });
    }catch(e){ toast(t("toast.aacFail")+(e.message||e)); }
  });

  // 搜尋：輸入即篩（跨全部分類比對詞面）
  const sb = $("#aacSearch");
  if(sb) sb.addEventListener("input", e=>{ aacSearch = e.target.value; renderAac(); });

  // 自訂金額
  bindTap($("#amountAdd"), ()=>{
    const v = ($("#amountVal").value||"").trim();
    if(!v) return;
    const cur = CURRENCIES.find(c=>c.code === $("#amountCur").value) || CURRENCIES[0];
    state.settings.currency = cur.code; save();
    combo.push({ word: cur.symbol + v, id: "" });   // 自訂金額不進使用統計（每次數字都不同）
    $("#amountDlg").classList.add("hidden");
    renderCombo();
  });
  bindTap($("#amountCancel"), ()=>$("#amountDlg").classList.add("hidden"));

  // 意圖確認大圖卡
  bindTap($("#confirmYes"), async ()=>{
    $("#confirmDlg").classList.add("hidden");
    recordCandidateChoice(rejectStreak === 0);   // 沒退過＝第一候選就對
    rejectStreak = 0;
    // 仍要過閘門：確認卡只擋「意思對不對」，擋不了「這句話該不該說出口」
    if(_pendingSpeak && await passesSpeechGate(_pendingSpeak, { fromConfirmCard:true })){
      markFirstSpeak(); recordInputSource(true); speak(_pendingSpeak);
    }
  });
  bindTap($("#confirmNo"), onConfirmReject);
  // 鎖定彈窗只能關掉，不提供任何「還是唸出來」的出口
  bindTap($("#lockOk"), ()=>$("#lockDlg").classList.add("hidden"));
}

/**
 * 發聲前的安全閘門（第二層防禦，規則與 App 的 SafetyGuard.classifyRisk 完全相同）。
 *
 * 為什麼一定要有：使用者在碎詞欄打「自殺」，AI 會老實重組成「我想自殺」，
 * 然後畫面就給一顆朗讀鈕——等於幫一個講不出話的人把最不該說出口的話唸出來。
 *
 * @returns true＝可以繼續唸；false＝已攔下並處理，呼叫端不要再唸。
 */
/**
 * 鎖定彈窗。用彈窗不用 toast——toast 幾秒就消失，
 * 這種時刻必須擋在使用者面前，也要讓照護者看得到「已經通報家人了」。
 */
function showLock(bodyText){
  $("#confirmDlg").classList.add("hidden");     // 別讓確認卡停在底下
  $("#lockBody").textContent = bodyText;
  $("#lockDlg").classList.remove("hidden");
}

/**
 * 危機語句的兩階段判定。
 *
 * 關鍵字只是**快速預篩**，它分不出這兩句：
 *   「我想自殺」                → 本人求救，該鎖
 *   「我朋友想自殺，快叫救護車」→ 替別人求救，擋下來等於害死另一個人
 * 所以命中之後再讓 AI 判斷「想自傷的是誰」。
 *
 * @returns {Promise<"self"|"other"|"none"|"unknown">}
 */
async function judgeCrisis(text){
  if(!containsCrisisSignal(text)) return "none";
  const who = await classifyCrisisIntent(text).catch(()=>null);
  if(who) return who;
  // AI 判不出來（沒網路／金鑰失效／模型拒答）→ 通報家人，但讓他把話講出來。
  // 真的是本人求救：家人仍收到通報，最重要的一步沒漏。
  // 是替別人求救：話送得出去，救護車叫得到。兩邊的最壞情況都不致命。
  return "unknown";
}

/** 靜默通報家人，不打斷使用者。用在「判不出來」時。 */
function notifyFamilyQuietly(text){
  telegramNotify(t("safety.uncertainAlert") + "\n" + text.slice(0, 120)).catch(()=>{});
}

async function passesSpeechGate(text, { fromConfirmCard = false } = {}){
  if(!text) return false;
  const risk = classifyRisk(text);
  if(risk === "lock"){
    if(containsCrisisSignal(text)){
      const who = await judgeCrisis(text);
      // 替別人求救、或只是提到這個詞 → 放行。這種話擋下來才是害人。
      if(who === "other" || who === "none") return true;
      if(who === "unknown"){ notifyFamilyQuietly(text); return true; }
      // 本人想自傷：不唸出來，鎖定畫面並接到危機視窗（通知家人＋視訊＋1925／119）
      showLock(t("safety.lockedCrisis"));
      openCrisis();
    } else {
      // 拒絕治療類：同樣不唸，但不驚動家人
      showLock(t("safety.lockedRefusal"));
    }
    return false;
  }
  // 醫療／疼痛：先跳確認卡。已經是從確認卡按「對」進來的就別再跳一次，否則會無限迴圈。
  if(risk === "confirm" && !fromConfirmCard && state.settings.confirmCard){
    confirmThenSpeak(text);
    return false;
  }
  return true;
}

// ── 意圖確認大圖卡 ──
// AI 或圖卡組出句子後，先用大 emoji ＋大字問「是這個意思嗎？」，按「對」才唸出來。
// 對不識字的使用者，這是唯一能在發聲前攔下錯誤的一關。
let _pendingSpeak = "";
let rejectStreak = 0;              // 連續按「不對」的次數
const REJECT_LIMIT = 3;            // 連續 3 次 → 提議聯絡家人（同 App）

function comboText(){ return combo.map(c=>c.word).join(""); }

// 句中有強烈意圖卡（醫療／緊急）→ 額外標紅提醒確認
function comboHasStrong(){
  const ids = new Set(combo.map(c=>c.id).filter(Boolean));
  return allCards().some(c => ids.has(c.id) && c.strong);
}
function confirmThenSpeak(text){
  if(!text) return;
  // 鎖定級的句子連確認卡都不該出現——交給閘門處理（它會再問 AI 是不是替別人求救）
  if(classifyRisk(text) === "lock"){
    passesSpeechGate(text).then(ok=>{ if(ok) speak(text); });
    return;
  }
  if(!state.settings.confirmCard){ speak(text); return; }   // 設定可關（預設開）
  _pendingSpeak = text;
  const all = allCards();
  $("#confirmEmoji").textContent = combo.map(c=>{
    const hit = all.find(x=>x.id===c.id); return hit ? hit.emoji : "";
  }).join("").slice(0, 6) || "💬";
  $("#confirmText").textContent = text;
  $("#confirmWarn").classList.toggle("hidden", !comboHasStrong());
  const rj = $("#confirmReject");
  rj.classList.toggle("hidden", rejectStreak === 0);
  if(rejectStreak) rj.textContent = t("confirm.reject")
    .replace("{n}", rejectStreak).replace("{m}", REJECT_LIMIT - rejectStreak);
  $("#confirmDlg").classList.remove("hidden");
}
async function onConfirmReject(){
  $("#confirmDlg").classList.add("hidden");
  rejectStreak++;
  if(rejectStreak < REJECT_LIMIT) return;
  // 連續選錯 3 次：可能是 AI 一直組錯、或使用者狀況不對 → 提議聯絡家人
  rejectStreak = 0;
  if(confirm(t("confirm.alertTitle") + "\n\n" + t("confirm.alertBody"))) openCrisis();
}

// ── 快速求救：一鍵發聲 ──
// 直接唸，不經過意圖確認卡：這三句是使用者自己按的、內容固定，
// 急的時候多一關確認反而害事。
const QUICK_SOS = [["sos.pain","sos.painMsg"],["sos.water","sos.waterMsg"],["sos.toilet","sos.toiletMsg"]];
function renderQuickSos(){
  const box = $("#quickSos"); if(!box) return;
  box.innerHTML = QUICK_SOS.map(([k],i)=>
    `<button class="btn sos-btn" data-i="${i}">${escapeHtml(t(k))}</button>`).join("");
  // speakNow＝瀏覽器內建語音，不繞去電腦端合成。求救要的是立刻出聲，
  // 不是好聽——而且電腦沒開的時候專屬聲音根本合不出來。
  $$("#quickSos .sos-btn").forEach(b=>bindTap(b, ()=>{ markFirstSpeak(); speakNow(t(QUICK_SOS[+b.dataset.i][1])); }));
}

// ── 臨床常用題庫：不需 LLM 金鑰，離線可用 ──
function renderClinicalBank(onPick){
  const box = $("#rehabBank"); if(!box) return;
  // 題目跟著介面語言走：英文介面就練英文句子（辨識也是英文，見 speech.js 的 rec.lang）。
  // 顯示的字和送去練習的字是同一個字串，不然唸的跟比對的不一樣，分數會永遠是 0。
  box.innerHTML = CLINICAL_BANK.map((g,gi)=>
    `<div style="margin-top:8px"><div class="tiny muted">${escapeHtml(t(g.key))}</div>
      <div class="chips" style="margin-top:4px">${g.items.map((s,i)=>
        `<span class="chip" data-g="${gi}" data-i="${i}">${escapeHtml(practiceItem(s))}</span>`
      ).join("")}</div></div>`).join("");
  $$("#rehabBank .chip").forEach(c=>bindTap(c, ()=>
    onPick(practiceItem(CLINICAL_BANK[+c.dataset.g].items[+c.dataset.i])), 250));
}

// ── 歷史 ──
async function renderHistory(){
  const list = await listHistory();
  $("#historyList").innerHTML = list.length ? list.map(h=>`
    <div class="hitem"><div class="h-main">${escapeHtml(h.reconstructed||"")}</div>
    <div class="h-sub">${escapeHtml(h.original||"")} · ${new Date(h.ts).toLocaleString()}</div></div>`).join("")
    : `<p class="tiny muted center">${t("history.empty")}</p>`;
  $$("#historyList .hitem").forEach((el,i)=>el.addEventListener("click",()=>speak(list[i].reconstructed||"")));
}
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ── 其他按鈕 ──
function setupActions(){
  $("#btnCompose").addEventListener("click", doCompose);
  $("#btnAlt").addEventListener("click", ()=>{ recordUndo(); cycleAlt(); });
  // 「更多」展開／收起次要動作
  $("#btnMore").addEventListener("click", ()=>{
    const box = $("#moreActions");
    const open = box.classList.toggle("hidden") === false;
    $("#btnMore").textContent = open ? t("btn.less") : t("btn.more");
  });
  $("#btnSpeak").addEventListener("click", async ()=>{
    if(!await passesSpeechGate(lastResult)) return;
    markFirstSpeak();
    recordInputSource(false);                 // 這條路徑是打字／語音輸入
    recordCandidateChoice(altIndex === 0);    // 還停在第一候選＝AI 一次就命中
    speak(lastResult, { safetyChecked: crisisCleared });
  });
  $("#btnRegen").addEventListener("click", doCompose);
  $("#btnImg").addEventListener("click", async ()=>{
    if(!lastResult) return;
    const img = $("#resultImg"); img.src = await generateImage(intentPrompt(lastResult));
    img.classList.remove("hidden");
  });
  // 複製 / 分享 / 收藏 / 多語朗讀
  $("#btnCopy")?.addEventListener("click", ()=>{ if(lastResult){ navigator.clipboard.writeText(lastResult); toast(t("toast.copied")); } });
  $("#btnShare")?.addEventListener("click", async ()=>{
    if(!lastResult) return;
    if(navigator.share){ try{ await navigator.share({ text:lastResult }); }catch{} }
    else { navigator.clipboard.writeText(lastResult); toast(t("toast.copiedNoShare")); }
  });
  $("#btnFav")?.addEventListener("click", ()=>{ if(lastResult){ const added = toggleFavorite(lastResult); toast(added?t("toast.favAdded"):t("toast.favRemoved")); renderFavorites(); } });
  $$(".lang-btn").forEach(b=>b.addEventListener("click", ()=>{ if(lastResult) speakIn(lastResult, b.dataset.lang); }));
  $("#btnLoc").addEventListener("click", async ()=>{
    toast(t("toast.locating"));
    try{ const l = await detectLocation(); ctxText = (ctxText?ctxText+"；":"")+(t("ctx.loc")+l);
      // 地點也給圖卡推薦排序當情境（醫療卡在醫院會浮上來）
      state.settings.currentLocationTag = l; save(); $("#ctx").textContent="📍 "+l; }
    catch(e){ toast(t("toast.locateFail")+(e.message||e)); }
  });
  // 麥克風
  let mic=null;
  $("#btnMic").addEventListener("click", ()=>{
    if(mic){ mic.stop(); mic=null; $("#btnMic").textContent=t("btn.mic"); return; }
    if(!sttSupported()){ toast(t("toast.sttUnsupported")); return; }
    $("#btnMic").textContent=t("mic.recording");
    mic = listen({
      onResult:(t)=>{ $("#fragments").value = t; },
      onEnd:()=>{ mic=null; $("#btnMic").textContent=t("btn.mic"); },
      onError:(e)=>{ toast(t("toast.sttPrefix")+e); mic=null; $("#btnMic").textContent=t("btn.mic"); }
    });
  });
  $("#btnLogout").addEventListener("click", logout);
  // 求救鈕：按下去會真的發 Telegram 給家人，誤觸成本高，所以先問一次再開。
  // 防誤觸用二次確認、不用長按——interaction.js 已說明長按對手抖使用者是障礙。
  bindTap($("#btnSos"), ()=>{
    if(confirm(t("sos.confirmTitle") + "\n\n" + t("sos.confirmBody"))) sos();
  });
  // SOS 快捷：1.5 秒內連按 3 次 Escape 才觸發（單按太容易誤觸——關對話框/退全螢幕都會誤發通報）
  let escPresses = [];
  document.addEventListener("keydown", e=>{
    if(e.key!=="Escape") return;
    const now = Date.now();
    escPresses = escPresses.filter(ts=>now-ts<1500);
    escPresses.push(now);
    if(escPresses.length>=3){ escPresses=[]; sos(); }
  });
}
function sos(){ openCrisis(); }

// ── 登入流程 ──
function showLogin(){ $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
let _user = null;
// 顯示名在「渲染時」才翻譯（不是登入當下），否則切語言後這行會卡在舊語言
function renderWho(){
  if(!_user) return;
  $("#who").textContent = _user.uid==="local" ? t("user.local")
                        : (_user.name || (_user.anon ? t("user.anon") : ""));
}
function showApp(user){
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  _user = user; renderWho();
  applyTheme(); applyI18n(state.settings.lang); fillSettings(); renderFavorites();
  // 雲端設定載入後重繪 AAC：帳號裡的字級/自訂圖卡/「📷 我的」分類才會立即出現。
  // renderCombo 也要在這裡重跑一次——setupAac() 在登入完成前就先畫過一次，
  // 那時 applyI18n 還沒跑，組合區的空狀態會卡在預設的中文。
  preloadZhConv();   // 簡繁對照表：背景載入，第一次重組時就有得用
  // 開了「讓電腦幫忙跑運算」就自動偵測一次，不要等使用者按「偵測連線」。
  //
  // 原本 detectLocalTts() 只掛在那顆按鈕上，所以設定明明開著、角色語音也選好了，
  // 只要沒手動按過偵測，朗讀出來的還是瀏覽器機械音——而且每次重新整理都會退回去。
  // 生圖與文字重組的「電腦幫忙跑」也一樣（localHas 要偵測過才會是 true）。
  // 背景跑、失敗就安靜略過：連不上本來就會自動退回雲端／瀏覽器語音。
  if(localComputeEnabled()) refreshLocalVoices().catch(()=>{});

  renderAac(); renderCombo(); renderCcList(); renderQuickSos(); setupCrisis();
  setStoryToast(toast); setupStory();
  setupHeadControl(msg=>{ const el=$("#headStatus"); if(el) el.textContent = msg; });
  // 臨床題庫點一下＝填進目標句欄位並捲到練習區
  renderClinicalBank(s=>{ const inp=$("#rehabTarget"); if(!inp) return;
    inp.value = s; $('.tab[data-tab="rehab"]')?.click();
    $("#rehabStart")?.scrollIntoView({ behavior:"smooth", block:"center" }); });
  restoreLastTab();   // 回到上次使用的分頁
  // 上次是重症防呆模式 → 開頁直接回到全螢幕圖卡（長輩重新整理也不會迷路）
  if(state.settings.severityMode === "severe") enterKiosk();
  else if(state.settings.severityMode === "moderate") document.body.classList.add("sev-moderate");
}

function renderFavorites(){
  const card = $("#favCard"), list = $("#favList");
  if(!card || !list) return;
  const favs = state.favorites || [];
  if(!favs.length){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  list.innerHTML = favs.map(f=>`<span class="chip on">${escapeHtml(f)}</span>`).join("");
  list.querySelectorAll(".chip").forEach((el,i)=>el.addEventListener("click",()=>speak(favs[i])));
}

function main(){
  applyI18n(state.settings.lang);   // 登入畫面也先翻譯
  setupTabs(); setupActions(); setupAac(); setupCamera(); setupAudioDirect(); bindSettings();
  setupDemo();                      // 自動演示面板（要在 setupSettingsSubpages 之前：索引是從既有卡片掃出來的）
  setupSettingsSubpages();          // 設定索引（要在 applyI18n 之後：每一列都取自 h3 的譯文）
  setupKiosk({ onExit: ()=>toast(t("care.exited")) });
  setRehabToast(toast); setReportToast(toast); setSpeechToast(toast);
  setupRehab(); setupReport();
  // 這裡**不能**偵測電腦運算：這一段跑在登入之前，state.settings 還是 DEFAULTS，
  // localTtsEnabled 永遠讀到 false，於是「開機自動偵測」看起來有做、實際從來沒觸發過。
  // 真正的偵測放在 showApp()（設定載入完之後）。
  // 登入按鈕要防連點：Firebase 在前一個彈窗還開著時又收到一個，會把前一個取消掉
  // 並丟 auth/cancelled-popup-request。而畫面上原本直接把那串原文貼給使用者看——
  // 「Firebase: Error (auth/cancelled-popup-request).」對照顧者是完全無法理解的。
  const bindLogin = (sel, fn) => {
    const btn = $(sel);
    if(!btn) return;
    btn.addEventListener("click", async ()=>{
      if(btn.disabled) return;
      btn.disabled = true;
      $("#loginErr").textContent = "";
      try{ await fn(); }
      catch(e){
        // 關掉彈窗／連點兩下不是失敗，安靜就好，不要留一行紅字嚇他
        $("#loginErr").textContent = isBenignAuthError(e) ? "" : authErrorText(e);
      }
      finally{ btn.disabled = false; }
    });
  };
  bindLogin("#btnGoogle", loginGoogle);
  bindLogin("#btnAnon", loginAnon);

  initAuth({
    onUser:(u)=>{
      if(u){
        showApp(u);
        // 登入之後才讀得到雲端樣板。不 await——這是背景工作，
        // 不該讓整個畫面等 Drive 回來（沒網路時那是好幾秒）。

      } else showLogin();
    },
    onSaved:(msg)=>{ const el=$("#saveState"); if(el) el.textContent=t(msg); }
  });
}
main();



function authErrorText(e){
  const code = String((e && (e.code || e.message)) || "");
  if(/popup-blocked/i.test(code))            return t("auth.popupBlocked");
  if(/network-request-failed/i.test(code))   return t("auth.network");
  if(/unauthorized-domain/i.test(code))      return t("auth.badDomain");
  if(/operation-not-allowed/i.test(code))    return t("auth.notEnabled");
  if(/too-many-requests/i.test(code))        return t("auth.tooMany");
  return t("auth.generic") + code;
}

function setShortcutMsg(text){
  const el = $("#shortcutMsg");
  if(el) el.textContent = text || "";
}

// 跟 escapeHtml 同一件事，但原本這支用 String(s) 而不是 String(s??"")——
// 錯誤物件沒有 message 時（例如 `throw 0`）畫面上會出現一行「undefined」。
function esc(s){ return escapeHtml(s); }

// 引號跟著語言走：「」在英文介面裡看起來就是跑錯字型的中文標點
function quote(s){
  const cjk = /^(zh|ja|ko)/.test(document.documentElement.getAttribute("data-lang") || "zh-TW");
  return cjk ? `「${s}」` : `“${s}”`;
}

function setupShortcuts(){
  const btn = $("#addShortcut");
  if(!btn) return;
  btn.addEventListener("click", async ()=>{
    const kw = $("#sc_keyword").value;
    const ph = $("#sc_phrase").value;
    try{
      await saveShortcut({ keyword: kw, spokenPhrase: ph });
      $("#sc_keyword").value = ""; $("#sc_phrase").value = "";
      setShortcutMsg(t("set.shortcutSaved"));

    }catch(e){ setShortcutMsg(e.message); }
  });
  // Enter 直接送出：照顧者要連續打很多句，每次都要移到按鈕很慢
  ["#sc_keyword", "#sc_phrase"].forEach(sel=>{
    const el = $(sel);
    if(el) el.addEventListener("keydown", e=>{
      if(e.key === "Enter"){ e.preventDefault(); btn.click(); }
    });
  });

}

// ── 我的專屬聲音（Drive 上的語音模型）──────────────────────
//
// 直接讀 Drive，不透過電腦端的語音服務——電腦不一定開著，而「我有哪些聲音」
// 這個問題不需要 GPU 也答得出來。合成仍然在電腦或 Colab 上跑。
function fmtBytes(n){
  if(!n) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * 「現在讀的是誰的雲端硬碟」＋一顆換帳號的按鈕。
 *
 * 這是「Drive 上還沒有語音模型」最常見、也最看不出來的原因：一個人有兩個
 * Google 帳號很平常，而 drive.file 只看得到本 App 在**這個帳號**建立的檔案。
 * 登錯帳號時那句話本身沒有錯（這個帳號確實沒有），但他看著另一個帳號裡滿滿的
 * 資料夾，只會覺得東西不見了。講出信箱，一秒就看得出是不是登錯。
 *
 * 按鈕是動態產生的，**不能靠 data-i18n**：applyI18n 只在切語言時掃一次 DOM，
 * 那時這顆還不存在。組 HTML 時就要呼叫 t()。
 */
function accountLineHtml(){
  const mail = accountEmail();
  if(!mail) return "";
  return `<p class="tiny muted" style="opacity:.75;margin-top:6px">${
      esc(t("set.voicesAccount").replace("{email}", mail))}
    <button id="btnSwitchAccount" class="btn ghost" style="margin-left:6px"
      >${esc(t("set.voicesSwitchAccount"))}</button></p>`;
}

/**
 * 情緒標籤照介面語言顯示成繁體。
 *
 * 這些字直接來自 Drive 上的參考音檔名（【开心】…），而曲庫多半是用簡體工具
 * 建的，所以清單會冒出「厌恶・吃惊・开心」。使用者選的是繁體介面，卻在
 * 自己的聲音底下看到一排簡體字——只有顯示要轉，Drive 上的檔名不動
 * （那是三端比對用的鍵，改了就對不上）。
 */
function zhDisp(s){
  return I18N_LANG_IS_TW() ? toTraditionalSync(String(s ?? "")) : String(s ?? "");
}
const I18N_LANG_IS_TW = () => (state.settings.lang || "").startsWith("zh");

/** 重新授權 Drive。錯誤與空狀態兩條路都會放這顆，所以抽出來共用。 */
function bindDriveReauth(){
  $("#btnDriveReauth")?.addEventListener("click", async (ev)=>{
    const b = ev.currentTarget;
    if(b.disabled) return;
    b.disabled = true;
    try{ await reauthorizeDrive(); await renderVoices(); }
    catch(err){ if(!isBenignAuthError(err)) toast(authErrorText(err)); b.disabled = false; }
  });
}

function bindSwitchAccount(){
  $("#btnSwitchAccount")?.addEventListener("click", async (ev)=>{
    const b = ev.currentTarget;
    if(b.disabled) return;
    b.disabled = true;
    try{ await switchAccount(); }
    catch(err){ if(!isBenignAuthError(err)) toast(authErrorText(err)); b.disabled = false; }
  });
}

async function renderVoices(){
  const box = $("#voiceList");
  if(!box) return;
  box.innerHTML = `<p class="tiny muted">${t("set.voicesLoading")}</p>`;
  let list;
  try{
    list = await listVoices();
  }catch(e){
    // 三種失敗要說三種話。全部畫成「還沒有語音模型」的話，
    // 一個明明錄好了聲音的人會以為自己的東西不見了。
    //
    // 「沒有 Drive 權杖」的情況要特別處理：Firebase 登入狀態存在 IndexedDB
    // （關掉分頁還在），Drive token 存在 sessionStorage（關掉分頁就沒了），
    // 所以重開瀏覽器之後使用者是「已登入但沒有權杖」——畫面不會跳登入頁，
    // 而這裡卻叫他「重新登入」。他登入著，這句話對他是矛盾的。
    // 給一顆就地重新授權的按鈕，不要叫他登出再登入。
    const needsAuth = e.message === "noDrive" || e.message === "driveExpired";
    const msg = needsAuth
      ? (needsDriveReauth() ? t("set.voicesNeedAuth") : t("set.voicesNoDrive"))
      : esc(e.message);
    box.innerHTML = `<p class="tiny muted">${msg}</p>` +
      // 這顆按鈕是動態產生的，**不能靠 data-i18n**：applyI18n 只在切語言時
      // 掃一次 DOM，那時這顆還不存在，於是它會永遠停在寫死的中文。
      // 動態內容一律在組 HTML 時就呼叫 t()（renderVoices 本身有掛在切語言的重繪清單裡）。
      (needsAuth ? `<button id="btnDriveReauth" class="btn ghost" style="margin-top:6px"
                      >${esc(t("set.voicesReauth"))}</button>` : "") +
      accountLineHtml();
    bindSwitchAccount();
    bindDriveReauth();
    return;
  }
  if(!list.length){
    // 「還沒有語音模型」對一個明明看得到那些資料夾就在 Drive 上的人，
    // 是一句沒有用的話。空清單有四種完全不同的原因，畫面上卻長得一模一樣——
    // 這裡把實際走到哪一步、看到哪些資料夾講出來，他才知道要去修哪裡。
    // 一次組完再寫進去。innerHTML += 會把整段重新解析，之前掛上去的事件監聽
    // 全部消失——換帳號按鈕會變成按了沒反應的裝飾品。
    const parts = [`<p class="tiny muted">${t("set.voicesEmpty")}</p>`];
    // 這一條要排在最前面，而且**先於任何診斷**：權限不夠時，底下走資料夾看到的
    // 一切都是殘缺的（別的程式建立的檔案在這個權杖眼中根本不存在），
    // 那些描述只會把人帶去修沒有壞的東西。
    if(needsScopeUpgrade()){
      parts.push(`<p class="tiny muted" style="opacity:.75">${esc(t("set.voicesScopeUpgrade"))}
        <button id="btnDriveReauth" class="btn ghost" style="margin-left:6px"
          >${esc(t("set.voicesReauth"))}</button></p>`);
    }
    try{
      const drive = await import("./drive.js?v=1.5.49");
      const d = await drive.diagnoseVoiceModels();
      // 同名根要先講。有兩個 VoiceWeaver 時，底下那些「沒有 Models」之類的
      // 描述全部都是在講錯的那一個資料夾，先看到它才不會被帶去修錯的地方。
      if(d.roots > 1){
        parts.push(`<p class="tiny muted" style="opacity:.75">${
          esc(t("set.diagDupRoot").replace("{n}", String(d.roots)))}</p>`);
      }
      // 「VoiceWeaver 底下只有 AcousticModels」＝這個資料夾裡只有本 App 自己寫過的東西。
      // 這幾乎一定是登錯 Google 帳號：曲庫在另一個帳號，而 drive.file 看不到它。
      // 泛用的「沒有 Models 資料夾」會把人帶去檢查資料夾結構，方向就錯了。
      const onlyOurs = d.step === "noModels" && d.rootKids.length > 0 &&
        d.rootKids.every(n => n.toUpperCase() === "ACOUSTICMODELS");
      const line =
        d.step === "noRoot"   ? t("set.diagNoRoot").replace("{name}", d.root)
      : onlyOurs              ? t("set.diagWrongAccount")
      : d.step === "noModels" ? t("set.diagNoModels").replace("{name}", "VoiceWeaver").replace("{kids}", d.rootKids.join("、") || "—")
      : d.step === "legacy"   ? t("set.diagLegacy").replace("{langs}", d.legacy.join("、"))
      : d.chars.length        ? t("set.diagHasChars").replace("{chars}", d.chars.slice(0,8).join("、"))
      : d.catalog             ? t("set.diagCatalogOnly").replace("{n}", String(d.catalog))
      : d.langs.length        ? t("set.diagEmptyLang").replace("{langs}", d.langs.join("、"))
      :                         t("set.diagEmptyModels").replace("{kids}", d.modelKids.join("、") || "—");
      parts.push(`<p class="tiny muted" style="opacity:.75">${esc(line)}</p>`);
    }catch{ /* 診斷失敗就算了，第一句已經說明狀況 */ }
    // 帳號放最後：上面幾句解釋了「這個帳號裡沒有」，這句回答「那這是哪個帳號」，
    // 而換帳號正是接下來最可能要做的事。
    parts.push(accountLineHtml());
    box.innerHTML = parts.join("");
    bindSwitchAccount();
    bindDriveReauth();
    return;
  }
  box.innerHTML = list.map(v=>`
    <div class="row" style="align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--sep,#eee)">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px">${esc(v.character)} <span class="tiny muted">${esc(v.lang)}</span></div>
        <div class="tiny" style="color:var(--accent,#007AFF)">
          ${v.emotions.map(e=>esc(zhDisp(e))).join("・") || "—"}
        </div>
        ${v.ready ? "" : `<div class="tiny muted">${t("set.voicesNeedsFix")}</div>`}
        ${v.fromCatalog ? `<div class="tiny muted">${t("set.voicesFromCatalog")}</div>` : ""}
      </div>
      <div class="tiny muted">${fmtBytes(v.bytes)}</div>
    </div>`).join("");
}

// 沒有「重新讀取」按鈕是刻意的：切進設定頁就會自動重讀（見 setupTabs），
// 使用者不該為了看到最新狀態去按一顆按鈕——他多半也想不到要按。
function setupVoices(){
  renderVoices().catch(()=>{});
}
