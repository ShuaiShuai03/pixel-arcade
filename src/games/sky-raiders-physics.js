// Flight, hull contact and swept-collision physics. Mass is in nominal kilograms; velocity is in
// logical pixels per second; positions only change through the integrators in this module.
import { clamp } from '../shared/utils.js';
import { bounds, hullRects } from './sky-raiders-sprites.js';

export const ROUND_MASS = 0.04;
export const STEP = 1 / 120,
  EPS = 1e-7,
  LIMIT = { minX: 24, maxX: 456, minY: 72, maxY: 288 };
const length = (v) => Math.hypot(v.vx, v.vy);
function overlap(a, b, pad = 0) {
  return (
    a.x + a.w >= b.x - pad &&
    a.x <= b.x + b.w + pad &&
    a.y + a.h >= b.y - pad &&
    a.y <= b.y + b.h + pad
  );
}
export function bodyContact(a, b, dt = 0, margin = 0) {
  // The pair can close by both speeds together within the step.
  if (!overlap(bounds(a), bounds(b), margin + (length(a) + length(b)) * dt)) return null;
  let earliest = null;
  for (const ra of hullRects(a))
    for (const rb of hullRects(b)) {
      const dx = ra.x + ra.w / 2 - rb.x - rb.w / 2,
        dy = ra.y + ra.h / 2 - rb.y - rb.h / 2;
      let enter = 0,
        exit = dt,
        normal = null,
        depth = Infinity,
        inside = null;
      for (const [d, v, r, nx, ny] of [
        [dx, a.vx - b.vx, (ra.w + rb.w) / 2, 1, 0],
        [dy, a.vy - b.vy, (ra.h + rb.h) / 2, 0, 1],
      ]) {
        const penetration = r - Math.abs(d);
        if (penetration < depth) {
          depth = penetration;
          inside = { nx: nx * (d >= 0 ? 1 : -1), ny: ny * (d >= 0 ? 1 : -1) };
        }
        if (Math.abs(v) < EPS) {
          if (Math.abs(d) > r + margin) {
            exit = -1;
            break;
          }
          continue;
        }
        const t1 = (-r - d) / v,
          t2 = (r - d) / v,
          near = Math.min(t1, t2),
          far = Math.max(t1, t2);
        if (near > enter) {
          enter = near;
          const sign = d + v * near >= 0 ? 1 : -1;
          normal = { nx: nx * sign, ny: ny * sign };
        }
        exit = Math.min(exit, far);
        if (enter > exit + EPS) break;
      }
      if (enter > exit + EPS || exit < -EPS || enter > dt + EPS) continue;
      normal ??= inside;
      if (
        enter <= EPS &&
        depth <= EPS &&
        (a.vx - b.vx) * normal.nx + (a.vy - b.vy) * normal.ny >= -EPS &&
        margin === 0
      )
        continue;
      const hit = { ...normal, time: Math.max(0, enter), penetration: Math.max(0, depth) };
      if (
        !earliest ||
        hit.time < earliest.time ||
        (hit.time === earliest.time && hit.penetration < earliest.penetration)
      )
        earliest = hit;
    }
  return earliest;
}
const MIN_OVERLAP = 1e-6;
const SEPARATION_MARGIN = 1e-6;
const SEPARATION_PASSES = 8;
const PUSHES = [
  [1, 0, (ra, rb) => rb.x + rb.w - ra.x],
  [-1, 0, (ra, rb) => ra.x + ra.w - rb.x],
  [0, 1, (ra, rb) => rb.y + rb.h - ra.y],
  [0, -1, (ra, rb) => ra.y + ra.h - rb.y],
];
const intersect = (ra, rb) =>
  Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x) > MIN_OVERLAP &&
  Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y) > MIN_OVERLAP;
/**
 * The shortest straight push of hull `a` that clears every solid rectangle of hull `b`, or null
 * when they do not overlap. One translation for the whole pair keeps stacked sprite rows together.
 */
function clearingPush(a, b) {
  const rectsA = hullRects(a),
    rectsB = hullRects(b),
    touching = [];
  for (const ra of rectsA) for (const rb of rectsB) if (intersect(ra, rb)) touching.push([ra, rb]);
  if (!touching.length) return null;
  const options = PUSHES.map(([nx, ny, need]) => ({
    nx,
    ny,
    depth: Math.max(...touching.map(([ra, rb]) => need(ra, rb))),
  })).sort((p, q) => p.depth - q.depth);
  const free = (o) =>
    !rectsA.some((ra) =>
      rectsB.some((rb) =>
        intersect({ ...ra, x: ra.x + o.nx * o.depth, y: ra.y + o.ny * o.depth }, rb),
      ),
    );
  return options.find(free) ?? options[0];
}
/**
 * Positional safety net behind the impulse solver: any hulls still overlapping are moved apart
 * along the shallowest axis, split by inverse mass (a pinned body never moves).
 */
export function separateHulls(bodies, pinned = null) {
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        if (a.dead || b.dead || !overlap(bounds(a), bounds(b))) continue;
        const hit = clearingPush(a, b),
          wa = a === pinned ? 0 : 1 / a.mass,
          wb = b === pinned ? 0 : 1 / b.mass;
        if (!hit || wa + wb === 0) continue;
        const push = hit.depth + SEPARATION_MARGIN;
        a.x += (hit.nx * push * wa) / (wa + wb);
        a.y += (hit.ny * push * wa) / (wa + wb);
        b.x -= (hit.nx * push * wb) / (wa + wb);
        b.y -= (hit.ny * push * wb) / (wa + wb);
        moved = true;
      }
    if (!moved) break;
  }
}
export function resolveHullImpact(a, b, { nx, ny }, restitution = 0.08) {
  const closing = -((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  if (closing <= 0) return 0;
  const impulse = ((1 + restitution) * closing) / (1 / a.mass + 1 / b.mass);
  a.vx += (impulse * nx) / a.mass;
  a.vy += (impulse * ny) / a.mass;
  b.vx -= (impulse * nx) / b.mass;
  b.vy -= (impulse * ny) / b.mass;
  return closing;
}
export function thrust(body, h, dx, dy, config = {}) {
  const norm = Math.hypot(dx, dy);
  if (norm > 1) {
    dx /= norm;
    dy /= norm;
  }
  const speed = config.speed ?? 170,
    gain = config.gain ?? 18,
    maxAcceleration = config.acceleration ?? 1000,
    drag = config.drag ?? 0.8;
  let tx = dx * speed,
    ty = dy * speed;
  if (config.limits !== false) {
    const limit = config.limits ?? LIMIT;
    tx = clamp(tx, -3.8 * (body.x - limit.minX), 3.8 * (limit.maxX - body.x));
    ty = clamp(ty, -3.8 * (body.y - limit.minY), 3.8 * (limit.maxY - body.y));
  }
  let ax = (tx - body.vx) * gain - drag * body.vx,
    ay = (ty - body.vy) * gain - drag * body.vy;
  const acceleration = Math.hypot(ax, ay);
  if (acceleration > maxAcceleration) {
    ax *= maxAcceleration / acceleration;
    ay *= maxAcceleration / acceleration;
  }
  body.ax = ax;
  body.ay = ay;
  body.vx += ax * h;
  body.vy += ay * h;
}
/** Bounded vector-thrust and powered edge assistance; no position or velocity snap. */
export function advanceFlight(body, dt, command) {
  let rest = dt;
  if (!Number.isFinite(rest) || rest <= 0) return;
  while (rest > EPS) {
    const h = Math.min(STEP, rest),
      vx = body.vx,
      vy = body.vy;
    thrust(body, h, command.dx ?? 0, command.dy ?? 0);
    body.x += ((vx + body.vx) * h) / 2;
    body.y += ((vy + body.vy) * h) / 2;
    rest -= h;
  }
}
function circleRect(x, y, r, rect) {
  return (
    Math.hypot(x - clamp(x, rect.x, rect.x + rect.w), y - clamp(y, rect.y, rect.y + rect.h)) <=
    r + EPS
  );
}
function sweepCircleRect(x, y, vx, vy, r, rect, dt) {
  if (circleRect(x, y, r, rect)) {
    const cx = clamp(x, rect.x, rect.x + rect.w),
      cy = clamp(y, rect.y, rect.y + rect.h),
      dx = x - cx,
      dy = y - cy,
      distance = Math.hypot(dx, dy);
    if (
      distance < r - EPS ||
      (x > rect.x + EPS &&
        x < rect.x + rect.w - EPS &&
        y > rect.y + EPS &&
        y < rect.y + rect.h - EPS)
    )
      return 0;
    let nx = dx,
      ny = dy;
    if (distance < EPS) {
      nx = x <= rect.x + EPS ? -1 : x >= rect.x + rect.w - EPS ? 1 : 0;
      ny = y <= rect.y + EPS ? -1 : y >= rect.y + rect.h - EPS ? 1 : 0;
    }
    return vx * nx + vy * ny < -EPS ? 0 : null;
  }
  let best = Infinity;
  const consider = (t) => {
    if (t >= -EPS && t <= dt + EPS && circleRect(x + vx * t, y + vy * t, r, rect))
      best = Math.min(best, Math.max(0, t));
  };
  if (vx > 0) consider((rect.x - r - x) / vx);
  else if (vx < 0) consider((rect.x + rect.w + r - x) / vx);
  if (vy > 0) consider((rect.y - r - y) / vy);
  else if (vy < 0) consider((rect.y + rect.h + r - y) / vy);
  const speed = vx * vx + vy * vy;
  if (speed > EPS)
    for (const [cx, cy] of [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ]) {
      const dx = x - cx,
        dy = y - cy,
        b = 2 * (dx * vx + dy * vy),
        c = dx * dx + dy * dy - r * r,
        d = b * b - 4 * speed * c;
      if (d >= 0) consider((-b - Math.sqrt(d)) / (2 * speed));
    }
  return best === Infinity ? null : best;
}
function projectileContacts(projectile, target, dt) {
  const parts = new Map();
  for (const r of hullRects(target)) {
    const time = sweepCircleRect(
      projectile.x,
      projectile.y,
      projectile.vx - (target.vx ?? 0),
      projectile.vy - (target.vy ?? 0),
      projectile.r,
      r,
      dt,
    );
    if (time !== null && (!parts.has(r.part) || time < parts.get(r.part))) parts.set(r.part, time);
  }
  return [...parts].map(([part, time]) => ({ part, time }));
}
export const partPriority = (part) => (['c', 'l', 'r'].includes(part) ? 0 : 1);
export function sweepProjectile(projectile, target, dt) {
  return (
    projectileContacts(projectile, target, dt).sort(
      (a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part),
    )[0] ?? null
  );
}
/** Dry hull plus a cartridge share launch momentum; the gun supplies the energy. */
export function fireRound(shooter, angle, speed, options = {}) {
  const mass = options.mass ?? ROUND_MASS,
    share = shooter.mass / (shooter.mass + mass),
    rx = Math.cos(angle) * speed,
    ry = Math.sin(angle) * speed;
  const bullet = {
    id: options.id ?? 0,
    x: options.x ?? shooter.x,
    y: options.y ?? shooter.y,
    vx: shooter.vx + rx * share,
    vy: shooter.vy + ry * share,
    r: options.r ?? 2,
    damage: options.damage ?? 1,
    mass,
    owner: options.owner ?? 'enemy',
    ownerId: shooter.id,
    life: 2.4,
  };
  shooter.vx -= (rx * mass) / (shooter.mass + mass);
  shooter.vy -= (ry * mass) / (shooter.mass + mass);
  return bullet;
}
export function movingCircle(a, b, dt) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    vx = a.vx - b.vx,
    vy = a.vy - b.vy,
    r = a.r + b.r,
    c = dx * dx + dy * dy - r * r;
  if (c < -EPS) return 0;
  if (c <= EPS) return dx * vx + dy * vy < -EPS ? 0 : null;
  const aa = vx * vx + vy * vy,
    bb = 2 * (dx * vx + dy * vy),
    d = bb * bb - 4 * aa * c;
  if (aa < EPS || d < 0) return null;
  const t = (-bb - Math.sqrt(d)) / (2 * aa);
  return t >= 0 && t <= dt ? t : null;
}
export function waveTime(w, object, dt) {
  const radius = object.r ?? 0,
    old = Math.hypot(object.x - w.x, object.y - w.y) - radius;
  if (w.radius > EPS && old < w.radius - EPS) return null;
  const at = (t) =>
    Math.hypot(object.x + object.vx * t - w.x, object.y + object.vy * t - w.y) -
    radius -
    w.radius -
    w.speed * t;
  if (at(0) <= 0) return 0;
  if (at(dt) > 0) return null;
  let lo = 0,
    hi = dt;
  for (let n = 0; n < 16; n++) {
    const m = (lo + hi) / 2;
    if (at(m) > 0) lo = m;
    else hi = m;
  }
  return hi;
}
export function waveHullContacts(w, actor, dt) {
  const parts = new Map();
  for (const r of hullRects(actor)) {
    const distance = (t) =>
      Math.hypot(
        w.x - clamp(w.x, r.x + actor.vx * t, r.x + r.w + actor.vx * t),
        w.y - clamp(w.y, r.y + actor.vy * t, r.y + r.h + actor.vy * t),
      );
    const old = distance(0);
    if (w.radius > EPS && old < w.radius - EPS) continue;
    const at = (t) => distance(t) - w.radius - w.speed * t;
    if (at(dt) > 0) continue;
    let lo = 0,
      hi = dt;
    if (at(0) <= 0) hi = 0;
    else
      for (let n = 0; n < 18; n++) {
        const m = (lo + hi) / 2;
        if (at(m) > 0) lo = m;
        else hi = m;
      }
    if (!parts.has(r.part) || hi < parts.get(r.part)) parts.set(r.part, hi);
  }
  return [...parts].map(([part, time]) => ({ part, time }));
}
export function pickupTime(p, player, dt) {
  let nearest = null;
  for (const r of hullRects(player)) {
    const time = sweepCircleRect(
      p.x,
      p.y,
      p.vx - player.vx,
      p.vy - player.vy,
      0,
      { x: r.x - 7, y: r.y - 7, w: r.w + 14, h: r.h + 14 },
      dt,
    );
    if (time !== null && (nearest === null || time < nearest)) nearest = time;
  }
  return nearest;
}
