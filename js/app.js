import { state, newId, initAuth, loginGoogle, loginAnon, logout, save, addHistory, listHistory, toggleFavorite, ensurePairCode, pushNgrokBridge } from "./store.js";
import { LLM_PROVIDERS, IMAGE_PROVIDERS } from "./providers.js";
import { reconstruct, composeAac, hasAnyLlmKey } from "./llm.js";
import { speak, speakIn, listen, sttSupported } from "./speech.js";
import { AAC, AAC_CATS } from "./aac.js";
import { generateImage, intentPrompt, detectLocation, recognizePhoto, telegramNotify } from "./extras.js";
import { setupRehab, renderRehabLogs, setRehabToast } from "./rehab.js";
import { setupReport, loadReport, setReportToast } from "./report.js";
import { detectLocalTts, localVoices, localSwitch } from "./localtts.js";
import { applyI18n, t } from "./i18n.js";

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
let ctxText = "";          // 地點 / 相機辨識附加情境
let lastResult = "";

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.add("hidden"),2200); }

// ── 主題 / 字體 ──
function applyTheme(){
  const t = state.settings.theme;
  if(t==="auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.setProperty("--font", (state.settings.font||1)+"rem");
}

// ── 設定 UI 綁定 ──
function fillSettings(){
  $("#k_tgtoken").value = state.apiKeys.tgtoken;
  $("#k_tgchat").value = state.apiKeys.tgchat;
  $("#s_theme").value = state.settings.theme;
  $("#s_lang").value = state.settings.lang;
  $("#s_rate").value = state.settings.rate; $("#rateVal").textContent = state.settings.rate+"x";
  $("#s_font").value = state.settings.font; $("#fontVal").textContent = state.settings.font+"x";
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
  sel.innerHTML = voices.map(v=>{
    const val = `${v.name}|${v.lang}`;
    return `<option value="${escapeHtml(val)}" ${val===cur?"selected":""}>${escapeHtml(v.name)}（${escapeHtml(v.lang||"?")}）</option>`;
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

function addCloudServer(){
  const inp = $("#lt_url");
  let url = (inp.value||"").trim().replace(/\/+$/,"");
  if(!url){ toast(t("lt.enterUrl")); return; }
  if(!/^https?:\/\//i.test(url)) url = "https://" + url;   // 沒打協定自動補
  if(!Array.isArray(state.settings.localComputeServers)) state.settings.localComputeServers = [];
  if(state.settings.localComputeServers.some(s=>s.url===url)){ toast(t("lt.dupCloud")); return; }
  const n = state.settings.localComputeServers.length + 1;
  state.settings.localComputeServers.push({ name: t("lt.cloudN").replace("{n}", n), url });
  inp.value = ""; save(); renderCloudList();
  toast(t("lt.cloudAdded"));
  refreshLocalVoices().catch(()=>{});
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
    status.textContent = t("lt.connected").replace("{host}",host).replace("{caps}",caps).replace("{lang}",appLangToVoiceTag(state.settings.lang));
  } else {
    _cachedVoices = null;
    sel.innerHTML = `<option value="">${t("lt.voiceSvcDown")}</option>`;
    status.textContent = t("lt.connectedNoVoice").replace("{host}",host).replace("{caps}",caps);
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
    save(); });
  $("#s_rate").addEventListener("input", e=>{ state.settings.rate=+e.target.value; $("#rateVal").textContent=e.target.value+"x"; save(); });
  $("#s_font").addEventListener("input", e=>{ state.settings.font=+e.target.value; $("#fontVal").textContent=e.target.value+"x"; applyTheme(); save(); });
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
    $("#ng_domain").addEventListener("change", e=>{ state.apiKeys.ngrokDomain = e.target.value.trim(); pushNgrok(); });
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
    if(t.dataset.tab==="history") renderHistory();
    if(t.dataset.tab==="rehab") renderRehabLogs();
    if(t.dataset.tab==="report") loadReport();
  }));
}

// ── 重組 ──
async function doCompose(){
  const frag = $("#fragments").value.trim();
  if(!frag){ toast(t("toast.enterFragments")); return; }
  if(!hasAnyLlmKey()){ toast(t("toast.needLlm")); return; }
  $("#btnCompose").disabled = true; $("#btnCompose").textContent = t("btn.composing");
  try{
    lastResult = await reconstruct(frag, ctxText);
    $("#resultText").textContent = lastResult;
    $("#result").classList.remove("hidden");
    $("#resultImg").classList.add("hidden");
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
      if(items){ ctxText = ("看到："+items); $("#ctx").textContent = "📷 "+items; toast(t("toast.recognized")); }
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
let aacCat = AAC_CATS[0];
const combo = [];
function renderAac(){
  $("#aacCats").innerHTML = AAC_CATS.map(c=>`<span class="chip ${c===aacCat?'on':''}" data-c="${c}">${c}</span>`).join("");
  $$("#aacCats .chip").forEach(ch=>ch.addEventListener("click",()=>{ aacCat=ch.dataset.c; renderAac(); }));
  $("#aacItems").innerHTML = AAC[aacCat].map(([e,w])=>`<div class="acard" data-w="${w}"><span class="emoji">${e}</span>${w}</div>`).join("");
  $$("#aacItems .acard").forEach(a=>a.addEventListener("click",()=>{ combo.push(a.dataset.w); renderCombo(); speak(a.dataset.w); }));
}
function renderCombo(){
  $("#aacCombo").innerHTML = combo.map((w,i)=>`<span class="chip on" data-i="${i}">${w} ✕</span>`).join("") || `<span class="tiny muted">${t("combo.empty")}</span>`;
  $$("#aacCombo .chip").forEach(c=>c.addEventListener("click",()=>{ combo.splice(+c.dataset.i,1); renderCombo(); }));
}
function setupAac(){
  renderAac(); renderCombo();
  $("#aacSpeak").addEventListener("click", ()=>{ if(combo.length) speak(combo.join("，")); });
  $("#aacClear").addEventListener("click", ()=>{ combo.length=0; renderCombo(); });
  $("#aacCompose").addEventListener("click", async ()=>{
    if(!combo.length){ toast(t("toast.pickCards")); return; }
    if(!hasAnyLlmKey()){ toast(t("toast.needLlmCompose")); return; }
    toast(t("toast.composing"));
    try{ const s = await composeAac(combo, ctxText); speak(s);
      $("#fragments").value = s; toast(t("toast.composed"));
      addHistory({ original:"AAC: "+combo.join("+"), reconstructed:s });
    }catch(e){ toast(t("toast.aacFail")+(e.message||e)); }
  });
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
  $("#btnSpeak").addEventListener("click", ()=>speak(lastResult));
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
    try{ const l = await detectLocation(); ctxText = (ctxText?ctxText+"；":"")+("地點："+l); $("#ctx").textContent="📍 "+l; }
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
async function sos(){
  try{ await telegramNotify(lastResult || "我需要協助"); toast(t("toast.sosSent")); }
  catch(e){ toast(t("toast.sosFail")+(e.message||e)); }
}

// ── 登入流程 ──
function showLogin(){ $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp(user){
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#who").textContent = user.uid==="local" ? t("user.local") : (user.name || "");
  applyTheme(); applyI18n(state.settings.lang); fillSettings(); renderFavorites();
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
  setRehabToast(toast); setReportToast(toast);
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
