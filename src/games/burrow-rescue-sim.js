// The simulation: level loading, tile stepping, digging, air, ceilings, miners and level clears.
import { LEVELS, LEVEL_COUNT } from './burrow-rescue-levels.js';
import {
  DIGGABLE,
  DUG,
  RULES,
  STEP,
  COLS,
  ROWS,
  centerOf,
  drainRate,
  findSpans,
  followers,
  fuseTicks,
  inGrid,
  levelOf,
  onLift,
  route,
  waitingBy,
  walkable,
} from './burrow-rescue-map.js';
import { rememberDigPrompt } from './burrow-rescue-view.js';

const MAX_FX = 48;

function loadLevel(s, index) {
  const level = LEVELS[index];
  const miners = [];
  const tanks = [];
  let lift = { c: 0, r: 0 };
  s.grid = level.map.map((line, r) =>
    [...line].map((ch, c) => {
      if (ch === 'L') lift = { c, r };
      if (ch === 'M') miners.push(newMiner(miners.length, c, r));
      if (ch === 'A') tanks.push({ c, r, taken: false });
      return ch === 'M' || ch === 'A' || ch === 'C' ? 'T' : ch;
    }),
  );
  Object.assign(s, {
    level: index,
    miners,
    tanks,
    lift,
    oxygen: 100,
    beams: level.beams,
    lives: RULES.lives,
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

export function newState(index = 0) {
  const s = {
    phase: 'playing',
    score: 0,
    cleared: 0,
    ticks: 0,
    acc: 0,
    stats: { digs: 0, braces: 0, calls: 0, rescued: 0, collapses: 0, hits: 0, tanks: 0 },
  };
  loadLevel(s, index);
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
  s.oxygen = Math.max(0, s.oxygen - levelOf(s).digCost);
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
  if (onLift(s) && s.beams < levelOf(s).beams) {
    s.beams = levelOf(s).beams;
    if (!s.message) setMessage(s, 'Beams restocked', '支架已补充');
  }
}

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
    if (t >= fuseTicks(s)) falling.push(span);
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

function finishLevel(s, emit) {
  s.score += Math.floor(s.oxygen) * 2;
  s.cleared++;
  if (s.level === LEVEL_COUNT - 1) {
    s.score += s.lives * 500;
    s.phase = 'won';
    return;
  }
  emit('win');
  loadLevel(s, s.level + 1);
  setMessage(s, 'Level clear! Next mine', '关卡完成！前往下一关');
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
  if (s.phase === 'playing' && s.miners.every((m) => m.state === 'rescued')) finishLevel(s, emit);
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
