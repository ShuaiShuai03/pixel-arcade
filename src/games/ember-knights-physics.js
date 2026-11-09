import { clamp } from '../shared/utils.js';

export const FLOOR = 260,
  LEFT = 12,
  RIGHT = 468,
  GRAVITY = 680,
  STEP = 1 / 120,
  EPS = 1e-7;
export const approach = (value, target, amount) =>
  value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
export const rect = (f) => ({ x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h });
export const phaseOf = (a) =>
  a.age < a.startup ? 'windup' : a.age < a.startup + a.active ? 'active' : 'recovery';
// Bodies are numbered from 0, so a fighter standing on another reports a string id.
const supportId = (body) => `fighter${body.id}`;

function constrainedInverseMass(f, normal) {
  if (
    (normal.x < 0 && f.x - f.w / 2 <= LEFT + EPS) ||
    (normal.x > 0 && f.x + f.w / 2 >= RIGHT - EPS)
  )
    return 0;
  if (normal.y > 0 && f.y >= FLOOR - EPS) return 0;
  return 1 / (f.mass ?? 80);
}
/** Inelastic body contact cannot cause damage or create kinetic energy. */
export function resolveBodyContact(a, b, { nx, ny }) {
  const closing = -((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  if (closing <= EPS) return 0;
  const ia = constrainedInverseMass(a, { x: nx, y: ny }),
    ib = constrainedInverseMass(b, { x: -nx, y: -ny });
  if (ia + ib <= 0) return 0;
  const impulse = closing / (ia + ib);
  a.vx += nx * impulse * ia;
  a.vy += ny * impulse * ia;
  b.vx -= nx * impulse * ib;
  b.vy -= ny * impulse * ib;
  return impulse;
}
function sweepBodies(a, b, dt) {
  const dx = a.x - b.x,
    dy = a.y - a.h / 2 - (b.y - b.h / 2);
  let enter = 0,
    exit = dt,
    normal = null,
    smallest = Infinity,
    overlapNormal = null;
  for (const [distance, velocity, radius, nx, ny] of [
    [dx, a.vx - b.vx, (a.w + b.w) / 2, 1, 0],
    [dy, a.vy - b.vy, (a.h + b.h) / 2, 0, 1],
  ]) {
    const depth = radius - Math.abs(distance);
    if (depth < smallest) {
      smallest = depth;
      overlapNormal = { nx: nx * (distance >= 0 ? 1 : -1), ny: ny * (distance >= 0 ? 1 : -1) };
    }
    if (Math.abs(velocity) < EPS) {
      if (Math.abs(distance) > radius + EPS) return null;
      continue;
    }
    const t1 = (-radius - distance) / velocity,
      t2 = (radius - distance) / velocity,
      near = Math.min(t1, t2),
      far = Math.max(t1, t2);
    if (near > enter) {
      enter = near;
      const sign = distance + velocity * near >= 0 ? 1 : -1;
      normal = { nx: nx * sign, ny: ny * sign };
    }
    exit = Math.min(exit, far);
    if (enter > exit + EPS) return null;
  }
  if (exit < -EPS || enter > dt + EPS) return null;
  normal ??= overlapNormal;
  if (
    enter <= EPS &&
    smallest <= EPS &&
    (a.vx - b.vx) * normal.nx + (a.vy - b.vy) * normal.ny >= -EPS
  )
    return null;
  return {
    ...normal,
    time: Math.max(0, enter),
    penetration: enter <= EPS ? Math.max(0, smallest) : 0,
  };
}
function refreshSupport(f, bodies) {
  if (f.y >= FLOOR - EPS && f.vy >= 0) {
    f.y = FLOOR;
    f.vy = 0;
    f.grounded = true;
    f.support = 'floor';
    return;
  }
  const support = bodies.find(
    (b) =>
      b !== f &&
      b.grounded &&
      Math.abs(f.y - (b.y - b.h)) < 1e-5 &&
      Math.abs(f.x - b.x) < (f.w + b.w) / 2 - EPS,
  );
  if (support && f.vy >= 0) {
    f.vy = 0;
    f.grounded = true;
    f.support = supportId(support);
  } else {
    f.grounded = false;
    f.support = null;
  }
}
function moveBodiesLinear(bodies, dt) {
  let remaining = dt;
  for (let n = 0; n < 12 && remaining > EPS; n++) {
    let event = null,
      time = remaining + 1;
    for (let i = 0; i < bodies.length; i++) {
      const f = bodies[i];
      if (f.vx < 0) {
        const t = (LEFT + f.w / 2 - f.x) / f.vx;
        if (t >= -EPS && t < time) {
          event = { type: 'left', i };
          time = Math.max(0, t);
        }
      }
      if (f.vx > 0) {
        const t = (RIGHT - f.w / 2 - f.x) / f.vx;
        if (t >= -EPS && t < time) {
          event = { type: 'right', i };
          time = Math.max(0, t);
        }
      }
      if (f.vy > 0) {
        const t = (FLOOR - f.y) / f.vy;
        if (t >= -EPS && t < time) {
          event = { type: 'floor', i };
          time = Math.max(0, t);
        }
      }
      for (let j = i + 1; j < bodies.length; j++) {
        const hit = sweepBodies(f, bodies[j], remaining);
        if (hit && hit.time < time) {
          event = { type: 'body', i, j, hit };
          time = hit.time;
        }
      }
    }
    const travel = event ? Math.min(remaining, time) : remaining;
    for (const f of bodies) {
      f.x += f.vx * travel;
      f.y += f.vy * travel;
    }
    remaining -= travel;
    if (!event || time > travel + EPS) break;
    const f = bodies[event.i];
    if (event.type === 'floor') {
      f.y = FLOOR;
      f.vy = 0;
      f.grounded = true;
      f.support = 'floor';
    } else if (event.type === 'left' || event.type === 'right') {
      f.x = event.type === 'left' ? LEFT + f.w / 2 : RIGHT - f.w / 2;
      f.vx = 0;
    } else {
      const other = bodies[event.j],
        hit = event.hit;
      if (hit.penetration > EPS) {
        const ia = constrainedInverseMass(f, { x: hit.nx, y: hit.ny }),
          ib = constrainedInverseMass(other, { x: -hit.nx, y: -hit.ny }),
          sum = ia + ib;
        if (sum) {
          f.x += (hit.nx * hit.penetration * ia) / sum;
          f.y += (hit.ny * hit.penetration * ia) / sum;
          other.x -= (hit.nx * hit.penetration * ib) / sum;
          other.y -= (hit.ny * hit.penetration * ib) / sum;
        }
      }
      resolveBodyContact(f, other, hit);
      if (hit.ny < 0 && other.grounded && Math.abs(f.vy) < EPS) {
        f.grounded = true;
        f.support = supportId(other);
      }
      if (hit.ny > 0 && f.grounded && Math.abs(other.vy) < EPS) {
        other.grounded = true;
        other.support = supportId(f);
      }
    }
  }
  // With only two bodies, an anchored resting contact is solved directly above.
  // Any remaining time contains no unprocessed high-speed approach.
  if (remaining > EPS)
    for (const f of bodies) {
      f.x += f.vx * remaining;
      f.y += f.vy * remaining;
    }
}
/** Velocity-Verlet gravity, swept bodies, and solid floor/wall support. */
export function advanceDuelBodies(bodies, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  let remaining = dt;
  while (remaining > EPS) {
    const h = Math.min(STEP, remaining);
    for (const f of bodies) {
      refreshSupport(f, bodies);
      if (!f.grounded) f.vy += (GRAVITY * h) / 2;
    }
    moveBodiesLinear(bodies, h);
    for (const f of bodies) {
      refreshSupport(f, bodies);
      if (!f.grounded) f.vy += (GRAVITY * h) / 2;
    }
    remaining -= h;
  }
}

/** The renderer and damage test use exactly the same moving weapon segment. */
export function weaponPose(f, attack = f.attack) {
  const face = attack?.face ?? f.face,
    phase = attack ? phaseOf(attack) : 'idle';
  const handHeight =
    attack?.type === 'heavy' && phase === 'windup' ? 29 : phase === 'recovery' ? 23 : 25;
  const base = { x: f.x + face * 8, y: f.y - handHeight };
  let angle = -1.32,
    length = f.gear === 'spear' ? 34 : 23,
    active = false,
    radius = 1.5,
    tipRadius = 1.5;
  if (attack) {
    const phase = phaseOf(attack);
    length = attack.length;
    active = phase === 'active';
    const t =
      phase === 'windup'
        ? clamp(attack.age / attack.startup, 0, 1)
        : phase === 'active'
          ? clamp((attack.age - attack.startup) / attack.active, 0, 1)
          : clamp((attack.age - attack.startup - attack.active) / attack.recovery, 0, 1);
    if (attack.type === 'heavy')
      angle =
        phase === 'windup'
          ? -2.1 + t * 0.9
          : phase === 'active'
            ? -1.2 + t * 1.95
            : 0.75 - t * 2.07;
    else if (attack.type === 'thrust')
      angle =
        phase === 'windup'
          ? -0.8 + t * 0.65
          : phase === 'active'
            ? -0.15 + t * 0.3
            : 0.15 - t * 1.47;
    else
      angle = phase === 'windup' ? -1.4 + t : phase === 'active' ? -0.4 + t * 0.8 : 0.4 - t * 1.72;
    if (f.gear === 'hammer') {
      radius = 1.5;
      tipRadius = 5;
    }
    if (f.gear === 'spear') {
      radius = 1.2;
      tipRadius = 3;
    }
    if (f.gear === 'axe') {
      radius = 1.8;
      tipRadius = 4;
    }
  }
  return {
    base,
    tip: { x: base.x + face * Math.cos(angle) * length, y: base.y + Math.sin(angle) * length },
    active,
    radius,
    tipRadius,
  };
}
function segmentRect(a, b, r) {
  let enter = 0,
    exit = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, r.x, r.x + r.w],
    [a.y, b.y - a.y, r.y, r.y + r.h],
  ]) {
    if (Math.abs(delta) < EPS) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const t1 = (min - origin) / delta,
      t2 = (max - origin) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  return true;
}
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function capsuleRect(a, b, radius, r) {
  if (segmentRect(a, b, r)) return true;
  for (const p of [a, b])
    if (Math.hypot(p.x - clamp(p.x, r.x, r.x + r.w), p.y - clamp(p.y, r.y, r.y + r.h)) <= radius)
      return true;
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ].some((p) => pointSegmentDistance(p, a, b) <= radius);
}
export function resolveStrike(attacker, target) {
  const attack = attacker.attack;
  if (!attack || attack.hit || phaseOf(attack) !== 'active')
    return { hit: false, damage: 0, knock: 0 };
  const pose = weaponPose(attacker),
    body = rect(target);
  let hit =
    capsuleRect(pose.base, pose.tip, pose.radius, body) ||
    capsuleRect(pose.tip, pose.tip, pose.tipRadius, body);
  if (!hit && attack.previousPose) {
    const previous = attack.previousPose,
      dx = target.x - (target.previousX ?? target.x),
      dy = target.y - (target.previousY ?? target.y);
    const tip = { x: pose.tip.x - dx, y: pose.tip.y - dy };
    hit = capsuleRect(
      previous.tip,
      tip,
      Math.max(pose.radius, pose.tipRadius),
      rect({ ...target, x: target.previousX ?? target.x, y: target.previousY ?? target.y }),
    );
  }
  if (!hit) return { hit: false, damage: 0, knock: 0 };
  const blocked =
    target.blocking && (target.guardFace ?? target.face) * (attacker.x - target.x) >= -3;
  return {
    hit: true,
    blocked,
    parried: blocked && target.parry > 0,
    damage: blocked ? 0 : attack.damage,
    knock: attack.knock,
    guardCost: attack.guardCost,
  };
}

const WEIGHT = { light: 1, thrust: 2, heavy: 3 };
/** True while a swing is past its armorAt mark and not yet recovering. */
export const isArmored = (f) =>
  Boolean(f.attack) &&
  f.attack.armorAt !== undefined &&
  f.attack.age >= f.attack.armorAt &&
  phaseOf(f.attack) !== 'recovery';
/** An armored swing cannot be cancelled by a hit lighter than its poise. */
export const resistsInterrupt = (target, incoming) =>
  isArmored(target) && (target.attack.poise ?? 1) >= WEIGHT[incoming.type];
