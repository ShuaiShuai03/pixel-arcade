import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, makeDeck, meta } from '../src/games/memory-grove.js';
import {
  ECHO_BAD,
  FLIP,
  createLevelState,
  memoryCardOpen,
  nextLevelState,
  stepMemory,
} from '../src/games/memory-grove-rules.js';
import {
  LEVELS,
  LEVEL_COUNT,
  RULE_NAMES,
  SHORTEST_CUE,
  SHORTEST_SHOW,
  levelBand,
} from '../src/games/memory-grove-levels.js';
import { menuCell, menuTarget } from '../src/games/memory-grove-menu.js';
import { promptText, wrapText } from '../src/games/memory-grove-text.js';
import { harness, input, seeded } from './harness.js';

const noSound = () => {};
const HZ = 120;
const idle = () => input();
const click = (c) => input([], [], { x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true });
const run = (s, seconds, make = idle) => {
  for (let i = 0; i < seconds * HZ; i++) stepMemory(s, 1 / HZ, make(), noSound);
};
const untilMode = (s, mode) => {
  for (let i = 0; i < 20 * HZ && s.mode !== mode && s.phase === 'playing'; i++)
    stepMemory(s, 1 / HZ, idle(), noSound);
};
const turn = (s, index) => {
  stepMemory(s, 1 / HZ, click(LEVELS[s.level - 1].layout.cards[index]), noSound);
  run(s, FLIP + 0.01);
};
const ready = (level, seed = 1) => {
  const s = createLevelState(level, seeded(seed));
  s.t = s.dur;
  untilMode(s, 'ready');
  return s;
};
const partnerOf = (s, i) => s.deck.findIndex((v, k) => k !== i && v === s.deck[i]);
const strangerOf = (s, i) => s.deck.findIndex((v) => v !== s.deck[i]);

test('twenty frozen levels follow a teaching, combination and mastery curve', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert(
    Object.isFrozen(LEVELS) && LEVELS.every((l) => Object.isFrozen(l) && Object.isFrozen(l.layout)),
  );
  const rules = new Set(LEVELS.map((l) => l.rule));
  assert.deepEqual([...rules].sort(), ['echo', 'pairs', 'route', 'triples']);
  assert.deepEqual(Object.keys(RULE_NAMES).sort(), [...rules].sort());
  const names = new Set();
  for (const [n, l] of LEVELS.entries()) {
    assert.equal(l.layout.cards.length, l.count, `level ${n + 1} card count`);
    if (l.rule !== 'echo') assert.equal(l.symbols * l.group, l.count);
    else assert(l.echo.to <= l.count && l.symbols <= 10 && l.echo.from <= l.echo.to);
    assert(l.symbols <= 10);
    for (const lang of ['en', 'zh']) {
      assert(l.name[lang].length > 1 && l.tip[lang].length > 10);
      names.add(l.name[lang]);
    }
    assert(l.show >= SHORTEST_SHOW && (!l.echo || l.echo.cue >= SHORTEST_CUE));
    if (l.preview) assert(l.preview >= 2, `level ${n + 1} preview`);
    for (const c of l.layout.cards)
      assert(c.x >= 112 && c.x + c.w <= 368 && c.y >= 54 && c.y + c.h <= 272);
  }
  assert.equal(names.size, 40);
  assert.deepEqual([1, 7, 8, 14, 15, 20].map(levelBand), [0, 0, 1, 1, 2, 2]);
  // Teaching levels preview; mastery levels do not, and cues get shorter.
  assert([0, 1, 2, 3, 6].every((i) => LEVELS[i].preview >= 3));
  assert(
    LEVELS.slice(14)
      .filter((_, i) => i !== 1)
      .every((l) => l.preview === 0),
  );
  const cues = LEVELS.filter((l) => l.echo).map((l) => l.echo.cue);
  assert.deepEqual(
    cues,
    [...cues].sort((a, b) => b - a),
  );
  const lengths = LEVELS.filter((l) => l.echo).map((l) => l.echo.to);
  assert.deepEqual(
    lengths,
    [...lengths].sort((a, b) => a - b),
  );
});
test('meta documents keys and touch covers every action', () => {
  assert.equal(meta.id, 'memory-grove');
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyT'])
    assert(codes.includes(code));
  assert(meta.description.en.includes('twenty') && meta.description.zh.includes('二十'));
});
test('decks hold exact multiplicities and are deterministic', () => {
  for (const [symbols, copies] of [
    [6, 2],
    [4, 3],
    [10, 2],
  ])
    for (const seed of [1, 8]) {
      const deck = makeDeck(symbols, seeded(seed), copies);
      for (let v = 0; v < symbols; v++) assert.equal(deck.filter((d) => d === v).length, copies);
      assert.deepEqual(deck, makeDeck(symbols, seeded(seed), copies));
    }
  assert.throws(() => makeDeck(0, () => 0), RangeError);
  assert.throws(() => makeDeck(2, () => 0, 1), RangeError);
});
test('a matching pair stays open, scores with a streak, and clears the clearing', () => {
  const s = ready(1);
  assert.equal(s.mode, 'ready');
  for (let i = 0; i < 3; i++) {
    const first = s.deck.findIndex((_, k) => !s.matched[k]);
    turn(s, first);
    turn(s, partnerOf(s, first));
    assert.equal(s.mode, 'reveal');
    untilMode(s, i === 2 ? 'level-clear' : 'ready');
  }
  assert.equal(s.mode, 'level-clear');
  assert(s.matched.every(Boolean) && memoryCardOpen(s, 0) === 1);
  assert.equal(s.score, 120 + 140 + 160 + 150);
  assert.equal(s.bestStreak, 3);
});
test('a wrong pair costs a leaf, stays open for its full show time, then closes', () => {
  const s = ready(3);
  turn(s, 0);
  turn(s, strangerOf(s, 0));
  assert.equal(s.lives, LEVELS[2].lives - 1);
  assert.equal(s.feedback, 'mismatch');
  run(s, LEVELS[2].show - 0.05);
  assert.equal(s.mode, 'reveal');
  assert.equal(memoryCardOpen(s, 0), 1);
  run(s, 0.1);
  assert.equal(s.mode, 'closing');
  assert(memoryCardOpen(s, 0) < 1);
  untilMode(s, 'ready');
  assert.deepEqual(s.flipped, []);
});
test('losing the last leaf ends the visit once the wrong cards have been shown', () => {
  const s = ready(3);
  s.lives = 1;
  turn(s, 0);
  turn(s, strangerOf(s, 0));
  assert.equal(s.phase, 'playing');
  untilMode(s, 'terminal');
  assert.equal(s.phase, 'lost');
});
test('lantern order: a right pair out of order counts as a slip', () => {
  const s = ready(5);
  const wrong = s.route.find((v) => v !== s.route[s.routeIndex]);
  const a = s.deck.indexOf(wrong);
  turn(s, a);
  turn(s, partnerOf(s, a));
  assert.equal(s.feedback, 'order');
  assert.equal(s.routeIndex, 0);
  assert.equal(s.lives, LEVELS[4].lives - 1);
  untilMode(s, 'ready');
  const target = s.deck.indexOf(s.route[0]);
  turn(s, target);
  turn(s, partnerOf(s, target));
  assert.equal(s.routeIndex, 1);
});
test('triples are checked together and a lone odd card breaks the group', () => {
  const s = ready(7);
  const first = s.deck.indexOf(0);
  const mates = s.deck.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  turn(s, mates[0]);
  turn(s, mates[1]);
  assert.equal(s.mode, 'ready');
  assert.equal(s.flipped.length, 2);
  turn(s, mates[2]);
  assert.equal(s.correct, true);
  assert(first >= 0);
  untilMode(s, 'ready');
  const odd = s.deck.findIndex((v, i) => v === 1 && !s.matched[i]);
  turn(s, odd);
  turn(
    s,
    s.deck.findIndex((v, i) => v === 2 && !s.matched[i]),
  );
  turn(
    s,
    s.deck.findIndex((v, i) => v === 1 && i !== odd && !s.matched[i]),
  );
  assert.equal(s.correct, false);
  assert.equal(s.lives, LEVELS[6].lives - 1);
});
test('echo: cues light in order with the timing from the level data, then must be repeated', () => {
  const s = createLevelState(10, seeded(3));
  assert.equal(s.mode, 'listen');
  const lit = [];
  const seen = [];
  for (let i = 0; i < 12 * HZ && s.mode !== 'ready'; i++) {
    stepMemory(s, 1 / HZ, idle(), noSound);
    if (s.echo.lit >= 0 && lit[lit.length - 1] !== s.echo.lit) {
      lit.push(s.echo.lit);
      seen.push(s.t);
    }
  }
  assert.deepEqual(lit, s.sequence.slice(0, 3));
  assert.equal(s.mode, 'ready');
  assert.equal(memoryCardOpen(s, lit[0]), 0);
  turn(s, s.sequence[0]);
  assert.equal(s.echo.input, 1);
  assert.equal(s.feedback, 'echo-ok');
  untilMode(s, 'ready');
  const wrong = [0, 1, 2, 3].find((i) => i !== s.sequence[1]);
  turn(s, wrong);
  assert.equal(s.lives, LEVELS[9].lives - 1);
  run(s, ECHO_BAD - 0.05);
  assert.equal(s.mode, 'reveal');
  untilMode(s, 'listen');
  assert.equal(s.echo.input, 0);
  untilMode(s, 'ready');
  for (let k = 0; k < 3; k++) {
    turn(s, s.sequence[k]);
    untilMode(s, k < 2 ? 'ready' : 'listen');
  }
  assert.equal(s.echo.length, 4);
});
test('the decision clock only runs between turns after the first card, and T relaxes it', () => {
  const s = ready(8);
  run(s, 5);
  assert.equal(s.remaining, 70);
  turn(s, 0);
  turn(s, partnerOf(s, 0));
  const spent = s.remaining;
  assert(spent > 69.9);
  run(s, 0.5);
  assert.equal(s.remaining, spent);
  untilMode(s, 'ready');
  const afterReveal = s.remaining;
  run(s, 2);
  assert(Math.abs(afterReveal - s.remaining - 2) < 1e-6);
  stepMemory(s, 1 / HZ, input([], ['KeyT']), noSound);
  assert.equal(s.timed, false);
  run(s, 100);
  assert.equal(s.phase, 'playing');
  stepMemory(s, 1 / HZ, input([], ['KeyT']), noSound);
  assert.equal(s.feedback, 'relaxed');
  assert.equal(s.timed, false);
});
test('T toggles freely before the first card and is explained where there is no clock', () => {
  const s = ready(8);
  stepMemory(s, 1 / HZ, input([], ['KeyT']), noSound);
  assert.equal(s.timed, false);
  stepMemory(s, 1 / HZ, input([], ['KeyT']), noSound);
  assert.equal(s.timed, true);
  const free = ready(3);
  stepMemory(free, 1 / HZ, input([], ['KeyT']), noSound);
  assert.equal(free.feedback, 'no-clock');
});
test('running out of decision time loses', () => {
  const s = ready(8);
  turn(s, 0);
  turn(s, partnerOf(s, 0));
  untilMode(s, 'ready');
  s.remaining = 0.05;
  run(s, 0.2);
  assert.equal(s.phase, 'lost');
  assert.equal(s.remaining, 0);
});
test('previews can be skipped with a key or a tap and never carry the input into a flip', () => {
  const s = createLevelState(1, seeded(1));
  assert.equal(s.mode, 'preview');
  assert(memoryCardOpen(s, 0) === 0);
  run(s, 1);
  assert.equal(memoryCardOpen(s, 0), 1);
  stepMemory(s, 1 / HZ, input([], ['Space']), noSound);
  run(s, FLIP + 0.05);
  assert.equal(s.mode, 'ready');
  assert.deepEqual(s.flipped, []);
  const tapped = createLevelState(1, seeded(1));
  stepMemory(tapped, 1 / HZ, click(LEVELS[0].layout.cards[2]), noSound);
  run(tapped, FLIP + 0.05);
  assert.equal(tapped.mode, 'ready');
  assert.deepEqual(tapped.flipped, []);
});
test('keyboard focus wraps and Space turns the focused card; gaps and bad pointers do nothing', () => {
  const s = ready(3);
  const press = (...codes) => stepMemory(s, 1 / HZ, input([], codes), noSound);
  press('ArrowLeft');
  assert.equal(s.cursor, 3);
  press('ArrowUp');
  assert.equal(s.cursor, 11);
  press('KeyD');
  assert.equal(s.cursor, 8);
  press('KeyS');
  assert.equal(s.cursor, 0);
  press('ArrowRight', 'ArrowLeft');
  assert.equal(s.cursor, 0);
  const c = LEVELS[2].layout.cards[0];
  for (const pointer of [
    { x: c.x - 2, y: c.y - 2 },
    { x: NaN, y: 10 },
    { x: Infinity, y: -Infinity },
    { x: '5', y: null },
  ])
    stepMemory(s, 1 / HZ, input([], [], { ...pointer, clicked: true }), noSound);
  assert.deepEqual(s.flipped, []);
  stepMemory(s, 1 / HZ, { held: () => false, pressed: () => false }, noSound);
  press('Space');
  assert.deepEqual(s.flipped, [0]);
  run(s, FLIP * 0.5);
  assert.equal(s.mode, 'opening');
  assert(memoryCardOpen(s, 0) > 0 && memoryCardOpen(s, 0) < 1);
  press('Space');
  assert.equal(s.flipped.length, 1);
  untilMode(s, 'ready');
  press('Space');
  assert.equal(s.feedback, 'already');
});
test('Next works by key and by tap and carries score; the last clearing ends in a win', () => {
  const s = ready(1);
  s.mode = 'level-clear';
  s.score = 500;
  s.timed = false;
  stepMemory(s, 1 / HZ, input([], ['Enter']), noSound);
  assert(s.next);
  const n = nextLevelState(s, seeded(2));
  assert.equal(n.level, 2);
  assert.equal(n.score, 500);
  assert.equal(n.timed, false);
  const tap = ready(1);
  tap.mode = 'level-clear';
  stepMemory(tap, 1 / HZ, input([], [], { x: 200, y: 290, clicked: true }), noSound);
  assert(tap.next);
  const miss = ready(1);
  miss.mode = 'level-clear';
  stepMemory(miss, 1 / HZ, input([], [], { x: 10, y: 10, clicked: true }), noSound);
  assert.equal(miss.next, false);
  assert.equal(createLevelState(99, seeded(1)).level, LEVEL_COUNT);
  assert.equal(createLevelState(-3, seeded(1)).level, 1);
});
test('clearing the last level wins and a state that has ended ignores everything', () => {
  const s = ready(LEVEL_COUNT);
  s.sequence = s.sequence.slice(0, 1);
  s.echo.length = 1;
  turn(s, s.sequence[0]);
  untilMode(s, 'terminal');
  assert.equal(s.phase, 'won');
  const frozen = JSON.stringify(s);
  run(s, 3, () => input(['ArrowRight'], ['Space', 'KeyT'], { x: 200, y: 100, clicked: true }));
  assert.equal(JSON.stringify(s), frozen);
});
test('the select screen moves, denies locked clearings and starts the chosen one', () => {
  const store = { value: 6 };
  const h = harness();
  const g = createGame({ ...h.env, progress: { unlocked: () => store.value, unlock() {} } });
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 5);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['KeyW']));
  assert.equal(g.getState().menu.cursor, 1);
  const locked = menuCell(10);
  g.update(1 / 60, input([], [], { x: locked.x + 3, y: locked.y + 3, clicked: true }));
  assert.equal(g.getState().menu.cursor, 1);
  assert(h.sounds.includes('hit'));
  const open = menuCell(4);
  g.update(1 / 60, input([], [], { x: open.x + 3, y: open.y + 3, clicked: true }));
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 4);
  assert.equal(menuTarget(input(), 3, 2).cursor, 2);
});
test('prompts and wrapping stay readable', () => {
  const s = ready(3);
  const en = (a) => a;
  const zh = (_, b) => b;
  for (const level of [1, 4, 7, 10, 20]) {
    const t = createLevelState(level, seeded(1));
    const modes = ['preview', 'ready', 'reveal', 'level-clear'];
    for (const mode of t.echo ? [...modes, 'listen', 'cue-on'] : modes) {
      t.mode = mode;
      t.feedbackTime = 0;
      t.step = 0;
      assert(promptText(t, en).length > 5 && promptText(t, zh).length > 3);
    }
  }
  s.phase = 'won';
  assert(promptText(s, en).includes('RESTORED'));
  s.phase = 'lost';
  assert(promptText(s, zh).includes('睡着'));
  const lines = wrapText('A long tip about remembering the symbols you saw earlier today', 10, 120);
  assert(lines.length > 1 && lines.join(' ').includes('symbols'));
  assert.deepEqual(wrapText('', 10, 100), []);
  assert(wrapText('一二三四五六七八九十'.repeat(3), 10, 100).length > 2);
});

test('taps and Space during an animation lock wait and fire the moment the board is ready', () => {
  const s = ready(10);
  untilMode(s, 'ready');
  const send = (index) => stepMemory(s, 1 / HZ, click(LEVELS[9].layout.cards[index]), noSound);
  for (let k = 0; k < 3; k++) {
    send(s.sequence[k]);
    run(s, 0.4 - 1 / HZ);
  }
  assert(s.queue.length <= 2);
  run(s, 3);
  assert.equal(s.echo.length, 4);
  assert.equal(s.lives, LEVELS[9].lives);
});
test('queued taps are dropped when the cues replay, and arrows move during locks', () => {
  const s = ready(10);
  untilMode(s, 'ready');
  const wrong = [0, 1, 2, 3, 4].find((i) => i !== s.sequence[0]);
  const card = (i) => click(LEVELS[9].layout.cards[i]);
  stepMemory(s, 1 / HZ, card(wrong), noSound);
  run(s, 0.1);
  stepMemory(s, 1 / HZ, card(s.sequence[0]), noSound);
  const before = s.cursor;
  stepMemory(s, 1 / HZ, input([], ['ArrowRight']), noSound);
  assert.equal(s.cursor, (before + 1) % 6);
  assert.equal(s.queue.length, 1);
  untilMode(s, 'listen');
  assert.deepEqual(s.queue, []);
});
test('a pointer click that misses every card does not swallow a same-frame Space', () => {
  const s = ready(3);
  stepMemory(s, 1 / HZ, input([], ['Space'], { x: 1, y: 1, clicked: true }), noSound);
  assert.deepEqual(s.flipped, [0]);
});
test('queued taps give identical results at every frame rate', () => {
  const outcomes = [30, 60, 120].map((hz) => {
    const s = ready(10);
    untilMode(s, 'ready');
    for (let k = 0; k < 3; k++) {
      stepMemory(s, 1 / hz, click(LEVELS[9].layout.cards[s.sequence[k]]), noSound);
      for (let i = 0; i < 0.4 * hz - 1; i++) stepMemory(s, 1 / hz, idle(), noSound);
    }
    for (let i = 0; i < 3 * hz; i++) stepMemory(s, 1 / hz, idle(), noSound);
    return [s.echo.input, s.echo.length, s.lives, s.score, s.mode];
  });
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(outcomes[2], outcomes[0]);
});
