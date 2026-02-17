/* ---------- Warmup Prompt and Runner ---------- */

import { $, render, escapeHTML, fmtTime, animateCard, toast, vibrate } from './utils.js';
import { getProgress, getProgram } from './state.js';
import { getWarmup } from './program.js';
import { WARMUP_SLOTS } from './storage.js';
import { attachSwipe } from './swipe.js';

let warmupTimer = { running:false, t:0, id:null };

export function renderWarmupPrompt({ next }) {
  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Avant de commencer</div>
            <div class="v">Échauffement</div>
          </div>
          <div class="pill">Recommandé</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="primary" id="btnWarm">Commencer l'échauffement</button>
            <button class="ghost" id="btnSkip">Passer</button>
          </div>
        </div>
      </div>
    </div>
  `);

  $("#btnSkip").onclick = () => next?.();
  $("#btnWarm").onclick = () => {
    const PROGRESS = getProgress();
    const setup = PROGRESS.settings.last_session_setup;
    const selected = new Set(setup?.selectedExercises || []);
    const warmups = [];

    warmups.push(PROGRESS.settings.warmup_default_upper);
    if (selected.has("pistols")) warmups.push(PROGRESS.settings.warmup_default_lower);

    runWarmups(warmups, () => next?.());
  };
}

export function runWarmups(warmupIds, onDone) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const warmups = warmupIds.map(id => getWarmup(PROGRAM, id)).filter(Boolean);
  const flatSteps = [];
  for (const w of warmups) {
    for (const s of (w.steps || [])) {
      flatSteps.push({ warmup_id: w.id, warmup_title: w.title, step: s });
    }
  }

  let idx = 0;

  const stopWarmTimer = () => {
    clearInterval(warmupTimer.id);
    warmupTimer.id = null;
    warmupTimer.running = false;
  };

  const renderStep = () => {
    stopWarmTimer();
    const cur = flatSteps[idx];
    if (!cur) return onDone?.();

    const s = cur.step;
    const slotPull = PROGRESS.settings.warmup_slot_choices?.pull || WARMUP_SLOTS.pull[0];
    const slotPush = PROGRESS.settings.warmup_slot_choices?.push || WARMUP_SLOTS.push[0];

    let line = "";
    let big = "";
    let showTimer = false;

    if (s.type === "reps_both_directions") line = `${s.reps_min}-${s.reps_max} / sens`;
    else if (s.type === "reps_each_side") line = `${s.reps_min}-${s.reps_max} / côté`;
    else if (s.type === "reps_each_angle") line = `${s.reps} / angle`;
    else if (s.type === "timer") {
      line = `${s.duration_sec}s`;
      showTimer = true;
      warmupTimer.t = s.duration_sec;
      big = fmtTime(warmupTimer.t);
    }
    else if (s.type === "exercise_slot") {
      const chosen = s.slot === "pull" ? slotPull : slotPush;
      line = `${chosen} — ${s.reps_min}-${s.reps_max} reps`;
      big = chosen;
    }

    render(`
      <div class="grid">
        <div class="card">
          <div class="hd">
            <div class="h">
              <div class="k">${escapeHTML(cur.warmup_title)}</div>
              <div class="v">Échauffement</div>
            </div>
            <div class="pill">${idx + 1}/${flatSteps.length}</div>
          </div>
          <div class="bd">
            <div class="workoutCard" id="swipeArea">
              <h2>${escapeHTML(s.title)}</h2>
              <div class="sub">${escapeHTML(line || "—")}</div>

              ${big ? `
                <div class="kpis">
                  <div class="kpi">
                    <div class="k">Focus</div>
                    <div class="v">${escapeHTML(big)}</div>
                  </div>
                </div>
              ` : ""}

              ${showTimer ? `
                <div class="timerBox" style="margin-top:12px;">
                  <div>
                    <div class="timerTime" id="wuTime">${escapeHTML(fmtTime(warmupTimer.t))}</div>
                    <div class="timerSub">Timer échauffement (manuel, pas d'auto-avance)</div>
                  </div>
                  <div class="quickBtns">
                    <button class="btnMini ghost" type="button" id="wuStart">Start</button>
                    <button class="btnMini ghost" type="button" id="wuPause">Pause</button>
                    <button class="btnMini ghost" type="button" id="wuReset">Reset</button>
                  </div>
                </div>
              ` : ""}

              <div class="footerBar">
                <button class="ghost" id="btnPrev">Précédent</button>
                <button class="primary" id="btnDoneStep">Marquer fait</button>
                <button class="danger" id="btnDoneAll">Terminer</button>
              </div>

            </div>
          </div>
        </div>
      </div>
    `);

    animateCard();

    attachSwipe($("#swipeArea"), () => $("#btnDoneStep")?.click(), () => $("#btnPrev")?.click());

    $("#btnPrev").onclick = () => { if (idx > 0) { idx--; renderStep(); } else toast("Début échauffement"); };
    $("#btnDoneStep").onclick = () => { if (idx < flatSteps.length - 1) { idx++; vibrate(); renderStep(); } else onDone?.(); };
    $("#btnDoneAll").onclick = () => onDone?.();

    if (showTimer) {
      const update = () => { const el = $("#wuTime"); if (el) el.textContent = fmtTime(warmupTimer.t); };

      $("#wuStart").onclick = () => {
        if (warmupTimer.running) return;
        warmupTimer.running = true;
        warmupTimer.id = setInterval(() => {
          warmupTimer.t = Math.max(0, warmupTimer.t - 1);
          update();
          if (warmupTimer.t === 0) stopWarmTimer();
        }, 1000);
      };
      $("#wuPause").onclick = () => stopWarmTimer();
      $("#wuReset").onclick = () => { stopWarmTimer(); warmupTimer.t = s.duration_sec; update(); };
      // Auto-start du décompte (sans auto-advance)
      $("#wuStart")?.click();
    }
  };

  renderStep();
}
