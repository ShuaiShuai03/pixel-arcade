// Pest routing: shortest path to the bloom; wary pests pay extra for live-root tiles.
import {
  COLS,
  DIRS,
  RULES,
  ROWS,
  INVADERS,
  isLive,
  isPath,
  reaches,
  rootTilesAt,
  tileAt,
} from './vine-warden-core.js';

function routeField(s, wary) {
  if (!s.routes || s.routes.ver !== s.rootVer) {
    const zone = new Set();
    s.plants
      .filter(isLive)
      .forEach((p) => rootTilesAt(s, p.c, p.r).forEach((t) => zone.add(t.r * COLS + t.c)));
    s.routes = { ver: s.rootVer, zone, fields: {} };
  }
  const key = wary ? 'wary' : 'plain';
  if (!s.routes.fields[key]) {
    const cost = (c, r) => 1 + (wary && s.routes.zone.has(r * COLS + c) ? RULES.avoidCost : 0);
    const dist = new Array(COLS * ROWS).fill(Infinity);
    dist[s.heart.r * COLS + s.heart.c] = 0;
    const queue = [s.heart];
    for (let head = 0; head < queue.length; head++) {
      const { c, r } = queue[head];
      for (const [dx, dy] of DIRS) {
        const nc = c + dx;
        const nr = r + dy;
        if (!isPath(tileAt(s, nc, nr))) continue;
        const d = dist[r * COLS + c] + cost(c, r);
        if (d < dist[nr * COLS + nc]) {
          dist[nr * COLS + nc] = d;
          queue.push({ c: nc, r: nr });
        }
      }
    }
    s.routes.fields[key] = { dist, cost };
  }
  return s.routes.fields[key];
}

export function nextStep(s, v) {
  const wary = INVADERS[v.kind].wary;
  const plain = routeField(s, false);
  const { dist, cost } = routeField(s, wary);
  // Ties between two rooted lanes alternate by weevil id, so one lane cannot hoard every weevil.
  const order = wary && v.id % 2 ? [...DIRS].reverse() : DIRS;
  let best = null;
  for (const allowBack of [false, true]) {
    for (const [dx, dy] of order) {
      const c = v.c + dx;
      const r = v.r + dy;
      const at = r * COLS + c;
      if (!isPath(tileAt(s, c, r)) || dist[at] === Infinity) continue;
      if (!allowBack && v.prev && v.prev.c === c && v.prev.r === r) continue;
      const total = Math.min(cost(c, r) + dist[at], 1 + plain.dist[at] + RULES.avoidCap);
      if (!best || total < best.total) best = { c, r, total };
    }
    if (best) return best;
  }
  return null;
}

export const claims = (u, c, r) =>
  (u.c === c && u.r === r) || (u.left > 0 && u.tc === c && u.tr === r);

// The tiles a pest will cross on its way to the bloom, following its own routing rule.
export function pestRoute(s, v) {
  if (v.rc && v.rc.ver === s.rootVer && v.rc.c === v.c && v.rc.r === v.r) return v.rc.route;
  const route = [];
  let at = { id: v.id, kind: v.kind, c: v.c, r: v.r, prev: v.prev };
  for (let n = 0; n < COLS * ROWS; n++) {
    const step = nextStep(s, at);
    if (!step) break;
    route.push({ c: step.c, r: step.r });
    if (tileAt(s, step.c, step.r) === 'h') break;
    at = { ...at, c: step.c, r: step.r, prev: { c: at.c, r: at.r } };
  }
  v.rc = { ver: s.rootVer, c: v.c, r: v.r, route };
  return route;
}
const covered = (s, t) => s.plants.some((p) => p.charges > 0 && reaches(p, t.c, t.r));
export const isBare = (s, v) => !pestRoute(s, v).some((t) => covered(s, t));
