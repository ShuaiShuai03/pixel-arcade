import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, makeBricks, stepBreaker } from '../src/games/starbreaker.js';
import {
  LEVELS,
  LEVEL_COUNT,
  DRIFT_AMPLITUDE,
  DRIFT_RATE,
  clampLevel,
} from '../src/games/starbreaker-levels.js';
import { MENU_COLUMNS, menuCell } from '../src/games/starbreaker-menu.js';
import { wrapText } from '../src/games/starbreaker-draw.js';
import { createBreakerState } from '../src/games/starbreaker-step.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const FIELDS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_FIELDS = FIELDS.filter((n) => n >= 3);
const REACTION_SECONDS = 0.25;
const CJK = /[一-鿿]/;
const BLIND_SEEDS = [1, 2, 3, 4];
const BLIND_HORIZON = 100;
const CLEAR_LIMIT = 400;

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// ---------------------------------------------------------------------------------------------
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
/** Start a run on `level` the way a player does: through the select screen when it is offered. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ seed, lang });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
function landingX(ball, y = 283) {
  let x = ball.x + ((y - ball.y) / ball.vy) * ball.vx;
  while (x < 12 || x > 468) x = x < 12 ? 24 - x : 936 - x;
  return x;
}
/** Where to hold the paddle: under the landing point, offset so the return heads for a brick. */
function aimedTarget(paddle, seen) {
  const b = seen.ball;
  if (b.vy <= 0) return b.x;
  const land = landingX(b);
  if (!seen.bricks.length) return land;
  const brick = seen.bricks[Math.floor(seen.time / 6) % seen.bricks.length],
    speed = Math.hypot(b.vx, b.vy),
    dx = brick.x + brick.w / 2 - land,
    dy = brick.y - 290,
    length = Math.hypot(dx, dy),
    slope = ((dx / length) * speed - b.vx) / (b.vy - (dy / length) * speed),
    offset = Math.max(-0.6, Math.min(0.6, (slope * paddle.w) / 32));
  return land - (offset * paddle.w) / 2;
}
/** A reaction-limited player: sees the ball as it was `delay` seconds ago, steers with the keys. */
function botFrame(now, seen) {
  const keys = [],
    pressed = [];
  if (seen.docked) pressed.push('Space');
  const gap = (seen.docked ? now.paddle.x : aimedTarget(now.paddle, seen)) - now.paddle.x;
  if (gap > 3) keys.push('ArrowRight');
  else if (gap < -3) keys.push('ArrowLeft');
  return input(keys, pressed);
}
function playField(level, hz, { delay = REACTION_SECONDS, seed = 1, progress } = {}) {
  const { g, h } = open(level, { seed, progress }),
    history = [],
    lag = Math.round(delay * hz);
  let frames = 0;
  while (frames < CLEAR_LIMIT * hz) {
    const now = g.getState();
    history.push(now);
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / hz, botFrame(now, history[Math.max(0, history.length - 1 - lag)]));
    frames++;
  }
  const end = g.getState();
  return { g, h, end, seconds: frames / hz, cleared: end.level > level || end.phase === 'won' };
}
const POLICIES = {
  idle: () => input(),
  mash: () => input([], ['Space', 'ArrowUp', 'Enter']),
  randomKeys: (rng, memory) => {
    if (memory.frame % 12 === 0)
      memory.held = [['ArrowLeft'], ['ArrowRight'], [], ['ArrowLeft'], ['ArrowRight']][
        Math.floor(rng() * 5)
      ];
    return input(memory.held, rng() < 0.2 ? ['Space'] : rng() < 0.1 ? ['ArrowDown'] : []);
  },
};
function blindWins(policy, level, seed) {
  const { g } = open(level, { seed }),
    rng = seeded(seed * 31 + level),
    memory = { frame: 0, held: [] };
  for (; memory.frame < BLIND_HORIZON * 60; memory.frame++) {
    const now = g.getState();
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / 60, POLICIES[policy](rng, memory));
  }
  const end = g.getState();
  return end.level > level || end.phase === 'won';
}
function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------
// The field table.
// ---------------------------------------------------------------------------------------------
const featuresOf = (level) => {
  const bricks = makeBricks(level);
  return {
    armour: bricks.some((b) => b.hp >= 2),
    heavy: bricks.some((b) => b.hp >= 3),
    reactor: bricks.some((b) => b.kind === 'reactor'),
    drift: bricks.some((b) => b.drift),
  };
};
test('there are at least twenty distinct layouts, each with a name and a bilingual tip', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.equal(new Set(LEVELS.map((f) => f.rows.join('/') + f.stagger)).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((f) => f.name.en)).size, LEVEL_COUNT);
  for (const f of LEVELS) {
    assert.ok(f.name.en && CJK.test(f.name.zh) && f.tip.en.length > 20 && CJK.test(f.tip.zh));
    assert.ok(f.rows.length >= 3 && f.rows.length <= 6);
    for (const row of f.rows) assert.match(row, /^[.abcR<>{}]{8}$/);
  }
});
test('exported field data is frozen all the way down', () => {
  assert.ok(Object.isFrozen(LEVELS));
  for (const f of LEVELS) {
    assert.ok(Object.isFrozen(f) && Object.isFrozen(f.rows) && Object.isFrozen(f.name));
    assert.ok(Object.isFrozen(f.tip));
  }
  const bricks = makeBricks(1);
  bricks[0].hp = 9;
  assert.equal(makeBricks(1)[0].hp, 1, 'makeBricks hands out fresh copies');
});
test('the curve teaches one brick idea at a time, then combines, then masters', () => {
  const firstSeen = {};
  for (const n of FIELDS)
    for (const [key, on] of Object.entries(featuresOf(n))) if (on) firstSeen[key] ??= n;
  assert.deepEqual(firstSeen, { armour: 3, reactor: 5, drift: 6, heavy: 15 });
  for (const n of FIELDS.slice(0, 7)) {
    const f = featuresOf(n);
    assert.ok(Object.values(f).filter(Boolean).length <= 3, `field ${n}`);
  }
  const weight = (n) => makeBricks(n).reduce((sum, b) => sum + b.hp, 0);
  assert.ok(weight(1) < weight(8) && weight(8) <= weight(20));
  assert.ok(FIELDS.slice(14).every((n) => weight(n) >= 30));
});
test('every tip names only what its layout really contains', () => {
  for (const n of FIELDS) {
    const f = featuresOf(n),
      { en, zh } = LEVELS[n - 1].tip;
    if (/reactor/i.test(en)) assert.ok(f.reactor, `tip ${n} reactor`);
    if (/reactor/i.test(en)) assert.match(zh, /反应堆/);
    if (/drift/i.test(en)) assert.ok(f.drift, `tip ${n} drift`);
    if (/drift/i.test(en)) assert.match(zh, /漂移/);
    if (/armou?r/i.test(en)) assert.ok(f.armour, `tip ${n} armour`);
    if (/armou?r/i.test(en)) assert.match(zh, /装甲/);
    if (/gap|corridor/i.test(en)) assert.ok(LEVELS[n - 1].rows.join('').includes('.'));
    if (/offset/i.test(en)) assert.ok(LEVELS[n - 1].stagger > 0);
    if (/triple/i.test(en)) assert.ok(f.heavy, `tip ${n} triple`);
  }
  for (const n of [5, 9, 14, 15, 16, 18, 20]) assert.ok(featuresOf(n).reactor);
  for (const n of [6, 10, 13, 17, 20]) assert.ok(featuresOf(n).drift);
});
test('bricks sit inside the walls and drifting rows never touch at any phase', () => {
  const period = (2 * Math.PI) / DRIFT_RATE;
  for (const n of FIELDS) {
    const bricks = makeBricks(n);
    for (let t = 0; t <= period; t += 0.2) {
      const rects = bricks.map((b) => ({
        x: b.baseX + Math.sin(t * DRIFT_RATE) * DRIFT_AMPLITUDE * b.drift,
        y: b.y,
        w: b.w,
        h: b.h,
      }));
      rects.forEach((a, i) => {
        assert.ok(a.x >= 14 && a.x + a.w <= 466 && a.y + a.h < 230, `field ${n} brick ${i}`);
        for (const c of rects.slice(i + 1))
          assert.ok(
            a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y,
            `field ${n} overlap at ${t.toFixed(1)}`,
          );
      });
    }
  }
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel('x'), 1);
  assert.equal(clampLevel(99), LEVEL_COUNT);
  assert.equal(makeBricks(-5).length, makeBricks(1).length);
});

// ---------------------------------------------------------------------------------------------
// Scripted legal clear of every field, and the reaction-limited player at 30, 60 and 120 Hz.
// ---------------------------------------------------------------------------------------------
test('a scripted legal clear completes every field through the public input', () => {
  for (const n of FIELDS) {
    const run = playField(n, 60, { delay: 0 });
    assert.ok(run.cleared, `field ${n} not cleared in ${run.seconds}s`);
    assert.equal(run.end.phase, n === LEVEL_COUNT ? 'won' : 'playing');
  }
});
test('a reaction-limited paddle bot clears every field at 30, 60 and 120 Hz', () => {
  for (const hz of HZS)
    for (const n of FIELDS) {
      const run = playField(n, hz);
      assert.ok(run.cleared, `field ${n} at ${hz} Hz: ${run.end.phase} after ${run.seconds}s`);
    }
});
test('idle, mash and random-key players win at most a quarter of any field from field 3', () => {
  for (const policy of Object.keys(POLICIES))
    for (const n of BLIND_FIELDS) {
      const wins = BLIND_SEEDS.filter((seed) => blindWins(policy, n, seed)).length;
      assert.ok(wins / BLIND_SEEDS.length <= 0.25, `${policy} won ${wins} on field ${n}`);
    }
});

// ---------------------------------------------------------------------------------------------
// Fair start.
// ---------------------------------------------------------------------------------------------
test('a new player gets time to read: the opening waits for the launch', () => {
  const { g, h } = open(1, { progress: null });
  for (let i = 0; i < 60 * 60; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.lives, 3);
  assert.ok(s.docked && s.intro);
  assert.equal(s.menu, null);
  assert.equal(h.ends.length, 0);
  const text = [];
  const ctx = mockContext();
  ctx.fillText = (t) => text.push(t);
  g.draw(ctx);
  assert.ok(text.includes(LEVELS[0].name.en));
  assert.ok(text.some((line) => LEVELS[0].tip.en.startsWith(line)));
});
test('a launched ball with an idle paddle is caught by the training net, not a life', () => {
  const { g } = open(1, { progress: null });
  g.update(1 / 60, input([], ['Space']));
  let firstNetSave = -1;
  for (let i = 0; i < 60 * 40 && g.getState().lives === 3; i++) {
    g.update(1 / 60, input());
    if (firstNetSave < 0 && g.getState().net < 2) firstNetSave = i / 60;
  }
  const s = g.getState();
  assert.ok(!s.intro);
  assert.ok(firstNetSave > 0 && firstNetSave < 4, 'the net answers the first miss');
  assert.equal(s.net, 0);
  assert.equal(s.lives, 2, 'the third miss costs a ball, and not before the net is used up');
  assert.equal(createBreakerState(2).net, 0);
});

// ---------------------------------------------------------------------------------------------
// Select and continue.
// ---------------------------------------------------------------------------------------------
test('the field select offers saved progress and starts the chosen field', () => {
  const store = memoryStore(7),
    { g } = open(7, { progress: store, launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 7, unlocked: 7, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  assert.match(s.status.en, /Choose a field/);
  assert.match(s.status.zh, /选择区域/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7, 'locked fields cannot be reached by keys');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Space']));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 6);
  assert.equal(s.bricks.length, makeBricks(6).length);
  assert.ok(s.docked);
});
test('tapping a cell starts it and tapping a locked cell is refused', () => {
  const { g, h } = open(4, { launch: false }),
    centre = (n) => {
      const c = menuCell(n);
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true };
    };
  g.update(1 / 60, input([], [], centre(12)));
  assert.ok(g.getState().menu);
  assert.ok(h.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: 3, y: 315, clicked: true }));
  assert.ok(g.getState().menu);
  g.update(1 / 60, input([], [], centre(2)));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().menu, null);
});
test('clearing a field unlocks the next one and never lowers the saved value', () => {
  const store = memoryStore(1),
    run = playField(1, 60, { progress: store });
  assert.ok(run.cleared);
  assert.deepEqual(store.calls, [2]);
  assert.equal(store.value, 2);
  assert.equal(run.g.getState().unlocked, 2);
  const high = memoryStore(9),
    second = playField(3, 60, { progress: high });
  assert.ok(second.cleared);
  assert.equal(high.value, 9);
  assert.ok(high.calls.every((n) => n > 3));
});
test('a broken, throwing or junk progress store never stops play', () => {
  const stores = [
    undefined,
    null,
    {},
    { unlocked: () => 1 },
    {
      unlocked: () => {
        throw new Error('storage blocked');
      },
      unlock: () => {
        throw new Error('storage full');
      },
    },
  ];
  for (const progress of stores) {
    const run = playField(1, 60, { progress });
    assert.ok(run.cleared);
    assert.equal(run.end.level, 2);
  }
  const junk = [NaN, -5, 0, 0.4, 1e9, Infinity, -Infinity, '7', 'x', null, undefined, {}, [3]];
  for (const value of junk) {
    const { g } = open(1, { progress: { unlocked: () => value, unlock() {} }, launch: false });
    const s = g.getState();
    const expected = Number.isFinite(Math.floor(Number(value))) ? Math.floor(Number(value)) : 1;
    assert.equal(s.unlocked, Math.min(LEVEL_COUNT, Math.max(1, expected)), String(value));
    if (s.menu) assert.ok(s.menu.cursor >= 1 && s.menu.cursor <= LEVEL_COUNT);
    g.draw(mockContext());
  }
});

// ---------------------------------------------------------------------------------------------
// Ball physics.
// ---------------------------------------------------------------------------------------------
const brickAt = (x, y, hp = 1, extra = {}) => ({
  x,
  y,
  baseX: x,
  w: 42,
  h: 14,
  hp,
  color: 0,
  kind: 'normal',
  drift: 0,
  ...extra,
});
test('a fast ball cannot tunnel through a brick row or the paddle', () => {
  const rng = seeded(5);
  for (const speed of [400, 900, 3000]) {
    for (let k = 0; k < 20; k++) {
      const s = createBreakerState(1);
      s.docked = false;
      s.bricks = Array.from({ length: 10 }, (_, i) => brickAt(10 + i * 48, 100, 999));
      s.ball = { x: 20 + rng() * 440, y: 200, vx: (rng() - 0.5) * 60, vy: -speed, r: 4 };
      for (let f = 0; f < 3; f++) {
        stepBreaker(s, 1 / 30, input(), rng);
        assert.ok(s.ball.y > 114, `speed ${speed} x ${s.ball.x} reached ${s.ball.y}`);
      }
    }
    const p = createBreakerState(1);
    p.docked = false;
    p.net = 0;
    p.ball = { x: 240 + (rng() - 0.5) * 60, y: 286 - speed / 20, vx: 0, vy: speed, r: 4 };
    for (let f = 0; f < 3; f++) stepBreaker(p, 1 / 30, input(), rng);
    assert.equal(p.lives, 3, `paddle tunnelled at ${speed}`);
    assert.ok(p.ball.vy < 0);
  }
});
test('paddle hits can never push the ball past the launcher speed limit', () => {
  const s = createBreakerState(1);
  s.docked = false;
  s.net = 0;
  s.bricks = [brickAt(400, 60, 999)];
  s.ball = { x: 240, y: 200, vx: 0, vy: 330, r: 4 };
  let top = 0;
  for (let n = 0; n < 60 * 40 && s.phase === 'playing'; n++) {
    const keys = s.ball.x < s.paddle.x ? ['ArrowLeft'] : ['ArrowRight'];
    stepBreaker(s, 1 / 60, input(n % 20 < 10 ? keys : []), seeded(1));
    top = Math.max(top, Math.hypot(s.ball.vx, s.ball.vy));
  }
  assert.ok(top <= 360 + 1e-6, `speed ${top}`);
  const q = createBreakerState(1);
  q.docked = false;
  q.ball = { x: 250, y: 282, vx: 300, vy: 400, r: 4 };
  for (let n = 0; n < 4; n++) stepBreaker(q, 1 / 240, input(), seeded(1));
  assert.ok(q.ball.vy < 0);
  assert.ok(Math.hypot(q.ball.vx, q.ball.vy) <= 360 + 1e-9);
});
test('a ball bouncing straight up and down cannot loop forever', () => {
  const s = createBreakerState(1);
  s.docked = false;
  s.bricks = [brickAt(400, 60)];
  s.ball = { x: 240, y: 200, vx: 0, vy: -200, r: 4 };
  let sideways = 0;
  for (let n = 0; n < 60 * 120 && s.level === 1; n++) {
    stepBreaker(s, 1 / 60, input([], [], { x: s.ball.x, y: 290, down: true }), seeded(1));
    sideways = Math.max(sideways, Math.abs(s.ball.vx));
  }
  assert.ok(sideways >= 25);
  assert.equal(s.level, 2, 'the tracked ball reached the last brick');
});
test('a ball bouncing flat between the walls is turned downwards', () => {
  const s = createBreakerState(1);
  s.docked = false;
  s.bricks = [brickAt(200, 60, 999)];
  s.ball = { x: 100, y: 150, vx: 200, vy: 0, r: 4 };
  const speed = 200;
  let wallHit = false;
  for (let n = 0; n < 60 * 4 && !wallHit; n++) {
    stepBreaker(s, 1 / 60, input(), seeded(1));
    wallHit = s.ball.vx < 0;
  }
  assert.ok(wallHit);
  assert.ok(Math.abs(s.ball.vy) >= 40);
  assert.ok(Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - speed) < 1e-6);
  const t = createBreakerState(1);
  t.docked = false;
  t.bricks = [brickAt(200, 60, 999)];
  t.ball = { x: 460, y: 150, vx: 200, vy: -10, r: 4 };
  for (let n = 0; n < 4; n++) stepBreaker(t, 1 / 60, input(), seeded(1));
  assert.ok(t.ball.vy <= -40);
});
test('a reactor destroyed by another reactor chains and awards points', () => {
  const s = createBreakerState(9);
  s.docked = false;
  s.bricks = [
    brickAt(100, 100, 1, { kind: 'reactor' }),
    brickAt(148, 100, 1, { kind: 'reactor' }),
    brickAt(196, 100, 1, { kind: 'reactor' }),
    brickAt(244, 100, 2),
    brickAt(400, 100, 1),
  ];
  s.ball = { x: 121, y: 119, vx: 0, vy: -180, r: 4 };
  stepBreaker(s, 1 / 30, input(), seeded(1));
  assert.equal(s.bricks.length, 2);
  assert.equal(s.bricks.find((b) => b.x === 244).hp, 1);
  assert.equal(s.destroyed, 3);
});

// ---------------------------------------------------------------------------------------------
// Determinism, hostile input, terminal state.
// ---------------------------------------------------------------------------------------------
function scripted(hz, level) {
  const { g } = open(level, { seed: 3 }),
    trace = [];
  for (let n = 0; n < hz * 24; n++) {
    const t = n / hz,
      phase = Math.floor(t * 2) % 4,
      keys = [['ArrowRight'], [], ['ArrowLeft'], ['ArrowLeft']][phase],
      press = n === 0 ? ['Space'] : Math.abs(t - 7) < 1e-9 ? ['ArrowDown'] : [];
    g.update(1 / hz, input(keys, press));
    if ((n + 1) % (hz / 2) === 0) trace.push(g.getState());
  }
  return trace;
}
test('30, 60 and 120 Hz play the same game', () => {
  for (const level of [1, 6, 14]) {
    const [slow, mid, fast] = HZS.map((hz) => scripted(hz, level));
    assert.equal(slow.length, 48);
    slow.forEach((a, i) => {
      for (const b of [mid[i], fast[i]]) {
        assert.equal(a.score, b.score);
        assert.equal(a.lives, b.lives);
        assert.equal(a.level, b.level);
        assert.equal(a.bricks.length, b.bricks.length);
        assert.ok(Math.abs(a.ball.x - b.ball.x) < 1e-6, `field ${level} step ${i}`);
        assert.ok(Math.abs(a.ball.y - b.ball.y) < 1e-6);
        assert.ok(Math.abs(a.paddle.x - b.paddle.x) < 1e-6);
      }
    });
  }
});
test('the same seed replays identically', () => {
  assert.deepEqual(scripted(60, 6), scripted(60, 6));
});
test('hostile frame times and pointer values keep the state finite and in bounds', () => {
  const times = [NaN, Infinity, -Infinity, -1, 0, 1e-12, 1e9, 0.5, '0.016', null, undefined, {}];
  const xs = [NaN, Infinity, -Infinity, 1e9, -5, '240', null, undefined, 'abc', 240];
  const { g } = open(5, { seed: 4 });
  g.update(1 / 60, input([], ['Space']));
  const before = g.getState().bricks.length;
  for (let n = 0; n < 600; n++) {
    const pointer = {
      x: xs[n % xs.length],
      y: xs[(n * 3) % xs.length],
      down: n % 3 !== 0,
      clicked: n % 7 === 0,
    };
    g.update(times[n % times.length], input([], n % 5 ? [] : ['Space'], pointer));
    g.update(1 / 60, input(n % 2 ? ['ArrowLeft'] : ['ArrowRight'], [], pointer));
    const s = g.getState();
    finiteDeep(s);
    assert.ok(s.ball.x >= 0 && s.ball.x <= 480 && s.ball.y >= 0 && s.ball.y < 400);
    assert.ok(s.paddle.x >= 0 && s.paddle.x <= 480);
    assert.ok(s.bricks.length <= before + 100);
  }
  const bare = { held: () => false, pressed: () => false };
  g.update(1 / 60, bare);
  const m = open(5, { launch: false }).g;
  m.update(1 / 60, bare);
  m.update(1 / 60, input([], [], { x: NaN, y: NaN, clicked: true }));
  assert.ok(m.getState().menu);
});
function playToEnd(policy, level, lang) {
  const { g, h } = open(level, { lang, seed: 2 }),
    rng = seeded(8),
    memory = { frame: 0, held: [] },
    history = [];
  for (; memory.frame < 60 * CLEAR_LIMIT && g.getState().phase === 'playing'; memory.frame++) {
    const now = g.getState();
    history.push(now);
    g.update(
      1 / 60,
      policy === 'bot'
        ? botFrame(now, history[Math.max(0, history.length - 1 - 15)])
        : POLICIES[policy](rng, memory),
    );
  }
  return { g, h };
}
test('winning and losing each report once, in both languages, then freeze', () => {
  const words = {
    en: { won: 'All orbital fields cleared!', lost: 'Out of balls. The stars await another try.' },
    zh: { won: '所有轨道砖阵已清除！', lost: '小球用完了，再次挑战星空吧。' },
  };
  for (const lang of ['en', 'zh'])
    for (const [kind, policy, level] of [
      ['won', 'bot', LEVEL_COUNT],
      ['lost', 'mash', 3],
    ]) {
      const { g, h } = playToEnd(policy, level, lang);
      assert.equal(g.getState().phase, kind);
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, kind === 'won');
      assert.equal(h.ends[0].message, words[lang][kind]);
      assert.equal(h.ends[0].score, g.getState().score);
      assert.ok(h.sounds.includes(kind === 'won' ? 'win' : 'lose'));
      const frozen = g.getState();
      for (let i = 0; i < 120; i++)
        g.update(1 / 60, input(['ArrowLeft'], ['Space', 'ArrowDown'], { x: 10, down: true }));
      g.update(NaN, input());
      assert.deepEqual(g.getState(), frozen);
      assert.equal(h.ends.length, 1);
    }
});

// ---------------------------------------------------------------------------------------------
// Drawing: every screen is complete in both languages and fits the 480 x 320 canvas.
// ---------------------------------------------------------------------------------------------
function textCanvas() {
  const ctx = mockContext(),
    drawn = [];
  ctx.fillText = (text, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 12);
    drawn.push({ text: String(text), x, y, size, align: ctx.textAlign });
  };
  return { ctx, drawn };
}
const widthOf = (text, size) =>
  [...text].reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62), 0);
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    if (text.length === 1) continue;
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
function assertLanguage(drawn, lang) {
  for (const { text } of drawn)
    if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
    else assert.doesNotMatch(text, /[A-Za-z]{3,}/, `Chinese screen shows "${text}"`);
}
test('every opening screen shows its name and tip, fits, and is localized', () => {
  for (const lang of ['en', 'zh'])
    for (const n of FIELDS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} field ${n}`);
      assertLanguage(drawn, lang);
      const spec = LEVELS[n - 1];
      assert.ok(drawn.some((d) => d.text === spec.name[lang]));
      assert.equal(
        drawn
          .filter((d) => d.size === 11 && d.y >= 206 && d.y < 250)
          .map((d) => d.text)
          .join(lang === 'en' ? ' ' : ''),
        spec.tip[lang],
      );
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'SPACE / TAP TO LAUNCH' : '空格 / 点击发球')),
      );
    }
});
test('the select screen, hud and upgrades fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, LEVEL_COUNT]) {
      const { g } = open(unlocked, { lang, launch: false }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A FIELD' : '选择区域')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')) ||
          unlocked === LEVEL_COUNT,
      );
    }
    const { g } = open(14, { lang }),
      { ctx, drawn } = textCanvas();
    for (let n = 0; n < 60 * 20; n++) {
      const now = g.getState();
      if (now.phase !== 'playing') break;
      g.update(1 / 60, botFrame(now, now));
      if (n === 30) g.update(1 / 60, input([], ['ArrowDown']));
      if (n % 25 === 0) g.draw(ctx);
    }
    assertFits(drawn, `${lang} play`);
    assertLanguage(drawn, lang);
    assert.ok(drawn.some((d) => d.text.startsWith(lang === 'en' ? 'FIELD 14/' : '区域 14/')));
  }
});
test('every field draws its bricks, upgrades and catch ring without error', () => {
  const ctx = mockContext();
  for (const n of FIELDS) {
    const s = createBreakerState(n),
      { g } = open(n);
    g.draw(ctx);
    stepBreaker(s, 1 / 60, input([], ['Space']), seeded(1));
    assert.ok(s.bricks.every((b) => b.maxHp >= b.hp));
  }
  const { g } = open(2);
  g.update(1 / 60, input([], ['Space']));
  g.update(1 / 60, input([], ['ArrowDown']));
  g.draw(ctx);
  assert.ok(g.getState().catchReady > 0);
  const s = g.getState();
  assert.equal(s.status.en, `Field 2/${LEVEL_COUNT} · 3 balls`);
  assert.equal(s.status.zh, `区域 2/${LEVEL_COUNT} · 3 个球`);
});
test('text wrapping breaks at spaces, by glyph for Chinese, and splits unbroken words', () => {
  assert.deepEqual(wrapText('aaa bbb ccc', 10, 40), ['aaa', 'bbb', 'ccc']);
  assert.deepEqual(wrapText('一二三四五六', 10, 30), ['一二三', '四五六']);
  assert.deepEqual(wrapText('abcdefghij', 10, 30), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapText('', 10), []);
  for (const f of LEVELS)
    for (const lang of ['en', 'zh']) {
      const lines = wrapText(f.tip[lang], 11);
      assert.ok(lines.length <= 3, `${f.name.en} ${lang}`);
    }
});
test('touch controls cover launch, steering, catch and the select screen', () => {
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'ArrowDown'])
    assert.ok(codes.includes(code));
  assert.ok(meta.touch);
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en)));
  const { g } = open(5, { launch: false });
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['ArrowDown']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().menu, null);
});
