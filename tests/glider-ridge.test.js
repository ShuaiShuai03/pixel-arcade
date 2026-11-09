import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  PHYSICS,
  COURSES,
  createGame,
  createGliderState,
  stepGlider,
  describe,
  drawGlider,
  liftCoefficient,
  terrainAt,
  windAt,
} from '../src/games/glider-ridge.js';
import { harness, input, mockContext } from './harness.js';

const DT = 1 / 240;
function fresh(course = 1, patch = {}) {
  const s = createGliderState(course);
  Object.assign(s, { x: 100, z: 0, h: 3000, vx: 28, vz: 0, vh: -2.5, alpha: 0.1 }, patch);
  s.camX = s.x - 200;
  s.camH = s.h;
  return s;
}
function run(s, seconds, keys = [], hz = 240) {
  const dt = 1 / hz,
    steps = Math.round(seconds * hz),
    trace = [];
  for (let i = 0; i < steps; i++) {
    stepGlider(s, dt, input(keys));
    trace.push(s.energy.specific);
  }
  return trace;
}
const airspeed = (s) => describe(s).glider.airspeed;

test('glider: metadata is bilingual and every action has a touch control', () => {
  assert.equal(meta.id, 'glider-ridge');
  assert.equal(meta.genre, 'sports');
  assert.equal(meta.name.zh, '滑翔山脊');
  assert.match(meta.description.zh, /\p{Script=Han}/u);
  for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
    const control = meta.touchControls.find((c) => c.code === code);
    assert.ok(control, code);
    assert.ok(control.label.en);
    assert.match(control.label.zh, /\p{Script=Han}/u);
  }
  assert.ok(meta.keys.every((k) => k.label.en && /\p{Script=Han}/u.test(k.label.zh)));
});

test('glider: zero, negative, NaN and huge time never advance state or read input', () => {
  const h = harness(),
    game = createGame(h.env),
    before = structuredClone(game.getState());
  let reads = 0;
  const probe = {
    held: () => (reads++, true),
    pressed: () => (reads++, true),
    pointer: { x: 0, y: 0, down: false, clicked: false },
  };
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 1e9]) game.update(dt, probe);
  assert.deepEqual(game.getState(), before);
  assert.equal(reads, 0);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});

test('glider: unpowered flight never gains mechanical energy without air-mass motion', () => {
  const s = fresh();
  const script = [
    [3, []],
    [1, ['ArrowUp']],
    [1, ['ArrowDown']],
    [3, ['ArrowLeft']],
    [3, ['ArrowRight']],
    [1.5, ['Space']],
    [2, ['ArrowUp']],
    [2, ['ArrowDown', 'ArrowLeft']],
  ];
  let previous = null,
    worst = -Infinity;
  for (const [seconds, keys] of script) {
    for (const value of run(s, seconds, keys)) {
      if (previous !== null) worst = Math.max(worst, value - previous);
      previous = value;
    }
  }
  assert.ok(worst <= 1e-9, `largest per-step energy increase ${worst}`);
  assert.ok(Math.abs(s.energy.airGain) < 1e-6, `air gain ${s.energy.airGain}`);
  assert.ok(s.energy.dissipated > 100);
});

test('glider: diving trades altitude for airspeed and the glide ratio is finite', () => {
  const long = fresh(),
    glide = fresh(),
    dive = fresh();
  run(long, 30);
  run(glide, 6);
  run(dive, 6, ['ArrowDown']);
  const ratio = (long.x - 100) / (3000 - long.h);
  assert.ok(ratio > 6 && ratio < 13, `glide ratio ${ratio}`);
  assert.ok(Math.abs(airspeed(long) - 24) < 3, 'neutral glide settles at the trim speed');
  assert.ok(airspeed(dive) > airspeed(glide) + 8);
  assert.ok(dive.h < glide.h);
  assert.equal(PHYSICS.attempts, 3);
});

test('glider: lift coefficient peaks at the critical angle and drops when stalled', () => {
  const peak = liftCoefficient(PHYSICS.criticalAlpha, false);
  assert.ok(Math.abs(peak - PHYSICS.maxLift) < 1e-9);
  assert.ok(liftCoefficient(PHYSICS.criticalAlpha + 0.05, true) < peak * 0.6);
  assert.equal(liftCoefficient(10, false), PHYSICS.maxLift);
});

test('glider: stall onset warns first, loses lift and recovers when the nose goes down', () => {
  const s = fresh();
  let warned = false,
    stalledAt = null;
  for (let i = 0; i < 240 * 4 && stalledAt === null; i++) {
    stepGlider(s, DT, input(['ArrowUp']));
    const g = describe(s).glider;
    if (g.stallWarning) warned = true;
    if (g.stalled) stalledAt = i / 240;
  }
  assert.ok(warned, 'warning precedes the stall');
  assert.ok(stalledAt !== null && stalledAt < 3);
  const climbAtStall = s.vh;
  run(s, 3, ['ArrowUp']);
  assert.equal(s.stalled, true, 'holding the nose up keeps the wing stalled');
  assert.ok(s.vh < -1 && s.vh < climbAtStall - 3, `stalled wing sinks: ${s.vh}`);
  assert.ok(describe(s).glider.airspeed < 25, 'no thrust to power through the stall');
  run(s, 3, ['ArrowDown']);
  assert.equal(s.stalled, false);
  assert.ok(airspeed(s) > 20, 'dive recovered flying speed');
  assert.ok(s.h > 2500, 'recovery costs finite altitude');
});

test('glider: flare bleeds speed without hidden thrust and recovers when released', () => {
  const free = fresh(),
    flared = fresh();
  run(free, 5);
  run(flared, 5);
  run(flared, 1.5, ['Space']);
  run(free, 1.5);
  const ground = terrainAt(COURSES[6], 2100, 0),
    near = { x: 2100, h: ground + 12, vx: 22, vh: -6, gate: 4 },
    slowFree = fresh(6, near),
    slowFlare = fresh(6, near);
  run(slowFree, 0.8);
  run(slowFlare, 0.8, ['Space']);
  assert.ok(slowFlare.vh > slowFree.vh + 0.5, 'a flare near the ground arrests the sink');
  run(flared, 0.1);
  assert.equal(flared.flare, false);
  assert.equal(flared.stalled, false);
});

test('glider: thermals and ridge lift add visible energy; lee sink removes it', () => {
  const c = COURSES[6];
  assert.ok(windAt(c, 640, 60, 300).h > 7);
  assert.equal(windAt(c, 640, 60, 600).h, 0, 'thermal fades above its top');
  assert.equal(windAt(c, 640, 250, 300).h, 0, 'thermal is a localized column');
  const inLift = fresh(6, { x: 545, h: 320 }),
    outside = fresh(6, { x: 250, h: 320 });
  run(inLift, 6);
  run(outside, 6);
  assert.ok(inLift.h - outside.h > 25, `${inLift.h} vs ${outside.h}`);
  assert.ok(inLift.energy.airGain > 100, `${inLift.energy.airGain}`);
  assert.ok(Math.abs(outside.energy.airGain) < 1e-6);
  const spur = COURSES[0],
    ground = terrainAt(spur, 860, 0);
  assert.ok(windAt(spur, 860, 0, ground + 20).h > 2, 'ridge lift on the windward face');
  assert.ok(windAt(spur, 860, 0, ground + 400).h === 0, 'ridge lift fades with height');
  const crest = COURSES[14];
  assert.ok(windAt(crest, 730, 0, terrainAt(crest, 730, 0) + 30).h < -1, 'lee sink');
});

test('glider: crosswind shifts the ground track while airspeed stays the same', () => {
  const windy = fresh(6, { x: 850, h: 3000, vz: 7 }),
    calm = fresh(6, { x: 200, h: 3000 });
  run(windy, 3);
  run(calm, 3);
  assert.ok(windy.z > 12, `drift ${windy.z}`);
  assert.ok(windy.vz > 5 && windy.vz < 9);
  assert.equal(Math.abs(calm.z) < 1e-9, true);
  assert.ok(Math.abs(airspeed(windy) - airspeed(calm)) < 1.5);
  const w = windAt(COURSES[6], 900, 0, 300);
  assert.equal(w.z, 7);
  assert.ok(Math.hypot(windy.vx, windy.vz) > 0);
  const state = describe(windy);
  assert.ok(state.wind.z > 6);
  assert.ok(state.glider.groundSpeed > 0);
});

test('glider: gates count only in order and report why a gate was missed', () => {
  const g1 = COURSES[0].gates[0];
  const through = fresh(0, { x: g1.x - 2, h: g1.h, vx: 28, vh: 0 });
  run(through, 0.5);
  assert.equal(through.gate, 1);
  assert.equal(through.score, 100);
  assert.equal(through.checkpoint, 0);
  assert.equal(through.message.en, 'Gate 1/3 passed');
  const skipped = fresh(0, { x: COURSES[0].gates[1].x - 2, h: 300 });
  run(skipped, 0.5);
  assert.equal(skipped.gate, 0, 'a later gate cannot be passed first');
  const cases = [
    [{ h: g1.h - 60 }, 'too low'],
    [{ h: g1.h + 100 }, 'too high'],
    [{ z: 90, h: g1.h }, 'off line'],
  ];
  for (const [patch, text] of cases) {
    const s = fresh(0, { x: g1.x - 2, vx: 28, vh: 0, ...patch });
    run(s, 0.5);
    assert.equal(s.gate, 0);
    assert.equal(s.gatesMissed, 1);
    assert.ok(s.message.en.includes(text), s.message.en);
    assert.match(s.message.zh, /漏门/);
  }
  const backwards = fresh(0, { x: g1.x + 2, h: g1.h, vx: -28, vh: 0 });
  run(backwards, 0.5);
  assert.equal(backwards.gate, 1, 'a gate can be re-flown from either side');
});

function touchdown(course, patch, gate = COURSES[course].gates.length, keys = ['Space']) {
  const c = COURSES[course],
    zone = c.zone,
    x = patch.x ?? (zone.x0 + zone.x1) / 2,
    ground = terrainAt(c, x, patch.z ?? 0),
    s = fresh(course, {
      x,
      z: 0,
      h: ground < 9999 ? ground + 0.05 : 160.5,
      vx: 19,
      vh: -1.2,
      gate,
      ...patch,
    });
  run(s, 1, keys, 120);
  return s;
}

test('glider: a gentle in-zone touchdown after every gate scores and completes the course', () => {
  const s = touchdown(0, {});
  assert.equal(s.phase, 'landed');
  assert.equal(s.landing.kind, 'safe');
  assert.ok(s.landing.perfect);
  assert.equal(s.score, s.landing.points);
  assert.ok(s.landing.points >= 200 + 150 + 150, `${s.landing.points}`);
  assert.deepEqual(s.events.splice(0), ['coin']);
  const off = touchdown(0, { x: COURSES[0].zone.x0 + 4, z: 50 });
  assert.equal(off.landing.kind, 'safe');
  assert.ok(off.landing.points < s.landing.points - 100, 'position error costs points');
  const rough = touchdown(0, { vh: -3.8, vx: 22 });
  assert.equal(rough.landing.kind, 'safe');
  assert.equal(rough.landing.perfect, false);
  assert.ok(rough.landing.points < s.landing.points);
});

test('glider: hard, fast, stalled, steep, off-pad and incomplete landings cost one attempt', () => {
  const cases = [
    [touchdown(0, { vh: -9 }), 'hard'],
    [touchdown(0, { vx: 34, vh: -1 }, 3, []), 'hard'],
    [touchdown(0, { stalled: true, alpha: 0.3, vh: -3 }), 'hard'],
    [touchdown(0, { x: 1400 }), 'hard'],
    [touchdown(0, { x: 1950, z: 0 }), 'outlanding'],
    [touchdown(0, { z: 120 }), 'outlanding'],
    [touchdown(0, {}, 2), 'incomplete'],
    [touchdown(0, { z: 270 }), 'wall'],
    [touchdown(0, { x: 2050 }), 'wall'],
  ];
  for (const [s, kind] of cases) {
    assert.equal(s.landing.kind, kind);
    assert.equal(s.phase, 'crashed');
    assert.equal(s.attempts, 2);
    assert.equal(s.score, 0);
    assert.equal(s.landing.points, 0);
    assert.ok(s.message.en && s.message.zh);
  }
});

test('glider: flying into terrain is fair: explicit crash, then relaunch from the last gate', () => {
  const g1 = COURSES[0].gates[0],
    s = fresh(0, { x: g1.x - 2, h: g1.h, vx: 28, vh: 0 });
  run(s, 0.3);
  assert.equal(s.checkpoint, 0);
  Object.assign(s, { x: 600, h: terrainAt(COURSES[0], 600, 0) + 2, vx: 20, vh: -9 });
  run(s, 0.5);
  assert.equal(s.phase, 'crashed');
  assert.equal(s.attempts, 2);
  assert.equal(s.crashes, 1);
  assert.equal(s.score, 100, 'a crash keeps points already earned');
  const frozen = { x: s.x, h: s.h };
  stepGlider(s, 1 / 60, input(['ArrowUp'], ['Space']));
  assert.equal(s.phase, 'crashed', 'an early press waits for the minimum pause');
  run(s, 0.1, [], 60);
  assert.deepEqual({ x: s.x, h: s.h }, frozen, 'nothing moves while the crash is shown');
  assert.equal(s.phase, 'crashed');
  for (let guard = 0; s.phase === 'crashed' && guard < 60; guard++) {
    stepGlider(s, 1 / 60, input([]));
  }
  assert.equal(s.phase, 'playing', 'the early press was remembered, not dropped');
  assert.ok(s.timer < 0.1, 'relaunched as soon as the minimum pause ended');
  assert.equal(s.gate, 1);
  assert.ok(Math.abs(s.x - (g1.x + 3)) < 2);
  assert.ok(Math.abs(s.h - g1.h) < 2);
  assert.equal(s.score, 100, 'relaunch does not repeat gate points');
  assert.ok(s.h - terrainAt(COURSES[0], s.x, s.z) > 40, 'relaunch has a response window');
  assert.equal(s.landing, null);
});

test('glider: the crash screen relaunches on its own after the hold and a restart uses the start', () => {
  const s = fresh(0, { x: 20, h: terrainAt(COURSES[0], 20, 0) + 1, vx: 10, vh: -10 });
  run(s, 0.2);
  assert.equal(s.phase, 'crashed');
  run(s, 2.4, [], 60);
  assert.equal(s.phase, 'playing');
  assert.equal(s.gate, 0);
  assert.ok(Math.abs(s.x - COURSES[0].start.x) < 10);
  assert.ok(Math.abs(s.h - COURSES[0].start.h) < 3);
});

test('glider: completing a course starts the next one and carries the score', () => {
  const s = touchdown(0, {});
  const points = s.score;
  run(s, 0.9, [], 60);
  stepGlider(s, 1 / 60, input([], ['Enter']));
  assert.equal(s.phase, 'playing');
  assert.equal(s.course, 1);
  assert.equal(s.score, points);
  assert.equal(s.attempts, 3);
  assert.equal(describe(s).courseName.en, 'Meadow Slalom');
  assert.deepEqual(s.events.splice(0), ['move']);
});

test('glider: three failed attempts lose, call end once and freeze the run', () => {
  const h = harness(),
    game = createGame(h.env);
  let reads = 0;
  for (let i = 0; i < 60 * 600 && game.getState().phase !== 'lost'; i++) {
    game.update(1 / 60, input(['ArrowDown'], ['Space']));
  }
  const s = game.getState();
  assert.equal(s.phase, 'lost');
  assert.equal(s.attemptsLeft, 0);
  assert.equal(s.crashes, 3);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.equal(h.ends[0].score, s.score);
  assert.ok(h.sounds.includes('hit') && h.sounds.includes('lose'));
  const frozen = structuredClone(s);
  const probe = { held: () => (reads++, true), pressed: () => (reads++, true), pointer: {} };
  for (let i = 0; i < 300; i++) game.update(1 / 60, probe);
  assert.deepEqual(game.getState(), frozen);
  assert.equal(h.ends.length, 1);
  assert.equal(reads, 0);
  const restarted = createGame(harness().env).getState();
  assert.equal(restarted.phase, 'playing');
  assert.equal(restarted.attemptsLeft, 3);
});

test('glider: every course is authored fairly and has a launch, gates and a flat pad', () => {
  assert.equal(COURSES.length, 20);
  for (const c of COURSES) {
    assert.ok(c.name.en && c.name.zh && c.brief.en && c.brief.zh);
    assert.ok(c.terrain.every((p, i) => i === 0 || p[0] > c.terrain[i - 1][0]));
    assert.ok(c.start.h - terrainAt(c, c.start.x, 0) >= 25, 'launch clearance');
    let previousX = c.start.x;
    for (const g of c.gates) {
      assert.ok(g.x > previousX);
      previousX = g.x;
      assert.ok(Math.abs(g.z) + g.hw <= c.half);
      assert.ok(g.h - 30 - terrainAt(c, g.x, g.z) >= 5, 'gate window clears terrain');
    }
    const heights = [];
    for (let x = c.zone.x0; x <= c.zone.x1; x += 5) heights.push(terrainAt(c, x, 0));
    assert.ok(Math.max(...heights) - Math.min(...heights) < 1e-9, 'pad is flat');
    assert.ok(c.zone.x1 < c.xmax && Math.abs(c.zone.z) + c.zone.hw < c.half);
    assert.ok(c.gates.at(-1).x < c.zone.x0);
    assert.ok(c.socks.length >= 3);
  }
  assert.ok(COURSES[6].wind.some((w) => Math.abs(w.wz) > 0));
  assert.ok(COURSES[14].zone.hw < COURSES[0].zone.hw, 'the mastery pad is narrower');
});

function capture(state, lang) {
  const ctx = mockContext(),
    sizes = [],
    texts = [];
  ctx.fillText = (t) => {
    sizes.push(Number(/(\d+)px/.exec(ctx.font)[1]));
    texts.push(String(t));
  };
  drawGlider(ctx, state, { lang, t: (en, zh) => (lang === 'zh' ? zh : en) });
  return { sizes, texts };
}

test('glider: drawing covers every phase and language with 14-16 px text and no state change', () => {
  const scenes = [];
  for (const course of [0, 6, 14]) {
    const c = COURSES[course],
      base = fresh(course, { x: c.gates[0].x - 40, h: c.gates[0].h });
    scenes.push(base);
    scenes.push({ ...base, stalled: true, alpha: 0.3, time: 0.1 });
    scenes.push({ ...base, stallWarn: true, flare: true, bank: 0.7, heading: 3, time: 0.2 });
    scenes.push({
      ...base,
      gate: c.gates.length,
      h: terrainAt(c, c.zone.x0, 0) + 15,
      x: c.zone.x0 - 30,
    });
    scenes.push({ ...base, x: c.zone.x0 + 20, h: terrainAt(c, c.zone.x0, 0) + 3, z: 40 });
    scenes.push({ ...base, h: terrainAt(c, base.x, 0) + 5, gate: 1, time: 9 });
    scenes.push({
      ...base,
      x: c.thermals[0].x,
      h: 300,
      z: 60,
      message: { en: 'Gate 1/3 passed', zh: '第 1/3 门通过', timer: 1 },
    });
  }
  const base = fresh(14);
  const landing = { kind: 'hard', sink: 6, speed: 20 };
  for (const phase of ['crashed', 'landed', 'won', 'lost']) {
    scenes.push({
      ...base,
      phase,
      landing,
      message: { en: 'Hard landing', zh: '硬着陆', timer: 2 },
    });
  }
  scenes.push({ ...base, phase: 'lost', landing: null, message: null });
  let hanZh = 0;
  for (const scene of scenes) {
    const before = structuredClone(describe(scene));
    for (const lang of ['en', 'zh']) {
      const { sizes, texts } = capture(scene, lang);
      assert.ok(sizes.length > 4);
      assert.ok(
        sizes.every((n) => n >= 14 && n <= 16),
        `text sizes ${sizes}`,
      );
      assert.ok(
        texts.every((t) => t.length * 7 < 480 || t.length < 50),
        'short prompts',
      );
      if (lang === 'zh' && texts.some((t) => /\p{Script=Han}/u.test(t))) hanZh++;
    }
    assert.deepEqual(describe(scene), before);
  }
  assert.equal(hanZh, scenes.length);
});

test('glider: prompts name the next action in both languages', () => {
  const c = COURSES[0],
    low = fresh(0, { time: 10, x: 200, h: terrainAt(c, 200, 0) + 15 }),
    stalled = fresh(0, { time: 10, stalled: true }),
    warn = fresh(0, { time: 10, stallWarn: true }),
    normal = fresh(0, { time: 10, x: 0, h: 345 }),
    pad = fresh(0, { time: 10, gate: 3, x: 1520, h: terrainAt(c, 1520, 0) + 10 }),
    high = fresh(0, { time: 10, gate: 3, x: 1520, h: terrainAt(c, 1520, 0) + 120 }),
    ramp = fresh(0, { time: 10, gate: 3, x: 1400, h: terrainAt(c, 1400, 0) + 10 }),
    far = fresh(0, { time: 10, gate: 3, x: 1300, h: 300 });
  const lines = (s) => capture(s, 'en').texts.join('|');
  assert.match(lines(stalled), /STALL/);
  assert.match(lines(warn), /Slow/);
  assert.match(lines(low), /Find lift/);
  assert.match(lines(normal), /gate 1/);
  assert.match(lines(pad), /flare/);
  assert.match(lines(far), /Glide to the pad/);
  assert.match(lines(ramp), /Glide to the pad/, 'no flare cue on the approach slope');
  assert.match(lines(high), /circle/);
  assert.match(capture(normal, 'zh').texts.join('|'), /穿过第 1 门/);
});

test('glider: WASD mirrors the arrows and opposing steering cancels', () => {
  const arrows = fresh(),
    letters = fresh(),
    opposed = fresh();
  run(arrows, 2, ['ArrowUp', 'ArrowLeft']);
  run(letters, 2, ['KeyW', 'KeyA']);
  run(opposed, 2, ['ArrowLeft', 'ArrowRight']);
  assert.deepEqual({ ...arrows, events: [] }, { ...letters, events: [] });
  assert.ok(arrows.bank > 0.1, 'left bank is positive');
  assert.equal(opposed.bank, 0);
  const down = fresh(),
    s = fresh();
  run(down, 1, ['KeyS']);
  run(s, 1, ['ArrowDown']);
  assert.equal(down.alpha, s.alpha);
  const right = fresh();
  run(right, 2, ['KeyD']);
  assert.ok(right.bank < -0.1 && right.z < 0, 'right bank turns toward negative z');
});

test('glider: getState().status is a bilingual host status string with progress and objective', () => {
  const state = createGame(harness().env).getState();
  assert.equal(typeof state.status.en, 'string');
  assert.match(state.status.en, /Course 1\/20 · Gate 1\/3 · Attempts 3 · /);
  assert.match(state.status.zh, /赛道 1\/20 · 检查门 1\/3 · 机会 3 · .*\p{Script=Han}/u);
  const stalled = describe(fresh(0, { time: 10, stalled: true }));
  assert.match(stalled.status.en, /STALL/);
  assert.equal(typeof stalled.glider.airspeed, 'number');
});

test('glider: the objective and HUD text never overlap the instrument panel', () => {
  const ctx = mockContext(),
    spots = [];
  ctx.fillText = (t, x, y) => spots.push([String(t), x, y]);
  const s = fresh(0, { time: 10, x: 100, h: 345, time: 1 });
  drawGlider(ctx, s, { lang: 'en', t: (en) => en });
  const objective = spots.find(([t]) => t.startsWith('Ride ridge'));
  assert.ok(objective && objective[2] >= 280, 'objective sits in the bottom bar');
});

test('glider: touchdown reports the criterion that actually failed in both languages', () => {
  const cases = [
    [touchdown(0, { vh: -9 }), 'sink', /sinking too fast/, /下沉太快/],
    [touchdown(0, { vx: 34, vh: -1 }, 3, []), 'speed', /too fast/, /速度太快/],
    [touchdown(0, { stalled: true, alpha: 0.3, vh: -3 }), 'stall', /stalled/, /失速/],
  ];
  for (const [s, reason, en, zh] of cases) {
    assert.equal(s.landing.reason, reason);
    assert.match(s.message.en, en);
    assert.match(s.message.zh, zh);
  }
});

test('glider: holding Space exactly while the flare cue shows lands safely from the cue point', () => {
  for (const hz of [30, 60, 120]) {
    for (const speed of [22, 25]) {
      const c = COURSES[0],
        ground = terrainAt(c, 1520, 0),
        s = fresh(0, { x: 1520, h: ground + 17, vx: speed, vh: -2.4, gate: 3 });
      for (let i = 0; i < hz * 30 && s.phase === 'playing'; i++) {
        const flare = describe(s).cues.flare;
        stepGlider(s, 1 / hz, input(flare ? ['Space'] : []));
      }
      assert.equal(s.phase, 'landed', `${hz} Hz at ${speed}: ${JSON.stringify(s.landing)}`);
      assert.equal(s.landing.kind, 'safe');
    }
  }
});

test('glider: guidance shows the altitude need, lift marker, gate line and flare cue', () => {
  const c = COURSES[6],
    low = fresh(6, { x: 430, h: 300, gate: 1, vx: 28, vh: -2.5, time: 10 }),
    cues = describe(low).cues;
  assert.equal(cues.kind, 'gate');
  assert.equal(cues.cue, 'low');
  assert.ok(cues.need > 340 && cues.need < 420, `need ${cues.need}`);
  assert.equal(cues.lift.x, 640);
  assert.equal(cues.lift.inside, false);
  assert.equal(cues.lateral, c.gates[1].z);
  assert.match(
    capture(low, 'en').texts.join('|'),
    /ALT \d+/,
    'the need line is labelled on screen',
  );
  assert.match(capture(low, 'zh').texts.join('|'), /高度 \d+/);
  const inside = fresh(6, { x: 640, z: 0, h: 300, gate: 1, time: 10 });
  assert.equal(describe(inside).cues.lift.inside, true);
  assert.match(capture(inside, 'en').texts.join('|'), /Hold Left: climb to ALT/);
  const high = fresh(6, { x: 1500, h: 420, gate: 3, time: 10 });
  assert.equal(describe(high).cues.cue, 'high');
  const ok = fresh(6, { x: 1500, h: 300, gate: 3, time: 10 });
  assert.equal(describe(ok).cues.cue, 'ok');
  const pad = describe(fresh(6, { gate: 4, x: 2100, h: terrainAt(c, 2100, 0) + 10, time: 10 }));
  assert.equal(pad.cues.kind, 'pad');
  assert.equal(pad.cues.flare, true);
  const far = describe(fresh(6, { gate: 4, x: 1900, h: 240, time: 10 }));
  assert.equal(far.cues.flare, false);
  const behind = describe(fresh(6, { x: 2000, h: 300, time: 10 }));
  assert.ok(behind.cues.distance < 0);
});

test('glider: gate pointers and lift markers are drawn when targets are off screen', () => {
  const far = fresh(6, { x: 20, h: 380, time: 10 }),
    { texts } = capture(far, 'en');
  assert.ok(
    texts.some((t) => /^1: \d+$/.test(t)),
    'distance to the next gate',
  );
  const behind = capture(fresh(6, { x: 560, h: 250, gate: 1, time: 10 }), 'en').texts.join('|');
  assert.match(behind, /LIFT/);
});

test('glider: relaunch from the final checkpoints keeps a comfortable margin to the pad', () => {
  const margin = (c, g) => g.h - (c.zone.x0 - g.x) / 9 - terrainAt(c, c.zone.x0 + 5, 0);
  for (const c of COURSES) assert.ok(margin(c, c.gates.at(-1)) >= 15, `${c.name.en} final gate`);
  for (const g of COURSES[0].gates.slice(1)) assert.ok(margin(COURSES[0], g) >= 15);
  for (const c of COURSES) {
    for (const g of c.gates) {
      assert.ok(g.h - g.lo >= terrainAt(c, g.x, g.z) + 5, 'any legal gate pass clears the ground');
    }
  }
});

test('glider: course edges are visible walls, with a warning prompt before them', () => {
  for (const c of COURSES) {
    assert.ok(terrainAt(c, c.xmax - 1, 0) > 1400 && terrainAt(c, c.xmin + 1, 0) > 1400);
    assert.ok(Math.max(...c.thermals.map((t) => t.top)) < 1400, 'lift ends below the wall top');
  }
  const edge = fresh(14, { x: 1000, z: 220, h: 500, time: 10 });
  assert.match(capture(edge, 'en').texts.join('|'), /Course edge: Hold Left: turn back/);
  assert.match(capture(edge, 'zh').texts.join('|'), /赛道边缘/);
  assert.match(describe(edge).status.en, /Course edge/);
});

test('glider: a missed gate is called out and the banner advertises the automatic restart', () => {
  const g = COURSES[0].gates[0],
    missed = fresh(0, { x: g.x + 60, h: g.h, time: 10 });
  assert.match(capture(missed, 'en').texts.join('|'), /Gate 1 missed: Hold Left: turn back/);
  assert.match(capture(missed, 'zh').texts.join('|'), /第 1 门漏过/);
  const crashed = fresh(0, {
    phase: 'crashed',
    timer: 0.5,
    time: 10,
    message: { en: 'x', zh: 'y' },
  });
  assert.match(capture(crashed, 'en').texts.join('|'), /relaunch \(auto in 2 s\)/);
  assert.match(
    capture({ ...crashed, phase: 'landed', timer: 1.5 }, 'zh').texts.join('|'),
    /1 秒后自动/,
  );
});
