/* ---------- Swipe Gesture Handling ---------- */

import { ENABLE_SWIPE } from './utils.js';

export function attachSwipe(el, onLeft, onRight) {
  if (!ENABLE_SWIPE) return;   // ✅ désactive tout
  let sx = 0, sy = 0, moved = false;
  const LEFT_EDGE_GUARD_PX = 24;

  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; moved = false;
  }, { passive: true });

  el.addEventListener("touchmove", () => { moved = true; }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (!moved) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0) onLeft?.();
    else {
      if (sx < LEFT_EDGE_GUARD_PX) return;
      onRight?.();
    }
  }, { passive: true });
}
