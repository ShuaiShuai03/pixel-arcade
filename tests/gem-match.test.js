import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  findMatches,
  legalSwaps,
  makeBoard,
  applySwap,
  createGemState,
  stepGem,
  gemObjective,
  gemSwapPose,
  meta,
} from '../src/games/gem-match.js';
import { harness, input, mockContext, seeded } from './harness.js';

test('Gem Match generated boards have no initial matches and always have valid swaps', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const board = makeBoard(seeded(seed));
    assert.equal(findMatches(board).length, 0);
    assert.ok(legalSwaps(board).length);
  }
});
test('Gem Match identifies crossing lines once and rejects distant swaps', () => {
  const board = [
    [0, 1, 2, 3],
    [1, 1, 1, 4],
    [2, 1, 3, 0],
    [3, 2, 0, 4],
  ];
  assert.deepEqual(findMatches(board).sort(), ['0,1', '1,0', '1,1', '1,2', '2,1'].sort());
  assert.equal(applySwap(board, { x: 0, y: 0 }, { x: 2, y: 2 }), null);
});
test('Gem Match keyboard selection and legal swaps reduce moves and award score', () => {
  const h = harness();
  const game = createGame(h.env);
  const before = game.getState();
  const move = legalSwaps(before.board)[0];
  const press = (code) => game.update(1 / 60, input([], [code]));
  for (let i = 0; i < move.a.x; i++) press('ArrowRight');
  for (let i = 0; i < move.a.y; i++) press('ArrowDown');
  press('Space');
  const dx = move.b.x - move.a.x,
    dy = move.b.y - move.a.y;
  press(dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp');
  press('Space');
  for (let i = 0; i < 120; i++) game.update(1 / 60, input());
  assert.ok(game.getState().score > 0);
  assert.equal(game.getState().moves, before.moves - 1);
  game.draw(mockContext());
  assert.equal(createGame(h.env).getState().score, 0);
});

test('Gem Match completes all gardens with legal pointer swaps', () => {
  for (const seed of [1, 7, 21]) {
    const h = harness({ seed });
    const game = createGame(h.env);
    for (let turn = 0; turn < 100 && game.getState().phase === 'playing'; turn++) {
      const state = game.getState();
      if (state.mode === 'garden-clear') {
        game.update(1 / 60, input([], ['Space']));
        continue;
      }
      if (!legalSwaps(state.board).length) {
        game.update(1 / 60, input([], ['KeyX']));
        for (let i = 0; i < 180; i++) game.update(1 / 60, input());
        continue;
      }
      const value = (move) => {
        const swapped = applySwap(state.board, move.a, move.b);
        const matches = findMatches(swapped).map((key) => key.split(',').map(Number));
        return matches.reduce(
          (total, [y, x]) =>
            total +
            (state.stage === 2 && [1, 2].includes(swapped[y][x])
              ? 5
              : state.stage === 3 && state.soil[y][x]
                ? 20
                : 1),
          0,
        );
      };
      const moves = legalSwaps(state.board).sort((a, b) => value(b) - value(a));
      assert.ok(moves.length);
      for (const pos of [moves[0].a, moves[0].b])
        game.update(
          1 / 60,
          input([], [], { x: 122 + pos.x * 34 + 17, y: 48 + pos.y * 34 + 17, clicked: true }),
        );
      for (let i = 0; i < 180; i++) game.update(1 / 60, input());
    }
    assert.equal(game.getState().phase, 'won', `seed ${seed}`);
    assert.equal(h.ends.length, 1);
  }
});

test('Gem Match move budget can be exhausted through legal low-value swaps', () => {
  const h = harness({ seed: 1, lang: 'zh' }),
    g = createGame(h.env);
  for (let turn = 0; turn < 100 && g.getState().phase === 'playing'; turn++) {
    const s = g.getState();
    if (s.mode === 'garden-clear') {
      g.update(1 / 60, input([], ['Space']));
      continue;
    }
    if (!legalSwaps(s.board).length) {
      g.update(1 / 60, input([], ['KeyX']));
      for (let i = 0; i < 180; i++) g.update(1 / 60, input());
      continue;
    }
    const choices = legalSwaps(s.board).sort(
      (a, b) =>
        findMatches(applySwap(s.board, a.a, a.b)).length -
        findMatches(applySwap(s.board, b.a, b.b)).length,
    );
    for (const p of [choices[0].a, choices[0].b])
      g.update(
        1 / 60,
        input([], [], { x: 122 + p.x * 34 + 17, y: 48 + p.y * 34 + 17, clicked: true }),
      );
    for (let i = 0; i < 180; i++) g.update(1 / 60, input());
  }
  assert.equal(g.getState().phase, 'lost');
  assert.equal(g.getState().moves, 0);
  assert.equal(h.ends.length, 1);
  assert.ok(h.ends[0].message.includes('步数'));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(h.ends.length, 1);
});

test('Gem Match constant-random generation stays productive without hanging', () => {
  const board = makeBoard(() => 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(legalSwaps(board).length);
});

test('Gem Match zero and invalid time preserve every exposed state and input side effect', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState(),
    sounds = h.sounds.length;
  for (const dt of [0, -1, NaN, Infinity])
    g.update(
      dt,
      input(['ArrowRight'], ['ArrowRight', 'Space', 'KeyH'], { x: 139, y: 65, clicked: true }),
    );
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, sounds);
  assert.equal(h.ends.length, 0);
});
test('Gem Match legal swaps visibly travel before committing board cells', () => {
  const g = createGame(harness().env),
    before = g.getState(),
    move = legalSwaps(before.board)[0];
  for (const p of [move.a, move.b])
    g.update(
      1 / 240,
      input([], [], { x: 122 + p.x * 34 + 17, y: 48 + p.y * 34 + 17, clicked: true }),
    );
  const s = g.getState();
  assert.equal(s.mode, 'swap');
  assert.deepEqual(s.board, before.board);
  assert(s.swap && s.swap.time > 0 && s.swap.time < s.swap.duration);
});

function chooseCore(s, env, p, hz = 120) {
  stepGem(s, 1 / hz, input([], [], { x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true }), env);
}
function finishCore(s, env, hz = 120) {
  for (
    let i = 0;
    i < hz * 15 && s.phase === 'playing' && !['ready', 'garden-clear'].includes(s.mode);
    i++
  )
    stepGem(s, 1 / hz, input(), env);
}
function moveKeyboard(g, p, hz) {
  let c = g.getState().cursor;
  for (let i = 0; i < (p.x - c.x + 7) % 7; i++) g.update(1 / hz, input([], ['ArrowRight']));
  c = g.getState().cursor;
  for (let i = 0; i < (p.y - c.y + 7) % 7; i++) g.update(1 / hz, input([], ['ArrowDown']));
  g.update(1 / hz, input([], ['Space']));
}
function waitGame(g, hz) {
  for (let i = 0; i < hz * 12 && g.getState().phase === 'playing' && g.getState().resolving; i++)
    g.update(1 / hz, input());
}
function rankedMoves(s) {
  const value = (m) =>
    findMatches(applySwap(s.board, m.a, m.b)).reduce((n, key) => {
      const [y, x] = key.split(',').map(Number),
        value = applySwap(s.board, m.a, m.b)[y][x];
      return (
        n +
        1 +
        (s.stage === 2 && [1, 2].includes(value) && s.collected[value] < 8 ? 12 : 0) +
        (s.stage === 3 && s.soil[y][x] ? 30 : 0)
      );
    }, 0);
  return legalSwaps(s.board).sort((a, b) => value(b) - value(a));
}
function campaign(seed, hz, { mistake = false, keyboard = true } = {}) {
  const h = harness({ seed }),
    g = createGame(h.env),
    stages = new Set();
  let madeMistake = false,
    mixes = 0;
  for (let turn = 0; turn < 180 && g.getState().phase === 'playing'; turn++) {
    const s = g.getState();
    stages.add(s.stage);
    if (s.mode === 'garden-clear') {
      g.draw(mockContext());
      g.update(1 / hz, input([], ['Enter']));
      continue;
    }
    const choices = rankedMoves(s);
    if (!choices.length) {
      g.update(1 / hz, input([], ['KeyX']));
      waitGame(g, hz);
      mixes++;
      continue;
    }
    const m = mistake && s.stage === 2 && !madeMistake ? choices.at(-1) : choices[0];
    if (mistake && s.stage === 2 && !madeMistake) madeMistake = true;
    for (const p of [m.a, m.b]) {
      if (keyboard) moveKeyboard(g, p, hz);
      else g.update(1 / hz, input([], [], { x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true }));
    }
    waitGame(g, hz);
    g.draw(mockContext());
  }
  assert.equal(
    g.getState().phase,
    'won',
    `${seed}/${hz} stage${g.getState().stage} moves${g.getState().moves}`,
  );
  assert.equal(stages.size, 3);
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].won);
  const terminal = g.getState();
  for (let i = 0; i < 60; i++)
    g.update(
      1 / hz,
      input(['ArrowLeft'], ['ArrowLeft', 'Space', 'KeyX', 'KeyH'], {
        x: 139,
        y: 65,
        clicked: true,
      }),
    );
  assert.deepEqual(g.getState(), terminal);
  assert.equal(h.ends.length, 1);
  if (mistake) assert(madeMistake);
  return { score: terminal.score, mixes };
}
test('Gem Match all three gardens complete through public keyboard controls at30/60/120Hz with ordinary mistake recovery', () => {
  for (const seed of [1, 7, 21])
    for (const hz of [30, 60, 120]) campaign(seed, hz, { mistake: true });
});
test('Gem Match swap carriers lift clear before translating and lower only at separated sockets', () => {
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
        const overlap = Math.abs(p.a.x - p.b.x) < 34 - 1e-8 && Math.abs(p.a.y - p.b.y) < 34 - 1e-8;
        if (overlap) assert(Math.abs(p.a.z - p.b.z) >= 48 - 1e-8);
        if (i < 120 || i > 360) {
          assert(Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y) >= 34 - 1e-8);
        }
        if (prior)
          for (const who of ['a', 'b'])
            assert(
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
test('Gem Match falling carriers obey ballistic gravity, settle on real supports and keep column order', () => {
  const h = harness({ seed: 4 }),
    s = createGemState(h.env),
    m = legalSwaps(s.board)[0];
  for (const p of [m.a, m.b]) chooseCore(s, h.env, p, 240);
  for (let i = 0; i < 1000 && s.mode !== 'fall'; i++) stepGem(s, 1 / 240, input(), h.env);
  assert(s.fall);
  assert(s.fall.particles.some((p) => p.start < 48));
  const target = structuredClone(s.fall.target);
  assert(s.board.flat().some((v) => v < 0));
  for (let i = 0; i < 1000 && s.mode === 'fall'; i++) {
    const time = s.fall.time;
    for (const p of s.fall.particles) {
      assert(Math.abs(p.y - Math.min(p.target, p.start + 340 * time * time)) < 1e-7);
      assert(p.y <= p.target + 1e-8);
      assert(Number.isFinite(p.vy));
      if (p.y < p.target - 1e-8) assert(Math.abs(p.vy - 680 * time) < 1e-7);
      else assert.equal(p.vy, 0);
    }
    for (let x = 0; x < 7; x++) {
      const col = s.fall.particles.filter((p) => p.col === x).sort((a, b) => a.row - b.row);
      for (let k = 1; k < col.length; k++) assert(col[k].y - col[k - 1].y >= 34 - 1e-7);
    }
    stepGem(
      s,
      1 / 240,
      input(['ArrowRight'], ['Space', 'KeyX', 'KeyH'], { x: 139, y: 65, clicked: true }),
      h.env,
    );
  }
  assert.deepEqual(s.board, target);
});
test('Gem Match event boundary remainder gives the same active swap, clear and fall state at30/60/120Hz', () => {
  const run = (hz, seconds) => {
    const h = harness({ seed: 4 }),
      s = createGemState(h.env),
      m = legalSwaps(s.board)[0];
    for (const p of [m.a, m.b]) chooseCore(s, h.env, p, 240);
    for (let i = 0; i < Math.round(hz * seconds); i++) stepGem(s, 1 / hz, input(), h.env);
    return s;
  };
  for (const seconds of [0.1, 0.5, 0.8, 1.2]) {
    const states = [30, 60, 120].map((hz) => run(hz, seconds));
    for (const s of states.slice(1)) {
      const a = states[0];
      assert.equal(s.mode, a.mode);
      assert.equal(s.score, a.score);
      assert.equal(s.moves, a.moves);
      assert.deepEqual(s.board, a.board);
      assert(Math.abs(s.time - a.time) < 1e-8);
      if (s.swap) assert(Math.abs(s.swap.time - a.swap.time) < 1e-8);
      if (s.fall)
        for (let i = 0; i < s.fall.particles.length; i++)
          assert(Math.abs(s.fall.particles[i].y - a.fall.particles[i].y) < 1e-7);
    }
  }
});
test('Gem Match invalid adjacent swap animates out and back without cost then allows a real match', () => {
  const h = harness(),
    s = createGemState(h.env),
    before = structuredClone(s.board),
    moves = s.moves;
  let bad;
  for (let y = 0; y < 7 && !bad; y++)
    for (let x = 0; x < 6 && !bad; x++)
      if (!applySwap(s.board, { x, y }, { x: x + 1, y }))
        bad = [
          { x, y },
          { x: x + 1, y },
        ];
  for (const p of bad) chooseCore(s, h.env, p);
  assert.equal(s.mode, 'swap');
  assert(!s.swap.valid);
  finishCore(s, h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.feedback, 'invalid');
  assert.deepEqual(s.board, before);
  assert.equal(s.moves, moves);
  assert.equal(s.score, 0);
  chooseCore(s, h.env, s.selected);
  const m = legalSwaps(s.board)[0];
  for (const p of [m.a, m.b]) chooseCore(s, h.env, p);
  finishCore(s, h.env);
  assert(s.score > 0);
  assert.equal(s.moves, moves - 1);
});
test('Gem Match dead-board mixer is explicit and free, productive and never awards unearned matches', () => {
  for (const seed of [1, 9]) {
    const h = harness({ seed }),
      s = createGemState(h.env, 3);
    s.board = Array.from({ length: 7 }, (_, y) =>
      Array.from({ length: 7 }, (_, x) => (x + 2 * y) % 6),
    );
    s.score = 220;
    s.moves = 5;
    s.collected[1] = 4;
    s.soil[2][1] = false;
    const before = {
      score: s.score,
      moves: s.moves,
      collected: [...s.collected],
      soil: structuredClone(s.soil),
    };
    assert.equal(legalSwaps(s.board).length, 0);
    stepGem(s, 1 / 120, input([], ['KeyH']), h.env);
    assert.equal(s.hint, null);
    assert.equal(s.feedback, 'dead');
    stepGem(s, 1 / 120, input([], ['KeyX']), h.env);
    assert.equal(s.mode, 'mix-lift');
    assert.equal(s.mixes, 1);
    finishCore(s, h.env);
    assert.equal(s.mode, 'ready');
    assert.equal(findMatches(s.board).length, 0);
    assert(legalSwaps(s.board).length);
    assert.equal(s.score, before.score);
    assert.equal(s.moves, before.moves);
    assert.deepEqual(s.collected, before.collected);
    assert.deepEqual(s.soil, before.soil);
    const board = structuredClone(s.board);
    stepGem(s, 1 / 120, input([], ['KeyX']), h.env);
    assert.equal(s.mode, 'ready');
    assert.equal(s.mixes, 1);
    assert.deepEqual(s.board, board);
    assert.equal(s.score, before.score);
  }
});
test('Gem Match simultaneous crossing removal scores each cell exactly once and records exact collection and soil', () => {
  const h = harness(),
    s = createGemState(h.env, 3);
  s.board = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) => (x + 2 * y) % 6),
  );
  for (const [y, x] of [
    [2, 3],
    [3, 2],
    [3, 3],
    [3, 4],
    [4, 3],
  ])
    s.board[y][x] = 2;
  const matches = findMatches(s.board);
  assert.equal(matches.length, 5);
  s.mode = 'clear';
  s.pending = matches;
  s.clearTime = 0.01;
  s.combo = 2;
  stepGem(s, 0.01, input(), h.env);
  assert.equal(s.score, 200);
  assert.equal(s.totalCleared, 5);
  assert.equal(s.collected[2], 5);
  assert.equal(s.soil.flat().filter(Boolean).length, 7);
  assert.equal(s.mode, 'fall');
});
test('Gem Match final move resolves its full goal and opens an intentional fresh garden boundary before exhaustion', () => {
  const h = harness(),
    s = createGemState(h.env),
    m = legalSwaps(s.board)[0];
  s.score = 540;
  s.moves = 1;
  for (const p of [m.a, m.b]) chooseCore(s, h.env, p);
  finishCore(s, h.env);
  assert.equal(s.mode, 'garden-clear');
  assert.equal(s.phase, 'playing');
  assert.equal(s.moves, 0);
  assert.equal(h.ends.length, 0);
  const board = structuredClone(s.board);
  stepGem(s, 1 / 60, input(['Space'], [], { x: 139, y: 65, clicked: true }), h.env);
  assert.equal(s.stage, 1);
  assert.deepEqual(s.board, board);
  stepGem(s, 1 / 60, input([], ['Enter']), h.env);
  assert.equal(s.stage, 2);
  assert.equal(s.mode, 'ready');
  assert.equal(s.moves, 28);
  assert.equal(s.selected, null);
  assert.equal(s.swap, null);
  assert.equal(
    s.collected.reduce((a, b) => a + b),
    0,
  );
  assert.equal(gemObjective(s).progress, 0);
});
test('Gem Match last-move soil victory wins once and terminal state remains fully frozen', () => {
  const h = harness({ lang: 'zh' }),
    s = createGemState(h.env, 3),
    m = legalSwaps(s.board)[0],
    board = applySwap(s.board, m.a, m.b),
    matches = findMatches(board);
  s.soil = Array.from({ length: 7 }, () => Array(7).fill(false));
  for (const key of matches) {
    const [y, x] = key.split(',').map(Number);
    s.soil[y][x] = true;
  }
  s.moves = 1;
  for (const p of [m.a, m.b]) chooseCore(s, h.env, p);
  finishCore(s, h.env);
  assert.equal(s.phase, 'won');
  assert.equal(s.moves, 0);
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].message.includes('三座'));
  const terminal = structuredClone(s);
  for (let i = 0; i < 100; i++) stepGem(s, 1 / 30, input([], ['Space', 'KeyX', 'KeyH']), h.env);
  assert.deepEqual(s, terminal);
  assert.equal(h.ends.length, 1);
});
test('Gem Match zero or invalid dt is a total no-op during every busy phase as well as at rest', () => {
  const h = harness(),
    s = createGemState(h.env),
    m = legalSwaps(s.board)[0];
  for (const p of [m.a, m.b]) chooseCore(s, h.env, p);
  const tested = new Set();
  for (let i = 0; i < 2000 && tested.size < 3; i++) {
    if (['swap', 'clear', 'fall'].includes(s.mode) && !tested.has(s.mode)) {
      tested.add(s.mode);
      const before = structuredClone(s),
        sounds = h.sounds.length;
      for (const dt of [0, -1, NaN, Infinity])
        stepGem(
          s,
          dt,
          input([], ['ArrowLeft', 'Space', 'KeyH', 'KeyX'], { x: 139, y: 65, clicked: true }),
          h.env,
        );
      assert.deepEqual(s, before);
      assert.equal(h.sounds.length, sounds);
    }
    stepGem(s, 1 / 240, input(), h.env);
  }
  assert.equal(tested.size, 3);
});
test('Gem Match touch metadata includes all keyboard actions and opposing direction chords do not bias the cursor', () => {
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyH', 'KeyX'])
    assert(meta.touchControls.some((c) => c.code === code));
  const g = createGame(harness().env),
    s = g.getState();
  for (const keys of [
    ['ArrowLeft', 'ArrowRight'],
    ['ArrowUp', 'ArrowDown'],
    ['ArrowRight', 'ArrowDown'],
  ])
    g.update(1 / 60, input([], keys));
  assert.deepEqual(g.getState().cursor, s.cursor);
  g.update(1 / 60, input(['ArrowRight']));
  assert.deepEqual(g.getState().cursor, s.cursor);
});
test('Gem Match seeded mixed input remains finite and bounded and fresh instances restore every resource', () => {
  for (const seed of [1, 17, 29]) {
    const h = harness({ seed }),
      g = createGame(h.env),
      random = seeded(seed + 99);
    for (let i = 0; i < 3600; i++) {
      const keys = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowDown',
        'ArrowUp',
        'Space',
        'KeyH',
        'KeyX',
        'Enter',
      ];
      g.update(
        1 / 60,
        input([], random() < 0.2 ? [keys[Math.floor(random() * keys.length)]] : [], {
          x: 122 + Math.floor(random() * 7) * 34 + 17,
          y: 48 + Math.floor(random() * 7) * 34 + 17,
          clicked: random() < 0.1,
        }),
      );
      const s = g.getState();
      assert(Number.isFinite(s.time) && Number.isFinite(s.score));
      assert(s.moves >= 0 && s.moves <= 32);
      assert(s.sparkles.length <= 98);
      assert(s.pending.length <= 49);
      assert(
        s.board.length === 7 &&
          s.board.every((r) => r.length === 7 && r.every((v) => v >= -1 && v < 6)),
      );
      if (s.fall) {
        assert.equal(s.fall.particles.length, 49);
        assert(s.fall.particles.every((p) => Number.isFinite(p.y) && Number.isFinite(p.vy)));
      }
      if (i % 300 === 0) g.draw(mockContext());
    }
    const a = createGame(harness({ seed }).env).getState(),
      b = createGame(harness({ seed }).env).getState();
    assert.deepEqual(a, b);
    assert.equal(a.score, 0);
    assert.equal(a.moves, 20);
    assert.equal(a.selected, null);
    assert.equal(a.mixes, 0);
  }
});

test('Gem Match soil markers remain visible above carriers and miniature tracks exact remaining locations', () => {
  const h = harness({ seed: 1 }),
    g = createGame(h.env);
  for (let turn = 0; turn < 100 && g.getState().stage < 3; turn++) {
    const s = g.getState();
    if (s.mode === 'garden-clear') {
      g.update(1 / 60, input([], ['Enter']));
      continue;
    }
    const m = rankedMoves(s)[0];
    assert(m);
    for (const p of [m.a, m.b])
      g.update(1 / 60, input([], [], { x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true }));
    waitGame(g, 60);
  }
  assert.equal(g.getState().stage, 3);
  const start = g.getState(),
    m = rankedMoves(start).find((move) => {
      const removed = findMatches(applySwap(start.board, move.a, move.b))
        .map((k) => k.split(',').map(Number))
        .filter(([y, x]) => start.soil[y][x]);
      return removed.length > 0 && removed.some(([y, x]) => (y - 2) * 4 + x - 1 >= removed.length);
    });
  assert(m);
  for (const p of [m.a, m.b])
    g.update(1 / 60, input([], [], { x: 139 + p.x * 34, y: 65 + p.y * 34, clicked: true }));
  waitGame(g, 60);
  const s = g.getState(),
    commands = [],
    ctx = mockContext();
  ctx.fillRect = (x, y, w, h) => commands.push({ color: ctx.fillStyle, x, y, w, h });
  g.draw(ctx);
  const lastCarrier = commands.findLastIndex((c) => c.color === '#47665c');
  for (let y = 2; y <= 4; y++)
    for (let x = 1; x <= 4; x++) {
      const map = commands.find(
        (c) => c.x === 381 + (x - 1) * 19 && c.y === 146 + (y - 2) * 19 && c.w === 14 && c.h === 14,
      );
      assert(map);
      assert.equal(map.color, s.soil[y][x] ? '#805c3f' : '#80aa85');
      const mark = commands.findIndex(
        (c) => c.color === '#e7b76f' && c.x === 122 + x * 34 + 1 && c.y === 48 + y * 34 + 1,
      );
      if (s.soil[y][x])
        assert(mark > lastCarrier, 'remaining soil corner must be drawn above opaque carriers');
      else assert.equal(mark, -1, 'restored soil must not retain a remaining-soil hatch');
    }
});
