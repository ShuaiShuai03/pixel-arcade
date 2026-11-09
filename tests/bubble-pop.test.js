import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createBubbleState,
  stepBubble,
  resolveBubble,
  neighbors,
  bubblePoint,
} from '../src/games/bubble-pop.js';
import { LEVELS } from '../src/games/bubble-pop-levels.js';
import { harness, input, mockContext } from './harness.js';
test('Bubble cluster removes three plus disconnected bubbles', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  s.board[1][0] = 1;
  s.board[1][1] = 1;
  resolveBubble(s, 0, 2, 0, env);
  assert.equal(s.board.flat().filter((x) => x >= 0).length, 0);
  assert.equal(s.score, 130);
});
test('Bubble mismatches persist and neighbor graph is symmetric', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
  s.board[0][0] = 0;
  resolveBubble(s, 0, 1, 1, env);
  assert.equal(s.board[0][1], 1);
  for (const [r, c] of neighbors(3, 4))
    assert.ok(neighbors(r, c).some(([rr, cc]) => rr === 3 && cc === 4));
});
test('Bubble aiming and shot has wall bounces', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  const a = s.angle;
  stepBubble(s, 1 / 30, input(['ArrowLeft']), env);
  assert.ok(s.angle < a);
  stepBubble(s, 1 / 30, input([], ['Space']), env);
  assert.ok(s.shot);
  s.shot.x = 108.5;
  s.shot.vx = -200;
  stepBubble(s, 1 / 30, input(), env);
  assert.ok(s.shot.vx > 0);
});
test('Bubble terminal clear/overflow, restart and drawing', () => {
  for (const win of [true, false]) {
    const { env, ends } = harness();
    const s = createBubbleState(env);
    s.board = Array.from({ length: 12 }, () => Array(12).fill(-1));
    if (!win) s.board[11][0] = 1;
    else s.level = s.totalLevels;
    stepBubble(s, 1 / 60, input(), env);
    assert.equal(s.phase, win ? 'won' : 'lost');
    assert.equal(ends.length, 1);
  }
  const { env } = harness();
  const g = createGame(env);
  g.draw(mockContext());
  assert.ok(g.getState().remaining > 0);
});
test('Bubble geometry uses an exact hex lattice inside side walls', () => {
  const s = createBubbleState(harness().env);
  assert.equal(s.board[1][11], -1, 'short odd rows cannot contain off-board bubble');
  assert.equal(s.level, 1);
  assert.equal(s.totalLevels, LEVELS.length);
});
test('Bubble shot ignores zero dt and invalid placement cannot overwrite occupied cell', () => {
  const { env } = harness();
  const s = createBubbleState(env);
  const old = s.board[0][0];
  assert.throws(() => resolveBubble(s, 0, 0, (old + 1) % 4, env), /occupied/);
});

test('Bubble exact hex neighbors all lie one diameter apart', () => {
  const pt = bubblePoint;
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < (r % 2 ? 11 : 12); c++)
      for (const [rr, cc] of neighbors(r, c)) {
        const a = pt(r, c),
          b = pt(rr, cc);
        assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 24) < 1e-9);
      }
});
test('Bubble emptying a cavern advances a different puzzle without ending campaign', () => {
  const { env, ends } = harness();
  const s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  stepBubble(s, 1 / 120, input(), env);
  assert(s.transition > 0);
  for (let i = 0; i < 150; i++) stepBubble(s, 1 / 120, input(), env);
  assert.equal(s.level, 2);
  assert.equal(s.phase, 'playing');
  assert.equal(ends.length, 0);
  assert.ok(s.board.flat().some((v) => v >= 0));
});
test('Bubble free shot follows exact linear flight at 60 and 120 Hz', () => {
  const states = [60, 120].map((hz) => {
    const { env } = harness();
    const s = createBubbleState(env);
    s.board.forEach((r) => r.fill(-1));
    s.board[0][0] = 0;
    stepBubble(s, 1 / hz, input([], ['Space']), env);
    for (let n = 1; n < hz / 5; n++) stepBubble(s, 1 / hz, input(), env);
    return s;
  });
  assert.ok(Math.abs(states[0].shot.y - 227) < 1e-8);
  assert.ok(Math.abs(states[0].shot.y - states[1].shot.y) < 1e-8);
});

test('Bubble zero and invalid time are complete no-ops, including queued actions and resources', () => {
  const { env } = harness(),
    s = createBubbleState(env),
    before = structuredClone(s);
  for (const dt of [0, -1, NaN, Infinity])
    stepBubble(
      s,
      dt,
      input(['ArrowLeft'], ['Space', 'KeyX'], { x: 110, y: 100, down: true, clicked: true }),
      env,
    );
  assert.deepEqual(s, before);
});
test('Bubble roof contact starts a continuous guided capture rather than a cell teleport', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.board[0][0] = 0;
  s.shot = { x: 240, y: 49, vx: 0, vy: -350, color: 1 };
  stepBubble(s, 1 / 120, input(), env);
  assert(s.capture);
  assert(Math.abs(s.capture.x - 240) < 3);
  assert.equal(s.capture.y, 48);
  assert.equal(s.board.flat().filter((c) => c >= 0).length, 1);
});
test('Bubble mechanical pressure warns and moves continuously instead of stepping the rack', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.board[0][0] = 0;
  s.misses = s.maxMisses - 1;
  s.shot = { x: 240, y: 49, vx: 0, vy: -350, color: 1 };
  for (let i = 0; i < 240 && s.misses === s.maxMisses - 1; i++)
    stepBubble(s, 1 / 240, input(), env);
  assert.equal(s.ceiling, 0);
  assert(s.pressureWarning > 0);
  assert(s.ceilingMotion);
});
test('Bubble released cells drain below the air table without gaining unexplained in-plane velocity', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  s.board[1][0] = 1;
  resolveBubble(s, 0, 2, 0, env);
  const before = s.popped.map((p) => ({ x: p.x, y: p.y }));
  s.board[0][11] = 2;
  for (let i = 0; i < 12; i++) stepBubble(s, 1 / 120, input(), env);
  assert(s.popped.length > 0);
  for (let i = 0; i < s.popped.length; i++) {
    assert.equal(s.popped[i].x, before[i].x);
    assert.equal(s.popped[i].y, before[i].y);
    assert(s.popped[i].z > 0);
  }
});
test('Bubble pointer aiming uses a bounded physical gimbal and each stage has authored mechanical features', () => {
  const { env } = harness(),
    s = createBubbleState(env),
    angle = s.angle;
  stepBubble(s, 1 / 120, input([], [], { x: 100, y: 290, down: true }), env);
  assert(Math.abs(s.angle - angle) < 0.03);
  const second = createBubbleState(harness().env, 5),
    third = createBubbleState(harness().env, 9);
  assert(second.obstacles.length > 0);
  assert(third.obstacles.length > 0);
  assert.notDeepEqual(second.board, third.board);
});

test('Bubble launches wait until released capsules have one-diameter vertical clearance', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [{ row: 8, col: 5 }];
  s.ceiling = Math.sqrt(3) * 12;
  s.board[9][4] = 1;
  s.board[9][6] = 1;
  s.board[0][0] = 0;
  resolveBubble(s, 9, 5, 1, env);
  const shots = s.shots;
  stepBubble(s, 1 / 120, input([], ['Space']), env);
  assert.equal(s.shot, null);
  assert.equal(s.shots, shots);
  for (let i = 0; i < 40; i++) stepBubble(s, 1 / 120, input(), env);
  assert(s.popped.every((p) => p.z >= 24));
  stepBubble(s, 1 / 120, input([], ['Space']), env);
  assert(s.shot || s.capture);
  assert.equal(s.shots, shots + 1);
});
test('Bubble final victory waits until the physical drain clears before freezing', () => {
  const { env, ends } = harness(),
    s = createBubbleState(env, LEVELS.length);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [];
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  resolveBubble(s, 0, 2, 0, env);
  stepBubble(s, 1 / 120, input(), env);
  assert.equal(s.phase, 'playing');
  assert.equal(ends.length, 0);
  for (let i = 0; i < 120 && s.phase === 'playing'; i++) stepBubble(s, 1 / 120, input(), env);
  assert.equal(s.phase, 'won');
  assert.equal(s.popped.length, 0);
  assert.equal(ends.length, 1);
  const terminal = structuredClone(s);
  stepBubble(s, 1 / 30, input([], ['Space', 'KeyX']), env);
  assert.deepEqual(s, terminal);
});

test('Bubble safety line includes fixed rack bolts, not only colored capsules', () => {
  const { env } = harness(),
    s = createBubbleState(env, 2);
  s.board.forEach((r) => r.fill(-1));
  s.board[0][0] = 0;
  s.obstacles = [{ row: 9, col: 5 }];
  s.ceiling = 30;
  stepBubble(s, 1 / 120, input([], ['Space']), env);
  assert.equal(s.phase, 'lost');
  assert.equal(s.shots, 0);
});

test('Bubble old-board clicks and fire presses cannot leak through drain or stage boundaries', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  resolveBubble(s, 0, 2, 0, env);
  const shots = s.shots;
  stepBubble(s, 1 / 30, input([], ['Space'], { x: 140, y: 100, down: true, clicked: true }), env);
  assert.equal(s.shots, shots);
  assert(!s.queuedFire);
  for (const p of s.popped) {
    p.life = 0.001;
    p.z = 100;
  }
  s.queuedFire = true;
  stepBubble(s, 1 / 30, input([], ['Space'], { x: 140, y: 100, down: true, clicked: true }), env);
  assert(s.transition > 0);
  assert(!s.queuedFire);
  assert.equal(s.shots, shots);
  s.transition = 0.01;
  stepBubble(
    s,
    1 / 30,
    input([], ['Space', 'KeyX'], { x: 320, y: 100, down: true, clicked: true }),
    env,
  );
  assert.equal(s.level, 2);
  assert.equal(s.shots, shots);
  assert.equal(s.shot, null);
  assert.equal(s.capture, null);
  assert(!s.queuedFire);
});
test('Bubble terminal drain clears stale intent and never launches a ghost capsule', () => {
  const { env, ends } = harness(),
    s = createBubbleState(env, LEVELS.length);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [];
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  resolveBubble(s, 0, 2, 0, env);
  for (const p of s.popped) {
    p.life = 0.001;
    p.z = 100;
  }
  s.queuedFire = true;
  s.aimTarget = -2;
  stepBubble(s, 1 / 30, input([], ['Space'], { x: 140, y: 100, down: true, clicked: true }), env);
  assert.equal(s.phase, 'won');
  assert(!s.queuedFire);
  assert.equal(s.shots, 0);
  assert.equal(ends.length, 1);
});

test('Bubble chamber boundaries use the same radius and lattice as rendered contacts', () => {
  assert.equal(bubblePoint(0, 0).x - 12, 96);
  assert.equal(bubblePoint(0, 11).x + 12, 384);
  assert.equal(bubblePoint(0, 0).y - 12, 36);
  const s = createBubbleState(harness().env);
  for (let row = 0; row < 12; row++)
    for (let col = 0; col < (row % 2 ? 11 : 12); col++) {
      const p = bubblePoint(row, col);
      assert(p.x >= 108 && p.x <= 372);
    }
});
test('Bubble wall impacts conserve speed, include end-of-step contact, and ignore separating tangency', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [];
  s.board[0][0] = 0;
  s.shot = { x: 371, y: 200, vx: 240, vy: -10, color: 1 };
  stepBubble(s, 1 / 240, input(), env);
  assert(s.shot);
  assert.equal(s.shot.vx, -240);
  assert(Math.abs(s.shot.x - 372) < 1e-8);
  assert.equal(s.shot.vy, -10);
  stepBubble(s, 1 / 240, input(), env);
  assert(s.shot.x < 372);
  assert.equal(s.shot.vx, -240);
});
test('Bubble arbitrarily fast bank sweeps preserve all remaining travel and energy', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [];
  s.board[0][0] = 0;
  const vx = 1e7,
    dt = 1 / 30;
  s.shot = { x: 240, y: 240, vx, vy: -1, color: 1 };
  stepBubble(s, dt, input(), env);
  const span = 264,
    fold = (((132 + vx * dt) % (span * 2)) + span * 2) % (span * 2),
    expected = fold <= span ? 108 + fold : 372 - (fold - span);
  assert(s.shot);
  assert(Math.abs(s.shot.x - expected) < 1e-4);
  assert(Math.abs(s.shot.y - (240 - dt)) < 1e-7);
  assert.equal(Math.abs(s.shot.vx), vx);
  assert.equal(s.shot.vy, -1);
  assert(Math.abs(s.time - dt) < 1e-8);
});
test('Bubble simultaneous two-capsule and wall contacts choose continuous legal sockets', () => {
  const { env } = harness(),
    s = createBubbleState(env);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [];
  s.board[0][5] = 0;
  s.board[0][6] = 2;
  s.shot = { x: 240, y: 80, vx: 0, vy: -350, color: 1 };
  for (let i = 0; i < 120 && (s.shot || s.capture); i++) stepBubble(s, 1 / 240, input(), env);
  assert.equal(s.board[1][5], 1);
  const q = createBubbleState(env);
  q.board.forEach((r) => r.fill(-1));
  q.obstacles = [];
  q.board[0][0] = 0;
  q.shot = { x: 110, y: 74, vx: -200, vy: -200, color: 1 };
  stepBubble(q, 0.01, input(), env);
  assert(q.capture);
  assert(Math.abs(q.capture.x - 108) < 1e-7);
  assert(Math.abs(q.capture.y - 72) < 1e-7);
  for (let i = 0; i < 200 && q.capture; i++) stepBubble(q, 1 / 240, input(), env);
  assert.equal(q.board[1][0], 1);
});
test('Bubble mirrored unambiguous contacts produce mirrored captures without overlap or list bias', () => {
  const run = (mirror) => {
    const { env } = harness(),
      s = createBubbleState(env);
    s.board.forEach((r) => r.fill(-1));
    s.obstacles = [];
    s.board[0][mirror ? 7 : 4] = 0;
    s.shot = { x: 240, y: 180, vx: mirror ? 80 : -80, vy: -300, color: 1 };
    for (let i = 0; i < 800 && (s.shot || s.capture); i++) stepBubble(s, 1 / 240, input(), env);
    return s.board;
  };
  const left = run(false),
    right = run(true);
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < (r % 2 ? 11 : 12); c++)
      assert.equal(left[r][c], right[r][(r % 2 ? 11 : 12) - 1 - c]);
});
test('Bubble guide samples are continuous and never penetrate capsules, bolts, rails or roof', () => {
  let arcs = 0,
    launched = 0;
  for (const angle of [-2.7, -2.2, -1.57, -1.1, -0.55]) {
    const h = harness({ seed: 7 }),
      g = createGame(h.env),
      pointer = {
        x: 240 + Math.cos(angle) * 120,
        y: 297 + Math.sin(angle) * 120,
        down: true,
        clicked: true,
      };
    g.update(1 / 240, input([], [], pointer));
    let previous = null,
      saw = false;
    for (let i = 0; i < 1500 && g.getState().phase === 'playing'; i++) {
      const s = g.getState(),
        active = s.shot || s.capture;
      if (active) {
        saw = true;
        if (previous)
          assert(Math.hypot(active.x - previous.x, active.y - previous.y) <= 350 / 240 + 1e-4);
        assert(active.x >= 108 - 1e-5 && active.x <= 372 + 1e-5);
        assert(active.y >= 48 + s.ceiling - 1e-5);
        const solids = [];
        for (let r = 0; r < 12; r++)
          for (let c = 0; c < (r % 2 ? 11 : 12); c++)
            if (s.board[r][c] >= 0) solids.push(bubblePoint(r, c, s.ceiling));
        for (const p of s.obstacles) solids.push(bubblePoint(p.row, p.col, s.ceiling));
        for (const p of solids) assert(Math.hypot(active.x - p.x, active.y - p.y) >= 24 - 1e-4);
        if (s.capture) {
          arcs += s.capture.segments.some((p) => p.kind === 'arc') ? 1 : 0;
          assert(s.capture.speed <= 140 + 1e-6);
        }
        previous = { x: active.x, y: active.y };
      } else if (saw || !s.queuedFire) break;
      g.update(1 / 240, input());
    }
    if (saw) launched++;
  }
  assert(launched >= 3);
  assert(arcs > 0);
});
test('Bubble projected socket is the actual reachable guided socket', () => {
  const h = harness({ seed: 7 }),
    g = createGame(h.env);
  let dash = [],
    ghost = null;
  const ctx = mockContext();
  ctx.setLineDash = (value) => (dash = value);
  ctx.arc = (x, y, r) => {
    if (dash.length && r === 12) ghost = { x, y };
  };
  g.draw(ctx);
  assert(ghost);
  g.update(1 / 240, input([], ['Space']));
  let target = null;
  for (let i = 0; i < 1000 && !target; i++) {
    const s = g.getState();
    if (s.capture) target = s.capture.target;
    else g.update(1 / 240, input());
  }
  assert(target);
  assert(Math.hypot(target.x - ghost.x, target.y - ghost.y) < 1e-6);
});
test('Bubble fixed bolts anchor groups and retired colors never leave unusable ammunition', () => {
  const { env } = harness(),
    s = createBubbleState(env, 2);
  s.board.forEach((r) => r.fill(-1));
  s.obstacles = [{ row: 2, col: 5 }];
  s.board[0][0] = 0;
  s.board[0][1] = 0;
  s.board[3][5] = 1;
  s.board[4][5] = 1;
  assert.equal(resolveBubble(s, 0, 2, 0, env), 3);
  assert.equal(s.board[3][5], 1);
  assert.equal(s.board[4][5], 1);
  assert.throws(() => resolveBubble(s, 2, 5, 1, env), /occupied/);
  const q = createBubbleState(env);
  q.board.forEach((r) => r.fill(-1));
  q.obstacles = [];
  q.board[0][0] = 1;
  q.board[0][1] = 1;
  q.board[0][2] = 1;
  q.board[0][5] = 0;
  q.current = 1;
  q.next = 1;
  q.colorBag = [1, 0, 1];
  q.shot = { x: 144, y: 75, vx: 0, vy: -350, color: 1 };
  for (let i = 0; i < 500 && (q.shot || q.capture || q.popped.length); i++)
    stepBubble(q, 1 / 240, input(), env);
  assert.equal(q.current, 0);
  assert.equal(q.next, 0);
  assert.equal(q.phase, 'playing');
});
test('Bubble pusher travel is continuous and frame-rate invariant, and controls recover afterwards', () => {
  const states = [30, 60, 120].map((hz) => {
    const { env } = harness(),
      s = createBubbleState(env);
    s.board.forEach((r) => r.fill(-1));
    s.obstacles = [];
    s.board[0][0] = 0;
    s.ceilingMotion = { from: 0, to: Math.sqrt(3) * 12, time: 0, duration: 0.8 };
    let before = 0;
    for (let i = 0; i < hz; i++) {
      stepBubble(s, 1 / hz, input(['ArrowRight']), env);
      assert(s.ceiling >= before - 1e-8);
      assert(s.ceiling - before <= 39 / hz + 1e-5);
      before = s.ceiling;
    }
    assert.equal(s.ceilingMotion, null);
    const shots = s.shots;
    stepBubble(s, 1 / hz, input([], ['Space']), env);
    assert.equal(s.shots, shots + 1);
    return s.ceiling;
  });
  assert(states.every((c) => Math.abs(c - Math.sqrt(3) * 12) < 1e-7));
});
