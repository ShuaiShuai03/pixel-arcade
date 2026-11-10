import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/games/echo-hunter.js';
import { COLS, centerOf, createGame, tileOf, tunnelDistances } from '../src/games/echo-hunter.js';
import { harness, input, seeded } from './harness.js';

const NET_BOT = 24;
// The player watches the sonar meter and the Noise meter before pinging.
const quiet = (s) =>
  s.player.pingCooldown <= 0 &&
  s.player.sonarCharges >= 1 &&
  s.alarm.value <= 1.2 &&
  s.prompt.key !== 'roused';
// A player who has walked a cavern knows which open spots light up all of it. Greedy cover of the
// floor by 110 px sonar reach, visited as a nearest-neighbour tour from the start.
// Every tile some beetle lane runs through: the places a player who has seen the cavern knows to check.
function laneTiles(cavern) {
  const out = new Map();
  for (const spec of E.CAVERNS[cavern - 1].drifters)
    for (const lane of spec.variants) {
      const legs = lane.mode === 'loop' ? lane.pts.length : lane.pts.length - 1;
      for (let k = 0; k < legs; k++) {
        const [a, b] = [lane.pts[k], lane.pts[(k + 1) % lane.pts.length]];
        const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        for (let i = 0; i <= n; i++) {
          const t = [a[0] + Math.sign(b[0] - a[0]) * i, a[1] + Math.sign(b[1] - a[1]) * i];
          out.set(t.join(','), t);
        }
      }
    }
  return [...out.values()];
}

function scanStops(walls, from, targets) {
  const floor = [],
    walkable = tunnelDistances(walls, ...from);
  for (let r = 0; r < 16; r++)
    for (let c = 0; c < COLS; c++) if (walkable[r * COLS + c] >= 0) floor.push([c, r]);
  const reach = ([c1, r1], [c2, r2]) => {
    const [x1, y1] = centerOf(c1, r1),
      [x2, y2] = centerOf(c2, r2);
    return Math.hypot(x1 - x2, y1 - y2) <= 100 && E.lineClear(walls, x1, y1, x2, y2);
  };
  const open = new Set(targets.map(([c, r]) => c + ',' + r)),
    picks = [];
  while (open.size) {
    let best = null;
    for (const t of floor) {
      if (t[0] % 2 || t[1] % 2) continue; // candidate spots on a coarse grid
      const gain = targets.filter((u) => open.has(u[0] + ',' + u[1]) && reach(t, u)).length;
      if (!best || gain > best.gain) best = { t, gain };
    }
    if (!best || !best.gain) break;
    for (const u of targets) if (reach(best.t, u)) open.delete(u[0] + ',' + u[1]);
    picks.push(best.t);
  }
  const tour = [];
  let here = from;
  while (picks.length) {
    const dist = tunnelDistances(walls, ...here);
    picks.sort((p, q) => dist[p[1] * COLS + p[0]] - dist[q[1] * COLS + q[0]]);
    here = picks.shift();
    tour.push(here);
  }
  return tour;
}
const DRIFT_SPEED = [26, 32, 38];
const DIRS = [
  [1, 0, 'ArrowRight'],
  [-1, 0, 'ArrowLeft'],
  [0, 1, 'ArrowDown'],
  [0, -1, 'ArrowUp'],
];
const solid = (walls, c, r) => c < 0 || r < 0 || c >= COLS || r >= 16 || walls[r][c] === '#';

// Held keys that steer from (x, y) towards (tx, ty), with a small dead band.
function steer(x, y, tx, ty) {
  const held = [];
  if (tx - x > 3) held.push('ArrowRight');
  if (x - tx > 3) held.push('ArrowLeft');
  if (ty - y > 3) held.push('ArrowDown');
  if (y - ty > 3) held.push('ArrowUp');
  return held;
}

// Walk one tile at a time along the tunnel graph towards a pixel target.
function goTo(s, tx, ty) {
  const p = s.player,
    [pc, pr] = tileOf(p.x, p.y),
    [tc, tr] = tileOf(tx, ty),
    dist = tunnelDistances(s.walls, tc, tr),
    here = dist[pr * COLS + pc];
  if (here <= 0) return steer(p.x, p.y, tx, ty);
  for (const [dc, dr] of DIRS.map(([a, b]) => [a, b])) {
    const nc = pc + dc,
      nr = pr + dr;
    if (solid(s.walls, nc, nr) || dist[nr * COLS + nc] !== here - 1) continue;
    const [cx, cy] = centerOf(nc, nr);
    return steer(p.x, p.y, cx, cy);
  }
  return [];
}

// Dead-reckon a remembered drifter: keep walking along its arrow, bouncing off walls.
function predict(s, m) {
  let { x, y } = m,
    dx = Math.sign(Math.round(m.dx)),
    dy = Math.sign(Math.round(m.dy));
  if (Math.abs(m.dx) < Math.abs(m.dy)) dx = 0;
  else dy = 0;
  let left = DRIFT_SPEED[s.cavern - 1] * Math.max(0, m.age - 4);
  while (left > 0) {
    const step = Math.min(4, left),
      [c, r] = tileOf(x + dx * (step + 8), y + dy * (step + 8));
    if (solid(s.walls, c, r)) {
      dx = -dx;
      dy = -dy;
    } else {
      x += dx * step;
      y += dy * step;
      left -= step;
    }
    if (!dx && !dy) break;
  }
  return { x, y };
}

const SAFE_TILES = 8; // the player keeps this tunnel distance from anything dangerous it has seen

// Everything the player knows to avoid: the latest sighting of each threat (lamp or outline),
// plus the ping spot while an alerted threat is known to be heading there.
function dangers(s, memory) {
  for (const t of s.marks.filter((m) => m.kind === 'threat'))
    if (!memory.has(t.id) || memory.get(t.id).t < s.time - t.age)
      memory.set(t.id, { x: t.x, y: t.y, t: s.time - t.age, alerted: t.alerted });
  for (const t of s.lit.filter((e) => e.kind === 'threat'))
    memory.set(t.id, { x: t.x, y: t.y, t: s.time });
  for (const [k, v] of memory) if (s.time - v.t > 6) memory.delete(k);
  const out = [...memory.values()].map(({ x, y }) => ({ x, y }));
  const lp = s.lastPing;
  if (lp && s.time - lp.t < 6 && [...memory.values()].some((v) => v.alerted))
    out.push({ x: lp.x, y: lp.y });
  return out;
}

function safetyField(s, spots) {
  const fields = spots.map((d) => tunnelDistances(s.walls, ...tileOf(d.x, d.y)));
  return (c, r) => Math.min(99, ...fields.map((f) => (f[r * COLS + c] < 0 ? 99 : f[r * COLS + c])));
}

// Walk to the reachable tile that is safest, preferring short trips.
function flee(s, spots, hold) {
  const p = s.player,
    [pc, pr] = tileOf(p.x, p.y),
    mine = tunnelDistances(s.walls, pc, pr),
    safety = safetyField(s, spots);
  let best = null;
  for (let r = 0; r < 16; r++)
    for (let c = 0; c < COLS; c++) {
      const a = mine[r * COLS + c];
      if (a < 0 || a > 14) continue;
      const score = Math.min(safety(c, r), SAFE_TILES + 2) * 3 - a - (safety(c, r) <= a ? 40 : 0);
      if (!best || score > best.score) best = { c, r, score };
    }
  hold.target = best ? centerOf(best.c, best.r) : null;
  return best ? goTo(s, ...hold.target) : [];
}

// A human knows what keys they pressed in the last fraction of a second, so they can allow for
// the reaction delay: the believed position is the (late) seen position plus those moves.
function believedPosition(s, sent, lag) {
  let { x, y } = s.player;
  const step = (dx, dy) => {
    const free = (nx, ny) =>
      ![
        [-6, -6],
        [6, -6],
        [-6, 6],
        [6, 6],
      ].some(([ox, oy]) => solid(s.walls, ...tileOf(nx + ox, ny + oy)));
    if (free(x + dx, y)) x += dx;
    if (free(x, y + dy)) y += dy;
  };
  for (const e of sent) {
    if (e.t <= s.time - lag) continue;
    const ax = (e.held.includes('ArrowRight') ? 1 : 0) - (e.held.includes('ArrowLeft') ? 1 : 0),
      ay = (e.held.includes('ArrowDown') ? 1 : 0) - (e.held.includes('ArrowUp') ? 1 : 0),
      len = Math.hypot(ax, ay) || 1;
    step((ax / len) * 90 * e.dt, (ay / len) * 90 * e.dt);
  }
  return { x, y };
}

export function makePolicy(lag = 0.25, options = {}) {
  const inner = makeBrain(options),
    sent = [];
  let last = null,
    prevT = null;
  // A player keeps a heading for a moment instead of re-deciding every frame.
  return (s) => {
    const guess = believedPosition(s, sent, lag),
      view = { ...s, player: { ...s.player, x: guess.x, y: guess.y } };
    const a = inner(view);
    const urgent = s.lit.some((e) => e.kind === 'threat');
    let out = a;
    if (last && s.time - last.t < 0.3 && !urgent && !a.pressed.length)
      out = { held: last.held, pressed: [] };
    else last = { held: a.held, t: s.time };
    sent.push({
      t: s.time,
      held: out.held,
      dt: prevT === null ? 0 : Math.min(0.05, Math.max(0, s.time - prevT)),
    });
    prevT = s.time;
    if (sent.length > 120) sent.shift();
    return out;
  };
}

const ARROW = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };

function makeBrain({ noPing = false, literal = false, roam = false } = {}) {
  const memory = new Map(),
    hold = { target: null, until: 0 };
  return function decide(s) {
    const p = s.player,
      dist = (e) => Math.hypot(e.x - p.x, e.y - p.y),
      spots = literal ? [] : dangers(s, memory),
      [pc, pr] = tileOf(p.x, p.y),
      safe = spots.length ? safetyField(s, spots)(pc, pr) : 99;
    if (literal) {
      // A prompt-literal player does what the line says: the named arrow while a tremor shows,
      // and walks away from the last ping when the cave is roused.
      if (E.isDangerKey(s.prompt.key)) {
        hold.zones ??= [];
        // Remember where a tremor was felt so later stops and routes avoid that corner for a while.
        if (!hold.zones.some((z) => Math.hypot(z.x - p.x, z.y - p.y) < 60 && s.time - z.t < 60))
          hold.zones.push({ x: p.x, y: p.y, t: s.time });
        return { held: [ARROW[s.prompt.key.split('_')[2]]], pressed: [] };
      }
      if (s.prompt.key === 'roused' && s.lastPing)
        return { held: flee(s, [{ x: s.lastPing.x, y: s.lastPing.y }], hold), pressed: [] };
    }
    const lit = s.lit.find((e) => e.kind === 'drifter');
    if (lit && safe >= 3 && !s.marks.some((m) => m.id === lit.id)) {
      // The net needs a located target: a beetle in the lamp with no outline gets a ping first.
      return { held: [], pressed: quiet(s) && !noPing ? ['Space'] : [] };
    }
    if (lit && safe >= 3) {
      const held = dist(lit) > 22 ? goTo(s, lit.x, lit.y) : steer(p.x, p.y, lit.x, lit.y);
      return { held, pressed: dist(lit) < NET_BOT && p.netCooldown <= 0 ? ['KeyX'] : [] };
    }
    if (hold.until > s.time && hold.target) return { held: goTo(s, ...hold.target), pressed: [] };
    if (safe < SAFE_TILES && !(lit && safe >= 3)) {
      const held = flee(s, spots, hold);
      hold.until = s.time + 1.5; // commit to the escape for a moment instead of dithering
      return { held, pressed: [] };
    }
    const marks = s.marks.filter((m) => m.kind === 'drifter').sort((a, b) => a.age - b.age);
    if (marks.length) {
      const g = predict(s, marks[0]);
      if (dist(g) <= 36) {
        // Close but not yet in reach: step up to it and swing; re-ping once it is right there.
        const near = dist(g) <= 12;
        return {
          held: near ? [] : steer(p.x, p.y, g.x, g.y),
          pressed:
            dist(g) < NET_BOT && p.netCooldown <= 0 ? ['KeyX'] : near && quiet(s) ? ['Space'] : [],
        };
      }
      return { held: goTo(s, g.x, g.y), pressed: [] };
    }
    // Scan tour: a player who has learned the cavern pings from a few open stops, one after another.
    if (s.lastPing && s.lastPing.t !== hold.lastPingT) {
      hold.lastPingT = s.lastPing.t;
      hold.stop += 1;
    }
    if (hold.cavern !== s.cavern) Object.assign(hold, { cavern: s.cavern, stop: 0, lastPingT: -1 });
    hold.tours ??= {};
    hold.tours[s.cavern] ??= scanStops(s.walls, tileOf(p.x, p.y), laneTiles(s.cavern));
    const stops = hold.tours[s.cavern],
      calm = (stop) =>
        !(hold.zones ?? []).some(
          (z) =>
            s.time - z.t < 60 &&
            Math.hypot(z.x - centerOf(...stop)[0], z.y - centerOf(...stop)[1]) < 110,
        );
    // A roaming player jumps between spots at random instead of sweeping the cavern in order.
    let pick = (roam ? (hold.stop * 7 + 3) * 5 : hold.stop) % stops.length;
    for (let k = 0; k < stops.length && !calm(stops[pick]); k++) pick = (pick + 1) % stops.length;
    const [sc, sr] = stops[pick],
      [sx, sy] = centerOf(sc, sr);
    if (dist({ x: sx, y: sy }) < 22) {
      if (noPing) {
        hold.stop += 1; // sweep the same tour without ever using the sonar
        return { held: [], pressed: [] };
      }
      return { held: [], pressed: quiet(s) && safe >= SAFE_TILES ? ['Space'] : [] };
    }
    return { held: goTo(s, sx, sy), pressed: [] };
  };
}

export function playPolicy({
  hz,
  seed,
  jitter = false,
  maxSeconds = 600,
  build = (lag) => makePolicy(lag),
  spam = false,
  level = 1,
  campaign = false,
  watch = null,
  lang = 'en',
  saved = null,
  brokenStore = false,
}) {
  const policy = build(jitter ? 0.5 : 0.25);
  const h = harness({ seed, lang });
  // A saved game that reached `level` opens the chooser; Space continues there. The run is over when
  // that cavern is cleared (or the game ends).
  if (level > 1 || saved) h.env.progress = { unlocked: () => level, unlock: (n) => saved?.push(n) };
  if (brokenStore) {
    const fail = () => {
      throw new Error('store offline');
    };
    h.env.progress = { unlocked: fail, unlock: fail };
  }
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  const rnd = seeded(seed * 7 + 3);
  const history = [];
  const dt = 1 / hz;
  const base = jitter ? 0.4 : 0.15;
  const span = jitter ? 0.2 : 0.2;
  let delay = base + rnd() * span;
  let nextJitter = 0;
  const prompts = [];
  for (let t = 0; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    if (!campaign && s.cavern > level) break;
    watch?.(s);
    history.push({ t, s });
    if (history.length > hz * 1.2) history.shift();
    if (t >= nextJitter) {
      delay = base + rnd() * span;
      nextJitter = t + (jitter ? 0.3 + rnd() : 1 + rnd() * 2);
    }
    const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
    const a = policy(seen.s);
    if (!prompts.length || prompts.at(-1).key !== s.prompt.key)
      prompts.push({ key: s.prompt.key, t });
    const pressed = spam ? [...new Set([...a.pressed, 'Space'])] : a.pressed;
    g.update(dt, input(a.held, pressed));
  }
  const end = g.getState();
  return {
    h,
    g,
    prompts,
    seconds: end.time,
    cleared: end.phase === 'won' || end.cavern > level,
  };
}

// Blind adversaries that never ping and hold X whenever the net is ready: they walk to every
// lane endpoint of every variant (so the per-run lane draw cannot hide anything), or raster the floor.
function blindWalker(kind) {
  return () => {
    let k = 0,
      cavern = 0;
    return (s) => {
      if (cavern !== s.cavern) [cavern, k] = [s.cavern, 0];
      const spots =
        kind === 'lanes'
          ? E.CAVERNS[cavern - 1].drifters.flatMap((d) =>
              d.variants.flatMap((r) => [r.pts[0], r.pts.at(-1)]),
            )
          : laneTilesRaster(s.walls);
      const [tx, ty] = centerOf(...spots[k % spots.length]);
      if (Math.hypot(tx - s.player.x, ty - s.player.y) < 20) k++;
      return { held: goTo(s, tx, ty), pressed: s.player.netCooldown <= 0 ? ['KeyX'] : [] };
    };
  };
}
function laneTilesRaster(walls) {
  const out = [];
  for (let r = 1; r < 15; r += 3) {
    const row = [];
    for (let c = 1; c < COLS; c += 3) if (!solid(walls, c, r)) row.push([c, r]);
    out.push(...(((r - 1) / 3) % 2 ? row.reverse() : row));
  }
  return out;
}

const HZ = [30, 60, 120];
const LEVELS = E.CAVERNS.map((_, n) => n + 1);
const SEEDS = 6; // per rate and cavern: 18 runs each
const RUNS = SEEDS * HZ.length;

// How many of the 18 runs clear cavern `level` (1-based) from a fresh start.
const cleared = (options, level, seeds = SEEDS) => {
  let n = 0;
  for (const hz of HZ)
    for (let seed = 1; seed <= seeds; seed++) {
      const r = playPolicy({ hz, seed, level, maxSeconds: 300, ...options });
      assert.ok(r.h.ends.length <= 1, `seed ${seed} ended at most once`);
      if (r.cleared) n++;
    }
  return n;
};
const literal = (lag) => makePolicy(lag, { literal: true });

test('quality: a 0.15-0.35 s reaction policy using only visible information clears every cavern at every rate', () => {
  for (const level of LEVELS) {
    const n = cleared({}, level);
    assert.ok(n >= 15, `cavern ${level}: ${n}/${RUNS}`);
  }
});

test('quality: a 0.4-0.6 s jittery policy still clears every cavern at every rate', () => {
  for (const level of LEVELS) {
    const n = cleared({ jitter: true }, level);
    assert.ok(n >= 15, `cavern ${level} jitter: ${n}/${RUNS}`);
  }
});

test('quality: a prompt-literal player (only the prompt text plus drawn outlines) clears the caverns fast and slow', () => {
  for (const level of LEVELS) {
    const fast = cleared({ build: literal }, level, 4),
      slow = cleared({ build: literal, jitter: true }, level, 4);
    assert.ok(fast >= 8, `cavern ${level} fast: ${fast}/12`);
    assert.ok(slow >= 7, `cavern ${level} slow: ${slow}/12`);
  }
});

test('quality: pinging constantly does not win the campaign (noise rouses the cave and the crawlers hunt)', () => {
  let won = 0,
    runs = 0;
  for (const hz of HZ)
    for (let seed = 1; seed <= 1; seed++) {
      // Presses Space every frame, roams between spots at random, and still obeys every prompt.
      const r = playPolicy({
        hz,
        seed,
        level: 1,
        campaign: true,
        maxSeconds: 3000,
        spam: true,
        build: (lag) => makePolicy(lag, { literal: true, roam: true }),
      });
      runs++;
      if (r.g.getState().phase === 'won') won++;
    }
  assert.ok(won <= runs / 2, `spam campaign: ${won}/${runs}`);
});

test('quality: never pinging does not clear any cavern (the sonar is the core verb)', () => {
  for (const level of LEVELS) {
    const n = cleared({ build: (lag) => makePolicy(lag, { noPing: true }) }, level, 1);
    assert.equal(n, 0, `cavern ${level} no ping: ${n}`);
  }
});

test('quality: a lane-memorising or raster-sweeping blind net-spammer clears no cavern', () => {
  for (const kind of ['lanes', 'raster'])
    for (const level of LEVELS) {
      const n = cleared({ build: blindWalker(kind) }, level, 1);
      assert.equal(n, 0, `${kind} cavern ${level}: ${n}`);
    }
});

// Caverns with crawlers worth probing for tremor warnings, early to late.
const HUNTED = [
  'first-rumble',
  'first-echo',
  'crossed-tunnels',
  'deep-hollow',
  'whisper-maze',
  'roused-depths',
  'last-beacon',
].map((id) => E.CAVERNS.findIndex((c) => c.id === id));

test('quality: every bite, including one from a crawler back from an earlier bite, follows at least 0.6 s of tremor or prompt warning', () => {
  let hits = 0,
    shortest = Infinity;
  for (const start of HUNTED)
    for (const mode of ['bot', 'walk', 'spam'])
      for (let seed = 1; seed <= 4; seed++) {
        const w = E.createWorld(seeded(seed), { start }),
          pol = makePolicy(0.25),
          rnd = seeded(seed * 3 + 1),
          hist = [];
        let warn = 0,
          held = [];
        for (let i = 0; i < 60 * 150 && w.phase === 'playing' && w.cavern === start; i++) {
          const s = E.snapshot(w);
          hist.push(s);
          if (hist.length > 20) hist.shift();
          let a;
          if (mode === 'walk') {
            if (i % 30 === 0)
              held = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => rnd() < 0.4);
            a = { held, pressed: rnd() < 0.02 ? ['Space'] : [] };
          } else {
            a = pol(hist[Math.max(0, hist.length - 1 - 15)]);
            if (mode === 'spam') a = { ...a, pressed: ['Space'] };
          }
          const hp = w.hp;
          E.stepWorld(w, 1 / 60, input(a.held, a.pressed));
          warn = s.rumble || s.prompt.key.startsWith('danger_') ? warn + 1 / 60 : 0;
          if (w.hp < hp) {
            hits++;
            shortest = Math.min(shortest, warn);
            warn = 0;
          }
        }
      }
  assert.ok(hits > 30, `${hits} hits observed`);
  assert.ok(shortest >= 0.6, `shortest warning ${shortest.toFixed(2)} s`);
});

test('quality: standing still never loses on a hidden timer, but a player who only spams pings is hunted', () => {
  const idle = harness({ seed: 2 });
  const g = createGame(idle.env);
  for (let i = 0; i < 60 * 400; i++) g.update(1 / 60, input([]));
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.hp, E.MAX_HP);
  assert.equal(idle.ends.length, 0);
  // Holding Space while standing still burns the whole budget, rouses the cave, and then only the
  // slow trickle (one ping per trickle period) is left. The fifth cavern is the first with a hunter.
  const first = E.CAVERNS.findIndex((c) => c.id === 'first-echo');
  const loud = harness({ seed: 2 });
  loud.env.progress = { unlocked: () => first + 1, unlock() {} };
  const q = createGame(loud.env);
  q.update(1 / 60, input([], ['Space'])); // continue from the saved cavern
  let pings = 0,
    roused = false;
  for (let i = 0; i < 60 * 400 && !loud.ends.length; i++) {
    q.update(1 / 60, input([], ['Space']));
    const st = q.getState();
    pings += st.events.includes('ping') ? 1 : 0;
    roused ||= st.alarm.roused;
  }
  assert.equal(roused, true, 'constant pinging rouses the cave');
  assert.ok(pings >= E.SONAR_START[first], `pings ${pings}`);
  assert.ok(
    pings <= E.SONAR_START[first] + Math.ceil(400 / E.SONAR_TRICKLE[first]),
    `the budget caps pings at ${pings}`,
  );
});

test('quality: prompts name keys, hold for half a second, never flip back quickly and match visible danger', () => {
  const gaps = [];
  for (const [seed, hz, level] of [
    [1, 60, 5],
    [2, 30, 8],
    [3, 120, 12],
    [4, 60, 17],
    [5, 60, 20],
  ]) {
    const { prompts, g } = playPolicy({ hz, seed, level });
    const end = g.getState().time;
    prompts.forEach((p, n) => {
      const next = prompts[n + 1]?.t ?? end;
      if (prompts[n + 1]) gaps.push(next - p.t);
      const back = prompts[n + 2];
      if (back && back.key === p.key)
        assert.ok(back.t - p.t >= 1, `${p.key} flips back within ${back.t - p.t}s`);
    });
    for (const p of prompts) assert.ok(E.PROMPTS[p.key], p.key);
  }
  assert.ok(gaps.length > 40);
  const hurried = gaps.filter((d) => d < 0.5 - 1e-6);
  // A new cavern resets its prompt; nothing else may change faster than the 0.55 s hold.
  assert.ok(hurried.length <= 3, `${hurried.length} prompt changes under 0.5 s: ${hurried}`);
  for (const [key, [en, zh]] of Object.entries(E.PROMPTS)) {
    if (
      ['cooldown', 'noise', 'empty', 'dry', 'roused', 'select'].includes(key) ||
      key.startsWith('chase_')
    )
      continue;
    if (E.isDangerKey(key)) assert.match(en, /move (left|right|up|down) \([←→↑↓]\)/, key);
    else assert.match(en + zh, /Space|X|Arrows|空格|方向键/, key);
  }
});

test('quality: the danger prompt appears within the hold time and no hazard-directed prompt is shown for long', () => {
  const w = E.createWorld(seeded(1), { start: E.CAVERNS.findIndex((c) => c.id === 'first-echo') });
  w.p.inv = 99;
  w.drifters = [
    {
      ...w.drifters[0],
      x: 3000,
      y: 3000,
      pts: [
        [3000, 3000],
        [3000, 3000],
      ],
      speed: 0,
    },
  ];
  w.threats = [
    {
      ...w.threats[0],
      x: w.p.x + 200,
      y: w.p.y,
      pts: [
        [w.p.x + 200, w.p.y],
        [w.p.x + 200, w.p.y],
      ],
      speed: 0,
    },
  ];
  for (let i = 0; i < 120; i++) E.stepWorld(w, 1 / 120, input([]));
  assert.doesNotMatch(E.snapshot(w).prompt.key, /^danger_/);
  w.threats[0].x = w.p.x + 25;
  let late = 0;
  for (let i = 0; i < 120; i++) {
    E.stepWorld(w, 1 / 120, input([]));
    if (!E.isDangerKey(E.snapshot(w).prompt.key)) late++;
  }
  assert.ok(late / 120 <= 0.56, `danger prompt delayed ${late / 120}s`);
  assert.match(E.snapshot(w).prompt.key, /^danger_/);
  assert.match(E.snapshot(w).prompt.en, /Tremor from the right: move/);
});

test('quality: event messages reach the localized status during a real game', () => {
  const seen = new Set();
  for (const lang of ['en', 'zh']) {
    // Continue from the third cavern: three beetles, so a catch is announced before the clear.
    playPolicy({
      hz: 60,
      seed: 3,
      level: 3,
      lang,
      watch: (s) => {
        const status = lang === 'en' ? s.status.en : s.status.zh;
        assert.ok(status.includes(lang === 'en' ? 'HP' : '生命'));
        if (s.message) seen.add(status);
      },
    });
  }
  const all = [...seen].join('\n');
  assert.match(all, /Beacon recovered!/);
  assert.match(all, /信标已回收/);
  assert.match(all, /X swings the net/, 'the third lesson is shown');
  assert.match(all, /X挥网/);
});

test('quality: the whole campaign is clearable, ends once, freezes afterwards and a new instance starts fresh', () => {
  const saved = [];
  const { h, g } = playPolicy({
    saved,
    hz: 60,
    seed: 1,
    level: 1,
    campaign: true,
    maxSeconds: 4000,
    build: (lag) => makePolicy(lag),
  });
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.ok(h.ends[0].score >= 20 * 150 + 20, `score ${h.ends[0].score}`);
  assert.ok(h.sounds.includes('win'));
  assert.equal(g.getState().cavern, E.CAVERNS.length);
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowLeft'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  // Every cleared cavern was saved, one at a time, ending on the last.
  assert.deepEqual(
    saved.slice(0, 19),
    Array.from({ length: 19 }, (_, n) => n + 2),
  );
  assert.equal(saved.at(-1), E.CAVERNS.length);
  const fresh = harness({ seed: 1 });
  const again = createGame(fresh.env).getState();
  assert.equal(again.phase, 'playing');
  assert.equal(again.score, 0);
  assert.equal(again.cavern, 1);
  assert.equal(again.hp, E.MAX_HP);
});

test('quality: a progress store that throws on read and on save never stops a cavern clear', () => {
  const r = playPolicy({ hz: 60, seed: 1, level: 1, maxSeconds: 300, brokenStore: true });
  assert.equal(r.cleared, true);
  assert.equal(r.g.getState().cavern, 2);
});

test('quality: the twenty cavern shapes all differ and the curve adds hunters and tightens the budget', () => {
  const walls = new Set(E.CAVERNS.map((c) => c.map.join('')));
  assert.equal(walls.size, 20);
  const hunters = E.CAVERNS.map((c) => c.threats.length),
    mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(hunters.slice(-5)) > mean(hunters.slice(4, 9)), 'later caverns have more hunters');
  assert.ok(mean(hunters.slice(4, 9)) > mean(hunters.slice(0, 4)));
  const budget = E.CAVERNS.map((c) => c.charges);
  assert.ok(mean(budget.slice(-5)) < mean(budget.slice(0, 5)), 'the ping budget tightens');
});
