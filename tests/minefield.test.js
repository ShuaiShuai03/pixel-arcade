import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createField, revealCells } from '../src/games/minefield.js';
import { harness, input, mockContext, seeded } from './harness.js';

test('Minefield guarantees the first click and all adjacent cells are safe', () => {
  for (let seed = 0; seed < 60; seed++) {
    const f = createField(9, 9, 10, 40, seeded(seed));
    assert.equal(f.mines.filter(Boolean).length, 10);
    for (const i of [30, 31, 32, 39, 40, 41, 48, 49, 50]) assert.equal(f.mines[i], false);
  }
});
test('Minefield flood reveal expands blank cells but never flags or mines', () => {
  const field = createField(9, 9, 10, 40, seeded(1));
  const seen = Array(81).fill(false),
    flags = Array(81).fill(false);
  flags[40] = true;
  assert.equal(revealCells(field, seen, flags, 40).length, 0);
  flags[40] = false;
  const revealed = revealCells(field, seen, flags, 40);
  assert.ok(revealed.length >= 9);
  assert.ok(revealed.every((i) => !field.mines[i]));
});
test('Minefield supports keyboard flags, safe reveal and win without revealing a mine', () => {
  const h = harness();
  const game = createGame(h.env);
  game.update(1 / 60, input([], ['KeyF']));
  assert.equal(game.getState().flags[0], true);
  game.update(1 / 60, input([], ['KeyF']));
  game.update(1 / 60, input([], ['Space']));
  assert.equal(game.getState().phase, 'playing');
  const s = game.getState();
  for (let i = 0; i < 81; i++) {
    if (!s.mines[i])
      game.update(
        1 / 60,
        input([], [], {
          x: 114 + (i % 9) * 28 + 14,
          y: 36 + Math.floor(i / 9) * 28 + 14,
          clicked: true,
        }),
      );
  }
  assert.equal(game.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  game.draw(mockContext());
  assert.equal(createGame(h.env).getState().phase, 'playing');
});

test('Minefield flag mode toggles through touch, respects flags, and a mine ends once', () => {
  const h = harness({ lang: 'zh' });
  const g = createGame(h.env);
  g.update(1 / 60, input([], [], { x: 426, y: 150, clicked: true }));
  assert.equal(g.getState().flagMode, true);
  g.update(1 / 60, input([], [], { x: 128, y: 50, clicked: true }));
  assert.equal(g.getState().flags[0], true);
  assert.equal(g.getState().started, false);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().started, false);
  g.update(1 / 60, input([], ['KeyF']));
  g.update(1 / 60, input([], ['KeyV']));
  g.update(1 / 60, input([], ['Enter']));
  const mine = g.getState().mines.findIndex(Boolean);
  g.update(
    1 / 60,
    input([], [], { x: 128 + (mine % 9) * 28, y: 50 + Math.floor(mine / 9) * 28, clicked: true }),
  );
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.ok(h.ends[0].message.includes('地雷'));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(h.ends.length, 1);
  g.draw(mockContext());
});

test('Minefield exact flags allow numbered-cell chording and arrows wrap safely', () => {
  const h = harness({ seed: 9 });
  const g = createGame(h.env);
  const click = (i) =>
    g.update(
      1 / 60,
      input([], [], { x: 128 + (i % 9) * 28, y: 50 + Math.floor(i / 9) * 28, clicked: true }),
    );
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().cursor, 8);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().cursor, 0);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().cursor, 72);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().cursor, 0);
  click(40);
  const state = g.getState();
  const number = state.revealed.findIndex((v, i) => v && state.numbers[i] > 0);
  g.update(1 / 60, input([], ['KeyV']));
  for (let i = 0; i < 81; i++) if (state.mines[i]) click(i);
  g.update(1 / 60, input([], ['KeyV']));
  const count = g.getState().revealed.filter(Boolean).length;
  click(number);
  assert.ok(g.getState().revealed.filter(Boolean).length >= count);
  assert.notEqual(g.getState().phase, 'lost');
});
