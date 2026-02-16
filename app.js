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

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2,"0")}` : `${r}s`;
}

function animateCard() {
  const el = $("#swipeArea");
  if (!el) return;
  el.classList.remove("enter");
  // force reflow
  void el.offsetWidth;
  el.classList.add("enter");
}

function vibrate(ms=12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
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

function exerciseGroup(exId){
  // used for stronger visual cue
  if (exId === "pullups") return "Pull";
  if (exId === "pushups") return "Push";
  if (exId === "pistols") return "Jambes";
  if (exId === "plank") return "Core";
  if (exId === "dips") return "Push";
  if (exId === "lsit") return "Core";
  return "—";
}

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

/* ---------- Swipe (4) ---------- */
function attachSwipe(el, onLeft, onRight) {
  let sx = 0, sy = 0, moved = false;

  // iOS back gesture guard
  const LEFT_EDGE_GUARD_PX = 40;

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

    if (dx < 0) onLeft?.();
    else {
      if (sx < LEFT_EDGE_GUARD_PX) return;
      onRight?.();
    }
  }, { passive: true });
}

/* ---------- Entry fields + quick controls (2 + 3) ---------- */
function renderEntryFields(type, existingEntry = null) {
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

let PROGRAM = null;
let PROGRESS = null;

function bestRound1ForExercise(exId) {
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
function ensureProgressShape(p) {
  p.schema_version ||= 1;
  p.app ||= { active_program_id: "programme.json", active_phase_id: "phase1_bases" };
  p.state ||= {};
  p.tests ||= { initial_test: { performed_at: null, results: {} }, retests: [] };
  if (!p.tests.retests) p.tests.retests = [];

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
    paused: false,
    setup: null,
    nav: { round: 0, idx: 0 } // (9) persist position
  };

  if (!p.workout_history) p.workout_history = [];
  return p;
}

function render(html) { $("#root").innerHTML = html; }

/* ---------- Session setup screen ---------- */
function defaultSelectionForFocus(focus) {
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
          <p class="hint">Ces choix sont mémorisés.</p>
        </div>
      </div>
    </div>
  `);

  $("#btnBack").onclick = () => renderDashboard();

  const setFocusAndDefaults = (newFocus) => {
    const defaults = defaultSelectionForFocus(newFocus);
    const list = $("#exList");
    for (const cb of list.querySelectorAll("input[type=checkbox][data-ex]")) {
      cb.checked = defaults.includes(cb.getAttribute("data-ex"));
    }
    PROGRESS.settings.last_session_setup = { focus: newFocus, selectedExercises: defaults };
    setProgress(PROGRESS);
    renderSessionSetup({ mode });
  };

  $("#focusPull").onclick = () => setFocusAndDefaults("pull");
  $("#focusPush").onclick = () => setFocusAndDefaults("push");
  $("#focusAll").onclick  = () => setFocusAndDefaults("all");

  $("#btnGo").onclick = () => {
    const selectedExercises = [];
    for (const cb of $("#exList").querySelectorAll("input[type=checkbox][data-ex]")) {
      if (cb.checked) selectedExercises.push(cb.getAttribute("data-ex"));
    }
    if (!selectedExercises.length) { toast("Choisis au moins 1 exercice"); return; }

    PROGRESS.settings.warmup_slot_choices = { pull: $("#slotPull").value, push: $("#slotPush").value };
    const focusNow = PROGRESS.settings.last_session_setup?.focus || "all";
    PROGRESS.settings.last_session_setup = { focus: focusNow, selectedExercises };
    setProgress(PROGRESS);

    renderWarmupPrompt({
      next: () => {
        if (mode === "test") renderTestFlow({ mode: initialDone ? "retest" : "initial" });
        else startWorkout({ resume: false, selectedExercises, setup: PROGRESS.settings.last_session_setup });
      }
    });
  };
}

/* ---------- Warmup prompt + warmup runner (8 + 3) ---------- */
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
            <button class="primary" id="btnWarm">Commencer l’échauffement</button>
            <button class="ghost" id="btnSkip">Passer</button>
          </div>
          <p class="hint">Tu swipes quand tu as fini une étape.</p>
        </div>
      </div>
    </div>
  `);

  $("#btnSkip").onclick = () => next?.();
  $("#btnWarm").onclick = () => {
    const setup = PROGRESS.settings.last_session_setup;
    const selected = new Set(setup?.selectedExercises || []);
    const warmups = [];

    warmups.push(PROGRESS.settings.warmup_default_upper);
    if (selected.has("pistols")) warmups.push(PROGRESS.settings.warmup_default_lower);

    runWarmups(warmups, () => next?.());
  };
}

let warmupTimer = { running:false, t:0, id:null };

function runWarmups(warmupIds, onDone) {
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
                    <div class="timerSub">Timer échauffement (manuel, pas d’auto-avance)</div>
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

              <div class="hint center">Tu peux swiper gauche/droite (évite le bord gauche).</div>
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

/* ---------- Test flow ---------- */
function renderTestFlow({ mode }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const order = phase.fundamentals_order || [];
  const ctx = { mode, exIdx: 0, levelIdx: 0, results: {} };
  renderTestScreen(ctx);
}

function testMaxLevelIndexReached(ctx, exId) {
  const res = ctx.results?.[exId];
  if (!res || !res.length) return 0;
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const f = findFundamental(phase, exId);
  const lastLevelId = res[res.length - 1].level_id;
  const idx = levelIndex(f, lastLevelId);
  return Math.max(0, idx);
}

function testGoBack(ctx) {
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
    onValueChange: (val) => {}
  });

  $("#btnBack").onclick = () => {
    const ok = testGoBack(ctx);
    if (!ok) return renderDashboard();
    renderTestScreen(ctx);
  };

  $("#btnPass").onclick = () => {
    if (!entryMeetsLevel(level)) {
      toast("L’entrée ne valide pas l’objectif. Utilise “Je bloque ici”.");
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

function nextExerciseOrFinish(ctx) {
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

/* ---------- Fallback helper ---------- */
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

let holdTimer = { running:false, t:0, id:null };

function runRestTimer(seconds, onDone) {
  const el = $("#restHint");
  if (!el) return onDone?.();

  clearInterval(restInterval);
  restRunning = false;

  const saveBtn = $("#btnSave");
  if (saveBtn) saveBtn.disabled = true;

  restRunning = true;
  let t = seconds;
  el.textContent = `Repos : ${t}s`;

  restInterval = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(restInterval);
      restRunning = false;
      el.textContent = "";
      toast("Go !");
      const saveBtn2 = $("#btnSave");
      if (saveBtn2) saveBtn2.disabled = false;
      onDone?.();
      return;
    }
    el.textContent = `Repos : ${t}s`;
  }, 1000);
}

function stopRest(onDone) {
  clearInterval(restInterval);
  restRunning = false;

  const saveBtn = $("#btnSave");
  if (saveBtn) saveBtn.disabled = false;

  const el = $("#restHint");
  if (el) el.textContent = "";

  onDone?.();
}

function persistWorkout(workout) {
  PROGRESS.last_workout = deepClone(workout);
  setProgress(PROGRESS);
}

function startWorkout({ resume, selectedExercises, setup }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);
  if (!initialDone) {
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

function buildStepListHTML(workout, nav) {
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

/* (2) wire quick controls depending on context */
function wireQuickControlsForCurrentScreen({ type, getPrevRoundEntry }) {
  const toNum = (x) => {
    const n = parseFloat(String(x ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const setV = (n) => { const v = $("#v"); if (v) v.value = String(Math.max(0, Math.floor(n))); };

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
    const setL = (n) => { const el=$("#l"); if(el) el.value=String(Math.max(0,Math.floor(n))); };
    const setR = (n) => { const el=$("#r"); if(el) el.value=String(Math.max(0,Math.floor(n))); };
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

function getPrevRoundEntryForItem(workout, nav, item) {
  if (nav.round === 0) return null;
  const prevRound = workout.rounds[nav.round - 1];
  const prev = prevRound.entries.find(e => e.exercise_id === item.exercise_id && e.level_id === item.level_id);
  return prev?.entry || null;
}

function renderWorkoutScreen(workout, nav) {
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

  // wire quick controls with "same prev round"
  wireQuickControlsForCurrentScreen({
    type: item.measure_type,
    getPrevRoundEntry: () => getPrevRoundEntryForItem(workout, nav, item)
  });

  // Pause (6)
  $("#btnPause").onclick = () => {
    const ok = confirm("Mettre la séance en pause ? Tu pourras la reprendre ensuite.");
    if (!ok) return;

    workout.paused = true;
    workout.completed = false;
    persistWorkout(workout);

    toast("Séance mise en pause");
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

  runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }));
  };

  // rest button (60s base, skippable) – you asked base 60 + swipe before end
  $("#btnRest").onclick = () => {
    // require saved
    const saved = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!saved) { toast("Valide d’abord"); return; }

    const rest = (nav.idx === workout.circuit_plan.items.length - 1)
      ? workout.session_rules.rest_between_rounds_sec
      : workout.session_rules.rest_between_exercises_sec;

    runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }));
  };
}

function goPrev(workout, nav) {
  clearInterval(restInterval);
  restRunning = false;

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

function goNext(workout, nav, { requireSaved }) {
  clearInterval(restInterval);
  restRunning = false;

  if (requireSaved) {
    const item = workout.circuit_plan.items[nav.idx];
    const roundObj = workout.rounds[nav.round];
    const saved = roundObj.entries.some(x => x.item_id === item.item_id);
    if (!saved) { toast("Valide d’abord"); return; }
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

function finishWorkout(workout) {
  clearInterval(restInterval);
  restRunning = false;

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
  renderDashboard();
}

/* ---------- Dashboard + replay same session ---------- */
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

  const canResume = !!(PROGRESS.last_workout?.workout_id && PROGRESS.last_workout?.completed === false);
  const isPaused = !!(PROGRESS.last_workout?.paused);
  const canReplay = !!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length);

  const pausedBanner = (canResume && isPaused) ? `
    <div class="card">
      <div class="hd">
        <div class="h">
          <div class="k">Séance en pause</div>
          <div class="v">Tu peux reprendre exactement où tu t’es arrêté</div>
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

function renderDashboard() {
  render(dashboardCards());

  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  $("#btnStart").onclick = () => {
    renderSessionSetup({ mode: initialDone ? "workout" : "test" });
  };

  const abandonFn = () => {
    const ok = confirm("Abandonner la séance en cours ? (Elle ne sera pas ajoutée à l’historique)");
    if (!ok) return;

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

  const resumeFn = () => startWorkout({ resume: true });

  const btnResume = $("#btnResume");
  if (btnResume) btnResume.onclick = resumeFn;

  const btnResumeTop = $("#btnResumeTop");
  if (btnResumeTop) btnResumeTop.onclick = resumeFn;

  $("#btnTest").onclick = () => renderSessionSetup({ mode: "test" });

  $("#btnReplay").onclick = () => {
    if (!(PROGRESS.last_workout?.completed && PROGRESS.last_workout?.circuit_plan?.items?.length)) return;
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

  $("#subtitle").textContent = "Séance fluide : transitions, quick input, timers, pause & reprise";
  renderDashboard();
}

init().catch((e) => {
  console.error(e);
  $("#subtitle").textContent = "Erreur : " + e.message;
  render(`<div class="card"><div class="bd">Erreur: ${escapeHTML(e.message)}</div></div>`);
});


