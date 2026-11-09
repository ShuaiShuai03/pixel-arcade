// Pure rope, pendulum and collision mathematics for Grapnel Gorge.
import { clamp } from '../shared/utils.js';

export const PHYSICS = Object.freeze({
  gravity: 420,
  step: 1 / 240,
  radius: 7,
  minLength: 58,
  maxLength: 238,
  hookRange: 238,
  reelSpeed: 32,
  walkSpeed: 130,
  walkForce: 780,
  battery: 300000,
  lives: 5,
  water: 306,
});
export const G = PHYSICS.gravity,
  R = PHYSICS.radius,
  EPS = 1e-8;
export const sq = (n) => n * n;
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
const wrap = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const sinc = (x) => (Math.abs(x) < 1e-6 ? 1 - (x * x) / 6 : Math.sin(x) / x);
export const mechanicalEnergy = (p) => (sq(p.vx) + sq(p.vy)) / 2 - G * p.y;

export function anchorPose(a, time) {
  const w = a.frequency || 0,
    angle = w * time + (a.phase || 0);
  const ax = a.amplitudeX || 0,
    ay = a.amplitudeY || 0;
  return {
    id: a.id,
    x: a.x + ax * Math.sin(angle),
    y: a.y + ay * Math.sin(angle),
    vx: ax * w * Math.cos(angle),
    vy: ay * w * Math.cos(angle),
    ax: -ax * w * w * Math.sin(angle),
    ay: -ay * w * w * Math.sin(angle),
  };
}
// Discrete-gradient pendulum step: gravity's potential difference is exactly
// the opposite of the change in tangential kinetic energy. No position repair.
export function pendulumStep(theta, omega, length, h) {
  if (!(h > 0) || !Number.isFinite(h)) return { theta, omega, residual: 0 };
  let d = h * omega;
  const c = (h * h * G) / (2 * length);
  for (let i = 0; i < 10; i++) d = h * omega - c * Math.sin(theta + d / 2) * sinc(d / 2);
  return {
    theta: wrap(theta + d),
    omega: (2 * d) / h - omega,
    residual: d - h * omega + c * Math.sin(theta + d / 2) * sinc(d / 2),
  };
}
export function tension(theta, omega, length, a) {
  return (
    G * Math.cos(theta) - a.ax * Math.sin(theta) - a.ay * Math.cos(theta) + length * omega * omega
  );
}
function angularRK(theta, omega, length, rate, anchor, time, h) {
  const derivative = (q, w, t) => {
    const a = anchorPose(anchor, time + t),
      l = length + rate * t;
    return [w, (-G * Math.sin(q) - a.ax * Math.cos(q) + a.ay * Math.sin(q) - 2 * rate * w) / l];
  };
  const k1 = derivative(theta, omega, 0),
    k2 = derivative(theta + (k1[0] * h) / 2, omega + (k1[1] * h) / 2, h / 2),
    k3 = derivative(theta + (k2[0] * h) / 2, omega + (k2[1] * h) / 2, h / 2),
    k4 = derivative(theta + k3[0] * h, omega + k3[1] * h, h);
  return {
    theta: wrap(theta + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])),
    omega: omega + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  };
}
function pendulumBody(theta, omega, length, rate, a) {
  const nx = Math.sin(theta),
    ny = Math.cos(theta);
  return {
    x: a.x + length * nx,
    y: a.y + length * ny,
    vx: a.vx + rate * nx + length * omega * ny,
    vy: a.vy + rate * ny - length * omega * nx,
    ground: false,
  };
}
export function advanceTaut(rope, anchor, time, h) {
  const a0 = anchorPose(anchor, time),
    a1 = anchorPose(anchor, time + h),
    l0 = rope.length,
    rate = rope.rate || 0;
  const initial = pendulumBody(rope.theta, rope.omega, l0, rate, a0);
  const stationary = !anchor.amplitudeX && !anchor.amplitudeY && rate === 0;
  const end = stationary
    ? pendulumStep(rope.theta, rope.omega, l0, h)
    : angularRK(rope.theta, rope.omega, l0, rate, anchor, time, h);
  const middle = stationary
    ? pendulumStep(rope.theta, rope.omega, l0, h / 2)
    : angularRK(rope.theta, rope.omega, l0, rate, anchor, time, h / 2);
  const l1 = l0 + rate * h,
    p = pendulumBody(end.theta, end.omega, l1, rate, a1);
  const samples = [
    [rope.theta, rope.omega, l0, a0],
    [middle.theta, middle.omega, l0 + (rate * h) / 2, anchorPose(anchor, time + h / 2)],
    [end.theta, end.omega, l1, a1],
  ];
  let anchorWork = 0,
    winchWork = 0;
  const tensions = samples.map(([q, w, l, a], i) => {
    const force = tension(q, w, l, a),
      weight = i === 1 ? 4 : 1;
    anchorWork += (weight * -force * (a.vx * Math.sin(q) + a.vy * Math.cos(q)) * h) / 6;
    winchWork += (weight * -force * rate * h) / 6;
    return force;
  });
  return {
    player: p,
    rope: {
      ...rope,
      theta: end.theta,
      omega: end.omega,
      length: l1,
      x: a1.x,
      y: a1.y,
      tension: tensions[2],
      taut: true,
    },
    anchorWork,
    winchWork,
    numerical: mechanicalEnergy(p) - mechanicalEnergy(initial) - anchorWork - winchWork,
    residual: end.residual || 0,
    tensionStart: tensions[0],
    tensionEnd: tensions[2],
  };
}
// Capture is an inelastic collision with a moving, unilateral boundary. The
// moving anchor/winch supplies work; the relative radial capture loses energy.
export function captureRope(player, pose, length, rate = 0) {
  const dx = player.x - pose.x,
    dy = player.y - pose.y,
    d = Math.hypot(dx, dy),
    n = { x: dx / d, y: dy / d };
  const relative = (player.vx - pose.vx) * n.x + (player.vy - pose.vy) * n.y;
  const impulse = Math.min(0, rate - relative);
  const p = { ...player, vx: player.vx + impulse * n.x, vy: player.vy + impulse * n.y };
  const theta = Math.atan2(n.x, n.y),
    omega = ((p.vx - pose.vx) * n.y - (p.vy - pose.vy) * n.x) / length;
  const force = tension(theta, omega, length, pose);
  return {
    player: p,
    rope: {
      id: pose.id,
      x: pose.x,
      y: pose.y,
      length,
      rate,
      theta,
      omega,
      tension: relative >= rate - EPS && force >= 0 ? force : 0,
      taut: relative >= rate - EPS && force >= 0,
    },
    anchorWork: impulse * (pose.vx * n.x + pose.vy * n.y),
    winchWork: impulse * rate,
    captureLoss: (impulse * impulse) / 2,
  };
}
export function roots(a, b, c) {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const d = Math.sqrt(Math.max(0, disc));
  return [(-b - d) / (2 * a), (-b + d) / (2 * a)];
}
export function sweepCircle(from, to, radius, rect) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    hits = [];
  const add = (at, nx, ny) => {
    if (at >= -EPS && at <= 1 + EPS && dx * nx + dy * ny < -EPS)
      hits.push({ at: clamp(at, 0, 1), nx, ny, rect });
  };
  for (const [x, nx] of [
    [rect.x - radius, -1],
    [rect.x + rect.w + radius, 1],
  ])
    if (dx * nx < 0) {
      const t = (x - from.x) / dx,
        y = from.y + dy * t;
      if (y >= rect.y - EPS && y <= rect.y + rect.h + EPS) add(t, nx, 0);
    }
  for (const [y, ny] of [
    [rect.y - radius, -1],
    [rect.y + rect.h + radius, 1],
  ])
    if (dy * ny < 0) {
      const t = (y - from.y) / dy,
        x = from.x + dx * t;
      if (x >= rect.x - EPS && x <= rect.x + rect.w + EPS) add(t, 0, ny);
    }
  for (const [x, y, sx, sy] of [
    [rect.x, rect.y, -1, -1],
    [rect.x + rect.w, rect.y, 1, -1],
    [rect.x, rect.y + rect.h, -1, 1],
    [rect.x + rect.w, rect.y + rect.h, 1, 1],
  ]) {
    const ox = from.x - x,
      oy = from.y - y;
    for (const t of roots(
      dx * dx + dy * dy,
      2 * (ox * dx + oy * dy),
      ox * ox + oy * oy - radius * radius,
    )) {
      const px = from.x + dx * t,
        py = from.y + dy * t;
      if ((px - x) * sx >= -EPS && (py - y) * sy >= -EPS)
        add(t, (px - x) / radius, (py - y) / radius);
    }
  }
  return hits.sort((a, b) => a.at - b.at)[0] || null;
}
export function segmentHit(a, b, rect, margin = 0) {
  const minX = rect.x - margin,
    maxX = rect.x + rect.w + margin,
    minY = rect.y - margin,
    maxY = rect.y + rect.h + margin;
  let enter = 0,
    exit = 1;
  for (const [p, d, lo, hi] of [
    [a.x, b.x - a.x, minX, maxX],
    [a.y, b.y - a.y, minY, maxY],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return null;
    } else {
      const q = (lo - p) / d,
        r = (hi - p) / d;
      enter = Math.max(enter, Math.min(q, r));
      exit = Math.min(exit, Math.max(q, r));
      if (enter > exit) return null;
    }
  }
  return { at: enter, x: a.x + (b.x - a.x) * enter, y: a.y + (b.y - a.y) * enter };
}
// A linearly moving rope can hit a corner between two clear endpoint frames.
// Collinearity is quadratic in time; endpoint/edge contacts complete the set.
export function movingRopeHit(a0, b0, a1, b1, solids) {
  let best = null;
  for (const rect of solids) {
    const r = { x: rect.x - 0.75, y: rect.y - 0.75, w: rect.w + 1.5, h: rect.h + 1.5 };
    const times = [0, 1],
      av = { x: a1.x - a0.x, y: a1.y - a0.y },
      bv = { x: b1.x - b0.x, y: b1.y - b0.y };
    for (const [start, velocity] of [
      [a0, av],
      [b0, bv],
    ]) {
      for (const x of [r.x, r.x + r.w]) if (velocity.x) times.push((x - start.x) / velocity.x);
      for (const y of [r.y, r.y + r.h]) if (velocity.y) times.push((y - start.y) / velocity.y);
    }
    const d0 = { x: b0.x - a0.x, y: b0.y - a0.y },
      dv = { x: bv.x - av.x, y: bv.y - av.y };
    for (const corner of [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
    ]) {
      const c0 = { x: corner.x - a0.x, y: corner.y - a0.y };
      times.push(...roots(-cross(dv, av), cross(dv, c0) - cross(d0, av), cross(d0, c0)));
    }
    for (const t of times.filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)) {
      const a = { x: a0.x + av.x * t, y: a0.y + av.y * t },
        b = { x: b0.x + bv.x * t, y: b0.y + bv.y * t },
        hit = segmentHit(a, b, r);
      if (hit && (!best || t < best.at)) best = { ...hit, at: t, rect };
    }
  }
  return best;
}
export function circleGap(p, rect) {
  return (
    Math.hypot(
      p.x - clamp(p.x, rect.x, rect.x + rect.w),
      p.y - clamp(p.y, rect.y, rect.y + rect.h),
    ) - R
  );
}
export function contactVelocity(vx, vy, contacts) {
  const legal = (v) => contacts.every((c) => v.x * c.nx + v.y * c.ny >= -1e-7);
  const candidates = [
    { x: vx, y: vy },
    { x: 0, y: 0 },
  ];
  for (const c of contacts) {
    const inward = vx * c.nx + vy * c.ny;
    candidates.push({ x: vx - inward * c.nx, y: vy - inward * c.ny });
  }
  return candidates
    .filter(legal)
    .sort((a, b) => sq(a.x - vx) + sq(a.y - vy) - sq(b.x - vx) - sq(b.y - vy))[0];
}
