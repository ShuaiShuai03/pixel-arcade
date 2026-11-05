import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRiverState,
  stepRiver,
  riverLanes,
  meta,
} from '../src/games/river-hop.js';
import { harness, input, mockContext, seeded } from './harness.js';
const ROW = 28,
  TOP = 34,
  center = (row) => TOP + row * ROW + 14;
function place(s, row, x = 240) {
  Object.assign(s.frog, {
    x,
    y: center(row),
    row,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    support: null,
    hop: null,
  });
  s.spawnDelay = 0;
  s.needsRelease = false;
}
function run(s, seconds, held = [], pressed = [], hz = 120) {
  for (let n = 0; n < Math.round(seconds * hz); n++)
    stepRiver(s, 1 / hz, input(held, n === 0 ? pressed : []));
}
function clearRoad(s) {
  for (const lane of s.lanes) if (!lane.water) lane.objects = [];
}

test('river: paused, invalid and zero-duration updates leave the entire snapshot untouched', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState();
  for (const dt of [0, -1, NaN, Infinity]) g.update(dt, input(['ArrowUp'], ['ArrowUp']));
  assert.deepEqual(g.getState(), before);
  assert.equal(h.ends.length, 0);
  assert.equal(h.sounds.length, 0);
});
test('river: a hop has visible takeoff, finite airborne travel and a real touchdown', () => {
  const s = createRiverState();
  clearRoad(s);
  const y = s.frog.y;
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  assert.ok(s.frog.y < y && s.frog.y > y - 3);
  assert.ok(s.frog.z > 0);
  assert.equal(s.frog.grounded, false);
  assert.equal(s.frog.row, 9);
  run(s, 0.3);
  assert.equal(s.frog.grounded, true);
  assert.ok(Math.abs(s.frog.y - (y - 28)) < 1e-6);
  assert.equal(s.frog.row, 8);
  assert.ok(Math.abs(s.frog.vy) < 1e-8);
});
test('river: opposing directions cancel and a released tap cannot become another hop', () => {
  const s = createRiverState();
  clearRoad(s);
  const before = structuredClone(s.frog);
  run(s, 0.3, ['ArrowLeft', 'ArrowRight'], ['ArrowLeft', 'ArrowRight']);
  assert.equal(s.frog.x, before.x);
  assert.equal(s.frog.y, before.y);
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  run(s, 0.8);
  assert.equal(s.frog.row, 8);
});
test('river: a frog at the trailing log edge is carried before support is rechecked', () => {
  const s = createRiverState();
  place(s, 2, 111);
  const lane = s.lanes.find((l) => l.row === 2);
  lane.speed = 32;
  lane.objects = [{ id: 'edge', x: 100, w: 100 }];
  run(s, 1 / 30);
  assert.equal(s.lives, 4);
  assert.ok(Math.abs(s.frog.x - (111 + 32 / 30)) < 1e-7);
});
test('river: takeoff inherits the moving deck velocity without teleporting the frog', () => {
  const s = createRiverState();
  place(s, 2, 150);
  const lane = s.lanes.find((l) => l.row === 2);
  lane.speed = 32;
  lane.objects = [{ id: 'launch', x: 100, w: 100 }];
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  assert.equal(s.frog.grounded, false);
  assert.ok(Math.abs(s.frog.vx - 32) < 1e-8);
  assert.ok(Math.abs(s.frog.x - (150 + 32 / 120)) < 1e-7);
  assert.ok(s.frog.y > center(1));
});
test('river: swept traffic cannot pass through a stationary frog between frame endpoints', () => {
  const s = createRiverState();
  place(s, 6);
  const lane = s.lanes.find((l) => l.row === 6);
  lane.speed = 24000;
  lane.objects = [{ id: 'fast', x: 120, w: 38 }];
  stepRiver(s, 1 / 120, input());
  assert.equal(s.lives, 3);
  assert.equal(s.lastCause, 'traffic');
});
test('river: new-life protection cannot make unsupported water safe', () => {
  const s = createRiverState();
  place(s, 2);
  s.lanes.find((l) => l.row === 2).objects = [];
  s.invulnerable = 10;
  stepRiver(s, 1 / 120, input());
  assert.equal(s.lives, 3);
  assert.equal(s.lastCause, 'water');
});
test('river: a held direction must be released after a lost frog before it can move the next frog', () => {
  const s = createRiverState();
  place(s, 6);
  const lane = s.lanes.find((l) => l.row === 6);
  lane.speed = 0;
  lane.objects = [{ id: 'car', x: 230, w: 40 }];
  stepRiver(s, 1 / 120, input(['ArrowUp'], ['ArrowUp']));
  assert.equal(s.lives, 3);
  run(s, 1.5, ['ArrowUp']);
  assert.equal(s.frog.row, 9);
  assert.equal(s.frog.grounded, true);
  stepRiver(s, 1 / 120, input());
  stepRiver(s, 1 / 120, input(['ArrowUp'], ['ArrowUp']));
  assert.equal(s.frog.grounded, false);
});
test('river: ordinary boundary bumps retain inward and forward controls', () => {
  const s = createRiverState();
  clearRoad(s);
  place(s, 9, 11);
  stepRiver(s, 1 / 120, input([], ['ArrowLeft']));
  run(s, 0.4);
  assert.ok(s.frog.x >= 11 - 1e-7);
  assert.equal(s.lives, 4);
  stepRiver(s, 1 / 120, input([], ['ArrowRight']));
  run(s, 0.3);
  assert.ok(s.frog.x > 30);
  assert.equal(s.lives, 4);
});
test('river: each stage has a distinct crossing rule, including a bounded reversing ferry', () => {
  assert.ok(riverLanes(1).some((l) => l.kind === 'logs'));
  assert.ok(riverLanes(2).some((l) => l.kind === 'turtles'));
  assert.ok(riverLanes(3).some((l) => l.kind === 'ferry'));
  assert.notDeepEqual(riverLanes(1), riverLanes(3));
});
test('river: filled pads are safe to leave, and home acceptance requires both visible feet on the pad', () => {
  const s = createRiverState();
  s.homes = [0];
  place(s, 0, 60);
  stepRiver(s, 1 / 120, input());
  assert.equal(s.lives, 4);
  assert.deepEqual(s.homes, [0]);
  stepRiver(s, 1 / 120, input([], ['ArrowDown']));
  assert.equal(s.frog.grounded, false);
  const q = createRiverState();
  place(q, 0, 101);
  stepRiver(q, 1 / 120, input());
  assert.equal(q.homes.length, 0);
  assert.equal(q.lives, 3);
});
test('river: timer loss is reachable, ends once, freezes completely and restarts cleanly', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  for (let n = 0; n < 120 * 210 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, input());
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const final = g.getState();
  g.update(1 / 30, input(['ArrowUp'], ['ArrowUp']));
  assert.deepEqual(g.getState(), final);
  assert.equal(h.ends.length, 1);
  g.draw(mockContext());
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.round, 1);
  assert.equal(fresh.lives, 4);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.homes.length, 0);
});
test('river: every essential action and rule is available in English and Chinese', () => {
  assert.deepEqual(meta.touchControls.map((c) => c.code).toSorted(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
  ]);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en.length);
    assert.match(c.label.zh, /\p{Script=Han}/u);
  }
  assert.match(meta.description.en, /ferry/i);
  assert.match(meta.description.zh, /渡/);
});

test('river: a late buffered tap launches once after landing, while an early tap expires', () => {
  for (const late of [false, true]) {
    const s = createRiverState();
    clearRoad(s);
    stepRiver(s, 1 / 120, input([], ['ArrowUp']));
    run(s, late ? 0.175 : 0.025);
    stepRiver(s, 1 / 120, input([], ['ArrowRight']));
    run(s, 0.4);
    assert.equal(s.frog.row, 8);
    assert.ok(Math.abs(s.frog.x - (late ? 264 : 240)) < 1e-6);
  }
});
test('river: touchdown uses the deck velocity at contact and only then establishes support', () => {
  const s = createRiverState();
  clearRoad(s);
  place(s, 4, 150);
  const lane = s.lanes.find((l) => l.row === 3);
  lane.speed = 30;
  lane.objects = [{ id: 'landing', x: 120, w: 100 }];
  for (let n = 0; n < 24; n++) stepRiver(s, 0.01, input([], n === 0 ? ['ArrowUp'] : []));
  assert.equal(s.frog.grounded, true);
  assert.equal(s.lives, 4);
  assert.ok(Math.abs(s.frog.x - 150) < 1e-6);
  assert.ok(Math.abs(s.frog.vx - 30) < 1e-8);
  assert.equal(s.lastImpulse.source, 'grip');
});
test('river: a departed frog is independent of a later reversal or wrap of its old deck', () => {
  const s = createRiverState();
  place(s, 2, 150);
  const lane = s.lanes.find((l) => l.row === 2);
  lane.speed = 32;
  lane.objects = [{ id: 'depart', x: 100, w: 120 }];
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  lane.speed = -50000;
  run(s, 0.1);
  assert.ok(Math.abs(s.frog.vx - 32) < 1e-8);
  assert.ok(Math.abs(s.frog.x - (150 + (32 * 13) / 120)) < 1e-6);
  assert.equal(s.lives, 4);
  assert.equal(s.frog.grounded, false);
});
test('river: adjacent moving decks can support separate feet without a phantom water gap', () => {
  const s = createRiverState();
  place(s, 2, 150);
  const lane = s.lanes.find((l) => l.row === 2);
  lane.speed = 32;
  lane.objects = [
    { id: 'a', x: 100, w: 50 },
    { id: 'b', x: 150, w: 50 },
  ];
  run(s, 0.5);
  assert.equal(s.lives, 4);
  assert.ok(Math.abs(s.frog.x - 166) < 1e-6);
});
test('river: a vehicle wrapping offscreen does not sweep a phantom crossing through the frog', () => {
  const s = createRiverState();
  place(s, 6);
  const lane = s.lanes.find((l) => l.row === 6);
  lane.speed = -100;
  lane.objects = [{ id: 'wrap', x: -61.9, w: 38 }];
  stepRiver(s, 1 / 30, input());
  assert.equal(s.lives, 4);
  assert.ok(lane.objects[0].x > 480);
});
test('river: leaving a warning turtle before its dive preserves the airborne frog', () => {
  const s = createRiverState();
  s.round = 2;
  s.lanes = riverLanes(2);
  s.time = 6.57;
  place(s, 2, 150);
  for (const lane of s.lanes)
    if (lane.water) {
      lane.speed = 0;
      lane.objects = [{ id: `deck${lane.row}`, x: 100, w: 120 }];
    }
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  run(s, 0.3);
  assert.equal(s.lives, 4);
  assert.equal(s.frog.row, 1);
  assert.equal(s.frog.grounded, true);
});
test('river: the reversing ferry carries a resting frog without snapping or repeatedly adding velocity', () => {
  const s = createRiverState();
  s.round = 3;
  s.lanes = riverLanes(3);
  const ferry = s.lanes.find((l) => l.kind === 'ferry');
  place(s, 1, ferry.objects[0].x + 90);
  const offset = s.frog.x - ferry.objects[0].x;
  for (let n = 0; n < 120 * 10; n++) {
    stepRiver(s, 1 / 120, input());
    assert.equal(s.lives, 4);
    assert.ok(Math.abs(s.frog.x - ferry.objects[0].x - offset) < 1e-6);
    assert.ok(Math.abs(s.frog.vx) <= 80);
    assert.ok(ferry.objects[0].x >= 24 - 1e-6 && ferry.objects[0].x <= 276 + 1e-6);
  }
});
test('river: timeout before home contact loses; a home reached exactly on the deadline counts', () => {
  for (const exact of [false, true]) {
    const s = createRiverState();
    place(s, 0, 60);
    s.frog.grounded = false;
    s.frog.hop = { dx: 0, dy: -1, age: 0.23 };
    s.frog.z = 0.1;
    s.frog.vz = -10;
    const landing = (-10 + Math.sqrt(100 + 250)) / 1250;
    s.timeLeft = exact ? landing : 0.001;
    stepRiver(s, 1 / 60, input());
    assert.equal(s.lives, exact ? 4 : 3);
    assert.equal(s.homes.length, exact ? 1 : 0);
  }
});

const KEY = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: null };
function plannedCrossing(snapshot, home, { visitOccupied = false } = {}) {
  const queue = [{ state: structuredClone(snapshot), path: [], rank: 0 }],
    seen = new Set(),
    initialLives = snapshot.lives,
    initialRescued = snapshot.rescued;
  let explored = 0;
  while (queue.length && explored++ < 5000) {
    queue.sort((a, b) => a.rank - b.rank);
    const node = queue.shift();
    for (const action of ['U', 'L', 'R', 'W', 'D']) {
      const next = structuredClone(node.state);
      for (let n = 0; n < 18 && next.phase === 'playing'; n++)
        stepRiver(next, 1 / 60, input([], n === 0 && KEY[action] ? [KEY[action]] : []));
      if (next.lives !== initialLives || next.phase === 'lost') continue;
      const path = [...node.path, action];
      if (
        visitOccupied &&
        next.frog.grounded &&
        next.frog.row === 0 &&
        Math.abs(next.frog.x - (home * 120 + 60)) <= 31
      )
        return { path, explored };
      if (next.rescued > initialRescued) {
        if (next.homes.includes(home) || next.round > snapshot.round || next.phase === 'won')
          return { path, explored };
        continue;
      }
      if (path.length >= 90) continue;
      const id = `${next.frog.row}:${Math.round(next.frog.x / 5)}:${path.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const goal = home * 120 + 60,
        rank = path.length * 0.21 + next.frog.row * 1.3 + Math.abs(next.frog.x - goal) / 55;
      queue.push({ state: next, path, rank });
    }
  }
  return { path: null, explored };
}
function playCampaign(t, hz, { recover = false } = {}) {
  const h = harness(),
    g = createGame(h.env);
  let trips = 0,
    totalExplored = 0;
  if (recover) {
    for (let n = 0; n < hz * 15 && g.getState().lives === 4; n++)
      g.update(1 / hz, input(['ArrowUp'], n === 0 ? ['ArrowUp'] : []));
    assert.equal(g.getState().lives, 3);
    assert.equal(g.getState().phase, 'playing');
  }
  while (g.getState().phase === 'playing' && trips++ < 12) {
    for (
      let n = 0;
      n < hz * 3 &&
      (g.getState().spawnDelay > 0 ||
        g.getState().transition > 0 ||
        g.getState().needsRelease ||
        g.getState().rest > 0);
      n++
    )
      g.update(1 / hz, input());
    const snapshot = g.getState();
    assert.equal(snapshot.spawnDelay, 0);
    assert.equal(snapshot.transition, 0);
    assert.equal(snapshot.needsRelease, false);
    const home = [0, 1, 2, 3].find((n) => !snapshot.homes.includes(n)),
      plan = plannedCrossing(snapshot, home);
    totalExplored += plan.explored;
    if (trips === 1 && !recover)
      t.diagnostic(`Opening route (0.30s per action): ${plan.path?.join(' ')}`);
    assert.ok(
      plan.path,
      `stage ${snapshot.round}, home ${home}, time ${snapshot.time.toFixed(2)} explored ${plan.explored}`,
    );
    for (const action of plan.path)
      for (let n = 0; n < hz * 0.3; n++)
        g.update(1 / hz, input([], n === 0 && KEY[action] ? [KEY[action]] : []));
    assert.equal(g.getState().lives, snapshot.lives);
    assert.equal(g.getState().rescued, trips);
    const beforeDraw = g.getState();
    g.draw(mockContext());
    assert.deepEqual(g.getState(), beforeDraw);
  }
  const final = g.getState();
  assert.equal(final.phase, 'won');
  assert.equal(final.rescued, 12);
  assert.equal(final.round, 3);
  assert.equal(final.lives, 4);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  for (let n = 0; n < 30; n++) g.update(1 / hz, input(['ArrowUp'], ['ArrowUp']));
  assert.deepEqual(g.getState(), final);
  assert.equal(h.ends.length, 1);
  t.diagnostic(
    `${hz}Hz ${recover ? 'mistake recovery' : 'clean'}: 12 rescues in ${final.totalTime.toFixed(2)}s; ${totalExplored} planner nodes; score ${final.score}`,
  );
}
for (const hz of [30, 60, 120])
  test(`river: full three-crossing public-input campaign (${hz} Hz)`, (t) => playCampaign(t, hz));
test('river: a real traffic mistake remains recoverable through the entire public-input campaign', (t) =>
  playCampaign(t, 60, { recover: true }));

test('river: a fast wrapped vehicle is swept along the new offscreen entry instead of tunneling', () => {
  const s = createRiverState();
  place(s, 6);
  const lane = s.lanes.find((l) => l.row === 6);
  lane.speed = -100000;
  lane.objects = [{ id: 'lap', x: -61.9, w: 38 }];
  stepRiver(s, 1 / 120, input());
  assert.equal(s.lives, 3);
  assert.equal(s.lastCause, 'traffic');
});

test('river: ferry edge support stays exact across acceleration signs and unrelated turtle events', () => {
  for (const time of [1, 4, 5.399, 6, 6.599, 7.999, 9])
    for (const offset of [11, 169]) {
      const s = createRiverState();
      s.round = 3;
      s.lanes = riverLanes(3);
      s.time = time;
      const ferry = s.lanes.find((l) => l.kind === 'ferry');
      ferry.objects[0].x = 150 + 126 * Math.sin((time * Math.PI) / 5);
      place(s, 1, ferry.objects[0].x + offset);
      stepRiver(s, 1 / 120, input());
      assert.equal(s.lives, 4, `time ${time}, edge ${offset}`);
      assert.ok(Math.abs(s.frog.x - ferry.objects[0].x - offset) < 1e-7);
      assert.ok(
        Math.abs(s.frog.vx - ((126 * Math.PI) / 5) * Math.cos((s.time * Math.PI) / 5)) < 1e-7,
      );
    }
});
test('river: continuous traffic still collides when an object crosses a wrap seam more than once per step', () => {
  const s = createRiverState();
  place(s, 6);
  const lane = s.lanes.find((l) => l.row === 6);
  lane.speed = -400000;
  lane.objects = [{ id: 'lap', x: -61.9, w: 38 }];
  stepRiver(s, 1 / 240, input());
  assert.equal(s.lives, 3);
});

test('river: public snapshots cannot mutate live actors, stages, instructions or later instances', () => {
  const g = createGame(harness().env),
    before = structuredClone(g.getState()),
    copy = g.getState();
  copy.frog.x = 0;
  copy.lanes[0].objects[0].x = 0;
  copy.stage.lesson.en = 'tampered';
  copy.stage.zh = 'tampered';
  copy.homes.push(0);
  assert.deepEqual(g.getState(), before);
  assert.equal(createGame(harness().env).getState().stage.lesson.en, before.stage.lesson.en);
});

test('river: finite air steering lands at the analytic deck edge independent of unrelated event partitions', () => {
  const duration = 0.24 - 1 / 120,
    initialX = 289 - 0.5 * 90 * duration ** 2,
    results = [];
  for (const event of ['none', 'turtle', 'wrap']) {
    const s = createRiverState();
    s.round = 2;
    s.lanes = riverLanes(2);
    clearRoad(s);
    s.time = event === 'turtle' ? 5.399 : 0;
    place(s, 4, initialX);
    const target = s.lanes.find((l) => l.row === 3);
    target.speed = 0;
    target.objects = [{ id: 'target', x: 200, w: 100 }];
    if (event === 'wrap') {
      const l = s.lanes.find((l) => l.row === 8);
      l.speed = -100;
      l.objects = [{ id: 'unrelated', x: -61.9, w: 38 }];
    }
    stepRiver(s, 1 / 120, input(['ArrowUp'], ['ArrowUp']));
    for (let n = 0; n < 28; n++) stepRiver(s, 1 / 120, input(['ArrowRight']));
    assert.equal(s.lives, 4, event);
    assert.equal(s.frog.grounded, true);
    assert.ok(Math.abs(s.frog.x - 289) < 1e-8, event);
    results.push(s.frog.x);
  }
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-9);
});

test('river: leg and contact impulses have equal opposite surface reactions and passive landings lose energy', () => {
  const s = createRiverState();
  clearRoad(s);
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  const launch = s.lastImpulse;
  assert.equal(launch.source, 'legs');
  for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(launch[axis] + launch.reaction[axis]) < 1e-8);
  assert.ok(launch.work > 0);
  run(s, 0.24);
  const landing = s.lastImpulse;
  assert.equal(landing.source, 'grip');
  for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(landing[axis] + landing.reaction[axis]) < 1e-8);
  assert.ok(landing.work < 0);
  assert.ok(Math.abs(s.frog.vx) + Math.abs(s.frog.vy) + Math.abs(s.frog.vz) < 1e-8);
});

test('river: traffic contact at the exact step endpoint counts, while separating tangency stays harmless', () => {
  for (const [x, speed, expected] of [
    [253, -240, 3],
    [251, 50, 4],
    [251, 0, 4],
  ]) {
    const s = createRiverState();
    place(s, 6);
    const lane = s.lanes.find((l) => l.row === 6);
    lane.speed = speed;
    lane.objects = [{ id: 'contact', x, w: 40 }];
    stepRiver(s, 1 / 120, input());
    assert.equal(s.lives, expected);
  }
});

test('river: safe waiting and revisiting rows or filled pads cannot farm progress', () => {
  const s = createRiverState();
  clearRoad(s);
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  run(s, 0.3);
  const score = s.score;
  stepRiver(s, 1 / 120, input([], ['ArrowDown']));
  run(s, 0.3);
  stepRiver(s, 1 / 120, input([], ['ArrowUp']));
  run(s, 0.3);
  assert.equal(s.score, score);
  s.homes = [0];
  place(s, 0, 60);
  const before = s.score;
  run(s, 1);
  assert.equal(s.score, before);
  assert.equal(s.rescued, 0);
});
test('river: seeded legal input remains deterministic, finite and bounded in simulation and rendering', () => {
  const a = createGame(harness({ seed: 9 }).env),
    b = createGame(harness({ seed: 9 }).env),
    random = seeded(42),
    directions = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', null];
  let key = null;
  for (let n = 0; n < 6000; n++) {
    if (n % 19 === 0) key = directions[Math.floor(random() * directions.length)];
    const controls = input(key ? [key] : [], n % 19 === 0 && key ? [key] : []);
    a.update(1 / 120, controls);
    b.update(1 / 120, controls);
    if (n % 41 === 0) {
      const s = a.getState();
      assert.deepEqual(s, b.getState());
      for (const v of [
        s.frog.x,
        s.frog.y,
        s.frog.z,
        s.frog.vx,
        s.frog.vy,
        s.frog.vz,
        s.time,
        s.timeLeft,
        s.score,
      ])
        assert.ok(Number.isFinite(v));
      assert.ok(s.frog.x >= 11 - 1e-6 && s.frog.x <= 469 + 1e-6);
      assert.ok(s.frog.y >= center(0) - 1e-6 && s.frog.y <= center(9) + 1e-6);
      assert.ok(s.frog.z >= -1e-6 && s.frog.z <= 10);
      assert.ok(s.ripples.length <= 12);
      assert.ok(s.lanes.reduce((sum, l) => sum + l.objects.length, 0) < 40);
      assert.ok(JSON.stringify(s).length < 20000);
      a.draw(mockContext());
    }
  }
});

test('river: an occupied home is recoverable by waiting for a deck, returning to the river and rescuing elsewhere', () => {
  const h = harness(),
    g = createGame(h.env),
    perform = (path) => {
      for (const action of path)
        for (let n = 0; n < 18; n++)
          g.update(1 / 60, input([], n === 0 && KEY[action] ? [KEY[action]] : []));
    };
  const first = plannedCrossing(g.getState(), 0);
  assert.ok(first.path);
  perform(first.path);
  for (
    let n = 0;
    n < 180 && (g.getState().spawnDelay > 0 || g.getState().needsRelease || g.getState().rest > 0);
    n++
  )
    g.update(1 / 60, input());
  const occupied = plannedCrossing(g.getState(), 0, { visitOccupied: true });
  assert.ok(occupied.path);
  perform(occupied.path);
  assert.equal(g.getState().frog.row, 0);
  assert.equal(g.getState().rescued, 1);
  assert.equal(g.getState().lives, 4);
  const canReturn = () => {
    const s = structuredClone(g.getState());
    for (let n = 0; n < 18; n++) stepRiver(s, 1 / 60, input([], n === 0 ? ['ArrowDown'] : []));
    return s.lives === 4 && s.frog.grounded && s.frog.row === 1;
  };
  for (let n = 0; n < 600 && canReturn(); n++) g.update(1 / 60, input());
  let waited = 0;
  for (; waited < 600 && !canReturn(); waited++) g.update(1 / 60, input());
  assert.ok(waited > 0 && waited < 600);
  assert.equal(g.getState().lives, 4);
  perform(['D']);
  assert.equal(g.getState().frog.row, 1);
  assert.equal(g.getState().lives, 4);
  const escape = plannedCrossing(g.getState(), 1);
  assert.ok(escape.path);
  perform(escape.path);
  assert.equal(g.getState().rescued, 2);
  assert.deepEqual(g.getState().homes, [0, 1]);
  assert.equal(g.getState().lives, 4);
  g.draw(mockContext());
});

test('river: detailed lessons stay in the host status and short canvas cues stay above traversable ground', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env),
      s = g.getState(),
      calls = [],
      ctx = mockContext();
    ctx.fillText = (value, x, y) => calls.push({ value, x, y });
    g.draw(ctx);
    assert.ok(s.status[lang].includes(s.stage.lesson[lang]));
    for (const c of calls)
      if (c.value === s.stage.lesson[lang] || /WAIT FOR A GAP|等车道空隙/.test(c.value))
        assert.ok(c.y < 34);
  }
});
