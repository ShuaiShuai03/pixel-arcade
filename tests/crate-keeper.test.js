import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  LEVELS,
  parseLevel,
  moveState,
  solveLevel,
  crateLayout,
  meta,
} from '../src/games/crate-keeper.js';
import { harness, input, mockContext } from './harness.js';

test('Crate Keeper all eight levels have verified solutions', () => {
  assert.ok(LEVELS.length >= 8);
  for (const level of LEVELS) {
    const solution = solveLevel(level);
    assert.ok(solution?.length, level.join('\n'));
    let state = parseLevel(level);
    for (const code of solution)
      state = moveState(
        state,
        ...{ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code],
      );
    assert.ok(state.crates.every((c) => state.goals.includes(c)));
  }
});
test('Crate Keeper cannot enter walls or push two crates and does not mutate previous state', () => {
  const s = parseLevel(['######', '#@$$.#', '#  . #', '######']);
  assert.equal(moveState(s, 1, 0), s);
  assert.equal(moveState(s, 0, -1), s);
  const moved = moveState(s, 0, 1);
  assert.notEqual(moved, s);
  assert.equal(s.player, 7);
});
function settle(g, hz = 120) {
  for (let n = 0; n < hz && g.getState().busy; n++) g.update(1 / hz, input());
  assert.equal(g.getState().busy, false);
}
function tap(g, code, hz = 120) {
  g.update(1 / hz, input([], code ? [code] : []));
  settle(g, hz);
}
test('Crate Keeper undo restores a pushed crate and leaves room confirmation uncommitted', () => {
  const g = createGame(harness().env),
    initial = g.getState();
  tap(g, 'ArrowRight');
  assert.equal(g.getState().solved, true);
  tap(g, 'KeyZ');
  assert.equal(g.getState().player, initial.player);
  assert.deepEqual(g.getState().crates, initial.crates);
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().pushes, 0);
  assert.equal(g.getState().score, 0);
  assert.equal(g.getState().solved, false);
});
for (const hz of [30, 60, 120])
  test(`Crate Keeper all eight rooms complete through legal keys and explicit Next (${hz}Hz)`, (t) => {
    const h = harness({ lang: hz === 120 ? 'zh' : 'en' }),
      g = createGame(h.env);
    let expectedMoves = 0,
      expectedPushes = 0;
    for (let n = 0; n < 8; n++) {
      const path = solveLevel(LEVELS[n]);
      assert.ok(path?.length);
      for (const code of path) {
        const before = g.getState();
        tap(g, code, hz);
        const after = g.getState();
        assert.equal(after.moves, before.moves + 1);
        assert.ok(!after.walls.includes(after.player));
        assert.equal(new Set(after.crates).size, after.crates.length);
        assert.ok(after.crates.every((c) => !after.walls.includes(c)));
      }
      const solved = g.getState();
      assert.equal(solved.level, n + 1);
      assert.equal(solved.solved, true);
      assert.ok(solved.crates.every((c) => solved.goals.includes(c)));
      assert.equal(solved.pushes, solved.parPushes);
      expectedMoves += solved.moves;
      expectedPushes += solved.pushes;
      const beforeDraw = structuredClone(g.getState());
      g.draw(mockContext());
      assert.deepEqual(g.getState(), beforeDraw);
      for (let wait = 0; wait < hz; wait++) g.update(1 / hz, input(['Enter', 'ArrowRight']));
      assert.equal(g.getState().level, n + 1);
      assert.equal(g.getState().score, solved.score);
      tap(g, 'Enter', hz);
    }
    const final = g.getState();
    assert.equal(final.phase, 'won');
    assert.equal(final.totalMoves, 168);
    assert.equal(expectedMoves, 168);
    assert.equal(expectedPushes, 40);
    assert.equal(final.totalPushes, 40);
    assert.equal(final.score, 7080);
    assert.equal(h.ends.length, 1);
    for (const dt of [0, NaN, Infinity, 1 / 30])
      g.update(dt, input(['ArrowRight'], ['Enter', 'KeyZ', 'KeyX', 'KeyH']));
    assert.deepEqual(g.getState(), final);
    assert.equal(h.ends.length, 1);
    g.draw(mockContext());
    const fresh = createGame(harness().env).getState();
    assert.equal(fresh.level, 1);
    assert.equal(fresh.score, 0);
    assert.equal(fresh.undoCount, 0);
    t.diagnostic(`${hz}Hz:168moves/40pushes/7080points; all8 rooms explicitly confirmed`);
  });
test('Crate Keeper adjacent board taps are one legal step and host touch exposes all actions', () => {
  const g = createGame(harness({ lang: 'zh' }).env),
    initial = g.getState(),
    layout = crateLayout(initial.w, initial.h);
  g.update(
    1 / 120,
    input([], [], {
      x: layout.ox + 3.5 * layout.size,
      y: layout.oy + 2.5 * layout.size,
      clicked: true,
    }),
  );
  settle(g);
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().solved, true);
  tap(g, 'KeyZ');
  assert.equal(g.getState().player, initial.player);
  assert.deepEqual(g.getState().crates, initial.crates);
  const before = g.getState();
  g.update(
    1 / 120,
    input([], [], {
      x: layout.ox + 5.5 * layout.size,
      y: layout.oy + 1.5 * layout.size,
      clicked: true,
    }),
  );
  assert.equal(g.getState().player, before.player);
  assert.equal(g.getState().moves, before.moves);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyZ',
    'KeyH',
    'KeyX',
    'Enter',
  ]) {
    const c = meta.touchControls.find((c) => c.code === code);
    assert.ok(c);
    assert.ok(c.label.en);
    assert.match(c.label.zh, /\p{Script=Han}/u);
  }
  tap(g, 'KeyH');
  assert.equal(g.getState().hintCode, 'ArrowRight');
  assert.equal(g.getState().moves, 0);
  g.draw(mockContext());
});
