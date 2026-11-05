import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createInvaderState,
  stepInvaders,
  makeFleet,
} from '../src/games/orbit-invaders.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('invader waves increase and ship moves and fires', () => {
  assert.equal(makeFleet(1).length, 24);
  const s = createInvaderState();
  stepInvaders(s, 0.03, input(['ArrowLeft', 'Space']), seeded(1));
  assert(s.ship.x < 240);
  assert.equal(s.shots.length, 1);
});
test('invader shots destroy enemies and shields absorb hostile fire', () => {
  const s = createInvaderState();
  s.enemies = [{ x: 240, y: 100, hp: 1, type: 0 }];
  s.shots = [{ x: 240, y: 114, vy: -300 }];
  stepInvaders(s, 0.03, input(), seeded(1));
  assert(s.score >= 100);
  assert.equal(s.wave, 2);
  const q = createInvaderState();
  q.bullets = [{ x: q.shields[0].x + 4, y: 242, vy: 150 }];
  const hp = q.shields[0].hp;
  stepInvaders(q, 0.03, input(), seeded(1));
  assert(q.shields[0].hp < hp);
});
test('invader ship loses health, is temporarily invulnerable, and loses at zero', () => {
  const s = createInvaderState();
  s.invulnerable = 0;
  s.bullets = [{ x: 240, y: 277, vy: 180 }];
  stepInvaders(s, 0.03, input(), seeded(1));
  assert.equal(s.lives, 2);
  s.invulnerable = 0;
  s.lives = 1;
  s.bullets = [{ x: 240, y: 277, vy: 180 }];
  stepInvaders(s, 0.03, input(), seeded(1));
  assert.equal(s.phase, 'lost');
});
test('invader descent can lose and last wave can win', () => {
  const s = createInvaderState();
  s.enemies = [{ x: 200, y: 274, hp: 1, type: 0 }];
  stepInvaders(s, 0.01, input(), seeded(1));
  assert.equal(s.phase, 'lost');
  const q = createInvaderState();
  q.wave = 4;
  q.enemies = [];
  stepInvaders(q, 0.01, input(), seeded(1));
  assert.equal(q.phase, 'won');
});
test('invader game has bounded projectiles and deterministic end', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  for (let n = 0; n < 30000 && g.getState().phase === 'playing'; n++) {
    g.update(1 / 30, input(n % 300 < 150 ? ['ArrowLeft', 'Space'] : ['ArrowRight', 'Space']));
    if (n % 300 === 0) g.draw(mockContext());
  }
  assert(g.getState().shots.length < 100);
  assert(g.getState().bullets.length < 100);
  g.draw(mockContext());
  assert(Number.isFinite(g.getState().score));
});

test('legal movement and firing defend all four waves on two seeds', () => {
  for (const seed of [1, 2]) {
    const h = harness({ seed }),
      g = createGame(h.env);
    let frames = 0;
    while (g.getState().phase === 'playing' && frames++ < 15000) {
      const s = g.getState();
      const target = [...s.enemies].sort(
        (a, b) => Math.abs(a.x - s.ship.x) - a.y * 0.1 - (Math.abs(b.x - s.ship.x) - b.y * 0.1),
      )[0];
      const speed = 14 + s.wave * 5 + (24 - s.enemies.length) * 1.6;
      let x = target ? target.x + (s.direction * speed * (274 - target.y)) / 360 : 240;
      const threat = s.bullets
        .filter((b) => b.y > 205 && b.y < 300 && Math.abs(b.x - s.ship.x) < 32)
        .sort((a, b) => b.y - a.y)[0];
      if (threat) x = s.ship.x + (s.ship.x < threat.x ? -65 : 65);
      const keys = ['Space'];
      if (x < s.ship.x - 4) keys.push('ArrowLeft');
      if (x > s.ship.x + 4) keys.push('ArrowRight');
      g.update(1 / 60, input(keys));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(g.getState().wave, 4);
    assert.equal(h.ends.length, 1);
    assert(h.ends[0].won);
  }
});
