import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createMeteorState,
  stepMeteors,
  wrap,
  makeRocks,
  drawWrappedRock,
  drawWrappedShip,
} from '../src/games/meteor-drift.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('meteor wrap and spawn are deterministic and safe', () => {
  assert.equal(wrap(-1, 480), 479);
  assert.equal(wrap(482, 480), 2);
  const a = makeRocks(1, seeded(2));
  assert.equal(a.length, 4);
  assert.deepEqual(a, makeRocks(1, seeded(2)));
  assert(a.every((r) => Math.hypot(r.x - 240, r.y - 160) > 100));
});
test('meteor thrust, rotation, firing and speed cap', () => {
  const s = createMeteorState(seeded(1));
  stepMeteors(s, 0.03, input(['ArrowUp', 'ArrowRight', 'Space']), seeded(2));
  assert(s.ship.vx !== 0 || s.ship.vy !== 0);
  assert(s.ship.angle > -Math.PI / 2);
  assert.equal(s.shots.length, 1);
  for (let i = 0; i < 1000; i++) stepMeteors(s, 0.03, input(['ArrowUp']), seeded(2));
  assert(Math.hypot(s.ship.vx, s.ship.vy) <= 210.01);
});
test('meteor shooting splits rocks and awards score', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [{ x: 100, y: 100, vx: 0, vy: 0, size: 3, angle: 0, spin: 0 }];
  s.shots = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
  stepMeteors(s, 0.01, input(), seeded(2));
  assert.equal(s.rocks.length, 2);
  assert(s.rocks.every((r) => r.size === 2));
  assert.equal(s.score, 40);
});
test('meteor collision loses life then protected respawn; five waves win', () => {
  const s = createMeteorState(seeded(1));
  s.invulnerable = 0;
  s.rocks = [{ x: 240, y: 160, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0.01, input(), seeded(1));
  assert.equal(s.lives, 2);
  assert(s.invulnerable > 0);
  s.lives = 1;
  s.invulnerable = 0;
  stepMeteors(s, 0.01, input(), seeded(1));
  assert.equal(s.phase, 'lost');
  const q = createMeteorState(seeded(1));
  q.wave = 5;
  q.rocks = [];
  stepMeteors(q, 0.01, input(), seeded(1));
  assert.equal(q.phase, 'won');
});
test('meteor game renders in both languages and projectiles expire', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang }),
      g = createGame(h.env);
    for (let n = 0; n < 20000 && g.getState().phase === 'playing'; n++) {
      g.update(1 / 30, input(['Space', ...(n % 240 < 180 ? ['ArrowUp', 'ArrowLeft'] : [])]));
      if (n % 400 === 0) g.draw(mockContext());
    }
    g.draw(mockContext());
    assert(g.getState().shots.length < 30);
    assert(Number.isFinite(g.getState().ship.x));
  }
});

test('legal thrust, turning and firing clear all five sectors on two seeds', () => {
  const delta = (value, max) => ((value + max * 1.5) % max) - max / 2;
  for (const seed of [3, 5]) {
    const h = harness({ seed }),
      g = createGame(h.env);
    let frames = 0;
    while (g.getState().phase === 'playing' && frames++ < 16000) {
      const s = g.getState(),
        ship = s.ship;
      let target,
        distance = Infinity;
      for (const rock of s.rocks) {
        const d = Math.hypot(delta(rock.x - ship.x, 480), delta(rock.y - ship.y, 320));
        if (d < distance) {
          target = rock;
          distance = d;
        }
      }
      let dx = delta(target.x - ship.x, 480),
        dy = delta(target.y - ship.y, 320);
      const flight = Math.hypot(dx, dy) / 350;
      dx += (target.vx - ship.vx * 0.3) * flight;
      dy += (target.vy - ship.vy * 0.3) * flight;
      const difference = delta(Math.atan2(dy, dx) - ship.angle, Math.PI * 2),
        keys = ['Space'];
      if (difference > 0.045) keys.push('ArrowRight');
      if (difference < -0.045) keys.push('ArrowLeft');
      if (Math.hypot(ship.vx, ship.vy) < 110 && distance > 75 && Math.abs(difference) < 0.2)
        keys.push('ArrowUp');
      g.update(1 / 60, input(keys));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(g.getState().wave, 5);
    assert.equal(h.ends.length, 1);
    assert(h.ends[0].won);
  }
});

test('meteor corner wrapping draws all four asteroid copies, including the diagonal', () => {
  for (const [x, y, xOffset, yOffset] of [
    [1, 1, 480, 320],
    [479, 1, -480, 320],
    [1, 319, 480, -320],
    [479, 319, -480, -320],
  ]) {
    const craters = [];
    const ctx = {
      fillStyle: '',
      fillRect(px, py, w, h) {
        if (this.fillStyle === '#565f5b') craters.push([px, py, w, h]);
      },
    };
    drawWrappedRock(ctx, { x, y, size: 3, angle: 0 });
    const base = [Math.round(x - 26 * 0.35), Math.round(y - 26 * 0.2), 10, 5];
    assert.deepEqual(craters, [
      base,
      [base[0], base[1] + yOffset, 10, 5],
      [base[0] + xOffset, base[1], 10, 5],
      [base[0] + xOffset, base[1] + yOffset, 10, 5],
    ]);
  }
});

test('meteor ship corner wrapping renders a visible ship in every corresponding corner', () => {
  const collect = (ship) => {
    const out = [];
    const ctx = {
      fillStyle: '',
      fillRect(x, y, w, h) {
        out.push({ x, y, w, h });
      },
    };
    drawWrappedShip(ctx, ship, true, 0);
    return out;
  };
  const middle = collect({ x: 240, y: 160, angle: -Math.PI / 4 });
  for (const [x, y] of [
    [1, 1],
    [479, 1],
    [1, 319],
    [479, 319],
  ]) {
    const copies = collect({ x, y, angle: -Math.PI / 4 });
    assert.equal(copies.length, middle.length * 4);
    for (const [left, top] of [
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ]) {
      assert(
        copies.some(
          (r) =>
            r.x + r.w > 0 &&
            r.x < 480 &&
            r.y + r.h > 0 &&
            r.y < 320 &&
            (left ? r.x < 24 : r.x > 456) &&
            (top ? r.y < 24 : r.y > 296),
        ),
      );
    }
  }
});

test('meteor diagonal collisions agree with the rendered corner copies', () => {
  const s = createMeteorState(seeded(1));
  s.invulnerable = 0;
  s.ship = { x: 479, y: 319, vx: 0, vy: 0, angle: 0 };
  s.rocks = [{ x: 1, y: 1, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0, input(), seeded(1));
  assert.equal(s.lives, 2);
});
