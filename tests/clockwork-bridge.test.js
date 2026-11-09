import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createMachine,
  stepMachine,
  meta,
  PLAYER_SPRITES,
} from '../src/games/clockwork-bridge.js';
import { harness, input, mockContext } from './harness.js';

const DT = 1 / 120;
const BOILER = 1;
const PISTON = 5;
const MASTER = 12;
const run = (s, seconds, held = [], pressed = []) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepMachine(s, DT, input(held, i === 0 ? pressed : []));
};
const place = (s, x, y, extra = {}) => {
  Object.assign(s.player, { x, y, vx: 0, vy: 0, ...extra });
};
const onBridge = (s, id, offset = 20) => {
  const b = s.bridges[id];
  place(s, b.x + offset, b.y - s.player.h, { grounded: true, ground: id });
};
const startAt = (level, opts) => {
  const h = harness(opts);
  h.env.progress = { unlocked: () => level, unlock() {} };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
};
const overlap = (a, b) =>
  a.x < b.x + b.w - 1e-6 &&
  a.x + a.w > b.x + 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  a.y + a.h > b.y + 1e-6;

test('meta is bilingual and touch controls cover every action', () => {
  assert.equal(meta.id, 'clockwork-bridge');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  for (const o of [meta.name, meta.description, ...meta.keys.map((k) => k.label)]) {
    assert.ok(o.en.length > 2 && o.zh.length > 1);
  }
  const codes = meta.touchControls.map((c) => c.code);
  for (const c of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX', 'KeyZ'])
    assert.ok(codes.includes(c));
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh && c.side);
  for (const rows of Object.values(PLAYER_SPRITES)) {
    assert.equal(rows.length, 10);
    for (const r of rows) assert.equal(r.length, 7);
  }
});

test('invalid, zero, negative, NaN and huge dt do not advance or consume input', () => {
  const s = createMachine(BOILER);
  place(s, 140, 230);
  const before = JSON.stringify(s);
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 10, undefined, '0.01']) {
    assert.equal(stepMachine(s, dt, input(['ArrowRight'], ['KeyX', 'Space', 'KeyZ'])), false);
    assert.equal(JSON.stringify(s), before);
  }
  stepMachine(s, DT, input([], []));
  assert.equal(s.stats.cranks, 0);
  stepMachine(s, DT, input([], ['KeyX']));
  assert.equal(s.stats.cranks, 1);
});

test('a press during a sub-step dt is latched instead of lost', () => {
  const s = createMachine(BOILER);
  place(s, 140, 230);
  stepMachine(s, 1 / 1000, input([], ['KeyX']));
  assert.equal(s.stats.cranks, 0);
  run(s, 0.02);
  assert.equal(s.stats.cranks, 1);
});

test('scripted runs agree at 30, 60 and 120 Hz', () => {
  const finals = [30, 60, 120].map((hz) => {
    const s = createMachine(BOILER);
    const frames = hz * 4;
    for (let i = 0; i < frames; i++) {
      const t = i / hz;
      const pressed = i === 0 ? ['KeyZ'] : Math.abs(t - 2.5) < 1e-9 ? ['Space'] : [];
      stepMachine(s, 1 / hz, input(t < 2.5 ? ['ArrowRight'] : ['ArrowRight'], pressed));
    }
    return s;
  });
  for (const f of finals.slice(1)) {
    assert.ok(Math.abs(f.player.x - finals[0].player.x) < 1e-6);
    assert.ok(Math.abs(f.player.y - finals[0].player.y) < 1e-6);
    assert.equal(f.lives, finals[0].lives);
  }
});

test('gears only respond when the player is near, nearest wins, and toggling flips bridge targets', () => {
  const s = createMachine(BOILER);
  place(s, 20, 230);
  run(s, 0.05, [], ['KeyX']);
  assert.equal(s.stats.cranks, 0);
  assert.equal(s.stats.rejected, 1);
  assert.ok(s.message.en.includes('No gear'));
  assert.equal(s.bridges[0].target, 0);
  place(s, 120, 230);
  run(s, 0.05, [], ['KeyX']);
  assert.equal(s.gears[0].state, 1);
  assert.equal(s.bridges[0].target, 1);
  run(s, 0.05, [], ['KeyX']);
  assert.equal(s.bridges[0].target, 0);
  const m2 = createMachine(PISTON);
  place(m2, 244, 156);
  run(m2, 0.02, [], ['KeyX']);
  assert.equal(m2.gears[2].state, 1);
  assert.equal(m2.gears[1].state, 0);
  assert.equal(m2.bridges[1].target, 1);
  assert.equal(m2.bridges[0].target, 1);
});

test('bridges move at a finite speed and the linked group stops exactly at the end', () => {
  const s = createMachine(BOILER);
  place(s, 120, 230);
  run(s, 0.02, [], ['KeyX']);
  const b = s.bridges[0];
  run(s, 1);
  assert.ok(b.p > 0.3 && b.p < 0.5);
  assert.ok(Math.abs(b.vx - 116 * 0.4) < 1e-6);
  run(s, 2);
  assert.equal(b.p, 1);
  assert.equal(b.x, 266);
  assert.equal(b.vx, 0);
});

test('a passenger is carried without drift and without leaving the deck', () => {
  const s = createMachine(BOILER);
  onBridge(s, 0, 6);
  place(s, 160, 230, { grounded: true, ground: 0 });
  const offset = s.player.x - s.bridges[0].x;
  run(s, 0.02, [], ['KeyX']);
  for (let i = 0; i < 360; i++) {
    stepMachine(s, DT, input());
    assert.equal(s.player.ground, 0);
    assert.ok(Math.abs(s.player.x - s.bridges[0].x - offset) < 1e-6);
    assert.equal(s.player.y, 230);
  }
  assert.equal(s.lives, 5);
});

test('launch inherits platform velocity exactly once', () => {
  const a = createMachine(BOILER);
  onBridge(a, 0, 10);
  run(a, 0.02, [], ['KeyX']);
  run(a, 0.5);
  const v = a.bridges[0].vx;
  assert.ok(v > 40);
  stepMachine(a, DT, input([], ['Space']));
  assert.ok(Math.abs(a.player.vx - v) < 1e-9);
  assert.equal(a.player.grounded, false);
  const b = structuredClone(a);
  b.bridges[0].target = 0;
  b.gears[0].state = 0;
  run(a, 0.1);
  run(b, 0.1);
  assert.ok(Math.abs(a.player.vx - b.player.vx) < 1e-9);
  assert.ok(Math.abs(a.player.vx - v) < 1e-9);
});

test('walking off a moving deck inherits its velocity once, and rising lifts add jump speed', () => {
  const s = createMachine(BOILER);
  onBridge(s, 0, 20);
  run(s, 0.02, [], ['KeyX']);
  run(s, 0.3);
  s.player.x = s.bridges[0].x + s.bridges[0].w - 6;
  const v = s.bridges[0].vx;
  run(s, 0.2, ['ArrowRight']);
  assert.ok(s.player.vx > 0);
  assert.ok(s.player.vx <= v + 80 + 1e-6);
  const l = createMachine(PISTON);
  onBridge(l, 0, 20);
  run(l, 0.02, [], ['KeyX']);
  run(l, 0.3);
  const vy = l.bridges[0].vy;
  assert.ok(vy < 0);
  stepMachine(l, DT, input([], ['Space']));
  assert.ok(Math.abs(l.player.vy - (-260 + vy + 720 * DT)) < 1e-6);
});

test('crush rule: a descending press jams on the player instead of pushing or crushing', () => {
  const s = createMachine(MASTER);
  const press = s.bridges[2];
  place(s, 280, 240, { grounded: true, ground: -1 });
  s.bridges[2].target = 1;
  s.bridges[1].target = 1;
  const before = { ...s.player };
  let jamSeen = false;
  for (let i = 0; i < 600; i++) {
    stepMachine(s, DT, input());
    assert.ok(!overlap(s.player, press));
    jamSeen ||= Boolean(press.jam);
  }
  assert.ok(jamSeen);
  assert.equal(press.jam, 'player');
  assert.equal(s.player.x, before.x);
  assert.equal(s.player.y, before.y);
  assert.equal(s.lives, 5);
  assert.ok(s.stats.jams >= 1);
  const liftP = s.bridges[1].p;
  assert.ok(liftP < 1, 'linked lift stalls with the group');
  run(s, 0.5);
  assert.equal(s.bridges[1].p, liftP);
  assert.equal(s.stats.jams, 1, 'one jam event, not one per step');
  place(s, 250, 240, { grounded: true, ground: -1 });
  run(s, 0.1);
  assert.equal(press.jam, '');
  assert.ok(press.p > 0);
  run(s, 3);
  assert.equal(press.p, 1);
  assert.equal(s.bridges[1].p, 1);
});

test('crush rule: a pinned key and a blocked rider also jam the mechanism', () => {
  const s = createMachine(MASTER);
  s.keys[0].x = 285;
  s.keys[0].y = 248;
  s.keys[0].on = -1;
  s.bridges[2].target = 1;
  s.bridges[1].target = 1;
  place(s, 20, 240);
  run(s, 3);
  assert.equal(s.bridges[2].jam, 'key');
  assert.equal(s.keys[0].y, 248);
  const r = createMachine(PISTON);
  onBridge(r, 0, 20);
  r.solids.push({ x: 110, y: 200, w: 60, h: 20, style: 'stone' });
  r.bridges[0].target = 1;
  r.gears[0].state = 1;
  const y0 = r.player.y;
  run(r, 2);
  assert.equal(r.bridges[0].jam, 'player');
  assert.ok(r.player.y <= y0 + 1e-9 && r.player.y > y0 - 90);
  assert.ok(!r.solids.some((o) => overlap(r.player, o)));
  const w = createMachine(BOILER);
  w.solids.push({ x: 200, y: 230, w: 20, h: 30, style: 'stone' });
  w.bridges[0].target = 1;
  run(w, 3);
  assert.equal(w.bridges[0].jam, 'solid');
});

test('key actions: take, reject far take, drop only on ground, ride a deck, unlock near door only', () => {
  const s = createMachine(BOILER);
  place(s, 100, 230);
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(s.keys[0].state, 'floor');
  assert.equal(s.stats.rejected, 1);
  place(s, 48, 230);
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(s.keys[0].state, 'carried');
  assert.equal(s.stats.picks, 1);
  s.player.grounded = false;
  run(s, 0.01, [], ['KeyZ']);
  assert.equal(s.keys[0].state, 'carried');
  assert.ok(s.message.en.includes('solid ground'));
  s.player.grounded = true;
  onBridge(s, 0, 20);
  run(s, 0.02, [], ['KeyZ']);
  const k = s.keys[0];
  assert.equal(k.state, 'floor');
  assert.equal(k.on, 0);
  const rel = k.x - s.bridges[0].x;
  s.bridges[0].target = 1;
  run(s, 1.5);
  assert.ok(Math.abs(k.x - s.bridges[0].x - rel) < 1e-6);
  assert.equal(k.y, s.bridges[0].y - 12);
  place(s, k.x - 1, k.y - 6, { grounded: true, ground: 0 });
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(k.state, 'carried');
  place(s, 350, 230, { grounded: true, ground: -1 });
  s.player.y = 230;
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(k.state, 'floor', 'far from the door the key is dropped, not used');
  assert.ok(s.door.locked);
  k.state = 'carried';
  place(s, 420, 230, { grounded: true, ground: -1 });
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(s.door.locked, false);
  assert.equal(k.state, 'used');
  assert.equal(s.score, 0, 'unlock score is banked only when the machine is cleared');
  run(s, 0.02, [], ['KeyZ']);
  assert.equal(s.stats.unlocks, 1);
});

test('a locked door does not end the machine; an unlocked one does', () => {
  const s = createMachine(BOILER);
  place(s, 438, 230, { grounded: true, ground: -1 });
  run(s, 0.1);
  assert.equal(s.level, BOILER + 1);
  s.door.locked = false;
  run(s, 0.1);
  assert.equal(s.level, BOILER + 2);
  assert.equal(s.cleared, 1);
  assert.equal(s.score, 1200);
  assert.ok(s.message.en === 'Machine escaped');
});

test('jump buffering, coyote grace once per support exit, no double jump', () => {
  const s = createMachine(BOILER);
  run(s, 0.05);
  stepMachine(s, DT, input([], ['Space']));
  assert.equal(s.stats.jumps, 1);
  run(s, 0.05, ['Space']);
  assert.equal(s.stats.jumps, 1, 'held Space does not repeat');
  stepMachine(s, DT, input([], ['Space']));
  assert.equal(s.stats.jumps, 1, 'no air jump');
  assert.ok(s.player.jumpBuffer > 0);
  place(s, 100, 100, { grounded: false, ground: null, vy: 400 });
  s.player.jumpBuffer = 0;
  s.player.x = 100;
  s.player.y = 250 - 20 - 20;
  s.player.vy = 200;
  const before = s.stats.jumps;
  run(s, 0.1, [], ['Space']);
  assert.equal(s.stats.jumps, before + 1, 'buffered press fires on touchdown');
  const e = createMachine(BOILER);
  place(e, 200, 230);
  run(e, 0.5, ['ArrowRight']);
  assert.equal(e.stats.edgeExits, 1);
  const c = createMachine(BOILER);
  c.bridges[0].x = 400;
  place(c, 140, 230);
  run(c, 0.02, ['ArrowRight']);
  while (c.player.grounded) run(c, DT, ['ArrowRight']);
  stepMachine(c, DT, input(['ArrowRight'], ['Space']));
  assert.equal(c.stats.jumps, 1, 'coyote jump allowed once');
  stepMachine(c, DT, input(['ArrowRight'], ['Space']));
  assert.equal(c.stats.jumps, 1);
});

test('swept collisions: extreme speed cannot tunnel through a deck, wall or underside', () => {
  const s = createMachine(BOILER);
  place(s, 180, 100, { grounded: false, ground: null, vy: 1e5 });
  run(s, 1);
  assert.equal(s.player.ground, 0);
  assert.equal(s.player.y, 250 - 20);
  const u = createMachine(BOILER);
  place(u, 180, 300, { grounded: false, ground: null, vy: -1e5 });
  u.bridges[0].x = 160;
  run(u, 0.02);
  assert.ok(u.player.y >= 260 - 1e-6 || u.player.y > 330);
  const w = createMachine(BOILER);
  place(w, 440, 100, { vx: 1e5, grounded: false, ground: null });
  stepMachine(w, DT, input(['ArrowRight']));
  assert.ok(w.player.x <= 470 + 1e-6);
  place(w, 40, 100, { vx: -1e5, grounded: false, ground: null });
  stepMachine(w, DT, input(['ArrowLeft']));
  assert.ok(w.player.x >= -1e-6);
  const ceil = createMachine(BOILER);
  place(ceil, 100, 100, { vy: -1e5, grounded: false, ground: null });
  run(ceil, 0.05);
  assert.ok(ceil.player.y >= -1e-6);
});

test('recovery: a stranded player can recall the bridge; a mid-travel crank reverses it', () => {
  const s = createMachine(BOILER, [1, 0]);
  assert.equal(s.bridges[0].p, 1);
  place(s, 120, 230);
  run(s, 0.02, [], ['KeyX']);
  run(s, 3);
  assert.equal(s.bridges[0].p, 0);
  run(s, 0.02, [], ['KeyX']);
  run(s, 1);
  const mid = s.bridges[0].p;
  assert.ok(mid > 0.2 && mid < 0.8);
  run(s, 0.02, [], ['KeyX']);
  run(s, 0.5);
  assert.ok(s.bridges[0].p < mid);
});

test('falling costs a life and rewinds the machine; five falls lose once and freeze', () => {
  const { g, h } = startAt(BOILER + 1);
  const stepAll = (held = [], pressed = []) => g.update(DT, input(held, pressed));
  for (let i = 0; i < 20; i++) stepAll(['ArrowRight']);
  stepAll([], ['KeyZ']);
  let guard = 0;
  while (g.getState().lives === 5 && guard++ < 4000) stepAll(['ArrowRight']);
  let st = g.getState();
  assert.equal(st.lives, 4);
  assert.ok(Math.abs(st.player.x - 24) < 2);
  assert.equal(st.keys[0].state, 'floor', 'rewind returns the key');
  assert.ok(h.sounds.includes('hit'));
  guard = 0;
  while (g.getState().phase === 'playing' && guard++ < 40000) stepAll(['ArrowRight']);
  st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(st.lives, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.ends[0].message.length > 5);
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 100; i++) stepAll(['ArrowLeft'], ['Space', 'KeyX', 'KeyZ']);
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.lives, 5);
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.score, 0);
  assert.equal(fresh.player.x, 20);
});

test('zh and en status/messages and draw smoke across every machine and state', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    const ctx = mockContext();
    g.draw(ctx);
    const st = g.getState();
    assert.ok(st.status[lang].length > 10);
    assert.equal(st.nearGear, null);
    assert.ok(st.jumpEnvelope.height > 40);
  }
  for (const level of [0, BOILER, PISTON, MASTER]) {
    for (const lang of ['en', 'zh']) {
      const s = createMachine(level);
      const env = harness({ lang }).env;
      const g = createGame(env);
      const ctx = mockContext();
      // exercise the renderer on a game positioned near gear, key and door
      for (let i = 0; i < 3; i++) g.draw(ctx);
    }
  }
});

test('presentation: actor collider equals the large sprite and canvas text is localized', () => {
  const g = createGame(harness({ lang: 'zh' }).env);
  const st = g.getState();
  const rows = PLAYER_SPRITES.standR;
  assert.equal(st.player.w, rows[0].length * 2);
  assert.equal(st.player.h, rows.length * 2);
  assert.ok(st.player.h >= 20);
  const drawn = [];
  const ctx = mockContext();
  ctx.fillText = (t) => drawn.push(t);
  for (const lang of ['zh', 'en']) {
    drawn.length = 0;
    startAt(BOILER + 1, { lang }).g.draw(ctx);
    assert.ok(drawn.includes(lang === 'zh' ? '出口' : 'EXIT'));
    assert.ok(!drawn.includes(lang === 'zh' ? 'EXIT' : '出口'));
    assert.ok(drawn.includes('A'), 'bridge and gear letters mark the drive linkage');
  }
});

test('regression F1: standing needs the body centre over a support and keys always rest on one', () => {
  const s = createMachine(BOILER, [1, 0]);
  place(s, 136, 230);
  for (let i = 0; i < 120 && s.player.x < 146; i++) stepMachine(s, 1 / 60, input(['ArrowRight']));
  for (let i = 0; i < 60; i++) stepMachine(s, 1 / 60, input());
  assert.ok(
    s.player.x + s.player.w / 2 <= 150 + 1e-6 || s.player.y > 230,
    'no hovering over the pit',
  );
  const t = createMachine(BOILER, [1, 0]);
  place(t, 140, 230);
  t.keys[0].state = 'carried';
  run(t, 0.02, [], ['KeyZ']);
  const k = t.keys[0];
  assert.equal(k.state, 'floor');
  assert.ok(k.x >= 0 && k.x + k.w <= 150, 'key clamped onto the support span');
  place(t, 149, 230);
  t.player.grounded = true;
  k.state = 'carried';
  run(t, 0.01, [], ['KeyZ']);
  assert.ok(k.x + k.w <= 150 + 1e-9);
  const air = createMachine(BOILER, [1, 0]);
  place(air, 220, 100);
  air.player.grounded = false;
  air.keys[0].state = 'carried';
  run(air, 0.01, [], ['KeyZ']);
  assert.equal(air.keys[0].state, 'carried');
  const tight = createMachine(BOILER);
  tight.solids.push({ x: 90, y: 238, w: 14, h: 12, style: 'crate' });
  place(tight, 84, 230);
  tight.keys[0].state = 'carried';
  run(tight, 0.01, [], ['KeyZ']);
  assert.equal(tight.keys[0].state, 'carried', 'drop rejected when the spot is blocked');
});

test('regression F2: landing on a rising lift is not a jam, for any gap above the deck', () => {
  for (let gap = 0.01; gap < 2; gap += 0.07) {
    const s = createMachine(PISTON);
    s.gears[0].state = 1;
    s.bridges[0].target = 1;
    const deck = s.bridges[0];
    place(s, 120, deck.y - 20 - gap, { vy: 260 });
    s.player.grounded = false;
    s.player.ground = null;
    stepMachine(s, 1 / 240, input());
    assert.equal(s.stats.jams, 0, `gap ${gap}`);
    assert.equal(deck.jam, '');
    assert.ok(!overlap(s.player, deck));
    run(s, 0.1);
    assert.equal(s.player.ground, 0);
    assert.equal(s.player.grounded, true);
  }
});

test('regression F3: unlock score cannot be farmed by falling and re-unlocking', () => {
  const s = createMachine(BOILER);
  for (let cycle = 0; cycle < 3; cycle++) {
    s.keys[0].state = 'carried';
    place(s, 420, 230, { grounded: true, ground: -1 });
    run(s, 0.02, [], ['KeyZ']);
    assert.equal(s.door.locked, false);
    place(s, 200, 400, { grounded: false, ground: null });
    run(s, 0.05);
    assert.equal(s.lives, 4 - cycle);
    assert.equal(s.door.locked, true, 'rewind relocks the door');
    assert.equal(s.score, 0);
  }
  s.keys[0].state = 'carried';
  place(s, 420, 230, { grounded: true, ground: -1 });
  run(s, 0.02, [], ['KeyZ']);
  place(s, 438, 230, { grounded: true, ground: -1 });
  run(s, 0.1);
  assert.equal(s.score, 1200);
});

test('regression F4: no hint plate is drawn over the playfield', () => {
  const rects = [];
  const ctx = mockContext();
  ctx.fillRect = (x, y, w, h) => rects.push([x, y, w, h]);
  createGame(harness().env).draw(ctx);
  assert.ok(!rects.some(([x, y, w, h]) => x === 40 && y === 88 && w === 400 && h === 20));
});
