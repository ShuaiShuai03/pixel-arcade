import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createPaddleState, stepPaddle } from '../src/games/paddle-duel.js';
import { harness, input, mockContext } from './harness.js';
test('Paddle player movement is clamped and solo opponent tracks ball', () => {
  const { env } = harness();
  const s = createPaddleState(env);
  s.ball.y = 250;
  for (let i = 0; i < 120; i++) stepPaddle(s, 1 / 60, input(['KeyW']), env);
  assert.equal(s.left.y, 32);
  assert.ok(s.right.y > 132);
});
test('Paddle contact changes direction and applies aim', () => {
  const { env } = harness();
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 35, y: s.left.y + 12, vx: -210, vy: 0 };
  stepPaddle(s, 1 / 30, input(), env);
  assert.ok(s.ball.vx > 0);
  assert.ok(s.ball.vy < 0);
  assert.equal(s.rally, 1);
});
test('Paddle duel two-player controls do not use AI', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  const y = s.right.y;
  stepPaddle(s, 0.03, input(['ArrowDown']), env);
  assert.ok(s.right.y > y);
});
test('Paddle match has winner and cannot score after finish', () => {
  const { env, ends } = harness();
  const s = createPaddleState(env);
  s.points = [6, 2];
  s.serve = 0;
  s.ball.x = 490;
  stepPaddle(s, 1 / 60, input(), env);
  assert.equal(s.phase, 'won');
  assert.equal(ends.length, 1);
  stepPaddle(s, 1 / 60, input(), env);
  assert.equal(ends.length, 1);
  const g = createGame(env);
  g.draw(mockContext());
  assert.deepEqual(g.getState().points, [0, 0]);
});
test('Paddle solo match can be won through documented controls', () => {
  const { env } = harness({ seed: 6 });
  const g = createGame(env);
  for (let f = 0; f < 24000 && g.getState().phase === 'playing'; f++) {
    const s = g.getState();
    let target = 132;
    if (s.ball.vx < 0) {
      const time = Math.max(0, (s.ball.x - 44) / -s.ball.vx);
      let y = s.ball.y + s.ball.vy * time;
      while (y < 37 || y > 283) y = y < 37 ? 74 - y : 566 - y;
      target = Math.max(32, Math.min(232, y - 28 - Math.sign(y - 160) * 24));
    }
    const held = s.left.y < target - 1 ? ['KeyS'] : s.left.y > target + 1 ? ['KeyW'] : [];
    g.update(1 / 60, input(held, s.serve > 0 ? ['Space'] : []));
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(g.getState().points[0], 7);
});
test('Paddle reflects from both boundaries and right paddle; opponent can win', () => {
  const { env, ends } = harness();
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 240, y: 35, vx: 210, vy: -80 };
  stepPaddle(s, 0.03, input(), env);
  assert.ok(s.ball.vy > 0);
  s.ball = { x: 240, y: 285, vx: 210, vy: 80 };
  stepPaddle(s, 0.03, input(), env);
  assert.ok(s.ball.vy < 0);
  s.ball = { x: 436, y: s.right.y + 30, vx: 220, vy: 0 };
  stepPaddle(s, 0.03, input(), env);
  assert.ok(s.ball.vx < 0);
  s.points = [1, 6];
  s.ball.x = -10;
  stepPaddle(s, 0.03, input(), env);
  assert.equal(s.phase, 'lost');
  assert.equal(ends[0].won, false);
});
test('Paddle pointer moves the appropriate paddle and a point starts a new serve', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  stepPaddle(s, 0.02, input([], [], { x: 80, y: 250, down: true }), env);
  assert.equal(s.left.y, 222);
  stepPaddle(s, 0.02, input([], [], { x: 440, y: 70, down: true }), env);
  assert.equal(s.right.y, 42);
  s.serve = 0;
  s.ball.x = 490;
  stepPaddle(s, 0.02, input(), env);
  assert.equal(s.points[0], 1);
  assert.ok(s.serve > 0);
  assert.equal(s.ball.x, 240);
});
