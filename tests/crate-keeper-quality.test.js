import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, LEVELS, moveState, solveLevel } from '../src/games/crate-keeper.js';
import { crateLayout } from '../src/games/crate-keeper-draw.js';
import { reach } from '../src/games/crate-keeper-solver.js';
import { LEVEL_COUNT, LESSONS, TITLES } from '../src/games/crate-keeper-levels.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const LEVEL_IDS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_IDS.filter((n) => n >= 3);
const BLIND_SEEDS = [1, 2, 3];
const BLIND_SECONDS = 20;
const BLIND_HZ = 30;
const BLIND_LIMIT = 0.25;
const DELAYS = [0.25, 0.35];
const BOT_SECONDS = 400;
const STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const DIRECTION_KEYS = Object.keys(STEP);
const BLIND_KEYS = [
  ...DIRECTION_KEYS,
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyZ',
  'KeyX',
  'KeyM',
  'Enter',
];
const CJK = /[一-鿿]/;

function memoryStore(start = 1) {
  const store = {
    value: start,
    unlocked: () => store.value,
    unlock: (n) => {
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
/** Start a run on `level` the way a player does: through the warehouse select. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level) } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, level);
  return { g, h };
}
function settle(g, hz) {
  for (let n = 0; n < hz && g.getState().busy; n++) g.update(1 / hz, input());
}
function press(g, code, hz) {
  g.update(1 / hz, input([], [code]));
  settle(g, hz);
}
/** Clear the current room with the proven key path, then confirm with Next. */
function clearRoom(g, hz) {
  for (const code of solveLevel(g.getState())) press(g, code, hz);
  assert.equal(g.getState().solved, true);
  press(g, 'Enter', hz);
}

// ---------------------------------------------------------------------------------------------
// Clears: every level through its select entry, at every frame rate, ending in one terminal call.
// ---------------------------------------------------------------------------------------------
test('every warehouse is cleared through the select, unlocks the next and counts its pushes', () => {
  for (const n of LEVEL_IDS) {
    const progress = memoryStore(n),
      { g, h } = open(n, { progress, lang: n % 2 ? 'en' : 'zh' }),
      before = g.getState();
    clearRoom(g, 60);
    const after = g.getState();
    assert.equal(after.pushes === 0 && after.level === n + 1, n < LEVEL_COUNT, `level ${n}`);
    assert.equal(progress.value, n + 1);
    assert.equal(before.parPushes > 0, true);
    assert.equal(h.ends.length, n === LEVEL_COUNT ? 1 : 0);
  }
});
test('a full 20-room run is identical at 30, 60 and 120 Hz and ends once in either language', () => {
  const finals = [];
  for (const hz of HZS)
    for (const lang of ['en', 'zh']) {
      const h = harness({ lang }),
        g = createGame(h.env);
      for (let n = 1; n <= LEVEL_COUNT; n++) {
        assert.equal(g.getState().level, n);
        clearRoom(g, hz);
      }
      const final = g.getState();
      assert.equal(final.phase, 'won');
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, true);
      assert.equal(h.ends[0].score, final.score);
      assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
      assert.match(h.ends[0].message, lang === 'en' ? /twenty/ : /二十/);
      finals.push({
        hz,
        lang,
        moves: final.totalMoves,
        pushes: final.totalPushes,
        score: final.score,
      });
      // Terminal state is frozen: more input, hostile time and drawing change nothing.
      const frozen = structuredClone(final);
      for (const dt of [1 / 60, 0, NaN, 1])
        g.update(dt, input(DIRECTION_KEYS, ['Enter', 'KeyZ', 'KeyX', 'KeyH', 'KeyM']));
      g.draw(mockContext());
      assert.deepEqual(g.getState(), frozen);
      assert.equal(h.ends.length, 1);
    }
  for (const f of finals) {
    assert.equal(f.moves, finals[0].moves);
    assert.equal(f.pushes, finals[0].pushes);
    assert.equal(f.score, finals[0].score);
  }
});

// ---------------------------------------------------------------------------------------------
// Blind players: idle, mashing, random keys and simple timed patterns never solve a push puzzle.
// ---------------------------------------------------------------------------------------------
function blindFrame(kind, seed, frame, random) {
  const hz = BLIND_HZ;
  if (kind === 'idle') return input();
  if (kind === 'mash') {
    const keys = BLIND_KEYS.filter(() => random() < 0.4);
    return input(keys, keys);
  }
  if (kind === 'random') {
    const code = BLIND_KEYS[Math.floor(random() * BLIND_KEYS.length)];
    return input([], frame % 3 === 0 ? [code] : []);
  }
  // Timed patterns: hold one key and alternate the pressed direction every `period` seconds.
  const period = Math.max(1, Math.round(hz * [0.2, 0.5, 1][seed - 1])),
    key = DIRECTION_KEYS[Math.floor(frame / period) % 4];
  return input([key], frame % period === 0 ? [key] : []);
}
function blindRun(level, kind, seed) {
  const { g, h } = open(level, { seed }),
    random = seeded(seed * 7919 + level);
  let won = false;
  for (let frame = 0; frame < BLIND_SECONDS * BLIND_HZ && !won; frame++) {
    g.update(1 / BLIND_HZ, blindFrame(kind, seed, frame, random));
    const s = g.getState();
    won = s.level === level ? s.solved : s.level > level;
  }
  assert.equal(h.ends.length, 0);
  return won;
}
for (const kind of ['idle', 'mash', 'random', 'timed'])
  test(`blind ${kind} play wins at most 25% of any level from level 3`, (t) => {
    const rates = BLIND_LEVELS.map((level) => {
      const wins = BLIND_SEEDS.filter((seed) => blindRun(level, kind, seed)).length;
      return wins / BLIND_SEEDS.length;
    });
    assert.ok(
      rates.every((r) => r <= BLIND_LIMIT),
      `${kind}: ${rates}`,
    );
    t.diagnostic(`${kind}: best level rate ${Math.max(...rates)}`);
  });
test('an idle player is never punished: nothing changes and nothing ends', () => {
  const { g, h } = open(1),
    start = g.getState();
  for (let n = 0; n < 30 * 60; n++) g.update(1 / 30, input());
  const idle = g.getState();
  assert.equal(idle.phase, 'playing');
  assert.equal(idle.moves, 0);
  assert.deepEqual(idle.crates, start.crates);
  assert.equal(h.ends.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Reaction-limited bot: only public state, waits its reaction time before every action.
// ---------------------------------------------------------------------------------------------
function botClear(level, hz, delay) {
  const { g, h } = open(level),
    dt = 1 / hz;
  let plan = null,
    lastAct = -Infinity,
    expected = null,
    mistakes = 0,
    moves = 0;
  for (let frame = 0; frame < BOT_SECONDS * hz; frame++) {
    const s = g.getState();
    if (s.level !== level || s.phase !== 'playing') break;
    if (s.busy || s.time - lastAct < delay) {
      g.update(dt, input());
      continue;
    }
    if (expected && (s.player !== expected.player || s.crates.join() !== expected.crates.join())) {
      plan = null;
      mistakes++;
    }
    if (s.solved) {
      g.update(dt, input([], ['Enter']));
      continue;
    }
    plan ??= solveLevel(s);
    const key = plan.shift();
    expected = moveState(s, ...STEP[key]);
    lastAct = s.time;
    moves++;
    g.update(dt, input([], [key]));
  }
  const end = g.getState();
  return {
    cleared: end.level > level || end.phase === 'won',
    mistakes,
    moves,
    ends: h.ends.length,
  };
}
test('a 0.25 s and a 0.35 s reaction-limited bot clears every room at 30, 60 and 120 Hz', () => {
  for (const level of LEVEL_IDS)
    for (const hz of HZS)
      for (const delay of DELAYS) {
        const run = botClear(level, hz, delay);
        assert.equal(run.cleared, true, `level ${level} ${hz}Hz ${delay}s`);
        assert.equal(run.mistakes, 0, `level ${level} ${hz}Hz ${delay}s`);
        assert.equal(run.ends, level === LEVEL_COUNT ? 1 : 0);
      }
});

// ---------------------------------------------------------------------------------------------
// Hostile time, pointers and progress stores.
// ---------------------------------------------------------------------------------------------
test('invalid or paused time never reads input, changes timers or consumes an action', () => {
  for (const solved of [false, true]) {
    const { g, h } = open(1);
    if (solved) g.update(1 / 60, input([], ['ArrowRight']));
    const before = structuredClone(g.getState()),
      sounds = h.sounds.length;
    let reads = 0;
    const hostile = {
      held: () => reads++ || true,
      pressed: () => reads++ || true,
      pointer: { clicked: true, x: 240, y: 150 },
    };
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) g.update(dt, hostile);
    assert.deepEqual(g.getState(), before);
    assert.equal(reads, 0);
    assert.equal(h.sounds.length, sounds);
  }
});
test('hostile pointers and huge frame times never corrupt the board or the select', () => {
  const pointers = [
    undefined,
    null,
    {},
    { clicked: true },
    { clicked: true, x: NaN, y: NaN },
    { clicked: true, x: Infinity, y: -Infinity },
    { clicked: true, x: 'abc', y: {} },
    { clicked: true, x: -1e9, y: 1e9 },
    { clicked: true, x: 240, y: 160 },
  ];
  for (const menu of [false, true]) {
    const { g } = menu ? open(1, { progress: memoryStore(5) }) : open(1);
    if (menu && !g.getState().menu) g.update(1 / 60, input([], ['KeyM']));
    for (const pointer of pointers) {
      const controls = input([], [], {});
      controls.pointer = pointer;
      g.update(1 / 60, controls);
      g.update(1e9, controls);
      g.draw(mockContext());
      const s = g.getState();
      assert.ok(s.player >= 0 && s.player < s.w * s.h);
      assert.ok(!s.walls.includes(s.player));
      assert.ok(s.crates.every((c) => c >= 0 && c < s.w * s.h && !s.walls.includes(c)));
      assert.ok([s.score, s.moves, s.pushes, s.time].every(Number.isFinite));
      assert.equal(Boolean(s.menu), menu);
    }
  }
});
test('broken progress stores never stop a clear and unlock only forward', () => {
  const calls = [];
  const flaky = {
    unlocked: () => 3,
    unlock(n) {
      calls.push(n);
      throw new Error('quota exceeded');
    },
  };
  const { g, h } = open(3, { progress: flaky });
  clearRoom(g, 60);
  assert.deepEqual(calls, [4]);
  assert.equal(g.getState().level, 4);
  assert.equal(g.getState().unlocked, 4);
  assert.equal(h.ends.length, 0);
  const store = memoryStore(10);
  const h2 = harness();
  h2.env.progress = store;
  const replay = createGame(h2.env);
  for (let n = 0; n < 8; n++) replay.update(1 / 60, input([], ['ArrowLeft']));
  replay.update(1 / 60, input([], ['Enter']));
  assert.equal(replay.getState().level, 2);
  clearRoom(replay, 60);
  assert.equal(store.value, 10);
});

// ---------------------------------------------------------------------------------------------
// Text fits the 480 x 320 canvas in both languages and every screen is localized.
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
function assertScreen(drawn, lang, label) {
  assert.ok(drawn.length > 0, label);
  for (const { text, x, y, size, align } of drawn) {
    if (text.length === 1) continue;
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
    if (lang === 'en') assert.doesNotMatch(text, CJK, `${label}: "${text}"`);
    else assert.doesNotMatch(text, /[A-Za-z]{3,}/, `${label}: "${text}"`);
  }
}
test('every warehouse and the select fit the canvas in English and Chinese', () => {
  for (const lang of ['en', 'zh']) {
    for (const n of LEVEL_IDS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertScreen(drawn, lang, `${lang} room ${n}`);
      assert.ok(drawn.some((d) => d.text === TITLES[n - 1][lang === 'en' ? 0 : 1]));
      assert.ok(drawn.some((d) => d.text === LESSONS[n - 1][lang === 'en' ? 0 : 1]));
    }
    for (const unlocked of [1, 2, 9, LEVEL_COUNT]) {
      const { g } = open(1, { lang, progress: memoryStore(unlocked) }),
        { ctx, drawn } = textCanvas();
      if (!g.getState().menu) g.update(1 / 60, input([], ['KeyM']));
      g.draw(ctx);
      assertScreen(drawn, lang, `${lang} select ${unlocked}`);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A WAREHOUSE' : '选择仓库')));
      assert.equal(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')),
        unlocked < LEVEL_COUNT,
      );
    }
  }
});
test('hints, the stuck marker and the solved banner fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = open(1, { lang }),
      { ctx, drawn } = textCanvas();
    press(g, 'KeyH', 60);
    g.draw(ctx);
    for (const code of ['KeyZ', 'ArrowUp', 'ArrowRight', 'ArrowDown']) press(g, code, 60);
    assert.equal(g.getState().deadlocked, true);
    g.draw(ctx);
    press(g, 'KeyH', 60);
    g.draw(ctx);
    press(g, 'KeyX', 60);
    press(g, 'ArrowRight', 60);
    g.draw(ctx);
    assertScreen(drawn, lang, `${lang} states`);
    assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'COMPLETE' : '已完成')));
    assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'STUCK' : '卡死')));
  }
});

test('hold-to-repeat, tap-to-walk, undo and reset on one clock end identically at 30, 60 and 120 Hz', () => {
  const ends = HZS.map((hz) => {
    const { g } = open(13),
      s = g.getState(),
      [target] = [...reach(s)].sort((a, b) => b[1].length - a[1].length)[0],
      { size, ox, oy } = crateLayout(s.w, s.h),
      tapAt = {
        x: ox + ((target % s.w) + 0.5) * size,
        y: oy + (Math.floor(target / s.w) + 0.5) * size,
      };
    for (let f = 0; f < 6 * hz; f++) {
      const t = f / hz,
        first = f === 0 || f === Math.round(2 * hz);
      let held = [],
        pressed = [],
        pointer = {};
      if (t < 0.6) held = ['ArrowRight'];
      if (f === 0) pressed = ['ArrowRight'];
      if (f === Math.round(1 * hz)) pointer = { ...tapAt, clicked: true };
      if (first && f > 0) pressed = ['KeyZ'];
      if (f === Math.round(4 * hz)) pressed = ['KeyX'];
      if (f === Math.round(5 * hz)) pressed = ['KeyZ'];
      g.update(1 / hz, input(held, pressed, pointer));
    }
    const end = g.getState();
    return JSON.stringify([end.player, end.crates, end.moves, end.pushes, end.undoCount]);
  });
  assert.equal(new Set(ends).size, 1, ends.join(' | '));
});
