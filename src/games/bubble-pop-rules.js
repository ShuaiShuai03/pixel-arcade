import { LEVELS } from './bubble-pop-levels.js';
// Board constants, hex lattice, colour bag and the match / drop rules.
export const R = 12,
  COLS = 12,
  ROWS = 12,
  ROW_H = Math.sqrt(3) * 12,
  LEFT = 108,
  RIGHT = 372,
  ROOF = 48,
  LIMIT = 270,
  SHOT_Y = 297,
  TAU = Math.PI * 2,
  EPS = 1e-6,
  CREATURE = 4,
  AIM_MIN = -2.88,
  AIM_MAX = -0.26;
export const slots = (r) => (r % 2 ? 11 : 12);
export function neighbors(r, c) {
  const shift = r % 2 ? 1 : -1;
  return [
    [r, c - 1],
    [r, c + 1],
    [r - 1, c],
    [r - 1, c + shift],
    [r + 1, c],
    [r + 1, c + shift],
  ].filter(([y, x]) => y >= 0 && y < ROWS && x >= 0 && x < slots(y));
}
export const bubblePoint = (r, c, ceiling = 0) => ({
  x: LEFT + c * 24 + (r % 2) * 12,
  y: ROOF + r * ROW_H + ceiling,
});
export function palette(s) {
  return [...new Set(s.board.flat().filter((v) => v >= 0 && v < CREATURE))].sort((a, b) => a - b);
}
export const creaturesLeft = (s) => s.board.flat().filter((v) => v === CREATURE).length;
export const cellsLeft = (s) => s.board.flat().filter((v) => v >= 0).length;
export function nextColor(s, env) {
  const available = palette(s);
  if (!available.length) return 0;
  while (s.colorBag.length) {
    const color = s.colorBag.shift();
    if (available.includes(color)) return color;
  }
  s.colorBag = [...available];
  for (let i = s.colorBag.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(env.random() * (i + 1)));
    [s.colorBag[i], s.colorBag[j]] = [s.colorBag[j], s.colorBag[i]];
  }
  return s.colorBag.shift();
}

/** A level's authored rows as a board, its bolt list and its creature count. */
export function createBubbleState(env, level = 1) {
  const spec = LEVELS[level - 1],
    rotation = Math.floor(env.random() * 4),
    obstacles = [];
  const board = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => {
      const code = c < slots(r) ? spec.rows[r]?.[c] : '.';
      if (code === '#') obstacles.push({ row: r, col: c });
      if (code === 'a') return CREATURE;
      return code !== undefined && code !== '.' && code !== '#'
        ? (Number(code) + rotation) % 4
        : -1;
    }),
  );
  const s = {
    phase: 'playing',
    level,
    totalLevels: LEVELS.length,
    goal: spec.goal,
    transition: 0,
    score: 0,
    board,
    obstacles,
    angle: -Math.PI / 2,
    angularVelocity: 0,
    aimTarget: null,
    queuedFire: false,
    swapPress: false,
    shot: null,
    capture: null,
    current: 0,
    next: 0,
    colorBag: [],
    ceiling: spec.drop * ROW_H,
    ceilingMotion: null,
    pressureWarning: 0,
    misses: 0,
    maxMisses: spec.misses,
    shotBudget: spec.shots,
    shotsLeft: spec.shots,
    shots: 0,
    stageShots: 0,
    freed: 0,
    popped: [],
    time: 0,
    combo: 0,
    message: '',
    messageTime: 0,
  };
  s.current = nextColor(s, env);
  s.next = nextColor(s, env);
  return s;
}
export function blockedSocket(s, r, c) {
  return (
    !s.board[r] ||
    c < 0 ||
    c >= slots(r) ||
    s.board[r][c] >= 0 ||
    s.obstacles.some((o) => o.row === r && o.col === c)
  );
}
/** Drop a capsule into a socket: pop matching groups of three, then release whatever lost its anchor. */
export function resolveBubble(s, row, col, color, env) {
  if (blockedSocket(s, row, col) || !Number.isInteger(color) || color < 0 || color >= CREATURE)
    throw new Error('Invalid or occupied bubble cell');
  s.board[row][col] = color;
  const cluster = [[row, col]],
    seen = new Set([`${row},${col}`]);
  for (let at = 0; at < cluster.length; at++)
    for (const [r, c] of neighbors(...cluster[at]))
      if (s.board[r][c] === color && !seen.has(`${r},${c}`)) {
        seen.add(`${r},${c}`);
        cluster.push([r, c]);
      }
  let removed = 0,
    rescued = 0;
  const drain = (r, c, kind) => {
    s.popped.push({
      ...bubblePoint(r, c, s.ceiling),
      color: s.board[r][c],
      z: 0,
      vz: 0,
      life: 0.75,
      kind,
    });
    if (s.board[r][c] === CREATURE) rescued++;
    s.board[r][c] = -1;
    removed++;
  };
  if (cluster.length >= 3) {
    for (const [r, c] of cluster) drain(r, c, 'match');
    const anchored = new Set(),
      queue = [];
    const anchor = (r, c) => {
      if (s.board[r]?.[c] >= 0 && !anchored.has(`${r},${c}`)) {
        anchored.add(`${r},${c}`);
        queue.push([r, c]);
      }
    };
    for (let c = 0; c < COLS; c++) anchor(0, c);
    for (const o of s.obstacles) for (const [r, c] of neighbors(o.row, o.col)) anchor(r, c);
    for (let at = 0; at < queue.length; at++)
      for (const [r, c] of neighbors(...queue[at])) anchor(r, c);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < slots(r); c++)
        if (s.board[r][c] >= 0 && !anchored.has(`${r},${c}`)) drain(r, c, 'detach');
    s.combo = removed;
    s.freed += rescued;
    s.score += cluster.length * 20 + (removed - cluster.length - rescued) * 35 + rescued * 150;
    env.sound('coin');
  } else {
    s.combo = 0;
    env.sound('move');
  }
  return removed;
}
export function deepest(s) {
  let y = -Infinity;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0) y = Math.max(y, bubblePoint(r, c, s.ceiling).y + R);
  for (const o of s.obstacles) y = Math.max(y, bubblePoint(o.row, o.col, s.ceiling).y + R);
  return y;
}
export const drainBusy = (s) => s.popped.some((p) => p.z < 24 + EPS);
/** The level goal is met once every colour is gone (clear) or every creature is free (free). */
export const goalMet = (s) => (s.goal === 'free' ? creaturesLeft(s) === 0 : cellsLeft(s) === 0);
/** True while the launcher must not accept a new capsule. */
export const isBusy = (s) =>
  Boolean(
    s.shot ||
    s.capture ||
    s.ceilingMotion ||
    s.transition > 0 ||
    drainBusy(s) ||
    goalMet(s) ||
    (s.shotBudget && s.shotsLeft <= 0),
  );
