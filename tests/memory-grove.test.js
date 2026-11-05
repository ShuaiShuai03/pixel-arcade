import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  makeDeck,
  createMemoryState,
  stepMemory,
  memoryCardOpen,
  drawMemory,
  meta,
} from '../src/games/memory-grove.js';
import { harness, input, mockContext, seeded } from './harness.js';

function chooseCore(s, env, index, dt = 1 / 120) {
  stepMemory(
    s,
    dt,
    input([], [], {
      x: 120 + (index % 4) * 62 + 31,
      y: 62 + Math.floor(index / 4) * 66 + 33,
      clicked: true,
    }),
    env,
  );
}
function waitCore(s, env, hz = 120) {
  for (
    let i = 0;
    i < hz * 8 && s.phase === 'playing' && !['ready', 'garden-clear'].includes(s.mode);
    i++
  )
    stepMemory(s, 1 / hz, input(), env);
}
function moveTo(g, index, hz = 60, keyboard = true) {
  if (!keyboard) {
    const l = g.getState().layout;
    g.update(
      1 / hz,
      input([], [], {
        x: l.x + (index % 4) * l.cw + 31,
        y: l.y + Math.floor(index / 4) * l.ch + 33,
        clicked: true,
      }),
    );
    return;
  }
  let cursor = g.getState().cursor;
  for (let i = 0; i < ((index % 4) - (cursor % 4) + 4) % 4; i++)
    g.update(1 / hz, input([], ['ArrowRight']));
  cursor = g.getState().cursor;
  for (let i = 0; i < (Math.floor(index / 4) - Math.floor(cursor / 4) + 3) % 3; i++)
    g.update(1 / hz, input([], ['ArrowDown']));
  g.update(1 / hz, input([], ['Space']));
}
function waitGame(g, hz = 60, known = null) {
  for (
    let i = 0;
    i < hz * 8 &&
    g.getState().phase === 'playing' &&
    !['ready', 'garden-clear'].includes(g.getState().mode);
    i++
  ) {
    g.update(1 / hz, input());
    if (known) observe(g.getState(), known);
  }
}
function observe(s, known) {
  s.visible.forEach((value, i) => {
    if (value !== null) known.set(i, value);
  });
}
function nextKnownChoice(s, known) {
  const available = s.matched
      .map((v, i) => (v || s.flipped.includes(i) ? -1 : i))
      .filter((i) => i >= 0),
    unknown = available.find((i) => !known.has(i));
  let target;
  if (s.rule === 'route') target = s.route[s.routeIndex];
  else if (s.flipped.length) target = known.get(s.flipped[0]);
  else
    for (let value = 0; value < s.symbolCount; value++)
      if (available.filter((i) => known.get(i) === value).length >= s.groupSize) {
        target = value;
        break;
      }
  const sameSoFar = s.flipped.every((i) => known.get(i) === target);
  if (target !== undefined && sameSoFar) {
    const found = available.find((i) => known.get(i) === target);
    if (found !== undefined) return found;
  }
  return unknown ?? available[0];
}
function learnedCampaign(seed, hz, { keyboard = true, relaxed = false, study = false } = {}) {
  const h = harness({ seed }),
    g = createGame(h.env),
    rules = new Set();
  if (relaxed) g.update(1 / hz, input([], ['KeyT']));
  let stage = 0,
    known = new Map(),
    actions = 0,
    mismatches = 0,
    lastTurns = 0;
  for (; actions < 220 && g.getState().phase === 'playing'; actions++) {
    let s = g.getState();
    rules.add(s.rule);
    if (s.stage !== stage) {
      stage = s.stage;
      known = new Map();
      lastTurns = s.turns;
    }
    if (s.mode === 'garden-clear') {
      g.draw(mockContext());
      g.update(1 / hz, input([], ['Enter']));
      continue;
    }
    observe(s, known);
    if (study && s.stageHelps === 0) {
      g.update(1 / hz, input([], ['KeyH']));
      for (let i = 0; i < hz; i++) {
        g.update(1 / hz, input());
        observe(g.getState(), known);
      }
      g.update(1 / hz, input([], ['KeyH']));
      waitGame(g, hz);
      s = g.getState();
    }
    const index = nextKnownChoice(s, known);
    assert.notEqual(index, undefined);
    moveTo(g, index, hz, keyboard);
    waitGame(g, hz, known);
    const after = g.getState();
    observe(after, known);
    if (after.turns > lastTurns && ['mismatch', 'order'].includes(after.feedback)) mismatches++;
    lastTurns = after.turns;
    g.draw(mockContext());
  }
  const result = g.getState();
  assert.equal(
    result.phase,
    'won',
    `seed${seed}/${hz} stage${result.stage} after${actions}actions`,
  );
  assert.deepEqual([...rules], ['pairs', 'route', 'triples']);
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].won);
  assert(result.score <= 2600);
  assert(result.matched.every(Boolean));
  const terminal = g.getState();
  for (let i = 0; i < 60; i++)
    g.update(
      1 / hz,
      input(['ArrowRight'], ['ArrowRight', 'Space', 'KeyH', 'KeyT'], {
        x: 151,
        y: 95,
        clicked: true,
      }),
    );
  assert.deepEqual(g.getState(), terminal);
  assert.equal(h.ends.length, 1);
  return { mismatches, score: result.score, actions };
}

test('Memory Grove decks contain exact pair or triple multiplicities and deterministic permutations', () => {
  for (const [symbols, copies] of [
    [6, 2],
    [4, 3],
    [10, 2],
  ])
    for (const seed of [1, 8, 42]) {
      const deck = makeDeck(symbols, seeded(seed), copies);
      assert.equal(deck.length, symbols * copies);
      for (let i = 0; i < symbols; i++) assert.equal(deck.filter((v) => v === i).length, copies);
      assert.deepEqual(deck, makeDeck(symbols, seeded(seed), copies));
    }
  assert.throws(() => makeDeck(0, () => 0), RangeError);
  assert.throws(() => makeDeck(2, () => 0, 1), RangeError);
});
test('Memory Grove zero and invalid dt leave complete state and all side effects untouched', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState(),
    sounds = h.sounds.length;
  for (const dt of [0, -1, NaN, Infinity])
    g.update(
      dt,
      input([], ['ArrowRight', 'Space', 'KeyH', 'KeyT'], { x: 151, y: 95, clicked: true }),
    );
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, sounds);
  assert.equal(h.ends.length, 0);
});
test('Memory Grove has equally readable boards with three distinct rules rather than growing card count', () => {
  const states = [1, 2, 3].map((stage) => createMemoryState(harness().env, stage));
  assert.deepEqual(
    states.map((s) => s.rule),
    ['pairs', 'route', 'triples'],
  );
  assert.deepEqual(
    states.map((s) => s.groupSize),
    [2, 2, 3],
  );
  assert(states.every((s) => s.deck.length === 12));
  assert.equal(new Set(states[1].route).size, 6);
});
test('Memory Grove public snapshots redact hidden faces including animation objects and show only genuinely turned cards', () => {
  const h = harness(),
    g = createGame(h.env),
    s = g.getState();
  assert(s.deck.every((v) => v === null));
  assert(s.visible.every((v) => v === null));
  g.update(1 / 120, input([], ['Space']));
  assert(g.getState().visible.every((v) => v === null));
  assert.deepEqual(Object.keys(g.getState().flip).sort(), ['index', 'time']);
  for (let i = 0; i < 30; i++) g.update(1 / 120, input());
  const revealed = g.getState();
  assert.notEqual(revealed.visible[0], null);
  assert.equal(revealed.visible.filter((v) => v !== null).length, 1);
  assert.deepEqual(revealed.deck, revealed.visible);
});
test('Memory Grove hidden card drawing is independent of hidden identity', () => {
  const capture = (s) => {
    const commands = [],
      ctx = mockContext();
    ctx.strokeStyle = 'none';
    for (const key of ['fillRect', 'strokeRect', 'fillText'])
      ctx[key] = (...args) => commands.push([key, ctx.fillStyle, ctx.strokeStyle, ...args]);
    drawMemory(ctx, s, harness().env);
    return commands;
  };
  const a = createMemoryState(harness({ seed: 1 }).env),
    b = structuredClone(a);
  b.deck = b.deck.map((v) => (v + 1) % 6);
  assert.deepEqual(capture(a), capture(b));
});
test('Memory Grove rejects repeated or already matched cards and ignores held keys', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  chooseCore(s, h.env, 0);
  waitCore(s, h.env);
  const snapshot = structuredClone(s);
  stepMemory(s, 1 / 60, input(['Space', 'ArrowRight']), h.env);
  assert.equal(s.flipped.length, 1);
  assert.equal(s.cursor, 0);
  chooseCore(s, h.env, 0);
  assert.equal(s.flipped.length, 1);
  assert.equal(s.turns, 0);
  assert.deepEqual(s.matched, snapshot.matched);
  const partner = s.deck.findIndex((v, i) => i !== 0 && v === s.deck[0]);
  chooseCore(s, h.env, partner);
  waitCore(s, h.env);
  const score = s.score;
  chooseCore(s, h.env, partner);
  assert.equal(s.score, score);
  assert.equal(s.flipped.length, 0);
});
test('Memory Grove a mismatch stays visible long enough then closes without score or identity leakage', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  chooseCore(s, h.env, 0);
  waitCore(s, h.env);
  const other = s.deck.findIndex((v) => v !== s.deck[0]);
  chooseCore(s, h.env, other);
  while (s.mode === 'opening') stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.mode, 'reveal');
  const time = s.remaining;
  for (let i = 0; i < 120; i++) {
    stepMemory(s, 1 / 120, input([], ['Space', 'KeyH']), h.env);
    assert.equal(memoryCardOpen(s, 0), 1);
    assert.equal(memoryCardOpen(s, other), 1);
  }
  assert.equal(s.remaining, time);
  assert.equal(s.score, 0);
  assert.equal(s.turns, 1);
  waitCore(s, h.env);
  assert.equal(s.flipped.length, 0);
  assert.equal(memoryCardOpen(s, 0), 0);
  assert(s.matched.every((v) => !v));
});
test('Memory Grove route rejects a discovered later pair fairly and advances only its visible current lantern', () => {
  const h = harness(),
    s = createMemoryState(h.env, 2),
    wrong = s.route[1],
    pair = s.deck.map((v, i) => (v === wrong ? i : -1)).filter((i) => i >= 0),
    before = structuredClone(s.deck);
  for (const i of pair) {
    chooseCore(s, h.env, i);
    waitCore(s, h.env);
  }
  assert.equal(s.feedback, 'order');
  assert.equal(s.routeIndex, 0);
  assert.equal(s.score, 0);
  assert(s.matched.every((v) => !v));
  assert.deepEqual(s.deck, before);
  const target = s.route[0];
  for (const i of s.deck.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0)) {
    chooseCore(s, h.env, i);
    waitCore(s, h.env);
  }
  assert.equal(s.routeIndex, 1);
  assert.equal(s.matched.filter(Boolean).length, 2);
  assert.equal(s.score, 120);
  assert.equal(s.turns, 2);
});
test('Memory Grove triples need three distinct fully opened equal cards before scoring', () => {
  const h = harness(),
    s = createMemoryState(h.env, 3),
    indices = s.deck.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  for (const i of indices.slice(0, 2)) {
    chooseCore(s, h.env, i);
    waitCore(s, h.env);
    assert.equal(s.score, 0);
    assert(s.matched.every((v) => !v));
  }
  chooseCore(s, h.env, indices[1]);
  assert.equal(s.flipped.length, 2);
  assert.equal(s.turns, 0);
  chooseCore(s, h.env, indices[2]);
  assert.equal(s.score, 0);
  for (let i = 0; i < 10; i++) stepMemory(s, 1 / 120, input(), h.env);
  assert.equal(s.score, 0);
  waitCore(s, h.env);
  assert.equal(s.score, 120);
  assert.equal(s.matched.filter(Boolean).length, 3);
  assert.equal(s.turns, 1);
});
test('Memory Grove card input at frame start precedes a later clock deadline', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  chooseCore(s, h.env, 0);
  waitCore(s, h.env);
  s.remaining = 0.005;
  const partner = s.deck.findIndex((v, i) => i > 0 && v === s.deck[0]);
  chooseCore(s, h.env, partner, 1 / 60);
  assert.equal(s.phase, 'playing');
  assert.equal(h.ends.length, 0);
  assert.equal(s.remaining, 0.005);
  assert.equal(s.mode, 'opening');
});
test('Memory Grove timed to relaxed rescue happens before expiry, cannot toggle back or farm points', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  chooseCore(s, h.env, 0);
  waitCore(s, h.env);
  s.remaining = 0.001;
  stepMemory(s, 1 / 30, input([], ['KeyT']), h.env);
  assert.equal(s.phase, 'playing');
  assert.equal(s.timed, false);
  assert.equal(s.remaining, 0.001);
  for (let i = 0; i < 60; i++) stepMemory(s, 1 / 30, input([], ['KeyT']), h.env);
  assert.equal(s.timed, false);
  assert.equal(s.remaining, 0.001);
  assert.equal(s.score, 0);
  assert.equal(h.ends.length, 0);
});
test('Memory Grove study is reusable, costs exactly five decision seconds, blocks flips and redacts after closing', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState().remaining;
  for (let use = 1; use <= 2; use++) {
    g.update(1 / 120, input([], ['KeyH']));
    assert.equal(g.getState().remaining, before - use * 5);
    for (let i = 0; i < 60; i++)
      g.update(1 / 120, input([], ['ArrowRight'], { x: 151, y: 95, clicked: true }));
    const open = g.getState();
    assert.equal(open.mode, 'study');
    assert(open.visible.every((v) => v !== null));
    assert.equal(open.flipped.length, 0);
    assert.equal(open.cursor, 0);
    g.update(1 / 120, input([], ['KeyH']));
    waitGame(g, 120);
    assert(g.getState().visible.every((v) => v === null));
    assert.equal(g.getState().helps, use);
    assert.equal(g.getState().score, 0);
  }
});
test('Memory Grove relaxed study waits indefinitely for deliberate close and permits learning at any pace', () => {
  const g = createGame(harness().env);
  g.update(1 / 60, input([], ['KeyT']));
  g.update(1 / 60, input([], ['KeyH']));
  for (let i = 0; i < 7200; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.timed, false);
  assert.equal(s.study.phase, 'hold');
  assert.equal(s.study.duration, null);
  assert(s.visible.every((v) => v !== null));
  assert.equal(s.remaining, 90);
  assert.equal(s.score, 0);
  g.update(1 / 60, input([], ['Space']));
  waitGame(g);
  assert.equal(g.getState().mode, 'ready');
  assert(g.getState().visible.every((v) => v === null));
});
test('Memory Grove insufficient study time has clear feedback and preserves time for relaxed recovery', () => {
  const h = harness(),
    s = createMemoryState(h.env);
  s.remaining = 4;
  stepMemory(s, 1 / 60, input([], ['KeyH']), h.env);
  assert.equal(s.mode, 'ready');
  assert.equal(s.feedback, 'need-time');
  assert.equal(s.remaining, 4);
  assert.equal(s.helps, 0);
  assert.equal(s.score, 0);
  stepMemory(s, 1 / 60, input([], ['KeyT']), h.env);
  stepMemory(s, 1 / 60, input([], ['KeyH']), h.env);
  assert.equal(s.mode, 'study');
  assert.equal(s.remaining, 4);
});
test('Memory Grove active feedback and study event boundaries retain exact time at30/60/120Hz', () => {
  const run = (hz, seconds, study = false) => {
    const h = harness({ seed: 4 }),
      s = createMemoryState(h.env);
    if (study) {
      s.stageStarted = true;
      stepMemory(s, 1 / 240, input([], ['KeyH']), h.env);
    } else {
      chooseCore(s, h.env, 0, 1 / 240);
      waitCore(s, h.env, 240);
      chooseCore(
        s,
        h.env,
        s.deck.findIndex((v) => v !== s.deck[0]),
        1 / 240,
      );
    }
    for (let i = 0; i < Math.round(hz * seconds); i++) stepMemory(s, 1 / hz, input(), h.env);
    return s;
  };
  for (const study of [false, true])
    for (const seconds of [0.1, 0.5, 1, 2, 3, 4]) {
      const states = [30, 60, 120].map((hz) => run(hz, seconds, study));
      for (const b of states.slice(1)) {
        const a = states[0];
        assert.equal(a.mode, b.mode);
        assert.equal(a.score, b.score);
        assert.deepEqual(a.flipped, b.flipped);
        assert.deepEqual(a.matched, b.matched);
        assert(Math.abs(a.remaining - b.remaining) < 1e-8);
        assert(Math.abs(a.time - b.time) < 1e-8);
        for (let i = 0; i < 12; i++)
          assert(Math.abs(memoryCardOpen(a, i) - memoryCardOpen(b, i)) < 1e-8);
      }
    }
});
test('Memory Grove zero and invalid time preserve every animation phase without input, RNG or sound consumption', () => {
  const h = harness(),
    s = createMemoryState(h.env),
    phases = new Set();
  chooseCore(s, h.env, 0);
  waitCore(s, h.env);
  chooseCore(
    s,
    h.env,
    s.deck.findIndex((v) => v !== s.deck[0]),
  );
  for (let i = 0; i < 2000 && phases.size < 3; i++) {
    if (['opening', 'reveal', 'closing'].includes(s.mode) && !phases.has(s.mode)) {
      phases.add(s.mode);
      const before = structuredClone(s),
        sounds = h.sounds.length;
      for (const dt of [0, -1, NaN, Infinity])
        stepMemory(s, dt, input([], ['Space', 'KeyT', 'KeyH', 'ArrowRight']), h.env);
      assert.deepEqual(s, before);
      assert.equal(h.sounds.length, sounds);
    }
    stepMemory(s, 1 / 120, input(), h.env);
  }
  assert.equal(phases.size, 3);
});
test('Memory Grove full campaigns use only learned visible cards with keyboard controls at30/60/120Hz', () => {
  for (const seed of [1, 9, 36])
    for (const hz of [30, 60, 120]) {
      const result = learnedCampaign(seed, hz);
      assert(result.mismatches > 0);
    }
});
test('Memory Grove pointer and reusable relaxed study also complete all distinct clearings', () => {
  learnedCampaign(17, 60, { keyboard: false });
  learnedCampaign(29, 60, { relaxed: true, study: true });
});
test('Memory Grove final successful group cannot expire during forced feedback and Next needs fresh intent', () => {
  for (const stage of [1, 2, 3]) {
    const h = harness(),
      s = createMemoryState(h.env, stage),
      target = s.rule === 'route' ? s.route.at(-1) : s.deck[0],
      last = s.deck.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0);
    s.matched = s.deck.map((v) => v !== target);
    s.routeIndex = stage === 2 ? 5 : 0;
    for (const i of last.slice(0, -1)) {
      chooseCore(s, h.env, i);
      waitCore(s, h.env);
    }
    s.remaining = 0.005;
    chooseCore(s, h.env, last.at(-1));
    for (let i = 0; i < 120 && s.mode !== 'garden-clear' && s.phase === 'playing'; i++)
      stepMemory(s, 1 / 120, input([], ['Space']), h.env);
    assert(s.remaining > 0);
    if (stage < 3) {
      assert.equal(s.stage, stage);
      assert.equal(s.mode, 'garden-clear');
      assert.equal(h.ends.length, 0);
      stepMemory(s, 1 / 120, input(['Space']), h.env);
      assert.equal(s.stage, stage);
      stepMemory(s, 1 / 120, input([], ['Enter']), h.env);
      assert.equal(s.stage, stage + 1);
      assert.equal(s.flipped.length, 0);
      assert.equal(s.stageStarted, false);
    } else {
      assert.equal(s.phase, 'won');
      assert.equal(h.ends.length, 1);
    }
  }
});
test('Memory Grove timeout is reachable once, terminal is frozen and a fresh instance restores resources', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 4000; i++) g.update(1 / 30, input());
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].message.includes('空地'));
  const terminal = g.getState();
  for (let i = 0; i < 120; i++) g.update(1 / 30, input([], ['KeyT', 'KeyH', 'Space']));
  assert.deepEqual(g.getState(), terminal);
  assert.equal(h.ends.length, 1);
  g.draw(mockContext());
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.score, 0);
  assert.equal(fresh.helps, 0);
  assert.equal(fresh.remaining, 90);
  assert.equal(fresh.started, false);
  assert(fresh.deck.every((v) => v === null));
});
test('Memory Grove keyboard and touch expose all actions and opposing/diagonal chords do not move focus', () => {
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyH', 'KeyT'])
    assert(meta.touchControls.some((c) => c.code === code));
  const g = createGame(harness().env);
  for (const keys of [
    ['ArrowLeft', 'ArrowRight'],
    ['ArrowUp', 'ArrowDown'],
    ['ArrowRight', 'ArrowDown'],
  ])
    g.update(1 / 60, input([], keys));
  assert.equal(g.getState().cursor, 0);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().cursor, 3);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().cursor, 11);
  g.update(1 / 60, input(['ArrowRight']));
  assert.equal(g.getState().cursor, 11);
});
test('Memory Grove seeded mixed inputs stay finite and bounded across all modes with safe rendering', () => {
  for (const seed of [1, 17, 29]) {
    const g = createGame(harness({ seed }).env),
      random = seeded(seed),
      keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyH', 'KeyT', 'Enter'];
    for (let i = 0; i < 3600; i++) {
      g.update(
        1 / 60,
        input([], random() < 0.2 ? [keys[Math.floor(random() * keys.length)]] : [], {
          x: 120 + Math.floor(random() * 4) * 62 + 31,
          y: 62 + Math.floor(random() * 3) * 66 + 33,
          clicked: random() < 0.1,
        }),
      );
      const s = g.getState();
      assert(
        Number.isFinite(s.remaining) &&
          s.remaining >= 0 &&
          Number.isFinite(s.time) &&
          Number.isFinite(s.score),
      );
      assert(s.score <= 2600);
      assert.equal(s.deck.length, 12);
      assert(s.flipped.length <= s.groupSize);
      assert.equal(new Set(s.flipped).size, s.flipped.length);
      assert(s.cursor >= 0 && s.cursor < 12);
      if (i % 300 === 0) g.draw(mockContext());
    }
  }
});
