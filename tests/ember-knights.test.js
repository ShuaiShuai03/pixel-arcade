import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  meta,
  advanceDuelBodies,
  resolveBodyContact,
  resolveStrike,
  weaponPose,
  STAGE_COUNT,
} from '../src/games/ember-knights.js';
import { resistsInterrupt, isArmored } from '../src/games/ember-knights-physics.js';
import { STAGES, RULES, attackSpec } from '../src/games/ember-knights-stages.js';
import { harness, input, mockContext, seeded } from './harness.js';

const step = (g, seconds, held = [], pressed = [], hz = 120) => {
  for (let n = 0; n < Math.round(seconds * hz); n++)
    g.update(1 / hz, input(held, n === 0 ? pressed : []));
};
const body = (extra = {}) => ({
  id: 0,
  x: 100,
  y: 260,
  w: 24,
  h: 40,
  vx: 0,
  vy: 0,
  mass: 80,
  grounded: true,
  ...extra,
});
function closeDuel() {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 1.3, ['KeyD', 'ArrowLeft']);
  return g;
}
// Opens the campaign at `stage` through the real stage select.
function openStage(stage, { seed = 1, lang = 'en', progress = null } = {}) {
  const h = harness({ seed, lang });
  let unlocked = stage;
  h.env.progress = progress ?? {
    unlocked: () => unlocked,
    unlock: (n) => (unlocked = Math.max(unlocked, n)),
  };
  const g = createGame(h.env);
  if (stage > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

test('knights: passive body contact never causes health damage or penetration', () => {
  const g = closeDuel();
  step(g, 3, ['KeyD', 'ArrowLeft']);
  const s = g.getState();
  assert.equal(s.fighters[0].health, 100);
  assert.equal(s.fighters[1].health, 100);
  assert.ok(s.fighters[1].x - s.fighters[0].x >= 24 - 1e-6);
});
test('knights: movement has acceleration and finite braking rather than immediate velocity resets', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input(['KeyD']));
  const first = g.getState().fighters[0];
  assert.ok(first.vx > 0 && first.vx < 20);
  step(g, 0.5, ['KeyD']);
  const before = g.getState().fighters[0];
  g.update(1 / 120, input());
  const after = g.getState().fighters[0];
  assert.ok(after.vx > 0 && after.vx < before.vx);
  assert.ok(after.x - before.x < 2);
});
test('knights: body impulses are passive and conserve unanchored horizontal momentum', () => {
  const a = body({ vx: 150 }),
    b = body({ id: 1, x: 140, vx: -30, mass: 100 });
  const before = a.mass * a.vx + b.mass * b.vx,
    energy = a.mass * a.vx ** 2 + b.mass * b.vx ** 2;
  resolveBodyContact(a, b, { nx: -1, ny: 0 });
  assert.ok(Math.abs(a.mass * a.vx + b.mass * b.vx - before) < 1e-6);
  assert.ok(a.mass * a.vx ** 2 + b.mass * b.vx ** 2 <= energy + 1e-6);
});
test('knights: swept body contacts cannot cross and wall pins do not teleport', () => {
  const a = body({ vx: 1000 }),
    b = body({ id: 1, x: 140 });
  advanceDuelBodies([a, b], 0.05);
  assert.ok(b.x - a.x >= 24 - 1e-6);
  assert.ok(a.x < b.x);
  const c = body({ x: 432, vx: 160 }),
    d = body({ id: 1, x: 456 });
  advanceDuelBodies([c, d], 0.2);
  assert.ok(c.x <= 432 + 1e-6);
  assert.equal(d.x, 456);
  assert.ok(Math.abs(c.vx) < 1e-6);
});
test('knights: constant gravity follows the same ballistic arc at 30, 60 and 120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const a = body({ x: 100, vy: -260, grounded: false }),
      b = body({ id: 1, x: 350 });
    for (let n = 0; n < hz * 0.3; n++) advanceDuelBodies([a, b], 1 / hz);
    assert.ok(Math.abs(a.y - 212.6) < 0.05);
    assert.ok(Math.abs(a.vy + 56) < 0.05);
  }
});
test('knights: releasing jump does not alter its arc, and holding does not auto-hop', () => {
  const a = createGame(harness({ mode: 2 }).env),
    b = createGame(harness({ mode: 2 }).env);
  step(a, 1 / 120, ['KeyW'], ['KeyW']);
  step(b, 1 / 120, ['KeyW'], ['KeyW']);
  step(a, 0.2, ['KeyW']);
  step(b, 0.2);
  assert.equal(a.getState().fighters[0].y, b.getState().fighters[0].y);
  step(a, 1.2, ['KeyW']);
  assert.equal(a.getState().fighters[0].y, 260);
  assert.equal(a.getState().fighters[0].vy, 0);
});
test('knights: a press just before landing queues one deliberate jump', () => {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 1 / 120, ['KeyW'], ['KeyW']);
  let queued = false;
  for (let n = 0; n < 150; n++) {
    const f = g.getState().fighters[0];
    if (f.vy > 0 && f.y > 252) {
      g.update(1 / 120, input(['KeyW'], ['KeyW']));
      queued = true;
      break;
    }
    g.update(1 / 120, input());
  }
  assert.ok(queued);
  step(g, 0.1, ['KeyW']);
  assert.ok(g.getState().fighters[0].vy < 0);
  step(g, 1.3, ['KeyW']);
  assert.equal(g.getState().fighters[0].grounded, true);
});
test('knights: startup and recovery are harmless; only the visible active blade hits', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ'], ['KeyJ']));
  step(g, 0.1);
  let s = g.getState();
  assert.equal(s.fighters[1].health, 100);
  assert.equal(s.fighters[0].attack.phase, 'windup');
  step(g, 0.2);
  s = g.getState();
  assert.ok(s.fighters[1].health < 100);
  const health = s.fighters[1].health;
  step(g, 0.3);
  assert.equal(g.getState().fighters[1].health, health);
  assert.equal(resolveStrike({ ...s.fighters[0], attack: null }, s.fighters[1]).hit, false);
});
test('knights: simultaneous equal strikes trade symmetrically instead of favoring P1', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ', 'Comma'], ['KeyJ', 'Comma']));
  step(g, 0.3);
  const [a, b] = g.getState().fighters;
  assert.ok(a.health < 100);
  assert.equal(a.health, b.health);
});
test('knights: a blade below an airborne opponent cannot hit its feet by center-distance shortcut', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ']));
  step(g, 0.21);
  const a = g.getState().fighters[0];
  const attacker = {
    ...a,
    x: 100,
    y: 260,
    attack: { ...a.attack, age: a.attack.startup + a.attack.active / 2, phase: 'active', face: 1 },
  };
  const target = { ...g.getState().fighters[1], x: 130, y: 220, blocking: false };
  assert.equal(resolveStrike(attacker, target).hit, false);
  const pose = weaponPose(attacker);
  assert.equal(pose.active, true);
  assert.ok(pose.tip.y > target.y);
});
test('knights: a hit changes momentum rather than directly teleporting the victim', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ']));
  let previous = g.getState(),
    hit = false;
  for (let n = 0; n < 80; n++) {
    g.update(1 / 120, input());
    const s = g.getState();
    if (s.fighters[1].health < previous.fighters[1].health) {
      assert.ok(Math.abs(s.fighters[1].x - previous.fighters[1].x) < 2);
      assert.ok(s.fighters[1].vx > 0);
      hit = true;
      break;
    }
    previous = s;
  }
  assert.ok(hit);
});
test('knights: fresh guard parries a heavy attack and spent guard cannot auto-parry again', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['Period']));
  let raised = false;
  for (let n = 0; n < 120; n++) {
    const s = g.getState(),
      attack = s.fighters[1].attack;
    const ready = attack && attack.phase === 'windup' && attack.startup - attack.age < 0.12;
    if (ready) raised = true;
    g.update(1 / 120, input(raised ? ['KeyS'] : []));
    if (g.getState().fighters[1].stun > 0) break;
  }
  const s = g.getState();
  assert.ok(raised);
  assert.equal(s.fighters[0].health, 100);
  assert.ok(s.fighters[1].stun > 0);
  assert.ok(s.parries > 0);
});
test('knights: a depleted guard breaks visibly and recovers even if guard remains held', () => {
  const g = closeDuel();
  let broken = false,
    recovered = false;
  for (let n = 0; n < 4000 && g.getState().phase === 'playing'; n++) {
    g.update(1 / 120, input(['KeyS', 'Period']));
    const f = g.getState().fighters[0];
    broken ||= f.guardBreak > 0;
    if (broken && f.guardBreak === 0 && f.stamina > 20) {
      recovered = true;
      break;
    }
  }
  assert.ok(broken);
  assert.ok(recovered);
});
test('knights: idle solo defeat ends once and new instance restores the complete duel', () => {
  const h = harness(),
    g = createGame(h.env);
  step(g, 180);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const terminal = g.getState();
  step(g, 1, ['KeyJ']);
  assert.deepEqual(g.getState(), terminal);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.stage, 1);
  assert.equal(fresh.fighters[0].health, 100);
  assert.equal(fresh.fighters[0].stamina, 100);
});
for (const hz of [30, 60, 120])
  for (const winner of [1, 2])
    test(`knights: local best-of-three supports a real P${winner} victory at ${hz} Hz`, () => {
      const h = harness({ mode: 2 }),
        g = createGame(h.env);
      for (let n = 0; n < hz * 350 && g.getState().phase === 'playing'; n++) {
        const [a, b] = g.getState().fighters,
          held = winner === 1 ? ['KeyJ'] : ['Comma'];
        if (Math.abs(a.x - b.x) > 35)
          held.push(
            winner === 1 ? (a.x < b.x ? 'KeyD' : 'KeyA') : b.x > a.x ? 'ArrowLeft' : 'ArrowRight',
          );
        g.update(1 / hz, input(held));
      }
      assert.equal(g.getState().winner, winner);
      assert.equal(h.ends.length, 1);
      assert.equal(g.getState().wins[winner - 1], 2);
      assert.equal(h.ends[0].message, `Player ${winner} wins the match!`);
    });
test('knights: both-player touch controls are separate, complete and bilingual', () => {
  assert.equal(meta.multiplayerTouchControls.length, 12);
  for (const b of meta.touchControls) {
    assert.ok(b.side);
    assert.ok(b.label.en && b.label.zh);
  }
  for (const b of meta.multiplayerTouchControls) {
    assert.ok(b.label.en && b.label.zh);
    assert.ok(['left', 'right'].includes(b.side));
  }
  const checks = [
    ['KeyA', 0, 'moveLeft'],
    ['KeyD', 0, 'moveRight'],
    ['KeyW', 0, 'jump'],
    ['KeyS', 0, 'guard'],
    ['KeyJ', 0, 'light'],
    ['KeyK', 0, 'heavy'],
    ['ArrowLeft', 1, 'moveLeft'],
    ['ArrowRight', 1, 'moveRight'],
    ['ArrowUp', 1, 'jump'],
    ['ArrowDown', 1, 'guard'],
    ['Comma', 1, 'light'],
    ['Period', 1, 'heavy'],
  ];
  for (const [code, index, action] of checks) {
    const g = createGame(harness({ mode: 2 }).env);
    g.update(1 / 120, input([code], [code]));
    const f = g.getState().fighters[index];
    if (action === 'moveLeft') assert.ok(f.vx < 0);
    else if (action === 'moveRight') assert.ok(f.vx > 0);
    else if (action === 'jump') assert.ok(f.vy < 0);
    else if (action === 'guard') assert.equal(f.blocking, true);
    else assert.equal(f.attack.type, action);
  }
});
test('knights: fixed input, finite drawing and snapshots are stable at 30/60/120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ mode: 2, lang: 'zh' }).env);
    step(g, 0.5, ['KeyD'], [], hz);
    step(g, 0.5, [], [], hz);
    return g.getState();
  });
  for (const s of states.slice(1)) {
    assert.ok(Math.abs(s.fighters[0].x - states[0].fighters[0].x) < 1e-6);
    assert.ok(Math.abs(s.fighters[0].vx - states[0].fighters[0].vx) < 1e-6);
  }
  const g = createGame(harness().env),
    before = g.getState(),
    ctx = mockContext();
  for (const name of ['fillRect', 'strokeRect', 'translate', 'rotate', 'scale', 'moveTo', 'lineTo'])
    ctx[name] = (...args) =>
      args.forEach((v) => {
        if (typeof v === 'number') assert.ok(Number.isFinite(v));
      });
  g.draw(ctx);
  assert.deepEqual(g.getState(), before);
  const copy = g.getState();
  copy.fighters[0].x = 999;
  assert.deepEqual(g.getState(), before);
});

for (const first of [0, 1])
  test(`knights: a genuinely earlier quick strike interrupts later startup, mirror ${first}`, () => {
    const g = closeDuel(),
      quick = first === 0 ? 'KeyJ' : 'Comma',
      late = first === 0 ? 'Period' : 'KeyK';
    g.update(1 / 120, input([quick]));
    step(g, 0.08);
    g.update(1 / 120, input([late]));
    step(g, 0.2);
    const f = g.getState().fighters;
    assert.equal(f[first].health, 100);
    assert.ok(f[1 - first].health < 100);
    assert.equal(f[1 - first].attack, null);
  });
test('knights: guarding the wrong direction cannot block a blade from behind', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ']));
  step(g, 0.2);
  const [source, target] = g.getState().fighters;
  const attacker = {
    ...source,
    x: 100,
    y: 260,
    attack: {
      ...source.attack,
      hit: false,
      age: source.attack.startup + source.attack.active / 2,
      face: 1,
    },
  };
  const defender = { ...target, x: 135, y: 260, blocking: true, guardFace: 1, parry: 0 };
  assert.equal(resolveStrike(attacker, defender).blocked, false);
  defender.guardFace = -1;
  assert.equal(resolveStrike(attacker, defender).blocked, true);
});
test('knights: holding jump through a round transition cannot create a second jump', () => {
  const g = createGame(harness({ mode: 2 }).env);
  for (let n = 0; n < 18000 && g.getState().round === 1; n++) {
    const [a, b] = g.getState().fighters,
      held = ['KeyW', 'KeyJ'];
    if (a.x < b.x - 34) held.push('KeyD');
    g.update(1 / 120, input(held));
  }
  assert.equal(g.getState().round, 2);
  g.update(1 / 120, input(['KeyW']));
  assert.equal(g.getState().fighters[0].vy, 0);
});
test('knights: health, stamina and current action are labeled in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ lang }).env),
      drawn = [],
      ctx = mockContext();
    ctx.fillText = (value) => drawn.push(String(value));
    g.draw(ctx);
    assert.ok(drawn.some((value) => value.includes(lang === 'en' ? 'HEALTH' : '生命')));
    assert.ok(drawn.some((value) => value.includes(lang === 'en' ? 'STAMINA' : '体力')));
  }
});
test('knights: armor is a poise rule: a swing past its mark resists lighter hits only', () => {
  const swing = (type, age, extra = {}) => ({
    attack: {
      type,
      age,
      startup: 0.7,
      active: 0.2,
      recovery: 0.9,
      armorAt: 0.3,
      poise: 1,
      ...extra,
    },
  });
  assert.equal(isArmored(swing('heavy', 0.2)), false, 'not yet braced');
  assert.equal(isArmored(swing('heavy', 0.4)), true);
  assert.equal(isArmored(swing('heavy', 0.95)), false, 'recovery is never armored');
  assert.equal(isArmored({ attack: null }), false);
  assert.equal(isArmored(swing('heavy', 0.4, { armorAt: undefined })), false);
  assert.equal(resistsInterrupt(swing('heavy', 0.4), { type: 'light' }), true);
  assert.equal(resistsInterrupt(swing('heavy', 0.4), { type: 'heavy' }), false);
  assert.equal(resistsInterrupt(swing('heavy', 0.4, { poise: 3 }), { type: 'heavy' }), true);
  assert.equal(
    resistsInterrupt(swing('heavy', 0.4, { poise: undefined }), { type: 'light' }),
    true,
  );
  assert.equal(resistsInterrupt(swing('heavy', 0.1), { type: 'light' }), false);
});
test('knights: the braced forge hammer is not interrupted by a late quick poke', () => {
  let proved = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { g } = openStage(5, { seed });
    for (let n = 0; n < 120 * 40; n++) {
      const [a, b] = g.getState().fighters,
        held = [];
      if (Math.abs(a.x - b.x) > 36) held.push(a.x < b.x ? 'KeyD' : 'KeyA');
      if (
        b.attack?.type === 'heavy' &&
        b.attack.age > 0.31 &&
        b.attack.age < 0.4 &&
        a.stamina > 12
      ) {
        const before = b.health;
        g.update(1 / 120, input(['KeyJ'], ['KeyJ']));
        for (let k = 0; k < 40 && g.getState().fighters[1].health === before; k++)
          g.update(1 / 120, input());
        const boss = g.getState().fighters[1];
        if (boss.health < before) {
          assert.ok(boss.attack, 'a poke does not cancel the braced hammer');
          proved++;
        }
        break;
      }
      g.update(1 / 120, input(held));
    }
  }
  assert.ok(proved > 0, 'the poke landed on a braced hammer at least once');
});

for (const hz of [30, 60, 120])
  test(`knights: held attacks repeat only after recovery (${hz} Hz)`, () => {
    const h = harness({ mode: 2 }),
      g = createGame(h.env);
    step(g, 2, ['KeyJ'], [], hz);
    // Swings at 0, 0.63 and 1.26 s; the fourth is too tired to start inside two seconds.
    assert.equal(h.sounds.filter((name) => name === 'shoot').length, 3);
  });
test('knights: exhausted guard can be released and refilled without a softlock', () => {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 35, ['KeyS']);
  assert.ok(g.getState().fighters[0].stamina < 1);
  step(g, 2);
  assert.ok(g.getState().fighters[0].stamina > 40);
  const before = g.getState().fighters[0].x;
  step(g, 0.4, ['KeyD']);
  assert.ok(g.getState().fighters[0].x > before);
});
test('knights: passive wall pin remains escapable without position jumps', () => {
  const g = closeDuel();
  step(g, 6, ['KeyD']);
  const pinned = g.getState();
  assert.ok(pinned.fighters[1].x > 450);
  let previous = pinned.fighters[1].x;
  for (let n = 0; n < 120; n++) {
    g.update(1 / 120, input(['ArrowLeft']));
    const now = g.getState().fighters[1];
    assert.ok(Math.abs(now.x - previous) < 2);
    previous = now.x;
  }
  assert.ok(g.getState().fighters[1].x < pinned.fighters[1].x - 10);
  assert.ok(g.getState().fighters.every((f) => f.health === 100));
});

test('knights: an interrupted committed swing keeps its recovery lock against held-repeat input', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ']));
  step(g, 0.08);
  g.update(1 / 120, input(['Period']));
  step(g, 0.2);
  const interrupted = g.getState().fighters[1];
  assert.equal(interrupted.attack, null);
  assert.ok(interrupted.actionLock > 0.2);
  const health = g.getState().fighters[0].health;
  step(g, 0.25, ['Period']);
  assert.equal(g.getState().fighters[1].attack, null);
  assert.equal(g.getState().fighters[0].health, health);
});
test('knights: repeated drawn rounds finish as a draw instead of an endless local match', () => {
  const h = harness({ mode: 2 }),
    g = createGame(h.env);
  step(g, 315);
  assert.equal(g.getState().winner, 0);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /draw/i);
});

for (const seed of [3, 41, 97])
  test(`knights: varied legal inputs stay finite and nonpenetrating (${seed})`, () => {
    const g = createGame(harness({ mode: 2, seed }).env),
      random = seeded(seed + 1000),
      keys = [
        'KeyA',
        'KeyD',
        'KeyW',
        'KeyS',
        'KeyJ',
        'KeyK',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Comma',
        'Period',
      ];
    let held = [];
    for (let n = 0; n < 15000 && g.getState().phase === 'playing'; n++) {
      if (n % 25 === 0) held = keys.filter(() => random() < 0.22);
      g.update(1 / 120, input(held));
      const s = g.getState(),
        [a, b] = s.fighters;
      for (const f of s.fighters) {
        for (const key of ['x', 'y', 'vx', 'vy', 'health', 'stamina'])
          assert.ok(Number.isFinite(f[key]));
        assert.ok(f.health >= 0 && f.health <= 100);
        assert.ok(f.stamina >= 0 && f.stamina <= 100);
        assert.ok(f.x - f.w / 2 >= 12 - 1e-5 && f.x + f.w / 2 <= 468 + 1e-5);
        assert.ok(f.y <= 260 + 1e-5);
      }
      const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x),
        overlapY = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h);
      assert.ok(overlapX < 1e-5 || overlapY < 1e-5, 'solid fighters cannot occupy the same space');
      assert.ok(s.particles <= 100);
      if (n % 240 === 0) g.draw(mockContext());
    }
  });
test('knights: invalid time and pointer-only touches cannot create movement or attacks', () => {
  const g = createGame(harness({ mode: 2 }).env),
    before = g.getState();
  for (const dt of [NaN, Infinity, -1, 0]) g.update(dt, input(['KeyJ']));
  assert.deepEqual(g.getState(), before);
  g.update(1 / 120, input([], [], { x: 130, y: 240, down: true, clicked: true }));
  assert.equal(g.getState().fighters[0].attack, null);
  assert.equal(g.getState().fighters[0].x, before.fighters[0].x);
});

for (const lang of ['en', 'zh'])
  test(`knights: solo defeat names the current champion (${lang})`, () => {
    const { g, h } = openStage(3, { lang });
    step(g, 180);
    assert.equal(g.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.match(h.ends[0].message, lang === 'en' ? /Copper Guard/ : /铜盾守卫/);
    assert.doesNotMatch(h.ends[0].message, /Player 2|玩家2/);
  });

// --- Latched presses, fatigue and recoil -----------------------------------------------------

for (const [code, key, action] of [
  ['KeyJ', 'light', 'light'],
  ['Space', 'light', 'light'],
  ['KeyK', 'heavy', 'heavy'],
  ['Comma', 'light', 'light'],
  ['Period', 'heavy', 'heavy'],
])
  test(`knights: a ${code} tap released before the next update still starts a ${key} swing`, () => {
    const g = createGame(harness({ mode: 2 }).env);
    // pressed() reports the tap but held() already reads false: the key went down and up between updates.
    g.update(1 / 60, input([], [code]));
    const f = g.getState().fighters[code === 'Comma' || code === 'Period' ? 1 : 0];
    assert.equal(f.attack?.type, action);
  });
for (const [code, index] of [
  ['KeyS', 0],
  ['ArrowDown', 1],
])
  test(`knights: a ${code} tap between updates raises the guard long enough to parry`, () => {
    const g = createGame(harness({ mode: 2 }).env);
    g.update(1 / 60, input([], [code]));
    let f = g.getState().fighters[index];
    assert.equal(f.blocking, true);
    assert.ok(f.parry > 0, 'a fresh tap opens the parry window');
    step(g, 0.05);
    assert.equal(g.getState().fighters[index].blocking, true, 'latched for a minimum hold');
    step(g, 0.2);
    f = g.getState().fighters[index];
    assert.equal(f.blocking, false, 'a latch is not a toggle');
  });

test('knights: chained swings cost more stamina and tired swings hit softer', () => {
  const g = createGame(harness({ mode: 2 }).env),
    swings = [];
  let was = null;
  for (let n = 0; n < 120 * 3; n++) {
    g.update(1 / 120, input(['KeyJ']));
    const f = g.getState().fighters[0];
    if (f.attack && (!was || f.attack.age < was.age))
      swings.push({ power: f.attack.power, damage: f.attack.damage });
    was = f.attack;
  }
  assert.ok(swings.length >= 3);
  const light = attackSpec('light').damage;
  assert.equal(swings[0].power, 1);
  assert.equal(swings[0].damage, light);
  assert.ok(swings[2].power < swings[0].power, 'the third chained swing is tired');
  assert.ok(swings[2].damage < light);
  assert.ok(swings[2].power >= RULES.windedPower - 1e-9, 'never weaker than the floor');
});
test('knights: a rested player swings at full power again after the chain window', () => {
  const g = createGame(harness({ mode: 2 }).env);
  step(g, 1.4, ['KeyJ']);
  step(g, RULES.chainWindow + 4);
  g.update(1 / 120, input(['KeyJ']));
  const swing = g.getState().fighters[0].attack;
  assert.equal(swing.power, 1);
  assert.ok(g.getState().fighters[0].stamina >= 100 - RULES.quickCost - 1);
});
test('knights: a blocked swing recoils the attacker and counts as a block', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['KeyJ', 'ArrowDown'], ['ArrowDown']));
  step(g, 0.25, ['ArrowDown']);
  const [a, b] = g.getState().fighters;
  assert.equal(b.blocks, 1);
  assert.equal(a.health, 100);
  assert.equal(b.health, 100);
  assert.ok(a.stun > 0.1 || a.attack === null, 'the attacker is held back by the recoil');
});
test('knights: a parry stuns the attacker for a full second and counts a parry', () => {
  const g = closeDuel();
  g.update(1 / 120, input(['Period']));
  for (let n = 0; n < 200; n++) {
    const attack = g.getState().fighters[1].attack;
    const ready = attack && attack.phase === 'windup' && attack.startup - attack.age < 0.1;
    g.update(1 / 120, input(ready ? ['KeyS'] : [], ready ? ['KeyS'] : []));
    if (g.getState().parries > 0) break;
  }
  const s = g.getState();
  assert.equal(s.parries, 1);
  assert.ok(s.fighters[1].stun > RULES.parryStun - 0.2);
  assert.equal(s.fighters[0].health, 100);
});

// --- Two-player mode keeps solo-only systems out ---------------------------------------------

test('knights: two-player scores never reach the host: state and result report 0', () => {
  const h = harness({ mode: 2 }),
    g = createGame(h.env);
  for (let n = 0; n < 120 * 300 && g.getState().phase === 'playing'; n++) {
    const [a, b] = g.getState().fighters,
      held = ['KeyJ'];
    if (Math.abs(a.x - b.x) > 36) held.push(a.x < b.x ? 'KeyD' : 'KeyA');
    g.update(1 / 120, input(held));
    assert.equal(g.getState().score, 0);
  }
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].score, 0);
  assert.equal(h.ends[0].won, true);
  assert.ok(g.getState().parries >= 0);
});
test('knights: two-player mode has no champion brain, stage select or progress writes', () => {
  const calls = [],
    h = harness({ mode: 2 });
  h.env.progress = {
    unlocked: () => {
      calls.push('read');
      return STAGE_COUNT;
    },
    unlock: () => calls.push('write'),
  };
  const g = createGame(h.env);
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.ai, null);
  assert.equal(s.opponent, 'player');
  assert.deepEqual(calls, []);
  assert.deepEqual(
    s.fighters.map((f) => [f.style, f.gear, f.maxHealth]),
    [
      ['player', 'sword', 100],
      ['player', 'sword', 100],
    ],
  );
  step(g, 200, ['KeyJ', 'KeyD', 'Comma', 'ArrowLeft']);
  assert.deepEqual(calls, [], 'a local match never saves campaign progress');
});
test('knights: the campaign has the shape the contract asks for', () => {
  assert.ok(STAGE_COUNT >= 20);
  assert.equal(STAGES.length, STAGE_COUNT);
  assert.equal(createGame(harness().env).getState().totalStages, STAGE_COUNT);
  assert.match(meta.description.en, new RegExp(String(STAGE_COUNT)));
  assert.match(meta.description.zh, new RegExp(String(STAGE_COUNT)));
});
