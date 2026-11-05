import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  findMatches,
  legalSwaps,
  makeBoard,
  applySwap,
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
      const moves = legalSwaps(state.board).sort(
        (a, b) =>
          findMatches(applySwap(state.board, b.a, b.b)).length -
          findMatches(applySwap(state.board, a.a, a.b)).length,
      );
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
