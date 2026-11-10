import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, START_X, WALL_PAD, currentAt } from './raft-rush-levels.js';

// Distances are pixels and times are seconds. The simulation always advances in STEP slices.
export const PHYSICS = Object.freeze({
  step: 1 / 120,
  radius: 12,
  drag: 2.2,
  quadDrag: 0.004,
  thrust: 200,
  brakeDrag: 9,
  strokeAccel: 720,
  strokeTime: 0.28,
  strokeCost: 40,
  staminaMax: 100,
  staminaRegen: 22,
  strokeCooldown: 0.45,
  strokeBuffer: 0.3,
  restitution: 0.3,
  invulnerable: 1.3,
  hull: 3,
  dockSpeed: 20,
  dockTime: 0.8,
});
const P = PHYSICS;
export const STEP = P.step;
export const R = P.radius;
export const HUD_TOP = 28;
export const HUD_BOTTOM = 292;
const TIP_SECONDS = 5;
export const FLAG_R = 11;
const MISSED_BEHIND = 20;
const SUB_DISTANCE = 3,
  CAM_LEAD = 150,
  CAM_EASE = 8,
  FLAG_SCORE = 100,
  DOCK_SCORE = 250,
  HULL_SCORE = 50,
  LEVEL_SCORE = 100;
export const LOOK_AHEAD = 480 - CAM_LEAD;

export function createRaftState(index = 0, carry = {}) {
  const level = LEVELS[index],
    y = level.centre(START_X).cy,
    c = currentAt(level, START_X, y);
  return {
    index,
    t: 0,
    x: START_X,
    y,
    vx: c.vx,
    vy: c.vy,
    hull: carry.hull ?? P.hull,
    score: carry.score ?? 0,
    stamina: P.staminaMax,
    cooldown: 0,
    stroke: 0,
    queued: 0,
    strokeX: 1,
    strokeY: 0,
    invulnerable: P.invulnerable,
    bump: 0,
    got: level.flags.map(() => false),
    dockTimer: 0,
    camX: 0,
    tip: TIP_SECONDS,
    phase: 'playing',
  };
}

export const countFlags = (s) => s.got.filter(Boolean).length;

function closestOnSegment(seg, px, py) {
  const dx = seg.bx - seg.ax,
    dy = seg.by - seg.ay,
    u = clamp(((px - seg.ax) * dx + (py - seg.ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return [seg.ax + dx * u, seg.ay + dy * u];
}

// Pushes the raft out of every overlapped bank or rock and reflects only the inward velocity.
function resolveContacts(s, level, events) {
  const touch = (nx, ny, depth) => {
    s.x += nx * depth;
    s.y += ny * depth;
    const vn = s.vx * nx + s.vy * ny;
    if (vn >= 0) return;
    s.vx -= (1 + P.restitution) * vn * nx;
    s.vy -= (1 + P.restitution) * vn * ny;
    s.bump = 0.25;
    if (-vn > level.safeImpact && s.invulnerable <= 0) {
      s.hull -= 1;
      s.invulnerable = P.invulnerable;
      events.push('hit');
    }
  };
  for (let pass = 0, touched = true; touched && pass < 4; pass++) {
    touched = false;
    for (const seg of level.segs) {
      if (Math.min(seg.ax, seg.bx) > s.x + R || Math.max(seg.ax, seg.bx) < s.x - R) continue;
      const [cx, cy] = closestOnSegment(seg, s.x, s.y),
        d = Math.hypot(s.x - cx, s.y - cy),
        side = (s.x - cx) * seg.nx + (s.y - cy) * seg.ny;
      if (d >= R) continue;
      if (side <= 0) touch(seg.nx, seg.ny, R - side);
      else touch((s.x - cx) / d, (s.y - cy) / d, R - d);
      touched = true;
    }
    for (const r of level.rocks) {
      const dx = s.x - r.x,
        dy = s.y - r.y,
        d = Math.hypot(dx, dy);
      if (d >= R + r.r) continue;
      touch(d > 1e-6 ? dx / d : 0, d > 1e-6 ? dy / d : -1, R + r.r - d);
      touched = true;
    }
  }
}

function collectFlags(s, level, events) {
  level.flags.forEach((f, i) => {
    if (!s.got[i] && Math.hypot(s.x - f.x, s.y - f.y) < R + FLAG_R) {
      s.got[i] = true;
      s.score += FLAG_SCORE;
      events.push('coin');
    }
  });
}

function moveRaft(s, level, events) {
  const dist = Math.hypot(s.vx, s.vy) * STEP,
    n = Math.max(1, Math.ceil(dist / SUB_DISTANCE));
  for (let i = 0; i < n; i++) {
    s.x += (s.vx * STEP) / n;
    s.y += (s.vy * STEP) / n;
    collectFlags(s, level, events);
    resolveContacts(s, level, events);
  }
}

const inDock = (s, level) => s.x >= level.dock.x0 && s.x <= level.dock.x1;

function dockCheck(s, level, events) {
  const speed = Math.hypot(s.vx, s.vy);
  if (countFlags(s) >= level.need && inDock(s, level) && speed <= P.dockSpeed) {
    s.dockTimer += STEP;
  } else s.dockTimer = Math.max(0, s.dockTimer - 2 * STEP);
  if (s.dockTimer < P.dockTime) return;
  s.score += DOCK_SCORE + LEVEL_SCORE + s.hull * HULL_SCORE;
  events.push('coin');
  if (s.index === LEVEL_COUNT - 1) {
    s.phase = 'won';
    events.push('win');
    return;
  }
  Object.assign(
    s,
    createRaftState(s.index + 1, { hull: Math.min(P.hull, s.hull + 1), score: s.score }),
  );
  events.push('clear');
}

// One fixed simulation slice. ctl: {dx, dy, stroke (edge), brake}. Returns the events it produced.
export function stepRaft(s, ctl) {
  const events = [];
  if (s.phase !== 'playing') return events;
  const level = LEVELS[s.index];
  s.t += STEP;
  s.cooldown = Math.max(0, s.cooldown - STEP);
  s.invulnerable = Math.max(0, s.invulnerable - STEP);
  s.bump = Math.max(0, s.bump - STEP);
  s.tip = Math.max(0, s.tip - STEP);
  s.queued = Math.max(0, s.queued - STEP);
  s.stamina = Math.min(P.staminaMax, s.stamina + P.staminaRegen * STEP);
  let ax = ctl.dx,
    ay = ctl.dy;
  const len = Math.hypot(ax, ay);
  if (len > 1) {
    ax /= len;
    ay /= len;
  }
  // A paddle press that arrives during the cooldown or while stamina refills is kept for a moment.
  if (ctl.stroke) s.queued = P.strokeBuffer;
  if (s.queued > 0 && s.cooldown <= 0 && s.stamina >= P.strokeCost && s.stroke <= 0) {
    s.queued = 0;
    s.stamina -= P.strokeCost;
    s.cooldown = P.strokeCooldown;
    s.stroke = P.strokeTime;
    s.strokeX = len > 0 ? ax : 1;
    s.strokeY = len > 0 ? ay : 0;
    events.push('move');
  }
  let fx = ax * P.thrust,
    fy = ay * P.thrust;
  if (s.stroke > 0) {
    s.stroke = Math.max(0, s.stroke - STEP);
    fx += s.strokeX * P.strokeAccel;
    fy += s.strokeY * P.strokeAccel;
  }
  // Implicit damping toward the local water velocity keeps very large speeds stable.
  const w = currentAt(level, s.x, s.y),
    rx = s.vx - w.vx,
    ry = s.vy - w.vy,
    k = 1 + ((ctl.brake ? P.brakeDrag : P.drag) + P.quadDrag * Math.hypot(rx, ry)) * STEP;
  s.vx = w.vx + (rx + fx * STEP) / k;
  s.vy = w.vy + (ry + fy * STEP) / k;
  moveRaft(s, level, events);
  const camTarget = clamp(s.x - CAM_LEAD, 0, level.length + WALL_PAD - 480);
  s.camX += (camTarget - s.camX) * Math.min(1, CAM_EASE * STEP);
  if (s.hull <= 0) {
    s.phase = 'lost';
    events.push('lose');
    return events;
  }
  dockCheck(s, level, events);
  return events;
}

const pair = (en, zh) => Object.freeze({ en, zh });
export const TERMINAL_TEXT = Object.freeze({
  won: pair('You docked all twenty rivers!', '二十条河流全部靠岸成功！'),
  lost: pair('The raft broke apart.', '木筏解体了。'),
});
const OBJECTIVE = Object.freeze({
  collect: pair('Collect the flags', '收集旗帜'),
  missed: pair('Flag missed: paddle back (Left)', '漏了旗帜：向左划回去'),
  dockOpen: pair('Dock is open: stop inside the marker', '码头已开启：停进标记内'),
  docking: pair('Docking... hold still', '停靠中…保持不动'),
});

/** The one-line goal shown in the bottom band, from the raft state alone. */
export function objectiveOf(s) {
  if (s.phase !== 'playing') return TERMINAL_TEXT[s.phase];
  const level = LEVELS[s.index],
    collected = countFlags(s);
  if (collected >= level.need) {
    return inDock(s, level) && Math.hypot(s.vx, s.vy) <= P.dockSpeed
      ? OBJECTIVE.docking
      : OBJECTIVE.dockOpen;
  }
  const ahead = level.flags.filter((f, i) => !s.got[i] && f.x > s.x - MISSED_BEHIND).length;
  return collected + ahead < level.need ? OBJECTIVE.missed : OBJECTIVE.collect;
}
