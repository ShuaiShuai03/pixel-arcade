import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta } from '../src/games/minefield.js';
import { LEVELS, LEVEL_COUNT, levelOf, planOf, tipOf } from '../src/games/minefield-levels.js';
import {
  certifiedField,
  createField,
  deductionSolves,
  neighbors,
  openingCells,
  revealCells,
} from '../src/games/minefield-field.js';
import { deduceVisible } from '../src/games/minefield-solver.js';
import { modeButtonAt, MODE_BUTTON } from '../src/games/minefield-actions.js';
import { menuCell, menuTarget } from '../src/games/minefield-menu.js';
import { noticeLines } from '../src/games/minefield-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

const key = (g, ...k) => g.update(1 / 60, input([], k));
const tapCell = (g, i, keys = []) => {
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
/** Field `level` opened at its cursor; `field` is the identical certified layout, for tests only. */
function scene(level, seed = 1) {
  const h = harness({ seed });
  h.env.progress = { unlocked: () => level, unlock() {} };
  const g = createGame(h.env);
  if (level > 1) key(g, 'Space');
  const first = g.getState().cursor;
  key(g, 'Space');
  return { h, g, field: certifiedField(planOf(level), first, seeded(seed)) };
}

test('meta describes a 20-field game and every touch control maps to a handled key', () => {
  assert.equal(meta.id, 'minefield');
  assert.match(meta.description.en, /20 fields/);
  const handled = ['KeyV', 'KeyI', 'KeyH', 'Space', 'KeyF', 'KeyC', 'KeyX', 'Enter'];
  assert.deepEqual(meta.touchControls.map((c) => c.code).sort(), handled.sort());
});

test('level data is frozen, ordered by size and every plan keeps its active ground connected', () => {
  assert.ok(
    Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0].name) && Object.isFrozen(LEVELS[0].teach),
  );
  assert.equal(levelOf(0), LEVELS[0]);
  assert.equal(levelOf(99), LEVELS[LEVEL_COUNT - 1]);
  assert.equal(tipOf(LEVELS[0]).zh, LEVELS[0].teach.zh);
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const p = planOf(n),
      active = p.mask.flatMap((v, i) => (v ? [i] : [])),
      seen = new Set([active[0]]),
      queue = [active[0]];
    for (const i of queue)
      for (const j of neighbors(i, p.w, p.h))
        if (p.mask[j] && !seen.has(j)) (seen.add(j), queue.push(j));
    assert.equal(seen.size, active.length, `field ${n} connected`);
    assert.ok(p.count + 9 <= active.length);
    assert.equal(
      p.regions.reduce((sum, r) => sum + r.cells.length, 0),
      p.regions.length ? active.length : 0,
    );
  }
});

test('mines avoid the opening and its neighbors, hints pre-open numbered safe tiles, bad input throws', () => {
  for (const n of [1, 6, 16, 20]) {
    const p = planOf(n),
      first = p.mask.findIndex(Boolean) + p.w + 1,
      f = createField(p, first, seeded(n));
    assert.equal(f.mines.filter(Boolean).length, p.count);
    for (const i of [first, ...neighbors(first, p.w, p.h)]) assert.equal(f.mines[i], false);
    assert.equal(f.opening.length, 1 + p.hints);
    assert.ok(f.opening.slice(1).every((i) => !f.mines[i] && f.numbers[i] > 0));
    assert.ok(Object.isFrozen(f.mines) && Object.isFrozen(f.opening));
    assert.ok(openingCells(f).filter(Boolean).length >= f.opening.length);
    f.regions.forEach((r) => assert.equal(r.total, r.cells.filter((i) => f.mines[i]).length));
  }
  const p = planOf(5);
  assert.throws(() => createField(p, -1, seeded(1)), RangeError);
  assert.throws(
    () =>
      createField(
        p,
        p.mask.findIndex((v) => !v),
        seeded(1),
      ),
    RangeError,
  );
  assert.throws(() => createField({ ...p, count: 500 }, 0, seeded(1)), RangeError);
  assert.throws(() => certifiedField({ ...p, count: 60 }, 0, seeded(1)), RangeError);
});

test('flood fill stops at flags, mines, rubble, revealed tiles and bad indices', () => {
  const p = planOf(4),
    f = createField(p, 10, seeded(2)),
    none = Array(p.w * p.h).fill(false);
  assert.deepEqual(revealCells(f, none, none, -1), []);
  assert.deepEqual(
    revealCells(
      f,
      none,
      none,
      p.mask.findIndex((v) => !v),
    ),
    [],
  );
  assert.deepEqual(revealCells(f, none, none, f.mines.findIndex(Boolean)), []);
  const flagged = none.slice();
  flagged[10] = true;
  assert.deepEqual(revealCells(f, none, flagged, 10), []);
  const area = revealCells(f, none, none, 10);
  assert.ok(area.includes(10) && area.every((i) => !f.mines[i] && p.mask[i]));
  assert.deepEqual(
    revealCells(
      f,
      area.map(() => true),
      none,
      10,
    ),
    [],
  );
  assert.deepEqual(neighbors(0, 3, 3), [1, 3, 4]);
  assert.deepEqual(neighbors(1.5, 3, 3), []);
});

test('the solver proves only true facts, uses sector totals, and certified fields are solvable', () => {
  for (const n of [3, 7, 13, 20]) {
    const p = planOf(n),
      first = p.mask.findIndex(Boolean) + p.w * 2 + 2,
      f = certifiedField(p, first, seeded(n)),
      revealed = openingCells(f),
      d = deduceVisible(f, revealed);
    assert.ok(deductionSolves(f));
    assert.ok(d.mines.every((i) => f.mines[i]) && d.safe.every((i) => !f.mines[i]));
    assert.ok(d.safe.every((i) => d.proofs.get(i).type === 'safe'));
  }
  const p = planOf(7),
    f = createField(p, 30, seeded(4)),
    sectorOnly = deduceVisible(f, Array(p.w * p.h).fill(false));
  assert.ok(sectorOnly.proofs instanceof Map);
  const unsolvable = createField({ ...planOf(20), count: 70 }, 0, seeded(3));
  assert.equal(deductionSolves(unsolvable), false);
});

test('marking cycles flag, question, clear; chords need exact flags; rationed flags stop at the limit', () => {
  const { g, field } = scene(2);
  const s0 = g.getState(),
    target = s0.revealed.findIndex((v, i) => !v && !field.mines[i]);
  tapCell(g, target, ['KeyF']);
  assert.equal(g.getState().flags[target], true);
  key(g, 'KeyF');
  assert.equal(g.getState().questions[target], true);
  key(g, 'KeyF');
  assert.equal(g.getState().questions[target], false);
  key(g, 'KeyC');
  assert.match(g.getState().notice.en, /revealed number/);
  const number = s0.revealed.findIndex((v, i) => v && field.numbers[i] > 0);
  tapCell(g, number, ['KeyC']);
  assert.match(g.getState().notice.en, /needs/);
  const score = g.getState().score;
  for (const m of neighbors(number, s0.width, s0.height).filter((i) => field.mines[i]))
    tapCell(g, m, ['KeyF']);
  tapCell(g, number, ['KeyC']);
  const after = g.getState();
  assert.ok(after.score >= score);
  assert.equal(after.phase, 'playing');

  const rationed = scene(9, 4);
  const limit = LEVELS[8].flagLimit,
    covered = rationed.g.getState().revealed.flatMap((v, i) => (!v ? [i] : []));
  covered.slice(0, limit + 1).forEach((i) => tapCell(rationed.g, i, ['KeyF']));
  const r = rationed.g.getState();
  assert.equal(r.flags.filter(Boolean).length, limit);
  assert.match(r.notice.en, /Flag ration spent/);
  tapCell(rationed.g, covered[0], ['KeyF']);
  tapCell(rationed.g, covered[limit], ['KeyF']);
  assert.equal(rationed.g.getState().flags[covered[limit]], true);
});

test('a chord on a wrong flag explodes atomically; the opening cannot chord or probe early', () => {
  const fresh = createGame(harness().env);
  for (const k of ['KeyC', 'KeyX', 'KeyH', 'KeyI']) key(fresh, k);
  assert.equal(fresh.getState().started, false);
  assert.equal(fresh.getState().phase, 'playing');
  const { h, g, field } = scene(3, 6);
  const s = g.getState(),
    number = s.revealed.findIndex(
      (v, i) =>
        v &&
        field.numbers[i] > 0 &&
        neighbors(i, s.width, s.height).some((j) => field.mines[j] && !s.revealed[j]),
    );
  const near = neighbors(number, s.width, s.height).filter((j) => s.mask[j] && !s.revealed[j]),
    wrong = near.filter((j) => !field.mines[j]).slice(0, field.numbers[number]);
  assert.ok(
    number >= 0 && wrong.length === field.numbers[number],
    'scenario has a wrong-flag chord',
  );
  wrong.forEach((i) => tapCell(g, i, ['KeyF']));
  tapCell(g, number, ['KeyC']);
  const lost = g.getState();
  assert.equal(lost.phase, 'lost');
  assert.ok(lost.triggered.length >= 1);
  assert.equal(h.ends.length, 1);
  g.draw(mockContext());
});

test('probes confirm mines, reveal safe ground, never double-charge and run out gracefully', () => {
  const { g, field } = scene(2, 3);
  const s = g.getState(),
    mine = field.mines.findIndex(Boolean),
    safe = s.revealed.findIndex((v, i) => !v && !field.mines[i]);
  tapCell(g, mine, ['KeyI']);
  key(g, 'KeyX');
  let p = g.getState();
  assert.equal(p.verified[mine], true);
  assert.equal(p.probes, s.probes - 1);
  key(g, 'KeyX');
  assert.equal(g.getState().probes, p.probes);
  key(g, 'KeyF');
  assert.equal(g.getState().flags[mine], true);
  key(g, 'KeyI');
  assert.match(g.getState().notice.en, /probe-confirmed/);
  tapCell(g, safe, ['KeyF']);
  key(g, 'KeyX');
  p = g.getState();
  assert.equal(p.revealed[safe], true);
  assert.equal(p.flags[safe], false);
  const dry = scene(20, 2);
  tapCell(
    dry.g,
    dry.g.getState().revealed.findIndex((v) => !v),
    ['KeyI'],
  );
  key(dry.g, 'KeyX');
  assert.match(dry.g.getState().notice.en, /No probes left/);
  assert.equal(dry.g.getState().probes, 0);
});

test('inspection and hints explain covered, revealed and over-flagged tiles for free', () => {
  const { g, field } = scene(2, 9);
  const s = g.getState(),
    number = s.revealed.findIndex((v, i) => v && field.numbers[i] > 0),
    covered = s.revealed.findIndex((v) => !v);
  tapCell(g, covered, ['KeyI']);
  assert.match(g.getState().notice.en, /Covered tile/);
  tapCell(g, number, ['KeyI']);
  assert.match(g.getState().notice.en, /Compare nearby/);
  const around = neighbors(number, s.width, s.height).filter((j) => !s.revealed[j] && s.mask[j]);
  around.slice(0, field.numbers[number]).forEach((i) => tapCell(g, i, ['KeyF']));
  tapCell(g, number, ['KeyI']);
  assert.match(g.getState().notice.en, /C can open/);
  around.slice(0, field.numbers[number] + 1).forEach((i) => tapCell(g, i, ['KeyF']));
  tapCell(g, number, ['KeyI']);
  g.draw(mockContext());
  const flagged = scene(2, 9);
  const safeTarget = deduceVisible(flagged.field, flagged.g.getState().revealed).safe[0];
  tapCell(flagged.g, safeTarget, ['KeyF']);
  key(flagged.g, 'KeyH');
  assert.match(flagged.g.getState().notice.en, /Clear this flag/);
  assert.equal(flagged.g.getState().cursor, safeTarget);
  const stuck = createGame(harness({ seed: 2 }).env);
  key(stuck, 'KeyH');
  assert.match(stuck.getState().notice.en, /protected/);
  key(stuck, 'KeyI');
  assert.match(stuck.getState().notice.en, /first opening/);
  key(stuck, 'KeyX');
  assert.match(stuck.getState().notice.en, /already safe/);
});

test('cursor wraps, skips rubble, repeats at a fixed rate and ignores diagonal input', () => {
  const g = scene(5).g;
  const s = g.getState();
  for (let n = 0; n < 40; n++) {
    key(g, 'ArrowRight');
    assert.ok(g.getState().mask[g.getState().cursor]);
    key(g, 'KeyW');
    assert.ok(g.getState().mask[g.getState().cursor]);
    key(g, 'KeyA');
    key(g, 'ArrowDown');
  }
  const diagonal = createGame(harness().env),
    start = diagonal.getState().cursor;
  diagonal.update(1 / 60, input(['ArrowRight', 'ArrowUp']));
  assert.equal(diagonal.getState().cursor, start);
  const moved = [30, 60, 120].map((hz) => {
    const game = createGame(harness().env);
    for (let n = 0; n < hz * 2; n++) game.update(1 / hz, input(['ArrowRight']));
    return game.getState().cursor;
  });
  assert.equal(new Set(moved).size, 1);
  assert.equal(s.mask.length, s.width * s.height);
  const held = createGame(harness().env);
  held.update(1 / 60, input(['KeyS'], ['KeyS']));
  held.update(1 / 60, input(['KeyD']));
  held.update(1 / 60, input([]));
  assert.equal(held.getState().inspect, -1);
});

test('tap modes switch by key or button and tapping rubble does nothing', () => {
  const g = scene(5).g;
  const s = g.getState(),
    rubble = s.mask.findIndex((v) => !v),
    before = s.cursor;
  tapCell(g, rubble);
  assert.equal(g.getState().cursor, before);
  key(g, 'KeyV');
  assert.equal(g.getState().tapMode, 1);
  const covered = s.revealed.findIndex((v, i) => !v && s.mask[i]);
  tapCell(g, covered);
  assert.equal(g.getState().flags[covered], true);
  key(g, 'KeyV');
  tapCell(g, covered);
  assert.equal(g.getState().inspect, covered);
  for (let m = 0; m < 3; m++) {
    const y = MODE_BUTTON.y + m * MODE_BUTTON.step + 4;
    g.update(1 / 60, input([], [], { clicked: true, x: MODE_BUTTON.x + 4, y }));
    assert.equal(g.getState().tapMode, m);
    assert.equal(modeButtonAt(MODE_BUTTON.x + 4, y), m);
  }
  assert.equal(modeButtonAt(10, 60), -1);
  assert.equal(modeButtonAt(MODE_BUTTON.x + 4, 10), -1);
});

test('field select moves, refuses locked fields, launches by key or tap and plays the chosen field', () => {
  const calls = [];
  const h = harness();
  h.env.progress = { unlocked: () => 8, unlock: (v) => calls.push(v) };
  const g = createGame(h.env);
  assert.equal(g.getState().menu.cursor, 8);
  key(g, 'ArrowRight');
  assert.equal(g.getState().menu.cursor, 8);
  key(g, 'ArrowUp');
  assert.equal(g.getState().menu.cursor, 2);
  key(g, 'KeyA');
  assert.equal(g.getState().menu.cursor, 1);
  assert.deepEqual(h.sounds.slice(-1), ['move']);
  const lock = menuCell(12);
  g.update(1 / 60, input([], [], { clicked: true, x: lock.x + 2, y: lock.y + 2 }));
  assert.equal(g.getState().menu.cursor, 1);
  assert.equal(h.sounds.at(-1), 'hit');
  g.draw(mockContext());
  const open = menuCell(3);
  g.update(1 / 60, input([], [], { clicked: true, x: open.x + 2, y: open.y + 2 }));
  assert.equal(g.getState().level, 3);
  assert.equal(g.getState().menu, null);
  assert.deepEqual(menuTarget(input([], ['Enter']), 2, 5), {
    cursor: 2,
    moved: false,
    denied: false,
    start: true,
  });
  assert.equal(menuTarget(input(), 2, 5).start, false);
});

test('clearing a field shows the travel prompt, Enter moves on and keeps the tap mode', () => {
  const h = harness({ seed: 3 }),
    g = createGame(h.env);
  key(g, 'KeyV');
  let guard = 0;
  while (!g.getState().betweenStages && guard++ < 200) {
    if (!g.getState().started) key(g, 'Space');
    else {
      key(g, 'KeyH');
      key(g, 'Space');
    }
  }
  const cleared = g.getState();
  assert.equal(cleared.betweenStages, true);
  assert.ok(cleared.score >= 500);
  g.draw(mockContext());
  key(g, 'Space');
  assert.equal(g.getState().level, 1);
  key(g, 'Enter');
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().tapMode, 1);
  assert.equal(g.getState().started, false);
});

test('every field and menu state draws in English and Chinese without errors', () => {
  for (const lang of ['en', 'zh'])
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const h = harness({ seed: n, lang });
      h.env.progress = { unlocked: () => n, unlock() {} };
      const g = createGame(h.env);
      g.draw(mockContext());
      key(g, 'Space');
      g.draw(mockContext());
      key(g, 'Space');
      key(g, 'KeyH');
      key(g, 'KeyF');
      key(g, 'KeyF');
      key(g, 'KeyI');
      g.draw(mockContext());
      assert.ok(g.getState().status[lang].length > 0);
    }
  const lines = noticeLines('word '.repeat(80), 'en');
  assert.ok(lines.length > 2);
  assert.equal(noticeLines('', 'zh').length, 1);
});

test('the solver feeds proven mines back in, so H never misses a provable safe tile', () => {
  // Field 10 from the reviewer's repro: the safe tiles only follow once the mines are known.
  const lcg = (s) => () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296,
    plan = planOf(10),
    active = plan.mask.flatMap((v, i) => (v ? [i] : [])),
    first = active[Math.floor(lcg(118 * 31 + 10)() * active.length)],
    field = certifiedField(plan, first, lcg(118 * 7919 + 10 * 104729)),
    revealed = [
      1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0,
      0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1,
      0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    ].map(Boolean),
    found = deduceVisible(field, revealed);
  assert.deepEqual(found.safe, [17, 18, 29, 62, 72, 73]);
  assert.ok(found.mines.every((i) => field.mines[i]));
  const known = Array(plan.w * plan.h).fill(false);
  found.mines.forEach((i) => (known[i] = true));
  assert.deepEqual(deduceVisible(field, revealed, known).safe, found.safe);
});

test('a failure while building a field leaves the board unopened with an explanation', () => {
  const h = harness();
  h.env.random = () => {
    throw new Error('broken random');
  };
  const g = createGame(h.env);
  key(g, 'Space');
  assert.equal(g.getState().started, false);
  assert.match(g.getState().notice.en, /failed to start/);
  assert.equal(g.getState().phase, 'playing');
});
