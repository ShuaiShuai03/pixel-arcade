import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  findMatches,
  applySwap,
  legalSwaps,
  LEVELS,
  LEVEL_COUNT,
} from '../src/games/gem-match.js';
import { GEM_NAMES } from '../src/games/gem-match-levels.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/gem-match-menu.js';
import { wrapText } from '../src/games/gem-match-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

// Players. Every policy sees only getState(): the board, soil and goal progress a person sees.
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const CJK = /[　-鿿＀-￯]/;
const BLIND_CAP = 0.25;
const cellPoint = (p) => ({ x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true });

function dropGems(board) {
  for (let x = 0; x < 7; x++) {
    const column = [];
    for (let y = 6; y >= 0; y--) if (board[y][x] >= 0) column.push(board[y][x]);
    for (let y = 6; y >= 0; y--) board[y][x] = column[6 - y] ?? -1;
  }
}
/** What the visible board promises for a swap: matches, soil beds, wanted gems and visible chains. */
function moveValue(s, move) {
  const board = applySwap(s.board, move.a, move.b).map((row) => row.slice()),
    soil = s.soil.map((row) => row.slice()),
    wanted = s.objective.goals
      .filter((g) => g.kind === 'collect' && g.progress < g.target)
      .map((g) => g.color),
    wantsSoil = s.objective.goals.some((g) => g.kind === 'soil' && g.progress < g.target);
  let value = 0;
  for (let round = 1; findMatches(board).length; round++) {
    for (const key of findMatches(board)) {
      const [y, x] = key.split(',').map(Number),
        gem = board[y][x];
      value +=
        round * (1 + (wanted.includes(gem) ? 6 : 0) + (wantsSoil && soil[y][x] === gem ? 8 : 0));
      if (soil[y][x] === gem) soil[y][x] = -1;
      board[y][x] = -1;
    }
    dropGems(board);
  }
  return value;
}
const bestMove = (s) =>
  legalSwaps(s.board)
    .map((move) => ({ move, value: moveValue(s, move) }))
    .sort((a, b) => b.value - a.value)[0].move;

function open(level, { seed = 1, lang = 'en', progress, launch = true } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = progress === undefined ? { unlocked: () => level, unlock() {} } : progress;
  const g = createGame(h.env);
  if (level > 1 && h.env.progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
/** Plays one garden with a policy: 'greedy', 'random' or 'first'. Waits `delay` seconds before each move. */
function playGarden(level, { policy = 'greedy', hz = 60, delay = 0, seed = 1, progress } = {}) {
  const { g, h } = open(level, { seed, progress }),
    pick = seeded(seed * 31 + level),
    poll = Math.ceil(hz / 10),
    plan = [];
  for (let guard = 0; guard < 60; guard++) {
    const s = g.getState();
    if (s.phase !== 'playing' || s.mode === 'garden-clear') break;
    const moves = legalSwaps(s.board),
      move =
        policy === 'greedy'
          ? bestMove(s)
          : policy === 'random'
            ? moves[Math.floor(pick() * moves.length)]
            : moves[0];
    plan.push(move);
    for (let i = 0; i < Math.round(delay * hz); i++) g.update(1 / hz, input());
    for (const p of [move.a, move.b]) g.update(1 / hz, input([], [], cellPoint(p)));
    for (let i = 0; i < hz * 12 && g.getState().resolving; i += poll)
      for (let k = 0; k < poll; k++) g.update(1 / hz, input());
  }
  const s = g.getState();
  return { g, h, s, plan, cleared: s.mode === 'garden-clear' || s.phase === 'won' };
}
/** Keys-only policies that never look at the board. */
function blindKeys(level, kind, seed) {
  const { g } = open(level, { seed }),
    random = seeded(seed + 7),
    keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Space',
      'Enter',
      'KeyH',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
    ],
    period = { slow: 30, mid: 10, fast: 3 }[kind];
  for (let frame = 0; frame < 30 * 90; frame++) {
    let held = [],
      pressed = [];
    if (kind === 'mash') pressed = [keys[frame % keys.length]];
    else if (kind === 'random') pressed = [keys[Math.floor(random() * keys.length)]];
    else {
      held = ['ArrowRight'];
      pressed =
        frame % period === 0 ? [Math.floor(frame / period) % 2 ? 'ArrowDown' : 'Space'] : [];
    }
    g.update(1 / 30, input(held, pressed));
  }
  return g.getState();
}
const won = (s) => s.mode === 'garden-clear' || s.phase === 'won';

// ---------------------------------------------------------------------------------------------
test('the garden table has twenty distinct, frozen, consistent gardens with accurate tips', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.ok(Object.isFrozen(LEVELS) && Object.isFrozen(GEM_NAMES));
  const seen = new Set();
  LEVELS.forEach((level, i) => {
    assert.ok(
      Object.isFrozen(level) && Object.isFrozen(level.goals) && Object.isFrozen(level.beds),
    );
    assert.equal(level.beds.length, 7);
    const digits = level.beds.join('').replace(/\./g, '');
    assert.ok(
      level.beds.every((row) => /^[.0-5]{7}$/.test(row)),
      `garden ${i + 1} bed grid`,
    );
    assert.ok(
      [...digits].every((d) => Number(d) < level.kinds),
      `garden ${i + 1} beds need unused kinds`,
    );
    for (const goal of level.goals) {
      assert.ok(goal.target > 0);
      if (goal.kind === 'collect') assert.ok(goal.color < level.kinds);
      if (goal.kind === 'soil') assert.ok(goal.target <= digits.length);
    }
    assert.equal(
      level.goals.some((g) => g.kind === 'soil'),
      digits.length > 0,
    );
    for (const lang of ['en', 'zh']) {
      const numbers = level.goals.map((g) => String(g.target)).concat(String(level.moves));
      for (const n of numbers)
        assert.ok(level.tip[lang].includes(n), `garden ${i + 1} ${lang} tip lacks ${n}`);
      assert.equal(CJK.test(level.name[lang]), lang === 'zh');
      assert.equal(CJK.test(level.tip[lang]), lang === 'zh');
    }
    seen.add(JSON.stringify([level.moves, level.kinds, level.beds, level.goals]));
  });
  assert.equal(seen.size, 20);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, 20);
});

test('every garden is cleared by a reaction-limited bot at 30, 60 and 120 Hz', () => {
  const profiles = [
    { hz: 30, delay: 0.35 },
    { hz: 60, delay: 0.25 },
    { hz: 120, delay: 0.35 },
  ];
  for (const level of LEVEL_NUMBERS)
    for (const { hz, delay } of profiles)
      for (const seed of [1, 2]) {
        const run = playGarden(level, { hz, delay, seed });
        assert.ok(
          run.cleared,
          `garden ${level} at ${hz} Hz seed ${seed}: ${run.s.moves} moves left`,
        );
        assert.ok(run.s.moves >= 0);
      }
});

test('idle, mashing, random keys and held-plus-alternating patterns win at most 25% of any garden', () => {
  for (const level of BLIND_LEVELS) {
    const idle = open(level).g;
    for (let i = 0; i < 30 * 90; i++) idle.update(1 / 30, input());
    assert.equal(idle.getState().phase, 'playing');
    assert.equal(idle.getState().moves, LEVELS[level - 1].moves);
    for (const kind of ['mash', 'random', 'slow', 'mid', 'fast']) {
      const wins = [1, 2].filter((seed) => won(blindKeys(level, kind, seed))).length;
      assert.ok(wins / 2 <= BLIND_CAP, `garden ${level} ${kind}: ${wins}/2`);
    }
  }
});

test('random legal swaps and the first legal swap win at most 25% of any garden from garden 3', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const policy of ['random', 'first'])
    for (const level of BLIND_LEVELS) {
      const wins = seeds.filter((seed) => playGarden(level, { policy, seed }).cleared).length;
      assert.ok(
        wins / seeds.length <= BLIND_CAP,
        `garden ${level} ${policy}: ${wins}/${seeds.length}`,
      );
    }
});

test('the bot plays the same moves and scores the same at 30, 60 and 120 Hz', () => {
  for (const level of [3, 12, 20]) {
    const runs = [30, 60, 120].map((hz) => playGarden(level, { hz, delay: 0.25 }));
    for (const run of runs.slice(1)) {
      assert.deepEqual(run.plan, runs[0].plan);
      assert.equal(run.s.score, runs[0].s.score);
      assert.deepEqual(run.s.board, runs[0].s.board);
      assert.equal(run.s.moves, runs[0].s.moves);
    }
  }
  const again = playGarden(5, { seed: 3 }).s,
    twin = playGarden(5, { seed: 3 }).s;
  assert.deepEqual(again.board, twin.board);
  assert.notDeepEqual(playGarden(5, { seed: 4 }).s.board, again.board);
});

test('losing a garden ends once, in both languages, and the state stays frozen', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 3, unlock() {} };
    const g = createGame(h.env);
    g.update(1 / 60, input([], ['Space']));
    for (let turn = 0; turn < 40 && g.getState().phase === 'playing'; turn++) {
      const move = legalSwaps(g.getState().board)[0];
      for (const p of [move.a, move.b]) g.update(1 / 60, input([], [], cellPoint(p)));
      for (let i = 0; i < 1200 && g.getState().resolving; i++) g.update(1 / 60, input());
    }
    const s = g.getState();
    assert.equal(s.phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'en' ? /Out of moves/ : /步数用完/);
    for (let i = 0; i < 90; i++)
      g.update(
        1 / 60,
        input(['ArrowRight'], ['Space', 'KeyH', 'Enter'], cellPoint({ x: 1, y: 1 })),
      );
    assert.deepEqual(g.getState(), s);
    assert.equal(h.ends.length, 1);
  }
});

test('clearing the final garden wins once, in both languages, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = open(LEVEL_COUNT, { lang }),
      cleared = (() => {
        for (let turn = 0; turn < 60 && g.getState().phase === 'playing'; turn++) {
          const move = bestMove(g.getState());
          for (const p of [move.a, move.b]) g.update(1 / 60, input([], [], cellPoint(p)));
          for (let i = 0; i < 1200 && g.getState().resolving; i++) g.update(1 / 60, input());
        }
        return g.getState();
      })();
    assert.equal(cleared.phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(h.ends[0].message, lang === 'en' ? /twenty gardens/ : /二十座花园/);
    assert.equal(g.getState().unlocked, LEVEL_COUNT + 1);
    g.update(1 / 60, input([], ['Space']));
    assert.deepEqual(g.getState(), cleared);
    assert.equal(h.ends.length, 1);
  }
});

test('no garden can be left without a legal swap: dead boards remix for free', () => {
  for (const level of LEVEL_NUMBERS) {
    const { g } = open(level);
    for (let turn = 0; turn < 3; turn++) {
      const s = g.getState();
      assert.ok(legalSwaps(s.board).length, `garden ${level} turn ${turn}`);
      assert.equal(findMatches(s.board).length, 0);
      const move = bestMove(s);
      for (const p of [move.a, move.b]) g.update(1 / 60, input([], [], cellPoint(p)));
      for (let i = 0; i < 1200 && g.getState().resolving; i++) g.update(1 / 60, input());
      if (g.getState().mode === 'garden-clear') break;
    }
  }
});

// ---------------------------------------------------------------------------------------------
function memoryStore(value = 1) {
  const store = {
    value,
    calls: [],
    unlocked: () => store.value,
    unlock: (n) => {
      store.calls.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}

test('the garden select offers saved progress, denies locked gardens and starts the chosen one', () => {
  const store = memoryStore(7),
    { g, h } = open(7, { progress: store, launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 7, unlocked: 7, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  g.draw(mockContext());
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['KeyW']));
  assert.equal(g.getState().menu.cursor, 1);
  const locked = menuCell(12);
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.equal(g.getState().menu.cursor, 1);
  assert.ok(h.sounds.includes('hit'));
  const open3 = menuCell(3);
  g.update(1 / 60, input([], [], { x: open3.x + 5, y: open3.y + 5, clicked: true }));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 3);
  assert.equal(s.moves, LEVELS[2].moves);
  assert.deepEqual(menuTarget(input(), 4, 7), {
    cursor: 4,
    moved: false,
    denied: false,
    start: false,
  });
  assert.equal(menuTarget(input([], [], { x: NaN, y: 'x', clicked: true }), 4, 7).start, false);
});

test('clearing a garden unlocks the next one and never lowers the saved value', () => {
  const store = memoryStore(1),
    run = playGarden(1, { progress: store });
  assert.ok(run.cleared);
  assert.deepEqual(store.calls, [2]);
  assert.equal(run.g.getState().unlocked, 2);
  const high = memoryStore(9);
  playGarden(3, { progress: high });
  assert.ok(high.calls.every((n) => n > 9) && high.value >= 9);
  assert.equal(
    createGame(Object.assign(harness().env, { progress: store })).getState().menu.cursor,
    2,
  );
});

test('a broken, throwing or junk progress store never stops play', () => {
  const stores = [
    null,
    {},
    { unlocked: () => 1 },
    {
      unlocked: () => {
        throw new Error('storage blocked');
      },
      unlock: () => {
        throw new Error('storage blocked');
      },
    },
  ];
  for (const progress of stores) {
    const run = playGarden(1, { progress });
    assert.ok(run.cleared);
  }
  for (const [value, expected] of [
    [NaN, 1],
    [-5, 1],
    [0, 1],
    [999, LEVEL_COUNT + 1],
    ['7', 7],
    [4.9, 4],
    [null, 1],
    [undefined, 1],
    [Infinity, 1],
    [{}, 1],
  ]) {
    const { g } = open(1, { progress: { unlocked: () => value, unlock() {} }, launch: false });
    assert.equal(g.getState().unlocked, expected, String(value));
    assert.equal(g.getState().menu !== null, expected > 1);
  }
});

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
  [...text].reduce(
    (sum, ch) => sum + (CJK.test(ch) || /[：，。！·×]/.test(ch) ? size : size * 0.62),
    0,
  );
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(
      left >= 0 && left + w <= 480,
      `${label}: "${text}" spans ${left.toFixed(0)}..${(left + w).toFixed(0)}`,
    );
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.doesNotMatch(text, /undefined|NaN|\[object/, label);
  }
}

test('every screen fits the 480 by 320 canvas in English and Chinese and nothing hides the board', () => {
  for (const lang of ['en', 'zh']) {
    for (const level of LEVEL_NUMBERS) {
      const { g } = open(level, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} garden ${level}`);
      const tip = LEVELS[level - 1].tip[lang];
      assert.ok(wrapText(tip, 460, 10).length <= 2, `tip ${level} wraps to two lines`);
      assert.ok(
        drawn.some((d) => tip.startsWith(d.text)),
        `garden ${level} shows its tip at the start`,
      );
      for (const { text } of drawn) {
        if (lang === 'en') assert.doesNotMatch(text, CJK, `English shows "${text}"`);
        else assert.doesNotMatch(text, /[A-Za-z]{5,}/, `Chinese shows "${text}"`);
      }
    }
    for (const unlocked of [2, 9, LEVEL_COUNT]) {
      const { g } = open(unlocked, { lang, launch: false }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A GARDEN' : '选择花园')));
    }
  }
  const { g } = open(1),
    s = g.getState();
  g.update(1 / 60, input([], [], cellPoint(legalSwaps(s.board)[0].a)));
  const { ctx, drawn } = textCanvas();
  g.draw(ctx);
  assertFits(drawn, 'after the first selection');
  assert.deepEqual(wrapText('one two', 1000, 10), ['one two']);
  assert.equal(wrapText('a'.repeat(5) + ' ' + 'b'.repeat(5), 40, 10).length, 2);
});

test('touch buttons and the pointer cover every action', () => {
  const { g } = open(1),
    s = g.getState(),
    move = legalSwaps(s.board)[0];
  g.update(1 / 60, input([], ['KeyH']));
  assert.ok(g.getState().hint);
  for (const p of [move.a, move.b]) g.update(1 / 60, input([], [], cellPoint(p)));
  for (let i = 0; i < 600 && g.getState().resolving; i++) g.update(1 / 60, input());
  assert.equal(g.getState().moves, s.moves - 1);
});

test('finishing the last garden saves progress past it, and the select then shows every garden cleared', () => {
  const store = memoryStore(LEVEL_COUNT),
    { g } = open(LEVEL_COUNT, { progress: store });
  for (let turn = 0; turn < 60 && g.getState().phase === 'playing'; turn++) {
    const move = bestMove(g.getState());
    for (const p of [move.a, move.b]) g.update(1 / 60, input([], [], cellPoint(p)));
    for (let i = 0; i < 1200 && g.getState().resolving; i++) g.update(1 / 60, input());
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(store.value, LEVEL_COUNT + 1);
  const { ctx, drawn } = textCanvas(),
    again = createGame(Object.assign(harness().env, { progress: store }));
  assert.equal(again.getState().menu.cursor, LEVEL_COUNT);
  again.draw(ctx);
  assert.equal(drawn.filter((d) => d.text === 'CLEARED').length, LEVEL_COUNT);
  again.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(again.getState().menu.cursor, LEVEL_COUNT);
});
