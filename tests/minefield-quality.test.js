import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/games/minefield.js';
import { LEVELS, LEVEL_COUNT, planOf } from '../src/games/minefield-levels.js';
import { certifiedField } from '../src/games/minefield-field.js';
import { noticeFits } from '../src/games/minefield-draw.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZ = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const BLIND_CAP = 0.25;
const store = (n, unlocks = []) => ({ unlocked: () => n, unlock: (v) => unlocks.push(v) });

/** A game opened on `level` the way a returning player would: through the field select. */
function open(level, { seed = 1, lang = 'en', progress } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = progress ?? store(level);
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { h, g };
}
const frame = (g, hz, pressed = [], pointer = {}) => g.update(1 / hz, input([], pressed, pointer));
const wait = (g, hz, seconds) => {
  for (let n = Math.round(seconds * hz); n > 0; n--) frame(g, hz);
};
const tapAt = (g, hz, i) => {
  const s = g.getState(),
    l = s.layout;
  frame(g, hz, [], {
    clicked: true,
    x: l.x + ((i % s.width) + 0.5) * l.cell,
    y: l.y + (Math.floor(i / s.width) + 0.5) * l.cell,
  });
};
const cleared = (s) => s.betweenStages || s.phase === 'won';

/** A reaction-limited player: one key per `delay` seconds, reading only getState(). */
function bot(g, hz, delay, { onNotice = () => {}, stopAtClear = true, maxActions = 900 } = {}) {
  const act = (key) => {
    frame(g, hz, [key]);
    wait(g, hz, delay);
  };
  for (let n = 0; n < maxActions; n++) {
    let s = g.getState();
    if (s.phase !== 'playing' || (stopAtClear && cleared(s))) return s;
    if (s.menu || s.betweenStages || !s.started) act(s.betweenStages ? 'Enter' : 'Space');
    else {
      act('KeyH');
      s = g.getState();
      onNotice(s.notice);
      if (!s.hint) return s;
      while (g.getState().flags[s.cursor]) act('KeyF');
      act('Space');
    }
  }
  return g.getState();
}

test('every field has a distinct data-driven definition and a fitting bilingual tip', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.ok(Object.isFrozen(LEVELS) && LEVELS.every((l) => Object.isFrozen(l)));
  const signatures = new Set();
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const level = LEVELS[n - 1],
      plan = planOf(n),
      { en, zh } = open(n).g.getState().notice;
    signatures.add(
      JSON.stringify([
        level.w,
        level.h,
        level.mines,
        level.terrain,
        level.sectors,
        level.hints,
        level.flagLimit,
      ]),
    );
    assert.ok(noticeFits(en, 'en') && noticeFits(zh, 'zh'), `tip ${n} fits`);
    if (level.hints)
      assert.ok(en.includes(`${level.hints} safe`) && zh.includes(`预开${level.hints}`));
    if (level.flagLimit) assert.ok(en.includes(`Max ${level.flagLimit} flags`));
    if (level.sectors) assert.equal(plan.regions.length, level.sectors);
    if (level.terrain !== 'open') assert.ok(plan.mask.includes(false), `rubble on ${n}`);
    assert.ok(plan.layout.x >= 56 && plan.layout.x + plan.w * plan.layout.cell <= 396);
    assert.ok(plan.layout.y >= 58 && plan.layout.y + plan.h * plan.layout.cell <= 286);
  }
  assert.equal(signatures.size, LEVEL_COUNT);
  const mines = LEVELS.map((l) => l.mines);
  assert.ok(mines[19] > mines[0] * 4);
});

test('the first tap is always safe and every field is solved by pure logic', () => {
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const plan = planOf(n),
      active = plan.mask.flatMap((v, i) => (v ? [i] : [])),
      firsts = [active[0], active[active.length - 1], active[active.length >> 1]];
    for (const first of firsts) {
      const { g } = open(n, { seed: n + first });
      tapAt(g, 60, first);
      const s = g.getState();
      assert.equal(s.phase, 'playing');
      assert.equal(s.revealed[first], true);
      const outcome = bot(g, 120, 0.25);
      assert.ok(cleared(outcome), `field ${n} first ${first}: ${outcome.notice.en}`);
    }
  }
});

test('a reaction-limited bot using only public state clears every field at 30/60/120 Hz', () => {
  const notices = [];
  for (let n = 1; n <= LEVEL_COUNT; n++)
    for (const delay of DELAYS) {
      const finals = HZ.map((hz) => {
        const { h, g } = open(n, { seed: 100 + n, lang: delay === 0.25 ? 'en' : 'zh' });
        const end = bot(g, hz, delay, { onNotice: (m) => notices.push(m) });
        assert.ok(cleared(end), `field ${n} ${hz}Hz ${delay}s: ${end.notice.en}`);
        assert.equal(h.ends.length, n === LEVEL_COUNT ? 1 : 0);
        return JSON.stringify(g.getState());
      });
      assert.equal(finals[0], finals[1], `field ${n} frame-rate determinism 30/60`);
      assert.equal(finals[1], finals[2], `field ${n} frame-rate determinism 60/120`);
    }
  assert.ok(notices.every((m) => noticeFits(m.en, 'en') && noticeFits(m.zh, 'zh')));
});

test('the whole campaign is winnable in both languages with exactly one end', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ seed: 5, lang }),
      g = createGame(h.env),
      end = bot(g, 60, 0.25, { stopAtClear: false, maxActions: 6000 });
    assert.equal(end.phase, 'won');
    assert.equal(end.level, LEVEL_COUNT);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(
      h.ends[0].message,
      lang === 'en' ? 'All 20 survey fields mapped!' : '20处勘探地全部探明！',
    );
    const frozen = JSON.stringify(g.getState());
    for (const k of ['Enter', 'Space', 'KeyF', 'KeyX', 'KeyH', 'ArrowLeft']) frame(g, 60, [k]);
    assert.equal(JSON.stringify(g.getState()), frozen);
    assert.equal(h.ends.length, 1);
    g.draw(mockContext());
  }
});

const MASH_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'KeyF',
  'KeyC',
  'KeyX',
  'KeyH',
  'KeyI',
  'KeyV',
];
const BLIND_STEPS = 500;
const blindPlayers = {
  idle: () => {},
  mash: (g, seed) => {
    const r = seeded(seed);
    for (let n = 0; n < BLIND_STEPS; n++)
      frame(g, 60, [MASH_KEYS[Math.floor(r() * MASH_KEYS.length)]]);
  },
  tapRandom: (g, seed) => {
    const r = seeded(seed);
    for (let n = 0; n < BLIND_STEPS; n++) tapAt(g, 60, Math.floor(r() * g.getState().mask.length));
  },
  timed: (g, seed) => {
    const period = [0.25, 0.5, 1][seed % 3];
    for (let n = 0; n < 40; n++) {
      frame(g, 60, ['Space']);
      frame(g, 60, [n % 2 ? 'ArrowLeft' : 'ArrowDown']);
      for (let f = 0; f < period * 60; f++)
        g.update(1 / 60, input(['Space', n % 2 ? 'ArrowLeft' : 'ArrowDown']));
    }
  },
};

test('blind play (idle, mashing, random taps, timed patterns) wins at most 25% from field 3', () => {
  for (let n = 3; n <= LEVEL_COUNT; n++) {
    let wins = 0,
      runs = 0;
    for (const [name, play] of Object.entries(blindPlayers))
      for (const seed of name === 'idle' ? [1] : [1, 2, 3]) {
        const { h, g } = open(n, { seed });
        play(g, seed);
        const s = g.getState();
        runs++;
        if (s.phase === 'won' || (s.betweenStages && s.level === n)) wins++;
        if (name === 'idle') assert.equal(s.phase, 'playing');
        assert.ok(h.ends.length <= 1);
      }
    assert.ok(wins / runs <= BLIND_CAP, `field ${n}: ${wins}/${runs} blind clears`);
  }
});

test('an idle player cannot lose the opening of field 1', () => {
  const { h, g } = open(1);
  wait(g, 60, 30);
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().revealed.some(Boolean), false);
  assert.equal(h.ends.length, 0);
});

test('hostile dt values read no input and extreme dt is clamped', () => {
  for (const dt of [NaN, Infinity, -Infinity, -1, 0, undefined, null, '0.1', {}]) {
    const { g } = open(2);
    const before = JSON.stringify(g.getState());
    g.update(dt, input([], ['Space', 'KeyF', 'ArrowRight']));
    assert.equal(JSON.stringify(g.getState()), before, `dt ${String(dt)}`);
  }
  const a = open(2, { seed: 3 }).g,
    b = open(2, { seed: 3 }).g;
  a.update(1e9, input([], ['Space']));
  b.update(1 / 30, input([], ['Space']));
  assert.equal(JSON.stringify(a.getState()), JSON.stringify(b.getState()));
});

test('hostile pointer values never reveal, crash or move the cursor off the field', () => {
  const values = [NaN, Infinity, -Infinity, -1e9, 1e9, '40', null, undefined, {}, [], 0.5];
  for (const x of values)
    for (const y of values) {
      const { g } = open(9);
      g.update(1 / 60, {
        held: () => false,
        pressed: () => false,
        pointer: { x, y, down: true, clicked: true },
      });
      const s = g.getState();
      assert.ok(s.mask[s.cursor]);
      assert.equal(s.phase, 'playing');
    }
  const { g } = open(9);
  g.update(1 / 60, { held: () => false, pressed: () => false });
  g.update(1 / 60, { held: () => false, pressed: () => false, pointer: null });
  assert.equal(g.getState().phase, 'playing');
  const menu = createGame({ ...harness().env, progress: store(5) });
  for (const x of values.filter((v) => v !== '40'))
    menu.update(1 / 60, {
      held: () => false,
      pressed: () => false,
      pointer: { x, y: x, clicked: true },
    });
  assert.equal(menu.getState().menu.cursor, 5);
});

test('broken or junk progress stores clamp and never stop the game', () => {
  const junk = [NaN, -5, 0, 999, '7', null, undefined, Infinity, 2.9, {}];
  const expected = [1, 1, 1, 20, 7, 1, 1, 1, 2, 1];
  junk.forEach((value, n) => {
    const g = createGame({ ...harness().env, progress: { unlocked: () => value, unlock() {} } });
    assert.equal(g.getState().unlocked, expected[n], String(value));
    assert.ok(g.getState().unlocked >= 1 && g.getState().unlocked <= LEVEL_COUNT);
  });
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
  assert.equal(g.getState().menu, null);
  const end = bot(g, 60, 0.25);
  assert.ok(cleared(end));
  assert.equal(g.getState().unlocked, 2);
});

test('clearing a field unlocks the next one and the select resumes there', () => {
  const unlocks = [],
    { g } = open(4, { progress: store(4, unlocks) });
  assert.equal(g.getState().level, 4);
  bot(g, 60, 0.25);
  assert.deepEqual(unlocks, [5]);
  assert.equal(g.getState().unlocked, 5);
  const resumed = createGame({ ...harness().env, progress: store(5) });
  assert.equal(resumed.getState().menu.cursor, 5);
  frame(resumed, 60, ['ArrowLeft']);
  assert.equal(resumed.getState().menu.cursor, 4);
  frame(resumed, 60, ['ArrowDown']);
  assert.equal(resumed.getState().menu.cursor, 5);
});

test('a live mine ends the run once with a localized message and freezes the state', () => {
  for (const lang of ['en', 'zh']) {
    const { h, g } = open(3, { seed: 11, lang });
    frame(g, 60, ['Space']);
    const s = g.getState(),
      field = certifiedField(planOf(3), s.cursor, seeded(11)),
      mine = field.mines.findIndex(Boolean);
    tapAt(g, 60, mine);
    const lost = g.getState();
    assert.equal(lost.phase, 'lost');
    assert.equal(lost.mines[mine], true);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'en' ? /live mine/ : /触发了地雷/);
    for (const k of ['Space', 'Enter', 'KeyF', 'KeyH']) frame(g, 60, [k]);
    assert.equal(JSON.stringify(g.getState()), JSON.stringify(lost));
    assert.equal(h.ends.length, 1);
    g.draw(mockContext());
  }
});

test('public state never leaks hidden mines or numbers while a field is live', () => {
  const { g } = open(6);
  frame(g, 60, ['Space']);
  const s = g.getState();
  assert.deepEqual(s.mines, []);
  assert.ok(s.numbers.every((v, i) => (s.revealed[i] ? Number.isInteger(v) : v === null)));
  assert.equal('field' in s, false);
});
