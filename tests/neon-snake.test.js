import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createSnakeState,
  stepSnake,
  spawnFood,
  isGateOpen,
  advanceLevel,
  updateSnake,
  LEVELS,
  LEVEL_COUNT,
} from '../src/games/neon-snake.js';
import { harness, input, mockContext, seeded } from './harness.js';

const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
const RIGHT = { x: 1, y: 0 };
const UP = { x: 0, y: -1 };
/** A level-1 state that has finished its countdown, with free space around the snake. */
function field(level = 1) {
  const s = createSnakeState(level, seeded(1));
  s.ready = 0;
  return s;
}
const skipReady = (g) => {
  while (g.getState().ready > 0) g.update(1 / 60, input());
};
/** Eat `count` fruit one cell ahead of the head on level 1. */
function eatAhead(s, count, random = seeded(1)) {
  for (let n = 0; n < count; n++) {
    s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };
    stepSnake(s, RIGHT, random);
  }
}

test('Snake valid grid turns eat once and keep growth and score', () => {
  const s = field();
  s.food = { x: 5, y: 7 };
  stepSnake(s, RIGHT, seeded(2));
  assert.equal(s.eaten, 1);
  assert.equal(s.score, 100);
  assert.equal(s.snake.length, 4);
  stepSnake(s, { x: -1, y: 0 }, seeded(2));
  assert.deepEqual(s.snake[0], { x: 6, y: 7 });
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
  const s = field();
  const before = structuredClone(s);
  updateSnake(s, NaN, input([], ['KeyC']), harness().env);
  assert.deepEqual(s, before);
});
test('Snake invalid direction vectors cannot create diagonal or stationary moves', () => {
  for (const d of [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 }, { x: NaN, y: 0 }, null]) {
    const s = field();
    stepSnake(s, d, seeded(2));
    assert.deepEqual(s.snake[0], { x: 5, y: 7 });
  }
});
test('Snake wall, rock, body and closed-gate collisions preserve the last valid body', () => {
  for (const kind of ['edge', 'stone', 'body', 'gate']) {
    const s = field(kind === 'gate' ? 5 : 1);
    s.food = { x: 0, y: 0 };
    if (kind === 'edge') s.snake = [{ x: 23, y: 7 }];
    if (kind === 'stone') s.rocks = [{ x: 5, y: 7 }];
    if (kind === 'body')
      s.snake = [
        { x: 8, y: 7 },
        { x: 9, y: 7 },
        { x: 9, y: 8 },
        { x: 8, y: 8 },
      ];
    if (kind === 'gate') {
      s.stageSteps = 4;
      s.snake = [
        { x: 5, y: 7 },
        { x: 5, y: 8 },
      ];
    }
    const body = structuredClone(s.snake),
      steps = s.stageSteps;
    stepSnake(s, kind === 'gate' ? UP : RIGHT, seeded(2));
    assert.equal(s.phase, 'lost');
    assert.equal(s.crash.reason, kind);
    assert.deepEqual(s.snake, body);
    assert.equal(s.stageSteps, steps);
  }
});
test('Snake enters a vacating tail but a growth step cannot vacate it', () => {
  for (const eating of [false, true]) {
    const s = field();
    s.snake = [
      { x: 8, y: 7 },
      { x: 8, y: 8 },
      { x: 9, y: 8 },
      { x: 9, y: 7 },
    ];
    s.food = eating ? { x: 9, y: 7 } : { x: 2, y: 2 };
    stepSnake(s, RIGHT, seeded(2));
    assert.equal(s.phase, eating ? 'lost' : 'playing');
  }
});
test('Snake food follows its bed, never lands on bodies or obstacles, and degrades safely', () => {
  for (const level of LEVELS) {
    const s = field(level.n);
    for (let seed = 0; seed < 20; seed++) {
      const food = spawnFood(s, seeded(seed));
      assert.ok(level.beds[0].some((p) => p.x === food.x && p.y === food.y));
      assert.ok(
        ![...s.snake, ...s.rocks, ...s.gates, ...s.underpasses].some(
          (p) => p.x === food.x && p.y === food.y,
        ),
      );
    }
    // A bed cell under the body moves the fruit to the nearest free cell.
    s.snake = [{ ...level.beds[0][0] }, ...s.snake.slice(1)];
    s.stageFruit = 0;
    const moved = spawnFood(s, seeded(1));
    assert.ok(moved && !s.snake.some((p) => p.x === moved.x && p.y === moved.y));
    assert.ok(adjacent(moved, level.beds[0][0]) || level.beds[0].length > 1);
  }
  const s = field();
  s.rocks = [];
  s.gates = [];
  s.underpasses = [];
  s.snake = [];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) s.snake.push({ x, y });
  assert.equal(spawnFood(s, seeded(1)), null);
  s.stageFruit = 99;
  assert.equal(spawnFood(s, seeded(1)), null);
});
test('Snake a filled board ends as a win', () => {
  const s = field(),
    others = [];
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 24; x++) if (!(y === 7 && (x === 4 || x === 5))) others.push({ x, y });
  s.snake = [{ x: 4, y: 7 }, ...others];
  s.rocks = [];
  s.food = { x: 5, y: 7 };
  stepSnake(s, RIGHT, seeded(1));
  assert.equal(s.phase, 'won');
  assert.equal(s.filled, true);
});
test('Snake a cleared level pauses, keeps nothing hidden, and Enter travels only once', () => {
  const s = field(),
    h = harness();
  eatAhead(s, 4);
  assert.ok(s.betweenGardens);
  assert.equal(s.score, 600);
  assert.equal(s.food, null);
  const body = structuredClone(s.snake);
  for (let n = 0; n < 30; n++)
    updateSnake(s, 1 / 30, input(['Space', 'ArrowDown'], ['ArrowDown']), h.env);
  assert.deepEqual(s.snake, body);
  assert.equal(s.queue.length, 0);
  updateSnake(s, 1 / 120, input([], ['Enter']), h.env);
  assert.equal(s.level, 2);
  assert.equal(s.score, 600);
  assert.equal(s.snake.length, LEVELS[1].snake.length);
  assert.ok(s.ready > 0);
  assert.equal(s.brake, 1);
  updateSnake(s, 1 / 120, input([], ['Enter']), h.env);
  assert.equal(s.level, 2);
  assert.equal(advanceLevel(s, seeded(1)), false);
  const last = field(LEVEL_COUNT);
  last.betweenGardens = true;
  assert.equal(advanceLevel(last, seeded(1)), false);
  assert.equal(createSnakeState(999).level, LEVEL_COUNT);
  assert.equal(createSnakeState(-3).level, 1);
  assert.equal(createSnakeState('x').level, 1);
});
test('Snake each level loads its own terrain, body, pace and clock from the table', () => {
  for (const level of LEVELS) {
    const s = createSnakeState(level.n, seeded(1));
    assert.deepEqual(s.snake, level.snake);
    assert.deepEqual(s.direction, level.direction);
    assert.equal(s.rocks, level.rocks);
    assert.equal(s.target, level.target);
    assert.equal(s.gatePeriod, level.gatePeriod);
    assert.equal(s.ready, level.ready);
    assert.equal(s.stageFruit, 0);
    s.snake.push({ x: -5, y: -5 });
    assert.equal(level.snake.length, s.snake.length - 1, 'the table is never mutated');
  }
});
test('Snake the countdown holds the snake but accepts a queued turn and Calm', () => {
  const g = createGame(harness().env),
    start = g.getState();
  g.update(1, input([], ['ArrowUp', 'KeyC']));
  const s = g.getState();
  assert.deepEqual(s.snake, start.snake);
  assert.equal(s.steps, 0);
  assert.deepEqual(s.queue, [UP]);
  assert.equal(s.calm, true);
  assert.ok(Math.abs(s.ready - (start.ready - 1 / 30)) < 1e-12);
  skipReady(g);
  g.update(1 / 120, input());
  assert.ok(g.getState().progress > 0);
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
  assert.deepEqual(g.getState().queue, [UP]);
});
test('Snake two turns buffer across distinct input frames and reject reversal and queue overflow', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp']));
  g.update(1 / 120, input([], ['ArrowDown']));
  assert.deepEqual(g.getState().queue, [UP]);
  g.update(1 / 120, input([], ['ArrowLeft']));
  g.update(1 / 120, input([], ['ArrowDown']));
  assert.equal(g.getState().queue.length, 2);
  skipReady(g);
  while (g.getState().steps < 2) g.update(1 / 120, input());
  assert.deepEqual(g.getState().snake[0], { x: 3, y: 6 });
  assert.deepEqual(g.getState().direction, { x: -1, y: 0 });
});
test('Snake held turns do not repeat, and a swipe works without a separate click event', () => {
  const g = createGame(harness().env);
  skipReady(g);
  for (let n = 0; n < 48; n++) g.update(1 / 120, input(['ArrowUp']));
  assert.deepEqual(g.getState().snake[0], { x: 4, y: 6 });
  assert.equal(g.getState().queue.length, 0);
  const swipe = createGame(harness().env);
  skipReady(swipe);
  swipe.update(1 / 120, input([], [], { x: 230, y: 200, down: true }));
  swipe.update(1 / 120, input([], [], { x: 230, y: 170, down: true }));
  while (swipe.getState().steps < 1) swipe.update(1 / 120, input());
  assert.deepEqual(swipe.getState().direction, UP);
  const sideways = createGame(harness().env);
  sideways.update(1 / 120, input([], [], { x: 100, y: 100, down: true, clicked: true }));
  sideways.update(1 / 120, input([], [], { x: 130, y: 105, down: true }));
  sideways.update(1 / 120, input([], [], { x: 130, y: 135, down: true }));
  sideways.update(1 / 120, input());
  assert.deepEqual(sideways.getState().queue, [{ x: 0, y: 1 }]);
});
test('Snake gate phase is a move clock and occupied gates never close onto a body', () => {
  const s = field(5),
    a = s.gates[0];
  s.snake = [
    { x: 5, y: 7 },
    { x: 5, y: 8 },
    { x: 5, y: 9 },
  ];
  s.direction = UP;
  s.stageSteps = 3;
  s.food = { x: 4, y: 2 };
  stepSnake(s, UP, seeded(1));
  assert.equal(s.stageSteps, 4);
  assert.ok(isGateOpen(s, a));
  assert.deepEqual(s.snake[0], { x: 5, y: 6 });
  for (let n = 0; n < 3; n++) stepSnake(s, UP, seeded(1));
  assert.equal(s.stageSteps, 7);
  assert.equal(isGateOpen(s, a), false);
  assert.equal(isGateOpen(s, s.gates[1]), true);
  assert.equal(isGateOpen({ ...s, snake: [] }, a, 1), true, 'offset previews the next phase');
});
test('Snake a gate held by the vacating tail permits safe entry but not self-growth overlap', () => {
  for (const eating of [false, true]) {
    const s = field(5);
    s.rocks = s.rocks.filter((p) => !(p.x === 4 && p.y === 6));
    s.snake = [
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 5, y: 6 },
    ];
    s.direction = RIGHT;
    s.stageSteps = 4;
    s.food = eating ? { x: 5, y: 6 } : { x: 4, y: 2 };
    stepSnake(s, RIGHT, seeded(1));
    assert.equal(s.phase, eating ? 'lost' : 'playing');
  }
});
test('Snake underpass movement stays adjacent, counts straight crossings and blocks an occupied exit', () => {
  for (const blocked of [false, true]) {
    const s = field(6),
      body = [
        { x: 11, y: 3 },
        { x: 10, y: 3 },
      ];
    for (let y = 4; y <= 10; y++) body.push({ x: 10, y });
    body.push({ x: 11, y: 10 }, { x: 12, y: 10 });
    for (let y = 9; y >= 3; y--) body.push({ x: 12, y });
    if (blocked) body.push({ x: 13, y: 3 });
    s.snake = body;
    s.direction = RIGHT;
    s.food = { x: 18, y: 4 };
    s.crossingFrom = 'left';
    const head = { ...s.snake[0] };
    stepSnake(s, RIGHT, seeded(1));
    assert.equal(s.phase, blocked ? 'lost' : 'playing');
    if (!blocked) {
      assert.ok(adjacent(head, s.snake[0]));
      assert.equal(s.crossings, 1);
    }
  }
  const s = field(6);
  s.snake = [
    { x: 10, y: 3 },
    { x: 9, y: 3 },
    { x: 8, y: 3 },
  ];
  s.direction = RIGHT;
  s.food = { x: 18, y: 4 };
  stepSnake(s, RIGHT, seeded(1));
  assert.equal(s.crossingFrom, 'left');
  stepSnake(s, RIGHT, seeded(1));
  assert.equal(s.crossings, 1);
  assert.equal(s.crossingFrom, null);
  s.snake = [
    { x: 12, y: 3 },
    { x: 13, y: 3 },
    { x: 14, y: 3 },
  ];
  s.direction = { x: -1, y: 0 };
  stepSnake(s, { x: -1, y: 0 }, seeded(1));
  assert.equal(s.crossingFrom, 'right');
  stepSnake(s, { x: -1, y: 0 }, seeded(1));
  assert.equal(s.crossings, 2);
  s.snake = [
    { x: 11, y: 4 },
    { x: 11, y: 5 },
  ];
  stepSnake(s, { x: -1, y: 0 }, seeded(1));
  assert.equal(s.crossings, 2, 'turning back inside the pass is not a crossing');
  assert.equal(s.crossingFrom, null);
  assert.equal(s.portals, undefined);
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
    const s = field(),
      h = harness();
    s.rocks = [];
    s.food = { x: 0, y: 0 };
    let last = -1;
    const run = (frames, held) => {
      for (let n = 0; n < frames; n++) {
        const pressed = [];
        if (s.steps !== last) {
          const k = patrol(s);
          if (k) pressed.push(k);
          last = s.steps;
        }
        updateSnake(s, 1 / hz, input(held, pressed), h.env);
      }
    };
    run(hz * 8, ['Space']);
    assert.equal(s.brake, 0);
    assert.equal(s.braking, false);
    assert.equal(s.focusLocked, true);
    run(hz, []);
    assert.ok(Math.abs(s.brake - 0.12) < 1e-8);
    updateSnake(s, 1 / hz, input(['Space']), h.env);
    assert.equal(s.braking, true);
    assert.ok(s.brake < 0.12);
  }
});
test('Snake Focus changes speed without losing accrued step progress; Calm has an inspectable state', () => {
  const g = createGame(harness().env);
  skipReady(g);
  for (let n = 0; n < 12; n++) g.update(1 / 120, input());
  const progress = g.getState().progress;
  g.update(1 / 120, input(['Space']));
  assert.ok(g.getState().progress > progress);
  assert.equal(g.getState().steps, 0);
  assert.ok(g.getState().stepTime > LEVELS[0].period);
  g.update(1 / 120, input([], ['KeyC']));
  assert.equal(g.getState().calm, true);
  g.update(1 / 120, input(['KeyC']));
  assert.equal(g.getState().calm, true);
});
test('Snake exact Focus-empty event and step progress are invariant across tick boundaries', () => {
  const h = harness(),
    s = field();
  s.brake = 0.0022;
  s.braking = true;
  updateSnake(s, 0.03, input(['Space']), h.env);
  const period = LEVELS[0].period,
    expected = 0.01 / (period * 1.9) + 0.02 / period;
  assert.ok(Math.abs(s.progress - expected) < 1e-10);
  assert.equal(s.brake, 0);
  assert.equal(s.braking, false);
  assert.equal(s.focusLocked, true);
  const split = field();
  split.brake = 0.0022;
  split.braking = true;
  for (let n = 0; n < 3; n++) updateSnake(split, 0.01, input(['Space']), h.env);
  assert.ok(Math.abs(split.progress - s.progress) < 1e-10);
});
test('Snake Focus under ten percent cannot start and resource readiness is explicit', () => {
  const s = field(),
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
  assert.match(g.getState().status.zh, /舒缓速度/);
});
test('Snake fractional movement matches rates and large dt is capped rather than skipping cells', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ seed: 9 }).env);
    skipReady(g, hz);
    for (let n = 0; n < hz * 0.9; n++) g.update(1 / hz, input(['ArrowUp']));
    return g.getState();
  });
  for (const s of states) {
    assert.deepEqual(s.snake, states[0].snake);
    assert.ok(Math.abs(s.progress - states[0].progress) < 1e-8);
    assert.equal(s.steps, 3);
  }
  const a = createGame(harness().env),
    b = createGame(harness().env);
  a.update(10, input());
  b.update(1 / 30, input());
  assert.deepEqual(a.getState(), b.getState());
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
    for (let n = 0; n < hz * 14 && g.getState().phase === 'playing'; n++) g.update(1 / hz, input());
    const s = g.getState();
    assert.equal(s.phase, 'lost');
    assert.equal(s.crash.reason, 'edge');
    assert.equal(h.ends.length, 1);
    assert.deepEqual(s, callback);
    g.update(1 / hz, input(['ArrowUp', 'Space'], ['KeyC']));
    assert.deepEqual(g.getState(), s);
    const fresh = createGame(h.env).getState();
    assert.equal(fresh.eaten, 0);
    assert.equal(fresh.snake.length, 3);
    assert.equal(fresh.brake, 1);
    assert.equal(fresh.calm, false);
    assert.equal(fresh.steps, 0);
    assert.deepEqual(fresh.queue, []);
  }
});
test('Snake a tight loop after real growth causes a public-input body collision', () => {
  const h = harness(),
    s = field();
  s.snake = [8, 7, 6, 5, 4].map((x) => ({ x, y: 7 }));
  s.food = { x: 20, y: 12 };
  const turns = ['ArrowDown', 'ArrowLeft', 'ArrowUp'];
  let last = -1,
    turn = 0;
  for (let n = 0; n < 600 && s.phase === 'playing'; n++) {
    const pressed = [];
    if (s.steps !== last && turn < turns.length) {
      pressed.push(turns[turn++]);
      last = s.steps;
    }
    updateSnake(s, 1 / 60, input([], pressed), h.env);
  }
  assert.equal(s.phase, 'lost');
  assert.equal(s.crash.reason, 'body');
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /^Level 1: /);
});
test('Snake deterministic public input state remains finite and all arrays are bounded', () => {
  const games = [createGame(harness({ seed: 19 }).env), createGame(harness({ seed: 19 }).env)],
    random = seeded(4);
  let held = [];
  const finite = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v));
    else if (v && typeof v === 'object') Object.values(v).forEach(finite);
  };
  for (let n = 0; n < 2400; n++) {
    if (n % 10 === 0)
      held = [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown']][
        Math.floor(random() * 4)
      ].concat(random() < 0.4 ? ['Space'] : []);
    for (const g of games) g.update(1 / 120, input(held, n % 200 === 0 ? ['KeyC'] : []));
    if (n % 120 === 0) {
      const s = games[0].getState();
      finite(s);
      assert.ok(s.queue.length <= 2 && s.celebration.length <= 4 && s.snake.length <= 8);
      assert.deepEqual(s, games[1].getState());
      games[0].draw(mockContext());
    }
  }
});
