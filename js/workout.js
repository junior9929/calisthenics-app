/* ---------- Workout Flow ---------- */

import { $, render, escapeHTML, toast, vibrate, nowISO, deepClone, safeGet, animateCard } from './utils.js';
import { getProgress, setProgress, getProgram } from './state.js';
import { findPhase, findFundamental, findLevel, getTipsFor, renderTipsBox, exerciseGroup } from './program.js';
import { getCircuitForPhase1 } from './circuit.js';
import { formatValidate, meetsValidation, proposeLevelUps, isBelowFallbackThreshold, suggestFallback } from './validation.js';
import { renderEntryFields, readEntryFromFields } from './entry-fields.js';
import { bestRound1ForExercise } from './history.js';
import { attachSwipe } from './swipe.js';
import { runRestTimer, stopRest, isRestRunning } from './timer.js';
import { wireQuickControlsForCurrentScreen as wireQuickControls } from './entry-fields.js';
import { saveProgress } from './storage.js';

export function persistWorkout(workout) {
  const PROGRESS = getProgress();
  PROGRESS.last_workout = deepClone(workout);
  setProgress(PROGRESS);
  saveProgress(PROGRESS);
}

export async function startWorkout({ resume, selectedExercises, setup }) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);
  if (!initialDone) {
    const { renderSessionSetup } = await import('./session-setup.js');
    return renderSessionSetup({ mode: "test" });
  }

  let workout = null;

  if (resume && PROGRESS.last_workout?.workout_id && PROGRESS.last_workout?.completed === false) {
    workout = deepClone(PROGRESS.last_workout);
    workout.paused = false; // resume clears pause
    toast("Séance reprise");
  } else {
    const plan = getCircuitForPhase1(PROGRAM, PROGRESS, selectedExercises);
    workout = {
      workout_id: `w-${Date.now()}`,
      performed_at: nowISO(),
      phase_id: phase.id,
      warmup_ids: [],
      session_rules: {
        rounds: phase.session_rules.rounds,
        rest_between_exercises_sec: PROGRESS.settings.rest_between_exercises_sec || 60,
        rest_between_rounds_sec: PROGRESS.settings.rest_between_rounds_sec || 120
      },
      circuit_plan: plan,
      rounds: Array.from({ length: phase.session_rules.rounds }, () => ({ entries: [] })),
      completed: false,
      paused: false,
      setup: setup || PROGRESS.settings.last_session_setup || null,
      nav: { round: 0, idx: 0 }
    };
    persistWorkout(workout);
  }

  const nav = workout.nav || { round: 0, idx: 0 };
  renderWorkoutScreen(workout, { round: nav.round, idx: nav.idx });
}

export function buildStepListHTML(workout, nav) {
  const roundObj = workout.rounds[nav.round];
  return `
    <div class="stepList">
      ${workout.circuit_plan.items.map((it, i) => {
        const saved = roundObj.entries.some(e => e.item_id === it.item_id);
        const isActive = i === nav.idx;
        return `
          <div class="stepPill ${isActive ? "active" : ""}">
            <span class="dot ${saved ? "done" : ""} ${isActive ? "active" : ""}"></span>
            ${escapeHTML(it.exercise_title)}
          </div>
        `;
      }).join("")}
    </div>
  `;
}



export function getPrevRoundEntryForItem(workout, nav, item) {
  if (nav.round === 0) return null;
  const prevRound = workout.rounds[nav.round - 1];
  const prev = prevRound.entries.find(e => e.exercise_id === item.exercise_id && e.level_id === item.level_id);
  return prev?.entry || null;
}

export function renderWorkoutScreen(workout, nav) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);

  // persist nav each render (9)
  workout.nav = { round: nav.round, idx: nav.idx };

  const total = workout.session_rules.rounds * workout.circuit_plan.items.length;
  const pos = nav.round * workout.circuit_plan.items.length + nav.idx + 1;
  const pct = Math.round((pos / total) * 100);

  const item = workout.circuit_plan.items[nav.idx];
  const exId = item.exercise_id;
  const f = findFundamental(phase, exId);
  const currentLevelId = safeGet(PROGRESS, `state.${exId}.current_level_id`, f?.levels?.[0]?.id);
  const currentLevelTitle = (findLevel(f, currentLevelId)?.title) || currentLevelId || "—";
  const roundNum = nav.round + 1;

  const roundObj = workout.rounds[nav.round];
  const already = roundObj.entries.find(x => x.item_id === item.item_id) || null;

  const best = bestRound1ForExercise(item.exercise_id);
  const bestLine = best ? `Meilleur tour 1: ${best.val}${best.measure_type === "hold_sec" ? "s" : ""}` : "Meilleur tour 1: —";

  const group = exerciseGroup(item.exercise_id);
  const tips = getTipsFor(PROGRAM, workout.phase_id, item.exercise_id, item.level_id);

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Séance — Phase 1</div>
            <div class="v">Tour ${roundNum}/${workout.session_rules.rounds}</div>
          </div>
          <div class="pill">${pos}/${total}</div>
        </div>
        <div class="bd">
          <div class="workoutTop">
            <div class="progress"><div style="width:${pct}%"></div></div>

            <div class="row">
              <div class="tiny muted">Repos: ${workout.session_rules.rest_between_exercises_sec}s • Tours: ${workout.session_rules.rest_between_rounds_sec}s</div>
              <button class="ghost" id="btnPause">⏸️ Pause</button>
            </div>

            ${buildStepListHTML(workout, nav)}
          </div>

          <div class="workoutCard" id="swipeArea">
            <h2>${escapeHTML(item.exercise_title)} — ${escapeHTML(item.level_title)}</h2>
            <div class="sub">${escapeHTML(formatValidate(item.measure_type, item.validate))}</div>
            <div class="meta" style="margin-top:10px;">
              <div class="chip" id="workoutValidBadge">—</div>
            </div>

            <div class="kpis">
              <div class="kpi">
                <div class="k">Groupe</div>
                <div class="v">${escapeHTML(group)}</div>
              </div>
              <div class="kpi">
                <div class="k">Exercice</div>
                <div class="v">${escapeHTML(String(nav.idx + 1) + "/" + String(workout.circuit_plan.items.length))}</div>
              </div>
              <div class="kpi">
                <div class="k">Niveau en cours</div>
                <div class="v">${escapeHTML(currentLevelTitle)}</div>
              </div>
              <div class="kpi">
                <div class="k">Meilleur tour 1</div>
                <div class="v">${escapeHTML(best ? (best.val + (best.measure_type==="hold_sec"?"s":"")) : "—")}</div>
              </div>
            </div>

            ${renderTipsBox(tips)}
            
            <div class="entry">
              ${renderEntryFields(item.measure_type, already?.entry)}
              <div class="field">
                <label>Fallback / Complément (optionnel)</label>
                <textarea id="fallback" placeholder="Ex: 2 tractions + 3 négatives"></textarea>
              </div>
              <div class="field">
                <label>Note (optionnel)</label>
                <textarea id="note" placeholder="Amplitude, assistance, ressenti…"></textarea>
              </div>
            </div>

            <div class="footerBar">
              <button class="ghost" id="btnPrev">Précédent</button>
              <button class="primary" id="btnSave">Valider & Repos</button>
              <button class="ghost" id="btnRest">Repos</button>
              <button class="ghost" id="btnSkipRest">Passer le repos</button>
              <button class="danger" id="btnFinish">Terminer</button>
            </div>

            <div class="hint center" id="restHint"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  animateCard();

  // load existing fields
  if (already) {
    $("#fallback").value = already.fallback || "";
    $("#note").value = already.note || "";
  }

  function workoutEntryMeets() {
    const entry = readEntryFromFields(item.measure_type);
    return meetsValidation(
      { measure_type: item.measure_type, validate: item.validate },
      entry
    );
  }

  function updateWorkoutBadge() {
    const badge = $("#workoutValidBadge");
    if (!badge) return;

    // Si pas d'objectif (validate null) -> neutre
    if (!item.validate) {
      badge.textContent = "ℹ️ Pas d'objectif (note libre)";
      badge.style.borderColor = "rgba(255,255,255,.15)";
      badge.style.color = "rgba(167,180,204,.95)";
      badge.style.background = "rgba(255,255,255,.03)";
      return;
    }

    const ok = workoutEntryMeets();
    badge.textContent = ok ? "✅ Objectif atteint" : "❌ Sous l'objectif";

    badge.style.borderColor = ok ? "rgba(52,211,153,.40)" : "rgba(251,113,133,.40)";
    badge.style.color = ok ? "rgba(52,211,153,.95)" : "rgba(251,113,133,.95)";
    badge.style.background = ok ? "rgba(52,211,153,.10)" : "rgba(251,113,133,.10)";
  }

  // init + listeners input
  updateWorkoutBadge();

  const v = $("#v");
  if (v) v.addEventListener("input", updateWorkoutBadge);

  const l = $("#l"), r = $("#r");
  if (l) l.addEventListener("input", updateWorkoutBadge);
  if (r) r.addEventListener("input", updateWorkoutBadge);
  
  // wire quick controls with "same prev round"
  wireQuickControls({
    type: item.measure_type,
    getPrevRoundEntry: () => getPrevRoundEntryForItem(workout, nav, item)
  });

  // Pause (6)
  $("#btnPause").onclick = async () => {
    const ok = confirm("Mettre la séance en pause ? Tu pourras la reprendre ensuite.");
    if (!ok) return;

    workout.paused = true;
    workout.completed = false;
    persistWorkout(workout);

    toast("Séance mise en pause");
    const { renderDashboard } = await import('./dashboard.js');
    renderDashboard();
  };

  $("#btnPrev").onclick = () => goPrev(workout, nav);
  $("#btnFinish").onclick = () => finishWorkout(workout);

  $("#btnSkipRest").onclick = () => {
    if (!isRestRunning()) return toast("Pas de repos en cours");
    stopRest(() => goNext(workout, nav, { requireSaved: false }));
  };

  // Swipe left: if resting -> skip rest, else next (requires saved)
  attachSwipe($("#swipeArea"),
    () => {
      if (isRestRunning()) return $("#btnSkipRest")?.click();
      return goNext(workout, nav, { requireSaved: true });
    },
    () => goPrev(workout, nav)
  );

  const saveRecord = () => {
    const entry = readEntryFromFields(item.measure_type);
    const fallback = ($("#fallback").value || "").trim();
    const note = ($("#note").value || "").trim();

    if (!fallback && isBelowFallbackThreshold(phase, item, entry)) {
      const suggestion = suggestFallback(PROGRAM, PROGRESS, item);
      const ok = confirm(
        "Résultat très bas (seuil). Compléter avec le niveau précédent ?\n" +
        (suggestion ? `\nSuggestion: ${suggestion}` : "")
      );
      if (ok) $("#fallback").value = suggestion || "Complément niveau précédent";
    }

    const record = {
      item_id: item.item_id,
      exercise_id: item.exercise_id,
      level_id: item.level_id,
      measure_type: item.measure_type,
      entry,
      fallback: ($("#fallback").value || "").trim(),
      note,
      saved_at: nowISO()
    };

    const idx2 = roundObj.entries.findIndex(x => x.item_id === item.item_id);
    if (idx2 >= 0) roundObj.entries[idx2] = record;
    else roundObj.entries.push(record);

    // feedback
    const btn = $("#btnSave");
    const old = btn?.textContent;
    if (btn) btn.textContent = "✅ Enregistré";
    setTimeout(() => { if (btn) btn.textContent = old || "Valider & Repos"; }, 900);

    workout.nav = { round: nav.round, idx: nav.idx };
    persistWorkout(workout);

    toast("Enregistré");
    vibrate();
    return true;
  };

  $("#btnSave").onclick = () => {
  const ok = saveRecord();
  if (!ok) return;

  const rest = (nav.idx === workout.circuit_plan.items.length - 1)
    ? workout.session_rules.rest_between_rounds_sec
    : workout.session_rules.rest_between_exercises_sec;
  const nextItem = getNextCircuitItem(workout, nav);

  runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }), nextItem?.exercise_title || "");
  };

  // rest button (60s base, skippable) – you asked base 60 + swipe before end
  $("#btnRest").onclick = () => {
    // require saved
    const saved = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!saved) { toast("Valide d'abord"); return; }

    const rest = (nav.idx === workout.circuit_plan.items.length - 1)
      ? workout.session_rules.rest_between_rounds_sec
      : workout.session_rules.rest_between_exercises_sec;
    const nextItem = getNextCircuitItem(workout, nav);

    runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }), nextItem?.exercise_title || "");
  };
}

export function goPrev(workout, nav) {
  stopRest();

  if (nav.idx > 0) {
    nav.idx--;
    workout.nav = { round: nav.round, idx: nav.idx };
    persistWorkout(workout);
    return renderWorkoutScreen(workout, nav);
  }
  if (nav.round > 0) {
    nav.round--;
    nav.idx = workout.circuit_plan.items.length - 1;
    workout.nav = { round: nav.round, idx: nav.idx };
    persistWorkout(workout);
    return renderWorkoutScreen(workout, nav);
  }
  toast("Début de séance");
}

function getNextCircuitItem(workout, nav) {
  if (nav.idx < workout.circuit_plan.items.length - 1) {
    return workout.circuit_plan.items[nav.idx + 1];
  }
  if (nav.round < workout.session_rules.rounds - 1) {
    return workout.circuit_plan.items[0];
  }
  return null;
}

export function goNext(workout, nav, { requireSaved }) {
  stopRest();

  if (requireSaved) {
    const item = workout.circuit_plan.items[nav.idx];
    const roundObj = workout.rounds[nav.round];
    const saved = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!saved) { toast("Valide d'abord"); return; }
  }

  if (nav.idx < workout.circuit_plan.items.length - 1) {
    nav.idx++;
    workout.nav = { round: nav.round, idx: nav.idx };
    persistWorkout(workout);
    return renderWorkoutScreen(workout, nav);
  }
  if (nav.round < workout.session_rules.rounds - 1) {
    nav.round++;
    nav.idx = 0;
    workout.nav = { round: nav.round, idx: nav.idx };
    persistWorkout(workout);
    return renderWorkoutScreen(workout, nav);
  }
  finishWorkout(workout);
}

export async function finishWorkout(workout) {
  stopRest();

  const PROGRAM = getProgram();
  const PROGRESS = getProgress();

  workout.completed = true;
  workout.paused = false;

  PROGRESS.workout_history.unshift(deepClone(workout));
  PROGRESS.last_workout = deepClone(workout);

  const proposals = proposeLevelUps(PROGRAM, PROGRESS, workout);
  if (proposals.length) {
    const lines = proposals.map(p => `• ${p.exercise_id}: ${p.from} → ${p.to}`).join("\n");
    const ok = confirm("Objectifs validés au tour 1.\n\nMonter de niveau pour la prochaine séance ?\n\n" + lines);
    if (ok) {
      for (const p of proposals) {
        PROGRESS.state[p.exercise_id].current_level_id = p.to;
        PROGRESS.state[p.exercise_id].last_updated_at = nowISO();
      }
      toast("Niveaux mis à jour ✅");
    } else {
      toast("Niveaux inchangés");
    }
  } else {
    toast("Séance enregistrée ✅");
  }

  setProgress(PROGRESS);
  saveProgress(PROGRESS);
  
  const { renderWorkoutSummary } = await import('./history.js');
  renderWorkoutSummary(workout, { from: "finish" });

}
