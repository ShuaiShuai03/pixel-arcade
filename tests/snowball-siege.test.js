import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, moveOnPlatforms, rollSnowball } from '../src/games/snowball-siege.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, held = [], pressed = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(held, i ? [] : pressed));
};
test('snow: swept landing chooses first crossed surface, regardless of platform order', () => {
  const b = { x: 40, y: 0, w: 12, h: 16, vx: 0, vy: 300, grounded: false };
  moveOnPlatforms(
    b,
    [
      { x: 0, y: 90, w: 200 },
      { x: 0, y: 50, w: 200 },
    ],
    0.25,
  );
  assert.equal(b.y, 34);
  assert.equal(b.grounded, true);
});
test('snow: sweeping does not land on a platform entered after crossing its height', () => {
  const b = { x: 0, y: 0, w: 10, h: 10, vx: 300, vy: 300, grounded: false };
  moveOnPlatforms(b, [{ x: 65, y: 40, w: 100 }], 0.25);
  assert.equal(b.grounded, false);
});
test('snow: six chambers teach a separate deliberate kick and held jump never repeats', () => {
  const g = createGame(harness().env);
  assert.equal(g.getState().totalLevels, 6);
  assert.ok(meta.touchControls.some((b) => b.code === 'KeyK'));
  step(g, 1, ['ArrowUp'], ['ArrowUp']);
  step(g, 80, ['ArrowUp']);
  assert.equal(g.getState().player.grounded, true);
  assert.equal(g.getState().player.vy, 0);
  g.draw(mockContext());
});
test('snow: release does not inject mid-air energy into a fixed ballistic jump', () => {
  const a = createGame(harness().env),
    b = createGame(harness().env);
  step(a, 1, ['ArrowUp'], ['ArrowUp']);
  step(b, 1, ['ArrowUp'], ['ArrowUp']);
  step(a, 14, ['ArrowUp']);
  step(b, 14);
  assert.equal(a.getState().player.y, b.getState().player.y);
  assert.equal(a.getState().player.vy, b.getState().player.vy);
});
let airAim = null;
function pilot(s, frame) {
  if (frame === 0 || s.player.grounded) airAim = null;
  const p = s.player,
    target = s.enemies
      .filter((e) => e.active)
      .sort(
        (a, b) =>
          Math.abs(a.y - p.y) - Math.abs(b.y - p.y) || Math.abs(a.x - p.x) - Math.abs(b.x - p.x),
      )[0];
  const held = ['Space'],
    pressed = [];
  if (!target) return input();
  const frozen = target.snow >= target.freezeHits;
  let aimX = target.x,
    needJump = false,
    launchPlan = null;
  const support = s.platforms.findIndex(
    (r) => Math.abs(p.y + p.h - r.y) < 2 && p.x + p.w > r.x && p.x < r.x + r.w,
  );
  const targetPlatform = s.platforms.findIndex(
    (r) =>
      Math.abs(target.y + target.h - r.y) < 3 && target.x + target.w > r.x && target.x < r.x + r.w,
  );
  if (support >= 0 && targetPlatform >= 0 && support !== targetPlatform) {
    const queue = [{ at: support, path: [] }],
      seen = new Set([support]);
    let route = [];
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (n.at === targetPlatform) {
        route = n.path;
        break;
      }
      const from = s.platforms[n.at];
      for (let j = 0; j < s.platforms.length; j++) {
        const to = s.platforms[j];
        const gap = Math.max(to.x - from.x - from.w, from.x - to.x - to.w, 0);
        if (!seen.has(j) && from.y - to.y <= 70 && gap < 70) {
          seen.add(j);
          queue.push({ at: j, path: [...n.path, j] });
        }
      }
    }
    if (route.length) {
      const next = s.platforms[route[0]],
        from = s.platforms[support];
      if (next.y < from.y) {
        const options = [
          { x: next.x - p.w - 2, landing: next.x + 6 },
          { x: next.x + next.w + 2, landing: next.x + next.w - p.w - 6 },
        ].filter((o) => o.x >= from.x && o.x + p.w <= from.x + from.w);
        options.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
        const route = options[0];
        if (route) {
          aimX = route.x;
          needJump = Math.abs(p.x - aimX) < 4 && Math.abs(p.vx) < 35;
          launchPlan = { launch: route.x, landing: route.landing, top: next.y };
        }
      } else {
        aimX = target.x > p.x ? from.x + from.w + 15 : from.x - 30;
      }
    }
  } else if (Math.abs(target.y - p.y) < 25) {
    aimX = target.x + (target.x > p.x ? -1 : 1) * (frozen ? 26 : 65);
  }
  if (!p.grounded && airAim !== null)
    aimX = p.y + p.h <= airAim.top ? airAim.landing : airAim.launch;
  if (Math.abs(aimX - p.x) > 3) held.push(aimX > p.x ? 'ArrowRight' : 'ArrowLeft');
  else if (target.x > p.x && p.face < 0) held.push('ArrowRight');
  else if (target.x < p.x && p.face > 0) held.push('ArrowLeft');
  if (needJump && p.grounded) {
    airAim = launchPlan;
    held.push('ArrowUp');
    pressed.push('ArrowUp');
  } else if (p.vy < 0) held.push('ArrowUp');
  if (frozen && Math.abs(target.x - p.x) < 43 && Math.abs(target.y - p.y) < 25)
    pressed.push('KeyK');
  return input(held, pressed);
}
test('snow: a frozen foe stays harmless and alive until an explicit kick', () => {
  const g = createGame(harness().env);
  let frozen;
  for (let f = 0; f < 1800 && !frozen; f++) {
    const s = g.getState(),
      i = pilot(s, f);
    g.update(
      1 / 60,
      input([
        'Space',
        ...(i.held('ArrowLeft') ? ['ArrowLeft'] : []),
        ...(i.held('ArrowRight') ? ['ArrowRight'] : []),
      ]),
    );
    frozen = g.getState().enemies.find((e) => e.active && e.snow >= e.freezeHits);
  }
  assert.ok(frozen, 'first-floor enemy can be frozen');
  assert.equal(g.getState().snowballs.length, 0, 'snow shots never implicitly launch a ball');
  const before = g.getState();
  for (let f = 0; f < 12; f++) g.update(1 / 60, input(['Space']));
  assert.ok(g.getState().enemies.some((e) => e.active && e.id === frozen.id));
  assert.equal(g.getState().snowballs.length, 0);
  assert.equal(g.getState().lives, before.lives);
});
for (const hz of [60, 120])
  for (const seed of [1, 19])
    test(`snow: legal movement, snow and kicks clear all six chambers (${seed}, ${hz} Hz)`, () => {
      const h = harness({ seed }),
        g = createGame(h.env);
      let balls = 0;
      for (let f = 0; f < hz * 600 && g.getState().phase === 'playing'; f++) {
        g.update(1 / hz, pilot(g.getState(), f));
        const s = g.getState();
        balls += s.snowballs.length;
        if (f % 180 === 0) {
          g.draw(mockContext());
          assert.ok(s.shots.length < 32);
          assert.ok(s.snowballs.length < 20);
          assert.ok(JSON.stringify(s).length < 30000);
        }
      }
      const s = g.getState();
      assert.equal(s.phase, 'won');
      assert.equal(s.level, 6);
      assert.ok(balls > 0);
      assert.equal(h.ends.length, 1);
      step(g, 120);
      assert.deepEqual(g.getState(), s);
    });
test('snow: idle loses once; restart and alternating dt stay finite', () => {
  const h = harness(),
    g = createGame(h.env);
  step(g, 30000);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const fresh = createGame(harness().env);
  for (let n = 0; n < 2000; n++) fresh.update(n % 2 ? 1 / 30 : 1 / 120, pilot(fresh.getState(), n));
  assert.ok(Number.isFinite(fresh.getState().player.y));
  assert.equal(createGame(harness().env).getState().score, 0);
});

test('snow physics: ballistic gravity integrates identically at 30, 60 and 120 Hz', () => {
  const ends = [30, 60, 120].map((hz) => {
    const b = { x: 40, y: 0, w: 16, h: 18, vx: 22, vy: -50, grounded: false };
    for (let n = 0; n < hz / 2; n++) moveOnPlatforms(b, [], 1 / hz);
    return b;
  });
  for (const b of ends) {
    assert.ok(Math.abs(b.x - 51) < 1e-8);
    assert.ok(Math.abs(b.y - 50) < 1e-8);
    assert.ok(Math.abs(b.vy - 250) < 1e-8);
  }
});
test('snow physics: walking off support falls only for the unsupported part of the step', () => {
  const b = { x: 90, y: 32, w: 10, h: 18, vx: 100, vy: 0, grounded: true };
  moveOnPlatforms(b, [{ x: 0, y: 50, w: 100 }], 0.2);
  assert.ok(Math.abs(b.y - 35) < 1e-7);
  assert.ok(Math.abs(b.vy - 60) < 1e-7);
  assert.equal(b.grounded, false);
});
test('snow physics: solid ledge undersides stop upward jumps without adding energy', () => {
  const b = { x: 30, y: 80, w: 16, h: 18, vx: 0, vy: -260, grounded: false },
    platforms = [
      { x: 0, y: 65, w: 200 },
      { x: 0, y: 110, w: 480 },
    ];
  moveOnPlatforms(b, platforms, 1 / 60);
  assert.ok(b.hitCeiling);
  assert.ok(b.y >= 78);
  assert.ok(b.vy >= 0);
  for (let n = 0; n < 50; n++) moveOnPlatforms(b, platforms, 1 / 60);
  assert.equal(b.y, 92);
  assert.equal(b.vy, 0);
  assert.equal(b.grounded, true);
});
test('snow physics: rolling friction and wall restitution cannot add horizontal energy', () => {
  const b = {
    x: 450,
    y: 274,
    w: 20,
    h: 20,
    vx: 220,
    vy: 0,
    grounded: true,
    launched: true,
    life: 7,
    spin: 0,
  };
  let previous = Math.abs(b.vx);
  let bounced = false;
  for (let n = 0; n < 240; n++) {
    rollSnowball(b, [{ x: 0, y: 294, w: 480 }], 1 / 60);
    assert.ok(Math.abs(b.vx) <= previous + 1e-8);
    previous = Math.abs(b.vx);
    bounced ||= b.vx < 0;
    assert.equal(b.y, 274);
  }
  assert.ok(bounced);
  assert.equal(b.vx, 0);
  assert.equal(b.launched, false);
});
test('snow physics: a rolling ball falls into lower lanes without hovering', () => {
  const b = {
    x: 84,
    y: 80,
    w: 20,
    h: 20,
    vx: 180,
    vy: 0,
    grounded: true,
    launched: true,
    life: 7,
    spin: 0,
  };
  for (let n = 0; n < 90; n++)
    rollSnowball(
      b,
      [
        { x: 0, y: 100, w: 105 },
        { x: 0, y: 220, w: 480 },
      ],
      1 / 60,
    );
  assert.equal(b.y, 200);
  assert.equal(b.grounded, true);
});

test('snow physics: ordinary thrown pellets follow gravity rather than hovering', () => {
  const g = createGame(harness().env);
  g.update(1 / 60, input(['Space']));
  const before = g.getState().shots[0];
  assert.ok(before);
  step(g, 5);
  const after = g.getState().shots[0];
  assert.ok(after);
  assert.ok(after.vy > before.vy);
  assert.notEqual(after.y, before.y);
});
test('snow physics: braking has bounded acceleration and never teleports the player', () => {
  const g = createGame(harness().env);
  step(g, 20, ['ArrowLeft']);
  const before = g.getState().player;
  g.update(1 / 120, input());
  const after = g.getState().player;
  assert.ok(after.vx < 0 && after.vx > before.vx);
  assert.ok(Math.abs(after.x - before.x) < 2);
});

test('snow: Warden telegraphs a bounded leap, then exposes its frost armor on landing', () => {
  const g = createGame(harness({ seed: 12 }).env);
  let f = 0;
  for (; f < 20000 && g.getState().level < 6 && g.getState().phase === 'playing'; f++)
    g.update(1 / 60, pilot(g.getState(), f));
  assert.equal(g.getState().level, 6);
  const states = new Set();
  let armoredHits = 0,
    exposedHits = 0;
  for (let n = 0; n < 700 && g.getState().phase === 'playing'; n++) {
    const before = g.getState(),
      boss = before.enemies.find((e) => e.type === 'warden');
    states.add(boss.stance);
    const command = pilot(before, f + n);
    g.update(
      1 / 60,
      input([
        'Space',
        ...(command.held('ArrowRight') ? ['ArrowRight'] : []),
        ...(command.held('ArrowLeft') ? ['ArrowLeft'] : []),
      ]),
    );
    const after = g.getState().enemies.find((e) => e.type === 'warden');
    if (boss.stance === 'guard' && after.stance === 'guard') {
      assert.equal(after.snow, boss.snow);
      armoredHits++;
    }
    if (after.snow > boss.snow) exposedHits++;
    if (after.snow === after.freezeHits) break;
  }
  for (const stance of ['guard', 'windup', 'leap', 'recover'])
    assert.ok(states.has(stance), stance);
  assert.ok(armoredHits > 0);
  assert.ok(exposedHits > 0);
});

test('snow physics: a swept solid side cannot be tunneled through', () => {
  const b = { x: 50, y: 55, w: 16, h: 18, vx: 200, vy: 0, grounded: false };
  moveOnPlatforms(b, [{ x: 100, y: 50, w: 50, h: 40 }], 0.5);
  assert.equal(b.x, 84);
  assert.equal(b.vx, 0);
  assert.equal(b.hitX, true);
});

function freezeFirstFloor(g) {
  for (let frame = 0; frame < 1200; frame++) {
    const state = g.getState(),
      command = pilot(state, frame);
    g.update(
      1 / 60,
      input([
        'Space',
        ...(command.held('ArrowRight') ? ['ArrowRight'] : []),
        ...(command.held('ArrowLeft') ? ['ArrowLeft'] : []),
      ]),
    );
    const frozen = g
      .getState()
      .enemies.find((e) => e.active && e.y > 260 && e.snow === e.freezeHits);
    if (frozen) return frozen.id;
  }
  assert.fail('legal snow throws must freeze the first floor monster');
}
test('snow: idle frozen bodies block walking without shoving, killing or auto-launching', () => {
  const g = createGame(harness().env),
    id = freezeFirstFloor(g),
    lives = g.getState().lives;
  step(g, 60, ['ArrowRight', 'Space']);
  step(g, 15);
  const s = g.getState(),
    frozen = s.enemies.find((e) => e.id === id);
  assert.equal(frozen.active, true);
  assert.equal(s.lives, lives);
  assert.equal(s.score, 0);
  assert.equal(s.snowballs.length, 0);
  assert.ok(
    Math.abs(s.player.x + s.player.w - frozen.x) < 0.1,
    'hero stops at the actual frozen body',
  );
  const x = s.player.x;
  step(g, 30);
  assert.equal(g.getState().player.x, x);
  g.update(1 / 60, input(['ArrowLeft'], ['KeyK']));
  assert.equal(g.getState().snowballs.length, 0, 'a backward kick cannot launch the body');
  step(g, 15);
  g.update(1 / 60, input(['ArrowRight'], ['KeyK']));
  const kicked = g.getState();
  assert.equal(kicked.snowballs.length, 1);
  assert.equal(kicked.enemies.find((e) => e.id === id).active, false);
  assert.ok(kicked.snowballs[0].vx > 0);
  assert.equal(kicked.snowballs[0].y + kicked.snowballs[0].h, 294);
  step(g, 15);
  const restingX = g.getState().player.x;
  step(g, 180);
  assert.equal(
    g.getState().player.x,
    restingX,
    'rolling contacts never teleport or shove the resting hero',
  );
});
test('snow: a living contact removes one heart without killing the foe or teleporting the hero', () => {
  const g = createGame(harness().env);
  let previous = g.getState(),
    hit = false;
  for (let frame = 0; frame < 400; frame++) {
    g.update(1 / 60, input());
    const now = g.getState();
    if (now.lives < previous.lives) {
      assert.ok(Math.abs(now.player.x - previous.player.x) < 3);
      assert.equal(now.player.y, previous.player.y);
      assert.equal(now.enemies.filter((e) => e.active).length, 3);
      hit = true;
      break;
    }
    previous = now;
  }
  assert.ok(hit);
  const hearts = g.getState().lives;
  step(g, 40);
  assert.equal(g.getState().lives, hearts);
});
test('snow: movement and ballistic jumping agree at 60 and 120 Hz', () => {
  function run(hz, held, seconds) {
    const g = createGame(harness().env);
    for (let n = 0; n < hz * seconds; n++) g.update(1 / hz, input(held, n === 0 ? held : []));
    return g.getState().player;
  }
  const slow = run(60, ['ArrowLeft'], 1),
    fast = run(120, ['ArrowLeft'], 1);
  assert.ok(Math.abs(slow.x - fast.x) < 0.1);
  assert.equal(slow.vx, fast.vx);
  const a = run(60, ['ArrowUp'], 0.3),
    b = run(120, ['ArrowUp'], 0.3);
  assert.ok(Math.abs(a.y - b.y) < 1e-7);
  assert.ok(Math.abs(a.vy - b.vy) < 1e-7);
});
function reachFirstLedge(g) {
  for (let f = 0; f < 6000; f++) {
    g.update(1 / 60, pilot(g.getState(), f));
    const p = g.getState().player;
    if (p.grounded && p.y < 250) return;
  }
  assert.fail('legal route must reach the ledge');
}
test('snow: a deliberate edge jump uses short coyote time once', () => {
  const g = createGame(harness().env);
  reachFirstLedge(g);
  let edge;
  for (let f = 0; f < 150; f++) {
    g.update(1 / 60, input(['ArrowLeft']));
    if (!g.getState().player.grounded) {
      edge = g.getState().player;
      break;
    }
  }
  assert.ok(edge);
  g.update(1 / 60, input(['ArrowUp'], ['ArrowUp']));
  assert.ok(g.getState().player.vy < 0);
  assert.ok(g.getState().player.y < edge.y);
});
test('snow: a jump pressed just before landing is buffered and fires once', () => {
  const g = createGame(harness().env);
  reachFirstLedge(g);
  for (let f = 0; f < 150; f++) {
    g.update(1 / 60, input(['ArrowLeft']));
    if (!g.getState().player.grounded) break;
  }
  let queued = false;
  for (let f = 0; f < 100; f++) {
    const p = g.getState().player;
    if (!p.grounded && p.vy > 0 && p.y + p.h > 283) {
      g.update(1 / 60, input(['ArrowUp'], ['ArrowUp']));
      queued = true;
      break;
    }
    g.update(1 / 60, input());
  }
  assert.ok(queued);
  step(g, 8, ['ArrowUp']);
  assert.ok(g.getState().player.vy < 0);
  step(g, 100, ['ArrowUp']);
  assert.equal(g.getState().player.grounded, true);
});
test('snow: pointer-only touching cannot generate an attack and drawing never mutates simulation', () => {
  const g = createGame(harness({ lang: 'zh' }).env);
  for (let f = 0; f < 30; f++)
    g.update(1 / 60, input([], [], { x: 250, y: 270, down: true, clicked: f === 0 }));
  assert.equal(g.getState().shots.length, 0);
  assert.equal(g.getState().snowballs.length, 0);
  const before = g.getState(),
    ctx = mockContext();
  const numeric = [
    'fillRect',
    'strokeRect',
    'translate',
    'scale',
    'rotate',
    'moveTo',
    'lineTo',
    'arc',
  ];
  for (const method of numeric)
    ctx[method] = (...args) => {
      for (const n of args) if (typeof n === 'number') assert.ok(Number.isFinite(n), method);
    };
  for (let f = 0; f < 12; f++) g.draw(ctx);
  assert.deepEqual(g.getState(), before);
  const copy = g.getState();
  copy.player.x = 999;
  copy.platforms[0].y = 0;
  assert.deepEqual(g.getState(), before);
});

test('snow: chamber timeout ends the run explicitly instead of silently teleporting to a reset', () => {
  const h = harness(),
    g = createGame(h.env);
  step(g, 7500, ['Space']);
  assert.equal(g.getState().phase, 'lost');
  assert.ok(g.getState().timer <= 0);
  assert.equal(h.ends.length, 1);
  const terminal = g.getState();
  step(g, 100, ['ArrowRight', 'Space'], ['KeyK']);
  assert.deepEqual(g.getState(), terminal);
});
