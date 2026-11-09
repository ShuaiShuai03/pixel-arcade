// Torus geometry shared by the Meteor Drift modules: the field wraps on both axes.
export const WIDTH = 480;
export const HEIGHT = 320;

export const wrap = (v, max) => ((v % max) + max) % max;
/** Shortest signed offset on a wrapped axis. */
export const delta = (value, span) => wrap(value + span / 2, span) - span / 2;
export function torusDistance(a, b) {
  return Math.hypot(delta(a.x - b.x, WIDTH), delta(a.y - b.y, HEIGHT));
}
