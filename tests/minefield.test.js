import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createField,
  revealCells,
  neighbors,
  stagePlan,
  certifiedField,
  fallbackField,
  deductionSolves,
  deduceVisible,
  createMinefieldState,
  revealAction,
  flagAction,
} from '../src/games/minefield.js';
import { harness, input, mockContext, seeded } from './harness.js';
const key = (g, k, dt = 1 / 60) => g.update(dt, input([], [k]));
function tap(g, i, pressed = []) {
  const s = g.getState(),
    l = s.layout;
  g.update(
    1 / 60,
    input([], pressed, {
      clicked: true,
      x: l.x + ((i % s.width) + 0.5) * l.cell,
      y: l.y + (Math.floor(i / s.width) + 0.5) * l.cell,
    }),
  );
}

test('Minefield opening protects every active neighbor and adjacency is exact', () => {
  for (let seed = 0; seed < 30; seed++)
    for (let level = 1; level <= 3; level++) {
      const p = stagePlan(level),
        first = p.mask.findIndex(Boolean),
        f = createField(p.w, p.h, p.count, first, seeded(seed), p.mask, p.regions);
      assert.equal(f.mines.filter(Boolean).length, p.count);
      for (const i of [first, ...neighbors(first, p.w, p.h)]) assert.equal(f.mines[i], false);
      f.numbers.forEach((n, i) =>
        assert.equal(n, p.mask[i] ? neighbors(i, p.w, p.h).filter((j) => f.mines[j]).length : 0),
      );
      assert.ok(f.mines.every((v, i) => !v || p.mask[i]));
    }
});
test('Minefield invalid geometry fails clearly and edge adjacency never wraps', () => {
  assert.deepEqual(neighbors(0, 3, 3), [1, 3, 4]);
  assert.deepEqual(neighbors(-1, 3, 3), []);
  for (const args of [
    [0, 3, 1, 0],
    [3, 3, 9, 4],
    [3, 3, 0, 9],
  ])
    assert.throws(() => createField(...args, seeded(1)), RangeError);
});
test('Minefield immutable field and region totals stay truthful', () => {
  const p = stagePlan(3),
    f = createField(p.w, p.h, p.count, 1, seeded(5), p.mask, p.regions);
  assert.ok(Object.isFrozen(f.mines));
  assert.ok(Object.isFrozen(f.numbers));
  assert.ok(Object.isFrozen(f.mask));
  for (const r of f.regions) assert.equal(r.total, r.cells.filter((i) => f.mines[i]).length);
  assert.equal(
    f.regions.reduce((n, r) => n + r.total, 0),
    f.count,
  );
  assert.throws(() => (f.mines[0] = true), TypeError);
});
test('Minefield flood excludes flags, rubble, mines and duplicate reveals', () => {
  const p = stagePlan(2),
    f = createField(p.w, p.h, p.count, 41, seeded(1), p.mask),
    seen = Array(p.w * p.h).fill(false),
    flags = seen.slice();
  flags[41] = true;
  assert.deepEqual(revealCells(f, seen, flags, 41), []);
  flags[41] = false;
  const opened = revealCells(f, seen, flags, 41);
  assert.ok(opened.length > 1);
  assert.equal(new Set(opened).size, opened.length);
  assert.ok(opened.every((i) => p.mask[i] && !f.mines[i]));
  for (const i of opened) seen[i] = true;
  assert.deepEqual(revealCells(f, seen, flags, 41), []);
  for (const i of [-1, 999, p.mask.findIndex((v) => !v), f.mines.findIndex(Boolean)])
    assert.deepEqual(revealCells(f, seen, flags, i), []);
});
test('Minefield three stages provide distinct terrain and sector rules', () => {
  const [a, b, c] = [1, 2, 3].map((n) => stagePlan(n));
  assert.ok(a.mask.every(Boolean));
  assert.ok(b.mask.some((v) => !v));
  assert.equal(b.regions.length, 0);
  assert.equal(c.regions.length, 3);
  assert.equal(new Set(c.regions.flatMap((r) => r.cells)).size, c.mask.filter(Boolean).length);
});
test('Minefield guide cycles only before opening and clears old hypotheses', () => {
  const g = createGame(harness().env);
  key(g, 'KeyF');
  key(g, 'KeyG');
  let s = g.getState();
  assert.equal(s.difficulty, 2);
  assert.equal(s.mineCount, 10);
  assert.ok(s.flags.every((v) => !v));
  key(g, 'KeyG');
  assert.equal(g.getState().difficulty, 3);
  key(g, 'KeyG');
  assert.equal(g.getState().difficulty, 1);
  key(g, 'Space');
  key(g, 'KeyG');
  assert.equal(g.getState().difficulty, 1);
});
test('Minefield mark cycle is reversible without starting or consuming time', () => {
  const g = createGame(harness().env),
    i = g.getState().cursor;
  key(g, 'KeyF');
  assert.equal(g.getState().flags[i], true);
  key(g, 'KeyF');
  assert.equal(g.getState().questions[i], true);
  key(g, 'KeyF');
  assert.equal(g.getState().questions[i], false);
  assert.equal(g.getState().started, false);
  assert.equal(g.getState().elapsed, 0);
});
test('Minefield reveal, mark and select touch modes use exact board geometry', () => {
  const g = createGame(harness().env);
  key(g, 'KeyV');
  tap(g, 0);
  assert.equal(g.getState().flags[0], true);
  key(g, 'KeyV');
  tap(g, 1);
  assert.equal(g.getState().cursor, 1);
  assert.equal(g.getState().started, false);
  key(g, 'KeyV');
  tap(g, 2);
  assert.equal(g.getState().started, true);
  assert.equal(g.getState().revealed[2], true);
  for (const [y, mode] of [
    [60, 0],
    [100, 1],
    [140, 2],
  ]) {
    g.update(1 / 60, input([], [], { clicked: true, x: 420, y }));
    assert.equal(g.getState().tapMode, mode);
  }
});
test('Minefield navigation wraps and skips inactive quarry cells', () => {
  const g = createGame(harness().env);
  tap(g, 0, ['KeyI']);
  key(g, 'ArrowLeft');
  assert.equal(g.getState().cursor, 8);
  key(g, 'ArrowUp');
  assert.equal(g.getState().cursor, 71);
  key(g, 'ArrowRight');
  assert.equal(g.getState().cursor, 63);
});
test('Minefield key repeat advances at a bounded rate and diagonal input is neutral', () => {
  const g = createGame(harness().env),
    start = g.getState().cursor;
  g.update(1 / 60, input(['ArrowRight', 'ArrowDown']));
  assert.equal(g.getState().cursor, start);
  for (let n = 0; n < 60; n++) g.update(1 / 60, input(['ArrowRight']));
  assert.ok(g.getState().nav.delay > 0);
  assert.ok(g.getState().nav.delay <= 0.28);
});
test('Minefield zero, negative and nonfinite steps read no input and change no state', () => {
  for (const started of [false, true])
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
      const g = createGame(harness().env);
      if (started) key(g, 'Space');
      const before = g.getState();
      let reads = 0;
      g.update(dt, {
        held() {
          reads++;
          return true;
        },
        pressed() {
          reads++;
          return true;
        },
        get pointer() {
          reads++;
          throw Error('input read');
        },
      });
      assert.equal(reads, 0);
      assert.deepEqual(g.getState(), before);
    }
});
test('Minefield flags block reveals and chord requires an opened exact-count clue', () => {
  const h = harness(),
    s = createMinefieldState();
  flagAction(s, s.cursor, h.env);
  revealAction(s, s.cursor, h.env);
  assert.equal(s.field, null);
  flagAction(s, s.cursor, h.env);
  revealAction(s, s.cursor, h.env, true);
  assert.equal(s.field, null);
  revealAction(s, s.cursor, h.env);
  const i = s.revealed.findIndex((v, j) => v && s.field.numbers[j] > 0),
    before = s.revealed.slice();
  revealAction(s, i, h.env, true);
  assert.deepEqual(s.revealed, before);
  assert.match(s.notice.en, /Chord needs/);
});
test('Minefield fatal chord is atomic and never awards safe neighbors first', () => {
  let fixture;
  for (let seed = 1; seed < 50 && !fixture; seed++) {
    const h = harness({ seed }),
      s = createMinefieldState();
    revealAction(s, s.cursor, h.env);
    for (let i = 0; i < s.revealed.length; i++)
      if (s.revealed[i] && s.field.numbers[i] > 0) {
        const near = neighbors(i, s.width, s.height).filter((j) => !s.revealed[j]),
          safe = near.filter((j) => !s.field.mines[j]),
          mines = near.filter((j) => s.field.mines[j]);
        if (safe.length && mines.length) {
          for (const j of [...safe, ...mines].slice(0, s.field.numbers[i])) s.flags[j] = true;
          if (mines.some((j) => !s.flags[j])) {
            fixture = { h, s, i };
            break;
          }
        }
      }
  }
  assert.ok(fixture);
  const { h, s, i } = fixture,
    before = s.revealed.slice(),
    score = s.score;
  revealAction(s, i, h.env, true);
  assert.equal(s.phase, 'lost');
  assert.deepEqual(s.revealed, before);
  assert.equal(s.score, score);
  assert.ok(s.triggered.length);
  assert.equal(h.ends.length, 1);
});
test('Minefield mine loss freezes terminal callbacks and simultaneous tap controls', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  key(g, 'Space');
  const mine = g.getState().mines.findIndex(Boolean);
  tap(g, mine, ['KeyI']);
  let atEnd;
  h.env.end = (r) => {
    h.ends.push(r);
    atEnd = g.getState();
  };
  g.update(1 / 60, input([], ['Space'], { clicked: true, x: 420, y: 140 }));
  assert.equal(g.getState().phase, 'lost');
  assert.deepEqual(g.getState(), atEnd);
  for (let i = 0; i < 5; i++) key(g, 'KeyV');
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /地雷/);
  assert.deepEqual(g.getState(), atEnd);
  g.draw(mockContext());
  assert.equal(createGame(h.env).getState().phase, 'playing');
});
test('Minefield free hints use visible clues, never hidden mine/number reads', () => {
  const g = createGame(harness().env);
  key(g, 'Space');
  const s = g.getState(),
    field = {
      ...s.field,
      mines: new Proxy([], {
        get() {
          throw Error('hidden mine read');
        },
      }),
      numbers: new Proxy(s.numbers, {
        get(t, k) {
          if (/^\d+$/.test(String(k)) && !s.revealed[Number(k)]) throw Error('hidden number read');
          return t[k];
        },
      }),
    };
  const a = deduceVisible(field, s.revealed, s.verified);
  assert.ok(a.safe.length + a.mines.length > 0);
  for (const i of a.safe) assert.equal(s.mines[i], false);
  for (const i of a.mines) assert.equal(s.mines[i], true);
});
test('Minefield bounded certification works across openings, guides and constant random', () => {
  for (const difficulty of [1, 2, 3])
    for (const level of [1, 2, 3])
      for (const seed of [0, 1, 5, 17]) {
        const p = stagePlan(level, difficulty),
          first = seed % 2 ? p.mask.findIndex(Boolean) : p.mask.findLastIndex(Boolean),
          f = certifiedField(p, first, seeded(seed));
        assert.equal(deductionSolves(f, first), true, `${level}/${difficulty}/${seed}`);
      }
  for (const value of [0, 0.125, 0.5, 0.99]) {
    const p = stagePlan(3, 3),
      f = certifiedField(p, 1, () => value);
    assert.equal(deductionSolves(f, 1), true);
  }
});

test('Minefield fallback is certified for every supported opening without random retries', () => {
  let checked = 0;
  for (const difficulty of [1, 2, 3])
    for (const level of [1, 2, 3]) {
      const p = stagePlan(level, difficulty);
      for (let i = 0; i < p.mask.length; i++)
        if (p.mask[i]) {
          const f = fallbackField(p, i);
          assert.equal(f.mines.filter(Boolean).length, p.count);
          assert.equal(deductionSolves(f, i), true, `fallback ${level}/${difficulty}/${i}`);
          for (const j of [i, ...neighbors(i, p.w, p.h)]) assert.equal(f.mines[j], false);
          checked++;
        }
    }
  assert.equal(checked, 738);
});
