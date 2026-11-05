import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, bulletHitsTile } from '../src/games/iron-bastion.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
test('tank: tile intersections distinguish armor and open ground', () => {
  assert.equal(bulletHitsTile({ x: 36, y: 40 }, [{ x: 32, y: 32, w: 16, h: 16, hp: 2 }]), 0);
  assert.equal(bulletHitsTile({ x: 0, y: 0 }, [{ x: 32, y: 32, w: 16, h: 16, hp: 2 }]), -1);
});
test('tank: defender moves, fires and renders a guarded base', () => {
  const h = harness();
  const g = createGame(h.env);
  const x = g.getState().player.x;
  step(g, 25, ['ArrowRight', 'Space']);
  const s = g.getState();
  assert.ok(s.player.x > x);
  assert.ok(h.sounds.includes('shoot'));
  assert.ok(s.tiles.some((t) => t.hp === 1) || s.tiles.length < 28);
  assert.equal(s.baseHealth, 3);
  assert.ok(meta.description.zh);
  g.draw(mockContext());
});
test('tank: enemies approach and eventually damage an undefended base', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 30000);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.ok(g.getState().baseHealth < 3 || g.getState().lives === 0);
});
test('tank: sustained player fire scores and survives deterministic simulation', () => {
  const g = createGame(harness().env);
  for (let i = 0; i < 6000 && g.getState().phase === 'playing'; i++)
    g.update(1 / 60, input(['Space', i % 160 < 80 ? 'ArrowLeft' : 'ArrowRight']));
  assert.ok(Number.isFinite(g.getState().score));
  assert.ok(g.getState().enemies.length <= 8);
  assert.ok(g.getState().bullets.length < 100);
});

const tankDirections = [
  ['ArrowUp', 0, -1],
  ['ArrowRight', 1, 0],
  ['ArrowDown', 0, 1],
  ['ArrowLeft', -1, 0],
];
function tankBlocked(state, x, y) {
  const overlaps = (r) => x < r.x + r.w && x + 20 > r.x && y < r.y + r.h && y + 20 > r.y;
  return (
    x < 5 ||
    x + 20 > 475 ||
    y < 43 ||
    y + 20 > 313 ||
    state.tiles.some(overlaps) ||
    overlaps({ x: 225, y: 282, w: 30, h: 26 })
  );
}
function firingPositionStep(state, target) {
  const p = state.player;
  const queue = [{ x: p.x, y: p.y, first: null }];
  const seen = new Set(['0,0']);
  for (let at = 0; at < queue.length && at < 3000; at++) {
    const n = queue[at];
    const aligned =
      (Math.abs(n.x - target.x) < 8 && Math.abs(n.y - target.y) > 40) ||
      (Math.abs(n.y - target.y) < 8 && Math.abs(n.x - target.x) > 40);
    if (n.first !== null && aligned) return n.first;
    for (let direction = 0; direction < 4; direction++) {
      const x = n.x + tankDirections[direction][1] * 8;
      const y = n.y + tankDirections[direction][2] * 8;
      const key = `${Math.round((x - p.x) / 8)},${Math.round((y - p.y) / 8)}`;
      if (!seen.has(key) && !tankBlocked(state, x, y)) {
        seen.add(key);
        queue.push({ x, y, first: n.first ?? direction });
      }
    }
  }
  return null;
}

for (const seed of [2, 18])
  test(`tank: legal three-wave victory preserves safe terrain placement (seed ${seed})`, () => {
    const h = harness({ seed });
    const game = createGame(h.env);
    let steering = null,
      steeringFrames = 0,
      relocations = 0,
      transitions = 0;
    for (let frame = 0; frame < 40000 && game.getState().phase === 'playing'; frame++) {
      const state = game.getState();
      const p = state.player;
      const target = state.enemies.toSorted((a, b) => b.y - a.y)[0];
      const held = ['Space'];
      if (target) {
        const dx = target.x - p.x,
          dy = target.y - p.y;
        let aim = null;
        if (Math.abs(dx) < 8) aim = dy < 0 ? 0 : 2;
        else if (Math.abs(dy) < 8) aim = dx < 0 ? 3 : 1;
        if (aim !== null) {
          if (p.dir !== aim || Math.hypot(dx, dy) > 85) held.push(tankDirections[aim][0]);
          steeringFrames = 0;
        } else {
          if (steeringFrames <= 0) {
            steering = firingPositionStep(state, target);
            steeringFrames = 5;
          }
          if (steering !== null) held.push(tankDirections[steering][0]);
          steeringFrames--;
        }
      }
      game.update(1 / 60, input(held));
      const next = game.getState();
      if (next.wave !== state.wave) {
        transitions++;
        if (tankBlocked(next, state.player.x, state.player.y)) {
          relocations++;
          assert.equal(next.player.x, 158, 'new terrain relocates an overlapping defender');
          assert.equal(next.player.y, 271);
          assert.equal(next.player.invincible, 2);
          assert.equal(next.player.dir, 0);
          assert.equal(next.player.cooldown, 0);
        } else {
          assert.equal(next.player.x, state.player.x, 'safe positions survive the wave transition');
          assert.equal(next.player.y, state.player.y);
        }
        assert.equal(tankBlocked(next, next.player.x, next.player.y), false);
      }
      if (frame % 180 === 0) game.draw(mockContext());
    }
    assert.equal(game.getState().phase, 'won');
    assert.equal(game.getState().wave, 3);
    assert.ok(game.getState().baseHealth > 0);
    assert.ok(game.getState().score > 4000);
    assert.equal(h.ends.length, 1);
    assert.equal(transitions, 2);
    // Seed 18 ends wave one inside a gap filled by the next wave's cover.
    // This is reached through ordinary movement and fire, never state mutation.
    if (seed === 18) assert.ok(relocations > 0, 'exercise actual overlap recovery');
    if (seed === 2) assert.equal(relocations, 0, 'preserve safe existing placement');
  });
