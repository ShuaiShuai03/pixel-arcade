import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, rotatePiece, canPlace, clearRows, SHAPES } from '../src/games/blockfall.js';
import { harness, input, mockContext } from './harness.js';

test('Blockfall rotates four times back to original and rejects overlap/walls', () => {
  let p = SHAPES.T.map((r) => r.slice());
  const first = JSON.stringify(p);
  for (let i = 0; i < 4; i++) p = rotatePiece(p);
  assert.equal(JSON.stringify(p), first);
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  assert.equal(canPlace(board, SHAPES.O, 3, 0), true);
  assert.equal(canPlace(board, SHAPES.O, -1, 0), false);
  assert.equal(canPlace(board, SHAPES.O, 9, 0), false);
  board[1][3] = 1;
  assert.equal(canPlace(board, SHAPES.O, 3, 0), false);
});
test('Blockfall clears complete rows, preserves incomplete rows, and prepends empties', () => {
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  board[18] = Array(10).fill(2);
  board[19] = Array(10).fill(3);
  board[17][2] = 1;
  const result = clearRows(board);
  assert.equal(result.count, 2);
  assert.equal(result.board.length, 20);
  assert.equal(result.board[19][2], 1);
  assert.equal(
    result.board[0].every((v) => !v),
    true,
  );
  assert.equal(board[18][0], 2);
});
test('Blockfall moves, rotates, drops and ends once when stack reaches roof', () => {
  const h = harness();
  const game = createGame(h.env);
  let state = game.getState();
  const start = state.piece.x;
  game.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(game.getState().piece.x, start - 1);
  game.update(1 / 60, input([], ['ArrowUp']));
  game.draw(mockContext());
  for (let i = 0; i < 100 && game.getState().phase === 'playing'; i++)
    game.update(1 / 60, input([], ['Space']));
  assert.equal(game.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  game.update(1, input([], ['Space']));
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().score, 0);
});

for (const hz of [30, 60, 120])
  for (const seed of [1, 9, 12])
    test(`Blockfall completes all three districts through legal input (${hz}Hz seed${seed})`, (t) => {
      const h = harness({ seed });
      const game = createGame(h.env);
      const visited = new Set();
      let recovered = false;
      for (let turn = 0; turn < 500 && game.getState().phase === 'playing'; turn++) {
        for (
          let n = 0;
          n < hz * 2 && !game.getState().piece && game.getState().phase === 'playing';
          n++
        )
          game.update(1 / hz, input());
        const state = game.getState();
        if (state.phase !== 'playing') break;
        visited.add(state.stage);
        assert.ok(state.piece);
        if (hz === 60 && seed === 12 && state.stage === 2 && !recovered) {
          game.update(1 / hz, input([], ['Space']));
          game.update(1 / hz, input([], ['KeyX']));
          const restored = game.getState();
          assert.equal(restored.stage, 2);
          for (const key of [
            'board',
            'preview',
            'bag',
            'rng',
            'hold',
            'score',
            'lines',
            'placed',
            'removed',
            'injected',
            'discarded',
          ])
            assert.deepEqual(restored[key], state[key]);
          assert.equal(restored.retries, 1);
          game.update(1 / hz, input());
          recovered = true;
          continue;
        }
        assert.equal(
          state.board.flat().filter(Boolean).length,
          state.injected + state.placed - state.removed - state.discarded,
        );
        const beforeDraw = game.getState();
        game.draw(mockContext());
        assert.deepEqual(game.getState(), beforeDraw);
        let best = null;
        let matrix = state.piece.matrix;
        for (let rotation = 0; rotation < 4; rotation++) {
          if (rotation) matrix = rotatePiece(matrix);
          for (let x = -2; x < 10; x++) {
            if (!canPlace(state.board, matrix, x, state.piece.y)) continue;
            let y = state.piece.y;
            while (canPlace(state.board, matrix, x, y + 1)) y++;
            const board = state.board.map((r) => r.slice());
            matrix.forEach((row, py) =>
              row.forEach((v, px) => {
                if (v) board[y + py][x + px] = v;
              }),
            );
            if (
              state.stage === 3 &&
              clearRows(board).count < 4 &&
              matrix.some((r) => r.some((v, px) => v && x + px === 8))
            )
              continue;
            if (
              state.stage === 2 &&
              state.piece.name !== 'O' &&
              matrix.some((r) => r.some((v, px) => v && [4, 5].includes(x + px)))
            )
              continue;
            const cleared = clearRows(board),
              heights = [],
              holes = [];
            for (let col = 0; col < 10; col++) {
              let top = 20,
                hole = 0;
              for (let row = 0; row < 20; row++) {
                if (cleared.board[row][col]) top = Math.min(top, row);
                else if (top < row) hole++;
              }
              heights.push(20 - top);
              holes.push(hole);
            }
            const bump = heights.slice(1).reduce((sum, v, i) => sum + Math.abs(v - heights[i]), 0);
            const value =
              cleared.count * 100 -
              heights.reduce((a, b) => a + b, 0) * 0.6 -
              holes.reduce((a, b) => a + b, 0) * 12 -
              bump * 0.6 -
              Math.max(...heights);
            if (!best || value > best.value) best = { value, rotation, x };
          }
        }
        assert.ok(best);
        for (let i = 0; i < best.rotation; i++) game.update(1 / hz, input([], ['ArrowUp']));
        for (let i = 0; i < 15 && game.getState().piece.x !== best.x; i++) {
          const px = game.getState().piece.x;
          game.update(1 / hz, input([], [px < best.x ? 'ArrowRight' : 'ArrowLeft']));
        }
        game.update(1 / hz, input([], ['Space']));
      }
      assert.equal(game.getState().phase, 'won');
      assert.ok(game.getState().lines >= 12);
      assert.equal(visited.size, 3);
      t.diagnostic(
        `stage3 won in ${game.getState().locks} locks, lines${game.getState().lines}, score${game.getState().score}`,
      );
      assert.equal(h.ends.length, 1);
      const final = game.getState();
      for (let n = 0; n < 10; n++) game.update(1 / hz, input(['ArrowDown'], ['Space', 'KeyX']));
      assert.deepEqual(game.getState(), final);
      assert.equal(h.ends.length, 1);
      if (hz === 60 && seed === 12) assert.equal(recovered, true);
    });
