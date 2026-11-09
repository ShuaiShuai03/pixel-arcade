import { clamp } from '../shared/utils.js';

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
export const MAX_FRAME = 1 / 30;
export const MAX_ACCEPTED_DT = 1;
export const PLAY_TOP = 30; // canvas rows above are the HUD band
export const PLAY_BOTTOM = 294; // canvas rows below are the prompt band
export const SHOT_BOUNDS = { x0: 4, x1: 476, y0: 34, y1: 290 };
export const WALK = { x0: 52, x1: 428, y0: 90, y1: 256 };
export const SPEED = 100;
export const BODY = { hw: 8, hh: 12 }; // matches the 16x24 sprite
export const SHIELD_R = 22; // centre line of the plates
export const SHIELD_THICK = 8; // drawn plates span SHIELD_R +/- 4 px
export const SHIELD_OUTER = SHIELD_R + SHIELD_THICK / 2;
export const SHIELD_INNER = SHIELD_R - SHIELD_THICK / 2;
export const SHIELD_HALF = Math.PI / 4; // 90 degree arc
export const MAX_HP = 5;
export const INVULN = 0.9;
export const MAX_ENERGY = 100;
export const DRAIN = 5;
export const RECHARGE = 60;
export const RECHARGE_DELAY = 0.25;
export const MIN_RAISE = 10;
export const BLOCK_COST = 8;
export const BASH_COST = 12;
export const BASH_ACTIVE = 0.15;
export const BASH_CD = 0.8;
export const BASH_R = 34;
export const BASH_HALF = (70 * Math.PI) / 180;
export const REFLECT_BOOST = 1.2;
export const SLAM_R = 36;
export const BROKEN_TIME = 1.5;
export const EXPOSE_TIME = 4;
export const INTRO_TIME = 3;
export const FIRST_DELAY = 1.5;
export const LANCE_SPEED = 300;
export const CRAWLER_PORTAL = 0.7;
export const CRAWLER_STUN = 0.8;
export const MAX_FX = 40;
export const BLOCK_FLASH = 0.25;
export const CHARGE = { orb: 0.7, slug: 0.7, lance: 1, slam: 1.3 };
export const SHOT_R = { orb: 5, slug: 4, lance: 3 };
export const SHOT_DAMAGE = { orb: 1, slug: 1, lance: 2 };

// ---------------------------------------------------------------- geometry

export const angleBetween = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const inArc = (dx, dy, facing, half = SHIELD_HALF) =>
  angleBetween(Math.atan2(dy, dx), facing) <= half + 1e-9;

// Earliest time in [0,1] at which a moving point first enters a circle from outside.
export function segmentCircleEntry(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0,
    dy = y1 - y0,
    fx = x0 - cx,
    fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r,
    a = dx * dx + dy * dy,
    b = fx * dx + fy * dy;
  if (c <= 0 || a === 0 || b >= 0) return null;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? Math.max(0, t) : null;
}

// Earliest time in [0,1] at which a moving point touches a box (slab test); 0 when it starts inside.
export function segmentBoxEntry(x0, y0, x1, y1, cx, cy, hw, hh) {
  let tMin = 0,
    tMax = 1;
  for (const [o, d, lo, hi] of [
    [x0, x1 - x0, cx - hw, cx + hw],
    [y0, y1 - y0, cy - hh, cy + hh],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d,
      b = (hi - o) / d;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    if (tMin > tMax) return null;
  }
  return tMin;
}

// Earliest contact of a moving circle (radius r) with the segment A-B, null if it starts touching.
function capsuleEntry(x0, y0, x1, y1, ax, ay, bx, by, r) {
  const len = Math.hypot(bx - ax, by - ay),
    ux = (bx - ax) / len,
    uy = (by - ay) / len;
  const local = (x, y) => [(x - ax) * ux + (y - ay) * uy, -(x - ax) * uy + (y - ay) * ux];
  const [u0, v0] = local(x0, y0),
    [u1, v1] = local(x1, y1);
  if (Math.hypot(u0 - clamp(u0, 0, len), v0) <= r) return null;
  const hits = [
    segmentBoxEntry(u0, v0, u1, v1, len / 2, 0, len / 2, r),
    segmentCircleEntry(x0, y0, x1, y1, ax, ay, r),
    segmentCircleEntry(x0, y0, x1, y1, bx, by, r),
  ].filter((t) => t !== null);
  return hits.length ? Math.min(...hits) : null;
}

// Swept circle against the drawn plates: the outer face inside the arc plus both end faces.
// Returns the contact time, the shot centre relative to the sentinel and the surface normal.
export function shieldContact(cx, cy, face, x0, y0, x1, y1, r) {
  let best = null;
  const at = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const outer = segmentCircleEntry(x0, y0, x1, y1, cx, cy, SHIELD_OUTER + r);
  if (outer !== null) {
    const [hx, hy] = at(outer).map((v, i) => v - (i ? cy : cx)),
      len = Math.hypot(hx, hy);
    if (inArc(hx, hy, face)) best = { t: outer, hx, hy, nx: hx / len, ny: hy / len };
  }
  for (const sign of [-1, 1]) {
    const a = face + sign * SHIELD_HALF,
      ax = cx + Math.cos(a) * SHIELD_INNER,
      ay = cy + Math.sin(a) * SHIELD_INNER,
      bx = cx + Math.cos(a) * SHIELD_OUTER,
      by = cy + Math.sin(a) * SHIELD_OUTER;
    const t = capsuleEntry(x0, y0, x1, y1, ax, ay, bx, by, r);
    if (t === null || (best && best.t <= t)) continue;
    const [px, py] = at(t),
      along = clamp(
        ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (SHIELD_OUTER - SHIELD_INNER) ** 2,
        0,
        1,
      ),
      nx = px - (ax + (bx - ax) * along),
      ny = py - (ay + (by - ay) * along),
      len = Math.hypot(nx, ny) || 1;
    best = { t, hx: px - cx, hy: py - cy, nx: nx / len, ny: ny / len };
  }
  return best;
}

// Mirror reflection about the shield normal: v' = v - 2 (v . n) n.
export function reflect(vx, vy, nx, ny) {
  const dot = vx * nx + vy * ny;
  return { vx: vx - 2 * dot * nx, vy: vy - 2 * dot * ny };
}

// Half-width of the lane a lance of this heading sweeps across the sentinel's box.
export const laneHalfWidth = (dirx, diry, r = SHOT_R.lance) =>
  Math.abs(diry) * BODY.hw + Math.abs(dirx) * BODY.hh + r * (Math.abs(dirx) + Math.abs(diry));

export const circleHitsBox = (cx, cy, r, bx, by, hw, hh) =>
  Math.hypot(cx - clamp(cx, bx - hw, bx + hw), cy - clamp(cy, by - hh, by + hh)) <= r;
