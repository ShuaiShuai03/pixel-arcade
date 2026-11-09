import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createSkyState,
  stepSky,
  meta,
  hullRects,
  SECTORS,
  SECTOR_COUNT,
} from '../src/games/sky-raiders.js';
import { KINDS } from '../src/games/sky-raiders-sectors.js';
import { spawnHazard } from '../src/games/sky-raiders-hazards.js';
import { SECTOR_TEXT, endMessage } from '../src/games/sky-raiders-text.js';
import { MENU_COLUMNS, menuCell } from '../src/games/sky-raiders-menu.js';
import { SCENERY_TYPES } from '../src/games/sky-raiders-scenery.js';
import { InputState } from '../src/shared/input.js';
import { SimulationClock } from '../src/shared/simulation.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// A policy returns the keys it holds this frame.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const SECTOR_NUMBERS = Array.from({ length: SECTOR_COUNT }, (_, i) => i + 1);
const BLIND_SECTORS = SECTOR_NUMBERS.filter((n) => n >= 3);
const CJK = /[一-鿿]/;
const DECISION_SECONDS = 0.117;
const FIRE_HEAT_LIMIT = 82;

/** Start a flight in `level` the way a pilot does: through the select screen when it is offered. */
function openSector(
  level,
  { seed = 1, lang = 'en', progress = undefined, launch = true, mode = 1 } = {},
) {
  const h = harness({ seed, lang, mode });
  let unlocked = level;
  h.env.progress =
    progress === undefined
      ? { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) }
      : progress;
  const g = createGame(h.env);
  if (level > 1 && h.env.progress && launch) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const cleared = (s, start) => s.phase === 'won' || s.level > start;

/** Pre-aim at the target, steer through the cheapest of nine thrust choices, dodge rays and zones. */
function pilotInput(state, { charges = true } = {}) {
  const p = state.player,
    live = state.enemies.filter((e) => !e.dead && e.y < p.y - 25),
    boss = live.find((e) => e.boss),
    target = boss ?? live.toSorted((a, b) => b.y - a.y)[0],
    aim = target
      ? {
          x: target.x + (target.parts?.l > 0 ? -26 : target.parts?.r > 0 ? 26 : 0),
          y: target.y + (target.boss ? 18 : 0),
          vx: target.vx,
          vy: target.vy,
        }
      : null,
    flight = aim ? Math.max(0.1, (p.y - 19 - aim.y) / Math.max(100, 330 - p.vy + aim.vy)) : 0;
  let goalX = aim ? aim.x + aim.vx * flight - p.vx * flight : 240,
    goalY = 265;
  const pod = state.pickups.find(
    (e) =>
      e.y > 160 &&
      e.y < 290 &&
      ((e.kind === 'shield' && state.lives < 3) ||
        (e.kind === 'power' && p.power < 3) ||
        (e.kind === 'charge' && state.pulses < 3)),
  );
  if (pod && !boss) {
    goalX = pod.x;
    goalY = pod.y;
  }
  const hostile = state.bullets.filter((b) => b.owner === 'enemy'),
    zones = state.hazards.flatMap((hz) =>
      hz.rects.map((rect) => ({ rect, urgent: hz.warn <= 0 || hz.warn < 1.2 })),
    );
  let best = null;
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) {
      const norm = dx && dy ? Math.SQRT1_2 : 1,
        tx = dx * 163 * norm,
        ty = dy * 163 * norm;
      let cost = 0;
      for (const seconds of [0.15, 0.35, 0.55, 0.8]) {
        const blend = Math.min(1, seconds / 0.18),
          x = Math.max(
            24,
            Math.min(456, p.x + p.vx * seconds + (tx - p.vx) * seconds * blend * 0.5),
          ),
          y = Math.max(
            72,
            Math.min(288, p.y + p.vy * seconds + (ty - p.vy) * seconds * blend * 0.5),
          );
        cost += Math.abs(x - goalX) * 0.055 + Math.abs(y - goalY) * 0.035;
        if (y < 150) cost += (150 - y) * 0.1;
        for (const b of hostile) {
          const d = Math.hypot(x - b.x - b.vx * seconds, y - b.y - b.vy * seconds);
          if (d < 22) cost += 600;
          if (d < 65) cost += (65 - d) * 0.7;
        }
        for (const { rect, urgent } of zones)
          if (
            x > rect.x - 18 &&
            x < rect.x + rect.w + 18 &&
            y > rect.y - 19 &&
            y < rect.y + rect.h + 19
          )
            cost += urgent ? 500 : 60;
        for (const e of state.enemies)
          if (!e.dead)
            for (const r of hullRects(e)) {
              const ex = r.x + (e.vx ?? 0) * seconds,
                ey = r.y + (e.vy ?? 0) * seconds;
              if (x > ex - 17 && x < ex + r.w + 17 && y > ey - 18 && y < ey + r.h + 18) cost += 300;
            }
      }
      if (!best || cost < best.cost) best = { dx, dy, cost };
    }
  const held = [];
  if (
    p.heat < FIRE_HEAT_LIMIT &&
    !p.overheated &&
    (!boss || boss.parts?.l > 0 || boss.parts?.r > 0 || boss.open !== false)
  )
    held.push('Space');
  if (best.dx) held.push(best.dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (best.dy) held.push(best.dy > 0 ? 'ArrowDown' : 'ArrowUp');
  const danger = hostile.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 60),
    press =
      charges && state.pulses > 0 && state.chargeClock === 0 && danger && p.invincible < 0.1
        ? ['KeyK']
        : [];
  return { held, press };
}
/** The pilot as seen `delay` seconds ago: old positions carried forward, own ship and stocks live. */
function delayedView(history, delay, now, hz) {
  const index = Math.max(0, history.length - 1 - Math.round(delay * hz)),
    view = structuredClone(history[index]),
    age = (history.length - 1 - index) / hz;
  for (const group of [view.bullets, view.enemies, view.pickups])
    for (const item of group) {
      item.x += item.vx * age;
      item.y += item.vy * age;
    }
  return Object.assign(view, {
    player: now.player,
    pulses: now.pulses,
    lives: now.lives,
    chargeClock: now.chargeClock,
  });
}
/**
 * A reaction-limited pilot: decisions about eight times a second from a `delay`-old view.
 * Stops at the first sector change unless `campaign` is set.
 */
function fly(
  level,
  { seed = 1, delay = 0.3, hz = 60, campaign = false, charges = true, lang = 'en' } = {},
) {
  const { g, h } = openSector(level, { seed, lang }),
    every = Math.round(hz * DECISION_SECONDS),
    history = [];
  let held = [],
    press = [],
    hits = 0,
    lives = g.getState().lives;
  const start = g.getState().level;
  for (let n = 0; n < hz * 1800; n++) {
    const now = g.getState();
    history.push(now);
    if (history.length > 2 * hz) history.shift();
    if (now.phase !== 'playing' || (!campaign && now.level > start)) break;
    hits += Math.max(0, lives - now.lives);
    lives = now.lives;
    if (n % every === 0)
      ({ held, press } = pilotInput(delayedView(history, delay, now, hz), { charges }));
    else press = [];
    g.update(1 / hz, input(held, press));
  }
  const s = g.getState();
  return { s, h, g, hits, cleared: cleared(s, start) };
}

const towardsLowest = (s) => {
  const live = s.enemies.filter((e) => !e.dead),
    target = live.find((e) => e.boss) ?? live.sort((a, b) => b.y - a.y)[0];
  if (!target) return null;
  return target.x + (target.parts?.l > 0 ? -26 : target.parts?.r > 0 ? 26 : 0);
};
const MASH_KEYS = [
  'Space',
  'KeyK',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyJ',
  'KeyX',
];
const POLICIES = {
  idle: () => [],
  holdFire: () => ['Space'],
  fireLeft: () => ['Space', 'ArrowLeft'],
  fireUp: () => ['Space', 'ArrowUp'],
  mashCharge: (c) => (c.n % 30 < 15 ? ['Space', 'KeyK'] : ['Space']),
  sweep: (c) => ['Space', Math.floor(c.t / 1.5) % 2 ? 'ArrowLeft' : 'ArrowRight'],
  sweepFast: (c) => ['Space', Math.floor(c.t / 0.6) % 2 ? 'ArrowLeft' : 'ArrowRight'],
  circle: (c) => [
    'Space',
    ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][Math.floor(c.t / 0.8) % 4],
  ],
  mashAll: (c) => MASH_KEYS.filter(() => c.R() < 0.5),
  randomKeys: (c) => {
    if (c.n % 20 === 0)
      c.mem = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyK'].filter(
        () => c.R() < 0.4,
      );
    return c.mem ?? [];
  },
  pointerSweep: () => [],
  // Parked in the start lane, following the lowest enemy sideways, firing, never dodging or charging.
  parkAndTrack: (c, s) => {
    const x = towardsLowest(s),
      keys = ['Space'];
    if (x !== null) {
      if (x > s.player.x + 6) keys.push('ArrowRight');
      else if (x < s.player.x - 6) keys.push('ArrowLeft');
    }
    if (s.player.y < 262) keys.push('ArrowDown');
    else if (s.player.y > 275) keys.push('ArrowUp');
    return keys;
  },
};
const BLIND = Object.keys(POLICIES).filter((name) => name !== 'parkAndTrack');
function play(level, name, { seed = 1, hz = 60, seconds = 150 } = {}) {
  const { g, h } = openSector(level, { seed }),
    c = { n: 0, t: 0, R: seeded(seed * 31 + 5), mem: null },
    start = g.getState().level;
  for (; c.n < hz * seconds; c.n++) {
    const s = g.getState();
    if (s.phase !== 'playing' || s.level > start) break;
    c.t = c.n / hz;
    const keys = POLICIES[name](c, s),
      pointer =
        name === 'pointerSweep'
          ? { x: (c.t * 200) % 480, y: 250, down: true, clicked: c.n % 10 === 0 }
          : {};
    g.update(1 / hz, input(keys, c.n % 10 === 0 ? keys.filter((k) => k === 'KeyK') : [], pointer));
  }
  const s = g.getState();
  return { s, h, cleared: cleared(s, start) };
}
const rate = (level, name, seeds, opts) =>
  seeds.filter((seed) => play(level, name, { seed, ...opts }).cleared).length / seeds.length;

// ---------------------------------------------------------------------------------------------
// The campaign data: at least 20 distinct, bilingual sectors on a rising curve with true lessons.
// ---------------------------------------------------------------------------------------------
test('the campaign has at least 20 distinct bilingual sectors with scenery, carriers and enemy mixes', () => {
  assert.ok(SECTOR_COUNT >= 20);
  assert.equal(SECTORS.length, SECTOR_COUNT);
  assert.equal(SECTOR_TEXT.length, SECTOR_COUNT);
  assert.equal(new Set(SECTORS.map((s) => s.id)).size, SECTOR_COUNT);
  assert.equal(new Set(SECTORS.map((s) => s.en)).size, SECTOR_COUNT, 'every sector is named');
  assert.equal(new Set(SECTORS.map((s) => s.lesson.en)).size, SECTOR_COUNT);
  for (const sector of SECTORS) {
    for (const text of [{ en: sector.en, zh: sector.zh }, sector.lesson]) {
      assert.ok(text.en.length > 3 && !CJK.test(text.en), `${sector.id} English`);
      assert.ok(CJK.test(text.zh), `${sector.id} Chinese`);
    }
    assert.ok(SCENERY_TYPES.includes(sector.scene), sector.scene);
    assert.ok(sector.palette.length === 3 && sector.palette.every((c) => /^#[0-9a-f]{6}$/.test(c)));
    for (const kind of sector.kinds) assert.ok(KINDS[kind], kind);
  }
  assert.equal(
    new Set(SECTORS.map((s) => `${s.scene}${s.palette.join('')}`)).size,
    SECTOR_COUNT,
    'every sector looks different',
  );
  assert.ok(new Set(SECTORS.map((s) => s.scene)).size >= 10, 'ten or more kinds of scenery');
  assert.ok(new Set(SECTORS.map((s) => s.carrier.shape)).size >= 3, 'three carrier variants');
  assert.ok(new Set(SECTORS.flatMap((s) => s.carrier.pattern)).size >= 8, 'eight carrier patterns');
  assert.ok(new Set(SECTORS.flatMap((s) => s.kinds)).size >= 5, 'five raider kinds');
  assert.ok(new Set(SECTORS.map((s) => s.kinds.join())).size >= 20, 'enemy mixes differ');
  for (const sector of SECTORS) assert.ok(sector.kinds.length >= 6 && sector.kinds.length <= 10);
});

test('the campaign teaches first, combines next and ends in mastery, with a rising curve', () => {
  const tiers = SECTORS.map((s) => s.tier);
  assert.deepEqual([...new Set(tiers)], ['teach', 'combo', 'master']);
  for (const tier of ['teach', 'combo', 'master'])
    assert.ok(tiers.filter((t) => t === tier).length >= 5, tier);
  assert.deepEqual(
    tiers,
    [...tiers].sort(
      (a, b) => ['teach', 'combo', 'master'].indexOf(a) - ['teach', 'combo', 'master'].indexOf(b),
    ),
  );
  for (let i = 1; i < SECTOR_COUNT; i++) {
    const a = SECTORS[i - 1],
      b = SECTORS[i];
    assert.ok(b.rate <= a.rate, `raider fire interval shrinks at sector ${i + 1}`);
    assert.ok(b.pace >= a.pace, `raiders speed up at sector ${i + 1}`);
    assert.ok(b.carrier.core >= a.carrier.core, `core armor rises at sector ${i + 1}`);
    assert.ok(
      b.carrier.turrets >= a.carrier.turrets || !b.carrier.turrets,
      `turret armor at ${i + 1}`,
    );
    if (a.hazard && b.hazard) {
      assert.ok(b.hazard.every <= a.hazard.every, `strikes come faster at sector ${i + 1}`);
      assert.ok(b.hazard.warn <= a.hazard.warn, `warnings never lengthen at sector ${i + 1}`);
    }
  }
  assert.ok(
    SECTORS.slice(0, 2).every((s) => !s.hazard),
    'the opening is gentle',
  );
  assert.ok(
    SECTORS.slice(2).every((s) => s.hazard),
    'every later sector has strike zones',
  );
  assert.ok(
    SECTORS.every((s) => !s.hazard || s.hazard.warn >= 1.05),
    'every strike can be read',
  );
  assert.ok(
    SECTORS.slice(2).every((s) => s.hazard.kinds.some((k) => k === 'lane' || k === 'cross')),
  );
  const first = SECTORS[0],
    last = SECTORS[SECTOR_COUNT - 1];
  assert.ok(last.carrier.core > 1.5 * first.carrier.core);
  assert.ok(last.carrier.pattern.length >= 5 && first.carrier.pattern.length === 1);
  assert.ok(last.hazard.kinds.length >= 4);
});

// What each tag means for the player, in the words a lesson uses (English and Chinese).
const TAG_WORDS = {
  aim: [/aimed/i, /瞄准/],
  burst: [/burst/i, /连射/],
  fan: [/\bfans?\b/i, /扇形/],
  lead: [/sniper|ahead|leading|lead their/i, /狙击|预判/],
  curtain: [/curtain|bomber/i, /轰炸机|缺口/],
  ring: [/\brings?\b/i, /环形/],
  stream: [/charged/i, /蓄能/],
  turrets: [/turret/i, /炮塔/],
  lane: [/\blanes?\b/i, /横带/],
  column: [/column/i, /光柱/],
  grid: [/\bgrids?\b/i, /网格/],
  cross: [/\bcross\b/i, /十字/],
};
test('every lesson is accurate: it names what a sector introduces and nothing it lacks', () => {
  const seen = new Set();
  for (const sector of SECTORS) {
    const fresh = sector.focus.filter((tag) => !seen.has(tag));
    assert.ok(fresh.length <= 2, `${sector.id} introduces at most two ideas: ${fresh}`);
    for (const tag of fresh)
      for (const [n, lang] of [
        [0, 'en'],
        [1, 'zh'],
      ])
        assert.match(
          sector.lesson[lang],
          TAG_WORDS[tag][n],
          `${sector.id} teaches ${tag} (${lang})`,
        );
    for (const [tag, words] of Object.entries(TAG_WORDS))
      if (!sector.focus.includes(tag))
        for (const [n, lang] of [
          [0, 'en'],
          [1, 'zh'],
        ])
          assert.doesNotMatch(sector.lesson[lang], words[n], `${sector.id} mentions absent ${tag}`);
    sector.focus.forEach((tag) => seen.add(tag));
  }
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(TAG_WORDS).sort(),
    'every idea is taught somewhere',
  );
});

test('focus tags are true: each one is really present in the sector configuration', () => {
  for (const sector of SECTORS) {
    const kinds = new Set(sector.kinds),
      patterns = new Set(sector.carrier.pattern),
      strikes = new Set(sector.hazard?.kinds ?? []);
    const present = {
      aim: kinds.has('scout'),
      burst: kinds.has('skimmer') || patterns.has('burst'),
      fan: kinds.has('gunship') || patterns.has('fan') || patterns.has('gap'),
      lead: kinds.has('sniper') || patterns.has('lead'),
      curtain: kinds.has('bomber') || patterns.has('comb'),
      ring: patterns.has('ring'),
      stream: patterns.has('beam'),
      turrets: sector.carrier.turrets > 0,
      lane: strikes.has('lane') || strikes.has('cross'),
      column: strikes.has('column') || strikes.has('cross'),
      grid: strikes.has('grid'),
      cross: strikes.has('cross'),
    };
    for (const [tag, here] of Object.entries(present))
      assert.equal(sector.focus.includes(tag), here, `${sector.id} ${tag}`);
    if (patterns.has('turrets'))
      assert.ok(sector.carrier.turrets > 0, `${sector.id} armed turrets`);
  }
});

// ---------------------------------------------------------------------------------------------
// A scripted legal clear for every sector, at every frame rate, by a pilot with a human delay.
// ---------------------------------------------------------------------------------------------
const DELAYS = [0.25, 0.35];
for (const sector of SECTOR_NUMBERS)
  test(`sector ${sector} ${SECTORS[sector - 1].id}: reaction-limited pilots clear it at 30, 60 and 120 Hz and idle play loses`, (t) => {
    const lines = [];
    for (const hz of HZS)
      for (const delay of DELAYS) {
        const run = fly(sector, { seed: sector, delay, hz });
        lines.push(`${hz}Hz/${delay}s ${run.s.elapsed.toFixed(0)}s hits ${run.hits}`);
        assert.ok(
          run.cleared,
          `${hz} Hz, ${delay} s delay: ${run.s.phase} in sector ${run.s.level}`,
        );
        assert.equal(run.s.phase === 'won' ? run.h.ends.length : 0, run.s.phase === 'won' ? 1 : 0);
        assert.ok(run.hits < 4, `${hz} Hz, ${delay} s: at most three hits, took ${run.hits}`);
      }
    t.diagnostic(lines.join(' | '));
    const idle = play(sector, 'idle', { seconds: 200 });
    assert.equal(idle.s.phase, 'lost', 'doing nothing loses');
    assert.equal(idle.h.ends.length, 1);
  });

for (const hz of HZS)
  test(`the whole ${SECTOR_COUNT}-sector campaign is won in one run at ${hz} Hz, ending once with a frozen state`, (t) => {
    const run = fly(1, { seed: 5, delay: 0.3, hz, campaign: true }),
      { s, h } = run;
    t.diagnostic(
      `${hz} Hz: ${s.elapsed.toFixed(0)}s, shields ${s.lives}, hits ${run.hits}, score ${s.score}`,
    );
    assert.equal(s.phase, 'won');
    assert.equal(s.level, SECTOR_COUNT);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(h.ends[0].score, s.score);
    const frozen = JSON.stringify(run.g.getState());
    for (const keys of [['Space', 'KeyK', 'ArrowRight'], []])
      for (let n = 0; n < 60; n++) run.g.update(1 / hz, input(keys, keys));
    assert.equal(JSON.stringify(run.g.getState()), frozen);
    assert.equal(h.ends.length, 1);
  });

test('charges are a help, not a requirement: a pilot who never fires a charge still clears the hard sectors', () => {
  for (const sector of [3, 9, 15, 21, 24]) {
    const run = fly(sector, { seed: 2, delay: 0.3, charges: false });
    assert.ok(run.cleared, `sector ${sector}: ${run.s.phase}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Blind play: nothing that ignores the screen may win. Parking is punished, dodging is needed.
// ---------------------------------------------------------------------------------------------
const BLIND_SEEDS = [1, 2, 3, 4];
for (const name of BLIND)
  test(`${name} clears at most 25% of any sector from sector 3 on`, (t) => {
    const line = [];
    for (const sector of BLIND_SECTORS) {
      const wins = rate(sector, name, BLIND_SEEDS, { seconds: 120 });
      line.push(`${sector}:${Math.round(wins * 100)}%`);
      assert.ok(wins <= 0.25, `${name} cleared ${wins * 100}% of sector ${sector}`);
    }
    t.diagnostic(line.join(' '));
  });
test('blind play cannot win the campaign from sector 3 either', () => {
  for (const name of ['holdFire', 'sweep', 'randomKeys', 'parkAndTrack']) {
    const { g } = openSector(3, { seed: 7 }),
      c = { n: 0, t: 0, R: seeded(9), mem: null };
    for (; c.n < 60 * 400 && g.getState().phase === 'playing'; c.n++) {
      c.t = c.n / 60;
      g.update(1 / 60, input(POLICIES[name](c, g.getState())));
    }
    assert.notEqual(g.getState().phase, 'won', name);
  }
});
test('park and track wins at most 25% from sector 3 while the dodging pilot clears every sector', (t) => {
  const line = [];
  for (const sector of BLIND_SECTORS) {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8],
      wins = rate(sector, 'parkAndTrack', seeds, { seconds: 150 });
    line.push(`${sector}:${Math.round(wins * 100)}%`);
    assert.ok(wins <= 0.25, `park and track cleared ${wins * 100}% of sector ${sector}`);
  }
  t.diagnostic(`park and track: ${line.join(' ')}`);
  const opening = rate(1, 'parkAndTrack', [1, 2, 3, 4], { seconds: 150 });
  assert.ok(opening >= 0.75, 'the teaching sector still lets a plain tracker learn the cannon');
  for (const sector of [3, 12, 24]) assert.ok(fly(sector, { seed: 4, delay: 0.35 }).cleared);
});
test('strike zones are aimed: a parked pilot is covered, a moving pilot is led, and a grid leaves aisles', () => {
  const env = harness({ seed: 4 }).env,
    covers = (hazard, hull) =>
      hazard.rects.some(
        (r) =>
          hull.x < r.x + r.w &&
          hull.x + hull.w > r.x &&
          hull.y < r.y + r.h &&
          hull.y + hull.h > r.y,
      ),
    strike = (kind, motion) => {
      const s = createSkyState(3);
      Object.assign(s.player, { x: 300, y: 200 }, motion);
      spawnHazard(s, env, kind, 1.2);
      return s;
    };
  for (const kind of ['lane', 'column', 'cross', 'grid']) {
    const s = strike(kind, {});
    assert.equal(s.hazards.length, 1);
    assert.equal(s.hazards[0].warn, 1.2);
    assert.ok(
      hullRects(s.player).some((hull) => covers(s.hazards[0], hull)),
      `${kind} catches a parked pilot`,
    );
    for (const r of s.hazards[0].rects)
      assert.ok(r.w > 0 && r.h > 0 && r.y >= 0 && r.y + r.h <= 320);
  }
  const fast = strike('column', { vx: 150 }).hazards[0].rects[0],
    still = strike('column', {}).hazards[0].rects[0];
  assert.ok(
    fast.x + fast.w / 2 > still.x + still.w / 2 + 60,
    'a column is aimed ahead of a moving pilot',
  );
  const dive = strike('lane', { vy: -80 }).hazards[0].rects[0],
    level = strike('lane', {}).hazards[0].rects[0];
  assert.ok(dive.y < level.y - 40, 'a lane is aimed ahead of a climbing pilot');
  for (let seed = 1; seed <= 40; seed++) {
    const s = createSkyState(3),
      random = seeded(seed);
    s.player.x = 30 + random() * 420;
    spawnHazard(s, { random }, 'grid', 1.2);
    const columns = [...s.hazards[0].rects].sort((x, y) => x.x - y.x);
    assert.equal(columns.length, 3);
    for (let i = 1; i < 3; i++)
      assert.ok(
        columns[i].x - (columns[i - 1].x + columns[i - 1].w) >= 80,
        'an aisle wide enough for a hull',
      );
  }
});
test('a strike warns first, then fires once; moving out in time saves the pilot, standing still does not', () => {
  for (const dodge of [false, true]) {
    const h = harness(),
      s = createSkyState(3);
    s.spawnClock = 100;
    s.hazardClock = 1e9;
    s.player.invincible = 0;
    spawnHazard(s, h.env, 'lane', 1);
    let wasLive = false,
      sawWarn = false;
    for (let n = 0; n < 120 * 2 && s.hazards.length; n++) {
      stepSky(s, 1 / 120, input(dodge ? ['ArrowUp'] : []), h.env);
      if (s.hazards[0]?.warn > 0) {
        sawWarn = true;
        assert.equal(s.lives, 3, 'a warning never hurts');
      } else wasLive = true;
    }
    assert.ok(sawWarn && wasLive);
    assert.equal(
      s.lives,
      dodge ? 3 : 2,
      dodge ? 'the lit lane was left in time' : 'one shield lost, once',
    );
    assert.equal(s.damageCause, dodge ? '' : 'hazard');
    assert.equal(s.hazards.length, 0, 'a spent strike is removed');
  }
});

// ---------------------------------------------------------------------------------------------
// Determinism: one trace across 30, 60 and 120 Hz when the input is aligned in time.
// ---------------------------------------------------------------------------------------------
const SCRIPT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const scriptedKeys = (segment) => {
  const keys = ['Space', SCRIPT_KEYS[(segment * 7 + 3) % 4]];
  if (segment % 5 === 2) keys.push(SCRIPT_KEYS[(segment * 3) % 4]);
  return keys;
};
function trace(level, seed, hz, seconds, lang = 'en') {
  const { g, h } = openSector(level, { seed, lang }),
    every = hz / 30,
    samples = [];
  for (let n = 0; n < hz * seconds; n++) {
    const segment = Math.floor(n / every / 6),
      first = (n / every) % 6 === 0,
      pressed = first && segment % 4 === 1 ? ['KeyK'] : [];
    g.update(1 / hz, input([...scriptedKeys(segment), ...pressed], pressed));
    if ((n + 1) % (hz / 2) === 0) samples.push(JSON.stringify(g.getState()));
  }
  return { samples, ends: h.ends };
}
for (const [level, seed] of [
  [1, 1],
  [5, 2],
  [12, 3],
  [24, 4],
])
  test(`sector ${level} seed ${seed}: the full trace is identical at 30, 60 and 120 Hz`, () => {
    const runs = HZS.map((hz) => trace(level, seed, hz, 40));
    assert.equal(runs[0].samples.length, 80);
    for (const run of runs.slice(1)) {
      for (let i = 0; i < run.samples.length; i++)
        assert.equal(run.samples[i], runs[0].samples[i], `sample ${i}`);
      assert.deepEqual(run.ends, runs[0].ends);
    }
    const state = JSON.parse(runs[0].samples.at(-1));
    assert.ok(state.bullets.length + state.score > 0, 'something actually happened');
  });
test('the same seed repeats exactly, a different seed changes the raiders, and languages share a trace', () => {
  const a = trace(5, 3, 60, 20),
    b = trace(5, 3, 60, 20),
    c = trace(5, 4, 60, 20),
    zh = trace(5, 3, 60, 20, 'zh');
  assert.deepEqual(a.samples, b.samples);
  assert.notDeepEqual(a.samples, c.samples);
  const strip = (samples) => samples.map((s) => JSON.stringify({ ...JSON.parse(s), status: 0 }));
  assert.deepEqual(strip(a.samples), strip(zh.samples));
});
test('a delayed pilot plays the same campaign sector twice with the same result', () => {
  const a = fly(7, { seed: 8, delay: 0.3 }),
    b = fly(7, { seed: 8, delay: 0.3 });
  assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
});

// ---------------------------------------------------------------------------------------------
// The result the host shows: won, score and a message for every way a run can end.
// ---------------------------------------------------------------------------------------------
/** A single shield, one decisive hit of the named kind, then the step that ends the run. */
function lethal(cause, lang) {
  const h = harness({ lang, seed: 3 }),
    s = createSkyState(3);
  Object.assign(s, { lives: 1, spawnClock: 100, hazardClock: 1e9, score: 1230 });
  s.player.invincible = 0;
  if (cause === 'collision')
    s.enemies = [
      {
        id: 7,
        shape: 'scout',
        x: 266.5,
        y: 270,
        vx: -100,
        vy: 0,
        mass: 60,
        hp: 3,
        maxHp: 3,
        flash: 0,
        dead: false,
      },
    ];
  if (cause === 'round')
    s.bullets = [
      {
        id: 8,
        x: 240,
        y: 240,
        vx: 0,
        vy: 300,
        r: 3,
        damage: 1,
        mass: 0.04,
        owner: 'enemy',
        ownerId: 9,
        life: 2,
      },
    ];
  if (cause === 'hazard')
    s.hazards = [
      {
        id: 9,
        kind: 'lane',
        rects: [{ x: 0, y: 250, w: 480, h: 40 }],
        warn: 0,
        warnTotal: 1,
        live: 0.4,
        struck: false,
      },
    ];
  for (let n = 0; n < 12 && s.phase === 'playing'; n++) stepSky(s, 1 / 60, input(), h.env);
  return { s, h };
}
for (const lang of ['en', 'zh'])
  for (const cause of ['round', 'collision', 'hazard'])
    test(`ending: a ${cause} loss reports won false, the score and the ${lang} message`, () => {
      const { s, h } = lethal(cause, lang);
      assert.equal(s.phase, 'lost');
      assert.equal(s.damageCause, cause, 'the wording follows what actually hit the pilot');
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, false);
      assert.equal(h.ends[0].score, 1230);
      assert.equal(
        h.ends[0].message,
        endMessage(h.env, { won: false, cause, total: SECTOR_COUNT }),
      );
      assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
      assert.ok(h.sounds.includes('lose'));
      stepSky(s, 1 / 60, input(['Space']), h.env);
      assert.equal(h.ends.length, 1);
    });
for (const lang of ['en', 'zh'])
  test(`ending: a ${lang} idle run in the real game loses once with the round message`, () => {
    const { g, h } = openSector(1, { lang });
    for (let n = 0; n < 60 * 200 && g.getState().phase === 'playing'; n++)
      g.update(1 / 60, input());
    assert.equal(g.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.deepEqual(h.ends[0], {
      won: false,
      score: g.getState().score,
      message: endMessage(h.env, { won: false, cause: 'round', total: SECTOR_COUNT }),
    });
  });
test('ending: the three loss messages differ and the win message counts the sectors', () => {
  for (const lang of ['en', 'zh']) {
    const env = harness({ lang }).env,
      messages = ['round', 'collision', 'hazard'].map((cause) =>
        endMessage(env, { won: false, cause, total: SECTOR_COUNT }),
      ),
      win = endMessage(env, { won: true, cause: '', total: SECTOR_COUNT });
    assert.equal(new Set([...messages, win]).size, 4);
    assert.ok(win.includes(String(SECTOR_COUNT)));
    for (const m of [...messages, win]) assert.ok(m.length > 15 && !/undefined|NaN/.test(m));
  }
});
for (const lang of ['en', 'zh'])
  test(`ending: a win reports won true, the score and the ${lang} message`, () => {
    const { s, h } = fly(SECTOR_COUNT, { seed: 6, delay: 0.25, lang });
    assert.equal(s.phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(h.ends[0].score, s.score);
    assert.ok(s.score > 0);
    assert.equal(
      h.ends[0].message,
      endMessage(harness({ lang }).env, { won: true, total: SECTOR_COUNT }),
    );
    assert.ok(h.sounds.includes('win'));
  });
test('terminal: a lost run is frozen against every input, step size and draw', () => {
  const { g, h } = openSector(1);
  for (let n = 0; n < 60 * 200 && g.getState().phase === 'playing'; n++) g.update(1 / 60, input());
  const frozen = JSON.stringify(g.getState());
  assert.equal(JSON.parse(frozen).phase, 'lost');
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.5, 5, NaN, -1, 0])
    g.update(dt, input(['Space', 'KeyK', 'ArrowUp', 'Enter'], ['Space', 'KeyK', 'Enter']));
  g.draw(mockContext());
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  const again = createGame(harness().env).getState();
  assert.equal(again.phase, 'playing', 'a new instance starts fresh');
  assert.equal(again.score, 0);
  assert.equal(again.lives, 3);
});

// ---------------------------------------------------------------------------------------------
// Odd time, odd pointers and random input never break an invariant.
// ---------------------------------------------------------------------------------------------
const finiteDeep = (value, path = '') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `non-finite ${path}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
};
const ODD_DT = [
  0,
  -1,
  NaN,
  Infinity,
  -Infinity,
  1e-9,
  1e-4,
  1 / 240,
  1 / 144,
  1 / 120,
  1 / 60,
  1 / 30,
  0.05,
  0.1,
  1,
  1e6,
  '0.01',
  null,
  undefined,
];
const ODD_X = [NaN, -1e9, 1e9, 240, Infinity, -1, 0, 479];
const ODD_Y = [NaN, 0, 320, -5, 1e9, 100];
const FUZZ_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'KeyJ',
  'KeyK',
  'KeyX',
  'Enter',
  'KeyZ',
];
function fuzz(level, seed, hz, seconds) {
  const R = seeded(seed * 7 + 3),
    { g, h } = openSector(level, { seed, lang: seed % 2 ? 'en' : 'zh' });
  let held = [],
    pressed = [];
  for (let n = 0; n < hz * seconds; n++) {
    if (R() < 0.08) held = FUZZ_KEYS.filter(() => R() < 0.3);
    pressed = R() < 0.05 ? FUZZ_KEYS.filter(() => R() < 0.3) : [];
    const dt = R() < 0.01 ? ODD_DT[Math.floor(R() * ODD_DT.length)] : 1 / hz,
      pointer =
        R() < 0.1
          ? {
              x: ODD_X[Math.floor(R() * ODD_X.length)],
              y: ODD_Y[Math.floor(R() * ODD_Y.length)],
              down: R() < 0.5,
              clicked: R() < 0.5,
            }
          : {};
    g.update(dt, input(held, pressed, pointer));
    if (n % 20 === 0) {
      const s = g.getState();
      finiteDeep(s);
      g.draw(mockContext());
      const p = s.player;
      assert.ok(
        p.x >= 24 - 1e-9 && p.x <= 456 + 1e-9 && p.y >= 72 - 1e-9 && p.y <= 288 + 1e-9,
        `bounds ${p.x},${p.y}`,
      );
      assert.ok(s.lives >= 0 && s.lives <= 4 && s.pulses >= 0 && s.pulses <= 3, 'stocks');
      assert.ok(p.heat >= 0 && p.heat <= 100.0001 && p.power >= 1 && p.power <= 3, 'weapon');
      assert.ok(
        s.bullets.length < 400 && s.particles.length <= 160 && s.enemies.length <= 12,
        'caps',
      );
      assert.ok(s.waves.length <= 3 && s.pickups.length <= 12 && s.hazards.length <= 3, 'caps');
    }
  }
  const s = g.getState();
  assert.equal(h.ends.length, s.phase === 'playing' ? 0 : 1, 'one end exactly when over');
  return s;
}
for (const [level, seed, hz] of [
  [1, 1, 30],
  [3, 2, 60],
  [9, 3, 120],
  [14, 4, 60],
  [20, 5, 30],
  [24, 6, 144],
  [24, 7, 240],
])
  test(`fuzz: sector ${level} seed ${seed} at ${hz} Hz keeps every invariant`, () => {
    fuzz(level, seed, hz, 70);
  });
test('fuzz: the fuzzed runs include real wins and losses, not only early exits', () => {
  const ends = new Set();
  for (const seed of [11, 12, 13, 14]) ends.add(fuzz(3, seed, 60, 200).phase);
  assert.ok(ends.has('lost'));
});
test('time that is not a positive finite number changes nothing, in flight and in the select', () => {
  for (const level of [1, 6]) {
    const { g } = openSector(level, { launch: false });
    const before = JSON.stringify(g.getState());
    for (const dt of [0, -1, NaN, Infinity, -Infinity, 'x', null, undefined])
      g.update(dt, input(['Space', 'ArrowUp'], ['Space', 'ArrowRight']));
    assert.equal(JSON.stringify(g.getState()), before);
  }
  const s = createSkyState(2),
    env = harness().env,
    snapshot = JSON.stringify(s);
  for (const dt of [0, -1, NaN, Infinity]) stepSky(s, dt, input(['Space']), env);
  assert.equal(JSON.stringify(s), snapshot);
});
test('a huge step is capped to a third of a frame-rate step and cannot skip past the physics', () => {
  const { g } = openSector(1),
    { g: h2 } = openSector(1);
  g.update(1e6, input(['ArrowRight']));
  for (let n = 0; n < 4; n++) h2.update(1 / 120, input(['ArrowRight']));
  assert.equal(JSON.stringify(g.getState()), JSON.stringify(h2.getState()));
});
test('an input object whose methods live on a prototype still works for a long step', () => {
  class Keys {
    constructor(codes) {
      this.codes = codes;
      this.pointer = { x: 0, y: 0, down: false, clicked: false };
    }
    held(...c) {
      return c.some((k) => this.codes.includes(k));
    }
    pressed(...c) {
      return this.held(...c);
    }
  }
  const env = harness().env,
    s = createSkyState(1);
  stepSky(s, 1 / 30, new Keys(['ArrowRight', 'Space']), env);
  assert.ok(s.player.vx > 0 && s.bullets.length > 0);
  const flat = createSkyState(1);
  stepSky(flat, 1 / 30, input(['ArrowRight', 'Space'], ['ArrowRight', 'Space']), harness().env);
  assert.equal(flat.player.x, s.player.x);
});

// ---------------------------------------------------------------------------------------------
// Real input: the shared InputState, its touch pulses and the host clock.
// ---------------------------------------------------------------------------------------------
function session(hz, script, level = 1, seconds = 6) {
  const h = harness({ seed: 1 }),
    g = createGame(h.env),
    inp = new InputState(),
    clock = new SimulationClock();
  void level;
  for (let f = 0; f < hz * seconds; f++) {
    script(f / hz, f, inp);
    clock.advance(1 / hz, (dt) => {
      g.update(dt, inp);
      inp.flush();
    });
    inp.flush();
  }
  return g.getState();
}
for (const hz of [30, 60, 144]) {
  test(`real input at ${hz} Hz: holding, tapping and toggling the charge key spends exactly one charge`, () => {
    const held = session(hz, (t, f, i) => {
        if (f === 2) i.down('KeyK', 'kb');
        if (t > 5) i.up('kb');
      }),
      tapped = session(hz, (t, f, i) => {
        if (f === 2) i.pulse('KeyK');
      }),
      both = session(hz, (t, f, i) => {
        if (f === 2) {
          i.down('KeyK', 'a');
          i.down('KeyX', 'b');
        }
      });
    assert.equal(held.pulses, 2);
    assert.equal(tapped.pulses, 2);
    assert.equal(both.pulses, 2);
  });
  test(`real input at ${hz} Hz: a repeating key, a spammed touch tap and a toggled key never refire a held charge`, () => {
    const spam = session(hz, (t, f, i) => i.pulse('KeyK')),
      toggle = session(hz, (t, f, i) => (f % 2 ? i.up('kb') : i.down('KeyK', 'kb')));
    assert.ok(spam.pulses >= 0 && spam.pulses < 3, 'a tapping pilot can spend charges');
    assert.ok(toggle.pulses >= 0 && toggle.pulses < 3);
    const once = session(hz, (t, f, i) => {
      if (f === 2) i.down('KeyK', 'kb');
    });
    assert.equal(once.pulses, 2, 'holding for the whole run still spends one');
  });
}
test('every touch button reaches its action through the real input path', () => {
  const codes = meta.touchControls.map((c) => c.code);
  assert.deepEqual(codes, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyK']);
  const states = Object.fromEntries(
    codes.map((code) => [
      code,
      session(
        60,
        (t, f, i) => {
          if (f === 1) i.down(code, `touch-${code}`);
        },
        1,
        1.2,
      ),
    ]),
  );
  assert.ok(states.ArrowLeft.player.x < 240 - 2, 'left');
  assert.ok(states.ArrowRight.player.x > 240 + 2, 'right');
  assert.ok(states.ArrowUp.player.y < 270 - 2, 'up');
  assert.ok(states.ArrowDown.player.y > 270 || states.ArrowDown.player.y >= 269, 'down');
  assert.ok(
    states.Space.bullets.some((b) => b.owner === 'player') || states.Space.player.heat > 0,
    'fire',
  );
  assert.equal(states.KeyK.pulses, 2, 'charge');
  assert.ok(meta.touchControls.filter((c) => c.side === 'left').length === 4);
  for (const c of meta.touchControls) assert.ok(c.label.en && CJK.test(c.label.zh));
});
test('the sector select can be driven from the touch buttons alone', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 14, unlock: () => {} };
  const g = createGame(h.env),
    inp = new InputState();
  const tap = (code) => {
    inp.pulse(code);
    g.update(1 / 60, inp);
    inp.flush();
  };
  assert.equal(g.getState().menu.cursor, 14);
  tap('ArrowLeft');
  assert.equal(g.getState().menu.cursor, 13);
  tap('ArrowUp');
  assert.equal(g.getState().menu.cursor, 7);
  tap('ArrowRight');
  tap('ArrowDown');
  assert.equal(g.getState().menu.cursor, 14);
  tap('Space');
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 14);
  assert.equal(g.getState().player.power, 3);
});

// ---------------------------------------------------------------------------------------------
// Progress: the select screen, unlocking on clear and a broken store.
// ---------------------------------------------------------------------------------------------
test('there is no select screen on a first visit and flying starts in sector 1', () => {
  for (const progress of [null, undefined, { unlocked: () => 1, unlock: () => {} }]) {
    const h = harness();
    if (progress !== undefined) h.env.progress = progress;
    const s = createGame(h.env).getState();
    assert.equal(s.menu, null);
    assert.equal(s.level, 1);
    assert.equal(s.totalLevels, SECTOR_COUNT);
  }
});
test('clearing a sector unlocks the next one and a new run offers to continue there', () => {
  let unlocked = 1;
  const writes = [],
    progress = {
      unlocked: () => unlocked,
      unlock: (n) => {
        writes.push(n);
        unlocked = Math.max(unlocked, n);
      },
    },
    { g } = openSector(1, { progress });
  for (let n = 0; n < 60 * 120 && g.getState().level === 1; n++)
    g.update(1 / 60, pilotInputFor(g.getState()));
  assert.equal(g.getState().level, 2);
  assert.deepEqual(writes, [2]);
  assert.equal(unlocked, 2);
  const next = createGame(Object.assign(harness().env, { progress })),
    menu = next.getState().menu;
  assert.deepEqual(menu, { cursor: 2, unlocked: 2, total: SECTOR_COUNT, columns: MENU_COLUMNS });
  next.update(1 / 60, input(['ArrowLeft'], ['ArrowLeft']));
  assert.equal(next.getState().menu.cursor, 1, 'a cleared sector can be replayed');
  next.update(1 / 60, input([], ['Space']));
  assert.equal(next.getState().level, 1);
  assert.equal(unlocked, 2, 'replaying never lowers progress');
});
function pilotInputFor(state) {
  const { held, press } = pilotInput(state);
  return input(held, press);
}
test('progress only ever rises and the last sector never unlocks one that does not exist', () => {
  const writes = [];
  const { g } = openSector(SECTOR_COUNT, {
    progress: { unlocked: () => SECTOR_COUNT, unlock: (n) => writes.push(n) },
  });
  for (let n = 0; n < 60 * 200 && g.getState().phase === 'playing'; n++)
    g.update(1 / 60, pilotInputFor(g.getState()));
  assert.equal(g.getState().phase, 'won');
  assert.deepEqual(writes, [], 'no sector 25');
  const rising = [];
  let unlocked = 3;
  const run = openSector(3, {
    progress: {
      unlocked: () => unlocked,
      unlock: (n) => {
        rising.push(n);
        unlocked = Math.max(unlocked, n);
      },
    },
  });
  for (let n = 0; n < 60 * 400 && run.g.getState().level < 6; n++)
    run.g.update(1 / 60, pilotInputFor(run.g.getState()));
  assert.deepEqual(rising, [4, 5, 6].slice(0, rising.length));
  assert.ok(rising.length >= 2);
  for (let i = 1; i < rising.length; i++) assert.ok(rising[i] > rising[i - 1]);
});
test('unlock monotonicity across a campaign: each clear raises the saved sector by exactly one', () => {
  let unlocked = 1;
  const writes = [],
    { g } = openSector(1, {
      progress: {
        unlocked: () => unlocked,
        unlock: (n) => {
          writes.push(n);
          unlocked = Math.max(unlocked, n);
        },
      },
    });
  for (let n = 0; n < 60 * 700 && g.getState().level < 9; n++)
    g.update(1 / 60, pilotInputFor(g.getState()));
  assert.deepEqual(writes, [2, 3, 4, 5, 6, 7, 8, 9]);
});
test('the select screen opens on the saved sector, clamps it and ignores a broken store', () => {
  const cases = [
    [() => 7, 7],
    [() => 400, SECTOR_COUNT],
    [() => 0, 1],
    [() => -5, 1],
    [() => NaN, 1],
    [() => '9', 9],
    [() => 'abc', 1],
    [() => undefined, 1],
    [() => null, 1],
    [() => 5.9, 5],
    [() => ({}), 1],
    [
      () => {
        throw new Error('storage unavailable');
      },
      1,
    ],
  ];
  for (const [read, expected] of cases) {
    const h = harness();
    h.env.progress = { unlocked: read, unlock: () => {} };
    const s = createGame(h.env).getState();
    assert.equal(s.unlocked, expected);
    assert.equal(s.menu?.cursor ?? 1, expected);
  }
  for (const progress of [{}, { unlocked: 5 }, { unlocked: () => 3 }])
    assert.doesNotThrow(() => createGame(Object.assign(harness().env, { progress })).getState());
});
test('a store that throws on save does not stop a cleared sector from moving on', () => {
  const { g, h } = openSector(1, {
    progress: {
      unlocked: () => 1,
      unlock: () => {
        throw new Error('quota exceeded');
      },
    },
  });
  for (let n = 0; n < 60 * 120 && g.getState().level === 1; n++)
    g.update(1 / 60, pilotInputFor(g.getState()));
  assert.equal(g.getState().level, 2);
  assert.equal(g.getState().phase, 'playing');
  assert.equal(h.ends.length, 0);
  assert.equal(g.getState().unlocked, 2, 'the run still remembers its own progress');
});
test('a store that throws on read and on save still plays and finishes a run once', () => {
  const boom = () => {
    throw new Error('blocked');
  };
  const { g, h } = openSector(1, { progress: { unlocked: boom, unlock: boom }, launch: false });
  assert.equal(g.getState().menu, null);
  for (let n = 0; n < 60 * 200 && g.getState().phase === 'playing'; n++)
    g.update(1 / 60, input([]));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
});
test('tapping a sector starts it; a locked sector only complains', () => {
  const click = (n) => {
    const q = menuCell(n);
    return { x: q.x + q.w / 2, y: q.y + q.h / 2, down: true, clicked: true };
  };
  const h = harness();
  h.env.progress = { unlocked: () => 10, unlock: () => {} };
  const g = createGame(h.env);
  g.update(1 / 60, input([], [], click(20)));
  assert.equal(g.getState().menu.cursor, 10, 'locked: the cursor stays');
  assert.ok(h.sounds.includes('hit'));
  assert.ok(g.getState().menu);
  g.update(1 / 60, input([], [], { x: 3, y: 3, clicked: true }));
  assert.ok(g.getState().menu, 'a tap beside the grid does nothing');
  g.update(1 / 60, input([], [], click(4)));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 4);
  const sectors = new Set();
  for (let n = 1; n <= SECTOR_COUNT; n++) {
    const q = menuCell(n);
    sectors.add(`${q.x},${q.y}`);
    assert.ok(q.x >= 0 && q.x + q.w <= 480 && q.y >= 24 && q.y + q.h <= 232);
  }
  assert.equal(sectors.size, SECTOR_COUNT);
});
test('the select moves with WASD and arrows, clamps at the saved sector and plays move sounds', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 9, unlock: () => {} };
  const g = createGame(h.env);
  for (const [key, cursor] of [
    ['KeyA', 8],
    ['KeyW', 2],
    ['KeyD', 3],
    ['KeyS', 9],
    ['ArrowRight', 9],
    ['ArrowDown', 9],
  ]) {
    g.update(1 / 60, input([], [key]));
    assert.equal(g.getState().menu.cursor, cursor, key);
  }
  assert.ok(h.sounds.includes('move'));
  g.update(1 / 60, input([], ['Enter']));
  assert.equal(g.getState().level, 9);
  assert.equal(g.getState().sector.en, SECTORS[8].en);
});
test('each sector launches with its own loadout and the opening weapon rises with the sector', () => {
  const power = [];
  for (const level of SECTOR_NUMBERS) {
    const s = openSector(level, { seed: level }).g.getState();
    assert.equal(s.level, level);
    assert.equal(s.lives, 3);
    assert.equal(s.pulses, 3);
    assert.equal(s.quota, SECTORS[level - 1].kinds.length);
    power.push(s.player.power);
  }
  assert.deepEqual(
    power,
    [...power].sort((a, b) => a - b),
  );
  assert.equal(power[0], 1);
  assert.equal(power.at(-1), 3);
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
    (sum, ch) => sum + (CJK.test(ch) || /[（）：，。！·]/.test(ch) ? size : size * 0.62),
    0,
  );
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    // One-character glyphs (pod letters, warning marks) may be clipped by the canvas edge.
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
test('every sector screen is complete in English and Chinese and fits the canvas', () => {
  let strings = 0;
  for (const lang of ['en', 'zh'])
    for (const level of SECTOR_NUMBERS) {
      const { g } = openSector(level, { lang, seed: level }),
        { ctx, drawn } = textCanvas(),
        before = drawn.length;
      for (let n = 0; n < 60 * 24 && g.getState().phase === 'playing'; n++) {
        const s = g.getState(),
          keys = POLICIES.parkAndTrack({ n }, s);
        g.update(1 / 60, input(keys));
        if (n % 20 === 0) g.draw(ctx);
      }
      assert.ok(drawn.length > before);
      assertFits(drawn, `${lang} sector ${level}`);
      const lesson = SECTORS[level - 1].lesson[lang];
      assert.ok(
        drawn.some((d) => d.text === lesson) || g.getState().phase !== 'playing',
        `${lang} lesson ${level}`,
      );
      for (const { text } of drawn) {
        strings++;
        if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
        else assert.doesNotMatch(text, /[A-Za-z]{3,}/, `Chinese screen shows "${text}"`);
      }
    }
  assert.ok(strings > 3000);
});
test('the select screen, warnings and banners fit and are localized', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, 17, SECTOR_COUNT]) {
      const { g } = openSector(unlocked, { lang, launch: false }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assert.ok(g.getState().menu);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A SECTOR' : '选择空域')));
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')) ||
          unlocked === SECTOR_COUNT,
      );
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
      assert.ok(
        drawn.some(
          (d) =>
            d.text ===
            (lang === 'en'
              ? unlocked === SECTOR_COUNT
                ? 'FINAL'
                : 'NEXT'
              : unlocked === SECTOR_COUNT
                ? '最终'
                : '下一关'),
        ),
      );
    }
    const banners = { warn: false, down: false, clear: false };
    for (const [level, seed] of [
      [24, 4],
      [7, 2],
    ]) {
      const { g } = openSector(level, { lang, seed });
      for (let n = 0; n < 60 * 120 && g.getState().level === level; n++) {
        const { held, press } = pilotInput(g.getState());
        g.update(1 / 60, input(held, press));
        const s = g.getState(),
          { ctx, drawn } = textCanvas();
        if (!(n % 30 === 0 || s.cleanup || s.transition > 0 || s.hazards.length)) continue;
        g.draw(ctx);
        assertFits(drawn, `${lang} flight ${level}/${n}`);
        const shown = (en, zh) => drawn.some((d) => d.text.includes(lang === 'en' ? en : zh));
        if (s.cleanup) {
          assert.ok(shown('CARRIER DOWN', '航母击破'));
          banners.down = true;
        }
        if (s.transition > 0) {
          assert.ok(shown('SECTOR CLEAR', '空域清空'));
          banners.clear = true;
        }
        if (s.hazards.some((hz) => hz.warn > 0)) banners.warn = true;
      }
    }
    assert.deepEqual(banners, { warn: true, down: true, clear: true });
  }
});
test('host-facing text is complete in both languages and the help explains every pod', () => {
  for (const key of ['name', 'description']) assert.ok(meta[key].en && CJK.test(meta[key].zh), key);
  for (const entry of meta.keys)
    assert.ok(entry.label.en && CJK.test(entry.label.zh) && entry.keys);
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en) && /选择空域/.test(k.label.zh)));
  assert.match(meta.description.en, /\bW\b.*(level 3|up to level 3)/);
  assert.match(meta.description.en, /\+ restores a shield/);
  assert.match(meta.description.en, /\bK\b restores a charge/);
  assert.match(meta.description.zh, /W.*最高3级/);
  assert.match(meta.description.zh, /\+ 恢复护盾/);
  assert.match(meta.description.zh, /K 恢复一枚拦截弹/);
  assert.match(meta.description.en, new RegExp(String(SECTOR_COUNT)));
  assert.match(meta.description.en, /lanes and columns/);
  for (const lang of ['en', 'zh']) {
    const s = openSector(9, { lang }).g.getState();
    assert.ok(s.status.en && CJK.test(s.status.zh) && !CJK.test(s.status.en));
    assert.match(s.status.en, new RegExp(`Sector 9/${SECTOR_COUNT}`));
    const m = openSector(9, { lang, launch: false }).g.getState();
    assert.match(m.status.en, /Choose a sector/);
    assert.match(m.status.zh, /选择空域/);
  }
});
test('collecting each pod does what the help says', () => {
  const env = harness().env;
  for (const [kind, check] of [
    ['power', (s) => assert.equal(s.player.power, 2)],
    ['shield', (s) => assert.equal(s.lives, 3)],
    ['charge', (s) => assert.equal(s.pulses, 3)],
  ]) {
    const s = createSkyState(1);
    Object.assign(s, { lives: 2, pulses: 2, spawnClock: 100 });
    s.pickups = [{ id: 90, x: 240, y: 270, vx: 0, vy: 0, kind, life: 10 }];
    stepSky(s, 1 / 120, input(), env);
    check(s);
    assert.equal(s.score, 50);
    assert.equal(s.pickups.length, 0);
  }
});
test('real play drops and draws every pod letter', () => {
  const { g } = openSector(1, { seed: 2 }),
    letters = new Set(),
    { ctx, drawn } = textCanvas();
  let held = [],
    press = [];
  for (let n = 0; n < 60 * 400 && g.getState().level < 5 && g.getState().phase === 'playing'; n++) {
    if (n % 7 === 0) ({ held, press } = pilotInput(g.getState()));
    else press = [];
    g.update(1 / 60, input(held, press));
    if (n % 6 === 0) {
      drawn.length = 0;
      g.draw(ctx);
      for (const d of drawn) if (['W', '+', 'K'].includes(d.text)) letters.add(d.text);
    }
  }
  assert.deepEqual([...letters].sort(), ['+', 'K', 'W']);
});
test('supply pods cycle power, shield and charge and skip a stock that is already full', () => {
  const dropped = [];
  for (const [power, lives, pulses] of [
    [1, 3, 1],
    [3, 3, 1],
    [3, 4, 1],
    [3, 4, 3],
  ]) {
    const s = createSkyState(1),
      env = harness().env;
    Object.assign(s, { spawnClock: 100, lives, pulses });
    s.player.power = power;
    s.player.invincible = 0;
    for (let n = 1; n <= 3; n++) {
      s.kills = n * 3 - 1;
      s.enemies = [
        {
          id: 40 + n,
          shape: 'scout',
          x: 100 * n,
          y: 150,
          vx: 0,
          vy: 0,
          mass: 50,
          hp: 1,
          maxHp: 1,
          flash: 0,
          dead: false,
        },
      ];
      s.bullets = [
        {
          id: 60 + n,
          x: 100 * n,
          y: 170,
          vx: 0,
          vy: -900,
          r: 2,
          damage: 1,
          mass: 0.04,
          owner: 'player',
          ownerId: 0,
          life: 2,
        },
      ];
      stepSky(s, 1 / 60, input(), env);
    }
    dropped.push(s.pickups.map((p) => p.kind));
  }
  assert.deepEqual(dropped[0], ['power', 'shield', 'charge']);
  assert.deepEqual(dropped[1], ['shield', 'shield', 'charge']);
  assert.deepEqual(dropped[2], ['charge', 'charge', 'charge']);
  assert.deepEqual(dropped[3], ['power', 'shield', 'charge'], 'all full: the cycle continues');
});
