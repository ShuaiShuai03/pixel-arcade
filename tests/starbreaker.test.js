import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createBreakerState,
  stepBreaker,
  makeBricks,
  circleRect,
} from '../src/games/starbreaker.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('breaker brick layouts have increasing durability', () => {
  assert.equal(makeBricks(1).length, 32);
  assert(makeBricks(3).reduce((s, b) => s + b.hp, 0) > 32);
  assert(circleRect({ x: 10, y: 10, r: 4 }, { x: 12, y: 8, w: 10, h: 10 }));
  assert(!circleRect({ x: 0, y: 0, r: 4 }, { x: 12, y: 8, w: 10, h: 10 }));
});
test('breaker launches, steers paddle and bounces walls', () => {
  const s = createBreakerState();
  stepBreaker(s, 1 / 30, input(['ArrowRight'], ['Space']), seeded(1));
  assert(!s.docked);
  assert(s.paddle.x > 240);
  s.ball = { x: 10, y: 180, vx: -180, vy: -120, r: 4 };
  stepBreaker(s, 0.03, input(), seeded(1));
  assert(s.ball.vx > 0);
});
test('breaker destroys brick, reflects and scores', () => {
  const s = createBreakerState();
  s.docked = false;
  s.bricks = [{ x: 220, y: 100, w: 42, h: 12, hp: 1, color: 0 }];
  s.ball = { x: 240, y: 119, vx: 0, vy: -180, r: 4 };
  stepBreaker(s, 0.03, input(), seeded(1));
  assert(s.score > 0);
  assert.equal(s.level, 2);
  assert(s.docked);
});
test('breaker paddle saves ball and misses cost lives ending once', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 240, y: 277, vx: 0, vy: 180, r: 4 };
  stepBreaker(s, 0.03, input(), seeded(1));
  assert(s.ball.vy < 0);
  for (let i = 0; i < 3; i++) {
    s.docked = false;
    s.ball = { x: 12, y: 325, vx: 0, vy: 180, r: 4 };
    stepBreaker(s, 0.03, input(), seeded(1));
  }
  assert.equal(s.phase, 'lost');
});
test('breaker last stage clears into victory, collects powerups', () => {
  const s = createBreakerState();
  s.level = 3;
  s.docked = false;
  s.bricks = [];
  stepBreaker(s, 0.01, input(), seeded(1));
  assert.equal(s.phase, 'won');
  const q = createBreakerState();
  q.powerups = [{ x: 240, y: 286, type: 'wide' }];
  stepBreaker(q, 0.01, input(), seeded(1));
  assert(q.paddle.w > 80);
});
test('breaker game supports pointer, draw and prolonged input', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    for (let n = 0; n < 16000 && g.getState().phase === 'playing'; n++) {
      const st = g.getState();
      g.update(
        1 / 30,
        input([], n % 180 === 0 ? ['Space'] : [], {
          x: st.ball.x,
          y: 280,
          down: true,
          clicked: n === 0,
        }),
      );
      if (n % 100 === 0) g.draw(mockContext());
    }
    assert(Number.isFinite(g.getState().score));
    g.draw(mockContext());
  }
});
test('breaker side, ceiling, armoured hits and upgrade variants are stable', () => {
  const r = seeded(41),
    s = createBreakerState();
  s.docked = false;
  s.bricks = [
    { x: 220, y: 100, w: 42, h: 14, hp: 2, color: 1 },
    { x: 300, y: 100, w: 42, h: 14, hp: 1, color: 0 },
  ];
  s.ball = { x: 216, y: 107, vx: 100, vy: 0, r: 4 };
  stepBreaker(s, 0.01, input(), r);
  assert(s.ball.vx < 0);
  assert.equal(s.bricks[0].hp, 1);
  s.ball = { x: 469, y: 50, vx: 100, vy: -100, r: 4 };
  stepBreaker(s, 0.03, input(), r);
  assert(s.ball.vx < 0);
  s.ball = { x: 50, y: 35, vx: 100, vy: -100, r: 4 };
  stepBreaker(s, 0.01, input(), r);
  assert(s.ball.vy > 0);
  s.ball = { x: 240, y: 180, vx: 160, vy: 160, r: 4 };
  s.powerups = [
    { x: s.paddle.x, y: 286, type: 'slow' },
    { x: s.paddle.x, y: 286, type: 'life' },
  ];
  const lives = s.lives;
  stepBreaker(s, 0.01, input(), r);
  assert.equal(s.lives, lives + 1);
  assert.equal(s.ball.vx, 160);
  s.wide = 0.005;
  stepBreaker(s, 0.01, input(), r);
  assert.equal(s.paddle.w, 80);
  s.powerups = [{ x: 0, y: 331, type: 'wide' }];
  stepBreaker(s, 0.01, input(), r);
  assert.equal(s.powerups.length, 0);
});
test('breaker spawns a falling upgrade every sixth destroyed brick', () => {
  const s = createBreakerState();
  s.docked = false;
  s.destroyed = 5;
  s.bricks = [
    { x: 220, y: 100, w: 42, h: 14, hp: 1, color: 0 },
    { x: 300, y: 100, w: 42, h: 14, hp: 1, color: 0 },
  ];
  s.ball = { x: 240, y: 119, vx: 0, vy: -180, r: 4 };
  stepBreaker(s, 0.03, input(), () => 0.9);
  assert.equal(s.powerups.length, 1);
  assert.equal(s.powerups[0].type, 'life');
});

test('legal pointer play clears all three brick fields on two seeds', () => {
  for (const seed of [1, 2]) {
    const h = harness({ seed }),
      g = createGame(h.env);
    let frames = 0;
    while (g.getState().phase === 'playing' && frames++ < 65000) {
      const s = g.getState(),
        b = s.ball;
      let target = b.x;
      if (b.vy > 0) {
        let landing = b.x + ((290 - b.y) / b.vy) * b.vx;
        while (landing < 12 || landing > 468) {
          if (landing < 12) landing = 24 - landing;
          if (landing > 468) landing = 936 - landing;
        }
        const brick = s.bricks[Math.floor(s.time / 10) % s.bricks.length];
        const speed = Math.hypot(b.vx, b.vy),
          dx = brick.x + brick.w / 2 - landing,
          dy = brick.y - 290;
        const length = Math.hypot(dx, dy),
          outX = (dx / length) * speed,
          outY = (dy / length) * speed;
        const slope = (outX - b.vx) / (b.vy - outY);
        const offset = Math.max(-0.86, Math.min(0.86, (slope * s.paddle.w) / 32));
        target = landing - (offset * s.paddle.w) / 2;
      }
      g.update(1 / 60, input([], s.docked ? ['Space'] : [], { x: target, y: 286, down: true }));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(g.getState().level, 3);
    assert.equal(h.ends.length, 1);
    assert(h.ends[0].won);
    const terminal = g.getState();
    for (let i = 0; i < 30; i++) g.update(1 / 60, input());
    assert.deepEqual(g.getState(), terminal);
    assert.equal(h.ends.length, 1);
  }
});

test('breaker fields have different geometry, reactor bricks and drifting final rows', () => {
  const a = makeBricks(1),
    b = makeBricks(2),
    c = makeBricks(3);
  assert.notDeepEqual(
    a.map((x) => [x.x, x.y]),
    b.map((x) => [x.x, x.y]),
  );
  assert(b.some((x) => x.kind === 'reactor'));
  assert(c.some((x) => x.drift));
});
test('breaker centred passive contact adds no sideways momentum and damping survives the bounce', () => {
  const s = createBreakerState();
  s.docked = false;
  s.slow = 5;
  s.ball = { x: 240, y: 279, vx: 0, vy: 180, r: 4 };
  stepBreaker(s, 0.03, input(), seeded(1));
  assert.equal(s.ball.vx, 0);
  assert(Math.hypot(s.ball.vx, s.ball.vy) < 220);
});

test('breaker emergency catch has finite charges and reactor destruction damages neighbours', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 240, y: 277, vx: 15, vy: 180, r: 4 };
  stepBreaker(s, 0.01, input([], ['ArrowDown']), seeded(1));
  for (let i = 0; i < 10 && !s.docked; i++) stepBreaker(s, 0.01, input(), seeded(1));
  assert(s.docked);
  assert.equal(s.catches, 2);
  const q = createBreakerState();
  q.level = 2;
  q.docked = false;
  q.bricks = [
    { x: 220, y: 100, w: 40, h: 14, hp: 1, color: 0, kind: 'reactor' },
    { x: 267, y: 100, w: 40, h: 14, hp: 2, color: 1 },
    { x: 350, y: 100, w: 40, h: 14, hp: 1, color: 2 },
  ];
  q.ball = { x: 240, y: 120, vx: 0, vy: -180, r: 4 };
  stepBreaker(q, 0.03, input(), seeded(1));
  assert.equal(q.bricks.find((b) => b.x === 267).hp, 1);
  assert.equal(q.destroyed, 1);
});
test('breaker paddle and ball displacement agree at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const s = createBreakerState();
    for (let i = 0; i < hz; i++) stepBreaker(s, 1 / hz, input(['ArrowLeft']), seeded(1));
    return s;
  });
  assert(states.every((s) => s.paddle.x === 48 && s.ball.x === 48));
  for (const hz of [30, 60, 120]) {
    const s = createBreakerState();
    s.docked = false;
    s.ball = { x: 100, y: 210, vx: 80, vy: -30, r: 4 };
    for (let i = 0; i < hz * 0.5; i++) stepBreaker(s, 1 / hz, input(), seeded(1));
    assert(Math.abs(s.ball.x - 140) < 1e-8);
    assert(Math.abs(s.ball.y - 195) < 1e-8);
  }
});

test('breaker stationary wall and paddle contacts preserve tangential momentum without invented speed', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 240, y: 281, vx: 0, vy: 150, r: 4 };
  stepBreaker(s, 1 / 120, input(), seeded(1));
  assert.equal(s.ball.vx, 0);
  assert.equal(s.ball.vy, -150);
  const q = createBreakerState();
  q.docked = false;
  q.ball = { x: 12, y: 190, vx: -73, vy: -41, r: 4 };
  stepBreaker(q, 1 / 120, input(), seeded(1));
  assert.equal(q.ball.vx, 73);
  assert.equal(q.ball.vy, -41);
});
test('breaker drag expires without adding energy and pointer has finite paddle speed', () => {
  const s = createBreakerState();
  s.docked = false;
  s.slow = 0.001;
  s.ball = { x: 240, y: 200, vx: 70, vy: -80, r: 4 };
  stepBreaker(s, 0.01, input([], [], { x: 460, y: 280, down: true }), seeded(1));
  assert.equal(s.ball.vx, 70);
  assert.equal(s.ball.vy, -80);
  assert(s.paddle.x <= 243.1 + 1e-9);
});

test('breaker curved passive paddle conserves speed and reflects away from its actual surface', () => {
  for (const offset of [-25, 0, 25]) {
    const s = createBreakerState();
    s.docked = false;
    s.ball = { x: 240 + offset, y: 281, vx: 0, vy: 200, r: 4 };
    for (let i = 0; i < 15 && s.ball.vy > 0; i++) stepBreaker(s, 1 / 240, input(), seeded(1));
    assert(s.ball.vy < 0);
    assert(Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - 200) < 1e-8);
    if (offset) assert.equal(Math.sign(s.ball.vx), Math.sign(offset));
  }
});
test('breaker motor work is accounted for in the moving paddle reference frame', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 260, y: 283, vx: 0, vy: 200, r: 4 };
  const initial = { ...s.ball };
  stepBreaker(s, 1 / 240, input(['ArrowRight']), seeded(1));
  assert(s.ball.vy < 0);
  assert(Math.abs(s.paddle.vx - 310) < 1e-8);
  const before = (initial.vx - s.paddle.vx) ** 2 + initial.vy ** 2;
  const after = (s.ball.vx - s.paddle.vx) ** 2 + s.ball.vy ** 2;
  assert(Math.abs(before - after) < 1e-6);
});
test('breaker swept stepping catches fast projectiles once and moving bricks transfer their normal velocity', () => {
  const s = createBreakerState();
  s.docked = false;
  s.bricks = [
    { x: 220, y: 100, w: 42, h: 14, hp: 3, color: 0 },
    { x: 350, y: 50, w: 40, h: 12, hp: 1, color: 0 },
  ];
  s.ball = { x: 240, y: 150, vx: 0, vy: -3000, r: 4 };
  stepBreaker(s, 1 / 30, input(), seeded(1));
  assert.equal(s.bricks[0].hp, 2);
  assert(s.ball.vy > 0);
  assert.equal(s.ball.vy, 3000);
  const q = createBreakerState();
  q.level = 3;
  q.time = 0;
  q.docked = false;
  q.bricks = [{ x: 220, baseX: 220, y: 100, w: 42, h: 14, hp: 3, color: 0, drift: 1 }];
  q.ball = { x: 216, y: 107, vx: 100, vy: 0, r: 4 };
  stepBreaker(q, 1 / 240, input(), seeded(1));
  assert(Math.abs(q.ball.vx - (2 * q.bricks[0].vx - 100)) < 1e-8);
});

test('breaker contact results match at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const s = createBreakerState();
    s.docked = false;
    s.ball = { x: 256, y: 220, vx: 8, vy: 200, r: 4 };
    for (let i = 0; i < hz * 0.5; i++) stepBreaker(s, 1 / hz, input(), seeded(1));
    return s.ball;
  });
  for (const field of ['x', 'y', 'vx', 'vy'])
    assert(Math.abs(states[0][field] - states[2][field]) < 1e-7);
});
test('breaker contacts the visible paddle endcap and a fresh game resets all motor state', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 196, y: 298, vx: 100, vy: 0, r: 4 };
  stepBreaker(s, 1 / 120, input(), seeded(1));
  assert(s.ball.vx < 0);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.paddle.vx, 0);
  assert.equal(fresh.catches, 3);
  assert(fresh.docked);
});

test('breaker wide actuator cannot teleport the paddle or invent unbounded motor work', () => {
  const s = createBreakerState();
  s.docked = false;
  s.paddle.x = 48;
  s.ball = { x: 100, y: 283.5, vx: 0, vy: 200, r: 4 };
  s.powerups = [{ x: 48, y: 286, type: 'wide' }];
  for (let i = 0; i < 3; i++) {
    const x = s.paddle.x;
    stepBreaker(s, 1 / 240, input(), seeded(1));
    assert(Math.abs(s.paddle.x - x) <= 310 / 240 + 1e-9);
    assert(Math.abs(s.paddle.vx) <= 310 + 1e-8);
    assert(s.paddle.w <= 81 + 1e-8);
  }
  assert(Math.hypot(s.ball.vx, s.ball.vy) < 300);
});
test('breaker emergency catch preserves the contact position as the gripper moves', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 259, y: 283, vx: 0, vy: 200, r: 4 };
  stepBreaker(s, 1 / 240, input([], ['ArrowDown']), seeded(1));
  assert(s.docked);
  const caught = { x: s.ball.x, y: s.ball.y },
    paddleX = s.paddle.x;
  stepBreaker(s, 1 / 240, input(['ArrowRight']), seeded(1));
  assert(Math.abs(s.ball.x - caught.x - (s.paddle.x - paddleX)) < 1e-8);
  assert.equal(s.ball.y, caught.y);
});

test('breaker ball respects the visible ceiling inner edge', () => {
  const s = createBreakerState();
  s.docked = false;
  s.ball = { x: 100, y: 36, vx: 0, vy: -120, r: 4 };
  stepBreaker(s, 1 / 120, input(), seeded(1));
  assert(s.ball.y >= 36);
  assert.equal(s.ball.vy, 120);
});

test('breaker gripper retains its ball inside the walls while the paddle retracts', () => {
  const s = createBreakerState();
  s.paddle = { x: 412, w: 120, vx: 0 };
  s.wide = 0.1;
  s.dockOffset = 55;
  s.dockY = 289;
  s.ball.x = 467;
  for (let i = 0; i < 360; i++) {
    stepBreaker(s, 1 / 120, input(['ArrowRight']), seeded(1));
    assert(s.ball.x + s.ball.r <= 472 + 1e-8);
    assert(s.ball.x - s.ball.r >= 8 - 1e-8);
  }
  assert.equal(s.paddle.w, 80);
  assert.equal(s.ball.x, 468);
});
