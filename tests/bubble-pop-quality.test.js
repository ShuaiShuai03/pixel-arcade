// Final-review quality tests: level data, planner bots, blind bars, banks, progress and terminal state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createBubbleState, stepBubble, meta } from '../src/games/bubble-pop.js';
import { LEVELS } from '../src/games/bubble-pop-levels.js';
import { SYMBOLS, drawBubble } from '../src/games/bubble-pop-draw.js';
import { trace } from '../src/games/bubble-pop-aim.js';
import {
  AIM_MAX,
  AIM_MIN,
  CREATURE,
  LEFT,
  LIMIT,
  RIGHT,
  ROW_H,
  blockedSocket,
  bubblePoint,
  deepest,
  neighbors,
  resolveBubble,
  slots,
} from '../src/games/bubble-pop-rules.js';
import { MENU_COLUMNS, menuCell } from '../src/games/bubble-pop-menu.js';
import { harness, input, mockContext } from './harness.js';

const CJK = /[㐀-鿿]/;
const SILENT = { sound() {} };
function boom() {
  throw new Error('store unavailable');
}
const COUNT = LEVELS.length;
const SAFE_MARGIN = 0;

// Helpers: opening a level through the public game, text measurement and the planner bot
function memoryStore(unlocked) {
  const store = { unlocked };
  return {
    store,
    progress: {
      unlocked: () => store.unlocked,
      unlock: (n) => {
        store.unlocked = Math.max(store.unlocked, n);
      },
    },
  };
}
/** A game started on `level` the way a player does: through the level select when it is unlocked. */
function openLevel(level, { seed = 1, lang = 'en', progress } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = progress ?? memoryStore(level).progress;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { ...h, g };
}
const textWidth = (text, size) =>
  [...text].reduce((w, c) => w + (CJK.test(c) || c === '·' ? size : size * 0.6), 0);
/** A context that records every text draw so tests can check it stays on the 480 x 320 canvas. */
function textRecorder() {
  const ctx = mockContext(),
    texts = [];
  ctx.fillText = (text, x, y) =>
    texts.push({
      text: String(text),
      x,
      y,
      size: parseInt(ctx.font.match(/(\d+)px/)[1], 10),
      align: ctx.textAlign,
    });
  return { ctx, texts };
}
const extents = ({ text, x, size, align }) => {
  const w = textWidth(text, size);
  return align === 'center' ? [x - w / 2, x + w / 2] : align === 'right' ? [x - w, x] : [x, x + w];
};
const busy = (s) =>
  Boolean(
    s.shot ||
    s.capture ||
    s.ceilingMotion ||
    s.transition > 0 ||
    s.pressureWarning > 0 ||
    s.popped.some((p) => p.z < 24.001),
  );
const pointerAt = (angle) => ({
  x: 240 + Math.cos(angle) * 120,
  y: 297 + Math.sin(angle) * 120,
  down: true,
  clicked: true,
});
/** Every shot the guide offers right now: swap or not, over the whole aim range, as the player sees it. */
function candidates(s) {
  const found = [];
  for (const swap of s.current === s.next ? [false] : [false, true]) {
    const color = swap ? s.next : s.current;
    for (let a = AIM_MIN; a <= AIM_MAX + 1e-9; a += 0.02) {
      const { plan, segments } = trace(s, a);
      if (!plan) continue;
      const copy = {
        board: s.board.map((r) => r.slice()),
        obstacles: s.obstacles,
        ceiling: s.ceiling,
        popped: [],
        score: 0,
        combo: 0,
        freed: 0,
      };
      const removed = resolveBubble(copy, plan.row, plan.col, color, SILENT);
      let same = 0;
      for (const [r, c] of neighbors(plan.row, plan.col)) if (copy.board[r][c] === color) same++;
      // Rescue levels: reward clearing the bubbles that hold the lowest crab up.
      const low = s.board.reduce((n, row, i) => (row.includes(CREATURE) ? i : n), -1);
      const above = (b) =>
        b
          .slice(0, low + 1)
          .flat()
          .filter((v) => v >= 0).length;
      found.push({
        a,
        swap,
        removed,
        above: low < 0 ? 0 : above(s.board) - above(copy.board),
        same,
        freed: copy.freed,
        row: plan.row,
        bank: segments.length > 1,
      });
    }
  }
  return found;
}
const good = (c) =>
  c.above * 5 + c.freed * 200 + c.removed * 10 - (c.removed ? 0 : 25) + c.same * 6 - c.row * 0.5;
const worst = (c) => -c.removed * 100 - c.same;
/** Shots that waste capsules without stacking the rack downwards. */
const shallow = (c) => -c.removed * 100 - c.row;
function fire(g, choice, hz) {
  if (choice.swap) g.update(1 / hz, input([], ['KeyX']));
  g.update(1 / hz, input([], [], pointerAt(choice.a)));
}
/**
 * A reaction-limited player who sees only getState(): it waits `delay` seconds after the table
 * settles, picks the best shot the aim guide offers, and aims with the pointer.
 */
function playLevel(
  level,
  { seed = 1, hz = 60, delay = 0.25, seconds = 300, score = good, g: given } = {},
) {
  const run = given ?? openLevel(level, { seed });
  const { g } = run;
  let idle = 0,
    margin = Infinity;
  for (let f = 0; f < seconds * hz; f++) {
    const s = g.getState();
    if (s.phase === 'playing' && s.level === level) margin = Math.min(margin, LIMIT - deepest(s));
    if (s.phase !== 'playing' || s.level !== level)
      return { won: s.phase === 'won' || s.level > level, state: s, margin, ends: run.ends };
    if (busy(s) || s.queuedFire) {
      idle = 0;
      g.update(1 / hz, input());
      continue;
    }
    idle += 1 / hz;
    if (idle < delay) {
      g.update(1 / hz, input());
      continue;
    }
    const choice = candidates(s).reduce((a, c) => (!a || score(c) > score(a) ? c : a), null);
    fire(g, choice, hz);
    idle = 0;
  }
  return { won: false, state: g.getState(), margin, ends: run.ends };
}

// Level data
const symbols = (level) => new Set([...level.rows.join('')].filter((c) => /[0-3]/.test(c)));
const count = (level, ch) => [...level.rows.join('')].filter((c) => c === ch).length;
const cellsOf = (level, ch) =>
  level.rows.flatMap((row, r) => [...row].flatMap((c, i) => (c === ch ? [[r, i]] : [])));

test('there are at least 20 data-driven levels on a teaching, combination and mastery curve', () => {
  assert(COUNT >= 20);
  const tiers = LEVELS.map((l) => l.tier);
  assert.deepEqual([...new Set(tiers)], ['teach', 'combo', 'master']);
  assert(tiers.filter((t) => t === 'teach').length >= 6);
  assert(tiers.filter((t) => t === 'master').length >= 5);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, COUNT);
  assert.equal(new Set(LEVELS.map((l) => l.rows.join('/'))).size, COUNT);
  const hardest = (tier) =>
    Math.max(...LEVELS.filter((l) => l.tier === tier).map((l) => l.rows.length));
  assert(hardest('master') > hardest('teach'));
  assert(LEVELS.some((l) => l.goal === 'free') && LEVELS.some((l) => l.shots > 0));
  assert(LEVELS.some((l) => l.drop > 0) && LEVELS.some((l) => l.misses <= 3));
});
test('exported level, symbol and menu data is frozen', () => {
  for (const data of [
    LEVELS,
    LEVELS[0],
    LEVELS[0].rows,
    LEVELS[0].tip,
    SYMBOLS,
    SYMBOLS[1],
    SYMBOLS[1][0],
    meta,
  ])
    assert(Object.isFrozen(data));
  assert(Object.isFrozen(meta.touchControls[0]));
  assert.throws(() => {
    LEVELS[0].misses = 99;
  });
});
test('every level has valid rows, a legal opening and fits the canvas in both languages', () => {
  for (const [i, level] of LEVELS.entries()) {
    const tag = `level ${i + 1}`;
    assert(level.rows.length >= 4 && level.rows.length + level.drop <= 9, `${tag} height`);
    level.rows.forEach((row, r) => {
      assert(row.length <= slots(r) && /^[0-3.#a]+$/.test(row), `${tag} row ${r}`);
    });
    assert(/^[0-3]/.test(level.rows[0]) && !level.rows[0].includes('a'), `${tag} top row`);
    for (const part of [level.name, level.tip]) {
      assert(part.en.length > 3 && !CJK.test(part.en), `${tag} EN`);
      assert(CJK.test(part.zh), `${tag} ZH`);
    }
    assert(textWidth(level.tip.en, 9) <= 456 && textWidth(level.tip.zh, 9) <= 456, `${tag} tip`);
    const title = (name, lang) =>
      `${lang === 'en' ? name.en.toUpperCase() : name.zh} ${i + 1}/${COUNT}`;
    assert(textWidth(title(level.name, 'en'), 11) <= 180, `${tag} EN title`);
    assert(textWidth(title(level.name, 'zh'), 11) <= 180, `${tag} ZH title`);
    assert(textWidth(`${i + 1}. ${level.name.en} · Combination`, 12) <= 456);
    assert(Object.keys(level).sort().join() === 'drop,goal,misses,name,rows,shots,tier,tip');
    // Every symbol is a real group to build, and the opening is anchored and legal.
    for (const sym of symbols(level)) assert(count(level, sym) >= 3, `${tag} symbol ${sym}`);
    const state = createBubbleState(harness().env, i + 1);
    assert.equal(state.ceiling, level.drop * ROW_H);
    assert(LIMIT - deepest(state) >= 2 * ROW_H, `${tag} starts with room for two pusher moves`);
    assert.equal(level.goal === 'free', count(level, 'a') > 0, `${tag} goal matches crabs`);
    for (const [r, c] of cellsOf(level, 'a')) {
      assert(r > 0, `${tag} crab on the ceiling`);
      for (const [rr, cc] of neighbors(r, c))
        assert.notEqual(level.rows[rr]?.[cc], '#', `${tag} crab by a bolt`);
    }
    const reach = new Set(),
      queue = [];
    const add = (r, c) => {
      if (state.board[r]?.[c] >= 0 && !reach.has(`${r},${c}`)) {
        reach.add(`${r},${c}`);
        queue.push([r, c]);
      }
    };
    for (let c = 0; c < slots(0); c++) add(0, c);
    for (const o of state.obstacles) for (const [r, c] of neighbors(o.row, o.col)) add(r, c);
    for (let k = 0; k < queue.length; k++) for (const [r, c] of neighbors(...queue[k])) add(r, c);
    assert.equal(reach.size, state.board.flat().filter((v) => v >= 0).length, `${tag} floats`);
  }
});
test('every tip names only what its level really does, in both languages', () => {
  const rules = [
    [/crab/i, (l) => l.goal === 'free'],
    [/four crabs/i, (l) => count(l, 'a') === 4],
    [/three crabs/i, (l) => count(l, 'a') === 3],
    [/five crabs/i, (l) => count(l, 'a') === 5],
    [/four symbols/i, (l) => symbols(l).size === 4],
    [/limited/i, (l) => l.shots > 0],
    [/bolt/i, (l) => count(l, '#') > 0],
    [/tight pusher|3 misses/i, (l) => l.misses <= 3],
    [/one row down/i, (l) => l.drop === 1],
    [/two rows down/i, (l) => l.drop === 2],
    [/eight rows/i, (l) => l.rows.length === 8],
    [/swap/i, (l) => symbols(l).size === 4],
  ];
  for (const [i, level] of LEVELS.entries()) {
    const tip = level.tip.en;
    for (const [pattern, holds] of rules)
      if (pattern.test(tip)) assert(holds(level), `level ${i + 1} tip "${tip}" vs ${pattern}`);
    assert.equal(/limited/i.test(tip), level.shots > 0, `level ${i + 1} budget mention`);
    assert.equal(/bolt/i.test(tip), count(level, '#') > 0, `level ${i + 1} bolt mention`);
    assert.equal(/crab/i.test(tip), level.goal === 'free', `level ${i + 1} crab mention`);
    assert.equal(/螃蟹/.test(level.tip.zh), level.goal === 'free');
    assert.equal(/有限/.test(level.tip.zh), level.shots > 0);
    assert.equal(/固定栓/.test(level.tip.zh), count(level, '#') > 0);
  }
  // The hanging-group lesson really has a shot that drops bubbles it did not match.
  const { g } = openLevel(2);
  const hanging = candidates(g.getState()).some((c) => c.removed > 3);
  assert(hanging, 'level 2 offers a drop shot');
  assert(/hanging/i.test(LEVELS[1].tip.en));
});
test('each colour has its own non-colour symbol and crabs have a distinct shape', () => {
  const mask = (rects) => {
    const grid = Array.from({ length: 6 }, () => Array(6).fill('.'));
    for (const [x, y, w, h] of rects)
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) grid[Math.floor(y + 3 + dy)][Math.floor(x + 3 + dx)] = '#';
    return grid.map((r) => r.join('')).join('/');
  };
  assert.equal(SYMBOLS.length, 4);
  assert.equal(new Set(SYMBOLS.map(mask)).size, 4);
  for (const rects of SYMBOLS) assert(rects.length > 0);
  // A drawn board uses all four symbol shapes and a crab.
  const rects = [],
    ctx = mockContext();
  ctx.fillRect = (...a) => rects.push([ctx.fillStyle, ...a]);
  openLevel(8).g.draw(ctx);
  const shapes = new Set(rects.filter((r) => r[0] === '#274b59').map((r) => r.slice(3, 5).join()));
  assert(shapes.size >= 4 && rects.some((r) => r[0] === '#e0765f'));
});

// Fair start and blind bars
test('an idle player never loses and the opening shows the player, the first rows and the guide', () => {
  for (let level = 1; level <= COUNT; level++) {
    const { g, ends } = openLevel(level);
    const first = g.getState();
    assert.equal(first.menu, null);
    assert.equal(first.level, level);
    assert(first.shot === null && first.popped.length === 0);
    for (let f = 0; f < 30 * 20; f++) g.update(1 / 30, input());
    const idle = g.getState();
    assert.equal(idle.phase, 'playing');
    assert.equal(idle.ceiling, LEVELS[level - 1].drop * ROW_H);
    assert.equal(ends.length, 0);
    assert(
      trace(first, first.angle).plan,
      `level ${level} straight-up aim shows a reachable socket`,
    );
    const { ctx, texts } = textRecorder();
    g.draw(ctx);
    const tipLine = texts.find((t) => t.text === LEVELS[level - 1].tip.en);
    assert(tipLine && tipLine.y < 25, 'the tip sits in the header, away from the table');
    assert(candidates(first).length >= 5, `level ${level} guide offers sockets`);
  }
});
const BLIND = {
  random: (rnd) => {
    let held = [];
    return (f, hz) => {
      if (f % Math.round(hz * 0.25)) return { held };
      const k = Math.floor(rnd() * 3);
      held = k === 0 ? ['ArrowLeft'] : k === 1 ? ['ArrowRight'] : [];
      return { held, pressed: [rnd() < 0.6 ? 'Space' : rnd() < 0.2 ? 'KeyX' : 'Enter'] };
    };
  },
  mash: (rnd) => () => ({
    held: [rnd() < 0.5 ? 'ArrowLeft' : rnd() < 0.5 ? 'ArrowRight' : 'KeyA'],
    pressed: [...(rnd() < 0.4 ? ['Space'] : []), ...(rnd() < 0.2 ? ['KeyX'] : [])],
  }),
  fixedStraight: () => (f, hz) => ({ pressed: f % Math.round(hz * 0.4) ? [] : ['Space'] }),
  fixedAngled: () => (f, hz) => ({
    held: f / hz < 1.4 ? ['ArrowLeft'] : [],
    pressed: f % Math.round(hz * 0.4) ? [] : ['Space'],
  }),
  timedFast: () => (f, hz) => ({
    held: Math.floor(f / hz / 0.8) % 2 ? ['ArrowRight'] : ['ArrowLeft'],
    pressed: f % Math.round(hz * 0.5) ? [] : ['Space'],
  }),
  timedSlow: () => (f, hz) => ({
    held: Math.floor(f / hz / 3) % 2 ? ['ArrowRight'] : ['ArrowLeft'],
    pressed: f % Math.round(hz * 0.5) ? [] : ['Space'],
  }),
};
function blindWins(level, make, seed, hz = 30, seconds = 45) {
  const { g } = openLevel(level, { seed });
  const rnd = harness({ seed: seed * 7 + 3 }).env.random;
  const policy = make(rnd);
  for (let f = 0; f < seconds * hz; f++) {
    const s = g.getState();
    if (s.phase !== 'playing' || s.level !== level) return s.phase === 'won' || s.level > level;
    const k = policy(f, hz);
    g.update(1 / hz, input(k.held ?? [], k.pressed ?? []));
  }
  return false;
}
test('random aiming, fixed angles, timed sweeps and mashing win at most 25% of any level from level 3', () => {
  const SEEDS = 4;
  let total = 0,
    wins = 0;
  for (let level = 3; level <= COUNT; level++) {
    let levelWins = 0;
    for (const [name, make] of Object.entries(BLIND)) {
      let policyWins = 0;
      for (let seed = 1; seed <= SEEDS; seed++) policyWins += blindWins(level, make, seed) ? 1 : 0;
      assert(policyWins / SEEDS <= 0.25, `level ${level} ${name} won ${policyWins}/${SEEDS}`);
      levelWins += policyWins;
      total += SEEDS;
    }
    wins += levelWins;
    assert(
      levelWins / (SEEDS * Object.keys(BLIND).length) <= 0.25,
      `level ${level} blind wins ${levelWins}`,
    );
  }
  assert(wins / total <= 0.1, `blind win rate ${wins}/${total}`);
});

// The reaction-limited planner clears every level with margin
const RUNS = [
  { hz: 30, delay: 0.35, seed: 8 },
  { hz: 60, delay: 0.25, seed: 9 },
  { hz: 120, delay: 0.35, seed: 10 },
  { hz: 120, delay: 0.25, seed: 11 },
];
test('a 0.25 s and 0.35 s reaction bot clears every level at 30, 60 and 120 Hz with margin', () => {
  for (let level = 1; level <= COUNT; level++)
    for (const run of RUNS) {
      const result = playLevel(level, run);
      const tag = `level ${level} ${run.hz} Hz ${run.delay}s`;
      assert(result.won, `${tag}: ${result.state.phase} ${result.state.reason ?? ''}`);
      assert(result.margin >= SAFE_MARGIN, `${tag}: pusher came within ${result.margin}`);
      const spec = LEVELS[level - 1];
      if (spec.shots)
        assert(result.state.shots <= spec.shots, `${tag}: ${result.state.shots} shots`);
    }
});
test('the same decisions give the same game at 30, 60 and 120 Hz', () => {
  for (const level of [1, 8, 19]) {
    const [a, b, c] = [30, 60, 120].map((hz) => {
      const r = playLevel(level, { hz, delay: 0.25, seed: 5 });
      return { won: r.won, score: r.state.score, shots: r.state.shots, level: r.state.level };
    });
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  }
});
test('all twenty caverns clear in one continuous run that unlocks each level in turn', () => {
  const { store, progress } = memoryStore(1);
  const h = harness({ seed: 9 });
  h.env.progress = progress;
  const g = h.g ?? createGame(h.env);
  let level = 1;
  for (; level <= COUNT; level++) {
    const result = playLevel(level, { g: { g, ends: h.ends }, hz: 60 });
    assert(result.won, `level ${level}`);
    assert.equal(store.unlocked, Math.min(level + 1, COUNT));
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert(h.ends[0].score > 0);
});

// Bank shots and legal sockets
test('no guided shot can stick in an illegal spot on any level, including bank shots', () => {
  for (let level = 1; level <= COUNT; level++) {
    const s = createBubbleState(harness().env, level);
    let banks = 0;
    for (let a = AIM_MIN; a <= AIM_MAX; a += 0.01) {
      const { plan, segments } = trace(s, a);
      if (!plan) continue;
      if (segments.length > 1) banks++;
      const { row, col, target } = plan;
      assert(!blockedSocket(s, row, col), `level ${level} angle ${a}: occupied socket`);
      assert(target.x >= LEFT - 1e-6 && target.x <= RIGHT + 1e-6, 'socket inside the rails');
      assert(target.y >= bubblePoint(0, 0, s.ceiling).y - 1e-6, 'socket below the roof');
      const touches =
        row === 0 ||
        neighbors(row, col).some(
          ([r, c]) => s.board[r][c] >= 0 || s.obstacles.some((o) => o.row === r && o.col === c),
        );
      assert(touches, `level ${level} angle ${a}: floating socket ${row},${col}`);
      for (let r = 0; r < 12; r++)
        for (let c = 0; c < slots(r); c++) {
          const solid = s.board[r][c] >= 0 || s.obstacles.some((o) => o.row === r && o.col === c);
          if (!solid) continue;
          const p = bubblePoint(r, c, s.ceiling);
          assert(
            Math.hypot(p.x - target.x, p.y - target.y) >= 24 - 1e-6,
            'no overlap with the rack',
          );
        }
    }
    assert(banks > 0, `level ${level} offers bank shots`);
  }
});
test('real shots land exactly where the guide said, and walls really bounce them', () => {
  for (let level = 1; level <= COUNT; level++) {
    const { g } = openLevel(level, { seed: 3 });
    const before = g.getState();
    const cells = (s) => s.board.flat().filter((v) => v >= 0).length;
    for (const wantBank of [false, true]) {
      const pick = candidates(before).find((c) => c.bank === wantBank && !c.swap);
      if (!pick) continue;
      const { g: game } = openLevel(level, { seed: 3 });
      const start = game.getState();
      const vx = [];
      game.update(1 / 60, input([], [], pointerAt(pick.a)));
      for (let f = 0; f < 60 * 20; f++) {
        const s = game.getState();
        if (s.shot) vx.push(Math.sign(s.shot.vx));
        if (f > 5 && !busy(s) && !s.queuedFire) break;
        game.update(1 / 60, input());
      }
      const after = game.getState();
      assert.equal(after.shots, 1, `level ${level} fired`);
      const plan = trace(start, after.lastShotAngle).plan;
      const landed = after.board[plan.row][plan.col] === start.current;
      assert(
        landed || cells(after) < cells(start) + 1,
        `level ${level} bank ${wantBank} landed at the guide`,
      );
      assert.equal(new Set(vx).size > 1, wantBank, `level ${level} wall bounce is ${wantBank}`);
    }
  }
});
test('the tipped bank shaft levels have popping shots that only a bank can reach', () => {
  for (const level of [3, 11, 18]) {
    const s = openLevel(level).g.getState();
    const direct = new Set(),
      banked = new Map();
    for (let a = AIM_MIN; a <= AIM_MAX; a += 0.004) {
      const { plan, segments } = trace(s, a);
      if (!plan) continue;
      const key = `${plan.row},${plan.col}`;
      if (segments.length === 1) direct.add(key);
      else banked.set(key, plan);
    }
    const only = [...banked.entries()].filter(([k]) => !direct.has(k));
    assert(only.length >= 3, `level ${level} bank-only sockets`);
    const pops = only.some(([, plan]) =>
      [...new Set(s.board.flat().filter((v) => v >= 0 && v < CREATURE))].some((color) => {
        const copy = { ...s, board: s.board.map((r) => r.slice()), popped: [] };
        return resolveBubble(copy, plan.row, plan.col, color, SILENT) > 0;
      }),
    );
    assert(pops, `level ${level} bank shot pops`);
  }
});

// Controls, progress, hostile input
test('every action has a keyboard, touch or pointer route', () => {
  const codes = meta.touchControls.map((b) => b.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX']) assert(codes.includes(code));
  const { g } = openLevel(4);
  const start = g.getState();
  g.update(1 / 60, input([], [], { x: 435, y: 256, clicked: true, down: true }));
  const swapped = g.getState();
  assert.equal(swapped.current, start.next);
  assert.equal(swapped.next, start.current);
  assert.equal(swapped.shots, 0);
  // Holding the finger on NEXT must not aim or fire; a new press on the field still does.
  for (let f = 0; f < 6; f++) g.update(1 / 60, input([], [], { x: 435, y: 256, down: true }));
  const held = g.getState();
  assert.equal(held.angle, start.angle);
  assert.equal(held.aimTarget, null);
  assert.equal(held.shots, 0);
  g.update(1 / 60, input());
  g.update(1 / 60, input([], [], pointerAt(-2)));
  assert.equal(g.getState().aimTarget, -2);
  const angle = swapped.angle;
  for (let i = 0; i < 20; i++) g.update(1 / 60, input(['ArrowRight']));
  assert(g.getState().angle > angle);
  for (let i = 0; i < 40; i++) g.update(1 / 60, input(['ArrowLeft']));
  assert(g.getState().angle < angle);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().shots, 1);
  const tap = openLevel(1).g;
  tap.update(1 / 60, input([], [], pointerAt(-1.9)));
  for (let i = 0; i < 120; i++) tap.update(1 / 60, input());
  assert.equal(tap.getState().shots, 1);
});
test('the level select works by keyboard and touch, locks unreached caverns and continues', () => {
  const { store, progress } = memoryStore(6);
  const h = harness();
  h.env.progress = progress;
  const g = createGame(h.env);
  const menu = () => g.getState().menu;
  assert.deepEqual(
    [menu().cursor, menu().unlocked, menu().total, menu().columns],
    [6, 6, COUNT, MENU_COLUMNS],
  );
  assert(g.getState().status.en.includes('Choose a cavern') && CJK.test(g.getState().status.zh));
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(menu().cursor, 5);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(menu().cursor, 6, 'the cursor cannot pass the unlocked level');
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(menu().cursor, 1);
  const lock = menuCell(9);
  g.update(1 / 60, input([], [], { x: lock.x + 5, y: lock.y + 5, clicked: true }));
  assert.equal(menu().cursor, 1, 'tapping a locked cavern does nothing');
  assert(h.sounds.includes('hit'));
  const open = menuCell(3);
  g.update(1 / 60, input([], [], { x: open.x + 5, y: open.y + 5, clicked: true }));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 3);
  const { ctx, texts } = textRecorder();
  for (const lang of ['en', 'zh']) {
    const m = harness({ lang });
    m.env.progress = memoryStore(COUNT).progress;
    createGame(m.env).draw(ctx);
  }
  for (const t of texts) {
    const [l, r] = extents(t);
    assert(l >= 0 && r <= 480, `menu text "${t.text}" ${l}..${r}`);
  }
  assert.equal(store.unlocked, 6);
  const fresh = memoryStore(1);
  assert(playLevel(1, { g: openLevel(1, { progress: fresh.progress }) }).won);
  assert.equal(fresh.store.unlocked, 2);
  const again = harness();
  again.env.progress = fresh.progress;
  assert.equal(createGame(again.env).getState().menu.cursor, 2);
});
test('broken, throwing and junk progress stores never stop the game and are clamped', () => {
  const stores = [
    undefined,
    {},
    { unlocked: boom, unlock: boom },
    { unlocked: () => 'abc', unlock: () => {} },
    { unlocked: () => NaN, unlock: () => {} },
    { unlocked: () => -7, unlock: () => {} },
    { unlocked: () => null, unlock: () => {} },
  ];
  for (const progress of stores) {
    const h = harness();
    h.env.progress = progress;
    const g = createGame(h.env);
    assert.equal(g.getState().menu, null, 'junk starts at cavern 1');
    assert.equal(g.getState().level, 1);
  }
  for (const [raw, expected] of [
    [999, COUNT],
    [Infinity, 1],
    [7.9, 7],
    [0, 1],
  ]) {
    const h = harness();
    h.env.progress = { unlocked: () => raw, unlock() {} };
    const g = createGame(h.env);
    assert.equal(g.getState().unlocked, expected);
    assert.equal(g.getState().menu?.cursor ?? 1, expected);
  }
  // A store that throws while saving does not stop a cavern from being cleared.
  const h = harness({ seed: 2 });
  h.env.progress = { unlocked: () => 1, unlock: boom };
  const g = createGame(h.env);
  assert(playLevel(1, { g: { g, ends: h.ends } }).won);
  assert.equal(h.ends.length, 0);
});
test('hostile dt and pointer values never corrupt the state', () => {
  const dts = [NaN, Infinity, -Infinity, -1, 0, 1e9, '0.5', null, undefined, {}, 1 / 30, 5];
  const pointers = [
    { x: NaN, y: NaN, down: true, clicked: true },
    { x: Infinity, y: -Infinity, down: true, clicked: true },
    { x: '12', y: 'a', down: 1, clicked: 1 },
    { x: 1e9, y: 1e9, down: true, clicked: true },
    { x: -5, y: 290, down: true, clicked: true },
    null,
    undefined,
  ];
  for (const level of [1, 12]) {
    const { g, ends } = openLevel(level);
    for (const dt of dts)
      for (const pointer of pointers) {
        g.update(dt, { held: () => false, pressed: (...c) => c.includes('Space'), pointer });
        const s = g.getState();
        for (const v of [s.angle, s.angularVelocity, s.ceiling, s.score])
          assert(Number.isFinite(v), `non-finite value after dt=${String(dt)}`);
        assert(!JSON.stringify(s).includes('null,null'));
      }
    assert(ends.length <= 1);
  }
  const m = harness();
  m.env.progress = memoryStore(5).progress;
  const g = createGame(m.env);
  g.update(NaN, input());
  g.update(-1, input([], ['Space']));
  g.update(1 / 60, {
    held: () => false,
    pressed: () => false,
    pointer: { x: NaN, y: NaN, clicked: true },
  });
  assert.equal(g.getState().menu.cursor, 5);
  g.update(1 / 60, { held: () => false, pressed: () => false });
  assert.equal(g.getState().menu.cursor, 5);
});

// Terminal states and end messages
function terminal(level, lang, score) {
  const h = harness({ seed: 4, lang });
  h.env.progress = memoryStore(level).progress;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  const result = playLevel(level, { g: { g, ends: h.ends }, score, hz: 60 });
  return { g, h, result };
}
function assertFrozen(g, h, phase) {
  assert.equal(h.ends.length, 1);
  const snapshot = JSON.stringify(g.getState());
  for (const keys of [['Space'], ['KeyX'], ['ArrowLeft']])
    g.update(1 / 30, input(keys, keys, pointerAt(-1.2)));
  g.update(5, input());
  assert.equal(JSON.stringify(g.getState()), snapshot);
  assert.equal(g.getState().phase, phase);
  assert.equal(h.ends.length, 1);
}
test('winning the last cavern ends exactly once with EN and ZH messages and a frozen state', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h, result } = terminal(COUNT, lang, good);
    assert(result.won);
    assertFrozen(g, h, 'won');
    const end = h.ends[0];
    assert.equal(end.won, true);
    assert(end.score > 0);
    assert.equal(CJK.test(end.message), lang === 'zh');
    assert(end.message.includes(String(COUNT)));
  }
});
test('losing to the pusher or to an empty capsule budget ends exactly once with clear EN and ZH reasons', () => {
  for (const [level, reason, policy, en, zh] of [
    [1, 'line', worst, /pusher/i, /推板/],
    [6, 'budget', shallow, /Out of capsules/i, /泡泡用完/],
  ])
    for (const lang of ['en', 'zh']) {
      const { g, h, result } = terminal(level, lang, policy);
      assert(!result.won, `level ${level} should be lost by bad play`);
      assert.equal(result.state.reason, reason);
      assertFrozen(g, h, 'lost');
      assert.equal(h.ends[0].won, false);
      assert((lang === 'en' ? en : zh).test(h.ends[0].message));
      assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
    }
});
test('a capsule that finds no legal socket loses with a clear message instead of sticking', () => {
  for (const lang of ['en', 'zh']) {
    const { env, ends } = harness({ lang });
    const s = createBubbleState(env, 1);
    // A full rack lifted above the table leaves no free socket under the lowest row.
    s.board.forEach((row, r) => row.forEach((_, c) => c < slots(r) && (row[c] = 0)));
    s.ceiling = -80;
    // With no reachable socket the guide shows a cross and the launcher refuses to fire.
    const marks = [];
    const ctx = mockContext();
    ctx.lineTo = (x, y) => marks.push([x, y]);
    drawBubble(ctx, s, env);
    assert(marks.length >= 2, 'a cross marks the blocked contact');
    stepBubble(s, 1 / 60, input([], ['Space']), env);
    assert.equal(s.shots, 0);
    assert(s.messageTime > 0);
    s.shot = { x: 240, y: 297, vx: 0, vy: -350, color: 1 };
    for (let i = 0; i < 480 && s.phase === 'playing'; i++) stepBubble(s, 1 / 240, input(), env);
    assert.equal(s.phase, 'lost');
    assert.equal(s.reason, 'socket');
    assert.equal(ends.length, 1);
    assert.equal(CJK.test(ends[0].message), lang === 'zh');
  }
});

// Drawing: every state fits the canvas in both languages and shows the aim guide
test('every level draws in EN and ZH inside the canvas through a whole game', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 3, 8, 14, 16, 19, 20]) {
      const run = openLevel(level, { lang, seed: 6 });
      const { g } = run;
      let idle = 0;
      for (let f = 0; f < 60 * 40; f++) {
        const s = g.getState();
        if (s.phase !== 'playing') break;
        if (f % 7 === 0) {
          const { ctx, texts } = textRecorder();
          g.draw(ctx);
          for (const t of texts) {
            const [l, r] = extents(t);
            assert(l >= -0.5 && r <= 480.5, `${lang} level ${level}: "${t.text}" ${l}..${r}`);
            assert(t.y >= 0 && t.y <= 312);
          }
        }
        if (busy(s) || s.queuedFire) {
          idle = 0;
          g.update(1 / 60, input());
          continue;
        }
        idle += 1 / 60;
        if (idle < 0.25) {
          g.update(1 / 60, input());
          continue;
        }
        const options = candidates(s);
        // Bad play too, so the pusher warning and motion are drawn.
        const pick = options.reduce(
          (a, c) => (!a || (level % 2 ? good(c) > good(a) : worst(c) > worst(a)) ? c : a),
          null,
        );
        fire(g, pick, 60);
        idle = 0;
      }
    }
});
test('the aim guide is drawn only while the launcher is ready and ends in a socket marker', () => {
  const { g } = openLevel(3);
  const dots = (state) => {
    const rects = [];
    const ctx = mockContext();
    ctx.fillRect = (x, y, w, h) => rects.push([ctx.fillStyle, x, y, w, h]);
    state.draw(ctx);
    return rects.filter((r) => r[0] === '#8eb8aa' || r[0] === '#ba8c80').length;
  };
  assert(dots(g) > 10, 'guide dots while ready');
  g.update(1 / 60, input([], ['Space']));
  assert.equal(dots(g), 0, 'no guide during flight');
});
