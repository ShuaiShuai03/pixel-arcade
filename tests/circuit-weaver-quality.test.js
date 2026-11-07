import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  BOARDS,
  BOARD_COUNT,
  TILE_TYPES,
  RULES,
  analyze,
  solve,
  layoutOf,
} from '../src/games/circuit-weaver.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const SCRAMBLES = 10;
const ARROW_KEY = { '↑': 'ArrowUp', '→': 'ArrowRight', '↓': 'ArrowDown', '←': 'ArrowLeft' };
const DELTA = { '↑': [0, -1], '→': [1, 0], '↓': [0, 1], '←': [-1, 0] };
const KIND = {
  straight: ['straight', '直线块'],
  corner: ['corner', '转角块'],
  tee: ['tee', '三通块'],
};

function begin(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = { unlocked: () => level, unlock() {} };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// What a person does with the prompt they read: one literal key, or nothing.
function keyFor(line, lang) {
  if (lang === 'zh') {
    const move = /向([←→↑↓])移到/.exec(line);
    if (move) return ARROW_KEY[move[1]];
    if (/^按空格/.test(line)) return 'Space';
    if (/^按 Z/.test(line)) return 'KeyZ';
    return null;
  }
  const move = /^Move the cursor ([←→↑↓])/.exec(line);
  if (move) return ARROW_KEY[move[1]];
  if (/^Press Space/.test(line)) return 'Space';
  if (/^Press Z/.test(line)) return 'KeyZ';
  return null;
}

// Deliberate mistakes made with real inputs: random cursor moves, turns and the odd undo. Stops
// short of a blown fuse or an accidental win so the follower starts from a live, wrong board.
function scramble(g, level, rnd, mistakes) {
  const b = BOARDS[level - 1];
  const limit = Math.min(mistakes, b.budget === null ? mistakes : b.budget - 1);
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  let turns = 0;
  for (let guard = 0; turns < limit && guard < 400; guard++) {
    const st = g.getState();
    if (st.stage !== 'play') break;
    const roll = rnd();
    if (roll < 0.55) g.update(1 / 60, input([], [keys[Math.floor(rnd() * 4)]]));
    else if (roll < 0.9) {
      g.update(1 / 60, input([], ['Space']));
      if (g.getState().moves > st.moves) turns++;
    } else g.update(1 / 60, input([], ['KeyZ']));
    if (g.getState().stage !== 'play') return false;
  }
  return g.getState().stage === 'play';
}

// Checks that the text, the arrow and the highlight describe the same thing.
function checkAgreement(st, level) {
  const b = BOARDS[level - 1];
  const hint = st.hint;
  assert.ok(hint, 'a playing board always has a hint');
  const en = st.line.en;
  const zh = st.line.zh;
  if (hint.press === 'KeyZ') {
    assert.ok(/^Press Z/.test(en) && /^按 Z/.test(zh), en);
    return;
  }
  const idx = hint.r * st.cols + hint.c;
  const tile = st.tiles[idx];
  assert.ok(KIND[tile.type], `hint points at a ${tile.type}`);
  assert.ok(en.includes(KIND[tile.type][0]) && zh.includes(KIND[tile.type][1]), `${en} / ${zh}`);
  const plan = solve(
    b,
    st.tiles.map((t) => t.rot),
  );
  assert.notEqual(plan.target[idx], tile.rot, 'the highlighted tile really needs a turn');
  if (hint.press === 'Space') {
    assert.deepEqual(st.cursor, { c: hint.c, r: hint.r });
    assert.ok(/^Press Space/.test(en) && /^按空格/.test(zh));
    if (hint.count > 1)
      assert.ok(en.includes(`(${hint.count}x)`) && zh.includes(`（${hint.count}次）`));
    return;
  }
  const arrow = Object.keys(ARROW_KEY).find((a) => ARROW_KEY[a] === hint.press);
  assert.ok(en.includes(`cursor ${arrow} `) && zh.includes(`向${arrow}移到`), `${en} / ${zh}`);
  const [dx, dy] = DELTA[arrow];
  const before = Math.abs(hint.c - st.cursor.c) + Math.abs(hint.r - st.cursor.r);
  const after = Math.abs(hint.c - (st.cursor.c + dx)) + Math.abs(hint.r - (st.cursor.r + dy));
  assert.equal(after, before - 1, 'the arrow moves toward the highlighted tile');
}

// A literal prompt follower. It looks at the prompt `lag` seconds after the board last changed
// and presses exactly what the line says. `touch` taps tiles instead of using the keyboard.
function follow(level, hz, opts = {}) {
  const {
    lag = 0.25,
    seed = 1,
    mistakes = 0,
    lang = 'en',
    touch = false,
    seconds = 400,
    check,
  } = opts;
  const { g, h } = begin(level, { seed, lang });
  const rnd = seeded(seed * 7919 + level);
  if (mistakes) scramble(g, level, rnd, mistakes);
  const lay = layoutOf(BOARDS[level - 1]);
  let sig = '';
  let changed = 0;
  let actions = 0;
  let blownFuses = 0;
  const holds = [];
  let lastLine = null;
  let lineSince = 0;
  let t = 0;
  for (; t < seconds; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    blownFuses = Math.max(blownFuses, 3 - st.fuses);
    if (st.stage !== 'play') {
      g.update(1 / hz, input());
      continue;
    }
    const now = `${st.tiles.map((x) => x.rot).join('')}|${st.cursor.c},${st.cursor.r}|${st.moves}`;
    if (now !== sig) {
      sig = now;
      changed = t;
      if (check) check(st);
    }
    if (st.line.en !== lastLine) {
      if (lastLine !== null) holds.push(t - lineSince);
      lastLine = st.line.en;
      lineSince = t;
    }
    if (t - changed >= lag - 1e-9) {
      const key = keyFor(st.line[lang], lang);
      if (key) {
        actions++;
        if (touch && key !== 'KeyZ') {
          const target = st.hint;
          const at = {
            x: lay.x + target.c * lay.tile + lay.tile / 2,
            y: lay.y + target.r * lay.tile + lay.tile / 2,
            clicked: true,
          };
          g.update(1 / hz, input([], [], at));
        } else g.update(1 / hz, input([], [key]));
        changed = t + 1 / hz;
        continue;
      }
    }
    g.update(1 / hz, input());
  }
  const st = g.getState();
  return {
    cleared: st.level > level || st.phase === 'won',
    fuses: st.fuses,
    blown: blownFuses,
    actions,
    t,
    holds,
    h,
    st,
  };
}

const maxActions = (level) => 8 * (solve(BOARDS[level - 1], BOARDS[level - 1].start).cost + 8) + 60;

// ---------------------------------------------------------------------------------------------
// Prompt follower
// ---------------------------------------------------------------------------------------------
test('quality: a literal prompt follower clears every board from the start at 30, 60 and 120 Hz without a blown fuse', () => {
  const rows = [];
  for (let level = 1; level <= BOARD_COUNT; level++)
    for (const hz of HZS) {
      const r = follow(level, hz, { check: (st) => checkAgreement(st, level) });
      assert.ok(r.cleared, `board ${level} @${hz} Hz: ${r.st.phase} ${r.st.stage} t=${r.t}`);
      assert.equal(r.blown, 0, `board ${level} @${hz} Hz blew a fuse`);
      assert.ok(r.actions <= maxActions(level), `board ${level}: ${r.actions} actions`);
      if (hz === 60) rows.push(`${level}:${r.actions}`);
    }
  console.log(`follower actions per board (60 Hz): ${rows.join(' ')}`);
});

test('quality: the follower recovers from at least 10 random mistaken states per board and never loses a fuse', () => {
  let runs = 0;
  let undos = 0;
  for (let level = 1; level <= BOARD_COUNT; level++)
    for (let seed = 1; seed <= SCRAMBLES; seed++) {
      const hz = HZS[seed % HZS.length];
      const r = follow(level, hz, {
        seed: seed + level * 100,
        mistakes: 2 + (seed % 8),
        lag: seed % 2 ? 0.2 : 0.5,
        check: (st) => checkAgreement(st, level),
      });
      runs++;
      undos += r.st.stats.undos;
      assert.ok(r.cleared, `board ${level} seed ${seed}: ${r.st.phase}/${r.st.stage} t=${r.t}`);
      assert.equal(r.blown, 0, `board ${level} seed ${seed} blew a fuse`);
      assert.equal(r.fuses, 3);
    }
  assert.equal(runs, BOARD_COUNT * SCRAMBLES);
  assert.ok(undos > 0, 'some recoveries used the undo prompt');
  console.log(`scrambled runs: ${runs}, undo presses followed: ${undos}`);
});

test('quality: a follower reading the Chinese prompt clears every board too', () => {
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const r = follow(level, 60, { lang: 'zh', seed: level, mistakes: level % 5 });
    assert.ok(r.cleared, `board ${level} (zh)`);
    assert.equal(r.blown, 0);
  }
});

test('quality: a touch-only player (tap to select, tap to turn) clears every board following the highlight', () => {
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const r = follow(level, 60, { touch: true, seed: level, mistakes: level % 4 });
    assert.ok(r.cleared, `board ${level} by touch`);
    assert.equal(r.blown, 0);
  }
});

test('quality: tight budgets never trap the follower: even with the maximum mistakes it is led to undo', () => {
  const budgeted = BOARDS.map((b, i) => [b, i + 1]).filter(([b]) => b.budget !== null);
  assert.ok(budgeted.length >= 5);
  for (const [b, level] of budgeted)
    for (let seed = 1; seed <= 6; seed++) {
      const r = follow(level, 60, { seed: seed + 900, mistakes: b.budget - 1, lag: 0.2 });
      assert.ok(r.cleared, `board ${level} seed ${seed} with ${b.budget - 1} mistakes`);
      assert.equal(r.fuses, 3, `board ${level} seed ${seed} lost a fuse`);
    }
});

test('quality: prompts only change after the player acts and are held at least half a second', () => {
  let changes = 0;
  let minHold = Infinity;
  for (const level of [1, 3, 6, 10, 14, 20, 24]) {
    const r = follow(level, 60, { lag: 0.55, seed: level, mistakes: 3 });
    assert.ok(r.cleared);
    for (const held of r.holds) {
      minHold = Math.min(minHold, held);
      changes++;
    }
    // Idle boards never flicker, whatever the frame rate.
    for (const hz of HZS) {
      const { g } = begin(level);
      const rnd = seeded(level);
      if (!scramble(g, level, rnd, 3)) continue;
      const first = JSON.stringify([g.getState().line, g.getState().hint, g.getState().prompt]);
      for (let f = 0; f < hz * 2; f++) {
        g.update(1 / hz, input());
        assert.equal(
          JSON.stringify([g.getState().line, g.getState().hint, g.getState().prompt]),
          first,
        );
      }
    }
  }
  assert.ok(changes > 40, `only ${changes} prompt changes observed`);
  assert.ok(minHold >= 0.5 - 1e-6, `shortest hold ${minHold}s`);
});

// ---------------------------------------------------------------------------------------------
// Depth: blind and clever-but-promptless play
// ---------------------------------------------------------------------------------------------
const ACTION_CAP = 900;

function blind(level, seed, policy) {
  const { g } = begin(level, { seed });
  const rnd = seeded(seed * 104729 + level);
  const b = BOARDS[level - 1];
  let sweep = 0;
  for (let n = 0; n < ACTION_CAP; n++) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    if (st.stage !== 'play') {
      for (let f = 0; f < 140; f++) g.update(1 / 60, input());
      continue;
    }
    let key;
    if (policy === 'mash') key = 'Space';
    else if (policy === 'random')
      key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Space'][
        Math.floor(rnd() * 6)
      ];
    else {
      // Rotate everything: walk the board in a snake and turn each tile once per sweep.
      const row = Math.floor(sweep / b.cols) % b.rows;
      const col = sweep % b.cols;
      const c = row % 2 ? b.cols - 1 - col : col;
      if (st.cursor.r !== row) key = st.cursor.r < row ? 'ArrowDown' : 'ArrowUp';
      else if (st.cursor.c !== c) key = st.cursor.c < c ? 'ArrowRight' : 'ArrowLeft';
      else {
        key = 'Space';
        sweep++;
      }
    }
    g.update(1 / 60, input([], [key]));
  }
  const st = g.getState();
  return st.level > level || st.phase === 'won';
}

test('quality: random, mash-Space and rotate-everything play solve at most 25% of boards 3 to 24', () => {
  const report = [];
  for (const policy of ['random', 'mash', 'sweep']) {
    let wins = 0;
    let runs = 0;
    for (let level = 3; level <= BOARD_COUNT; level++)
      for (let seed = 1; seed <= 3; seed++) {
        runs++;
        if (blind(level, seed, policy)) wins++;
      }
    report.push(`${policy} ${wins}/${runs}`);
    assert.ok(runs >= 40);
    assert.ok(wins / runs <= 0.25, `${policy} won ${wins}/${runs}`);
  }
  console.log(`blind policies: ${report.join(', ')}`);
});

// A smart player without the prompt: greedy hill climbing on lit lamps, shorts and open ends,
// with a random turn when nothing helps. It reads the board but never looks ahead.
function greedy(level, seed) {
  const { g } = begin(level, { seed });
  const b = BOARDS[level - 1];
  const rnd = seeded(seed * 15485863 + level);
  const turnable = b.cells
    .map((c, i) => (!c.locked && TILE_TYPES[c.type].period > 1 ? i : -1))
    .filter((i) => i >= 0);
  const score = (an) =>
    an.sinksOk * 1000 -
    an.shorts.length * 600 -
    an.sinks.filter((s) => s.status === 'wrong').length * 100 -
    (b.sealed ? an.leaks.length * 10 : 0);
  let presses = 0;
  while (presses < 260) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    if (st.stage !== 'play') {
      for (let f = 0; f < 140; f++) g.update(1 / 60, input());
      continue;
    }
    const rots = st.tiles.map((t) => t.rot);
    const base = score(analyze(b, rots));
    let best = base;
    let picks = [];
    for (const i of turnable) {
      const keep = rots[i];
      rots[i] = (keep + 1) % TILE_TYPES[b.cells[i].type].period;
      const s = score(analyze(b, rots));
      rots[i] = keep;
      if (s > best) {
        best = s;
        picks = [i];
      } else if (s === best && picks.length) picks.push(i);
    }
    const pool = picks.length ? picks : turnable;
    const i = pool[Math.floor(rnd() * pool.length)];
    const c = i % b.cols;
    const r = Math.floor(i / b.cols);
    for (
      let guard = 0;
      guard < 30 && (g.getState().cursor.c !== c || g.getState().cursor.r !== r);
      guard++
    ) {
      const cur = g.getState().cursor;
      const key =
        cur.c < c ? 'ArrowRight' : cur.c > c ? 'ArrowLeft' : cur.r < r ? 'ArrowDown' : 'ArrowUp';
      g.update(1 / 60, input([], [key]));
    }
    g.update(1 / 60, input([], ['Space']));
    presses++;
  }
  const st = g.getState();
  return st.level > level || st.phase === 'won';
}

test('quality: a greedy no-prompt player wins at most half the boards and none of the last third', () => {
  const SEEDS = 5;
  const per = [];
  let boardsWon = 0;
  let lastThird = 0;
  const firstOfLast = Math.floor((BOARD_COUNT * 2) / 3) + 1;
  for (let level = 1; level <= BOARD_COUNT; level++) {
    let wins = 0;
    for (let seed = 1; seed <= SEEDS; seed++) if (greedy(level, seed)) wins++;
    per.push(`${level}:${wins}`);
    if (wins >= 1) boardsWon++;
    if (level >= firstOfLast) lastThird += wins;
  }
  console.log(`greedy wins out of ${SEEDS} per board: ${per.join(' ')}`);
  assert.ok(boardsWon <= BOARD_COUNT / 2, `greedy cleared ${boardsWon} of ${BOARD_COUNT} boards`);
  assert.equal(
    lastThird,
    0,
    `greedy cleared a board among the last ${BOARD_COUNT - firstOfLast + 1}`,
  );
});

test('quality: the difficulty curve rises across the boards and every feature appears', () => {
  const opt = BOARDS.map((b) => solve(b, b.start).cost);
  console.log(`optimal rotations per board: ${opt.map((n, i) => `${i + 1}:${n}`).join(' ')}`);
  const thirds = [0, 1, 2].map((k) => {
    const part = opt.slice(
      Math.floor((k * BOARD_COUNT) / 3),
      Math.floor(((k + 1) * BOARD_COUNT) / 3),
    );
    return part.reduce((a, n) => a + n, 0) / part.length;
  });
  assert.ok(thirds[0] < thirds[1] && thirds[1] < thirds[2], thirds.join(' < '));
  assert.ok(opt[0] <= 2 && opt[BOARD_COUNT - 1] >= 20);
  const has = (test) => BOARDS.filter(test).length;
  assert.ok(has((b) => b.cells.some((c) => c.type === 'bridge')) >= 6, 'bridges');
  assert.ok(has((b) => b.cells.some((c) => c.locked)) >= 4, 'locked tiles');
  assert.ok(has((b) => b.budget !== null) >= 6, 'turn budgets');
  assert.ok(has((b) => b.volts.length >= 3) >= 3, 'three or more voltages');
  assert.ok(has((b) => b.volts.length === 2) >= 6, 'two separate voltages');
  assert.ok(has((b) => b.sinks.length >= 3) >= 4, 'many lamps');
  assert.ok(has((b) => b.cols * b.rows >= 50) >= 5, 'large boards');
  assert.ok(has((b) => !b.sealed) >= 2 && has((b) => b.sealed) >= 15, 'open ends allowed on some');
  assert.ok(RULES.fuses === 3);
});

// ---------------------------------------------------------------------------------------------
// Round 2 depth: informed random play, 50/50 mashing and port-pair hill climbing, on a virtual
// clock (a key press costs 0.1 s, looking at the board 1 s, 120 s per board)
// ---------------------------------------------------------------------------------------------
const KEY_GAP = 0.1;
const LOOK = 1;
const LIMIT = 120;
const SAMPLE = 40;
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function clocked(level, seed) {
  const { g } = begin(level, { seed });
  const b = BOARDS[level - 1];
  const rnd = seeded(seed * 2654435761 + level * 97);
  let t = 0;
  const over = () => {
    const st = g.getState();
    return st.phase !== 'playing' || st.level !== level || st.stage === 'powered';
  };
  const key = (k) => {
    g.update(KEY_GAP, input([], [k]));
    t += KEY_GAP;
  };
  const idle = (secs) => {
    for (let n = 0; n < Math.round(secs / KEY_GAP) && !over(); n++) {
      g.update(KEY_GAP, input());
      t += KEY_GAP;
    }
  };
  const goto = (i) => {
    const c = i % b.cols;
    const r = Math.floor(i / b.cols);
    while (t < LIMIT && !over()) {
      const st = g.getState();
      if (st.stage !== 'play') return idle(KEY_GAP);
      if (st.cursor.r !== r) key(st.cursor.r < r ? 'ArrowDown' : 'ArrowUp');
      else if (st.cursor.c !== c) key(st.cursor.c < c ? 'ArrowRight' : 'ArrowLeft');
      else return;
    }
  };
  const cleared = () => {
    const st = g.getState();
    return st.stage === 'powered' || st.phase === 'won' || st.level > level;
  };
  return {
    g,
    b,
    rnd,
    key,
    idle,
    goto,
    cleared,
    over,
    time: () => t,
    playing: () => g.getState().stage === 'play',
  };
}

const turnableOf = (b) =>
  b.cells
    .map((c, i) => (!c.locked && TILE_TYPES[c.type].period > 1 ? i : -1))
    .filter((i) => i >= 0);

function liveTurnable(b) {
  const an = analyze(b, solve(b, b.start).target);
  const live = (k) => [0, 1].some((d) => an.mask[k] && an.net.volts[an.net.find(2 * k + d)]);
  return turnableOf(b).filter(live);
}

function mashRun(level, seed) {
  const p = clocked(level, seed);
  while (p.time() < LIMIT && !p.over()) {
    if (!p.playing()) p.idle(KEY_GAP);
    else p.key(p.rnd() < 0.5 ? 'Space' : ARROWS[Math.floor(p.rnd() * 4)]);
  }
  return p.cleared();
}

function informedRun(level, seed, look) {
  const p = clocked(level, seed);
  const pool = liveTurnable(p.b);
  while (p.time() < LIMIT && !p.over()) {
    if (!p.playing()) {
      p.idle(KEY_GAP);
      continue;
    }
    p.goto(pool[Math.floor(p.rnd() * pool.length)]);
    if (p.time() < LIMIT && !p.over() && p.playing()) {
      p.key('Space');
      p.idle(look);
    }
  }
  return p.cleared();
}

const WEIGHTS = {
  plain: { lit: 1000, sh: 600, wrong: 100, leak: 10, pair: 0 },
  pairs: { lit: 3, sh: 3, wrong: 0, leak: 1, pair: 0.5 },
  pairs2: { lit: 5, sh: 5, wrong: 0, leak: 1, pair: 1 },
};

// Hill climbing on lit lamps, shorts, open ends and matched port pairs, with a random turn when
// nothing improves. It reads the whole board but never looks ahead.
function climbRun(level, seed, w, undoKicks = false) {
  const p = clocked(level, seed);
  const b = p.b;
  const turn = turnableOf(b);
  const value = (rots) => {
    const an = analyze(b, rots);
    let pairs = 0;
    an.mask.forEach((m, i) => {
      if ((i % b.cols) + 1 < b.cols && m & 2 && an.mask[i + 1] & 8) pairs++;
      if (i + b.cols < an.mask.length && m & 4 && an.mask[i + b.cols] & 1) pairs++;
    });
    return (
      w.lit * an.sinksOk -
      w.sh * an.shorts.length -
      w.wrong * an.sinks.filter((s) => s.status === 'wrong').length -
      (b.sealed ? w.leak * an.leaks.length : 0) +
      w.pair * pairs
    );
  };
  while (p.time() < LIMIT && !p.over()) {
    if (!p.playing()) {
      p.idle(KEY_GAP);
      continue;
    }
    const rots = p.g.getState().tiles.map((t) => t.rot);
    let best = value(rots);
    let picks = [];
    for (const i of turn) {
      const period = TILE_TYPES[b.cells[i].type].period;
      for (let k = 1; k < period; k++) {
        const next = rots.slice();
        next[i] = (next[i] + k) % period;
        const v = value(next);
        if (v > best + 1e-9) {
          best = v;
          picks = [{ i, k }];
        } else if (Math.abs(v - best) < 1e-9 && picks.length) picks.push({ i, k });
      }
    }
    const move = picks.length
      ? picks[Math.floor(p.rnd() * picks.length)]
      : { i: turn[Math.floor(p.rnd() * turn.length)], k: 1 };
    p.goto(move.i);
    for (let k = 0; k < move.k && p.time() < LIMIT && !p.over() && p.playing(); k++) p.key('Space');
    // Try-and-undo: a plateau kick that lowered the score is taken back (undo refunds the turn).
    if (undoKicks && !picks.length && p.playing()) {
      const after = p.g.getState().tiles.map((t) => t.rot);
      if (value(after) < value(rots) - 1e-9) p.key('KeyZ');
    }
  }
  return p.cleared();
}

test('quality: informed random play (live tiles only, 1 s or 0.25 s look) and 50/50 mashing solve at most 25% of any board from board 3', () => {
  const rows = { informed: [], fast: [], mash: [] };
  for (let level = 3; level <= BOARD_COUNT; level++) {
    let informed = 0;
    let fast = 0;
    let mash = 0;
    for (let seed = 1; seed <= SAMPLE; seed++) {
      if (informedRun(level, seed, LOOK)) informed++;
      if (informedRun(level, seed + 500, 0.25)) fast++;
      if (mashRun(level, seed)) mash++;
    }
    rows.informed.push(`${level}:${informed}`);
    rows.fast.push(`${level}:${fast}`);
    rows.mash.push(`${level}:${mash}`);
    for (const [name, wins] of [
      ['informed', informed],
      ['informed-fast', fast],
      ['mash', mash],
    ])
      assert.ok(wins / SAMPLE <= 0.25, `${name} won ${wins}/${SAMPLE} of board ${level}`);
  }
  console.log(`informed wins /${SAMPLE}: ${rows.informed.join(' ')}`);
  console.log(`informed (0.25 s look) wins /${SAMPLE}: ${rows.fast.join(' ')}`);
  console.log(`mash wins /${SAMPLE}: ${rows.mash.join(' ')}`);
});

test('quality: port-pair hill climbing (three weightings, one that probes with undo) wins at most half the boards and under half of each of boards 17 to 24', () => {
  const RUNS = 20;
  for (const name of ['plain', 'pairs', 'pairs2', 'pairs2+undo']) {
    const per = [];
    let majority = 0;
    for (let level = 1; level <= BOARD_COUNT; level++) {
      let wins = 0;
      for (let seed = 1; seed <= RUNS; seed++)
        if (climbRun(level, seed, WEIGHTS[name.replace('+undo', '')], name.endsWith('+undo')))
          wins++;
      per.push(`${level}:${wins}`);
      if (wins / RUNS >= 0.5) majority++;
      if (level >= 17)
        assert.ok(wins / RUNS < 0.5, `${name} won ${wins}/${RUNS} of board ${level}`);
    }
    console.log(`${name} climber wins /${RUNS}: ${per.join(' ')}`);
    assert.ok(majority <= BOARD_COUNT / 2, `${name} wins a majority of ${majority} boards`);
  }
});

test('quality: shorts bite: wrong turns near the solution join two voltages on every multi-voltage board (open boards after one wrong turn)', () => {
  const rows = [];
  let singleTurn = 0;
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const b = BOARDS[level - 1];
    if (b.volts.length < 2) continue;
    const plan = solve(b, b.start);
    const live = liveTurnable(b);
    const turnBy = (rots, i, p) => {
      const out = rots.slice();
      out[i] = (out[i] + p) % TILE_TYPES[b.cells[i].type].period;
      return out;
    };
    const moves = live.flatMap((i) =>
      Array.from({ length: TILE_TYPES[b.cells[i].type].period - 1 }, (_, k) => [i, k + 1]),
    );
    const one = moves.filter(
      ([i, p]) => analyze(b, turnBy(plan.target, i, p)).shorts.length,
    ).length;
    let two = 0;
    for (let x = 0; x < moves.length; x++)
      for (let y = x + 1; y < moves.length; y++)
        if (moves[x][0] !== moves[y][0]) {
          const rots = turnBy(
            turnBy(plan.target, moves[x][0], moves[x][1]),
            moves[y][0],
            moves[y][1],
          );
          if (analyze(b, rots).shorts.length) two++;
        }
    const rnd = seeded(level);
    const tt = turnableOf(b);
    let random = 0;
    const SAMPLES = 4000;
    for (let n = 0; n < SAMPLES; n++) {
      const rots = b.start.map((v, i) =>
        tt.includes(i) ? Math.floor(rnd() * TILE_TYPES[b.cells[i].type].period) : v,
      );
      if (analyze(b, rots).shorts.length) random++;
    }
    rows.push(
      `${level}:${b.sealed ? 'sealed' : 'open'} 1-turn=${one} 2-turn=${two} random=${((100 * random) / SAMPLES).toFixed(2)}%`,
    );
    if (one >= 2) singleTurn++;
    if (level !== 10 && level !== 19)
      assert.ok(one >= 2 || two >= 2, `board ${level} has no natural short`);
    if (!b.sealed) assert.ok(one >= 2, `open board ${level} needs shorts one turn away`);
  }
  console.log(`reachable shorts per multi-voltage board:\n${rows.join('\n')}`);
  assert.ok(singleTurn >= 6, `${singleTurn} boards short after a single wrong turn`);
});
