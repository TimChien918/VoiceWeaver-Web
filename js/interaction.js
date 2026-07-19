// 觸控防呆工具（給手抖、誤觸頻繁的使用者）。
//
// 規則：
//   • 觸發一律綁 pointerup——絕不用長按，長按選單/選字全部擋掉。
//   • 逐元素防連點（debounce）：同一顆按鈕在 gap 毫秒內只算一次，
//     手部顫抖在同一點連點不會重複觸發；點「不同」按鈕不互相干擾。
export function bindTap(el, fn, gap = 350){
  if(!el) return;
  let last = 0;
  el.addEventListener("contextmenu", e=>e.preventDefault());   // 禁長按選單
  el.addEventListener("selectstart", e=>e.preventDefault());   // 禁長按選字
  el.addEventListener("pointerup", (e)=>{
    e.preventDefault();
    const now = Date.now();
    if(now - last < gap) return;
    last = now;
    fn(e);
  });
}
