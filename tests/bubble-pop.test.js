import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createBubbleState,
  stepBubble,
  resolveBubble,
  neighbors,
} from '../src/games/bubble-pop.js';
import { harness, input, mockContext } from './harness.js';
test('Bubble cluster removes three plus disconnected bubbles', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  s.board[1][0] = 1;
  s.board[1][1] = 1;
  resolveBubble(s, 0, 2, 0, env);
  assert.equal(s.board.flat().filter((x) => x >= 0).length, 0);
  assert.equal(s.score, 130);
});
test('Bubble mismatches persist and neighbor graph is symmetric', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
  s.board[0][0] = 0;
  resolveBubble(s, 0, 1, 1, env);
  assert.equal(s.board[0][1], 1);
  for (const [r, c] of neighbors(3, 4))
    assert.ok(neighbors(r, c).some(([rr, cc]) => rr === 3 && cc === 4));
});
test('Bubble aiming and shot has wall bounces', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  const a = s.angle;
  stepBubble(s, 1 / 30, input(['ArrowLeft']), env);
  assert.ok(s.angle < a);
  stepBubble(s, 1 / 30, input([], ['Space']), env);
  assert.ok(s.shot);
  s.shot.x = 62;
  s.shot.vx = -200;
  stepBubble(s, 1 / 30, input(), env);
  assert.ok(s.shot.vx > 0);
});
test('Bubble terminal clear/overflow, restart and drawing', () => {
  for (const win of [true, false]) {
    const { env, ends } = harness();
    const s = createBubbleState(env);
    s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
    if (!win) s.board[11][0] = 1;
    stepBubble(s, 1 / 60, input(), env);
    assert.equal(s.phase, win ? 'won' : 'lost');
    assert.equal(ends.length, 1);
  }
  const { env } = harness();
  const g = createGame(env);
  g.draw(mockContext());
  assert.ok(g.getState().remaining > 0);
});
function bubbleAim(s, angle, swap = false) {
  const copy = structuredClone(s);
  const { env } = harness({ seed: 29 });
  if (swap) stepBubble(copy, 1 / 60, input([], ['KeyX']), env);
  const p = {
    x: 240 + Math.cos(angle) * 120,
    y: 299 + Math.sin(angle) * 120,
    down: true,
    clicked: true,
  };
  stepBubble(copy, 1 / 60, input([], [], p), env);
  for (let k = 0; k < 200 && copy.shot && copy.phase === 'playing'; k++)
    stepBubble(copy, 1 / 60, input(), env);
  const remaining = copy.board.flat().filter((v) => v >= 0).length;
  let depth = 0,
    pairs = 0;
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < 12; c++)
      if (copy.board[r][c] >= 0) {
        depth = Math.max(depth, r * 21 + copy.ceiling);
        pairs += neighbors(r, c).filter(
          ([rr, cc]) => copy.board[rr][cc] === copy.board[r][c],
        ).length;
      }
  const rank =
    (copy.phase === 'lost' ? -100000 : 0) +
    (copy.phase === 'won' ? 100000 : 0) +
    (copy.score - s.score) * 10 -
    remaining * 4 -
    depth * 0.15 +
    pairs;
  return { angle, swap, p, rank };
}
test('Bubble cavern can be cleared through real aim, fire and swap actions', () => {
  const { env, ends } = harness({ seed: 7 });
  const g = createGame(env);
  let count = 0;
  while (g.getState().phase === 'playing' && count++ < 100) {
    const s = g.getState();
    let best = null;
    for (const swap of s.current === s.next ? [false] : [false, true])
      for (let a = -2.85; a < -0.27; a += 0.045) {
        const trial = bubbleAim(s, a, swap);
        if (!best || trial.rank > best.rank) best = trial;
      }
    if (best.swap) g.update(1 / 60, input([], ['KeyX']));
    g.update(1 / 60, input([], [], best.p));
    for (let i = 0; i < 200 && g.getState().shot && g.getState().phase === 'playing'; i++)
      g.update(1 / 60, input());
  }
  assert.equal(
    g.getState().phase,
    'won',
    `shots ${count}; remaining ${g.getState().remaining}; ceiling ${g.getState().ceiling}`,
  );
  assert.equal(ends.length, 1);
});
