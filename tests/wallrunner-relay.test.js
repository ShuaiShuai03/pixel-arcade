import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRunState,
  getCourse,
  meta,
  movementMode,
  padUnder,
  stepRun,
  wallContact,
} from '../src/games/wallrunner-relay.js';
import { harness, input, mockContext } from './harness.js';

const RIGHT = ['ArrowRight'];
const LEFT = ['ArrowLeft'];
const step = (s, held = [], pressed = [], dt = 1 / 120) => stepRun(s, dt, input(held, pressed));
const run = (s, seconds, held = [], dt = 1 / 120) => {
  for (let n = 0; n < Math.round(seconds / dt); n++) step(s, held, [], dt);
};
const place = (s, x, y, extra = {}) => {
  Object.assign(s.player, { x, y, vx: 0, vy: 0, ground: false, ...extra });
  return s;
};

test('wallrunner: metadata is bilingual and every action has a touch control', () => {
  assert.equal(meta.id, 'wallrunner-relay');
  assert.equal(meta.name.zh, '飞檐接力');
  assert.equal(meta.genre, 'action');
  assert.match(meta.description.zh, /\p{Script=Han}/u);
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX']) {
    const control = meta.touchControls.find((c) => c.code === code);
    assert.ok(control, code);
    assert.ok(control.label.en);
    assert.match(control.label.zh, /\p{Script=Han}/u);
  }
  for (const k of meta.keys) {
    assert.ok(k.label.en && k.label.zh && k.keys);
  }
});

test('wallrunner: zero, negative, NaN, infinite and huge dt never advance state or read input', () => {
  const h = harness(),
    g = createGame(h.env),
    before = structuredClone(g.getState());
  let reads = 0;
  const controls = {
    held() {
      reads++;
      return true;
    },
    pressed() {
      reads++;
      return true;
    },
    pointer: {},
  };
  for (const dt of [0, -1, -1e-9, NaN, Infinity, -Infinity, 5, 1e9]) g.update(dt, controls);
  assert.deepEqual(g.getState(), before);
  assert.equal(reads, 0);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});

test('wallrunner: a frame longer than one step is capped to the documented 1/30 second', () => {
  const a = createRunState(),
    b = createRunState();
  stepRun(a, 0.5, input(RIGHT));
  stepRun(b, 1 / 30, input(RIGHT));
  assert.equal(a.time.toFixed(6), (1 / 30).toFixed(6));
  assert.equal(a.player.x, b.player.x);
});

test('wallrunner: horizontal control accelerates finitely and opposite keys cancel', () => {
  const s = createRunState();
  step(s, RIGHT);
  assert.ok(s.player.vx > 0 && s.player.vx < 20);
  const n = createRunState(),
    x = n.player.x;
  step(n, [...LEFT, ...RIGHT]);
  assert.equal(n.player.vx, 0);
  assert.equal(n.player.x, x);
  run(s, 1, RIGHT);
  assert.ok(s.player.vx <= 110 + 1e-9);
});

test('wallrunner: held jump does not repeat, and jump height matches the published envelope', () => {
  const g = createGame(harness().env);
  g.update(1 / 60, input([], ['Space']));
  const jumps = g.getState().jumps;
  let top = g.getState().player.y;
  for (let n = 0; n < 120; n++) {
    g.update(1 / 60, input(['Space']));
    top = Math.min(top, g.getState().player.y);
  }
  const s = g.getState();
  assert.equal(jumps, 1);
  assert.equal(s.jumps, 1);
  const start = createRunState().player.y;
  const rise = start - top;
  assert.ok(Math.abs(rise - s.limits.jumpHeight) < 2, `rise ${rise}`);
});

test('wallrunner: jump buffer fires exactly once on landing, and coyote grace once per support exit', () => {
  for (const hz of [30, 60, 120]) {
    const dt = 1 / hz,
      s = createRunState();
    // Buffered jump: press shortly before touching down.
    place(s, 20, 200, { vy: 200 });
    let jumped = 0;
    for (let n = 0; n < hz && s.jumps === 0; n++) step(s, [], n === 0 ? ['Space'] : [], dt);
    jumped = s.jumps;
    assert.equal(jumped, 1, `buffer ${hz}`);
    for (let n = 0; n < hz; n++) step(s, [], [], dt);
    assert.equal(s.jumps, 1);
    // Walk off the first roof: grace allows one jump but never an air jump.
    const w = createRunState();
    place(w, 150, 222, { ground: true });
    for (let n = 0; n < hz * 3 && w.player.ground; n++) step(w, RIGHT, [], dt);
    assert.equal(w.player.ground, false);
    step(w, RIGHT, ['Space'], dt);
    assert.equal(w.jumps, 1, `coyote ${hz}`);
    step(w, RIGHT, ['Space'], dt);
    assert.equal(w.jumps, 1);
  }
  const late = createRunState();
  place(late, 199, 222, { ground: true });
  for (let n = 0; n < 240 && late.player.ground; n++) step(late, RIGHT);
  run(late, 0.15, RIGHT);
  step(late, RIGHT, ['Space']);
  assert.equal(late.jumps, 0);
});

test('wallrunner: falling at terminal speed lands on the visible roof instead of tunnelling', () => {
  const s = createRunState();
  place(s, 260, 100, { vy: 520 });
  for (let n = 0; n < 30; n++) stepRun(s, 1 / 30, input());
  const roof = 240;
  assert.equal(s.player.y + s.player.h, roof);
  assert.equal(s.player.vy, 0);
  assert.equal(s.player.ground, true);
});

test('wallrunner: wall-run needs X, real contact with a chalk face, and not pushing away', () => {
  const near = () => place(createRunState(), 390, 200); // touching the chalk face at x=400
  const s = near();
  assert.ok(wallContact(s.player, solidsOf(s)).chalk);
  step(s, RIGHT);
  assert.equal(s.player.running, false, 'no X');
  step(s, [...RIGHT, 'KeyX']);
  assert.equal(s.player.running, true);
  assert.ok(s.player.vy < 0);
  assert.equal(movementMode(s), 'run');
  const away = near();
  step(away, [...LEFT, 'KeyX']);
  assert.equal(away.player.running, false, 'pushing away detaches');
  const gap = place(createRunState(), 386, 200);
  step(gap, [...RIGHT, 'KeyX']);
  assert.equal(gap.player.running, false, 'a gap is not contact');
  assert.equal(wallContact(gap.player, solidsOf(gap)), null);
  const plain = place(createRunState(), 610, 125); // unmarked west face of the second roof
  assert.ok(wallContact(plain.player, solidsOf(plain)));
  assert.equal(wallContact(plain.player, solidsOf(plain)).chalk, false);
  step(plain, [...RIGHT, 'KeyX']);
  assert.equal(plain.player.running, false, 'unmarked wall');
  const above = place(createRunState(), 390, 60); // above the chalk, past the roof corner
  step(above, [...RIGHT, 'KeyX']);
  assert.equal(above.player.running, false);
});

test('wallrunner: wall-run ends at the top of the chalk and the runner lands on the roof', () => {
  const s = place(createRunState(), 390, 200, { approach: 110, approachTimer: 0.18 });
  step(s, [...RIGHT, 'KeyX']);
  for (let n = 0; n < 600 && s.player.running !== false; n++) step(s, [...RIGHT, 'KeyX']);
  for (let n = 0; n < 600 && !s.player.ground; n++) step(s, RIGHT);
  assert.equal(s.player.ground, true);
  assert.equal(s.player.y + s.player.h, 130);
  assert.ok(s.player.x > 400);
});

test('wallrunner: energy drains during wall-run and kicks, and refills only on relay pads', () => {
  const s = place(createRunState(), 390, 200);
  for (let n = 0; n < 60; n++) step(s, [...RIGHT, 'KeyX']);
  const spent = 100 - s.energy;
  assert.ok(spent > 3 && spent < 10, `spent ${spent}`);
  assert.ok(Math.abs(spent - s.spent.run) < 1e-9);
  assert.equal(s.refilled, 0);
  // Resting on an ordinary roof never restores energy.
  const roof = createRunState();
  roof.energy = 40;
  place(roof, 270, 222, { ground: true });
  run(roof, 2);
  assert.equal(roof.energy, 40);
  assert.equal(padUnder(roof), null);
  // The pad restores it at a bounded rate and stops at the cap.
  const pad = createRunState();
  pad.energy = 40;
  run(pad, 1);
  assert.ok(Math.abs(pad.energy - 65) < 0.01, `pad ${pad.energy}`);
  run(pad, 5);
  assert.equal(pad.energy, 100);
  assert.equal(pad.refilled.toFixed(6), '60.000000');
});

test('wallrunner: kicks need contact, cost energy, impart bounded velocity and lock the same face', () => {
  const free = createRunState();
  place(free, 300, 100);
  step(free, [], ['Space']);
  assert.equal(free.kicks, 0, 'no wall no kick');
  const s = place(createRunState(), 610, 150, { vy: 100 });
  step(s, RIGHT, ['Space']);
  assert.equal(s.kicks, 1);
  assert.equal(s.energy, 90);
  assert.equal(s.spent.kick, 10);
  assert.equal(s.player.vx < 0, true);
  const limit = createGame(harness().env).getState().limits.kickMaxRise;
  assert.ok(s.player.vx >= -150 - 1e-9);
  assert.ok(s.player.vy < 0 && s.player.vy >= -limit);
  // The same face cannot be kicked again until the runner touches another surface.
  place(s, 610, 150, { vy: 0 });
  step(s, RIGHT, ['Space']);
  assert.equal(s.kicks, 1);
  assert.equal(s.energy <= 90, true);
  // A falling runner cannot turn downward speed into a free upward bounce.
  const fall = place(createRunState(), 610, 150, { vy: 500 });
  step(fall, RIGHT, ['Space']);
  assert.ok(fall.player.vy > 0, `vy ${fall.player.vy}`);
});

test('wallrunner: kicks need more energy than their cost and slick faces refuse both kick and run', () => {
  const low = place(createRunState(), 610, 150);
  low.energy = 10;
  step(low, RIGHT, ['Space']);
  assert.equal(low.kicks, 0);
  assert.equal(low.energy, 10);
  const slick = place(createRunState(3), 140, 215);
  assert.equal(wallContact(slick.player, solidsOf(slick)).slick, true);
  step(slick, [...RIGHT, 'KeyX'], ['Space']);
  assert.equal(slick.kicks, 0);
  assert.equal(slick.player.running, false);
});

test('wallrunner: exhausting energy off a pad costs a life and returns to the last pad without free energy', () => {
  const s = place(createRunState(), 390, 200);
  s.energy = 0.05;
  for (let n = 0; n < 40 && s.lives === 4; n++) step(s, [...RIGHT, 'KeyX']);
  assert.equal(s.lives, 3);
  assert.equal(s.cause, 'energy');
  assert.equal(s.collapses, 1);
  assert.ok(s.energy < 0.2 && Math.abs(s.energy - s.refilled) < 1e-9, 'only pad refill');
  assert.ok(padUnder(s));
  assert.equal(s.player.ground, true);
  // Standing on the pad is the only way to recover.
  run(s, 1);
  assert.ok(Math.abs(s.energy - 25) < 0.3);
  assert.equal(s.phase, 'playing');
});

test('wallrunner: falling costs a life, respawns on the last pad, and pads only score once', () => {
  const s = createRunState();
  assert.equal(s.padsSeen.length, 1);
  place(s, 300, 400, { vy: 300 });
  step(s);
  assert.equal(s.lives, 3);
  assert.equal(s.cause, 'fall');
  assert.equal(s.falls, 1);
  const pad = padUnder(s);
  assert.equal(pad.id, 0);
  assert.equal(s.score, 0);
  place(s, 510, 100, { ground: false, vy: 100 });
  run(s, 0.5);
  assert.equal(s.checkpoint, 1);
  assert.equal(s.score, 50);
  place(s, 100, 222, { ground: true });
  run(s, 0.3);
  place(s, 510, 100, { vy: 100 });
  run(s, 0.5);
  assert.equal(s.score, 50, 'pad credit is not farmable');
});

test('wallrunner: touching the beacon clears the course, carries energy and starts the next course', () => {
  const s = createRunState();
  s.energy = 80;
  place(s, 975, 40, { ground: false });
  step(s);
  assert.equal(s.course, 2);
  assert.equal(s.score, 300 + 160);
  assert.ok(Math.abs(s.energy - 80) < 0.2);
  assert.equal(s.courseTimes.length, 1);
  assert.equal(s.checkpoint, 0);
  assert.equal(s.lives, 4);
  assert.ok(s.banner > 0);
  assert.ok(padUnder(s));
  const last = createRunState(3);
  place(last, 603, -178);
  step(last);
  assert.equal(last.phase, 'won');
});

test('wallrunner: terminal loss fires once, freezes state, ignores input; restart is fresh', () => {
  const h = harness(),
    g = createGame(h.env);
  for (let n = 0; n < 4000 && h.ends.length === 0; n++) g.update(1 / 30, input(RIGHT));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /fell/);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(g.getState().lives, 0);
  const frozen = structuredClone(g.getState());
  let reads = 0;
  g.update(1 / 30, {
    held() {
      reads++;
      return true;
    },
    pressed() {
      reads++;
      return true;
    },
    pointer: {},
  });
  assert.equal(reads, 0);
  assert.deepEqual(g.getState(), frozen);
  assert.equal(h.ends.length, 1);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.lives, 4);
  assert.equal(fresh.course, 1);
  assert.equal(fresh.energy, 100);
  assert.equal(fresh.score, 0);
});

test('wallrunner: Chinese terminal and status text is localized', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  for (let n = 0; n < 4000 && h.ends.length === 0; n++) g.update(1 / 30, input(RIGHT));
  assert.match(h.ends[0].message, /\p{Script=Han}/u);
  assert.match(g.getState().status.zh, /赛道/);
  assert.match(g.getState().status.en, /Course/);
});

test('wallrunner: snapshots are JSON-safe, detached from internals and describe the course', () => {
  const g = createGame(harness().env),
    a = g.getState();
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  a.energy = -5;
  a.solids.length = 0;
  a.player.x = 9999;
  const b = g.getState();
  assert.equal(b.energy, 100);
  assert.ok(b.solids.length > 5);
  assert.equal(b.courseName.zh, '滴水檐巷');
  assert.equal(b.onPad, true);
  assert.equal(b.mode, 'pad');
});

test('wallrunner: draw smoke covers every course, wall-run, kick, hazards, banner and terminal frames', () => {
  const sizes = [],
    ctx = new Proxy(mockContext(), {
      set(t, p, v) {
        if (p === 'font') sizes.push(Number(/(\d+)px/.exec(v)[1]));
        t[p] = v;
        return true;
      },
    });
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    g.draw(ctx);
    const dropper = createGame(h.env);
    for (let n = 0; n < 600 && dropper.getState().lives === 4; n++)
      dropper.update(1 / 30, input(RIGHT));
    dropper.draw(ctx);
    for (let n = 0; n < 40; n++) g.update(1 / 60, input(RIGHT, n === 5 ? ['Space'] : []));
    g.draw(ctx);
    for (let n = 0; n < 40; n++) g.update(1 / 60, input(LEFT));
    g.draw(ctx);
  }
  assert.ok(sizes.length > 10);
  assert.ok(Math.min(...sizes) >= 14, `smallest font ${Math.min(...sizes)}`);
  assert.ok(Math.max(...sizes) <= 16);
});

const solidsOf = (s) => getCourse(s.course).solids;
