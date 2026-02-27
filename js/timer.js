/* ---------- Rest Timer and Overlay ---------- */

import { $, toast } from './utils.js';
import { restCountdownBeep } from './audio.js';
import { ensureAudio } from './audio.js';

let restInterval = null;
let restRunning = false;

export function isRestRunning() {
  return restRunning;
}

export function ensureRestOverlay() {
  let o = document.getElementById("restOverlay");
  if (o) return o;

  o = document.createElement("div");
  o.id = "restOverlay";
  o.innerHTML = `
    <div class="box">
      <div class="title">Repos</div>
      <div class="sub" id="restSub">Prépare le prochain exercice</div>
      <div class="big" id="restBig">60</div>
      <div class="sub" id="restNext"></div>
      <div class="bar"><div id="restBar"></div></div>
      <div class="btns">
        <button class="ghost" id="restHide">Masquer</button>
        <button class="danger" id="restSkip">Passer le repos</button>
      </div>
    </div>
  `;
  document.body.appendChild(o);

  // Masquer sans arrêter le timer
  o.querySelector("#restHide").onclick = () => { o.style.display = "none"; };

  // IMPORTANT: réutiliser le flow existant (btnSkipRest) pour avancer correctement
  o.querySelector("#restSkip").onclick = () => {
    const btn = document.querySelector("#btnSkipRest");
    if (btn) btn.click();
    else toast("Pas de repos en cours");
  };

  return o;
}

export function showRestOverlay(totalSec, remainingSec, label = "Repos", nextExerciseTitle = "") {
  const o = ensureRestOverlay();
  o.style.display = "flex";

  const big = o.querySelector("#restBig");
  const sub = o.querySelector("#restSub");
  const next = o.querySelector("#restNext");
  const bar = o.querySelector("#restBar");

  if (sub) sub.textContent = label;
  if (next) next.textContent = nextExerciseTitle ? `Prochain exercice : ${nextExerciseTitle}` : "";
  if (big) big.textContent = String(Math.max(0, remainingSec));

  const pct = totalSec > 0 ? Math.round(((totalSec - remainingSec) / totalSec) * 100) : 0;
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

export function hideRestOverlay() {
  const o = document.getElementById("restOverlay");
  if (o) o.style.display = "none";
}

export function runRestTimer(seconds, onDone, nextExerciseTitle = "") {
  const el = $("#restHint");
  if (!el) return onDone?.();
  ensureAudio();
  
  clearInterval(restInterval);
  restRunning = false;

  const saveBtn = $("#btnSave");
  if (saveBtn) saveBtn.disabled = true;

  restRunning = true;
  const total = Math.max(0, seconds);
  let t = total;

  // première affichage
  el.textContent = `Repos : ${t}s`;
  showRestOverlay(total, t, "Récupère • Tu peux passer quand tu veux", nextExerciseTitle);

  restInterval = setInterval(() => {
    t--;
    // bips à 3-2-1 puis GO
    if (t <= 3 && t >= 0) restCountdownBeep(t);

    if (t <= 0) {
      clearInterval(restInterval);
      restRunning = false;

      el.textContent = "";
      hideRestOverlay();

      toast("Go !");
      const saveBtn2 = $("#btnSave");
      if (saveBtn2) saveBtn2.disabled = false;

      onDone?.();
      return;
    }

    el.textContent = `Repos : ${t}s`;
    showRestOverlay(total, t, "Récupère • Tu peux passer quand tu veux", nextExerciseTitle);
  }, 1000);
}

export function stopRest(onDone) {
  clearInterval(restInterval);
  restRunning = false;

  const saveBtn = $("#btnSave");
  if (saveBtn) saveBtn.disabled = false;

  const el = $("#restHint");
  if (el) el.textContent = "";

  hideRestOverlay();

  onDone?.();
}
