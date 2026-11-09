import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  meta,
  createCourierState,
  stepCourier,
  courierField,
  courierLanding,
  courierDockCue,
  drawCourier,
  COURIER_ROOMS,
} from '../src/games/gravity-courier.js';
import { harness, input, mockContext } from './harness.js';
test('courier inversion changes acceleration and consumes an edge only once', () => {
  const g = createGame(harness().env);
  const startY = g.getState().player.y;
  g.update(1 / 120, input([], ['Space']));
  assert.equal(g.getState().gravity, -1);
  for (let i = 0; i < 30; i++) g.update(1 / 120, input(['Space']));
  assert.equal(g.getState().gravity, -1);
  assert.ok(g.getState().player.y < startY);
  g.draw(mockContext());
  assert.ok(meta.touchControls.length >= 3);
});
test('courier deterministic soak and fresh restart', () => {
  const a = harness(),
    b = harness(),
    x = createGame(a.env),
    y = createGame(b.env);
  for (let i = 0; i < 18000; i++) {
    const k = input(i % 400 < 200 ? ['ArrowRight'] : ['ArrowLeft'], i % 100 === 0 ? ['Space'] : []);
    x.update(1 / 120, k);
    y.update(1 / 120, k);
  }
  assert.deepEqual(x.getState(), y.getState());
  assert.ok(Number.isFinite(x.getState().player.y));
  assert.ok(a.ends.length <= 1);
  assert.equal(createGame(harness().env).getState().level, 1);
});

test('courier zero and invalid time preserve complete state and all side effects', () => {
  const h = harness(),
    g = createGame(h.env),
    before = g.getState(),
    sounds = h.sounds.length;
  for (const dt of [0, -1, NaN, Infinity]) g.update(dt, input(['ArrowRight'], ['Space', 'KeyX']));
  assert.deepEqual(g.getState(), before);
  assert.equal(h.sounds.length, sounds);
  assert.equal(h.ends.length, 0);
});
test('courier field reversal changes acceleration without a velocity impulse', () => {
  const g = createGame(harness().env);
  g.update(1 / 240, input([], ['Space']));
  assert(
    Math.abs(g.getState().player.vy) < 3,
    'initial reversal must start from rest under finite force',
  );
});
test('courier free flight is partition invariant at30/60/120Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness().env);
    g.update(1 / 240, input([], ['Space']));
    for (let i = 0; i < hz / 5; i++) g.update(1 / hz, input());
    return g.getState();
  });
  for (const s of states.slice(1)) assert(Math.abs(s.player.y - states[0].player.y) < 1e-7);
});
test('courier exposes an actual fragile shipment and explicit handling action', () => {
  const s = createGame(harness().env).getState();
  assert(s.parcel && Number.isFinite(s.parcel.integrity));
  assert(meta.touchControls.some((c) => c.code === 'KeyX'));
});

function hold(g, seconds, hz = 60, keys = []) {
  for (let i = 0; i < Math.round(seconds * hz); i++) g.update(1 / hz, input(keys));
}
function coreRun(s, h, seconds, hz = 120, keys = []) {
  for (let i = 0; i < Math.round(seconds * hz); i++) stepCourier(s, 1 / hz, input(keys), h.env);
}
function carrying(s) {
  s.parcel.status = 'carried';
  return s;
}
test('courier floor and ceiling contacts are mirrored, inelastic and damage once by preimpact speed', () => {
  const a = harness(),
    b = harness(),
    down = carrying(createCourierState()),
    up = carrying(createCourierState());
  Object.assign(down.player, { x: 230, y: 100, vy: 150 });
  Object.assign(up.player, { x: 230, y: 228, vy: -150 });
  up.gravity = -1;
  coreRun(down, a, 1);
  coreRun(up, b, 1);
  assert(Math.abs(down.player.y + up.player.y - 328) < 1e-7);
  assert.equal(down.player.vy, 0);
  assert.equal(up.player.vy, 0);
  assert.equal(down.parcel.integrity, up.parcel.integrity);
  assert.equal(down.impacts.length, 1);
  assert.equal(up.impacts.length, 1);
  assert(down.impacts[0].speed > 150);
  const integrity = down.parcel.integrity;
  coreRun(down, a, 2);
  assert.equal(down.parcel.integrity, integrity);
  assert.equal(down.impacts.length, 1);
});
test('courier swept bulkhead and ceiling contacts stop arbitrarily fast motion without tunneling', () => {
  const h = harness(),
    s = carrying(createCourierState(6));
  Object.assign(s.player, { x: 100, y: 120, vx: 90000, vy: 0 });
  stepCourier(s, 1 / 30, input(), h.env);
  assert.equal(s.player.x, 146);
  assert.equal(s.player.vx, 0);
  assert(s.impacts.some((p) => p.normals.some((n) => n.x === -1)));
  const q = carrying(createCourierState());
  Object.assign(q.player, { x: 230, y: 100, vy: -90000 });
  q.gravity = -1;
  stepCourier(q, 1 / 30, input(), h.env);
  assert.equal(q.player.y, 64);
  assert.equal(q.player.vy, 0);
  assert.equal(q.impacts.length, 1);
});
test('courier exact end-step impact is included and separating tangency is not a new collision', () => {
  const h = harness(),
    s = carrying(createCourierState());
  Object.assign(s.player, { y: 263, vy: 120 });
  const dt = (-120 + Math.sqrt(120 * 120 + 360)) / 180;
  stepCourier(s, dt, input(), h.env);
  assert.equal(s.player.y, 264);
  assert.equal(s.player.vy, 0);
  assert.equal(s.impacts.length, 1);
  const q = carrying(createCourierState());
  q.player.vy = -30;
  stepCourier(q, 1 / 30, input(), h.env);
  assert(q.player.y < 264);
  assert.equal(q.impacts.length, 0);
  assert.equal(q.parcel.integrity, 3);
});
test('courier middle-flight field reversal preserves both velocity components and only changes acceleration', () => {
  const h = harness(),
    s = createCourierState();
  Object.assign(s.player, { x: 230, y: 180, vx: 50, vy: -100 });
  stepCourier(s, 0.01, input([], ['Space']), h.env);
  assert.equal(s.gravity, -1);
  assert(Math.abs(s.player.vy + 101.8) < 1e-8);
  assert(Math.abs(s.player.vx - 50 * Math.exp(-0.03)) < 1e-8);
  assert(Math.abs(s.player.y - (180 - 1 - 0.009)) < 1e-8);
});
test('courier horizontal thrusters have finite acceleration, opposing inputs cancel and release retains damped momentum', () => {
  const h = harness(),
    s = createCourierState();
  stepCourier(s, 1 / 120, input(['ArrowLeft', 'ArrowRight']), h.env);
  assert.equal(s.player.vx, 0);
  assert.equal(s.player.x, 64);
  stepCourier(s, 1 / 120, input(['ArrowRight']), h.env);
  assert(s.player.vx > 0 && s.player.vx < 4);
  const before = s.player.vx;
  stepCourier(s, 1 / 120, input(), h.env);
  assert(s.player.vx > 0 && s.player.vx < before);
});
test('courier field strength changes exactly at a crossed coil boundary without an impulse', () => {
  const h = harness(),
    s = createCourierState(14);
  Object.assign(s.player, { x: 179, y: 110, vx: 120, vy: -40 });
  s.gravity = -1;
  stepCourier(s, 1 / 30, input(['ArrowRight']), h.env);
  const t1 = 1 / 120,
    t2 = 1 / 30 - t1,
    vy1 = -40 - 150 * t1,
    expectedY = 110 - 40 * t1 - 75 * t1 * t1 + vy1 * t2 - 45 * t2 * t2;
  assert(Math.abs(s.player.x - 183) < 1e-7);
  assert(Math.abs(s.player.vy - (-40 - 150 * t1 - 90 * t2)) < 1e-7);
  assert(Math.abs(s.player.y - expectedY) < 1e-7);
  assert.equal(courierField(s), 90);
});
test('courier support-edge departure and coil crossings remain partition invariant at30/60/120Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const h = harness(),
      s = createCourierState(6);
    Object.assign(s.player, { x: 300, y: 144, vx: 100, vy: 0 });
    coreRun(s, h, 0.4, hz, ['ArrowRight']);
    return s;
  });
  assert(states[0].player.y > 144);
  for (const s of states.slice(1)) {
    assert(Math.abs(s.player.x - states[0].player.x) < 1e-7);
    assert(Math.abs(s.player.y - states[0].player.y) < 1e-7);
    assert(Math.abs(s.player.vy - states[0].player.vy) < 1e-7);
  }
});
test('courier buffered flip fires once at cooldown, expires if too early, and held input never repeats', () => {
  const h = harness(),
    s = createCourierState();
  stepCourier(s, 1 / 120, input([], ['Space']), h.env);
  coreRun(s, h, 0.15);
  stepCourier(s, 1 / 120, input([], ['Space']), h.env);
  coreRun(s, h, 0.15);
  assert.equal(s.flips, 2);
  assert.equal(s.gravity, 1);
  coreRun(s, h, 1, 120, ['Space']);
  assert.equal(s.flips, 2);
  const q = createCourierState();
  stepCourier(q, 1 / 240, input([], ['Space']), h.env);
  stepCourier(q, 1 / 240, input([], ['Space']), h.env);
  coreRun(q, h, 0.3);
  assert.equal(q.flips, 2, 'a press inside the cooldown is kept until it ends');
  assert.equal(q.flipIntent, null);
  const late = createCourierState();
  stepCourier(late, 1 / 240, input([], ['Space']), h.env);
  coreRun(late, h, 0.5);
  late.flipIntent = late.time - 0.01;
  stepCourier(late, 1 / 240, input(), h.env);
  assert.equal(late.flipIntent, null, 'an expired press is discarded');
});
test('courier buffered handoff follows contact and damage so a broken arrival cannot score', () => {
  for (const spares of [0, 3]) {
    const h = harness(),
      s = carrying(createCourierState());
    Object.assign(s.player, { x: 416, y: 100, vy: -200 });
    s.gravity = -1;
    s.parcel.integrity = 1;
    s.spares = spares;
    stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
    coreRun(s, h, 0.25);
    assert.equal(s.parcel.integrity, 0);
    assert.equal(s.score, 0);
    assert.equal(s.deliveries, 0);
    assert.equal(s.parcel.status, 'carried');
    assert.equal(s.phase, spares ? 'playing' : 'lost');
  }
});
test('courier safe buffered landing hands off only on actual support with correct field and low tangential speed', () => {
  const h = harness(),
    s = carrying(createCourierState());
  Object.assign(s.player, { x: 416, y: 68, vy: -20 });
  s.gravity = -1;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.score, 0);
  coreRun(s, h, 0.2);
  assert.equal(s.deliveries, 1);
  assert.equal(s.score, 480);
  assert.equal(s.mode, 'clear');
  assert.equal(s.player.y, 64);
  const q = carrying(createCourierState());
  Object.assign(q.player, { x: 416, y: 64, vx: 60, vy: 0 });
  q.gravity = -1;
  stepCourier(q, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(q.deliveries, 0);
  assert.equal(q.score, 0);
});
test('courier pickup is explicit, stays inside collider, and combines stationary cargo momentum conservatively', () => {
  const h = harness(),
    s = createCourierState();
  s.player.vx = 6;
  stepCourier(s, 1e-7, input([], ['KeyX']), h.env);
  assert.equal(s.parcel.status, 'carried');
  assert(Math.abs(s.player.vx - 6 / 1.65) < 1e-5);
  assert.equal(s.score, 0);
  for (const r of COURIER_ROOMS) {
    assert(r.source.x > 34 && r.destination.x < 446);
    assert(r.integrity > 0);
  }
  assert.equal(s.player.w, 20);
  assert.equal(s.player.h, 24);
});
test('courier repeated hard legal crossings exhaust explicit repack stock and end exactly once', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  g.update(1 / 60, input([], ['KeyX']));
  for (let attempt = 0; attempt < 4 && g.getState().phase === 'playing'; attempt++) {
    for (let i = 0; i < 2; i++) {
      g.update(1 / 60, input([], ['Space']));
      hold(g, 2);
    }
    if (attempt < 3) {
      assert.equal(g.getState().parcel.integrity, 0);
      g.update(1 / 60, input([], ['KeyX']));
      hold(g, 0.8);
      assert.equal(g.getState().spares, 2 - attempt);
      assert.equal(g.getState().parcel.integrity, 3);
    }
  }
  assert.equal(g.getState().phase, 'lost');
  assert.equal(g.getState().spares, 0);
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].message.includes('备用'));
  const terminal = g.getState();
  hold(g, 2, 60, ['ArrowRight']);
  g.update(1 / 60, input([], ['KeyX', 'Space']));
  assert.deepEqual(g.getState(), terminal);
  assert.equal(h.ends.length, 1);
});
test('courier all paused and invalid updates freeze busy buffers and repack resources too', () => {
  const h = harness(),
    s = carrying(createCourierState());
  s.parcel.integrity = 0;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.mode, 'repack');
  const before = structuredClone(s),
    sounds = h.sounds.length;
  for (const dt of [0, -1, NaN, Infinity])
    stepCourier(s, dt, input(['ArrowRight'], ['Space', 'KeyX']), h.env);
  assert.deepEqual(s, before);
  assert.equal(h.sounds.length, sounds);
});

test('courier a field-ready buffered handoff at the exact interaction deadline is reconsidered after the flip', () => {
  const h = harness(),
    s = carrying(createCourierState());
  Object.assign(s.player, { x: 416, y: 64.01, vx: 0, vy: -10 });
  s.gravity = 1;
  const t = (10 - Math.sqrt(100 - 360 * 0.01)) / 180;
  s.flipReadyAt = t;
  s.flipIntent = t + 0.1;
  s.interactIntent = t;
  stepCourier(s, t, input(), h.env);
  assert.equal(s.gravity, -1);
  assert.equal(s.player.y, 64);
  assert.equal(s.deliveries, 1);
  assert.equal(s.score, 480);
});

test('courier vertical forecast chooses earlier momentum-side contact or a real braking stop', () => {
  const h = harness(),
    s = carrying(createCourierState(14));
  Object.assign(s.player, { x: 416, y: 84, vx: 0, vy: -100 });
  s.gravity = 1;
  const landing = courierLanding(s);
  assert.equal(landing.y, 64);
  assert(Math.abs(landing.speed - 20) < 1e-7);
  assert.equal(landing.safe, true);
  const side = carrying(createCourierState(14));
  Object.assign(side.player, { x: 153, y: 264, vx: 100, vy: 0 });
  const wall = courierLanding(side);
  assert.equal(wall.kind, 'contact');
  assert(Math.abs(wall.x - 154) < 1e-7);
  assert(wall.speed > 90);
  assert.equal(wall.safe, false);
  s.player.vy = -50;
  const stop = courierLanding(s);
  assert.equal(stop.kind, 'turn');
  assert(Math.abs(stop.y - (84 - 2500 / 480)) < 1e-7);
  assert.equal(stop.speed, 0);
});

test('courier simultaneous corner impacts combine normals once without scoring damage twice', () => {
  const h = harness(),
    s = carrying(createCourierState()),
    dt = 0.01,
    k = 3 / 1.65;
  Object.assign(s.player, {
    x: 446 - (150 * -Math.expm1(-k * dt)) / k,
    y: 264 - 150 * dt - 90 * dt * dt,
    vx: 150,
    vy: 150,
  });
  stepCourier(s, dt, input(), h.env);
  assert.equal(s.player.x, 446);
  assert.equal(s.player.y, 264);
  assert.equal(s.player.vx, 0);
  assert.equal(s.player.vy, 0);
  assert.equal(s.impacts.length, 1);
  assert.equal(s.impacts[0].normals.length, 2);
  assert.equal(s.parcel.integrity, 2);
});
test('courier sweeping finds a contact before a horizontal velocity reversal even when the endpoint returns away', () => {
  const h = harness(),
    s = createCourierState(6);
  Object.assign(s.player, { x: 145.97, y: 120, vx: 5, vy: 0 });
  stepCourier(s, 1 / 30, input(['ArrowLeft']), h.env);
  assert(s.impacts.some((v) => v.normals.some((n) => n.x === -1)));
  assert(s.player.x < 146);
  assert(s.player.vx < 0);
});
test('courier interaction buffer expires before a later landing and a fresh supported handoff scores once', () => {
  const h = harness(),
    s = carrying(createCourierState());
  Object.assign(s.player, { x: 416, y: 200, vy: -20 });
  s.gravity = -1;
  s.parcel.safeSpeed = 1000;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  coreRun(s, h, 1.5);
  assert.equal(s.player.y, 64);
  assert.equal(s.interactIntent, null);
  assert.equal(s.score, 0);
  assert.equal(s.deliveries, 0);
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.score, 480);
  assert.equal(s.deliveries, 1);
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.score, 480);
  assert.equal(s.deliveries, 1);
});
test('courier clearing a chamber enters the next at once and keeps held controls and a same-frame flip', () => {
  const h = harness(),
    s = carrying(createCourierState());
  Object.assign(s.player, { x: 416, y: 64 });
  s.gravity = -1;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.mode, 'clear');
  assert.equal(s.deliveries, 1);
  stepCourier(s, 1 / 120, input(['ArrowRight'], ['Space']), h.env);
  assert.equal(s.mode, 'clear', 'only the hand-off key leaves the clear screen');
  stepCourier(s, 1 / 120, input([], ['Enter']), h.env);
  assert.equal(s.level, 2);
  assert.equal(s.mode, 'flying');
  assert.equal(s.spares, 3);
  assert.equal(s.parcel.status, 'stored');
  assert.equal(s.score, 480);
  assert.equal(s.deliveries, 1);
  stepCourier(s, 1 / 120, input(['ArrowRight'], ['Space', 'KeyX']), h.env);
  assert.equal(s.parcel.status, 'carried');
  assert.equal(s.gravity, -1);
  assert.ok(s.player.vx > 0);
});
test('courier repack rejects repeated action input and leaves no delayed field or handoff command', () => {
  const h = harness(),
    s = carrying(createCourierState());
  s.parcel.integrity = 1;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.mode, 'repack');
  assert.equal(s.spares, 2);
  while (s.mode === 'repack') stepCourier(s, 1 / 120, input([], ['KeyX', 'Space']), h.env);
  assert.equal(s.parcel.integrity, 3);
  assert.equal(s.spares, 2);
  assert.equal(s.repacks, 1);
  assert.equal(s.gravity, -1, 'a flip pressed during the repack is kept and fires afterwards');
  assert.equal(s.flips, 1);
  assert.equal(s.flipIntent, null);
  assert.equal(s.interactIntent, null);
});
test('courier partial damage without spare stock remains deliverable and does not create a silent loss', () => {
  const h = harness(),
    s = carrying(createCourierState());
  s.parcel.integrity = 2;
  s.spares = 0;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.phase, 'playing');
  assert.equal(s.feedback, 'no-spare');
  assert.equal(s.parcel.integrity, 2);
  assert.equal(s.spares, 0);
  assert.equal(h.ends.length, 0);
  s.player.x = 416;
  s.player.y = 64;
  s.player.vx = 0;
  s.player.vy = 0;
  s.gravity = -1;
  stepCourier(s, 1 / 120, input([], ['KeyX']), h.env);
  assert.equal(s.score, 420);
  assert.equal(s.deliveries, 1);
});
test('courier docking cues report horizontal speed, support and field requirements accurately', () => {
  const h = harness(),
    s = createCourierState();
  assert.equal(courierDockCue(s).reason, 'collect');
  s.player.vx = 30;
  assert.equal(courierDockCue(s).reason, 'slow');
  s.player.vx = 0;
  s.gravity = -1;
  assert.equal(courierDockCue(s).reason, 'field');
  s.gravity = 1;
  s.player.y = 250;
  assert.equal(courierDockCue(s).reason, 'land');
  s.player.y = 264;
  s.player.x = 95;
  assert.equal(courierDockCue(s).reason, 'align');
  s.player.x = 64;
  s.parcel.status = 'carried';
  assert.equal(courierDockCue(s).reason, 'travel');
  s.player.x = 416;
  s.player.y = 64;
  assert.equal(courierDockCue(s).reason, 'field');
  s.gravity = -1;
  assert.equal(courierDockCue(s).reason, 'deliver');
  assert.equal(courierDockCue(s).ready, true);
  s.parcel.integrity = 0;
  s.player.x = 64;
  s.player.y = 264;
  s.gravity = 1;
  assert.equal(courierDockCue(s).reason, 'repack');
});
test('courier displayed coast contact and braking stop agree with actual released-control physics across coil boundaries', () => {
  const fixtures = [
    { level: 1, x: 230, y: 180, vx: 70, vy: -100, g: 1 },
    { level: 6, x: 240, y: 120, vx: 110, vy: 50, g: 1 },
    { level: 14, x: 179, y: 110, vx: 120, vy: -40, g: -1 },
    { level: 14, x: 153, y: 264, vx: 100, vy: 0, g: 1 },
  ];
  for (const f of fixtures) {
    const h = harness(),
      s = carrying(createCourierState(f.level));
    Object.assign(s.player, { x: f.x, y: f.y, vx: f.vx, vy: f.vy });
    s.gravity = f.g;
    const forecast = courierLanding(s);
    assert(['contact', 'turn'].includes(forecast.kind));
    let remaining = forecast.time;
    while (remaining > 1e-10) {
      const dt = Math.min(1 / 120, remaining);
      stepCourier(s, dt, input(), h.env);
      remaining -= dt;
    }
    assert(Math.abs(s.player.x - forecast.x) < 1e-6);
    assert(Math.abs(s.player.y - forecast.y) < 1e-6);
    if (forecast.kind === 'contact') {
      assert(s.impacts.length);
      assert(Math.abs(s.impacts.at(-1).speed - forecast.speed) < 1e-6);
    } else assert(Math.abs(s.player.vy) < 1e-6);
  }
});
test('courier bilingual HUD keeps essential text large and distinguishes wall impact advice from field braking', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 6, 14]) {
      const h = harness({ lang }),
        s = carrying(createCourierState(level));
      Object.assign(s.player, { x: 230, y: 220 });
      s.parcel.integrity = 1;
      s.flash = 0.3;
      s.feedback = 'damaged';
      s.feedbackTime = 3;
      const ctx = mockContext(),
        labels = [];
      ctx.fillText = (value, x, y) =>
        labels.push({ value: String(value), size: Number(ctx.font.match(/(\d+)px/)[1]), x, y });
      s.impacts = [{ normals: [{ x: -1, y: 0 }] }];
      drawCourier(ctx, s, h.env);
      assert(labels.every((v) => v.size >= 14));
      assert(labels.some((v) => v.value.includes(lang === 'en' ? 'COUNTER-THRUST' : '反向推进')));
      s.impacts = [{ normals: [{ x: 0, y: -1 }] }];
      labels.length = 0;
      drawCourier(ctx, s, h.env);
      assert(labels.some((v) => v.value.includes(lang === 'en' ? 'REVERSE FIELD' : '反转动力场')));
      for (const mode of ['repack', 'clear', 'terminal']) {
        s.mode = mode;
        if (mode === 'terminal') s.phase = 'lost';
        drawCourier(ctx, s, h.env);
      }
      s.phase = 'playing';
      s.mode = 'flying';
      s.parcel.integrity = 0;
      drawCourier(ctx, s, h.env);
    }
});
test('courier seeded controls preserve finite bounded nonpenetrating states in every chamber', () => {
  for (const level of [1, 6, 14, 20])
    for (const seed of [1, 17]) {
      const h = harness({ seed }),
        s = createCourierState(level);
      s.parcel.status = 'carried';
      let random = seed;
      const rng = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random / 4294967296;
      };
      for (let i = 0; i < 3600; i++) {
        const a = rng(),
          keys =
            a < 0.35
              ? ['ArrowLeft']
              : a < 0.7
                ? ['ArrowRight']
                : a < 0.75
                  ? ['ArrowLeft', 'ArrowRight']
                  : [];
        stepCourier(
          s,
          1 / 120,
          input(keys, rng() < 0.015 ? ['Space'] : rng() < 0.01 ? ['KeyX'] : []),
          h.env,
        );
        const p = s.player;
        assert([p.x, p.y, p.vx, p.vy, s.time, s.score].every(Number.isFinite));
        assert(p.x >= 34 - 1e-6 && p.x <= 446 + 1e-6 && p.y >= 64 - 1e-6 && p.y <= 264 + 1e-6);
        assert(s.impacts.length <= 16);
        assert(s.spares >= 0 && s.spares <= 3);
        assert(s.parcel.integrity >= 0 && s.parcel.integrity <= s.parcel.maxIntegrity);
        for (const w of COURIER_ROOMS[s.level - 1].walls)
          assert(
            !(
              p.x + 10 > w.x + 1e-6 &&
              p.x - 10 < w.x + w.w - 1e-6 &&
              p.y + 12 > w.y + 1e-6 &&
              p.y - 12 < w.y + w.h - 1e-6
            ),
          );
        if (i % 300 === 0) {
          const guide = courierLanding(s);
          assert(guide.path.length <= 321);
          assert(guide.path.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)));
          drawCourier(mockContext(), s, h.env);
        }
      }
    }
});

test('courier airborne dock guidance preserves a braking field until actual rail contact', () => {
  const h = harness(),
    s = carrying(createCourierState(14));
  Object.assign(s.player, { x: 416, y: 84, vx: 0, vy: -100 });
  s.gravity = 1;
  assert.equal(courierDockCue(s).reason, 'land');
  coreRun(s, h, 1 / 3, 120);
  assert.equal(s.player.y, 64);
  assert.equal(s.parcel.integrity, 2);
  assert.equal(courierDockCue(s).reason, 'field');
});
