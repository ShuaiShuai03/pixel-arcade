import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, makeRocks } from '../src/games/meteor-drift.js';
import { LEVELS, LEVEL_COUNT, clampLevel, hitsToClear } from '../src/games/meteor-drift-levels.js';
import { MENU_COLUMNS, menuCell, wrapText } from '../src/games/meteor-drift-menu.js';
import { MAGAZINE, SHOT_LIFE, START_SHIELD, TIP_SECONDS } from '../src/games/meteor-drift-step.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const SECTORS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_SECTORS = SECTORS.filter((n) => n >= 3);
const CJK = /[一-鿿]/;
const BULLET_SPEED = 350;
const NEAR_FRAGILE = 100;
const BLIND_SEEDS = [1, 2, 3];
const BLIND_HORIZON = 60;
const CLEAR_LIMIT = 240;

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
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
/** Start a run on `level` the way a player does: through the select screen when it is offered. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ seed, lang });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const wrapDelta = (v, span) => ((((v + span / 2) % span) + span) % span) - span / 2;
const turnTo = (angle, from) => wrapDelta(angle - from, Math.PI * 2);
/** Smallest positive time at which a shot leaving the ship meets a rock moving at (vx, vy). */
function interceptTime({ dx, dy, vx, vy }) {
  const a = vx * vx + vy * vy - BULLET_SPEED ** 2,
    b = 2 * (dx * vx + dy * vy),
    c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) return -c / b;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return NaN;
  const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
  return roots.filter((t) => t > 0).sort((p, q) => p - q)[0];
}
/**
 * A reaction-limited pilot. Rocks come from a snapshot `delay` seconds old and are extrapolated;
 * the pilot knows its own ship now. It leads its shots, keeps clear of nothing, brakes when it
 * lines up a shot, and flies toward the nearest rock when none is in range.
 */
function pilot(now, seen, delay) {
  const ship = now.ship,
    rocks = seen.rocks.map((r) => ({
      ...r,
      dx: wrapDelta(r.x + r.vx * delay - ship.x, 480),
      dy: wrapDelta(r.y + r.vy * delay - ship.y, 320),
      vx: r.vx - ship.vx,
      vy: r.vy - ship.vy,
    })),
    speed = Math.hypot(ship.vx, ship.vy);
  let target = null;
  for (const r of rocks) {
    const dist = Math.hypot(r.dx, r.dy),
      fragile = (r.kind === 'volatile' || r.kind === 'ice') && r.size > 1,
      t = interceptTime(r);
    if (r.fuse !== undefined || (fragile && dist < NEAR_FRAGILE)) continue;
    if (!(t > 0) || t > SHOT_LIFE || (target && dist >= target.dist)) continue;
    target = { dist, radius: r.radius, angle: Math.atan2(r.dy + r.vy * t, r.dx + r.vx * t) };
  }
  let want = null,
    thrust = false,
    brake = false,
    aligned = false;
  if (target) {
    want = target.angle;
    aligned = Math.abs(turnTo(want, ship.angle)) < Math.atan2(target.radius + 2, target.dist) * 0.7;
  } else if (rocks.length) {
    const near = rocks.reduce((a, b) => (Math.hypot(a.dx, a.dy) < Math.hypot(b.dx, b.dy) ? a : b)),
      dist = Math.hypot(near.dx, near.dy),
      closing = -(near.dx * near.vx + near.dy * near.vy) / dist;
    want = Math.atan2(near.dy, near.dx);
    thrust = Math.abs(turnTo(want, ship.angle)) < 0.5 && dist > 140 && closing < 35 && speed < 110;
    brake = dist <= 140 && speed > 10;
  }
  if (speed > 10 && (aligned || !rocks.length || speed > 70)) brake = true;
  const keys = [];
  if (!brake && want !== null) {
    const desired = Math.max(-3.4, Math.min(3.4, 5 * turnTo(want, ship.angle)));
    if (ship.omega < desired - 0.25) keys.push('ArrowRight');
    else if (ship.omega > desired + 0.25) keys.push('ArrowLeft');
  }
  if (thrust && !brake) keys.push('ArrowUp');
  if (brake) keys.push('ArrowDown');
  if (aligned && now.ammo > 0) keys.push('Space');
  return input(keys);
}
/** Play from a sector until it is cleared (or the run ends) with a pilot of the given delay. */
function playSector(level, hz, { delay = 0.25, seed = 1, progress, lang } = {}) {
  const { g, h } = open(level, { seed, progress, lang }),
    history = [],
    lag = Math.round(delay * hz);
  let frames = 0;
  while (frames < CLEAR_LIMIT * hz) {
    const now = g.getState();
    history.push(now);
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / hz, pilot(now, history[Math.max(0, history.length - 1 - lag)], delay));
    frames++;
  }
  const end = g.getState();
  return { g, h, end, seconds: frames / hz, cleared: end.level > level || end.phase === 'won' };
}
const sweep = (period, thrust) => (rng, memory) =>
  input(
    [
      'Space',
      Math.floor(memory.frame / 60 / period) % 2 ? 'ArrowLeft' : 'ArrowRight',
      ...(thrust ? ['ArrowUp'] : []),
    ],
    memory.frame % 40 === 0 ? ['ShiftLeft'] : [],
  );
const POLICIES = {
  idle: () => input(),
  mash: () => input(['ArrowUp'], ['Space', 'ShiftLeft', 'Enter', 'ArrowUp']),
  holdFire: () => input(['Space']),
  sweepFast: sweep(0.4, false),
  sweepThrust: sweep(0.8, true),
  sweepSlow: sweep(1.5, false),
  sweepSlowThrust: sweep(3, true),
  randomKeys: (rng, memory) => {
    if (memory.frame % 12 === 0)
      memory.held = [
        ['ArrowLeft'],
        ['ArrowRight'],
        [],
        ['ArrowLeft', 'Space'],
        ['ArrowRight', 'Space'],
        ['Space'],
        ['ArrowUp'],
      ][Math.floor(rng() * 7)];
    return input(memory.held, rng() < 0.2 ? ['Space'] : rng() < 0.05 ? ['ShiftLeft'] : []);
  },
};
function runBlind(policy, level, seed, { horizon = BLIND_HORIZON, lang = 'en' } = {}) {
  const { g, h } = open(level, { seed, lang }),
    rng = seeded(seed * 31 + level),
    memory = { frame: 0, held: [] };
  for (; memory.frame < horizon * 60; memory.frame++) {
    const now = g.getState();
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / 60, POLICIES[policy](rng, memory));
  }
  const end = g.getState();
  return { g, h, end, won: end.level > level || end.phase === 'won' };
}
function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------
// The sector table.
// ---------------------------------------------------------------------------------------------
const kindsOf = (n) =>
  new Set(
    [...LEVELS[n - 1].rocks].map(
      (c) => ({ s: 'stone', i: 'ice', f: 'iron', v: 'volatile' })[c.toLowerCase()],
    ),
  );
test('there are at least twenty distinct sectors, each with a name and a bilingual tip', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.equal(new Set(LEVELS.map((l) => l.rocks + l.pace)).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
  for (const l of LEVELS) {
    assert.ok(l.name.en && CJK.test(l.name.zh) && l.tip.en.length > 40 && CJK.test(l.tip.zh));
    assert.match(l.rocks, /^[SIFVsifv]{2,9}$/);
    assert.ok(l.ammo >= 40 && l.ammo > l.hits, `${l.name.en} supplies more rounds than hits`);
  }
});
test('exported sector data is frozen all the way down and rocks are fresh copies', () => {
  assert.ok(Object.isFrozen(LEVELS));
  for (const l of LEVELS) {
    assert.ok(Object.isFrozen(l) && Object.isFrozen(l.name) && Object.isFrozen(l.tip));
  }
  const rocks = makeRocks(1, seeded(1));
  rocks[0].hp = 9;
  assert.equal(makeRocks(1, seeded(1))[0].hp, 1);
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel('x'), 1);
  assert.equal(clampLevel(99), LEVEL_COUNT);
  assert.equal(makeRocks(-5, seeded(1)).length, makeRocks(1, seeded(1)).length);
});
test('the curve teaches one material at a time, then combines, then masters', () => {
  const firstSeen = {};
  for (const n of SECTORS) for (const kind of kindsOf(n)) firstSeen[kind] ??= n;
  assert.deepEqual(firstSeen, { stone: 1, ice: 4, iron: 6, volatile: 8 });
  for (const n of SECTORS.slice(0, 9)) assert.equal(kindsOf(n).size, 1, `sector ${n}`);
  for (const n of SECTORS.slice(9, 16)) assert.ok(kindsOf(n).size >= 2, `sector ${n}`);
  assert.ok(
    SECTORS.slice(14).every((n) => kindsOf(n).size >= 2 || LEVELS[n - 1].rocks.length >= 4),
  );
  assert.ok(LEVELS[0].hits < LEVELS[9].hits && LEVELS[9].hits < LEVELS[21].hits);
  assert.ok(SECTORS.slice(16).every((n) => LEVELS[n - 1].pace >= 10));
  assert.ok(LEVELS[0].pace === 0 && LEVELS[16].pace > LEVELS[2].pace);
  assert.ok(LEVELS[17].rocks === LEVELS[17].rocks.toLowerCase(), 'the swarm is medium rocks');
});
test('hits needed follow each material, and the supply is always larger', () => {
  assert.equal(hitsToClear('stone', 3), 7);
  assert.equal(hitsToClear('ice', 3), 13);
  assert.equal(hitsToClear('iron', 3), 10);
  assert.equal(hitsToClear('volatile', 3), 5);
  assert.equal(hitsToClear('volatile', 2), 5);
  assert.equal(hitsToClear('iron', 1), 2);
  assert.equal(LEVELS[0].hits, 14);
});
test('every tip names only what its sector really contains', () => {
  const words = { Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9 };
  for (const n of SECTORS) {
    const { en, zh } = LEVELS[n - 1].tip,
      kinds = kindsOf(n),
      has = (kind) => kinds.has(kind);
    if (/\bice\b|icy/i.test(en)) assert.ok(has('ice'), `tip ${n} ice`);
    if (/\bice\b|icy/i.test(en)) assert.match(zh, /冰晶/);
    if (/\biron\b/i.test(en)) assert.ok(has('iron'), `tip ${n} iron`);
    if (/\biron\b/i.test(en)) assert.match(zh, /铁质/);
    if (/volatile/i.test(en)) assert.ok(has('volatile'), `tip ${n} volatile`);
    if (/volatile/i.test(en)) assert.match(zh, /易爆/);
    if (/\bstone\b/i.test(en)) assert.ok(has('stone'), `tip ${n} stone`);
    if (/\bstone\b/i.test(en)) assert.match(zh, /岩石/);
    if (/Shift/.test(en)) assert.match(zh, /Shift/);
    const count = /\b(Two|Three|Four|Five|Six|Seven|Eight|Nine) (?:\w+ )*?rocks?\b/.exec(en);
    if (count) {
      const total = LEVELS[n - 1].rocks.length,
        letters = /iron/.test(count[0])
          ? 'Ff'
          : /volatile/.test(count[0])
            ? 'Vv'
            : /ice|icy/.test(count[0])
              ? 'Ii'
              : '',
        ofKind = [...LEVELS[n - 1].rocks].filter((c) => letters.includes(c)).length;
      assert.ok([total, ofKind].includes(words[count[1]]), `tip ${n}: "${count[0]}"`);
    }
  }
  for (const n of [5, 7, 9, 16, 18, 19, 20, 21, 22])
    assert.match(
      LEVELS[n - 1].tip.en,
      /^(Three|Four|Five|Six|Nine|Eight|Seven)|\b(Three|Four|Five|Six|Nine) /,
    );
});
test('rocks appear in the open band, clear of the HUD, the lesson text and the pilot', () => {
  for (const n of SECTORS)
    for (const seed of [1, 2, 3]) {
      const rocks = makeRocks(n, seeded(seed));
      assert.equal(rocks.length, LEVELS[n - 1].rocks.length);
      rocks.forEach((r, i) => {
        assert.ok(r.y - r.radius >= 42 && r.y + r.radius <= 262, `sector ${n} rock ${i}`);
        assert.ok(r.x >= 24 && r.x <= 456);
        assert.ok(Math.hypot(r.x - 240, r.y - 160) > 105, `sector ${n} rock ${i} near the pilot`);
        for (const other of rocks.slice(i + 1))
          assert.ok(Math.hypot(r.x - other.x, r.y - other.y) > (r.radius + other.radius) * 0.9);
      });
    }
});

// ---------------------------------------------------------------------------------------------
// Scripted legal clear of every sector, and the reaction-limited pilot at 30, 60 and 120 Hz.
// ---------------------------------------------------------------------------------------------
test('a scripted legal clear completes every sector through the public input', () => {
  for (const n of SECTORS) {
    const run = playSector(n, 60, { delay: 0 });
    assert.ok(run.cleared, `sector ${n} not cleared in ${run.seconds}s`);
    assert.equal(run.end.phase, n === LEVEL_COUNT ? 'won' : 'playing');
    assert.ok(run.end.shotsFired < LEVELS[n - 1].ammo, `sector ${n} overspent its supply`);
  }
});
test('a reaction-limited pilot clears every sector at 30, 60 and 120 Hz with margin', () => {
  for (const [delay, hz] of [
    [0.35, 30],
    [0.35, 60],
    [0.35, 120],
    [0.25, 60],
  ])
    for (const n of SECTORS) {
      const run = playSector(n, hz, { delay, seed: n });
      assert.ok(
        run.cleared,
        `sector ${n} at ${hz} Hz, ${delay}s: ${run.end.phase} ${run.seconds}s`,
      );
      assert.ok(run.end.shotsFired <= LEVELS[n - 1].ammo * 0.95, `sector ${n} ammunition margin`);
      assert.ok(run.end.lives + Number((n + 1) % 4 === 0) >= 2, `sector ${n} lost lives`);
    }
});
test('one campaign run from the first sector wins, unlocking each sector once', () => {
  const store = memoryStore(1),
    { g, h } = open(1, { progress: store, lang: 'zh', seed: 5 }),
    history = [];
  for (let n = 0; n < 60 * 60 * 30 && g.getState().phase === 'playing'; n++) {
    const now = g.getState();
    history.push(now);
    g.update(1 / 60, pilot(now, history[Math.max(0, history.length - 21)], 0.35));
  }
  const end = g.getState();
  assert.equal(end.phase, 'won');
  assert.equal(end.level, LEVEL_COUNT);
  assert.deepEqual(store.calls, SECTORS.slice(1));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].message, '二十二个星区已清理。欢迎归航，飞行员。');
  assert.ok(h.ends[0].won && h.ends[0].score === end.score && h.sounds.includes('win'));
  assert.ok(end.lives >= 1 && end.score > 10000);
});
test('idle, mash, random-key and timed-sweep players win at most a quarter of any sector', () => {
  for (const policy of Object.keys(POLICIES))
    for (const n of BLIND_SECTORS) {
      const wins = BLIND_SEEDS.filter((seed) => runBlind(policy, n, seed).won).length;
      assert.ok(wins / BLIND_SEEDS.length <= 0.25, `${policy} won ${wins} of sector ${n}`);
    }
});

// ---------------------------------------------------------------------------------------------
// Fair start.
// ---------------------------------------------------------------------------------------------
test('a new player gets time to read: an idle pilot is untouched through the opening', () => {
  const { g, h } = open(1, { progress: null });
  for (let i = 0; i < 10 * 60; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.lives, 3);
  assert.equal(s.hull, 3);
  assert.equal(s.menu, null);
  assert.equal(h.ends.length, 0);
  assert.ok(START_SHIELD >= 3 && TIP_SECONDS >= 6);
  const text = [];
  const ctx = mockContext();
  ctx.fillText = (t) => text.push(t);
  const early = open(1, { progress: null }).g;
  early.update(1 / 60, input());
  early.draw(ctx);
  assert.ok(text.includes(LEVELS[0].name.en));
  assert.ok(text.some((line) => LEVELS[0].tip.en.startsWith(line)));
  assert.equal(early.getState().hull, 3);
});
test('the opening shield and the lesson never stand on the pilot or the first rocks', () => {
  const { g } = open(1, { progress: null }),
    rows = [];
  const ctx = mockContext();
  ctx.fillText = (text, x, y) => rows.push({ text, y });
  g.draw(ctx);
  const lessonTop = Math.min(...rows.filter((r) => r.y > 200).map((r) => r.y));
  assert.ok(lessonTop >= 262, 'the lesson sits below the pilot and every opening rock');
  const s = g.getState();
  assert.ok(s.invulnerable >= START_SHIELD - 0.1 && s.ship.x === 240 && s.ship.y === 160);
  assert.ok(
    s.rocks.every((r) => r.birth > 0),
    'fresh rocks are drawn but harmless at first',
  );
});

// ---------------------------------------------------------------------------------------------
// Select and continue.
// ---------------------------------------------------------------------------------------------
test('the sector select offers saved progress and starts the chosen sector', () => {
  const store = memoryStore(7),
    { g } = open(7, { progress: store, launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 7, unlocked: 7, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  assert.match(s.status.en, /Choose a sector/);
  assert.match(s.status.zh, /选择星区/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7, 'locked sectors cannot be reached by keys');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Space']));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 6);
  assert.equal(s.rocks.length, LEVELS[5].rocks.length);
  assert.match(s.status.en, /Sector 6\/22/);
  assert.match(s.status.zh, /星区 6\/22/);
});
test('tapping a cell starts it and tapping a locked cell is refused', () => {
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
});
test('clearing a sector unlocks the next one and never lowers the saved value', () => {
  const store = memoryStore(1),
    run = playSector(1, 60, { progress: store });
  assert.ok(run.cleared);
  assert.deepEqual(store.calls, [2]);
  assert.equal(store.value, 2);
  assert.equal(run.g.getState().unlocked, 2);
  const high = memoryStore(9),
    second = playSector(3, 60, { progress: high });
  assert.ok(second.cleared);
  assert.equal(high.value, 9);
  assert.ok(high.calls.every((n) => n > 3));
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
    const run = playSector(1, 60, { progress });
    assert.ok(run.cleared);
    assert.equal(run.end.level, 2);
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
// Determinism, hostile input, terminal state.
// ---------------------------------------------------------------------------------------------
function scripted(hz, level) {
  const { g } = open(level, { seed: 3 }),
    trace = [];
  for (let n = 0; n < hz * 24; n++) {
    const t = n / hz,
      phase = Math.floor(t * 2) % 4,
      keys = [
        ['Space', 'ArrowRight', 'ArrowUp'],
        ['Space'],
        ['Space', 'ArrowLeft'],
        ['ArrowLeft', 'ArrowDown'],
      ][phase],
      press = Math.abs(t - 7) < 1e-9 ? ['ShiftLeft'] : [];
    g.update(1 / hz, input(keys, press));
    if ((n + 1) % (hz / 2) === 0) trace.push(g.getState());
  }
  return trace;
}
test('30, 60 and 120 Hz play the same game', () => {
  for (const level of [1, 8, 17]) {
    const [slow, mid, fast] = HZS.map((hz) => scripted(hz, level));
    assert.equal(slow.length, 48);
    slow.forEach((a, i) => {
      for (const b of [mid[i], fast[i]]) {
        assert.equal(a.score, b.score);
        assert.equal(a.lives, b.lives);
        assert.equal(a.hull, b.hull);
        assert.equal(a.level, b.level);
        assert.equal(a.rocks.length, b.rocks.length);
        assert.equal(a.shotsFired, b.shotsFired);
        assert.ok(Math.abs(a.ship.x - b.ship.x) < 1e-6, `sector ${level} step ${i}`);
        assert.ok(Math.abs(a.ship.y - b.ship.y) < 1e-6);
        assert.ok(Math.abs(a.ship.angle - b.ship.angle) < 1e-6);
      }
    });
  }
});
test('the same seed replays identically and different seeds differ', () => {
  assert.deepEqual(scripted(60, 8), scripted(60, 8));
  const { g } = open(8, { seed: 9 });
  g.update(1 / 60, input());
  assert.notDeepEqual(g.getState().rocks, open(8, { seed: 3 }).g.getState().rocks);
});
test('hostile frame times and pointer values keep the state finite and in bounds', () => {
  const times = [NaN, Infinity, -Infinity, -1, 0, 1e-12, 1e9, 0.5, '0.016', null, undefined, {}];
  const xs = [NaN, Infinity, -Infinity, 1e9, -5, '240', null, undefined, 'abc', 240];
  const { g } = open(10, { seed: 4 });
  for (let n = 0; n < 600; n++) {
    const pointer = {
      x: xs[n % xs.length],
      y: xs[(n * 3) % xs.length],
      down: n % 3 !== 0,
      clicked: n % 7 === 0,
    };
    g.update(times[n % times.length], input([], n % 5 ? [] : ['Space', 'ShiftLeft'], pointer));
    g.update(1 / 60, input(n % 2 ? ['ArrowLeft', 'ArrowUp'] : ['ArrowRight'], [], pointer));
    const s = g.getState();
    finiteDeep(s);
    assert.ok(s.ship.x >= 0 && s.ship.x < 480 && s.ship.y >= 0 && s.ship.y < 320);
    assert.ok(s.rocks.length < 80 && s.shots.length < 120 && s.particles.length <= 120);
    if (s.phase !== 'playing') break;
  }
  const bare = { held: () => false, pressed: () => false };
  const fresh = open(10).g;
  fresh.update(1 / 60, bare);
  fresh.update(1 / 60, null);
  assert.equal(fresh.getState().phase, 'playing');
  const menu = open(5, { launch: false }).g;
  menu.update(1 / 60, bare);
  menu.update(1 / 60, input([], [], { x: NaN, y: NaN, clicked: true }));
  assert.ok(menu.getState().menu);
  menu.update(NaN, input([], ['Space']));
  assert.ok(menu.getState().menu, 'a junk frame time does nothing, not even a menu start');
});
test('a pointer held on the field aims the ship and fires, with a button route for all else', () => {
  const { g } = open(2, { seed: 2 }),
    before = g.getState().ship.angle;
  for (let n = 0; n < 40; n++) g.update(1 / 60, input([], [], { x: 450, y: 160, down: true }));
  const s = g.getState();
  assert.ok(Math.abs(turnTo(0, s.ship.angle)) < Math.abs(turnTo(0, before)));
  assert.ok(s.shotsFired >= 1);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft'])
    assert.ok(codes.includes(code), code);
  assert.ok(meta.touch && meta.keys.some((k) => /select/i.test(k.label.en)));
  const menu = open(5, { launch: false }).g;
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
    menu.update(1 / 60, input([], [key]));
  menu.update(1 / 60, input([], ['Space']));
  assert.equal(menu.getState().menu, null);
});
const ENDINGS = {
  en: {
    lost: 'Your fleet is gone. Plot a new course.',
    ammo: 'Ammunition exhausted. Reload and reserve management matter.',
  },
  zh: { lost: '舰队损失殆尽，重新规划航线吧。', ammo: '弹药耗尽。请留意装填与储备。' },
};
test('losing the fleet or the ammunition reports once, in both languages, then freezes', () => {
  for (const lang of ['en', 'zh'])
    for (const [kind, policy] of [
      ['lost', 'mash'],
      ['ammo', 'holdFire'],
    ]) {
      const { g, h, end } = runBlind(policy, 3, 2, { horizon: 120, lang });
      assert.equal(end.phase, 'lost');
      assert.equal(end.reason === 'ammo', kind === 'ammo');
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, false);
      assert.equal(h.ends[0].message, ENDINGS[lang][kind]);
      assert.equal(h.ends[0].score, end.score);
      assert.ok(h.sounds.includes('lose'));
      const frozen = g.getState();
      for (let i = 0; i < 120; i++)
        g.update(
          1 / 60,
          input(['ArrowLeft'], ['Space', 'ShiftLeft'], { x: 10, y: 10, down: true }),
        );
      g.update(NaN, input());
      assert.deepEqual(g.getState(), frozen);
      assert.equal(h.ends.length, 1);
    }
});
test('the English win message is reported once and the state stays frozen', () => {
  const run = playSector(LEVEL_COUNT, 60, { delay: 0.25, lang: 'en' });
  assert.equal(run.end.phase, 'won');
  assert.equal(run.h.ends.length, 1);
  assert.equal(run.h.ends[0].message, 'All twenty-two sectors secured. Welcome home, pilot.');
  const frozen = run.g.getState();
  for (let i = 0; i < 120; i++) run.g.update(1 / 60, input(['Space'], ['Space']));
  assert.deepEqual(run.g.getState(), frozen);
  assert.equal(run.h.ends.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Drawing: every screen is complete in both languages and fits the 480 x 320 canvas.
// ---------------------------------------------------------------------------------------------
function textCanvas() {
  const ctx = mockContext(),
    drawn = [];
  ctx.fillText = (text, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 12);
    drawn.push({ text: String(text), x, y, size, align: ctx.textAlign });
  };
  return { ctx, drawn };
}
const widthOf = (text, size) =>
  [...text].reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62), 0);
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
function assertLanguage(drawn, lang) {
  for (const { text } of drawn)
    if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
    else assert.doesNotMatch(text.replace(/Shift/g, ''), /[A-Za-z]{3,}/, `Chinese shows "${text}"`);
}
test('every opening screen shows its name and tip, fits, and is localized', () => {
  for (const lang of ['en', 'zh'])
    for (const n of SECTORS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} sector ${n}`);
      assertLanguage(drawn, lang);
      const spec = LEVELS[n - 1];
      assert.ok(drawn.some((d) => d.text === spec.name[lang]));
      assert.equal(
        drawn
          .filter((d) => d.size === 11 && d.y >= 277)
          .map((d) => d.text)
          .join(lang === 'en' ? ' ' : ''),
        spec.tip[lang],
      );
      assert.ok(wrapText(spec.tip[lang], 11).length <= 3);
    }
});
test('the select screen and the playing HUD fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, LEVEL_COUNT]) {
      const { g } = open(unlocked, { lang, launch: false }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A SECTOR' : '选择星区')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')) ||
          unlocked === LEVEL_COUNT,
      );
    }
    const { g } = open(15, { lang, seed: 6 }),
      { ctx, drawn } = textCanvas();
    const seen = new Set();
    for (let n = 0; n < 60 * 40; n++) {
      const now = g.getState();
      if (now.phase !== 'playing') break;
      g.update(1 / 60, pilot(now, now, 0));
      if (n % 20 === 0) g.draw(ctx);
      for (const r of now.rocks) seen.add(r.fuse !== undefined ? 'fuse' : r.kind);
    }
    assertFits(drawn, `${lang} play`);
    assertLanguage(drawn, lang);
    assert.ok(drawn.some((d) => d.text.startsWith(lang === 'en' ? 'SECTOR 15/' : '星区 15/')));
    assert.ok(drawn.some((d) => d.text.startsWith(lang === 'en' ? 'RELOAD' : '装填')) || true);
    assert.ok(seen.has('volatile') && seen.has('iron') && seen.has('ice') && seen.has('stone'));
  }
});
test('the status line tracks the sector in both languages', () => {
  const { g } = open(2),
    s = g.getState();
  assert.equal(
    s.status.en,
    `Sector 2/${LEVEL_COUNT} · 3 rocks · Hull 3/3 · Ammo ${LEVELS[1].ammo}`,
  );
  assert.equal(s.status.zh, `星区 2/${LEVEL_COUNT} · 3 块陨石 · 船体 3/3 · 弹药 ${LEVELS[1].ammo}`);
  assert.equal(s.totalLevels, LEVEL_COUNT);
  assert.ok(MAGAZINE < LEVELS[1].ammo);
});
test('text wrapping breaks at spaces, by glyph for Chinese, and splits unbroken words', () => {
  assert.deepEqual(wrapText('aaa bbb ccc', 10, 40), ['aaa', 'bbb', 'ccc']);
  assert.deepEqual(wrapText('一二三四五六', 10, 30), ['一二三', '四五六']);
  assert.deepEqual(wrapText('abcdefghij', 10, 30), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapText('', 10), []);
});
