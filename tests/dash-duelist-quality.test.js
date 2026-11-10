import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  meta,
  createGame,
  shapeHitsBody,
  drawMenu,
  levelOf,
  menuCell,
  textWidth,
  wrapLines,
  ARENA,
  BODY,
  LEVELS,
  LEVEL_COUNT,
  MENU_COLUMNS,
  PLAYER,
  PROMPTS,
  ATTACKS,
  DASH_NOW,
  dangerPrompt,
  TIP_BOX,
  TIP_WIDTH,
  TIP_SIZE,
} from '../src/games/dash-duelist.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ------------------------------------------------------------ test pilots

// A game started on a given level the way a player does it: unlocked progress, then Space in the menu.
function startAt(level, { seed = 1, lang = 'en', progress } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = progress ?? { unlocked: () => level, unlock() {} };
  const game = createGame(h.env);
  if (level > 1) game.update(1 / 60, input([], ['Space']));
  return { h, game };
}

const DIRS8 = [
  ['ArrowRight'],
  ['ArrowLeft'],
  ['ArrowUp'],
  ['ArrowDown'],
  ['ArrowRight', 'ArrowUp'],
  ['ArrowRight', 'ArrowDown'],
  ['ArrowLeft', 'ArrowUp'],
  ['ArrowLeft', 'ArrowDown'],
];
const vec = (keys) => {
  const dx = (keys.includes('ArrowRight') ? 1 : 0) - (keys.includes('ArrowLeft') ? 1 : 0);
  const dy = (keys.includes('ArrowDown') ? 1 : 0) - (keys.includes('ArrowUp') ? 1 : 0);
  const n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
};
const inArena = (x, y) => [
  Math.min(Math.max(x, ARENA.x0), ARENA.x1),
  Math.min(Math.max(y, ARENA.y0), ARENA.y1),
];
// A walker cannot pass through the rival, so such escape routes are not real options.
const pathBlocked = (me, vx, vy, rv) =>
  [11, 22, 33, 44].some(
    (k) => Math.abs(me.x + vx * k - rv.x) < 20 && Math.abs(me.y + vy * k - rv.y) < 28,
  );
const towards = (dx, dy, dead = 5) => {
  const keys = [];
  if (dx > dead) keys.push('ArrowRight');
  if (dx < -dead) keys.push('ArrowLeft');
  if (dy > dead) keys.push('ArrowDown');
  if (dy < -dead) keys.push('ArrowUp');
  return keys;
};
const REACH = { reed: 40, mira: 78, kade: 44 };
// Circle the rival at the edge of its reach: committed shapes do not follow, so moving sideways
// keeps the player ready for the OPEN mark.
function strafe(me, rv, memory) {
  const ux = me.x - rv.x,
    uy = me.y - rv.y,
    d = Math.hypot(ux, uy) || 1;
  memory.dir ??= 1;
  const step = (dir) => [me.x + (-uy / d) * dir * 14, me.y + (ux / d) * dir * 14];
  let [nx, ny] = step(memory.dir);
  if (nx < ARENA.x0 + 4 || nx > ARENA.x1 - 4 || ny < ARENA.y0 + 4 || ny > ARENA.y1 - 4) {
    memory.dir = -memory.dir;
    [nx, ny] = step(memory.dir);
  }
  const pull = ((d - REACH[rv.id]) / d) * 0.5;
  return towards(nx - me.x - pull * ux, ny - me.y - pull * uy);
}

// One decision from a delayed view of the screen (`seen`) and the player's own live position
// (`now`). Nothing hidden is read: only getState().
function decide(seen, now, memory, lagEstimate) {
  const me = now.player,
    rv = seen.rival;
  if (!rv) return [];
  const tg = rv.telegraph;
  if (tg && !tg.active) {
    const id = `${tg.ox}:${tg.oy}:${tg.angle}:${tg.windup}`;
    const inside = shapeHitsBody(tg, me);
    let best = null;
    if (inside)
      for (const keys of DIRS8) {
        const [vx, vy] = vec(keys);
        const [x, y] = inArena(me.x + vx * 44, me.y + vy * 44);
        const d = Math.hypot(x - rv.x, y - rv.y);
        if (!shapeHitsBody(tg, { x, y }) && !pathBlocked(me, vx, vy, rv) && (!best || d < best.d))
          best = { keys, d };
      }
    // Dash when no walkable way out exists or there is no time to walk, pressing it about a tenth
    // of a second before the shape fires (a human judges the growing outline).
    const hurried = tg.remaining < lagEstimate + 0.3;
    if (inside && !memory.noDash && memory.plan?.id !== id && (!best || hurried))
      memory.plan = {
        id,
        at: now.time + Math.max(0, tg.remaining - lagEstimate - 0.1),
        fired: false,
      };
    if (best) return best.keys;
    return inside ? towards(rv.x - me.x, rv.y - me.y) : [];
  }
  if (tg) return [];
  if (rv.vulnerable) return towards(rv.x - me.x, rv.y - me.y, 6);
  return strafe(me, rv, memory);
}

/**
 * Play one level with a reaction-limited pilot. It sees the world `lag` seconds late, decides every
 * 0.08-0.16 s, strikes only an open rival it is next to and dashes only on a visible shape.
 */
function pilot({ level, hz, seed, lag, dash = true, maxSeconds = 240, watch }) {
  const { h, game } = startAt(level, { seed });
  const random = seeded(seed * 131 + hz),
    dt = 1 / hz,
    history = [],
    memory = { noDash: !dash };
  let t = 0,
    next = 0,
    keys = [],
    lastPress = -9,
    lowestHp = PLAYER.maxHp;
  for (; t < maxSeconds; t += dt) {
    const s = game.getState();
    watch?.(s, t);
    history.push({ t, s });
    if (history.length > 120) history.shift();
    lowestHp = Math.min(lowestHp, s.player.hp);
    if (s.phase !== 'playing' || s.level > level) break;
    const pressed = [];
    const plan = memory.plan;
    if (plan && !plan.fired && s.time >= plan.at) {
      plan.fired = true;
      if (s.player.charges > 0) pressed.push('KeyX');
    }
    if (t >= next) {
      next = t + 0.08 + random() * 0.08;
      const seen = [...history].reverse().find((o) => o.t <= t - (lag + random() * 0.05));
      keys = decide((seen ?? history[0]).s, s, memory, lag + 0.025);
    }
    const rv = s.rival;
    if (rv?.vulnerable && t - lastPress > 0.25) {
      const near = Math.hypot(rv.x - s.player.x, rv.y - s.player.y) < 32;
      if (near && history.some((o) => o.t <= t - lag && o.s.rival?.vulnerable)) {
        pressed.push('Space');
        lastPress = t;
      }
    }
    game.update(dt, input(keys, pressed));
  }
  const s = game.getState();
  return { h, game, seconds: t, lowestHp, cleared: s.phase === 'won' || s.level > level };
}

const clears = (level, hz, lag, seeds) =>
  seeds.map((seed) => pilot({ level, hz, seed, lag })).filter((r) => r.cleared).length;
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

// ----------------------------------------------------------- level data

test('quality: 20 distinct data-driven levels on a teaching, combination and mastery curve', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.equal(LEVELS.length, 20);
  assert.deepEqual(
    ['teach', 'combo', 'master'].map((tier) => LEVELS.filter((l) => l.tier === tier).length),
    [7, 7, 6],
  );
  const signature = (l) =>
    JSON.stringify([
      l.rival.id,
      l.rival.hp,
      l.rival.patterns.map((p) => p.steps.map((s) => [s.label[0], s.windup])),
    ]);
  assert.equal(new Set(LEVELS.map(signature)).size, 20, 'no two levels are the same fight');
  LEVELS.forEach((l, i) => {
    assert.ok(Object.isFrozen(l) && Object.isFrozen(l.rival) && Object.isFrozen(l.tip));
    assert.ok(Object.isFrozen(l.rival.patterns) && Object.isFrozen(l.rival.patterns[0].steps));
    assert.ok(Object.isFrozen(l.rival.patterns[0].steps[0]), `level ${i + 1}`);
    for (const p of l.rival.patterns) for (const s of p.steps) assert.ok(s.windup >= 0.5);
    assert.ok(l.rival.hp >= 2 && l.rival.hp <= 9, 'HP pips fit the HUD');
  });
  assert.ok(Object.isFrozen(PROMPTS) && Object.isFrozen(PROMPTS.open));
  // the curve: windups shrink and chains grow from teaching to mastery
  const tierStat = (tier, pick) => {
    const v = LEVELS.filter((l) => l.tier === tier).flatMap((l) =>
      l.rival.patterns.flatMap((p) => pick(p)),
    );
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const fastest = (tier) =>
    Math.min(
      ...LEVELS.filter((l) => l.tier === tier).flatMap((l) =>
        l.rival.patterns.flatMap((p) => p.steps.filter((s) => !s.heavy).map((s) => s.windup)),
      ),
    );
  assert.ok(fastest('teach') > fastest('combo') && fastest('combo') > fastest('master'));
  const chain = (tier) => tierStat(tier, (p) => [p.steps.length]);
  assert.ok(chain('teach') < chain('combo') && chain('combo') < chain('master'));
});

test('quality: every level has bilingual names and tips that fit the banner', () => {
  LEVELS.forEach((l, i) => {
    for (const lang of ['en', 'zh']) {
      assert.ok(l.name[lang].length > 1 && l.tip[lang].length > 10, `level ${i + 1} ${lang}`);
      const lines = wrapLines(l.tip[lang], TIP_SIZE, TIP_WIDTH);
      assert.ok(lines.length <= 2, `level ${i + 1} ${lang} tip is ${lines.length} lines`);
      for (const line of lines) assert.ok(textWidth(line, TIP_SIZE) <= TIP_WIDTH);
      assert.ok(textWidth(`${i + 1}. ${l.name[lang]}`, 14) <= 480);
    }
    assert.ok(/[一-鿿]/.test(l.tip.zh) && !/[一-鿿]/.test(l.tip.en));
  });
  assert.deepEqual(wrapLines('one two', 14, 1000), ['one two']);
  assert.ok(wrapLines('aaaa bbbb cccc', 14, 60).length > 1);
});

const stepsOf = (l) => l.rival.patterns.flatMap((p) => p.steps);
const hasLabel = (l, name) => stepsOf(l).some((s) => s.label[0].toLowerCase() === name);
const longestRun = (l, name) =>
  Math.max(
    ...l.rival.patterns.map((p) => {
      let best = 0,
        run = 0;
      for (const s of p.steps) {
        run = s.label[0].toLowerCase() === name ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    }),
  );

test('quality: tips describe what the level actually does', () => {
  const words = [
    ['slash', (l) => hasLabel(l, 'slash')],
    ['cut', (l) => hasLabel(l, 'cut')],
    ['thrust', (l) => hasLabel(l, 'thrust')],
    ['ring', (l) => stepsOf(l).some((s) => s.shape === 'ring')],
    ['charge', (l) => hasLabel(l, 'charge')],
    ['heavy', (l) => stepsOf(l).some((s) => s.heavy)],
    ['big ring', (l) => hasLabel(l, 'ring sweep') && stepsOf(l).some((s) => s.r1 > 90)],
    ['huge', (l) => stepsOf(l).some((s) => s.r1 > 90)],
  ];
  LEVELS.forEach((l, i) => {
    const tip = l.tip.en.toLowerCase();
    for (const [word, present] of words)
      if (tip.includes(word)) assert.ok(present(l), `level ${i + 1} tip says "${word}"`);
    const rival = { reed: 'reed', mira: 'mira', kade: 'kade' }[l.rival.id];
    for (const name of ['reed', 'mira', 'kade'])
      if (tip.includes(name)) assert.equal(name, rival, `level ${i + 1} names ${name}`);
  });
  // counts and orders the tips promise
  assert.equal(longestRun(levelOf(4), 'thrust'), 2, 'thrusts come twice');
  assert.equal(longestRun(levelOf(6), 'cut'), 2, 'cuts twice in a row');
  assert.equal(longestRun(levelOf(11), 'slash'), 3, 'three slashes');
  assert.ok(levelOf(11).tip.en.includes('three'));
  assert.equal(longestRun(levelOf(12), 'thrust'), 2, 'two thrusts into a charge');
  assert.ok(stepsOf(levelOf(12)).some((s, i, a) => s.heavy && a[i - 1]?.label[0] === 'Thrust'));
  assert.equal(longestRun(levelOf(18), 'charge'), 2, 'two heavy charges in a row');
  assert.equal(longestRun(levelOf(18), 'thrust'), 3, 'fast triple thrusts');
  assert.equal(longestRun(levelOf(16), 'thrust') + longestRun(levelOf(16), 'cut'), 2);
  assert.ok(
    levelOf(16).rival.patterns.some((p) => p.steps.length === 4),
    'four shapes',
  );
  assert.ok(
    levelOf(15).rival.patterns.some((p) => p.steps.length === 3),
    'three shapes',
  );
  assert.ok(
    levelOf(14).rival.patterns.some((p) => p.steps[0].label[0] === 'Thrust' && p.steps[1]?.heavy),
  );
  assert.ok(levelOf(8).rival.patterns.some((p) => p.steps[1]?.shape === 'ring'));
  assert.ok(
    levelOf(7).rival.patterns.some((p) => p.steps.length === 2),
    'double cuts still come',
  );
  // each new idea is introduced on its own level: first thrust, first heavy, first ring
  const first = (pick) => LEVELS.findIndex((l) => stepsOf(l).some(pick)) + 1;
  assert.deepEqual(
    [first((s) => s.shape === 'lane'), first((s) => s.heavy), first((s) => s.shape === 'ring')],
    [3, 5, 7],
  );
  assert.ok(levelOf(2).tip.en.includes('X') && levelOf(2).tip.en.includes('3 dashes'));
  assert.equal(PLAYER.maxCharges, 3);
});

// ---------------------------------------------------------------- the pilot

test('quality: the pilot clears every level at 60 Hz with a 0.25 s reaction time', () => {
  for (const level of range(LEVEL_COUNT)) {
    const r = pilot({ level, hz: 60, seed: 3, lag: 0.25 });
    assert.ok(r.cleared, `level ${level} not cleared in ${r.seconds.toFixed(0)} s`);
    assert.ok(r.seconds > 5, 'a duel takes real time');
  }
});

for (const [lag, need] of [
  [0.25, 3],
  [0.35, 3],
]) {
  for (const hz of [30, 60, 120]) {
    test(`quality: a ${lag} s pilot at ${hz} Hz clears at least ${need}/4 on every level`, () => {
      for (const level of range(LEVEL_COUNT)) {
        const won = clears(level, hz, lag, [11, 12, 13, 14]);
        assert.ok(won >= need, `level ${level}: ${won}/4`);
      }
    });
  }
}

test('quality: mastery costs more HP than the middle of the game, level 20 the most', () => {
  const lowest = (level) => {
    const runs = [21, 22, 23, 24, 25, 26].map(
      (seed) => pilot({ level, hz: 60, seed, lag: 0.35 }).lowestHp,
    );
    return runs.reduce((a, b) => a + b, 0) / runs.length;
  };
  const mean = (levels) => levels.map(lowest).reduce((a, b) => a + b, 0) / levels.length;
  const mid = mean([8, 9, 10, 11, 12, 13, 14]);
  const master = mean([15, 16, 17, 18, 19, 20]);
  assert.ok(mid - master >= 0.5, `mid ${mid.toFixed(2)} vs mastery ${master.toFixed(2)}`);
  assert.ok(lowest(20) < mid - 1, `level 20 ${lowest(20).toFixed(2)}`);
  assert.ok(lowest(19) < mid, 'level 19 is harder than the middle');
});

test('quality: dashing is required for the game: a pilot that never dashes fails the heavy levels', () => {
  let wins = 0;
  for (const seed of [1, 2, 3, 4])
    if (pilot({ level: 18, hz: 60, seed, lag: 0.25, dash: false }).cleared) wins++;
  assert.ok(wins <= 1, `${wins}/4 clears without dashing level 18`);
});

// ------------------------------------------------------- blind play bars

const POLICIES = {
  idle: () => ({ held: [], pressed: [] }),
  mash: (t, i) => ({ held: [], pressed: i % 6 === 0 ? ['Space'] : [] }),
  mashToward: (t, i) => ({ held: ['ArrowRight'], pressed: i % 6 === 0 ? ['Space'] : [] }),
  alternate1: (t, i) => ({
    held: Math.floor(t / 1) % 2 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: i % 6 === 0 ? ['Space'] : [],
  }),
  alternate2: (t, i) => ({
    held: Math.floor(t / 2) % 2 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: i % 6 === 0 ? ['Space'] : [],
  }),
  alternate05: (t, i) => ({
    held: Math.floor(t / 0.5) % 2 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: i % 6 === 0 ? ['Space'] : [],
  }),
  weave: (t, i) => ({
    held: [Math.floor(t / 1.5) % 2 ? 'ArrowUp' : 'ArrowDown', 'ArrowRight'],
    pressed: i % 6 === 0 ? ['Space'] : [],
  }),
  dashEvery12s: (t, i) => ({
    held: Math.floor(t / 2.4) % 2 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: [...(i % 6 === 0 ? ['Space'] : []), ...(i % 72 === 0 ? ['KeyX'] : [])],
  }),
  dashEvery20s: (t, i) => ({
    held: Math.floor(t / 2.4) % 2 ? ['ArrowLeft'] : ['ArrowRight'],
    pressed: [...(i % 6 === 0 ? ['Space'] : []), ...(i % 120 === 0 ? ['KeyX'] : [])],
  }),
  dashEvery30s: (t, i) => ({
    held: Math.floor(t / 3) % 2 ? ['ArrowUp'] : ['ArrowDown'],
    pressed: [...(i % 6 === 0 ? ['Space'] : []), ...(i % 180 === 0 ? ['KeyX'] : [])],
  }),
};

function playBlind(level, seed, policy, maxSeconds = 150) {
  const { h, game } = startAt(level, { seed });
  const dt = 1 / 60;
  for (let i = 0; i * dt < maxSeconds && h.ends.length === 0; i++) {
    const a = policy(i * dt, i);
    game.update(dt, input(a.held, a.pressed));
    if (game.getState().level > level) return true;
  }
  return h.ends.length > 0 && h.ends[0].won;
}

test('quality: idle, mashing, held-direction and fixed-period dash patterns win at most 25% from level 3', () => {
  const rand = (seed) => {
    const r = seeded(seed * 7);
    return () => ({
      held: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => r() < 0.4),
      pressed: [...(r() < 0.2 ? ['Space'] : []), ...(r() < 0.05 ? ['KeyX'] : [])],
    });
  };
  for (let level = 3; level <= LEVEL_COUNT; level++) {
    let wins = 0,
      runs = 0;
    for (const policy of Object.values(POLICIES))
      for (const seed of [1, 2, 3]) {
        runs++;
        if (playBlind(level, seed, policy)) wins++;
      }
    for (const seed of [1, 2, 3]) {
      runs++;
      if (playBlind(level, seed, rand(seed))) wins++;
    }
    assert.ok(wins / runs <= 0.25, `level ${level}: ${wins}/${runs} blind wins`);
  }
});

test('quality: an idle player loses no HP in the first 4 s of any level and can read the tip', () => {
  for (const level of range(LEVEL_COUNT)) {
    const { game } = startAt(level);
    let sawTip = false;
    for (let i = 0; i < 60 * 4; i++) {
      game.update(1 / 60, input());
      const s = game.getState();
      sawTip ||= s.tip.visible;
      assert.equal(s.player.hp, PLAYER.maxHp, `level ${level} at ${s.time.toFixed(2)} s`);
    }
    assert.ok(sawTip, `level ${level} shows its tip`);
    const s = game.getState();
    assert.equal(s.tip.visible, true, 'the tip is still up after 4 s');
    assert.ok(s.tip.en.length > 10 && s.tip.zh.length > 4);
  }
});

test('quality: the tip banner stays above every fighter and the arena', () => {
  assert.ok(TIP_BOX.y >= 30 && TIP_BOX.y + TIP_BOX.h <= ARENA.y0 - BODY.hh);
  assert.ok(TIP_BOX.x >= 0 && TIP_BOX.x + TIP_BOX.w <= 480);
});

// ------------------------------------------------------ progress and select

const store = (initial, { throwOnRead = false, throwOnWrite = false } = {}) => {
  const log = { writes: [], reads: 0 };
  return {
    log,
    unlocked: () => {
      log.reads++;
      if (throwOnRead) throw new Error('store unreadable');
      return initial;
    },
    unlock: (n) => {
      if (throwOnWrite) throw new Error('store unwritable');
      log.writes.push(n);
    },
  };
};

test('quality: no progress store starts level 1 at once; a fresh store too', () => {
  const h = harness();
  const s = createGame(h.env).getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 1);
  const fresh = startAt(1, { progress: store(1) }).game.getState();
  assert.equal(fresh.menu, null);
  assert.equal(fresh.unlocked, 1);
});

test('quality: junk progress values are clamped, and a broken store never stops the game', () => {
  const cases = [
    [undefined, 1],
    [null, 1],
    [NaN, 1],
    [-3, 1],
    [0, 1],
    [2.9, 2],
    ['7', 7],
    ['abc', 1],
    [Infinity, 1],
    [-Infinity, 1],
    [99, 20],
    [{}, 1],
    [[], 1],
    [true, 1],
  ];
  for (const [value, expected] of cases) {
    const g = createGame({ ...harness().env, progress: store(value) }).getState();
    assert.equal(g.unlocked, expected, String(value));
    assert.equal(g.menu ? g.menu.cursor : 1, expected);
  }
  const unreadable = store(5, { throwOnRead: true });
  const g = createGame({ ...harness().env, progress: unreadable });
  assert.equal(g.getState().unlocked, 1);
  assert.equal(g.getState().menu, null);
  // a store whose read returns a Symbol throws inside Number(); still safe
  const symbolic = createGame({ ...harness().env, progress: { unlocked: () => Symbol('x') } });
  assert.equal(symbolic.getState().unlocked, 1);
  assert.equal(createGame({ ...harness().env, progress: {} }).getState().unlocked, 1);
});

test('quality: clearing a level unlocks the next one, and a throwing store cannot hurt the run', () => {
  for (const throwOnWrite of [false, true]) {
    const progress = store(1, { throwOnWrite });
    const { h, game } = startAt(1, { progress });
    for (let i = 0; i < 60 * 120 && game.getState().level === 1; i++) {
      const s = game.getState();
      const rv = s.rival;
      const near = rv && Math.hypot(rv.x - s.player.x, rv.y - s.player.y) < 36;
      // a patient pilot: step away from a shape, then strike once the rival is open
      const keys =
        rv?.telegraph && !rv.telegraph.active && shapeHitsBody(rv.telegraph, s.player)
          ? towards(s.player.x - rv.x, s.player.y - rv.y + 30)
          : rv?.vulnerable && !near
            ? towards(rv.x - s.player.x, rv.y - s.player.y, 6)
            : [];
      game.update(1 / 60, input(keys, rv?.vulnerable && near ? ['Space'] : []));
      if (s.phase !== 'playing') break;
    }
    const s = game.getState();
    assert.equal(s.phase, 'playing', 'the run continues');
    assert.equal(s.level, 2);
    assert.equal(s.unlocked, 2);
    assert.deepEqual(progress.log.writes, throwOnWrite ? [] : [2]);
    assert.equal(h.ends.length, 0);
  }
});

test('quality: the select continues at the highest unlocked level and never lowers it', () => {
  const progress = store(5);
  const { game } = startAt(1, { progress });
  let s = game.getState();
  assert.deepEqual(s.menu, { cursor: 5, unlocked: 5, total: 20, columns: MENU_COLUMNS });
  assert.equal(s.level, 1, 'the world has not started yet');
  game.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(game.getState().menu.cursor, 4);
  game.update(1 / 60, input([], ['KeyA']));
  game.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(game.getState().menu.cursor, 1, 'up stops at the first level');
  game.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(game.getState().menu.cursor, 5, 'down is clamped to the unlocked level');
  game.update(1 / 60, input([], ['ArrowRight', 'KeyD']));
  assert.equal(game.getState().menu.cursor, 5, 'locked levels cannot be selected');
  game.update(1 / 60, input([], ['KeyW', 'ArrowLeft']));
  game.update(1 / 60, input([], ['KeyS']));
  game.update(1 / 60, input([], ['Enter']));
  s = game.getState();
  assert.equal(s.menu, null);
  assert.ok(s.level >= 1 && s.level <= 5);
  assert.deepEqual(progress.log.writes, [], 'starting a level never lowers or raises progress');
});

test('quality: taps pick levels; locked cells refuse with a sound; hostile pointers are ignored', () => {
  const progress = store(3);
  const h = harness();
  h.env.progress = progress;
  const game = createGame(h.env);
  const centre = (n) => {
    const c = menuCell(n);
    return { x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true };
  };
  const hostile = [
    { x: NaN, y: NaN, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: '100', y: '50', clicked: true },
    { x: null, y: undefined, clicked: true },
    { x: {}, y: [], clicked: true },
    { x: Symbol('x'), y: 3, clicked: true },
    { x: -500, y: 9e9, clicked: true },
    { x: 10, y: 40, clicked: false },
  ];
  for (const p of hostile) {
    game.update(1 / 60, input([], [], p));
    assert.equal(game.getState().menu.cursor, 3);
  }
  game.update(1 / 60, { held: () => false, pressed: () => false, pointer: null });
  game.update(1 / 60, { held: () => false, pressed: () => false });
  assert.equal(game.getState().menu.cursor, 3);
  const before = h.sounds.length;
  game.update(1 / 60, input([], [], centre(7)));
  assert.equal(h.sounds.at(-1), 'hit');
  assert.equal(h.sounds.length, before + 1);
  assert.equal(game.getState().menu.cursor, 3, 'a locked cell does not select');
  game.update(1 / 60, input([], [], centre(2)));
  const s = game.getState();
  assert.equal(s.menu, null, 'tapping an unlocked cell starts that level');
  assert.equal(s.level, 2);
  assert.equal(s.rival.id, levelOf(2).rival.id);
  assert.ok(menuCell(20).y + menuCell(20).h < 262, 'the grid leaves room for the caption');
});

test('quality: the level select draws in both languages with tier tags and a caption', () => {
  for (const lang of ['en', 'zh']) {
    const log = [];
    const ctx = new Proxy(mockContext(), {
      get: (t, p) => (p === 'fillText' ? (s) => log.push(s) : t[p]),
      set: (t, p, v) => ((t[p] = v), true),
    });
    const h = harness({ lang });
    drawMenu(ctx, h.env, { cursor: 12, unlocked: 12 });
    assert.ok(log.includes(lang === 'en' ? 'Choose a level' : '选择关卡'));
    assert.ok(log.includes(lang === 'en' ? 'TEACH' : '教学'));
    assert.ok(log.includes(lang === 'en' ? 'COMBO' : '组合'));
    assert.ok(log.includes('13 --'), 'locked cells say so');
    assert.ok(log.some((s) => s.startsWith('12. ')));
    assert.ok(!log.some((s) => s === 'MASTER' || s === '精通'), 'locked tiers are not named');
    const game = createGame({ ...h.env, progress: store(20) });
    game.draw(ctx);
    assert.ok(log.includes(lang === 'en' ? 'MASTER' : '精通'));
  }
});

// ---------------------------------------------------- determinism and fuzz

test('quality: state is identical at 30, 60 and 120 Hz on the late levels too', () => {
  const script = (i) => ({
    held: i < 90 ? ['ArrowRight'] : i < 150 ? ['ArrowDown', 'ArrowLeft'] : ['ArrowUp'],
    pressed: [...(i % 17 === 0 ? ['Space'] : []), ...(i % 45 === 20 ? ['KeyX'] : [])],
  });
  for (const level of [5, 12, 20]) {
    const run = (hz) => {
      const { game } = startAt(level, { seed: 4 });
      const frames = [];
      for (let i = 0; i < 360; i++) {
        const { held, pressed } = script(i);
        for (let k = 0; k < hz / 30; k++) game.update(1 / hz, input(held, k === 0 ? pressed : []));
        frames.push(JSON.stringify(game.getState()));
      }
      return frames;
    };
    const base = run(30);
    assert.deepEqual(run(60), base, `level ${level} at 60 Hz`);
    assert.deepEqual(run(120), base, `level ${level} at 120 Hz`);
  }
});

test('quality: hostile dt values are inert in the select, in play and after the end', () => {
  const bad = [0, -1, NaN, Infinity, -Infinity, 1.0001, 5, 1e9, '0.016', null, undefined, {}];
  for (const level of [1, 6]) {
    const { game } = startAt(level, { progress: store(level) });
    for (let i = 0; i < 30; i++) game.update(1 / 60, input(['ArrowLeft']));
    const before = JSON.stringify(game.getState());
    for (const dt of bad) {
      game.update(dt, input(['ArrowRight'], ['Space', 'KeyX']));
      assert.equal(JSON.stringify(game.getState()), before, `dt ${String(dt)}`);
    }
  }
  const menuGame = createGame({ ...harness().env, progress: store(4) });
  const menuBefore = JSON.stringify(menuGame.getState());
  for (const dt of bad) menuGame.update(dt, input([], ['ArrowLeft', 'Space']));
  assert.equal(JSON.stringify(menuGame.getState()), menuBefore);
  // a frame longer than 1/30 s is capped, not skipped
  const { game: slow } = startAt(1);
  const t0 = slow.getState().time;
  slow.update(0.5, input());
  assert.ok(Math.abs(slow.getState().time - t0 - 1 / 30) < 0.01);
  // seeded fuzz with hostile pointer data never produces NaN or an invalid state
  for (const level of [3, 19]) {
    const { h, game } = startAt(level, { seed: 8 });
    const r = seeded(level);
    for (let i = 0; i < 60 * 90 && h.ends.length === 0; i++) {
      const held = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW'].filter(
        () => r() < 0.3,
      );
      const dt = r() < 0.05 ? [NaN, 3, -1, Infinity][Math.floor(r() * 4)] : 1 / 60;
      game.update(dt, input(held, r() < 0.2 ? ['Space', 'KeyX'] : [], { x: NaN, y: 'a' }));
      const s = game.getState();
      for (const v of [s.score, s.time, s.player.x, s.player.y, s.player.hp, s.player.charges])
        assert.ok(Number.isFinite(v));
      assert.ok(s.player.x >= ARENA.x0 && s.player.x <= ARENA.x1);
      assert.ok(s.player.hp >= 0 && s.player.hp <= PLAYER.maxHp);
    }
    assert.ok(h.ends.length <= 1);
  }
});

// ------------------------------------------------------------ end of run

test('quality: a loss ends the run once, in English and Chinese, and the state freezes', () => {
  for (const lang of ['en', 'zh']) {
    const { h, game } = startAt(4, { lang });
    for (let i = 0; i < 60 * 150 && h.ends.length === 0; i++) game.update(1 / 60, input());
    assert.equal(h.ends.length, 1);
    const [end] = h.ends;
    assert.equal(end.won, false);
    assert.equal(/[一-鿿]/.test(end.message), lang === 'zh');
    assert.ok(end.message.length > 10);
    assert.ok(h.sounds.includes('lose'));
    const frozen = JSON.stringify(game.getState());
    for (let i = 0; i < 120; i++) game.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(game.getState()), frozen);
    assert.equal(h.ends.length, 1);
    assert.equal(game.getState().phase, 'lost');
    game.draw(mockContext());
  }
});

test('quality: clearing level 20 reports a win exactly once, in both languages, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    let result;
    for (const seed of range(8)) {
      const { h, game } = startAt(LEVEL_COUNT, { seed, lang, progress: store(LEVEL_COUNT) });
      result = null;
      const r = pilotOn(game, h);
      if (r) {
        result = { h, game };
        break;
      }
    }
    assert.ok(result, 'one of eight seeds wins level 20');
    const { h, game } = result;
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(/[一-鿿]/.test(h.ends[0].message), lang === 'zh');
    assert.ok(h.ends[0].score > 0 && h.sounds.includes('win'));
    const frozen = JSON.stringify(game.getState());
    for (let i = 0; i < 120; i++) game.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(game.getState()), frozen);
    assert.equal(game.getState().phase, 'won');
    assert.equal(h.ends.length, 1);
    game.draw(mockContext());
  }
});

// Drive an already-started game with the pilot's policy; true when the run was won.
function pilotOn(game, h) {
  const random = seeded(99),
    memory = {},
    history = [];
  let keys = [],
    next = 0,
    lastPress = -9;
  for (let t = 0; t < 240 && h.ends.length === 0; t += 1 / 60) {
    const s = game.getState();
    history.push({ t, s });
    if (history.length > 60) history.shift();
    const pressed = [];
    if (memory.plan && !memory.plan.fired && s.time >= memory.plan.at) {
      memory.plan.fired = true;
      if (s.player.charges > 0) pressed.push('KeyX');
    }
    if (t >= next) {
      next = t + 0.08 + random() * 0.08;
      const seen = history.find((o) => o.t >= t - 0.25) ?? history[0];
      keys = decide(seen.s, s, memory, 0.25);
    }
    const rv = s.rival;
    if (
      rv?.vulnerable &&
      t - lastPress > 0.25 &&
      Math.hypot(rv.x - s.player.x, rv.y - s.player.y) < 32
    ) {
      pressed.push('Space');
      lastPress = t;
    }
    game.update(1 / 60, input(keys, pressed));
  }
  return game.getState().phase === 'won';
}

// ------------------------------------------------------------ presentation

test('quality: touch controls cover every action and no reserved key is bound', () => {
  const touch = new Set(meta.touchControls.map((c) => c.code));
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(touch.has(code), code);
  // the select uses only keys the touch pad has (arrows, Space) plus taps
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh);
  const source = ['', '-world', '-menu', '-draw', '-art', '-levels', '-geometry']
    .map((s) => readFileSync(new URL(`../src/games/dash-duelist${s}.js`, import.meta.url), 'utf8'))
    .join('\n');
  for (const reserved of ["'KeyR'", "'Escape'", "'KeyP'"])
    assert.ok(!source.includes(reserved), `${reserved} is reserved by the host`);
});

test('quality: every rival tell has a text label, so colour is never the only cue', () => {
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (s) => texts.push(s) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const lang of ['en', 'zh'])
    for (const level of [3, 5, 10]) {
      const { game } = startAt(level, { lang });
      let sawTelegraph = false,
        sawOpen = false;
      for (let i = 0; i < 60 * 40 && !(sawTelegraph && sawOpen); i++) {
        game.update(1 / 60, input([], i % 20 === 0 ? ['Space'] : []));
        const s = game.getState();
        if (s.rival?.telegraph && !sawTelegraph) {
          texts.length = 0;
          game.draw(ctx);
          const label = s.rival.telegraph.label[lang];
          assert.ok(
            texts.some((t) => t.includes(lang === 'en' ? label.toUpperCase() : label)),
            `${lang} level ${level}: ${label} in ${texts}`,
          );
          assert.ok(texts.includes('!') || texts.includes('!!'));
          sawTelegraph = true;
        }
        if (s.rival?.vulnerable && !sawOpen) {
          texts.length = 0;
          game.draw(ctx);
          assert.ok(texts.includes(lang === 'en' ? 'OPEN' : '破绽'));
          sawOpen = true;
        }
        if (s.phase !== 'playing') break;
      }
      assert.ok(sawTelegraph && sawOpen, `level ${level} showed a shape and an opening`);
    }
});

test('quality: the tip, message and HUD text fit the canvas in both languages', () => {
  const widths = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (s, x) => widths.push([s, x, t.font, t.textAlign]) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const lang of ['en', 'zh'])
    for (const level of range(LEVEL_COUNT)) {
      const { game } = startAt(level, { lang });
      for (let i = 0; i < 60 * 3; i++) game.update(1 / 60, input());
      widths.length = 0;
      game.draw(ctx);
      assert.ok(widths.length >= 5);
      for (const [str, x, font, align] of widths) {
        const size = Number(/(\d+)px/.exec(font)[1]);
        const w = textWidth(str, size);
        assert.ok(size >= 14 && size <= 16, `${str} ${size}px`);
        const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
        assert.ok(
          left >= 0 && left + w <= 480,
          `${lang} level ${level}: "${str}" ${left}..${left + w}`,
        );
      }
    }
});

test('quality: scores and HUD pips agree with the rules', () => {
  const s = startAt(20).game.getState();
  assert.equal(s.rival.maxHp, levelOf(20).rival.hp);
  assert.ok(levelOf(20).rival.hp <= 9);
  assert.equal(s.player.maxHp, PLAYER.maxHp);
  assert.ok(s.status.en.startsWith('Level 20/20'));
  assert.ok(s.status.zh.startsWith('第20/20关'));
});

test('quality: every danger prompt fits 480 px at 16 px, in English and Chinese', () => {
  let longest = 0;
  for (const step of Object.values(ATTACKS))
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const charges of [0, 1])
        for (const remaining of [step.windup, DASH_NOW + 0.01, DASH_NOW, 0.1, 0]) {
          const prompt = dangerPrompt(step, angle, charges, remaining);
          for (const text of prompt) {
            longest = Math.max(longest, textWidth(text, 16));
            assert.ok(textWidth(text, 16) <= 480, `${text} is ${textWidth(text, 16)} px`);
          }
          if (step.heavy && charges) {
            const now = remaining <= DASH_NOW;
            assert.equal(prompt[0].endsWith('X: dash NOW!'), now);
            assert.equal(prompt[1].endsWith('现在按X闪身！'), now);
            assert.equal(prompt[0].endsWith('Wait for the fill'), !now);
          }
        }
  assert.ok(longest > 300);
});

test('quality: a press on the dash NOW word covers a heavy hit for fast and slow players', () => {
  for (const level of [5, 10, 18]) {
    const heavy = stepsOf(levelOf(level)).find((st) => st.heavy);
    assert.ok(heavy.windup >= 0.9, 'a long windup before the word appears');
    // pressing r seconds before the hit protects for PLAYER.dashInvuln: every r up to the
    // word's lead time, down to the hit itself, is covered
    assert.ok(DASH_NOW - 0.2 <= PLAYER.dashInvuln - heavy.active);
    assert.ok(DASH_NOW < heavy.windup);
  }
});
