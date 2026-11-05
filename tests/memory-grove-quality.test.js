import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryState,
  stepMemory,
  drawMemory,
  createGame,
} from '../src/games/memory-grove.js';
import { harness, input, mockContext } from './harness.js';
const press = (s, env, code) => stepMemory(s, 1 / 120, input([], [code]), env);
test('Memory Grove decision clock begins on the first card and pauses through forced reveal rather than leaking time', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  for (let i = 0; i < 1200; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.remaining, 90);
  press(s, h.env, 'Space');
  assert.equal(s.remaining, 90);
  for (let i = 0; i < 25; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.remaining, 90);
  for (let i = 0; i < 120; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert(s.remaining < 90 && s.remaining > 88.9);
});
test('Memory Grove player mode may toggle before play but recovery after play is one-way', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  press(s, h.env, 'KeyT');
  assert.equal(s.timed, false);
  press(s, h.env, 'KeyT');
  assert.equal(s.timed, true);
  press(s, h.env, 'Space');
  press(s, h.env, 'KeyT');
  assert.equal(s.timed, false);
  press(s, h.env, 'KeyT');
  assert.equal(s.timed, false);
  assert.equal(s.score, 0);
});
test('Memory Grove study auto-closes exactly in timed play and never carries flip input into an uncovered card', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  press(s, h.env, 'KeyH');
  for (let i = 0; i < 400; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.remaining, 85);
  assert.equal(s.flipped.length, 0);
  press(s, h.env, 'KeyT');
  press(s, h.env, 'KeyH');
  for (let i = 0; i < 30; i++) stepMemory(s, 1 / 120, input(), h.env);
  press(s, h.env, 'Space');
  while (s.mode === 'study') stepMemory(s, 1 / 120, input([], ['Space']), h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.flipped.length, 0);
});
test('Memory Grove late animation input does not flip a card upon reaching ready and gap taps are rejected', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  press(s, h.env, 'Space');
  for (let i = 0; i < 26; i++) stepMemory(s, 1 / 120, input([], ['ArrowRight', 'Space']), h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.flipped.length, 1);
  assert.equal(s.cursor, 0);
  stepMemory(s, 1 / 120, input([], [], { x: 120, y: 62, clicked: true }), h.env);
  assert.equal(s.flipped.length, 1);
});
test('Memory Grove scenery and rule HUD render in English and Chinese with route, study and terminal states', () => {
  for (const lang of ['en', 'zh'])
    for (const stage of [1, 2, 3]) {
      const h = harness({ lang }),
        s = createMemoryState(h.env, stage);
      drawMemory(mockContext(), s, h.env);
      press(s, h.env, 'KeyH');
      for (let i = 0; i < 30; i++) stepMemory(s, 1 / 120, input(), h.env);
      drawMemory(mockContext(), s, h.env);
      s.phase = 'won';
      s.mode = 'terminal';
      drawMemory(mockContext(), s, h.env);
    }
  const s = createGame(harness().env).getState();
  assert(s.status.en.includes('Fern'));
  assert(s.status.zh.includes('蕨叶'));
});

test('Memory Grove relaxed study starts the visit and cannot be laundered back into free indefinite timed study', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  press(s, h.env, 'KeyT');
  press(s, h.env, 'KeyH');
  for (let i = 0; i < 40; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.study.duration, null);
  press(s, h.env, 'KeyT');
  assert.equal(s.timed, false);
  assert.equal(s.started, true);
  assert.equal(s.stageStarted, false);
});
