/* ---------- Entry Fields and Quick Controls ---------- */

import { $, toast, escapeAttr, escapeHTML, fmtTime } from './utils.js';

export function renderEntryFields(type, existingEntry = null) {
  if (type === "reps" || type === "negatives") {
    const val = existingEntry?.value ?? "";
    return `
      <div class="field">
        <label>Répétitions</label>
        <div class="quickRow">
          <input id="v" inputmode="numeric" placeholder="Ex: 8" value="${escapeAttr(val)}" />
          <div class="quickBtns">
            <button class="btnMini ghost" type="button" id="dec1">-1</button>
            <button class="btnMini ghost" type="button" id="inc1">+1</button>
            <button class="btnMini ghost" type="button" id="inc5">+5</button>
            <button class="btnMini ghost" type="button" id="samePrevRound">Tour précédent</button>
          </div>
        </div>
      </div>
    `;
  }
  if (type === "hold_sec") {
    const val = existingEntry?.value ?? "";
    return `
      <div class="field">
        <label>Temps (secondes)</label>

        <div class="timerBox">
          <div>
            <div class="timerTime" id="holdTime">${escapeHTML(val ? fmtTime(val) : "0s")}</div>
            <div class="timerSub">Chrono pour tenir le gainage</div>
          </div>
          <div class="quickBtns">
            <button class="btnMini ghost" type="button" id="holdStart">Start</button>
            <button class="btnMini ghost" type="button" id="holdPause">Pause</button>
            <button class="btnMini ghost" type="button" id="holdReset">Reset</button>
          </div>
        </div>

        <div class="quickRow" style="margin-top:10px;">
          <input id="v" inputmode="numeric" placeholder="Ex: 30" value="${escapeAttr(val)}" />
          <div class="quickBtns">
            <button class="btnMini ghost" type="button" id="dec5">-5</button>
            <button class="btnMini ghost" type="button" id="inc5s">+5</button>
            <button class="btnMini ghost" type="button" id="samePrevRound">Tour précédent</button>
          </div>
        </div>
      </div>
    `;
  }
  if (type === "reps_each_side") {
    const l = existingEntry?.left ?? "";
    const r = existingEntry?.right ?? "";
    return `
      <div class="twocol">
        <div class="field">
          <label>Gauche (reps)</label>
          <div class="quickRow">
            <input id="l" inputmode="numeric" placeholder="Ex: 5" value="${escapeAttr(l)}" />
            <div class="quickBtns">
              <button class="btnMini ghost" type="button" id="lDec1">-1</button>
              <button class="btnMini ghost" type="button" id="lInc1">+1</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Droite (reps)</label>
          <div class="quickRow">
            <input id="r" inputmode="numeric" placeholder="Ex: 5" value="${escapeAttr(r)}" />
            <div class="quickBtns">
              <button class="btnMini ghost" type="button" id="rDec1">-1</button>
              <button class="btnMini ghost" type="button" id="rInc1">+1</button>
            </div>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Raccourci</label>
        <div class="quickBtns">
          <button class="btnMini ghost" type="button" id="samePrevRound">Tour précédent</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="field">
      <label>Valeur</label>
      <input id="v" inputmode="numeric" placeholder="Ex: 10" />
    </div>
  `;
}

export function readEntryFromFields(type) {
  const toNum = (x) => {
    const n = parseFloat(String(x ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  if (type === "reps" || type === "negatives" || type === "hold_sec") {
    return { value: toNum($("#v")?.value) };
  }
  if (type === "reps_each_side") {
    return { left: toNum($("#l")?.value), right: toNum($("#r")?.value) };
  }
  return { value: toNum($("#v")?.value) };
}

let holdTimer = { running:false, t:0, id:null };

export function wireQuickControlsForCurrentScreen({ type, getPrevRoundEntry }) {
  // Clean up any existing holdTimer if re-entering a hold_sec exercise
  if (type === "hold_sec" && holdTimer.running) {
    clearInterval(holdTimer.id);
    holdTimer.running = false;
    holdTimer.t = 0;
  }

  const toNum = (x) => {
    const n = parseFloat(String(x ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  
  // Helper to dispatch input event for programmatic value changes
  const fireInput = (el) => { if (el) el.dispatchEvent(new Event("input", { bubbles: true })); };
  
  const setV = (n) => {
    const v = $("#v");
    if (v) {
      v.value = String(Math.max(0, Math.floor(n)));
      fireInput(v);
    }
  };

  if (type === "reps" || type === "negatives") {
    const dec1 = $("#dec1"), inc1 = $("#inc1"), inc5 = $("#inc5"), same = $("#samePrevRound");
    if (dec1) dec1.onclick = () => setV(toNum($("#v")?.value) - 1);
    if (inc1) inc1.onclick = () => setV(toNum($("#v")?.value) + 1);
    if (inc5) inc5.onclick = () => setV(toNum($("#v")?.value) + 5);
    if (same) same.onclick = () => {
      const prev = getPrevRoundEntry?.();
      if (!prev) return toast("Pas de tour précédent");
      setV(prev.value ?? 0);
      toast("Copié (tour précédent)");
    };
  }

  if (type === "hold_sec") {
    const dec5 = $("#dec5"), inc5s = $("#inc5s"), same = $("#samePrevRound");
    if (dec5) dec5.onclick = () => setV(toNum($("#v")?.value) - 5);
    if (inc5s) inc5s.onclick = () => setV(toNum($("#v")?.value) + 5);
    if (same) same.onclick = () => {
      const prev = getPrevRoundEntry?.();
      if (!prev) return toast("Pas de tour précédent");
      setV(prev.value ?? 0);
      const ht = $("#holdTime"); if (ht) ht.textContent = fmtTime(prev.value ?? 0);
      toast("Copié (tour précédent)");
    };

    // timer controls
    const ht = $("#holdTime");
    const updateHT = () => { if (ht) ht.textContent = fmtTime(holdTimer.t); };
    const stop = () => { clearInterval(holdTimer.id); holdTimer.running = false; };
    const start = () => {
      if (holdTimer.running) return;
      holdTimer.running = true;
      holdTimer.id = setInterval(() => {
        holdTimer.t += 1;
        updateHT();
      }, 1000);
    };
    $("#holdStart") && ($("#holdStart").onclick = () => start());
    $("#holdPause") && ($("#holdPause").onclick = () => stop());
    $("#holdReset") && ($("#holdReset").onclick = () => { stop(); holdTimer.t = 0; updateHT(); setV(0); });

    // keep input and timer aligned when user edits value
    const v = $("#v");
    if (v) v.addEventListener("input", () => {
      holdTimer.t = toNum(v.value);
      updateHT();
    });

    // init timer with existing value
    holdTimer.t = toNum($("#v")?.value);
    updateHT();
  }

  if (type === "reps_each_side") {
    const lDec1=$("#lDec1"), lInc1=$("#lInc1"), rDec1=$("#rDec1"), rInc1=$("#rInc1"), same=$("#samePrevRound");
    const setL = (n) => {
      const el = $("#l");
      if (el) {
        el.value = String(Math.max(0, Math.floor(n)));
        fireInput(el);
      }
    };
    const setR = (n) => {
      const el = $("#r");
      if (el) {
        el.value = String(Math.max(0, Math.floor(n)));
        fireInput(el);
      }
    };
    if (lDec1) lDec1.onclick = () => setL(toNum($("#l")?.value) - 1);
    if (lInc1) lInc1.onclick = () => setL(toNum($("#l")?.value) + 1);
    if (rDec1) rDec1.onclick = () => setR(toNum($("#r")?.value) - 1);
    if (rInc1) rInc1.onclick = () => setR(toNum($("#r")?.value) + 1);
    if (same) same.onclick = () => {
      const prev = getPrevRoundEntry?.();
      if (!prev) return toast("Pas de tour précédent");
      setL(prev.left ?? 0);
      setR(prev.right ?? 0);
      toast("Copié (tour précédent)");
    };
  }
}
