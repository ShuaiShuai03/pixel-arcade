// Grid geometry, movement, line of sight and weapon reach shared by every chamber.
export const HALF = 8;
export const TILE = 20;
export const COLS = 22;
export const ROWS = 14;
// Spike plates cycle safe, warning, active; the warning is long enough to read and step away.
export const SPIKE = { safe: 1.4, warn: 1, active: 0.6 };
export const SPIKE_PERIOD = SPIKE.safe + SPIKE.warn + SPIKE.active;
export const pos = (x, y) => ({ x: 30 + x * TILE, y: 40 + y * TILE });
export const cellAt = (x, y) => [Math.floor((x - 20) / TILE), Math.floor((y - 30) / TILE)];
export const solid = (s, cx, cy) => s.tiles[cy]?.[cx] !== 0;

export function blocked(s, x, y, r = HALF) {
  for (const dx of [-r + 0.001, r - 0.001])
    for (const dy of [-r + 0.001, r - 0.001]) {
      const [cx, cy] = cellAt(x + dx, y + dy);
      if (solid(s, cx, cy)) return true;
    }
  return false;
}
export function sight(s, ax, ay, bx, by) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
  for (let n = 1; n < steps; n++)
    if (blocked(s, ax + ((bx - ax) * n) / steps, ay + ((by - ay) * n) / steps, 0)) return false;
  return true;
}
/** Sweep each footprint axis against every tile crossed, then slide along walls. */
export function moveBody(s, a, dx, dy) {
  let next = a.x + dx;
  const ymin = Math.floor((a.y - HALF + 0.001 - 30) / TILE),
    ymax = Math.floor((a.y + HALF - 0.001 - 30) / TILE);
  for (let cy = ymin; cy <= ymax; cy++)
    for (
      let cx = Math.floor((Math.min(a.x, next) - HALF - 20) / TILE);
      cx <= Math.floor((Math.max(a.x, next) + HALF - 20) / TILE);
      cx++
    )
      if (solid(s, cx, cy)) {
        const left = 20 + cx * TILE,
          right = left + TILE;
        if (dx > 0 && a.x + HALF <= left + 0.001 && next + HALF > left) {
          next = Math.min(next, left - HALF);
          a.vx = Math.min(a.vx || 0, 0);
        }
        if (dx < 0 && a.x - HALF >= right - 0.001 && next - HALF < right) {
          next = Math.max(next, right + HALF);
          a.vx = Math.max(a.vx || 0, 0);
        }
      }
  a.x = next;
  next = a.y + dy;
  const xmin = Math.floor((a.x - HALF + 0.001 - 20) / TILE),
    xmax = Math.floor((a.x + HALF - 0.001 - 20) / TILE);
  for (let cx = xmin; cx <= xmax; cx++)
    for (
      let cy = Math.floor((Math.min(a.y, next) - HALF - 30) / TILE);
      cy <= Math.floor((Math.max(a.y, next) + HALF - 30) / TILE);
      cy++
    )
      if (solid(s, cx, cy)) {
        const top = 30 + cy * TILE,
          bottom = top + TILE;
        if (dy > 0 && a.y + HALF <= top + 0.001 && next + HALF > top) {
          next = Math.min(next, top - HALF);
          a.vy = Math.min(a.vy || 0, 0);
        }
        if (dy < 0 && a.y - HALF >= bottom - 0.001 && next - HALF < bottom) {
          next = Math.max(next, bottom + HALF);
          a.vy = Math.max(a.vy || 0, 0);
        }
      }
  a.y = next;
}
export function driveBody(s, a, tx, ty, acceleration, dt) {
  a.vx ??= 0;
  a.vy ??= 0;
  const dx = tx - a.vx,
    dy = ty - a.vy,
    d = Math.hypot(dx, dy),
    scale = d ? Math.min(1, (acceleration * dt) / d) : 0;
  const vx = a.vx,
    vy = a.vy;
  a.vx += dx * scale;
  a.vy += dy * scale;
  moveBody(s, a, (vx + a.vx) * 0.5 * dt, (vy + a.vy) * 0.5 * dt);
}
const massOf = (a) => (a.type === 'warden' ? 3 : 1);
/** Push two overlapping bodies apart along the shallower axis, heavier bodies yielding less. */
export function separate(s, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ox = 16 - Math.abs(dx),
    oy = 16 - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return;
  const nx = ox < oy ? (dx >= 0 ? 1 : -1) : 0,
    ny = ox < oy ? 0 : dy >= 0 ? 1 : -1,
    depth = Math.min(ox, oy),
    am = massOf(a),
    bm = massOf(b);
  moveBody(s, a, (-nx * depth * bm) / (am + bm), (-ny * depth * bm) / (am + bm));
  moveBody(s, b, (nx * depth * am) / (am + bm), (ny * depth * am) / (am + bm));
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    const j = -vn / (1 / am + 1 / bm);
    a.vx -= (j * nx) / am;
    a.vy -= (j * ny) / am;
    b.vx += (j * nx) / bm;
    b.vy += (j * ny) / bm;
  }
}
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** Breadth-first walking distance from the player's cell over open tiles. */
export function pathField(s) {
  const [cx, cy] = cellAt(s.player.x, s.player.y),
    d = Array.from({ length: ROWS }, () => Array(COLS).fill(1000));
  if (!d[cy] || cx < 0 || cx >= COLS) return d;
  d[cy][cx] = 0;
  const q = [[cx, cy]];
  for (let k = 0; k < q.length; k++) {
    const [x, y] = q[k];
    for (const [ox, oy] of NEIGHBOURS)
      if (!solid(s, x + ox, y + oy) && d[y + oy][x + ox] > d[y][x] + 1) {
        d[y + oy][x + ox] = d[y][x] + 1;
        q.push([x + ox, y + oy]);
      }
  }
  return d;
}
/** The open neighbour cell with the lowest walking distance, as a point to steer toward. */
export function downhill(s, x, y) {
  const [cx, cy] = cellAt(x, y);
  let lowest = s.path[cy]?.[cx] ?? 1000,
    target = s.player;
  for (const [ox, oy] of NEIGHBOURS) {
    const d = s.path[cy + oy]?.[cx + ox] ?? 1000;
    if (d < lowest) {
      lowest = d;
      target = pos(cx + ox, cy + oy);
    }
  }
  return target;
}
export function rayBox(x, y, dx, dy, left, top, right, bottom) {
  let t0 = 0,
    t1 = 1;
  for (const [p, v, lo, hi] of [
    [x, dx, left, right],
    [y, dy, top, bottom],
  ]) {
    if (Math.abs(v) < 1e-12) {
      if (p < lo || p > hi) return Infinity;
    } else {
      const a = (lo - p) / v,
        b = (hi - p) / v;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}
/** Both the drawn blade and its damage use this wall-clipped segment. */
export function weaponSegment(s, actor, angle, length) {
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  let reach = length;
  for (let d = 8; d <= length; d += 1)
    if (blocked(s, actor.x + dx * d, actor.y + dy * d, 2)) {
      reach = Math.max(8, d - 1);
      break;
    }
  return {
    ax: actor.x + dx * 8,
    ay: actor.y + dy * 8,
    bx: actor.x + dx * reach,
    by: actor.y + dy * reach,
    r: 2,
  };
}
export function bladeHits(blade, target) {
  return (
    rayBox(
      blade.ax,
      blade.ay,
      blade.bx - blade.ax,
      blade.by - blade.ay,
      target.x - HALF - blade.r,
      target.y - HALF - blade.r,
      target.x + HALF + blade.r,
      target.y + HALF + blade.r,
    ) <= 1
  );
}
