// Frog physics, support, traffic sweeps and the per-level state machine.
import { clamp } from '../shared/utils.js';
import {
  TOP,
  ROW,
  LEVEL_COUNT,
  TURTLE_WARN,
  TURTLE_DIVE,
  TURTLE_CYCLE,
  ferryX,
  ferryV,
  riverLanes,
  clampLevel,
} from './river-hop-levels.js';

const STEP = 1 / 240,
  EPS = 1e-8;
const GRAVITY = 1250,
  FLIGHT = 0.24,
  JUMP = (GRAVITY * FLIGHT) / 2,
  MIN_X = 11,
  MAX_X = 469;
export const FROG_TIME = 45,
  MAX_LIVES = 4;
export const center = (row) => TOP + row * ROW + 14;
const freshFrog = () => ({
  x: 240,
  y: center(9),
  row: 9,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  mass: 1,
  grounded: true,
  hop: null,
  pose: 'idle',
  support: null,
});
export function createRiverState(level = 1) {
  const start = clampLevel(level);
  return {
    phase: 'playing',
    score: 0,
    level: start,
    lives: MAX_LIVES,
    frog: freshFrog(),
    lanes: riverLanes(start),
    homes: [],
    rescued: 0,
    time: 0,
    totalTime: 0,
    timeLeft: FROG_TIME,
    spawnDelay: 0,
    transition: 0,
    pendingHop: null,
    repeatClock: 0,
    rest: 0,
    needsRelease: false,
    lastHeld: null,
    minRow: 9,
    lastCause: '',
    feedback: null,
    ripples: [],
    lastImpulse: null,
  };
}
function directions(input, method) {
  const dx =
      Number(input[method]('ArrowRight', 'KeyD')) - Number(input[method]('ArrowLeft', 'KeyA')),
    dy = Number(input[method]('ArrowDown', 'KeyS')) - Number(input[method]('ArrowUp', 'KeyW'));
  return dx && dy ? null : dx || dy ? { dx, dy, key: `${dx}:${dy}` } : null;
}
const anyDirection = (input) =>
  input.held('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD');
export function turtleState(lane, time) {
  if (lane.kind !== 'turtles') return 'up';
  const phase = ((time % lane.cycle) + lane.cycle) % lane.cycle;
  return phase + EPS >= TURTLE_DIVE ? 'down' : phase + EPS >= TURTLE_WARN ? 'warning' : 'up';
}
export function laneVelocity(lane, time) {
  return lane.kind === 'ferry' ? ferryV(lane, time) : lane.speed;
}
function deck(lane, o) {
  return { x: o.x, y: TOP + lane.row * ROW + 4, w: o.w, h: 20 };
}
export function riverFeet(frog) {
  return [
    { x: frog.x - 11, y: frog.y + 4, w: 6, h: 4 },
    { x: frog.x + 5, y: frog.y + 4, w: 6, h: 4 },
  ];
}
export function frogRects(f) {
  const airborne = !f.grounded && f.hop && f.hop.age > 0.045 && f.hop.age < 0.195;
  return [
    { x: f.x - 7, y: f.y - 6, w: 14, h: 12 },
    { x: f.x - 7, y: f.y - 9, w: 4, h: 4 },
    { x: f.x + 3, y: f.y - 9, w: 4, h: 4 },
    ...(airborne
      ? [
          { x: f.x - 9, y: f.y + 1, w: 4, h: 4 },
          { x: f.x + 5, y: f.y + 1, w: 4, h: 4 },
        ]
      : riverFeet(f)),
  ];
}
export function homeRect(n) {
  return { x: n * 120 + 18, y: TOP + 1, w: 84, h: 27 };
}
function containingInterval(rects, foot) {
  const spans = rects
    .filter((r) => foot.y >= r.y - EPS && foot.y + foot.h <= r.y + r.h + EPS)
    .map((r) => [r.x, r.x + r.w])
    .sort((a, b) => a[0] - b[0]);
  let lo = null,
    hi = null;
  for (const [left, right] of spans) {
    if (lo === null || left > hi + EPS) {
      lo = left;
      hi = right;
    } else hi = Math.max(hi, right);
    if (foot.x >= lo - EPS && foot.x + foot.w <= hi + EPS) return { lo, hi };
  }
  return null;
}
/** Current-driven decks and the cable motor supply the work of carrying a passenger. */
export function riverSupport(s, f = s.frog) {
  const feet = riverFeet(f),
    grounds = [
      { x: 0, y: TOP + 4 * ROW, w: 480, h: 28 },
      { x: 0, y: TOP + 5 * ROW, w: 480, h: 5 * ROW },
    ];
  if (feet.every((foot) => containingInterval(grounds, foot)))
    return { kind: 'ground', vx: 0, rects: grounds };
  for (let n = 0; n < 4; n++)
    if (feet.every((foot) => containingInterval([homeRect(n)], foot)))
      return { kind: 'home', home: n, vx: 0, rects: [homeRect(n)] };
  for (const lane of s.lanes) {
    if (!lane.water || turtleState(lane, s.time) === 'down') continue;
    const rects = lane.objects.map((o) => deck(lane, o));
    if (feet.every((foot) => containingInterval(rects, foot)))
      return { kind: lane.kind, row: lane.row, lane, vx: laneVelocity(lane, s.time), rects };
  }
  return null;
}
function overlapRect(a, b) {
  return (
    a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS
  );
}
const motion = (p, v, a, t) => p + v * t + 0.5 * a * t * t;
function roots(p, v, a, target, dt) {
  const c = p - target;
  if (Math.abs(a) < EPS) {
    if (Math.abs(v) < EPS) return [];
    const t = -c / v;
    return t >= -EPS && t <= dt + EPS ? [clamp(t, 0, dt)] : [];
  }
  const discriminant = v * v - 2 * a * c;
  if (discriminant < -EPS) return [];
  const r = Math.sqrt(Math.max(0, discriminant));
  return [(-v - r) / a, (-v + r) / a]
    .filter((t) => t >= -EPS && t <= dt + EPS)
    .map((t) => clamp(t, 0, dt));
}
function range(p, v, a, dt) {
  const values = [p, motion(p, v, a, dt)],
    turn = Math.abs(a) > EPS ? -v / a : -1;
  if (turn > 0 && turn < dt) values.push(motion(p, v, a, turn));
  return [Math.min(...values), Math.max(...values)];
}
function entering(pos, size, lo, hi, v, a) {
  if (pos + size <= lo + EPS) return v > EPS || (Math.abs(v) <= EPS && a > EPS);
  if (pos >= hi - EPS) return v < -EPS || (Math.abs(v) <= EPS && a < -EPS);
  return true;
}
function sweepRect(a, b, vx, vy, ax, ay, dt) {
  if (overlapRect(a, b)) return 0;
  const times = [
    0,
    dt,
    ...roots(a.x, vx, ax, b.x - a.w, dt),
    ...roots(a.x, vx, ax, b.x + b.w, dt),
    ...roots(a.y, vy, ay, b.y - a.h, dt),
    ...roots(a.y, vy, ay, b.y + b.h, dt),
  ].sort((a, b) => a - b);
  for (const t of times) {
    const x = motion(a.x, vx, ax, t),
      y = motion(a.y, vy, ay, t);
    if (x + a.w < b.x - EPS || x > b.x + b.w + EPS || y + a.h < b.y - EPS || y > b.y + b.h + EPS)
      continue;
    if (
      entering(x, a.w, b.x, b.x + b.w, vx + ax * t, ax) &&
      entering(y, a.h, b.y, b.y + b.h, vy + ay * t, ay)
    )
      return t;
  }
  return null;
}
function wallTime(p, v, a, lo, hi, dt) {
  let hit = null;
  for (const [bound, sign] of [
    [lo, -1],
    [hi, 1],
  ])
    for (const t of roots(p, v, a, bound, dt)) {
      if ((v + a * t) * sign <= EPS) continue;
      if (hit === null || t < hit) hit = t;
    }
  return hit;
}
export function carRects(lane, o) {
  const y = TOP + lane.row * ROW;
  return [
    { x: o.x, y: y + 5, w: o.w, h: 18 },
    { x: o.x + 5, y: y + 3, w: 8, h: 3 },
    { x: o.x + o.w - 13, y: y + 3, w: 8, h: 3 },
    { x: o.x + 5, y: y + 22, w: 8, h: 3 },
    { x: o.x + o.w - 13, y: y + 22, w: 8, h: 3 },
  ];
}
function trafficTime(s, vx, vy, ax, ay, dt) {
  let hit = null;
  const f = s.frog,
    rx = range(f.x, vx, ax, dt),
    ry = range(f.y, vy, ay, dt);
  for (const lane of s.lanes)
    if (!lane.water) {
      const y = TOP + lane.row * ROW;
      if (ry[1] + 8 < y + 3 - EPS || ry[0] - 9 > y + 25 + EPS) continue;
      for (const o of lane.objects) {
        const ox = Math.min(o.x, o.x + lane.speed * dt),
          ow = o.w + Math.abs(lane.speed * dt);
        if (rx[1] + 11 < ox - EPS || rx[0] - 11 > ox + ow + EPS) continue;
        for (const a of frogRects(f))
          for (const b of carRects(lane, o)) {
            const time = sweepRect(a, b, vx - lane.speed, vy, ax, ay, dt);
            if (time !== null && (hit === null || time < hit)) hit = time;
          }
      }
    }
  return hit;
}
function note(s, type, x = s.frog.x, y = s.frog.y) {
  s.feedback = { type, x, y, life: 0.65 };
  if (['land', 'water', 'home'].includes(type)) {
    s.ripples.push({ x, y, life: 0.55, type });
    if (s.ripples.length > 12) s.ripples.shift();
  }
}
function resetFrog(s) {
  s.frog = freshFrog();
  s.timeLeft = FROG_TIME;
  s.minRow = 9;
  s.pendingHop = null;
  s.repeatClock = 0;
  s.rest = 0.08;
  s.needsRelease = true;
  s.lastHeld = null;
}
function hurt(s, cause) {
  if (s.spawnDelay > 0 || s.transition > 0 || s.phase !== 'playing') return;
  s.lives--;
  s.lastCause = cause;
  note(s, cause);
  s.pendingHop = null;
  s.needsRelease = true;
  s.lastHeld = null;
  s.frog.hop = null;
  s.frog.pose = 'lost';
  if (s.lives <= 0) s.phase = 'lost';
  else s.spawnDelay = 0.65;
}
function rescue(s, home) {
  if (s.homes.includes(home)) {
    note(s, 'occupied');
    return;
  }
  s.homes.push(home);
  s.rescued++;
  s.score += 250 + Math.max(0, Math.floor(s.timeLeft + EPS)) * 5;
  note(s, 'home');
  s.pendingHop = null;
  s.needsRelease = true;
  s.lastHeld = null;
  if (s.homes.length === 4) {
    if (s.level === LEVEL_COUNT) {
      s.phase = 'won';
      return;
    }
    s.score += 500;
    s.transition = 0.95;
    s.spawnDelay = 0;
    s.frog.pose = 'rescued';
  } else {
    s.spawnDelay = 0.55;
    s.frog.pose = 'rescued';
  }
}
// Logical pixels, seconds and unit frog mass. The driven deck/ground receives the reaction.
function recordImpulse(s, source, before, after) {
  const mass = s.frog.mass,
    x = mass * (after.vx - before.vx),
    y = mass * (after.vy - before.vy),
    z = mass * (after.vz - before.vz),
    energy = (v) => 0.5 * mass * (v.vx * v.vx + v.vy * v.vy + v.vz * v.vz);
  s.lastImpulse = {
    source,
    x,
    y,
    z,
    reaction: { x: -x, y: -y, z: -z },
    work: energy(after) - energy(before),
  };
}
function launch(s, command, support) {
  const f = s.frog;
  if (
    (command.dx < 0 && f.x <= MIN_X + EPS) ||
    (command.dx > 0 && f.x >= MAX_X - EPS) ||
    (command.dy < 0 && f.y <= center(0) + EPS) ||
    (command.dy > 0 && f.y >= center(9) - EPS)
  ) {
    s.pendingHop = null;
    s.rest = 0.06;
    note(s, 'edge');
    return;
  }
  const before = { vx: f.vx, vy: f.vy, vz: f.vz };
  f.vx = support.vx + (command.dx * 24) / FLIGHT;
  f.vy = (command.dy * ROW) / FLIGHT;
  f.vz = JUMP;
  f.grounded = false;
  f.hop = { dx: command.dx, dy: command.dy, age: 0 };
  f.support = null;
  f.pose = 'takeoff';
  recordImpulse(s, 'legs', before, f);
  s.pendingHop = null;
  s.repeatClock = 0.32;
  note(s, 'hop');
}
function surfaceLoss(s, support, vx, dt) {
  if (support.kind === 'ground' || support.kind === 'home' || support.kind === 'ferry') return null;
  const relative = vx - support.vx;
  if (Math.abs(relative) < EPS) return null;
  let loss = null;
  for (const foot of riverFeet(s.frog)) {
    const span = containingInterval(support.rects, foot);
    if (!span) return 0;
    const time =
      relative > 0 ? (span.hi - foot.x - foot.w) / relative : (span.lo - foot.x) / relative;
    if (time >= -EPS && time <= dt + EPS && (loss === null || time < loss))
      loss = Math.max(0, time);
  }
  return loss;
}
function nextDive(s, dt) {
  let next = null;
  for (const l of s.lanes)
    if (l.kind === 'turtles') {
      const phase = ((s.time % l.cycle) + l.cycle) % l.cycle;
      for (const bound of [TURTLE_WARN, TURTLE_DIVE, TURTLE_CYCLE]) {
        const t = bound - phase;
        if (t > EPS && t <= dt + EPS && (next === null || t < next)) next = t;
      }
    }
  return next;
}
function nextWrap(s, dt) {
  let next = null;
  for (const lane of s.lanes)
    if (lane.span && Math.abs(lane.speed) > EPS)
      for (const o of lane.objects) {
        const lo = -o.w - 24,
          hi = lo + lane.span,
          t = ((lane.speed > 0 ? hi : lo) - o.x) / lane.speed;
        if (t >= -EPS && t <= dt + EPS && (next === null || t < next)) next = Math.max(0, t);
      }
  return next;
}
function advance(s, h, vx = 0, vy = 0, air = false, ax = 0, ay = 0, ferry = null) {
  const end = s.time + h;
  for (const lane of s.lanes)
    for (const o of lane.objects) {
      if (lane.kind === 'ferry') o.x = ferryX(lane, end);
      else o.x += lane.speed * h;
      if (lane.span) {
        const lo = -o.w - 24,
          hi = lo + lane.span;
        if (o.x < lo - EPS || o.x > hi + EPS)
          o.x = lo + ((((o.x - lo) % lane.span) + lane.span) % lane.span);
        if (lane.speed > 0 && o.x >= hi - EPS) o.x -= lane.span;
        else if (lane.speed < 0 && o.x <= lo + EPS) o.x += lane.span;
      }
    }
  if (s.spawnDelay === 0 && s.transition === 0) {
    const f = s.frog;
    f.x += ferry ? ferryX(ferry, end) - ferryX(ferry, s.time) : motion(0, vx, ax, h);
    if (ferry) {
      const before = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.vx = ferryV(ferry, end);
      if (Math.abs(f.vx - before.vx) > EPS) recordImpulse(s, 'drive', before, f);
    }
    f.y += motion(0, vy, ay, h);
    if (air) {
      f.z += f.vz * h - 0.5 * GRAVITY * h * h;
      f.vz -= GRAVITY * h;
      f.vx += ax * h;
      f.vy += ay * h;
      f.hop.age += h;
      f.pose = f.vz > 0 ? 'air' : 'landing';
    }
    f.row = clamp(Math.round((f.y - center(0)) / ROW), 0, 9);
    s.timeLeft -= h;
  }
  s.time = end;
  s.totalTime += h;
  s.repeatClock = Math.max(0, s.repeatClock - h);
  s.rest = Math.max(0, s.rest - h);
  if (s.feedback && (s.feedback.life -= h) <= 0) s.feedback = null;
  s.ripples = s.ripples.filter((r) => (r.life -= h) > 0);
}
function tick(s, h, held) {
  let remaining = h;
  while (remaining > EPS && s.phase === 'playing') {
    if (s.transition > 0) {
      const t = Math.min(remaining, s.transition);
      advance(s, t);
      s.transition = Math.max(0, s.transition - t);
      remaining -= t;
      if (s.transition <= EPS) {
        s.transition = 0;
        s.level++;
        s.homes = [];
        s.lanes = riverLanes(s.level);
        s.time = 0;
        s.lives = Math.min(MAX_LIVES, s.lives + 1);
        resetFrog(s);
      }
      continue;
    }
    if (s.spawnDelay > 0) {
      const t = Math.min(remaining, s.spawnDelay);
      advance(s, t);
      s.spawnDelay = Math.max(0, s.spawnDelay - t);
      remaining -= t;
      if (s.spawnDelay <= EPS) {
        s.spawnDelay = 0;
        resetFrog(s);
      }
      continue;
    }
    const f = s.frog;
    let support = null;
    if (f.grounded) {
      support = riverSupport(s);
      if (!support) {
        hurt(s, 'water');
        continue;
      }
      f.support = { kind: support.kind, row: support.row ?? f.row };
      const beforeGrip = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.vx = support.vx;
      f.vy = 0;
      f.vz = 0;
      f.z = 0;
      if (Math.hypot(f.vx - beforeGrip.vx, f.vy - beforeGrip.vy, f.vz - beforeGrip.vz) > EPS)
        recordImpulse(s, 'grip', beforeGrip, f);
      if (support.kind === 'home' && !s.homes.includes(support.home)) {
        rescue(s, support.home);
        continue;
      }
      if (s.pendingHop && s.pendingHop.expires < s.totalTime - EPS) s.pendingHop = null;
      const command =
        !s.needsRelease && s.rest <= EPS
          ? (s.pendingHop ?? (held && s.repeatClock <= EPS ? held : null))
          : null;
      if (command) {
        launch(s, command, support);
        if (!f.grounded) support = null;
      }
    }
    const air = !f.grounded;
    let ax = 0,
      ay = 0;
    if (air && held) {
      if (held.dx !== f.hop.dx) ax = held.dx * 90;
      if (held.dy !== f.hop.dy) ay = held.dy * 90;
    }
    let vx = f.vx,
      vy = f.vy;
    if (support?.kind === 'ferry')
      vx = (ferryX(support.lane, s.time + remaining) - ferryX(support.lane, s.time)) / remaining;
    if (
      (f.x <= MIN_X + EPS && (vx < 0 || (Math.abs(vx) < EPS && ax < 0))) ||
      (f.x >= MAX_X - EPS && (vx > 0 || (Math.abs(vx) < EPS && ax > 0)))
    ) {
      vx = 0;
      f.vx = 0;
      ax = 0;
    }
    if (
      (f.y <= center(0) + EPS && (vy < 0 || (Math.abs(vy) < EPS && ay < 0))) ||
      (f.y >= center(9) - EPS && (vy > 0 || (Math.abs(vy) < EPS && ay > 0)))
    ) {
      vy = 0;
      f.vy = 0;
      ay = 0;
    }
    const landing = air
        ? (f.vz + Math.sqrt(Math.max(0, f.vz * f.vz + 2 * GRAVITY * f.z))) / GRAVITY
        : null,
      traffic = trafficTime(s, vx, vy, ax, ay, remaining),
      loss = support ? surfaceLoss(s, support, vx, remaining) : null,
      dive = nextDive(s, remaining),
      wrap = nextWrap(s, remaining),
      timeout = Math.max(0, s.timeLeft),
      wallX = wallTime(f.x, vx, ax, MIN_X, MAX_X, remaining),
      wallY = wallTime(f.y, vy, ay, center(0), center(9), remaining);
    let t = remaining;
    for (const event of [landing, traffic, loss, dive, wrap, timeout, wallX, wallY])
      if (event !== null && event >= -EPS && event < t) t = Math.max(0, event);
    advance(s, t, vx, vy, air, ax, ay, support?.kind === 'ferry' ? support.lane : null);
    remaining -= t;
    const at = (event) => event !== null && Math.abs(event - t) <= EPS;
    if (at(traffic)) {
      hurt(s, 'traffic');
      continue;
    }
    if (at(wallX)) {
      f.x = clamp(f.x, MIN_X, MAX_X);
      f.vx = 0;
      note(s, 'edge');
    }
    if (at(wallY)) {
      f.y = clamp(f.y, center(0), center(9));
      f.vy = 0;
      note(s, 'edge');
    }
    if (at(loss)) {
      hurt(s, 'water');
      continue;
    }
    if (at(landing)) {
      const landingVelocity = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.z = 0;
      f.vz = 0;
      f.grounded = true;
      f.hop = null;
      support = riverSupport(s);
      if (!support) {
        hurt(s, 'water');
        continue;
      }
      const before = landingVelocity;
      f.vx = support.vx;
      f.vy = 0;
      recordImpulse(s, 'grip', before, f);
      f.pose = 'landed';
      s.rest = 0.055;
      note(s, 'land');
      if (f.row < s.minRow) {
        s.score += (s.minRow - f.row) * 10;
        s.minRow = f.row;
      }
      if (support.kind === 'home') {
        if (!s.homes.includes(support.home)) {
          rescue(s, support.home);
          continue;
        }
        note(s, 'occupied');
      }
    }
    if (at(timeout) && s.phase === 'playing' && s.spawnDelay === 0 && s.transition === 0) {
      hurt(s, 'time');
      continue;
    }
    if (f.grounded && s.spawnDelay === 0 && s.transition === 0 && !riverSupport(s)) {
      hurt(s, 'water');
      continue;
    }
  }
}
export function stepRiver(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  const held = directions(input, 'held'),
    pressed = directions(input, 'pressed');
  if (
    s.needsRelease &&
    !anyDirection(input) &&
    !pressed &&
    s.spawnDelay === 0 &&
    s.transition === 0
  )
    s.needsRelease = false;
  if (!s.needsRelease && s.spawnDelay === 0 && s.transition === 0) {
    const command = pressed ?? (held && held.key !== s.lastHeld ? held : null);
    if (command) s.pendingHop = { ...command, expires: s.totalTime + 0.18 };
  }
  s.lastHeld = held?.key ?? null;
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(STEP, remaining);
    tick(s, h, held);
    remaining -= h;
  }
}
