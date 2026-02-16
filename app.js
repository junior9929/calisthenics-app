const LS_KEY = "calisthenics_progress_v1";

async function loadProgram() {
  const res = await fetch("./programme.json", { cache: "no-store" });
  if (!res.ok) throw new Error("programme.json introuvable");
  return await res.json();
}

async function loadProgressTemplate() {
  const res = await fetch("./progress.json", { cache: "no-store" });
  if (!res.ok) throw new Error("progress.json introuvable");
  return await res.json();
}

function getProgress() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setProgress(p) {
  localStorage.setItem(LS_KEY, JSON.stringify(p));
}

function render(program, progress) {
  document.getElementById("status").textContent =
    `OK — programme chargé (${program.phases?.[0]?.title ?? "sans phase"})`;

  document.getElementById("debug").textContent = JSON.stringify(
    {
      last_workout: progress.last_workout?.performed_at,
      workouts_count: progress.workout_history?.length ?? 0,
      test_counter: progress._test_counter ?? 0
    },
    null,
    2
  );
}

(async function main() {
  const statusEl = document.getElementById("status");

  try {
    const program = await loadProgram();

    // Progress: soit déjà dans LocalStorage, soit initialisé depuis progress.json
    let progress = getProgress();
    if (!progress) {
      progress = await loadProgressTemplate();
      progress._test_counter = 0;
      setProgress(progress);
    }

    render(program, progress);

    document.getElementById("inc").onclick = () => {
      const p = getProgress();
      p._test_counter = (p._test_counter ?? 0) + 1;

      // simule une "dernière séance"
      p.last_workout.workout_id = "test-" + Date.now();
      p.last_workout.performed_at = new Date().toISOString();

      setProgress(p);
      render(program, p);
    };

    document.getElementById("reset").onclick = () => {
      localStorage.removeItem(LS_KEY);
      statusEl.textContent = "Reset OK — relance l'app.";
      document.getElementById("debug").textContent = "";
    };
  } catch (e) {
    statusEl.textContent = "Erreur : " + e.message;
  }
})();
