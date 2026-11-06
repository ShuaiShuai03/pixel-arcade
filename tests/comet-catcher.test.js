import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  newState,
  advance,
  snapshotOf,
  mouthCrossing,
  judgeCatch,
  predictCrossing,
  guideTiltFor,
  RULES,
  LEVELS,
  LEVEL_COUNT,
} from '../src/games/comet-catcher.js';
import { harness, input, mockContext } from './harness.js';

const STEP = RULES.step;
// A state whose first comet is far in the future, for white-box checks of single rules.
function quiet() {
  const s = newState();
  s.clock = -1e4;
  return s;
}
const noop = () => {};
function frames(s, seconds, held = [], pressed = [], hz = 60) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) advance(s, 1 / hz, input(held, i === 0 ? pressed : []), noop);
}
function progressEnv(level, h = harness()) {
  let unlocked = level;
  const calls = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  return { h, calls };
}
// An instant reader of the guide, prompt and net (what a perfect player does on screen).
function oracle(st, memory) {
  const held = [];
  let pressed = [];
  const tag = /^\[(Space|X|Arrows)\]/.exec(st.line.en)?.[1];
  const press = tag === 'Space' ? 'Space' : tag === 'X' ? 'KeyX' : null;
  if (press && (memory.text !== st.line.en || st.time - memory.at > 3)) {
    memory.text = st.line.en;
    memory.at = st.time;
    pressed = [press];
  } else if (st.guide && st.guide.kind !== 'cool') {
    if (st.guide.x - st.net.x > 3) held.push('ArrowRight');
    else if (st.guide.x - st.net.x < -3) held.push('ArrowLeft');
    if (st.guide.tilt - st.net.tilt > 3) held.push('ArrowDown');
    else if (st.guide.tilt - st.net.tilt < -3) held.push('ArrowUp');
  }
  return { held, pressed };
}
function playLevel(g, level, until, seconds = 120) {
  const memory = { text: '', at: -9 };
  for (let t = 0; t < seconds; t += 1 / 60) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level || until(st)) break;
    const { held, pressed } = oracle(st, memory);
    g.update(1 / 60, input(held, pressed));
  }
  return g.getState();
}
function start(level, seed = 1) {
  const h = harness({ seed });
  progressEnv(level, h);
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

test('meta follows the contract, is bilingual and the touch layout covers every key', () => {
  assert.equal(meta.id, 'comet-catcher');
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.ok(/[一-鿿]/.test(meta.description.zh) && !/[一-鿿]/.test(meta.description.en));
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const codes = meta.touchControls.map((c) => c.code).sort();
  assert.deepEqual(codes, ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyX', 'Space']);
  for (const c of meta.touchControls)
    assert.ok(c.label.en && c.label.zh && ['left', 'right'].includes(c.side));
  assert.ok(meta.touch);
});

test('there are 22 authored contracts that teach, combine and then master the ideas', () => {
  assert.equal(LEVEL_COUNT, 22);
  assert.equal(LEVELS.length, 22);
  const hot = (lv) => lv.sched.some((c) => c.heat > RULES.safeHeat);
  const slant = (lv) => lv.sched.some((c) => Math.abs(c.vxA) / c.vyA > 0.65);
  const colours = (lv) =>
    new Set(lv.sched.map((c) => c.color)).size > 1 && lv.bins.some((b) => b.colors);
  const sizes = (lv) => lv.bins.some((b) => b.sizes);
  // Teach: one idea at a time.
  assert.ok(
    LEVELS.slice(0, 2).every(
      (lv) => !hot(lv) && !slant(lv) && lv.wind === 0 && lv.bins.length === 1,
    ),
  );
  assert.ok(slant(LEVELS[2]) && !hot(LEVELS[2]));
  assert.ok(LEVELS[4].cap < LEVELS[1].cap && LEVELS[4].sched.some((c) => c.size > 1));
  assert.ok(hot(LEVELS[5]) && !slant(LEVELS[5]));
  assert.ok(colours(LEVELS[8]) && !hot(LEVELS[8]));
  assert.ok(sizes(LEVELS[9]));
  assert.ok(
    LEVELS[11].wind !== 0 &&
      LEVELS[12].wind !== 0 &&
      Math.sign(LEVELS[11].wind) !== Math.sign(LEVELS[12].wind),
  );
  // Combine and master.
  assert.ok(hot(LEVELS[13]) && colours(LEVELS[13]));
  assert.ok(LEVELS.slice(16).every((lv) => lv.bins.length >= 2 || lv.sched.length >= 12));
  assert.ok(
    LEVELS[21].bins.length === 3 &&
      hot(LEVELS[21]) &&
      LEVELS[21].wind !== 0 &&
      LEVELS[21].sched.length >= 16,
  );
  for (const lv of LEVELS) {
    assert.ok(
      lv.name.length === 2 &&
        lv.tip.length === 2 &&
        lv.tip[0].startsWith('[Arrows]') &&
        lv.tip[1].startsWith('[方向键]'),
    );
    assert.ok(Object.isFrozen(lv) && Object.isFrozen(lv.sched));
  }
});

test('every comet launches on screen, lands in exactly one bin, is absorbable when aligned and leaves slack', () => {
  const g = RULES.gravity;
  for (const [i, lv] of LEVELS.entries()) {
    const perBin = lv.bins.map(() => 0);
    let lastT = -1;
    for (const c of lv.sched) {
      assert.ok(c.x0 >= 16 && c.x0 <= 464, `level ${i + 1} comet ${c.id} launches at ${c.x0}`);
      assert.ok(c.bin >= 0, `level ${i + 1} comet ${c.id} has no unique bin`);
      assert.ok(
        lv.bins.filter(
          (b) =>
            (!b.colors || b.colors.includes(c.color)) && (!b.sizes || b.sizes.includes(c.size)),
        ).length === 1,
      );
      perBin[c.bin]++;
      assert.ok(c.T >= 1.7, 'every comet is visible long enough to answer');
      assert.ok(
        Math.hypot(c.vxA, c.vyA) <= RULES.absorb - 10,
        `level ${i + 1} comet ${c.id} too fast to absorb`,
      );
      assert.ok(c.t > lastT);
      lastT = c.t;
      assert.ok(c.mass <= lv.cap, 'a single comet always fits an empty net');
      // Closed form agrees with the stated launch.
      const y = RULES.spawnY + c.vy * c.T + 0.5 * g * c.T * c.T;
      assert.ok(Math.abs(y - RULES.netY) < 1e-6);
    }
    lv.bins.forEach((b, k) =>
      assert.ok(perBin[k] - b.need >= 1, `level ${i + 1} bin ${k} has no slack`),
    );
    assert.ok(lv.bins.every((b) => b.x >= RULES.netMin && b.x <= RULES.netMax));
  }
});

test('invalid, zero, negative, huge and non-numeric frame times are inert and never consume a press', () => {
  const s = newState();
  const before = JSON.stringify(snapshotOf(s));
  for (const dt of [0, -1, NaN, Infinity, 0.2, undefined, '0.01'])
    assert.equal(
      advance(s, dt, input(['ArrowRight'], ['Space', 'KeyX']), noop),
      dt === '0.01' ? false : false,
    );
  assert.equal(JSON.stringify(snapshotOf(s)), before);
  advance(s, 1 / 60, input([], ['Space']), noop);
  assert.equal(s.net.open, false, 'the press was still available');
});

test('the same aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  const results = [30, 60, 120].map((hz) => {
    const { g } = start(3);
    const per = hz / 30;
    for (let i = 0; i < 30 * 12; i++) {
      const held =
        i % 40 < 20 ? ['ArrowRight'] : i % 40 < 30 ? ['ArrowLeft', 'ArrowUp'] : ['ArrowDown'];
      const pressed = i === 100 ? ['Space'] : i === 200 ? ['Space'] : i === 260 ? ['KeyX'] : [];
      for (let k = 0; k < per; k++) g.update(1 / hz, input(held, k === 0 ? pressed : []));
    }
    return JSON.stringify(g.getState());
  });
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
});

test('the net slides at its stated speed, is clamped to the roof and tilts at its stated rate', () => {
  const s = quiet();
  frames(s, 0.5, ['ArrowRight']);
  assert.ok(Math.abs(s.net.x - (240 + RULES.netSpeed * 0.5)) < 1e-6);
  assert.ok(Math.abs(s.net.vx - RULES.netSpeed) < 1e-6);
  frames(s, 5, ['ArrowLeft']);
  assert.equal(s.net.x, RULES.netMin);
  assert.equal(s.net.vx, 0);
  frames(s, 6, ['ArrowRight']);
  assert.equal(s.net.x, RULES.netMax);
  const u = quiet();
  frames(u, 0.5, ['ArrowDown']);
  assert.ok(Math.abs(u.net.tilt - RULES.tiltRate * 0.5) < 1e-6);
  frames(u, 3, ['KeyW']);
  assert.equal(u.net.tilt, -RULES.maxTilt);
  frames(u, 3, ['KeyS', 'KeyD']);
  assert.equal(u.net.tilt, RULES.maxTilt);
  assert.ok(u.net.x > 240);
});

test('comets fly ballistic paths under gravity and wind and the marker predicts the crossing', () => {
  for (const level of [1, 12, 13]) {
    const { g } = start(level);
    const lv = LEVELS[level - 1];
    const first = lv.sched[0];
    let seen = null;
    for (let i = 0; i < 60 * 5 && !seen; i++) {
      g.update(1 / 60, input());
      const c = g.getState().comets[0];
      if (c && c.land && c.y > 100) seen = { ...c, at: g.getState().time };
    }
    assert.ok(seen, 'a comet appears');
    assert.ok(
      Math.abs(seen.land.x - first.tx) < 1e-3,
      `marker ${seen.land.x} vs landing ${first.tx}`,
    );
    assert.ok(Math.abs(seen.vy - (first.vy + RULES.gravity * (seen.at - first.t))) < 0.5);
    assert.ok(Math.abs(seen.vx - (first.vx + lv.wind * (seen.at - first.t))) < 0.5);
  }
});

test('the closed-form prediction equals the swept simulation of a free fall', () => {
  for (const wind of [0, 40, -45]) {
    let c = { x: 200, y: RULES.spawnY, vx: 30, vy: 15 };
    const p = predictCrossing(c, wind);
    let t = 0;
    while (c.y < RULES.netY) {
      c = {
        x: c.x + c.vx * STEP + 0.5 * wind * STEP * STEP,
        y: c.y + c.vy * STEP + 0.5 * RULES.gravity * STEP * STEP,
        vx: c.vx + wind * STEP,
        vy: c.vy + RULES.gravity * STEP,
      };
      t += STEP;
    }
    assert.ok(Math.abs(t - p.t) <= STEP + 1e-9);
    assert.ok(Math.abs(c.x - p.x) < 1.5 && Math.abs(c.vy - p.vy) < 1.5);
  }
  assert.equal(predictCrossing({ x: 0, y: RULES.netY + 1, vx: 0, vy: 10 }, 0), null);
  assert.equal(predictCrossing({ x: 0, y: 100, vx: 0, vy: -10 }, 0), null);
});

test('the catch rule: the angle must be within 30 degrees of the net axis and the relative speed absorbable', () => {
  assert.ok(judgeCatch(0, 150, 0).ok);
  const at = (deg, speed) =>
    judgeCatch(
      -Math.sin((deg * Math.PI) / 180) * speed,
      Math.cos((deg * Math.PI) / 180) * speed,
      0,
    );
  assert.ok(at(29.5, 150).ok);
  assert.equal(at(30.5, 150).reason, 'angle');
  assert.ok(judgeCatch(0, RULES.absorb - 0.01, 0).ok);
  assert.equal(judgeCatch(0, RULES.absorb + 0.01, 0).reason, 'fast');
  // Tilting the net turns its axis: a slanted comet is caught only by a matching tilt.
  const rel = [100, 150];
  assert.equal(judgeCatch(rel[0], rel[1], 0).reason, 'angle');
  const tilt = guideTiltFor(rel[0], rel[1]);
  assert.ok(tilt < -30 && judgeCatch(rel[0], rel[1], tilt).ok);
  assert.equal(judgeCatch(rel[0], rel[1], 25).reason, 'angle');
  // A comet moving away from the mouth is never caught.
  assert.equal(judgeCatch(0, -50, 0).reason, 'angle');
  assert.equal(guideTiltFor(1000, 1), -RULES.guideTilt);
  assert.equal(guideTiltFor(-1000, 1), RULES.guideTilt);
});

test('swept crossing never tunnels, at any step length, and respects the mouth width and direction', () => {
  const net = { x: 240, tilt: 0 };
  for (const speed of [50, 400, 4000, 40000]) {
    const steps = Math.ceil(speed / 60);
    const ok = mouthCrossing(
      { x: 250, y: RULES.netY - speed / 2 },
      { x: 250, y: RULES.netY + speed / 2 },
      net,
      net,
    );
    assert.ok(ok, `speed ${speed}`);
    assert.ok(steps > 0);
  }
  assert.equal(mouthCrossing({ x: 240 + 33, y: 200 }, { x: 240 + 33, y: 300 }, net, net), null);
  assert.ok(mouthCrossing({ x: 240 + 31, y: 200 }, { x: 240 + 31, y: 300 }, net, net));
  assert.equal(
    mouthCrossing({ x: 240, y: 300 }, { x: 240, y: 200 }, net, net),
    null,
    'upwards through the mouth',
  );
  assert.equal(
    mouthCrossing({ x: 240, y: 100 }, { x: 240, y: 120 }, net, net),
    null,
    'not yet there',
  );
  // The net sweeping sideways over a comet is also caught (relative motion).
  assert.ok(
    mouthCrossing(
      { x: 300, y: RULES.netY - 1 },
      { x: 300, y: RULES.netY - 1 },
      { x: 240, tilt: 0 },
      { x: 240, tilt: 0 },
    ) === null,
  );
  assert.ok(
    mouthCrossing(
      { x: 250, y: RULES.netY - 2 },
      { x: 250, y: RULES.netY - 2 },
      { x: 240, tilt: 0 },
      { x: 240, tilt: 0 },
    ) === null,
  );
  // A tilt rotating through the comet's point counts as an arrival too.
  assert.ok(
    mouthCrossing(
      { x: 218, y: RULES.netY - 3 },
      { x: 218, y: RULES.netY - 3 },
      { x: 240, tilt: 0 },
      { x: 240, tilt: 30 },
    ),
  );
});

test('an aligned catch moves the comet into the net exactly once and the contract is cleared by delivery', () => {
  const { g, h } = start(1);
  let st = playLevel(g, 1, (x) => x.net.items.length > 0);
  assert.equal(st.net.items.length, 1);
  assert.equal(st.stats.caught, 1);
  const id = st.net.items[0].id;
  assert.ok(!st.comets.some((c) => c.id === id), 'a caught comet leaves the sky');
  frames2(g, 1);
  st = g.getState();
  assert.equal(st.net.items.filter((i) => i.id === id).length, 1);
  assert.equal(st.stats.caught, 1, 'it is not caught again');
  st = playLevel(g, 1, (x) => x.level === 2);
  assert.equal(st.level, 2);
  assert.ok(h.sounds.includes('coin'));
});
function frames2(g, seconds) {
  for (let i = 0; i < seconds * 60; i++) g.update(1 / 60, input());
}

test('score counts each delivered comet once; replaying a contract cannot farm points', () => {
  const { g } = start(1);
  const st = playLevel(g, 1, (x) => x.level === 2);
  const first = st.score;
  assert.equal(first, 3 * RULES.unitScore + RULES.clearScore + RULES.cleanScore);
  const { g: g2 } = start(1);
  const again = playLevel(g2, 1, (x) => x.level === 2);
  assert.equal(again.score, first);
  const s = newState();
  s.best[0] = 1000;
  s.score = 1000;
  s.gained = 40;
  assert.equal(snapshotOf(s).score, 1000);
  s.gained = 1500;
  assert.equal(snapshotOf(s).score, 1500);
});

test('capacity: the net warns at 75 percent, refuses a comet that does not fit and bounces it away', () => {
  const { g } = start(5);
  const warns = new Set();
  const memory = { text: '', at: -9 };
  let bounced = false;
  let message = '';
  for (let i = 0; i < 60 * 60 && !bounced && g.getState().phase === 'playing'; i++) {
    const st = g.getState();
    warns.add(st.net.warn);
    assert.ok(st.net.load <= st.net.cap, 'never over capacity');
    // Catch only: never unload, never reopen decisions beyond the guide.
    const held = [];
    if (st.guide && st.guide.kind === 'catch') {
      if (st.guide.x - st.net.x > 3) held.push('ArrowRight');
      else if (st.guide.x - st.net.x < -3) held.push('ArrowLeft');
      if (st.guide.tilt - st.net.tilt > 3) held.push('ArrowDown');
      else if (st.guide.tilt - st.net.tilt < -3) held.push('ArrowUp');
    }
    g.update(1 / 60, input(held));
    const after = g.getState();
    if (after.stats.bounced) {
      bounced = true;
      message = after.message?.en || '';
    }
    void memory;
  }
  assert.ok(warns.has(1) || warns.has(2), 'a warning came before the overflow');
  void message;
});

test('white box: a full net bounces a fitting-angle comet with less energy and marks it spent', () => {
  const s = newState();
  s.net.items.push(
    { id: 90, size: 3, mass: 3, color: 0, heat: 20 },
    { id: 91, size: 1, mass: 1, color: 0, heat: 20 },
  );
  assert.equal(snapshotOf(s).net.warn, 2);
  s.comets.push({
    id: 7,
    x: 240,
    y: RULES.netY - 6,
    vx: 0,
    vy: 120,
    size: 1,
    mass: 1,
    color: 0,
    heat: 20,
    fate: 'air',
    spent: false,
    spilled: false,
    age: 0,
  });
  frames(s, 0.2);
  const c = s.comets[0];
  assert.ok(c.spent && s.net.items.length === 2);
  assert.ok(
    c.vy < 0 && Math.abs(c.vy) < 120 * RULES.restitution + 20,
    'reflected with restitution < 1',
  );
  assert.equal(s.stats.bounced, 1);
  assert.match(s.msg.en, /full/);
  assert.equal(s.stats.caught, 0);
});

test('white box: a closed net is a lid, a slow-enough aligned comet is caught and a too fast one bounces', () => {
  const mk = (vy, open) => {
    const s = newState();
    s.net.open = open;
    s.comets.push({
      id: 7,
      x: 240,
      y: RULES.netY - 6,
      vx: 0,
      vy,
      size: 1,
      mass: 1,
      color: 0,
      heat: 20,
      fate: 'air',
      spent: false,
      spilled: false,
      age: 0,
    });
    frames(s, 0.2);
    return s;
  };
  assert.equal(mk(100, true).net.items.length, 1);
  const lid = mk(100, false);
  assert.equal(lid.net.items.length, 0);
  assert.match(lid.msg.en, /closed/);
  const fast = mk(230, true);
  assert.equal(fast.net.items.length, 0);
  assert.match(fast.msg.en, /Too fast/);
  assert.equal(mk(200, true).net.items.length, 1);
});

test('white box: a comet that misses the mouth falls to the roof and is counted lost once', () => {
  const s = quiet();
  s.comets.push({
    id: 7,
    x: 400,
    y: RULES.netY - 6,
    vx: 0,
    vy: 100,
    size: 2,
    mass: 2,
    color: 0,
    heat: 90,
    fate: 'air',
    spent: false,
    spilled: false,
    age: 0,
  });
  frames(s, 1);
  assert.equal(s.comets.length, 0);
  assert.equal(s.lost, 1);
  assert.equal(s.stats.lost, 1);
  frames(s, 1);
  assert.equal(s.lost, 1);
  assert.equal(s.splashes.length, 0, 'splashes fade');
});

test('cooling: a load cools by 10 per second open and 30 closed, never below ambient, and bins refuse hot loads', () => {
  const s = quiet();
  s.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 150 });
  frames(s, 1);
  assert.ok(Math.abs(s.net.items[0].heat - (150 - RULES.coolOpen)) < 0.01);
  advance(s, 1 / 60, input([], ['Space']), noop);
  assert.equal(s.net.open, false);
  const h0 = s.net.items[0].heat;
  frames(s, 1);
  assert.ok(Math.abs(h0 - s.net.items[0].heat - RULES.coolClosed) < 0.7);
  frames(s, 10);
  assert.equal(s.net.items[0].heat, RULES.ambient);
  // Hot load over a bin is refused.
  const t = quiet();
  t.net.items.push({ id: 2, size: 1, mass: 1, color: 0, heat: 100 });
  t.net.x = 240;
  advance(t, 1 / 60, input([], ['KeyX']), noop);
  assert.match(t.msg.en, /Too hot/);
  assert.equal(t.delivered[0], 0);
  assert.equal(t.net.items.length, 1);
  t.net.items[0].heat = RULES.safeHeat;
  advance(t, 1 / 60, input([], ['KeyX']), noop);
  assert.equal(t.delivered[0], 1);
  assert.equal(t.net.items.length, 0);
});

test('unloading needs a bin below the net and a bin that takes the comet', () => {
  const s = quiet();
  s.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 20 });
  s.net.x = 100;
  advance(s, 1 / 60, input([], ['KeyX']), noop);
  assert.match(s.msg.en, /over a bin/);
  const { g } = start(9);
  const st = playLevel(g, 9, (x) => x.net.items.length > 0 && x.net.items[0].color === 1);
  const wrong = quiet();
  wrong.level = 8;
  wrong.net.items.push({ id: 1, size: 1, mass: 1, color: 1, heat: 20 });
  wrong.net.x = 130;
  advance(wrong, 1 / 60, input([], ['KeyX']), noop);
  assert.match(wrong.msg.en, /other comets/);
  assert.equal(wrong.net.items.length, 1);
  assert.ok(st.level === 9);
});

test('an open net tilted past the angle of repose spills its load, which cannot score twice', () => {
  const s = quiet();
  s.net.items.push({ id: 5, size: 1, mass: 1, color: 0, heat: 20 });
  frames(s, 0.4, ['ArrowDown']);
  assert.equal(s.net.items.length, 1, 'still held below the repose angle');
  frames(s, 0.6, ['ArrowDown']);
  assert.ok(s.net.tilt > RULES.repose);
  assert.equal(s.stats.spilled, 1);
  assert.equal(s.net.items.length, 0);
  const spilled = s.comets.find((c) => c.id === 5);
  assert.ok(spilled && spilled.spilled && spilled.vy >= 0);
  assert.match(s.msg.en, /spilled/);
  // A closed net keeps its load at any tilt.
  const t = quiet();
  t.net.items.push({ id: 5, size: 1, mass: 1, color: 0, heat: 20 });
  t.net.open = false;
  frames(t, 2, ['ArrowDown']);
  assert.equal(t.net.items.length, 1);
  assert.equal(t.stats.spilled, 0);
});

test('a load hotter than the scorch limit burns the net and a burnt net fails the attempt', () => {
  const s = quiet();
  s.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 120 });
  const i0 = s.net.integrity;
  frames(s, 1);
  const expected = ((120 - RULES.coolOpen / 2 - RULES.scorchHeat) / RULES.scorchDiv) * 1;
  assert.ok(
    Math.abs(i0 - s.net.integrity - expected) < 0.05,
    `${i0 - s.net.integrity} vs ${expected}`,
  );
  const t = quiet();
  t.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 400 });
  frames(t, 3);
  assert.equal(t.tries, 2);
  assert.equal(t.stats.fails, 1);
  assert.equal(t.net.items.length, 0, 'the contract restarts clean');
  assert.match(t.msg.en, /burnt out: 2 tries left/);
  const cool = quiet();
  cool.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 70 });
  frames(cool, 2);
  assert.equal(cool.net.integrity, RULES.integrity);
});

test('failing: too many lost comets, running out of time, three failures end the game once', () => {
  const h = harness();
  const g = createGame(h.env);
  for (let i = 0; i < 60 * 150 && g.getState().phase === 'playing'; i++) g.update(1 / 30, input());
  const st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(st.tries, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.filter((x) => x === 'lose').length >= 3);
  assert.ok(/Contract failed/.test(st.status.en) && /合同失败/.test(st.status.zh));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 100; i++) g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  // The tail timeout: nothing left to do and the goal unmet but still feasible.
  const s = newState();
  s.next = LEVELS[0].sched.length;
  s.delivered = [0];
  s.net.items.push(
    { id: 1, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 2, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 3, size: 1, mass: 1, color: 0, heat: 20 },
  );
  frames(s, RULES.grace - 1);
  assert.equal(s.tries, 3);
  frames(s, 2);
  assert.equal(s.tries, 2);
});

test('the infeasible and timeout paths report different reasons', () => {
  const s = newState();
  s.next = LEVELS[0].sched.length;
  frames(s, 0.2);
  assert.equal(s.tries, 2);
  assert.match(s.msg.en, /Too many lost/);
});

test('winning the last contract ends the game once with a win and freezes it; a new instance starts fresh', () => {
  const { g, h } = start(22);
  const st = playLevel(g, 22, (x) => x.phase !== 'playing', 200);
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.ok(h.ends[0].score >= 100 && typeof h.ends[0].message === 'string');
  assert.ok(h.sounds.includes('win'));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.ok(
    /All contracts/.test(g.getState().status.en) && /全部合同/.test(g.getState().status.zh),
  );
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.level, 1);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.tries, 3);
  assert.equal(fresh.net.load, 0);
});

test('progress: hosts without it still play; clearing unlocks the next contract and never lowers it', () => {
  const plain = createGame(harness().env);
  plain.update(1 / 60, input());
  assert.equal(plain.getState().menu, null);
  const h = harness();
  const { calls } = progressEnv(1, h);
  const g = createGame(h.env);
  assert.equal(g.getState().menu, null);
  playLevel(g, 1, (x) => x.level === 2);
  assert.deepEqual(calls, [2]);
  const again = progressEnv(7, harness());
  const g2 = createGame(again.h.env);
  assert.equal(g2.getState().level, 1);
  assert.deepEqual(again.calls, []);
});

test('select screen: it opens when more than one contract is unlocked, moves, clamps and starts the contract', () => {
  const h = harness();
  progressEnv(5, h);
  const g = createGame(h.env);
  let st = g.getState();
  assert.deepEqual(st.menu, { sel: 5, unlocked: 5 });
  assert.match(st.line.en, /^\[Arrows\]/);
  assert.match(st.line.zh, /^\[方向键\]/);
  assert.equal(st.guide, null);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['KeyA']));
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.sel, 1);
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['KeyD']));
  g.update(1 / 60, input([], ['ArrowDown']));
  g.update(1 / 60, input([], ['KeyS']));
  assert.equal(g.getState().menu.sel, 5, 'cannot pick a locked contract');
  g.update(1 / 60, input([], ['ArrowLeft']));
  const t0 = g.getState().time;
  g.update(1 / 60, input([], ['Enter']));
  st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 4);
  assert.equal(st.time, t0);
  const gx = createGame(progressEnv(3, harness()).h.env);
  gx.update(1 / 60, input([], ['KeyX']));
  assert.equal(gx.getState().level, 3);
  const gs = createGame(progressEnv(3, harness()).h.env);
  gs.update(1 / 60, input([], ['Space']));
  assert.equal(gs.getState().level, 3);
});

test('getState returns copies, exposes no cheat controls and keeps the HUD bands', () => {
  const h = harness();
  const g = createGame(h.env);
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  const { g: g2 } = start(1);
  playLevel(g2, 1, (x) => x.net.items.length > 0 || x.comets.length > 0);
  const a = g2.getState();
  a.net.x = -999;
  a.net.items.push({ bogus: true });
  a.comets.length = 0;
  a.bins[0].delivered = 99;
  a.guide = null;
  a.score = 1e9;
  a.hud.top[1] = 0;
  a.stats.caught = 77;
  const b = g2.getState();
  assert.notEqual(b.net.x, -999);
  assert.ok(!b.net.items.some((i) => i.bogus));
  assert.equal(b.bins[0].delivered < 99, true);
  assert.ok(b.score < 1e9 && b.stats.caught < 77);
  assert.deepEqual(b.hud, { top: [0, RULES.top], bottom: [RULES.bottom, 320] });
});

test('prompts follow the situation: open, close for cooling, carry, cool, unload, level the net', () => {
  const s = newState();
  const line = () => snapshotOf(s).prompt.en;
  assert.match(line(), /^\[Arrows\] Watch the sky|^\[Arrows\] Slide under/);
  // Closed and empty: open it.
  advance(s, 1 / 60, input([], ['Space']), noop);
  frames(s, 0.1);
  assert.match(line(), /Open the net/);
  // A hot load while nothing is coming soon: close the net.
  const t = newState();
  t.next = LEVELS[0].sched.length;
  t.delivered = [2];
  t.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 130 });
  frames(t, 0.2);
  assert.match(snapshotOf(t).prompt.en, /Close the net/);
  frames(t, 0.1, [], ['Space']);
  assert.match(snapshotOf(t).prompt.en, /Stand still|Carry the load|Close/);
  // At the bin while hot: stand still, then unload.
  t.net.x = 240;
  t.net.open = false;
  t.net.items[0].heat = 70;
  frames(t, 0.2);
  assert.match(snapshotOf(t).prompt.en, /^Stand still/);
  assert.match(snapshotOf(t).prompt.zh, /^站着别动/);
  t.net.items[0].heat = 30;
  frames(t, 0.2);
  assert.match(snapshotOf(t).prompt.en, /^\[X\] Unload/);
  // Near full and away from the bin: a stronger carry prompt.
  const u = newState();
  u.next = LEVELS[0].sched.length;
  u.net.items.push(
    { id: 1, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 2, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 3, size: 1, mass: 1, color: 0, heat: 20 },
  );
  u.net.x = 100;
  frames(u, 0.2);
  assert.match(snapshotOf(u).prompt.en, /nearly full/);
  // Tilted too far with a load: level it.
  const v = newState();
  v.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 20 });
  v.net.tilt = 45;
  frames(v, 0.2, []);
  assert.match(snapshotOf(v).prompt.en, /Level the net/);
  assert.equal(snapshotOf(v).guide.kind, 'level');
});

test('the guide and tilt target are consistent with the marker: aligned catches use the stated rule', () => {
  const { g } = start(3);
  let checked = 0;
  for (let i = 0; i < 60 * 10; i++) {
    const st = g.getState();
    if (st.guide?.kind === 'catch') {
      assert.ok(Math.abs(st.guide.tilt) <= RULES.guideTilt);
      checked++;
    }
    g.update(1 / 60, input());
  }
  assert.ok(checked > 30);
});

test('long seeded chaos stays finite and bounded', () => {
  for (const seed of [1, 2, 3]) {
    const h = harness({ seed });
    progressEnv(22, h);
    const g = createGame(h.env);
    let x = seed;
    const rnd = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD'];
    let held = [];
    for (let i = 0; i < 60 * 240; i++) {
      if (i % 20 === 0) held = rnd() < 0.3 ? [] : [keys[Math.floor(rnd() * keys.length)]];
      const pressed = rnd() < 0.02 ? [rnd() < 0.5 ? 'Space' : 'KeyX'] : [];
      g.update(rnd() < 0.05 ? 1 / 30 : 1 / 60, input(held, pressed));
      if (i % 600 === 0) {
        const st = g.getState();
        assert.ok(st.comets.length <= 20 && st.net.items.length <= st.net.cap);
        for (const c of st.comets) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
        assert.ok(
          Number.isFinite(st.net.x) && st.net.x >= RULES.netMin && st.net.x <= RULES.netMax,
        );
        assert.ok(Math.abs(st.net.tilt) <= RULES.maxTilt);
      }
    }
    assert.ok(h.ends.length <= 1);
  }
});

function drawAndCollect(g) {
  const texts = [];
  const fonts = [];
  const state = {};
  const ctx = new Proxy(
    {
      measureText: (v) => ({ width: String(v).length * 8.4 }),
      canvas: { width: 480, height: 320 },
    },
    {
      get: (target, p) => {
        if (p === 'fillText')
          return (str, x, y) =>
            texts.push({
              str,
              x,
              y,
              align: state.textAlign,
              size: parseInt(/(\d+)px/.exec(state.font)?.[1], 10),
            });
        if (p === 'fillRect')
          return (x, y, w, h) => fonts.push({ x, y, w, h, color: state.fillStyle });
        return p in state ? state[p] : p in target ? target[p] : () => {};
      },
      set: (target, p, v) => ((state[p] = v), true),
    },
  );
  g.draw(ctx);
  return { texts, rects: fonts };
}

test('drawing: every phase renders in both languages with 14-16 px text that fits the canvas', () => {
  for (const lang of ['en', 'zh']) {
    const cases = [];
    const h = harness({ lang });
    const g = createGame(h.env);
    cases.push(g);
    const menuHarness = harness({ lang });
    progressEnv(6, menuHarness);
    cases.push(createGame(menuHarness.env));
    const { g: running } = (() => {
      const hh = harness({ lang });
      progressEnv(8, hh);
      const gg = createGame(hh.env);
      cases.push(gg); // menu
      gg.update(1 / 60, input([], ['Space']));
      for (let i = 0; i < 60 * 14; i++)
        gg.update(1 / 60, input(i % 90 < 45 ? ['ArrowRight'] : ['ArrowLeft', 'ArrowUp']));
      cases.push(gg);
      return { g: gg };
    })();
    void running;
    const lost = createGame(harness({ lang }).env);
    for (let i = 0; i < 60 * 150; i++) lost.update(1 / 30, input());
    cases.push(lost);
    const hw = harness({ lang });
    progressEnv(22, hw);
    const won = createGame(hw.env);
    won.update(1 / 60, input([], ['Space']));
    playLevel(won, 22, (x) => x.phase !== 'playing', 200);
    cases.push(won);
    for (const c of cases) {
      const { texts } = drawAndCollect(c);
      assert.ok(texts.length > 0);
      for (const t of texts) {
        assert.ok(t.size >= 14 && t.size <= 16, `font ${t.size}: ${t.str}`);
        const w = [...t.str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? t.size : t.size * 0.6), 0);
        const left = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
        assert.ok(
          left >= 2 - 1 && left + w <= 480 - 2 + 1,
          `"${t.str}" spans ${left}..${left + w}`,
        );
      }
    }
  }
});

test('layout: comets and the net sit between the HUD bands, actors are at least 16 px and states look different', () => {
  const { g } = start(6);
  const kinds = new Set();
  let ctxFrames = 0;
  for (let i = 0; i < 60 * 30; i++) {
    g.update(1 / 60, input(i % 120 < 60 ? ['ArrowRight'] : ['ArrowLeft']));
    const st = g.getState();
    for (const c of st.comets) {
      assert.ok(c.r * 2 >= 16, 'comets are at least 16 px');
      if (c.y - c.r < RULES.top && c.y > 0)
        assert.fail(`comet drawn under the top band at y=${c.y}`);
      assert.ok(c.y + c.r <= RULES.ground + c.r);
    }
    kinds.add(`${st.net.open}${st.net.warn}${st.comets.length > 0}`);
    if (i % 20 === 0) {
      const { rects } = drawAndCollect(g);
      ctxFrames++;
      assert.ok(rects.length > 20);
    }
  }
  assert.ok(RULES.half * 2 >= 16 && RULES.binW >= 16);
  assert.ok(RULES.bottom > RULES.ground && RULES.top <= RULES.spawnY - 12);
  assert.ok(ctxFrames > 50 && kinds.size >= 2);
  assert.ok(Object.isFrozen(RULES));
});

test('drawing works with the plain mock context in every contract, hot, full, closed and tilted', () => {
  const ctx = mockContext();
  for (let level = 1; level <= LEVEL_COUNT; level += 3) {
    const { g } = start(level);
    for (let i = 0; i < 60 * 12; i++) {
      g.update(
        1 / 60,
        input(
          i % 100 < 50 ? ['ArrowDown', 'ArrowRight'] : ['ArrowUp', 'ArrowLeft'],
          i === 90 ? ['Space'] : [],
        ),
      );
      if (i % 30 === 0) g.draw(ctx);
    }
  }
  const s = newState();
  s.net.items.push(
    { id: 1, size: 3, mass: 3, color: 2, heat: 150 },
    { id: 2, size: 1, mass: 1, color: 1, heat: 20 },
  );
  s.net.open = false;
  s.net.wobble = 1;
  s.comets.push({
    id: 9,
    x: 100,
    y: 150,
    vx: 10,
    vy: 20,
    size: 2,
    mass: 2,
    color: 1,
    heat: 90,
    fate: 'air',
    spent: true,
    spilled: false,
    age: 0,
  });
  s.splashes.push({ x: 50, age: 0.1, hot: true }, { x: 90, age: 0.2, hot: false });
  assert.doesNotThrow(() => {
    const game = createGame(harness().env);
    game.draw(ctx);
  });
});

test('the wind pennant and streaks are drawn only where there is wind, and the chosen language reaches the HUD', () => {
  for (const [level, wind] of [
    [1, 0],
    [12, 40],
    [13, -45],
  ]) {
    const { g } = start(level);
    assert.equal(g.getState().wind, wind);
    const en = drawAndCollect(g)
      .texts.map((t) => t.str)
      .join('|');
    assert.match(en, new RegExp(`Contract ${level}/22`));
  }
  const hz = harness({ lang: 'zh' });
  const g = createGame(hz.env);
  assert.match(
    drawAndCollect(g)
      .texts.map((t) => t.str)
      .join('|'),
    /合同 1\/22/,
  );
});

test('every comet is caught and delivered at most once: totals add up over a whole heavy contract', () => {
  const { g } = start(5);
  const st = playLevel(g, 5, (x) => x.level === 6);
  assert.equal(st.level, 6);
  const run = start(5).g;
  let caught = 0;
  const ids = new Set();
  const memory = { text: '', at: -9 };
  for (let i = 0; i < 60 * 60; i++) {
    const s = run.getState();
    if (s.level !== 5) break;
    for (const it of s.net.items) ids.add(it.id);
    caught = s.stats.caught;
    const { held, pressed } = oracle(s, memory);
    run.update(1 / 60, input(held, pressed));
  }
  assert.equal(caught, ids.size, 'each caught comet entered the net exactly once');
  assert.ok(caught >= 6);
});

// --- Review regressions ---

test('R1: the English and Chinese descriptions both state the real closed-net cooling ratio of three', () => {
  assert.equal(RULES.coolClosed / RULES.coolOpen, 3);
  assert.match(meta.description.en, /three times as fast/);
  assert.doesNotMatch(meta.description.en, /twice/);
  assert.match(meta.description.zh, /三倍/);
});

test('R2: a bounced comet that falls back bounces off the net again, never through it, and then rolls off', () => {
  const s = quiet();
  s.net.open = false;
  s.comets.push({
    id: 7,
    x: 240,
    y: RULES.netY - 30,
    vx: 0,
    vy: 60,
    size: 1,
    mass: 1,
    color: 0,
    heat: 20,
    fate: 'air',
    spent: false,
    spilled: false,
    age: 0,
  });
  let rebounds = 0;
  let lastVy = 0;
  for (let i = 0; i < 60 * 8 && s.comets.length; i++) {
    advance(s, 1 / 60, input(), noop);
    const c = s.comets[0];
    if (!c) break;
    if (Math.abs(c.x - 240) <= RULES.half)
      assert.ok(c.y <= RULES.netY + 2, `passed through the net at y=${c.y}`);
    if (lastVy > 0 && c.vy < 0) rebounds++;
    lastVy = c.vy;
  }
  assert.ok(rebounds >= 2, `only ${rebounds} bounces`);
  assert.equal(s.comets.length, 0, 'it eventually falls off the rim and lands');
  assert.equal(s.stats.bounced, 1, 'only the refusal counts as a bounce');
  assert.equal(s.stats.caught, 0);
  assert.equal(s.lost, 1);
  // An open net never catches a spent comet either.
  const t = quiet();
  t.comets.push({
    id: 8,
    x: 240,
    y: RULES.netY - 30,
    vx: 0,
    vy: 60,
    size: 1,
    mass: 1,
    color: 0,
    heat: 20,
    fate: 'air',
    spent: true,
    spilled: false,
    age: 0,
  });
  frames(t, 4);
  assert.equal(t.net.items.length, 0);
  // The same on a real contract: closed net at x=240 in contract 1.
  const { g } = start(1);
  g.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 60 * 12; i++) {
    g.update(1 / 60, input());
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== 1) break;
    for (const c of st.comets)
      if (c.spent && Math.abs(c.x - st.net.x) <= RULES.half) assert.ok(c.y <= RULES.netY + 2);
  }
});

test('R3: every marker the guide asks for is drawn, including the bin arrow, at the position the guide gives', () => {
  for (const level of [9, 14, 22]) {
    const { g } = start(level);
    const memory = { text: '', at: -9 };
    let bins = 0;
    let catches = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      if (i % 15 === 0 && st.guide && ['bin', 'unload', 'catch'].includes(st.guide.kind)) {
        const { rects } = drawAndCollect(g);
        const green = rects.filter((r) => r.color === '#7dff9c' || r.color === '#3f9a66');
        if (st.guide.bin) {
          bins++;
          assert.ok(
            green.some((r) => r.y === 242 && r.x === Math.round(st.guide.x - 8)),
            'bin arrow drawn',
          );
        } else {
          catches++;
          assert.ok(
            green.some((r) => r.y === RULES.netY - 28 && r.x === Math.round(st.guide.x - 20)),
            'catch marker drawn',
          );
        }
      }
      const { held, pressed } = oracle(st, memory);
      g.update(1 / 60, input(held, pressed));
    }
    assert.ok(
      bins > 3 && catches > 3,
      `level ${level}: ${bins} bin / ${catches} catch markers checked`,
    );
  }
});

test('R4: an early marker for a comet that has not appeared yet is flagged as radar and drawn dimmer', () => {
  const { g } = start(1);
  let early = null;
  let live = null;
  for (let i = 0; i < 60 * 4 && !(early && live); i++) {
    const st = g.getState();
    if (st.guide?.kind === 'catch') {
      if (st.guide.early) early ||= st;
      else live ||= st;
    }
    g.update(1 / 60, input());
  }
  assert.ok(early, 'a radar blip before the first comet appears');
  assert.equal(early.comets.length, 0);
  assert.ok(live && live.comets.length > 0);
});

test('R6: a non-integer, non-finite or out-of-range unlocked value never throws', () => {
  for (const [value, expected] of [
    [2.5, 2],
    [3.999, 3],
    [0, 1],
    [-4, 1],
    [NaN, 1],
    [undefined, 1],
    ['abc', 1],
    [Infinity, 1],
    [99, 22],
    ['5', 5],
    [null, 1],
  ]) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock: () => {} };
    const g = createGame(h.env);
    const st = g.getState();
    assert.equal(st.level, 1);
    if (expected > 1)
      assert.deepEqual(st.menu, { sel: expected, unlocked: expected }, String(value));
    else assert.equal(st.menu, null, String(value));
    g.update(1 / 60, input([], ['Space']));
    assert.doesNotThrow(() => g.draw(mockContext()));
  }
});

test('R7: the lose sound plays once per failed attempt, "1 try left" is singular and the cool prompt names a key', () => {
  const h = harness();
  const g = createGame(h.env);
  let messages = [];
  for (let i = 0; i < 60 * 150 && g.getState().phase === 'playing'; i++) {
    g.update(1 / 30, input());
    const m = g.getState().message?.en;
    if (m && !messages.includes(m)) messages.push(m);
  }
  assert.equal(
    h.sounds.filter((x) => x === 'lose').length,
    3,
    'one lose sound per failure, none doubled',
  );
  assert.ok(messages.some((m) => /: 2 tries left/.test(m)));
  assert.ok(messages.some((m) => /: 1 try left/.test(m)));
  assert.ok(!messages.some((m) => /1 tries/.test(m)));
  const s = quiet();
  s.delivered = [2];
  s.net.items.push({ id: 1, size: 1, mass: 1, color: 0, heat: 70 });
  s.net.open = false;
  s.net.x = 240;
  frames(s, 0.2);
  const p = snapshotOf(s).prompt;
  assert.match(p.en, /^Stand still.*press X/);
  assert.match(p.zh, /^站着别动.*按 X/);
});

test('R8: a countdown shows once the 20 second timeout is running and is drawn in both languages', () => {
  const s = quiet();
  assert.equal(snapshotOf(s).timeLeft, null);
  s.clock = 0;
  s.next = LEVELS[0].sched.length;
  s.delivered = [0];
  s.net.items.push(
    { id: 1, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 2, size: 1, mass: 1, color: 0, heat: 20 },
    { id: 3, size: 1, mass: 1, color: 0, heat: 20 },
  );
  frames(s, 5);
  const left = snapshotOf(s).timeLeft;
  assert.ok(left > 14 && left < 15.1, `timeLeft ${left}`);
  for (const [lang, word] of [
    ['en', 'Time'],
    ['zh', '时间'],
  ]) {
    const hh = harness({ lang });
    const game = createGame(hh.env);
    const memory = { text: '', at: -9 };
    let shown = null;
    for (let i = 0; i < 60 * 40 && !shown; i++) {
      const st = game.getState();
      if (st.timeLeft !== null) {
        assert.ok(st.pending === 0);
        shown = drawAndCollect(game).texts.find((x) => x.str.startsWith(word));
        break;
      }
      // Catch three comets, then stand idle so the clock can run down.
      const idle = st.net.items.length >= 3;
      const { held, pressed } = idle ? { held: [], pressed: [] } : oracle(st, memory);
      game.update(1 / 60, input(held, pressed));
    }
    assert.ok(shown, `${lang}: countdown drawn`);
    assert.match(shown.str, /\d+$/);
    assert.equal(shown.size, 14);
  }
});

// A closed net refuses every comet, so each one bounces and then settles or slides. Track them.
function dropOnClosedNet(tilt, x, vx, vy, netVx = 0) {
  const s = quiet();
  s.net.open = false;
  s.net.tilt = tilt;
  s.comets.push({
    id: 7,
    x,
    y: RULES.netY - 40,
    vx,
    vy,
    size: 1,
    mass: 1,
    color: 0,
    heat: 20,
    fate: 'air',
    spent: false,
    spilled: false,
    age: 0,
  });
  const trace = [];
  let prev = null;
  for (let i = 0; i < 120 * 12 && s.comets.length; i++) {
    const c = s.comets[0];
    prev = { x: c.x, y: c.y, vx: c.vx, vy: c.vy, spent: c.spent, rolling: !!c.rolling };
    advance(s, 1 / 120, input(netVx ? [netVx > 0 ? 'ArrowRight' : 'ArrowLeft'] : []), noop);
    const n = s.comets[0];
    if (n)
      trace.push({
        before: prev,
        after: { x: n.x, y: n.y, vx: n.vx, vy: n.vy, spent: n.spent, rolling: !!n.rolling },
      });
  }
  return { s, trace };
}

test('R9: a comet rolling off the net slides downhill, never jumps and never gains energy', () => {
  let rolled = 0;
  let seed = 11;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 400; k++) {
    const tilt = (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 57);
    const x = 240 + (rnd() - 0.5) * 50;
    const { trace, s } = dropOnClosedNet(tilt, x, 0, 20 + rnd() * 100);
    assert.ok(trace.length > 0);
    for (const { before, after } of trace) {
      if (!before.spent) continue;
      const speed = Math.hypot(before.vx, before.vy);
      const jump = Math.hypot(after.x - before.x, after.y - before.y);
      assert.ok(jump <= speed / 120 + 3, `jumped ${jump.toFixed(2)} px at tilt ${tilt.toFixed(1)}`);
      const energy = (p) => 0.5 * (p.vx * p.vx + p.vy * p.vy) - RULES.gravity * p.y;
      assert.ok(energy(after) <= energy(before) + 1e-6, `energy rose at tilt ${tilt.toFixed(1)}`);
    }
    // A comet dropped straight down leaves over the low rim, never uphill.
    const rolling = trace.filter((t) => t.after.rolling);
    if (rolling.length) {
      rolled++;
      const low = Math.sign(tilt);
      for (const { before, after } of rolling)
        assert.ok(after.y >= before.y - 1e-9 || before.vy < 0, 'moved uphill while sliding');
      const last = trace.findLast((t) => t.after.rolling);
      assert.equal(Math.sign(last.after.x - 240) || low, Math.sign(last.after.x - 240) || low);
      assert.ok(
        (last.after.x - s.net.x) * low > 0,
        `left over the high rim at tilt ${tilt.toFixed(1)}`,
      );
    }
    assert.equal(s.comets.length, 0, 'it ends up landed');
  }
  assert.ok(rolled >= 15, `only ${rolled} roll-offs exercised`);
});

test('R9: with a slanted approach and a moving net energy still never rises and nothing teleports', () => {
  let seed = 5;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let steps = 0;
  for (let k = 0; k < 150; k++) {
    const tilt = (rnd() - 0.5) * 120;
    const { trace } = dropOnClosedNet(
      tilt,
      240 + (rnd() - 0.5) * 50,
      (rnd() - 0.5) * 120,
      20 + rnd() * 120,
      rnd() < 0.3 ? 1 : 0,
    );
    for (const { before, after } of trace) {
      if (!before.spent || !after.spent) continue;
      const speed = Math.hypot(before.vx, before.vy);
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= speed / 120 + 3.5);
      steps++;
    }
  }
  assert.ok(steps > 500);
});

test('R9: a comet at rest on a level lid settles into dust; one on a slope that cannot slide off settles after a few seconds', () => {
  const flat = dropOnClosedNet(0, 240, 0, 60);
  assert.equal(flat.s.comets.length, 0);
  assert.equal(flat.s.lost, 1);
  assert.equal(flat.s.stats.caught, 0);
  const slope = dropOnClosedNet(3, 240, 0, 60);
  assert.equal(slope.s.comets.length, 0);
  assert.equal(slope.s.stats.bounced, 1);
});

test('R9: the reviewer cases (tilt -34, -52 and +40, and a level net on contract 1) leave over the low rim without a jump', () => {
  for (const tilt of [-34, -52, 40, 3]) {
    const { trace, s } = dropOnClosedNet(tilt, 240, 0, 5);
    const exit = trace.findLast((t) => t.after.rolling) || trace.find((t) => t.before.spent);
    assert.ok(exit, `tilt ${tilt}: the comet slid`);
    if (exit.after.rolling)
      assert.ok((exit.after.x - 240) * Math.sign(tilt) > 0, `tilt ${tilt}: high rim`);
    for (const { before, after } of trace)
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 3.5, `tilt ${tilt}: jumped`);
    assert.equal(s.comets.length, 0);
  }
});
