import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MACHINES,
  MACHINE_COUNT,
  RULES,
  GEO,
  meta,
  createGame,
  parseMachine,
  evaluate,
  solveMachine,
  startOf,
  costsFrom,
  nextInTray,
  stepCursor,
  advise,
  adviceLine,
  gateHolds,
  layoutOf,
  cellRect,
  hitTest,
  menuCellAt,
} from '../src/games/weightworks.js';
import { MAX_WEIGHTS, PLAIN, pressesTo, startCursor } from '../src/games/weightworks-engine.js';
import { MACHINE_DEFS } from '../src/games/weightworks-machines.js';
import { harness, input, mockContext, seeded } from './harness.js';

// The fewest moves each machine needs, as recorded from the solver. A machine edit must update this.
const OPTIMAL = [1, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 8, 8, 8, 8];
const TUTORIALS = 4;

// --- helpers ---------------------------------------------------------------------------------
const def = (beams, tray, extra = {}) => ({
  name: ['t', '测'],
  tip: ['t', '测'],
  beams,
  tray,
  ...extra,
});
const small = (beams, tray, extra) => parseMachine(def(beams, tray, extra));
function open(level = 1, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  const calls = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  h.calls = calls;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const press = (g, ...codes) => g.update(1 / 60, input([], codes));
const idle = (g, seconds, hz = 60) => {
  for (let n = 0; n < Math.round(seconds * hz); n++) g.update(1 / hz, input());
};
function goTo(g, row, col) {
  for (let n = 0; n < 60; n++) {
    const c = g.getState().cursor;
    if (c.row < row) press(g, 'ArrowDown');
    else if (c.row > row) press(g, 'ArrowUp');
    else if (c.col < col) press(g, 'ArrowRight');
    else if (c.col > col) press(g, 'ArrowLeft');
    else return;
  }
  assert.fail('cursor did not arrive');
}
const colOf = (mach, beam, pos) => mach.beams[beam].pegs.indexOf(pos);
function rotateTo(g, w) {
  for (let n = 0; n < 12 && g.getState().sel !== w; n++) press(g, 'KeyX');
  assert.equal(g.getState().sel, w);
}
// Put mass `w` on peg `pos` of beam `beam` through the real controls.
function put(g, mach, w, beam, pos) {
  rotateTo(g, w);
  goTo(g, beam, colOf(mach, beam, pos));
  press(g, 'Space');
}
// The moves of a cheapest solution, read from the solver table rather than from the prompt.
function plan(mach) {
  const sol = solveMachine(mach);
  const start = startOf(mach);
  const costs = costsFrom(sol, start);
  const k = costs.indexOf(Math.min(...costs));
  const goal = Array.from(sol.sols.slice(k * sol.W, (k + 1) * sol.W));
  return { goal, start };
}
function playPlan(g, mach) {
  const { goal, start } = plan(mach);
  goal.forEach((id, w) => {
    if (start[w] >= 0 && start[w] !== id) {
      const { beam, pos } = mach.slots[start[w]];
      goTo(g, beam, colOf(mach, beam, pos));
      press(g, 'Space');
    }
  });
  goal.forEach((id, w) => {
    if (id < 0 || start[w] === id) return;
    const { beam, pos } = mach.slots[id];
    put(g, mach, w, beam, pos);
  });
}
const findMachine = (fn) => MACHINES.findIndex(fn) + 1;
const ENDS = (h) => h.ends.length;

// --- metadata and data -----------------------------------------------------------------------
test('meta describes the game in both languages with working touch controls', () => {
  assert.equal(meta.id, 'weightworks');
  assert.equal(meta.genre, 'puzzle');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  for (const field of [meta.name, meta.description])
    assert.ok(field.en.length > 5 && /[一-鿿]/.test(field.zh));
  assert.equal(meta.name.zh, '天平工坊');
  assert.ok(meta.description.en.includes(String(MACHINE_COUNT)));
  assert.ok(meta.description.zh.includes(String(MACHINE_COUNT)));
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyX',
    'KeyZ',
    'KeyQ',
  ])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
  for (const k of meta.keys) assert.ok(k.label.en && /[一-鿿]/.test(k.label.zh));
  assert.ok(!codes.includes('KeyP') && !codes.includes('KeyR') && !codes.includes('Escape'));
});

test('there are at least 22 machines, each small, bilingual and with the recorded optimum and budget', () => {
  assert.ok(MACHINE_COUNT >= 22);
  assert.equal(MACHINES.length, OPTIMAL.length);
  assert.equal(MACHINE_DEFS.length, MACHINES.length);
  const names = new Set();
  MACHINES.forEach((m, i) => {
    assert.ok(m.beams.length >= 1 && m.beams.length <= 3, `machine ${i + 1} beams`);
    assert.ok(m.weights.length >= 1 && m.weights.length <= MAX_WEIGHTS);
    assert.ok(m.name.en && /[一-鿿]/.test(m.name.zh), `machine ${i + 1} name`);
    assert.ok(m.tip.en && /[一-鿿]/.test(m.tip.zh), `machine ${i + 1} tip`);
    // The tip sits on one line of the 480 px canvas beside the gate count: 6 px per letter, 10 per hanzi.
    assert.ok(
      m.tip.en.length * 6 <= 372,
      `machine ${i + 1} English tip is ${m.tip.en.length} letters`,
    );
    assert.ok([...m.tip.zh].length * 10 <= 372, `machine ${i + 1} Chinese tip`);
    assert.ok(m.name.en.length * 12 <= 220 && [...m.name.zh].length * 12 <= 220);
    names.add(m.name.en);
    const sol = solveMachine(m);
    assert.equal(sol.optimal, OPTIMAL[i], `machine ${i + 1} optimum`);
    assert.ok(sol.count >= 1);
    // Machines 1 and 2 are unlimited, 3 and 4 give three spare moves, the rest two.
    const slack = i < 2 ? null : i < TUTORIALS ? 3 : 2;
    assert.equal(m.budget, slack === null ? null : OPTIMAL[i] + slack, `machine ${i + 1} budget`);
    assert.equal(evaluate(m, startOf(m)).solved, false, `machine ${i + 1} starts solved`);
    for (const b of m.beams) {
      assert.ok(Math.max(...b.pegs.map(Math.abs)) <= 4);
      assert.ok(b.tips.every((t) => t.m > 0));
    }
  });
  assert.equal(names.size, MACHINE_COUNT);
});

test('machines are frozen and their records carry only what the game uses', () => {
  assert.equal(Object.isFrozen(MACHINES), true);
  for (const m of MACHINES) {
    assert.equal(Object.isFrozen(m), true);
    assert.equal(Object.isFrozen(m.beams), true);
    assert.equal(Object.isFrozen(m.beams[0]), true);
    assert.equal(Object.isFrozen(m.weights[0]), true);
    assert.equal(Object.isFrozen(m.name), true);
  }
  assert.throws(() => {
    'use strict';
    MACHINES[0].beams[0].gate = '<';
  }, TypeError);
  assert.equal(Object.isFrozen(RULES), true);
});

// --- physics -------------------------------------------------------------------------------------
test('torque is mass times signed distance, summed over every mass on the beam', () => {
  const m = small([{ span: 4, gate: '>', fixed: [[-3, 2]] }], [3, 1, 4]);
  const r = seeded(5);
  for (let n = 0; n < 200; n++) {
    const pegs = [1, 2, 4, 5, 6, 7, 8].map((i) => i); // slot ids: -4 -3 -2 -1 1 2 3 4 -> ids 0..7
    const where = m.weights.map(() => -1);
    const used = new Set([1]); // the fixed mass owns -3
    let tau = -6;
    let mass = 2;
    m.weights.forEach((w, k) => {
      if (r() < 0.3) return;
      let id;
      do id = Math.floor(r() * 8);
      while (used.has(id) || pegs.length === 0);
      used.add(id);
      where[k] = id;
      tau += w.m * m.slots[id].pos;
      mass += w.m;
    });
    const ev = evaluate(m, where);
    assert.equal(ev.tau[0], tau);
    assert.equal(ev.mass[0], mass);
    assert.equal(ev.tilt[0], Math.sign(tau));
  }
});

test('equal masses on unequal arms never satisfy a level gate, and a heavier mass can sit nearer the pivot', () => {
  const m = small([{ span: 4, gate: '=' }], [3, 3]);
  const pegs = m.beams[0].pegs;
  for (const a of pegs)
    for (const b of pegs) {
      if (a === b) continue;
      const ev = evaluate(m, [
        m.beams[0].slots[pegs.indexOf(a)],
        m.beams[0].slots[pegs.indexOf(b)],
      ]);
      assert.equal(ev.ok[0], Math.abs(a) === Math.abs(b) && a === -b, `${a} and ${b}`);
      assert.equal(ev.tau[0] === 0, a === -b);
    }
  // 6 kg at distance 1 balances 2 kg at distance 3 and 3 kg at distance 2.
  const levers = small([{ span: 3, gate: '=' }], [6, 2, 3]);
  const at = (pos) => levers.beams[0].slots[levers.beams[0].pegs.indexOf(pos)];
  assert.equal(evaluate(levers, [at(-1), at(3), -1]).ok[0], true);
  assert.equal(evaluate(levers, [at(-1), -1, at(2)]).ok[0], true);
  assert.equal(evaluate(levers, [at(1), at(2), at(-3)]).tau[0], 6 + 4 - 9);
});

test('a level gate needs a load: an empty beam is not level, and tilt gates read the sign of the torque', () => {
  assert.equal(gateHolds('=', 0, 0), false);
  assert.equal(gateHolds('=', 0, 4), true);
  assert.equal(gateHolds('=', 1, 4), false);
  assert.equal(gateHolds('<', -1, 1), true);
  assert.equal(gateHolds('<', 0, 1), false);
  assert.equal(gateHolds('<', 2, 1), false);
  assert.equal(gateHolds('>', 1, 1), true);
  assert.equal(gateHolds('>', 0, 1), false);
  assert.equal(gateHolds('>', -3, 1), false);
  const m = small([{ span: 2, gate: '=' }], [1]);
  assert.equal(evaluate(m, [-1]).solved, false);
});

test('linked beams pass their full mass through a chain, whatever their own torque', () => {
  const m = small(
    [
      { span: 3, gate: '=', fixed: [[-2, 3]] },
      { span: 3, gate: '=', fixed: [[3, 2]], hang: [0, 1] },
      { span: 2, gate: '=', fixed: [[-1, 4]], hang: [1, -2] },
    ],
    [1],
  );
  const ev = evaluate(m, [-1]);
  // C: mass 4, torque -4. B: its own 2 at +3 plus all of C at -2, mass 6, torque 6 - 8 = -2.
  assert.deepEqual(ev.mass, [3 + 6, 6, 4]);
  assert.deepEqual(ev.tau, [-6 + 6 * 1, 6 - 8, -4]);
  assert.deepEqual(ev.tilt, [0, -1, -1]);
  // Moving C's torque around does not change what it passes on: only its mass.
  const heavier = small(
    [
      { span: 3, gate: '=', fixed: [[-2, 3]] },
      { span: 3, gate: '=', fixed: [[3, 2]], hang: [0, 1] },
      { span: 2, gate: '=', fixed: [[1, 4]], hang: [1, -2] },
    ],
    [1],
  );
  assert.deepEqual(evaluate(heavier, [-1]).mass, ev.mass);
});

test('a tipper drops its mass on the target peg only while its beam tips the marked way', () => {
  const beams = (when) => [
    { span: 3, gate: '=', fixed: [[-1, 2]] },
    { span: 3, gate: '=', hang: [0, 3], tips: [[when, 5, 0, 2]] },
  ];
  const right = small(beams('R'), [2]);
  const on = (m, pos) => [m.beams[1].slots[m.beams[1].pegs.indexOf(pos)]];
  // B tips right with the mass at +2, left with it at -2, and is level (0 kg) with none.
  assert.deepEqual(evaluate(right, on(right, 2)).tau, [-2 + 2 * 3 + 5 * 2, 4]);
  assert.deepEqual(evaluate(right, on(right, -2)).tau, [-2 + 2 * 3, -4]);
  assert.equal(evaluate(right, on(right, -2)).mass[0], 2 + 2);
  const left = small(beams('L'), [2]);
  assert.deepEqual(evaluate(left, on(left, -2)).tau, [-2 + 6 + 10, -4]);
  assert.deepEqual(evaluate(left, on(left, 2)).tau, [-2 + 6, 4]);
  assert.equal(evaluate(left, [-1]).mass[0], 2);
  // The tipper's target peg is reserved.
  assert.equal(right.usable[right.beams[0].slots[right.beams[0].pegs.indexOf(2)]], false);
  assert.equal(right.why[right.beams[0].slots[right.beams[0].pegs.indexOf(2)]], 'target');
});

test('the needle at rest shows the true sign of the net torque of every beam, in every machine', () => {
  const r = seeded(11);
  for (let level = 1; level <= MACHINE_COUNT; level += 1) {
    const { g } = open(level);
    const mach = MACHINES[level - 1];
    for (let n = 0; n < 6; n++) {
      // A random legal action: walk a few steps, then place or pick.
      for (let k = 0; k < 1 + Math.floor(r() * 4); k++)
        press(g, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][Math.floor(r() * 4)]);
      press(g, r() < 0.3 ? 'KeyX' : 'Space');
      idle(g, 2.5, 30);
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      assert.equal(st.resting, true);
      st.beams.forEach((b, i) => {
        assert.equal(
          Math.abs(b.angle) > 0.003 ? Math.sign(b.angle) : 0,
          b.tilt,
          `machine ${level} beam ${i}`,
        );
        assert.equal(b.tilt, Math.sign(b.tau));
        assert.equal(b.lamp, b.ok);
      });
      assert.equal(st.beams.length, mach.beams.length);
    }
  }
});

test('the tray never creates or loses a mass: every mass is in the tray or on exactly one peg', () => {
  const r = seeded(3);
  for (const level of [1, 5, 7, 10, 16, 24]) {
    const { g } = open(level);
    const mach = MACHINES[level - 1];
    const total = mach.weights.reduce((n, w) => n + w.m, 0);
    for (let n = 0; n < 400; n++) {
      press(
        g,
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Space', 'KeyX', 'KeyZ'][
          Math.floor(r() * 8)
        ],
      );
      const st = g.getState();
      if (st.phase !== 'playing') break;
      const placed = st.weights.filter((w) => w.where >= 0);
      assert.equal(
        new Set(placed.map((w) => w.where)).size,
        placed.length,
        'two masses on one peg',
      );
      assert.equal(
        st.weights.reduce((sum, w) => sum + w.mass, 0),
        total,
      );
      assert.equal(st.weights.length, mach.weights.length);
      st.weights.forEach((w, k) => {
        assert.equal(w.mass, mach.weights[k].m);
        if (w.rail >= 0 && w.where >= 0) assert.equal(mach.slots[w.where].beam, w.rail);
        if (w.where >= 0) assert.equal(mach.usable[w.where], true);
      });
      // The board text counts exactly the placed masses.
      const digits = st.board
        .join(' ')
        .split(' ')
        .filter((c) => /\d/.test(c));
      assert.equal(digits.length, placed.length);
      if (st.sel >= 0) assert.ok(st.weights[st.sel].where < 0);
      else assert.equal(placed.length, st.weights.length);
    }
  }
});

// --- parsing -------------------------------------------------------------------------------------
test('parseMachine rejects malformed machines', () => {
  const ok = { span: 3, gate: '=' };
  assert.throws(() => small([{ span: 3, gate: '?' }], [1]), /bad gate/);
  assert.throws(() => small([{ pegs: [], gate: '=' }], [1]), /no pegs/);
  assert.throws(() => small([{ pegs: [0, 1], gate: '=' }], [1]), /bad peg/);
  assert.throws(() => small([{ pegs: [1.5], gate: '=' }], [1]), /bad peg/);
  assert.throws(() => small([{ pegs: [2, 1], gate: '=' }], [1]), /must rise/);
  assert.throws(() => small([{ ...ok, fixed: [[5, 1]] }], [1]), /missing peg/);
  assert.throws(
    () => small([{ ...ok, fixed: [[1, 1]], locked: [1] }], [1]),
    /both fixed and locked/,
  );
  assert.throws(() => small([{ ...ok, tips: [['X', 1, 0, 1]] }], [1]), /bad tipper/);
  assert.throws(() => small([{ ...ok, tips: [['L', 0, 0, 1]] }], [1]), /bad tipper/);
  assert.throws(() => small([{ ...ok, hang: [0, 1] }], [1]), /hangs from itself/);
  assert.throws(
    () =>
      small(
        [
          { ...ok, hang: [1, 1] },
          { ...ok, hang: [0, 1] },
        ],
        [1],
      ),
    /loop/,
  );
  assert.throws(
    () =>
      small(
        [
          { ...ok, tips: [['L', 1, 1, 1]] },
          { ...ok, tips: [['R', 1, 0, 2]] },
        ],
        [1],
      ),
    /loop/,
  );
  assert.throws(() => small([ok], [0]), /bad mass/);
  assert.throws(() => small([ok], [1.5]), /bad mass/);
  assert.throws(() => small([ok], [{ m: 1, rail: 3 }]), /missing beam/);
  assert.throws(() => small([ok], [{ m: 1, rail: 0, at: 9 }]), /missing peg/);
  assert.throws(() => small([{ ...ok, locked: [2] }], [{ m: 1, rail: 0, at: 2 }]), /blocked/);
  assert.throws(() => small([ok], []), /number of masses/);
  assert.throws(() => small([ok], Array(MAX_WEIGHTS + 1).fill(1)), /number of masses/);
  const fine = small([ok], [{ m: 2, rail: 0, at: 2 }, 3]);
  assert.deepEqual(startOf(fine), [fine.beams[0].slots[4], -1]);
});

// --- solver, tray, cursor and prompts ------------------------------------------------------------
test('the solver lists every solved layout of a small machine and the cheapest way there', () => {
  const m = small([{ span: 3, gate: '=', fixed: [[-3, 2]] }], [3, 1]);
  const sol = solveMachine(m);
  // Brute force every placement of 3 kg and 1 kg on the five free pegs.
  const free = [1, 2, 3, 4, 5];
  const wanted = [];
  for (const a of free)
    for (const b of free) {
      if (a === b) continue;
      if (evaluate(m, [a, b]).solved) wanted.push([a, b]);
    }
  const got = [];
  for (let k = 0; k < sol.count; k++) got.push([sol.sols[k * 2], sol.sols[k * 2 + 1]]);
  assert.deepEqual(got.sort(), wanted.sort());
  assert.equal(solveMachine(m), sol, 'cached');
  assert.equal(sol.optimal, 2);
  assert.deepEqual(
    costsFrom(sol, [-1, -1]),
    got.map(() => 2),
  );
  // Moving a mass from one peg to another costs two moves, putting it down one.
  const [a, b] = got[0];
  assert.deepEqual(costsFrom({ count: 1, W: 2, sols: Int8Array.of(a, b) }, [a, -1]), [1]);
  assert.deepEqual(costsFrom({ count: 1, W: 2, sols: Int8Array.of(a, b) }, [b, a]), [4]);
});

test('the tray rotates over the masses that are still in it, in a fixed order', () => {
  assert.equal(nextInTray([-1, -1, -1], -1), 0);
  assert.equal(nextInTray([-1, -1, -1], 0), 1);
  assert.equal(nextInTray([-1, -1, -1], 2), 0);
  assert.equal(nextInTray([-1, 4, -1], 0), 2);
  assert.equal(nextInTray([0, 4, -1], 2), 2, 'a single mass stays selected');
  assert.equal(nextInTray([0, 4, 5], 2), -1, 'an empty tray selects nothing');
  assert.equal(pressesTo([-1, 4, -1, -1], 0, 3), 2);
  assert.equal(pressesTo([-1, -1, -1], 2, 1), 2);
  assert.equal(pressesTo([-1, -1], 0, 0), 0);
});

test('the cursor moves along a beam, between beams to the nearest peg, and down to the tray and back', () => {
  const m = small(
    [
      { pegs: [-3, -1, 2, 4], gate: '=' },
      { pegs: [-2, 1, 3], gate: '=' },
    ],
    [1, 2],
  );
  const right = (c, n = 1) => Array.from({ length: n }).reduce((x) => stepCursor(m, x, 0, 0), c);
  const c0 = { row: 0, col: 0, mem: -3 };
  assert.deepEqual(right(c0), { row: 0, col: 1, mem: -1 });
  assert.deepEqual(right(c0, 9), { row: 0, col: 3, mem: 4 }, 'clamped at the end of the beam');
  assert.deepEqual(stepCursor(m, c0, 2, 0), c0, 'clamped at the start');
  // Down from -1 lands on -2 (distance 1); from 2 it lands on 1 (distance 1 beats 3 at distance 1? ties go to the lower peg).
  assert.deepEqual(stepCursor(m, { row: 0, col: 1, mem: -1 }, 1, 0), { row: 1, col: 0, mem: -2 });
  assert.deepEqual(stepCursor(m, { row: 0, col: 2, mem: 2 }, 1, 0), { row: 1, col: 1, mem: 1 });
  assert.deepEqual(stepCursor(m, { row: 0, col: 3, mem: 4 }, 1, 0), { row: 1, col: 2, mem: 3 });
  const lower = { row: 1, col: 2, mem: 3 };
  assert.deepEqual(
    stepCursor(m, lower, 3, 0),
    { row: 0, col: 2, mem: 2 },
    'a tie goes to the lower peg',
  );
  assert.equal(stepCursor(m, { row: 0, col: 0, mem: -3 }, 3, 0).row, 0, 'no row above the first');
  // The tray is the row below the beams, and it remembers where the cursor came from.
  const tray = stepCursor(m, lower, 1, 1);
  assert.deepEqual(tray, { row: 2, col: 1, mem: 3 });
  assert.deepEqual(
    stepCursor(m, tray, 0, 1),
    { row: 2, col: 1, mem: 3 },
    'two sockets, already at the last',
  );
  assert.deepEqual(stepCursor(m, tray, 2, 1), { row: 2, col: 0, mem: 3 });
  assert.equal(stepCursor(m, tray, 1, 1), tray, 'nothing below the tray');
  assert.deepEqual(stepCursor(m, tray, 3, 1), { row: 1, col: 2, mem: 3 });
  assert.equal(
    stepCursor(m, lower, 1, -1).col,
    0,
    'an empty tray puts the cursor on the first socket',
  );
  assert.deepEqual(
    startCursor(m),
    { row: 0, col: 2, mem: 2 },
    'starts at the first peg right of the pivot',
  );
  const lefty = small([{ pegs: [-2, -1], gate: '=' }], [1]);
  assert.deepEqual(startCursor(lefty), { row: 0, col: 0, mem: -2 });
});

test('the advice walks vertically first, then along the beam, and the number is the first leg', () => {
  const m = MACHINES[3];
  const sol = solveMachine(m);
  assert.ok(sol.count >= 1);
  const where = startOf(m);
  let moves = 0;
  let cursor = { row: 1, col: 0, mem: -3 };
  let sel = 0;
  const seen = new Set();
  for (let guard = 0; guard < 40; guard++) {
    const adv = advise(m, where, sel, cursor, Infinity, false);
    seen.add(adv.kind);
    if (adv.kind === 'done') break;
    if (adv.kind === 'move') {
      const vertical = cursor.row !== adv.row;
      assert.equal(
        adv.steps,
        vertical ? Math.abs(adv.row - cursor.row) : Math.abs(adv.col - cursor.col),
      );
      assert.equal(adv.dir % 2 === 1, vertical);
      for (let i = 0; i < adv.steps; i++) cursor = stepCursor(m, cursor, adv.dir, sel);
    } else if (adv.kind === 'rotate') {
      sel = nextInTray(where, sel);
    } else {
      const slot = m.beams[adv.row].slots[adv.col];
      if (adv.kind === 'place') {
        where[adv.weight] = slot;
        sel = nextInTray(where, sel);
      } else {
        where[adv.weight] = -1;
        sel = adv.weight;
      }
      moves++;
    }
  }
  assert.equal(evaluate(m, where).solved, true);
  assert.equal(moves, sol.optimal);
  assert.ok(seen.has('move') && seen.has('place'));
});

test('the advice asks to pick up a wrongly placed mass and to rotate the tray, and undoes when moves run short', () => {
  // 4 kg on the left at -2 needs 2 kg at +3 and 1 kg at +2, in any order.
  const m = small([{ span: 3, gate: '=', fixed: [[-2, 4]] }], [2, 1]);
  const peg = (pos) => m.beams[0].slots[colOf(m, 0, pos)];
  const wrong = [peg(-1), -1];
  const both = [peg(-1), peg(1)];
  const far = advise(m, both, -1, { row: 0, col: 5, mem: 3 }, Infinity, true);
  assert.equal(far.kind, 'move');
  assert.equal(far.key, 'ArrowLeft');
  assert.equal(far.steps, 2);
  assert.equal(far.weight, 1, 'the nearer wrong mass is picked up first');
  const near = advise(m, wrong, 1, { row: 0, col: colOf(m, 0, -1), mem: -1 }, Infinity, true);
  assert.equal(near.kind, 'pick');
  assert.equal(near.mass, 2);
  assert.equal(near.pos, -1);
  assert.equal(near.key, 'Space');
  // Both masses are in the tray: the selected 1 kg mass goes to +2, which is close, so it is placed
  // first when the cursor is there.
  const open = [-1, -1];
  assert.equal(
    advise(m, open, 1, { row: 0, col: colOf(m, 0, 2), mem: 2 }, Infinity, false).kind,
    'place',
  );
  // 4 kg at -2 and 3 kg at +4 balance the 1 kg at -4: standing on -2 with the 3 kg mass selected, the
  // far peg costs more than turning the tray to the 4 kg mass.
  const far2 = small([{ span: 4, gate: '=', fixed: [[-4, 1]] }], [4, 3]);
  const turn = advise(
    far2,
    [-1, -1],
    1,
    { row: 0, col: colOf(far2, 0, -2), mem: -2 },
    Infinity,
    false,
  );
  assert.equal(turn.kind, 'rotate');
  assert.deepEqual([turn.weight, turn.mass, turn.presses, turn.key], [0, 4, 1, 'KeyX']);
  // With too few moves left the advice is to undo, but only when there is something to undo.
  const m2 = small([{ span: 3, gate: '=', fixed: [[-2, 3]] }], [2], { budget: 1 });
  assert.equal(advise(m2, [-1], 0, startCursor(m2), 0, true).kind, 'undo');
  assert.notEqual(advise(m2, [-1], 0, startCursor(m2), 0, false).kind, 'undo');
  assert.equal(advise(m2, [m2.beams[0].slots[5]], 0, startCursor(m2), 0, true).kind, 'done');
});

test('a look-alike mass is named so that it cannot be mistaken for the one already selected', () => {
  // Machine 19: a 2 kg slider on beam B and a plain 2 kg mass. With every mass in the tray and the
  // plain 2 kg mass selected, the plan wants the slider first.
  const m19 = MACHINES[18];
  const slider = m19.weights.findIndex((w) => w.rail >= 0);
  const plain = m19.weights.findIndex((w, k) => w.m === m19.weights[slider].m && k !== slider);
  const empty = m19.weights.map(() => -1);
  const found = [];
  for (let row = 0; row < m19.beams.length; row++)
    for (let col = 0; col < m19.beams[row].pegs.length; col++) {
      const cursor = { row, col, mem: m19.beams[row].pegs[col] };
      const a = advise(m19, empty, plain, cursor, Infinity, false);
      if (a.kind === 'rotate' && a.weight === slider) found.push(adviceLine(a));
    }
  assert.ok(found.length > 0);
  for (const [en, zh] of found) {
    assert.match(en, /rotate the tray to the 2 kg slider \(rail B\)/);
    assert.match(zh, /2 kg 滑块（B 梁滑轨）/);
  }
  // Machine 20: the plain 4 kg mass is wanted while the 4 kg slider is selected.
  const m20 = MACHINES[19];
  const s20 = m20.weights.findIndex((w) => w.rail >= 0 && w.m === 4);
  const p20 = m20.weights.findIndex((w) => w.rail < 0 && w.m === 4);
  const lines = new Set();
  for (let row = 0; row < m20.beams.length; row++)
    for (let col = 0; col < m20.beams[row].pegs.length; col++) {
      const a = advise(
        m20,
        m20.weights.map(() => -1),
        s20,
        { row, col, mem: 1 },
        Infinity,
        false,
      );
      if (a.kind === 'rotate' && a.weight === p20) lines.add(adviceLine(a)[0]);
    }
  assert.ok([...lines].length > 0);
  for (const line of lines) assert.match(line, /rotate the tray to the plain 4 kg mass/);
});

test('every kind of advice has an English and a Chinese line that name the mass, the beam and the peg', () => {
  const base = { mass: 3, beam: 1, pos: -2 };
  const rot = adviceLine({ kind: 'rotate', mass: 3, presses: 1 });
  assert.deepEqual(rot, ['X: rotate the tray to the 3 kg mass', '按 X：把托盘转到 3 kg 砝码']);
  assert.ok(adviceLine({ kind: 'rotate', mass: 3, presses: 3 })[0].endsWith('(3 presses)'));
  assert.ok(adviceLine({ kind: 'rotate', mass: 3, presses: 3 })[1].endsWith('（3 次）'));
  // A slider is named with its rail, and a plain mass is named as plain when an equal weight is selected.
  assert.deepEqual(adviceLine({ kind: 'rotate', mass: 2, rail: 1, presses: 1 }), [
    'X: rotate the tray to the 2 kg slider (rail B)',
    '按 X：把托盘转到 2 kg 滑块（B 梁滑轨）',
  ]);
  assert.deepEqual(adviceLine({ kind: 'rotate', mass: 4, rail: -1, plain: true, presses: 3 }), [
    'X: rotate the tray to the plain 4 kg mass (3 presses)',
    '按 X：把托盘转到 普通 4 kg 砝码（3 次）',
  ]);
  assert.deepEqual(adviceLine({ ...base, kind: 'place' }), [
    'Space: place the 3 kg mass on beam B peg -2',
    '按空格：把 3 kg 砝码放到 B 梁 -2 号孔',
  ]);
  assert.deepEqual(adviceLine({ ...base, pos: 3, kind: 'pick' }), [
    'Space: pick up the 3 kg mass from beam B peg +3',
    '按空格：从 B 梁 +3 号孔取下 3 kg 砝码',
  ]);
  // A vertical step names only the beam it reaches, a step along a beam names the peg.
  assert.deepEqual(adviceLine({ ...base, kind: 'move', dir: 3, steps: 2 }), [
    'Move ↑ 2 to beam B',
    '光标向上移 2 格到 B 梁',
  ]);
  assert.deepEqual(adviceLine({ ...base, kind: 'move', dir: 1, steps: 1 }), [
    'Move ↓ 1 to beam B',
    '光标向下移 1 格到 B 梁',
  ]);
  assert.deepEqual(adviceLine({ ...base, kind: 'move', dir: 0, steps: 3 }), [
    'Move → 3 to beam B peg -2',
    '光标向右移 3 格到 B 梁 -2 号孔',
  ]);
  const left = adviceLine({ ...base, kind: 'move', dir: 2, steps: 1 });
  assert.ok(left[0].startsWith('Move ← 1') && left[1].startsWith('光标向左移'));
  assert.deepEqual(adviceLine({ kind: 'undo' }), PLAIN.undo);
  assert.deepEqual(adviceLine({ kind: 'done' }), PLAIN.watch);
  for (const words of Object.values(PLAIN)) assert.ok(words[0] && /[一-鿿]/.test(words[1]));
});

// --- game: controls -------------------------------------------------------------------------------
test('Space places the selected mass on the peg under the cursor and picks a placed mass back up', () => {
  const { g, h } = open(1);
  const m = MACHINES[0];
  let st = g.getState();
  assert.equal(st.sel, 0);
  assert.equal(st.moves, 0);
  goTo(g, 0, colOf(m, 0, 3));
  press(g, 'Space');
  st = g.getState();
  assert.equal(st.weights[0].where, m.beams[0].slots[colOf(m, 0, 3)]);
  assert.equal(st.moves, 1);
  assert.equal(st.sel, -1, 'the tray is empty now');
  assert.equal(st.beams[0].tau, 0);
  assert.equal(st.board[0].split(' ')[colOf(m, 0, 3)], '2');
  assert.ok(h.sounds.includes('move'));
  press(g, 'Space');
  st = g.getState();
  assert.equal(st.weights[0].where, -1);
  assert.equal(st.sel, 0, 'a picked mass becomes the selected one');
  assert.equal(st.moves, 2);
  press(g, 'ArrowLeft');
  press(g, 'Space');
  assert.equal(g.getState().weights[0].where, m.beams[0].slots[colOf(m, 0, 2)]);
});

test('placing is refused on locked, fixed, hooked and tipper pegs, on the wrong rail, from an empty tray', () => {
  const say = (g) => g.getState().message?.en;
  const lockLevel = findMachine((m) => m.why.includes('locked'));
  let { g, h } = open(lockLevel);
  let m = MACHINES[lockLevel - 1];
  const lockId = m.why.indexOf('locked');
  goTo(g, m.slots[lockId].beam, colOf(m, m.slots[lockId].beam, m.slots[lockId].pos));
  const hits = h.sounds.filter((s) => s === 'hit').length;
  press(g, 'Space');
  assert.equal(say(g), 'This peg is locked');
  assert.equal(g.getState().message.zh, '这个孔被锁住了');
  assert.equal(g.getState().moves, 0);
  assert.equal(h.sounds.filter((s) => s === 'hit').length, hits + 1);

  const fixedId = m.why.indexOf('fixed');
  goTo(g, m.slots[fixedId].beam, colOf(m, m.slots[fixedId].beam, m.slots[fixedId].pos));
  press(g, 'Space');
  assert.equal(say(g), 'A fixed mass is bolted here');

  const hookId = m.why.indexOf('hook');
  goTo(g, m.slots[hookId].beam, colOf(m, m.slots[hookId].beam, m.slots[hookId].pos));
  press(g, 'Space');
  assert.equal(say(g), 'A beam hangs from this peg');

  const tipLevel = findMachine((mm) => mm.why.includes('target'));
  ({ g, h } = open(tipLevel));
  m = MACHINES[tipLevel - 1];
  const targetId = m.why.indexOf('target');
  goTo(g, m.slots[targetId].beam, colOf(m, m.slots[targetId].beam, m.slots[targetId].pos));
  press(g, 'Space');
  assert.equal(say(g), 'A tipper drops its mass here');

  // A sliding mass only goes on its own beam.
  const railLevel = findMachine((mm) => mm.weights.some((w) => w.rail >= 0 && w.at < 0));
  const railMachine = railLevel ? MACHINES[railLevel - 1] : null;
  const railOpen = railMachine ? open(railLevel) : null;
  if (railOpen) {
    const w = railMachine.weights.findIndex((x) => x.rail >= 0 && x.at < 0);
    const other = railMachine.beams.findIndex((b) => b.index !== railMachine.weights[w].rail);
    rotateTo(railOpen.g, w);
    const free = railMachine.beams[other].slots.find((id) => railMachine.usable[id]);
    goTo(railOpen.g, other, railMachine.beams[other].slots.indexOf(free));
    press(railOpen.g, 'Space');
    assert.match(say(railOpen.g), /slides only on beam/);
  }

  // A rail mass that starts on its beam can be lifted and slid; from the tray it needs its own beam.
  const slideLevel = findMachine((mm) => mm.weights.some((w) => w.at >= 0));
  const sm = MACHINES[slideLevel - 1];
  const sg = open(slideLevel);
  const sw = sm.weights.findIndex((w) => w.at >= 0);
  assert.equal(sg.g.getState().weights[sw].where, sm.weights[sw].at);
  const { beam, pos } = sm.slots[sm.weights[sw].at];
  goTo(sg.g, beam, colOf(sm, beam, pos));
  press(sg.g, 'Space');
  assert.equal(sg.g.getState().weights[sw].where, -1);
  assert.equal(sg.g.getState().sel, sw);
  const otherBeam = sm.beams.find((b) => b.index !== beam);
  const spot = otherBeam.slots.find((id) => sm.usable[id]);
  goTo(sg.g, otherBeam.index, otherBeam.slots.indexOf(spot));
  press(sg.g, 'Space');
  assert.match(say(sg.g), /slides only on beam/);
  assert.equal(sg.g.getState().weights[sw].where, -1);

  // An empty tray cannot place anything.
  const one = open(1);
  put(one.g, MACHINES[0], 0, 0, 3);
  assert.equal(one.g.getState().weights[0].where >= 0, true);
  goTo(one.g, 0, 0);
  press(one.g, 'Space');
  assert.equal(one.g.getState().message.en, 'The tray is empty');
  assert.equal(one.g.getState().message.zh, '托盘是空的');
  press(one.g, 'KeyX');
  assert.equal(one.g.getState().message.en, 'The tray is empty');
});

test('X rotates the tray over the masses that are still in it, and a single mass stays put', () => {
  const { g } = open(5);
  const st0 = g.getState();
  assert.equal(st0.sel, 0);
  press(g, 'KeyX');
  assert.equal(g.getState().sel, 1);
  press(g, 'KeyX');
  press(g, 'KeyX');
  assert.equal(g.getState().sel, 0);
  assert.equal(g.getState().moves, 0, 'rotating is free');
  const one = open(1);
  const sounds = one.h.sounds.length;
  press(one.g, 'KeyX');
  assert.equal(one.g.getState().sel, 0);
  assert.equal(one.h.sounds.length, sounds, 'nothing to rotate');
});

test('Z undoes the last move and refunds it, Q resets the machine, and both say so when there is nothing to do', () => {
  const { g } = open(5);
  const m = MACHINES[4];
  press(g, 'KeyZ');
  assert.equal(g.getState().message.en, 'Nothing to undo');
  put(g, m, 0, 0, 1);
  const afterOne = g.getState();
  assert.equal(afterOne.moves, 1);
  put(g, m, 1, 0, -1);
  assert.equal(g.getState().moves, 2);
  press(g, 'KeyZ');
  let st = g.getState();
  assert.equal(st.moves, 1);
  assert.equal(st.weights[1].where, -1);
  assert.equal(st.sel, 1, 'the selected mass comes back with the undo');
  assert.deepEqual(
    st.cursor,
    { row: 0, col: colOf(m, 0, -1) },
    'the cursor returns to the undone peg',
  );
  assert.equal(st.undos, 1);
  press(g, 'KeyZ');
  st = g.getState();
  assert.deepEqual(
    st.weights.map((w) => w.where),
    startOf(m),
  );
  press(g, 'KeyQ');
  st = g.getState();
  assert.equal(st.restarts, 1);
  assert.equal(st.undos, 2, 'a reset keeps the run totals');
  assert.equal(st.moves, 0);
  assert.equal(st.message.en, 'Machine reset');
  assert.equal(st.message.zh, '机器已重置');
  put(g, m, 0, 0, 1);
  press(g, 'KeyQ');
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().weights[0].where, -1);
});

test('arrows and WASD move the cursor, opposite or diagonal presses do nothing, and the tray row can be reached', () => {
  const { g, h } = open(9);
  const m = MACHINES[8];
  const start = g.getState().cursor;
  press(g, 'ArrowRight', 'ArrowLeft');
  press(g, 'ArrowRight', 'ArrowDown');
  press(g, 'ArrowUp', 'ArrowDown');
  assert.deepEqual(g.getState().cursor, start);
  press(g, 'KeyD');
  assert.equal(g.getState().cursor.col, start.col + 1);
  press(g, 'KeyA');
  press(g, 'KeyS');
  assert.equal(g.getState().cursor.row, start.row + 1);
  press(g, 'KeyW');
  assert.equal(g.getState().cursor.row, start.row);
  const sounds = h.sounds.length;
  for (let n = 0; n < 10; n++) press(g, 'ArrowUp');
  assert.equal(g.getState().cursor.row, 0);
  assert.equal(h.sounds.length - sounds <= 1, true, 'clamped moves are silent');
  for (let n = 0; n < 10; n++) press(g, 'ArrowDown');
  assert.equal(g.getState().cursor.row, m.beams.length, 'the tray row');
  // Space on a tray socket selects that mass; on a mass that is already placed it is refused.
  goTo(g, m.beams.length, 2);
  press(g, 'Space');
  assert.equal(g.getState().sel, 2);
  assert.equal(g.getState().moves, 0);
  put(
    g,
    m,
    3,
    0,
    m.beams[0].pegs.find((p, i) => m.usable[m.beams[0].slots[i]]),
  );
  goTo(g, m.beams.length, 3);
  press(g, 'Space');
  assert.equal(g.getState().message.en, 'That mass is already on a beam');
});

test('tapping a peg selects it, tapping again places or picks, and tapping a tray mass chooses it', () => {
  const { g } = open(5);
  const m = MACHINES[4];
  const lay = layoutOf(m);
  const at = (row, col) => {
    const r = cellRect(lay, m, row, col);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, clicked: true };
  };
  const tap = (p) => g.update(1 / 60, input([], [], p));
  const col = colOf(m, 0, 3);
  tap(at(0, col));
  assert.deepEqual(g.getState().cursor, { row: 0, col });
  assert.equal(g.getState().moves, 0, 'the first tap only selects');
  tap(at(0, col));
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().weights[0].where, m.beams[0].slots[col]);
  tap(at(0, col));
  assert.equal(g.getState().weights[0].where, -1, 'the second tap on a placed mass picks it up');
  tap(at(lay.nb, 2));
  assert.equal(g.getState().sel, 2);
  assert.deepEqual(g.getState().cursor, { row: 0, col }, 'a tray tap leaves the cursor alone');
  tap({ x: 2, y: 2, clicked: true });
  assert.deepEqual(g.getState().cursor, { row: 0, col });
  tap({ x: 100, y: 100, clicked: false });
  assert.equal(g.getState().sel, 2);
  // A tap on a mass that is already on a beam is refused.
  tap(at(0, col));
  tap(
    at(
      lay.nb,
      g.getState().weights.findIndex((w) => w.where >= 0),
    ),
  );
  assert.equal(g.getState().message.en, 'That mass is already on a beam');
});

// --- layout --------------------------------------------------------------------------------------
test('every peg and tray socket of every machine has its own on-canvas cell that the hit test finds', () => {
  for (const m of MACHINES) {
    const lay = layoutOf(m);
    const seen = new Set();
    m.beams.forEach((b, row) =>
      b.pegs.forEach((_, col) => {
        const r = cellRect(lay, m, row, col);
        assert.ok(r.x >= 0 && r.x + r.w <= 480 && r.y >= 0 && r.y + r.h <= GEO.bottom + 1);
        assert.deepEqual(hitTest(m, r.x + r.w / 2, r.y + r.h / 2), { row, col });
        assert.deepEqual(hitTest(m, r.x + 1, r.y + 1), { row, col });
        seen.add(`${row}:${col}`);
      }),
    );
    lay.chips.forEach((c, col) => {
      assert.ok(c.x >= 0 && c.x + c.w <= 480 && c.y + c.h <= 300);
      assert.deepEqual(hitTest(m, c.x + c.w / 2, c.y + c.h / 2), { row: lay.nb, col });
    });
    assert.equal(hitTest(m, -5, -5), null);
    assert.equal(hitTest(m, 479, 305), null);
    assert.equal(lay.rows.length, m.beams.length);
    for (let i = 1; i < lay.rows.length; i++) assert.ok(lay.rows[i].barY > lay.rows[i - 1].barY);
  }
});

test('the menu grid maps points to machine numbers and rejects everything else', () => {
  const M = GEO.menu;
  assert.equal(menuCellAt(M.x + 2, M.y + 2, MACHINE_COUNT), 1);
  assert.equal(menuCellAt(M.x + M.w * 5 + 2, M.y + 2, MACHINE_COUNT), 6);
  assert.equal(menuCellAt(M.x + 2, M.y + M.h + 2, MACHINE_COUNT), 7);
  assert.equal(menuCellAt(M.x + M.w * 5 + 2, M.y + M.h * 3 + 2, MACHINE_COUNT), 24);
  assert.equal(menuCellAt(M.x + M.w * 6 + 2, M.y + 2, MACHINE_COUNT), -1);
  assert.equal(menuCellAt(M.x - 1, M.y + 2, MACHINE_COUNT), -1);
  assert.equal(menuCellAt(M.x + 2, M.y - 1, MACHINE_COUNT), -1);
  assert.equal(menuCellAt(M.x + 2, M.y + M.h * 4 + 2, MACHINE_COUNT), -1);
  assert.equal(menuCellAt(M.x + 2, M.y + 2, 0), -1);
});

// --- campaign: clear, advance, loss, win, progress --------------------------------------------------
test('a balanced machine waits for the needles to settle, banks its score, saves progress and moves on', () => {
  const { g, h } = open(1);
  playPlan(g, MACHINES[0]);
  assert.equal(g.getState().solved, true);
  assert.equal(g.getState().cleared, false, 'not judged while the needles move');
  idle(g, 0.3);
  assert.equal(g.getState().cleared, false);
  assert.match(g.getState().line.en, /needles are settling/);
  idle(g, 1.2);
  let st = g.getState();
  assert.equal(st.cleared, true);
  assert.equal(st.score, 100);
  assert.match(st.line.en, /Machine balanced/);
  assert.match(st.line.zh, /已平衡/);
  assert.deepEqual(h.calls, [2]);
  assert.ok(h.sounds.includes('win'));
  g.draw(mockContext());
  idle(g, 2);
  st = g.getState();
  assert.equal(st.level, 2);
  assert.equal(st.cleared, false);
  assert.equal(st.moves, 0);
  // Space skips the pause.
  playPlan(g, MACHINES[1]);
  idle(g, 1.6);
  assert.equal(g.getState().cleared, true);
  press(g, 'Space');
  assert.equal(g.getState().level, 3);
  assert.equal(g.getState().score, 200);
  assert.equal(ENDS(h), 0);
});

test('extra moves cost 8 points each, down to a floor of 20', () => {
  const { g } = open(5);
  const m = MACHINES[4];
  // Waste two moves, then undo none of them: place wrong, pick it back, then solve.
  put(g, m, 0, 0, -1);
  press(g, 'Space');
  assert.equal(g.getState().moves, 2);
  playPlan(g, m);
  idle(g, 1.6);
  const st = g.getState();
  assert.equal(st.cleared, true);
  assert.equal(st.score, 100 - 8 * 2);
  assert.equal(RULES.minMachineScore, 20);
  assert.equal(Math.max(RULES.minMachineScore, RULES.clearScore - RULES.extraMovePenalty * 20), 20);
});

test('out of moves, unsolved: a visible 6 s countdown to undo runs once the needles rest, then the run is lost once', () => {
  const { g, h } = open(5);
  const m = MACHINES[4];
  const budget = m.budget;
  // Spend every move on the same peg, placing and picking.
  goTo(g, 0, colOf(m, 0, 1));
  for (let n = 0; n < budget; n++) press(g, 'Space');
  let st = g.getState();
  assert.equal(st.movesLeft, 0);
  assert.equal(st.phase, 'playing');
  assert.equal(st.graceLeft, RULES.loseGrace);
  assert.match(st.line.en, /press Z to undo/);
  press(g, 'Space');
  assert.equal(g.getState().message.en, 'No moves left: undo with Z');
  assert.equal(g.getState().moves, budget);
  // The countdown does not run while the needles are still swinging.
  idle(g, 0.2);
  assert.equal(g.getState().graceLeft, RULES.loseGrace);
  // A player who takes 1.5 s, or even 4 s, to find Undo still has time.
  idle(g, 1.5);
  assert.ok(g.getState().graceLeft < RULES.loseGrace && g.getState().graceLeft > 3);
  const spy = [];
  const ctx = mockContext();
  g.draw(
    new Proxy(ctx, {
      get: (t, p) => (p === 'fillText' ? (text) => spy.push(String(text)) : t[p]),
      set: (t, p, v) => ((t[p] = v), true),
    }),
  );
  assert.ok(
    spy.some((t) => /^Out of moves! Press Z to undo \(\d s\)$/.test(t)),
    spy.join('|'),
  );
  idle(g, 2.5);
  assert.equal(g.getState().phase, 'playing');
  press(g, 'KeyZ');
  st = g.getState();
  assert.equal(st.movesLeft, 1);
  assert.equal(st.graceLeft, null);
  idle(g, 10);
  assert.equal(g.getState().phase, 'playing', 'with a move left there is no countdown');
  // A player who does not undo loses once the countdown has run out.
  press(g, 'Space');
  assert.equal(g.getState().graceLeft, RULES.loseGrace);
  idle(g, RULES.loseGrace - 0.2);
  assert.equal(g.getState().phase, 'playing');
  idle(g, 1.5);
  st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(st.graceLeft, null);
  assert.equal(ENDS(h), 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Out of moves on machine 5/);
  assert.ok(h.sounds.includes('lose'));
  assert.match(st.line.en, /Out of moves/);
  assert.match(st.status.en, /Out of moves/);
  g.draw(mockContext());
  // A finished game ignores everything.
  const before = JSON.stringify(g.getState());
  press(g, 'Space', 'KeyZ', 'KeyQ');
  idle(g, 3);
  assert.equal(JSON.stringify(g.getState()), before);
  assert.equal(ENDS(h), 1);
});

test('clearing the last machine wins the run with the total score and one end call', () => {
  const { g, h } = open(MACHINE_COUNT);
  playPlan(g, MACHINES[MACHINE_COUNT - 1]);
  idle(g, 2);
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(st.score, 100);
  assert.equal(ENDS(h), 1);
  assert.deepEqual(h.ends[0], { won: true, score: 100, message: h.ends[0].message });
  assert.match(h.ends[0].message, /workshop is yours/);
  assert.match(st.line.en, /Every machine is balanced/);
  assert.match(st.line.zh, /全部机器已平衡/);
  assert.deepEqual(h.calls, [MACHINE_COUNT]);
  g.draw(mockContext());
  press(g, 'Space');
  idle(g, 5);
  assert.equal(ENDS(h), 1);
  const zh = open(MACHINE_COUNT, { lang: 'zh' });
  playPlan(zh.g, MACHINES[MACHINE_COUNT - 1]);
  idle(zh.g, 2);
  assert.match(zh.h.ends[0].message, /工坊归你了/);
});

test('a machine is also cleared when the final placement leaves some beams already balanced, and play is identical at 30, 60 and 120 Hz', () => {
  const states = [];
  for (const hz of [30, 60, 120]) {
    const { g } = open(10);
    const m = MACHINES[9];
    playPlan(g, m);
    idle(g, 1.7, hz);
    const st = g.getState();
    states.push(JSON.stringify([st.level, st.score, st.cleared, st.moves, st.phase]));
  }
  assert.equal(new Set(states).size, 1, states.join(' '));
});

// --- menu and progress --------------------------------------------------------------------------
test('with progress saved the game opens machine select; arrows, Space, Enter and taps choose a machine', () => {
  const { g, h } = open(1);
  assert.equal(g.getState().menu, null);
  const h2 = harness();
  h2.env.progress = { unlocked: () => 7, unlock() {} };
  const g2 = createGame(h2.env);
  let st = g2.getState();
  assert.deepEqual(st.menu, { sel: 7, unlocked: 7 });
  assert.match(st.line.en, /Choose a machine/);
  assert.equal(st.status.en, st.line.en);
  g2.draw(mockContext());
  press(g2, 'ArrowLeft');
  assert.equal(g2.getState().menu.sel, 6);
  press(g2, 'ArrowUp');
  assert.equal(g2.getState().menu.sel, 1, 'up a row of six, clamped');
  press(g2, 'KeyD');
  press(g2, 'ArrowDown');
  assert.equal(g2.getState().menu.sel, 7, 'down a row, clamped to the last open machine');
  for (let n = 0; n < 5; n++) press(g2, 'ArrowRight');
  assert.equal(g2.getState().menu.sel, 7, 'locked machines cannot be selected');
  press(g2, 'KeyA');
  idle(g2, 1);
  press(g2, 'Enter');
  st = g2.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 6);
  assert.equal(h2.sounds.includes('move'), true);
  // Taps: a tap on a tile selects it, a second tap starts it; locked tiles do nothing.
  const h3 = harness();
  h3.env.progress = { unlocked: () => 9, unlock() {} };
  const g3 = createGame(h3.env);
  const M = GEO.menu;
  const tile = (n) => ({
    x: M.x + ((n - 1) % M.cols) * M.w + 10,
    y: M.y + Math.floor((n - 1) / M.cols) * M.h + 10,
    clicked: true,
  });
  g3.update(1 / 60, input([], [], tile(3)));
  assert.equal(g3.getState().menu.sel, 3);
  g3.update(1 / 60, input([], [], tile(24)));
  assert.equal(g3.getState().menu.sel, 3);
  g3.update(1 / 60, input([], [], { x: 1, y: 1, clicked: true }));
  assert.equal(g3.getState().menu.sel, 3);
  g3.update(1 / 60, input([], [], tile(3)));
  assert.equal(g3.getState().menu, null);
  assert.equal(g3.getState().level, 3);
  assert.equal(ENDS(h), 0);
});

test('saved progress that is huge, negative, missing, not a number or throws is clamped or ignored', () => {
  for (const value of [Infinity, 1e9, MACHINE_COUNT + 5]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    assert.deepEqual(createGame(h.env).getState().menu, {
      sel: MACHINE_COUNT,
      unlocked: MACHINE_COUNT,
    });
  }
  for (const value of [-Infinity, 0, 1, NaN, 'abc', undefined]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    assert.equal(createGame(h.env).getState().menu, null, String(value));
  }
  const throwing = harness();
  throwing.env.progress = {
    unlocked() {
      throw new Error('storage blocked');
    },
    unlock() {
      throw new Error('storage blocked');
    },
  };
  const g = createGame(throwing.env);
  assert.equal(g.getState().menu, null);
  playPlan(g, MACHINES[0]);
  idle(g, 1.7);
  assert.equal(g.getState().cleared, true, 'a broken store must not stop the game');
  const none = harness();
  const bare = createGame(none.env);
  assert.equal(bare.getState().menu, null);
  playPlan(bare, MACHINES[0]);
  idle(bare, 1.7);
  assert.equal(bare.getState().cleared, true);
});

// --- robustness and drawing ---------------------------------------------------------------------
test('bad frame times and hostile input leave the game untouched', () => {
  const { g, h } = open(5);
  const before = JSON.stringify(g.getState());
  let reads = 0;
  const hostile = {
    held: () => (reads++, true),
    pressed: () => (reads++, true),
    pointer: { clicked: true, x: 100, y: 100 },
  };
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined]) g.update(dt, hostile);
  assert.equal(JSON.stringify(g.getState()), before);
  assert.equal(reads, 0);
  assert.equal(ENDS(h), 0);
  // A huge but finite step is capped, not simulated at once.
  const a = open(5);
  const b = open(5);
  a.g.update(5, input());
  for (let n = 0; n < 6; n++) b.g.update(1 / 60, input());
  b.g.update(0.1 - 6 / 60, input());
  assert.equal(JSON.stringify(a.g.getState().beams), JSON.stringify(b.g.getState().beams));
  const noPointer = { held: () => false, pressed: () => false };
  g.update(1 / 60, noPointer);
});

test('getState returns copies that cannot change the game', () => {
  const { g } = open(6);
  const a = g.getState();
  a.cursor.col = 99;
  a.board.length = 0;
  a.weights[0].where = 99;
  a.beams[0].pegs.length = 0;
  a.line.en = 'hacked';
  a.hint.row = 7;
  a.prompt.en = 'x';
  a.name.en = 'x';
  a.status.en = 'x';
  a.tip.zh = 'x';
  const b = g.getState();
  assert.notEqual(b.cursor.col, 99);
  assert.ok(b.board.length > 0);
  assert.notEqual(b.weights[0].where, 99);
  assert.ok(b.beams[0].pegs.length > 0);
  assert.notEqual(b.line.en, 'hacked');
  assert.notEqual(b.hint.row, 7);
  assert.equal(b.name.en, MACHINES[5].name.en);
  assert.ok(JSON.parse(JSON.stringify(b)));
  assert.equal(b.optimal, OPTIMAL[5]);
  assert.equal(b.budget, OPTIMAL[5] + 2);
  assert.equal(b.movesLeft, b.budget);
  assert.equal(open(1).g.getState().movesLeft, null);
});

test('status always ends with the prompt line and counts moves, gates and the machine number in both languages', () => {
  const { g } = open(9);
  const st = g.getState();
  assert.match(st.status.en, /^Machine 9\/24 · Moves 0\/6 · Gates 0\/3 · /);
  assert.match(st.status.zh, /^第 9\/24 台 · 步数 0\/6 · 指示灯 0\/3 · /);
  assert.ok(st.status.en.endsWith(st.line.en) && st.status.zh.endsWith(st.line.zh));
  assert.equal(st.prompt.id, st.hint.kind);
});

test('every screen draws without error: the menu, every machine in several states, the banners and every hint', () => {
  const ctx = mockContext();
  const texts = [];
  const spy = new Proxy(ctx, {
    get: (t, p) => (p === 'fillText' ? (s, x, y) => texts.push([String(s), x, y]) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const lang of ['en', 'zh']) {
    for (let level = 1; level <= MACHINE_COUNT; level++) {
      const { g } = open(level, { lang });
      g.draw(spy);
      const m = MACHINES[level - 1];
      // Scatter some masses, tilt the beams and show the denied-move message.
      for (let k = 0; k < m.weights.length; k++) {
        press(g, 'KeyX');
        press(g, 'ArrowRight');
        press(g, 'Space');
        idle(g, 0.2, 30);
        g.draw(spy);
      }
      press(g, 'ArrowDown', 'ArrowDown', 'ArrowDown');
      for (let k = 0; k < 4; k++) press(g, 'ArrowDown');
      g.draw(spy);
      press(g, 'Space');
      g.draw(spy);
      idle(g, 3, 30);
      g.draw(spy);
    }
    const menu = harness({ lang });
    menu.env.progress = { unlocked: () => 12, unlock() {} };
    createGame(menu.env).draw(spy);
  }
  assert.ok(texts.length > 2000);
  // Nothing is drawn off the 480 x 320 canvas.
  for (const [, x, y] of texts) assert.ok(x >= 0 && x <= 480 && y >= 0 && y <= 320, `${x},${y}`);
});

test('the banners, lamps, tippers and every kind of hint draw in a finished, lost and won game', () => {
  const spy = mockContext();
  const calls = [];
  const rec = new Proxy(spy, {
    get: (t, p) => (p === 'fillText' ? (s) => calls.push(String(s)) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const lang of ['en', 'zh']) {
    // Cleared banner.
    const a = open(1, { lang });
    playPlan(a.g, MACHINES[0]);
    idle(a.g, 1.6);
    a.g.draw(rec);
    // Lost banner.
    const b = open(5, { lang });
    goTo(b.g, 0, 0);
    for (let n = 0; n < MACHINES[4].budget; n++) press(b.g, 'Space');
    idle(b.g, 8);
    assert.equal(b.g.getState().phase, 'lost');
    b.g.draw(rec);
    // Won banner.
    const c = open(MACHINE_COUNT, { lang });
    playPlan(c.g, MACHINES[MACHINE_COUNT - 1]);
    idle(c.g, 2);
    c.g.draw(rec);
  }
  assert.ok(calls.some((t) => t === 'BALANCED') && calls.some((t) => t === 'OUT OF MOVES'));
  assert.ok(calls.some((t) => t === 'ALL MACHINES BALANCED'));
  assert.ok(calls.some((t) => t === '平衡了') && calls.some((t) => t === '步数用完'));
});

test('the gate lamps light only after the needles have come to rest, with a chime', () => {
  const { g, h } = open(1);
  playPlan(g, MACHINES[0]);
  assert.equal(g.getState().beams[0].ok, true);
  assert.equal(g.getState().beams[0].lamp, false, 'the needle is still swinging');
  assert.equal(g.getState().resting, false);
  idle(g, 0.8);
  assert.equal(g.getState().beams[0].lamp, true);
  assert.ok(h.sounds.includes('coin'));
  // Picking the mass back up puts the lamp out at once.
  const m = MACHINES[0];
  goTo(g, 0, colOf(m, 0, 3));
  idle(g, 0);
  press(g, 'Space');
  assert.equal(g.getState().beams[0].lamp, false);
});

test('the module exports stay in step with the machine data', () => {
  assert.equal(RULES.step, 1 / 120);
  assert.equal(pressesTo([-1, -1], 1, 0), 1);
  assert.equal(MACHINES.length, MACHINE_COUNT);
});
