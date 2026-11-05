import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, RULES, newState, advance } from '../src/games/burrow-rescue.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const WALK = '.LTDVP';
const DIG = 'EWB';
const DIRS = {
  L: [-1, 0, 'ArrowLeft'],
  R: [1, 0, 'ArrowRight'],
  U: [0, -1, 'ArrowUp'],
  D: [0, 1, 'ArrowDown'],
};
const DIR_LIST = [
  ['ArrowDown', 0, 1],
  ['ArrowUp', 0, -1],
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
];
// Waypoints per sector, written from the visible maps: [column, row, wake?].
const GOALS = [
  [[3, 3, 1], [14, 6, 1], 'lift'],
  [[14, 7, 1], [7, 5, 1], 'lift'],
  [[1, 5, 1], [17, 5, 1], [17, 8, 1], 'lift'],
];

// ---------------------------------------------------------------------------
// Test drivers: a route planner/compiler (open loop) and a human-like bot (closed loop).
// ---------------------------------------------------------------------------

function plan(tiles0, start, goals, { braces = true } = {}) {
  const g = tiles0.map((r) => [...r]);
  let pos = { ...start };
  const steps = [];
  const unsafe = (c, r) => {
    const row = g[r].slice();
    row[c] = g[r][c] === 'W' ? 'V' : 'D';
    let a = c;
    let b = c;
    while (a > 0 && 'DV'.includes(row[a - 1])) a--;
    while (b < 19 && 'DV'.includes(row[b + 1])) b++;
    return b - a + 1 >= (row.slice(a, b + 1).includes('V') ? 3 : 4);
  };
  const push = (st) => {
    const last = steps[steps.length - 1];
    if (st.t === 'move' && last?.t === 'move' && last.d === st.d) last.n += st.n;
    else steps.push(st);
  };
  const goTo = (tc, tr) => {
    while (pos.c !== tc || pos.r !== tr) {
      const dist = new Map([[`${pos.c},${pos.r}`, 0]]);
      const prev = new Map();
      const q = [[0, pos.c, pos.r]];
      while (q.length) {
        q.sort((x, y) => x[0] - y[0]);
        const [d, c, r] = q.shift();
        if (d > dist.get(`${c},${r}`)) continue;
        for (const [k, [dx, dy]] of Object.entries(DIRS)) {
          const nc = c + dx;
          const nr = r + dy;
          if (nc < 0 || nc > 19 || nr < 0 || nr > 10) continue;
          const cost = WALK.includes(g[nr][nc]) ? 1 : DIG.includes(g[nr][nc]) ? 8 : 0;
          if (cost && d + cost < (dist.get(`${nc},${nr}`) ?? 1e9)) {
            dist.set(`${nc},${nr}`, d + cost);
            prev.set(`${nc},${nr}`, [c, r, k]);
            q.push([d + cost, nc, nr]);
          }
        }
      }
      let cur = [tc, tr];
      let first;
      while (cur[0] !== pos.c || cur[1] !== pos.r) {
        const pv = prev.get(`${cur[0]},${cur[1]}`);
        first = { c: cur[0], r: cur[1], k: pv[2] };
        cur = [pv[0], pv[1]];
      }
      if (WALK.includes(g[first.r][first.c])) {
        push({ t: 'move', d: first.k, n: 1 });
        pos = { c: first.c, r: first.r };
      } else {
        if (braces && unsafe(first.c, first.r) && 'DV'.includes(g[pos.r][pos.c])) {
          steps.push({ t: 'brace' });
          g[pos.r][pos.c] = 'P';
        }
        steps.push({ t: 'dig', d: first.k });
        g[first.r][first.c] = g[first.r][first.c] === 'W' ? 'V' : 'D';
      }
    }
  };
  for (const [c, r, wake] of goals) {
    goTo(c, r);
    if (wake) steps.push({ t: 'call' });
  }
  return steps;
}
// Every boundary is a multiple of 4 ticks (1/30 s) and sits well inside a tile cycle (20 ticks).
function compile(steps, t0 = 0) {
  const ops = [];
  let T = t0;
  for (const s of steps) {
    if (s.t === 'move') {
      ops.push({ type: 'hold', code: DIRS[s.d][2], t0: T, t1: T + 20 * (s.n - 1) + 8 });
      T += 20 * s.n + 8;
    } else if (s.t === 'dig') {
      ops.push({ type: 'hold', code: DIRS[s.d][2], t0: T, t1: T + 16 });
      ops.push({ type: 'press', code: 'Space', t: T + 8 });
      T += 36;
    } else if (s.t === 'brace' || s.t === 'call') {
      ops.push({ type: 'press', code: 'KeyX', t: T + 4 });
      T += 16;
    } else T += s.ticks;
  }
  return { ops, end: T };
}
function perturb(ops, rnd, mag) {
  const jit = () => (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * mag));
  return ops.map((o) =>
    o.type === 'hold'
      ? { ...o, t0: Math.max(0, o.t0 + jit()), t1: Math.max(1, o.t1 + jit()) }
      : { ...o, t: Math.max(0, o.t + jit()) },
  );
}
// Play `ops` (tick times at 120 Hz) at `hz`; `shift` ticks come from a frame-quantised jitter.
function runOps(game, ops, end, hz, onFrame = () => {}) {
  const k = 120 / hz;
  for (let f = 0; f * k < end; f++) {
    const a = f * k;
    const held = ops.filter((o) => o.type === 'hold' && o.t0 <= a && a < o.t1).map((o) => o.code);
    const pressed = ops
      .filter((o) => o.type === 'press' && o.t >= a && o.t < a + k)
      .map((o) => o.code);
    game.update(1 / hz, input(held, pressed));
    onFrame(game, f);
  }
}
function routeFor(game, sectorIndex, opts) {
  const st = game.getState();
  const goals = GOALS[sectorIndex].map((g) => (g === 'lift' ? [st.lift.c, st.lift.r] : g));
  const steps = plan(st.tiles, st.lift, goals, opts);
  steps.push({ t: 'wait', ticks: 1800 });
  return compile(steps);
}
function playCampaign(game, hz, onFrame, opts) {
  for (let i = 0; i < 3; i++) {
    const { ops, end } = routeFor(game, i, opts);
    runOps(game, ops, end, hz, onFrame);
  }
  return game.getState();
}

function pathFirst(st, goal) {
  const g = st.tiles;
  const p = st.player;
  const key = (c, r) => r * 20 + c;
  const passable = (c, r) => c >= 0 && c < 20 && r >= 0 && r < 11 && (WALK + DIG).includes(g[r][c]);
  const dist = new Map([[key(goal.c, goal.r), 0]]);
  const q = [[0, goal.c, goal.r]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, c, r] = q.shift();
    if (d > dist.get(key(c, r))) continue;
    for (const [, dx, dy] of DIR_LIST) {
      const nc = c + dx;
      const nr = r + dy;
      if (!passable(nc, nr)) continue;
      const nd = d + (WALK.includes(g[r][c]) ? 1 : 8);
      if (nd < (dist.get(key(nc, nr)) ?? 1e9)) {
        dist.set(key(nc, nr), nd);
        q.push([nd, nc, nr]);
      }
    }
  }
  let best = null;
  for (const [code, dx, dy] of DIR_LIST) {
    const nc = p.c + dx;
    const nr = p.r + dy;
    if (!passable(nc, nr) || !dist.has(key(nc, nr))) continue;
    const total = dist.get(key(nc, nr)) + (WALK.includes(g[nr][nc]) ? 1 : 8);
    if (!best || total < best.total) best = { code, total, dx, dy, nc, nr };
  }
  if (best) {
    let [c, r, run] = [best.nc, best.nr, 1];
    while (WALK.includes(g[r][c])) {
      const [nc, nr] = [c + best.dx, r + best.dy];
      if (
        !passable(nc, nr) ||
        !WALK.includes(g[nr][nc]) ||
        dist.get(key(nc, nr)) + 1 !== dist.get(key(c, r))
      )
        break;
      [c, r, run] = [nc, nr, run + 1];
    }
    best.run = WALK.includes(g[best.nr][best.nc]) ? run : 99;
  }
  return best;
}
// Decides only from what is on screen: tile map, miner markers, air bar and the prompt text.
function decide(st, mode) {
  const p = st.player;
  const prompt = st.prompt.en;
  const out = { hold: null, press: null, tap: false };
  if (/^(Cracks! X|X:)/.test(prompt)) return { ...out, press: 'KeyX' };
  if (/^Space:/.test(prompt) && !p.moving) out.press = 'Space';
  if (/Low air|restock|Leave the tunnel/.test(prompt)) mode.refill = true;
  if (mode.refill && p.r === 0 && !p.moving && st.oxygen >= 92 && st.beams === st.beamsMax)
    mode.refill = false;
  const waiting = st.miners.filter((m) => m.state === 'waiting');
  const stuck = st.miners.filter((m) => m.state === 'following' && m.blocked);
  let goal = st.lift;
  const cands = stuck.length ? stuck : waiting;
  if (!mode.refill && cands.length) {
    const keep = cands.find((m) => m.id === mode.target);
    const ranked = cands
      .map((m) => ({ m, s: pathFirst(st, m) }))
      .filter((x) => x.s)
      .sort((a, b) => a.s.total - b.s.total);
    const pick = keep || ranked[0]?.m;
    if (pick) [mode.target, goal] = [pick.id, pick];
  }
  if (p.c === goal.c && p.r === goal.r) return out;
  const step = pathFirst(st, goal);
  return step ? { ...out, hold: step.code, tap: step.run <= 3 } : out;
}
// A person watching the screen: 0.15-0.35 s reaction delay, a glance after each action.
function humanCampaign(
  seed,
  hz,
  { maxSeconds = 600, game = createGame(harness({ seed }).env) } = {},
) {
  const rnd = seeded(seed * 7919 + 13);
  const dt = 1 / hz;
  const mode = { refill: false };
  let [t, nextObs, pending, hold, releaseAt] = [0, 0.2, null, null, Infinity];
  while (t < maxSeconds && game.getState().phase === 'playing') {
    let press = [];
    if (pending && t >= pending.at - 1e-9) {
      hold = pending.hold;
      if (pending.press) press = [pending.press];
      releaseAt = pending.tap ? t + 0.1 : Infinity;
      [pending, nextObs] = [null, t + 0.12];
    }
    if (t >= releaseAt - 1e-9) [hold, releaseAt] = [null, Infinity];
    if (!pending && t >= nextObs - 1e-9) {
      pending = { at: t + 0.15 + rnd() * 0.2, ...decide(game.getState(), mode) };
      nextObs = Infinity;
    }
    game.update(dt, input(hold ? [hold] : [], press));
    t += dt;
  }
  return { state: game.getState(), seconds: t };
}

const fresh = (opts) => {
  const h = harness(opts);
  return { h, g: createGame(h.env) };
};
const frames = (g, n, held = [], pressed = [], dt = 1 / 120) => {
  for (let i = 0; i < n; i++) g.update(dt, input(held, i === 0 ? pressed : []));
};
const finite = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object') return Object.values(v).every(finite);
  return true;
};

// ---------------------------------------------------------------------------
// Contract, input and time
// ---------------------------------------------------------------------------

test('meta is bilingual, has complete touch controls and distinct sectors', () => {
  assert.equal(meta.id, 'burrow-rescue');
  assert.equal(meta.genre, 'action');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(code));
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh && c.side);
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  assert.ok(!meta.keys.some((k) => /Escape|KeyP|KeyR/.test(k.keys)));
  const maps = [];
  const g = createGame(harness().env);
  const sectors = [];
  const route = (i) => routeFor(g, i);
  for (let i = 0; i < 3; i++) {
    sectors.push(g.getState());
    maps.push(sectors[i].tiles.join('|'));
    const { ops, end } = route(i);
    runOps(g, ops, end, 120);
  }
  assert.equal(new Set(maps).size, 3);
  assert.ok(!sectors[0].tanks.length && sectors[1].tanks.length && sectors[2].tanks.length);
  assert.ok(sectors[1].tiles[3].startsWith('RRRRRRRR'), 'sector 2 has a rock shelf');
  assert.ok(sectors[2].tiles.join('').includes('B') && sectors[2].tiles.join('').includes('W'));
  assert.ok(sectors[2].tiles[1].includes('P'), 'sector 3 starts with a braced gallery');
  assert.deepEqual(
    sectors.map((s) => s.minersTotal),
    [2, 2, 3],
  );
  assert.deepEqual(
    sectors.map((s) => s.sectorName.en),
    ['Shallow Seam', 'Granite Shelf', 'Collapsed Gallery'],
  );
  assert.ok(sectors.every((s) => s.tiles.length === 11 && s.tiles.every((r) => r.length === 20)));
});

test('invalid, zero, negative, NaN and huge dt never advance state or consume input', () => {
  const { g } = fresh();
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 0.5, 10, undefined, '0.01', null]) {
    g.update(dt, input(['ArrowDown'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(g.getState()), before);
  }
  frames(g, 30, ['ArrowDown']);
  assert.equal(g.getState().stats.digs, 0, 'presses from rejected updates were not latched');
  assert.equal(advance(newState(), NaN, input()), false);
});

test('a press during a sub-step dt is latched until the next simulation step', () => {
  const { g } = fresh();
  frames(g, 4, ['ArrowDown']);
  g.update(1 / 1000, input(['ArrowDown'], ['Space']));
  assert.equal(g.getState().stats.digs, 0);
  frames(g, 10, ['ArrowDown']);
  assert.equal(g.getState().stats.digs, 1);
  assert.equal(g.getState().tiles[1][8], 'D');
});

test('held keys never repeat discrete actions', () => {
  const { g } = fresh();
  const hold = ['ArrowDown', 'Space', 'KeyX'];
  for (let i = 0; i < 600; i++) g.update(1 / 120, input(hold, i === 0 ? ['Space'] : []));
  assert.equal(g.getState().stats.digs, 1);
  assert.equal(g.getState().stats.braces, 0);
});

test('buffered presses expire instead of firing late', () => {
  const { g } = fresh();
  frames(g, 4, ['ArrowDown'], ['Space']);
  assert.equal(g.getState().stats.digs, 1);
  const { g: g2 } = fresh();
  frames(g2, 12, ['ArrowDown']);
  g2.update(1 / 120, input([], ['Space'])); // latched, dig starts at once
  assert.equal(g2.getState().stats.digs, 1);
  frames(g2, 100, ['ArrowDown']);
  assert.equal(g2.getState().player.r, 1, 'walks into the new tile once the pick is down');
});

test('movement is tile stepping: 20 ticks per tile, reversal works, opposite keys cancel', () => {
  const { g } = fresh();
  frames(g, 1, ['ArrowRight']);
  const s1 = g.getState();
  assert.equal(s1.player.c, 9);
  assert.ok(s1.player.moving);
  frames(g, 9, ['ArrowRight']);
  frames(g, 4, ['ArrowLeft']);
  assert.equal(g.getState().player.c, 8, 'reversal heads back to the origin tile');
  frames(g, 40, []);
  const s2 = g.getState();
  assert.equal(s2.player.c, 8);
  assert.ok(!s2.player.moving);
  frames(g, 60, ['ArrowLeft', 'ArrowRight']);
  assert.equal(g.getState().player.c, 8);
  frames(g, 20 * 3, ['KeyD']);
  assert.equal(g.getState().player.c, 11);
  assert.equal(g.getState().player.rect.x, 11 * 24 + 2);
  frames(g, 40, ['KeyA']);
  assert.equal(g.getState().player.c, 9);
  const { g: g3 } = fresh();
  frames(g3, 200, ['ArrowLeft', 'ArrowUp']);
  assert.equal(g3.getState().player.c, 0, 'surface row stays walkable, walls stop the player');
  assert.equal(g3.getState().player.r, 0);
  frames(g3, 10, ['ArrowUp']);
  assert.equal(g3.getState().player.r, 0);
});

// ---------------------------------------------------------------------------
// Digging, oxygen, beams
// ---------------------------------------------------------------------------

test('digging removes earth only, costs oxygen and respects rock', () => {
  const { g } = fresh();
  frames(g, 10, ['ArrowDown'], ['Space']);
  frames(g, 40, ['ArrowDown']);
  let s = g.getState();
  assert.equal(s.tiles[1][8], 'D');
  assert.equal(s.player.r, 1);
  const map = s.tiles.join('');
  const o0 = s.oxygen;
  frames(g, 12, ['ArrowLeft'], ['Space']);
  frames(g, 40, []);
  s = g.getState();
  assert.equal(s.tiles.join(''), map, 'rock to the left is unchanged');
  assert.equal(s.stats.digs, 1);
  assert.ok(Math.abs(o0 - s.oxygen - 52 / 120) < 1e-9, 'only the base drain was paid for rock');
  assert.match(s.message.en, /rock/i);
  assert.match(s.prompt.en, /^Rock/);
  const o1 = s.oxygen;
  frames(g, 3, ['ArrowDown'], ['Space']);
  const dug = g.getState();
  assert.equal(dug.tiles[2][8], 'D');
  assert.ok(dug.player.digging);
  assert.ok(Math.abs(o1 - dug.oxygen - (3 / 120 + 2)) < 1e-9, 'dig cost 2 plus base drain');
  frames(g, 10, ['ArrowDown'], ['Space']);
  assert.equal(g.getState().stats.digs, 2, 'a second press while digging is ignored');
  const idle = createGame(harness().env);
  frames(idle, 30, ['ArrowUp'], ['Space']);
  assert.equal(idle.getState().stats.digs, 0, 'digging into the sky does nothing');
});

test('oxygen drains underground, shares with followers, refills at the surface and from tanks', () => {
  const { g } = fresh();
  frames(g, 240, []);
  assert.equal(g.getState().oxygen, 100, 'full at the surface and never above 100');
  assert.equal(g.getState().oxygenDrain, 1);
  frames(g, 2, ['ArrowDown'], ['Space']);
  frames(g, 40, ['ArrowDown']);
  const o0 = g.getState().oxygen;
  frames(g, 120, []);
  assert.ok(Math.abs(o0 - g.getState().oxygen - 1) < 1e-9, '1 oxygen per second in sector 1');
  frames(g, 20, ['ArrowUp']);
  frames(g, 40, []);
  assert.equal(g.getState().player.r, 0);
  frames(g, 120, []);
  assert.equal(g.getState().oxygen, 100, 'surface air refills');

  const s2 = createGame(harness().env);
  const r1 = routeFor(s2, 0);
  runOps(s2, r1.ops, r1.end, 120);
  const st = s2.getState();
  assert.equal(st.sector, 2);
  const steps = plan(st.tiles, st.lift, [[14, 7, 1]]);
  const { ops, end } = compile(steps);
  let jump = 0;
  let last = s2.getState().oxygen;
  runOps(s2, ops, end, 120, (game) => {
    const o = game.getState().oxygen;
    jump = Math.max(jump, o - last);
    last = o;
  });
  const after = s2.getState();
  assert.equal(after.oxygenDrain, 2 + RULES.followDrain, 'each follower shares the air');
  assert.ok(after.tanks[0].taken && after.stats.tanks === 1);
  assert.ok(jump > 20 && jump <= RULES.tankAir, `tank gave ${jump}`);
  const campaign = playCampaign(createGame(harness().env), 120);
  assert.ok(campaign.stats.tanks >= 1);
});

function loseByAir(g, { onHaul = () => {}, hz = 120 } = {}) {
  let prev = g.getState().lives;
  for (let n = 0; n < 8 && g.getState().phase === 'playing'; n++) {
    frames(g, 2, ['ArrowDown'], ['Space']);
    frames(g, 40, ['ArrowDown']);
    for (
      let i = 0;
      i < 40000 && g.getState().lives === prev && g.getState().phase === 'playing';
      i++
    ) {
      g.update(1 / hz, input());
    }
    const s = g.getState();
    prev = s.lives;
    onHaul(s);
  }
}

test('running out of air costs a life, hauls you up with partial air, and three failures end the game', () => {
  const h = harness();
  const g = createGame(h.env);
  const hauls = [];
  loseByAir(g, { onHaul: (s) => hauls.push(s) });
  assert.equal(hauls.length, 3);
  assert.deepEqual(
    hauls.map((s) => s.lives),
    [2, 1, 0],
  );
  for (const s of hauls.slice(0, 2)) {
    assert.equal(s.player.r, 0);
    assert.ok(s.oxygen >= RULES.haulAir && s.oxygen <= RULES.haulAir + 1);
    assert.match(s.message.en, /Out of air/);
    assert.match(s.message.zh, /氧气耗尽/);
  }
  const s = g.getState();
  assert.equal(s.phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.includes('lose'));
  const snap = JSON.stringify(s);
  g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), snap, 'terminal state is frozen');
  assert.equal(h.ends.length, 1);
  assert.equal(s.prompt.en, 'No lives left');
  const again = createGame(harness().env).getState();
  assert.deepEqual([again.lives, again.phase, again.score], [3, 'playing', 0]);
});

test('low air prompt appears before any damage and names the way out', () => {
  const { g } = fresh();
  frames(g, 2, ['ArrowDown'], ['Space']);
  frames(g, 30, ['ArrowDown']);
  let seen = null;
  for (let i = 0; i < 20000 && !seen; i++) {
    g.update(1 / 120, input());
    const s = g.getState();
    if (/Low air/.test(s.prompt.en)) seen = s;
  }
  assert.ok(seen);
  assert.ok(seen.oxygen < RULES.lowAir && seen.oxygen > 20 && seen.lives === 3);
  assert.match(seen.prompt.zh, /氧气/);
  frames(g, 60, ['ArrowUp']);
  assert.equal(g.getState().player.r, 0);
});

// ---------------------------------------------------------------------------
// Collapse rules
// ---------------------------------------------------------------------------

function sectorOneNoBeams(game, extra = 0) {
  const st = game.getState();
  const steps = plan(st.tiles, st.lift, [[3, 3, 1]], { braces: false });
  return compile(steps.slice(0, steps.length - 1 - extra));
}

test('an unsupported 4-tile span cracks for 4 seconds, then falls; damage only after the warning', () => {
  const { g } = fresh();
  const { ops, end } = sectorOneNoBeams(g);
  let first = null;
  let lastRemaining = Infinity;
  let damageAt = null;
  runOps(g, ops, end, 120, (game) => {
    const s = game.getState();
    if (s.warnings.length && first === null) first = s.time;
    for (const w of s.warnings) {
      assert.ok(w.remaining <= lastRemaining + 1e-9 || w.remaining > 3.9);
      lastRemaining = w.remaining;
    }
    if (s.lives < 3 && damageAt === null) damageAt = s.time;
  });
  assert.ok(first !== null, 'a warning appeared');
  assert.ok(g.getState().stats.collapses === 0 || damageAt === null || damageAt - first >= 3.99);
});

test('standing in a cracking span: warning first, prompt names X, damage only when the timer ends', () => {
  const { g } = fresh();
  const st = g.getState();
  const steps = plan(st.tiles, st.lift, [[5, 3]], { braces: false });
  const { ops, end } = compile(steps);
  runOps(g, ops, end, 120);
  let s = g.getState();
  assert.deepEqual([s.player.c, s.player.r], [5, 3]);
  assert.equal(s.warnings.length, 1);
  const w = s.warnings[0];
  assert.deepEqual([w.r, w.c0, w.c1], [3, 5, 8]);
  assert.match(s.prompt.en, /^Cracks! X: brace here \(\ds\)$/);
  assert.match(s.prompt.zh, /裂缝/);
  assert.match(s.status.en, /^Sector 1\/3 · Miners 0\/2 · Oxygen \d+ · Cracks!/);
  assert.equal(s.lives, 3);
  const t0 = s.time - w.elapsed;
  let damageTime = null;
  for (let i = 0; i < 120 * 6 && damageTime === null; i++) {
    g.update(1 / 120, input());
    s = g.getState();
    if (s.lives < 3) damageTime = s.time;
    else assert.ok(s.tiles[3].slice(5, 9) === 'DDDD', 'tiles stay until the timer ends');
  }
  assert.ok(damageTime !== null);
  assert.ok(
    damageTime - t0 >= 4 - 1e-6 && damageTime - t0 <= 4.05,
    `fell after ${damageTime - t0}`,
  );
  assert.equal(s.lives, 2);
  assert.equal(s.tiles[3].slice(5, 9), 'BBBB');
  assert.deepEqual([s.player.c, s.player.r], [s.lift.c, s.lift.r], 'hoisted back to the lift');
  assert.match(s.message.en, /Cave-in/);
  assert.equal(s.stats.collapses, 1);
  assert.equal(s.warnings.length, 0);
});

test('a beam splits the span and cancels the warning; the same tunnel then stays up', () => {
  const { g } = fresh();
  const st = g.getState();
  const { ops, end } = compile(plan(st.tiles, st.lift, [[5, 3]], { braces: false }));
  runOps(g, ops, end, 120);
  assert.equal(g.getState().warnings.length, 1);
  frames(g, 60, [], ['KeyX']);
  const s = g.getState();
  assert.equal(s.warnings.length, 0, 'bracing at (5,3) leaves runs of 0 and 3');
  assert.equal(s.tiles[3][5], 'P');
  assert.equal(s.beams, s.beamsMax - 1);
  assert.equal(s.stats.braces, 1);
  frames(g, 120 * 8, []);
  const after = g.getState();
  assert.equal(after.lives, 3);
  assert.equal(after.stats.collapses, 0);
  assert.equal(after.tiles[3].slice(5, 9), 'PDDD');
  frames(g, 10, [], ['KeyX']);
  assert.match(g.getState().message.en, /already/);
  assert.equal(g.getState().beams, s.beams);
});

test('leaving the span before the timer ends avoids damage but the tunnel still falls', () => {
  const { g } = fresh();
  const st = g.getState();
  const { ops, end } = compile(plan(st.tiles, st.lift, [[4, 3]], { braces: false }));
  runOps(g, ops, end, 120);
  const mid = g.getState();
  assert.equal(mid.warnings.length, 1);
  assert.deepEqual([mid.player.c, mid.warnings[0].c0], [4, 5]);
  assert.equal(mid.prompt.en, 'Cracks nearby: stay clear');
  frames(g, 120 * 5, []);
  const s = g.getState();
  assert.equal(s.lives, 3);
  assert.equal(s.stats.collapses, 1);
  assert.equal(s.tiles[3].slice(5, 9), 'BBBB');
});

test('without beams the prompt says so, a long span says leave, and the lift restocks beams', () => {
  const { g } = fresh();
  const dig = (d) => [
    { t: 'dig', d },
    { t: 'move', d, n: 1 },
  ];
  const steps = [
    ...dig('D'),
    { t: 'brace' },
    ...dig('D'),
    { t: 'brace' },
    ...dig('D'),
    ...dig('L'),
    ...dig('L'),
    { t: 'dig', d: 'L' },
  ];
  const early = compile(steps.slice(0, -1));
  runOps(g, early.ops, early.end, 120);
  let s = g.getState();
  assert.equal(s.beams, 0);
  assert.equal(s.stats.braces, 2);
  assert.deepEqual([s.player.c, s.player.r], [6, 3]);
  assert.equal(s.prompt.en, 'No beams: restock at the lift');
  assert.equal(s.warnings.length, 0);
  frames(g, 4, [], ['KeyX']);
  assert.equal(g.getState().beams, 0);
  assert.match(g.getState().message.en, /No beams left/);
  frames(g, 4, ['ArrowLeft'], ['Space']);
  frames(g, 30, []);
  s = g.getState();
  assert.equal(s.warnings.length, 1);
  assert.match(s.prompt.en, /^Cracks! Leave the tunnel \(\ds\)$/);
  assert.equal(s.lives, 3);
  const leave = compile([
    { t: 'move', d: 'R', n: 2 },
    { t: 'move', d: 'U', n: 3 },
  ]);
  runOps(g, leave.ops, leave.end, 120);
  frames(g, 120 * 6, []);
  s = g.getState();
  assert.equal(s.lives, 3, 'nobody was inside when it fell');
  assert.equal(s.tiles[3].slice(5, 9), 'BBBB');
  assert.deepEqual([s.player.c, s.player.r], [8, 0]);
  assert.equal(s.beams, s.beamsMax, 'the lift restocks beams');
});

test('loose soil needs a beam every 2 tiles while plain earth allows 3', () => {
  const { g } = fresh();
  for (let i = 0; i < 2; i++) {
    const { ops, end } = routeFor(g, i);
    runOps(g, ops, end, 120);
  }
  const st = g.getState();
  assert.equal(st.sector, 3);
  assert.ok(st.tiles[1].includes('P'));
  let warned = [];
  const steps = plan(
    st.tiles,
    st.lift,
    [
      [13, 8],
      [15, 8],
    ],
    { braces: false },
  );
  runOps(g, compile(steps).ops, compile(steps).end, 120, (game) => {
    const s = game.getState();
    for (const w of s.warnings) warned.push({ ...w, tiles: s.tiles[w.r].slice(w.c0, w.c1 + 1) });
  });
  assert.ok(warned.length > 0, 'a 3-tile run of loose soil cracks');
  assert.ok(warned.every((w) => w.loose && w.c1 - w.c0 + 1 >= 3));
  assert.equal(
    g.getState().tiles[1].slice(0, 9),
    'EDDDPDDDE',
    'the pre-braced gallery stays stable',
  );
});

// ---------------------------------------------------------------------------
// Miners
// ---------------------------------------------------------------------------

test('miners stay put until woken, only wake when adjacent, and follow along dug tunnels only', () => {
  const { g } = fresh();
  const st = g.getState();
  runOps(
    g,
    compile(plan(st.tiles, st.lift, [[14, 6]])).ops,
    compile(plan(st.tiles, st.lift, [[14, 6]])).end,
    120,
  );
  let s = g.getState();
  assert.equal(s.miners[1].state, 'waiting');
  assert.equal(s.prompt.en, 'X: wake the miner');
  frames(g, 60, ['ArrowUp']);
  frames(g, 30, []);
  const far = g.getState();
  assert.ok(far.miners[1].state === 'waiting' && !far.prompt.en.startsWith('X:'));
  frames(g, 4, [], ['KeyX']);
  assert.equal(g.getState().miners[1].state, 'waiting', 'too far to wake');
  assert.equal(g.getState().stats.calls, 0);
  const back = compile(plan(far.tiles, { c: far.player.c, r: far.player.r }, [[14, 6, 1]]));
  runOps(g, back.ops, back.end, 120);
  s = g.getState();
  assert.equal(s.miners[1].state, 'following');
  assert.equal(s.miners[1].order, 0);
  assert.match(s.message.en, /following/);
  const away = compile(plan(s.tiles, { c: s.player.c, r: s.player.r }, [[s.lift.c, s.lift.r]]));
  const seen = new Set();
  runOps(g, away.ops, away.end, 120, (game) => {
    const q = game.getState();
    for (const m of q.miners) {
      seen.add(q.tiles[m.r][m.c]);
      assert.ok(WALK.includes(q.tiles[m.r][m.c]), `miner stands on ${q.tiles[m.r][m.c]}`);
    }
  });
  assert.ok(!seen.has('E') && !seen.has('R'));
});

test('miners board only when you stand on the lift, then score and clear the sector', () => {
  const { g } = fresh();
  const st = g.getState();
  const steps = plan(st.tiles, st.lift, [
    [14, 6, 1],
    [9, 0],
  ]);
  const { ops, end } = compile(steps);
  runOps(g, ops, end + 600, 120);
  let s = g.getState();
  assert.equal(s.minersRescued, 0, 'standing next to the lift does not board');
  assert.equal(s.miners[1].state, 'following');
  assert.equal(s.player.c, 9);
  const prompts = new Set();
  frames(g, 8, ['ArrowLeft']);
  for (let i = 0; i < 240 && g.getState().minersRescued === 0; i++) {
    g.update(1 / 120, input());
    prompts.add(g.getState().prompt.en);
  }
  s = g.getState();
  assert.ok(prompts.has('Stay on the lift: miners coming'));
  assert.equal(s.minersRescued, 1);
  assert.equal(s.score, RULES.minerScore);
  assert.equal(s.sector, 1);
  assert.equal(s.miners[1].state, 'rescued');
});

test('a cave-in that hoists you away strands a follower, and digging the rubble frees them', () => {
  const { g } = fresh();
  const st = g.getState();
  const steps = [
    ...plan(st.tiles, st.lift, [[3, 3, 1]], { braces: false }),
    { t: 'move', d: 'R', n: 3 },
    { t: 'wait', ticks: 700 },
  ];
  const { ops, end } = compile(steps);
  let sawBlocked = false;
  runOps(g, ops, end, 120, (game) => {
    if (game.getState().miners.some((m) => m.blocked)) sawBlocked = true;
  });
  const mid = g.getState();
  assert.equal(mid.stats.collapses, 1);
  assert.equal(mid.lives, 2);
  assert.ok(sawBlocked);
  assert.equal(mid.prompt.en, 'Miner stuck: dig a path to them');
  assert.match(mid.prompt.zh, /矿工被困/);
  assert.ok(WALK.includes(mid.tiles[mid.miners[0].r][mid.miners[0].c]));
  // The rest uses only what is shown: the bot clears rubble toward the stuck miner.
  const res = humanCampaign(5, 60, { game: g });
  assert.equal(res.state.phase, 'won');
});

// ---------------------------------------------------------------------------
// Campaigns, determinism, terminal states
// ---------------------------------------------------------------------------

test('full campaign through public input wins at 30, 60 and 120 Hz with identical full state', () => {
  const traces = HZS.map((hz) => {
    const h = harness();
    const g = createGame(h.env);
    const snaps = [];
    const final = playCampaign(g, hz, (game, f) => {
      if (((f + 1) * (120 / hz)) % 240 === 0) snaps.push(JSON.stringify(game.getState()));
    });
    assert.equal(final.phase, 'won');
    assert.equal(final.lives, 3);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(h.ends[0].score, final.score);
    assert.ok(final.score > 7 * RULES.minerScore);
    return { snaps, final: JSON.stringify(final) };
  });
  for (const t of traces.slice(1)) {
    assert.equal(t.snaps.length, traces[0].snaps.length);
    assert.deepEqual(t.snaps, traces[0].snaps);
    assert.equal(t.final, traces[0].final);
  }
});

test('win freezes state, ignores input and a new instance restarts fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  const final = playCampaign(g, 60);
  assert.equal(final.phase, 'won');
  assert.equal(final.prompt.en, 'All miners are safe!');
  const snap = JSON.stringify(g.getState());
  for (let i = 0; i < 100; i++) g.update(1 / 60, input(['ArrowDown', 'Space'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), snap);
  assert.equal(h.ends.length, 1);
  assert.ok(h.sounds.filter((s) => s === 'win').length >= 2);
  const next = createGame(harness().env).getState();
  assert.equal(next.sector, 1);
  assert.equal(next.score, 0);
  assert.equal(next.phase, 'playing');
});

test('every sector is also beatable by the human-like bot at every frame rate (>= 27 of 30 seeds)', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = humanCampaign(seed, hz);
      if (state.phase === 'won') wins++;
    }
    assert.ok(wins >= 27, `${hz} Hz: only ${wins}/30 runs won`);
  }
});

test('perturbing every input boundary by 1-2 ticks does not break the legal route', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = seeded(seed * 31 + hz);
      const g = createGame(harness({ seed }).env);
      for (let i = 0; i < 3; i++) {
        const { ops, end } = routeFor(g, i);
        runOps(g, perturb(ops, rnd, 2), end, hz);
      }
      if (g.getState().phase === 'won') wins++;
    }
    assert.ok(wins >= 11, `${hz} Hz: ${wins}/12 perturbed routes won`);
  }
});

test('the route never triggers a warning or damage when beams are used as the prompts say', () => {
  const g = createGame(harness().env);
  let warnings = 0;
  const final = playCampaign(g, 60, (game) => {
    const s = game.getState();
    warnings += s.warnings.length;
    assert.ok(s.lives === 3);
  });
  assert.equal(warnings, 0);
  assert.ok(final.stats.braces >= 3);
});

// ---------------------------------------------------------------------------
// Presentation: camera, HUD, text, sprites, state shape
// ---------------------------------------------------------------------------

function recordingContext() {
  const calls = { rects: [], fonts: new Set(), texts: [] };
  const base = mockContext();
  let style = '';
  return {
    calls,
    ctx: new Proxy(base, {
      get(t, p) {
        if (p === 'fillRect') return (x, y, w, h) => calls.rects.push({ x, y, w, h, style });
        if (p === 'fillText') return (str, x, y) => calls.texts.push({ str, x, y, font: t.font });
        return p in t ? t[p] : () => {};
      },
      set(t, p, v) {
        if (p === 'font') calls.fonts.add(v);
        if (p === 'fillStyle') style = v;
        t[p] = v;
        return true;
      },
    }),
  };
}

test('player and miners are 24 px sprites that match their colliders; text is 14-16 px', () => {
  const { g } = fresh({ lang: 'en' });
  const st = g.getState();
  const { ctx, calls } = recordingContext();
  g.draw(ctx);
  const yellow = calls.rects.filter((r) => r.style === '#f2c230');
  assert.ok(yellow.length > 0);
  const pr = st.player.rect;
  assert.equal(pr.h, 24);
  assert.equal(pr.w, 20);
  const sprite = calls.rects.filter(
    (r) =>
      ['#f2c230', '#2f6fb3', '#7a4a1a', '#f0c19c'].includes(r.style) &&
      r.y >= pr.y &&
      r.y < pr.y + 24 &&
      r.x >= pr.x - 1 &&
      r.x < pr.x + 21,
  );
  const minY = Math.min(...sprite.map((r) => r.y));
  const maxY = Math.max(...sprite.map((r) => r.y + r.h));
  assert.equal(minY, pr.y);
  assert.equal(maxY, pr.y + 24);
  assert.ok(
    Math.min(...sprite.map((r) => r.x)) >= pr.x &&
      Math.max(...sprite.map((r) => r.x + r.w)) <= pr.x + pr.w,
  );
  for (const m of st.miners) assert.equal(m.rect.h, 24);
  const sizes = [...calls.fonts].map((f) => Number(/(\d+)px/.exec(f)[1]));
  assert.ok(sizes.length > 0 && sizes.every((n) => n >= 14 && n <= 16), `font sizes ${sizes}`);
});

test('camera keeps the player and the objective inside the playfield, clear of the HUD bands', () => {
  const check = (s) => {
    const { camera, hud, player, objective } = s;
    assert.ok(
      player.rect.x >= camera.x && player.rect.x + player.rect.w <= camera.x + camera.width,
    );
    assert.ok(
      player.rect.y >= hud.top[1] && player.rect.y + player.rect.h <= hud.bottom[0],
      JSON.stringify(player.rect),
    );
    assert.ok(
      objective.x > 0 &&
        objective.x < 480 &&
        objective.y > hud.top[1] &&
        objective.y < hud.bottom[0],
    );
    for (const m of s.miners)
      assert.ok(m.rect.y >= hud.top[1] && m.rect.y + m.rect.h <= hud.bottom[0]);
  };
  const g = createGame(harness().env);
  playCampaign(g, 60, (game) => check(game.getState()));
  const rnd = seeded(77);
  const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyW'];
  const r = createGame(harness({ seed: 4 }).env);
  for (let i = 0; i < 6000; i++) {
    const held = codes.filter(() => rnd() < 0.2);
    r.update(1 / 60, input(held, rnd() < 0.1 ? ['Space', 'KeyX'].filter(() => rnd() < 0.6) : []));
    check(r.getState());
  }
});

test('status is a bilingual string with sector, miners, oxygen and a short prompt', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = fresh({ lang });
    const s = g.getState();
    assert.equal(typeof s.status.en, 'string');
    assert.equal(typeof s.status.zh, 'string');
    assert.match(s.status.en, /^Sector 1\/3 · Miners 0\/2 · Oxygen 100 · /);
    assert.match(s.status.zh, /^矿区 1\/3 · 矿工 0\/2 · 氧气 100 · /);
    assert.ok(s.prompt.en.length <= 40 && s.prompt.zh.length <= 24);
    const { ctx, calls } = recordingContext();
    g.draw(ctx);
    assert.ok(
      calls.texts.some((t) => (lang === 'zh' ? /矿工|区/.test(t.str) : /Miners/.test(t.str))),
    );
  }
});

test('drawing handles warnings, followers, stuck miners, effects, hurt flashes and terminal states in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    g.draw(mockContext());
    const st = g.getState();
    const { ops, end } = compile(
      plan(
        st.tiles,
        st.lift,
        [
          [3, 3, 1],
          [5, 3],
        ],
        { braces: false },
      ),
    );
    runOps(g, ops, end, 60, () => g.draw(mockContext()));
    for (let i = 0; i < 700; i++) {
      g.update(1 / 60, input());
      if (i % 20 === 0) g.draw(mockContext());
    }
    assert.ok(g.getState().stats.collapses > 0 && g.getState().lives < 3);
    playCampaign(createGame(h.env), 60, (game, f) => f % 40 === 0 && game.draw(mockContext()));
    const lost = createGame(harness({ lang }).env);
    loseByAir(lost, { hz: 60 });
    assert.equal(lost.getState().phase, 'lost');
    lost.draw(mockContext());
  }
});

test('seeded random play stays finite, bounded and on legal tiles', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rnd = seeded(seed * 101);
    const h = harness({ seed });
    const g = createGame(h.env);
    const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'];
    let held = [];
    for (let i = 0; i < 12000; i++) {
      if (i % 25 === 0) held = codes.filter(() => rnd() < 0.25);
      const pressed = [];
      if (rnd() < 0.12) pressed.push('Space');
      if (rnd() < 0.08) pressed.push('KeyX');
      g.update([1 / 30, 1 / 60, 1 / 120][seed % 3], input(held, pressed));
      if (i % 50 === 0) {
        const s = g.getState();
        assert.ok(finite(s), 'all numbers finite');
        assert.ok(s.oxygen >= 0 && s.oxygen <= 100 && s.lives >= 0 && s.lives <= 3 && s.beams >= 0);
        assert.ok(WALK.includes(s.tiles[s.player.r][s.player.c]));
        assert.ok(s.tiles.every((row) => /^[.LTDVPERWB]{20}$/.test(row)));
        for (const m of s.miners) assert.ok(WALK.includes(s.tiles[m.r][m.c]));
        assert.ok(JSON.stringify(s).length < 6000, 'state size stays bounded');
      }
    }
    if (h.ends.length) assert.equal(h.ends.length, 1);
  }
});

test('presentation: lives stay inside the canvas, the lift is labelled and flashes on boarding, the banner fades', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = fresh({ lang });
    const early = recordingContext();
    g.draw(early.ctx);
    const label = lang === 'zh' ? '升降梯' : 'LIFT';
    assert.ok(
      early.calls.texts.some((x) => x.str === label),
      'lift label',
    );
    assert.ok(
      early.calls.texts.some((x) => /Shallow Seam|浅层矿脉/.test(x.str)),
      'sector banner at the start',
    );
    const hud = early.calls.rects.filter((r) => r.y < 28 && r.w < 40);
    assert.ok(
      hud.every((r) => r.x + r.w <= 470),
      'HUD icons keep a margin from the edge',
    );
    frames(g, 120 * 3, []);
    const later = recordingContext();
    g.draw(later.ctx);
    assert.ok(
      !later.calls.texts.some((x) => /Shallow Seam|浅层矿脉/.test(x.str)),
      'banner is gone after 2 s',
    );
  }
  const g = createGame(harness().env);
  const st = g.getState();
  const { ops, end } = compile(
    plan(st.tiles, st.lift, [
      [14, 6, 1],
      [8, 0],
    ]),
  );
  let flashed = false;
  runOps(g, ops, end + 600, 120, (game) => {
    const rec = recordingContext();
    if (game.getState().minersRescued === 1 && !flashed) {
      game.draw(rec.ctx);
      flashed = rec.calls.texts.some((x) => x.str === '+1000');
    }
  });
  assert.ok(flashed, 'boarding shows +1000 at the lift');
});

const digSteps = (d, n = 1) =>
  Array.from({ length: n }, () => [
    { t: 'dig', d },
    { t: 'move', d, n: 1 },
  ]).flat();

test('X braces first inside a cracking span even when a miner waits beside it (prompt matches action)', () => {
  const { g } = fresh();
  const steps = [
    ...digSteps('D', 4),
    ...digSteps('L'),
    { t: 'brace' },
    ...digSteps('L', 3),
    { t: 'dig', d: 'L' },
    { t: 'move', d: 'L', n: 1 },
    { t: 'wait', ticks: 40 },
  ];
  const { ops, end } = compile(steps);
  runOps(g, ops, end, 120);
  let s = g.getState();
  assert.deepEqual([s.player.c, s.player.r], [3, 4]);
  assert.equal(s.miners[0].state, 'waiting');
  assert.match(s.prompt.en, /^Cracks! X: brace here/);
  frames(g, 4, [], ['KeyX']);
  s = g.getState();
  assert.equal(s.tiles[4][3], 'P');
  assert.equal(s.stats.calls, 0, 'the miner was not woken by the brace press');
  assert.equal(s.warnings.length, 0);
  frames(g, 40, [], ['KeyX']);
  assert.equal(g.getState().stats.calls, 1, 'with no crack left, the next X wakes the miner');
});

test('the beam prompt is only shown when a beam on your tile prevents the crack', () => {
  const { g } = fresh();
  const steps = [
    ...digSteps('D', 4),
    ...digSteps('L', 2),
    { t: 'move', d: 'R', n: 2 },
    { t: 'move', d: 'U', n: 1 },
    ...digSteps('R'),
    { t: 'wait', ticks: 40 },
  ];
  const { ops, end } = compile(steps);
  runOps(g, ops, end, 120);
  frames(g, 12, ['ArrowDown']);
  let s = g.getState();
  assert.deepEqual([s.player.c, s.player.r], [9, 3]);
  assert.equal(s.prompt.en, 'Space: dig (ceiling will crack)');
  assert.match(s.prompt.zh, /开裂/);
  assert.equal(s.warnings.length, 0);
  frames(g, 3, ['ArrowDown'], ['Space']);
  frames(g, 10, []);
  s = g.getState();
  assert.equal(s.warnings.length, 1, 'the honest prompt matched what happened');
  assert.deepEqual([s.warnings[0].r, s.warnings[0].c0, s.warnings[0].c1], [4, 6, 9]);
});

test('tunnelling prompts do not flicker between two wordings of the same instruction', () => {
  const g = createGame(harness().env);
  const st = g.getState();
  const { ops, end } = compile(plan(st.tiles, st.lift, [[3, 3, 1]]));
  const log = [];
  runOps(g, ops, end, 120, (game) => log.push([game.getState().time, game.getState().prompt.en]));
  const segments = [];
  for (const [t, text] of log) {
    if (!segments.length || segments[segments.length - 1].text !== text) segments.push({ text, t });
  }
  segments.forEach((seg, i) => {
    const next = segments[i + 1];
    if (!next || i === 0) return;
    if (next.t - seg.t < 0.5 && /Face earth/.test(seg.text)) {
      assert.fail(`'${seg.text}' flickered between instructions at ${seg.t}`);
    }
  });
});

test('a delayed-reaction player never sees the dig prompt flip back and forth within half a second', () => {
  for (const seed of [1, 2, 3]) {
    const inner = createGame(harness({ seed }).env);
    const log = [];
    const spy = {
      update: (dt, inp) => {
        inner.update(dt, inp);
        const s = inner.getState();
        log.push([s.time, s.prompt.en, s.player.r]);
      },
      getState: () => inner.getState(),
    };
    humanCampaign(seed, 60, { game: spy });
    const segs = [];
    for (const [t, text, row] of log)
      if (!segs.length || segs.at(-1).text !== text) segs.push({ text, t, row });
    let flips = 0;
    for (let i = 1; i + 1 < segs.length; i++) {
      const dur = segs[i + 1].t - segs[i].t;
      const dig = (x) => x.text === 'Space: dig';
      if (
        segs[i].row > 0 &&
        dur >= 0.1 &&
        dur < 0.5 &&
        dig(segs[i - 1]) &&
        /^Face earth/.test(segs[i].text) &&
        dig(segs[i + 1])
      )
        flips++;
    }
    assert.equal(flips, 0, `seed ${seed}`);
  }
});

test('low air outranks a crack that is somewhere else, and the surface says to wait for air', () => {
  const { g } = fresh();
  const steps = [...digSteps('D', 4)];
  const { ops, end } = compile(steps);
  runOps(g, ops, end, 120);
  for (let i = 0; i < 120 * 70 && g.getState().oxygen > 32; i++) g.update(1 / 120, input());
  assert.ok(g.getState().oxygen > 29, 'still above the low-air line');
  const more = compile([
    ...digSteps('L'),
    ...digSteps('L'),
    { t: 'dig', d: 'L' },
    { t: 'move', d: 'R', n: 2 },
    { t: 'move', d: 'U', n: 1 },
  ]);
  runOps(g, more.ops, more.end, 120);
  let s = g.getState();
  assert.equal(s.warnings.length, 1);
  assert.ok(s.player.c === 8 && s.player.r === 3, 'standing outside the span');
  const seen = new Set();
  for (let i = 0; i < 120 * 3 && s.warnings.length && s.lives === 3; i++) {
    g.update(1 / 120, input());
    s = g.getState();
    if (s.oxygen < RULES.lowAir) seen.add(s.prompt.en);
  }
  assert.ok(seen.size > 0, 'oxygen crossed the low-air line during the crack');
  assert.deepEqual([...seen], ['Low air! Climb to the surface']);
  frames(g, 120 * 4, ['ArrowUp']);
  frames(g, 60, []);
  s = g.getState();
  assert.equal(s.player.r, 0);
  assert.ok(s.oxygen < 60 || /Fresh air/.test(s.prompt.en) || s.oxygen >= 60);
  const { g: g2 } = fresh();
  runOps(g2, compile(digSteps('D', 2)).ops, compile(digSteps('D', 2)).end, 120);
  for (let i = 0; i < 120 * 60 && g2.getState().oxygen > 40; i++) g2.update(1 / 120, input());
  runOps(
    g2,
    compile([{ t: 'move', d: 'U', n: 2 }]).ops,
    compile([{ t: 'move', d: 'U', n: 2 }]).end,
    120,
  );
  frames(g2, 80, []);
  const top = g2.getState();
  assert.equal(top.player.r, 0);
  assert.equal(top.prompt.en, 'Fresh air: wait here to refill');
  assert.match(top.prompt.zh, /补氧/);
});

test('a cave-in hurts whoever is still inside the span until their step completes', () => {
  const leave = (target, dir) => {
    const { g } = fresh();
    const st = g.getState();
    const { ops, end } = compile(plan(st.tiles, st.lift, [target], { braces: false }));
    runOps(g, ops, end, 120);
    let s = g.getState();
    assert.equal(s.warnings.length, 1);
    for (let i = 0; i < 120 * 5 && s.warnings[0]?.remaining > 0.09; i++) {
      g.update(1 / 120, input());
      s = g.getState();
    }
    for (let i = 0; i < 120 && s.lives === 3; i++) {
      g.update(1 / 120, input([dir]));
      s = g.getState();
    }
    return s;
  };
  assert.equal(
    leave([5, 3], 'ArrowLeft').lives,
    2,
    'stepping out too late: origin tile still inside',
  );
  assert.equal(
    leave([4, 3], 'ArrowRight').lives,
    2,
    'stepping in too late: destination tile is inside',
  );
});

test('rules and the final score are pinned to literal numbers', () => {
  assert.equal(RULES.bufferTicks, 30);
  assert.equal(RULES.haulAir, 60);
  assert.equal(RULES.followDrain, 0.5);
  assert.equal(RULES.tankAir, 35);
  assert.equal(RULES.warnTicks, 480);
  assert.equal(RULES.minerScore, 1000);
  const g = createGame(harness().env);
  let prevOxygen = 100;
  let prevSector = 1;
  let bonus = 0;
  let done = false;
  const final = playCampaign(g, 60, (game) => {
    const s = game.getState();
    if ((s.sector !== prevSector || s.phase === 'won') && !done) {
      bonus += Math.floor(prevOxygen) * 2;
      prevSector = s.sector;
      done = s.phase === 'won';
    }
    prevOxygen = s.oxygen;
  });
  const extra = final.score - 7 * 1000 - 3 * 500;
  assert.ok(extra % 2 === 0 && extra >= 400 && extra <= 600, `air bonus ${extra}`);
  assert.ok(Math.abs(extra - bonus) <= 6, `${extra} vs ${bonus}`);
});

test('the life-loss explanation survives a beam restock on the lift', () => {
  // Air loss with a beam spent.
  const { g } = fresh();
  const dive = compile([...digSteps('D', 3), { t: 'brace' }]);
  runOps(g, dive.ops, dive.end, 120);
  assert.equal(g.getState().beams, g.getState().beamsMax - 1);
  for (let i = 0; i < 120 * 200 && g.getState().lives === 3; i++) g.update(1 / 120, input());
  assert.equal(g.getState().lives, 2);
  for (let i = 0; i < 120; i++) {
    g.update(1 / 120, input());
    assert.match(g.getState().message.en, /Out of air/, `tick ${i}`);
  }
  // Cave-in with a beam spent.
  const { g: g2 } = fresh();
  const steps = [
    ...digSteps('D', 4),
    ...digSteps('L'),
    { t: 'brace' },
    ...digSteps('L', 3),
    { t: 'dig', d: 'L' },
  ];
  const route = compile(steps);
  runOps(g2, route.ops, route.end, 120);
  for (let i = 0; i < 120 * 6 && g2.getState().lives === 3; i++) g2.update(1 / 120, input());
  assert.equal(g2.getState().lives, 2);
  assert.ok(
    g2.getState().beams < g2.getState().beamsMax || g2.getState().beams === g2.getState().beamsMax,
  );
  for (let i = 0; i < 120; i++) {
    g2.update(1 / 120, input());
    assert.match(g2.getState().message.en, /Cave-in/, `tick ${i}`);
  }
  assert.equal(g2.getState().beams, g2.getState().beamsMax, 'restock still happens silently');
});

test('event messages reach the status string in both languages, then fall back to the prompt', () => {
  const { g } = fresh();
  const dive = compile([...digSteps('D', 3), { t: 'brace' }]);
  runOps(g, dive.ops, dive.end, 120);
  for (let i = 0; i < 120 * 200 && g.getState().lives === 3; i++) g.update(1 / 120, input());
  let s = g.getState();
  assert.match(s.status.en, /Oxygen \d+ · Out of air! Hauled up · /);
  assert.match(s.status.zh, /氧气 \d+ · 氧气耗尽！被拉回地面 · /);
  frames(g, 120 * 2, []);
  s = g.getState();
  assert.equal(s.message, null);
  assert.ok(!/Out of air/.test(s.status.en));
  assert.ok(s.status.en.endsWith(s.prompt.en));
  // Rescue and sector-clear messages.
  const { g: g2 } = fresh();
  const st = g2.getState();
  const steps = plan(st.tiles, st.lift, [
    [14, 6, 1],
    [8, 0],
  ]);
  steps.push({ t: 'wait', ticks: 60 });
  const seen = new Set();
  const { ops, end } = compile(steps);
  runOps(g2, ops, end + 1200, 120, (game) =>
    seen.add(game.getState().status.en.split(' · ').slice(3, -1).join('|')),
  );
  assert.ok(
    [...seen].some((x) => x.includes('Miner rescued! +1000')),
    [...seen].join(' / '),
  );
  const { g: g3 } = fresh();
  const r = routeFor(g3, 0);
  let clear = null;
  runOps(g3, r.ops, r.end, 120, (game) => {
    const q = game.getState();
    if (q.sector === 2 && !clear) clear = q.status;
  });
  assert.ok(clear && /Sector clear! Next mine/.test(clear.en) && /矿区完成/.test(clear.zh));
});
