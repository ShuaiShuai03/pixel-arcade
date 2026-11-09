import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  LEVELS,
  parseLevel,
  moveState,
  searchLevel,
  solveLevel,
  deadSquares,
  crateLayout,
  meta,
} from '../src/games/crate-keeper.js';
import { LEVEL_COUNT, PAR_PUSHES, TITLES, LESSONS } from '../src/games/crate-keeper-levels.js';
import { reach, walkPath } from '../src/games/crate-keeper-solver.js';
import { roomScore } from '../src/games/crate-keeper-levels.js';
import { menuCell } from '../src/games/crate-keeper-menu.js';
import { harness, input, mockContext } from './harness.js';

const STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const CJK = /\p{Script=Han}/u;

function memoryStore(start = 1) {
  const store = {
    value: start,
    calls: [],
    unlocked: () => store.value,
    unlock: (n) => {
      store.calls.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
function settle(g, hz = 120) {
  for (let n = 0; n < hz && g.getState().busy; n++) g.update(1 / hz, input());
  assert.equal(g.getState().busy, false);
}
function tap(g, code, hz = 120) {
  g.update(1 / hz, input([], code ? [code] : []));
  settle(g, hz);
}
function start(level, { progress = memoryStore(level), lang = 'en' } = {}) {
  const h = harness({ lang });
  h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1) tap(g, 'Enter');
  assert.equal(g.getState().level, level);
  return { g, h, progress };
}

test('Crate Keeper ships twenty well-formed, original, solvable warehouses', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.equal(LEVELS.length, 20);
  assert.equal(PAR_PUSHES.length, 20);
  assert.equal(TITLES.length, 20);
  assert.equal(LESSONS.length, 20);
  assert.equal(new Set(LEVELS.map((rows) => rows.join('/'))).size, 20);
  assert.ok(Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0]) && Object.isFrozen(PAR_PUSHES));
  assert.ok(Object.isFrozen(TITLES) && Object.isFrozen(LESSONS) && Object.isFrozen(LESSONS[0]));
  LEVELS.forEach((rows, i) => {
    const label = `level ${i + 1}`,
      s = parseLevel(rows);
    assert.ok(
      rows.every((r) => r.length === rows[0].length),
      label,
    );
    assert.ok(
      rows.every((r) => /^[# $.*@+]+$/.test(r)),
      label,
    );
    assert.equal(s.crates.length, s.goals.length, label);
    assert.ok(s.player >= 0, label);
    assert.equal(new Set(rows.join('').match(/[@+]/g)).size > 0, true, label);
    assert.equal(rows.join('').match(/[@+]/g).length, 1, label);
    const edge = [
      ...rows[0],
      ...rows.at(-1),
      ...rows.map((r) => r[0]),
      ...rows.map((r) => r.at(-1)),
    ];
    assert.ok(
      edge.every((c) => c === '#'),
      `${label} is enclosed`,
    );
    assert.doesNotMatch(TITLES[i][0], CJK);
    assert.match(TITLES[i][1], CJK);
    assert.doesNotMatch(LESSONS[i][0], CJK);
    assert.match(LESSONS[i][1], CJK);
  });
});
test('Crate Keeper solver proves every level and the par is the push-optimal count', () => {
  const nodes = [];
  LEVELS.forEach((rows, i) => {
    const result = searchLevel(rows);
    assert.equal(result.status, 'solved', `level ${i + 1}`);
    assert.equal(result.pushes, PAR_PUSHES[i], `par ${i + 1}`);
    nodes.push(result.nodes);
    // An independent interpreter replays the key path on raw grid sets.
    const width = rows[0].length,
      floor = new Set(),
      goals = new Set(),
      boxes = new Set();
    let player;
    rows.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const n = y * width + x;
        if (c !== '#') floor.add(n);
        if ('.+*'.includes(c)) goals.add(n);
        if ('$*'.includes(c)) boxes.add(n);
        if ('@+'.includes(c)) player = n;
      }),
    );
    let pushes = 0;
    for (const key of result.path) {
      const [dx, dy] = STEP[key],
        dest = player + dx + dy * width;
      assert.ok(floor.has(dest));
      if (boxes.has(dest)) {
        const beyond = dest + dx + dy * width;
        assert.ok(floor.has(beyond) && !boxes.has(beyond));
        boxes.delete(dest);
        boxes.add(beyond);
        pushes++;
      }
      player = dest;
    }
    assert.equal(pushes, PAR_PUSHES[i]);
    assert.deepEqual(
      [...boxes].sort((a, b) => a - b),
      [...goals].sort((a, b) => a - b),
    );
  });
  // The curve rises: later levels are longer and branch more.
  for (let i = 3; i < 20; i++) {
    assert.ok(PAR_PUSHES[i] >= PAR_PUSHES[i - 1], `par ${i + 1}`);
    assert.ok(nodes[i] > nodes[i - 1], `search size ${i + 1}`);
  }
  assert.ok(PAR_PUSHES[19] >= 5 * PAR_PUSHES[2] && nodes[19] > 1000 * nodes[1]);
});
test('Crate Keeper lesson tips state the real crate count and docked starts', () => {
  const words = ['One', 'Two', 'Three', 'Four', 'Five'];
  LEVELS.forEach((rows, i) => {
    const s = parseLevel(rows),
      tip = LESSONS[i][0],
      named = words.findIndex(
        (w) => tip.includes(`${w} crate`) || tip.includes(`${w.toLowerCase()} crate`),
      );
    if (named >= 0) assert.equal(named + 1, s.crates.length, tip);
    if (/already docked|starts on a dock|start docked/.test(tip))
      assert.ok(
        s.crates.some((c) => s.goals.includes(c)),
        tip,
      );
  });
});
test('Crate Keeper cannot enter walls or push two crates and does not mutate previous state', () => {
  const s = parseLevel(['######', '#@$$.#', '#  . #', '######']);
  assert.equal(moveState(s, 1, 0), s);
  assert.equal(moveState(s, 0, -1), s);
  assert.equal(moveState(s, 1, 1), s);
  assert.equal(moveState(s, 2, 0), s);
  assert.equal(moveState(s, 0.5, 0), s);
  const moved = moveState(s, 0, 1);
  assert.notEqual(moved, s);
  assert.equal(s.player, 7);
  const edge = parseLevel(['@$', '  ']);
  assert.equal(moveState(edge, -1, 0), edge);
  assert.equal(moveState(edge, 1, 0), edge);
});
test('Crate Keeper dead-square proof never marks a goal or a solution prefix', () => {
  for (const level of LEVELS) {
    let s = parseLevel(level);
    const dead = new Set(deadSquares(s));
    assert.ok(s.goals.every((g) => !dead.has(g)));
    for (const key of solveLevel(s)) {
      s = moveState(s, ...STEP[key]);
      assert.ok(s.crates.every((c) => !dead.has(c)));
    }
  }
  const trapped = parseLevel(['#######', '# .   #', '#     #', '# $@  #', '#######']);
  assert.ok(deadSquares(trapped).includes(trapped.crates[0]));
  assert.equal(searchLevel(trapped).status, 'no-route');
  const limited = searchLevel(LEVELS[19], 0);
  assert.equal(limited.status, 'limited');
  assert.equal(limited.path, null);
});
test('Crate Keeper undo restores a pushed crate and a solved room waits for Next', () => {
  const h = harness(),
    g = createGame(h.env),
    initial = g.getState();
  tap(g, 'ArrowRight');
  assert.equal(g.getState().solved, true);
  for (let n = 0; n < 120; n++) g.update(1 / 60, input());
  assert.equal(g.getState().level, 1);
  assert.equal(g.getState().score, 0);
  tap(g, 'KeyZ');
  assert.equal(g.getState().player, initial.player);
  assert.deepEqual(g.getState().crates, initial.crates);
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().pushes, 0);
  assert.equal(g.getState().solved, false);
  tap(g, 'KeyZ');
  assert.equal(g.getState().undoCount, 0);
  tap(g, 'ArrowRight');
  tap(g, 'Enter');
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().score, 640);
  assert.equal(g.getState().totalMoves, 1);
  assert.equal(h.ends.length, 0);
});
test('Crate Keeper reset restores crates and history, and cannot farm score', () => {
  const g = createGame(harness().env),
    s = g.getState();
  for (let n = 0; n < 4; n++) {
    tap(g, 'ArrowRight');
    assert.equal(g.getState().solved, true);
    tap(g, 'KeyH');
    assert.equal(g.getState().hintStatus, 'solved');
    tap(g, n % 2 ? 'KeyX' : 'KeyZ');
    assert.equal(g.getState().score, 0);
  }
  tap(g, 'ArrowUp');
  tap(g, 'KeyX');
  const after = g.getState();
  assert.deepEqual(after.crates, s.crates);
  assert.equal(after.player, s.player);
  assert.equal(after.pushes, 0);
  assert.equal(after.undoCount, 1);
  tap(g, 'ArrowRight');
  tap(g, 'Enter');
  tap(g, 'Enter');
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().score, 640);
});
test('Crate Keeper a wall trap shows the stuck marker, an honest hint and an undo path out', () => {
  const g = createGame(harness().env);
  for (const code of ['ArrowUp', 'ArrowRight', 'ArrowDown']) tap(g, code);
  assert.equal(g.getState().deadlocked, true);
  assert.equal(g.getState().deadCrates.length, 1);
  assert.match(g.getState().status.en, /cannot reach a dock/);
  assert.match(g.getState().status.zh, /无法到达货位/);
  tap(g, 'KeyH');
  assert.equal(g.getState().hintStatus, 'no-route');
  assert.equal(g.getState().hintCode, null);
  assert.match(g.getState().hint, /Undo or reset/);
  g.draw(mockContext());
  tap(g, 'KeyZ');
  assert.equal(g.getState().deadlocked, false);
  for (const code of solveLevel(g.getState())) tap(g, code);
  assert.equal(g.getState().solved, true);
});
test('Crate Keeper hint names the next step in both languages and expires', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env);
    tap(g, 'KeyH');
    const s = g.getState();
    assert.equal(s.hintCode, 'ArrowRight');
    assert.equal(s.moves, 0);
    assert.equal(lang === 'zh', CJK.test(s.hint));
    g.draw(mockContext());
    for (let n = 0; n < 60 * 5; n++) g.update(1 / 60, input());
    assert.equal(g.getState().hint, null);
  }
  const g = start(14).g;
  g.update(1 / 120, input([], ['KeyH']));
  assert.match(g.getState().hint, /^NEXT: /);
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
  settle(g);
  for (let n = 0; n < 120; n++) g.update(1 / 120, input(['ArrowRight']));
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().pushes, 1);
});
test('Crate Keeper one buffered step is deliberate and reset, undo and Next clear pending actions', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp']));
  g.update(1 / 120, input([], ['ArrowRight']));
  assert.ok(g.getState().pending);
  settle(g);
  assert.equal(g.getState().moves, 2);
  tap(g, 'KeyX');
  g.update(1 / 120, input([], ['ArrowRight']));
  g.update(1 / 120, input([], ['Enter']));
  assert.equal(g.getState().confirmPending, true);
  g.update(1 / 120, input([], ['KeyZ']));
  settle(g);
  assert.equal(g.getState().level, 1);
  assert.equal(g.getState().solved, false);
  assert.equal(g.getState().confirmPending, false);
  tap(g, 'KeyX');
  g.update(1 / 120, input([], ['ArrowRight']));
  g.update(1 / 120, input([], ['Enter']));
  settle(g);
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().pending, null);
});
test('Crate Keeper a queued undo is replaced or cleared by the next action', () => {
  for (const action of ['Enter', 'KeyH', 'ArrowUp', 'KeyX']) {
    const g = createGame(harness().env);
    g.update(1 / 120, input([], ['ArrowRight']));
    g.update(1 / 120, input([], ['KeyZ']));
    assert.equal(g.getState().pendingUndo, true);
    g.update(1 / 120, input([], [action]));
    settle(g);
    const s = g.getState();
    assert.equal(s.pendingUndo, false);
    assert.equal(s.pending, null);
    assert.equal(s.confirmPending, false);
    if (action === 'Enter') assert.equal(s.level, 2);
    else if (action === 'KeyH') assert.equal(s.hintStatus, 'solved');
    else assert.equal(s.moves, 0);
  }
});
test('Crate Keeper rapid undo retraces cardinal moves rather than cutting a corner', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['ArrowUp']));
  settle(g);
  g.update(1 / 120, input([], ['ArrowRight']));
  settle(g);
  g.update(1 / 120, input([], ['KeyZ']));
  g.update(1 / 120, input([], ['KeyZ']));
  const m = g.getState().motion;
  assert.ok(
    Math.abs(m.player.to.x - m.player.from.x) < 1e-8 ||
      Math.abs(m.player.to.y - m.player.from.y) < 1e-8,
  );
  settle(g);
  assert.equal(g.getState().moves, 0);
});
test('Crate Keeper opposite or diagonal presses and blocked walks are neutral', () => {
  const h = harness(),
    g = createGame(h.env),
    s0 = g.getState();
  g.update(1 / 60, input([], ['ArrowLeft', 'ArrowRight']));
  g.update(1 / 60, input([], ['ArrowUp', 'ArrowRight']));
  g.update(1 / 120, input([], ['ArrowLeft', 'ArrowRight'], { clicked: true, x: 240, y: 150 }));
  assert.equal(g.getState().player, s0.player);
  assert.equal(g.getState().moves, 0);
  for (let n = 0; n < 4; n++) tap(g, 'ArrowLeft');
  assert.ok(h.sounds.includes('hit'));
  g.draw(mockContext());
});
test('Crate Keeper adjacent board taps are one legal step and ignore far taps', () => {
  const g = createGame(harness({ lang: 'zh' }).env),
    initial = g.getState(),
    layout = crateLayout(initial.w, initial.h),
    at = (x, y) => ({
      x: layout.ox + x * layout.size,
      y: layout.oy + y * layout.size,
      clicked: true,
    });
  g.update(1 / 120, input([], [], at(3.5, 2.5)));
  settle(g);
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().solved, true);
  tap(g, 'KeyZ');
  assert.deepEqual(g.getState().crates, initial.crates);
  const before = g.getState();
  g.update(1 / 120, input([], [], at(0.5, 0.5)));
  g.update(1 / 120, input([], [], at(40, 40)));
  assert.equal(g.getState().moves, before.moves);
});
test('Crate Keeper touch controls cover every action with both languages', () => {
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyZ',
    'KeyH',
    'KeyX',
    'KeyM',
    'Enter',
  ])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en);
    assert.match(c.label.zh, CJK);
  }
  assert.match(meta.description.en, /twenty/);
  assert.match(meta.description.zh, CJK);
});
test('Crate Keeper warehouse select moves, denies locked rooms and starts the chosen one', () => {
  const menuOnly = () => createGame(Object.assign(harness().env, { progress: memoryStore(9) }));
  const m = menuOnly();
  assert.equal(m.getState().menu.cursor, 9);
  assert.equal(m.getState().menu.total, 20);
  m.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(m.getState().menu.cursor, 8);
  m.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(m.getState().menu.cursor, 3);
  m.update(1 / 60, input([], ['ArrowDown']));
  m.update(1 / 60, input([], ['ArrowRight']));
  m.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(m.getState().menu.cursor, 9);
  const locked = menuCell(12);
  m.update(1 / 60, input([], [], { clicked: true, x: locked.x + 3, y: locked.y + 3 }));
  assert.equal(m.getState().menu.cursor, 9);
  const open = menuCell(4);
  m.update(1 / 60, input([], [], { clicked: true, x: open.x + 3, y: open.y + 3 }));
  assert.equal(m.getState().menu, null);
  assert.equal(m.getState().level, 4);
  m.draw(mockContext());
  m.update(1 / 60, input([], ['KeyM']));
  assert.equal(m.getState().menu.cursor, 4);
  m.draw(mockContext());
  m.update(1 / 60, input([], ['Enter']));
  assert.equal(m.getState().level, 4);
  const fresh = createGame(harness().env);
  assert.equal(fresh.getState().menu, null);
  fresh.update(1 / 60, input([], ['KeyM']));
  assert.equal(fresh.getState().menu.cursor, 1);
  fresh.update(1 / 60, input([], ['Space']));
  assert.equal(fresh.getState().level, 1);
});
test('Crate Keeper clearing a room unlocks the next and never lowers progress', () => {
  const { g, progress } = start(1, { progress: memoryStore(1) });
  for (const code of solveLevel(LEVELS[0])) tap(g, code);
  assert.deepEqual(progress.calls, [2]);
  assert.equal(g.getState().unlocked, 2);
  assert.equal(progress.value, 2);
  const again = createGame(Object.assign(harness().env, { progress }));
  assert.equal(again.getState().menu.cursor, 2);
});
test('Crate Keeper tolerates broken, throwing and junk progress stores', () => {
  const stores = [
    { unlocked: () => 'abc', unlock() {} },
    { unlocked: () => NaN, unlock() {} },
    { unlocked: () => Infinity, unlock() {} },
    { unlocked: () => -4, unlock() {} },
    { unlocked: () => 3.9, unlock() {} },
    { unlocked: () => 999, unlock() {} },
    { unlocked: () => '7', unlock() {} },
    { unlocked: () => null, unlock() {} },
    {
      unlocked() {
        throw new Error('storage disabled');
      },
      unlock() {
        throw new Error('storage disabled');
      },
    },
    {},
  ];
  const expected = [1, 1, 1, 1, 3, 21, 7, 1, 1, 1];
  stores.forEach((progress, i) => {
    const h = harness();
    h.env.progress = progress;
    const g = createGame(h.env);
    assert.equal(g.getState().unlocked, expected[i], `store ${i}`);
    assert.equal(g.getState().menu?.cursor ?? 1, Math.min(expected[i], 20));
    g.update(1 / 60, input([], ['Enter']));
    const first = solveLevel(g.getState());
    for (const code of first) tap(g, code);
    assert.equal(g.getState().solved, true);
  });
  const g = createGame(Object.assign(harness().env, { progress: undefined }));
  assert.equal(g.getState().unlocked, 1);
});

const at = (g, x, y) => {
  const { size, ox, oy } = crateLayout(g.getState().w, g.getState().h);
  return { x: ox + (x + 0.5) * size, y: oy + (y + 0.5) * size, clicked: true };
};
/** First level and direction with a long walk that never touches a crate. */
function longWalk() {
  for (let level = 1; level <= 20; level++)
    for (const key of Object.keys(STEP)) {
      let s = parseLevel(LEVELS[level - 1]),
        steps = 0;
      for (;;) {
        const n = moveState(s, ...STEP[key]);
        if (n === s || n.crates !== s.crates) break;
        s = n;
        steps++;
      }
      if (steps >= 5) return { level, key };
    }
  throw new Error('no long walk');
}
function enter(level, unlocked) {
  const h = harness();
  h.env.progress = memoryStore(unlocked);
  const g = createGame(h.env);
  for (let n = level; n < unlocked; n++) g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, level);
  return g;
}
function holdKey(key, seconds, hz, level) {
  const { g } = start(level),
    frames = Math.round(seconds * hz);
  g.update(1 / hz, input([key], [key]));
  const early = [];
  for (let n = 1; n < frames; n++) {
    g.update(1 / hz, input([key]));
    if (n === Math.round(0.2 * hz)) early.push(g.getState().moves);
  }
  return { g, early: early[0] };
}
test('Crate Keeper a held arrow waits, then repeats at the same pace at every frame rate', () => {
  const { level, key } = longWalk(),
    results = [30, 60, 120].map((hz) => {
      const { g, early } = holdKey(key, 0.6, hz, level);
      assert.equal(early, 1, `no repeat before the delay at ${hz} Hz`);
      return g.getState().moves;
    });
  assert.deepEqual(results, [4, 4, 4]);
  // Releasing stops the walk, and a held diagonal or opposite pair never repeats.
  const { g } = holdKey(key, 0.6, 60, level);
  settle(g, 60);
  const moved = g.getState().moves;
  for (let n = 0; n < 120; n++) g.update(1 / 60, input());
  assert.equal(g.getState().moves, moved);
  const neutral = start(level).g;
  for (let n = 0; n < 120; n++) neutral.update(1 / 60, input(['ArrowLeft', 'ArrowRight']));
  for (let n = 0; n < 120; n++) neutral.update(1 / 60, input(['ArrowUp', 'ArrowRight']));
  assert.equal(neutral.getState().moves, 0);
});
test('Crate Keeper switching the held direction restarts the delay', () => {
  const { level } = longWalk(),
    { g } = start(level);
  g.update(1 / 60, input(['ArrowUp', 'ArrowDown']));
  for (let n = 0; n < 10; n++) g.update(1 / 60, input(['ArrowLeft']));
  assert.equal(g.getState().moves, 0);
  for (let n = 0; n < 20; n++) g.update(1 / 60, input(['ArrowLeft']));
  assert.ok(g.getState().moves <= 1);
});
test('Crate Keeper tapping a reachable tile walks there without pushing and can be undone', () => {
  for (const hz of [30, 60, 120]) {
    const { g } = start(13),
      initial = g.getState(),
      paths = reach(initial),
      [target, path] = [...paths].sort((a, b) => b[1].length - a[1].length)[0];
    assert.ok(path.length >= 3);
    g.update(1 / hz, input([], [], at(g, target % initial.w, Math.floor(target / initial.w))));
    assert.ok(g.getState().routeLength > 0 || path.length === 1);
    for (let n = 0; n < hz * 10 && (g.getState().busy || g.getState().routeLength); n++)
      g.update(1 / hz, input());
    const s = g.getState();
    assert.equal(s.player, target);
    assert.equal(s.moves, path.length);
    assert.equal(s.pushes, 0);
    assert.deepEqual(s.crates, initial.crates);
    assert.equal(s.undoCount, path.length);
    for (let n = 0; n < path.length; n++) press(g, 'KeyZ', hz);
    assert.equal(g.getState().player, initial.player);
    assert.equal(g.getState().moves, 0);
  }
});
function press(g, code, hz) {
  tap(g, code, hz);
}
test('Crate Keeper tap-to-walk ignores crates, walls and unreachable tiles and yields to any key', () => {
  const { g } = start(13),
    s = g.getState(),
    far2 = (c) =>
      Math.abs((c % s.w) - (s.player % s.w)) +
        Math.abs(Math.floor(c / s.w) - Math.floor(s.player / s.w)) >
      1,
    far = s.crates.find((c) => walkPath(s, c) === null && far2(c));
  assert.ok(far !== undefined);
  const wall = s.walls.find((w) => far2(w));
  for (const cell of [far, wall, s.player])
    g.update(1 / 60, input([], [], at(g, cell % s.w, Math.floor(cell / s.w))));
  assert.equal(g.getState().moves, 0);
  const [target] = [...reach(s)].sort((a, b) => b[1].length - a[1].length)[0];
  g.update(1 / 60, input([], [], at(g, target % s.w, Math.floor(target / s.w))));
  assert.ok(g.getState().routeLength > 0);
  g.update(1 / 60, input([], ['KeyH']));
  assert.equal(g.getState().routeLength, 0);
  settle(g);
  assert.ok(g.getState().moves < walkPath(s, target).length);
  // Tapping a crate next to the keeper still pushes it.
  const { g: p } = start(1),
    init = p.getState();
  p.update(
    1 / 60,
    input([], [], at(p, (init.player % init.w) + 1, Math.floor(init.player / init.w))),
  );
  settle(p);
  assert.equal(p.getState().pushes, 1);
});
test('Crate Keeper the room select closes without reloading the room', () => {
  for (const cancel of [
    { p: ['KeyM'] },
    { p: ['Escape'] },
    { ptr: { clicked: true, x: 240, y: 10 } },
  ]) {
    const g = enter(5, 9);
    for (const code of ['ArrowRight', 'ArrowDown']) tap(g, code);
    const before = g.getState();
    assert.ok(before.moves > 0);
    g.update(1 / 60, input([], ['KeyM']));
    assert.equal(g.getState().menu.cursor, 5);
    g.update(1 / 60, input([], cancel.p ?? [], cancel.ptr));
    const after = g.getState();
    assert.equal(after.menu, null);
    assert.equal(after.level, 5);
    assert.equal(after.moves, before.moves);
    assert.deepEqual(after.crates, before.crates);
    assert.equal(after.player, before.player);
  }
  const g = enter(5, 9);
  tap(g, 'ArrowRight');
  const moves = g.getState().moves;
  g.update(1 / 60, input([], ['KeyM']));
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().moves, moves);
  g.update(1 / 60, input([], ['KeyM']));
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, 4);
});
test('Crate Keeper reset is an undo step that restores the room before the reset', () => {
  const { g } = start(13),
    initial = g.getState();
  const keys = solveLevel(initial).slice(0, 6);
  for (const code of keys) tap(g, code);
  const before = g.getState();
  assert.ok(before.moves === 6);
  tap(g, 'KeyX');
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().player, initial.player);
  tap(g, keys[0]);
  tap(g, 'KeyZ');
  tap(g, 'KeyZ');
  const restored = g.getState();
  assert.equal(restored.player, before.player);
  assert.deepEqual(restored.crates, before.crates);
  assert.equal(restored.moves, before.moves);
  assert.equal(restored.pushes, before.pushes);
  assert.equal(restored.undoCount, before.undoCount);
  for (let n = 0; n < 6; n++) tap(g, 'KeyZ');
  assert.equal(g.getState().player, initial.player);
  // Resetting a fresh room is a no-op, and undoing a reset of a solved room re-solves it.
  const one = createGame(harness().env);
  tap(one, 'KeyX');
  assert.equal(one.getState().undoCount, 0);
  tap(one, 'ArrowRight');
  tap(one, 'KeyX');
  assert.equal(one.getState().solved, false);
  tap(one, 'KeyZ');
  assert.equal(one.getState().solved, true);
  assert.equal(one.getState().moves, 1);
});
test('Crate Keeper room score grows with room size and is not flat for long rooms', () => {
  const par = PAR_PUSHES;
  assert.equal(roomScore(1, 1), 640);
  assert.ok(roomScore(20, par[19] * 5) > roomScore(1, 1));
  assert.ok(roomScore(20, par[19] * 5 + 20) < roomScore(20, par[19] * 5));
  assert.ok(roomScore(11, 69) > 100 && roomScore(19, 145) > 100);
  assert.equal(roomScore(5, 10000), 100);
});
test('Crate Keeper shows room 20 as cleared after the final win and explains par', () => {
  const store = memoryStore(20),
    h = harness();
  h.env.progress = store;
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Enter']));
  for (const code of solveLevel(g.getState())) tap(g, code);
  tap(g, 'Enter');
  assert.equal(g.getState().phase, 'won');
  assert.equal(store.value, 21);
  const again = createGame(Object.assign(harness().env, { progress: store })),
    drawn = [];
  assert.equal(again.getState().menu.cursor, 20);
  const ctx = mockContext();
  ctx.fillText = (t) => drawn.push(t);
  again.draw(ctx);
  assert.equal(drawn.filter((t) => t === 'CLEARED').length, 20);
  assert.ok(drawn.some((t) => /fewest pushes/.test(t)));
  const play = createGame(harness().env);
  drawn.length = 0;
  play.draw(ctx);
  assert.ok(drawn.some((t) => /PAR 1 = best pushes/.test(t)));
});
