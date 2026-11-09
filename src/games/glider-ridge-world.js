import { clamp } from '../shared/utils.js';
import { COURSES } from './glider-ridge-levels.js';
export const PHYSICS = Object.freeze({
  step: 1 / 240,
  gravity: 9.8,
  liftDrag: 0.0235,
  liftSlope: 5,
  criticalAlpha: 0.26,
  maxLift: 1.3,
  stalledLift: 0.62,
  parasiteDrag: 0.05,
  inducedDrag: 0.06,
  trimAlpha: 0.1,
  flareAlpha: 0.235,
  maxBank: 0.85,
  safeSink: 7,
  safeSpeed: 26,
  perfectSink: 1.8,
  perfectSpeed: 19.5,
  attempts: 3,
});
export const P = PHYSICS;
export const STEP = P.step,
  G = P.gravity,
  WALL = 9999,
  MAX_DT = 0.1,
  STALL_DROP = 0.08,
  ELEV_UP = 0.2,
  ELEV_DOWN = 0.1,
  LAUNCH_SPEED = 24,
  HOLD_SECONDS = 2.2,
  MIN_SKIP_SECONDS = 0.8,
  MESSAGE_SECONDS = 2.4,
  FLARE_WINDOW = 14,
  TRIM_ALPHA = 0.144,
  TRIM_SPEED = 24,
  SPEED_STABILITY = 0.006,
  FLARE_LOAD = 1.15,
  FLARE_SINK_BASE = 0.8,
  FLARE_SINK_GAIN = 0.12,
  FLARE_K = 0.05,
  FLARE_LEVEL = 0.3,
  FLARE_HEADING = 0.6,
  REDO_AIM = 0.5,
  REDO_STEER = 0.2,
  DESCEND_GATE_GAP = 250,
  DESCEND_KEEP_GAP = 150,
  DESCEND_MIN_AGL = 90,
  CIRCLE_MIN_AGL = 60,
  FAST_ALPHA_MAX = 0.2,
  FAST_COOLDOWN = 2.5,
  FAST_ON = 27,
  FAST_OFF = 24,
  EDGE_Z = 70,
  EDGE_X = 120,
  EDGE_CLEAR = 40,
  FLARE_CLEAR = 30,
  HINT_STEP = 0.1,
  HINT_DWELL = 0.4,
  STEER_BAND = 0.16,
  STEER_END = 0.06,
  URGENT = ['stall', 'warn', 'edge', 'flare'],
  MISSED_BEHIND = 15,
  BANK_PULL = 0.05,
  GATE_SCORE = 100;
export const PLAN_GLIDE = 8.5,
  PLAN_SPEED = 24,
  WINDOW_MARGIN = 12,
  CLIMB_MARGIN = 15,
  LIFT_NEAR = 30,
  CIRCLE_GAP = 120,
  PATH_CLEAR = 14,
  PATH_HIGH = 30,
  PATH_LOW = -15,
  PATH_AIM = 60,
  PATH_SLOPE = 10,
  TERRAIN_MARGIN = 30,
  DIVE_CLEARANCE = 70;
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
export const toward = (v, target, rate) => v + clamp(target - v, -rate, rate);

export function terrainAt(c, x, z = 0) {
  if (x < c.xmin || x > c.xmax || Math.abs(z) > c.half) return WALL;
  const t = c.terrain;
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, h0] = t[i - 1],
        [x1, h1] = t[i];
      return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}
const zoneWeight = (x, x0, x1, edge = 40) => smooth((x - x0) / edge) * smooth((x1 - x) / edge);
export function windAt(c, x, z, h) {
  const w = { x: 0, z: 0, h: 0 };
  for (const zone of c.wind) {
    const k = zoneWeight(x, zone.x0, zone.x1, 60);
    w.x += zone.wx * k;
    w.z += zone.wz * k;
  }
  for (const r of c.ridges) {
    const agl = h - terrainAt(c, x, 0);
    w.h += r.w * zoneWeight(x, r.x0, r.x1, 30) * clamp(1 - agl / r.depth, 0, 1) ** 2;
  }
  for (const t of c.thermals) {
    const r2 = ((x - t.x) / t.rx) ** 2 + ((z - t.z) / t.rz) ** 2;
    if (r2 < 1 && h < t.top) w.h += t.w * (1 - r2 * r2) * clamp((t.top - h) / 40, 0, 1);
  }
  return w;
}
export const liftCoefficient = (alpha, stalled) => {
  const cl = clamp(P.liftSlope * alpha, -1.5, P.maxLift);
  return stalled ? Math.min(cl, P.stalledLift) : cl;
};
export const speedState = (s) => {
  const c = COURSES[s.course],
    w = windAt(c, s.x, s.z, s.h),
    air = { x: s.vx - w.x, z: s.vz - w.z, h: s.vh - w.h };
  return { c, w, air, speed: Math.hypot(air.x, air.z, air.h) };
};
