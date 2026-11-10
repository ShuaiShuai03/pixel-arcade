import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOMS,
  ROOM_COUNT,
  RULES,
  meta,
  createGame,
  solveRoom,
  traceBeam,
} from '../src/games/mirror-lab.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt line,
// the board, the cursor, the lit sensors and the turn counter. They press only public keys.
// ---------------------------------------------------------------------------------------------
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const HZS = [30, 60, 120];
const MAX_SECONDS = 240;
const TUTORIALS = 5; // rooms 1 to 5 teach the controls and are exempt from the informed-random bar
const PROBE = 40; // runs per room and policy in the depth gates
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const EN_ARROW = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };
const ZH_ARROW = { 右: 'ArrowRight', 左: 'ArrowLeft', 上: 'ArrowUp', 下: 'ArrowDown' };

function open(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// What a person does for the line they read: an arrow, Space, X, Z, H or nothing. A room that has
// stopped handing out moves shows its goal and the H key; a follower asks for the hint there.
function keyFor(line, lang) {
  if (lang === 'zh') {
    if (/\[H\] 提示/.test(line)) return 'KeyH';
    const move = /^光标向(.)移/.exec(line);
    if (move) return ZH_ARROW[move[1]];
    if (/^按空格/.test(line)) return 'Space';
    if (/^按 X/.test(line)) return 'KeyX';
    if (/按 Z/.test(line)) return 'KeyZ';
    return null;
  }
  if (/\[H\] hint/.test(line)) return 'KeyH';
  const move = /^Move cursor ([←→↑↓])/.exec(line);
  if (move) return EN_ARROW[move[1]];
  if (/^Press Space/.test(line)) return 'Space';
  if (/^Press X/.test(line)) return 'KeyX';
  if (/press Z/.test(line)) return 'KeyZ';
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

// A mistaken or scrambled start: a few random cursor moves and turns through the real controls.
// Returns null when the scramble already ended or solved the room.
function scrambled(level, seed, lang = 'en') {
  const { g, h } = open(level, { seed, lang });
  const r = seeded(seed * 131 + level);
  const room = ROOMS[level - 1];
  const pool = [...ARROWS, ...ARROWS, 'Space', 'Space', 'KeyX'];
  for (let n = 0; n < 4 + Math.floor(r() * 8); n++) {
    const before = g.getState();
    g.update(1 / 60, input([], [pool[Math.floor(r() * pool.length)]]));
    const after = g.getState();
    if (after.phase !== 'playing' || after.movesLeft === 0 || after.solved) return null;
    if (after.moves < before.moves) return null;
  }
  assert.ok(room);
  return { g, h };
}

// ---------------------------------------------------------------------------------------------
// Prompt followers
// ---------------------------------------------------------------------------------------------
test('a literal prompt follower clears every room from the start at 30, 60 and 120 Hz in both languages', () => {
  const report = [];
  for (let level = 1; level <= ROOM_COUNT; level++)
    for (const hz of HZS)
      for (const lang of ['en', 'zh']) {
        const { g, h } = open(level, { lang });
        const r = play({ g, h, level, hz, lang, decide: follower(level % 2 ? 0.2 : 0.5, lang) });
        report.push(r.t);
        assert.ok(
          r.cleared,
          `room ${level} ${hz}Hz ${lang}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
        );
        assert.equal(h.ends.filter((e) => !e.won).length, 0, `room ${level} ended in a loss`);
      }
  assert.ok(Math.max(...report) < MAX_SECONDS);
});

test('followers with fast (0.15-0.35 s) and slow (0.4-0.6 s) reactions clear every room from the start in every run', () => {
  for (const [range, name] of [
    [FAST, 'fast'],
    [SLOW, 'slow'],
  ])
    for (let level = 1; level <= ROOM_COUNT; level++)
      for (let seed = 1; seed <= 6; seed++) {
        const lag = range[0] + seeded(seed * 7919 + level)() * (range[1] - range[0]);
        const { g, h } = open(level, { seed });
        const r = play({ g, h, level, hz: HZS[seed % 3], decide: follower(lag, 'en') });
        assert.ok(r.cleared, `${name} room ${level} seed ${seed} lag ${lag.toFixed(2)}`);
      }
});

test('a follower clears every room from at least 10 random scrambles, with no livelock and never a lost room', () => {
  let runs = 0;
  let slowest = 0;
  for (let level = 1; level <= ROOM_COUNT; level++) {
    let done = 0;
    for (let seed = 1; done < 10 && seed < 200; seed++) {
      const s = scrambled(level, seed + level * 1000);
      if (!s) continue;
      done++;
      const lag = (seed % 2 ? FAST : SLOW)[0] + (seed % 5) * 0.05;
      const r = play({ ...s, level, hz: HZS[seed % 3], decide: follower(lag, 'en') });
      runs++;
      slowest = Math.max(slowest, r.t);
      assert.ok(
        r.cleared,
        `room ${level} scramble ${seed}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
      );
      assert.equal(s.h.ends.filter((e) => !e.won).length, 0);
    }
    assert.equal(done, 10, `room ${level} produced only ${done} usable scrambles`);
  }
  assert.ok(runs >= ROOM_COUNT * 10);
  assert.ok(slowest < MAX_SECONDS);
});

test('a follower never loses a budget room, even after wasting turns, because the prompt asks for an undo', () => {
  let undoPrompts = 0;
  for (let level = 1; level <= ROOM_COUNT; level++) {
    if (ROOMS[level - 1].budget === null) continue;
    for (let seed = 1; seed <= 12; seed++) {
      const { g, h } = open(level, { seed });
      // Waste turns: turn the first switch back and forth as far as the budget allows minus the optimum.
      const room = ROOMS[level - 1];
      const spare = room.budget - solveRoom(room).optimal;
      const r = seeded(seed);
      const ci = room.toggles[Math.floor(r() * room.toggles.length)];
      const target = { x: ci % room.w, y: Math.floor(ci / room.w) };
      for (let n = 0; n < 40; n++) {
        const c = g.getState().cursor;
        const key =
          c.x < target.x
            ? 'ArrowRight'
            : c.x > target.x
              ? 'ArrowLeft'
              : c.y < target.y
                ? 'ArrowDown'
                : c.y > target.y
                  ? 'ArrowUp'
                  : null;
        if (!key) break;
        g.update(1 / 60, input([], [key]));
      }
      const wasted = 1 + Math.floor(r() * (spare + 1));
      for (let n = 0; n < wasted; n++) g.update(1 / 60, input([], ['Space']));
      const out = play({
        g,
        h,
        level,
        hz: 30,
        decide: follower(0.25, 'en'),
        onFrame: (st) => {
          if (/press Z to undo/.test(st.line.en)) undoPrompts++;
        },
      });
      assert.ok(out.cleared, `room ${level} wasted ${wasted}: ${out.st.phase}`);
      assert.equal(h.ends.filter((e) => !e.won).length, 0);
    }
  }
  assert.ok(undoPrompts > 0, 'the undo prompt should have been needed at least once');
});

test('the prompt names its move, and the text, the arrow and the highlighted cell always agree', () => {
  let checked = 0;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 3, 6, 9, 13, 17, 22]) {
      const { g } = open(level, { lang });
      const o = ROOMS[level - 1];
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
            assert.ok(level > TUTORIALS && st.line[lang].includes('[H]'), `room ${level}`);
            assert.equal(key, 'KeyH');
            assert.equal(h.kind, 'hidden');
            assert.equal(h.x, null);
            assert.equal(st.optimal, null);
            checked++;
            return;
          }
          assert.equal(key, h.key, `room ${level}: "${st.line[lang]}" vs ${h.key}`);
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
            assert.ok(st.line[lang].includes(` ${h.steps} `));
          }
          if (h.kind === 'act') {
            assert.deepEqual([h.x, h.y], [st.cursor.x, st.cursor.y]);
            const cell = o.cells[h.y * o.w + h.x];
            assert.equal(h.key, cell.k === 'shutter' ? 'KeyX' : 'Space');
          }
          assert.ok(st.status[lang].endsWith(st.line[lang]));
          checked++;
        },
      });
    }
  assert.ok(checked > 500);
});

test('the prompt only changes when the player acts or a room changes, so it never flickers, and it fits the canvas', () => {
  let changes = 0;
  const widest = { en: 0, zh: 0 };
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 8, 12, 16, 20, 22]) {
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
          assert.ok(/[一-鿿]/.test(st.line.zh));
          const width = [...st.line[lang]].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? 14 : 8), 0);
          widest[lang] = Math.max(widest[lang], width);
        },
      });
    }
  assert.ok(changes > 100, `only ${changes} prompt changes observed`);
  assert.ok(widest.en <= 440 && widest.zh <= 440, JSON.stringify(widest));
});

test('English and Chinese runs play out identically', () => {
  for (const level of [2, 7, 11, 15, 19]) {
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
  const st = g.getState();
  return won(st, level);
}
const wait = function* (n) {
  for (let i = 0; i < n; i++) yield [];
};
const frames = (seconds, hz = 20) => Math.max(1, Math.round(seconds * hz));

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
      const pool = ['Space', 'Space', 'KeyX', 'KeyZ', ...ARROWS, ...ARROWS];
      for (;;) {
        yield [pool[Math.floor(r() * pool.length)]];
        yield* wait(frames(0.3 + r() * 1.2));
      }
    })(),
  quickRandom: (seed) =>
    (function* () {
      const r = seeded(seed + 21);
      const pool = ['Space', 'Space', 'KeyX', ...ARROWS, ...ARROWS];
      for (;;) {
        yield [pool[Math.floor(r() * pool.length)]];
        yield* wait(frames(0.1 + r() * 0.3));
      }
    })(),
  xAndUndo: () =>
    (function* () {
      for (;;) {
        yield ['KeyX'];
        yield* wait(frames(0.4));
        yield ['KeyZ'];
        yield* wait(frames(0.4));
      }
    })(),
  // Rotate everything: visit every cell in order, turning whatever is there, again and again.
  rotateAllRows: (seed, read) => sweep(read, 'rows', 0.2 + (seed % 3) * 0.15),
  rotateAllColumns: (seed, read) => sweep(read, 'columns', 0.2 + (seed % 3) * 0.15),
  rotateAllBackwards: (seed, read) => sweep(read, 'back', 0.25),
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
        const c = read().cursor;
        const key =
          c.x < x
            ? 'ArrowRight'
            : c.x > x
              ? 'ArrowLeft'
              : c.y < y
                ? 'ArrowDown'
                : c.y > y
                  ? 'ArrowUp'
                  : null;
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
test('idle never wins a room', () => {
  for (let level = 1; level <= ROOM_COUNT; level++)
    assert.equal(playPolicy(level, 1, POLICIES.idle, { seconds: 10 }), false, `room ${level}`);
});

test('from room 3 on, mashing, random keys, X and undo spam and rotate-everything sweeps each win at most a quarter of runs', (t) => {
  const failures = {};
  const table = {};
  for (const [name, make] of Object.entries(POLICIES)) {
    if (name === 'idle') continue;
    table[name] = [];
    for (let level = 3; level <= ROOM_COUNT; level++) {
      let n = 0;
      for (let seed = 1; seed <= PROBE; seed++)
        if (playPolicy(level, seed + level * 100, make)) n++;
      table[name].push(n);
      if (n > PROBE / 4) (failures[name] ??= []).push(`room ${level} ${rate(n, PROBE)}`);
    }
  }
  for (const [name, row] of Object.entries(table))
    t.diagnostic(`${name.padEnd(18)} wins of ${PROBE} in rooms 3-${ROOM_COUNT}: ${row.join(' ')}`);
  assert.deepEqual(failures, {}, JSON.stringify(table));
});

// The blind but sensible player: "turn whichever mirror makes more sensors light up", trying each
// switch and undoing it when it does not help. `penaliseCrystals` also counts a lit crystal as a loss.
function* greedy(read, { penaliseCrystals, best }) {
  const score = (s) => s.lit.filter(Boolean).length - (penaliseCrystals ? s.crystalsLit : 0);
  const goTo = function* (x, y) {
    for (;;) {
      const c = read().cursor;
      const key =
        c.x < x
          ? 'ArrowRight'
          : c.x > x
            ? 'ArrowLeft'
            : c.y < y
              ? 'ArrowDown'
              : c.y > y
                ? 'ArrowUp'
                : null;
      if (!key) return;
      yield [key];
    }
  };
  for (;;) {
    const st = read();
    if (st.solved) {
      yield [];
      continue;
    }
    const cells = [];
    st.board.forEach((row, y) =>
      [...row].forEach((ch, x) => '/\\st=_'.includes(ch) && cells.push([x, y])),
    );
    let base = score(st);
    let top = null;
    for (const [x, y] of cells) {
      yield* goTo(x, y);
      const key = read().board[y][x] === '=' || read().board[y][x] === '_' ? 'KeyX' : 'Space';
      yield [key];
      const gain = score(read()) - base;
      if (!best && gain > 0) {
        base += gain; // keep it and carry on from the improved board
        continue;
      }
      if (best && gain > 0 && (!top || gain > top.gain)) top = { x, y, key, gain };
      yield ['KeyZ'];
    }
    if (best && top) {
      yield* goTo(top.x, top.y);
      yield [top.key];
    } else if (best || score(read()) <= score(st)) {
      for (;;) yield [];
    }
  }
}
const GREEDY = {
  firstGain: (seed, read) => greedy(read, { penaliseCrystals: false, best: false }),
  firstGainSafe: (seed, read) => greedy(read, { penaliseCrystals: true, best: false }),
  bestGain: (seed, read) => greedy(read, { penaliseCrystals: false, best: true }),
  bestGainSafe: (seed, read) => greedy(read, { penaliseCrystals: true, best: true }),
};
test('the blind "turn whichever mirror lights more sensors" heuristic beats at most half the rooms and none of the last third', (t) => {
  const lastThird = Math.ceil((ROOM_COUNT * 2) / 3);
  const report = {};
  for (const [name, make] of Object.entries(GREEDY)) {
    const beaten = [];
    for (let level = 1; level <= ROOM_COUNT; level++)
      if (playPolicy(level, level, make, { hz: 20, seconds: 120 })) beaten.push(level);
    report[name] = beaten;
    t.diagnostic(`${name} beat rooms: ${beaten.join(' ') || 'none'}`);
    assert.ok(beaten.length <= ROOM_COUNT / 2, `${name} beat rooms ${beaten}`);
    assert.deepEqual(
      beaten.filter((l) => l > lastThird),
      [],
      `${name} beat a room in the last third`,
    );
  }
  assert.ok(report.firstGain.includes(1), 'the heuristic should at least solve the tutorial room');
});

test('the optimal turn counts form a difficulty curve with no room needing fewer than the first', (t) => {
  const curve = ROOMS.map((r) => solveRoom(r).optimal);
  t.diagnostic(`optimal turns per room: ${curve.join(' ')}`);
  assert.equal(Math.min(...curve), curve[0]);
  assert.ok(curve[ROOM_COUNT - 1] >= 8 * curve[0]);
  const ordered = ROOMS.filter((r) => r.ordered).length;
  const budget = ROOMS.filter((r) => r.budget !== null).length;
  t.diagnostic(`ordered rooms ${ordered}, budget rooms ${budget}`);
  assert.ok(solveRoom(ROOMS[0]).wins >= 1);
  // The later rooms have far fewer solved settings than settings: guessing is hopeless.
  for (let i = 9; i < ROOM_COUNT; i++) {
    const sol = solveRoom(ROOMS[i]);
    assert.ok(sol.wins / 2 ** ROOMS[i].toggles.length <= 0.05, `room ${i + 1}`);
  }
});

// The batch-literal follower reads "Move cursor -> N", presses that arrow exactly N times and then
// reads the prompt again. The number must therefore be the length of the leg along the arrow.
test('a batch-literal follower (press the arrow exactly N times, then re-read) clears every room, from the start and from scrambles', () => {
  const batch = (g, level) => {
    for (let f = 0; f < 4000; f++) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const move = /^Move cursor ([←→↑↓]) (\d+)/.exec(st.line.en);
      if (move)
        for (let i = 0; i < Number(move[2]); i++) g.update(1 / 30, input([], [EN_ARROW[move[1]]]));
      else g.update(1 / 30, input([], [keyFor(st.line.en, 'en')].filter(Boolean)));
    }
    return won(g.getState(), level);
  };
  for (let level = 1; level <= ROOM_COUNT; level++) {
    assert.ok(batch(open(level).g, level), `room ${level} from the start`);
    let done = 0;
    for (let seed = 1; done < 4 && seed < 100; seed++) {
      const s = scrambled(level, seed + level * 500);
      if (!s) continue;
      done++;
      assert.ok(batch(s.g, level), `room ${level} scramble ${seed}`);
    }
    assert.equal(done, 4);
  }
});

// The reviewer-style player: pick a random real switch, walk to it, turn it and look for a second.
function informedRandom(level, seed, observe = 1, seconds = 120, hz = 20) {
  const { g } = open(level, { seed });
  const room = ROOMS[level - 1];
  const r = seeded(seed * 31 + level);
  let t = 0;
  const alive = () => {
    const st = g.getState();
    return st.phase === 'playing' && st.level === level;
  };
  const wait = (secs) => {
    for (let i = 0; i < Math.round(secs * hz) && t < seconds && alive(); i++, t += 1 / hz)
      g.update(1 / hz, input());
  };
  while (t < seconds && alive()) {
    const ci = room.toggles[Math.floor(r() * room.toggles.length)];
    const tx = ci % room.w;
    const ty = Math.floor(ci / room.w);
    while (t < seconds && alive()) {
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
      g.update(1 / hz, input([], [key]));
      t += 1 / hz;
      wait(0.25);
    }
    if (!alive()) break;
    g.update(1 / hz, input([], [room.cells[ci].k === 'shutter' ? 'KeyX' : 'Space']));
    t += 1 / hz;
    wait(observe);
  }
  return won(g.getState(), level);
}

// A model of the beam-aware hill climber: it scores every setting by sensors lit, a lit crystal and
// the distance from the beam to the next unlit sensor, keeps any turn that raises the score and
// makes a random turn when none does. Time is charged for walking, turning and looking.
function beamGreedy(room, seed, index, cap = 300) {
  const k = room.toggles.length;
  const e = room.emitters[0];
  const table = [];
  for (let m = 0; m < 1 << k; m++) {
    const t = traceBeam(room, m);
    const next = t.lit.findIndex((n) => n < 0);
    let near = 0;
    if (next >= 0) {
      const ti = room.cells.findIndex((c) => c.k === 'sensor' && c.n === next + 1);
      near = Math.min(
        ...t.steps.map(
          (s) => Math.abs(s.x - (ti % room.w)) + Math.abs(s.y - Math.floor(ti / room.w)),
        ),
        99,
      );
    }
    table.push({ solved: t.solved, score: t.litCount * 100 - (t.crystals.length ? 50 : 0) - near });
  }
  const at = (i) => [room.toggles[i] % room.w, Math.floor(room.toggles[i] / room.w)];
  const r = seeded(seed * 131 + index);
  let bits = 0;
  let cur = [e.x, e.y];
  let time = 0;
  const visit = (i) => {
    const p = at(i);
    time += 0.3 * (Math.abs(p[0] - cur[0]) + Math.abs(p[1] - cur[1])) + 1;
    cur = p;
  };
  while (time < cap) {
    if (table[bits].solved) return true;
    let improved = false;
    const order = [...Array(k).keys()].sort(() => r() - 0.5);
    for (const i of order) {
      visit(i);
      const nb = bits ^ (1 << i);
      if (table[nb].solved) return true;
      if (table[nb].score > table[bits].score) {
        bits = nb;
        improved = true;
        break;
      }
      time += 0.5;
      if (time >= cap) return false;
    }
    if (!improved) {
      const i = Math.floor(r() * k);
      visit(i);
      bits ^= 1 << i;
    }
  }
  return false;
}

test('rooms 1 to 5 are the recorded tutorials; from room 6 on every room has at least 9 switches, all of them live', () => {
  ROOMS.forEach((room, i) => {
    if (i < TUTORIALS) assert.ok(room.toggles.length <= 4, `tutorial room ${i + 1}`);
    else assert.ok(room.toggles.length >= 9 && solveRoom(room).wins === 1, `room ${i + 1}`);
  });
});

test('the informed random turner (random real switch, walk, turn, look for a second) wins at most 10 of 40 on every room from room 6', (t) => {
  const row = [];
  for (let level = TUTORIALS + 1; level <= ROOM_COUNT; level++) {
    let n = 0;
    for (let seed = 1; seed <= PROBE; seed++) if (informedRandom(level, seed)) n++;
    row.push(n);
    assert.ok(n <= PROBE / 4, `room ${level}: ${n}/${PROBE} (${row.join(' ')})`);
  }
  t.diagnostic(`informed random turner, rooms 6-${ROOM_COUNT}, wins of ${PROBE}: ${row.join(' ')}`);
});

test('the beam-aware hill climber beats at most half the rooms and none of rooms 16 to 22', (t) => {
  const beaten = [];
  const rates = [];
  ROOMS.forEach((room, i) => {
    let n = 0;
    for (let seed = 1; seed <= PROBE; seed++) if (beamGreedy(room, seed, i)) n++;
    rates.push(n);
    if (n * 2 > PROBE) beaten.push(i + 1);
    if (i >= 15) assert.equal(n, 0, `room ${i + 1}: ${n}/${PROBE}`);
  });
  t.diagnostic(`beam-aware hill climber wins of ${PROBE} per room: ${rates.join(' ')}`);
  assert.ok(beaten.length <= ROOM_COUNT / 2, `beat rooms ${beaten}`);
});

// ---------------------------------------------------------------------------------------------
// Touch and layout
// ---------------------------------------------------------------------------------------------
test('touch targets stay large on a 390 px wide phone and every action has a touch route', () => {
  const scale = 390 / 480;
  assert.ok(RULES.cell * scale >= 28, `cells are ${RULES.cell * scale}px on a phone`);
  assert.ok(64 * scale >= 44 && 44 * scale >= 34, 'menu tiles');
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyX',
    'KeyZ',
    'KeyQ',
    'KeyH',
  ])
    assert.ok(codes.includes(code), code);
  assert.ok(meta.touchControls.every((c) => c.side === 'left' || c.side === 'right'));
  for (const room of ROOMS) assert.ok(room.w * RULES.cell <= 480 && room.h * RULES.cell <= 252);
});

test('a phone player can finish a room with taps alone: tap to select, tap again to turn', () => {
  for (const level of [1, 2, 5, 9]) {
    const { g } = open(level);
    const room = ROOMS[level - 1];
    const ox = Math.floor((480 - room.w * RULES.cell) / 2);
    const oy = 44 + Math.floor((248 - room.h * RULES.cell) / 2);
    const tap = (x, y) =>
      g.update(
        1 / 60,
        input([], [], { x: ox + x * RULES.cell + 18, y: oy + y * RULES.cell + 18, clicked: true }),
      );
    for (let n = 0; n < 40 && !g.getState().solved; n++) {
      if (!g.getState().hint.shown) g.update(1 / 60, input([], ['KeyH'])); // the touch Hint button
      const h = g.getState().hint;
      tap(h.x, h.y);
    }
    assert.equal(g.getState().solved, true, `room ${level}`);
    for (let n = 0; n < 240; n++) g.update(1 / 60, input());
    assert.ok(g.getState().level > level || level === ROOM_COUNT);
  }
});
