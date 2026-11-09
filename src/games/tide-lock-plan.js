import {
  R,
  allDocked,
  cloneWorld,
  depthOf,
  gateLevel,
  headOf,
  levelOf,
  packWorld,
  stepWorld,
  toggleGate,
  toggleValve,
  unpackWorld,
} from './tide-lock-world.js';

// --- Planner --------------------------------------------------------------------------------------
// A search over macro-moves (toggle a valve, open a gate, wait for the next event) on a coarse copy of the
// same water model. It is the source of the prompt and of the solvability proofs in the tests.

// A bit mask of everything a player could be waiting for.
export function features(w) {
  const c = w.c;
  let f = 0;
  let bit = 1;
  const add = (cond) => {
    if (cond) f |= bit;
    bit <<= 1;
  };
  c.gates.forEach((g, j) => add(gateLevel(w, j)));
  c.boats.forEach((cb, k) => {
    const b = w.boats[k];
    add(b.docked);
    add(Boolean(b.cross));
    add(!b.docked && depthOf(w, b.node) >= cb.d + w.margin - 1e-9);
  });
  c.valves.forEach((v, k) =>
    add(!v.pump && w.vopen[k] && Math.abs(headOf(w, v.a, v.b, v.sill)) < R.settle),
  );
  return f;
}

export const progressOf = (w) => w.boats.reduce((a, b) => a + b.step * 2 + (b.cross ? 1 : 0), 0);
// (a hurried search accepts a boat on the bottom: the plan may cost a hull, it is still a plan)
export const aground = (w) =>
  !w.tolerant && w.boats.some((b) => !b.docked && b.ground > R.groundGrace - 0.6);

export function signature(w, last) {
  let key = w.c.tidal ? `${Math.round(w.time)}|` : '|';
  w.c.nodes.forEach((n, i) => {
    if (!n.sea) key += `${Math.round(levelOf(w, i) * 7)},`;
  });
  key += w.vopen.map(Number).join('') + w.gates.map((g) => (g.open ? 1 : 0)).join('');
  for (const b of w.boats) key += `|${b.node}${b.cross ? 'x' : ''}${b.docked ? 'd' : ''}`;
  return `${key}${Math.round(w.energy)}:${last}`;
}

// simulation steps taken so far: a search slice is limited by the work it does, not by nodes
let work = 0;
export const workDone = () => work;

export function runUntil(w, stop, cap) {
  const f0 = features(w);
  let t = 0;
  while (t < cap - 1e-9) {
    work++;
    stepWorld(w, R.planDt);
    t += R.planDt;
    if (aground(w) || stop(w, f0)) break;
  }
  return t;
}

// The lowest feature bit that changed, as a wait target.
export function eventBetween(f0, f1) {
  const diff = (f0 ^ f1) >>> 0;
  if (!diff) return null;
  const bit = diff & -diff;
  return { bit, value: (f1 & bit) !== 0 };
}

export const WAIT_CAP = R.planHorizon;
export const GATE_CAP = 16;
export const SHORT_WAIT = 1.5;

export function expand(w, last) {
  const out = [];
  const gateMoves = [];
  w.c.gates.forEach((g, j) => {
    const gs = w.gates[j];
    if (gs.open && gs.busy < 0) {
      const n = cloneWorld(w);
      toggleGate(n, j);
      runUntil(n, () => false, n.lag);
      gateMoves.push({ w: n, step: { t: 'g', j, close: true }, cost: n.lag + R.actionCost });
    }
    if (gs.open) return;
    if (!gateLevel(w, j)) return;
    const n = cloneWorld(w);
    toggleGate(n, j);
    const before = progressOf(n);
    const dt = runUntil(n, (x) => !x.gates[j].open && x.gates[j].busy < 0, GATE_CAP);
    if (progressOf(n) > before)
      gateMoves.push({ w: n, step: { t: 'g', j }, cost: dt + n.lag + R.actionCost });
  });
  out.push(...gateMoves);
  w.c.valves.forEach((v, k) => {
    if (v.pump && !w.vopen[k] && w.energy <= 0) return;
    if (last === k) return; // toggling a valve straight back is never a plan
    // opening a valve with nothing to push the water is pointless on a lock without a tide
    if (!v.pump && !w.vopen[k] && !w.c.tidal && Math.abs(headOf(w, v.a, v.b, v.sill)) < R.settle)
      return;
    const n = cloneWorld(w);
    toggleValve(n, k);
    runUntil(n, () => false, n.lag);
    out.push({ w: n, step: { t: 'v', k, on: n.vopen[k] }, cost: n.lag + R.actionCost });
  });
  const n = cloneWorld(w);
  const f0 = features(n);
  const dt = runUntil(n, (x, f) => features(x) !== f, WAIT_CAP);
  const ev = eventBetween(f0, features(n));
  out.push({ w: n, step: { t: 'w', ev, time: ev ? 0 : dt }, cost: dt });
  if (ev && dt > SHORT_WAIT + 1e-9) {
    const q = cloneWorld(w);
    runUntil(q, () => false, SHORT_WAIT);
    out.push({ w: q, step: { t: 'w', ev: null, time: SHORT_WAIT }, cost: SHORT_WAIT });
  }
  return out;
}

export class Heap {
  constructor() {
    this.a = [];
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        for (const c of [2 * i + 1, 2 * i + 2]) if (c < a.length && a[c].f < a[m].f) m = c;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

// Rough time still needed: every gate a boat must still pass, plus the work of levelling the next one.
export function estimate(w) {
  let h = 0;
  const need = new Set();
  w.c.boats.forEach((cb, k) => {
    const b = w.boats[k];
    if (b.docked) return;
    h += (cb.route.length - b.step) * R.crossEstimate;
    need.add(cb.route[b.step]);
  });
  for (const j of need) if (!gateLevel(w, j)) h += R.levelEstimate;
  return h;
}

export function createSearch(w0, { margin = w0.c.margin, lag = R.lag, horizon = 240 } = {}) {
  const start = cloneWorld(w0);
  start.margin = margin;
  start.lag = lag;
  start.tolerant = margin === 0;
  const heap = new Heap();
  const seen = new Set([signature(start, -1)]);
  // (the worlds still waiting are kept packed: a long search holds hundreds of thousands of them)
  heap.push({ p: packWorld(start), g: 0, f: 0, steps: null, last: -1 });
  const done = allDocked(start);
  return {
    margin,
    lag,
    // Searches up to `budget` more nodes: 'pending', null (no plan exists) or {steps, time, margin}.
    nodes: 0,
    run(budget, workLimit = Infinity) {
      if (done) return { steps: [], time: 0, margin, lag };
      const work0 = work;
      let nodes = 0;
      while (heap.size) {
        const cur = heap.pop();
        const cw = unpackWorld(start.c, cur.p);
        if (allDocked(cw)) {
          return { steps: unwind(cur.steps), time: cw.time - start.time, margin, lag };
        }
        for (const m of expand(cw, cur.last)) {
          if (aground(m.w) || m.w.time - start.time > horizon) continue;
          const last = m.step.t === 'v' ? m.step.k : -1;
          const key = signature(m.w, last);
          if (seen.has(key)) continue;
          seen.add(key);
          const g = cur.g + m.cost + R.wastePenalty * (m.w.led.out - cw.led.out);
          heap.push({
            p: packWorld(m.w),
            g,
            f: g + R.searchWeight * estimate(m.w),
            steps: { step: m.step, prev: cur.steps },
            last,
          });
        }
        this.nodes++;
        if (++nodes >= budget || work - work0 >= workLimit) return heap.size ? 'pending' : null;
      }
      return null;
    },
  };
}

// Returns {steps, time} for the cheapest plan, null when no plan exists (the water is wasted), or
// 'unknown' when the search budget ran out before it could tell.
export function plan(
  w0,
  { budget = R.planNodes, horizon = 240, margin = w0.c.margin, lag = R.lag } = {},
) {
  const found = createSearch(w0, { margin, lag, horizon }).run(budget);
  return found === 'pending' ? 'unknown' : found;
}

export function unwind(node) {
  const steps = [];
  for (let n = node; n; n = n.prev) steps.push(n.step);
  steps.reverse();
  // A timed wait folds into the wait after it: into its event, or into its time.
  const out = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.t === 'w' && last?.t === 'w' && !last.ev) {
      if (s.ev) out[out.length - 1] = { ...s };
      else last.time += s.time;
    } else out.push({ ...s });
  }
  return out;
}

// Does `steps` from index `i` finish the lock when played perfectly from world `w0`?
// `elapsed` is how long the first step, if it is a timed wait, has already been waited.
export function rollout(w0, steps, i = 0, margin = w0.c.margin, lag = R.lag, elapsed = 0) {
  const w = cloneWorld(w0);
  w.tolerant = margin === 0;
  w.margin = margin;
  w.lag = lag;
  for (let n = i; n < steps.length; n++) {
    const s = steps[n];
    if (s.t === 'v') {
      if (w.vopen[s.k] !== s.on) {
        if (toggleValve(w, s.k) === 'empty') return false;
        runUntil(w, () => false, w.lag);
      }
    } else if (s.t === 'g') {
      if (s.close) {
        if (w.gates[s.j].open && toggleGate(w, s.j) !== 'closed') return false;
        runUntil(w, () => false, w.lag);
      } else {
        // an eager hand waits for the water to come level before it tries the gate
        if (!w.gates[s.j].open && !gateLevel(w, s.j))
          runUntil(w, (x) => gateLevel(x, s.j), R.waitCap);
        if (!w.gates[s.j].open && toggleGate(w, s.j) !== 'open') return false;
        const before = progressOf(w);
        runUntil(w, (x) => !x.gates[s.j].open && x.gates[s.j].busy < 0, GATE_CAP);
        // a gate that lets no boat through is not a step of any plan (a full lock, say)
        if (progressOf(w) <= before) return false;
      }
    } else if (!waitDone(w, s)) {
      const t = s.ev
        ? runUntil(w, (x) => waitDone(x, s), R.waitCap)
        : runUntil(w, () => false, n === i ? Math.max(0, s.time - elapsed) : s.time);
      if (s.ev && t >= R.waitCap - 1e-9) return false;
    }
    if (aground(w)) return false;
  }
  runUntil(w, allDocked, 30);
  return allDocked(w) && !aground(w);
}

export function waitDone(w, s) {
  return s.ev ? ((features(w) & s.ev.bit) !== 0) === s.ev.value : false;
}
