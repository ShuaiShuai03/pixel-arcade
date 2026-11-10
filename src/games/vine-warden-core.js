// Shared numbers and grid helpers. Times are ticks of 1/120 s.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 28,
  step: 1 / 120,
  maxDt: 0.1,
  moveTicks: 18, // one tile in 0.15 s
  turnTicks: 12, // a key held less than 0.1 s only turns the gardener
  bufferTicks: 30,
  stageTicks: 240, // seed, sprout and bud last 2 s each: a bloom opens 6 s after planting
  charges: 4, // bites per bloom
  biteTicks: 96, // 0.8 s between bites
  reach: 1, // roots cover the 3x3 tiles around the plant
  seedCap: 6,
  harvestFull: 2,
  harvestSpent: 1,
  avoidCost: 4, // extra route cost a wary pest adds for each live-root tile
  avoidCap: 12, // a detour never costs a wary pest more than this, so two rooted lanes tie
  clearTicks: 360,
  messageTicks: 240,
  promptHoldTicks: 72,
  tipTicks: 720, // the level tip stays up for 6 s unless the first seed is planted
  catchScore: 100,
  levelScore: 300,
  healthScore: 100,
});
export const TILE = RULES.tile;
export const COLS = RULES.cols;
export const ROWS = RULES.rows;
export const TOP = RULES.top;
export const STEP = RULES.step;
export const FIELD_BOTTOM = TOP + ROWS * TILE;
export const GROW_TICKS = RULES.stageTicks * 3;
export const SPRITE = 22;
export const DIRS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
  Object.freeze([-1, 0]),
]);

export const INVADERS = Object.freeze({
  beetle: Object.freeze({
    hp: 2,
    ticks: 72,
    wary: false,
    name: Object.freeze({ en: 'Beetle', zh: '甲虫' }),
  }),
  weevil: Object.freeze({
    hp: 3,
    ticks: 60,
    wary: true,
    name: Object.freeze({ en: 'Weevil', zh: '象鼻虫' }),
  }),
  hopper: Object.freeze({
    hp: 2,
    ticks: 30,
    wary: false,
    name: Object.freeze({ en: 'Hopper', zh: '跳虫' }),
  }),
});

export const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const tileAt = (s, c, r) => (inGrid(c, r) ? s.grid[r][c] : '#');
export const isPath = (ch) => ch === '.' || ch === 'G' || ch === 'h';
export const plantAt = (s, c, r) => s.plants.find((p) => p.c === c && p.r === r);
export const reaches = (p, c, r) => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= RULES.reach;
export const stageOf = (p) => Math.min(3, Math.floor(p.age / RULES.stageTicks));
export const isLive = (p) => stageOf(p) === 3 && p.charges > 0;
// A bloom that has bloomed for 15 s without a single bite is idle: no pest uses its lane.
const IDLE_TICKS = 1800;
export const isIdle = (p) =>
  isLive(p) && p.charges === RULES.charges && p.grip === null && p.bloomTicks >= IDLE_TICKS;
export const tileCenter = (c, r) => ({ x: c * TILE + TILE / 2, y: TOP + r * TILE + TILE / 2 });
export const facingOf = (p) => ({ c: p.c + p.facing.dx, r: p.r + p.facing.dy });
export const secs = (ticks) => Math.ceil((ticks - 1e-9) * STEP);
export const tilesAround = (c, r) => {
  const out = [];
  for (let dr = -RULES.reach; dr <= RULES.reach; dr++)
    for (let dc = -RULES.reach; dc <= RULES.reach; dc++) out.push({ c: c + dc, r: r + dr });
  return out;
};
// Path tiles a plant at (c, r) would cover once it blooms (the heart tile is never rooted).
export const rootTilesAt = (s, c, r) =>
  tilesAround(c, r).filter((t) => '.G'.includes(tileAt(s, t.c, t.r)));
