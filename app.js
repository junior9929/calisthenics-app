/* ---------- Storage ---------- */
const LS_KEY = "calisthenics_progress_v1";

/* ---------- Utils ---------- */
const $ = (sel) => document.querySelector(sel);

function nowISO() {
  return new Date().toISOString();
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.display = "none"), 2200);
}

function safeGet(obj, path, fallback = null) {
  try {
    return path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function setProgress(p) {
  localStorage.setItem(LS_KEY, JSON.stringify(p));
}

function getProgress() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} introuvable`);
  return await res.json();
}

/* ---------- Program helpers ---------- */
function findPhase(program, phaseId) {
  return (program.phases || []).find((p) => p.id === phaseId) || null;
}

function findFundamental(phase, exId) {
  return (phase.fundamentals || []).find((f) => f.id === exId) || null;
}

function findLevel(fundamental, levelId) {
  return (fundamental.levels || []).find((l) => l.id === levelId) || null;
}

function levelIndex(fundamental, levelId) {
  const idx = (fundamental.levels || []).findIndex((l) => l.id === levelId);
  return idx >= 0 ? idx : 0;
}

function isLevelAtOrAbove(fundamental, currentLevelId, thresholdLevelId) {
  return levelIndex(fundamental, currentLevelId) >= levelIndex(fundamental, thresholdLevelId);
}

/* ---------- Circuit generation (Phase 1) ---------- */
function getCircuitForPhase1(program, progress) {
  const phase = findPhase(program, progress.app.active_phase_id);
  if (!phase) throw new Error("Phase introuvable dans programme.json");

  const order = phase.fundamentals_order || ["pullups", "pushups", "pistols", "plank", "dips", "lsit"];
  const items = [];

  for (const exId of order) {
    const f = findFundamental(phase, exId);
    if (!f) continue;

    const currentLevelId = safeGet(progress, `state.${exId}.current_level_id`, f.levels?.[0]?.id);

    // If program defines circuit_items, use them; else just current main
    const circuitItems = f.circuit_items || [{ kind: "current_level_main" }];

    for (const ci of circuitItems) {
      if (ci.kind === "current_level_main") {
        const lvl = findLevel(f, currentLevelId) || f.levels?.[0];
        items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override }));
      } else if (ci.kind === "fixed_level") {
        const lvl = findLevel(f, ci.level_id);
        if (lvl) items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override, fixed: true }));
      } else if (ci.kind === "conditional_fixed_level") {
        if (isLevelAtOrAbove(f, currentLevelId, ci.only_if_level_is_or_above)) {
          const lvl = findLevel(f, ci.level_id);
          if (lvl) items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override, fixed: true }));
        }
      }
    }
  }

  return { phaseId: phase.id, items };
}

function makeWorkoutItem(exId, exTitle, lvl, opts = {}) {
  const title = opts.titleOverride || `${exTitle} — ${lvl.title}`;
  return {
    item_id: `${exId}:${lvl.id}:${Math.random().toString(16).slice(2)}`,
    exercise_id: exId,
    exercise_title: exTitle,
    level_id: lvl.id,
    level_title: lvl.title,
    measure_type: lvl.type, // reps, hold_sec, reps_each_side, negatives
    validate: lvl.validate || null,
    title
  };
}

/* ---------- Validation + level up proposal ---------- */
function meetsValidation(item, entry) {
  const v = item.validate;
  if (!v) return false;

  // entry shape depends on measure_type
  if (item.measure_type === "reps") {
    return (entry?.value ?? 0) >= (v.reps ?? Infinity);
  }
  if (item.measure_type === "hold_sec") {
    return (entry?.value ?? 0) >= (v.sec ?? Infinity);
  }
  if (item.measure_type === "reps_each_side") {
    const l = entry?.left ?? 0;
    const r = entry?.right ?? 0;
    const t = v.reps ?? Infinity;
    return l >= t && r >= t;
  }
  if (item.measure_type === "negatives") {
    return (entry?.value ?? 0) >= (v.reps ?? Infinity);
  }
  return false;
}

function proposeLevelUps(program, progress, workout) {
  const phase = findPhase(program, progress.app.active_phase_id);
  if (!phase) return [];

  // Only round 1 is reference
  const round1 = workout.rounds?.[0];
  if (!round1) return [];

  // Build map exercise_id -> entries (could have multiple, e.g. pullups has suspension too)
  const byExercise = {};
  for (const e of round1.entries) {
    byExercise[e.exercise_id] ||= [];
    byExercise[e.exercise_id].push(e);
  }

  const proposals = [];

  for (const f of phase.fundamentals || []) {
    const exId = f.id;
    const currentLevelId = safeGet(progress, `state.${exId}.current_level_id`, f.levels?.[0]?.id);
    const idx = levelIndex(f, currentLevelId);
    const next = f.levels?.[idx + 1];
    if (!next) continue;

    // Determine whether current level is validated in round 1
    // Special rule: pullups lvl1 requires BOTH australian + suspension
    if (exId === "pullups" && currentLevelId === "pullups_lvl1") {
      const entries = byExercise[exId] || [];
      const main = entries.find(x => x.level_id === "pullups_lvl1");
      const hang = entries.find(x => x.level_id === "pullups_lvl1bis");
      const okMain = main ? meetsValidation({ measure_type: "reps", validate: { reps: 15 } }, main.entry) : false;
      const okHang = hang ? meetsValidation({ measure_type: "hold_sec", validate: { sec: 30 } }, hang.entry) : false;
      if (okMain && okHang) {
        proposals.push({
          exercise_id: exId,
          from: currentLevelId,
          to: next.id,
          reason: "Tractions niveau 1 + suspension validés au tour 1"
        });
      }
      continue;
    }

    // Generic: check the entry that matches current level
    const entries = byExercise[exId] || [];
    const match = entries.find(x => x.level_id === currentLevelId);
    if (!match) continue;

    const itemTemplate = makeWorkoutItem(exId, f.title, findLevel(f, currentLevelId));
    if (meetsValidation(itemTemplate, match.entry)) {
      proposals.push({
        exercise_id: exId,
        from: currentLevelId,
        to: next.id,
        reason: "Objectif validé au tour 1"
      });
    }
  }

  return proposals;
}

/* ---------- Swipe ---------- */
function attachSwipe(el, onLeft, onRight) {
  let sx = 0, sy = 0, moved = false;
  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; moved = false;
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    moved = true;
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (!moved) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) onLeft?.();
    else onRight?.();
  }, { passive: true });
}

/* ---------- App state ---------- */
let PROGRAM = null;
let PROGRESS = null;

function ensureProgressShape(p) {
  // Add missing structures for older templates
  p.schema_version ||= 1;
  p.app ||= { active_program_id: "programme.json", active_phase_id: "phase1_bases" };
  p.state ||= {};
  p.tests ||= { initial_test: { performed_at: null, results: {} }, retests: [] };
  if (!p.tests.retests) p.tests.retests = [];

  p.last_workout ||= {
    workout_id: null,
    performed_at: null,
    phase_id: p.app.active_phase_id,
    warmup_ids: [],
    session_rules: { rounds: 4, rest_between_exercises_sec: 60, rest_between_rounds_sec: 120 },
    circuit_plan: { items: [] },
    rounds: [],
    completed: false
  };
  if (!p.workout_history) p.workout_history = [];
  return p;
}

async function init() {
  PROGRAM = await loadJSON("./programme.json");

  let p = getProgress();
  if (!p) {
    const tpl = await loadJSON("./progress.json");
    p = tpl;
  }
  PROGRESS = ensureProgressShape(p);
  setProgress(PROGRESS);

  $("#subtitle").textContent = "Données sauvegardées sur ton iPhone (local)";
  renderDashboard();
}

/* ---------- Rendering ---------- */
function render(html) {
  $("#root").innerHTML = html;
}

function formatLevelLabel(program, phaseId, exId, levelId) {
  const phase = findPhase(program, phaseId);
  const f = findFundamental(phase, exId);
  const lvl = findLevel(f, levelId);
  return lvl ? lvl.title : levelId;
}

function dashboardCards() {
  const phaseId = PROGRESS.app.active_phase_id;
  const phase = findPhase(PROGRAM, phaseId);

  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);
  const canStart = initialDone;

  const itemsHtml = (phase.fundamentals_order || []).map(exId => {
    const current = safeGet(PROGRESS, `state.${exId}.current_level_id`, findFundamental(phase, exId)?.levels?.[0]?.id);
    const lvlLabel = formatLevelLabel(PROGRAM, phaseId, exId, current);

    // show last round1 best if last_workout exists
    let lastR1 = "";
    const lw = PROGRESS.last_workout;
    if (lw?.rounds?.length) {
      const r1 = lw.rounds[0];
      const match = r1.entries.filter(e => e.exercise_id === exId);
      if (match.length) {
        // Prefer current level entry if exists
        const curMatch = match.find(m => m.level_id === current) || match[0];
        lastR1 = summarizeEntry(curMatch);
      }
    }

    return `
      <div class="item">
        <div class="left">
          <div class="name">${findFundamental(phase, exId)?.title ?? exId}</div>
          <div class="tiny muted">Niveau actuel : ${escapeHTML(lvlLabel)}</div>
          ${lastR1 ? `<div class="tiny muted">Dernier tour 1 : ${escapeHTML(lastR1)}</div>` : `<div class="tiny muted">Dernier tour 1 : —</div>`}
        </div>
        <div class="badge ${initialDone ? "ok" : "warn"}">${initialDone ? "Prêt" : "Test requis"}</div>
      </div>
    `;
  }).join("");

  const lastWorkoutAt = PROGRESS.last_workout?.performed_at;
  const lastWorkoutBadge = lastWorkoutAt ? `Dernière séance : ${new Date(lastWorkoutAt).toLocaleString()}` : "Aucune séance enregistrée";

  return `
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">${phase?.title ?? "Phase 1"}</div>
            <div class="v">Tableau de bord</div>
          </div>
          <div class="pill">${escapeHTML(lastWorkoutBadge)}</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="primary" ${canStart ? "" : "disabled"} id="btnStart">${canStart ? "Lancer une séance" : "Faire le test initial"}</button>
            ${lastWorkoutAt ? `<button id="btnResume">Reprendre la dernière séance</button>` : ""}
            ${initialDone ? `<button class="ghost" id="btnRetest">Refaire un test (option)</button>` : `<button class="ghost" id="btnTest">Test initial (requis)</button>`}
            <button class="danger" id="btnReset">Reset local (⚠️)</button>
          </div>
          <p class="hint">
            <b>Rappel Phase 1 :</b> circuit technique, 4 tours, repos 45–60s entre exercices et 2 min entre tours.
            <br/>Swipe gauche/droite pendant la séance pour naviguer.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Niveaux & suivi</div>
            <div class="v">Tes fondamentaux</div>
          </div>
        </div>
        <div class="bd">
          <div class="list">${itemsHtml}</div>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  render(dashboardCards());

  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  $("#btnReset").onclick = () => {
    localStorage.removeItem(LS_KEY);
    toast("Reset OK. Recharge la page.");
  };

  const btnStart = $("#btnStart");
  if (btnStart) {
    btnStart.onclick = () => {
      if (!initialDone) {
        renderTestFlow({ mode: "initial" });
      } else {
        startWorkout({ resume: false });
      }
    };
  }

  const btnTest = $("#btnTest");
  if (btnTest) btnTest.onclick = () => renderTestFlow({ mode: "initial" });

  const btnRetest = $("#btnRetest");
  if (btnRetest) btnRetest.onclick = () => renderTestFlow({ mode: "retest" });

  const btnResume = $("#btnResume");
  if (btnResume) btnResume.onclick = () => startWorkout({ resume: true });
}

/* ---------- Test flow ---------- */
function renderTestFlow({ mode }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const ctx = {
    mode, // initial | retest
    exIdx: 0,
    levelIdx: 0,
    results: {} // by exercise_id
  };
  renderTestScreen(ctx);
}

function renderTestScreen(ctx) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];

  const exId = order[ctx.exIdx];
  const f = findFundamental(phase, exId);
  const level = f.levels[ctx.levelIdx];

  const head = ctx.mode === "initial" ? "Test initial (requis)" : "Re-test (option)";
  const explain = "Teste les niveaux dans l’ordre. Dès que tu n’atteins pas l’objectif, l’app enregistre ton niveau actuel.";

  const levelGoal = formatValidate(level);

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
          <div class="workoutTop">
            <div class="progress"><div style="width:${Math.round(((ctx.exIdx) / order.length) * 100)}%"></div></div>
          </div>

          <div class="workoutCard" id="swipeArea">
            <h2>${escapeHTML(level.title)}</h2>
            <div class="sub">${escapeHTML(levelGoal)}</div>

            <div class="meta">
              <div class="chip">Niveau ${ctx.levelIdx + 1}/${f.levels.length}</div>
              <div class="chip">Swipe gauche: niveau suivant</div>
              <div class="chip">Swipe droite: retour</div>
            </div>

            <div class="entry">
              ${renderEntryFields(level.type)}
              <div class="field">
                <label>Note (optionnel)</label>
                <textarea id="note" placeholder="Ex: élastique vert / banc / amplitude…"></textarea>
              </div>
            </div>

            <div class="footerBar">
              <button class="ghost" id="btnBack">Retour</button>
              <button id="btnFail" class="danger">Je bloque ici</button>
              <button id="btnPass" class="primary">Objectif atteint</button>
            </div>

            <div class="hint">
              ${escapeHTML(explain)}<br/>
              Astuce: “Je bloque ici” enregistre ce niveau comme ton niveau actuel (et ton score).
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  const swipeArea = $("#swipeArea");
  attachSwipe(
    swipeArea,
    () => $("#btnPass")?.click(),
    () => $("#btnBack")?.click()
  );

  $("#btnBack").onclick = () => {
    // go back within levels/exercises
    if (ctx.levelIdx > 0) {
      ctx.levelIdx--;
      renderTestScreen(ctx);
      return;
    }
    if (ctx.exIdx > 0) {
      ctx.exIdx--;
      // back to last level of previous ex? keep simple: go to its first level
      ctx.levelIdx = 0;
      renderTestScreen(ctx);
      return;
    }
    renderDashboard();
  };

  $("#btnPass").onclick = () => {
    // store this level attempt as "passed" (optional tracking)
    const entry = readEntryFromFields(level.type);
    const note = $("#note").value || "";

    ctx.results[exId] ||= [];
    ctx.results[exId].push({
      level_id: level.id,
      status: "passed",
      entry,
      note
    });

    // Special case pullups lvl1 requires also suspension to be tested before considering pass,
    // but in test flow we follow program order; user can pass lvl1 then continue to lvl1bis etc.
    if (ctx.levelIdx < f.levels.length - 1) {
      ctx.levelIdx++;
      renderTestScreen(ctx);
    } else {
      // if user passed all levels (rare), set current to last
      applyTestLockIn({ ctx, exId, f, levelLocked: f.levels[f.levels.length - 1], baselineEntry: entry, baselineNote: note });
      nextExerciseOrFinish(ctx);
    }
  };

  $("#btnFail").onclick = () => {
    const entry = readEntryFromFields(level.type);
    const note = $("#note").value || "";

    // lock in this level as current, baseline = entry
    applyTestLockIn({ ctx, exId, f, levelLocked: level, baselineEntry: entry, baselineNote: note });

    nextExerciseOrFinish(ctx);
  };
}

function nextExerciseOrFinish(ctx) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];

  if (ctx.exIdx < order.length - 1) {
    ctx.exIdx++;
    ctx.levelIdx = 0;
    renderTestScreen(ctx);
    return;
  }

  // Finish test
  const record = {
    performed_at: nowISO(),
    results: ctx.results
  };

  if (ctx.mode === "initial") {
    PROGRESS.tests.initial_test = record;
    toast("Test initial enregistré");
  } else {
    PROGRESS.tests.retests.push(record);
    toast("Re-test enregistré");
  }

  setProgress(PROGRESS);
  renderDashboard();
}

function applyTestLockIn({ ctx, exId, f, levelLocked, baselineEntry, baselineNote }) {
  // For pullups lvl1: we want to keep current at lvl1 even if user passes lvl1 but fails lvl1bis,
  // but locking mechanism is already "block level". That's fine.

  PROGRESS.state[exId] ||= {};
  PROGRESS.state[exId].current_level_id = levelLocked.id;
  PROGRESS.state[exId].notes = baselineNote || "";
  PROGRESS.state[exId].last_updated_at = nowISO();

  // baseline storage (main / aux)
  if (exId === "pullups") {
    // Main baseline stored in main. Suspension baseline stored in aux when level is that one.
    if (levelLocked.id === "pullups_lvl1bis") {
      PROGRESS.state.pullups.baseline ||= {};
      PROGRESS.state.pullups.baseline.aux = { type: "hold_sec", value: baselineEntry.value ?? null };
    } else {
      PROGRESS.state.pullups.baseline ||= {};
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

  setProgress(PROGRESS);
}

/* ---------- Workout flow ---------- */
function startWorkout({ resume }) {
  const phaseId = PROGRESS.app.active_phase_id;
  const phase = findPhase(PROGRAM, phaseId);

  let workout = null;

  if (resume && PROGRESS.last_workout?.workout_id && !PROGRESS.last_workout.completed) {
    workout = deepClone(PROGRESS.last_workout);
    toast("Séance reprise");
  } else {
    // create new workout
    const plan = getCircuitForPhase1(PROGRAM, PROGRESS);
    workout = {
      workout_id: `w-${Date.now()}`,
      performed_at: nowISO(),
      phase_id: phase.id,
      warmup_ids: [],
      session_rules: {
        rounds: phase.session_rules.rounds,
        rest_between_exercises_sec: phase.session_rules.rest_between_exercises_sec.max,
        rest_between_rounds_sec: phase.session_rules.rest_between_rounds_sec
      },
      circuit_plan: plan,
      rounds: Array.from({ length: phase.session_rules.rounds }, () => ({ entries: [] })),
      completed: false
    };

    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);
  }

  renderWorkoutScreen(workout, { round: 0, idx: 0, restTimer: null });
}

function summarizeEntry(e) {
  if (!e) return "";
  const t = e.measure_type;
  const en = e.entry || {};
  if (t === "reps" || t === "negatives") return `${en.value ?? "—"} reps`;
  if (t === "hold_sec") return `${en.value ?? "—"} sec`;
  if (t === "reps_each_side") return `G ${en.left ?? "—"} / D ${en.right ?? "—"}`;
  return "—";
}

function renderWorkoutScreen(workout, nav) {
  const total = workout.session_rules.rounds * workout.circuit_plan.items.length;
  const pos = nav.round * workout.circuit_plan.items.length + nav.idx + 1;
  const pct = Math.round((pos / total) * 100);

  const item = workout.circuit_plan.items[nav.idx];
  const roundNum = nav.round + 1;

  const already = workout.rounds?.[nav.round]?.entries?.find(x => x.item_id === item.item_id) || null;

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
              <div class="tiny muted">Repos exos : ${workout.session_rules.rest_between_exercises_sec}s • Repos tours : ${workout.session_rules.rest_between_rounds_sec}s</div>
              <button class="ghost" id="btnDash">Dashboard</button>
            </div>
          </div>

          <div class="workoutCard" id="swipeArea">
            <h2>${escapeHTML(item.title)}</h2>
            <div class="sub">${escapeHTML(formatValidate({ type: item.measure_type, validate: item.validate }))}</div>

            <div class="meta">
              <div class="chip">${escapeHTML(item.exercise_title)}</div>
              <div class="chip">Swipe gauche: suivant</div>
              <div class="chip">Swipe droite: précédent</div>
            </div>

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
              <button id="btnSave" class="primary">Valider & Repos</button>
              <button class="danger" id="btnFinish">Terminer</button>
            </div>

            <div class="hint center" id="restHint"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  // Prefill fallback/note if existing
  if (already) {
    $("#fallback").value = already.fallback || "";
    $("#note").value = already.note || "";
  }

  $("#btnDash").onclick = () => {
    // Save snapshot then go dashboard
    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);
    renderDashboard();
  };

  $("#btnPrev").onclick = () => goPrev(workout, nav);
  $("#btnFinish").onclick = () => finishWorkout(workout);

  const swipeArea = $("#swipeArea");
  attachSwipe(
    swipeArea,
    () => goNext(workout, nav, { allowIfNoSave: false }),  // swipe left = next, require save?
    () => goPrev(workout, nav)
  );

  $("#btnSave").onclick = () => {
    const entry = readEntryFromFields(item.measure_type);
    const fallback = ($("#fallback").value || "").trim();
    const note = ($("#note").value || "").trim();

    const roundObj = workout.rounds[nav.round];
    const existingIdx = roundObj.entries.findIndex(x => x.item_id === item.item_id);

    const record = {
      item_id: item.item_id,
      exercise_id: item.exercise_id,
      level_id: item.level_id,
      measure_type: item.measure_type,
      entry,
      fallback,
      note,
      saved_at: nowISO()
    };

    if (existingIdx >= 0) roundObj.entries[existingIdx] = record;
    else roundObj.entries.push(record);

    // Save partial into progress for persistence
    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);

    // Start rest timer then auto-advance
    const rest = (nav.idx === workout.circuit_plan.items.length - 1)
      ? workout.session_rules.rest_between_rounds_sec
      : workout.session_rules.rest_between_exercises_sec;

    runRestTimer(rest, () => {
      goNext(workout, nav, { allowIfNoSave: true });
    });
  };
}

function runRestTimer(seconds, onDone) {
  const el = $("#restHint");
  if (!el) return onDone?.();

  let t = seconds;
  el.textContent = `Repos : ${t}s`;
  clearInterval(runRestTimer._int);

  runRestTimer._int = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(runRestTimer._int);
      el.textContent = "";
      toast("Go !");
      onDone?.();
      return;
    }
    el.textContent = `Repos : ${t}s`;
  }, 1000);
}

function goPrev(workout, nav) {
  clearInterval(runRestTimer._int);

  if (nav.idx > 0) {
    nav.idx--;
    renderWorkoutScreen(workout, nav);
    return;
  }
  if (nav.round > 0) {
    nav.round--;
    nav.idx = workout.circuit_plan.items.length - 1;
    renderWorkoutScreen(workout, nav);
    return;
  }
  toast("Début de séance");
}

function goNext(workout, nav, { allowIfNoSave }) {
  clearInterval(runRestTimer._int);

  // If not allowing move without save, check current item saved
  if (!allowIfNoSave) {
    const item = workout.circuit_plan.items[nav.idx];
    const roundObj = workout.rounds[nav.round];
    const exists = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!exists) {
      toast("Enregistre d’abord le résultat (Valider & Repos)");
      return;
    }
  }

  if (nav.idx < workout.circuit_plan.items.length - 1) {
    nav.idx++;
    renderWorkoutScreen(workout, nav);
    return;
  }
  // end of round
  if (nav.round < workout.session_rules.rounds - 1) {
    nav.round++;
    nav.idx = 0;
    renderWorkoutScreen(workout, nav);
    return;
  }

  // End of workout
  finishWorkout(workout);
}

function finishWorkout(workout) {
  clearInterval(runRestTimer._int);

  workout.completed = true;

  // Save to history and last_workout
  PROGRESS.workout_history.unshift(deepClone(workout));
  PROGRESS.last_workout = deepClone(workout);

  // Propose level ups (non-forcing)
  const proposals = proposeLevelUps(PROGRAM, PROGRESS, workout);

  // Apply proposals automatically? Better: ask.
  // Here: ask with confirm (simple)
  if (proposals.length) {
    const lines = proposals.map(p => `• ${p.exercise_id}: ${p.from} → ${p.to}`).join("\n");
    const ok = confirm(
      "Objectifs validés au tour 1.\n\nMonter de niveau pour la prochaine séance ?\n\n" + lines
    );
    if (ok) {
      for (const p of proposals) {
        PROGRESS.state[p.exercise_id].current_level_id = p.to;
        PROGRESS.state[p.exercise_id].last_updated_at = nowISO();
      }
      toast("Niveaux mis à jour");
    } else {
      toast("Niveaux inchangés");
    }
  } else {
    toast("Séance enregistrée");
  }

  setProgress(PROGRESS);
  renderDashboard();
}

/* ---------- Entry fields ---------- */
function renderEntryFields(type, existingEntry = null) {
  if (type === "reps" || type === "negatives") {
    const val = existingEntry?.value ?? "";
    return `
      <div class="field">
        <label>Répétitions</label>
        <input id="v" inputmode="numeric" placeholder="Ex: 8" value="${escapeAttr(val)}" />
      </div>
    `;
  }
  if (type === "hold_sec") {
    const val = existingEntry?.value ?? "";
    return `
      <div class="field">
        <label>Temps (secondes)</label>
        <input id="v" inputmode="numeric" placeholder="Ex: 30" value="${escapeAttr(val)}" />
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
          <input id="l" inputmode="numeric" placeholder="Ex: 5" value="${escapeAttr(l)}" />
        </div>
        <div class="field">
          <label>Droite (reps)</label>
          <input id="r" inputmode="numeric" placeholder="Ex: 5" value="${escapeAttr(r)}" />
        </div>
      </div>
    `;
  }
  // fallback
  return `
    <div class="field">
      <label>Valeur</label>
      <input id="v" inputmode="numeric" placeholder="Ex: 10" />
    </div>
  `;
}

function readEntryFromFields(type) {
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

/* ---------- Formatting validate text ---------- */
function formatValidate(levelOrItem) {
  const type = levelOrItem.type || levelOrItem.measure_type;
  const v = levelOrItem.validate;

  if (!v) return "Saisis ton résultat";

  if (type === "reps") return `Objectif: ${v.reps} reps${v.note ? " — " + v.note : ""}`;
  if (type === "hold_sec") return `Objectif: ${v.sec}s${v.note ? " — " + v.note : ""}`;
  if (type === "reps_each_side") return `Objectif: ${v.reps} reps / côté${v.note ? " — " + v.note : ""}`;
  if (type === "negatives") {
    const extra = [];
    if (v.each_rep_min_sec) extra.push(`${v.each_rep_min_sec}s min/rep`);
    if (v.pause_anywhere_sec) extra.push(`pause ${v.pause_anywhere_sec}s`);
    return `Objectif: ${v.reps} reps${extra.length ? " — " + extra.join(", ") : ""}`;
  }
  return "Saisis ton résultat";
}

/* ---------- HTML escaping ---------- */
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHTML(s).replaceAll("\n", " ");
}

/* ---------- Start ---------- */
init().catch((e) => {
  console.error(e);
  $("#subtitle").textContent = "Erreur : " + e.message;
  render(`<div class="card"><div class="bd">Erreur: ${escapeHTML(e.message)}</div></div>`);
});
