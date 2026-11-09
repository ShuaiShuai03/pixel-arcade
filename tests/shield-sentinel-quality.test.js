import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS,
  LEVEL_COUNT,
  INTRO_BOX,
  PROMPTS,
  createGame,
  createWorld,
  meta,
} from '../src/games/shield-sentinel.js';
import { levelNumber, levelOf } from '../src/games/shield-sentinel-levels.js';
import { TIP_WIDTH, textWidth, wrapLines } from '../src/games/shield-sentinel-draw.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/shield-sentinel-menu.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// ---------------------------------------------------------------------------------------------
const DIRS = [
  ['ArrowRight'],
  ['ArrowRight', 'ArrowDown'],
  ['ArrowDown'],
  ['ArrowLeft', 'ArrowDown'],
  ['ArrowLeft'],
  ['ArrowLeft', 'ArrowUp'],
  ['ArrowUp'],
  ['ArrowRight', 'ArrowUp'],
];
const dirKeys = (angle) => DIRS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
const LIMITS = { x0: 52, x1: 428, y0: 90, y1: 256 };
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const laneHalf = (dx, dy) =>
  Math.abs(dy) * 8 + Math.abs(dx) * 12 + 3 * (Math.abs(dx) + Math.abs(dy));
const SHOT_SPEED_GUESS = 160;

function laneDodge(s) {
  const p = s.sentinel;
  const lanes = [];
  for (const f of s.foes) {
    if (f.hp > 0 && f.charge?.kind === 'lance')
      lanes.push({ ox: f.x, oy: f.y, dx: f.charge.dirx, dy: f.charge.diry });
  }
  for (const sh of s.shots) {
    if (sh.kind === 'lance' && !sh.reflected) {
      const sp = Math.hypot(sh.vx, sh.vy);
      lanes.push({ ox: sh.x, oy: sh.y, dx: sh.vx / sp, dy: sh.vy / sp });
    }
  }
  for (const l of lanes) {
    const d = (p.x - l.ox) * -l.dy + (p.y - l.oy) * l.dx;
    if (Math.abs(d) >= laneHalf(l.dx, l.dy) + 8) continue;
    const room = (sign) => {
      const nx = clampTo(p.x + sign * -l.dy * 60, LIMITS.x0, LIMITS.x1);
      const ny = clampTo(p.y + sign * l.dx * 60, LIMITS.y0, LIMITS.y1);
      return Math.abs((nx - l.ox) * -l.dy + (ny - l.oy) * l.dx);
    };
    const sign = room(1) >= room(-1) ? 1 : -1;
    return dirKeys(Math.atan2(sign * l.dx, sign * -l.dy));
  }
  return null;
}
function slamEscape(s) {
  const p = s.sentinel;
  for (const f of s.foes) {
    const c = f.hp > 0 && f.charge;
    if (c?.kind !== 'slam' || Math.hypot(p.x - c.lx, p.y - c.ly) >= c.r + 16) continue;
    let best = null;
    DIRS.forEach((keys, i) => {
      const a = (i * Math.PI) / 4;
      const nx = clampTo(p.x + Math.cos(a) * 70, LIMITS.x0, LIMITS.x1);
      const ny = clampTo(p.y + Math.sin(a) * 70, LIMITS.y0, LIMITS.y1);
      const d = Math.hypot(nx - c.lx, ny - c.ly);
      if (!best || d > best.d) best = { d, keys };
    });
    return best.keys;
  }
  return null;
}
/** The nearest-in-time orb or slug, whether still charging or already flying. */
function nearestThreat(s) {
  const p = s.sentinel;
  const threats = [];
  for (const f of s.foes) {
    const k = f.hp > 0 && f.charge?.kind;
    if (k === 'orb' || k === 'slug') {
      const eta = f.charge.dur - f.charge.t + Math.hypot(f.x - p.x, f.y - p.y) / SHOT_SPEED_GUESS;
      threats.push({ eta, x: f.x, y: f.y });
    }
  }
  for (const sh of s.shots) {
    if (sh.reflected || (sh.kind !== 'orb' && sh.kind !== 'slug')) continue;
    threats.push({
      eta: Math.hypot(sh.x - p.x, sh.y - p.y) / Math.hypot(sh.vx, sh.vy),
      x: sh.x,
      y: sh.y,
    });
  }
  return threats.sort((a, b) => a.eta - b.eta)[0] ?? null;
}

function decide(s, { delay = 0, lead = Infinity } = {}) {
  const p = s.sentinel;
  const dodge = laneDodge(s) ?? slamEscape(s);
  if (dodge) return { held: dodge, pressed: [] };
  const near = s.crawlers
    .filter((c) => c.portal <= 0)
    .map((c) => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) }))
    .filter((e) => e.d < 42)
    .sort((a, b) => a.d - b.d)[0];
  if (near) return { held: dirKeys(Math.atan2(near.c.y - p.y, near.c.x - p.x)), pressed: ['KeyX'] };
  const threat = nearestThreat(s);
  if (threat && threat.eta <= delay + lead)
    return { held: [...dirKeys(Math.atan2(threat.y - p.y, threat.x - p.x)), 'Space'], pressed: [] };
  return { held: [], pressed: [] };
}

function openLevel(level, { seed = 1, lang = 'en', progress } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = progress ?? {
    unlocked: () => unlocked,
    unlock: (n) => (unlocked = Math.max(unlocked, n)),
  };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

/** Play one level with the reaction-limited policy; resolves when the level is cleared or lost. */
function playLevel(
  level,
  { hz = 60, seed = 1, delay = 0.25, maxSeconds = 150, lead = Infinity } = {},
) {
  const { g, h } = openLevel(level, { seed });
  const dt = 1 / hz;
  const lag = Math.round(delay * hz);
  const history = [];
  let lowestHp = 5;
  for (let f = 0; f < maxSeconds * hz; f++) {
    const s = g.getState();
    if (s.phase !== 'playing' || s.level > level) break;
    lowestHp = Math.min(lowestHp, s.hp);
    history.push(s);
    if (history.length > lag + 1) history.shift();
    const a = decide(history[0], { delay, lead });
    g.update(dt, input(a.held, a.pressed));
  }
  const s = g.getState();
  return {
    lowestHp,
    cleared: s.phase === 'won' || s.level > level,
    state: s,
    ends: h.ends,
    seconds: s.time,
  };
}

const BLIND_DIRS = [
  ['ArrowLeft', 'ArrowRight'],
  ['ArrowUp', 'ArrowDown'],
  ['ArrowLeft', 'ArrowUp'],
  ['ArrowRight', 'ArrowDown'],
];
/** Blind players read nothing from the game. Each maps (frame, hz) to keys. */
function blindPolicies(seed) {
  const r = seeded(seed * 31 + 7);
  const out = {
    idle: () => ({ held: [], pressed: [] }),
    holdShield: () => ({ held: ['Space'], pressed: [] }),
    mash: (f) => ({
      held: f % 2 ? ['Space', 'ArrowLeft'] : ['ArrowRight', 'ArrowUp'],
      pressed: f % 5 === 0 ? ['KeyX'] : [],
    }),
    random: () => ({
      held: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].filter(() => r() < 0.4),
      pressed: r() < 0.1 ? ['KeyX'] : [],
    }),
  };
  for (const period of [0.5, 0.9, 1.4, 2.2])
    BLIND_DIRS.forEach((pair, i) => {
      out[`hold+${pair.join('/')}@${period}`] = (f, hz) => ({
        held: ['Space', pair[Math.floor(f / hz / period) % 2]],
        pressed: [],
      });
      out[`bash+${pair.join('/')}@${period}`] = (f, hz) => ({
        held: [pair[Math.floor(f / hz / period) % 2], ...(i % 2 ? ['Space'] : [])],
        pressed: f % 40 === 0 ? ['KeyX'] : [],
      });
    });
  return out;
}
function playBlind(level, policy, { hz = 30, maxSeconds = 120, seed = 1 } = {}) {
  const { g } = openLevel(level, { seed });
  for (let f = 0; f < maxSeconds * hz; f++) {
    const s = g.getState();
    if (s.phase !== 'playing' || s.level > level) break;
    const a = policy(f, hz);
    g.update(1 / hz, input(a.held, a.pressed));
  }
  const s = g.getState();
  return s.phase === 'won' || s.level > level;
}

/** Play from `level` until the game itself ends (the last level is a win). */
function playToEnd(level, lang) {
  const { g, h } = openLevel(level, { lang });
  const lag = 15;
  const history = [];
  for (let f = 0; f < 60 * 200 && !h.ends.length; f++) {
    history.push(g.getState());
    if (history.length > lag + 1) history.shift();
    const a = decide(history[0], { delay: 0.25, lead: Infinity });
    g.update(1 / 60, input(a.held, a.pressed));
  }
  return h;
}

const HZS = [30, 60, 120];
const REACTIONS = [0.25, 0.35];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const CJK = /[一-鿿]/;
const CANVAS_MARGIN = 456;
const MAX_TIP_LINES = 2;
const BLIND_PERIODS = [0.5, 1.4];

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
test('quality: there are 20 data-driven levels on a teaching, combination and mastery curve', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.equal(LEVELS.length, LEVEL_COUNT);
  assert.deepEqual([...new Set(LEVELS.map((l) => l.tier))], ['teach', 'combo', 'master']);
  assert.ok(LEVELS.filter((l) => l.tier === 'teach').length >= 6);
  assert.ok(LEVELS.filter((l) => l.tier === 'master').length >= 5);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => JSON.stringify(l))).size, LEVEL_COUNT);
  assert.equal(levelOf(0), LEVELS[0]);
  assert.equal(levelOf(999), LEVELS[LEVEL_COUNT - 1]);
  assert.equal(levelOf('x'), LEVELS[0]);
  assert.equal(levelNumber(7.9), 7);
  assert.equal(LEVELS.filter((l) => l.guardian).length, 5);
  const speed = (l) => l.orbSpeed;
  const mean = (tier, f) => {
    const rows = LEVELS.filter((l) => l.tier === tier);
    return rows.reduce((n, l) => n + f(l), 0) / rows.length;
  };
  assert.ok(
    mean('master', speed) > mean('combo', speed) && mean('combo', speed) > mean('teach', speed),
  );
  assert.ok(mean('master', (l) => l.rest) < mean('combo', (l) => l.rest));
  assert.ok(mean('master', (l) => l.crawlerSpeed) > mean('combo', (l) => l.crawlerSpeed));
});

test('quality: exported level data is frozen', () => {
  for (const data of [
    LEVELS,
    LEVELS[0],
    LEVELS[0].tip,
    LEVELS[0].foes,
    LEVELS[0].foes[0],
    LEVELS[0].foes[0].pattern,
    LEVELS[3].crawlers,
  ]) {
    assert.ok(Object.isFrozen(data));
  }
  assert.throws(() => {
    LEVELS[0].rest = 9;
  });
});

test('quality: every level has accurate bilingual names and tips that fit the 480 px canvas', () => {
  for (const [i, level] of LEVELS.entries()) {
    const tag = `level ${i + 1}`;
    for (const part of [level.name, level.tip]) {
      assert.ok(part.en.length > 3 && !CJK.test(part.en), `${tag} EN`);
      assert.ok(CJK.test(part.zh), `${tag} ZH`);
    }
    for (const lang of ['en', 'zh']) {
      const lines = wrapLines(level.tip[lang], 14, TIP_WIDTH);
      assert.ok(lines.length <= MAX_TIP_LINES, `${tag} ${lang} tip lines`);
      assert.ok(
        lines.every((l) => textWidth(l, 14) <= CANVAS_MARGIN),
        `${tag} ${lang} tip width`,
      );
      assert.ok(textWidth(`${i + 1}. ${level.name[lang]}`, 16) <= CANVAS_MARGIN, `${tag} name`);
    }
  }
  assert.deepEqual(wrapLines('one two', 14, 1000), ['one two']);
});

const kinds = (level) => new Set(level.foes.flatMap((f) => f.pattern));
test('quality: tips only name what the level really contains, and the first appearance is taught', () => {
  const words = {
    slug: [/slug/i, (l) => kinds(l).has('slug')],
    crawler: [/crawler/i, (l) => l.crawlers.length > 0],
    lance: [/lance|red lane/i, (l) => kinds(l).has('lance')],
    slam: [/slam/i, (l) => kinds(l).has('slam')],
    boss: [/warden|guardian/i, (l) => l.guardian],
  };
  for (const [name, [pattern, has]] of Object.entries(words)) {
    let first = null;
    LEVELS.forEach((level, i) => {
      if (pattern.test(level.tip.en)) assert.ok(has(level), `level ${i + 1} tip names ${name}`);
      if (has(level) && first === null) first = i;
    });
    assert.match(LEVELS[first].tip.en, pattern, `${name} is taught where it first appears`);
  }
  const tip = (n) => LEVELS[n - 1].tip.en;
  assert.ok(/Seven crawlers/.test(tip(17)) && LEVELS[16].crawlers.length === 7);
  assert.ok(/Five turrets/.test(tip(19)) && LEVELS[18].foes.length === 5);
  assert.ok(
    /three turrets/.test(tip(11)) &&
      LEVELS[10].foes.filter((f) => f.pattern.includes('lance')).length === 3,
  );
  assert.ok(/Four turrets/.test(tip(13)) && LEVELS[12].foes.length === 4);
  assert.ok(/side walls/.test(tip(6)) && LEVELS[5].foes.some((f) => f.x === 16 || f.x === 464));
  assert.ok(/roof and both walls/.test(tip(8)) && LEVELS[7].foes.some((f) => f.x === 464));
  assert.ok(/much faster/.test(tip(15)) && LEVELS[14].orbSpeed >= 200);
  assert.ok(/cannot move while it is up/.test(tip(16)));
  assert.ok(/twice/.test(tip(7)));
});

// ---------------------------------------------------------------------------------------------
// Fair for humans: a reaction-limited player who sees only the public state
// ---------------------------------------------------------------------------------------------
test('quality: a reaction-limited, public-state player clears every level at 30, 60 and 120 Hz', () => {
  const damage = new Map();
  for (const level of LEVEL_NUMBERS) {
    for (const delay of REACTIONS) {
      for (const hz of HZS) {
        for (const seed of [1, 2]) {
          const r = playLevel(level, { hz, seed, delay });
          assert.ok(r.cleared, `level ${level} ${delay}s ${hz}Hz seed ${seed}: ${r.state.phase}`);
          assert.ok(
            r.lowestHp >= 2,
            `level ${level} ${delay}s ${hz}Hz seed ${seed} fell to ${r.lowestHp} HP`,
          );
          assert.ok(r.seconds < 100, `level ${level} took ${r.seconds}s`);
          assert.equal(r.ends.length, level === LEVEL_COUNT ? 1 : 0);
          if (hz === 60 && delay === 0.35)
            damage.set(level, (damage.get(level) ?? 0) + 5 - r.lowestHp);
        }
      }
    }
  }
  const mean = (from, to) =>
    LEVEL_NUMBERS.filter((n) => n >= from && n <= to).reduce((s, n) => s + damage.get(n), 0) /
    (to - from + 1);
  assert.ok(mean(15, 20) > mean(8, 14), `mastery ${mean(15, 20)} vs combination ${mean(8, 14)}`);
});

test('quality: a player who never acts survives the opening and then loses fairly', () => {
  for (const level of [1, 10, 20]) {
    const { g, h } = openLevel(level);
    let lastWarning = -1;
    let firstHurt = null;
    for (let i = 0; i < 60 * 300 && !h.ends.length; i++) {
      const before = g.getState();
      if (before.foes.some((f) => f.charge) || before.shots.length) lastWarning = before.time;
      g.update(1 / 60, input([]));
      const after = g.getState();
      if (after.hp < before.hp) {
        firstHurt ??= before.time;
        assert.ok(lastWarning >= 0 && before.time - lastWarning < 5);
      }
    }
    assert.ok(firstHurt > 4, `level ${level}: first hit at ${firstHurt}s`);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
  }
});

test('quality: the level banner never covers the sentinel or any foe', () => {
  const inside = (x0, y0, x1, y1) =>
    x1 > INTRO_BOX.x &&
    x0 < INTRO_BOX.x + INTRO_BOX.w &&
    y1 > INTRO_BOX.y &&
    y0 < INTRO_BOX.y + INTRO_BOX.h;
  for (const n of LEVEL_NUMBERS) {
    const w = createWorld(seeded(1), n);
    assert.ok(!inside(w.p.x - 30, w.p.y - 30, w.p.x + 30, w.p.y + 30), `level ${n} sentinel`);
    for (const f of w.foes)
      assert.ok(!inside(f.x - f.hw, f.y - f.hh, f.x + f.hw, f.y + f.hh + 18), `level ${n} foe`);
  }
});

test('quality: prompts name keys, stay put long enough to read and never flip back and forth', () => {
  const dwell = [];
  for (const level of [3, 8, 14]) {
    const { g, h } = openLevel(level, { seed: 2 });
    const history = [];
    const prompts = [];
    for (let f = 0; f < 60 * 80 && !h.ends.length; f++) {
      const s = g.getState();
      if (s.level > level) break;
      if (!prompts.length || prompts.at(-1).key !== s.prompt.key)
        prompts.push({ key: s.prompt.key, t: s.time });
      history.push(s);
      if (history.length > 16) history.shift();
      const a = decide(history[0], { delay: 0.25 });
      g.update(1 / 60, input(a.held, a.pressed));
    }
    prompts.forEach((p, n) => {
      dwell.push({ key: p.key, d: (prompts[n + 1]?.t ?? g.getState().time) - p.t });
      const back = prompts[n + 2];
      if (back && back.key === p.key) assert.ok(back.t - p.t > 0.4, `${p.key} flips back`);
    });
  }
  const shown = dwell.filter((e) => e.key !== 'idle');
  const brief = shown.filter((e) => e.d < 0.25).length;
  assert.ok(brief / shown.length <= 0.1, `${brief}/${shown.length} prompts shown under 0.25 s`);
  for (const key of ['orb', 'slug', 'crawler', 'intro', 'idle'])
    assert.match(PROMPTS[key][0], /Space|X|Arrows/);
});

// ---------------------------------------------------------------------------------------------
// No blind wins
// ---------------------------------------------------------------------------------------------
test('quality: idle, mash, random and hold-plus-alternate players win nothing from level 3', () => {
  const names = Object.keys(blindPolicies(1)).filter(
    (n) => !n.includes('@') || BLIND_PERIODS.some((p) => n.endsWith(`@${p}`)),
  );
  assert.ok(names.length >= 20);
  for (const level of LEVEL_NUMBERS.filter((n) => n >= 3)) {
    let runs = 0;
    let wins = 0;
    for (const name of names) {
      for (const seed of [1, 2]) {
        runs++;
        if (playBlind(level, blindPolicies(seed)[name], { seed, maxSeconds: 70 })) wins++;
      }
    }
    assert.ok(wins / runs <= 0.25, `level ${level}: ${wins}/${runs} blind wins`);
    assert.equal(wins, 0, `level ${level}: ${wins}/${runs} blind wins`);
  }
});

// ---------------------------------------------------------------------------------------------
// Select, continue and robustness
// ---------------------------------------------------------------------------------------------
const store = (unlocked) => ({ unlocked: () => unlocked, unlock() {} });
const press = (...codes) => input([], codes);

test('quality: the level select lists the saved progress, starts the chosen level and clamps junk', () => {
  const fresh = harness();
  fresh.env.progress = store(1);
  const first = createGame(fresh.env);
  assert.equal(first.getState().menu, null, 'a new player goes straight into level 1');
  assert.equal(first.getState().level, 1);

  for (const [raw, expected] of [
    [7, 7],
    [7.9, 7],
    [-4, 1],
    [0, 1],
    [1e9, 20],
    ['9', 9],
    [NaN, 1],
    [undefined, 1],
    [null, 1],
    [Infinity, 1],
  ]) {
    const h = harness();
    h.env.progress = store(raw);
    const s = createGame(h.env).getState();
    assert.equal(s.unlocked, expected, String(raw));
    assert.equal(s.menu === null, expected === 1, String(raw));
    if (s.menu)
      assert.deepEqual([s.menu.cursor, s.menu.total, s.menu.columns], [expected, 20, MENU_COLUMNS]);
  }
  const h = harness();
  h.env.progress = {
    unlocked: () => {
      throw new Error('storage blocked');
    },
    unlock: () => {
      throw new Error('storage blocked');
    },
  };
  assert.equal(createGame(h.env).getState().unlocked, 1);

  const sel = harness();
  sel.env.progress = store(12);
  const g = createGame(sel.env);
  g.update(1 / 60, press('ArrowLeft'));
  assert.equal(g.getState().menu.cursor, 11);
  g.update(1 / 60, press('ArrowUp'));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, press('KeyD'));
  g.update(1 / 60, press('ArrowDown'));
  assert.equal(g.getState().menu.cursor, 12, 'the cursor cannot pass the unlocked level');
  g.update(1 / 60, press('ArrowRight'));
  assert.equal(g.getState().menu.cursor, 12);
  g.update(1 / 60, input([], [], { x: menuCell(15).x + 3, y: menuCell(15).y + 3, clicked: true }));
  assert.equal(g.getState().menu.cursor, 12, 'a locked cell cannot be chosen');
  assert.ok(sel.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: menuCell(3).x + 3, y: menuCell(3).y + 3, clicked: true }));
  assert.equal(g.getState().level, 3, 'tapping an unlocked cell starts it');
  assert.equal(g.getState().menu, null);

  const keys = harness();
  keys.env.progress = store(5);
  const k = createGame(keys.env);
  k.update(1 / 60, press('Enter'));
  assert.equal(k.getState().level, 5);
  for (const code of ['Space', 'NumpadEnter']) {
    const again = harness();
    again.env.progress = store(2);
    const m = createGame(again.env);
    m.update(1 / 60, press(code));
    assert.equal(m.getState().level, 2);
  }
  assert.deepEqual(menuTarget(input(), 1, 1), {
    cursor: 1,
    moved: false,
    denied: false,
    start: false,
    byKey: false,
  });
  assert.deepEqual(menuTarget({ pressed: () => false }, 1, 1).start, false);
});

test('quality: clearing a level unlocks the next, survives a throwing store and never lowers progress', () => {
  const saved = [];
  const progress = { unlocked: () => 1, unlock: (n) => saved.push(n) };
  const h = harness();
  h.env.progress = progress;
  const g = createGame(h.env);
  const history = [];
  for (let f = 0; f < 60 * 60 && g.getState().level < 3; f++) {
    history.push(g.getState());
    if (history.length > 16) history.shift();
    const a = decide(history[0], { delay: 0.25 });
    g.update(1 / 60, input(a.held, a.pressed));
  }
  assert.deepEqual(saved, [2, 3]);
  assert.equal(g.getState().unlocked, 3);

  const broken = harness();
  broken.env.progress = {
    unlocked: () => 1,
    unlock: () => {
      throw new Error('quota');
    },
  };
  const r = createGame(broken.env);
  history.length = 0;
  for (let f = 0; f < 60 * 40 && r.getState().level < 2; f++) {
    history.push(r.getState());
    if (history.length > 16) history.shift();
    const a = decide(history[0], { delay: 0.25 });
    r.update(1 / 60, input(a.held, a.pressed));
  }
  assert.equal(r.getState().level, 2, 'a throwing store does not stop play');
});

test('quality: a shield key still held from the level select does not raise the shield until released', () => {
  const h = harness();
  h.env.progress = store(4);
  const g = createGame(h.env);
  g.update(1 / 60, input(['Space'], ['Space']));
  for (let i = 0; i < 30; i++) g.update(1 / 60, input(['Space']));
  assert.equal(g.getState().sentinel.shieldUp, false);
  assert.equal(g.getState().sentinel.energy, 100);
  g.update(1 / 60, input([]));
  g.update(1 / 60, input(['Space']));
  assert.equal(g.getState().sentinel.shieldUp, true);
});

test('quality: a bash tapped just before it is ready, or between ticks, is buffered', () => {
  const h = harness();
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['KeyX']));
  assert.equal(g.getState().sentinel.bashActive, true);
  const moves = () => h.sounds.filter((s) => s === 'move').length;
  assert.equal(moves(), 1);
  for (let i = 0; i < 40; i++) g.update(1 / 60, input([]));
  assert.ok(g.getState().sentinel.bashCooldown > 0.05, 'still cooling down');
  g.update(1 / 60, input([], ['KeyX']));
  for (let i = 0; i < 20; i++) g.update(1 / 60, input([]));
  assert.equal(moves(), 2, 'the early tap fired as soon as the cooldown ended');
  for (let i = 0; i < 90; i++) g.update(1 / 60, input([]));
  g.update(1 / 240, input([], ['KeyX']));
  assert.equal(moves(), 2, 'a sub-tick frame has no tick yet');
  g.update(1 / 60, input([]));
  assert.equal(moves(), 3, 'the press from the sub-tick frame is not lost');
});

test('quality: hostile dt and pointer values never throw or corrupt the game', () => {
  const dts = [
    0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    1e9,
    5,
    1e-12,
    1 / 30,
    0.2,
    'a',
    null,
    undefined,
    {},
  ];
  const pointers = [
    {},
    { x: NaN, y: NaN, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: 'a', y: null, clicked: true },
    { x: 1e12, y: -1e12, clicked: true, down: true },
    undefined,
    null,
  ];
  for (const unlocked of [1, 9]) {
    const h = harness({ seed: 4 });
    h.env.progress = store(unlocked);
    const g = createGame(h.env);
    for (let i = 0; i < 400; i++) {
      const pointer = pointers[i % pointers.length];
      const keys = i % 3 ? ['Space', 'ArrowLeft'] : ['ArrowUp', 'KeyD'];
      const frame = { ...input(keys, i % 7 ? [] : ['KeyX', 'Enter']), pointer };
      assert.doesNotThrow(() => g.update(dts[i % dts.length], frame));
      const s = g.getState();
      assert.ok(
        Number.isFinite(s.sentinel.x) && Number.isFinite(s.sentinel.y) && Number.isFinite(s.score),
      );
    }
    assert.doesNotThrow(() => g.draw(mockContext()));
    assert.ok(h.ends.length <= 1);
  }
});

test('quality: draw covers the select screen and every level in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = store(20);
    const g = createGame(h.env);
    assert.doesNotThrow(() => g.draw(mockContext()));
    g.update(1 / 60, press('ArrowLeft'));
    assert.doesNotThrow(() => g.draw(mockContext()));
    for (const n of LEVEL_NUMBERS) {
      const w = createWorld(seeded(n), n);
      const game = createGame({ ...h.env, progress: undefined });
      assert.doesNotThrow(() => game.draw(mockContext()));
      assert.ok(w.foes.length > 0);
    }
  }
  assert.equal(meta.touchControls.length, 6);
});

// ---------------------------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------------------------
test('quality: the final level ends the game exactly once with an EN or ZH win, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    const h = playToEnd(LEVEL_COUNT, lang);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(h.ends[0].message, lang === 'zh' ? CJK : /^The observatory is safe/);
    assert.ok(h.sounds.includes('win'));
  }
  const h = harness({ seed: 3 });
  h.env.progress = store(LEVEL_COUNT);
  const g = createGame(h.env);
  g.update(1 / 60, press('Space'));
  const history = [];
  for (let f = 0; f < 60 * 120 && !h.ends.length; f++) {
    history.push(g.getState());
    if (history.length > 16) history.shift();
    const a = decide(history[0], { delay: 0.25 });
    g.update(1 / 60, input(a.held, a.pressed));
  }
  const done = structuredClone(g.getState());
  assert.equal(done.phase, 'won');
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['Space', 'ArrowLeft'], ['KeyX', 'Space']));
  assert.deepEqual(g.getState(), done);
  assert.equal(h.ends.length, 1);
});

test('quality: losing ends the game exactly once with an EN or ZH message, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang, seed: 2 });
    const g = createGame(h.env);
    for (let i = 0; i < 60 * 120 && !h.ends.length; i++) g.update(1 / 30, input([]));
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'zh' ? CJK : /red lanes and purple circles/);
    const done = structuredClone(g.getState());
    for (let i = 0; i < 90; i++) g.update(1 / 60, input(['Space'], ['KeyX']));
    assert.deepEqual(g.getState(), done);
    assert.equal(h.ends.length, 1);
    assert.ok(h.sounds.includes('lose'));
  }
});

test('quality: the same scripted input gives the same game at every frame rate', () => {
  const states = HZS.map((hz) => {
    const h = harness({ seed: 6 });
    h.env.progress = store(10);
    const g = createGame(h.env);
    g.update(1 / hz, press('Space'));
    for (let f = 0; f < hz * 12; f++) {
      const t = f / hz;
      const keys = [
        Math.floor(t / 1.5) % 2 ? 'ArrowLeft' : 'ArrowRight',
        ...(Math.floor(t) % 3 ? ['Space'] : []),
      ];
      g.update(1 / hz, input(keys));
    }
    const s = g.getState();
    return [
      s.hp,
      s.sentinel.x.toFixed(0),
      s.sentinel.y.toFixed(0),
      s.foes.map((x) => x.hp),
      s.score,
    ];
  });
  assert.deepEqual(states[0], states[1]);
  assert.deepEqual(states[1], states[2]);
});
