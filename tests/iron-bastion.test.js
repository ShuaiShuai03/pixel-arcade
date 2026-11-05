import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, bulletHitsTile } from '../src/games/iron-bastion.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('Bastion shell has real radius at narrow brick gaps', () => {
  assert.equal(
    bulletHitsTile({ x: 227, y: 265 }, [
      { x: 204, y: 257, w: 22, h: 22 },
      { x: 228, y: 257, w: 22, h: 22 },
    ]),
    0,
  );
});
test('Bastion starts and stops through finite acceleration with opposing keys cancelling', () => {
  const game = createGame(harness().env),
    start = game.getState();
  game.update(1 / 120, input(['ArrowRight']));
  const next = game.getState();
  assert.ok(Number.isFinite(next.player.vx));
  assert.ok(Math.hypot(next.player.vx, next.player.vy) < 5);
  assert.ok(Math.hypot(next.player.x - start.player.x, next.player.y - start.player.y) < 0.1);
  const other = createGame(harness().env);
  other.update(1 / 30, input(['ArrowLeft', 'ArrowRight']));
  assert.equal(other.getState().player.x, start.player.x);
});
test('Bastion holds kits when no repair is needed and publishes every essential touch action', () => {
  const game = createGame(harness().env),
    before = game.getState();
  game.update(1 / 30, input([], ['KeyH']));
  assert.equal(game.getState().kits, before.kits);
  assert.ok(before.kits > 0);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX', 'KeyH'])
    assert.ok(meta.touchControls.some((c) => c.code === code && c.side));
});

const core = () => import('../src/games/iron-bastion.js');
function enemy(id, x, y, hp = 2) {
  return {
    id,
    x,
    y,
    r: 12,
    mass: 100,
    rounds: 120,
    vx: 0,
    vy: 0,
    angle: Math.PI / 2,
    omega: 0,
    turret: Math.PI / 2,
    turretOmega: 0,
    bearing: Math.PI / 2,
    role: 'raider',
    hp,
    cooldown: 999,
    charge: 0,
    aim: 0,
    think: 999,
    flash: 0,
    muzzle: 0,
  };
}
const shell = (id, x, y, vx, vy, extra = {}) => ({
  id,
  x,
  y,
  vx,
  vy,
  r: 2,
  mass: 0.02,
  owner: 'enemy',
  shooter: 'offscreen',
  life: 2,
  armed: true,
  ...extra,
});
async function empty() {
  const { createBastionState } = await core();
  const s = createBastionState();
  s.tiles = [];
  s.enemies = [];
  s.player.x = 100;
  s.player.y = 200;
  s.spawnClock = 999;
  return s;
}

test('Bastion circle sweep respects a rounded corner rather than an expanded-box false hit', async () => {
  const { sweepCircleRect } = await core();
  const t = sweepCircleRect(0, 0, 20, 20, 2, { x: 10, y: 10, w: 10, h: 10 });
  assert.ok(Math.abs(t - (10 - Math.sqrt(2)) / 20) < 1e-10);
  assert.equal(sweepCircleRect(0, 7.9, 20, 0, 2, { x: 10, y: 10, w: 10, h: 10 }), Infinity);
});
test('Bastion firing removes carried-round mass and conserves momentum in translated frames', async () => {
  const { fireShell } = await core();
  for (const velocity of [0, 100, -70]) {
    const s = await empty(),
      p = s.player;
    p.vx = velocity;
    p.vy = 35;
    p.turret = 0.4;
    const mass = p.mass,
      px = mass * p.vx,
      py = mass * p.vy;
    fireShell(s, p, 'player', harness().env);
    const b = s.bullets[0];
    assert.ok(Math.abs(p.mass + b.mass - mass) < 1e-10);
    assert.ok(Math.abs(p.mass * p.vx + b.mass * b.vx - px) < 1e-10);
    assert.ok(Math.abs(p.mass * p.vy + b.mass * b.vy - py) < 1e-10);
  }
});
test('Bastion a captured round adds mass, preserves momentum and cannot create passive kinetic energy', async () => {
  const { stepShells } = await core();
  for (const speed of [100, 160]) {
    const s = await empty(),
      p = s.player;
    p.vx = 100;
    const oldMass = p.mass,
      oldVelocity = p.vx;
    s.bullets = [shell('capture', p.x - 10, p.y, speed, 0)];
    const momentum = oldMass * oldVelocity + 0.02 * speed,
      energy = 0.5 * oldMass * oldVelocity ** 2 + 0.01 * speed ** 2;
    stepShells(s, 0.001, harness().env);
    assert.ok(Math.abs(p.mass - oldMass - 0.02) < 1e-10);
    assert.ok(Math.abs(p.mass * p.vx - momentum) < 1e-9);
    assert.ok(0.5 * p.mass * p.vx ** 2 <= energy + 1e-8);
    if (speed === 100) assert.equal(p.vx, 100);
  }
});
test('Bastion muzzle next to a wall cannot shoot through it', async () => {
  const { fireShell, stepShells } = await core(),
    s = await empty();
  s.player.x = 100;
  s.player.y = 150;
  s.player.turret = 0;
  s.tiles = [{ id: 'wall', x: 112, y: 130, w: 22, h: 40, hp: 2, steel: false }];
  fireShell(s, s.player, 'player', harness().env);
  stepShells(s, 1 / 60, harness().env);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.tiles[0].hp, 1);
});
test('Bastion fast shells hit nearest brick/steel geometry and expire before distant targets', async () => {
  const { stepShells } = await core(),
    s = await empty();
  s.tiles = [
    { id: 'steel', x: 160, y: 90, w: 22, h: 22, hp: null, steel: true },
    { id: 'brick', x: 100, y: 90, w: 22, h: 22, hp: 2, steel: false },
  ];
  s.bullets = [shell('fast', 60, 100, 20000, 0, { owner: 'player', shooter: 'player' })];
  stepShells(s, 1 / 30, harness().env);
  assert.equal(s.tiles.find((t) => t.id === 'brick').hp, 1);
  assert.equal(s.bullets.length, 0);
  s.bullets = [shell('short', 50, 200, 1000, 0, { life: 0.001 })];
  stepShells(s, 1 / 30, harness().env);
  assert.equal(s.lives, 4);
  assert.equal(s.bullets.length, 0);
});
test('Bastion inactive shells still stop at solids without becoming attacks', async () => {
  const { stepShells } = await core(),
    s = await empty();
  s.tiles = [{ id: 'brick', x: 150, y: 90, w: 22, h: 22, hp: 2, steel: false }];
  s.bullets = [shell('inert', 100, 100, 1000, 0, { armed: false })];
  stepShells(s, 0.1, harness().env);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.tiles[0].hp, 2);
});
test('Bastion passive solid tank contact preserves momentum without damaging armor', async () => {
  const { resolveTankContacts } = await core(),
    s = await empty();
  s.player.x = 100;
  s.player.y = 150;
  s.player.vx = 80;
  s.enemies = [enemy('A', 120, 150)];
  s.enemies[0].vx = -20;
  const before = s.player.mass * 80 + s.enemies[0].mass * -20,
    energy = 0.5 * s.player.mass * 80 ** 2 + 0.5 * s.enemies[0].mass * 20 ** 2;
  resolveTankContacts(s);
  assert.ok(
    Math.abs(s.player.mass * s.player.vx + s.enemies[0].mass * s.enemies[0].vx - before) < 1e-8,
  );
  assert.ok(
    0.5 * s.player.mass * s.player.vx ** 2 + 0.5 * s.enemies[0].mass * s.enemies[0].vx ** 2 <=
      energy + 1e-8,
  );
  assert.ok(Math.hypot(s.player.x - s.enemies[0].x, s.player.y - s.enemies[0].y) >= 24 - 1e-8);
  assert.equal(s.lives, 4);
});
test('Bastion simultaneous last-enemy and beacon impacts resolve all damage before one terminal result', async () => {
  const { stepShells } = await core();
  const results = [];
  for (const reverse of [false, true]) {
    const s = await empty();
    s.baseHealth = 1;
    s.enemies = [enemy('last', 200, 100, 1)];
    s.bullets = [
      shell('player-shot', 180, 100, 1000, 0, { owner: 'player', shooter: 'player' }),
      shell('base-shot', 240, 274, 0, 1000),
    ];
    if (reverse) s.bullets.reverse();
    let snapshot = null;
    const h = harness();
    h.env.end = () => {
      snapshot = structuredClone(s);
    };
    stepShells(s, 0.02, h.env);
    assert.equal(s.phase, 'lost');
    assert.equal(s.baseHealth, 0);
    assert.equal(s.enemies.length, 0);
    assert.deepEqual(s, snapshot);
    results.push({ score: s.score, defeated: s.defeated, base: s.baseHealth });
  }
  assert.deepEqual(results[0], results[1]);
});
test('Bastion tied brick damage and shell interception are order-independent', async () => {
  const { stepShells } = await core();
  const scores = [];
  for (const reverse of [false, true]) {
    const s = await empty();
    s.tiles = [{ id: 'brick', x: 100, y: 90, w: 22, h: 22, hp: 1, steel: false }];
    s.bullets = [
      shell('a', 80, 95, 1000, 0, { owner: 'player', shooter: 'player' }),
      shell('b', 80, 107, 1000, 0, { owner: 'player', shooter: 'player' }),
    ];
    if (reverse) s.bullets.reverse();
    stepShells(s, 0.03, harness().env);
    assert.equal(s.tiles.length, 0);
    assert.equal(s.score, 10);
    scores.push(s.score);
  }
  const s = await empty();
  s.bullets = [
    shell('left', 150, 120, 1000, 0, { owner: 'player', shooter: 'player' }),
    shell('right', 180, 120, -1000, 0),
  ];
  stepShells(s, 0.03, harness().env);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.interceptions, 1);
  assert.equal(s.score, 0);
});
test('Bastion repair covers tank, beacon, both and preserves full or out-of-range kits', async () => {
  const { stepBastion } = await core();
  for (const [armor, base, near, expectedArmor, expectedBase, spent] of [
    [4, 4, true, 4, 5, 1],
    [2, 5, false, 4, 5, 1],
    [2, 3, true, 4, 4, 1],
    [4, 5, true, 4, 5, 0],
    [4, 3, false, 4, 3, 0],
  ]) {
    const s = await empty();
    s.lives = armor;
    s.baseHealth = base;
    s.player.x = near ? 166 : 100;
    s.player.y = near ? 284 : 100;
    stepBastion(s, 1 / 120, input([], ['KeyH']), harness().env);
    assert.equal(s.lives, expectedArmor);
    assert.equal(s.baseHealth, expectedBase);
    assert.equal(s.kits, 2 - spent);
  }
});
test('Bastion reinforcement warnings cannot materialize a tank into an occupied lane', async () => {
  const { stepBastion } = await core(),
    s = await empty();
  s.player.x = 100;
  s.player.y = 60;
  s.pendingSpawn = { x: 100, y: 60, warning: 0.001, role: 'raider' };
  stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.enemies.length, 0);
  assert.ok(s.pendingSpawn.warning > 1);
  assert.notEqual(s.pendingSpawn.x, 100);
  for (let n = 0; n < 120; n++) stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.enemies.length, 0);
  for (let n = 0; n < 24; n++) stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.enemies.length, 1);
  assert.ok(Math.hypot(s.enemies[0].x - s.player.x, s.enemies[0].y - s.player.y) > 24);
});
test('Bastion engineers preserve tank position and retained-kit reachability', async () => {
  const { stepBastion, circleHitsRect } = await core(),
    s = await empty();
  s.player.x = 119;
  s.player.y = 147;
  s.transition = 0.001;
  s.clearing = true;
  s.kits = 0;
  s.pickups = [{ id: 'retained', x: 119, y: 147, kind: 'kit' }];
  const old = { x: s.player.x, y: s.player.y };
  stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.wave, 2);
  assert.equal(s.engineerCrates, 1);
  assert.ok(Math.hypot(s.player.x - old.x, s.player.y - old.y) < 1e-8);
  assert.ok(s.tiles.every((t) => !circleHitsRect(old.x, old.y, 12, t)));
  assert.ok(s.tiles.every((t) => !circleHitsRect(119, 147, 22, t)));
});
test('Bastion depletion of carried rounds has a visible terminal outcome instead of silent lost controls', async () => {
  const { stepBastion } = await core(),
    s = await empty();
  s.player.rounds = 0;
  const h = harness();
  stepBastion(s, 1 / 120, input(['Space']), h.env);
  assert.equal(s.phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /ammunition/i);
});

function keyboardGuard(state, frame, hz, started) {
  const p = state.player,
    target = state.enemies.toSorted((a, b) => b.y - a.y)[0],
    held = frame < hz * 0.8 ? ['ArrowRight'] : ['KeyX'];
  if (target && started && frame >= hz * 0.8) {
    const flight = Math.hypot(target.x - p.x, target.y - p.y) / 300,
      aim = Math.atan2(target.y + target.vy * flight - p.y, target.x + target.vx * flight - p.x),
      stop = p.turret + (p.turretOmega * Math.abs(p.turretOmega)) / 48,
      wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)),
      error = wrap(aim - stop);
    if (error > 0.025) held.push('ArrowRight');
    else if (error < -0.025) held.push('ArrowLeft');
    if (Math.abs(wrap(aim - p.turret)) < 0.065) held.push('Space');
  }
  return held;
}
test('Bastion complete keyboard-only three-field campaigns and missed-defense recovery at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120])
    for (const mistake of [false, true]) {
      const h = harness(),
        game = createGame(h.env);
      let started = !mistake,
        repaired = false,
        callbackState = null,
        lastWave = 1,
        transitions = 0;
      h.env.end = (r) => {
        h.ends.push(r);
        callbackState = game.getState();
      };
      for (let frame = 0; frame < hz * 180 && game.getState().phase === 'playing'; frame++) {
        const s = game.getState(),
          pressed = [];
        if (!started && (s.lives < 4 || s.baseHealth < 5)) {
          started = true;
          pressed.push('KeyH');
        }
        if (s.lives <= 2 || s.baseHealth <= 3) pressed.push('KeyH');
        game.update(1 / hz, input(keyboardGuard(s, frame, hz, started), pressed));
        const next = game.getState();
        if (next.kits < s.kits) repaired = true;
        assert.ok(
          Math.hypot(next.player.x - s.player.x, next.player.y - s.player.y) < 5,
          'no hit or engineering teleport',
        );
        assert.ok(
          next.enemies.length <= 3 && next.bullets.length < 80 && next.particles.length <= 120,
        );
        if (next.wave !== lastWave) {
          transitions++;
          lastWave = next.wave;
          assert.ok(next.player.rounds > 500);
        }
        if (frame % (hz * 10) === 0) game.draw(mockContext());
      }
      const s = game.getState();
      assert.equal(s.phase, 'won', `rate ${hz}, missed defense ${mistake}`);
      assert.equal(s.wave, 3);
      assert.equal(s.defeated, 15);
      assert.ok(s.player.x > 180);
      assert.ok(s.lives > 0 && s.baseHealth > 0);
      assert.equal(s.engineerCrates, 0);
      assert.equal(transitions, 2);
      assert.equal(h.ends.length, 1);
      assert.deepEqual(s, callbackState);
      if (mistake) assert.ok(repaired);
      const frozen = game.getState();
      game.update(1 / hz, input(['ArrowDown', 'Space'], ['KeyH']));
      assert.deepEqual(game.getState(), frozen);
    }
});
test('Bastion last live round resolves before depletion and can secure the final field or rearm the next', async () => {
  const { stepBastion } = await core();
  for (const wave of [1, 3]) {
    const s = await empty();
    s.wave = wave;
    s.spawned = s.toSpawn;
    s.player.rounds = 0;
    s.enemies = [enemy('last', 200, 100, 1)];
    s.bullets = [shell('final', 180, 100, 1000, 0, { owner: 'player', shooter: 'player' })];
    const h = harness();
    stepBastion(s, 1 / 30, input(), h.env);
    assert.notEqual(s.phase, 'lost');
    if (wave === 3) {
      assert.equal(s.phase, 'won');
      assert.equal(h.ends.length, 1);
    } else {
      assert.ok(s.transition > 0);
      for (let n = 0; n < 260; n++) stepBastion(s, 1 / 120, input(), h.env);
      assert.equal(s.wave, 2);
      assert.equal(s.player.rounds, 600);
      assert.equal(s.phase, 'playing');
    }
  }
  const miss = await empty();
  miss.player.rounds = 0;
  miss.bullets = [
    shell('miss', 100, 100, 100, 0, { owner: 'player', shooter: 'player', life: 0.02 }),
  ];
  const h = harness();
  stepBastion(miss, 1 / 120, input(), h.env);
  assert.equal(miss.phase, 'playing');
  stepBastion(miss, 1 / 30, input(), h.env);
  assert.equal(miss.phase, 'lost');
  assert.match(h.ends[0].message, /ammunition/i);
});
test('Bastion full stock exhausts finitely and engineer ammunition load conserves vehicle momentum', async () => {
  const { fireShell, stepBastion } = await core(),
    s = await empty();
  for (let n = 0; n < 700; n++) fireShell(s, s.player, 'player', harness().env);
  assert.equal(s.bullets.length, 600);
  assert.equal(s.player.rounds, 0);
  assert.ok(s.player.mass > 80);
  s.bullets = [];
  s.transition = 0.001;
  s.clearing = true;
  s.player.vx = 40;
  s.player.vy = 0;
  const oldX = s.player.x,
    oldMass = s.player.mass;
  stepBastion(s, 0.001, input(), harness().env);
  assert.equal(s.wave, 2);
  assert.equal(s.player.rounds, 600);
  assert.ok(s.player.mass > oldMass);
  const momentum = s.player.mass * s.player.vx;
  assert.ok(momentum <= oldMass * 40 + 1e-8);
  assert.ok(momentum >= oldMass * (40 - 260 * 0.001) - 1e-8);
  assert.ok(Math.abs(s.player.x - oldX) < 1);
});
test('Bastion ordinary steel-stop movement recovers through real steering without passive damage', () => {
  const game = createGame(harness().env);
  for (let n = 0; n < 120; n++) game.update(1 / 60, input(['ArrowUp', 'Space']));
  const stopped = game.getState();
  for (let n = 0; n < 60; n++) game.update(1 / 60, input(['ArrowRight']));
  const recovered = game.getState();
  assert.ok(recovered.player.x > stopped.player.x + 15);
  assert.equal(recovered.lives, 4);
  assert.equal(recovered.baseHealth, 5);
});
test('Bastion empty kit inventory can recover from floor supply and full packs leave it available', async () => {
  const { stepBastion } = await core(),
    s = await empty();
  s.kits = 0;
  s.lives = 2;
  s.pickups = [{ id: 'supply', x: 121.99, y: 200, kind: 'kit' }];
  stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.kits, 1);
  stepBastion(s, 1 / 120, input([], ['KeyH']), harness().env);
  assert.equal(s.lives, 4);
  assert.equal(s.kits, 0);
  s.kits = 3;
  s.pickups = [{ id: 'saved', x: s.player.x, y: s.player.y, kind: 'kit' }];
  stepBastion(s, 1 / 120, input(), harness().env);
  assert.equal(s.pickups.length, 1);
});
test('Bastion body-contact and shell outcomes do not depend on array order', async () => {
  const { resolveTankContacts, stepShells } = await core(),
    results = [];
  for (const reverse of [false, true]) {
    const s = await empty();
    s.player.x = 100;
    s.player.y = 150;
    s.player.vx = 100;
    s.enemies = [enemy('A', 120, 150), enemy('B', 140, 150)];
    s.enemies[0].vx = -20;
    s.enemies[1].vx = -10;
    if (reverse) s.enemies.reverse();
    resolveTankContacts(s);
    results.push(
      [s.player, ...s.enemies]
        .toSorted((a, b) => a.id.localeCompare(b.id))
        .map((a) => ({ id: a.id, x: a.x, y: a.y, vx: a.vx, vy: a.vy })),
    );
  }
  assert.deepEqual(results[0], results[1]);
  const outcome = [];
  for (const reverse of [false, true]) {
    const s = await empty();
    s.tiles = [
      { id: 'near', x: 100, y: 100, w: 22, h: 22, hp: 2, steel: false },
      { id: 'far', x: 160, y: 100, w: 22, h: 22, hp: 2, steel: false },
    ];
    if (reverse) s.tiles.reverse();
    s.bullets = [shell('shot', 50, 110, 10000, 0, { owner: 'player', shooter: 'player' })];
    stepShells(s, 0.02, harness().env);
    outcome.push(s.tiles.toSorted((a, b) => a.id.localeCompare(b.id)));
  }
  assert.deepEqual(outcome[0], outcome[1]);
});
test('Bastion driving/steering are frame-rate invariant and brake dissipates kinetic energy', async () => {
  const { stepBastion } = await core(),
    states = [];
  for (const hz of [30, 60, 120]) {
    const s = await empty();
    s.player.angle = 0;
    s.player.bearing = 0;
    s.player.turret = 0;
    for (let n = 0; n < hz; n++) stepBastion(s, 1 / hz, input(['ArrowRight']), harness().env);
    states.push(s);
  }
  for (const s of states) {
    assert.ok(Math.abs(s.player.x - states[0].player.x) < 1e-8);
    assert.ok(Math.abs(s.player.vx - states[0].player.vx) < 1e-8);
  }
  const s = states[0],
    energy = 0.5 * s.player.mass * (s.player.vx ** 2 + s.player.vy ** 2);
  stepBastion(s, 1 / 30, input(['KeyX']), harness().env);
  assert.ok(0.5 * s.player.mass * (s.player.vx ** 2 + s.player.vy ** 2) < energy);
});
test('Bastion actual idle losses, resets and terminal callbacks remain stable', () => {
  for (const hz of [30, 60, 120]) {
    const h = harness(),
      game = createGame(h.env);
    let callback = null;
    h.env.end = (r) => {
      h.ends.push(r);
      callback = game.getState();
    };
    for (let n = 0; n < hz * 180 && game.getState().phase === 'playing'; n++)
      game.update(1 / hz, input());
    assert.equal(game.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.deepEqual(game.getState(), callback);
    const final = game.getState();
    game.update(1 / hz, input(['Space'], ['KeyH']));
    assert.deepEqual(game.getState(), final);
    const fresh = createGame(h.env).getState();
    assert.equal(fresh.wave, 1);
    assert.equal(fresh.lives, 4);
    assert.equal(fresh.baseHealth, 5);
    assert.equal(fresh.player.rounds, 600);
    assert.equal(fresh.kits, 2);
  }
});
test('Bastion seeded public-input simulations are finite, deterministic and drawable in both languages', () => {
  const games = [createGame(harness({ seed: 19 }).env), createGame(harness({ seed: 19 }).env)],
    random = seeded(5);
  let held = [];
  const finite = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v));
    else if (v && typeof v === 'object') Object.values(v).forEach(finite);
  };
  for (let n = 0; n < 2400; n++) {
    if (n % 30 === 0)
      held = [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown'], ['KeyX']][
        Math.floor(random() * 5)
      ].concat(random() < 0.7 ? ['Space'] : []);
    for (const g of games) g.update(1 / 60, input(held, n % 240 === 0 ? ['KeyH'] : []));
    if (n % 120 === 0) {
      const a = games[0].getState();
      finite(a);
      assert.ok(a.enemies.length <= 3 && a.bullets.length < 100 && a.particles.length <= 120);
      assert.deepEqual(a, games[1].getState());
      games[0].draw(mockContext());
    }
  }
  createGame(harness({ lang: 'zh' }).env).draw(mockContext());
});
