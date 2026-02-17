/* ---------- Global State Management ---------- */

let PROGRAM = null;
let PROGRESS = null;

export function getProgram() {
  return PROGRAM;
}

export function setProgram(program) {
  PROGRAM = program;
}

export function getProgress() {
  return PROGRESS;
}

export function setProgress(progress) {
  PROGRESS = progress;
}
