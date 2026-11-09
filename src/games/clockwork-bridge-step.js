// Clockwork machine physics: gears drive linked decks, the player rides, carries a key, and escapes.
import { LEVELS, LEVEL_COUNT } from './clockwork-bridge-levels.js';

const STEP = 1 / 240,
  MAX_DT = 0.1,
  GRAVITY = 720,
  JUMP_SPEED = 260,
  RUN_SPEED = 80,
  GROUND_ACCEL = 1100,
  AIR_ACCEL = 500,
  MAX_FALL = 420,
  COYOTE = 0.1,
  BUFFER = 0.12,
  GEAR_REACH = 40,
  KEY_REACH = 30,
  DOOR_REACH = 40,
  DEATH_Y = 345,
  LIVES = 5,
  EPS = 1e-6,
  SUPPORT_TOL = 1e-4,
  SLIDE_SPEED = 60,
  MESSAGE_TIME = 2.4,
  MAX_FX = 48,
  CLEAR_SCORE = 1000,
  UNLOCK_SCORE = 200,
  LIFE_SCORE = 100,
  PW = 14,
  PH = 20,
  KEY_SIZE = 12,
  SPRITE_SCALE = 2;
const WALLS = [
  { x: -40, y: -400, w: 40, h: 1000, style: 'wall' },
  { x: 480, y: -400, w: 40, h: 1000, style: 'wall' },
  { x: 0, y: -40, w: 480, h: 40, style: 'wall' },
];

export const rectOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
const overlaps = (a, b) =>
  a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
export const centerOf = (o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
export const gap2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampSpan = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (v, target, d) => (v < target ? Math.min(target, v + d) : Math.max(target, v - d));
export const bridgeAt = (b, p) => ({
  x: b.a.x + (b.b.x - b.a.x) * p,
  y: b.a.y + (b.b.y - b.a.y) * p,
});

function groupRoots(bridges, gears) {
  const parent = bridges.map((b) => b.id);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const g of gears) {
    for (const d of g.drives) parent[find(d[0])] = find(g.drives[0][0]);
  }
  return bridges.map((b) => find(b.id));
}

function retarget(s) {
  for (const b of s.bridges) {
    let t = 0;
    for (const g of s.gears) for (const d of g.drives) if (d[0] === b.id) t ^= g.state ^ d[1];
    b.target = t;
  }
}

function loadMachine(s, index, gearStates = []) {
  const m = LEVELS[index];
  s.machine = index;
  s.level = index + 1;
  s.solids = [...WALLS, ...m.solids].map((o) => ({ ...o }));
  s.gears = m.gears.map((g) => ({
    ...g,
    drives: g.drives.map((d) => [...d]),
    state: gearStates[g.id] ? 1 : 0,
  }));
  s.bridges = m.bridges.map((b) => ({
    ...b,
    a: { ...b.a },
    b: { ...b.b },
    p: 0,
    target: 0,
    x: b.a.x,
    y: b.a.y,
    vx: 0,
    vy: 0,
    jam: '',
  }));
  retarget(s);
  const roots = groupRoots(s.bridges, s.gears);
  for (const b of s.bridges) {
    b.group = roots[b.id];
    b.p = b.target;
    Object.assign(b, bridgeAt(b, b.p));
  }
  s.keys = m.keys.map((k, id) => ({
    id,
    x: k.x,
    y: k.y,
    w: KEY_SIZE,
    h: KEY_SIZE,
    state: 'floor',
    on: -1,
  }));
  s.door = { ...m.door, locked: true };
  s.pads = m.pads.map((o) => ({ ...o }));
  s.player = {
    x: m.spawn.x,
    y: m.spawn.y,
    w: PW,
    h: PH,
    vx: 0,
    vy: 0,
    grounded: true,
    ground: -1,
    coyote: 0,
    jumpBuffer: 0,
    facing: 1,
  };
  s.latch = { crank: false, key: false };
  s.idle = 0;
  s.acted = 0;
  s.fx = [];
}

export function createMachine(index = 0, gearStates = []) {
  const first = Math.min(LEVEL_COUNT, Math.max(1, Math.floor(Number(index) + 1) || 1)) - 1;
  const s = {
    phase: 'playing',
    score: 0,
    lives: LIVES,
    cleared: 0,
    time: 0,
    acc: 0,
    seed: 7,
    message: null,
    gearSpin: 0,
    stats: {
      jumps: 0,
      cranks: 0,
      jams: 0,
      falls: 0,
      picks: 0,
      drops: 0,
      unlocks: 0,
      landings: 0,
      edgeExits: 0,
      rejected: 0,
      resets: 0,
    },
  };
  loadMachine(s, first, gearStates);
  return s;
}

function say(s, en, zh) {
  s.message = { en, zh, t: MESSAGE_TIME };
}

function spawnFx(s, kind, x, y, count = 4) {
  for (let n = 0; n < count; n++) {
    s.seed = (Math.imul(1664525, s.seed) + 1013904223) >>> 0;
    const r = s.seed / 4294967296;
    s.fx.push({ kind, x, y, vx: (r - 0.5) * 60, vy: -10 - r * 40, t: 0.45 });
  }
  if (s.fx.length > MAX_FX) s.fx.splice(0, s.fx.length - MAX_FX);
}

function allRects(s) {
  return [
    ...s.solids.map((o) => ({ ...rectOf(o), id: -1 })),
    ...s.bridges.map((b) => ({ ...rectOf(b), id: b.id })),
  ];
}

function supportOf(s) {
  const p = s.player,
    feet = p.y + p.h;
  let best = null;
  for (const r of allRects(s)) {
    const gap = Math.abs(r.y - feet);
    if (gap > SUPPORT_TOL || p.x >= r.x + r.w - EPS || p.x + p.w <= r.x + EPS) continue;
    const mid = p.x + p.w / 2,
      centered = mid >= r.x && mid <= r.x + r.w,
      tip = centered ? 0 : mid < r.x ? -1 : 1;
    const better =
      !best ||
      (centered && best.tip !== 0) ||
      (centered === (best.tip === 0) && (gap < best.gap || (gap === best.gap && r.id >= 0)));
    if (better) best = { id: r.id, gap, tip, rect: r };
  }
  return best;
}

function tryMoveGroup(s, group, h) {
  const moves = group.map((b) => {
    const np = approach(b.p, b.target, b.rate * h),
      pos = bridgeAt(b, np);
    return { b, np, pos, dx: pos.x - b.x, dy: pos.y - b.y };
  });
  const next = new Map(s.bridges.map((b) => [b.id, rectOf(b)]));
  for (const m of moves) next.set(m.b.id, { ...rectOf(m.b), ...m.pos });
  const p = s.player,
    ride = p.grounded ? moves.find((m) => m.b.id === p.ground) : null,
    body = { ...rectOf(p) };
  if (ride) {
    body.x += ride.dx;
    body.y += ride.dy;
  }
  let landing = null;
  if (!ride) {
    for (const m of moves) {
      const r = next.get(m.b.id),
        feet = p.y + p.h;
      if (
        m.dy < 0 &&
        feet <= m.b.y + EPS &&
        feet > r.y + EPS &&
        body.x < r.x + r.w - EPS &&
        body.x + body.w > r.x + EPS
      ) {
        body.y = r.y - p.h;
        landing = m;
      }
    }
  }
  let cause = '';
  const blockers = [...s.solids, ...[...next.values()]];
  if (blockers.some((r) => overlaps(body, r))) cause = 'player';
  const carriedKeys = [];
  for (const k of s.keys) {
    if (k.state !== 'floor') continue;
    const m = moves.find((q) => q.b.id === k.on),
      kr = m ? { ...rectOf(k), x: k.x + m.dx, y: k.y + m.dy } : rectOf(k);
    if (m) carriedKeys.push([k, m]);
    if (!cause && blockers.some((r) => overlaps(kr, r))) cause = 'key';
  }
  for (const m of moves) {
    const r = next.get(m.b.id);
    const hitsSolid = s.solids.some((o) => overlaps(r, o));
    const hitsBridge = s.bridges.some((o) => o.id !== m.b.id && overlaps(r, next.get(o.id)));
    if (!cause && (hitsSolid || hitsBridge)) cause = 'solid';
  }
  if (cause) {
    if (moves.some((m) => !m.b.jam)) {
      s.stats.jams++;
      say(s, 'Gear jammed: something is in the way', '齿轮卡住：有东西挡路');
      const lead = moves[0].b;
      spawnFx(s, 'spark', lead.x + lead.w / 2, lead.y + lead.h / 2, 6);
    }
    for (const m of moves) m.b.jam = cause;
    return;
  }
  for (const m of moves) {
    m.b.p = m.np;
    m.b.x = m.pos.x;
    m.b.y = m.pos.y;
    m.b.vx = m.dx / h;
    m.b.vy = m.dy / h;
    m.b.jam = '';
  }
  if (ride) Object.assign(p, { x: body.x, y: body.y });
  if (landing) {
    Object.assign(p, { y: body.y, grounded: true, ground: landing.b.id, vy: 0, coyote: 0 });
    p.vx -= landing.b.vx;
  }
  for (const [k, m] of carriedKeys) {
    k.x += m.dx;
    k.y += m.dy;
  }
}

function moveBridges(s, h) {
  const groups = new Map();
  for (const b of s.bridges) {
    b.vx = 0;
    b.vy = 0;
    if (Math.abs(b.p - b.target) < 1e-9) {
      if (b.p !== b.target) {
        b.p = b.target;
        Object.assign(b, bridgeAt(b, b.p));
      }
      b.jam = '';
      continue;
    }
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(b);
  }
  for (const group of groups.values()) tryMoveGroup(s, group, h);
}

function moveX(s, dx) {
  const p = s.player;
  let allowed = dx;
  for (const r of allRects(s)) {
    if (p.y >= r.y + r.h - EPS || p.y + p.h <= r.y + EPS) continue;
    if (dx > 0) {
      const gap = r.x - (p.x + p.w);
      if (gap >= -EPS && gap < allowed) allowed = Math.max(gap, 0);
    } else {
      const gap = r.x + r.w - p.x;
      if (gap <= EPS && gap > allowed) allowed = Math.min(gap, 0);
    }
  }
  if (allowed !== dx) p.vx = 0;
  p.x += allowed;
}

function moveY(s, dy) {
  const p = s.player;
  let allowed = dy,
    hit = null;
  for (const r of allRects(s)) {
    if (p.x >= r.x + r.w - EPS || p.x + p.w <= r.x + EPS) continue;
    if (dy > 0) {
      const gap = r.y - (p.y + p.h);
      if (gap >= -EPS && gap < allowed) {
        allowed = Math.max(gap, 0);
        hit = r;
      }
    } else {
      const gap = r.y + r.h - p.y;
      if (gap <= EPS && gap > allowed) {
        allowed = Math.min(gap, 0);
        hit = r;
      }
    }
  }
  p.y += allowed;
  if (!hit) return;
  if (dy < 0) {
    p.vy = 0;
    return;
  }
  const b = s.bridges.find((q) => q.id === hit.id);
  s.stats.landings++;
  if (p.vy > 140) spawnFx(s, 'dust', p.x + p.w / 2, p.y + p.h, 3);
  Object.assign(p, { grounded: true, ground: hit.id, vy: 0, coyote: 0 });
  if (b) p.vx -= b.vx;
}

function movePlayer(s, h, dir) {
  const p = s.player;
  let sup = null;
  if (p.grounded) {
    sup = supportOf(s);
    if (sup) {
      p.ground = sup.id;
      p.vy = 0;
    } else {
      const b = s.bridges.find((q) => q.id === p.ground);
      if (b) {
        p.vx += b.vx;
        p.vy += b.vy;
      }
      Object.assign(p, { grounded: false, ground: null, coyote: COYOTE });
      s.stats.edgeExits++;
    }
  }
  if (dir) p.facing = dir;
  if (p.grounded) {
    p.vx = approach(p.vx, dir * RUN_SPEED, GROUND_ACCEL * h);
    if (sup && sup.tip) p.vx = sup.tip * SLIDE_SPEED;
  } else if (dir && dir * p.vx < RUN_SPEED) {
    p.vx += dir * AIR_ACCEL * h;
    if (dir * p.vx > RUN_SPEED) p.vx = dir * RUN_SPEED;
  }
  if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0)) {
    const b = p.grounded ? s.bridges.find((q) => q.id === p.ground) : null;
    if (b) p.vx += b.vx;
    p.vy = -JUMP_SPEED + (b ? b.vy : 0);
    Object.assign(p, { grounded: false, ground: null, jumpBuffer: 0, coyote: 0 });
    s.stats.jumps++;
  }
  if (!p.grounded) p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * h);
  moveX(s, p.vx * h);
  if (!p.grounded) moveY(s, p.vy * h);
}

function operateGear(s) {
  const c = centerOf(s.player);
  let best = null,
    bestD = GEAR_REACH;
  for (const g of s.gears) {
    const d = gap2(c, g);
    if (d <= bestD) [best, bestD] = [g, d];
  }
  if (!best) {
    s.stats.rejected++;
    say(s, 'No gear in reach: move next to one', '够不到齿轮：请靠近一个');
    return;
  }
  best.state ^= 1;
  retarget(s);
  s.stats.cranks++;
  s.gearSpin = 0.5;
  spawnFx(s, 'steam', best.x, best.y - 8, 4);
}

function keyAction(s) {
  const p = s.player,
    c = centerOf(p),
    carried = s.keys.find((k) => k.state === 'carried');
  if (carried) {
    if (s.door.locked && gap2(c, centerOf(s.door)) <= DOOR_REACH) {
      s.door.locked = false;
      carried.state = 'used';
      s.stats.unlocks++;
      say(s, 'Door unlocked: walk in', '门已解锁：走进去');
      spawnFx(s, 'spark', s.door.x + s.door.w / 2, s.door.y + 8, 8);
    } else if (!p.grounded) {
      s.stats.rejected++;
      say(s, 'Drop keys on solid ground', '请在稳固地面上放下钥匙');
    } else {
      const sup = supportOf(s),
        x = sup ? clampSpan(c.x - KEY_SIZE / 2, sup.rect.x, sup.rect.x + sup.rect.w - KEY_SIZE) : 0,
        spot = { x, y: p.y + p.h - KEY_SIZE, w: KEY_SIZE, h: KEY_SIZE };
      if (!sup || allRects(s).some((r) => overlaps(spot, r))) {
        s.stats.rejected++;
        say(s, 'No room to drop the key here', '这里放不下钥匙');
      } else {
        Object.assign(carried, { state: 'floor', x: spot.x, y: spot.y, on: sup.id });
        s.stats.drops++;
        say(s, 'Key dropped', '钥匙已放下');
      }
    }
    return;
  }
  let best = null,
    bestD = KEY_REACH;
  for (const k of s.keys) {
    const d = k.state === 'floor' ? gap2(c, centerOf(k)) : Infinity;
    if (d <= bestD) [best, bestD] = [k, d];
  }
  if (best) {
    Object.assign(best, { state: 'carried', on: null });
    s.stats.picks++;
    say(s, 'Key taken', '已拿起钥匙');
  } else {
    s.stats.rejected++;
    say(s, 'Nothing to take here', '这里没有可拿的东西');
  }
}

function rewind(s) {
  s.lives -= 1;
  s.stats.falls++;
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  loadMachine(s, s.machine);
  say(s, 'You fell: machine rewound', '你坠落了：机器已复位');
}

function resetMachine(s) {
  s.stats.resets++;
  loadMachine(s, s.machine);
  say(s, 'Machine reset: no life lost', '机器已复位：不扣生命');
}

function clearMachine(s) {
  s.cleared++;
  s.score += CLEAR_SCORE + UNLOCK_SCORE;
  if (s.machine + 1 >= LEVEL_COUNT) {
    s.score += s.lives * LIFE_SCORE;
    s.phase = 'won';
    return;
  }
  s.lives = Math.min(LIVES, s.lives + 1);
  loadMachine(s, s.machine + 1);
  say(s, 'Machine escaped', '成功逃出一台机器');
}

function substep(s, dir) {
  const h = STEP,
    p = s.player;
  s.time += h;
  s.idle += h;
  p.jumpBuffer = Math.max(0, p.jumpBuffer - h);
  if (!p.grounded) p.coyote = Math.max(0, p.coyote - h);
  s.gearSpin = Math.max(0, s.gearSpin - h);
  if (s.message && (s.message.t -= h) <= 0) s.message = null;
  for (const f of s.fx) {
    f.t -= h;
    f.x += f.vx * h;
    f.y += f.vy * h;
    f.vy += (f.kind === 'spark' ? 200 : -10) * h;
  }
  s.fx = s.fx.filter((f) => f.t > 0);
  if (s.latch.crank) operateGear(s);
  if (s.latch.key) keyAction(s);
  s.latch.crank = s.latch.key = false;
  const acted = s.stats.cranks + s.stats.picks + s.stats.drops + s.stats.unlocks;
  if (acted !== s.acted) [s.acted, s.idle] = [acted, 0];
  moveBridges(s, h);
  movePlayer(s, h, dir);
  if (p.y > DEATH_Y) rewind(s);
  else if (!s.door.locked && overlaps(p, s.door)) clearMachine(s);
}

export function stepMachine(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_DT) return false;
  if (input.pressed(REWIND_KEY)) resetMachine(s);
  if (input.pressed('Space', 'ArrowUp', 'KeyW')) s.player.jumpBuffer = BUFFER;
  if (input.pressed('KeyX')) s.latch.crank = true;
  if (input.pressed('KeyZ')) s.latch.key = true;
  const dir =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) substep(s, dir);
  return true;
}

export function nearestGear(s) {
  const c = centerOf(s.player);
  let best = null,
    bestD = GEAR_REACH;
  for (const g of s.gears) {
    const d = gap2(c, g);
    if (d <= bestD) [best, bestD] = [g, d];
  }
  return best;
}

export function bridgePhase(b) {
  if (b.jam) return 'jammed';
  if (Math.abs(b.p - b.target) > 1e-9) return 'moving';
  return b.p < 0.5 ? 'retracted' : 'extended';
}

export {
  JUMP_SPEED,
  GRAVITY,
  RUN_SPEED,
  GEAR_REACH,
  KEY_REACH,
  DOOR_REACH,
  LIVES,
  KEY_SIZE,
  SPRITE_SCALE,
};
export const REWIND_KEY = 'KeyQ';
