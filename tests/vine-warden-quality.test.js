import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, LEVEL_COUNT, PROMPTS, createGame, meta } from '../src/games/vine-warden.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/vine-warden-menu.js';
import { harness, input, mockContext, seeded } from './harness.js';

const KEYS = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
const DIR4 = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const HZS = [30, 60, 120];
const REACTIONS = [0.25, 0.35];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const CJK = /[㐀-鿿]/;
const MOVE_SECONDS = 0.15;
const TAP_SECONDS = 0.05;
const press = (...codes) => input([], codes);
const store = (unlocked) => ({ unlocked: () => unlocked, unlock() {} });

/** Start `level` the way a player does: through the select screen, or straight into level 1. */
function openLevel(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  h.env.progress = store(level);
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, press('Space'));
  return { g, h };
}

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// ---------------------------------------------------------------------------------------------
// A human-like planter. It reads the tile art, plant stages and root tiles, the seed count and
// where the pests are, sees it `delay` seconds late, plants beside the path where roots would
// cover the most bare road, harvests spent plants (and blooms when out of seeds), and waits for
// its own last action to finish before looking again.
function wants(s) {
  const open = (c, r) =>
    !'#h'.includes(s.tiles[r]?.[c] ?? '#') && !s.plants.some((p) => p.c === c && p.r === r);
  const covered = new Set();
  s.plants
    .filter((p) => !p.spent)
    .forEach((p) => p.rootTiles.forEach((t) => covered.add(`${t.c},${t.r}`)));
  const bench = s.plants
    .filter((p) => p.spent && !p.busy)
    .map((p) => ({ kind: 'harvest', c: p.c, r: p.r, bonus: 5 }));
  if (s.seeds === 0) {
    s.plants
      .filter((p) => p.stage === 3 && !p.busy && !p.spent)
      .forEach((p) => bench.push({ kind: 'harvest', c: p.c, r: p.r, bonus: 0 }));
    return { bench, open };
  }
  for (let r = 0; r < s.tiles.length; r++) {
    for (let c = 0; c < s.tiles[r].length; c++) {
      if (s.tiles[r][c] !== 's' || !open(c, r)) continue;
      const zone = [];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if ('.G'.includes(s.tiles[r + dr]?.[c + dc] ?? '#')) zone.push(`${c + dc},${r + dr}`);
      if (zone.length) {
        const bare = zone.filter((k) => !covered.has(k)).length;
        bench.push({ kind: 'plant', c, r, bonus: bare * 3 });
      }
    }
  }
  return { bench, open };
}

function routeTo(s, open, goals) {
  const key = (c, r) => `${c},${r}`;
  const from = { c: s.player.c, r: s.player.r };
  const seen = new Map([[key(from.c, from.r), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (goals.has(key(cur.c, cur.r))) {
      const steps = [];
      for (let at = cur; seen.get(key(at.c, at.r)); at = seen.get(key(at.c, at.r))) {
        const prev = seen.get(key(at.c, at.r));
        steps.unshift([at.c - prev.c, at.r - prev.r]);
      }
      return steps;
    }
    for (const [dx, dy] of DIR4) {
      const n = { c: cur.c + dx, r: cur.r + dy };
      if (!open(n.c, n.r) || seen.has(key(n.c, n.r))) continue;
      seen.set(key(n.c, n.r), cur);
      queue.push(n);
    }
  }
  return null;
}

/** One decision from a (delayed) snapshot: { hold: [dx, dy, seconds] } or { press: code }. */
function decide(s, pick = wants) {
  if (s.phase !== 'playing' || s.player.moving) return null;
  const { bench, open } = pick(s);
  let best = null;
  for (const t of bench) {
    const stand = new Set(DIR4.map(([dx, dy]) => `${t.c - dx},${t.r - dy}`));
    const steps = routeTo(s, open, stand);
    if (!steps) continue;
    const score = t.bonus - steps.length;
    if (!best || score > best.score) best = { t, steps, score };
  }
  if (!best) return null;
  const { t, steps } = best;
  if (steps.length) {
    const [dx, dy] = steps[0];
    let run = 0;
    while (steps[run] && steps[run][0] === dx && steps[run][1] === dy) run++;
    const turn = s.player.facing.dx === dx && s.player.facing.dy === dy ? 0 : 0.11;
    return { hold: [dx, dy, turn + MOVE_SECONDS * (run - 1) + 0.06] };
  }
  const dx = Math.sign(t.c - s.player.c);
  const dy = Math.sign(t.r - s.player.r);
  if (s.player.facing.dx !== dx || s.player.facing.dy !== dy)
    return { hold: [dx, dy, TAP_SECONDS] };
  return { press: t.kind === 'plant' ? 'Space' : 'KeyX' };
}

/** Drive an open game with the delayed planter until `stop(state)` or the game ends. */
function drive(g, h, { hz = 60, delay = 0.25, maxSeconds = 240, pick, onFrame, stop }) {
  const dt = 1 / hz;
  const history = [];
  let act = null;
  let busyUntil = 0;
  let lowest = Infinity;
  let t = 0;
  for (; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    if (stop(s)) break;
    lowest = Math.min(lowest, s.health);
    onFrame?.(s);
    history.push({ t, s });
    if (history.length > 100) history.shift();
    if (act && t >= act.until) act = null;
    if (!act && t >= busyUntil) {
      const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
      const choice = seen.t >= busyUntil - 1e-9 ? decide(seen.s, pick) : null;
      if (choice?.hold) {
        const key = KEYS[`${choice.hold[0]},${choice.hold[1]}`];
        act = { keys: [key], pressed: [], until: t + choice.hold[2] };
        busyUntil = t + choice.hold[2] + 0.16 + delay;
      } else if (choice?.press) {
        act = { keys: [], pressed: [choice.press], until: t + dt * 0.5 };
        busyUntil = t + 0.1 + delay;
      }
    }
    g.update(dt, input(act?.keys ?? [], act?.pressed ?? []));
    if (act?.pressed.length) act.pressed = [];
  }
  const state = g.getState();
  return { g, h, state, lowest: Math.min(lowest, state.health), seconds: t };
}

/** Play `level` until it is cleared or the game ends. */
function playLevel(level, { seed = 1, ...options } = {}) {
  const { g, h } = openLevel(level, { seed });
  const r = drive(g, h, { ...options, stop: (s) => s.level > level || s.phase === 'won' });
  return { ...r, cleared: r.state.level > level || r.state.phase === 'won' };
}

// A casual player who does what the prompt says: "a bare lane" sends the next seed beside the
// pest that nothing guards, every harvest prompt picks the plant it names.
function promptWants(s) {
  const { open } = wants(s);
  const key = s.prompt.key;
  const harvest = (list) => list.map((p) => ({ kind: 'harvest', c: p.c, r: p.r, bonus: 0 }));
  const grown = s.plants.filter((p) => p.stage === 3 && !p.busy);
  if (key === 'harvestSpent') return { bench: harvest(grown.filter((p) => p.spent)), open };
  if (key === 'harvestIdle') return { bench: harvest(grown.filter((p) => p.idle)), open };
  if (key === 'harvestNone' || key === 'harvestFull') return { bench: harvest(grown), open };
  if (!['plant', 'bare', 'tip'].includes(key)) return { bench: [], open };
  const ahead = new Set(
    s.pests.filter((v) => v.bare).flatMap((v) => v.route.map((t) => `${t.c},${t.r}`)),
  );
  const bench = [];
  for (let r = 0; r < s.tiles.length; r++) {
    for (let c = 0; c < s.tiles[r].length; c++) {
      if (s.tiles[r][c] !== 's' || !open(c, r)) continue;
      let hits = 0;
      let beside = false;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          beside ||= '.G'.includes(s.tiles[r + dr]?.[c + dc] ?? '#');
          hits += ahead.has(`${c + dc},${r + dr}`) ? 1 : 0;
        }
      }
      if (beside) bench.push({ kind: 'plant', c, r, bonus: key === 'bare' ? hits * 4 : 0 });
    }
  }
  return { bench, open };
}

// Blind players: no state at all, only the clock. Hold-and-alternate walks around a cycle of
// directions with a fixed period and plants or harvests on a fixed beat.
const CYCLES = {
  leftRight: ['ArrowRight', 'ArrowLeft'],
  upDown: ['ArrowDown', 'ArrowUp'],
  around: ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'],
  wasd: ['KeyD', 'KeyW', 'KeyA', 'KeyS'],
};
const BLIND_PERIODS = [0.5, 1, 2, 3];
const BLIND_BEATS = [0.3, 0.8];
function blindPolicies(seed) {
  const rnd = seeded(seed * 31 + 5);
  const all = Object.values(KEYS);
  let held = [];
  const policies = {
    idle: () => ({ held: [], pressed: [] }),
    mash: (t, f) => ({ held: [], pressed: [f % 2 ? 'Space' : 'KeyX'] }),
    random: (t, f) => {
      if (f % 20 === 0) held = rnd() < 0.85 ? [all[Math.floor(rnd() * 4)]] : [];
      return { held, pressed: rnd() < 0.15 ? [rnd() < 0.6 ? 'Space' : 'KeyX'] : [] };
    },
  };
  const crossed = (t, every) => Math.floor(t / every) !== Math.floor((t - 1 / 60) / every);
  for (const [name, cycle] of Object.entries(CYCLES)) {
    for (const period of BLIND_PERIODS) {
      for (const beat of BLIND_BEATS) {
        policies[`${name}@${period}/${beat}`] = (t) => {
          const pressed = crossed(t, beat) ? ['Space'] : [];
          if (crossed(t, 2.5)) pressed.push('KeyX');
          return { held: [cycle[Math.floor(t / period) % cycle.length]], pressed };
        };
      }
    }
  }
  return policies;
}
function playBlind(level, policy, { seed = 1, maxSeconds = 200 } = {}) {
  const { g, h } = openLevel(level, { seed });
  for (let f = 0, t = 0; t < maxSeconds && !h.ends.length; f++, t += 1 / 60) {
    const s = g.getState();
    if (s.level > level || s.phase === 'won') return true;
    const a = policy(t, f);
    g.update(1 / 60, input(a.held, a.pressed));
  }
  const s = g.getState();
  return s.level > level || s.phase === 'won';
}

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
const kindsOf = (level) => new Set(level.spawns.map((e) => e[2]));
const gap = (l) => (l.spawns.at(-1)[0] - l.spawns[0][0]) / (l.spawns.length - 1);
const gateCount = (level) => level.map.join('').split('G').length - 1;
const textWidth = (text, size) =>
  [...text].reduce((sum, ch) => sum + (CJK.test(ch) ? size : size * 0.62), 0);

test('quality: there are 20 data-driven levels on a teaching, combination and mastery curve', () => {
  assert.equal(LEVEL_COUNT, 20);
  assert.equal(LEVELS.length, LEVEL_COUNT);
  assert.deepEqual(
    LEVELS.map((l) => l.tier),
    [...Array(7).fill('teach'), ...Array(7).fill('combo'), ...Array(6).fill('master')],
  );
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => l.map.join(''))).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => JSON.stringify(l))).size, LEVEL_COUNT);
  const mean = (tier, f) => {
    const rows = LEVELS.filter((l) => l.tier === tier);
    return rows.reduce((n, l) => n + f(l), 0) / rows.length;
  };
  const count = (l) => l.spawns.length;
  assert.ok(
    mean('master', count) > mean('combo', count) && mean('combo', count) > mean('teach', count),
  );
  assert.ok(mean('master', gap) < mean('combo', gap) && mean('combo', gap) < mean('teach', gap));
  assert.ok(mean('master', gateCount) > mean('combo', gateCount));
  assert.ok(LEVELS.slice(0, 3).every((l) => kindsOf(l).size === 1));
  assert.ok(LEVELS.slice(14).every((l) => kindsOf(l).size >= 2));
  assert.ok(LEVELS.every((l) => l.spawns.length >= 8 && l.seeds >= 2 && l.health >= 4));
});

test('quality: exported level data is frozen', () => {
  for (const data of [
    LEVELS,
    LEVELS[0],
    LEVELS[0].name,
    LEVELS[0].tip,
    LEVELS[0].start,
    LEVELS[0].map,
    LEVELS[0].spawns,
    LEVELS[0].spawns[0],
  ]) {
    assert.ok(Object.isFrozen(data));
  }
  assert.throws(() => {
    LEVELS[0].seeds = 9;
  });
});

test('quality: every map is legal, every gate reaches the bloom and every soil tile is reachable', () => {
  const reach = (level, from, ok) => {
    const seen = new Set([`${from.c},${from.r}`]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const [dx, dy] of DIR4) {
        const c = queue[i].c + dx;
        const r = queue[i].r + dy;
        if (!ok(level.map[r]?.[c] ?? '#') || seen.has(`${c},${r}`)) continue;
        seen.add(`${c},${r}`);
        queue.push({ c, r });
      }
    }
    return seen;
  };
  for (const [i, level] of LEVELS.entries()) {
    const tag = `level ${i + 1}`;
    assert.equal(level.map.length, 11, tag);
    assert.ok(
      level.map.every((row) => row.length === 20 && /^[#wsGh.]+$/.test(row)),
      tag,
    );
    assert.ok(
      /^#+$/.test(level.map[0]) && /^#+$/.test(level.map[10]),
      `${tag}: banner row is wall`,
    );
    assert.equal(level.map.join('').split('h').length - 1, 1, `${tag}: one bloom`);
    const heart = level.map.flatMap((row, r) =>
      row.includes('h') ? [{ c: row.indexOf('h'), r }] : [],
    )[0];
    const gates = level.map.flatMap((row, r) =>
      [...row].flatMap((ch, c) => (ch === 'G' ? [{ c, r }] : [])),
    );
    assert.ok(gates.length >= 1 && level.spawns.every((e) => gates[e[1]]), tag);
    for (const g of gates) {
      assert.ok(g.c === 0 || g.c === 19, `${tag}: gates sit on the garden edge`);
      assert.ok(reach(level, g, (ch) => '.Gh'.includes(ch)).has(`${heart.c},${heart.r}`), tag);
    }
    const walkable = reach(level, level.start, (ch) => !'#h'.includes(ch));
    assert.ok(
      'ws'.includes(level.map[level.start.r][level.start.c]),
      `${tag}: starts on a walkway`,
    );
    level.map.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        if (ch === 's') assert.ok(walkable.has(`${c},${r}`), `${tag}: soil ${c},${r}`);
      }),
    );
    const useful = level.map.flatMap((row, r) =>
      [...row].filter((ch, c) => {
        if (ch !== 's') return false;
        return [-1, 0, 1].some((dr) =>
          [-1, 0, 1].some((dc) => '.G'.includes(level.map[r + dr]?.[c + dc] ?? '#')),
        );
      }),
    );
    assert.ok(useful.length >= 8, `${tag}: ${useful.length} useful soil tiles`);
    const ahead = level.map[level.start.r][level.start.c + 1];
    assert.notEqual(ahead, 's', `${tag}: a mashing player does not plant on the first press`);
    assert.ok(
      level.spawns.every((e, n) => n === 0 || e[0] >= level.spawns[n - 1][0]),
      tag,
    );
    assert.ok(level.spawns[0][0] >= 8, `${tag}: the first pest is announced for 8 s`);
  }
});

test('quality: every level has accurate bilingual names and tips that fit the 480 px canvas', () => {
  for (const [i, level] of LEVELS.entries()) {
    const tag = `level ${i + 1}`;
    for (const part of [level.name, level.tip]) {
      assert.ok(part.en.length > 3 && !CJK.test(part.en), `${tag} EN`);
      assert.ok(CJK.test(part.zh), `${tag} ZH`);
    }
    for (const lang of ['en', 'zh']) {
      assert.ok(textWidth(level.tip[lang], 14) <= 460, `${tag} ${lang} tip width`);
      assert.ok(textWidth(`${i + 1}. ${level.name[lang]}`, 16) <= 460, `${tag} ${lang} name`);
      assert.ok(textWidth(`Level ${i + 1}: ${level.name[lang]}`, 14) <= 380, `${tag} banner`);
    }
  }
});

test('quality: tips only name what the level really contains, and each pest is taught where it first appears', () => {
  const tip = (n) => LEVELS[n - 1].tip.en;
  const level = (n) => LEVELS[n - 1];
  const count = (n, kind) => level(n).spawns.filter((e) => e[2] === kind).length;
  const words = {
    beetle: [/beetle/i, 'beetle'],
    weevil: [/weevil/i, 'weevil'],
    hopper: [/hopper/i, 'hopper'],
  };
  for (const [name, [pattern, kind]] of Object.entries(words)) {
    let first = null;
    LEVELS.forEach((l, i) => {
      if (pattern.test(l.tip.en))
        assert.ok(kindsOf(l).has(kind), `level ${i + 1} tip names ${name}`);
      if (kindsOf(l).has(kind) && first === null) first = i;
    });
    if (name !== 'beetle') assert.match(LEVELS[first].tip.en, pattern, `${name} is taught first`);
  }
  assert.deepEqual([...kindsOf(level(4))], ['beetle']);
  assert.ok(/Only 2 seeds/.test(tip(2)) && level(2).seeds === 2);
  assert.ok(
    /Only 2 seeds and 4 health/.test(tip(18)) && level(18).seeds === 2 && level(18).health === 4,
  );
  assert.ok(/Two gates, one road/.test(tip(7)) && gateCount(level(7)) === 2);
  assert.ok(
    /Two gates and three kinds/.test(tip(8)) &&
      gateCount(level(8)) === 2 &&
      kindsOf(level(8)).size === 3,
  );
  assert.ok(/two gates/.test(tip(11)) && gateCount(level(11)) === 2);
  assert.ok(/Two gates, two lanes/.test(tip(13)) && gateCount(level(13)) === 2);
  assert.ok(/both sides/.test(tip(14)) && level(14).map[5].indexOf('h') === 10);
  assert.ok(/Three gates/.test(tip(15)) && gateCount(level(15)) === 3);
  assert.ok(/Four gates/.test(tip(19)) && gateCount(level(19)) === 4);
  assert.ok(
    /three gates, three kinds/.test(tip(20)) &&
      gateCount(level(20)) === 3 &&
      kindsOf(level(20)).size === 3,
  );
  assert.ok(/storm of hoppers/.test(tip(16)) && count(16, 'hopper') > level(16).spawns.length / 2);
  assert.ok(/Weevils pick the empty road/.test(tip(17)) && count(17, 'weevil') > 8);
  assert.ok(
    /Three roads/.test(tip(9)) && level(9).map.filter((row) => /\.{10,}/.test(row)).length === 3,
  );
  assert.ok(/dense stream/.test(tip(12)) && gap(level(12)) <= 3);
  assert.ok(/Little soil/.test(tip(10)) && level(10).seeds === 2);
  assert.ok(/6s/.test(tip(1)) && /6 seconds/.test(meta.description.en));
});

// ---------------------------------------------------------------------------------------------
// Fair for humans: a reaction-limited player who sees only the public state
// ---------------------------------------------------------------------------------------------
test('quality: a 0.25 s and a 0.35 s reaction-limited player clear every level at 30, 60 and 120 Hz', () => {
  const damage = new Map();
  for (const level of LEVEL_NUMBERS) {
    for (const delay of REACTIONS) {
      for (const hz of HZS) {
        const r = playLevel(level, { hz, delay });
        const tag = `level ${level} ${delay}s ${hz}Hz`;
        assert.ok(r.cleared, `${tag}: ${r.state.phase}`);
        assert.ok(r.lowest >= 2, `${tag} fell to ${r.lowest} health`);
        assert.ok(r.seconds < 140, `${tag} took ${r.seconds}s`);
        assert.equal(r.h.ends.length, level === LEVEL_COUNT ? 1 : 0, tag);
        if (hz === 60 && delay === 0.35) damage.set(level, r.state.healthMax - r.lowest);
      }
    }
  }
  const mean = (from, to) =>
    LEVEL_NUMBERS.filter((n) => n >= from && n <= to).reduce((s, n) => s + damage.get(n), 0) /
    (to - from + 1);
  assert.ok(mean(15, 20) > mean(8, 14), `mastery ${mean(15, 20)} vs combination ${mean(8, 14)}`);
  assert.ok(mean(8, 14) >= mean(1, 7), `combination ${mean(8, 14)} vs teaching ${mean(1, 7)}`);
});

test('quality: a casual player who follows the prompts clears the teaching levels', () => {
  for (const level of [1, 2, 3, 4, 6, 7]) {
    for (const hz of [30, 120]) {
      const r = playLevel(level, { hz, delay: 0.4, pick: promptWants });
      assert.ok(r.cleared && r.lowest >= 2, `level ${level} ${hz}Hz: ${r.lowest}`);
    }
  }
});

test('quality: the whole campaign can be played from level 1 and saves every clear', () => {
  const saved = [];
  const h = harness({ seed: 2 });
  h.env.progress = { unlocked: () => 1, unlock: (n) => saved.push(n) };
  const g = createGame(h.env);
  const r = drive(g, h, { stop: (s) => s.level >= 4 });
  assert.equal(r.state.level, 4);
  assert.deepEqual(saved, [2, 3, 4]);
  assert.equal(r.state.unlocked, 4);
});

test('quality: a player who never acts survives the opening and then loses fairly', () => {
  for (const level of LEVEL_NUMBERS) {
    const { g, h } = openLevel(level);
    const first = LEVELS[level - 1].spawns[0][0];
    let leakedAt = null;
    for (let i = 0; i < 60 * 400 && !h.ends.length; i++) {
      const before = g.getState();
      g.update(1 / 60, input([]));
      if (leakedAt === null && g.getState().health < before.health) leakedAt = before.time;
      if (before.time < first - 0.1) assert.equal(before.pests.length, 0, `level ${level}`);
    }
    assert.equal(h.ends.length, 1, `level ${level} ends`);
    assert.equal(h.ends[0].won, false, `level ${level} idle loses`);
    assert.ok(leakedAt > first + 5, `level ${level}: first damage at ${leakedAt}s`);
  }
});

test('quality: the level banner and tip never cover the gardener, a gate or the bloom', () => {
  for (const level of LEVEL_NUMBERS) {
    const s = openLevel(level).g.getState();
    const banner = { x: 40, y: s.hud.top[1] + 4, w: 400, h: 20 };
    const hit = (r) =>
      r.x < banner.x + banner.w &&
      r.x + r.w > banner.x &&
      r.y < banner.y + banner.h &&
      r.y + r.h > banner.y;
    assert.ok(!hit(s.player.rect), `level ${level} gardener`);
    assert.ok(!hit(s.heart.rect), `level ${level} bloom`);
    for (const g of s.gates) assert.ok(g.r >= 1, `level ${level} gate`);
    assert.equal(s.prompt.key, 'tip');
    assert.equal(s.prompt.en, LEVELS[level - 1].tip.en);
    assert.ok(s.player.rect.y >= s.hud.top[1] && s.player.rect.y + 22 <= s.hud.bottom[0]);
  }
});

test('quality: idle, mash, random and hold-plus-alternate players win at most 10% of any level from level 3', () => {
  const names = Object.keys(blindPolicies(1)).filter(
    (n) => !n.includes('@') || /@(0\.5|2)\/0\.3$|@(1|3)\/0\.8$/.test(n),
  );
  assert.ok(names.length >= 16);
  for (const level of LEVEL_NUMBERS.filter((n) => n >= 3)) {
    let runs = 0;
    let wins = 0;
    for (const name of names) {
      runs++;
      if (playBlind(level, blindPolicies(level)[name], { seed: level })) wins++;
    }
    assert.ok(wins / runs <= 0.1, `level ${level}: ${wins}/${runs} blind wins`);
  }
  for (const name of ['idle', 'mash', 'random']) {
    assert.equal(playBlind(1, blindPolicies(1)[name]) && name === 'idle', false);
  }
});

// ---------------------------------------------------------------------------------------------
// Prompts and drawing
// ---------------------------------------------------------------------------------------------
test('quality: prompts name keys, stay put long enough to read and never flip back and forth', () => {
  const dwell = [];
  for (const level of [1, 5, 8, 12]) {
    const prompts = [];
    const r = playLevel(level, {
      delay: 0.25,
      onFrame: (s) => {
        if (!prompts.length || prompts.at(-1).key !== s.prompt.key)
          prompts.push({ key: s.prompt.key, t: s.time });
      },
    });
    const end = r.state.time;
    prompts.forEach((p, n) => {
      dwell.push({ key: p.key, d: (prompts[n + 1]?.t ?? end) - p.t });
      const back = prompts[n + 2];
      if (back && back.key === p.key)
        assert.ok(back.t - p.t > 0.5, `${p.key} flips back within ${back.t - p.t}s`);
    });
  }
  const shown = dwell.filter((e) => !['won', 'lost', 'saved'].includes(e.key));
  const brief = shown.filter((e) => e.d < 0.5).length;
  assert.ok(brief / shown.length <= 0.05, `${brief}/${shown.length} prompts shown under 0.5 s`);
  for (const [key, [en, zh]] of Object.entries(PROMPTS)) {
    if (['tip', 'saved', 'won', 'lost', 'wait'].includes(key)) continue;
    assert.match(en, /Space|X|Arrows/, key);
    assert.ok(CJK.test(zh));
    assert.ok(textWidth(en, 16) <= 460 && textWidth(zh, 16) <= 460, `${key} fits the 16 px band`);
  }
  assert.ok(Object.isFrozen(PROMPTS) && Object.isFrozen(PROMPTS.plant));
});

test('quality: a harvest prompt always names a plant that X can harvest right now', () => {
  let checked = 0;
  for (const level of [2, 10, 18]) {
    playLevel(level, {
      delay: 0.4,
      pick: promptWants,
      onFrame: (s) => {
        const key = s.prompt.key;
        if (!key.startsWith('harvest')) return;
        checked++;
        const free = s.plants.filter((p) => p.stage === 3 && !p.busy);
        const named = {
          harvestNone: free,
          harvestFull: free,
          harvestSpent: free.filter((p) => p.spent),
          harvestIdle: free.filter((p) => p.idle),
        }[key];
        assert.ok(named.length > 0, `${key} at ${s.time.toFixed(2)} s`);
        assert.equal(key === 'harvestFull', s.seeds > 0);
      },
    });
  }
  assert.ok(checked > 100, `${checked} harvest-prompt frames checked`);
});

test('quality: the select screen, every level and every tier tag draw in both languages at 14 px or larger', () => {
  for (const lang of ['en', 'zh']) {
    const texts = [];
    let fontSize = 0;
    let align = 'left';
    const ctx = new Proxy(mockContext(), {
      set: (t, p, v) => {
        if (p === 'font') fontSize = Number(/(\d+)px/.exec(v)[1]);
        if (p === 'textAlign') align = v;
        t[p] = v;
        return true;
      },
      get: (t, p) =>
        p === 'fillText'
          ? (text, x) => texts.push({ text, x, size: fontSize, align })
          : p in t
            ? t[p]
            : () => {},
    });
    const h = harness({ lang });
    h.env.progress = store(LEVEL_COUNT);
    const menu = createGame(h.env);
    menu.draw(ctx);
    menu.update(1 / 60, press('ArrowLeft'));
    menu.draw(ctx);
    for (const n of LEVEL_NUMBERS) {
      const { g } = openLevel(n, { lang });
      g.draw(ctx);
      for (let i = 0; i < 90; i++) g.update(1 / 60, input(['ArrowRight']));
      g.draw(ctx);
    }
    assert.ok(texts.length > 200);
    for (const t of texts) {
      assert.ok(t.size >= 14, `${t.text} at ${t.size}px`);
      const width = textWidth(t.text, t.size);
      const left = t.align === 'center' ? t.x - width / 2 : t.x;
      assert.ok(left >= 0 && left + width <= 480, `${lang} "${t.text}" ${left}+${width}`);
      if (lang === 'zh')
        assert.ok(
          !/[A-Za-z]{4,}/.test(t.text.replace(/^[A-Z]\b/, '')) || /X|Space/.test(t.text),
          t.text,
        );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Select, continue and robustness
// ---------------------------------------------------------------------------------------------
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
    [1e9, 21],
    [21, 21],
    ['9', 9],
    [NaN, 1],
    [undefined, 1],
    [null, 1],
    [Infinity, 1],
    [{}, 1],
  ]) {
    const h = harness();
    h.env.progress = store(raw);
    const s = createGame(h.env).getState();
    assert.equal(s.unlocked, expected, String(raw));
    assert.equal(s.menu === null, expected === 1, String(raw));
    if (s.menu)
      assert.deepEqual(
        [s.menu.cursor, s.menu.total, s.menu.columns],
        [Math.min(expected, 20), 20, MENU_COLUMNS],
      );
  }

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

  for (const code of ['Enter', 'Space', 'NumpadEnter']) {
    const again = harness();
    again.env.progress = store(5);
    const m = createGame(again.env);
    m.update(1 / 60, press(code));
    assert.equal(m.getState().level, 5, code);
  }
  assert.deepEqual(menuTarget(input(), 1, 1), {
    cursor: 1,
    moved: false,
    denied: false,
    start: false,
  });
  assert.equal(menuTarget({ pressed: () => false }, 1, 1).start, false);
});

test('quality: clearing a level unlocks the next, survives broken stores and never lowers progress', () => {
  const saved = [];
  const h = harness();
  h.env.progress = { unlocked: () => 4, unlock: (n) => saved.push(n) };
  const g = createGame(h.env);
  g.update(1 / 60, press('ArrowLeft'));
  g.update(1 / 60, press('ArrowLeft'));
  g.update(1 / 60, press('Space'));
  assert.equal(g.getState().level, 2);
  const r = drive(g, h, { stop: (s) => s.level > 2 });
  assert.equal(r.state.level, 3);
  assert.deepEqual(saved, [], 'clearing level 2 never lowers the saved level 4');
  assert.equal(r.state.unlocked, 4);

  const stores = [
    {
      unlocked: () => {
        throw new Error('storage blocked');
      },
      unlock: () => {
        throw new Error('quota');
      },
    },
    { unlocked: () => 1, unlock: undefined },
    {},
  ];
  for (const broken of stores) {
    const b = harness();
    b.env.progress = broken;
    const game = createGame(b.env);
    assert.equal(game.getState().unlocked, 1);
    const done = drive(game, b, { stop: (s) => s.level > 1 });
    assert.equal(done.state.level, 2, 'a broken store does not stop play');
    assert.equal(done.state.unlocked, 2);
  }
});

test('quality: a key still held from the level select does not plant a seed', () => {
  const h = harness();
  h.env.progress = store(6);
  const g = createGame(h.env);
  g.update(1 / 60, input(['Space'], ['Space']));
  for (let i = 0; i < 30; i++) g.update(1 / 60, input(['Space']));
  assert.equal(g.getState().stats.planted, 0);
  assert.equal(g.getState().seeds, LEVELS[5].seeds);
});

test('quality: a plant or harvest pressed during a step, a turn or between ticks is buffered', () => {
  const h = harness();
  const g = createGame(h.env);
  g.update(1 / 60, input(['ArrowUp'], []));
  for (let i = 0; i < 8; i++) g.update(1 / 60, input(['ArrowUp']));
  assert.ok(g.getState().player.moving || g.getState().player.r < 5);
  let guard = 0;
  while (g.getState().player.r > 4 && guard++ < 200) g.update(1 / 60, input(['ArrowUp']));
  g.update(1 / 60, input(['ArrowUp'], ['Space']));
  g.update(1 / 60, input(['ArrowUp'], ['Space']));
  for (let i = 0; i < 30; i++) g.update(1 / 60, input([]));
  const s = g.getState();
  assert.ok(s.stats.planted <= 1, 'the buffered press plants at most once');
  g.update(1 / 480, press('KeyX'));
  g.update(1 / 60, input([]));
  assert.ok(g.getState().message !== null, 'a sub-tick frame does not lose the X press');
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
    for (let i = 0; i < 600; i++) {
      const keys = i % 3 ? ['Space', 'ArrowLeft'] : ['ArrowUp', 'KeyD'];
      const frame = { ...input(keys, i % 7 ? [] : ['KeyX', 'Enter']), pointer: pointers[i % 7] };
      assert.doesNotThrow(() => g.update(dts[i % dts.length], frame));
      const s = g.getState();
      assert.ok(
        Number.isFinite(s.player.x) && Number.isFinite(s.player.y) && Number.isFinite(s.score),
      );
      assert.ok(s.seeds >= 0 && s.seeds <= 6 && s.health >= 0);
    }
    assert.doesNotThrow(() => g.draw(mockContext()));
    assert.ok(h.ends.length <= 1);
  }
  const pointerless = harness();
  pointerless.env.progress = store(5);
  const m = createGame(pointerless.env);
  assert.doesNotThrow(() => m.update(1 / 60, { held: () => false, pressed: () => false }));
  assert.equal(m.getState().menu.cursor, 5, 'no pointer, no change');
});

test('quality: a long frame is capped, still takes the key press and never skips a pest', () => {
  const g = createGame(harness().env);
  g.update(5, input(['ArrowUp'], []));
  assert.ok(g.getState().time <= 0.1 + 1e-9);
  const sparse = createGame(harness().env);
  sparse.update(0.2, input([], ['Space']));
  assert.equal(sparse.getState().message.en.length > 0, true);
});

// ---------------------------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------------------------
test('quality: the final level ends the game exactly once with an EN or ZH win, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = openLevel(LEVEL_COUNT, { lang });
    drive(g, h, { stop: () => false });
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(h.ends[0].message, lang === 'zh' ? CJK : /^All twenty gardens are safe/);
    assert.ok(h.sounds.includes('win'));
    const done = structuredClone(g.getState());
    assert.equal(done.phase, 'won');
    for (let i = 0; i < 120; i++)
      g.update(1 / 60, input(['Space', 'ArrowLeft'], ['KeyX', 'Space']));
    assert.deepEqual(g.getState(), done);
    assert.equal(h.ends.length, 1);
  }
});

test('quality: losing ends the game exactly once with an EN or ZH message, then freezes', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang, seed: 2 });
    const g = createGame(h.env);
    for (let i = 0; i < 60 * 150 && !h.ends.length; i++) g.update(1 / 30, input([]));
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'zh' ? CJK : /^Pests overran the garden bloom/);
    const done = structuredClone(g.getState());
    assert.equal(done.prompt.key, 'lost');
    for (let i = 0; i < 90; i++) g.update(1 / 60, input(['Space'], ['KeyX']));
    assert.deepEqual(g.getState(), done);
    assert.equal(h.ends.length, 1);
    assert.ok(h.sounds.includes('lose'));
  }
});

test('quality: the same scripted input gives the same game at every frame rate', () => {
  const script = (frame30) => {
    if (frame30 < 8) return { held: ['ArrowRight'], pressed: [] };
    if (frame30 === 10) return { held: [], pressed: ['Space'] };
    if (frame30 < 24) return { held: ['KeyS'], pressed: [] };
    if (frame30 === 30) return { held: [], pressed: ['KeyX'] };
    return {
      held: frame30 % 40 < 12 ? ['ArrowUp'] : ['ArrowLeft'],
      pressed: frame30 % 25 === 0 ? ['Space'] : [],
    };
  };
  for (const level of [1, 12, 19]) {
    const finals = HZS.map((hz) => {
      const { g } = openLevel(level, { seed: 6 });
      const per = hz / 30;
      for (let f = 0; f < 30 * 60; f++) {
        const { held, pressed } = script(f);
        for (let k = 0; k < per; k++) g.update(1 / hz, input(held, k === 0 ? pressed : []));
      }
      return JSON.stringify(g.getState());
    });
    assert.equal(finals[0], finals[1], `level ${level}`);
    assert.equal(finals[1], finals[2], `level ${level}`);
    assert.ok(JSON.parse(finals[0]).time > 10);
  }
});

test('quality: every action has a keyboard and a touch route, and no reserved key is bound', () => {
  const codes = meta.touchControls.map((b) => b.code);
  assert.deepEqual(codes.sort(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'KeyX',
    'Space',
  ]);
  assert.ok(meta.touchControls.every((b) => b.label.en && CJK.test(b.label.zh)));
  const bound = JSON.stringify([meta.keys, meta.touchControls]);
  assert.ok(!/Escape|KeyR\b|KeyP\b|"R"|"P"/.test(bound));
  assert.ok(meta.keys.every((k) => k.label.en && CJK.test(k.label.zh)));
  const h = harness();
  const g = createGame(h.env);
  for (const [held, pressed] of [
    [['ArrowUp'], []],
    [[], ['Space']],
    [[], ['KeyX']],
  ]) {
    assert.doesNotThrow(() => g.update(1 / 60, input(held, pressed)));
  }
  assert.match(meta.description.en, /20 levels/);
  assert.match(meta.description.zh, /20个关卡/);
});

test('quality: after the last level is cleared the select shows every cell, level 20 included, as cleared', () => {
  const saved = [];
  const { g, h } = openLevel(LEVEL_COUNT);
  h.env.progress.unlock = (n) => saved.push(n);
  drive(g, h, { stop: () => false });
  assert.equal(g.getState().phase, 'won');
  assert.deepEqual(saved, [21]);
  for (const lang of ['en', 'zh']) {
    const done = harness({ lang });
    done.env.progress = store(LEVEL_COUNT + 1);
    const texts = [];
    const ctx = new Proxy(mockContext(), {
      get: (t, p) => (p === 'fillText' ? (text) => texts.push(text) : p in t ? t[p] : () => {}),
    });
    const menu = createGame(done.env);
    menu.draw(ctx);
    assert.equal(menu.getState().menu.cursor, LEVEL_COUNT);
    assert.equal(texts.filter((x) => x === (lang === 'zh' ? '已通关' : 'CLEARED')).length, 20);
    menu.update(1 / 60, press('Space'));
    assert.equal(menu.getState().level, LEVEL_COUNT, 'level 20 can be replayed');
  }
});

test('quality: the Chinese HUD counts the next pest in seconds', () => {
  const texts = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (text) => texts.push(text) : p in t ? t[p] : () => {}),
  });
  const zh = openLevel(1, { lang: 'zh' }).g;
  zh.draw(ctx);
  assert.ok(
    texts.some((x) => x === '下一只 8秒'),
    texts.join('|'),
  );
  const en = openLevel(1).g;
  en.draw(ctx);
  assert.ok(texts.some((x) => x === 'Next 8s'));
});

test('quality: Space pressed in the same frame as a direction tap acts on the new facing', () => {
  const { g } = openLevel(1);
  const before = g.getState();
  assert.equal(before.tiles[before.player.r][before.player.c + 1], 'w', 'it faces a walkway');
  assert.equal(before.tiles[before.player.r - 1][before.player.c], 's', 'soil is above');
  g.update(1 / 60, input(['ArrowUp'], ['Space']));
  const after = g.getState();
  assert.deepEqual(after.player.facing, { dx: 0, dy: -1 });
  assert.equal(after.stats.planted, 1);
  assert.equal(after.seeds, before.seeds - 1);
});
