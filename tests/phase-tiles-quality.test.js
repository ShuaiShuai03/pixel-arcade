import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARDS,
  BOARD_COUNT,
  RULES,
  meta,
  createGame,
  layoutOf,
  solveFrom,
  mismatches,
  pressable,
  pressed,
} from '../src/games/phase-tiles.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt line, the
// boards, the cursor and the press counter. They press only public keys or tap the canvas.
// ---------------------------------------------------------------------------------------------
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const HZS = [30, 60, 120];
const MAX_SECONDS = 240;
const TUTORIALS = 4; // boards 1 to 4 teach the controls on the plain plus; board 4 adds the budget
const PROBE = 30; // runs per board and policy in the depth gates
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const EN_ARROW = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };
const ZH_ARROW = { 右: 'ArrowRight', 左: 'ArrowLeft', 上: 'ArrowUp', 下: 'ArrowDown' };
const CJK = /[一-鿿]/;

function open(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// What a person does for the line they read: an arrow, Space, Z, H for a hint, or nothing.
function keyFor(line, lang) {
  if (lang === 'zh') {
    const move = /^光标向(.)移/.exec(line);
    if (move) return ZH_ARROW[move[1]];
    if (/^空格：/.test(line)) return 'Space';
    if (/^Z：/.test(line)) return 'KeyZ';
    if (line.includes('[H] 提示')) return 'KeyH';
    return null;
  }
  const move = /^Move ([←→↑↓])/.exec(line);
  if (move) return EN_ARROW[move[1]];
  if (/^Space:/.test(line)) return 'Space';
  if (/^Z:/.test(line)) return 'KeyZ';
  if (line.includes('[H] hint')) return 'KeyH';
  return null;
}

// A literal follower: it does what the prompt said `lag` seconds ago, once per new line, and
// repeats a line that is still there after 1.5 s. It never looks at anything but the line.
function follower(lag, lang) {
  const hist = [];
  let last = { text: null, t: -9 };
  let lastPress = -9;
  return (st, t) => {
    hist.push({ t, line: st.line[lang] });
    if (hist.length > 600) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const text = hist[k].line;
    const key = keyFor(text, lang);
    if (!key || t - lastPress < 0.12) return [];
    if (text === last.text && t - last.t < 1.5) return [];
    last = { text, t };
    lastPress = t;
    return [key];
  };
}

const won = (st, level) => st.level > level || st.phase === 'won';

function play({ g, h, level, hz = 60, lang = 'en', decide, onFrame, seconds = MAX_SECONDS }) {
  let t = 0;
  let st = g.getState();
  for (; t < seconds; t += 1 / hz) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    const keys = decide(st, t);
    onFrame?.(st, t, keys);
    g.update(1 / hz, input([], keys));
  }
  st = g.getState();
  return { st, t, cleared: won(st, level), h };
}

// A mistaken or scrambled start: a few random cursor moves and presses through the real controls.
// Returns null when the scramble already ended or solved the board.
function scrambled(level, seed, lang = 'en') {
  const { g, h } = open(level, { seed, lang });
  const r = seeded(seed * 131 + level);
  const pool = [...ARROWS, ...ARROWS, 'Space', 'Space', 'Space'];
  for (let n = 0; n < 4 + Math.floor(r() * 8); n++) {
    g.update(1 / 60, input([], [pool[Math.floor(r() * pool.length)]]));
    const after = g.getState();
    if (after.phase !== 'playing' || after.movesLeft === 0 || after.solved) return null;
  }
  return { g, h };
}

// ---------------------------------------------------------------------------------------------
// Prompt followers
// ---------------------------------------------------------------------------------------------
test('a literal prompt follower clears every board from the start at 30, 60 and 120 Hz in both languages', () => {
  let slowest = 0;
  for (let level = 1; level <= BOARD_COUNT; level++)
    for (const hz of HZS)
      for (const lang of ['en', 'zh']) {
        const { g, h } = open(level, { lang });
        const r = play({ g, h, level, hz, lang, decide: follower(level % 2 ? 0.2 : 0.5, lang) });
        slowest = Math.max(slowest, r.t);
        assert.ok(
          r.cleared,
          `board ${level} ${hz}Hz ${lang}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
        );
        assert.equal(h.ends.filter((e) => !e.won).length, 0, `board ${level} ended in a loss`);
      }
  assert.ok(slowest < MAX_SECONDS);
});

test('followers with fast (0.15-0.35 s) and slow (0.4-0.6 s) reactions clear every board from the start in every run', () => {
  for (const [range, name] of [
    [FAST, 'fast'],
    [SLOW, 'slow'],
  ])
    for (let level = 1; level <= BOARD_COUNT; level++)
      for (let seed = 1; seed <= 4; seed++) {
        const lag = range[0] + seeded(seed * 7919 + level)() * (range[1] - range[0]);
        const { g, h } = open(level, { seed });
        const r = play({ g, h, level, hz: HZS[seed % 3], decide: follower(lag, 'en') });
        assert.ok(r.cleared, `${name} board ${level} seed ${seed} lag ${lag.toFixed(2)}`);
      }
});

test('a follower clears every board from at least 10 random scrambles, with no livelock and never a lost board', () => {
  let runs = 0;
  let slowest = 0;
  let undoPrompts = 0;
  for (let level = 1; level <= BOARD_COUNT; level++) {
    let done = 0;
    for (let seed = 1; done < 10 && seed < 300; seed++) {
      const s = scrambled(level, seed + level * 1000);
      if (!s) continue;
      done++;
      const lag = (seed % 2 ? FAST : SLOW)[0] + (seed % 5) * 0.05;
      const r = play({
        ...s,
        level,
        hz: HZS[seed % 3],
        decide: follower(lag, 'en'),
        onFrame: (st) => {
          if (/^Z:/.test(st.line.en)) undoPrompts++;
        },
      });
      runs++;
      slowest = Math.max(slowest, r.t);
      assert.ok(
        r.cleared,
        `board ${level} scramble ${seed}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
      );
      assert.equal(s.h.ends.filter((e) => !e.won).length, 0);
    }
    assert.equal(done, 10, `board ${level} produced only ${done} usable scrambles`);
  }
  assert.ok(runs >= BOARD_COUNT * 10);
  assert.ok(slowest < MAX_SECONDS);
  assert.ok(undoPrompts > 0, 'a scramble should have needed an undo at least once');
});

test('a follower never loses a budget board, even after wasting presses, because the prompt asks for an undo', () => {
  let undoPrompts = 0;
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const board = BOARDS[level - 1];
    if (board.budget === null) continue;
    for (let seed = 1; seed <= 10; seed++) {
      const { g, h } = open(level, { seed });
      const r = seeded(seed * 17 + level);
      const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
      const target = spots[Math.floor(r() * spots.length)];
      const tx = target % board.w;
      const ty = Math.floor(target / board.w);
      for (let n = 0; n < 40; n++) {
        const c = g.getState().cursor;
        const key =
          c.x < tx
            ? 'ArrowRight'
            : c.x > tx
              ? 'ArrowLeft'
              : c.y < ty
                ? 'ArrowDown'
                : c.y > ty
                  ? 'ArrowUp'
                  : null;
        if (!key) break;
        g.update(1 / 60, input([], [key]));
      }
      const wasted = 1 + Math.floor(r() * (board.slack + 1));
      for (let n = 0; n < wasted; n++) g.update(1 / 60, input([], ['Space']));
      const out = play({
        g,
        h,
        level,
        hz: 30,
        decide: follower(0.25, 'en'),
        onFrame: (st) => {
          if (/^Z:/.test(st.line.en)) undoPrompts++;
        },
      });
      assert.ok(out.cleared, `board ${level} wasted ${wasted}: ${out.st.phase}`);
      assert.equal(h.ends.filter((e) => !e.won).length, 0);
    }
  }
  assert.ok(undoPrompts > 0, 'the undo prompt should have been needed at least once');
});

test('the prompt names its action, and the text, the arrow and the highlighted cell always agree', () => {
  let checked = 0;
  const kinds = new Set();
  for (const lang of ['en', 'zh'])
    for (const level of [1, 3, 5, 8, 12, 15, 18, 21, 26]) {
      const { g } = open(level, { lang });
      const board = BOARDS[level - 1];
      const overlay = [];
      play({
        g,
        level,
        hz: 60,
        lang,
        decide: follower(0.2, lang),
        onFrame: (st) => {
          const h = st.hint;
          const key = keyFor(st.line[lang], lang);
          if (h.kind === 'hidden') {
            assert.equal(key, 'KeyH', `board ${level}: the goal line offers the H key`);
            assert.deepEqual([h.shown, h.key, h.x, h.y, h.dir], [false, null, null, null, null]);
            assert.ok(level > RULES.hintFreeBoards, `board ${level} hides its hint`);
          } else assert.equal(key, h.key, `board ${level}: "${st.line[lang]}" vs ${h.key}`);
          if (level <= RULES.hintFreeBoards && h.kind !== 'none') assert.equal(h.shown, true);
          kinds.add(h.kind);
          const cells = st.board.join('').replaceAll('#', '').length;
          assert.ok(cells > 0);
          if (h.kind === 'move') {
            assert.ok(h.x !== null && (h.x !== st.cursor.x || h.y !== st.cursor.y));
            const dx = h.x - st.cursor.x;
            const dy = h.y - st.cursor.y;
            const expected =
              dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp';
            assert.equal(h.key, expected);
            assert.equal(
              h.steps,
              dx !== 0 ? Math.abs(dx) : Math.abs(dy),
              'the number is the first leg',
            );
            assert.ok(st.line.en.includes(` ${h.steps} to row ${h.y + 1}, col ${h.x + 1}`));
            assert.ok(st.line.zh.includes(` ${h.steps} 格，到第 ${h.y + 1} 行第 ${h.x + 1} 列`));
          }
          if (h.kind === 'act') {
            assert.deepEqual([h.x, h.y], [st.cursor.x, st.cursor.y]);
            assert.ok(pressable(board, h.y * board.w + h.x));
            assert.equal(h.key, 'Space');
          }
          if (h.kind === 'undo') assert.equal(h.x, null);
          assert.ok(st.status[lang].endsWith(st.line[lang]));
          overlay.push(h);
          checked++;
        },
      });
    }
  assert.ok(checked > 800);
  assert.ok(kinds.has('act') && kinds.has('move'));
  assert.ok(
    [...kinds].every((k) => ['act', 'move', 'done', 'none', 'hidden'].includes(k)),
    [...kinds].join(),
  );
  assert.ok(kinds.has('hidden'), 'later boards start without the hint');
});

test('the highlighted tile is the one drawn with a hint frame, and its press really lies on a shortest way home', () => {
  for (const level of [2, 9, 17, 22]) {
    const { g } = open(level);
    const ask = () => g.update(1 / 60, input([], ['KeyH']));
    const board = BOARDS[level - 1];
    const o = layoutOf(board);
    for (let n = 0; n < 12; n++) {
      if (g.getState().solved) break;
      if (g.getState().hint.kind === 'hidden') ask();
      const st = g.getState();
      const h = st.hint;
      if (h.kind === 'done') break;
      const frames = [];
      const ctx = new Proxy(
        { fillStyle: '', globalAlpha: 1, measureText: (t) => ({ width: t.length * 7 }) },
        {
          get: (t, p) =>
            p in t
              ? t[p]
              : p === 'fillRect'
                ? (x, y, w, hh) => frames.push([t.fillStyle, x, y, w, hh])
                : () => {},
          set: (t, p, v) => ((t[p] = v), true),
        },
      );
      g.draw(ctx);
      const frame = frames.filter(
        ([c, , , w, hh]) => (c === '#ffe27a' || c === '#b8942a') && w === 36 && hh === 3,
      );
      assert.equal(frame.length, 2, `board ${level}: the top and bottom bars of one hint frame`);
      assert.deepEqual([frame[0][1], frame[0][2]], [o.x + h.x * 36, o.y + h.y * 36]);
      assert.equal(st.hint.kind === 'move' || st.hint.kind === 'act', true);
      // Pressing the highlighted tile lowers the distance to the target by exactly one.
      const cells = st.board
        .map((row) => [...row].map((ch) => (ch === '#' ? 0 : Number(ch))))
        .flat();
      const before = solveFrom(board, cells).cost;
      const after = solveFrom(board, pressed(board, cells, h.y * board.w + h.x)).cost;
      assert.equal(after, before - 1);
      // Walk there and press it.
      for (let k = 0; k < 20 && g.getState().hint.kind === 'move'; k++)
        g.update(1 / 60, input([], [g.getState().hint.key]));
      g.update(1 / 60, input([], ['Space']));
    }
  }
});

test('the prompt only changes when the player acts or a board changes, so it never flickers, and it fits the canvas', () => {
  let changes = 0;
  const widest = { en: 0, zh: 0 };
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 8, 12, 16, 20, 24, 26]) {
      const { g } = open(level, { lang });
      let last = null;
      let lastKeys = true;
      let lastLevel = level;
      let since = 0;
      play({
        g,
        level,
        hz: 60,
        lang,
        decide: follower(0.25, lang),
        onFrame: (st, t, keys) => {
          const line = st.line.en;
          if (line !== last) {
            if (last !== null && st.level === lastLevel) {
              assert.ok(lastKeys || t - since >= 0.5, `"${last}" -> "${line}" with nobody acting`);
              changes++;
            }
            last = line;
            since = t;
          }
          lastLevel = st.level;
          lastKeys = keys.length > 0;
          assert.ok(CJK.test(st.line.zh));
          const width = [...st.line[lang]].reduce((n, ch) => n + (CJK.test(ch) ? 14 : 8), 0);
          widest[lang] = Math.max(widest[lang], width);
        },
      });
    }
  assert.ok(changes > 100, `only ${changes} prompt changes observed`);
  assert.ok(widest.en <= 440 && widest.zh <= 440, JSON.stringify(widest));
});

test('English and Chinese runs play out identically', () => {
  for (const level of [2, 7, 11, 15, 19, 23]) {
    const a = open(level, { lang: 'en' });
    const b = open(level, { lang: 'zh' });
    const fa = follower(0.25, 'en');
    const fb = follower(0.25, 'zh');
    for (let f = 0; f < 60 * 40; f++) {
      const t = f / 60;
      const sa = a.g.getState();
      const sb = b.g.getState();
      assert.deepEqual(sa.hint, sb.hint);
      assert.deepEqual(sa.board, sb.board);
      assert.equal(sa.level, sb.level);
      assert.equal(sa.score, sb.score);
      if (sa.phase !== 'playing' || sa.level !== level) break;
      a.g.update(1 / 60, input([], fa(sa, t)));
      b.g.update(1 / 60, input([], fb(sb, t)));
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Depth: crude players lose, a sensible but blind player is not enough
// ---------------------------------------------------------------------------------------------
// A policy is a generator that yields the keys for one frame at a time and may read the screen.
function playPolicy(level, seed, make, { hz = 20, seconds = 120 } = {}) {
  const { g } = open(level, { seed });
  const gen = make(seed, () => g.getState());
  let t = 0;
  for (let f = 0; t < seconds; f++, t += 1 / hz) {
    if (f % 10 === 0) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
    }
    const next = gen.next();
    g.update(1 / hz, input([], next.done ? [] : next.value));
  }
  return won(g.getState(), level);
}
const wait = function* (n) {
  for (let i = 0; i < n; i++) yield [];
};
const frames = (seconds, hz = 20) => Math.max(1, Math.round(seconds * hz));
const arrowToward = (c, x, y) =>
  c.x < x
    ? 'ArrowRight'
    : c.x > x
      ? 'ArrowLeft'
      : c.y < y
        ? 'ArrowDown'
        : c.y > y
          ? 'ArrowUp'
          : null;

const POLICIES = {
  idle: () =>
    (function* () {
      for (;;) yield [];
    })(),
  mashSpaceFast: () =>
    (function* () {
      for (;;) {
        yield ['Space'];
        yield* wait(1);
      }
    })(),
  mashSpaceSlow: () =>
    (function* () {
      for (;;) {
        yield ['Space'];
        yield* wait(frames(0.7));
      }
    })(),
  randomKeys: (seed) =>
    (function* () {
      const r = seeded(seed + 9);
      const pool = ['Space', 'Space', 'KeyZ', ...ARROWS, ...ARROWS];
      for (;;) {
        yield [pool[Math.floor(r() * pool.length)]];
        yield* wait(frames(0.3 + r() * 1.2));
      }
    })(),
  quickRandom: (seed) =>
    (function* () {
      const r = seeded(seed + 21);
      const pool = ['Space', 'Space', 'Space', ...ARROWS, ...ARROWS];
      for (;;) {
        yield [pool[Math.floor(r() * pool.length)]];
        yield* wait(frames(0.1 + r() * 0.3));
      }
    })(),
  undoSpam: () =>
    (function* () {
      for (;;) {
        yield ['Space'];
        yield* wait(frames(0.3));
        yield ['KeyZ'];
        yield* wait(frames(0.3));
        yield ['KeyZ'];
        yield* wait(frames(0.3));
      }
    })(),
  // Press everything: visit every tile in order, pressing whatever is there, again and again.
  pressAllRows: (seed, read) => sweep(read, 'rows', 0.2 + (seed % 3) * 0.15),
  pressAllColumns: (seed, read) => sweep(read, 'columns', 0.2 + (seed % 3) * 0.15),
  pressAllBackwards: (seed, read) => sweep(read, 'back', 0.25),
};
function* sweep(read, order, pace) {
  for (;;) {
    const { board } = read();
    const w = board[0].length;
    const h = board.length;
    const cells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
    if (order === 'columns') cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (order === 'back') cells.reverse();
    for (const [x, y] of cells) {
      for (;;) {
        const key = arrowToward(read().cursor, x, y);
        if (!key) break;
        yield [key];
        yield* wait(frames(pace));
      }
      yield ['Space'];
      yield* wait(frames(pace));
    }
  }
}

const rate = (n, total) => `${n}/${total}`;
test('idle never wins a board', () => {
  for (let level = 1; level <= BOARD_COUNT; level++)
    assert.equal(playPolicy(level, 1, POLICIES.idle, { seconds: 10 }), false, `board ${level}`);
});

test('from board 3 on, mashing, random keys, undo spam and press-everything sweeps each win at most a quarter of runs', (t) => {
  const failures = {};
  const table = {};
  for (const [name, make] of Object.entries(POLICIES)) {
    if (name === 'idle') continue;
    table[name] = [];
    for (let level = 3; level <= BOARD_COUNT; level++) {
      let n = 0;
      for (let seed = 1; seed <= PROBE; seed++)
        if (playPolicy(level, seed + level * 100, make)) n++;
      table[name].push(n);
      if (n > PROBE / 4) (failures[name] ??= []).push(`board ${level} ${rate(n, PROBE)}`);
    }
  }
  for (const [name, row] of Object.entries(table))
    t.diagnostic(
      `${name.padEnd(18)} wins of ${PROBE} in boards 3-${BOARD_COUNT}: ${row.join(' ')}`,
    );
  assert.deepEqual(failures, {}, JSON.stringify(table));
  // Much less late: from board 18 on no crude policy wins even once.
  for (const [name, row] of Object.entries(table))
    assert.equal(Math.max(...row.slice(18 - 3)), 0, `${name} won a late board: ${row}`);
});

// The blind but sensible player: "press whichever tile lowers the mismatch count most", ties
// broken at random. It may know the preview of every tile (it can move the cursor over each).
// `forced` presses the least bad tile when nothing helps; otherwise it gives up there.
function* greedy(read, level, seed, forced) {
  const board = BOARDS[level - 1];
  const r = seeded(seed * 977 + level);
  const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
  const decode = (rows) =>
    rows.map((row) => [...row].map((ch) => (ch === '#' ? 0 : Number(ch)))).flat();
  for (;;) {
    const st = read();
    if (st.solved) {
      yield [];
      continue;
    }
    const cells = decode(st.board);
    const base = mismatches(board, cells);
    let top = [];
    let bestGain = -Infinity;
    for (const i of spots) {
      const gain = base - mismatches(board, pressed(board, cells, i));
      if (gain > bestGain) {
        bestGain = gain;
        top = [i];
      } else if (gain === bestGain) top.push(i);
    }
    if (!forced && bestGain <= 0) {
      for (;;) yield [];
    }
    const pick = top[Math.floor(r() * top.length)];
    for (;;) {
      const key = arrowToward(read().cursor, pick % board.w, Math.floor(pick / board.w));
      if (!key) break;
      yield [key];
    }
    yield ['Space'];
  }
}
test('the blind "press whichever tile lowers the mismatch most" heuristic beats at most half the boards and none of the last third', (t) => {
  const lastThird = Math.ceil((BOARD_COUNT * 2) / 3);
  const rows = {};
  for (const forced of [false, true]) {
    const wins = [];
    for (let level = 1; level <= BOARD_COUNT; level++) {
      let n = 0;
      for (let seed = 1; seed <= 8; seed++)
        if (
          playPolicy(level, seed, (sd, read) => greedy(read, level, sd, forced), {
            hz: 20,
            seconds: 120,
          })
        )
          n++;
      wins.push(n);
    }
    const name = forced ? 'forced' : 'strict';
    rows[name] = wins;
    t.diagnostic(`greedy ${name} wins of 8 per board: ${wins.join(' ')}`);
    const beaten = wins.map((n, i) => (n > 0 ? i + 1 : 0)).filter(Boolean);
    assert.ok(beaten.length <= BOARD_COUNT / 2, `${name} beat boards ${beaten}`);
    assert.deepEqual(
      beaten.filter((l) => l > lastThird),
      [],
      `${name} beat a board in the last third`,
    );
    assert.ok(wins[0] > 0, 'the heuristic should at least solve the first tutorial board');
  }
});

test('the optimal press counts form a rising difficulty curve and every feature appears', (t) => {
  const curve = BOARDS.map((b) => b.optimal);
  t.diagnostic(`optimal presses per board: ${curve.join(' ')}`);
  assert.equal(Math.min(...curve), curve[0]);
  assert.ok(curve[BOARD_COUNT - 1] >= 8 * curve[0]);
  const third = Math.floor(BOARD_COUNT / 3);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const parts = [curve.slice(0, third), curve.slice(third, 2 * third), curve.slice(2 * third)].map(
    mean,
  );
  assert.ok(parts[0] < parts[1] && parts[1] < parts[2], parts.join(' '));
  curve.forEach((n, i) => i && assert.ok(n >= curve[i - 1] - 1, `board ${i + 1} dips`));
  const feature = (fn) => BOARDS.findIndex(fn) + 1;
  const firsts = {
    budget: feature((b) => b.budget !== null),
    holes: feature((b) => b.cells.some((c) => c.hole)),
    locks: feature((b) => b.cells.some((c) => c.locked)),
    diagonal: feature((b) => b.cells.some((c) => c.shape === 'x')),
    ring: feature((b) => b.cells.some((c) => c.shape === 'o')),
    line: feature((b) => b.cells.some((c) => 'hvc'.includes(c.shape))),
    knight: feature((b) => b.cells.some((c) => c.shape === 'k')),
    icons: feature((b) => b.mixed),
    threePhases: feature((b) => b.phases === 3),
  };
  t.diagnostic(`first board of each feature: ${JSON.stringify(firsts)}`);
  assert.equal(firsts.budget, TUTORIALS, 'the budget is taught on the last tutorial board');
  for (const [name, at] of Object.entries(firsts))
    if (name !== 'budget') assert.ok(at > TUTORIALS, `${name} first at ${at}`);
  const order = [
    'budget',
    'holes',
    'locks',
    'diagonal',
    'ring',
    'line',
    'knight',
    'icons',
    'threePhases',
  ];
  order.forEach(
    (name, i) =>
      i && assert.ok(firsts[name] > firsts[order[i - 1]], `${name} comes after ${order[i - 1]}`),
  );
  // Tutorials are the plain plus on two phases with no holes or locks; only board 4 has a budget.
  BOARDS.slice(0, TUTORIALS).forEach((b, i) => {
    assert.ok(b.phases === 2 && !b.mixed && (b.budget === null) === i < TUTORIALS - 1);
    assert.ok(b.cells.every((c) => c.shape === 'p' && !c.hole && !c.locked));
  });
  assert.ok(BOARDS.filter((b) => b.budget !== null).length >= BOARD_COUNT * 0.75);
});

// The batch-literal follower reads "Move -> N", presses that arrow exactly N times and then reads
// the prompt again. The number must therefore be the length of the leg along the arrow.
test('a batch-literal follower (press the arrow exactly N times, then re-read) clears every board, from the start and from scrambles', () => {
  const batch = (g, level) => {
    for (let f = 0; f < 4000; f++) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const move = /^Move ([←→↑↓]) (\d+)/.exec(st.line.en);
      if (move)
        for (let i = 0; i < Number(move[2]); i++) g.update(1 / 30, input([], [EN_ARROW[move[1]]]));
      else g.update(1 / 30, input([], [keyFor(st.line.en, 'en')].filter(Boolean)));
      // The prompt reacts at once, so a Space press is never repeated by mistake.
      for (let k = 0; k < 20; k++) g.update(1 / 30, input());
    }
    return won(g.getState(), level);
  };
  for (let level = 1; level <= BOARD_COUNT; level++) {
    assert.ok(batch(open(level).g, level), `board ${level} from the start`);
    let done = 0;
    for (let seed = 1; done < 3 && seed < 200; seed++) {
      const s = scrambled(level, seed + level * 500);
      if (!s) continue;
      done++;
      assert.ok(batch(s.g, level), `board ${level} scramble ${seed}`);
    }
    assert.equal(done, 3);
  }
});

// The reviewer-style player: pick a random pressable tile, walk to it, press it and look.
function informedRandom(level, seed, observe = 1, seconds = 120, hz = 20) {
  const { g } = open(level, { seed });
  const board = BOARDS[level - 1];
  const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
  const r = seeded(seed * 31 + level);
  let t = 0;
  const alive = () => {
    const st = g.getState();
    return st.phase === 'playing' && st.level === level;
  };
  const idle = (secs) => {
    for (let i = 0; i < Math.round(secs * hz) && t < seconds && alive(); i++, t += 1 / hz)
      g.update(1 / hz, input());
  };
  while (t < seconds && alive()) {
    const pick = spots[Math.floor(r() * spots.length)];
    for (;;) {
      const key = arrowToward(g.getState().cursor, pick % board.w, Math.floor(pick / board.w));
      if (!key || t >= seconds || !alive()) break;
      g.update(1 / hz, input([], [key]));
      t += 1 / hz;
      idle(0.25);
    }
    if (!alive()) break;
    g.update(1 / hz, input([], ['Space']));
    t += 1 / hz;
    idle(observe);
  }
  return won(g.getState(), level);
}

test('the informed random presser (random real tile, walk, press, look) wins at most a quarter of runs on every board from board 5', (t) => {
  const row = [];
  for (let level = TUTORIALS + 1; level <= BOARD_COUNT; level++) {
    let n = 0;
    for (let seed = 1; seed <= PROBE; seed++) if (informedRandom(level, seed)) n++;
    row.push(n);
    assert.ok(n <= PROBE / 4, `board ${level}: ${n}/${PROBE} (${row.join(' ')})`);
  }
  t.diagnostic(
    `informed random presser, boards 5-${BOARD_COUNT}, wins of ${PROBE}: ${row.join(' ')}`,
  );
});

// ---------------------------------------------------------------------------------------------
// Touch and layout
// ---------------------------------------------------------------------------------------------
test('touch targets stay large on a 390 px wide phone and every action has a touch route', () => {
  const scale = 390 / 480;
  assert.ok(RULES.cell * scale >= 28, `tiles are ${RULES.cell * scale}px on a phone`);
  assert.ok(56 * scale >= 44 && 44 * scale >= 34, 'menu tiles');
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyZ',
    'KeyQ',
    'KeyH',
  ])
    assert.ok(codes.includes(code), code);
  assert.ok(meta.touchControls.every((c) => c.side === 'left' || c.side === 'right'));
  for (const b of BOARDS) {
    assert.ok(b.w * RULES.cell <= 252 && b.h * RULES.cell <= 248);
    const o = layoutOf(b);
    assert.ok(o.x >= 100 && o.x + b.w * RULES.cell <= 480 - 100, 'room for both side cards');
  }
});

test('a touch-only player (tap to select, tap again to press, the Undo button) clears every board', () => {
  for (let level = 1; level <= BOARD_COUNT; level++) {
    const { g, h } = open(level);
    const board = BOARDS[level - 1];
    const o = layoutOf(board);
    let t = 0;
    for (let f = 0; f < 60 * 120; f++, t += 1 / 60) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const hint = st.hint;
      if (hint.kind === 'hidden') g.update(1 / 60, input([], ['KeyH']));
      else if (hint.kind === 'undo') g.update(1 / 60, input([], ['KeyZ']));
      else if (hint.kind === 'move' || hint.kind === 'act') {
        const tap = {
          x: o.x + hint.x * RULES.cell + 18,
          y: o.y + hint.y * RULES.cell + 18,
          clicked: true,
        };
        g.update(1 / 60, input([], [], tap));
        for (let k = 0; k < 9; k++) g.update(1 / 60, input());
      } else g.update(1 / 60, input());
    }
    assert.ok(won(g.getState(), level), `board ${level}: ${g.getState().phase}`);
    assert.equal(h.ends.filter((e) => !e.won).length, 0);
  }
});

// ---------------------------------------------------------------------------------------------
// The look-ahead bot with free restarts (Q costs nothing). It reads the board, the target, the
// influence shapes and the budget only: idle at Off 0, Q when no presses are left, otherwise it
// tries every press sequence up to `depth` (bounded by the presses left) and takes a random first
// press among those reaching the lowest Off, if that beats the current Off. When stuck it presses
// a random tile once and restarts the board the second time. One decision every quarter second.
// ---------------------------------------------------------------------------------------------
const LOOK_DECISIONS = 480; // 120 s at 4 decisions per second

function lookModel(board) {
  const spots = board.cells.map((c, i) => i).filter((i) => pressable(board, i));
  return { board, spots, size: board.cells.length };
}
const offOf = (m, cells) => {
  let off = 0;
  for (let i = 0; i < m.size; i++)
    if (!m.board.cells[i].hole && cells[i] !== m.board.target[i]) off++;
  return off;
};
const pressCells = (m, cells, i) => {
  const next = Int8Array.from(cells);
  for (const j of m.board.influence[i]) next[j] = (next[j] + 1) % m.board.phases;
  return next;
};

// One decision: { kind: 'idle' | 'press' | 'restart', tile }. `mem.stuck` and `cache` persist.
function lookDecide(m, cells, left, depth, rnd, mem, cache) {
  if (left <= 0) return { kind: 'restart' };
  const off0 = offOf(m, cells);
  if (off0 === 0) return { kind: 'idle' };
  const key = `${cells.join('')}|${Math.min(depth, left)}`;
  let found = cache.get(key);
  if (!found) {
    found = { best: off0, firsts: [] };
    // Presses are applied in place and taken back out, tracking Off as it changes.
    const work = Int8Array.from(cells);
    const { phases, target, influence } = m.board;
    const bump = (i, step) => {
      let delta = 0;
      for (const j of influence[i]) {
        delta -= work[j] === target[j] ? 1 : 0;
        work[j] = (work[j] + step + phases) % phases;
        delta += work[j] === target[j] ? 1 : 0;
      }
      return -delta; // the change in Off
    };
    const search = (d, first, off) => {
      for (const i of m.spots) {
        const next = off + bump(i, 1);
        const f = first ?? i;
        if (next < found.best) {
          found.best = next;
          found.firsts = [f];
        } else if (next === found.best && next < off0 && !found.firsts.includes(f))
          found.firsts.push(f);
        if (d > 1 && next !== 0 && d - 1 <= left - 1) search(d - 1, f, next);
        bump(i, -1);
        if (next === 0) return;
      }
    };
    search(Math.min(depth, left), null, off0);
    cache.set(key, found);
  }
  if (found.best < off0 && found.firsts.length)
    return { kind: 'press', tile: found.firsts[Math.floor(rnd() * found.firsts.length)] };
  mem.stuck++;
  if (mem.stuck > 1) return { kind: 'restart' };
  return { kind: 'press', tile: m.spots[Math.floor(rnd() * m.spots.length)] };
}

// The model run: the same decisions on the rules alone, with no screen in between.
function lookRun(level, depth, seed, cache) {
  const board = BOARDS[level - 1];
  const m = lookModel(board);
  const rnd = seeded(seed * 977 + level * 13 + 5);
  const mem = { stuck: 0 };
  let cells = Int8Array.from(board.start);
  let moves = 0;
  for (let d = 0; d < LOOK_DECISIONS; d++) {
    const left = board.budget === null ? 99 : board.budget - moves;
    const act = lookDecide(m, cells, left, depth, rnd, mem, cache);
    if (act.kind === 'idle') return true;
    if (act.kind === 'restart') {
      cells = Int8Array.from(board.start);
      moves = 0;
      mem.stuck = 0;
    } else {
      cells = pressCells(m, cells, act.tile);
      moves++;
    }
  }
  return offOf(m, cells) === 0;
}

// The same bot through the real controls: taps on the canvas for tiles and the Q key for restarts.
function lookRunUi(level, depth, seed, seconds = 120, hz = 60) {
  const { g } = open(level, { seed });
  const board = BOARDS[level - 1];
  const m = lookModel(board);
  const o = layoutOf(board);
  const rnd = seeded(seed * 977 + level * 13 + 5);
  const mem = { stuck: 0 };
  const cache = new Map();
  const every = hz / 4;
  const tap = (i) => ({
    x: o.x + (i % board.w) * RULES.cell + 18,
    y: o.y + Math.floor(i / board.w) * RULES.cell + 18,
    clicked: true,
  });
  for (let f = 0; f < seconds * hz; f++) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    if (f % every) {
      g.update(1 / hz, input());
      continue;
    }
    const cells = st.board.join('').replaceAll('#', '0').split('').map(Number);
    const left = st.movesLeft === null ? 99 : st.movesLeft;
    const act = lookDecide(m, cells, left, depth, rnd, mem, cache);
    if (act.kind === 'restart') {
      g.update(1 / hz, input([], ['KeyQ']));
      mem.stuck = 0;
    } else if (act.kind === 'press') {
      if (st.cursor.x !== act.tile % board.w || st.cursor.y !== Math.floor(act.tile / board.w))
        g.update(1 / hz, input([], [], tap(act.tile)));
      g.update(1 / hz, input([], [], tap(act.tile)));
      f++;
    } else g.update(1 / hz, input());
  }
  const st = g.getState();
  return won(st, level);
}

test('the look-ahead bots with free restarts (depth 2 and 3, 120 s) win no board from 18 on, beat at most half the boards and win at most a quarter of runs from board 3 on', (t) => {
  const lastWin = [];
  for (const [depth, seeds] of [
    [2, 20],
    [3, 10],
  ]) {
    const wins = [];
    for (let level = 1; level <= BOARD_COUNT; level++) {
      const cache = new Map();
      let n = 0;
      for (let seed = 1; seed <= seeds; seed++) if (lookRun(level, depth, seed, cache)) n++;
      wins.push(n);
      if (level >= 3) assert.ok(n <= seeds / 4, `depth ${depth} board ${level}: ${n}/${seeds}`);
      if (level >= 18) assert.equal(n, 0, `depth ${depth} won board ${level}`);
    }
    t.diagnostic(`look-ahead depth ${depth}, wins of ${seeds} per board: ${wins.join(' ')}`);
    const beaten = wins.map((n, i) => (n > 0 ? i + 1 : 0)).filter(Boolean);
    assert.ok(beaten.length <= BOARD_COUNT / 2, `depth ${depth} beat boards ${beaten}`);
    lastWin.push(beaten);
  }
  // Only the two opening boards fall to it at all.
  assert.deepEqual(
    lastWin[0].filter((l) => l > 2),
    [],
  );
  assert.deepEqual(
    lastWin[1].filter((l) => l > 2),
    [],
  );
});

test('the look-ahead bot played through taps and Q key agrees with its model: it beats the first boards and none of the late ones', () => {
  for (const level of [1, 2]) assert.ok(lookRunUi(level, 2, 1), `board ${level}`);
  for (const level of [8, 14, 20, 24, 26])
    for (const depth of [2, 3])
      assert.equal(lookRunUi(level, depth, 3, 60), false, `board ${level} depth ${depth}`);
});
