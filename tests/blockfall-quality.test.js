import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  turnPiece,
  rotatePiece,
  SHAPES,
  canPlace,
  clearRows,
  createBlockState,
  stepBlock,
  meta,
  LEVELS,
  LEVEL_COUNT,
} from '../src/games/blockfall.js';
import { goalLabel, textWidth, wrapText } from '../src/games/blockfall-text.js';
import { TIP_BOX, drawGame } from '../src/games/blockfall-draw.js';
import { menuCell } from '../src/games/blockfall-menu.js';
import { harness, input, mockContext, seeded } from './harness.js';

const step = (g, code) => g.update(1 / 60, input([], code ? [code] : []));
const store = (unlocked, unlock = () => {}) => ({ unlocked: () => unlocked, unlock });
/** A game whose harness reports `unlocked` levels; level > 1 opens the level select first. */
function open(
  level = 1,
  { seed = 1, lang = 'en', progress = store(level), hz = 60, enter = true } = {},
) {
  const h = harness({ seed, lang });
  h.env.progress = progress;
  const game = createGame(h.env);
  if (level > 1 && enter) game.update(1 / hz, input([], ['Space']));
  return { game, ...h };
}
/** A game that is past its reading pause and ready for input. */
function started(options) {
  const { game } = open(1, options);
  for (let n = 0; n < 150; n++) game.update(1 / 60, input());
  return game;
}
function fresh(seed, level = 1) {
  const s = createBlockState(seed, level);
  s.ready = 0;
  return s;
}
const pieceAt = (name, x, y, rotated = false) => ({
  name,
  matrix: rotated ? rotatePiece(SHAPES[name]) : SHAPES[name].map((r) => r.slice()),
  rotation: rotated ? 1 : 0,
  x,
  y,
});
const cells = (board) => board.flat().filter(Boolean).length;

// ---- A reaction-limited bot that sees only getState() snapshots from `delay` seconds ago.
const heights = (b) =>
  Array.from({ length: 10 }, (_, c) => {
    for (let r = 0; r < 20; r++) if (b[r][c]) return 20 - r;
    return 0;
  });
function evaluate(board, cleared, goal, columns) {
  const b = cleared.board,
    h = heights(b),
    ph = heights(board);
  let holes = 0;
  for (let c = 0; c < 10; c++) {
    let seen = false;
    for (let r = 0; r < 20; r++) {
      if (b[r][c]) seen = true;
      else if (seen) holes++;
    }
  }
  const bump = h.slice(1).reduce((sum, v, i) => sum + Math.abs(v - h[i]), 0);
  let v = -0.7 * h.reduce((a, c) => a + c, 0) - 10 * holes - 0.4 * bump - 1.2 * Math.max(...h);
  if (goal.kind === 'lines') return v + 80 * cleared.count;
  if (goal.kind === 'rubble')
    return v + 40 * cleared.count - 6 * b.flat().filter((x) => x === 8).length;
  if (cleared.count >= goal.n) return v + 5000;
  if (cleared.count > 0) v -= 300;
  for (const c of columns) {
    const left = c === 0 ? 99 : ph[c - 1],
      right = c === 9 ? 99 : ph[c + 1];
    if (ph[c] <= Math.min(left, right) - 3) v -= 400;
  }
  return v;
}
function placements(board, piece) {
  const out = [];
  let p = piece;
  for (let r = 0; r < 4 && (r === 0 || piece.name !== 'O'); r++) {
    if (r) {
      const turned = turnPiece(board, p, true);
      if (turned === p) break;
      p = turned;
    }
    const xs = [p.x];
    for (const d of [-1, 1])
      for (let x = p.x; canPlace(board, p.matrix, x + d, p.y); x += d) xs.push(x + d);
    for (const x of xs) {
      let y = p.y;
      while (canPlace(board, p.matrix, x, y + 1)) y++;
      out.push({ r, x, y, p, dx: x - piece.x });
    }
  }
  return out;
}
function spawnPiece(name) {
  return pieceAt(name, Math.floor((10 - SHAPES[name].length) / 2), 0);
}
function bestFor(board, piece, goal, next) {
  let best = null;
  for (const pl of placements(board, piece)) {
    const b = board.map((r) => r.slice()),
      columns = new Set();
    pl.p.matrix.forEach((row, py) =>
      row.forEach((v, px) => {
        if (!v) return;
        b[pl.y + py][pl.x + px] = v;
        columns.add(pl.x + px);
      }),
    );
    const cleared = clearRows(b);
    let value = evaluate(board, cleared, goal, columns);
    const finished = goal.kind === 'burst' && cleared.count >= goal.n;
    if (next && !finished)
      value += 0.6 * (bestFor(cleared.board, spawnPiece(next), goal)?.value ?? 0);
    if (!best || value > best.value) best = { ...pl, value };
  }
  return best;
}
function plan(view) {
  const goal = view.objective.goal,
    own = bestFor(view.board, view.piece, goal, view.preview[0]),
    name = view.holdUsed ? null : (view.hold ?? view.preview[0]),
    held =
      name &&
      bestFor(view.board, spawnPiece(name), goal, view.hold ? view.preview[0] : view.preview[1]);
  if (held && held.value > own.value + 4) return { hold: true };
  const side = own.dx < 0 ? 'ArrowLeft' : 'ArrowRight';
  return {
    cmds: [...Array(own.r).fill('ArrowUp'), ...Array(Math.abs(own.dx)).fill(side)],
    target: { x: own.x, rotation: own.r },
  };
}
/** Plays `level` with a bot whose view of the game is `delay` seconds old. */
function runBot({
  level,
  seed = 1,
  hz = 60,
  delay = 0.25,
  maxTime = 200,
  game = open(level, { seed, hz }).game,
}) {
  const views = [];
  let now = 0,
    key = null,
    current = null,
    cmds = [],
    lastCmd = -1,
    doneAt = -1;
  while (now < maxTime) {
    const st = game.getState();
    if (st.phase !== 'playing' || st.level > level || st.litTimer > 0)
      return {
        won: st.phase === 'won' || st.level > level || st.litTimer > 0,
        state: st,
        time: now,
      };
    views.push({ t: now, st });
    while (views.length > 2 && views[1].t <= now - delay) views.shift();
    const view = views[0].t <= now - delay + 1e-9 ? views[0].st : null;
    const press = [];
    if (view?.piece && view.ready <= 0 && !view.clearTimer) {
      const id = `${view.locks}|${view.piece.name}|${view.hold}|${view.retries}|${view.holdUsed}`;
      if (id !== key || (current && doneAt > 0 && now - doneAt > delay + 0.25)) {
        key = id;
        current = plan(view);
        cmds = current.hold ? ['KeyC'] : [...current.cmds];
        doneAt = -1;
        lastCmd = now - 1;
      }
      if (cmds.length && now - lastCmd >= 0.05 - 1e-9) {
        press.push(cmds.shift());
        lastCmd = now;
        if (!cmds.length) doneAt = now;
      } else if (current && !cmds.length && !current.hold && doneAt > 0) {
        const t = current.target;
        if (view.piece.x === t.x && view.piece.rotation === t.rotation) {
          press.push('Space');
          current = null;
        }
      }
    }
    game.update(1 / hz, input([], press));
    now += 1 / hz;
  }
  return { won: false, state: game.getState(), time: now };
}

// ---- Level data
test('Blockfall ships 20 frozen, bilingual, data-driven levels with a rising curve', () => {
  assert.equal(LEVEL_COUNT, 20);
  const kinds = new Set(LEVELS.map((l) => l.goal.kind)),
    names = new Set(LEVELS.map((l) => l.name.en));
  assert.deepEqual([...kinds].sort(), ['burst', 'lines', 'rubble']);
  assert.equal(names.size, 20);
  assert.ok(LEVELS.some((l) => l.queue));
  assert.ok(LEVELS[19].interval < LEVELS[0].interval);
  LEVELS.forEach((level, i) => {
    assert.ok(Object.isFrozen(level) && Object.isFrozen(level.rows), `level ${i + 1}`);
    for (const text of [level.name, level.tip]) {
      assert.ok(text.en.length > 3);
      assert.match(text.zh, /\p{Script=Han}/u);
    }
    assert.ok(level.rows.length <= 8 && level.rows.every((r) => /^[.#x]{10}$/.test(r)));
    assert.ok(
      level.rows.every((r) => r.includes('.')),
      'no preset row is already full',
    );
    if (level.queue) assert.match(level.queue, /^[IOTSZJL]{6,}$/);
    if (level.goal.kind === 'rubble')
      assert.ok(level.rows.join('').includes('x'), 'a rubble goal needs marked rubble');
  });
});
test('Blockfall tips state facts that match each level definition', () => {
  const rows = (i) => LEVELS[i - 1].rows,
    facts = {
      2: [/two-wide gap on the left/, /左边两格宽/, rows(2)[0].startsWith('..#')],
      3: [/four rows/, /四行/, LEVELS[2].goal.n === 4 && rows(3).length === 4],
      5: [/four-wide gap/, /四格宽/, rows(5)[0].includes('#....#')],
      8: [/six lines/, /六行/, LEVELS[7].goal.n === 6],
      10: [/six deep.*four rows/, /深六格.*四行/, rows(10).length === 6 && LEVELS[9].goal.n === 4],
      11: [/eleven pieces/, /十一个/, LEVELS[10].queue.length === 11],
      12: [
        /three rows.*second column/,
        /第二列.*三行/,
        LEVELS[11].goal.n === 3 && rows(12)[0][1] === '.',
      ],
      13: [
        /Six marked rows/,
        /六个标记行/,
        rows(13).length === 6 && rows(13).every((r) => r.split('.').length === 2),
      ],
      14: [/Five lines/, /五行/, LEVELS[13].goal.n === 5],
      15: [
        /fourth column, seven rows/,
        /第四列.*七格/,
        rows(15).length === 7 && rows(15)[0][3] === '.',
      ],
      16: [
        /Eight marked rows/,
        /八个标记行/,
        rows(16).length === 8 && rows(16).every((r) => r.split('.').length === 2),
      ],
      17: [/Six lines/, /六行/, LEVELS[16].goal.n === 6],
      19: [/Ten lines/, /十行/, LEVELS[18].goal.n === 10],
      20: [/eight-row wall/, /八行高墙/, rows(20).length === 8 && LEVELS[19].goal.kind === 'burst'],
    };
  for (const [n, [en, zh, data]] of Object.entries(facts)) {
    assert.match(LEVELS[n - 1].tip.en, en, `level ${n}`);
    assert.match(LEVELS[n - 1].tip.zh, zh, `level ${n}`);
    assert.ok(data, `level ${n} data`);
  }
});
test('Blockfall every level starts with a clear spawn zone and a legal first piece', () => {
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const s = createBlockState(n, n);
    assert.equal(s.phase, 'playing');
    assert.ok(
      s.board.slice(0, 8).every((r) => r.every((v) => !v)),
      `level ${n}`,
    );
    assert.ok(canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y));
    assert.equal(s.level, n);
  }
  assert.equal(createBlockState(1, 'junk').level, 1);
  assert.equal(createBlockState(1, 99).level, LEVEL_COUNT);
  assert.equal(createBlockState(1, -4).level, 1);
});

// ---- Fair start
test('Blockfall level 1 gives a reading pause and an idle player survives the opening', () => {
  const { game } = open(1),
    start = game.getState();
  assert.ok(start.ready > 2);
  for (let n = 0; n < 120; n++)
    game.update(1 / 60, input(['ArrowLeft'], ['Space', 'ArrowUp', 'KeyC']));
  const waiting = game.getState();
  assert.equal(waiting.piece.y, 0);
  assert.equal(waiting.piece.x, start.piece.x);
  assert.equal(waiting.locks, 0);
  assert.equal(waiting.hold, null);
  for (let n = 0; n < 60 * 20; n++) game.update(1 / 60, input());
  const idle = game.getState();
  assert.equal(idle.phase, 'playing');
  assert.ok(idle.locks >= 1);
  assert.equal(idle.retries, 0);
});

// ---- Every level clears with public input only
for (const [hz, delay] of [
  [30, 0.35],
  [60, 0.25],
  [60, 0.35],
  [120, 0.25],
  [120, 0.35],
  [30, 0.25],
])
  test(`Blockfall a reaction-limited bot clears all 20 levels (${hz} Hz, ${delay}s delay)`, () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const r = runBot({ level, seed: level, hz, delay });
      assert.ok(
        r.won,
        `level ${level} ${r.state.phase} ${r.state.reason} at ${r.time.toFixed(0)}s`,
      );
      assert.ok(r.time < 90, `level ${level} took ${r.time.toFixed(0)}s`);
    }
  });
// ---- No blind wins
const KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyZ',
  'KeyC',
  'Space',
  'KeyX',
  'KeyA',
  'KeyD',
  'ShiftLeft',
];
const alternating = (period, dropEvery, extra) => () => (n, hz) => {
  const dir = Math.floor(n / hz / period) % 2 ? 'ArrowLeft' : 'ArrowRight',
    every = (s) => n % Math.round(s * hz) === 0,
    pressed = [];
  if (every(dropEvery)) pressed.push('Space');
  if (extra && every(0.4)) pressed.push(extra);
  return input([dir], pressed);
};
const BLIND = {
  idle: () => () => input(),
  mash: (seed) => {
    const r = seeded(seed + 100);
    return () => {
      const keys = KEYS.filter(() => r() < 0.3);
      return input(keys, keys);
    };
  },
  random: (seed) => {
    const r = seeded(seed + 200);
    return (n, hz) =>
      n % Math.round(hz / 6) === 0 ? input([], [KEYS[Math.floor(r() * KEYS.length)]]) : input();
  },
  slow: alternating(1.5, 1.2),
  medium: alternating(0.7, 0.5),
  fast: alternating(0.3, 0.5),
  turning: alternating(0.7, 0.9, 'ArrowUp'),
  holding: alternating(0.5, 0.6, 'KeyC'),
};
test('Blockfall idle, mashing, random keys and timed patterns win at most a quarter of any level from level 3', () => {
  const hz = 60,
    seeds = [1, 2];
  for (let level = 3; level <= LEVEL_COUNT; level++) {
    let wins = 0,
      runs = 0;
    for (const make of Object.values(BLIND))
      for (const seed of seeds) {
        const { game } = open(level, { seed }),
          policy = make(seed);
        runs++;
        for (let n = 0; n < 60 * hz; n++) {
          game.update(1 / hz, policy(n, hz));
          const s = game.getState();
          if (s.level > level || s.litTimer > 0) wins++;
          if (s.phase !== 'playing' || s.level > level || s.litTimer > 0) break;
        }
      }
    assert.ok(wins <= runs * 0.25, `level ${level}: ${wins}/${runs} blind wins`);
  }
});

// ---- Goals, supply and progress
test('Blockfall a lines goal completes its level, unlocks the next and starts it after a pause', () => {
  const s = fresh(5, 1);
  s.levelLines = 3;
  s.board[19] = Array(10).fill(9);
  s.board[19][4] = s.board[19][5] = 0;
  s.injected = 8;
  s.piece = pieceAt('O', 4, 18);
  stepBlock(s, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30 && !s.litTimer; n++) stepBlock(s, 1 / 60, input());
  assert.ok(s.litTimer > 0 && s.level === 1 && s.piece === null);
  for (let n = 0; n < 60; n++) stepBlock(s, 1 / 60, input());
  assert.equal(s.level, 2);
  assert.ok(s.ready > 0 && s.piece.y === 0);
  assert.equal(s.levelLines, 0);
  assert.equal(cells(s.board), s.injected + s.placed - s.removed - s.discarded);
});
test('Blockfall a burst goal needs one clear of the full size', () => {
  const partial = fresh(5, 3);
  partial.board[16] = Array(10).fill(0);
  partial.board[17] = Array(10).fill(0);
  partial.piece = pieceAt('I', 7, 0, true);
  stepBlock(partial, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30; n++) stepBlock(partial, 1 / 60, input());
  assert.equal(partial.lines, 2);
  assert.equal(partial.litTimer, 0);
  assert.equal(partial.level, 3);
  assert.ok(partial.piece);
  const full = fresh(5, 3);
  full.piece = pieceAt('I', 7, 0, true);
  stepBlock(full, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30; n++) stepBlock(full, 1 / 60, input());
  assert.equal(full.lines, 4);
  assert.ok(full.litTimer > 0);
  assert.equal(full.score, 800 * 3 + 2 * 16);
});
test('Blockfall a rubble goal ends only when the last marked cell is gone', () => {
  const s = fresh(5, 4);
  s.piece = pieceAt('T', 7, 0);
  stepBlock(s, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30; n++) stepBlock(s, 1 / 60, input());
  assert.equal(s.lines, 1);
  assert.equal(s.litTimer, 0);
  assert.ok(s.board.flat().includes(8));
  s.board[19] = [8, 8, 8, 8, 8, 8, 8, 0, 0, 0];
  s.piece = pieceAt('T', 7, 0);
  stepBlock(s, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30; n++) stepBlock(s, 1 / 60, input());
  assert.ok(!s.board.flat().includes(8) && s.litTimer > 0);
});
test('Blockfall clearing the final burst wins the game', () => {
  const s = fresh(5, 20);
  s.piece = pieceAt('I', 5, 0, true);
  stepBlock(s, 1 / 60, input([], ['Space']));
  for (let n = 0; n < 30; n++) stepBlock(s, 1 / 60, input());
  assert.equal(s.phase, 'won');
});
test('Blockfall a limited supply counts down, uses the held piece last and then runs out', () => {
  const s = fresh(2, 6);
  assert.deepEqual([s.piece.name, ...s.preview, ...s.supply].join(''), LEVELS[5].queue);
  const hold = fresh(2, 6);
  hold.supply = [];
  hold.preview = [];
  stepBlock(hold, 1 / 60, input([], ['KeyC']));
  assert.equal(hold.hold, null, 'nothing to swap with');
  hold.hold = 'T';
  stepBlock(hold, 1 / 60, input([], ['Space']));
  assert.equal(hold.piece.name, 'T');
  assert.equal(hold.hold, null);
  stepBlock(hold, 1 / 60, input([], ['Space']));
  assert.equal(hold.phase, 'lost');
  assert.equal(hold.reason, 'supply');
  assert.equal(hold.piece, null);
  const kept = fresh(2, 6);
  stepBlock(kept, 1 / 60, input([], ['Space']));
  const before = structuredClone(kept);
  stepBlock(kept, 1 / 60, input(['ArrowLeft'], ['KeyX']));
  assert.equal(kept.retries, 1);
  assert.equal(kept.locks, 0);
  assert.notDeepEqual(kept.supply, before.supply);
  assert.deepEqual([kept.piece.name, ...kept.preview, ...kept.supply].join(''), LEVELS[5].queue);
});
test('Blockfall the level select opens at the saved level, clamps junk and starts the chosen level', () => {
  const { game, sounds: heard } = open(5, { enter: false });
  let st = game.getState();
  assert.deepEqual([st.menu.cursor, st.menu.total, st.unlocked], [5, 20, 5]);
  assert.match(st.status.en, /Choose a district/);
  assert.match(st.status.zh, /选择城区/);
  game.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(game.getState().menu.cursor, 5);
  game.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(game.getState().menu.cursor, 4);
  game.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(game.getState().menu.cursor, 1, 'moving up a row clamps to level 1');
  game.update(1 / 60, input([], ['KeyS']));
  assert.equal(game.getState().menu.cursor, 5, 'moving down a row clamps to the unlocked level');
  game.update(1 / 60, input([], ['KeyA']));
  game.update(1 / 60, input([], ['KeyD']));
  game.update(1 / 60, input([], ['KeyW']));
  game.draw(mockContext());
  assert.ok(heard.includes('move'));
  const cell = menuCell(2);
  game.update(1 / 60, input([], [], { x: cell.x + 3, y: cell.y + 3, clicked: true }));
  st = game.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 2);
  const locked = open(3, { enter: false });
  const far = menuCell(9);
  locked.game.update(1 / 60, input([], [], { x: far.x + 3, y: far.y + 3, clicked: true }));
  assert.ok(locked.sounds.includes('hit'));
  assert.equal(locked.game.getState().menu.cursor, 3);
  locked.game.update(1 / 60, input([], ['Enter']));
  assert.equal(locked.game.getState().level, 3);
});
test('Blockfall progress reads junk stores safely and a clear unlocks the next level once', () => {
  const expected = [
    [NaN, 1],
    [-5, 1],
    [0, 1],
    [1.9, 1],
    ['7', 7],
    [null, 1],
    [undefined, 1],
    [Infinity, 1],
    [99, 20],
    [{}, 1],
    [[], 1],
    ['abc', 1],
    [true, 1],
  ];
  for (const [value, level] of expected) {
    const { game } = open(1, { progress: { unlocked: () => value, unlock() {} } });
    assert.equal(game.getState().unlocked, level, String(value));
    assert.equal(game.getState().menu !== null, level > 1);
  }
  for (const progress of [
    undefined,
    { unlocked: () => 1 },
    {
      unlocked() {
        throw new Error('boom');
      },
      unlock() {
        throw new Error('boom');
      },
    },
  ]) {
    const { game } = open(1, { progress });
    assert.equal(game.getState().unlocked, 1);
    assert.equal(game.getState().menu, null);
    const r = runBot({ level: 1, game, delay: 0 }).won;
    assert.ok(r, 'a throwing or missing store never stops play');
  }
  const calls = [];
  const { game } = open(1, { progress: store(1, (n) => calls.push(n)) });
  assert.ok(runBot({ level: 1, game, delay: 0 }).won);
  assert.deepEqual(calls, [2]);
  assert.equal(game.getState().unlocked, 2);
});

// ---- Hostile input
test('Blockfall hostile frame times and pointers never corrupt the state', () => {
  const { game } = open(4, { enter: false });
  for (const pointer of [
    { x: NaN, y: NaN, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: 'a', y: {}, clicked: true },
    null,
    undefined,
  ]) {
    const controls = input([], []);
    controls.pointer = pointer;
    game.update(1 / 60, controls);
  }
  assert.equal(game.getState().menu.cursor, 4);
  game.update(1 / 60, input([], ['Space']));
  const g = started();
  for (const dt of [0, -1, NaN, Infinity, -Infinity, '1', null, undefined, 1e9, 5, 1e-12]) {
    const t = g.getState().time;
    g.update(dt, input(['ArrowLeft', 'ArrowDown'], ['KeyC']));
    const s = g.getState();
    assert.ok(Number.isFinite(s.time) && s.time - t <= 1 / 30 + 1e-9);
    assert.ok(s.board.length === 20 && Number.isFinite(s.score));
  }
  const controls = input([], ['Space']);
  controls.pointer = { x: NaN, y: NaN, down: true, clicked: true };
  g.update(1 / 60, controls);
  g.draw(mockContext());
  assert.ok(Number.isFinite(g.getState().time));
});

// ---- Frame-rate determinism
test('Blockfall identical timed input gives the same board at 30, 60 and 120 Hz', () => {
  const play = (hz) => {
    const { game } = open(2, { seed: 4, hz }),
      frames = 24 * hz;
    for (let n = 0; n < frames; n++) {
      const t = n / hz,
        every = (p) => Math.abs(t / p - Math.round(t / p)) < 1e-6;
      const pressed = [];
      if (every(0.5)) pressed.push(Math.round(t / 0.5) % 2 ? 'ArrowLeft' : 'ArrowRight');
      if (every(1.5)) pressed.push('Space');
      game.update(1 / hz, input([], pressed));
    }
    const s = game.getState();
    return {
      board: s.board,
      locks: s.locks,
      score: s.score,
      piece: s.piece.name,
      level: s.level,
      lines: s.lines,
    };
  };
  const base = play(60);
  assert.ok(base.locks >= 8);
  assert.deepEqual(play(30), base);
  assert.deepEqual(play(120), base);
});

// ---- End messages
test('Blockfall reports a roof loss, a supply loss and a win exactly once in English and Chinese', () => {
  for (const lang of ['en', 'zh']) {
    const roof = open(1, { lang });
    for (let n = 0; n < 60 * 60 && roof.game.getState().phase === 'playing'; n++)
      roof.game.update(1 / 60, input([], ['Space']));
    assert.equal(roof.ends.length, 1);
    assert.equal(roof.game.getState().reason, 'roof');
    assert.match(
      roof.ends[0].message,
      lang === 'en' ? /District 1: The well reached the roof/ : /第1区：方块已堆到井顶/,
    );
    const supply = open(6, { lang });
    for (let n = 0; n < 60 * 90 && supply.game.getState().phase === 'playing'; n++)
      supply.game.update(1 / 60, input([], n % 20 === 0 ? ['Space'] : []));
    assert.equal(supply.ends.length, 1);
    assert.equal(supply.game.getState().reason, 'supply');
    assert.match(supply.ends[0].message, lang === 'en' ? /pieces ran out/ : /方块用完了/);
    assert.equal(supply.ends[0].won, false);
    assert.ok(supply.sounds.includes('lose'));
  }
  const calls = [];
  const win = open(20, { lang: 'zh', progress: store(20, (n) => calls.push(n)) });
  assert.ok(runBot({ level: 20, game: win.game, delay: 0.25 }).won);
  const final = win.game.getState();
  assert.equal(final.phase, 'won');
  assert.equal(win.ends.length, 1);
  assert.equal(win.ends[0].won, true);
  assert.match(win.ends[0].message, /20个城区全部供电/);
  assert.deepEqual(calls, []);
  for (let n = 0; n < 20; n++)
    win.game.update(1 / 60, input(['ArrowDown'], ['Space', 'KeyX', 'KeyC']));
  assert.deepEqual(win.game.getState(), final);
  assert.equal(win.ends.length, 1);
  assert.ok(win.sounds.includes('win'));
});

// ---- Text fits the 480x320 canvas
function drawnText(game) {
  const out = [],
    ctx = mockContext();
  ctx.fillText = (value, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)[1]);
    out.push({ value, x, y, size, width: textWidth(String(value), size), align: ctx.textAlign });
  };
  game.draw(ctx);
  return out;
}
test('Blockfall English and Chinese text for every level and the level select fits the canvas', () => {
  for (const lang of ['en', 'zh']) {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const l = LEVELS[level - 1],
        tip = l.tip[lang];
      const wrapped = wrapText(tip, TIP_BOX.width, TIP_BOX.size);
      assert.ok(wrapped.length <= TIP_BOX.lines, `${lang} tip ${level} ${wrapped.length} lines`);
      assert.ok(wrapped.every((line) => textWidth(line, TIP_BOX.size) <= TIP_BOX.width + 1e-6));
      assert.equal(wrapped.join('').replace(/\s/g, ''), tip.replace(/\s/g, ''));
      assert.ok(wrapText(tip, 444, 12).length <= 2, `${lang} menu tip ${level}`);
      const { game } = open(level, { lang });
      if (level > 1) {
        const menuCells = drawnText(game);
        for (const t of menuCells) {
          const left =
            t.align === 'center' ? t.x - t.width / 2 : t.align === 'right' ? t.x - t.width : t.x;
          assert.ok(
            left >= 0 && left + t.width <= 480 && t.y + t.size <= 320,
            `${lang} menu ${t.value}`,
          );
        }
        game.update(1 / 60, input([], ['Space']));
      }
      for (let phase = 0; phase < 2; phase++) {
        for (const t of drawnText(game)) {
          const left = t.align === 'center' ? t.x - t.width / 2 : t.x;
          assert.ok(
            left >= 0 && left + t.width <= 480 && t.y + t.size <= 320,
            `${lang} ${level} ${t.value}`,
          );
          if (t.x < 150) assert.ok(left + t.width <= 146, `${lang} left panel ${level} ${t.value}`);
          if (t.x >= 325)
            assert.ok(left + t.width <= 468, `${lang} right panel ${level} ${t.value}`);
        }
        for (let n = 0; n < 150; n++) game.update(1 / 60, input());
      }
      assert.ok(textWidth(goalLabel(l)[lang === 'en' ? 0 : 1], 12) <= 128);
    }
  }
});
test('Blockfall the district-lit banner and the ready hint are drawn in both languages', () => {
  for (const [lang, lit, ready] of [
    ['en', 'DISTRICT LIT', 'GET READY'],
    ['zh', '城区已点亮', '准备'],
  ]) {
    const env = harness({ lang }).env,
      s = createBlockState(1, 1);
    const seen = () => {
      const ctx = mockContext(),
        out = [];
      ctx.fillText = (v) => out.push(v);
      drawGame(ctx, s, env);
      return out;
    };
    assert.ok(seen().includes(ready));
    assert.ok(!seen().includes(lit));
    s.ready = 0;
    s.litTimer = 0.5;
    s.piece = null;
    assert.ok(seen().includes(lit));
  }
});
test('Blockfall touch controls cover every gameplay and level-select action', () => {
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyZ',
    'Space',
    'KeyC',
    'KeyX',
  ]) {
    const c = meta.touchControls.find((c) => c.code === code);
    assert.ok(c && c.label.en && /\p{Script=Han}/u.test(c.label.zh), code);
  }
  assert.ok(meta.keys.some((k) => /start/i.test(k.label.en)));
});

test('Blockfall hold preserves the queue and is available once per locked piece', () => {
  const g = started(),
    a = g.getState();
  assert.equal(a.preview.length, 3);
  step(g, 'KeyC');
  const b = g.getState();
  assert.equal(b.hold, a.piece.name);
  assert.equal(b.piece.name, a.preview[0]);
  step(g, 'KeyC');
  assert.equal(g.getState().piece.name, b.piece.name);
  step(g, 'Space');
  const c = g.getState();
  step(g, 'KeyC');
  assert.equal(g.getState().piece.name, a.piece.name);
  assert.equal(g.getState().hold, c.piece.name);
});
test('Blockfall grounded pieces allow a half second adjustment before locking', () => {
  const g = started();
  for (let i = 0; i < 3000 && !g.getState().grounded; i++) step(g);
  assert.equal(g.getState().grounded, true);
  const name = g.getState().piece.name;
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(g.getState().board.flat().filter(Boolean).length, 0);
  step(g, 'ArrowLeft');
  assert.equal(g.getState().piece.name, name);
  for (let i = 0; i < 40; i++) step(g);
  assert.equal(g.getState().board.flat().filter(Boolean).length, 4);
});

test('Blockfall seven-piece bags give every shape once in each group and no snapshot aliases', () => {
  const g = started({ seed: 7 }),
    names = [];
  for (let i = 0; i < 7; i++) {
    names.push(g.getState().piece.name);
    step(g, 'Space');
  }
  assert.equal(new Set(names).size, 7);
  const snapshot = g.getState();
  snapshot.board[19][0] = 999;
  assert.notEqual(g.getState().board[19][0], 999);
});
test('Blockfall gravity and locking agree at 60 and 120 Hz', () => {
  const play = (fps) => {
    const g = started({ seed: 8 });
    for (let i = 0; i < fps * 8; i++) g.update(1 / fps, input());
    return g.getState();
  };
  const a = play(60),
    b = play(120);
  assert.deepEqual(a.board, b.board);
  assert.equal(a.piece.y, b.piece.y);
});

test('Blockfall long-piece pivot kicks away from the left wall and off the floor', () => {
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  const vertical = { name: 'I', matrix: rotatePiece(SHAPES.I), rotation: 1, x: -2, y: 0 };
  assert.ok(canPlace(board, vertical.matrix, vertical.x, vertical.y));
  const horizontal = turnPiece(board, vertical, true);
  assert.notEqual(horizontal, vertical);
  assert.equal(horizontal.rotation, 2);
  assert.ok(horizontal.x >= 0);
  const floor = { name: 'T', matrix: SHAPES.T, rotation: 0, x: 4, y: 18 };
  const turned = turnPiece(board, floor, true);
  assert.notEqual(turned, floor);
  assert.ok(turned.y < 18);
  assert.ok(canPlace(board, turned.matrix, turned.x, turned.y));
});

test('Blockfall zero, negative and non-finite updates preserve every field and consume no input/resources', () => {
  const h = harness(),
    g = createGame(h.env),
    before = structuredClone(g.getState());
  for (const dt of [0, -1, NaN, Infinity])
    g.update(dt, input(['ArrowLeft', 'ArrowDown'], ['ArrowUp', 'KeyC', 'Space']));
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});
test('Blockfall simultaneous opposing directions cancel even at a wall and never restart repeat', () => {
  const g = started();
  for (let n = 0; n < 8; n++) step(g, 'ArrowLeft');
  const x = g.getState().piece.x;
  for (let n = 0; n < 60; n++)
    g.update(1 / 120, input(['ArrowLeft', 'ArrowRight'], ['ArrowLeft', 'ArrowRight']));
  assert.equal(g.getState().piece.x, x);
});
test('Blockfall floor kicks cannot indefinitely delay locking or farm repeated downward score', () => {
  const g = started({ seed: 8 });
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  const score = g.getState().score;
  for (
    let n = 0;
    n < 5000 &&
    g
      .getState()
      .board.flat()
      .every((v) => !v);
    n++
  )
    g.update(
      1 / 120,
      input(['ArrowDown'], g.getState().grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []),
    );
  assert.ok(g.getState().board.flat().some(Boolean));
  assert.ok(g.getState().score - score < 100);
});

test('Blockfall rejected or successful hold still advances the frame clock and gravity', () => {
  const g = started();
  step(g, 'KeyC');
  const start = g.getState();
  for (let n = 0; n < 120; n++) g.update(1 / 120, input([], ['KeyC']));
  const end = g.getState();
  assert.ok(Math.abs(end.time - start.time - 1) < 1e-7);
  assert.ok(end.piece.y > start.piece.y);
});

test('Blockfall Retry X restores the random stream across three bags and clears held/discrete actions', () => {
  const s = fresh(77),
    initial = structuredClone(s),
    names = () => {
      const out = [];
      for (let n = 0; n < 24; n++) {
        out.push(s.piece.name);
        s.board = Array.from({ length: 20 }, () => Array(10).fill(0));
        stepBlock(s, 1 / 120, input([], ['Space']));
      }
      return out;
    },
    first = names();
  stepBlock(s, 1 / 120, input(['ArrowLeft', 'ArrowDown'], ['KeyX', 'Space', 'KeyC']));
  assert.equal(s.score, initial.score);
  assert.deepEqual(s.board, initial.board);
  assert.deepEqual(s.piece.matrix, initial.piece.matrix);
  assert.deepEqual(s.preview, initial.preview);
  assert.deepEqual(s.bag, initial.bag);
  assert.equal(s.rng, initial.rng);
  assert.equal(s.hold, null);
  assert.equal(s.retries, 1);
  const x = s.piece.x;
  for (let n = 0; n < 60; n++) stepBlock(s, 1 / 120, input(['ArrowLeft']));
  assert.equal(s.piece.x, x);
  stepBlock(s, 1 / 120, input());
  const second = names();
  assert.deepEqual(second, first);
});
test('Blockfall all essential actions have bilingual touch controls and Retry uses unreserved X', () => {
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowDown',
    'ArrowUp',
    'KeyZ',
    'Space',
    'KeyC',
    'KeyX',
  ]) {
    const c = meta.touchControls.find((c) => c.code === code);
    assert.ok(c, code);
    assert.ok(c.label.en);
    assert.match(c.label.zh, /\p{Script=Han}/u);
  }
  assert.equal(
    meta.touchControls.some((c) => c.code === 'KeyR'),
    false,
  );
});
test('Blockfall mixed press/hold opposing directions cancel without a wall-dependent move', () => {
  const g = started(),
    x = g.getState().piece.x;
  g.update(1 / 120, input(['ArrowLeft', 'ArrowRight'], ['ArrowRight']));
  assert.equal(g.getState().piece.x, x);
});
test('Blockfall simultaneous reverse rotations cancel without consuming a lock reset', () => {
  const g = started(),
    p = g.getState().piece;
  g.update(1 / 120, input([], ['ArrowUp', 'KeyZ']));
  assert.deepEqual(g.getState().piece.matrix, p.matrix);
  assert.equal(g.getState().piece.rotation, p.rotation);
  assert.equal(g.getState().lockResets, 0);
});
test('Blockfall lock stamp, simultaneous clear and conservation ledger are atomic', () => {
  const s = fresh(4);
  s.board[18] = Array(10).fill(8);
  s.board[19] = Array(10).fill(8);
  s.board[18][4] = s.board[18][5] = s.board[19][4] = s.board[19][5] = 0;
  s.injected = 16;
  s.piece = { name: 'O', matrix: SHAPES.O.map((r) => r.slice()), rotation: 0, x: 4, y: 18 };
  stepBlock(s, 1 / 120, input([], ['Space']));
  assert.equal(s.placed, 4);
  assert.equal(s.clearing.length, 2);
  assert.equal(s.lines, 0);
  assert.equal(s.piece, null);
  assert.equal(s.board.flat().filter(Boolean).length, 20);
  for (let n = 0; n < 30; n++) stepBlock(s, 1 / 120, input());
  assert.equal(s.lines, 2);
  assert.equal(s.removed, 20);
  assert.equal(s.score, 300);
  assert.equal(
    s.board.flat().filter(Boolean).length,
    s.injected + s.placed - s.removed - s.discarded,
  );
});
test('Blockfall a topped-out stamp leaves no partial cells and never locks a floating expired piece', () => {
  const s = fresh(4);
  s.board[1][3] = s.board[1][4] = s.board[1][5] = 8;
  s.piece = { name: 'T', matrix: SHAPES.T.map((r) => r.slice()), rotation: 0, x: 3, y: -1 };
  s.groundedTime = 0.5;
  s.touched = true;
  const before = structuredClone(s.board);
  stepBlock(s, 1 / 120, input());
  assert.equal(s.phase, 'lost');
  assert.deepEqual(s.board, before);
  assert.equal(s.placed, 0);
  const f = fresh(4);
  f.touched = true;
  f.contactAge = 3;
  f.groundedTime = 0.5;
  const y = f.piece.y;
  stepBlock(f, 1 / 120, input([], ['ArrowUp']));
  assert.equal(f.board.flat().filter(Boolean).length, 0);
  assert.equal(f.piece.y, y);
  assert.equal(f.phase, 'playing');
});

test('Blockfall the formerly exploitable I rotation cycle exhausts its reset budget and then locks', () => {
  const g = started({ seed: 8 });
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  const initial = g.getState();
  let maxResets = 0,
    airSeen = false;
  for (let n = 0; n < 1200 && g.getState().locks === 0; n++) {
    const before = g.getState();
    g.update(1 / 120, input(['ArrowDown'], before.grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []));
    const after = g.getState();
    maxResets = Math.max(maxResets, after.lockResets);
    if (!after.grounded && after.touched) airSeen = true;
  }
  const end = g.getState();
  assert.equal(end.locks, 1);
  assert.ok(airSeen);
  assert.ok(maxResets > 0 && maxResets <= 15);
  assert.ok(end.time - initial.time < 4);
  assert.ok(end.score - initial.score < 4);
  assert.equal(end.board.flat().filter(Boolean).length, 4);
});

test('Blockfall district entry discards discrete actions while intentional held movement and soft drop continue', () => {
  const s = fresh(3);
  s.piece = null;
  s.litTimer = 0.005;
  s.buffer = { hold: true, rotate: 1, move: 1, expires: 2 };
  stepBlock(s, 0.01, input(['ArrowRight', 'ArrowDown'], ['ArrowUp', 'KeyC', 'Space']));
  assert.equal(s.level, 2);
  assert.equal(s.hold, null);
  assert.equal(s.holdUsed, false);
  assert.equal(s.piece.rotation, 0);
  assert.equal(s.locks, 0);
  assert.equal(s.buffer, null);
  assert.ok(s.ready > 0);
  const y = s.piece.y;
  for (let n = 0; n < 100; n++) stepBlock(s, 1 / 60, input(['ArrowRight', 'ArrowDown'], ['Space']));
  assert.equal(s.piece.y, y);
  s.ready = 0;
  const x = s.piece.x;
  stepBlock(s, 0.01, input(['ArrowRight', 'ArrowDown']));
  assert.equal(s.piece.x, x + 1);
  assert.ok(s.fall > 0);
});
test('Blockfall line-clear buffering rotates exactly the next piece and never buffers a hard drop', () => {
  const s = fresh(4);
  s.board[19] = Array(10).fill(8);
  s.board[19][4] = s.board[19][5] = 0;
  s.piece = { name: 'O', matrix: SHAPES.O.map((r) => r.slice()), rotation: 0, x: 4, y: 18 };
  stepBlock(s, 0.01, input([], ['Space']));
  assert.equal(s.clearTimer > 0, true);
  stepBlock(s, 0.01, input([], ['ArrowUp', 'Space']));
  for (let n = 0; n < 30 && !s.piece; n++) stepBlock(s, 0.01, input());
  assert.equal(s.piece.rotation, 1);
  assert.equal(s.locks, 1);
  assert.equal(s.holdUsed, false);
  assert.equal(s.clearing.length, 0);
});
test('Blockfall mutable snapshots and drawing cannot alter board, queue or objective metadata', () => {
  const g = started({ lang: 'zh' }),
    before = structuredClone(g.getState()),
    copy = g.getState();
  copy.board[19][0] = 999;
  copy.piece.matrix[0][0] = 999;
  copy.preview[0] = 'bogus';
  copy.objective.tip.zh = 'tampered';
  assert.deepEqual(g.getState(), before);
  const calls = [],
    ctx = mockContext();
  ctx.fillText = (v, x, y) => calls.push({ v, x, y });
  g.draw(ctx);
  assert.deepEqual(g.getState(), before);
  assert.ok(calls.some((c) => c.v === '方块降临'));
  assert.equal(
    calls.some((c) => c.v === 'BLOCKFALL'),
    false,
  );
});
test('Blockfall seeded traces retain finite bounded state, collision legality and cell conservation', () => {
  const a = started({ seed: 9 }),
    b = started({ seed: 9 }),
    random = seeded(45),
    codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'KeyC', 'Space', 'KeyX', null];
  for (let n = 0; n < 4000; n++) {
    const code = n % 13 === 0 ? codes[Math.floor(random() * codes.length)] : null,
      soft = random() < 0.4,
      controls = input(soft ? ['ArrowDown'] : [], code ? [code] : []);
    a.update(1 / 120, controls);
    b.update(1 / 120, controls);
    if (n % 23 === 0) {
      const s = a.getState();
      assert.deepEqual(s, b.getState());
      assert.equal(s.board.length, 20);
      assert.ok(s.board.every((r) => r.length === 10));
      assert.ok(s.preview.length === 3);
      assert.ok(s.bag.length <= 7);
      assert.equal(
        s.board.flat().filter(Boolean).length,
        s.injected + s.placed - s.removed - s.discarded,
      );
      for (const value of [s.score, s.time, s.lines, s.fall, s.contactAge, s.groundedTime])
        assert.ok(Number.isFinite(value));
      assert.ok(JSON.stringify(s).length < 8000);
      if (s.piece && s.phase === 'playing')
        assert.ok(canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y));
      a.draw(mockContext());
    }
  }
});

test('Blockfall expired manipulation discards repeat backlog instead of sliding the next piece across the well', () => {
  const g = started({ seed: 8 });
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  for (let n = 0; n < 1500 && g.getState().locks === 0; n++)
    g.update(
      1 / 120,
      input(['ArrowRight'], g.getState().grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []),
    );
  const next = g.getState();
  assert.equal(next.locks, 1);
  assert.ok(next.repeat >= 0);
  g.update(1 / 120, input(['ArrowRight']));
  assert.ok(g.getState().piece.x - next.piece.x <= 1);
  assert.ok(g.getState().repeat >= 0);
});

test('Blockfall airborne contact deadline cancels a repeat scheduled just after the deadline', () => {
  const s = fresh(1);
  s.touched = true;
  s.contactAge = 2.999;
  s.lastDir = 1;
  s.repeat = 0.0015;
  const x = s.piece.x;
  stepBlock(s, 1 / 120, input(['ArrowRight']));
  assert.equal(s.piece.x, x);
  assert.ok(s.repeat >= 0);
  assert.equal(s.locks, 0);
  assert.ok(s.time > 0);
});

test('Blockfall an exhausted reset cap survives lift-off and locks on the next supported contact', () => {
  const s = fresh(2);
  s.piece = { name: 'I', matrix: rotatePiece(SHAPES.I), rotation: 1, x: 3, y: 16 };
  s.lockResets = 15;
  s.groundedTime = 0.49;
  s.contactAge = 1;
  s.touched = true;
  s.maxDropY = 17;
  stepBlock(s, 1 / 120, input(['ArrowDown'], ['ArrowUp']));
  assert.equal(s.lockResets, 15);
  assert.ok(s.groundedTime >= 0.49);
  assert.equal(s.locks, 0);
  assert.ok(canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1));
  for (let n = 0; n < 20 && s.locks === 0; n++) stepBlock(s, 1 / 120, input(['ArrowDown']));
  assert.equal(s.locks, 1);
  assert.ok(s.time < 0.1);
  assert.equal(s.score, 0);
  assert.equal(s.board.flat().filter(Boolean).length, 4);
});
