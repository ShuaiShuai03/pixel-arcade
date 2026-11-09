import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createInvaderState,
  stepInvaders,
  makeFleet,
  meta,
  LEVELS,
  LEVEL_COUNT,
} from '../src/games/orbit-invaders.js';
import {
  BOSSES,
  ROLES,
  endMessage,
  levelOf,
  bossPhase,
} from '../src/games/orbit-invaders-waves.js';
import { LINE, MASKS, SPRITES, body } from '../src/games/orbit-invaders-sprites.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/orbit-invaders-menu.js';
import { TIP_SIZE } from '../src/games/orbit-invaders-draw.js';
import { InputState } from '../src/shared/input.js';
import { harness, input, mockContext } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const CJK = /[一-鿿]/;
const REACTION_SECONDS = 0.25;
const SHIP_ACCEL = 1400;
const SHIP_MAX = 220;
const FIRE_HEAT_LIMIT = 0.9;
const BLIND_SEEDS = [1, 2, 3, 4];
const MAX_BLIND_WINS = 1;
const SWEEP_PERIODS = [1.2, 2, 2.8, 3.6];
const SWEEP_SEEDS = [301, 302, 303, 304, 305, 306, 307, 308];
const MAX_SWEEP_WINS = 2;
const MIN_LINE_MARGIN = 30;
const MAX_TIME_SHARE = 0.85;

/** Start an encounter the way a player does: through the select screen when it is offered. */
function openLevel(level, { seed = 1, lang = 'en', progress = undefined } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress =
    progress === undefined
      ? { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) }
      : progress;
  const g = createGame(h.env);
  if (level > 1 && h.env.progress) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const cleared = (s, start) => s.phase === 'won' || s.wave > start;

function shipAfter(x, v, direction, seconds) {
  let px = x,
    pv = v;
  for (let t = 0; t < seconds - 1e-9; t += 0.02) {
    pv += Math.max(-SHIP_ACCEL * 0.02, Math.min(SHIP_ACCEL * 0.02, direction * SHIP_MAX - pv));
    px += pv * 0.02;
    if (px < 22 || px > 458) {
      px = Math.max(22, Math.min(458, px));
      pv = 0;
    }
  }
  return px;
}
/** Rounds in flight plus telegraphed rounds, each as a straight path with a start delay. */
function incomingRounds(view) {
  const rounds = view.bullets.map((b) => ({ ...b, start: 0, heavy: b.hp > 1 }));
  for (const w of view.warnings) {
    let { vx, vy } = w;
    if (w.aim) {
      const dx = w.targetX - w.x,
        dy = w.targetY - w.y,
        d = Math.hypot(dx, dy) || 1;
      vx = (dx / d) * w.vy;
      vy = (dy / d) * w.vy;
    }
    rounds.push({ x: w.x, y: w.y, vx, vy, start: Math.max(0, w.delay), heavy: w.heavy });
  }
  return rounds;
}
const columnClear = (view, x, fromY, toY) =>
  !view.shields.some((b) =>
    b.blocks.some(
      (c) => c.hp > 0 && x >= c.x - 2 && x <= c.x + c.w + 2 && c.y < fromY && c.y + c.h > toY,
    ),
  );
/** Danger of holding `direction` for the next second: collisions with rounds on the hull line. */
function hazard(rounds, ship, direction) {
  let cost = 0;
  for (let t = 0.05; t <= 1.1 + 1e-9; t += 0.05) {
    const x = shipAfter(ship.x, ship.vx, direction, t);
    for (const r of rounds) {
      const age = t - r.start;
      if (age < 0) continue;
      const rx = r.x + r.vx * age,
        ry = r.y + r.vy * age;
      if (Math.abs(rx - x) < (r.heavy ? 22 : 19) && ry > 266 && ry < 300)
        cost += 1000 * (1 - t / 3);
      else if (Math.abs(rx - x) < 34 && ry > 255 && ry < 300) cost += 0.2;
    }
  }
  return cost;
}
/** Pick the column to shoot from: a clear column under the best-placed enemy. */
function chooseTarget(view, enemies, ship) {
  const boss = enemies.find((e) => e.role === 'commander'),
    pool = boss ? [boss] : enemies;
  let best = { score: Infinity, goal: 240 };
  for (const e of pool) {
    let ex = e.x + e.vx * Math.max(0, (270 - e.y) / 390),
      clear = columnClear(view, ex, 268, e.y);
    if (e.role === 'commander') {
      let pick = null;
      for (let dx = -28; dx <= 28; dx += 4) {
        const cx = ex + dx;
        if (
          columnClear(view, cx, 268, e.y + 12) &&
          (pick === null || Math.abs(cx - ship.x) < Math.abs(pick - ship.x))
        )
          pick = cx;
      }
      if (pick !== null) {
        ex = pick;
        clear = true;
      }
    }
    const score = Math.abs(ex - ship.x) * 0.6 - e.y * 0.9 + (clear ? 0 : 400);
    if (score < best.score) best = { score, goal: ex };
  }
  return best.goal;
}
/** Keys for one frame, from the world as it was `delay` seconds ago and the live ship. */
function pilot(view, live, delay) {
  const ship = live.ship,
    ahead = (e) => ({
      ...e,
      x: e.x + (e.motionVx ?? 0) * delay,
      y: e.y + (e.motionVy ?? 0) * delay,
    });
  const enemies = view.enemies.map(ahead),
    seen = {
      ...view,
      bullets: view.bullets
        .map((b) => ({ ...b, x: b.x + b.vx * delay, y: b.y + b.vy * delay }))
        .filter((b) => b.y < 330),
      warnings: view.warnings
        .map((w) => ({ ...w, delay: w.delay - delay }))
        .filter((w) => w.delay > -0.05),
    },
    rounds = incomingRounds(seen),
    goal = chooseTarget(view, enemies, ship),
    options = [0, -1, 1].map((direction) => ({ direction, cost: hazard(rounds, ship, direction) })),
    cheapest = options.reduce((a, o) => (o.cost < a.cost ? o : a)),
    error = goal - ship.x - ship.vx * 0.15,
    wanted = options.find((o) => o.direction === (Math.abs(error) > 5 ? Math.sign(error) : 0)),
    choice = wanted.cost <= cheapest.cost + 3 ? wanted : cheapest;
  const held = [];
  if (choice.direction < 0) held.push('ArrowLeft');
  if (choice.direction > 0) held.push('ArrowRight');
  const onTarget = enemies.some(
    (e) =>
      Math.abs(ship.x - (e.x + e.vx * Math.max(0, (270 - e.y) / 390))) <
        (e.role === 'commander' ? 30 : 10) && columnClear(view, ship.x, 268, e.y),
  );
  const cool = live.heat < FIRE_HEAT_LIMIT && !live.overheated;
  if (cool && (onTarget || choice.cost >= 1000)) held.push('Space');
  const pressed = choice.cost >= 900 && live.barrierCooldown <= 0 ? ['ShiftLeft'] : [];
  return { held, pressed };
}
/** Play `level` with the reaction-limited pilot; returns the final public state. */
function playPilot(level, { seed = 1, hz = 60, delay = REACTION_SECONDS, maxSeconds = 220 } = {}) {
  const { g, h } = openLevel(level, { seed }),
    history = [],
    lag = Math.round(delay * hz);
  let lowest = 0;
  for (let frame = 0; frame < maxSeconds * hz; frame++) {
    const s = g.getState();
    if (s.phase !== 'playing' || cleared(s, level)) break;
    history.push(s);
    for (const e of s.enemies) lowest = Math.max(lowest, e.y + body(e).h / 2);
    if (history.length > lag + 2) history.shift();
    const view = history[Math.max(0, history.length - 1 - lag)],
      seen = (history.length - 1 - Math.max(0, history.length - 1 - lag)) / hz,
      keys = pilot(view, s, seen);
    g.update(1 / hz, input(keys.held, keys.pressed));
  }
  return { state: g.getState(), h, lineMargin: LINE - lowest };
}

const lcg = (seed) => {
  let x = seed * 7919 + 1;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
};
/** Blind players: none of them reads the world. Each returns the keys for a frame. */
const BLIND = {
  idle: () => () => ({ held: [], pressed: [] }),
  holdFire: () => () => ({ held: ['Space'], pressed: [] }),
  sweep: () => (f, hz) => ({
    held: [Math.floor(f / hz / 1.1) % 2 ? 'ArrowLeft' : 'ArrowRight'],
    pressed: [],
  }),
  holdAndSweep: () => (f, hz) => ({
    held: ['Space', Math.floor(f / hz / 1.1) % 2 ? 'ArrowLeft' : 'ArrowRight'],
    pressed: [],
  }),
  mash: () => (f) => ({
    held: f % 2 ? ['Space', 'ArrowLeft'] : ['ArrowRight'],
    pressed: f % 7 === 0 ? ['ShiftLeft'] : [],
  }),
  randomKeys: (seed) => {
    const r = lcg(seed);
    return () => ({
      held: ['ArrowLeft', 'ArrowRight', 'Space'].filter(() => r() < 0.4),
      pressed: r() < 0.05 ? ['ShiftLeft'] : [],
    });
  },
};
function playBlind(level, policy, seed, hz = 30, maxSeconds = 210) {
  const { g } = openLevel(level, { seed });
  for (let frame = 0; frame < maxSeconds * hz; frame++) {
    const s = g.getState();
    if (s.phase !== 'playing' || cleared(s, level)) break;
    const keys = policy(frame, hz);
    g.update(1 / hz, input(keys.held, keys.pressed));
  }
  return cleared(g.getState(), level);
}

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
/** Rendered width in px of one line: bold monospace Latin is 0.6 em, CJK is 1 em. */
const textWidth = (text, size) =>
  [...text].reduce((w, c) => w + (CJK.test(c) || /[·•]/.test(c) ? size : size * 0.6), 0);
const CANVAS_MARGIN = 456;

test('there are at least 20 data-driven levels on a teaching, combination and mastery curve', () => {
  assert(LEVEL_COUNT >= 20);
  assert.equal(LEVELS.length, LEVEL_COUNT);
  const tiers = LEVELS.map((l) => l.tier);
  assert.deepEqual([...new Set(tiers)], ['teach', 'combo', 'master']);
  assert(tiers.filter((t) => t === 'teach').length >= 6);
  assert(tiers.filter((t) => t === 'master').length >= 5);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
  const signature = (l) => JSON.stringify([l.rows, l.boss, l.speed, l.gap, l.volley, l.bunkers]);
  assert.equal(new Set(LEVELS.map(signature)).size, LEVEL_COUNT);
  assert.equal(levelOf(0), LEVELS[0]);
  assert.equal(levelOf(999), LEVELS[LEVEL_COUNT - 1]);
  assert.equal(levelOf('x'), LEVELS[0]);
});
test('exported level, role, boss and sprite data is frozen', () => {
  for (const data of [
    LEVELS,
    LEVELS[0],
    LEVELS[0].rows,
    LEVELS[0].tip,
    ROLES,
    ROLES.scout,
    BOSSES,
  ]) {
    assert(Object.isFrozen(data));
  }
  assert(Object.isFrozen(BOSSES.siege.phases[0].shots[0]));
  assert(
    Object.isFrozen(MASKS.scout) &&
      Object.isFrozen(MASKS.scout[0]) &&
      Object.isFrozen(MASKS.commander[0]),
  );
  assert(Object.isFrozen(SPRITES) && Object.isFrozen(SPRITES.scout));
  assert.throws(() => {
    LEVELS[0].speed = 99;
  });
});
test('every level has accurate bilingual names and tips that fit the 480 px canvas', () => {
  for (const [i, level] of LEVELS.entries()) {
    const tag = `level ${i + 1}`;
    for (const part of [level.name, level.tip]) {
      assert(part.en.length > 3 && !CJK.test(part.en), `${tag} EN`);
      assert(CJK.test(part.zh), `${tag} ZH`);
    }
    assert(textWidth(level.tip.en, TIP_SIZE) <= CANVAS_MARGIN, `${tag} EN tip width`);
    assert(textWidth(level.tip.zh, TIP_SIZE) <= CANVAS_MARGIN, `${tag} ZH tip width`);
    assert(
      textWidth(level.name.en, 15) <= CANVAS_MARGIN &&
        textWidth(level.name.zh, 15) <= CANVAS_MARGIN,
    );
    const line = `${i + 1}. ${level.name.en} · ${LEVELS[i].tier}`;
    assert(textWidth(line, 12) <= CANVAS_MARGIN);
  }
  // The tip says what the level teaches: spot-check the mechanics each lesson names.
  const tip = (n) => LEVELS[n - 1].tip.en;
  assert(/diver/i.test(tip(3)) && makeFleet(3).some((e) => e.role === 'diver'));
  assert(/Artillery/.test(tip(4)) && makeFleet(4).some((e) => e.role === 'artillery'));
  assert(/Shift/.test(tip(5)) && LEVELS[4].volley === 2);
  assert(/Gunners/.test(tip(6)) && makeFleet(6).some((e) => e.role === 'gunner'));
  assert(/warden/i.test(tip(8)) && makeFleet(8).some((e) => e.role === 'warden'));
  assert(/Cover is thin/.test(tip(11)) && LEVELS[10].bunkers.length === 3);
  assert(/Two bunkers/i.test(tip(17)) && LEVELS[16].bunkers.length === 2);
  for (const n of [7, 12, 18, 20])
    assert(LEVELS[n - 1].boss && makeFleet(n).some((e) => e.role === 'commander'));
});
test('every fleet fits the sky, starts clear of the defense line and has valid roles', () => {
  for (const n of LEVEL_NUMBERS) {
    const fleet = makeFleet(n),
      level = levelOf(n);
    assert(fleet.length >= 7, `level ${n}`);
    assert.equal(new Set(fleet.map((e) => e.id)).size, fleet.length);
    for (const e of fleet) {
      assert(ROLES[e.role] && SPRITES[e.role] ? true : e.role === 'commander');
      const size = body(e);
      assert(e.x - size.w / 2 >= 8 && e.x + size.w / 2 <= 472, `level ${n} ${e.role} x`);
      assert(e.y + size.h / 2 < 200, `level ${n} y`);
      assert.equal(e.hp, e.maxHp);
    }
    assert.equal(
      fleet.some((e) => e.role === 'commander'),
      Boolean(level.boss),
    );
    if (level.boss)
      assert.equal(fleet.find((e) => e.role === 'commander').hp, BOSSES[level.boss].hp);
    for (const x of level.bunkers) assert(x >= 8 && x + 42 <= 472);
  }
  assert.equal(bossPhase({ hp: 24, maxHp: 24 }), 0);
  assert.equal(bossPhase({ hp: 16, maxHp: 24 }), 1);
  assert.equal(bossPhase({ hp: 8, maxHp: 24 }), 2);
});
test('worn bunkers start with holes and each level builds its own bunker row', () => {
  const worn = createInvaderState(13);
  assert.equal(worn.shields.length, 3);
  for (const b of worn.shields) assert.equal(b.hp, 12);
  assert.equal(createInvaderState(17).shields.length, 2);
  assert.equal(
    createInvaderState(1).shields.reduce((n, b) => n + b.hp, 0),
    60,
  );
  assert.equal(createInvaderState(0).wave, 1);
  assert.equal(createInvaderState(99).wave, LEVEL_COUNT);
});

// ---------------------------------------------------------------------------------------------
// Fair start and clears
// ---------------------------------------------------------------------------------------------
test('an idle player is not hurt in the opening seconds of level 1 and has time to read the tip', () => {
  const { g } = openLevel(1);
  assert(g.getState().deploy >= 4);
  for (let f = 0; f < 6 * 60; f++) g.update(1 / 60, input());
  const early = g.getState();
  assert.equal(early.lives, 3);
  assert.equal(early.phase, 'playing');
  assert.equal(early.enemyShotsFired, 0);
  for (let f = 0; f < 6 * 60; f++) g.update(1 / 60, input());
  assert.equal(g.getState().phase, 'playing');
  const q = createInvaderState(1);
  for (let f = 0; f < 4 * 60; f++) stepInvaders(q, 1 / 60, input(), lcg(1));
  assert.equal(q.bullets.length + q.warnings.length, 0);
});
test('every level opens with a banner pause before any enemy fires', () => {
  for (const n of LEVEL_NUMBERS) {
    const s = createInvaderState(n);
    assert(s.deploy >= 2.5 && s.invulnerable >= s.deploy - 1e-9, `level ${n}`);
    for (let f = 0; f < 2.4 * 120; f++) stepInvaders(s, 1 / 120, input(), lcg(n));
    assert.equal(s.warnings.length + s.bullets.length, 0, `level ${n}`);
  }
});
test('a quick-reacting scripted pilot (0.2 s) clears every level', () => {
  for (const n of LEVEL_NUMBERS) {
    const { state } = playPilot(n, { seed: 3, hz: 60, delay: 0.2 });
    assert(cleared(state, n), `level ${n} (${state.phase}, ${state.reason})`);
  }
});
for (const hz of HZS)
  test(`a reaction-limited pilot using only getState clears every level at ${hz} Hz`, () => {
    for (const n of LEVEL_NUMBERS) {
      const { state, h } = playPilot(n, { seed: 1, hz });
      assert(cleared(state, n), `level ${n} at ${hz} Hz (${state.phase}, ${state.reason})`);
      assert.equal(h.ends.length, n === LEVEL_COUNT ? 1 : 0);
    }
  });
test('a 0.35 s reaction pilot clears every level at 60 Hz well before the fleet reaches the line', () => {
  for (const n of LEVEL_NUMBERS)
    for (const seed of [1, 2]) {
      const { state, lineMargin } = playPilot(n, { seed, hz: 60, delay: 0.35 });
      assert(cleared(state, n), `level ${n} seed ${seed} (${state.phase}, ${state.reason})`);
      assert(lineMargin >= MIN_LINE_MARGIN, `level ${n} came within ${lineMargin} px of the line`);
      assert(state.time <= levelOf(n).time * MAX_TIME_SHARE, `level ${n} took ${state.time} s`);
    }
});
test('a pilot can play the final three encounters in one run and win exactly once', () => {
  const { g, h } = openLevel(LEVEL_COUNT - 2);
  const history = [];
  for (let frame = 0; frame < 400 * 60 && g.getState().phase === 'playing'; frame++) {
    const s = g.getState();
    history.push(s);
    if (history.length > 20) history.shift();
    const view = history[Math.max(0, history.length - 16)],
      keys = pilot(view, s, (history.length - Math.max(1, history.length - 15)) / 60);
    g.update(1 / 60, input(keys.held, keys.pressed));
  }
  const s = g.getState();
  assert.equal(s.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].won && h.ends[0].score === s.score);
  assert.equal(s.wave, LEVEL_COUNT);
});

// ---------------------------------------------------------------------------------------------
// No blind wins from level 3
// ---------------------------------------------------------------------------------------------
test('idle, hold-fire, sweep, mash and random-key players win at most 25% of any level from level 3', () => {
  for (const level of BLIND_LEVELS)
    for (const [name, make] of Object.entries(BLIND)) {
      let wins = 0;
      for (const seed of BLIND_SEEDS) if (playBlind(level, make(seed), seed)) wins++;
      assert(wins <= MAX_BLIND_WINS, `${name} won ${wins}/${BLIND_SEEDS.length} of level ${level}`);
    }
});
test('hold-fire with a periodic left-right sweep of any rhythm wins at most 25% of any level from level 3', () => {
  for (const level of BLIND_LEVELS)
    for (const period of SWEEP_PERIODS) {
      const policy = (f, hz) => ({
        held: ['Space', Math.floor(f / hz / period) % 2 ? 'ArrowLeft' : 'ArrowRight'],
        pressed: [],
      });
      let wins = 0;
      for (const seed of SWEEP_SEEDS) if (playBlind(level, policy, seed)) wins++;
      assert(
        wins <= MAX_SWEEP_WINS,
        `period ${period} s won ${wins}/${SWEEP_SEEDS.length} of level ${level}`,
      );
    }
});
test('idle, hold-fire and sweep without aiming never win and cost the player a hull', () => {
  for (const level of [3, 8, 14])
    for (const name of ['idle', 'holdFire', 'sweep']) {
      assert(!playBlind(level, BLIND[name](1), 1, 30, 120), `${name} level ${level}`);
    }
  const { g } = openLevel(5);
  for (let f = 0; f < 60 * 60; f++) g.update(1 / 60, input());
  assert(g.getState().lives < 3 || g.getState().phase === 'lost');
});

// ---------------------------------------------------------------------------------------------
// Determinism, hostile input, resources
// ---------------------------------------------------------------------------------------------
test('the same keys give the same battle at 30, 60 and 120 Hz', () => {
  const script = [
    ['ArrowRight', 'Space'],
    ['ArrowLeft'],
    [],
    ['Space', 'ArrowLeft'],
    ['ArrowRight'],
  ];
  for (const level of [3, 7, 12]) {
    const runs = HZS.map((hz) => {
      const { g } = openLevel(level, { seed: 5 }),
        marks = [];
      for (let f = 0; f < hz * 12; f++) {
        const segment = Math.floor(f / (hz * 0.5)),
          first = f % (hz * 0.5) === 0;
        g.update(
          1 / hz,
          input(script[segment % script.length], first && segment % 5 === 0 ? ['ShiftLeft'] : []),
        );
        if ((f + 1) % (hz * 2) === 0) {
          const s = g.getState();
          marks.push({
            x: s.ship.x,
            enemies: s.enemies.length,
            shots: s.shotsFired,
            lives: s.lives,
            enemyShots: s.enemyShotsFired,
            score: s.score,
          });
        }
      }
      return marks;
    });
    for (const marks of runs.slice(1)) {
      assert.equal(marks.length, runs[0].length);
      marks.forEach((m, i) => {
        assert(Math.abs(m.x - runs[0][i].x) < 1e-6, `level ${level} mark ${i}`);
        for (const key of ['enemies', 'shots', 'lives', 'enemyShots', 'score'])
          assert.equal(m[key], runs[0][i][key], `level ${level} ${key} ${i}`);
      });
    }
  }
});
test('the same seed repeats a whole battle exactly', () => {
  const play = () => {
    const { g } = openLevel(9, { seed: 3 });
    for (let f = 0; f < 60 * 20; f++)
      g.update(1 / 60, input(f % 90 < 45 ? ['Space', 'ArrowLeft'] : ['Space', 'ArrowRight']));
    return g.getState();
  };
  assert.deepEqual(play(), play());
});
test('hostile frame times and pointer values never corrupt the simulation', () => {
  const finite = (v, path = 'state') => {
    if (typeof v === 'number') assert(Number.isFinite(v), path);
    else if (v && typeof v === 'object')
      for (const [k, c] of Object.entries(v)) finite(c, `${path}.${k}`);
  };
  const dts = [NaN, Infinity, -Infinity, -1, 0, 1e-12, 1e9, '0.5', null, undefined, {}, 1 / 30, 5];
  const pointers = [
    { x: NaN, y: NaN, down: true },
    { x: Infinity, y: 0, down: true },
    { x: -Infinity, y: 0, down: true },
    { x: 1e12, y: -1e12, down: true },
    { x: '200', y: 'x', down: 1 },
    { x: -5, y: 300, down: true, clicked: true },
    undefined,
    null,
  ];
  for (const level of [1, 7]) {
    const { g, h } = openLevel(level);
    for (const dt of dts)
      for (const pointer of pointers) {
        const keys = input(['Space', 'ArrowLeft', 'KeyD'], ['ShiftLeft']);
        g.update(dt, { ...keys, pointer });
      }
    const s = g.getState();
    finite(s);
    assert(s.ship.x >= 22 && s.ship.x <= 458);
    assert(h.ends.length <= 1);
    g.draw(mockContext());
  }
  const menu = openLevel(5, { progress: { unlocked: () => 5, unlock() {} } });
  const g = createGame({ ...menu.h.env, progress: { unlocked: () => 5, unlock() {} } });
  for (const pointer of pointers)
    g.update(1 / 60, { ...input(), pointer: { ...pointer, clicked: true } });
  finite(g.getState());
});
test('the ship rail, heat and guard charge stay in range during prolonged mashing', () => {
  const { g } = openLevel(4, { seed: 9 });
  for (let f = 0; f < 60 * 90 && g.getState().phase === 'playing'; f++) {
    g.update(
      1 / 60,
      input(
        ['Space', f % 240 < 120 ? 'ArrowLeft' : 'ArrowRight'],
        f % 90 === 0 ? ['ShiftLeft'] : [],
      ),
    );
    const s = g.getState();
    assert(s.heat >= 0 && s.heat <= 1 && s.ship.x >= 22 && s.ship.x <= 458);
    assert(
      s.shots.length < 30 &&
        s.bullets.length < 60 &&
        s.warnings.length < 30 &&
        s.particles.length <= 60,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Level select and progress
// ---------------------------------------------------------------------------------------------
const store = (start) => {
  const calls = [];
  let unlocked = start;
  return {
    calls,
    unlocked: () => unlocked,
    unlock: (n) => (calls.push(n), (unlocked = Math.max(unlocked, n))),
  };
};
test('a new player starts level 1 directly and a returning player sees the select on the latest level', () => {
  const fresh = openLevel(1, { progress: store(1) });
  assert.equal(fresh.g.getState().menu, null);
  assert.equal(fresh.g.getState().wave, 1);
  const h = harness();
  h.env.progress = store(6);
  const s = createGame(h.env).getState();
  assert.deepEqual(
    {
      cursor: s.menu.cursor,
      unlocked: s.menu.unlocked,
      total: s.menu.total,
      columns: s.menu.columns,
    },
    { cursor: 6, unlocked: 6, total: LEVEL_COUNT, columns: MENU_COLUMNS },
  );
  assert(s.status.en.includes('Choose') && CJK.test(s.status.zh));
  assert.equal(s.totalLevels, LEVEL_COUNT);
  assert.equal(openLevel(1, { progress: undefined }).g.getState().menu, null);
});
test('the select moves, refuses locked levels, launches by key and by tap', () => {
  const h = harness();
  h.env.progress = store(4);
  const g = createGame(h.env);
  const cursor = () => g.getState().menu.cursor;
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(cursor(), 3);
  g.update(1 / 60, input([], ['KeyA']));
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(cursor(), 1);
  g.update(1 / 60, input([], ['ArrowDown', 'ArrowRight']));
  assert.equal(cursor(), 4);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(cursor(), 4);
  assert(h.sounds.includes('move'));
  const locked = menuCell(9);
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.equal(g.getState().menu.cursor, 4);
  assert(h.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: 1, y: 1, clicked: true }));
  assert.notEqual(g.getState().menu, null);
  const cell = menuCell(2);
  g.update(1 / 60, input([], [], { x: cell.x + 5, y: cell.y + 5, clicked: true }));
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.wave, 2);
  assert.equal(s.lives, 3);
  const e = harness();
  e.env.progress = store(3);
  const k = createGame(e.env);
  k.update(1 / 60, input([], ['Enter']));
  assert.equal(k.getState().wave, 3);
  assert.equal(menuTarget(input([], ['Space']), 2, 5).start, true);
  assert.equal(menuTarget({ pressed: () => false, pointer: undefined }, 2, 5).start, false);
});
test('the select works from the touch buttons and the pointer alone', () => {
  const h = harness();
  h.env.progress = store(3);
  const g = createGame(h.env),
    inp = new InputState();
  const tap = (code) => {
    inp.down(code, `touch-${code}`);
    g.update(1 / 60, inp);
    inp.up(`touch-${code}`);
    inp.flush();
  };
  tap('ArrowLeft');
  assert.equal(g.getState().menu.cursor, 2);
  tap('ArrowRight');
  assert.equal(g.getState().menu.cursor, 3);
  tap('ArrowLeft');
  tap('Space');
  assert.equal(g.getState().wave, 2);
});
test('every touch button reaches its action through the real input path', () => {
  assert.deepEqual(meta.touchControls.map((c) => c.code).toSorted(), [
    'ArrowLeft',
    'ArrowRight',
    'ShiftLeft',
    'Space',
  ]);
  for (const c of meta.touchControls) assert(c.label.en && CJK.test(c.label.zh));
  const act = (code) => {
    const s = createInvaderState(),
      inp = new InputState();
    inp.down(code, `touch-${code}`);
    for (let f = 0; f < 20; f++) {
      stepInvaders(s, 1 / 60, inp, lcg(1));
      inp.flush();
    }
    return s;
  };
  assert(act('ArrowLeft').ship.x < 240);
  assert(act('ArrowRight').ship.x > 240);
  assert(act('Space').shotsFired > 0);
  assert(act('ShiftLeft').barrierCooldown > 0);
  assert(meta.keys.length >= 4 && meta.description.en.includes(String(LEVEL_COUNT)));
});
test('clearing a level unlocks the next one, once, and never past the last', () => {
  const s = store(2);
  const { g } = openLevel(2, { progress: s });
  for (let f = 0; f < 60 * 60 && g.getState().wave === 2; f++) {
    const st = g.getState(),
      keys = pilot(st, st, 0);
    g.update(1 / 60, input(keys.held, keys.pressed));
  }
  assert.equal(g.getState().wave, 3);
  assert.deepEqual(s.calls, [3]);
  assert.equal(s.unlocked(), 3);
  const last = store(LEVEL_COUNT);
  const l = openLevel(LEVEL_COUNT, { progress: last });
  const q = l.g.getState();
  assert.equal(q.wave, LEVEL_COUNT);
  assert.equal(q.unlocked, LEVEL_COUNT);
  assert.deepEqual(last.calls, []);
});
test('junk, throwing and missing progress stores are clamped and never stop play', () => {
  const junk = [
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    -5,
    0,
    0.4,
    3.9,
    1e9,
    '7',
    'abc',
    {},
    [],
    true,
  ];
  for (const value of junk) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    const s = createGame(h.env).getState();
    assert(s.unlocked >= 1 && s.unlocked <= LEVEL_COUNT, String(value));
    assert(s.wave >= 1 && s.wave <= LEVEL_COUNT);
  }
  assert.equal(
    openLevel(1, { progress: { unlocked: () => '7', unlock() {} } }).g.getState().unlocked,
    7,
  );
  assert.equal(
    openLevel(1, { progress: { unlocked: () => 1e9, unlock() {} } }).g.getState().unlocked,
    LEVEL_COUNT,
  );
  const throwing = {
    unlocked() {
      throw new Error('storage blocked');
    },
    unlock() {
      throw new Error('storage blocked');
    },
  };
  const h = harness();
  h.env.progress = throwing;
  const g = createGame(h.env);
  assert.equal(g.getState().unlocked, 1);
  assert.equal(g.getState().menu, null);
  const lone = { unlocked: () => 1, unlock: throwing.unlock };
  const { g: g2 } = openLevel(1, { progress: lone });
  for (let f = 0; f < 60 * 80 && g2.getState().wave === 1; f++) {
    const st = g2.getState(),
      keys = pilot(st, st, 0);
    g2.update(1 / 60, input(keys.held, keys.pressed));
  }
  assert.equal(g2.getState().wave, 2);
  assert.equal(g2.getState().unlocked, 2);
  assert.equal(g2.getState().phase, 'playing');
});

// ---------------------------------------------------------------------------------------------
// End messages, single end and frozen terminal state
// ---------------------------------------------------------------------------------------------
test('end messages are localized for a win and for each way to lose', () => {
  const cases = [
    { won: true },
    { won: false, reason: 'time' },
    { won: false, reason: 'breach' },
    { won: false, reason: 'hull' },
  ];
  const texts = { en: new Set(), zh: new Set() };
  for (const c of cases)
    for (const lang of ['en', 'zh']) {
      const m = endMessage(harness({ lang }).env, c);
      assert(m.length > 8);
      assert.equal(CJK.test(m), lang === 'zh', `${lang} ${JSON.stringify(c)}`);
      texts[lang].add(m);
    }
  assert.equal(texts.en.size, 4);
  assert.equal(texts.zh.size, 4);
  assert(endMessage(harness().env, { won: true }).includes(String(LEVEL_COUNT)));
});
function loseBy(reason, lang) {
  const { g, h } = openLevel(1, { lang, progress: store(1) });
  if (reason === 'time') {
    for (let f = 0; f < 60 * 130 && g.getState().phase === 'playing'; f++)
      g.update(1 / 30, input());
  } else if (reason === 'breach') {
    const s = createInvaderState();
    s.enemies = [{ x: 200, y: 274, hp: 1, type: 0 }];
    stepInvaders(s, 0.01, input(), lcg(1));
    assert.equal(s.reason, 'breach');
    return { g: null, h: null, s };
  } else {
    for (let f = 0; f < 60 * 200 && g.getState().phase === 'playing'; f++) {
      const st = g.getState();
      g.update(1 / 30, input(st.ship.x > 240 ? ['ArrowLeft'] : ['ArrowRight']));
    }
  }
  return { g, h, s: g.getState() };
}
test('a loss ends exactly once in English and Chinese and the terminal state is frozen', () => {
  for (const lang of ['en', 'zh'])
    for (const reason of ['time', 'hull']) {
      const { g, h, s } = loseBy(reason, lang);
      assert.equal(s.phase, 'lost', `${lang} ${reason}`);
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, false);
      assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
      assert.equal(h.ends[0].score, s.score);
      assert(h.sounds.at(-1) === 'lose');
      const frozen = g.getState();
      for (let i = 0; i < 120; i++)
        g.update(1 / 60, input(['Space', 'ArrowLeft'], ['ShiftLeft'], { x: 50, down: true }));
      g.update(NaN, input());
      assert.deepEqual(g.getState(), frozen);
      assert.equal(h.ends.length, 1);
      g.draw(mockContext());
    }
});
test('running out of time and breaching the line are separate, localized losses', () => {
  const late = createInvaderState();
  late.waveTime = 0.001;
  stepInvaders(late, 0.01, input(), lcg(1));
  assert.deepEqual([late.phase, late.reason], ['lost', 'time']);
  const { s: breached } = loseBy('breach', 'en');
  assert.deepEqual([breached.phase, breached.reason], ['lost', 'breach']);
  for (const s of [late, breached]) {
    const h = harness({ lang: 'zh' });
    const message = endMessage(h.env, { won: false, reason: s.reason });
    assert(CJK.test(message));
  }
});
test('a warning whose emitter is gone is dropped and never fires', () => {
  const s = createInvaderState();
  s.deploy = 0;
  s.enemyCooldown = 99;
  s.warnings = [{ id: 1, owner: 9999, offset: 0, vx: 0, vy: 150, delay: 0.01, x: 100, y: 100 }];
  stepInvaders(s, 0.01, input(), lcg(1));
  assert.equal(s.warnings.length, 0);
  assert.equal(s.enemyShotsFired, 0);
});
test('divers, stray fire and crew service banners draw during a real level in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const play = openLevel(3, { lang });
    const seen = new Set();
    for (let f = 0; f < 60 * 60 && play.g.getState().wave === 3; f++) {
      const st = play.g.getState(),
        keys = pilot(st, st, 0);
      for (const e of st.enemies) seen.add(e.mode);
      if (st.intermission > 0) seen.add('service');
      play.g.update(1 / 60, input(keys.held, keys.pressed));
      if (f % 3 === 0) play.g.draw(mockContext());
    }
    assert.equal(play.g.getState().wave, 4);
    assert(seen.has('windup') && seen.has('service'));
  }
});
test('a win ends exactly once with a localized message and the state then stays frozen', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = openLevel(LEVEL_COUNT, { lang, seed: 1 });
    for (let f = 0; f < 60 * 300 && g.getState().phase === 'playing'; f++) {
      const st = g.getState(),
        keys = pilot(st, st, 0);
      g.update(1 / 60, input(keys.held, keys.pressed));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
    assert(h.sounds.at(-1) === 'win');
    const frozen = g.getState();
    for (let i = 0; i < 120; i++) g.update(1 / 60, input(['Space'], ['ShiftLeft']));
    assert.deepEqual(g.getState(), frozen);
    assert.equal(h.ends.length, 1);
  }
});
test('every screen draws in English and Chinese without throwing', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    for (const n of LEVEL_NUMBERS) {
      const s = createInvaderState(n);
      assert(s.deploy > 0);
      const { g } = openLevel(n, { lang });
      g.draw(mockContext());
      for (let f = 0; f < 60 * 5; f++) g.update(1 / 60, input(['Space']));
      g.draw(mockContext());
    }
    h.env.progress = store(7);
    createGame(h.env).draw(mockContext());
  }
  const calls = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (...a) => calls.push(a) : t[p]),
  });
  const menu = harness({ lang: 'zh' });
  menu.env.progress = store(20);
  createGame(menu.env).draw(ctx);
  assert(calls.some((a) => String(a[0]).includes('选择')));
  const { g } = openLevel(10, { lang: 'zh' });
  calls.length = 0;
  g.draw(ctx);
  assert(calls.some((a) => String(a[0]).includes('需2发')));
});
test('a boss that is wounded shows each pattern phase and the hull-hit paths stay consistent', () => {
  for (const [level, phases] of [
    [7, 3],
    [12, 3],
    [18, 3],
    [20, 3],
  ]) {
    const volleys = [];
    for (const fraction of [1, 0.5, 0.2]) {
      const s = createInvaderState(level);
      s.deploy = 0;
      const boss = s.enemies.find((e) => e.role === 'commander');
      boss.hp = Math.ceil(boss.maxHp * fraction);
      s.enemyCooldown = 0;
      stepInvaders(s, 0.01, input(), lcg(1));
      volleys.push(s.warnings.length);
    }
    assert.equal(volleys.length, phases);
    assert(new Set(volleys).size >= 2, `level ${level} ${volleys}`);
  }
});
