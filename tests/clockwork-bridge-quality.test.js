import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createMachine, stepMachine, meta } from '../src/games/clockwork-bridge.js';
import { LEVELS, LEVEL_COUNT } from '../src/games/clockwork-bridge-levels.js';
import { ROUTES } from '../src/games/clockwork-bridge-routes.js';
import { MENU_COLUMNS, menuCell, wrapText } from '../src/games/clockwork-bridge-menu.js';
import { drawMachine } from '../src/games/clockwork-bridge-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const RUN_SPEED = 80;
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const CJK = /[一-鿿]/;
const BLIND_HORIZON = 40;
const BLIND_BAR = 0.25;
const TIERS = [
  [1, 5],
  [6, 10],
  [11, 15],
  [16, 20],
];

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
/** Start a game on `level` the way a player does: through the select screen when it is offered. */
function open(level, { lang = 'en', seed = 1, progress = memoryStore(level), launch = true } = {}) {
  const h = harness({ lang, seed });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h, progress };
}

// ---------------------------------------------------------------------------------------------
// The reaction-limited player. It sees getState() from `delay` seconds ago, remembers the keys it
// pressed since, and follows the level's route; it never reads the machine's private fields.
// ---------------------------------------------------------------------------------------------
function routeBot(route, { delay, hz }) {
  const history = [],
    dirs = [],
    lag = Math.round(delay * hz);
  let step = 0,
    memo = { age: 0 },
    launched = false;
  const out = (held = [], pressed = []) => {
    dirs.push(Number(held.includes('ArrowRight')) - Number(held.includes('ArrowLeft')));
    return input(held, pressed);
  };
  const next = () => {
    step++;
    memo = { age: 0 };
    return out();
  };
  return (now) => {
    history.push(now);
    const seen = history[Math.max(0, history.length - 1 - lag)];
    if (seen.menu) {
      if (launched) return out();
      launched = true;
      return out([], ['Space']);
    }
    if (step >= route.length) return out();
    const p = seen.player,
      unseen = dirs.slice(Math.max(0, dirs.length - lag)).reduce((a, d) => a + d, 0),
      px = p.x + p.w / 2 + (RUN_SPEED / hz) * unseen,
      py = p.y + p.h / 2;
    memo.age += 1 / hz;
    assert.ok(memo.age < 40, `route step ${step} ${JSON.stringify(route[step])} stalled at ${px}`);
    const [op, a, b] = route[step];
    const settled = seen.bridges.every((q) => q.phase !== 'moving' && q.phase !== 'jammed');
    const keyEvents = seen.stats.picks + seen.stats.drops + seen.stats.unlocks;
    if (op === 'go') {
      if (Math.abs(a - px) <= 3) return next();
      return out([a > px ? 'ArrowRight' : 'ArrowLeft']);
    }
    if (op === 'x') {
      if (memo.pressed) return seen.stats.cranks > memo.cranks && settled ? next() : out();
      let nearest = null,
        reach = 36;
      for (const g of seen.gears) {
        const d = Math.hypot(px - g.x, py - g.y);
        if (d <= reach) [nearest, reach] = [g, d];
      }
      if (nearest?.id !== a) return out([seen.gears[a].x > px ? 'ArrowRight' : 'ArrowLeft']);
      Object.assign(memo, { pressed: true, cranks: seen.stats.cranks });
      return out([], ['KeyX']);
    }
    if (op === 'z') {
      if (memo.pressed) return keyEvents > memo.events ? next() : out();
      Object.assign(memo, { pressed: true, events: keyEvents });
      return out([], ['KeyZ']);
    }
    if (op === 'jump') {
      const dir = b > a ? 1 : -1,
        key = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
      memo.phase ??= 0;
      if (memo.phase === 0 && (px - a) * dir >= 0) {
        memo.phase = 1;
        return out([key], ['Space']);
      }
      if (memo.phase === 1 && (px - b) * dir >= 0) memo.phase = 2;
      if (memo.phase === 2) return p.grounded && memo.age > 0.5 ? next() : out();
      return out([key]);
    }
    assert.equal(op, 'exit');
    return out([seen.door.x + seen.door.w / 2 > px ? 'ArrowRight' : 'ArrowLeft']);
  };
}
/** One full machine with the route bot; returns the final public state and the host's view. */
function playLevel(n, { hz = 60, delay = 0.25, lang = 'en' } = {}) {
  const { g, h, progress } = open(n, { lang });
  const bot = routeBot(ROUTES[n - 1], { delay, hz });
  for (let frame = 0; frame < hz * 90; frame++) {
    const st = g.getState();
    if (!st.menu && (st.phase !== 'playing' || st.level !== n)) break;
    g.update(1 / hz, bot(st));
  }
  return { g, h, progress, state: g.getState() };
}
const cleared = (n, r) => (n === LEVEL_COUNT ? r.state.phase === 'won' : r.state.level === n + 1);

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const supported = (o, rects) =>
  rects.some((r) => r.y === o.y + o.h && o.x + o.w / 2 >= r.x && o.x + o.w / 2 <= r.x + r.w);

test('twenty frozen, distinct, bilingual levels with a legal layout', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.ok(Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0].solids[0]));
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, 20);
  assert.equal(new Set(LEVELS.map((l) => l.tip.en)).size, 20);
  for (const [i, l] of LEVELS.entries()) {
    for (const o of [l.name, l.tip]) {
      assert.ok(o.en.length > 5 && !CJK.test(o.en), `level ${i + 1} English`);
      assert.ok(CJK.test(o.zh), `level ${i + 1} Chinese`);
    }
    const s = createMachine(i),
      rects = [...s.solids, ...s.bridges];
    assert.ok(!rects.some((r) => overlaps(s.player, r) || overlaps(s.door, r)), `level ${i + 1}`);
    assert.ok(supported(s.player, rects) && supported(s.door, rects), `level ${i + 1} stands`);
    for (const k of s.keys) assert.ok(supported(k, rects) && !rects.some((r) => overlaps(k, r)));
    for (const g of s.gears) {
      assert.ok(rects.some((r) => r.y === g.y + 14 && g.x >= r.x && g.x <= r.x + r.w));
      // Labels sit above the gear: they must stay below the 20 px top bar.
      assert.ok(g.y - 31 >= 20 && s.door.y - 17 >= 20, `level ${i + 1} label`);
    }
    for (const b of s.bridges)
      for (const t of [0, 1]) {
        const at = { ...b, x: b.a.x + (b.b.x - b.a.x) * t, y: b.a.y + (b.b.y - b.a.y) * t };
        assert.ok(!s.solids.some((o) => overlaps(at, o)), `level ${i + 1} deck ${b.id} at ${t}`);
        assert.ok(at.y + at.h + 16 <= 298, 'deck label clear of the bottom bar');
      }
  }
  assert.equal(ROUTES.length, 20);
});

test('difficulty rises across the four tiers: more gear turns and more routes to get wrong', () => {
  const turns = ROUTES.map((r) => r.filter((op) => op[0] === 'x').length),
    gears = LEVELS.map((l) => l.gears.length),
    mean = (xs, [a, b]) => xs.slice(a - 1, b).reduce((s, v) => s + v, 0) / (b - a + 1);
  for (const series of [turns, gears])
    for (let t = 1; t < TIERS.length; t++)
      assert.ok(mean(series, TIERS[t]) > mean(series, TIERS[t - 1]), JSON.stringify(series));
  assert.ok(turns.slice(14).every((n) => n >= 5) && Math.max(...turns) >= 10);
  assert.ok(turns.slice(0, 5).every((n) => n <= 2));
});

// ---------------------------------------------------------------------------------------------
// Clears
// ---------------------------------------------------------------------------------------------
for (const n of LEVEL_NUMBERS) {
  test(`machine ${n} ${LEVELS[n - 1].name.en}: scripted escape clears without a fall and unlocks the next`, () => {
    const r = playLevel(n);
    assert.ok(cleared(n, r), `ended on level ${r.state.level} (${r.state.phase})`);
    assert.equal(r.state.stats.falls, 0);
    assert.equal(r.state.lives, 5);
    assert.equal(r.h.ends.length, n === LEVEL_COUNT ? 1 : 0);
    if (n < LEVEL_COUNT) assert.deepEqual(r.progress.calls, [n + 1]);
  });
}

test('a reaction-limited player (0.25 s and 0.35 s) clears every machine at 30, 60 and 120 Hz', () => {
  for (const delay of DELAYS)
    for (const hz of HZS)
      for (const n of LEVEL_NUMBERS) {
        const r = playLevel(n, { hz, delay });
        assert.ok(cleared(n, r), `machine ${n} at ${hz} Hz, ${delay} s`);
        assert.equal(r.state.stats.falls, 0, `machine ${n} at ${hz} Hz, ${delay} s fell`);
      }
});

test('the whole campaign is winnable in one run, in order, from the select screen', () => {
  const h = harness(),
    store = memoryStore(1);
  h.env.progress = store;
  const g = createGame(h.env);
  for (const n of LEVEL_NUMBERS) {
    const bot = routeBot(ROUTES[n - 1], { delay: 0.25, hz: 60 });
    for (
      let f = 0;
      f < 60 * 90 && g.getState().level === n && g.getState().phase === 'playing';
      f++
    )
      g.update(1 / 60, bot(g.getState()));
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(store.value, LEVEL_COUNT);
  assert.equal(g.getState().cleared, LEVEL_COUNT);
});

// ---------------------------------------------------------------------------------------------
// Blind play and a fair start
// ---------------------------------------------------------------------------------------------
const KEYS = ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX', 'KeyZ', 'KeyQ'];
function blindPolicies() {
  const list = [['idle', () => input()]];
  for (const seed of [1, 2])
    list.push([
      `mash ${seed}`,
      (() => {
        const rnd = seeded(seed);
        return () =>
          input(
            KEYS.filter(() => rnd() < 0.5),
            KEYS.filter(() => rnd() < 0.3),
          );
      })(),
    ]);
  for (const period of [0.5, 1, 2]) {
    const taps = (t) => (t % period < 1 / 60 ? ['KeyX', 'KeyZ', 'Space'] : []);
    list.push([
      `alternate ${period}`,
      (t) => input([Math.floor(t / period) % 2 ? 'ArrowLeft' : 'ArrowRight'], taps(t)),
    ]);
    list.push([`hold right ${period}`, (t) => input(['ArrowRight'], taps(t))]);
  }
  return list;
}
function blindWins(n, policy) {
  const { g } = open(n);
  for (let f = 0; f < 60 * BLIND_HORIZON; f++) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== n) break;
    g.update(1 / 60, policy(f / 60));
  }
  const st = g.getState();
  return st.phase === 'won' || st.level > n;
}
test('idle, mashing and timed hold-and-alternate patterns win at most 25% of any machine from 3', () => {
  for (const n of LEVEL_NUMBERS.filter((x) => x >= 3)) {
    const policies = blindPolicies();
    const wins = policies.filter(([, policy]) => blindWins(n, policy)).length;
    assert.ok(wins / policies.length <= BLIND_BAR, `machine ${n}: ${wins}/${policies.length}`);
  }
});

test('an idle player never loses anything, and machine 1 cannot be lost by waiting', () => {
  for (const n of LEVEL_NUMBERS) {
    const { g } = open(n);
    for (let f = 0; f < 60 * 15; f++) g.update(1 / 60, input());
    const st = g.getState();
    assert.equal(st.phase, 'playing');
    assert.equal(st.lives, 5);
    assert.equal(st.stats.falls, 0);
  }
});

// ---------------------------------------------------------------------------------------------
// Frame rate, hostile input, progress stores
// ---------------------------------------------------------------------------------------------
test('aligned scripted input is bit-identical at 30, 60 and 120 Hz on every machine', () => {
  for (const n of [1, 2, 6, 17, 19]) {
    const finals = HZS.map((hz) => {
      const { g } = open(n);
      for (let i = 0; i < hz * 6; i++) {
        const pressed = [];
        if (i === 0) pressed.push('KeyZ');
        if (i === hz * 1.5) pressed.push('Space');
        if (i === hz * 3) pressed.push('KeyX');
        if (i === hz * 4) pressed.push('KeyZ');
        g.update(1 / hz, input([i < hz * 4.5 ? 'ArrowRight' : 'ArrowLeft'], pressed));
      }
      const st = g.getState();
      delete st.acc;
      return JSON.stringify(st);
    });
    assert.equal(finals[0], finals[1], `machine ${n}`);
    assert.equal(finals[1], finals[2], `machine ${n}`);
  }
});

test('hostile dt values change nothing and hostile pointers never start or move the select', () => {
  const { g } = open(2);
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 10, undefined, null, '0.01', {}])
    g.update(dt, input(['ArrowRight'], ['KeyX', 'Space', 'KeyZ', 'KeyQ']));
  assert.equal(JSON.stringify(g.getState()), before);
  const store = memoryStore(5);
  const menu = open(5, { progress: store, launch: false }).g;
  const frozen = JSON.stringify(menu.getState());
  const junk = [NaN, Infinity, -Infinity, '12', null, undefined, {}, [], -1, 1e9, 'x'];
  for (const x of junk)
    for (const y of junk) {
      menu.update(1 / 60, input([], [], { x, y, clicked: true }));
      menu.update(1 / 60, input([], [], { x, y, down: true }));
    }
  menu.update(1 / 60, { held: () => false, pressed: () => false });
  assert.equal(JSON.stringify(menu.getState()), frozen);
  g.draw(mockContext());
  menu.draw(mockContext());
});

test('broken, missing and junk progress stores are survived and clamped', () => {
  const stores = {
    throwing: { unlocked: () => assert.fail('boom'), unlock: () => assert.fail('boom') },
    missingMethods: {},
    nan: memoryStore(NaN),
    text: memoryStore('abc'),
    negative: memoryStore(-4),
    zero: memoryStore(0),
    nothing: memoryStore(null),
    infinite: memoryStore(Infinity),
  };
  for (const [name, store] of Object.entries(stores)) {
    const g = createGame({ ...harness().env, progress: store });
    const st = g.getState();
    assert.equal(st.menu === null && st.level === 1, true, `${name} starts machine 1 directly`);
  }
  assert.equal(open(99, { progress: memoryStore(99), launch: false }).g.getState().menu.cursor, 20);
  assert.equal(open(1, { progress: memoryStore(2.9), launch: false }).g.getState().unlocked, 2);
  assert.equal(open(1, { progress: memoryStore('7'), launch: false }).g.getState().unlocked, 7);
  // A store that fails on save must not stop the run or hide the clear.
  const h = harness();
  h.env.progress = { unlocked: () => 1, unlock: () => assert.fail('disk full') };
  const g = createGame(h.env);
  const bot = routeBot(ROUTES[0], { delay: 0.25, hz: 60 });
  for (let f = 0; f < 60 * 30 && g.getState().level === 1; f++) g.update(1 / 60, bot(g.getState()));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().unlocked, 2);
});

test('select screen: keyboard, taps, locked machines, continue and clamped cursor', () => {
  const store = memoryStore(8);
  const h = harness();
  h.env.progress = store;
  const g = createGame(h.env);
  assert.equal(g.getState().menu.cursor, 8, 'continue offers the furthest machine');
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 8, 'cannot move past the unlocked machine');
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 1 + MENU_COLUMNS);
  const locked = menuCell(15);
  const hitsBefore = h.sounds.filter((s) => s === 'hit').length;
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.equal(h.sounds.filter((s) => s === 'hit').length, hitsBefore + 1);
  assert.ok(g.getState().menu, 'a locked machine does not start');
  const open3 = menuCell(3);
  g.update(1 / 60, input([], [], { x: open3.x + 5, y: open3.y + 5, clicked: true }));
  const st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3);
  assert.equal(st.lives, 5);
  const cells = LEVEL_NUMBERS.map(menuCell);
  for (const c of cells) assert.ok(c.x >= 0 && c.x + c.w <= 480 && c.y >= 22 && c.y + c.h <= 220);
  assert.equal(wrapText('', 12, 100).length, 0);
});

// ---------------------------------------------------------------------------------------------
// Ending, terminal state, controls
// ---------------------------------------------------------------------------------------------
test('winning ends exactly once in English and Chinese and then the state is frozen', () => {
  for (const lang of ['en', 'zh']) {
    const r = playLevel(LEVEL_COUNT, { lang });
    assert.equal(r.state.phase, 'won');
    assert.equal(r.h.ends.length, 1);
    assert.equal(r.h.ends[0].won, true);
    assert.equal(
      r.h.ends[0].message,
      lang === 'en' ? 'You escaped all twenty clockwork machines!' : '你逃出了全部二十台发条机器！',
    );
    assert.ok(r.h.sounds.includes('win'));
    const frozen = JSON.stringify(r.g.getState());
    for (let i = 0; i < 200; i++)
      r.g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX', 'KeyZ', 'KeyQ']));
    assert.equal(JSON.stringify(r.g.getState()), frozen);
    assert.equal(r.h.ends.length, 1);
    r.g.draw(mockContext());
  }
});

test('five falls lose once in English and Chinese, freeze, and a new game starts fresh', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = open(2, { lang });
    let falls = 0;
    for (let f = 0; f < 60 * 120 && g.getState().phase === 'playing'; f++) {
      g.update(1 / 60, input(['ArrowRight']));
      falls = g.getState().stats.falls;
    }
    const st = g.getState();
    assert.equal(st.phase, 'lost');
    assert.equal(falls, 5);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.equal(
      h.ends[0].message,
      lang === 'en' ? 'The machines swallowed you. Try again.' : '机器吞没了你。再试一次。',
    );
    assert.ok(h.sounds.includes('lose') && h.sounds.includes('hit'));
    const frozen = JSON.stringify(st);
    for (let i = 0; i < 100; i++) g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(g.getState()), frozen);
    assert.equal(h.ends.length, 1);
    const fresh = createGame(harness().env).getState();
    assert.equal(fresh.lives, 5);
    assert.equal(fresh.phase, 'playing');
  }
});

test('Q rewinds the machine for free, the host keys stay free, and every action has a touch control', () => {
  const s = createMachine(1);
  stepMachine(s, 1 / 60, input([], ['KeyX']));
  s.player.x = 100;
  stepMachine(s, 1 / 60, input([], ['KeyQ']));
  assert.equal(s.lives, 5);
  assert.equal(s.player.x, 24);
  assert.equal(s.stats.resets, 1);
  assert.ok(s.gears.every((g) => g.state === 0));
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX', 'KeyZ', 'KeyQ'])
    assert.ok(codes.includes(code), code);
  const rewind = meta.touchControls.find((c) => c.label.en === 'Rewind').code;
  assert.equal(rewind, 'KeyQ');
  for (const reserved of ['KeyR', 'Escape', 'KeyP'])
    assert.ok(!meta.touchControls.some((c) => c.code === reserved), reserved);
  assert.ok(
    meta.keys.some((k) => k.keys === 'Q') && !meta.keys.some((k) => /\b(R|P|Esc)\b/.test(k.keys)),
  );
  const host = createMachine(1);
  for (const key of ['KeyR', 'Escape', 'KeyP']) stepMachine(host, 1 / 60, input([], [key]));
  assert.equal(host.stats.resets, 0, 'host keys do nothing inside the game');
  const text = `${meta.description.en} ${meta.description.zh}`;
  assert.ok(text.includes('Q rewinds') && text.includes('按Q'));
  assert.equal(meta.keys.length, 6);
});

test('an input pressed while time is too short to step is latched, not dropped', () => {
  const s = createMachine(1);
  s.player.x = 120;
  stepMachine(s, 1 / 1000, input([], ['KeyX']));
  assert.equal(s.stats.cranks, 0);
  for (let i = 0; i < 10; i++) stepMachine(s, 1 / 240, input());
  assert.equal(s.stats.cranks, 1);
});

// ---------------------------------------------------------------------------------------------
// Drawing: complete in both languages, fits 480 x 320, no colour-only gear state
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
  [...text].reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62), 0);
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
function assertLanguage(drawn, lang, label) {
  for (const { text } of drawn)
    if (lang === 'en') assert.doesNotMatch(text, CJK, `${label}: "${text}"`);
    else if (!/^[A-C]{3}$/.test(text))
      assert.doesNotMatch(text, /[A-Za-z]{3,}/, `${label}: "${text}"`);
}
test('every opening screen, the select screen and every message fit and are localized', () => {
  for (const lang of ['en', 'zh']) {
    for (const n of LEVEL_NUMBERS) {
      const { g } = open(n, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} machine ${n}`);
      assertLanguage(drawn, lang, `${lang} machine ${n}`);
      assert.ok(
        drawn.some((d) => d.text === LEVELS[n - 1].tip[lang]),
        'the tip is on screen',
      );
      assert.ok(
        drawn.some((d) => d.text.startsWith(`${n}/20 `)),
        'the machine number is on screen',
      );
      const menu = open(n, { lang, launch: false }),
        picked = textCanvas();
      menu.g.draw(picked.ctx);
      assertFits(picked.drawn, `${lang} select ${n}`);
      assertLanguage(picked.drawn, lang, `${lang} select ${n}`);
      assert.ok(
        n === 1 || picked.drawn.some((d) => d.text === LEVELS[n - 1].name[lang]),
        'the select screen names the chosen machine',
      );
    }
    // Every message the game can show, on a machine where it can happen.
    const { g } = open(6, { lang }),
      { ctx, drawn } = textCanvas();
    const actions = [['KeyX'], ['KeyZ'], ['KeyQ']];
    for (let i = 0; i < 40; i++) {
      g.update(
        1 / 60,
        input(i % 2 ? ['ArrowRight'] : [], actions[i % 3].slice(0, i % 5 === 0 ? 1 : 0)),
      );
      g.draw(ctx);
    }
    assertFits(drawn, `${lang} messages`);
    assertLanguage(drawn, lang, `${lang} messages`);
  }
});

test('the select screen and the top and bottom bars never cover play', () => {
  assert.equal(wrapText('aaa bbb ccc', 12, 30).length, 3);
  for (const l of LEVELS) for (const g of l.gears) assert.ok(g.y >= 51);
  const rects = [],
    ctx = mockContext();
  ctx.fillRect = (x, y, w, h) => rects.push({ fill: ctx.fillStyle, x, y, w, h });
  open(2).g.draw(ctx);
  const bars = rects.filter((r) => r.fill === 'rgba(10,6,4,0.85)');
  assert.deepEqual(
    bars.map((r) => [r.y, r.h]),
    [
      [0, 20],
      [298, 22],
    ],
  );
});

test('a gear shows its state by shape as well as colour', () => {
  const geometry = (state) => {
    const s = createMachine(1);
    s.gears[0].state = state;
    const rects = [],
      ctx = mockContext();
    ctx.fillRect = (x, y, w, h) => rects.push([x, y, w, h].join());
    drawMachine(ctx, s, harness().env);
    return rects.join('|');
  };
  assert.notEqual(geometry(0), geometry(1));
});

test('random play on every machine stays finite and out of the walls', () => {
  for (const n of LEVEL_NUMBERS) {
    const rnd = seeded(n),
      s = createMachine(n - 1);
    let held = [];
    for (let i = 0; i < 1500 && s.phase === 'playing'; i++) {
      if (i % 20 === 0) held = rnd() < 0.3 ? [] : [KEYS[Math.floor(rnd() * 2)]];
      stepMachine(
        s,
        [1 / 30, 1 / 60, 1 / 120][n % 3],
        input(held, rnd() < 0.05 ? [KEYS[2 + Math.floor(rnd() * 4)]] : []),
      );
      const p = s.player;
      for (const v of [p.x, p.y, p.vx, p.vy]) assert.ok(Number.isFinite(v));
      assert.ok(
        [...s.solids, ...s.bridges].every(
          (r) => !overlaps(p, { ...r, x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 }),
        ),
      );
    }
  }
});

test('a stranded player always sees the rewind key and gets a stuck hint after waiting', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = open(5, { lang }),
      early = textCanvas();
    g.draw(early.ctx);
    assert.ok(early.drawn.some((d) => d.text === (lang === 'en' ? 'Q: rewind' : 'Q：复位')));
    // Any 20 s without a gear turn or key action raises the hint.
    g.update(1 / 60, input([], ['KeyX']));
    for (let i = 0; i < 60 * 25; i++) g.update(1 / 60, input());
    const late = textCanvas();
    g.draw(late.ctx);
    assert.ok(
      late.drawn.some(
        (d) => d.text === (lang === 'en' ? 'Stuck? Press Q to rewind' : '卡住了？按Q复位'),
      ),
    );
    assertFits(late.drawn, `${lang} stuck`);
  }
});
