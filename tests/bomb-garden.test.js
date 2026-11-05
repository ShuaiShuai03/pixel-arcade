import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, blastCells } from '../src/games/bomb-garden.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
test('bomb: blasts stop at walls and include first crate', () => {
  const b = Array.from({ length: 5 }, () => Array(5).fill(0));
  b[2][3] = 1;
  b[1][2] = 2;
  assert.deepEqual(blastCells(b, 2, 2, 3), [
    [2, 2],
    [1, 2],
    [0, 2],
    [2, 3],
    [2, 4],
    [2, 1],
  ]);
});
test('bomb: safe spawn, two local players and bilingual instructions', () => {
  const g = createGame(harness({ mode: 2 }).env);
  const s = g.getState();
  assert.equal(s.board[s.players[0].y][s.players[0].x], 0);
  assert.equal(s.players.length, 2);
  assert.ok(meta.description.zh);
  g.draw(mockContext());
});
test('bomb: planted bombs explode, destroy crates and do not duplicate on hold', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 1, ['Space'], ['Space']);
  assert.equal(g.getState().bombs.length, 1);
  step(g, 60, ['Space', 'ArrowRight']);
  assert.equal(g.getState().bombs.length, 1);
  step(g, 100);
  assert.equal(g.getState().bombs.filter((b) => b.owner === 0).length, 0);
  assert.ok(g.getState().score > 0 || g.getState().phase === 'lost');
});
test('bomb: self-blast resolves death once and restart resets arena', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 1, [], ['Space']);
  step(g, 180);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().bombs.length, 0);
});
test('bomb: walls stop walking and movement respects repeat cadence', () => {
  const g = createGame(harness().env);
  step(g, 90, ['ArrowLeft']);
  assert.equal(g.getState().players[0].x, 1);
  step(g, 12, ['ArrowRight']);
  assert.ok(g.getState().players[0].x >= 2);
});

const gardenDirections = [
  [-1, 0, 'KeyA'],
  [1, 0, 'KeyD'],
  [0, -1, 'KeyW'],
  [0, 1, 'KeyS'],
];
const cellKey = (x, y) => `${x},${y}`;
function gardenInput(state) {
  const p = state.players[0];
  if (p.moveClock > 1 / 60) return input();
  const flames = new Set(state.flames.flatMap((f) => f.cells).map(([x, y]) => cellKey(x, y)));
  const danger = new Set([
    ...state.bombs
      .flatMap((b) => blastCells(state.board, b.x, b.y, b.range))
      .map(([x, y]) => cellKey(x, y)),
    ...flames,
  ]);
  const passable = (x, y) =>
    state.board[y]?.[x] === 0 &&
    !flames.has(cellKey(x, y)) &&
    !state.bombs.some((b) => b.x === x && b.y === y) &&
    !state.enemies.some((e) => e.alive && e.x === x && e.y === y);
  function escape(sx, sy, dangerous) {
    const queue = [{ x: sx, y: sy, path: [] }];
    const seen = new Set([cellKey(sx, sy)]);
    for (let at = 0; at < queue.length; at++) {
      const n = queue[at];
      if (n.path.length > 0 && !dangerous.has(cellKey(n.x, n.y))) return n.path;
      if (n.path.length >= 9) continue;
      for (const [dx, dy, code] of gardenDirections) {
        const x = n.x + dx,
          y = n.y + dy,
          key = cellKey(x, y);
        if (passable(x, y) && !seen.has(key)) {
          seen.add(key);
          queue.push({ x, y, path: [...n.path, code] });
        }
      }
    }
    return null;
  }
  if (danger.has(cellKey(p.x, p.y))) {
    const path = escape(p.x, p.y, danger);
    return input(path?.length ? [path[0]] : []);
  }
  if (state.bombs.some((b) => b.owner === 0)) return input();
  function worthwhilePlant(x, y) {
    const ray = blastCells(state.board, x, y, p.range);
    if (
      !ray.some(
        ([a, b]) =>
          state.board[b][a] === 2 || state.enemies.some((e) => e.alive && e.x === a && e.y === b),
      )
    )
      return null;
    return escape(x, y, new Set([...danger, ...ray.map(([a, b]) => cellKey(a, b))]));
  }
  const exit = worthwhilePlant(p.x, p.y);
  if (exit) return input([exit[0]], ['Space']);
  const queue = [{ x: p.x, y: p.y, path: [] }];
  const seen = new Set([cellKey(p.x, p.y)]);
  for (let at = 0; at < queue.length; at++) {
    const n = queue[at];
    if (n.path.length && worthwhilePlant(n.x, n.y)) return input([n.path[0]]);
    for (const [dx, dy, code] of gardenDirections) {
      const x = n.x + dx,
        y = n.y + dy,
        key = cellKey(x, y);
      if (passable(x, y) && !seen.has(key) && !danger.has(key)) {
        seen.add(key);
        queue.push({ x, y, path: [...n.path, code] });
      }
    }
  }
  return input();
}

test('bomb: legal planting, escaping and navigation clear all three gardens', () => {
  const h = harness({ seed: 3 });
  const game = createGame(h.env);
  for (let frame = 0; frame < 40000 && game.getState().phase === 'playing'; frame++) {
    game.update(1 / 60, gardenInput(game.getState()));
    if (frame % 180 === 0) game.draw(mockContext());
  }
  const final = game.getState();
  assert.equal(final.phase, 'won');
  assert.equal(final.level, 3);
  assert.ok(final.players[0].alive);
  assert.ok(final.score > 1500);
  assert.equal(h.ends.length, 1);
  step(game, 60);
  assert.deepEqual(game.getState(), final);
});
