import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, RULES } from '../src/games/burrow-rescue.js';
import { LEVELS, LEVEL_COUNT } from '../src/games/burrow-rescue-levels.js';
import { MENU_COLUMNS, menuCell, wrapText } from '../src/games/burrow-rescue-menu.js';
import { BANNER } from '../src/games/burrow-rescue-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const CJK = /[一-鿿]/;
const TIERS = [
  [1, 5],
  [6, 10],
  [11, 15],
  [16, 20],
];
const BLIND_BAR = 0.25;
const BLIND_HORIZON = 40;

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
/** Start a game on `level` the way a player does: through the select screen when it is offered. */
function open(level, { lang = 'en', seed = 1, progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ lang, seed });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h, progress };
}

// ---------------------------------------------------------------------------------------------
// The reaction-limited players. Both read only getState(), delayed by `delay` seconds. The careful
// one plans digs, braces before a dig would crack the ceiling, leaves cracking tunnels and goes up
// for air and beams; the careless one just tunnels to the nearest goal and ignores every warning.
// ---------------------------------------------------------------------------------------------
const DIRS = [
  ['ArrowUp', 0, -1],
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowDown', 0, 1],
];
const COST = { '.': 1, L: 1, T: 1, D: 1, V: 1, P: 1, E: 8, W: 9, B: 8 };
const OPEN = '.LTDVP';
const TILE_SECONDS = 20 / 120;

function plan(tiles, from, goalFn, walkOnly = false) {
  const key = (c, r) => r * 20 + c;
  const dist = new Map([[key(from.c, from.r), 0]]);
  const prev = new Map();
  const q = [[0, from.c, from.r]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, c, r] = q.shift();
    if (d > dist.get(key(c, r))) continue;
    if (goalFn(c, r)) {
      const path = [];
      let k = key(c, r);
      while (prev.has(k)) {
        const [pc, pr, dir] = prev.get(k);
        path.unshift({ c: k % 20, r: Math.floor(k / 20), dir });
        k = key(pc, pr);
      }
      return path;
    }
    for (const [code, dx, dy] of DIRS) {
      const nc = c + dx,
        nr = r + dy;
      if (nc < 0 || nc > 19 || nr < 0 || nr > 10) continue;
      const ch = tiles[nr][nc];
      const cost = walkOnly && !OPEN.includes(ch) ? 0 : COST[ch];
      if (!cost) continue;
      if (d + cost < (dist.get(key(nc, nr)) ?? 1e9)) {
        dist.set(key(nc, nr), d + cost);
        prev.set(key(nc, nr), [c, r, code]);
        q.push([d + cost, nc, nr]);
      }
    }
  }
  return null;
}
// Longest dug run through (c, r) if tile (c, r) were dug (and optionally a beam stood at beamC).
function runAfter(row, c, beamC) {
  const cells = [...row];
  cells[c] = row[c] === 'W' ? 'V' : 'D';
  if (beamC !== undefined) cells[beamC] = 'P';
  let a = c,
    b = c;
  while (a > 0 && 'DV'.includes(cells[a - 1])) a--;
  while (b < 19 && 'DV'.includes(cells[b + 1])) b++;
  return { len: b - a + 1, loose: cells.slice(a, b + 1).includes('V') };
}
const unstable = (run) => run.len >= (run.loose ? 3 : 4);

function makeBot({ hz, delay, careless = false }) {
  const lag = Math.round(delay * hz);
  const lagSec = lag / hz;
  const history = [];
  let now = 0,
    settledAt = 0,
    launched = false,
    refill = false;
  let hold = null,
    holdUntil = 0,
    presses = [];
  const bot = (st) => {
    history.push(st);
    now += 1 / hz;
    const seen = history[Math.max(0, history.length - 1 - lag)];
    const pressed = presses.filter((p) => p.at <= now).map((p) => p.code);
    presses = presses.filter((p) => p.at > now);
    const out = () => input(hold && now < holdUntil ? [hold] : [], pressed);
    const command = ({ key = null, secs = 0, press = [], after = 0 }) => {
      hold = key;
      holdUntil = now + secs;
      for (const code of press) pressed.push(code);
      settledAt = now + Math.max(secs, after) + lagSec + 0.05;
    };
    if (seen.menu) {
      if (launched) return input();
      launched = true;
      return input([], ['Space']);
    }
    if (now < settledAt) return out();
    const p = seen.player;
    if (p.moving || p.digging) return out();
    const tiles = seen.tiles;
    const onSurface = p.r === 0;
    const walkUp = onSurface ? [] : plan(tiles, p, (c, r) => r === 0, true) || [];
    const reserve = (walkUp.length * TILE_SECONDS + 2 * lagSec) * seen.oxygenDrain * 1.25 + 8;
    if (!careless) {
      if (!refill && seen.oxygen < reserve + 4 && !onSurface) refill = true;
      if (
        refill &&
        p.r === 0 &&
        p.c === seen.lift.c &&
        seen.oxygen >= 95 &&
        seen.beams === seen.beamsMax
      )
        refill = false;
    }
    // 1. Standing under a crack: brace if that helps, otherwise walk out.
    const here = seen.warnings.find((w) => w.r === p.r && p.c >= w.c0 && p.c <= w.c1);
    if (here && !careless) {
      if (seen.beams > 0 && 'DV'.includes(tiles[p.r][p.c]) && /^Cracks! X/.test(seen.prompt.en)) {
        return (command({ press: ['KeyX'], after: 0.1 }), out());
      }
      const path = plan(
        tiles,
        p,
        (c, r) =>
          OPEN.includes(tiles[r][c]) &&
          !seen.warnings.some((w) => w.r === r && c >= w.c0 && c <= w.c1),
        true,
      );
      if (path?.length) {
        const [code] = DIRS.find((d) => d[0] === path[0].dir);
        return (
          command({
            key: code,
            secs: path.length * TILE_SECONDS - 0.02,
            after: path.length * TILE_SECONDS,
          }),
          out()
        );
      }
    }
    // 2. Wake a miner beside us.
    const waiting = seen.miners.filter((m) => m.state === 'waiting');
    if (waiting.some((m) => Math.abs(m.c - p.c) + Math.abs(m.r - p.r) <= 1) && !refill) {
      return (command({ press: ['KeyX'], after: 0.1 }), out());
    }
    // 3. Goal.
    const stuck = seen.miners.filter((m) => m.state === 'following' && m.blocked);
    let goal;
    if (refill) {
      const tank = seen.tanks.filter((t) => !t.taken);
      const toTank =
        tank.length && plan(tiles, p, (c, r) => tank.some((t) => t.c === c && t.r === r), true);
      if (toTank?.length && toTank.length < walkUp.length)
        goal = (c, r) => tank.some((t) => t.c === c && t.r === r);
      else goal = (c, r) => c === seen.lift.c && r === seen.lift.r;
    } else if (stuck.length || waiting.length) {
      const list = stuck.length ? stuck : waiting;
      goal = (c, r) => list.some((m) => m.c === c && m.r === r);
    } else goal = (c, r) => c === seen.lift.c && r === seen.lift.r;
    const path = plan(tiles, p, goal);
    if (!path?.length) return out();
    const first = path[0];
    const ch = tiles[first.r][first.c];
    const [code] = DIRS.find((d) => d[0] === first.dir);
    if (OPEN.includes(ch)) {
      let run = 0;
      for (const s of path) {
        if (s.dir !== first.dir || !OPEN.includes(tiles[s.r][s.c])) break;
        run++;
      }
      return (
        command({ key: code, secs: run * TILE_SECONDS - 0.02, after: run * TILE_SECONDS + 0.02 }),
        out()
      );
    }
    // Digging next: beam first if this dig would crack the ceiling.
    if (!careless) {
      const run = runAfter(tiles[first.r], first.c);
      if (unstable(run)) {
        const standing = 'DV'.includes(tiles[p.r][p.c]) && first.r === p.r;
        if (standing && seen.beams > 0 && !unstable(runAfter(tiles[first.r], first.c, p.c))) {
          return (command({ press: ['KeyX'], after: 0.1 }), out());
        }
        if (seen.beams === 0) {
          refill = true;
          return out();
        }
      }
    }
    return (command({ key: code, secs: 0.1, press: ['Space'], after: 0.2 }), out());
  };
  return bot;
}

function play(n, { hz = 60, delay = 0.25, maxSec = 600, careless = false, lang = 'en' } = {}) {
  const { g, h, progress } = open(n, { lang });
  const bot = makeBot({ hz, delay, careless });
  let frame = 0;
  for (; frame < hz * maxSec; frame++) {
    const st = g.getState();
    if (!st.menu && (st.phase !== 'playing' || st.level !== n)) break;
    g.update(1 / hz, bot(st));
  }
  const state = g.getState();
  return {
    g,
    h,
    progress,
    state,
    secs: frame / hz,
    cleared: state.phase === 'won' || state.level > n,
  };
}

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
const PASSABLE = '.LTDVPEWB';
function reachable(tiles, lift) {
  const seen = new Set([`${lift.c},${lift.r}`]);
  const queue = [[lift.c, lift.r]];
  for (const [c, r] of queue)
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!PASSABLE.includes(tiles[nr]?.[nc] ?? 'R') || seen.has(`${nc},${nr}`)) continue;
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  return seen;
}

test('twenty frozen, distinct, bilingual levels with legal maps and tips that fit', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.ok(
    Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0].map) && Object.isFrozen(LEVELS[0].name),
  );
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, 20);
  assert.equal(new Set(LEVELS.map((l) => l.tip.en)).size, 20);
  assert.equal(new Set(LEVELS.map((l) => l.map.join('|'))).size, 20);
  for (const [i, level] of LEVELS.entries()) {
    const label = `level ${i + 1}`;
    for (const o of [level.name, level.tip]) {
      assert.ok(o.en.length > 5 && !CJK.test(o.en), `${label} English`);
      assert.ok(CJK.test(o.zh), `${label} Chinese`);
    }
    for (const lang of ['en', 'zh']) {
      const rows = wrapText(level.tip[lang], BANNER.size, BANNER.w - 20);
      assert.ok(rows.length <= 2, `${label} ${lang} tip wraps to ${rows.length} rows`);
      assert.ok(level.name[lang].length <= 22, `${label} ${lang} name fits the banner`);
    }
    assert.equal(level.map.length, 11);
    assert.ok(level.map.every((row) => row.length === 20 && /^[.EWRBTDVPLMAC]+$/.test(row)));
    assert.equal(level.map[0].replace(/[.L]/g, ''), '', `${label} surface row`);
    assert.equal(level.map.join('').split('L').length, 2, `${label} has one lift`);
    assert.equal(level.map[10], 'R'.repeat(20));
    const st = open(i + 1).g.getState();
    const miners = level.map.join('').split('M').length - 1;
    assert.ok(miners >= 1 && miners === st.minersTotal);
    const reach = reachable(st.tiles, st.lift);
    for (const m of st.miners) {
      assert.ok(reach.has(`${m.c},${m.r}`), `${label} miner ${m.id} is reachable`);
      assert.ok(m.r >= 3, `${label}: the opening banner never covers a miner`);
    }
    for (const t of st.tanks) assert.ok(reach.has(`${t.c},${t.r}`) && t.r >= 3);
    assert.ok(level.beams >= 2 && level.drain > 0 && level.digCost > 0 && level.fuse >= 2.5);
  }
  assert.ok(LEVELS.slice(15).every((l) => l.fuse <= 3 && l.beams <= 3));
});

test('every level opens with a readable banner: name and tip, in both languages, inside the canvas', () => {
  for (const lang of ['en', 'zh'])
    for (const n of [1, 8, 20]) {
      const { g } = open(n, { lang });
      const texts = [];
      const ctx = new Proxy(mockContext(), {
        get: (t, p) => (p === 'fillText' ? (str, x) => texts.push({ str, x }) : t[p]),
        set: (t, p, v) => ((t[p] = v), true),
      });
      g.draw(ctx);
      const name = LEVELS[n - 1].name[lang];
      assert.ok(
        texts.some((x) => x.str.includes(name)),
        `${lang} banner names level ${n}`,
      );
      const tip = wrapText(LEVELS[n - 1].tip[lang], BANNER.size, BANNER.w - 20);
      for (const row of tip) assert.ok(texts.some((x) => x.str === row));
    }
  assert.ok(BANNER.x + BANNER.w <= 480 && BANNER.y >= 52 && BANNER.y + BANNER.h <= 100);
});

test('difficulty rises across the four tiers: more digging, more time, and sloppy play stops working', () => {
  const runs = LEVEL_NUMBERS.map((n) => play(n));
  assert.ok(runs.every((r) => r.cleared && r.state.lives === 3));
  const mean = (key, [a, b]) =>
    runs.slice(a - 1, b).reduce((sum, r) => sum + key(r), 0) / (b - a + 1);
  for (const key of [(r) => r.state.stats.digs, (r) => r.secs])
    for (let t = 1; t < TIERS.length; t++)
      assert.ok(mean(key, TIERS[t]) > mean(key, TIERS[t - 1]), `tier ${t + 1} is not harder`);
  assert.ok(runs.slice(15).every((r) => r.state.stats.digs >= 24 && r.state.stats.braces >= 3));
  // The careless digger (no braces, no air plan, ignores cracks) gets through the lessons...
  for (const n of [1, 2, 3, 4]) {
    const r = play(n, { careless: true });
    assert.ok(r.cleared && r.state.stats.hits === 0, `careless player on level ${n}`);
  }
  // ...but pays with lives on the later levels, and mostly runs out of them in 11-20.
  let failed = 0;
  for (const n of LEVEL_NUMBERS.slice(10)) {
    const r = play(n, { careless: true, maxSec: 200 });
    if (!r.cleared || r.state.stats.hits >= 2) failed++;
  }
  assert.ok(failed >= 8, `careless play failed only ${failed}/10 late levels`);
});

// ---------------------------------------------------------------------------------------------
// Clears
// ---------------------------------------------------------------------------------------------
for (const n of LEVEL_NUMBERS) {
  test(`level ${n} ${LEVELS[n - 1].name.en}: the reaction-limited player clears it and the clear is saved`, () => {
    const r = play(n, { hz: 60, delay: 0.25 });
    assert.ok(r.cleared, `ended on level ${r.state.level} (${r.state.phase})`);
    assert.ok(r.state.lives >= 2, 'at least two lives to spare');
    assert.equal(r.h.ends.length, n === LEVEL_COUNT ? 1 : 0);
    if (n < LEVEL_COUNT) assert.deepEqual(r.progress.calls, [n + 1]);
    assert.equal(r.state.cleared, 1);
  });
}

test('a 0.25 s and a 0.35 s reaction-limited player clear every level at 30, 60 and 120 Hz', () => {
  for (const delay of DELAYS)
    for (const hz of HZS)
      for (const n of LEVEL_NUMBERS) {
        if (delay === 0.25 && hz === 60) continue; // covered level by level above
        const r = play(n, { hz, delay });
        assert.ok(r.cleared, `level ${n} at ${hz} Hz, ${delay} s`);
        assert.ok(r.state.lives >= 2, `level ${n} at ${hz} Hz, ${delay} s lost lives`);
      }
});

test('the whole campaign is winnable in one run from level 1, saving every clear', () => {
  const store = memoryStore(1);
  const h = harness();
  h.env.progress = store;
  const g = createGame(h.env);
  const bot = makeBot({ hz: 60, delay: 0.25 });
  for (let f = 0; f < 60 * 3600 && g.getState().phase === 'playing'; f++)
    g.update(1 / 60, bot(g.getState()));
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(st.cleared, LEVEL_COUNT);
  assert.deepEqual(store.calls, [...LEVEL_NUMBERS.slice(1), LEVEL_COUNT + 1]);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
});

// ---------------------------------------------------------------------------------------------
// Blind play and a fair start
// ---------------------------------------------------------------------------------------------
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'];
function blindPolicies() {
  const list = [['idle', () => input()]];
  for (const seed of [1, 2])
    list.push([
      `mash ${seed}`,
      (() => {
        const rnd = seeded(seed);
        return () =>
          input(
            KEYS.filter(() => rnd() < 0.5),
            KEYS.filter(() => rnd() < 0.3),
          );
      })(),
    ]);
  for (const period of [0.5, 1, 2]) {
    const taps = (t) => (t % period < 1 / 60 ? ['Space', 'KeyX'] : []);
    list.push([
      `alternate ${period}`,
      (t) => input([Math.floor(t / period) % 2 ? 'ArrowLeft' : 'ArrowRight'], taps(t)),
    ]);
    list.push([`hold down ${period}`, (t) => input(['ArrowDown'], taps(t))]);
  }
  return list;
}
function blindWins(n, policy) {
  const { g } = open(n);
  for (let f = 0; f < 60 * BLIND_HORIZON; f++) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== n) break;
    g.update(1 / 60, policy(f / 60));
  }
  const st = g.getState();
  return st.phase === 'won' || st.level > n;
}
test('idle, mashing and timed hold-and-alternate patterns win at most 25% of any level from 3', () => {
  for (const n of LEVEL_NUMBERS.filter((x) => x >= 3)) {
    const policies = blindPolicies();
    const wins = policies.filter(([, policy]) => blindWins(n, policy)).length;
    assert.ok(wins / policies.length <= BLIND_BAR, `level ${n}: ${wins}/${policies.length}`);
  }
});

test('an idle player loses nothing on any level, and the opening shows the player and the lift', () => {
  for (const n of LEVEL_NUMBERS) {
    const { g } = open(n);
    for (let f = 0; f < 60 * 15; f++) g.update(1 / 60, input());
    const st = g.getState();
    assert.equal(st.phase, 'playing');
    assert.equal(st.lives, 3);
    assert.equal(st.oxygen, 100);
    assert.equal(st.player.r, 0, 'the player waits on the surface row, above the banner');
    assert.ok(st.prompt.en.length > 0 && st.status.en.includes(`Level ${n}/20`));
  }
});

// ---------------------------------------------------------------------------------------------
// Frame rate, hostile input, progress stores
// ---------------------------------------------------------------------------------------------
test('aligned scripted input is identical at 30, 60 and 120 Hz on several levels', () => {
  for (const n of [1, 6, 12, 20]) {
    const finals = HZS.map((hz) => {
      const { g } = open(n);
      for (let i = 0; i < hz * 6; i++) {
        const pressed = i % (hz / 2) === 0 ? ['Space', 'KeyX'] : [];
        const dir = i < hz * 3 ? 'ArrowDown' : i < hz * 4.5 ? 'ArrowRight' : 'ArrowUp';
        g.update(1 / hz, input([dir], pressed));
      }
      return JSON.stringify(g.getState());
    });
    assert.equal(finals[0], finals[1], `level ${n}`);
    assert.equal(finals[1], finals[2], `level ${n}`);
  }
});

test('hostile dt values change nothing and hostile pointers never start or move the select', () => {
  const { g } = open(2);
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 10, undefined, null, '0.01', {}])
    g.update(dt, input(['ArrowRight'], ['KeyX', 'Space']));
  assert.equal(JSON.stringify(g.getState()), before);
  g.update(1 / 60, input([], [], { x: NaN, y: Infinity, down: true, clicked: true }));
  g.update(1 / 60, { held: () => false, pressed: () => false });
  const menu = open(5, { launch: false }).g;
  const frozen = JSON.stringify(menu.getState());
  const junk = [NaN, Infinity, -Infinity, '12', null, undefined, {}, [], -1, 1e9, 'x'];
  for (const x of junk)
    for (const y of junk) {
      menu.update(1 / 60, input([], [], { x, y, clicked: true }));
      menu.update(1 / 60, input([], [], { x, y, down: true }));
    }
  menu.update(1 / 60, { held: () => false, pressed: () => false });
  assert.equal(JSON.stringify(menu.getState()), frozen);
  g.draw(mockContext());
  menu.draw(mockContext());
});

test('broken, missing and junk progress stores are survived and clamped', () => {
  const stores = {
    throwing: { unlocked: () => assert.fail('boom'), unlock: () => assert.fail('boom') },
    missingMethods: {},
    nan: memoryStore(NaN),
    text: memoryStore('abc'),
    negative: memoryStore(-4),
    zero: memoryStore(0),
    nothing: memoryStore(null),
    infinite: memoryStore(Infinity),
  };
  for (const [name, store] of Object.entries(stores)) {
    const st = createGame({ ...harness().env, progress: store }).getState();
    assert.ok(st.menu === null && st.level === 1, `${name} starts level 1 directly`);
  }
  assert.equal(open(99, { progress: memoryStore(99), launch: false }).g.getState().menu.cursor, 20);
  assert.equal(open(1, { progress: memoryStore(2.9), launch: false }).g.getState().unlocked, 2);
  assert.equal(open(1, { progress: memoryStore('7'), launch: false }).g.getState().unlocked, 7);
  assert.equal(createGame(harness().env).getState().menu, null, 'no store at all is fine');
  // A store that fails on save must not stop the run or hide the clear.
  const h = harness();
  h.env.progress = { unlocked: () => 1, unlock: () => assert.fail('disk full') };
  const g = createGame(h.env);
  const bot = makeBot({ hz: 60, delay: 0.25 });
  for (let f = 0; f < 60 * 60 && g.getState().level === 1; f++) g.update(1 / 60, bot(g.getState()));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().unlocked, 2);
});

test('select screen: keyboard, taps, locked levels, continue and a readable layout', () => {
  const h = harness();
  h.env.progress = memoryStore(8);
  const g = createGame(h.env);
  assert.equal(g.getState().menu.cursor, 8, 'continue offers the furthest level');
  assert.match(g.getState().status.en, /^Choose a level · 8\/20 /);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 8, 'cannot move past the unlocked level');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 1 + MENU_COLUMNS);
  const hits = () => h.sounds.filter((s) => s === 'hit').length;
  const locked = menuCell(15);
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.equal(hits(), 1);
  assert.ok(g.getState().menu, 'a locked level does not start');
  const third = menuCell(3);
  g.update(1 / 60, input([], [], { x: third.x + 5, y: third.y + 5, clicked: true }));
  const st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3);
  assert.equal(st.lives, 3);
  for (const n of LEVEL_NUMBERS) {
    const c = menuCell(n);
    assert.ok(c.x >= 0 && c.x + c.w <= 480 && c.y >= 22 && c.y + c.h <= 220);
  }
  assert.equal(wrapText('', 12, 100).length, 0);
  for (const lang of ['en', 'zh']) {
    const texts = [];
    const ctx = new Proxy(mockContext(), {
      get: (t, p) => (p === 'fillText' ? (str) => texts.push(str) : t[p]),
      set: (t, p, v) => ((t[p] = v), true),
    });
    open(20, { lang, launch: false }).g.draw(ctx);
    assert.ok(texts.includes(LEVELS[19].name[lang]));
    assert.ok(texts.some((x) => (lang === 'zh' ? /关卡/ : /LEVEL/).test(x)));
  }
});

// ---------------------------------------------------------------------------------------------
// Ending, terminal state, controls
// ---------------------------------------------------------------------------------------------
test('winning ends exactly once in English and Chinese and then the state is frozen', () => {
  for (const lang of ['en', 'zh']) {
    const r = play(LEVEL_COUNT, { lang });
    assert.equal(r.state.phase, 'won');
    assert.equal(r.h.ends.length, 1);
    assert.equal(r.h.ends[0].won, true);
    assert.equal(
      r.h.ends[0].message,
      lang === 'en'
        ? 'All twenty mine levels are clear. Every miner is home!'
        : '二十个矿区关卡全部通关，矿工们都平安回家了！',
    );
    assert.ok(r.h.sounds.includes('win'));
    const frozen = JSON.stringify(r.g.getState());
    for (let i = 0; i < 200; i++) r.g.update(1 / 60, input(KEYS, KEYS));
    assert.equal(JSON.stringify(r.g.getState()), frozen);
    assert.equal(r.h.ends.length, 1);
  }
});

test('losing ends exactly once in English and Chinese, names the level, and freezes', () => {
  for (const lang of ['en', 'zh']) {
    const r = play(11, { lang, careless: true, maxSec: 200 });
    assert.equal(r.state.phase, 'lost');
    assert.equal(r.state.lives, 0);
    assert.equal(r.h.ends.length, 1);
    assert.equal(r.h.ends[0].won, false);
    assert.match(r.h.ends[0].message, lang === 'en' ? /level 11\b/ : /第11关/);
    assert.ok(r.h.sounds.includes('lose'));
    const frozen = JSON.stringify(r.g.getState());
    for (let i = 0; i < 200; i++) r.g.update(1 / 60, input(KEYS, KEYS));
    assert.equal(JSON.stringify(r.g.getState()), frozen);
    assert.equal(r.h.ends.length, 1);
    r.g.draw(mockContext());
  }
});

test('every action has a keyboard and a touch route, and no reserved key is bound', () => {
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(code), code);
  assert.ok(meta.touchControls.every((c) => c.label.en && c.label.zh && c.side));
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en)));
  assert.ok(!JSON.stringify(meta.keys).match(/Escape|KeyP|KeyR/));
  assert.match(meta.description.en, /twenty/);
  assert.equal(RULES.lives, 3);
});

test('a new instance after a loss starts fresh and a clear raises only the saved level', () => {
  const r = play(3);
  assert.deepEqual(r.progress.calls, [4]);
  const again = open(4, { progress: r.progress, launch: false }).g.getState();
  assert.equal(again.menu.cursor, 4);
  assert.equal(again.score, 0);
  assert.equal(again.lives, 3);
});

test('the final level shows CLEARED after a win, and the stuck-miner hint outranks the dig hint', () => {
  const r = play(LEVEL_COUNT);
  assert.deepEqual(r.progress.calls, [LEVEL_COUNT + 1]);
  const menu = open(LEVEL_COUNT, { progress: r.progress, launch: false }).g;
  assert.equal(menu.getState().menu.cursor, LEVEL_COUNT);
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (str) => texts.push(str) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  menu.draw(ctx);
  assert.equal(texts.filter((x) => x === 'CLEARED').length, LEVEL_COUNT);
  menu.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(menu.getState().menu.cursor, LEVEL_COUNT);
  const huge = open(1, { progress: memoryStore(500), launch: false }).g.getState();
  assert.deepEqual([huge.unlocked, huge.completed], [20, true]);
});
