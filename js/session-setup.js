/* ---------- Session Setup Screen ---------- */

import { $, render, escapeHTML, escapeAttr, toast, safeGet } from './utils.js';
import { getProgress, getProgram } from './state.js';
import { saveProgress } from './storage.js';
import { findPhase, findFundamental } from './program.js';

export function defaultSelectionForFocus(focus) {
  if (focus === "pull") return ["pullups", "pistols", "plank", "lsit"];
  if (focus === "push") return ["pushups", "pistols", "plank", "dips"];
  return ["pullups","pushups","pistols","plank","dips","lsit"];
}

function clampRounds(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 4;
  return Math.min(4, Math.max(2, n));
}

export async function renderSessionSetup({ mode }) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  const last = PROGRESS.settings.last_session_setup;
  const focus = last?.focus || "all";
  const selected = new Set(last?.selectedExercises || defaultSelectionForFocus(focus));
  const rounds = clampRounds(last?.rounds ?? 4);
  const warmupUpper = (typeof last?.warmup_upper === "boolean") ? last.warmup_upper : true;
  const warmupLower = (typeof last?.warmup_lower === "boolean") ? last.warmup_lower : selected.has("pistols");

  const exOptions = (phase.fundamentals_order || []).map(exId => {
    const f = findFundamental(phase, exId);
    const checked = selected.has(exId) ? "checked" : "";
    return `
      <label class="item" style="cursor:pointer;">
        <div class="left">
          <div class="name">${escapeHTML(f?.title ?? exId)}</div>
          <div class="tiny muted">Inclure dans la séance</div>
        </div>
        <input type="checkbox" data-ex="${escapeAttr(exId)}" ${checked} />
      </label>
    `;
  }).join("");

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Avant de commencer</div>
            <div class="v">${mode === "test" ? "Test (avec échauffement)" : "Configurer la séance"}</div>
          </div>
          <div class="pill">Phase 1</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="ghost" id="btnBack" disabled>Retour</button>
            <button class="primary" id="btnGo" disabled>${mode === "test" ? "Aller au test" : "Démarrer"}</button>
          </div>
          <p class="hint">
            L'échauffement est proposé <b>avant</b> le test et avant la séance.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Focus</div>
            <div class="v">Pull / Push / Tout</div>
          </div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="${focus==="pull"?"primary":""}" id="focusPull" disabled>Pull</button>
            <button class="${focus==="push"?"primary":""}" id="focusPush" disabled>Push</button>
            <button class="${focus==="all"?"primary":""}" id="focusAll" disabled>Tout</button>
          </div>
          <p class="hint">Le focus sert de présélection. Tu peux cocher/décocher.</p>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Exercices</div>
            <div class="v">Sélection</div>
          </div>
        </div>
        <div class="bd">
          <div class="list" id="exList">${exOptions}</div>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Paramètres de séance</div>
            <div class="v">Séries + échauffement</div>
          </div>
        </div>
        <div class="bd">
          <div class="field">
            <label>Séries totales</label>
            <select id="roundsSelect">
              <option value="2" ${rounds === 2 ? "selected" : ""}>2 séries</option>
              <option value="3" ${rounds === 3 ? "selected" : ""}>3 séries</option>
              <option value="4" ${rounds === 4 ? "selected" : ""}>4 séries</option>
            </select>
          </div>
          <div class="list" style="margin-top:10px;">
            <label class="item" style="cursor:pointer;">
              <div class="left">
                <div class="name">Échauffement bras</div>
                <div class="tiny muted">Routine haut du corps</div>
              </div>
              <input type="checkbox" id="warmupUpper" ${warmupUpper ? "checked" : ""} />
            </label>
            <label class="item" style="cursor:pointer;">
              <div class="left">
                <div class="name">Échauffement jambes</div>
                <div class="tiny muted">Routine bas du corps</div>
              </div>
              <input type="checkbox" id="warmupLower" ${warmupLower ? "checked" : ""} />
            </label>
          </div>
          <p class="hint">Coche au moins une zone d'échauffement.</p>
        </div>
      </div>
    </div>
  `);

  // Import functions dynamically to avoid circular dependencies
  try {
    const [{ renderDashboard }, { renderWarmupPrompt }, { renderTestFlow }, { startWorkout }] = await Promise.all([
      import('./dashboard.js'),
      import('./warmup.js'),
      import('./test-flow.js'),
      import('./workout.js')
    ]);

    // Enable buttons after modules are loaded
    const btnBack = $("#btnBack");
    const btnGo = $("#btnGo");
    const focusPull = $("#focusPull");
    const focusPush = $("#focusPush");
    const focusAll = $("#focusAll");
    
    if (btnBack) btnBack.disabled = false;
    if (btnGo) btnGo.disabled = false;
    if (focusPull) focusPull.disabled = false;
    if (focusPush) focusPush.disabled = false;
    if (focusAll) focusAll.disabled = false;

    if (btnBack) {
      btnBack.onclick = () => renderDashboard();
    }

    const setFocusAndDefaults = (newFocus) => {
      const defaults = defaultSelectionForFocus(newFocus);
      const list = $("#exList");
      for (const cb of list.querySelectorAll("input[type=checkbox][data-ex]")) {
        cb.checked = defaults.includes(cb.getAttribute("data-ex"));
      }
      const currentRounds = clampRounds($("#roundsSelect")?.value ?? rounds);
      const currentWarmupUpper = !!$("#warmupUpper")?.checked;
      const currentWarmupLower = !!$("#warmupLower")?.checked;
      PROGRESS.settings.last_session_setup = {
        focus: newFocus,
        selectedExercises: defaults,
        rounds: currentRounds,
        warmup_upper: currentWarmupUpper,
        warmup_lower: currentWarmupLower
      };
      saveProgress(PROGRESS);
      renderSessionSetup({ mode });
    };

    if (focusPull) focusPull.onclick = () => setFocusAndDefaults("pull");
    if (focusPush) focusPush.onclick = () => setFocusAndDefaults("push");
    if (focusAll) focusAll.onclick = () => setFocusAndDefaults("all");

    if (btnGo) {
      btnGo.onclick = () => {
        const selectedExercises = [];
        for (const cb of $("#exList").querySelectorAll("input[type=checkbox][data-ex]")) {
          if (cb.checked) selectedExercises.push(cb.getAttribute("data-ex"));
        }
        if (!selectedExercises.length) { toast("Choisis au moins 1 exercice"); return; }
        const chosenRounds = clampRounds($("#roundsSelect")?.value ?? rounds);
        const chosenWarmupUpper = !!$("#warmupUpper")?.checked;
        const chosenWarmupLower = !!$("#warmupLower")?.checked;
        if (!chosenWarmupUpper && !chosenWarmupLower) {
          toast("Choisis au moins une zone d'échauffement");
          return;
        }

        const focusNow = PROGRESS.settings.last_session_setup?.focus || "all";
        PROGRESS.settings.last_session_setup = {
          focus: focusNow,
          selectedExercises,
          rounds: chosenRounds,
          warmup_upper: chosenWarmupUpper,
          warmup_lower: chosenWarmupLower
        };
        saveProgress(PROGRESS);

        renderWarmupPrompt({
          next: () => {
            if (mode === "test") renderTestFlow({ mode: initialDone ? "retest" : "initial" });
            else startWorkout({ resume: false, selectedExercises, setup: PROGRESS.settings.last_session_setup });
          }
        });
      };
    }
  } catch (err) {
    console.error("Erreur lors du chargement des modules:", err);
    toast("Erreur de chargement: " + err.message);
  }
}
