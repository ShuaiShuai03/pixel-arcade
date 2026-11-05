import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, PLOTS, createGame } from '../src/games/vine-warden.js';
import { harness, input, mockContext, seeded } from './harness.js';

const KEYS = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
const DIR4 = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const MOVE_SECONDS = 0.15;
const TAP_SECONDS = 0.05;

// A human-like policy. It reads only what the screen shows (tile art, plant stages and root tiles,
// pest positions, the cursor tile, the seed count) and sees it `delay` seconds late. It plants
// beside the path, harvests spent plants (and blooms when it runs out of seeds), and waits for
// its own last action to finish before looking again.
function wants(s) {
  const open = (c, r) =>
    !'#h'.includes(s.tiles[r]?.[c] ?? '#') && !s.plants.some((p) => p.c === c && p.r === r);
  const covered = new Set();
  s.plants
    .filter((p) => !p.spent)
    .forEach((p) => p.rootTiles.forEach((t) => covered.add(`${t.c},${t.r}`)));
  const bench = [];
  s.plants
    .filter((p) => p.spent && !p.busy)
    .forEach((p) => bench.push({ kind: 'harvest', c: p.c, r: p.r, bonus: 5 }));
  if (s.seeds === 0) {
    s.plants
      .filter((p) => p.stage === 3 && !p.busy && !p.spent)
      .forEach((p) => bench.push({ kind: 'harvest', c: p.c, r: p.r, bonus: 0 }));
  } else {
    for (let r = 0; r < s.tiles.length; r++) {
      for (let c = 0; c < s.tiles[r].length; c++) {
        if (s.tiles[r][c] !== 's' || !open(c, r)) continue;
        const zone = [];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++)
            if ('.G'.includes(s.tiles[r + dr]?.[c + dc] ?? '#')) zone.push(`${c + dc},${r + dr}`);
        if (zone.length)
          bench.push({
            kind: 'plant',
            c,
            r,
            bonus: zone.filter((k) => !covered.has(k)).length * 3,
          });
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
      let at = cur;
      while (seen.get(key(at.c, at.r))) {
        const prev = seen.get(key(at.c, at.r));
        steps.unshift([at.c - prev.c, at.r - prev.r]);
        at = prev;
      }
      return { steps, at: cur };
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

// Decide one action from a (delayed) snapshot: { hold: [dx, dy, seconds] } or { press: code }.
export function decide(s, pick = wants) {
  if (s.phase !== 'playing' || s.player.moving) return null;
  const { bench, open } = pick(s);
  let best = null;
  for (const t of bench) {
    const stand = new Set(DIR4.map(([dx, dy]) => `${t.c - dx},${t.r - dy}`));
    const route = routeTo(s, open, stand);
    if (!route) continue;
    const score = t.bonus - route.steps.length;
    if (!best || score > best.score) best = { t, route, score };
  }
  if (!best) return null;
  const { t, route } = best;
  if (route.steps.length) {
    const [dx, dy] = route.steps[0];
    let run = 0;
    while (route.steps[run] && route.steps[run][0] === dx && route.steps[run][1] === dy) run++;
    const turn = s.player.facing.dx === dx && s.player.facing.dy === dy ? 0 : 0.11;
    return { hold: [dx, dy, turn + MOVE_SECONDS * (run - 1) + 0.06] };
  }
  const dx = Math.sign(t.c - s.player.c);
  const dy = Math.sign(t.r - s.player.r);
  if (s.player.facing.dx !== dx || s.player.facing.dy !== dy)
    return { hold: [dx, dy, TAP_SECONDS] };
  return { press: t.kind === 'plant' ? 'Space' : 'KeyX' };
}

export function playPolicy({
  hz,
  seed,
  delayRange = [0.15, 0.35],
  maxSeconds = 420,
  lang = 'en',
  pick,
  onFrame,
}) {
  const h = harness({ seed, lang });
  const g = createGame(h.env);
  const rnd = seeded(seed * 7 + 3);
  const dt = 1 / hz;
  const history = [];
  const prompts = [];
  let act = null;
  let busyUntil = 0;
  let delay = delayRange[0] + rnd() * (delayRange[1] - delayRange[0]);
  let jitterAt = 0;
  for (let t = 0; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    history.push({ t, s });
    onFrame?.(s);
    if (history.length > 100) history.shift();
    if (!prompts.length || prompts.at(-1).key !== s.prompt.key)
      prompts.push({ key: s.prompt.key, t });
    if (t >= jitterAt) {
      delay = delayRange[0] + rnd() * (delayRange[1] - delayRange[0]);
      jitterAt = t + 1 + rnd() * 2;
    }
    if (act && t >= act.until) act = null;
    if (!act && t >= busyUntil) {
      const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
      const choice = seen.t >= busyUntil - 1e-9 ? decide(seen.s, pick) : null;
      if (choice?.hold) {
        act = {
          keys: [KEYS[`${choice.hold[0]},${choice.hold[1]}`]],
          pressed: [],
          until: t + choice.hold[2],
        };
        busyUntil = t + choice.hold[2] + 0.16 + delay;
      } else if (choice?.press) {
        act = { keys: [], pressed: [choice.press], until: t + dt * 0.5 };
        busyUntil = t + 0.1 + delay;
      }
    }
    g.update(dt, input(act?.keys ?? [], act?.pressed ?? []));
    if (act?.pressed.length) act.pressed = [];
  }
  return { h, g, prompts, seconds: g.getState().time };
}

const HZ = [30, 60, 120];

test('quality: a delayed, visible-information-only policy wins every plot at every rate', () => {
  for (const hz of HZ) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = playPolicy({ hz, seed });
      if (r.g.getState().phase === 'won') wins++;
      assert.equal(r.h.ends.length, 1);
    }
    assert.ok(wins >= 27, `${hz} Hz: ${wins}/30`);
  }
});

test('quality: slower 0.4-0.6 s reactions still win at least 24 of 30 games', () => {
  for (const hz of HZ) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = playPolicy({ hz, seed, delayRange: [0.4, 0.6] });
      if (r.g.getState().phase === 'won') wins++;
    }
    assert.ok(wins >= 24, `${hz} Hz: ${wins}/30`);
  }
});

test('quality: prompts name keys, stay put long enough to read and never flip back and forth', () => {
  const dwell = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { prompts, g } = playPolicy({ hz: 60, seed });
    const end = g.getState().time;
    prompts.forEach((p, n) => {
      dwell.push({ key: p.key, d: (prompts[n + 1]?.t ?? end) - p.t });
      const back = prompts[n + 2];
      if (back && back.key === p.key)
        assert.ok(back.t - p.t > 0.5, `${p.key} flips back within ${back.t - p.t}s`);
    });
  }
  const shown = dwell.filter((e) => !['won', 'lost'].includes(e.key));
  const brief = shown.filter((e) => e.d < 0.5).length;
  assert.ok(brief / shown.length <= 0.05, `${brief}/${shown.length} prompts shown under 0.5 s`);
  for (const [key, [en, zh]] of Object.entries(PROMPTS)) {
    if (['saved', 'won', 'lost', 'wait'].includes(key)) continue;
    assert.match(en, /Space|X|Arrows/, key);
    assert.ok(zh.length > 0);
  }
  for (const key of ['harvestNone', 'harvestFull', 'plant']) {
    assert.ok(PROMPTS[key][0].length <= 42, `${key} fits the 16 px bottom band`);
  }
});

test('quality: a player who never acts loses fairly after every pest was announced by the HUD', () => {
  const h = harness({ seed: 3 });
  const g = createGame(h.env);
  let announced = false;
  for (let i = 0; i < 60 * 300 && !h.ends.length; i++) {
    const before = g.getState();
    if (before.nextPestIn !== null && before.nextPestIn > 0) announced = true;
    const hp = before.health;
    g.update(1 / 60, input([]));
    if (g.getState().health < hp)
      assert.ok(announced && before.time > 8, 'no damage before the first countdown ends');
  }
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
});

test('quality: everything essential is drawn between the HUD bands at 14 px or larger', () => {
  for (const lang of ['en', 'zh']) {
    const fonts = [];
    const ctx = new Proxy(mockContext(), {
      set: (t, p, v) => {
        if (p === 'font') fonts.push(Number(/(\d+)px/.exec(v)[1]));
        t[p] = v;
        return true;
      },
      get: (t, p) => (p in t ? t[p] : () => {}),
    });
    const r = playPolicy({ hz: 60, seed: 4, maxSeconds: 60, lang });
    const s = r.g.getState();
    r.g.draw(ctx);
    assert.ok(fonts.length > 5 && Math.min(...fonts) >= 14, `${lang} fonts ${Math.min(...fonts)}`);
    const [, top] = s.hud.top;
    const [bottom] = s.hud.bottom;
    const rects = [
      s.player.rect,
      s.heart.rect,
      ...s.pests.map((v) => v.rect),
      ...s.plants.map((p) => p.rect),
    ];
    for (const q of rects) assert.ok(q.y >= top && q.y + q.h <= bottom, JSON.stringify(q));
    assert.ok(s.player.rect.w >= 20 && s.player.rect.h >= 20);
  }
});

test('quality: every plot is distinct and its seeds cannot run out', () => {
  assert.equal(PLOTS.length, 3);
  assert.equal(new Set(PLOTS.map((p) => p.map.join(''))).size, 3);
  const kinds = PLOTS.map((p) => new Set(p.spawns.map((e) => e[2])).size);
  assert.deepEqual(kinds, [1, 2, 3]);
  for (const seed of [1, 2, 3]) {
    const r = playPolicy({ hz: 60, seed, maxSeconds: 400 });
    assert.equal(r.g.getState().phase, 'won', `seed ${seed}`);
  }
});

// A casual player: seeds go on the nearest free soil, alternating between the upper and lower
// half of the garden, and only spent plants are ever harvested.
function naiveWants(s) {
  const { open } = wants(s);
  const bench = s.plants
    .filter((p) => p.spent && !p.busy)
    .map((p) => ({ kind: 'harvest', c: p.c, r: p.r, bonus: 0 }));
  const upper = s.stats.planted % 2 === 0;
  if (s.seeds > 0) {
    for (let r = 0; r < s.tiles.length; r++) {
      for (let c = 0; c < s.tiles[r].length; c++) {
        const free = s.tiles[r][c] === 's' && open(c, r);
        const beside = [-1, 0, 1].some((dr) =>
          [-1, 0, 1].some((dc) => '.G'.includes(s.tiles[r + dr]?.[c + dc] ?? '#')),
        );
        const side = s.plot !== 2 || r < 5 === upper;
        if (free && beside && side) bench.push({ kind: 'plant', c, r, bonus: 0 });
      }
    }
  }
  return { bench, open };
}

test('quality: a naive, slow player wins the whole campaign in at least 24 of 30 games', () => {
  for (const hz of HZ) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = playPolicy({ hz, seed, delayRange: [0.4, 0.6], pick: naiveWants });
      if (r.g.getState().phase === 'won') wins++;
    }
    assert.ok(wins >= 24, `${hz} Hz: ${wins}/30`);
  }
});

test('quality: a naive player that reaches plot 3 does not lose plot 2 (Twin Lanes regression)', () => {
  for (const hz of HZ) {
    const r = playPolicy({ hz, seed: 3, delayRange: [0.4, 0.6], pick: naiveWants });
    assert.ok(r.g.getState().plot >= 3);
  }
});

// A casual player who does what the prompt says. "A bare lane" sends the next seed beside the pest
// that nothing guards; every harvest prompt picks the plant it names; otherwise the nearest soil.
function promptWants(s) {
  const { open } = wants(s);
  const plants = s.plants;
  const key = s.prompt.key;
  const harvest = (list) => list.map((p) => ({ kind: 'harvest', c: p.c, r: p.r, bonus: 0 }));
  if (['harvestSpent'].includes(key))
    return { bench: harvest(plants.filter((p) => p.spent && !p.busy)), open };
  if (key === 'harvestIdle') {
    const idle = plants.filter((p) => p.idle);
    return { bench: harvest(idle), open };
  }
  if (['harvestNone', 'harvestFull'].includes(key)) {
    return { bench: harvest(plants.filter((p) => p.stage === 3 && !p.busy)), open };
  }
  if (!['plant', 'bare'].includes(key)) return { bench: [], open };
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

test('quality: a prompt-following casual player wins the whole campaign in at least 24 of 30 games', () => {
  for (const hz of HZ) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = playPolicy({ hz, seed, delayRange: [0.4, 0.6], pick: promptWants });
      if (r.g.getState().phase === 'won') wins++;
    }
    assert.ok(wins >= 24, `${hz} Hz: ${wins}/30`);
  }
});

test('quality: a harvest prompt always names a plant that X can harvest right now', () => {
  let checked = 0;
  for (const hz of HZ) {
    for (const seed of [1, 2, 3, 4]) {
      playPolicy({
        hz,
        seed,
        delayRange: [0.4, 0.6],
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
          assert.ok(
            named.length > 0,
            `${key} at ${s.time.toFixed(2)} s: ${JSON.stringify(s.plants)}`,
          );
          assert.equal(key === 'harvestFull', s.seeds > 0);
        },
      });
    }
  }
  assert.ok(checked > 200, `${checked} harvest-prompt frames checked`);
});
