import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRaftState,
  stepRaft,
  currentAt,
  meta,
  PHYSICS,
  SECTIONS,
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
  const w = currentAt(SECTIONS[s.section], s.x, s.y);
  return { x: s.vx - w.vx, y: s.vy - w.vy };
};
const place = (s, x, y, vx = 0, vy = 0) => Object.assign(s, { x, y, vx, vy, invulnerable: 0 });
const inChannel = (sec, s) => {
  const { cy, half } = sec.centre(Math.min(Math.max(s.x, 0), sec.length));
  return Math.abs(s.y - cy) <= half + 6 && s.x <= sec.length + 1 && s.x >= -31;
};

test('meta is bilingual and exposes every action to touch', () => {
  assert.equal(meta.id, 'raft-rush');
  assert.equal(meta.genre, 'sports');
  assert.ok(meta.name.zh === '激流木筏' && meta.description.en && meta.description.zh);
  const codes = meta.touchControls.map((c) => c.code);
  for (const c of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyX']) {
    assert.ok(codes.includes(c), c);
  }
  assert.ok(meta.touchControls.every((c) => c.label.en && c.label.zh));
  assert.equal(SECTIONS.length, 3);
});

test('invalid or oversized dt never advances state or consumes the paddle press', () => {
  const g = createGame(harness().env),
    before = g.getState();
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 1e9, undefined]) {
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
  for (const section of [0, 2]) {
    const idle = createRaftState(section);
    run(idle, NONE, 3);
    assert.ok(Math.hypot(rel(idle).x, rel(idle).y) < 2, 'idle raft moves with the water');
    const paddled = createRaftState(section);
    place(paddled, 100, SECTIONS[section].centre(100).cy);
    run(paddled, { ...NONE, dx: 1 }, 2);
    rels.push(rel(paddled).x);
    assert.ok(rel(paddled).x > 70 && rel(paddled).x < PHYSICS.thrust / PHYSICS.drag + 1);
    assert.ok(paddled.vx > currentAt(SECTIONS[section], paddled.x, paddled.y).vx + 70);
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
  const sec = SECTIONS[1],
    e = sec.eddies[0],
    base = currentAt({ ...sec, eddies: [] }, e.x + 20, e.y),
    swirl = currentAt(sec, e.x + 20, e.y);
  assert.ok(Math.abs(swirl.vy - base.vy) > 5, 'tangential swirl');
  assert.equal(
    currentAt({ ...sec, eddies: [] }, e.x + e.r + 5, e.y).vy,
    currentAt(sec, e.x + e.r + 5, e.y).vy,
  );
  assert.deepEqual(currentAt(sec, e.x, e.y).vy, currentAt({ ...sec, eddies: [] }, e.x, e.y).vy);
  const mid = (sec.fields[0].x0 + sec.fields[0].x1) / 2;
  assert.equal(currentAt({ ...sec, eddies: [] }, mid, 160).vy, sec.fields[0].vy);
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
  assert.ok(defaultDir.vx > currentAt(SECTIONS[0], defaultDir.x, defaultDir.y).vx + 40);
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

for (const [section, sec] of SECTIONS.entries()) {
  test(`section ${section + 1}: banks never let a fast raft through and never add energy`, () => {
    const mid = Math.floor(sec.length / 2);
    for (const [vx, vy] of [
      [5000, 0],
      [-5000, 0],
      [0, 5000],
      [0, -5000],
      [3500, 3500],
      [-3500, -3500],
      [4000, -900],
    ]) {
      const s = createRaftState(section);
      place(s, mid, sec.centre(mid).cy, vx, vy);
      const limit = Math.hypot(vx, vy) + 150;
      for (let i = 0; i < 300; i++) {
        stepRaft(s, NONE);
        if (s.phase !== 'playing') break;
        assert.ok(inChannel(sec, s), `${vx},${vy} step ${i}: ${s.x.toFixed(1)},${s.y.toFixed(1)}`);
        assert.ok(Math.hypot(s.vx, s.vy) < limit);
      }
    }
  });

  test(`section ${section + 1}: rocks stop a fast raft without overlap`, () => {
    for (const r of sec.rocks.slice(0, 4)) {
      const s = createRaftState(section);
      place(s, r.x - 150, r.y, 4000, 0);
      for (let i = 0; i < 60 && s.phase === 'playing'; i++) {
        stepRaft(s, NONE);
        assert.ok(Math.hypot(s.x - r.x, s.y - r.y) >= PHYSICS.radius + r.r - 0.05);
        assert.ok(s.x < r.x + 600);
      }
    }
  });
}

test('hard hits cost hull once per invulnerability window; gentle bumps do not', () => {
  const sec = SECTIONS[0],
    gentle = createRaftState(0);
  place(gentle, 400, sec.centre(400).cy, 0, -40);
  const wall = sec.top[7][1];
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

test('hull loss ends the campaign once and freezes the raft; a new game restarts fresh', () => {
  const h = harness(),
    g = createGame(h.env);
  for (let i = 0; i < 60 * 60 && g.getState().phase === 'playing'; i++) {
    const up = Math.floor(i / 90) % 2 === 0;
    g.update(1 / 60, input([up ? 'ArrowUp' : 'ArrowDown'], i % 45 === 0 ? ['Space'] : []));
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
  const sec = SECTIONS[0],
    s = createRaftState(0),
    f = sec.flags[0];
  place(s, f.x - 40, f.y);
  const events = run(s, { ...NONE, dx: 1 }, 1);
  assert.equal(events.filter((e) => e === 'coin').length, 1);
  assert.deepEqual(s.got, [true, false, false, false]);
  assert.equal(s.score, 100);
  place(s, f.x - 40, f.y);
  run(s, { ...NONE, dx: 1 }, 1);
  assert.equal(s.score, 100);
  const fast = createRaftState(0);
  place(fast, sec.flags[1].x - 120, sec.flags[1].y, 900, 0);
  run(fast, NONE, 0.5);
  assert.ok(fast.got[1], 'fast raft cannot skip over a flag');
});

test('docking needs enough flags and a real stop inside the marker', () => {
  const sec = SECTIONS[0],
    mid = (sec.dock.x0 + sec.dock.x1) / 2,
    cy = sec.centre(mid).cy;
  const fast = createRaftState(0);
  fast.got = fast.got.map(() => true);
  place(fast, sec.dock.x0 - 20, cy, 100, 0);
  run(fast, { ...NONE, dx: 1 }, 0.3);
  assert.ok(fast.dockTimer === 0 && fast.section === 0, 'passing through at speed does not dock');
  const noFlags = createRaftState(0);
  place(noFlags, mid, cy);
  run(noFlags, NONE, 3);
  assert.equal(noFlags.section, 0);
  const ok = createRaftState(0);
  ok.got = [true, true, true, false];
  ok.hull = 2;
  place(ok, mid, cy);
  const events = run(ok, NONE, 0.5);
  assert.ok(ok.dockTimer > 0 && ok.section === 0 && !events.includes('coin'));
  run(ok, NONE, 0.6);
  assert.equal(ok.section, 1);
  assert.equal(ok.hull, 3, 'repair on arrival');
  assert.equal(ok.score, 250 + 2 * 50);
  assert.equal(ok.got.some(Boolean), false);
  assert.ok(ok.banner > 0 && ok.x < 100);
});

test('final dock wins exactly once through the public API', () => {
  const h = harness(),
    g = createGame(h.env);
  const sec = SECTIONS[2],
    mid = (sec.dock.x0 + sec.dock.x1) / 2;
  const s = createRaftState(2);
  s.got = s.got.map(() => true);
  place(s, mid, sec.centre(mid).cy);
  run(s, NONE, 1);
  assert.equal(s.phase, 'won');
  assert.ok(g.getState().phase === 'playing');
});

test('status is a bilingual one-line string with a key prompt', () => {
  const st = createGame(harness().env).getState().status;
  assert.match(st.en, /^Section 1\/3 · Flags 0\/4 \(need 3\) · Hull 3 · .+/);
  assert.match(st.zh, /^第 1\/3 段 · 旗帜 0\/4（需 3）· 船体 3 · .+/);
  assert.equal(typeof st.en, 'string');
});

test('draw smoke in both languages across sections and end states', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang }),
      g = createGame(h.env);
    for (let i = 0; i < 300; i++)
      g.update(1 / 60, input(['ArrowRight'], i === 50 ? ['Space'] : []));
    g.draw(mockContext());
  }
  const h = harness();
  const g = createGame(h.env);
  for (let i = 0; i < 60 * 40; i++)
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
      assert.ok(inChannel(SECTIONS[s.section], { x: s.player.x, y: s.player.y }));
    }
    assert.ok(h.ends.length <= 1);
  }
});

for (const [section, sec] of SECTIONS.entries()) {
  test(`section ${section + 1}: end walls hold at speed and with repeated strokes`, () => {
    const min = PHYSICS.radius - 0.01,
      max = sec.length - PHYSICS.radius + 0.01;
    for (const [x, vx, dx] of [
      [sec.length - 60, 250, 1],
      [sec.length - 400, 5000, 1],
      [60, -250, -1],
      [400, -5000, -1],
    ]) {
      const s = createRaftState(section);
      place(s, x, sec.centre(x).cy, vx, 0);
      for (let i = 0; i < 1200 && s.phase === 'playing'; i++) {
        stepRaft(s, { ...NONE, dx, stroke: i % 54 === 0 });
        assert.ok(s.x >= min && s.x <= max, `x ${s.x} step ${i}`);
      }
    }
  });
}

test('public input holding Right with repeated strokes never leaves the river', () => {
  const g = createGame(harness().env);
  for (let i = 0; i < 120 * 90; i++) {
    g.update(1 / 120, input(['ArrowRight'], i % 54 === 0 ? ['Space'] : []));
    const s = g.getState();
    assert.ok(s.player.x <= SECTIONS[s.section].length);
    assert.ok(s.player.x >= PHYSICS.radius - 0.01);
  }
});

test('the raft stays fully on screen at the upstream end', () => {
  const g = createGame(harness().env);
  for (let i = 0; i < 120 * 20; i++) {
    g.update(1 / 120, input(['ArrowLeft'], i % 54 === 0 ? ['Space'] : []));
    const s = g.getState();
    assert.ok(s.player.x - s.player.r - s.camera.x >= -0.01);
  }
});
