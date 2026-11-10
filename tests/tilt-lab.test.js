import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  newState,
  advance,
  snapshotOf,
  stepMarble,
  slideFrom,
  planRoute,
  buildLab,
  RULES,
  LABS,
  LAB_COUNT,
} from '../src/games/tilt-lab.js';
import { harness, input, mockContext, seeded } from './harness.js';

const STEP = RULES.step;
const CELL = RULES.cell;
const noop = () => {};

// One scripted solution per lab, recorded at 60 Hz as run-length key codes:
// R/L/U/D tilt that way, S levels the board, - holds nothing; the digits are frames.
const SOLUTIONS = [
  '-34 R54 -242 S34 D54 -94 S64',
  '-34 R54 -242 S34 D54 -72 S34 L54 -244 S34 D54 -72 S34 R54 -244 S34 D54 -112 S34 L54 -152 S63',
  '-34 R54 -42 S34 D54 -168 S34 R54 -136 S34 U54 -168 S34 R54 -36 S34 D54 -72 S61',
  '-34 R54 -122 S34 D54 -96 S34 L54 -98 S34 D54 -82 S34 L54 -72 S34 U54 -46 S46',
  '-34 R54 -90 S34 R54 S34 D54 -130 S34 L54 -60 S34 U54 -98 S34 R54 -192 S34 D54 -36 S46',
  '-34 R54 -252 S34 D54 -114 S34 L54 -248 S34 D54 -104 S34 R54 -172 S58',
  '-34 D54 -128 S34 R54 -116 S34 D54 -104 S34 R54 -202 S34 U54 -142 S34 L54 -126 S34 D54 -34 S46',
  '-34 R54 -238 S34 D54 -168 S34 L54 -244 S34 U54 -92 S63',
  '-34 R54 -242 S34 D54 -106 S34 L54 -244 S34 D54 -112 S34 R54 -244 S34 U54 -52 S46',
  '-34 R54 -70 S34 R34 S34 D54 -72 S34 R54 -148 S34 D54 -82 S34 L54 -124 S34 U54 -116 S34 R54 -38 S34 D54 -88 S34 R54 -96 S34 D54 -72 S34 R54 -130 S34 U54 -66 S60',
  '-34 R54 -122 S34 D54 -72 S34 R54 -136 S34 D54 -96 S34 R54 -130 S34 D54 -74 S34 L54 -106 S34 U54 -116 S34 L54 -36 S34 D54 -60 S46',
  '-34 R54 -232 S34 D54 -168 S34 L54 -170 S34 D54 -148 S34 L54 -260 S34 U54 -154 S34 R54 -202 S46',
  '-34 R54 -36 S34 L54 -74 S34 D54 -168 S34 R54 -116 S34 U54 -62 S34 R54 -184 S34 D54 -62 S34 L54 -72 S61',
  '-34 R54 -232 S34 D54 -96 S34 L54 -108 S34 D54 -94 S34 L54 -186 S34 U54 -36 S46',
  '-34 D54 -42 S34 R54 -130 S34 D54 -56 S34 R54 -184 S34 D54 -56 S34 L54 -234 S34 D54 -120 S34 R54 -62 S34 U54 -88 S34 R54 -126 S56',
  '-34 R54 -106 S34 D54 -96 S34 -290 R54 -112 S34 D54 -94 S34 -34 R54 -112 S34 U54 -76 S34 -242 R54 -112 S34 U54 -112 S34 L54 -98 S34 D54 -168 S34 R54 -98 S34 U54 -34 S46',
  '-34 D54 -168 S34 R54 -58 S34 L54 -104 S34 U54 -168 S34 R54 -106 S34 D54 -116 S34 R54 -112 S34 U54 -76 S34 L54 -54 S34 R54 -90 S34 R52 S34 D54 -98 S34 R54 -114 S34 U54 -124 S34 L54 -98 S34 U54 -36 S34 R54 -46 S46',
  '-34 D54 S34 U54 -42 S34 R54 -152 S34 D54 -134 S34 L54 -142 S34 U54 -108 S34 R54 -156 L108 -260 S34 D54 -138 S34 R54 -264 S34 D54 -116 S51',
  '-34 R54 -42 S34 D54 -124 S34 R54 -34 S34 U54 -118 S34 R54 -46 S34 D54 -66 S34 R54 -218 S34 D54 -82 S34 L54 -34 S34 U54 -36 S46',
  '-34 R54 -242 S34 D54 -168 S34 L54 -234 S34 U54 -156 S34 R54 -224 S34 D54 -132 S34 L54 -132 S62',
  '-34 R54 -128 S34 D54 -140 S34 L54 -48 S34 L34 S34 L34 R88 -188 S34 U54 -116 S34 L54 -98 S34 U54 -34 S34 D54 -122 S34 R54 -98 S34 U54 -98 S34 R54 -130 S34 U54 -130 S34 L54 -210 S34 D54 -140 S50',
  '-34 D54 -108 S34 R54 -132 S34 U54 -86 S34 R54 -192 S34 U54 -34 S34 L54 -86 S34 D54 -118 S34 L54 -104 S34 U54 -102 S34 L54 -94 S34 D54 -108 S34 R54 -34 S46',
];
const CODE = { R: 'ArrowRight', L: 'ArrowLeft', U: 'ArrowUp', D: 'ArrowDown', S: 'Space' };
function frameKeys(script) {
  const frames = [];
  for (const token of script.split(' ')) {
    const keys =
      token[0] === '-' ? [] : [...token.slice(0, token.search(/\d/))].map((c) => CODE[c]);
    const count = Number(token.slice(token.search(/\d/)));
    for (let i = 0; i < count; i++) frames.push(keys);
  }
  return frames;
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
function start(level, seed = 1) {
  const h = harness({ seed });
  const { calls } = progressEnv(level, h);
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, calls };
}
function labState(level) {
  const s = newState({
    progress: { unlocked: () => level, unlock: noop },
  });
  if (s.menu) advance(s, 1 / 60, input([], ['Space']), noop);
  return s;
}
function frames(s, seconds, held = [], pressed = [], hz = 60) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) advance(s, 1 / hz, input(held, i === 0 ? pressed : []), noop);
}
const cx = (c) => c * CELL + CELL / 2;
const cy = (r) => RULES.top + r * CELL + CELL / 2;
function place(s, c, r, vx = 0, vy = 0, dx = 0, dy = 0) {
  s.marble = { x: cx(c) + dx, y: cy(r) + dy, vx, vy };
  s.restT = 0;
}
// Scenery finders, so the tests do not depend on where a lab happens to put things.
const free = (b, c, r) =>
  Boolean(b.wall[r]) && !b.wall[r][c] && !b.holeAt[r][c] && b.gateAt[r][c] < 0 && !b.flapAt[r][c];
function findHole(back = 2) {
  for (let level = 3; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    for (const h of b.holes) {
      let clear = true;
      for (let dc = -back; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          if ((dc !== 0 || dr !== 0) && !free(b, h.c + dc, h.r + dr)) clear = false;
      if (clear && !b.movers.length) return { level, h };
    }
  }
  throw new Error('no isolated hole in any lab');
}
function findRun(surface, len = 7) {
  for (let level = 1; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    for (let r = 1; r < RULES.rows - 1; r++)
      for (let c = 1; c + len < RULES.cols; c++) {
        let ok = !b.movers.length;
        for (let k = 0; k < len && ok; k++)
          ok = free(b, c + k, r) && b.surface[r][c + k] === surface && b.plateAt[r][c + k] < 0;
        if (ok) return { level, c, r };
      }
  }
  throw new Error(`no run of surface ${surface}`);
}
// A lab whose start has a roll that drops the marble into a hole before any wall.
function lethalRoll() {
  const step = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
  const key = { R: 'ArrowRight', L: 'ArrowLeft', U: 'ArrowUp', D: 'ArrowDown' };
  for (let level = 3; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    if (b.movers.length) continue;
    for (const [dir, [dc, dr]] of Object.entries(step)) {
      let c = b.start.c;
      let r = b.start.r;
      while (free(b, c + dc, r + dr) && b.plateAt[r + dr][c + dc] < 0) {
        c += dc;
        r += dr;
      }
      if (b.holeAt[r + dr]?.[c + dc] && (c !== b.start.c || r !== b.start.r))
        return { level, key: key[dir], b };
    }
  }
  throw new Error('no lethal roll from any start');
}
const energy = (m) => m.vx * m.vx + m.vy * m.vy;
const sp = (st) => st.marble.speed;

// A closed room: walls on the border of the 30x16 board.
const room = {
  solid: (c, r) => c < 1 || r < 0 || c > 28 || r > 15 || r === 0 || r === 15,
  flaps: [],
  movers: [],
};
const inRoom = (m) =>
  m.x >= CELL + RULES.radius - 1e-6 &&
  m.x <= 29 * CELL - RULES.radius + 1e-6 &&
  m.y >= RULES.top + CELL + RULES.radius - 1e-6 &&
  m.y <= RULES.top + 15 * CELL - RULES.radius + 1e-6;

function playScript(level, script) {
  const { g } = start(level);
  for (const keys of frameKeys(script)) {
    const st = g.getState();
    if (st.level !== level || st.phase !== 'playing') break;
    g.update(1 / 60, input(keys, []));
  }
  return g.getState();
}

test('meta follows the contract, is bilingual and the touch layout covers every key', () => {
  assert.equal(meta.id, 'tilt-lab');
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.ok(meta.touch);
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.ok(/[一-鿿]/.test(meta.description.zh) && !/[一-鿿]/.test(meta.description.en));
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const codes = meta.touchControls.map((c) => c.code).sort();
  assert.deepEqual(codes, ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space']);
  for (const c of meta.touchControls)
    assert.ok(c.label.en && c.label.zh && ['left', 'right'].includes(c.side));
  assert.ok(!meta.touchControls.some((c) => ['KeyP', 'KeyR', 'Escape'].includes(c.code)));
});

test('RULES is frozen and states the numbers the prompts and HUD rely on', () => {
  assert.ok(Object.isFrozen(RULES));
  assert.equal(RULES.step, 1 / 240);
  assert.equal(RULES.lives, 3);
  assert.ok(RULES.promptHold >= 0.5);
  assert.ok(RULES.holeR > RULES.radius, 'a hole is wider than the marble');
  assert.ok(RULES.maxTilt <= 10);
});

test('there are at least 20 distinct authored labs with a named teaching idea each', () => {
  assert.ok(LAB_COUNT >= 20);
  assert.equal(LABS.length, LAB_COUNT);
  assert.equal(SOLUTIONS.length, LAB_COUNT);
  const names = new Set();
  const boards = new Set();
  for (const b of LABS) {
    assert.equal(b.rows.length, RULES.rows);
    for (const row of b.rows) assert.equal(row.length, RULES.cols);
    assert.ok(b.name[0] && b.name[1] && b.tip[0] && b.tip[1]);
    assert.ok(/[一-鿿]/.test(b.name[1]) && /[一-鿿]/.test(b.tip[1]));
    assert.ok(b.par > 0);
    names.add(b.name[0]);
    boards.add(b.rows.join('\n'));
  }
  assert.equal(names.size, LAB_COUNT);
  assert.equal(boards.size, LAB_COUNT);
});

test('the labs introduce each mechanic in order and the later labs combine them', () => {
  const feats = LABS.map((b) => ({
    holes: b.holes.length,
    plates: b.plates.length,
    gates: b.gates.length,
    flaps: b.flaps.length,
    movers: b.movers.length,
    timed: Object.keys(b.timed).length,
    ice: b.surface.some((row) => row.includes(1)),
    sand: b.surface.some((row) => row.includes(2)),
    checkpoints: b.checkpoints.length,
    bridge: b.rows.some((row) => /O\.+O|O[.:~]+#|#[.:~]+O/.test(row)),
  }));
  const first = (key) => feats.findIndex((f) => f[key]);
  for (const key of ['holes', 'plates', 'flaps', 'movers', 'timed', 'ice', 'sand', 'checkpoints'])
    assert.ok(first(key) >= 0, `no lab uses ${key}`);
  assert.equal(feats[0].holes + feats[0].plates + feats[0].flaps + feats[0].movers, 0);
  assert.ok(first('holes') <= 3 && first('plates') <= 5);
  assert.ok(first('ice') < first('movers') + 8);
  assert.ok(
    feats.some((f) => f.plates >= 3),
    'a lab chains three plates',
  );
  assert.ok(
    feats.some((f) => f.timed && f.sand),
    'a timed gate behind sand',
  );
  assert.ok(
    feats.some((f) => f.ice && f.flaps),
    'ice with flaps',
  );
  assert.ok(feats.some((f) => f.bridge));
  const complexity = (f) =>
    f.holes +
    6 * f.plates +
    4 * f.gates +
    4 * f.flaps +
    8 * f.movers +
    (f.ice ? 12 : 0) +
    (f.sand ? 12 : 0);
  const mean = (a) => a.reduce((x, y) => x + complexity(y), 0) / a.length;
  assert.ok(mean(feats.slice(-6)) > mean(feats.slice(0, 6)) + 8);
  // The scripted solutions get longer too.
  const len = (i) => frameKeys(SOLUTIONS[i]).length;
  const early = [0, 1, 2, 3, 4, 5].reduce((a, i) => a + len(i), 0);
  const late = [16, 17, 18, 19, 20, 21].reduce((a, i) => a + len(i), 0);
  assert.ok(late > early * 1.4, `late ${late} vs early ${early}`);
  // Late labs are not a single straight roll.
  assert.ok(
    planRoute(LABS[LAB_COUNT - 1], LABS[LAB_COUNT - 1].start.c, LABS[LAB_COUNT - 1].start.r, 0),
  );
});

test('buildLab rejects boards with the wrong size or without a start and socket', () => {
  const ok = LABS[0].rows;
  assert.throws(() => buildLab({ ...LABS[0], rows: ok.slice(1) }, 0), /rows/);
  assert.throws(
    () => buildLab({ ...LABS[0], rows: ok.map((r, i) => (i ? r : r + '#')) }, 0),
    /columns/,
  );
  assert.throws(
    () => buildLab({ ...LABS[0], rows: ok.map((r) => r.replace('S', '.')) }, 0),
    /start and a socket/,
  );
});

test('every lab has a legal path and a scripted solution that clears it with no falls', () => {
  for (let level = 1; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    assert.ok(planRoute(b, b.start.c, b.start.r, 0), `lab ${level}: no route`);
    const { g } = start(level);
    let falls = 0;
    let cleared = false;
    for (const keys of frameKeys(SOLUTIONS[level - 1])) {
      g.update(1 / 60, input(keys, []));
      const st = g.getState();
      falls = Math.max(falls, st.falls);
      if (st.prompt.id === 'cleared' || st.phase === 'won') {
        cleared = true;
        break;
      }
    }
    assert.ok(cleared, `lab ${level}: scripted solution did not clear`);
    assert.equal(falls, 0, `lab ${level}: solution lost a marble`);
  }
});

test('the scripted solution is not a trivial hold: an idle board never reaches the socket', () => {
  for (let level = 1; level <= LAB_COUNT; level++) {
    const { g } = start(level);
    for (let i = 0; i < 60 * 40; i++) g.update(1 / 60, input([], []));
    const st = g.getState();
    assert.equal(st.level, level);
    assert.equal(st.phase, 'playing');
  }
});

test('invalid, zero, negative, huge and non-numeric frame times are inert', () => {
  const s = labState(1);
  const before = JSON.stringify({ m: s.marble, t: s.ticks, c: s.clock, a: s.acc });
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 1, 0.5, 0.11, '0.1', null, undefined])
    assert.equal(advance(s, dt, input(['ArrowRight'], []), noop), false, `dt ${dt}`);
  assert.equal(JSON.stringify({ m: s.marble, t: s.ticks, c: s.clock, a: s.acc }), before);
  assert.equal(s.tx, 0);
  const g = createGame(harness().env);
  const snap = JSON.stringify(g.getState());
  g.update(0, input(['ArrowRight'], []));
  g.update(NaN, input(['ArrowRight'], []));
  assert.equal(JSON.stringify(g.getState()), snap);
});

test('the simulation has a fixed step: sub-step frames accumulate and never lose time', () => {
  const s = labState(1);
  advance(s, STEP / 2, input([], []), noop);
  assert.equal(s.ticks, 0);
  advance(s, STEP / 2, input([], []), noop);
  assert.equal(s.ticks, 1);
  advance(s, 0.1, input([], []), noop);
  assert.equal(s.ticks, 1 + 24);
  assert.ok(Math.abs(s.clock - 25 * STEP) < 1e-9);
});

test('the same input gives identical full state at 30, 60 and 120 Hz', () => {
  const run = (hz) => {
    const { g } = start(2);
    const plan = [
      [0.6, ['ArrowRight']],
      [1.2, []],
      [0.4, ['Space']],
      [1.2, ['ArrowDown']],
      [0.6, ['Space']],
    ];
    for (const [sec, keys] of plan)
      for (let i = 0; i < Math.round(sec * hz); i++) g.update(1 / hz, input(keys, []));
    return g.getState();
  };
  const a = run(30);
  assert.deepEqual(run(60), a);
  assert.deepEqual(run(120), a);
  assert.ok(a.marble.x > cx(2), 'the marble really moved');
});

test('tilt ramps at a limited rate, clamps and the level key eases it back', () => {
  let s = labState(1);
  place(s, 14, 12);
  frames(s, 0.5, ['ArrowRight']);
  assert.ok(Math.abs(s.tx - RULES.tiltRate * 0.5) < 0.05);
  frames(s, 3, ['ArrowRight', 'ArrowDown']);
  assert.equal(s.tx, RULES.maxTilt);
  assert.equal(s.ty, RULES.maxTilt);
  frames(s, 0.1, ['ArrowLeft']);
  assert.ok(s.tx < RULES.maxTilt);
  s.tx = 3;
  frames(s, 0.5, ['ArrowLeft', 'ArrowRight']);
  assert.ok(Math.abs(s.tx - 3) < 0.05, 'opposite arrows cancel');
  frames(s, 1, ['Space', 'ArrowRight']);
  assert.equal(s.tx, 0, 'Space wins over arrows and levels at the ease rate');
  s = labState(1);
  place(s, 14, 12);
  s.tx = 6;
  s.ty = -6;
  frames(s, 0.1, ['Space']);
  assert.ok(Math.abs(s.tx - (6 - RULES.easeRate * 0.1)) < 0.15);
  assert.ok(Math.abs(s.ty + (6 - RULES.easeRate * 0.1)) < 0.15);
  assert.ok(RULES.easeRate > RULES.tiltRate, 'levelling is quicker than tilting');
  s.tx = -9;
  frames(s, 0.2, ['KeyD']);
  assert.ok(s.tx > -9, 'WASD works too');
});

test('acceleration is g sin(angle), scaled, with rolling friction and a standstill below it', () => {
  const m0 = { x: 100, y: 100, vx: 0, vy: 0 };
  for (const deg of [1, 3, 6, 9]) {
    const a = RULES.gravity * Math.sin((deg * Math.PI) / 180);
    const m = stepMarble(m0, a, 0, 0, 0.01, { solid: () => false, flaps: [], movers: [] });
    assert.ok(Math.abs(m.vx - a * 0.01) < 1e-9);
    assert.ok(Math.abs(m.x - (100 + a * 0.01 * 0.01)) < 1e-9);
  }
  // Friction: a tilt weaker than the friction cannot start a marble from rest.
  const weak = RULES.gravity * Math.sin((0.5 * Math.PI) / 180);
  assert.ok(weak < RULES.rollFriction.floor);
  const w = { solid: () => false, flaps: [], movers: [] };
  let m = m0;
  for (let i = 0; i < 480; i++) m = stepMarble(m, weak, 0, RULES.rollFriction.floor, STEP, w);
  assert.equal(m.vx, 0);
  assert.equal(m.x, 100);
  // Rolling resistance removes speed at a constant rate and never reverses the motion.
  m = stepMarble({ x: 100, y: 100, vx: 50, vy: 0 }, 0, 0, 40, 0.5, w);
  assert.equal(m.vx, 30);
  m = stepMarble({ x: 100, y: 100, vx: 5, vy: 0 }, 0, 0, 40, 0.5, w);
  assert.equal(m.vx, 0);
  assert.ok(m.x >= 100);
});

test('speed is capped and surfaces differ: ice slides far, sand drags, floor between', () => {
  const w = { solid: () => false, flaps: [], movers: [] };
  const fast = stepMarble({ x: 0, y: 0, vx: 5000, vy: 5000 }, 0, 0, 0, STEP, w);
  assert.ok(Math.hypot(fast.vx, fast.vy) <= RULES.maxSpeed + 1e-9);
  const coast = (f) => {
    let m = { x: 0, y: 0, vx: 100, vy: 0 };
    for (let i = 0; i < 240 * 20 && m.vx > 0; i++) m = stepMarble(m, 0, 0, f, STEP, w);
    return m.x;
  };
  const { ice, floor, sand } = RULES.rollFriction;
  assert.ok(ice < floor && floor < sand);
  assert.ok(coast(ice) > coast(floor) * 5 && coast(floor) > coast(sand) * 2);
  assert.ok(Math.abs(coast(floor) - 100 ** 2 / (2 * floor)) < 1);
  // The same on real boards: coasting from the same speed keeps more on ice than floor than sand.
  const speedAfter = (surface) => {
    const { level, c, r } = findRun(surface);
    const s = labState(level);
    place(s, c, r, 90, 0);
    frames(s, 1, []);
    return s.marble.vx;
  };
  assert.ok(speedAfter(1) > speedAfter(0) + 20, 'ice keeps its speed');
  assert.ok(speedAfter(2) < speedAfter(0) - 20, 'sand takes it away');
});

test('energy never increases in a free roll or a wall bounce, at any step length', () => {
  const rnd = seeded(5);
  for (const h of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1]) {
    for (let trial = 0; trial < 60; trial++) {
      let m = {
        x: 60 + rnd() * 360,
        y: 90 + rnd() * 180,
        vx: (rnd() - 0.5) * 1200,
        vy: (rnd() - 0.5) * 1200,
      };
      let e = energy({
        vx: Math.max(-600, Math.min(600, m.vx)),
        vy: Math.max(-600, Math.min(600, m.vy)),
      });
      e = Math.min(e, RULES.maxSpeed ** 2 * 2);
      for (let i = 0; i < 300; i++) {
        const before = energy(m);
        m = stepMarble(m, 0, 0, RULES.rollFriction.ice, h, room);
        assert.ok(energy(m) <= before + 1e-6, `h ${h}: energy rose ${before} -> ${energy(m)}`);
        assert.ok(inRoom(m), `h ${h}: left the room at ${m.x},${m.y}`);
      }
    }
  }
});

test('a bounce keeps at most the restitution fraction of the normal speed and slow impacts stop dead', () => {
  const hit = (vx) =>
    stepMarble({ x: 29 * CELL - RULES.radius - 0.2, y: 120, vx, vy: 30 }, 0, 0, 0, 0.05, room);
  const fast = hit(300);
  assert.ok(Math.abs(fast.vx + 300 * RULES.restitution) < 1e-6);
  assert.equal(fast.vy, 30, 'the tangential speed is untouched by a frictionless wall');
  assert.ok(fast.impact >= 299);
  const slow = hit(RULES.bounceMin - 1);
  assert.equal(slow.vx, 0);
  assert.ok(fast.x <= 29 * CELL - RULES.radius);
});

test('no wall tunnelling at the speed cap with any step length, into walls, corners and thin walls', () => {
  const rnd = seeded(77);
  for (const h of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1]) {
    for (let trial = 0; trial < 120; trial++) {
      const a = rnd() * Math.PI * 2;
      let m = {
        x: 100 + rnd() * 280,
        y: 100 + rnd() * 140,
        vx: Math.cos(a) * 1000,
        vy: Math.sin(a) * 1000,
      };
      for (let i = 0; i < 200; i++) {
        m = stepMarble(m, 0, 0, 0, h, room);
        assert.ok(inRoom(m), `h ${h} trial ${trial}: escaped to ${m.x},${m.y}`);
        assert.ok(Math.hypot(m.vx, m.vy) <= RULES.maxSpeed + 1e-6);
      }
    }
  }
  // A one-cell wall in the middle of the room: fire at it from every side.
  const post = {
    solid: (c, r) => room.solid(c, r) || (c === 14 && r === 8),
    flaps: [],
    movers: [],
  };
  const sx = 14 * CELL;
  const sy = RULES.top + 8 * CELL;
  for (const [x, y, vx, vy] of [
    [sx - 60, sy + 8, 600, 0],
    [sx + CELL + 60, sy + 8, -600, 0],
    [sx + 8, sy - 60, 0, 600],
    [sx + 8, sy + CELL + 60, 0, -600],
    [sx - 40, sy - 40, 424, 424],
    [sx + CELL + 40, sy + CELL + 40, -424, -424],
  ]) {
    let m = { x, y, vx, vy };
    for (let i = 0; i < 100; i++) {
      m = stepMarble(m, 0, 0, 0, 0.1, post);
      const nearX = Math.max(sx - m.x, 0, m.x - (sx + CELL));
      const nearY = Math.max(sy - m.y, 0, m.y - (sy + CELL));
      assert.ok(
        Math.hypot(nearX, nearY) >= RULES.radius - 1e-6,
        `penetrated the post at step ${i}`,
      );
    }
  }
});

test('contact resolution never teleports: the marble moves at most its travel plus a hair', () => {
  const rnd = seeded(9);
  let m = { x: 200, y: 150, vx: 400, vy: 250 };
  for (let i = 0; i < 4000; i++) {
    const next = stepMarble(m, (rnd() - 0.5) * 300, (rnd() - 0.5) * 300, 40, STEP, room);
    const travel = Math.hypot(next.vx, next.vy) * STEP + Math.hypot(m.vx, m.vy) * STEP + 0.1;
    assert.ok(Math.hypot(next.x - m.x, next.y - m.y) <= travel + 1e-6, `jump at step ${i}`);
    m = next;
  }
});

test('a marble that starts overlapping a wall is pushed out along the normal, not thrown', () => {
  const wall = 29 * CELL;
  const m = stepMarble({ x: wall - 2, y: 150, vx: 50, vy: 0 }, 0, 0, 0, STEP, room);
  assert.ok(m.x <= wall - RULES.radius + 1e-3);
  assert.ok(wall - 2 - m.x < RULES.radius, 'pushed out by about the overlap only');
  assert.ok(m.vx <= 0);
  // Exactly on a corner of the wall cell.
  const c = stepMarble({ x: wall, y: RULES.top + CELL + 0.0, vx: 10, vy: 10 }, 0, 0, 0, STEP, room);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  // Dead centre of a solid cell (the degenerate case) still resolves to a finite position.
  const post = { solid: (cc, rr) => cc === 14 && rr === 8, flaps: [], movers: [] };
  const d = stepMarble({ x: cx(14), y: cy(8), vx: 0, vy: 30 }, 0, 0, 0, STEP, post);
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
  const e = stepMarble({ x: cx(14), y: cy(8) - 3, vx: 0, vy: 30 }, 0, 0, 0, STEP, post);
  assert.ok(e.y < cy(8) - 3 + 1);
});

test('a marble in a corner at full tilt stays inside and does not jitter or gain speed', () => {
  const s = labState(1);
  place(s, 2, 2);
  frames(s, 6, ['ArrowLeft', 'ArrowUp']);
  const m = s.marble;
  assert.ok(m.x >= CELL + RULES.radius - 1e-6 && m.y >= RULES.top + CELL + RULES.radius - 1e-6);
  assert.ok(Math.hypot(m.vx, m.vy) < 1, 'pressed into the corner it is at rest');
  assert.ok(m.x < CELL + RULES.radius + 0.1);
});

test('a hole captures the marble by its real centre and radius, not by its cell', () => {
  const { level, h } = findHole();
  const fell = (dx, dy) => {
    const s = labState(level);
    s.marble = { x: h.x + dx, y: h.y + dy, vx: 100, vy: 0 };
    frames(s, 0.4, []);
    return Boolean(s.fall);
  };
  assert.equal(fell(-14, 0), true, 'rolls into the hole centre');
  assert.equal(fell(-14, RULES.holeR - 1), true, 'inside the radius');
  assert.equal(fell(-14, -(RULES.holeR - 1)), true);
  assert.equal(fell(-14, RULES.holeR + 1.5), false, 'a hair outside the lip passes by');
  assert.equal(fell(-14, -RULES.holeR - 1.5), false);
  // The corner of the hole cell is outside the lip, so the marble rests there.
  const s = labState(level);
  s.marble = { x: h.x + 7.6, y: h.y + 7.6, vx: 0, vy: 0 };
  frames(s, 0.5, []);
  assert.ok(!s.fall);
});

test('a marble creeping onto the drawn rim tips in, but a fast one passes just outside it', () => {
  const { level, h } = findHole();
  const rest = (dist) => {
    const s = labState(level);
    s.marble = { x: h.x - dist, y: h.y, vx: 0, vy: 0 };
    frames(s, 0.3, []);
    return Boolean(s.fall);
  };
  assert.equal(rest(RULES.holeR + 0.5), true, 'balanced on the rim it tips in');
  assert.equal(rest(RULES.holeR + 1.5), false, 'a pixel further out it stays');
});

test('a fast marble cannot skip over a hole between two steps', () => {
  const { level, h } = findHole(3);
  const s = labState(level);
  s.marble = { x: h.x - 40, y: h.y, vx: 600, vy: 0 };
  frames(s, 0.15, [], [], 30);
  assert.ok(s.fall, 'the swept path of the centre crosses the hole');
  assert.equal(s.fall.hole.x, h.x);
});

test('a fall costs a life, runs the animation, then resets to the start or the last checkpoint', () => {
  const s = labState(3);
  const h = LABS[2].holes[0];
  const sounds = [];
  s.marble = { x: h.x - 9, y: h.y, vx: 100, vy: 0 };
  for (let i = 0; i < 600 && !s.fall; i++) advance(s, 1 / 60, input([], []), (n) => sounds.push(n));
  assert.ok(s.fall);
  assert.equal(s.lives, RULES.lives - 1);
  assert.deepEqual(sounds, ['hit']);
  const snap = snapshotOf(s);
  assert.ok(snap.falling && snap.falling.x === h.x);
  const tx = s.marble.x;
  frames(s, RULES.fall / 2, ['ArrowRight']);
  assert.equal(s.marble.x, tx, 'input is ignored while falling');
  assert.equal(s.tx, 0);
  frames(s, RULES.fall, []);
  assert.equal(s.fall, null);
  assert.equal(s.marble.x, cx(1));
  assert.equal(s.marble.y, cy(1));
  assert.equal(speedOf(s), 0);
  assert.equal(s.tx + s.ty, 0);
  assert.equal(s.msg.en, 'Back at the checkpoint');
});
const speedOf = (s) => Math.hypot(s.marble.vx, s.marble.vy);

test('checkpoints save the place after a fall and the flag is shown as reached', () => {
  const s = labState(8);
  const flag = LABS[7].checkpoints[0];
  assert.deepEqual(s.check, LABS[7].start);
  place(s, flag.c, flag.r);
  frames(s, 0.05, []);
  assert.deepEqual(s.check, flag);
  assert.equal(s.msg.en, 'Checkpoint saved');
  const h = LABS[7].holes[0];
  s.marble = { x: h.x, y: h.y, vx: 1, vy: 0 };
  frames(s, 0.1, []);
  assert.ok(s.fall);
  frames(s, RULES.fall + 0.1, []);
  assert.equal(s.marble.x, cx(flag.c));
  assert.equal(s.marble.y, cy(flag.r));
  const st = snapshotOf(s);
  assert.deepEqual(st.checkpoint, flag);
});

test('running out of lives loses once, freezes the board and reports a loss', () => {
  const hole = LABS[2].holes[0];
  const s = labState(3);
  const sounds = [];
  for (let k = 0; k < RULES.lives; k++) {
    s.marble = { x: hole.x - 3, y: hole.y, vx: 60, vy: 0 };
    for (let i = 0; i < 60 * 3 && s.phase === 'playing'; i++)
      advance(s, 1 / 60, input([], []), (n) => sounds.push(n));
  }
  assert.equal(s.phase, 'lost');
  assert.equal(s.lives, 0);
  assert.equal(sounds.filter((n) => n === 'hit').length, RULES.lives);
  const frozen = JSON.stringify(snapshotOf(s));
  assert.equal(advance(s, 1 / 60, input(['ArrowRight', 'Space'], ['Space']), noop), false);
  assert.equal(JSON.stringify(snapshotOf(s)), frozen);
  const st = snapshotOf(s);
  assert.equal(st.guide, null);
  assert.match(st.status.en, /Out of lives/);
  assert.match(st.status.zh, /生命用完/);
});

test('through the game object, a loss ends the game once with won false and the lose sound', () => {
  const { level, key } = lethalRoll();
  const { g, h } = start(level);
  // Tilt toward the hole along a clear roll from the start, three times.
  for (let k = 0; k < RULES.lives; k++) {
    for (let i = 0; i < 60 * 40 && g.getState().falls <= k; i++) g.update(1 / 60, input([key], []));
    assert.equal(g.getState().falls, k + 1, `fall ${k + 1} happens`);
    for (let i = 0; i < 90 && g.getState().phase === 'playing'; i++)
      g.update(1 / 60, input([], []));
  }
  for (let i = 0; i < 60 * 3; i++) g.update(1 / 60, input([], []));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.includes('lose'));
  assert.ok(h.ends[0].message);
  assert.equal(h.sounds.filter((n) => n === 'lose').length, 1);
});

test('pressure plates need a level board and a slow marble held for a moment', () => {
  const plate = LABS[4].plates[0];
  const run = (tilt, vx, seconds) => {
    const s = labState(5);
    place(s, plate.c, plate.r, vx, 0);
    s.tx = tilt;
    frames(s, seconds, []);
    return s;
  };
  assert.equal(run(0, 0, RULES.plateTime - 0.1).open, 0, 'not instantly');
  assert.equal(run(0, 0, RULES.plateTime + 0.1).open, 1, 'level and still: the gate opens');
  const tilted = labState(5);
  place(tilted, plate.c, plate.r);
  tilted.tx = RULES.levelTol + 1;
  tilted.marble.x = cx(plate.c);
  frames(tilted, 0.12, []);
  assert.equal(tilted.open, 0, 'a tilted board does not press a plate');
  const fast = labState(5);
  place(fast, plate.c, plate.r, 0, 200);
  frames(fast, 0.01, []);
  assert.equal(fast.open, 0, 'a marble rushing over a plate does not press it');
  const off = labState(5);
  const side = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].find(([dc, dr]) => free(LABS[4], plate.c + dc, plate.r + dr));
  place(off, plate.c + side[0], plate.r + side[1]);
  frames(off, 1, []);
  assert.equal(off.open, 0, 'off the plate nothing happens');
  const press = run(0, 0, 0.5);
  assert.equal(press.msg.en, 'Plate pressed: a gate opened');
  assert.equal(press.stats.plates, 1);
});

test('closed gates are solid walls and open gates let the marble through', () => {
  const g = LABS[4].gates[0];
  const aim = (open) => {
    const s = labState(5);
    s.open = open;
    place(s, g.c - 1, g.r, 150, 0);
    frames(s, 0.5, []);
    return s.marble.x;
  };
  assert.ok(aim(0) < g.c * CELL - RULES.radius + 1e-6, 'stopped by the closed gate');
  assert.ok(aim(1) > (g.c + 1) * CELL, 'rolled through the open gate');
  const st = snapshotOf(labState(5));
  assert.deepEqual(st.gates, [{ id: 0, open: false, timer: 0, total: 0 }]);
});

test('a timed gate closes again after its time and never on top of the marble', () => {
  const b = LABS.find((lab) => Object.keys(lab.timed).length);
  const level = LABS.indexOf(b) + 1;
  const s = labState(level);
  const plate = b.plates[0];
  const gate = b.gates[0];
  const limit = b.timed.a;
  place(s, plate.c, plate.r);
  frames(s, RULES.plateTime + 0.2, []);
  assert.equal(s.open, 1);
  assert.ok(s.timers[0] > limit - 1);
  place(s, 5, 7, 0, 0);
  frames(s, limit - 2, []);
  assert.equal(s.open, 1, 'still open before the time is up');
  frames(s, 3, []);
  assert.equal(s.open, 0, 'closed again');
  assert.equal(snapshotOf(s).gates[0].open, false);
  // Re-pressing re-opens it; and a marble standing in the gateway keeps it open.
  s.open = 1;
  s.timers[0] = 0.05;
  s.marble = { x: gate.c * CELL + CELL / 2, y: RULES.top + gate.r * CELL + CELL / 2, vx: 0, vy: 0 };
  frames(s, 0.5, []);
  assert.equal(s.open, 1, 'a marble in the gateway is never walled in');
  place(s, gate.c + 4, gate.r);
  frames(s, 0.1, []);
  assert.equal(s.open, 0);
});

test('one-way flaps let a marble through in their direction and turn it back the other way', () => {
  const b = LABS[8];
  const up = { c: 1, r: 4 };
  assert.equal(b.flapAt[up.r][up.c], 'U');
  const roll = (fromR, vy) => {
    const s = labState(9);
    place(s, up.c, fromR, 0, vy);
    frames(s, 0.3, []);
    return s.marble.y;
  };
  assert.ok(roll(5, -150) < cy(4) - 4, 'through, going up');
  assert.ok(roll(3, 150) < cy(4) - 8, 'blocked going down: still above the flap');
  // The flap never moves a marble sideways while it is pushing through.
  const s = labState(9);
  place(s, up.c, 5, 0, -120);
  const x0 = s.marble.x;
  frames(s, 0.3, []);
  assert.equal(s.marble.x, x0);
});

test('slideFrom reports where a roll ends and refuses rolls into holes and one-way flaps', () => {
  const open = LABS[0];
  assert.equal(slideFrom(open, 1, 1, 'L', 0), null, 'blocked at once');
  assert.equal(slideFrom(open, 1, 1, 'R', 0).c, 28, 'rolls to the far wall');
  assert.equal(slideFrom(open, 1, 1, 'D', 0).r, 14);
  const { level, key } = lethalRoll();
  const dir = { ArrowRight: 'R', ArrowLeft: 'L', ArrowUp: 'U', ArrowDown: 'D' }[key];
  const b = LABS[level - 1];
  assert.equal(slideFrom(b, b.start.c, b.start.r, dir, 0), null, 'a roll into a hole is refused');
  const flaps = LABS[8];
  assert.equal(slideFrom(flaps, 1, 7, 'U', 0).r, 1, 'an up flap lets a roll through upward');
  assert.equal(slideFrom(flaps, 1, 2, 'D', 0).r, 3, 'but stops a roll coming down at it');
});

test('moving blocks follow a deterministic path and bounce the marble without adding energy', () => {
  const s = labState(11);
  const a = snapshotOf(s).movers[0];
  frames(s, 3.5, []);
  const b = snapshotOf(s).movers[0];
  assert.notDeepEqual(a, b);
  const t2 = labState(11);
  frames(t2, 3.5, []);
  assert.deepEqual(snapshotOf(t2).movers, snapshotOf(s).movers);
  const world = {
    solid: () => false,
    flaps: [],
    movers: [{ x0: 200, y0: 100, x1: 216, y1: 116, vx: -100, vy: 0 }],
  };
  let m = { x: 150, y: 108, vx: 120, vy: 0 };
  m = stepMarble(m, 0, 0, 0, 0.3, world);
  assert.ok(m.vx < 0, 'turned back by the oncoming block');
  assert.ok(m.x < 200, 'never inside the block');
  // In the block's frame the approach speed shrinks by the restitution: energy cannot grow there.
  assert.ok(Math.abs(m.vx - (-100 - (120 + 100) * RULES.restitution)) < 1e-6);
  // A block sweeping a resting marble pushes it and cannot pass through it.
  const wall = { solid: (c) => c < 0 || c > 29, flaps: [] };
  let r = { x: 124, y: 108, vx: 0, vy: 0 };
  for (let i = 0; i < 240; i++) {
    const mover = {
      x0: 100 + 80 * i * STEP,
      y0: 100,
      x1: 116 + 80 * i * STEP,
      y1: 116,
      vx: 80,
      vy: 0,
    };
    r = stepMarble(r, 0, 0, 0, STEP, { ...wall, movers: [mover] });
    assert.ok(r.x >= mover.x1 + RULES.radius - 0.01, `inside the block at ${i}`);
  }
});

test('a vertical mover is solid too and moving walls cannot squeeze the marble through a wall', () => {
  const world = {
    solid: (c) => c < 0 || c > 29,
    flaps: [],
    movers: [{ x0: 100, y0: 150, x1: 116, y1: 166, vx: 0, vy: -60 }],
  };
  let m = { x: 108, y: 120, vx: 0, vy: 40 };
  m = stepMarble(m, 0, 0, 0, 0.5, world);
  assert.ok(m.y < 150);
  assert.ok(m.vy < 0);
});

test('the socket settles the marble only when it is slow, near the centre and the board is level', () => {
  const b = LABS[0];
  const goal = b.goal;
  const settle = (dx, vx, tilt, sec) => {
    const s = labState(1);
    s.marble = { x: cx(goal.c) + dx, y: cy(goal.r), vx, vy: 0 };
    s.tx = tilt;
    frames(s, sec, []);
    return s;
  };
  const done = settle(0, 0, 0, RULES.settleTime + 0.2);
  assert.equal(done.pending, 1, 'the next lab is queued');
  assert.equal(settle(0, 0, 0, RULES.settleTime - 0.2).pending, null, 'not instantly');
  assert.equal(
    settle(0, 0, 4, RULES.settleTime + 0.2).pending,
    null,
    'a tilted board does not settle',
  );
  assert.equal(settle(0, 0, 4, 0.1).settleT, 0);
  const rolling = settle(0, -400, 0, 0.02);
  assert.equal(rolling.pending, null, 'a marble rushing across the socket does not stop');
  assert.ok(rolling.marble.vx < -100);
  assert.equal(
    settle(-(RULES.settleR + 2), 0, 0, 0.01).settleT,
    0,
    'off centre it is not settled yet',
  );
  // The dish pulls a slow marble into the middle where it settles.
  assert.equal(settle(-(RULES.dishR - 3), 0, 0, 1.5).pending, 1);
});

test('clearing a lab scores it once, unlocks the next, pauses, then loads it with fresh lives', () => {
  const { g, h, calls } = start(1);
  assert.equal(g.getState().level, 1);
  for (const keys of frameKeys(SOLUTIONS[0])) g.update(1 / 60, input(keys, []));
  for (let i = 0; i < 120; i++) g.update(1 / 60, input([], []));
  const st = g.getState();
  assert.equal(st.level, 2);
  assert.ok(st.score >= RULES.clearScore + RULES.lives * RULES.lifeScore);
  assert.deepEqual(calls, [2]);
  assert.equal(st.lives, RULES.lives);
  assert.ok(h.sounds.includes('coin'));
  assert.equal(h.ends.length, 0);
});

test('the pause after a clear ignores input and then loads the next lab', () => {
  const s = labState(1);
  const goal = LABS[0].goal;
  s.marble = { x: cx(goal.c), y: cy(goal.r), vx: 0, vy: 0 };
  frames(s, RULES.settleTime + 0.1, []);
  assert.equal(s.pending, 1);
  const status = snapshotOf(s);
  assert.equal(status.prompt.id, 'cleared');
  frames(s, 0.5, ['ArrowRight']);
  assert.equal(s.tx, 0, 'input is dead during the pause');
  assert.equal(s.level, 0);
  frames(s, RULES.clearPause, []);
  assert.equal(s.level, 1);
  assert.equal(s.pending, null);
  assert.equal(s.marble.x, cx(LABS[1].start.c));
});

test('score is the sum of each lab best: a slower replay cannot lower it and a fast one cannot farm', () => {
  const s = labState(1);
  const clear = (clock) => {
    const goal = s.lab.goal;
    s.marble = { x: cx(goal.c), y: cy(goal.r), vx: 0, vy: 0 };
    s.clock = clock;
    frames(s, RULES.settleTime + 0.1, []);
    frames(s, RULES.clearPause + 0.1, []);
  };
  clear(10);
  const first = s.score;
  assert.equal(first, s.best[0]);
  const base = RULES.clearScore + RULES.lives * RULES.lifeScore;
  assert.ok(
    Math.abs(first - (base + (LABS[0].par - 10.5) * RULES.parScore)) <= 2,
    `score ${first}`,
  );
  s.menu = null;
  s.level = 0;
  s.lab = LABS[0];
  clear(LABS[0].par + 50);
  assert.equal(s.best[0], first, 'slower keeps the old best');
  assert.equal(
    s.score,
    s.best.reduce((a, v) => a + v, 0),
  );
});

test('winning the last lab ends the game once with a win and freezes it; a new instance starts fresh', () => {
  const { g, h } = start(LAB_COUNT);
  for (const keys of frameKeys(SOLUTIONS[LAB_COUNT - 1])) g.update(1 / 60, input(keys, []));
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.ok(h.ends[0].score > 0);
  assert.ok(h.sounds.includes('win'));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowRight', 'Space'], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.equal(st.guide, null);
  assert.match(st.status.en, /All labs cleared/);
  assert.match(st.status.zh, /全部实验完成/);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.level, 1);
  assert.equal(fresh.phase, 'playing');
});

test('progress: hosts without it still play; bad values are clamped; clearing needs no unlock hook', () => {
  const plain = createGame(harness().env);
  assert.equal(plain.getState().level, 1);
  assert.equal(plain.getState().menu, null);
  for (const keys of frameKeys(SOLUTIONS[0])) plain.update(1 / 60, input(keys, []));
  for (let i = 0; i < 120; i++) plain.update(1 / 60, input([], []));
  assert.equal(plain.getState().level, 2);
  const { calls } = start(3);
  assert.equal(calls.length, 0, 'opening the select screen unlocks nothing');
  const big = newState({ progress: { unlocked: () => 99, unlock: noop } });
  assert.equal(big.menu.unlocked, LAB_COUNT);
  for (const value of [NaN, -4, 0, 'x', null, undefined, 1.9, Infinity]) {
    const s = newState({ progress: { unlocked: () => value, unlock: noop } });
    assert.ok(!s.menu || (s.menu.unlocked >= 2 && s.menu.unlocked <= LAB_COUNT), String(value));
  }
  const noUnlock = newState({ progress: { unlocked: () => 1 } });
  assert.equal(noUnlock.menu, null);
  const goal = LABS[0].goal;
  noUnlock.marble = { x: cx(goal.c), y: cy(goal.r), vx: 0, vy: 0 };
  frames(noUnlock, 1, []);
  assert.equal(noUnlock.pending, 1, 'a progress object without unlock does not break a clear');
});

test('select screen: it opens when more than one lab is unlocked, moves, clamps and starts the lab', () => {
  const { g } = (() => {
    const h = harness();
    progressEnv(5, h);
    return { g: createGame(h.env) };
  })();
  let st = g.getState();
  assert.ok(st.menu);
  assert.equal(st.menu.sel, 5);
  assert.equal(st.prompt.id, 'menu');
  const press = (k) => g.update(1 / 60, input([], [k]));
  press('ArrowLeft');
  assert.equal(g.getState().menu.sel, 4);
  press('KeyD');
  press('ArrowRight');
  assert.equal(g.getState().menu.sel, 5, 'cannot pass the unlocked lab');
  press('ArrowUp');
  assert.equal(g.getState().menu.sel, 1, 'up moves a row and clamps at the first lab');
  for (let i = 0; i < 8; i++) press('ArrowLeft');
  assert.equal(g.getState().menu.sel, 1, 'clamps at the first lab');
  press('ArrowDown');
  assert.equal(g.getState().menu.sel, 5, 'down clamps to the last unlocked lab');
  press('KeyS');
  assert.equal(g.getState().menu.sel, 5);
  press('KeyA');
  assert.equal(g.getState().menu.sel, 4);
  press('KeyW');
  press('ArrowRight');
  press('ArrowRight');
  assert.equal(g.getState().menu.sel, 3);
  g.update(1 / 60, input(['ArrowRight'], []));
  assert.equal(g.getState().menu.sel, 3, 'held keys do not scroll');
  press('Enter');
  st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3);
  assert.equal(st.lives, RULES.lives);
  // A wide unlock lets the down arrow move a row.
  const h2 = harness();
  progressEnv(LAB_COUNT, h2);
  const g2 = createGame(h2.env);
  g2.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g2.getState().menu.sel, LAB_COUNT, 'clamped to the end');
  g2.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g2.getState().menu.sel, LAB_COUNT - 11);
});

test('getState returns copies and exposes no cheat controls; the HUD bands are reported', () => {
  const { g } = start(11);
  const a = g.getState();
  a.marble.x = -999;
  a.tilt.x = 99;
  a.movers[0].x = 0;
  a.checkpoint.c = 99;
  a.lives = 0;
  a.stats.falls = 50;
  a.prompt.en = 'hacked';
  a.gates.push({ id: 9 });
  a.goal.x = 0;
  const b = g.getState();
  assert.notEqual(b.marble.x, -999);
  assert.equal(b.tilt.x, 0);
  assert.notEqual(b.checkpoint.c, 99);
  assert.equal(b.lives, RULES.lives);
  assert.equal(b.stats.falls, 0);
  assert.notEqual(b.prompt.en, 'hacked');
  assert.ok(b.goal.x > 0);
  for (const key of Object.keys(b)) assert.ok(!/cheat|debug|skip|god/i.test(key), key);
  assert.deepEqual(b.hud, { top: [0, RULES.top], bottom: [RULES.top + RULES.rows * CELL, 320] });
  assert.notEqual(g.getState(), g.getState());
  assert.match(b.status.en, /^Lab 11\/22 /);
  assert.match(b.status.zh, /^实验 11\/22 /);
});

test('prompts name the next action with a direction and the guide arrow matches it', () => {
  const { g } = start(1);
  for (let i = 0; i < 90; i++) g.update(1 / 60, input([], []));
  let st = g.getState();
  assert.match(st.line.en, /^Tilt [←→↑↓]: /);
  assert.match(st.line.zh, /^向[←→↑↓]倾斜：/);
  assert.ok(st.guide);
  const arrow = /Tilt ([←→↑↓])/.exec(st.line.en)[1];
  const map = { '→': 'R', '←': 'L', '↑': 'U', '↓': 'D' };
  assert.equal(st.guide.dir, map[arrow]);
  // The prompt is prefixed in the status for the host.
  assert.ok(st.status.en.endsWith(st.line.en));
  assert.ok(st.status.zh.endsWith(st.line.zh));
});

test('prompt ids cover the situations: tilt, hold, level, plate, settle, nopath, fall, cleared and menu', () => {
  const seen = new Set();
  for (let level = 1; level <= LAB_COUNT; level++) {
    const { g } = start(level);
    if (level === 5) seen.add(g.getState().prompt.id);
    for (const keys of frameKeys(SOLUTIONS[level - 1])) {
      g.update(1 / 60, input(keys, []));
      seen.add(g.getState().prompt.id);
    }
  }
  const { g: menu } = (() => {
    const h = harness();
    progressEnv(4, h);
    return { g: createGame(h.env) };
  })();
  seen.add(menu.getState().prompt.id);
  // Standing on a plate on a tilted board asks for a level board, then to hold still.
  const s = labState(5);
  const plate = LABS[4].plates[0];
  place(s, plate.c, plate.r);
  s.tx = 5;
  frames(s, 1, []);
  seen.add(snapshotOf(s).prompt.id);
  // Level on an unpressed plate it says to hold still while the plate charges.
  const c = labState(5);
  place(c, plate.c, plate.r);
  c.restT = 0.3;
  c.dwell[0] = 0.1;
  c.line = null;
  advance(c, 2 / 60, input([], []), noop);
  seen.add(snapshotOf(c).prompt.id);
  // A marble at rest with the way forward blocked on every side asks to try another way.
  const hole = LABS[2].holes[0];
  const f = labState(3);
  f.marble = { x: hole.x - 3, y: hole.y, vx: 60, vy: 0 };
  frames(f, 0.2, []);
  assert.ok(f.fall);
  f.line = null;
  frames(f, 0.1, []);
  seen.add(snapshotOf(f).prompt.id);
  const n = labState(2);
  n.lab = { ...LABS[1], goal: { c: 0, r: 0 } };
  frames(n, 1.5, []);
  seen.add(snapshotOf(n).prompt.id);
  for (const id of [
    'tilt',
    'hold',
    'level',
    'plateLevel',
    'plateHold',
    'settle',
    'cleared',
    'fall',
    'menu',
    'nopath',
  ])
    assert.ok(seen.has(id), `prompt ${id} never appeared (${[...seen]})`);
});

test('the planner finds a roll for every rest cell on the scripted routes and hints name the feature', () => {
  const hints = new Set();
  for (let level = 1; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    let open = 0;
    let c = b.start.c;
    let r = b.start.r;
    for (let guard = 0; guard < 40; guard++) {
      const plan = planRoute(b, c, r, open);
      assert.ok(plan, `lab ${level}: no plan at ${c},${r},${open}`);
      hints.add(plan.hint);
      const res = slideFrom(b, c, r, plan.dir, open);
      assert.ok(res, `lab ${level}: plan leads into a hole`);
      ({ c, r, open } = res);
      if (c === b.goal.c && r === b.goal.r) break;
    }
    assert.ok(c === b.goal.c && r === b.goal.r, `lab ${level}: following the plan does not finish`);
  }
  for (const k of ['wall', 'goal', 'plate', 'bridge', 'gate', 'flap', 'block', 'ice', 'sand'])
    assert.ok(hints.has(k), `no lab ever shows the ${k} hint`);
  assert.equal(
    planRoute(LABS[0], 1, 1, 0, new Set(['R', 'D', 'L', 'U'])),
    planRoute(LABS[0], 1, 1, 0, new Set(['R', 'D', 'L', 'U'])),
  );
});

test('a blocked direction is dropped from the plan after the marble stalls against it', () => {
  const s = labState(1);
  s.restT = 1;
  frames(s, 0.5, []);
  s.adv.failed = new Set();
  s.adv.stuck = RULES.stuckTime + 1;
  s.tx = RULES.goTilt;
  s.ty = RULES.goTilt;
  frames(s, 0.1, []);
  assert.ok(s.adv.plan, 'there is always another plan');
});

test('long seeded chaos stays finite, bounded and well-formed on every lab', () => {
  const keysets = [
    ['ArrowRight'],
    ['ArrowLeft'],
    ['ArrowUp'],
    ['ArrowDown'],
    ['Space'],
    [],
    ['ArrowRight', 'ArrowDown'],
  ];
  for (let level = 1; level <= LAB_COUNT; level++) {
    const { g } = start(level, level);
    const rnd = seeded(level * 31);
    let keys = [];
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 25 === 0) keys = keysets[Math.floor(rnd() * keysets.length)];
      g.update(rnd() < 0.5 ? 1 / 60 : 1 / 30, input(keys, []));
      const st = g.getState();
      if (st.phase !== 'playing') break;
      assert.ok(Number.isFinite(st.marble.x) && Number.isFinite(st.marble.y));
      assert.ok(
        st.marble.x > 0 && st.marble.x < 480 && st.marble.y > RULES.top && st.marble.y < 320,
      );
      assert.ok(Math.abs(st.tilt.x) <= RULES.maxTilt && Math.abs(st.tilt.y) <= RULES.maxTilt);
      assert.ok(st.lives >= 0 && st.lives <= RULES.lives);
      assert.ok(st.marble.speed <= RULES.maxSpeed + 1e-6);
    }
  }
});

function recorder() {
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (str) => texts.push(String(str)) : t[p]),
    set: (t, p, v) => ((t[p] = v), true),
  });
  return { ctx, texts };
}

test('drawing renders every lab, the menu, a fall and the pause in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (let level = 1; level <= LAB_COUNT; level++) {
      const h = harness({ lang });
      progressEnv(level, h);
      const g = createGame(h.env);
      const menu = recorder();
      g.draw(menu.ctx);
      if (level > 1) {
        assert.ok(menu.texts.length > 0, 'the select screen draws text');
        g.update(1 / 60, input([], ['Space']));
      }
      for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowRight'], []));
      const board = recorder();
      g.draw(board.ctx);
      const text = board.texts.join(' ');
      assert.ok(text.includes(lang === 'zh' ? '实验' : 'Lab'), text);
      assert.equal(/[一-鿿]/.test(text), lang === 'zh', `language of "${text}"`);
    }
    const h = harness({ lang });
    const roll = lethalRoll();
    progressEnv(roll.level, h);
    const g = createGame(h.env);
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 60 * 40 && !g.getState().falling; i++)
      g.update(1 / 60, input([roll.key], []));
    assert.ok(g.getState().falling, 'the marble fell');
    for (let i = 0; i < 20; i++) {
      g.update(1 / 60, input([], []));
      g.draw(recorder().ctx);
    }
  }
});

test('drawing covers gates open and shut, plates, checkpoints, movers, flaps, guide arrows and the end screens', () => {
  const variants = [];
  for (const level of [5, 8, 9, 11, 13, 16, 17]) {
    const h = harness();
    progressEnv(level, h);
    const g = createGame(h.env);
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 90; i++)
      g.update(1 / 60, input(i < 60 ? ['ArrowDown'] : ['ArrowRight'], []));
    variants.push(g);
  }
  const ctx = mockContext();
  for (const g of variants) g.draw(ctx);
  const labDone = start(LAB_COUNT);
  for (const keys of frameKeys(SOLUTIONS[LAB_COUNT - 1])) labDone.g.update(1 / 60, input(keys, []));
  labDone.g.draw(ctx);
  assert.equal(labDone.g.getState().phase, 'won');
  const roll = lethalRoll();
  const lost = start(roll.level);
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 60 * 30 && lost.g.getState().falls <= k; i++)
      lost.g.update(1 / 60, input([roll.key], []));
    for (let i = 0; i < 70 && lost.g.getState().phase === 'playing'; i++)
      lost.g.update(1 / 60, input([], []));
  }
  lost.g.draw(ctx);
  assert.equal(lost.g.getState().phase, 'lost');
  const s = labState(11);
  for (let t = 0; t < 12; t++) {
    frames(s, 0.5, []);
    for (const lang of ['en', 'zh']) {
      const h = harness({ lang });
      const g = createGame(h.env);
      g.draw(ctx);
    }
  }
});

test('the HUD text is 14-16 px and the drawn rows stay inside the canvas', () => {
  const sizes = [];
  const rects = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => {
      if (p === 'fillRect') return (x, y, w, h) => rects.push([x, y, w, h]);
      if (p === 'fillText') return () => sizes.push(String(t.font));
      return t[p];
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
  for (const level of [1, 5, 10]) {
    const { g } = start(level);
    for (let i = 0; i < 90; i++) g.update(1 / 60, input(['ArrowRight'], []));
    g.draw(ctx);
  }
  assert.ok(sizes.length > 0);
  for (const f of sizes) {
    const px = Number(/(\d+)px/.exec(f)?.[1]);
    assert.ok(px >= 14 && px <= 16, f);
  }
  for (const [x, y, w, h] of rects) {
    assert.ok(x >= -1 && y >= -1 && x + w <= 481 && y + h <= 321, `rect ${x},${y},${w},${h}`);
  }
});

test('a gate is drawn shut, then open once its plate has been pressed', () => {
  const { g } = start(5);
  const ctx = mockContext();
  const states = new Set();
  frameKeys(SOLUTIONS[4]).forEach((keys, i) => {
    g.update(1 / 60, input(keys, []));
    if (i % 20 === 0) {
      g.draw(ctx);
      states.add(g.getState().gates[0]?.open);
    }
  });
  assert.ok(states.has(false) && states.has(true), `gate states drawn: ${[...states]}`);
});

const CJK = /[一-鿿！？，：（）→←↑↓]/;
const textWidth = (str) => [...str].reduce((n, ch) => n + (CJK.test(ch) ? 14 : 8.4), 0);
function capture() {
  const rects = [];
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => {
      if (p === 'fillRect') return (x, y, w, h) => rects.push({ color: t.fillStyle, x, y, w, h });
      if (p === 'fillText')
        return (str, x, y) => texts.push({ str: String(str), x, y, align: t.textAlign });
      return t[p];
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
  return { ctx, rects, texts };
}

test('the plate prompt covers the whole charge, a charging bar fills and the gate opens after it', () => {
  const plate = LABS[4].plates[0];
  const s = labState(5);
  place(s, plate.c, plate.r);
  s.line = null;
  advance(s, 2 / 60, input([], []), noop);
  assert.equal(snapshotOf(s).prompt.id, 'plateHold');
  assert.ok(snapshotOf(s).plates[0].charge > 0);
  frames(s, 0.15, []);
  const mid = snapshotOf(s);
  assert.ok(
    mid.plates[0].charge > 0.3 && mid.plates[0].charge < 1,
    `charge ${mid.plates[0].charge}`,
  );
  assert.equal(mid.prompt.id, 'plateHold', 'still asking to hold while it charges');
  assert.equal(mid.gates[0].open, false);
  frames(s, 0.3, []);
  assert.equal(snapshotOf(s).gates[0].open, true);
  assert.equal(snapshotOf(s).plates[0].charge, 0);
  // Tilted, even slightly past the tolerance, the same marble is asked to level the board.
  const t = labState(5);
  place(t, plate.c, plate.r);
  t.tx = RULES.levelTol + 1;
  t.line = null;
  advance(t, 2 / 60, input([], []), noop);
  assert.equal(snapshotOf(t).prompt.id, 'plateLevel');
  assert.equal(snapshotOf(t).plates[0].charge, 0, 'a tilted board does not charge the plate');
  const bar = capture();
  const g = createGame(harness().env);
  g.draw(bar.ctx);
  assert.ok(bar.rects.length > 100);
});

test('a timed gate draws a fuse that burns down, blinks at the end and closes the gate', () => {
  const level = LABS.findIndex((b) => b.timed.a) + 1;
  const b = LABS[level - 1];
  const s = labState(level);
  place(s, b.plates[0].c, b.plates[0].r);
  frames(s, RULES.plateTime + 0.1, []);
  const gateCell = b.gates[0];
  const full = snapshotOf(s).gates[0];
  assert.equal(full.total, b.timed.a);
  assert.ok(full.timer > full.total - 1);
  place(s, b.start.c, b.start.r);
  frames(s, 5, []);
  assert.ok(snapshotOf(s).gates[0].timer < full.timer - 4.5, 'the fuse burns down');
  // The drawn fuse is a bar in the gate colour that shrinks as the timer runs.
  const widths = [];
  const r = start(level);
  for (const keys of frameKeys(SOLUTIONS[level - 1])) {
    r.g.update(1 / 60, input(keys, []));
    const st = r.g.getState();
    if (st.gates[0]?.open && st.gates[0].timer > 0 && widths.length < 400) {
      const cap = capture();
      r.g.draw(cap.ctx);
      const x = gateCell.c * CELL + 1;
      const bar = cap.rects.find(
        (q) => q.x === x && q.h === 2 && q.y === RULES.top + gateCell.r * CELL + 10,
      );
      if (bar) widths.push(bar.w);
    }
  }
  assert.ok(widths.length > 20, 'the fuse is drawn while the gate is open');
  assert.ok(widths[0] > widths.at(-1), `fuse ${widths[0]} -> ${widths.at(-1)}`);
});

test('the prompt says to wait for a moving block, then tilt, and a follower 0.5 s late never bumps one', () => {
  let waits = 0;
  let bumps = 0;
  for (const level of [11, 16])
    for (const hz of [60, 120]) {
      const { g } = start(level);
      const hist = [];
      for (let t = 0; t < 200; t += 1 / hz) {
        const st = g.getState();
        if (st.level !== level || st.phase !== 'playing') break;
        if (st.prompt.id === 'wait') {
          waits++;
          assert.match(st.line.en, /^Wait for the block [←→↑↓] to pass, then tilt [←→↑↓]$/);
          assert.match(st.line.zh, /^等挡块[←→↑↓]过去，再向[←→↑↓]倾斜$/);
          assert.ok(st.guide, 'the guide arrow still shows the planned direction');
        }
        hist.push({ t, line: st.line.en });
        if (hist.length > 400) hist.shift();
        let k = hist.length - 1;
        while (k > 0 && hist[k].t > t - 0.5) k--;
        g.update(1 / hz, input(keysForLine(hist[k].line), []));
      }
      const end = g.getState();
      bumps += end.stats.blocks;
      assert.ok(end.level > level, `lab ${level} @${hz} Hz cleared`);
      assert.equal(end.falls, 0);
    }
  assert.ok(waits > 100, `the wait prompt appeared ${waits} frames`);
  assert.equal(bumps, 0, 'no bump into a block');
});
const KEYS_BY_ARROW = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };
function keysForLine(line) {
  const m = /^Tilt ([←→↑↓])/.exec(line);
  if (m) return [KEYS_BY_ARROW[m[1]]];
  return /\(Space\)/.test(line) ? ['Space'] : [];
}

test('a marble nudged into a wall is settled back on its surface, even from dead on the face', () => {
  const world = { solid: (c) => c < 1, flaps: [], movers: [] };
  const face = CELL + RULES.radius;
  for (const x0 of [face - 0.2, face - 0.5, face - 2, CELL]) {
    const m = stepMarble({ x: x0, y: 148, vx: 0, vy: 0 }, 0, 0, 0, STEP, world);
    assert.ok(m.x >= face - 0.06, `from ${x0} to ${m.x}`);
    assert.equal(m.y, 148);
  }
  // A block driving a marble along the floor against a wall corner never buries it either.
  const wall = { solid: (c, r) => c < 1 || r < 0 || r > 20, flaps: [] };
  let m = { x: 40, y: 148, vx: 0, vy: 0 };
  for (let i = 0; i < 240; i++) {
    const mover = {
      x0: 80 - 40 * i * STEP,
      y0: 140,
      x1: 96 - 40 * i * STEP,
      y1: 156,
      vx: -40,
      vy: 0,
    };
    m = stepMarble(m, 0, 0, 0, STEP, { ...wall, movers: [mover] });
    assert.ok(m.x >= face - 0.06 || m.x >= mover.x1, `buried at step ${i}: ${m.x}`);
    if (mover.x0 < face + RULES.radius) break;
  }
});

test('no moving block sweeps into a wall: there is open floor beyond both ends of its travel', () => {
  let movers = 0;
  for (const b of LABS)
    for (const m of b.movers) {
      movers++;
      const [dc, dr] = [Math.sign(m.c1 - m.c0), Math.sign(m.r1 - m.r0)];
      for (const [c, r] of [
        [m.c0 - dc, m.r0 - dr],
        [m.c1 + dc, m.r1 + dr],
      ])
        assert.ok(!b.wall[r][c], `${b.name[0]}: the block runs into a wall at ${c},${r}`);
    }
  assert.ok(movers >= 4);
});

test('RULES, its friction table and LABS are deeply frozen so no caller can retune the game', () => {
  assert.ok(Object.isFrozen(RULES.rollFriction));
  assert.throws(() => {
    RULES.rollFriction.ice = 99;
  });
  assert.throws(() => {
    RULES.gravity = 1;
  });
  assert.ok(Object.isFrozen(LABS));
  for (const b of LABS) {
    assert.ok(Object.isFrozen(b) && Object.isFrozen(b.rows) && Object.isFrozen(b.wall[0]));
    assert.throws(() => {
      b.rows[0] = 'x';
    });
  }
  assert.throws(() => {
    LABS.push({});
  });
});

test('the guide arrow and the target frame are only ever drawn on open floor', () => {
  let arrows = 0;
  for (let level = 1; level <= LAB_COUNT; level++) {
    const b = LABS[level - 1];
    const { g } = start(level);
    const script = frameKeys(SOLUTIONS[level - 1]);
    script.forEach((keys, i) => {
      g.update(1 / 60, input(keys, []));
      if (i % 12 !== 0) return;
      const cap = capture();
      g.draw(cap.ctx);
      for (const q of cap.rects) {
        if (q.color !== '#ffe066' || q.w > 16) continue;
        const c = Math.floor((q.x + q.w / 2) / CELL);
        const r = Math.floor((q.y + q.h / 2 - RULES.top) / CELL);
        if (r < 0 || r >= RULES.rows) continue;
        assert.ok(!b.wall[r][c], `lab ${level}: guide pixel on a wall at ${c},${r}`);
        assert.ok(!b.holeAt[r][c], `lab ${level}: guide pixel on a hole at ${c},${r}`);
        arrows++;
      }
    });
  }
  assert.ok(arrows > 2000, `only ${arrows} guide pixels checked`);
});

test('the HUD never overlaps: the bottom band swaps the clock for a message and every line fits', () => {
  for (const lang of ['en', 'zh']) {
    const messages = new Set();
    for (const level of [5, 8, 11, 13, 16, 18]) {
      const h = harness({ lang });
      progressEnv(level, h);
      const g = createGame(h.env);
      g.update(1 / 60, input([], ['Space']));
      frameKeys(SOLUTIONS[level - 1]).forEach((keys, i) => {
        g.update(1 / 60, input(keys, []));
        if (i % 5 !== 0) return;
        const cap = capture();
        g.draw(cap.ctx);
        const bottom = RULES.top + RULES.rows * CELL + 4;
        const row = cap.texts.filter((t) => t.y === bottom);
        const spans = row.map((t) => {
          const w = textWidth(t.str);
          const left = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
          return { left, right: left + w, str: t.str };
        });
        spans.sort((a, z) => a.left - z.left);
        for (let k = 0; k < spans.length; k++) {
          assert.ok(
            spans[k].left >= 0 && spans[k].right <= 480,
            `"${spans[k].str}" leaves the canvas`,
          );
          if (k)
            assert.ok(
              spans[k].left > spans[k - 1].right + 4,
              `"${spans[k - 1].str}" overlaps "${spans[k].str}"`,
            );
        }
        if (spans.length === 2) messages.add(spans[1].str);
        const top = cap.texts.filter((t) => t.y === 3 || t.y === 23);
        for (const t of top) {
          const w = textWidth(t.str);
          const left = t.align === 'center' ? t.x - w / 2 : t.x;
          assert.ok(left >= 0 && left + w <= 480, `"${t.str}" leaves the canvas`);
          if (t.y === 3) assert.ok(left + w < 432, 'the lab name stays clear of the lives');
        }
      });
    }
    assert.ok(messages.size >= 1);
  }
});

test('the drawn socket dish is exactly as wide as the region that pulls the marble', () => {
  const { g } = start(1);
  const cap = capture();
  g.draw(cap.ctx);
  const dish = cap.rects.filter((q) => q.color === '#7a5c14');
  const widest = Math.max(...dish.map((q) => q.w));
  assert.equal(widest, 2 * RULES.dishR + 1);
});

test('the banner behind the end overlay names the outcome: out of lives on a loss, cleared on a win', () => {
  const hole = LABS[2].holes[0];
  const lost = labState(3);
  for (let k = 0; k < RULES.lives; k++) {
    lost.marble = { x: hole.x - 3, y: hole.y, vx: 60, vy: 0 };
    for (let i = 0; i < 60 * 3 && lost.phase === 'playing'; i++)
      advance(lost, 1 / 60, input([], []), noop);
  }
  assert.equal(lost.phase, 'lost');
  const loss = snapshotOf(lost);
  assert.equal(loss.prompt.id, 'lost');
  assert.equal(loss.line.en, 'Out of lives');
  assert.equal(loss.line.zh, '生命用完');
  assert.ok(!/cleared/i.test(loss.line.en) && !loss.line.zh.includes('完成'));
  const canvas = capture();
  const h = harness();
  progressEnv(LAB_COUNT, h);
  const won = createGame(h.env);
  won.update(1 / 60, input([], ['Space']));
  for (const keys of frameKeys(SOLUTIONS[LAB_COUNT - 1])) won.update(1 / 60, input(keys, []));
  for (let i = 0; i < 90; i++) won.update(1 / 60, input([], []));
  const win = won.getState();
  assert.equal(win.phase, 'won');
  assert.equal(win.line.en, 'Lab cleared!');
  assert.equal(win.line.zh, '实验完成！');
  won.draw(canvas.ctx);
  assert.ok(canvas.texts.some((t) => t.str === 'Lab cleared!'));
  const roll = lethalRoll();
  const { g } = start(roll.level);
  for (let k = 0; k < RULES.lives; k++) {
    for (let i = 0; i < 60 * 40 && g.getState().falls <= k; i++)
      g.update(1 / 60, input([roll.key], []));
    for (let i = 0; i < 90 && g.getState().phase === 'playing'; i++)
      g.update(1 / 60, input([], []));
  }
  assert.equal(g.getState().phase, 'lost');
  const drawn = capture();
  g.draw(drawn.ctx);
  assert.ok(drawn.texts.some((t) => t.str === 'Out of lives'));
  assert.ok(!drawn.texts.some((t) => /cleared/i.test(t.str)));
});

test('a throwing progress store never stops a game from opening or a lab from clearing', () => {
  const broken = (unlocked) => ({
    unlocked: () => {
      throw new Error('store down');
    },
    unlock: (n) => unlocked.push(n),
  });
  const reads = harness();
  reads.env.progress = broken([]);
  const g = createGame(reads.env);
  assert.equal(g.getState().level, 1);
  assert.equal(g.getState().menu, null, 'an unreadable store falls back to a fresh start');
  const writes = harness();
  writes.env.progress = {
    unlocked: () => 3,
    unlock: () => {
      throw new Error('store down');
    },
  };
  const w = createGame(writes.env);
  assert.equal(w.getState().menu.unlocked, 3);
  w.update(1 / 60, input([], ['Space']));
  assert.equal(w.getState().level, 3);
  for (const keys of frameKeys(SOLUTIONS[2])) w.update(1 / 60, input(keys, []));
  for (let i = 0; i < 120; i++) w.update(1 / 60, input([], []));
  assert.equal(w.getState().level, 4, 'the clear still counts when the store refuses to save');
  assert.ok(w.getState().score > 0);
});

test('update tolerates a missing input object', () => {
  const g = createGame(harness().env);
  assert.doesNotThrow(() => g.update(1 / 60, undefined));
  assert.doesNotThrow(() => g.update(1 / 60, null));
  const hostMenu = harness();
  progressEnv(4, hostMenu);
  const menu = createGame(hostMenu.env);
  assert.doesNotThrow(() => menu.update(1 / 60, undefined));
  assert.ok(menu.getState().menu, 'with no input the select screen simply waits');
  assert.equal(advance(newState({}), 1 / 60, undefined, noop), true);
});

test('from lab 15 the route arrow and the roll named in the prompt wait for a fall or a long stall', () => {
  const readLine = (s) => snapshotOf(s);
  for (const level of [1, 7, 14]) {
    const s = labState(level);
    frames(s, 1.2, []);
    const st = readLine(s);
    assert.equal(st.prompt.id, 'tilt', `lab ${level} keeps its teaching prompt`);
    assert.ok(st.guide, `lab ${level} keeps its guide`);
    assert.equal(st.routeHint, true);
  }
  for (const level of [RULES.guideFrom, 18, LAB_COUNT]) {
    const s = labState(level);
    frames(s, 1.2, []);
    const st = readLine(s);
    assert.equal(st.routeHint, false, `lab ${level} hides the route`);
    assert.equal(st.guide, null);
    assert.equal(st.prompt.id, 'read');
    assert.ok(!/[←→↑↓]/.test(`${st.line.en}${st.line.zh}`), 'no direction in the text');
    assert.match(st.line.zh, /观察台面/);
    // Nothing a player tries makes the prompt confirm a guess: the line is the same for any tilt.
    const guessed = labState(level);
    frames(guessed, 0.6, ['ArrowLeft']);
    frames(guessed, 0.6, ['ArrowDown']);
    assert.ok(['read', 'hold', 'level', 'wait'].includes(readLine(guessed).prompt.id));
    assert.equal(readLine(guessed).guide, null);
    // Idle for a long stall: the arrow and the direction come back.
    frames(s, RULES.helpStall + 1, []);
    const late = readLine(s);
    assert.equal(late.routeHint, true, `lab ${level} helps after ${RULES.helpStall} s`);
    assert.equal(late.prompt.id, 'tilt');
    assert.ok(late.guide);
    assert.match(late.line.en, /^Tilt [←→↑↓]/);
  }
});

test('a fall brings the route arrow back on a mastery lab and the help lasts for that lab', () => {
  const level = RULES.guideFrom;
  const hole = LABS[level - 1].holes[0];
  const s = labState(level);
  frames(s, 1.2, []);
  assert.equal(snapshotOf(s).routeHint, false);
  s.marble = { x: hole.x - 3, y: hole.y, vx: 60, vy: 0 };
  frames(s, 0.3, []);
  assert.ok(s.fall, 'the marble went in');
  frames(s, 3, []);
  const st = snapshotOf(s);
  assert.equal(st.falls, 1);
  assert.equal(st.routeHint, true);
  assert.equal(st.prompt.id, 'tilt');
  assert.ok(st.guide);
  frames(s, 5, []);
  assert.equal(snapshotOf(s).routeHint, true, 'the help stays on until the lab ends');
});

test('a stalled player is only helped if no new resting spot is reached, and a new lab starts hidden again', () => {
  const level = RULES.guideFrom;
  const s = labState(level);
  const cells = LABS[level - 1];
  // Keep reaching new spots (a roll right, then down) so the stall clock keeps restarting.
  frames(s, 1, []);
  const before = s.progressAt;
  place(s, cells.start.c + 2, cells.start.r);
  frames(s, 1, []);
  assert.ok(s.progressAt > before, 'a new resting spot restarts the stall clock');
  assert.equal(snapshotOf(s).routeHint, false);
  const goal = cells.goal;
  s.marble = { x: cx(goal.c), y: cy(goal.r), vx: 0, vy: 0 };
  s.helped = true;
  frames(s, 1, []);
  frames(s, 2, []);
  assert.equal(snapshotOf(s).level, level + 1);
  assert.equal(snapshotOf(s).routeHint, level + 1 < RULES.guideFrom);
});

test('"Level the board" is only said while tilt.level is false; the turn line asks for zero tilt', () => {
  for (const level of [3, RULES.guideFrom]) {
    const turn = new Set();
    for (const v of [0.1, 0.4, 1, 1.7, RULES.levelTol, 2.4, 3.5]) {
      const s = labState(level);
      frames(s, 0.6, []);
      s.tx = v;
      s.ty = -v;
      s.line = null;
      frames(s, 0.1, []);
      const st = snapshotOf(s);
      if (!st.tilt.level) continue;
      if (st.prompt.id === 'level') turn.add(`${st.line.en}|${st.line.zh}`);
      assert.ok(!/Level the board|放平台面/.test(`${st.line.en}${st.line.zh}`), st.line.en);
    }
    assert.deepEqual(
      [...turn],
      ['Zero the tilt (Space) before turning|先把倾角归零（空格）再转向'],
    );
  }
  // The socket line follows the same rule: once tilt.level reads true it stops asking to level.
  const s = labState(1);
  const goal = LABS[0].goal;
  s.marble = { x: cx(goal.c), y: cy(goal.r), vx: 0, vy: 0 };
  s.tx = 4;
  s.line = null;
  frames(s, 0.05, []);
  assert.equal(snapshotOf(s).tilt.level, false);
  assert.match(snapshotOf(s).line.en, /Level the board \(Space\) to settle/);
  s.tx = 1;
  s.line = null;
  s.restT = 0;
  frames(s, 0.05, []);
  const near = snapshotOf(s);
  assert.equal(near.tilt.level, true);
  assert.ok(!/Level the board/.test(near.line.en), near.line.en);
});

// Independent copies of the letters so the test does not lean on the module's own tables.
const LETTERS = [
  ['.#.', '#.#', '###', '#.#', '#.#'],
  ['##.', '#.#', '##.', '#.#', '##.'],
  ['.##', '#..', '#..', '#..', '.##'],
];
const pixelsOf = (rects, x, y, w, h, scale) => {
  const rows = [];
  for (let j = 0; j < 5; j++) {
    let row = '';
    for (let i = 0; i < 3; i++)
      row += rects.some(
        (q) => q.x === x + i * scale && q.y === y + j * scale && q.w === scale && q.h === scale,
      )
        ? '#'
        : '.';
    rows.push(row);
  }
  return rows;
};

test('plates and gates carry a shared letter mark, so the pairing never depends on colour', () => {
  for (const level of [10, 17]) {
    const b = LABS[level - 1];
    const { g } = start(level);
    const canvas = capture();
    g.draw(canvas.ctx);
    const letters = new Set();
    for (const p of b.plates) {
      const x = p.c * CELL + CELL / 2 - 1;
      const y = cy(p.r) - 2;
      const onPlate = pixelsOf(canvas.rects, x, y, 3, 5, 1);
      assert.deepEqual(onPlate, LETTERS[p.gate], `lab ${level} plate ${p.gate}`);
      const gate = b.gates.find((q) => q.id === p.gate);
      const onGate = pixelsOf(
        canvas.rects,
        gate.c * CELL + 5,
        RULES.top + gate.r * CELL + 3,
        6,
        10,
        2,
      );
      assert.deepEqual(onGate, LETTERS[p.gate], `lab ${level} gate ${p.gate}`);
      letters.add(onPlate.join());
    }
    assert.equal(letters.size, b.plates.length, 'each pair has its own letter');
  }
  // An open gate keeps its letter, small, in its own colour.
  const { g } = start(5);
  for (const keys of frameKeys(SOLUTIONS[4])) {
    if (g.getState().gates[0].open) break;
    g.update(1 / 60, input(keys, []));
  }
  assert.ok(g.getState().gates[0].open, 'the plate opened the gate');
  const gate = LABS[4].gates[0];
  const canvas = capture();
  g.draw(canvas.ctx);
  const x = gate.c * CELL + 6;
  const y = RULES.top + gate.r * CELL + 3;
  assert.deepEqual(pixelsOf(canvas.rects, x, y, 3, 5, 1), LETTERS[0]);
});

test('locked lab tiles show a padlock and a legend instead of only a dimmer number', () => {
  const locked = harness();
  progressEnv(3, locked);
  const g = createGame(locked.env);
  const canvas = capture();
  g.draw(canvas.ctx);
  const lockColor = canvas.rects.filter((q) => q.color === '#6b7490');
  assert.ok(lockColor.length >= 3 * 5, 'a padlock on each of the 19 locked tiles');
  const tileX = (i) => 20 + ((i - 1) % 11) * 40;
  assert.ok(
    lockColor.some((q) => q.x >= tileX(4) && q.x < tileX(4) + 32),
    'lab 4 is padlocked',
  );
  assert.ok(!lockColor.some((q) => q.x >= tileX(3) && q.x < tileX(3) + 32 && q.y < 100));
  const numbers = canvas.texts.map((t) => t.str);
  for (const open of ['1', '2', '3']) assert.ok(numbers.includes(open));
  assert.ok(!numbers.includes('4'), 'a locked tile hides its number behind the padlock');
  assert.ok(numbers.includes('Padlock: clear the earlier labs first'));
  const zh = harness({ lang: 'zh' });
  progressEnv(3, zh);
  const gz = createGame(zh.env);
  const zc = capture();
  gz.draw(zc.ctx);
  assert.ok(zc.texts.some((t) => t.str === '挂锁：先完成前面的实验'));
  const all = harness();
  progressEnv(LAB_COUNT, all);
  const open = createGame(all.env);
  const oc = capture();
  open.draw(oc.ctx);
  assert.ok(!oc.rects.some((q) => q.color === '#6b7490'), 'no padlock when everything is open');
  assert.ok(!oc.texts.some((t) => /Padlock/.test(t.str)));
});

test('the clock reads in seconds in both languages and spent lives are rings, not only a darker colour', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    progressEnv(3, h);
    const g = createGame(h.env);
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 60; i++) g.update(1 / 60, input([], []));
    const full = capture();
    g.draw(full.ctx);
    const clock = full.texts.find((t) => / \/ /.test(t.str));
    assert.ok(clock, 'the clock is drawn');
    assert.match(clock.str, lang === 'en' ? /^\d+\.\ds \/ 55s$/ : /^\d+\.\d秒 \/ 55秒$/);
    assert.ok(!full.rects.some((q) => q.color === '#4a5578'), 'no spent life yet');
  }
  const roll = lethalRoll();
  const lost = start(roll.level);
  for (let i = 0; i < 60 * 30 && lost.g.getState().falls < 1; i++)
    lost.g.update(1 / 60, input([roll.key], []));
  for (let i = 0; i < 70; i++) lost.g.update(1 / 60, input([], []));
  assert.equal(lost.g.getState().lives, RULES.lives - 1);
  const canvas = capture();
  lost.g.draw(canvas.ctx);
  assert.ok(
    canvas.rects.some((q) => q.color === '#4a5578'),
    'a spent life is an outlined ring',
  );
  assert.ok(
    canvas.rects.some((q) => q.color === '#bfe9ff' && q.y < 20),
    'a spare life is solid',
  );
});

test('checkpoint flags: the saved one is solid, the others are outlines', () => {
  const level = 8;
  const { g } = start(level);
  const initial = capture();
  g.draw(initial.ctx);
  const outlines = (c) => c.rects.filter((q) => q.color === '#6a8aa6' && q.w === 6 && q.h === 1);
  const solid = (c) => c.rects.filter((q) => q.color === '#7dff9a' && q.w === 6 && q.h === 4);
  assert.equal(solid(initial).length, 0, 'the start is the saved spot, not a flag');
  assert.equal(outlines(initial).length, 2 * LABS[level - 1].checkpoints.length);
  for (const keys of frameKeys(SOLUTIONS[level - 1]).slice(0, 34 + 54 + 240))
    g.update(1 / 60, input(keys, []));
  const saved = capture();
  g.draw(saved.ctx);
  assert.equal(g.getState().checkpoint.c, 28);
  assert.equal(solid(saved).length, 1);
  assert.equal(outlines(saved).length, 2 * (LABS[level - 1].checkpoints.length - 1));
});
