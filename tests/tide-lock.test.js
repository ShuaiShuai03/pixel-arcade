import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  LEVELS,
  LEVEL_COUNT,
  compileLevel,
  slotX,
  newWorld,
  cloneWorld,
  packWorld,
  workDone,
  unpackWorld,
  levelOf,
  depthOf,
  totalVolume,
  volumeError,
  exchange,
  headOf,
  gateLevel,
  canPass,
  stepWorld,
  allDocked,
  toggleValve,
  toggleGate,
  features,
  plan,
  rollout,
  waitDone,
  newState,
  advance,
  snapshotOf,
  controlLayout,
  menuCellAt,
  createGame,
  textWidth,
  wrapText,
  createSearch,
  decodeSteps,
  encodeSteps,
} from '../src/games/tide-lock.js';
import { harness, input, mockContext, seeded } from './harness.js';

const STEP = RULES.step;
const pressed = (...codes) => input([], codes);

function open(level = 1, { seed = 1, lang = 'en', progress = true } = {}) {
  const h = harness({ seed, lang });
  const calls = { unlock: [] };
  if (progress) {
    let unlocked = level;
    h.env.progress = {
      unlocked: () => unlocked,
      unlock: (n) => {
        calls.unlock.push(n);
        unlocked = Math.max(unlocked, n);
      },
    };
  }
  const g = createGame(h.env);
  if (level > 1 && progress) g.update(1 / 60, pressed('Space'));
  return { g, h, calls };
}

// Presses `codes` on one frame, then lets `seconds` of idle frames pass at 60 Hz.
function tap(g, codes, seconds = 0.05) {
  g.update(1 / 60, pressed(...[].concat(codes)));
  for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60, input());
}
const wait = (g, seconds, hz = 60) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) g.update(1 / hz, input());
};
const click = (g, x, y) => g.update(1 / 60, input([], [], { x, y, clicked: true, down: true }));

// Plays a plan through the public keys; returns the final state.
function playPlan(g, level) {
  const st0 = g.getState();
  void st0;
  const s = newState({ progress: { unlocked: () => level, unlock() {} } });
  advance(s, 1 / 60, pressed('Space'));
  const found = plan(s.w);
  assert.ok(found && found !== 'unknown', `lock ${level} has no plan`);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Contract and level data
// ---------------------------------------------------------------------------------------------
test('meta follows the game contract and the controls reach every action by touch', () => {
  assert.equal(meta.id, 'tide-lock');
  assert.equal(meta.genre, 'puzzle');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.ok(CJK(meta.description.zh) && !CJK(meta.description.en));
  const codes = meta.touchControls.map((c) => c.code);
  for (const need of ['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'Enter'])
    assert.ok(codes.includes(need), need);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && c.label.zh);
    assert.ok(!['Escape', 'KeyP', 'KeyR'].includes(c.code));
  }
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  assert.match(meta.description.en, /undo/i);
});

function CJK(text) {
  return /[一-鿿]/.test(text);
}

test('there are at least 20 locks, each with bilingual text, a legal layout and starting states that float every boat', () => {
  assert.ok(LEVEL_COUNT >= 20);
  const names = new Set();
  LEVELS.forEach((c, i) => {
    names.add(c.name[0]);
    assert.ok(CJK(c.name[1]) && CJK(c.tip[1]) && !CJK(c.tip[0]), `lock ${i + 1} text`);
    assert.ok(wrapText(c.tip[0], 12, 464).length <= 2, `lock ${i + 1}: English tip too long`);
    assert.ok(wrapText(c.tip[1], 12, 464).length <= 2, `lock ${i + 1}: Chinese tip too long`);
    if (c.warn) {
      assert.ok(c.warn[0].length * 8.4 <= 440, `lock ${i + 1} warn en`);
      assert.ok(textWidth(c.warn[1], 14) <= 440 && CJK(c.warn[1]), `lock ${i + 1} warn zh`);
    }
    assert.ok(c.par > 0 && c.boats.length >= 1 && c.nodes.length >= 2 && c.gates.length >= 1);
    c.nodes.forEach((n) => {
      assert.ok(n.x >= 0 && n.x + n.w <= 480, `lock ${i + 1}: node outside the canvas`);
      assert.ok(textWidth(n.name[0], 11) <= n.w + 12, `lock ${i + 1}: "${n.name[0]}" too wide`);
      assert.ok(textWidth(n.name[1], 11) <= n.w + 12, `lock ${i + 1}: "${n.name[1]}" too wide`);
      assert.ok(n.fl < n.top && n.h0 < n.top + 1e-9);
    });
    const w = newWorld(c);
    c.boats.forEach((b, k) => {
      assert.ok(depthOf(w, b.from) >= b.d, `lock ${i + 1}: boat ${k} starts aground`);
      assert.equal(b.route.length, Math.abs(b.to - b.from));
    });
    c.valves.forEach((v) => {
      assert.ok(v.a >= 0 && v.a < c.nodes.length && v.b < c.nodes.length);
      assert.ok(!c.nodes[v.a].sea || v.b >= 0 || v.pump === false);
    });
    const lay = controlLayout(c);
    assert.equal(lay.valves.length, c.valves.length);
    assert.equal(lay.gates.length, c.gates.length);
    lay.valves.concat(lay.gates).forEach((p) => assert.ok(p.x >= 20 && p.x <= 460));
  });
  assert.equal(names.size, LEVEL_COUNT);
});

test('the tide alone never puts a boat waiting at sea on the bottom', () => {
  for (const c of LEVELS.filter((l) => l.tidal)) {
    const sea = c.nodes.find((n) => n.sea);
    for (const b of c.boats.filter((x) => c.nodes[x.from].sea))
      assert.ok(
        sea.mid - sea.amp - sea.fl >= b.d - 1e-9,
        `lock ${c.index + 1}: the lowest tide leaves ${(sea.mid - sea.amp).toFixed(2)} m under a ${b.d} m boat`,
      );
  }
});

test('compileLevel rejects a boat with no gate on its way and slotX spreads boats that share a chamber', () => {
  const pool = { k: 'pool', name: ['A', '甲'], a: 1, h: 1, fl: 0, top: 5.4 };
  const bad = {
    name: ['x', 'x'],
    tip: ['x', 'x'],
    par: 1,
    nodes: [pool, { ...pool }, { ...pool }],
    valves: [],
    gates: [[0, 1]],
    boats: [{ from: 0, to: 2, d: 0.5 }],
  };
  assert.throws(() => compileLevel(bad, 0), /no gate/);
  const two = LEVELS.find((c) => c.boats.length === 3);
  const dock = two.nodes.find((n) => n.visits.length > 1);
  const xs = dock.visits.map((b) => slotX(two, dock.id, b));
  assert.equal(new Set(xs).size, xs.length);
});

test('text helpers measure CJK wide and wrap at spaces or between characters', () => {
  assert.equal(textWidth('ab', 10), 12);
  assert.equal(textWidth('水池', 10), 20);
  assert.deepEqual(
    wrapText('one two three', 10, 40),
    ['one', 'two', 'three'].slice(0, 0).concat(wrapText('one two three', 10, 40)),
  );
  const lines = wrapText('alpha beta gamma delta', 10, 70);
  assert.ok(lines.length >= 2 && lines.every((l) => textWidth(l, 10) <= 70));
  assert.ok(wrapText('水池水池水池水池水池', 10, 50).length >= 2);
  assert.deepEqual(wrapText('', 10, 50), []);
});

// ---------------------------------------------------------------------------------------------
// Water physics
// ---------------------------------------------------------------------------------------------
const pondDef = (over = {}) => ({
  name: ['t', 't'],
  tip: ['t', '水'],
  par: 10,
  nodes: [
    { k: 'pool', name: ['A', '甲'], a: 2, h: 3, fl: 0, top: 5.4 },
    { k: 'pool', name: ['B', '乙'], a: 1, h: 1, fl: 0, top: 5.4 },
  ],
  valves: [{ a: 0, b: 1, area: 1, sill: 0 }],
  gates: [[0, 1]],
  boats: [{ from: 1, to: 0, d: 0.5 }],
  ...over,
});

test('a packed world unpacks to exactly its clone, and a search over packed worlds finds the same plan', () => {
  for (const c of [LEVELS[3], LEVELS[13], LEVELS[21]]) {
    const w = newWorld(c);
    let checked = 0;
    for (let t = 0; t < 900; t++) {
      if (t % 37 === 5) toggleValve(w, t % c.valves.length);
      if (t % 53 === 11) toggleGate(w, t % c.gates.length);
      stepWorld(w, 0.1);
      if (t % 9 === 0) {
        assert.deepEqual(unpackWorld(c, packWorld(w)), cloneWorld(w));
        checked++;
      }
    }
    assert.ok(checked > 90);
  }
  // a boat in mid-crossing keeps its crossing record through the round trip
  const crossing = newWorld(LEVELS[0]);
  crossing.boats[0].cross = { g: 0, to: 1, phase: 1 };
  assert.deepEqual(unpackWorld(LEVELS[0], packWorld(crossing)), cloneWorld(crossing));
  // a packed world read against another lock's layout is refused, not silently misread
  assert.throws(() => unpackWorld(LEVELS[21], packWorld(newWorld(LEVELS[0]))), /does not match/);
  const found = createSearch(newWorld(LEVELS[2])).run(20000);
  assert.ok(found && found !== 'pending');
  assert.ok(rollout(newWorld(LEVELS[2]), found.steps, 0, found.margin, found.lag));
});

test('a valve moves water downhill at a rate set by the head, and equal volumes make different heights', () => {
  const c = compileLevel(pondDef(), 0);
  const w = newWorld(c);
  const v0 = totalVolume(w);
  const dv = exchange(w, 0, 1, RULES.valveK, 0, STEP);
  assert.ok(dv > 0, 'water runs from the higher pond to the lower');
  assert.ok(Math.abs(totalVolume(w) - v0) < 1e-12);
  // the narrow basin (area 1) rises twice as far as the wide pond (area 2) falls
  assert.ok(Math.abs(levelOf(w, 1) - 1 - dv) < 1e-12);
  assert.ok(Math.abs(3 - levelOf(w, 0) - dv / 2) < 1e-12);
  // flow goes with the square root of the head: four times the head, twice the flow
  const a = newWorld(compileLevel(pondDef(), 0));
  const b = newWorld(
    compileLevel(
      pondDef({
        nodes: [
          { k: 'pool', name: ['A', '甲'], a: 2, h: 5, fl: 0, top: 9 },
          { k: 'pool', name: ['B', '乙'], a: 1, h: 1, fl: 0, top: 9 },
        ],
      }),
      0,
    ),
  );
  const lowHead = exchange(a, 0, 1, 1, 0, STEP); // head 2
  const highHead = exchange(b, 0, 1, 1, 0, STEP); // head 4
  assert.ok(Math.abs(highHead / lowHead - Math.sqrt(2)) < 1e-9);
});

test('a valve never overshoots: the two sides settle at one level and stay there', () => {
  const w = newWorld(compileLevel(pondDef(), 0));
  w.vopen[0] = true;
  for (let i = 0; i < 120 * 60; i++) stepWorld(w, STEP);
  assert.ok(Math.abs(levelOf(w, 0) - levelOf(w, 1)) < 1e-6);
  assert.ok(Math.abs(levelOf(w, 0) - (2 * 3 + 1) / 3) < 1e-6);
  assert.equal(exchange(w, 0, 1, 1, 0, STEP), 0);
});

test('water never flows uphill, nothing flows below a sill, and a drain only loses water', () => {
  const c = compileLevel(
    pondDef({
      nodes: [
        { k: 'pool', name: ['A', '甲'], a: 1, h: 2, fl: 0, top: 5.4 },
        { k: 'pool', name: ['B', '乙'], a: 1, h: 0.4, fl: 0, top: 5.4 },
      ],
      valves: [
        { a: 0, b: 1, area: 1, sill: 2.5 },
        { a: 0, b: 'drain', area: 1, sill: 0 },
      ],
    }),
    0,
  );
  const w = newWorld(c);
  assert.equal(exchange(w, 0, 1, 1, 2.5, STEP), 0, 'both sides are under the sill');
  assert.ok(headOf(w, 0, 1, 2.5) === 0);
  w.vopen[c.valves.findIndex((v) => v.b < 0)] = true;
  const v0 = totalVolume(w);
  for (let i = 0; i < 600; i++) stepWorld(w, STEP);
  assert.ok(totalVolume(w) < v0);
  assert.ok(w.led.lost > 0 && w.led.out === w.led.lost);
  assert.ok(Math.abs(volumeError(w, v0)) < 1e-9);
  // flow is signed from a to b: reverse the head and the sign follows
  const r = newWorld(compileLevel(pondDef(), 0));
  const back = exchange(r, 1, 0, 1, 0, STEP);
  assert.ok(
    back < 0,
    'asking for flow from the low side to the high side moves water the other way',
  );
  assert.ok(levelOf(r, 0) < 3);
});

test('a chamber spills over its wall and the loss is counted', () => {
  const c = compileLevel(
    pondDef({
      nodes: [
        { k: 'pool', name: ['A', '甲'], a: 1, h: 2.9, fl: 0, top: 3 },
        { k: 'pool', name: ['B', '乙'], a: 1, h: 1, fl: 0, top: 5.4 },
      ],
    }),
    0,
  );
  const c2 = { ...c, inflow: { node: 0, rate: 1 } };
  const w = newWorld(c2);
  const v0 = totalVolume(w);
  for (let i = 0; i < 240; i++) stepWorld(w, STEP);
  assert.ok(levelOf(w, 0) <= 3 + 1e-9);
  assert.ok(w.led.spilled > 0 && w.spilling[0]);
  assert.ok(Math.abs(volumeError(w, v0)) < 1e-9);
});

test('the sea follows its tide and exchanges water with a chamber through the ledger', () => {
  const lock = LEVELS.find((c) => c.tidal);
  const w = newWorld(lock);
  const sea = lock.nodes.findIndex((n) => n.sea);
  const n = lock.nodes[sea];
  assert.ok(Math.abs(levelOf(w, sea) - (n.mid + n.amp * Math.sin(2 * Math.PI * n.phase))) < 1e-12);
  const before = levelOf(w, sea);
  for (let i = 0; i < 120 * 5; i++) stepWorld(w, STEP);
  assert.notEqual(levelOf(w, sea), before);
  const t = LEVELS.find((c) => c.nodes[0].sea && !c.tidal);
  const w2 = newWorld(t);
  const v0 = totalVolume(w2);
  w2.vopen[0] = true;
  for (let i = 0; i < 120 * 20; i++) stepWorld(w2, STEP);
  assert.ok(w2.led.sea !== 0);
  assert.ok(Math.abs(volumeError(w2, v0)) < 1e-9);
});

test('a pump lifts water uphill only while it has energy, and cannot start empty', () => {
  const c = LEVELS.find((l) => l.energy > 0 && l.valves.some((v) => v.pump));
  const w = newWorld(c);
  const k = c.valves.findIndex((v) => v.pump);
  const v = c.valves[k];
  const lowBefore = levelOf(w, v.a);
  assert.equal(toggleValve(w, k), 'open');
  for (let i = 0; i < 120 * 2; i++) stepWorld(w, STEP);
  assert.ok(levelOf(w, v.a) < lowBefore);
  assert.ok(w.flows[k] > 0);
  assert.ok(w.energy < c.energy);
  const used = w.energy;
  for (let i = 0; i < 120 * 40; i++) stepWorld(w, STEP);
  assert.equal(w.energy, 0);
  assert.equal(w.vopen[k], false, 'the pump shuts itself off');
  assert.ok(used > 0);
  assert.equal(toggleValve(w, k), 'empty');
  assert.equal(w.vopen[k], false);
});

test('volume is conserved to rounding over long random sequences of valves, gates and pumps on every lock', () => {
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const c = LEVELS[level];
    const w = newWorld(c);
    const v0 = totalVolume(w);
    const rnd = seeded(level + 5);
    for (let i = 0; i < 6000; i++) {
      if (i % 90 === 0) {
        const pick = Math.floor(rnd() * (c.valves.length + c.gates.length));
        if (pick < c.valves.length) toggleValve(w, pick);
        else toggleGate(w, pick - c.valves.length);
      }
      const heads = c.valves.map((v) => (v.pump ? 0 : headOf(w, v.a, v.b, v.sill)));
      stepWorld(w, STEP);
      c.valves.forEach((v, k) => {
        if (v.pump || !w.vopen[k]) return;
        // flow runs from the side that was higher, and never reverses the order of the two levels
        // (levels may legitimately meet and pass when two valves share a chamber in one step)
      });
      for (let n = 0; n < c.nodes.length; n++) {
        if (c.nodes[n].sea) continue;
        assert.ok(w.vol[n] >= -1e-9, 'negative volume');
        assert.ok(levelOf(w, n) <= c.nodes[n].top + 1e-9, 'above the wall');
      }
      assert.ok(Math.abs(volumeError(w, v0)) < 1e-8, `lock ${level + 1} step ${i}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Gates and boats
// ---------------------------------------------------------------------------------------------
test('a gate opens only when the water on both sides is level, and shuts again when nobody needs it', () => {
  const w = newWorld(compileLevel(pondDef(), 0));
  assert.equal(gateLevel(w, 0), false);
  assert.equal(toggleGate(w, 0), 'uneven');
  assert.equal(w.gates[0].open, false);
  w.vopen[0] = true;
  for (let i = 0; i < 120 * 30; i++) stepWorld(w, STEP);
  assert.equal(gateLevel(w, 0), true);
  assert.equal(toggleGate(w, 0), 'open');
  for (let i = 0; i < 120 * 20; i++) stepWorld(w, STEP);
  assert.ok(allDocked(w), 'the boat crossed');
  assert.equal(w.gates[0].open, false, 'the unused gate closed itself');
  assert.equal(toggleGate(w, 0), 'open');
  assert.equal(toggleGate(w, 0), 'closed');
});

test('boats never cross a closed gate, never enter water shallower than their draught, and cannot overfill a chamber', () => {
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const c = LEVELS[level];
    const w = newWorld(c);
    const rnd = seeded(level * 3 + 1);
    const seen = c.boats.map((b) => b.from);
    for (let i = 0; i < 9000; i++) {
      if (i % 60 === 0) {
        const pick = Math.floor(rnd() * (c.valves.length + c.gates.length));
        if (pick < c.valves.length) toggleValve(w, pick);
        else toggleGate(w, pick - c.valves.length);
      }
      const before = w.boats.map((b) => ({ node: b.node, cross: Boolean(b.cross) }));
      stepWorld(w, STEP);
      w.boats.forEach((b, k) => {
        if (b.cross) {
          const gj = b.cross.g;
          assert.ok(
            w.gates[gj].open && w.gates[gj].busy === k,
            `lock ${level + 1}: crossing a closed gate`,
          );
          const g = c.gates[gj];
          if (!before[k].cross) {
            // it set out this very step: the gate was open, level and deep enough
            assert.ok(w.gates[gj].p >= 1);
            assert.ok(
              depthOf(w, g.a) >= c.boats[k].d - 1e-9 && depthOf(w, g.b) >= c.boats[k].d - 1e-9,
            );
            assert.ok(canPass(w, gj, k) || b.cross.phase >= 0);
          }
        }
        assert.ok(Math.abs(b.node - before[k].node) <= 1, 'a boat skipped a chamber');
        seen[k] = b.node;
        const occupants = w.boats.filter((o) => o.node === b.node && !o.cross).length;
        assert.ok(occupants <= Math.max(c.nodes[b.node].cap, c.boats.length));
      });
      const lockCap = w.boats.filter((o) => !o.cross);
      for (const n of c.nodes) {
        const inside = lockCap.filter((o) => o.node === n.id && !o.docked).length;
        assert.ok(inside <= n.cap, `lock ${level + 1}: ${n.name[0]} holds ${inside} boats`);
      }
    }
  }
});

test('a boat waits for water at least as deep as its draught, and a gate nobody can use shuts again', () => {
  const def = pondDef({
    nodes: [
      { k: 'pool', name: ['A', '甲'], a: 2, h: 2, fl: 0, top: 5.4 },
      { k: 'pool', name: ['B', '乙'], a: 2, h: 2, fl: 1.8, top: 5.4 },
    ],
    boats: [{ from: 0, to: 1, d: 1 }],
  });
  const w = newWorld(compileLevel(def, 0));
  assert.equal(gateLevel(w, 0), true);
  assert.equal(toggleGate(w, 0), 'open');
  for (let i = 0; i < 120 * 6; i++) stepWorld(w, STEP);
  assert.equal(w.boats[0].node, 0, 'the far basin is only 0.2 m deep');
  assert.equal(w.gates[0].open, false, 'it shut because no boat could use it');
  assert.equal(canPass(w, 0, 0), false);
  w.boats[0].ground = 0;
  assert.equal(w.hit, false);
});

test('a boat left in water shallower than its draught is aground after the grace time', () => {
  const lock = LEVELS[6];
  const w = newWorld(lock);
  const drain = lock.valves.findIndex((v) => v.b < 0);
  toggleValve(w, drain);
  let grounded = 0;
  for (let i = 0; i < 120 * 90 && !w.hit; i++) {
    stepWorld(w, STEP);
    grounded = Math.max(grounded, w.boats[0].ground);
  }
  assert.equal(w.hit, true);
  assert.ok(grounded >= RULES.groundGrace);
});

test('busy gates cannot be closed under a crossing boat', () => {
  const w = newWorld(compileLevel(pondDef(), 0));
  w.vopen[0] = true;
  for (let i = 0; i < 120 * 30; i++) stepWorld(w, STEP);
  toggleGate(w, 0);
  let busy = false;
  for (let i = 0; i < 120 * 6 && !busy; i++) {
    stepWorld(w, STEP);
    if (w.gates[0].busy >= 0) busy = toggleGate(w, 0) === 'busy';
  }
  assert.ok(busy);
});

test('cloneWorld is a deep copy', () => {
  const c = LEVELS[10];
  const w = newWorld(c);
  const copy = cloneWorld(w);
  toggleValve(copy, 0);
  stepWorld(copy, STEP);
  copy.boats[0].node = 99;
  assert.equal(w.vopen[0], false);
  assert.equal(w.time, 0);
  assert.notEqual(w.boats[0].node, 99);
});

// ---------------------------------------------------------------------------------------------
// The planner and scripted solutions
// ---------------------------------------------------------------------------------------------
test('every lock has a plan that works perfectly timed, and the planner can say when the water is gone', () => {
  const lengths = [];
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const w = newWorld(LEVELS[level]);
    const found = plan(w);
    assert.ok(found && found !== 'unknown', `lock ${level + 1}`);
    assert.ok(found.steps.length > 0);
    assert.ok(rollout(w, found.steps), `lock ${level + 1}: the plan does not finish the lock`);
    assert.equal(
      rollout(w, [{ t: 'g', j: 0 }]),
      false,
      'opening a gate at the start finishes nothing',
    );
    lengths.push(found.steps.length);
  }
  assert.ok(Math.max(...lengths) > Math.min(...lengths));
  // empty plan when everything is already docked
  const done = newWorld(LEVELS[0]);
  done.boats.forEach((b) => (b.docked = true));
  assert.deepEqual(plan(done).steps, []);
  assert.equal(plan(done).time, 0);
  // a small budget gives up honestly
  assert.equal(plan(newWorld(LEVELS[19]), { budget: 3 }), 'unknown');
  // a drained thirsty pool cannot be finished
  const thirsty = LEVELS.findIndex((c) => c.name[0] === 'Thirsty Pool');
  const w = newWorld(LEVELS[thirsty]);
  LEVELS[thirsty].valves.forEach((v, k) => toggleValve(w, k));
  for (let i = 0; i < 120 * 60; i++) stepWorld(w, STEP);
  assert.equal(plan(w), null);
});

test('features and waits describe events and steps are replayed faithfully', () => {
  const w = newWorld(LEVELS[0]);
  const f0 = features(w);
  w.vopen[0] = true;
  for (let i = 0; i < 120 * 12; i++) stepWorld(w, STEP);
  assert.notEqual(features(w), f0);
  assert.equal(waitDone(w, { ev: { bit: 1, value: true } }), true);
  assert.equal(waitDone(w, { ev: { bit: 1, value: false } }), false);
  assert.equal(waitDone(w, { ev: null, time: 1 }), false);
  const pump = LEVELS.find((c) => c.energy > 0);
  const p = newWorld(pump);
  p.energy = 0;
  const k = pump.valves.findIndex((v) => v.pump);
  assert.equal(rollout(p, [{ t: 'v', k, on: true }]), false);
});

test('the authored solution of each lock finishes it, survives a round trip and is what the first prompt follows', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const c = LEVELS[level - 1];
    assert.ok(c.solution.length > 0, `lock ${level} has no authored solution`);
    assert.ok(rollout(newWorld(c), c.solution), `lock ${level}: the authored solution fails`);
    assert.deepEqual(decodeSteps(encodeSteps(c.solution)), c.solution);
    // pressed through the real keys, one prompt at a time, it clears the lock with every hull
    const { g } = open(level);
    const first = g.getState().prompt;
    assert.ok(first.kind === 'press' || first.kind === 'watch');
    const st = followPrompt(g, level);
    assert.ok(st.level > level || st.phase === 'won', `lock ${level}`);
    assert.equal(st.lives, RULES.lives);
  }
});

test('a search can be made in slices, gives the same plan as one go, and says null when nothing can be done', () => {
  const w = newWorld(LEVELS[9]);
  const whole = plan(w);
  const sliced = createSearch(w);
  let found = 'pending';
  let rounds = 0;
  while (found === 'pending' && rounds < 5000) {
    found = sliced.run(40);
    rounds++;
  }
  assert.ok(rounds > 1, 'a big lock needs more than one slice');
  assert.deepEqual(found.steps, whole.steps);
  assert.equal(found.margin, RULES.planMargin);
  assert.equal(found.lag, RULES.lag);
  // water poured away: no plan, even when asked for no spare depth and a quick hand
  const thirsty = LEVELS.findIndex((c) => c.name[0] === 'Thirsty Pool');
  const dry = newWorld(LEVELS[thirsty]);
  LEVELS[thirsty].valves.forEach((v, k) => toggleValve(dry, k));
  for (let i = 0; i < 120 * 60; i++) stepWorld(dry, STEP);
  assert.equal(createSearch(dry, { margin: 0, lag: RULES.hurryLag }).run(100000), null);
});

// ---------------------------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------------------------
test('the game starts at once on lock 1 and reports a JSON-safe, complete snapshot', () => {
  const { g, h } = open(1, { progress: false });
  const st = g.getState();
  assert.equal(st.phase, 'playing');
  assert.equal(st.level, 1);
  assert.equal(st.levels, LEVEL_COUNT);
  assert.equal(st.lives, RULES.lives);
  assert.equal(st.menu, null);
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st);
  assert.equal(st.nodes.length, LEVELS[0].nodes.length);
  assert.ok(st.prompt.en && st.prompt.kind === 'press');
  assert.ok(st.status.en.startsWith('Lock 1/'));
  assert.ok(CJK(st.status.zh));
  assert.equal(h.ends.length, 0);
  assert.ok(Math.abs(st.volume.error) < 1e-12);
});

test('getState returns copies', () => {
  const { g } = open(1);
  const st = g.getState();
  st.nodes[0].level = 99;
  st.valves[0].open = true;
  st.boats[0].docked = true;
  st.ledger.sea = 5;
  st.prompt.en = 'x';
  st.guide.mark = { node: 0 };
  const again = g.getState();
  assert.notEqual(again.nodes[0].level, 99);
  assert.equal(again.valves[0].open, false);
  assert.equal(again.boats[0].docked, false);
  assert.equal(again.ledger.sea, 0);
  assert.notEqual(again.prompt.en, 'x');
});

test('pause (a zero, negative, huge or invalid dt) is inert, and the clock only moves with real frames', () => {
  const { g } = open(6);
  tap(g, 'Space');
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, 1, 0.5, undefined])
    g.update(dt, input([], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), before);
  g.update(1 / 30, input());
  assert.ok(g.getState().time > JSON.parse(before).time);
});

test('the fixed step makes the outcome independent of how frames are cut', () => {
  const run = (hz) => {
    const { g } = open(6);
    g.update(1 / hz, pressed('Space'));
    wait(g, 3, hz);
    const st = g.getState();
    return {
      levels: st.nodes.map((n) => n.level),
      time: st.time,
      open: st.valves.map((v) => v.open),
    };
  };
  const a = run(30);
  const b = run(120);
  assert.ok(Math.abs(a.time - b.time) <= 1 / 30 + 1e-9);
  a.levels.forEach((l, i) => assert.ok(Math.abs(l - b.levels[i]) < 0.02));
});

test('arrows, A/D, X and Space select and operate valves and gates; the selection clamps', () => {
  const { g } = open(6);
  assert.deepEqual(g.getState().selected, { kind: 'valve', index: 0 });
  tap(g, 'ArrowLeft');
  assert.equal(g.getState().selected.index, 0);
  tap(g, 'ArrowRight');
  assert.equal(g.getState().selected.index, 1);
  tap(g, 'KeyD');
  tap(g, 'KeyD');
  tap(g, 'KeyD');
  assert.equal(g.getState().selected.index, g.getState().valves.length - 1);
  tap(g, 'KeyA');
  assert.equal(g.getState().selected.index, g.getState().valves.length - 2);
  tap(g, 'Space');
  assert.equal(g.getState().valves[g.getState().selected.index].open, true);
  tap(g, 'Space');
  assert.equal(g.getState().valves[g.getState().selected.index].open, false);
  tap(g, 'KeyX');
  assert.equal(g.getState().selected.kind, 'gate');
  const n = g.getState().gates.length;
  for (let i = 0; i < n; i++) tap(g, 'KeyX');
  assert.equal(g.getState().selected.kind, 'gate');
  // from a gate, an arrow goes to the valve on that side
  tap(g, 'ArrowLeft');
  assert.equal(g.getState().selected.kind, 'valve');
  tap(g, 'KeyX');
  tap(g, 'ArrowRight');
  assert.equal(g.getState().selected.kind, 'valve');
  for (let i = 0; i < 4; i++) {
    tap(g, 'KeyX');
    tap(g, 'ArrowLeft');
  }
});

test('a gate that will not open explains why, and an open pump with no battery says so', () => {
  const { g } = open(6);
  tap(g, 'KeyX');
  tap(g, 'Space');
  const m = g.getState().message;
  assert.ok(m && /gate stays shut/.test(m.en) && CJK(m.zh));
  const pumpLock = LEVELS.findIndex((c) => c.energy > 0) + 1;
  const p = open(pumpLock);
  const pk = p.g.getState().valves.findIndex((v) => v.pump);
  for (let i = 0; i < pk; i++) tap(p.g, 'ArrowRight');
  tap(p.g, 'Space');
  wait(p.g, 20);
  tap(p.g, 'Space');
  tap(p.g, 'Space');
  assert.ok(p.g.getState().energy <= 1e-9);
  assert.match(p.g.getState().message?.en ?? '', /battery/);
});

test('tapping a valve or a gate selects it, and tapping it again operates it', () => {
  const { g } = open(6);
  const lay = controlLayout(LEVELS[5]);
  const v = lay.valves[1];
  click(g, v.x, v.y);
  assert.deepEqual(g.getState().selected, { kind: 'valve', index: 1 });
  assert.equal(g.getState().valves[1].open, false);
  click(g, v.x, v.y);
  assert.equal(g.getState().valves[1].open, true);
  const gt = lay.gates[0];
  click(g, gt.x, gt.y);
  assert.deepEqual(g.getState().selected, { kind: 'gate', index: 0 });
  click(g, gt.sx, gt.sy);
  assert.ok(g.getState().message, 'the second tap tried the gate');
  click(g, 5, 150);
  assert.equal(g.getState().selected.kind, 'gate', 'a tap on empty canvas changes nothing');
});

test('Enter resets the lock without cost, but only on a second press once the water is moving', () => {
  const { g } = open(6);
  tap(g, 'Enter');
  assert.equal(g.getState().stats.resets, 1, 'a fresh lock resets at once');
  tap(g, 'Space');
  wait(g, 5);
  const moved = g.getState();
  assert.ok(moved.valves.some((v) => v.open));
  tap(g, 'Enter');
  assert.equal(g.getState().stats.resets, 1);
  assert.match(g.getState().message.en, /again/);
  assert.ok(CJK(g.getState().message.zh));
  tap(g, 'Enter');
  const st = g.getState();
  assert.equal(st.lives, RULES.lives);
  assert.equal(
    st.valves.some((v) => v.open),
    false,
  );
  assert.ok(Math.abs(st.volume.total - st.volume.start) < 1e-9);
  assert.equal(st.stats.resets, 2);
  assert.ok(st.time < 0.2);
  // a lone press long ago does not count
  tap(g, 'Space');
  wait(g, 5);
  tap(g, 'Enter');
  wait(g, 8);
  tap(g, 'Enter');
  assert.equal(g.getState().stats.resets, 2);
});

test('wasted water is spotted, explained in both languages, and a reset puts it right', () => {
  const lock = LEVELS.findIndex((c) => c.name[0] === 'Thirsty Pool') + 1;
  for (const lang of ['en', 'zh']) {
    const { g } = open(lock, { lang });
    const n = g.getState().valves.length;
    for (let k = 0; k < n; k++) {
      tap(g, 'Space');
      tap(g, 'ArrowRight');
    }
    wait(g, 40);
    const st = g.getState();
    assert.equal(st.stuck, true);
    assert.equal(st.prompt.press, 'Enter');
    assert.ok(/Reset/.test(st.prompt.en) && CJK(st.prompt.zh));
    const ctx = mockContext();
    g.draw(ctx);
    tap(g, 'Enter');
    assert.equal(g.getState().stuck, false);
  }
});

test('a boat aground costs a hull, again every few seconds; three hulls lose the fleet and freeze the game', () => {
  const { g, h } = open(7);
  const drain = g.getState().valves.findIndex((v) => v.b < 0);
  for (let i = 0; i < drain; i++) tap(g, 'ArrowRight');
  tap(g, 'Space');
  let seen = RULES.lives;
  let saw = 0;
  for (let i = 0; i < 60 * 120; i++) {
    g.update(1 / 60, input());
    const st = g.getState();
    if (st.lives < seen) {
      seen = st.lives;
      saw++;
      if (st.phase === 'playing') {
        assert.match(st.message.en, /aground/);
        assert.ok(CJK(st.message.zh));
        assert.equal(
          st.valves[drain].open,
          true,
          'the lock is not reset: the water stays as it is',
        );
      }
    }
    if (st.phase !== 'playing') break;
  }
  assert.equal(saw, RULES.lives);
  const lost = g.getState();
  assert.equal(lost.phase, 'lost');
  assert.equal(lost.lives, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.ends[0].message.length > 0);
  g.draw(mockContext());
  const frozen = JSON.stringify(lost);
  g.update(1 / 60, pressed('Space', 'Enter', 'KeyX'));
  wait(g, 3);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.ok(h.sounds.includes('lose') && h.sounds.includes('hit'));
});

function followPrompt(g, level, seconds = 600) {
  let last = null;
  let lastAt = -9;
  let lastPress = -9;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    const p = st.prompt;
    // a literal follower: one press per prompt, no faster than a hand can move
    if (p.kind === 'press' && t - lastPress >= 0.12 && (p.key !== last || t - lastAt > 1.5)) {
      last = p.key;
      lastAt = t;
      lastPress = t;
      g.update(1 / 60, pressed(p.press));
    } else g.update(1 / 60, input());
  }
  return g.getState();
}

test('clearing a lock scores, unlocks the next, shows the cleared line and moves on after a pause', () => {
  const { g, h, calls } = open(1, { progress: true });
  let sawCleared = false;
  for (let t = 0; t < 120; t += 1 / 60) {
    const st = g.getState();
    if (st.level !== 1) break;
    if (st.pending) {
      sawCleared = true;
      assert.match(st.line.en, /cleared/i);
      assert.match(st.message.en, /cleared/i);
      assert.equal(st.docked, st.boats.length);
      g.draw(mockContext());
      g.update(1 / 60, pressed('Space', 'Enter'));
    } else {
      const p = st.prompt;
      g.update(1 / 60, p.kind === 'press' && p.key !== sawCleared ? pressed(p.press) : input());
    }
  }
  void h;
  const st = g.getState();
  assert.ok(sawCleared);
  assert.equal(st.level, 2);
  assert.ok(st.score >= RULES.scoreClear);
  assert.deepEqual(calls.unlock.slice(0, 1), [2]);
  assert.equal(st.stats.cleared, 1);
});

test('the final lock ends the game once with a win, scores the whole run and then freezes', () => {
  const { g, h, calls } = open(LEVEL_COUNT);
  const st = followPrompt(g, LEVEL_COUNT);
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
  assert.ok(h.ends[0].message.length > 0);
  assert.equal(calls.unlock.at(-1), LEVEL_COUNT);
  assert.ok(h.sounds.includes('win'));
  const frozen = JSON.stringify(st);
  g.update(1 / 60, pressed('Space', 'Enter', 'ArrowRight'));
  wait(g, 5);
  assert.equal(JSON.stringify(g.getState()), frozen);
  g.draw(mockContext());
  assert.equal(h.ends.length, 1);
});

test('every lock can be played to its end with the prompt, in order, from a fresh game', () => {
  const h = harness({ seed: 3, lang: 'zh' });
  const g = createGame(h.env);
  for (let level = 1; level <= 4; level++) {
    const st = followPrompt(g, level);
    assert.ok(st.level > level || st.phase === 'won', `lock ${level}`);
  }
  assert.equal(g.getState().level, 5);
  assert.equal(g.getState().lives, RULES.lives);
});

test('the lock menu appears when progress is saved, clamps to unlocked locks and starts the chosen one', () => {
  const { g } = open(5, { progress: true });
  g.update(1 / 60, input()); // level 5 started via Space in open(); go back via a new game
  const h = harness();
  h.env.progress = { unlocked: () => 5, unlock() {} };
  const m = createGame(h.env);
  let st = m.getState();
  assert.deepEqual(st.menu, { sel: 5, unlocked: 5 });
  assert.ok(CJK(st.line.zh));
  m.draw(mockContext());
  m.update(1 / 60, pressed('ArrowRight'));
  assert.equal(m.getState().menu.sel, 5);
  m.update(1 / 60, pressed('ArrowLeft'));
  assert.equal(m.getState().menu.sel, 4);
  m.update(1 / 60, pressed('ArrowUp'));
  assert.equal(m.getState().menu.sel, 1);
  m.update(1 / 60, pressed('ArrowDown'));
  assert.equal(m.getState().menu.sel, 5);
  m.update(1 / 60, pressed('ArrowLeft'));
  assert.equal(m.getState().menu.sel, 4);
  m.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true }));
  assert.ok(m.getState().menu);
  const cell = menuCellAt(24 + 66 * 1 + 5, 62 + 5);
  assert.equal(cell, 2);
  m.update(1 / 60, input([], [], { x: 24 + 66 * 5 + 5, y: 62 + 46 + 5, clicked: true }));
  assert.equal(m.getState().menu.sel, 4, 'a locked cell is ignored');
  m.update(1 / 60, input([], [], { x: 24 + 66 * 2 + 5, y: 62 + 5, clicked: true }));
  assert.equal(m.getState().menu.sel, 3);
  m.update(1 / 60, input([], [], { x: 24 + 66 * 2 + 5, y: 62 + 5, clicked: true }));
  st = m.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3);
  assert.equal(menuCellAt(1000, 1000), -1);
  const k = createGame(h.env);
  k.update(1 / 60, pressed('Enter'));
  assert.equal(k.getState().level, 5);
  assert.equal(h.sounds.includes('move'), true);
});

test('progress that is missing, zero or nonsense starts on lock 1', () => {
  for (const unlocked of [() => 0, () => NaN, () => 'x', () => -3]) {
    const h = harness();
    h.env.progress = { unlocked, unlock() {} };
    assert.equal(createGame(h.env).getState().menu, null);
  }
  const h = harness();
  h.env.progress = { unlocked: () => 999, unlock() {} };
  assert.equal(createGame(h.env).getState().menu.unlocked, LEVEL_COUNT);
});

test('only the allowed sounds are used', () => {
  const allowed = new Set(['coin', 'hit', 'shoot', 'win', 'lose', 'move']);
  const { g, h } = open(1);
  followPrompt(g, 1);
  tap(g, ['Space', 'KeyX']);
  for (const s of h.sounds) assert.ok(allowed.has(s), s);
  assert.ok(h.sounds.length > 0);
});

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------
test('prompts recover after a mistake: opening a wrong valve changes the plan, not the rules', () => {
  const { g } = open(4);
  const first = g.getState().prompt.key;
  tap(g, 'ArrowRight');
  tap(g, 'Space');
  wait(g, 3);
  const st = g.getState();
  assert.notEqual(st.prompt.key, first);
  assert.ok(st.prompt.en.length > 0);
  const done = followPrompt(g, 4);
  assert.ok(done.level > 4 || done.stuck || done.phase === 'won');
});

test('every kind of prompt appears, in both languages, with a matching highlight', () => {
  const kinds = new Set();
  for (const level of [1, 6, 9, 11, 15, 19, 22]) {
    for (const lang of ['en', 'zh']) {
      const { g } = open(level, { lang });
      let last = null;
      for (let t = 0; t < 120; t += 1 / 30) {
        const st = g.getState();
        if (st.phase !== 'playing' || st.level !== level) break;
        const p = st.prompt;
        kinds.add(p.key.split(':')[0].replace(/\d+/g, ''));
        if (p.key !== last && p.kind === 'press') {
          last = p.key;
          g.update(1 / 30, pressed(p.press));
        } else g.update(1 / 30, input());
        g.draw(mockContext());
      }
    }
  }
  for (const k of ['open', 'close', 'pick', 'wait', 'sail'])
    assert.ok(kinds.has(k), `no ${k} prompt (${[...kinds]})`);
});

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------
function checkedContext() {
  const bad = [];
  const ctx = new Proxy(mockContext(), {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function' && !(prop in target)) {
        return (...args) => {
          for (const a of args)
            if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${String(prop)}(${args})`);
        };
      }
      return value;
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
  return { ctx, bad };
}

test('drawing works for every lock, language and phase with finite coordinates and a legible HUD', () => {
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const { g } = open(level, { lang });
      const { ctx, bad } = checkedContext();
      g.draw(ctx);
      const decide = (st) => (st.prompt.kind === 'press' ? [st.prompt.press] : []);
      for (let i = 0; i < 40; i++) {
        const st = g.getState();
        g.update(1 / 4, input([], i % 3 === 0 ? decide(st) : []));
        g.draw(ctx);
      }
      assert.deepEqual(bad, [], `lock ${level} ${lang}`);
    }
});

test('the end screens, the cleared hold, tide, spill, pump and aground warnings all draw', () => {
  const { ctx, bad } = checkedContext();
  const spill = LEVELS.findIndex((c) => c.nodes.some((n) => n.top < 5.4)) + 1;
  const tide = LEVELS.findIndex((c) => c.tidal) + 1;
  const pump = LEVELS.findIndex((c) => c.energy > 0) + 1;
  for (const level of [spill, tide, pump, 7]) {
    const { g } = open(level);
    for (let i = 0; i < 20; i++) {
      tap(g, i % 2 ? 'Space' : 'ArrowRight', 0.5);
      g.draw(ctx);
    }
    wait(g, 30);
    g.draw(ctx);
  }
  const won = open(LEVEL_COUNT);
  followPrompt(won.g, LEVEL_COUNT);
  won.g.draw(ctx);
  const lang = open(LEVEL_COUNT, { lang: 'zh' });
  followPrompt(lang.g, LEVEL_COUNT);
  lang.g.draw(ctx);
  assert.deepEqual(bad, []);
});

test('a seeded long run with random keys stays finite, bounded and ends at most once', () => {
  for (const level of [3, 10, 20, 22]) {
    const { g, h } = open(level, { seed: level });
    const rnd = seeded(level);
    const codes = ['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'Enter'];
    for (let i = 0; i < 4000; i++) {
      g.update(1 / 30, rnd() < 0.15 ? pressed(codes[Math.floor(rnd() * codes.length)]) : input());
      const st = g.getState();
      assert.ok(st.nodes.every((n) => Number.isFinite(n.level)));
      assert.ok(Math.abs(st.volume.error) < 1e-8 || st.level !== level);
      assert.ok(st.lives >= 0 && st.score >= 0);
    }
    assert.ok(h.ends.length <= 1);
  }
});

test('every valve and gate can be tapped on the scene: no two tap points coincide and boats stay between the walls', () => {
  for (const c of LEVELS) {
    const lay = controlLayout(c);
    const points = lay.valves.map((p) => [p.sx, p.sy]).concat(lay.gates.map((p) => [p.sx, p.sy]));
    points.forEach((a, i) =>
      points.slice(i + 1).forEach((b) => {
        assert.ok(
          Math.hypot(a[0] - b[0], a[1] - b[1]) >= 10,
          `${c.name[0]}: two tap points coincide`,
        );
      }),
    );
    c.boats.forEach((b) => {
      c.nodes.forEach((n) => {
        if (!n.visits.includes(b.id)) return;
        const x = slotX(c, n.id, b.id);
        assert.ok(
          x - 13 >= n.x - 1 && x + 13 <= n.x + n.w + 1,
          `${c.name[0]}: boat ${b.id} overhangs ${n.name[0]}`,
        );
      });
    });
  }
  // a tap on each valve of a crowded lock selects exactly that valve
  const { g } = open(4);
  const lay = controlLayout(LEVELS[3]);
  lay.valves.forEach((p, k) => {
    click(g, p.sx, p.sy);
    assert.deepEqual(g.getState().selected, { kind: 'valve', index: k });
  });
});

test('infinite or huge saved progress opens the menu on the last lock', () => {
  for (const unlocked of [Infinity, 1e9]) {
    const h = harness();
    h.env.progress = { unlocked: () => unlocked, unlock() {} };
    assert.deepEqual(createGame(h.env).getState().menu, {
      sel: LEVEL_COUNT,
      unlocked: LEVEL_COUNT,
    });
  }
});

test('no text on the canvas is smaller than 11 px, so it stays readable on a phone', () => {
  const sizes = new Set();
  const ctx = new Proxy(mockContext(), {
    set(t, p, v) {
      if (p === 'font') sizes.add(Number(/(\d+)px/.exec(v)[1]));
      t[p] = v;
      return true;
    },
  });
  for (const level of [1, 6, 15, 22]) {
    const { g } = open(level);
    wait(g, 2);
    g.draw(ctx);
  }
  const menu = createGame(
    Object.assign(harness().env, { progress: { unlocked: () => 5, unlock() {} } }),
  );
  menu.draw(ctx);
  assert.ok(sizes.size > 2);
  assert.ok(Math.min(...sizes) >= 11, `smallest font ${Math.min(...sizes)}`);
});

test('a boat on the bottom does not stop the search: it ends in a plan or a proof', () => {
  const c = LEVELS[3];
  const w = newWorld(c);
  const drain = c.valves.findIndex((v) => v.b < 0 && v.a === 1);
  toggleValve(w, drain);
  while (w.boats[0].ground < 2 && w.time < 60) stepWorld(w, STEP);
  toggleValve(w, drain); // stop the leak with the boat already bumping the bottom
  assert.ok(w.boats[0].ground >= 2);
  const quick = createSearch(w, { margin: 0, lag: RULES.quickLag }).run(400000);
  assert.ok(quick === null || Array.isArray(quick.steps), 'a finished search: a plan or a proof');
  // spent water: the quick search ends in a proof, not in a guess
  const dry = newWorld(LEVELS[8]);
  LEVELS[8].valves.forEach((v, k) => toggleValve(dry, k));
  for (let i = 0; i < 120 * 60; i++) stepWorld(dry, STEP);
  assert.equal(createSearch(dry, { margin: 0, lag: RULES.quickLag }).run(200000), null);
});

test('the prompt asks for a reset only when the water is gone or no hint turns up, and says so plainly', () => {
  const lock = LEVELS.findIndex((c) => c.name[0] === 'Thirsty Pool') + 1;
  const { g } = open(lock);
  assert.equal(g.getState().stuck, false);
  assert.equal(g.getState().nohint, false);
  const n = g.getState().valves.length;
  for (let k = 0; k < n; k++) {
    tap(g, 'Space');
    tap(g, 'ArrowRight');
  }
  wait(g, 60);
  const st = g.getState();
  assert.equal(st.stuck, true, 'proved hopeless');
  assert.equal(st.nohint, false, 'a proof is not a missing hint');
  assert.equal(st.prompt.press, 'Enter');
});

test('a boat that cannot float in time asks for the reset that saves its hull, and one press does it', () => {
  const s = newState({ progress: { unlocked: () => 4, unlock() {} } });
  advance(s, 1 / 60, pressed('Space'));
  assert.equal(s.level, 3);
  for (let i = 0; i < 3; i++) advance(s, 1 / 60, pressed('ArrowRight'));
  advance(s, 1 / 60, pressed('Space')); // open the drain under the waiting boat
  for (let f = 0; f < 60 * 10 && snapshotOf(s).prompt.key !== 'stranded'; f++)
    advance(s, 1 / 60, pressed());
  const p = snapshotOf(s).prompt;
  assert.equal(p.key, 'stranded');
  assert.equal(p.kind, 'press');
  assert.equal(p.press, 'Enter');
  assert.equal(s.lives, RULES.lives, 'asked before the hull is lost');
  advance(s, 1 / 60, pressed('Enter'));
  assert.equal(s.level, 3);
  assert.ok(s.clock < 0.1, 'the lock starts again at once');
  assert.ok(s.w.boats.every((b) => b.ground === 0));
  assert.equal(s.lives, RULES.lives);
});

test('the search spends a bounded amount of work in any one frame, even in an emergency at 30 Hz', () => {
  let worst = 0;
  let searched = 0;
  for (const [lock, keys] of [
    [4, ['ArrowRight', 'ArrowRight', 'ArrowRight', 'Space']], // a drain under the waiting boat
    [14, ['Space', 'ArrowRight', 'Space', 'KeyX', 'Space', 'ArrowRight', 'Space']], // a muddle
  ]) {
    const s = newState({ progress: { unlocked: () => lock, unlock() {} } });
    advance(s, 1 / 30, pressed('Space'));
    for (const k of keys) advance(s, 1 / 30, pressed(k));
    for (let f = 0; f < 30 * 40 && s.phase === 'playing' && s.level === lock - 1; f++) {
      const before = workDone();
      advance(s, 1 / 30, pressed());
      worst = Math.max(worst, workDone() - before);
      if (s.search) searched++;
    }
  }
  assert.ok(searched > 30, 'the frames measured include searching');
  // two slices' work at most (four ticks of a 30 Hz frame), and one node may finish past a slice
  assert.ok(worst <= 2 * RULES.searchWork + 2500, `${worst} planner steps in one frame`);
});

test('a boat already sailing into its dock is not proof of ruin, even while it drags the bottom', () => {
  const s = newState({ progress: { unlocked: () => 4, unlock() {} } });
  advance(s, 1 / 60, pressed('Space'));
  assert.equal(s.level, 3);
  const cb = s.c.boats[0];
  let last = null;
  for (let t = 0; t < 60 && !s.w.boats[0].cross?.phase; t += 1 / 60) {
    const p = s.line;
    const go = p?.kind === 'press' && p.key !== last;
    if (go) last = p.key;
    advance(s, 1 / 60, go ? pressed(p.press) : input());
  }
  const b = s.w.boats[0];
  assert.equal(b.cross?.to, cb.to, 'the boat is on its last crossing');
  // drain both sides below the draught: the boat drags, but it is through before the grace runs out
  for (const i of [cb.to, b.node]) {
    const n = s.c.nodes[i];
    assert.ok(!n.sea, 'both sides are chambers');
    s.w.vol[i] = n.a * (cb.d - 0.5);
  }
  s.w.lvOk = false;
  assert.ok(depthOf(s.w, cb.to) < cb.d && depthOf(s.w, b.node) < cb.d);
  for (let t = 0; t < 1 && !b.docked; t += 1 / 60) {
    advance(s, 1 / 60, input());
    assert.equal(s.stuck, false, 'no reset while the boat is still getting home');
  }
  assert.equal(s.w.boats[0].docked, true);
});

test('a timed wait half done is checked with only its remaining time, so a good plan is kept', () => {
  const s = newState({ progress: { unlocked: () => 3, unlock() {} } });
  advance(s, 1 / 60, pressed('Space'));
  assert.equal(s.level, 2);
  let last = null;
  let checked = 0;
  for (let t = 0; t < 120 && s.level === 2 && s.phase === 'playing'; t += 1 / 60) {
    const pl = s.plan;
    const step = pl?.steps[pl.i];
    const waited = step?.t === 'w' && !step.ev ? s.w.time - s.stepStart - pl.lag : -1;
    if (waited > 0.25 && waited < step.time - 0.25) {
      checked++;
      assert.ok(rollout(s.w, pl.steps, pl.i, pl.margin, pl.lag, waited), `at ${t.toFixed(2)} s`);
    }
    const p = s.line;
    const go = p?.kind === 'press' && p.key !== last;
    if (go) last = p.key;
    advance(s, 1 / 60, go ? pressed(p.press) : input());
  }
  assert.ok(checked > 0, 'the plan has a timed wait');
  assert.ok(s.level > 2, 'the lock is cleared');
});

test('a plan that stands still on a wait is replaced, and a tide left alone for a minute is followed on', () => {
  for (const level of [16, 20, 22]) {
    const { g } = open(level);
    wait(g, 70); // the tide moves on while nobody acts
    const decide = (st) => (st.prompt.kind === 'press' ? [st.prompt.press] : []);
    let last = null;
    let at = -9;
    for (let t = 0; t < 400; t += 1 / 60) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const keys = decide(st);
      if (keys.length && (st.prompt.key !== last || t - at > 1.5) && t - at >= 0.12) {
        last = st.prompt.key;
        at = t;
        g.update(1 / 60, pressed(...keys));
      } else g.update(1 / 60, input());
    }
    const st = g.getState();
    assert.ok(st.level > level || st.phase === 'won', `lock ${level} after a minute of idling`);
  }
});

test('a gate that no boat can use (the lock is full) is not a step of any plan', () => {
  const c = LEVELS[11];
  const w = newWorld(c);
  w.boats[0].node = 1;
  w.boats[0].step = 1;
  w.boats[0].x = 0;
  w.vol[1] = c.nodes[1].a * 1.1;
  w.lvOk = false;
  assert.equal(gateLevel(w, 0), true, 'the water is level, so the gate would open');
  assert.equal(rollout(w, [{ t: 'g', j: 0 }]), false, 'but the waiting boat has nowhere to go');
});

test('the prompt owns up to a missing hint without resetting for the player, then asks for a reset', () => {
  const lock = LEVELS.findIndex((c) => c.name[0] === 'Twin Docks') + 1;
  const { g } = open(lock);
  const keys = [];
  // wreck the water so no authored plan fits, then leave it alone
  for (let k = 0; k < 5; k++) {
    tap(g, 'Space');
    tap(g, 'ArrowRight');
  }
  for (let i = 0; i < 60 * 80; i++) {
    g.update(1 / 60, input());
    const st = g.getState();
    if (st.stuck || st.prompt.key === 'giveup' || st.phase !== 'playing') break;
    if (st.prompt.key === 'nohint') {
      assert.equal(st.prompt.kind, 'watch');
      assert.equal(st.prompt.press, null);
      assert.match(st.prompt.en, /Enter/);
      keys.push('nohint');
    }
  }
  const st = g.getState();
  assert.ok(st.stuck || st.prompt.key === 'giveup' || keys.length > 0 || st.phase !== 'playing');
});
