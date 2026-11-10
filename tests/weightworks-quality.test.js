import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MACHINES,
  MACHINE_COUNT,
  RULES,
  meta,
  createGame,
  evaluate,
  solveMachine,
  layoutOf,
  cellRect,
} from '../src/games/weightworks.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt line, the
// board, the cursor, the tray and the move counter. They press only public keys or tap the canvas.
// ---------------------------------------------------------------------------------------------
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const HZS = [30, 60, 120];
const MAX_SECONDS = 240;
const TUTORIALS = 4; // machines 1 to 4 teach the controls and are exempt from the informed-random bar
const PROBE = 40; // runs per machine and policy in the depth gates
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

// What a person does for the line they read: an arrow, Space, X, Z, or nothing.
function keyFor(line, lang) {
  if (lang === 'zh') {
    const move = /^光标向(.)移/.exec(line);
    if (move) return ZH_ARROW[move[1]];
    if (/^按空格/.test(line)) return 'Space';
    if (/^按 X/.test(line)) return 'KeyX';
    if (/按 Z/.test(line)) return 'KeyZ';
    if (/\[H\] 提示/.test(line)) return 'KeyH';
    return null;
  }
  const move = /^Move ([←→↑↓])/.exec(line);
  if (move) return EN_ARROW[move[1]];
  if (/^Space:/.test(line)) return 'Space';
  if (/^X:/.test(line)) return 'KeyX';
  if (/press Z/.test(line)) return 'KeyZ';
  if (/\[H\] hint/.test(line)) return 'KeyH';
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

// A slow reader: it acts on the line it sees once that line has stayed unchanged for `delay` seconds
// (a person looking at the screen, thinking, then pressing), and looks again after the same time.
function patient(delay, lang) {
  let seen = { text: null, since: 0, acted: -9 };
  return (st, t) => {
    const text = st.line[lang];
    if (text !== seen.text) seen = { text, since: t, acted: -9 };
    const key = keyFor(text, lang);
    if (!key || t - seen.since < delay || t - seen.acted < delay) return [];
    seen.acted = t;
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

// A mistaken or scrambled start: a few random cursor moves, places and picks through the real
// controls. Returns null when the scramble already ended, solved or exhausted the machine.
function scrambled(level, seed, lang = 'en') {
  const { g, h } = open(level, { seed, lang });
  const r = seeded(seed * 131 + level);
  const pool = [...ARROWS, ...ARROWS, 'Space', 'Space', 'Space', 'KeyX'];
  for (let n = 0; n < 4 + Math.floor(r() * 8); n++) {
    const before = g.getState();
    g.update(1 / 60, input([], [pool[Math.floor(r() * pool.length)]]));
    const after = g.getState();
    if (after.phase !== 'playing' || after.movesLeft === 0 || after.solved) return null;
    if (after.moves < before.moves) return null;
  }
  return { g, h };
}

// ---------------------------------------------------------------------------------------------
// Prompt followers
// ---------------------------------------------------------------------------------------------
test('a literal prompt follower clears every machine from the start at 30, 60 and 120 Hz in both languages', () => {
  let slowest = 0;
  for (let level = 1; level <= MACHINE_COUNT; level++)
    for (const hz of HZS)
      for (const lang of ['en', 'zh']) {
        const { g, h } = open(level, { lang });
        const r = play({ g, h, level, hz, lang, decide: follower(level % 2 ? 0.2 : 0.5, lang) });
        slowest = Math.max(slowest, r.t);
        assert.ok(
          r.cleared,
          `machine ${level} ${hz}Hz ${lang}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
        );
        assert.equal(h.ends.filter((e) => !e.won).length, 0, `machine ${level} ended in a loss`);
      }
  assert.ok(slowest < MAX_SECONDS);
});

test('followers with fast (0.15-0.35 s) and slow (0.4-0.6 s) reactions clear every machine from the start in every run', () => {
  for (const [range, name] of [
    [FAST, 'fast'],
    [SLOW, 'slow'],
  ])
    for (let level = 1; level <= MACHINE_COUNT; level++)
      for (let seed = 1; seed <= 6; seed++) {
        const lag = range[0] + seeded(seed * 7919 + level)() * (range[1] - range[0]);
        const { g, h } = open(level, { seed });
        const r = play({ g, h, level, hz: HZS[seed % 3], decide: follower(lag, 'en') });
        assert.ok(r.cleared, `${name} machine ${level} seed ${seed} lag ${lag.toFixed(2)}`);
      }
});

test('a follower clears every machine from at least 10 random mistaken states, with no livelock and never a lost run', () => {
  let runs = 0;
  let undos = 0;
  let slowest = 0;
  for (let level = 1; level <= MACHINE_COUNT; level++) {
    let done = 0;
    for (let seed = 1; done < 10 && seed < 300; seed++) {
      const s = scrambled(level, seed + level * 1000);
      if (!s) continue;
      done++;
      const lag = (seed % 2 ? FAST : SLOW)[0] + (seed % 5) * 0.05;
      const r = play({ ...s, level, hz: HZS[seed % 3], decide: follower(lag, 'en') });
      runs++;
      slowest = Math.max(slowest, r.t);
      undos += r.st.undos;
      assert.ok(
        r.cleared,
        `machine ${level} scramble ${seed}: ${r.st.phase} after ${r.t.toFixed(1)}s`,
      );
      assert.equal(s.h.ends.filter((e) => !e.won).length, 0);
    }
    assert.equal(done, 10, `machine ${level} produced only ${done} usable scrambles`);
  }
  assert.ok(runs >= MACHINE_COUNT * 10);
  assert.ok(undos > 0, 'some recoveries used an undo');
  assert.ok(slowest < MAX_SECONDS);
});

test('a follower never loses a budget machine, even after wasting moves, because the prompt asks for an undo', () => {
  let undoPrompts = 0;
  for (let level = 1; level <= MACHINE_COUNT; level++) {
    const mach = MACHINES[level - 1];
    if (mach.budget === null) continue;
    for (let seed = 1; seed <= 12; seed++) {
      const { g, h } = open(level, { seed });
      // Waste moves: put the selected mass on a peg and take it off again, one more than the slack.
      const spare = mach.budget - solveMachine(mach).optimal;
      const r = seeded(seed);
      const wasted = Math.min(spare + 1 + (seed % 2), mach.budget - 1);
      for (let n = 0; n < wasted;) {
        const before = g.getState().moves;
        g.update(1 / 60, input([], ['Space']));
        if (g.getState().moves > before) n++;
        else g.update(1 / 60, input([], [r() < 0.5 ? 'ArrowRight' : 'ArrowLeft']));
      }
      if (g.getState().movesLeft === 0 && !g.getState().solved) {
        // Wasted everything: the prompt must already be asking for an undo.
        assert.match(g.getState().line.en, /press Z/);
      }
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
      assert.ok(out.cleared, `machine ${level} wasted ${wasted}: ${out.st.phase}`);
      assert.equal(h.ends.filter((e) => !e.won).length, 0);
    }
  }
  assert.ok(undoPrompts > 0, 'the undo prompt should have been needed at least once');
});

test('a follower with a 1.5 s reaction is still saved by the undo prompt when every move is spent', () => {
  let saved = 0;
  for (let level = 3; level <= MACHINE_COUNT; level++) {
    const mach = MACHINES[level - 1];
    const { g, h } = open(level, { seed: level });
    // Spend every move on the first mass in the tray, hopping along the first beam.
    for (let n = 0; n < 60 && g.getState().movesLeft > 0; n++) {
      g.update(1 / 60, input([], [n % 5 === 4 ? 'ArrowLeft' : 'ArrowRight']));
      g.update(1 / 60, input([], ['Space']));
    }
    const st = g.getState();
    if (st.phase !== 'playing' || st.solved || st.movesLeft !== 0) continue;
    saved++;
    // From the first unguided machine on, the undo advice comes with a hint; the countdown shows it anyway.
    if (level <= RULES.hintFreeMachines) assert.match(st.line.en, /press Z/, `machine ${level}`);
    else assert.notEqual(st.graceLeft, null, `machine ${level}`);
    const out = play({ g, h, level, hz: 60, decide: patient(1.5, 'en') });
    assert.ok(out.cleared, `machine ${level} with every move spent`);
    assert.ok(mach.budget !== null);
  }
  assert.ok(saved >= 8, `only ${saved} machines reached zero moves`);
});

test('the prompt names its action, and the text, the arrow and the highlighted peg always agree', () => {
  let checked = 0;
  let verticals = 0;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 5, 8, 12, 16, 17, 19, 20, 24]) {
      const { g } = open(level, { lang });
      const mach = MACHINES[level - 1];
      play({
        g,
        level,
        hz: 60,
        lang,
        decide: follower(0.2, lang),
        onFrame: (st) => {
          const h = st.hint;
          const key = keyFor(st.line[lang], lang);
          // A hidden hint reads as the goal plus the key that buys the next move.
          const expectedKey = h.kind === 'hidden' ? 'KeyH' : h.key;
          assert.equal(key, expectedKey, `machine ${level}: "${st.line[lang]}" vs ${h.key}`);
          assert.equal(st.prompt[lang], st.line[lang]);
          assert.equal(st.prompt.id, h.kind);
          if (h.kind === 'move') {
            const dr = h.row - st.cursor.row;
            const dc = h.col - st.cursor.col;
            assert.ok(dr !== 0 || dc !== 0);
            // Vertical legs come first, and the number is the length of the first leg.
            const expected =
              dr > 0 ? 'ArrowDown' : dr < 0 ? 'ArrowUp' : dc > 0 ? 'ArrowRight' : 'ArrowLeft';
            assert.equal(h.key, expected);
            assert.equal(h.steps, dr !== 0 ? Math.abs(dr) : Math.abs(dc));
            assert.ok(st.line[lang].includes(` ${h.steps} `));
            // A vertical step names only the beam it reaches; a step along a beam names the peg.
            const label = 'ABC'[h.beam];
            const sign = h.pos > 0 ? `+${h.pos}` : String(h.pos);
            if (dr !== 0) {
              assert.ok(st.line[lang].endsWith(lang === 'en' ? `beam ${label}` : `${label} 梁`));
              assert.ok(!st.line[lang].includes(sign));
              verticals++;
            } else
              assert.ok(
                st.line[lang].includes(`${label} ${lang === 'en' ? 'peg ' : ''}`.trim()) &&
                  st.line[lang].includes(sign),
              );
          }
          if (h.kind === 'place' || h.kind === 'pick') {
            assert.deepEqual([h.row, h.col], [st.cursor.row, st.cursor.col]);
            assert.equal(h.key, 'Space');
            const peg = mach.beams[h.row].pegs[h.col];
            assert.equal(peg, h.pos);
            const sign = peg > 0 ? `+${peg}` : String(peg);
            assert.ok(st.line[lang].includes(sign));
            assert.ok(st.line[lang].includes(`${h.mass} ${lang === 'zh' ? '千克' : 'kg'}`));
            if (h.kind === 'place') {
              assert.equal(st.weights[st.sel].mass, h.mass, 'the selected mass is the one named');
              assert.equal(st.sel, h.weight);
            } else assert.equal(st.weights[h.weight].where >= 0, true);
          }
          if (h.kind === 'rotate') {
            assert.ok(st.weights[h.weight].where < 0, 'the named mass is in the tray');
            assert.notEqual(st.sel, h.weight);
            assert.ok(st.line[lang].includes(`${h.mass} ${lang === 'zh' ? '千克' : 'kg'}`));
            assert.equal(h.presses > 1, /\d+ (presses|次)/.test(st.line[lang]));
            const wanted = st.weights[h.weight];
            if (wanted.rail >= 0) assert.ok(/slider|滑块/.test(st.line[lang]));
            // An equal weight is already selected: the text must say which other mass is meant.
            if (st.weights[st.sel].mass === h.mass) {
              assert.ok(/slider|plain|滑块|普通/.test(st.line[lang]), st.line[lang]);
            }
          }
          assert.ok(st.status[lang].endsWith(st.line[lang]));
          if (lang === 'zh') assert.ok(!/kg/.test(st.line.zh), st.line.zh);
          checked++;
        },
      });
    }
  assert.ok(checked > 500, `only ${checked} frames checked`);
  assert.ok(verticals > 10, `only ${verticals} vertical prompts`);
});

test('the prompt only changes when the player acts or a machine changes, never flickers, and fits the canvas', () => {
  let changes = 0;
  const widest = { en: 0, zh: 0 };
  let minHold = Infinity;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 8, 12, 16, 20, 24]) {
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
              if (!lastKeys) minHold = Math.min(minHold, t - since);
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
  assert.ok(minHold >= 0.5 - 1e-6, `shortest hold ${minHold}`);
  assert.ok(widest.en <= 440 && widest.zh <= 440, JSON.stringify(widest));
});

test('an idle player never sees the prompt change, at any frame rate', () => {
  for (const level of [1, 6, 15, 24])
    for (const hz of HZS) {
      const { g } = open(level);
      const first = JSON.stringify([g.getState().line, g.getState().hint]);
      for (let f = 0; f < hz * 3; f++) {
        g.update(1 / hz, input());
        assert.equal(JSON.stringify([g.getState().line, g.getState().hint]), first);
      }
    }
});

test('English and Chinese runs play out identically', () => {
  for (const level of [2, 7, 11, 15, 19, 24]) {
    const a = open(level, { lang: 'en' });
    const b = open(level, { lang: 'zh' });
    const fa = follower(0.25, 'en');
    const fb = follower(0.25, 'zh');
    for (let f = 0; f < 60 * 60; f++) {
      const t = f / 60;
      const sa = a.g.getState();
      const sb = b.g.getState();
      assert.deepEqual(sa.hint, sb.hint);
      assert.deepEqual(sa.board, sb.board);
      assert.equal(sa.level, sb.level);
      assert.equal(sa.moves, sb.moves);
      if (sa.phase !== 'playing' || sa.level !== level) break;
      a.g.update(1 / 60, input([], fa(sa, t)));
      b.g.update(1 / 60, input([], fb(sb, t)));
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------------------------
const center = (mach, row, col) => {
  const r = cellRect(layoutOf(mach), mach, row, col);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

test('a touch-only player clears every machine by tapping the highlighted peg or tray mass', () => {
  for (let level = 1; level <= MACHINE_COUNT; level++) {
    const { g, h } = open(level);
    const mach = MACHINES[level - 1];
    let taps = 0;
    for (let f = 0; f < 60 * 120; f++) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const hint = st.hint;
      let pointer = null;
      let keys = [];
      if (f % 20 === 0) {
        if (hint.kind === 'rotate') pointer = center(mach, mach.beams.length, hint.weight);
        else if (hint.kind === 'move' || hint.kind === 'place' || hint.kind === 'pick')
          pointer = center(mach, hint.row ?? 0, hint.col ?? 0);
        else if (hint.kind === 'undo') keys = ['KeyZ'];
        else if (hint.kind === 'hidden') keys = ['KeyH'];
      }
      if (pointer) taps++;
      g.update(1 / 60, input([], keys, pointer ? { ...pointer, clicked: true } : {}));
    }
    assert.ok(won(g.getState(), level), `machine ${level} by touch`);
    assert.equal(h.ends.filter((e) => !e.won).length, 0);
    assert.ok(taps > 0);
  }
});

test('touch targets stay large on a 390 px wide phone and every action has a touch route', () => {
  const scale = 390 / 480;
  for (const mach of MACHINES) {
    const lay = layoutOf(mach);
    mach.beams.forEach((b, row) =>
      b.pegs.forEach((_, col) => {
        const r = cellRect(lay, mach, row, col);
        assert.ok(r.w * scale >= 28, `peg cell width ${r.w * scale}`);
        assert.ok(r.h * scale >= 40, `peg cell height ${r.h * scale}`);
      }),
    );
    for (const chip of lay.chips) assert.ok(chip.w * scale >= 27 && chip.h * scale >= 27);
    for (const r of lay.rows) assert.ok(r.cx - r.half >= 30 && r.cx + r.half <= 444);
  }
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
  assert.equal(meta.touchControls.length, 9);
});

// ---------------------------------------------------------------------------------------------
// Depth: crude players lose, a sensible but blind player is not enough
// ---------------------------------------------------------------------------------------------
function playPolicy(level, seed, make, { hz = 20, seconds = 120 } = {}) {
  const { g } = open(level, { seed });
  const gen = make(seed, () => g.getState(), level);
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

// Walk the cursor to a cell (row, col) with arrow keys, one press per `pace` seconds.
function* walkTo(read, row, col, pace) {
  for (let guard = 0; guard < 60; guard++) {
    const c = read().cursor;
    const key =
      c.row < row
        ? 'ArrowDown'
        : c.row > row
          ? 'ArrowUp'
          : c.col < col
            ? 'ArrowRight'
            : c.col > col
              ? 'ArrowLeft'
              : null;
    if (!key) return;
    yield [key];
    yield* wait(frames(pace));
  }
}

function* sweep(read, order, pace) {
  for (;;) {
    const st = read();
    const cells = [];
    st.beams.forEach((b, row) => b.pegs.forEach((_, col) => cells.push([row, col])));
    if (order === 'columns') cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (order === 'back') cells.reverse();
    for (const [row, col] of cells) {
      yield* walkTo(read, row, col, pace);
      yield ['Space'];
      yield* wait(frames(pace));
    }
  }
}

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
  slowRandom: (seed) =>
    (function* () {
      const r = seeded(seed + 33);
      const pool = ['Space', 'Space', 'Space', 'KeyX', ...ARROWS, ...ARROWS];
      for (;;) {
        yield [pool[Math.floor(r() * pool.length)]];
        yield* wait(frames(1.1 + r() * 1.5));
      }
    })(),
  undoSpam: () =>
    (function* () {
      for (;;) {
        yield ['Space'];
        yield* wait(frames(0.4));
        yield ['KeyZ'];
        yield* wait(frames(0.4));
      }
    })(),
  rotateAndPlace: (seed) =>
    (function* () {
      const r = seeded(seed + 5);
      for (;;) {
        yield ['KeyX'];
        yield* wait(frames(0.3));
        yield [ARROWS[Math.floor(r() * 4)]];
        yield* wait(frames(0.3));
        yield ['Space'];
        yield* wait(frames(0.6));
      }
    })(),
  sweepRows: (seed, read) => sweep(read, 'rows', 0.2 + (seed % 3) * 0.15),
  sweepColumns: (seed, read) => sweep(read, 'columns', 0.2 + (seed % 3) * 0.15),
  sweepBackwards: (seed, read) => sweep(read, 'back', 0.25),
};

const rate = (n, total) => `${n}/${total}`;
test('idle never wins a machine', () => {
  for (let level = 1; level <= MACHINE_COUNT; level++)
    assert.equal(playPolicy(level, 1, POLICIES.idle, { seconds: 10 }), false, `machine ${level}`);
});

test('from machine 3 on, mashing, random keys, undo spam and sweeps each win at most a quarter of runs', (t) => {
  const failures = {};
  const table = {};
  for (const [name, make] of Object.entries(POLICIES)) {
    if (name === 'idle') continue;
    table[name] = [];
    for (let level = 3; level <= MACHINE_COUNT; level++) {
      let n = 0;
      for (let seed = 1; seed <= PROBE; seed++)
        if (playPolicy(level, seed + level * 100, make)) n++;
      table[name].push(n);
      if (n > PROBE / 4) (failures[name] ??= []).push(`machine ${level} ${rate(n, PROBE)}`);
    }
  }
  for (const [name, row] of Object.entries(table))
    t.diagnostic(
      `${name.padEnd(16)} wins of ${PROBE} in machines 3-${MACHINE_COUNT}: ${row.join(' ')}`,
    );
  assert.deepEqual(failures, {}, JSON.stringify(table));
});

// ---------------------------------------------------------------------------------------------
// The blind but sensible player: "place the mass that most reduces the total gate error".
// ---------------------------------------------------------------------------------------------
function gateError(mach, where) {
  const ev = evaluate(mach, where);
  let error = 0;
  mach.beams.forEach((b, i) => {
    const tau = ev.tau[i];
    if (b.gate === '=') error += Math.abs(tau) + (ev.mass[i] === 0 ? 1 : 0);
    else if (b.gate === '<') error += tau < 0 ? 0 : tau + 1;
    else error += tau > 0 ? 0 : 1 - tau;
  });
  return error;
}

function freeSlots(mach, where, w) {
  const taken = new Set(where.filter((id) => id >= 0));
  const rail = mach.weights[w].rail;
  return mach.slots
    .map((_, id) => id)
    .filter(
      (id) => mach.usable[id] && !taken.has(id) && (rail < 0 || mach.slots[id].beam === rail),
    );
}

// Drive the real game: rotate the tray to `w`, walk to its peg, press Space.
function* doPlace(read, mach, w, id) {
  const { beam, pos } = mach.slots[id];
  const col = mach.beams[beam].pegs.indexOf(pos);
  for (let guard = 0; guard < 12 && read().sel !== w; guard++) {
    yield ['KeyX'];
    yield* wait(2);
  }
  yield* walkTo(read, beam, col, 0.1);
  yield ['Space'];
  yield* wait(2);
}
function* doPick(read, mach, id) {
  const { beam, pos } = mach.slots[id];
  yield* walkTo(read, beam, mach.beams[beam].pegs.indexOf(pos), 0.1);
  yield ['Space'];
  yield* wait(2);
}

// `climb` lets it also lift one mass and put it somewhere better when the tray is empty.
function* greedyPlayer(seed, read, level, climb) {
  const mach = MACHINES[level - 1];
  const r = seeded(seed * 977 + level);
  for (;;) {
    const st = read();
    const where = st.weights.map((x) => x.where);
    if (st.level !== level || st.solved || st.movesLeft === 0) {
      yield [];
      continue;
    }
    const here = gateError(mach, where);
    let best = [];
    let bestError = Infinity;
    const consider = (w, id, lift) => {
      const next = where.map((x, k) => (k === w ? id : x));
      const error = gateError(mach, next);
      if (error < bestError) [bestError, best] = [error, [{ w, id, lift }]];
      else if (error === bestError) best.push({ w, id, lift });
    };
    where.forEach((slot, w) => {
      if (slot < 0) for (const id of freeSlots(mach, where, w)) consider(w, id, -1);
    });
    if (!best.length || (climb && bestError >= here)) {
      if (!climb) {
        yield [];
        continue;
      }
      best = [];
      bestError = here;
      where.forEach((slot, w) => {
        if (slot < 0) return;
        const lifted = where.map((x, k) => (k === w ? -1 : x));
        for (const id of freeSlots(mach, lifted, w)) if (id !== slot) consider(w, id, slot);
      });
      if (!best.length || bestError >= here) {
        yield [];
        continue;
      }
    }
    const choice = best[Math.floor(r() * best.length)];
    if (choice.lift >= 0) yield* doPick(read, mach, choice.lift);
    yield* doPlace(read, mach, choice.w, choice.id);
  }
}

const GREEDY = {
  placeOnly: (seed, read, level) => greedyPlayer(seed, read, level, false),
  placeAndClimb: (seed, read, level) => greedyPlayer(seed, read, level, true),
};

test('the blind "place the mass that most reduces the gate error" player beats at most half the machines and none of the last third', (t) => {
  const lastThird = Math.ceil((MACHINE_COUNT * 2) / 3);
  for (const [name, make] of Object.entries(GREEDY)) {
    const beaten = [];
    for (let level = 1; level <= MACHINE_COUNT; level++) {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++)
        if (playPolicy(level, seed + level, make, { hz: 20, seconds: 90 })) n++;
      if (n > 0) beaten.push(level);
      if (level > lastThird) assert.equal(n, 0, `${name} beat machine ${level} ${n}/6`);
    }
    t.diagnostic(`${name} beat machines: ${beaten.join(' ') || 'none'}`);
    assert.ok(beaten.length <= MACHINE_COUNT / 2, `${name} beat machines ${beaten}`);
    if (name === 'placeOnly')
      assert.ok(beaten.includes(1), 'the greedy player should solve the first machine');
  }
});

// The reviewer-style player: pick a random real peg, walk to it, place the mass there, look.
function informedRandom(level, seed, observe = 1, seconds = 240, hz = 20) {
  const { g } = open(level, { seed });
  const mach = MACHINES[level - 1];
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
  const press = (key) => {
    g.update(1 / hz, input([], [key]));
    t += 1 / hz;
    idle(0.25);
  };
  while (t < seconds && alive()) {
    const st = g.getState();
    const usable = mach.slots.map((_, id) => id).filter((id) => mach.usable[id]);
    const id = usable[Math.floor(r() * usable.length)];
    const { beam, pos } = mach.slots[id];
    const col = mach.beams[beam].pegs.indexOf(pos);
    for (let guard = 0; guard < 60 && alive(); guard++) {
      const c = g.getState().cursor;
      if (c.row === beam && c.col === col) break;
      press(
        c.row < beam
          ? 'ArrowDown'
          : c.row > beam
            ? 'ArrowUp'
            : c.col < col
              ? 'ArrowRight'
              : 'ArrowLeft',
      );
    }
    if (!alive()) break;
    if (st.sel >= 0 && r() < 0.6) for (let k = Math.floor(r() * 3); k > 0; k--) press('KeyX');
    press('Space');
    idle(observe);
  }
  return won(g.getState(), level);
}

test('the informed random placer wins at most 10 of 40 runs of 240 s on every machine from machine 3', (t) => {
  const row = [];
  for (let level = 3; level <= MACHINE_COUNT; level++) {
    let n = 0;
    for (let seed = 1; seed <= PROBE; seed++) if (informedRandom(level, seed)) n++;
    row.push(n);
    assert.ok(n <= PROBE / 4, `machine ${level}: ${n}/${PROBE} (${row.join(' ')})`);
  }
  t.diagnostic(
    `informed random placer, machines 3-${MACHINE_COUNT}, wins of ${PROBE}: ${row.join(' ')}`,
  );
});

// ---------------------------------------------------------------------------------------------
// The batch-literal follower, the difficulty curve and the machine set
// ---------------------------------------------------------------------------------------------
test('a batch-literal follower (press the arrow exactly N times, then re-read) clears every machine, from the start and from scrambles', () => {
  const batch = (g, level) => {
    for (let f = 0; f < 4000; f++) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
      const move = /^Move ([←→↑↓]) (\d+)/.exec(st.line.en);
      if (move)
        for (let i = 0; i < Number(move[2]); i++) g.update(1 / 30, input([], [EN_ARROW[move[1]]]));
      else g.update(1 / 30, input([], [keyFor(st.line.en, 'en')].filter(Boolean)));
    }
    return won(g.getState(), level);
  };
  for (let level = 1; level <= MACHINE_COUNT; level++) {
    assert.ok(batch(open(level).g, level), `machine ${level} from the start`);
    let done = 0;
    for (let seed = 1; done < 4 && seed < 200; seed++) {
      const s = scrambled(level, seed + level * 500);
      if (!s) continue;
      done++;
      assert.ok(batch(s.g, level), `machine ${level} scramble ${seed}`);
    }
    assert.equal(done, 4);
  }
});

test('the optimal move counts rise from 1, every machine is solvable within its budget, and the late machines have one solved layout', (t) => {
  const curve = MACHINES.map((m) => solveMachine(m).optimal);
  t.diagnostic(`optimal moves per machine: ${curve.join(' ')}`);
  assert.equal(curve[0], Math.min(...curve));
  assert.ok(curve[MACHINE_COUNT - 1] >= 8 * curve[0]);
  const third = Math.floor(MACHINE_COUNT / 3);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(curve.slice(0, third)) < mean(curve.slice(third, 2 * third)));
  assert.ok(mean(curve.slice(third, 2 * third)) < mean(curve.slice(2 * third)));
  curve.forEach((n, i) => i && assert.ok(n >= curve[i - 1] - 1, `machine ${i + 1} dips`));
  MACHINES.forEach((m, i) => {
    const sol = solveMachine(m);
    assert.ok(sol.count >= 1 && !sol.capped);
    if (i >= TUTORIALS)
      assert.ok(sol.count <= 8, `machine ${i + 1} has ${sol.count} solved layouts`);
    if (m.budget !== null) assert.ok(m.budget >= sol.optimal && m.budget <= sol.optimal + 3);
  });
});

test('every feature appears: tilt gates, hanging beams, locks, sliders, tippers, fixed masses and budgets', () => {
  const has = (fn) => MACHINES.filter(fn).length;
  assert.ok(has((m) => m.beams.some((b) => b.gate !== '=')) >= 5);
  assert.ok(has((m) => m.beams.some((b) => b.hang)) >= 15);
  assert.ok(has((m) => m.why.includes('locked')) >= 5);
  assert.ok(has((m) => m.weights.some((w) => w.rail >= 0)) >= 6);
  assert.ok(has((m) => m.beams.some((b) => b.tips.length)) >= 4);
  assert.ok(has((m) => m.beams.some((b) => b.fixed.length)) >= 15);
  assert.ok(has((m) => m.beams.length === 3) >= 8);
  assert.ok(has((m) => m.budget !== null) >= MACHINE_COUNT - 2);
  // Each mechanism first appears alone in a machine whose tip introduces it.
  const first = (fn) => MACHINES.findIndex(fn) + 1;
  assert.equal(
    first((m) => m.beams.some((b) => b.gate !== '=')),
    3,
  );
  assert.equal(
    first((m) => m.beams.some((b) => b.hang)),
    4,
  );
  assert.equal(
    first((m) => m.why.includes('locked')),
    6,
  );
  assert.equal(
    first((m) => m.weights.some((w) => w.rail >= 0)),
    7,
  );
  assert.equal(
    first((m) => m.beams.some((b) => b.tips.length)),
    8,
  );
  assert.equal(
    first((m) => m.beams.length === 3),
    9,
  );
});

test('a full campaign by prompt carries a player through all machines to a won run with one end call', () => {
  const { g, h } = open(1);
  const follow = follower(0.2, 'en');
  let t = 0;
  let level = 1;
  let hintsBefore = 0;
  const hintsPerMachine = [];
  for (; t < 3000 && g.getState().phase === 'playing'; t += 1 / 60) {
    const now = g.getState();
    if (now.level !== level) {
      hintsPerMachine.push(now.hints - hintsBefore);
      hintsBefore = now.hints;
      level = now.level;
    }
    g.update(1 / 60, input([], follow(now, t)));
  }
  const st = g.getState();
  hintsPerMachine.push(st.hints - hintsBefore);
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(st.score, h.ends[0].score);
  // The first machines are free; later ones cost one hint per move, down to the score floor.
  let expected = 0;
  MACHINES.forEach((m, i) => {
    const asked = i < RULES.hintFreeMachines ? 0 : solveMachine(m).optimal;
    assert.equal(hintsPerMachine[i], asked, `hints asked on machine ${i + 1}`);
    expected += Math.max(RULES.minMachineScore, RULES.clearScore - RULES.hintPenalty * asked);
  });
  assert.equal(st.score, expected);
  assert.ok(expected < MACHINE_COUNT * RULES.clearScore);
});
