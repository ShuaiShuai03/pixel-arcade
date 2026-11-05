import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, makeDeck } from '../src/games/memory-grove.js';
import { harness, input, mockContext, seeded } from './harness.js';

test('Memory Grove decks contain exactly two copies of every symbol', () => {
  for (const pairs of [6, 8, 10]) {
    const d = makeDeck(pairs, seeded(pairs));
    assert.equal(d.length, pairs * 2);
    for (let i = 0; i < pairs; i++) assert.equal(d.filter((x) => x === i).length, 2);
  }
});
test('Memory Grove rejects flipping same card twice and hides a mismatch', () => {
  const h = harness();
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().flipped.length, 1);
  const state = g.getState();
  const mismatch = state.deck.findIndex((x) => x !== state.deck[0]);
  for (let i = 0; i < mismatch; i++) g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().flipped.length, 2);
  for (let i = 0; i < 70; i++) g.update(1 / 60, input());
  assert.equal(g.getState().flipped.length, 0);
  g.draw(mockContext());
});
test('Memory Grove matches all cards across levels and wins once', () => {
  const h = harness();
  const g = createGame(h.env);
  for (let stage = 0; stage < 3; stage++) {
    const state = g.getState();
    const groups = new Map();
    state.deck.forEach((v, i) => groups.set(v, [...(groups.get(v) || []), i]));
    for (const indices of groups.values()) {
      for (const i of indices) {
        const cur = g.getState();
        let delta = (i - cur.cursor + cur.deck.length) % cur.deck.length;
        while (delta--) g.update(1 / 60, input([], ['ArrowRight']));
        g.update(1 / 60, input([], ['Space']));
      }
      for (let j = 0; j < 30; j++) g.update(1 / 60, input());
    }
    for (let j = 0; j < 70; j++) g.update(1 / 60, input());
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().score, 0);
});

test('Memory Grove peek has a cost, can only be used once, and timeout ends once', () => {
  const h = harness({ lang: 'zh' });
  const g = createGame(h.env);
  const before = g.getState().remaining;
  g.update(1 / 60, input([], ['KeyH']));
  assert.ok(g.getState().remaining < before - 5);
  assert.equal(g.getState().peekUsed, true);
  g.draw(mockContext());
  for (let i = 0; i < 100; i++) g.update(1 / 60, input());
  const after = g.getState().remaining;
  g.update(1 / 60, input([], ['KeyH']));
  assert.ok(g.getState().remaining > after - 0.1);
  for (let i = 0; i < 5000; i++) g.update(1 / 30, input());
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.ok(h.ends[0].message.includes('空地'));
});

test('Memory Grove pointer flips the selected card and keyboard wraps the grid', () => {
  const h = harness();
  const g = createGame(h.env);
  let s = g.getState();
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().cursor, 11);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().cursor, 0);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().cursor, 8);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().cursor, 0);
  const l = s.layout;
  g.update(1 / 60, input([], [], { x: l.x + 10, y: l.y + 10, clicked: true }));
  assert.deepEqual(g.getState().flipped, [0]);
});

test('Memory Grove preserves a last-second completed stage through its clear animation', () => {
  const h = harness();
  const game = createGame(h.env);
  const tap = (index) => {
    const { layout } = game.getState();
    game.update(
      1 / 60,
      input([], [], {
        x: layout.x + (index % layout.cols) * layout.cw + layout.cw / 2,
        y: layout.y + Math.floor(index / layout.cols) * layout.ch + layout.ch / 2,
        clicked: true,
      }),
    );
  };

  for (let stage = 1; stage <= 3; stage++) {
    assert.equal(game.getState().stage, stage);
    const pairs = new Map();
    game.getState().deck.forEach((symbol, index) => {
      pairs.set(symbol, [...(pairs.get(symbol) || []), index]);
    });
    const groups = [...pairs.values()];
    for (const pair of groups.slice(0, -1)) {
      pair.forEach(tap);
      for (let frame = 0; frame < 30; frame++) game.update(1 / 60, input());
    }
    while (game.getState().remaining > 0.55) game.update(1 / 60, input());
    groups.at(-1).forEach(tap);
    const completed = game.getState();
    assert.ok(completed.remaining > 0.45 && completed.remaining < 0.55);
    assert.ok(completed.matched.every(Boolean));

    for (let frame = 0; frame < 90; frame++) game.update(1 / 60, input());
    if (stage < 3) {
      assert.equal(game.getState().phase, 'playing');
      assert.equal(game.getState().stage, stage + 1);
    } else {
      assert.equal(game.getState().phase, 'won');
    }
  }
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
});
