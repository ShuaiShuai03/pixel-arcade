import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createPinballState, stepPinball } from '../src/games/pinball-pocket.js';
import { harness, input, mockContext } from './harness.js';
test('Pinball launches and obeys gravity', () => {
  const { env } = harness();
  const s = createPinballState(env);
  assert.equal(s.ready, true);
  stepPinball(s, 1 / 60, input([], ['Space']), env);
  assert.equal(s.ready, false);
  assert.ok(s.ball.vy < 0);
});
test('Pinball bumper collision reflects and scores once with cooldown', () => {
  const { env } = harness();
  const s = createPinballState(env);
  s.ready = false;
  s.ball = { x: 171, y: 65, vx: 0, vy: 120 };
  stepPinball(s, 1 / 30, input(), env);
  assert.ok(s.score >= 100);
  assert.ok(s.ball.vy < 0);
});
test('Pinball flippers return falling balls upward', () => {
  const { env } = harness();
  const s = createPinballState(env);
  s.ready = false;
  s.ball = { x: 199, y: 246, vx: 0, vy: 180 };
  stepPinball(s, 1 / 30, input(['ArrowLeft']), env);
  assert.ok(s.ball.vy < 0);
});
test('Pinball drains three balls then freezes terminal state', () => {
  const { env, ends } = harness();
  const s = createPinballState(env);
  for (let i = 0; i < 3; i++) {
    s.ready = false;
    s.ball.y = 340;
    stepPinball(s, 1 / 60, input(), env);
  }
  assert.equal(s.phase, 'lost');
  assert.equal(s.balls, 0);
  assert.equal(ends.length, 1);
  stepPinball(s, 1 / 60, input(), env);
  assert.equal(ends.length, 1);
  const g = createGame(env);
  g.draw(mockContext());
  assert.equal(g.getState().balls, 3);
});
test('Pinball three real launches eventually drain without input and retain finite physics', () => {
  const { env, ends } = harness();
  const g = createGame(env);
  let launches = 0;
  for (let f = 0; f < 36000 && g.getState().phase === 'playing'; f++) {
    const s = g.getState();
    if (s.ready) launches++;
    g.update(1 / 60, input([], s.ready ? ['Space'] : []));
    const next = g.getState();
    assert.ok(Number.isFinite(next.ball.x) && Number.isFinite(next.ball.y));
    assert.ok(Math.hypot(next.ball.vx, next.ball.vy) < 500);
    if (f % 700 === 0) g.draw(mockContext());
  }
  assert.equal(launches, 3);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(ends.length, 1);
  assert.ok(g.getState().score >= 300);
});
test('Pinball both active flippers sustain realistic finite play', () => {
  const { env } = harness({ lang: 'zh' });
  const g = createGame(env);
  let best = 0;
  for (let f = 0; f < 5000 && g.getState().phase === 'playing'; f++) {
    const s = g.getState();
    g.update(1 / 60, input(['ArrowLeft', 'ArrowRight'], s.ready ? ['Enter'] : []));
    const n = g.getState();
    best = Math.max(best, n.score);
    assert.ok(n.ball.x >= 45 && n.ball.x <= 435);
    if (f % 120 === 0) g.draw(mockContext());
  }
  assert.ok(best > 0);
});
test('Pinball lighting all bumpers awards a bonus and resets their lights', () => {
  const { env } = harness();
  const s = createPinballState(env);
  s.ready = false;
  for (const target of s.bumpers) {
    s.ball = { x: target.x, y: target.y - 22, vx: 0, vy: 100 };
    stepPinball(s, 0.02, input(), env);
  }
  assert.ok(s.score >= 800);
  assert.ok(s.bonus > 0);
  assert.ok(s.bumpers.every((b) => !b.lit));
});
test('Pinball rollover pair earns bonus, pointer launches and controls flippers', () => {
  const { env } = harness();
  const s = createPinballState(env);
  stepPinball(s, 0.01, input([], [], { x: 100, y: 250, down: true, clicked: true }), env);
  assert.equal(s.ready, false);
  assert.equal(s.left, true);
  s.launchLane = false;
  for (const x of [115, 365]) {
    s.ball = { x, y: 54, vx: 0, vy: 0 };
    stepPinball(s, 0.01, input(), env);
  }
  assert.ok(s.score >= 800);
  assert.deepEqual(s.rollovers, [false, false]);
});
