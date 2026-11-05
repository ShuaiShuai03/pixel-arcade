import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, circleHit } from '../src/games/sky-raiders.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
test('sky: collision circles include touching edges', () => {
  assert.equal(circleHit({ x: 0, y: 0, r: 5 }, { x: 10, y: 0, r: 5 }), true);
  assert.equal(circleHit({ x: 0, y: 0, r: 5 }, { x: 11, y: 0, r: 5 }), false);
});
test('sky: movement clamps to playfield and fires upgrades-ready projectiles', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 600, ['ArrowLeft', 'Space']);
  assert.ok(g.getState().player.x >= 12);
  assert.ok(h.sounds.includes('shoot'));
  assert.ok(meta.description.zh);
  g.draw(mockContext());
});
test('sky: enemies, projectiles and collectibles remain finite', () => {
  const g = createGame(harness({ seed: 10 }).env);
  for (let i = 0; i < 15000 && g.getState().phase === 'playing'; i++) {
    g.update(1 / 60, input(['Space', i % 480 < 240 ? 'ArrowRight' : 'ArrowLeft']));
    if (i % 120 === 0) g.draw(mockContext());
  }
  const s = g.getState();
  assert.ok(s.enemies.length <= 30);
  assert.ok(s.bullets.length < 200);
  assert.ok(Number.isFinite(s.score));
});
test('sky: idle player loses once, restart restores shields', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 20000);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().lives, 3);
});

function pilotInput(state) {
  const p = state.player;
  const target = state.enemies.filter((e) => e.y < p.y - 30).toSorted((a, b) => b.y - a.y)[0];
  const targetX = target ? target.x : 240;
  const hostile = state.bullets.filter((b) => b.owner === 'enemy');
  let best = null;
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) {
      const norm = dx && dy ? Math.SQRT1_2 : 1;
      let cost = 0;
      for (const seconds of [0.15, 0.3, 0.45]) {
        const x = Math.max(14, Math.min(466, p.x + dx * 160 * norm * seconds));
        const y = Math.max(52, Math.min(302, p.y + dy * 160 * norm * seconds));
        cost += Math.abs(x - targetX) * 0.012 + Math.abs(y - 265) * 0.018;
        for (const bullet of hostile) {
          const separation = Math.hypot(
            x - bullet.x - bullet.vx * seconds,
            y - bullet.y - bullet.vy * seconds,
          );
          if (separation < 14) cost += 100;
          if (separation < 40) cost += (40 - separation) * 0.14;
        }
        for (const enemy of state.enemies)
          if (Math.hypot(x - enemy.x, y - enemy.y) < enemy.r + 20) cost += 100;
      }
      if (!best || cost < best.cost) best = { cost, dx, dy };
    }
  const held = ['Space'];
  if (best.dx) held.push(best.dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (best.dy) held.push(best.dy > 0 ? 'ArrowDown' : 'ArrowUp');
  return input(held, state.pulses > 0 && best.cost > 100 && p.invincible < 0.1 ? ['KeyK'] : []);
}

test('sky: legal piloting clears three sectors and all carriers', () => {
  const h = harness({ seed: 4 });
  const game = createGame(h.env);
  for (let frame = 0; frame < 40000 && game.getState().phase === 'playing'; frame++) {
    game.update(1 / 60, pilotInput(game.getState()));
    if (frame % 120 === 0) game.draw(mockContext());
  }
  assert.equal(game.getState().phase, 'won');
  assert.equal(game.getState().level, 3);
  assert.ok(game.getState().score >= 6000);
  assert.equal(h.ends.length, 1);
});

test('sky: pulse is finite, clears hostile projectiles and damages enemies', () => {
  const game = createGame(harness({ seed: 4 }).env);
  step(game, 90);
  const before = game.getState();
  assert.ok(before.enemies.length > 0);
  game.update(1 / 60, input([], ['KeyK']));
  assert.equal(game.getState().pulses, 2);
  assert.ok(game.getState().enemies.length < before.enemies.length);
  game.update(1 / 60, input([], ['KeyK']));
  game.update(1 / 60, input([], ['KeyK']));
  game.update(1 / 60, input([], ['KeyK']));
  assert.equal(game.getState().pulses, 0);
});
