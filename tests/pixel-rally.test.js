import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRallyState,
  stepRally,
  roadCurve,
  routeSection,
  sweepVehicles,
  resolveVehicleImpact,
  meta,
} from '../src/games/pixel-rally.js';
import { harness, input, mockContext } from './harness.js';

const vehicle = (extra = {}) => ({
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  heading: 0,
  width: 1.8,
  length: 4.6,
  mass: 1000,
  ...extra,
});
const energy = (v) => (v.mass * (v.vx ** 2 + v.vz ** 2)) / 2;
const run = (game, seconds, keys = [], hz = 120) => {
  for (let n = 0; n < Math.round(seconds * hz); n++) game.update(1 / hz, input(keys));
};

test('rally: neutral input does not supply engine power or turn a stationary car', () => {
  const g = createGame(harness().env);
  run(g, 1, ['ArrowRight']);
  const s = g.getState();
  assert.equal(s.speed, 0);
  assert.equal(s.carX, 0);
  assert.equal(s.distance, 0);
});
test('rally: throttle, coast, brake and steering have finite rates', () => {
  const g = createGame(harness().env);
  run(g, 3, ['ArrowUp']);
  const first = g.getState();
  assert.ok(first.speed > 7 && first.speed < 15);
  run(g, 1);
  assert.ok(g.getState().speed < first.speed);
  const speed = g.getState().speed;
  g.update(1 / 120, input(['ArrowDown', 'ArrowLeft']));
  const next = g.getState();
  assert.ok(next.speed < speed && next.speed > speed - 0.2);
  assert.ok(Math.abs(next.carX - first.carX) < 0.1);
  run(g, 4, ['ArrowDown']);
  assert.equal(g.getState().speed, 0);
});
test('rally: speed is metres/second internally and display conversion is explicit', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  s.player.vz = 20;
  let previous = s.player.z;
  stepRally(s, 1 / 120, input(), h.env);
  assert.ok(s.player.z - previous > 0.16 && s.player.z - previous < 0.17);
  assert.equal(s.speedKmh, Math.round(s.speed * 3.6));
});
test('rally: swept oriented cars catch a high-speed rear impact and reject another lane', () => {
  const rear = vehicle({ vz: 45 }),
    front = vehicle({ z: 12, vz: 20 });
  const hit = sweepVehicles(rear, front, 0.5);
  assert.ok(hit);
  assert.ok(Math.abs(hit.time - 0.296) < 1e-6);
  assert.ok(hit.nz < 0);
  assert.equal(sweepVehicles(rear, { ...front, x: 4 }, 0.5), null);
});
test('rally: passive impact conserves momentum and cannot add kinetic energy', () => {
  const a = vehicle({ vz: 45 }),
    b = vehicle({ z: 8, vz: 15, mass: 1600 });
  const before = energy(a) + energy(b),
    momentum = a.mass * a.vz + b.mass * b.vz;
  const result = resolveVehicleImpact(a, b, { nx: 0, nz: -1 });
  assert.ok(result.closing > 0);
  assert.ok(energy(a) + energy(b) <= before + 1e-7);
  assert.ok(Math.abs(a.mass * a.vz + b.mass * b.vz - momentum) < 1e-7);
  assert.ok(a.vz < 45 && a.vz > 15);
  assert.ok(b.vz > 15);
  assert.notEqual(a.vz, 60);
  const stopped = vehicle(),
    away = vehicle({ z: 5, vz: 20 });
  const unchanged = JSON.stringify([stopped, away]);
  resolveVehicleImpact(stopped, away, { nx: 0, nz: -1 });
  assert.equal(JSON.stringify([stopped, away]), unchanged);
});
test('rally: a rear collision is resolved in place without teleporting traffic or repeatedly damaging', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  s.player.x = roadCurve(200);
  s.player.z = 200;
  s.player.vz = 30;
  s.traffic = [
    vehicle({
      id: 1,
      x: s.player.x,
      z: 206,
      vz: 5,
      targetSpeed: 5,
      lane: 0,
      kind: 'van',
      color: 0,
      touched: false,
      passed: false,
    }),
  ];
  let lastZ = s.traffic[0].z,
    lastPlayerZ = s.player.z;
  for (let n = 0; n < 100; n++) {
    stepRally(s, 1 / 120, input(), h.env);
    const car = s.traffic[0];
    assert.ok(car);
    assert.ok(Math.abs(car.z - lastZ) < 0.4);
    assert.ok(Math.abs(s.player.z - lastPlayerZ) < 0.4);
    lastZ = car.z;
    lastPlayerZ = s.player.z;
  }
  assert.equal(s.health, 3);
  assert.equal(s.overtakes, 0);
  assert.equal(s.traffic[0].touched, true);
});
test('rally: grass drag is a force, not a target-speed clamp, and brakes do not reverse', () => {
  const h = harness(),
    on = createRallyState(),
    off = createRallyState();
  for (const s of [on, off]) {
    s.player.z = 200;
    s.player.x = roadCurve(200);
    s.player.vz = 25;
    s.nextSpawn = 1e9;
    s.nextCoin = 1e9;
  }
  off.player.x += routeSection(200).halfWidth + 0.6;
  for (let n = 0; n < 60; n++) {
    stepRally(on, 1 / 120, input(['ArrowUp']), h.env);
    stepRally(off, 1 / 120, input(['ArrowUp']), h.env);
  }
  assert.ok(on.speed > 25);
  assert.ok(off.speed < 23);
  assert.ok(off.speed > 0);
  for (let n = 0; n < 1000; n++) stepRally(off, 1 / 120, input(['ArrowDown']), h.env);
  assert.equal(off.speed, 0);
  assert.ok(off.player.vz >= 0);
});
test('rally: traffic advances in world space even when the player brakes', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  s.traffic = [
    vehicle({
      id: 2,
      x: roadCurve(30),
      z: 30,
      vz: 20,
      targetSpeed: 20,
      lane: 0,
      kind: 'hatch',
      color: 0,
      touched: false,
      passed: false,
    }),
  ];
  const before = s.traffic[0].z;
  for (let n = 0; n < 60; n++) stepRally(s, 1 / 120, input(['ArrowDown']), h.env);
  assert.ok(s.traffic[0].z > before + 9);
  assert.equal(s.distance, 0);
});
test('rally: six route sections have different surfaces and essential touch sides', () => {
  const starts = [0, 501, 1051, 1601, 2101, 2651].map(routeSection);
  assert.equal(new Set(starts.map((s) => s.name.en)).size, 6);
  assert.ok(new Set(starts.map((s) => s.grip)).size >= 4);
  assert.deepEqual(
    meta.touchControls.map((b) => b.side),
    ['left', 'left', 'right', 'right'],
  );
});

function drivingInput(state) {
  const p = state.player,
    section = routeSection(p.z),
    lanes = section.lanes;
  const options = lanes
    .map((lane) => {
      let risk = Math.abs(p.x - roadCurve(p.z) - lane) * 0.2;
      for (const other of state.traffic) {
        const dz = other.z - p.z;
        if (dz > -5 && dz < 55 && Math.abs(other.lane - lane) < 2.1)
          risk += 120 / (Math.max(0, dz) + 6);
      }
      return { lane, risk };
    })
    .sort((a, b) => a.risk - b.risk);
  const targetX = roadCurve(p.z + Math.max(8, p.vz * 0.45)) + options[0].lane;
  const desiredVx = Math.max(-5, Math.min(5, (targetX - p.x) * 1.8));
  const desiredHeading = Math.atan2(desiredVx, Math.max(8, p.vz));
  const keys = ['ArrowUp'];
  if (p.heading < desiredHeading - 0.016) keys.push('ArrowRight');
  else if (p.heading > desiredHeading + 0.016) keys.push('ArrowLeft');
  const near = state.traffic.some(
    (other) => other.z - p.z > 0 && other.z - p.z < 13 && Math.abs(other.x - p.x) < 2.2,
  );
  if (near) {
    keys.splice(0, 1, 'ArrowDown');
  }
  return input(keys);
}
for (const hz of [30, 60, 120])
  for (const seed of [1, 2, 19])
    test(`rally: full legal six-section drive finishes (${hz} Hz, seed ${seed})`, () => {
      const h = harness({ seed }),
        g = createGame(h.env),
        seen = new Set();
      for (let n = 0; n < hz * 125 && g.getState().phase === 'playing'; n++) {
        g.update(1 / hz, drivingInput(g.getState()));
        const s = g.getState();
        seen.add(s.section);
        if (n % (hz * 2) === 0) {
          g.draw(mockContext());
          assert.ok(s.traffic.length < 20);
          assert.ok(s.coins.length < 40);
          assert.ok(s.dust.length < 80);
          assert.ok(JSON.stringify(s).length < 40000);
        }
      }
      const final = g.getState();
      assert.equal(final.phase, 'won');
      assert.equal(seen.size, 6);
      assert.equal(final.checkpoint, 6);
      assert.ok(final.time > 0);
      assert.equal(h.ends.length, 1);
      assert.equal(
        final.score,
        Math.floor(Math.min(final.distance, final.target)) +
          final.collected * 75 +
          final.overtakes * 100 +
          final.checkpoint * 150 +
          final.health * 150 +
          Math.ceil(final.time) * 10,
      );
      run(g, 2, ['ArrowUp', 'ArrowRight']);
      assert.deepEqual(g.getState(), final);
    });
test('rally: off-road holding cannot bypass the course, and a fresh game resets', () => {
  const h = harness(),
    g = createGame(h.env);
  run(g, 120, ['ArrowUp', 'ArrowRight']);
  const final = g.getState();
  assert.equal(final.phase, 'lost');
  assert.ok(final.distance < final.target);
  assert.equal(h.ends.length, 1);
  run(g, 1, ['ArrowUp']);
  assert.deepEqual(g.getState(), final);
  const fresh = createGame(h.env).getState();
  assert.equal(fresh.score, 0);
  assert.equal(fresh.health, 4);
  assert.equal(fresh.speed, 0);
});
test('rally: a stopped driver reaches the real clock limit once', () => {
  const h = harness(),
    g = createGame(h.env);
  run(g, 120, ['ArrowDown']);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(g.getState().time, 0);
  assert.equal(g.getState().health, 4);
  assert.equal(h.ends.length, 1);
});
test('rally: identical timed input agrees at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ seed: 4 }).env);
    run(g, 2, ['ArrowUp'], hz);
    run(g, 0.5, ['ArrowUp', 'ArrowRight'], hz);
    run(g, 0.5, ['ArrowUp', 'ArrowLeft'], hz);
    return g.getState();
  });
  for (const s of states.slice(1)) {
    assert.ok(Math.abs(s.distance - states[0].distance) < 1e-7);
    assert.ok(Math.abs(s.carX - states[0].carX) < 1e-7);
    assert.ok(Math.abs(s.speed - states[0].speed) < 1e-7);
  }
});
test('rally: drawing is finite, localized and has no simulation side effects', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env);
    run(g, 2, ['ArrowUp']);
    const before = g.getState(),
      ctx = mockContext();
    for (const name of [
      'fillRect',
      'strokeRect',
      'translate',
      'scale',
      'rotate',
      'moveTo',
      'lineTo',
    ])
      ctx[name] = (...args) =>
        args.forEach((v) => {
          if (typeof v === 'number') assert.ok(Number.isFinite(v));
        });
    g.draw(ctx);
    assert.deepEqual(g.getState(), before);
    const copy = g.getState();
    copy.player.x = 99;
    assert.deepEqual(g.getState(), before);
  }
});

test('rally: the finish keeps the final section rather than wrapping to the orchard', () => {
  assert.equal(routeSection(3200).name.en, 'NIGHT RUN');
  assert.equal(routeSection(4000).name.en, 'NIGHT RUN');
});
test('rally: traffic signals and smoothly merges into the narrower bridge lanes', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  s.player.z = 990;
  s.player.x = roadCurve(990);
  s.player.vz = 24;
  s.traffic = [
    vehicle({
      id: 1,
      x: roadCurve(1030) + 3.2,
      z: 1030,
      vz: 24,
      targetSpeed: 24,
      lane: 3.2,
      laneSlot: 1,
      kind: 'van',
      color: 1,
      touched: false,
      passed: false,
    }),
  ];
  let signaled = false,
    previous = s.traffic[0].x;
  for (let n = 0; n < 240; n++) {
    stepRally(s, 1 / 120, input(['ArrowUp']), h.env);
    const car = s.traffic[0];
    assert.ok(car);
    signaled ||= !!car.indicator;
    assert.ok(Math.abs(car.x - previous) < 0.12);
    previous = car.x;
  }
  assert.ok(signaled);
  assert.ok(s.traffic[0].lane < 2.3);
});

test('rally: a guardrail impact dissipates velocity without a position jump', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  Object.assign(s.player, { x: 6.0, z: 0, vx: 8, vz: 28, heading: Math.atan2(8, 28) });
  let hit = false,
    previous = { ...s.player };
  for (let n = 0; n < 80; n++) {
    const beforeEnergy = energy(s.player);
    stepRally(s, 1 / 120, input(), h.env);
    assert.ok(Math.hypot(s.player.x - previous.x, s.player.z - previous.z) < 0.3);
    assert.ok(energy(s.player) <= beforeEnergy + 1e-5);
    hit ||= s.health < 4;
    previous = { ...s.player };
  }
  assert.ok(hit);
  assert.equal(s.health, 3);
});
test('rally: a brief excursion onto the shoulder can be recovered with ordinary controls', () => {
  const h = harness({ seed: 6 }),
    g = createGame(h.env);
  for (let n = 0; n < 700; n++) g.update(1 / 120, drivingInput(g.getState()));
  let reached = false;
  for (let n = 0; n < 300 && g.getState().phase === 'playing'; n++) {
    g.update(1 / 120, input(['ArrowUp', 'ArrowRight']));
    if (g.getState().offroad > 0.4) {
      reached = true;
      break;
    }
  }
  assert.ok(reached);
  for (let n = 0; n < 15000 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, drivingInput(g.getState()));
  assert.equal(g.getState().phase, 'won');
});
test('rally: invalid dt and terminal input cannot mutate the simulation', () => {
  const g = createGame(harness().env),
    before = g.getState();
  for (const dt of [NaN, Infinity, -1, 0]) g.update(dt, input(['ArrowUp', 'ArrowRight']));
  assert.deepEqual(g.getState(), before);
});

test('rally: a side impact does not instantaneously rotate either solid chassis', () => {
  const parked = vehicle({ mass: 1100 });
  const striking = vehicle({ x: 3.2, vx: -10, heading: -Math.PI / 2, mass: 1100 });
  resolveVehicleImpact(parked, striking, { nx: -1, nz: 0 });
  assert.equal(parked.heading, 0);
  assert.equal(striking.heading, -Math.PI / 2);
  assert.ok(parked.vx < 0);
  const overlap = sweepVehicles(parked, striking, 0);
  assert.ok(!overlap || overlap.penetration < 1e-6);
});
test('rally: coasting tyres preserve collision side-slip and remove it only with bounded force', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  Object.assign(s.player, { vx: 5, vz: 20, heading: 0 });
  const before = { ...s.player },
    beforeEnergy = energy(s.player);
  stepRally(s, 1 / 120, input(), h.env);
  assert.ok(Math.hypot(s.player.vx - before.vx, s.player.vz - before.vz) < 0.095);
  assert.ok(s.player.vx > 4.9);
  assert.ok(s.player.vz < 20);
  assert.ok(energy(s.player) < beforeEnergy);
});

test('rally: chassis steering cannot rotate through a touching solid vehicle', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  Object.assign(s.player, { vx: 0, vz: 20, heading: 0 });
  s.traffic = [
    vehicle({
      id: 1,
      x: 3.2,
      z: 0,
      heading: -Math.PI / 2,
      lane: 3.2,
      laneSlot: 1,
      targetSpeed: 0,
      kind: 'van',
      color: 0,
    }),
  ];
  stepRally(s, 1 / 120, input(['ArrowRight']), h.env);
  assert.equal(s.player.heading, 0);
  const contact = sweepVehicles(s.player, s.traffic[0], 0);
  assert.ok(!contact || contact.penetration < 1e-5);
});
test('rally: body yaw and velocity change continuously after a deflected collision', () => {
  const h = harness(),
    s = createRallyState();
  s.nextSpawn = 1e9;
  s.nextCoin = 1e9;
  Object.assign(s.player, { vx: 5, vz: 20, heading: 0 });
  let previous = { ...s.player };
  for (let n = 0; n < 20; n++) {
    stepRally(s, 1 / 120, input(['ArrowRight']), h.env);
    assert.ok(Math.abs(s.player.heading - previous.heading) < 0.005);
    assert.ok(Math.hypot(s.player.vx - previous.vx, s.player.vz - previous.vz) < 0.12);
    previous = { ...s.player };
  }
});

test('rally: newly spawned traffic and moving chassis never interpenetrate during a full drive', () => {
  const g = createGame(harness({ seed: 1 }).env);
  for (let n = 0; n < 15000 && g.getState().phase === 'playing'; n++) {
    g.update(1 / 120, drivingInput(g.getState()));
    const s = g.getState(),
      fleet = [s.player, ...s.traffic];
    for (let a = 0; a < fleet.length; a++)
      for (let b = a + 1; b < fleet.length; b++) {
        const contact = sweepVehicles(fleet[a], fleet[b], 0);
        assert.ok(!contact || contact.penetration < 1e-4, `vehicles overlap at frame ${n}`);
      }
  }
  assert.equal(g.getState().phase, 'won');
});

test('rally: distant resting traffic contacts cannot consume an unrelated player time step', () => {
  const h = harness(),
    state = createRallyState();
  state.nextSpawn = state.nextCoin = 1e9;
  Object.assign(state.player, {
    x: 1.9336644160612866,
    z: 1352.2851096870843,
    vx: 0.4112240864959096,
    vz: 40.30628707667589,
    heading: 0.02791788009638356,
    yaw: 0.11791344438855791,
  });
  state.traffic = [
    vehicle({
      id: 5,
      x: 5.807072547153229,
      z: 1395.2932915273277,
      vx: 0.08146522856813626,
      vz: 20.012485603070452,
      heading: 0.004073449868980699,
      yaw: -0.000017367820903706893,
      width: 1.8,
      length: 4.6,
      mass: 1200,
      targetSpeed: 28.395495171425864,
      lane: 1.85,
      laneSlot: 1,
      kind: 'hatch',
      color: 0,
    }),
    vehicle({
      id: 6,
      x: 5.825991305206149,
      z: 1399.8933235191766,
      vx: 0.07988667013911878,
      vz: 20.012492401267846,
      heading: 0.003994784017120726,
      yaw: -0.00002039416885547818,
      width: 1.8,
      length: 4.6,
      mass: 1200,
      targetSpeed: 27.022242924897,
      lane: 1.85,
      laneSlot: 1,
      kind: 'hatch',
      color: 1,
    }),
    vehicle({
      id: 7,
      x: 5.852826226372693,
      z: 1405.2933688029443,
      vx: 0.07744485902030808,
      vz: 20.012500003576786,
      heading: 0.0038740152983040583,
      yaw: -0.000026608023237455376,
      width: 2.05,
      length: 6.2,
      mass: 3200,
      targetSpeed: 20,
      lane: 1.85,
      laneSlot: 1,
      kind: 'truck',
      color: 2,
    }),
  ];
  const free = structuredClone(state);
  free.traffic = [];
  for (let n = 0; n < 120; n++) {
    stepRally(state, 1 / 120, input(['ArrowUp']), h.env);
    stepRally(free, 1 / 120, input(['ArrowUp']), h.env);
    assert.ok(Math.abs(state.player.z - free.player.z) < 1e-7);
    assert.ok(Math.abs(state.player.x - free.player.x) < 1e-7);
  }
});

test('rally: the gravel shoulder browser sequence keeps moving under power', () => {
  const g = createGame(harness({ seed: 1 }).env);
  for (let n = 0; n < 10000 && g.getState().distance < 850; n++)
    g.update(1 / 120, drivingInput(g.getState()));
  run(g, 10, ['ArrowUp', 'ArrowRight']);
  const before = g.getState();
  assert.equal(before.section, 1);
  assert.ok(before.offroad > 0.9);
  run(g, 1.1, ['ArrowUp', 'ArrowLeft']);
  run(g, 7, ['ArrowUp']);
  const after = g.getState();
  assert.equal(after.phase, 'playing');
  assert.ok(after.distance > before.distance + 15);
  assert.ok(after.speed > 2);
});
test('rally: a full stop on the gravel shoulder can be steered back onto the road', () => {
  const g = createGame(harness({ seed: 1 }).env);
  for (let n = 0; n < 10000 && g.getState().distance < 930; n++)
    g.update(1 / 120, drivingInput(g.getState()));
  for (let n = 0; n < 600 && g.getState().offroad < 0.99; n++)
    g.update(1 / 120, input(['ArrowUp', 'ArrowRight']));
  for (let n = 0; n < 600 && g.getState().speed > 0.0001; n++)
    g.update(1 / 120, input(['ArrowDown']));
  const stopped = g.getState();
  assert.equal(stopped.speed, 0);
  assert.equal(stopped.section, 1);
  assert.ok(stopped.offroad > 0.9);
  let rejoined = false;
  for (let n = 0; n < 960; n++) {
    g.update(1 / 120, input(['ArrowUp', 'ArrowLeft']));
    const s = g.getState();
    rejoined ||= s.offroad < 0.1 && s.speed > 2;
  }
  assert.ok(rejoined);
  assert.ok(g.getState().distance > stopped.distance + 15);
});

for (const distance of [250, 775, 1325, 1850, 2375, 2925])
  for (const side of [-1, 1])
    test(`rally: powered recovery from rest on either shoulder at ${distance}m, side ${side}`, () => {
      const h = harness(),
        s = createRallyState();
      s.nextSpawn = s.nextCoin = 1e9;
      Object.assign(s.player, {
        z: distance,
        x: roadCurve(distance) + side * (routeSection(distance).halfWidth + 1.05),
        vx: 0,
        vz: 0,
        heading: 0,
      });
      let rejoined = false;
      for (let n = 0; n < 960; n++) {
        stepRally(s, 1 / 120, input(['ArrowUp', side > 0 ? 'ArrowLeft' : 'ArrowRight']), h.env);
        rejoined ||= s.offroad < 0.1 && s.speed > 2;
      }
      assert.ok(rejoined);
      assert.ok(s.distance > distance + 15);
      assert.equal(s.phase, 'playing');
    });

for (const distance of [170, 620, 1260, 1720, 2340, 2970])
  for (const side of [-1, 1])
    test(`rally: inward wheel traction recovers from tangent guardrail rest at ${distance}m, side ${side}`, () => {
      const h = harness(),
        s = createRallyState();
      s.nextSpawn = s.nextCoin = 1e9;
      const slope = (roadCurve(distance + 0.1) - roadCurve(distance - 0.1)) / 0.2;
      Object.assign(s.player, {
        z: distance,
        x:
          roadCurve(distance) +
          side * (routeSection(distance).halfWidth + 2.2 - 0.9 - 2.3 * Math.abs(slope)),
        vx: 0,
        vz: 0,
        heading: 0,
      });
      let rejoined = false,
        previous = { ...s.player };
      for (let n = 0; n < 960; n++) {
        const speed = Math.hypot(previous.vx, previous.vz);
        stepRally(s, 1 / 120, input(['ArrowUp', side > 0 ? 'ArrowLeft' : 'ArrowRight']), h.env);
        assert.ok(
          Math.hypot(s.player.x - previous.x, s.player.z - previous.z) <= speed / 120 + 0.02,
          'no positional recovery jump',
        );
        previous = { ...s.player };
        rejoined ||= s.offroad < 0.1 && s.speed > 2;
      }
      assert.ok(rejoined);
      assert.ok(s.distance > distance + 15);
    });
