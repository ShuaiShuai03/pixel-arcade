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
  assert.equal(s.ball.vx, 128);
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
    while (g.getState().phase === 'playing' && frames++ < 40000) {
      const s = g.getState(),
        b = s.ball;
      let target = b.x;
      if (b.vy > 0) {
        let landing = b.x + ((282 - b.y) / b.vy) * b.vx;
        while (landing < 12 || landing > 468) {
          if (landing < 12) landing = 24 - landing;
          if (landing > 468) landing = 936 - landing;
        }
        const brick = s.bricks[Math.floor(s.time / 10) % s.bricks.length];
        const slope = (brick.x + 21 - landing) / (282 - brick.y);
        const ratio = Math.max(-0.9, Math.min(0.9, slope / Math.sqrt(1 + slope * slope) / 0.85));
        target = landing - (ratio * s.paddle.w) / 2;
      }
      g.update(1 / 60, input([], s.docked ? ['Space'] : [], { x: target, y: 286, down: true }));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(g.getState().level, 3);
    assert.equal(h.ends.length, 1);
    assert(h.ends[0].won);
  }
});
