import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, neighbors } from '../src/games/minefield.js';
import { harness, input, mockContext, seeded } from './harness.js';
const press = (g, k, hz = 60) => g.update(1 / hz, input([], [k]));
const tap = (g, i, keys = []) => {
  const s = g.getState(),
    l = s.layout;
  g.update(
    1 / 60,
    input([], keys, {
      clicked: true,
      x: l.x + ((i % s.width) + 0.5) * l.cell,
      y: l.y + (Math.floor(i / s.width) + 0.5) * l.cell,
    }),
  );
};
function campaign(seed, hz, difficulty = 1, lang = 'en') {
  const h = harness({ seed, lang }),
    g = createGame(h.env);
  for (let n = 1; n < difficulty; n++) press(g, 'KeyG', hz);
  const stages = [];
  let actions = 0;
  while (g.getState().phase === 'playing' && actions++ < 500) {
    const s = g.getState();
    if (s.betweenStages) {
      g.draw(mockContext());
      stages.push(s.level);
      const before = g.getState();
      press(g, 'Space', hz);
      assert.deepEqual(g.getState(), before);
      press(g, 'Enter', hz);
      continue;
    }
    if (!s.started) {
      press(g, 'Space', hz);
      continue;
    }
    // H provides a proof from displayed clues. No hidden arrays select actions.
    press(g, 'KeyH', hz);
    const hinted = g.getState();
    assert.ok(hinted.hint, `stalled seed${seed} ${hz}Hz stage${s.level}: ${hinted.notice.en}`);
    if (hinted.hint.type === 'safe') {
      while (g.getState().flags[hinted.cursor]) press(g, 'KeyF', hz);
      press(g, 'Space', hz);
    } else press(g, 'KeyF', hz);
  }
  const s = g.getState();
  assert.equal(s.phase, 'won');
  assert.deepEqual(stages, [1, 2]);
  assert.equal(s.level, 3);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  const before = g.getState();
  for (const k of ['Enter', 'Space', 'KeyV', 'KeyX']) press(g, k, hz);
  assert.deepEqual(g.getState(), before);
  g.draw(mockContext());
  return { g, h, s, actions };
}
test('Minefield complete three-site campaigns use public visible proofs at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120])
    for (const difficulty of [1, 2, 3])
      for (const seed of [1, 42]) campaign(seed, hz, difficulty, hz === 120 ? 'zh' : 'en');
});
test('Minefield all three sites preserve mines and numbers after flags, hints, inspection and probes', () => {
  const { g } = campaign(7, 60);
  assert.equal(g.getState().phase, 'won');
  const game = createGame(harness().env);
  press(game, 'Space');
  const initial = game.getState(),
    before = { mines: initial.mines, numbers: initial.numbers, regions: initial.regions };
  for (const k of ['KeyI', 'KeyH', 'KeyF', 'KeyX', 'KeyV']) press(game, k);
  const after = game.getState();
  assert.deepEqual({ mines: after.mines, numbers: after.numbers, regions: after.regions }, before);
});
test('Minefield an incorrect safe flag can be proved, cleared and revealed without a paid helper', () => {
  const g = createGame(harness().env);
  press(g, 'Space');
  press(g, 'KeyH');
  let s = g.getState();
  assert.equal(s.hint.type, 'safe');
  const i = s.cursor,
    probes = s.probes;
  press(g, 'KeyF');
  press(g, 'KeyH');
  assert.equal(g.getState().cursor, i);
  assert.match(g.getState().notice.en, /mistaken flag/);
  press(g, 'KeyF');
  press(g, 'Space');
  s = g.getState();
  assert.equal(s.revealed[i], true);
  assert.equal(s.flags[i], false);
  assert.equal(s.probes, probes);
});
test('Minefield probes verify fixed mines, clear wrong safe flags, and avoid duplicate charges', () => {
  const g = createGame(harness().env);
  press(g, 'KeyX');
  assert.equal(g.getState().probes, 3);
  press(g, 'Space');
  let s = g.getState();
  const mines = s.mines.slice(),
    mine = s.mines.findIndex(Boolean);
  tap(g, mine, ['KeyI']);
  press(g, 'KeyX');
  s = g.getState();
  assert.equal(s.probes, 2);
  assert.equal(s.verified[mine], true);
  assert.equal(s.flags[mine], true);
  press(g, 'KeyF');
  assert.equal(g.getState().flags[mine], true);
  press(g, 'KeyX');
  assert.equal(g.getState().probes, 2);
  const safe = s.revealed.findIndex((v, i) => !v && !s.mines[i]);
  tap(g, safe, ['KeyI']);
  press(g, 'KeyF');
  press(g, 'KeyX');
  assert.equal(g.getState().revealed[safe], true);
  assert.equal(g.getState().flags[safe], false);
  assert.deepEqual(g.getState().mines, mines);
});
test('Minefield empty probes leave free logical recovery available', () => {
  const g = createGame(harness().env);
  press(g, 'Space');
  for (let n = 0; n < 3; n++) {
    const s = g.getState(),
      i = s.mines.findIndex((v, j) => v && !s.verified[j]);
    tap(g, i, ['KeyI']);
    press(g, 'KeyX');
  }
  assert.equal(g.getState().probes, 0);
  const s = g.getState(),
    i = s.mines.findIndex((v, j) => v && !s.verified[j]);
  tap(g, i, ['KeyI']);
  press(g, 'KeyX');
  assert.match(g.getState().notice.en, /No probes/);
  press(g, 'KeyH');
  assert.ok(g.getState().hint);
  assert.equal(g.getState().probes, 0);
});
test('Minefield correct chords open their full safe union exactly once', () => {
  const h = harness(),
    g = createGame(h.env);
  press(g, 'Space');
  let s = g.getState();
  const number = s.revealed.findIndex(
    (v, i) =>
      v &&
      s.numbers[i] > 0 &&
      neighbors(i, s.width, s.height).some((j) => !s.revealed[j] && !s.mines[j]),
  );
  assert.ok(number >= 0);
  for (const i of neighbors(number, s.width, s.height).filter((j) => s.mines[j]))
    tap(g, i, ['KeyF']);
  s = g.getState();
  const count = s.revealed.filter(Boolean).length,
    score = s.score;
  tap(g, number, ['KeyC']);
  const after = g.getState(),
    delta = after.revealed.filter(Boolean).length - count;
  assert.ok(delta > 0);
  assert.equal(after.score - score, delta * 10 + (after.betweenStages ? 500 : 0));
  tap(g, number, ['KeyC']);
  assert.equal(g.getState().score, after.score);
});
test('Minefield rubble ignores taps and navigation stays on active ground in each site', () => {
  const { s } = campaign(2, 30);
  assert.equal(s.level, 3);
  const h = harness(),
    g = createGame(h.env);
  let guard = 0;
  while (!g.getState().betweenStages && guard++ < 150) {
    if (!g.getState().started) press(g, 'Space');
    else {
      press(g, 'KeyH');
      const a = g.getState();
      press(g, a.hint.type === 'safe' ? 'Space' : 'KeyF');
    }
  }
  press(g, 'Enter');
  const quarry = g.getState(),
    rock = quarry.mask.findIndex((v) => !v),
    before = quarry.cursor;
  tap(g, rock);
  assert.equal(g.getState().cursor, before);
  for (let n = 0; n < 40; n++) {
    press(g, 'ArrowRight');
    assert.equal(g.getState().mask[g.getState().cursor], true);
    press(g, 'ArrowUp');
    assert.equal(g.getState().mask[g.getState().cursor], true);
  }
});
test('Minefield seeded public action traces remain finite, bounded and draw in both languages', () => {
  for (const lang of ['en', 'zh'])
    for (const seed of [1, 9, 31]) {
      const h = harness({ seed, lang }),
        g = createGame(h.env),
        r = seeded(seed),
        keys = [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'KeyF',
          'KeyV',
          'KeyI',
          'KeyH',
          'KeyX',
          'Space',
          'KeyC',
          'KeyG',
        ];
      for (let n = 0; n < 300; n++) {
        press(g, keys[Math.floor(r() * keys.length)], [30, 60, 120][n % 3]);
        const s = g.getState();
        assert.ok(
          Number.isFinite(s.score) && Number.isFinite(s.elapsed) && Number.isFinite(s.totalElapsed),
        );
        assert.ok(s.cursor >= 0 && s.cursor < s.mask.length && s.mask[s.cursor]);
        assert.ok(s.probes >= 0 && s.probes <= 3);
        assert.ok(s.revealed.every((v, i) => !v || (s.mask[i] && !s.mines[i])));
        if (n % 30 === 0) g.draw(mockContext());
        assert.ok(h.ends.length <= 1);
      }
    }
});

test('Minefield inspection explains flags and hints are free before an opening', () => {
  const g = createGame(harness().env);
  press(g, 'KeyH');
  assert.match(g.getState().notice.en, /protected/);
  press(g, 'KeyI');
  assert.match(g.getState().notice.en, /first opening/);
  press(g, 'Space');
  let s = g.getState();
  const number = s.revealed.findIndex((v, i) => v && s.numbers[i] > 0);
  tap(g, number, ['KeyI']);
  assert.match(g.getState().notice.en, /Compare nearby/);
  for (const i of neighbors(number, s.width, s.height)
    .filter((j) => !s.revealed[j])
    .slice(0, s.numbers[number] + 1))
    tap(g, i, ['KeyF']);
  tap(g, number, ['KeyI']);
  assert.match(g.getState().notice.en, /Too many/);
  g.draw(mockContext());
});

test('Minefield two-second held cursor movement has the same repeat count at 30/60/120Hz', () => {
  const outcomes = [];
  for (const hz of [30, 60, 120]) {
    const g = createGame(harness().env);
    for (let n = 0; n < hz * 2; n++) g.update(1 / hz, input(['ArrowRight']));
    outcomes.push(g.getState().cursor);
  }
  assert.deepEqual(outcomes, [43, 43, 43]);
});
