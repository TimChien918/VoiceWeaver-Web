import { state, newId, initAuth, loginGoogle, loginAnon, logout, save, addHistory, listHistory, toggleFavorite, ensurePairCode, pushNgrokBridge } from "./store.js?v=1.4.2";
import { LLM_PROVIDERS, IMAGE_PROVIDERS } from "./providers.js?v=1.4.2";
import { reconstruct, composeAac, hasAnyLlmKey } from "./llm.js?v=1.4.2";
import { speak, speakIn, listen, sttSupported, setSpeechToast } from "./speech.js?v=1.4.2";
import { AAC_CATS, CAT_EMOJI, cardsOfCat, allCards, searchCards, CURRENCIES } from "./aac.js?v=1.4.2";
import { feed as rankFeed, rankWithin, recordUse, activeItemCount } from "./aacrank.js?v=1.4.2";
import { setupKiosk, enterKiosk } from "./kiosk.js?v=1.4.2";
import { bindTap } from "./interaction.js?v=1.4.2";
import { orderCards } from "./predict.js?v=1.4.2";
import { CLINICAL_BANK } from "./clinical.js?v=1.4.2";
import { markFirstSpeak, recordCandidateChoice, recordUndo, recordInputSource } from "./behavior.js?v=1.4.2";
import { openCrisis, setupCrisis } from "./crisis.js?v=1.4.2";
import { setupStory, renderStory, setStoryToast } from "./story.js?v=1.4.2";
import { setupHeadControl, stopHeadControl } from "./headcontrol.js?v=1.4.2";
import { generateImage, intentPrompt, detectLocation, recognizePhoto, telegramNotify } from "./extras.js?v=1.4.2";
import { setupRehab, renderRehabLogs, setRehabToast } from "./rehab.js?v=1.4.2";
import { setupReport, loadReport, setReportToast } from "./report.js?v=1.4.2";
import { detectLocalTts, localVoices, localSwitch, localCatalog, localPrepare } from "./localtts.js?v=1.4.2";
import { applyI18n, t } from "./i18n.js?v=1.4.2";

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
let ctxText = "";          // 地點 / 相機辨識附加情境
let lastResult = "";

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.add("hidden"),2200); }

// ── 主題 / 字體 ──
function applyTheme(){
  const el = document.documentElement;
  const t = state.settings.theme;
  if(t==="auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
  // 視覺風格（科技／可愛／動漫／簡約，同 App）。風格自帶深淺，所以套了風格
  // 就不再讓 data-theme 決定底色——只有「科技風」以外才需要標記。
  const style = state.settings.style || "tech";
  el.setAttribute("data-style", style);
  if(style !== "tech") el.removeAttribute("data-theme");
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
        `<div style="font-weight:600">${escapeHtml(c.character||c.name)}${tag?`<span class="tiny muted"> ${tag}</span>`:""}</div>`+
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
    renderStory();                            // 故事題目與提示字
    renderCcList();                           // 自訂圖卡的空狀態文字
    renderProviderList("#llmList", "llmApis", LLM_PROVIDERS);   // 供應商清單的空狀態／免金鑰標示
    renderProviderList("#imgList", "imageApis", IMAGE_PROVIDERS);
    renderClinicalBank(s=>{ const inp=$("#rehabTarget"); if(inp){ inp.value=s; $('.tab[data-tab="rehab"]')?.click(); } });
    renderAac();                              // AAC 分類 chip（「我的」分類名要跟著翻）
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

function renderAltButton(){
  const btn = $("#btnAlt");
  if(!btn) return;
  if(altList.length <= 1){ btn.classList.add("hidden"); return; }
  btn.classList.remove("hidden");
  const last = altIndex >= altList.length - 1;
  btn.textContent = last
    ? t("btn.regenerate")
    : t("btn.nextAlt").replace("%1", altIndex + 1).replace("%2", altList.length);
}

function showAlt(i){
  altIndex = i;
  lastResult = altList[i].text;
  $("#resultText").textContent = lastResult;
  renderAltButton();
}

async function cycleAlt(){
  if(altIndex >= altList.length - 1){ await doCompose(); return; }  // 都不對 → 重新生成
  showAlt(altIndex + 1);
  speak(lastResult);
}

async function doCompose(){
  const frag = $("#fragments").value.trim();
  if(!frag){ toast(t("toast.enterFragments")); return; }
  if(!hasAnyLlmKey()){ toast(t("toast.needLlm")); return; }
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
    renderAltButton();
    addHistory({ original: frag + (ctxText?(" | "+ctxText):""), reconstructed: lastResult });
    speak(lastResult);
  }catch(e){ toast(t("toast.composeFail") + (e.message||e)); }
  finally{ $("#btnCompose").disabled=false; $("#btnCompose").textContent=t("btn.compose"); }
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
  bindTap($("#confirmYes"), ()=>{
    $("#confirmDlg").classList.add("hidden");
    recordCandidateChoice(rejectStreak === 0);   // 沒退過＝第一候選就對
    rejectStreak = 0;
    if(_pendingSpeak){ markFirstSpeak(); recordInputSource(true); speak(_pendingSpeak); }
  });
  bindTap($("#confirmNo"), onConfirmReject);
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
  $$("#quickSos .sos-btn").forEach(b=>bindTap(b, ()=>{ markFirstSpeak(); speak(t(QUICK_SOS[+b.dataset.i][1])); }));
}

// ── 臨床常用題庫：不需 LLM 金鑰，離線可用 ──
function renderClinicalBank(onPick){
  const box = $("#rehabBank"); if(!box) return;
  box.innerHTML = CLINICAL_BANK.map((g,gi)=>
    `<div style="margin-top:8px"><div class="tiny muted">${escapeHtml(t(g.key))}</div>
      <div class="chips" style="margin-top:4px">${g.items.map((s,i)=>
        `<span class="chip" data-g="${gi}" data-i="${i}">${escapeHtml(s)}</span>`).join("")}</div></div>`).join("");
  $$("#rehabBank .chip").forEach(c=>bindTap(c, ()=>
    onPick(CLINICAL_BANK[+c.dataset.g].items[+c.dataset.i]), 250));
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
  $("#btnSpeak").addEventListener("click", ()=>{
    markFirstSpeak();
    recordInputSource(false);                 // 這條路徑是打字／語音輸入
    recordCandidateChoice(altIndex === 0);    // 還停在第一候選＝AI 一次就命中
    speak(lastResult);
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
  // 雲端設定載入後重繪 AAC：帳號裡的字級/自訂圖卡/「📷 我的」分類才會立即出現
  renderAac(); renderCcList(); renderQuickSos(); setupCrisis();
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
  setupTabs(); setupActions(); setupAac(); setupCamera(); bindSettings();
  setupKiosk({ onExit: ()=>toast(t("care.exited")) });
  setRehabToast(toast); setReportToast(toast); setSpeechToast(toast);
  setupRehab(); setupReport();
  // 已啟用本地語音 → 背景偵測一次，讓引擎就緒（連不上不影響其他功能）
  if(state.settings.localTtsEnabled) refreshLocalVoices().catch(()=>{});
  $("#btnGoogle").addEventListener("click", async ()=>{ try{ await loginGoogle(); }catch(e){ $("#loginErr").textContent=e.message||e; } });
  $("#btnAnon").addEventListener("click", async ()=>{ try{ await loginAnon(); }catch(e){ $("#loginErr").textContent=e.message||e; } });

  initAuth({
    onUser:(u)=>{ if(u) showApp(u); else showLogin(); },
    onSaved:(msg)=>{ const el=$("#saveState"); if(el) el.textContent=t(msg); }
  });
}
main();
