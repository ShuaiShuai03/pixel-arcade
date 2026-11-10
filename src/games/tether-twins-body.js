import { HALF, RULES } from './tether-twins-rules.js';

export const robotRect = (r) => ({ x: r.x - HALF, y: r.y - HALF, w: RULES.robot, h: RULES.robot });

/** The cable as a polyline: red robot, the pegs it is wrapped round, blue robot. */
export const pointsOf = (s, w) => [
  { x: s.robots[0].x, y: s.robots[0].y },
  ...s.bends.map((i) => w.pegs[i]),
  { x: s.robots[1].x, y: s.robots[1].y },
];

export const lengthOf = (pts) => {
  let sum = 0;
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
};

// A locked relay sinks into the floor: it stops being a solid post or a wrap point.
export const retracted = (s, w, i) => i >= w.relayFirst && !!s.latched[w.posts[i].gate];

export const solidsOf = (s, w, withGates = true) => {
  const list = [...w.walls, ...w.posts.filter((_, i) => !retracted(s, w, i))];
  if (withGates)
    for (const [id, cells] of Object.entries(w.gates)) if (!s.open[id]) list.push(...cells);
  return list;
};

export const onPad = (r, pad) =>
  Math.abs(r.x - pad.cx) <= RULES.padReach && Math.abs(r.y - pad.cy) <= RULES.padReach;
