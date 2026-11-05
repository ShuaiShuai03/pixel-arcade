import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createPinballState,
  stepPinball,
  contactImpulse,
} from '../src/games/pinball-pocket.js';
import { harness, input, mockContext, seeded } from './harness.js';
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
  assert.ok(g.getState().plungerWork > 0);
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

test('Pinball active flipper cannot hit ball above its actual surface', () => {
  const { env } = harness();
  const s = createPinballState(env);
  s.ready = false;
  s.ball = { x: 155, y: 228, vx: 0, vy: 100 };
  stepPinball(s, 1 / 240, input(['ArrowLeft']), env);
  assert.ok(s.ball.vy > 0, 'invisible rectangular flipper collider must not launch ball');
});
test('Pinball provides gradual flipper rotation and multiplier progression', () => {
  const { env } = harness();
  const s = createPinballState(env);
  stepPinball(s, 1 / 240, input(['ArrowLeft']), env);
  assert.ok(s.flippers[0].angle > -0.3 && s.flippers[0].angle < 0.32);
  assert.equal(s.multiplier, 1);
});

test('Pinball free flight matches gravity analytically and across tick rates', () => {
  const results = [60, 120].map((hz) => {
    const { env } = harness();
    const s = createPinballState();
    s.ready = false;
    s.ball = { x: 280, y: 200, vx: 0, vy: 0 };
    for (let n = 0; n < hz / 10; n++) stepPinball(s, 1 / hz, input(), env);
    return s.ball;
  });
  for (const b of results) {
    assert.ok(Math.abs(b.vy - 23) < 1e-8);
    assert.ok(Math.abs(b.y - 201.15) < 0.06);
  }
  assert.ok(Math.abs(results[0].y - results[1].y) < 0.01);
});
test('Pinball real drop-target contacts advance multiplier; ramp requires upward speed', () => {
  const { env } = harness();
  const s = createPinballState();
  s.ready = false;
  for (const x of [210, 240, 270]) {
    s.ball = { x, y: 42, vx: 0, vy: -100 };
    stepPinball(s, 1 / 120, input(), env);
  }
  assert.equal(s.multiplier, 2);
  assert.deepEqual(s.targets, [false, false, false]);
  s.ball = { x: 388, y: 118.5, vx: 0, vy: -180 };
  stepPinball(s, 1 / 120, input(), env);
  assert.equal(s.ramps, 1);
  assert.equal(s.rampCool, 1.3);
});

test('Pinball ramp is a physical sensor, never a position warp', () => {
  const { env } = harness();
  const s = createPinballState();
  s.ready = false;
  s.ball = { x: 388, y: 118.5, vx: 0, vy: -180 };
  stepPinball(s, 1 / 120, input(), env);
  assert.ok(Math.abs(s.ball.x - 388) < 1);
  assert.ok(s.ball.y > 116 && s.ball.y < 118.5);
});
test('Pinball passive bumper conserves tangential momentum and dissipates normal energy', () => {
  const { env } = harness();
  const s = createPinballState();
  s.ready = false;
  s.bumpers[0].cool = 1;
  s.ball = { x: 169, y: 68, vx: 50, vy: 120 };
  stepPinball(s, 1 / 60, input(), env);
  assert.ok(Math.abs(s.ball.vx - 50) < 25);
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) <= Math.hypot(50, 124));
});

test('Pinball collision impulse obeys relative restitution and preserves tangent', () => {
  const b = { vx: 70, vy: 160 };
  const nx = 0.6,
    ny = -0.8,
    svx = -40,
    svy = -80;
  const beforeNormal = (b.vx - svx) * nx + (b.vy - svy) * ny;
  const beforeTangent = (b.vx - svx) * -ny + (b.vy - svy) * nx;
  const kinetic = 0.5 * (b.vx * b.vx + b.vy * b.vy);
  const work = contactImpulse(b, nx, ny, svx, svy, 0.65);
  assert.ok(Math.abs((b.vx - svx) * nx + (b.vy - svy) * ny + 0.65 * beforeNormal) < 1e-9);
  assert.ok(Math.abs((b.vx - svx) * -ny + (b.vy - svy) * nx - beforeTangent) < 1e-9);
  assert.ok(Math.abs(work - (0.5 * (b.vx * b.vx + b.vy * b.vy) - kinetic)) < 1e-9);
});
test('Pinball passive reflection cannot add kinetic energy and separating contacts do nothing', () => {
  for (const restitution of [0, 0.3, 0.83, 1]) {
    const b = { vx: 80, vy: -140 };
    const before = 0.5 * (b.vx * b.vx + b.vy * b.vy);
    contactImpulse(b, 0, 1, 0, 0, restitution);
    assert.ok(0.5 * (b.vx * b.vx + b.vy * b.vy) <= before + 1e-8);
    assert.equal(b.vx, 80);
    const after = { ...b };
    contactImpulse(b, 0, 1);
    assert.deepEqual(b, after);
  }
});
test('Pinball fast ball cannot tunnel across a bumper or rail', () => {
  const { env } = harness();
  const s = createPinballState();
  s.ready = false;
  s.bumpers[0].cool = 1;
  s.ball = { x: 140, y: 92, vx: 2400, vy: 0 };
  stepPinball(s, 1 / 60, input(), env);
  assert.ok(s.ball.vx < 0);
  assert.ok(s.ball.x < 146);
  const rail = createPinballState();
  rail.ready = false;
  rail.ball = { x: 98, y: 267, vx: 0, vy: -2000 };
  stepPinball(rail, 1 / 60, input(), env);
  assert.ok(rail.ball.vx < 0, 'diagonal rail imparts a normal impulse');
  assert.ok(Math.hypot(rail.ball.vx, rail.ball.vy) <= 2000);
});
test('Pinball three legal launches and discrete flipper presses reach objectives at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120]) {
    const { env, ends } = harness();
    const g = createGame(env);
    let launches = 0;
    const controlRandom = seeded(28);
    let held = [];
    for (let frame = 0; frame < hz * 300 && g.getState().phase === 'playing'; frame++) {
      const s = g.getState();
      if (s.ready) launches++;
      // Deterministic button presses at human reaction intervals; no game-state edits.
      if (frame % (hz / 10) === 0)
        held = [
          ...(controlRandom() < 0.5 ? ['ArrowLeft'] : []),
          ...(controlRandom() < 0.5 ? ['ArrowRight'] : []),
        ];
      g.update(1 / hz, input(held, s.ready ? ['Space'] : []));
      const next = g.getState();
      assert.ok(Number.isFinite(next.ball.x) && Number.isFinite(next.ball.y));
      assert.ok(Math.hypot(next.ball.vx, next.ball.vy) < 2200);
    }
    const s = g.getState();
    assert.equal(s.phase, 'lost', `rate ${hz}`);
    assert.equal(launches, 3);
    assert.equal(ends.length, 1);
    assert.ok(s.bumperHits > 0);
    assert.ok(s.motorWork > 0);
    assert.ok(s.plungerWork > 0);
    assert.ok(s.targetHits + s.rolloverHits + s.ramps > 0, `secondary objectives at ${hz}Hz`);
    if (hz === 120) {
      assert.ok(s.targetHits > 0);
      assert.ok(s.ramps > 0);
    }
    const frozen = g.getState();
    g.update(1 / hz, input(['ArrowLeft'], ['Space']));
    assert.deepEqual(g.getState(), frozen);
  }
});

test('Pinball raised target stays solid during scoring cooldown', () => {
  const { env } = harness();
  const s = createPinballState();
  s.ready = false;
  s.targetCool[0] = 0.2;
  s.ball = { x: 210, y: 48, vx: 0, vy: -200 };
  stepPinball(s, 1 / 60, input(), env);
  assert.ok(s.ball.vy > 0);
  assert.ok(s.ball.y >= 47);
  assert.equal(s.targetHits, 0);
});

test('Pinball both flipper motors respond during legal launch-lane travel', () => {
  const { env } = harness();
  const game = createGame(env);
  const before = game.getState();
  game.update(1 / 120, input(['ArrowLeft', 'ArrowRight'], ['Space']));
  for (let frame = 0; frame < 24; frame++) game.update(1 / 120, input(['ArrowLeft', 'ArrowRight']));
  const raised = game.getState();
  assert.equal(raised.launchLane, true);
  assert.ok(raised.flippers[0].angle < before.flippers[0].angle - 0.3);
  assert.ok(raised.flippers[1].angle > before.flippers[1].angle + 0.3);
  for (let frame = 0; frame < 24; frame++) game.update(1 / 120, input());
  const released = game.getState();
  assert.equal(released.launchLane, true);
  assert.ok(released.flippers[0].angle > raised.flippers[0].angle + 0.3);
  assert.ok(released.flippers[1].angle < raised.flippers[1].angle - 0.3);
});
