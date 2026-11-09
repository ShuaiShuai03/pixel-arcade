import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  meta,
  createCourierState,
  stepCourier,
  drawCourier,
} from '../src/games/gravity-courier.js';
import { COURIER_ROOMS, LEVEL_COUNT, clampLevel } from '../src/games/gravity-courier-rooms.js';
import { MENU_COLUMNS, menuCell } from '../src/games/gravity-courier-menu.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const LEVELS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVELS.filter((n) => n >= 3);
const TEACHING = LEVELS.slice(0, 6);
const MASTERY = LEVELS.slice(14);
const CJK = /[一-鿿]/;
const CLEAR_LIMIT = 120;
const BLIND_HORIZON = 40;
const BLIND_SEEDS = [1, 2, 3];
const CANVAS_WIDTH = 480;

// ---------------------------------------------------------------------------------------------
// Helpers. Every player below sees only getState(), the public snapshot the host and a person get.
// ---------------------------------------------------------------------------------------------
function memoryStore(start = 1) {
  const store = {
    value: start,
    calls: [],
    unlocked: () => store.value,
    unlock: (n) => {
      store.calls.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
/** Start a run on `level` the way a player does: through the chamber select when it is offered. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ seed, lang });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const wallsAt = (room, x) => room.walls.filter((w) => w.x === x);
const windowsOf = (room) =>
  [...new Set(room.walls.map((w) => w.x))].filter((x) => wallsAt(room, x).length === 2);
const hangsOf = (room) => room.walls.filter((w) => w.y === 52 && wallsAt(room, w.x).length === 1);
const postsOf = (room) =>
  room.walls.filter((w) => w.y + w.h === 276 && wallsAt(room, w.x).length === 1);
function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------
// The pilot: a reaction-limited bot. It acts on a state that is `delay` seconds old, estimates the
// present by replaying the commands it has sent since (it cannot see them take effect), plans its
// route round the public walls on a grid and flies it with caution. `noise` adds perception error.
// `lead` swaps the replay for a plain linear extrapolation, a weaker pilot used for the curve.
// ---------------------------------------------------------------------------------------------
const CELL = 8;
const GRID = { x0: 34, y0: 64, nx: 52, ny: 26 };
const SUBSTEPS = 8;
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function planRoute(seen, goal, margin) {
  const blocked = (cx, cy) => {
    const x = GRID.x0 + cx * CELL,
      y = GRID.y0 + cy * CELL;
    return seen.walls.some(
      (w) =>
        x + 10 + margin > w.x &&
        x - 10 - margin < w.x + w.w &&
        y + 12 + margin > w.y &&
        y - 12 - margin < w.y + w.h,
    );
  };
  const cell = (x, y) => [
      clampTo(Math.round((x - GRID.x0) / CELL), 0, GRID.nx - 1),
      clampTo(Math.round((y - GRID.y0) / CELL), 0, GRID.ny - 1),
    ],
    [sx, sy] = cell(seen.player.x, seen.player.y),
    [gx, gy] = cell(goal.x, goal.y),
    key = (x, y) => y * GRID.nx + x,
    previous = new Map([[key(sx, sy), null]]),
    queue = [[sx, sy]];
  while (queue.length && !previous.has(key(gx, gy))) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID.nx || ny >= GRID.ny || previous.has(key(nx, ny))) continue;
      if (blocked(nx, ny) && !(nx === gx && ny === gy)) continue;
      previous.set(key(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  const route = [];
  for (let at = previous.has(key(gx, gy)) ? [gx, gy] : null; at; at = previous.get(key(...at)))
    route.push({ x: GRID.x0 + at[0] * CELL, y: GRID.y0 + at[1] * CELL });
  return route.reverse();
}
/** Replay `commands` (one per frame since the observation) from the observed state. */
function replay(seen, player, commands, hz) {
  let { x, y, vx, vy } = player;
  const m = 1 + (seen.parcel.status === 'carried' ? seen.parcel.mass : 0),
    dt = 1 / hz / SUBSTEPS;
  for (const c of commands)
    for (let i = 0; i < SUBSTEPS; i++) {
      const zone = seen.zones.find((q) => x >= q.from && x < q.to) || seen.zones.at(-1),
        supported = (y >= 263.99 && c.gravity > 0) || (y <= 64.01 && c.gravity < 0);
      vx += ((c.axis * 360 - (supported ? 6 : 3) * vx) / m) * dt;
      x += vx * dt;
      vy += c.gravity * zone.g * dt;
      y += vy * dt;
      if ((y > 264 && vy > 0) || (y < 64 && vy < 0)) vy = 0;
      y = clampTo(y, 64, 264);
    }
  return { x, y, vx, vy };
}
function makePilot(hz, delay, { noise = 0, lead = false, seed = 7 } = {}) {
  const lag = Math.round(delay * hz),
    rng = seeded(seed),
    gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()),
    history = [],
    sent = [];
  let commanded = null,
    lastFlip = -9,
    lastHandoff = -9,
    plan = { key: '', route: [] };
  return (now) => {
    history.push(now);
    const seen = history[Math.max(0, history.length - 1 - lag)],
      keys = [],
      pressed = [];
    if (seen.mode === 'clear') {
      if (seen.time - lastHandoff > 0.5) pressed.push('KeyX');
      if (pressed.length) lastHandoff = seen.time;
      sent.push({ axis: 0, gravity: commanded ?? 1 });
      return input(keys, pressed);
    }
    if (commanded === null || plan.level !== seen.level) commanded = seen.gravity;
    if (seen.time >= lastFlip + delay + 0.1 && seen.gravity !== commanded) commanded = seen.gravity;
    const sp = seen.player,
      blurred = {
        x: sp.x + gauss() * noise * 3,
        y: sp.y + gauss() * noise * 3,
        vx: sp.vx + gauss() * noise * 8,
        vy: sp.vy + gauss() * noise * 8,
      },
      p = lead
        ? { ...sp, x: sp.x + sp.vx * delay, y: clampTo(sp.y + sp.vy * delay, 64, 264) }
        : replay(seen, blurred, sent.slice(Math.max(0, sent.length - lag)), hz),
      parcel = seen.parcel,
      toSource = parcel.status === 'stored' || (parcel.status === 'carried' && !parcel.integrity),
      pad = toSource ? seen.source : seen.destination,
      key = `${seen.level}:${toSource}`;
    if (plan.key !== key)
      plan = {
        key,
        level: seen.level,
        route: planRoute(seen, pad, 8),
      };
    const docked =
      Math.abs(p.x - pad.x) <= 18 &&
      Math.abs(p.vx) <= 5 &&
      Math.abs(p.y - pad.y) < 1 &&
      Math.abs(p.vy) < 1 &&
      commanded === pad.side;
    const staleDock =
      lead && ['slow', 'deliver', 'collect', 'repack'].includes(seen.docking.reason);
    if ((docked || staleDock) && seen.time - lastHandoff > (staleDock ? 0.2 : 0.4)) {
      pressed.push('KeyX');
      lastHandoff = seen.time;
    }
    const route = plan.route;
    let nearest = 0,
      best = Infinity;
    route.forEach((n, i) => {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < best) [best, nearest] = [d, i];
    });
    let ahead = nearest;
    while (ahead < route.length - 1 && Math.hypot(route[ahead].x - p.x, route[ahead].y - p.y) < 30)
      ahead++;
    const target = route[ahead] || pad,
      final = ahead >= route.length - 1,
      tx = target.x,
      ty = final ? pad.y + pad.side * 30 : target.y,
      horizontalCap = Math.min(110, parcel.safeSpeed * 0.8),
      verticalCap = parcel.safeSpeed * 0.7,
      dx = Math.abs(tx - p.x) < 4 ? 0 : clampTo(tx - p.x, -horizontalCap, horizontalCap),
      ey = ty - p.y,
      dy =
        Math.abs(ey) < 6
          ? 0
          : clampTo(Math.sign(ey) * Math.max(45, Math.abs(1.2 * ey)), -verticalCap, verticalCap),
      band = lead ? 20 : 10,
      bandY = lead ? 25 : 15;
    const axis = dx * 1.5 - p.vx > band ? 1 : dx * 1.5 - p.vx < -band ? -1 : 0;
    if (axis > 0) keys.push('ArrowRight');
    else if (axis < 0) keys.push('ArrowLeft');
    let want = dy - p.vy > bandY ? 1 : dy - p.vy < -bandY ? -1 : commanded;
    if (lead && final && Math.abs(p.y - pad.y) < 30 && Math.abs(p.x - pad.x) < 30) want = pad.side;
    if (want !== commanded && seen.time >= lastFlip + 0.3) {
      pressed.push('Space');
      commanded = want;
      lastFlip = seen.time;
    }
    sent.push({ axis, gravity: commanded });
    return input(keys, pressed);
  };
}
/** Fly `level` with a pilot; returns the end state and what the flight cost. */
function fly(level, hz, delay, options = {}) {
  const { g, h } = open(level, { seed: options.seed ?? 1, lang: options.lang }),
    pilot = makePilot(hz, delay, options),
    limit = (options.limit ?? CLEAR_LIMIT) * hz;
  let frames = 0,
    damage = 0,
    integrity = g.getState().parcel.integrity;
  for (; frames < limit; frames++) {
    const now = g.getState();
    if (now.level > level || now.phase !== 'playing') break;
    if (now.parcel.integrity < integrity) damage++;
    integrity = now.parcel.integrity;
    g.update(1 / hz, pilot(now));
  }
  const end = g.getState();
  return {
    g,
    h,
    end,
    damage,
    seconds: frames / hz,
    flips: end.flips,
    cleared: end.level > level || end.phase === 'won',
  };
}

// ---------------------------------------------------------------------------------------------
// Blind players: idle, mash, random keys and simple timed patterns.
// ---------------------------------------------------------------------------------------------
const timed = (flipEvery, turnEvery) => (_, frame) => {
  const t = frame / 60,
    right = turnEvery ? Math.floor(t / turnEvery) % 2 === 0 : true;
  return input(
    [right ? 'ArrowRight' : 'ArrowLeft'],
    [
      ...(frame % Math.round(flipEvery * 60) === 0 ? ['Space'] : []),
      ...(frame % 15 === 0 ? ['KeyX'] : []),
    ],
  );
};
const POLICIES = {
  idle: () => input(),
  mash: () => input([], ['Space', 'ArrowUp', 'Enter', 'KeyX']),
  random: (rng, frame, memory) => {
    if (frame % 12 === 0)
      memory.held = [['ArrowLeft'], ['ArrowRight'], [], ['ArrowLeft'], ['ArrowRight']][
        Math.floor(rng() * 5)
      ];
    return input(memory.held, rng() < 0.15 ? ['Space'] : rng() < 0.1 ? ['KeyX'] : []);
  },
  'hold + flip 0.5 s': timed(0.5, 0),
  'hold + flip 1.2 s, turn 2 s': timed(1.2, 2),
  'flip 0.8 s, turn 1 s': timed(0.8, 1),
  'flip 1.8 s, turn 3 s': timed(1.8, 3),
};
function blindWins(policy, level, seed) {
  const { g } = open(level, { seed }),
    rng = seeded(seed * 31 + level),
    memory = { held: [] };
  for (let frame = 0; frame < BLIND_HORIZON * 60; frame++) {
    const now = g.getState();
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / 60, POLICIES[policy](rng, frame, memory));
  }
  const end = g.getState();
  return end.level > level || end.phase === 'won';
}

// ---------------------------------------------------------------------------------------------
// The chamber table.
// ---------------------------------------------------------------------------------------------
const featuresOf = (room) => ({
  walls: room.walls.length > 0,
  zones: room.zones.length > 1,
  heavy: room.mass > 0.65,
  glass: room.integrity < 3,
  window: windowsOf(room).length > 0,
  topSource: room.source.side < 0,
  oneHit: room.integrity === 1,
});
test('there are twenty distinct data-driven chambers, each with a name and a bilingual tip', () => {
  assert.equal(LEVEL_COUNT, 20);
  const layouts = COURIER_ROOMS.map((r) =>
    JSON.stringify([r.walls, r.zones, r.source, r.destination, r.integrity, r.safeSpeed, r.mass]),
  );
  assert.equal(new Set(layouts).size, LEVEL_COUNT);
  assert.equal(new Set(COURIER_ROOMS.map((r) => r.name[0])).size, LEVEL_COUNT);
  for (const r of COURIER_ROOMS) {
    assert.ok(r.name[0] && CJK.test(r.name[1]));
    assert.ok(r.tip[0].length > 20 && CJK.test(r.tip[1]));
  }
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel('x'), 1);
  assert.equal(clampLevel(99), LEVEL_COUNT);
  assert.equal(clampLevel('7'), 7);
});
test('exported chamber data is frozen all the way down', () => {
  const frozen = (value) =>
    !value ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(frozen));
  assert.ok(frozen(COURIER_ROOMS));
  assert.throws(() => {
    'use strict';
    COURIER_ROOMS[0].walls.push({});
  });
  const s = createCourierState(6);
  s.player.x = 1;
  assert.equal(createCourierState(6).player.x, COURIER_ROOMS[5].source.x);
});
test('chambers fit the hull and keep both pads and the start clear of walls', () => {
  for (const [i, r] of COURIER_ROOMS.entries()) {
    for (const w of r.walls) {
      assert.ok(w.x >= 24 && w.x + w.w <= 456 && w.y >= 52 && w.y + w.h <= 276, `room ${i + 1}`);
      for (const pad of [r.source, r.destination]) {
        const [top, bottom] = pad.side > 0 ? [250, 276] : [52, 78];
        const clear =
          w.x + w.w <= pad.x - 24 || w.x >= pad.x + 24 || w.y + w.h <= top || w.y >= bottom;
        assert.ok(clear, `room ${i + 1} wall at ${w.x} covers a pad`);
      }
    }
    assert.deepEqual(r.zones[0].from, 24);
    assert.deepEqual(r.zones.at(-1).to, 456);
    r.zones.forEach((z, k) => k && assert.equal(z.from, r.zones[k - 1].to));
    assert.ok(r.source.x !== r.destination.x || r.source.side !== r.destination.side);
  }
});
test('the curve teaches one idea at a time, then combines, then masters', () => {
  const firstSeen = {};
  LEVELS.forEach((n) => {
    for (const [key, on] of Object.entries(featuresOf(COURIER_ROOMS[n - 1])))
      if (on) firstSeen[key] ??= n;
  });
  assert.deepEqual(firstSeen, {
    topSource: 3,
    walls: 4,
    zones: 7,
    heavy: 9,
    glass: 10,
    window: 11,
    oneHit: 17,
  });
  const weight = (r) => r.walls.length + r.zones.length + Number(r.mass > 0.65) + (3 - r.integrity);
  const mean = (list) =>
    list.reduce((sum, n) => sum + weight(COURIER_ROOMS[n - 1]), 0) / list.length;
  assert.ok(
    mean(TEACHING) < mean(LEVELS.slice(6, 14)) && mean(LEVELS.slice(6, 14)) < mean(MASTERY),
  );
  for (const n of MASTERY) assert.ok(COURIER_ROOMS[n - 1].walls.length >= 3, `mastery ${n}`);
});
test('every tip names only what its chamber really contains', () => {
  const words = { three: 3, four: 4 };
  for (const [i, r] of COURIER_ROOMS.entries()) {
    const [en, zh] = r.tip,
      id = `tip ${i + 1}`;
    if (/window/i.test(en)) {
      assert.ok(windowsOf(r).length, id);
      assert.match(zh, /窗口/);
    }
    for (const [word, count] of Object.entries(words)) {
      const m = en.match(new RegExp(`${word} (windows|gates)`, 'i'));
      if (m) assert.equal(m[1] === 'windows' ? windowsOf(r).length : r.walls.length, count, id);
    }
    if (/gate/i.test(en)) assert.match(zh, /闸门/);
    if (/hanging/i.test(en)) assert.ok(hangsOf(r).length, id);
    if (/post/i.test(en)) assert.ok(postsOf(r).length, id);
    if (/heavy/i.test(en)) assert.ok(r.mass > 0.65, id);
    if (/glass|fragile/i.test(en)) assert.ok(r.integrity < 3, id);
    if (/one hit|single hit/i.test(en)) assert.equal(r.integrity, 1, id);
    if (/Field (\d+)/.test(en))
      assert.ok(
        r.zones.some((z) => z.g === Number(en.match(/Field (\d+)/)[1])),
        id,
      );
    if (/Glass breaks above speed (\d+)/.test(en))
      assert.equal(r.safeSpeed, Number(en.match(/speed (\d+)/)[1]), id);
    if (/weaker right/i.test(en)) assert.ok(r.zones[1].g < r.zones[0].g, id);
    if (/stronger right/i.test(en)) assert.ok(r.zones[1].g > r.zones[0].g, id);
    if (/weak: slow/i.test(en))
      assert.ok(
        r.zones.every((z) => z.g <= 90),
        id,
      );
    if (/Three field strengths/i.test(en)) assert.equal(new Set(r.zones.map((z) => z.g)).size, 3);
    if (/Alternate low and high/i.test(en)) assert.ok(hangsOf(r).length && postsOf(r).length, id);
  }
});

// ---------------------------------------------------------------------------------------------
// Clears: the scripted legal pilot, then the reaction-limited pilot at 30, 60 and 120 Hz.
// ---------------------------------------------------------------------------------------------
test('a scripted legal pilot clears every chamber through the public input', () => {
  for (const n of LEVELS) {
    const run = fly(n, 60, 0);
    assert.ok(run.cleared, `chamber ${n} not cleared in ${run.seconds}s`);
    assert.equal(run.end.phase, n === LEVEL_COUNT ? 'won' : 'playing');
    assert.equal(run.end.deliveries, 1);
    assert.equal(run.damage, 0);
  }
});
test('a reaction-limited pilot clears every chamber at 30, 60 and 120 Hz with spares to spare', () => {
  for (const hz of HZS)
    for (const delay of DELAYS)
      for (const n of LEVELS) {
        const run = fly(n, hz, delay, { noise: 1 });
        assert.ok(run.cleared, `chamber ${n} at ${hz} Hz, ${delay} s: ${run.end.phase}`);
        assert.ok(run.end.spares >= 2, `chamber ${n} cost ${3 - run.end.spares} spares`);
        assert.ok(run.seconds < 60, `chamber ${n} took ${run.seconds}s`);
      }
});
test('the pilot pays more in the mastery tier, and a weaker pilot cannot finish it', () => {
  const cost = (levels, options) => {
    const runs = levels.map((n) => fly(n, 60, 0.35, options));
    return {
      cleared: runs.filter((r) => r.cleared).length,
      damage: runs.reduce((sum, r) => sum + r.damage, 0),
      flips: runs.reduce((sum, r) => sum + r.flips, 0) / runs.length,
      seconds: runs.reduce((sum, r) => sum + r.seconds, 0) / runs.length,
    };
  };
  const teaching = cost(TEACHING, { noise: 1 }),
    mastery = cost(MASTERY, { noise: 1 });
  assert.equal(teaching.cleared + mastery.cleared, 12);
  assert.ok(mastery.flips >= teaching.flips * 1.25, `${mastery.flips} vs ${teaching.flips} flips`);
  assert.ok(mastery.seconds > teaching.seconds * 1.05);
  const weakTeaching = cost(TEACHING, { lead: true }),
    weakMastery = cost(MASTERY, { lead: true });
  assert.ok(weakTeaching.cleared >= 5, `weak pilot cleared ${weakTeaching.cleared} of 6`);
  assert.ok(weakMastery.cleared <= 4, `weak pilot cleared ${weakMastery.cleared} of 6 mastery`);
  assert.ok(weakMastery.damage > weakTeaching.damage + 2);
});
test('idle, mash, random and timed players win at most a quarter of any chamber from chamber 3', () => {
  for (const policy of Object.keys(POLICIES)) {
    const seeds = policy === 'random' ? BLIND_SEEDS : [1];
    for (const n of BLIND_LEVELS) {
      const wins = seeds.filter((seed) => blindWins(policy, n, seed)).length;
      assert.ok(wins / seeds.length <= 0.25, `${policy} won ${wins} of ${seeds.length} on ${n}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Fair start.
// ---------------------------------------------------------------------------------------------
test('a new player can read the opening: an idle first minute loses nothing and hides nothing', () => {
  const { g, h } = open(1, { progress: null });
  for (let i = 0; i < 60 * 60; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.menu, null);
  assert.equal(s.spares, 3);
  assert.equal(s.parcel.status, 'stored');
  assert.equal(s.parcel.integrity, 3);
  assert.deepEqual([s.player.x, s.player.y], [64, 264]);
  assert.equal(h.ends.length, 0);
  const text = [],
    ctx = mockContext();
  ctx.fillText = (value) => text.push(String(value));
  g.draw(ctx);
  assert.ok(text.some((line) => line.includes(COURIER_ROOMS[0].name[0])));
  assert.ok(text.some((line) => line === COURIER_ROOMS[0].tip[0]));
  assert.ok(text.some((line) => line.includes('X TO COLLECT')));
});
test('every chamber opens with the courier on its source pad and a clear start', () => {
  for (const n of LEVELS) {
    const { g } = open(n),
      s = g.getState(),
      r = COURIER_ROOMS[n - 1];
    assert.deepEqual([s.player.x, s.player.y, s.gravity], [r.source.x, r.source.y, r.source.side]);
    assert.equal(s.docking.reason, 'collect');
    for (let i = 0; i < 60 * 10; i++) g.update(1 / 60, input());
    assert.equal(g.getState().phase, 'playing');
    assert.deepEqual(
      [g.getState().player.x, g.getState().player.y],
      [r.source.x, r.source.y],
      `idle chamber ${n}`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Select and continue.
// ---------------------------------------------------------------------------------------------
test('the chamber select offers saved progress and starts the chosen chamber', () => {
  const store = memoryStore(9),
    { g, h } = open(9, { progress: store, launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 9, unlocked: 9, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  assert.match(s.status.en, /Choose a chamber/);
  assert.match(s.status.zh, /选择舱室/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 8);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 3);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 8);
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 9, 'locked chambers cannot be reached by keys');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['KeyX']));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 8);
  assert.deepEqual(
    [s.player.x, s.player.y],
    [64, 264].map((v, i) => [COURIER_ROOMS[7].source.x, COURIER_ROOMS[7].source.y][i]),
  );
  assert.ok(h.sounds.includes('move'));
  g.draw(mockContext());
});
test('tapping a chamber starts it and tapping a locked one is refused', () => {
  const { g, h } = open(4, { launch: false }),
    centre = (n) => {
      const c = menuCell(n);
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true };
    };
  g.update(1 / 60, input([], [], centre(12)));
  assert.ok(g.getState().menu);
  assert.ok(h.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: 3, y: 315, clicked: true }));
  assert.ok(g.getState().menu);
  g.update(1 / 60, input([], [], centre(2)));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().menu, null);
  assert.deepEqual(meta.touchControls.map((c) => c.code).sort(), [
    'ArrowLeft',
    'ArrowRight',
    'KeyX',
    'Space',
  ]);
});
test('clearing a chamber unlocks the next and never lowers the saved value', () => {
  const store = memoryStore(1),
    run = fly(1, 60, 0, {});
  assert.ok(run.cleared);
  const { g } = open(1, { progress: store });
  const pilot = makePilot(60, 0);
  for (let i = 0; i < 60 * 60 && g.getState().level === 1; i++)
    g.update(1 / 60, pilot(g.getState()));
  assert.deepEqual(store.calls, [2]);
  assert.equal(store.value, 2);
  assert.equal(g.getState().unlocked, 2);
  const high = memoryStore(9),
    again = open(9, { progress: high, launch: false }),
    second = makePilot(60, 0);
  for (let i = 0; i < 6; i++) again.g.update(1 / 60, input([], ['ArrowLeft']));
  again.g.update(1 / 60, input([], ['Space']));
  assert.equal(again.g.getState().level, 3);
  for (let i = 0; i < 60 * 60 && again.g.getState().level === 3; i++)
    again.g.update(1 / 60, second(again.g.getState()));
  assert.equal(high.value, 9);
  assert.deepEqual(high.calls, [4]);
});
test('a broken, throwing or junk progress store never stops play', () => {
  const stores = [
    undefined,
    null,
    {},
    { unlocked: () => 1 },
    {
      unlocked: () => {
        throw new Error('storage blocked');
      },
      unlock: () => {
        throw new Error('storage full');
      },
    },
  ];
  for (const progress of stores) {
    const { g } = open(1, { progress });
    const pilot = makePilot(60, 0);
    for (let i = 0; i < 60 * 60 && g.getState().level === 1; i++)
      g.update(1 / 60, pilot(g.getState()));
    assert.equal(g.getState().level, 2);
  }
  const junk = [NaN, -5, 0, 0.4, 1e9, Infinity, -Infinity, '7', 'x', null, undefined, {}, [3]];
  for (const value of junk) {
    const { g } = open(1, { progress: { unlocked: () => value, unlock() {} }, launch: false });
    const s = g.getState();
    const expected = Number.isFinite(Math.floor(Number(value))) ? Math.floor(Number(value)) : 1;
    assert.equal(s.unlocked, Math.min(LEVEL_COUNT, Math.max(1, expected)), String(value));
    if (s.menu) assert.ok(s.menu.cursor >= 1 && s.menu.cursor <= LEVEL_COUNT);
    g.draw(mockContext());
  }
});

// ---------------------------------------------------------------------------------------------
// Input is never dropped, frame rates agree, hostile values are harmless.
// ---------------------------------------------------------------------------------------------
test('a flip tapped during the repack, the clear screen hand-off and cooldown still takes effect', () => {
  const h = harness(),
    s = createCourierState(1);
  s.parcel.status = 'carried';
  s.parcel.integrity = 1;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.mode, 'repack');
  stepCourier(s, 1 / 120, input([], ['Space']), h.env);
  while (s.mode === 'repack') stepCourier(s, 1 / 120, input(), h.env);
  assert.equal(s.gravity, -1);
  for (let i = 0; i < 12; i++) stepCourier(s, 1 / 120, input(), h.env);
  stepCourier(s, 1 / 120, input([], ['Space']), h.env);
  assert.equal(s.gravity, -1, 'second flip waits for the cooldown');
  for (let i = 0; i < 60; i++) stepCourier(s, 1 / 120, input(), h.env);
  assert.equal(s.gravity, 1);
  assert.equal(s.flips, 2);
});
test('scripted input gives the same flight at 30, 60 and 120 Hz', () => {
  const script = (t) => ({
    held: t < 1.5 ? ['ArrowRight'] : t < 3 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: [
      ...(Math.abs(t) < 1e-9 ? ['KeyX'] : []),
      ...([0.3, 1.1, 1.9, 2.8, 3.6, 4.4, 5.3].some((q) => Math.abs(q - t) < 1e-9) ? ['Space'] : []),
    ],
  });
  for (const n of [6, 14, 20]) {
    const states = HZS.map((hz) => {
      const { g } = open(n);
      for (let i = 0; i < 6 * hz; i++) {
        const { held, pressed } = script(Math.round((i / hz) * 1e6) / 1e6);
        g.update(1 / hz, input(held, pressed));
      }
      return g.getState();
    });
    for (const s of states.slice(1)) {
      for (const k of ['x', 'y', 'vx', 'vy'])
        assert.ok(Math.abs(s.player[k] - states[0].player[k]) < 1e-6, `${n} ${k}`);
      assert.equal(s.parcel.integrity, states[0].parcel.integrity);
      assert.equal(s.impacts.length, states[0].impacts.length);
    }
  }
});
test('hostile frame times and pointer values never corrupt a run', () => {
  const dts = [NaN, -1, 0, Infinity, -Infinity, '0.5', null, undefined, {}, 1e9, 1e-12, 5];
  const pointers = [
    { x: NaN, y: NaN, clicked: true },
    { x: '10', y: '20', clicked: true },
    { x: Infinity, y: -Infinity, clicked: true, down: true },
    { x: null, y: undefined, clicked: 1 },
    { clicked: true },
  ];
  for (const level of [1, 12]) {
    const { g, h } = open(level, { launch: level === 1 });
    for (const dt of dts)
      for (const pointer of pointers) {
        g.update(dt, input(['ArrowRight'], ['Space', 'KeyX'], pointer));
        finiteDeep(g.getState());
      }
    g.draw(mockContext());
    assert.equal(h.ends.length, 0);
  }
  const { g } = open(1);
  g.update(1e9, input(['ArrowRight']));
  assert.ok(g.getState().time <= 1 / 30 + 1e-9);
  g.update(1 / 60, { held: () => false, pressed: () => false });
  assert.ok(g.getState().time > 0);
});

// ---------------------------------------------------------------------------------------------
// End states, messages and text.
// ---------------------------------------------------------------------------------------------
function crashOut(lang) {
  const { g, h } = open(1, { lang, progress: null });
  g.update(1 / 60, input([], ['KeyX']));
  for (let attempt = 0; attempt < 4 && g.getState().phase === 'playing'; attempt++) {
    for (let i = 0; i < 2; i++) {
      g.update(1 / 60, input([], ['Space']));
      for (let k = 0; k < 120; k++) g.update(1 / 60, input());
    }
    g.update(1 / 60, input([], ['KeyX']));
    for (let k = 0; k < 48; k++) g.update(1 / 60, input());
  }
  return { g, h };
}
test('a won run ends once with an EN or ZH message and then stays frozen', () => {
  for (const lang of ['en', 'zh']) {
    const run = fly(20, 60, 0, { lang });
    assert.equal(run.end.phase, 'won');
    assert.equal(run.h.ends.length, 1);
    assert.equal(run.h.ends[0].won, true);
    assert.equal(run.h.ends[0].score, run.end.score);
    assert.match(run.h.ends[0].message, lang === 'en' ? /delivered/ : /送达/);
    const frozen = run.g.getState();
    for (let i = 0; i < 120; i++)
      run.g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX', 'Enter']));
    assert.deepEqual(run.g.getState(), frozen);
    assert.equal(run.h.ends.length, 1);
    assert.match(run.g.getState().status[lang], lang === 'en' ? /ALL SHIPMENTS/ : /全部送达/);
  }
});
test('running out of spare packs ends once with an EN or ZH message and then stays frozen', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = crashOut(lang);
    assert.equal(g.getState().phase, 'lost');
    assert.equal(g.getState().spares, 0);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'en' ? /No spare packaging/ : /备用包装/);
    const frozen = g.getState();
    for (let i = 0; i < 120; i++)
      g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX', 'Enter']));
    assert.deepEqual(g.getState(), frozen);
    assert.equal(h.ends.length, 1);
  }
});
/** Width of a drawn line, counting wide (CJK) glyphs as one em and narrow ones as 0.62 em. */
const drawnWidth = (value, size) =>
  [...value].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 0x2e80 ? 0.62 : 1) * size, 0);
function linesOf(g, h) {
  const lines = [],
    ctx = mockContext();
  ctx.fillText = (value, x) => {
    const size = Number(ctx.font.match(/(\d+)px/)[1]),
      width = drawnWidth(String(value), size),
      left = ctx.textAlign === 'center' ? x - width / 2 : ctx.textAlign === 'right' ? x - width : x;
    lines.push({ value: String(value), size, left, right: left + width });
  };
  g.draw(ctx);
  return { lines, h };
}
test('EN and ZH text fits the 480 px canvas in every chamber, cue and the select screen', () => {
  for (const lang of ['en', 'zh']) {
    const check = (g, label) => {
      const { lines } = linesOf(g, null);
      for (const l of lines) {
        assert.ok(l.size >= 14, `${label}: "${l.value}" is ${l.size}px`);
        assert.ok(
          l.left >= 0 && l.right <= CANVAS_WIDTH,
          `${label}: "${l.value}" spans ${l.left}-${l.right}`,
        );
      }
    };
    for (const n of LEVELS) {
      const { g } = open(n, { lang, launch: false });
      check(g, `${lang} select ${n}`);
      g.update(1 / 60, input([], ['Space']));
      check(g, `${lang} start ${n}`);
      const pilot = makePilot(60, 0.25),
        names = new Set();
      for (let i = 0; i < 60 * 30 && g.getState().level === n; i++) {
        g.update(1 / 60, pilot(g.getState()));
        if (i % 20 === 0) {
          check(g, `${lang} flight ${n}`);
          names.add(g.getState().docking.reason);
        }
      }
    }
  }
});
test('every prompt the courier can show is bilingual and fits', () => {
  const carriedAt =
    (x, y, integrity = 3, vx = 0) =>
    (s) => ({
      ...s,
      player: { ...s.player, x, y, vx },
      parcel: { ...s.parcel, status: 'carried', integrity },
    });
  const scenes = [
    (s) => ({ ...s, mode: 'clear' }),
    (s) => ({ ...s, mode: 'repack' }),
    (s) => ({ ...s, phase: 'won' }),
    (s) => ({ ...s, phase: 'lost' }),
    carriedAt(200, 200, 0),
    carriedAt(200, 200),
    carriedAt(64, 264, 3, 40),
    carriedAt(64, 230),
    (s) => ({ ...s, player: { ...s.player, x: 200, y: 200 } }),
    (s) => ({
      ...carriedAt(200, 200)(s),
      feedback: 'damaged',
      feedbackTime: 2,
      impacts: [{ normals: [{ x: 1, y: 1 }] }],
    }),
  ];
  for (const lang of ['en', 'zh'])
    for (const [i, scene] of scenes.entries()) {
      const h = harness({ lang }),
        ctx = mockContext(),
        spans = [];
      ctx.fillText = (value) => spans.push({ value, width: drawnWidth(String(value), 14) });
      drawCourier(ctx, scene(createCourierState(6)), h.env);
      assert.ok(spans.length > 4, `scene ${i}`);
      for (const span of spans)
        assert.ok(span.width <= CANVAS_WIDTH, `${lang} scene ${i}: ${span.value}`);
    }
});
test('delivery saves the next chamber at once, before the clear screen is dismissed', () => {
  const store = memoryStore(1),
    { g } = open(1, { progress: store }),
    pilot = makePilot(60, 0);
  for (let i = 0; i < 60 * 60 && g.getState().mode !== 'clear'; i++)
    g.update(1 / 60, pilot(g.getState()));
  assert.equal(g.getState().mode, 'clear');
  assert.deepEqual(store.calls, [2]);
  for (let i = 0; i < 30; i++) g.update(1 / 60, input());
  assert.deepEqual(store.calls, [2], 'saved once');
  const throwing = open(1, {
      progress: {
        unlocked: () => 1,
        unlock: () => {
          throw new Error('full');
        },
      },
    }),
    second = makePilot(60, 0);
  for (let i = 0; i < 60 * 60 && throwing.g.getState().mode !== 'clear'; i++)
    throwing.g.update(1 / 60, second(throwing.g.getState()));
  assert.equal(throwing.g.getState().unlocked, 2);
});
test('a second flip pressed just after a flip is kept at every delay up to the cooldown', () => {
  for (const hz of HZS)
    for (let k = 0; k <= Math.round(0.3 * hz); k++) {
      const h = harness(),
        s = createCourierState(1);
      stepCourier(s, 1 / hz, input([], ['Space']), h.env);
      for (let i = 0; i < k; i++) stepCourier(s, 1 / hz, input(), h.env);
      stepCourier(s, 1 / hz, input([], ['Space']), h.env);
      for (let i = 0; i < 0.6 * hz; i++) stepCourier(s, 1 / hz, input(), h.env);
      assert.equal(s.flips, 2, `${hz} Hz, ${k} frames after the first flip`);
    }
});
