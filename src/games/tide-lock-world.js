import { clamp } from '../shared/utils.js';
import { LEVEL_DEFS, SOLUTIONS } from './tide-lock-levels.js';

// Rules are exported read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 1 / 30,
  valveK: 0.3, // flow = valveK * area * sqrt(head) in m3/s
  gateArea: 3,
  pumpRate: 0.7,
  pumpDraw: 1,
  tol: 0.3, // a gate opens when both sides are level within this many metres
  settle: 0.04,
  boatSpeed: 40,
  gateOpenTime: 0.6,
  gateIdle: 1.6,
  groundGrace: 3,
  lives: 3,
  winHold: 0.8,
  clearHold: 2.2,
  planDt: 0.1,
  planNodes: 60000,
  searchIdleTicks: 180,
  searchTicks: 2, // ticks between search slices
  searchChunk: 600, // nodes searched, at most, per search slice
  searchWork: 4000, // simulation steps, at most, per search slice (a few ms)
  searchNoteSlices: 480, // slices (8 s) after which the prompt admits it has no hint yet
  searchOfferSlices: 1680, // slices (28 s) after which it offers the reset as the next move
  searchCapSlices: 6000, // slices (100 s) after which the search rests until the player acts
  stallTicks: 3000, // a plan that has not moved for this long (25 s) is replanned
  waitCap: 45, // the longest wait a plan may count on, in seconds
  idleTicks: 96,
  retryTicks: 180,
  planHorizon: 6,
  planMargin: 0.1, // spare depth the planner asks for, so a late hand still floats the boat
  searchWeight: 8,
  crossEstimate: 3,
  levelEstimate: 5,
  wastePenalty: 15,
  actionCost: 4,
  lag: 2,
  quickLag: 0.25, // and the quickest hand a player has, tried last
  hurryLag: 0.6, // the delay assumed when asking whether a lock is truly hopeless // dead time the planner grants a player for every action
  thinkTicks: 12,
  promptHold: 0.5,
  introTime: 5,
  msgTime: 3,
  scoreClear: 100,
  scoreHull: 50,
  scorePar: 2,
  menuCols: 6,
  resetArmTicks: 360,
  freshTime: 3,
});
export const R = RULES;
export const STEP = R.step;
export const TWO_PI = Math.PI * 2;
export const PX = 30; // pixels per metre
export const GROUND = 238; // canvas y of the canal floor
export const GAP = 12; // wall thickness in pixels

// --- Compiled levels ----------------------------------------------------------------------------

export function compileLevel(def, index) {
  const nodes = def.nodes.map((n, id) => ({
    id,
    sea: n.k === 'sea',
    name: n.name,
    a: n.k === 'sea' ? Infinity : n.a,
    fl: n.fl ?? 0,
    top: n.top ?? 5.4,
    cap: n.cap ?? 9,
    h0: n.k === 'sea' ? n.mid + n.amp * Math.sin(TWO_PI * n.phase) : n.h,
    mid: n.mid,
    amp: n.amp ?? 0,
    period: n.period ?? 60,
    phase: n.phase ?? 0,
    x: 0,
    w: 0,
  }));
  const raw = nodes.map((n) => (n.sea ? 56 : Math.round(30 + 26 * Math.sqrt(n.a))));
  const total = raw.reduce((a, v) => a + v, 0) + GAP * (nodes.length - 1);
  const scale = Math.min(1, 452 / total);
  let x = Math.round((480 - total * scale) / 2);
  nodes.forEach((n, i) => {
    n.w = Math.round(raw[i] * scale);
    n.x = x;
    x += n.w + GAP;
  });
  const wallX = (a, b) => {
    const lo = Math.min(a, b);
    return nodes[lo].x + nodes[lo].w + GAP / 2;
  };
  const valves = def.valves
    .map((v, i) => {
      const b = v.b === 'drain' ? -1 : v.b;
      const centre = (n) => nodes[n].x + nodes[n].w / 2;
      const vx =
        b < 0
          ? centre(v.a)
          : Math.abs(v.a - b) === 1
            ? wallX(v.a, b)
            : (centre(v.a) + centre(b)) / 2;
      // An opening cannot sit below the bed of the chambers it joins.
      const sill = Math.max(v.sill ?? 0, nodes[v.a].fl, b >= 0 ? nodes[b].fl : 0);
      return { ...v, sill, b, x: Math.round(vx), order: i, pump: Boolean(v.pump) };
    })
    .sort((p, q) => p.x - q.x || p.order - q.order);
  let vn = 0;
  let pn = 0;
  valves.forEach((v, id) => {
    v.id = id;
    v.label = v.pump ? `P${++pn}` : `V${++vn}`;
  });
  const gates = def.gates
    .map(([a, b]) => ({ a, b, x: wallX(a, b), sill: Math.max(nodes[a].fl, nodes[b].fl) }))
    .sort((p, q) => p.x - q.x);
  gates.forEach((g, id) => {
    g.id = id;
    g.label = `G${id + 1}`;
  });
  const boats = def.boats.map((b, id) => {
    const dir = Math.sign(b.to - b.from);
    const route = [];
    for (let n = b.from; n !== b.to; n += dir) {
      const j = gates.findIndex(
        (g) => g.a === Math.min(n, n + dir) && g.b === Math.max(n, n + dir),
      );
      if (j < 0) throw new Error(`level ${index + 1}: boat ${id} has no gate at ${n}`);
      route.push(j);
    }
    return { ...b, id, route };
  });
  // A boat parks at a slot inside its chamber; boats that share a chamber stand side by side.
  const visits = nodes.map((n) => boats.filter((b) => (b.from - n.id) * (b.to - n.id) <= 0));
  nodes.forEach((n) => {
    n.visits = visits[n.id].map((b) => b.id);
  });
  return {
    index,
    name: def.name,
    tip: def.tip,
    par: def.par,
    margin: def.margin ?? R.planMargin,
    warn: def.warn || null,
    nodes,
    valves,
    gates,
    boats,
    inflow: def.inflow || null,
    energy: def.energy || 0,
    tidal: nodes.some((n) => n.sea && n.amp > 0),
  };
}

export const slotX = (c, node, boat) => {
  const n = c.nodes[node];
  const at = n.visits.indexOf(boat);
  const count = n.visits.length;
  // boats sharing a chamber stand side by side, squeezed so none overhangs the walls
  const gap = count > 1 ? Math.min(26, (n.w - 30) / (count - 1)) : 0;
  return Math.round(n.x + n.w / 2 + (at - (count - 1) / 2) * gap);
};

export function decodeSteps(rows = []) {
  return rows.map(([kind, a, b]) => {
    if (kind === 'v') return { t: 'v', k: a, on: Boolean(b) };
    if (kind === 'g') return { t: 'g', j: a };
    if (kind === 'x') return { t: 'g', j: a, close: true };
    if (kind === 'w') return { t: 'w', ev: { bit: a, value: Boolean(b) }, time: 0 };
    return { t: 'w', ev: null, time: a };
  });
}

export function encodeSteps(steps) {
  return steps.map((s) => {
    if (s.t === 'v') return ['v', s.k, s.on ? 1 : 0];
    if (s.t === 'g') return [s.close ? 'x' : 'g', s.j];
    return s.ev ? ['w', s.ev.bit, s.ev.value ? 1 : 0] : ['t', Math.round(s.time * 10) / 10];
  });
}

export const LEVELS = LEVEL_DEFS.map((def, i) => ({
  ...compileLevel(def, i),
  solution: decodeSteps(SOLUTIONS[i]),
}));
export const LEVEL_COUNT = LEVELS.length;

// --- Water and boats (pure) ---------------------------------------------------------------------

export function newWorld(c) {
  return {
    c,
    time: 0,
    vol: c.nodes.map((n) => (n.sea ? 0 : n.a * (n.h0 - n.fl))),
    vopen: c.valves.map(() => false),
    gates: c.gates.map(() => ({ open: false, busy: -1, idle: 0, p: 0 })),
    boats: c.boats.map((b) => ({
      node: b.from,
      x: slotX(c, b.from, b.id),
      step: 0,
      cross: null,
      docked: b.from === b.to,
      ground: 0,
    })),
    energy: c.energy,
    led: { sea: 0, river: 0, lost: 0, spilled: 0, out: 0 },
    flows: c.valves.map(() => 0),
    spilling: c.nodes.map(() => false),
    hit: false,
    margin: 0,
    tolerant: false,
    lag: R.lag,
    lv: c.nodes.map(() => 0),
    lvOk: false,
  };
}

export function cloneWorld(w) {
  return {
    c: w.c,
    time: w.time,
    vol: w.vol.slice(),
    vopen: w.vopen.slice(),
    gates: w.gates.map((g) => ({ ...g })),
    boats: w.boats.map((b) => ({ ...b, cross: b.cross ? { ...b.cross } : null })),
    energy: w.energy,
    led: { ...w.led },
    flows: w.flows.slice(),
    spilling: w.spilling.slice(),
    hit: w.hit,
    margin: w.margin,
    tolerant: w.tolerant,
    lag: w.lag,
    lv: w.lv.slice(),
    lvOk: w.lvOk,
  };
}

// A world packed into one flat array of numbers, for the many worlds a search keeps waiting: about a
// third of the memory of the object form, and one object for the collector instead of a dozen.
// `unpackWorld(c, packWorld(w))` gives back exactly `cloneWorld(w)`.
const GATE_FIELDS = 4;
const BOAT_FIELDS = 9;
const LED_KEYS = ['sea', 'river', 'lost', 'spilled', 'out'];
const packSize = (c) =>
  8 +
  LED_KEYS.length +
  c.nodes.length * 3 +
  c.valves.length * 2 +
  c.gates.length * GATE_FIELDS +
  c.boats.length * BOAT_FIELDS;

export function packWorld(w) {
  const out = new Float64Array(packSize(w.c));
  let i = 0;
  const put = (v) => (out[i++] = Number(v));
  [w.time, w.energy, w.hit, w.margin, w.tolerant, w.lag, w.lvOk].forEach(put);
  LED_KEYS.forEach((k) => put(w.led[k]));
  for (const list of [w.vol, w.spilling, w.lv, w.vopen, w.flows]) list.forEach(put);
  w.gates.forEach((g) => [g.open, g.busy, g.idle, g.p].forEach(put));
  for (const b of w.boats) {
    const cross = b.cross ?? { g: 0, to: 0, phase: 0 };
    [b.node, b.x, b.step, b.docked, b.ground, b.cross !== null].forEach(put);
    [cross.g, cross.to, cross.phase].forEach(put);
  }
  put(out.length); // a check word: the layout read back must end here
  return out;
}

export function unpackWorld(c, buf) {
  let i = 0;
  const num = () => buf[i++];
  const bool = () => buf[i++] !== 0;
  const w = { c, time: num(), energy: num(), hit: bool(), margin: num(), tolerant: bool() };
  w.lag = num();
  const lvOk = bool();
  w.led = {};
  for (const k of LED_KEYS) w.led[k] = num();
  w.vol = c.nodes.map(num);
  w.spilling = c.nodes.map(bool);
  w.lv = c.nodes.map(num);
  w.vopen = c.valves.map(bool);
  w.flows = c.valves.map(num);
  w.gates = c.gates.map(() => ({ open: bool(), busy: num(), idle: num(), p: num() }));
  w.boats = c.boats.map(() => {
    const b = { node: num(), x: num(), step: num(), docked: bool(), ground: num() };
    const crossing = bool();
    const cross = { g: num(), to: num(), phase: num() };
    return { ...b, cross: crossing ? cross : null };
  });
  w.lvOk = lvOk;
  if (num() !== buf.length) throw new Error('Tide Lock: a packed world does not match its lock');
  return w;
}

// Water levels are cached on the world and recomputed lazily after any change to the water or the
// clock (`lvOk` false), so the many level reads in a planner step cost one pass.
export function levelOf(w, i) {
  if (!w.lvOk) {
    w.c.nodes.forEach((n, k) => {
      w.lv[k] = n.sea
        ? n.mid + n.amp * Math.sin(TWO_PI * (w.time / n.period + n.phase))
        : n.fl + w.vol[k] / n.a;
    });
    w.lvOk = true;
  }
  return w.lv[i];
}
export const depthOf = (w, i) => levelOf(w, i) - w.c.nodes[i].fl;

// Total water held in the chambers, in m3.
export const totalVolume = (w) => w.vol.reduce((a, v) => a + v, 0);
// Zero when volume is conserved: what the chambers hold changed only by the recorded flows.
export const volumeError = (w, v0) =>
  totalVolume(w) - v0 - (w.led.sea + w.led.river - w.led.lost - w.led.spilled);

export function give(w, from, to, dv) {
  w.lvOk = false;
  if (from >= 0 && !w.c.nodes[from].sea) w.vol[from] -= dv;
  else if (from >= 0) w.led.sea += dv;
  if (to < 0) w.led.lost += dv;
  else if (!w.c.nodes[to].sea) w.vol[to] += dv;
  else w.led.sea -= dv;
  if (to < 0 || (to >= 0 && w.c.nodes[to].sea)) w.led.out += dv;
}

// Moves water between two nodes through an opening whose sill is `sill`. The flow is
// coef * sqrt(head), never uphill, and never more than it takes to level the two sides.
export function exchange(w, a, b, coef, sill, dt) {
  const la = Math.max(levelOf(w, a), sill);
  const lb = b < 0 ? sill : Math.max(levelOf(w, b), sill);
  const head = la - lb;
  if (Math.abs(head) < 1e-12) return 0;
  const area = (n) => (n < 0 ? Infinity : w.c.nodes[n].a);
  const eff = 1 / (1 / area(a) + 1 / area(b));
  const dv = Math.min(coef * Math.sqrt(Math.abs(head)) * dt, Math.abs(head) * eff);
  if (head > 0) give(w, a, b, dv);
  else give(w, b, a, dv);
  return Math.sign(head) * dv;
}

export const headOf = (w, a, b, sill) =>
  Math.max(levelOf(w, a), sill) - (b < 0 ? sill : Math.max(levelOf(w, b), sill));

export const gateLevel = (w, j) => {
  const g = w.c.gates[j];
  return Math.abs(levelOf(w, g.a) - levelOf(w, g.b)) <= R.tol;
};
export const occupancy = (w, node, self) =>
  w.boats.filter((b, k) => k !== self && (b.cross ? b.cross.to === node : b.node === node)).length;

// A boat wants a gate while it could sail through it: the water is level, deep enough, and there
// is room in the chamber beyond. A gate nobody can use closes again by itself.
export const gateWants = (w, j) =>
  w.c.boats.some((cb, k) => {
    const b = w.boats[k];
    if (b.docked || b.cross || cb.route[b.step] !== j) return false;
    const g = w.c.gates[j];
    const to = b.node === g.a ? g.b : g.a;
    const d = w.c.boats[k].d;
    return (
      occupancy(w, to, k) < w.c.nodes[to].cap &&
      gateLevel(w, j) &&
      depthOf(w, g.a) >= d - 1e-9 &&
      depthOf(w, g.b) >= d - 1e-9
    );
  });

export function canPass(w, j, k) {
  const g = w.c.gates[j];
  const d = w.c.boats[k].d;
  return (
    w.gates[j].p >= 1 &&
    gateLevel(w, j) &&
    depthOf(w, g.a) >= d + w.margin - 1e-9 &&
    depthOf(w, g.b) >= d + w.margin - 1e-9
  );
}

export function moveBoats(w, dt) {
  const c = w.c;
  c.boats.forEach((cb, k) => {
    const b = w.boats[k];
    if (b.docked) return;
    if (!b.cross) {
      const j = cb.route[b.step];
      const gate = w.gates[j];
      const g = c.gates[j];
      const to = b.node === g.a ? g.b : g.a;
      if (gate.open && gate.busy < 0 && canPass(w, j, k) && occupancy(w, to, k) < c.nodes[to].cap) {
        gate.busy = k;
        b.cross = { g: j, to, phase: 0 };
      }
      return;
    }
    const target = b.cross.phase ? slotX(c, b.cross.to, k) : c.gates[b.cross.g].x;
    const dx = target - b.x;
    const move = R.boatSpeed * dt;
    if (Math.abs(dx) > move) {
      b.x += Math.sign(dx) * move;
      return;
    }
    b.x = target;
    if (!b.cross.phase) {
      b.cross.phase = 1;
      return;
    }
    const gate = w.gates[b.cross.g];
    gate.busy = -1;
    gate.idle = 0;
    b.node = b.cross.to;
    b.cross = null;
    b.step++;
    if (b.node === cb.to) b.docked = true;
  });
}

export function stepWorld(w, dt) {
  const c = w.c;
  c.valves.forEach((v, k) => {
    w.flows[k] = 0;
    if (!w.vopen[k]) return;
    if (!v.pump) {
      w.flows[k] = exchange(w, v.a, v.b, R.valveK * v.area, v.sill, dt) / dt;
      return;
    }
    const avail = Math.max(0, w.vol[v.a] - 0.02 * c.nodes[v.a].a);
    const dv = Math.min(R.pumpRate * dt, avail);
    give(w, v.a, v.b, dv);
    w.flows[k] = dv / dt;
    w.energy = Math.max(0, w.energy - R.pumpDraw * dt);
    if (w.energy <= 0) w.vopen[k] = false;
  });
  c.gates.forEach((g, j) => {
    const gs = w.gates[j];
    gs.p = clamp(gs.p + (gs.open ? dt : -dt) / R.gateOpenTime, 0, 1);
    if (gs.open) exchange(w, g.a, g.b, R.valveK * R.gateArea, g.sill, dt);
  });
  if (c.inflow) {
    w.lvOk = false;
    w.vol[c.inflow.node] += c.inflow.rate * dt;
    w.led.river += c.inflow.rate * dt;
  }
  c.nodes.forEach((n, i) => {
    w.spilling[i] = false;
    if (n.sea) return;
    const cap = n.a * (n.top - n.fl);
    if (w.vol[i] > cap) {
      w.lvOk = false;
      w.led.spilled += w.vol[i] - cap;
      w.vol[i] = cap;
      w.spilling[i] = true;
    }
  });
  moveBoats(w, dt);
  c.gates.forEach((g, j) => {
    const gs = w.gates[j];
    if (!gs.open || gs.busy >= 0) return;
    gs.idle = gateWants(w, j) ? 0 : gs.idle + dt;
    if (gs.idle >= R.gateIdle) gs.open = false;
  });
  c.boats.forEach((cb, k) => {
    const b = w.boats[k];
    if (b.docked) return;
    const nodes = b.cross ? [c.gates[b.cross.g].a, c.gates[b.cross.g].b] : [b.node];
    const shallow = nodes.some((n) => depthOf(w, n) < cb.d - 1e-9);
    b.ground = shallow ? b.ground + dt : 0;
    if (b.ground >= R.groundGrace) w.hit = true;
  });
  w.time += dt;
  w.lvOk = false;
}

export const allDocked = (w) => w.boats.every((b) => b.docked);

// --- Player actions -----------------------------------------------------------------------------

export function toggleValve(w, k) {
  const v = w.c.valves[k];
  if (!w.vopen[k] && v.pump && w.energy <= 0) return 'empty';
  w.vopen[k] = !w.vopen[k];
  return w.vopen[k] ? 'open' : 'closed';
}

export function toggleGate(w, j) {
  const gs = w.gates[j];
  if (gs.open) {
    if (gs.busy >= 0) return 'busy';
    gs.open = false;
    return 'closed';
  }
  if (!gateLevel(w, j)) return 'uneven';
  gs.open = true;
  gs.idle = 0;
  return 'open';
}
