// Memory Grove quality bars: every level clears, blind play fails, a delayed rememberer clears,
// frame rate does not change play, hostile input is safe, and drawing fits the canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/games/memory-grove.js';
import { LEVELS, LEVEL_COUNT } from '../src/games/memory-grove-levels.js';
import { createLevelState, stepMemory } from '../src/games/memory-grove-rules.js';
import { menuCell } from '../src/games/memory-grove-menu.js';
import { drawMemory, drawSelect, timingStrip } from '../src/games/memory-grove-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

const progressAt = (n, unlocks = []) => ({ unlocked: () => n, unlock: (v) => unlocks.push(v) });
const centre = (c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2, clicked: true });

// A scripted legal solution that reads the hidden state: proves every level is winnable.
function solve(level, hz, seed = 1) {
  const s = createLevelState(level, seeded(seed)),
    cards = LEVELS[level - 1].layout.cards,
    sound = () => {};
  for (let f = 0; f < 600 * hz && s.phase === 'playing' && s.mode !== 'level-clear'; f++) {
    let pointer = {};
    if (s.mode === 'ready') {
      const open = s.deck.map((_, i) => i).filter((i) => !s.matched[i] && !s.flipped.includes(i));
      let pick;
      if (s.rule === 'echo') pick = s.sequence[s.echo.input];
      else if (s.rule === 'route') pick = open.find((i) => s.deck[i] === s.route[s.routeIndex]);
      else pick = s.flipped.length ? open.find((i) => s.deck[i] === s.deck[s.flipped[0]]) : open[0];
      pointer = centre(cards[pick]);
    }
    stepMemory(s, 1 / hz, input([], [], pointer), sound);
  }
  return s;
}

// A reaction-limited player: it sees the public state `delay` seconds late, remembers every card
// it has seen and every cue it was shown, and acts at most once per reaction time.
function rememberer(g, hz, delay, { keys = false, limit = 400 } = {}) {
  const lag = Math.max(1, Math.round(delay * hz)),
    history = [],
    known = new Map();
  let heard = [],
    lastLit = -1,
    lastMode = '',
    cooldown = 0,
    frames = 0;
  const choose = (s) => {
    const open = s.matched
        .map((m, i) => (m || s.flipped.includes(i) ? -1 : i))
        .filter((i) => i >= 0),
      unknown = open.filter((i) => !known.has(i)),
      group = s.rule === 'triples' ? 3 : 2;
    if (s.rule === 'echo') return heard.length < s.echo.length ? -1 : heard[s.echo.input];
    const goal = s.rule === 'route' ? s.route[s.routeIndex] : undefined;
    if (s.flipped.length) {
      const symbol = known.get(s.flipped[0]);
      if (s.rule !== 'route' || symbol === goal) {
        const mate = open.find((i) => known.get(i) === symbol);
        if (mate !== undefined) return mate;
      }
      return unknown[0] ?? open[0];
    }
    for (let v = 0; v < 10; v++) {
      const wanted = s.rule === 'route' ? goal : v,
        found = open.filter((i) => known.get(i) === wanted);
      if (found.length >= (s.rule === 'route' ? 1 : group)) return found[0];
    }
    return unknown[0] ?? open[0];
  };
  return () => {
    frames++;
    history.push(g.getState());
    const s = history[Math.max(0, history.length - 1 - lag)];
    if (history.length > lag + 2) history.shift();
    s.visible.forEach((v, i) => v !== null && known.set(i, v));
    if (s.mode === 'listen' && lastMode !== 'listen') heard = [];
    if (s.lit >= 0 && s.lit !== lastLit) heard.push(s.lit);
    lastLit = s.lit;
    lastMode = s.mode;
    if (--cooldown > 0 || frames > limit * hz) return input();
    if (s.mode === 'level-clear') {
      cooldown = lag + 1;
      return input([], ['Space']);
    }
    if (s.mode !== 'ready') return input();
    const target = choose(s);
    if (target < 0) return input();
    cooldown = lag + 1;
    if (!keys) return input([], [], centre(s.cards[target]));
    const cols = s.columns,
      rows = s.cards.length / cols,
      dc = ((target % cols) - (s.cursor % cols) + cols) % cols,
      dr = (Math.floor(target / cols) - Math.floor(s.cursor / cols) + rows) % rows;
    if (!dc && !dr) return input([], ['Space']);
    if (dc) return input([], [dc <= cols / 2 ? 'ArrowRight' : 'ArrowLeft']);
    return input([], [dr <= rows / 2 ? 'ArrowDown' : 'ArrowUp']);
  };
}
function playLevel(level, { hz = 60, delay = 0.25, seed = 1, keys = false } = {}) {
  const h = harness({ seed }),
    g = createGame({ ...h.env, progress: progressAt(level) });
  if (level > 1) g.update(1 / hz, input([], ['Space']));
  const act = rememberer(g, hz, delay, { keys });
  while (g.getState().phase === 'playing' && g.getState().mode !== 'level-clear')
    g.update(1 / hz, act());
  return { state: g.getState(), h };
}

test('every level has a scripted legal clear at 30, 60 and 120 Hz', () => {
  for (let n = 1; n <= LEVEL_COUNT; n++)
    for (const hz of [30, 60, 120]) {
      const s = solve(n, hz, n);
      assert(s.mode === 'level-clear' || s.phase === 'won', `level ${n} at ${hz} Hz: ${s.mode}`);
      assert.equal(s.lives, LEVELS[n - 1].lives, `level ${n} lost no leaf`);
    }
});
test('scripted play is identical at every frame rate', () => {
  for (const n of [3, 5, 8, 10, 15, 20]) {
    const [a, b, c] = [30, 60, 120].map((hz) => solve(n, hz, 5));
    for (const other of [b, c]) {
      assert.equal(other.score, a.score);
      assert.equal(other.turns, a.turns);
      assert.equal(other.mode, a.mode);
      assert.equal(other.lives, a.lives);
      assert.equal(other.bestStreak, a.bestStreak);
    }
  }
});
test('a delayed rememberer clears every level at 0.25 s and 0.35 s, at 30, 60 and 120 Hz', () => {
  for (let n = 1; n <= LEVEL_COUNT; n++)
    for (const [delay, hz] of [
      [0.25, 60],
      [0.35, 30],
      [0.35, 120],
      [0.25, 30],
      [0.35, 60],
    ]) {
      const { state } = playLevel(n, { hz, delay, seed: n + hz });
      assert(state.mode === 'level-clear' || state.phase === 'won', `level ${n} ${delay}s ${hz}Hz`);
      if (state.lives !== null)
        assert(state.lives >= 2 || LEVELS[n - 1].echo, `level ${n} kept a margin of leaves`);
      if (state.clock) assert(state.remaining > state.clock * 0.25, `level ${n} clock margin`);
    }
});
test('the same rememberer can drive the cursor with the keyboard alone', () => {
  for (const n of [3, 12, 13, 16, 19]) {
    const { state } = playLevel(n, { hz: 60, delay: 0.35, seed: 4, keys: true });
    assert(state.mode === 'level-clear', `level ${n} by keyboard`);
    if (state.clock) assert(state.remaining > state.clock * 0.3);
  }
});
test('the rememberer clears the whole run and wins once', () => {
  const h = harness({ seed: 9 }),
    g = createGame({ ...h.env, progress: progressAt(LEVEL_COUNT - 1) });
  g.update(1 / 60, input([], ['Space']));
  const act = rememberer(g, 60, 0.25);
  for (let i = 0; i < 60 * 300 && g.getState().phase === 'playing'; i++) g.update(1 / 60, act());
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert(h.ends[0].message.includes('twenty'));
});

const POLICIES = {
  idle: () => input(),
  mash: (f) => input([], ['Space', 'Enter', f % 3 ? 'ArrowRight' : 'KeyT']),
  random: (f, r) => {
    const keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Space',
      'Enter',
      'KeyT',
      'KeyH',
      'KeyA',
    ];
    return input([], [keys[Math.floor(r() * keys.length)]]);
  },
  taps: (f, r) =>
    f % 7 === 0 ? input([], [], { x: r() * 480, y: r() * 320, clicked: true }) : input(),
  cycle: (f, r, period) => {
    const dir = Math.floor(f / period) % 2 ? 'ArrowLeft' : 'ArrowRight';
    return input([dir], f % 2 ? [dir, 'Space'] : ['Space']);
  },
};
function blindWins(policy, level, seed, period = 6) {
  const h = harness({ seed }),
    g = createGame({ ...h.env, progress: progressAt(level) }),
    rand = seeded(seed + 77);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  for (let f = 0; f < 60 * 60 && !h.ends.length; f++) {
    g.update(1 / 60, POLICIES[policy](f, rand, period));
    if (f % 30 === 0 && g.getState().level > level) return true;
  }
  return Boolean(h.ends[0]?.won) || g.getState().level > level;
}
test('idle, mash, random keys, random taps and timed patterns win at most 25% of any level from level 3', () => {
  const wins = {},
    runs = {};
  for (const policy of Object.keys(POLICIES))
    for (let n = 3; n <= LEVEL_COUNT; n++)
      for (const seed of [1, 2, 3])
        for (const period of policy === 'cycle' ? [4, 15, 40] : [0]) {
          runs[n] = (runs[n] ?? 0) + 1;
          wins[n] = (wins[n] ?? 0) + Number(blindWins(policy, n, seed, period));
        }
  for (const n of Object.keys(wins))
    assert(wins[n] <= 0.25 * runs[n], `level ${n}: ${wins[n]} of ${runs[n]} blind wins`);
  const total = Object.values(wins).reduce((a, b) => a + b, 0);
  assert(total <= 4, `${total} blind wins in all`);
});
test('an idle player cannot lose the opening of level 1', () => {
  const h = harness(),
    g = createGame(h.env);
  for (let i = 0; i < 60 * 120; i++) g.update(1 / 60, input());
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().remaining, 0);
  assert.equal(h.ends.length, 0);
});

test('hostile dt, pointer and key values never break the state', () => {
  const h = harness({ seed: 3 }),
    g = createGame({ ...h.env, progress: progressAt(3) });
  g.update(1 / 60, input([], ['Space']));
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, 'x'])
    g.update(dt, input([], ['Space', 'ArrowRight'], { x: 150, y: 150, clicked: true }));
  assert.equal(JSON.stringify(g.getState()), before);
  const odd = [NaN, Infinity, -Infinity, 1e12, -1e12, '7', null, undefined, {}];
  const rand = seeded(5);
  for (let f = 0; f < 4000; f++) {
    const p = {
      x: odd[Math.floor(rand() * odd.length)],
      y: odd[Math.floor(rand() * odd.length)],
      clicked: rand() < 0.5,
      down: rand() < 0.5,
    };
    const pressed = ['Space', 'Enter', 'KeyT', 'ArrowUp', 'KeyD'].filter(() => rand() < 0.3);
    g.update([1 / 60, 5, 1e9, 1 / 400][f % 4], input([], pressed, p));
    if (f % 500 === 0) g.draw(mockContext());
  }
  const state = JSON.parse(JSON.stringify(g.getState()));
  const finite = (v) =>
    typeof v === 'number'
      ? Number.isFinite(v)
      : v && typeof v === 'object'
        ? Object.values(v).every(finite)
        : true;
  assert(finite(state));
  assert(h.ends.length <= 1);
  g.update(1 / 60, { held: () => false, pressed: () => false });
});
test('a broken, junk or absent progress store never stops the game', () => {
  const stores = [
    undefined,
    {
      unlocked: () => {
        throw new Error('read');
      },
      unlock: () => {
        throw new Error('write');
      },
    },
    { unlocked: () => NaN, unlock() {} },
    { unlocked: () => -5, unlock() {} },
    { unlocked: () => '7', unlock() {} },
    { unlocked: () => null, unlock() {} },
    { unlocked: () => 2.9, unlock() {} },
    { unlocked: () => 9999, unlock() {} },
  ];
  const expected = [1, 1, 1, 1, 7, 1, 2, LEVEL_COUNT];
  stores.forEach((progress, i) => {
    const g = createGame({ ...harness().env, progress });
    const state = g.getState();
    assert.equal(state.unlocked, expected[i], `store ${i}`);
    assert.equal(state.menu === null, expected[i] === 1);
    g.draw(mockContext());
    if (state.menu) g.update(1 / 60, input([], ['Enter']));
    for (let f = 0; f < 120; f++) g.update(1 / 60, input([], ['Space']));
    assert.equal(g.getState().phase, 'playing');
  });
  const throwing = {
    unlocked: () => 1,
    unlock: () => {
      throw new Error('full');
    },
  };
  const h = harness();
  const g = createGame({ ...h.env, progress: throwing });
  const act = rememberer(g, 60, 0.25);
  while (g.getState().mode !== 'level-clear') g.update(1 / 60, act());
  g.update(1 / 60, input());
  assert.equal(g.getState().unlocked, 2);
});
test('clearing a level unlocks the next one and a later visit offers continue', () => {
  const unlocks = [];
  const h = harness({ seed: 2 });
  const g = createGame({ ...h.env, progress: progressAt(1, unlocks) });
  const act = rememberer(g, 60, 0.25);
  while (g.getState().mode !== 'level-clear') g.update(1 / 60, act());
  g.update(1 / 60, input());
  g.update(1 / 60, input());
  assert.deepEqual(unlocks, [2]);
  const next = createGame({ ...harness().env, progress: progressAt(2) });
  assert.equal(next.getState().menu.cursor, 2);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().level, 2);
  assert(g.getState().score > 0);
});
function loseOnPurpose(lang) {
  const h = harness({ seed: 1, lang }),
    g = createGame({ ...h.env, progress: progressAt(6) });
  g.update(1 / 60, input([], ['Space']));
  const cards = g.getState().cards;
  for (let f = 0; f < 60 * 120 && !h.ends.length; f++)
    g.update(1 / 60, input([], [], f % 20 === 0 ? centre(cards[(f / 20) % 6]) : {}));
  return { h, g };
}
test('losing and winning each report once in English and Chinese, then freeze', () => {
  for (const lang of ['en', 'zh']) {
    const { h, g } = loseOnPurpose(lang);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'en' ? /fell asleep/ : /睡着/);
    const frozen = JSON.stringify(g.getState()),
      sounds = h.sounds.length;
    for (let f = 0; f < 600; f++)
      g.update(1 / 60, input(['ArrowUp'], ['Space', 'KeyT'], { x: 100, y: 100, clicked: true }));
    assert.equal(JSON.stringify(g.getState()), frozen);
    assert.equal(h.ends.length, 1);
    assert.equal(h.sounds.length, sounds);
    assert.equal(g.getState().phase, 'lost');
  }
  const h = harness({ seed: 4, lang: 'zh' }),
    g = createGame({ ...h.env, progress: progressAt(LEVEL_COUNT) });
  g.update(1 / 60, input([], ['Space']));
  const act = rememberer(g, 60, 0.25);
  while (g.getState().phase === 'playing') g.update(1 / 60, act());
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].won && h.ends[0].message.includes('二十'));
  const frozen = JSON.stringify(g.getState());
  for (let f = 0; f < 100; f++) g.update(1 / 60, input([], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
});
test('a lost level can be restarted with a new game instance', () => {
  const { h } = loseOnPurpose('en');
  assert(h.ends.length === 1);
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.level, 1);
});

// Drawing: every screen fits the 480 x 320 canvas in both languages.
const WIDE = /[　-〿一-鿿＀-￯]/;
function recordingContext() {
  const texts = [],
    ctx = mockContext();
  return new Proxy(ctx, {
    get: (target, p) =>
      p === 'fillText'
        ? (text, x, y) =>
            texts.push({
              text: String(text),
              x,
              y,
              size: parseInt(ctx.font.match(/(\d+)px/)[1], 10),
              align: ctx.textAlign,
            })
        : p === 'texts'
          ? texts
          : target[p],
    set: (target, p, v) => ((target[p] = v), true),
  });
}
const widthOf = (t) =>
  [...t.text].reduce((w, ch) => w + (WIDE.test(ch) ? t.size : t.size * 0.62), 0);
function assertFits(texts, label) {
  for (const t of texts) {
    const w = widthOf(t),
      left = t.align === 'center' ? t.x - w / 2 : t.x,
      right = left + w;
    assert(
      left >= 0 && right <= 480 && t.y >= 0 && t.y + t.size <= 320,
      `${label}: "${t.text}" leaves the canvas`,
    );
    if (t.x < 110 && t.align === 'left' && t.y > 46)
      assert(right <= 106, `${label}: "${t.text}" overflows the left panel`);
    if (t.x >= 380 && t.align === 'left')
      assert(right <= 472, `${label}: "${t.text}" overflows the right panel`);
    if (t.x === 114 && t.y === 40) assert(right <= 212, `${label}: strip label "${t.text}"`);
    if (t.y >= 280) assert(w <= 470, `${label}: prompt "${t.text}" too wide`);
  }
}
test('every level screen and the select screen fit the canvas in English and Chinese', () => {
  for (const lang of ['en', 'zh']) {
    const { env } = harness({ lang });
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const s = createLevelState(n, seeded(n));
      const variants = [
        (v) => v,
        (v) => ({ ...v, mode: 'ready', feedback: 'mismatch', feedbackTime: 2, started: true }),
        (v) => ({ ...v, mode: 'ready', feedbackTime: 0, remaining: 9, started: true, cursor: 1 }),
        (v) => ({ ...v, mode: 'reveal', correct: false, flipped: [0], dur: 1, t: 0.2 }),
        (v) => ({
          ...v,
          mode: 'reveal',
          correct: true,
          flipped: [0],
          matched: v.matched.map((_, i) => i < LEVELS[n - 1].group),
        }),
        (v) => ({ ...v, mode: 'level-clear', phase: 'playing' }),
        (v) => ({ ...v, phase: 'lost', mode: 'terminal' }),
        (v) => ({ ...v, phase: 'won', mode: 'terminal' }),
        (v) =>
          v.echo
            ? { ...v, mode: 'cue-on', dur: 1, t: 0.4, echo: { ...v.echo, lit: 1, step: 1 } }
            : v,
        (v) => ({
          ...v,
          lives: LEVELS[n - 1].lives === null ? 16 : v.lives,
          routeIndex: Math.min(v.route.length, 2),
        }),
      ];
      variants.forEach((make, k) => {
        const ctx = recordingContext();
        drawMemory(ctx, make({ ...s }), env);
        assert(ctx.texts.length > 5);
        assertFits(ctx.texts, `${lang} level ${n} variant ${k}`);
      });
    }
    for (const unlocked of [1, 7, LEVEL_COUNT])
      for (const cursor of [1, unlocked, 12]) {
        const ctx = recordingContext();
        drawSelect(ctx, env, { cursor: Math.min(cursor, LEVEL_COUNT), unlocked });
        assertFits(ctx.texts, `${lang} select ${unlocked}/${cursor}`);
      }
  }
  assert.equal(menuCell(6).y > menuCell(1).y, true);
});
test('the timing strip names each phase and shows how long it lasts', () => {
  const t = (en) => en;
  const preview = createLevelState(1, seeded(1));
  assert.match(timingStrip(preview, t).label, /^STUDY 3\.0s$/);
  assert.equal(timingStrip(preview, t).fill, 1);
  const echo = createLevelState(10, seeded(1));
  assert.match(timingStrip(echo, t).label, /^GET READY/);
  echo.mode = 'cue-on';
  echo.dur = 0.75;
  echo.t = 0.25;
  assert.equal(timingStrip(echo, t).label, 'CUE 1/3');
  assert(Math.abs(timingStrip(echo, t).fill - 2 / 3) < 1e-9);
  const timed = createLevelState(8, seeded(1));
  timed.mode = 'ready';
  assert.equal(timingStrip(timed, t).label, 'YOUR TURN');
  timed.started = true;
  assert.equal(timingStrip(timed, t).label, 'CLOCK 70s');
  timed.mode = 'reveal';
  timed.dur = 2;
  timed.t = 0.5;
  assert.equal(timingStrip(timed, t).label, 'LOOK 1.5s');
  timed.mode = 'terminal';
  assert.equal(timingStrip(timed, t).label, '');
  timed.mode = 'opening';
  assert.equal(timingStrip(timed, t).fill, 1);
});
