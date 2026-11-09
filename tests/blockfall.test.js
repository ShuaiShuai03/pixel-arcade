import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  rotatePiece,
  canPlace,
  clearRows,
  SHAPES,
  LEVELS,
  LEVEL_COUNT,
  meta,
} from '../src/games/blockfall.js';
import { harness, input, mockContext } from './harness.js';

const EMPTY = () => Array.from({ length: 20 }, () => Array(10).fill(0));

test('Blockfall rotates four times back to original and rejects overlap/walls', () => {
  let p = SHAPES.T.map((r) => r.slice());
  const first = JSON.stringify(p);
  for (let i = 0; i < 4; i++) p = rotatePiece(p);
  assert.equal(JSON.stringify(p), first);
  const board = EMPTY();
  assert.equal(canPlace(board, SHAPES.O, 3, 0), true);
  assert.equal(canPlace(board, SHAPES.O, -1, 0), false);
  assert.equal(canPlace(board, SHAPES.O, 9, 0), false);
  assert.equal(canPlace(board, SHAPES.O, 3.5, 0), false);
  board[1][3] = 1;
  assert.equal(canPlace(board, SHAPES.O, 3, 0), false);
});
test('Blockfall clears complete rows, preserves incomplete rows, and prepends empties', () => {
  const board = EMPTY();
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
test('Blockfall exported level data is frozen and the shapes cannot be edited', () => {
  assert.equal(LEVELS.length, LEVEL_COUNT);
  assert.ok(
    Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0].goal) && Object.isFrozen(SHAPES.I[0]),
  );
  assert.throws(() => {
    'use strict';
    SHAPES.I[1][0] = 9;
  });
});
test('Blockfall moves, rotates, drops and ends once when the stack reaches the roof', () => {
  const h = harness();
  const game = createGame(h.env);
  for (let i = 0; i < 160; i++) game.update(1 / 60, input());
  const start = game.getState().piece.x;
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
test('Blockfall declares an id, bilingual metadata and a description of the level count', () => {
  assert.equal(meta.id, 'blockfall');
  assert.match(meta.description.en, new RegExp(String(LEVEL_COUNT)));
  assert.match(meta.description.zh, /\p{Script=Han}/u);
});
