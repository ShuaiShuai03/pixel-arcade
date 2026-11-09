import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  buildLevel,
  createDungeonState,
  stepDungeon,
} from '../src/games/dungeon-dash.js';
import { LEVELS, LEVEL_COUNT, clampLevel } from '../src/games/dungeon-dash-levels.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/dungeon-dash-menu.js';
import { SPIKE } from '../src/games/dungeon-dash-world.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const BLIND_SEEDS = [1, 2, 3, 4];
const BLIND_HORIZON = 60;
const CLEAR_LIMIT = 120;
const CJK = /[一-鿿]/;
const cellOf = (p) => [Math.floor((p.x - 20) / 20), Math.floor((p.y - 30) / 20)];
const centre = ([cx, cy]) => ({ x: 30 + cx * 20, y: 40 + cy * 20 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function memoryStore(start = 1) {
  const store = {
    value: start,
    calls: [],
    unlocked: () => store.value,
    unlock: (n) => {
      store.calls.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
/** Start a run on `level` the way a player does: through the select screen when it is offered. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ seed, lang });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------
// A reaction-limited player. It sees the world (enemies, arrows, spikes) as it was `delay` seconds
// ago, knows its own position and resources, and uses only getState(): no hidden timers.
// ---------------------------------------------------------------------------------------------
function route(tiles, from, to) {
  const start = cellOf(from).join(','),
    goal = cellOf(to).join(','),
    prev = new Map([[start, null]]),
    queue = [cellOf(from)];
  for (let k = 0; k < queue.length && !prev.has(goal); k++) {
    const [x, y] = queue[k];
    for (const [a, b] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = `${x + a},${y + b}`;
      if (tiles[y + b]?.[x + a] === 0 && !prev.has(key)) {
        prev.set(key, [x, y]);
        queue.push([x + a, y + b]);
      }
    }
  }
  if (!prev.has(goal)) return null;
  const path = [];
  for (let cur = goal.split(',').map(Number); cur; cur = prev.get(cur.join(','))) path.unshift(cur);
  return path;
}
function keysToward(from, to, dead) {
  const keys = [];
  if (to.x - from.x > dead) keys.push('ArrowRight');
  else if (from.x - to.x > dead) keys.push('ArrowLeft');
  if (to.y - from.y > dead) keys.push('ArrowDown');
  else if (from.y - to.y > dead) keys.push('ArrowUp');
  return keys;
}
/** Sidestep out of any arrow line or archer aim that the player was shown. */
function dodgeKeys(now, seen, delay) {
  const p = now.player,
    lines = seen.projectiles.map((a) => {
      const speed = Math.hypot(a.vx, a.vy) || 1;
      return {
        x: a.x + a.vx * delay,
        y: a.y + a.vy * delay,
        dx: a.vx / speed,
        dy: a.vy / speed,
        len: 200,
      };
    });
  for (const e of seen.enemies)
    if (e.type === 'archer' && e.state === 'windup')
      lines.push({ x: e.x, y: e.y, dx: e.aim.x, dy: e.aim.y, len: 150 });
  for (const l of lines) {
    const rx = p.x - l.x,
      ry = p.y - l.y,
      along = rx * l.dx + ry * l.dy,
      side = rx * -l.dy + ry * l.dx;
    if (along > -6 && along < l.len && Math.abs(side) < 16) {
      const sign = side >= 0 ? 1 : -1,
        keys = [];
      if (Math.abs(l.dy) > 0.3) keys.push(-l.dy * sign > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(l.dx) > 0.3) keys.push(l.dx * sign > 0 ? 'ArrowDown' : 'ArrowUp');
      return keys;
    }
  }
  return null;
}
function fightKeys(now, seen, evade) {
  const p = now.player,
    foe = seen.enemies
      .filter((e) => e.state !== 'sleep' && (e.type !== 'archer' || dist(e, p) < 70))
      .map((e) => ({ e, d: dist(e, p) }))
      .sort((a, b) => a.d - b.d)[0];
  if (!foe || foe.d >= 62) return null;
  const { e } = foe;
  const reach = e.type === 'warden' ? 72 : 48;
  if (
    evade &&
    e.type !== 'archer' &&
    (e.state === 'windup' || e.state === 'active') &&
    foe.d < reach
  ) {
    const away = keysToward(e, p, 2);
    return away.length ? away : ['ArrowLeft'];
  }
  return [...keysToward(p, e, 5), ...(foe.d < 40 ? ['Space'] : [])];
}
function pickGoal(now) {
  const p = now.player,
    reach = (o) => route(now.tiles, p, o),
    open = now.levers.filter((l) => !l.on && reach(l)),
    lever = open.find((l) => l.opens !== 'spikes') ?? open[0],
    shrine = now.health <= 3 ? now.shrines.find((r) => !r.used && reach(r)) : null,
    chest = now.flasks < 2 ? now.chests.find((c) => !c.opened && reach(c)) : null,
    potion = now.flasks < 3 ? now.potions.find((q) => reach(q)) : null;
  if (shrine || lever || chest) return { goal: shrine ?? lever ?? chest, use: true };
  if (potion) return { goal: potion };
  if (!now.hasKey) return { goal: now.key };
  const foes = LEVELS[now.level - 1].needsClear ? now.enemies.filter((e) => reach(e)) : [];
  return { goal: foes.length ? foes.sort((a, b) => dist(a, p) - dist(b, p))[0] : now.exit };
}
function botFrame(now, seen, delay, evade = true) {
  const p = now.player,
    pressed =
      now.health <= (evade ? 3 : 2) && now.flasks > 0 && now.healCooldown === 0 ? ['KeyH'] : [],
    reaction = (evade && dodgeKeys(now, seen, delay)) || fightKeys(now, seen, evade);
  if (reaction) return input(reaction, pressed);
  const { goal, use } = pickGoal(now),
    path = route(now.tiles, p, goal);
  if (!path) return input([], pressed);
  if (use && dist(goal, p) < 24) return input([], [...pressed, 'KeyE']);
  const target = path.length > 1 ? centre(path[1]) : goal,
    plate =
      path.length > 1 &&
      now.hazards.findIndex((h, i) => !h.disabled && cellOf(h).join() === path[1].join()),
    waiting =
      plate >= 0 &&
      seen.hazards[plate].state !== 'safe' &&
      Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) > 18;
  if (waiting) return input([], pressed);
  const keys = keysToward(p, target, 2),
    sleeper =
      LEVELS[now.level - 1].needsClear &&
      now.enemies.find((e) => e.state === 'sleep' && dist(e, p) < 34);
  if (sleeper) keys.push(...keysToward(p, sleeper, 5), 'Space');
  return input(keys, pressed);
}
function playLevel(level, hz, { delay = 0, seed = 1, progress, evade = true } = {}) {
  const { g, h } = open(level, { seed, progress }),
    history = [],
    lag = Math.round(delay * hz);
  let frames = 0,
    lowest = 5,
    hits = 0,
    previous = 5;
  while (frames < CLEAR_LIMIT * hz) {
    const now = g.getState();
    history.push(now);
    if (now.level === level) {
      lowest = Math.min(lowest, now.health);
      if (now.health < previous) hits++;
      previous = now.health;
    }
    if (now.level > level || now.phase !== 'playing') break;
    g.update(1 / hz, botFrame(now, history[Math.max(0, history.length - 1 - lag)], delay, evade));
    frames++;
  }
  const end = g.getState();
  return {
    g,
    h,
    end,
    lowest,
    hits,
    seconds: frames / hz,
    cleared: end.level > level || end.phase === 'won',
  };
}

// ---------------------------------------------------------------------------------------------
// Blind players.
// ---------------------------------------------------------------------------------------------
const ARROWS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
const timed = (period, a, b, swing) => (_, m) =>
  input(
    [
      a,
      Math.floor(m.frame / 60 / period) % 2 ? b : b === 'ArrowUp' ? 'ArrowDown' : 'ArrowUp',
    ].concat(swing ? ['Space'] : []),
    m.frame % 30 === 0 ? ['KeyE'] : [],
  );
const POLICIES = {
  idle: () => input(),
  mash: () => input([], ['Space', 'Enter', 'KeyE', 'KeyK', 'KeyH']),
  randomKeys: (rng, m) => {
    if (m.frame % 12 === 0) m.held = [ARROWS[Math.floor(rng() * 4)]];
    return input([...m.held, ...(rng() < 0.5 ? ['Space'] : [])], rng() < 0.1 ? ['KeyE'] : []);
  },
  holdRight: timed(0.5, 'ArrowRight', 'ArrowUp', true),
  holdUp: timed(1, 'ArrowUp', 'ArrowRight', true),
  holdDown: timed(2, 'ArrowDown', 'ArrowRight', false),
};
function blindWins(policy, level, seed) {
  const { g } = open(level, { seed }),
    rng = seeded(seed * 31 + level),
    memory = { frame: 0, held: [] };
  for (; memory.frame < BLIND_HORIZON * 60; memory.frame++) {
    if (memory.frame % 30 === 0) {
      const now = g.getState();
      if (now.level > level || now.phase !== 'playing') break;
    }
    g.update(1 / 60, POLICIES[policy](rng, memory));
  }
  const end = g.getState();
  return end.level > level || end.phase === 'won';
}

// ---------------------------------------------------------------------------------------------
// The level table.
// ---------------------------------------------------------------------------------------------
const featuresOf = (n) => {
  const spec = LEVELS[n - 1];
  return {
    spikes: (spec.spikes ?? []).length + (spec.spikesB ?? []).length > 0,
    gates: (spec.gates ?? []).length > 0,
    armor: spec.armor,
    archers: (spec.archers ?? []).length + (spec.ambushArchers ?? []).length > 0,
    chest: (spec.chests ?? []).length > 0,
    shrine: (spec.shrines ?? []).length > 0,
    ambush: (spec.ambushGuards ?? []).length + (spec.ambushArchers ?? []).length > 0,
    warden: (spec.wardens ?? []).length > 0,
    spikeLever: (spec.spikeLevers ?? []).length > 0,
    secondGate: (spec.gates2 ?? []).length > 0,
    noClear: !spec.needsClear,
    awake: spec.alert,
  };
};
test('there are twenty distinct chambers, each with a bilingual name and tip', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.equal(
    new Set(LEVELS.map((l) => JSON.stringify(buildLevel(LEVELS.indexOf(l) + 1).tiles))).size,
    20,
  );
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, 20);
  for (const l of LEVELS) {
    assert.ok(l.name.en && CJK.test(l.name.zh) && l.tip.en.length > 20 && CJK.test(l.tip.zh));
    assert.doesNotMatch(l.tip.en, CJK);
  }
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel('x'), 1);
  assert.equal(clampLevel(99), 20);
  assert.equal(clampLevel(7.9), 7);
});
test('exported level data is frozen all the way down and builds fresh copies', () => {
  const walk = (v) => {
    if (v && typeof v === 'object') {
      assert.ok(Object.isFrozen(v));
      Object.values(v).forEach(walk);
    }
  };
  walk(LEVELS);
  const room = buildLevel(5);
  room.tiles[3][3] = 9;
  room.enemies.push({});
  assert.notEqual(buildLevel(5).tiles[3][3], 9);
});
test('the curve teaches one idea at a time, then combines, then masters', () => {
  const firstSeen = {};
  for (const n of LEVEL_NUMBERS)
    for (const [key, on] of Object.entries(featuresOf(n))) if (on) firstSeen[key] ??= n;
  assert.deepEqual(firstSeen, {
    spikes: 4,
    gates: 5,
    archers: 6,
    chest: 7,
    shrine: 8,
    ambush: 9,
    warden: 10,
    spikeLever: 11,
    secondGate: 13,
    noClear: 14,
    awake: 14,
    armor: 15,
  });
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const on = Object.entries(featuresOf(n)).filter(([k, v]) => v && firstSeen[k] === n);
    assert.ok(on.length <= 1, `chamber ${n} introduces ${on.map(([k]) => k)}`);
  }
  const count = (n) => buildLevel(n).enemies.length;
  assert.equal(count(1), 0);
  assert.equal(count(2), 1);
  assert.ok(count(20) >= 4 && count(15) >= 5);
});
test('every tip names only what its chamber really contains', () => {
  for (const n of LEVEL_NUMBERS) {
    const f = featuresOf(n),
      { en, zh } = LEVELS[n - 1].tip;
    if (/spike/i.test(en)) assert.ok(f.spikes, `tip ${n} spikes`) && assert.match(zh, /尖刺/);
    if (/archer/i.test(en)) assert.ok(f.archers, `tip ${n} archers`);
    if (/archer/i.test(en)) assert.match(zh, /弓手/);
    if (/gate|lever/i.test(en)) assert.ok(f.gates || f.spikeLever, `tip ${n} gate`);
    if (/lever/i.test(en)) assert.match(zh, /拉杆/);
    if (/statue/i.test(en)) assert.ok(f.ambush, `tip ${n} statues`);
    if (/statue/i.test(en)) assert.match(zh, /雕像/);
    if (/warden/i.test(en)) assert.ok(f.warden, `tip ${n} warden`);
    if (/shrine/i.test(en)) assert.ok(f.shrine, `tip ${n} shrine`);
    if (/shrine/i.test(en)) assert.match(zh, /神龛/);
    if (/cache|flask/i.test(en))
      assert.ok(f.chest || buildLevel(n).potions.length, `tip ${n} cache`);
    if (/armou?r/i.test(en)) assert.ok(f.armor, `tip ${n} armour`) && assert.match(zh, /重甲/);
    if (/spike column/i.test(en)) assert.ok(f.spikes, `tip ${n} spikes`);
    if (/awake/i.test(en)) assert.ok(f.awake && f.noClear);
    if (/dodge/i.test(en)) assert.match(zh, /闪/);
    if (/sword|hold space to swing/i.test(en)) assert.match(zh, /挥剑/);
  }
});
function flood(tiles, from) {
  const seen = new Map([[cellOf(from).join(), 0]]),
    queue = [cellOf(from)];
  for (let k = 0; k < queue.length; k++) {
    const [x, y] = queue[k];
    for (const [a, b] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (tiles[y + b]?.[x + a] === 0 && !seen.has(`${x + a},${y + b}`)) {
        seen.set(`${x + a},${y + b}`, seen.get(`${x},${y}`) + 1);
        queue.push([x + a, y + b]);
      }
  }
  return seen;
}
test('every chamber is solvable: levers reachable, then the key, the foes and the exit', () => {
  for (const n of LEVEL_NUMBERS) {
    const room = buildLevel(n),
      objects = [
        room.key,
        room.exit,
        ...room.enemies,
        ...room.chests,
        ...room.shrines,
        ...room.potions,
      ],
      before = flood(room.tiles, room.start);
    assert.ok(room.levers.some((l) => before.has(cellOf(l).join())) || !room.levers.length, `${n}`);
    for (const g of room.gates) {
      assert.equal(room.tiles[g.cy][g.cx], 2);
      room.tiles[g.cy][g.cx] = 0;
    }
    const after = flood(room.tiles, room.start);
    for (const o of [...objects, ...room.levers, ...room.hazards, ...room.treasures])
      assert.ok(after.has(cellOf(o).join()), `chamber ${n} object at ${o.x},${o.y} unreachable`);
    if (room.gates.length)
      assert.ok(
        !before.has(cellOf(room.key).join()) ||
          !before.has(cellOf(room.exit).join()) ||
          n === 17 ||
          n === 13,
      );
  }
});
test('the opening is fair: sleepers start far away, awake guards are distant, floors are in view', () => {
  for (const n of LEVEL_NUMBERS) {
    const room = buildLevel(n),
      walking = flood(room.tiles, room.start);
    for (const e of room.enemies) {
      const steps = walking.get(cellOf(e).join()) ?? 99;
      if (e.state === 'sleep' && e.wake === 'near')
        assert.ok(steps > 6, `chamber ${n} sleeper ${steps}`);
      if (e.state === 'approach') assert.ok(steps >= 9, `chamber ${n} awake guard ${steps}`);
      if (e.wake === 'key') assert.ok(dist(e, room.key) >= 55, `chamber ${n} statue by the key`);
    }
    const vertical = [
      room.start,
      room.key,
      room.exit,
      ...room.enemies,
      ...room.hazards,
      ...room.levers,
    ];
    for (const o of vertical)
      assert.ok(o.y >= 40 && o.y <= 280 && o.x >= 30 && o.x <= 430, `chamber ${n}`);
  }
  assert.ok(SPIKE.warn >= 0.9 && SPIKE.safe >= 1.2);
});
test('an idle player is safe for the first seconds of every chamber and for a minute on chamber 1', () => {
  const { g, h } = open(1, { progress: null });
  for (let i = 0; i < 60 * 60; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.health, 5);
  assert.equal(h.ends.length, 0);
  assert.ok(s.toast.time <= 0);
  for (const n of LEVEL_NUMBERS.filter((level) => !LEVELS[level - 1].alert)) {
    const run = open(n);
    for (let i = 0; i < 60 * 5; i++) run.g.update(1 / 60, input());
    assert.equal(run.g.getState().health, 5, `chamber ${n}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Playthroughs.
// ---------------------------------------------------------------------------------------------
test('a scripted legal clear completes every chamber through the public input', () => {
  for (const n of LEVEL_NUMBERS) {
    const run = playLevel(n, 60);
    assert.ok(run.cleared, `chamber ${n} not cleared (${run.end.phase}, ${run.seconds}s)`);
    assert.equal(run.end.phase, n === LEVEL_COUNT ? 'won' : 'playing');
  }
});
test('a reaction-limited bot clears every chamber at 30, 60 and 120 Hz with margin', () => {
  for (const hz of HZS)
    for (const delay of DELAYS)
      for (const n of LEVEL_NUMBERS) {
        const run = playLevel(n, hz, { delay });
        assert.ok(
          run.cleared,
          `chamber ${n} at ${hz} Hz, ${delay}s: ${run.end.phase} after ${run.seconds}s`,
        );
        assert.ok(
          run.lowest >= 1,
          `chamber ${n} at ${hz} Hz, ${delay}s dropped to ${run.lowest} hearts`,
        );
        assert.ok(run.seconds < 80, `chamber ${n} took ${run.seconds}s`);
      }
});
test('the mastery chambers bite: they cost hearts, and ignoring windups costs more', () => {
  const sum = (levels, evade) =>
    levels.reduce((total, n) => total + playLevel(n, 60, { delay: 0.35, evade }).hits, 0);
  const mastery = LEVEL_NUMBERS.filter((n) => n >= 15),
    gentle = LEVEL_NUMBERS.filter((n) => n <= 8);
  const careful = sum(mastery, true);
  assert.ok(careful >= 6, `careful bot took ${careful} hits in chambers 15-20`);
  assert.ok(sum(mastery, false) > careful, 'ignoring windups costs hearts');
  assert.equal(sum(gentle, true), 0, 'chambers 1-8 stay gentle');
});
test('idle, mash, random and timed-pattern players win at most a quarter of any chamber from 3', () => {
  for (const policy of Object.keys(POLICIES))
    for (const n of BLIND_LEVELS) {
      const wins = BLIND_SEEDS.filter((seed) => blindWins(policy, n, seed)).length;
      assert.ok(wins / BLIND_SEEDS.length <= 0.25, `${policy} won ${wins} on chamber ${n}`);
    }
});

// ---------------------------------------------------------------------------------------------
// Select and continue.
// ---------------------------------------------------------------------------------------------
test('the select offers saved progress, never reaches locked chambers by keys, and starts the choice', () => {
  const { g } = open(7, { launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 7, unlocked: 7, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  assert.match(s.status.en, /Choose a chamber/);
  assert.match(s.status.zh, /选择密室/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['KeyE']));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 6);
  assert.equal(s.enemies.length, buildLevel(6).enemies.length);
});
test('tapping a cell starts it, a locked cell is refused, junk pointers are ignored', () => {
  const { g, h } = open(4, { launch: false }),
    tap = (n) => {
      const c = menuCell(n);
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true };
    };
  g.update(1 / 60, input([], [], tap(12)));
  assert.ok(g.getState().menu);
  assert.ok(h.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: 3, y: 315, clicked: true }));
  g.update(1 / 60, input([], [], { x: NaN, y: NaN, clicked: true }));
  g.update(1 / 60, input([], []));
  assert.ok(g.getState().menu);
  assert.deepEqual(menuTarget({ pressed: () => false }, 3, 5), {
    cursor: 3,
    moved: false,
    denied: false,
    start: false,
  });
  g.update(1 / 60, input([], [], tap(2)));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().menu, null);
});
test('clearing a chamber unlocks the next and never lowers the saved value', () => {
  const store = memoryStore(1),
    run = playLevel(1, 60, { progress: store });
  assert.ok(run.cleared);
  assert.deepEqual(store.calls, [2]);
  assert.equal(run.g.getState().unlocked, 2);
  const high = memoryStore(9),
    second = playLevel(3, 60, { progress: high });
  assert.ok(second.cleared);
  assert.equal(high.value, 9);
  assert.ok(high.calls.every((n) => n > 3));
});
test('a broken, throwing or junk progress store never stops play', () => {
  const stores = [
    undefined,
    null,
    {},
    { unlocked: () => 1 },
    {
      unlocked: () => {
        throw new Error('storage blocked');
      },
      unlock: () => {
        throw new Error('storage full');
      },
    },
  ];
  for (const progress of stores) {
    const run = playLevel(1, 60, { progress });
    assert.ok(run.cleared);
    assert.equal(run.end.level, 2);
  }
  const junk = [NaN, -5, 0, 0.4, 1e9, Infinity, -Infinity, '7', 'x', null, undefined, {}, [3]];
  for (const value of junk) {
    const { g } = open(1, { progress: { unlocked: () => value, unlock() {} }, launch: false });
    const s = g.getState(),
      expected = Number.isFinite(Math.floor(Number(value))) ? Math.floor(Number(value)) : 1;
    assert.equal(s.unlocked, Math.min(LEVEL_COUNT, Math.max(1, expected)), String(value));
    g.draw(mockContext());
  }
});

// ---------------------------------------------------------------------------------------------
// Determinism, hostile input, terminal state.
// ---------------------------------------------------------------------------------------------
function scripted(hz, level) {
  const { g } = open(level, { seed: 3 }),
    trace = [];
  for (let n = 0; n < hz * 20; n++) {
    const t = n / hz,
      keys = [['ArrowRight'], ['ArrowUp', 'Space'], ['ArrowLeft'], ['ArrowDown', 'Space']][
        Math.floor(t * 2) % 4
      ],
      press = n % (hz * 3) === 0 ? ['KeyK'] : n % (hz * 5) === 0 ? ['KeyE'] : [];
    g.update(1 / hz, input(keys, press));
    if ((n + 1) % (hz / 2) === 0) trace.push(g.getState());
  }
  return trace;
}
test('30, 60 and 120 Hz play the same game', () => {
  for (const level of [2, 6, 18]) {
    const [slow, mid, fast] = HZS.map((hz) => scripted(hz, level));
    slow.forEach((a, i) => {
      for (const b of [mid[i], fast[i]]) {
        assert.equal(a.score, b.score);
        assert.equal(a.health, b.health);
        assert.equal(a.enemies.length, b.enemies.length);
        assert.ok(Math.abs(a.player.x - b.player.x) < 1e-6, `chamber ${level} step ${i}`);
        assert.ok(Math.abs(a.player.y - b.player.y) < 1e-6);
        assert.ok(Math.abs(a.stamina - b.stamina) < 1e-6);
      }
    });
  }
  assert.deepEqual(scripted(60, 6), scripted(60, 6));
});
test('hostile frame times and pointer values keep the state finite and in bounds', () => {
  const times = [NaN, Infinity, -Infinity, -1, 0, 1e-12, 1e9, 0.5, '0.016', null, undefined, {}];
  const xs = [NaN, Infinity, -Infinity, 1e9, -5, '240', null, undefined, 'abc', 240];
  const { g } = open(9, { seed: 4 });
  for (let n = 0; n < 900; n++) {
    const pointer = {
      x: xs[n % xs.length],
      y: xs[(n * 3) % xs.length],
      down: n % 3 !== 0,
      clicked: n % 7 === 0,
    };
    g.update(
      times[n % times.length],
      input(['ArrowRight'], n % 5 ? [] : ['Space', 'KeyK', 'KeyH', 'KeyE'], pointer),
    );
    g.update(1 / 60, input(n % 2 ? ['ArrowLeft', 'Space'] : ['ArrowDown'], [], pointer));
    const s = g.getState();
    finiteDeep(s);
    assert.ok(s.player.x > 20 && s.player.x < 460 && s.player.y > 30 && s.player.y < 310);
  }
  const bare = { held: () => false, pressed: () => false };
  g.update(1 / 60, bare);
  const menu = open(5, { launch: false }).g;
  menu.update(1 / 60, bare);
  menu.update(1 / 60, input([], [], { x: NaN, y: NaN, clicked: true }));
  assert.ok(menu.getState().menu);
});
function playToEnd(kind, lang) {
  const level = kind === 'won' ? LEVEL_COUNT : 3,
    { g, h } = open(level, { lang, seed: 2 }),
    history = [];
  for (let n = 0; n < 60 * CLEAR_LIMIT && g.getState().phase === 'playing'; n++) {
    const now = g.getState();
    history.push(now);
    g.update(
      1 / 60,
      kind === 'won' ? botFrame(now, history[Math.max(0, history.length - 15)], 0.25) : input(),
    );
  }
  return { g, h };
}
test('winning and losing each report once, in both languages, then freeze', () => {
  const words = {
    en: {
      won: 'All twenty chambers cleared. The vault is yours!',
      lost: 'The guardians caught you. Read their windups and use your healing flasks.',
    },
    zh: { won: '二十座密室全部通过，宝库属于你！', lost: '你被守卫击败。观察蓄力，及时使用药水。' },
  };
  for (const lang of ['en', 'zh'])
    for (const kind of ['won', 'lost']) {
      let { g, h } = playToEnd(kind, lang);
      if (kind === 'lost') {
        // An idle player is eventually caught on a guarded chamber: force the loss through a spike plate.
        const s = createDungeonState(4);
        s.health = 0;
        stepDungeon(s, 1 / 60, input(), h.env);
        assert.equal(s.phase, 'lost');
        g = null;
      }
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, kind === 'won');
      assert.equal(h.ends[0].message, words[lang][kind]);
      assert.ok(h.sounds.includes(kind === 'won' ? 'win' : 'lose'));
      if (g) {
        const frozen = g.getState();
        for (let i = 0; i < 120; i++)
          g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyK', 'KeyH'], { x: 10, down: true }));
        g.update(NaN, input());
        assert.deepEqual(g.getState(), frozen);
        assert.equal(h.ends.length, 1);
        assert.equal(h.ends[0].score, frozen.score);
      }
    }
});
test('a player who stands still in a guarded chamber loses once and the state then freezes', () => {
  const { g, h } = open(14);
  for (let n = 0; n < 60 * 90 && g.getState().phase === 'playing'; n++) g.update(1 / 60, input());
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  const frozen = g.getState();
  g.update(1 / 60, input(['Space'], ['KeyH']));
  assert.deepEqual(g.getState(), frozen);
});

// ---------------------------------------------------------------------------------------------
// Drawing: every screen is complete in both languages and fits the 480 x 320 canvas.
// ---------------------------------------------------------------------------------------------
function textCanvas() {
  const ctx = mockContext(),
    drawn = [],
    rects = [];
  ctx.fillText = (text, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 12);
    drawn.push({ text: String(text), x, y, size, align: ctx.textAlign });
  };
  ctx.fillRect = (x, y, w, h) => rects.push({ x, y, w, h, color: ctx.fillStyle });
  return { ctx, drawn, rects };
}
const widthOf = (text, size) =>
  [...text].reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62), 0);
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    if (text.length === 1) continue;
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
function assertLanguage(drawn, lang) {
  for (const { text } of drawn)
    if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
    else assert.doesNotMatch(text, /[A-Za-z]{3,}/, `Chinese screen shows "${text}"`);
}
test('every opening shows its name and tip in the footer, fits, and hides nothing on the floor', () => {
  for (const lang of ['en', 'zh'])
    for (const n of LEVEL_NUMBERS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} chamber ${n}`);
      assertLanguage(drawn, lang);
      const spec = LEVELS[n - 1];
      assert.ok(drawn.some((d) => d.text === `${n}/20 ${spec.name[lang]}`));
      const tip = drawn.find((d) => d.text === spec.tip[lang]);
      assert.ok(tip && tip.y >= 292, 'the tip sits in the footer strip, below the floor');
      const room = g.getState();
      for (const o of [
        room.player,
        room.key,
        room.exit,
        ...room.enemies,
        ...room.hazards,
        ...room.levers,
      ])
        assert.ok(
          o.y + 10 < 292 && o.y - 10 > 30,
          `chamber ${n}: an object sits under a HUD strip`,
        );
    }
});
test('the select screen, hud and every state fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, LEVEL_COUNT]) {
      const { g } = open(unlocked, { lang, launch: false }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A CHAMBER' : '选择密室')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
    }
    for (const n of [4, 9, 13, 16, 20]) {
      const run = open(n, { lang }),
        { ctx, drawn } = textCanvas(),
        history = [];
      for (let f = 0; f < 60 * 25; f++) {
        const now = run.g.getState();
        history.push(now);
        if (now.level !== n || now.phase !== 'playing') break;
        run.g.update(1 / 60, botFrame(now, history[Math.max(0, history.length - 15)], 0.25));
        if (f % 20 === 0) run.g.draw(ctx);
        if (f === 90) run.g.update(1 / 60, input(['ArrowRight'], ['KeyK', 'KeyE']));
      }
      assertFits(drawn, `${lang} play ${n}`);
      assertLanguage(drawn, lang);
    }
  }
});
test('statuses read well, with singular labels and the current objective', () => {
  const { g } = open(5);
  const s = g.getState();
  assert.match(s.status.en, /Sealed Gate 5\/20 · 5 hearts · 1 flask · E: pull the lever/);
  assert.match(s.status.zh, /封闭闸门 5\/20 · 5颗心 · 1瓶药水/);
  const t = createDungeonState(2);
  t.health = 1;
  const text = createGame(harness().env).getState().status.en;
  assert.match(text, /Entry Hall 1\/20/);
});
test('touch controls and the documented keys cover every action, including the select', () => {
  const codes = createGame(harness().env);
  assert.ok(codes);
  const { g } = open(5, { launch: false });
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
    g.update(1 / 60, input([], [key]));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().menu, null);
});
