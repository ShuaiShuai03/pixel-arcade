import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createSnakeState,
  stepSnake,
  spawnFood,
  gardenRocks,
  isGateOpen,
  advanceGarden,
  updateSnake,
  meta,
} from '../src/games/neon-snake.js';
import { harness, input, mockContext, seeded } from './harness.js';
const DIRS = [
  [1, 0, 'ArrowRight'],
  [0, 1, 'ArrowDown'],
  [-1, 0, 'ArrowLeft'],
  [0, -1, 'ArrowUp'],
];
const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
function prepared(level) {
  const random = seeded(1),
    s = createSnakeState(random);
  if (level > 1) {
    for (let n = 0; n < 6; n++) {
      s.food = { x: s.snake[0].x + 1, y: 7 };
      stepSnake(s, { x: 1, y: 0 }, random);
    }
    assert.ok(s.betweenGardens);
    advanceGarden(s, random);
  }
  if (level > 2) {
    stepSnake(s, { x: 0, y: -1 }, random);
    for (let y = 5; y >= 1; y--) {
      s.food = { x: 5, y };
      stepSnake(s, { x: 0, y: -1 }, random);
    }
    s.food = { x: 6, y: 1 };
    stepSnake(s, { x: 1, y: 0 }, random);
    advanceGarden(s, random);
  }
  return s;
}
test('Snake valid grid turns eat once and keep growth and score', () => {
  const s = createSnakeState(seeded(1));
  s.food = { x: 9, y: 7 };
  stepSnake(s, { x: 1, y: 0 }, seeded(2));
  assert.equal(s.eaten, 1);
  assert.equal(s.score, 100);
  assert.equal(s.snake.length, 5);
  stepSnake(s, { x: -1, y: 0 }, seeded(2));
  assert.deepEqual(s.snake[0], { x: 10, y: 7 });
  assert.equal(s.phase, 'playing');
});
test('Snake zero duration and invalid dt preserve queues, resources, counters and input edges', () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    const g = createGame(harness().env),
      before = g.getState();
    let reads = 0;
    g.update(dt, {
      held: () => {
        reads++;
        return true;
      },
      pressed: () => {
        reads++;
        return true;
      },
      pointer: { x: 20, y: 20, down: true, clicked: true },
    });
    assert.deepEqual(g.getState(), before);
    assert.equal(reads, 0);
  }
});
test('Snake invalid direction vectors cannot create diagonal or stationary moves', () => {
  for (const d of [
    { x: 1, y: 1 },
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: NaN, y: 0 },
  ]) {
    const s = createSnakeState(seeded(1));
    stepSnake(s, d, seeded(2));
    assert.deepEqual(s.snake[0], { x: 9, y: 7 });
  }
});
test('Snake wall, rock, body and closed-gate collisions preserve the last valid body', () => {
  for (const kind of ['edge', 'stone', 'body', 'gate']) {
    const s = kind === 'gate' ? prepared(2) : createSnakeState(seeded(1));
    s.food = { x: 0, y: 0 };
    if (kind === 'edge') s.snake = [{ x: 23, y: 7 }];
    if (kind === 'stone') s.rocks = [{ x: 9, y: 7 }];
    if (kind === 'body')
      s.snake = [
        { x: 8, y: 7 },
        { x: 9, y: 7 },
        { x: 9, y: 8 },
        { x: 8, y: 8 },
      ];
    if (kind === 'gate') s.stageSteps = 4;
    const body = structuredClone(s.snake),
      steps = s.stageSteps;
    stepSnake(s, kind === 'gate' ? { x: 0, y: -1 } : { x: 1, y: 0 }, seeded(2));
    assert.equal(s.phase, 'lost');
    assert.equal(s.crash.reason, kind);
    assert.deepEqual(s.snake, body);
    assert.equal(s.stageSteps, steps);
  }
});
test('Snake enters a vacating tail but a growth step cannot vacate it', () => {
  for (const eating of [false, true]) {
    const s = createSnakeState(seeded(1));
    s.snake = [
      { x: 8, y: 7 },
      { x: 8, y: 8 },
      { x: 9, y: 8 },
      { x: 9, y: 7 },
    ];
    s.food = eating ? { x: 9, y: 7 } : { x: 2, y: 2 };
    stepSnake(s, { x: 1, y: 0 }, seeded(2));
    assert.equal(s.phase, eating ? 'lost' : 'playing');
  }
});
test('Snake food never occupies bodies, obstacles, gates or underpasses', () => {
  for (let level = 1; level <= 3; level++) {
    const s = prepared(level);
    for (let seed = 0; seed < 100; seed++) {
      const food = spawnFood(s, seeded(seed));
      assert.ok(food);
      assert.ok(
        ![...s.snake, ...s.rocks, ...s.gates, ...s.underpasses].some(
          (p) => p.x === food.x && p.y === food.y,
        ),
      );
    }
  }
});
test('Snake announced travel preserves all ten and sixteen body cells on safe contiguous entrance rails', () => {
  const two = prepared(2),
    three = prepared(3);
  assert.equal(two.snake.length, 10);
  assert.equal(three.snake.length, 16);
  for (const s of [two, three]) {
    assert.equal(new Set(s.snake.map((p) => `${p.x},${p.y}`)).size, s.snake.length);
    for (let n = 0; n < s.snake.length; n++) {
      const p = s.snake[n];
      assert.ok(p.x >= 0 && p.x < 24 && p.y >= 0 && p.y < 14);
      assert.ok(!s.rocks.some((r) => r.x === p.x && r.y === p.y));
      if (n) assert.ok(adjacent(s.snake[n - 1], p));
    }
    assert.equal(s.brake, 1);
  }
});
test('Snake intermission does not move or accept hidden queued turns; Enter travels only once', () => {
  const s = createSnakeState(seeded(1)),
    h = harness();
  for (let n = 0; n < 6; n++) {
    s.food = { x: s.snake[0].x + 1, y: 7 };
    stepSnake(s, { x: 1, y: 0 }, h.env.random);
  }
  const body = structuredClone(s.snake);
  for (let n = 0; n < 30; n++)
    updateSnake(s, 1 / 30, input(['Space', 'ArrowDown'], ['ArrowDown']), h.env);
  assert.deepEqual(s.snake, body);
  assert.equal(s.queue.length, 0);
  updateSnake(s, 1 / 120, input([], ['Enter']), h.env);
  assert.equal(s.level, 2);
  assert.equal(s.snake.length, 10);
  updateSnake(s, 1 / 120, input([], ['Enter']), h.env);
  assert.equal(s.level, 2);
});
test('Snake opposite simultaneous inputs cancel and a perpendicular chord is not ordered arbitrarily', () => {
  for (const keys of [
    ['ArrowUp', 'ArrowDown'],
    ['ArrowLeft', 'ArrowRight'],
  ]) {
    const g = createGame(harness().env);
    g.update(1 / 120, input(keys, keys));
    assert.equal(g.getState().queue.length, 0);
  }
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp', 'ArrowLeft']));
  assert.deepEqual(g.getState().queue, [{ x: 0, y: -1 }]);
});
test('Snake two turns buffer across distinct input frames and reject reversal and queue overflow', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp']));
  g.update(1 / 120, input([], ['ArrowDown']));
  assert.deepEqual(g.getState().queue, [{ x: 0, y: -1 }]);
  g.update(1 / 120, input([], ['ArrowLeft']));
  g.update(1 / 120, input([], ['ArrowDown']));
  assert.equal(g.getState().queue.length, 2);
  while (g.getState().steps < 2) g.update(1 / 120, input());
  assert.deepEqual(g.getState().snake[0], { x: 7, y: 6 });
  assert.deepEqual(g.getState().direction, { x: -1, y: 0 });
});
test('Snake held turns do not repeat, and a swipe works without a separate click event', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 48; n++) g.update(1 / 120, input(['ArrowUp']));
  assert.deepEqual(g.getState().snake[0], { x: 8, y: 5 });
  assert.equal(g.getState().queue.length, 0);
  const swipe = createGame(harness().env);
  swipe.update(1 / 120, input([], [], { x: 230, y: 200, down: true }));
  swipe.update(1 / 120, input([], [], { x: 230, y: 170, down: true }));
  while (swipe.getState().steps < 1) swipe.update(1 / 120, input());
  assert.deepEqual(swipe.getState().direction, { x: 0, y: -1 });
});
test('Snake gate phase is a move clock and occupied gates never close onto a body', () => {
  const s = prepared(2),
    a = s.gates[0];
  s.stageSteps = 3;
  s.food = { x: 4, y: 2 };
  stepSnake(s, { x: 0, y: -1 }, seeded(1));
  assert.equal(s.stageSteps, 4);
  assert.ok(isGateOpen(s, a));
  assert.deepEqual(s.snake[0], { x: 5, y: 6 });
  s.snake = [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 5, y: 8 },
  ];
  s.direction = { x: 0, y: -1 };
  s.stageSteps = 4;
  for (let n = 0; n < 3; n++) stepSnake(s, { x: 0, y: -1 }, seeded(1));
  assert.equal(s.stageSteps, 7);
  assert.equal(isGateOpen(s, a), false);
});
test('Snake a gate held by the vacating tail permits safe entry but not self-growth overlap', () => {
  for (const eating of [false, true]) {
    const s = prepared(2);
    // Isolate the gate/tail rule on a valid open approach cell.
    s.rocks = s.rocks.filter((p) => !(p.x === 4 && p.y === 6));
    s.snake = [
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 5, y: 6 },
    ];
    s.direction = { x: 1, y: 0 };
    s.stageSteps = 4;
    s.food = eating ? { x: 5, y: 6 } : { x: 4, y: 2 };
    stepSnake(s, { x: 1, y: 0 }, seeded(1));
    assert.equal(s.phase, eating ? 'lost' : 'playing');
  }
});
test('Snake underpass movement stays adjacent and blocks an occupied exit', () => {
  for (const blocked of [false, true]) {
    const s = prepared(3),
      body = [
        { x: 11, y: 3 },
        { x: 10, y: 3 },
      ];
    for (let y = 4; y <= 10; y++) body.push({ x: 10, y });
    body.push({ x: 11, y: 10 }, { x: 12, y: 10 });
    for (let y = 9; y >= 3; y--) body.push({ x: 12, y });
    if (blocked) body.push({ x: 13, y: 3 });
    s.snake = body;
    s.direction = { x: 1, y: 0 };
    s.food = { x: 18, y: 4 };
    s.crossingFrom = 'left';
    const head = { ...s.snake[0] };
    stepSnake(s, { x: 1, y: 0 }, seeded(1));
    assert.equal(s.phase, blocked ? 'lost' : 'playing');
    if (!blocked) {
      assert.ok(adjacent(head, s.snake[0]));
      assert.equal(s.crossings, 1);
    }
  }
});
test('Snake no portal data or coordinate replacement remains in the grid state', () => {
  const s = prepared(3);
  assert.equal(s.portals, undefined);
  assert.deepEqual(
    s.underpasses.map((p) => [p.x, p.y]),
    [
      [11, 3],
      [11, 10],
    ],
  );
});
function patrol(s) {
  const p = s.snake[0],
    d = s.direction;
  if (d.x === 1 && p.x === 14) return 'ArrowDown';
  if (d.y === 1 && p.y === 11) return 'ArrowLeft';
  if (d.x === -1 && p.x === 4) return 'ArrowUp';
  if (d.y === -1 && p.y === 7) return 'ArrowRight';
  return null;
}
test('Snake Focus settles empty while held, recharges only on release, and can rearm', () => {
  for (const hz of [30, 60, 120]) {
    const s = createSnakeState(seeded(1)),
      h = harness();
    s.rocks = [];
    s.food = { x: 0, y: 0 };
    let last = -1;
    for (let n = 0; n < hz * 8; n++) {
      let pressed = [];
      if (s.steps !== last) {
        const k = patrol(s);
        if (k) pressed = [k];
        last = s.steps;
      }
      updateSnake(s, 1 / hz, input(['Space'], pressed), h.env);
    }
    assert.equal(s.brake, 0);
    assert.equal(s.braking, false);
    assert.equal(s.focusLocked, true);
    for (let n = 0; n < hz; n++) {
      let pressed = [];
      if (s.steps !== last) {
        const k = patrol(s);
        if (k) pressed = [k];
        last = s.steps;
      }
      updateSnake(s, 1 / hz, input([], pressed), h.env);
    }
    assert.ok(Math.abs(s.brake - 0.12) < 1e-8);
    updateSnake(s, 1 / hz, input(['Space']), h.env);
    assert.equal(s.braking, true);
    assert.ok(s.brake < 0.12);
  }
});
test('Snake Focus changes speed without losing accrued step progress; Calm has an inspectable state', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 12; n++) g.update(1 / 120, input());
  const progress = g.getState().progress;
  g.update(1 / 120, input(['Space']));
  assert.ok(g.getState().progress > progress);
  assert.equal(g.getState().steps, 0);
  g.update(1 / 120, input([], ['KeyC']));
  assert.equal(g.getState().calm, true);
  g.update(1 / 120, input(['KeyC']));
  assert.equal(g.getState().calm, true);
});

function plan(s, target = s.food) {
  const blocked = new Set([...s.rocks, ...s.snake.slice(0, -1)].map((p) => `${p.x},${p.y}`));
  const q = [
      {
        ...s.snake[0],
        direction: DIRS.findIndex((d) => d[0] === s.direction.x && d[1] === s.direction.y),
        depth: 0,
        key: null,
      },
    ],
    seen = new Set();
  for (let at = 0; at < q.length && at < 20000; at++) {
    const p = q[at];
    if (p.x === target.x && p.y === target.y) return p.key;
    for (let n = 0; n < 4; n++) {
      if ((n + 2) % 4 === p.direction) continue;
      const [dx, dy, key] = DIRS[n],
        x = p.x + dx,
        y = p.y + dy,
        id = `${x},${y}`;
      if (x < 0 || x >= 24 || y < 0 || y >= 14 || blocked.has(id)) continue;
      const gate = s.gates.find((g) => g.x === x && g.y === y),
        held = s.snake.some((b) => b.x === x && b.y === y);
      if (gate && !held && Math.floor((s.stageSteps + p.depth) / 4) % 2 !== gate.group) continue;
      const visit = `${id},${(s.stageSteps + p.depth + 1) % 8},${n}`;
      if (seen.has(visit)) continue;
      seen.add(visit);
      q.push({ x, y, direction: n, depth: p.depth + 1, key: p.key ?? key });
    }
  }
  return null;
}
function campaign(hz, seed, recover = false) {
  const h = harness({ seed }),
    g = createGame(h.env);
  let last = -1,
    waitGoal = null,
    focusPhase = recover ? 0 : 3,
    refillStarted = 0,
    depleted = false,
    rearmed = false,
    callback = null;
  h.env.end = (r) => {
    h.ends.push(r);
    callback = g.getState();
  };
  for (let frame = 0; frame < hz * 360 && g.getState().phase === 'playing'; frame++) {
    const s = g.getState();
    let pressed = [],
      held = [];
    if (frame === 0 && seed === 42) pressed.push('KeyC');
    if (focusPhase === 0 && s.focusLocked) {
      focusPhase = 1;
      depleted = true;
    }
    if (focusPhase === 1 && s.brake >= 0.15) {
      focusPhase = 2;
      refillStarted = s.time;
    }
    if (focusPhase === 2) {
      if (s.braking) rearmed = true;
      if (s.time - refillStarted > 1) focusPhase = 3;
    }
    if (focusPhase === 0 || focusPhase === 2) held = ['Space'];
    if (s.betweenGardens) {
      pressed.push('Enter');
      last = -1;
      waitGoal = null;
    } else if (s.steps !== last) {
      let key = plan(s);
      if (key) waitGoal = null;
      else {
        if (!waitGoal || (s.snake[0].x === waitGoal.x && s.snake[0].y === waitGoal.y)) {
          const points =
            s.snake[0].x < 11
              ? [
                  { x: 2, y: 2 },
                  { x: 2, y: 11 },
                  { x: 9, y: 2 },
                  { x: 9, y: 11 },
                ]
              : [
                  { x: 13, y: 2 },
                  { x: 21, y: 2 },
                  { x: 13, y: 11 },
                  { x: 21, y: 11 },
                ];
          waitGoal = points
            .toSorted(
              (a, b) =>
                Math.abs(b.x - s.snake[0].x) +
                Math.abs(b.y - s.snake[0].y) -
                Math.abs(a.x - s.snake[0].x) -
                Math.abs(a.y - s.snake[0].y),
            )
            .find((p) => plan(s, p));
        }
        key = waitGoal ? plan(s, waitGoal) : null;
      }
      assert.ok(key, `legal route or tail-clearing loop exists (garden ${s.level})`);
      pressed.push(key);
      last = s.steps;
    }
    g.update(1 / hz, input(held, pressed));
    const after = g.getState();
    if (after.level === s.level && after.steps !== s.steps)
      assert.ok(adjacent(after.snake[0], s.snake[0]));
    if (frame % (hz * 4) === 0 || after.betweenGardens) g.draw(mockContext());
  }
  return { g, h, callback, depleted, rearmed };
}
test('Snake all authored gardens complete by public keyboard controls with normal/calm and Focus recovery at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120])
    for (const seed of [1, 42])
      for (const recover of [false, true]) {
        const { g, h, callback, depleted, rearmed } = campaign(hz, seed, recover),
          s = g.getState();
        assert.equal(s.phase, 'won', `rate ${hz}, seed ${seed}, recovery ${recover}`);
        assert.equal(s.eaten, 18);
        assert.equal(s.snake.length, 22);
        assert.equal(s.score, 2400);
        assert.ok(s.crossings >= 6);
        assert.equal(h.ends.length, 1);
        assert.deepEqual(s, callback);
        if (recover) {
          assert.ok(depleted);
          assert.ok(rearmed);
        }
        const frozen = g.getState();
        g.update(1 / hz, input(['Space', 'ArrowDown'], ['Enter', 'KeyC']));
        assert.deepEqual(g.getState(), frozen);
      }
});
test('Snake actual edge loss and new-instance reset work at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120]) {
    const h = harness(),
      g = createGame(h.env);
    let callback;
    h.env.end = (r) => {
      h.ends.push(r);
      callback = g.getState();
    };
    for (let n = 0; n < hz * 8 && g.getState().phase === 'playing'; n++) g.update(1 / hz, input());
    const s = g.getState();
    assert.equal(s.phase, 'lost');
    assert.equal(s.crash.reason, 'edge');
    assert.equal(h.ends.length, 1);
    assert.deepEqual(s, callback);
    g.update(1 / hz, input(['ArrowUp', 'Space'], ['KeyC']));
    assert.deepEqual(g.getState(), s);
    const fresh = createGame(h.env).getState();
    assert.equal(fresh.eaten, 0);
    assert.equal(fresh.snake.length, 4);
    assert.equal(fresh.brake, 1);
    assert.equal(fresh.calm, false);
    assert.equal(fresh.steps, 0);
    assert.deepEqual(fresh.queue, []);
  }
});
test('Snake a tight loop after real growth causes a public-input body collision', () => {
  const h = harness(),
    g = createGame(h.env);
  let last = -1,
    turn = 0;
  for (let n = 0; n < 1500 && g.getState().phase === 'playing'; n++) {
    const s = g.getState(),
      pressed = [];
    if (s.eaten && s.steps !== last) {
      pressed.push(['ArrowDown', 'ArrowLeft', 'ArrowUp'][Math.min(turn++, 2)]);
      last = s.steps;
    }
    g.update(1 / 120, input([], pressed));
  }
  assert.equal(g.getState().phase, 'lost');
  assert.equal(g.getState().crash.reason, 'body');
  assert.equal(h.ends.length, 1);
});
test('Snake exact Focus-empty event and step progress are invariant across tick boundaries', () => {
  const h = harness(),
    s = createSnakeState(seeded(1));
  s.brake = 0.0022;
  s.braking = true;
  updateSnake(s, 0.03, input(['Space']), h.env);
  const expected = 0.01 / (0.18 * 1.9) + 0.02 / 0.18;
  assert.ok(Math.abs(s.progress - expected) < 1e-10);
  assert.equal(s.brake, 0);
  assert.equal(s.braking, false);
  assert.equal(s.focusLocked, true);
  const split = createSnakeState(seeded(1));
  split.brake = 0.0022;
  split.braking = true;
  for (let n = 0; n < 3; n++) updateSnake(split, 0.01, input(['Space']), h.env);
  assert.ok(Math.abs(split.progress - s.progress) < 1e-10);
});
test('Snake Focus under ten percent cannot start and resource readiness is explicit', () => {
  const s = createSnakeState(seeded(1)),
    h = harness();
  s.brake = 0.05;
  updateSnake(s, 1 / 120, input(['Space']), h.env);
  assert.equal(s.braking, false);
  assert.equal(s.focusLocked, true);
  const before = s.brake;
  updateSnake(s, 1 / 30, input(), h.env);
  assert.ok(s.brake > before);
  assert.equal(s.focusLocked, false);
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['KeyC']));
  assert.match(g.getState().status.en, /Calm/);
  assert.match(g.getState().status.en, /Focus ready/);
});
test('Snake fractional movement matches rates and large dt is capped rather than skipping cells', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ seed: 9 }).env);
    for (let n = 0; n < hz * 0.6; n++) g.update(1 / hz, input(['ArrowUp']));
    return g.getState();
  });
  for (const s of states) {
    assert.deepEqual(s.snake, states[0].snake);
    assert.ok(Math.abs(s.progress - states[0].progress) < 1e-10);
    assert.equal(s.steps, 3);
  }
  const a = createGame(harness().env),
    b = createGame(harness().env);
  a.update(10, input());
  b.update(1 / 30, input());
  assert.deepEqual(a.getState(), b.getState());
});
test('Snake food full-board boundary returns null safely', () => {
  const s = createSnakeState(seeded(1));
  s.rocks = [];
  s.gates = [];
  s.underpasses = [];
  s.snake = [];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) s.snake.push({ x, y });
  assert.equal(spawnFood(s, seeded(1)), null);
});
test('Snake deterministic public input state remains finite and all arrays are bounded', () => {
  const games = [createGame(harness({ seed: 19 }).env), createGame(harness({ seed: 19 }).env)],
    random = seeded(4);
  let held = [];
  const finite = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v));
    else if (v && typeof v === 'object') Object.values(v).forEach(finite);
  };
  for (let n = 0; n < 1800; n++) {
    if (n % 10 === 0)
      held = [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown']][
        Math.floor(random() * 4)
      ].concat(random() < 0.4 ? ['Space'] : []);
    for (const g of games) g.update(1 / 120, input(held, n % 200 === 0 ? ['KeyC'] : []));
    if (n % 120 === 0) {
      const s = games[0].getState();
      finite(s);
      assert.ok(s.queue.length <= 2 && s.celebration.length <= 4 && s.snake.length <= 22);
      assert.deepEqual(s, games[1].getState());
      games[0].draw(mockContext());
    }
  }
});
test('Snake all keyboard-equivalent touch actions are complete and the key guide is bilingual', () => {
  for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'Enter', 'KeyC'])
    assert.ok(meta.touchControls.some((c) => c.code === code && c.side));
  assert.equal(typeof meta.keys[0].keys.zh, 'string');
  const chinese = createGame(harness({ lang: 'zh' }).env);
  chinese.draw(mockContext());
  assert.match(chinese.getState().status.zh, /标准速度/);
});
