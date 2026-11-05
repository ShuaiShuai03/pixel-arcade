import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  LEVELS,
  parseLevel,
  moveState,
  solveLevel,
} from '../src/games/crate-keeper.js';
import { harness, input, mockContext } from './harness.js';

test('Crate Keeper all eight levels have verified solutions', () => {
  assert.ok(LEVELS.length >= 8);
  for (const level of LEVELS) {
    const solution = solveLevel(level);
    assert.ok(solution?.length, level.join('\n'));
    let state = parseLevel(level);
    for (const code of solution)
      state = moveState(
        state,
        ...{ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code],
      );
    assert.ok(state.crates.every((c) => state.goals.includes(c)));
  }
});
test('Crate Keeper cannot enter walls or push two crates and does not mutate previous state', () => {
  const s = parseLevel(['######', '#@$$.#', '#  . #', '######']);
  assert.equal(moveState(s, 1, 0), s);
  assert.equal(moveState(s, 0, -1), s);
  const moved = moveState(s, 0, 1);
  assert.notEqual(moved, s);
  assert.equal(s.player, 7);
});
test('Crate Keeper undo restores state and completing all levels wins once', () => {
  const h = harness();
  const game = createGame(h.env);
  const start = game.getState();
  const first = solveLevel(LEVELS[0])[0];
  game.update(1 / 60, input([], [first]));
  game.update(1 / 60, input([], ['KeyZ']));
  assert.equal(game.getState().player, start.player);
  for (const level of LEVELS) {
    for (const code of solveLevel(level)) game.update(1 / 60, input([], [code]));
    for (let i = 0; i < 60; i++) game.update(1 / 60, input());
  }
  assert.equal(game.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  game.draw(mockContext());
  assert.equal(createGame(h.env).getState().level, 1);
});

test('Crate Keeper touch arrows, undo and useful hints operate on real state', () => {
  const h = harness({ lang: 'zh' });
  const g = createGame(h.env),
    start = g.getState();
  g.update(1 / 60, input([], ['KeyH']));
  g.draw(mockContext());
  g.update(1 / 60, input([], [], { x: 440, y: 181, clicked: true }));
  assert.notEqual(g.getState().player, start.player);
  g.update(1 / 60, input([], [], { x: 390, y: 252, clicked: true }));
  assert.equal(g.getState().player, start.player);
  g.update(1 / 60, input([], [], { x: 438, y: 252, clicked: true }));
  g.draw(mockContext());
  g.update(1 / 60, input([], [], { x: 410, y: 140, clicked: true }));
  g.update(1 / 60, input([], [], { x: 410, y: 219, clicked: true }));
  assert.equal(g.getState().player, start.player);
});
