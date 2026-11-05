import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createSkyState,
  stepSky,
  advanceFlight,
  hullRects,
  sweepProjectile,
  resolveHullImpact,
  fireRound,
  resolveProjectileStep,
  meta,
  circleHit,
} from '../src/games/sky-raiders.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, seconds, keys = [], pressed = [], hz = 120) => {
  for (let n = 0; n < Math.round(seconds * hz); n++)
    g.update(1 / hz, input(keys, n === 0 ? pressed : []));
};
const ship = (extra = {}) => ({
  id: 1,
  shape: 'scout',
  x: 240,
  y: 120,
  vx: 0,
  vy: 0,
  mass: 60,
  hp: 3,
  maxHp: 3,
  flash: 0,
  dead: false,
  ...extra,
});
const round = (extra = {}) => ({
  id: 1,
  x: 240,
  y: 200,
  vx: 0,
  vy: -400,
  r: 2,
  damage: 1,
  mass: 0.04,
  owner: 'player',
  ownerId: 0,
  life: 2,
  ...extra,
});

test('sky: finite thrust and airbrakes preserve a bounded stopping trajectory', () => {
  const p = ship({ shape: 'player', x: 240, y: 270 });
  advanceFlight(p, 1 / 120, { dx: 1, dy: 0 });
  assert.ok(p.vx > 0 && p.vx < 15);
  advanceFlight(p, 0.4, { dx: 1, dy: 0 });
  const old = { ...p };
  advanceFlight(p, 1 / 120, { dx: 0, dy: 0 });
  assert.ok(p.vx > 0 && p.vx < old.vx);
  assert.ok(p.x - old.x < 2);
});
for (const [dx, dy] of [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
])
  test(`sky: flight-limit assist remains bounded and can reverse (${dx},${dy})`, () => {
    const p = ship({ shape: 'player', x: 240, y: 180 });
    advanceFlight(p, 8, { dx, dy });
    assert.ok(p.x >= 24 - 1e-5 && p.x <= 456 + 1e-5);
    assert.ok(p.y >= 72 - 1e-5 && p.y <= 288 + 1e-5);
    const before = { ...p };
    advanceFlight(p, 1, { dx: -dx, dy: -dy });
    assert.ok(Math.hypot(p.x - before.x, p.y - before.y) > 30);
  });
test('sky: movement agrees at 30, 60 and 120 Hz without diagonal speed boosts', () => {
  const states = [30, 60, 120].map((hz) => {
    const p = ship({ shape: 'player', x: 240, y: 180 });
    for (let n = 0; n < hz * 0.5; n++) advanceFlight(p, 1 / hz, { dx: 1, dy: -1 });
    return p;
  });
  for (const p of states.slice(1)) {
    assert.ok(Math.abs(p.x - states[0].x) < 1e-6);
    assert.ok(Math.abs(p.y - states[0].y) < 1e-6);
  }
  assert.ok(Math.hypot(states[0].vx, states[0].vy) <= 171);
});
test('sky: the solid wing pixels and swept fast projectiles use shared hull geometry', () => {
  const player = ship({ shape: 'player', x: 240, y: 200 }),
    rects = hullRects(player);
  assert.ok(rects.some((r) => r.x < 230 || r.x + r.w > 250));
  const hit = sweepProjectile(
    round({ x: 252, y: 150, vx: 0, vy: 2000, owner: 'enemy' }),
    player,
    0.05,
  );
  assert.ok(hit && hit.time < 0.05);
  assert.equal(sweepProjectile(round({ x: 280, y: 150, vx: 0, vy: 2000 }), player, 0.05), null);
  assert.equal(circleHit({ x: 0, y: 0, r: 5 }, { x: 10, y: 0, r: 5 }), true);
});
test('sky: launched rounds inherit motion and their recoil conserves launch momentum', () => {
  const p = ship({ id: 0, shape: 'player', vx: 20, vy: 30, mass: 80 });
  const before = { ...p },
    b = fireRound(p, -Math.PI / 2, 320, { id: 1, owner: 'player' });
  assert.ok(b.vx > 19 && b.vx < 21);
  assert.ok(b.vy < 0);
  assert.ok(p.vy > before.vy);
  assert.ok(Math.abs(p.mass * p.vx + b.mass * b.vx - (before.mass + b.mass) * before.vx) < 1e-7);
  assert.ok(Math.abs(p.mass * p.vy + b.mass * b.vy - (before.mass + b.mass) * before.vy) < 1e-7);
});
test('sky: hull impulses dissipate energy without changing positions or awarding kills', () => {
  const a = ship({ id: 0, shape: 'player', x: 100, vx: 130, mass: 80 }),
    b = ship({ x: 130, vx: -40, mass: 100 });
  const energy = a.mass * a.vx ** 2 + b.mass * b.vx ** 2,
    momentum = a.mass * a.vx + b.mass * b.vx;
  resolveHullImpact(a, b, { nx: -1, ny: 0 });
  assert.ok(a.mass * a.vx ** 2 + b.mass * b.vx ** 2 <= energy);
  assert.ok(Math.abs(a.mass * a.vx + b.mass * b.vx - momentum) < 1e-7);
  assert.equal(a.x, 100);
  assert.equal(b.hp, 3);
});
test('sky: nearest projectile impact wins regardless of enemy array order', () => {
  for (const reverse of [false, true]) {
    const h = harness(),
      s = createSkyState();
    s.enemies = [ship({ id: 2, y: 100 }), ship({ id: 3, y: 140 })];
    if (reverse) s.enemies.reverse();
    s.bullets = [round({ y: 190, vy: -2000 })];
    resolveProjectileStep(s, 0.05, h.env);
    assert.equal(s.enemies.find((e) => e.id === 3).hp, 2);
    assert.equal(s.enemies.find((e) => e.id === 2).hp, 3);
  }
});
test('sky: a lethal trade resolves both launched impacts before terminal state', () => {
  const h = harness(),
    s = createSkyState();
  s.lives = 1;
  s.player.invincible = 0;
  s.player.x = 240;
  s.player.y = 240;
  s.enemies = [ship({ id: 2, shape: 'carrier', y: 100, hp: 1, maxHp: 1, boss: true })];
  s.bullets = [
    round({ id: 1, y: 130, vy: -1000 }),
    round({ id: 2, y: 210, vy: 1000, owner: 'enemy', ownerId: 2 }),
  ];
  resolveProjectileStep(s, 0.05, h.env);
  assert.equal(s.lives, 0);
  assert.ok(s.enemies[0].dead);
  assert.equal(h.ends.length, 0);
  stepSky(s, 1 / 120, input(), h.env);
  assert.equal(s.phase, 'lost');
  const final = structuredClone(s);
  stepSky(s, 1 / 30, input(['Space']), h.env);
  assert.deepEqual(s, final);
  assert.equal(h.ends.length, 1);
});
test('sky: charge activation consumes one stock and propagates instead of globally deleting', () => {
  const h = harness(),
    s = createSkyState();
  s.enemies = [ship({ id: 10, x: 240, y: 105 })];
  s.bullets = [round({ id: 12, x: 240, y: 145, vx: 0, vy: 0, owner: 'enemy', ownerId: 10 })];
  stepSky(s, 1 / 120, input(['KeyK'], ['KeyK']), h.env);
  assert.equal(s.pulses, 2);
  assert.equal(s.enemies[0].hp, 3);
  assert.equal(s.bullets.length, 1);
  assert.ok(s.waves[0].radius < 10);
  for (let n = 0; n < 60; n++) stepSky(s, 1 / 120, input(['KeyK']), h.env);
  assert.equal(s.pulses, 2);
  assert.ok(s.bullets.length === 0);
  assert.ok(s.enemies.length === 0 || s.enemies[0].hp < 3 || s.enemies[0].dead);
});

test('sky: ordinary raiders visibly lock an aim warning before they launch rounds', () => {
  const g = createGame(harness({ seed: 4 }).env);
  let warning;
  for (let n = 0; n < 1800 && !warning; n++) {
    g.update(1 / 120, input());
    warning = g.getState().enemies.find((e) => e.tell > 0);
  }
  assert.ok(warning, 'escort cannon must actually activate');
  const id = warning.id,
    angle = warning.angle;
  for (let n = 0; n < 150; n++) {
    g.update(1 / 120, input(['ArrowRight']));
    const s = g.getState(),
      e = s.enemies.find((e) => e.id === id);
    if (e?.tell > 0) assert.equal(e.angle, angle);
    if (s.bullets.some((b) => b.ownerId === id)) {
      assert.ok(e.tell === 0);
      return;
    }
  }
  assert.fail('warning must lead to a real launched volley');
});

test('sky: a hull killed at an earlier time cannot consume a later round', () => {
  const h = harness(),
    s = createSkyState();
  s.enemies = [ship({ id: 2, x: 240, y: 120, hp: 1, maxHp: 1 })];
  s.bullets = [round({ id: 1, y: 133, vy: -1000 }), round({ id: 2, y: 134, vy: -1000 })];
  resolveProjectileStep(s, 1 / 120, h.env);
  assert.ok(s.enemies[0].dead);
  assert.equal(s.bullets.length, 1);
  assert.equal(s.bullets[0].id, 2);
});
test('sky: battery contact is chronological and cannot revive a previously destroyed hull', () => {
  for (const early of [true, false]) {
    const h = harness(),
      s = createSkyState();
    s.lives = 1;
    s.player.invincible = 0;
    s.pickups = [
      {
        id: 40,
        x: 240,
        y: early ? 270 : 310,
        vx: 0,
        vy: early ? 0 : -1000,
        kind: 'shield',
        life: 10,
      },
    ];
    s.bullets = [round({ id: 1, x: 240, y: 248, vx: 0, vy: 1000, owner: 'enemy', ownerId: 9 })];
    resolveProjectileStep(s, 0.03, h.env);
    assert.equal(s.lives, early ? 1 : 0);
    assert.equal(!!s.pickups[0].collected, early);
  }
});
test('sky: the interception front meets the actual near-side turret before the far turret', () => {
  const h = harness(),
    s = createSkyState();
  s.enemies = [
    ship({
      id: 2,
      shape: 'carrier',
      x: 240,
      y: 100,
      boss: true,
      parts: { l: 9, r: 9 },
      hp: 20,
      maxHp: 20,
      open: true,
    }),
  ];
  s.waves = [
    {
      id: 10,
      x: 300,
      y: 125,
      radius: 0,
      speed: 420,
      maxRadius: 520,
      energy: 36,
      life: 1.3,
      hit: [],
    },
  ];
  resolveProjectileStep(s, 0.08, h.env);
  assert.equal(s.enemies[0].parts.l, 9);
  assert.ok(s.enemies[0].parts.r < 9);
});
test('sky: armored carriers require the marked core after both turret mounts are broken', () => {
  const h = harness(),
    s = createSkyState(),
    e = ship({
      id: 2,
      shape: 'carrier',
      x: 240,
      y: 100,
      boss: true,
      parts: { l: 0, r: 0 },
      hp: 20,
      maxHp: 20,
      open: true,
    });
  s.enemies = [e];
  s.bullets = [round({ id: 1, x: 278, y: 125, vy: -1000 })];
  resolveProjectileStep(s, 0.03, h.env);
  assert.equal(e.hp, 20, 'plain wing armor deflects');
  s.bullets = [round({ id: 2, x: 240, y: 125, vy: -1000 })];
  resolveProjectileStep(s, 0.03, h.env);
  assert.equal(e.hp, 19, 'gold core accepts the hit');
});

function pilotInput(state, { charges = true } = {}) {
  const p = state.player,
    live = state.enemies.filter((e) => !e.dead && e.y < p.y - 25),
    boss = live.find((e) => e.boss),
    target = boss ?? live.toSorted((a, b) => b.y - a.y)[0];
  let aim = target
    ? {
        x: target.x + (target.parts?.l > 0 ? -26 : target.parts?.r > 0 ? 26 : 0),
        y: target.y + (target.boss ? 18 : 0),
        vx: target.vx,
        vy: target.vy,
      }
    : null;
  const flight = aim ? Math.max(0.1, (p.y - 19 - aim.y) / Math.max(100, 330 - p.vy + aim.vy)) : 0;
  let goalX = aim ? aim.x + aim.vx * flight - p.vx * flight : 240,
    goalY = 265;
  const pod = state.pickups.find(
    (e) =>
      e.y > 160 &&
      e.y < 290 &&
      ((e.kind === 'shield' && state.lives < 3) || (e.kind === 'power' && p.power < 3)),
  );
  if (pod && !boss) {
    goalX = pod.x;
    goalY = pod.y;
  }
  const hostile = state.bullets.filter((b) => b.owner === 'enemy');
  let best = null;
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) {
      const norm = dx && dy ? Math.SQRT1_2 : 1,
        tx = dx * 163 * norm,
        ty = dy * 163 * norm;
      let cost = 0;
      for (const seconds of [0.15, 0.35, 0.55]) {
        const blend = Math.min(1, seconds / 0.18),
          x = Math.max(
            24,
            Math.min(456, p.x + p.vx * seconds + (tx - p.vx) * seconds * blend * 0.5),
          ),
          y = Math.max(
            72,
            Math.min(288, p.y + p.vy * seconds + (ty - p.vy) * seconds * blend * 0.5),
          );
        cost += Math.abs(x - goalX) * 0.055 + Math.abs(y - goalY) * 0.035;
        if (y < 150) cost += (150 - y) * 0.1;
        for (const b of hostile) {
          const d = Math.hypot(x - b.x - b.vx * seconds, y - b.y - b.vy * seconds);
          if (d < 22) cost += 600;
          if (d < 65) cost += (65 - d) * 0.7;
        }
        for (const e of state.enemies)
          if (!e.dead) {
            const box = hullRects(e);
            for (const r of box) {
              const ex = r.x + (e.vx ?? 0) * seconds,
                ey = r.y + (e.vy ?? 0) * seconds;
              if (x > ex - 17 && x < ex + r.w + 17 && y > ey - 18 && y < ey + r.h + 18) cost += 300;
            }
          }
      }
      if (!best || cost < best.cost) best = { dx, dy, cost };
    }
  const held = [];
  if (
    p.heat < 82 &&
    !p.overheated &&
    (!boss || boss.parts?.l > 0 || boss.parts?.r > 0 || boss.open !== false)
  )
    held.push('Space');
  if (best.dx) held.push(best.dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (best.dy) held.push(best.dy > 0 ? 'ArrowDown' : 'ArrowUp');
  const danger = hostile.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 60);
  return input(
    held,
    charges && state.pulses > 0 && state.chargeClock === 0 && danger && p.invincible < 0.1
      ? ['KeyK']
      : [],
  );
}
for (const hz of [30, 60, 120])
  for (const seed of [1, 9])
    test(`sky: full six-sector public-input victory (${hz} Hz, seed ${seed})`, (t) => {
      const h = harness({ seed }),
        g = createGame(h.env),
        seen = new Set();
      for (let n = 0; n < hz * 420 && g.getState().phase === 'playing'; n++) {
        g.update(1 / hz, pilotInput(g.getState()));
        const s = g.getState();
        seen.add(s.level);
        if (n % (hz * 2) === 0) {
          g.draw(mockContext());
          assert.ok(s.bullets.length < 240);
          assert.ok(s.enemies.length <= 10);
          assert.ok(s.particles.length <= 160);
          assert.ok(JSON.stringify(s).length < 80000);
        }
      }
      const final = g.getState();
      t.diagnostic(
        `Campaign ${hz}Hz seed ${seed}: ${final.elapsed.toFixed(2)}s, shields ${final.lives}, weapon ${final.player.power}, charges ${final.pulses}`,
      );
      assert.equal(final.phase, 'won', `sector ${final.level}, shields ${final.lives}`);
      assert.equal(seen.size, 6);
      assert.equal(final.level, 6);
      assert.equal(h.ends.length, 1);
      step(g, 2, ['Space', 'KeyK', 'ArrowRight']);
      assert.deepEqual(g.getState(), final);
    });
test('sky: spending every initial charge early does not block the campaign', (t) => {
  const h = harness({ seed: 4 }),
    g = createGame(h.env);
  for (let n = 0; n < 3; n++) {
    g.update(1 / 120, input(['KeyK'], ['KeyK']));
    step(g, 0.6);
  }
  assert.equal(g.getState().pulses, 0);
  assert.equal(g.getState().player.power, 1);
  for (let n = 0; n < 50000 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, pilotInput(g.getState(), { charges: false }));
  t.diagnostic(
    `No-charge campaign: ${g.getState().elapsed.toFixed(2)}s, shields ${g.getState().lives}, weapon ${g.getState().player.power}`,
  );
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
});
test('sky: idle defeat, restart and terminal freeze are real', () => {
  const h = harness(),
    g = createGame(h.env);
  step(g, 120);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const final = g.getState();
  step(g, 1, ['Space']);
  assert.deepEqual(g.getState(), final);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.lives, 3);
  assert.equal(fresh.pulses, 3);
  assert.equal(fresh.player.heat, 0);
  assert.equal(fresh.score, 0);
});
test('sky: overheat is visibly recoverable without ammunition or a restart', () => {
  const h = harness(),
    s = createSkyState();
  s.spawnClock = 100;
  s.pulses = 0;
  for (let n = 0; n < 1000; n++) stepSky(s, 1 / 120, input(['Space']), h.env);
  assert.ok(s.player.overheated);
  const oldCount = s.bullets.length;
  for (let n = 0; n < 420; n++) stepSky(s, 1 / 120, input(), h.env);
  assert.equal(s.player.overheated, false);
  assert.ok(s.player.heat < 40);
  stepSky(s, 1 / 120, input(['Space']), h.env);
  assert.ok(s.bullets.length > 0);
  assert.ok(Number.isFinite(oldCount));
});

test('sky: the final carrier leaves live counterfire and both defenses available during cleanup', () => {
  for (const defense of ['Space', 'KeyK']) {
    const h = harness(),
      s = createSkyState();
    s.level = 6;
    s.spawnClock = 100;
    s.lives = 1;
    s.player.invincible = 0;
    s.enemies = [
      ship({ id: 2, shape: 'carrier', boss: true, x: 240, y: 100, hp: 1, maxHp: 1, open: true }),
    ];
    s.bullets = [
      round({ id: 10, y: 125, vy: -1000 }),
      round({ id: 11, y: 200, vy: 100, owner: 'enemy', ownerId: 2 }),
    ];
    stepSky(s, 1 / 120, input(), h.env);
    assert.ok(s.cleanup);
    assert.equal(s.transition, 0);
    assert.equal(s.bullets.filter((b) => b.owner === 'enemy').length, 1);
    stepSky(s, 1 / 120, input([defense], [defense]), h.env);
    if (defense === 'Space') assert.ok(s.bullets.some((b) => b.owner === 'player'));
    else {
      assert.equal(s.pulses, 2);
      assert.equal(s.waves.length, 1);
    }
    for (let n = 0; n < 500 && s.phase === 'playing'; n++)
      stepSky(s, 1 / 120, input([defense]), h.env);
    assert.equal(s.phase, 'won');
    assert.equal(h.ends.length, 1);
  }
});
test('sky: a carrier countershot can still defeat an undefended pilot before clear', () => {
  const h = harness(),
    s = createSkyState();
  s.level = 6;
  s.spawnClock = 100;
  s.lives = 1;
  s.player.invincible = 0;
  s.enemies = [
    ship({ id: 2, shape: 'carrier', boss: true, x: 240, y: 100, hp: 1, maxHp: 1, open: true }),
  ];
  s.bullets = [
    round({ id: 10, y: 125, vy: -1000 }),
    round({ id: 11, y: 200, vy: 100, owner: 'enemy', ownerId: 2 }),
  ];
  for (let n = 0; n < 400 && s.phase === 'playing'; n++) stepSky(s, 1 / 120, input(), h.env);
  assert.equal(s.phase, 'lost');
  assert.equal(s.transition, 0);
  assert.equal(h.ends.length, 1);
});

test('sky: a destroyed turret cannot absorb a later round at its vanished pixels', () => {
  const h = harness(),
    s = createSkyState();
  s.enemies = [
    ship({
      id: 2,
      shape: 'carrier',
      x: 240,
      y: 100,
      boss: true,
      parts: { l: 1, r: 9 },
      hp: 20,
      maxHp: 20,
      open: true,
    }),
  ];
  s.bullets = [
    round({ id: 10, x: 214, y: 122, vy: -1000 }),
    round({ id: 11, x: 214, y: 123, vy: -1000 }),
  ];
  resolveProjectileStep(s, 1 / 120, h.env);
  assert.equal(s.enemies[0].parts.l, 0);
  assert.equal(s.bullets.length, 1);
  assert.equal(s.bullets[0].id, 11);
  resolveProjectileStep(s, 0.04, h.env);
  assert.equal(
    s.bullets.length,
    0,
    'the later round still hits surviving armor farther along its path',
  );
  assert.equal(s.enemies[0].hp, 20);
});
test('sky: fast rounds continue to surviving armor within the same tick after a turret breaks', () => {
  const h = harness(),
    s = createSkyState();
  s.enemies = [
    ship({
      id: 2,
      shape: 'carrier',
      x: 240,
      y: 100,
      boss: true,
      parts: { l: 1, r: 9 },
      hp: 20,
      maxHp: 20,
      open: true,
    }),
  ];
  s.bullets = [
    round({ id: 10, x: 214, y: 122, vy: -4000 }),
    round({ id: 11, x: 214, y: 123, vy: -4000 }),
  ];
  resolveProjectileStep(s, 1 / 120, h.env);
  assert.equal(s.enemies[0].parts.l, 0);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.enemies[0].hp, 20);
});

test('sky: a shield at time zero saves against later hull contact; a late shield cannot revive', () => {
  for (const early of [true, false]) {
    const h = harness(),
      s = createSkyState();
    s.spawnClock = 100;
    s.lives = 1;
    s.player.invincible = 0;
    s.enemies = [ship({ id: 2, x: 266.5, y: 270, vx: -100, hp: 2 })];
    s.pickups = [
      {
        id: 90,
        x: 240,
        y: early ? 270 : 320,
        vx: 0,
        vy: early ? 0 : -1000,
        kind: 'shield',
        life: 10,
      },
    ];
    stepSky(s, 1 / 120, input(), h.env);
    assert.equal(s.lives, early ? 1 : 0);
    assert.equal(s.phase, early ? 'playing' : 'lost');
    assert.equal(!!s.pickups[0]?.collected, false);
  }
});
test('sky: an earlier projectile kill prevents both a later hull impulse and collision damage', () => {
  const h = harness(),
    s = createSkyState();
  s.lives = 3;
  s.player.invincible = 0;
  s.spawnClock = 100;
  s.enemies = [ship({ id: 2, x: 266.5, y: 270, vx: -100, hp: 1 })];
  s.bullets = [round({ id: 10, x: 269.5, y: 280, vx: 0, vy: -330 })];
  stepSky(s, 1 / 120, input(), h.env);
  assert.equal(s.lives, 3);
  assert.equal(s.player.vx, 0);
  assert.equal(s.kills, 1);
});
test('sky: a hull contact before a projectile kill keeps its earlier impulse and damage', () => {
  const h = harness(),
    s = createSkyState();
  s.lives = 3;
  s.player.invincible = 0;
  s.enemies = [ship({ id: 2, x: 266.5, y: 270, vx: -100, hp: 1 })];
  s.bullets = [round({ id: 10, x: 269.5, y: 302, vx: 0, vy: -1000 })];
  resolveProjectileStep(s, 0.03, h.env, true);
  assert.equal(s.lives, 2);
  assert.ok(s.player.vx < 0);
  assert.equal(s.kills, 1);
});
test('sky: expiry clips projectile and supply contacts before their later geometric impact', () => {
  const h = harness(),
    s = createSkyState();
  s.lives = 2;
  s.player.invincible = 0;
  s.enemies = [ship({ id: 2, x: 240, y: 120 })];
  s.bullets = [round({ id: 10, x: 240, y: 133, vy: -1000, life: 0.001 })];
  s.pickups = [{ id: 90, x: 240, y: 295, vx: 0, vy: -1000, kind: 'shield', life: 0.001 }];
  resolveProjectileStep(s, 1 / 120, h.env);
  assert.equal(s.enemies[0].hp, 3);
  assert.equal(s.lives, 2);
  assert.equal(s.bullets.length, 0);
  assert.equal(!!s.pickups[0].collected, false);
});

test('sky: simultaneous turret and core impacts share one armor snapshot regardless of bullet order', () => {
  for (const reverse of [false, true]) {
    const h = harness(),
      s = createSkyState(),
      e = ship({
        id: 2,
        shape: 'carrier',
        x: 240,
        y: 100,
        boss: true,
        parts: { l: 1, r: 0 },
        hp: 20,
        maxHp: 20,
        open: true,
      });
    s.enemies = [e];
    s.bullets = ['l', 'c'].map((part, n) => {
      const r = hullRects(e).find((r) => r.part === part);
      return round({ id: 10 + n, x: r.x + r.w / 2, y: r.y + r.h / 2, vx: 0, vy: 0 });
    });
    if (reverse) s.bullets.reverse();
    resolveProjectileStep(s, 1 / 120, h.env);
    assert.equal(e.parts.l, 0);
    assert.equal(e.hp, 20);
    const r = hullRects(e).find((r) => r.part === 'c');
    s.bullets = [round({ id: 20, x: r.x + r.w / 2, y: r.y + r.h / 2, vx: 0, vy: 0 })];
    resolveProjectileStep(s, 1 / 120, h.env);
    assert.equal(e.hp, 19);
  }
});
test('sky: a wave arriving before the hostile round saves the pilot; a later wave cannot undo its hit', () => {
  for (const radius of [0, 17]) {
    const h = harness(),
      s = createSkyState();
    s.lives = 1;
    s.player.invincible = 0;
    s.bullets = [round({ id: 10, x: 240, y: 248, vy: 1000, owner: 'enemy', ownerId: 9 })];
    s.waves = [
      {
        id: 11,
        x: 240,
        y: 270,
        radius,
        speed: 420,
        maxRadius: 520,
        energy: 36,
        life: 1.3,
        hit: [],
      },
    ];
    resolveProjectileStep(s, 1 / 120, h.env);
    assert.equal(s.lives, radius ? 1 : 0);
    assert.equal(s.waves[0].energy, radius ? 35.8 : 36);
  }
});

test('sky: all six touch actions and sector instructions are usable in both languages', () => {
  assert.equal(meta.touchControls.length, 6);
  assert.equal(new Set(meta.touchControls.map((c) => c.code)).size, 6);
  for (const control of meta.touchControls) {
    assert.ok(control.label.en.length > 0);
    assert.match(control.label.zh, /\p{Script=Han}/u);
  }
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env);
    g.draw(mockContext());
    assert.ok(g.getState().status[lang].length > 0);
    assert.equal(g.getState().totalLevels, 6);
  }
});

test('sky: a third hull impulse preserves the earlier touching constraint without overlap or energy gain', () => {
  const h = harness(),
    s = createSkyState();
  s.player.x = 200;
  s.player.y = 200;
  s.player.vx = 160;
  s.player.vy = 0;
  s.enemies = [
    ship({ id: 2, x: 226.5, y: 200, vx: 0, hp: 2 }),
    ship({ id: 3, x: 250.5, y: 200, vx: 0, hp: 2 }),
  ];
  const fleet = [s.player, ...s.enemies],
    momentum = fleet.reduce((v, a) => v + a.mass * a.vx, 0),
    energy = fleet.reduce((v, a) => v + a.mass * a.vx ** 2, 0);
  resolveProjectileStep(s, 1 / 120, h.env, true);
  for (let i = 0; i < fleet.length; i++)
    for (let j = i + 1; j < fleet.length; j++)
      for (const a of hullRects(fleet[i]))
        for (const b of hullRects(fleet[j])) {
          const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
            overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          assert.ok(overlapX * overlapY < 1e-6);
        }
  assert.ok(s.player.vx <= s.enemies[0].vx + 1e-6);
  assert.ok(s.enemies[0].vx <= s.enemies[1].vx + 1e-6);
  assert.ok(Math.abs(fleet.reduce((v, a) => v + a.mass * a.vx, 0) - momentum) < 1e-6);
  assert.ok(fleet.reduce((v, a) => v + a.mass * a.vx ** 2, 0) <= energy);
});

test('sky: tangent separating or sliding rounds do not damage hulls; approaching and penetrating rounds do', () => {
  for (const [velocity, offset, expected] of [
    [100, 0, 3],
    [0, 0, 3],
    [-100, 0, 2],
    [100, -0.1, 2],
  ]) {
    const h = harness(),
      s = createSkyState();
    s.enemies = [ship({ id: 2, x: 240, y: 120 })];
    s.bullets = [
      round({ id: 10, x: 237, y: 131 + offset, r: 2, vx: velocity === 0 ? 100 : 0, vy: velocity }),
    ];
    resolveProjectileStep(s, 1 / 120, h.env);
    assert.equal(s.enemies[0].hp, expected);
  }
});
test('sky: tangent separating rounds remain live while approaching and penetrating rounds collide', () => {
  for (const [speed, gap, expected] of [
    [100, 4, 2],
    [-100, 4, 0],
    [100, 3.9, 0],
  ]) {
    const h = harness(),
      s = createSkyState();
    s.bullets = [
      round({ id: 10, x: 100, y: 200, vx: -speed, vy: 0, r: 2 }),
      round({ id: 11, x: 100 + gap, y: 200, vx: speed, vy: 0, r: 2, owner: 'enemy', ownerId: 9 }),
    ];
    resolveProjectileStep(s, 1 / 120, h.env);
    assert.equal(s.bullets.length, expected);
  }
});

test('sky: nonlethal inelastic hull impacts retain projectile mass and momentum without adding energy', () => {
  for (const reverse of [false, true]) {
    const h = harness(),
      s = createSkyState(),
      e = ship({ id: 2, x: 240, y: 120, vx: 0, vy: 0, mass: 60, hp: 10 });
    s.enemies = [e];
    const r = hullRects(e)[0];
    s.bullets = [
      round({ id: 10, x: r.x + r.w / 2, y: r.y + r.h / 2, vx: 15, vy: -330 }),
      round({ id: 11, x: r.x + r.w / 2, y: r.y + r.h / 2, vx: -25, vy: -280 }),
    ];
    if (reverse) s.bullets.reverse();
    const px = s.bullets.reduce((sum, b) => sum + b.mass * b.vx, 0),
      py = s.bullets.reduce((sum, b) => sum + b.mass * b.vy, 0),
      energy = s.bullets.reduce((sum, b) => sum + 0.5 * b.mass * (b.vx ** 2 + b.vy ** 2), 0);
    resolveProjectileStep(s, 1 / 120, h.env, true);
    assert.equal(e.hp, 8);
    assert.ok(Math.abs(e.mass - 60.08) < 1e-9);
    assert.ok(Math.abs(e.x - (240 + px / 60.08 / 120)) < 1e-8);
    assert.ok(Math.abs(e.y - (120 + py / 60.08 / 120)) < 1e-8);
    assert.ok(Math.abs(e.mass * e.vx - px) < 1e-8);
    assert.ok(Math.abs(e.mass * e.vy - py) < 1e-8);
    assert.ok(0.5 * e.mass * (e.vx ** 2 + e.vy ** 2) <= energy);
    assert.equal(s.bullets.length, 0);
  }
});
