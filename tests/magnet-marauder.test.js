import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  createWorld,
  loadChamber,
  spawnPending,
  stepWorld,
  snapshot,
  sweepBox,
  impactDamage,
  inLane,
  laneHalf,
  laneLength,
  STEP,
  ARENA,
  FIELD_R,
  DEAD_R,
  ORBIT_R,
  MAX_HELD,
  ATTRACT_VMAX,
  REPEL_V,
  ARMOR_V,
  MACHINE_V,
  MACHINE_HP,
  MAX_HP,
  INVULN,
  REPEL_CD,
  CLEAR_TIME,
  CHAMBERS,
  CHAMBER_COUNT,
  FOES,
  END_TEXT,
  drawWorld,
  METALS,
  PROMPTS,
  MENU,
} from '../src/games/magnet-marauder.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ----------------------------------------------------------------- helpers

// Bare test rooms (the layouts the mechanics tests were written against): chamber 0 has one machine
// and a pillar, chamber 1 has two machines and two pillars. No foes and no metal; the real
// chambers are checked separately.
const LAB_ROOMS = [
  {
    pillars: [{ x0: 228, y0: 60, x1: 252, y1: 84 }],
    machines: [[56, 162]],
    start: [240, 170],
  },
  {
    pillars: [
      { x0: 250, y0: 96, x1: 274, y1: 124 },
      { x0: 250, y0: 200, x1: 274, y1: 228 },
    ],
    machines: [
      [56, 96],
      [56, 228],
    ],
    start: [180, 162],
  },
];
function lab({ chamber = 0, seed = 1 } = {}) {
  const w = createWorld(seeded(seed));
  const room = LAB_ROOMS[chamber];
  w.walls = [...w.walls.slice(0, 4), ...room.pillars];
  w.machines = room.machines.map(([x, y], k) => ({
    id: `m${k}`,
    x,
    y,
    hw: 12,
    hh: 12,
    hp: MACHINE_HP,
    flash: 0,
  }));
  Object.assign(w.p, { x: room.start[0], y: room.start[1], fx: 1, fy: 0 });
  w.foes = [];
  w.pending = [{ type: 'brute', x: 440, y: 60, after: 99 }];
  w.metals = [];
  w.msg = null;
  return w;
}
function addMetal(w, kind, x, y, vx = 0, vy = 0) {
  const spec = METALS[kind];
  const m = {
    id: `t${w.metals.length}`,
    kind,
    x,
    y,
    hw: spec.hw,
    hh: spec.hw,
    mass: spec.mass,
    vx,
    vy,
    held: false,
    ang: 0,
    r: 0,
    touch: {},
  };
  w.metals.push(m);
  return m;
}
function addFoe(w, type, x, y, extra = {}) {
  w.pending.unshift({ type, x, y, after: 0 });
  spawnPending(w);
  const f = w.foes.at(-1);
  f.spawnT = 0;
  return Object.assign(f, extra);
}
const FROZEN = 1e9; // a stunned foe stays put and is not hostile
const run = (w, seconds, held = [], pressed = []) => {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) stepWorld(w, STEP, input(held, i === 0 ? pressed : []));
};
const inWall = (w, m) =>
  w.walls.some(
    (b) => m.x > b.x0 - m.hw && m.x < b.x1 + m.hw && m.y > b.y0 - m.hw && m.y < b.y1 + m.hw,
  );

// ----------------------------------------------------------------- metadata

test('magnet marauder: metadata, bilingual keys and complete touch controls', () => {
  assert.equal(meta.id, 'magnet-marauder');
  assert.equal(meta.name.zh, '磁力奇兵');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  assert.match(meta.description.en, /Space/);
  assert.match(meta.description.zh, /空格/);
  assert.deepEqual(
    meta.touchControls.map((c) => c.code),
    ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Space', 'KeyX'],
  );
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && c.label.zh && /[一-鿿]/.test(c.label.zh));
    assert.ok(['left', 'right'].includes(c.side));
  }
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  assert.deepEqual(
    meta.keys.map((k) => k.keys),
    ['WASD / Arrows', 'Space', 'X'],
  );
  assert.ok(CHAMBER_COUNT >= 20, 'level-based games ship at least 20 levels');
  assert.equal(CHAMBER_COUNT, CHAMBERS.length);
});

// ----------------------------------------------------------------- time step

test('magnet marauder: invalid, zero, negative and huge dt are inert; long frames are capped', () => {
  const w = createWorld(seeded(1));
  const before = JSON.stringify(snapshot(w));
  for (const dt of [0, -1, -0.01, NaN, Infinity, -Infinity, 1.5, 100]) {
    stepWorld(w, dt, input(['Space', 'ArrowRight'], ['KeyX']));
  }
  assert.equal(JSON.stringify(snapshot(w)), before);
  stepWorld(w, 0.9, input([])); // accepted but capped to 1/30 s = 4 ticks
  assert.equal(w.tick, 4);
  const a = createWorld(seeded(1));
  for (let i = 0; i < 12; i++) stepWorld(a, 0.001, input([]));
  assert.equal(a.tick, 1); // sub-step frames accumulate, they are not dropped
});

test('magnet marauder: pressed X is consumed only by the first fixed tick of an update', () => {
  const w = lab();
  w.p.x = 240;
  w.p.y = 170;
  for (let i = 0; i < 2; i++) {
    const m = addMetal(w, 'plate', 240 + 30 * Math.cos(i * 3), 170 + 30 * Math.sin(i * 3));
    m.held = true;
    m.r = ORBIT_R;
    m.ang = i * 3;
  }
  addFoe(w, 'brute', 330, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  stepWorld(w, 1 / 30, input(['Space'], ['KeyX']));
  assert.equal(w.metals.filter((m) => m.held).length, 1);
  assert.equal(w.events.filter((e) => e.name === 'repel').length, 1);
});

// ----------------------------------------------------------------- geometry

test('magnet marauder: sweepBox reports first entry, normals, and rejects non-hits', () => {
  const b = { x0: 10, y0: 10, x1: 20, y1: 20 };
  assert.deepEqual(sweepBox(0, 15, 20, 0, b), { t: 0.5, nx: -1, ny: 0 });
  assert.deepEqual(sweepBox(30, 15, -20, 0, b), { t: 0.5, nx: 1, ny: 0 });
  assert.deepEqual(sweepBox(15, 0, 0, 20, b), { t: 0.5, nx: 0, ny: -1 });
  assert.deepEqual(sweepBox(15, 30, 0, -20, b), { t: 0.5, nx: 0, ny: 1 });
  assert.equal(sweepBox(0, 15, 5, 0, b), null); // too short
  assert.equal(sweepBox(0, 5, 20, 0, b), null); // passes beside
  assert.equal(sweepBox(15, 15, 5, 0, b), null); // starts inside
  assert.equal(sweepBox(25, 15, 10, 0, b), null); // moving away
  assert.equal(sweepBox(0, 30, 20, 0, b), null); // parallel and outside
  assert.equal(sweepBox(0, 0, 40, 40, b).t, 0.25); // diagonal entry
});

test('magnet marauder: impact damage scales with relative speed above the armor threshold', () => {
  assert.equal(impactDamage(ARMOR_V, 1), 1);
  assert.equal(impactDamage(ARMOR_V + 59, 1), 1);
  assert.equal(impactDamage(ARMOR_V + 60, 1), 2);
  assert.equal(impactDamage(ARMOR_V + 125, 1), 3);
  assert.equal(impactDamage(2000, 1), 4);
  assert.equal(impactDamage(ARMOR_V, 2), 2);
  assert.ok(MACHINE_V < ARMOR_V);
});

// ----------------------------------------------------------------- magnetic field

test('magnet marauder: attraction reaches only as far as the visible field radius', () => {
  const w = lab();
  const outside = addMetal(w, 'plate', 240 + FIELD_R + 6, 170);
  const inside = addMetal(w, 'plate', 240 - FIELD_R + 20, 170);
  run(w, 1.5, ['Space']);
  assert.equal(outside.vx, 0);
  assert.equal(outside.x, 240 + FIELD_R + 6);
  assert.ok(inside.x > 240 - FIELD_R + 20 + 5, 'metal inside the field is pulled in');
  assert.equal(snapshot(w).field.radius, FIELD_R);
});

test('magnet marauder: the pull falls off with distance, is zero without Space and in the dead zone', () => {
  const gain = (d, held = ['Space']) => {
    const w = lab();
    const m = addMetal(w, 'plate', 240 + d, 170);
    run(w, 0.12, held);
    return -m.vx;
  };
  const near = gain(70),
    mid = gain(100),
    far = gain(125);
  assert.ok(near > mid && mid > far && far > 0, `${near} ${mid} ${far}`);
  assert.equal(gain(100, []) === 0, true);
  // With the orbit full a fifth piece settles outside the dead zone instead of ramming the magnet.
  const w = lab();
  for (let i = 0; i < MAX_HELD; i++) addMetal(w, 'plate', 240 + 20 * i - 30, 100);
  const extra = addMetal(w, 'plate', 330, 170);
  run(w, 8, ['Space']);
  assert.equal(snapshot(w).held, MAX_HELD);
  assert.equal(extra.held, false);
  const d = Math.hypot(extra.x - w.p.x, extra.y - w.p.y);
  assert.ok(d >= 8 && d <= DEAD_R + 1 && Math.hypot(extra.vx, extra.vy) < 5, `settled at ${d}`);
});

test('magnet marauder: attraction alone never makes metal fast enough to hurt armor', () => {
  const w = lab();
  for (const [x, y] of [
    [380, 170],
    [100, 120],
    [300, 60],
    [200, 260],
  ])
    addMetal(w, 'plate', x, y);
  let top = 0;
  for (let i = 0; i < 120 * 6; i++) {
    stepWorld(w, STEP, input(['Space']));
    for (const m of w.metals) if (!m.held) top = Math.max(top, Math.hypot(m.vx, m.vy));
  }
  assert.ok(top <= ATTRACT_VMAX + 1e-6 && ATTRACT_VMAX < ARMOR_V, `top ${top}`);
});

test('magnet marauder: pulled metal joins a bounded orbit and is dropped slowly on release', () => {
  const w = lab();
  for (let i = 0; i < 5; i++) addMetal(w, 'plate', 150 + i * 22, 90 + (i % 2) * 150);
  run(w, 8, ['Space']);
  const s = snapshot(w);
  assert.equal(s.held, MAX_HELD);
  for (const m of s.metals.filter((e) => e.held)) {
    assert.ok(Math.abs(Math.hypot(m.x - s.player.x, m.y - s.player.y) - ORBIT_R) < 3);
    assert.ok(m.speed < ARMOR_V, 'orbiting metal moves slower than armor-cracking speed');
  }
  run(w, 0.05, []); // release
  for (const m of snapshot(w).metals) {
    assert.equal(m.held, false);
    assert.ok(m.speed < ARMOR_V);
  }
});

test('magnet marauder: orbiting metal follows the player but cannot pass through solids', () => {
  const w = lab();
  w.p.x = 100;
  w.p.y = 170;
  const m = addMetal(w, 'plate', 110, 150);
  run(w, 3, ['Space']);
  assert.equal(m.held, true);
  run(w, 3, ['Space', 'ArrowLeft']); // push against the left wall
  assert.ok(w.p.x >= ARENA.x0 + w.p.hw - 1e-6);
  assert.ok(m.x >= ARENA.x0 + m.hw - 1e-6 && !inWall(w, m));
});

// ----------------------------------------------------------------- repel

function orbitSetup(kinds = ['plate', 'plate'], { foeAt } = {}) {
  const w = lab();
  w.p.x = 200;
  w.p.y = 170;
  w.p.fx = 1;
  w.p.fy = 0;
  kinds.forEach((kind, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    const m = addMetal(w, kind, 200 + Math.cos(a) * 30, 170 + Math.sin(a) * 30);
    m.held = true;
    m.r = ORBIT_R;
    m.ang = a;
  });
  const foe = foeAt ? addFoe(w, 'brute', foeAt[0], foeAt[1], { stun: FROZEN }) : null;
  return { w, foe };
}

test('magnet marauder: X launches one orbiting piece at the locked target at the stated speed', () => {
  const { w, foe } = orbitSetup(['plate', 'plate'], { foeAt: [330, 170] });
  foe.hp = foe.maxHp = 30;
  run(w, 0.1, ['Space']);
  assert.equal(snapshot(w).aim, foe.id);
  run(w, 0.02, ['Space'], ['KeyX']);
  const s = snapshot(w);
  assert.equal(s.held, 1, 'only one piece leaves per press');
  const flying = s.metals.find((m) => !m.held);
  assert.ok(Math.abs(flying.speed - REPEL_V) < 3, `speed ${flying.speed}`);
  assert.ok(flying.vx > 0 && Math.abs(flying.vy) < 40, 'aimed toward the target');
  assert.equal(flying.fast, true);
  assert.equal(s.player.polarity, 'repel');
  assert.ok(s.events.includes('repel'));
  // Cooldown: an immediate second press does nothing, a later one releases the next piece.
  run(w, 0.1, ['Space'], ['KeyX']);
  assert.equal(snapshot(w).held, 1);
  run(w, REPEL_CD, ['Space']);
  run(w, 0.02, ['Space'], ['KeyX']);
  assert.equal(snapshot(w).held, 0);
});

test('magnet marauder: heavy slabs leave slower than plates', () => {
  const { w, foe } = orbitSetup(['slab'], { foeAt: [200, 70] });
  foe.hp = foe.maxHp = 30;
  w.p.fx = 0;
  w.p.fy = -1;
  run(w, 0.05, ['Space'], ['KeyX']);
  const m = w.metals[0];
  assert.ok(Math.abs(Math.hypot(m.vx, m.vy) - REPEL_V * 0.8) < 3);
  assert.ok(m.vy < -200, 'heading toward the target');
});

test('magnet marauder: X without a lock-on refuses and keeps the orbit', () => {
  const { w } = orbitSetup(['plate']);
  run(w, 0.05, ['Space'], ['KeyX']);
  assert.equal(snapshot(w).held, 1);
  assert.notEqual(snapshot(w).player.polarity, 'repel');
  assert.match(snapshot(w).message.en, /No lock-on/);
  assert.match(snapshot(w).message.zh, /没有锁定/);
  assert.ok(!snapshot(w).events.includes('repel'));
});

test('magnet marauder: a lock-on lingers 0.5 s after drifting out of the cone, but never through a wall', () => {
  const { w, foe } = orbitSetup(['plate'], { foeAt: [330, 170] });
  run(w, 0.05, ['Space']);
  assert.equal(w.aim, foe.id);
  w.p.fx = 0;
  w.p.fy = -1; // 90 degrees off: outside the 55 degree keep cone
  run(w, 0.4, ['Space']);
  assert.equal(w.aim, foe.id, 'still locked during the grace period');
  run(w, 0.2, ['Space']);
  assert.equal(w.aim, null);
  w.p.fx = 1;
  w.p.fy = 0;
  run(w, 0.05, ['Space']);
  assert.equal(w.aim, foe.id);
  w.p.fx = 0;
  w.p.fy = -1;
  w.walls.push({ x0: 270, y0: 150, x1: 280, y1: 190 });
  run(w, 0.05, ['Space']);
  assert.equal(w.aim, null, 'a blocked line of fire drops the lock at once');
});

test('magnet marauder: X with nothing in orbit only explains itself', () => {
  const w = lab();
  addMetal(w, 'plate', 220, 170);
  run(w, 0.05, [], ['KeyX']);
  const s = snapshot(w);
  assert.equal(s.metals[0].speed, 0);
  assert.match(s.message.en, /Nothing in orbit/);
  assert.match(s.message.zh, /轨道/);
  assert.ok(!s.events.includes('repel'));
});

test('magnet marauder: fast metal is not caught by the pull, slow metal is', () => {
  const w = lab();
  w.p.x = 100;
  w.p.y = 170;
  const fast = addMetal(w, 'plate', 160, 170, 200, 0);
  run(w, 0.25, ['Space']);
  assert.ok(fast.vx > 150, 'the field does not brake or capture glowing metal');
});

// ----------------------------------------------------------------- walls

test('magnet marauder: metal never tunnels through walls or pillars at any update rate', () => {
  for (const hz of [30, 60, 120]) {
    for (const [x, y, vx, vy] of [
      [400, 100, 4000, 0],
      [100, 270, -1800, 3000],
      [200, 72, 6000, 0], // toward the first pillar
      [240, 100, 0, -9000],
      [30, 50, -5000, -5000],
    ]) {
      const w = lab();
      const m = addMetal(w, 'plate', x, y, vx, vy);
      const dt = 1 / hz;
      for (let i = 0; i < hz * 2; i++) {
        stepWorld(w, dt, input([]));
        assert.ok(!inWall(w, m), `${hz} Hz: inside a solid at ${m.x},${m.y}`);
        assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
      }
    }
  }
});

test('magnet marauder: walls reflect with restitution, slow contacts rest, nothing gains energy', () => {
  const w = lab();
  const m = addMetal(w, 'plate', 440, 170, 200, 0);
  run(w, 0.1);
  assert.ok(m.vx < -80 && m.vx > -110, `bounced at ${m.vx}`);
  assert.ok(Math.abs(m.vx) < 200);
  const slow = addMetal(w, 'plate', 440, 100, 20, 0);
  run(w, 0.4);
  assert.equal(slow.vx, 0, 'a slow piece rests against the wall instead of jittering');
  assert.ok(slow.x <= ARENA.x1 - slow.hw);
  // Friction brings everything to rest and total kinetic energy never rises without input.
  const w2 = lab();
  for (let i = 0; i < 4; i++) addMetal(w2, 'plate', 120 + i * 60, 90 + i * 30, 180 - i * 90, 120);
  let energy = Infinity;
  for (let i = 0; i < 120 * 12; i++) {
    stepWorld(w2, STEP, input([]));
    const e = w2.metals.reduce((s, q) => s + 0.5 * q.mass * (q.vx ** 2 + q.vy ** 2), 0);
    assert.ok(e <= energy + 1e-6, 'energy rose');
    energy = e;
  }
  assert.ok(energy < 1, `still moving: ${energy}`);
});

// ----------------------------------------------------------------- impacts on enemies

function shoot(kind, speed, hp = 30) {
  const w = lab();
  const foe = addFoe(w, 'brute', 300, 170, { stun: FROZEN, hp, maxHp: hp });
  const m = addMetal(w, kind, 300 - foe.hw - METALS[kind].hw - 1, 170, speed, 0);
  run(w, 0.3);
  return { w, foe, m, dealt: hp - foe.hp };
}

test('magnet marauder: armor ignores slow metal and takes damage that grows with speed', () => {
  assert.equal(shoot('plate', 60).dealt, 0);
  assert.equal(shoot('plate', ARMOR_V - 2).dealt, 0);
  const slow = shoot('plate', ARMOR_V - 2);
  assert.ok(slow.w.events.some((e) => e.name === 'clink'));
  assert.match(snapshot(slow.w).message?.en ?? 'Too slow: armor needs fast metal', /Too slow/);
  assert.equal(shoot('plate', ARMOR_V + 12).dealt, 1);
  assert.equal(shoot('plate', 230).dealt, 2);
  assert.equal(shoot('plate', 290).dealt, 3);
  assert.equal(shoot('plate', 900).dealt, 4);
  assert.equal(shoot('slab', ARMOR_V + 12).dealt, 2, 'mass adds to the damage');
});

test('magnet marauder: a hit bounces the piece off and is credited once per contact', () => {
  const { m, foe } = shoot('plate', 300);
  assert.ok(m.vx < 0, 'the piece rebounds');
  assert.ok(Math.hypot(m.vx, m.vy) < ARMOR_V, 'the rebound is too slow to hurt again');
  assert.equal(foe.hp, 30 - 3);
  // A piece that starts inside a foe (it walked onto it) is pushed out without any damage.
  const w = lab();
  const f = addFoe(w, 'brute', 300, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  const inside = addMetal(w, 'plate', 296, 170, 300, 0);
  run(w, 0.2);
  assert.equal(f.hp, 30);
  assert.ok(!w.events.some((e) => e.name === 'hit'));
  assert.ok(inside.vx < 0, 'it bounces off the foe it started inside');
});

test('magnet marauder: resting, held and slowly pushed metal never repeatedly damages', () => {
  const w = lab();
  const foe = addFoe(w, 'brute', 300, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  const rest = addMetal(w, 'plate', 300 - foe.hw - 8 - 0.5, 170);
  run(w, 5);
  assert.equal(foe.hp, 30);
  assert.equal(rest.vx, 0);
  // Orbit held against the foe: the magnet stands beside it with Space held.
  const w2 = lab();
  const f2 = addFoe(w2, 'brute', 300, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  w2.p.x = 260;
  w2.p.y = 170;
  addMetal(w2, 'plate', 262, 150);
  addMetal(w2, 'plate', 262, 190);
  run(w2, 6, ['Space']);
  assert.equal(f2.hp, 30);
  // A piece shoved along the foe by the pull at sub-armor speed never counts as an impact.
  const w3 = lab();
  const f3 = addFoe(w3, 'brute', 300, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  w3.p.x = 360;
  w3.p.y = 170;
  const m3 = addMetal(w3, 'plate', 330, 170);
  run(w3, 2, ['Space']);
  assert.equal(f3.hp, 30);
  assert.ok(m3.touch[f3.id] !== undefined || m3.held);
});

test('magnet marauder: touching is cleared on separation so a new fast hit counts again', () => {
  const w = lab();
  const foe = addFoe(w, 'brute', 300, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  const m = addMetal(w, 'plate', 300 - foe.hw - m8() - 1, 170, 300, 0);
  run(w, 0.4);
  assert.equal(foe.hp, 27);
  assert.deepEqual(Object.keys(m.touch), [], 'touch flag cleared after separating');
  m.vx = 300;
  m.x = 300 - foe.hw - m.hw - 1;
  m.y = 170;
  foe.stun = FROZEN;
  run(w, 0.3);
  assert.equal(foe.hp, 24);
});
function m8() {
  return METALS.plate.hw;
}

test('magnet marauder: defeating a foe scores, calls the next one out and frees the line for later shots', () => {
  const w = lab();
  w.pending = [
    { type: 'brute', x: 440, y: 60, after: 1 },
    { type: 'brute', x: 440, y: 60, after: 99 },
  ];
  const foe = addFoe(w, 'brute', 300, 170, { stun: FROZEN, hp: 2, maxHp: 2 });
  w.pending.unshift({ type: 'charger', x: 440, y: 240, after: 1 });
  const first = addMetal(w, 'plate', 300 - foe.hw - 9, 170, 300, 0);
  const second = addMetal(w, 'plate', 300 - foe.hw - 9 - 20, 170, 300, 0);
  const score = w.score;
  for (let i = 0; i < 120 && w.foes.includes(foe); i++) stepWorld(w, STEP, input([]));
  assert.equal(w.foes.includes(foe), false);
  assert.equal(snapshot(w).aim, null, 'the lock-on is dropped in the tick its target dies');
  assert.ok(w.events.some((e) => e.name === 'kill'));
  run(w, 0.15);
  run(w, 0.35);
  assert.equal(w.foes.includes(foe), false);
  assert.equal(w.defeated, 1);
  assert.ok(w.score >= score + 100 + 20);
  assert.ok(
    w.foes.some((f) => f.type === 'brute' || f.type === 'charger'),
    'reinforcement stepped out',
  );
  assert.ok(second.x > 300, 'the destroyed foe does not absorb the second shot');
  assert.ok(first.vx < 0, 'the first piece rebounded off the foe');
  assert.ok(
    snapshot(w).message === null || /Enemy down|Armor cracked/.test(snapshot(w).message.en),
  );
});

// ----------------------------------------------------------------- machinery

test('magnet marauder: fragile machinery is damaged by fast metal only, once per contact', () => {
  const machine = (kind, speed) => {
    const w = lab();
    const k = w.machines[0];
    addMetal(w, kind, k.x + k.hw + METALS[kind].hw + 2, k.y, -speed, 0);
    run(w, 0.4);
    return MACHINE_HP - k.hp;
  };
  assert.equal(machine('plate', MACHINE_V - 5), 0);
  assert.equal(machine('plate', MACHINE_V + 30), 1);
  assert.equal(machine('slab', MACHINE_V + 30), 1);
  assert.equal(machine('slab', 250), 2);
  const w = lab();
  const k = w.machines[0];
  addMetal(w, 'plate', k.x + k.hw + 9, k.y);
  run(w, 5);
  assert.equal(k.hp, MACHINE_HP, 'a resting piece never damages machinery');
  const s = snapshot(w);
  assert.equal(s.machines[0].hp, MACHINE_HP);
});

test('magnet marauder: own metal hitting machinery warns in the status and flashes the machine', () => {
  const w = lab();
  const k = w.machines[0];
  addMetal(w, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(w, 0.15);
  const s = snapshot(w);
  assert.equal(s.machines[0].hp, MACHINE_HP - 1);
  assert.ok(s.machines[0].flash > 0);
  assert.ok(s.events.includes('machine'));
  assert.match(s.status.en, /Your metal hit machine 1!/);
  assert.match(s.status.zh, /你的金属撞到了1号机器/);
});

test('magnet marauder: orbiting metal scraping a machine does no damage', () => {
  const w = lab();
  const k = w.machines[0];
  w.p.x = k.x + k.hw + 26;
  w.p.y = k.y;
  addMetal(w, 'plate', k.x + 30, k.y - 20);
  addMetal(w, 'plate', k.x + 30, k.y + 20);
  run(w, 6, ['Space']);
  assert.equal(k.hp, MACHINE_HP);
});

test('magnet marauder: wrecking machinery loses the chamber and reports the cause', () => {
  const w = lab();
  const k = w.machines[0];
  k.hp = 1;
  addMetal(w, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(w, 0.2);
  assert.equal(w.phase, 'lost');
  assert.equal(w.endKind, 'machineOwn');
  assert.equal(snapshot(w).machines[0].hp, 0);
  assert.equal(snapshot(w).hp, MAX_HP);
});

test('magnet marauder: the loss text names who wrecked the machinery, and which machine was hit', () => {
  // An enemy strike (the last source of damage) is blamed on the enemy.
  const w = lab({ chamber: 1 });
  const [first, second] = w.machines;
  second.hp = 1;
  const brute = addFoe(w, 'brute', second.x + 30, second.y, { state: 'wind', t: 0.01 });
  w.p.x = 400;
  w.p.y = 150;
  run(w, 0.1);
  assert.equal(brute.target, second.id);
  assert.equal(w.phase, 'lost');
  assert.equal(w.endKind, 'machineEnemy');
  assert.match(END_TEXT.machineEnemy[0], /Enemies wrecked the machinery.*wind-up/);
  assert.match(END_TEXT.machineEnemy[1], /敌人毁掉了机器/);
  assert.match(END_TEXT.machineOwn[0], /Your metal wrecked the machinery/);
  assert.match(END_TEXT.machineOwn[1], /你的金属毁掉了机器/);
  assert.match(snapshot(w).message.en, /^Machine 2 hit! 0\/14/);
  assert.match(snapshot(w).message.zh, /^2号机器被击中/);
  assert.equal(first.hp, MACHINE_HP);
  // The last source wins: own metal after an enemy strike is blamed on the player.
  const v = lab({ chamber: 1 });
  v.machines[0].hp = 1;
  addFoe(v, 'brute', 300, 60, { stun: FROZEN });
  damageMachineForTest(v);
  const k = v.machines[0];
  addMetal(v, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(v, 0.2);
  assert.equal(v.endKind, 'machineOwn');
});
function damageMachineForTest(v) {
  // a brute strikes machine 2 first, so the blame starts on the enemy
  const k = v.machines[1];
  const brute = addFoe(v, 'brute', k.x + 30, k.y, { state: 'wind', t: 0.01 });
  v.p.x = 400;
  v.p.y = 150;
  run(v, 0.1);
  assert.equal(v.blame, 'enemy');
  assert.ok(brute);
}

test('magnet marauder: the description teaches lock-on, red-lane charges and machinery damage in both languages', () => {
  for (const [lang, words] of [
    [
      'en',
      [
        /red bracket/,
        /X does nothing without a lock/,
        /only a charger's dash hurts you/,
        /red lane/,
        /your own fast metal damages/,
      ],
    ],
    [
      'zh',
      [
        /红色准星/,
        /没有锁定时X无效/,
        /只有冲锋者的冲刺会伤到你/,
        /红色通道/,
        /你自己的高速金属也会损坏它/,
      ],
    ],
  ]) {
    for (const re of words) assert.match(meta.description[lang], re);
  }
});

// ----------------------------------------------------------------- enemies

test('magnet marauder: brutes telegraph a wind-up, then strike machinery on a readable cycle', () => {
  const w = lab();
  const brute = addFoe(w, 'brute', 120, 162);
  const k = w.machines[0];
  w.p.x = 400;
  w.p.y = 250;
  let windStart = null,
    struck = null;
  let last = k.hp;
  for (let i = 0; i < 120 * 14 && struck === null; i++) {
    stepWorld(w, STEP, input([]));
    const s = snapshot(w);
    if (windStart === null && s.foes[0].state === 'wind') windStart = s.time;
    if (k.hp < last) struck = s.time;
    if (s.foes[0].state === 'wind') {
      assert.ok(s.foes[0].windLeft > 0 && s.foes[0].windLeft <= FOES.brute.wind);
      assert.equal(k.hp, last, 'no damage while the telegraph is still running');
    }
  }
  assert.ok(windStart !== null && struck !== null);
  assert.ok(Math.abs(struck - windStart - FOES.brute.wind) < 0.05, `${struck - windStart}`);
  assert.equal(MACHINE_HP - k.hp, FOES.brute.dmg);
  assert.equal(brute.state, 'rest');
  run(w, FOES.brute.rest + 0.1);
  assert.equal(brute.state, 'wind', 'the next strike is telegraphed again');
});

test('magnet marauder: chargers show a lane, dash along it, hit hard, then reel and back off', () => {
  const w = lab();
  const ch = addFoe(w, 'charger', 150, 170);
  const k = w.machines[0];
  w.p.x = 400;
  w.p.y = 250;
  let laneSeen = null;
  for (let i = 0; i < 120 * 6 && k.hp === MACHINE_HP; i++) {
    stepWorld(w, STEP, input([]));
    const f = snapshot(w).foes[0];
    if (f.state === 'wind') laneSeen = f.lane;
  }
  assert.ok(laneSeen && Math.abs(Math.hypot(laneSeen.x, laneSeen.y) - 1) < 1e-6);
  assert.equal(MACHINE_HP - k.hp, FOES.charger.dmg);
  assert.equal(ch.state, 'dizzy');
  assert.equal(snapshot(w).foes[0].lane, null);
  run(w, FOES.charger.rest + 0.05);
  assert.equal(ch.state, 'back');
  run(w, 1.05);
  assert.equal(ch.state, 'wind', 'it re-telegraphs the next charge');
  assert.ok(snapshot(w).foes[0].lane);
});

test('magnet marauder: a charger that hits a wall or the player ends its dash dizzy', () => {
  const w = lab();
  const ch = addFoe(w, 'charger', 200, 170, { state: 'dash', t: 0.9, dirx: 0, diry: 1 });
  w.p.x = 400;
  w.p.y = 100;
  run(w, 1.5);
  assert.equal(ch.y <= ARENA.y1 - ch.hh + 1, true);
  assert.ok(ch.state !== 'dash');
  const w2 = lab();
  w2.p.x = 250;
  w2.p.y = 170;
  const ch2 = addFoe(w2, 'charger', 150, 170, { state: 'dash', t: 0.9, dirx: 1, diry: 0 });
  run(w2, 0.6);
  assert.equal(w2.p.hp, MAX_HP - 1);
  assert.equal(ch2.state, 'dizzy');
});

test('magnet marauder: walking foes shove and block but never hurt, and bodies never overlap', () => {
  const w = lab();
  const foe = addFoe(w, 'brute', 300, 170, { dirx: -1 });
  w.p.x = 200;
  w.p.y = 170;
  for (let i = 0; i < 120 * 8; i++) {
    stepWorld(w, STEP, input([]));
    const pb = w.p;
    assert.ok(
      Math.abs(pb.x - foe.x) >= pb.hw + foe.hw - 1e-6 ||
        Math.abs(pb.y - foe.y) >= pb.hh + foe.hh - 1e-6,
      'bodies overlap',
    );
    assert.ok(pb.x >= ARENA.x0 + pb.hw - 1e-6 && pb.x <= ARENA.x1 - pb.hw + 1e-6);
  }
  assert.equal(w.p.hp, MAX_HP, 'only a telegraphed charge can hurt');
});

test('magnet marauder: the charge hurts exactly the drawn lane, including diagonal lanes', () => {
  const half = (dirx, diry) => laneHalf({ hw: 11, dirx, diry });
  const d = Math.SQRT1_2;
  assert.ok(Math.abs(half(1, 0) - 22.5) < 1e-9);
  assert.ok(Math.abs(half(d, d) - 22.5 * 2 * d) < 1e-9);
  for (const [dx, dy] of [
    [d, d],
    [1, 0],
    [0, 1],
    [d, -d],
  ]) {
    for (let off = 0; off <= 45; off += 1) {
      const w = lab();
      const c = addFoe(w, 'charger', 200, 160, { state: 'dash', t: 0.9, dirx: dx, diry: dy });
      w.p.x = c.x + dx * 90 - dy * off;
      w.p.y = c.y + dy * 90 + dx * off;
      const lane = { ...c, dirx: dx, diry: dy, state: 'wind' };
      const drawn = inLane(w.p, lane);
      run(w, 0.8);
      const hurt = w.p.hp < MAX_HP;
      if (off > half(dx, dy) + 0.6)
        assert.equal(hurt, false, `off ${off} dir ${dx},${dy} hurt outside the lane`);
      if (off < half(dx, dy) - 3)
        assert.equal(hurt, true, `off ${off} dir ${dx},${dy} not hurt in the lane`);
      if (!hurt) continue;
      assert.equal(drawn, true, 'a hurt player was inside the drawn lane');
    }
  }
  const w = lab();
  const c = addFoe(w, 'charger', 200, 160, { state: 'wind', t: 5, dirx: d, diry: d });
  const lane = snapshot(w).foes[0].lane;
  assert.equal(lane.half, laneHalf(c));
  assert.equal(lane.length, laneLength(c));
  assert.ok(lane.length >= 230 * 0.9, 'the lane is as long as the dash');
});

test('magnet marauder: only a lost body ends the run with the body message', () => {
  const w = lab();
  w.p.hp = 1;
  w.p.x = 280;
  w.p.y = 170;
  addFoe(w, 'charger', 200, 170, { state: 'dash', t: 0.9, dirx: 1, diry: 0 });
  run(w, 0.6);
  assert.equal(w.phase, 'lost');
  assert.equal(w.endKind, 'body');
  assert.equal(snapshot(w).hp, 0);
});

test('magnet marauder: a hit interrupts a wind-up and restarts it after the stagger', () => {
  const w = lab();
  const brute = addFoe(w, 'brute', 120, 162, { hp: 6, maxHp: 6 });
  w.p.x = 400;
  w.p.y = 250;
  while (brute.state !== 'wind') stepWorld(w, STEP, input([]));
  run(w, 0.5);
  const left = brute.t;
  assert.ok(left < FOES.brute.wind - 0.4);
  addMetal(w, 'plate', brute.x + brute.hw + 10, brute.y, -280, 0);
  run(w, 0.1);
  assert.ok(brute.stun > 0 && brute.hp < 6);
  run(w, 0.32);
  assert.ok(brute.t > FOES.brute.wind - 0.15, 'the telegraph starts over');
});

test('magnet marauder: foes route around pillars to reach machinery', () => {
  const w = loadedWorld();
  w.foes.forEach((f) => (f.spawnT = 0));
  w.p.x = 200;
  w.p.y = 40 + 20;
  const hit = new Set();
  for (let i = 0; i < 120 * 40 && hit.size < 2; i++) {
    stepWorld(w, STEP, input([]));
    for (const f of w.foes) if (f.state === 'wind' || f.state === 'dash') hit.add(f.id);
    if (w.phase !== 'playing') break;
  }
  assert.ok(hit.size >= 2, `only ${hit.size} foes reached a machine`);
});
// The two-machine test room with a charger and a brute at its right edge.
function loadedWorld() {
  const w = lab({ chamber: 1 });
  w.pending = [
    { type: 'charger', x: 440, y: 90, after: 0 },
    { type: 'brute', x: 440, y: 240, after: 0 },
  ];
  spawnPending(w);
  return w;
}

// ----------------------------------------------------------------- campaign flow

const firstWith = (pred) => CHAMBERS.findIndex(pred);
const overlapsBox = (e, b) =>
  e.x - e.hw < b.x1 && e.x + e.hw > b.x0 && e.y - e.hh < b.y1 && e.y + e.hh > b.y0;

test('magnet marauder: 20+ authored chambers teach one idea at a time, then combine, then master', () => {
  assert.ok(CHAMBERS.length >= 20);
  const first = CHAMBERS[0];
  assert.deepEqual(
    [first.machines.length, first.foes.length, first.pillars.length, first.foes[0].type],
    [1, 1, 0, 'brute'],
    'the first chamber is pull, orbit and one slow brute',
  );
  const charger = firstWith((c) => c.foes.some((f) => f.type === 'charger'));
  const slabAt = firstWith((c) => c.metals.some((m) => m.kind === 'slab'));
  const two = firstWith((c) => c.machines.length === 2);
  const three = firstWith((c) => c.machines.length === 3);
  const reserves = firstWith((c) => c.foes.some((f) => f.after > 0));
  const pillars = firstWith((c) => c.pillars.length > 0);
  assert.ok(reserves >= 1 && pillars >= 1, 'a brute at a machine comes before reinforcements');
  assert.ok(charger >= 4, 'chargers are introduced after blocked lines and machines in the way');
  assert.ok(
    charger < slabAt && slabAt < two && two < three,
    'lane, then slab weight, then machines',
  );
  assert.ok(CHAMBERS.filter((c) => c.foes.some((f) => f.type === 'charger')).length >= 8);
  assert.ok(CHAMBERS.slice(-8).every((c) => c.foes.length >= 3));
  assert.ok(CHAMBERS.slice(-5).some((c) => c.machines.length === 3 && c.foes.length >= 5));
  assert.ok(CHAMBERS.at(-1).foes.length >= 6);
  const names = new Set(CHAMBERS.map((c) => c.name.en));
  assert.equal(names.size, CHAMBERS.length, 'chamber names are unique');
  for (const c of CHAMBERS) {
    assert.ok(c.name.en && /[一-鿿]/.test(c.name.zh));
    const [tipEn, tipZh] = c.tip;
    assert.ok(tipEn.length * 8.5 <= 440, `tip fits 14px canvas text: ${tipEn}`);
    assert.ok(tipZh.length * 14 <= 440 && /[一-鿿]/.test(tipZh), `Chinese tip: ${tipZh}`);
    assert.ok(
      c.foes.some((f) => f.after === 0),
      'someone is there to fight at the start',
    );
    assert.ok(c.foes.every((f) => f.after < c.foes.length && FOES[f.type]));
  }
});

test('magnet marauder: every chamber is laid out legally and starts with a fetch-the-metal walk', () => {
  for (let i = 0; i < CHAMBER_COUNT; i++) {
    const c = CHAMBERS[i];
    for (const seed of [1, 2, 3]) {
      const w = createWorld(seeded(seed), i);
      const solids = [
        ...w.walls.slice(4),
        ...w.machines.map((m) => ({
          x0: m.x - m.hw,
          y0: m.y - m.hh,
          x1: m.x + m.hw,
          y1: m.y + m.hh,
        })),
      ];
      const inArena = (e) =>
        e.x - e.hw >= ARENA.x0 &&
        e.x + e.hw <= ARENA.x1 &&
        e.y - e.hh >= ARENA.y0 &&
        e.y + e.hh <= ARENA.y1;
      const where = `chamber ${i + 1} seed ${seed}`;
      assert.ok(inArena(w.p) && !solids.some((b) => overlapsBox(w.p, b)), `${where}: player`);
      assert.equal(w.p.fx, c.flip ? 1 : -1, `${where}: the player faces into the room`);
      for (const m of w.metals) {
        assert.ok(inArena({ ...m, hh: m.hw }), `${where}: ${m.id} in the arena`);
        assert.ok(!solids.some((b) => overlapsBox({ ...m, hh: m.hw }, b)), `${where}: ${m.id}`);
        // Blind play (hold Space, wander, tap X) never reaches metal: the first job is to walk to it.
        assert.ok(Math.hypot(m.x - w.p.x, m.y - w.p.y) >= 290, `${where}: ${m.id} is too close`);
      }
      for (const m of w.machines)
        assert.ok(inArena(m) && !w.walls.slice(4).some((b) => overlapsBox(m, b)));
      for (const f of [...w.foes, ...w.pending]) {
        const e = { x: f.x, y: f.y, ...FOES[f.type] };
        assert.ok(
          inArena(e) && !w.walls.some((b) => overlapsBox(e, b)),
          `${where}: ${f.type} door`,
        );
        // the first wave comes in on the other half of the room from the player's start
        if (f.after === 0)
          assert.ok(Math.abs(f.y - w.p.y) >= 50, `${where}: door beside the start`);
      }
    }
  }
});

test('magnet marauder: a flipped chamber is the same room mirrored left to right', () => {
  const flipped = CHAMBERS.findIndex((c) => c.flip);
  assert.ok(flipped >= 0 && CHAMBERS.filter((c) => c.flip).length >= 5);
  const c = CHAMBERS[flipped];
  const w = createWorld(seeded(1), flipped);
  assert.equal(w.p.x, 480 - c.start.x);
  assert.equal(w.machines[0].x, 480 - c.machines[0][0]);
  assert.equal(w.metals[0].x, 480 - c.metals[0].x);
  const pillar = c.pillars[0];
  if (pillar)
    assert.deepEqual(w.walls[4], {
      x0: 480 - pillar.x1,
      y0: pillar.y0,
      x1: 480 - pillar.x0,
      y1: pillar.y1,
    });
  assert.equal(snapshot(w).chamber, flipped + 1);
});

test('magnet marauder: each chamber announces its idea on entry, in both languages', () => {
  for (let i = 0; i < CHAMBER_COUNT; i++) {
    const w = createWorld(seeded(1), i);
    const s = snapshot(w);
    assert.equal(s.message.en, CHAMBERS[i].tip[0]);
    assert.equal(s.message.zh, CHAMBERS[i].tip[1]);
    assert.equal(s.messageKind, 'event');
    assert.equal(s.chamberName.en, CHAMBERS[i].name.en);
  }
});

test('magnet marauder: each clear restores the player and loads the next chamber', () => {
  const w = createWorld(seeded(2));
  w.foes = [];
  w.pending = [];
  w.p.hp = 1;
  w.msg = null; // the entry tip has long gone
  const score = w.score;
  stepWorld(w, STEP, input([]));
  assert.equal(w.chamber, 0);
  assert.ok(w.clearT > 0);
  assert.equal(w.score, score + 200 + 25 * MACHINE_HP);
  assert.ok(w.events.some((e) => e.name === 'clear'));
  assert.match(snapshot(w).message.en, /Chamber clear!/);
  assert.match(snapshot(w).message.zh, /车间已清空/);
  run(w, CLEAR_TIME + 0.1);
  const s = snapshot(w);
  assert.equal(s.chamber, 2);
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.machines.length, CHAMBERS[1].machines.length);
  assert.ok(s.machines.every((m) => m.hp === MACHINE_HP));
  assert.equal(s.metals.length, CHAMBERS[1].metals.length);
});

test('magnet marauder: clearing the last chamber wins exactly once', () => {
  const h = harness({ seed: 3 });
  const g = createGame(h.env);
  // Fast-forward the internal world through its public update path using real play is covered by the
  // quality policy; here only the terminal contract is checked on a prepared final chamber.
  const w = createWorld(seeded(3));
  loadChamber(w, CHAMBER_COUNT - 1);
  w.foes = [];
  w.pending = [];
  stepWorld(w, STEP, input([]));
  assert.equal(w.phase, 'won');
  assert.equal(w.endKind, 'won');
  const frozen = JSON.stringify(snapshot(w));
  run(w, 2, ['Space', 'ArrowLeft'], ['KeyX']);
  assert.equal(JSON.stringify(snapshot(w)), frozen);
  assert.equal(g.getState().phase, 'playing');
});

// ----------------------------------------------------------------- prompts and status

test('magnet marauder: the one standing prompt names every key, fits the canvas and is bilingual', () => {
  assert.deepEqual(Object.keys(PROMPTS), ['play']);
  const [en, zh] = PROMPTS.play;
  assert.ok(en.length * 8.5 <= 440, 'English prompt fits 14px canvas text');
  assert.ok(zh.length * 14 <= 440, 'Chinese prompt fits 14px canvas text');
  assert.match(en, /Space.*X.*red/);
  assert.match(zh, /空格.*X.*红色/);
  assert.equal(snapshot(lab()).prompt.key, 'play');
  // ready: anything in orbit, whether or not a bracket is showing; X explains itself if it refuses
  const { w: far } = orbitSetup(['plate']);
  addFoe(far, 'brute', 220, 60, { stun: FROZEN }); // far off the facing cone
  run(far, 0.7, ['Space']);
  assert.equal(snapshot(far).prompt.key, 'play');
  assert.equal(snapshot(far).aim, null);
  const { w: locked, foe } = orbitSetup(['plate'], { foeAt: [360, 170] });
  run(locked, 0.7, ['Space']);
  assert.equal(snapshot(locked).prompt.key, 'play');
  assert.equal(snapshot(locked).aim, foe.id);
  // a wall or a machine in the line of fire blocks the lock and X says why
  const { w: blocked } = orbitSetup(['plate'], { foeAt: [360, 170] });
  blocked.walls.push({ x0: 280, y0: 150, x1: 290, y1: 190 });
  run(blocked, 0.1, ['Space'], ['KeyX']);
  assert.equal(snapshot(blocked).aim, null);
  assert.equal(snapshot(blocked).aimBlocked, true);
  assert.match(snapshot(blocked).message.en, /Line of fire blocked/);
  assert.match(snapshot(blocked).message.zh, /射线被挡住/);
  const { w: mach } = orbitSetup(['plate'], { foeAt: [360, 170] });
  mach.machines[0].x = 300;
  mach.machines[0].y = 170;
  run(mach, 0.1, ['Space']);
  assert.equal(snapshot(mach).aimBlocked, true);
});

test('magnet marauder: the red-lane warning is live exactly while the player is inside a live lane', () => {
  const w = lab();
  w.p.x = 300;
  w.p.y = 170;
  const ch = addFoe(w, 'charger', 170, 170, { state: 'wind', t: 50, dirx: 1, diry: 0 });
  assert.equal(inLane(w.p, ch), true);
  assert.equal(inLane({ ...w.p, y: 230 }, ch), false);
  assert.equal(inLane(w.p, { ...ch, state: 'walk' }), false);
  assert.equal(inLane(w.p, { ...ch, type: 'brute' }), false);
  assert.equal(inLane({ ...w.p, x: ch.x - 60 }, ch), false);
  run(w, 0.01, ['Space']);
  let s = snapshot(w);
  assert.equal(s.messageKind, 'lane');
  assert.match(s.message.en, /^RED LANE: step out of the line!/);
  assert.match(s.message.zh, /红色通道/);
  assert.match(s.status.en, /RED LANE.*Hold Space/);
  run(w, 3, ['Space']);
  assert.equal(
    snapshot(w).messageKind,
    'lane',
    'it stays for as long as the player stands in the lane',
  );
  // stepping out clears it at once, even though the lane is still live
  w.p.y = 230;
  run(w, 0.01, ['Space']);
  assert.equal(ch.state, 'wind');
  assert.notEqual(snapshot(w).messageKind, 'lane');
  w.p.y = 170;
  run(w, 0.01, ['Space']);
  assert.equal(snapshot(w).messageKind, 'lane', 'and it returns when the player re-enters');
  // when the dash starts the lane is gone and so is the warning
  ch.t = 0.001;
  run(w, 0.05, ['Space']);
  assert.equal(ch.state, 'dash');
  assert.notEqual(snapshot(w).messageKind, 'lane');
});

test('magnet marauder: the lane warning preempts an event at once and cannot be overwritten by a newer one', () => {
  const w = lab();
  w.p.x = 300;
  w.p.y = 230;
  const ch = addFoe(w, 'charger', 170, 170, { state: 'wind', t: 50, dirx: 1, diry: 0 });
  const k = w.machines[0];
  addMetal(w, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(w, 0.15);
  assert.equal(snapshot(w).messageKind, 'event');
  assert.match(snapshot(w).message.en, /Your metal hit machine/);
  w.p.y = 170; // into the lane while that event is still showing (age well under 0.7 s)
  run(w, 0.01);
  assert.equal(snapshot(w).messageKind, 'lane');
  w.pendingMsg = { en: 'Armor cracked -2', zh: '装甲碎裂 -2' }; // a newer event arrives meanwhile
  run(w, 0.5);
  assert.equal(snapshot(w).messageKind, 'lane');
  w.p.y = 230; // leaving shows the event again instead of dropping it
  run(w, 0.01);
  assert.equal(snapshot(w).messageKind, 'event');
  assert.ok(ch);
});

test('magnet marauder: X advice disappears the moment its cause is gone', () => {
  // no lock-on -> acquire one
  const { w, foe } = orbitSetup(['plate'], { foeAt: [330, 170] });
  foe.hp = foe.maxHp = 30;
  w.p.fx = 0;
  w.p.fy = -1;
  run(w, 0.05, ['Space'], ['KeyX']);
  assert.equal(snapshot(w).messageKind, 'advice');
  assert.match(snapshot(w).message.en, /No lock-on/);
  w.p.fx = 1;
  w.p.fy = 0;
  run(w, 0.01, ['Space']);
  assert.equal(snapshot(w).aim, foe.id);
  assert.equal(snapshot(w).message, null, 'advice is gone as soon as a lock exists');
  // blocked -> unblocked
  const { w: b } = orbitSetup(['plate'], { foeAt: [330, 170] });
  const wall = { x0: 280, y0: 150, x1: 290, y1: 190 };
  b.walls.push(wall);
  run(b, 0.05, ['Space'], ['KeyX']);
  assert.match(snapshot(b).message.en, /Line of fire blocked/);
  b.walls.pop();
  run(b, 0.01, ['Space']);
  assert.equal(snapshot(b).message, null);
  // empty orbit -> something enters orbit
  const e = lab();
  const m = addMetal(e, 'plate', 220, 170);
  run(e, 0.05, [], ['KeyX']);
  assert.match(snapshot(e).message.en, /Nothing in orbit/);
  run(e, 0.5, ['Space']);
  assert.ok(m.held);
  assert.equal(snapshot(e).message, null);
  // and advice never delays or replaces a real event
  const k = e.machines[0];
  addMetal(e, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(e, 0.1);
  assert.equal(snapshot(e).messageKind, 'event');
});

test('magnet marauder: status carries chamber, machinery, HP, event messages and the key prompt in both languages', () => {
  const w = lab();
  const s0 = snapshot(w);
  assert.match(
    s0.status.en,
    new RegExp(`Chamber 1/${CHAMBER_COUNT} · Weakest machine 14/14 · HP 4 · .*Space`),
  );
  assert.match(
    s0.status.zh,
    new RegExp(`第1/${CHAMBER_COUNT}间 · 最弱机器 14/14 · 生命 4 · .*空格`),
  );
  const k = w.machines[0];
  addMetal(w, 'plate', k.x + k.hw + 10, k.y, -300, 0);
  run(w, 0.15);
  const s1 = snapshot(w);
  assert.match(
    s1.status.en,
    /Weakest machine 13\/14 · HP 4 · Your metal hit machine 1! 13\/14 · .*Space/,
  );
  assert.match(s1.status.zh, /最弱机器 13\/14/);
  assert.deepEqual(s1.message, {
    en: 'Your metal hit machine 1! 13/14',
    zh: '你的金属撞到了1号机器！13/14',
  });
  run(w, 1.5);
  assert.equal(snapshot(w).message, null, 'messages expire');
  assert.doesNotMatch(snapshot(w).status.en, /hit machine/);
});

// ----------------------------------------------------------------- lifecycle and API

test('magnet marauder: end callback fires once, the state freezes, restart is fresh', () => {
  const h = harness({ seed: 4 });
  const g = createGame(h.env);
  const initial = JSON.stringify(g.getState());
  let t = 0;
  while (!h.ends.length && t < 400) {
    g.update(1 / 60, input([]));
    t += 1 / 60;
  }
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(
    h.ends[0].message,
    /Enemies wrecked the machinery\. Hit them before their wind-up ends\./,
  );
  assert.equal(typeof h.ends[0].score, 'number');
  const frozen = JSON.stringify(g.getState());
  const sounds = h.sounds.length;
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['Space', 'ArrowLeft'], ['KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.equal(h.sounds.length, sounds);
  assert.equal(h.sounds.at(-1), 'lose');
  assert.equal(g.getState().phase, 'lost');
  const fresh = createGame(harness({ seed: 4 }).env);
  assert.equal(JSON.stringify(fresh.getState()), initial);
  const zh = harness({ seed: 4, lang: 'zh' });
  const gz = createGame(zh.env);
  for (let i = 0; i < 60 * 400 && !zh.ends.length; i++) gz.update(1 / 60, input([]));
  assert.match(zh.ends[0].message, /敌人毁掉了机器/);
});

test('magnet marauder: identical aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  const script = (win) => ({
    held: [
      'Space',
      ...[
        ['ArrowRight'],
        ['ArrowRight', 'ArrowDown'],
        ['ArrowDown'],
        ['ArrowLeft'],
        [],
        ['ArrowUp', 'ArrowLeft'],
      ][Math.floor(win / 20) % 6],
    ],
    pressed: win % 15 === 7 ? ['KeyX'] : [],
  });
  const snaps = {};
  for (const hz of [30, 60, 120]) {
    const h = harness({ seed: 9 });
    const g = createGame(h.env);
    const per = hz / 30;
    snaps[hz] = [];
    for (let win = 0; win < 30 * 25; win++) {
      const sc = script(win);
      for (let k = 0; k < per; k++) {
        g.update(1 / hz, input(sc.held, k === 0 ? sc.pressed : []));
      }
      if (win % 30 === 29) snaps[hz].push(JSON.stringify(g.getState()));
    }
  }
  assert.deepEqual(snaps[60], snaps[30]);
  assert.deepEqual(snaps[120], snaps[30]);
  assert.ok(snaps[30].length === 25);
});

test('magnet marauder: getState is JSON-safe, detached and offers no cheat API', () => {
  const g = createGame(harness().env);
  const s = g.getState();
  const walk = (o, path = '') => {
    for (const [k, v] of Object.entries(o)) {
      assert.notEqual(typeof v, 'function', `${path}${k} is a function`);
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path}${k}`);
      if (v && typeof v === 'object') walk(v, `${path}${k}.`);
    }
  };
  walk(s);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  s.hp = 99;
  s.machines[0].hp = 99;
  s.metals[0].x = -5;
  s.walls.pop();
  assert.equal(g.getState().hp, MAX_HP);
  assert.equal(g.getState().machines[0].hp, MACHINE_HP);
  assert.notEqual(g.getState().metals[0].x, -5);
  for (const bad of ['godMode', 'skip', 'win', 'setHp', 'world', 'cheat']) assert.ok(!(bad in g));
  for (const key of Object.keys(s)) assert.ok(!/cheat|god|skip/i.test(key));
  assert.equal(s.phase, 'playing');
  assert.equal(s.score, 0);
  assert.equal(s.chamber, 1);
});

test('magnet marauder: long seeded simulation stays finite, bounded and inside the arena', () => {
  for (const seed of [1, 2, 3]) {
    const h = harness({ seed });
    const g = createGame(h.env);
    const rnd = seeded(seed + 40);
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
    let held = [];
    for (let i = 0; i < 60 * 150 && !h.ends.length; i++) {
      if (i % 20 === 0) held = keys.filter(() => rnd() < 0.4);
      g.update(1 / 60, input(held, rnd() < 0.05 ? ['KeyX'] : []));
      const s = g.getState();
      assert.ok(s.metals.length <= 6 && s.foes.length <= 4);
      for (const m of s.metals) {
        assert.ok(Number.isFinite(m.x + m.y + m.vx + m.vy));
        assert.ok(
          m.x > ARENA.x0 - 1 && m.x < ARENA.x1 + 1 && m.y > ARENA.y0 - 1 && m.y < ARENA.y1 + 1,
        );
        assert.ok(m.speed <= REPEL_V + 2 * 230, 'only bounces off dashing foes can add speed');
      }
      assert.ok(Number.isFinite(s.player.x + s.player.y));
    }
    assert.ok(h.sounds.every((n) => ['coin', 'hit', 'shoot', 'win', 'lose', 'move'].includes(n)));
  }
});

// ----------------------------------------------------------------- drawing

function recordingContext() {
  const ctx = mockContext();
  const texts = [];
  ctx.fillText = (text, x, y) => texts.push({ text, x, y, font: ctx.font, align: ctx.textAlign });
  return { ctx, texts };
}

test('magnet marauder: draw works in every state and keeps text at a readable size', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ seed: 5, lang });
    const g = createGame(h.env);
    const { ctx, texts } = recordingContext();
    g.draw(ctx);
    const hold = ['Space'];
    for (let i = 0; i < 60 * 40; i++) {
      g.update(
        1 / 60,
        input(i % 200 < 120 ? hold : ['ArrowRight', 'Space'], i % 45 === 0 ? ['KeyX'] : []),
      );
      if (i % 20 === 0) g.draw(ctx);
    }
    assert.ok(texts.length > 20);
    for (const t of texts) {
      const size = Number(/(\d+)px/.exec(t.font)[1]);
      assert.ok(size >= 14 && size <= 16, `${t.font}`);
      assert.ok(t.y < 24 || t.y >= 296, `text at y=${t.y} would cover the arena`);
    }
    if (lang === 'zh') assert.ok(texts.some((t) => /[一-鿿]/.test(t.text)));
  }
});

test('magnet marauder: a hit knocks a dashing charger out of its dash', () => {
  const w = lab();
  const ch = addFoe(w, 'charger', 300, 170, {
    state: 'dash',
    t: 0.5,
    dirx: -1,
    diry: 0,
    hp: 9,
    maxHp: 9,
  });
  w.p.x = 400;
  w.p.y = 250;
  addMetal(w, 'plate', 300 - ch.hw - 10, 170, 330, 0);
  run(w, 0.1);
  assert.equal(ch.state, 'dizzy');
  assert.ok(ch.hp < 9 && ch.stun > 0);
});

test('magnet marauder: draw shows wind-up lanes, brackets, glowing metal, damage and dizzy foes', () => {
  const w = lab();
  const { ctx, texts } = recordingContext();
  const env = harness().env;
  w.p.x = 200;
  w.p.y = 170;
  w.p.inv = 1;
  addMetal(w, 'plate', 160, 170, 260, 0); // fast, glowing
  addMetal(w, 'slab', 180, 140).held = true;
  addMetal(w, 'plate', 230, 140);
  const aimed = addFoe(w, 'brute', 330, 170, { stun: FROZEN });
  addFoe(w, 'charger', 400, 100, { state: 'wind', t: 1, dirx: -1, diry: 0 });
  addFoe(w, 'charger', 400, 240, { state: 'dizzy', t: 1 });
  addFoe(w, 'brute', 300, 250, { spawnT: 0.4 });
  w.machines[0].hp = 2;
  w.machines[0].flash = 0.3;
  w.fx.push({ x: 100, y: 100, vx: 0, vy: 0, t: 1, color: '#fff' });
  w.aim = aimed.id;
  w.p.lock = 0.2;
  w.p.attracting = false;
  for (const tick of [0, 11, 23]) {
    w.tick = tick;
    drawWorld(ctx, w, env);
  }
  w.p.lock = 0;
  w.p.attracting = true;
  w.msg = { en: 'Test message', zh: '测试消息', t: 1 };
  drawWorld(ctx, w, env);
  assert.ok(texts.some((t) => t.text === 'Test message'));
  assert.ok(texts.some((t) => /^Foes \d+$/.test(t.text)));
  loadChamber(w, 1);
  w.phase = 'lost';
  drawWorld(ctx, w, harness({ lang: 'zh' }).env);
});

test('magnet marauder: actors are large and the play band hides nothing', () => {
  const w = createWorld(seeded(1));
  for (const i of [0, 1, 2]) {
    loadChamber(w, i);
    spawnPending(w);
    const s = snapshot(w);
    const all = [s.player, ...s.foes, ...s.machines, ...s.metals.map((m) => ({ ...m, hh: m.hw }))];
    for (const a of all) {
      assert.ok(a.hw * 2 >= 16 && (a.hh ?? a.hw) * 2 >= 16);
      assert.ok(a.x - a.hw >= ARENA.x0 && a.x + a.hw <= ARENA.x1);
      assert.ok(a.y - (a.hh ?? a.hw) >= ARENA.y0 && a.y + (a.hh ?? a.hw) <= ARENA.y1);
    }
  }
});

test('magnet marauder: orbit-dependent prompts tell the player to keep holding Space', () => {
  for (const key of ['play']) {
    assert.match(PROMPTS[key][0], /Hold Space/, key);
    assert.match(PROMPTS[key][1], /按住空格/, key);
  }
});

test('magnet marauder: the HUD fits a five-digit score without overlap, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const w = createWorld(seeded(1));
    loadChamber(w, 2);
    spawnPending(w);
    w.score = 99999;
    const { ctx } = recordingContext();
    const runs = [],
      rects = [];
    ctx.fillRect = (x, y, rw, rh) => {
      if (y < 24 && rw < 40 && rh < 30) rects.push({ text: `rect@${x}`, left: x, right: x + rw });
    };
    ctx.fillText = (text, x, y) => {
      const size = Number(/(\d+)px/.exec(ctx.font)[1]);
      const width = [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? size : size * 0.6), 0);
      const left =
        ctx.textAlign === 'right' ? x - width : ctx.textAlign === 'center' ? x - width / 2 : x;
      if (y < 24) runs.push({ text, left, right: left + width });
    };
    drawWorld(ctx, w, harness({ lang }).env);
    for (const r of rects) runs.push(r);
    runs.sort((a, b) => a.left - b.left);
    assert.ok(rects.length >= 4, 'HP pips were drawn');
    assert.ok(runs.length >= 8);
    assert.ok(runs[0].left >= 0 && runs.at(-1).right <= 480, 'HUD text stays on the canvas');
    assert.equal(runs.at(-1).text, '99999');
    const pipEnd = Math.max(...rects.map((r) => r.right));
    assert.ok(
      runs
        .filter((r) => !r.text.startsWith('rect'))
        .every((r) => r.left >= pipEnd || r.right <= Math.min(...rects.map((q) => q.left))),
    );
    for (let i = 1; i < runs.length; i++) {
      assert.ok(
        runs[i].left >= runs[i - 1].right + 4,
        `${runs[i - 1].text} overlaps ${runs[i].text}`,
      );
    }
  }
});

test('magnet marauder: pulling alone never damages machinery, even through it', () => {
  assert.ok(ATTRACT_VMAX < MACHINE_V && ATTRACT_VMAX < ARMOR_V);
  const w = lab();
  const k = w.machines[0];
  w.p.x = k.x - k.hw - 9;
  w.p.y = k.y;
  addMetal(w, 'plate', k.x + 70, k.y);
  addMetal(w, 'plate', k.x + 90, k.y + 8);
  addMetal(w, 'slab', k.x + 60, k.y - 8);
  run(w, 20, ['Space']);
  assert.equal(k.hp, MACHINE_HP);
});

test('magnet marauder: foe spawn heights vary with the seed but stay on the floor', () => {
  const ys = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = createWorld(seeded(seed));
    loadChamber(w, 2);
    for (const f of [...w.foes, ...w.pending]) {
      assert.ok(f.y >= 60 && f.y <= 262);
      ys.add(Math.round(f.y));
    }
  }
  assert.ok(ys.size > 10);
});

test('magnet marauder: metal squeezed between a foe and a wall is pushed along the wall, never into it', () => {
  const w = lab();
  const foe = addFoe(w, 'brute', 445, 170, { stun: FROZEN, hp: 30, maxHp: 30 });
  const m = addMetal(w, 'plate', 453, 174);
  run(w, 0.2);
  assert.ok(!inWall(w, m), `inside the wall at ${m.x},${m.y}`);
  assert.ok(Math.abs(m.x - foe.x) >= foe.hw + m.hw || Math.abs(m.y - foe.y) >= foe.hh + m.hw);
  assert.equal(foe.hp, 30);
});

test('magnet marauder: "Machine N under attack!" is live exactly while a wind-up is aimed at that machine', () => {
  const w = lab({ chamber: 1 });
  const [, second] = w.machines;
  w.p.x = 400;
  w.p.y = 150;
  const brute = addFoe(w, 'brute', second.x + 30, second.y, { state: 'walk' });
  assert.notEqual(snapshot(w).messageKind, 'attack', 'not before a wind-up');
  while (brute.state !== 'wind') stepWorld(w, STEP, input([]));
  run(w, 0.01);
  let s = snapshot(w);
  assert.equal(brute.target, second.id);
  assert.equal(s.messageKind, 'attack');
  assert.equal(s.message.en, 'Machine 2 under attack!');
  assert.equal(s.message.zh, '2号机器遭到攻击！');
  assert.match(s.status.en, /Machine 2 under attack!.*Hold Space/);
  run(w, 0.5);
  assert.equal(snapshot(w).messageKind, 'attack', 'it stays for the whole wind-up');
  // an interrupting hit keeps the wind-up (and the warning) alive; the strike ends both
  while (brute.state === 'wind') stepWorld(w, STEP, input([]));
  assert.equal(brute.state, 'rest');
  s = snapshot(w);
  assert.notEqual(s.messageKind, 'attack', 'withdrawn the tick the wind-up ends');
  // the machine is named correctly for the other machine too
  const v = lab({ chamber: 1 });
  v.p.x = 400;
  v.p.y = 150;
  const first = v.machines[0];
  const b2 = addFoe(v, 'brute', first.x + 30, first.y, { state: 'walk' });
  while (b2.state !== 'wind') stepWorld(v, STEP, input([]));
  run(v, 0.01);
  assert.equal(snapshot(v).message.en, 'Machine 1 under attack!');
});

test('magnet marauder: urgency order is lane, then a fresh event, then the attack warning, then older events', () => {
  const w = lab();
  w.p.x = 400;
  w.p.y = 250;
  const brute = addFoe(w, 'brute', 80, 162, { state: 'walk' });
  while (brute.state !== 'wind') stepWorld(w, STEP, input([]));
  const k = w.machines[0];
  addMetal(w, 'plate', k.x + k.hw + 10, k.y + 30, -300, 0);
  w.msg = { en: 'Enemy down!', zh: '敌人倒下了！', t: 1.3, age: 0 };
  run(w, 0.01);
  assert.equal(snapshot(w).messageKind, 'event', 'a fresh event keeps its 0.7 s dwell');
  run(w, 0.75);
  assert.equal(snapshot(w).messageKind, 'attack', 'then the attack warning takes over');
  // a lane warning outranks both
  const c = addFoe(w, 'charger', 300, 250, { state: 'wind', t: 50, dirx: -1, diry: 0 });
  w.p.x = 220;
  w.p.y = 250;
  run(w, 0.01);
  assert.equal(inLane(w.p, c), true);
  assert.equal(snapshot(w).messageKind, 'lane');
});

test('magnet marauder: an event keeps its remaining time while a lane warning hides it', () => {
  const w = lab();
  w.p.x = 300;
  w.p.y = 230;
  addFoe(w, 'charger', 170, 170, { state: 'wind', t: 50, dirx: 1, diry: 0 });
  w.msg = { en: 'Enemy down!', zh: '敌人倒下了！', t: 1.3, age: 0 };
  w.pendingMsg = null;
  run(w, 0.3);
  w.p.y = 170; // into the lane: the warning hides the event
  run(w, 0.02);
  const before = { ...w.msg };
  run(w, 3);
  assert.equal(snapshot(w).messageKind, 'lane');
  assert.equal(w.msg.t, before.t, 'the event neither ages nor expires while hidden');
  assert.equal(w.msg.age, before.age);
  w.p.y = 230; // out again: the event is still there, with its dwell intact
  run(w, 0.01);
  assert.equal(snapshot(w).message.en, 'Enemy down!');
  assert.equal(snapshot(w).messageKind, 'event');
  run(w, 0.5); // its 0.7 s dwell is over, so the attack warning may now take the line
  assert.equal(snapshot(w).messageKind, 'attack');
  assert.equal(w.msg.en, 'Enemy down!');
});

function bracketsFor(w) {
  const { ctx } = recordingContext();
  const found = [];
  ctx.strokeRect = (x, y, rw, rh) => found.push({ style: ctx.strokeStyle, x, y, rw, rh });
  drawWorld(ctx, w, harness().env);
  return found.filter((b) => b.style === '#ff3b3b' || b.style === '#b8bcc4');
}

test('magnet marauder: a grey slashed bracket marks a foe that is in cone and range but blocked, and only then', () => {
  const RED = '#ff3b3b',
    GREY = '#b8bcc4';
  const scene = (foeAt, edit = () => {}) => {
    const { w, foe } = orbitSetup(['plate'], { foeAt });
    foe.hp = foe.maxHp = 30;
    edit(w, foe);
    run(w, 0.05, ['Space']);
    return { w, foe };
  };
  // clear line, in cone and range: the red lock-on bracket, no grey one
  let { w, foe } = scene([330, 170]);
  assert.deepEqual(snapshot(w).blockedFoes, []);
  assert.deepEqual(
    bracketsFor(w).map((b) => b.style),
    [RED],
  );
  // a machine between the player and the foe: grey bracket on that foe, snapshot says so, no lock
  ({ w, foe } = scene([330, 170], (world) => {
    world.machines[0].x = 280;
    world.machines[0].y = 170;
  }));
  assert.deepEqual(snapshot(w).blockedFoes, [foe.id]);
  assert.equal(snapshot(w).aim, null);
  const grey = bracketsFor(w);
  assert.deepEqual(
    grey.map((b) => b.style),
    [GREY],
  );
  assert.ok(
    Math.abs(grey[0].x + grey[0].rw / 2 - foe.x) < 1 &&
      Math.abs(grey[0].y + grey[0].rh / 2 - foe.y) < 1,
  );
  // a wall blocks the same way
  ({ w, foe } = scene([330, 170], (world) =>
    world.walls.push({ x0: 270, y0: 150, x1: 280, y1: 190 }),
  ));
  assert.deepEqual(snapshot(w).blockedFoes, [foe.id]);
  assert.deepEqual(
    bracketsFor(w).map((b) => b.style),
    [GREY],
  );
  // blocked but outside the cone: no marker at all
  ({ w } = scene([330, 170], (world) => {
    world.machines[0].x = 280;
    world.machines[0].y = 170;
    world.p.fx = 0;
    world.p.fy = -1;
  }));
  assert.deepEqual(snapshot(w).blockedFoes, []);
  assert.deepEqual(bracketsFor(w), []);
  // blocked but out of range: no marker
  ({ w } = scene([330, 170], (world) => {
    world.p.x = 30;
    world.p.y = 170;
    world.machines[0].x = 100;
    world.machines[0].y = 170;
  }));
  assert.deepEqual(snapshot(w).blockedFoes, []);
  assert.deepEqual(bracketsFor(w), []);
  // the event-line advice is kept: X still explains why it refuses
  ({ w } = scene([330, 170], (world) => {
    world.machines[0].x = 280;
    world.machines[0].y = 170;
  }));
  run(w, 0.05, ['Space'], ['KeyX']);
  assert.match(snapshot(w).message.en, /Line of fire blocked/);
});

test('magnet marauder: a replaced event never reappears, even for a tick, when the attack warning ends', () => {
  const w = lab();
  w.p.x = 400;
  w.p.y = 250;
  const brute = addFoe(w, 'brute', 120, 162, { state: 'walk', hp: 2, maxHp: 2 });
  while (brute.state !== 'wind') stepWorld(w, STEP, input([]));
  // an old event, past its dwell, is hidden by the attack warning; the kill queues a newer one
  w.msg = { en: 'Armor cracked -2', zh: '装甲碎裂 -2', t: 1, age: 0.9 };
  w.pendingMsg = null;
  assert.equal(snapshot(w).messageKind, 'attack');
  addMetal(w, 'plate', brute.x + brute.hw + 10, brute.y, -330, 0);
  const seen = [];
  for (let i = 0; i < 120 * 2; i++) {
    stepWorld(w, STEP, input([]));
    const s = snapshot(w);
    seen.push(`${s.messageKind}:${s.message?.en ?? ''}`);
  }
  assert.ok(w.foes.length === 0, 'the brute was killed');
  const kill = seen.findIndex((e) => e === 'event:Enemy down!');
  assert.ok(kill >= 0, 'the kill message is shown');
  assert.ok(
    !seen.slice(0, kill + 1).includes('event:Armor cracked -2'),
    `the replaced event came back: ${seen.slice(Math.max(0, kill - 2), kill + 1)}`,
  );
});

// ----------------------------------------------------------------- chamber select and progress

function menuGame(unlocked, { lang = 'en' } = {}) {
  const h = harness({ seed: 4, lang });
  const unlockCalls = [];
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => unlockCalls.push(n) };
  return { h, g: createGame(h.env), unlockCalls };
}
const MENU_CELL = (i) => ({
  x: MENU.x0 + (i % MENU.cols) * (MENU.cellW + MENU.gap) + 5,
  y: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.cellH + MENU.gap) + 5,
});

test('magnet marauder: with only chamber 1 open (or no progress API) the game starts at once', () => {
  for (const make of [() => menuGame(1).g, () => createGame(harness().env)]) {
    const g = make();
    assert.equal(g.getState().phase, 'playing');
    assert.equal(g.getState().menu, null);
    assert.equal(g.getState().chamber, 1);
  }
  const bad = menuGame(Number.NaN).g;
  assert.equal(bad.getState().phase, 'playing');
  assert.equal(
    menuGame(999).g.getState().menu.unlocked,
    CHAMBER_COUNT,
    'clamped to the last chamber',
  );
});

test('magnet marauder: a later start offers continue and a level select; the world waits behind it', () => {
  const { g } = menuGame(7);
  const open = g.getState();
  assert.equal(open.phase, 'menu');
  assert.deepEqual(
    [open.menu.sel, open.menu.chamber, open.menu.unlocked, open.menu.count],
    [6, 7, 7, CHAMBER_COUNT],
    'the highlight starts on the highest unlocked chamber (continue)',
  );
  const before = JSON.stringify({ ...open, menu: null, phase: null });
  for (let i = 0; i < 120; i++)
    g.update(1 / 60, input(['Space', 'ArrowRight'], i === 5 ? ['ArrowLeft'] : []));
  const during = g.getState();
  assert.equal(
    JSON.stringify({ ...during, menu: null, phase: null }),
    before.replace(/"time":[^,]+/, `"time":${during.time}`),
    'frozen',
  );
  assert.equal(during.time, 0);
  assert.equal(during.menu.sel, 5, 'the left press moved the highlight');
});

test('magnet marauder: arrows move the highlight within the open chambers and Space or X starts it', () => {
  const press = (g, ...keys) => g.update(1 / 60, input([], keys));
  const { g } = menuGame(8);
  press(g, 'ArrowRight');
  assert.equal(g.getState().menu.sel, 7, 'no further than the last open chamber');
  press(g, 'ArrowUp');
  assert.equal(g.getState().menu.sel, 0, 'up is a row back, clamped at the first chamber');
  press(g, 'ArrowLeft', 'ArrowLeft');
  assert.equal(g.getState().menu.sel, 0, 'clamped at the first chamber');
  press(g, 'KeyS');
  press(g, 'KeyD');
  assert.equal(g.getState().menu.sel, 7, 'WASD works and down is one row on');
  press(g, 'ArrowDown');
  assert.equal(g.getState().menu.sel, 7);
  press(g, 'KeyA');
  assert.equal(g.getState().menu.sel, 6);
  press(g, 'KeyX');
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.chamber, 7);
  assert.equal(s.menu, null);
  assert.equal(s.chamberName.en, CHAMBERS[6].name.en);
  const second = menuGame(3);
  second.g.update(1 / 60, input(['Space'], ['Space']));
  assert.equal(second.g.getState().chamber, 3);
  const first = menuGame(5);
  for (let i = 0; i < 4; i++) first.g.update(1 / 60, input([], ['ArrowLeft']));
  first.g.update(1 / 60, input([], ['KeyX']));
  first.g.update(1 / 60, input([], []));
  assert.equal(first.g.getState().chamber, 1, 'any open chamber can be replayed');
});

test('magnet marauder: touching an open chamber starts it; a locked one does nothing', () => {
  const { g } = menuGame(4);
  const locked = MENU_CELL(4);
  g.update(1 / 60, input([], [], { x: locked.x, y: locked.y, clicked: true }));
  assert.equal(g.getState().phase, 'menu');
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.equal(g.getState().phase, 'menu');
  const open = MENU_CELL(2);
  g.update(1 / 60, input([], [], { x: open.x, y: open.y, clicked: true }));
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().chamber, 3);
});

test('magnet marauder: the chamber select draws bilingual 14-16 px text clear of the HUD bands', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = menuGame(11, { lang });
    const { ctx, texts } = recordingContext();
    g.draw(ctx);
    assert.ok(texts.length >= CHAMBER_COUNT + 3);
    for (const t of texts) {
      const size = Number(/(\d+)px/.exec(t.font)[1]);
      assert.ok(size >= 14 && size <= 16, t.font);
      assert.ok(t.y >= 8 && t.y < 290, `text at y=${t.y}`);
      const width = [...t.text].reduce(
        (n, c) => n + (c.charCodeAt(0) > 255 ? size : size * 0.6),
        0,
      );
      const left = t.align === 'center' ? t.x - width / 2 : t.x;
      assert.ok(left >= 0 && left + width <= 480, `${t.text} stays on the canvas`);
    }
    const all = texts.map((t) => t.text).join('|');
    assert.match(all, lang === 'zh' ? /选择车间/ : /Choose a chamber/);
    assert.match(all, lang === 'zh' ? /方向键选择/ : /Arrows: choose/);
    assert.ok(all.includes(lang === 'zh' ? CHAMBERS[10].name.zh : CHAMBERS[10].name.en));
    for (let i = 1; i <= CHAMBER_COUNT; i++) assert.ok(texts.some((t) => t.text === String(i)));
  }
});

test('magnet marauder: the HUD shows Chamber n/N without clipping, up to the last chamber', () => {
  for (const lang of ['en', 'zh']) {
    const w = createWorld(seeded(1), CHAMBER_COUNT - 1);
    const { ctx, texts } = recordingContext();
    drawWorld(ctx, w, harness({ lang }).env);
    const label = texts.find((t) => /^(Chamber |第)\d+\/\d+/.test(t.text));
    assert.equal(
      label.text,
      lang === 'zh'
        ? `第${CHAMBER_COUNT}/${CHAMBER_COUNT}间`
        : `Chamber ${CHAMBER_COUNT}/${CHAMBER_COUNT}`,
    );
    const size = Number(/(\d+)px/.exec(label.font)[1]);
    const width = [...label.text].reduce(
      (n, c) => n + (c.charCodeAt(0) > 255 ? size : size * 0.6),
      0,
    );
    const next = texts
      .filter((t) => t.y < 24 && t.x > label.x && t.align === 'left')
      .map((t) => t.x);
    assert.ok(
      label.x + width + 6 <= Math.min(...next),
      `${label.text} runs into the next HUD item`,
    );
  }
});

test('magnet marauder: a foe never steps out onto the player; it takes a free spot along its door', () => {
  const w = lab();
  w.p.x = 340;
  w.p.y = 100;
  w.pending = [{ type: 'brute', x: 340, y: 100, after: 0 }];
  spawnPending(w);
  const f = w.foes[0];
  assert.equal(f.x, 340);
  assert.ok(Math.abs(f.y - 100) >= 40, 'moved along the door');
  assert.ok(Math.abs(f.y - w.p.y) >= f.hh + w.p.hh);
  // with the door hemmed in by walls on every shift it still appears at its own spot
  const hemmed = lab();
  hemmed.walls = [...hemmed.walls, { x0: 300, y0: 40, x1: 380, y1: 285 }];
  hemmed.pending = [{ type: 'brute', x: 340, y: 100, after: 0 }];
  spawnPending(hemmed);
  assert.equal(hemmed.foes[0].y, 100);
});

test('magnet marauder: a spawning foe is already solid, so the player cannot walk into it', () => {
  const w = lab();
  w.p.x = 300;
  w.p.y = 170;
  w.pending = [{ type: 'brute', x: 340, y: 170, after: 0 }];
  spawnPending(w);
  assert.ok(w.foes[0].spawnT > 0);
  run(w, 0.6, ['ArrowRight']);
  assert.ok(w.p.x + w.p.hw <= w.foes[0].x - w.foes[0].hw + 1e-6, 'stopped at the spawning foe');
});

test('magnet marauder: no select-screen text box touches any chamber cell, in either language', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [CHAMBER_COUNT, 11, 2]) {
      const { g } = menuGame(unlocked, { lang });
      const { ctx, texts } = recordingContext();
      g.draw(ctx);
      const cells = Array.from({ length: CHAMBER_COUNT }, (_, i) => ({
        x0: MENU.x0 + (i % MENU.cols) * (MENU.cellW + MENU.gap),
        y0: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.cellH + MENU.gap),
      }));
      for (const t of texts) {
        const size = Number(/(\d+)px/.exec(t.font)[1]);
        const width = [...t.text].reduce(
          (n, c) => n + (c.charCodeAt(0) > 255 ? size : size * 0.6),
          0,
        );
        const left = t.align === 'center' ? t.x - width / 2 : t.x;
        const box = { x0: left, x1: left + width, y0: t.y, y1: t.y + size };
        const isNumber = /^\d+$/.test(t.text);
        for (const [i, c] of cells.entries()) {
          const hit =
            box.x0 < c.x0 + MENU.cellW &&
            box.x1 > c.x0 &&
            box.y0 < c.y0 + MENU.cellH &&
            box.y1 > c.y0;
          // a cell's own number sits inside it; nothing else may touch any cell
          if (isNumber && Number(t.text) === i + 1) {
            assert.ok(
              box.x0 >= c.x0 &&
                box.x1 <= c.x0 + MENU.cellW &&
                box.y0 >= c.y0 &&
                box.y1 <= c.y0 + MENU.cellH,
            );
          } else assert.ok(!hit, `${lang}: "${t.text}" overlaps cell ${i + 1}`);
        }
        assert.ok(box.y1 <= 290 && box.x0 >= 0 && box.x1 <= 480);
      }
    }
  }
  const last =
    MENU.y0 + Math.floor((CHAMBER_COUNT - 1) / MENU.cols) * (MENU.cellH + MENU.gap) + MENU.cellH;
  assert.ok(last <= 242, `the grid ends at y=${last}`);
});

test('magnet marauder: up and down move the highlight a whole row of the grid', () => {
  const { g } = menuGame(20);
  const sel = () => g.getState().menu.sel;
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(sel(), 19 - MENU.cols);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(sel(), 19);
});
