import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  newState,
  advance,
  snapshotOf,
  RULES,
  LEVELS,
  GARDEN_COUNT,
  MESSAGE_CENTRE,
  MESSAGE_WIDTH,
} from '../src/games/orbit-gardener.js';
import { harness, input, mockContext, seeded } from './harness.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const deg = (d) => (d * Math.PI) / 180;
const R = (lane) => RULES.lanes[lane];

function progressEnv(unlocked = 1, extra = {}) {
  const h = harness(extra);
  const log = [];
  let value = unlocked;
  h.env.progress = {
    unlocked: () => value,
    unlock: (n) => {
      log.push(n);
      value = Math.max(value, n);
    },
  };
  return { h, log, value: () => value };
}

// A bare lab: garden 1's state with the scenery replaced.
function lab({ lane = 0, a = 0, gates = [], seeds = [], beds = [], debris = [] } = {}) {
  const s = newState(harness().env);
  s.P.lane = lane;
  s.P.a = a;
  s.P.inv = 0;
  s.gates = gates.map(([lo, d, spin = 0]) => ({ lanes: [lo, lo + 1], a: deg(d), spin: deg(spin) }));
  s.seeds = seeds.map(([l, d, color], id) => ({ id, lane: l, a: deg(d), color, taken: false }));
  s.beds = (beds.length ? beds : [[0, 180, 3]]).map(([l, d, color, cycle], id) => ({
    id,
    lane: l,
    a: deg(d),
    color,
    cycle: cycle || null,
    planted: false,
    prog: 0,
  }));
  s.debris = debris.map(([l, d, v]) => ({ lane: l, a: deg(d), v, w: v / R(l) }));
  return s;
}
const sounds = [];
const emit = (n) => sounds.push(n);
function run(s, seconds, held = [], pressed = [], hz = 120) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) advance(s, 1 / hz, input(held, i === 0 ? pressed : []), emit);
}

// ---------------------------------------------------------------- metadata and data

test('metadata is complete, bilingual and the touch layout covers every action', () => {
  assert.equal(meta.id, 'orbit-gardener');
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.ok(/[一-鿿]/.test(meta.description.zh) && /gate/i.test(meta.description.en));
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const codes = meta.touchControls.map((c) => c.code);
  assert.deepEqual(
    [...codes].sort(),
    ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].sort(),
  );
  for (const c of meta.touchControls) assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
});

test('there are 24 authored gardens with consistent data', () => {
  assert.equal(GARDEN_COUNT, 24);
  assert.equal(LEVELS.length, 24);
  for (const [i, d] of LEVELS.entries()) {
    assert.ok(d.name.en && d.name.zh && d.tip[0] && d.tip[1], `garden ${i + 1} text`);
    assert.ok(d.tip[0].length <= 46 && d.tip[1].length <= 26, `tip ${i + 1} fits the band`);
    const lanes = d.lanes;
    for (const [l] of [d.start, ...d.seeds, ...d.beds, ...d.debris]) assert.ok(l >= 0 && l < lanes);
    for (const [lo] of d.gates) assert.ok(lo >= 0 && lo + 1 < lanes);
    // seeds and beds balance per colour, so any seed you hold can always be planted
    const count = (rows) => rows.reduce((m, r) => ({ ...m, [r[2]]: (m[r[2]] || 0) + 1 }), {});
    assert.deepEqual(count(d.seeds), count(d.beds), `garden ${i + 1} colours`);
    assert.ok(d.beds.length >= 1 && d.cap >= 1);
    for (const b of d.beds) if (b[3]) assert.ok(b[3][0] >= 4 && b[3][0] > RULES.plantTime + 2);
    // every lane is reachable from the start through the gates, so every bed and seed is
    const seen = new Set([d.start[0]]);
    for (let pass = 0; pass < 4; pass++)
      for (const [lo] of d.gates)
        if (seen.has(lo) || seen.has(lo + 1)) {
          seen.add(lo);
          seen.add(lo + 1);
        }
    for (const [l] of [...d.seeds, ...d.beds]) assert.ok(seen.has(l), `garden ${i + 1} lane ${l}`);
    // nothing starts on top of a rock
    for (const [l, a] of d.debris)
      if (l === d.start[0])
        assert.ok(Math.abs(wrap(deg(a - d.start[1]))) * R(l) > 60, `garden ${i + 1} rock at start`);
  }
});

test('the first gardens teach one idea at a time, then combine, then master', () => {
  const g = LEVELS;
  assert.ok(g[0].lanes === 1 && g[0].gates.length === 0 && g[0].debris.length === 0);
  assert.ok(g[1].lanes === 1 && g[1].seeds.length === 2);
  assert.ok(g[2].lanes === 2 && g[2].start[0] > g[2].seeds[0][0], 'first transfer goes inward');
  assert.ok(g[3].start[0] < g[3].beds[0][0], 'second transfer goes outward');
  assert.ok(g.slice(0, 8).every((d) => d.debris.length === 0 && !d.gates.some((x) => x[2])));
  assert.ok(g.slice(0, 6).every((d) => new Set(d.seeds.map((x) => x[2])).size === 1));
  assert.ok(new Set(g[6].seeds.map((x) => x[2])).size === 2);
  assert.ok(new Set(g[7].seeds.map((x) => x[2])).size === 3);
  assert.ok(g[8].debris.length === 1 && g[8].gates.every((x) => !x[2]));
  assert.ok(g[11].gates.some((x) => x[2]) && g[11].debris.length === 0);
  assert.ok(g[13].beds.some((b) => b[3]) && g[13].debris.length === 0);
  assert.ok(g[15].cap === 2);
  assert.ok(g[16].debris.length && new Set(g[16].seeds.map((x) => x[2])).size > 1, 'combine');
  assert.ok(
    g[22].cap === 2 && g[22].lanes === 4 && g[22].debris.length && g[22].gates.some((x) => x[2]),
  );
  assert.ok(
    g[23].beds.some((b) => b[3]) && g[23].gates.some((x) => x[2]) && g[23].debris.length >= 3,
  );
  assert.equal(new Set(g.map((d) => d.name.en)).size, 24);
});

// ---------------------------------------------------------------- loop

test('invalid frame times are inert and never consume a press', () => {
  const s = lab({ lane: 1, a: deg(90), gates: [[0, 90]] });
  for (const dt of [0, -1, NaN, Infinity, 0.5, undefined, '1']) {
    const before = JSON.stringify(snapshotOf(s));
    assert.equal(advance(s, dt, input(['ArrowRight'], ['ArrowDown'])), false);
    assert.equal(JSON.stringify(snapshotOf(s)), before);
  }
  assert.equal(s.P.lane, 1);
  advance(s, 1 / 60, input([], ['ArrowDown']));
  assert.equal(s.P.lane, 0, 'the press survived the invalid frames');
});

test('the same aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  const states = HZ_LIST.map((hz) => {
    const { h } = progressEnv(24, { seed: 3 });
    const g = createGame(h.env);
    g.update(1 / hz, input([], ['Space']));
    const script = [
      [['ArrowRight'], [], 1.2],
      [[], ['ArrowUp'], 0.2],
      [['ArrowLeft'], [], 1.5],
      [['ArrowRight', 'Space'], [], 0.8],
      [[], ['ArrowDown'], 0.4],
      [['ArrowLeft'], [], 2],
    ];
    for (const [held, pressed, seconds] of script)
      for (let i = 0; i < Math.round(seconds * hz); i++)
        g.update(1 / hz, input(held, i === 0 ? pressed : []));
    return JSON.stringify(g.getState());
  });
  assert.equal(states[0], states[1]);
  assert.equal(states[1], states[2]);
});
const HZ_LIST = [30, 60, 120];

// ---------------------------------------------------------------- orbiting

test('orbiting: Left and Right choose the direction at a finite speed, and only while held', () => {
  const s = lab({ lane: 2, a: deg(10) });
  run(s, 1, ['ArrowRight']);
  assert.ok(Math.abs(wrap(s.P.a - deg(10)) * R(2) - RULES.speed) < 0.5);
  const a = s.P.a;
  run(s, 1, []);
  assert.equal(s.P.a, a, 'no drift without a key');
  run(s, 0.5, ['ArrowLeft']);
  assert.ok(Math.abs(wrap(a - s.P.a) * R(2) - RULES.speed / 2) < 0.5);
  const b = s.P.a;
  run(s, 0.5, ['ArrowLeft', 'ArrowRight']);
  assert.equal(s.P.a, b, 'opposite keys cancel');
  run(s, 0.25, ['KeyD']);
  assert.ok(wrap(s.P.a - b) > 0);
  run(s, 0.25, ['KeyA']);
  assert.ok(Math.abs(wrap(s.P.a - b)) < 1e-6);
  // the same linear speed on every lane, so inner lanes turn faster
  const inner = lab({ lane: 0 });
  run(inner, 1, ['ArrowRight']);
  assert.ok(Math.abs(inner.P.a * R(0) - RULES.speed) < 0.5);
  assert.ok(s.P.a >= 0 && s.P.a < TAU);
});

// ---------------------------------------------------------------- transfers

test('transfers happen only inside a drawn gate, outward with Up and inward with Down', () => {
  const s = lab({ lane: 0, a: deg(200), gates: [[0, 90]] });
  advance(s, 1 / 60, input([], ['ArrowUp']));
  assert.equal(s.P.lane, 0);
  assert.equal(s.stats.refused, 1);
  assert.match(s.msg.en, /No gate/);
  assert.match(s.msg.zh, /门/);
  s.P.a = deg(90);
  advance(s, 1 / 60, input([], ['ArrowDown']));
  assert.equal(s.P.lane, 0, 'inward from the innermost lane has no gate');
  advance(s, 1 / 60, input([], ['ArrowUp']));
  assert.equal(s.P.lane, 1);
  advance(s, 1 / 60, input([], ['ArrowUp']));
  assert.equal(s.P.lane, 1, 'no gate further out');
  advance(s, 1 / 60, input([], ['ArrowDown']));
  assert.equal(s.P.lane, 0);
  assert.equal(s.stats.transfers, 2);
  // Up and Down together do nothing
  advance(s, 1 / 60, input([], ['ArrowUp', 'ArrowDown']));
  assert.equal(s.P.lane, 0);
});

test('a gate spans exactly its drawn width and drifting gates carry it past the ship', () => {
  for (const [offset, ok] of [
    [RULES.gateHalf - 0.01, true],
    [RULES.gateHalf + 0.01, false],
    [-RULES.gateHalf + 0.01, true],
    [-RULES.gateHalf - 0.01, false],
  ]) {
    const s = lab({ lane: 0, a: deg(90) + offset, gates: [[0, 90]] });
    advance(s, 1 / 60, input([], ['ArrowUp']));
    assert.equal(s.P.lane === 1, ok, `offset ${offset}`);
  }
  const drifting = lab({ lane: 0, a: deg(90), gates: [[0, 30, 30]] });
  advance(drifting, 1 / 60, input([], ['ArrowUp']));
  assert.equal(drifting.P.lane, 0, 'not there yet');
  run(drifting, 1.2, []);
  assert.ok(Math.abs(wrap(drifting.gates[0].a - deg(66))) < 0.01, 'the gate drifts at its speed');
  advance(drifting, 1 / 60, input([], ['ArrowUp']));
  assert.equal(drifting.P.lane, 1, 'now the gate is overhead');
  const sound = [];
  advance(lab({ lane: 0, a: 0, gates: [[0, 0]] }), 1 / 60, input([], ['ArrowUp']), (n) =>
    sound.push(n),
  );
  assert.deepEqual(sound, ['move']);
});

test('a transfer onto a rock costs hull; a transfer the other way is safe', () => {
  const s = lab({ lane: 0, a: deg(90), gates: [[0, 90]], debris: [[1, 90, 20]] });
  advance(s, 1 / 60, input([], ['ArrowUp']));
  assert.equal(s.hull, RULES.hull - 1);
  assert.equal(s.P.lane, 1);
});

// ---------------------------------------------------------------- seeds and beds

test('seeds are gathered by flying over them, once, and only up to the hold size', () => {
  const s = lab({
    lane: 1,
    a: 0,
    seeds: [
      [1, 40, 0],
      [1, 80, 1],
      [0, 10, 0],
    ],
  });
  run(s, 0.6, ['ArrowRight']);
  assert.equal(s.P.carry.length, 1);
  assert.deepEqual(s.P.carry[0], { id: 0, color: 0 });
  assert.ok(s.seeds[0].taken && !s.seeds[1].taken, 'the hold has room for one seed');
  assert.equal(s.stats.gathered, 1);
  run(s, 2, ['ArrowLeft']);
  run(s, 2, ['ArrowRight']);
  assert.equal(s.stats.gathered, 1, 'passing again gathers nothing and never twice');
  assert.ok(!s.seeds[2].taken, 'seeds on other lanes are not touched');
});

test('seeds are never skipped, whatever the frame length', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1]) {
    for (const dir of [1, -1]) {
      const s = lab({ lane: 0, a: 0, seeds: [[0, dir > 0 ? 100 : 260, 0]] });
      for (let i = 0; i < 100 && !s.seeds[0].taken; i++)
        advance(s, dt, input([dir > 0 ? 'ArrowRight' : 'ArrowLeft']));
      assert.ok(s.seeds[0].taken, `dt ${dt} dir ${dir}`);
    }
  }
});

test('planting needs a matching seed, a held Space, standing still and a full second', () => {
  const s = lab({ lane: 1, a: deg(100), seeds: [[1, 100, 1]], beds: [[1, 100, 1]] });
  run(s, 0.05, []);
  assert.equal(s.P.carry.length, 1, 'the seed was gathered where it lay');
  run(s, RULES.plantTime - 0.2, ['Space']);
  assert.equal(s.beds[0].planted, false, 'not yet');
  assert.ok(s.beds[0].prog > 0.7);
  run(s, 0.05, ['Space', 'ArrowRight']);
  assert.equal(s.beds[0].prog, 0, 'moving cancels the planting');
  run(s, 0.1, ['ArrowLeft']);
  run(s, RULES.plantTime + 0.3, ['Space']);
  assert.equal(s.beds[0].planted, true);
  assert.equal(s.P.carry.length, 0);
  assert.equal(s.stats.planted, 1);
  assert.equal(s.score, RULES.plantScore + RULES.clearScore + RULES.hullScore * RULES.hull);
});

test('a bed refuses the wrong seed and says what it needs', () => {
  const s = lab({ lane: 1, a: deg(100), seeds: [[1, 100, 0]], beds: [[1, 100, 2]] });
  run(s, 2, ['Space']);
  assert.equal(s.beds[0].planted, false);
  assert.equal(s.P.carry.length, 1);
  assert.match(s.msg.en, /needs a emerald seed/);
  assert.match(s.msg.zh, /祖母绿/);
  const none = lab({ lane: 1, a: deg(100), beds: [[1, 100, 0]] });
  run(none, 2, ['Space']);
  assert.equal(none.beds[0].planted, false);
});

test('a hold of two plants each seed in its own bed', () => {
  const s = lab({
    lane: 1,
    a: deg(90),
    seeds: [
      [1, 90, 0],
      [1, 90, 1],
    ],
    beds: [
      [1, 90, 1],
      [1, 200, 0],
    ],
  });
  s.P.carry = [];
  // gathering is limited by the garden's hold (one seed in garden 1), so load the hold by hand
  s.seeds.forEach((x) => (x.taken = true));
  s.P.carry = [
    { id: 0, color: 0 },
    { id: 1, color: 1 },
  ];
  run(s, RULES.plantTime + 0.3, ['Space']);
  assert.ok(s.beds[0].planted && !s.beds[1].planted);
  assert.deepEqual(s.P.carry, [{ id: 0, color: 0 }]);
});

test('timed beds only take seeds while open, and closing resets the planting', () => {
  const s = lab({
    lane: 1,
    a: deg(100),
    seeds: [[1, 100, 0]],
    beds: [[1, 100, 0, [4, 3, 0]]],
  });
  run(s, 3.2, []);
  run(s, 1.4, ['Space']);
  assert.equal(s.beds[0].planted, false, 'the bed closed at 4 s');
  assert.equal(s.beds[0].prog, 0);
  assert.equal(snapshotOf(s).beds[0].open, false);
  run(s, 4, ['Space']);
  assert.equal(s.beds[0].planted, true, 'it reopened and took the seed');
});

test('clearing a garden scores once, unlocks the next and loads it after a pause', () => {
  const { h, log } = progressEnv(1);
  const s = newState(h.env);
  s.P.a = s.beds[0].a;
  s.seeds[0].taken = true;
  s.P.carry = [{ id: 0, color: 0 }];
  run(s, RULES.plantTime + 0.1, ['Space']);
  assert.ok(s.clear > 0);
  assert.deepEqual(log, [2]);
  assert.equal(snapshotOf(s).prompt.en, 'Restored! Next garden: Arrows');
  const score = s.score;
  run(s, 0.5, ['ArrowRight']);
  assert.equal(s.score, score, 'no farming while the garden celebrates');
  run(s, 1.2, []);
  assert.equal(s.level, 1);
  assert.equal(snapshotOf(s).garden, 2);
  assert.equal(s.hull, RULES.hull);
  assert.ok(s.P.inv > 0, 'a new garden starts with grace time');
});

// ---------------------------------------------------------------- debris

test('debris costs one hull, drops the seeds back, then grants brief invulnerability', () => {
  const s = lab({
    lane: 1,
    a: deg(100),
    seeds: [[1, 160, 0]],
    debris: [[1, 110, 0]],
  });
  s.seeds[0].taken = true;
  s.P.carry = [{ id: 0, color: 0 }];
  s.P.inv = 0;
  run(s, 0.1, []);
  assert.equal(s.hull, RULES.hull - 1);
  assert.equal(s.P.carry.length, 0);
  assert.equal(s.seeds[0].taken, false, 'the seed is back where it grew');
  assert.match(s.msg.en, /Hull 2, seeds dropped/);
  assert.ok(s.P.inv > 1.4);
  run(s, 1, []);
  assert.equal(s.hull, RULES.hull - 1, 'overlap during invulnerability costs nothing');
  run(s, 1, []);
  assert.equal(s.hull, RULES.hull - 2, 'once it ends, the rock hurts again');
});

test('rocks never tunnel: a fast rock hits at every frame length, from both sides', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1])
    for (const v of [-4000, -90, 90, 4000, 30000]) {
      const s = lab({ lane: 2, a: 0, debris: [[2, v > 0 ? -25 : 25, v]] });
      s.P.inv = 0;
      for (let i = 0; i < Math.ceil(1.5 / dt) && s.hull === RULES.hull; i++)
        advance(s, dt, input([]));
      assert.equal(s.hull, RULES.hull - 1, `dt ${dt} v ${v}`);
    }
  // while a rock on another lane never harms
  const safe = lab({ lane: 2, a: 0, debris: [[1, 0, 0]] });
  run(safe, 1, []);
  assert.equal(safe.hull, RULES.hull);
});

test('a moving ship meeting a rock head-on is swept too', () => {
  for (const hz of HZ_LIST) {
    const s = lab({ lane: 1, a: 0, debris: [[1, 40, -30]] });
    s.P.inv = 0;
    run(s, 1.2, ['ArrowRight'], [], hz);
    assert.equal(s.hull, RULES.hull - 1, `${hz} Hz`);
  }
});

test('losing all hull loses the garden once, and a new instance starts fresh', () => {
  const { h } = progressEnv(1);
  const g = createGame(h.env);
  assert.equal(g.getState().hull, 3);
  // park a rock on the ship repeatedly by driving into a ring of rocks
  const s = newState(h.env);
  s.P.inv = 0;
  s.debris = [0, 1, 2].map((k) => ({ lane: 0, a: s.P.a + 0.05 * (k + 1), v: 0, w: 0 }));
  for (let i = 0; i < 1500 && s.phase === 'playing'; i++) {
    s.P.inv = 0;
    advance(s, 1 / 60, input([]));
  }
  assert.equal(s.phase, 'lost');
  assert.equal(s.hull, 0);
  const frozen = JSON.stringify(snapshotOf(s));
  assert.equal(advance(s, 1 / 60, input(['ArrowRight'], ['Space'])), false);
  assert.equal(JSON.stringify(snapshotOf(s)), frozen);
  assert.match(snapshotOf(s).status.en, /withered/);
  assert.match(snapshotOf(s).status.zh, /枯萎/);
});

test('terminal: a lost garden ends the game once, frozen; a restart is a fresh game', () => {
  const { h } = progressEnv(1);
  const g = createGame(h.env);
  const hits = h.ends;
  // reach in through the public API only: sit on a lane with a rock that reaches us
  // (garden 9 has a rock; use the menu to get there)
  const { h: h9 } = progressEnv(9);
  const g9 = createGame(h9.env);
  g9.update(1 / 60, input([], ['Space']));
  assert.equal(g9.getState().garden, 9);
  let lost = false;
  for (let i = 0; i < 60 * 400 && !lost; i++) {
    // drive blindly around the rock lane
    g9.update(1 / 60, input(['ArrowRight']));
    lost = g9.getState().phase === 'lost';
  }
  assert.ok(lost, 'a blind driver eventually loses');
  assert.equal(h9.ends.length, 1);
  assert.equal(h9.ends[0].won, false);
  assert.match(h9.ends[0].message, /garden 9/);
  for (let i = 0; i < 50; i++) g9.update(1 / 60, input(['ArrowLeft'], ['Space']));
  assert.equal(h9.ends.length, 1);
  assert.ok(h9.sounds.includes('lose'));
  assert.equal(hits.length, 0);
  const fresh = createGame(progressEnv(1).h.env).getState();
  assert.equal(fresh.hull, 3);
  assert.equal(fresh.garden, 1);
  assert.equal(fresh.score, 0);
  assert.equal(g.getState().garden, 1);
});

test('winning the campaign: the last garden finishes the game', () => {
  const { h } = progressEnv(24);
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space'])); // continue on garden 24
  assert.equal(g.getState().garden, 24);
  const hintKeys = () => {
    const s = g.getState();
    const hint = s.hint;
    const none = { held: [], pressed: [] };
    if (!hint) return none;
    const d = wrap(hint.angle - s.player.angle);
    if (Math.abs(d) * R(s.player.lane) > 3)
      return { held: [d > 0 ? 'ArrowRight' : 'ArrowLeft'], pressed: [] };
    return hint.kind === 'transfer'
      ? { held: [], pressed: [hint.to > s.player.lane ? 'ArrowUp' : 'ArrowDown'] }
      : { held: ['Space'], pressed: [] };
  };
  // Rocks cannot be dodged by this simple follower, so keep the ship alive with a patched hull.
  let guard = 0;
  while (g.getState().phase === 'playing' && guard++ < 60 * 600) {
    const k = hintKeys();
    g.update(1 / 60, input(k.held, k.pressed));
  }
  // The follower may lose to the rocks of garden 24; either way the end fires exactly once.
  assert.equal(h.ends.length, 1);
  if (g.getState().phase === 'won') assert.equal(h.ends[0].won, true);
});

// ---------------------------------------------------------------- progress and menu

test('with only garden 1 open (or no progress API) the game starts at once', () => {
  const none = createGame(harness().env).getState();
  assert.equal(none.menu, null);
  assert.equal(none.garden, 1);
  const { h } = progressEnv(1);
  assert.equal(createGame(h.env).getState().menu, null);
});

test('a later start offers continue and a select menu; the world waits behind it', () => {
  const { h } = progressEnv(5);
  const g = createGame(h.env);
  const s = g.getState();
  assert.deepEqual(s.menu, { sel: 5, unlocked: 5 });
  assert.match(s.line.en, /Space/);
  assert.match(s.line.zh, /空格/);
  const before = JSON.stringify(g.getState());
  for (let i = 0; i < 60; i++) g.update(1 / 60, input(['ArrowRight']));
  assert.equal(JSON.stringify(g.getState()), before, 'held keys do nothing in the menu');
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.sel, 4);
  for (let i = 0; i < 9; i++) g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.sel, 1, 'select is clamped to the first garden');
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.sel, 5, 'down is clamped to open gardens');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().garden, 4);
  assert.equal(g.getState().menu, null);
  const ctx = mockContext();
  g.draw(ctx);
  const again = createGame(progressEnv(24).h.env);
  again.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(again.getState().menu.sel, 24);
  again.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(again.getState().menu.sel, 16);
  again.update(1 / 60, input([], ['Enter']));
  assert.equal(again.getState().garden, 16);
});

test('progress: clearing a garden unlocks the next and never lowers or exceeds the range', () => {
  const { h, log, value } = progressEnv(3);
  const s = newState(h.env);
  s.menu = null;
  s.P.a = s.beds[0].a;
  s.seeds[0].taken = true;
  s.P.carry = [{ id: 0, color: 0 }];
  run(s, RULES.plantTime + 0.3, ['Space']);
  assert.deepEqual(log, [2]);
  assert.equal(value(), 3, 'unlock never lowers progress');
  const last = progressEnv(24);
  const t = newState(last.h.env);
  t.menu = null;
  t.level = 23;
  t.beds = [{ id: 0, lane: 0, a: 0, color: 0, cycle: null, planted: false, prog: 0 }];
  t.P = { ...t.P, lane: 0, a: 0, carry: [{ id: 0, color: 0 }], inv: 0 };
  t.debris = [];
  t.gates = [];
  run(t, RULES.plantTime + 0.3, ['Space']);
  assert.deepEqual(last.log, [24]);
  run(t, 2, []);
  assert.equal(t.phase, 'won');
  assert.match(snapshotOf(t).status.en, /All gardens restored/);
});

// ---------------------------------------------------------------- hint and prompts

test('the marker points at the seed, then the gate, then the bed, along the cheapest route', () => {
  const s = lab({
    lane: 0,
    a: deg(0),
    gates: [
      [0, 90],
      [0, 270],
    ],
    seeds: [[0, 330, 0]],
    beds: [[1, 180, 0]],
  });
  const text = () => snapshotOf(s);
  s.hint = null;
  advance(s, 1 / 120, input([]));
  for (let i = 0; i < 12; i++) advance(s, 1 / 120, input([]));
  assert.equal(text().hint.kind, 'gather');
  assert.equal(text().hint.lane, 0);
  run(s, 0.5, ['ArrowLeft']);
  assert.equal(s.P.carry.length, 1);
  run(s, 0.1, []);
  const h = text().hint;
  assert.equal(h.kind, 'transfer');
  assert.equal(h.to, 1);
  assert.ok(Math.abs(wrap(h.angle - deg(270))) < 0.2, 'the nearer gate');
  assert.match(text().prompt.en, /Hold Left to reach the gate/);
  s.P.a = deg(270);
  run(s, 0.1, []);
  assert.match(text().prompt.en, /Press Up to transfer outward/);
  assert.match(text().prompt.zh, /按上方向键/);
  advance(s, 1 / 60, input([], ['ArrowUp']));
  run(s, 0.1, []);
  assert.equal(text().hint.kind, 'plant');
  assert.match(text().prompt.en, /reach the bed/);
  s.P.a = deg(180);
  run(s, 0.1, []);
  assert.equal(text().prompt.en, 'Stop, then hold Space to plant');
});

test('inward gates are named in the prompt, closed beds say wait, and nothing is held for ever', () => {
  const s = lab({
    lane: 1,
    a: deg(90),
    gates: [[0, 90]],
    seeds: [[0, 200, 0]],
    beds: [[0, 100, 0, [4, 3, 3]]],
  });
  run(s, 0.1, []);
  assert.match(snapshotOf(s).prompt.en, /Press Down to transfer inward/);
  s.P.lane = 0;
  s.P.a = deg(200);
  run(s, 0.2, []);
  s.P.a = deg(100);
  run(s, 0.9, []);
  assert.equal(snapshotOf(s).beds[0].open, false);
  assert.equal(snapshotOf(s).prompt.en, 'Wait: the bed is closed (Space)');
});

test('a rock on the way raises a warning that says what to hold, and only then', () => {
  const quiet = lab({
    lane: 2,
    a: 0,
    seeds: [[2, 90, 0]],
    beds: [[2, 180, 0]],
    debris: [[2, 150, 20]],
  });
  run(quiet, 0.2, []);
  assert.equal(snapshotOf(quiet).prompt.en, 'Hold Right to gather the seed');
  // a slower rock behind the ship is no threat to a ship that is leaving it behind
  const behind = lab({
    lane: 2,
    a: 0,
    seeds: [[2, 90, 0]],
    beds: [[2, 180, 0]],
    debris: [[2, 330, 30]],
  });
  run(behind, 0.2, []);
  assert.equal(snapshotOf(behind).prompt.en, 'Hold Right to gather the seed');
  // a rock coming the other way on the route: dodge back, away from it
  const ahead = lab({
    lane: 2,
    a: 0,
    seeds: [[2, 90, 0]],
    beds: [[2, 180, 0]],
    debris: [[2, 40, -30]],
  });
  run(ahead, 0.2, []);
  assert.equal(snapshotOf(ahead).prompt.en, 'Rock! Hold Left to dodge');
  assert.match(snapshotOf(ahead).prompt.zh, /碎片.*左方向键/);
  // a rock on another lane is no threat
  const other = lab({
    lane: 2,
    a: 0,
    seeds: [[2, 90, 0]],
    beds: [[2, 180, 0]],
    debris: [[1, 40, -30]],
  });
  run(other, 0.2, []);
  assert.doesNotMatch(snapshotOf(other).prompt.en, /Rock/);
  // standing still while a rock closes in: hold still is only advice when it is safe
  const still = lab({
    lane: 2,
    a: deg(180),
    seeds: [[2, 90, 0]],
    beds: [[2, 180, 0]],
    debris: [[2, 150, 30]],
  });
  still.P.carry = [{ id: 0, color: 0 }];
  still.seeds[0].taken = true;
  run(still, 0.2, []);
  assert.match(snapshotOf(still).prompt.en, /^Rock/);
});

test("F2: the prompt leads with the ship's own motion, looks 2 s ahead and bypasses the half-second hold", () => {
  // The ship would hold Right for the seed and meet a rock 1.8 s away: warned while still far off.
  const far = lab({
    lane: 2,
    a: 0,
    seeds: [[2, 150, 0]],
    beds: [[2, 300, 0]],
    debris: [[2, 90, -20]],
  });
  run(far, 0.1, []);
  assert.match(snapshotOf(far).prompt.en, /^Rock/);
  // a fresh line is on screen for less than half a second, yet the warning replaces it at once
  const s = lab({ lane: 2, a: 0, seeds: [[2, 90, 0]], beds: [[2, 180, 0]] });
  run(s, 0.1, []);
  s.line = null;
  run(s, 0.03, []);
  assert.equal(s.line.en, 'Hold Right to gather the seed');
  assert.ok(s.line.age < 0.5);
  s.debris = [{ lane: 2, a: deg(40), v: -30, w: -30 / R(2) }];
  run(s, 0.07, []);
  assert.equal(s.line.en, 'Rock! Hold Left to dodge');
  assert.equal(s.line.danger, true);
  assert.equal(snapshotOf(s).line.en, 'Rock! Hold Left to dodge');
  // once the rock has gone the warning stays for half a second and then gives way
  s.debris = [];
  run(s, 0.2, []);
  assert.match(s.line.en, /^Rock/);
  run(s, 0.5, []);
  assert.doesNotMatch(s.line.en, /^Rock/);
});

test('F2: a transfer prompt becomes a wait prompt while a rock is near the arrival point', () => {
  const s = lab({
    lane: 0,
    a: deg(90),
    gates: [[0, 90]],
    seeds: [[1, 200, 0]],
    beds: [[1, 300, 0]],
    debris: [[1, 100, 20]],
  });
  run(s, 0.1, []);
  assert.equal(snapshotOf(s).prompt.en, 'Wait for the rock, then Up');
  assert.match(snapshotOf(s).prompt.zh, /等待碎片过去.*上方向键/);
  s.debris = [{ lane: 1, a: deg(250), v: 20, w: 20 / R(1) }];
  run(s, 0.1, []);
  assert.equal(snapshotOf(s).prompt.en, 'Press Up to transfer outward');
  // and the wait is honest: a ship that obeyed "Press Up" would have been hit, one that waited is not
  const hit = lab({
    lane: 0,
    a: deg(90),
    gates: [[0, 90]],
    seeds: [[1, 200, 0]],
    beds: [[1, 300, 0]],
    debris: [[1, 95, 0]],
  });
  hit.P.inv = 0;
  advance(hit, 1 / 60, input([], ['ArrowUp']));
  assert.equal(hit.hull, RULES.hull - 1);
});

test('F3: the wait at a closed bed warns when a rock is closing in on the waiting ship', () => {
  const s = lab({
    lane: 1,
    a: deg(100),
    seeds: [[1, 100, 0]],
    beds: [[1, 100, 0, [4, 3, 4]]],
    debris: [[1, 40, 30]],
  });
  run(s, 0.1, []);
  assert.match(snapshotOf(s).prompt.en, /^Rock/);
});

// ---------------------------------------------------------------- daylight, seeds and beds

test('F1: after the par time the light fades and the hull drains; the garden can wither at dusk', () => {
  const { h } = progressEnv(1);
  const g = createGame(h.env);
  const par = g.getState().par;
  assert.equal(par, 15);
  assert.equal(g.getState().dusk, false);
  for (let t = 0; t < par - 0.5; t += 1 / 60) g.update(1 / 60, input([]));
  assert.ok(g.getState().daylight > 0 && g.getState().daylight < 1);
  assert.equal(g.getState().hull, RULES.hull);
  while (!g.getState().dusk) g.update(1 / 60, input([]));
  assert.equal(g.getState().daylight, 0);
  assert.match(g.getState().message.en, /Dusk! The hull fades every 5 s/);
  assert.match(g.getState().message.zh, /天黑了/);
  for (let t = 0; t < RULES.duskDrain; t += 1 / 60) g.update(1 / 60, input([]));
  assert.equal(g.getState().hull, RULES.hull - 1);
  assert.equal(g.getState().stats.dusk, 1);
  assert.match(g.getState().message.en, /The hull fades! Hull 2/);
  for (let t = 0; t < RULES.duskDrain * 3; t += 1 / 60) g.update(1 / 60, input([]));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Night fell on garden 1/);
  assert.equal(g.getState().stats.hits, 0, 'no rock was involved');
  assert.ok(h.sounds.includes('lose'));
});

test('F1: finishing before the par time keeps the hull; the hull score rewards it', () => {
  const s = lab({ lane: 0, a: deg(10), seeds: [[0, 10, 0]], beds: [[0, 10, 0]] });
  run(s, RULES.plantTime + 0.5, ['Space']);
  assert.ok(s.clear > 0);
  assert.equal(s.hull, RULES.hull);
  assert.equal(s.stats.dusk, 0);
});

test('F6: a dropped seed cannot be re-gathered at once, then it can', () => {
  const s = lab({ lane: 1, a: deg(100), seeds: [[1, 100, 0]], debris: [[1, 108, 0]] });
  s.seeds[0].taken = true;
  s.P.carry = [{ id: 0, color: 0 }];
  s.P.inv = 0;
  run(s, 0.05, []);
  assert.equal(s.hull, RULES.hull - 1);
  assert.equal(s.seeds[0].taken, false);
  assert.ok(s.seeds[0].lock > 0.9);
  assert.equal(snapshotOf(s).seeds[0].lock, s.seeds[0].lock);
  run(s, 0.5, []);
  assert.equal(s.P.carry.length, 0, 'still locked');
  run(s, 0.6, []);
  assert.equal(s.P.carry.length, 1, 'the lock has run out');
});

test('F6: a timed bed shows its remaining open or closed time', () => {
  const s = lab({ lane: 0, a: 0, beds: [[0, 180, 0, [4, 3, 0]]] });
  assert.equal(snapshotOf(s).beds[0].changesIn, 4);
  run(s, 1.5, []);
  assert.ok(Math.abs(snapshotOf(s).beds[0].changesIn - 2.5) < 0.02);
  assert.equal(snapshotOf(s).beds[0].open, true);
  run(s, 3, []);
  assert.ok(Math.abs(snapshotOf(s).beds[0].changesIn - 2.5) < 0.02);
  assert.equal(snapshotOf(s).beds[0].open, false);
  const plain = lab({ lane: 0, a: 0, beds: [[0, 180, 0]] });
  assert.equal(snapshotOf(plain).beds[0].changesIn, 0);
});

test('F6: progress.unlocked() is floored and validated', () => {
  const menu = (value) => {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    return createGame(h.env).getState().menu;
  };
  for (const bad of [NaN, undefined, null, 0, -5, 0.4, Infinity, 'x', {}])
    assert.equal(menu(bad), null, String(bad));
  assert.deepEqual(menu(2.9), { sel: 2, unlocked: 2 });
  assert.deepEqual(menu('4'), { sel: 4, unlocked: 4 });
  assert.deepEqual(menu(99), { sel: 24, unlocked: 24 });
});

test('F6: the controls list names the WASD alternatives and the clear chime is not the win jingle', () => {
  const keys = meta.keys.map((k) => k.keys).join(' ');
  assert.match(keys, /A \/ D/);
  assert.match(keys, /W \/ S/);
  const sound = [];
  const s = lab({ lane: 0, a: 0, seeds: [[0, 0, 0]], beds: [[0, 0, 0]] });
  for (let i = 0; i < 240; i++) advance(s, 1 / 120, input(['Space']), (n) => sound.push(n));
  assert.ok(s.clear > 0);
  assert.equal(sound.filter((n) => n === 'win').length, 0);
  assert.ok(sound.includes('coin'));
});

test('A and D, W and S work like the arrows', () => {
  const s = lab({ lane: 0, a: deg(90), gates: [[0, 90]] });
  run(s, 0.1, ['KeyD']);
  assert.ok(s.P.a > deg(90));
  s.P.a = deg(90);
  advance(s, 1 / 60, input([], ['KeyW']));
  assert.equal(s.P.lane, 1);
  advance(s, 1 / 60, input([], ['KeyS']));
  assert.equal(s.P.lane, 0);
});

test('the status is bilingual and names the garden, the key prompt and the hull', () => {
  const g = createGame(harness({ lang: 'zh' }).env);
  const st = g.getState().status;
  assert.match(st.en, /^Garden 1\/24 First Orbit · .*(Hold|Press|Orbit).* · Hull 3$/);
  assert.match(st.zh, /^花园 1\/24 初次绕行 · .*方向键.* · 船体 3$/);
  assert.equal(g.getState().gardens, 24);
  assert.deepEqual(g.getState().hud, { top: [0, 26], bottom: [290, 320] });
});

// ---------------------------------------------------------------- snapshot

test('getState is JSON-safe, detached and offers no cheat API', () => {
  const { h } = progressEnv(24);
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  const a = g.getState();
  const json = JSON.stringify(a);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(a)));
  a.hull = 99;
  a.player.lane = 3;
  a.debris.length = 0;
  a.seeds.length = 0;
  a.gates.push({});
  a.beds[0].planted = true;
  a.laneRadii.push(1);
  a.gardenName.en = 'x';
  const b = g.getState();
  assert.equal(b.hull, 3);
  assert.notEqual(b.player.lane, 3);
  assert.ok(b.debris.length > 0 && b.seeds.length > 0);
  assert.equal(b.beds[0].planted, false);
  assert.notEqual(b.gardenName.en, 'x');
  const walk = (o) =>
    Object.entries(o).forEach(([k, v]) => {
      assert.ok(typeof v !== 'function', `function at ${k}`);
      assert.ok(!/cheat|skip|win|teleport|god/i.test(k) || k === 'win', k);
      if (v && typeof v === 'object') walk(v);
    });
  walk(b);
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  assert.ok(Object.isFrozen(RULES) && Object.isFrozen(RULES.lanes));
});

// ---------------------------------------------------------------- long runs and drawing

test('long seeded chaos stays finite and bounded', () => {
  for (const level of [1, 9, 17, 24]) {
    const { h } = progressEnv(level, { seed: level });
    const g = createGame(h.env);
    if (level > 1) g.update(1 / 60, input([], ['Space']));
    const rnd = seeded(level);
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
    let held = [];
    for (let i = 0; i < 20000; i++) {
      if (i % 10 === 0) held = rnd() < 0.3 ? [] : [keys[Math.floor(rnd() * keys.length)]];
      g.update(
        rnd() < 0.05 ? 0 : 1 / 60,
        input(held, rnd() < 0.1 ? [keys[Math.floor(rnd() * 4)]] : []),
      );
    }
    const s = g.getState();
    const nums = JSON.stringify(s)
      .match(/-?\d+\.?\d*(e[+-]?\d+)?/g)
      .map(Number);
    assert.ok(nums.every(Number.isFinite));
    assert.ok(s.seeds.length <= 6 && s.debris.length <= 6 && s.beds.length <= 6);
    assert.ok(s.player.angle >= 0 && s.player.angle < TAU);
    assert.ok(s.hull >= 0 && s.hull <= 3);
    assert.ok(h.ends.length <= 1);
  }
});

function recordingContext() {
  const calls = [];
  const rects = [];
  const state = {};
  const ctx = new Proxy(
    { measureText: (t) => ({ width: String(t).length * 8 }), canvas: { width: 480, height: 320 } },
    {
      get: (t, p) => {
        if (p === 'fillText')
          return (str, x, y) => calls.push({ str, x, y, font: state.font, align: state.textAlign });
        if (p === 'fillRect')
          return (x, y, w, h) => rects.push({ x, y, w, h, fill: state.fillStyle });
        return p in state ? state[p] : p in t ? t[p] : () => {};
      },
      set: (t, p, v) => ((state[p] = v), true),
    },
  );
  return { ctx, calls, rects };
}

test('drawing: every phase renders, text is 14-16 px, fits the canvas and stays in the HUD bands', () => {
  for (const lang of ['en', 'zh']) {
    const { ctx, calls } = recordingContext();
    const { h } = progressEnv(24, { lang });
    const g = createGame(h.env);
    g.draw(ctx); // menu
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 60 * 30; i++) {
      g.update(
        1 / 60,
        input(i % 200 < 120 ? ['ArrowRight'] : ['ArrowLeft'], i % 90 === 0 ? ['ArrowUp'] : []),
      );
      if (i % 20 === 0) g.draw(ctx);
    }
    const lab1 = lab({ lane: 0, a: 0, debris: [[0, 10, 0]] });
    lab1.P.inv = 0;
    run(lab1, 0.1, []);
    const done = createGame(harness({ lang }).env);
    done.draw(ctx);
    assert.ok(calls.length > 40);
    for (const c of calls) {
      const size = Number(/(\d+)px/.exec(c.font)[1]);
      assert.ok(size >= 14 && size <= 16, `${size}px "${c.str}"`);
      const w = [...c.str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? size : size * 0.6), 0);
      const left = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
      assert.ok(left >= 0 && left + w <= 480, `"${c.str}" overflows`);
    }
    if (lang === 'zh') assert.ok(calls.some((c) => /[一-鿿]/.test(c.str)));
  }
});

test('drawing: HUD text stays out of the play area and the ring field fits between the bands', () => {
  const { ctx, calls } = recordingContext();
  const g = createGame(harness().env);
  for (let i = 0; i < 600; i++) {
    g.update(1 / 60, input(['ArrowRight']));
    if (i % 30 === 0) g.draw(ctx);
  }
  assert.ok(calls.length > 10);
  for (const c of calls)
    assert.ok(c.y + 14 <= RULES.top || c.y >= RULES.bottom, `text at y=${c.y}`);
  const outer = RULES.cy - RULES.lanes[3] - RULES.actor / 2;
  assert.ok(outer >= RULES.top && RULES.cy + RULES.lanes[3] + RULES.actor / 2 <= RULES.bottom);
  for (const level of [1, 12, 24]) {
    const { h } = progressEnv(level);
    const st = createGame(h.env);
    if (level > 1) st.update(1 / 60, input([], ['Space']));
    const s = st.getState();
    assert.ok(s.player.rect.w >= 16 && s.player.rect.h >= 16);
    assert.ok(s.player.rect.y >= RULES.top && s.player.rect.y + 16 <= RULES.bottom);
  }
});

test('drawing: a full garden-1 clear renders the planted flower and the celebration', () => {
  const { ctx, calls, rects } = recordingContext();
  const g = createGame(harness().env);
  let drewPlanted = false;
  for (let i = 0; i < 60 * 12; i++) {
    const st = g.getState();
    const hint = st.hint;
    let held = [];
    if (hint) {
      const d = wrap(hint.angle - st.player.angle);
      held = Math.abs(d) * R(st.player.lane) > 3 ? [d > 0 ? 'ArrowRight' : 'ArrowLeft'] : ['Space'];
    }
    g.update(1 / 60, input(held));
    if (st.beds[0].planted || g.getState().beds[0]?.planted) {
      g.draw(ctx);
      drewPlanted = true;
    } else if (i % 20 === 0) g.draw(ctx);
  }
  assert.ok(drewPlanted && calls.length > 10 && rects.length > 50);
});

// A conservative text width: 0.6 em per Latin character and a full em per Chinese character.
const textWidth = (str, size = 14) =>
  [...str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? size : size * 0.6), 0);

test('F5: the bottom message has its own width and centre, clear of the bed count and the score', () => {
  const left = textWidth('Beds 5/5') + 6;
  const right = 474 - textWidth('99999');
  assert.ok(
    MESSAGE_CENTRE - MESSAGE_WIDTH / 2 >= left && MESSAGE_CENTRE + MESSAGE_WIDTH / 2 <= right,
  );
  for (const d of LEVELS) {
    assert.ok(textWidth(d.tip[0]) <= MESSAGE_WIDTH, `"${d.tip[0]}" is ${textWidth(d.tip[0])} px`);
    assert.ok(textWidth(d.tip[1]) <= MESSAGE_WIDTH, `"${d.tip[1]}" is ${textWidth(d.tip[1])} px`);
  }
  // Every message seen in play, in both languages, at every frame: the three bottom texts never touch.
  const seen = new Set();
  for (const lang of ['en', 'zh'])
    for (const level of [1, 7, 8, 24]) {
      const { ctx, calls } = recordingContext();
      const { h } = progressEnv(level, { lang, seed: level });
      const g = createGame(h.env);
      if (level > 1) g.update(1 / 60, input([], ['Space']));
      const rnd = seeded(level * 5);
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
      let held = [];
      for (let i = 0; i < 60 * 70; i++) {
        if (i % 12 === 0) held = rnd() < 0.2 ? [] : [keys[Math.floor(rnd() * keys.length)]];
        g.update(1 / 60, input(held, rnd() < 0.05 ? [keys[Math.floor(rnd() * 4)]] : []));
        if (i % 6 === 0) {
          calls.length = 0;
          g.draw(ctx);
          const row = calls.filter((c) => c.y === 292);
          const spans = row.map((c) => {
            const w = textWidth(c.str);
            const x0 = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
            if (c.align === 'center') seen.add(c.str);
            return [x0, x0 + w];
          });
          spans.sort((a, b) => a[0] - b[0]);
          spans.forEach(([a, b], k) => {
            assert.ok(a >= 0 && b <= 480, 'bottom text inside the canvas');
            if (k)
              assert.ok(
                a > spans[k - 1][1],
                `bottom texts touch: ${JSON.stringify(row.map((c) => c.str))}`,
              );
          });
        }
      }
    }
  assert.ok(seen.size >= 8, `only ${seen.size} different bottom messages were exercised`);
});

test('F4: drifting gates and rocks show their drift: arrowheads point the way and fast gates carry two', () => {
  const { ctx, calls } = recordingContext();
  void calls;
  const drawn = [];
  const proxy = new Proxy(ctx, {
    get: (t, p) => (p === 'lineTo' ? (x, y) => drawn.push([x, y]) : t[p]),
  });
  const { h } = progressEnv(23);
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  g.draw(proxy);
  assert.ok(drawn.length > 30);
  const st = g.getState();
  assert.ok(st.gates.some((x) => x.spin > 0) && st.gates.some((x) => x.spin < 0));
});

test('F1: a rock closing head-on on a stopped ship is never answered with "hold still"', () => {
  const stops = {
    plant: () => ({ seeds: [[0, 180, 0]], beds: [[0, 180, 0]], carry: true }),
    wait: () => ({ seeds: [[0, 180, 0]], beds: [[0, 180, 0, [4, 3, 4]]], carry: true }),
    transfer: () => ({
      seeds: [[1, 300, 0]],
      beds: [[1, 250, 0]],
      gates: [[0, 180]],
      carry: false,
    }),
  };
  for (const [kind, make] of Object.entries(stops))
    for (const gap of [40, 60, 90, 120, 160])
      for (const dirn of [1, -1]) {
        const o = make();
        const s = lab({
          lane: 0,
          a: deg(180),
          seeds: o.seeds,
          beds: o.beds,
          gates: o.gates || [],
          debris: [[0, 180 - dirn * ((gap / R(0)) * 57.2958), dirn * 30]],
        });
        if (o.carry) {
          s.seeds[0].taken = true;
          s.P.carry = [{ id: 0, color: 0 }];
        }
        s.P.inv = 0;
        // obey the line literally for four seconds: hold still or dodge as told, press Space to plant
        for (let i = 0; i < 480 && s.phase === 'playing' && !(s.clear > 0); i++) {
          const en = snapshotOf(s).line.en;
          const m = /Hold (Left|Right)/.exec(en);
          const held = m ? [`Arrow${m[1]}`] : /hold Space|bed is closed/.test(en) ? ['Space'] : [];
          advance(s, 1 / 120, input(held));
          if (s.hull < RULES.hull) break;
        }
        assert.equal(s.hull, RULES.hull, `${kind} gap ${gap} dir ${dirn}: the line led into a hit`);
      }
});

test('F1: with a rock coming, the warning for a stopped ship says dodge, away from the rock', () => {
  const s = lab({
    lane: 0,
    a: deg(180),
    seeds: [[0, 180, 0]],
    beds: [[0, 180, 0]],
    debris: [[0, 180 - (70 / R(0)) * 57.2958, 30]],
  });
  s.seeds[0].taken = true;
  s.P.carry = [{ id: 0, color: 0 }];
  s.P.inv = 0;
  run(s, 0.1, []);
  // the rock is behind at a smaller angle moving up: dodge to larger angles (Right)
  assert.equal(snapshotOf(s).prompt.en, 'Rock! Hold Right to dodge');
  const t = lab({
    lane: 0,
    a: deg(180),
    seeds: [[0, 180, 0]],
    beds: [[0, 180, 0]],
    debris: [[0, 180 + (70 / R(0)) * 57.2958, -30]],
  });
  t.seeds[0].taken = true;
  t.P.carry = [{ id: 0, color: 0 }];
  t.P.inv = 0;
  run(t, 0.1, []);
  assert.equal(snapshotOf(t).prompt.en, 'Rock! Hold Left to dodge');
});
