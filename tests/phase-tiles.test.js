import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARDS,
  BOARD_COUNT,
  RULES,
  SHAPE_KEYS,
  meta,
  createGame,
  parseBoard,
  reach,
  solveFrom,
  isMatched,
  mismatches,
  pressable,
  pressed,
  advise,
  adviceLine,
  layoutOf,
  cellAt,
  menuCellAt,
} from '../src/games/phase-tiles.js';
import { BOARD_DEFS } from '../src/games/phase-tiles-boards.js';
import { SHAPE_NAMES } from '../src/games/phase-tiles-rules.js';
import { harness, input, mockContext, seeded } from './harness.js';

// The fewest presses each board needs, as recorded from the solver. A board edit must update it.
const OPTIMAL = [
  1, 2, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 12, 12, 13, 14,
];
const KEY_OF = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };
const CJK = /[一-鿿]/;

// --- helpers ---------------------------------------------------------------------------------
function small(layout, target, scramble, extra = {}) {
  return parseBoard({
    name: ['t', '测'],
    tip: ['t', '测'],
    phases: 2,
    shape: 'p',
    layout,
    target,
    scramble,
    ...extra,
  });
}
function open(level = 1, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  const calls = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  h.calls = calls;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const press = (g, ...codes) => g.update(1 / 60, input([], codes));
const idle = (g, seconds, hz = 60) => {
  for (let n = 0; n < Math.round(seconds * hz); n++) g.update(1 / hz, input());
};
function walkTo(g, x, y) {
  for (let n = 0; n < 40; n++) {
    const c = g.getState().cursor;
    if (c.x < x) press(g, 'ArrowRight');
    else if (c.x > x) press(g, 'ArrowLeft');
    else if (c.y < y) press(g, 'ArrowDown');
    else if (c.y > y) press(g, 'ArrowUp');
    else return;
  }
  assert.fail('cursor did not arrive');
}
// The presses of a shortest solution, read straight from the solver (not from the prompt).
function plan(board) {
  const sol = solveFrom(board, board.start);
  const turns = [];
  sol.vector.forEach((n, i) => {
    for (let k = 0; k < n; k++) turns.push({ x: i % board.w, y: Math.floor(i / board.w) });
  });
  return turns;
}
function playPlan(g, board) {
  for (const turn of plan(board)) {
    walkTo(g, turn.x, turn.y);
    press(g, 'Space');
  }
}
const decode = (rows) =>
  rows.map((row) => [...row].map((ch) => (ch === '#' ? 0 : Number(ch)))).flat();
const logical = (st) => {
  const { undos, message, status, ...rest } = st;
  return rest;
};
const ENDS = (h) => h.ends.length;
const firstOf = (board, test) => board.cells.findIndex(test);

// A recording canvas: every text it is asked to draw, with the font size and alignment.
function recorder() {
  const texts = [];
  const rects = [];
  const ctx = new Proxy(
    { fillStyle: '', font: '', textAlign: 'left', globalAlpha: 1 },
    {
      get: (t, p) => {
        if (p === 'fillText')
          return (text, x, y) =>
            texts.push({ text, x, y, size: Number(/(\d+)px/.exec(t.font)[1]), align: t.textAlign });
        if (p === 'fillRect') return (x, y, w, h) => rects.push({ x, y, w, h, color: t.fillStyle });
        return p in t ? t[p] : () => {};
      },
      set: (t, p, v) => ((t[p] = v), true),
    },
  );
  return { ctx, texts, rects };
}
const textBounds = ({ text, x, size, align }) => {
  const width = [...text].reduce((n, ch) => n + (CJK.test(ch) ? size : size * 0.62), 0);
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  return [left, left + width];
};

// --- metadata and data -----------------------------------------------------------------------
test('meta describes the game in both languages with working touch controls', () => {
  assert.equal(meta.id, 'phase-tiles');
  assert.equal(meta.genre, 'puzzle');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  for (const field of [meta.name, meta.description])
    assert.ok(field.en.length > 5 && CJK.test(field.zh));
  assert.equal(meta.name.zh, '相位方格');
  assert.ok(meta.description.en.includes(String(BOARD_COUNT)));
  assert.ok(meta.description.zh.includes(String(BOARD_COUNT)));
  const codes = meta.touchControls.map((c) => c.code);
  assert.deepEqual(codes.slice().sort(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'KeyH',
    'KeyQ',
    'KeyZ',
    'Space',
  ]);
  assert.ok(meta.keys.some((k) => k.keys === 'H'));
  assert.ok(!/glowing hint names/.test(meta.description.en), 'the hint is no longer free');
  for (const lang of ['en', 'zh'])
    assert.ok(meta.description[lang].includes(`${RULES.hintPenalty}`), `${lang} names the cost`);
  for (const c of meta.touchControls) assert.ok(c.label.en && CJK.test(c.label.zh));
  for (const k of meta.keys) assert.ok(k.label.en && CJK.test(k.label.zh));
  assert.ok(!codes.includes('KeyP') && !codes.includes('KeyR') && !codes.includes('Escape'));
});

test('there are at least 24 bilingual boards within the size limits, each with the recorded optimum and a budget above it', () => {
  assert.ok(BOARD_COUNT >= 24);
  assert.equal(BOARDS.length, OPTIMAL.length);
  const names = new Set();
  BOARDS.forEach((board, i) => {
    assert.ok(board.w <= RULES.maxCols && board.h <= RULES.maxRows, `board ${i + 1} size`);
    assert.ok(board.name.en && CJK.test(board.name.zh), `board ${i + 1} name`);
    assert.ok(board.tip.en && CJK.test(board.tip.zh), `board ${i + 1} tip`);
    // A tip is drawn at 10 px on one line: it must fit the 480 px canvas.
    assert.ok(
      [...board.tip.en].length <= 55 && [...board.tip.zh].length <= 31,
      `board ${i + 1} tip length`,
    );
    names.add(board.name.en);
    const sol = solveFrom(board, board.start);
    assert.equal(board.optimal, OPTIMAL[i], `board ${i + 1} optimum`);
    assert.equal(sol.cost, OPTIMAL[i]);
    assert.ok(!isMatched(board, board.start), `board ${i + 1} starts solved`);
    if (board.budget === null) assert.equal(board.slack, null);
    else assert.equal(board.budget, board.optimal + board.slack);
    assert.ok(board.budget === null || (board.slack >= 0 && board.slack <= 3));
  });
  assert.equal(names.size, BOARD_COUNT);
});

test('every board is generated from legal moves: the start is the target with its recorded presses taken back out', () => {
  for (const board of BOARDS) {
    // Replay forward: pressing the scramble tiles (count times) from the start must reach the target.
    let cells = [...board.start];
    for (const [x, y, n] of board.scramble) {
      const i = y * board.w + x;
      assert.ok(pressable(board, i), 'a scramble press is a legal press');
      for (let k = 0; k < n; k++) cells = pressed(board, cells, i);
    }
    assert.deepEqual(cells, [...board.target]);
    assert.ok(board.scramble.length >= 1);
  }
});

test('every board is solvable, its recorded optimum is the true minimum, and a shortest plan really solves it', () => {
  for (const board of BOARDS) {
    const sol = solveFrom(board, board.start);
    let cells = [...board.start];
    sol.vector.forEach((n, i) => {
      for (let k = 0; k < n; k++) cells = pressed(board, cells, i);
    });
    assert.deepEqual(cells, [...board.target], `${board.name.en}: the plan solves the board`);
    assert.equal(
      sol.vector.reduce((a, b) => a + b, 0),
      board.optimal,
    );
    assert.ok(sol.vector.every((n) => n >= 0 && n < board.phases));
    // The scramble is itself a solution, so the optimum cannot exceed its size.
    assert.ok(board.optimal <= board.scramble.reduce((n, [, , c]) => n + c, 0));
  }
});

test('the optimum is the true minimum: exhaustive search over every press vector agrees wherever it is feasible', () => {
  let checked = 0;
  for (const board of BOARDS) {
    const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
    if (board.phases ** spots.length > 1.1e6) continue;
    checked++;
    let best = Infinity;
    const counts = Array(spots.length).fill(0);
    for (let code = 0; code < board.phases ** spots.length; code++) {
      let rest = code;
      let cost = 0;
      let cells = [...board.start];
      for (let k = 0; k < spots.length; k++) {
        counts[k] = rest % board.phases;
        rest = (rest - counts[k]) / board.phases;
        cost += counts[k];
      }
      if (cost >= best) continue;
      for (let k = 0; k < spots.length; k++)
        for (let n = 0; n < counts[k]; n++) cells = pressed(board, cells, spots[k]);
      if (isMatched(board, cells)) best = cost;
    }
    assert.equal(best, board.optimal, board.name.en);
  }
  assert.ok(checked >= 6, `only ${checked} boards were small enough`);
});

test('the boards teach the features in order, one at a time, each with its own tip', () => {
  const has = (fn) => BOARDS.findIndex(fn);
  const firsts = [
    has((b) => b.budget !== null),
    has((b) => b.cells.some((c) => c.hole)),
    has((b) => b.cells.some((c) => c.locked)),
    has((b) => b.cells.some((c) => c.shape === 'x')),
    has((b) => b.cells.some((c) => c.shape === 'o')),
    has((b) => b.cells.some((c) => c.shape === 'h' || c.shape === 'v' || c.shape === 'c')),
    has((b) => b.cells.some((c) => c.shape === 'k')),
    has((b) => b.mixed),
    has((b) => b.phases === 3),
  ];
  assert.equal(firsts[0], 3, 'the budget is taught on board 4');
  assert.ok(firsts.slice(1).every((n) => n >= 4));
  assert.deepEqual(
    firsts,
    [...firsts].sort((a, b) => a - b),
  );
  assert.equal(new Set(firsts).size, firsts.length, 'one new idea per board');
  assert.ok(BOARDS.some((b) => b.mixed && b.cells.some((c) => c.shape === 'h')));
  assert.ok(BOARDS.some((b) => b.mixed && b.cells.some((c) => c.shape === 'v')));
  assert.ok(BOARDS.filter((b) => b.phases === 3).length >= 5);
  const tips = new Set(BOARDS.map((b) => b.tip.en));
  assert.equal(tips.size, BOARD_COUNT, 'every board has its own tip');
  // The tip of each introducing board names its feature.
  assert.match(BOARDS[firsts[0]].tip.en, /limited/i);
  assert.match(BOARDS[firsts[1]].tip.en, /hole/i);
  assert.match(BOARDS[firsts[2]].tip.en, /lock/i);
  assert.match(BOARDS[firsts[3]].tip.en, /diagonal/i);
  assert.match(BOARDS[firsts[4]].tip.en, /ring/i);
  assert.match(BOARDS[firsts[5]].tip.en, /row/i);
  assert.match(BOARDS[firsts[6]].tip.en, /knight/i);
  assert.match(BOARDS[firsts[7]].tip.en, /icon/i);
  assert.match(BOARDS[firsts[8]].tip.en, /three phases/i);
});

test('the boards are deeply frozen records', () => {
  assert.equal(Object.isFrozen(BOARDS), true);
  for (const board of BOARDS) {
    for (const part of [
      board,
      board.cells,
      board.cells[0],
      board.target,
      board.start,
      board.influence,
      board.name,
    ])
      assert.equal(Object.isFrozen(part), true);
  }
  assert.throws(() => {
    'use strict';
    BOARDS[0].start[0] = 1;
  }, TypeError);
  assert.equal(Object.isFrozen(RULES), true);
});

// --- influence shapes ------------------------------------------------------------------------
const sorted = (pairs) => pairs.map(([x, y]) => `${x},${y}`).sort();
test('every influence shape reaches exactly the cells it names, clipped to the grid', () => {
  assert.deepEqual(SHAPE_KEYS, ['p', 'x', 'o', 'h', 'v', 'c', 'k']);
  assert.deepEqual(
    sorted(reach('p', 2, 2, 5, 5)),
    sorted([
      [2, 2],
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ]),
  );
  assert.deepEqual(
    sorted(reach('p', 0, 0, 5, 5)),
    sorted([
      [0, 0],
      [1, 0],
      [0, 1],
    ]),
  );
  assert.deepEqual(
    sorted(reach('x', 2, 2, 5, 5)),
    sorted([
      [2, 2],
      [1, 1],
      [3, 3],
      [1, 3],
      [3, 1],
    ]),
  );
  assert.deepEqual(
    sorted(reach('x', 4, 0, 5, 5)),
    sorted([
      [4, 0],
      [3, 1],
    ]),
  );
  const ring = reach('o', 2, 2, 5, 5);
  assert.equal(ring.length, 8);
  assert.ok(!ring.some(([x, y]) => x === 2 && y === 2), 'the ring leaves the pressed tile alone');
  assert.equal(reach('o', 0, 0, 5, 5).length, 3);
  assert.deepEqual(
    sorted(reach('h', 1, 2, 4, 3)),
    sorted([
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ]),
  );
  assert.deepEqual(
    sorted(reach('v', 1, 2, 4, 3)),
    sorted([
      [1, 0],
      [1, 1],
      [1, 2],
    ]),
  );
  const cross = reach('c', 1, 1, 4, 3);
  assert.equal(cross.length, 4 + 3 - 1);
  assert.equal(new Set(sorted(cross)).size, cross.length, 'the crossing tile is listed once');
  assert.equal(reach('k', 2, 2, 5, 5).length, 9);
  assert.ok(reach('k', 2, 2, 5, 5).some(([x, y]) => x === 3 && y === 4));
  assert.equal(reach('k', 0, 0, 5, 5).length, 3);
  assert.deepEqual(reach('?', 1, 1, 3, 3), []);
});

test('holes are never in an influence set, so presses skip them, and locked tiles are reached but cannot be pressed', () => {
  for (const board of BOARDS)
    board.cells.forEach((c, i) => {
      if (c.hole) assert.deepEqual([...board.influence[i]], []);
      for (const j of board.influence[i]) assert.equal(board.cells[j].hole, false);
      assert.deepEqual(
        [...board.influence[i]],
        [...board.influence[i]].sort((a, b) => a - b),
      );
    });
  const holey = BOARDS.find((b) => b.cells.some((c) => c.hole));
  assert.ok(holey);
  // A locked tile still appears in neighbours' influence sets.
  const locked = BOARDS.find((b) => b.cells.some((c) => c.locked));
  const li = firstOf(locked, (c) => c.locked);
  assert.ok(locked.influence.some((set, i) => i !== li && set.includes(li)));
  assert.equal(pressable(locked, li), false);
});

test('parseBoard rejects malformed boards', () => {
  const ok = { layout: ['...'], target: ['111'], scramble: [[0, 0, 1]] };
  assert.doesNotThrow(() => small(ok.layout, ok.target, ok.scramble));
  assert.throws(() => small(['..?'], ['111'], [[0, 0, 1]]), /Unknown layout symbol/);
  assert.throws(() => small(['...', '..'], ['111', '11'], [[0, 0, 1]]), /ragged/);
  assert.throws(() => small(['...'], ['11'], [[0, 0, 1]]), /ragged/);
  assert.throws(() => small(['...'], ['1#1'], [[0, 0, 1]]), /target and holes differ/);
  assert.throws(() => small(['.#.'], ['111'], [[0, 0, 1]]), /target and holes differ/);
  assert.throws(() => small(['...'], ['121'], [[0, 0, 1]]), /bad target phase/);
  assert.throws(() => small(['...'], ['111'], [[0, 0, 1]], { shape: 'z' }), /Unknown shape/);
  assert.throws(() => small(['...'], ['111'], [[0, 0, 1]], { shape: ['pzp'] }), /Unknown shape/);
  assert.throws(() => small(['...'], ['111'], [[0, 0, 1]], { phases: 4 }), /2 or 3 phases/);
  assert.throws(() => small(['...'], ['111'], [[0, 0, 2]]), /scramble count/);
  assert.throws(() => small(['...'], ['111'], [[0, 0, 0]]), /scramble count/);
  assert.throws(() => small(['...'], ['111'], [[5, 0, 1]]), /scrambles/);
  assert.throws(() => small(['.L.'], ['111'], [[1, 0, 1]]), /scrambles/);
  assert.throws(() => small(['.#.'], ['1#1'], [[1, 0, 1]]), /scrambles/);
  assert.throws(() => small(['...'], ['111'], []), /starts solved/);
  assert.throws(
    () =>
      small(
        ['...'],
        ['111'],
        [
          [0, 0, 1],
          [0, 0, 1],
        ],
        { phases: 2 },
      ),
    /starts solved/,
  );
  assert.throws(() => small(['.'.repeat(8)], ['1'.repeat(8)], [[0, 0, 1]]), /too large/);
  assert.throws(() => small(Array(7).fill('.'), Array(7).fill('1'), [[0, 0, 1]]), /too large/);
  assert.throws(() => small(['...'], ['11#'], [[0, 0, 1]]), /target and holes differ/);
  // A scramble of an unsolvable shape: the locked tile makes the start unreachable.
  const mixed = small(['...', '...'], ['11', '1'].length ? ['111', '111'] : [], [[0, 0, 1]], {
    shape: ['pxp', 'ppo'],
  });
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.cells[1].shape, 'x');
});

// --- solver ----------------------------------------------------------------------------------
// An independent breadth-first search over press sequences: the shortest way from any state.
function shortest(board, from) {
  const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
  const seen = new Map([[from.join(''), 0]]);
  let frontier = [from];
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const cells of frontier) {
      if (isMatched(board, cells)) return d;
      for (const i of spots) {
        const n = pressed(board, cells, i);
        const key = n.join('');
        if (!seen.has(key)) {
          seen.set(key, d + 1);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return null;
}

test('the solver agrees with a breadth-first search on random small boards of every shape and both phase counts', () => {
  const r = seeded(99);
  let solvable = 0;
  let unsolvable = 0;
  for (let n = 0; n < 160; n++) {
    const w = 2 + Math.floor(r() * 2);
    const h = 2 + Math.floor(r() * 2);
    const phases = r() < 0.5 ? 2 : 3;
    const layout = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => '.....L#'[Math.floor(r() * 7)]).join(''),
    );
    const shapes = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => SHAPE_KEYS[Math.floor(r() * 7)]).join(''),
    );
    const target = layout.map((row) =>
      [...row].map((c) => (c === '#' ? '#' : String(Math.floor(r() * phases)))).join(''),
    );
    const free = [];
    layout.forEach((row, y) => [...row].forEach((c, x) => c === '.' && free.push([x, y])));
    if (!free.length) continue;
    let board;
    try {
      board = small(layout, target, [[...free[Math.floor(r() * free.length)], 1]], {
        phases,
        shape: shapes,
      });
    } catch {
      continue; // a scramble that changed nothing starts solved
    }
    solvable++;
    assert.equal(
      board.optimal,
      shortest(board, board.start),
      `${layout} ${shapes} ${target} p${phases}`,
    );
    // Every other state: the solver and the search agree, including on unreachable states.
    for (let k = 0; k < 6; k++) {
      const cells = board.cells.map((c) => (c.hole ? 0 : Math.floor(r() * phases)));
      const sol = solveFrom(board, cells);
      const bfs = shortest(board, cells);
      if (bfs === null) {
        assert.equal(sol, null, 'an unreachable target has no solution');
        unsolvable++;
      } else {
        assert.equal(sol.cost, bfs);
        for (const i of sol.support)
          assert.equal(solveFrom(board, pressed(board, cells, i)).cost, sol.cost - 1);
      }
    }
  }
  assert.ok(solvable > 100 && unsolvable > 20, `${solvable} solvable, ${unsolvable} unreachable`);
});

test('the solver lists exactly the tiles that lie on some shortest way home', () => {
  const board = BOARDS.find((b) => solveFrom(b, b.start).answers > 1); // several answers
  const sol = solveFrom(board, board.start);
  assert.ok(sol.answers > 1);
  const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
  for (const i of spots) {
    const cost = solveFrom(board, pressed(board, board.start, i)).cost;
    assert.equal(sol.support.includes(i), cost === sol.cost - 1, `tile ${i}`);
    assert.ok(cost >= sol.cost - 1, 'one press cannot save more than one');
  }
  // A matched board costs nothing; a state that no press can reach has no answer.
  assert.equal(solveFrom(board, [...board.target]).cost, 0);
  const walled = small(['L.'], ['11'], [[1, 0, 1]], { shape: 'k' });
  assert.equal(solveFrom(walled, [0, 0]), null);
  assert.equal(solveFrom(walled, [1, 1]).cost, 0);
});

test('the solver memoises per board and survives a flood of distinct states', () => {
  const board = BOARDS[3];
  const r = seeded(5);
  for (let n = 0; n < 3000; n++)
    solveFrom(
      board,
      board.cells.map(() => Math.floor(r() * 2)),
    );
  assert.equal(solveFrom(board, board.start), solveFrom(board, board.start));
  // Overflow the memo: a 4x4 plus board has 65536 states, more than the cache holds.
  for (let code = 0; code < 21000; code++)
    solveFrom(
      board,
      Array.from({ length: 16 }, (_, b) => (code >> b) & 1),
    );
  assert.equal(solveFrom(board, board.start).cost, board.optimal);
});

test('a board whose answer space is too large is refused', () => {
  const layout = Array(6).fill('.'.repeat(7));
  assert.throws(
    () =>
      small(
        layout,
        layout.map((r) => r.replaceAll('.', '1')),
        [[0, 0, 1]],
        { shape: 'h' },
      ),
    /too many answers/,
  );
});

test('advise names the nearest useful tile, asks for an undo when the presses are too few, and finishes when matched', () => {
  const board = BOARDS[8];
  const sol = solveFrom(board, board.start);
  const adv = advise(board, board.start, { x: 0, y: 0 }, Infinity, false);
  assert.ok(adv.kind === 'move' || adv.kind === 'act');
  assert.ok(sol.support.includes(adv.i));
  const near = Math.min(...sol.support.map((i) => (i % board.w) + Math.floor(i / board.w)));
  assert.equal(adv.x + adv.y, near);
  assert.equal(advise(board, board.start, { x: 0, y: 0 }, 1, true).kind, 'undo');
  assert.equal(advise(board, board.start, { x: 0, y: 0 }, 1, false).kind !== 'undo', true);
  assert.equal(advise(board, [...board.target], { x: 0, y: 0 }, 0, true).kind, 'done');
  const on = sol.support[0];
  const here = advise(
    board,
    board.start,
    { x: on % board.w, y: Math.floor(on / board.w) },
    Infinity,
    false,
  );
  assert.equal(here.kind, 'act');
  assert.deepEqual([here.x, here.y], [on % board.w, Math.floor(on / board.w)]);
  assert.deepEqual(adviceLine({ kind: 'undo' }), ['Z: undo the extra press', 'Z：撤销多余的一步']);
  assert.deepEqual(adviceLine({ kind: 'done' }), ['Matched! Hold still', '已对齐！请稍等']);
  assert.deepEqual(adviceLine({ kind: 'act' }), ['Space: press this tile', '空格：按下这个方格']);
  assert.deepEqual(adviceLine({ kind: 'act' }, true), [
    'Space: press this tile again',
    '空格：再按一次这个方格',
  ]);
  assert.deepEqual(adviceLine({ kind: 'move', dir: 3, steps: 2, x: 4, y: 1 }), [
    'Move ↑ 2 to row 2, col 5',
    '光标向上移 2 格，到第 2 行第 5 列',
  ]);
});

test('the prompt number is the length of the first leg along its arrow, from every cell of every board', () => {
  let checked = 0;
  for (const board of BOARDS)
    for (let y = 0; y < board.h; y++)
      for (let x = 0; x < board.w; x++) {
        const adv = advise(board, board.start, { x, y }, Infinity, false);
        if (adv.kind !== 'move') continue;
        const dx = adv.x - x;
        const dy = adv.y - y;
        const horizontal = adv.dir % 2 === 0;
        assert.equal(adv.steps, horizontal ? Math.abs(dx) : Math.abs(dy));
        assert.ok(adv.steps >= 1);
        if (horizontal) assert.equal(Math.sign(dx), adv.dir === 0 ? 1 : -1);
        else {
          assert.equal(dx, 0, 'vertical legs come only after the column is right');
          assert.equal(Math.sign(dy), adv.dir === 1 ? 1 : -1);
        }
        checked++;
      }
  assert.ok(checked > 300, String(checked));
});

// --- the press rule --------------------------------------------------------------------------
test('a press changes exactly the previewed influence set by one phase; holes never change and locked tiles are never pressed', () => {
  const r = seeded(7);
  let presses = 0;
  let refused = 0;
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const { g } = open(level);
    const board = BOARDS[level - 1];
    for (let n = 0; n < 60; n++) {
      const keys = [
        ['ArrowLeft'],
        ['ArrowRight'],
        ['ArrowUp'],
        ['ArrowDown'],
        ['Space'],
        ['Space'],
        ['KeyZ'],
      ];
      const pick = keys[Math.floor(r() * keys.length)];
      const before = g.getState();
      const wasPress = pick[0] === 'Space';
      press(g, ...pick);
      const after = g.getState();
      if (after.phase !== 'playing') break;
      // The holes of the board are the '#' of every snapshot.
      assert.deepEqual(
        before.board.map((row) => [...row].map((ch) => ch === '#')),
        after.board.map((row) => [...row].map((ch) => ch === '#')),
      );
      if (!wasPress) continue;
      const i = before.cursor.y * board.w + before.cursor.x;
      const was = decode(before.board);
      const now = decode(after.board);
      if (after.moves === before.moves) {
        assert.deepEqual(now, was, 'a refused press changes nothing');
        if (!pressable(board, i))
          assert.deepEqual(before.preview, [], 'nothing was previewed for it');
        refused++;
        continue;
      }
      assert.ok(pressable(board, i));
      const preview = before.preview.map((p) => p.y * board.w + p.x).sort((a, b) => a - b);
      const changed = now.map((v, k) => (v === was[k] ? -1 : k)).filter((k) => k >= 0);
      assert.deepEqual(changed, preview, `board ${level}: the press changes the previewed tiles`);
      for (const k of preview) assert.equal(now[k], (was[k] + 1) % board.phases);
      assert.deepEqual(preview, [...board.influence[i]]);
      presses++;
    }
  }
  assert.ok(presses > 300 && refused > 5, `${presses} presses, ${refused} refused`);
});

test('pressing a phase-count number of times on one tile returns the board to where it started', () => {
  for (const level of [1, 12, 21]) {
    const { g } = open(level);
    const st = g.getState();
    const board = BOARDS[level - 1];
    const before = st.board.join('|');
    for (let n = 0; n < board.phases; n++) press(g, 'Space');
    assert.equal(g.getState().board.join('|'), before);
    assert.equal(g.getState().moves, board.phases);
  }
});

test('the preview is empty on a locked tile and on a hole, and the press says why it did nothing', () => {
  const locked = open(8);
  const lboard = BOARDS[7];
  const li = firstOf(lboard, (c) => c.locked);
  walkTo(locked.g, li % lboard.w, Math.floor(li / lboard.w));
  assert.deepEqual(locked.g.getState().preview, []);
  const sounds = locked.h.sounds.length;
  press(locked.g, 'Space');
  assert.equal(locked.g.getState().moves, 0);
  assert.match(locked.g.getState().message.en, /Locked/);
  assert.match(locked.g.getState().message.zh, /锁定/);
  assert.ok(locked.h.sounds.length > sounds);
  const holey = open(6);
  const hboard = BOARDS[5];
  const hi = firstOf(hboard, (c) => c.hole);
  walkTo(holey.g, hi % hboard.w, Math.floor(hi / hboard.w));
  press(holey.g, 'Space');
  assert.equal(holey.g.getState().moves, 0);
  assert.match(holey.g.getState().message.en, /No tile/);
  assert.match(holey.g.getState().message.zh, /没有方格/);
  // The prompt does not point at a tile that cannot be pressed.
  assert.ok(pressable(hboard, holey.g.getState().hint.y * hboard.w + holey.g.getState().hint.x));
});

// --- controls --------------------------------------------------------------------------------
test('arrows and WASD move the cursor one tile, clamp at the edges and ignore ambiguous presses', () => {
  const { g } = open(4);
  const start = g.getState().cursor;
  press(g, 'ArrowRight', 'ArrowLeft');
  assert.deepEqual(g.getState().cursor, start, 'opposite keys cancel');
  press(g, 'ArrowRight', 'ArrowDown');
  assert.deepEqual(g.getState().cursor, start, 'diagonal presses are neutral');
  press(g, 'ArrowRight');
  assert.deepEqual(g.getState().cursor, { x: start.x + 1, y: start.y });
  press(g, 'KeyA');
  press(g, 'KeyS');
  press(g, 'KeyW');
  press(g, 'KeyD');
  assert.deepEqual(g.getState().cursor, { x: start.x + 1, y: start.y });
  for (let n = 0; n < 20; n++) press(g, 'ArrowDown');
  assert.equal(g.getState().cursor.y, BOARDS[3].h - 1);
  for (let n = 0; n < 20; n++) press(g, 'ArrowRight');
  assert.equal(g.getState().cursor.x, BOARDS[3].w - 1);
  for (let n = 0; n < 20; n++) press(g, 'ArrowLeft', 'KeyA');
  for (let n = 0; n < 20; n++) press(g, 'ArrowUp');
  assert.deepEqual(g.getState().cursor, { x: 0, y: 0 });
  const sounds = open(4);
  const startX = sounds.g.getState().cursor.x;
  const heard = sounds.h.sounds.length;
  for (let n = 0; n < startX + 3; n++) press(sounds.g, 'ArrowLeft');
  assert.equal(sounds.h.sounds.length - heard, startX, 'only real moves make a sound');
});

test('the cursor starts on the pressable tile nearest the middle, never on a hole or a locked tile', () => {
  for (const board of BOARDS) {
    const { g } = open(BOARDS.indexOf(board) + 1);
    const c = g.getState().cursor;
    assert.ok(pressable(board, c.y * board.w + c.x));
  }
  assert.deepEqual(open(1).g.getState().cursor, { x: 1, y: 1 });
});

test('tapping a tile selects it and tapping it again presses it; taps outside the board do nothing', () => {
  const { g } = open(1);
  const board = BOARDS[0];
  const o = layoutOf(board);
  const at = (x, y) => ({
    x: o.x + x * RULES.cell + 5,
    y: o.y + y * RULES.cell + 5,
    clicked: true,
  });
  g.update(1 / 60, input([], [], at(0, 2)));
  assert.deepEqual(g.getState().cursor, { x: 0, y: 2 });
  assert.equal(g.getState().moves, 0);
  g.update(1 / 60, input([], [], at(0, 2)));
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().solved, true);
  const before = g.getState().cursor;
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  g.update(1 / 60, input([], [], { x: o.x + 3 * 36 + 1, y: o.y + 1, clicked: true }));
  assert.deepEqual(g.getState().cursor, before);
  assert.equal(cellAt(board, 2, 2), null);
  assert.deepEqual(cellAt(board, o.x + 1, o.y + 1), { x: 0, y: 0 });
  assert.equal(cellAt(board, o.x + board.w * 36, o.y), null);
  assert.equal(cellAt(board, o.x, o.y + board.h * 36), null);
  // Moving the pointer or holding it down is not a tap.
  g.update(1 / 60, input([], [], { x: o.x + 5, y: o.y + 5, down: true }));
  assert.deepEqual(g.getState().cursor, before);
});

test('undo restores the exact previous state, refunds the press and an empty history says so', () => {
  const { g } = open(5);
  press(g, 'KeyZ');
  assert.match(g.getState().message.en, /Nothing to undo/);
  assert.match(g.getState().message.zh, /没有可撤销/);
  const start = logical(g.getState());
  const hint = g.getState().hint;
  walkTo(g, hint.x, hint.y);
  const placed = logical(g.getState());
  press(g, 'Space');
  assert.equal(g.getState().moves, 1);
  assert.notDeepEqual(logical(g.getState()).board, placed.board);
  press(g, 'ArrowRight');
  press(g, 'KeyZ');
  const back = logical(g.getState());
  assert.deepEqual(back.board, placed.board);
  assert.equal(back.moves, 0, 'the press is refunded');
  assert.deepEqual(back.cursor, placed.cursor, 'the cursor returns to the undone tile');
  assert.equal(g.getState().undos, 1);
  assert.deepEqual(start.board, placed.board);
  assert.deepEqual(back.hint, placed.hint);
});

test('Q restarts the board, keeps the score and counts the restart', () => {
  const { g } = open(2);
  const board = BOARDS[1];
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  press(g, 'Space');
  assert.equal(g.getState().moves, 1);
  press(g, 'KeyQ');
  const st = g.getState();
  assert.equal(st.moves, 0);
  assert.equal(st.restarts, 1);
  assert.equal(st.phase, 'playing');
  assert.equal(st.board.join(''), g.getState().board.join(''));
  assert.deepEqual(st.board, (() => open(2).g.getState().board)());
  assert.match(st.message.en, /reset/);
  press(g, 'KeyZ');
  assert.match(g.getState().message.en, /Nothing to undo/, 'a reset clears the undo history');
});

test('the hint recovers after an undo and after a restart', () => {
  const { g } = open(4);
  const first = g.getState().hint;
  walkTo(g, first.x, first.y);
  assert.equal(g.getState().hint.kind, 'act');
  press(g, 'Space');
  assert.notDeepEqual(g.getState().hint, first);
  press(g, 'KeyZ');
  const back = g.getState();
  assert.equal(back.hint.x, first.x);
  assert.equal(back.hint.kind, 'act');
  press(g, 'KeyQ');
  assert.equal(g.getState().moves, 0);
  assert.deepEqual(g.getState().hint, first);
});

test('a tile that needs a second press in a row says "again", so the prompt changes after every press', () => {
  const { g } = open(21);
  const board = BOARDS[20];
  press(g, 'KeyH');
  const sol = solveFrom(board, board.start);
  const double = sol.vector.findIndex((n) => n === 2);
  assert.ok(double >= 0);
  walkTo(g, double % board.w, Math.floor(double / board.w));
  let seenAgain = false;
  const lines = [];
  for (let n = 0; n < 4; n++) {
    press(g, 'KeyH');
    const st = g.getState();
    if (st.hint.kind !== 'act') break;
    lines.push(st.line.en);
    if (/again/.test(st.line.en)) seenAgain = true;
    press(g, 'Space');
  }
  assert.ok(seenAgain, lines.join(' | '));
  for (let k = 1; k < lines.length; k++) assert.notEqual(lines[k], lines[k - 1]);
});

test('invalid, zero or negative time never reads input and never ends the game', () => {
  const { g, h } = open(3);
  press(g, 'ArrowRight');
  const before = JSON.stringify(g.getState());
  let reads = 0;
  const hostile = {
    held() {
      reads++;
      return true;
    },
    pressed() {
      reads++;
      return true;
    },
    pointer: { clicked: true, x: 100, y: 100 },
  };
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined]) g.update(dt, hostile);
  assert.equal(JSON.stringify(g.getState()), before);
  assert.equal(reads, 0);
  assert.equal(ENDS(h), 0);
});

test('getState returns copies that cannot change the game', () => {
  const { g } = open(6);
  const a = g.getState();
  a.cursor.x = 99;
  a.board.length = 0;
  a.preview.push({ x: 1, y: 1 });
  a.line.en = 'hacked';
  a.hint.x = 7;
  a.name.en = 'x';
  a.status.en = 'x';
  const b = g.getState();
  assert.notEqual(b.cursor.x, 99);
  assert.ok(b.board.length > 0);
  assert.notEqual(b.line.en, 'hacked');
  assert.notEqual(b.hint.x, 7);
  assert.equal(b.name.en, BOARDS[5].name.en);
  assert.ok(JSON.parse(JSON.stringify(b)));
});

// --- campaign: clear, advance, loss, win, progress -------------------------------------------
test('a matched board waits to hold still, banks its score and moves on by itself or on Space', () => {
  const { g, h } = open(1);
  playPlan(g, BOARDS[0]);
  assert.equal(g.getState().solved, true);
  assert.equal(g.getState().cleared, false, 'not judged at once');
  assert.match(g.getState().line.en, /Matched/);
  idle(g, 0.4);
  assert.equal(g.getState().cleared, false);
  idle(g, 0.3);
  let st = g.getState();
  assert.equal(st.cleared, true);
  assert.equal(st.score, 100);
  assert.match(st.line.en, /Board clear/);
  assert.match(st.status.zh, /过关/);
  assert.ok(h.sounds.includes('win'));
  press(g, 'KeyZ', 'KeyQ', 'KeyH');
  assert.equal(g.getState().cleared, true, 'actions are frozen while the board is clear');
  press(g, 'Space');
  st = g.getState();
  assert.equal(st.level, 2);
  assert.equal(st.cleared, false);
  assert.equal(st.moves, 0);
  const second = open(1);
  playPlan(second.g, BOARDS[0]);
  idle(second.g, 4);
  assert.equal(second.g.getState().level, 2);
});

test('a press that breaks a match before it holds cancels the clear', () => {
  const { g } = open(1);
  playPlan(g, BOARDS[0]);
  idle(g, 0.3);
  press(g, 'Space');
  assert.equal(g.getState().solved, false);
  idle(g, 1);
  assert.equal(g.getState().cleared, false);
  press(g, 'KeyZ');
  idle(g, 1);
  assert.equal(g.getState().cleared, true);
});

test('extra presses cost score and the score never goes below the floor', () => {
  const { g } = open(2);
  const board = BOARDS[1];
  const t = plan(board);
  walkTo(g, t[0].x, t[0].y);
  for (let n = 0; n < 6; n++) press(g, 'Space'); // six wasted presses: three full round trips
  for (const turn of t) {
    walkTo(g, turn.x, turn.y);
    press(g, 'Space');
  }
  idle(g, 1.8);
  const st = g.getState();
  assert.equal(st.level >= 2, true);
  assert.equal(
    st.score,
    Math.max(RULES.minBoardScore, RULES.clearScore - RULES.extraPressPenalty * 6),
  );
  assert.equal(st.score, 52);
  const floor = open(1);
  const b0 = BOARDS[0];
  const [turn] = plan(b0);
  walkTo(floor.g, turn.x, turn.y);
  for (let n = 0; n < 2 * 14 + 1; n++) press(floor.g, 'Space');
  idle(floor.g, 1.8);
  assert.equal(floor.g.getState().score, RULES.minBoardScore);
});

test('running out of presses on a budget board is a loss, judged after a grace period, and it freezes the game', () => {
  const { g, h } = open(5);
  const board = BOARDS[4];
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  for (let n = 0; n < board.budget; n++) press(g, 'Space');
  let st = g.getState();
  assert.equal(st.movesLeft, 0);
  assert.equal(st.phase, 'playing', 'judged only after the grace period');
  assert.equal(st.hint.kind, 'undo');
  press(g, 'Space');
  assert.equal(g.getState().moves, board.budget, 'no press beyond the budget');
  assert.match(g.getState().message.en, /No presses left/);
  idle(g, 1.3);
  assert.equal(g.getState().phase, 'playing', 'a touch player has time to reach Undo');
  idle(g, 5);
  assert.equal(g.getState().phase, 'playing');
  idle(g, 2);
  st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(ENDS(h), 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Out of presses on board 5/);
  assert.match(st.line.en, /Out of presses/);
  assert.doesNotMatch(st.status.en, /clear/i);
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(st);
  press(g, 'KeyZ', 'ArrowRight', 'Space', 'KeyQ');
  idle(g, 1);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(ENDS(h), 1);
});

test('an undo in the grace period saves a board that ran out of presses', () => {
  const { g, h } = open(5);
  const board = BOARDS[4];
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  for (let n = 0; n < board.budget; n++) press(g, 'Space');
  idle(g, 7);
  press(g, 'KeyZ');
  idle(g, 3);
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().movesLeft, 1);
  assert.equal(g.getState().loseIn, null);
  assert.equal(ENDS(h), 0);
});

test('an out-of-presses board shows a visible countdown to the loss, and only then', () => {
  const { g } = open(5);
  const board = BOARDS[4];
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  const shown = () => {
    const { ctx, texts } = recorder();
    g.draw(ctx);
    return texts.map((x) => x.text).find((x) => /\(\d+ s\)/.test(x)) ?? null;
  };
  assert.equal(g.getState().loseIn, null);
  assert.equal(shown(), null);
  for (let n = 0; n < board.budget - 1; n++) press(g, 'Space');
  assert.equal(g.getState().loseIn, null, 'one press is still left');
  press(g, 'Space');
  assert.ok(Math.abs(g.getState().loseIn - RULES.settleLose) < 0.05);
  assert.equal(shown(), 'Out of presses: undo with Z (8 s)');
  idle(g, 3);
  assert.equal(shown(), 'Out of presses: undo with Z (5 s)');
  assert.ok(g.getState().loseIn < 5.01 && g.getState().loseIn > 4.9);
  assert.equal(g.getState().hint.kind, 'undo');
  assert.ok(RULES.settleLose >= 5, 'enough time for a touch player');
  // The Chinese text names the same number.
  const zh = open(5, { lang: 'zh' });
  walkTo(zh.g, t.x, t.y);
  for (let n = 0; n < board.budget; n++) press(zh.g, 'Space');
  const { ctx, texts } = recorder();
  zh.g.draw(ctx);
  assert.ok(texts.some((x) => x.text === '次数用完：按 Z 撤销（8 秒）'));
  // Matching the board on the last press ends the countdown.
  const win = open(2);
  playPlan(win.g, BOARDS[1]);
  assert.equal(win.g.getState().loseIn, null);
});

test('the last press of a budget may still win the board', () => {
  const { g, h } = open(5);
  const board = BOARDS[4];
  assert.equal(board.slack, 2);
  const turns = plan(board);
  // Waste the whole slack: pressing a tile twice puts the board back but costs two presses.
  walkTo(g, turns[0].x, turns[0].y);
  press(g, 'Space');
  press(g, 'Space');
  assert.equal(g.getState().movesLeft, board.optimal);
  playPlan(g, board);
  const st = g.getState();
  assert.equal(st.solved, true);
  assert.equal(st.movesLeft, 0, 'the winning press was the last one allowed');
  idle(g, 5);
  assert.equal(g.getState().level, 6);
  assert.equal(ENDS(h), 0);
});

test('clearing the last board wins the game once with the full score and then freezes', () => {
  const { g, h } = open(BOARD_COUNT);
  playPlan(g, BOARDS[BOARD_COUNT - 1]);
  idle(g, 3);
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(ENDS(h), 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
  assert.match(h.ends[0].message, /loom is yours/);
  assert.match(st.line.en, /Every board is clear/);
  assert.match(st.status.zh, /全部棋盘已通关/);
  const frozen = JSON.stringify(st);
  press(g, 'Space', 'KeyQ', 'KeyZ');
  idle(g, 3);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(ENDS(h), 1);
});

test('a full run from board 1 reaches the win with a perfect score', () => {
  const { g, h } = open(1);
  for (let i = 0; i < BOARD_COUNT; i++) {
    assert.equal(g.getState().level, i + 1);
    playPlan(g, BOARDS[i]);
    idle(g, 5);
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(g.getState().score, 100 * BOARD_COUNT);
  assert.equal(ENDS(h), 1);
});

test('board select opens when progress is saved and starts the chosen board', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 6, unlock() {} };
  const m = createGame(h.env);
  let st = m.getState();
  assert.deepEqual(st.menu, { sel: 6, unlocked: 6 });
  assert.match(st.line.en, /Choose a board/);
  assert.match(st.line.zh, /选择棋盘/);
  assert.equal(st.status.en, st.line.en);
  press(m, 'ArrowLeft');
  assert.equal(m.getState().menu.sel, 5);
  press(m, 'ArrowRight', 'ArrowRight');
  assert.equal(m.getState().menu.sel, 6, 'clamped at the last unlocked board');
  press(m, 'ArrowUp');
  assert.equal(m.getState().menu.sel, 1, 'a row up clamps to board 1');
  press(m, 'ArrowDown');
  assert.equal(m.getState().menu.sel, 6);
  press(m, 'ArrowLeft');
  idle(m, 1);
  assert.equal(m.getState().menu.sel, 5, 'the menu does not run the clock');
  press(m, 'Enter');
  st = m.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 5);
  assert.equal(open(5).g.getState().menu, null, 'Space in the helper already started board 5');
});

test('board select by tap: the first tap selects, the second starts, locked boards and gaps are ignored', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 4, unlock() {} };
  const g = createGame(h.env);
  const tile = (n) => ({
    x: 16 + ((n - 1) % RULES.menuCols) * 56 + 20,
    y: 66 + Math.floor((n - 1) / RULES.menuCols) * 44 + 20,
    clicked: true,
  });
  g.update(1 / 60, input([], [], tile(2)));
  assert.equal(g.getState().menu.sel, 2);
  g.update(1 / 60, input([], [], tile(9)));
  assert.equal(g.getState().menu.sel, 2, 'locked board');
  g.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true }));
  assert.equal(g.getState().menu.sel, 2, 'outside the tiles');
  g.update(1 / 60, input([], [], tile(2)));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 2);
  assert.equal(menuCellAt(16, 66, BOARD_COUNT), 1);
  assert.equal(menuCellAt(16 + 56 * 8, 66, BOARD_COUNT), -1);
  assert.equal(
    menuCellAt(16 + 56 * 2 + 1, 66 + 44 * 3 + 1, BOARD_COUNT),
    BOARD_COUNT >= 27 ? 27 : -1,
  );
  assert.equal(menuCellAt(0, 0, BOARD_COUNT), -1);
  assert.equal(menuCellAt(20, 10, BOARD_COUNT), -1);
});

test('progress is read safely: no store, junk values and a throwing store all start at board 1', () => {
  const variants = [
    undefined,
    { unlocked: () => 'x', unlock() {} },
    { unlocked: () => NaN, unlock() {} },
    { unlocked: () => 0, unlock() {} },
    { unlocked: () => -Infinity, unlock() {} },
  ];
  for (const progress of variants) {
    const h = harness();
    if (progress) h.env.progress = progress;
    const g = createGame(h.env);
    assert.equal(g.getState().menu, null);
    assert.equal(g.getState().level, 1);
  }
  const throwing = harness();
  throwing.env.progress = {
    unlocked() {
      throw new Error('storage blocked');
    },
    unlock() {
      throw new Error('storage blocked');
    },
  };
  const g = createGame(throwing.env);
  assert.equal(g.getState().level, 1);
  playPlan(g, BOARDS[0]);
  idle(g, 3);
  assert.equal(g.getState().level, 2, 'a broken store must not stop the game');
  for (const value of [Infinity, 1e9, BOARD_COUNT + 5]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    assert.deepEqual(createGame(h.env).getState().menu, {
      sel: BOARD_COUNT,
      unlocked: BOARD_COUNT,
    });
  }
});

test('clearing a board unlocks the next one but never beyond the last', () => {
  const { g, h } = open(3);
  playPlan(g, BOARDS[2]);
  idle(g, 1.2);
  assert.deepEqual(h.calls, [4]);
  const last = open(BOARD_COUNT);
  playPlan(last.g, BOARDS[BOARD_COUNT - 1]);
  idle(last.g, 3);
  assert.deepEqual(last.h.calls, [BOARD_COUNT]);
});

// --- time, determinism and robustness --------------------------------------------------------
test('the same timed key schedule gives the identical result at 30, 60 and 120 Hz', () => {
  const board = BOARDS[8];
  const turns = plan(board);
  const events = [];
  let t = 0.2;
  let cur = { ...open(9).g.getState().cursor };
  const step = (key) => {
    events.push([Math.round(t * 30) / 30, key]);
    t += 1 / 3;
  };
  for (const turn of turns) {
    while (cur.x !== turn.x) {
      step(cur.x < turn.x ? 'ArrowRight' : 'ArrowLeft');
      cur = { ...cur, x: cur.x + Math.sign(turn.x - cur.x) };
    }
    while (cur.y !== turn.y) {
      step(cur.y < turn.y ? 'ArrowDown' : 'ArrowUp');
      cur = { ...cur, y: cur.y + Math.sign(turn.y - cur.y) };
    }
    step('Space');
  }
  const run = (hz) => {
    const { g } = open(9);
    const snaps = [];
    const frames = Math.round((t + 4) * hz);
    for (let f = 0; f < frames; f++) {
      const now = f / hz;
      const keys = events.filter(([et]) => Math.abs(et - now) < 1 / hz / 2).map(([, k]) => k);
      g.update(1 / hz, input([], keys));
      if (f % hz === hz - 1) snaps.push(JSON.stringify(g.getState()));
    }
    return snaps;
  };
  const a = run(60);
  assert.deepEqual(run(30), a);
  assert.deepEqual(run(120), a);
  assert.ok(JSON.parse(a.at(-1)).level >= 9);
});

test('uneven frame times keep the game finite and bounded', () => {
  const { g } = open(20);
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const keys = ['Space', 'ArrowRight', 'ArrowDown', 'KeyZ', 'ArrowLeft', 'ArrowUp', 'KeyQ'];
  for (let f = 0; f < 4000; f++) {
    const dt = f % 97 === 0 ? 5 : 0.0005 + rnd() * 0.12;
    g.update(dt, input([], rnd() < 0.3 ? [keys[Math.floor(rnd() * keys.length)]] : []));
    if (f % 500 === 0) {
      const st = g.getState();
      assert.ok(st.moves >= 0 && st.moves <= RULES.pressesMax);
      assert.ok(Number.isFinite(st.score));
    }
  }
  assert.ok(JSON.parse(JSON.stringify(g.getState())));
});

test('the undo history and the press counter stay bounded however long a player mashes', () => {
  const { g } = open(2);
  for (let n = 0; n < RULES.historyMax + 120; n++) press(g, 'Space');
  assert.ok(g.getState().moves <= RULES.pressesMax);
  let undone = 0;
  for (let n = 0; n < RULES.historyMax + 50; n++) {
    const before = g.getState().moves;
    press(g, 'KeyZ');
    if (g.getState().moves < before) undone++;
  }
  assert.equal(undone, RULES.historyMax, 'only the newest presses can be undone');
  const sat = open(1);
  for (let n = 0; n < RULES.pressesMax + 30; n++) press(sat.g, 'Space');
  assert.equal(sat.g.getState().moves, RULES.pressesMax);
});

// --- drawing ---------------------------------------------------------------------------------
test('every board draws in both languages and every state without errors', () => {
  for (const lang of ['en', 'zh'])
    BOARDS.forEach((board, i) => {
      const { g } = open(i + 1, { lang });
      const ctx = mockContext();
      g.draw(ctx);
      idle(g, 0.05);
      g.draw(ctx);
      const hint = g.getState().hint;
      walkTo(g, hint.x, hint.y);
      press(g, 'Space');
      for (let n = 0; n < 40; n++) {
        g.update(1 / 60, input());
        g.draw(ctx);
      }
      press(g, 'KeyZ');
      press(g, 'Space');
      press(g, 'KeyZ');
      press(g, 'Space', 'ArrowRight', 'ArrowDown');
      g.draw(ctx);
      for (let k = 0; k < board.w * board.h; k++) {
        press(g, k % 2 ? 'ArrowRight' : 'ArrowDown');
        g.draw(ctx);
      }
    });
});

test('menu, clear, loss and win screens draw in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 9, unlock() {} };
    const menu = createGame(h.env);
    menu.draw(mockContext());
    press(menu, 'ArrowLeft');
    menu.draw(mockContext());
    const { g } = open(1, { lang });
    playPlan(g, BOARDS[0]);
    idle(g, 1);
    g.draw(mockContext());
    const lost = open(5, { lang });
    const t = plan(BOARDS[4])[0];
    walkTo(lost.g, t.x, t.y);
    for (let n = 0; n < BOARDS[4].budget; n++) press(lost.g, 'Space');
    idle(lost.g, 9);
    lost.g.draw(mockContext());
    assert.equal(lost.g.getState().phase, 'lost');
    const won = open(BOARD_COUNT, { lang });
    playPlan(won.g, BOARDS[BOARD_COUNT - 1]);
    idle(won.g, 2);
    won.g.draw(mockContext());
    assert.equal(won.g.getState().phase, 'won');
  }
});

test('all text stays inside the 480 px canvas on every board, in both languages, with the longest messages shown', () => {
  let drawn = 0;
  for (const lang of ['en', 'zh'])
    BOARDS.forEach((board, i) => {
      const { g } = open(i + 1, { lang });
      const { ctx, texts } = recorder();
      g.draw(ctx);
      press(g, 'KeyZ'); // the "nothing to undo" message
      g.draw(ctx);
      const budgetFull = board.budget === null ? 0 : board.budget;
      for (let n = 0; n < budgetFull + 1; n++) press(g, 'Space'); // "no presses left"
      g.draw(ctx);
      for (const text of texts) {
        const [left, right] = textBounds(text);
        assert.ok(
          left >= 0 && right <= 480,
          `board ${i + 1} ${lang}: "${text.text}" spans ${left}-${right}`,
        );
        assert.ok(text.y >= 0 && text.y + text.size <= 320, `"${text.text}" is on the canvas`);
        drawn++;
      }
      const hud = texts.find((t) => t.y === 4 && t.align === 'left');
      assert.ok(hud.text.includes(board.name[lang]));
    });
  assert.ok(drawn > 800);
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => BOARD_COUNT, unlock() {} };
    const m = createGame(h.env);
    const { ctx, texts } = recorder();
    m.draw(ctx);
    for (const text of texts) {
      const [left, right] = textBounds(text);
      assert.ok(left >= 0 && right <= 480, `menu ${lang}: "${text.text}"`);
    }
  }
});

test('the influence preview is drawn on exactly the tiles a press would change, and on none for a locked tile', () => {
  const previewFrames = (g) => {
    const { ctx, rects } = recorder();
    g.draw(ctx);
    // A preview frame is a top and a bottom bar of 34 px in the preview colour, one pair per tile.
    return rects.filter((r) => r.color === '#7df9ff' && r.w === 34 && r.h === 2);
  };
  const { g } = open(18);
  const before = g.getState().preview.length;
  assert.ok(before >= 3);
  assert.equal(previewFrames(g).length, 2 * before);
  press(g, 'ArrowRight');
  assert.equal(previewFrames(g).length, 2 * g.getState().preview.length);
  const locked = open(8);
  const board = BOARDS[7];
  const i = firstOf(board, (c) => c.locked);
  walkTo(locked.g, i % board.w, Math.floor(i / board.w));
  assert.equal(previewFrames(locked.g).length, 0);
});

test('sparks appear when a tile reaches its target and stay bounded', () => {
  const { g } = open(2);
  const board = BOARDS[1];
  playPlan(g, board);
  const { ctx, rects } = recorder();
  g.draw(ctx);
  assert.ok(
    rects.some((r) => r.color === '#6dffc0' && r.w === 3 && r.h === 3),
    'a spark is drawn',
  );
  idle(g, 0.45);
  const later = recorder();
  g.draw(later.ctx);
  assert.equal(
    later.rects.some((r) => r.color === '#6dffc0' && r.w === 3 && r.h === 3),
    false,
    'sparks fade',
  );
  const many = open(2);
  for (let n = 0; n < 300; n++) press(many.g, 'Space');
  many.g.draw(mockContext());
});

// --- random mixed play never breaks an invariant ---------------------------------------------
test('random mixed play on every board keeps the state valid and ends at most once', () => {
  const r = seeded(2024);
  const codes = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'Space',
    'Space',
    'KeyZ',
    'KeyQ',
    'Enter',
  ];
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const { g, h } = open(level);
    const board = BOARDS[level - 1];
    for (let f = 0; f < 900; f++) {
      const pick = codes.filter(() => r() < 0.08);
      const pointer =
        f % 40 === 0 ? { x: Math.floor(r() * 480), y: Math.floor(r() * 320), clicked: true } : {};
      g.update(1 / 60, input([], pick, pointer));
      if (f % 100 === 0) {
        const st = g.getState();
        assert.ok(
          st.cursor.x >= 0 && st.cursor.x < st.width && st.cursor.y >= 0 && st.cursor.y < st.height,
        );
        for (const row of st.board) assert.match(row, /^[#0-2]+$/);
        assert.ok(decode(st.board).every((v) => v < board.phases || st.level !== level));
        assert.ok(st.moves >= 0);
      }
    }
    assert.ok(h.ends.length <= 1);
    assert.equal(mismatches(board, [...board.target]), 0);
  }
});

test('the shared data cannot be changed from outside: board definitions, meta, shape names and prompt lines', () => {
  assert.equal(Object.isFrozen(BOARD_DEFS), true);
  assert.equal(BOARD_DEFS.length, BOARD_COUNT);
  for (const def of BOARD_DEFS) {
    assert.equal(Object.isFrozen(def), true);
    assert.equal(Object.isFrozen(def.layout), true);
    assert.equal(Object.isFrozen(def.scramble[0]), true);
  }
  assert.throws(() => {
    'use strict';
    BOARD_DEFS[0].layout[0] = 'x';
  }, TypeError);
  for (const part of [
    meta,
    meta.name,
    meta.keys,
    meta.keys[0],
    meta.touchControls,
    meta.touchControls[0],
  ])
    assert.equal(Object.isFrozen(part), true);
  assert.equal(Object.isFrozen(SHAPE_NAMES), true);
  for (const key of SHAPE_KEYS) assert.equal(Object.isFrozen(SHAPE_NAMES[key]), true);
  assert.equal('maxPhases' in RULES, false);
  // A caller that changes a returned prompt line does not leak into the next call.
  for (const [adv, again] of [
    [{ kind: 'undo' }],
    [{ kind: 'done' }],
    [{ kind: 'act' }],
    [{ kind: 'act' }, true],
  ]) {
    const line = adviceLine(adv, again);
    const copy = [...line];
    line[0] = 'hacked';
    line.push('extra');
    assert.deepEqual(adviceLine(adv, again), copy);
  }
});

test('the shape card names the shape under the cursor, and says "no tile" over a hole', () => {
  const { g } = open(6);
  const board = BOARDS[5];
  const hole = firstOf(board, (c) => c.hole);
  const card = () => {
    const { ctx, texts } = recorder();
    g.draw(ctx);
    return texts.filter((t) => t.x < 100 && t.y > 60 && t.y < 120).map((t) => t.text);
  };
  assert.deepEqual(card(), ['plus']);
  walkTo(g, hole % board.w, Math.floor(hole / board.w));
  assert.deepEqual(card(), ['no tile']);
  const zh = open(6, { lang: 'zh' });
  walkTo(zh.g, hole % board.w, Math.floor(hole / board.w));
  const { ctx, texts } = recorder();
  zh.g.draw(ctx);
  assert.ok(texts.some((t) => t.text === '无方格'));
  assert.ok(!texts.some((t) => t.text === '十字'));
});

// --- hints: free on the teaching boards, on request and at a cost after them -----------------
test('boards 1 to 7 always name the next move; from board 8 the prompt states the goal and hides the move', () => {
  assert.equal(RULES.hintFreeBoards, 7);
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const st = open(level).g.getState();
    if (level <= RULES.hintFreeBoards) {
      assert.equal(st.hint.shown, true, `board ${level}`);
      assert.notEqual(st.hint.x, null);
      assert.notEqual(st.hint.key, null);
      assert.doesNotMatch(st.line.en, /\[H\]/);
    } else {
      assert.deepEqual(
        st.hint,
        { kind: 'hidden', x: null, y: null, dir: null, steps: 0, key: null, shown: false },
        `board ${level}`,
      );
      assert.match(st.line.en, /Match every tile to the target card/);
      assert.match(st.line.en, new RegExp(`\\[H\\] hint -${RULES.hintPenalty}`));
      assert.match(st.line.zh, new RegExp(`\\[H\\] 提示 -${RULES.hintPenalty}`));
      assert.doesNotMatch(st.line.en, /Move|row \d/);
      assert.ok(st.status.en.endsWith(st.line.en));
    }
  }
  const free = open(3);
  press(free.g, 'KeyH');
  assert.equal(free.g.getState().hints, 0, 'a free hint costs nothing to ask for');
  assert.equal(free.g.getState().message, null);
});

test('H shows the next move for one press at a price; a press, an undo or a reset hides it again', () => {
  const { g, h } = open(9);
  const board = BOARDS[8];
  press(g, 'KeyH');
  let st = g.getState();
  assert.equal(st.hints, 1);
  assert.equal(st.hint.shown, true);
  assert.ok(['move', 'act'].includes(st.hint.kind));
  assert.match(st.message.en, new RegExp(`Hint: -${RULES.hintPenalty} points`));
  assert.match(st.message.zh, new RegExp(`提示：扣 ${RULES.hintPenalty} 分`));
  assert.ok(h.sounds.includes('coin'));
  press(g, 'KeyH');
  assert.equal(g.getState().hints, 1, 'asking while the hint is up costs nothing');
  walkTo(g, st.hint.x, st.hint.y);
  assert.equal(g.getState().hint.kind, 'act', 'the hint stays up while the cursor walks');
  press(g, 'Space');
  assert.equal(g.getState().hint.kind, 'hidden');
  assert.equal(g.getState().hint.x, null);
  press(g, 'KeyH');
  assert.equal(g.getState().hints, 2);
  press(g, 'KeyZ');
  assert.equal(g.getState().hint.kind, 'hidden', 'an undo hides it');
  press(g, 'KeyH');
  press(g, 'KeyQ');
  assert.equal(g.getState().hint.kind, 'hidden', 'a reset hides it');
  assert.equal(g.getState().hints, 3);
  assert.ok(pressable(board, st.hint.y * board.w + st.hint.x));
});

test('H does nothing once the board is matched, and a hint never works on a cleared board', () => {
  const { g } = open(9);
  playPlan(g, BOARDS[8]);
  assert.equal(g.getState().solved, true);
  press(g, 'KeyH');
  assert.equal(g.getState().hints, 0);
  assert.equal(g.getState().hint.kind, 'hidden');
  idle(g, 0.8);
  assert.equal(g.getState().cleared, true);
  press(g, 'KeyH');
  assert.equal(g.getState().hints, 0);
});

test('every hint asked for on a board costs points, even across a reset, and a free board costs none', () => {
  const hinted = open(9);
  press(hinted.g, 'KeyH');
  press(hinted.g, 'KeyQ');
  press(hinted.g, 'KeyH');
  playPlan(hinted.g, BOARDS[8]);
  idle(hinted.g, 1);
  assert.equal(hinted.g.getState().cleared, true);
  assert.equal(hinted.g.getState().score, 100 - 2 * RULES.hintPenalty);
  const plain = open(9);
  playPlan(plain.g, BOARDS[8]);
  idle(plain.g, 1);
  assert.equal(plain.g.getState().score, 100);
  const free = open(2);
  press(free.g, 'KeyH');
  playPlan(free.g, BOARDS[1]);
  idle(free.g, 1);
  assert.equal(free.g.getState().score, 100);
  // Many hints cannot push a board below the floor.
  const floor = open(26);
  const turns = plan(BOARDS[25]);
  for (const turn of turns) {
    press(floor.g, 'KeyH');
    walkTo(floor.g, turn.x, turn.y);
    press(floor.g, 'Space');
  }
  idle(floor.g, 4);
  assert.equal(floor.h.ends.at(-1)?.score ?? floor.g.getState().score, RULES.minBoardScore);
});

test('a hint that is up stays in step with the board: it asks for an undo only when the presses cannot cover the way home', () => {
  const { g } = open(22);
  const board = BOARDS[21];
  assert.equal(board.slack, 0);
  press(g, 'KeyH');
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  const other = board.cells.findIndex(
    (c, i) => pressable(board, i) && !plan(board).some((p) => p.y * board.w + p.x === i),
  );
  assert.ok(other >= 0);
  walkTo(g, other % board.w, Math.floor(other / board.w));
  press(g, 'Space');
  assert.equal(g.getState().hint.kind, 'hidden');
  press(g, 'KeyH');
  assert.equal(g.getState().hint.kind, 'undo');
  assert.equal(g.getState().hint.key, 'KeyZ');
});

test('the undo hint is marked on the board with a Z on the tile that Z takes back', () => {
  const marks = (g) => {
    const { ctx, texts } = recorder();
    g.draw(ctx);
    return texts.filter((x) => x.text === 'Z');
  };
  const { g } = open(5);
  const board = BOARDS[4];
  const t = plan(board)[0];
  walkTo(g, t.x, t.y);
  assert.equal(marks(g).length, 0);
  for (let n = 0; n < board.budget; n++) press(g, 'Space');
  assert.equal(g.getState().hint.kind, 'undo');
  const o = layoutOf(board);
  const [mark] = marks(g);
  assert.ok(mark, 'a Z marker is drawn');
  assert.ok(mark.x > o.x + t.x * 36 && mark.x < o.x + (t.x + 1) * 36, 'on the last pressed tile');
  assert.ok(mark.y >= o.y + t.y * 36 && mark.y < o.y + (t.y + 1) * 36);
  // Where the hint is not shown, nothing points at the undo.
  const late = open(10);
  const lboard = BOARDS[9];
  const lt = plan(lboard)[0];
  walkTo(late.g, lt.x, lt.y);
  for (let n = 0; n < lboard.budget; n++) press(late.g, 'Space');
  assert.equal(late.g.getState().hint.kind, 'hidden');
  assert.equal(marks(late.g).length, 0);
});

test('several mastery boards leave no spare press, and the others keep a small spare', () => {
  const mastery = BOARDS.slice(18);
  const exact = mastery.filter((b) => b.slack === 0);
  assert.ok(exact.length >= 4, `${exact.length} exact mastery boards`);
  assert.ok(
    mastery.some((b) => b.slack === 1),
    'a mix of margins',
  );
  for (const board of exact) assert.equal(board.budget, board.optimal);
  assert.ok(BOARDS.slice(0, 18).every((b) => b.slack !== 0));
});

test('an exact board is still clearable at its budget, and one wasted press then an undo is forgiven', () => {
  const { g, h } = open(26);
  const board = BOARDS[25];
  assert.equal(board.budget, board.optimal);
  const turns = plan(board);
  walkTo(g, turns[0].x, turns[0].y);
  press(g, 'Space');
  press(g, 'KeyZ');
  assert.equal(g.getState().moves, 0, 'the undo refunds the press');
  for (const turn of turns) {
    walkTo(g, turn.x, turn.y);
    press(g, 'Space');
  }
  assert.equal(g.getState().movesLeft, 0);
  assert.equal(g.getState().solved, true);
  idle(g, 2);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
});

// --- the clear pause ---------------------------------------------------------------------------
test('arrows, WASD, Space, Enter or a tap skip the pause after a board is cleared', () => {
  const skips = [
    ['ArrowRight'],
    ['KeyA'],
    ['ArrowUp'],
    ['KeyS'],
    ['Space'],
    ['Enter'],
    ['KeyW'],
    ['KeyD'],
    ['ArrowLeft'],
    ['ArrowDown'],
  ];
  for (const keys of skips) {
    const { g } = open(1);
    playPlan(g, BOARDS[0]);
    idle(g, 0.8);
    assert.equal(g.getState().cleared, true);
    g.update(1 / 60, input([], keys));
    assert.equal(g.getState().level, 2, keys.join());
    assert.equal(g.getState().cleared, false);
  }
  const tap = open(1);
  playPlan(tap.g, BOARDS[0]);
  idle(tap.g, 0.8);
  tap.g.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true }));
  assert.equal(tap.g.getState().level, 2);
  // Z, Q and H still do nothing during the pause, and the last board cannot be skipped past.
  const idleKeys = open(1);
  playPlan(idleKeys.g, BOARDS[0]);
  idle(idleKeys.g, 0.8);
  press(idleKeys.g, 'KeyZ', 'KeyQ', 'KeyH');
  assert.equal(idleKeys.g.getState().level, 1);
});

// --- the target phase is more than a colour ------------------------------------------------------
test('the ghost mark on a tile and the target card show the target phase as a bar count, not only a colour', () => {
  const barsAt = (g, color) => {
    const { ctx, rects } = recorder();
    g.draw(ctx);
    return rects.filter((r) => r.color === color && r.w === 1 && (r.h === 5 || r.h === 6));
  };
  const three = open(21); // every target is phase 2: three bars on each ghost mark and each target swatch
  const board = BOARDS[20];
  const tiles = board.cells.filter((c) => !c.hole).length;
  assert.equal(barsAt(three.g, '#ffffff').length, tiles * 3 * 2);
  const mixed = open(22); // targets 0, 1 and 2 together
  const mboard = BOARDS[21];
  const count = (phase) =>
    mboard.target.filter((v, i) => !mboard.cells[i].hole && v === phase).length;
  assert.equal(barsAt(mixed.g, '#ffffff').length, (count(0) + count(2) * 3) * 2);
  assert.equal(barsAt(mixed.g, '#0b0a1a').length, count(1) * 2 * 2);
  // Three bars span five pixels inside the 7 px swatch.
  const { ctx, rects } = recorder();
  three.g.draw(ctx);
  const o = layoutOf(board);
  const ghost = rects.filter(
    (r) => r.color === '#ffffff' && r.w === 1 && r.h === 5 && r.x < o.x + 36 && r.y < o.y + 36,
  );
  assert.deepEqual(
    ghost.map((r) => r.x - (o.x + 5)).sort((a, b) => a - b),
    [1, 3, 5],
  );
});
