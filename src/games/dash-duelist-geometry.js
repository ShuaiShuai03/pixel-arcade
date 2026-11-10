import { clamp } from '../shared/utils.js';

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
export const PLAY_TOP = 30; // canvas rows above are the HUD band
export const PLAY_BOTTOM = 292; // canvas rows below are the prompt band
export const ARENA = Object.freeze({ x0: 40, x1: 440, y0: 78, y1: 262 }); // limits for fighter centres
export const BODY = Object.freeze({ hw: 10, hh: 14 }); // matches the 20x28 sprites (10x14 art at 2x)
export const DEG = Math.PI / 180;

export const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const distTo = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// A shape is a sector, a ring (a sector of half-angle PI) or a lane, fixed in the world.
const shapeContains = (s, x, y) => {
  const dx = x - s.ox,
    dy = y - s.oy;
  if (s.shape === 'lane') {
    const c = Math.cos(s.angle),
      n = Math.sin(s.angle);
    const along = dx * c + dy * n,
      across = -dx * n + dy * c;
    return along >= 0 && along <= s.len && Math.abs(across) <= s.hw;
  }
  if (dx * dx + dy * dy > s.r1 * s.r1) return false;
  if (s.shape === 'ring') return true;
  let d = Math.atan2(dy, dx) - s.angle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= s.half;
};
// Fighters are the 20x28 rectangles drawn on screen; a hit means any part of one lies in the shape.
const sampleAxis = (half) => Array.from({ length: half + 1 }, (_, i) => i * 2 - half);
const SAMPLE_X = sampleAxis(BODY.hw);
const SAMPLE_Y = sampleAxis(BODY.hh);
export function shapeHitsBody(s, b) {
  for (const sx of SAMPLE_X)
    for (const sy of SAMPLE_Y) if (shapeContains(s, b.x + sx, b.y + sy)) return true;
  return false;
}

const bodiesOverlap = (a, b) =>
  Math.abs(a.x - b.x) < BODY.hw * 2 && Math.abs(a.y - b.y) < BODY.hh * 2;
const clampBody = (b) => {
  b.x = clamp(b.x, ARENA.x0, ARENA.x1);
  b.y = clamp(b.y, ARENA.y0, ARENA.y1);
};

export function separate(p, r) {
  if (!bodiesOverlap(p, r)) return;
  const penX = BODY.hw * 2 - Math.abs(p.x - r.x),
    penY = BODY.hh * 2 - Math.abs(p.y - r.y);
  if (penX <= penY) p.x += (p.x >= r.x ? 1 : -1) * penX;
  else p.y += (p.y >= r.y ? 1 : -1) * penY;
  clampBody(p);
}

// Move a body along a vector but never into the other body.
export function slide(body, other, dx, dy) {
  const keep = { x: body.x, y: body.y };
  body.x += dx;
  clampBody(body);
  if (other && bodiesOverlap(body, other)) body.x = keep.x;
  body.y += dy;
  clampBody(body);
  if (other && bodiesOverlap(body, other)) body.y = keep.y;
}
