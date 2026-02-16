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

function getCircuitForPhase1(program, progress) {
  const phase = findPhase(program, progress.app.active_phase_id);
  if (!phase) throw new Error("Phase introuvable dans programme.json");

  const order = phase.fundamentals_order || ["pullups","pushups","pistols","plank","dips","lsit"];
  const items = [];

  for (const exId of order) {
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

/* ---------- App state ---------- */
let PROGRAM = null;
let PROGRESS = null;

function ensureProgressShape(p) {
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

function render(html) { $("#root").innerHTML = html; }

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
      try {
        const obj = JSON.parse(String(r.result || ""));
        resolve(obj);
      } catch (e) {
        reject(new Error("Fichier JSON invalide"));
      }
    };
    r.onerror = () => reject(new Error("Impossible de lire le fichier"));
    r.readAsText(file);
  });
}

/* ---------- History helpers ---------- */
function summarizeEntryForHistory(e) {
  if (!e) return "—";
  const t = e.measure_type;
  const en = e.entry || {};
  if (t === "reps" || t === "negatives") return `${en.value ?? "—"} reps`;
  if (t === "hold_sec") return `${en.value ?? "—"} sec`;
  if (t === "reps_each_side") return `G ${en.left ?? "—"} / D ${en.right ?? "—"}`;
  return "—";
}

function numericValueForSpark(e) {
  if (!e) return null;
  const t = e.measure_type;
  const en = e.entry || {};
  if (t === "reps" || t === "negatives" || t === "hold_sec") return typeof en.value === "number" ? en.value : null;
  if (t === "reps_each_side") {
    const l = typeof en.left === "number" ? en.left : null;
    const r = typeof en.right === "number" ? en.right : null;
    if (l == null || r == null) return null;
    return Math.min(l, r); // conservative
  }
  return null;
}

function buildSeriesForExercise(exId) {
  const series = [];
  for (const w of (PROGRESS.workout_history || [])) {
    const r1 = w.rounds?.[0];
    if (!r1) continue;
    // prefer current level entry; else first entry for that exercise
    const matches = r1.entries.filter(x => x.exercise_id === exId);
    if (!matches.length) continue;

    // pick non-aux when possible: for pullups, prefer non-hang; for lsit, prefer main (not 2bis)
    let pick = matches[0];
    if (exId === "pullups") {
      pick = matches.find(m => m.level_id !== "pullups_lvl1bis") || matches[0];
    } else if (exId === "lsit") {
      pick = matches.find(m => m.level_id !== "lsit_lvl2bis") || matches[0];
    }
    const val = numericValueForSpark(pick);
    if (val == null) continue;
    series.push({ at: w.performed_at, val });
  }
  // reverse chronological history is stored with newest first; spark wants oldest->newest
  return series.reverse();
}

function sparklineSVG(series) {
  const w = 110, h = 34, pad = 4;
  if (!series.length) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="M${pad} ${h-pad} L${w-pad} ${h-pad}" stroke="rgba(255,255,255,.18)" fill="none" stroke-width="2"/></svg>`;
  }
  const vals = series.map(s => s.val);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1e-9, max - min);

  const xStep = (w - pad*2) / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => {
    const x = pad + i * xStep;
    const y = (h - pad) - ((s.val - min) / span) * (h - pad*2);
    return [x, y];
  });

  const d = pts.map((p, i) => `${i===0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  return `
    <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <path d="${d}" stroke="rgba(94,234,212,.85)" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/* ---------- Screens ---------- */
function dashboardCards() {
  const phaseId = PROGRESS.app.active_phase_id;
  const phase = findPhase(PROGRAM, phaseId);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);

  const itemsHtml = (phase.fundamentals_order || []).map(exId => {
    const f = findFundamental(phase, exId);
    const current = safeGet(PROGRESS, `state.${exId}.current_level_id`, f?.levels?.[0]?.id);
    const lvlLabel = (findLevel(f, current)?.title) || current || "—";

    let lastR1 = "";
    const lw = PROGRESS.last_workout;
    if (lw?.rounds?.length) {
      const r1 = lw.rounds[0];
      const match = r1.entries.filter(e => e.exercise_id === exId);
      if (match.length) {
        const curMatch = match.find(m => m.level_id === current) || match[0];
        lastR1 = summarizeEntryForHistory(curMatch);
      }
    }

    return `
      <div class="item">
        <div class="left">
          <div class="name">${escapeHTML(f?.title ?? exId)}</div>
          <div class="tiny muted">Niveau actuel : ${escapeHTML(lvlLabel)}</div>
          ${lastR1 ? `<div class="tiny muted">Dernier tour 1 : ${escapeHTML(lastR1)}</div>` : `<div class="tiny muted">Dernier tour 1 : —</div>`}
        </div>
        <div class="badge ${initialDone ? "ok" : "warn"}">${initialDone ? "Prêt" : "Test requis"}</div>
      </div>
    `;
  }).join("");

  const lastWorkoutAt = PROGRESS.last_workout?.performed_at;
  const lastWorkoutBadge = lastWorkoutAt ? `Dernière séance : ${new Date(lastWorkoutAt).toLocaleString()}` : "Aucune séance";

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
            <button class="primary" id="btnStart">${initialDone ? "Lancer une séance" : "Faire le test initial"}</button>
            ${lastWorkoutAt && PROGRESS.last_workout?.completed === false ? `<button id="btnResume">Reprendre la séance</button>` : ""}
            <button class="ghost" id="btnHistory">Historique</button>
            ${initialDone ? `<button class="ghost" id="btnRetest">Refaire un test (option)</button>` : ""}
            <button class="ghost" id="btnExport">Exporter</button>
            <button class="ghost" id="btnImport">Importer</button>
            <button class="danger" id="btnReset">Reset local (⚠️)</button>
          </div>
          <p class="hint">
            Données sauvegardées <b>localement</b> sur ton iPhone. Utilise <b>Exporter</b> pour faire un backup.
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

  $("#btnStart").onclick = () => {
    if (!initialDone) renderTestFlow({ mode: "initial" });
    else startWorkout({ resume: false });
  };

  const btnResume = $("#btnResume");
  if (btnResume) btnResume.onclick = () => startWorkout({ resume: true });

  $("#btnHistory").onclick = () => renderHistory();

  const btnRetest = $("#btnRetest");
  if (btnRetest) btnRetest.onclick = () => renderTestFlow({ mode: "retest" });

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
    const ok = confirm("Supprimer toutes les données locales ? (Tu peux exporter avant)");
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    toast("Reset OK. Recharge la page.");
  };
}

/* ---------- History screen ---------- */
function renderHistory() {
  const phaseId = PROGRESS.app.active_phase_id;
  const phase = findPhase(PROGRAM, phaseId);

  const exRows = (phase.fundamentals_order || []).map(exId => {
    const f = findFundamental(phase, exId);
    const series = buildSeriesForExercise(exId);
    const last = series.length ? series[series.length - 1].val : null;
    const first = series.length ? series[0].val : null;
    const delta = (last != null && first != null) ? (last - first) : null;

    const deltaTxt = delta == null ? "—" : (delta === 0 ? "±0" : (delta > 0 ? `+${delta}` : `${delta}`));
    const spark = sparklineSVG(series);

    return `
      <div class="item">
        <div class="histRow">
          <div class="left">
            <div class="name">${escapeHTML(f?.title ?? exId)}</div>
            <div class="tiny muted">Tour 1 • évolution: ${escapeHTML(deltaTxt)}</div>
            <div class="tiny muted">Points: ${series.length}</div>
          </div>
          <div class="spark">${spark}</div>
        </div>
      </div>
    `;
  }).join("");

  const sessions = (PROGRESS.workout_history || []).slice(0, 12).map(w => {
    const d = w.performed_at ? new Date(w.performed_at).toLocaleString() : "—";
    const done = w.completed ? "✅" : "⏳";
    return `
      <div class="item">
        <div class="left">
          <div class="name">${done} ${escapeHTML(d)}</div>
          <div class="tiny muted">Tours: ${w.session_rules?.rounds ?? "—"} • Items: ${w.circuit_plan?.items?.length ?? "—"}</div>
        </div>
        <div class="badge">Historique</div>
      </div>
    `;
  }).join("");

  render(`
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Progression</div>
            <div class="v">Historique & tendances</div>
          </div>
          <div class="pill">${escapeHTML((PROGRESS.workout_history || []).length + " séances")}</div>
        </div>
        <div class="bd">
          <div class="btns">
            <button class="ghost" id="btnBack">Retour</button>
            <button class="ghost" id="btnExport">Exporter</button>
          </div>
          <p class="hint">Sparklines basées sur le <b>tour 1</b> (quand tu es frais).</p>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Tour 1</div>
            <div class="v">Par exercice</div>
          </div>
        </div>
        <div class="bd">
          <div class="list">${exRows}</div>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div class="h">
            <div class="k">Dernières séances</div>
            <div class="v">Timeline</div>
          </div>
        </div>
        <div class="bd">
          <div class="list">${sessions || `<div class="muted tiny">Aucune séance</div>`}</div>
        </div>
      </div>
    </div>
  `);

  $("#btnBack").onclick = () => renderDashboard();
  $("#btnExport").onclick = () => exportProgress();
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

  const head = ctx.mode === "initial" ? "Test initial (requis)" : "Re-test (option)";
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

            <div class="hint">
              Swipe gauche = “Objectif atteint”, swipe droite = “Retour”.
              <br/>“Je bloque ici” fixe ton niveau actuel et ta baseline.
            </div>
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
    // passed all levels -> lock last
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

  // baseline structure
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

/* ---------- Workout flow + fallback helper ---------- */
function isBelowFallbackThreshold(phase, item, entry) {
  const repsTh = phase.fallback_rules?.reps_threshold ?? 3;
  const holdTh = phase.fallback_rules?.hold_threshold_sec ?? 5;

  if (item.measure_type === "reps" || item.measure_type === "negatives") {
    return (entry?.value ?? 0) <= repsTh;
  }
  if (item.measure_type === "hold_sec") {
    return (entry?.value ?? 0) <= holdTh;
  }
  // reps_each_side: trigger if either side <= repsTh
  if (item.measure_type === "reps_each_side") {
    return (entry?.left ?? 0) <= repsTh || (entry?.right ?? 0) <= repsTh;
  }
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

  // Examples for readability
  if (item.exercise_id === "pullups" && item.level_id === "pullups_lvl4") return "2 tractions + 3 tractions négatives";
  if (item.exercise_id === "pullups" && item.level_id === "pullups_lvl3") return "2 tractions négatives + 5 tractions australiennes";
  return `Complément : ${prev.title}`;
}

let restInterval = null;

function startWorkout({ resume }) {
  const phase = findPhase(PROGRAM, PROGRESS.app.active_phase_id);
  const initialDone = !!safeGet(PROGRESS, "tests.initial_test.performed_at", null);
  if (!initialDone) return renderTestFlow({ mode: "initial" });

  let workout = null;

  if (resume && PROGRESS.last_workout?.workout_id && !PROGRESS.last_workout.completed) {
    workout = deepClone(PROGRESS.last_workout);
    toast("Séance reprise");
  } else {
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

  renderWorkoutScreen(workout, { round: 0, idx: 0 });
}

function runRestTimer(seconds, onDone) {
  const el = $("#restHint");
  if (!el) return onDone?.();
  let t = seconds;
  el.textContent = `Repos : ${t}s`;
  clearInterval(restInterval);
  restInterval = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(restInterval);
      el.textContent = "";
      toast("Go !");
      onDone?.();
      return;
    }
    el.textContent = `Repos : ${t}s`;
  }, 1000);
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
            <div class="sub">${escapeHTML(formatValidate(item.measure_type, item.validate))}</div>

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
              <button class="primary" id="btnSave">Valider & Repos</button>
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

  attachSwipe($("#swipeArea"),
    () => goNext(workout, nav, { requireSaved: true }),
    () => goPrev(workout, nav)
  );

  $("#btnSave").onclick = () => {
    const entry = readEntryFromFields(item.measure_type);
    const fallback = ($("#fallback").value || "").trim();
    const note = ($("#note").value || "").trim();

    // C) fallback helper: if below threshold and no fallback provided, propose one
    if (!fallback && isBelowFallbackThreshold(phase, item, entry)) {
      const suggestion = suggestFallback(PROGRAM, PROGRESS, item);
      const ok = confirm(
        "Résultat très bas (seuil du livre). Voulais-tu compléter avec le niveau précédent ?\n" +
        (suggestion ? `\nSuggestion: ${suggestion}` : "")
      );
      if (ok) {
        $("#fallback").value = suggestion || "Complément niveau précédent";
      }
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

    // persist partial
    PROGRESS.last_workout = deepClone(workout);
    setProgress(PROGRESS);

    // rest time selection
    const rest = (nav.idx === workout.circuit_plan.items.length - 1)
      ? workout.session_rules.rest_between_rounds_sec
      : workout.session_rules.rest_between_exercises_sec;

    runRestTimer(rest, () => goNext(workout, nav, { requireSaved: false }));
  };
}

function goPrev(workout, nav) {
  clearInterval(restInterval);

  if (nav.idx > 0) { nav.idx--; return renderWorkoutScreen(workout, nav); }
  if (nav.round > 0) { nav.round--; nav.idx = workout.circuit_plan.items.length - 1; return renderWorkoutScreen(workout, nav); }
  toast("Début de séance");
}

function goNext(workout, nav, { requireSaved }) {
  clearInterval(restInterval);

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

/* ---------- Init ---------- */
async function init() {
  PROGRAM = await loadJSON("./programme.json");

  let p = getProgress();
  if (!p) p = await loadJSON("./progress.json");
  PROGRESS = ensureProgressShape(p);
  setProgress(PROGRESS);

  $("#subtitle").textContent = "Sauvegarde locale + Export/Import (backup)";
  renderDashboard();
}

init().catch((e) => {
  console.error(e);
  $("#subtitle").textContent = "Erreur : " + e.message;
  render(`<div class="card"><div class="bd">Erreur: ${escapeHTML(e.message)}</div></div>`);
});
