import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  turnPiece,
  rotatePiece,
  SHAPES,
  canPlace,
  createBlockState,
  stepBlock,
  meta,
} from '../src/games/blockfall.js';
import { harness, input, mockContext, seeded } from './harness.js';
const step = (g, code) => g.update(1 / 60, input([], code ? [code] : []));
test('Blockfall hold preserves the queue and is available once per locked piece', () => {
  const g = createGame(harness().env),
    a = g.getState();
  assert.equal(a.preview.length, 3);
  step(g, 'KeyC');
  const b = g.getState();
  assert.equal(b.hold, a.piece.name);
  assert.equal(b.piece.name, a.preview[0]);
  step(g, 'KeyC');
  assert.equal(g.getState().piece.name, b.piece.name);
  step(g, 'Space');
  const c = g.getState();
  step(g, 'KeyC');
  assert.equal(g.getState().piece.name, a.piece.name);
  assert.equal(g.getState().hold, c.piece.name);
});
test('Blockfall grounded pieces allow a half second adjustment before locking', () => {
  const g = createGame(harness().env);
  for (let i = 0; i < 3000 && !g.getState().grounded; i++) step(g);
  assert.equal(g.getState().grounded, true);
  const name = g.getState().piece.name;
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(g.getState().board.flat().filter(Boolean).length, 0);
  step(g, 'ArrowLeft');
  assert.equal(g.getState().piece.name, name);
  for (let i = 0; i < 40; i++) step(g);
  assert.equal(g.getState().board.flat().filter(Boolean).length, 4);
});

test('Blockfall seven-piece bags give every shape once in each group and no snapshot aliases', () => {
  const g = createGame(harness({ seed: 7 }).env),
    names = [];
  for (let i = 0; i < 7; i++) {
    names.push(g.getState().piece.name);
    step(g, 'Space');
  }
  assert.equal(new Set(names).size, 7);
  const snapshot = g.getState();
  snapshot.board[19][0] = 999;
  assert.notEqual(g.getState().board[19][0], 999);
});
test('Blockfall gravity and locking agree at 60 and 120 Hz', () => {
  const play = (fps) => {
    const g = createGame(harness({ seed: 8 }).env);
    for (let i = 0; i < fps * 8; i++) g.update(1 / fps, input());
    return g.getState();
  };
  const a = play(60),
    b = play(120);
  assert.deepEqual(a.board, b.board);
  assert.equal(a.piece.y, b.piece.y);
});

test('Blockfall long-piece pivot kicks away from the left wall and off the floor', () => {
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  const vertical = { name: 'I', matrix: rotatePiece(SHAPES.I), rotation: 1, x: -2, y: 0 };
  assert.ok(canPlace(board, vertical.matrix, vertical.x, vertical.y));
  const horizontal = turnPiece(board, vertical, true);
  assert.notEqual(horizontal, vertical);
  assert.equal(horizontal.rotation, 2);
  assert.ok(horizontal.x >= 0);
  const floor = { name: 'T', matrix: SHAPES.T, rotation: 0, x: 4, y: 18 };
  const turned = turnPiece(board, floor, true);
  assert.notEqual(turned, floor);
  assert.ok(turned.y < 18);
  assert.ok(canPlace(board, turned.matrix, turned.x, turned.y));
});

test('Blockfall zero, negative and non-finite updates preserve every field and consume no input/resources', () => {
  const h = harness(),
    g = createGame(h.env),
    before = structuredClone(g.getState());
  for (const dt of [0, -1, NaN, Infinity])
    g.update(dt, input(['ArrowLeft', 'ArrowDown'], ['ArrowUp', 'KeyC', 'Space']));
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});
test('Blockfall simultaneous opposing directions cancel even at a wall and never restart repeat', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 8; n++) step(g, 'ArrowLeft');
  const x = g.getState().piece.x;
  for (let n = 0; n < 60; n++)
    g.update(1 / 120, input(['ArrowLeft', 'ArrowRight'], ['ArrowLeft', 'ArrowRight']));
  assert.equal(g.getState().piece.x, x);
});
test('Blockfall floor kicks cannot indefinitely delay locking or farm repeated downward score', () => {
  const g = createGame(harness({ seed: 8 }).env);
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  const score = g.getState().score;
  for (
    let n = 0;
    n < 5000 &&
    g
      .getState()
      .board.flat()
      .every((v) => !v);
    n++
  )
    g.update(
      1 / 120,
      input(['ArrowDown'], g.getState().grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []),
    );
  assert.ok(g.getState().board.flat().some(Boolean));
  assert.ok(g.getState().score - score < 100);
});

test('Blockfall rejected or successful hold still advances the frame clock and gravity', () => {
  const g = createGame(harness().env);
  step(g, 'KeyC');
  const start = g.getState();
  for (let n = 0; n < 120; n++) g.update(1 / 120, input([], ['KeyC']));
  const end = g.getState();
  assert.ok(Math.abs(end.time - start.time - 1) < 1e-7);
  assert.ok(end.piece.y > start.piece.y);
});

test('Blockfall Retry X restores the random stream across three bags and clears held/discrete actions', () => {
  const s = createBlockState(77),
    initial = structuredClone(s),
    names = () => {
      const out = [];
      for (let n = 0; n < 24; n++) {
        out.push(s.piece.name);
        s.board = Array.from({ length: 20 }, () => Array(10).fill(0));
        stepBlock(s, 1 / 120, input([], ['Space']));
      }
      return out;
    },
    first = names();
  stepBlock(s, 1 / 120, input(['ArrowLeft', 'ArrowDown'], ['KeyX', 'Space', 'KeyC']));
  assert.equal(s.score, initial.score);
  assert.deepEqual(s.board, initial.board);
  assert.deepEqual(s.piece.matrix, initial.piece.matrix);
  assert.deepEqual(s.preview, initial.preview);
  assert.deepEqual(s.bag, initial.bag);
  assert.equal(s.rng, initial.rng);
  assert.equal(s.hold, null);
  assert.equal(s.retries, 1);
  const x = s.piece.x;
  for (let n = 0; n < 60; n++) stepBlock(s, 1 / 120, input(['ArrowLeft']));
  assert.equal(s.piece.x, x);
  stepBlock(s, 1 / 120, input());
  const second = names();
  assert.deepEqual(second, first);
});
test('Blockfall all essential actions have bilingual touch controls and Retry uses unreserved X', () => {
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowDown',
    'ArrowUp',
    'KeyZ',
    'Space',
    'KeyC',
    'KeyX',
  ]) {
    const c = meta.touchControls.find((c) => c.code === code);
    assert.ok(c, code);
    assert.ok(c.label.en);
    assert.match(c.label.zh, /\p{Script=Han}/u);
  }
  assert.equal(
    meta.touchControls.some((c) => c.code === 'KeyR'),
    false,
  );
});
test('Blockfall mixed press/hold opposing directions cancel without a wall-dependent move', () => {
  const g = createGame(harness().env),
    x = g.getState().piece.x;
  g.update(1 / 120, input(['ArrowLeft', 'ArrowRight'], ['ArrowRight']));
  assert.equal(g.getState().piece.x, x);
});
test('Blockfall simultaneous reverse rotations cancel without consuming a lock reset', () => {
  const g = createGame(harness().env),
    p = g.getState().piece;
  g.update(1 / 120, input([], ['ArrowUp', 'KeyZ']));
  assert.deepEqual(g.getState().piece.matrix, p.matrix);
  assert.equal(g.getState().piece.rotation, p.rotation);
  assert.equal(g.getState().lockResets, 0);
});
test('Blockfall lock stamp, simultaneous clear and conservation ledger are atomic', () => {
  const s = createBlockState(4);
  s.board[18] = Array(10).fill(8);
  s.board[19] = Array(10).fill(8);
  s.board[18][4] = s.board[18][5] = s.board[19][4] = s.board[19][5] = 0;
  s.injected = 16;
  s.piece = { name: 'O', matrix: SHAPES.O.map((r) => r.slice()), rotation: 0, x: 4, y: 18 };
  stepBlock(s, 1 / 120, input([], ['Space']));
  assert.equal(s.placed, 4);
  assert.equal(s.clearing.length, 2);
  assert.equal(s.lines, 0);
  assert.equal(s.piece, null);
  assert.equal(s.board.flat().filter(Boolean).length, 20);
  for (let n = 0; n < 30; n++) stepBlock(s, 1 / 120, input());
  assert.equal(s.lines, 2);
  assert.equal(s.removed, 20);
  assert.equal(s.score, 300);
  assert.equal(
    s.board.flat().filter(Boolean).length,
    s.injected + s.placed - s.removed - s.discarded,
  );
});
test('Blockfall a topped-out stamp leaves no partial cells and never locks a floating expired piece', () => {
  const s = createBlockState(4);
  s.board[1][3] = s.board[1][4] = s.board[1][5] = 8;
  s.piece = { name: 'T', matrix: SHAPES.T.map((r) => r.slice()), rotation: 0, x: 3, y: -1 };
  s.groundedTime = 0.5;
  s.touched = true;
  const before = structuredClone(s.board);
  stepBlock(s, 1 / 120, input());
  assert.equal(s.phase, 'lost');
  assert.deepEqual(s.board, before);
  assert.equal(s.placed, 0);
  const f = createBlockState(4);
  f.touched = true;
  f.contactAge = 3;
  f.groundedTime = 0.5;
  const y = f.piece.y;
  stepBlock(f, 1 / 120, input([], ['ArrowUp']));
  assert.equal(f.board.flat().filter(Boolean).length, 0);
  assert.equal(f.piece.y, y);
  assert.equal(f.phase, 'playing');
});

test('Blockfall the formerly exploitable I rotation cycle exhausts its reset budget and then locks', () => {
  const g = createGame(harness({ seed: 8 }).env);
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  const initial = g.getState();
  let maxResets = 0,
    airSeen = false;
  for (let n = 0; n < 1200 && g.getState().locks === 0; n++) {
    const before = g.getState();
    g.update(1 / 120, input(['ArrowDown'], before.grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []));
    const after = g.getState();
    maxResets = Math.max(maxResets, after.lockResets);
    if (!after.grounded && after.touched) airSeen = true;
  }
  const end = g.getState();
  assert.equal(end.locks, 1);
  assert.ok(airSeen);
  assert.ok(maxResets > 0 && maxResets <= 15);
  assert.ok(end.time - initial.time < 4);
  assert.ok(end.score - initial.score < 4);
  assert.equal(end.board.flat().filter(Boolean).length, 4);
});

test('Blockfall district entry discards discrete actions while intentional held movement and soft drop continue', () => {
  const s = createBlockState(3);
  s.piece = null;
  s.stageTimer = 0.005;
  s.buffer = { hold: true, rotate: 1, move: 1, expires: 2 };
  stepBlock(s, 0.01, input(['ArrowRight', 'ArrowDown'], ['ArrowUp', 'KeyC', 'Space']));
  assert.equal(s.stage, 2);
  assert.equal(s.hold, null);
  assert.equal(s.holdUsed, false);
  assert.equal(s.piece.rotation, 0);
  assert.equal(s.locks, 0);
  assert.equal(s.buffer, null);
  const x = s.piece.x;
  stepBlock(s, 0.01, input(['ArrowRight', 'ArrowDown']));
  assert.equal(s.piece.x, x + 1);
  assert.ok(s.fall > 0);
});
test('Blockfall line-clear buffering rotates exactly the next piece and never buffers a hard drop', () => {
  const s = createBlockState(4);
  s.board[19] = Array(10).fill(8);
  s.board[19][4] = s.board[19][5] = 0;
  s.piece = { name: 'O', matrix: SHAPES.O.map((r) => r.slice()), rotation: 0, x: 4, y: 18 };
  stepBlock(s, 0.01, input([], ['Space']));
  assert.equal(s.clearTimer > 0, true);
  stepBlock(s, 0.01, input([], ['ArrowUp', 'Space']));
  for (let n = 0; n < 30 && !s.piece; n++) stepBlock(s, 0.01, input());
  assert.equal(s.piece.rotation, 1);
  assert.equal(s.locks, 1);
  assert.equal(s.holdUsed, false);
  assert.equal(s.clearing.length, 0);
});
test('Blockfall mutable snapshots and drawing cannot alter board, queue or objective metadata', () => {
  const g = createGame(harness({ lang: 'zh' }).env),
    before = structuredClone(g.getState()),
    copy = g.getState();
  copy.board[19][0] = 999;
  copy.piece.matrix[0][0] = 999;
  copy.preview[0] = 'bogus';
  copy.objective.goal.zh = 'tampered';
  assert.deepEqual(g.getState(), before);
  const calls = [],
    ctx = mockContext();
  ctx.fillText = (v, x, y) => calls.push({ v, x, y });
  g.draw(ctx);
  assert.deepEqual(g.getState(), before);
  assert.ok(calls.some((c) => c.v === '方块降临'));
  assert.equal(
    calls.some((c) => c.v === 'BLOCKFALL'),
    false,
  );
});
test('Blockfall seeded traces retain finite bounded state, collision legality and cell conservation', () => {
  const a = createGame(harness({ seed: 9 }).env),
    b = createGame(harness({ seed: 9 }).env),
    random = seeded(45),
    codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'KeyC', 'Space', 'KeyX', null];
  for (let n = 0; n < 4000; n++) {
    const code = n % 13 === 0 ? codes[Math.floor(random() * codes.length)] : null,
      soft = random() < 0.4,
      controls = input(soft ? ['ArrowDown'] : [], code ? [code] : []);
    a.update(1 / 120, controls);
    b.update(1 / 120, controls);
    if (n % 23 === 0) {
      const s = a.getState();
      assert.deepEqual(s, b.getState());
      assert.equal(s.board.length, 20);
      assert.ok(s.board.every((r) => r.length === 10));
      assert.ok(s.preview.length === 3);
      assert.ok(s.bag.length <= 7);
      assert.equal(
        s.board.flat().filter(Boolean).length,
        s.injected + s.placed - s.removed - s.discarded,
      );
      for (const value of [s.score, s.time, s.lines, s.fall, s.contactAge, s.groundedTime])
        assert.ok(Number.isFinite(value));
      assert.ok(JSON.stringify(s).length < 8000);
      if (s.piece && s.phase === 'playing')
        assert.ok(canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y));
      a.draw(mockContext());
    }
  }
});

test('Blockfall expired manipulation discards repeat backlog instead of sliding the next piece across the well', () => {
  const g = createGame(harness({ seed: 8 }).env);
  assert.equal(g.getState().piece.name, 'I');
  for (let n = 0; n < 5000 && !g.getState().grounded; n++) g.update(1 / 120, input(['ArrowDown']));
  for (let n = 0; n < 1500 && g.getState().locks === 0; n++)
    g.update(
      1 / 120,
      input(['ArrowRight'], g.getState().grounded ? [n % 2 ? 'ArrowUp' : 'KeyZ'] : []),
    );
  const next = g.getState();
  assert.equal(next.locks, 1);
  assert.ok(next.repeat >= 0);
  g.update(1 / 120, input(['ArrowRight']));
  assert.ok(g.getState().piece.x - next.piece.x <= 1);
  assert.ok(g.getState().repeat >= 0);
});

test('Blockfall airborne contact deadline cancels a repeat scheduled just after the deadline', () => {
  const s = createBlockState(1);
  s.touched = true;
  s.contactAge = 2.999;
  s.lastDir = 1;
  s.repeat = 0.0015;
  const x = s.piece.x;
  stepBlock(s, 1 / 120, input(['ArrowRight']));
  assert.equal(s.piece.x, x);
  assert.ok(s.repeat >= 0);
  assert.equal(s.locks, 0);
  assert.ok(s.time > 0);
});

test('Blockfall an exhausted reset cap survives lift-off and locks on the next supported contact', () => {
  const s = createBlockState(2);
  s.piece = { name: 'I', matrix: rotatePiece(SHAPES.I), rotation: 1, x: 3, y: 16 };
  s.lockResets = 15;
  s.groundedTime = 0.49;
  s.contactAge = 1;
  s.touched = true;
  s.maxDropY = 17;
  stepBlock(s, 1 / 120, input(['ArrowDown'], ['ArrowUp']));
  assert.equal(s.lockResets, 15);
  assert.ok(s.groundedTime >= 0.49);
  assert.equal(s.locks, 0);
  assert.ok(canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1));
  for (let n = 0; n < 20 && s.locks === 0; n++) stepBlock(s, 1 / 120, input(['ArrowDown']));
  assert.equal(s.locks, 1);
  assert.ok(s.time < 0.1);
  assert.equal(s.score, 0);
  assert.equal(s.board.flat().filter(Boolean).length, 4);
});
