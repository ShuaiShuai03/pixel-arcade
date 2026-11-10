import { COLS, ROWS, RULES, TILE, TOP, colX, rowY } from './tether-twins-rules.js';
import { ROOMS } from './tether-twins-rooms.js';

export const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const tileRect = (c, r) => ({ x: c * TILE, y: TOP + r * TILE, w: TILE, h: TILE });
export const overlap = (a, b, g = 0) =>
  a.x < b.x + b.w + g && a.x + a.w > b.x - g && a.y < b.y + b.h + g && a.y + a.h > b.y - g;

// Does segment a-b cross the interior of `r` grown by `g`? (negative g shrinks it)
export function segHitsRect(a, b, r, g = 0) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  // Liang-Barsky clipping against the four sides: [direction, distance to that side].
  const sides = [-dx, dx, -dy, dy];
  const gaps = [a.x - r.x + g, r.x + r.w + g - a.x, a.y - r.y + g, r.y + r.h + g - a.y];
  for (let k = 0; k < 4; k++) {
    if (sides[k] === 0) {
      if (gaps[k] <= 0) return false;
      continue;
    }
    const t = gaps[k] / sides[k];
    if (sides[k] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

// --- Pulse strips: groups 0 ('p') and 1 ('q') flash on a shared cycle, group 1 shifted ---

const phaseOf = (pulse, group, clock) => (clock + (group ? pulse.shift : 0)) % pulse.period;
/** Is the strip of this group live (zapping) at `clock` seconds after the room loaded? */
export const pulseLive = (pulse, group, clock) => phaseOf(pulse, group, clock) < pulse.live;
/** Is the strip about to go live (it flickers for the last stretch of its dark time)? */
export const pulseWarn = (pulse, group, clock) =>
  phaseOf(pulse, group, clock) >= pulse.period - RULES.pulseWarn;
/** Dark long enough, and for long enough yet, that a robot entering now can cross. */
export const pulseGo = (pulse, group, clock) => {
  const u = phaseOf(pulse, group, clock);
  return u >= pulse.live + RULES.pulseGoFrom && u <= pulse.period - pulse.allow;
};
/** Seconds until the group next changes between live and dark. */
export const pulseChange = (pulse, group, clock) => {
  const u = phaseOf(pulse, group, clock);
  return u < pulse.live ? pulse.live - u : pulse.period - u;
};

const worlds = new Map();
// Static, immutable description of one room (walls, posts, hazards, wrap points).
export function worldOf(index) {
  if (worlds.has(index)) return worlds.get(index);
  const room = ROOMS[index];
  const at = (c, r) => room.map[r]?.[c] ?? '#';
  const walls = [],
    hazards = [],
    pegs = [],
    gates = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      if (ch === '#') walls.push(tileRect(c, r));
      else if (ch === 'x') hazards.push({ ...tileRect(c, r), group: -1 });
      else if (ch === 'p' || ch === 'q')
        hazards.push({ ...tileRect(c, r), group: ch === 'q' ? 1 : 0 });
      else if (ch === 'A' || ch === 'B' || ch === 'C') (gates[ch] ||= []).push(tileRect(c, r));
    }
  // A peg is a convex wall corner the cable can wrap.
  for (let j = 1; j < ROWS; j++)
    for (let i = 1; i < COLS; i++) {
      const a = at(i - 1, j - 1) === '#',
        b = at(i, j - 1) === '#',
        c = at(i - 1, j) === '#',
        d = at(i, j) === '#';
      const n = a + b + c + d;
      if (n === 1 || (n === 2 && a === d)) pegs.push({ x: i * TILE, y: TOP + j * TILE, post: -1 });
    }
  // A pit is a thin continuous live ring round a plate tile: a 22 px robot cannot step inside,
  // but the cable can lie across it.
  for (const { c, r } of room.rings) {
    const x = c * TILE,
      y = TOP + r * TILE,
      k = RULES.ring;
    for (const [rx, ry, rw, rh] of [
      [x - k, y - k, TILE + 2 * k, k],
      [x - k, y + TILE, TILE + 2 * k, k],
      [x - k, y, k, TILE],
      [x + TILE, y, k, TILE],
    ])
      hazards.push({ x: rx, y: ry, w: rw, h: rh, group: -1 });
  }
  const posts = [...room.posts, ...room.relays].map((p, index) => {
    const x = colX(p.c),
      y = rowY(p.r),
      h = RULES.post / 2;
    for (let k = 0; k < 4; k++) {
      const dx = k === 1 || k === 2 ? 1 : -1,
        dy = k > 1 ? 1 : -1;
      pegs.push({ x: x + dx * h, y: y + dy * h, post: index });
    }
    return { x: x - h, y: y - h, w: RULES.post, h: RULES.post, cx: x, cy: y, gate: p.gate || null };
  });
  const world = {
    room,
    walls,
    hazards,
    pegs,
    gates,
    posts,
    relayFirst: room.posts.length,
    plates: room.plates.map((p) => ({
      ...p,
      x: colX(p.c) - RULES.plate / 2,
      y: rowY(p.r) - RULES.plate / 2,
      w: RULES.plate,
      h: RULES.plate,
    })),
    pads: [0, 2].map((i) => ({ cx: colX(room.pads[i]), cy: rowY(room.pads[i + 1]) })),
  };
  worlds.set(index, world);
  return world;
}
