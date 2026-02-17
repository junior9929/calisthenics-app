/* ---------- Web Audio API ---------- */

import { getProgress } from './state.js';

export let AUDIO_CTX = null;

export function ensureAudio() {
  if (!AUDIO_CTX) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    AUDIO_CTX = new Ctx();
  }
  // iOS: il faut parfois resume() après un geste utilisateur
  if (AUDIO_CTX.state === "suspended") AUDIO_CTX.resume().catch(() => {});
  return AUDIO_CTX;
}

export function beep({ freq = 880, durationMs = 120, volume = 0.05, type = "sine" } = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  // petite enveloppe pour éviter les "clicks"
  const now = ctx.currentTime;
  const dur = durationMs / 1000;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export function restCountdownBeep(t) {
  // t = secondes restantes
  // 3-2-1 : tone plus grave, "GO" : tone plus aigu
  const PROGRESS = getProgress();
  if (!PROGRESS?.settings?.enable_beeps) return;
  if (t === 3) beep({ freq: 520, durationMs: 110, volume: 0.06, type: "sine" });
  if (t === 2) beep({ freq: 520, durationMs: 110, volume: 0.06, type: "sine" });
  if (t === 1) beep({ freq: 520, durationMs: 110, volume: 0.06, type: "sine" });
  if (t === 0) beep({ freq: 880, durationMs: 180, volume: 0.08, type: "sine" });
}
