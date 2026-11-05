import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  PHYSICS,
  createGame,
  createGrapnelState,
  updateGrapnelState,
  anchorPose,
  pendulumStep,
  advanceTaut,
  captureRope,
  mechanicalEnergy,
  sweepCircle,
  segmentHit,
  movingRopeHit,
  routePlan,
} from '../src/games/grapnel-gorge.js';
import { harness, input, mockContext } from './harness.js';
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const poseBody = (q, w, l, rate, a) => ({
  x: a.x + l * Math.sin(q),
  y: a.y + l * Math.cos(q),
  vx: a.vx + rate * Math.sin(q) + l * w * Math.cos(q),
  vy: a.vy + rate * Math.cos(q) - l * w * Math.sin(q),
  ground: false,
});
export function fixture({
  theta = 0.6,
  omega = 0.7,
  length = 110,
  rate = 0,
  charge = PHYSICS.battery,
  anchor = { id: 0, x: 220, y: 80 },
} = {}) {
  const s = createGrapnelState(),
    a = anchorPose(anchor, 0);
  s.route = {
    id: 'unit-fixture',
    name: { en: 'Fixture', zh: '测试' },
    lesson: { en: 'Fixture', zh: '测试' },
    anchors: [anchor],
    pads: [],
    solids: [],
    relics: [],
  };
  s.player = poseBody(theta, omega, length, rate, a);
  s.rope = { id: 0, x: a.x, y: a.y, length, rate, theta, omega, taut: true, tension: 0 };
  s.charge = charge;
  s.energyBaseline = mechanicalEnergy(s.player);
  return s;
}

test('Grapnel every essential action has bilingual keyboard and touch access', () => {
  assert.equal(meta.genre, 'action');
  assert.equal(meta.touch, true);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyX',
    'KeyZ',
    'Enter',
  ])
    assert.ok(meta.touchControls.some((t) => t.code === code && t.label.en && t.label.zh));
  assert.ok(!meta.touchControls.some((t) => ['KeyR', 'KeyP', 'Escape'].includes(t.code)));
});
test('Grapnel discrete-gradient pendulum conserves energy through reversals and upper arcs', () => {
  for (const [theta, omega, length] of [
    [-0.9, 0, 140],
    [0.8, -1.1, 90],
    [2.8, 0.1, 170],
    [-2.2, 3.8, 64],
    [0, 0, 110],
  ]) {
    let q = theta,
      w = omega;
    const initial = 0.5 * length * length * w * w - PHYSICS.gravity * length * Math.cos(q);
    for (let n = 0; n < 12000; n++) {
      const result = pendulumStep(q, w, length, 1 / 240);
      q = result.theta;
      w = result.omega;
      assert.ok(Math.abs(result.residual) < 1e-12);
      if (n % 240 === 0)
        near(0.5 * length * length * w * w - PHYSICS.gravity * length * Math.cos(q), initial, 2e-5);
    }
  }
});
test('Grapnel static fixed rope adds no work and stays on its exact geometric constraint', () => {
  const a = { id: 0, x: 200, y: 60 },
    rope = { id: 0, length: 130, rate: 0, theta: 0.8, omega: 0.5, taut: true };
  let r = rope,
    p = poseBody(r.theta, r.omega, r.length, 0, anchorPose(a, 0)),
    initial = mechanicalEnergy(p),
    error = 0;
  for (let n = 0; n < 6000; n++) {
    const next = advanceTaut(r, a, n / 240, 1 / 240);
    r = next.rope;
    p = next.player;
    error += next.numerical;
    near(Math.hypot(p.x - 200, p.y - 60), 130, 1e-10);
    assert.equal(next.anchorWork, 0);
    assert.equal(next.winchWork, 0);
  }
  near(mechanicalEnergy(p), initial, 2e-6);
  assert.ok(Math.abs(error) < 2e-6);
});
test('Grapnel slack capture is unilateral and a low-speed upper rope cannot push', () => {
  const a = { id: 0, x: 100, y: 100, vx: 0, vy: 0, ax: 0, ay: 0 };
  const inward = { x: 100, y: 200, vx: 0, vy: -30, ground: false };
  let result = captureRope(inward, a, 100);
  assert.equal(result.rope.taut, false);
  assert.deepEqual(result.player, inward);
  assert.equal(result.captureLoss, 0);
  result = captureRope({ x: 100, y: 0, vx: 0, vy: 0, ground: false }, a, 100);
  assert.equal(result.rope.taut, false);
  assert.equal(result.rope.tension, 0);
  const s = fixture({ theta: Math.PI, omega: 0, length: 100 });
  updateGrapnelState(s, 0.1, input(), harness().env);
  assert.equal(s.rope.taut, false);
  assert.ok(s.player.y > -20 && s.player.vy > 0);
});
test('Grapnel radial capture independently accounts support work and inelastic loss', () => {
  for (const [vx, vy, rate, avx, avy] of [
    [50, 100, 0, 0, 0],
    [50, 100, -20, 17, -9],
    [-40, 120, 25, -20, 14],
  ]) {
    const a = { id: 0, x: 100, y: 80, vx: avx, vy: avy, ax: 0, ay: 0 },
      p = { x: 160, y: 160, vx, vy, ground: false },
      before = mechanicalEnergy(p),
      r = captureRope(p, a, 100, rate),
      nx = 0.6,
      ny = 0.8;
    near((r.player.vx - avx) * nx + (r.player.vy - avy) * ny, rate);
    near(mechanicalEnergy(r.player) - before, r.anchorWork + r.winchWork - r.captureLoss, 1e-8);
    assert.ok(r.captureLoss >= 0);
    near(r.rope.length, 100);
  }
});
test('Grapnel release retains tangential, moving-anchor and reel radial world momentum', () => {
  const a = { id: 0, x: 210, y: 80, amplitudeX: 20, amplitudeY: 8, frequency: 0.9, phase: 0.3 },
    s = fixture({ theta: 0.6, omega: 0.8, length: 120, rate: -20, anchor: a });
  const before = { ...s.player };
  updateGrapnelState(s, PHYSICS.step, input([], ['Space']), harness().env);
  assert.equal(s.rope, null);
  near(s.player.vx, before.vx);
  near(s.player.vy, before.vy + PHYSICS.gravity * PHYSICS.step);
  near(s.player.x, before.x + before.vx * PHYSICS.step);
});
test('Grapnel reeling changes radial speed and does independently calculated tension work', () => {
  const a = { id: 0, x: 200, y: 70 },
    r = { id: 0, length: 160, rate: -20, theta: 0.5, omega: 0.7, taut: true },
    h = 1e-5,
    next = advanceTaut(r, a, 0, h),
    n = { x: Math.sin(next.rope.theta), y: Math.cos(next.rope.theta) },
    t0 = PHYSICS.gravity * Math.cos(r.theta) + r.length * r.omega * r.omega;
  near(next.player.vx * n.x + next.player.vy * n.y, -20, 1e-9);
  near(next.winchWork, -t0 * r.rate * h, 1e-3);
  assert.ok(next.winchWork > 0);
  assert.equal(next.anchorWork, 0);
  assert.ok(Math.abs(next.numerical) < 1e-7);
});
test('Grapnel moving anchor velocity and its motor work are present without free energy', () => {
  const a = { id: 0, x: 210, y: 70, amplitudeX: 20, amplitudeY: 7, frequency: 0.8, phase: 0.3 };
  let r = { id: 0, length: 125, rate: 0, theta: 0.65, omega: 0.4, taut: true },
    initial = mechanicalEnergy(poseBody(r.theta, r.omega, r.length, 0, anchorPose(a, 0))),
    work = 0,
    error = 0,
    p;
  for (let n = 0; n < 720; n++) {
    const next = advanceTaut(r, a, n / 240, 1 / 240);
    r = next.rope;
    p = next.player;
    work += next.anchorWork;
    error += next.numerical;
    const pose = anchorPose(a, (n + 1) / 240),
      normal = { x: Math.sin(r.theta), y: Math.cos(r.theta) };
    near((p.vx - pose.vx) * normal.x + (p.vy - pose.vy) * normal.y, 0, 1e-8);
  }
  assert.ok(Math.abs(work) > 1);
  near(mechanicalEnergy(p) - initial, work, 2e-4);
  assert.ok(Math.abs(error) < 2e-4);
});
test('Grapnel circle sweeps stop thin walls and reject separating/tangent contact', () => {
  const wall = { x: 100, y: 60, w: 2, h: 140 };
  let hit = sweepCircle({ x: 20, y: 100 }, { x: 200, y: 100 }, 7, wall);
  near(hit.at, 73 / 180);
  assert.equal(hit.nx, -1);
  assert.equal(hit.ny, 0);
  assert.equal(sweepCircle({ x: 93, y: 100 }, { x: 80, y: 100 }, 7, wall), null);
  assert.equal(sweepCircle({ x: 93, y: 100 }, { x: 93, y: 130 }, 7, wall), null);
  hit = sweepCircle({ x: 70, y: 20 }, { x: 110, y: 70 }, 7, wall);
  assert.ok(hit && hit.at < 1);
  near(Math.hypot(hit.nx, hit.ny), 1, 1e-7);
});
test('Grapnel hook rays and continuously swept ropes honor visible rocks', () => {
  const rock = { x: 40, y: -5, w: 10, h: 10 };
  assert.equal(segmentHit({ x: 0, y: -100 }, { x: 100, y: -100 }, rock), null);
  assert.ok(segmentHit({ x: 0, y: 0 }, { x: 100, y: 0 }, rock));
  const hit = movingRopeHit(
    { x: 0, y: 0 },
    { x: 100, y: -100 },
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    [rock],
  );
  assert.ok(hit && hit.at > 0.4 && hit.at < 0.5);
  assert.equal(
    movingRopeHit({ x: 0, y: -100 }, { x: 100, y: -100 }, { x: 0, y: -80 }, { x: 100, y: -80 }, [
      rock,
    ]),
    null,
  );
});
test('Grapnel the three authored routes differ in anchors, obstruction and safe rests', () => {
  const [a, b, c] = [1, 2, 3].map(routePlan);
  assert.equal(a.anchors.length, 1);
  assert.equal(a.pads.length, 2);
  assert.equal(b.anchors.length, 2);
  assert.equal(b.pads.length, 3);
  assert.ok(b.rocks.length);
  assert.ok(c.anchors.some((a) => a.amplitudeX) && c.anchors.some((a) => a.amplitudeY));
  for (const route of [a, b, c]) {
    assert.ok(route.pads.at(-1).exit);
    for (const p of route.pads)
      assert.ok(
        route.solids.some((r) => r.kind === 'cairn' && r.x === p.x && r.y === p.y && r.w === p.w),
      );
  }
});
test('Grapnel winch exhaustion is an event and cannot overspend its physical work budget', () => {
  const s = fixture({ theta: 0.6, omega: 0.3, length: 160, charge: 1000 }),
    initial = mechanicalEnergy(s.player);
  for (let n = 0; n < 120; n++) updateGrapnelState(s, 1 / 120, input(['ArrowUp']), harness().env);
  assert.ok(s.charge >= 0 && s.charge < 1e-6);
  assert.ok(s.ledger.spent <= 1000 + 1e-6);
  assert.equal(s.rope.rate, 0);
  assert.ok(mechanicalEnergy(s.player) - initial <= 1000 + 1e-3);
  assert.ok(Number.isFinite(s.player.vx));
});
test('Grapnel near-empty repeated winch changes cannot inject uncharged impulses', () => {
  const s = fixture({ charge: 0.01 }),
    initial = mechanicalEnergy(s.player);
  for (let n = 0; n < 600; n++)
    updateGrapnelState(s, PHYSICS.step, input(n % 2 ? [] : ['ArrowUp']), harness().env);
  assert.ok(s.ledger.spent <= 0.01 + 1e-7);
  assert.ok(mechanicalEnergy(s.player) - initial < 1e-3);
  assert.ok(s.rope.length >= PHYSICS.minLength - 1e-6);
});
test('Grapnel a rock cut is visible feedback and preserves momentum rather than teleporting', () => {
  const s = fixture({ theta: 0.6, omega: 0.3, length: 120 });
  const a = anchorPose(s.route.anchors[0], 0);
  s.route.solids = [
    { x: (a.x + s.player.x) / 2 - 3, y: (a.y + s.player.y) / 2 - 5, w: 6, h: 10, kind: 'rock' },
  ];
  const before = { ...s.player };
  updateGrapnelState(s, PHYSICS.step, input(), harness().env);
  assert.equal(s.rope, null);
  assert.equal(s.lastEvent, 'cut');
  assert.equal(s.flash.type, 'cut');
  near(s.player.x, before.x + before.vx * PHYSICS.step, 1e-6);
  near(s.player.vx, before.vx, 1e-6);
});
test('Grapnel draw smoke includes both localized fresh canyon views', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env);
    g.draw(mockContext());
    g.update(1 / 60, input([], ['Space']));
    g.draw(mockContext());
  }
});

test('Grapnel a wall and rope can support a stationary climber without lost time or creep', () => {
  const a = { id: 0, x: 194, y: 80 },
    dx = 6,
    dy = 100,
    length = Math.hypot(dx, dy),
    s = fixture({ theta: Math.atan2(dx, dy), omega: 0, length, anchor: a });
  s.route.solids = [{ x: 20, y: 100, w: 173, h: 250, kind: 'rock' }];
  const before = { ...s.player };
  updateGrapnelState(s, 1 / 60, input(), harness().env);
  near(s.time, 1 / 60, 1e-9);
  near(s.player.x, before.x);
  near(s.player.y, before.y);
  near(s.player.vx, 0);
  near(s.player.vy, 0);
  const y = s.player.y;
  updateGrapnelState(s, 1 / 60, input([], ['Space']), harness().env);
  assert.equal(s.rope, null);
  assert.ok(s.player.y > y && s.player.vy > 0);
});
test('Grapnel winching along a contacted wall moves continuously with accounted work', () => {
  const a = { id: 0, x: 194, y: 80 },
    dx = 6,
    dy = 100,
    length = Math.hypot(dx, dy),
    s = fixture({ theta: Math.atan2(dx, dy), omega: 0, length, anchor: a });
  s.route.solids = [{ x: 20, y: 100, w: 173, h: 250, kind: 'rock' }];
  const before = mechanicalEnergy(s.player);
  for (let n = 0; n < 30; n++) updateGrapnelState(s, 1 / 120, input(['ArrowUp']), harness().env);
  near(s.time, 0.25, 1e-8);
  near(s.player.x, 200, 1e-6);
  assert.ok(s.player.y < 175 && s.player.y > 160);
  assert.ok(s.ledger.winch > 0);
  near(
    mechanicalEnergy(s.player) - before,
    s.ledger.winch +
      s.ledger.anchor -
      s.ledger.contactLoss -
      s.ledger.captureLoss +
      s.ledger.numerical,
    1e-3,
  );
});

test('Grapnel a rounded cairn corner consumes time and lets a released climber slide off', () => {
  const s = fixture();
  s.rope = null;
  s.route.solids = [{ x: 12, y: 252, w: 116, h: 148, kind: 'rock' }];
  s.player = {
    x: 128.11083290189785,
    y: 245.0008774787223,
    vx: 19.50870320829609,
    vy: 0.3089253234618645,
    ground: false,
  };
  s.energyBaseline = mechanicalEnergy(s.player);
  const x = s.player.x;
  updateGrapnelState(s, 1 / 30, input(), harness().env);
  near(s.time, 1 / 30, 1e-9);
  assert.ok(s.player.x > x);
  const gap = Math.hypot(s.player.x - 128, s.player.y - 252) - 7;
  assert.ok(gap >= -1e-7);
});
test('Grapnel separating zero-reaction corner tangency is not counted as another impact', () => {
  const s = fixture();
  s.rope = null;
  s.route.solids = [{ x: 12, y: 252, w: 116, h: 148, kind: 'rock' }];
  s.player = {
    x: 132.89822361439045,
    y: 246.9992595124894,
    vx: 32.739955247616926,
    vy: 32.06877508010721,
    ground: false,
  };
  const before = mechanicalEnergy(s.player);
  s.energyBaseline = before;
  updateGrapnelState(s, 1 / 60, input(), harness().env);
  near(s.time, 1 / 60, 1e-9);
  near(s.player.vx, 32.739955247616926, 1e-8);
  near(mechanicalEnergy(s.player), before, 1e-6);
});

test('Grapnel fully paid out and reeled in boundaries preserve all elapsed time', () => {
  const s = fixture({ theta: 0.2, omega: 0, length: 100, anchor: { id: 0, x: 220, y: 0 } }),
    h = harness();
  for (let n = 0; n < 120 * 3; n++) updateGrapnelState(s, 1 / 120, input(['ArrowUp']), h.env);
  near(s.rope.length, 58, 1e-7);
  near(s.time, 3, 1e-7);
  assert.equal(s.rope.rate, 0);
  for (let n = 0; n < 120 * 7; n++) updateGrapnelState(s, 1 / 120, input(['ArrowDown']), h.env);
  near(s.rope.length, 238, 1e-7);
  near(s.time, 10, 1e-7);
  assert.equal(s.rope.rate, 0);
  assert.equal(s.phase, 'playing');
});
test('Grapnel a depleted hanging climber can still release and explicitly rescue', () => {
  const s = fixture({ theta: 0.1, omega: 0, length: 110, charge: 0 });
  s.route.pads = routePlan(1).pads;
  s.route.solids = routePlan(1).solids;
  const h = harness();
  updateGrapnelState(s, 1 / 120, input(['ArrowUp']), h.env);
  assert.equal(s.rope.rate, 0);
  assert.equal(s.charge, 0);
  updateGrapnelState(s, 1 / 120, input([], ['Space']), h.env);
  assert.equal(s.rope, null);
  updateGrapnelState(s, 1 / 120, input([], ['KeyZ']), h.env);
  assert.equal(s.lives, 4);
  assert.equal(s.player.ground, true);
  assert.equal(s.charge, PHYSICS.battery);
  assert.equal(s.checkpoint, 0);
});
test('Grapnel blocked and out-of-range hooks reject without consuming charge or moving the climber', () => {
  for (const blocked of [true, false]) {
    const s = fixture();
    s.rope = null;
    s.player = { x: 62, y: 245, vx: 0, vy: 0, ground: true };
    s.route.pads = [{ id: 0, x: 12, y: 252, w: 116 }];
    s.route.solids = [{ x: 12, y: 252, w: 116, h: 148, kind: 'cairn' }];
    s.route.anchors = [{ id: 0, x: blocked ? 190 : 400, y: 80 }];
    if (blocked) s.route.solids.push({ x: 120, y: 120, w: 12, h: 80, kind: 'rock' });
    const before = { ...s.player };
    updateGrapnelState(s, 1 / 120, input([], ['Space']), harness().env);
    assert.equal(s.rope, null);
    assert.deepEqual(s.player, before);
    assert.equal(s.charge, PHYSICS.battery);
    assert.equal(s.score, 0);
  }
});
test('Grapnel relic pickups score once even after the same visible relic is revisited', () => {
  const s = fixture({ theta: 0.4, omega: 0.3 });
  s.route.relics = [{ id: 'unit-relic', x: s.player.x, y: s.player.y }];
  const h = harness();
  updateGrapnelState(s, 1 / 120, input(), h.env);
  assert.equal(s.score, 250);
  assert.deepEqual(s.collected, ['unit-relic']);
  for (let n = 0; n < 120 * 10; n++) updateGrapnelState(s, 1 / 120, input(), h.env);
  assert.equal(s.score, 250);
  assert.equal(h.sounds.filter((s) => s === 'coin').length, 1);
});

test('Grapnel an outward support reaction or negative rope tension releases the appropriate constraint', () => {
  for (const a of [
    { id: 0, x: 240, y: 80 },
    { id: 0, x: 194, y: 280 },
  ]) {
    const dx = 200 - a.x,
      dy = 180 - a.y,
      s = fixture({ theta: Math.atan2(dx, dy), omega: 0, length: Math.hypot(dx, dy), anchor: a });
    s.route.solids = [{ x: 20, y: 100, w: 173, h: 250, kind: 'rock' }];
    updateGrapnelState(s, 1 / 30, input(), harness().env);
    near(s.time, 1 / 30, 1e-9);
    if (a.x === 240) {
      assert.ok(s.player.x > 200);
      assert.ok(!s.rope.wall);
    } else {
      assert.equal(s.rope.taut, false);
      assert.equal(s.rope.tension, 0);
      assert.ok(s.player.y > 180);
    }
  }
});
test('Grapnel zero tension while crossing an upper arc detaches without a zero-time recapture loop', () => {
  const theta = 2,
    omega = Math.sqrt((-PHYSICS.gravity * Math.cos(theta)) / 100),
    s = fixture({ theta, omega, length: 100 });
  updateGrapnelState(s, 1 / 30, input(), harness().env);
  near(s.time, 1 / 30, 1e-8);
  assert.equal(s.rope.taut, false);
  assert.equal(s.rope.tension, 0);
  assert.ok(Number.isFinite(s.player.vx));
});

test('Grapnel actual relic entry time is ordered before water, with fatal contact winning an exact tie', () => {
  for (const [offset, score] of [
    [-0.001, 250],
    [0, 0],
    [0.001, 0],
  ]) {
    const s = createGrapnelState();
    s.route.solids = [];
    s.route.relics = [{ id: 'water-edge', x: 200, y: 314 + offset }];
    s.player = { x: 200, y: 295, vx: 0, vy: 200, ground: false };
    s.energyBaseline = mechanicalEnergy(s.player);
    updateGrapnelState(s, 1 / 30, input(), harness().env);
    assert.equal(s.lives, 4);
    assert.equal(s.score, score, `offset ${offset}`);
  }
});

test('Grapnel a taut rope and rounded cairn corner can rest together and reel without dropping time', () => {
  const s = createGrapnelState();
  s.level = 2;
  s.route = routePlan(2);
  s.checkpoint = 1;
  s.visited = [0, 1];
  s.player = { x: 286.9644704484431, y: 257.2956198662915, vx: 0, vy: 0, ground: false };
  const a = anchorPose(s.route.anchors[0], 0),
    length = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  s.rope = {
    id: 0,
    x: a.x,
    y: a.y,
    length,
    rate: 0,
    theta: Math.atan2(s.player.x - a.x, s.player.y - a.y),
    omega: 0,
    taut: true,
    tension: 0,
  };
  s.energyBaseline = mechanicalEnergy(s.player);
  const before = { ...s.player };
  updateGrapnelState(s, 1 / 60, input(), harness().env);
  near(s.time, 1 / 60, 1e-8);
  near(s.player.x, before.x, 1e-7);
  near(s.player.y, before.y, 1e-7);
  for (let n = 0; n < 12; n++) updateGrapnelState(s, 1 / 120, input(['ArrowUp']), harness().env);
  near(s.time, 1 / 60 + 0.1, 1e-7);
  assert.ok(s.player.y < before.y);
  assert.ok(s.ledger.winch > 0);
  const gap = Math.hypot(s.player.x - 280, s.player.y - 258) - 7;
  assert.ok(gap >= -1e-6);
  assert.ok(
    Math.abs(
      mechanicalEnergy(s.player) -
        s.energyBaseline -
        s.ledger.winch -
        s.ledger.anchor +
        s.ledger.contactLoss +
        s.ledger.captureLoss -
        s.ledger.numerical,
    ) < 0.01,
  );
});

test('Grapnel paying rope out cannot push a hanging climber outward or spend impulse energy', () => {
  const s = fixture({ theta: 0, omega: 0, length: 110 }),
    before = { ...s.player };
  updateGrapnelState(s, PHYSICS.step, input(['ArrowDown']), harness().env);
  assert.equal(s.rope.taut, false);
  near(s.player.vx, before.vx);
  near(s.player.vy, PHYSICS.gravity * PHYSICS.step);
  near(s.player.y, before.y + (PHYSICS.gravity * PHYSICS.step * PHYSICS.step) / 2);
  assert.equal(s.ledger.spent, 0);
  assert.equal(s.rope.tension, 0);
});
test('Grapnel stopping inward reeling leaves inward momentum and a slack cable', () => {
  const s = fixture({ theta: 0, omega: 0, length: 110, rate: -32 }),
    before = { ...s.player };
  updateGrapnelState(s, PHYSICS.step, input(), harness().env);
  assert.equal(s.rope.taut, false);
  assert.equal(s.rope.rate, 0);
  near(s.player.vx, before.vx);
  near(s.player.vy, before.vy + PHYSICS.gravity * PHYSICS.step);
  assert.equal(s.ledger.winch, 0);
  assert.equal(s.ledger.spent, 0);
});

test('Grapnel nearly parallel rope and corner constraints release without NaN or zero-time cycling', () => {
  for (const q of [Math.PI / 2, 2, 2.8, Math.PI - 1e-5])
    for (const direction of [-1, 1])
      for (const perturb of [-1e-6, 0, 1e-6]) {
        const nc = { x: Math.sin(q), y: Math.cos(q) },
          p = { x: 280 + 7 * nc.x, y: 258 + 7 * nc.y },
          angle = q + perturb + (direction < 0 ? Math.PI : 0),
          nr = { x: Math.sin(angle), y: Math.cos(angle) },
          a = { id: 0, x: p.x - 110 * nr.x, y: p.y - 110 * nr.y },
          s = fixture({ theta: Math.atan2(nr.x, nr.y), omega: 0, length: 110, anchor: a });
        s.player = { ...p, vx: 0, vy: 0, ground: false };
        s.energyBaseline = mechanicalEnergy(s.player);
        s.route.solids = [{ x: 218, y: 258, w: 62, h: 142, kind: 'rock' }];
        updateGrapnelState(s, 1 / 60, input(), harness().env);
        near(s.time, 1 / 60, 1e-7);
        assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.y));
        assert.ok(Math.hypot(s.player.x - 280, s.player.y - 258) >= 7 - 1e-5);
        if (s.rope) assert.ok(s.rope.tension >= 0);
      }
});
test('Grapnel a rounded joint transitions to free motion or flat support under continued reeling', () => {
  const s = createGrapnelState();
  s.level = 2;
  s.route = routePlan(2);
  s.checkpoint = 1;
  s.visited = [0, 1];
  s.player = { x: 286.9644704484431, y: 257.2956198662915, vx: 0, vy: 0, ground: false };
  const a = anchorPose(s.route.anchors[0], 0),
    length = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  s.rope = {
    id: 0,
    x: a.x,
    y: a.y,
    length,
    rate: 0,
    theta: Math.atan2(s.player.x - a.x, s.player.y - a.y),
    omega: 0,
    taut: true,
    tension: 0,
  };
  s.energyBaseline = mechanicalEnergy(s.player);
  for (let n = 0; n < 120; n++) updateGrapnelState(s, 1 / 120, input(['ArrowUp']), harness().env);
  near(s.time, 1, 1e-7);
  assert.equal(s.phase, 'playing');
  assert.ok(s.player.y < 251);
  assert.ok(Number.isFinite(s.ledger.numerical));
});
