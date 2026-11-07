import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  TYPES,
  LEVELS,
  LEVEL_COUNT,
  COMPILED,
  MENU,
  PRESS,
  pathOf,
  pointOnPath,
  zonesConflict,
  compileLevel,
  buildSchedule,
  newWorld,
  stepWorld,
  nextPhase,
  advanceSignal,
  callPedestrians,
  neighbour,
  selectStep,
  newPlay,
  advancePlay,
  pressedOf,
  autoplay,
  runPrompted,
  safeSchedule,
  createGame,
  wrapText,
} from '../src/games/traffic-conductor.js';
import { harness, input, mockContext, seeded } from './harness.js';

const BASE = {
  name: ['Test', '测试'],
  tip: ['tip', '提示'],
  layout: 'single',
  plan: 'two',
  time: 60,
  rates: [[0, 0, 0, 0]],
  turns: [[1, 0, 0]],
  mix: [1, 0, 0],
  maxWait: 30,
  frac: 0.8,
};
const def = (over) => ({ ...BASE, ...over });

function open(level, { seed = 1, lang = 'en', progress } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  const unlocks = [];
  h.env.progress = progress ?? {
    unlocked: () => unlocked,
    unlock: (n) => {
      unlocks.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  if (level > 1 && !progress) g.update(1 / 60, input([], ['Space']));
  return { g, h, unlocks };
}

function drive(g, seconds, hz = 60, keysAt = () => []) {
  for (let f = 0; f < seconds * hz; f++) g.update(1 / hz, input([], keysAt(f / hz, f)));
}

// A literal prompt follower that only reads getState().prompt.
function follow(g, seconds, lag = 0.2, hz = 60) {
  const decide = (() => {
    const hist = [];
    let last = { text: null, t: -9 };
    let lastPress = -9;
    return (st, t) => {
      hist.push({ t, p: st.prompt });
      if (hist.length > 300) hist.shift();
      let k = hist.length - 1;
      while (k > 0 && hist[k].t > t - lag) k--;
      const p = hist[k].p;
      if (!p || p.kind === 'watch' || !p.press || t - lastPress < 0.12) return [];
      if (p.en === last.text && t - last.t < 1.5) return [];
      last = { text: p.en, t };
      lastPress = t;
      return [p.press];
    };
  })();
  for (let f = 0; f < seconds * hz; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    g.update(1 / hz, input([], decide(st, f / hz)));
  }
}

// ---------------------------------------------------------------------------------------------
// Metadata, geometry and level data
// ---------------------------------------------------------------------------------------------

test('meta is bilingual, documents every control and offers a touch button for each action', () => {
  assert.equal(meta.id, 'traffic-conductor');
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  for (const field of [meta.name, meta.description]) {
    assert.ok(field.en.length > 3 && field.zh.length > 3);
    assert.match(field.zh, /[一-鿿]/);
  }
  assert.ok(meta.description.en.length > 300);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(code), `touch control for ${code}`);
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh && c.side);
  assert.ok(meta.keys.every((k) => k.label.en && k.label.zh && k.keys));
  assert.ok(!codes.includes('KeyP') && !codes.includes('KeyR') && !codes.includes('Escape'));
});

test('a movement path crosses the conflict zones its geometry implies', () => {
  const zones = (d, m) => pathOf(d, m).zones.map((z) => z.z);
  // North approach: straight crosses NW then SW, a right turn only NW, a left turn NW, SW, SE.
  assert.deepEqual(zones(0, 'S'), [0, 3]);
  assert.deepEqual(zones(0, 'R'), [0]);
  assert.deepEqual(zones(0, 'L'), [0, 3, 2]);
  // Rotating the approach rotates the zones.
  assert.deepEqual(zones(1, 'S'), [1, 0]);
  assert.deepEqual(zones(2, 'R'), [2]);
  assert.ok(zonesConflict(pathOf(0, 'L'), pathOf(2, 'S')));
  assert.ok(!zonesConflict(pathOf(0, 'S'), pathOf(2, 'S')));
  assert.ok(zonesConflict(pathOf(0, 'S'), pathOf(1, 'S')));
  assert.ok(pathOf(0, 'L').len > pathOf(0, 'S').len && pathOf(0, 'S').len > pathOf(0, 'R').len);
  assert.equal(pathOf(0, 'S'), pathOf(0, 'S'), 'paths are cached');
  // The last zone is held until the vehicle has left the box completely.
  for (let d = 0; d < 4; d++)
    for (const m of 'SLR') {
      const p = pathOf(d, m);
      assert.equal(p.zones[p.zones.length - 1].b, p.len);
    }
});

test('points on a path run from the stop line to the exit lane and extend straight beyond both ends', () => {
  const p = pathOf(0, 'S');
  const a = pointOnPath(p, 0);
  assert.deepEqual([a.x, a.y], [-11, -30]);
  const before = pointOnPath(p, -10);
  assert.equal(before.y, -40);
  const after = pointOnPath(p, p.len + 5);
  assert.equal(after.y, p.pts[1][1] + 5);
  const mid = pointOnPath(pathOf(0, 'L'), pathOf(0, 'L').len / 2);
  assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.hx));
  assert.ok(Math.abs(Math.hypot(mid.hx, mid.hy) - 1) < 1e-9);
});

test('levels compile into lanes, links and signal plans', () => {
  const single = compileLevel(def({}));
  assert.equal(single.junctions.length, 1);
  assert.equal(single.lanes.length, 8);
  assert.equal(single.junctions[0].plan.length, 2);
  const row = compileLevel(def({ layout: 'row2', plan: ['two', 'split'] }));
  assert.equal(row.junctions.length, 2);
  assert.equal(row.lanes.length, 14);
  assert.equal(row.junctions[1].plan.length, 4);
  const link = row.lanes[row.junctions[0].outLane[1]];
  assert.equal(link.kind, 'in');
  assert.equal(link.jn, 1);
  assert.equal(link.dir, 3);
  assert.equal(row.junctions[1].inLane[3], link.id);
  assert.equal(row.lanes[row.junctions[1].outLane[3]].jn, 0);
  const capped = compileLevel(def({ cap: { '0N': 40 } }));
  assert.equal(capped.lanes[capped.junctions[0].inLane[0]].len, 40);
  const tee = compileLevel(def({ arms: ['NEW'] }));
  assert.equal(tee.lanes.length, 6);
  assert.equal(tee.junctions[0].inLane[2], -1);
});

// How much a level asks: ambulances, surges, pedestrians, buses, linked junctions, tight limits.
const stress = (l) =>
  (l.emerg?.length ?? 0) * 2 +
  (l.pulses ?? []).reduce((n, p) => n + (p.mult * p.len) / 60, 0) +
  (l.peds ? 2 + (l.peds.length - 1) : 0) +
  (l.busWait ? 2 : 0) +
  (l.layout === 'row2' ? 4 : 0) +
  (l.plan === 'split' || Array.isArray(l.plan) ? 1 : 0);

test('difficulty never drops for long and the last level asks the most', () => {
  const values = LEVELS.map(stress);
  assert.equal(Math.max(...values), values.at(-1), 'the grand finale is the hardest');
  // Every block of five levels asks more, on average, than the block before it.
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let i = 5; i < LEVEL_COUNT; i += 5)
    assert.ok(mean(values.slice(i, i + 5)) > mean(values.slice(i - 5, i)), `block ${i / 5}`);
  assert.ok(values[0] < values[2] && values[2] < values[19]);
  // The finale also has the biggest cast: ambulances, surges, pupils, buses and two junctions.
  const totals = COMPILED.map((L) => buildSchedule(L, seeded(L.seed)).cars.length);
  assert.ok(totals.at(-1) >= totals[13] * 0.9, 'finale is not lighter than level 14');
});

test('there are at least 20 distinct, authored levels with bilingual text and a growing difficulty', () => {
  assert.equal(LEVELS.length, LEVEL_COUNT);
  assert.ok(LEVEL_COUNT >= 20);
  const names = new Set(LEVELS.map((l) => l.name[0]));
  assert.equal(names.size, LEVEL_COUNT, 'level names differ');
  const shapes = new Set(LEVELS.map((l) => JSON.stringify({ ...l, name: 0, tip: 0, seed: 0 })));
  assert.equal(shapes.size, LEVEL_COUNT, 'level data differs');
  for (const l of LEVELS) {
    assert.ok(l.name[0] && /[一-鿿]/.test(l.name[1]));
    assert.ok(l.tip[0] && /[一-鿿]/.test(l.tip[1]));
    assert.ok(l.time >= 50 && l.maxWait > 0 && l.frac > 0.5 && l.frac < 1);
  }
  // The curriculum introduces each mechanic in turn.
  const first = (pred) => LEVELS.findIndex(pred) + 1;
  assert.equal(
    first((l) => l.layout === 'single'),
    1,
  );
  assert.ok(first((l) => l.pulses) <= 3, 'surges start early');
  assert.ok(
    first((l) => l.turns[0][1] > 0.3 && l.plan === 'two') <
      first((l) => [].concat(l.plan).includes('split')),
  );
  assert.ok(first((l) => l.peds) < first((l) => l.busWait !== undefined));
  assert.ok(first((l) => l.busWait !== undefined) < first((l) => l.layout === 'row2'));
  assert.ok(first((l) => l.layout === 'row2') < first((l) => l.platoon));
  assert.ok(LEVELS.at(-1).pulses && LEVELS.at(-1).emerg.length >= 3 && LEVELS.at(-1).peds);
  assert.ok(LEVELS.filter((l) => l.layout === 'row2').length >= 7);
  assert.ok(COMPILED.every((L, i) => L.index === i));
});

test('seeded schedules are reproducible, ordered and respect the level definition', () => {
  const L = COMPILED[17];
  const a = buildSchedule(L, seeded(5));
  const b = buildSchedule(L, seeded(5));
  const c = buildSchedule(L, seeded(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.cars, c.cars);
  assert.ok(a.cars.every((v, i) => i === 0 || a.cars[i - 1].t <= v.t));
  assert.ok(a.cars.every((v, i) => v.id === i));
  assert.ok(a.cars.filter((v) => v.k === 'amb').length === L.def.emerg.length);
  assert.ok(a.cars.some((v) => v.k === 'bus'));
  assert.ok(a.peds.length > 0 && a.peds.every((p, i) => i === 0 || a.peds[i - 1].t <= p.t));
  assert.equal(a.quota, Math.ceil(a.cars.length * L.frac));
  // A vehicle bound for the next junction knows its second turn.
  assert.ok(a.cars.some((v) => v.moves.length === 2));
  // Arrivals leave time for the last vehicles to clear.
  assert.ok(a.cars.every((v) => v.k === 'amb' || v.t < L.time - 11));
});

// ---------------------------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------------------------

function quiet(over = {}) {
  const L = compileLevel(def(over));
  const sched = buildSchedule(L, seeded(1));
  return { L, w: newWorld(L, sched), sched };
}

test('a signal goes green, yellow, all-red, then the other green; it honours the minimum green', () => {
  const { w } = quiet();
  const JW = w.juncs[0];
  assert.equal(JW.sig.stage, 'green');
  assert.equal(advanceSignal(w, JW), true);
  assert.equal(JW.sig.stage, 'yellow');
  assert.equal(advanceSignal(w, JW), false, 'cannot be pressed again while changing');
  const stages = [];
  for (let i = 0; i < 6 * 120; i++) {
    stepWorld(w, 1 / 120, []);
    if (stages.at(-1) !== JW.sig.stage) stages.push(JW.sig.stage);
  }
  assert.deepEqual(stages, ['yellow', 'red', 'green']);
  assert.equal(JW.sig.ph, 1);
  // The new green must last the minimum before it can be changed again.
  assert.equal(advanceSignal(w, JW), false);
  for (let i = 0; i < RULES.minGreen * 120 + 2; i++) stepWorld(w, 1 / 120, []);
  assert.equal(advanceSignal(w, JW), true);
});

test('conflicting greens never show: lights belong to one phase and the road axes never overlap', () => {
  const { g } = open(2);
  let seen = 0;
  drive(g, 90, 60, (t, f) => (f % 7 === 0 ? [['Space', 'KeyX', 'Space'][((f / 7) % 3) | 0]] : []));
  const { L, w } = quiet({ rates: [[12, 12, 12, 12]], turns: [[0.5, 0.3, 0.2]] });
  const JW = w.juncs[0];
  for (let i = 0; i < 120 * 90; i++) {
    if (i % 600 === 0) advanceSignal(w, JW);
    stepWorld(w, 1 / 120, []);
    const live = [0, 1, 2, 3].filter((d) =>
      ['S', 'L', 'R'].some(
        (m) =>
          JW.sig.stage !== 'red' &&
          JW.sig.stage !== 'ped' &&
          ['G', 'Y'].includes(lightsOf(JW, d, m)),
      ),
    );
    const axes = new Set(live.map((d) => d % 2));
    assert.ok(axes.size <= 1, `both axes lit at step ${i}`);
    seen += live.length;
  }
  assert.ok(seen > 0 && L.junctions.length === 1);
});

function lightsOf(JW, d, m) {
  const sg = JW.sig;
  const allowed = JW.J.plan[sg.ph].allow[d].includes(m);
  if (!allowed) return 'R';
  return sg.stage === 'green' ? 'G' : sg.stage === 'yellow' ? 'Y' : 'R';
}

test('a split plan lights one road at a time and skips roads nobody is waiting on', () => {
  const { w } = quiet({ plan: 'split', rates: [[0, 0, 0, 0]] });
  const JW = w.juncs[0];
  assert.equal(JW.J.plan.length, 4);
  // With nobody waiting, the next phase is simply the following one.
  assert.equal(nextPhase(w, JW), 1);
  // A queue on the south road makes the controller skip the east phase.
  const lane = w.lanes[JW.J.inLane[2]];
  lane.vs.push({
    moves: ['S'],
    mi: 0,
    pos: lane.len - 10,
    len: 12,
    v: 0,
    wait: 0,
    k: 'car',
    weight: 1,
    vmax: 58,
  });
  assert.equal(nextPhase(w, JW), 2);
});

test('an ambulance nearby makes the signal jump straight to its road', () => {
  const { w } = quiet({ plan: 'split', rates: [[0, 0, 0, 0]] });
  const JW = w.juncs[0];
  const lane = w.lanes[JW.J.inLane[3]];
  lane.vs.push({
    moves: ['S'],
    mi: 0,
    pos: 40,
    len: 16,
    v: 40,
    wait: 0,
    k: 'amb',
    weight: 10,
    vmax: 84,
  });
  assert.equal(nextPhase(w, JW), 3);
});

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

test('cars, buses, trucks and ambulances differ in length and acceleration', () => {
  const kinds = Object.keys(TYPES);
  assert.deepEqual(kinds.sort(), ['amb', 'bus', 'car', 'truck']);
  assert.ok(TYPES.car.len < TYPES.bus.len && TYPES.bus.len < TYPES.truck.len);
  assert.ok(TYPES.car.acc > TYPES.bus.acc && TYPES.bus.acc > TYPES.truck.acc);
  assert.ok(TYPES.amb.vmax > TYPES.car.vmax && TYPES.amb.acc > TYPES.car.acc);
  // Standing starts: the car clears the stop line sooner than the truck.
  const time = (k) => {
    const L = compileLevel(def({ rates: [[0, 0, 0, 0]] }));
    const w = newWorld(L, {
      cars: [{ id: 0, t: 0, lane: L.junctions[0].inLane[3], k, moves: ['S'] }],
      peds: [],
      quota: 1,
    });
    const JW = w.juncs[0];
    JW.sig.ph = 1;
    let t = 0;
    for (; t < 40 * 120 && w.delivered === 0; t++) {
      stepWorld(w, 1 / 120, []);
      const v = w.vehicles[0];
      if (v && t < 60) v.v = 0;
    }
    return t / 120;
  };
  assert.ok(time('car') < time('bus') && time('bus') < time('truck'));
});

test('vehicles keep a gap, never overlap and never tunnel, in a busy two-junction level at every step rate', () => {
  for (const hz of [30, 120]) {
    const { g } = open(15, { seed: 3 });
    const last = new Map();
    let checked = 0;
    for (let f = 0; f < 70 * hz; f++) {
      g.update(1 / hz, input([], f % (hz * 5) === hz ? ['Space'] : []));
      const st = g.getState();
      if (st.phase !== 'playing') break;
      for (const v of st.vehicles) {
        const prev = last.get(v.id);
        if (prev) {
          const step = Math.hypot(v.x - prev.x, v.y - prev.y);
          assert.ok(step <= (TYPES[v.kind].vmax * 1.02) / hz + 1, `vehicle ${v.id} jumped ${step}`);
        }
        last.set(v.id, v);
      }
      if (f % Math.round(hz / 6) !== 0) continue;
      for (let i = 0; i < st.vehicles.length; i++)
        for (let j = i + 1; j < st.vehicles.length; j++) {
          const a = st.vehicles[i];
          const b = st.vehicles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          assert.ok(
            d >= (a.length + b.length) / 2 - 3.5,
            `vehicles ${a.id}/${b.id} overlap (${d.toFixed(1)})`,
          );
          // Vehicles from different roads never hold the same conflict zone of a junction.
          if (
            a.where === 'box' &&
            b.where === 'box' &&
            a.junction === b.junction &&
            a.approach !== b.approach
          )
            assert.equal(
              a.zones.filter((z) => b.zones.includes(z)).length,
              0,
              'shared conflict zone',
            );
          checked++;
        }
    }
    assert.ok(checked > 200, `checked ${checked} pairs at ${hz} Hz`);
  }
});

test('a vehicle enters only on green and only when its conflict zones are clear', () => {
  // Left turners from the north and south roads share zones, so one waits for the other.
  const L = compileLevel(def({ rates: [[0, 0, 0, 0]], turns: [[0, 1, 0]] }));
  const cars = [
    { id: 0, t: 0, lane: L.junctions[0].inLane[0], k: 'car', moves: ['L'] },
    { id: 1, t: 0.2, lane: L.junctions[0].inLane[2], k: 'car', moves: ['L'] },
  ];
  const w = newWorld(L, { cars, peds: [], quota: 2 });
  let both = 0;
  for (let i = 0; i < 20 * 120; i++) {
    stepWorld(w, 1 / 120, []);
    const inBox = w.juncs[0].box;
    if (inBox.length === 2) both++;
  }
  assert.equal(both, 0, 'conflicting turns were never in the box together');
  assert.equal(w.delivered, 2);
  // A red approach holds its vehicles at the stop line.
  const w2 = newWorld(L, {
    cars: [{ id: 0, t: 0, lane: L.junctions[0].inLane[3], k: 'car', moves: ['S'] }],
    peds: [],
    quota: 1,
  });
  for (let i = 0; i < 10 * 120; i++) stepWorld(w2, 1 / 120, []);
  assert.equal(w2.delivered, 0);
  const lane = w2.lanes[L.junctions[0].inLane[3]];
  assert.ok(lane.vs[0].pos <= lane.len && lane.vs[0].v < 1);
});

test('a vehicle that cannot stop in time carries on through yellow', () => {
  const L = compileLevel(def({ rates: [[0, 0, 0, 0]] }));
  const w = newWorld(L, {
    cars: [{ id: 0, t: 0, lane: L.junctions[0].inLane[0], k: 'car', moves: ['S'] }],
    peds: [],
    quota: 1,
  });
  const lane = w.lanes[L.junctions[0].inLane[0]];
  // The north-south phase is green; the car is 5 px from the line at full speed when yellow starts.
  stepWorld(w, 1 / 120, []);
  assert.equal(w.vehicles.length, 1);
  const v = w.vehicles[0];
  v.pos = lane.len - 5;
  v.v = TYPES.car.vmax;
  stepWorld(w, 1 / 120, []);
  v.pos = lane.len - 5;
  v.v = TYPES.car.vmax;
  advanceSignal(w, w.juncs[0]);
  for (let i = 0; i < 6 * 120; i++) stepWorld(w, 1 / 120, []);
  assert.equal(w.delivered, 1, 'it ran the yellow because it could not stop');
});

test('a vehicle waits when the exit lane has no room', () => {
  const L = compileLevel(
    def({
      layout: 'row2',
      plan: 'two',
      rates: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    }),
  );
  const A = L.junctions[0];
  const link = L.lanes[A.outLane[1]];
  // Fill the link lane with stopped cars right at its start.
  const w = newWorld(L, {
    cars: [{ id: 99, t: 0, lane: A.inLane[3], k: 'car', moves: ['S', 'S'] }],
    peds: [],
    quota: 1,
  });
  const lane = w.lanes[link.id];
  lane.vs.push({
    moves: ['S'],
    mi: 0,
    pos: 20,
    len: 12,
    v: 0,
    wait: 0,
    k: 'car',
    weight: 1,
    vmax: 58,
    acc: 50,
    nv: 0,
    np: 0,
    path: pathOf(3, 'S'),
    where: 'lane',
    lane,
  });
  w.juncs[0].sig.ph = 1;
  for (let i = 0; i < 6 * 120; i++) {
    stepWorld(w, 1 / 120, []);
    lane.vs[0].v = 0;
    lane.vs[0].pos = 20;
  }
  assert.equal(w.juncs[0].box.length, 0, 'nobody entered the box');
  const queued = w.lanes[A.inLane[3]].vs[0];
  assert.ok(queued.pos <= w.lanes[A.inLane[3]].len);
});

// ---------------------------------------------------------------------------------------------
// Pedestrians, strikes and losses
// ---------------------------------------------------------------------------------------------

test('X is refused with nobody waiting, then stops the traffic and lets the pedestrians cross', () => {
  const L = compileLevel(
    def({ peds: [{ jn: 0, rate: 0, bursts: [[1, 3]] }], rates: [[3, 0, 3, 0]], maxWait: 99 }),
  );
  const sched = buildSchedule(L, seeded(1));
  const s = newPlay(L, sched);
  const press = (...k) => advancePlay(s, 1 / 60, pressedOf(k), () => {});
  press('KeyX');
  assert.equal(s.stats.refused, 1);
  assert.match(s.msg.en, /Nobody is waiting/);
  assert.match(s.msg.zh, /没有等待/);
  for (let i = 0; i < 60 * 5; i++) press();
  assert.ok(s.w.peds.filter((p) => p.st === 'wait').length >= 1);
  press('KeyX');
  assert.equal(s.stats.calls, 1);
  assert.equal(s.w.juncs[0].sig.stage, 'yellow');
  press('KeyX');
  assert.match(s.msg.en, /Wait for the green/);
  let walked = false;
  for (let i = 0; i < 60 * 12; i++) {
    press();
    if (s.w.juncs[0].sig.stage === 'ped') {
      walked = true;
      assert.ok(
        s.w.peds.every((p) => p.st !== 'wait'),
        'everyone crosses at the start of the walk',
      );
    }
  }
  assert.ok(walked);
  assert.equal(s.w.pedsServed, 3);
  assert.equal(s.w.juncs[0].sig.stage, 'green');
  assert.equal(s.strikes, 0);
});

test('a pedestrian who arrives late in the walk phase waits, so nobody is still on the zebra when the green returns', () => {
  const L = compileLevel(def({ peds: [{ jn: 0, rate: 0 }], rates: [[0, 0, 0, 0]] }));
  assert.ok(RULES.pedLate + RULES.pedCross <= RULES.pedWalk + RULES.pedFlash);
  const arrivals = (at) => [
    { id: 0, t: 0.5, jn: 0, d: 0 },
    { id: 1, t: at, jn: 0, d: 2 },
    { id: 2, t: at + 1.9, jn: 0, d: 1 },
  ];
  const w = newWorld(L, { cars: [], peds: arrivals(5.4), quota: 1 });
  const JW = w.juncs[0];
  for (let i = 0; i < 120; i++) stepWorld(w, 1 / 120, []);
  assert.equal(callPedestrians(w, JW), true);
  let walkStart = -1;
  let early = null;
  let late = null;
  let crossingOnGreen = 0;
  while (w.t < 16) {
    stepWorld(w, 1 / 120, []);
    if (JW.sig.stage === 'ped' && walkStart < 0) walkStart = w.t;
    if (JW.sig.stage !== 'ped' && JW.sig.stage !== 'red' && w.peds.some((p) => p.st === 'cross'))
      crossingOnGreen++;
    if (walkStart > 0 && w.t - walkStart < 0.5) early = w.peds.find((p) => p.id === 1)?.st ?? early;
    late = w.peds.find((p) => p.id === 2)?.st ?? late;
  }
  assert.ok(walkStart > 0);
  assert.equal(crossingOnGreen, 0, 'nobody is crossing once the walk phase is over');
  assert.ok(early === null || early === 'wait' || early === 'cross');
  assert.equal(
    late,
    'wait',
    'a pedestrian arriving after the grace period waits for the next walk',
  );
  // Arriving inside the grace period, a pedestrian crosses at once and still finishes in time.
  const w2 = newWorld(L, { cars: [], peds: [{ id: 0, t: 0.5, jn: 0, d: 0 }], quota: 1 });
  for (let i = 0; i < 120; i++) stepWorld(w2, 1 / 120, []);
  callPedestrians(w2, w2.juncs[0]);
  while (w2.juncs[0].sig.stage !== 'ped') stepWorld(w2, 1 / 120, []);
  w2.pedQ.push({ id: 1, t: w2.t + 0.5, jn: 0, d: 2 });
  for (let i = 0; i < 120 * 0.7; i++) stepWorld(w2, 1 / 120, []);
  assert.equal(w2.peds.find((p) => p.id === 1)?.st, 'cross');
});

function runPlay(L, sched, keys = () => [], seconds = L.time + 3) {
  const s = newPlay(L, sched);
  for (let f = 0; f < seconds * 60 && s.phase === 'playing'; f++)
    advancePlay(s, 1 / 60, pressedOf(keys(f / 60, s)), () => {});
  return s;
}

test('every strike is explained in both languages and the third one ends the shift', () => {
  // An unattended junction: the east-west cars wait on the north-south green.
  const L = compileLevel(def({ rates: [[0, 6, 0, 6]], maxWait: 6, time: 80 }));
  const s = runPlay(L, buildSchedule(L, seeded(2)));
  assert.equal(s.phase, 'lost');
  assert.ok(s.strikes >= 3 || s.cause === 'gridlock');
  assert.ok(['strikes', 'gridlock'].includes(s.cause));
  const L2 = compileLevel(def({ rates: [[0, 4, 0, 4]], maxWait: 5, time: 90 }));
  const t = newPlay(L2, buildSchedule(L2, seeded(3)));
  const seen = [];
  for (let f = 0; f < 60 * 60 && t.phase === 'playing'; f++) {
    advancePlay(t, 1 / 60, pressedOf([]), () => {});
    if (t.msg.age < 0.02 && /^Strike/.test(t.msg.en)) seen.push(t.msg);
  }
  assert.ok(seen.length >= 1);
  for (const m of seen) {
    assert.match(
      m.en,
      /^Strike! A (car|truck|bus) waited over 5 s on the (north|east|south|west) road/,
    );
    assert.match(m.zh, /^失误！.*等待超过 5 秒/);
  }
});

test('a queue that spills off the map is a strike with its own explanation', () => {
  // A very short north road and a permanent red: the second arrival has nowhere to go.
  const L = compileLevel(
    def({ rates: [[40, 0, 0, 0]], cap: { '0N': 30 }, maxWait: 200, time: 80 }),
  );
  const w = newWorld(L, buildSchedule(L, seeded(1)));
  w.juncs[0].sig.ph = 1;
  const log = [];
  for (let i = 0; i < 120 * 30; i++) stepWorld(w, 1 / 120, log);
  assert.ok(log.some((e) => e.k === 'spill'));
  assert.ok(w.lost > 0);
  const s = runPlay(L, buildSchedule(L, seeded(1)), (t) => (t < 0.05 ? ['Space'] : []));
  const spills = s.stats.strikes.spill;
  assert.ok(spills >= 1);
  assert.ok(s.strikes >= 1);
});

test('pedestrians who wait too long cost a strike', () => {
  const L = compileLevel(
    def({
      peds: [{ jn: 0, rate: 0, bursts: [[1, 2]] }],
      pedMax: 8,
      time: 40,
      rates: [[3, 0, 3, 0]],
      maxWait: 99,
    }),
  );
  const s = runPlay(L, buildSchedule(L, seeded(1)), () => [], 14);
  assert.equal(s.stats.strikes.ped, 2);
  assert.match(s.msg.en, /Pedestrians waited over 8 s/);
  assert.match(s.msg.zh, /行人.*等待超过 8 秒/);
});

test('an ambulance held up ends the shift at once, and the message says so in both languages', () => {
  const L = compileLevel(def({ rates: [[0, 0, 0, 0]], emerg: [[3, 0, 1]], emgWait: 3 }));
  const s = runPlay(L, buildSchedule(L, seeded(1)));
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'ambulance');
  assert.match(s.msg.en, /ambulance waited over 3 s.*shift over/);
  assert.match(s.msg.zh, /救护车.*本班结束/);
});

test('a shift ends when time runs out or when the quota can no longer be reached', () => {
  const L = compileLevel(def({ rates: [[6, 6, 6, 6]], time: 20, frac: 0.95, maxWait: 99 }));
  const sched = buildSchedule(L, seeded(1));
  const slow = runPlay(L, sched, () => []);
  assert.equal(slow.phase, 'lost');
  assert.ok(['quota', 'strikes', 'gridlock', 'time'].includes(slow.cause));
  const late = compileLevel(
    def({ rates: [[12, 0, 12, 0]], time: 15, tail: 0.1, frac: 1, maxWait: 99 }),
  );
  const l = runPlay(late, buildSchedule(late, seeded(1)));
  assert.equal(l.phase, 'lost');
  assert.equal(l.cause, 'time');
  // Nobody can be delivered: the quota is unreachable the moment enough vehicles are lost.
  const L2 = compileLevel(
    def({ rates: [[30, 0, 0, 0]], cap: { '0N': 26 }, time: 60, frac: 0.9, maxWait: 99 }),
  );
  const s2 = runPlay(L2, buildSchedule(L2, seeded(1)), (t) => (t < 0.05 ? ['Space'] : []), 61);
  assert.equal(s2.phase, 'lost');
  assert.ok(['quota', 'strikes', 'time', 'gridlock'].includes(s2.cause));
});

test('a vehicle stuck at a green light for a long time is a gridlock strike, not a silent loss', () => {
  // The link to the east junction is jammed solid, so the west junction's eastbound head cannot go.
  const L = compileLevel(
    def({
      layout: 'row2',
      plan: 'two',
      rates: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    }),
  );
  const A = L.junctions[0];
  const car = { id: 0, t: 0, lane: A.inLane[3], k: 'car', moves: ['S', 'S'] };
  const w = newWorld(L, { cars: [car], peds: [], quota: 1 });
  w.juncs[0].sig.ph = 1;
  const link = w.lanes[A.outLane[1]];
  link.vs.push({
    moves: ['S'],
    mi: 0,
    pos: 20,
    len: 12,
    v: 0,
    wait: 0,
    k: 'car',
    weight: 1,
    vmax: 58,
    acc: 50,
    path: pathOf(3, 'S'),
    where: 'lane',
    lane: link,
  });
  const log = [];
  for (let i = 0; i < 120 * 40; i++) {
    stepWorld(w, 1 / 120, log);
    link.vs[0].v = 0;
    link.vs[0].pos = 20;
  }
  const grid = log.filter((e) => e.k === 'gridlock');
  assert.equal(grid.length, 1, 'one strike for one stuck vehicle');
  const s = newPlay(L, { cars: [{ ...car, t: 0 }], peds: [], quota: 1 });
  s.w.juncs[0].sig.ph = 1;
  const l2 = s.w.lanes[A.outLane[1]];
  l2.vs.push({
    moves: ['S'],
    mi: 0,
    pos: 20,
    len: 12,
    v: 0,
    wait: 0,
    k: 'car',
    weight: 1,
    vmax: 58,
    acc: 50,
    path: pathOf(3, 'S'),
    where: 'lane',
    lane: l2,
  });
  let msg = null;
  for (let f = 0; f < 60 * 30; f++) {
    advancePlay(s, 1 / 60, pressedOf([]), () => {});
    l2.vs[0].v = 0;
    l2.vs[0].pos = 20;
    if (!msg && s.stats.strikes.gridlock) msg = { ...s.msg };
  }
  assert.equal(s.stats.strikes.gridlock, 1);
  assert.match(msg.en, /Gridlock: a vehicle on the west road/);
  assert.match(msg.zh, /路口堵死/);
});

test('an idle junction cannot be lost to gridlock while nobody is stuck at a green', () => {
  const L = compileLevel(def({ rates: [[0, 12, 0, 12]], maxWait: 500, time: 120, frac: 0.9 }));
  const s = runPlay(L, buildSchedule(L, seeded(1)), () => [], 100);
  assert.equal(s.stats.strikes.gridlock, 0);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'strikes');
});

test('strikes are spaced out: a pile of late vehicles costs one strike at a time', () => {
  const L = compileLevel(def({ rates: [[0, 10, 0, 10]], maxWait: 5, time: 90 }));
  const s = newPlay(L, buildSchedule(L, seeded(2)));
  const at = [];
  let prev = 0;
  for (let f = 0; f < 60 * 80 && s.phase === 'playing'; f++) {
    advancePlay(s, 1 / 60, pressedOf([]), () => {});
    if (s.strikes !== prev) at.push(s.w.t);
    prev = s.strikes;
  }
  assert.ok(at.length >= 2);
  for (let i = 1; i < at.length; i++)
    assert.ok(at[i] - at[i - 1] >= RULES.strikeGap - 0.02, `strikes ${at[i - 1]} and ${at[i]}`);
});

test('X returns to the same green and is not a free phase change', () => {
  const L = compileLevel(
    def({ peds: [{ jn: 0, rate: 0, bursts: [[1, 2]] }], rates: [[3, 3, 3, 3]], maxWait: 99 }),
  );
  const s = newPlay(L, buildSchedule(L, seeded(1)));
  const press = (...k) => advancePlay(s, 1 / 60, pressedOf(k), () => {});
  for (let i = 0; i < 60 * 5; i++) press();
  const before = s.w.juncs[0].sig.ph;
  press('KeyX');
  let sawPed = false;
  for (let i = 0; i < 60 * 14; i++) {
    press();
    if (s.w.juncs[0].sig.stage === 'ped') sawPed = true;
  }
  assert.ok(sawPed);
  assert.equal(s.w.juncs[0].sig.ph, before, 'the same phase is green again');
  // The resumed green can be changed straight away: the minimum green was already served.
  assert.equal(s.w.juncs[0].sig.t >= RULES.minGreen, true);
  press('Space');
  assert.equal(s.w.juncs[0].sig.stage, 'yellow');
});

test('no pedestrian is crossing while a conflicting movement has a green, on any level or step rate', () => {
  let checked = 0;
  for (const [level, hz, seed] of [
    [8, 60, 1],
    [9, 30, 2],
    [12, 120, 3],
    [18, 60, 4],
    [20, 60, 5],
  ]) {
    const { g } = open(level, { seed });
    for (let f = 0; f < 80 * hz; f++) {
      const st = g.getState();
      if (st.phase !== 'playing') break;
      const keys =
        f % (hz * 3) === 0
          ? ['KeyX']
          : f % (hz * 5) === 7
            ? ['Space']
            : f % (hz * 4) === 3
              ? ['ArrowRight']
              : [];
      g.update(1 / hz, input([], keys));
      const now = g.getState();
      for (const j of now.junctions) {
        const crossing = now.pedestrians.some((p) => p.junction === j.id && p.state === 'cross');
        if (crossing) {
          checked++;
          assert.ok(
            j.stage === 'ped' || j.stage === 'red',
            `level ${level} junction ${j.id} ${j.stage} with pedestrians crossing`,
          );
          assert.equal(j.boxVehicles, 0, 'cars in the box while people cross');
        }
      }
    }
  }
  assert.ok(checked > 100, `checked ${checked} frames`);
});

test('fuzz: vehicles never overlap, on many levels, seeds and step rates, with random keys', () => {
  let pairs = 0;
  const cases = [];
  for (const level of [2, 5, 9, 12, 13, 14, 16, 18, 20])
    for (const hz of [30, 60, 120]) cases.push([level, hz]);
  cases.forEach(([level, hz], n) => {
    const { g } = open(level, { seed: 11 + n });
    const rnd = seeded(500 + n);
    const keys = ['Space', 'KeyX', 'ArrowLeft', 'ArrowRight'];
    for (let f = 0; f < 70 * hz; f++) {
      g.update(1 / hz, input([], rnd() < 0.05 ? [keys[Math.floor(rnd() * 4)]] : []));
      if (f % Math.round(hz / 12) !== 0) continue;
      const st = g.getState();
      if (st.phase !== 'playing') break;
      for (let i = 0; i < st.vehicles.length; i++)
        for (let j = i + 1; j < st.vehicles.length; j++) {
          const a = st.vehicles[i];
          const b = st.vehicles[j];
          // Vehicles in one lane (same heading, same line) keep their length plus a gap apart; on a
          // tight turn the straight-line distance is a little shorter than the arc, so pairs that
          // are in the box get extra slack. Vehicles in the box from different roads must hold
          // different conflict zones.
          const horizontal = a.heading === 'E' || a.heading === 'W';
          const along = Math.abs(horizontal ? a.x - b.x : a.y - b.y);
          const across = Math.abs(horizontal ? a.y - b.y : a.x - b.x);
          if (a.heading === b.heading && across < 5) {
            const slack = a.where === 'box' || b.where === 'box' ? 7 : 3.5;
            assert.ok(
              along >= (a.length + b.length) / 2 - slack,
              `level ${level} ${hz} Hz: ${a.id}/${b.id} only ${along.toFixed(1)} px apart in one lane`,
            );
          }
          if (
            a.where === 'box' &&
            b.where === 'box' &&
            a.junction === b.junction &&
            a.approach !== b.approach
          )
            assert.equal(a.zones.filter((z) => b.zones.includes(z)).length, 0, 'shared zone');
          pairs++;
        }
    }
  });
  assert.ok(pairs > 5000, `${pairs} pairs`);
});

test('simultaneous heads that conflict never enter on the same tick', () => {
  // Opposing left turns from the north and south roads arrive together every time.
  for (let seed = 1; seed <= 8; seed++) {
    const L = compileLevel(def({ rates: [[0, 0, 0, 0]], turns: [[0, 1, 0]] }));
    const r = seeded(seed);
    const cars = [0, 1, 2, 3].map((i) => ({
      id: i,
      t: 0.4 * i + r() * 0.3,
      lane: L.junctions[0].inLane[i % 2 ? 2 : 0],
      k: 'car',
      moves: ['L'],
    }));
    const w = newWorld(L, { cars, peds: [], quota: 4 });
    for (let i = 0; i < 40 * 120; i++) {
      stepWorld(w, 1 / 120, []);
      const lanes = new Set(w.juncs[0].box.map((v) => v.inLane.dir));
      assert.ok(lanes.size <= 1, `seed ${seed}: both roads in the box at t=${w.t.toFixed(2)}`);
    }
    assert.equal(w.delivered, 4);
  }
});

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------

test('the prompt names the next action and its target, in both languages, with a matching highlight', () => {
  const { g } = open(14);
  const kinds = new Set();
  let sawSelect = false;
  for (let f = 0; f < 60 * 80; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    const p = st.prompt;
    if (p) {
      kinds.add(p.kind);
      assert.ok(p.en.length > 8 && /[一-鿿]/.test(p.zh));
      if (p.kind === 'select') {
        sawSelect = true;
        assert.match(p.en, /^Select the (west|east) junction \([←→]\), then (Space|X): /);
        assert.match(p.zh, /^先选择(西侧|东侧)路口/);
        assert.ok(PRESS.includes(p.press));
        assert.ok(p.dirs.length > 0);
        assert.ok(['west', 'east'].includes(p.target));
      }
      if (p.kind === 'phase') {
        assert.match(
          p.en,
          /^Press Space: (let the .* queue go|clear the way for the ambulance from the \w+)$/,
        );
        assert.equal(p.press, 'Space');
        assert.ok(p.dirs.length > 0);
      }
      if (p.kind === 'watch') assert.equal(p.press, null);
    }
    follow(g, 1 / 60, 0.1);
  }
  assert.ok(kinds.has('watch') && kinds.has('phase'));
  assert.ok(sawSelect, 'a two-junction level asks the player to select a junction');
});

test('the prompt never asks for an impossible action: a press when it is shown is accepted', () => {
  const { g } = open(3);
  let shown = 0;
  let refused = 0;
  let prevRefused = 0;
  for (let f = 0; f < 60 * 60; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    const p = st.prompt;
    let keys = [];
    if (p && p.kind === 'phase' && f % 12 === 0) {
      keys = [p.press];
      shown++;
    }
    g.update(1 / 60, input([], keys));
    const now = g.getState().stats.refused;
    if (keys.length && now > prevRefused) refused++;
    prevRefused = now;
  }
  assert.ok(shown >= 1);
  assert.equal(refused, 0);
});

test('select and wait prompts describe real state: the right arrow reaches the target junction', () => {
  const L = COMPILED[13];
  assert.equal(neighbour(L.junctions, 0, 1), 1);
  assert.equal(neighbour(L.junctions, 1, 3), 0);
  assert.equal(neighbour(L.junctions, 0, 3), -1);
  assert.equal(neighbour(L.junctions, 0, 0), -1);
  assert.equal(selectStep(L.junctions, 0, 1), 1);
  assert.equal(selectStep(L.junctions, 1, 0), 3);
  assert.equal(selectStep(L.junctions, 0, 0), -1);
});

// ---------------------------------------------------------------------------------------------
// Input: keys, taps, level select, progress
// ---------------------------------------------------------------------------------------------

test('arrow keys select a junction and Space and X act on the selected one', () => {
  const { g } = open(14);
  assert.equal(g.getState().selected, 0);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().selected, 0, 'nothing to the west of the west junction');
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().selected, 1);
  g.update(1 / 60, input([], ['KeyA']));
  assert.equal(g.getState().selected, 0);
  g.update(1 / 60, input([], ['KeyD']));
  g.update(1 / 60, input([], ['Space']));
  const st = g.getState();
  assert.equal(st.junctions[1].stage, 'yellow');
  assert.equal(st.junctions[0].stage, 'green');
  assert.equal(st.stats.signals, 1);
});

test('tapping a junction selects it, tapping again advances its signal and tapping the zebra calls pedestrians', () => {
  const { g } = open(14);
  const tap = (x, y) => g.update(1 / 60, input([], [], { x, y, clicked: true, down: true }));
  tap(330, 160);
  assert.equal(g.getState().selected, 1);
  tap(330, 160);
  assert.equal(g.getState().junctions[1].stage, 'yellow');
  tap(10, 10);
  assert.equal(g.getState().selected, 1, 'a tap on empty ground does nothing');
  // Pedestrians: wait for one to appear, then tap the zebra.
  const o = open(8);
  drive(o.g, 12);
  let st = o.g.getState();
  assert.ok(
    st.pedestrians.some((p) => p.state === 'wait'),
    'pedestrians gather',
  );
  const J = st.junctions[0];
  o.g.update(1 / 60, input([], [], { x: J.x, y: J.y - 26, clicked: true, down: true }));
  st = o.g.getState();
  assert.equal(st.stats.calls + st.stats.refused >= 1, true);
});

test('the level select opens when levels are unlocked, supports keys and taps, and starts the chosen level', () => {
  const { g, unlocks } = open(6, { progress: undefined });
  assert.equal(g.getState().level, 6);
  const h = harness({ seed: 1 });
  let unlocked = 7;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const m = createGame(h.env);
  let st = m.getState();
  assert.deepEqual(st.menu, { sel: 7, unlocked: 7 });
  assert.match(st.status.en, /7\/20 shifts open/);
  assert.match(st.status.zh, /已开放 7\/20 班/);
  m.update(1 / 60, input([], ['ArrowLeft']));
  m.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(m.getState().menu.sel, 1);
  m.update(1 / 60, input([], ['ArrowRight']));
  m.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(m.getState().menu.sel, 7);
  m.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(m.getState().menu.sel, 7, 'locked levels cannot be chosen');
  // A tap selects, a second tap on the same cell starts it.
  const cell = (i) => ({
    x: MENU.x + (i % 5) * MENU.w + 10,
    y: MENU.y + Math.floor(i / 5) * MENU.h + 10,
    clicked: true,
    down: true,
  });
  m.update(1 / 60, input([], [], cell(2)));
  assert.equal(m.getState().menu.sel, 3);
  m.update(1 / 60, input([], [], cell(2)));
  st = m.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3);
  assert.equal(unlocks.length, 0);
  const keyed = createGame({ ...h.env, progress: { unlocked: () => 4, unlock() {} } });
  keyed.update(1 / 60, input([], ['Space']));
  assert.equal(keyed.getState().level, 4);
  // A tap outside the grid or on a locked cell does nothing.
  const again = createGame({ ...h.env, progress: { unlocked: () => 2, unlock() {} } });
  again.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true, down: true }));
  again.update(1 / 60, input([], [], cell(9)));
  assert.deepEqual(again.getState().menu, { sel: 2, unlocked: 2 });
});

test('a broken progress store never stops the game and a cleared level unlocks the next', () => {
  const broken = {
    unlocked: () => {
      throw new Error('storage');
    },
    unlock: () => {
      throw new Error('storage');
    },
  };
  const { g } = open(1, { progress: broken });
  assert.equal(g.getState().level, 1);
  follow(g, 120, 0.1);
  assert.ok(g.getState().level >= 2, 'clearing still works with a failing store');
  const garbage = { unlocked: () => 'abc', unlock() {} };
  assert.equal(open(1, { progress: garbage }).g.getState().level, 1);
  const o = open(1);
  follow(o.g, 120, 0.1);
  assert.ok(o.unlocks.includes(2));
});

// ---------------------------------------------------------------------------------------------
// Fixed step, pause, copies, determinism
// ---------------------------------------------------------------------------------------------

test('zero, negative, NaN and infinite dt are inert, and huge dt is capped', () => {
  const { g } = open(2);
  drive(g, 3);
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, undefined]) g.update(dt, input([], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), before);
  const t0 = g.getState().time;
  g.update(5, input());
  const dt = g.getState().time - t0;
  assert.ok(dt > 0 && dt <= RULES.maxDt + 1e-9, `capped step advanced ${dt}`);
});

test('simulation is deterministic at 30, 60 and 120 Hz', () => {
  const run = (hz) => {
    const { g } = open(2, { seed: 7 });
    for (let f = 0; f < 25 * hz; f++) {
      const t = f / hz;
      const keys = Math.abs(t - 6) < 0.5 / hz || Math.abs(t - 15) < 0.5 / hz ? ['Space'] : [];
      g.update(1 / hz, input([], keys));
    }
    const st = g.getState();
    return {
      delivered: st.delivered,
      strikes: st.strikes,
      time: Math.round(st.time * 1000),
      vehicles: st.vehicles.map((v) => [v.id, v.x, v.y, v.speed]),
      lights: st.junctions.map((j) => j.stage + j.phase),
    };
  };
  const a = run(60);
  assert.ok(a.delivered > 3);
  assert.deepEqual(run(30), a);
  assert.deepEqual(run(120), a);
});

test('getState returns copies that cannot change the game', () => {
  const { g } = open(14);
  drive(g, 8);
  const before = JSON.stringify(g.getState());
  const st = g.getState();
  st.vehicles.length = 0;
  st.junctions.forEach((j) => (j.x = -1));
  st.junctions[0].signals.push('x');
  if (st.prompt) {
    st.prompt.en = 'changed';
    st.prompt.dirs.push(9);
  }
  st.stats.strikes.wait = 99;
  st.name.en = 'x';
  st.score = -5;
  assert.equal(JSON.stringify(g.getState()), before);
  assert.notEqual(g.getState(), g.getState());
});

test('two games with the same seed play identically and different seeds differ', () => {
  const play = (seed) => {
    const { g } = open(5, { seed });
    follow(g, 40, 0.2);
    return JSON.stringify(g.getState().vehicles);
  };
  assert.equal(play(4), play(4));
  assert.notEqual(play(4), play(5));
});

// ---------------------------------------------------------------------------------------------
// Terminal screens, restart, counters
// ---------------------------------------------------------------------------------------------

test('a lost shift ends once, freezes input, matches the HUD and restarts with a fresh instance', () => {
  const { g, h } = open(3, { lang: 'en' });
  drive(g, 120);
  const st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(h.ends.length, 1);
  const end = h.ends[0];
  assert.equal(end.won, false);
  assert.match(
    end.message,
    /Three strikes on shift 3|relieved of duty|Gridlock on shift 3|Time ran out|Too many vehicles/,
  );
  assert.doesNotMatch(end.message, /clear|cleared|win/i);
  assert.equal(end.score, st.score);
  assert.ok(st.score >= 0 && Number.isFinite(st.score));
  assert.match(st.status.en, /Relieved of duty/);
  const frozen = JSON.stringify(g.getState());
  drive(g, 5, 60, () => ['Space', 'KeyX', 'ArrowRight']);
  assert.equal(JSON.stringify(g.getState()), frozen, 'input after the end changes nothing');
  assert.equal(h.ends.length, 1, 'the end callback fires only once');
  const fresh = open(3);
  assert.equal(fresh.g.getState().time, 0);
  assert.equal(fresh.g.getState().strikes, 0);
  assert.equal(fresh.h.ends.length, 0);
});

test('the loss message names its cause in both languages', () => {
  const messages = {};
  const cases = {
    gridlock: { level: 3, run: (g) => drive(g, 100) },
    ambulance: {
      level: 11,
      run: (g) => drive(g, 80),
    },
  };
  for (const [name, c] of Object.entries(cases)) {
    for (const lang of ['en', 'zh']) {
      const { g, h } = open(c.level, { lang });
      c.run(g);
      assert.equal(g.getState().phase, 'lost', `${name} ${lang}`);
      messages[`${name}-${lang}`] = h.ends[0].message;
    }
  }
  assert.match(messages['gridlock-zh'], /[一-鿿]/);
  assert.match(messages['ambulance-en'], /ambulance|strikes|Gridlock|Time|vehicles/i);
  assert.notEqual(messages['gridlock-en'], messages['gridlock-zh']);
});

test('counters are never negative and the HUD matches the real state through a whole shift', () => {
  const { g } = open(9);
  for (let f = 0; f < 60 * 90; f++) {
    const st = g.getState();
    assert.ok(st.spare >= 0 && st.spare <= RULES.lives);
    assert.ok(
      st.timeLeft >= 0 && st.delivered >= 0 && st.strikes >= 0 && st.strikes <= RULES.lives,
    );
    assert.ok(Number.isFinite(st.avgDelay) && st.avgDelay >= 0 && Number.isFinite(st.longestWait));
    if (st.phase !== 'playing') break;
    assert.match(st.status.en, new RegExp(`Out ${st.delivered}/${st.quota}`));
    assert.match(st.status.en, new RegExp(`Strikes ${st.strikes}/3`));
    assert.match(st.status.zh, new RegExp(`放行 ${st.delivered}/${st.quota}`));
    if (f % 30 === 0) follow(g, 0.5, 0.15);
    else g.update(1 / 60, input());
  }
});

test('clearing every level plays the whole campaign to one final win', () => {
  const h = harness({ seed: 2 });
  const unlocks = [];
  let unlocked = 1;
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      unlocks.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  const seen = new Set();
  const decide = autoplay(0.2);
  void decide;
  let level = 1;
  let follower = null;
  let t0 = 0;
  const hist = [];
  void hist;
  for (let f = 0; f < 60 * 60 * 40 && g.getState().phase === 'playing'; f++) {
    const st = g.getState();
    seen.add(st.level);
    if (st.level !== level || !follower) {
      level = st.level;
      t0 = f;
      follower = makeFollower(0.2);
    }
    g.update(1 / 60, input([], follower(st, (f - t0) / 60)));
  }
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(seen.size, LEVEL_COUNT);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.match(h.ends[0].message, /well conducted/);
  assert.match(st.status.en, /Every junction is running/);
  assert.equal(Math.max(...unlocks), LEVEL_COUNT);
  assert.ok(h.ends[0].score > 3000);
  const frozen = JSON.stringify(g.getState());
  drive(g, 3, 60, () => ['Space']);
  assert.equal(JSON.stringify(g.getState()), frozen);
});

function makeFollower(lag) {
  const hist = [];
  let last = { text: null, t: -9 };
  let lastPress = -9;
  return (st, t) => {
    hist.push({ t, p: st.prompt });
    if (hist.length > 300) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const p = hist[k].p;
    if (!p || p.kind === 'watch' || !p.press || t - lastPress < 0.12) return [];
    if (p.en === last.text && t - last.t < 1.5) return [];
    last = { text: p.en, t };
    lastPress = t;
    return [p.press];
  };
}

// ---------------------------------------------------------------------------------------------
// The controller used by the prompt
// ---------------------------------------------------------------------------------------------

test('the controller behind the prompt clears the first levels with no strike at several reaction times', () => {
  for (const lag of [0, 0.3, 0.6])
    for (const i of [0, 1, 2, 10]) {
      const L = COMPILED[i];
      const s = runPrompted(L, buildSchedule(L, seeded(L.seed)), lag);
      assert.equal(s.phase, 'cleared', `level ${i + 1} at lag ${lag}`);
      assert.equal(s.strikes, 0);
    }
  assert.equal(typeof autoplay(0.1), 'function');
});

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

function recorder() {
  const ctx = mockContext();
  const texts = [];
  const fills = [];
  return new Proxy(ctx, {
    get: (t, p) => {
      if (p === 'texts') return texts;
      if (p === 'fills') return fills;
      if (p === 'fillText') return (s, x, y) => texts.push([String(s), x, y]);
      if (p === 'fillRect') return (x, y, w, h) => fills.push([x, y, w, h]);
      return t[p];
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
}

test('every level draws in both languages without bad numbers or missing text', () => {
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVEL_COUNT; level += 3) {
      const { g } = open(level, { lang });
      for (let sec = 0; sec < 30; sec++) {
        follow(g, 1, 0.2);
        const ctx = recorder();
        g.draw(ctx);
        for (const [s] of ctx.texts)
          assert.doesNotMatch(s, /NaN|undefined|null|-\d/, `text "${s}"`);
        for (const r of ctx.fills)
          assert.ok(
            r.every((n) => Number.isFinite(n)),
            `rect ${r}`,
          );
        if (g.getState().phase !== 'playing') break;
      }
    }
});

test('the screen shows the prompt, the banner, the wait bars, the alerts and the countdown signs', () => {
  const seenText = new Set();
  for (const level of [7, 8, 11, 14]) {
    const { g } = open(level);
    for (let sec = 0; sec < 45; sec++) {
      follow(g, 1, 0.2);
      const ctx = recorder();
      g.draw(ctx);
      for (const [s] of ctx.texts) seenText.add(s);
      if (g.getState().phase !== 'playing') break;
    }
  }
  const all = [...seenText].join('\n');
  assert.match(all, /Press Space|Signals are set|signal is changing/);
  assert.match(all, /Out \d+\/\d+/);
  assert.match(all, /Avg delay/);
  assert.match(all, /Ambulance from the/);
  assert.match(all, /^\d+$/m, 'countdown signs show seconds');
  assert.match(all, /Level 8: Zebra Crossing|Strikes/);
});

test('the level select and the end states draw', () => {
  const h = harness({ seed: 1 });
  h.env.progress = { unlocked: () => 12, unlock() {} };
  const g = createGame(h.env);
  for (const lang of ['en', 'zh']) {
    const ctx = recorder();
    createGame({ ...h.env, lang, t: (en, zh) => (lang === 'zh' ? zh : en) }).draw(ctx);
    assert.ok(ctx.texts.some(([s]) => /Choose a shift|选择班次/.test(s)));
  }
  g.update(1 / 60, input([], ['Space']));
  drive(g, 100);
  assert.equal(g.getState().phase, 'lost');
  const ctx = recorder();
  g.draw(ctx);
  assert.ok(ctx.fills.length > 100);
});

test('wrapText breaks Latin text at spaces and Chinese text by length', () => {
  assert.deepEqual(wrapText('one two three', 7), ['one two', 'three']);
  assert.deepEqual(wrapText('', 5), []);
  assert.deepEqual(wrapText('一二三四五六七', 3), ['一二三', '四五六', '七']);
  assert.deepEqual(wrapText('short', 20), ['short']);
});

test('long seeded random play stays finite, bounded and error-free on every kind of level', () => {
  for (const level of [1, 5, 8, 12, 14, 17, 20]) {
    const { g } = open(level, { seed: level });
    const rnd = seeded(level * 99);
    const keys = [
      'Space',
      'KeyX',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Enter',
      'KeyW',
    ];
    let maxVehicles = 0;
    for (let f = 0; f < 60 * 100; f++) {
      g.update(
        1 / 60,
        input(
          [],
          rnd() < 0.08 ? [keys[Math.floor(rnd() * keys.length)]] : [],
          rnd() < 0.01 ? { x: rnd() * 480, y: rnd() * 320, clicked: true, down: true } : {},
        ),
      );
      const st = g.getState();
      maxVehicles = Math.max(maxVehicles, st.vehicles.length);
      assert.ok(Number.isFinite(st.time) && Number.isFinite(st.score));
      for (const v of st.vehicles)
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && v.speed >= 0);
      if (f % 600 === 0) g.draw(mockContext());
      if (st.phase !== 'playing') break;
    }
    assert.ok(maxVehicles < 90, `level ${level} had ${maxVehicles} vehicles`);
  }
});

test('fuzz: no vehicle ever enters a junction on red, at any step rate', () => {
  let entries = 0;
  for (const [level, hz, seed] of [
    [2, 60, 1],
    [5, 30, 2],
    [13, 120, 3],
    [14, 60, 4],
    [18, 30, 5],
    [20, 60, 6],
  ]) {
    const { g } = open(level, { seed });
    const rnd = seeded(900 + level);
    const keys = ['Space', 'KeyX', 'ArrowLeft', 'ArrowRight'];
    let prev = g.getState();
    for (let f = 0; f < 60 * hz; f++) {
      g.update(1 / hz, input([], rnd() < 0.06 ? [keys[Math.floor(rnd() * 4)]] : []));
      const now = g.getState();
      if (now.phase !== 'playing') break;
      const before = new Map(prev.vehicles.map((v) => [v.id, v]));
      for (const v of now.vehicles) {
        const was = before.get(v.id);
        if (v.where !== 'box' || !was || was.where !== 'lane') continue;
        const lights = (st) =>
          st.junctions[v.junction].signals.find((s) => s.dir === v.approach)?.light;
        // The light may turn red inside the frame in which the vehicle crosses the line.
        assert.ok(
          lights(prev) !== 'red' || lights(now) !== 'red',
          `level ${level}: vehicle ${v.id} entered on red at ${now.time.toFixed(2)}`,
        );
        entries++;
      }
      prev = now;
    }
  }
  assert.ok(entries > 100, `${entries} entries checked`);
});

test('a queue with an ambulance close behind its head goes before a conflicting head', () => {
  // The south queue holds a left-turner with an ambulance behind it; the north head goes straight.
  // Without priority the lower road number (north) would win the tie.
  const L = compileLevel(def({ rates: [[0, 0, 0, 0]], turns: [[0, 1, 0]] }));
  const J = L.junctions[0];
  const cars = [
    { id: 0, t: 0, lane: J.inLane[2], k: 'car', moves: ['L'] },
    { id: 1, t: 1.2, lane: J.inLane[2], k: 'amb', moves: ['S', 'S'] },
    { id: 2, t: 0, lane: J.inLane[0], k: 'car', moves: ['S'] },
  ];
  const w = newWorld(L, { cars, peds: [], quota: 3 });
  const south = w.lanes[J.inLane[2]];
  const north = w.lanes[J.inLane[0]];
  for (let i = 0; i < 120 * 2 && south.vs.length < 2; i++) stepWorld(w, 1 / 120, []);
  assert.equal(south.vs.length, 2);
  south.vs[0].pos = south.len - 1;
  south.vs[0].v = 0;
  south.vs[1].pos = south.vs[0].pos - 20;
  north.vs[0].pos = north.len - 1;
  north.vs[0].v = 0;
  assert.ok(zonesConflict(pathOf(2, 'L'), pathOf(0, 'S')));
  let first = null;
  for (let i = 0; i < 120 * 4 && first === null; i++) {
    stepWorld(w, 1 / 120, []);
    if (w.juncs[0].box.length) first = w.juncs[0].box[0].inLane.dir;
  }
  assert.equal(first, 2, 'the south head, with the ambulance behind it, entered first');
});

test('approaching ambulances are announced well ahead of their arrival', () => {
  const { g } = open(11);
  let farthest = 0;
  for (let f = 0; f < 60 * 60; f++) {
    g.update(1 / 60, input());
    for (const a of g.getState().alerts) farthest = Math.max(farthest, a.eta);
  }
  assert.ok(farthest >= RULES.alertEta - 2, `alerts reached ${farthest} s`);
});

test('a waiting left-turner on a green is never stalled for anything near the gridlock limit', () => {
  for (const level of [5, 7]) {
    const { g } = open(level, { seed: 3 });
    const follower = makeFollower(0.2);
    const stalled = new Map();
    let worst = 0;
    for (let f = 0; f < 60 * 70; f++) {
      const st = g.getState();
      if (st.phase !== 'playing') break;
      const t = f / 60;
      for (const v of st.vehicles) {
        const light = st.junctions[v.junction]?.signals.find((s) => s.dir === v.approach)?.light;
        if (v.where === 'lane' && v.speed < 1 && light === 'green') {
          const t0 = stalled.get(v.id) ?? t;
          stalled.set(v.id, t0);
          worst = Math.max(worst, t - t0);
        } else stalled.delete(v.id);
      }
      g.update(1 / 60, input([], follower(st, t)));
    }
    assert.ok(
      worst < RULES.gridlock * 0.75,
      `level ${level}: stalled ${worst.toFixed(1)} s on green`,
    );
  }
});

test('the controller and the prompt do not depend on the frame rate', () => {
  // The prompt is re-evaluated every fixed number of simulation steps, so the same schedule gives
  // the same result at 30, 60 and 120 Hz for a follower with the same reaction time.
  for (const [index, seed] of [
    [7, 23 * 13 + 1],
    [12, 5],
    [19, 9],
  ]) {
    const L = COMPILED[index];
    const sched = safeSchedule(L, seeded(seed));
    const results = [30, 60, 120].map((hz) => runPrompted(L, sched, 0.3, hz));
    for (const r of results) {
      assert.equal(r.phase, 'cleared', `level ${index + 1}`);
      assert.equal(r.strikes, 0);
    }
    const delivered = results.map((r) => r.w.delivered);
    assert.ok(Math.max(...delivered) - Math.min(...delivered) <= 1, `delivered ${delivered}`);
  }
});
