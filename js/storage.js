/* ---------- LocalStorage Persistence ---------- */

const LS_KEY = "calisthenics_progress_v1";

export const WARMUP_SLOTS = {
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

export function saveProgress(p) { 
  localStorage.setItem(LS_KEY, JSON.stringify(p)); 
}

export function loadProgress() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} introuvable`);
  return await res.json();
}

export function ensureProgressShape(p) {
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

  p.settings.enable_beeps ??= true;

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
    nav: { round: 0, idx: 0 }
  };

  if (!p.workout_history) p.workout_history = [];
  return p;
}
