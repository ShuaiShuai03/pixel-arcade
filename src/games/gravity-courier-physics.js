// Powered-field physics: exact trajectories, swept contact events, and the cues drawn from them.
import { clamp } from '../shared/utils.js';
import { COURIER_ROOMS } from './gravity-courier-rooms.js';

export const HW = 10,
  HH = 12,
  LEFT = 34,
  RIGHT = 446,
  TOP = 64,
  BOTTOM = 264,
  EPS = 1e-9,
  GEOM = 1e-7,
  DOCK_RADIUS = 22,
  DOCK_SPEED = 8,
  AIR_DRAG = 3,
  RAIL_DRAG = 3,
  THRUST = 360;
export const room = (s) => COURIER_ROOMS[s.level - 1];
export const carried = (s) => s.parcel.status === 'carried';
export const mass = (s) => 1 + (carried(s) ? s.parcel.mass : 0);
export function courierField(s, axis = 0) {
  const direction = Math.abs(s.player.vx) > EPS ? Math.sign(s.player.vx) : axis,
    x = s.player.x + direction * GEOM;
  return (
    room(s).zones.find((z) => x >= z.from - GEOM / 2 && x < z.to - GEOM / 2)?.g ||
    room(s).zones.at(-1).g
  );
}
function overlapsAt(value, half, lo, hi, velocity, acceleration) {
  const a = value + half - lo,
    b = hi - (value - half);
  if (a > GEOM && b > GEOM) return true;
  if (Math.abs(a) <= GEOM)
    return velocity > EPS || (Math.abs(velocity) <= EPS && acceleration > EPS);
  if (Math.abs(b) <= GEOM)
    return velocity < -EPS || (Math.abs(velocity) <= EPS && acceleration < -EPS);
  return false;
}
function constraints(s, axis, g) {
  const p = s.player,
    ax = (axis * THRUST - AIR_DRAG * p.vx) / mass(s),
    ay = s.gravity * g;
  let bx =
      (p.x <= LEFT + GEOM && Math.abs(p.vx) < EPS && ax < 0) ||
      (p.x >= RIGHT - GEOM && Math.abs(p.vx) < EPS && ax > 0),
    by =
      (p.y <= TOP + GEOM && Math.abs(p.vy) < EPS && ay < 0) ||
      (p.y >= BOTTOM - GEOM && Math.abs(p.vy) < EPS && ay > 0);
  for (const w of room(s).walls) {
    if (Math.abs(p.vx) < EPS && overlapsAt(p.y, HH, w.y, w.y + w.h, p.vy, ay)) {
      if (Math.abs(p.x + HW - w.x) <= GEOM && ax > 0) bx = true;
      if (Math.abs(p.x - HW - w.x - w.w) <= GEOM && ax < 0) bx = true;
    }
    if (Math.abs(p.vy) < EPS && overlapsAt(p.x, HW, w.x, w.x + w.w, p.vx, ax)) {
      if (Math.abs(p.y + HH - w.y) <= GEOM && ay > 0) by = true;
      if (Math.abs(p.y - HH - w.y - w.h) <= GEOM && ay < 0) by = true;
    }
  }
  return { bx, by };
}
export function trajectory(s, axis) {
  const p = s.player,
    g = courierField(s, axis),
    c = constraints(s, axis, g),
    drag = AIR_DRAG + (c.by ? RAIL_DRAG : 0),
    k = drag / mass(s),
    terminal = (axis * THRUST) / drag,
    ay = c.by ? 0 : s.gravity * g;
  const at = (t) => {
    const q = -Math.expm1(-k * t),
      vx = c.bx ? 0 : terminal + (p.vx - terminal) * (1 - q),
      x = c.bx ? p.x : p.x + terminal * t + ((p.vx - terminal) * q) / k;
    return {
      x,
      y: p.y + p.vy * t + (ay * t * t) / 2,
      vx,
      vy: p.vy + ay * t,
      ax: c.bx ? 0 : k * (terminal - vx),
      ay,
    };
  };
  return { at, k, terminal, ay, bx: c.bx };
}
function rootsY(p, ay, target, limit) {
  const result = [],
    d = p.y - target;
  if (Math.abs(ay) < EPS) {
    if (Math.abs(p.vy) > EPS) result.push(-d / p.vy);
    else if (Math.abs(d) < GEOM) result.push(0);
  } else {
    const discriminant = p.vy * p.vy - 2 * ay * d;
    if (discriminant >= -EPS) {
      const root = Math.sqrt(Math.max(0, discriminant));
      result.push((-p.vy - root) / ay, (-p.vy + root) / ay);
    }
  }
  return result.filter((t) => t >= -EPS && t <= limit + EPS).map((t) => clamp(t, 0, limit));
}
function rootsX(p, tr, target, limit) {
  if (tr.bx) return Math.abs(p.x - target) < GEOM ? [0] : [];
  const cuts = [0, limit];
  if (p.vx * tr.terminal < 0) {
    const zero = Math.log((p.vx - tr.terminal) / -tr.terminal) / tr.k;
    if (zero > EPS && zero < limit - EPS) cuts.splice(1, 0, zero);
  }
  const result = [];
  for (let i = 1; i < cuts.length; i++) {
    let a = cuts[i - 1],
      b = cuts[i],
      fa = tr.at(a).x - target,
      fb = tr.at(b).x - target;
    if (Math.abs(fa) < 1e-8) result.push(a);
    if (Math.abs(fb) < 1e-8) result.push(b);
    if (fa * fb < 0) {
      for (let n = 0; n < 48; n++) {
        const mid = (a + b) / 2,
          fm = tr.at(mid).x - target;
        if (fa * fm <= 0) {
          b = mid;
          fb = fm;
        } else {
          a = mid;
          fa = fm;
        }
      }
      result.push((a + b) / 2);
    }
  }
  return result.filter((t, i, a) => a.findIndex((v) => Math.abs(v - t) < EPS) === i);
}
export function nextMotionEvent(s, tr, limit) {
  let time = limit,
    hits = [];
  const add = (t, hit = null) => {
    if (t < -EPS || t > limit + EPS) return;
    t = clamp(t, 0, limit);
    if (t < time - EPS) {
      time = t;
      hits = hit ? [hit] : [];
    } else if (Math.abs(t - time) <= EPS && hit) hits.push(hit);
  };
  const face = (dimension, value, nx, ny, w = null) => {
    const roots =
      dimension === 'x'
        ? rootsX(s.player, tr, value, limit)
        : rootsY(s.player, tr.ay, value, limit);
    for (const t of roots) {
      const q = tr.at(t),
        speed = -(q.vx * nx + q.vy * ny),
        force = -(q.ax * nx + q.ay * ny);
      if (speed <= EPS && !(Math.abs(speed) <= EPS && force > EPS)) continue;
      if (
        w &&
        !overlapsAt(
          dimension === 'x' ? q.y : q.x,
          dimension === 'x' ? HH : HW,
          dimension === 'x' ? w.y : w.x,
          dimension === 'x' ? w.y + w.h : w.x + w.w,
          dimension === 'x' ? q.vy : q.vx,
          dimension === 'x' ? q.ay : q.ax,
        )
      )
        continue;
      add(t, { dimension, value, nx, ny });
    }
  };
  face('x', LEFT, 1, 0);
  face('x', RIGHT, -1, 0);
  face('y', TOP, 0, 1);
  face('y', BOTTOM, 0, -1);
  for (const w of room(s).walls) {
    face('x', w.x - HW, -1, 0, w);
    face('x', w.x + w.w + HW, 1, 0, w);
    face('y', w.y - HH, 0, -1, w);
    face('y', w.y + w.h + HH, 0, 1, w);
    for (const x of [w.x - HW, w.x + w.w + HW])
      for (const t of rootsX(s.player, tr, x, limit)) if (t > EPS) add(t);
    for (const y of [w.y - HH, w.y + w.h + HH])
      for (const t of rootsY(s.player, tr.ay, y, limit)) if (t > EPS) add(t);
  }
  for (const z of room(s).zones.slice(0, -1))
    for (const t of rootsX(s.player, tr, z.to, limit)) if (t > EPS) add(t);
  return { time, hits };
}

export function courierLanding(s) {
  const predicted = { ...s, player: { ...s.player } },
    path = [{ x: s.player.x, y: s.player.y }];
  let elapsed = 0;
  for (let iteration = 0; iteration < 80; iteration++) {
    const tr = trajectory(predicted, 0),
      p = predicted.player;
    if (Math.abs(p.vy) <= EPS && Math.abs(tr.ay) <= EPS && Math.abs(p.vx) <= EPS)
      return { x: p.x, y: p.y, speed: 0, safe: true, kind: 'rest', time: elapsed, path };
    const turning = p.vy * tr.ay < 0 ? -p.vy / tr.ay : Infinity,
      event = nextMotionEvent(predicted, tr, Math.min(10, turning)),
      t = event.time,
      q = tr.at(t);
    for (let sample = 1; sample <= 4; sample++) {
      const at = tr.at((t * sample) / 4);
      path.push({ x: at.x, y: at.y });
    }
    elapsed += t;
    if (event.hits.length) {
      const speed = Math.hypot(
        event.hits.some((h) => h.nx) ? q.vx : 0,
        event.hits.some((h) => h.ny) ? q.vy : 0,
      );
      return {
        x: q.x,
        y: q.y,
        speed,
        safe: !carried(s) || speed <= s.parcel.safeSpeed + GEOM,
        kind: 'contact',
        time: elapsed,
        path,
      };
    }
    if (Math.abs(t - turning) <= EPS)
      return { x: q.x, y: q.y, speed: 0, safe: true, kind: 'turn', time: elapsed, path };
    Object.assign(predicted.player, { x: q.x, y: q.y, vx: q.vx, vy: q.vy });
    if (t >= 10 - EPS)
      return { x: q.x, y: q.y, speed: 0, safe: true, kind: 'coast', time: elapsed, path };
  }
  throw new Error('Courier coast forecast did not converge');
}
export function courierDockCue(s) {
  const p = s.player,
    r = room(s),
    destination = carried(s) && s.parcel.integrity > 0,
    pad = destination ? r.destination : r.source,
    near = Math.abs(p.x - pad.x) <= 36 && Math.abs(p.y - pad.y) <= 48;
  if (!near) return { near: false, ready: false, reason: 'travel' };
  let reason;
  if (Math.abs(p.x - pad.x) > DOCK_RADIUS) reason = 'align';
  else if (Math.abs(p.y - pad.y) > GEOM || Math.abs(p.vy) > EPS) reason = 'land';
  else if (s.gravity !== pad.side) reason = 'field';
  else if (Math.abs(p.vx) > DOCK_SPEED) reason = 'slow';
  else if (destination) reason = 'deliver';
  else if (s.parcel.status === 'stored') reason = 'collect';
  else if (s.parcel.integrity < s.parcel.maxIntegrity) reason = s.spares ? 'repack' : 'no-spare';
  else reason = 'loaded';
  return {
    near: true,
    ready: ['deliver', 'collect', 'repack'].includes(reason),
    reason,
    horizontalSpeed: Math.abs(p.vx),
    fieldRequired: pad.side,
  };
}
