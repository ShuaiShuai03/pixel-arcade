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
  assert(s.intermission > 0);
  for (let i = 0; i < 180; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
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

function orbitPilot(s) {
  const p = s.ship;
  const e = [...s.enemies].sort(
    (a, b) => Math.abs(a.x - p.x) * 0.6 - a.y * 0.7 - (Math.abs(b.x - p.x) * 0.6 - b.y * 0.7),
  )[0];
  const travel = e ? Math.max(0, (270 - e.y) / (390 + (e.vy || 0))) : 0;
  let target = e ? e.x + (e.vx || 0) * travel - p.vx * travel : 240;
  let fire =
    e &&
    Math.abs(p.x + p.vx * travel - e.x - (e.vx || 0) * travel) < (e.role === 'commander' ? 36 : 17);
  let pressed = [];
  const threats = s.bullets
    .map((b) => ({ b, time: (p.y - b.y) / b.vy }))
    .filter((q) => q.time > 0 && q.time < 0.7)
    .map((q) => ({ ...q, x: q.b.x + q.b.vx * q.time }))
    .filter((q) => Math.abs(q.x - (p.x + p.vx * Math.min(q.time, 0.1))) < 30)
    .sort((a, b) => a.time - b.time);
  if (threats[0]) {
    const q = threats[0];
    if (s.barrierCooldown <= 0 && q.time < 0.4 && q.b.y < 266) pressed = ['ShiftLeft'];
    else {
      target = p.x + (p.x < 55 ? 80 : p.x > 425 ? -80 : p.x < q.x ? -70 : 70);
      fire = true;
    }
  }
  const keys = [],
    error = target - p.x - p.vx * 0.12;
  if (error < -5) keys.push('ArrowLeft');
  if (error > 5) keys.push('ArrowRight');
  if (fire) keys.push('Space');
  return input(keys, pressed);
}
test('legal rail movement, interception and guard clear all four encounters at 30,60,120Hz', () => {
  for (const seed of [1, 2])
    for (const hz of [30, 60, 120]) {
      const h = harness({ seed }),
        g = createGame(h.env),
        seen = new Set();
      let frames = 0;
      while (g.getState().phase === 'playing' && frames++ < hz * 400) {
        const s = g.getState();
        seen.add(s.wave);
        g.update(1 / hz, orbitPilot(s));
        if (frames % hz === 0) g.draw(mockContext());
      }
      const s = g.getState();
      assert.equal(s.phase, 'won', `seed${seed} at${hz}Hz`);
      assert.equal(s.wave, 4);
      assert.equal(seen.size, 4);
      assert(s.intercepts > 0);
      assert.equal(h.ends.length, 1);
      assert(h.ends[0].won);
      const terminal = g.getState();
      for (let i = 0; i < 60; i++) g.update(1 / 60, input(['Space', 'ArrowLeft'], ['ShiftLeft']));
      assert.deepEqual(g.getState(), terminal);
      assert.equal(h.ends.length, 1);
    }
});

test('invader campaigns have scouts, divers, a command ship, and a rechargeable barrier', () => {
  assert(makeFleet(2).some((e) => e.role === 'diver'));
  assert(makeFleet(4).some((e) => e.role === 'commander'));
  const s = createInvaderState();
  stepInvaders(s, 0.01, input([], ['ShiftLeft']), seeded(1));
  assert(s.barrier > 0);
  assert(s.barrierCooldown > 0);
});
test('invader fire is telegraphed before hostile bullets appear', () => {
  const s = createInvaderState();
  s.enemyCooldown = 0;
  s.deploy = 0;
  stepInvaders(s, 0.01, input(), seeded(1));
  assert.equal(s.bullets.length, 0);
  assert(s.warnings.length > 0);
  for (let i = 0; i < 40; i++) stepInvaders(s, 0.02, input(), seeded(1));
  assert(s.bullets.length > 0);
});

test('invader barrier absorbs shots, respects recharge and pointer moves and fires', () => {
  const s = createInvaderState();
  s.invulnerable = 0;
  s.bullets = [{ x: 240, y: 264, vy: 180 }];
  stepInvaders(s, 0.03, input([], ['ShiftLeft']), seeded(3));
  assert.equal(s.lives, 3);
  assert.equal(s.bullets.length, 0);
  const cooldown = s.barrierCooldown;
  stepInvaders(s, 0.03, input([], ['ShiftLeft']), seeded(3));
  assert(s.barrierCooldown < cooldown);
  stepInvaders(s, 0.03, input([], [], { x: 100, y: 280, down: true }), seeded(3));
  assert(s.ship.x < 240 && s.ship.x > 100);
  assert.equal(s.shots.length, 0);
  for (let i = 0; i < 150; i++) stepInvaders(s, 1 / 120, input(), seeded(3));
  stepInvaders(s, 1 / 120, input(['Space']), seeded(3));
  assert(s.shots.length > 0);
});
test('invader commander changes attack and swept shots cannot tunnel', () => {
  const s = createInvaderState();
  s.wave = 4;
  s.deploy = 0;
  s.enemies = makeFleet(4);
  s.enemies.find((e) => e.role === 'commander').hp = 15;
  s.enemyCooldown = 0;
  stepInvaders(s, 0.01, input(), seeded(1));
  assert.equal(s.warnings.length, 3);
  const q = createInvaderState();
  q.enemies = [{ x: 100, y: 100, hp: 2, type: 0 }];
  q.shots = [{ x: 100, y: 120, vy: -1500 }];
  stepInvaders(q, 1 / 30, input(), seeded(1));
  assert.equal(q.enemies[0].hp, 1);
});
test('invader ship speed is identical at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const s = createInvaderState();
    for (let i = 0; i < hz * 0.5; i++) stepInvaders(s, 1 / hz, input(['ArrowLeft']), seeded(1));
    return s.ship;
  });
  for (const s of states) {
    assert(s.x < 240);
    assert(Math.abs(s.x - states[0].x) < 1e-7);
    assert.equal(s.vx, -220);
  }
});

test('orbit physics: pointer motor cannot teleport and fleet turns never step downward instantly', () => {
  const s = createInvaderState();
  stepInvaders(s, 1 / 120, input([], [], { x: 20, y: 280, down: true }), seeded(1));
  assert(Math.abs(s.ship.x - 240) <= 220 / 120 + 1e-9);
  const q = createInvaderState();
  q.enemies = [{ id: 1, x: 460.9, y: 100, hp: 2, type: 0 }];
  q.direction = 1;
  stepInvaders(q, 1 / 30, input(), seeded(1));
  assert(q.enemies[0].y - 100 < 1);
});
test('orbit physics: a swept shot hits the nearest body and diagonal hostile rounds cannot tunnel', () => {
  const s = createInvaderState();
  s.enemies = [
    { id: 1, x: 100, y: 100, hp: 2, type: 0 },
    { id: 2, x: 100, y: 120, hp: 2, type: 0 },
  ];
  s.shots = [{ x: 100, y: 150, vy: -1500 }];
  stepInvaders(s, 1 / 30, input(), seeded(1));
  assert.equal(s.enemies.find((e) => e.id === 1).hp, 2);
  assert.equal(s.enemies.find((e) => e.id === 2).hp, 1);
  const q = createInvaderState();
  q.shields = [];
  q.invulnerable = 0;
  q.bullets = [{ x: 215, y: 263, vx: 1500, vy: 1200 }];
  stepInvaders(q, 1 / 30, input(), seeded(1));
  assert.equal(q.lives, 2);
});
test('orbit physics: bunker material blocks friendly rounds as well as hostile rounds', () => {
  const s = createInvaderState();
  s.shots = [{ x: s.shields[0].x + 3, y: 270, vx: 0, vy: -1000 }];
  const before = s.shields[0].hp;
  stepInvaders(s, 1 / 30, input(), seeded(1));
  assert(s.shields[0].hp < before);
  assert.equal(s.shots.length, 0);
});
test('orbit physics: guard intercepts at its visible plate, never below the ship', () => {
  const s = createInvaderState();
  s.bullets = [{ x: 240, y: 305, vx: 0, vy: 10 }];
  stepInvaders(s, 1 / 120, input([], ['ShiftLeft']), seeded(1));
  assert.equal(s.bullets.length, 1);
});
test('orbit resources: gun heat and guard charge recover after ordinary overuse', () => {
  const s = createInvaderState();
  assert.equal(s.heat, 0);
  for (let i = 0; i < 1200 && s.phase === 'playing'; i++)
    stepInvaders(s, 1 / 120, input(['Space']), seeded(1));
  assert(s.heat >= 0 && s.heat <= 1);
  const before = s.heat;
  for (let i = 0; i < 300 && s.phase === 'playing'; i++)
    stepInvaders(s, 1 / 120, input(), seeded(1));
  assert(s.heat < before);
});

test('orbit lifecycle: zero or invalid time cannot fire, move, or spend guard charge', () => {
  const s = createInvaderState(),
    before = structuredClone(s);
  for (const dt of [0, -1, NaN, Infinity])
    stepInvaders(s, dt, input(['Space', 'ArrowLeft'], ['ShiftLeft']), seeded(1));
  assert.deepEqual(s, before);
});
test('orbit scoring: simultaneous hits on one bonus craft award exactly one bounty', () => {
  const s = createInvaderState();
  s.ufo = { x: 240, y: 43, vx: 0, hp: 1 };
  s.shots = [
    { x: 240, y: 43, vx: 0, vy: 0 },
    { x: 240, y: 43, vx: 0, vy: 0 },
  ];
  stepInvaders(s, 1 / 240, input(), seeded(1));
  assert.equal(s.score, 250);
});
test('orbit scoring: simultaneous interceptions destroy a heavy round only once', () => {
  const s = createInvaderState();
  s.shields = [];
  s.shots = [
    { x: 240, y: 180, vx: 0, vy: -100, w: 3, h: 8 },
    { x: 240, y: 180, vx: 0, vy: -100, w: 3, h: 8 },
    { x: 240, y: 180, vx: 0, vy: -100, w: 3, h: 8 },
  ];
  s.bullets = [{ x: 240, y: 180, vx: 0, vy: 100, w: 6, h: 10, hp: 2 }];
  stepInvaders(s, 1 / 240, input(), seeded(1));
  assert.equal(s.intercepts, 1);
  assert.equal(s.score, 15);
  assert.equal(s.bullets.length, 0);
});

test('orbit formation: powered descents have finite acceleration and continuous endpoint velocity', () => {
  const s = createInvaderState();
  s.deploy = 100;
  s.formation.phase = 'drop';
  s.formation.targetY = 78;
  s.formation.dropStart = 60;
  s.formation.dropTime = 0;
  let last = s.formation.vy;
  for (let i = 0; i < 360; i++) {
    stepInvaders(s, 1 / 240, input(), seeded(1));
    assert(Math.abs(s.formation.vy - last) <= 70 / 240 + 1e-7);
    last = s.formation.vy;
  }
  assert(Math.abs(s.formation.y - 78) < 1e-7);
  assert(Math.abs(s.formation.vy) < 1e-7);
});

test('orbit diver: late return stays above the defense line and never penetrates bunker material', () => {
  const s = createInvaderState();
  s.wave = 2;
  s.formation = { x: 240, y: 150, vx: 0, vy: 0, phase: 'sweep', direction: 1, targetY: 150 };
  s.deploy = 0;
  s.enemyCooldown = 99;
  s.diveTimer = 99;
  s.invulnerable = 100;
  s.enemies = [
    {
      id: 1,
      x: 76,
      y: 190,
      vx: 0,
      vy: 20,
      hp: 1,
      role: 'diver',
      type: 1,
      mode: 'align',
      slotX: -164,
      slotY: 70,
      homeY: 220,
    },
  ];
  for (let i = 0; i < 500 && s.phase === 'playing'; i++) {
    stepInvaders(s, 1 / 120, input(), seeded(1));
    const e = s.enemies[0];
    for (const b of s.shields)
      for (const c of b.blocks)
        if (c.hp > 0)
          assert(!(e.x - 12 < c.x + c.w && e.x + 12 > c.x && e.y - 8 < c.y + c.h && e.y + 8 > c.y));
  }
  assert.equal(s.phase, 'playing');
  assert(s.enemies[0].y + 8 < 236);
});

test('orbit diver: late attack first clears peer altitude before moving across the formation', () => {
  const s = createInvaderState();
  s.wave = 2;
  s.formation = { x: 240, y: 120, vx: 0, vy: 0, phase: 'sweep', direction: 1, targetY: 120 };
  s.deploy = 0;
  s.enemyCooldown = 99;
  s.diveTimer = 99;
  s.invulnerable = 100;
  s.enemies = [
    {
      id: 1,
      x: 66,
      y: 190,
      vx: 0,
      vy: 0,
      hp: 2,
      role: 'diver',
      type: 1,
      mode: 'dive',
      attackTimer: 2,
      targetX: 400,
      slotX: -174,
      slotY: 70,
    },
    {
      id: 2,
      x: 182,
      y: 190,
      vx: 0,
      vy: 0,
      hp: 2,
      role: 'diver',
      type: 1,
      mode: 'formation',
      slotX: -58,
      slotY: 70,
    },
  ];
  for (let i = 0; i < 600 && s.phase === 'playing'; i++) {
    stepInvaders(s, 1 / 120, input(), seeded(1));
    const [a, b] = s.enemies;
    assert(!(Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 16));
  }
  assert.equal(s.phase, 'playing');
});

test('orbit visible hull: transparent player corners do not take remote hits', () => {
  const s = createInvaderState();
  s.shields = [];
  s.invulnerable = 0;
  s.bullets = [{ x: 252, y: 266, vx: 0, vy: 140, w: 3, h: 8 }];
  stepInvaders(s, 0.03, input(), seeded(1));
  assert.equal(s.lives, 3);
  for (let i = 0; i < 12 && s.lives === 3; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.lives, 2);
});
test('orbit visible hull: enemy transparent corners and wing gaps share the rendered sprite mask', () => {
  for (const [role, x, y, first] of [
    ['scout', 91, 90, 0.05],
    ['diver', 100, 87, 0.04],
    ['artillery', 88, 84, 0.05],
  ]) {
    const s = createInvaderState();
    s.deploy = 100;
    s.enemyCooldown = 100;
    s.diveTimer = 100;
    s.shields = [];
    s.enemies = [{ id: 1, x: 100, y: 100, vx: 0, vy: 0, hp: 2, type: 0, role, mode: 'formation' }];
    s.shots = [{ x, y, vx: 0, vy: 100, w: 2, h: 2 }];
    for (let i = 0; i < Math.round(first * 240); i++) stepInvaders(s, 1 / 240, input(), seeded(1));
    assert.equal(s.enemies[0].hp, 2, `${role} empty corner`);
    for (let i = 0; i < 40 && s.enemies[0].hp === 2; i++)
      stepInvaders(s, 1 / 240, input(), seeded(1));
    assert.equal(s.enemies[0].hp, 1, `${role} actual material`);
  }
});

test('orbit bonus: score requires contact with visible craft material', () => {
  const s = createInvaderState();
  s.ufo = { x: 240, y: 43, vx: 0, hp: 1 };
  s.shots = [{ x: 221, y: 35, vx: 0, vy: 100, w: 2, h: 2 }];
  stepInvaders(s, 0.02, input(), seeded(1));
  assert.equal(s.score, 0);
  assert(s.ufo);
  for (let i = 0; i < 20 && s.ufo; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.score, 250);
});

test('orbit warning: a destroyed emitter cannot leave ghost muzzle flashes or shots', () => {
  const s = createInvaderState();
  s.deploy = 0;
  s.enemyCooldown = 99;
  s.shields = [];
  s.enemies = [
    { id: 1, x: 100, y: 100, hp: 1, type: 0, role: 'scout' },
    { id: 2, x: 350, y: 100, hp: 2, type: 0, role: 'scout' },
  ];
  s.warnings = [{ id: 4, owner: 1, offset: 0, vx: 0, vy: 140, delay: 0.55, x: 100, y: 113 }];
  s.shots = [{ x: 100, y: 100, vx: 0, vy: 0 }];
  stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.warnings.length, 0);
  for (let i = 0; i < 90; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.enemyShotsFired, 0);
  assert.equal(s.bullets.length, 0);
});
test('orbit warning: aiming stays attached to the live moving muzzle and rounds inherit gun motion', () => {
  const s = createInvaderState();
  s.deploy = 0;
  s.enemyCooldown = 0;
  s.enemies = [{ id: 1, x: 100, y: 100, hp: 2, type: 0, role: 'scout' }];
  stepInvaders(s, 1 / 120, input(), seeded(1));
  const owner = s.warnings[0].owner;
  for (let i = 0; i < 30; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  let e = s.enemies.find((e) => e.id === owner),
    w = s.warnings[0];
  assert(Math.abs(w.x - e.x - w.offset) < 1e-8);
  assert(Math.abs(w.y - e.y - 13) < 1e-8);
  while (s.enemyShotsFired === 0) stepInvaders(s, 1 / 240, input(), seeded(1));
  e = s.enemies[0];
  const b = s.bullets[0];
  assert(b);
  assert(Math.abs(b.vx - e.vx) < 1e-8);
  assert(b.y >= e.y + 13);
});
test('orbit cover: the real arch is open below its roof and both sides can cut a firing slot', () => {
  const s = createInvaderState(),
    b = s.shields[0],
    hp = b.hp;
  s.bullets = [{ x: b.x + 21, y: 254, vx: 0, vy: 100 }];
  stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(b.hp, hp);
  assert.equal(s.bullets.length, 1);
  const q = createInvaderState(),
    cover = q.shields[0],
    before = cover.hp;
  q.shots = [{ x: cover.x + 21, y: 265, vx: 0, vy: -500 }];
  for (let i = 0; i < 8; i++) stepInvaders(q, 1 / 120, input(), seeded(1));
  assert.equal(cover.hp, before - 1);
  assert.equal(q.shots.length, 0);
});
test('orbit guard: three normal contacts shatter the plate, while recharge remains recoverable', () => {
  const s = createInvaderState();
  s.shields = [];
  s.deploy = 100;
  s.invulnerable = 0;
  stepInvaders(s, 1 / 120, input([], ['ShiftLeft']), seeded(1));
  for (let i = 0; i < 20; i++) stepInvaders(s, 1 / 240, input(['Space']), seeded(1));
  assert.equal(s.shotsFired, 0);
  assert.equal(s.barrierHp, 3);
  s.bullets = [250, 230, 210].map((y) => ({ x: 240, y, vx: 0, vy: 200 }));
  for (let i = 0; i < 60; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.intercepts, 3);
  assert.equal(s.barrierHp, 0);
  assert.equal(s.lives, 3);
  assert(s.barrierCooldown > 0);
  for (let i = 0; i < 600; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.barrierCooldown, 0);
  stepInvaders(s, 1 / 120, input([], ['ShiftLeft']), seeded(1));
  assert(s.barrier > 0);
  assert.equal(s.barrierHp, 3);
});
test('orbit simultaneous hits: enemy elimination and hull destruction have one array-independent outcome', () => {
  const run = (reverse) => {
    const s = createInvaderState();
    s.wave = 4;
    s.deploy = 100;
    s.shields = [];
    s.invulnerable = 0;
    s.lives = 1;
    s.enemies = [{ id: 1, x: 100, y: 100, hp: 1, type: 0, role: 'scout' }];
    s.shots = [
      { id: 4, x: 100, y: 100, vx: 0, vy: 0 },
      { id: 5, x: 100, y: 100, vx: 0, vy: 0 },
    ];
    s.bullets = [
      { id: 6, x: 240, y: 283, vx: 0, vy: 0 },
      { id: 7, x: 240, y: 283, vx: 0, vy: 0 },
    ];
    if (reverse) {
      s.shots.reverse();
      s.bullets.reverse();
    }
    stepInvaders(s, 1 / 120, input(), seeded(1));
    return {
      phase: s.phase,
      score: s.score,
      lives: s.lives,
      enemies: s.enemies.length,
      shots: s.shots.length,
      bullets: s.bullets.length,
    };
  };
  assert.deepEqual(run(false), run(true));
  assert.deepEqual(run(false), {
    phase: 'lost',
    score: 100,
    lives: 0,
    enemies: 0,
    shots: 0,
    bullets: 0,
  });
});
test('orbit cleanup: surviving hostile fire must be intercepted before the final victory', () => {
  const s = createInvaderState();
  s.wave = 4;
  s.deploy = 100;
  s.shields = [];
  s.lives = 1;
  s.invulnerable = 0;
  s.enemies = [{ id: 1, x: 100, y: 100, hp: 1, type: 0, role: 'scout' }];
  s.shots = [{ x: 100, y: 100, vx: 0, vy: 0 }];
  s.bullets = [{ x: 240, y: 190, vx: 0, vy: 140 }];
  stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.enemies.length, 0);
  assert.equal(s.phase, 'playing');
  for (let i = 0; i < 90 && s.phase === 'playing'; i++)
    stepInvaders(s, 1 / 120, input(['Space']), seeded(1));
  assert.equal(s.phase, 'won');
  assert.equal(s.lives, 1);
  assert(s.intercepts > 0);
});
test('orbit launch and finite bonuses: deployment has a response window and no endless bonus farming', () => {
  const s = createInvaderState();
  for (let i = 0; i < 140; i++) stepInvaders(s, 1 / 120, input(), seeded(1));
  assert.equal(s.bullets.length, 0);
  assert.equal(s.warnings.length, 0);
  assert.equal(s.lives, 3);
  const q = createInvaderState();
  q.wave = 4;
  q.waveTime = 200;
  q.invulnerable = 200;
  q.deploy = 0;
  q.enemies = [{ ...makeFleet(4).find((e) => e.role === 'commander'), hp: 999 }];
  for (let i = 0; i < 40 * 30 && q.phase === 'playing'; i++)
    stepInvaders(q, 1 / 30, input(), seeded(1));
  assert.equal(q.ufoPasses, 0);
  assert.equal(q.ufo, null);
  assert.equal(q.score, 0);
});
test('orbit recovery: exhausted cover, overheated gun and a rail stop still allow a legal campaign win', () => {
  const h = harness({ seed: 1 }),
    g = createGame(h.env);
  let lowest = 60,
    highestHeat = 0;
  for (const base of [55, 165])
    for (let col = 0; col < 7; col++)
      for (let frame = 0; frame < 60; frame++) {
        g.update(1 / 60, input(['Space'], [], { x: base + col * 6 + 3, y: 283, down: true }));
        const s = g.getState();
        lowest = Math.min(
          lowest,
          s.shields.reduce((n, b) => n + b.hp, 0),
        );
        highestHeat = Math.max(highestHeat, s.heat);
      }
  for (let frame = 0; frame < 180; frame++)
    g.update(1 / 60, input(['ArrowLeft', 'Space'], frame === 0 ? ['ShiftLeft'] : []));
  const edge = g.getState();
  assert.equal(edge.ship.x, 22);
  assert.equal(edge.ship.vx, 0);
  assert(lowest < 50);
  assert(highestHeat > 0.95);
  for (let frame = 0; frame < 24000 && g.getState().phase === 'playing'; frame++)
    g.update(1 / 60, orbitPilot(g.getState()));
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
});
test('orbit legal failure, restart and terminal freeze work in English and Chinese', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang, seed: 4 }),
      g = createGame(h.env);
    for (let n = 0; n < 5000 && g.getState().phase === 'playing'; n++) g.update(1 / 30, input());
    assert.equal(g.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert(!h.ends[0].won);
    const terminal = g.getState();
    for (let i = 0; i < 100; i++) g.update(1 / 60, input(['Space'], ['ShiftLeft']));
    assert.deepEqual(g.getState(), terminal);
    assert.equal(h.ends.length, 1);
    const fresh = createGame(h.env).getState();
    assert.equal(fresh.wave, 1);
    assert.equal(fresh.score, 0);
    assert.equal(fresh.lives, 3);
    assert.equal(
      fresh.shields.reduce((n, b) => n + b.hp, 0),
      60,
    );
    assert.equal(fresh.barrierCooldown, 0);
    assert.equal(fresh.heat, 0);
    g.draw(mockContext());
  }
});
test('orbit resources and public snapshots remain finite, bounded and detached during prolonged play', () => {
  const h = harness({ seed: 13 }),
    g = createGame(h.env);
  for (let i = 0; i < 12000 && g.getState().phase === 'playing'; i++) {
    const keys = ['Space', i % 360 < 180 ? 'ArrowLeft' : 'ArrowRight'];
    g.update(1 / 60, input(keys, i % 360 === 0 ? ['ShiftLeft'] : []));
    if (i % 100 === 0) {
      const s = g.getState(),
        finite = (v) => {
          if (typeof v === 'number') assert(Number.isFinite(v));
          else if (v && typeof v === 'object') for (const child of Object.values(v)) finite(child);
        };
      finite(s);
      assert(s.shots.length < 20);
      assert(s.bullets.length < 40);
      assert(s.warnings.length < 15);
      assert(s.particles.length <= 60);
      assert(s.heat >= 0 && s.heat <= 1);
      s.shields[0].blocks[0].hp = 999;
      assert.notEqual(g.getState().shields[0].blocks[0].hp, 999);
      g.draw(mockContext());
    }
  }
});
