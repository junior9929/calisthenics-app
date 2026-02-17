/* ---------- Program Data Access ---------- */

import { escapeHTML } from './utils.js';
import { WARMUP_SLOTS } from './storage.js';

export { WARMUP_SLOTS };

export function findPhase(program, phaseId) {
  return (program.phases || []).find((p) => p.id === phaseId) || null;
}

export function findFundamental(phase, exId) {
  return (phase.fundamentals || []).find((f) => f.id === exId) || null;
}

export function findLevel(fundamental, levelId) {
  return (fundamental.levels || []).find((l) => l.id === levelId) || null;
}

export function levelIndex(fundamental, levelId) {
  const idx = (fundamental.levels || []).findIndex((l) => l.id === levelId);
  return idx >= 0 ? idx : 0;
}

export function isLevelAtOrAbove(fundamental, currentLevelId, thresholdLevelId) {
  return levelIndex(fundamental, currentLevelId) >= levelIndex(fundamental, thresholdLevelId);
}

export function getTipsFor(program, phaseId, exId, levelId) {
  const phase = findPhase(program, phaseId);
  const f = findFundamental(phase, exId);
  const lvl = f ? findLevel(f, levelId) : null;

  const exTips = (f?.tips || []);
  const lvlTips = (lvl?.tips || []);
  const all = [...exTips, ...lvlTips].filter(Boolean);

  return all;
}

export function renderTipsBox(tips) {
  if (!tips || !tips.length) return "";
  const items = tips.map(t => `<li>${escapeHTML(t)}</li>`).join("");
  return `
    <div class="tips">
      <div class="tipsTitle">Tips</div>
      <ul>${items}</ul>
    </div>
  `;
}

export function getWarmup(program, warmupId) {
  return (program.warmups || []).find(w => w.id === warmupId) || null;
}

export function exerciseGroup(exId){
  // used for stronger visual cue
  if (exId === "pullups") return "Pull";
  if (exId === "pushups") return "Push";
  if (exId === "pistols") return "Jambes";
  if (exId === "plank") return "Core";
  if (exId === "dips") return "Push";
  if (exId === "lsit") return "Core";
  return "—";
}
