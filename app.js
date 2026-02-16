/* ---------- Storage ---------- */
const LS_KEY = "calisthenics_progress_v1";

/* ---------- Utils ---------- */
const $ = (sel) => document.querySelector(sel);

function nowISO() { return new Date().toISOString(); }
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

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
  } catch { return fallback; }
}

function setProgress(p) { localStorage.setItem(LS_KEY, JSON.stringify(p)); }
function getProgress() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} introuvable`);
  return await res.json();
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHTML(s).replaceAll("\n", " "); }

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

/* ---------- Warmup helpers ---------- */
function getWarmup(program, warmupId) {
  return (program.warmups || []).find(w => w.id === warmupId) || null;
}

// Small default lists for warmup slot selection
const WARMUP_SLOTS = {
  pull: [
    "Tractions australiennes",
    "Row australien",
    "Tractions élastique",
    "Scapular pull-ups",
    "Dead hang actif"
  ],
  push: [
    "Pompes",
    "Pompes inclinées",
    "Pompes genoux",
    "Dips assistés",
    "Pike push-ups"
  ]
};

/* ---------- Circuit generation (Phase 1) ---------- */
function makeWorkoutItem(exId, exTitle, lvl, opts = {}) {
  const title = opts.titleOverride || `${exTitle} — ${lvl.title}`;
  return {
    item_id: `${exId}:${lvl.id}:${Math.random().toString(16).slice(2)}`,
    exercise_id: exId,
    exercise_title: exTitle,
    level_id: lvl.id,
    level_title: lvl.title,
    measure_type: lvl.type,
    validate: lvl.validate || null,
    title
  };
}

function getCircuitForPhase1(program, progress, selectedExerciseIds) {
  const phase = findPhase(program, progress.app.active_phase_id);
  if (!phase) throw new Error("Phase introuvable dans programme.json");

  const order = phase.fundamentals_order || ["pullups","pushups","pistols","plank","dips","lsit"];
  const allow = new Set(selectedExerciseIds && selectedExerciseIds.length ? selectedExerciseIds : order);

  const items = [];

  for (const exId of order) {
    if (!allow.has(exId)) continue;

    const f = findFundamental(phase, exId);
    if (!f) continue;

    const currentLevelId = safeGet(progress, `state.${exId}.current_level_id`, f.levels?.[0]?.id);
    const circuitItems = f.circuit_items || [{ kind: "current_level_main" }];

    for (const ci of circuitItems) {
      if (ci.kind === "current_level_main") {
        const lvl = findLevel(f, currentLevelId) || f.levels?.[0];
        items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override }));
      } else if (ci.kind === "fixed_level") {
        const lvl = findLevel(f, ci.level_id);
        if (lvl) items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override }));
      } else if (ci.kind === "conditional_fixed_level") {
        if (isLevelAtOrAbove(f, currentLevelId, ci.only_if_level_is_or_above)) {
          const lvl = findLevel(f, ci.level_id);
          if (lvl) items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override }));
        }
      }
    }
  }

  return { phaseId: phase.id, items };
}

/* ---------- Validation + level up proposal ---------- */
function meetsValidation(item, entry) {
  const v = item.validate;
  if (!v) return false;

  if (item.measure_type === "reps") return (entry?.value ?? 0) >= (v.reps ?? Infinity);
  if (item.measure_type === "hold_sec") return (entry?.value ?? 0) >= (v.sec ?? Infinity);
  if (item.measure_type === "reps_each_side") {
    const t = v.reps ?? Infinity;
    return (entry?.left ?? 0) >= t && (entry?.right ?? 0) >= t;
  }
  if (item.measure_type === "negatives") return (entry?.value ?? 0) >= (v.reps ?? Infinity);
  return false;
}

function proposeLevelUps(program, progress, workout) {
  const phase = findPhase(program, progress.app.active_phase_id);
  if (!phase) return [];
  const round1 = workout.rounds?.[0];
  if (!round1) return [];

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

    // Special pullups lvl1 combo required: australian + hang
    if (exId === "pullups" && currentLevelId === "pullups_lvl1") {
      const entries = byExercise[exId] || [];
      const main = entries.find(x => x.level_id === "pullups_lvl1");
      const hang = entries.find(x => x.level_id === "pullups_lvl1bis");
      const okMain = main ? (main.entry?.value ?? 0) >= 15 : false;
      const okHang = hang ? (hang.entry?.value ?? 0) >= 30 : false;
      if (okMain && okHang) {
        proposals.push({ exercise_id: exId, from: currentLevelId, to: next.id, reason: "Tractions niveau 1 + suspension validés (tour 1)" });
      }
      continue;
    }

    const entries = byExercise[exId] || [];
    const match = entries.find(x => x.level_id === currentLevelId);
    if (!match) continue;

    const itemTemplate = { measure_type: match.measure_type, validate: findLevel(f, currentLevelId)?.validate || null };
    if (meetsValidation(itemTemplate, match.entry)) {
      proposals.push({ exercise_id: exId, from: currentLevelId, to: next.id, reason: "Objectif validé (tour 1)" });
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
  el.addEventListener("touchmove", () => { moved = true; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!moved) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) onLeft?.(); else onRight?.();
  }, { passive: true });
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
function formatValidate(type, validate) {
  const v = validate;
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

/* ---------- History helpers (best round1) ---------- */
function numericValueForBest(e) {
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

function bestRound1ForExercise(exId) {
  let best = null;
  for (const w of (PROGRESS.workout_history || [])) {
    const r1 = w.rounds?.[0];
    if (!r1) continue;
    const matches = r1.entries.filter(x => x.exercise_id === exId);
    if (!matches.length) continue;

    // Prefer main entries for pullups and lsit
    let pick = matches[0];
    if (exId === "pullups") pick = matches.find(m => m.level_id !== "pullups_lvl1bis") || matches[0];
    if (exId === "lsit") pick = matches.find(m => m.level_id !== "lsit_lvl2bis") || matches[0];

    const val = numericValueForBest(pick);
    if (val == null) continue;
    if (!best || val > best.val) best = { val, measure_type: pick.measure_type };
  }
  return best;
}

/* ---------- Export / Import ---------- */
function exportProgress() {
  const data = JSON.stringify(PROGRESS, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `progress_export_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Export prêt ✅");
}

function importProgressFromFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(String(r.result || ""))); }
      catch { reject(new Error("Fichier JSON invalide")); }
    };
    r.onerror = () => reject(new Error("Impossible de lire le fichier"));
    r.readAsText(file);
  });
}

/* ---------- App state ---------- */
let PROGRAM = null;
let PROGRESS = null;

function ensureProgressShape(p) {
  p.schema_version ||= 1;
  p.app ||= { active_program_id: "programme.json", active_phase_id: "phase1_bases" };
  p.state ||= {};
  p.tests ||= { initial_test: { performed_at: null, results: {} }, retests: [] };
  if (!p.tests.retests) p.tests.retests = [];

  // Settings / defaults
  p.settings ||= {
    rest_between_exercises_sec: 60,
    rest_between_rounds_sec: 120,
    warmup_default_upper: "warmup_upper_5min",
    warmup_default_lower: "warmup_lower_3min",
    warmup_slot_choices: { pull: WARMUP_SLOTS.pull[0], push: WARMUP_SLOTS.push[0] },
    last_session_setup: null
  };

  p.last_workout ||= {
    workout_id: null,
    performed_at: null,
    phase_id: p.app.active_phase_id,
    warmup_ids: [],
    session_rules: { rounds: 4, rest_between_exercises_sec: 60, rest_between_rounds_sec: 120 },
    circuit_plan: { items: [] },
    rounds: [],
    completed: false,
    setup: null
  };

  if (!p.workout_history) p.workout_history = [];
  return p;
}

function render(html) { $("#root").innerHTML = html; }

/* ---------- Session setup screen ---------- */
function defaultSelectionForFocus(focus) {
  // You can tweak defaults later; user can always check/uncheck.
  if (focus === "pull") return ["pullups", "pistols", "plank", "lsit"];
  if (focus === "push") return ["pushups", "pistols", "plank", "dips"];
  return ["pullups","pushups","pistols","plank","dips","lsit"];
}

function renderSessionSetup({ mode }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  const last = PROGRESS.settings.last_session_setup;
  const focus = last?.focus || "all";
  const selected = new Set(last?.selectedExercises || defaultSelectionForFocus(focus));

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

  const warmUpper = PROGRESS.settings.warmup_default_upper;
  const warmLower = PROGRESS.settings.warmup_default_lower;

  const pullChoice = PROGRESS.settings.warmup_slot_choices?.pull || WARMUP_SLOTS.pull[0];
  const pushChoice = PROGRESS.settings.warmup_slot_choices?.push || WARMUP_SLOTS.push[0];

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
            <button class="ghost" id="btnBack">Retour</button>
            <button class="primary" id="btnGo">${mode === "test" ? "Aller au test" : "Démarrer"}</button>
          </div>
          <p class="hint">
            L’échauffement est proposé <b>avant</b> le test et avant la séance.
            Repos par défaut: <b>60s</b> (tu peux passer le repos avec swipe/bouton).
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
            <button class="${focus==="pull"?"primary":""}" id="focusPull">Pull</button>
            <button class="${focus==="push"?"primary":""}" id="focusPush">Push</button>
            <button class="${focus==="all"?"primary":""}" id="focusAll">Tout</button>
          </div>
          <p class="hint">Le focus ne force rien : tu peux cocher/décocher les exercices ci-dessous.</p>
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
            <div class="k">Échauffement</div>
            <div class="v">Slots Pull / Push</div>
          </div>
        </div>
        <div class="bd">
          <div class="field">
            <label>Exercice Pull (échauffement haut du corps)</label>
            <select id="slotPull">
              ${WARMUP_SLOTS.pull.map(x => `<option ${x===pullChoice?"selected":""}>${escapeHTML(x)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Exercice Push (échauffement haut du corps)</label>
            <select id="slotPush">
              ${WARMUP_SLOTS.push.map(x => `<option ${x===pushChoice?"selected":""}>${escapeHTML(x)}</option>`).join("")}
            </select>
          </div>
          <p class="hint">Ces choix seront mémorisés et réutilisés séance après séance.</p>
        </div>
      </div>
    </div>
  `);

  $("#btnBack").onclick = () => renderDashboard();

  const setFocusAndDefaults = (newFocus) => {
    // set focus + auto defaults but keep user freedom afterwards
    const defaults = defaultSelectionForFocus(newFocus);
    const list = $("#exList");
    for (const cb of list.querySelectorAll("input[type=checkbox][data-ex]")) {
      cb.checked = defaults.includes(cb.getAttribute("data-ex"));
    }
    // re-render setup screen (simpler)
    PROGRESS.settings.last_session_setup = {
      focus: newFocus,
      selectedExercises: defaults
    };
    setProgress(PROGRESS);
    renderSessionSetup({ mode });
  };

  $("#focusPull").onclick = () => setFocusAndDefaults("pull");
  $("#focusPush").onclick = () => setFocusAndDefaults("push");
  $("#focusAll").onclick  = () => setFocusAndDefaults("all");

  $("#btnGo").onclick = () => {
    // collect selection
    const selectedExercises = [];
    for (const cb of $("#exList").querySelectorAll("input[type=checkbox][data-ex]")) {
      if (cb.checked) selectedExercises.push(cb.getAttribute("data-ex"));
    }
    if (!selectedExercises.length) {
      toast("Choisis au moins 1 exercice");
      return;
    }

    // save warmup slot choices
    PROGRESS.settings.warmup_slot_choices = {
      pull: $("#slotPull").value,
      push: $("#slotPush").value
    };

    const focusNow = PROGRESS.settings.last_session_setup?.focus || "all";
    PROGRESS.settings.last_session_setup = { focus: focusNow, selectedExercises };

    setProgress(PROGRESS);

    // Warmup prompt first
    renderWarmupPrompt({
      next: () => {
        if (mode === "test") {
          renderTestFlow({ mode: initialDone ? "retest" : "initial" });
        } else {
          startWorkout({ resume: false, selectedExercises, setup: PROGRESS.settings.last_session_setup });
        }
      }
    });
  };
}

/* ---------- Warmup prompt + warmup runner ---------- */
function renderWarmupPrompt({ next }) {
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
            <button class="primary" id="btnWarm">Commencer par l’échauffement</button>
            <button class="ghost" id="btnSkip">Passer</button>
          </div>
          <p class="hint">
            L’échauffement haut du corps inclut un slot Pull/Push basé sur tes choix.
          </p>
        </div>
      </div>
    </div>
  `);

  $("#btnSkip").onclick = () => next?.();
  $("#btnWarm").onclick = () => {
    // Decide warmups: always offer upper, and lower if legs selected
    const setup = PROGRESS.settings.last_session_setup;
    const selected = new Set(setup?.selectedExercises || []);
    const warmups = [];

    // Upper if any pull/push/upper related selected
    warmups.push(PROGRESS.settings.warmup_default_upper);

    // Lower if pistols selected
    if (selected.has("pistols")) warmups.push(PROGRESS.settings.warmup_default_lower);

    runWarmups(warmups, () => next?.());
  };
}

function runWarmups(warmupIds, onDone) {
  const warmups = warmupIds.map(id => getWarmup(PROGRAM, id)).filter(Boolean);
  const flatSteps = [];
  for (const w of warmups) {
    for (const s of (w.steps || [])) {
      flatSteps.push({ warmup_id: w.id, warmup_title: w.title, step: s });
    }
  }

  let idx = 0;

  const renderStep = () => {
    const cur = flatSteps[idx];
    if (!cur) return onDone?.();

    const s = cur.step;
    const slotPull = PROGRESS.settings.warmup_slot_choices?.pull || WARMUP_SLOTS.pull[0];
    const slotPush = PROGRESS.settings.warmup_slot_choices?.push || WARMUP_SLOTS.push[0];

    let line = "";
    if (s.type === "reps_both_directions") line = `${s.reps_min}-${s.reps_max} / sens`;
    else if (s.type === "reps_each_side") line = `${s.reps_min}-${s.reps_max} / côté`;
    else if (s.type === "reps_each_angle") line = `${s.reps} / angle`;
    else if (s.type === "timer") line = `${s.duration_sec}s`;
    else if (s.type === "exercise_slot") {
      const chosen = s.slot === "pull" ? slotPull : slotPush;
      line = `${chosen} — ${s.reps_min}-${s.reps_max} reps`;
    } else line = "—";

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
              <div class="sub">${escapeHTML(line)}</div>

              <div class="meta">
                <div class="chip">Swipe gauche: suivant</div>
                <div class="chip">Swipe droite: précédent</div>
              </div>

              <div class="footerBar">
                <button class="ghost" id="btnPrev">Précédent</button>
                <button class="primary" id="btnNext">Suivant</button>
                <button class="danger" id="btnDone">Terminer</button>
              </div>

              <div class="hint center">Objectif: max 5 min (haut) / 3 min (bas). Tu swipes quand tu as fini.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    attachSwipe($("#swipeArea"), () => $("#btnNext")?.click(), () => $("#btnPrev")?.click());

    $("#btnPrev").onclick = () => { if (idx > 0) { idx--; renderStep(); } else toast("Début échauffement"); };
    $("#btnNext").onclick = () => { if (idx < flatSteps.length - 1) { idx++; renderStep(); } else onDone?.(); };
    $("#btnDone").onclick = () => onDone?.();
  };

  renderStep();
}

/* ---------- Test flow ---------- */
function renderTestFlow({ mode }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const ctx = { mode, exIdx: 0, levelIdx: 0, results: {} };
  renderTestScreen(ctx);
}

function renderTestScreen(ctx) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const exId = order[ctx.exIdx];
  const f = findFundamental(phase, exId);
  const level = f.levels[ctx.levelIdx];

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

            <div class="entry">
              ${renderEntryFields(level.type)}
              <div class="field">
                <label>Note (optionnel)</label>
                <textarea id="note" placeholder="Ex: élastique vert / banc / amplitude…"></textarea>
              </div>
            </div>

            <div class="footerBar">
              <button class="ghost" id="btnBack">Retour</button>
              <button class="danger" id="btnFail">Je bloque ici</button>
              <button class="primary" id="btnPass">Objectif atteint</button>
            </div>

            <div class="hint">Swipe gauche = “Objectif atteint”, swipe droite = “Retour”.</div>
          </div>
        </div>
      </div>
    </div>
  `);

  attachSwipe($("#swipeArea"), () => $("#btnPass")?.click(), () => $("#btnBack")?.click());

  $("#btnBack").onclick = () => {
    if (ctx.levelIdx > 0) { ctx.levelIdx--; return renderTestScreen(ctx); }
    if (ctx.exIdx > 0) { ctx.exIdx--; ctx.levelIdx = 0; return renderTestScreen(ctx); }
    renderDashboard();
  };

  $("#btnPass").onclick = () => {
    const entry = readEntryFromFields(level.type);
    const note = ($("#note").value || "").trim();
    ctx.results[exId] ||= [];
    ctx.results[exId].push({ level_id: level.id, status: "passed", entry, note });

    if (ctx.levelIdx < f.levels.length - 1) {
      ctx.levelIdx++;
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

function nextExerciseOrFinish(ctx) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  if (ctx.exIdx < order.length - 1) {
    ctx.exIdx++;
    ctx.levelIdx = 0;
    return renderTestScreen(ctx);
  }

  const record = { performed_at: nowISO(), results: ctx.results };
  if (ctx.mode === "initial") PROGRESS.tests.initial_test = record;
  else PROGRESS.tests.retests.push(record);

  setProgress(PROGRESS);
  toast(ctx.mode === "initial" ? "Test initial enregistré ✅" : "Re-test enregistré ✅");
  renderDashboard();
}

function applyTestLockIn(exId, levelLocked, baselineEntry, baselineNote) {
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

/* ---------- Fallback helper (C) ---------- */
function isBelowFallbackThreshold(phase, item, entry) {
  const repsTh = phase.fallback_rules?.reps_threshold ?? 3;
  const holdTh = phase.fallback_rules?.hold_threshold_sec ?? 5;

  if (item.measure_type === "reps" || item.measure_type === "negatives") return (entry?.value ?? 0) <= repsTh;
  if (item.measure_type === "hold_sec") return (entry?.value ?? 0) <= holdTh;
  if (item.measure_type === "reps_each_side") return (entry?.left ?? 0) <= repsTh || (entry?.right ?? 0) <= repsTh;
  return false;
}

function suggestFallback(program, progress, item) {
  const phase = findPhase(program, progress.app.active_phase_id);
  const f = findFundamental(phase, item.exercise_id);
  if (!f) return null;

  const cur = safeGet(progress, `state.${item.exercise_id}.current_level_id`, f.levels?.[0]?.id);
  const idx = levelIndex(f, cur);
  const prev = f.levels?.[Math.max(0, idx - 1)];
  if (!prev || prev.id === item.level_id) return null;

  if (item.exercise_id === "pullups" && item.level_id === "pullups_lvl4") return "2 tractions + 3 tractions négatives";
  if (item.exercise_id === "pullups" && item.level_id === "pullups_lvl3") return "2 tractions négatives + 5 tractions australiennes";
  return `Complément : ${prev.title}`;
}

/* ---------- Workout flow + rest skip + best display ---------- */
let restInterval = null;
let restRunning = false;

function runRestTimer(seconds, onDone) {
  const el = $("#restHint");
  if (!el) return onDone?.();

  restRunning = true;
  let t = seconds;
  el.textContent = `Repos : ${t}s (swipe gauche pour passer)`;
  clearInterval(restInterval);

  restInterval = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(restInterval);
      restRunning = false;
      el.textContent = "";
      toast("Go !");
      onDone?.();
      return;
    }
    el.textContent = `Repos : ${t}s (swipe gauche pour passer)`;
  }, 1000);
}

function stopRest(onDone) {
  clearInterval(restInterval);
  restRunning = false;
  const el = $("#restHint");
  if (el) el.textContent = "";
  onDone?.();
}

function startWorkout({ resume, selectedExercises, setup }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);
  if (!initialDone) {
    // propose warmup+test via setup screen
    return renderSessionSetup({ mode: "test" });
  }

  let workout = null;

  if (resume && PROGRESS.last_workout?.workout_id && !PROGRESS.last_workout.completed) {
    workout = deepClone(PROGRESS.last_workout);
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
      setup: setup || PROGRESS.settings.last_session_setup || null
    };
    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);
  }

  renderWorkoutScreen(workout, { round: 0, idx: 0 });
}

function renderWorkoutScreen(workout, nav) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);

  const total = workout.session_rules.rounds * workout.circuit_plan.items.length;
  const pos = nav.round * workout.circuit_plan.items.length + nav.idx + 1;
  const pct = Math.round((pos / total) * 100);

  const item = workout.circuit_plan.items[nav.idx];
  const roundNum = nav.round + 1;

  const roundObj = workout.rounds[nav.round];
  const already = roundObj.entries.find(x => x.item_id === item.item_id) || null;

  const best = bestRound1ForExercise(item.exercise_id);
  const bestLine = best ? `Meilleur tour 1: ${best.val}${best.measure_type === "hold_sec" ? "s" : ""}` : "Meilleur tour 1: —";

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
              <button class="ghost" id="btnDash">Dashboard</button>
            </div>
          </div>

          <div class="workoutCard" id="swipeArea">
            <h2>${escapeHTML(item.title)}</h2>
            <div class="sub">${escapeHTML(formatValidate(item.measure_type, item.validate))}</div>

            <div class="meta">
              <div class="chip">${escapeHTML(item.exercise_title)}</div>
              <div class="chip">${escapeHTML(bestLine)}</div>
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
              <button class="primary" id="btnSave">Valider & Repos</button>
              <button class="ghost" id="btnSkipRest">Passer le repos</button>
              <button class="danger" id="btnFinish">Terminer</button>
            </div>

            <div class="hint center" id="restHint"></div>
          </div>
        </div>
      </div>
    </div>
  `);

  if (already) {
    $("#fallback").value = already.fallback || "";
    $("#note").value = already.note || "";
  }

  $("#btnDash").onclick = () => {
    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);
    renderDashboard();
  };

  $("#btnPrev").onclick = () => goPrev(workout, nav);
  $("#btnFinish").onclick = () => finishWorkout(workout);

  $("#btnSkipRest").onclick = () => {
    if (!restRunning) return toast("Pas de repos en cours");
    stopRest(() => goNext(workout, nav, { requireSaved: false }));
  };

  // Swipe left: if resting -> skip rest, else next (requires saved)
  attachSwipe($("#swipeArea"),
    () => {
      if (restRunning) return $("#btnSkipRest")?.click();
      return goNext(workout, nav, { requireSaved: true });
    },
    () => goPrev(workout, nav)
  );

  $("#btnSave").onclick = () => {
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

    const idx = roundObj.entries.findIndex(x => x.item_id === item.item_id);
    if (idx >= 0) roundObj.entries[idx] = record;
    else roundObj.entries.push(record);

    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);

    const rest = (nav.idx === workout.circuit_plan.items.length - 1)
      ? workout.session_rules.rest_between_rounds_sec
      : workout.session_rules.rest_between_exercises_sec;

    runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }));
  };
}

function goPrev(workout, nav) {
  clearInterval(restInterval);
  restRunning = false;

  if (nav.idx > 0) { nav.idx--; return renderWorkoutScreen(workout, nav); }
  if (nav.round > 0) { nav.round--; nav.idx = workout.circuit_plan.items.length - 1; return renderWorkoutScreen(workout, nav); }
  toast("Début de séance");
}

function goNext(workout, nav, { requireSaved }) {
  clearInterval(restInterval);
  restRunning = false;

  if (requireSaved) {
    const item = workout.circuit_plan.items[nav.idx];
    const roundObj = workout.rounds[nav.round];
    const saved = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!saved) { toast("Enregistre d’abord (Valider & Repos)"); return; }
  }

  if (nav.idx < workout.circuit_plan.items.length - 1) { nav.idx++; return renderWorkoutScreen(workout, nav); }
  if (nav.round < workout.session_rules.rounds - 1) { nav.round++; nav.idx = 0; return renderWorkoutScreen(workout, nav); }
  finishWorkout(workout);
}

function finishWorkout(workout) {
  clearInterval(restInterval);
  restRunning = false;

  workout.completed = true;
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
  renderDashboard();
}

/* ---------- Dashboard + replay same session (5) ---------- */
function dashboardCards() {
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

  const canReplay = !!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length);

  return `
    <div class="grid">
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
            ${PROGRESS.last_workout?.workout_id && !PROGRESS.last_workout.completed ? `<button id="btnResume">Reprendre la séance</button>` : ""}
            <button class="ghost" id="btnTest">${initialDone ? "Configurer & refaire un test" : "Configurer & test initial"}</button>
            <button class="ghost" id="btnReplay" ${canReplay ? "" : "disabled"}>Rejouer la même séance</button>
            <button class="ghost" id="btnExport">Exporter</button>
            <button class="ghost" id="btnImport">Importer</button>
            <button class="danger" id="btnReset">Reset local (⚠️)</button>
          </div>
          <p class="hint">Tu peux choisir Pull/Push/Tout + cocher les exercices à inclure avant chaque séance.</p>
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

function renderDashboard() {
  render(dashboardCards());

  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  $("#btnStart").onclick = () => {
    // Setup then warmup then either test or workout
    renderSessionSetup({ mode: initialDone ? "workout" : "test" });
  };

  const btnResume = $("#btnResume");
  if (btnResume) btnResume.onclick = () => startWorkout({ resume: true });

  $("#btnTest").onclick = () => {
    renderSessionSetup({ mode: "test" });
  };

  $("#btnReplay").onclick = () => {
    if (!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length)) return;
    // New workout with same selected exercises, same plan logic = reuse setup selection if present
    const setup = PROGRESS.last_workout.setup || PROGRESS.settings.last_session_setup || null;
    const selected = setup?.selectedExercises || null;

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
      PROGRESS = ensureProgressShape(obj);
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

/* ---------- Init ---------- */
async function init() {
  PROGRAM = await loadJSON("./programme.json");

  let p = getProgress();
  if (!p) p = await loadJSON("./progress.json");
  PROGRESS = ensureProgressShape(p);
  setProgress(PROGRESS);

  $("#subtitle").textContent = "Séance configurable + échauffement + repos skippable";
  renderDashboard();
}

init().catch((e) => {
  console.error(e);
  $("#subtitle").textContent = "Erreur : " + e.message;
  render(`<div class="card"><div class="bd">Erreur: ${escapeHTML(e.message)}</div></div>`);
});
