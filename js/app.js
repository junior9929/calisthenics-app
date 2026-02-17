/* ---------- Main Entry Point ---------- */

import { $, render, escapeHTML } from './utils.js';
import { setProgram, setProgress as setProgressState } from './state.js';
import { loadJSON, loadProgress, saveProgress, ensureProgressShape } from './storage.js';
import { renderDashboard } from './dashboard.js';

async function init() {
  try {
    // Load program data
    const program = await loadJSON("./programme.json");
    setProgram(program);

    // Load or initialize progress
    let p = loadProgress();
    if (!p) p = await loadJSON("./progress.json");
    const progress = ensureProgressShape(p);
    saveProgress(progress);
    setProgressState(progress);

    // Render initial screen
    renderDashboard();
  } catch (e) {
    console.error(e);
    $("#subtitle").textContent = "Erreur : " + e.message;
    render(`<div class="card"><div class="bd">Erreur: ${escapeHTML(e.message)}</div></div>`);
  }
}

// Start the app
init();
