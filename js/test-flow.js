/* ---------- Test Flow ---------- */

import { $, render, escapeHTML, toast, vibrate, nowISO, safeGet, animateCard } from './utils.js';
import { getProgress, setProgress, getProgram } from './state.js';
import { findPhase, findFundamental, findLevel, levelIndex, getTipsFor, renderTipsBox, exerciseGroup } from './program.js';
import { formatValidate, meetsValidation } from './validation.js';
import { renderEntryFields, readEntryFromFields } from './entry-fields.js';
import { attachSwipe } from './swipe.js';
import { wireQuickControlsForCurrentScreen } from './entry-fields.js';

export function renderTestFlow({ mode }) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const ctx = { mode, exIdx: 0, levelIdx: 0, results: {} };
  renderTestScreen(ctx);
}

function testMaxLevelIndexReached(ctx, exId) {
  const res = ctx.results?.[exId];
  if (!res || !res.length) return 0;
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const f = findFundamental(phase, exId);
  const lastLevelId = res[res.length - 1].level_id;
  const idx = levelIndex(f, lastLevelId);
  return Math.max(0, idx);
}

function testGoBack(ctx) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];

  if (ctx.levelIdx > 0) { ctx.levelIdx--; return true; }
  if (ctx.exIdx > 0) {
    ctx.exIdx--;
    const prevExId = order[ctx.exIdx];
    ctx.levelIdx = testMaxLevelIndexReached(ctx, prevExId);
    return true;
  }
  return false;
}

function renderTestScreen(ctx) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const exId = order[ctx.exIdx];
  const f = findFundamental(phase, exId);
  const level = f.levels[ctx.levelIdx];
  const tips = getTipsFor(PROGRAM, PROGRESS.app.active_phase_id, exId, level.id);

  const head = ctx.mode === "initial" ? "Test initial" : "Re-test";
  const goal = formatValidate(level.type, level.validate);

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">${escapeHTML(head)}</div>
            <div class="v">${escapeHTML(f.title)}</div>
          </div>
          <div class="pill">Exercice ${ctx.exIdx + 1}/${order.length}</div>
        </div>
        <div class="bd">
          <div class="workoutCard" id="swipeArea">
            <h2>${escapeHTML(level.title)}</h2>
            <div class="sub">${escapeHTML(goal)}</div>
            <div class="meta" style="margin-top:10px;">
              <div class="chip" id="validBadge">❌ Pas encore</div>
            </div>

            ${renderTipsBox(tips)}
            
            <div class="kpis">
              <div class="kpi">
                <div class="k">Groupe</div>
                <div class="v">${escapeHTML(exerciseGroup(exId))}</div>
              </div>
              <div class="kpi">
                <div class="k">Niveau</div>
                <div class="v">${escapeHTML(String(ctx.levelIdx + 1) + "/" + String(f.levels.length))}</div>
              </div>
            </div>

            <div class="entry">
              ${renderEntryFields(level.type)}
              <div class="field">
                <label>Note (optionnel)</label>
                <textarea id="note" placeholder="Ex: élastique / banc / amplitude…"></textarea>
              </div>
            </div>

            <div class="footerBar">
              <button class="ghost" id="btnBack">Retour</button>
              <button class="danger" id="btnFail">Je bloque ici</button>
              <button class="primary" id="btnPass">Objectif atteint</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  animateCard();

  function entryMeetsLevel(level) {
  const entry = readEntryFromFields(level.type);
  return meetsValidation({ measure_type: level.type, validate: level.validate }, entry);
  }

  function updateTestButtons() {
    const ok = entryMeetsLevel(level);

    const passBtn = $("#btnPass");
    if (passBtn) passBtn.disabled = !ok;

    const badge = $("#validBadge");
    if (badge) {
      badge.textContent = ok ? "✅ Objectif validé" : "❌ Pas encore";
      badge.style.borderColor = ok ? "rgba(52,211,153,.40)" : "rgba(251,113,133,.40)";
      badge.style.color = ok ? "rgba(52,211,153,.95)" : "rgba(251,113,133,.95)";
      badge.style.background = ok ? "rgba(52,211,153,.10)" : "rgba(251,113,133,.10)";
    }
  }


  updateTestButtons();

  // Recalcule dès que l'utilisateur tape
  const v = $("#v");
  if (v) v.addEventListener("input", updateTestButtons);

  const l = $("#l"), r = $("#r");
  if (l) l.addEventListener("input", updateTestButtons);
  if (r) r.addEventListener("input", updateTestButtons);
  
  attachSwipe($("#swipeArea"), () => $("#btnPass")?.click(), () => $("#btnBack")?.click());

  // Quick controls in test: no "tour précédent" applicable => disable if exists
  const samePrev = $("#samePrevRound");
  if (samePrev) samePrev.disabled = true;

  wireQuickControlsForCurrentScreen({
    type: level.type,
    getPrevRoundEntry: () => null, // test has no rounds
  });
  
  $("#btnBack").onclick = async () => {
    const ok = testGoBack(ctx);
    if (!ok) {
      const { renderDashboard } = await import('./dashboard.js');
      return renderDashboard();
    }
    renderTestScreen(ctx);
  };

  $("#btnPass").onclick = () => {
    if (!entryMeetsLevel(level)) {
      toast("L'entrée ne valide pas l'objectif. Utilise "Je bloque ici".");
      return;
    }
    const entry = readEntryFromFields(level.type);
    const note = ($("#note").value || "").trim();
    ctx.results[exId] ||= [];
    ctx.results[exId].push({ level_id: level.id, status: "passed", entry, note });

    if (ctx.levelIdx < f.levels.length - 1) {
      ctx.levelIdx++;
      vibrate();
      return renderTestScreen(ctx);
    }
    applyTestLockIn(exId, level, entry, note);
    return nextExerciseOrFinish(ctx);
  };

  $("#btnFail").onclick = () => {
    const entry = readEntryFromFields(level.type);
    const note = ($("#note").value || "").trim();
    ctx.results[exId] ||= [];
    ctx.results[exId].push({ level_id: level.id, status: "blocked", entry, note });
    applyTestLockIn(exId, level, entry, note);
    nextExerciseOrFinish(ctx);
  };
}

async function nextExerciseOrFinish(ctx) {
  const PROGRAM = getProgram();
  const PROGRESS = getProgress();
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  if (ctx.exIdx < order.length - 1) {
    ctx.exIdx++;
    ctx.levelIdx = 0;
    vibrate();
    return renderTestScreen(ctx);
  }

  const record = { performed_at: nowISO(), results: ctx.results };
  if (ctx.mode === "initial") PROGRESS.tests.initial_test = record;
  else PROGRESS.tests.retests.push(record);

  setProgress(PROGRESS);
  toast(ctx.mode === "initial" ? "Test initial enregistré ✅" : "Re-test enregistré ✅");
  
  const { renderDashboard } = await import('./dashboard.js');
  renderDashboard();
}

function applyTestLockIn(exId, levelLocked, baselineEntry, baselineNote) {
  const PROGRESS = getProgress();
  PROGRESS.state[exId] ||= {};
  PROGRESS.state[exId].current_level_id = levelLocked.id;
  PROGRESS.state[exId].notes = baselineNote || "";
  PROGRESS.state[exId].last_updated_at = nowISO();

  if (exId === "pullups") {
    PROGRESS.state.pullups.baseline ||= {};
    if (levelLocked.id === "pullups_lvl1bis") {
      PROGRESS.state.pullups.baseline.aux = { type: "hold_sec", value: baselineEntry.value ?? null };
    } else {
      PROGRESS.state.pullups.baseline.main = { type: levelLocked.type, value: baselineEntry.value ?? null };
    }
  } else if (exId === "lsit") {
    PROGRESS.state.lsit.baseline ||= {};
    if (levelLocked.id === "lsit_lvl2bis") {
      PROGRESS.state.lsit.baseline.aux = { type: "reps", value: baselineEntry.value ?? null };
    } else {
      PROGRESS.state.lsit.baseline.main = { type: levelLocked.type, value: baselineEntry.value ?? null };
    }
  } else {
    PROGRESS.state[exId].baseline ||= {};
    PROGRESS.state[exId].baseline.main = { type: levelLocked.type, value: baselineEntry.value ?? null };
  }
}
