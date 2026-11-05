import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createPaddleState,
  stepPaddle,
  paddleOutline,
  paddleContact,
} from '../src/games/paddle-duel.js';
import { harness, input, mockContext, seeded } from './harness.js';
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
function returnControls(s, side = 0) {
  const p = side ? s.right : s.left,
    b = s.ball;
  let target = 132;
  if (side ? b.vx > 0 : b.vx < 0) {
    const time = Math.max(0, ((side ? 431 : 49) - b.x) / b.vx);
    let y = b.y + b.vy * time;
    y = 37 + ((((y - 37) % 492) + 492) % 492);
    if (y > 283) y = 566 - y;
    target = Math.max(32, Math.min(232, y - 28 + Math.sign(y - 160) * 15));
  }
  const stop = p.y + (p.vy * Math.abs(p.vy)) / (2 * 2200);
  return stop < target - 1
    ? [side ? 'ArrowDown' : 'KeyS']
    : stop > target + 1
      ? [side ? 'ArrowUp' : 'KeyW']
      : [];
}
test('Paddle solo match can be won through documented controls at 30/60/120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const { env, ends } = harness({ seed: 6 });
    const game = createGame(env);
    for (let f = 0; f < hz * 300 && game.getState().phase === 'playing'; f++) {
      const s = game.getState();
      game.update(1 / hz, input(returnControls(s), s.serve > 0 ? ['Space'] : []));
    }
    const s = game.getState();
    assert.equal(s.phase, 'won', `rate ${hz}`);
    assert.ok(s.points[0] >= 7);
    assert.equal(ends.length, 1);
    assert.ok(s.totalHits > 0);
    assert.ok(s.aiTier > 1);
  }
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
  assert.ok(Math.abs(s.left.y - (132 + (1500 * 0.02 ** 2) / 2)) < 1e-8);
  stepPaddle(s, 0.02, input([], [], { x: 440, y: 70, down: true }), env);
  assert.ok(Math.abs(s.right.y - (132 - (1500 * 0.02 ** 2) / 2)) < 1e-8);
  s.serve = 0;
  s.ball.x = 490;
  stepPaddle(s, 0.02, input(), env);
  assert.equal(s.points[0], 1);
  assert.ok(s.serve > 0);
  assert.equal(s.ball.x, 240);
});

test('Paddle swept collision cannot tunnel through paddle at high speed', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 70, y: 155, vx: -1800, vy: 0 };
  stepPaddle(s, 1 / 30, input(), env);
  assert.ok(s.ball.vx > 0);
  assert.equal(s.rally, 1);
});
test('Paddle moving contact imparts spin and touch respects movement speed', () => {
  const { env } = harness({ mode: 2 });
  const still = createPaddleState(env),
    moving = createPaddleState(env);
  for (const s of [still, moving]) {
    s.serve = 0;
    s.ball = { x: 48, y: 160, vx: -240, vy: 0 };
  }
  stepPaddle(still, 1 / 30, input(), env);
  stepPaddle(moving, 1 / 30, input(['KeyS']), env);
  assert.notEqual(moving.ball.vy, still.ball.vy);
  const s = createPaddleState(env);
  stepPaddle(s, 1 / 60, input([], [], { x: 100, y: 280, down: true }), env);
  assert.ok(s.left.y <= 132 + 220 / 60 + 0.01);
});

test('Paddle constant input movement agrees at 60 and 120 Hz', () => {
  const states = [60, 120].map((hz) => {
    const { env } = harness({ mode: 2 });
    const s = createPaddleState(env);
    for (let n = 0; n < hz / 4; n++) stepPaddle(s, 1 / hz, input(['KeyS', 'ArrowUp']), env);
    return s;
  });
  assert.ok(Math.abs(states[0].left.y - states[1].left.y) < 1e-8);
  assert.ok(Math.abs(states[0].right.y - states[1].right.y) < 1e-8);
});
test('Paddle simultaneous duo input moves both players independently', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  stepPaddle(s, 1 / 30, input(['KeyW', 'ArrowDown']), env);
  assert.ok(s.left.y < 132);
  assert.ok(s.right.y > 132);
});

test('Paddle bowed rendered face uses its local normal and conserves passive total energy', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  const outline = paddleOutline(s.left),
    a = outline[3],
    b = outline[4];
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy),
    nx = dy / length,
    ny = -dx / length,
    tx = -ny,
    ty = nx;
  s.ball = {
    x: (a.x + b.x) / 2 + nx * 5.1,
    y: (a.y + b.y) / 2 + ny * 5.1,
    vx: -200 * nx + 30 * tx,
    vy: -200 * ny + 30 * ty,
    spin: 0,
  };
  const before = 0.5 * (200 ** 2 + 30 ** 2);
  stepPaddle(s, 1 / 600, input(), env);
  assert.ok(Math.abs(s.ball.vx * nx + s.ball.vy * ny - 200) < 1e-8);
  assert.ok(Math.abs(s.ball.vx * tx + s.ball.vy * ty - 20) < 1e-8);
  assert.ok(Math.abs(s.ball.spin - 4) < 1e-8);
  const after = 0.5 * (s.ball.vx ** 2 + s.ball.vy ** 2) + 6.25 * s.ball.spin ** 2;
  assert.ok(after <= before);
  assert.ok(Math.abs(after + s.dissipated - before) < 1e-8);
  assert.equal(s.motorWork, 0);
});
test('Paddle starts from rest through finite motor acceleration', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  stepPaddle(s, 1 / 120, input(['KeyS']), env);
  assert.ok(s.left.vy > 0 && s.left.vy < 20);
  assert.ok(s.left.y - 132 < 0.1);
});

test('Paddle deuce needs a two-point lead, with an eleven-point cap', () => {
  const { env, ends } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.points = [6, 6];
  s.serve = 0;
  s.ball = { x: 490, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.points, [7, 6]);
  assert.equal(ends.length, 0);
  s.serve = 0;
  s.ball = { x: 490, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.phase, 'won');
  assert.equal(ends.length, 1);
});
test('Paddle releasing a key brakes instead of teleporting velocity to zero', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  for (let f = 0; f < 12; f++) stepPaddle(s, 1 / 120, input(['KeyS']), env);
  const y = s.left.y,
    vy = s.left.vy;
  stepPaddle(s, 1 / 120, input(), env);
  assert.ok(s.left.vy > 0 && s.left.vy < vy);
  assert.ok(s.left.y > y);
});
test('Paddle static contacts never add translation plus rotational energy', async () => {
  const { paddleContact } = await import('../src/games/paddle-duel.js');
  for (const v of [
    [-210, 0, 0],
    [-210, 40, 0],
    [-180, -70, 16],
  ]) {
    const b = { vx: v[0], vy: v[1], spin: v[2] };
    const before = 0.5 * (b.vx * b.vx + b.vy * b.vy) + 6.25 * b.spin * b.spin;
    const result = paddleContact(b, 1, 0, 0, 0);
    const after = 0.5 * (b.vx * b.vx + b.vy * b.vy) + 6.25 * b.spin * b.spin;
    assert.ok(after <= before + 1e-8);
    assert.ok(Math.abs(after - before + result.dissipated) < 1e-8);
    assert.equal(result.work, 0);
  }
});
test('Paddle powered moving contact accounts for motor work and ball spin', async () => {
  const { paddleContact } = await import('../src/games/paddle-duel.js');
  const b = { vx: -210, vy: 0, spin: 0 },
    before = 0.5 * 210 ** 2;
  const result = paddleContact(b, 1, 0, 0, 180);
  assert.ok(b.vy > 0);
  assert.notEqual(b.spin, 0);
  assert.ok(result.work > 0);
  const after = 0.5 * (b.vx * b.vx + b.vy * b.vy) + 6.25 * b.spin * b.spin;
  assert.ok(Math.abs(after - before - result.work + result.dissipated) < 1e-8);
});

test('Paddle cap at eleven resolves a ten-all tie', () => {
  const { env, ends } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.points = [10, 10];
  s.serve = 0;
  s.ball = { x: -10, y: 200, vx: -100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.deepEqual(s.points, [10, 11]);
  assert.equal(s.phase, 'lost');
  assert.equal(ends.length, 1);
});
test('Paddle each player can win a complete local match with separate documented controls', () => {
  for (const side of [0, 1]) {
    const { env, ends } = harness({ mode: 2, seed: 11 });
    const game = createGame(env);
    const used = new Set();
    for (let f = 0; f < 24000 && game.getState().phase === 'playing'; f++) {
      const s = game.getState(),
        keys = returnControls(s, side);
      keys.forEach((k) => used.add(k));
      game.update(1 / 60, input(keys, s.serve > 0 ? [side ? 'Enter' : 'Space'] : []));
    }
    const s = game.getState();
    assert.equal(s.phase, side ? 'lost' : 'won');
    assert.ok(s.points[side] >= 7);
    assert.equal(ends.length, 1);
    assert.ok(s.totalHits > 0);
    assert.ok(used.has(side ? 'ArrowUp' : 'KeyW'));
    assert.ok(used.has(side ? 'ArrowDown' : 'KeyS'));
  }
});
test('Paddle a missed-defense solo match loses, freezes once, and a new instance resets', () => {
  const { env, ends } = harness({ seed: 2 });
  const game = createGame(env);
  for (let f = 0; f < 18000 && game.getState().phase === 'playing'; f++) {
    const s = game.getState();
    game.update(1 / 60, input(['KeyW'], s.serve > 0 ? ['Enter'] : []));
  }
  assert.equal(game.getState().phase, 'lost');
  assert.equal(ends.length, 1);
  const frozen = game.getState();
  for (let n = 0; n < 30; n++) game.update(1 / 30, input(['KeyS'], ['Space']));
  assert.deepEqual(game.getState(), frozen);
  assert.deepEqual(createGame(env).getState().points, [0, 0]);
});
test('Paddle low-speed ball is visibly called a let, then re-served with no point or invisible boost', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 240, y: 160, vx: 0, vy: 0, spin: 0 };
  for (let f = 0; f < 361; f++) stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.lets, 1);
  assert.equal(s.letReason, 'slow');
  assert.ok(s.serve > 0);
  assert.deepEqual(s.points, [0, 0]);
  assert.equal(s.ball.vx, 0);
  stepPaddle(s, 1 / 120, input([], ['Enter']), env);
  assert.equal(s.serve, 0);
  assert.ok(Math.abs(s.ball.vx) === 220);
  assert.ok(s.serveWork > 0);
});
test('Paddle frictionless flight is invariant across 30/60/120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const { env } = harness({ mode: 2 });
    const s = createPaddleState(env);
    s.serve = 0;
    s.ball = { x: 200, y: 120, vx: 100, vy: 30, spin: 4, rotation: 0 };
    for (let f = 0; f < hz; f++) stepPaddle(s, 1 / hz, input(), env);
    return s;
  });
  for (const s of states) {
    assert.ok(Math.abs(s.ball.x - 300) < 1e-8);
    assert.ok(Math.abs(s.ball.y - 150) < 1e-8);
    assert.equal(s.ball.vx, 100);
    assert.equal(s.ball.spin, 4);
  }
});

test('Paddle mirrored face contacts treat both players symmetrically', () => {
  const make = (right) => {
    const { env } = harness({ mode: 2 });
    const s = createPaddleState(env);
    s.serve = 0;
    s.ball = { x: right ? 425 : 55, y: 160, vx: right ? 300 : -300, vy: 40, spin: right ? -5 : 5 };
    stepPaddle(s, 1 / 30, input(), env);
    return s;
  };
  const left = make(false),
    right = make(true);
  assert.ok(Math.abs(left.ball.x + right.ball.x - 480) < 1e-8);
  assert.ok(Math.abs(left.ball.vx + right.ball.vx) < 1e-8);
  assert.ok(Math.abs(left.ball.vy - right.ball.vy) < 1e-8);
  assert.ok(Math.abs(left.ball.spin + right.ball.spin) < 1e-8);
});
test('Paddle ball can cross several paddle widths per frame without tunneling', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 70, y: 160, vx: -20000, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 30, input(), env);
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.points, [0, 0]);
  assert.ok(s.rally >= 2);
  assert.ok(s.ball.x > 44 && s.ball.x < 436);
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) <= 20000 + 1e-6);
});
test('Paddle 45-second rally limit is a non-scoring visible let', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.rallyTime = 44.999;
  s.ball = { x: 240, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.lets, 1);
  assert.equal(s.letReason, 'time');
  assert.ok(s.serve > 0);
  assert.deepEqual(s.points, [0, 0]);
});
test('Paddle player-two controls never move player one; all touch actions have sides', async () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  stepPaddle(s, 1 / 30, input(['ArrowDown']), env);
  assert.equal(s.left.y, 132);
  assert.ok(s.right.y > 132);
  const { meta } = await import('../src/games/paddle-duel.js');
  assert.ok(meta.touchControls.every((c) => c.side));
  for (const code of ['KeyW', 'KeyS', 'Space', 'ArrowUp', 'ArrowDown', 'Enter'])
    assert.ok(meta.multiplayerTouchControls.some((c) => c.code === code && c.side));
});

test('Paddle seeded public-input simulation is deterministic, bounded and drawable', () => {
  const games = [createGame(harness({ seed: 19 }).env), createGame(harness({ seed: 19 }).env)];
  const random = seeded(77);
  let held = [];
  const finite = (value) => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (value && typeof value === 'object') Object.values(value).forEach(finite);
  };
  for (let frame = 0; frame < 1800; frame++) {
    if (frame % 15 === 0) held = random() < 0.4 ? ['KeyW'] : random() < 0.7 ? ['KeyS'] : [];
    for (const g of games) g.update(1 / 60, input(held, frame % 120 === 0 ? ['Space'] : []));
    if (frame % 60 === 0) {
      const state = games[0].getState();
      finite(state);
      assert.ok(state.trail.length <= 9 && state.particles.length <= 12);
      games[0].draw(mockContext());
      assert.deepEqual(state, games[1].getState());
    }
  }
});

test('Paddle opponent returns never increase player score and player returns bank on completed points', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.ball = { x: 426, y: 160, vx: 210, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 30, input(), env);
  assert.ok(s.rally > 0);
  assert.equal(s.score, 0);
  s.ball = { x: 54, y: 160, vx: -210, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 30, input(), env);
  assert.equal(s.score, 0);
  s.ball = { x: 490, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.score, 105);
});
test('Paddle return bonus is capped per completed point and lets cannot bank it', () => {
  const { env } = harness({ mode: 2 });
  const s = createPaddleState(env);
  s.serve = 0;
  s.pointHits = [100, 0];
  s.ball = { x: 490, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(s, 1 / 120, input(), env);
  assert.equal(s.score, 150);
  const letState = createPaddleState(env);
  letState.serve = 0;
  letState.pointHits = [100, 0];
  letState.rallyTime = 44.999;
  letState.ball = { x: 240, y: 160, vx: 100, vy: 0, spin: 0 };
  stepPaddle(letState, 1 / 120, input(), env);
  assert.equal(letState.score, 0);
  assert.deepEqual(letState.pointHits, [0, 0]);
});
