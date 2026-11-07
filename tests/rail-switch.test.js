import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  MENU,
  LEVELS,
  LEVEL_COUNT,
  PRESS,
  compileLevel,
  labelCells,
  neighbourJunction,
  selectStep,
  newState,
  advance,
  snapshotOf,
  drawGame,
  createGame,
} from '../src/games/rail-switch.js';
import { harness, input, mockContext } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Helpers: tiny hand-made yards so each rule can be checked on its own.
// ---------------------------------------------------------------------------------------------
const grid = (rows) =>
  Array.from({ length: RULES.rows }, (_, y) => (rows[y] ?? '').padEnd(RULES.cols, '.'));
const FORK = grid(['a--A--1', '...|', '...L--2']);
const def = (extra = {}) => ({
  name: ['Test', '测试'],
  tip: ['tip', '提示'],
  stem: { A: 'W' },
  map: FORK,
  trains: [[1, 'a', '1', 'n', 'A:0']],
  ...extra,
});
const compile = (extra) => compileLevel(def(extra));
const press = (...codes) => input([], codes);
const none = input();

function world(extra, env = {}) {
  const s = newState(env, [compile(extra)]);
  return s;
}
function run(s, seconds, feed = () => none, hz = 60) {
  const dt = 1 / hz;
  for (let f = 0; f < Math.round(seconds * hz); f++) {
    if (s.phase !== 'playing') break;
    advance(s, dt, feed(f, s));
  }
  return s;
}
const messageOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return null;
};

// ---------------------------------------------------------------------------------------------
// Meta and level data
// ---------------------------------------------------------------------------------------------
test('meta follows the contract and offers every action by touch', () => {
  assert.equal(meta.id, 'rail-switch');
  assert.ok(meta.name.en && meta.name.zh);
  assert.ok(meta.description.en.length > 100 && meta.description.zh.length > 40);
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  assert.ok(meta.keys.length >= 3);
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const codes = meta.touchControls.map((c) => c.code);
  for (const need of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyX'])
    assert.ok(codes.includes(need), need);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && c.label.zh);
    assert.ok(['left', 'right'].includes(c.side));
    assert.ok(!['Escape', 'KeyP', 'KeyR'].includes(c.code));
  }
});

test('there are at least 20 distinct, compiled levels with a real difficulty curve', () => {
  assert.ok(LEVELS.length >= 20);
  assert.equal(LEVEL_COUNT, LEVELS.length);
  assert.equal(new Set(LEVELS.map((l) => l.name[0])).size, LEVELS.length);
  assert.equal(new Set(LEVELS.map((l) => l.map.join('/'))).size, LEVELS.length);
  assert.equal(
    new Set(LEVELS.map((l) => l.trains.map((t) => t.slice(0, 4).join()).join('|'))).size,
    LEVELS.length,
  );
  for (const l of LEVELS) {
    assert.ok(l.name[0] && l.name[1] && l.tip[0] && l.tip[1]);
    const c = compileLevel(l);
    assert.ok(c.quota >= 1 && c.quota <= c.trains.length);
    assert.ok(c.junctions.length >= 1);
    for (const t of c.trains) assert.ok(c.platforms[t.dest] !== undefined);
  }
  const compiled = LEVELS.map((l) => compileLevel(l));
  const avg = (a, b) => compiled.slice(a, b).reduce((n, c) => n + c.trains.length, 0) / (b - a);
  assert.ok(avg(10, 20) > avg(0, 5) + 3, 'later timetables carry more trains');
  assert.ok(compiled[0].trains.length <= 8 && compiled[0].junctions.length === 1);
  assert.ok(compiled.at(-1).junctions.length >= 6 && compiled.at(-1).trains.length >= 14);
});

test('the campaign introduces crossings, loops, sidings, timed signals and express trains', () => {
  const has = (pred) => LEVELS.findIndex((l) => pred(compileLevel(l)));
  const firstCross = has((c) => c.tiles.some((t) => t?.kind === 'cross'));
  const firstSignal = has((c) => c.sigs.length > 0);
  const firstExpress = has((c) => c.trains.some((t) => t.k === 'x'));
  const firstSlow = has((c) => c.trains.some((t) => t.k === 's'));
  const firstMerge = has((c) => c.tiles.some((t) => t?.kind === 'merge'));
  const firstTwoWay = has((c) => Object.keys(c.portals).length >= 2 && c.junctions.length >= 3);
  for (const idx of [firstCross, firstSignal, firstExpress, firstSlow, firstMerge, firstTwoWay])
    assert.ok(idx >= 0);
  assert.equal(firstSignal > 0 && firstCross > 0, true, 'level 1 stays gentle');
  assert.ok(firstExpress <= 6 && firstSlow <= 6);
  const loops = LEVELS.filter((l) => /passing|loop|overtak/i.test(l.name[0])).length;
  assert.ok(loops >= 3);
  const singleTrack = LEVELS.filter((l) => /single|mountain/i.test(l.name[0])).length;
  assert.ok(singleTrack >= 3);
  const twoWay = compileLevel(LEVELS.find((l) => /single track$/i.test(l.name[0])));
  assert.ok(Object.keys(twoWay.portals).length >= 2);
});

test('compileLevel rejects malformed levels with a readable message', () => {
  assert.match(
    messageOf(() => compile({ map: ['....'] })),
    /30 x 16/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--A--1', '...|', '...L--2', '?']) })),
    /unknown tile/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--A--1', '...|', '...L--']) })),
    /connections/,
  );
  assert.match(
    messageOf(() => compile({ stem: {} })),
    /stem/,
  );
  assert.match(
    messageOf(() => compile({ stem: { A: 'N' } })),
    /stem/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--A--1', '...|', '...A--2']), stem: { A: 'W' } })),
    /twice|connections|stem/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--=--1']), stem: {} })),
    /signal/,
  );
  assert.match(
    messageOf(() =>
      compile({
        map: grid(['a--=--1']),
        stem: {},
        sig: [
          [8, 4, 0],
          [8, 4, 0],
        ],
      }),
    ),
    /signal/,
  );
  assert.match(
    messageOf(() => compile({ trains: [[1, 'z', '1', 'n']] })),
    /route ends/,
  );
  assert.match(
    messageOf(() => compile({ trains: [[1, 'a', '9', 'n']] })),
    /route ends/,
  );
  assert.match(
    messageOf(() => compile({ trains: [[1, 'a', '1', 'n', 'Q:1']] })),
    /unknown junction/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--A--1', '...|', '...L--1']) })),
    /platform 1 appears twice/,
  );
  assert.match(
    messageOf(() => compile({ map: grid(['a--A--1', '...|', '...L--a']) })),
    /portal a appears twice/,
  );
  assert.match(
    messageOf(() => compileLevel({ ...def(), map: ['x'] }, 4)),
    /level 5/,
  );
});

test('compileLevel orders trains by time and defaults the quota', () => {
  const c = compile({
    trains: [
      [9, 'a', '1', 'n'],
      [2, 'a', '2', 'x', 'A:1'],
      [2, 'a', '1', 's', ''],
    ],
  });
  assert.deepEqual(
    c.trains.map((t) => t.k),
    ['x', 's', 'n'],
  );
  assert.equal(c.quota, 1);
  assert.equal(compile({ quota: 3 }).quota, 3);
  assert.equal(c.trains[0].speed, RULES.speeds.x);
});

// ---------------------------------------------------------------------------------------------
// Selection graph
// ---------------------------------------------------------------------------------------------
test('arrow selection moves to the nearest junction in that direction and can reach every junction', () => {
  for (const l of LEVELS) {
    const c = compileLevel(l);
    const js = c.junctions;
    for (let a = 0; a < js.length; a++)
      for (let b = 0; b < js.length; b++) {
        if (a === b) {
          assert.equal(selectStep(js, a, b), -1);
          continue;
        }
        let at = a;
        for (let n = 0; n < js.length && at !== b; n++) {
          const d = selectStep(js, at, b);
          assert.ok(d >= 0, `${l.name[0]}: ${js[a].id} cannot reach ${js[b].id}`);
          const next = neighbourJunction(js, at, d);
          assert.ok(next >= 0);
          at = next;
        }
        assert.equal(at, b, `${l.name[0]} ${js[a].id}->${js[b].id}`);
      }
  }
  const js = compileLevel(LEVELS[1]).junctions;
  assert.equal(neighbourJunction(js, 0, 0), -1);
  assert.equal(neighbourJunction(js, 0, 3), -1);
  assert.ok(neighbourJunction(js, 0, 1) >= 0);
  assert.equal(selectStep([js[0]], 0, 5), -1);
  assert.deepEqual(PRESS, ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']);
});

// ---------------------------------------------------------------------------------------------
// Movement, junctions and the strike rules
// ---------------------------------------------------------------------------------------------
test('a train waits for its timetable, then runs at its stated speed and is delivered', () => {
  const s = world({ trains: [[2, 'a', '1', 'n', 'A:0']] });
  run(s, 1.5);
  let snap = snapshotOf(s);
  assert.equal(snap.trains[0].state, 'wait');
  assert.equal(snap.trains[0].x, null);
  run(s, 1);
  snap = snapshotOf(s);
  assert.equal(snap.trains[0].state, 'run');
  const x0 = snap.trains[0].x;
  run(s, 1);
  const x1 = snapshotOf(s).trains[0].x;
  assert.ok(Math.abs(x1 - x0 - RULES.speeds.n) < 0.05, `moved ${x1 - x0}`);
  run(s, 6);
  assert.equal(s.delivered, 1);
  assert.equal(s.phase, 'won');
  assert.equal(s.strikes, 0);
});

test('speeds are seconds-based: express beats normal beats slow over the same track', () => {
  const finish = (k) => {
    const s = world({ quota: 1, trains: [[0.5, 'a', '1', k, 'A:0']] });
    const start = s.w.t;
    while (s.phase === 'playing' && s.w.t < 60) advance(s, 1 / 60, none);
    return s.w.t - start;
  };
  const [x, n, sl] = ['x', 'n', 's'].map(finish);
  assert.ok(x < n && n < sl);
  assert.ok(Math.abs(sl / n - RULES.speeds.n / RULES.speeds.s) < 0.15);
});

test('flipping a junction changes which platform the train reaches', () => {
  const s = world({ trains: [[1, 'a', '2', 'n', 'A:1']] });
  assert.equal(snapshotOf(s).junctions[0].exit, 'E');
  advance(s, 1 / 60, press('Space'));
  assert.equal(snapshotOf(s).junctions[0].state, 1);
  assert.equal(snapshotOf(s).junctions[0].exit, 'S');
  run(s, 10);
  assert.equal(s.stats.delivered, 1);
  assert.equal(s.strikes, 0);
});

test('Enter flips too, and WASD selects like the arrows', () => {
  const s = world();
  advance(s, 1 / 60, press('Enter'));
  assert.equal(s.w.sw[0], 1);
  const wide = newState({}, [compileLevel(LEVELS[1])]);
  advance(wide, 1 / 60, press('KeyD'));
  assert.equal(wide.sel, 1);
  advance(wide, 1 / 60, press('KeyA'));
  assert.equal(wide.sel, 0);
  advance(wide, 1 / 60, press('ArrowDown'));
  advance(wide, 1 / 60, press('KeyW'));
  advance(wide, 1 / 60, press('KeyS'));
  assert.ok(wide.sel >= 0);
});

test('a wrong destination costs a strike and does not count as delivered', () => {
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [8, 'a', '1', 'n', 'A:0'],
    ],
  });
  run(s, 6);
  assert.equal(s.strikes, 1);
  assert.equal(s.stats.wrong, 1);
  assert.equal(s.delivered, 0);
  assert.equal(snapshotOf(s).incident, 'wrong');
  assert.equal(snapshotOf(s).wrecks.length, 1);
});

test('three strikes lose the timetable', () => {
  const trains = [0.5, 6, 12, 18].map((t) => [t, 'a', '2', 'n', 'A:0']);
  const s = world({ quota: 1, trains });
  run(s, 80);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'strikes');
  assert.equal(s.strikes, 3);
});

test('a timetable is lost as soon as the quota can no longer be met', () => {
  const s = world({
    quota: 3,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [6, 'a', '1', 'n'],
      [12, 'a', '1', 'n'],
      [18, 'a', '1', 'n'],
    ],
  });
  run(s, 40);
  assert.equal(s.phase, 'won', 'one strike with three good trains still meets a quota of three');
  assert.equal(s.strikes, 1);
  const t = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [2, 'a', '2', 'n', 'A:0'],
    ],
  });
  run(t, 40);
  assert.equal(t.phase, 'lost');
  assert.equal(t.cause, 'quota');
});

// A small unused fork keeps a junction on every test map; platforms 4-6 belong to it.
const SPARE = ['4-B-5', '..|', '..6'];
const yard = (rows, extra = {}) =>
  compileLevel(
    def({
      stem: { B: 'W' },
      quota: 1,
      map: grid([...rows, ...Array(Math.max(0, 12 - rows.length)).fill(''), ...SPARE]),
      ...extra,
    }),
  );
const one = (rows, extra) => newState({}, [yard(rows, extra)]);

test('head-on and rear-end collisions each cost a strike, at every step rate', () => {
  for (const hz of [30, 60, 120]) {
    const h = one(['a---------b'], {
      trains: [
        [0.5, 'a', '4', 'n'],
        [0.5, 'b', '5', 'n'],
      ],
    });
    run(h, 12, () => none, hz);
    assert.equal(h.stats.crashes, 1, `head-on at ${hz}`);
    assert.equal(h.strikes, 1);
    assert.equal(h.last, 'head-on');
    const r = one(['a-----------------1'], {
      trains: [
        [0.5, 'a', '1', 's'],
        [2.5, 'a', '1', 'x'],
      ],
    });
    run(r, 25, () => none, hz);
    assert.equal(r.stats.crashes, 1, `rear-end at ${hz}`);
    assert.equal(r.last, 'rear-end');
  }
});

const CROSS = [
  '',
  '',
  '',
  '.....b',
  '.....|',
  '.....|',
  'a----+----1',
  '.....|',
  '.....|',
  '.....2',
];

test('trains meeting on a crossing collide as a side crash and the crossing is shared', () => {
  const meet = one(CROSS, {
    trains: [
      [0.5, 'a', '1', 'n'],
      [1.5, 'b', '2', 'n'],
    ],
  });
  run(meet, 10);
  assert.equal(meet.stats.crashes, 1);
  assert.equal(meet.last, 'side');
  const apart = one(CROSS, {
    quota: 2,
    trains: [
      [0.5, 'a', '1', 'n'],
      [6, 'b', '2', 'n'],
    ],
  });
  run(apart, 14);
  assert.equal(apart.stats.crashes, 0);
  assert.equal(apart.delivered, 2);
});

test('no train spawns into occupied track: it is held at the portal with a visible signal', () => {
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '1', 's', 'A:0'],
      [1.5, 'a', '1', 's', 'A:0'],
    ],
  });
  run(s, 1.55);
  let snap = snapshotOf(s);
  assert.equal(snap.trains[0].state, 'run');
  assert.equal(snap.trains[1].state, 'wait');
  assert.equal(snap.portals[0].held, true);
  let guard = 0;
  while (snapshotOf(s).trains[1].state === 'wait' && guard++ < 600) {
    advance(s, 1 / 60, none);
    const t = snapshotOf(s).trains;
    if (t[1].state === 'wait' && t[0].state === 'run')
      assert.ok(Math.hypot(t[0].x - 0.5, t[0].y - 0.5) < RULES.portalClear + 0.55, 'held too long');
  }
  snap = snapshotOf(s);
  assert.equal(snap.trains[1].state, 'run');
  const gap = Math.hypot(snap.trains[0].x - snap.trains[1].x, snap.trains[0].y - snap.trains[1].y);
  assert.ok(gap >= RULES.hitDist, `spawned ${gap} behind`);
  run(s, 12);
  assert.equal(s.stats.crashes, 0);
  assert.equal(s.delivered, 2);
});

test('trains from two portals into one trunk are held apart rather than spawned into each other', () => {
  const s = one(['a---m---1', '....|', 'b---J'], {
    stem: { B: 'W', m: 'E' },
    quota: 2,
    trains: [
      [0.5, 'a', '1', 'n'],
      [0.5, 'b', '1', 'n'],
    ],
  });
  assert.equal(Object.keys(s.L.portals).length, 2);
  run(s, 12);
  assert.equal(s.stats.crashes, 0);
  assert.equal(s.delivered, 2);
});

test('a train is never launched into an oncoming train, however the timetable lines up', () => {
  let held = 0;
  for (let step = 0; step < 140; step++) {
    const due = 1 + step * 0.05;
    const s = one(['a-----------b'], {
      quota: 1,
      trains: [
        [1, 'a', '4', 'x'],
        [due, 'b', '5', 'n'],
      ],
    });
    let crashAt = null;
    for (let f = 0; f < 14 * 120 && crashAt === null; f++) {
      advance(s, 1 / 120, none);
      if (s.stats.crashes) crashAt = s.w.t;
    }
    const second = s.w.trains[1];
    // Trains that leave at the same moment from both ends are the player's problem; a train sent
    // out while the other is already close must never meet it within a second of leaving.
    if (crashAt !== null) assert.ok(crashAt - second.spawnT >= 1, `due ${due.toFixed(2)} s`);
    if (second.spawnT > due + 0.02) held++;
  }
  assert.ok(held > 5, 'the guard actually held trains back');
});

test('a junction is locked while a train is on it', () => {
  const s = world({ quota: 1, trains: [[0.5, 'a', '1', 'n', 'A:0']] });
  let refused = false;
  for (let f = 0; f < 600 && !refused; f++) {
    advance(s, 1 / 60, none);
    if (snapshotOf(s).junctions[0].locked) {
      advance(s, 1 / 60, press('Space'));
      refused = true;
    }
  }
  assert.ok(refused);
  assert.equal(s.stats.refused, 1);
  assert.equal(s.w.sw[0], 0);
  assert.ok(snapshotOf(s).message.en.includes('Locked'));
  assert.ok(snapshotOf(s).message.zh.includes('锁定'));
});

test('a red lamp holds a train and it moves off again on green', () => {
  const s = one(['a---=---1'], {
    sig: [[10, 3, 0]],
    trains: [[3.2, 'a', '1', 'n']],
  });
  run(s, 7);
  const tr = snapshotOf(s).trains[0];
  assert.equal(tr.waiting, true, 'held at the red lamp');
  assert.equal(snapshotOf(s).signals[0].green, false);
  run(s, 1.5);
  assert.ok(Math.abs(snapshotOf(s).trains[0].x - tr.x) < 1e-9);
  run(s, 8);
  assert.equal(s.delivered, 1);
  assert.ok(s.w.t > 10);
});

test('a train queued behind a halted train stops short instead of ramming it', () => {
  const s = one(['a-----=---1'], {
    sig: [[20, 2, 0]],
    quota: 2,
    trains: [
      [3, 'a', '1', 'n'],
      [5, 'a', '1', 'n'],
    ],
  });
  run(s, 12);
  assert.equal(s.stats.crashes, 0);
  const t = snapshotOf(s).trains;
  assert.ok(t[0].waiting && t[1].waiting);
  run(s, 25);
  assert.equal(s.stats.crashes, 0);
  assert.equal(s.delivered, 2);
});

test('a train that circles a loop forever is written off as late', () => {
  const only = { ...LEVELS[10], trains: [LEVELS[10].trains[0]], quota: 1 };
  const s = newState({}, [compileLevel(only)]);
  run(s, RULES.transit + 20, () => none, 30);
  assert.equal(s.stats.late, 1);
  assert.equal(s.strikes, 1);
  assert.equal(snapshotOf(s).incident, 'late');
});

test('clearing a timetable shows a banner, moves on to the next one and finally wins', () => {
  const s = newState({}, [compile({ quota: 1 }), compile({ quota: 1 })]);
  while (s.level === 0) advance(s, 1 / 60, none);
  assert.equal(s.level, 1, 'the second timetable has started');
  assert.equal(s.delivered, 0);
  assert.equal(s.score, RULES.scoreDeliver + RULES.scoreClear + RULES.lives * RULES.scoreLife);
  const t = newState({}, [compile({ quota: 1 }), compile({ quota: 1 })]);
  while (t.clear <= 0) advance(t, 1 / 60, none);
  assert.equal(snapshotOf(t).clearing, true);
  assert.equal(snapshotOf(t).message.en, 'Timetable cleared!');
  assert.match(snapshotOf(t).message.zh, /完成/);
  run(t, 2.1);
  assert.equal(snapshotOf(t).clearing, false);
  run(t, 15);
  assert.equal(t.phase, 'won');
  assert.equal(t.stats.cleared, 2);
});

// ---------------------------------------------------------------------------------------------
// Prompt, preview and the status line
// ---------------------------------------------------------------------------------------------
test('the prompt names the selected junction and arrow, then the flip, in both languages', () => {
  const s = newState({}, [compileLevel(LEVELS[1])]);
  s.w.sw = s.w.sw.map(() => 1);
  run(s, 3.2);
  const p = snapshotOf(s).prompt;
  assert.ok(p);
  assert.ok(['select', 'flip', 'watch'].includes(p.kind));
  assert.ok(p.en.length > 10 && p.zh.length > 5);
  if (p.kind === 'select') {
    assert.ok(PRESS.includes(p.press));
    assert.ok(p.en.includes('Press') && /[↑→↓←]/.test(p.zh));
  }
  if (p.kind === 'flip') assert.equal(p.press, 'Space');
});

test('X toggles the route preview, which lists the cells the next train will take', () => {
  const s = world({ trains: [[4, 'a', '1', 'n', 'A:0']] });
  assert.equal(snapshotOf(s).preview, null);
  advance(s, 1 / 60, press('KeyX'));
  const pv = snapshotOf(s).preview;
  assert.equal(pv.train, 0);
  assert.equal(pv.cells.at(-1).x, 6);
  assert.equal(pv.cells.at(-1).y, 0);
  advance(s, 1 / 60, press('KeyX'));
  assert.equal(snapshotOf(s).preview, null);
  const t = world({ trains: [[0.5, 'a', '2', 'n', 'A:1']] });
  advance(t, 1 / 60, press('KeyX'));
  run(t, 1.5);
  const live = snapshotOf(t).preview;
  assert.ok(live.cells.length >= 4);
  run(t, 12);
  advance(t, 1 / 60, none);
});

// ---------------------------------------------------------------------------------------------
// Level select and saved progress
// ---------------------------------------------------------------------------------------------
function progress(start) {
  let unlocked = start;
  const calls = [];
  return {
    calls,
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
}

test('with saved progress the game opens a level select that only offers unlocked levels', () => {
  const h = harness();
  h.env.progress = progress(4);
  const g = createGame(h.env);
  assert.deepEqual(g.getState().menu, { sel: 4, unlocked: 4 });
  g.update(1 / 60, press('ArrowRight'));
  assert.equal(g.getState().menu.sel, 4);
  g.update(1 / 60, press('ArrowLeft'));
  g.update(1 / 60, press('KeyA'));
  assert.equal(g.getState().menu.sel, 2);
  g.update(1 / 60, press('ArrowDown'));
  assert.equal(g.getState().menu.sel, 4);
  g.update(1 / 60, press('ArrowUp'));
  g.update(1 / 60, press('KeyD'));
  g.update(1 / 60, press('KeyS'));
  g.update(1 / 60, press('KeyW'));
  g.update(1 / 60, press('KeyD'));
  g.update(1 / 60, press('Space'));
  assert.equal(g.getState().menu, null);
  assert.ok(g.getState().level >= 1 && g.getState().level <= 4);
  assert.ok(h.sounds.includes('move'));
});

test('tapping a menu cell selects it and tapping it again starts that level', () => {
  const h = harness();
  h.env.progress = progress(6);
  const g = createGame(h.env);
  const cell = (n) => ({
    x: MENU.x + ((n - 1) % RULES.menuCols) * MENU.w + 10,
    y: MENU.y + Math.floor((n - 1) / RULES.menuCols) * MENU.h + 10,
  });
  g.update(1 / 60, input([], [], { ...cell(2), clicked: true }));
  assert.equal(g.getState().menu.sel, 2);
  g.update(1 / 60, input([], [], { ...cell(10), clicked: true }));
  assert.equal(g.getState().menu.sel, 2, 'locked cells do nothing');
  g.update(1 / 60, input([], [], { x: 3, y: 3, clicked: true }));
  assert.equal(g.getState().menu.sel, 2);
  g.update(1 / 60, input([], [], { ...cell(2), clicked: true }));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 2);
});

test('clearing a level unlocks the next, never lowers progress, and invalid progress is ignored', () => {
  const p = progress(1);
  const s = newState({ progress: p }, [compile({ quota: 1 }), compile({ quota: 1 })]);
  run(s, 12);
  assert.deepEqual(p.calls, [2, 2]);
  assert.equal(p.unlocked(), 2);
  for (const bad of [NaN, -3, 0, 'x', undefined, 1e9]) {
    const q = newState(
      { progress: { unlocked: () => bad, unlock() {} } },
      LEVELS.map((l) => compileLevel(l)),
    );
    assert.ok(q.menu === null || q.menu.unlocked <= LEVELS.length);
  }
  assert.equal(
    newState({ progress: { unlocked: () => 1e9 } }, [compile(), compile()]).menu.unlocked,
    2,
  );
  assert.equal(newState({}, [compile()]).menu, null);
});

// ---------------------------------------------------------------------------------------------
// Pointer play
// ---------------------------------------------------------------------------------------------
test('tapping a junction selects it, and tapping it again flips it', () => {
  const s = newState({}, [compileLevel(LEVELS[1])]);
  const j = s.L.junctions[1];
  const at = {
    x: (j.x + 0.5) * RULES.tile,
    y: RULES.top + (j.y + 0.5) * RULES.tile,
    clicked: true,
  };
  advance(s, 1 / 60, input([], [], at));
  assert.equal(s.sel, 1);
  assert.equal(s.stats.flips, 0);
  advance(s, 1 / 60, input([], [], at));
  assert.equal(s.stats.flips, 1);
  const before = s.sel;
  advance(s, 1 / 60, input([], [], { x: 5, y: 300, clicked: true }));
  assert.equal(s.sel, before, 'taps far from every junction do nothing');
});

// ---------------------------------------------------------------------------------------------
// The module contract
// ---------------------------------------------------------------------------------------------
test('terminal screens freeze input and end fires once with a bilingual message', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    for (let f = 0; f < 60 * 400 && !h.ends.length; f++) g.update(1 / 30, none);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.ok(h.ends[0].message.length > 10);
    if (lang === 'zh') assert.match(h.ends[0].message, /[一-鿿]/);
    const snap = JSON.stringify(g.getState());
    for (let f = 0; f < 120; f++)
      g.update(1 / 30, press('Space', 'ArrowRight', 'ArrowDown', 'KeyX'));
    assert.equal(JSON.stringify(g.getState()), snap);
    assert.equal(h.ends.length, 1);
  }
});

test('the last timetable ends in a win with a score status in both languages', () => {
  const s = newState({}, [compile({ quota: 1 })]);
  run(s, 10);
  assert.equal(s.phase, 'won');
  assert.match(snapshotOf(s).status.en, /Score/);
  assert.match(snapshotOf(s).status.zh, /得分/);
});

test('losing statuses are reported in the snapshot, in both languages', () => {
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [2, 'a', '2', 'n', 'A:0'],
    ],
  });
  run(s, 30);
  const snap = snapshotOf(s);
  assert.equal(snap.phase, 'lost');
  assert.match(snap.status.en, /shut down/);
  assert.match(snap.status.zh, /停运/);
});

test('invalid, zero, negative and oversized dt are handled', () => {
  const g = createGame(harness().env);
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, undefined, null, 'x'])
    g.update(dt, press('Space', 'KeyX'));
  assert.equal(JSON.stringify(g.getState()), before);
  g.update(5, none);
  assert.ok(g.getState().time <= RULES.maxDt + 1e-9);
  assert.equal(advance(newState({}, [compile()]), 0, none), false);
});

test('getState returns copies that cannot change the game', () => {
  const g = createGame(harness().env);
  for (let f = 0; f < 600; f++) g.update(1 / 60, none);
  const a = g.getState();
  const snapshot = JSON.stringify(a);
  a.junctions[0].state = 9;
  a.trains.length = 0;
  a.stats.crashes = 99;
  a.status.en = 'hacked';
  a.score = -5;
  a.phase = 'won';
  if (a.prompt) a.prompt.en = 'hacked';
  assert.equal(JSON.stringify(g.getState()), snapshot);
  assert.notEqual(g.getState().junctions, a.junctions);
  const back = JSON.parse(snapshot);
  assert.deepEqual(back, JSON.parse(JSON.stringify(g.getState())));
});

test('state is JSON-safe and finite at every level start', () => {
  const walk = (v, path = '') => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), path);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    else assert.notEqual(v, undefined, path);
  };
  for (let i = 0; i < LEVELS.length; i++) {
    const s = newState(
      {},
      LEVELS.map((l) => compileLevel(l)),
    );
    s.level = 0;
    const snap = snapshotOf(s);
    walk(snap);
    const p = progress(i + 1);
    const g = createGame({ ...harness().env, progress: p });
    if (i > 0) g.update(1 / 60, press('Space'));
    for (let f = 0; f < 240; f++) g.update(1 / 60, none);
    walk(g.getState());
    assert.equal(g.getState().level, i + 1);
  }
});

test('draw smoke: every level, menu, preview, strikes and both languages render without error', () => {
  for (const lang of ['en', 'zh']) {
    for (let i = 1; i <= LEVELS.length; i++) {
      const h = harness({ lang });
      h.env.progress = progress(i);
      const g = createGame(h.env);
      if (i > 1) g.draw(mockContext());
      if (i > 1) g.update(1 / 60, press('Space'));
      for (let f = 0; f < 90; f++) g.update(1 / 30, f === 20 ? press('KeyX') : none);
      g.draw(mockContext());
    }
  }
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [0.5, 'a', '1', 'n', 'A:0'],
    ],
  });
  for (let f = 0; f < 300; f++) {
    advance(s, 1 / 60, f === 5 ? press('KeyX') : none);
    drawGame(mockContext(), s, harness().env);
  }
  drawGame(mockContext(), s, harness({ lang: 'zh' }).env);
  const done = world({ quota: 1 });
  run(done, 10);
  drawGame(mockContext(), done, harness().env);
});

test('the whole playfield and HUD stay inside the 480 x 320 canvas', () => {
  assert.equal(RULES.cols * RULES.tile, 480);
  assert.ok(RULES.top + RULES.rows * RULES.tile <= RULES.bottom);
  assert.ok(RULES.bottom < 320);
  for (const l of LEVELS) {
    const c = compileLevel(l);
    assert.equal(c.tiles.length, RULES.cols * RULES.rows);
    const snap = snapshotOf(newState({}, [c]));
    assert.deepEqual(snap.hud, { top: [0, RULES.top], bottom: [RULES.bottom, 320] });
  }
});

// ---------------------------------------------------------------------------------------------
// Strike feedback, spare trains, the 2-minute limit and departure jitter
// ---------------------------------------------------------------------------------------------
function spy() {
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) =>
      p === 'fillText' ? (text) => texts.push(String(text)) : p in t ? t[p] : () => {},
    set: (t, p, v) => ((t[p] = v), true),
  });
  return { ctx, texts };
}

test('every kind of strike explains itself on screen, in English and Chinese', () => {
  const cases = {
    'head-on': {
      quota: 1,
      map: ['a---------b'],
      trains: [
        [0.5, 'a', '4', 'n'],
        [0.5, 'b', '5', 'n'],
      ],
      en: /head-on/,
      zh: /迎面/,
    },
    'rear-end': {
      quota: 1,
      map: ['a-----------------1'],
      trains: [
        [0.5, 'a', '1', 's'],
        [2.5, 'a', '1', 'x'],
      ],
      en: /rammed a slow one/,
      zh: /追尾/,
    },
    side: {
      quota: 1,
      map: CROSS,
      trains: [
        [0.5, 'a', '1', 'n'],
        [1.5, 'b', '2', 'n'],
      ],
      en: /crossing/,
      zh: /交叉口/,
    },
  };
  for (const [kind, c] of Object.entries(cases)) {
    const s = one(c.map, { quota: c.quota, trains: c.trains });
    let seen = null;
    for (let f = 0; f < 60 * 12 && !seen; f++) {
      advance(s, 1 / 60, none);
      if (s.strikes) seen = snapshotOf(s);
    }
    assert.equal(seen.incident, kind);
    assert.match(seen.message.en, c.en);
    assert.match(seen.message.zh, c.zh);
    assert.match(seen.message.en, /^Strike!/);
    const drawn = spy();
    drawGame(drawn.ctx, s, harness().env);
    assert.ok(
      drawn.texts.some((t) => /Strike!/.test(t)),
      'the banner is drawn',
    );
  }
  const wrong = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [8, 'a', '1', 'n'],
      [14, 'a', '1', 'n'],
    ],
  });
  run(wrong, 6);
  assert.match(snapshotOf(wrong).message.en, /wrong platform/);
  assert.match(snapshotOf(wrong).message.zh, /错误的站台/);
  run(wrong, RULES.strikeMsgTime + 0.5);
  assert.equal(wrong.phase, 'playing');
  assert.equal(snapshotOf(wrong).message, null, 'and it fades');
});

test('a train written off after two minutes says so, and counts down before it', () => {
  const only = { ...LEVELS[10], trains: [LEVELS[10].trains[0]], quota: 1 };
  const s = newState({}, [compileLevel(only)]);
  run(s, 20, () => none, 30);
  let tr = snapshotOf(s).trains[0];
  assert.ok(tr.timeLeft > RULES.lateWarn, 'no countdown yet');
  let drawn = spy();
  drawGame(drawn.ctx, s, harness().env);
  assert.ok(!drawn.texts.some((t) => /^\d+$/.test(t)), 'no number over the train');
  while (snapshotOf(s).trains[0].timeLeft > RULES.lateWarn - 2) advance(s, 1 / 30, none);
  tr = snapshotOf(s).trains[0];
  assert.ok(tr.timeLeft <= RULES.lateWarn && tr.timeLeft > 0, `timeLeft ${tr.timeLeft}`);
  drawn = spy();
  drawGame(drawn.ctx, s, harness().env);
  assert.ok(
    drawn.texts.some((t) => /^\d+$/.test(t) && Math.abs(Number(t) - tr.timeLeft) <= 1),
    'the countdown is drawn',
  );
  run(s, RULES.lateWarn + 1, () => none, 30);
  assert.equal(snapshotOf(s).incident, 'late');
  assert.match(snapshotOf(s).message.en, /2 minutes/);
  assert.match(snapshotOf(s).message.zh, /两分钟/);
  assert.equal(snapshotOf(s).trains[0].timeLeft, null);
});

test('the description and the loop tips explain the 2-minute limit and the spare count', () => {
  assert.match(meta.description.en, /2 minutes/);
  assert.match(meta.description.zh, /2 分钟/);
  assert.match(meta.description.en, /Spare/);
  assert.match(meta.description.zh, /余量/);
  const rings = LEVELS.filter((l) =>
    compileLevel(l).tiles.some((t) => t?.kind === 'merge' && t.stem === 1),
  );
  const ringTips = LEVELS.filter((l) => /ring|circl/i.test(l.tip[0]));
  assert.ok(ringTips.length >= 2);
  for (const l of ringTips) {
    assert.match(l.tip[0], /2 minutes/, l.name[0]);
    assert.match(l.tip[1], /2 分钟/, l.name[0]);
  }
  assert.ok(rings.length >= 2);
});

test('spare counts how many more trains can be lost and is shown on the HUD and status line', () => {
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [6, 'a', '1', 'n'],
      [12, 'a', '1', 'n'],
      [18, 'a', '1', 'n'],
    ],
  });
  assert.equal(snapshotOf(s).spare, 2);
  assert.match(snapshotOf(s).status.en, /Spare 2/);
  assert.match(snapshotOf(s).status.zh, /余量 2/);
  run(s, 6);
  assert.equal(snapshotOf(s).strikes, 1);
  assert.equal(snapshotOf(s).spare, 1, 'the wrong train used up one spare');
  const drawn = spy();
  drawGame(drawn.ctx, s, harness().env);
  assert.ok(drawn.texts.includes('Spare 1'));
  const zh = spy();
  drawGame(zh.ctx, s, harness({ lang: 'zh' }).env);
  assert.ok(zh.texts.includes('余量 1'));
  run(s, 40);
  assert.equal(s.phase, 'won');
  const crash = one(['a---------b'], {
    quota: 1,
    trains: [
      [0.5, 'a', '4', 'n'],
      [0.5, 'b', '5', 'n'],
    ],
  });
  assert.equal(snapshotOf(crash).spare, 1);
  run(crash, 12);
  assert.equal(crash.phase, 'lost');
});

test('departure times are shifted by a small seeded jitter that keeps each portal in order', () => {
  const level = compileLevel(LEVELS[9]);
  const times = (seed) => {
    const s = newState(harness({ seed }).env, [level]);
    return s.w.trains.map((tr) => tr.d.t);
  };
  const authored = level.trains.map((t) => t.t);
  assert.deepEqual(times(3), times(3), 'the same seed gives the same timetable');
  assert.notDeepEqual(times(3), times(4));
  assert.deepEqual(
    newState({}, [level]).w.trains.map((tr) => tr.d.t),
    authored,
    'no random source, no jitter',
  );
  for (let seed = 1; seed <= 30; seed++) {
    const t = times(seed);
    t.forEach((v, i) => {
      assert.ok(
        Math.abs(v - authored[i]) <= RULES.jitter + 1e-9,
        `train ${i} moved ${v - authored[i]}`,
      );
    });
    const byPortal = {};
    level.trains.forEach((d, i) => (byPortal[d.portal] ??= []).push(t[i]));
    for (const list of Object.values(byPortal))
      list.forEach((v, i) => i === 0 || assert.ok(v - list[i - 1] >= RULES.jitterGap - 1e-9));
  }
  assert.ok(RULES.jitter > 0 && RULES.jitter <= 0.5);
});

test('progress edge cases: infinity opens every level, malformed stores count as no progress', () => {
  const levels = [compile(), compile(), compile()];
  assert.equal(
    newState({ progress: { unlocked: () => Infinity, unlock() {} } }, levels).menu.unlocked,
    3,
  );
  assert.equal(
    newState({ progress: { unlocked: () => -Infinity, unlock() {} } }, levels).menu,
    null,
  );
  const broken = [
    { unlocked: 'later' },
    {
      unlocked() {
        throw new Error('storage is full');
      },
    },
    {
      unlocked: () => 3,
      unlock() {
        throw new Error('storage is full');
      },
    },
    42,
  ];
  for (const progress of broken) {
    const s = newState({ progress }, [compile({ quota: 1 })]);
    run(s, 12);
    assert.equal(s.phase, 'won', 'a broken store never stops the game');
  }
});

test('junction letters fall back to the junction itself when every diagonal is taken', () => {
  const tiles = new Array(RULES.cols * RULES.rows).fill({});
  assert.deepEqual(labelCells(tiles, [{ x: 5, y: 5 }]), [{ x: 5, y: 5 }]);
  const free = new Array(RULES.cols * RULES.rows).fill(null);
  const two = labelCells(free, [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]);
  assert.notDeepEqual(two[0], two[1]);
});

test('spare never shows a negative number, even on the loss screen', () => {
  const s = world({
    quota: 2,
    trains: [
      [0.5, 'a', '2', 'n', 'A:0'],
      [2, 'a', '2', 'n', 'A:0'],
    ],
  });
  run(s, 40);
  assert.equal(s.phase, 'lost');
  assert.equal(snapshotOf(s).spare, 0);
  const en = spy();
  drawGame(en.ctx, s, harness().env);
  assert.ok(en.texts.includes('Spare 0'));
  const zh = spy();
  drawGame(zh.ctx, s, harness({ lang: 'zh' }).env);
  assert.ok(zh.texts.includes('余量 0'));
  assert.ok(!en.texts.some((t) => /-\d/.test(t)));
});
