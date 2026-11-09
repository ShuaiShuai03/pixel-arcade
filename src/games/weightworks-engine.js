// Physics, solver and prompt logic for Weightworks. Nothing here draws or reads input.
//
// A machine is a set of balance beams. Every beam has pegs at signed distances from its pivot.
// A mass on a peg adds mass x distance to the beam's torque, so the sign of the torque says which
// side is heavier. Beams are massless. A beam can hang from a peg of another beam (its whole mass
// then acts at that peg) and can carry a tipper that drops a fixed mass onto a peg of another beam
// when it tips to one side.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const GATES = new Set(['=', '<', '>']);
const SIDE = { L: -1, R: 1 };
export const MAX_WEIGHTS = 7;

// --- Parsing --------------------------------------------------------------------------------
const fail = (def, why) => {
  throw new Error(`Machine "${def.name?.[0]}": ${why}`);
};

function pegList(def, spec, index) {
  const pegs = Array.isArray(spec.pegs)
    ? [...spec.pegs]
    : Array.from({ length: spec.span * 2 }, (_, i) =>
        i < spec.span ? i - spec.span : i - spec.span + 1,
      );
  if (!pegs.length) fail(def, `beam ${index} has no pegs`);
  pegs.forEach((p, i) => {
    if (!Number.isInteger(p) || p === 0) fail(def, `beam ${index} has a bad peg ${p}`);
    if (i && p <= pegs[i - 1]) fail(def, `beam ${index} pegs must rise`);
  });
  return pegs;
}

export function parseMachine(def) {
  const slots = [];
  const slotAt = new Map();
  const beams = def.beams.map((spec, index) => {
    if (!GATES.has(spec.gate)) fail(def, `beam ${index} has a bad gate`);
    const pegs = pegList(def, spec, index);
    const ids = pegs.map((pos) => {
      slotAt.set(`${index}:${pos}`, slots.length);
      slots.push({ beam: index, pos });
      return slots.length - 1;
    });
    return { index, label: 'ABC'[index], gate: spec.gate, pegs, slots: ids, spec };
  });
  const find = (beam, pos, what) => {
    const id = slotAt.get(`${beam}:${pos}`);
    if (id === undefined) fail(def, `${what} sits on a missing peg (${beam}, ${pos})`);
    return id;
  };
  const blocked = new Map();
  const block = (id, why) => {
    if (blocked.has(id)) fail(def, `peg ${id} is both ${blocked.get(id)} and ${why}`);
    blocked.set(id, why);
  };
  const edges = [];
  for (const b of beams) {
    const { spec } = b;
    b.fixed = (spec.fixed ?? []).map(([pos, m]) => {
      block(find(b.index, pos, 'a fixed mass'), 'fixed');
      return { pos, m };
    });
    for (const pos of spec.locked ?? []) block(find(b.index, pos, 'a lock'), 'locked');
    b.tips = (spec.tips ?? []).map(([when, m, beam, pos]) => {
      if (!SIDE[when] || !(m > 0)) fail(def, `beam ${b.index} has a bad tipper`);
      block(find(beam, pos, 'a tipper'), 'target');
      edges.push([b.index, beam]);
      return { when, m, beam, pos };
    });
    b.hang = null;
    if (spec.hang) {
      const [beam, pos] = spec.hang;
      if (beam === b.index) fail(def, `beam ${b.index} hangs from itself`);
      block(find(beam, pos, 'hook'), 'hook');
      edges.push([b.index, beam]);
      b.hang = { beam, pos };
    }
  }
  // Order the beams so that a beam is settled before anything it feeds.
  const order = [];
  const waiting = beams.map((b) => edges.filter((e) => e[1] === b.index).length);
  const ready = beams.filter((b) => waiting[b.index] === 0).map((b) => b.index);
  while (ready.length) {
    const i = ready.shift();
    order.push(i);
    for (const e of edges) if (e[0] === i && --waiting[e[1]] === 0) ready.push(e[1]);
  }
  if (order.length !== beams.length) fail(def, 'beams feed each other in a loop');
  const weights = def.tray.map((entry) => {
    const spec = typeof entry === 'number' ? { m: entry } : entry;
    if (!(spec.m > 0) || !Number.isInteger(spec.m)) fail(def, `bad mass ${spec.m}`);
    const rail = spec.rail ?? -1;
    if (rail >= beams.length) fail(def, 'a rail names a missing beam');
    const at = spec.at === undefined ? -1 : find(rail, spec.at, 'a rail mass');
    if (at >= 0 && blocked.has(at)) fail(def, 'a rail mass starts on a blocked peg');
    return { m: spec.m, rail, at };
  });
  if (weights.length > MAX_WEIGHTS || !weights.length) fail(def, 'bad number of masses');
  return {
    name: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    beams,
    slots,
    usable: slots.map((_, id) => !blocked.has(id)),
    why: slots.map((_, id) => blocked.get(id) ?? null),
    weights,
    order,
    budget: def.budget ?? null,
  };
}

// --- Physics ----------------------------------------------------------------------------------
// Torque and mass of every beam for a placement. `where[w]` is the peg a mass sits on, or -1.
function loadBase(mach, where, tau, mass) {
  tau.fill(0);
  mass.fill(0);
  for (const b of mach.beams)
    for (const f of b.fixed) {
      tau[b.index] += f.m * f.pos;
      mass[b.index] += f.m;
    }
  where.forEach((id, w) => {
    if (id < 0) return;
    const { beam, pos } = mach.slots[id];
    tau[beam] += mach.weights[w].m * pos;
    mass[beam] += mach.weights[w].m;
  });
}

function propagate(mach, tau, mass) {
  for (const i of mach.order) {
    const b = mach.beams[i];
    if (b.hang) {
      tau[b.hang.beam] += mass[i] * b.hang.pos;
      mass[b.hang.beam] += mass[i];
    }
    for (const t of b.tips)
      if (Math.sign(tau[i]) === SIDE[t.when]) {
        tau[t.beam] += t.m * t.pos;
        mass[t.beam] += t.m;
      }
  }
}

export function gateHolds(gate, tau, mass) {
  if (gate === '=') return tau === 0 && mass > 0;
  return gate === '<' ? tau < 0 : tau > 0;
}

const allGates = (mach, tau, mass) =>
  mach.beams.every((b) => gateHolds(b.gate, tau[b.index], mass[b.index]));

export function evaluate(mach, where) {
  const tau = Array(mach.beams.length).fill(0);
  const mass = Array(mach.beams.length).fill(0);
  loadBase(mach, where, tau, mass);
  propagate(mach, tau, mass);
  const ok = mach.beams.map((b) => gateHolds(b.gate, tau[b.index], mass[b.index]));
  return {
    tau,
    mass,
    tilt: tau.map((t) => Math.sign(t)),
    ok,
    solved: ok.every(Boolean) && where.every((id) => id >= 0),
  };
}

export const startOf = (mach) => mach.weights.map((w) => w.at);

// --- Solver -----------------------------------------------------------------------------------
// Every placement of the masses that solves the machine, found by exhaustive search. The cost of
// getting from one placement to another is one move per mass that has to be put down or picked up
// (two when it has to change pegs).
const SOLVED = new WeakMap();

export function solveMachine(mach) {
  if (SOLVED.has(mach)) return SOLVED.get(mach);
  const W = mach.weights.length;
  const nb = mach.beams.length;
  const options = mach.weights.map((w) =>
    mach.slots
      .map((_, id) => id)
      .filter((id) => mach.usable[id] && (w.rail < 0 || mach.slots[id].beam === w.rail)),
  );
  const found = [];
  const where = Array(W).fill(-1);
  const taken = Array(mach.slots.length).fill(false);
  const baseTau = Array(nb).fill(0);
  const baseMass = Array(nb).fill(0);
  const tau = Array(nb).fill(0);
  const mass = Array(nb).fill(0);
  loadBase(mach, where, baseTau, baseMass);
  const put = (w, id, sign) => {
    const { beam, pos } = mach.slots[id];
    baseTau[beam] += sign * mach.weights[w].m * pos;
    baseMass[beam] += sign * mach.weights[w].m;
  };
  const dfs = (w) => {
    if (w === W) {
      for (let i = 0; i < nb; i++) {
        tau[i] = baseTau[i];
        mass[i] = baseMass[i];
      }
      propagate(mach, tau, mass);
      if (allGates(mach, tau, mass)) found.push(...where);
      return;
    }
    for (const id of options[w]) {
      if (taken[id]) continue;
      taken[id] = true;
      where[w] = id;
      put(w, id, 1);
      dfs(w + 1);
      put(w, id, -1);
      taken[id] = false;
    }
    where[w] = -1;
  };
  dfs(0);
  const sols = Int8Array.from(found);
  const result = { W, count: sols.length / W, sols };
  result.optimal = Math.min(...costsFrom(result, startOf(mach)));
  SOLVED.set(mach, result);
  return result;
}

const moveCost = (from, to) => (from === to ? 0 : from < 0 ? 1 : 2);

export function costsFrom(solution, where) {
  const out = [];
  for (let k = 0; k < solution.count; k++) {
    let cost = 0;
    for (let w = 0; w < solution.W; w++)
      cost += moveCost(where[w], solution.sols[k * solution.W + w]);
    out.push(cost);
  }
  return out;
}

// --- Tray ---------------------------------------------------------------------------------------
// The tray holds every mass that is not on a peg, in a fixed order. `sel` is the mass that the next
// placement will use; rotating the tray moves it on to the next mass that is still in the tray.
export function nextInTray(where, from) {
  const n = where.length;
  for (let i = 1; i <= n; i++) {
    const w = (from + i + n) % n;
    if (where[w] < 0) return w;
  }
  return -1;
}

export function pressesTo(where, from, target) {
  let presses = 0;
  let at = from;
  while (at !== target && presses <= where.length) {
    at = nextInTray(where, at);
    presses++;
  }
  return presses;
}

// --- Cursor -------------------------------------------------------------------------------------
// The cursor lives on a beam row (a peg) or on the tray row (a mass socket). `mem` remembers the
// peg distance it last had, so stepping back up from the tray lands near where it left.
export const DIRS = Object.freeze({ right: 0, down: 1, left: 2, up: 3 });
export const rowCount = (mach) => mach.beams.length + 1;
const rowLength = (mach, row) =>
  row < mach.beams.length ? mach.beams[row].pegs.length : mach.weights.length;

export function stepCursor(mach, cur, dir, sel) {
  if (dir % 2 === 0) {
    const col = clamp(cur.col + (dir === 0 ? 1 : -1), 0, rowLength(mach, cur.row) - 1);
    return {
      row: cur.row,
      col,
      mem: cur.row < mach.beams.length ? mach.beams[cur.row].pegs[col] : cur.mem,
    };
  }
  const row = clamp(cur.row + (dir === 1 ? 1 : -1), 0, rowCount(mach) - 1);
  if (row === cur.row) return cur;
  if (row === mach.beams.length) return { row, col: Math.max(sel, 0), mem: cur.mem };
  const { pegs } = mach.beams[row];
  let best = 0;
  pegs.forEach((p, i) => {
    if (Math.abs(p - cur.mem) < Math.abs(pegs[best] - cur.mem)) best = i;
  });
  return { row, col: best, mem: pegs[best] };
}

export function startCursor(mach) {
  const { pegs } = mach.beams[0];
  const col = Math.max(
    0,
    pegs.findIndex((p) => p > 0),
  );
  return { row: 0, col, mem: pegs[col] };
}

// --- Advice -------------------------------------------------------------------------------------
// The next useful action from a placement: the first step of a cheapest way to a solved machine,
// or an undo when the moves left are too few to finish from here.
export function advise(mach, where, sel, cursor, movesLeft, canUndo) {
  const solution = solveMachine(mach);
  if (evaluate(mach, where).solved) return { kind: 'done' };
  const costs = costsFrom(solution, where);
  const d = Math.min(...costs);
  if (d > movesLeft && canUndo) return { kind: 'undo' };
  const occupied = new Set(where.filter((id) => id >= 0));
  const options = [];
  costs.forEach((cost, k) => {
    if (cost !== d) return;
    for (let w = 0; w < solution.W; w++) {
      const goal = solution.sols[k * solution.W + w];
      if (where[w] >= 0 && where[w] !== goal) options.push({ kind: 'pick', w, slot: where[w] });
      else if (where[w] < 0 && !occupied.has(goal))
        options.push({ kind: w === sel ? 'place' : 'rotate', w, slot: goal });
    }
  });
  const reach = (o) => {
    const { beam, pos } = mach.slots[o.slot];
    return { row: beam, col: mach.beams[beam].pegs.indexOf(pos) };
  };
  // The cheapest next action in key presses: the walk to the peg, plus the tray turns it needs.
  const presses = (o) => (o.kind === 'rotate' ? pressesTo(where, sel, o.w) : 0);
  const effort = (o) => {
    const at = reach(o);
    return Math.abs(at.row - cursor.row) + Math.abs(at.col - cursor.col) + presses(o);
  };
  const order = { pick: 0, place: 1, rotate: 2 };
  const best = options.sort(
    (a, b) =>
      effort(a) - effort(b) || order[a.kind] - order[b.kind] || a.slot - b.slot || a.w - b.w,
  )[0];
  const w = mach.weights[best.w];
  if (best.kind === 'rotate')
    return {
      kind: 'rotate',
      key: 'KeyX',
      weight: best.w,
      mass: w.m,
      rail: w.rail,
      plain: w.rail < 0 && mach.weights[sel].m === w.m,
      presses: presses(best),
    };
  const { row, col } = reach(best);
  const target = { row, col, beam: row, pos: mach.slots[best.slot].pos, mass: w.m, weight: best.w };
  if (cursor.row === row && cursor.col === col) return { ...target, kind: best.kind, key: 'Space' };
  const vertical = cursor.row !== row;
  const dir = vertical
    ? row > cursor.row
      ? DIRS.down
      : DIRS.up
    : col > cursor.col
      ? DIRS.right
      : DIRS.left;
  return {
    ...target,
    kind: 'move',
    dir,
    steps: vertical ? Math.abs(row - cursor.row) : Math.abs(col - cursor.col),
    key: ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][dir],
  };
}

// --- Prompt text ----------------------------------------------------------------------------------
const GLYPH = ['→', '↓', '←', '↑'];
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export const PLAIN = Object.freeze({
  menu: ['Choose a machine: arrows, then Space', '选择机器：方向键，再按空格'],
  watch: ['Hold still: the needles are settling', '别动，等指针停稳'],
  cleared: ['Machine balanced! The next one is coming', '机器已平衡！即将进入下一台'],
  won: ['Every machine is balanced. Well done!', '全部机器已平衡，做得好！'],
  lost: ['Out of moves: the machine failed', '步数用完：本机器失败'],
  undo: ['Too few moves left: press Z to undo', '剩余步数不足：按 Z 撤销'],
});

export function adviceLine(adv) {
  if (adv.kind === 'done') return PLAIN.watch;
  if (adv.kind === 'undo') return PLAIN.undo;
  const mass = `${adv.mass} kg`;
  if (adv.kind === 'rotate') {
    const more = adv.presses > 1;
    // Name the mass so that an equal weight already selected cannot be mistaken for it.
    const [what, whatZh] =
      adv.rail >= 0
        ? [`${mass} slider (rail ${'ABC'[adv.rail]})`, `${mass} 滑块（${'ABC'[adv.rail]} 梁滑轨）`]
        : adv.plain
          ? [`plain ${mass} mass`, `普通 ${mass} 砝码`]
          : [`${mass} mass`, `${mass} 砝码`];
    return [
      `X: rotate the tray to the ${what}${more ? ` (${adv.presses} presses)` : ''}`,
      `按 X：把托盘转到 ${whatZh}${more ? `（${adv.presses} 次）` : ''}`,
    ];
  }
  const label = 'ABC'[adv.beam];
  const peg = signed(adv.pos);
  if (adv.kind === 'place')
    return [
      `Space: place the ${mass} mass on beam ${label} peg ${peg}`,
      `按空格：把 ${mass} 砝码放到 ${label} 梁 ${peg} 号孔`,
    ];
  if (adv.kind === 'pick')
    return [
      `Space: pick up the ${mass} mass from beam ${label} peg ${peg}`,
      `按空格：从 ${label} 梁 ${peg} 号孔取下 ${mass} 砝码`,
    ];
  // A vertical step only reaches the beam; the peg is named by the horizontal step after it.
  const [to, toZh] =
    adv.dir % 2
      ? [`beam ${label}`, `${label} 梁`]
      : [`beam ${label} peg ${peg}`, `${label} 梁 ${peg} 号孔`];
  return [
    `Move ${GLYPH[adv.dir]} ${adv.steps} to ${to}`,
    `光标向${'右下左上'[adv.dir]}移 ${adv.steps} 格到 ${toZh}`,
  ];
}
