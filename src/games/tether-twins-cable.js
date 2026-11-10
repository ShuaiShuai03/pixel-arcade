import { EPS, SIDE_EPS } from './tether-twins-rules.js';
import { cross, overlap, segHitsRect } from './tether-twins-world.js';
import { pointsOf, retracted } from './tether-twins-body.js';

const boxOf = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

// Is the straight line a-b blocked by a solid (grown a hair so a tangent line still counts)?
function lineBlocked(a, b, solids, grow = 0.01) {
  const box = boxOf(a, b);
  return solids.some((r) => overlap(box, r, 0.5) && segHitsRect(a, b, r, grow));
}

// Cable: wraps convex wall/post corners, releases them when it can run straight.
export function updateCable(s, w, old, solids) {
  const freed = new Set();
  for (let again = true; again;) {
    again = false;
    const pts = pointsOf(s, w);
    for (let k = 0; k < s.bends.length; k++) {
      const a = pts[k],
        g = pts[k + 1],
        b = pts[k + 2];
      if (s.sides[k] * cross(g.x - a.x, g.y - a.y, b.x - g.x, b.y - g.y) <= EPS) {
        freed.add(s.bends[k]);
        s.bends.splice(k, 1);
        s.sides.splice(k, 1);
        again = true;
        break;
      }
    }
  }
  for (let guard = 0; guard < 8; guard++) {
    const pts = pointsOf(s, w);
    const before = [old[0], ...pts.slice(1, -1), old[1]];
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i],
        q1 = pts[i + 1],
        p0 = before[i],
        q0 = before[i + 1];
      const len2 = (q1.x - p1.x) ** 2 + (q1.y - p1.y) ** 2;
      if (len2 < EPS || (p0 === p1 && q0 === q1)) continue;
      for (let j = 0; j < w.pegs.length; j++) {
        const g = w.pegs[j];
        if (freed.has(j) || j === s.bends[i - 1] || j === s.bends[i]) continue;
        if (g.post >= 0 && retracted(s, w, g.post)) continue;
        const so = cross(q0.x - p0.x, q0.y - p0.y, g.x - p0.x, g.y - p0.y);
        const sn = cross(q1.x - p1.x, q1.y - p1.y, g.x - p1.x, g.y - p1.y);
        // |so| below the noise floor means the peg already lay on the old segment: not a crossing.
        if (!((so > SIDE_EPS && sn <= 0) || (so < -SIDE_EPS && sn >= 0))) continue;
        const t = ((g.x - p1.x) * (q1.x - p1.x) + (g.y - p1.y) * (q1.y - p1.y)) / len2;
        if (t <= 0 || t >= 1) continue;
        // Only a segment pushed INTO a solid needs a bend: a clear line needs none, and one already
        // inside (within tolerance) is leaving the wall, not being caught by the corner.
        if (!lineBlocked(p1, q1, solids) || lineBlocked(p0, q0, solids, -0.3)) continue;
        const frac = Math.abs(so) / (Math.abs(so) + Math.abs(sn));
        if (!best || frac < best.frac) best = { i, j, frac, side: so > 0 ? 1 : -1 };
      }
    }
    if (!best) return;
    s.bends.splice(best.i, 0, best.j);
    s.sides.splice(best.i, 0, best.side);
  }
}

export function cableClear(pts, solids) {
  for (let i = 1; i < pts.length; i++) {
    const box = boxOf(pts[i - 1], pts[i]);
    for (const r of solids)
      if (overlap(box, r) && segHitsRect(pts[i - 1], pts[i], r, -0.5)) return false;
  }
  return true;
}
