import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, resolveStrike } from '../src/games/ember-knights.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
test('knights: strike respects reach, facing and blocks', () => {
  const a = { x: 100, y: 250, face: 1 };
  const b = { x: 130, y: 250, face: -1, blocking: true };
  assert.deepEqual(resolveStrike(a, b, 'light'), { hit: true, damage: 2, knock: 5 });
  b.blocking = false;
  assert.equal(resolveStrike(a, b, 'heavy').damage, 16);
  b.x = 210;
  assert.equal(resolveStrike(a, b, 'heavy').hit, false);
});
test('knights: solo and local duel initialize and render', () => {
  for (const mode of [1, 2]) {
    const g = createGame(harness({ mode, lang: 'zh' }).env);
    assert.equal(g.getState().fighters.length, 2);
    assert.equal(g.getState().round, 1);
    g.draw(mockContext());
  }
  assert.equal(meta.players, '1-2');
});
test('knights: controls move both local players and attacks cost stamina', () => {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 30, ['KeyD', 'ArrowLeft']);
  const s = g.getState();
  assert.ok(s.fighters[0].x > 130);
  assert.ok(s.fighters[1].x < 350);
  step(g, 1, ['KeyJ'], ['KeyJ']);
  assert.ok(g.getState().fighters[0].stamina < 100);
});
test('knights: jump rises then returns to arena floor', () => {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 5, [], ['KeyW']);
  assert.ok(g.getState().fighters[0].y < 260);
  step(g, 100);
  assert.equal(g.getState().fighters[0].y, 260);
});
test('knights: combat resolves a best-of-three match and restart is fresh', () => {
  const h = harness({ mode: 2 });
  const g = createGame(h.env);
  for (let i = 0; i < 16000 && g.getState().phase === 'playing'; i++) {
    const s = g.getState();
    const held = ['KeyJ', 'KeyK'];
    if (s.fighters[0].x < s.fighters[1].x - 25) held.push('KeyD');
    g.update(1 / 60, input(held));
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(g.getState().winner, 1);
  assert.equal(createGame(h.env).getState().fighters[0].health, 100);
});
