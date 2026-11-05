import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalSwaps } from '../src/games/gem-match.js';
import { harness, input } from './harness.js';
test('Gem Match hint identifies an actually legal swap without spending a move', () => {
  const g = createGame(harness().env),
    s = g.getState();
  g.update(1 / 60, input([], ['KeyH']));
  assert.ok(g.getState().hint);
  assert.ok(
    legalSwaps(s.board).some((m) => JSON.stringify(m) === JSON.stringify(g.getState().hint)),
  );
  assert.equal(g.getState().moves, s.moves);
});
test('Gem Match garden restoration tracks substrate and per-color collection separately', () => {
  const g = createGame(harness().env),
    s = g.getState();
  assert.equal(s.soil.length, 7);
  assert.equal(s.collected.length, 6);
  assert.equal(s.objective.kind, 'score');
});

test('Gem Match invalid neighbors never consume moves and held arrows do not repeat puzzle choices', () => {
  const g = createGame(harness().env);
  const before = g.getState();
  g.update(1 / 60, input(['ArrowRight']));
  assert.deepEqual(g.getState().cursor, before.cursor);
  const legal = legalSwaps(before.board);
  let invalid;
  for (let y = 0; y < 7 && !invalid; y++)
    for (let x = 0; x < 6 && !invalid; x++)
      if (!legal.some((m) => m.a.x === x && m.a.y === y && m.b.x === x + 1 && m.b.y === y))
        invalid = [
          { x, y },
          { x: x + 1, y },
        ];
  for (const p of invalid)
    g.update(
      1 / 60,
      input([], [], { x: 122 + p.x * 34 + 17, y: 48 + p.y * 34 + 17, clicked: true }),
    );
  assert.equal(g.getState().moves, before.moves);
  assert.deepEqual(g.getState().board, before.board);
});
test('Gem Match settles a real cascade identically at 60 and 120 Hz', () => {
  const states = [60, 120].map((fps) => {
    const g = createGame(harness({ seed: 4 }).env);
    const move = legalSwaps(g.getState().board)[0];
    for (const p of [move.a, move.b])
      g.update(
        1 / fps,
        input([], [], { x: 122 + p.x * 34 + 17, y: 48 + p.y * 34 + 17, clicked: true }),
      );
    for (let i = 0; i < fps * 4; i++) g.update(1 / fps, input());
    return g.getState();
  });
  assert.deepEqual(states[0].board, states[1].board);
  assert.equal(states[0].score, states[1].score);
  assert.equal(states[0].moves, states[1].moves);
});
