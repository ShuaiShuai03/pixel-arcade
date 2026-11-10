// Rules, grid helpers and read-only derived facts shared by the simulation, prompts and drawing.
import { LEVELS } from './burrow-rescue-levels.js';

// Rules are exposed read-only so tests and the HUD agree on the numbers.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 28,
  step: 1 / 120,
  maxDt: 0.1,
  moveTicks: 20,
  minerTicks: 26,
  digTicks: 18,
  bufferTicks: 30,
  spanLimit: 4,
  looseLimit: 3,
  freshAirRate: 24,
  tankAir: 35,
  haulAir: 60,
  followDrain: 0.5,
  lowAir: 30,
  lives: 3,
  minerScore: 1000,
});
export const { tile: TILE, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
export const FIELD_BOTTOM = TOP + ROWS * TILE;
export const OPEN = '.LTDVP';
export const DUG = 'DV';
export const DIGGABLE = 'EWB';

export const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const walkable = (s, c, r) => inGrid(c, r) && OPEN.includes(s.grid[r][c]);
export const levelOf = (s) => LEVELS[s.level];
// Ticks between the first crack and the fall; every level sets its own fuse and the HUD shows it.
export const fuseTicks = (s) => Math.round(levelOf(s).fuse / STEP);
export const centerOf = (c, r) => ({ x: c * TILE + TILE / 2, y: TOP + r * TILE + TILE / 2 });

// A span is a maximal row run of dug, unbraced tiles. Beams ('P') and old tunnels end a run.
function spanOf(row, c) {
  if (!DUG.includes(row[c])) return null;
  let c0 = c;
  let c1 = c;
  while (c0 > 0 && DUG.includes(row[c0 - 1])) c0--;
  while (c1 < COLS - 1 && DUG.includes(row[c1 + 1])) c1++;
  const loose = row.slice(c0, c1 + 1).includes('V');
  const len = c1 - c0 + 1;
  return { c0, c1, len, loose, unstable: len >= (loose ? RULES.looseLimit : RULES.spanLimit) };
}
export function findSpans(grid) {
  const spans = [];
  grid.forEach((row, r) => {
    for (let c = 0; c < COLS;) {
      const span = spanOf(row, c);
      if (span) spans.push({ r, ...span });
      c = span ? span.c1 + 1 : c + 1;
    }
  });
  return spans;
}
// Would digging (c, r) leave an unstable span? `beamAt` optionally adds a beam first.
export function digWouldCrack(s, c, r, beamAt) {
  const row = s.grid[r].slice();
  row[c] = s.grid[r][c] === 'W' ? 'V' : 'D';
  if (beamAt && beamAt.r === r) row[beamAt.c] = 'P';
  return spanOf(row, c).unstable;
}

function distances(s, goal) {
  const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  const queue = [goal];
  dist[goal.r][goal.c] = 0;
  for (let i = 0; i < queue.length; i++) {
    const { c, r } = queue[i];
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ]) {
      const nc = c + dx;
      const nr = r + dy;
      if (walkable(s, nc, nr) && dist[nr][nc] < 0) {
        dist[nr][nc] = dist[r][c] + 1;
        queue.push({ c: nc, r: nr });
      }
    }
  }
  return dist;
}
// Distance and first step from `from` to `goal` through open tiles only.
export function route(s, from, goal) {
  const dist = distances(s, goal);
  const d = dist[from.r][from.c];
  if (d < 0) return null;
  let next = null;
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ]) {
    const nc = from.c + dx;
    const nr = from.r + dy;
    if (!next && d > 0 && inGrid(nc, nr) && dist[nr][nc] === d - 1) next = { c: nc, r: nr };
  }
  return { dist: d, next };
}

export const actorPos = (a, ticks) => {
  const k = a.prog / ticks;
  return {
    x: (a.from.c + (a.c - a.from.c) * k) * TILE,
    y: TOP + (a.from.r + (a.r - a.from.r) * k) * TILE,
  };
};
export const playerRect = (s) => {
  const { x, y } = actorPos(s.player, RULES.moveTicks);
  return { x: x + 2, y, w: 20, h: TILE };
};
export const onLift = (s) =>
  s.player.prog === 0 && s.player.c === s.lift.c && s.player.r === s.lift.r;

// Waiting miners within `reach` tiles (Manhattan) of the player, nearest first.
export function waitingBy(s, reach) {
  const p = s.player;
  const gap = (m) => Math.abs(m.c - p.c) + Math.abs(m.r - p.r);
  return s.miners
    .filter((m) => m.state === 'waiting' && gap(m) <= reach)
    .sort((a, b) => gap(a) - gap(b));
}

export const followers = (s) =>
  s.miners.filter((m) => m.state === 'following').sort((a, b) => a.order - b.order);
export const drainRate = (s) => levelOf(s).drain + RULES.followDrain * followers(s).length;
