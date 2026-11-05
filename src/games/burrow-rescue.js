import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'burrow-rescue',
  name: { en: 'Burrow Rescue', zh: '地底救援' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Dig tunnels, wake stranded miners and lead them to the lift in three mine sectors. Space digs the earth you face. A tunnel of 4 dug tiles in a row (3 in loose soil) cracks for 4 seconds and then collapses: press X to place a beam and split it. Air drains underground and refills at the surface or from tanks. X also wakes a miner beside you. Stand on the lift while they walk to it.',
    zh: '挖掘隧道，唤醒被困矿工，并带他们回到三个矿区的升降梯。空格键挖开面前的泥土。连续挖出4格隧道（松软土为3格）会出现裂缝，4秒后坍塌：按X放置支架即可分段。氧气在地下持续下降，在地面或氧气罐处补充。X也可唤醒身边的矿工。矿工走向升降梯时请站在梯上等候。',
  },
  keys: [
    { label: { en: 'Move / face', zh: '移动 / 转向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Dig the earth you face', zh: '挖掘面前的泥土' }, keys: 'Space' },
    { label: { en: 'Place a beam / wake a miner', zh: '放置支架 / 唤醒矿工' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Dig', '挖掘', 'right'],
    ['KeyX', 'Beam / Guide', '支架 / 带人', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

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
  warnTicks: 480,
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
const { tile: TILE, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
const FIELD_BOTTOM = TOP + ROWS * TILE;
const OPEN = '.LTDVP';
const DUG = 'DV';
const DIGGABLE = 'EWB';
const MAX_FX = 48;

const SECTORS = [
  {
    name: { en: 'Shallow Seam', zh: '浅层矿脉' },
    beams: 2,
    drain: 1,
    digCost: 2,
    map: [
      '........L...........',
      'RRRRRRRREEEEEEEEEEEE',
      'RRRRRRRREEEEEEEEEEEE',
      'EECMCEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEECMCEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEERRRRRRRREEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'RRRRRRRRRRRRRRRRRRRR',
    ],
  },
  {
    name: { en: 'Granite Shelf', zh: '花岗岩层' },
    beams: 3,
    drain: 2,
    digCost: 3.5,
    map: [
      '..L.................',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'RRRRRRRRRRRRRRRREEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEECMCEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEECMAEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEERRRREEEEEEEEEEEE',
      'RRRRRRRRRRRRRRRRRRRR',
    ],
  },
  {
    name: { en: 'Collapsed Gallery', zh: '坍塌坑道' },
    beams: 3,
    drain: 2.2,
    digCost: 3.5,
    map: [
      '......L.............',
      'EDDDPDDDEEEEEEEEEEEE',
      'RREEEEEEEEEEEEEEEERR',
      'EEEEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEEEE',
      'CMTTTTTBBBBTTTTTTMCA',
      'EEEEEEEEEEEEEWEEEEEE',
      'EEEEEEEEEEEEEWEEEEEE',
      'EEEEEEEEEEEEEWWWCMAE',
      'EEEEEEEEEEEEEEEEEEEE',
      'RRRRRRRRRRRRRRRRRRRR',
    ],
  },
];
const SECTOR_HINT = [
  { en: 'Beams split long tunnels', zh: '支架可分隔长隧道' },
  { en: 'Rock blocks digging; reuse tanks', zh: '岩石无法挖开；善用氧气罐' },
  { en: 'Clear rubble; loose soil needs beams', zh: '清理碎石；松软土要多放支架' },
];

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

function loadSector(s, index) {
  const sector = SECTORS[index];
  const miners = [];
  const tanks = [];
  let lift = { c: 0, r: 0 };
  s.grid = sector.map.map((line, r) =>
    [...line].map((ch, c) => {
      if (ch === 'L') lift = { c, r };
      if (ch === 'M') miners.push(newMiner(miners.length, c, r));
      if (ch === 'A') tanks.push({ c, r, taken: false });
      return ch === 'M' || ch === 'A' || ch === 'C' ? 'T' : ch;
    }),
  );
  Object.assign(s, {
    sector: index,
    miners,
    tanks,
    lift,
    oxygen: 100,
    beams: sector.beams,
    crack: {},
    fx: [],
    nextOrder: 0,
    banner: 240,
    boardFlash: 0,
    sticky: null,
    message: null,
    latch: { dig: 0, use: 0 },
    player: newPlayer(lift),
  });
}
const newPlayer = (lift) => ({
  c: lift.c,
  r: lift.r,
  from: { c: lift.c, r: lift.r },
  prog: 0,
  facing: { dx: 0, dy: 1 },
  dig: 0,
  hurt: 0,
});
const newMiner = (id, c, r) => ({
  id,
  c,
  r,
  from: { c, r },
  prog: 0,
  state: 'waiting',
  order: -1,
  blocked: false,
});

const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
const walkable = (s, c, r) => inGrid(c, r) && OPEN.includes(s.grid[r][c]);
const sectorOf = (s) => SECTORS[s.sector];

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
function findSpans(grid) {
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
function digWouldCrack(s, c, r, beamAt) {
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
function route(s, from, goal) {
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

const actorPos = (a, ticks) => {
  const k = a.prog / ticks;
  return {
    x: (a.from.c + (a.c - a.from.c) * k) * TILE,
    y: TOP + (a.from.r + (a.r - a.from.r) * k) * TILE,
  };
};
const playerRect = (s) => {
  const { x, y } = actorPos(s.player, RULES.moveTicks);
  return { x: x + 2, y, w: 20, h: TILE };
};
const onLift = (s) => s.player.prog === 0 && s.player.c === s.lift.c && s.player.r === s.lift.r;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function newState() {
  const s = {
    phase: 'playing',
    score: 0,
    lives: RULES.lives,
    ticks: 0,
    acc: 0,
    stats: { digs: 0, braces: 0, calls: 0, rescued: 0, collapses: 0, hits: 0, tanks: 0 },
  };
  loadSector(s, 0);
  return s;
}

const setMessage = (s, en, zh) => {
  s.message = { en, zh, ttl: 150 };
};
function addFx(s, x, y, color, count, spread = 40) {
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    s.fx.push({
      x,
      y,
      vx: side * spread * (0.3 + (i % 3) * 0.35),
      vy: -50 - (i % 4) * 22,
      ttl: 40 + (i % 3) * 10,
      color,
    });
  }
  if (s.fx.length > MAX_FX) s.fx.splice(0, s.fx.length - MAX_FX);
}
const centerOf = (c, r) => ({ x: c * TILE + TILE / 2, y: TOP + r * TILE + TILE / 2 });

function respawn(s, cause) {
  s.player = newPlayer(s.lift);
  s.player.hurt = 90;
  s.latch = { dig: 0, use: 0 };
  if (cause === 'air') s.oxygen = RULES.haulAir;
}
function hurt(s, cause, emit) {
  s.lives--;
  s.stats.hits++;
  emit('hit');
  respawn(s, cause);
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  setMessage(
    s,
    cause === 'air' ? 'Out of air! Hauled up' : 'Cave-in! Back at the lift',
    cause === 'air' ? '氧气耗尽！被拉回地面' : '塌方！已回到升降梯',
  );
}

// Waiting miners within `reach` tiles (Manhattan) of the player, nearest first.
function waitingBy(s, reach) {
  const p = s.player;
  const gap = (m) => Math.abs(m.c - p.c) + Math.abs(m.r - p.r);
  return s.miners
    .filter((m) => m.state === 'waiting' && gap(m) <= reach)
    .sort((a, b) => gap(a) - gap(b));
}

function wakeMiner(s, emit) {
  const p = s.player;
  const near = waitingBy(s, 1)[0];
  if (!near) return false;
  near.state = 'following';
  near.order = s.nextOrder++;
  s.stats.calls++;
  emit('coin');
  setMessage(s, 'Miner is following you', '矿工正在跟随你');
  return true;
}
function useAction(s, emit) {
  const p = s.player;
  // Inside a cracking span with a beam in hand, X braces first (matches the prompt).
  const bracing =
    s.crack[`${p.r},${p.c}`] !== undefined && DUG.includes(s.grid[p.r][p.c]) && s.beams > 0;
  if (!bracing && wakeMiner(s, emit)) return;
  const here = s.grid[p.r][p.c];
  if (DUG.includes(here)) {
    if (s.beams <= 0)
      return setMessage(s, 'No beams left: restock at the lift', '没有支架：去升降梯补充');
    s.grid[p.r][p.c] = 'P';
    s.beams--;
    s.stats.braces++;
    emit('move');
    addFx(s, centerOf(p.c, p.r).x, centerOf(p.c, p.r).y - 8, '#c58a3d', 6, 24);
  } else if (here === 'P') setMessage(s, 'A beam already holds this tile', '这里已有支架');
  else setMessage(s, 'Beams go on tiles you dug', '支架只能放在挖出的隧道上');
}
function digAction(s, emit) {
  const p = s.player;
  const tc = p.c + p.facing.dx;
  const tr = p.r + p.facing.dy;
  const ch = inGrid(tc, tr) ? s.grid[tr][tc] : ' ';
  if (ch === 'R') return setMessage(s, 'Solid rock: dig around it', '岩石挖不动：绕过它');
  if (!DIGGABLE.includes(ch)) return;
  s.grid[tr][tc] = ch === 'W' ? 'V' : 'D';
  s.oxygen = Math.max(0, s.oxygen - sectorOf(s).digCost);
  p.dig = RULES.digTicks;
  s.stats.digs++;
  emit('move');
  addFx(s, centerOf(tc, tr).x, centerOf(tc, tr).y, '#8a6a4a', 7);
}

function movePlayer(s, dir, emit) {
  const p = s.player;
  if (p.dig > 0 && --p.dig > 0) return;
  if (p.prog > 0) {
    const reverse = (dir.dx && dir.dx === p.from.c - p.c) || (dir.dy && dir.dy === p.from.r - p.r);
    if (reverse) {
      [p.c, p.r, p.from] = [p.from.c, p.from.r, { c: p.c, r: p.r }];
      p.prog = RULES.moveTicks - p.prog;
      p.facing = { dx: dir.dx && p.c - p.from.c, dy: dir.dy && p.r - p.from.r };
    }
    if (++p.prog >= RULES.moveTicks) {
      p.prog = 0;
      p.from = { c: p.c, r: p.r };
    }
    return;
  }
  const wishes = [dir.dx && [dir.dx, 0], dir.dy && [0, dir.dy]].filter(Boolean);
  const go = wishes.find(([dx, dy]) => walkable(s, p.c + dx, p.r + dy));
  const face = go || wishes[0];
  if (face) p.facing = { dx: face[0], dy: face[1] };
  if (s.latch.use > 0) {
    s.latch.use = 0;
    return useAction(s, emit);
  }
  if (s.latch.dig > 0) {
    s.latch.dig = 0;
    digAction(s, emit);
    if (p.dig > 0) return;
  }
  if (go) {
    p.c += go[0];
    p.r += go[1];
    p.prog = 1;
  }
}

function tileEffects(s, emit) {
  const p = s.player;
  if (p.prog > 0) return;
  const tank = s.tanks.find((t) => !t.taken && t.c === p.c && t.r === p.r);
  if (tank) {
    tank.taken = true;
    s.oxygen = Math.min(100, s.oxygen + RULES.tankAir);
    s.stats.tanks++;
    emit('coin');
    setMessage(s, `Air tank +${RULES.tankAir}`, `氧气罐 +${RULES.tankAir}`);
  }
  if (onLift(s) && s.beams < sectorOf(s).beams) {
    s.beams = sectorOf(s).beams;
    if (!s.message) setMessage(s, 'Beams restocked', '支架已补充');
  }
}

const followers = (s) =>
  s.miners.filter((m) => m.state === 'following').sort((a, b) => a.order - b.order);
const drainRate = (s) => sectorOf(s).drain + RULES.followDrain * followers(s).length;

function updateOxygen(s, emit) {
  const p = s.player;
  if (p.r === 0 && p.from.r === 0) {
    s.oxygen = Math.min(100, s.oxygen + RULES.freshAirRate * STEP);
  } else {
    s.oxygen = Math.max(0, s.oxygen - drainRate(s) * STEP);
  }
  if (s.oxygen <= 0) hurt(s, 'air', emit);
}

function relocateMiner(s, m) {
  let best = null;
  let bestD = Infinity;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = Math.abs(c - m.c) + Math.abs(r - m.r);
      if (walkable(s, c, r) && d < bestD) [best, bestD] = [{ c, r }, d];
    }
  }
  Object.assign(m, { c: best.c, r: best.r, from: { ...best }, prog: 0 });
}
function collapse(s, span, emit) {
  const touches = (a) =>
    [a.from, { c: a.c, r: a.r }].some((t) => t.r === span.r && t.c >= span.c0 && t.c <= span.c1);
  for (let c = span.c0; c <= span.c1; c++) {
    s.grid[span.r][c] = 'B';
    delete s.crack[`${span.r},${c}`];
    addFx(s, centerOf(c, span.r).x, centerOf(c, span.r).y, '#6d5b4c', 3);
  }
  s.stats.collapses++;
  const caught = touches(s.player);
  for (const m of s.miners) {
    if (m.state !== 'rescued' && touches(m)) {
      m.blocked = false;
      relocateMiner(s, m);
    }
  }
  if (caught) hurt(s, 'cave', emit);
  else emit('hit');
}
function updateCeilings(s, emit) {
  const next = {};
  const falling = [];
  for (const span of findSpans(s.grid)) {
    if (!span.unstable) continue;
    let t = 0;
    for (let c = span.c0; c <= span.c1; c++) t = Math.max(t, s.crack[`${span.r},${c}`] || 0);
    t++;
    for (let c = span.c0; c <= span.c1; c++) next[`${span.r},${c}`] = t;
    if (t === 1) emit('shoot');
    if (t >= RULES.warnTicks) falling.push(span);
  }
  s.crack = next;
  for (const span of falling) if (s.phase === 'playing') collapse(s, span, emit);
}

function updateMiners(s, emit) {
  const goal = { c: s.player.c, r: s.player.r };
  const boarding = onLift(s);
  followers(s).forEach((m, rank) => {
    if (m.prog > 0) {
      if (++m.prog >= RULES.minerTicks) Object.assign(m, { prog: 0, from: { c: m.c, r: m.r } });
      return;
    }
    const path = route(s, m, goal);
    m.blocked = !path;
    if (!path) return;
    if (boarding && path.dist === 0) {
      m.state = 'rescued';
      s.score += RULES.minerScore;
      s.stats.rescued++;
      s.boardFlash = 60;
      setMessage(s, `Miner rescued! +${RULES.minerScore}`, `矿工获救！+${RULES.minerScore}`);
      emit('coin');
      addFx(s, centerOf(m.c, m.r).x, centerOf(m.c, m.r).y, '#ffe36a', 8, 50);
      return;
    }
    if (path.dist <= (boarding ? 0 : rank + 1)) return;
    Object.assign(m, { c: path.next.c, r: path.next.r, prog: 1 });
  });
}

function updateFx(s) {
  for (const f of s.fx) {
    f.x += f.vx * STEP;
    f.y += f.vy * STEP;
    f.vy += 260 * STEP;
    f.ttl--;
  }
  s.fx = s.fx.filter((f) => f.ttl > 0);
}

function finishSector(s, emit) {
  s.score += Math.floor(s.oxygen) * 2;
  if (s.sector === SECTORS.length - 1) {
    s.score += s.lives * 500;
    s.phase = 'won';
    return;
  }
  emit('win');
  loadSector(s, s.sector + 1);
  setMessage(s, 'Sector clear! Next mine', '矿区完成！前往下一个矿区');
}

function tick(s, dir, emit) {
  s.ticks++;
  const p = s.player;
  if (p.hurt > 0) p.hurt--;
  if (s.banner > 0) s.banner--;
  if (s.boardFlash > 0) s.boardFlash--;
  if (s.message && --s.message.ttl <= 0) s.message = null;
  s.latch.dig = Math.max(0, s.latch.dig - 1);
  s.latch.use = Math.max(0, s.latch.use - 1);
  movePlayer(s, dir, emit);
  tileEffects(s, emit);
  updateCeilings(s, emit);
  if (s.phase === 'playing') updateOxygen(s, emit);
  if (s.phase === 'playing') updateMiners(s, emit);
  updateFx(s);
  if (s.phase === 'playing' && s.miners.every((m) => m.state === 'rescued')) finishSector(s, emit);
  rememberDigPrompt(s);
}

function readDir(input) {
  const axis = (neg, pos) => (input.held(...pos) ? 1 : 0) - (input.held(...neg) ? 1 : 0);
  return {
    dx: axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']),
    dy: axis(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']),
  };
}

// Advance by `dt` seconds. Returns false (and touches nothing) for an invalid dt.
export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (input.pressed('Space')) s.latch.dig = RULES.bufferTicks;
  if (input.pressed('KeyX')) s.latch.use = RULES.bufferTicks;
  const dir = readDir(input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, emit);
  return true;
}

// ---------------------------------------------------------------------------
// Derived view state: warnings, prompts, status
// ---------------------------------------------------------------------------

function warnings(s) {
  return findSpans(s.grid)
    .filter((sp) => sp.unstable)
    .map((sp) => {
      const elapsed = s.crack[`${sp.r},${sp.c0}`] || 0;
      return {
        r: sp.r,
        c0: sp.c0,
        c1: sp.c1,
        loose: sp.loose,
        elapsed: elapsed * STEP,
        remaining: Math.max(0, (RULES.warnTicks - elapsed) * STEP),
      };
    });
}

const P = (en, zh, quiet = false) => ({ en, zh, quiet });
function promptFor(s, warns) {
  if (s.phase === 'won') return P('All miners are safe!', '所有矿工都获救了！');
  if (s.phase === 'lost') return P('No lives left', '生命耗尽');
  const p = s.player;
  const here = warns.find((w) => w.r === p.r && p.c >= w.c0 && p.c <= w.c1);
  if (here) {
    const secs = Math.ceil(here.remaining);
    if (s.beams > 0 && DUG.includes(s.grid[p.r][p.c]))
      return P(`Cracks! X: brace here (${secs}s)`, `裂缝！按X加支架（${secs}秒）`);
    return P(`Cracks! Leave the tunnel (${secs}s)`, `裂缝！离开隧道（${secs}秒）`);
  }
  // Low air is actionable, so it outranks a crack that is somewhere else.
  if (s.oxygen < RULES.lowAir && p.r > 0)
    return P('Low air! Climb to the surface', '氧气不足！回到地面');
  if (warns.length) return P('Cracks nearby: stay clear', '附近有裂缝：请远离');
  if (waitingBy(s, 1).length) return P('X: wake the miner', '按X唤醒矿工');
  const fol = followers(s);
  const stuck = fol.some((m) => m.blocked);
  if (fol.length && !stuck && onLift(s))
    return P('Stay on the lift: miners coming', '留在升降梯上等矿工');
  {
    const tc = p.c + p.facing.dx;
    const tr = p.r + p.facing.dy;
    const ch = inGrid(tc, tr) ? s.grid[tr][tc] : ' ';
    if (ch === 'R') return P("Rock can't be dug: go around", '岩石挖不动：绕过去');
    if (DIGGABLE.includes(ch)) {
      if (digWouldCrack(s, tc, tr)) {
        const canBeam = DUG.includes(s.grid[p.r][p.c]) && !digWouldCrack(s, tc, tr, p);
        if (canBeam) {
          return s.beams > 0
            ? P('X: place a beam, then Space', '先按X放支架，再按空格')
            : P('No beams: restock at the lift', '没有支架：去升降梯补充');
        }
        return P('Space: dig (ceiling will crack)', '空格：挖掘（顶部会开裂）');
      }
      return ch === 'B'
        ? P('Space: clear the rubble', '空格：清理碎石')
        : P('Space: dig', '空格：挖掘');
    }
  }
  if (p.dig > 0 && !fol.length) return P('Space: dig', '空格：挖掘');
  if (stuck) return P('Miner stuck: dig a path to them', '矿工被困：为他挖通道');
  if (p.r === 0 && s.oxygen < 60 && !fol.length)
    return P('Fresh air: wait here to refill', '地面空气清新：在此等待补氧', true);
  if (fol.length) return P('Lead the miners to the lift', '带矿工回到升降梯', true);
  return P('Face earth, press Space to dig', '面向泥土，按空格挖掘', true);
}

// A dig instruction stays on screen for 1 s after you pause between tiles, so it never flickers.
const STICKY_TICKS = 120;
const STICKY_STEP = 6; // the prompt is sampled every 6 ticks
function rememberDigPrompt(s) {
  if (s.sticky) s.sticky.ticks--;
  if (s.phase !== 'playing' || s.ticks % STICKY_STEP) return;
  const now = promptFor(s, warnings(s));
  if (/^Space: (dig|clear)/.test(now.en))
    s.sticky = { en: now.en, zh: now.zh, ticks: STICKY_TICKS };
}
function shownPrompt(s, warns) {
  const now = promptFor(s, warns);
  return now.quiet && s.sticky?.ticks > 0 ? { en: s.sticky.en, zh: s.sticky.zh } : now;
}

function objectiveOf(s) {
  const fol = followers(s).length > 0;
  let target = s.lift;
  if (!fol) {
    target = waitingBy(s, Infinity)[0] || target;
  }
  const { x, y } = centerOf(target.c, target.r);
  return { kind: target === s.lift ? 'lift' : 'miner', c: target.c, r: target.r, x, y };
}

function buildStatus(s, prompt) {
  const total = s.miners.length;
  const saved = s.miners.filter((m) => m.state === 'rescued').length;
  const oxy = Math.ceil(s.oxygen);
  // Event messages (life lost, rescue) are spoken too, so they are never canvas-only.
  const note = (lang) => (s.message ? `${s.message[lang]} · ` : '');
  return {
    en: `Sector ${s.sector + 1}/3 · Miners ${saved}/${total} · Oxygen ${oxy} · ${note('en')}${prompt.en}`,
    zh: `矿区 ${s.sector + 1}/3 · 矿工 ${saved}/${total} · 氧气 ${oxy} · ${note('zh')}${prompt.zh}`,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STRATA =
  '#7a5238 #6f4a33 #654230 #5b3b2b #523526 #493021 #402a1d #38251a #302016 #2a1c14'.split(' ');
// Sprite keys: helmet, lamp, boots/brim, skin, eyes, suit, vest stripe.
const palette = (list) => Object.fromEntries(list.split(' ').map((c, i) => ['hlbsecv'[i], c]));
const PLAYER_ROWS = [
  '...hhhh...',
  '..hhhhhh..',
  '..hhhhhhl.',
  '.bbbbbbbb.',
  '..ssesse..',
  '..ssssss..',
  '.cccccccc.',
  '.ccvvvvcc.',
  '.ccvvvvcc.',
  '.sscccc.ss',
  '..cc..cc..',
  '..bb..bb..',
];
const PLAYER_STEP = [...PLAYER_ROWS.slice(0, 10), '.cc....cc.', '.bb....bb.'];
const PLAYER_PALETTE = palette('#f2c230 #fff6a8 #7a4a1a #f0c19c #1d1d1d #2f6fb3 #e8e8e8');
const MINER_PALETTE = palette('#e9772e #9dffb0 #5a3a24 #d9a07c #1d1d1d #b8452c #f2d49a');
const mirror = (rows) => rows.map((row) => [...row].reverse().join(''));

// Headframe and cage: the goal of every sector. Flashes green while miners board.
function drawLift(ctx, x, y, flash) {
  const lit = flash > 0 && (flash >> 3) % 2 === 0;
  ctx.fillStyle = lit ? '#7dffa0' : '#9aa4b2';
  ctx.fillRect(x, y, 3, TILE - 4);
  ctx.fillRect(x + TILE - 3, y, 3, TILE - 4);
  ctx.fillRect(x, y, TILE, 3);
  ctx.fillStyle = lit ? '#3fbf6a' : '#d9a82a';
  ctx.fillRect(x + 3, y + 3, TILE - 6, 3);
  ctx.fillStyle = '#5a6270';
  ctx.fillRect(x + 11, y + 6, 2, TILE - 12);
  ctx.fillStyle = '#d9a82a';
  ctx.fillRect(x + 2, y + TILE - 7, TILE - 4, 4);
  ctx.fillStyle = '#222';
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 4 + k * 7, y + TILE - 7, 3, 4);
}

function drawTile(ctx, ch, x, y, r, c, sector, boardFlash) {
  const seed = (c * 31 + r * 17) % 7;
  if (r === 0) {
    ctx.fillStyle = '#2a4a72';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#4f8a3c';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
    if (ch === 'L') drawLift(ctx, x, y, boardFlash);
    return;
  }
  if (ch === 'R') {
    ctx.fillStyle = '#5d6670';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7a8591';
    ctx.fillRect(x + 2, y + 2, 9, 7);
    ctx.fillRect(x + 12, y + 11, 9, 8);
    ctx.fillStyle = '#434a53';
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
    ctx.fillRect(x + TILE - 2, y, 2, TILE);
  } else if (ch === 'E' || ch === 'W') {
    ctx.fillStyle = ch === 'W' ? '#b08a58' : STRATA[(r - 1) % STRATA.length];
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = ch === 'W' ? '#d8b878' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 3 + seed, y + 4, 3, 2);
    ctx.fillRect(x + 14 - seed, y + 13, 3, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 6, y + 18 - seed / 2, 4, 2);
    if (ch === 'W') {
      ctx.fillStyle = '#7a5a34';
      ctx.fillRect(x + 4, y + 10, 2, 2);
      ctx.fillRect(x + 16, y + 6, 2, 2);
    }
  } else if (ch === 'B') {
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7d6a58';
    ctx.fillRect(x + 2, y + 12, 9, 10);
    ctx.fillRect(x + 11, y + 8, 10, 14);
    ctx.fillStyle = '#9a8570';
    ctx.fillRect(x + 4, y + 13, 4, 3);
    ctx.fillRect(x + 13, y + 10, 4, 3);
  } else {
    ctx.fillStyle = ch === 'T' ? '#1c2438' : '#2b1c15';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = ch === 'T' ? '#2c3650' : '#3d2a1e';
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.fillStyle = sector.ceiling || '#4a3220';
    ctx.fillRect(x, y, TILE, 3);
  }
  if (ch === 'P') {
    ctx.fillStyle = '#c58a3d';
    ctx.fillRect(x + 1, y, 5, TILE - 3);
    ctx.fillRect(x + TILE - 6, y, 5, TILE - 3);
    ctx.fillRect(x, y, TILE, 6);
    ctx.fillStyle = '#8a5a22';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 3, y + 3 + k * 5, 1, 3);
    for (let k = 0; k < 4; k++) ctx.fillRect(x + TILE - 4, y + 5 + k * 5, 1, 3);
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 2 + k * 4, y + 1 + (k % 2) * 2, 2, 1);
    ctx.fillStyle = '#e8b86a';
    ctx.fillRect(x + 1, y, 1, TILE - 3);
    ctx.fillRect(x + TILE - 6, y, 1, TILE - 3);
    for (let k = 0; k < 8; k++) ctx.fillRect(x + 6 + k, y + 6 + k, 2, 2);
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(x + 3, y + 2, 2, 2);
    ctx.fillRect(x + TILE - 5, y + 2, 2, 2);
  }
}

function drawCracks(ctx, s, warns) {
  for (const w of warns) {
    const x = w.c0 * TILE;
    const y = TOP + w.r * TILE;
    const width = (w.c1 - w.c0 + 1) * TILE;
    ctx.fillStyle = 'rgba(255,90,60,0.22)';
    ctx.fillRect(x, y, width, TILE);
    ctx.fillStyle = '#ff7a4a';
    for (let k = 0; k < width / 6; k++) ctx.fillRect(x + k * 6, y + 3 + (k % 2) * 4, 4, 2);
    for (let c = w.c0; c <= w.c1; c++) {
      ctx.fillRect(c * TILE + 11, y + 5, 2, 8 + (c % 3) * 2);
      if (Math.floor(s.ticks / 12 + c) % 3 === 0)
        ctx.fillRect(c * TILE + 6, y + 12 + (c % 2) * 4, 2, 2);
    }
    ctx.fillStyle = '#d8c3a0';
    for (let k = 0; k < width / 8; k++) {
      const fall = (s.ticks * 2 + k * 17) % TILE;
      ctx.fillRect(x + 3 + k * 8 + (k % 3), y + 4 + fall, 2, 2);
    }
    ctx.fillStyle = '#240d0a';
    ctx.fillRect(x, y - 1, width, 5);
    ctx.fillStyle = '#ff5a3c';
    ctx.fillRect(x + 1, y, Math.max(1, ((width - 2) * w.remaining) / (RULES.warnTicks * STEP)), 3);
    text(
      ctx,
      String(Math.ceil(w.remaining)),
      x + width / 2,
      y + TILE / 2 - 4,
      '#fff2b0',
      14,
      'center',
    );
  }
}

// Underground is dim; helmet lamps lift the dark in soft stepped discs.
function shade(ctx) {
  ctx.fillStyle = 'rgba(6,8,16,0.32)';
  ctx.fillRect(0, TOP + TILE, 480, (ROWS - 1) * TILE);
}
function halo(ctx, cx, cy, radius, color) {
  ctx.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const rad = radius * (1 - k * 0.3);
    ctx.globalAlpha = 0.09;
    for (let dy = -rad; dy < rad; dy += 4) {
      const half = Math.sqrt(rad * rad - dy * dy);
      const y = Math.max(TOP + TILE, cy + dy);
      if (y < FIELD_BOTTOM) ctx.fillRect(cx - half, y, half * 2, 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTank(ctx, t, ticks) {
  const x = t.c * TILE + 7;
  const y = TOP + t.r * TILE + 6;
  ctx.fillStyle = '#35c7e8';
  ctx.fillRect(x, y + 3, 10, 14);
  ctx.fillRect(x + 2, y, 6, 4);
  ctx.fillStyle = '#dff8ff';
  ctx.fillRect(x + 2, y + 7, 6, 3);
  if ((ticks >> 5) % 2) ctx.fillRect(x + 11, y + 1, 2, 2);
}

function drawLamp(ctx, x, y, f, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const cx = x + 10 + f.dx * 8;
  const cy = y + 9 + f.dy * 8;
  for (let k = 0; k < 3; k++) {
    const w = 6 + k * 6;
    ctx.fillRect(
      f.dx ? cx + (f.dx > 0 ? k * 9 : -k * 9 - 9) : cx - w / 2,
      f.dy ? cy + (f.dy > 0 ? k * 9 : -k * 9 - 9) : cy - w / 2,
      f.dx ? 9 : w,
      f.dy ? 9 : w,
    );
  }
  ctx.globalAlpha = 1;
}

function drawActor(ctx, pos, rows, palette, face) {
  pixelSprite(ctx, face < 0 ? mirror(rows) : rows, pos.x + 2, pos.y, 2, palette);
}

function drawWorld(ctx, s, env, warns) {
  const sector = sectorOf(s);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++)
      drawTile(ctx, s.grid[r][c], c * TILE, TOP + r * TILE, r, c, sector, s.boardFlash);
  }
  shade(ctx);
  const lamps = [actorPos(s.player, RULES.moveTicks)];
  for (const m of s.miners) if (m.state !== 'rescued') lamps.push(actorPos(m, RULES.minerTicks));
  lamps.forEach((pos, i) =>
    halo(ctx, pos.x + 12, pos.y + 11, i ? 44 : 64, i ? '#b8ffc8' : '#fff0a0'),
  );
  drawCracks(ctx, s, warns);
  const right = s.lift.c > 15;
  const label = s.boardFlash > 0 ? `+${RULES.minerScore}` : env.t('LIFT', '升降梯');
  const labelX = right ? s.lift.c * TILE - 2 : s.lift.c * TILE + TILE + 2;
  text(
    ctx,
    label,
    labelX,
    TOP + 3,
    s.boardFlash > 0 ? '#7dffa0' : '#ffe36a',
    14,
    right ? 'right' : 'left',
  );
  s.tanks.filter((t) => !t.taken).forEach((t) => drawTank(ctx, t, s.ticks));
  const p = s.player;
  const pp = actorPos(p, RULES.moveTicks);
  const pface = p.facing.dx || (p.c !== p.from.c ? p.c - p.from.c : 1);
  const lead = [...followers(s)];
  s.miners.forEach((m) => {
    if (m.state === 'rescued') return;
    const pos = actorPos(m, RULES.minerTicks);
    const walking = m.prog > 0;
    const rows = walking && (s.ticks >> 3) % 2 ? PLAYER_STEP : PLAYER_ROWS;
    if (m.state === 'following') {
      const idx = lead.indexOf(m);
      const prev = idx > 0 ? actorPos(lead[idx - 1], RULES.minerTicks) : pp;
      ctx.fillStyle = '#9dffb0';
      const steps = 6;
      for (let k = 1; k < steps; k++) {
        ctx.fillRect(
          pos.x + 11 + ((prev.x - pos.x) * k) / steps,
          pos.y + 12 + ((prev.y - pos.y) * k) / steps,
          2,
          2,
        );
      }
    } else {
      const glow = (s.ticks >> 4) % 2 ? 'rgba(157,255,176,0.30)' : 'rgba(157,255,176,0.15)';
      ctx.fillStyle = glow;
      ctx.fillRect(pos.x - 4, pos.y - 4, TILE + 8, TILE + 8);
    }
    drawActor(ctx, pos, rows, MINER_PALETTE, m.c > m.from.c ? 1 : -1);
    if (m.state === 'waiting') text(ctx, '!', pos.x + 12, pos.y - 14, '#ffe36a', 16, 'center');
    if (m.blocked) text(ctx, '?', pos.x + 12, pos.y - 14, '#ff9a8a', 16, 'center');
  });
  const f =
    p.prog > 0 ? { dx: Math.sign(p.c - p.from.c), dy: Math.sign(p.r - p.from.r) } : p.facing;
  drawLamp(ctx, pp.x, pp.y, f, '#fff6a8', 0.16);
  const rows = p.prog > 0 && (s.ticks >> 3) % 2 ? PLAYER_STEP : PLAYER_ROWS;
  drawActor(ctx, pp, rows, PLAYER_PALETTE, pface);
  if (p.dig > 0) {
    const swing = (p.dig >> 2) % 2;
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(pp.x + 12 + f.dx * (10 + swing * 4), pp.y + 10 + f.dy * (10 + swing * 4), 7, 5);
    ctx.fillStyle = '#7a4a1a';
    ctx.fillRect(pp.x + 11 + f.dx * 6, pp.y + 12 + f.dy * 6, 8, 2);
  }
  if (p.hurt > 0 && (p.hurt >> 3) % 2) {
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(pp.x + 1, pp.y - 2, 22, 2);
    ctx.fillRect(pp.x + 1, pp.y + TILE, 22, 2);
  }
  for (const fx of s.fx) {
    ctx.fillStyle = fx.color;
    ctx.fillRect(Math.round(fx.x), Math.round(fx.y), 3, 3);
  }
  if (s.banner > 0) {
    ctx.globalAlpha = Math.min(1, s.banner / 60);
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    ctx.fillRect(40, TOP + TILE + 4, 400, 44);
    text(
      ctx,
      `${env.t('Sector', '矿区')} ${s.sector + 1}: ${env.t(sector.name.en, sector.name.zh)}`,
      240,
      TOP + TILE + 8,
      '#ffe36a',
      16,
      'center',
    );
    text(
      ctx,
      env.t(SECTOR_HINT[s.sector].en, SECTOR_HINT[s.sector].zh),
      240,
      TOP + TILE + 28,
      '#e8e8e8',
      14,
      'center',
    );
    ctx.globalAlpha = 1;
  }
}

function drawHud(ctx, s, env, prompt, warns) {
  ctx.fillStyle = '#0d1018';
  ctx.fillRect(0, 0, 480, TOP);
  ctx.fillRect(0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  const saved = s.miners.filter((m) => m.state === 'rescued').length;
  text(ctx, `${env.t('S', '区')}${s.sector + 1}/3`, 6, 6, '#ffe36a', 14);
  text(ctx, `${env.t('Miners', '矿工')} ${saved}/${s.miners.length}`, 62, 6, '#ffb070', 14);
  const low = s.oxygen < RULES.lowAir;
  text(ctx, env.t('Air', '氧气'), 168, 6, low ? '#ff8a70' : '#7fe0ff', 14);
  ctx.fillStyle = '#1b2a3a';
  ctx.fillRect(206, 7, 62, 12);
  ctx.fillStyle = low ? '#ff5a3c' : '#35c7e8';
  ctx.fillRect(207, 8, Math.round((60 * s.oxygen) / 100), 10);
  text(ctx, `-${drainRate(s).toFixed(1)}`, 272, 6, '#9aa4b2', 14);
  text(ctx, `${env.t('Beams', '支架')} ${s.beams}`, 330, 6, '#e0a850', 14);
  for (let i = 0; i < RULES.lives; i++) {
    ctx.fillStyle = i < s.lives ? '#ff4d6d' : '#3a2a30';
    const hx = 410 + i * 18;
    ctx.fillRect(hx, 7, 5, 6);
    ctx.fillRect(hx + 7, 7, 5, 6);
    ctx.fillRect(hx, 10, 12, 3);
    ctx.fillRect(hx + 2, 13, 8, 3);
    ctx.fillRect(hx + 4, 16, 4, 2);
  }
  const alarm = warns.length > 0 && Math.floor(s.ticks / 20) % 2 === 0;
  const warnColor = warns.length ? (alarm ? '#ffd0c0' : '#ff8a70') : '#f4f4f4';
  const line = s.message && prompt.quiet ? s.message : prompt;
  text(ctx, env.t(line.en, line.zh), 240, FIELD_BOTTOM + 6, warnColor, 16, 'center');
}

function drawBurrow(ctx, s, env) {
  background(ctx, '#0d1018');
  const warns = warnings(s);
  drawWorld(ctx, s, env, warns);
  drawHud(ctx, s, env, shownPrompt(s, warns), warns);
}

// ---------------------------------------------------------------------------
// Public game
// ---------------------------------------------------------------------------

export function createGame(env) {
  const s = newState();
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      if (!advance(s, dt, input, emit) && s.phase === 'playing') return;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.sound(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'All three sectors are clear. Every miner is home!',
                '三个矿区全部清空，矿工们都平安回家了！',
              )
            : env.t(
                'The mine took your last life. Brace and watch your air.',
                '矿井夺走了最后一条生命。记得加支架，留意氧气。',
              ),
        });
      }
    },
    draw(ctx) {
      drawBurrow(ctx, s, env);
    },
    getState() {
      const warns = warnings(s);
      const prompt = shownPrompt(s, warns);
      const p = s.player;
      const rect = playerRect(s);
      return {
        phase: s.phase,
        score: s.score,
        lives: s.lives,
        time: s.ticks * STEP,
        sector: s.sector + 1,
        sectorName: sectorOf(s).name,
        oxygen: s.oxygen,
        oxygenDrain: drainRate(s),
        beams: s.beams,
        beamsMax: sectorOf(s).beams,
        lift: { ...s.lift },
        tiles: s.grid.map((row) => row.join('')),
        tanks: s.tanks.map((t) => ({ ...t })),
        warnings: warns,
        miners: s.miners.map((m) => ({
          id: m.id,
          c: m.c,
          r: m.r,
          state: m.state,
          order: m.order,
          blocked: m.blocked,
          moving: m.prog > 0,
          rect: { ...actorPos(m, RULES.minerTicks), w: 24, h: TILE },
        })),
        minersRescued: s.miners.filter((m) => m.state === 'rescued').length,
        minersTotal: s.miners.length,
        player: {
          c: p.c,
          r: p.r,
          from: { ...p.from },
          moving: p.prog > 0,
          digging: p.dig > 0,
          facing: { ...p.facing },
          hurt: p.hurt > 0,
          rect,
        },
        camera: { x: 0, y: TOP, width: 480, height: ROWS * TILE },
        hud: { top: [0, TOP], bottom: [FIELD_BOTTOM, 320] },
        objective: objectiveOf(s),
        prompt: { en: prompt.en, zh: prompt.zh },
        message: s.message ? { en: s.message.en, zh: s.message.zh } : null,
        stats: { ...s.stats },
        status: buildStatus(s, prompt),
      };
    },
  };
}
