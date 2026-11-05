import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, moveOnPlatforms } from '../src/games/snowball-siege.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, held = [], pressed = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(held, i ? [] : pressed));
};
test('snow: movement lands on one-way platforms and cannot fall through', () => {
  const p = { x: 40, y: 20, w: 12, h: 16, vx: 0, vy: 100, grounded: false };
  moveOnPlatforms(p, [{ x: 0, y: 50, w: 100 }], 0.2);
  assert.equal(p.y, 34);
  assert.equal(p.grounded, true);
});
test('snow: starts with a playable first arena and bilingual metadata', () => {
  const { env } = harness();
  const g = createGame(env);
  const s = g.getState();
  assert.equal(s.level, 1);
  assert.equal(s.lives, 3);
  assert.ok(s.enemies.length >= 3);
  assert.ok(meta.description.zh);
  g.draw(mockContext());
});
test('snow: walking, jumping and throwing are functional', () => {
  const h = harness();
  const g = createGame(h.env);
  const x = g.getState().player.x;
  step(g, 20, ['ArrowRight', 'Space']);
  assert.ok(g.getState().player.x > x);
  assert.ok(g.getState().shots.length > 0);
  const y = g.getState().player.y;
  step(g, 5, ['ArrowUp'], ['ArrowUp']);
  assert.ok(g.getState().player.y < y);
  assert.ok(h.sounds.includes('shoot'));
});
test('snow: hitting foes packs snow, rolling snowballs score and clear a stage', () => {
  const h = harness();
  const g = createGame(h.env);
  let seenSnow = false;
  for (let i = 0; i < 7000 && g.getState().phase === 'playing'; i++) {
    const s = g.getState();
    const e = s.enemies.find((e) => e.active);
    if (!e) {
      g.update(1 / 60, input());
      continue;
    }
    const p = s.player;
    const held = ['Space'];
    if (e.x > p.x + 8) held.push('ArrowRight');
    if (e.x < p.x - 8) held.push('ArrowLeft');
    if (e.y < p.y - 16) held.push('ArrowUp');
    g.update(1 / 60, input(held, i % 40 === 0 ? ['ArrowUp'] : []));
    seenSnow ||= g.getState().enemies.some((e) => e.snow > 0);
  }
  assert.ok(seenSnow);
  assert.ok(g.getState().score > 0);
});
test('snow: timer or enemy contact ends a run once and a new run resets', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 20000);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  step(g, 100);
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().score, 0);
});

test('snow: legal movement and throwing complete all three towers', () => {
  const h = harness({ seed: 1 });
  const game = createGame(h.env);
  for (let frame = 0; frame < 16000 && game.getState().phase === 'playing'; frame++) {
    const state = game.getState();
    const target = state.enemies.find((enemy) => enemy.active);
    const held = [];
    if (target) {
      held.push('Space');
      if (target.x > state.player.x + 8) held.push('ArrowRight');
      if (target.x < state.player.x - 8) held.push('ArrowLeft');
      if (target.y < state.player.y - 16) held.push('ArrowUp');
    }
    game.update(1 / 60, input(held));
    if (frame % 120 === 0) game.draw(mockContext());
  }
  assert.equal(game.getState().phase, 'won');
  assert.equal(game.getState().level, 3);
  assert.ok(game.getState().score > 2000);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
});
