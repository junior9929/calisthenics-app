/* ---------- Utility Functions ---------- */

export const $ = (sel) => document.querySelector(sel);
export const ENABLE_SWIPE = false;

export function nowISO() { 
  return new Date().toISOString(); 
}

export function deepClone(o) { 
  return JSON.parse(JSON.stringify(o)); 
}

export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.display = "none"), 2200);
}

export function safeGet(obj, path, fallback = null) {
  try {
    return path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj) ?? fallback;
  } catch { return fallback; }
}

export function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttr(s) { 
  return escapeHTML(s).replaceAll("\n", " "); 
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2,"0")}` : `${r}s`;
}

export function animateCard() {
  const el = $("#swipeArea");
  if (!el) return;
  el.classList.remove("enter");
  // force reflow
  void el.offsetWidth;
  el.classList.add("enter");
}

export function vibrate(ms=12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

export function render(html) { 
  $("#root").innerHTML = html; 
}
