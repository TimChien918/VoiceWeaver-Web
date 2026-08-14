// 頭控的座標數學。**刻意不 import 任何東西**——沒有 DOM、沒有相機、沒有 store，
// 所以可以直接在 Node 裡餵合成座標測。準度的關鍵全在這裡，那就該是測得到的。

/** 死區半徑（正規化後的臉寬倍數）。小於這個位移一律當成沒動。 */
export const DEADZONE = 0.012;
/** 中性自適應速率，以及「多遠以內才算靠近中性」。 */
export const NEUTRAL_DRIFT = 0.003;
export const DRIFT_LIMIT = 0.06;


/** 兩眼連線相對水平線的角度（弧度）。頭往右肩歪為正。 */
export function rollAngle(lx, ly, rx, ry){
  return Math.atan2(ry - ly, rx - lx);
}

/**
 * 鼻尖相對雙眼中心的位移，**已補償側傾、且用雙眼距離正規化**。
 *
 * 回 { dx, dy }：dx 正 = 鼻尖偏向影像右側，dy 正 = 鼻尖偏下。
 * 兩者都是「臉寬的倍數」，所以跟距離鏡頭多遠無關。
 */
export function noseOffset(nx, ny, lx, ly, rx, ry){
  const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
  const w = Math.hypot(rx - lx, ry - ly) + 1e-6;
  const vx = (nx - cx) / w, vy = (ny - cy) / w;
  // 把座標系轉回「雙眼水平」的狀態：旋轉 -roll
  const a = -rollAngle(lx, ly, rx, ry);
  const s = Math.sin(a), c = Math.cos(a);
  return { dx: vx * c - vy * s, dy: vx * s + vy * c };
}

/** 死區：半徑內歸零，半徑外把邊界接回 0，避免跨出死區時跳一下。 */
export function deadzone(v, dz = DEADZONE){
  if (Math.abs(v) <= dz) return 0;
  return v > 0 ? v - dz : v + dz;
}

/**
 * 更新中性姿勢。**只在使用者接近中性時才漂移**——他正把頭轉去邊緣停留時，
 * 中性點若跟著跑，手一放游標就回不到中間了。
 */
export function driftNeutral(n0, n, limit = DRIFT_LIMIT, rate = NEUTRAL_DRIFT){
  if (Math.abs(n - n0) > limit) return n0;
  return n0 * (1 - rate) + n * rate;
}

export function clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 位移 → 畫面座標（0~1）。前鏡頭未鏡像，所以 x 取負號讓轉頭方向自然。 */
export function toCursor(dx, dy, dx0, dy0, sensX, sensY){
  return {
    cx: clamp01(0.5 - deadzone(dx - dx0) * sensX),
    cy: clamp01(0.5 + deadzone(dy - dy0) * sensY),
  };
}

