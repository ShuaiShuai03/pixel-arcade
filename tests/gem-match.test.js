import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createGemState,
  stepGem,
  gemObjective,
  gemSwapPose,
  findMatches,
  legalSwaps,
  makeBoard,
  applySwap,
  LEVELS,
  LEVEL_COUNT,
  meta,
} from '../src/games/gem-match.js';
import { chooseColor } from '../src/games/gem-match-rules.js';
import { harness, input, mockContext, seeded } from './harness.js';

const at = (p) => ({ x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true });
const click = (p) => input([], [], at(p));
function swapBy(s, env, move, hz = 120) {
  for (const p of [move.a, move.b]) stepGem(s, 1 / hz, click(p), env);
}
function settle(s, env, hz = 120) {
  for (
    let i = 0;
    i < hz * 20 && s.phase === 'playing' && !['ready', 'garden-clear'].includes(s.mode);
    i++
  )
    stepGem(s, 1 / hz, input(), env);
}
const bareBoard = () =>
  Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => (x + 2 * y) % 6));
const noSoil = () => Array.from({ length: 7 }, () => Array(7).fill(-1));

test('generated boards have no initial matches and always offer a legal swap', () => {
  for (const kinds of [4, 5, 6])
    for (let seed = 1; seed <= 40; seed++) {
      const board = makeBoard(seeded(seed), kinds);
      assert.equal(findMatches(board).length, 0);
      assert.ok(legalSwaps(board).length);
      assert.ok(board.flat().every((v) => v >= 0 && v < kinds));
    }
  const flat = makeBoard(() => 0);
  assert.equal(findMatches(flat).length, 0);
  assert.ok(legalSwaps(flat).length);
  assert.throws(() => makeBoard(seeded(1), 6, 2), RangeError);
  for (const kinds of [3, 4, 5]) {
    const fallback = makeBoard(() => 0, kinds);
    assert.equal(findMatches(fallback).length, 0);
    assert.ok(legalSwaps(fallback).length);
  }
});

test('a refill cell boxed in by pairs of every kind keeps a gem and cascades instead of throwing', () => {
  const board = Array.from({ length: 7 }, () => Array(7).fill(-1));
  // Four kinds each form a pair beside (3,3): left, right, above, below.
  board[3][1] = board[3][2] = 0;
  board[3][4] = board[3][5] = 1;
  board[1][3] = board[2][3] = 2;
  board[4][3] = board[5][3] = 3;
  const value = chooseColor(board, 3, 3, () => 0, 4);
  assert.ok(value >= 0 && value < 4);
  assert.ok(findMatches(board).length > 0);
});

test('matching counts crossing lines once and swaps must be adjacent, legal and on gems', () => {
  const board = [
    [0, 1, 2, 3],
    [1, 1, 1, 4],
    [2, 1, 3, 0],
    [3, 2, 0, 4],
  ];
  assert.deepEqual(findMatches(board).sort(), ['0,1', '1,0', '1,1', '1,2', '2,1'].sort());
  assert.equal(applySwap(board, { x: 0, y: 0 }, { x: 2, y: 2 }), null);
  assert.equal(applySwap(board, { x: 0, y: 0 }, { x: 9, y: 0 }), null);
  assert.equal(applySwap(board, { x: 0, y: 0 }, null), null);
  assert.equal(applySwap([[-1, 1, 1]], { x: 0, y: 0 }, { x: 1, y: 0 }), null);
});

test('keyboard selection spends exactly one move on a legal swap and scores it', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState(),
    move = legalSwaps(before.board)[0],
    press = (code) => g.update(1 / 60, input([], [code]));
  for (let i = 0; i < move.a.x; i++) press('ArrowRight');
  for (let i = 0; i < move.a.y; i++) press('KeyS');
  press('Space');
  const dx = move.b.x - move.a.x,
    dy = move.b.y - move.a.y;
  press(dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp');
  press('Enter');
  for (let i = 0; i < 240; i++) g.update(1 / 60, input());
  assert.ok(g.getState().score > 0);
  assert.equal(g.getState().moves, before.moves - 1);
  g.draw(mockContext());
  assert.equal(createGame(h.env).getState().score, 0);
});

test('cursor wraps, ignores diagonals and held keys do not repeat', () => {
  const g = createGame(harness().env);
  g.update(1 / 60, input(['ArrowRight']));
  assert.deepEqual(g.getState().cursor, { x: 0, y: 0 });
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.deepEqual(g.getState().cursor, { x: 6, y: 0 });
  g.update(1 / 60, input([], ['KeyW']));
  assert.deepEqual(g.getState().cursor, { x: 6, y: 6 });
  g.update(1 / 60, input([], ['ArrowRight', 'ArrowDown']));
  assert.deepEqual(g.getState().cursor, { x: 6, y: 6 });
});

test('hint points at a real legal swap and costs nothing', () => {
  const g = createGame(harness().env),
    s = g.getState();
  g.update(1 / 60, input([], ['KeyH']));
  assert.ok(
    legalSwaps(s.board).some((m) => JSON.stringify(m) === JSON.stringify(g.getState().hint)),
  );
  assert.equal(g.getState().moves, s.moves);
  for (let i = 0; i < 200; i++) g.update(1 / 60, input());
  assert.equal(g.getState().hint, null);
});

test('an invalid adjacent swap animates out and back for free, then a real match still works', () => {
  const h = harness(),
    s = createGemState(h.env),
    before = structuredClone(s.board),
    moves = s.moves;
  let bad;
  for (let y = 0; y < 7 && !bad; y++)
    for (let x = 0; x < 6 && !bad; x++)
      if (!applySwap(s.board, { x, y }, { x: x + 1, y })) bad = { a: { x, y }, b: { x: x + 1, y } };
  swapBy(s, h.env, bad);
  assert.equal(s.mode, 'swap');
  assert.equal(s.swap.valid, false);
  settle(s, h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.feedback, 'invalid');
  assert.deepEqual(s.board, before);
  assert.equal(s.moves, moves);
  assert.equal(s.score, 0);
  stepGem(s, 1 / 120, click(s.selected), h.env);
  assert.equal(s.selected, null);
  swapBy(s, h.env, legalSwaps(s.board)[0]);
  settle(s, h.env);
  assert.ok(s.score > 0);
  assert.equal(s.moves, moves - 1);
});

test('choosing a far gem re-targets the selection instead of swapping', () => {
  const h = harness(),
    s = createGemState(h.env);
  stepGem(s, 1 / 60, click({ x: 0, y: 0 }), h.env);
  stepGem(s, 1 / 60, click({ x: 4, y: 4 }), h.env);
  assert.deepEqual(s.selected, { x: 4, y: 4 });
  assert.equal(s.mode, 'ready');
});

test('legal swaps travel before the board changes', () => {
  const h = harness(),
    s = createGemState(h.env),
    board = structuredClone(s.board);
  swapBy(s, h.env, legalSwaps(s.board)[0], 240);
  assert.equal(s.mode, 'swap');
  assert.deepEqual(s.board, board);
  assert.ok(s.swap.time > 0 && s.swap.time < s.swap.duration);
});

test('swap carriers lift clear before translating and lower only at separated sockets', () => {
  for (const vertical of [false, true])
    for (const returning of [false, true]) {
      const sw = {
        a: { x: 2, y: 2 },
        b: { x: vertical ? 2 : 3, y: vertical ? 3 : 2 },
        duration: 0.48,
        time: 0,
        returning,
      };
      let prior = null;
      for (let i = 0; i <= 480; i++) {
        sw.time = i / 1000;
        const p = gemSwapPose(sw);
        if (Math.abs(p.a.x - p.b.x) < 33 && Math.abs(p.a.y - p.b.y) < 33)
          assert.ok(Math.abs(p.a.z - p.b.z) >= 48 - 1e-8);
        if (prior)
          for (const who of ['a', 'b'])
            assert.ok(
              Math.hypot(
                p[who].x - prior[who].x,
                p[who].y - prior[who].y,
                p[who].z - prior[who].z,
              ) < 0.4,
            );
        prior = p;
      }
    }
});

test('falling gems obey ballistic gravity and settle on the column floor', () => {
  const h = harness({ seed: 4 }),
    s = createGemState(h.env);
  swapBy(s, h.env, legalSwaps(s.board)[0], 240);
  for (let i = 0; i < 1000 && s.mode !== 'fall'; i++) stepGem(s, 1 / 240, input(), h.env);
  assert.ok(s.fall);
  const target = structuredClone(s.fall.target);
  for (let i = 0; i < 1000 && s.mode === 'fall'; i++) {
    const t = s.fall.time;
    for (const p of s.fall.particles) {
      assert.ok(Math.abs(p.y - Math.min(p.target, p.start + 340 * t * t)) < 1e-7);
      assert.ok(Number.isFinite(p.vy));
    }
    stepGem(
      s,
      1 / 240,
      input(['ArrowRight'], ['Space', 'KeyH'], { x: 139, y: 65, clicked: true }),
      h.env,
    );
  }
  assert.deepEqual(s.board, target);
});

test('a bed clears only for its own gem kind and the garden counts it', () => {
  const h = harness(),
    s = createGemState(h.env, 3);
  const beds = LEVELS[2].beds;
  const rowIndex = beds.findIndex((row) => /\d/.test(row)),
    col = beds[rowIndex].search(/\d/),
    kind = Number(beds[rowIndex][col]),
    other = (kind + 1) % 4;
  for (const [gem, expected] of [
    [other, kind],
    [kind, -1],
  ]) {
    const t = createGemState(h.env, 3);
    t.board = bareBoard();
    for (let x = 0; x < 3; x++) t.board[rowIndex][col + x] = gem;
    t.board[rowIndex][col + 3] = (gem + 1) % 6;
    t.board[rowIndex][col - 1] = (gem + 2) % 6;
    t.mode = 'clear';
    t.pending = findMatches(t.board);
    t.clearTime = 0.01;
    t.combo = 1;
    stepGem(t, 0.01, input(), h.env);
    assert.equal(t.soil[rowIndex][col], expected);
    assert.equal(t.score, 60);
  }
  assert.equal(gemObjective(s).goals[0].progress, 0);
});

test('crossing removal scores each cell once and records exact collection', () => {
  const h = harness(),
    s = createGemState(h.env, 3);
  s.board = bareBoard();
  for (const [y, x] of [
    [2, 3],
    [3, 2],
    [3, 3],
    [3, 4],
    [4, 3],
  ])
    s.board[y][x] = 2;
  s.mode = 'clear';
  s.pending = findMatches(s.board);
  s.clearTime = 0.01;
  s.combo = 2;
  stepGem(s, 0.01, input(), h.env);
  assert.equal(s.score, 200);
  assert.equal(s.levelScore, 200);
  assert.equal(s.collected[2], 5);
  assert.equal(s.mode, 'fall');
});

test('a dead board remixes by itself, for free, without awarding anything', () => {
  for (const seed of [1, 9]) {
    const h = harness({ seed }),
      s = createGemState(h.env, 3);
    s.board = bareBoard();
    s.score = 220;
    s.moves = 5;
    s.collected[1] = 4;
    const before = {
      score: s.score,
      moves: s.moves,
      collected: [...s.collected],
      soil: structuredClone(s.soil),
    };
    assert.equal(legalSwaps(s.board).length, 0);
    s.mode = 'fall';
    s.fall = { particles: [], target: s.board, time: 0, duration: 0.01 };
    stepGem(s, 0.02, input(), h.env);
    assert.equal(s.mode, 'mix-lift');
    assert.equal(s.mixes, 1);
    settle(s, h.env);
    assert.equal(s.mode, 'ready');
    assert.equal(findMatches(s.board).length, 0);
    assert.ok(legalSwaps(s.board).length);
    assert.deepEqual(
      { score: s.score, moves: s.moves, collected: s.collected, soil: s.soil },
      before,
    );
  }
});

test('the winning move opens a garden boundary, and Space, Enter or a tap starts the next garden', () => {
  const h = harness(),
    store = { value: 1, unlock: (n) => (store.value = Math.max(store.value, n)) };
  h.env.progress = { unlocked: () => store.value, unlock: store.unlock };
  for (const press of [['Space'], ['Enter'], []]) {
    const s = createGemState(h.env);
    s.levelScore = 1500 - 40;
    s.score = 1460;
    swapBy(s, h.env, legalSwaps(s.board)[0]);
    settle(s, h.env);
    assert.equal(s.mode, 'garden-clear');
    assert.equal(h.ends.length, 0);
    assert.ok(store.value >= 2);
    stepGem(s, 1 / 60, input(['ArrowRight'], ['KeyH']), h.env);
    assert.equal(s.level, 1);
    stepGem(s, 1 / 60, input([], press, press.length ? {} : { x: 1, y: 1, clicked: true }), h.env);
    assert.equal(s.level, 2);
    assert.equal(s.mode, 'ready');
    assert.equal(s.levelScore, 0);
    assert.ok(s.score >= 1460);
    assert.equal(s.moves, LEVELS[1].moves);
  }
});

test('running out of moves loses once and freezes the state', () => {
  const h = harness({ lang: 'zh' }),
    s = createGemState(h.env, 4);
  s.moves = 1;
  swapBy(s, h.env, legalSwaps(s.board)[0]);
  settle(s, h.env);
  assert.equal(s.phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /步数/);
  const frozen = structuredClone(s);
  for (let i = 0; i < 30; i++)
    stepGem(s, 1 / 60, input(['ArrowLeft'], ['Space', 'KeyH'], at({ x: 0, y: 0 })), h.env);
  assert.deepEqual(s, frozen);
  assert.equal(h.ends.length, 1);
});

test('clearing the last garden wins once with a localized message', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang }),
      s = createGemState(h.env, LEVEL_COUNT);
    s.collected.fill(99);
    s.levelScore = 99999;
    s.score = 99999;
    for (let y = 0; y < 7; y++) s.soil[y].fill(-1);
    swapBy(s, h.env, legalSwaps(s.board)[0]);
    settle(s, h.env);
    assert.equal(s.phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(h.ends[0].message, lang === 'en' ? /twenty gardens/ : /二十座/);
  }
});

test('the same active state appears at 30, 60 and 120 Hz', () => {
  const run = (hz, seconds) => {
    const h = harness({ seed: 4 }),
      s = createGemState(h.env);
    swapBy(s, h.env, legalSwaps(s.board)[0], 240);
    for (let i = 0; i < Math.round(hz * seconds); i++) stepGem(s, 1 / hz, input(), h.env);
    return s;
  };
  for (const seconds of [0.1, 0.5, 0.8, 1.2, 4]) {
    const [a, ...rest] = [30, 60, 120].map((hz) => run(hz, seconds));
    for (const s of rest) {
      assert.equal(s.mode, a.mode);
      assert.equal(s.score, a.score);
      assert.deepEqual(s.board, a.board);
      assert.ok(Math.abs(s.time - a.time) < 1e-8);
    }
  }
});

test('hostile dt and pointer values change nothing', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState(),
    sounds = h.sounds.length;
  for (const dt of [0, -1, NaN, Infinity, undefined, '1'])
    g.update(
      dt,
      input(['ArrowRight'], ['ArrowRight', 'Space', 'KeyH'], { x: 139, y: 65, clicked: true }),
    );
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, sounds);
  for (const pointer of [
    { x: NaN, y: NaN },
    { x: Infinity, y: -Infinity },
    { x: undefined, y: null },
    { x: '1e9', y: {} },
    { x: -5, y: 9999 },
  ])
    g.update(1 / 60, input([], [], { ...pointer, clicked: true }));
  const bare = { held: () => false, pressed: () => false };
  g.update(1 / 60, input([], [], press({ x: 3, y: 3 })));
  for (const pointer of [null, undefined]) g.update(1 / 60, { ...bare, pointer });
  g.update(1 / 60, bare);
  assert.equal(g.getState().moves, before.moves);
  assert.equal(g.getState().phase, 'playing');
  const t0 = g.getState().time;
  g.update(1e9, input());
  assert.ok(g.getState().time <= t0 + 1 / 30 + 1e-9);
});

test('metadata documents the controls and the host can draw every mode', () => {
  assert.equal(meta.id, 'gem-match');
  assert.ok(meta.touchControls.some((c) => c.code === 'KeyH'));
  const h = harness(),
    s = createGemState(h.env, 3);
  s.hint = legalSwaps(s.board)[0];
  const g = createGame(h.env);
  g.draw(mockContext());
  for (const mode of ['ready', 'swap', 'clear', 'fall', 'mix-lift', 'garden-clear']) {
    const t = createGemState(h.env, 3);
    t.hint = legalSwaps(t.board)[0];
    t.selected = { x: 1, y: 1 };
    t.mode = mode;
    t.pending = ['0,0'];
    t.combo = 2;
    t.swap = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, time: 0.2, duration: 0.48, returning: true };
    t.mixer = { time: 0.2, duration: 0.6 };
    t.fall = {
      particles: [{ color: 1, col: 2, row: 3, start: 10, y: 80, vy: 0, target: 150 }],
      target: t.board,
      time: 0.1,
      duration: 0.3,
    };
    const ctx = mockContext();
    assert.doesNotThrow(() => g.draw(ctx));
    assert.ok(typeof createGame(h.env).getState().status.en === 'string');
  }
});

const press = (p) => ({ ...at(p), down: true });
const hold = (p) => ({ ...at(p), down: true, clicked: false });
const release = (p) => ({ ...at(p), down: false, clicked: false });
function dragFrom(s, env, from, over, to) {
  stepGem(s, 1 / 60, input([], [], press(from)), env);
  for (let i = 0; i < 4; i++) stepGem(s, 1 / 60, input([], [], hold(over)), env);
  stepGem(s, 1 / 60, input([], [], release(to)), env);
}

test('press-drag-release onto an adjacent gem swaps like tap-tap', () => {
  const h = harness({ seed: 4 }),
    tap = createGemState(h.env),
    drag = createGemState(harness({ seed: 4 }).env),
    move = legalSwaps(tap.board)[0];
  swapBy(tap, h.env, move);
  dragFrom(drag, h.env, move.a, move.b, move.b);
  assert.equal(drag.mode, 'swap');
  assert.deepEqual(drag.swap.a, move.a);
  assert.deepEqual(drag.swap.b, move.b);
  assert.equal(drag.drag, null);
  settle(tap, h.env);
  settle(drag, h.env);
  assert.equal(drag.moves, tap.moves);
});

test('a drag past the first neighbour swaps with the neighbour in that direction', () => {
  const h = harness({ seed: 4 }),
    s = createGemState(h.env),
    from = { x: 3, y: 3 };
  for (const [over, expected] of [
    [
      { x: 6, y: 3 },
      { x: 4, y: 3 },
    ],
    [
      { x: 0, y: 3 },
      { x: 2, y: 3 },
    ],
    [
      { x: 3, y: 6 },
      { x: 3, y: 4 },
    ],
    [
      { x: 4, y: 0 },
      { x: 3, y: 2 },
    ],
  ]) {
    const t = createGemState(harness({ seed: 4 }).env);
    dragFrom(t, h.env, from, over, over);
    assert.deepEqual(t.swap ? [t.swap.a, t.swap.b] : null, [from, expected]);
  }
  assert.equal(s.mode, 'ready');
});

test('a drag that ends on the pressed gem, leaves the board or hits the edge just selects it', () => {
  const h = harness({ seed: 4 }),
    from = { x: 3, y: 3 };
  for (const [to, selected] of [
    [at(from), from],
    [{ x: NaN, y: NaN }, from],
  ]) {
    const s = createGemState(h.env);
    stepGem(s, 1 / 60, input([], [], press(from)), h.env);
    stepGem(s, 1 / 60, input([], [], { x: to.x, y: to.y, down: false }), h.env);
    assert.equal(s.mode, 'ready');
    assert.equal(s.moves, LEVELS[0].moves);
    assert.deepEqual(s.selected, selected);
    assert.equal(s.drag, null);
  }
  const edge = createGemState(h.env),
    corner = { x: 0, y: 0 };
  dragFrom(edge, h.env, corner, { x: -1, y: 0 }, { x: -1, y: 0 });
  assert.equal(edge.mode, 'ready');
  assert.deepEqual(edge.selected, corner);
  const back = createGemState(h.env);
  stepGem(back, 1 / 60, input([], [], press(from)), h.env);
  stepGem(back, 1 / 60, input([], [], release(from)), h.env);
  assert.deepEqual(back.selected, from);
  stepGem(back, 1 / 60, input([], [], press(from)), h.env);
  stepGem(back, 1 / 60, input([], [], hold({ x: 4, y: 3 })), h.env);
  stepGem(back, 1 / 60, input([], [], release({ x: 4, y: 3 })), h.env);
  assert.equal(back.mode, 'swap');
});

test('dragging is deterministic across frame rates and a tap still needs two taps', () => {
  const run = (hz) => {
    const h = harness({ seed: 4 }),
      s = createGemState(h.env),
      move = legalSwaps(s.board)[0];
    stepGem(s, 1 / hz, input([], [], press(move.a)), h.env);
    for (let i = 0; i < hz / 10; i++) stepGem(s, 1 / hz, input([], [], hold(move.b)), h.env);
    stepGem(s, 1 / hz, input([], [], release(move.b)), h.env);
    for (let i = 0; i < hz * 4; i++) stepGem(s, 1 / hz, input(), h.env);
    return s;
  };
  const [a, b, c] = [30, 60, 120].map(run);
  assert.deepEqual(a.board, b.board);
  assert.deepEqual(b.board, c.board);
  assert.equal(a.score, c.score);
  const h = harness(),
    s = createGemState(h.env);
  stepGem(s, 1 / 60, input([], [], at({ x: 2, y: 2 })), h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.drag, null);
});

test('every gem kind has its own silhouette and beds name their wanted gem by shape', async () => {
  const { drawGame } = await import('../src/games/gem-match-draw.js'),
    shapes = new Set(),
    h = harness();
  for (let kind = 0; kind < 6; kind++) {
    const rects = [],
      ctx = mockContext();
    ctx.fillRect = (x, y, w, hh) => rects.push([x, y, w, hh].join());
    const s = createGemState(h.env, 3);
    s.soil[0][0] = kind;
    s.board = bareBoard();
    s.board[3][3] = kind;
    drawGame(ctx, s, h.env);
    shapes.add(rects.join('|'));
  }
  assert.equal(shapes.size, 6);
  const glyphs = new Set();
  for (let kind = 0; kind < 4; kind++) {
    const rects = [],
      ctx = mockContext();
    ctx.fillRect = (x, y, w, hh) => {
      if (w === 1 && hh === 1 && x >= 122 && x < 133 && y >= 48 && y < 59)
        rects.push(`${x - 122},${y - 48}`);
    };
    const s = createGemState(h.env, 3);
    s.soil = noSoil();
    s.soil[0][0] = kind;
    drawGame(ctx, s, h.env);
    glyphs.add(rects.join('|'));
    assert.ok(rects.length > 15);
  }
  assert.equal(glyphs.size, 4);
});
