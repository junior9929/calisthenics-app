/* ---------- Dashboard ---------- */

import { $, render, escapeHTML, toast, safeGet } from './utils.js';
import { getProgress, setProgress, getProgram } from './state.js';
import { LS_KEY, ensureProgressShape } from './storage.js';
import { findPhase, findFundamental, findLevel } from './program.js';
import { bestRound1ForExercise } from './history.js';
import { exportProgress, importProgressFromFile } from './export-import.js';

export function dashboardCards() {
  const PROGRESS = getProgress();
  const PROGRAM = getProgram();
  const phaseId = PROGRESS.app.active_phase_id;
  const phase = findPhase(PROGRAM, phaseId);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  const lastWorkoutAt = PROGRESS.last_workout?.performed_at;
  const lastWorkoutBadge = lastWorkoutAt ? `Dernière séance : ${new Date(lastWorkoutAt).toLocaleString()}` : "Aucune séance";

  const itemsHtml = (phase.fundamentals_order || []).map(exId => {
    const f = findFundamental(phase, exId);
    const current = safeGet(PROGRESS, `state.${exId}.current_level_id`, f?.levels?.[0]?.id);
    const lvlLabel = (findLevel(f, current)?.title) || current || "—";
    const best = bestRound1ForExercise(exId);
    const bestTxt = best ? `${best.val}${best.measure_type==="hold_sec"?"s":""}` : "—";

    return `
      <div class="item">
        <div class="left">
          <div class="name">${escapeHTML(f?.title ?? exId)}</div>
          <div class="tiny muted">Niveau : ${escapeHTML(lvlLabel)}</div>
          <div class="tiny muted">Meilleur tour 1 : ${escapeHTML(bestTxt)}</div>
        </div>
        <div class="badge ${initialDone ? "ok" : "warn"}">${initialDone ? "Prêt" : "Test requis"}</div>
      </div>
    `;
  }).join("");

  const canResume = !!(PROGRESS.last_workout?.workout_id && PROGRESS.last_workout?.completed === false);
  const isPaused = !!(PROGRESS.last_workout?.paused);
  const canReplay = !!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length);

  const pausedBanner = (canResume && isPaused) ? `
    <div class="card">
      <div class="hd">
        <div class="h">
          <div class="k">Séance en pause</div>
          <div class="v">Tu peux reprendre exactement où tu t'es arrêté</div>
        </div>
        <div class="pill">⏸️ Pause</div>
      </div>
      <div class="bd">
        <div class="btns">
          <button class="primary" id="btnResumeTop">Reprendre</button>
          <button class="danger" id="btnAbandonTop">Abandonner</button>
        </div>
      </div>
    </div>
  ` : "";

  return `
    <div class="grid">
      ${pausedBanner}

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">${escapeHTML(phase?.title ?? "Phase 1")}</div>
            <div class="v">Tableau de bord</div>
          </div>
          <div class="pill">${escapeHTML(lastWorkoutBadge)}</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="primary" id="btnStart">${initialDone ? "Configurer & lancer une séance" : "Configurer & faire le test initial"}</button>
            ${canResume ? `<button id="btnResume">${isPaused ? "Reprendre (pause)" : "Reprendre la séance"}</button>` : ""}
            ${canResume ? `<button class="danger" id="btnAbandon">Abandonner</button>` : ""}
            <button class="ghost" id="btnTest">${initialDone ? "Configurer & refaire un test" : "Configurer & test initial"}</button>
            <button class="ghost" id="btnReplay" ${canReplay ? "" : "disabled"}>Rejouer la même séance</button>
            <button class="ghost" id="btnHistory">Historique</button>
            <button class="ghost" id="btnExport">Exporter</button>
            <button class="ghost" id="btnImport">Importer</button>
            <button class="danger" id="btnReset">Reset local (⚠️)</button>
          </div>
          <p class="hint">Pause = tu reviens au menu sans perdre ta position.</p>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Niveaux & perfs</div>
            <div class="v">Fondamentaux</div>
          </div>
        </div>
        <div class="bd">
          <div class="list">${itemsHtml}</div>
        </div>
      </div>
    </div>
  `;
}

export async function renderDashboard() {
  const PROGRESS = getProgress();
  render(dashboardCards());

  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  $("#btnStart").onclick = async () => {
    const { renderSessionSetup } = await import('./session-setup.js');
    renderSessionSetup({ mode: initialDone ? "workout" : "test" });
  };

  const abandonFn = () => {
    const ok = confirm("Abandonner la séance en cours ? (Elle ne sera pas ajoutée à l'historique)");
    if (!ok) return;

    const PROGRESS = getProgress();
    PROGRESS.last_workout.workout_id = null;
    PROGRESS.last_workout.rounds = [];
    PROGRESS.last_workout.circuit_plan = { items: [] };
    PROGRESS.last_workout.completed = false;
    PROGRESS.last_workout.paused = false;
    PROGRESS.last_workout.nav = { round: 0, idx: 0 };

    setProgress(PROGRESS);
    toast("Séance abandonnée");
    renderDashboard();
  };

  const btnAbandon = $("#btnAbandon");
  if (btnAbandon) btnAbandon.onclick = abandonFn;

  const btnAbandonTop = $("#btnAbandonTop");
  if (btnAbandonTop) btnAbandonTop.onclick = abandonFn;

  const resumeFn = async () => {
    const { startWorkout } = await import('./workout.js');
    startWorkout({ resume: true });
  };

  const btnResume = $("#btnResume");
  if (btnResume) btnResume.onclick = resumeFn;

  const btnResumeTop = $("#btnResumeTop");
  if (btnResumeTop) btnResumeTop.onclick = resumeFn;

  const btnHistory = $("#btnHistory");
  if (btnHistory) btnHistory.onclick = async () => {
    const { renderHistory } = await import('./history.js');
    renderHistory();
  };

  $("#btnTest").onclick = async () => {
    const { renderSessionSetup } = await import('./session-setup.js');
    renderSessionSetup({ mode: "test" });
  };

  $("#btnReplay").onclick = async () => {
    const PROGRESS = getProgress();
    if (!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length)) return;
    const setup = PROGRESS.last_workout.setup || PROGRESS.settings.last_session_setup || null;
    const selected = setup?.selectedExercises || null;

    const { renderWarmupPrompt } = await import('./warmup.js');
    const { startWorkout } = await import('./workout.js');
    renderWarmupPrompt({
      next: () => startWorkout({ resume: false, selectedExercises: selected, setup })
    });
  };

  $("#btnExport").onclick = () => exportProgress();
  $("#btnImport").onclick = () => {
    const input = $("#importFile");
    input.value = "";
    input.click();
  };

  $("#importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const obj = await importProgressFromFile(file);
      const ok = confirm("Importer ce progress va remplacer tes données locales. Continuer ?");
      if (!ok) return;
      let PROGRESS = ensureProgressShape(obj);
      setProgress(PROGRESS);
      toast("Import OK ✅");
      renderDashboard();
    } catch (err) {
      toast(err.message || "Import impossible");
    }
  };

  $("#btnReset").onclick = () => {
    const ok = confirm("Supprimer toutes les données locales ? (Exporter avant si besoin)");
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    toast("Reset OK. Recharge la page.");
  };
}
