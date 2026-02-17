/* ---------- Circuit Generation (Phase 1) ---------- */

import { safeGet } from './utils.js';
import { findPhase, findFundamental, findLevel, isLevelAtOrAbove } from './program.js';

export function makeWorkoutItem(exId, exTitle, lvl, opts = {}) {
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

export function getCircuitForPhase1(program, progress, selectedExerciseIds) {
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

    // 1) items définis par circuit_items (main + éventuels aux)
    for (const ci of circuitItems) {
      if (ci.kind === "current_level_main") {
        const lvl = findLevel(f, currentLevelId) || f.levels?.[0];
        if (lvl) items.push(makeWorkoutItem(exId, f.title, lvl, { titleOverride: ci.title_override }));
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

    // 2) Règle spéciale : combo pullups niveau 1 (australiennes + suspension)
    // => On ajoute la suspension uniquement quand le niveau courant est EXACTEMENT lvl1
    if (exId === "pullups" && currentLevelId === "pullups_lvl1") {
      const hang = findLevel(f, "pullups_lvl1bis");
      if (hang) {
        items.push(makeWorkoutItem(exId, f.title, hang, { titleOverride: "Suspension (combo niveau 1)" }));
      }
    }
  }

  // 3) Anti-doublons (protection si JSON ou règles ajoutent deux fois le même item)
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const key = `${it.exercise_id}::${it.level_id}::${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(it);
  }

  return { phaseId: phase.id, items: dedup };
}
