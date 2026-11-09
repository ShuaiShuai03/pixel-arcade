import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createSnakeState,
  updateSnake,
  LEVELS,
  LEVEL_COUNT,
  meta,
} from '../src/games/neon-snake.js';
import { COLS, ROWS } from '../src/games/neon-snake-levels.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/neon-snake-menu.js';
import { drawGame, readyPanel, wrapText } from '../src/games/neon-snake-hud.js';
import { InputState } from '../src/shared/input.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const CJK = /[一-鿿]/;
const REACTION_SECONDS = 0.3;
const STEP_LAG_SECONDS = 0.04;
const DIRS = [
  { x: 1, y: 0, key: 'ArrowRight' },
  { x: 0, y: 1, key: 'ArrowDown' },
  { x: -1, y: 0, key: 'ArrowLeft' },
  { x: 0, y: -1, key: 'ArrowUp' },
];
const cellId = (x, y) => y * COLS + x;
const onBoard = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const headingOf = (d) => DIRS.findIndex((v) => v.x === d.x && v.y === d.y);

/** Can the head still walk to its own tail once the body stands still? */
function reachesTail(rocks, body) {
  const blocked = new Set([...body.slice(0, -1), ...rocks].map((p) => cellId(p.x, p.y))),
    tail = body.at(-1),
    seen = new Set([cellId(body[0].x, body[0].y)]),
    queue = [body[0]];
  for (const p of queue)
    for (const d of DIRS) {
      const x = p.x + d.x,
        y = p.y + d.y;
      if (!onBoard(x, y) || seen.has(cellId(x, y))) continue;
      if (x === tail.x && y === tail.y) return true;
      if (blocked.has(cellId(x, y))) continue;
      seen.add(cellId(x, y));
      queue.push({ x, y });
    }
  return false;
}

/** Breadth-first route to the fruit that honours the gate clock, the vacating tail and the trail. */
function route(s) {
  const food = s.food,
    length = s.snake.length,
    rocks = new Set(s.rocks.map((p) => cellId(p.x, p.y))),
    gates = new Map(s.gates.map((g) => [cellId(g.x, g.y), g])),
    body = new Map(s.snake.map((p, i) => [cellId(p.x, p.y), i])),
    seen = new Set(),
    queue = [
      { x: s.snake[0].x, y: s.snake[0].y, dir: headingOf(s.direction), depth: 0, parent: null },
    ];
  for (const p of queue) {
    if (p.depth >= 140) break;
    for (let n = 0; n < 4; n++) {
      const x = p.x + DIRS[n].x,
        y = p.y + DIRS[n].y,
        d = p.depth;
      if ((n + 2) % 4 === p.dir || !onBoard(x, y) || rocks.has(cellId(x, y))) continue;
      const eating = x === food.x && y === food.y,
        old = body.get(cellId(x, y));
      let blocked = old !== undefined && old <= length - (eating ? 1 : 2) - d,
        occupied = old !== undefined && old <= length - 1 - d;
      for (let t = p, k = d; t.parent && k >= d - length + 1 && !blocked; t = t.parent, k--)
        if (t.x === x && t.y === y) {
          occupied = true;
          blocked = eating || k >= d - length + 2;
        }
      const gate = gates.get(cellId(x, y));
      if (
        blocked ||
        (gate && !occupied && Math.floor((s.stageSteps + d) / s.gatePeriod) % 2 !== gate.group)
      )
        continue;
      const visit = `${cellId(x, y)},${n},${d < length ? d : length + ((d - length) % (2 * s.gatePeriod))}`;
      if (seen.has(visit)) continue;
      seen.add(visit);
      const node = { x, y, dir: n, depth: d + 1, parent: p };
      if (!eating) {
        queue.push(node);
        continue;
      }
      const path = [];
      for (let t = node; t.parent; t = t.parent) path.push(t);
      const cells = path.map((c) => ({ x: c.x, y: c.y }));
      if (reachesTail(s.rocks, [...cells, ...s.snake].slice(0, length + 1)))
        return path.reverse().map((c) => c.dir);
    }
  }
  return null;
}

/** No safe route: take the legal move that keeps the most room. */
function survive(s) {
  const body = new Set(s.snake.slice(0, -1).map((p) => cellId(p.x, p.y))),
    blocked = new Set([...s.rocks, ...s.gates].map((p) => cellId(p.x, p.y))),
    heading = headingOf(s.direction),
    tail = s.snake.at(-1);
  let best = heading,
    bestScore = -Infinity;
  for (let n = 0; n < 4; n++) {
    const x = s.snake[0].x + DIRS[n].x,
      y = s.snake[0].y + DIRS[n].y;
    if ((n + 2) % 4 === heading || !onBoard(x, y)) continue;
    if (body.has(cellId(x, y)) || blocked.has(cellId(x, y))) continue;
    const seen = new Set([cellId(x, y)]),
      queue = [{ x, y }];
    for (const p of queue)
      for (const d of DIRS) {
        const nx = p.x + d.x,
          ny = p.y + d.y;
        if (!onBoard(nx, ny) || seen.has(cellId(nx, ny))) continue;
        if (body.has(cellId(nx, ny)) || blocked.has(cellId(nx, ny))) continue;
        seen.add(cellId(nx, ny));
        queue.push({ x: nx, y: ny });
      }
    const score = seen.size * 10 - Math.abs(x - tail.x) - Math.abs(y - tail.y);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return DIRS[best].key;
}

/** Decides from getState() alone. Fresh fruit costs `reaction` seconds; every step costs a short lag. */
function makeBot({ reaction = 0, focus = true } = {}) {
  let steps = -1,
    food = '',
    level = 0,
    foodAt = 0,
    stepAt = 0,
    pending = false;
  return (s) => {
    if (s.betweenGardens) {
      steps = -1;
      return { held: [], pressed: ['Enter'] };
    }
    const held = focus && s.stepTime < 0.17 && (s.braking || s.brake > 0.2) ? ['Space'] : [];
    if (s.ready > 0) return { held, pressed: [] };
    const seenFood = `${s.food.x},${s.food.y}`;
    if (s.level !== level || seenFood !== food) {
      level = s.level;
      food = seenFood;
      foodAt = stepAt = s.time;
      pending = true;
    }
    if (s.steps !== steps) {
      steps = s.steps;
      stepAt = s.time;
      pending = true;
    }
    const pressed = [];
    if (pending && s.time >= Math.max(stepAt + STEP_LAG_SECONDS, foodAt + reaction)) {
      pending = false;
      const key = route(s) ? DIRS[route(s)[0]].key : survive(s),
        current = DIRS[headingOf(s.direction)].key;
      if (key !== current) pressed.push(key);
    }
    return { held, pressed };
  };
}

const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const BLIND = {
  idle: () => ({ held: [], pressed: [] }),
  mash: (random) => {
    const key = KEYS[Math.floor(random() * 4)];
    return { held: [key, 'Space'], pressed: [key, 'Enter', 'KeyC'] };
  },
  random: (random, n) =>
    n % 6 === 0
      ? { held: [], pressed: [KEYS[Math.floor(random() * 4)]] }
      : { held: [], pressed: [] },
};

/** Start `level` the way a player does: through the select screen once something is unlocked. */
function openLevel(level, { seed = 1, lang = 'en', progress, launch = true } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress =
    progress === undefined
      ? { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) }
      : progress;
  h.store = () => unlocked;
  const g = createGame(h.env);
  if (level > 1 && h.env.progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const cleared = (s, start) => s.phase === 'won' || s.betweenGardens || s.level > start;

function play(g, policy, { hz = 60, seconds = 120, until = () => false } = {}) {
  const random = seeded(77);
  let n = 0;
  for (; n < hz * seconds; n++) {
    const s = g.getState();
    if (s.phase !== 'playing' || until(s)) break;
    const { held, pressed } = policy(s, random, n);
    g.update(1 / hz, input(held, pressed));
  }
  return g.getState();
}
const runLevel = (g, level, policy, options) =>
  play(g, policy, { ...options, until: (s) => cleared(s, level) });
const botFor = (reaction, focus) => {
  const bot = makeBot({ reaction, focus });
  return (s) => bot(s);
};
const skipReady = (g, hz = 60) => {
  while (g.getState().ready > 0) g.update(1 / hz, input());
};

// ---------------------------------------------------------------------------------------------
// The level table.
// ---------------------------------------------------------------------------------------------
test('there are at least 20 frozen, numbered, bilingual levels with distinct layouts', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.ok(Object.isFrozen(LEVELS));
  const layouts = new Set();
  for (const [i, level] of LEVELS.entries()) {
    assert.equal(level.n, i + 1);
    for (const part of [level, level.name, level.tip, level.rocks, level.gates, level.passes])
      assert.ok(Object.isFrozen(part), `level ${level.n} is frozen`);
    for (const list of [level.rocks, level.gates, level.passes, level.snake, level.beds])
      for (const item of list) assert.ok(Object.isFrozen(item));
    for (const field of [level.name, level.tip]) {
      assert.ok(field.en.length > 3 && !CJK.test(field.en));
      assert.ok(CJK.test(field.zh));
    }
    assert.ok(level.period >= 0.12 && level.period <= 0.26);
    assert.ok(level.ready >= 2);
    layouts.add(JSON.stringify([level.rocks, level.gates, level.passes, level.snake, level.beds]));
  }
  assert.equal(layouts.size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
});

test('every start, body and fruit bed sits on legal, unoccupied cells', () => {
  for (const level of LEVELS) {
    const solid = new Set(
      [...level.rocks, ...level.gates, ...level.passes].map((p) => `${p.x},${p.y}`),
    );
    const body = new Set(level.snake.map((p) => `${p.x},${p.y}`));
    assert.equal(body.size, level.snake.length);
    level.snake.forEach((p, i) => {
      assert.ok(onBoard(p.x, p.y) && !solid.has(`${p.x},${p.y}`), `level ${level.n} body`);
      if (i)
        assert.equal(
          Math.abs(p.x - level.snake[i - 1].x) + Math.abs(p.y - level.snake[i - 1].y),
          1,
        );
    });
    const ahead = {
      x: level.snake[0].x + level.direction.x,
      y: level.snake[0].y + level.direction.y,
    };
    assert.ok(onBoard(ahead.x, ahead.y) && !solid.has(`${ahead.x},${ahead.y}`));
    assert.equal(level.target, level.beds.length);
    for (const bed of level.beds)
      for (const p of bed)
        assert.ok(
          onBoard(p.x, p.y) && !solid.has(`${p.x},${p.y}`) && !body.has(`${p.x},${p.y}`),
          `level ${level.n} bed ${p.x},${p.y}`,
        );
  }
});

test('the curve teaches first, combines next and ends on mastery levels', () => {
  const avg = (levels, field) => levels.reduce((sum, l) => sum + field(l), 0) / levels.length;
  const teach = LEVELS.slice(0, 7),
    combine = LEVELS.slice(7, 14),
    master = LEVELS.slice(14);
  for (const field of [(l) => l.target, (l) => l.snake.length, (l) => 1 / l.period]) {
    assert.ok(avg(combine, field) > avg(teach, field));
    assert.ok(avg(master, field) > avg(combine, field) * 0.95);
  }
  assert.ok(LEVELS[0].ready >= 3.5 && LEVELS[0].period >= 0.25);
  assert.deepEqual(
    teach.map((l) => [l.gates.length > 0, l.passes.length > 0]),
    [
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [true, false],
      [false, true],
      [false, false],
    ],
  );
  assert.ok(master.every((l) => l.target >= 7));
});

test('each tip describes what its level really does', () => {
  const claims = {
    1: (l) => l.rocks.length < 10 && !l.gates.length,
    2: (l) => l.rocks.length >= 15,
    3: (l) => l.rocks.length >= 30,
    4: (l) => l.period < 0.15,
    5: (l) => l.gatePeriod === 4 && l.gates.length === 2,
    6: (l) => l.passes.length >= 1 && l.rocks.length > 14,
    7: (l) => l.snake.length >= 12,
    8: (l) => l.gates.length === 4 && new Set(l.gates.map((g) => g.y)).size === 2,
    9: (l) => l.gatePeriod === 3,
    10: (l) => l.passes.length >= 4 && new Set(l.passes.map((p) => p.x)).size === 2,
    11: (l) => l.period < 0.13,
    12: (l) => l.passes.length >= 2 && l.gates.length >= 2,
    13: (l) => l.snake.length >= 14 && l.rocks.length === 128,
    14: (l) => l.gatePeriod === 2,
    15: (l) => l.period < 0.14 && l.gates.length >= 2,
    16: (l) => l.passes.length >= 2 && l.gates.length >= 2,
    17: (l) => l.snake.length >= 16 && openNeighbours(l).every((n) => n <= 2),
    18: (l) => l.gatePeriod === 3 && l.gates.length >= 6,
    19: (l) => l.snake.length >= 16 && l.target === 10,
    20: (l) => l.passes.length && l.gates.length && l.rocks.length && l.snake.length >= 11,
  };
  const openNeighbours = (l) => {
    const solid = new Set(l.rocks.map((p) => `${p.x},${p.y}`));
    return Array.from({ length: COLS * ROWS }, (_, i) => ({ x: i % COLS, y: Math.floor(i / COLS) }))
      .filter((p) => !solid.has(`${p.x},${p.y}`))
      .map(
        (p) =>
          DIRS.filter(
            (d) => onBoard(p.x + d.x, p.y + d.y) && !solid.has(`${p.x + d.x},${p.y + d.y}`),
          ).length,
      );
  };
  for (const level of LEVELS) assert.ok(claims[level.n](level), `tip ${level.n}: ${level.tip.en}`);
  assert.match(LEVELS[8].tip.en, /3 moves/);
  assert.match(LEVELS[13].tip.en, /2 moves/);
  assert.match(LEVELS[4].tip.en, /4 moves/);
  assert.match(LEVELS[18].tip.en, /ten fruit/);
});

// ---------------------------------------------------------------------------------------------
// Fair start and legal clears.
// ---------------------------------------------------------------------------------------------
test('a new player gets time to read; an idle player survives the opening of level 1', () => {
  for (const hz of HZS) {
    const { g } = openLevel(1);
    const first = g.getState();
    assert.ok(first.ready >= 3.5);
    for (let n = 0; n < hz * 3; n++) g.update(1 / hz, input());
    assert.deepEqual(g.getState().snake, first.snake);
    assert.equal(g.getState().steps, 0);
    for (let n = 0; n < hz * 5; n++) g.update(1 / hz, input());
    assert.equal(g.getState().phase, 'playing', `still playing 8 s in at ${hz} Hz`);
  }
  for (const level of LEVELS) assert.ok(level.ready >= 2, 'every level opens with a countdown');
});

test('a scripted legal clear exists for every level through the select screen', () => {
  for (const level of LEVEL_NUMBERS) {
    const { g, h } = openLevel(level, { seed: level });
    const s = runLevel(g, level, botFor(0, false));
    assert.ok(cleared(s, level), `level ${level} cleared`);
    assert.equal(s.stageFruit, LEVELS[level - 1].target);
    assert.equal(s.phase, level === LEVEL_COUNT ? 'won' : 'playing');
    assert.equal(h.store(), Math.min(LEVEL_COUNT, level + 1));
    assert.equal(h.ends.length, level === LEVEL_COUNT ? 1 : 0);
  }
});

test('a full campaign from level 1 to the end unlocks in order and ends exactly once', () => {
  const { g, h } = openLevel(1);
  let previous = 1;
  const bot = botFor(0, true);
  const end = play(
    g,
    (s, r, n) => {
      assert.ok(h.store() >= previous && h.store() <= previous + 1);
      previous = h.store();
      return bot(s, r, n);
    },
    { seconds: 900 },
  );
  assert.equal(end.phase, 'won');
  assert.equal(end.level, LEVEL_COUNT);
  assert.equal(h.store(), LEVEL_COUNT);
  const fruit = LEVELS.reduce((sum, l) => sum + l.target, 0);
  assert.equal(end.eaten, fruit);
  assert.equal(end.score, fruit * 100 + LEVEL_COUNT * 200);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, end.score);
  assert.equal(h.sounds.filter((n) => n === 'win').length, 1);
  assert.ok(end.crossings >= 12);
});

test('a reaction-limited bot that reads only getState clears every level at 30, 60 and 120 Hz', () => {
  for (const hz of HZS)
    for (const level of LEVEL_NUMBERS) {
      const { g } = openLevel(level, { seed: level + hz });
      const s = runLevel(g, level, botFor(REACTION_SECONDS, true), { hz });
      assert.ok(cleared(s, level), `level ${level} at ${hz} Hz (${s.phase} ${s.crash?.reason})`);
    }
});

test('the slowest reaction tested still clears the hardest levels, with and without Calm', () => {
  for (const level of [4, 11, 15, 20]) {
    const slow = botFor(0.35, true);
    const { g } = openLevel(level, { seed: 5 });
    assert.ok(cleared(runLevel(g, level, slow), level), `level ${level}`);
    const calm = openLevel(level, { seed: 5 }).g;
    calm.update(1 / 60, input([], ['KeyC']));
    assert.equal(calm.getState().calm, true);
    assert.ok(cleared(runLevel(calm, level, botFor(0.3, false)), level), `calm ${level}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Blind policies and determinism.
// ---------------------------------------------------------------------------------------------
test('idle, mash and random-key players win at most 25% of any level from level 3', () => {
  const seeds = [1, 2, 3, 4];
  for (const [name, policy] of Object.entries(BLIND))
    for (const level of BLIND_LEVELS) {
      let wins = 0;
      for (const seed of seeds) {
        const { g } = openLevel(level, { seed });
        wins += cleared(
          runLevel(g, level, (s, random, n) => policy(random, n), { seconds: 40 }),
          level,
        )
          ? 1
          : 0;
      }
      assert.ok(
        wins / seeds.length <= 0.25,
        `${name} won ${wins}/${seeds.length} of level ${level}`,
      );
    }
});

test('the same inputs give the same game at 30, 60 and 120 Hz', () => {
  const comparable = (s) => ({
    snake: s.snake,
    food: s.food,
    score: s.score,
    steps: s.steps,
    eaten: s.eaten,
    level: s.level,
    stageSteps: s.stageSteps,
    stageFruit: s.stageFruit,
    phase: s.phase,
    crossings: s.crossings,
    ready: Math.round(s.ready * 1e6),
    time: Math.round(s.time * 1e6),
  });
  for (const level of [3, 5, 6, 9, 12, 16, 18]) {
    const reference = openLevel(level, { seed: 3 }).g,
      script = [],
      bot = makeBot({ reaction: 0.25, focus: false }),
      snapshots = [];
    for (let n = 0; n < 60 * 14 && reference.getState().phase === 'playing'; n++) {
      const s = reference.getState(),
        { pressed } = bot(s);
      for (const key of pressed) script.push({ steps: s.steps, key });
      reference.update(1 / 60, input([], pressed));
      if (n % 30 === 29) snapshots.push(comparable(reference.getState()));
    }
    assert.ok(script.length >= 3, `level ${level} script`);
    for (const hz of [30, 120]) {
      const g = openLevel(level, { seed: 3 }).g;
      let next = 0;
      for (let n = 0; n < (hz / 60) * snapshots.length * 30; n++) {
        const s = g.getState(),
          pressed = [];
        if (next < script.length && s.steps >= script[next].steps) pressed.push(script[next++].key);
        g.update(1 / hz, input([], pressed));
        if (n % (hz / 2) === hz / 2 - 1) {
          const want = snapshots[(n + 1) / (hz / 2) - 1];
          assert.deepEqual(
            comparable(g.getState()),
            want,
            `level ${level} at ${hz} Hz after ${n + 1} frames`,
          );
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Select, continue and broken stores.
// ---------------------------------------------------------------------------------------------
test('a returning player picks a cleared level with arrows, Enter or a tap; locked cells refuse', () => {
  const { g, h } = openLevel(7, { launch: false });
  let s = g.getState();
  assert.deepEqual(s.menu, { cursor: 7, unlocked: 7, total: LEVEL_COUNT, columns: MENU_COLUMNS });
  assert.match(s.status.en, /Choose a level/);
  assert.match(s.status.zh, /选择关卡/);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['KeyA']));
  assert.equal(g.getState().menu.cursor, 5);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  g.update(1 / 60, input([], ['ArrowRight', 'ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 7);
  const locked = menuCell(12);
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true, down: true }));
  assert.ok(h.sounds.includes('hit'));
  assert.equal(g.getState().menu.cursor, 7);
  const third = menuCell(3);
  g.update(1 / 60, input([], [], { x: third.x + 5, y: third.y + 5, clicked: true, down: true }));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 3);
  assert.equal(s.score, 0);
  assert.equal(s.snake.length, LEVELS[2].snake.length);
  assert.ok(s.ready > 0);
  assert.equal(s.unlocked, 7);
  const again = openLevel(4, { launch: false }).g;
  again.update(1 / 60, input([], ['Enter']));
  assert.equal(again.getState().level, 4);
  assert.deepEqual(menuTarget(input(), 2, 5), {
    cursor: 2,
    moved: false,
    denied: false,
    start: false,
  });
  assert.equal(menuTarget(input([], [], { x: NaN, y: 4, clicked: true }), 2, 5).start, false);
  assert.equal(menuTarget({ pressed: () => false }, 2, 5).start, false);
});

test('clearing a level unlocks the next, and a new session continues from it', () => {
  const store = openLevel(1);
  assert.equal(store.g.getState().menu, null, 'a new player starts at once');
  const s = runLevel(store.g, 1, botFor(0, false));
  assert.ok(s.betweenGardens);
  assert.equal(store.h.store(), 2);
  assert.equal(store.g.getState().unlocked, 2);
  assert.equal(store.h.ends.length, 0);
  const next = createGame(store.h.env);
  assert.equal(next.getState().menu.cursor, 2);
  store.g.update(1 / 60, input([], ['Enter']));
  assert.equal(store.g.getState().level, 2);
  assert.equal(store.g.getState().betweenGardens, false);
});

test('broken, throwing and junk progress stores are clamped and never stop the game', () => {
  const stores = {
    throws: {
      unlocked: () => {
        throw Error('storage denied');
      },
      unlock: () => {
        throw Error('storage denied');
      },
    },
    nan: { unlocked: () => NaN, unlock() {} },
    infinite: { unlocked: () => Infinity, unlock() {} },
    negative: { unlocked: () => -4, unlock() {} },
    zero: { unlocked: () => 0, unlock() {} },
    huge: { unlocked: () => 999, unlock() {} },
    text: { unlocked: () => '6', unlock() {} },
    object: { unlocked: () => ({}), unlock() {} },
    nothing: { unlocked: () => undefined, unlock() {} },
    fraction: { unlocked: () => 3.9, unlock() {} },
    missing: {},
    none: null,
  };
  const expected = {
    throws: 1,
    nan: 1,
    infinite: 1,
    negative: 1,
    zero: 1,
    huge: LEVEL_COUNT,
    text: 6,
    object: 1,
    nothing: 1,
    fraction: 3,
    missing: 1,
    none: 1,
  };
  for (const [name, progress] of Object.entries(stores)) {
    const { g } = openLevel(1, { progress });
    const s = g.getState();
    assert.equal(s.unlocked, expected[name], name);
    if (expected[name] === 1) assert.equal(s.menu, null, name);
    else assert.equal(s.menu.cursor, expected[name], name);
    g.update(1 / 60, input([], ['Enter']));
    g.draw(mockContext());
    const started = g.getState();
    assert.ok(started.level >= 1 && started.level <= LEVEL_COUNT, name);
  }
  const { g, h } = openLevel(1, { progress: stores.throws });
  const s = runLevel(g, 1, botFor(0, false));
  assert.ok(s.betweenGardens, 'a level clears even when the store throws on save');
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, 2);
  assert.equal(h.ends.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Hostile values, terminal behaviour, controls.
// ---------------------------------------------------------------------------------------------
const finiteDeep = (v) => {
  if (typeof v === 'number') assert.ok(Number.isFinite(v));
  else if (v && typeof v === 'object') Object.values(v).forEach(finiteDeep);
};

test('hostile dt and pointer values never corrupt play, the menu or the clear screen', () => {
  const dts = [NaN, Infinity, -Infinity, -1, 0, '0.5', null, undefined, {}, 1e9, 1e-300, 3];
  const pointers = [
    undefined,
    null,
    {},
    { x: NaN, y: NaN, down: true, clicked: true },
    { x: Infinity, y: -Infinity, down: true },
    { x: 1e308, y: -1e308, down: true, clicked: true },
    { x: '40', y: '40', down: true },
    { x: -50, y: 900, down: 'yes', clicked: 1 },
  ];
  const screens = [
    () => openLevel(1).g,
    () => openLevel(9, { launch: false }).g,
    () => {
      const { g } = openLevel(1);
      runLevel(g, 1, botFor(0, false));
      return g;
    },
  ];
  for (const make of screens) {
    const g = make();
    for (const dt of dts)
      for (const pointer of pointers) {
        g.update(dt, { held: () => false, pressed: () => false, pointer });
        finiteDeep(g.getState());
      }
    for (let n = 0; n < 600; n++) g.update(1 / 60, input(['Space'], [], pointers[3] ?? {}));
    g.draw(mockContext());
    finiteDeep(g.getState());
    assert.ok(g.getState().snake.length <= LEVELS.at(-1).snake.length + LEVEL_COUNT * 12);
  }
  const huge = openLevel(1).g,
    capped = openLevel(1).g;
  huge.update(1e9, input());
  capped.update(1 / 30, input());
  assert.deepEqual(huge.getState(), capped.getState());
});

test('every loss gives one bilingual message, one env.end and a frozen terminal state', () => {
  const setups = {
    edge: (s) =>
      Object.assign(s, {
        snake: [
          { x: 23, y: 7 },
          { x: 22, y: 7 },
        ],
        direction: { x: 1, y: 0 },
      }),
    stone: (s) => {
      s.rocks = [{ x: 5, y: 7 }];
    },
    gate: (s) =>
      Object.assign(s, {
        stageSteps: 4,
        snake: [
          { x: 5, y: 7 },
          { x: 5, y: 8 },
        ],
        direction: { x: 0, y: -1 },
      }),
    body: (s) =>
      Object.assign(s, {
        snake: [
          { x: 8, y: 7 },
          { x: 9, y: 7 },
          { x: 9, y: 8 },
          { x: 8, y: 8 },
        ],
        direction: { x: 1, y: 0 },
      }),
  };
  for (const lang of ['en', 'zh'])
    for (const [reason, setup] of Object.entries(setups)) {
      const h = harness({ lang }),
        s = createSnakeState(reason === 'gate' ? 5 : 1, h.env.random);
      s.ready = 0;
      s.food = { x: 0, y: 0 };
      setup(s);
      for (let n = 0; n < 90 && s.phase === 'playing'; n++) updateSnake(s, 1 / 30, input(), h.env);
      assert.equal(s.crash.reason, reason);
      assert.equal(h.ends.length, 1);
      const [end] = h.ends,
        text = end.message;
      assert.equal(end.won, false);
      assert.equal(end.score, 0);
      assert.match(text, lang === 'en' ? /^Level \d+: / : /^第\d+关：/);
      assert.ok(lang === 'en' ? !CJK.test(text) : CJK.test(text));
      const frozen = structuredClone(s);
      for (let n = 0; n < 30; n++)
        updateSnake(s, 1 / 30, input(['Space', 'ArrowUp'], ['Enter', 'KeyC', 'ArrowDown']), h.env);
      assert.deepEqual(s, frozen);
      assert.equal(h.ends.length, 1);
      assert.deepEqual(
        h.sounds.filter((n) => n === 'lose'),
        ['lose'],
      );
    }
});

test('the winning message is bilingual and the finished game is frozen', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = openLevel(LEVEL_COUNT, { lang });
    const end = runLevel(g, LEVEL_COUNT, botFor(0, true));
    assert.equal(end.phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.ok(
      lang === 'en' ? /All 20 levels/.test(h.ends[0].message) : /20个关卡/.test(h.ends[0].message),
    );
    const frozen = g.getState();
    for (let n = 0; n < 60; n++) g.update(1 / 60, input(['ArrowUp', 'Space'], ['Enter', 'KeyC']));
    assert.deepEqual(g.getState(), frozen);
    assert.equal(h.ends.length, 1);
  }
});

test('touch buttons and the real InputState cover every action', () => {
  for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'Enter', 'KeyC'])
    assert.ok(
      meta.touchControls.some((c) => c.code === code && c.side && c.label.en && c.label.zh),
    );
  assert.ok(meta.keys.every((k) => k.label.en && k.label.zh));
  assert.ok(
    meta.description.en.includes(`${LEVEL_COUNT}`) &&
      meta.description.zh.includes(`${LEVEL_COUNT}`),
  );
  const pad = new InputState(),
    { g } = openLevel(1);
  skipReady(g);
  pad.down('ArrowUp', 'touch-a');
  g.update(1 / 60, pad);
  assert.deepEqual(g.getState().queue, [{ x: 0, y: -1 }]);
  pad.flush();
  pad.up('touch-a');
  pad.down('Space', 'touch-b');
  g.update(1 / 60, pad);
  assert.equal(g.getState().braking, true);
  pad.up('touch-b');
  pad.pulse('KeyC');
  g.update(1 / 60, pad);
  assert.equal(g.getState().calm, true);
  pad.flush();
  const done = openLevel(1);
  runLevel(done.g, 1, botFor(0, false));
  pad.pulse('Enter');
  done.g.update(1 / 60, pad);
  assert.equal(done.g.getState().level, 2);
  const swipe = openLevel(1).g;
  skipReady(swipe);
  swipe.update(1 / 60, input([], [], { x: 200, y: 200, down: true, clicked: true }));
  swipe.update(1 / 60, input([], [], { x: 200, y: 160, down: true }));
  swipe.update(1 / 60, input());
  assert.deepEqual(swipe.getState().queue, [{ x: 0, y: -1 }]);
});

// ---------------------------------------------------------------------------------------------
// Drawing: every screen is complete in both languages and fits the 480 x 320 canvas.
// ---------------------------------------------------------------------------------------------
function textCanvas() {
  const ctx = mockContext(),
    drawn = [];
  ctx.fillText = (text, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 12);
    drawn.push({ text: String(text), x, y, size, align: ctx.textAlign });
  };
  return { ctx, drawn };
}
const widthOf = (text, size) =>
  [...text].reduce(
    (sum, ch) => sum + (CJK.test(ch) || /[：，。！·]/.test(ch) ? size : size * 0.62),
    0,
  );
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    if (text.length === 1) continue;
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(
      left >= 0 && left + w <= 480,
      `${label}: "${text}" spans ${left.toFixed(0)}..${(left + w).toFixed(0)}`,
    );
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}

test('every screen of every level fits the canvas and is fully localized', () => {
  let strings = 0;
  for (const lang of ['en', 'zh'])
    for (const level of LEVEL_NUMBERS) {
      const env = harness({ lang }).env,
        variants = [
          (s) => s,
          (s) =>
            Object.assign(s, {
              ready: 0,
              braking: true,
              brake: 0.4,
              queue: [
                { x: 0, y: -1 },
                { x: 1, y: 0 },
              ],
              crossingFrom: 'left',
              stageSteps: 7,
              calm: true,
            }),
          (s) =>
            Object.assign(s, {
              ready: 0,
              focusLocked: true,
              brake: 0.05,
              crash: { x: -1, y: 7, reason: 'edge' },
              stageSteps: 2,
            }),
          (s) =>
            Object.assign(s, { ready: 0, betweenGardens: true, food: null, stageFruit: s.target }),
        ];
      for (const [i, variant] of variants.entries()) {
        if (i === 3 && level === LEVEL_COUNT) continue;
        const s = variant(createSnakeState(level, env.random)),
          { ctx, drawn } = textCanvas();
        drawGame(ctx, s, env, null);
        assertFits(drawn, `${lang} level ${level} variant ${i}`);
        for (const { text } of drawn) {
          strings++;
          if (lang === 'en') assert.doesNotMatch(text, CJK, `English shows "${text}"`);
          else assert.doesNotMatch(text, /[A-Za-z]{5,}/, `Chinese shows "${text}"`);
        }
        if (i === 0) {
          const tip = LEVELS[level - 1].tip[lang];
          assert.equal(
            drawn.filter((d) => tip.startsWith(d.text) || tip.includes(d.text)).length >= 1,
            true,
          );
          assert.ok(wrapText(tip, 390, 11).length <= 2, `tip ${level} wraps to two lines`);
        }
      }
    }
  for (const lang of ['en', 'zh'])
    for (const unlocked of [2, 9, LEVEL_COUNT])
      for (const cursor of [1, unlocked]) {
        const env = harness({ lang }).env,
          { ctx, drawn } = textCanvas();
        drawGame(ctx, createSnakeState(1, env.random), env, { cursor, unlocked });
        assertFits(drawn, `${lang} select ${unlocked}/${cursor}`);
        assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A LEVEL' : '选择关卡')));
        assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
        if (unlocked < LEVEL_COUNT)
          assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')));
      }
  assert.ok(strings > 1500);
  assert.deepEqual(wrapText('one two', 1000, 10), ['one two']);
  assert.ok(wrapText('a'.repeat(5) + ' ' + 'b'.repeat(5), 40, 10).length === 2);
});

test('the guide and the live game render through the host-facing API without errors', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = openLevel(1, { lang });
    g.draw(mockContext());
    assert.match(g.getState().status[lang], lang === 'en' ? /Meadow 1\/20/ : /草地 1\/20/);
    const done = openLevel(1, { lang });
    runLevel(done.g, 1, botFor(0, false));
    assert.match(done.g.getState().status[lang], lang === 'en' ? /Enter to travel/ : /回车前往/);
    done.g.draw(mockContext());
  }
});

test('the countdown panel never covers the head, the cells ahead of it or the first fruit', () => {
  for (const level of LEVELS) {
    const box = readyPanel(level),
      head = level.snake[0],
      cells = [
        ...Array.from({ length: 4 }, (_, i) => ({
          x: head.x + level.direction.x * i,
          y: head.y + level.direction.y * i,
        })),
        ...level.beds[0],
      ];
    for (const p of cells) {
      const x = p.x * 20,
        y = 40 + p.y * 20,
        overlaps = x < box.x + box.w && x + 20 > box.x && y < box.y + box.h && y + 20 > box.y;
      assert.ok(!overlaps, `level ${level.n} panel hides ${p.x},${p.y}`);
    }
    assert.ok(box.y >= 40 && box.y + box.h <= 320);
  }
});
