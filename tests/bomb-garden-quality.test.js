import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, GARDEN_COUNT } from '../src/games/bomb-garden.js';
import { GARDENS, ROLES } from '../src/games/bomb-garden-gardens.js';
import { blastPlan } from '../src/games/bomb-garden-rules.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player here sees only what the screen shows through getState() and presses only
// public keys. The clever one also sees the screen a little late, like a person does.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const FAST = [0.15, 0.35]; // reaction delay in seconds
const SLOW = [0.4, 0.6];
const K = (x, y) => `${x},${y}`;
const MOVES = [
  [-1, 0, 'KeyA'],
  [1, 0, 'KeyD'],
  [0, -1, 'KeyW'],
  [0, 1, 'KeyS'],
];
const TOUCH_CODES = new Set(meta.touchControls.map((c) => c.code));
const lagFor = (seed, [lo, hi]) => lo + (hi - lo) * (((seed * 37) % 10) / 10);

/** A fresh game that behaves like the host: garden `level` is the highest one unlocked. */
function open(level = 1, { seed = 1, lang = 'en', mode = 1, progress = true } = {}) {
  const h = harness({ seed, lang, mode });
  const calls = [];
  if (progress) {
    let unlocked = level;
    h.env.progress = {
      unlocked: () => unlocked,
      unlock: (n) => {
        calls.push(n);
        unlocked = Math.max(unlocked, n);
      },
    };
  }
  const g = createGame(h.env);
  if (level > 1 && progress) g.update(1 / 60, input([], ['Space']));
  return { g, h, calls };
}

/** Rules every state must satisfy (the invariants the reviewer verified). */
function invariants(s, h, where) {
  const bad = [];
  const actors = [...s.players, ...s.enemies];
  for (const n of [s.score, s.time, s.elapsed, s.lives, s.level])
    if (!Number.isFinite(n)) bad.push('non-finite scalar');
  for (const a of actors) {
    if (![a.x, a.y, a.px, a.py].every(Number.isFinite)) bad.push(`actor ${a.id} is not finite`);
    if (!a.alive) continue;
    s.board.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell !== 0 && Math.abs(a.px - x) < 0.77 - 1e-6 && Math.abs(a.py - y) < 0.77 - 1e-6)
          bad.push(`actor ${a.id} overlaps solid ${cell} at ${x},${y}`);
      }),
    );
    for (const b of s.bombs) {
      if (!a.moving && b.x === a.x && b.y === a.y && !b.passIds.includes(a.id))
        bad.push(`actor ${a.id} stands inside a foreign bomb`);
      const near = Math.abs(a.px - b.x) < 0.77 - 1e-6 && Math.abs(a.py - b.y) < 0.77 - 1e-6;
      if (near && !b.passIds.includes(a.id) && a.id !== b.owner)
        bad.push(`actor ${a.id} penetrates bomb ${b.x},${b.y}`);
    }
  }
  const live = actors.filter((a) => a.alive);
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++)
      if (
        Math.abs(live[i].px - live[j].px) < 0.54 - 1e-6 &&
        Math.abs(live[i].py - live[j].py) < 0.54 - 1e-6
      )
        bad.push(`actors ${live[i].id} and ${live[j].id} overlap`);
  const perOwner = new Map();
  for (const b of s.bombs) if (!b.barrel) perOwner.set(b.owner, (perOwner.get(b.owner) ?? 0) + 1);
  for (const a of actors)
    if ((perOwner.get(a.id) ?? 0) > a.capacity) bad.push(`owner ${a.id} exceeds its bomb capacity`);
  if (new Set(s.bombs.map((b) => K(b.x, b.y))).size !== s.bombs.length)
    bad.push('two bombs share a cell');
  if (s.lives < 0 || s.lives > 3) bad.push(`lives ${s.lives}`);
  if (
    s.flames.length > 135 ||
    s.bombs.length > 135 ||
    s.fronts.length > 400 ||
    s.pickups.length > 135
  )
    bad.push('unbounded collections');
  if (s.flames.some((f) => s.board[f.y][f.x] === 1)) bad.push('flame inside a wall');
  if (s.pickups.some((p) => s.board[p.y][p.x] !== 0)) bad.push('pickup inside a solid');
  if (h.ends.length > 1) bad.push('more than one end');
  assert.deepEqual(bad, [], `${where}: ${bad.join('; ')}`);
}

// --- the clever player -------------------------------------------------------------------------
// Danger is a set of lethal time windows per cell. Windows come from the (late) picture of every
// bomb, the jets in flight, the active flames and the compost barrels they will set off, plus the
// player's own bombs. A search through (cell, time) finds safe walks and escapes.
const MARGIN = 0.05;
function lethalWindows(past, now, lag, hearts = 3) {
  const win = new Map();
  // A player who has just lost a heart gives every blast a wider berth.
  const pad = MARGIN + 0.4 * lag + 0.12 * (3 - hearts);
  const add = (x, y, from, to) => {
    if (!win.has(K(x, y))) win.set(K(x, y), []);
    win.get(K(x, y)).push([from - pad, to + pad]);
  };
  const board = past.board;
  const bombs = past.bombs.map((b) => ({ ...b, fuse: b.fuse - lag }));
  for (const b of now.bombs)
    if (b.owner === 0 && !b.barrel && !past.bombs.some((o) => o.id === b.id)) bombs.push({ ...b });
  const along = (f, visit) => {
    for (let n = 0; n < f.remaining; n++) {
      const x = f.x + f.dx * n,
        y = f.y + f.dy * n;
      if (board[y]?.[x] === undefined || board[y][x] === 1) return;
      visit(x, y, n);
      if (board[y][x] >= 2) return;
    }
  };
  for (const f of past.fronts)
    along(f, (x, y, n) => {
      for (const b of bombs)
        if (b.x === x && b.y === y) b.fuse = Math.min(b.fuse, 0.05 * (n + 1) - lag);
    });
  const live = bombs.filter((b) => b.fuse > -0.7);
  // Crates a jet can break stop shielding later jets: a safe over-estimate for chains.
  const open = board.map((row) => [...row]);
  for (const b of live)
    for (const [x, y] of blastPlan(board, b.x, b.y, b.range).cells)
      if (open[y][x] === 2) open[y][x] = 0;
  const plans = live.map((b) => ({ b, plan: blastPlan(open, b.x, b.y, b.range) }));
  for (let pass = 0; pass < 6; pass++)
    for (const a of plans)
      for (const c of plans) {
        const hit = [...a.plan.cells, ...a.plan.chained].some(
          ([x, y]) => x === c.b.x && y === c.b.y,
        );
        if (a !== c && hit) {
          const d = Math.abs(a.b.x - c.b.x) + Math.abs(a.b.y - c.b.y);
          c.b.fuse = Math.min(c.b.fuse, a.b.fuse + 0.05 * d + 0.05);
        }
      }
  const gone = new Map(plans.map(({ b }) => [K(b.x, b.y), b.fuse + 0.05]));
  for (const { b, plan } of plans) {
    for (const [x, y] of plan.cells) add(x, y, b.fuse - 0.1, b.fuse + 0.65);
    for (const [x, y] of plan.chained) add(x, y, b.fuse + 0.05, b.fuse + 0.95);
  }
  for (const f of past.flames) if (f.active) add(f.x, f.y, -1, f.life - lag + 0.15);
  for (const f of past.fronts)
    along(f, (x, y, n) => {
      add(x, y, -1, 0.7 - lag + 0.05 * n);
      if (board[y][x] === 3) {
        const plan = blastPlan(board, x, y, 2);
        for (const [bx, by] of [...plan.cells, ...plan.chained])
          add(bx, by, 0.05 * n - lag, 1.2 - lag + 0.05 * n);
      }
    });
  return { win, gone };
}
const isClear = (win, k, from, to) => (win.get(k) ?? []).every(([a, b]) => to < a || from > b);

/** Breadth-first search through (cell, steps). Returns the first key to press, 'stay' or null. */
function search(ctx, from, goal, { maxSteps, noWait = false, prefer = null, extra = 3 }) {
  const { win, blocked, speed, latency, board } = ctx;
  const queue = [{ x: from.x, y: from.y, n: 0, first: null }];
  const seen = new Set([`${K(from.x, from.y)}@0`]);
  const push = (p) => {
    const id = `${K(p.x, p.y)}@${p.n}`;
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(p);
    }
  };
  let best = null;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i],
      T = latency + p.n * speed;
    if (p.n > 0 && goal(p) && isClear(win, K(p.x, p.y), T - 0.8 * speed, 99)) {
      if (!prefer) return p.first;
      // Look a few steps further for a roomier place to stand, then take the best one.
      best ??= { n: p.n, pick: null, value: -Infinity };
      const value = prefer(p) - 0.3 * p.n;
      if (value > best.value) best = { ...best, pick: p.first, value };
    }
    if (best && p.n > best.n + extra) break;
    if (p.n >= maxSteps) continue;
    if (!noWait && isClear(win, K(p.x, p.y), T, T + speed))
      push({ x: p.x, y: p.y, n: p.n + 1, first: p.first ?? 'stay' });
    if (!isClear(win, K(p.x, p.y), T, T + 0.78 * speed)) continue;
    for (const [dx, dy, code] of MOVES) {
      const x = p.x + dx,
        y = p.y + dy;
      if (board[y]?.[x] !== 0 || (blocked.get(K(x, y)) ?? -1) > T + speed) continue;
      if (isClear(win, K(x, y), T + 0.2 * speed, T + speed))
        push({ x, y, n: p.n + 1, first: p.first ?? code });
    }
  }
  return best ? best.pick : null;
}

/** Could `rival` still leave `cells` if it only starts running a moment before the blast? */
function isTrapped(rival, cells, bomb, board, bombs) {
  const inside = new Set(cells.map(([x, y]) => K(x, y)));
  if (!inside.has(K(rival.x, rival.y))) return false;
  // It notices a blast `caution` s ahead, needs `react` s to start, then runs one cell per `speed`.
  const role = ROLES[rival.role],
    steps = Math.floor((role.caution - role.react) / role.speed),
    queue = [[rival.x, rival.y, 0]],
    seen = new Set([K(rival.x, rival.y)]);
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy, n] = queue[i];
    if (!inside.has(K(cx, cy))) return false;
    if (n >= steps) continue;
    for (const [dx, dy] of MOVES) {
      const x = cx + dx,
        y = cy + dy;
      const blocked = board[y]?.[x] !== 0 || seen.has(K(x, y)) || (x === bomb.x && y === bomb.y);
      if (blocked || bombs.some((b) => b.x === x && b.y === y)) continue;
      seen.add(K(x, y));
      queue.push([x, y, n + 1]);
    }
  }
  return true;
}

function makeBot({ lag = 0, hz = 60 }) {
  const history = [];
  // Bombs thrown at a rival that merely dodged teach the player to go and open the field instead.
  let futile = 0,
    rivalsSeen = Infinity;
  return function decide(now, t) {
    history.push({ t, s: now });
    while (history.length > 1 && history[1].t <= t - lag) history.shift();
    const past = history[0].s,
      p = now.players[0];
    if (!p.alive || p.moving || now.respawn > 0 || now.transition > 0 || now.menu) return [];
    const { win, gone } = lethalWindows(past, now, t - history[0].t, now.lives),
      board = past.board,
      blocked = new Map();
    // A bomb stops being an obstacle once it has gone off; a rival is one for as long as we plan.
    for (const [cell, until] of gone) blocked.set(cell, until);
    blocked.delete(K(p.x, p.y));
    for (const e of [...past.enemies, ...now.enemies])
      if (e.alive) {
        blocked.set(K(e.x, e.y), Infinity);
        if (e.moving) blocked.set(K(e.moving.x, e.moving.y), Infinity);
      }
    // A person re-decides once per frame, so a stride really costs a whole number of frames.
    const stride = Math.ceil(p.speed * hz - 1e-9) / hz;
    const ctx = { win, blocked, speed: stride, latency: 1 / hz + 0.04, board };
    const pick = (code) => (code && code !== 'stay' ? [code] : []);
    const exits = (x, y) => MOVES.filter(([dx, dy]) => board[y + dy]?.[x + dx] === 0).length;
    const rivals = [...past.enemies, ...now.enemies].filter((e) => e.alive);
    // Roomy cells far from rivals are better places to stand than pockets a rival could seal.
    const roomy = (n) =>
      exits(n.x, n.y) +
      0.3 * Math.min(8, ...rivals.map((e) => Math.abs(e.x - n.x) + Math.abs(e.y - n.y)));
    if (!isClear(win, K(p.x, p.y), 0, 3.4))
      return pick(search(ctx, p, () => true, { maxSteps: 26, prefer: roomy }));
    const pickups = past.pickups.filter((q) => q.protectedUntil < past.elapsed);
    if (pickups.length) {
      const code = search(ctx, p, (n) => pickups.some((q) => q.x === n.x && q.y === n.y), {
        maxSteps: 30,
      });
      if (code) return pick(code);
    }
    const mine = now.bombs.filter((b) => b.owner === 0 && !b.barrel).length,
      foes = past.enemies.filter((e) => e.alive),
      cratesLeft = board.flat().some((c) => c === 2),
      wet = new Set(now.wetCells.map(([x, y]) => K(x, y))),
      memo = new Map();
    // Would a bomb at x,y do something useful, and is there a walk away that beats its fuse?
    const worthPlanting = (x, y, mode) => {
      const plan = blastPlan(board, x, y, p.range),
        cells = [...plan.cells, ...plan.chained],
        bomb = { x, y },
        caught = foes.filter((e) => isTrapped(e, cells, bomb, board, past.bombs)),
        kill = caught.length > 0;
      const hits = foes.some((e) => cells.some(([a, b]) => e.x === a && e.y === b));
      const crate = plan.cells.some(([a, b]) => board[b][a] >= 2);
      const chase = hits && (futile < 2 || !cratesLeft);
      if (mode === 'kill' ? !kill : !(kill || crate || chase)) return false;
      const fuse = wet.has(K(x, y)) ? 3 : 2.4,
        windows = new Map([...win].map(([k, v]) => [k, [...v]]));
      for (const [a, b] of cells) {
        if (!windows.has(K(a, b))) windows.set(K(a, b), []);
        windows.get(K(a, b)).push([fuse - 0.15, fuse + 1]);
      }
      const wide = new Map(blocked),
        reach = 2 + Math.floor(lag / 0.45); // rivals keep moving while the picture is late
      // A rival that cannot leave the blast cannot cut the walk away either.
      for (const e of foes.filter((f) => !caught.includes(f)))
        for (let dx = -reach; dx <= reach; dx++)
          for (let dy = -reach; dy <= reach; dy++)
            if (Math.abs(dx) + Math.abs(dy) <= reach) wide.set(K(e.x + dx, e.y + dy), Infinity);
      wide.delete(K(x, y));
      const way = search(
        { ...ctx, win: windows, blocked: wide },
        { x, y },
        (n) => (n.x !== x || n.y !== y) && ctx.latency + n.n * ctx.speed < fuse - 0.1,
        { maxSteps: 14, noWait: true, prefer: roomy, extra: 2 },
      );
      return Boolean(way) && way !== 'stay';
    };
    const can = (mode) => (x, y) => {
      const id = mode + K(x, y);
      if (!memo.has(id)) memo.set(id, worthPlanting(x, y, mode));
      return memo.get(id);
    };
    const standingInFlame = now.flames.some((f) => f.active && f.x === p.x && f.y === p.y);
    if (foes.length < rivalsSeen) futile = 0;
    rivalsSeen = foes.length;
    if (mine < p.capacity && !standingInFlame && can('any')(p.x, p.y)) {
      const plan = blastPlan(board, p.x, p.y, p.range);
      if (!plan.cells.some(([a, b]) => board[b][a] >= 2)) futile++;
      return ['Space'];
    }
    // Never wait in a dead end: a rival's bomb at the mouth would seal it.
    const unpocket = () =>
      exits(p.x, p.y) > 1 ? [] : pick(search(ctx, p, (n) => exits(n.x, n.y) > 1, { maxSteps: 10 }));
    if (mine > 0 && mine >= p.capacity) return unpocket();
    let code = search(ctx, p, (n) => can('kill')(n.x, n.y), { maxSteps: 16 });
    code ||= search(ctx, p, (n) => can('any')(n.x, n.y), { maxSteps: 40 });
    if (!code && foes.length) {
      const near = (e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      const target = foes.reduce((a, b) => (near(a) <= near(b) ? a : b));
      code = search(ctx, p, (n) => Math.abs(n.x - target.x) + Math.abs(n.y - target.y) <= 2, {
        maxSteps: 40,
      });
    }
    return code ? pick(code) : unpocket();
  };
}

/** Run a policy on one garden until it is cleared, the run ends or `seconds` pass. */
function play({ level = 1, seed = 1, hz = 60, lag = 0, lang = 'en', policy, seconds, every = 5 }) {
  const { g, h, calls } = open(level, { seed, lang });
  const decide = policy ?? makeBot({ lag, hz });
  const limit = seconds ?? GARDENS[level - 1].time * 2.2;
  const used = new Set();
  let hearts = 3,
    lost = 0,
    before = null,
    s = g.getState();
  for (let f = 0, t = 0; t < limit; f++, t += 1 / hz) {
    s = g.getState();
    if (s.phase !== 'playing' || s.level !== level) break;
    if (s.lives < hearts) {
      lost += hearts - s.lives;
      hearts = s.lives;
    }
    if (f % every === 0) invariants(s, h, `garden ${level} seed ${seed} ${hz}Hz t=${t.toFixed(1)}`);
    if (f % Math.round(hz * 0.7) === 0) g.draw(mockContext());
    // Upgrades are only ever taken by the gardener, standing on them.
    // A lost heart restarts the garden and lays its upgrades afresh, so compare only while alive.
    const comparable = before?.players[0].alive && s.players[0].alive;
    for (const q of comparable ? before.pickups : [])
      if (!s.pickups.some((o) => o.x === q.x && o.y === q.y)) {
        const me = s.players[0];
        assert.ok(
          (me.x === q.x && me.y === q.y) ||
            (before.players[0].x === q.x && before.players[0].y === q.y),
          `an upgrade at ${q.x},${q.y} vanished while the gardener was elsewhere (garden ${level})`,
        );
      }
    before = s;
    const keys = decide(s, t);
    keys.forEach((k) => used.add(k));
    g.update(
      1 / hz,
      input(
        keys,
        keys.filter((k) => k === 'Space'),
      ),
    );
  }
  s = g.getState();
  return { g, h, calls, s, used, lost, cleared: s.level > level || s.phase === 'won' };
}

// ---------------------------------------------------------------------------------------------
// Legal clears
// ---------------------------------------------------------------------------------------------
/** Runs a garden once per seed at one frame rate; a cell counts when at least two of three seeds clear. */
function clearCell(level, hz, lagRange) {
  const runs = [1, 2, 3].map((seed) =>
    play({ level, hz, seed, lag: lagRange ? lagFor(seed, lagRange) : 0 }),
  );
  const cleared = runs.filter((r) => r.cleared);
  assert.ok(
    cleared.length >= 2,
    `garden ${level} ${hz}Hz: only ${cleared.length} of 3 runs cleared (${runs.map((r) => r.s.phase + '@' + r.s.elapsed.toFixed(0)).join(', ')})`,
  );
  return { runs, cleared };
}

for (const [i, garden] of GARDENS.entries()) {
  const level = i + 1;
  test(`garden ${level} ${garden.name.en}: a scripted legal player clears it at 30, 60 and 120 Hz`, () => {
    for (const hz of HZS) {
      const { cleared } = clearCell(level, hz, null);
      for (const r of cleared) {
        assert.equal(r.h.ends.filter((e) => !e.won).length, 0, 'a cleared garden is not a loss');
        assert.deepEqual(
          r.calls,
          [Math.min(GARDEN_COUNT, level + 1)],
          'unlocks the next garden once',
        );
        for (const key of r.used) assert.ok(TOUCH_CODES.has(key), `${key} is not on the touch pad`);
      }
    }
  });
  test(`garden ${level} ${garden.name.en}: a reaction-limited player (0.15-0.35 s late) clears it at 30, 60 and 120 Hz`, (t) => {
    for (const hz of HZS) {
      const { runs } = clearCell(level, hz, FAST);
      t.diagnostic(
        `${hz}Hz hearts lost ${runs.map((r) => r.lost).join('/')} seconds ${runs.map((r) => r.s.elapsed.toFixed(0)).join('/')}`,
      );
    }
  });
}

test('slower reactions (0.4-0.6 s) still clear most runs at 60 Hz', (t) => {
  let cleared = 0,
    total = 0;
  const missed = [];
  for (let level = 1; level <= GARDEN_COUNT; level++)
    for (const seed of [1, 2]) {
      const r = play({ level, hz: 60, seed, lag: lagFor(seed, SLOW) });
      total++;
      if (r.cleared) cleared++;
      else missed.push(`${level}/${seed}`);
    }
  t.diagnostic(
    `slow-reaction runs cleared: ${cleared} of ${total}; missed ${missed.join(' ') || 'none'}`,
  );
  assert.ok(cleared / total >= 0.85, `${cleared} of ${total} slow-reaction runs cleared`);
});

/** One run from garden 1: hearts, score and upgrades carry on from garden to garden. */
function campaign(seed) {
  const { g, h, calls } = open(1, { seed });
  const decide = makeBot({ lag: 0.1, hz: 60 }),
    seen = new Set();
  let hearts = 3,
    refilled = false;
  for (let f = 0; f < 60 * 60 * 40 && g.getState().phase === 'playing'; f++) {
    const s = g.getState();
    seen.add(s.level);
    if (f % 6 === 0) invariants(s, h, `campaign ${seed} f=${f}`);
    refilled ||= s.lives > hearts;
    hearts = s.lives;
    const keys = decide(s, f / 60);
    g.update(
      1 / 60,
      input(
        keys,
        keys.filter((k) => k === 'Space'),
      ),
    );
  }
  return { g, h, calls, seen, refilled };
}

test('a continuous run from garden 1 to the last garden wins, carrying upgrades and refilling hearts', () => {
  const runs = [1, 2, 3].map(campaign);
  const won = runs.filter((r) => r.g.getState().phase === 'won');
  assert.ok(won.length >= 2, `${won.length} of 3 runs won`);
  const { g, h, calls, seen, refilled } = won[0],
    end = g.getState();
  assert.equal(seen.size, GARDEN_COUNT);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.match(h.ends[0].message, new RegExp(`All ${GARDEN_COUNT} gardens`));
  assert.deepEqual(
    calls.slice(0, GARDEN_COUNT - 1),
    Array.from({ length: GARDEN_COUNT - 1 }, (_, i) => i + 2),
  );
  assert.equal(
    calls.at(-1),
    GARDEN_COUNT,
    'the last clear unlocks no further than the last garden',
  );
  assert.ok(end.players[0].range >= 3, 'upgrades are collected along the way');
  assert.ok(end.score > 5000);
  assert.ok(runs.some((r) => r.refilled) || refilled || end.lives === 3);
  const frozen = g.getState();
  g.update(1 / 60, input(['KeyD'], ['Space']));
  assert.deepEqual(g.getState(), frozen);
});

test('a throwing or missing progress store never stops a clear', () => {
  for (const progress of [
    undefined,
    {
      unlocked() {
        throw new Error('blocked');
      },
      unlock() {
        throw new Error('blocked');
      },
    },
    { unlocked: () => 1 },
  ]) {
    const h = harness({ seed: 2 });
    if (progress) h.env.progress = progress;
    const g = createGame(h.env),
      decide = makeBot({ lag: 0.1, hz: 60 });
    for (
      let f = 0;
      f < 60 * 400 && g.getState().level === 1 && g.getState().phase === 'playing';
      f++
    ) {
      const keys = decide(g.getState(), f / 60);
      g.update(
        1 / 60,
        input(
          keys,
          keys.filter((k) => k === 'Space'),
        ),
      );
    }
    assert.equal(g.getState().level, 2, 'the garden was cleared and the next one began');
    assert.equal(g.getState().phase, 'playing');
  }
});

test('a clear unlocks exactly the next garden, once, and the select then lists it', () => {
  const r = play({ level: 3, hz: 60, seed: 1 });
  assert.deepEqual(r.calls, [4]);
  let unlocked = 4;
  const h = harness();
  h.env.progress = { unlocked: () => unlocked, unlock() {} };
  const g = createGame(h.env);
  assert.deepEqual(g.getState().menu, { cursor: 4, unlocked: 4 });
});

// ---------------------------------------------------------------------------------------------
// Both languages, touch and the screen
// ---------------------------------------------------------------------------------------------
test('a Chinese run plays out exactly like an English one and draws Chinese text', () => {
  for (const level of [1, 8, 13]) {
    const en = play({ level, hz: 60, seed: 2, lag: 0.2, lang: 'en' }),
      zh = play({ level, hz: 60, seed: 2, lag: 0.2, lang: 'zh' });
    assert.ok(zh.cleared, `garden ${level}`);
    assert.equal(zh.s.score, en.s.score);
    assert.equal(zh.s.elapsed, en.s.elapsed);
    assert.deepEqual(zh.s.board, en.s.board);
  }
  const { g } = open(9, { lang: 'zh', seed: 2 }),
    words = [];
  const ctx = mockContext();
  ctx.fillText = (text) => words.push(String(text));
  g.draw(ctx);
  assert.ok(words.some((w) => w.includes('击败所有对手')));
  assert.ok(words.some((w) => w.includes('墙壁 / 木箱 / 堆肥桶可挡喷焰')));
  assert.ok(words.some((w) => w.includes('花园 9/')));
  assert.ok(
    words.some((w) => /[一-鿿]/.test(w) && w.includes('湿地')),
    'the tip is Chinese',
  );
});

test('touch alone covers solo play: pad buttons start a garden from the select and clear it', () => {
  const h = harness({ seed: 3 });
  h.env.progress = { unlocked: () => 6, unlock() {} };
  const g = createGame(h.env);
  const pad = (...codes) => {
    assert.ok(codes.every((c) => TOUCH_CODES.has(c)));
    g.update(1 / 60, input(codes, codes));
  };
  pad('KeyA');
  assert.equal(g.getState().menu.cursor, 5, 'left');
  pad('KeyD');
  pad('KeyW');
  assert.equal(g.getState().menu.cursor, 1, 'up');
  pad('KeyS');
  assert.equal(g.getState().menu.cursor, 6, 'down');
  pad('Space');
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 6);
  const r = play({ level: 6, hz: 60, seed: 1 });
  assert.ok(r.cleared);
  assert.ok([...r.used].every((k) => TOUCH_CODES.has(k)));
  assert.ok(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space'].every((c) => TOUCH_CODES.has(c)));
});

test('duel touch controls give each player all four moves and a bomb, and nothing is shared', () => {
  const codes = meta.multiplayerTouchControls.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  const left = meta.multiplayerTouchControls.filter((c) => c.side === 'left').map((c) => c.code);
  const right = meta.multiplayerTouchControls.filter((c) => c.side === 'right').map((c) => c.code);
  assert.deepEqual(left.sort(), ['KeyA', 'KeyD', 'KeyS', 'KeyW', 'Space']);
  assert.deepEqual(right.sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter']);
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 60, input(['KeyD', 'ArrowLeft'], ['Space', 'Enter']));
  const s = g.getState();
  assert.ok(s.players[0].moving && s.players[1].moving);
  for (let i = 0; i < 40; i++) g.update(1 / 60, input());
  assert.equal(g.getState().bombs.length, 2);
});

/** Width of drawn text, in canvas pixels, the way the monospace font lays it out. */
function drawnText(game) {
  const calls = [];
  const state = { font: '', textAlign: 'left', fillStyle: '' };
  const ctx = new Proxy(
    { measureText: () => ({ width: 0 }), canvas: { width: 480, height: 320 } },
    {
      get: (target, key) =>
        key === 'fillText'
          ? (text, x, y) => calls.push({ text: String(text), x, y, ...state })
          : key in target
            ? target[key]
            : key in state
              ? state[key]
              : () => {},
      set: (target, key, value) => ((state[key] = value), true),
    },
  );
  game.draw(ctx);
  return calls.map((c) => {
    const size = Number(/(\d+)px/.exec(c.font)[1]);
    const width = [...c.text].reduce(
      (n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.6),
      0,
    );
    const left =
      c.textAlign === 'center' ? c.x - width / 2 : c.textAlign === 'right' ? c.x - width : c.x;
    return { ...c, size, left, right: left + width, top: c.y, bottom: c.y + size };
  });
}

test('every screen of every garden fits the canvas in English and Chinese, with no overlapping text', () => {
  let screens = 0;
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= GARDEN_COUNT; level++) {
      const { g } = open(level, { lang });
      const views = [drawnText(g)]; // banner
      for (let i = 0; i < 60 * 6; i++) g.update(1 / 60, input());
      views.push(drawnText(g)); // legend strip
      for (const boxes of views) {
        screens++;
        for (const b of boxes) {
          assert.ok(
            b.left >= 0 && b.right <= 480,
            `${lang} garden ${level} "${b.text}" ${b.left}-${b.right}`,
          );
          assert.ok(
            b.top >= 0 && b.bottom <= 320,
            `${lang} garden ${level} "${b.text}" is off the canvas`,
          );
        }
        const hud = boxes.filter((b) => b.top < 40);
        for (let i = 0; i < hud.length; i++)
          for (let j = i + 1; j < hud.length; j++) {
            const a = hud[i],
              c = hud[j];
            const apart =
              a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top;
            assert.ok(apart, `${lang} garden ${level}: "${a.text}" overlaps "${c.text}"`);
          }
        const strip = boxes.filter((b) => b.top >= 280);
        assert.ok(
          strip.every((b) => b.left >= 15 && b.right <= 465),
          `${lang} garden ${level} strip text`,
        );
      }
    }
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => GARDEN_COUNT, unlock() {} };
    const g = createGame(h.env);
    for (const cursorKeys of [[], ['ArrowLeft'], ['ArrowUp'], ['ArrowLeft']]) {
      g.update(1 / 60, input([], cursorKeys));
      for (const b of drawnText(g)) {
        screens++;
        assert.ok(b.left >= 0 && b.right <= 480, `${lang} select "${b.text}" ${b.left}-${b.right}`);
        assert.ok(b.bottom <= 320, `${lang} select "${b.text}"`);
      }
    }
  }
  assert.ok(screens > 90);
});

test('the objective and the rival roles are on the canvas for every garden, in both languages', () => {
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= GARDEN_COUNT; level++) {
      const { g } = open(level, { lang });
      for (let i = 0; i < 60 * 6; i++) g.update(1 / 60, input());
      const text = drawnText(g)
        .map((b) => b.text)
        .join(' | ');
      const garden = GARDENS[level - 1];
      assert.match(
        text,
        lang === 'en' ? /DEFEAT ALL RIVALS \(\d LEFT\)/ : /击败所有对手（剩\d个）/,
      );
      for (const role of new Set(garden.foes.map((f) => f[2]))) {
        const r = ROLES[role];
        assert.ok(text.includes(lang === 'en' ? r.name.en : r.name.zh), `${lang} ${level} ${role}`);
        assert.ok(text.includes(lang === 'en' ? r.note.en : r.note.zh));
      }
      assert.ok(
        text.includes(
          lang === 'en' ? 'WALLS / CRATES / BARRELS STOP JETS' : '墙壁 / 木箱 / 堆肥桶可挡喷焰',
        ),
      );
    }
});

// ---------------------------------------------------------------------------------------------
// Depth: crude players lose, a sensible but careless player is not enough
// ---------------------------------------------------------------------------------------------
const WEAK_HZ = 30;
const BLIND_RUNS = 6; // blind players never win, so a few seeds show it
const SIGHTED_RUNS = 20; // sighted players are close to the bars, so the bars must hold beyond a seed choice
const DIRECTION_KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS'];

/** A blind policy: (t, random) -> keys for this frame. It never looks at the screen. */
const BLIND = {
  idle: () => () => [],
  mashSpace: () => () => ['Space'],
  mashAndWalk: () => (t) => [DIRECTION_KEYS[Math.floor(t * 3) % 4], 'Space'],
  randomKeys: (rnd) => {
    let until = 0,
      key = 'Space';
    return (t) => {
      if (t >= until) {
        until = t + 0.1 + rnd() * 0.35;
        key = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowUp', 'Space', 'KeyJ'][
          Math.floor(rnd() * 8)
        ];
      }
      return [key];
    };
  },
};

function blindWins(level, seed, name, seconds) {
  const { g } = open(level, { seed });
  const pick = BLIND[name](seeded(seed * 53 + level));
  for (let f = 0, t = 0; t < seconds; f++, t += 1 / WEAK_HZ) {
    if (f % 15 === 0 && (g.getState().phase !== 'playing' || g.getState().level !== level)) break;
    const keys = pick(t);
    g.update(1 / WEAK_HZ, input(keys, f % 2 ? keys : keys.filter((k) => k === 'Space')));
  }
  const s = g.getState();
  return s.level > level || s.phase === 'won';
}

test('idle never clears any garden', () => {
  for (let level = 1; level <= GARDEN_COUNT; level++)
    assert.equal(
      blindWins(level, 1, 'idle', GARDENS[level - 1].time + 5),
      false,
      `garden ${level}`,
    );
});

test('from garden 3 on, mashing and random keys each win at most a quarter of runs', (t) => {
  const table = {};
  for (const name of ['mashSpace', 'mashAndWalk', 'randomKeys']) {
    table[name] = [];
    for (let level = 3; level <= GARDEN_COUNT; level++) {
      let wins = 0;
      for (let seed = 1; seed <= BLIND_RUNS; seed++)
        if (blindWins(level, seed, name, Math.min(120, GARDENS[level - 1].time))) wins++;
      table[name].push(wins);
      assert.ok(wins <= BLIND_RUNS / 4, `${name} garden ${level}: ${wins}/${BLIND_RUNS}`);
    }
    t.diagnostic(
      `${name.padEnd(12)} wins of ${BLIND_RUNS}, gardens 3-${GARDEN_COUNT}: ${table[name].join(' ')}`,
    );
  }
});

/** Sees the screen but only the present: walks safe cells, bombs when it likes, no plan. */
function informedRandom(rnd) {
  return (s) => {
    const p = s.players[0];
    if (!p.alive || p.moving || s.respawn > 0 || s.transition > 0) return [];
    const danger = new Set(s.danger.map(([x, y]) => K(x, y)));
    const free = (x, y) =>
      s.board[y]?.[x] === 0 &&
      !s.bombs.some((b) => b.x === x && b.y === y) &&
      !s.enemies.some((e) => e.alive && e.x === x && e.y === y);
    if (danger.has(K(p.x, p.y))) return fleeFrom(s, p, danger, free);
    const crateNear = MOVES.some(([dx, dy]) => s.board[p.y + dy]?.[p.x + dx] === 2);
    const mine = s.bombs.filter((b) => b.owner === 0 && !b.barrel).length;
    if (crateNear && mine < p.capacity && rnd() < 0.6) return ['Space'];
    const options = MOVES.filter(
      ([dx, dy]) => free(p.x + dx, p.y + dy) && !danger.has(K(p.x + dx, p.y + dy)),
    );
    return options.length ? [options[Math.floor(rnd() * options.length)][2]] : [];
  };
}
function fleeFrom(s, p, danger, free) {
  const queue = [{ x: p.x, y: p.y, first: null }],
    seen = new Set([K(p.x, p.y)]);
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n.first && !danger.has(K(n.x, n.y))) return [n.first];
    for (const [dx, dy, code] of MOVES)
      if (free(n.x + dx, n.y + dy) && !seen.has(K(n.x + dx, n.y + dy))) {
        seen.add(K(n.x + dx, n.y + dy));
        queue.push({ x: n.x + dx, y: n.y + dy, first: n.first ?? code });
      }
  }
  return [];
}

/** Walks to the nearest crate or rival, plants, runs to the nearest cell off the blast preview. */
function simpleGreedy() {
  return (s) => {
    const p = s.players[0];
    if (!p.alive || p.moving || s.respawn > 0 || s.transition > 0) return [];
    const danger = new Set(s.danger.map(([x, y]) => K(x, y)));
    const free = (x, y) =>
      s.board[y]?.[x] === 0 &&
      !s.bombs.some((b) => b.x === x && b.y === y) &&
      !s.enemies.some((e) => e.alive && e.x === x && e.y === y);
    if (danger.has(K(p.x, p.y))) return fleeFrom(s, p, danger, free);
    if (s.bombs.some((b) => b.owner === 0)) return [];
    const target = (x, y) =>
      MOVES.some(
        ([dx, dy]) =>
          s.board[y + dy]?.[x + dx] === 2 ||
          s.enemies.some((e) => e.alive && e.x === x + dx && e.y === y + dy),
      );
    if (target(p.x, p.y)) return ['Space'];
    const queue = [{ x: p.x, y: p.y, first: null }],
      seen = new Set([K(p.x, p.y)]);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (n.first && target(n.x, n.y)) return [n.first];
      for (const [dx, dy, code] of MOVES) {
        const x = n.x + dx,
          y = n.y + dy;
        if (free(x, y) && !seen.has(K(x, y)) && !danger.has(K(x, y))) {
          seen.add(K(x, y));
          queue.push({ x, y, first: n.first ?? code });
        }
      }
    }
    return [];
  };
}

const sightedWins = new Map();
function sightedRate(name) {
  if (sightedWins.has(name)) return sightedWins.get(name);
  const make = { informedRandom, simpleGreedy }[name];
  const row = [];
  for (let level = 1; level <= GARDEN_COUNT; level++) {
    let wins = 0;
    for (let seed = 1; seed <= SIGHTED_RUNS; seed++) {
      const r = play({
        level,
        seed,
        hz: WEAK_HZ,
        policy: make(seeded(seed * 29 + level)),
        seconds: GARDENS[level - 1].time,
        every: 60,
      });
      if (r.cleared) wins++;
    }
    row.push(wins);
  }
  sightedWins.set(name, row);
  return row;
}

test('an informed-random walker and a simple greedy bomber each win at most half the gardens', (t) => {
  for (const name of ['informedRandom', 'simpleGreedy']) {
    const row = sightedRate(name);
    const beaten = row.filter((w) => w > SIGHTED_RUNS / 2).length;
    t.diagnostic(
      `${name.padEnd(14)} wins of ${SIGHTED_RUNS} per garden: ${row.join(' ')}  (beats ${beaten})`,
    );
    assert.ok(beaten <= GARDEN_COUNT / 2, `${name} beats ${beaten} of ${GARDEN_COUNT} gardens`);
    const late = row.slice(Math.floor((GARDEN_COUNT * 2) / 3));
    assert.ok(
      late.every((w) => w <= SIGHTED_RUNS / 2),
      `${name} beats a garden in the last third: ${late.join(' ')}`,
    );
  }
});

// Gardens whose informed-random rate sat near the ceiling get a larger, pooled sample with margin.
const POOLED_GARDENS = [9, 11];
const POOLED_RUNS = 100;
const POOLED_CEILING = 0.45;
test('informed random clearly loses the gardens it came closest to winning, over a pooled sample', (t) => {
  for (const level of POOLED_GARDENS) {
    let wins = 0;
    for (let seed = 1; seed <= POOLED_RUNS; seed++) {
      const r = play({
        level,
        seed: seed + 1000,
        hz: WEAK_HZ,
        policy: informedRandom(seeded(seed * 7919 + level)),
        seconds: GARDENS[level - 1].time,
        every: 600,
      });
      if (r.cleared) wins++;
    }
    t.diagnostic(`informedRandom pooled wins on garden ${level}: ${wins} of ${POOLED_RUNS}`);
    assert.ok(
      wins <= POOLED_RUNS * POOLED_CEILING,
      `informedRandom won garden ${level} ${wins} of ${POOLED_RUNS} runs`,
    );
  }
});

test('the difficulty curve rises: rival threat by thirds, and the crude bomber wins less and less', (t) => {
  const weight = { bomber: 1, scout: 1.6, warden: 1.8 };
  const threat = GARDENS.map(
    (g) =>
      g.foes.reduce((n, f) => n + weight[f[2]], 0) +
      g.barrels * 0.1 +
      g.wet.length * 0.03 +
      (1 - g.pace) * 4,
  );
  const third = Math.ceil(GARDEN_COUNT / 3);
  const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
  const bands = [threat.slice(0, third), threat.slice(third, 2 * third), threat.slice(2 * third)];
  t.diagnostic(`threat per garden: ${threat.map((x) => x.toFixed(1)).join(' ')}`);
  assert.ok(
    mean(bands[0]) < mean(bands[1]) && mean(bands[1]) < mean(bands[2]),
    bands.map(mean).join(' < '),
  );
  assert.equal(Math.min(...threat), threat[0], 'garden 1 is the gentlest');
  const wins = sightedRate('simpleGreedy');
  const crude = [wins.slice(0, third), wins.slice(third, 2 * third), wins.slice(2 * third)].map(
    mean,
  );
  t.diagnostic(`simple greedy mean wins by third: ${crude.map((x) => x.toFixed(1)).join(', ')}`);
  assert.ok(crude[0] > crude[1] && crude[1] > crude[2], crude.join(' > '));
  const plateau = wins.slice(11, 14);
  t.diagnostic(`simple greedy on gardens 12-14: ${plateau.join(' ')}`);
  assert.ok(
    Math.max(...plateau) <= SIGHTED_RUNS * 0.6,
    'gardens 12-14 are no longer a plateau of easy wins',
  );
  assert.ok(crude[2] <= SIGHTED_RUNS / 3, 'the crude bomber rarely clears a late garden');
});

// ---------------------------------------------------------------------------------------------
// Robustness: hostile input and frame times never break an invariant
// ---------------------------------------------------------------------------------------------
test('random keys, pointers and frame times keep every invariant in both modes, with one end and a frozen finish', () => {
  const DTS = [1 / 30, 1 / 60, 1 / 120, 1 / 144, 0.1, 0.5, 0, -1, NaN, Infinity, 1e-9, 0.007];
  const KEYS = [
    'KeyA',
    'KeyD',
    'KeyW',
    'KeyS',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyJ',
    'Enter',
    'Slash',
  ];
  const POINTS = [NaN, Infinity, 1e12, -1e12, 0, 479, 320, -1];
  for (const mode of [1, 2])
    for (let seed = 1; seed <= 6; seed++) {
      const level = mode === 1 ? 1 + ((seed * 5) % GARDEN_COUNT) : 1,
        rnd = seeded(seed * 7919 + mode),
        { g, h } = open(level, { seed, mode });
      for (let f = 0; f < 60 * (mode === 1 ? 60 : 40) && g.getState().phase === 'playing'; f++) {
        const held = KEYS.filter(() => rnd() < 0.25),
          pressed = held.filter(() => rnd() < 0.5),
          pointer =
            rnd() < 0.2
              ? {
                  x: POINTS[Math.floor(rnd() * 8)],
                  y: POINTS[Math.floor(rnd() * 8)],
                  down: true,
                  clicked: rnd() < 0.7,
                }
              : {};
        g.update(
          rnd() < 0.7 ? 1 / 60 : DTS[Math.floor(rnd() * DTS.length)],
          input(held, pressed, pointer),
        );
        if (f % 7 === 0) {
          g.draw(mockContext());
          invariants(g.getState(), h, `mode ${mode} seed ${seed} f=${f}`);
        }
      }
      const end = g.getState();
      assert.equal(h.ends.length, end.phase === 'playing' ? 0 : 1);
      if (end.phase !== 'playing') {
        const frozen = JSON.stringify(end);
        for (let i = 0; i < 90; i++) g.update(1 / 60, input(['KeyD'], ['Space']));
        assert.equal(JSON.stringify(g.getState()), frozen);
        assert.equal(h.ends.length, 1);
      }
    }
});
