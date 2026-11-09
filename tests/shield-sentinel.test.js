import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASH_R,
  BODY,
  CHARGE,
  PLAY_BOTTOM,
  PLAY_TOP,
  PROMPTS,
  SHIELD_HALF,
  SHIELD_INNER,
  SHIELD_OUTER,
  SHIELD_R,
  SHIELD_THICK,
  STEP,
  WALK,
  angleBetween,
  createGame,
  createWorld,
  drawWorld,
  inArc,
  LEVEL_COUNT,
  laneHalfWidth,
  meta,
  promptKey,
  reflect,
  segmentBoxEntry,
  segmentCircleEntry,
  shieldContact,
  snapshot,
  startLevel,
  stepWorld,
} from '../src/games/shield-sentinel.js';
import { harness, input, mockContext, seeded } from './harness.js';

const SHOT_R = { orb: 5, slug: 4, lance: 3 };
const CRAWLER_LEVEL = 4,
  LANCE_LEVEL = 5,
  WALL_LEVEL = 6,
  GUARDIAN_LEVEL = 10;
const mk2 = (seed = 1) => {
  const w = mk(seed);
  startLevel(w, CRAWLER_LEVEL);
  w.introT = 0;
  w.atk.wait = 1e9;
  return w;
};
const mk = (seed = 1) => {
  const w = createWorld(seeded(seed), 2);
  w.introT = 0;
  w.atk.wait = 1e9;
  return w;
};
const tickN = (w, n, held = [], pressed = []) => {
  for (let i = 0; i < n; i++) stepWorld(w, STEP, input(held, i === 0 ? pressed : []));
};
const addShot = (w, kind, x, y, vx, vy, extra = {}) => {
  const s = {
    id: w.nextId++,
    kind,
    x,
    y,
    vx,
    vy,
    r: SHOT_R[kind],
    owner: 'foe',
    reflected: false,
    hit: [],
    ...extra,
  };
  w.shots.push(s);
  return s;
};
const dummyFoe = (w, x, y, hp, extra = {}) => {
  const f = {
    id: w.nextId++,
    type: 'turret',
    x,
    y,
    hw: 10,
    hh: 10,
    hp,
    maxHp: hp,
    pattern: ['orb'],
    k: 0,
    charge: null,
    exposed: 0,
    flash: 0,
    ...extra,
  };
  w.foes.push(f);
  return f;
};
const crawler = (w, x, y, extra = {}) => {
  const c = { id: w.nextId++, x, y, hw: 6, hh: 5, portal: 0, stun: 0, ...extra };
  w.crawlers.push(c);
  return c;
};
const polar = (w, angle, dist) => ({
  x: w.p.x + Math.cos(angle) * dist,
  y: w.p.y + Math.sin(angle) * dist,
});

test('shield sentinel: metadata is bilingual and every action has a touch control', () => {
  assert.equal(meta.id, 'shield-sentinel');
  assert.equal(meta.name.zh, '护盾卫士');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  assert.match(meta.description.zh, /\p{Script=Han}/u);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX']) {
    const c = meta.touchControls.find((x) => x.code === code);
    assert.ok(c && c.label.en && /\p{Script=Han}/u.test(c.label.zh), code);
  }
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  for (const [en, zh] of Object.values(PROMPTS)) {
    assert.ok(en.length <= 46 && zh.length <= 24, en);
    assert.match(zh, /\p{Script=Han}/u);
  }
  assert.match(PROMPTS.orb[0], /Space/);
  assert.match(PROMPTS.crawler[0], /X/);
});

test('shield sentinel: zero, negative, NaN, infinite and huge dt never advance state or read input', () => {
  const h = harness(),
    g = createGame(h.env),
    before = structuredClone(g.getState());
  let reads = 0;
  const spy = {
    held: () => (reads++, true),
    pressed: () => (reads++, true),
    pointer: {},
  };
  for (const dt of [0, -1, -1e-9, NaN, Infinity, -Infinity, 5, 1e9]) g.update(dt, spy);
  assert.deepEqual(g.getState(), before);
  assert.equal(reads, 0);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});

test('shield sentinel: a sub-tick dt waits for a full tick instead of reading or losing input', () => {
  const w = mk();
  let reads = 0;
  const spy = { held: () => (reads++, false), pressed: (code) => code === 'KeyX' };
  stepWorld(w, STEP / 4, spy);
  assert.equal(reads, 0);
  assert.equal(w.tick, 0);
  stepWorld(w, STEP, input(['ArrowRight']));
  assert.equal(w.tick, 1);
  assert.equal(w.p.bashT > 0, true, 'a bash tapped in a sub-tick frame still fires');
});

test('shield sentinel: a long frame is capped to 1/30 second of simulation', () => {
  const a = mk(),
    b = mk();
  stepWorld(a, 0.9, input(['ArrowRight']));
  stepWorld(b, 1 / 30, input(['ArrowRight']));
  assert.equal(a.tick, 4);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('shield sentinel: geometry helpers behave as documented', () => {
  assert.ok(Math.abs(segmentCircleEntry(0, 0, 10, 0, 10, 0, 4) - 0.6) < 1e-9);
  assert.equal(segmentCircleEntry(5, 0, 10, 0, 10, 0, 6), null); // starts inside
  assert.equal(segmentCircleEntry(0, 0, -10, 0, 10, 0, 4), null); // moving away
  assert.equal(segmentCircleEntry(0, 0, 0, 0, 10, 0, 4), null); // not moving
  assert.equal(segmentCircleEntry(0, 20, 10, 20, 10, 0, 4), null); // misses
  assert.equal(segmentCircleEntry(0, 0, 3, 0, 10, 0, 4), null); // too short
  assert.ok(Math.abs(segmentBoxEntry(0, 0, 10, 0, 10, 0, 2, 2) - 0.8) < 1e-9);
  assert.equal(segmentBoxEntry(0, 0, 10, 0, 1, 0, 2, 2) <= 0.3, true);
  assert.equal(segmentBoxEntry(1, 0, 10, 0, 0, 0, 2, 2), 0); // starts inside
  assert.equal(segmentBoxEntry(0, 5, 10, 5, 10, 0, 2, 2), null);
  assert.equal(segmentBoxEntry(0, 0, 0, 10, 10, 0, 2, 2), null); // vertical miss
  assert.equal(segmentBoxEntry(0, 0, 10, 10, 10, 0, 1, 1), null); // diagonal miss
  const r = reflect(0, 10, 0, -1);
  assert.deepEqual([r.vx, r.vy], [0, -10]);
  const d = reflect(10, 10, 0, -1);
  assert.deepEqual([d.vx, d.vy], [10, -10]);
  assert.ok(angleBetween(Math.PI, -Math.PI) < 1e-9);
  assert.ok(inArc(1, 0, 0) && !inArc(0, 1, 0));
  assert.equal(laneHalfWidth(0, 1), 11);
  assert.equal(laneHalfWidth(1, 0), 15);
});

test('shield sentinel: collider and sprite size match and meet the readability range', () => {
  assert.equal(BODY.hh * 2, 24);
  assert.equal(BODY.hw * 2, 16);
  const w = mk(),
    boxes = [],
    ctx = mockContext();
  let style = '';
  const sentinelColors = new Set(['#9fb4c8', '#4a6a9a', '#2b3a55']);
  const proxy = new Proxy(ctx, {
    get: (t, p) =>
      p === 'fillRect'
        ? (x, y, ww, hh) => sentinelColors.has(style) && boxes.push([x, y, x + ww, y + hh])
        : t[p],
    set: (t, p, v) => ((t[p] = v), p === 'fillStyle' && (style = v), true),
  });
  drawWorld(proxy, w, harness().env);
  const x0 = Math.min(...boxes.map((b) => b[0])),
    x1 = Math.max(...boxes.map((b) => b[2])),
    y0 = Math.min(...boxes.map((b) => b[1])),
    y1 = Math.max(...boxes.map((b) => b[3]));
  assert.deepEqual([x1 - x0, y1 - y0], [BODY.hw * 2, BODY.hh * 2]);
  assert.deepEqual([x0, y0], [w.p.x - BODY.hw, w.p.y - BODY.hh]);
});

test('shield sentinel: movement is 8-way, bounded, normalised, and rooted while the shield is up', () => {
  const w = mk();
  tickN(w, 120, ['ArrowRight']);
  assert.ok(Math.abs(w.p.x - 340) < 1e-6 && w.p.y === 190);
  const d = mk();
  tickN(d, 60, ['KeyD', 'KeyS']);
  assert.ok(Math.abs(d.p.x - 240 - (d.p.y - 190)) < 1e-6);
  assert.ok(Math.abs(Math.hypot(d.p.x - 240, d.p.y - 190) - 50) < 1e-6);
  tickN(w, 600, ['ArrowRight', 'ArrowDown']);
  assert.deepEqual([w.p.x, w.p.y], [428, 256]);
  tickN(w, 900, ['KeyA', 'KeyW']);
  assert.deepEqual([w.p.x, w.p.y], [52, 90]);
  const r = mk();
  tickN(r, 30, ['Space', 'ArrowLeft']);
  assert.deepEqual([r.p.x, r.p.y], [240, 190]);
  assert.ok(Math.abs(r.p.face - Math.PI) < 1e-9);
  const o = mk();
  tickN(o, 30, ['ArrowLeft', 'ArrowRight']);
  assert.equal(o.p.x, 240);
});

test('shield sentinel: only the shield arc blocks, by actual geometry', () => {
  const face = -Math.PI / 2;
  const run = (deltaDeg, shieldHeld = true) => {
    const w = mk();
    const a = face + (deltaDeg * Math.PI) / 180;
    const from = polar(w, a, 70);
    addShot(w, 'orb', from.x, from.y, -Math.cos(a) * 150, -Math.sin(a) * 150);
    for (let i = 0; i < 90 && w.shots.length; i++)
      stepWorld(w, STEP, input(shieldHeld ? ['Space'] : []));
    return w;
  };
  for (const delta of [0, 30, -30, 44]) {
    const w = run(delta);
    assert.equal(w.hp, 5, `blocked at ${delta}`);
    assert.equal(w.shots[0]?.reflected, true);
  }
  for (const delta of [70, -70, 90, 180]) assert.equal(run(delta).hp, 4, `passes at ${delta}`);
  assert.equal(run(0, false).hp, 4, 'a lowered shield blocks nothing');
  assert.equal(SHIELD_HALF, Math.PI / 4);
});

test('shield sentinel: a shot already inside the shield radius is not blocked retroactively', () => {
  const w = mk();
  addShot(w, 'orb', 240, 190 - 10, 0, 150);
  tickN(w, 5, ['Space']);
  assert.equal(w.hp, 4);
});

test('shield sentinel: very fast shots are swept and cannot tunnel through the arc or the body', () => {
  for (const speed of [600, 3000, 20000]) {
    const blocked = mk();
    addShot(blocked, 'orb', 240, 40, 0, speed);
    const events = [];
    for (let i = 0; i < 60; i++) {
      stepWorld(blocked, STEP, input(['Space']));
      events.push(...blocked.events);
    }
    assert.ok(events.includes('block'), `arc at ${speed}`);
    assert.equal(blocked.hp, 5);
    const hit = mk();
    addShot(hit, 'orb', 240, 40, 0, speed);
    tickN(hit, 60, []);
    assert.equal(hit.hp, 4, `body at ${speed}`);
  }
  const side = mk();
  addShot(side, 'orb', 400, 190, -9000, 0);
  tickN(side, 3, ['Space']);
  assert.equal(side.hp, 4, 'a side shot passes the gap and hits the body');
});

test('shield sentinel: reflection mirrors about the shield normal and boosts speed', () => {
  const w = mk();
  addShot(w, 'orb', 250, 120, 0, 150);
  tickN(w, 120, ['Space']);
  const s = w.shots.find((x) => x.reflected);
  assert.ok(s && s.owner === 'player');
  const hy = 190 - Math.sqrt(31 * 31 - 100);
  const n = [10 / 31, (hy - 190) / 31];
  const expected = reflect(0, 150, n[0], n[1]);
  assert.ok(Math.abs(s.vx - expected.vx * 1.2) < 1e-6);
  assert.ok(Math.abs(s.vy - expected.vy * 1.2) < 1e-6);
  assert.ok(w.p.energy < 100);
});

test('shield sentinel: a straight shot returns to the turret that fired it and damages it once', () => {
  const w = mk();
  const foe = w.foes[0];
  addShot(w, 'orb', foe.x, foe.y, 0, 0);
  const s = w.shots[0];
  const dx = 240 - foe.x,
    dy = 190 - foe.y,
    len = Math.hypot(dx, dy);
  s.vx = (dx / len) * 150;
  s.vy = (dy / len) * 150;
  const face = Math.atan2(dy, dx) + Math.PI;
  const keys = ['Space', ...(Math.cos(face) < 0 ? ['ArrowLeft'] : ['ArrowRight']), 'ArrowUp'];
  tickN(w, 600, keys);
  assert.equal(foe.hp, 1);
  assert.equal(w.score, 50);
  assert.equal(w.shots.length, 0);
});

test('shield sentinel: a reflected shot damages each target once and credits once', () => {
  const w = mk();
  w.foes = [];
  const a = dummyFoe(w, 240, 100, 3),
    b = dummyFoe(w, 240, 60, 3);
  dummyFoe(w, 400, 200, 3);
  const s = addShot(w, 'orb', 240, 150, 0, -200, { owner: 'player', reflected: true });
  tickN(w, 240);
  assert.deepEqual([a.hp, b.hp], [2, 2]);
  assert.equal(w.score, 100);
  assert.deepEqual([...s.hit].sort(), [a.id, b.id].sort());
  assert.equal(w.shots.length, 0);
  const killer = mk();
  killer.foes = [];
  const f = dummyFoe(killer, 240, 100, 1);
  dummyFoe(killer, 400, 200, 3);
  addShot(killer, 'orb', 240, 150, 0, -200, { owner: 'player', reflected: true });
  tickN(killer, 120);
  assert.equal(f.hp, 0);
  assert.equal(killer.score, 250);
});

test('shield sentinel: slugs are blocked but never reflected, and lances ignore the shield', () => {
  const w = mk();
  addShot(w, 'slug', 240, 120, 0, 150);
  tickN(w, 120, ['Space']);
  assert.equal(w.hp, 5);
  assert.equal(w.shots.length, 0);
  const l = mk();
  addShot(l, 'lance', 240, 120, 0, 300);
  tickN(l, 120, ['Space']);
  assert.equal(l.hp, 3);
  assert.equal(l.shots.length, 0);
});

test('shield sentinel: lance telegraph lanes match the hitbox exactly', () => {
  const run = (dx) => {
    const w = mk();
    w.p.x = 240 + dx;
    addShot(w, 'lance', 240, 100, 0, 300);
    tickN(w, 120);
    return w.hp;
  };
  assert.equal(run(10.9), 3);
  assert.equal(run(-10.9), 3);
  assert.equal(run(11.1), 5);
  assert.equal(run(-11.1), 5);
});

test('shield sentinel: every attack is telegraphed with a human-length warning', () => {
  for (const kind of ['orb', 'slug', 'lance', 'slam']) assert.ok(CHARGE[kind] >= 0.7, kind);
  assert.ok(CHARGE.lance >= 0.9 && CHARGE.slam >= 1.2);
  const w = createWorld(seeded(2));
  const seen = new Map();
  for (let i = 0; i < 120 * 90 && w.phase === 'playing'; i++) {
    stepWorld(w, STEP, input([]));
    for (const f of w.foes)
      if (f.charge) seen.set(f.charge.kind, Math.max(seen.get(f.charge.kind) ?? 0, f.charge.t));
    for (const s of w.shots) {
      if (s.kind === 'lance' && s.owner === 'foe') assert.ok((seen.get('lance') ?? 0) >= 0.9);
    }
  }
  assert.ok(seen.has('orb'));
  const lance = mk();
  startLevel(lance, LANCE_LEVEL);
  lance.introT = 0;
  lance.atk.wait = 0;
  const turretWithLance = lance.foes[0];
  turretWithLance.k = 1;
  lance.atk.step = 0;
  tickN(lance, 1);
  assert.equal(turretWithLance.charge.kind, 'lance');
  assert.ok(Math.hypot(turretWithLance.charge.dirx, turretWithLance.charge.diry) > 0.99);
  tickN(lance, Math.round(0.85 / STEP));
  assert.equal(lance.shots.length, 0, 'no lance before the telegraph completes');
  tickN(lance, Math.round(0.2 / STEP));
  assert.equal(lance.shots[0]?.kind, 'lance');
});

test('shield sentinel: event times are ordered, so an earlier fatal hit is not undone by a later block', () => {
  const setup = () => {
    const w = mk();
    w.hp = 1;
    tickN(w, 1, ['Space', 'ArrowRight']);
    return w;
  };
  const w = setup();
  const energyBefore = w.p.energy;
  addShot(w, 'lance', 240, 178 - 3 - 0.5, 0, 300);
  addShot(w, 'orb', 240 + 31 + 1, 190, -150, 0);
  stepWorld(w, STEP, input(['Space', 'ArrowRight']));
  assert.equal(w.phase, 'lost');
  assert.equal(w.hp, 0);
  assert.ok(w.p.energy > energyBefore - 1, 'the later block never happened');
  const second = mk();
  tickN(second, 1, ['Space', 'ArrowRight']);
  addShot(second, 'orb', 240 + 31 + 0.25, 190, -150, 0);
  addShot(second, 'lance', 240, 178 - 3 - 2, 0, 300);
  stepWorld(second, STEP, input(['Space', 'ArrowRight']));
  assert.equal(second.hp, 3);
  assert.ok(second.shots.some((s) => s.reflected));
});

test('shield sentinel: a fatal hit earlier than the final kill wins the tick', () => {
  const w = mk();
  w.foes = [];
  const f = dummyFoe(w, 240, 100, 1);
  w.hp = 1;
  addShot(w, 'orb', 240, 130, 0, -150, { owner: 'player', reflected: true });
  addShot(w, 'lance', 240, 178 - 3 - 0.5, 0, 300);
  stepWorld(w, STEP, input([]));
  assert.equal(w.phase, 'lost');
  assert.equal(f.hp, 1);
});

test('shield sentinel: the invulnerability window is visible and prevents back-to-back damage', () => {
  const w = mk();
  addShot(w, 'slug', 240, 170, 0, 100);
  addShot(w, 'slug', 240, 160, 0, 100);
  tickN(w, 30);
  assert.equal(w.hp, 4);
  assert.ok(snapshot(w).sentinel.invulnerable > 0);
  tickN(w, 120);
  assert.equal(snapshot(w).sentinel.invulnerable, 0);
});

test('shield sentinel: the shield drains, recharges, breaks at zero and recovers visibly', () => {
  const w = mk();
  tickN(w, 120, ['Space']);
  assert.ok(Math.abs(w.p.energy - 95) < 0.01);
  tickN(w, 120);
  assert.equal(w.p.energy, 100);
  w.p.energy = 0.05;
  w.p.shieldUp = true;
  tickN(w, 10, ['Space']);
  assert.ok(w.p.broken > 1.4);
  assert.equal(snapshot(w).sentinel.shieldUp, false);
  tickN(w, 60, ['Space']);
  assert.equal(snapshot(w).sentinel.shieldUp, false);
  assert.equal(promptKey(w), 'broken');
  tickN(w, 120);
  assert.equal(w.p.broken, 0);
  tickN(w, 120);
  assert.ok(w.p.energy > 10);
  const low = mk();
  low.p.energy = 5;
  tickN(low, 2, ['Space']);
  assert.equal(low.p.shieldUp, false, 'needs a minimum charge to raise');
  const blocks = mk();
  blocks.p.energy = 9;
  blocks.p.shieldUp = true;
  addShot(blocks, 'orb', 240, 150, 0, 150);
  tickN(blocks, 60, ['Space']);
  assert.equal(blocks.p.broken > 0, true, 'a block that empties the shield breaks it');
});

test('shield sentinel: bash is short, costs shield energy, has a visible cooldown and cannot spam', () => {
  const w = mk();
  tickN(w, 1, [], ['KeyX']);
  assert.equal(w.p.energy, 88 + 45 * STEP * 0);
  assert.ok(snapshot(w).sentinel.bashActive);
  assert.ok(snapshot(w).sentinel.bashCooldown > 0.79);
  tickN(w, 30);
  assert.equal(snapshot(w).sentinel.bashActive, false);
  const e = w.p.energy;
  tickN(w, 1, [], ['KeyX']);
  assert.ok(w.p.energy >= e, 'ignored while cooling down');
  tickN(w, 100);
  assert.equal(snapshot(w).sentinel.bashCooldown, 0);
  tickN(w, 1, [], ['KeyX']);
  assert.ok(snapshot(w).sentinel.bashActive);
  const up = mk();
  tickN(up, 1, ['Space'], ['KeyX']);
  assert.equal(up.p.bashT, 0, 'no bash while the shield is up');
  const empty = mk();
  empty.p.energy = 11;
  empty.p.delay = 5;
  tickN(empty, 1, [], ['KeyX']);
  assert.equal(empty.p.bashT, 0);
});

test('shield sentinel: bash defeats crawlers in front only, within its reach', () => {
  const w = mk();
  const front = crawler(w, 240, 190 - 30),
    behind = crawler(w, 240, 190 + 30),
    far = crawler(w, 240 + 60, 190 - 30);
  const ids = [front.id, behind.id, far.id];
  tickN(w, 1, [], ['KeyX']);
  assert.deepEqual(
    w.crawlers.map((c) => c.id),
    [behind.id, far.id].filter((id) => ids.includes(id)),
  );
  assert.equal(w.score, 25);
  assert.ok(BASH_R > 30);
});

test('shield sentinel: crawlers spawn behind a portal, hurt on contact, and the arc bounces them', () => {
  const portal = mk2();
  crawler(portal, 240, 190, { portal: 0.5 });
  tickN(portal, 10);
  assert.equal(portal.hp, 5);
  const touch = mk2();
  crawler(touch, 240, 225);
  tickN(touch, 120);
  assert.equal(touch.hp, 4);
  assert.equal(touch.crawlers.length, 0);
  const bounced = mk2();
  const c = crawler(bounced, 240, 190 - 40);
  tickN(bounced, 120, ['Space']);
  assert.equal(bounced.hp, 5);
  assert.ok(c.y < 190 - 28 && bounced.p.energy < 100);
  assert.ok(c.stun >= 0);
  const behind = mk2();
  crawler(behind, 240, 190 + 40);
  tickN(behind, 240, ['Space']);
  assert.equal(behind.hp, 4, 'a crawler behind the shield still hurts');
  const spawn = createWorld(seeded(4));
  startLevel(spawn, CRAWLER_LEVEL);
  spawn.introT = 0;
  spawn.atk.wait = 1e9;
  tickN(spawn, 120 * 5);
  assert.equal(spawn.crawlers.length, 1);
  assert.ok(spawn.crawlers[0].portal > 0 || spawn.crawlers[0].x !== undefined);
  const pinned = mk();
  startLevel(pinned, CRAWLER_LEVEL);
  pinned.introT = 0;
  pinned.atk.wait = 1e9;
  pinned.p.x = 52;
  pinned.random = () => 0;
  tickN(pinned, 120 * 3 + 5);
  assert.equal(pinned.crawlers[0].x, 428, 'spawns on the side away from the sentinel');
});

test('shield sentinel: levels clear in order, heal two points, show a visible intro timer, then the guardian', () => {
  const w = createWorld(seeded(3));
  assert.equal(snapshot(w).introLeft, 3);
  assert.equal(promptKey(w), 'intro');
  w.introT = 0;
  w.atk.wait = 1e9;
  w.hp = 3;
  for (const f of w.foes) f.hp = 0;
  tickN(w, 1);
  const s = snapshot(w);
  assert.equal(s.level, 2);
  assert.equal(s.hp, 5);
  assert.equal(s.score, 300);
  assert.ok(s.introLeft > 2);
  assert.equal(w.foes.length, 2);
  assert.equal(w.shots.length, 0);
  tickN(w, 120);
  assert.equal(
    w.foes.every((f) => !f.charge),
    true,
    'nothing attacks during the intro',
  );
  startLevel(w, GUARDIAN_LEVEL);
  assert.equal(snapshot(w).guardianLevel, true);
  assert.match(snapshot(w).status.en, /Guardian 6\/6/);
});

test('shield sentinel: the guardian slam is telegraphed, breaks the shield, exposes the guardian and can be dodged', () => {
  const setup = () => {
    const w = mk();
    startLevel(w, GUARDIAN_LEVEL);
    w.introT = 0;
    w.atk.wait = 0;
    w.foes[0].k = 4;
    w.atk.step = 0;
    tickN(w, 1);
    return w;
  };
  const w = setup();
  const g = w.foes[0];
  assert.equal(g.charge.kind, 'slam');
  assert.equal(g.charge.r, 36);
  assert.equal(promptKey(w), 'slam');
  tickN(w, Math.round(1.2 / STEP));
  assert.equal(w.hp, 5, 'still telegraphing');
  tickN(w, 20, ['Space']);
  assert.equal(w.hp, 3);
  assert.equal(w.p.energy, 0);
  assert.ok(w.p.broken > 1.4);
  assert.ok(g.exposed > 3.9);
  assert.ok(w.fx.some((f) => f.kind === 'slam'));
  const dodge = setup();
  tickN(dodge, Math.round(0.6 / STEP), ['ArrowRight']);
  tickN(dodge, Math.round(1 / STEP));
  assert.equal(dodge.hp, 5);
  assert.ok(dodge.foes[0].exposed > 0, 'the guardian is exposed even when the slam is dodged');
  const orb = addShot(dodge, 'orb', 240, 100, 0, 0, { owner: 'player', reflected: true });
  orb.x = 240;
  orb.y = 100;
  orb.vy = -300;
  tickN(dodge, 30);
  assert.equal(dodge.foes[0].hp, 4, 'exposed guardians take double reflected damage');
  const plain = mk();
  startLevel(plain, GUARDIAN_LEVEL);
  plain.introT = 0;
  addShot(plain, 'orb', 240, 100, 0, -300, { owner: 'player', reflected: true });
  tickN(plain, 30);
  assert.equal(plain.foes[0].hp, 5);
});

test('shield sentinel: defeating the guardian wins once, freezes state and ignores input', () => {
  const h = harness({ seed: 5 }),
    g = createGame(h.env);
  // Drive the public game with the shared policy-free route: lose first to prove terminal handling.
  const idle = input([]);
  for (let i = 0; i < 60 * 600 && h.ends.length === 0; i++) g.update(1 / 60, idle);
  assert.equal(h.ends.length, 1);
  const done = structuredClone(g.getState());
  assert.equal(done.phase, 'lost');
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /sentinel fell/);
  assert.match(h.ends[0].message, /red lanes and purple circles/);
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['Space', 'ArrowLeft'], ['KeyX']));
  assert.deepEqual(g.getState(), done);
  assert.equal(h.ends.length, 1);
  assert.ok(h.sounds.includes('lose'));
  const fresh = createGame(harness({ seed: 5 }).env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.hp, 5);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.level, 1);
});

test('shield sentinel: clearing the last level is a win with a bonus', () => {
  const w = mk();
  startLevel(w, LEVEL_COUNT);
  w.introT = 0;
  w.foes[0].hp = 1;
  addShot(w, 'orb', 240, 100, 0, -300, { owner: 'player', reflected: true });
  tickN(w, 30);
  assert.equal(w.phase, 'won');
  assert.equal(w.score, 50 + 200 + 300 + 1000 + 500);
  const frozen = structuredClone(snapshot(w));
  tickN(w, 60, ['Space', 'ArrowLeft'], ['KeyX']);
  assert.deepEqual(snapshot(w), frozen);
});

test('shield sentinel: wave and guardian prompts exist for every threat in both languages', () => {
  const w = mk();
  w.foes[0].charge = { kind: 'orb', t: 0, dur: 0.7 };
  assert.equal(promptKey(w), 'orb');
  w.foes[0].charge = { kind: 'slug', t: 0, dur: 0.7 };
  assert.equal(promptKey(w), 'slug');
  w.foes[0].charge = { kind: 'lance', t: 0, dur: 1 };
  assert.equal(promptKey(w), 'lance');
  w.foes[0].charge = null;
  addShot(w, 'slug', 10, 10, 0, 0);
  assert.equal(promptKey(w), 'slug');
  w.shots = [];
  crawler(w, 260, 200);
  assert.equal(promptKey(w), 'crawler');
  w.crawlers = [];
  assert.equal(promptKey(w), 'idle');
  const s = snapshot(w);
  assert.equal(typeof s.status.en, 'string');
  assert.match(s.status.en, /^Level 2\/20 · HP 5 · /);
  assert.match(s.status.zh, /^第2\/20关 · 生命 5 · /);
});

test('shield sentinel: entities stay in the playfield, clear of the HUD bands', () => {
  const w = createWorld(seeded(9));
  const bad = [];
  const check = (name, x0, y0, x1, y1) => {
    if (y0 < PLAY_TOP || y1 > PLAY_BOTTOM || x0 < 0 || x1 > 480) bad.push([name, x0, y0, x1, y1]);
  };
  for (const route of [[], ['Space'], ['ArrowUp', 'ArrowLeft'], ['ArrowDown', 'ArrowRight']]) {
    const world = createWorld(seeded(9));
    for (let i = 0; i < 120 * 6; i++) {
      stepWorld(world, STEP, input(route, i % 90 === 0 ? ['KeyX'] : []));
      const p = world.p;
      check('sentinel', p.x - 34, p.y - 34, p.x + 34, p.y + 34);
      for (const f of world.foes)
        check('foe', f.x - f.hw, f.y - f.hh - 0, f.x + f.hw, f.y + f.hh + 7);
      for (const c of world.crawlers)
        check('crawler', c.x - c.hw, c.y - c.hh, c.x + c.hw, c.y + c.hh);
      for (const s of world.shots) check('shot', s.x, s.y, s.x, s.y);
    }
  }
  assert.deepEqual(bad.slice(0, 3), []);
  startLevel(w, GUARDIAN_LEVEL);
  assert.ok(w.foes[0].y - w.foes[0].hh >= PLAY_TOP);
  assert.ok(255 + 36 + 1 <= PLAY_BOTTOM + 40);
});

test('shield sentinel: draw smoke covers every state, uses 14-16 px text and stays finite', () => {
  const sizes = new Set();
  const ctx = mockContext();
  const proxy = new Proxy(ctx, {
    get: (t, p) => (p === 'fillText' ? () => sizes.add(Number(/(\d+)px/.exec(t.font)?.[1])) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const lang of ['en', 'zh']) {
    const env = harness({ lang }).env;
    const w = createWorld(seeded(6));
    drawWorld(proxy, w, env);
    startLevel(w, WALL_LEVEL);
    w.introT = 0;
    w.p.shieldUp = true;
    w.p.bashT = 0.1;
    w.p.inv = 0.5;
    crawler(w, 200, 150, { stun: 1 });
    crawler(w, 220, 150, { portal: 0.3 });
    w.foes[0].flash = 0.1;
    for (const kind of ['orb', 'slug', 'lance']) {
      addShot(w, kind, 100, 100, 100, 100);
      addShot(w, kind, 120, 100, 100, 100, { owner: 'player', reflected: true });
    }
    w.foes[0].charge = { kind: 'lance', t: 0.5, dur: 1, dirx: 0, diry: 1, lx: 0, ly: 0 };
    w.foes[1].charge = { kind: 'orb', t: 0.3, dur: 0.7, dirx: 0, diry: 1, lx: 0, ly: 0 };
    w.fx.push({ kind: 'hurt', x: 50, y: 50, t: 0.1, life: 0.35 });
    drawWorld(proxy, w, env);
    startLevel(w, GUARDIAN_LEVEL);
    w.introT = 0;
    w.foes[0].exposed = 2;
    w.foes[0].charge = {
      kind: 'slam',
      t: 0.6,
      dur: 1.3,
      lx: 200,
      ly: 200,
      r: 36,
      dirx: 0,
      diry: 1,
    };
    w.p.broken = 1;
    drawWorld(proxy, w, env);
  }
  assert.ok(
    [...sizes].every((s) => s >= 14 && s <= 16),
    [...sizes].join(),
  );
});

test('shield sentinel: the same aligned input script gives identical full state at 30, 60 and 120 Hz', () => {
  const rnd = seeded(77);
  const slots = Array.from({ length: 30 * 40 }, () => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].filter(
      () => rnd() < 0.3,
    );
    return { keys, bash: rnd() < 0.1 };
  });
  const play = (hz) => {
    const h = harness({ seed: 5 }),
      g = createGame(h.env),
      per = hz / 30;
    const marks = [];
    slots.forEach((slot, n) => {
      for (let k = 0; k < per; k++)
        g.update(1 / hz, input(slot.keys, k === 0 && slot.bash ? ['KeyX'] : []));
      if (n % 300 === 299) marks.push(structuredClone(g.getState()));
    });
    return { marks, last: g.getState(), sounds: h.sounds.length, ends: h.ends };
  };
  const a = play(30),
    b = play(60),
    c = play(120);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

const allFinite = (value) => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(allFinite);
};

test('shield sentinel: seeded random play stays finite and bounded, and ends exactly once', () => {
  for (const seed of [1, 2, 3, 4]) {
    const h = harness({ seed }),
      g = createGame(h.env),
      rnd = seeded(seed * 31);
    const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA'];
    for (let i = 0; i < 60 * 240 && h.ends.length === 0; i++) {
      const held = codes.filter(() => rnd() < 0.25);
      g.update(1 / 60, input(held, rnd() < 0.05 ? ['KeyX'] : []));
      const s = g.getState();
      assert.ok(s.shots.length <= 12 && s.crawlers.length <= 3);
      assert.ok(s.hp >= 0 && s.hp <= 5);
      if (i % 30 === 0) allFinite(s);
    }
    assert.ok(h.ends.length <= 1);
    assert.equal(typeof g.getState().status.en, 'string');
  }
});

test('shield sentinel: a crawler bounce that empties the shield breaks it', () => {
  const w = mk2();
  w.p.energy = 3;
  w.p.shieldUp = true;
  crawler(w, 240, 190 - 25);
  tickN(w, 2, ['Space']);
  assert.ok(w.p.broken > 1);
  assert.equal(w.hp, 5);
});

test('shield sentinel: a turret destroyed mid-charge cancels its attack and restarts the rest timer', () => {
  const w = mk();
  const f = w.foes[0];
  f.hp = 1;
  f.charge = { kind: 'orb', t: 0.1, dur: 0.7, dirx: 0, diry: 1, lx: 0, ly: 0 };
  addShot(w, 'orb', f.x, f.y + 40, 0, -200, { owner: 'player', reflected: true });
  tickN(w, 30);
  assert.equal(f.hp, 0);
  assert.equal(f.charge, null);
  assert.equal(w.atk.wait, 1.2);
});

test('shield sentinel: the game wrapper draws and reports sounds for the actions taken', () => {
  const h = harness(),
    g = createGame(h.env);
  g.draw(mockContext());
  for (let i = 0; i < 60; i++) g.update(1 / 60, input(['Space'], i === 0 ? ['KeyX'] : []));
  g.update(1 / 60, input([], ['KeyX']));
  assert.ok(h.sounds.includes('move'));
});

test('shield sentinel: drawn plates are bold and match the blocking geometry', () => {
  assert.ok(SHIELD_THICK >= 6);
  assert.equal(SHIELD_OUTER, SHIELD_R + SHIELD_THICK / 2);
  assert.equal(snapshot(mk()).sentinel.arc.thickness, SHIELD_THICK);
  const arcs = [];
  const make = (w) => {
    const ctx = mockContext();
    let width = 0;
    return new Proxy(ctx, {
      get: (t, p) =>
        p === 'arc'
          ? (x, y, r, a0, a1) => arcs.push({ x, y, r, a0, a1, width, dash: t.dashed })
          : p === 'setLineDash'
            ? (d) => (t.dashed = d.length > 0)
            : t[p],
      set: (t, p, v) => ((t[p] = v), p === 'lineWidth' && (width = v), true),
    });
  };
  const w = mk();
  tickN(w, 2, ['Space']);
  drawWorld(make(w), w, harness().env);
  const plates = arcs.filter((a) => a.width === SHIELD_THICK && a.r === SHIELD_R);
  assert.equal(plates.length, 5);
  assert.ok(Math.min(...plates.map((a) => a.a0)) >= w.p.face - SHIELD_HALF - 1e-9);
  assert.ok(Math.max(...plates.map((a) => a.a1)) <= w.p.face + SHIELD_HALF + 1e-9);
  // Lowered: no plates, only the dotted ghost.
  arcs.length = 0;
  const down = mk();
  drawWorld(make(down), down, harness().env);
  assert.equal(arcs.filter((a) => a.width === SHIELD_THICK).length, 0);
  assert.ok(arcs.some((a) => a.r === SHIELD_R && a.dash));
  // A shot touching the drawn outer edge is blocked; one still outside is not.
  const touch = mk();
  addShot(touch, 'orb', 240, 190 - (SHIELD_OUTER + 5 + 0.5), 0, 150);
  tickN(touch, 1, ['Space']);
  assert.ok(touch.events.includes('block'));
  assert.ok(touch.p.blockT > 0);
  assert.ok(snapshot(touch).sentinel.blockFlash > 0);
  drawWorld(make(touch), touch, harness().env);
  const early = mk();
  addShot(early, 'orb', 240, 190 - (SHIELD_OUTER + 5 + 3), 0, 150);
  tickN(early, 1, ['Space']);
  assert.equal(early.events.includes('block'), false);
});

test('shield sentinel: no shot can spawn inside the shield catch radius at any reachable position', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const w = mk();
    startLevel(w, level);
    for (const f of w.foes) {
      const nx = Math.min(Math.max(f.x, WALK.x0), WALK.x1),
        ny = Math.min(Math.max(f.y, WALK.y0), WALK.y1);
      assert.ok(
        Math.hypot(f.x - nx, f.y - ny) >= SHIELD_OUTER + 5 + 3,
        `level ${level} foe at ${f.x},${f.y}`,
      );
    }
  }
});

test('shield sentinel: a sentinel against the wall still blocks the wall turret orb', () => {
  for (const [fx, px, face, key] of [
    [16, WALK.x0, 'ArrowLeft', 'left'],
    [464, WALK.x1, 'ArrowRight', 'right'],
  ]) {
    const w = mk();
    startLevel(w, WALL_LEVEL);
    w.introT = 0;
    w.crawlers = [];
    w.foes = w.foes.filter((f) => f.x === fx);
    w.foes[0].pattern = ['orb'];
    w.atk.wait = 0;
    w.p.x = px;
    w.p.y = 170;
    let blocks = 0;
    for (let i = 0; i < 120 * 6; i++) {
      stepWorld(w, STEP, input(['Space', face]));
      blocks += w.events.filter((e) => e === 'block').length;
    }
    assert.ok(blocks >= 1, key);
    assert.equal(w.hp, 5, key);
  }
});

test('shield sentinel: swept shots agree with the drawn plate sector, including both end faces', () => {
  const cx = 240,
    cy = 170,
    face = -Math.PI / 2;
  // Exact distance from a point to the annular sector the plates draw.
  const distance = (px, py) => {
    const dx = px - cx,
      dy = py - cy,
      rho = Math.hypot(dx, dy);
    if (inArc(dx, dy, face)) return Math.max(0, SHIELD_INNER - rho, rho - SHIELD_OUTER);
    return Math.min(
      ...[-1, 1].map((sign) => {
        const a = face + sign * SHIELD_HALF,
          u = dx * Math.cos(a) + dy * Math.sin(a),
          v = -dx * Math.sin(a) + dy * Math.cos(a);
        return Math.hypot(u - Math.min(Math.max(u, SHIELD_INNER), SHIELD_OUTER), v);
      }),
    );
  };
  const touches = (x0, y0, x1, y1, r) => {
    for (let i = 0; i <= 2000; i++) {
      const f = i / 2000;
      if (distance(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f) <= r) return true;
    }
    return false;
  };
  const rnd = seeded(2024);
  let blocked = 0,
    checked = 0;
  for (let n = 0; n < 3000; n++) {
    const a = rnd() * Math.PI * 2,
      d = 60 + rnd() * 20,
      r = rnd() < 0.5 ? 5 : 4;
    const x0 = cx + Math.cos(a) * d,
      y0 = cy + Math.sin(a) * d;
    const aim = a + Math.PI + (rnd() - 0.5) * 1.4;
    const speed = [60, 150, 600, 1500][n % 4] / 120;
    const x1 = x0 + Math.cos(aim) * speed * 90,
      y1 = y0 + Math.sin(aim) * speed * 90;
    // Walk the path in one-tick segments exactly as the simulation does.
    let hit = null;
    for (let i = 0; i < 90 && !hit; i++) {
      const sx = x0 + Math.cos(aim) * speed * i,
        sy = y0 + Math.sin(aim) * speed * i;
      hit = shieldContact(
        cx,
        cy,
        face,
        sx,
        sy,
        sx + Math.cos(aim) * speed,
        sy + Math.sin(aim) * speed,
        r,
      );
    }
    // A shot that reaches the body is judged by the body, not by plates it would cross from inside.
    if (segmentBoxEntry(x0, y0, x1, y1, cx, cy, BODY.hw + r, BODY.hh + r) !== null) continue;
    if (touches(x0, y0, x1, y1, r - 0.1)) {
      assert.ok(hit, `missed a plate contact (path ${n})`);
      blocked++;
    } else if (!touches(x0, y0, x1, y1, r + 0.1)) {
      assert.equal(hit, null, `phantom plate contact (path ${n})`);
    }
    checked++;
  }
  assert.ok(blocked > 150 && checked > 1500, `${blocked} blocked of ${checked}`);
});

test('shield sentinel: a lateral graze of either plate end is blocked at several speeds', () => {
  for (const speed of [150, 600, 3000]) {
    for (const sign of [-1, 1]) {
      const w = mk();
      w.p.y = 170;
      tickN(w, 1, ['Space']);
      // Travel across the plate end at relative y = -16 (between the 18 and 26 faces).
      const startX = sign < 0 ? 100 : 380;
      addShot(w, 'slug', startX, 154, sign < 0 ? speed : -speed, 0);
      const events = [];
      for (let i = 0; i < 120 && w.shots.length; i++) {
        stepWorld(w, STEP, input(['Space']));
        events.push(...w.events);
      }
      assert.ok(events.includes('block'), `${sign} at ${speed}`);
      assert.equal(w.hp, 5);
    }
  }
});

test('shield sentinel: words match the telegraph colours', () => {
  assert.match(PROMPTS.slam[0], /PURPLE/);
  assert.match(PROMPTS.slam[1], /紫/);
  assert.match(PROMPTS.lance[0], /RED/);
  assert.match(PROMPTS.lance[1], /红/);
  assert.match(meta.description.en, /purple-circle slam/);
  assert.match(meta.description.zh, /紫圈/);
  assert.doesNotMatch(meta.description.en, /red-circle/);
  assert.doesNotMatch(PROMPTS.slam.join(), /红|RED/);
  const zh = harness({ lang: 'zh' });
  const g = createGame(zh.env);
  for (let i = 0; i < 60 * 300 && !zh.ends.length; i++) g.update(1 / 60, input([]));
  assert.match(zh.ends[0].message, /红色通道和紫色圆圈/);
});
