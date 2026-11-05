import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  LEVELS,
  parseLevel,
  moveState,
  solveLevel,
  searchLevel,
  deadSquares,
} from '../src/games/crate-keeper.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('Crate Keeper current warehouse restart restores crates, pushes and history', () => {
  const g = createGame(harness().env),
    s = g.getState();
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['KeyX']));
  const after = g.getState();
  assert.deepEqual(after.crates, s.crates);
  assert.equal(after.player, s.player);
  assert.equal(after.pushes, 0);
  assert.equal(after.undoCount, 0);
});

test('Crate Keeper solutions satisfy an independent grid interpreter at every step', async () => {
  const { LEVELS, solveLevel } = await import('../src/games/crate-keeper.js');
  for (const rows of LEVELS) {
    const width = rows[0].length,
      floor = new Set(),
      goals = new Set(),
      boxes = new Set();
    let player;
    rows.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const i = y * width + x;
        if (c !== '#') floor.add(i);
        if ('.+*'.includes(c)) goals.add(i);
        if ('$*'.includes(c)) boxes.add(i);
        if ('@+'.includes(c)) player = i;
      }),
    );
    const path = solveLevel(rows);
    assert.ok(path?.length);
    for (const key of path) {
      const [dx, dy] = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[key];
      const dest = player + dx + dy * width;
      assert.ok(floor.has(dest));
      assert.ok(Math.abs((dest % width) - (player % width)) <= 1);
      if (boxes.has(dest)) {
        const beyond = dest + dx + dy * width;
        assert.ok(floor.has(beyond));
        assert.ok(!boxes.has(beyond));
        boxes.delete(dest);
        boxes.add(beyond);
      }
      player = dest;
    }
    assert.deepEqual(
      [...boxes].sort((a, b) => a - b),
      [...goals].sort((a, b) => a - b),
    );
  }
});

test('Crate Keeper movement never allows diagonal or multi-cell jumps', async () => {
  const { parseLevel, moveState } = await import('../src/games/crate-keeper.js');
  const s = parseLevel(['######', '# @  #', '#  $.#', '######']);
  assert.equal(moveState(s, 1, 1), s);
  assert.equal(moveState(s, 2, 0), s);
});

test('Crate Keeper invalid or paused time never reads input, changes timers or consumes an action', () => {
  for (const completed of [false, true]) {
    const h = harness(),
      g = createGame(h.env);
    if (completed) g.update(1 / 60, input([], ['ArrowRight']));
    const before = structuredClone(g.getState()),
      sounds = h.sounds.length;
    let reads = 0;
    const hostile = {
      held() {
        reads++;
        return true;
      },
      pressed() {
        reads++;
        return true;
      },
      pointer: { clicked: true, x: 440, y: 181 },
    };
    for (const dt of [0, -1, NaN, Infinity]) g.update(dt, hostile);
    assert.deepEqual(g.getState(), before);
    assert.equal(reads, 0);
    assert.equal(h.sounds.length, sounds);
    assert.equal(h.ends.length, 0);
  }
});
test('Crate Keeper opposite or diagonal direction presses are neutral instead of ordered', () => {
  const g = createGame(harness().env),
    start = g.getState();
  g.update(1 / 60, input([], ['ArrowLeft', 'ArrowRight']));
  assert.equal(g.getState().player, start.player);
  g.update(1 / 60, input([], ['ArrowUp', 'ArrowRight']));
  assert.equal(g.getState().player, start.player);
  assert.equal(g.getState().moves, 0);
});
test('Crate Keeper solved rooms remain inspectable until explicit Next, with undo and reset still available', () => {
  const h = harness(),
    g = createGame(h.env),
    start = g.getState();
  g.update(1 / 60, input([], ['ArrowRight']));
  for (let n = 0; n < 120; n++) g.update(1 / 60, input());
  assert.equal(g.getState().level, 1);
  assert.equal(g.getState().solved, true);
  assert.equal(g.getState().score, 0);
  g.update(1 / 60, input([], ['KeyZ']));
  assert.equal(g.getState().player, start.player);
  assert.equal(g.getState().solved, false);
  g.update(1 / 60, input([], ['KeyX']));
  assert.deepEqual(g.getState().crates, start.crates);
  g.update(1 / 60, input([], ['ArrowRight']));
  for (let n = 0; n < 20; n++) g.update(1 / 60, input());
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().score, 1185);
  assert.equal(g.getState().totalMoves, 1);
  assert.equal(h.ends.length, 0);
});

test('Crate Keeper rapid undo feedback retraces cardinal moves rather than cutting a diagonal corner', () => {
  const g = createGame(harness().env),
    settle = () => {
      for (let n = 0; n < 40 && g.getState().busy; n++) g.update(1 / 120, input());
    };
  g.update(1 / 120, input([], ['ArrowUp']));
  settle();
  g.update(1 / 120, input([], ['ArrowRight']));
  settle();
  g.update(1 / 120, input([], ['KeyZ']));
  g.update(1 / 120, input([], ['KeyZ']));
  const m = g.getState().motion;
  assert.ok(m);
  assert.ok(
    Math.abs(m.player.to.x - m.player.from.x) < 1e-8 ||
      Math.abs(m.player.to.y - m.player.from.y) < 1e-8,
  );
  settle();
  assert.equal(g.getState().player, 16);
  assert.equal(g.getState().moves, 0);
});

function settleCrate(g, hz = 120) {
  for (let n = 0; n < hz && g.getState().busy; n++) g.update(1 / hz, input());
  assert.equal(g.getState().busy, false);
}
function pressCrate(g, code) {
  g.update(1 / 120, input([], code ? [code] : []));
  settleCrate(g);
}
test('Crate Keeper static dead-square proof never marks a goal or any verified solution prefix', () => {
  for (const level of LEVELS) {
    let s = parseLevel(level);
    const dead = new Set(deadSquares(s));
    assert.ok(s.goals.every((g) => !dead.has(g)));
    for (const key of solveLevel(s)) {
      s = moveState(
        s,
        ...{ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key],
      );
      assert.ok(s.crates.every((c) => !dead.has(c)));
    }
  }
  const trapped = parseLevel(['#######', '# .   #', '#     #', '# $@  #', '#######']);
  assert.ok(deadSquares(trapped).includes(trapped.crates[0]));
  assert.equal(searchLevel(trapped).status, 'no-route');
  const limited = searchLevel(LEVELS[7], 0);
  assert.equal(limited.status, 'limited');
  assert.equal(limited.path, null);
  assert.ok(searchLevel(LEVELS[7], 40000).path.length > 0);
});
test('Crate Keeper a legal wall trap gives an honest hint and undo restores a solvable route', () => {
  const g = createGame(harness().env);
  for (const code of ['ArrowUp', 'ArrowRight', 'ArrowDown']) pressCrate(g, code);
  assert.equal(g.getState().deadlocked, true);
  assert.equal(g.getState().deadCrates.length, 1);
  pressCrate(g, 'KeyH');
  assert.equal(g.getState().hintStatus, 'no-route');
  assert.equal(g.getState().hintCode, null);
  g.draw(mockContext());
  pressCrate(g, 'KeyZ');
  assert.equal(g.getState().deadlocked, false);
  for (const code of solveLevel(g.getState())) pressCrate(g, code);
  assert.equal(g.getState().solved, true);
  assert.equal(g.getState().score, 0);
  pressCrate(g, 'Enter');
  assert.equal(g.getState().level, 2);
});
test('Crate Keeper player and crate share one straight slide and a held key cannot repeat it', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowRight']));
  for (let n = 0; n < 8; n++) {
    const m = g.getState().motion;
    assert.ok(m?.crate);
    const t = m.elapsed / m.duration,
      p = { x: m.player.from.x + (m.player.to.x - m.player.from.x) * t, y: m.player.from.y },
      c = { x: m.crate.from.x + (m.crate.to.x - m.crate.from.x) * t, y: m.crate.from.y };
    assert.ok(Math.abs(c.x - p.x - 1) < 1e-8);
    assert.equal(c.y, p.y);
    g.update(1 / 120, input(['ArrowRight']));
  }
  settleCrate(g);
  for (let n = 0; n < 120; n++) g.update(1 / 120, input(['ArrowRight']));
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().pushes, 1);
});
test('Crate Keeper one buffered step is deliberate and reset/undo/Next clear pending actions', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp']));
  g.update(1 / 120, input([], ['ArrowRight']));
  assert.ok(g.getState().pending);
  settleCrate(g);
  assert.equal(g.getState().moves, 2);
  assert.equal(g.getState().player, 10);
  pressCrate(g, 'KeyX');
  g.update(1 / 120, input([], ['ArrowRight']));
  g.update(1 / 120, input([], ['Enter']));
  assert.equal(g.getState().confirmPending, true);
  g.update(1 / 120, input([], ['KeyZ']));
  settleCrate(g);
  assert.equal(g.getState().level, 1);
  assert.equal(g.getState().solved, false);
  assert.equal(g.getState().score, 0);
  assert.equal(g.getState().confirmPending, false);
  pressCrate(g, 'KeyX');
  g.update(1 / 120, input([], ['ArrowRight']));
  g.update(1 / 120, input([], ['ArrowRight']));
  g.update(1 / 120, input([], ['Enter']));
  settleCrate(g);
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().pending, null);
  assert.equal(g.getState().score, 1185);
});
test('Crate Keeper inspect/undo/reset cycles cannot farm room score', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 4; n++) {
    pressCrate(g, 'ArrowRight');
    assert.equal(g.getState().solved, true);
    assert.equal(g.getState().score, 0);
    pressCrate(g, 'KeyH');
    assert.equal(g.getState().hintStatus, 'solved');
    pressCrate(g, n % 2 ? 'KeyX' : 'KeyZ');
    assert.equal(g.getState().score, 0);
  }
  pressCrate(g, 'ArrowRight');
  pressCrate(g, 'Enter');
  assert.equal(g.getState().score, 1185);
  pressCrate(g, 'Enter');
  assert.equal(g.getState().score, 1185);
  pressCrate(g, 'KeyX');
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().score, 1185);
});
test('Crate Keeper snapshots, drawing and seeded bounded input traces preserve legal deterministic state', () => {
  const a = createGame(harness({ lang: 'zh' }).env),
    b = createGame(harness({ lang: 'zh' }).env),
    random = seeded(53),
    codes = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'KeyZ',
      'KeyX',
      'KeyH',
      'Enter',
      null,
    ];
  const original = structuredClone(a.getState()),
    copy = a.getState();
  copy.walls.length = 0;
  copy.goals.push(-1);
  copy.crates[0] = 999;
  assert.deepEqual(a.getState(), original);
  for (let n = 0; n < 4000; n++) {
    const code = n % 17 === 0 ? codes[Math.floor(random() * codes.length)] : null,
      controls = input(n % 11 ? ['ArrowRight'] : [], code ? [code] : []);
    a.update(1 / 120, controls);
    b.update(1 / 120, controls);
    if (n % 43 === 0) {
      const s = a.getState();
      assert.deepEqual(s, b.getState());
      assert.ok(s.player >= 0 && s.player < s.w * s.h);
      assert.ok(!s.walls.includes(s.player));
      assert.equal(new Set(s.crates).size, s.crates.length);
      assert.ok(
        s.crates.every((c) => c >= 0 && c < s.w * s.h && !s.walls.includes(c) && c !== s.player),
      );
      assert.ok(s.undoCount <= n + 1);
      assert.ok(s.crates.length <= 3 && s.goals.length <= 3 && s.walls.length <= 81);
      for (const v of [s.score, s.moves, s.pushes, s.totalMoves, s.time])
        assert.ok(Number.isFinite(v));
      assert.ok(JSON.stringify(s).length < 8000);
      const before = structuredClone(s);
      a.draw(mockContext());
      assert.deepEqual(a.getState(), before);
    }
  }
});

test('Crate Keeper final-slide queued Undo has explicit replacement/clearing rules for Next, Hint, direction and Reset', () => {
  for (const action of ['Enter', 'KeyH', 'ArrowUp', 'KeyX']) {
    const g = createGame(harness().env);
    g.update(1 / 120, input([], ['ArrowRight']));
    g.update(1 / 120, input([], ['KeyZ']));
    assert.equal(g.getState().pendingUndo, true);
    g.update(1 / 120, input([], [action]));
    settleCrate(g);
    const s = g.getState();
    assert.equal(s.pendingUndo, false);
    assert.equal(s.pending, null);
    assert.equal(s.confirmPending, false);
    if (action === 'Enter') {
      assert.equal(s.level, 2);
      assert.equal(s.score, 1185);
      assert.equal(s.moves, 0);
    } else if (action === 'KeyH') {
      assert.equal(s.level, 1);
      assert.equal(s.solved, true);
      assert.equal(s.hintStatus, 'solved');
      assert.equal(s.moves, 1);
    } else {
      assert.equal(s.level, 1);
      assert.equal(s.player, 16);
      assert.equal(s.moves, 0);
      assert.equal(s.score, 0);
    }
  }
});
test('Crate Keeper neutral keyboard combinations cannot fall through into simultaneous pointer movement', () => {
  const g = createGame(harness().env),
    before = g.getState();
  g.update(1 / 120, input([], ['ArrowLeft', 'ArrowRight'], { clicked: true, x: 240, y: 150 }));
  assert.equal(g.getState().player, before.player);
  assert.equal(g.getState().moves, 0);
});
