import { state, newId, initAuth, loginGoogle, loginAnon, logout, save, addHistory, listHistory, watchHistory, refreshCloud } from "./store.js";
import { LLM_PROVIDERS, IMAGE_PROVIDERS } from "./providers.js";
import { reconstruct, composeAac, hasAnyLlmKey } from "./llm.js";
import { speak, listen, sttSupported } from "./speech.js";
import { AAC, AAC_CATS } from "./aac.js";
import { generateImage, intentPrompt, detectLocation, recognizePhoto, telegramNotify } from "./extras.js";
import { setupRehab } from "./rehab.js";

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
}
function bindSettings(){
  $("#k_tgtoken").addEventListener("input", e=>{ state.apiKeys.tgtoken=e.target.value.trim(); save(); });
  $("#k_tgchat").addEventListener("input", e=>{ state.apiKeys.tgchat=e.target.value.trim(); save(); });
  $("#s_theme").addEventListener("change", e=>{ state.settings.theme=e.target.value; applyTheme(); save(); });
  $("#s_lang").addEventListener("change", e=>{ state.settings.lang=e.target.value; save(); });
  $("#s_rate").addEventListener("input", e=>{ state.settings.rate=+e.target.value; $("#rateVal").textContent=e.target.value+"x"; save(); });
  $("#s_font").addEventListener("input", e=>{ state.settings.font=+e.target.value; $("#fontVal").textContent=e.target.value+"x"; applyTheme(); save(); });
  $("#addLlm").addEventListener("click", ()=>{ state.llmApis.push({id:newId(),provider:Object.keys(LLM_PROVIDERS)[0],key:"",model:""}); save(); renderProviderList("#llmList","llmApis",LLM_PROVIDERS); });
  $("#addImg").addEventListener("click", ()=>{ state.imageApis.push({id:newId(),provider:"pollinations",key:"",model:""}); save(); renderProviderList("#imgList","imageApis",IMAGE_PROVIDERS); });
}

// 多供應商/多金鑰清單：供應商下拉 + 金鑰欄 + 刪除
function renderProviderList(containerId, listKey, catalog){
  const box = $(containerId); const list = state[listKey] || [];
  if(!list.length){ box.innerHTML = '<p class="tiny muted">尚未新增，點下方按鈕加入。</p>'; return; }
  const opts = (sel)=>Object.entries(catalog).map(([k,v])=>`<option value="${k}" ${k===sel?'selected':''}>${v.label}</option>`).join("");
  box.innerHTML = list.map((e,i)=>{
    const needsKey = catalog[e.provider]?.needsKey !== false;
    return `<div class="prow" data-i="${i}" style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px">
      <div class="row" style="margin:0;gap:6px">
        <select class="p-prov" style="flex:1">${opts(e.provider)}</select>
        <span class="chip p-del" title="刪除">🗑</span>
      </div>
      ${needsKey?`<input class="p-key" type="password" placeholder="API 金鑰" value="${e.key||''}" autocomplete="off" style="margin-top:6px"/>`:'<p class="tiny muted" style="margin:6px 0 0">免金鑰</p>'}
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
  }));
}

// ── 重組 ──
async function doCompose(){
  const frag = $("#fragments").value.trim();
  if(!frag){ toast("請先輸入碎詞"); return; }
  if(!hasAnyLlmKey()){ toast("請先到設定頁填 LLM 金鑰（建議 Gemini）"); return; }
  $("#btnCompose").disabled = true; $("#btnCompose").textContent = "重組中…";
  try{
    lastResult = await reconstruct(frag, ctxText);
    $("#resultText").textContent = lastResult;
    $("#result").classList.remove("hidden");
    $("#resultImg").classList.add("hidden");
    speak(lastResult);
    addHistory({ original: frag + (ctxText?(" | "+ctxText):""), reconstructed: lastResult });
  }catch(e){ toast("重組失敗：" + (e.message||e)); }
  finally{ $("#btnCompose").disabled=false; $("#btnCompose").textContent="✨ 重組成自然句"; }
}

// ── 相機（拍照→雲端辨識）──
function setupCamera(){
  const inp = document.createElement("input");
  inp.type="file"; inp.accept="image/*"; inp.capture="environment"; inp.style.display="none";
  document.body.appendChild(inp);
  $("#btnCam").addEventListener("click", ()=> inp.click());
  inp.addEventListener("change", async ()=>{
    const f = inp.files?.[0]; if(!f) return;
    toast("辨識中…");
    try{
      const b64 = await fileToJpegBase64(f, 768);
      const items = await recognizePhoto(b64);
      if(items){ ctxText = ("看到："+items); $("#ctx").textContent = "📷 "+items; toast("已加入辨識結果"); }
    }catch(e){ toast("辨識失敗："+(e.message||e)); }
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
  $("#aacCombo").innerHTML = combo.map((w,i)=>`<span class="chip on" data-i="${i}">${w} ✕</span>`).join("") || '<span class="tiny muted">點上面的圖卡加入</span>';
  $$("#aacCombo .chip").forEach(c=>c.addEventListener("click",()=>{ combo.splice(+c.dataset.i,1); renderCombo(); }));
}
function setupAac(){
  renderAac(); renderCombo();
  $("#aacSpeak").addEventListener("click", ()=>{ if(combo.length) speak(combo.join("，")); });
  $("#aacClear").addEventListener("click", ()=>{ combo.length=0; renderCombo(); });
  $("#aacCompose").addEventListener("click", async ()=>{
    if(!combo.length){ toast("請先選圖卡"); return; }
    if(!hasAnyLlmKey()){ toast("需要 LLM 金鑰才能組句（設定頁）"); return; }
    toast("組句中…");
    try{ const s = await composeAac(combo, ctxText); speak(s);
      $("#fragments").value = s; toast("已組成：點「重組分頁」可再潤飾");
      addHistory({ original:"AAC: "+combo.join("+"), reconstructed:s });
    }catch(e){ toast("組句失敗："+(e.message||e)); }
  });
}

// ── 歷史（使用紀錄）：即時同步 + 手動更新 ──
let _histUnsub = null;
function renderHistoryList(list){
  const body = list.length ? list.map(h=>`
    <div class="hitem"><div class="h-main">${escapeHtml(h.reconstructed||"")}</div>
    <div class="h-sub">${escapeHtml(h.original||"")} · ${new Date(h.ts).toLocaleString()}</div></div>`).join("")
    : '<p class="tiny muted center">尚無紀錄</p>';
  $("#historyList").innerHTML =
    `<div class="row" style="margin:0 0 8px;align-items:center">
       <span class="tiny muted" style="flex:1">使用紀錄 · 即時同步</span>
       <button id="histRefresh" class="chip">🔄 更新</button>
     </div>` + body;
  $$("#historyList .hitem").forEach((el,i)=>el.addEventListener("click",()=>speak(list[i].reconstructed||"")));
  $("#histRefresh").addEventListener("click", async ()=>{
    toast("更新中…"); await refreshCloud(); renderHistoryList(await listHistory()); toast("已更新");
  });
}
function startHistoryWatch(){
  if(_histUnsub){ _histUnsub(); _histUnsub=null; }
  _histUnsub = watchHistory(list=>renderHistoryList(list));   // onSnapshot 訂閱後立即回呼一次
}
function escapeHtml(s){ return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

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
  $("#btnLoc").addEventListener("click", async ()=>{
    toast("定位中…");
    try{ const l = await detectLocation(); ctxText = (ctxText?ctxText+"；":"")+("地點："+l); $("#ctx").textContent="📍 "+l; }
    catch(e){ toast("定位失敗："+(e.message||e)); }
  });
  // 麥克風
  let mic=null;
  $("#btnMic").addEventListener("click", ()=>{
    if(mic){ mic.stop(); mic=null; $("#btnMic").textContent="🎤 語音輸入"; return; }
    if(!sttSupported()){ toast("此瀏覽器不支援語音輸入（建議 Chrome）"); return; }
    $("#btnMic").textContent="● 收音中…點此停止";
    mic = listen({
      onResult:(t)=>{ $("#fragments").value = t; },
      onEnd:()=>{ mic=null; $("#btnMic").textContent="🎤 語音輸入"; },
      onError:(e)=>{ toast("語音："+e); mic=null; $("#btnMic").textContent="🎤 語音輸入"; }
    });
  });
  $("#btnLogout").addEventListener("click", logout);
  // SOS（topbar 沒有，掛在登出旁；用鍵盤無法時可用 AAC 救命卡）—改用 AAC「救命」+ 此快捷
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") sos(); });
}
async function sos(){
  try{ await telegramNotify(lastResult || "我需要協助"); toast("已送出緊急通報"); }
  catch(e){ toast("通報失敗："+(e.message||e)); }
}

// ── 登入流程 ──
function showLogin(){ $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp(user){
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#who").textContent = user.name || "";
  applyTheme(); fillSettings();
  startHistoryWatch();   // 使用紀錄即時同步
}

function main(){
  setupTabs(); setupActions(); setupAac(); setupCamera(); bindSettings(); setupRehab({ toast });
  $("#btnGoogle").addEventListener("click", async ()=>{ try{ await loginGoogle(); }catch(e){ $("#loginErr").textContent=e.message||e; } });
  $("#btnAnon").addEventListener("click", async ()=>{ try{ await loginAnon(); }catch(e){ $("#loginErr").textContent=e.message||e; } });

  initAuth({
    onUser:(u)=>{ if(u) showApp(u); else showLogin(); },
    onSaved:(msg)=>{ const el=$("#saveState"); if(el) el.textContent=msg; },
    // 其他裝置改了 API 金鑰／設定 → 即時套用；正在編輯設定欄位時先不重繪，避免打字跳掉
    onRemote:()=>{
      applyTheme();
      const ae = document.activeElement;
      const editing = ae && $("#tab-settings")?.contains(ae);
      if(!editing) fillSettings();
    }
  });
}
main();
