/* ---------- Validation and Level Up ---------- */

import { safeGet } from './utils.js';
import { findPhase, findFundamental, findLevel, levelIndex } from './program.js';

export function meetsValidation(item, entry) {
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

export function proposeLevelUps(program, progress, workout) {
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

export function isBelowFallbackThreshold(phase, item, entry) {
  const repsTh = phase.fallback_rules?.reps_threshold ?? 3;
  const holdTh = phase.fallback_rules?.hold_threshold_sec ?? 5;

  if (item.measure_type === "reps" || item.measure_type === "negatives") return (entry?.value ?? 0) <= repsTh;
  if (item.measure_type === "hold_sec") return (entry?.value ?? 0) <= holdTh;
  if (item.measure_type === "reps_each_side") return (entry?.left ?? 0) <= repsTh || (entry?.right ?? 0) <= repsTh;
  return false;
}

export function suggestFallback(program, progress, item) {
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

export function formatValidate(type, validate) {
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
