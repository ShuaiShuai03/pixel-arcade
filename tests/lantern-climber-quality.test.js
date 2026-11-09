import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createClimbState,
  stepClimb,
  REST_RATE,
} from '../src/games/lantern-climber.js';
import { harness, input, mockContext, seeded } from './harness.js';
function on(s, id, offset = 40) {
  const l = s.ledges[id],
    p = s.player;
  Object.assign(p, {
    x: l.x + offset,
    y: l.y - p.h,
    vx: l.vx,
    vy: 0,
    ax: l.ax,
    ay: 0,
    ground: id,
    grip: null,
  });
}
function run(s, seconds, held = [], pressed = []) {
  for (let n = 0; n < Math.round(seconds * 240); n++)
    stepClimb(s, 1 / 240, input(held, n === 0 ? pressed : []));
}
test('lantern: reachable-edge grace is once per supported launch and cannot create air jumps', () => {
  const s = createClimbState();
  on(s, 0, s.ledges[0].w - 1);
  s.player.vx = 100;
  s.edge = null;
  s.coyote = 0;
  stepClimb(s, 0.02, input());
  assert.equal(s.player.ground, null);
  assert.ok(s.coyote > 0);
  stepClimb(s, 1 / 240, input([], ['Space']));
  assert.equal(s.jumpCount, 1);
  assert.ok(s.player.vy < 0);
  stepClimb(s, 1 / 240, input([], ['Space']));
  assert.equal(s.jumpCount, 1);
  const far = createClimbState();
  on(far, 0, far.ledges[0].w + 20);
  far.player.ground = null;
  far.edge = 0;
  far.coyote = 0.09;
  stepClimb(far, 1 / 240, input([], ['Space']));
  assert.equal(far.jumpCount, 0);
});
test('lantern: both moving-deck edges carry an idle passenger without added velocity or drift', () => {
  for (const offset of [0, 80]) {
    const s = createClimbState();
    on(s, 8, offset);
    const l = s.ledges[8],
      delta = s.player.x - l.x;
    run(s, 2);
    assert.equal(s.lives, 4);
    assert.equal(s.player.ground, 8);
    assert.ok(Math.abs(s.player.x - l.x - delta) < 1e-7);
    assert.ok(Math.abs(s.player.vx - l.vx) < 1e-7);
    assert.ok(Math.abs(l.x - l.home) < 36);
  }
});
test('lantern: moving-deck launch inherits its instantaneous velocity once and ignores later drive changes', () => {
  const a = createClimbState();
  on(a, 8);
  const b = structuredClone(a);
  stepClimb(a, 1 / 240, input([], ['Space']));
  stepClimb(b, 1 / 240, input([], ['Space']));
  assert.equal(a.lastImpulse.source, 'jump');
  assert.equal(a.lastImpulse.x, 0);
  assert.ok(Math.abs(a.lastImpulse.y + 324) < 1e-8);
  b.ledges[8].vx = -300;
  run(a, 0.1);
  run(b, 0.1);
  assert.ok(Math.abs(a.player.x - b.player.x) < 1e-8);
  assert.ok(Math.abs(a.player.vx - b.player.vx) < 1e-8);
  assert.equal(a.player.ground, null);
});
test('lantern: swept landing chooses the nearest support and fast ascent stops at a visible underside', () => {
  const s = createClimbState();
  s.ledges = [
    {
      id: 0,
      x: 70,
      y: 200,
      w: 120,
      h: 8,
      vx: 0,
      ax: 0,
      home: 70,
      moving: false,
      shrine: true,
      lit: true,
    },
    {
      id: 1,
      x: 70,
      y: 100,
      w: 120,
      h: 8,
      vx: 0,
      ax: 0,
      home: 70,
      moving: false,
      shrine: false,
      lit: false,
    },
  ];
  Object.assign(s.player, { x: 120, y: 0, vy: 30000, vx: 0, ground: null });
  stepClimb(s, 1 / 120, input());
  assert.equal(s.player.ground, 1);
  assert.ok(Math.abs(s.player.y - 78) < 1e-7);
  const up = createClimbState(),
    l = up.ledges[1];
  Object.assign(up.player, { x: l.x + 30, y: l.y + 20, vy: -30000, ground: null });
  stepClimb(up, 1 / 120, input());
  assert.ok(up.player.y >= l.y + l.h - 1e-6);
  assert.ok(up.player.vy >= 0);
  assert.equal(up.lives, 4);
  assert.ok(up.lastImpulse.work <= 0);
});
test('lantern: a jump pressed just before touchdown buffers exactly one supported jump', () => {
  const s = createClimbState();
  on(s, 0);
  s.player.y -= 3;
  s.player.vy = 80;
  s.player.ground = null;
  stepClimb(s, 1 / 240, input([], ['Space']));
  run(s, 0.1);
  assert.equal(s.jumpCount, 1);
  assert.equal(s.player.ground, null);
  assert.ok(s.player.vy < 0);
  run(s, 0.2, ['Space']);
  assert.equal(s.jumpCount, 1);
});
test('lantern: grip requires a real rail; hanging and climbing consume stamina and never count as rest', () => {
  const air = createClimbState();
  Object.assign(air.player, { x: 40, y: 100, ground: null });
  run(air, 0.1, ['KeyZ', 'ArrowUp']);
  assert.equal(air.player.grip, null);
  assert.equal(air.stamina, 100);
  assert.ok(air.player.vy > 0);
  const s = createClimbState(),
    r = s.rails[1];
  Object.assign(s.player, { x: r.x - 7, y: r.y + 30, vx: 25, vy: 100, ground: null });
  s.stamina = 50;
  stepClimb(s, 1 / 240, input(['KeyZ']));
  assert.equal(s.player.grip, 1);
  assert.ok(s.lastImpulse.work < 0);
  const y = s.player.y;
  run(s, 0.5, ['KeyZ']);
  assert.ok(Math.abs(s.player.y - y) < 1e-7);
  assert.ok(s.stamina < 50);
  const before = s.stamina;
  run(s, 0.5, ['KeyZ', 'ArrowUp']);
  assert.ok(s.player.y < y - 10);
  assert.ok(s.stamina < before - 5);
});
test('lantern: release and re-grip after cleared held input work near the rail without a position snap', () => {
  const s = createClimbState(),
    r = s.rails[1];
  Object.assign(s.player, { x: r.x - 7, y: r.y + 50, vx: 0, vy: 0, ground: null });
  s.stamina = 50;
  run(s, 0.1, ['KeyZ']);
  const y = s.player.y;
  run(s, 0.05);
  assert.equal(s.player.grip, null);
  assert.ok(s.player.y > y);
  run(s, 0.15, ['KeyZ']);
  assert.equal(s.player.grip, 1);
  assert.ok(s.player.y - y < 8);
  assert.ok(s.stamina < 50);
});
test('lantern: an ordinary low-stamina rail slip can return to a real ledge and recover', () => {
  const s = createClimbState(),
    l = s.ledges[13],
    r = s.rails[2];
  Object.assign(s.player, { x: r.x - 7, y: l.y - 22 - 36, vx: 0, vy: 0, ground: null, grip: 2 });
  s.stamina = 0.2;
  run(s, 0.6, ['KeyZ', 'ArrowRight']);
  assert.equal(s.lives, 4);
  assert.equal(s.player.grip, null);
  assert.equal(s.player.ground, 13);
  assert.ok(s.stamina < 1);
  run(s, 2);
  assert.equal(s.player.ground, 13);
  assert.ok(s.stamina > REST_RATE && s.stamina <= 2 * REST_RATE + 0.2);
});
test('lantern: stamina recovers only in supported low-speed rest, and X only refills at a resting brazier', () => {
  const s = createClimbState();
  s.stamina = 30;
  s.light = 20;
  run(s, 0.5);
  assert.ok(Math.abs(s.stamina - (30 + 0.5 * REST_RATE)) < 1e-6);
  const score = s.score;
  stepClimb(s, 1 / 240, input([], ['KeyX']));
  assert.ok(s.light > 99);
  assert.equal(s.score, score);
  on(s, 1);
  s.stamina = 30;
  s.light = 20;
  stepClimb(s, 1 / 240, input([], ['KeyX']));
  assert.ok(s.light < 20);
  assert.equal(s.relights, 1);
  const air = createClimbState();
  on(air, 0);
  air.player.y -= 25;
  air.player.ground = null;
  air.stamina = 30;
  air.light = 20;
  run(air, 0.05);
  assert.equal(air.stamina, 30);
  stepClimb(air, 1 / 240, input([], ['KeyX']));
  assert.ok(air.light < 20);
});
test('lantern: passive wall rest retains useful inward and jump controls without damage', () => {
  const s = createClimbState();
  s.ledges[0].x = 32;
  on(s, 0, 0);
  run(s, 0.5, ['ArrowLeft']);
  assert.equal(s.lives, 4);
  assert.equal(s.player.x, 32);
  assert.equal(s.player.vx, 0);
  run(s, 0.1, ['ArrowRight']);
  assert.ok(s.player.x > 32);
  stepClimb(s, 1 / 240, input([], ['Space']));
  assert.ok(s.player.vy < 0);
});
test('lantern: visible lamp exhaustion returns to a valid checkpoint without farming lantern credit', () => {
  const s = createClimbState();
  s.checkpoint = 3;
  s.ledges[3].lit = true;
  s.score = 100;
  on(s, 3);
  s.light = 0.001;
  stepClimb(s, 1 / 120, input());
  assert.equal(s.lives, 3);
  assert.equal(s.lastCause, 'light');
  run(s, 0.7);
  assert.equal(s.player.ground, 3);
  assert.equal(s.light > 99, true);
  assert.equal(s.stamina, 100);
  assert.equal(s.score, 100);
});
test('lantern: legal falls reach loss, callback fires once, terminal state freezes and restart is fresh', () => {
  const h = harness(),
    g = createGame(h.env);
  for (let n = 0; n < 120 * 30 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, input(['ArrowLeft']));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const final = structuredClone(g.getState());
  for (const dt of [0, NaN, Infinity, 1 / 30])
    g.update(dt, input(['KeyZ', 'ArrowUp'], ['Space', 'KeyX']));
  assert.deepEqual(g.getState(), final);
  assert.equal(h.ends.length, 1);
  g.draw(mockContext());
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.lives, 4);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.light, 100);
  assert.equal(fresh.stamina, 100);
  assert.equal(fresh.player.grip, null);
});

test('lantern: real walk-off grace works at30/60/120Hz and expires without a distant air jump', () => {
  for (const hz of [30, 60, 120]) {
    const g = createGame(harness().env);
    for (let n = 0; n < hz * 2 && g.getState().player.ground !== null; n++)
      g.update(1 / hz, input(['ArrowRight']));
    assert.equal(g.getState().player.ground, null);
    g.update(1 / hz, input([], ['Space']));
    assert.equal(g.getState().jumpCount, 1);
    g.update(1 / hz, input([], ['Space']));
    assert.equal(g.getState().jumpCount, 1);
  }
  const s = createClimbState();
  on(s, 0, s.ledges[0].w + 1);
  s.player.ground = null;
  s.edge = 0;
  s.coyote = 0.09;
  run(s, 0.12);
  stepClimb(s, 1 / 240, input([], ['Space']));
  assert.equal(s.jumpCount, 0);
});
test('lantern: a deliberate jump from Grip spends stamina, preserves reaction momentum and blocks instant regrab', () => {
  const s = createClimbState(),
    r = s.rails[1];
  Object.assign(s.player, { x: r.x - 7, y: -420, vx: 0, vy: 0, ground: null, grip: 1 });
  stepClimb(s, 1 / 240, input(['KeyZ', 'ArrowLeft'], ['Space']));
  assert.equal(s.player.grip, null);
  assert.equal(s.jumpCount, 1);
  assert.equal(s.stamina, 88);
  assert.equal(s.lastImpulse.source, 'jump');
  assert.equal(s.lastImpulse.x, -125);
  assert.equal(s.lastImpulse.y, -324);
  assert.ok(s.lastImpulse.work > 0);
  assert.equal(s.lastImpulse.x + s.lastImpulse.reaction.x, 0);
  run(s, 0.05, ['KeyZ']);
  assert.equal(s.player.grip, null);
});
test('lantern: reveal range matches lamp fuel while preserving solid safe ledges and immutable snapshots', () => {
  const g = createGame(harness({ lang: 'zh' }).env),
    initial = structuredClone(g.getState()),
    copy = g.getState();
  assert.equal(initial.revealRadius, 130);
  assert.ok(initial.ledges.some((l) => !l.revealed));
  assert.ok(initial.ledges[1].revealed);
  assert.ok(Math.abs(initial.jumpEnvelope.height - 65.61) < 1e-8);
  copy.ledges[0].x = 999;
  copy.rails[0].h = 0;
  copy.player.x = 0;
  assert.deepEqual(g.getState(), initial);
  g.draw(mockContext());
  assert.deepEqual(g.getState(), initial);
});
test('lantern: seeded bounded legal runs stay deterministic, finite and nonpenetrating', () => {
  const a = createGame(harness().env),
    b = createGame(harness().env),
    random = seeded(61);
  let held = [];
  for (let n = 0; n < 6000; n++) {
    if (n % 23 === 0) {
      held = [];
      if (random() < 0.6) held.push(random() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
      if (random() < 0.35) held.push('KeyZ');
      if (random() < 0.4) held.push(random() < 0.5 ? 'ArrowUp' : 'ArrowDown');
    }
    const controls = input(held, n % 67 === 0 ? ['Space'] : n % 109 === 0 ? ['KeyX'] : []);
    a.update(1 / 120, controls);
    b.update(1 / 120, controls);
    if (n % 43 === 0) {
      const s = a.getState();
      assert.deepEqual(s, b.getState());
      for (const v of [
        s.player.x,
        s.player.y,
        s.player.vx,
        s.player.vy,
        s.stamina,
        s.light,
        s.time,
        s.camera,
      ])
        assert.ok(Number.isFinite(v));
      assert.ok(s.stamina >= 0 && s.stamina <= 100 && s.light >= 0 && s.light <= 100);
      assert.ok(s.player.x >= 32 - 1e-6 && s.player.x <= 434 + 1e-6);
      assert.equal(s.ledges.length, 19);
      assert.equal(s.rails.length, 4);
      assert.ok(JSON.stringify(s).length < 12000);
      if (s.respawn === 0 && s.phase === 'playing')
        for (const l of s.ledges) {
          const x = Math.max(
              0,
              Math.min(s.player.x + s.player.w, l.x + l.w) - Math.max(s.player.x, l.x),
            ),
            y = Math.max(
              0,
              Math.min(s.player.y + s.player.h, l.y + l.h) - Math.max(s.player.y, l.y),
            );
          assert.ok(x * y < 1e-5);
        }
      a.draw(mockContext());
    }
  }
});

test('lantern: holding Grip away from a rail does not invalidate a real supported rest', () => {
  const s = createClimbState();
  s.stamina = 30;
  run(s, 1, ['KeyZ']);
  assert.equal(s.player.grip, null);
  assert.equal(s.player.ground, 0);
  assert.ok(Math.abs(s.stamina - (30 + REST_RATE)) < 1e-7);
});

test('lantern: touching a ledge corner exactly counts as support instead of stalling the solver', () => {
  const s = createClimbState(),
    l = s.ledges[13];
  Object.assign(s.player, { x: l.x - 14, y: l.y - 22, vx: 0, vy: 0, ground: null });
  s.edge = null;
  run(s, 0.05, ['ArrowRight']);
  assert.equal(s.player.ground, 13);
  assert.equal(s.lives, 4);
  const right = createClimbState(),
    r = right.ledges[13];
  Object.assign(right.player, { x: r.x + r.w, y: r.y - 22, vx: 0, vy: 0, ground: null });
  right.edge = null;
  run(right, 0.05, ['ArrowLeft']);
  assert.equal(right.player.ground, 13);
});
