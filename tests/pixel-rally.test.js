import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createRallyState, stepRally } from '../src/games/pixel-rally.js';
import { harness, input, mockContext } from './harness.js';
test('Rally accelerates, steers, brakes and bounds the car', () => {
  const { env } = harness();
  const s = createRallyState(env);
  for (let i = 0; i < 60; i++) stepRally(s, 1 / 60, input(['ArrowUp']), env);
  assert.ok(s.speed > 170);
  const speed = s.speed;
  for (let i = 0; i < 60; i++) stepRally(s, 1 / 60, input(['ArrowDown']), env);
  assert.ok(s.speed < speed);
  for (let i = 0; i < 120; i++) stepRally(s, 1 / 60, input(['ArrowRight']), env);
  assert.ok(s.carX <= 195 && s.carX > 50);
});
test('Rally collisions cost health only once during protection', () => {
  const { env } = harness();
  const s = createRallyState(env);
  s.traffic = [{ z: 0, lane: 0, speed: 30, color: 0 }];
  s.carX = 0;
  stepRally(s, 1 / 60, input(), env);
  assert.equal(s.health, 3);
  s.traffic = [{ z: 0, lane: 0, speed: 30, color: 0 }];
  stepRally(s, 1 / 60, input(), env);
  assert.equal(s.health, 3);
});
test('Rally finish and timer loss end exactly once', () => {
  for (const win of [true, false]) {
    const { env, ends } = harness();
    const s = createRallyState(env);
    if (win) s.distance = s.target - 1;
    else s.time = 0.001;
    stepRally(s, 1 / 30, input(), env);
    stepRally(s, 1 / 30, input(), env);
    assert.equal(s.phase, win ? 'won' : 'lost');
    assert.equal(ends.length, 1);
  }
});
test('Rally collect coins and fresh game resets', () => {
  const { env } = harness();
  const s = createRallyState(env);
  s.coins = [{ z: 0, lane: 0 }];
  stepRally(s, 1 / 60, input(), env);
  assert.equal(s.collected, 1);
  assert.ok(s.score >= 100);
  assert.equal(createRallyState(env).collected, 0);
  const g = createGame(env);
  g.draw(mockContext());
  assert.equal(g.getState().phase, 'playing');
});
test('Rally completes all three regions using legal steering controls', () => {
  for (const seed of [1, 3, 19]) {
    const { env, ends } = harness({ seed });
    const g = createGame(env);
    for (let frame = 0; frame < 6000 && g.getState().phase === 'playing'; frame++) {
      const s = g.getState();
      const curve = Math.sin(s.distance / 310) * 36 + Math.sin(s.distance / 740) * 20;
      const lanes = [-65, 0, 65]
        .map((lane) => ({
          lane,
          risk:
            s.traffic.filter((c) => Math.abs(c.lane - lane) < 30 && c.z > -20 && c.z < 240).length *
              1000 +
            Math.abs(s.carX - curve - lane),
        }))
        .sort((a, b) => a.risk - b.risk);
      const target = curve + lanes[0].lane;
      const keys = ['ArrowUp'];
      if (s.carX < target - 3) keys.push('ArrowRight');
      if (s.carX > target + 3) keys.push('ArrowLeft');
      g.update(1 / 60, input(keys));
    }
    assert.equal(g.getState().phase, 'won', `seed ${seed}`);
    assert.equal(ends.length, 1);
    assert.ok(g.getState().time > 0);
  }
});

test('Rally cannot finish by driving through the grass for the entire race', () => {
  for (const seed of [1, 2, 5]) {
    const { env, ends } = harness({ seed });
    const game = createGame(env);
    for (let frame = 0; frame < 5500 && game.getState().phase === 'playing'; frame++) {
      game.update(1 / 60, input(['ArrowRight', 'ArrowUp']));
    }
    assert.equal(game.getState().phase, 'lost');
    assert.equal(game.getState().time, 0);
    assert.ok(game.getState().distance < game.getState().target);
    assert.equal(ends.length, 1);
  }
});

test('Rally braking throughout the race reaches the real time limit', () => {
  const { env, ends } = harness();
  const game = createGame(env);
  for (let frame = 0; frame < 5500 && game.getState().phase === 'playing'; frame++) {
    game.update(1 / 60, input(['ArrowDown']));
  }
  assert.equal(game.getState().phase, 'lost');
  assert.equal(game.getState().time, 0);
  assert.equal(game.getState().health, 4);
  assert.equal(ends.length, 1);
});
