import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, LEVELS } from '../src/games/raft-rush.js';
import { harness, input, mockContext, seeded } from './harness.js';

const COUNT = LEVELS.length;
const IDS = Array.from({ length: COUNT }, (_, i) => i + 1);
const MASTERY = IDS.slice(15);
const MID = [7, 8, 9, 10, 13, 14];
const RATES = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const CJK = /[㐀-鿿]/;
const LEFT = 'ArrowLeft',
  RIGHT = 'ArrowRight',
  UP = 'ArrowUp',
  DOWN = 'ArrowDown';

// ---------------------------------------------------------------------------------------------
// Harness: open any unlocked river the way a player does (river select, then Space).
// ---------------------------------------------------------------------------------------------
function memoryStore(value) {
  const store = {
    value,
    unlocks: [],
    unlocked: () => store.value,
    unlock(n) {
      store.unlocks.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
function open(level, { lang = 'en', seed = 1, progress = memoryStore(level) } = {}) {
  const h = harness({ lang, seed }),
    g = createGame({ ...h.env, progress });
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, progress };
}

// ---------------------------------------------------------------------------------------------
// A reaction-limited pilot. It only reads getState(), sees it `delay` seconds late, estimates where
// the raft is now from that snapshot plus the keys it has pressed since (a drag model), aims at the
// next flag or gate gap with a seeded aiming error, dodges loose rocks, strokes out of back-currents,
// brakes before the dock and settles inside the marker.
//   dead:  false = it does not correct for its own delay (a sloppier pilot)
//   stroke: false = it never uses the paddle stroke
// ---------------------------------------------------------------------------------------------
const AIM_SPEED = 3;
const AIM_CAP = 85;
const KEY_BAND = 18;
const DRAG = 2.2;
const THRUST = 200;
const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let z = Math.imul(seed ^ (seed >>> 15), seed | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
};
const keyAxis = (held, minus, plus) => Number(held.includes(plus)) - Number(held.includes(minus));
function pathAt(path, x, k) {
  for (let i = 1; i < path.length; i++) {
    if (x <= path[i][0]) {
      const a = path[i - 1],
        b = path[i];
      return a[k] + ((b[k] - a[k]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return path[path.length - 1][k];
}
function makePilot({ delay, seed = 1, jitter = 0, dead = true, stroke = true }) {
  const rng = mulberry(seed * 31 + 7),
    ring = [],
    cmds = [],
    aim = new Map();
  let lastStroke = -9,
    clock = 0;
  const aimError = (key) => {
    if (!aim.has(key)) aim.set(key, (rng() * 2 - 1) * jitter);
    return aim.get(key);
  };
  return function decide(S, dt) {
    const lag = Math.round(delay / dt);
    ring.push(S);
    const seen = ring[Math.max(0, ring.length - 1 - lag)];
    if (ring.length > lag + 2) ring.shift();
    clock += dt;
    const p = seen.player,
      w = seen.water,
      fl = seen.flags,
      dock = seen.dock,
      needMore = fl.count < fl.need;
    let ex = p.x,
      ey = p.y,
      evy = p.vy,
      evx = p.vx;
    const recent = dead ? cmds.slice(Math.max(0, cmds.length - lag)) : [];
    for (const c of recent) {
      evx += (THRUST * c.x - DRAG * (evx - w.vx)) * dt;
      evy += (THRUST * c.y - DRAG * (evy - w.vy)) * dt;
      ex += evx * dt;
      ey += evy * dt;
    }
    if (dead) {
      ex += evx * dt * (lag - recent.length);
      ey += evy * dt * (lag - recent.length);
    }
    const waypoints = [
      ...seen.gates
        .filter(
          (g) => g.x > ex - 14 && !fl.list.some((f, i) => !fl.got[i] && Math.abs(f.x - g.x) < 5),
        )
        .map((g) => ({ x: g.x, y: (g.y0 + g.y1) / 2 })),
      ...fl.list.filter((f, i) => !fl.got[i] && f.x > ex - 18),
    ].sort((a, b) => a.x - b.x);
    const look = Math.max(190, Math.hypot(p.vx, p.vy) * 1.7),
      next = waypoints.find((q) => q.x - ex < look);
    let ty = pathAt(seen.river.path, ex + 90, 1);
    if (next) ty = next.y + aimError(`${next.x}:${Math.round(next.y)}`);
    for (const r of seen.rocks) {
      const loose = !seen.gates.some((g) => Math.abs(g.x - r.x) < 1);
      if (loose && r.x > ex - 6 && r.x < ex + 150 && Math.abs(ty - r.y) < r.r + 22) {
        ty = r.y + (ty >= r.y ? 1 : -1) * (r.r + 24);
      }
    }
    const cy = pathAt(seen.river.path, ex, 1),
      half = pathAt(seen.river.path, ex, 2);
    ty = Math.max(cy - half + 18, Math.min(cy + half - 18, ty));
    const wanted = Math.max(-AIM_CAP, Math.min(AIM_CAP, (ty - ey) * AIM_SPEED)),
      settling = !needMore && ex >= dock.x0 - 10,
      held = [],
      pressed = [];
    if (!settling) {
      if (wanted - evy > KEY_BAND) held.push(DOWN);
      else if (wanted - evy < -KEY_BAND) held.push(UP);
    }
    const missed =
      needMore && fl.count + fl.list.filter((f, i) => !fl.got[i] && f.x > ex - 18).length < fl.need;
    if (missed) held.push(LEFT);
    else if ((p.vx < 14 || w.vx < 20) && !(!needMore && ex >= dock.x0)) {
      held.push(RIGHT);
      const ready = seen.stamina >= 40 && seen.cooldown <= 0 && clock - lastStroke > 0.5;
      if (ready && p.vx < 30 && w.vx < 25) {
        if (stroke) pressed.push('Space');
        lastStroke = clock;
      }
    }
    if (!needMore) {
      const speed = Math.hypot(p.vx, p.vy);
      if (ex > dock.x0 - 150 && speed > 26) held.push('KeyX');
      if (ex > dock.x1 && speed < 30) held.push(LEFT);
    }
    cmds.push({ x: keyAxis(held, LEFT, RIGHT), y: keyAxis(held, UP, DOWN) });
    return input(held, pressed);
  };
}

/** Plays one river with a pilot; reports how it ended and how much hull it lost. */
function playLevel(level, { hz = 60, delay = 0.25, seed = 1, seconds = 150, ...options } = {}) {
  const { g, h } = open(level, { seed }),
    dt = 1 / hz,
    decide = makePilot({ delay, seed, ...options });
  let hits = 0,
    hull = 3,
    time = 0;
  for (let frame = 0; frame < seconds * hz; frame++) {
    const S = g.getState();
    if (S.level === level) time = S.time;
    if (S.hull < hull) {
      hits += hull - S.hull;
      hull = S.hull;
    }
    if (S.phase !== 'playing') return { cleared: S.phase === 'won', hits, time, S, h, g };
    if (S.level > level) return { cleared: true, hits, time, S, h, g };
    g.update(dt, decide(S, dt));
  }
  return { cleared: false, hits, time, S: g.getState(), h, g };
}
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
test('twenty data-driven rivers on a teaching, combination and mastery curve with frozen data', () => {
  assert.equal(COUNT, 20);
  assert.ok(
    Object.isFrozen(LEVELS) && LEVELS.every((l) => Object.isFrozen(l) && Object.isFrozen(l.rocks)),
  );
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, COUNT);
  for (const l of LEVELS) {
    assert.ok(l.name.en && l.name.zh && l.tip.en && l.tip.zh, `level ${l.level}`);
    assert.doesNotMatch(l.tip.en, CJK);
    assert.match(l.tip.zh, CJK);
    assert.ok(l.flags.length >= 4 && l.need >= l.flags.length - 1);
    const firstRock = Math.min(...l.rocks.map((r) => r.x), Infinity);
    assert.ok(firstRock >= 300, `level ${l.level}: nothing to hit in the first 230 px`);
    assert.ok(l.flags[0].x <= 400, 'the first flag is on the opening screen');
    for (const f of l.flags) {
      const c = l.centre(f.x);
      assert.ok(Math.abs(f.y - c.cy) >= 30, `level ${l.level}: flag ${f.x} is on the idle line`);
      assert.ok(
        Math.abs(f.y - c.cy) <= c.half - 16,
        `level ${l.level}: flag ${f.x} is unreachable`,
      );
    }
    for (const g of l.gates) {
      const c = l.centre(g.x);
      assert.ok(
        g.y0 >= c.cy - c.half + 8 && g.y1 <= c.cy + c.half - 8,
        `gate ${g.x} has bank plugs`,
      );
      assert.ok(g.y1 - g.y0 >= 58, 'every gate fits the 24 px raft with room to steer');
    }
  }
  const curve = (ids, pick) => ids.map((n) => pick(LEVELS[n - 1]));
  assert.ok(
    Math.max(...curve(IDS.slice(0, 5), (l) => l.flow[1][1])) <= 62,
    'teaching water is slow',
  );
  assert.ok(Math.min(...curve(MASTERY, (l) => l.flow[1][1])) >= 98, 'mastery water is fast');
  assert.ok(MASTERY.every((n) => LEVELS[n - 1].need === LEVELS[n - 1].flags.length));
  assert.ok(MASTERY.every((n) => LEVELS[n - 1].safeImpact <= 60));
  assert.ok(IDS.slice(0, 15).every((n) => LEVELS[n - 1].safeImpact === 100));
  const narrowest = (ids) =>
    Math.min(...ids.flatMap((n) => LEVELS[n - 1].gates.map((g) => g.y1 - g.y0)));
  assert.ok(narrowest(MASTERY) <= 62 && narrowest(MASTERY) < narrowest(IDS.slice(0, 15)) - 15);
});

test('tips describe what each river actually does', () => {
  const tip = (n) => LEVELS[n - 1].tip.en;
  for (const n of IDS) {
    const l = LEVELS[n - 1],
      weir = l.fields.some((f) => f.vx < -100),
      side = l.fields.some((f) => f.vy !== 0),
      swirl = l.eddies.length > 0;
    if (weir) assert.match(tip(n), /back-current|Space|stroke/i, `weir tip ${n}`);
    if (!weir && side && n < 16) assert.match(tip(n), /[Ss]ide current/, `side tip ${n}`);
    if (swirl && n < 16) assert.match(tip(n), /[Ww]hirlpool/, `whirl tip ${n}`);
    if (n >= 16) assert.match(tip(n), /^(Mastery|Finale)/, `mastery tip ${n}`);
    if (l.need < l.flags.length) assert.doesNotMatch(tip(n), /no flag may be missed/i);
  }
  for (const n of [3, 7, 14]) assert.match(tip(n), /gate|gap/i, `gate tip ${n}`);
  assert.match(tip(1), /3 of 4/);
  assert.match(tip(2), /X/);
  assert.match(tip(11), /X/);
  assert.match(tip(4), /Space/);
  assert.match(tip(15), /stamina/);
  assert.match(tip(19), /brake/);
});

// ---------------------------------------------------------------------------------------------
// Legal play: every river is cleared by a pilot who sees the state late.
// ---------------------------------------------------------------------------------------------
test('a scripted legal pilot clears every river with hull to spare', () => {
  for (const n of IDS) {
    const r = playLevel(n, { delay: 0.25, jitter: 8 });
    assert.ok(r.cleared, `river ${n}`);
    assert.ok(r.hits <= 1, `river ${n}: ${r.hits} hits`);
  }
});

test('reaction-limited pilots (0.25 s and 0.35 s) clear every river at 30, 60 and 120 Hz with margin', () => {
  const hitsPerRun = [];
  for (const hz of RATES)
    for (const delay of DELAYS)
      for (const n of IDS) {
        const r = playLevel(n, { hz, delay, seed: n + hz, jitter: 8 });
        assert.ok(r.cleared, `river ${n} at ${hz} Hz, ${delay} s`);
        assert.ok(r.hits <= 1, `river ${n} at ${hz} Hz, ${delay} s: ${r.hits} hits`);
        hitsPerRun.push(r.hits);
      }
  assert.ok(mean(hitsPerRun) <= 0.4, `mean hull lost ${mean(hitsPerRun)}`);
});

test('the full campaign is won in one run with exactly one end and a frozen win', () => {
  const { g, h } = open(1),
    dt = 1 / 60,
    decide = makePilot({ delay: 0.25, seed: 3, jitter: 6 });
  for (let frame = 0; frame < 60 * 1200 && g.getState().phase === 'playing'; frame++) {
    g.update(dt, decide(g.getState(), dt));
  }
  const S = g.getState();
  assert.equal(S.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].message, 'You docked all twenty rivers!');
  assert.ok(h.ends[0].score > 3000);
  assert.equal(h.sounds.at(-1), 'win');
  const frozen = JSON.stringify(S);
  g.update(dt, input([RIGHT], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
});

test('strokes pay off in the back-currents and the dock stays locked without flags', () => {
  for (const n of [4, 12, 19, 20]) {
    const fast = playLevel(n, { delay: 0.25, hz: 30 }),
      slow = playLevel(n, { delay: 0.25, hz: 30, stroke: false });
    assert.ok(fast.cleared && slow.time > fast.time + 3, `river ${n}: strokes save time`);
  }
  const stamina = playLevel(15, { delay: 0.25, stroke: false, seconds: 90, hz: 30 });
  assert.ok(!stamina.cleared, 'river 15 cannot be crawled through without strokes');
  const { g } = open(3);
  for (let i = 0; i < 60 * 80; i++) {
    g.update(1 / 60, input(['KeyX'], []));
    assert.ok(g.getState().level === 3 && !g.getState().dock.open);
  }
});

test('a pilot with no delay correction loses more hull on mastery rivers than on mid rivers', () => {
  const sloppy = (ids) =>
    ids.flatMap((n) =>
      [1, 2, 3, 4].map(
        (seed) =>
          playLevel(n, { delay: 0.35, seed, jitter: 10, dead: false, stroke: true, hz: 60 }).hits +
          Number(!playLevel(n, { delay: 0.35, seed, jitter: 10, dead: false }).cleared) * 3,
      ),
    );
  const mastery = mean(sloppy([16, 17, 18])),
    mid = mean(sloppy(MID));
  assert.ok(mastery >= mid + 0.6, `mastery ${mastery.toFixed(2)} vs mid ${mid.toFixed(2)}`);
});

// ---------------------------------------------------------------------------------------------
// Blind play: idle, holds, alternation at several periods, mashing and random keys.
// ---------------------------------------------------------------------------------------------
function blindPolicies() {
  const list = [
    ['idle', () => input([], [])],
    ['right', () => input([RIGHT], [])],
    ['brake', () => input(['KeyX'], [])],
    ['right+brake', () => input([RIGHT, 'KeyX'], [])],
    ['right+mash', (t, i) => input([RIGHT], i % 30 === 0 ? ['Space'] : [])],
  ];
  for (const period of [0.5, 1, 1.6, 2.4, 3.2])
    for (const phase of [0, 1])
      list.push([
        `alternate ${period}/${phase}`,
        (t, i) =>
          input(
            [RIGHT, (Math.floor(t / period) + phase) % 2 ? UP : DOWN, ...(phase ? ['KeyX'] : [])],
            i % 36 === 0 ? ['Space'] : [],
          ),
      ]);
  return list;
}
function randomPolicy(seed) {
  const rnd = seeded(seed);
  let held = [];
  return (t, i) => {
    if (i % 20 === 0) held = [UP, DOWN, LEFT, RIGHT, 'KeyX'].filter(() => rnd() < 0.4);
    return input(held, i % 40 === 0 ? ['Space'] : []);
  };
}
test('idle, mash, hold, alternating and random-key play win at most 25% of any river from river 3', () => {
  const policies = [...blindPolicies(), ...[1, 2, 3].map((s) => [`random ${s}`, null, s])];
  const winsFor = (n) => {
    let wins = 0;
    for (const [, make, seed] of policies) {
      const { g } = open(n),
        decide = make ?? randomPolicy(seed);
      for (let i = 0; i < 30 * 100; i++) {
        const S = g.getState();
        if (S.phase !== 'playing') break;
        if (S.level > n) {
          wins++;
          break;
        }
        g.update(1 / 30, decide(i / 30, i));
      }
    }
    return wins / policies.length;
  };
  for (const n of IDS.slice(2)) assert.ok(winsFor(n) <= 0.25, `river ${n}`);
});

test('an idle player is safe and can read the opening: no hull is lost, nothing covers the raft', () => {
  for (const n of IDS) {
    const { g } = open(n),
      { ctx, drawn } = textCanvas();
    for (let i = 0; i < 60 * (n <= 15 ? 8 : 3); i++) g.update(1 / 60, input([], []));
    const S = g.getState();
    assert.equal(S.hull, 3, `river ${n}`);
    assert.equal(S.phase, 'playing');
    g.draw(ctx);
    assert.ok(drawn.length > 0);
    for (const d of drawn)
      assert.ok(d.y < 28 - 4 + 14 || d.y >= 292, `overlay text "${d.text}" at y ${d.y}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Select, continue and progress stores
// ---------------------------------------------------------------------------------------------
test('river select: shown only with progress, clamped to unlocked rivers, keys and taps both work', () => {
  assert.equal(open(1).g.getState().menu, null);
  const store = memoryStore(5),
    { g, h } = open(1, { progress: store });
  let S = g.getState();
  assert.deepEqual([S.menu.cursor, S.menu.unlocked, S.menu.total], [5, 5, 20]);
  g.update(1 / 60, input([], [RIGHT]));
  assert.equal(g.getState().menu.cursor, 5, 'cannot move past the unlocked river');
  g.update(1 / 60, input([], [LEFT]));
  g.update(1 / 60, input([], ['KeyA']));
  assert.equal(g.getState().menu.cursor, 3, 'left moves one river');
  g.update(1 / 60, input([], ['KeyW']));
  assert.equal(g.getState().menu.cursor, 1, 'up moves a row and clamps at river 1');
  g.update(1 / 60, input([], [DOWN]));
  assert.equal(
    g.getState().menu.cursor,
    5,
    'down moves a row and clamps at the last unlocked river',
  );
  g.update(1 / 60, input([], [LEFT]));
  const before = h.sounds.length;
  g.update(1 / 60, input([], [], { x: 11 + 4 * 94 + 5, y: 28 + 3 * 46 + 5, clicked: true }));
  assert.equal(g.getState().menu.cursor, 4, 'locked river 20 does not start');
  assert.equal(h.sounds.at(-1), 'hit');
  assert.ok(h.sounds.length > before);
  g.update(1 / 60, input([], [], { x: 11 + 1 * 94 + 5, y: 28 + 5, clicked: true }));
  S = g.getState();
  assert.equal(S.menu, null);
  assert.equal(S.level, 2, 'tapping river 2 starts it');
  assert.equal(S.hull, 3);
  const s2 = open(4);
  const start = s2.g.getState();
  assert.equal(start.level, 4);
  assert.equal(start.stamina, 100, 'the Space that started the river is not a paddle stroke');
  const held = createGame({ ...harness().env, progress: memoryStore(3) });
  held.update(1 / 60, input(['Space'], ['Space']));
  held.update(1 / 60, input(['Space'], []));
  assert.equal(held.getState().stamina, 100, 'holding Space after starting does not stroke');
});

test('clearing a river unlocks the next one; a win and a loss unlock nothing more', () => {
  const store = memoryStore(1),
    h = harness(),
    g = createGame({ ...h.env, progress: store }),
    dt = 1 / 60,
    decide = makePilot({ delay: 0.25, seed: 2 });
  for (let i = 0; i < 60 * 150 && g.getState().level === 1; i++)
    g.update(dt, decide(g.getState(), dt));
  assert.deepEqual(store.unlocks, [2]);
  assert.equal(store.value, 2);
  assert.equal(g.getState().unlocked, 2);
  const again = createGame({ ...h.env, progress: store });
  assert.equal(again.getState().menu.cursor, 2, 'the next visit continues at river 2');
});

test('broken or hostile progress stores never stop the game and are clamped', () => {
  const cases = [
    [() => 'abc', 1],
    [() => -5, 1],
    [() => 0, 1],
    [() => 99, 20],
    [() => 2.7, 2],
    [() => NaN, 1],
    [() => null, 1],
    [() => undefined, 1],
    [() => Infinity, 1],
    [() => ({}), 1],
    [() => '7', 7],
    [
      () => {
        throw new Error('store offline');
      },
      1,
    ],
  ];
  for (const [unlocked, expected] of cases) {
    const g = createGame({ ...harness().env, progress: { unlocked, unlock() {} } }),
      S = g.getState();
    assert.equal(S.unlocked, expected, String(unlocked));
    assert.equal(S.menu === null, expected === 1);
    assert.equal(S.level, expected === 1 ? 1 : 1);
    g.update(1 / 60, input([], ['Space']));
    g.update(1 / 60, input([RIGHT], []));
  }
  const throwing = {
    unlocked: () => 1,
    unlock() {
      throw new Error('quota exceeded');
    },
  };
  const { g } = (() => {
    const h = harness();
    return { g: createGame({ ...h.env, progress: throwing }) };
  })();
  const dt = 1 / 60,
    decide = makePilot({ delay: 0.25 });
  for (let i = 0; i < 60 * 150 && g.getState().level === 1; i++)
    g.update(dt, decide(g.getState(), dt));
  assert.equal(g.getState().level, 2, 'a throwing unlock does not interrupt the run');
  const none = createGame(harness().env);
  assert.equal(none.getState().unlocked, 1);
});

// ---------------------------------------------------------------------------------------------
// Determinism, hostile inputs, terminal state
// ---------------------------------------------------------------------------------------------
test('a pilot run gives the same result when replayed and the same hits at every frame rate', () => {
  const a = playLevel(10, { seed: 5, jitter: 8 }),
    b = playLevel(10, { seed: 5, jitter: 8 });
  assert.equal(JSON.stringify(a.S), JSON.stringify(b.S));
  const clears = RATES.map((hz) => playLevel(10, { hz, seed: 5, jitter: 8 }).cleared);
  assert.deepEqual(clears, [true, true, true]);
  const scripted = RATES.map((hz) => {
    const g = open(8).g;
    for (let i = 0; i < hz * 20; i++) {
      const ms = Math.round((i * 1000) / hz);
      g.update(
        1 / hz,
        input([RIGHT, ms % 2400 < 1200 ? UP : DOWN], ms % 1800 === 0 ? ['Space'] : []),
      );
    }
    return g.getState();
  });
  assert.deepEqual(scripted[0], scripted[1]);
  assert.deepEqual(scripted[1], scripted[2]);
});

test('hostile dt and pointer values are ignored in the menu and in play', () => {
  const pointers = [
    undefined,
    {},
    { x: NaN, y: NaN, clicked: true },
    { x: 'a', y: {}, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: 1e12, y: 1e12, clicked: true },
    { x: -5, y: -5, clicked: true },
    { x: null, y: undefined, clicked: true },
  ];
  for (const level of [1, 6]) {
    const { g } = open(level, { progress: memoryStore(6) });
    g.update(1 / 60, input([], []));
    const before = JSON.stringify(g.getState());
    for (const dt of [0, -1, NaN, Infinity, 0.5, 1e9, undefined, null, '0.01'])
      g.update(dt, input([RIGHT], ['Space']));
    assert.equal(JSON.stringify(g.getState()), before, `level ${level}: invalid dt`);
    for (const p of pointers) {
      const hostile = input([], [], p ?? {});
      if (p === undefined) delete hostile.pointer;
      g.update(1 / 60, hostile);
      const S = g.getState();
      assert.ok(Object.values(S.player).every(Number.isFinite));
    }
  }
  const menu = createGame({ ...harness().env, progress: memoryStore(9) });
  for (const p of pointers) {
    const hostile = input([], [], p ?? {});
    if (p === undefined) delete hostile.pointer;
    menu.update(1 / 60, hostile);
    const S = menu.getState();
    if (S.menu) assert.ok(S.menu.cursor >= 1 && S.menu.cursor <= 9);
  }
});

test('losing ends once in English and Chinese and the terminal state is frozen', () => {
  const messages = {};
  for (const lang of ['en', 'zh']) {
    const { g, h } = open(20, { lang });
    for (let i = 0; i < 60 * 90 && g.getState().phase === 'playing'; i++) {
      const dir = Math.floor(i / 50) % 2 ? UP : DOWN;
      g.update(1 / 60, input([RIGHT, dir], i % 45 === 0 ? ['Space'] : []));
    }
    const dead = JSON.stringify(g.getState());
    assert.equal(g.getState().phase, 'lost');
    for (let i = 0; i < 20; i++) g.update(1 / 60, input([RIGHT, 'Space'], ['Space']));
    assert.equal(JSON.stringify(g.getState()), dead);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    messages[lang] = h.ends[0].message;
  }
  assert.equal(messages.en, 'The raft broke apart.');
  assert.equal(messages.zh, '木筏解体了。');
  const zh = open(20, { lang: 'zh' }),
    dt = 1 / 60,
    decide = makePilot({ delay: 0.25, seed: 4, jitter: 6 });
  for (let i = 0; i < 60 * 150 && zh.g.getState().phase === 'playing'; i++)
    zh.g.update(dt, decide(zh.g.getState(), dt));
  assert.equal(zh.h.ends.length, 1);
  assert.equal(zh.h.ends[0].message, '二十条河流全部靠岸成功！');
  assert.equal(zh.h.ends[0].won, true);
});

// ---------------------------------------------------------------------------------------------
// Drawing: complete, bilingual and inside the canvas
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
  for (const { text } of drawn) {
    if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
    else
      assert.doesNotMatch(
        text.replace(/\bX\b/g, ''),
        /[A-Za-z]{2,}/,
        `Chinese screen shows "${text}"`,
      );
  }
}
test('every opening frame shows its tip, fits the canvas and is localized', () => {
  for (const lang of ['en', 'zh'])
    for (const n of IDS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} river ${n}`);
      assertLanguage(drawn, lang);
      assert.ok(
        drawn.some((d) => d.text === LEVELS[n - 1].tip[lang]),
        `tip ${lang} ${n}`,
      );
      assert.ok(
        drawn.some((d) => d.text.startsWith(lang === 'en' ? `Level ${n}/20` : `第 ${n}/20 关`)),
      );
      const S = g.getState();
      assert.ok(S.player.x - S.camera.x < 100 && S.flags.list[0].x < S.camera.x + 480);
    }
});

test('the river select, hud, goal line and every moving state fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, COUNT]) {
      const { g } = open(1, { lang, progress: memoryStore(unlocked) }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A RIVER' : '选择河流')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')) || unlocked === COUNT,
      );
      assert.ok(g.getState().status[lang].includes(String(unlocked)));
    }
    for (const n of [1, 4, 11, 20]) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas(),
        dt = 1 / 60,
        decide = makePilot({ delay: 0.25, jitter: 8 }),
        goals = new Set();
      for (let frame = 0; frame < 60 * 70; frame++) {
        const S = g.getState();
        if (S.phase !== 'playing' || S.level > n) break;
        goals.add(S.prompt.text[lang]);
        g.update(dt, decide(S, dt));
        if (frame % 10 === 0) g.draw(ctx);
      }
      assertFits(drawn, `${lang} play ${n}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text.startsWith(lang === 'en' ? 'Flags' : '旗帜')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'Ready' : '就绪')));
      assert.ok(goals.size >= 3, `${lang} river ${n}: goal lines ${[...goals]}`);
    }
  }
});

test('the raft always stays between the HUD bands during legal and random play', () => {
  const check = (S) => {
    assert.ok(S.player.y - S.player.r >= 28 && S.player.y + S.player.r <= 292, `y ${S.player.y}`);
    assert.ok(S.player.x - S.player.r - S.camera.x >= -0.01);
  };
  for (const n of [1, 9, 17, 20]) {
    const { g } = open(n),
      dt = 1 / 60,
      decide = makePilot({ delay: 0.25, jitter: 8 });
    for (let frame = 0; frame < 60 * 70; frame++) {
      const S = g.getState();
      check(S);
      if (S.phase !== 'playing' || S.level > n) break;
      g.update(dt, decide(S, dt));
    }
  }
  const rnd = seeded(9),
    { g } = open(13);
  let held = [];
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 25 === 0) held = [UP, DOWN, RIGHT, LEFT, 'KeyX'].filter(() => rnd() < 0.35);
    g.update(1 / 60, input(held, i % 50 === 0 ? ['Space'] : []));
    check(g.getState());
  }
});
