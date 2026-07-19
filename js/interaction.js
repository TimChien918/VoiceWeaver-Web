// 觸控防呆工具（給手抖、誤觸頻繁的使用者）。
//
// 規則：
//   • 觸發一律綁 pointerup——絕不用長按，長按選單/選字全部擋掉。
//   • 捲動不算點擊：pointerdown→pointerup 位移超過 12px 視為捲頁/拖曳，不觸發
//     （否則在圖卡網格上滑動捲頁，手指離開的那張卡會被誤觸）。
//   • 逐元素防連點（debounce）：同一顆按鈕在 gap 毫秒內只算一次，
//     手部顫抖在同一點連點不會重複觸發；點「不同」按鈕不互相干擾。
const DRAG_PX = 12;

export function bindTap(el, fn, gap = 350){
  if(!el) return;
  let last = 0;
  let downX = 0, downY = 0, downOn = false;
  el.addEventListener("contextmenu", e=>e.preventDefault());   // 禁長按選單
  el.addEventListener("selectstart", e=>e.preventDefault());   // 禁長按選字
  el.addEventListener("pointerdown", (e)=>{ downOn = true; downX = e.clientX; downY = e.clientY; });
  el.addEventListener("pointercancel", ()=>{ downOn = false; });   // 系統接手（捲動/縮放）→ 取消
  el.addEventListener("pointerup", (e)=>{
    e.preventDefault();
    // 沒在此元素按下（例如從外面滑進來放開）或位移過大（捲動）→ 不算點
    const wasDown = downOn; downOn = false;
    if(!wasDown) return;
    if(Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > DRAG_PX) return;
    const now = Date.now();
    if(now - last < gap) return;
    last = now;
    fn(e);
  });
}
