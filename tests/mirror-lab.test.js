import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOMS,
  ROOM_COUNT,
  RULES,
  meta,
  createGame,
  parseRoom,
  rowsAt,
  traceBeam,
  solveRoom,
  advise,
  adviceLine,
  reflect,
  gridOrigin,
  cellAt,
  menuCellAt,
} from '../src/games/mirror-lab.js';
import { harness, input, mockContext } from './harness.js';

// The fewest turns each room needs, as recorded from the solver. A room edit must update this table.
const OPTIMAL = [1, 2, 2, 2, 2, 4, 4, 4, 5, 5, 5, 6, 6, 5, 6, 6, 6, 7, 8, 8, 9, 10];
const TUTORIAL_ROOMS = 5; // rooms 1 to 5 teach the controls with 1 to 4 switches
const KEY_OF = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };

// --- helpers ---------------------------------------------------------------------------------
function small(rows, extra = {}) {
  return parseRoom({ name: ['t', '测'], tip: ['t', '测'], rows, ...extra });
}
function open(level = 1, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  const calls = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  h.calls = calls;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const press = (g, ...codes) => g.update(1 / 60, input([], codes));
const idle = (g, seconds, hz = 60) => {
  for (let n = 0; n < Math.round(seconds * hz); n++) g.update(1 / hz, input());
};
function walkTo(g, x, y) {
  for (let n = 0; n < 40; n++) {
    const c = g.getState().cursor;
    if (c.x < x) press(g, 'ArrowRight');
    else if (c.x > x) press(g, 'ArrowLeft');
    else if (c.y < y) press(g, 'ArrowDown');
    else if (c.y > y) press(g, 'ArrowUp');
    else return;
  }
  assert.fail('cursor did not arrive');
}
// The turns of a shortest solution, read straight from the solver table (not from the prompt).
function plan(room) {
  const { dist } = solveRoom(room);
  const turns = [];
  let bits = 0;
  while (dist[bits] > 0) {
    const i = room.toggles.findIndex((_, k) => dist[bits ^ (1 << k)] === dist[bits] - 1);
    const ci = room.toggles[i];
    turns.push({
      x: ci % room.w,
      y: Math.floor(ci / room.w),
      key: room.cells[ci].k === 'shutter' ? 'KeyX' : 'Space',
    });
    bits ^= 1 << i;
  }
  return turns;
}
function playPlan(g, room) {
  for (const turn of plan(room)) {
    walkTo(g, turn.x, turn.y);
    press(g, turn.key);
  }
}
const logical = (st) => {
  const { beam, undos, message, litShown, status, ...rest } = st;
  return rest;
};
const ENDS = (h) => h.ends.length;

// --- metadata and data -----------------------------------------------------------------------
test('meta describes the game in both languages with working touch controls', () => {
  assert.equal(meta.id, 'mirror-lab');
  assert.equal(meta.genre, 'puzzle');
  for (const field of [meta.name, meta.description])
    assert.ok(field.en.length > 5 && /[一-鿿]/.test(field.zh));
  assert.ok(meta.description.en.includes(String(ROOM_COUNT)));
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyX',
    'KeyZ',
    'KeyQ',
  ])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
  for (const k of meta.keys) assert.ok(k.label.en && /[一-鿿]/.test(k.label.zh));
  assert.ok(!codes.includes('KeyP') && !codes.includes('KeyR') && !codes.includes('Escape'));
});

test('there are at least 20 rooms, each within the bench size, bilingual and with the recorded optimum', () => {
  assert.ok(ROOM_COUNT >= 20);
  assert.equal(ROOMS.length, OPTIMAL.length);
  const names = new Set();
  ROOMS.forEach((room, i) => {
    assert.ok(room.w <= RULES.maxCols && room.h <= RULES.maxRows, `room ${i + 1} size`);
    assert.ok(room.toggles.length <= RULES.maxToggles);
    assert.ok(room.name.en && /[一-鿿]/.test(room.name.zh), `room ${i + 1} name`);
    assert.ok(room.tip.en && /[一-鿿]/.test(room.tip.zh), `room ${i + 1} tip`);
    names.add(room.name.en);
    const sol = solveRoom(room);
    assert.equal(sol.optimal, OPTIMAL[i], `room ${i + 1} optimum`);
    assert.ok(sol.wins >= 1);
    assert.ok(!traceBeam(room, 0).solved, `room ${i + 1} starts solved`);
    if (room.budget !== null) assert.ok(room.budget > sol.optimal, `room ${i + 1} budget`);
  });
  assert.equal(names.size, ROOM_COUNT);
});

test('the rooms teach distinct ideas: ordered sensors, crystals, shutters, splitters, locks, decoys and budgets', () => {
  const kinds = (room, k) => room.cells.filter((c) => c.k === k).length;
  const count = (fn) => ROOMS.filter(fn).length;
  assert.ok(count((r) => r.ordered) >= 4);
  assert.ok(count((r) => kinds(r, 'crystal') > 0) >= 6);
  assert.ok(count((r) => kinds(r, 'shutter') > 0) >= 3);
  assert.ok(count((r) => kinds(r, 'splitter') > 0) >= 4);
  assert.ok(count((r) => r.cells.some((c) => c.fixed && c.k === 'mirror')) >= 1);
  assert.ok(count((r) => r.budget !== null) >= 4);
  assert.ok(count((r) => r.sensors >= 2) >= 8);
  // No inert switches from room 6 on: every switch must matter, so each room has one solved setting.
  // Rooms 1 to 5 are the recorded tutorials and may have spare switches.
  ROOMS.forEach((room, i) => {
    if (i < TUTORIAL_ROOMS) return;
    assert.ok(room.toggles.length >= 9, `room ${i + 1} has ${room.toggles.length} switches`);
    assert.equal(solveRoom(room).wins, 1, `room ${i + 1} has a spare solved setting`);
  });
});

test('the difficulty curve rises: later thirds need more turns than earlier thirds', () => {
  const third = Math.floor(ROOM_COUNT / 3);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const first = mean(OPTIMAL.slice(0, third));
  const mid = mean(OPTIMAL.slice(third, 2 * third));
  const last = mean(OPTIMAL.slice(2 * third));
  assert.ok(first < mid && mid < last, `${first} ${mid} ${last}`);
  assert.equal(OPTIMAL[0], 1);
  assert.ok(OPTIMAL[ROOM_COUNT - 1] >= 8);
  OPTIMAL.forEach((n, i) => i && assert.ok(n >= OPTIMAL[i - 1] - 1, `room ${i + 1} dips`));
});

// --- optics ----------------------------------------------------------------------------------
test('the reflection table is right for every mirror type and every incoming direction', () => {
  // right=0 down=1 left=2 up=3
  const slash = [3, 2, 1, 0]; // / : right->up, down->left, left->down, up->right
  const backslash = [1, 0, 3, 2]; // \ : right->down, down->right, left->up, up->left
  for (let d = 0; d < 4; d++) {
    assert.equal(reflect(d, 0), slash[d]);
    assert.equal(reflect(d, 1), backslash[d]);
    assert.equal(reflect(reflect(d, 0), 0), d, 'a mirror applied twice returns the beam');
  }
});

// A 5x5 bench with a mirror in the middle and a sensor ring: the beam enters from each side.
test('a beam bends exactly as the mirror orientation says, from all four directions', () => {
  const cases = [
    // emitter row, mirror, expected sensor position (x,y)
    { rows: ['..1..', '.....', '>.../', '.....', '.....'], mx: 4, my: 2, lit: false },
    { rows: ['.....', '.....', '>..\\.', '....1', '.....'], mx: 3, my: 2, lit: false },
  ];
  for (const c of cases) assert.equal(traceBeam(small(c.rows), 0).solved, c.lit);
  const mirrorCases = [
    // [emitter, mirror, sensor, expected lit]
    ['>', '/', 'up', true],
    ['>', '\\', 'down', true],
    ['<', '/', 'down', true],
    ['<', '\\', 'up', true],
    ['v', '/', 'left', true],
    ['v', '\\', 'right', true],
    ['^', '/', 'right', true],
    ['^', '\\', 'left', true],
    ['>', '/', 'down', false],
    ['v', '\\', 'left', false],
  ];
  for (const [em, mirror, side, expected] of mirrorCases) {
    const g = Array.from({ length: 5 }, () => Array(5).fill('.'));
    g[2][2] = mirror;
    const start = { '>': [0, 2], '<': [4, 2], v: [2, 0], '^': [2, 4] }[em];
    g[start[1]][start[0]] = em;
    const at = { up: [2, 0], down: [2, 4], left: [0, 2], right: [4, 2] }[side];
    g[at[1]][at[0]] = '1';
    const room = small(g.map((r) => r.join('')));
    assert.equal(traceBeam(room, 0).solved, expected, `${em} ${mirror} ${side}`);
    // Turning the mirror swaps the outcome for the mirrored side.
    if (expected) assert.equal(traceBeam(room, 1).solved, false, `${em} ${mirror} turned`);
  }
});

test('walls, the emitter, closed shutters and the bench edge stop the beam', () => {
  assert.equal(traceBeam(small(['>.#.1']), 0).solved, false, 'wall');
  assert.equal(traceBeam(small(['>.=.1']), 0).solved, false, 'closed shutter');
  assert.equal(traceBeam(small(['>._.1']), 0).solved, true, 'open shutter');
  assert.equal(traceBeam(small(['>.1']), 0).solved, true);
  assert.equal(traceBeam(small(['1.>']), 0).solved, false, 'beam leaves the bench');
  // A beam coming back into the emitter is absorbed there.
  const back = traceBeam(small(['>.\\', '..\\']), 0);
  assert.equal(back.steps.length > 0, true);
  assert.equal(back.looped, false);
  const t = traceBeam(small(['..1', '>./', '..#']), 0);
  assert.equal(t.steps.at(-1).x <= 2, true);
});

test('a sensor behind a wall can never register, in any setting of the bench', () => {
  const room = small(['>.\\..', '..#..', '..\\.1', '#####']);
  assert.equal(solveRoom(room).wins, 0);
  assert.equal(solveRoom(room).optimal, 255);
  // The sensor right behind a wall of the room is dark however the mirrors are turned.
  const walled = small(['>/../', '.#.#.', '..#1.', '.....']);
  for (let m = 0; m < 1 << walled.toggles.length; m++)
    assert.equal(traceBeam(walled, m).lit[0], -1, `mask ${m}`);
});

test('a sensor passes the beam on, so one beam can light a whole row of them', () => {
  const r = traceBeam(small(['>123.']), 0);
  assert.deepEqual(r.lit, [1, 2, 3]);
  assert.equal(r.solved, true);
});

test('a crystal absorbs the beam, counts as lit and spoils the room', () => {
  const room = small(['>.X.1']);
  const r = traceBeam(room, 0);
  assert.equal(r.crystals.length, 1);
  assert.deepEqual(r.crystals[0], { x: 2, y: 0, t: 2 });
  assert.equal(r.lit[0], -1, 'the crystal stops the beam');
  const both = traceBeam(small(['>1X']), 0);
  assert.equal(both.litCount, 1);
  assert.equal(both.solved, false, 'every sensor lit but a crystal is lit too');
});

test('a splitter passes the beam on and reflects a second one', () => {
  const room = small(['.1...', '>s.2.', '.....'].map((r) => r));
  const r = traceBeam(room, 0);
  assert.deepEqual(
    r.lit.map((t) => t >= 0),
    [true, true],
  );
  const turned = traceBeam(small(['.....', '>t.2.', '.1...']), 0);
  assert.deepEqual(
    turned.lit.map((t) => t >= 0),
    [true, true],
  );
  const fixed = traceBeam(small(['.1...', '>c.2.']), 0);
  assert.equal(fixed.solved, true);
  const fixedBack = traceBeam(small(['>d.2.', '.1...']), 0);
  assert.equal(fixedBack.solved, true);
});

test('tracing terminates on loops and reports them', () => {
  // A fixed splitter feeds a ring of fixed mirrors: the ring would circle forever.
  const ring = small(['.....', '>cb..', '.....'].map((r) => r));
  assert.ok(traceBeam(ring, 0).steps.length > 0);
  const loop = small(['.....', '>c..b', '.....', '.b..a', '.....'].map((r) => r).slice(0, 5));
  const r = traceBeam(loop, 0);
  assert.equal(r.looped, true);
  assert.ok(r.steps.length < 40);
  assert.ok(Number.isFinite(r.maxT));
  // Two mirrors facing each other with a splitter between bounce the beam, yet the trace ends.
  const bounce = small(['b...a', '..>s.', 'a...b'].map((r) => r));
  const rb = traceBeam(bounce, 0);
  assert.ok(Number.isFinite(rb.maxT) && rb.steps.length < 200);
  // Every room still traces to an end in every setting.
  for (const room of ROOMS)
    for (let m = 0; m < 1 << room.toggles.length; m += 7)
      assert.ok(traceBeam(room, m).steps.length <= room.w * room.h * 8 + 4);
});

test('ordered sensors register only for a beam that has already passed the lower numbers', () => {
  const rows = ['>213.'];
  assert.equal(traceBeam(small(rows, { ordered: false }), 0).solved, true);
  const wrong = traceBeam(small(rows, { ordered: true }), 0);
  assert.deepEqual(
    wrong.lit.map((t) => t >= 0),
    [true, false, false],
    'sensor 2 was met before sensor 1, and sensor 3 needs 2 first',
  );
  assert.equal(wrong.solved, false);
  const right = traceBeam(small(['>123.'], { ordered: true }), 0);
  assert.equal(right.solved, true);
  // A split beam inherits what it has passed: the branch may light sensor 3 after 1 and 2.
  const split = traceBeam(small(['>12t.', '...3.'], { ordered: true }), 0);
  assert.deepEqual(
    split.lit.map((t) => t >= 0),
    [true, true, true],
  );
  // A branch that left before sensor 2 cannot light sensor 3.
  const late = traceBeam(small(['>1t2.', '..3..'], { ordered: true }), 0);
  assert.deepEqual(
    late.lit.map((t) => t >= 0),
    [true, true, false],
  );
  // The branch that skipped sensor 1 cannot light sensor 2.
  const skip = traceBeam(small(['>s.2.', '.....', '1....'], { ordered: true }), 0);
  assert.equal(skip.lit[1], -1);
});

test('rowsAt shows the current setting of every mirror, splitter and shutter', () => {
  const room = small(['>/\\sta', '_=bcd1']);
  assert.deepEqual(rowsAt(room, 0), ['>/\\sta', '_=bcd1']);
  const all = rowsAt(room, (1 << room.toggles.length) - 1);
  assert.deepEqual(all, ['>\\/tsa', '=_bcd1']);
  assert.deepEqual(rowsAt(small(['>X#.1']), 0), ['>X#.1']);
});

test('parseRoom rejects malformed rooms', () => {
  assert.throws(() => small(['>?1']), /Unknown room symbol/);
  assert.throws(() => small(['>.1', '..']), /ragged/);
  assert.throws(() => small(['..1']), /no emitter/);
  assert.throws(() => small(['>.2']), /lacks sensor 1/);
  assert.throws(() => small(['>' + '.'.repeat(10)]), /too large/);
  assert.throws(() => small(Array(8).fill('>.')), /too large/);
  assert.throws(() => small(['>////////////1']), /too large|too many/);
  assert.throws(
    () => small(['>///////', '///1////'].map((r) => r.slice(0, 8))),
    /too many toggles/,
  );
});

// --- solver and prompt -----------------------------------------------------------------------
test('every room is solvable and a scripted shortest solution clears it in the game', () => {
  ROOMS.forEach((room, i) => {
    const { g, h } = open(i + 1);
    assert.equal(g.getState().level, i + 1);
    const turns = plan(room);
    assert.equal(turns.length, OPTIMAL[i]);
    playPlan(g, room);
    const st = g.getState();
    assert.equal(st.solved, true, `room ${i + 1}`);
    assert.equal(st.moves, OPTIMAL[i]);
    idle(g, 4);
    const after = g.getState();
    if (i + 1 < ROOM_COUNT) assert.equal(after.level, i + 2, `room ${i + 1} advances`);
    assert.ok(h.calls.includes(Math.min(ROOM_COUNT, i + 2)));
    assert.equal(ENDS(h), i + 1 < ROOM_COUNT ? 0 : 1);
  });
});

test('solution paths satisfy an independent replay of the board at every step', () => {
  for (const room of ROOMS) {
    let bits = 0;
    for (const turn of plan(room)) {
      const idx = room.toggleOf[turn.y * room.w + turn.x];
      assert.ok(idx >= 0);
      bits ^= 1 << idx;
    }
    const final = traceBeam(room, bits);
    assert.equal(final.solved, true);
    assert.equal(final.crystals.length, 0);
    assert.equal(final.litCount, room.sensors);
  }
});

test('advise names a nearest useful switch and recovers after a wrong turn', () => {
  const room = ROOMS[2];
  const { dist } = solveRoom(room);
  const adv = advise(room, 0, { x: 0, y: 0 }, Infinity, false);
  assert.ok(adv.kind === 'move' || adv.kind === 'act');
  // Take a wrong turn: the advice from the new setting still shortens the distance.
  for (let m = 0; m < 1 << room.toggles.length; m++) {
    const a = advise(room, m, { x: 3, y: 3 }, Infinity, false);
    if (dist[m] === 0) assert.equal(a.kind, 'done');
    else {
      const ci = a.y * room.w + a.x;
      assert.ok(dist[m ^ (1 << room.toggleOf[ci])] === dist[m] - 1, `mask ${m}`);
    }
  }
  // Too few moves left: undo is advised.
  assert.equal(advise(ROOMS[12], 0, { x: 0, y: 0 }, 1, true).kind, 'undo');
  assert.deepEqual(adviceLine({ kind: 'undo' }, room), [
    'Too few moves left: press Z to undo',
    '剩余步数不足：按 Z 撤销',
  ]);
});

test('the prompt line, its arrow and the highlighted cell agree in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = open(9, { lang });
    for (let n = 0; n < 40; n++) {
      const st = g.getState();
      const h = st.hint;
      if (h.kind === 'move') {
        const arrow = /[←→↑↓]/.exec(st.line.en)[0];
        assert.equal(KEY_OF[arrow], h.key);
        assert.ok(st.line.zh.includes('光标向' + '右下左上'[['→', '↓', '←', '↑'].indexOf(arrow)]));
        assert.ok(st.line.en.includes(` ${h.steps} `));
        assert.equal(st.status[lang].endsWith(st.line[lang]), true);
        press(g, h.key);
      } else break;
    }
    const st = g.getState();
    assert.equal(st.hint.kind, 'act');
    assert.ok(st.line.en.startsWith('Press ') && st.line.zh.startsWith('按'));
    assert.deepEqual([st.cursor.x, st.cursor.y], [st.hint.x, st.hint.y]);
  }
});

test('the hint recovers after undo and after a restart', () => {
  const { g } = open(4);
  const first = g.getState().hint;
  walkTo(g, first.x, first.y);
  assert.equal(g.getState().hint.kind, 'act');
  press(g, g.getState().hint.key);
  assert.notDeepEqual(g.getState().hint, first);
  press(g, 'KeyZ');
  const back = g.getState();
  assert.equal(back.hint.x, first.x);
  assert.equal(back.hint.kind, 'act');
  press(g, 'KeyQ');
  assert.equal(g.getState().moves, 0);
  assert.equal(g.getState().hint.kind, 'move');
});

// --- controls --------------------------------------------------------------------------------
test('arrows and WASD move the cursor one cell, clamp at the edges and ignore ambiguous presses', () => {
  const { g } = open(3);
  const start = g.getState().cursor;
  press(g, 'ArrowLeft');
  assert.deepEqual(g.getState().cursor, start, 'clamped at the left edge');
  press(g, 'ArrowRight', 'ArrowLeft');
  assert.deepEqual(g.getState().cursor, start, 'opposite keys cancel');
  press(g, 'ArrowRight', 'ArrowDown');
  assert.deepEqual(g.getState().cursor, start, 'diagonal presses are neutral');
  press(g, 'ArrowRight');
  assert.deepEqual(g.getState().cursor, { x: start.x + 1, y: start.y });
  press(g, 'KeyD');
  press(g, 'KeyS');
  press(g, 'KeyA');
  press(g, 'KeyW');
  assert.deepEqual(g.getState().cursor, { x: start.x + 1, y: start.y });
  for (let n = 0; n < 20; n++) press(g, 'ArrowDown');
  assert.equal(g.getState().cursor.y, ROOMS[2].h - 1);
  for (let n = 0; n < 20; n++) press(g, 'ArrowRight');
  assert.equal(g.getState().cursor.x, ROOMS[2].w - 1);
});

test('Space turns the mirror under the cursor, X flips only shutters, locked and empty cells refuse', () => {
  const { g, h } = open(9);
  const room = ROOMS[8];
  const shutter = room.toggles.map((ci) => ci).find((ci) => room.cells[ci].k === 'shutter');
  const mirror = room.toggles.find((ci) => room.cells[ci].k === 'mirror');
  const at = (ci) => [ci % room.w, Math.floor(ci / room.w)];
  walkTo(g, ...at(mirror));
  press(g, 'KeyX');
  assert.equal(g.getState().moves, 0, 'X does not turn a mirror');
  assert.ok(g.getState().message.en.length > 0);
  press(g, 'Space');
  assert.equal(g.getState().moves, 1);
  assert.notEqual(g.getState().board.join(''), rowsAt(room, 0).join(''));
  walkTo(g, ...at(shutter));
  press(g, 'KeyX');
  assert.equal(g.getState().moves, 2);
  press(g, 'Space');
  assert.equal(g.getState().moves, 3, 'Space also flips a shutter');
  walkTo(g, 0, 0);
  const sounds = h.sounds.length;
  press(g, 'Space');
  assert.equal(g.getState().moves, 3, 'the emitter cell cannot turn');
  assert.ok(h.sounds.length > sounds);
  // A bolted mirror says so.
  const locked = open(4);
  const lroom = ROOMS[3];
  const bolted = lroom.cells.findIndex((c) => c.fixed);
  walkTo(locked.g, bolted % lroom.w, Math.floor(bolted / lroom.w));
  press(locked.g, 'Space');
  assert.equal(locked.g.getState().moves, 0);
  assert.match(locked.g.getState().message.en, /Bolted/);
  assert.match(locked.g.getState().message.zh, /锁定/);
});

test('tapping a cell selects it and tapping it again turns it', () => {
  const { g } = open(1);
  const room = ROOMS[0];
  const o = gridOrigin(room);
  const px = (x) => o.x + x * RULES.cell + 5;
  const py = (y) => o.y + y * RULES.cell + 5;
  g.update(1 / 60, input([], [], { x: px(4), y: py(0), clicked: true }));
  assert.deepEqual(g.getState().cursor, { x: 4, y: 0 });
  assert.equal(g.getState().moves, 0);
  g.update(1 / 60, input([], [], { x: px(4), y: py(0), clicked: true }));
  assert.equal(g.getState().moves, 1);
  assert.equal(g.getState().solved, true);
  // A tap outside the grid does nothing.
  const before = g.getState().cursor;
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.deepEqual(g.getState().cursor, before);
  assert.equal(cellAt(room, 2, 2), null);
  assert.equal(cellAt(room, o.x + 1, o.y + 1).x, 0);
});

test('undo restores the exact previous state and an empty history reports it', () => {
  const { g } = open(5);
  press(g, 'KeyZ');
  assert.ok(g.getState().message);
  const start = logical(g.getState());
  const hint = g.getState().hint;
  walkTo(g, hint.x, hint.y);
  const placed = logical(g.getState());
  press(g, g.getState().hint.key);
  assert.notDeepEqual(logical(g.getState()), placed);
  press(g, 'ArrowRight');
  press(g, 'KeyZ');
  assert.deepEqual(logical(g.getState()), placed);
  assert.equal(g.getState().undos, 1);
  assert.deepEqual(start.board, placed.board);
});

test('Q restarts the room, keeps the score and counts the restart', () => {
  const { g } = open(2);
  const room = ROOMS[1];
  for (const t of plan(room).slice(0, 1)) {
    walkTo(g, t.x, t.y);
    press(g, t.key);
  }
  assert.equal(g.getState().moves, 1);
  press(g, 'KeyQ');
  const st = g.getState();
  assert.equal(st.moves, 0);
  assert.equal(st.restarts, 1);
  assert.equal(st.board.join(''), rowsAt(room, 0).join(''));
  assert.deepEqual(st.cursor, { x: room.emitters[0].x, y: room.emitters[0].y });
  assert.equal(st.phase, 'playing');
});

test('invalid, zero or negative time never reads input, never moves the beam and never ends the game', () => {
  const { g, h } = open(3);
  press(g, 'ArrowRight');
  const before = JSON.stringify(g.getState());
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
    pointer: { clicked: true, x: 100, y: 100 },
  };
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined]) g.update(dt, hostile);
  assert.equal(JSON.stringify(g.getState()), before);
  assert.equal(reads, 0);
  assert.equal(ENDS(h), 0);
});

test('getState returns copies that cannot change the game', () => {
  const { g } = open(6);
  const a = g.getState();
  a.cursor.x = 99;
  a.board.length = 0;
  a.lit.push(true);
  a.line.en = 'hacked';
  a.hint.x = 7;
  a.name.en = 'x';
  a.status.en = 'x';
  const b = g.getState();
  assert.notEqual(b.cursor.x, 99);
  assert.ok(b.board.length > 0);
  assert.equal(b.lit.length, ROOMS[5].sensors);
  assert.notEqual(b.line.en, 'hacked');
  assert.notEqual(b.hint.x, 7);
  assert.equal(b.name.en, ROOMS[5].name.en);
  assert.ok(JSON.parse(JSON.stringify(b)));
  assert.equal(Object.isFrozen(RULES), true);
});

// --- campaign: clear, advance, loss, win, progress -------------------------------------------
test('a cleared room waits for the beam to settle, banks its score and moves on by itself or on Space', () => {
  const { g, h } = open(1);
  playPlan(g, ROOMS[0]);
  assert.equal(g.getState().cleared, false, 'not judged before the beam settles');
  idle(g, 0.5);
  assert.equal(g.getState().cleared, false);
  idle(g, 0.6);
  let st = g.getState();
  assert.equal(st.cleared, true);
  assert.equal(st.score, 100);
  assert.match(st.line.en, /Room clear/);
  assert.match(st.status.zh, /过关/);
  assert.ok(h.sounds.includes('win'));
  press(g, 'ArrowRight');
  assert.equal(g.getState().cursor.x, st.cursor.x, 'input is frozen while the room is clear');
  press(g, 'Space');
  st = g.getState();
  assert.equal(st.level, 2);
  assert.equal(st.cleared, false);
  assert.equal(st.moves, 0);
  // Automatic advance.
  const second = open(1);
  playPlan(second.g, ROOMS[0]);
  idle(second.g, 4);
  assert.equal(second.g.getState().level, 2);
});

test('extra turns cost score and the score never goes below the floor', () => {
  const { g } = open(2);
  const room = ROOMS[1];
  const t = plan(room);
  walkTo(g, t[0].x, t[0].y);
  for (let n = 0; n < 6; n++) press(g, 'Space'); // six wasted turns, back where we started
  for (const turn of t) {
    walkTo(g, turn.x, turn.y);
    press(g, turn.key);
  }
  idle(g, 1.8);
  const st = g.getState();
  assert.equal(st.level >= 2, true);
  assert.equal(
    st.score,
    Math.max(RULES.minRoomScore, RULES.clearScore - RULES.extraMovePenalty * 6),
  );
});

test('running out of turns in a budget room is a loss that freezes the game', () => {
  const { g, h } = open(13);
  const room = ROOMS[12];
  assert.equal(room.budget, solveRoom(room).optimal + 1);
  const t = plan(room)[0];
  walkTo(g, t.x, t.y);
  for (let n = 0; n < room.budget; n++) press(g, t.key);
  let st = g.getState();
  assert.equal(st.movesLeft, 0);
  assert.equal(st.phase, 'playing', 'judged only after the beam settles');
  press(g, 'Space');
  assert.equal(g.getState().moves, room.budget, 'no turn beyond the budget');
  assert.match(g.getState().message.en, /No turns left/);
  idle(g, 3);
  st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(ENDS(h), 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Out of turns in room 13/);
  assert.match(st.line.en, /Out of moves/);
  assert.doesNotMatch(st.status.en, /clear/i);
  assert.equal(st.cleared, false);
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(st);
  press(g, 'KeyZ', 'ArrowRight', 'Space', 'KeyQ');
  idle(g, 1);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(ENDS(h), 1);
});

test('the last turn of a budget may still win the room', () => {
  const { g, h } = open(13);
  playPlan(g, ROOMS[12]);
  assert.equal(g.getState().solved, true);
  idle(g, 5);
  assert.equal(g.getState().level, 14);
  assert.equal(ENDS(h), 0);
});

test('clearing the last room wins the game once with the full score and then freezes', () => {
  const { g, h } = open(ROOM_COUNT);
  playPlan(g, ROOMS[ROOM_COUNT - 1]);
  idle(g, 3);
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(ENDS(h), 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
  assert.match(st.line.en, /Every room is clear/);
  assert.match(st.status.zh, /全部房间已通关/);
  const frozen = JSON.stringify(st);
  press(g, 'Space', 'KeyQ', 'KeyZ');
  idle(g, 3);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(ENDS(h), 1);
});

test('a full run from room 1 reaches the win with a perfect score', () => {
  const { g, h } = open(1);
  for (let i = 0; i < ROOM_COUNT; i++) {
    assert.equal(g.getState().level, i + 1);
    playPlan(g, ROOMS[i]);
    idle(g, 5);
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(g.getState().score, 100 * ROOM_COUNT);
  assert.equal(ENDS(h), 1);
});

test('room select opens when progress is saved and starts the chosen room', () => {
  const { g } = open(5);
  let st = g.getState();
  assert.equal(st.menu, null, 'Space in the helper already started room 5');
  const h = harness();
  h.env.progress = { unlocked: () => 6, unlock() {} };
  const m = createGame(h.env);
  st = m.getState();
  assert.deepEqual(st.menu, { sel: 6, unlocked: 6 });
  assert.match(st.line.en, /Choose a room/);
  assert.match(st.line.zh, /选择房间/);
  assert.equal(st.status.en, st.line.en);
  press(m, 'ArrowLeft');
  assert.equal(m.getState().menu.sel, 5);
  press(m, 'ArrowRight', 'ArrowRight');
  assert.equal(m.getState().menu.sel, 6, 'clamped at the last unlocked room');
  press(m, 'ArrowUp');
  assert.equal(m.getState().menu.sel, 1, 'a row up lands on room 1 and clamps');
  press(m, 'ArrowDown');
  assert.equal(m.getState().menu.sel, 6);
  press(m, 'ArrowLeft');
  idle(m, 1);
  assert.equal(m.getState().menu.sel, 5, 'the menu does not run the beam');
  press(m, 'Enter');
  st = m.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 5);
});

test('room select by tap: the first tap selects, the second starts, locked rooms and gaps are ignored', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 4, unlock() {} };
  const g = createGame(h.env);
  const tile = (n) => ({
    x: 48 + ((n - 1) % RULES.menuCols) * 64 + 20,
    y: 74 + Math.floor((n - 1) / RULES.menuCols) * 44 + 20,
    clicked: true,
  });
  g.update(1 / 60, input([], [], tile(2)));
  assert.equal(g.getState().menu.sel, 2);
  g.update(1 / 60, input([], [], tile(9)));
  assert.equal(g.getState().menu.sel, 2, 'locked room');
  g.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true }));
  assert.equal(g.getState().menu.sel, 2, 'outside the tiles');
  g.update(1 / 60, input([], [], tile(2)));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 2);
  assert.equal(menuCellAt(48, 74), 1);
  assert.equal(menuCellAt(48 + 64 * 6, 74), -1);
  assert.equal(
    menuCellAt(48 + 64 * 5 + 1, 74 + 44 * 3 + 1),
    ROOM_COUNT > 18 ? (18 + 6 > ROOM_COUNT ? -1 : 24) : -1,
  );
  assert.equal(menuCellAt(0, 0), -1);
});

test('progress is read safely: no store, junk values and a throwing store all start at room 1', () => {
  const variants = [
    undefined,
    { unlocked: () => 'x', unlock() {} },
    { unlocked: () => NaN, unlock() {} },
    { unlocked: () => 0, unlock() {} },
  ];
  for (const progress of variants) {
    const h = harness();
    if (progress) h.env.progress = progress;
    const g = createGame(h.env);
    assert.equal(g.getState().menu, null);
    assert.equal(g.getState().level, 1);
  }
  const throwing = harness();
  throwing.env.progress = {
    unlocked() {
      throw new Error('storage blocked');
    },
    unlock() {
      throw new Error('storage blocked');
    },
  };
  const g = createGame(throwing.env);
  assert.equal(g.getState().level, 1);
  playPlan(g, ROOMS[0]);
  idle(g, 3);
  assert.equal(g.getState().level, 2, 'a broken store must not stop the game');
  const big = harness();
  big.env.progress = { unlocked: () => 999, unlock() {} };
  assert.equal(createGame(big.env).getState().menu.sel, ROOM_COUNT);
});

test('clearing a room unlocks the next one but never beyond the last', () => {
  const { g, h } = open(3);
  playPlan(g, ROOMS[2]);
  idle(g, 1.2);
  assert.deepEqual(h.calls, [4]);
  const last = open(ROOM_COUNT);
  playPlan(last.g, ROOMS[ROOM_COUNT - 1]);
  idle(last.g, 3);
  assert.deepEqual(last.h.calls, [ROOM_COUNT]);
});

// --- time, determinism and robustness --------------------------------------------------------
test('the same timed key schedule gives the identical result at 30, 60 and 120 Hz', () => {
  const room = ROOMS[8];
  const turns = plan(room);
  // A schedule of (time, key) events on a 1/30 s grid, with the cursor walk precomputed.
  const events = [];
  let t = 0.2;
  let cur = { x: room.emitters[0].x, y: room.emitters[0].y };
  const step = (key) => {
    events.push([Math.round(t * 30) / 30, key]);
    t += 1 / 3;
  };
  for (const turn of turns) {
    while (cur.x !== turn.x) {
      step(cur.x < turn.x ? 'ArrowRight' : 'ArrowLeft');
      cur = { ...cur, x: cur.x + Math.sign(turn.x - cur.x) };
    }
    while (cur.y !== turn.y) {
      step(cur.y < turn.y ? 'ArrowDown' : 'ArrowUp');
      cur = { ...cur, y: cur.y + Math.sign(turn.y - cur.y) };
    }
    step(turn.key);
  }
  const run = (hz) => {
    const { g } = open(9);
    const snaps = [];
    const frames = Math.round((t + 4) * hz);
    for (let f = 0; f < frames; f++) {
      const now = f / hz;
      const keys = events.filter(([et]) => Math.abs(et - now) < 1 / hz / 2).map(([, k]) => k);
      g.update(1 / hz, input([], keys));
      if (f % hz === hz - 1) snaps.push(JSON.stringify(g.getState()));
    }
    return snaps;
  };
  const a = run(60);
  assert.deepEqual(run(30), a);
  assert.deepEqual(run(120), a);
  assert.ok(JSON.parse(a.at(-1)).level >= 9);
});

test('uneven frame times keep the game finite and bounded', () => {
  const { g } = open(20);
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const keys = ['Space', 'ArrowRight', 'ArrowDown', 'KeyX', 'KeyZ', 'ArrowLeft', 'ArrowUp', 'KeyQ'];
  for (let f = 0; f < 4000; f++) {
    const dt = f % 97 === 0 ? 5 : 0.0005 + rnd() * 0.12;
    g.update(dt, input([], rnd() < 0.3 ? [keys[Math.floor(rnd() * keys.length)]] : []));
    if (f % 500 === 0) {
      const st = g.getState();
      assert.ok(Number.isFinite(st.beam.progress) && st.beam.progress <= st.beam.length);
      assert.ok(st.moves >= 0 && st.moves <= RULES.movesMax);
    }
  }
  assert.ok(JSON.parse(JSON.stringify(g.getState())));
});

test('the undo history and turn counter stay bounded however long a player mashes', () => {
  const { g } = open(10);
  const room = ROOMS[9];
  const t = plan(room)[0];
  walkTo(g, t.x, t.y);
  for (let n = 0; n < RULES.historyMax + 120; n++) press(g, 'Space');
  assert.ok(g.getState().moves <= RULES.movesMax);
  let undone = 0;
  for (let n = 0; n < RULES.historyMax + 50; n++) {
    const before = g.getState().moves;
    press(g, 'KeyZ');
    if (g.getState().moves < before) undone++;
  }
  assert.equal(undone, RULES.historyMax, 'only the newest turns can be undone');
});

// --- drawing ---------------------------------------------------------------------------------
test('every room draws in both languages and every state without errors', () => {
  for (const lang of ['en', 'zh'])
    ROOMS.forEach((room, i) => {
      const { g } = open(i + 1, { lang });
      const ctx = mockContext();
      g.draw(ctx);
      idle(g, 0.05);
      g.draw(ctx);
      const hint = g.getState().hint;
      walkTo(g, hint.x, hint.y);
      press(g, g.getState().hint.key);
      for (let n = 0; n < 40; n++) {
        g.update(1 / 60, input());
        g.draw(ctx);
      }
      press(g, 'KeyZ');
      press(g, 'Space');
      press(g, 'KeyZ');
      press(g, 'Space', 'ArrowRight', 'ArrowDown');
      g.draw(ctx);
    });
});

test('menu, clear, loss and win screens draw in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 9, unlock() {} };
    const menu = createGame(h.env);
    menu.draw(mockContext());
    const { g } = open(1, { lang });
    playPlan(g, ROOMS[0]);
    idle(g, 1.2);
    g.draw(mockContext());
    const lost = open(13, { lang });
    const t = plan(ROOMS[12])[0];
    walkTo(lost.g, t.x, t.y);
    for (let n = 0; n < ROOMS[12].budget; n++) press(lost.g, 'Space');
    idle(lost.g, 2);
    lost.g.draw(mockContext());
    const won = open(ROOM_COUNT, { lang });
    playPlan(won.g, ROOMS[ROOM_COUNT - 1]);
    idle(won.g, 2);
    won.g.draw(mockContext());
    assert.equal(won.g.getState().phase, 'won');
  }
});

test('crystals flash and sensors spark while the beam plays; sparks stay bounded', () => {
  const { g, h } = open(7);
  const room = ROOMS[6];
  // Turn every switch once so a crystal is hit at some point, then watch the beam run.
  for (const ci of room.toggles) {
    walkTo(g, ci % room.w, Math.floor(ci / room.w));
    press(g, 'Space');
    for (let n = 0; n < 90; n++) {
      g.update(1 / 60, input());
      if (n % 9 === 0) g.draw(mockContext());
    }
  }
  assert.ok(h.sounds.includes('hit') || h.sounds.includes('coin'));
  const ctx = mockContext();
  g.draw(ctx);
});

// --- round 2: prompt legs, frozen data, status and saved-progress edge cases ------------------
test('the prompt number is the length of the first leg along its arrow, from every cell of every room', () => {
  let checked = 0;
  ROOMS.forEach((room) => {
    for (let y = 0; y < room.h; y++)
      for (let x = 0; x < room.w; x++) {
        const adv = advise(room, 0, { x, y }, Infinity, false);
        if (adv.kind !== 'move') continue;
        const dx = adv.x - x;
        const dy = adv.y - y;
        const horizontal = adv.dir % 2 === 0;
        assert.equal(adv.steps, horizontal ? Math.abs(dx) : Math.abs(dy));
        assert.ok(adv.steps >= 1);
        if (horizontal) assert.equal(Math.sign(dx), adv.dir === 0 ? 1 : -1);
        else {
          assert.equal(dx, 0, 'vertical legs come only after the column is right');
          assert.equal(Math.sign(dy), adv.dir === 1 ? 1 : -1);
        }
        // Pressing the arrow exactly `steps` times lands on the target's column (or on the target).
        const nx = x + (horizontal ? Math.sign(dx) * adv.steps : 0);
        const ny = y + (horizontal ? 0 : Math.sign(dy) * adv.steps);
        assert.ok(horizontal ? nx === adv.x : ny === adv.y);
        checked++;
      }
  });
  assert.ok(checked > 800);
});

test('the rooms are deeply frozen and their records carry only what the game uses', () => {
  assert.equal(Object.isFrozen(ROOMS), true);
  for (const room of ROOMS) {
    assert.equal(Object.isFrozen(room), true);
    assert.equal(Object.isFrozen(room.cells), true);
    assert.equal(Object.isFrozen(room.cells[0]), true);
    assert.equal(Object.isFrozen(room.toggles), true);
    assert.equal(Object.isFrozen(room.toggleOf), true);
    assert.equal(Object.isFrozen(room.name), true);
    assert.equal('idea' in room, false);
  }
  assert.throws(() => {
    'use strict';
    ROOMS[0].cells[0].k = 'wall';
  }, TypeError);
});

test('a saved progress of Infinity or a huge number opens room select at the last room', () => {
  for (const value of [Infinity, 1e9, ROOM_COUNT + 5]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    assert.deepEqual(createGame(h.env).getState().menu, { sel: ROOM_COUNT, unlocked: ROOM_COUNT });
  }
  const h = harness();
  h.env.progress = { unlocked: () => -Infinity, unlock() {} };
  assert.equal(createGame(h.env).getState().menu, null);
});

test('the status line counts only the sensors the beam has reached on screen', () => {
  const { g } = open(1);
  const lit = (st) => Number(/Lit (\d+)\//.exec(st.status.en)[1]);
  walkTo(g, 4, 0);
  press(g, 'Space');
  let st = g.getState();
  assert.equal(st.solved, true);
  assert.equal(lit(st), st.litShown);
  assert.equal(lit(st), 0, 'the beam has not reached the sensor yet');
  idle(g, 0.3);
  st = g.getState();
  assert.equal(lit(st), 1);
  assert.equal(lit(st), st.litShown);
});
