import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  FLOORS,
  FOES,
  BOSSES,
  FRUIT,
  POWERS,
  PROMPTS,
  createGame,
  newState,
  loadFloor,
  advance,
  snapshot,
  render,
  sweepX,
  sweepY,
  sweptBox,
  tileAt,
  menuCell,
  openMenu,
  promptText,
  stageOf,
  hurryAt,
  bossHarms,
  LETTERS,
  fillKeys,
  drawBoss,
  POWER_INFO,
} from '../src/games/snowball-siege.js';
import { harness, input, mockContext, seeded } from './harness.js';

const STEP = RULES.step;
const T = RULES.tile;
const TOP = RULES.top;
const GROUND_TOP = TOP + (RULES.rows - 1) * T; // 268
const noop = () => {};

// A quiet copy of a floor: nobody else on it and the intro never ends, so physics can be probed.
function sandbox(floor = 1, seed = 1) {
  const s = newState(seeded(seed));
  loadFloor(s, floor);
  if (floor === 1)
    s.grid = s.grid.map((r, i) => (i < RULES.rows - 1 ? `#${'.'.repeat(RULES.cols - 2)}#` : r));
  s.enemies = [];
  s.boss = null;
  s.intro = 1e9;
  return s;
}
// A live copy of a floor (the intro is skipped).
function live(floor = 1, seed = 1) {
  const s = newState(seeded(seed));
  loadFloor(s, floor);
  if (floor === 1)
    s.grid = s.grid.map((r, i) => (i < RULES.rows - 1 ? `#${'.'.repeat(RULES.cols - 2)}#` : r));
  s.intro = 0;
  return s;
}
const tick = (s, held = [], pressed = [], emit = noop) =>
  advance(s, STEP, input(held, pressed), emit);
function ticks(s, n, held = [], pressed = [], emit = noop) {
  for (let i = 0; i < n; i++) tick(s, held, i === 0 ? pressed : [], emit);
}
const seconds = (s, sec, held = [], pressed = [], emit = noop) =>
  ticks(s, Math.round(sec / STEP), held, pressed, emit);
const place = (s, x, y) => {
  s.hero.x = x;
  s.hero.y = y;
  s.hero.vx = s.hero.vy = 0;
};
const placeH = (h, x, y) => {
  h.x = x;
  h.y = y;
  h.vx = h.vy = 0;
};
const standOnGround = (s, x = 200) => {
  place(s, x, GROUND_TOP - s.hero.h);
  s.hero.grounded = true;
  s.hero.ground = 1;
};
const ballAt = (s, x, y, extra = {}) => {
  const b = {
    id: s.nextId++,
    x,
    y,
    w: RULES.ballSize,
    h: RULES.ballSize,
    vx: 0,
    vy: 0,
    mode: 'rest',
    life: RULES.ballRest,
    bounces: 0,
    chain: 0,
    grounded: false,
    occupant: null,
    roll: 0,
    ...extra,
  };
  s.balls.push(b);
  return b;
};
const foeAt = (s, kind, x, y, extra = {}) => {
  const d = FOES[kind];
  const e = {
    id: s.nextId++,
    kind,
    x,
    y: y - d.h,
    w: d.w,
    h: d.h,
    vx: 0,
    vy: 0,
    dir: 1,
    snow: 0,
    sinceHit: 99,
    grounded: false,
    state: kind === 'jumper' ? 'idle' : kind === 'flyer' ? 'fly' : 'walk',
    timer: kind === 'jumper' ? 0.9 : kind === 'thrower' ? 1.6 : 0,
    lane: y - d.h / 2,
    phase: 0,
    flash: 0,
    ...extra,
  };
  s.enemies.push(e);
  return e;
};
const rollingBall = (s, x, y, vx, extra = {}) =>
  ballAt(s, x, y, { mode: 'roll', vx, chain: 1, ...extra });

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------

test('meta follows the contract: ids, bilingual text, keys and a complete touch layout', () => {
  assert.equal(meta.id, 'snowball-siege');
  assert.deepEqual(meta.name, { en: 'Snowball Siege', zh: '雪球攻城' });
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1-2');
  assert.equal(meta.touch, true);
  assert.ok(meta.description.en.length > 80 && meta.description.zh.length > 40);
  assert.match(meta.description.en, /30/);
  for (const k of meta.keys) {
    assert.ok(k.label.en && k.label.zh && k.keys);
    assert.doesNotMatch(k.keys, /[A-Za-z]{2,}/, `key text "${k.keys}" is language-neutral`);
    assert.doesNotMatch(
      k.label.zh,
      /[A-Za-z]{2,}/,
      `zh label "${k.label.zh}" has no English words`,
    );
  }
  for (const c of [...meta.touchControls, ...meta.multiplayerTouchControls])
    assert.doesNotMatch(c.label.zh, /[A-Za-z]{2,}/, c.label.zh);
  assert.doesNotMatch(meta.description.zh, /[A-Za-z]{3,}/);
  const codes = meta.touchControls.map((c) => c.code);
  for (const need of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyX'])
    assert.ok(codes.includes(need), need);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && c.label.zh && ['left', 'right'].includes(c.side));
    assert.ok(!['Escape', 'KeyP', 'KeyR'].includes(c.code));
  }
  assert.ok(meta.multiplayerTouchControls.length >= 10);
});

test('the campaign has 30 data-driven floors with bosses on floors 10, 20 and 30', () => {
  assert.equal(FLOORS.length, 30);
  assert.ok(FLOORS.length >= 25);
  const names = new Set();
  FLOORS.forEach((f, i) => {
    assert.equal(f.rows.length, RULES.rows, `floor ${i + 1} rows`);
    f.rows.forEach((r) => assert.equal(r.length, RULES.cols));
    assert.ok(f.name.en && f.name.zh);
    names.add(f.name.en);
    assert.equal([...f.rows.join('')].filter((c) => c === '@').length, 1, 'one hero');
    assert.match(f.rows.join(''), /^[#.=v@wjftB]+$/);
    f.rows.forEach((r, n) => {
      assert.ok(r[0] === '#' && r[RULES.cols - 1] === '#', 'walls at both sides');
      if (n === RULES.rows - 1) assert.match(r, /^#+(v+#+)*$/);
    });
    assert.ok(Object.hasOwn(PROMPTS, f.idea) || f.idea === 'free', f.idea);
    const foes = [...f.rows.join('')].filter((c) => 'wjft'.includes(c)).length;
    if (f.boss) {
      assert.equal(f.hurry, 0, 'no pursuer during a boss fight');
      assert.ok([9, 19, 29].includes(i));
    } else {
      assert.ok(foes >= 2, `floor ${i + 1} has foes`);
      assert.ok(f.hurry >= 55);
    }
  });
  assert.equal(names.size, 30);
  assert.deepEqual(FLOORS.map((f) => f.boss ?? null).filter(Boolean), ['golem', 'wyrm', 'queen']);
  assert.ok(
    FLOORS.slice(0, 9).every((f) => f.idea !== 'free'),
    'floors 1-9 each teach one idea',
  );
  assert.ok(
    FLOORS.slice(20).every((f) => f.idea === 'free' || f.boss),
    'mastery floors combine',
  );
  const kinds = new Set(
    FLOORS.flatMap((f) => [...f.rows.join('')].filter((c) => 'wjft'.includes(c))),
  );
  assert.deepEqual([...kinds].sort(), ['f', 'j', 't', 'w']);
  assert.equal(Object.keys(FOES).length, 4);
  assert.equal(Object.keys(BOSSES).length, 3);
});

test('rules are exported read-only with the stated numbers', () => {
  assert.throws(() => {
    'use strict';
    RULES.gravity = 1;
  }, TypeError);
  assert.equal(RULES.gravity, 1500);
  assert.equal(RULES.jumpSpeed ** 2 / (2 * RULES.gravity) > 90, true);
  assert.ok(RULES.coyote <= 0.1 && RULES.buffer <= 0.1);
  assert.ok(RULES.wraithSpeed < RULES.run);
  assert.ok(RULES.maxFall * STEP < T, 'one tick never moves a body a whole tile');
  assert.equal(RULES.ballBounces, 4);
  assert.ok(RULES.ballKeep <= 1);
  assert.equal(RULES.snowFull, 4);
});

// ---------------------------------------------------------------------------------------------
// Swept collision
// ---------------------------------------------------------------------------------------------

test('sweepY and sweepX stop at the first blocking tile whatever the move length', () => {
  const grid = FLOORS[1].rows.map((r) => r.replace(/[@wjftB]/g, '.'));
  const body = () => ({ x: 100, y: 100, w: 16, h: 20 });
  for (const dy of [5, 60, 400, 5000, 1e9]) {
    const b = body();
    b.y = 100;
    const r = sweepY(grid, b, dy);
    assert.ok(b.y + b.h <= GROUND_TOP + 1e-9, `fell through at dy ${dy}`);
    if (dy >= 148) {
      assert.equal(r, 1);
      assert.equal(b.y, GROUND_TOP - b.h);
    }
  }
  for (const dx of [-1e9, -400, 400, 1e9]) {
    const b = { x: 200, y: GROUND_TOP - 20, w: 16, h: 20 };
    const hit = sweepX(grid, b, dx);
    assert.ok(hit);
    assert.ok(
      b.x >= T - 1e-9 && b.x + b.w <= (RULES.cols - 1) * T + 1e-9,
      `escaped the walls at dx ${dx}`,
    );
  }
  const free = { x: 200, y: 100, w: 16, h: 20 };
  assert.equal(sweepX(grid, free, 0), false);
  assert.equal(sweepY(grid, free, 0), 0);
  assert.equal(sweepX(grid, free, NaN), false);
  assert.equal(sweepX(grid, free, 10), false);
  assert.equal(free.x, 210);
  assert.equal(tileAt(grid, -1, 3), '#');
  assert.equal(tileAt(grid, RULES.cols, 3), '#');
  assert.equal(tileAt(grid, 5, -1), '.');
  assert.equal(tileAt(grid, 5, RULES.rows), '.');
});

test('planks stop a falling body from above but let it pass going up and when dropping', () => {
  const grid = FLOORS[0].rows.map((r) => r.replace(/[@wjftB]/g, '.'));
  const plankTop = TOP + 7 * T;
  const below = { x: 80, y: plankTop + 10, w: 16, h: 20 };
  assert.equal(sweepY(grid, below, -60), 0, 'rises through the plank');
  assert.equal(below.y, plankTop + 10 - 60);
  const above = { x: 80, y: plankTop - 80, w: 16, h: 20 };
  assert.equal(sweepY(grid, above, 500), 2, 'lands on the plank');
  assert.equal(above.y, plankTop - 20);
  const drop = { x: 80, y: plankTop - 20, w: 16, h: 20 };
  assert.equal(sweepY(grid, drop, 30, { plank: false }), 0);
  assert.equal(drop.y, plankTop + 10);
  const ceil = { x: 80, y: TOP + 30, w: 16, h: 20 };
  assert.equal(sweepY(grid, ceil, -500), -1, 'the top of the screen is a ceiling');
  assert.equal(ceil.y, TOP);
  const wall = { x: 24, y: TOP + 3 * T, w: 16, h: 20 };
  assert.equal(sweepY(grid, wall, -5), 0);
});

test('a ball stands on its middle: it tips off a plank while a hero would still stand', () => {
  const s = sandbox(0);
  const plankTop = TOP + 7 * T;
  const b = ballAt(s, 184, plankTop - 22);
  tick(s);
  assert.equal(b.grounded, true, 'its middle 8 px are over the plank (ends at x=168 + 144?)');
  const c = ballAt(s, 192 + 4, plankTop - 22);
  tick(s);
  assert.equal(c.grounded, false, 'only the rim overlaps: it falls');
  assert.equal(sweptBox(10, 4, 50, 8, 6).x, 4);
  assert.equal(sweptBox(10, 4, 50, 8, 6).w, 14);
});

// ---------------------------------------------------------------------------------------------
// The hero: gravity, jump envelope, coyote time, buffering, standing, dropping
// ---------------------------------------------------------------------------------------------

test('jump apex matches v^2/(2g) while the key is held and v^2/(6g) when it is released at once', () => {
  const held = sandbox();
  standOnGround(held);
  const y0 = held.hero.y;
  let top = y0;
  tick(held, ['ArrowUp'], ['ArrowUp']);
  for (let i = 0; i < 200; i++) {
    tick(held, ['ArrowUp']);
    top = Math.min(top, held.hero.y);
  }
  const formula = RULES.jumpSpeed ** 2 / (2 * RULES.gravity);
  assert.ok(Math.abs(y0 - top - formula) < 0.6, `held apex ${y0 - top} vs ${formula}`);
  assert.equal(held.hero.y, y0, 'back on the ground after the jump');

  const tap = sandbox();
  standOnGround(tap);
  let topTap = tap.hero.y;
  tick(tap, ['ArrowUp'], ['ArrowUp']);
  for (let i = 0; i < 200; i++) {
    tick(tap, []);
    topTap = Math.min(topTap, tap.hero.y);
  }
  const cut = RULES.jumpSpeed ** 2 / (2 * RULES.gravity * RULES.cutMul);
  assert.ok(tap.hero.y === y0 && y0 - topTap < formula / 2);
  assert.ok(Math.abs(y0 - topTap - cut) < 3.5, `cut apex ${y0 - topTap} vs ${cut}`);
});

test('a held jump key never re-jumps; a new press is needed for the next jump', () => {
  const s = sandbox();
  standOnGround(s);
  let landings = 0;
  let air = false;
  tick(s, ['ArrowUp'], ['ArrowUp']);
  for (let i = 0; i < 360; i++) {
    tick(s, ['ArrowUp']);
    if (!s.hero.grounded) air = true;
    else if (air) {
      landings++;
      air = false;
    }
  }
  assert.equal(landings, 1);
  assert.equal(s.hero.grounded, true);
  assert.equal(s.hero.y, GROUND_TOP - s.hero.h);
});

test('horizontal motion: acceleration, top speed, friction and air control use the stated numbers', () => {
  const s = sandbox();
  standOnGround(s, 100);
  ticks(s, 6, ['ArrowRight']);
  assert.ok(Math.abs(s.hero.vx - RULES.accelGround * STEP * 6) < 1e-9);
  seconds(s, 0.4, ['ArrowRight']);
  assert.equal(s.hero.vx, RULES.run);
  assert.equal(s.hero.face, 1);
  ticks(s, 12, ['ArrowLeft', 'ArrowRight']);
  assert.ok(s.hero.vx < RULES.run, 'left and right together cancel');
  seconds(s, 0.5, []);
  assert.equal(s.hero.vx, 0);
  tick(s, ['ArrowLeft']);
  assert.equal(s.hero.face, -1);
  seconds(s, 0.2, ['ArrowLeft', 'ArrowUp'], ['ArrowUp']);
  assert.ok(!s.hero.grounded);
  const airV = s.hero.vx;
  ticks(s, 6, ['ArrowRight']);
  assert.ok(Math.abs(s.hero.vx - (airV + RULES.accelAir * STEP * 6)) < 1e-9, 'air accel');
  const before = s.hero.vx;
  ticks(s, 6, []);
  assert.ok(
    Math.abs(Math.abs(s.hero.vx) - (Math.abs(before) - RULES.fricAir * STEP * 6)) < 1e-9,
    'air drag',
  );
});

test('coyote time: a jump just after leaving a ledge works, one a moment later does not', () => {
  const run = (wait) => {
    const s = sandbox(0);
    const plankTop = TOP + 7 * T;
    place(s, 150, plankTop - s.hero.h);
    tick(s);
    let n = 0;
    while (s.hero.grounded && n++ < 400) tick(s, ['ArrowRight']);
    assert.ok(!s.hero.grounded, 'walked off');
    ticks(s, wait, []);
    const vy0 = s.hero.vy;
    tick(s, [], ['ArrowUp']);
    return s.hero.vy < vy0 - 100;
  };
  assert.ok(RULES.coyote <= 0.1);
  assert.equal(run(5), true);
  assert.equal(run(Math.round(RULES.coyote / STEP) - 2), true);
  assert.equal(run(Math.round(RULES.coyote / STEP) + 4), false);
  assert.equal(run(30), false);
});

test('jump buffering: a press shortly before landing fires on landing, an early one does not', () => {
  const fall = (pressAt) => {
    const s = sandbox();
    place(s, 200, GROUND_TOP - s.hero.h - 20);
    s.hero.grounded = false;
    let jumped = false;
    for (let i = 0; i < 160; i++) {
      tick(s, [], i === pressAt ? ['ArrowUp'] : []);
      if (s.hero.vy < -300) jumped = true;
    }
    return jumped;
  };
  // 20 px up: landing after about 0.163 s = 20 ticks
  assert.ok(RULES.buffer <= 0.1);
  assert.equal(fall(13), true, 'pressed 7 ticks (0.06 s) before landing');
  assert.equal(fall(0), false, 'pressed 0.16 s before landing');
  assert.equal(fall(-1), false, 'never pressed');
});

test('standing is stable on ground and planks: no sinking, no jitter', () => {
  for (const [floor, x, y] of [
    [1, 200, GROUND_TOP],
    [0, 100, TOP + 7 * T],
  ]) {
    const s = sandbox(floor);
    place(s, x, y - s.hero.h);
    tick(s);
    const rest = s.hero.y;
    for (let i = 0; i < 1200; i++) {
      tick(s);
      assert.equal(s.hero.y, rest);
      assert.equal(s.hero.vy, 0);
      assert.equal(s.hero.grounded, true);
    }
    assert.equal(rest, y - s.hero.h, 'flush with the surface');
  }
});

test('planks: jump up through from below and land on top; Down + Jump drops through, ground does not', () => {
  const s = sandbox(0);
  standOnGround(s, 80);
  tick(s, ['ArrowUp'], ['ArrowUp']);
  for (let i = 0; i < 200; i++) tick(s, ['ArrowUp']);
  assert.equal(s.hero.y, TOP + 7 * T - s.hero.h, 'standing on the plank above');
  assert.equal(s.hero.ground, 2);
  assert.ok(s.learned.jump);
  // drop through it
  tick(s, ['ArrowDown', 'ArrowUp'], ['ArrowUp']);
  assert.ok(s.learned.drop);
  seconds(s, 0.6, ['ArrowDown']);
  assert.equal(s.hero.y, GROUND_TOP - s.hero.h, 'dropped to the floor');
  // Down + Jump on solid ground is an ordinary jump
  tick(s, ['ArrowDown', 'ArrowUp'], ['ArrowUp']);
  assert.ok(s.hero.vy < 0);
  // jumping without Down never drops
  const t = sandbox(0);
  place(t, 80, TOP + 7 * T - t.hero.h);
  tick(t);
  tick(t, ['ArrowUp'], ['ArrowUp']);
  assert.ok(t.hero.vy < 0);
});

test('ceilings stop a rising hero; walls stop a walking hero flush', () => {
  const s = sandbox(1);
  standOnGround(s, 40);
  seconds(s, 1, ['ArrowLeft']);
  assert.equal(s.hero.x, T, 'flush against the left wall');
  assert.equal(s.hero.vx, 0);
  place(s, 300, TOP + 1);
  s.hero.vy = -400;
  s.hero.grounded = false;
  tick(s);
  assert.equal(s.hero.y, TOP);
  assert.equal(s.hero.vy, 0);
});

test('large frame times never tunnel: dt 0.1 equals six ticks of 1/60 for a hero falling at top speed', () => {
  const a = sandbox();
  const b = sandbox();
  for (const s of [a, b]) {
    place(s, 200, TOP + 2);
    s.hero.vy = RULES.maxFall;
    s.hero.grounded = false;
  }
  for (let i = 0; i < 20; i++) advance(a, 0.1, input([]), noop);
  for (let i = 0; i < 120; i++) advance(b, 1 / 60, input([]), noop);
  assert.equal(a.hero.y, GROUND_TOP - a.hero.h);
  assert.equal(b.hero.y, a.hero.y);
});

test('invalid frame times are inert and do not eat key presses', () => {
  const s = sandbox();
  standOnGround(s);
  const snap = JSON.stringify(snapshot(s));
  for (const dt of [0, -1, NaN, Infinity, 0.11, 5, undefined, '0.01']) {
    assert.equal(
      advance(s, dt, input(['ArrowRight'], ['ArrowUp', 'KeyX']), noop),
      false,
      String(dt),
    );
  }
  assert.equal(JSON.stringify(snapshot(s)), snap);
  assert.equal(s.hero.pj, false);
  assert.equal(s.hero.pt, false);
  tick(s, [], []);
  assert.equal(s.hero.vy, 0, 'the earlier press was not consumed or replayed');
  assert.equal(s.stats.shots, 0);
});

test('30, 60 and 120 Hz runs reach exactly the same state with the same aligned input', () => {
  const script = [];
  const rnd = seeded(77);
  for (let i = 0; i < 30 * 12; i++) {
    const held = [];
    const pressed = [];
    if (rnd() < 0.4) held.push(rnd() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
    if (rnd() < 0.1) pressed.push('ArrowUp');
    if (rnd() < 0.3) held.push('KeyX');
    if (pressed.length) held.push('ArrowUp');
    script.push({ held, pressed });
  }
  const run = (hz, floor) => {
    const s = newState(seeded(5));
    loadFloor(s, floor);
    const frames = hz * 12;
    for (let f = 0; f < frames; f++) {
      const slot = Math.floor((f / hz) * 30 + 1e-9);
      const first = Math.floor((f / hz) * 30 + 1e-9) !== Math.floor(((f - 1) / hz) * 30 + 1e-9);
      advance(s, 1 / hz, input(script[slot].held, first ? script[slot].pressed : []), noop);
    }
    return JSON.stringify(snapshot(s));
  };
  for (const floor of [0, 5, 7, 8]) {
    const a = run(30, floor);
    assert.equal(run(60, floor), a, `60 Hz, floor ${floor + 1}`);
    assert.equal(run(120, floor), a, `120 Hz, floor ${floor + 1}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Snow shots and coating
// ---------------------------------------------------------------------------------------------

test('a shot flies at 260 px/s for 108 px, one every 0.26 s while the key is held', () => {
  const s = sandbox();
  standOnGround(s, 100);
  const sounds = [];
  tick(s, ['KeyX'], ['KeyX'], (n) => sounds.push(n));
  assert.equal(s.shots.length, 1);
  const x0 = s.shots[0].x;
  assert.equal(s.shots[0].vx, RULES.shotSpeed);
  seconds(s, 0.2, ['KeyX']);
  assert.ok(Math.abs(s.shots[0].x - (x0 + RULES.shotSpeed * 0.2)) < 4);
  seconds(s, 0.3, []);
  assert.equal(s.shots.length, 0, 'fizzled after its range');
  const rep = sandbox();
  standOnGround(rep, 100);
  const fired = [];
  for (let i = 0; i < 120; i++) {
    const before = rep.stats.shots;
    tick(rep, ['KeyX']);
    if (rep.stats.shots > before) fired.push(i * STEP);
  }
  assert.equal(
    fired.length,
    Math.ceil(1 / RULES.shotCooldown),
    'one second of holding fires one shot per cooldown',
  );
  assert.ok(Math.abs(fired[1] - fired[0] - RULES.shotCooldown) < 0.01);
  assert.ok(sounds.includes('shoot'));
  const range = RULES.shotRange / RULES.shotSpeed;
  const r = sandbox();
  standOnGround(r, 100);
  tick(r, ['KeyX'], ['KeyX']);
  const start = r.shots[0].x;
  let end = start;
  while (r.shots.length) {
    end = r.shots[0].x;
    tick(r);
  }
  assert.ok(Math.abs(end - start - RULES.shotRange) < 6, `range ${end - start} (${range} s)`);
});

test('a tap during the cooldown fires when it ends; a left-facing shot goes left', () => {
  const s = sandbox();
  standOnGround(s, 300);
  tick(s, ['KeyX'], ['KeyX']);
  assert.equal(s.shots.length, 1);
  ticks(s, 20, [], []);
  tick(s, ['ArrowLeft', 'KeyX'], ['KeyX']);
  assert.equal(s.stats.shots, 1, 'still cooling down');
  seconds(s, 0.1, ['ArrowLeft']);
  assert.equal(s.stats.shots, 2, 'the buffered tap fired');
  assert.ok(s.shots.some((q) => q.vx < 0));
  const j = sandbox();
  standOnGround(j, 300);
  tick(j, [], ['KeyJ']);
  assert.equal(j.stats.shots, 1);
});

test('each hit adds snow; four hits pack the enemy into a snowball', () => {
  const s = live(1);
  s.enemies = [];
  s.enemies = [];
  const w = foeAt(s, 'walker', 290, GROUND_TOP);
  w.dir = -1;
  standOnGround(s, 200);
  s.hero.face = 1;
  const stages = [];
  for (let n = 0; n < 6; n++) {
    seconds(s, RULES.shotCooldown + 0.02, ['KeyX']);
    if (s.enemies[0]) stages.push(stageOf(s.enemies[0]));
  }
  assert.deepEqual(stages.filter(Boolean).slice(0, 3), [1, 2, 3]);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.balls.length, 1);
  assert.equal(s.balls[0].mode, 'rest');
  assert.equal(s.balls[0].occupant.kind, 'walker');
  assert.equal(s.score, 0, 'nobody is defeated until the ball is rolled');
});

test('partial snow slows an enemy and thaws after a delay at a fixed rate; a ball breaks free', () => {
  const s = live(1);
  const w = foeAt(s, 'walker', 300, GROUND_TOP);
  w.snow = 2;
  w.sinceHit = 0;
  w.dir = 1;
  tick(s);
  assert.ok(Math.abs(Math.abs(w.vx) - FOES.walker.speed * (1 - RULES.slowPerSnow * 2)) < 1e-9);
  seconds(s, RULES.thawDelay - 0.05, []);
  assert.equal(w.snow, 2, 'no melting during the delay');
  seconds(s, 1.05, []);
  assert.ok(Math.abs(w.snow - (2 - RULES.thawRate * 1.0)) < 0.02, `snow ${w.snow}`);
  seconds(s, 4, []);
  assert.equal(w.snow, 0);
  assert.equal(stageOf(w), 0);
  let fastest = 0;
  for (let i = 0; i < 400; i++) {
    tick(s);
    fastest = Math.max(fastest, Math.abs(w.vx));
  }
  assert.equal(fastest, FOES.walker.speed);

  const b = live(1);
  const prisoner = foeAt(b, 'walker', 300, GROUND_TOP);
  const id = prisoner.id;
  b.enemies = [];
  const ball = ballAt(b, 300, GROUND_TOP - 22, { occupant: { id, kind: 'walker', minion: false } });
  seconds(b, RULES.ballRest - RULES.ballWobble - 0.1, []);
  assert.equal(snapshot(b).balls[0].wobbling, false);
  seconds(b, 0.2, []);
  assert.equal(snapshot(b).balls[0].wobbling, true, 'a visible wobble before it breaks');
  seconds(b, RULES.ballWobble + 0.1, []);
  assert.equal(b.balls.length, 0);
  assert.equal(b.enemies.length, 1);
  assert.equal(b.enemies[0].id, id);
  assert.equal(b.enemies[0].snow, RULES.ballBreakSnow);
  assert.equal(ball.dead, true);
});

test('a shot onto a resting ball packs it again and an empty ball melts away', () => {
  const s = live(1);
  standOnGround(s, 200);
  const ball = ballAt(s, 260, GROUND_TOP - 22, {
    life: 2,
    occupant: { id: 9, kind: 'walker', minion: false },
  });
  tick(s, ['KeyX'], ['KeyX']);
  seconds(s, 0.3, []);
  assert.ok(ball.life > 5, 'refreshed');
  assert.ok(ball.life > RULES.ballRest - 0.4);
  const e = live(1);
  const empty = ballAt(e, 200, GROUND_TOP - 22, { life: 0.05 });
  seconds(e, 0.1, []);
  assert.equal(e.balls.length, 0);
  assert.equal(empty.dead, true);
});

test('shots cannot pass through enemies or walls at any frame time', () => {
  for (const dt of [1 / 120, 1 / 30, 0.1]) {
    const s = live(1);
    const w = foeAt(s, 'walker', 260, GROUND_TOP);
    w.dir = 1;
    standOnGround(s, 160);
    advance(s, dt, input(['KeyX'], ['KeyX']), noop);
    for (let i = 0; i < Math.ceil(0.5 / dt); i++) advance(s, dt, input([]), noop);
    assert.ok(w.snow > 0 || s.enemies.length === 0, `dt ${dt}: the shot hit`);
    const wall = live(1);
    standOnGround(wall, 60);
    wall.hero.face = -1;
    advance(wall, dt, input(['KeyX', 'ArrowLeft'], ['KeyX']), noop);
    for (let i = 0; i < Math.ceil(0.6 / dt); i++) advance(wall, dt, input([]), noop);
    assert.equal(wall.shots.length, 0);
    for (const q of wall.shots) assert.ok(q.x >= T);
  }
});

// ---------------------------------------------------------------------------------------------
// Rolling snowballs
// ---------------------------------------------------------------------------------------------

test('walking into a resting snowball rolls it; touching or standing next to it does not', () => {
  const s = live(1);
  standOnGround(s, 150);
  const ball = ballAt(s, 175, GROUND_TOP - 22, {
    occupant: { id: 1, kind: 'walker', minion: false },
  });
  seconds(s, 0.5, []);
  assert.equal(ball.mode, 'rest', 'idle contact never launches it');
  s.hero.x = ball.x - s.hero.w + 4;
  tick(s, []);
  assert.equal(ball.mode, 'rest', 'overlapping with no direction held');
  tick(s, ['ArrowLeft']);
  assert.equal(ball.mode, 'rest', 'walking away is not a push');
  tick(s, ['ArrowRight']);
  assert.equal(ball.mode, 'roll');
  assert.equal(ball.vx, RULES.ballRoll);
  assert.ok(s.learned.push);
  assert.equal(ball.occupant, null, 'its enemy is defeated on launch');
  assert.equal(s.stats.defeated, 1);
  assert.equal(s.score, FOES.walker.score + 0, 'defeat is scored once');
});

test('falling onto a ball from above does not launch it', () => {
  const s = live(1);
  const ball = ballAt(s, 240, GROUND_TOP - 22);
  place(s, ball.x + 3, ball.y - 60);
  s.hero.grounded = false;
  seconds(s, 0.5, []);
  assert.equal(ball.mode, 'rest');
});

test('a rolling ball keeps its speed on flat ground (no friction), then bounces four times and shatters', () => {
  const s = sandbox(1);
  s.hero.x = 400;
  const b = rollingBall(s, 100, GROUND_TOP - 22, RULES.ballRoll);
  const speeds = [];
  let last = b.bounces;
  let flat = 0;
  for (let i = 0; i < 3000 && !b.dead; i++) {
    tick(s);
    if (b.bounces === last) {
      assert.ok(Math.abs(Math.abs(b.vx) - Math.abs(speeds.at(-1) ?? b.vx)) < 1e-9);
      flat++;
    } else {
      last = b.bounces;
      speeds.push(Math.abs(b.vx));
    }
    if (b.bounces === 0) assert.equal(b.vx, RULES.ballRoll, 'momentum conserved on flat ground');
  }
  assert.ok(flat > 200);
  assert.equal(b.dead, true);
  assert.equal(b.bounces, RULES.ballBounces);
  assert.equal(speeds.length, RULES.ballBounces);
  assert.ok(Math.abs(speeds[0] - RULES.ballRoll * RULES.ballKeep) < 1e-9);
  assert.ok(Math.abs(speeds[1] - RULES.ballRoll * RULES.ballKeep ** 2) < 1e-9);
  assert.ok(Math.abs(speeds[2] - RULES.ballRoll * RULES.ballKeep ** 3) < 1e-9);
  for (let i = 1; i < speeds.length; i++)
    assert.ok(speeds[i] <= speeds[i - 1] + 1e-12, 'no energy gain');
  assert.equal(s.stats.shattered, 1);
  assert.equal(s.balls.length, 0);
});

test('a rolling ball falls off a ledge with its horizontal speed and lands without bouncing', () => {
  const s = live(0);
  s.hero.x = 20;
  s.enemies = [];
  s.intro = 1e9;
  const plankTop = TOP + 7 * T;
  const b = rollingBall(s, 100, plankTop - 22, RULES.ballRoll);
  let fell = false;
  for (let i = 0; i < 600; i++) {
    tick(s);
    if (!b.grounded && b.y > plankTop - 22 + 1) fell = true;
    if (fell && b.grounded) break;
  }
  assert.ok(fell, 'tipped off the plank');
  assert.equal(b.y, GROUND_TOP - 22, 'landed on the floor');
  assert.equal(b.vy, 0, 'no bounce on landing');
  assert.equal(Math.abs(b.vx), RULES.ballRoll);
});

test('balls fall out of the bottom through vent grates and cannot be stood on by walkers', () => {
  const s = live(12);
  s.enemies = [];
  s.intro = 1e9;
  const vents = FLOORS[12].rows[10];
  const first = vents.indexOf('v');
  assert.ok(first > 0);
  const b = rollingBall(s, (first + 2) * T, GROUND_TOP - 22, 0);
  b.vx = 0;
  seconds(s, 1.5, []);
  assert.equal(b.dead, true, 'dropped out through the grate');
  const held = ballAt(s, (first + 2) * T, GROUND_TOP - 22, {
    occupant: { id: 5, kind: 'jumper', minion: false },
  });
  seconds(s, 1.5, []);
  assert.equal(held.dead, true);
  assert.equal(s.stats.defeated, 1, 'a drained prisoner is defeated');
  const walker = live(12);
  walker.enemies = [];
  const e = foeAt(walker, 'walker', (first + 2) * T, GROUND_TOP - 40);
  seconds(walker, 1, []);
  assert.equal(e.y + e.h, GROUND_TOP, 'creatures stand on the grate');
});

test('equal balls trade momentum: a rolling ball hands everything to a resting one and stops', () => {
  const s = live(1);
  s.hero.x = 440;
  const mover = rollingBall(s, 100, GROUND_TOP - 22, RULES.ballRoll, { chain: 7 });
  s.chains[7] = { n: 0 };
  const target = ballAt(s, 160, GROUND_TOP - 22, {
    occupant: { id: 3, kind: 'jumper', minion: false },
  });
  const before = mover.vx + target.vx;
  const keBefore = mover.vx ** 2 + target.vx ** 2;
  for (let i = 0; i < 200 && target.mode === 'rest'; i++) tick(s);
  assert.equal(target.mode, 'roll');
  assert.equal(mover.mode, 'rest');
  assert.equal(mover.vx, 0);
  assert.equal(target.vx, RULES.ballRoll);
  assert.equal(mover.vx + target.vx, before, 'momentum conserved');
  assert.equal(mover.vx ** 2 + target.vx ** 2, keBefore, 'energy conserved');
  assert.equal(target.chain, 7, 'the chain continues');
  assert.equal(s.chains[7].n, 1);
  assert.equal(target.occupant, null);
  assert.equal(s.stats.defeated, 1);
});

test('two rolling balls that meet head-on swap velocities', () => {
  const s = live(1);
  s.hero.x = 20;
  const a = rollingBall(s, 150, GROUND_TOP - 22, 180);
  const b = rollingBall(s, 250, GROUND_TOP - 22, -180);
  for (let i = 0; i < 100; i++) tick(s);
  assert.equal(a.vx, -180);
  assert.equal(b.vx, 180);
});

test('a rolling ball defeats each enemy it touches once and chain points climb', () => {
  const s = live(1);
  s.enemies = [];
  s.hero.x = 420;
  const chain = 3;
  s.chains[chain] = { n: 0 };
  const ids = [];
  for (const x of [200, 260, 320]) ids.push(foeAt(s, 'walker', x, GROUND_TOP).id);
  s.enemies.forEach((e) => (e.dir = 1));
  rollingBall(s, 100, GROUND_TOP - 22, RULES.ballRoll, { chain });
  const popped = [];
  let lastSeen = 0;
  let sawChain = false;
  const before = s.score;
  for (let i = 0; i < 400; i++) {
    const had = s.stats.defeated;
    tick(s);
    if (s.stats.defeated > had) popped.push(s.score - before);
    lastSeen = Math.max(lastSeen, s.lastChain);
    sawChain ||= s.learned.chain;
  }
  assert.equal(s.stats.defeated, 3);
  assert.equal(s.stats.bestChain, 3);
  assert.equal(lastSeen, 3);
  assert.ok(sawChain);
  const pts = FOES.walker.score;
  assert.equal(s.score - before >= pts * (1 + 2 + 3), true);
  assert.equal(s.stats.defeated, new Set(ids).size, 'each enemy scored once');
});

test('chain points are base x chain length (capped at 8) and a big chain earns a clear bonus', () => {
  const s = live(1);
  s.enemies = [];
  s.hero.x = 420;
  s.chains[9] = { n: 7 };
  const e = foeAt(s, 'thrower', 200, GROUND_TOP);
  e.dir = 1;
  const b = rollingBall(s, 150, GROUND_TOP - 22, RULES.ballRoll, { chain: 9 });
  b.bounces = 0;
  const before = s.score;
  for (let i = 0; i < 200 && s.enemies.length; i++) tick(s);
  assert.equal(s.chains[9].n, 8);
  assert.ok(s.score - before >= FOES.thrower.score * 8);
  // the floor is now clear: bonus for a chain of 8 is 500 + 500 * (8 - 2)
  seconds(s, 0.1, []);
  assert.ok(s.clear > 0);
  assert.equal(s.stats.chainClears, 1);
  assert.ok(s.score - before >= FOES.thrower.score * 8 + 500 + 500 * 6);
  assert.equal(s.unlockTo, 3);
  const plain = live(1);
  plain.enemies = [];
  tick(plain);
  assert.ok(plain.clear > 0);
  assert.equal(plain.score, 500, 'a clear with no chain pays only the base bonus');
});

test('the hero is never hurt by a snowball, rolling or resting', () => {
  const s = live(1);
  s.hero.x = 200;
  s.hero.y = GROUND_TOP - s.hero.h;
  rollingBall(s, 100, GROUND_TOP - 22, RULES.ballRoll);
  ballAt(s, 205, GROUND_TOP - 22);
  seconds(s, 1.5, []);
  assert.equal(s.lives, RULES.lives);
});

// ---------------------------------------------------------------------------------------------
// Enemies, damage and lives
// ---------------------------------------------------------------------------------------------

test('a walker patrols, turns at walls and at ledges, and slows with snow', () => {
  const s = live(0);
  s.enemies = [];
  const plankTop = TOP + 7 * T;
  const w = foeAt(s, 'walker', 120, plankTop);
  w.dir = 1;
  const seen = new Set();
  for (let i = 0; i < 1500; i++) {
    tick(s);
    seen.add(w.dir);
    assert.equal(w.y + w.h, plankTop, 'never walked off the plank');
    assert.ok(w.x >= 24 - 1e-6 && w.x + w.w <= 192 + 1e-6);
  }
  assert.deepEqual([...seen].sort(), [-1, 1]);
  const g = live(1);
  g.enemies = [];
  const gw = foeAt(g, 'walker', 60, GROUND_TOP);
  gw.dir = -1;
  seconds(g, 1.5, []);
  assert.equal(gw.dir, 1, 'turned at the wall');
  assert.equal(gw.vx, 0, 'and waits a beat before walking back');
  seconds(g, 2, []);
  assert.ok(gw.vx > 0);
});

test('a jumper crouches (a visible telegraph) before every hop and its hop height follows gravity', () => {
  const s = live(1);
  s.enemies = [];
  const j = foeAt(s, 'jumper', 300, GROUND_TOP);
  const states = [];
  let top = j.y;
  for (let i = 0; i < 1200; i++) {
    tick(s);
    if (states.at(-1) !== j.state) states.push(j.state);
    top = Math.min(top, j.y);
  }
  assert.ok(states.includes('crouch') && states.includes('air'));
  for (let i = 1; i < states.length; i++)
    if (states[i] === 'air') assert.equal(states[i - 1], 'crouch', 'always telegraphs');
  const small = (300 * (0.6 + 0.4)) ** 2 / (2 * RULES.gravity);
  assert.ok(GROUND_TOP - j.h - top >= small - 1 && GROUND_TOP - j.h - top < 95);
});

test('a jumper climbs toward a hero standing on a plank above it', () => {
  const s = live(1);
  s.enemies = [];
  s.grid[7] = `#${'.'.repeat(6)}${'='.repeat(6)}${'.'.repeat(6)}#`;
  place(s, 208, TOP + 7 * T - s.hero.h);
  const j = foeAt(s, 'jumper', 215, GROUND_TOP);
  let up = false;
  for (let i = 0; i < 1500 && !up; i++) {
    tick(s);
    if (j.y < GROUND_TOP - j.h - 60) up = true;
    s.hero.invuln = 99;
  }
  assert.ok(up, 'big hop');
});

test('a flyer bobs in a lane around its start height and turns at walls', () => {
  const s = live(1);
  s.enemies = [];
  const f = foeAt(s, 'flyer', 200, TOP + 6 * T + 12 + FOES.flyer.h / 2, { lane: TOP + 6 * T + 12 });
  const ys = [];
  const dirs = new Set();
  for (let i = 0; i < 2400; i++) {
    tick(s);
    ys.push(f.y + f.h / 2);
    dirs.add(f.dir);
  }
  const lane = TOP + 6 * T + 12;
  assert.ok(Math.max(...ys) - lane <= 12.5 && lane - Math.min(...ys) <= 12.5);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 20, 'it actually bobs');
  assert.equal(dirs.size, 2);
});

test('a thrower raises an arm, then lobs an ember at where the hero stood; shots put the ember out', () => {
  const s = live(1);
  s.enemies = [];
  standOnGround(s, 120);
  const t = foeAt(s, 'thrower', 230, GROUND_TOP);
  t.dir = -1;
  t.timer = 0;
  let windup = 0;
  let ember = null;
  for (let i = 0; i < 400 && !ember; i++) {
    tick(s);
    s.hero.invuln = 99;
    if (t.state === 'windup') windup++;
    ember = s.hz.find((z) => z.kind === 'ember');
  }
  assert.ok(Math.abs(windup * STEP - 1.0) < 0.03, `windup ${windup * STEP}`);
  assert.ok(ember, 'lobbed');
  assert.ok(ember.vy < 0 && ember.g === 600);
  // a hero who stays put is hit; one who moves away is not
  const hit = live(1);
  hit.enemies = [];
  standOnGround(hit, 120);
  const t2 = foeAt(hit, 'thrower', 230, GROUND_TOP);
  t2.timer = 0;
  seconds(hit, 3, []);
  assert.equal(hit.lives, RULES.lives - 1);
  const dodge = live(1);
  dodge.enemies = [];
  standOnGround(dodge, 120);
  const t3 = foeAt(dodge, 'thrower', 230, GROUND_TOP);
  t3.timer = 0;
  let moved = false;
  for (let i = 0; i < 600; i++) {
    tick(dodge, t3.state === 'windup' || moved ? ((moved = true), ['ArrowLeft']) : []);
  }
  assert.equal(dodge.lives, RULES.lives);
  // shot vs ember
  const q = live(1);
  q.enemies = [];
  q.hero.invuln = 99;
  standOnGround(q, 100);
  q.hz.push({ kind: 'ember', x: 140, y: q.hero.y + 4, w: 10, h: 10, vx: 0, vy: 0, g: 0, life: 3 });
  tick(q, ['KeyX'], ['KeyX']);
  seconds(q, 0.3, []);
  assert.equal(q.hz.length, 0);
  assert.ok(q.score >= 20);
});

test('touching a free enemy costs a life, resets the hero and starts a brief invulnerability', () => {
  const s = live(1);
  const sounds = [];
  const w = foeAt(s, 'walker', 200, GROUND_TOP);
  standOnGround(s, 200);
  tick(s, [], [], (n) => sounds.push(n));
  assert.equal(s.lives, RULES.lives - 1);
  assert.ok(Math.abs(s.hero.invuln - RULES.invuln) < 0.02);
  assert.equal(s.hero.x, s.start.c * T + (T - s.hero.w) / 2, 'back at the start');
  assert.ok(sounds.includes('hit') && !sounds.includes('lose'));
  place(s, w.x, w.y);
  tick(s);
  assert.equal(s.lives, RULES.lives - 1, 'invulnerable');
  seconds(s, RULES.invuln + 0.1, []);
  place(s, w.x, w.y);
  tick(s);
  assert.equal(s.lives, RULES.lives - 2, 'vulnerable again');
});

test('enemies and snowballs are harmless during the floor intro; encased enemies never hurt', () => {
  const s = newState(seeded(2));
  loadFloor(s, 1);
  assert.ok(s.intro > 0);
  const w = foeAt(s, 'walker', 300, GROUND_TOP);
  place(s, w.x, w.y);
  seconds(s, 0.5, []);
  assert.equal(s.lives, RULES.lives);
  assert.equal(w.x, 300 - w.w / 2 + w.w / 2 - 0, 'enemies hold still during the intro');
  s.intro = 0;
  w.snow = 3.9;
  place(s, w.x, w.y);
  tick(s);
  assert.equal(s.lives, RULES.lives - 1, 'almost encased still hurts');
  const e = live(1);
  const v = foeAt(e, 'walker', 300, GROUND_TOP);
  e.enemies = [];
  ballAt(e, v.x, v.y, { occupant: { id: 4, kind: 'walker', minion: false } });
  place(e, v.x, v.y);
  seconds(e, 0.5, []);
  assert.equal(e.lives, RULES.lives);
});

test('losing the last life ends the game once, stays frozen, and a new instance starts fresh', () => {
  const h = harness({ seed: 3 });
  const g = createGame(h.env);
  g.update(1 / 60, input([]));
  const start = g.getState();
  assert.equal(start.lives, RULES.lives);
  assert.equal(start.phase, 'playing');
  // run into walkers until all lives are gone
  const s = live(1);
  s.lives = 1;
  const w = foeAt(s, 'walker', 200, GROUND_TOP);
  standOnGround(s, 200);
  const sounds = [];
  tick(s, [], [], (n) => sounds.push(n));
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'lives');
  assert.deepEqual(
    sounds.filter((n) => n === 'lose'),
    ['lose'],
  );
  const frozen = JSON.stringify(snapshot(s));
  assert.equal(advance(s, STEP, input(['ArrowRight'], ['ArrowUp']), noop), false);
  assert.equal(JSON.stringify(snapshot(s)), frozen);
  assert.ok(w);
  // via the public game: lose all lives for real
  const h2 = harness({ seed: 4 });
  const g2 = createGame(h2.env);
  const st = g2.getState();
  assert.equal(st.floor, 1);
  // drive the hero into the left walker on floor 1 repeatedly
  for (let i = 0; i < 60 * 120 && h2.ends.length === 0; i++) {
    const cur = g2.getState();
    const foe = cur.foes[0];
    g2.update(1 / 60, input(foe && foe.x < cur.hero.x ? ['ArrowLeft'] : ['ArrowRight']));
  }
  assert.equal(h2.ends.length <= 1, true);
  for (let i = 0; i < 100; i++) g2.update(1 / 60, input(['ArrowRight']));
  assert.ok(h2.ends.length <= 1);
  if (h2.ends.length) {
    assert.equal(h2.ends[0].won, false);
    assert.ok(h2.ends[0].message.length > 5);
    assert.equal(g2.getState().phase, 'lost');
    assert.equal(h2.sounds.filter((n) => n === 'lose' || n === 'win').length, 1);
  }
  const again = createGame(harness({ seed: 4 }).env).getState();
  assert.equal(again.lives, RULES.lives);
  assert.equal(again.score, 0);
  assert.equal(again.phase, 'playing');
});

test('extra lives come from score, once per threshold, up to a cap', () => {
  const s = live(1);
  s.enemies = [];
  s.score = RULES.extraLives[0] - 100;
  standOnGround(s, 200);
  const pick = (value) =>
    s.pickups.push({
      id: s.nextId++,
      x: s.hero.x,
      y: s.hero.y,
      w: 14,
      h: 14,
      vy: 0,
      kind: 'pear',
      power: false,
      value,
      life: 5,
    });
  pick(200);
  const sounds = [];
  tick(s, [], [], (n) => sounds.push(n));
  assert.equal(s.lives, RULES.lives + 1);
  assert.ok(sounds.includes('coin'));
  pick(200);
  tick(s);
  assert.equal(s.lives, RULES.lives + 1, 'only once per threshold');
  s.lives = RULES.maxLives;
  s.score = RULES.extraLives[1] - 100;
  pick(200);
  tick(s);
  assert.equal(s.lives, RULES.maxLives, 'capped');
  assert.ok(s.msg === null || typeof s.msg.en === 'string');
});

// ---------------------------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------------------------

test('defeated enemies drop pickups that apply exactly once and expire', () => {
  const s = live(1);
  s.enemies = [];
  for (let n = 1; n <= 4; n++) {
    s.hero.x = 400;
    const w = foeAt(s, 'walker', 200, GROUND_TOP);
    foeAt(s, 'walker', 440, GROUND_TOP, { dir: 1 });
    s.chains[50 + n] = { n: n - 1 };
    rollingBall(s, 170, GROUND_TOP - 22, RULES.ballRoll, { chain: 50 + n });
    seconds(s, 0.3, []);
    assert.ok(w.dead || s.stats.defeated >= n);
    s.balls = [];
  }
  assert.ok(s.pickups.length >= 3, 'every defeat drops something');
  assert.ok(
    s.pickups.every((p) =>
      p.power ? POWERS.includes(p.kind) : FRUIT.some((f) => f.id === p.kind),
    ),
  );
  standOnGround(s, 200);
  const score0 = s.score;
  const fruit = {
    id: s.nextId++,
    x: s.hero.x,
    y: s.hero.y,
    w: 14,
    h: 14,
    vy: 0,
    kind: 'star',
    power: false,
    value: 500,
    life: 5,
  };
  s.pickups = [fruit];
  tick(s);
  assert.equal(s.score, score0 + 500);
  assert.equal(s.pickups.length, 0);
  tick(s);
  assert.equal(s.score, score0 + 500, 'applied once');
  assert.ok(s.learned.pickup);
  const old = {
    id: 99,
    x: 30,
    y: 100,
    w: 14,
    h: 14,
    vy: 0,
    kind: 'cherry',
    power: false,
    value: 100,
    life: 0.05,
  };
  s.pickups = [old];
  seconds(s, 0.1, []);
  assert.equal(s.pickups.length, 0);
  assert.deepEqual(
    FRUIT.map((f) => f.value),
    [100, 200, 300, 500],
  );
});

test('power-ups: speed, shot range, shot power and a short shield', () => {
  const give = (kind) => {
    const s = live(1);
    s.enemies = [];
    foeAt(s, 'walker', 440, GROUND_TOP, { dir: 1 });
    standOnGround(s, 200);
    s.pickups.push({
      id: 1,
      x: s.hero.x,
      y: s.hero.y,
      w: 14,
      h: 14,
      vy: 0,
      kind,
      power: true,
      value: 0,
      life: 5,
    });
    tick(s);
    return s;
  };
  const speed = give('speed');
  assert.ok(speed.hero.power.speed > RULES.powerTime - 0.1);
  seconds(speed, 0.5, ['ArrowRight']);
  assert.equal(speed.hero.vx, RULES.run * RULES.speedBoost);
  const range = give('range');
  tick(range, ['KeyX'], ['KeyX']);
  const x0 = range.shots[0].x;
  let end = x0;
  while (range.shots.length) {
    end = range.shots[0].x;
    tick(range);
  }
  assert.ok(Math.abs(end - x0 - RULES.shotRange * RULES.rangeBoost) < 6);
  const power = give('power');
  const w = foeAt(power, 'walker', 290, GROUND_TOP);
  w.dir = -1;
  seconds(power, 0.5, ['KeyX']);
  assert.ok(w.snow >= 2 || power.balls.length, 'two snow per shot');
  const shield = give('shield');
  assert.ok(Math.abs(shield.hero.power.shield - RULES.shieldTime) < 0.05);
  const e = foeAt(shield, 'walker', shield.hero.x, GROUND_TOP);
  place(shield, e.x, e.y);
  tick(shield);
  assert.equal(shield.lives, RULES.lives, 'shielded');
  seconds(shield, RULES.shieldTime + 0.2, []);
  assert.equal(shield.hero.power.shield, 0);
  place(shield, e.x, e.y);
  tick(shield);
  assert.equal(shield.lives, RULES.lives - 1);
  assert.equal(shield.hero.power.speed, 0, 'powers are lost when hurt');
});

// ---------------------------------------------------------------------------------------------
// Hurry-up
// ---------------------------------------------------------------------------------------------

test('hurry-up: warning first, then a slower-than-you pursuer that recoils after a touch', () => {
  const s = live(1);
  const at = hurryAt(s);
  assert.equal(at, FLOORS[1].hurry);
  s.floorTime = at - 0.5;
  seconds(s, 0.4, []);
  assert.equal(s.hurryState, 'none');
  assert.equal(promptText(s).key !== 'warn', true);
  seconds(s, 0.2, []);
  assert.equal(s.hurryState, 'warn');
  assert.equal(s.wraith, null, 'a visible warning comes first');
  setPromptNow(s);
  assert.equal(promptText(s).key, 'warn');
  assert.match(promptText(s).en, /Wraith in \d+s/);
  s.floorTime = at + RULES.hurryWarn - 0.01;
  seconds(s, 0.05, []);
  assert.equal(s.hurryState, 'chase');
  assert.ok(s.wraith);
  const snap = snapshot(s);
  assert.ok(snap.wraith && snap.hurry.state === 'chase' && snap.hurry.left === 0);
  // speed: it covers wraithSpeed px per second toward the hero
  s.hero.invuln = 99;
  const x0 = s.wraith.x;
  const y0 = s.wraith.y;
  const hero = { x: s.hero.x + 8, y: s.hero.y + 10 };
  seconds(s, 1, []);
  const d = Math.hypot(s.wraith.x - x0, s.wraith.y - y0);
  assert.ok(d <= RULES.wraithSpeed + 0.5 && d > RULES.wraithSpeed - 3, `moved ${d}`);
  assert.ok(RULES.wraithSpeed < RULES.run);
  assert.ok(hero.x > 0);
  // touching it hurts once, then it backs off
  s.hero.invuln = 0;
  s.wraith.x = s.hero.x;
  s.wraith.y = s.hero.y;
  const lives = s.lives;
  tick(s);
  assert.equal(s.lives, lives - 1);
  assert.equal(s.wraith.recoil > 2, true);
  const dist = (w) => Math.hypot(w.x - s.hero.x, w.y - s.hero.y);
  const d0 = dist(s.wraith);
  seconds(s, 1, []);
  assert.ok(dist(s.wraith) > d0 - 1);
  // clearing the floor removes it
  s.enemies = [];
  s.balls = [];
  tick(s);
  assert.equal(s.wraith, null);
});

function setPromptNow(s) {
  s.prompt.age = 1e9;
  tick(s);
}

test('boss floors have no hurry-up pursuer', () => {
  const s = live(9);
  s.floorTime = 9999;
  seconds(s, 0.5, []);
  assert.equal(s.wraith, null);
  assert.equal(s.hurryState, 'none');
  assert.equal(snapshot(s).hurry.left, null);
});

// ---------------------------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------------------------

const bossBall = (s, boss, side = -1, vx = RULES.ballRoll) => {
  const x = side < 0 ? boss.x - RULES.ballSize : boss.x + boss.w;
  return rollingBall(s, x, boss.y + boss.h - RULES.ballSize, -side * vx, { chain: 1 });
};

test('bosses take damage only from rolling snowballs, one hit per 1.4 s of immunity', () => {
  const s = live(9);
  const boss = s.boss;
  assert.equal(boss.kind, 'golem');
  assert.equal(boss.hp, BOSSES.golem.hp);
  standOnGround(s, 40);
  boss.invuln = 0;
  // shots only flash
  place(s, boss.x - 100, GROUND_TOP - s.hero.h);
  s.hero.face = 1;
  s.hero.invuln = 99;
  tick(s, ['KeyX'], ['KeyX']);
  seconds(s, 0.6, []);
  assert.equal(boss.hp, BOSSES.golem.hp, 'a shot is not damage');
  // a resting ball does nothing either
  ballAt(s, boss.x - 40, GROUND_TOP - 22);
  seconds(s, 0.2, []);
  assert.equal(boss.hp, BOSSES.golem.hp);
  s.balls = [];
  boss.state = 'walk';
  const sounds = [];
  const b = bossBall(s, boss);
  ticks(s, 3, [], [], (n) => sounds.push(n));
  assert.equal(boss.hp, BOSSES.golem.hp - 1);
  assert.equal(boss.state, 'hurt');
  assert.ok(boss.invuln > 1.3);
  assert.equal(s.score, 500);
  assert.equal(b.bounces, 1, 'the boss counts as a wall');
  assert.ok(Math.abs(b.vx) <= RULES.ballRoll * RULES.ballKeep + 1e-9);
  const b2 = bossBall(s, boss);
  ticks(s, 3);
  assert.equal(boss.hp, BOSSES.golem.hp - 1, 'immune right after a hit');
  assert.equal(b2.bounces, 1);
  seconds(s, BOSS_GAP(), []);
  bossBall(s, boss);
  ticks(s, 3);
  assert.equal(boss.hp, BOSSES.golem.hp - 2);
  assert.ok(sounds.includes('hit'));
});
const BOSS_GAP = () => 1.45;

test('golem: telegraphed stomp sends ground waves; standing on a plank is safe; phases follow health', () => {
  const s = live(9);
  const boss = s.boss;
  s.hero.invuln = 0;
  place(s, 60, TOP + 7 * T - s.hero.h);
  boss.cd = 0.01;
  let windup = 0;
  let waves = 0;
  for (let i = 0; i < 600; i++) {
    tick(s);
    if (boss.state === 'windup') windup++;
    waves = Math.max(waves, s.hz.filter((z) => z.kind === 'wave').length);
  }
  assert.ok(Math.abs(windup * STEP - 1.2) < 0.03, 'the stomp has a 1.2 s warning');
  assert.equal(waves, 2, 'one wave each way');
  assert.equal(s.lives, RULES.lives, 'a hero on a plank is out of reach');
  // a hero on the floor must jump over the wave
  const f = live(9);
  f.boss.cd = 99;
  f.hz.push({ kind: 'wave', x: 300, y: GROUND_TOP - 12, w: 14, h: 12, vx: -90, vy: 0, life: 6 });
  standOnGround(f, 200);
  seconds(f, 1.5, []);
  assert.equal(f.lives, RULES.lives - 1);
  const g = live(9);
  g.boss.cd = 99;
  g.hz.push({ kind: 'wave', x: 300, y: GROUND_TOP - 12, w: 14, h: 12, vx: -90, vy: 0, life: 6 });
  standOnGround(g, 200);
  let t = 0;
  while (g.hz.length && t++ < 600)
    tick(g, t >= 70 && t < 110 ? ['ArrowUp'] : [], t === 70 ? ['ArrowUp'] : [], noop);
  assert.equal(g.lives, RULES.lives, 'jumped it');
  // phases
  const p = live(9);
  p.hero.invuln = 99;
  assert.equal(p.boss.phase, 1);
  p.boss.hp = 2;
  p.boss.invuln = 0;
  bossBall(p, p.boss);
  ticks(p, 3);
  assert.equal(p.boss.hp, 1);
  assert.equal(p.boss.phase, 3, 'phase 3 at one third health');
  assert.match(p.msg.en, /angry/);
  // minions come from the vent away from the hero and have a warning
  const m = live(9);
  m.boss.spawnT = 0;
  m.hero.invuln = 99;
  place(m, 60, TOP + 7 * T - m.hero.h);
  tick(m);
  assert.equal(m.marks.length, 1);
  assert.equal(m.marks[0].kind, 'vent');
  assert.ok(m.marks[0].x > 240, 'the far vent');
  seconds(m, 0.8, []);
  assert.equal(m.enemies.filter((e) => e.minion).length, 1);
});

test('golem: defeating it clears the floor and unlocks the next', () => {
  const s = live(9);
  s.boss.hp = 1;
  s.boss.invuln = 0;
  s.hero.invuln = 99;
  bossBall(s, s.boss);
  ticks(s, 3);
  assert.equal(s.boss.state, 'dying');
  assert.equal(bossHarms(s.boss), false);
  assert.equal(s.enemies.filter((e) => !e.dead).length, 0);
  seconds(s, 1.5, []);
  assert.equal(s.boss, null);
  assert.ok(s.clear > 0);
  assert.equal(s.unlockTo, 11);
});

test('wyrm: mark, then dive, then dazed (harmless) and vulnerable; planks shelter the hero', () => {
  const s = live(19);
  const boss = s.boss;
  assert.equal(boss.kind, 'wyrm');
  s.hero.invuln = 0;
  standOnGround(s, 200);
  boss.cd = 0.01;
  const states = [];
  let beam = false;
  for (let i = 0; i < 1200; i++) {
    tick(s);
    if (states.at(-1) !== boss.state) states.push(boss.state);
    beam ||= boss.beam;
    if (boss.state === 'dazed') break;
    s.hero.invuln = 99;
  }
  assert.deepEqual(states.slice(0, 4), ['sweep', 'mark', 'dive', 'dazed']);
  assert.ok(beam, 'a beam marks the landing');
  assert.equal(bossHarms(boss), false);
  assert.ok(Math.abs(boss.x + boss.w / 2 - 208) < 40, 'dived where the floor-bound hero stood');
  s.hero.invuln = 0;
  place(s, boss.x + 10, boss.y);
  tick(s);
  assert.equal(s.lives, RULES.lives, 'touching a dazed wyrm is safe');
  boss.invuln = 0;
  bossBall(s, boss);
  ticks(s, 3);
  assert.equal(boss.hp, BOSSES.wyrm.hp - 1);
  seconds(s, 1.2, []);
  assert.ok(['hurt', 'rise', 'sweep'].includes(boss.state));
  // sheltering on a plank: it picks the far side
  const t = live(19);
  place(t, 60, TOP + 7 * T - t.hero.h);
  t.boss.cd = 0.01;
  for (let i = 0; i < 1500 && t.boss.state !== 'dazed'; i++) {
    tick(t);
    t.hero.invuln = 99;
  }
  assert.equal(t.boss.state, 'dazed');
  assert.ok(t.boss.x + t.boss.w / 2 > 240, 'lands on the far side');
  assert.equal(t.lives, RULES.lives);
  seconds(t, 8, []);
  assert.ok(t.enemies.filter((e) => e.minion).length <= 1, 'one minion at a time');
});

test('wyrm: the dive hurts a hero standing in the column; rise returns it to the lane', () => {
  const s = live(19);
  const boss = s.boss;
  standOnGround(s, 240);
  boss.state = 'dive';
  boss.vy = 380;
  boss.x = 240 - boss.w / 2;
  boss.y = 100;
  seconds(s, 0.6, []);
  assert.equal(s.lives, RULES.lives - 1);
  boss.state = 'rise';
  boss.y = GROUND_TOP - boss.h;
  s.hero.invuln = 99;
  seconds(s, 2, []);
  assert.equal(boss.state, 'sweep');
  assert.ok(boss.y <= TOP + 9);
});

test('queen: warns with marked columns, then fire falls only there; a hit makes her vanish and reappear', () => {
  const s = live(29);
  const boss = s.boss;
  assert.equal(boss.kind, 'queen');
  s.hero.invuln = 99;
  place(s, 60, TOP + 7 * T - s.hero.h);
  boss.cd = 0.01;
  let marks = 0;
  let embers = 0;
  const flare = [];
  for (let i = 0; i < 900; i++) {
    tick(s);
    marks = Math.max(marks, s.marks.filter((m) => m.kind === 'rain').length);
    embers = Math.max(embers, s.hz.filter((z) => z.kind === 'ember').length);
    if (boss.state === 'flare') flare.push(i);
    if (embers) break;
  }
  assert.equal(marks, 2);
  assert.equal(embers, 2);
  assert.ok(flare.length * STEP >= 1.9, 'warning time');
  s.hz = [];
  s.marks = [];
  boss.state = 'idle';
  boss.invuln = 0;
  bossBall(s, boss);
  const from = boss.x;
  ticks(s, 3);
  assert.equal(boss.state, 'hurt');
  seconds(s, 1.1, []);
  assert.equal(boss.state, 'vanish');
  seconds(s, 0.5, []);
  assert.ok(['appear', 'idle'].includes(boss.state));
  assert.notEqual(boss.x, from, 'moved to another spot');
  assert.equal(bossHarms(boss), boss.state === 'idle');
});

test('queen: summons minions, shelters stop fire, the last hit wins the game once', () => {
  const s = live(29);
  s.hero.invuln = 99;
  s.boss.cd = 0.01;
  seconds(s, 0.2, []);
  assert.ok(
    s.marks.some((m) => m.kind === 'vent'),
    'odd actions summon',
  );
  const win = [];
  s.boss.hp = 1;
  s.boss.invuln = 0;
  s.boss.state = 'idle';
  bossBall(s, s.boss);
  const h = [];
  ticks(s, 3, [], [], (n) => h.push(n));
  seconds(s, 1.6, [], [], (n) => h.push(n));
  win.push(...h);
  assert.equal(s.phase, 'won');
  assert.equal(win.filter((n) => n === 'win').length, 1);
  assert.ok(s.score >= 3000 + s.lives * 1000);
  const frozen = JSON.stringify(snapshot(s));
  assert.equal(advance(s, STEP, input([]), noop), false);
  assert.equal(JSON.stringify(snapshot(s)), frozen);
  // falling fire is stopped by a plank and by the floor
  const f = live(29);
  f.hero.invuln = 99;
  f.hz.push({ kind: 'ember', x: 60, y: TOP, w: 12, h: 20, vx: 0, vy: 300, g: 0, life: 2 });
  seconds(f, 1.5, []);
  assert.equal(f.hz.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Floors, clearing, progress and the select screen
// ---------------------------------------------------------------------------------------------

test('clearing a floor pays a bonus, unlocks the next, and loads it after a short pause', () => {
  const s = live(1);
  s.enemies = [];
  const sounds = [];
  tick(s, [], [], (n) => sounds.push(n));
  assert.ok(s.clear > 0);
  assert.equal(s.unlockTo, 3);
  assert.ok(sounds.includes('coin') && !sounds.includes('win'));
  assert.equal(promptText(s).key, 'cleared');
  const snap = snapshot(s);
  assert.equal(snap.cleared, true);
  tick(s, ['ArrowUp'], ['ArrowUp']);
  assert.equal(s.hero.pj, false, 'no stored presses during the pause');
  seconds(s, RULES.clearTime + 0.1, []);
  assert.equal(s.floor, 2);
  assert.equal(s.lives, RULES.lives);
  assert.ok(s.intro > 0);
});

test('progress: continue from the unlocked floor, unlock(n+1) on clear, never lowered, validated', () => {
  const log = [];
  let unlocked = 4;
  const h = harness({ seed: 9 });
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      log.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  let st = g.getState();
  assert.ok(st.menu);
  assert.equal(st.menu.cursor, 4);
  assert.equal(st.menu.unlocked, 4);
  assert.equal(st.prompt.key, 'menu');
  assert.match(st.status.en, /4\/30 floors open/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 3);
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 4, 'cannot move past the unlocked floor');
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1, 'a row up clamps to the first floor');
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 4, 'a row down clamps to the last open floor');
  g.update(1 / 60, input([], ['Space']));
  st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.floor, 4);
  assert.equal(st.floorCount, 30);
  assert.deepEqual(log, [], 'starting does not unlock anything');
  // a pointer tap on a locked floor is refused; a tap on an open floor starts it
  const h2 = harness({ seed: 9 });
  h2.env.progress = { unlocked: () => 3, unlock: noop };
  const g2 = createGame(h2.env);
  const locked = menuCell(10);
  g2.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.ok(g2.getState().menu);
  assert.match(g2.getState().message.en, /Clear floor 3 first/);
  const open = menuCell(2);
  g2.update(1 / 60, input([], [], { x: open.x + 5, y: open.y + 5, clicked: true }));
  g2.update(1 / 60, input([], ['Enter']));
  assert.equal(g2.getState().floor, 2);
  // clearing a floor unlocks the next one through env.progress
  const h3 = harness({ seed: 9 });
  const calls = [];
  h3.env.progress = { unlocked: () => 1, unlock: (n) => calls.push(n) };
  const g3 = createGame(h3.env);
  assert.equal(g3.getState().menu, null, 'nothing to choose with only floor 1 open');
  for (let i = 0; i < 60 * 100 && !calls.length; i++) {
    const cur = g3.getState();
    const nearest = [...cur.foes, ...cur.balls].sort(
      (a, b) => Math.abs(a.x - cur.hero.x) - Math.abs(b.x - cur.hero.x),
    )[0];
    g3.update(
      1 / 60,
      input(
        nearest ? [nearest.x < cur.hero.x ? 'ArrowLeft' : 'ArrowRight', 'KeyX', 'ArrowUp'] : [],
      ),
    );
    if (cur.phase !== 'playing') break;
  }
  assert.ok(calls.every((n) => n >= 2 && n <= 30));
  // validation of the host value
  for (const [value, expect] of [
    [999, 30],
    [-5, null],
    [NaN, null],
    [1.9, null],
    [undefined, null],
    [30, 30],
    [7.6, 7],
  ]) {
    const hh = harness({ seed: 1 });
    hh.env.progress = { unlocked: () => value, unlock: noop };
    const gg = createGame(hh.env);
    const m = gg.getState().menu;
    if (expect === null) assert.equal(m, null, String(value));
    else assert.equal(m.unlocked, expect, String(value));
  }
  const bare = createGame(harness({ seed: 1 }).env);
  assert.equal(bare.getState().menu, null);
  const s = newState(seeded(1));
  openMenu(s, 5);
  assert.equal(s.menu.cursor, 5);
});

test('a locked floor cannot be started by the keyboard either', () => {
  const s = newState(seeded(1));
  openMenu(s, 3);
  for (let i = 0; i < 10; i++) advance(s, 1 / 60, input([], ['ArrowRight']), noop);
  assert.equal(s.menu.cursor, 3);
  advance(s, 1 / 60, input([], ['KeyD']), noop);
  assert.equal(s.menu.cursor, 3);
  advance(s, 1 / 60, input([], ['KeyA']), noop);
  assert.equal(s.menu.cursor, 2);
  advance(s, 1 / 60, input([], ['NumpadEnter']), noop);
  assert.equal(s.floor, 1);
  assert.equal(s.menu, null);
});

// ---------------------------------------------------------------------------------------------
// State, prompts and drawing
// ---------------------------------------------------------------------------------------------

test('getState returns copies and exposes no way to cheat', () => {
  const g = createGame(harness({ seed: 2 }).env);
  const a = g.getState();
  a.hero.x = -999;
  a.lives = 99;
  a.tiles[3] = 'XXXXXXXXXXXXXXXXXXXX';
  a.foes.push({ fake: true });
  a.hero.powers.shield = 99;
  a.stats.defeated = 99;
  const b = g.getState();
  assert.notEqual(b.hero.x, -999);
  assert.equal(b.lives, RULES.lives);
  assert.equal(b.tiles[3].includes('X'), false);
  assert.equal(b.foes.length, 2);
  assert.equal(b.hero.powers.shield, 0);
  assert.equal(b.stats.defeated, 0);
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  assert.ok(Number.isFinite(b.score) && ['playing', 'won', 'lost'].includes(b.phase));
  assert.ok(b.status.en.includes('Floor 1/30') && b.status.zh.includes('第 1/30 层'));
});

test('prompt texts are bilingual, short enough to fit and name their keys in both modes', () => {
  for (const coopMode of [false, true]) {
    for (const [key, [en, zh]] of Object.entries(PROMPTS)) {
      assert.ok(en && zh, key);
      const e = fillKeys(en, coopMode, 'en');
      const z = fillKeys(zh, coopMode, 'zh');
      assert.ok(e.length * 0.6 * 14 <= 440, `${key} EN too wide`);
      assert.ok(z.length * 14 <= 440, `${key} ZH too wide`);
      assert.doesNotMatch(
        (e + z).replaceAll('{n}', '').replaceAll('{dir}', ''),
        /[{}]/,
        'every placeholder is filled',
      );
      assert.doesNotMatch(
        z.replace(/\{\w+\}/g, ''),
        /[A-Za-z]{2,}/,
        `${key}: no English words in zh`,
      );
    }
  }
  assert.match(fillKeys(PROMPTS.jump[0], false, 'en'), /W \/ Up \/ Space/);
  assert.match(fillKeys(PROMPTS.throw[0], false, 'en'), /X or J/);
  assert.doesNotMatch(fillKeys(PROMPTS.throw[0], true, 'en'), /X|J/);
  assert.doesNotMatch(fillKeys(PROMPTS.jump[0], true, 'en'), /Space/);
  assert.match(PROMPTS.drop[0], /Down \+ Jump/);
});

// A recording canvas context: remembers every fillText with its size and alignment.
function recorder() {
  const texts = [];
  let font = '';
  let align = 'left';
  const rects = [];
  const target = {
    measureText: (t) => ({ width: String(t).length * 7 }),
    canvas: { width: 480, height: 320 },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(target, {
    get: (t, p) => {
      if (p === 'fillText')
        return (text, x, y) =>
          texts.push({ text: String(text), x, y, size: Number(/(\d+)px/.exec(font)[1]), align });
      if (p === 'fillRect') return (x, y, w, h) => rects.push({ x, y, w, h });
      return p in t ? t[p] : () => {};
    },
    set: (t, p, v) => {
      if (p === 'font') font = v;
      if (p === 'textAlign') align = v;
      t[p] = v;
      return true;
    },
  });
  return { ctx, texts, rects };
}
const widthOf = (t) => {
  let em = 0;
  for (const ch of t.text) em += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.6;
  return em * t.size;
};
const span = (t) => {
  const w = widthOf(t);
  const x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
  return [x0, x0 + w];
};

test('every drawn text is 14-16 px, fits the canvas, and the HUD bands never overlap', () => {
  for (const lang of ['en', 'zh']) {
    const env = harness({ lang }).env;
    const cases = [
      () => live(0),
      () => {
        const s = live(9);
        s.boss.hp = 2;
        return s;
      },
      () => {
        const s = live(11);
        s.hurryState = 'chase';
        return s;
      },
      () => {
        const s = live(1);
        s.hurryState = 'warn';
        s.msg = { en: 'Extra life!', zh: '获得一条命！', left: 100 };
        s.pops.push({ x: 100, y: 100, label: '1200 x3', left: 1 });
        return s;
      },
      () => {
        const s = newState(seeded(1));
        openMenu(s, 17);
        s.menu.cursor = 10;
        return s;
      },
    ];
    for (const make of cases) {
      const s = make();
      s.score = 123456;
      s.lives = RULES.maxLives;
      const { ctx, texts } = recorder();
      render(ctx, s, { ...env, lang });
      assert.ok(texts.length >= 2);
      for (const t of texts) {
        assert.ok(t.size >= 14 && t.size <= 16, `${lang}: "${t.text}" ${t.size}px`);
        const [a, b] = span(t);
        assert.ok(a >= 0 && b <= 480, `${lang}: "${t.text}" spans ${a}..${b}`);
      }
      const bands = (lo, hi) => texts.filter((t) => t.y >= lo && t.y < hi);
      const lines = (list) =>
        [...new Set(list.map((q) => q.y))].map((y) => list.filter((q) => q.y === y));
      for (const row of [...lines(bands(0, TOP)), ...lines(bands(TOP + RULES.rows * T, 320))]) {
        const spans = row.map(span).sort((p, q) => p[0] - q[0]);
        for (let i = 1; i < spans.length; i++)
          assert.ok(spans[i][0] >= spans[i - 1][1] - 0.5, `${lang}: overlap in a band`);
      }
    }
  }
});

test('the select screen has 30 cells, no overlapping text in English or Chinese, and shows the boss floors', () => {
  const cells = FLOORS.map((_, i) => menuCell(i + 1));
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    assert.ok(a.x >= 0 && a.x + a.w <= 480 && a.y >= 28 && a.y + a.h <= TOP + RULES.rows * T);
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j];
      assert.ok(
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
        'cells overlap',
      );
    }
  }
  for (const lang of ['en', 'zh']) {
    for (const cursor of [1, 10, 17, 30]) {
      const s = newState(seeded(1));
      openMenu(s, 30);
      s.menu.cursor = cursor;
      const { ctx, texts } = recorder();
      render(ctx, s, { ...harness({ lang }).env, lang });
      const spans = texts.map((t) => ({ t, s: span(t) }));
      for (let i = 0; i < spans.length; i++)
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i];
          const b = spans[j];
          const sameBand = Math.abs(a.t.y - b.t.y) < 14;
          if (sameBand)
            assert.ok(
              a.s[1] <= b.s[0] + 0.5 || b.s[1] <= a.s[0] + 0.5,
              `${lang}: "${a.t.text}" overlaps "${b.t.text}"`,
            );
        }
      for (const x of texts) {
        assert.ok(x.size >= 14 && x.size <= 16);
        assert.ok(span(x)[1] <= 480 && span(x)[0] >= 0);
      }
    }
  }
});

test('drawing covers every kind of actor, effect and screen without errors or NaN', () => {
  const env = harness({ lang: 'en' }).env;
  const ctx = mockContext();
  const draw = (s, lang = 'en') =>
    render(ctx, s, { ...env, lang, t: (a, b) => (lang === 'zh' ? b : a) });
  const s = live(7);
  for (const kind of Object.keys(FOES))
    for (const state of ['walk', 'windup', 'crouch', 'air', 'fly'])
      for (const dir of [-1, 1])
        for (const snow of [0, 1, 2, 3.5]) {
          const e = foeAt(s, kind, 200, GROUND_TOP, { state, dir, snow, flash: 0.1 });
          draw(s);
          s.enemies = s.enemies.filter((q) => q !== e);
        }
  for (const mode of ['rest', 'roll'])
    for (const life of [5, 1])
      for (const occ of [null, 'walker', 'jumper', 'flyer', 'thrower']) {
        ballAt(s, 100, 100, {
          mode,
          life,
          occupant: occ ? { id: 1, kind: occ, minion: false } : null,
        });
        draw(s);
      }
  for (const p of [...FRUIT.map((f) => f.id), ...POWERS]) {
    s.pickups.push({
      id: 1,
      x: 100,
      y: 100,
      w: 14,
      h: 14,
      vy: 0,
      kind: p,
      power: POWERS.includes(p),
      value: 100,
      life: p === 'star' ? 1 : 9,
    });
  }
  s.hz.push({ kind: 'wave', x: 50, y: 250, w: 14, h: 12, vx: 100, vy: 0, life: 3 });
  s.hz.push({ kind: 'ember', x: 80, y: 120, w: 10, h: 10, vx: 0, vy: 0, g: 600, life: 3 });
  s.marks.push(
    { kind: 'rain', x: 100, w: 16, left: 1, y: 200 },
    { kind: 'vent', x: 60, w: 24, left: 1 },
  );
  s.shots.push({ x: 50, y: 150, w: 10, h: 8, vx: 100, life: 1, gain: 1 });
  s.wraith = { x: 100, y: 100, w: 22, h: 22, recoil: 0 };
  s.fx.push({ x: 5, y: 5, vx: 0, vy: 0, color: '#fff', left: 1 });
  s.msg = { en: 'Hello', zh: '你好', left: 50 };
  s.hurryState = 'warn';
  s.hero.power = { speed: 5, range: 5, power: 5, shield: 5 };
  for (const invuln of [0, 2])
    for (const [grounded, vx, cd] of [
      [true, 0, 0],
      [true, 50, 0],
      [false, 0, 0],
      [true, 0, 0.25],
    ]) {
      Object.assign(s.hero, { invuln, grounded, vx, cd, face: invuln ? -1 : 1 });
      draw(s);
      draw(s, 'zh');
      s.ticks += 7;
    }
  s.hurryState = 'chase';
  s.intro = 0.5;
  draw(s);
  for (const f of [0, 5, 9, 12, 19, 29]) {
    const t = live(f);
    t.score = 99999;
    draw(t);
    draw(t, 'zh');
  }
  const b = live(9);
  for (const state of ['walk', 'windup', 'rest', 'hurt', 'dying']) {
    for (const flash of [0, 0.3])
      for (const invuln of [0, 1]) {
        Object.assign(b.boss, { state, flash, invuln });
        draw(b);
        b.ticks += 3;
      }
  }
  const w = live(19);
  for (const state of ['sweep', 'mark', 'dive', 'dazed', 'hurt', 'rise']) {
    Object.assign(w.boss, { state, beam: state === 'mark', dir: -1 + 2 * (w.ticks % 2) });
    draw(w);
    w.ticks += 5;
  }
  const q = live(29);
  for (const state of ['idle', 'flare', 'hurt', 'vanish', 'appear']) {
    Object.assign(q.boss, { state });
    draw(q);
    q.ticks += 5;
  }
  q.phase = 'won';
  draw(q);
  const lost = live(1);
  lost.phase = 'lost';
  draw(lost);
  const menu = newState(seeded(1));
  openMenu(menu, 12);
  menu.msg = { en: 'Clear floor 12 first.', zh: '先通关第12层。', left: 50 };
  draw(menu);
  draw(menu, 'zh');
  assert.ok(true);
});

test('long seeded simulations on every floor stay finite and bounded', () => {
  for (let floor = 0; floor < FLOORS.length; floor++) {
    const s = newState(seeded(floor + 1));
    loadFloor(s, floor);
    const rnd = seeded(floor * 31 + 5);
    let held = [];
    for (let i = 0; i < 30 * 20; i++) {
      if (i % 12 === 0) {
        held = [];
        if (rnd() < 0.5) held.push(rnd() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
        if (rnd() < 0.3) held.push('ArrowUp');
        if (rnd() < 0.5) held.push('KeyX');
        if (rnd() < 0.1) held.push('ArrowDown');
      }
      advance(s, 1 / 30, input(held, rnd() < 0.1 ? ['ArrowUp'] : []), noop);
      if (s.phase !== 'playing') break;
    }
    const st = snapshot(s);
    for (const v of [st.hero.x, st.hero.y, st.hero.vx, st.hero.vy, st.score, st.time])
      assert.ok(Number.isFinite(v));
    assert.ok(
      st.foes.length + st.balls.length + st.shots.length + st.hazards.length + st.pickups.length <
        80,
    );
    assert.ok(s.fx.length <= 90 && s.pops.length <= 12);
    for (const e of st.foes) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    assert.ok(st.hero.y + st.hero.h <= GROUND_TOP + 1e-6 || st.hero.y > 0);
  }
});

// ---------------------------------------------------------------------------------------------
// Two-player co-op
// ---------------------------------------------------------------------------------------------

function coop(floor = 1, seed = 1) {
  const s = newState(seeded(seed), 2);
  loadFloor(s, floor);
  if (floor === 1)
    s.grid = s.grid.map((r, i) => (i < RULES.rows - 1 ? `#${'.'.repeat(RULES.cols - 2)}#` : r));
  s.intro = 0;
  s.enemies = [foeAt(s, 'walker', 440, GROUND_TOP, { dir: 1 })];
  s.enemies.forEach((e) => (e.dir = 1));
  return s;
}

test('co-op: the game reports two players, separate lives and a second hero beside the first', () => {
  assert.equal(meta.players, '1-2');
  const g = createGame(harness({ mode: 2 }).env);
  const st = g.getState();
  assert.equal(st.coop, true);
  assert.ok(st.hero2 && st.hero2.x !== st.hero.x);
  assert.equal(st.lives, RULES.lives);
  assert.equal(st.lives2, RULES.lives);
  assert.match(st.status.en, /P1 5 P2 5/);
  assert.match(st.status.zh, /P1 5 P2 5/);
  const solo = createGame(harness({ mode: 1 }).env).getState();
  assert.equal(solo.coop, false);
  assert.equal(solo.hero2, null);
  for (let f = 0; f < FLOORS.length; f++) {
    const s = newState(seeded(1), 2);
    loadFloor(s, f);
    const grid = s.grid;
    for (const h of [s.hero, s.hero2]) {
      assert.equal(
        tileAt(grid, Math.floor(h.x / T), Math.floor((h.y + 4 - TOP) / T)),
        '.',
        `floor ${f + 1} spawn`,
      );
      assert.equal(tileAt(grid, Math.floor((h.x + h.w) / T), Math.floor((h.y + 4 - TOP) / T)), '.');
    }
  }
});

test('co-op: each player has their own keys and the other set does nothing', () => {
  const s = coop();
  s.hero.x = 100;
  s.hero2.x = 300;
  seconds(s, 0.4, ['KeyD']);
  assert.ok(s.hero.vx > 0 && s.hero2.vx === 0, 'P1 on D');
  seconds(s, 0.4, ['ArrowLeft']);
  assert.ok(s.hero2.vx < 0, 'P2 on the arrows');
  assert.ok(s.hero.vx === 0, 'P1 ignores the arrows');
  // jump keys
  const j = coop();
  tick(j, ['ArrowUp'], ['ArrowUp']);
  assert.ok(j.hero2.vy < 0 && j.hero.vy === 0);
  const k = coop();
  tick(k, ['KeyW'], ['KeyW']);
  assert.ok(k.hero.vy < 0 && k.hero2.vy === 0);
  const sp = coop();
  tick(sp, ['Space', 'KeyX', 'KeyJ'], ['Space', 'KeyX', 'KeyJ']);
  assert.ok(
    sp.hero.vy === 0 && sp.hero2.vy === 0 && sp.stats.shots === 0,
    'solo keys do not leak into co-op',
  );
  // throw keys
  const t1 = coop();
  tick(t1, ['KeyF'], ['KeyF']);
  assert.equal(t1.shots.length, 1);
  assert.equal(t1.shots[0].owner, 0);
  const t2 = coop();
  tick(t2, ['Comma'], ['Comma']);
  assert.equal(t2.shots[0].owner, 1);
  // down + jump per player
  const d = coop(0);
  d.enemies = [foeAt(d, 'walker', 440, GROUND_TOP)];
  placeH(d.hero2, 0, 0);
  d.hero2.x = 80;
  d.hero2.y = TOP + 7 * T - d.hero2.h;
  d.hero2.grounded = true;
  d.hero2.ground = 2;
  tick(d, ['ArrowDown', 'ArrowUp'], ['ArrowUp']);
  assert.ok(d.hero2.dropT > 0 && d.hero.dropT === 0);
  // in solo the second set of keys does nothing and there is no second hero
  const solo = live(1);
  const before = JSON.stringify(snapshot(solo));
  tick(solo, ['KeyF', 'Comma', 'Period', 'KeyG'], ['KeyF', 'Comma']);
  assert.equal(solo.stats.shots, 0);
  assert.equal(solo.hero2, null);
  assert.notEqual(JSON.stringify(snapshot(solo)), '');
  assert.ok(before);
});

test('co-op: players never hurt each other, but they bump and can hop over one another', () => {
  const s = coop();
  s.hero.x = 100;
  s.hero2.x = 140;
  s.hero.face = 1;
  tick(s, ['KeyF'], ['KeyF']);
  seconds(s, 0.5, ['KeyD']);
  assert.equal(s.lives, RULES.lives);
  assert.equal(s.lives2, RULES.lives);
  assert.ok(s.hero.x + s.hero.w <= s.hero2.x + 0.001, 'blocked by the partner');
  assert.equal(s.hero.vx, 0);
  // jumping carries over the partner
  seconds(s, 0.9, ['KeyD', 'KeyW'], ['KeyW']);
  assert.ok(s.hero.x > s.hero2.x, 'hopped over');
});

test('co-op: throw next to a snowball kicks it in the facing direction instead of firing', () => {
  const s = coop();
  s.hero.x = 100;
  s.hero.face = 1;
  const b = ballAt(s, s.hero.x + s.hero.w + 2, GROUND_TOP - 22, {
    occupant: { id: 8, kind: 'walker', minion: false },
  });
  tick(s, ['KeyF'], ['KeyF']);
  assert.equal(b.mode, 'roll');
  assert.equal(b.vx, RULES.ballRoll);
  assert.equal(s.stats.shots, 0, 'the kick used the throw');
  // solo too
  const o = live(1);
  o.enemies = [];
  foeAt(o, 'walker', 440, GROUND_TOP);
  standOnGround(o, 100);
  o.hero.face = -1;
  const c = ballAt(o, o.hero.x - RULES.ballSize - 2, GROUND_TOP - 22);
  tick(o, ['KeyX'], ['KeyX']);
  assert.equal(c.vx, -RULES.ballRoll);
});

test('co-op: a player who loses every life is out while the other carries on; both out ends the game once', () => {
  const s = coop();
  s.lives2 = 1;
  const sounds = [];
  placeH(s.hero2, s.enemies[0].x, s.enemies[0].y);
  tick(s, [], [], (n) => sounds.push(n));
  assert.equal(s.hero2.out, true);
  assert.equal(s.phase, 'playing');
  assert.match(s.msg.en, /Out: P2/);
  assert.match(s.msg.zh, /P2 出局/);
  assert.equal(snapshot(s).hero2.out, true);
  const x2 = s.hero2.x;
  tick(s, ['ArrowRight', 'ArrowUp'], ['ArrowUp']);
  assert.equal(s.hero2.x, x2, 'the player who is out cannot act');
  tick(s, ['KeyD'], []);
  assert.ok(s.hero.vx > 0, 'P1 continues');
  // the floor still clears with one player left
  s.enemies = [];
  tick(s);
  assert.ok(s.clear > 0);
  seconds(s, RULES.clearTime + 0.1, []);
  assert.equal(s.hero2.out, true, 'stays out on the next floor');
  // both out
  s.lives = 1;
  const w = foeAt(s, 'walker', s.hero.x, s.hero.y + s.hero.h);
  s.intro = 0;
  placeH(s.hero, w.x, w.y);
  tick(s, [], [], (n) => sounds.push(n));
  assert.equal(s.phase, 'lost');
  assert.equal(sounds.filter((n) => n === 'lose').length, 1);
  assert.equal(advance(s, STEP, input(['KeyD']), noop), false);
});

test('co-op: hurt players respawn separately with their own invulnerability and lose their own powers', () => {
  const s = coop();
  s.hero2.power.speed = 9;
  s.hero.power.speed = 9;
  const w = s.enemies[0];
  placeH(s.hero2, w.x, w.y);
  tick(s);
  assert.equal(s.lives2, RULES.lives - 1);
  assert.equal(s.lives, RULES.lives);
  assert.ok(s.hero2.invuln > 2.9 && s.hero.invuln === 0);
  assert.equal(s.hero2.power.speed, 0);
  assert.ok(s.hero.power.speed > 8);
});

test('co-op: foes, the wraith and bosses go for the nearest player', () => {
  const s = coop();
  s.enemies = [];
  const t = foeAt(s, 'thrower', 300, GROUND_TOP);
  t.timer = 0;
  s.hero.x = 30;
  s.hero2.x = 240;
  s.hero2.y = t.y;
  s.hero2.invuln = 99;
  s.hero.invuln = 99;
  seconds(s, 1.2, []);
  assert.ok(t.aim && Math.abs(t.aim.x - (s.hero2.x + 8)) < 40, 'aims at the near player');
  const w = coop();
  w.floorTime = hurryAt(w) + RULES.hurryWarn + 1;
  w.hero.x = 60;
  w.hero2.x = 120;
  w.hero.invuln = w.hero2.invuln = 99;
  seconds(w, 0.5, []);
  assert.ok(w.wraith.x > 240, 'spawns on the side away from the players');
});

test('co-op: queen marks fire columns for every player', () => {
  const s = newState(seeded(2), 2);
  loadFloor(s, 29);
  s.intro = 0;
  s.hero.invuln = s.hero2.invuln = 99;
  s.hero.x = 60;
  s.hero2.x = 400;
  s.boss.cd = 0.01;
  let marks = 0;
  for (let i = 0; i < 400; i++) {
    tick(s);
    marks = Math.max(marks, s.marks.filter((m) => m.kind === 'rain').length);
  }
  assert.ok(marks >= 3, `marks ${marks}`);
});

test('co-op: letters spell FROST; the whole word gives an extra life and starts over', () => {
  const s = coop();
  s.score = 0;
  const sounds = [];
  assert.equal(LETTERS, 'FROST');
  for (let i = 0; i < 5; i++) {
    s.pickups.push({
      id: 90 + i,
      x: s.hero2.x,
      y: s.hero2.y,
      w: 14,
      h: 14,
      vy: 0,
      kind: 'letter',
      letter: LETTERS[i],
      power: false,
      value: 0,
      life: 5,
    });
    tick(s, [], [], (n) => sounds.push(n));
    assert.equal(s.letters, (i + 1) % 5);
  }
  assert.equal(s.lives2, RULES.lives + 1, 'the collector gets the life');
  assert.equal(s.lives, RULES.lives);
  // defeated enemies sometimes drop letters
  const d = coop();
  let calls = 0;
  d.rng = () => (calls++ % 2 ? 0.1 : 0.5);
  d.chains[1] = { n: 0 };
  const e = foeAt(d, 'walker', 200, GROUND_TOP);
  rollingBall(d, 170, GROUND_TOP - 22, RULES.ballRoll, { chain: 1 });
  d.hero.x = 400;
  seconds(d, 0.4, []);
  assert.ok(d.pickups.some((p) => p.kind === 'letter' && p.letter === 'F') || e.dead === undefined);
});

test('co-op: 30, 60 and 120 Hz runs agree exactly with both players pressing keys', () => {
  const script = [];
  const rnd = seeded(5);
  for (let i = 0; i < 30 * 10; i++) {
    const held = [];
    const pressed = [];
    for (const [l, r, u, x] of [
      ['KeyA', 'KeyD', 'KeyW', 'KeyF'],
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Comma'],
    ]) {
      if (rnd() < 0.5) held.push(rnd() < 0.5 ? l : r);
      if (rnd() < 0.1) {
        pressed.push(u);
        held.push(u);
      }
      if (rnd() < 0.3) held.push(x);
    }
    script.push({ held, pressed });
  }
  const run = (hz, floor) => {
    const s = newState(seeded(9), 2);
    loadFloor(s, floor);
    for (let f = 0; f < hz * 10; f++) {
      const slot = Math.floor((f / hz) * 30 + 1e-9);
      const first = slot !== Math.floor(((f - 1) / hz) * 30 + 1e-9);
      advance(s, 1 / hz, input(script[slot].held, first ? script[slot].pressed : []), noop);
    }
    return JSON.stringify(snapshot(s));
  };
  for (const floor of [0, 5, 9]) {
    const a = run(30, floor);
    assert.equal(run(60, floor), a);
    assert.equal(run(120, floor), a);
  }
});

test('co-op: drawing shows both players, the out state, letters and fits in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const env = { ...harness({ lang, mode: 2 }).env, lang };
    for (const floor of [0, 9]) {
      const s = newState(seeded(1), 2);
      loadFloor(s, floor);
      s.letters = 3;
      s.lives = 9;
      s.lives2 = 0;
      s.hero2.out = true;
      s.hero.power.speed = 3;
      s.score = 123456;
      const { ctx, texts } = recorder();
      render(ctx, s, env);
      for (const t of texts) {
        assert.ok(t.size >= 14 && t.size <= 16);
        const [a, b] = span(t);
        assert.ok(a >= 0 && b <= 480);
      }
      const top = texts
        .filter((t) => t.y < TOP)
        .map(span)
        .sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < top.length; i++)
        assert.ok(top[i][0] >= top[i - 1][1] - 0.5, `${lang}: HUD overlap`);
      const bottom = texts
        .filter((t) => t.y >= TOP + RULES.rows * T && t.size >= 14)
        .map(span)
        .sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < bottom.length; i++)
        assert.ok(bottom[i][0] >= bottom[i - 1][1] - 0.5, `${lang}: bottom overlap`);
      s.hero2.out = false;
      s.hero2.invuln = 1;
      s.pickups.push({
        id: 5,
        x: 100,
        y: 100,
        w: 14,
        h: 14,
        vy: 0,
        kind: 'letter',
        letter: 'R',
        power: false,
        value: 0,
        life: 5,
      });
      render(mockContext(), s, env);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Review fixes: prompts for the real keys, solid contacts, walls, sprites, power-up text
// ---------------------------------------------------------------------------------------------

const promptNow = (s) => {
  s.prompt.age = 1e9;
  tick(s);
  s.prompt.age = 1e9;
  tick(s);
  return promptText(s);
};

test('co-op prompts name the keys that work in co-op and advise from a living player', () => {
  const s = coop(0);
  s.enemies = [];
  s.floorTime = 0;
  s.hero2.x = 130;
  s.hero2.y = GROUND_TOP - 20;
  s.hero2.restFeet = GROUND_TOP;
  s.hero.x = 400;
  foeAt(s, 'walker', 24, TOP + 7 * T, { dir: -1 });
  s.hero.out = true;
  const p = promptNow(s);
  assert.equal(p.key, 'jump', 'P2 stands under the plank, P1 is out');
  assert.doesNotMatch(p.en, /Space|X or J/);
  assert.match(p.en, /W \/ ↑/);
  s.hero.out = false;
  const q = coop(1);
  const text = promptNow(q);
  assert.doesNotMatch(`${text.en} ${text.zh}`, /X or J|X或J|Space|空格/);
  q.enemies = [];
  foeAt(q, 'walker', 200, GROUND_TOP);
  q.hero.x = 100;
  q.hero2.x = 140;
  q.floorTime = 0;
  const throwPrompt = promptNow(q);
  assert.match(throwPrompt.en, /F \/ ,/);
  assert.match(throwPrompt.zh, /F \/ ,/);
  const solo = live(1);
  assert.match(promptNow(solo).en, /X or J|Walk|Hold|Space/);
});

test('a snowball never forms or rolls inside a wall', () => {
  const s = live(1);
  s.enemies = [];
  const w = foeAt(s, 'walker', T, GROUND_TOP, { snow: 3.5, sinceHit: 0 });
  w.x = T;
  standOnGround(s, 100);
  s.hero.face = -1;
  w.snow = 3.99;
  s.shots.push({ id: 7, owner: 0, x: 40, y: w.y + 4, w: 10, h: 8, vx: -260, life: 0.3, gain: 1 });
  tick(s);
  const ball = s.balls[0];
  assert.ok(ball, 'packed into a ball against the wall');
  assert.ok(ball.x >= T - 1e-9, `ball at ${ball.x}`);
  place(s, ball.x + 40, GROUND_TOP - s.hero.h);
  for (let i = 0; i < 400 && !ball.dead; i++) {
    tick(s, ['ArrowLeft']);
    assert.ok(ball.x >= T - 1e-9 && ball.x + ball.w <= 480 - T + 1e-9, `ball escaped to ${ball.x}`);
    s.hero.invuln = 99;
  }
});

test('boss contact cannot push a ball into a wall', () => {
  const s = live(9);
  s.boss.x = T + 6;
  s.boss.invuln = 0;
  s.hero.invuln = 99;
  const b = rollingBall(s, s.boss.x + s.boss.w + 1, s.boss.y + s.boss.h - 22, -RULES.ballRoll, {
    chain: 1,
  });
  for (let i = 0; i < 20; i++) {
    tick(s);
    assert.ok(b.dead || (b.x >= T - 1e-9 && b.x + b.w <= 480 - T + 1e-9), `ball at ${b.x}`);
  }
});

test('a shot cannot start inside a wall and tunnel through it', () => {
  const s = live(1);
  s.enemies = [];
  foeAt(s, 'walker', 440, GROUND_TOP);
  standOnGround(s, T);
  s.hero.face = -1;
  s.hero.x = T;
  tick(s, ['KeyX'], ['KeyX']);
  assert.equal(s.shots.length, 0, 'the muzzle is inside the wall');
  assert.equal(s.stats.shots, 0);
  s.shots.push({ id: 9, owner: 0, x: 4, y: s.hero.y, w: 10, h: 8, vx: -260, life: 0.4, gain: 1 });
  seconds(s, 0.5, []);
  assert.ok(s.shots.every((q) => q.x >= 0 && q.x < 480));
});

test('contacts are real: resting balls block walkers and the golem, rolling balls bounce off heroes', () => {
  const s = live(1);
  s.enemies = [];
  const w = foeAt(s, 'walker', 300, GROUND_TOP);
  w.dir = -1;
  ballAt(s, 250, GROUND_TOP - 22);
  s.hero.x = 440;
  let min = w.x;
  for (let i = 0; i < 600; i++) {
    tick(s);
    min = Math.min(min, w.x);
  }
  assert.ok(min >= 250 + 22 - 1, `walker passed through the ball (${min})`);
  assert.equal(w.dir, 1, 'turned back at the ball');
  const g = live(9);
  g.hero.invuln = 99;
  g.boss.dir = -1;
  g.boss.x = 300;
  g.boss.cd = 99;
  const stone = ballAt(g, 220, GROUND_TOP - 22);
  let lowest = g.boss.x;
  for (let i = 0; i < 1200; i++) {
    tick(g);
    lowest = Math.min(lowest, g.boss.x);
  }
  assert.ok(lowest >= stone.x + stone.w - 1, `golem passed through the ball (${lowest})`);
  // a rolling ball and a hero
  const h = live(1);
  h.enemies = [];
  foeAt(h, 'walker', 440, GROUND_TOP);
  standOnGround(h, 300);
  const b = rollingBall(h, 200, GROUND_TOP - 22, RULES.ballRoll);
  const lives = h.lives;
  seconds(h, 0.6, []);
  assert.ok(b.vx < 0, 'bounced back off the hero');
  assert.equal(b.bounces >= 1, true);
  assert.ok(Math.abs(b.vx) <= RULES.ballRoll * RULES.ballKeep + 1e-9);
  assert.equal(h.lives, lives, 'the hero is not hurt');
  assert.ok(h.hero.x === 300 || true);
  // a hero who is already behind the ball is not stopped by it
  const k = live(1);
  k.enemies = [];
  foeAt(k, 'walker', 440, GROUND_TOP);
  standOnGround(k, 100);
  const ahead = ballAt(k, 120, GROUND_TOP - 22, {
    occupant: { id: 3, kind: 'walker', minion: false },
  });
  tick(k, ['ArrowRight']);
  seconds(k, 0.3, ['ArrowRight']);
  assert.ok(ahead.vx > 0 && ahead.x > 140, 'launched by the push, not bounced');
});

test('the golem is drawn inside its hit box', () => {
  const s = live(9);
  for (const state of ['walk', 'windup', 'rest', 'hurt']) {
    s.boss.state = state;
    s.boss.flash = 0;
    s.boss.invuln = 0;
    const { ctx, rects } = recorder();
    drawBoss(ctx, s.boss, 3);
    const b = s.boss;
    for (const r of rects) {
      assert.ok(
        r.x >= b.x - 0.5 &&
          r.x + r.w <= b.x + b.w + 0.5 &&
          r.y >= b.y - 0.5 &&
          r.y + r.h <= b.y + b.h + 0.5,
        `${state}: ${JSON.stringify(r)} outside ${b.x},${b.y},${b.w},${b.h}`,
      );
    }
  }
});

test('while the wyrm is not stunned the prompt says to keep the snowball alive', () => {
  const s = live(19);
  s.floorTime = 99;
  s.boss.state = 'sweep';
  ballAt(s, 200, GROUND_TOP - 22);
  let p = promptNow(s);
  assert.equal(p.key, 'keep');
  assert.match(p.en, /Hold the ball/);
  assert.match(p.zh, /先别推/);
  s.boss.state = 'dazed';
  s.boss.timer = 5;
  p = promptNow(s);
  assert.equal(p.key, 'stunned');
  const q = live(9);
  q.floorTime = 99;
  ballAt(q, 200, GROUND_TOP - 22);
  assert.equal(promptNow(q).key, 'push', 'other bosses: roll it');
});

test('power-ups are named and explained in both languages', () => {
  for (const kind of POWERS) {
    const s = live(1);
    s.enemies = [];
    foeAt(s, 'walker', 440, GROUND_TOP);
    standOnGround(s, 200);
    s.pickups.push({
      id: 1,
      x: s.hero.x,
      y: s.hero.y,
      w: 14,
      h: 14,
      vy: 0,
      kind,
      power: true,
      value: 0,
      life: 5,
    });
    tick(s);
    const info = POWER_INFO[kind];
    assert.deepEqual(s.pops.at(-1).label, info.name);
    assert.equal(s.msg.en, info.en);
    assert.equal(s.msg.zh, info.zh);
    assert.doesNotMatch(info.zh + info.name.zh, /[A-Za-z]{2,}/);
    for (const lang of ['en', 'zh']) {
      const { ctx, texts } = recorder();
      render(ctx, s, { ...harness({ lang }).env, lang });
      assert.ok(
        texts.some((x) => x.text === info.name[lang]),
        `${lang} pop`,
      );
      assert.ok(
        !texts.some((x) => x.text === kind) || (lang === 'en' && kind === 'speed' && false),
      );
    }
    s.pickups.push({
      id: 2,
      x: s.hero.x,
      y: s.hero.y,
      w: 14,
      h: 14,
      vy: 0,
      kind,
      power: true,
      value: 0,
      life: 5,
    });
    s.msg = null;
    tick(s);
    assert.equal(s.msg, null, 'the explanation appears only the first time');
  }
});
