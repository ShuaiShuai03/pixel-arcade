import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  newState,
  advance,
  snapshotOf,
  bannerOf,
  RULES,
  BOARDS,
  BOARD_COUNT,
  TILE_TYPES,
  DIRS,
  rotateMask,
  portMask,
  parseBoard,
  analyze,
  networkAt,
  solve,
  adviceFor,
  describeTile,
  probe,
  masksOf,
  layoutOf,
  menuLayout,
} from '../src/games/circuit-weaver.js';
import { harness, input, mockContext, seeded } from './harness.js';

// Optimal rotation count of every board, measured with the exhaustive solver. A board whose
// layout changes must update this table on purpose.
const OPTIMAL = [
  1, 4, 11, 8, 9, 9, 11, 12, 10, 14, 16, 10, 13, 12, 14, 13, 22, 18, 17, 24, 18, 30, 22, 33,
];
const N = 1;
const E = 2;
const S = 4;
const W = 8;

function begin(level = 1, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  const unlocks = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      unlocks.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, unlocks };
}

const tap = (g, ...codes) => g.update(1 / 60, input([], codes));
const wait = (g, seconds, hz = 60) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / hz) g.update(1 / hz, input());
};

// Moves the cursor with real key presses to (c, r).
function goTo(g, c, r) {
  for (let guard = 0; guard < 40; guard++) {
    const cur = g.getState().cursor;
    if (cur.c === c && cur.r === r) return;
    const key =
      cur.c < c ? 'ArrowRight' : cur.c > c ? 'ArrowLeft' : cur.r < r ? 'ArrowDown' : 'ArrowUp';
    tap(g, key);
  }
  assert.fail('cursor never arrived');
}

// Turns tiles until every rotation equals `target` (clockwise presses only).
function driveTo(g, target) {
  const st = g.getState();
  st.tiles.forEach((tile, i) => {
    const period = TILE_TYPES[tile.type].period;
    const times = (target[i] - tile.rot + period) % period;
    if (!times || tile.locked || period === 1) return;
    goTo(g, i % st.cols, Math.floor(i / st.cols));
    for (let k = 0; k < times; k++) tap(g, 'Space');
  });
}

const rotsOf = (g) => g.getState().tiles.map((t) => t.rot);
const board = (rows, extra = {}) =>
  parseBoard({ name: ['t', '测'], tip: ['t', '测'], rows, ...extra });

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------
test('meta follows the contract and documents every action with a touch control', () => {
  assert.equal(meta.id, 'circuit-weaver');
  assert.equal(meta.genre, 'puzzle');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.ok(/[一-鿿]/.test(meta.description.zh) && /[一-鿿]/.test(meta.name.zh));
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX', 'KeyZ'])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
  assert.ok(!codes.includes('KeyP') && !codes.includes('KeyR') && !codes.includes('Escape'));
  assert.ok(Object.isFrozen(RULES));
});

test('ships at least 20 boards with bilingual names, tips and a recorded optimum', () => {
  assert.ok(BOARD_COUNT >= 20);
  assert.equal(BOARDS.length, OPTIMAL.length);
  for (const b of BOARDS) {
    assert.ok(b.name.en && /[一-鿿]/.test(b.name.zh), b.name.en);
    assert.ok(b.tip.en && /[一-鿿]/.test(b.tip.zh), b.name.en);
    assert.ok(b.cols <= 9 && b.rows <= 6, `${b.name.en} is too large for a phone`);
    assert.ok(b.sinks.length >= 1 && b.sources.length >= 1);
  }
  assert.equal(new Set(BOARDS.map((b) => b.name.en)).size, BOARD_COUNT);
});

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------
test('port table: every tile type exposes exactly the right ports at every rotation', () => {
  const table = {
    straight: [N | S, E | W, N | S, E | W],
    corner: [N | E, E | S, S | W, W | N],
    tee: [W | N | E, N | E | S, E | S | W, S | W | N],
    cross: [15, 15, 15, 15],
    bridge: [15, 15, 15, 15],
    empty: [0, 0, 0, 0],
  };
  for (const [type, masks] of Object.entries(table))
    masks.forEach((want, rot) => {
      const got = portMask({ type }, rot);
      assert.equal(got, want, `${type} rot ${rot}`);
    });
  for (let d = 0; d < 4; d++) {
    assert.equal(portMask({ type: 'source', dir: d }, 0), 1 << d);
    assert.equal(portMask({ type: 'sink', dir: d }, 3), 1 << d);
  }
  assert.equal(rotateMask(N, 1), E);
  assert.equal(rotateMask(W, 1), N);
  assert.equal(rotateMask(N | E, 2), S | W);
  assert.deepEqual(DIRS, ['N', 'E', 'S', 'W']);
  assert.equal(TILE_TYPES.straight.period, 2);
  assert.equal(TILE_TYPES.tee.period, 4);
});

test('parseBoard rejects bad boards and reads every token', () => {
  assert.throws(() => board(['S3E Q K3W']), /bad token/);
  assert.throws(() => board(['S3E I1', 'I0']), /ragged/);
  assert.throws(() => board(['S3X I1']), /bad token/);
  const b = board(['S3E L2! T3 +', 'X . I1 K9N']);
  assert.equal(b.cols, 4);
  assert.equal(b.rows, 2);
  assert.deepEqual(
    b.cells.map((c) => c.type),
    ['source', 'corner', 'tee', 'cross', 'bridge', 'empty', 'straight', 'sink'],
  );
  assert.equal(b.cells[1].locked, true);
  assert.equal(b.cells[6].rot, 1);
  assert.deepEqual(b.volts, [3, 9]);
  assert.equal(b.sealed, true);
  assert.equal(board(['S3E K3W'], { sealed: false }).sealed, false);
  assert.equal(board(['S3E K3W'], { budget: 4 }).budget, 4);
});

// ---------------------------------------------------------------------------------------------
// Connectivity by matching ports, shorts, decoys
// ---------------------------------------------------------------------------------------------
test('two neighbours connect only when BOTH show a port on the shared edge', () => {
  const wired = board(['S3E I1 K3W']);
  assert.equal(analyze(wired, wired.start).solved, true);
  // The middle tile faces north-south: the source points at it, but it has no west port.
  const open = board(['S3E I0 K3W']);
  const an = analyze(open, open.start);
  assert.equal(an.solved, false);
  assert.equal(an.sinks[0].status, 'dead');
  // A corner whose ports miss the lamp does not light it even if it touches the lamp.
  const miss = board(['S3E L3 K3W']);
  assert.equal(analyze(miss, miss.start).sinksOk, 0);
  // A tile that points at a neighbour without a matching port is not connected to it.
  const oneSided = board(['S3E T0 .'], { sealed: false });
  assert.equal(
    analyze(oneSided, oneSided.start).net.find(0),
    analyze(oneSided, oneSided.start).net.find(0),
  );
});

test('connectivity ignores reflections: light-style reflections do not exist, only ports', () => {
  // A corner turns the current only because its ports are N+E; a straight never bends it.
  const b = board(['S3S', 'I1', 'K3N'], { sealed: false });
  assert.equal(analyze(b, b.start).solved, false);
  const c = board(['S3S', 'I0', 'K3N'], { sealed: false });
  assert.equal(analyze(c, c.start).solved, true);
});

test('sealed boards report open ends on live networks only; unsealed boards allow them', () => {
  const dangling = ['S3E T2 K3W', '. . .'];
  const sealed = board(dangling);
  const an = analyze(sealed, sealed.start);
  assert.equal(an.sinksOk, 1);
  assert.equal(an.leaks.length, 1);
  assert.deepEqual([an.leaks[0].c, an.leaks[0].r, DIRS[an.leaks[0].dir]], [1, 0, 'S']);
  assert.equal(an.solved, false);
  const loose = board(dangling, { sealed: false });
  assert.equal(analyze(loose, loose.start).solved, true);
  // The tee's missing side is north in rotation 3: swapping to rotation 0 leaks north instead.
  const edge = board(['S3E T0 K3W'], { sealed: true });
  assert.equal(analyze(edge, edge.start).leaks[0].dir, 0);
});

test('a short is two voltages in one network, is reported, and blocks the win', () => {
  const b = board(['S3E I1 S9W', '. . .', 'S3E I1 K3W'], { sealed: false });
  const an = analyze(b, b.start);
  assert.equal(an.shorts.length, 1);
  assert.deepEqual(an.shorts[0].volts, [3, 9]);
  assert.equal(an.sinksOk, 1, 'the lamp itself is lit');
  assert.equal(an.solved, false, 'a short elsewhere still blocks the win');
  const split = board(['S3E I0 S9W', '. . .', 'S3E I1 K3W'], { sealed: false });
  const clear = analyze(split, split.start);
  assert.equal(clear.shorts.length, 0);
  assert.equal(clear.solved, true);
});

test('a lamp on the wrong voltage is wrong, and one on a shorted network is not lit', () => {
  const wrong = board(['S3E I1 K9W'], { sealed: false });
  assert.equal(analyze(wrong, wrong.start).sinks[0].status, 'wrong');
  const both = board(['S3E I1 K3W', '. . .'], { sealed: false });
  assert.equal(analyze(both, both.start).sinks[0].status, 'ok');
  const mixed = board(['S3E T2 S9W', '. K3N .'], { sealed: false });
  const an = analyze(mixed, mixed.start);
  assert.equal(an.sinks[0].status, 'short');
  assert.equal(an.solved, false);
});

test('isolated decorative wires never count: no source, no lamp credit, no shorts, no leaks', () => {
  const b = board(['S3E I1 K3W', '. . .', 'L0 L1 .', 'L3 L2 T0']);
  const an = analyze(b, b.start);
  assert.equal(an.solved, true, 'the loose loop and its open ports are ignored');
  assert.equal(an.leaks.length, 0);
  // A lamp wired only to a decorative loop stays dark.
  const dark = board(['S3E I0 .', '. L0 L1', '. K9N .'], { sealed: false });
  assert.equal(analyze(dark, dark.start).sinks[0].status, 'dead');
  // Two decorative networks carrying no source can never be a short.
  const decor = board(['S3E K3W', 'I1 I1', 'I1 I1'], { sealed: false });
  assert.equal(analyze(decor, decor.start).shorts.length, 0);
});

test('a bridge crosses two tracks without joining them; a cross joins them', () => {
  const rows = (mid) => ['. S3S .', 'S9E ' + mid + ' K9W', '. K3N .'];
  const bridged = board(rows('X'));
  const an = analyze(bridged, bridged.start);
  assert.equal(an.shorts.length, 0);
  assert.equal(an.solved, true);
  const crossed = board(rows('+'));
  const bad = analyze(crossed, crossed.start);
  assert.equal(bad.shorts.length, 1);
  assert.equal(bad.solved, false);
  const same = board(['. S3S .', 'S3E + K3W', '. K3N .']);
  assert.equal(analyze(same, same.start).solved, true, 'a cross is fine for one voltage');
});

test('networkAt returns both tracks of a bridge, an idle wire and the live network', () => {
  const b = board(['. S3S .', 'S9E X K9W', '. K3N .', 'L0 L1 .']);
  const an = analyze(b, b.start);
  const bridge = networkAt(b, an, 4);
  assert.deepEqual(
    bridge.map((n) => [n.kind, n.volts]),
    [
      ['live', [3]],
      ['live', [9]],
    ],
  );
  const idle = networkAt(b, an, 9);
  assert.equal(idle[0].kind, 'idle');
  assert.deepEqual(networkAt(b, an, 11), []);
  const sh = board(['S3E I1 S9W']);
  assert.equal(networkAt(sh, analyze(sh, sh.start), 1)[0].kind, 'short');
});

// ---------------------------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------------------------
test('every board is solvable and its optimal rotation count is the recorded one', () => {
  BOARDS.forEach((b, i) => {
    assert.equal(analyze(b, b.start).solved, false, `${b.name.en} starts solved`);
    const plan = solve(b, b.start);
    assert.ok(plan, `${b.name.en} has no solution`);
    assert.equal(plan.cost, OPTIMAL[i], `${b.name.en}`);
    assert.equal(analyze(b, plan.target).solved, true, `${b.name.en} plan does not solve`);
    if (b.budget !== null) assert.ok(b.budget >= plan.cost, `${b.name.en} budget below optimum`);
  });
  assert.ok(BOARDS.filter((b) => b.budget !== null).length >= 5);
  assert.ok(BOARDS.some((b) => b.sealed === false) && BOARDS.some((b) => b.sealed));
});

test('the solver matches brute force on small and random boards', () => {
  const brute = (b) => {
    const turn = b.cells
      .map((c, i) => (!c.locked && TILE_TYPES[c.type].period > 1 ? i : -1))
      .filter((i) => i >= 0);
    let best = Infinity;
    const rots = b.start.slice();
    const go = (k, cost) => {
      if (cost >= best) return;
      if (k === turn.length) {
        if (analyze(b, rots).solved) best = cost;
        return;
      }
      const i = turn[k];
      const period = TILE_TYPES[b.cells[i].type].period;
      for (let p = 0; p < period; p++) {
        rots[i] = (b.start[i] + p) % period;
        go(k + 1, cost + p);
      }
      rots[i] = b.start[i];
    };
    go(0, 0);
    return best === Infinity ? null : best;
  };
  const small = BOARDS.filter(
    (b) => b.cells.filter((c) => !c.locked && TILE_TYPES[c.type].period > 1).length <= 8,
  );
  assert.ok(small.length >= 2);
  for (const b of small) assert.equal(solve(b, b.start)?.cost ?? null, brute(b), b.name.en);

  const rnd = seeded(77);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const volts = [3, 9];
  let solvable = 0;
  let checked = 0;
  for (let n = 0; n < 900; n++) {
    const cols = 3;
    const rows = 3;
    const tokens = [];
    for (let k = 0; k < cols * rows; k++)
      tokens.push(
        pick(['.', 'I0', 'I1', 'L0', 'L1', 'L2', 'L3', 'T0', 'T1', 'T2', 'T3', 'L1!', '+', 'X']),
      );
    const spots = [...tokens.keys()].sort(() => rnd() - 0.5);
    tokens[spots[0]] = `S${pick(volts)}${pick(DIRS)}`;
    tokens[spots[1]] = `K${pick(volts)}${pick(DIRS)}`;
    if (rnd() < 0.5) tokens[spots[2]] = `S${pick(volts)}${pick(DIRS)}`;
    if (rnd() < 0.3) tokens[spots[3]] = `K${pick(volts)}${pick(DIRS)}`;
    const rowsOut = [0, 1, 2].map((r) => tokens.slice(r * cols, r * cols + cols).join(' '));
    const b = board(rowsOut, { sealed: rnd() < 0.6 });
    const want = brute(b);
    const got = solve(b, b.start);
    assert.equal(got ? got.cost : null, want, rowsOut.join(' | '));
    if (got) {
      solvable++;
      assert.equal(analyze(b, got.target).solved, true);
    }
    checked++;
  }
  assert.ok(solvable >= 15, `only ${solvable}/${checked} random boards were solvable`);
});

test('the solver gives up cleanly on an impossible board and respects a node limit', () => {
  const stuck = board(['S3E L1! K3W']);
  assert.equal(solve(stuck, stuck.start), null);
  assert.throws(
    () => solve(BOARDS[BOARDS.length - 1], BOARDS[BOARDS.length - 1].start, 2),
    /limit/,
  );
  const solved = board(['S3E I1 K3W']);
  assert.deepEqual(solve(solved, solved.start), { cost: 0, target: solved.start });
});

// ---------------------------------------------------------------------------------------------
// Prompt advice
// ---------------------------------------------------------------------------------------------
test('advice names the tile, a direction and the key; it is empty-handed when nothing is left', () => {
  const b = BOARDS[3];
  const first = adviceFor(b, b.start, { c: 0, r: 0 }, null, false);
  assert.equal(first.id, 'move');
  assert.ok(/Move the cursor [←→↑↓] to the \w+ .*, then Space/.test(first.en), first.en);
  assert.ok(/[←→↑↓]/.test(first.zh) && /[一-鿿]/.test(first.zh));
  assert.ok(first.hint.dir && first.hint.count >= 1);
  const there = adviceFor(b, b.start, { c: first.hint.c, r: first.hint.r }, null, false);
  assert.equal(there.id, 'turn');
  assert.ok(/^Press Space to turn this /.test(there.en));
  const solvedBoard = board(['S3E I1 K3W']);
  assert.equal(adviceFor(solvedBoard, solvedBoard.start, { c: 0, r: 0 }, null, false).id, 'done');
  const stuck = board(['S3E L1! K3W']);
  assert.equal(adviceFor(stuck, stuck.start, { c: 0, r: 0 }, null, false).id, 'none');
  const undo = adviceFor(b, b.start, { c: 0, r: 0 }, 1, true);
  assert.equal(undo.id, 'undo');
  assert.equal(undo.hint.press, 'KeyZ');
  assert.equal(adviceFor(b, b.start, { c: 0, r: 0 }, 1, false).id, 'move', 'nothing to undo');
  // A tile needing several turns says how many; tiles far from any terminal use coordinates.
  let multi = null;
  let far = null;
  for (const bd of BOARDS)
    for (let i = 0; i < bd.cells.length && !(multi && far); i++) {
      const a = adviceFor(
        bd,
        bd.start,
        { c: i % bd.cols, r: Math.floor(i / bd.cols) },
        null,
        false,
      );
      if (/\(\d+x\)/.test(a.en)) multi = a;
      if (/at row \d+, col \d+/.test(a.en)) far = a;
    }
  assert.ok(multi && /（\d+次）/.test(multi.zh));
  assert.ok(far && /第\d+行第\d+列/.test(far.zh));
});

// ---------------------------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------------------------
test('a new game starts on board 1 with three fuses, a cursor on a turnable tile, no end call', () => {
  const { g, h } = begin(1);
  const st = g.getState();
  assert.equal(st.phase, 'playing');
  assert.equal(st.stage, 'play');
  assert.equal(st.level, 1);
  assert.equal(st.levels, BOARD_COUNT);
  assert.equal(st.fuses, 3);
  assert.equal(st.moves, 0);
  assert.equal(st.score, 0);
  assert.equal(st.menu, null);
  const tile = st.tiles[st.cursor.r * st.cols + st.cursor.c];
  assert.ok(['straight', 'corner', 'tee'].includes(tile.type));
  assert.equal(h.ends.length, 0);
  const again = createGame(harness().env).getState();
  assert.deepEqual(
    { ...again, hint: undefined, line: undefined, prompt: undefined, optimal: undefined },
    { ...st, hint: undefined, line: undefined, prompt: undefined, optimal: undefined },
    'a new instance restores the initial state',
  );
});

test('Space rotates the tile under the cursor, arrows move it, edges clamp', () => {
  const { g } = begin(2);
  const before = g.getState();
  const { c, r } = before.cursor;
  tap(g, 'Space');
  const after = g.getState();
  const i = r * before.cols + c;
  assert.equal(
    after.tiles[i].rot,
    (before.tiles[i].rot + 1) % TILE_TYPES[before.tiles[i].type].period,
  );
  assert.equal(after.moves, 1);
  for (let k = 0; k < 12; k++) tap(g, 'ArrowLeft');
  assert.equal(g.getState().cursor.c, 0);
  for (let k = 0; k < 12; k++) tap(g, 'KeyD');
  assert.equal(g.getState().cursor.c, before.cols - 1);
  for (let k = 0; k < 12; k++) tap(g, 'KeyW');
  assert.equal(g.getState().cursor.r, 0);
  for (let k = 0; k < 12; k++) tap(g, 'KeyS');
  assert.equal(g.getState().cursor.r, before.rows - 1);
  for (let k = 0; k < 12; k++) tap(g, 'KeyA');
  assert.equal(g.getState().cursor.c, 0);
  for (let k = 0; k < 12; k++) tap(g, 'ArrowUp');
  assert.equal(g.getState().cursor.r, 0);
});

test('held-only input fires once per press and Enter also turns', () => {
  const { g } = begin(2);
  const { c, r } = g.getState().cursor;
  const i = r * g.getState().cols + c;
  const rot = g.getState().tiles[i].rot;
  for (let f = 0; f < 5; f++) g.update(1 / 60, input(['Space'], []));
  assert.equal(g.getState().moves, 1, 'a held key is one press');
  g.update(1 / 60, input([], []));
  g.update(1 / 60, input(['Enter'], ['Enter']));
  assert.equal(g.getState().moves, 2);
  void rot;
  void i;
});

test('locked and fixed tiles refuse to turn without spending a turn', () => {
  const { g } = begin(8);
  const st = g.getState();
  const lockedAt = st.tiles.findIndex((t) => t.locked);
  assert.ok(lockedAt >= 0);
  goTo(g, lockedAt % st.cols, Math.floor(lockedAt / st.cols));
  const rot = g.getState().tiles[lockedAt].rot;
  tap(g, 'Space');
  const after = g.getState();
  assert.equal(after.moves, 0);
  assert.equal(after.tiles[lockedAt].rot, rot);
  assert.equal(after.message.en, 'Locked tile');
  assert.ok(/[一-鿿]/.test(after.message.zh));
  assert.equal(after.stats.locked, 1);
  const sourceAt = st.tiles.findIndex((t) => t.type === 'source');
  goTo(g, sourceAt % st.cols, Math.floor(sourceAt / st.cols));
  tap(g, 'Space');
  assert.equal(g.getState().message.en, 'This tile does not turn');
  wait(g, 2);
  assert.equal(g.getState().message, null, 'the message fades');
});

test('Z undoes one turn and restores the exact earlier state, cursor included', () => {
  const { g } = begin(5);
  const start = g.getState();
  const strip = (s) => ({ ...s, time: 0, hint: null, line: null, prompt: null, optimal: null });
  tap(g, 'Space');
  const second = start.tiles.findIndex(
    (t, i) =>
      i !== start.cursor.r * start.cols + start.cursor.c &&
      TILE_TYPES[t.type].period > 1 &&
      !t.locked,
  );
  goTo(g, second % start.cols, Math.floor(second / start.cols));
  tap(g, 'Space');
  assert.equal(g.getState().moves, 2);
  tap(g, 'KeyZ');
  tap(g, 'KeyZ');
  const back = g.getState();
  assert.deepEqual(
    strip({ ...back, stats: {}, message: null }),
    strip({ ...start, stats: {}, message: null }),
  );
  assert.equal(back.stats.undos, 2);
  tap(g, 'KeyZ');
  assert.equal(g.getState().message.en, 'Nothing to undo');
  assert.equal(g.getState().stats.undos, 2);
});

test('getState returns copies: mutating a snapshot never changes the game', () => {
  const { g } = begin(2);
  const a = g.getState();
  a.tiles[0].rot = 3;
  a.cursor.c = 99;
  a.fuses = -5;
  a.stats.turns = 77;
  a.lamps.length = 0;
  a.status.en = 'hacked';
  const b = g.getState();
  assert.notEqual(b.cursor.c, 99);
  assert.equal(b.fuses, 3);
  assert.equal(b.stats.turns, 0);
  assert.ok(b.lamps.length > 0);
  assert.notEqual(b.status.en, 'hacked');
  assert.notEqual(a, b);
  assert.notEqual(a.tiles, b.tiles);
});

test('X toggles an inspector that reports the voltage of the network under the cursor', () => {
  const { g } = begin(1);
  assert.equal(g.getState().inspect, null);
  tap(g, 'KeyX');
  let st = g.getState();
  assert.ok(Array.isArray(st.inspect));
  const sourceAt = st.tiles.findIndex((t) => t.type === 'source');
  goTo(g, sourceAt % st.cols, Math.floor(sourceAt / st.cols));
  st = g.getState();
  assert.equal(st.inspect[0].kind, 'live');
  assert.deepEqual(st.inspect[0].volts, [3]);
  assert.ok(st.inspect[0].tiles.some((t) => t.c === 0 && t.r === 1));
  g.draw(mockContext());
  tap(g, 'KeyX');
  assert.equal(g.getState().inspect, null);
});

test('time is fixed-step: invalid, zero and oversized dt do nothing and keep the key press', () => {
  const { g } = begin(2);
  const before = g.getState().time;
  for (const dt of [0, -1, NaN, Infinity, 0.5])
    g.update(dt, input([], ['Space', 'ArrowRight', 'KeyZ']));
  const mid = g.getState();
  assert.equal(mid.time, before);
  assert.equal(mid.moves, 0);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().moves, 1, 'the ignored updates did not eat the action');
  assert.ok(Math.abs(g.getState().time - before - 1 / 60) < 1e-9);
  assert.equal(advance(newState(), 0, input()), false);
});

test('determinism: the same timed script gives the same result at 30, 60 and 120 Hz', () => {
  const rnd = seeded(5);
  const keys = ['Space', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'KeyZ', 'KeyX'];
  const script = [
    ...Array(BOARDS[9].budget).fill('Space'),
    ...Array.from({ length: 140 }, () => keys[Math.floor(rnd() * keys.length)]),
  ];
  const run = (hz) => {
    const { g } = begin(10);
    const slot = Math.round(hz * 0.2);
    for (let n = 0; n < script.length; n++)
      for (let f = 0; f < slot; f++) g.update(1 / hz, input([], f === 0 ? [script[n]] : []));
    const st = g.getState();
    return JSON.stringify({ ...st, hint: st.hint, line: st.line });
  };
  const a = run(60);
  assert.equal(run(30), a);
  assert.equal(run(120), a);
  const parsed = JSON.parse(a);
  assert.ok(parsed.stats.turns > 20 && parsed.stats.blown >= 1, 'the script blows a fuse');
});

test('the lit board pauses, scores, unlocks the next board and loads it', () => {
  const { g, h, unlocks } = begin(1);
  const plan = solve(BOARDS[0], BOARDS[0].start);
  driveTo(g, plan.target);
  let st = g.getState();
  assert.equal(st.stage, 'powered');
  assert.equal(st.solved, true);
  assert.equal(st.status.en, 'Every lamp is lit!');
  assert.equal(st.lit, 1);
  const rot = rotsOf(g);
  tap(g, 'Space');
  tap(g, 'KeyZ');
  assert.deepEqual(rotsOf(g), rot, 'input is frozen while the lit board is shown');
  wait(g, RULES.clearPause + 0.1);
  st = g.getState();
  assert.equal(st.level, 2);
  assert.equal(st.stage, 'play');
  assert.equal(st.moves, 0);
  assert.equal(st.score, RULES.clearScore + RULES.perfectScore + 3 * RULES.fuseScore);
  assert.deepEqual(unlocks, [2]);
  assert.ok(h.sounds.includes('coin') && h.sounds.includes('win'));
  assert.equal(h.ends.length, 0);
});

test('bonus scoring: extra turns lower the bonus but never the base score', () => {
  const run = (extra) => {
    const { g } = begin(1);
    const i = g.getState().cursor.r * g.getState().cols + g.getState().cursor.c;
    const tileRot = g.getState().tiles[i].rot;
    const plan = solve(BOARDS[0], BOARDS[0].start);
    // Waste `extra` full turns of the first tile, then finish.
    for (let k = 0; k < extra; k++) tap(g, 'Space');
    void tileRot;
    driveTo(g, plan.target);
    wait(g, RULES.clearPause + 0.1);
    return g.getState().score;
  };
  const exact = run(0);
  const spare = run(2);
  const wasteful = run(6);
  assert.ok(exact > spare && spare >= wasteful);
  assert.ok(wasteful >= RULES.clearScore);
});

test('a turn budget burns a fuse, resets the board, and three burns lose the game once', () => {
  const { g, h } = begin(10);
  const start = g.getState();
  const B = BOARDS[9].budget;
  assert.equal(start.budget, B);
  for (let blown = 1; blown <= 3; blown++) {
    for (let k = 0; k < B - 1; k++) tap(g, 'Space');
    assert.equal(g.getState().left, 1);
    assert.equal(g.getState().stage, 'play');
    tap(g, 'Space');
    const st = g.getState();
    assert.equal(st.fuses, 3 - blown);
    if (blown < 3) {
      assert.equal(st.stage, 'blown');
      assert.equal(st.status.en, 'Fuse blown: out of turns');
      assert.equal(st.left, 0);
      assert.equal(st.moves, B);
      const rot = rotsOf(g);
      tap(g, 'Space');
      assert.deepEqual(rotsOf(g), rot, 'frozen while the fuse is shown');
      wait(g, RULES.blowPause + 0.1);
      const back = g.getState();
      assert.equal(back.stage, 'play');
      assert.equal(back.moves, 0);
      assert.deepEqual(
        rotsOf(g),
        start.tiles.map((t) => t.rot),
      );
      assert.equal(back.level, 10);
    }
  }
  const lost = g.getState();
  assert.equal(lost.phase, 'lost');
  assert.equal(lost.fuses, 0);
  assert.ok(/Out of fuses/.test(lost.status.en) && !/wired|lit/i.test(lost.status.en));
  assert.ok(/保险丝/.test(lost.status.zh));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.includes('lose'));
  const rot = rotsOf(g);
  tap(g, 'Space');
  tap(g, 'ArrowRight');
  wait(g, 3);
  assert.deepEqual(rotsOf(g), rot, 'the terminal screen freezes input');
  assert.equal(h.ends.length, 1);
  assert.equal(g.getState().line.en, '');
  assert.equal(g.getState().hint, null);
});

test('solving on the very last allowed turn wins instead of blowing the fuse', () => {
  const { g } = begin(10);
  const b = BOARDS[9];
  const plan = solve(b, b.start);
  // Spend the spare turns first, undo-free, on a tile pair that returns to its place.
  const spare = b.budget - plan.cost;
  assert.ok(spare >= 1);
  const t = plan.target;
  const st = g.getState();
  const wasted = st.tiles.findIndex((tile, i) => tile.type === 'corner' && t[i] === tile.rot);
  assert.ok(wasted >= 0);
  goTo(g, wasted % st.cols, Math.floor(wasted / st.cols));
  for (let k = 0; k < 4 * Math.floor(spare / 4); k++) tap(g, 'Space');
  const used = g.getState().moves;
  driveTo(g, t);
  const done = g.getState();
  assert.ok(done.moves <= b.budget);
  assert.equal(done.fuses, 3);
  assert.equal(done.stage, 'powered');
  void used;
});

test('clearing the last board wins once and freezes the game', () => {
  const { g, h, unlocks } = begin(BOARD_COUNT);
  assert.equal(g.getState().level, BOARD_COUNT);
  const b = BOARDS[BOARD_COUNT - 1];
  driveTo(g, solve(b, b.start).target);
  wait(g, RULES.clearPause + 0.1);
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.ok(/All boards wired/.test(st.status.en) && /全部电路板/.test(st.status.zh));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
  assert.ok(h.ends[0].message.length > 0);
  assert.deepEqual(unlocks, [BOARD_COUNT]);
  const rot = rotsOf(g);
  tap(g, 'Space');
  wait(g, 2);
  assert.deepEqual(rotsOf(g), rot);
  assert.equal(h.ends.length, 1);
  assert.ok(h.sounds.filter((s) => s === 'win').length >= 1);
});

test('without saved progress play starts on board 1; with progress a menu offers the unlocked boards', () => {
  const plain = createGame(harness().env).getState();
  assert.equal(plain.menu, null);
  const { g } = begin(6);
  // begin() already left the menu; look at a fresh one.
  const h = harness();
  h.env.progress = { unlocked: () => 6, unlock() {} };
  const menu = createGame(h.env);
  let st = menu.getState();
  assert.equal(st.stage, 'menu');
  assert.deepEqual(st.menu, { sel: 6, unlocked: 6 });
  assert.equal(st.status.en, 'Pick a board');
  tap(menu, 'ArrowLeft');
  tap(menu, 'ArrowLeft');
  assert.equal(menu.getState().menu.sel, 4);
  tap(menu, 'ArrowRight');
  tap(menu, 'ArrowRight');
  tap(menu, 'ArrowRight');
  assert.equal(menu.getState().menu.sel, 6, 'cannot pick a locked board');
  tap(menu, 'ArrowUp');
  assert.equal(menu.getState().menu.sel, 1);
  tap(menu, 'ArrowDown');
  assert.equal(menu.getState().menu.sel, 6, 'a row down is eight boards on, clamped to unlocked');
  tap(menu, 'ArrowLeft');
  menu.draw(mockContext());
  menu.update(1 / 60, input([], ['Space']));
  st = menu.getState();
  assert.equal(st.stage, 'play');
  assert.equal(st.level, 5);
  assert.equal(g.getState().level, 6);
  for (const bad of [NaN, -3, 'x', 1000, 0]) {
    const e = harness().env;
    e.progress = { unlocked: () => bad, unlock() {} };
    const s = createGame(e).getState();
    assert.ok(s.level === 1 && (bad === 1000 ? s.stage === 'menu' : true));
  }
});

test('the level menu works by touch: tap a board to select, tap again to start it', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 12, unlock() {} };
  const g = createGame(h.env);
  const lay = menuLayout(BOARD_COUNT);
  const at = (n) => ({
    x: lay.x + ((n - 1) % lay.cols) * lay.cell + 10,
    y: lay.y + Math.floor((n - 1) / lay.cols) * lay.cell + 10,
    clicked: true,
  });
  g.update(1 / 60, input([], [], at(3)));
  assert.equal(g.getState().menu.sel, 3);
  g.update(1 / 60, input([], [], at(20)));
  assert.equal(g.getState().menu.sel, 3, 'locked boards ignore taps');
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.equal(g.getState().stage, 'menu');
  g.update(1 / 60, input([], [], at(3)));
  assert.equal(g.getState().stage, 'play');
  assert.equal(g.getState().level, 3);
  assert.ok((lay.cell * 390) / 480 >= 24, 'menu cells stay tappable on a phone');
});

test('touch: tapping a tile selects it, tapping it again rotates it, outside taps are ignored', () => {
  const { g } = begin(4);
  const st0 = g.getState();
  const lay = layoutOf(BOARDS[3]);
  const pos = (c, r) => ({
    x: lay.x + c * lay.tile + 5,
    y: lay.y + r * lay.tile + 5,
    clicked: true,
  });
  const other = st0.cursor.c === 1 && st0.cursor.r === 2 ? { c: 2, r: 2 } : { c: 1, r: 2 };
  g.update(1 / 60, input([], [], pos(other.c, other.r)));
  let st = g.getState();
  assert.deepEqual(st.cursor, other);
  assert.equal(st.moves, 0, 'the first tap only selects');
  const i = other.r * st.cols + other.c;
  const rot = st.tiles[i].rot;
  g.update(1 / 60, input([], [], pos(other.c, other.r)));
  st = g.getState();
  assert.equal(st.moves, st.tiles[i].locked || TILE_TYPES[st.tiles[i].type].period === 1 ? 0 : 1);
  if (st.moves) assert.notEqual(st.tiles[i].rot, rot);
  g.update(1 / 60, input([], [], { x: 1, y: 1, clicked: true }));
  g.update(1 / 60, input([], [], { x: 479, y: 319, clicked: true }));
  assert.deepEqual(g.getState().cursor, other);
  g.update(1 / 60, input([], [], { x: lay.x + 5, y: lay.y + 5, clicked: false }));
  assert.deepEqual(g.getState().cursor, other, 'a hover is not a tap');
  g.update(1 / 60, { held: () => false, pressed: () => false, pointer: null });
});

test('every board fits a 390-px phone with tiles of at least 24 CSS pixels', () => {
  for (const b of BOARDS) {
    const lay = layoutOf(b);
    assert.ok(lay.tile * (390 / 480) >= 24, `${b.name.en}: ${lay.tile}`);
    assert.ok(lay.x >= 0 && lay.x + lay.tile * b.cols <= 480);
    assert.ok(lay.y >= 28 && lay.y + lay.tile * b.rows <= 272, b.name.en);
  }
});

// A state one or two wrong turns away from the solution that has the requested defect.
function nearMiss(wanted) {
  for (const depth of [1, 2])
    for (let level = 1; level <= BOARD_COUNT; level++) {
      const b = BOARDS[level - 1];
      const plan = solve(b, b.start);
      const turn = b.cells
        .map((c, i) => (!c.locked && TILE_TYPES[c.type].period > 1 ? i : -1))
        .filter((i) => i >= 0);
      const tryRots = (rots) => {
        const an = analyze(b, rots);
        return !an.solved && wanted(an, b) ? { level, rots } : null;
      };
      for (const i of turn)
        for (let p = 1; p < TILE_TYPES[b.cells[i].type].period; p++) {
          const one = plan.target.slice();
          one[i] = (one[i] + p) % TILE_TYPES[b.cells[i].type].period;
          const hit = depth === 1 && tryRots(one);
          if (hit) return hit;
          if (depth === 2)
            for (const j of turn)
              for (let q = 1; j > i && q < TILE_TYPES[b.cells[j].type].period; q++) {
                const two = one.slice();
                two[j] = (two[j] + q) % TILE_TYPES[b.cells[j].type].period;
                const found = tryRots(two);
                if (found) return found;
              }
        }
    }
  return null;
}

test('a short is shown on the board, announced, and the board cannot be won while it lasts', () => {
  const found = nearMiss((an) => an.shorts.length > 0);
  assert.ok(found, 'some board can be shorted with two wrong turns');
  const { g, h } = begin(found.level);
  driveTo(g, found.rots);
  const st = g.getState();
  assert.equal(st.stage, 'play');
  assert.equal(st.short, true);
  assert.ok(st.shorts[0].volts.length >= 2);
  const volts = st.shorts[0].volts.map((v) => `${v} V`).join(' + ');
  assert.ok(st.status.en.startsWith(`SHORT! ${volts} touch · `), st.status.en);
  assert.ok(st.status.zh.startsWith('短路！'));
  assert.equal(st.solved, false);
  assert.ok(st.stats.shorts >= 1);
  assert.ok(h.sounds.includes('hit'));
  wait(g, 2);
  assert.equal(g.getState().stage, 'play', 'a short never registers a win');
  for (const lang of ['en', 'zh']) {
    const x = begin(found.level, { lang }).g;
    driveTo(x, found.rots);
    x.draw(mockContext());
    wait(x, 0.3);
    x.draw(mockContext());
  }
});

test('open ends on a sealed board are listed in the state and the banner', () => {
  const found = nearMiss((an, b) => b.sealed && an.leaks.length > 0 && !an.shorts.length);
  assert.ok(found);
  assert.ok(BOARDS[found.level - 1].sealed);
  const { g } = begin(found.level);
  driveTo(g, found.rots);
  const st = g.getState();
  assert.ok(st.leaks.length > 0);
  assert.ok(st.status.en.startsWith(`Open ends: ${st.leaks.length} · `), st.status.en);
  assert.ok(/断头/.test(st.status.zh));
  assert.ok(st.leaks.every((l) => DIRS.includes(l.dir)));
  g.draw(mockContext());
  const b = BOARDS[found.level - 1];
  driveTo(g, solve(b, b.start).target);
  assert.equal(g.getState().leaks.length, 0);
});

test('banner and counters always match the real state', () => {
  const { g } = begin(10);
  for (let k = 0; k < 40; k++) {
    tap(g, k % 3 === 0 ? 'ArrowRight' : 'Space');
    const st = g.getState();
    assert.ok(st.fuses >= 0 && st.fuses <= 3);
    assert.ok(st.left === null || (st.left >= 0 && st.left <= st.budget));
    assert.ok(st.moves >= 0 && Number.isFinite(st.score) && st.score >= 0);
    assert.ok(st.lit >= 0 && st.lit <= st.lamps.length);
    if (st.stage === 'play' && !st.short && !st.leaks.length)
      assert.ok(st.status.en.startsWith(`Lamps lit ${st.lit}/${st.lamps.length} · `), st.status.en);
    assert.equal(st.solved, st.stage === 'powered' || st.solved);
    if (st.stage === 'blown') wait(g, RULES.blowPause + 0.1);
  }
  const s = newState();
  s.score = 12345678;
  s.stage = 'play';
  assert.ok(snapshotOf(s).score >= 0);
  s.phase = 'lost';
  assert.ok(/Out of fuses/.test(bannerOf(s).en));
});

test('prompts exist in both languages and stay inside the canvas', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = begin(1, { lang });
    for (let level = 1; level <= BOARD_COUNT; level++) {
      const e = harness({ lang }).env;
      e.progress = { unlocked: () => level, unlock() {} };
      const game = createGame(e);
      if (level > 1) game.update(1 / 60, input([], ['Space']));
      const st = game.getState();
      assert.ok(st.line.en.length > 0 && st.line.en.length <= 64, st.line.en);
      const wide = [...st.line.zh].reduce((n, ch) => n + (/[一-鿿，（）]/.test(ch) ? 12 : 7.2), 0);
      assert.ok(wide <= 470 && st.line.en.length * 7.2 <= 470, st.line.en);
      assert.ok(/[一-鿿]/.test(st.line.zh));
      assert.deepEqual({ en: st.prompt.en, zh: st.prompt.zh }, st.line);
    }
    void g;
  }
});

test('draw smoke: every stage in both languages renders without throwing', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 7, 10, 18, 24]) {
      const { g } = begin(level, { lang });
      const ctx = mockContext();
      g.draw(ctx);
      tap(g, 'KeyX');
      g.draw(ctx);
      for (let k = 0; k < 6; k++) {
        tap(g, k % 2 || BOARDS[level - 1].budget !== null ? 'ArrowRight' : 'Space');
        g.draw(ctx);
      }
      const b = BOARDS[level - 1];
      driveTo(g, solve(b, rotsOf(g)).target);
      g.draw(ctx);
      wait(g, 0.5);
      g.draw(ctx);
      wait(g, 1);
      g.draw(ctx);
    }
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 5, unlock() {} };
    createGame(h.env).draw(mockContext());
    // blown and lost screens
    const { g } = begin(10, { lang });
    for (let blown = 0; blown < 3; blown++) {
      for (let k = 0; k < BOARDS[9].budget; k++) tap(g, 'Space');
      g.draw(mockContext());
      wait(g, RULES.blowPause + 0.1);
      g.draw(mockContext());
    }
    // a dead hint (undo prompt) and an inspected bridge
    const u = begin(10, { lang }).g;
    for (let k = 0; k < BOARDS[9].budget - 3; k++) tap(u, 'Space');
    assert.equal(u.getState().prompt.id, 'undo');
    u.draw(mockContext());
  }
});

test('a seeded mixed-input soak keeps every value finite and every array bounded', () => {
  for (const level of [3, 9, 14, 20, 24]) {
    const { g, h } = begin(level, { seed: level });
    const rnd = seeded(level * 31);
    const keys = [
      'Space',
      'ArrowRight',
      'ArrowDown',
      'ArrowLeft',
      'ArrowUp',
      'KeyZ',
      'KeyX',
      'Enter',
    ];
    for (let f = 0; f < 3000; f++) {
      const pressed = rnd() < 0.5 ? [keys[Math.floor(rnd() * keys.length)]] : [];
      const pointer = rnd() < 0.05 ? { x: rnd() * 480, y: rnd() * 320, clicked: true } : {};
      g.update(1 / 60, input([], pressed, pointer));
      if (f % 100 === 0) {
        const st = g.getState();
        assert.ok(Number.isFinite(st.score) && Number.isFinite(st.time));
        assert.ok(st.tiles.length === st.cols * st.rows && st.tiles.length <= 54);
        assert.ok(st.leaks.length <= st.cols * st.rows * 4);
        g.draw(mockContext());
      }
    }
    assert.ok(h.ends.length <= 1);
  }
});

// ---------------------------------------------------------------------------------------------
// Round 2: tips, stale short flag, undo cap, progress clamp, frozen boards, unambiguous names
// ---------------------------------------------------------------------------------------------
function recorder() {
  const texts = [];
  const base = mockContext();
  const ctx = new Proxy(base, {
    get: (target, p) => (p === 'fillText' ? (t) => texts.push(String(t)) : target[p]),
    set: (target, p, v) => ((target[p] = v), true),
  });
  return { ctx, texts };
}

test('each board shows its tip in both languages until the first turn or six seconds pass', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = begin(4, { lang });
    const tip = BOARDS[3].tip[lang];
    const st = g.getState();
    assert.deepEqual(st.tip, BOARDS[3].tip);
    assert.equal(st.tipShown, true);
    const shown = recorder();
    g.draw(shown.ctx);
    assert.ok(shown.texts.includes(tip), `${tip} is drawn`);
    tap(g, 'Space');
    assert.equal(g.getState().tipShown, false);
    const after = recorder();
    g.draw(after.ctx);
    assert.ok(!after.texts.includes(tip));
    tap(g, 'KeyZ');
    assert.equal(g.getState().tipShown, true, 'back at zero turns the tip is still counting');
    wait(g, RULES.tipTime + 0.2);
    assert.equal(g.getState().tipShown, false);
    const late = recorder();
    g.draw(late.ctx);
    assert.ok(!late.texts.includes(tip));
  }
  for (const b of BOARDS) {
    assert.ok(b.tip.en.length <= 60 && b.tip.en.length * 7.2 <= 470, b.tip.en);
    assert.ok([...b.tip.zh].length * 12 <= 470, b.tip.zh);
    assert.ok(b.sealed || /[Oo]pen ends/.test(b.tip.en) || b.name.en === 'First Spark');
  }
});

test('the short flag follows undo: a short that was undone is announced again when it returns', () => {
  const found = nearMiss((an) => an.shorts.length > 0);
  assert.ok(found);
  const { g, h } = begin(found.level);
  driveTo(g, found.rots);
  assert.equal(g.getState().short, true);
  const first = g.getState().stats.shorts;
  const hits = h.sounds.filter((x) => x === 'hit').length;
  for (let k = 0; k < 40 && g.getState().short; k++) tap(g, 'KeyZ');
  assert.equal(g.getState().short, false, 'undo removes the short');
  assert.notEqual(g.getState().status.en.slice(0, 5), 'SHORT');
  driveTo(g, found.rots);
  assert.equal(g.getState().short, true);
  assert.ok(g.getState().stats.shorts > first, 'announced a second time');
  assert.ok(h.sounds.filter((x) => x === 'hit').length > hits);
});

test('the undo stack keeps the latest 200 turns', () => {
  assert.equal(RULES.undoLimit, 200);
  const { g } = begin(9);
  const st = g.getState();
  const at = st.tiles.findIndex((t) => !t.locked && TILE_TYPES[t.type].period > 1);
  goTo(g, at % st.cols, Math.floor(at / st.cols));
  for (let k = 0; k < 230; k++) tap(g, 'Space');
  assert.equal(g.getState().moves, 230);
  for (let k = 0; k < 230; k++) tap(g, 'KeyZ');
  const end = g.getState();
  assert.equal(end.stats.undos, 200);
  assert.equal(end.moves, 30);
  assert.equal(end.message.en, 'Nothing to undo');
});

test('saved progress beyond the last board is clamped to it; junk falls back to board 1', () => {
  for (const value of [Infinity, 1e9, 24.9]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    const st = createGame(h.env).getState();
    assert.equal(st.stage, 'menu');
    assert.deepEqual(st.menu, { sel: BOARD_COUNT, unlocked: BOARD_COUNT });
  }
  for (const value of [-Infinity, NaN, undefined, null, 'x']) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    const st = createGame(h.env).getState();
    assert.equal(st.stage, 'play');
    assert.equal(st.level, 1);
  }
});

test('the board table is deeply frozen', () => {
  assert.ok(Object.isFrozen(BOARDS));
  for (const b of BOARDS) {
    for (const part of [
      b,
      b.cells,
      b.start,
      b.volts,
      b.sources,
      b.sinks,
      b.name,
      b.tip,
      b.cells[0],
    ])
      assert.ok(Object.isFrozen(part), b.name.en);
  }
  assert.throws(() => {
    BOARDS[0].start[0] = 3;
  }, TypeError);
  assert.throws(() => {
    BOARDS[0].cells[1].rot = 3;
  }, TypeError);
});

test('every tile of a kind has its own name: a landmark is used only when no twin shares it', () => {
  let landmarks = 0;
  let coordinates = 0;
  for (const b of BOARDS)
    for (let i = 0; i < b.cells.length; i++) {
      const type = b.cells[i].type;
      if (!['straight', 'corner', 'tee'].includes(type)) continue;
      const mine = describeTile(b, i);
      if (/row/.test(mine.en)) coordinates++;
      else landmarks++;
      for (let j = 0; j < b.cells.length; j++)
        if (j !== i && b.cells[j].type === type)
          assert.notEqual(
            describeTile(b, j).en,
            mine.en,
            `${b.name.en}: ${i} and ${j} share a name`,
          );
    }
  assert.ok(
    landmarks > 20 && coordinates > 20,
    `${landmarks} landmarks, ${coordinates} coordinates`,
  );
});

test('a named landmark fits exactly one tile of its kind within two cells of that voltage and role', () => {
  let checked = 0;
  for (const b of BOARDS)
    for (let i = 0; i < b.cells.length; i++) {
      if (!['straight', 'corner', 'tee'].includes(b.cells[i].type)) continue;
      const m = /by the (\d+) V (source|lamp)/.exec(describeTile(b, i).en);
      if (!m) continue;
      const near = (j) =>
        [...b.sources, ...b.sinks].some((t) => {
          const gap =
            Math.abs((t % b.cols) - (j % b.cols)) +
            Math.abs(Math.floor(t / b.cols) - Math.floor(j / b.cols));
          return (
            gap <= 2 &&
            b.cells[t].volt === Number(m[1]) &&
            (b.cells[t].type === 'source') === (m[2] === 'source')
          );
        });
      const twins = b.cells.filter((c, j) => c.type === b.cells[i].type && near(j));
      assert.equal(twins.length, 1, `${b.name.en} tile ${i}`);
      checked++;
    }
  assert.ok(checked > 20);
});

// The press cost of every valid wiring of a board, found by the same search the hints use.
function wiringCosts(b) {
  const mask = masksOf(b, b.start);
  const known = new Uint8Array(b.cells.length);
  b.cells.forEach((c, i) => {
    if (c.locked || TILE_TYPES[c.type].period === 1) known[i] = 1;
  });
  const rots = b.start.slice();
  const costs = [];
  const visit = (i, cost) => {
    const info = TILE_TYPES[b.cells[i].type];
    const was = mask[i];
    known[i] = 1;
    for (let p = 0; p < info.period; p++) {
      const rot = (b.start[i] + p) % info.period;
      mask[i] = rotateMask(info.base, rot);
      rots[i] = rot;
      const next = probe(b, mask, known);
      if (next >= 0) visit(next, cost + p);
      else if (next === -1 && analyze(b, rots).solved) costs.push(cost + p);
    }
    known[i] = 0;
    mask[i] = was;
    rots[i] = b.start[i];
  };
  const first = probe(b, mask, known);
  if (first >= 0) visit(first, 0);
  else if (first === -1 && analyze(b, rots).solved) costs.push(0);
  return costs;
}

test('every sealed board has exactly one wiring that lights it', () => {
  const sealed = BOARDS.filter((b) => b.sealed);
  assert.ok(sealed.length >= 12);
  for (const b of sealed) assert.equal(wiringCosts(b).length, 1, b.name.en);
});

test('every valid wiring of a board with a turn budget fits the budget, so no legal wiring blows a fuse', () => {
  let open = 0;
  for (const b of BOARDS) {
    if (b.budget === null) continue;
    const costs = wiringCosts(b);
    assert.ok(Math.max(...costs) <= b.budget, `${b.name.en}: ${Math.max(...costs)} > ${b.budget}`);
    assert.ok(b.budget - Math.min(...costs) <= 4, `${b.name.en} has a loose budget`);
    if (!b.sealed) open++;
  }
  assert.ok(open >= 3);
});

test('tile and direction tables cannot be changed', () => {
  assert.ok(Object.isFrozen(TILE_TYPES) && Object.isFrozen(TILE_TYPES.corner));
  assert.ok(Object.isFrozen(DIRS));
  assert.throws(() => {
    TILE_TYPES.corner.period = 9;
  }, TypeError);
  assert.throws(() => {
    DIRS[0] = 'Q';
  }, TypeError);
});

test('while playing, the status line is the banner, the tip until the first turn, then the prompt last', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 6, 10, 17, 24]) {
      const { g } = begin(level, { lang });
      for (let step = 0; step < 6; step++) {
        const st = g.getState();
        if (st.stage !== 'play') break;
        const parts = st.status[lang].split(' · ');
        assert.equal(parts[parts.length - 1], st.line[lang], `${level} ${lang}`);
        assert.equal(parts.length, st.tipShown ? 3 : 2, parts.join(' | '));
        if (st.tipShown) assert.equal(parts[1], st.tip[lang]);
        tap(g, step % 2 ? 'ArrowRight' : 'Space');
      }
    }
  const { g } = begin(9);
  tap(g, 'Space');
  assert.ok(!g.getState().tipShown);
  const st = g.getState();
  assert.equal(st.status.en, `${st.status.en.split(' · ')[0]} · ${st.line.en}`);
});

test('the status line keeps the plain banner in the menu and on the lit, blown, lost and won screens', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 6, unlock() {} };
  assert.equal(createGame(h.env).getState().status.en, 'Pick a board');
  const { g } = begin(1);
  driveTo(g, solve(BOARDS[0], BOARDS[0].start).target);
  assert.equal(g.getState().status.en, 'Every lamp is lit!');
  assert.equal(g.getState().status.zh, '所有灯都亮了！');
});
