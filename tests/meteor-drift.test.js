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
import { LEVELS, LEVEL_COUNT } from '../src/games/meteor-drift-levels.js';
import { MAX_SPEED, MAGAZINE } from '../src/games/meteor-drift-step.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('meteor wrap and spawn are deterministic and safe', () => {
  assert.equal(wrap(-1, 480), 479);
  assert.equal(wrap(482, 480), 2);
  const a = makeRocks(1, seeded(2));
  assert.equal(a.length, LEVELS[0].rocks.length);
  assert.deepEqual(a, makeRocks(1, seeded(2)));
  assert(a.every((r) => Math.hypot(r.x - 240, r.y - 160) > 100));
});
test('meteor thrust, turning and firing use finite forces', () => {
  const s = createMeteorState(seeded(1));
  stepMeteors(s, 0.03, input(['ArrowUp', 'ArrowRight', 'Space']), seeded(2));
  assert(s.ship.vx !== 0 || s.ship.vy !== 0);
  assert(s.ship.angle > -Math.PI / 2);
  assert.equal(s.shots.length, 1);
  const q = createMeteorState(seeded(1));
  q.ship.vx = 100;
  q.ship.angle = 0;
  stepMeteors(q, 1 / 30, input(['ArrowUp']), seeded(2));
  assert(q.ship.vx > 100);
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
test('meteor collision loses life then protected respawn; the last sector wins', () => {
  const s = createMeteorState(seeded(1));
  s.invulnerable = 0;
  s.hull = 1;
  s.rocks = [{ x: 250, y: 160, vx: -150, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0.01, input(), seeded(1));
  assert.equal(s.lives, 2);
  assert(s.invulnerable > 0);
  s.lives = 1;
  s.hull = 1;
  s.invulnerable = 0;
  s.rocks = [{ x: s.ship.x + 8, y: s.ship.y, vx: -150, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0.01, input(), seeded(1));
  assert.equal(s.phase, 'lost');
  const q = createMeteorState(seeded(1));
  q.level = LEVEL_COUNT;
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
  s.hull = 1;
  s.ship = { x: 479, y: 319, vx: 150, vy: 150, angle: 0 };
  s.rocks = [{ x: 1, y: 1, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0, input(), seeded(1));
  assert.equal(s.lives, 2);
});

test('meteor sectors introduce ice, iron and volatile rocks and braking is frame independent', () => {
  const kinds = new Set(LEVELS.flatMap((_, i) => makeRocks(i + 1, seeded(8)).map((r) => r.kind)));
  assert(kinds.has('ice'));
  assert(kinds.has('iron'));
  assert(kinds.has('volatile'));
  const s = createMeteorState(seeded(1));
  s.ship.vx = 150;
  stepMeteors(s, 0.03, input(['ArrowDown']), seeded(2));
  assert(Math.abs(s.ship.vx - 143.4) < 1e-7);
});
test('meteor swept shots hit small rocks between frame endpoints', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [{ x: 110, y: 100, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
  s.shots = [{ x: 100, y: 100, vx: 1000, vy: 0, life: 1 }];
  stepMeteors(s, 1 / 30, input(), seeded(2));
  assert(s.score >= 120);
});

test('meteor materials change armor, splitting and delayed detonation', () => {
  const rock = (x, kind, size = 3) => ({
    x,
    y: 80,
    vx: 0,
    vy: 0,
    size,
    kind,
    hp: kind === 'iron' ? 2 : 1,
    angle: 0,
    spin: 0,
  });
  const s = createMeteorState(seeded(1));
  s.rocks = [rock(100, 'iron')];
  s.shots = [{ x: 100, y: 80, vx: 0, vy: 0, life: 1 }];
  stepMeteors(s, 0, input(), seeded(1));
  assert.equal(s.rocks[0].hp, 1);
  assert.equal(s.score, 0);
  s.shots = [{ x: 100, y: 80, vx: 0, vy: 0, life: 1 }];
  stepMeteors(s, 0, input(), seeded(1));
  assert.equal(s.rocks.length, 2);
  const q = createMeteorState(seeded(2));
  q.rocks = [rock(100, 'ice')];
  q.shots = [{ x: 100, y: 80, vx: 0, vy: 0, life: 1 }];
  stepMeteors(q, 0, input(), seeded(2));
  assert.equal(q.rocks.length, 3);
  const t = createMeteorState(seeded(2));
  t.rocks = [rock(100, 'volatile'), rock(140, 'stone', 1)];
  t.shots = [{ x: 100, y: 80, vx: 0, vy: 0, life: 1 }];
  stepMeteors(t, 0, input(), seeded(2));
  assert(t.rocks.some((r) => r.fuse > 0));
  for (let i = 0; i < 90; i++) stepMeteors(t, 1 / 120, input(), seeded(2));
  assert(t.score >= 40);
  assert(t.rocks.length >= 4);
});
test('meteor pulse and pointer aim are usable and braking agrees across frame rates', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [{ x: 250, y: 160, vx: 0, vy: 0, size: 3, hp: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 0.01, input([], ['ShiftLeft']), seeded(1));
  assert(s.pulseCooldown > 6);
  assert(s.score > 0);
  const q = createMeteorState(seeded(1));
  for (let i = 0; i < 12; i++)
    stepMeteors(q, 1 / 120, input([], [], { x: 400, y: 160, down: true }), seeded(1));
  assert(q.ship.angle > -Math.PI / 2);
  assert(q.shots.length > 0);
  const states = [30, 60, 120].map((hz) => {
    const t = createMeteorState(seeded(1));
    t.ship.vx = 100;
    t.rocks = [{ x: 30, y: 30, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
    for (let i = 0; i < hz * 0.5; i++) stepMeteors(t, 1 / hz, input(['ArrowDown']), seeded(1));
    return t.ship;
  });
  assert(states.every((s) => Math.abs(s.vx) < 1e-8));
  assert(Math.abs(states[0].vx - states[2].vx) < 1e-8);
  assert(Math.abs(states[0].x - states[2].x) < 1e-8);
});

test('meteor unforced flight preserves linear and angular momentum and projectiles inherit ship velocity', () => {
  const s = createMeteorState(seeded(1));
  s.ship.vx = 70;
  s.ship.vy = -20;
  s.ship.omega = 0.6;
  stepMeteors(s, 0.02, input(), seeded(1));
  assert.equal(s.ship.vx, 70);
  assert.equal(s.ship.vy, -20);
  assert(Math.abs(s.ship.angle - (-Math.PI / 2 + 0.012)) < 1e-8);
  const q = createMeteorState(seeded(1));
  q.ship.vx = 60;
  q.ship.vy = 20;
  q.ship.angle = 0;
  stepMeteors(q, 0, input(['Space']), seeded(1));
  assert.equal(q.shots[0].vx, 410);
  assert.equal(q.shots[0].vy, 20);
});
test('meteor fragments conserve parent linear momentum', () => {
  for (const kind of ['ice', 'stone']) {
    const s = createMeteorState(seeded(1));
    s.rocks = [{ x: 100, y: 100, vx: 30, vy: -18, size: 3, kind, mass: 9, angle: 0, spin: 0.4 }];
    s.shots = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
    stepMeteors(s, 0, input(), seeded(4));
    assert(Math.abs(s.rocks.reduce((a, r) => a + r.vx * r.mass, 0) - 270) < 1e-8);
    assert(Math.abs(s.rocks.reduce((a, r) => a + r.vy * r.mass, 0) + 162) < 1e-8);
  }
});

test('meteor thrusters cut out at top speed and counter-thrust is an explicit finite force', () => {
  const s = createMeteorState(seeded(1));
  s.ship.vx = MAX_SPEED - 1;
  s.ship.angle = 0;
  s.rocks = [{ x: 100, y: 20, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
  stepMeteors(s, 1 / 30, input(['ArrowUp']), seeded(1));
  assert(s.ship.vx > MAX_SPEED - 1);
  const capped = s.ship.vx;
  stepMeteors(s, 1 / 30, input(['ArrowUp']), seeded(1));
  assert.equal(s.ship.vx, capped, 'no push along the heading at top speed');
  s.ship.angle = Math.PI;
  stepMeteors(s, 1 / 30, input(['ArrowUp']), seeded(1));
  assert(s.ship.vx < capped, 'pushing against the motion still works');
  const before = s.ship.vx;
  stepMeteors(s, 1 / 30, input(['ArrowDown']), seeded(1));
  assert(s.ship.vx < before);
  assert(before - s.ship.vx <= 220 / 30 + 1e-6);
});
test('meteor shot emission conserves total linear momentum including recoil', () => {
  const s = createMeteorState(seeded(2));
  s.ship.vx = 40;
  s.ship.vy = -10;
  s.ship.angle = 0;
  const mass = s.ship.mass,
    px = mass * s.ship.vx,
    py = mass * s.ship.vy;
  stepMeteors(s, 0, input(['Space']), seeded(2));
  assert.equal(s.shots.length, 1);
  const b = s.shots[0];
  assert(Math.abs(s.ship.mass * s.ship.vx + b.mass * b.vx - px) < 1e-8);
  assert(Math.abs(s.ship.mass * s.ship.vy + b.mass * b.vy - py) < 1e-8);
  assert.equal(s.ammo, MAGAZINE - 1);
});
test('meteor slow contact exchanges momentum without damaging either craft', () => {
  const s = createMeteorState(seeded(3));
  s.invulnerable = 0;
  s.ship = { x: 240, y: 160, vx: 10, vy: 0, angle: 0, omega: 0, mass: 16 };
  s.rocks = [
    { id: 1, x: 258, y: 160, vx: 0, vy: 0, size: 1, radius: 8, mass: 8, angle: 0, spin: 0, hp: 1 },
  ];
  const px = 160;
  stepMeteors(s, 0, input(), seeded(3));
  assert.equal(s.lives, 3);
  assert.equal(s.hull, 3);
  assert(Math.abs(s.ship.mass * s.ship.vx + s.rocks[0].mass * s.rocks[0].vx - px) < 1e-8);
});
test('meteor volatile cores telegraph a delayed physical fracture', () => {
  const s = createMeteorState(seeded(3));
  s.rocks = [
    {
      id: 1,
      x: 90,
      y: 90,
      vx: 0,
      vy: 0,
      size: 3,
      kind: 'volatile',
      mass: 676,
      radius: 26,
      angle: 0,
      spin: 0,
      hp: 1,
    },
  ];
  s.shots = [{ x: 90, y: 90, vx: 0, vy: 0, life: 1, mass: 0 }];
  stepMeteors(s, 0, input(), seeded(3));
  assert(s.rocks[0].fuse > 0);
  assert.equal(s.rocks.length, 1);
  for (let i = 0; i < 90; i++) stepMeteors(s, 1 / 120, input(), seeded(3));
  assert(s.rocks.length > 1);
  assert(s.rocks.every((r) => r.size === 1));
});
test('meteor swept collision chooses the first asteroid along a shot path', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [
    { id: 1, x: 150, y: 80, vx: 0, vy: 0, size: 1, angle: 0, spin: 0, hp: 1 },
    { id: 2, x: 110, y: 80, vx: 0, vy: 0, size: 1, angle: 0, spin: 0, hp: 1 },
  ];
  s.shots = [{ x: 80, y: 80, vx: 20000, vy: 0, life: 1, mass: 0 }];
  stepMeteors(s, 1 / 120, input(), seeded(1));
  assert(s.rocks.some((r) => r.id === 1));
  assert(!s.rocks.some((r) => r.id === 2));
});
test('meteor charged rounds travel from the ship instead of striking distant targets instantly', () => {
  const s = createMeteorState(seeded(1));
  s.ship.angle = 0;
  s.rocks = [{ id: 1, x: 340, y: 160, vx: 0, vy: 0, size: 3, angle: 0, spin: 0, hp: 2 }];
  stepMeteors(s, 1 / 120, input([], ['ShiftLeft']), seeded(1));
  assert.equal(s.rocks[0].hp, 2);
  assert.equal(s.shots.length, 1);
  assert(s.shots[0].charged);
  assert(s.pulseCooldown > 6);
});
test('meteor free-flight integration agrees at 30,60,120 Hz without hidden drag', () => {
  const states = [30, 60, 120].map((hz) => {
    const s = createMeteorState(seeded(1));
    s.ship.vx = 280;
    s.ship.vy = -20;
    s.ship.omega = 0.4;
    s.rocks = [{ x: 20, y: 20, vx: 0, vy: 0, size: 1, angle: 0, spin: 0 }];
    for (let i = 0; i < hz * 0.2; i++) stepMeteors(s, 1 / hz, input(), seeded(1));
    return s.ship;
  });
  for (const s of states) {
    assert.equal(s.vx, 280);
    assert.equal(s.vy, -20);
  }
  assert(Math.abs(states[0].x - states[2].x) < 1e-7);
  assert(Math.abs(states[0].angle - states[2].angle) < 1e-7);
});

test('meteor magazine reload moves onboard rounds without creating ship mass', () => {
  const s = createMeteorState(seeded(1));
  s.ammo = 1;
  s.reserve = 10;
  s.ship.mass = 12 + 11 * 0.02;
  stepMeteors(s, 0, input(['Space']), seeded(1));
  const mass = s.ship.mass;
  for (let i = 0; i < 250; i++) stepMeteors(s, 1 / 120, input(), seeded(1));
  assert.equal(s.ammo, 10);
  assert.equal(s.reserve, 0);
  assert.equal(s.ship.mass, mass);
});
test('meteor public hull remains visible throughout launch protection', () => {
  const g = createGame(harness().env),
    rects = [];
  const ctx = mockContext();
  ctx.fillRect = (...a) => rects.push(a);
  for (let i = 0; i < 10; i++) {
    g.update(0.015, input());
    rects.length = 0;
    g.draw(ctx);
    assert(
      rects.some(([x, y, w, h]) => w === 3 && h === 3 && x > 220 && x < 260 && y > 140 && y < 180),
    );
  }
});

test('meteor last-round volatile fuse can finish before ammunition failure', () => {
  const s = createMeteorState(seeded(1));
  s.ammo = 0;
  s.reserve = 0;
  s.rocks = [
    { id: 1, x: 100, y: 100, vx: 0, vy: 0, size: 1, kind: 'volatile', hp: 1, angle: 0, spin: 0 },
  ];
  s.shots = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1, mass: 0 }];
  stepMeteors(s, 1 / 120, input(), seeded(1));
  assert.equal(s.phase, 'playing');
  s.level = LEVEL_COUNT;
  for (let i = 0; i < 90 && s.phase === 'playing'; i++) stepMeteors(s, 1 / 120, input(), seeded(1));
  assert.equal(s.phase, 'won');
});
test('meteor survivor moves once and fragments advance through remaining collision time', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [
    {
      id: 1,
      x: 100,
      y: 100,
      vx: 100,
      vy: 0,
      size: 1,
      radius: 8,
      mass: 64,
      hp: 2,
      angle: 0,
      spin: 0,
    },
  ];
  s.shots = [{ x: 100, y: 100, vx: 100, vy: 0, life: 1, mass: 0 }];
  stepMeteors(s, 1 / 240, input(), seeded(1));
  assert(Math.abs(s.rocks[0].x - (100 + 100 / 240)) < 1e-8);
  assert.equal(s.rocks[0].hp, 1);
  const q = createMeteorState(seeded(1));
  q.rocks = [
    {
      id: 1,
      x: 100,
      y: 100,
      vx: 100,
      vy: 0,
      size: 3,
      mass: 676,
      storedEnergy: 0,
      hp: 1,
      angle: 0,
      spin: 0,
    },
  ];
  q.shots = [{ x: 100, y: 100, vx: 100, vy: 0, life: 1, mass: 0 }];
  stepMeteors(q, 1 / 240, input(), seeded(1));
  assert(Math.abs(q.rocks.reduce((a, r) => a + r.x * r.mass, 0) / 676 - (100 + 100 / 240)) < 1e-7);
});
test('meteor multiple same-slice hits follow chronological impact order', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [
    {
      id: 1,
      x: 100,
      y: 100,
      vx: 50,
      vy: 0,
      size: 1,
      mass: 64,
      radius: 8,
      hp: 3,
      angle: 0,
      spin: 0,
    },
  ];
  s.shots = [
    { x: 90, y: 100, vx: 800, vy: 0, life: 1, mass: 0 },
    { x: 100, y: 100, vx: 50, vy: 0, life: 1, mass: 0 },
  ];
  stepMeteors(s, 1 / 240, input(), seeded(1));
  assert.equal(s.rocks[0].hp, 1);
  assert(Math.abs(s.rocks[0].x - (100 + 50 / 240)) < 1e-8);
});
test('meteor fracture conserves mass, center of mass, and angular momentum', () => {
  const s = createMeteorState(seeded(1));
  s.ship.x = 420;
  s.ship.y = 260;
  const m = 9,
    radius = 26,
    omega = 0.4,
    I = 0.5 * m * radius * radius;
  s.rocks = [
    {
      x: 230,
      y: 150,
      vx: 30,
      vy: -18,
      size: 3,
      kind: 'stone',
      radius,
      mass: m,
      storedEnergy: 0,
      hp: 1,
      angle: 0,
      spin: omega,
    },
  ];
  s.shots = [{ x: 230, y: 150, vx: 30, vy: -18, life: 1, mass: 0 }];
  stepMeteors(s, 0, input(), seeded(4));
  assert(Math.abs(s.rocks.reduce((a, r) => a + r.mass, 0) - m) < 1e-8);
  assert(Math.abs(s.rocks.reduce((a, r) => a + r.mass * r.x, 0) / m - 230) < 1e-8);
  assert(Math.abs(s.rocks.reduce((a, r) => a + r.mass * r.y, 0) / m - 150) < 1e-8);
  const L = s.rocks.reduce(
    (a, r) =>
      a +
      0.5 * r.mass * r.radius * r.radius * r.spin +
      r.mass * ((r.x - 230) * r.vy - (r.y - 150) * r.vx),
    0,
  );
  assert(Math.abs(L - I * omega) < 1e-6);
});
test('meteor inert-rock breakup cannot create energy beyond absorbed impact and rotation', () => {
  const s = createMeteorState(seeded(1));
  const m = 676,
    radius = 26;
  s.rocks = [
    {
      x: 230,
      y: 150,
      vx: 0,
      vy: 0,
      size: 3,
      kind: 'stone',
      radius,
      mass: m,
      storedEnergy: 0,
      hp: 1,
      angle: 0,
      spin: 0,
    },
  ];
  s.shots = [{ x: 230, y: 150, vx: 350, vy: 0, life: 1, mass: 0.02 }];
  stepMeteors(s, 0, input(), seeded(4));
  const energy = s.rocks.reduce(
    (a, r) =>
      a +
      0.5 * r.mass * (r.vx * r.vx + r.vy * r.vy) +
      0.25 * r.mass * r.radius * r.radius * r.spin * r.spin +
      (r.storedEnergy ?? 0),
    0,
  );
  assert(energy <= 0.5 * 0.02 * 350 * 350 + 1e-6);
  assert(energy > 0);
});
test('meteor passive rock contacts conserve pair momentum and dissipate energy', () => {
  const s = createMeteorState(seeded(1));
  s.ship.x = 400;
  s.ship.y = 250;
  s.rocks = [
    {
      id: 1,
      x: 100,
      y: 100,
      vx: 20,
      vy: 0,
      size: 1,
      mass: 10,
      radius: 8,
      hp: 1,
      angle: 0,
      spin: 0,
    },
    {
      id: 2,
      x: 112,
      y: 100,
      vx: -10,
      vy: 0,
      size: 1,
      mass: 20,
      radius: 8,
      hp: 1,
      angle: 0,
      spin: 0,
    },
  ];
  stepMeteors(s, 0, input(), seeded(1));
  assert(Math.abs(s.rocks.reduce((a, r) => a + r.mass * r.vx, 0)) < 1e-8);
  assert(s.rocks.reduce((a, r) => a + 0.5 * r.mass * r.vx * r.vx, 0) <= 3000 + 1e-8);
  assert(s.rocks.every((r) => r.hp === 1));
});
test('meteor bullets collide across diagonal seams and moving-target sweeps', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [{ id: 1, x: 2, y: 2, vx: 0, vy: 0, size: 1, hp: 2, angle: 0, spin: 0 }];
  s.shots = [{ x: 478, y: 318, vx: 240, vy: 240, life: 1, mass: 0 }];
  stepMeteors(s, 1 / 60, input(), seeded(1));
  assert.equal(s.rocks[0].hp, 1);
  const q = createMeteorState(seeded(1));
  q.rocks = [{ id: 1, x: 160, y: 80, vx: -10000, vy: 0, size: 1, hp: 2, angle: 0, spin: 0 }];
  q.shots = [{ x: 100, y: 80, vx: 0, vy: 0, life: 1, mass: 0 }];
  stepMeteors(q, 1 / 120, input(), seeded(1));
  assert.equal(q.rocks[0].hp, 1);
});
test('meteor spawning avoids the current pilot and other fresh asteroids', () => {
  const wrapDelta = (x, max) => ((x + max * 1.5) % max) - max / 2;
  for (let seed = 1; seed <= 12; seed++) {
    const origin = { x: 5, y: 5 },
      rocks = makeRocks(5, seeded(seed), origin);
    assert(
      rocks.every(
        (r) => Math.hypot(wrapDelta(r.x - origin.x, 480), wrapDelta(r.y - origin.y, 320)) > 100,
      ),
    );
    for (let i = 0; i < rocks.length; i++)
      for (let j = i + 1; j < rocks.length; j++)
        assert(
          Math.hypot(
            wrapDelta(rocks[i].x - rocks[j].x, 480),
            wrapDelta(rocks[i].y - rocks[j].y, 320),
          ) > 52,
        );
  }
});
test('meteor high-speed collision and unforced angular turns remain finite and bounded in representation', () => {
  const s = createMeteorState(seeded(1));
  s.ship.angle = 100 * Math.PI;
  s.ship.omega = 3;
  s.rocks = [{ id: 1, x: 100, y: 100, vx: 0, vy: 0, size: 1, hp: 1, angle: 0, spin: 0 }];
  for (let i = 0; i < 120; i++) stepMeteors(s, 1 / 120, input(), seeded(1));
  assert(s.ship.angle >= -Math.PI && s.ship.angle < Math.PI);
  assert.equal(s.ship.omega, 3);
  const q = createMeteorState(seeded(1));
  q.invulnerable = 0;
  q.ship = { x: 30, y: 100, vx: 10000, vy: 0, angle: 0, omega: 0, mass: 20 };
  q.rocks = [{ id: 1, x: 80, y: 100, vx: 0, vy: 0, size: 1, mass: 64, hp: 1, angle: 0, spin: 0 }];
  stepMeteors(q, 1 / 120, input(), seeded(1));
  assert.equal(q.hull, 2);
  assert(q.ship.vx < 10000);
});

test('meteor terminal loss freezes, reports once and restarts cleanly in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang, seed: 7 }),
      g = createGame(h.env);
    let frames = 0;
    while (g.getState().phase === 'playing' && frames++ < 10000)
      g.update(1 / 30, input(['ArrowUp']));
    assert.equal(g.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    const terminal = g.getState();
    for (let i = 0; i < 60; i++) g.update(1 / 60, input(['Space', 'ArrowUp'], ['ShiftLeft']));
    assert.deepEqual(g.getState(), terminal);
    assert.equal(h.ends.length, 1);
    const fresh = createGame(h.env).getState();
    assert.equal(fresh.level, 1);
    assert.equal(fresh.hull, 3);
    assert.equal(fresh.ammo, MAGAZINE);
    assert.equal(fresh.reserve, LEVELS[0].ammo - MAGAZINE);
    assert.equal(fresh.ship.omega, 0);
  }
});
test('meteor exhausted reserve ends clearly while a normal reload remains recoverable', () => {
  const s = createMeteorState(seeded(1));
  s.ammo = 0;
  s.reserve = 0;
  s.shots = [];
  stepMeteors(s, 1 / 120, input(), seeded(1));
  assert.equal(s.phase, 'lost');
  assert.equal(s.reason, 'ammo');
  const q = createMeteorState(seeded(1));
  q.ammo = 0;
  q.reserve = 12;
  q.reload = 2;
  for (let i = 0; i < 241; i++) stepMeteors(q, 1 / 120, input(), seeded(1));
  assert.equal(q.phase, 'playing');
  assert.equal(q.ammo, 12);
  assert.equal(q.reserve, 0);
});
test('meteor thrust and angular actuators agree at 30,60,120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const s = createMeteorState(seeded(1));
    s.ship.x = 240;
    s.ship.y = 160;
    s.rocks = [{ x: 20, y: 20, vx: 0, vy: 0, size: 1, hp: 1, angle: 0, spin: 0 }];
    for (let i = 0; i < hz; i++)
      stepMeteors(s, 1 / hz, input(['ArrowUp', 'ArrowRight']), seeded(1));
    assert(Math.abs(s.ship.omega) <= 3.4 + 1e-8);
    return s.ship;
  });
  for (const k of ['x', 'y', 'vx', 'vy', 'angle', 'omega'])
    assert(Math.abs(states[0][k] - states[2][k]) < 1e-7);
});
test('meteor fine dust retains a final fragment mass and momentum without invented kinetic energy', () => {
  const s = createMeteorState(seeded(1));
  s.rocks = [
    {
      x: 100,
      y: 100,
      vx: 20,
      vy: -10,
      size: 1,
      radius: 8,
      mass: 64,
      storedEnergy: 0,
      hp: 1,
      angle: 0,
      spin: 0,
    },
  ];
  s.shots = [{ x: 100, y: 100, vx: 20, vy: -10, life: 1, mass: 0 }];
  stepMeteors(s, 0, input(), seeded(1));
  const dust = s.particles.filter((p) => p.mass > 0);
  assert(Math.abs(dust.reduce((n, p) => n + p.mass, 0) - 64) < 1e-8);
  assert(Math.abs(dust.reduce((n, p) => n + p.mass * p.vx, 0) - 1280) < 1e-8);
  assert(
    Math.abs(dust.reduce((n, p) => n + 0.5 * p.mass * (p.vx * p.vx + p.vy * p.vy), 0) - 16000) <
      1e-8,
  );
});
test('meteor seeded long flight keeps every exposed number and collection bounded', () => {
  const h = harness({ seed: 11 }),
    g = createGame(h.env);
  for (let n = 0; n < 15000 && g.getState().phase === 'playing'; n++) {
    const keys = ['Space'];
    if (n % 360 < 120) keys.push('ArrowUp');
    if (n % 240 < 80) keys.push('ArrowLeft');
    if (n % 360 > 240) keys.push('ArrowDown');
    g.update(1 / 60, input(keys, n % 600 === 0 ? ['ShiftLeft'] : []));
    if (n % 100 === 0) {
      const s = g.getState();
      const finite = (v) => {
        if (typeof v === 'number') assert(Number.isFinite(v));
        else if (v && typeof v === 'object') for (const x of Object.values(v)) finite(x);
      };
      finite(s);
      assert(s.shots.length < 30);
      assert(s.rocks.length < 100);
      assert(s.particles.length <= 120);
      assert(s.ship.mass >= 12 - 1e-6);
      g.draw(mockContext());
    }
  }
});

test('meteor nearly coincident contacts use a unit normal and never amplify energy', () => {
  const s = createMeteorState(seeded(1));
  s.ship.x = 400;
  s.ship.y = 260;
  s.rocks = [
    { x: 100, y: 100, vx: 1, vy: 0, size: 1, radius: 8, mass: 1, hp: 1, angle: 0, spin: 0 },
    {
      x: 100 + 1e-12,
      y: 100,
      vx: -1,
      vy: 0,
      size: 1,
      radius: 8,
      mass: 1,
      hp: 1,
      angle: 0,
      spin: 0,
    },
  ];
  stepMeteors(s, 0, input(), seeded(1));
  assert(s.rocks.every((r) => Math.abs(r.vx) <= 1));
  assert(s.rocks.reduce((e, r) => e + 0.5 * r.mass * (r.vx * r.vx + r.vy * r.vy), 0) <= 1 + 1e-9);
});
