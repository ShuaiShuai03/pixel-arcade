import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRaftState,
  stepRaft,
  currentAt,
  meta,
  PHYSICS,
  LEVELS,
} from '../src/games/raft-rush.js';
import { harness, input, mockContext, seeded } from './harness.js';

const STEP = PHYSICS.step;
const NONE = { dx: 0, dy: 0, stroke: false, brake: false };
const run = (s, ctl, seconds) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / STEP) && s.phase === 'playing'; i++) {
    events.push(...stepRaft(s, i === 0 ? ctl : { ...ctl, stroke: false }));
  }
  return events;
};
const rel = (s) => {
  const w = currentAt(LEVELS[s.index], s.x, s.y);
  return { x: s.vx - w.vx, y: s.vy - w.vy };
};
const place = (s, x, y, vx = 0, vy = 0) => Object.assign(s, { x, y, vx, vy, invulnerable: 0 });
const inChannel = (level, s) => {
  const { cy, half } = level.centre(Math.min(Math.max(s.x, 0), level.length));
  return Math.abs(s.y - cy) <= half + 6 && s.x <= level.length + 1 && s.x >= -31;
};
const LAST = LEVELS.length - 1;

test('meta is bilingual, exposes every action to touch and never binds host keys', () => {
  assert.equal(meta.id, 'raft-rush');
  assert.equal(meta.genre, 'sports');
  assert.ok(meta.name.zh === '激流木筏' && meta.description.en && meta.description.zh);
  const codes = meta.touchControls.map((c) => c.code);
  for (const c of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyX']) {
    assert.ok(codes.includes(c), c);
  }
  assert.ok(meta.touchControls.every((c) => c.label.en && c.label.zh));
  for (const reserved of ['KeyR', 'Escape', 'KeyP']) assert.ok(!codes.includes(reserved));
  assert.equal(LEVELS.length, 20);
  assert.match(meta.description.en, /twenty/);
  assert.match(meta.description.zh, /二十/);
});

test('invalid or oversized dt never advances state or consumes the paddle press', () => {
  const g = createGame(harness().env),
    before = g.getState();
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 1e9, undefined, null, '0.016']) {
    g.update(dt, input(['ArrowRight', 'Space'], ['Space']));
    assert.deepEqual(g.getState(), before, String(dt));
  }
  g.update(1 / 60, input(['Space'], ['Space']));
  assert.ok(g.getState().stamina < PHYSICS.staminaMax, 'press was not consumed by invalid updates');
});

test('state is identical at 30, 60 and 120 Hz for aligned input', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness().env);
    for (let i = 0; i < hz * 12; i++) {
      const ms = Math.round((i * 1000) / hz);
      const held = [ms % 3000 < 1500 ? 'ArrowDown' : 'ArrowUp', 'ArrowRight'];
      if (ms % 4000 >= 3000) held.push('KeyX');
      g.update(1 / hz, input(held, ms === 2000 || ms === 7000 ? ['Space'] : []));
    }
    return g.getState();
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
  assert.ok(states[2].stamina < PHYSICS.staminaMax + 1e-9 && states[2].player.x > 100);
});

test('drag settles toward the water; paddle force composes additively with the current', () => {
  const rels = [];
  for (const index of [0, 14]) {
    const idle = createRaftState(index);
    run(idle, NONE, 3);
    assert.ok(Math.hypot(rel(idle).x, rel(idle).y) < 2, 'idle raft moves with the water');
    const paddled = createRaftState(index);
    place(paddled, 100, LEVELS[index].centre(100).cy);
    run(paddled, { ...NONE, dx: 1 }, 2);
    rels.push(rel(paddled).x);
    assert.ok(rel(paddled).x > 70 && rel(paddled).x < PHYSICS.thrust / PHYSICS.drag + 1);
    assert.ok(paddled.vx > currentAt(LEVELS[index], paddled.x, paddled.y).vx + 70);
  }
  assert.ok(Math.abs(rels[0] - rels[1]) < 6, 'paddle response does not depend on current speed');
  const diagonal = createRaftState(0);
  run(diagonal, { ...NONE, dx: 1, dy: 1 }, 1);
  const straight = createRaftState(0);
  run(straight, { ...NONE, dx: 1 }, 1);
  assert.ok(
    Math.hypot(rel(diagonal).x, rel(diagonal).y) < rel(straight).x + 4,
    'diagonals are normalised',
  );
});

test('eddies and cross-current fields are additive water motion', () => {
  const level = LEVELS[5],
    e = level.eddies[0],
    bare = { ...level, eddies: [] },
    swirl = currentAt(level, e.x + 20, e.y);
  assert.ok(Math.abs(swirl.vy - currentAt(bare, e.x + 20, e.y).vy) > 5, 'tangential swirl');
  assert.equal(currentAt(bare, e.x + e.r + 5, e.y).vy, currentAt(level, e.x + e.r + 5, e.y).vy);
  assert.equal(currentAt(level, e.x, e.y).vy, currentAt(bare, e.x, e.y).vy);
  const side = LEVELS[4],
    f = side.fields[0];
  assert.equal(currentAt(side, (f.x0 + f.x1) / 2, 160).vy, f.vy);
  const weir = LEVELS[3],
    back = weir.fields[0];
  assert.ok(currentAt(weir, (back.x0 + back.x1) / 2, 160).vx < 0, 'the weir reverses the water');
});

test('strong paddle is a finite stroke with stamina cost, cooldown and regeneration', () => {
  const plain = createRaftState(0),
    stroked = createRaftState(0);
  run(plain, { ...NONE, dx: 1 }, 0.4);
  const events = run(stroked, { ...NONE, dx: 1, stroke: true }, 0.4);
  assert.ok(events.includes('move'));
  assert.ok(rel(stroked).x > rel(plain).x + 40);
  assert.ok(stroked.stamina < PHYSICS.staminaMax - 20);
  const second = run(stroked, { ...NONE, dx: 1, stroke: true }, 0.05);
  assert.ok(!second.includes('move'), 'cooldown blocks an immediate second stroke');
  const empty = createRaftState(0);
  empty.stamina = 10;
  assert.ok(!run(empty, { ...NONE, stroke: true }, 0.02).includes('move'));
  run(empty, NONE, 2);
  assert.ok(empty.stamina > 50, 'stamina regenerates');
  const defaultDir = createRaftState(0);
  run(defaultDir, { ...NONE, stroke: true }, 0.3);
  assert.ok(defaultDir.vx > currentAt(LEVELS[0], defaultDir.x, defaultDir.y).vx + 40);
});

test('a paddle press during the cooldown or low stamina is buffered, then expires', () => {
  const s = createRaftState(0);
  assert.ok(run(s, { ...NONE, stroke: true }, 0.02).includes('move'));
  run(s, NONE, PHYSICS.strokeBuffer);
  const early = run(s, { ...NONE, stroke: true }, PHYSICS.strokeCooldown);
  assert.ok(early.includes('move'), 'the early press fires once the cooldown ends');
  const late = createRaftState(0);
  late.stamina = 10;
  run(late, { ...NONE, stroke: true }, 0.02);
  const fired = run(late, NONE, PHYSICS.strokeBuffer / 2 + 1.2);
  assert.ok(!fired.includes('move'), 'a stale press does not fire once the buffer is over');
  const soon = createRaftState(0);
  soon.stamina = PHYSICS.strokeCost - 2;
  run(soon, { ...NONE, stroke: true }, 0.02);
  assert.ok(run(soon, NONE, 0.2).includes('move'), 'a press waits for stamina inside the buffer');
});

test('brake pulls the raft toward the water speed faster than drag', () => {
  const a = createRaftState(0),
    b = createRaftState(0);
  run(a, { ...NONE, dx: 1, stroke: true }, 0.5);
  Object.assign(b, { vx: a.vx, vy: a.vy, x: a.x, y: a.y });
  run(a, NONE, 0.4);
  run(b, { ...NONE, brake: true }, 0.4);
  assert.ok(Math.abs(rel(b).x) < Math.abs(rel(a).x) / 2);
});

test('braking into a fast dock stops sooner than coasting', () => {
  for (const index of [1, 10, 18, 19]) {
    const level = LEVELS[index],
      overshoot = [false, true].map((brake) => {
        const s = createRaftState(index),
          y = level.centre(level.dock.x0).cy;
        s.got = s.got.map(() => true);
        place(s, level.dock.x0 - 200, y, currentAt(level, level.dock.x0 - 200, y).vx, 0);
        let farthest = 0;
        for (let i = 0; i < 120 * 12 && s.phase === 'playing' && s.index === index; i++) {
          const braking = brake && s.x > level.dock.x0 - 150 && Math.hypot(s.vx, s.vy) > 26;
          stepRaft(s, { ...NONE, brake: braking });
          farthest = Math.max(farthest, s.x);
        }
        return farthest;
      });
    assert.ok(overshoot[1] < overshoot[0] - 10, `level ${index + 1}: ${overshoot}`);
  }
});

for (const [index, level] of LEVELS.entries()) {
  test(`level ${index + 1}: banks never let a fast raft through and never add energy`, () => {
    const mid = Math.floor(level.length / 2);
    for (const [vx, vy] of [
      [5000, 0],
      [-5000, 0],
      [0, 5000],
      [0, -5000],
      [3500, 3500],
      [-3500, -3500],
    ]) {
      const s = createRaftState(index);
      place(s, mid, level.centre(mid).cy, vx, vy);
      const limit = Math.hypot(vx, vy) + 150;
      for (let i = 0; i < 300; i++) {
        stepRaft(s, NONE);
        if (s.phase !== 'playing') break;
        assert.ok(
          inChannel(level, s),
          `${vx},${vy} step ${i}: ${s.x.toFixed(1)},${s.y.toFixed(1)}`,
        );
        assert.ok(Math.hypot(s.vx, s.vy) < limit);
      }
    }
  });

  test(`level ${index + 1}: rocks stop a fast raft without overlap and end walls hold`, () => {
    for (const r of level.rocks.slice(0, 4)) {
      const s = createRaftState(index);
      place(s, r.x - 150, r.y, 4000, 0);
      for (let i = 0; i < 60 && s.phase === 'playing'; i++) {
        stepRaft(s, NONE);
        assert.ok(Math.hypot(s.x - r.x, s.y - r.y) >= PHYSICS.radius + r.r - 0.05);
        assert.ok(s.x < r.x + 600);
      }
    }
    const min = PHYSICS.radius - 0.01,
      max = level.length - PHYSICS.radius + 0.01;
    for (const [x, vx, dx] of [
      [level.length - 60, 250, 1],
      [60, -250, -1],
    ]) {
      const s = createRaftState(index);
      place(s, x, level.centre(x).cy, vx, 0);
      for (let i = 0; i < 600 && s.phase === 'playing'; i++) {
        stepRaft(s, { ...NONE, dx, stroke: i % 54 === 0 });
        assert.ok(s.x >= min && s.x <= max, `x ${s.x} step ${i}`);
      }
    }
  });
}

test('hard hits cost hull once per invulnerability window; gentle bumps do not', () => {
  const level = LEVELS[0],
    gentle = createRaftState(0);
  place(gentle, 400, level.centre(400).cy, 0, -40);
  const wall = level.top[7][1];
  gentle.y = wall + 14;
  run(gentle, NONE, 0.5);
  assert.equal(gentle.hull, 3);
  assert.ok(gentle.bump > 0 || gentle.y > wall);
  const hard = createRaftState(0);
  place(hard, 400, wall + 30, 0, -400);
  const events = run(hard, NONE, 0.6);
  assert.equal(hard.hull, 2);
  assert.ok(events.includes('hit'));
  Object.assign(hard, { x: 400, y: wall + 30, vx: 0, vy: -400 });
  hard.invulnerable = 1;
  run(hard, NONE, 0.2);
  assert.equal(hard.hull, 2, 'invulnerable right after a hit');
  assert.ok(hard.invulnerable > 0);
});

test('mastery rivers break the hull on lighter bumps than the early rivers', () => {
  const bump = (index, speed) => {
    const level = LEVELS[index],
      s = createRaftState(index);
    place(s, 400, level.top[7][1] + 18, 0, -speed);
    run(s, NONE, 0.5);
    return s.hull;
  };
  assert.equal(bump(0, 80), 3);
  assert.equal(bump(19, 80), 2);
  assert.ok(LEVELS[19].safeImpact < LEVELS[0].safeImpact);
});

test('hull loss ends the campaign once and freezes the raft; a new game restarts fresh', () => {
  const h = harness(),
    store = { unlocked: () => 20, unlock() {} },
    g = createGame({ ...h.env, progress: store });
  g.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 60 * 90 && g.getState().phase === 'playing'; i++) {
    const dir = Math.floor(i / 50) % 2 ? 'ArrowUp' : 'ArrowDown';
    g.update(1 / 60, input(['ArrowRight', dir], i % 45 === 0 ? ['Space'] : []));
  }
  const dead = g.getState();
  assert.equal(dead.phase, 'lost');
  assert.equal(dead.hull, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /broke apart/);
  assert.ok(h.sounds.includes('hit') && h.sounds.includes('lose'));
  g.update(1 / 60, input(['ArrowDown', 'Space'], ['Space']));
  assert.deepEqual(g.getState(), dead);
  assert.equal(h.ends.length, 1);
  assert.match(dead.status.en, /broke apart/);
  assert.match(dead.status.zh, /解体/);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.hull, 3);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.level, 1);
});

test('each rescue flag counts once', () => {
  const level = LEVELS[0],
    s = createRaftState(0),
    f = level.flags[0];
  place(s, f.x - 40, f.y);
  const events = run(s, { ...NONE, dx: 1 }, 1);
  assert.equal(events.filter((e) => e === 'coin').length, 1);
  assert.deepEqual(s.got, [true, false, false, false]);
  assert.equal(s.score, 100);
  place(s, f.x - 40, f.y);
  run(s, { ...NONE, dx: 1 }, 1);
  assert.equal(s.score, 100);
  const fast = createRaftState(0);
  place(fast, level.flags[1].x - 120, level.flags[1].y, 900, 0);
  run(fast, NONE, 0.5);
  assert.ok(fast.got[1], 'fast raft cannot skip over a flag');
});

test('docking needs enough flags and a real stop inside the marker', () => {
  const level = LEVELS[0],
    mid = (level.dock.x0 + level.dock.x1) / 2,
    cy = level.centre(mid).cy;
  const fast = createRaftState(0);
  fast.got = fast.got.map(() => true);
  place(fast, level.dock.x0 - 20, cy, 100, 0);
  run(fast, { ...NONE, dx: 1 }, 0.3);
  assert.ok(fast.dockTimer === 0 && fast.index === 0, 'passing through at speed does not dock');
  const noFlags = createRaftState(0);
  place(noFlags, mid, cy);
  run(noFlags, NONE, 3);
  assert.equal(noFlags.index, 0);
  const ok = createRaftState(0);
  ok.got = [true, true, true, false];
  ok.hull = 2;
  place(ok, mid, cy);
  const events = run(ok, NONE, 0.5);
  assert.ok(ok.dockTimer > 0 && ok.index === 0 && !events.includes('coin'));
  const cleared = run(ok, NONE, 0.6);
  assert.ok(cleared.includes('clear'));
  assert.equal(ok.index, 1);
  assert.equal(ok.hull, 3, 'repair on arrival');
  assert.equal(ok.score, 250 + 100 + 2 * 50);
  assert.equal(ok.got.some(Boolean), false);
  assert.ok(ok.tip > 0 && ok.x < 100);
});

test('the last dock wins exactly once and the win freezes the state', () => {
  const level = LEVELS[LAST],
    mid = (level.dock.x0 + level.dock.x1) / 2,
    s = createRaftState(LAST);
  s.got = s.got.map(() => true);
  place(s, mid, level.centre(mid).cy);
  const events = run(s, NONE, 1.5);
  assert.equal(s.phase, 'won');
  assert.equal(events.filter((e) => e === 'win').length, 1);
  const frozen = JSON.stringify(s);
  assert.deepEqual(stepRaft(s, { ...NONE, dx: 1, stroke: true }), []);
  assert.equal(JSON.stringify(s), frozen);
});

test('status is a bilingual one-line string with a goal', () => {
  const st = createGame(harness().env).getState().status;
  assert.match(st.en, /^Level 1\/20 · Flags 0\/4 \(need 3\) · Hull 3 · .+/);
  assert.match(st.zh, /^第 1\/20 关 · 旗帜 0\/4（需 3）· 船体 3 · .+/);
  assert.equal(typeof st.en, 'string');
});

test('draw smoke in both languages across levels and end states', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang }),
      g = createGame(h.env);
    for (let i = 0; i < 300; i++)
      g.update(1 / 60, input(['ArrowRight'], i === 50 ? ['Space'] : []));
    g.draw(mockContext());
  }
  for (const index of [0, 5, 9, LAST]) {
    const s = createRaftState(index);
    s.got = s.got.map(() => true);
    s.hull = 1;
    run(s, { ...NONE, dx: 1 }, 1);
  }
  const g = createGame(harness().env);
  for (let i = 0; i < 60 * 90; i++)
    g.update(1 / 60, input(['ArrowUp'], i % 40 === 0 ? ['Space'] : []));
  g.draw(mockContext());
});

test('seeded random play stays finite, inside the channel and bounded', () => {
  for (const seed of [1, 2, 3]) {
    const h = harness({ seed }),
      g = createGame(h.env),
      rnd = seeded(seed);
    let held = [];
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 20 === 0) {
        held = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyX'].filter(
          () => rnd() < 0.3,
        );
      }
      g.update(1 / 60, input(held, rnd() < 0.03 ? ['Space'] : []));
      const s = g.getState();
      assert.ok(Object.values(s.player).every(Number.isFinite));
      assert.ok(inChannel(LEVELS[s.level - 1], { x: s.player.x, y: s.player.y }));
    }
    assert.ok(h.ends.length <= 1);
  }
});

test('holding Right with repeated strokes never leaves the river, and Left stays on screen', () => {
  const g = createGame(harness().env);
  for (let i = 0; i < 120 * 90; i++) {
    g.update(1 / 120, input(['ArrowRight'], i % 54 === 0 ? ['Space'] : []));
    const s = g.getState();
    assert.ok(s.player.x <= LEVELS[s.level - 1].length);
    assert.ok(s.player.x >= PHYSICS.radius - 0.01);
  }
  const back = createGame(harness().env);
  for (let i = 0; i < 120 * 20; i++) {
    back.update(1 / 120, input(['ArrowLeft'], i % 54 === 0 ? ['Space'] : []));
    const s = back.getState();
    assert.ok(s.player.x - s.player.r - s.camera.x >= -0.01);
  }
});
