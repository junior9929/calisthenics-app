/* ---------- History and Summary ---------- */

import { render, escapeHTML } from './utils.js';
import { getProgress, getProgram } from './state.js';
import { saveProgress } from './storage.js';
import { findPhase, findFundamental } from './program.js';

function formatWhen(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso || "—"; }
}

export function entryToDisplay(measure_type, entry) {
  if (!entry) return "—";
  if (measure_type === "reps" || measure_type === "negatives") return `${entry.value ?? 0} reps`;
  if (measure_type === "hold_sec") return `${entry.value ?? 0}s`;
  if (measure_type === "reps_each_side") return `${entry.left ?? 0}/${entry.right ?? 0}`;
  return JSON.stringify(entry);
}

export function entryToScore(measure_type, entry) {
  // score numérique pour comparer les tours
  if (!entry) return -Infinity;
  if (measure_type === "reps" || measure_type === "negatives" || measure_type === "hold_sec") {
    return typeof entry.value === "number" ? entry.value : -Infinity;
  }
  if (measure_type === "reps_each_side") {
    const l = typeof entry.left === "number" ? entry.left : -Infinity;
    const r = typeof entry.right === "number" ? entry.right : -Infinity;
    return Math.min(l, r);
  }
  return -Infinity;
}

export function numericValueForBest(e) {
  if (!e) return null;
  const t = e.measure_type;
  const en = e.entry || {};
  if (t === "reps" || t === "negatives" || t === "hold_sec") return typeof en.value === "number" ? en.value : null;
  if (t === "reps_each_side") {
    const l = typeof en.left === "number" ? en.left : null;
    const r = typeof en.right === "number" ? en.right : null;
    if (l == null || r == null) return null;
    return Math.min(l, r);
  }
  return null;
}

export function bestRound1ForExercise(exId) {
  const PROGRESS = getProgress();
  let best = null;
  for (const w of (PROGRESS.workout_history || [])) {
    const r1 = w.rounds?.[0];
    if (!r1) continue;
    const matches = r1.entries.filter(x => x.exercise_id === exId);
    if (!matches.length) continue;

    let pick = matches[0];
    if (exId === "pullups") pick = matches.find(m => m.level_id !== "pullups_lvl1bis") || matches[0];
    if (exId === "lsit") pick = matches.find(m => m.level_id !== "lsit_lvl2bis") || matches[0];

    const val = numericValueForBest(pick);
    if (val == null) continue;
    if (!best || val > best.val) best = { val, measure_type: pick.measure_type };
  }
  return best;
}

export function computeWorkoutBestByExercise(workout) {
  // Retourne: { exId: { bestScore, bestText, bestRoundIndex, bestLevelTitle } }
  const out = {};

  for (let r = 0; r < (workout.rounds?.length || 0); r++) {
    const round = workout.rounds[r];
    for (const e of (round.entries || [])) {
      const exId = e.exercise_id;

      const score = entryToScore(e.measure_type, e.entry);
      const text = entryToDisplay(e.measure_type, e.entry);

      if (!out[exId] || score > out[exId].bestScore) {
        out[exId] = {
          bestScore: score,
          bestText: text,
          bestRoundIndex: r,
          bestLevelTitle: e.level_title || e.level_id,
          bestItemTitle: e.level_title || e.level_id,
          measure_type: e.measure_type
        };
      }
    }
  }
  return out;
}

export function deleteWorkoutById(workoutId) {
  const PROGRESS = getProgress();
  if (!workoutId) return;

  const before = (PROGRESS.workout_history || []).length;
  PROGRESS.workout_history = (PROGRESS.workout_history || []).filter(w => w.workout_id !== workoutId);

  // Si la séance supprimée est aussi last_workout, on la "nettoie" intelligemment
  if (PROGRESS.last_workout?.workout_id === workoutId) {
    PROGRESS.last_workout.workout_id = null;
    PROGRESS.last_workout.rounds = [];
    PROGRESS.last_workout.circuit_plan = { items: [] };
    PROGRESS.last_workout.completed = false;
    PROGRESS.last_workout.paused = false;
  }

  saveProgress(PROGRESS);

  const after = (PROGRESS.workout_history || []).length;
  const { toast } = await import('./utils.js');
  toast(before !== after ? "Séance supprimée 🗑️" : "Séance introuvable");
}

export function renderHistory() {
  const PROGRESS = getProgress();
  const list = (PROGRESS.workout_history || []);

  const rows = list.map((w, i) => {
    const when = formatWhen(w.performed_at);
    const focus = w.setup?.focus || "—";
    const exCount = w.circuit_plan?.items?.length || 0;
    const rounds = w.session_rules?.rounds || (w.rounds?.length || 0);

    return `
      <div class="item" style="cursor:pointer;" data-hidx="${i}">
        <div class="left">
          <div class="name">${escapeHTML(when)}</div>
          <div class="tiny muted">Focus: ${escapeHTML(focus)} • Exercices/tour: ${exCount} • Tours: ${rounds}</div>
        </div>
        <div class="badge ok">Voir</div>
      </div>
    `;
  }).join("");

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Historique des séances</div>
            <div class="v">${escapeHTML((PROGRESS.workout_history || []).length)} séance(s)</div>
          </div>
          <div class="pill">Phase 1</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="ghost" id="btnBackDash">Retour dashboard</button>
          </div>
          <div class="list">${rows || `<div class="tiny muted">Aucune séance enregistrée.</div>`}</div>
        </div>
      </div>
    </div>
  `);

  // Import renderDashboard dynamically to avoid circular dependency
  import('./dashboard.js').then(({ renderDashboard }) => {
    document.getElementById("btnBackDash").onclick = () => renderDashboard();
  });

  // click row
  document.querySelectorAll("[data-hidx]").forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.getAttribute("data-hidx"), 10);
      const w = PROGRESS.workout_history[idx];
      if (!w) return;
      renderWorkoutSummary(w, { from: "history" });
    };
  });
}

export function renderWorkoutSummary(workout, { from } = {}) {
  const PROGRESS = getProgress();
  const PROGRAM = getProgram();
  const bestByEx = computeWorkoutBestByExercise(workout);

  // Liste d'exercices (dans l'ordre du circuit)
  const order = [];
  for (const it of (workout.circuit_plan?.items || [])) {
    if (!order.includes(it.exercise_id)) order.push(it.exercise_id);
  }

  const phase = findPhase(PROGRAM, workout.phase_id || PROGRESS.app.active_phase_id);
  const focus = workout.setup?.focus || "—";
  const selected = workout.setup?.selectedExercises || null;
  const selText = selected?.length ? selected.join(", ") : "—";

  const summaryItems = order.map(exId => {
    const f = phase ? findFundamental(phase, exId) : null;
    const title = f?.title || exId;
    const best = bestByEx[exId];

    const bestLine = best
      ? `🏆 ${best.bestText} (tour ${best.bestRoundIndex + 1})`
      : "—";

    const levelLine = best?.bestLevelTitle ? `${best.bestLevelTitle}` : "—";

    return `
      <div class="item">
        <div class="left">
          <div class="name">${escapeHTML(title)}</div>
          <div class="tiny muted">Meilleur sur 4 tours : <b>${escapeHTML(bestLine)}</b></div>
          <div class="tiny muted">Niveau (item) : ${escapeHTML(levelLine)}</div>
        </div>
        <div class="badge ok">Best</div>
      </div>
    `;
  }).join("");

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Résumé de séance</div>
            <div class="v">${escapeHTML(formatWhen(workout.performed_at))}</div>
          </div>
          <div class="pill">${escapeHTML(focus)}</div>
        </div>

        <div class="bd">
          <div class="btns">
            <button class="ghost" id="btnBack">${from === "history" ? "Retour historique" : "Retour dashboard"}</button>
            <button class="primary" id="btnHistory">Historique</button>
            <button class="ghost" id="btnReplayFromSummary">Rejouer la même séance</button>
            <button class="danger" id="btnDeleteWorkout">Supprimer</button>
          </div>

          <div class="grid" style="margin-top:12px;">
            <div class="card">
              <div class="hd"><div class="h"><div class="k">Infos</div><div class="v">Séance</div></div></div>
              <div class="bd">
                <div class="tiny muted">Phase: ${escapeHTML(phase?.title || "—")}</div>
                <div class="tiny muted">Exercices sélectionnés: ${escapeHTML(selText)}</div>
                <div class="tiny muted">Tours: ${escapeHTML(String(workout.session_rules?.rounds || workout.rounds?.length || 0))}</div>
                <div class="tiny muted">Repos exos: ${escapeHTML(String(workout.session_rules?.rest_between_exercises_sec ?? "—"))}s</div>
                <div class="tiny muted">Repos tours: ${escapeHTML(String(workout.session_rules?.rest_between_rounds_sec ?? "—"))}s</div>
              </div>
            </div>

            <div class="card">
              <div class="hd"><div class="h"><div class="k">Meilleurs</div><div class="v">par exercice</div></div></div>
              <div class="bd">
                <div class="list">${summaryItems || `<div class="tiny muted">Aucune donnée.</div>`}</div>
              </div>
            </div>
          </div>

          <p class="hint">Le "meilleur" est calculé sur les 4 tours (score numérique: reps/seconds/min(gauche,droite)).</p>
        </div>
      </div>
    </div>
  `);

  // Import functions dynamically to avoid circular dependencies
  Promise.all([
    import('./dashboard.js'),
    import('./warmup.js'),
    import('./workout.js')
  ]).then(([{ renderDashboard }, { renderWarmupPrompt }, { startWorkout }]) => {
    document.getElementById("btnBack").onclick = () => {
      if (from === "history") renderHistory();
      else renderDashboard();
    };
    document.getElementById("btnHistory").onclick = () => renderHistory();

    document.getElementById("btnReplayFromSummary").onclick = () => {
      // même logique que dashboard replay
      const setup = workout.setup || PROGRESS.settings.last_session_setup || null;
      const selected = setup?.selectedExercises || null;
      renderWarmupPrompt({
        next: () => startWorkout({ resume: false, selectedExercises: selected, setup })
      });
    };

    document.getElementById("btnDeleteWorkout").onclick = () => {
      const ok = confirm("Supprimer cette séance ? (Action irréversible)");
      if (!ok) return;

      const id = workout.workout_id;
      deleteWorkoutById(id);

      // Après suppression, retour logique
      if (from === "history") renderHistory();
      else renderDashboard();
    };
  });
}
