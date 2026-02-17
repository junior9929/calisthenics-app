/* ---------- Export/Import Progress ---------- */

import { toast } from './utils.js';
import { getProgress } from './state.js';

export function exportProgress() {
  const PROGRESS = getProgress();
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

export function importProgressFromFile(file) {
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
