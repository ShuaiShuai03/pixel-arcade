// Fixed numbers shared by every Tether Twins module. Exposed read-only so tests, prompts and the HUD agree.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 26,
  bottom: 290,
  step: 1 / 120,
  maxDt: 0.1,
  robot: 22,
  speed: 104,
  accel: 1300,
  post: 16,
  plate: 20,
  reel: 160,
  minLen: 40,
  tautEps: 1.5,
  stretchTol: 0.01,
  ring: 6,
  cells: 3,
  freeze: 0.7,
  promptHold: 0.5,
  msgTime: 1.6,
  tipTime: 3.6,
  gateGrow: 2,
  padReach: 12,
  pulseWarn: 0.45,
  pulseGoFrom: 0.05,
  roomScore: 1000,
  cellScore: 250,
  gateScore: 100,
});

export const TILE = RULES.tile;
export const COLS = RULES.cols;
export const ROWS = RULES.rows;
export const TOP = RULES.top;
export const STEP = RULES.step;
export const HALF = RULES.robot / 2;
export const EPS = 1e-9;
export const SIDE_EPS = 1e-6;
export const colX = (c) => c * TILE + TILE / 2;
export const rowY = (r) => TOP + r * TILE + TILE / 2;
