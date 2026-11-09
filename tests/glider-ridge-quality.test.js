import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  createGliderState,
  stepGlider,
  drawGlider,
  COURSES,
  terrainAt,
} from '../src/games/glider-ridge.js';
import { wrapTip, menuCell } from '../src/games/glider-ridge-menu.js';
import { harness, input, mockContext, seeded } from './harness.js';

const LEVELS = COURSES.length;
const MASTERY = [15, 16, 17, 18, 19, 20];

// ---- Reaction-limited bot: reads only getState().status (the line the game shows) -------------

const keysFor = (text) => {
  const keys = [];
  if (/Hold Space to flare/.test(text)) keys.push('Space');
  if (/hold Left|Keep turning/i.test(text)) keys.push('ArrowLeft');
  if (/Steer Left/.test(text)) keys.push('ArrowLeft');
  if (/Steer Right/.test(text)) keys.push('ArrowRight');
  if (/hold Up/i.test(text)) keys.push('ArrowUp');
  if (/STALL|Lower the nose/.test(text)) keys.push('ArrowDown');
  return keys;
};

function startAt(level, { lang = 'en', seed = 1, store } = {}) {
  const h = harness({ lang, seed }),
    saved = [],
    progress = store ?? { unlocked: () => level, unlock: (n) => saved.push(n) },
    game = createGame({ ...h.env, progress });
  return { h, game, saved };
}

// Plays one course through the public API. The bot sees the state `delay` seconds late and
// decides every 0.1-0.2 s, so it reacts like a slow human. It never reads hidden timers.
function playLevel(level, { hz = 60, delay = 0.3, seed = 1, lang = 'en', limit = 480 } = {}) {
  const { h, game, saved } = startAt(level, { lang, seed });
  const random = seeded(seed * 9973 + level * 31 + hz),
    dt = 1 / hz,
    history = [];
  let now = 0,
    nextDecision = 0,
    nextSnapshot = 0,
    keys = [],
    confirm = false,
    state = game.getState(),
    lowest = 3;
  if (level > 1) game.update(dt, input([], ['Space']));
  while (now < limit) {
    if (now >= nextSnapshot) {
      state = game.getState();
      history.push({ t: now, text: state.status.en, playing: state.phase === 'playing' });
      if (history.length > 20) history.shift();
      nextSnapshot = now + 0.05;
      lowest = Math.min(lowest, state.attemptsLeft);
      if (['landed', 'won', 'lost'].includes(state.phase)) break;
    }
    if (now >= nextDecision) {
      const seen = [...history].reverse().find((o) => o.t <= now - delay) ?? history[0];
      keys = keysFor(seen.text);
      confirm = !seen.playing;
      nextDecision = now + 0.1 + random() * 0.1;
    }
    const playing = state.phase === 'playing';
    game.update(dt, input(playing ? keys : [], !playing && confirm ? ['Space'] : []));
    now += dt;
  }
  return {
    cleared: state.phase === 'landed' || state.phase === 'won',
    lost: 3 - lowest,
    seconds: now,
    score: state.score,
    game,
    h,
    saved,
  };
}

// ---- Level data ----------------------------------------------------------------------------

test('glider quality: twenty distinct, bilingual, data-driven courses with a rising curve', () => {
  assert.equal(LEVELS, 20);
  assert.ok(Object.isFrozen(COURSES) && Object.isFrozen(COURSES[0].gates[0]));
  assert.equal(new Set(COURSES.map((c) => c.name.en)).size, LEVELS);
  assert.equal(new Set(COURSES.map((c) => c.brief.en)).size, LEVELS);
  for (const c of COURSES) {
    assert.ok(c.name.en && /\p{Script=Han}/u.test(c.name.zh));
    assert.ok(c.brief.en && /\p{Script=Han}/u.test(c.brief.zh));
    assert.ok(c.brief.en.length <= 45, c.brief.en);
    assert.ok(c.brief.zh.length <= 30, c.brief.zh);
    assert.ok(c.gates.length >= 3);
    for (const g of c.gates) {
      assert.ok(Math.abs(g.z) + g.hw <= c.half);
      assert.ok(g.h - g.lo >= terrainAt(c, g.x, g.z) + 5, `${c.name.en} gate floor`);
    }
    assert.ok(c.start.h - terrainAt(c, 0, 0) >= 25, 'launch clearance');
    const pad = [];
    for (let x = c.zone.x0; x <= c.zone.x1; x += 5) pad.push(terrainAt(c, x, 0));
    assert.ok(Math.max(...pad) - Math.min(...pad) < 1e-9, 'pad is flat');
    const last = c.gates.at(-1);
    assert.ok(last.h - (c.zone.x0 - last.x) / 9 - terrainAt(c, c.zone.x0 + 5, 0) >= 15);
  }
  const feature = (c) => c.gates.length + c.thermals.length + c.wind.length + c.ridges.length;
  const mean = (list) => list.reduce((a, c) => a + feature(c), 0) / list.length;
  assert.ok(mean(COURSES.slice(0, 7)) < mean(COURSES.slice(7, 14)));
  assert.ok(mean(COURSES.slice(7, 14)) < mean(COURSES.slice(14)));
});

test('glider quality: every tip describes what its course really contains', () => {
  const by = (n) => COURSES[n - 1];
  const opposite = (c) => c.wind.some((w) => w.wz > 0) && c.wind.some((w) => w.wz < 0);
  const alternates = (c) =>
    c.gates.every((g, i) => i === 0 || Math.sign(g.z) === -Math.sign(c.gates[i - 1].z));
  const narrow = (c, total) => c.gates.every((g) => g.lo + g.hi <= total);
  const checks = {
    1: (c) => c.ridges.some((r) => r.w > 0),
    2: (c) => c.gates.some((g) => g.z !== 0) && c.thermals.length === 0,
    3: (c) =>
      c.thermals.length === 1 && c.thermals[0].x > c.gates[0].x && c.thermals[0].x < c.gates[1].x,
    4: (c) => c.wind.some((w) => w.wz !== 0),
    5: (c) => c.zone.x1 - c.zone.x0 <= 260,
    6: (c) => c.ridges.some((r) => r.w < 0) && c.thermals.length >= 1,
    7: (c) => c.thermals.length >= 2 && c.wind.length >= 1,
    8: opposite,
    9: (c) => c.thermals.length === c.gates.length,
    10: alternates,
    11: (c) => Math.max(...c.thermals.map((t) => t.w)) >= 12,
    12: (c) => c.ridges.filter((r) => r.w < 0).length === 2 && c.thermals.length === 2,
    13: (c) => narrow(c, 80),
    14: (c) => c.wind.some((w) => c.thermals.some((t) => t.x > w.x0 && t.x < w.x1)),
    15: (c) => c.ridges.some((r) => r.w < 0) && c.wind.length >= 2 && c.zone.hw <= 45,
    16: (c) => c.wind.length >= 2 && c.gates.every((g) => g.hw <= 35) && alternates(c),
    17: (c) => c.zone.hw <= 35 && c.zone.x1 - c.zone.x0 <= 260,
    18: (c) => c.gates.length === 6 && c.thermals.length === 3,
    19: (c) => c.wind.length >= 2 && narrow(c, 52),
    20: (c) =>
      c.wind.length >= 3 &&
      c.ridges.some((r) => r.w < 0) &&
      c.thermals.length >= 2 &&
      narrow(c, 100),
  };
  for (const [n, check] of Object.entries(checks)) assert.ok(check(by(Number(n))), `tip ${n}`);
  assert.equal(Object.keys(checks).length, LEVELS);
});

// ---- Every course can be won with legal inputs --------------------------------------------

for (let level = 1; level <= LEVELS; level++) {
  test(`glider quality: course ${level} (${COURSES[level - 1].name.en}) is cleared by a delayed human-like pilot`, () => {
    const runs = [1, 2, 3].map((seed) => playLevel(level, { seed, hz: [30, 60, 120][level % 3] }));
    const won = runs.find((r) => r.cleared);
    assert.ok(won, `no run cleared course ${level}`);
    assert.ok(won.seconds < 400, `${won.seconds.toFixed(0)} s`);
    assert.ok(won.score >= 100 * COURSES[level - 1].gates.length);
    if (level < LEVELS) assert.ok(won.saved.every((n) => n === level + 1 || n <= LEVELS));
  });
}

// ---- Bars: reaction-limited bot across delays and frame rates ---------------------------------

function sweep(levels, rates, seeds) {
  const runs = [];
  for (const level of levels)
    for (const delay of [0.25, 0.35])
      for (const hz of rates)
        for (const seed of seeds) runs.push(playLevel(level, { delay, hz, seed }));
  const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  return { runs, clear: mean((r) => Number(r.cleared)), lost: mean((r) => r.lost) };
}

test('glider quality: teaching and combination courses stay readable for a 0.25-0.35 s pilot', () => {
  const { clear, lost } = sweep(
    Array.from({ length: 14 }, (_, i) => i + 1),
    [30, 120],
    [1],
  );
  assert.ok(clear >= 0.93, `clear ${clear}`);
  assert.ok(lost <= 0.5, `lost ${lost}`);
});

test('glider quality: the mastery tier costs a reaction-limited pilot lives but is still clearable', () => {
  const { runs, clear, lost } = sweep(MASTERY, [30, 60, 120], [1, 2, 3, 4]);
  assert.ok(clear >= 0.85, `clear ${clear}`);
  assert.ok(lost >= 0.7, `mean lives lost ${lost}`);
  for (const level of MASTERY) {
    const own = runs.filter((_, i) => MASTERY[Math.floor(i / 24)] === level);
    assert.ok(own.filter((r) => r.cleared).length >= 16, `course ${level}`);
  }
});

// ---- Bars: blind input must not win -----------------------------------------------------------

function blindPolicies() {
  const all = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'],
    list = [{ name: 'idle', keysAt: () => [] }];
  for (const seed of [1, 2]) {
    for (const [name, every, odds] of [
      ['mash', 0.1, 0.5],
      ['random', 0.5, 0.3],
    ]) {
      list.push({
        name: `${name}${seed}`,
        make: () => {
          const random = seeded(seed * 77 + every * 10);
          let held = [],
            next = 0;
          return (t) => {
            if (t >= next) {
              held = all.filter(() => random() < odds);
              next = t + every;
            }
            return held;
          };
        },
      });
    }
  }
  for (const p of [0.3, 0.7, 1.5, 3]) {
    const flip = (t) => Math.floor(t / p) % 2;
    list.push({ name: `updown${p}`, keysAt: (t) => [flip(t) ? 'ArrowDown' : 'ArrowUp'] });
    list.push({ name: `leftright${p}`, keysAt: (t) => [flip(t) ? 'ArrowRight' : 'ArrowLeft'] });
    list.push({
      name: `up+leftright${p}`,
      keysAt: (t) => ['ArrowUp', flip(t) ? 'ArrowRight' : 'ArrowLeft'],
    });
    list.push({
      name: `flare+leftright${p}`,
      keysAt: (t) => ['Space', flip(t) ? 'ArrowRight' : 'ArrowLeft'],
    });
    list.push({ name: `flare${p}`, keysAt: (t) => (flip(t) ? ['Space'] : []) });
  }
  return list;
}

function blindWins(level, policy, offset) {
  const keysAt = policy.keysAt ?? policy.make(),
    s = createGliderState(level - 1),
    hz = 30;
  for (let t = offset; t - offset < 420 && s.phase !== 'won' && s.phase !== 'lost'; t += 1 / hz) {
    const playing = s.phase === 'playing';
    stepGlider(s, 1 / hz, input(playing ? keysAt(t) : [], playing ? [] : ['Space']));
    if (s.phase === 'landed') return true;
  }
  return s.phase === 'won';
}

test('glider quality: idle, mash, random and timed rhythms win at most 25% of any course from course 3', () => {
  const policies = blindPolicies();
  let total = 0,
    wins = 0;
  for (let level = 3; level <= LEVELS; level++) {
    let won = 0;
    for (const policy of policies) {
      for (const offset of [0, 0.37]) {
        if (blindWins(level, policy, offset)) won++;
      }
    }
    const share = won / (policies.length * 2);
    assert.ok(share <= 0.25, `course ${level}: blind policies won ${(100 * share).toFixed(0)}%`);
    total += policies.length * 2;
    wins += won;
  }
  assert.ok(wins / total <= 0.05, `overall blind win share ${wins / total}`);
});

test('glider quality: an idle pilot survives the opening of course 1 and the first gate is readable', () => {
  const s = createGliderState(0);
  for (let i = 0; i < 30 * 30; i++) stepGlider(s, 1 / 30, input([]));
  assert.equal(s.phase, 'playing');
  assert.equal(s.attempts, 3);
  assert.ok(s.h - terrainAt(COURSES[0], s.x, s.z) > 20);
  for (const c of COURSES) assert.ok(c.gates[0].x >= 300 && c.gates[0].x - c.start.x >= 300);
});

// ---- Determinism, hostile input, physics -------------------------------------------------------

test('glider quality: identical scripted input gives the same flight at 30, 60 and 120 Hz', () => {
  const script = (t) => {
    const keys = [];
    if (t > 4 && t < 6) keys.push('ArrowUp');
    if (t > 8 && t < 12) keys.push('ArrowLeft');
    if (t > 12 && t < 16) keys.push('ArrowRight');
    if (t > 18 && t < 19.5) keys.push('Space');
    if (t > 20 && t < 21) keys.push('ArrowDown');
    return keys;
  };
  for (const level of [1, 7, 15]) {
    const states = [30, 60, 120].map((hz) => {
      const { game } = startAt(level);
      if (level > 1) game.update(1 / hz, input([], ['Space']));
      for (let i = 0; i < hz * 25; i++) game.update(1 / hz, input(script(i / hz + 0.5 / hz)));
      return game.getState();
    });
    for (const other of states.slice(1)) {
      for (const key of ['x', 'z', 'altitude', 'airspeed', 'verticalSpeed', 'alpha', 'bank']) {
        assert.ok(Math.abs(other.glider[key] - states[0].glider[key]) < 1e-6, `${level} ${key}`);
      }
      assert.equal(other.gate, states[0].gate);
    }
  }
});

test('glider quality: hostile dt and pointer values never throw, move state or read input', () => {
  const hostile = [0, -1, NaN, Infinity, -Infinity, 0.5, 1e9, '0.016', null, undefined, {}];
  const pointers = [
    { x: NaN, y: NaN, down: true, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: '40', y: '40', clicked: true },
    { x: null, y: undefined, clicked: true },
    { x: 1e9, y: -1e9, clicked: true },
  ];
  for (const level of [1, 12]) {
    const { game } = startAt(level);
    const before = structuredClone(game.getState());
    let reads = 0;
    const probe = {
      held: () => (reads++, true),
      pressed: () => (reads++, true),
      pointer: pointers[0],
    };
    for (const dt of hostile) assert.doesNotThrow(() => game.update(dt, probe));
    assert.deepEqual(game.getState(), before);
    assert.equal(reads, 0);
    for (const pointer of pointers) {
      for (let i = 0; i < 20; i++) {
        game.update(1 / 60, { ...input([], i % 5 === 0 ? ['Space'] : [], pointer), pointer });
      }
      const s = game.getState();
      for (const v of [s.glider.x, s.glider.z, s.glider.altitude, s.energy.specific]) {
        assert.ok(Number.isFinite(v));
      }
      game.draw(mockContext());
    }
  }
});

test('glider quality: random play never tunnels through terrain, stays finite and ends once', () => {
  for (const seed of [3, 11]) {
    const h = harness({ seed }),
      game = createGame({ ...h.env, progress: { unlocked: () => 1 + (seed % 20), unlock() {} } }),
      random = seeded(seed * 7 + 1),
      keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA'];
    let held = [],
      maxSize = 0;
    game.update(1 / 60, input([], ['Enter']));
    for (let i = 0; i < 60 * 300; i++) {
      if (i % 20 === 0) held = keys.filter(() => random() < 0.3);
      const dt = [1 / 30, 1 / 60, 1 / 120][Math.floor(random() * 3)];
      game.update(dt, input(held, random() < 0.05 ? ['Space'] : []));
      if (i % 53 === 0) {
        const s = game.getState(),
          c = COURSES[s.course];
        for (const v of [s.glider.x, s.glider.z, s.glider.altitude, s.glider.airspeed]) {
          assert.ok(Number.isFinite(v));
        }
        assert.ok(s.attemptsLeft >= 0 && s.attemptsLeft <= 3);
        if (s.phase === 'playing') {
          assert.ok(s.glider.altitude > terrainAt(c, s.glider.x, s.glider.z) - 1e-6);
        }
        maxSize = Math.max(maxSize, JSON.stringify(s).length);
      }
    }
    assert.ok(h.ends.length <= 1);
    assert.ok(maxSize < 7000, `state size ${maxSize}`);
  }
});

test('glider quality: a full-speed dive into every steep face is stopped at the surface', () => {
  for (const [index, c] of COURSES.entries()) {
    for (const x of [c.gates[0].x, c.gates.at(-1).x, c.zone.x0 - 100, c.xmax - 150]) {
      const s = createGliderState(index);
      Object.assign(s, { x, z: 0, h: terrainAt(c, x, 0) + 60, vx: 30, vh: -30, alpha: -0.1 });
      for (let i = 0; i < 240 * 90 && s.phase === 'playing'; i++) {
        stepGlider(s, 1 / 240, input(['ArrowDown']));
        if (s.phase === 'playing') assert.ok(s.h > terrainAt(c, s.x, s.z) - 1e-6);
      }
      assert.notEqual(s.phase, 'playing', `${c.name.en} at ${x}`);
    }
  }
});

// ---- Course select, progress and endings ---------------------------------------------------

test('glider quality: broken, junk and throwing progress stores are harmless', () => {
  const junk = [undefined, null, NaN, -5, 0, 1.9, 7.4, '12', 'abc', 999, Infinity, {}, []];
  for (const value of junk) {
    const { game } = startAt(1, { store: { unlocked: () => value, unlock() {} } });
    const s = game.getState();
    assert.ok(s.unlocked >= 1 && s.unlocked <= LEVELS + 1, `unlocked ${value} -> ${s.unlocked}`);
    game.update(1 / 60, input([], ['Space']));
    game.draw(mockContext());
    assert.equal(game.getState().phase, 'playing');
  }
  const throwing = {
    unlocked: () => {
      throw new Error('storage blocked');
    },
    unlock: () => {
      throw new Error('quota');
    },
  };
  const { game, h } = startAt(1, { store: throwing });
  assert.equal(game.getState().unlocked, 1);
  assert.equal(game.getState().menu, null);
  const flown = playLevel(1, { limit: 200 });
  assert.ok(flown.cleared);
  const broken = createGame({ ...h.env });
  assert.equal(broken.getState().unlocked, 1);
  const writer = startAt(1, {
    store: {
      unlocked: () => 1,
      unlock: () => {
        throw new Error('quota');
      },
    },
  });
  const s = createGliderState(0);
  s.phase = 'landed';
  assert.doesNotThrow(() => writer.game.update(1 / 60, input()));
});

test('glider quality: the course select moves, denies locked courses, starts and unlocks on clear', () => {
  const { game, h, saved } = startAt(6);
  let s = game.getState();
  assert.equal(s.menu.cursor, 6);
  assert.match(s.status.en, /^Choose a course · 6\/20 Lee Sink/);
  assert.match(s.status.zh, /选择赛道/);
  game.draw(mockContext());
  game.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(game.getState().menu.cursor, 6, 'cannot move past the unlocked course');
  game.update(1 / 60, input([], ['ArrowLeft']));
  game.update(1 / 60, input([], ['KeyA']));
  game.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(game.getState().menu.cursor, 1, 'up from course 4 clamps at the first course');
  game.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(game.getState().menu.cursor, 6);
  const sounds = h.sounds.length;
  const locked = menuCell(9);
  game.update(1 / 60, input([], [], { x: locked.x + 3, y: locked.y + 3, clicked: true }));
  assert.equal(h.sounds.length, sounds + 1, 'locked tap is acknowledged');
  assert.equal(game.getState().menu.cursor, 6);
  const target = menuCell(2);
  game.update(1 / 60, input([], [], { x: target.x + 3, y: target.y + 3, clicked: true }));
  s = game.getState();
  assert.equal(s.menu, null);
  assert.equal(s.course, 1);
  assert.deepEqual(saved, []);
  const cleared = playLevel(6, { seed: 1 });
  assert.ok(cleared.cleared);
  assert.deepEqual(cleared.saved, [7], 'clearing course 6 unlocks course 7 once');
  const top = playLevel(20, { seed: 1, limit: 400 });
  if (top.cleared) assert.deepEqual(top.saved, [21], 'the last clear is recorded');
  const done = startAt(21);
  assert.equal(done.game.getState().menu.cursor, 20);
  assert.equal(done.game.getState().unlocked, 21);
  const shown = recorder();
  done.game.draw(shown.ctx);
  assert.ok(!shown.calls.texts.some((t) => /NEXT|LOCKED/.test(t.t)));
});

test('glider quality: a lost run ends once with a localized message and a frozen state', () => {
  for (const lang of ['en', 'zh']) {
    const { game, h } = startAt(1, { lang });
    for (let i = 0; i < 30 * 700 && game.getState().phase !== 'lost'; i++) {
      game.update(1 / 30, input(['ArrowDown'], ['Space']));
    }
    const s = game.getState();
    assert.equal(s.phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.equal(h.ends[0].score, s.score);
    if (lang === 'zh') assert.match(h.ends[0].message, /\p{Script=Han}/u);
    else assert.match(h.ends[0].message, /Out of attempts/);
    const frozen = structuredClone(s),
      sounds = h.sounds.length;
    let reads = 0;
    const probe = {
      held: () => (reads++, true),
      pressed: () => (reads++, true),
      pointer: { x: 5, y: 5, clicked: true },
    };
    for (let i = 0; i < 600; i++) game.update(1 / 60, probe);
    assert.deepEqual(game.getState(), frozen);
    assert.equal(h.ends.length, 1);
    assert.equal(h.sounds.length, sounds);
    assert.equal(reads, 0);
    game.draw(mockContext());
  }
});

test('glider quality: winning the last course ends once in both languages and freezes', () => {
  for (const lang of ['en', 'zh']) {
    const run = [1, 2, 3, 4, 5, 6]
      .map((seed) => playLevel(20, { seed, lang, hz: 60 }))
      .find((r) => r.cleared);
    assert.ok(run, 'one of the pilots wins the last course');
    assert.equal(run.game.getState().phase, 'won');
    assert.equal(run.h.ends.length, 1);
    assert.equal(run.h.ends[0].won, true);
    assert.equal(run.h.ends[0].score, run.game.getState().score);
    assert.match(run.h.ends[0].message, lang === 'zh' ? /\p{Script=Han}/u : /twenty ridges/);
    const frozen = structuredClone(run.game.getState());
    for (let i = 0; i < 300; i++) run.game.update(1 / 60, input(['ArrowLeft'], ['Space']));
    assert.deepEqual(run.game.getState(), frozen);
    assert.equal(run.h.ends.length, 1);
  }
});

test('glider quality: a confirm pressed during a pause is remembered, not dropped', () => {
  const s = createGliderState(0);
  Object.assign(s, { x: 600, h: terrainAt(COURSES[0], 600, 0) + 1, vx: 20, vh: -9 });
  for (let i = 0; i < 240 && s.phase === 'playing'; i++) stepGlider(s, 1 / 120, input([]));
  assert.equal(s.phase, 'crashed');
  stepGlider(s, 1 / 120, input([], ['Enter']));
  stepGlider(s, 1 / 120, input([]));
  assert.equal(s.phase, 'crashed', 'too early to skip');
  for (let i = 0; i < 120 && s.phase === 'crashed'; i++) stepGlider(s, 1 / 120, input([]));
  assert.equal(s.phase, 'playing');
  assert.ok(s.timer < 0.05, 'relaunched right at the minimum pause');
});

// ---- Drawing -----------------------------------------------------------------------------------

function recorder() {
  const ctx = mockContext(),
    calls = { texts: [], rects: [], wing: null, order: 0 };
  let fill = '';
  Object.defineProperty(ctx, 'fillStyle', { get: () => fill, set: (v) => (fill = v) });
  ctx.fillRect = (x, y, w, h) => calls.rects.push({ x, y, w, h, fill, at: calls.order++ });
  ctx.fillText = (t, x, y) => {
    calls.texts.push({ t: String(t), x, y, size: Number(/(\d+)px/.exec(ctx.font)[1]) });
    calls.order++;
  };
  ctx.translate = (x, y) => {
    if (!calls.wing) calls.wing = { x, y, at: calls.order++ };
  };
  return { ctx, calls };
}

test('glider quality: text fits the canvas in both languages and no overlay hides the glider', () => {
  const scenes = [];
  for (const index of [0, 5, 14, 19]) {
    const c = COURSES[index],
      base = createGliderState(index);
    Object.assign(base, { x: c.gates[0].x - 60, h: c.gates[0].h, time: 3 });
    base.camX = base.x - 200;
    base.camH = base.h;
    scenes.push(base);
    scenes.push({ ...base, stalled: true, alpha: 0.3 });
    scenes.push({
      ...base,
      phase: 'crashed',
      timer: 0.5,
      landing: { kind: 'hard', sink: 6, speed: 20 },
      message: { en: 'Hard landing: sinking too fast', zh: '硬着陆：下沉太快', timer: 2 },
    });
    scenes.push({
      ...base,
      phase: 'landed',
      timer: 1,
      landing: { kind: 'safe', sink: 2, speed: 22 },
    });
    scenes.push({ ...base, phase: 'won', landing: { kind: 'safe', sink: 2, speed: 22 } });
    scenes.push({
      ...base,
      phase: 'lost',
      landing: null,
      message: { en: 'Missed gate: too high', zh: '漏门：高度太高', timer: 2 },
    });
  }
  for (const scene of scenes) {
    for (const lang of ['en', 'zh']) {
      const { ctx, calls } = recorder();
      drawGlider(ctx, scene, { lang, t: (en, zh) => (lang === 'zh' ? zh : en) });
      assert.ok(calls.wing, 'glider is drawn');
      for (const { t, x, size } of calls.texts) {
        const wide = [...t].reduce((a, ch) => a + (/[⺀-鿿＀-￯]/u.test(ch) ? size : size * 0.62), 0);
        assert.ok(size >= 14 && size <= 16, `size ${size}`);
        assert.ok(x - 0 >= -1 && wide <= 470, `"${t}" is ${wide.toFixed(0)} px wide`);
      }
      const overlays = calls.rects.filter((r) => r.at > calls.wing.at && /(cc|dd)$/.test(r.fill));
      for (const r of overlays) {
        const hides =
          calls.wing.x + 16 > r.x &&
          calls.wing.x - 16 < r.x + r.w &&
          calls.wing.y + 14 > r.y &&
          calls.wing.y - 14 < r.y + r.h;
        assert.ok(!hides, `an overlay at ${r.x},${r.y} ${r.w}x${r.h} hides the glider`);
      }
    }
  }
});

test('glider quality: gate state and the selected course use a shape, not colour alone', () => {
  const c = COURSES[0],
    base = createGliderState(0);
  Object.assign(base, { x: c.gates[0].x - 60, h: c.gates[0].h });
  base.camX = base.x - 200;
  base.camH = base.h;
  const shapes = (gate) => {
    const { ctx, calls } = recorder();
    drawGlider(ctx, { ...base, gate }, { lang: 'en', t: (en) => en });
    return calls.rects.map(({ x, y, w, h }) => `${x},${y},${w},${h}`).join('|');
  };
  assert.notEqual(shapes(0), shapes(1), 'passing a gate changes the drawn shapes');
  const hearts = (attempts) => {
    const { ctx, calls } = recorder();
    drawGlider(ctx, { ...base, attempts }, { lang: 'en', t: (en) => en });
    return calls.rects.filter((r) => r.y === 42 || r.y === 40).length;
  };
  assert.ok(hearts(1) > hearts(3), 'a spent attempt is drawn hollow');
  const { game } = startAt(5),
    menu = recorder();
  game.draw(menu.ctx);
  assert.ok(
    menu.calls.texts.some((t) => /NEXT/.test(t.t)) &&
      menu.calls.texts.some((t) => /LOCKED/.test(t.t)),
  );
  for (const lang of ['en', 'zh']) {
    for (const course of COURSES) {
      const lines = wrapTip(course.brief[lang]);
      assert.ok(lines.length >= 1 && lines.length <= 2, course.brief[lang]);
    }
  }
});

test('glider quality: metadata is bilingual and touch controls cover every action', () => {
  assert.equal(meta.id, 'glider-ridge');
  assert.match(meta.description.en, /twenty/);
  assert.match(meta.description.zh, /二十/);
  for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
    assert.ok(
      meta.touchControls.some((t) => t.code === code),
      code,
    );
  }
});
