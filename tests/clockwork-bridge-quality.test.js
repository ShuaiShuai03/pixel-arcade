import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createMachine, stepMachine } from '../src/games/clockwork-bridge.js';
import { harness, input, mockContext, seeded } from './harness.js';

const MAX_WAIT = 20;

// Public-input driver: works on a game or on a raw machine state.
export function makeDriver(source, hz) {
  const dt = 1 / hz;
  const api =
    typeof source.update === 'function'
      ? source
      : { update: (d, i) => stepMachine(source, d, i), getState: () => source };
  const driver = {
    api,
    time: 0,
    frame(held = [], pressed = []) {
      api.update(dt, input(held, pressed));
      driver.time += dt;
    },
    state: () => api.getState(),
    until(cond, held = [], pressedFirst = [], max = MAX_WAIT) {
      let first = true;
      for (let t = 0; t < max; t += dt) {
        if (cond(driver.state())) return true;
        driver.frame(held, first ? pressedFirst : []);
        first = false;
      }
      const s = driver.state();
      assert.ok(
        cond(s),
        `driver timed out: ${JSON.stringify({ l: s.level, p: s.player, b: s.bridges.map((b) => [b.p, b.target, b.jam]), m: s.message })}`,
      );
      return true;
    },
    walkTo(x, tol = 1.5) {
      const cx = () => driver.state().player.x + 7;
      const dir = cx() < x ? 'ArrowRight' : 'ArrowLeft';
      driver.until(
        (s) => (dir === 'ArrowRight' ? s.player.x + 7 >= x - tol : s.player.x + 7 <= x + tol),
        [dir],
      );
      driver.frame();
      driver.until((s) => Math.abs(s.player.vx) < 1e-9 || true);
    },
    tap(code) {
      driver.frame([], [code]);
    },
    settle(bridgeIds, ps) {
      driver.until((s) =>
        bridgeIds.every((id, n) => s.bridges[id].p === ps[n] && s.bridges[id].target === ps[n]),
      );
    },
    jumpRightUntil(x) {
      driver.until((s) => s.player.x + 7 >= x, ['ArrowRight'], ['Space']);
    },
  };
  return driver;
}

export function solveMachine(d, level) {
  const st = () => d.state();
  const crank = () => {
    d.frame([], ['KeyX']);
    d.frame();
  };
  const takeKey = () => {
    d.until((s) => s.player.x + 7 >= st().keys[0].x + 4 - 1, ['ArrowRight']);
    d.frame([], ['KeyZ']);
    assert.ok(st().keys.some((k) => k.state === 'carried'));
  };
  const unlockAndExit = (doorX) => {
    d.walkTo(doorX);
    d.frame([], ['KeyZ']);
    d.until((s) => s.level !== level || s.phase !== 'playing', ['ArrowRight']);
  };
  if (level === 1) {
    takeKey();
    d.walkTo(132);
    if (st().bridges[0].target === 1) {
      crank();
      d.settle([0], [0]);
    }
    d.walkTo(160);
    crank();
    d.settle([0], [1]);
    d.walkTo(360);
    d.jumpRightUntil(425);
    unlockAndExit(440);
  } else if (level === 2) {
    takeKey();
    d.walkTo(92);
    if (st().bridges[0].target === 1) {
      crank();
      d.settle([0], [0]);
    }
    d.walkTo(120);
    crank();
    d.settle([0], [1]);
    d.walkTo(158);
    d.jumpRightUntil(185);
    d.walkTo(240);
    if (st().bridges[1].target === 1) {
      crank();
      d.settle([1], [0]);
    }
    d.walkTo(268);
    crank();
    d.settle([1], [1]);
    d.walkTo(440);
    unlockAndExit(440);
  } else {
    takeKey();
    d.walkTo(88);
    if (st().bridges[0].target === 1) {
      crank();
      d.settle([0], [0]);
    }
    d.walkTo(112);
    crank();
    d.settle([0], [1]);
    d.walkTo(250);
    if (st().bridges[1].target === 1) {
      crank();
      d.settle([1, 2], [0, 0]);
    }
    d.walkTo(335);
    crank();
    d.settle([1], [1]);
    d.walkTo(376);
    d.jumpRightUntil(395);
    d.walkTo(398);
    d.jumpRightUntil(446);
    unlockAndExit(446);
  }
}

for (const hz of [30, 60, 120]) {
  test(`campaign victory through public input at ${hz} Hz`, () => {
    const h = harness();
    const g = createGame(h.env);
    const d = makeDriver(g, hz);
    for (let level = 1; level <= 3; level++) {
      assert.equal(g.getState().level, level);
      solveMachine(d, level);
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(g.getState().lives, 5);
  });
}

const GEAR_COUNTS = [2, 4, 4];
for (let level = 1; level <= 3; level++) {
  test(`machine ${level}: every settled gear configuration has a working escape route`, () => {
    const n = GEAR_COUNTS[level - 1];
    for (let mask = 0; mask < 1 << n; mask++) {
      const states = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
      for (const hz of [60, 120]) {
        const s = createMachine(level - 1, states);
        const d = makeDriver(s, hz);
        solveMachine(d, level);
        assert.equal(s.level, level === 3 ? 3 : level + 1, `mask ${mask} at ${hz} Hz`);
        assert.equal(s.cleared, 1);
        assert.equal(s.lives, 5, 'escape needs no falls');
      }
    }
  });
}

test('aligned scripted input is bit-identical at 30, 60 and 120 Hz', () => {
  const finals = [30, 60, 120].map((hz) => {
    const g = createGame(harness().env);
    const frames = hz * 6;
    for (let i = 0; i < frames; i++) {
      const sec = i / hz;
      const right = sec < 4.5;
      const pressed = [];
      if (i === 0) pressed.push('KeyZ');
      if (i === hz * 1.5) pressed.push('Space');
      if (i === hz * 3) pressed.push('KeyX');
      if (i === hz * 4) pressed.push('KeyZ');
      g.update(1 / hz, input(right ? ['ArrowRight'] : ['ArrowLeft'], pressed));
    }
    const st = g.getState();
    delete st.acc;
    return JSON.stringify(st);
  });
  assert.equal(finals[0], finals[1]);
  assert.equal(finals[1], finals[2]);
});

test('terminal win freezes state, ignores input and a new instance restarts fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  const d = makeDriver(g, 60);
  for (let level = 1; level <= 3; level++) solveMachine(d, level);
  const won = g.getState();
  assert.equal(won.phase, 'won');
  assert.equal(won.cleared, 3);
  assert.equal(won.score, 3 * 1000 + 200 * 3 + 500);
  const frozen = JSON.stringify(won);
  for (let i = 0; i < 200; i++) g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX', 'KeyZ']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.ok(h.sounds.includes('win'));
  g.draw(mockContext());
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.level, 1);
  assert.equal(fresh.score, 0);
});

test('seeded random play stays finite, bounded and never penetrates a solid', () => {
  const codes = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'];
  const actions = ['Space', 'KeyX', 'KeyZ'];
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const level of [0, 1, 2]) {
      const rnd = seeded(seed * 17 + level);
      const s = createMachine(level);
      let held = [];
      for (let i = 0; i < 6000 && s.phase === 'playing'; i++) {
        if (i % 20 === 0) held = rnd() < 0.3 ? [] : [codes[Math.floor(rnd() * 4)]];
        const pressed = rnd() < 0.05 ? [actions[Math.floor(rnd() * 3)]] : [];
        stepMachine(s, [1 / 30, 1 / 60, 1 / 120][seed % 3], input(held, pressed));
        const p = s.player;
        for (const v of [p.x, p.y, p.vx, p.vy]) assert.ok(Number.isFinite(v));
        const rects = [...s.solids, ...s.bridges];
        for (const r of rects) {
          const hit =
            p.x < r.x + r.w - 1e-6 &&
            p.x + p.w > r.x + 1e-6 &&
            p.y < r.y + r.h - 1e-6 &&
            p.y + p.h > r.y + 1e-6;
          assert.ok(!hit, `penetration seed ${seed} level ${level} step ${i}`);
        }
        for (const k of s.keys.filter((q) => q.state === 'floor')) {
          for (const r of rects) {
            const hit =
              k.x < r.x + r.w - 1e-6 &&
              k.x + k.w > r.x + 1e-6 &&
              k.y < r.y + r.h - 1e-6 &&
              k.y + k.h > r.y + 1e-6;
            assert.ok(!hit, 'key penetration');
          }
        }
        assert.ok(s.fx.length <= 48);
        assert.ok(s.lives >= 0 && s.lives <= 5);
      }
    }
  }
});

test('renderer handles jammed, carried-key, near-gear, unlocked and terminal states in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const level of [0, 1, 2]) {
      const h = harness({ lang });
      const s = createMachine(level);
      const g = createGame(h.env);
      const ctx = mockContext();
      g.draw(ctx);
      s.keys[0].state = 'carried';
      s.door.locked = false;
      s.bridges.forEach((b) => (b.jam = 'player'));
      s.bridges[0].target = 1;
      s.message = { en: 'x', zh: 'x', t: 1 };
      s.player.grounded = false;
      s.player.vx = 50;
      s.fx.push(
        { kind: 'spark', x: 1, y: 1, vx: 0, vy: 0, t: 1 },
        { kind: 'steam', x: 1, y: 1, vx: 0, vy: 0, t: 1 },
      );
      s.phase = 'lost';
      const g2 = { draw: g.draw };
      assert.doesNotThrow(() => g2.draw(ctx));
    }
  }
});
