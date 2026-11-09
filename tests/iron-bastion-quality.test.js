import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { createBastionState, createGame, meta, stepBastion } from '../src/games/iron-bastion.js';
import {
  AIM_DEAD_ZONE,
  ARENA,
  BASE,
  BEACON,
  FIELDS,
  FIELD_COUNT,
  LANES,
  MAGAZINE,
  PLAYER_START,
  ROLES,
  THEMES,
  coverFor,
  fieldOf,
} from '../src/games/iron-bastion-data.js';
import { drawBastion } from '../src/games/iron-bastion-draw.js';
import { MENU, drawMenu, menuCellAt } from '../src/games/iron-bastion-menu.js';
import { bodyFree, circleHitsRect, stepShells } from '../src/games/iron-bastion-physics.js';
import { harness, input, mockContext } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player here sees only getState() and presses only public inputs.
//   bot:   a reaction-limited aimer (keyboard or pointer) that leads moving targets, shoots down
//          shells bound for the beacon, steps aside for a clear line and spends repair kits.
//   blind: players that never look at the field: mash, hold, sweep, tap or do nothing.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const BOT_SEEDS = [1, 2];
const BLIND_SEEDS = [1, 2, 3, 4, 5, 6];
const BLIND_POLICIES = [
  'idle',
  'holdSpace',
  'randomMash',
  'spaceRandomDir',
  'brakeSweepFire',
  'pointerSweep',
  'pointerTaps',
  'pointerParked',
];
const BLIND_MAX_WIN_RATE = 0.25;
const FIRST_BLIND_FIELD = 3;
const FIELD_SECONDS = 150;
const BLIND_SECONDS = 100;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function rng(seed) {
  return () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
}

// A game opened on `field` through the level select, with an in-memory progress store.
function open(field, { seed = 1, lang = 'en', start = true } = {}) {
  const h = harness({ seed, lang }),
    store = { value: field };
  h.env.progress = {
    unlocked: () => store.value,
    unlock: (n) => (store.value = Math.max(store.value, n)),
  };
  const game = createGame(h.env);
  if (field > 1 && start) game.update(1 / 60, input([], ['Space']));
  return { game, h, store };
}

function rectRay(x, y, vx, vy, margin, b) {
  let near = 0,
    far = Infinity;
  for (const [v, q, lo, hi] of [
    [vx, x, b.x - margin, b.x + b.w + margin],
    [vy, y, b.y - margin, b.y + b.h + margin],
  ]) {
    if (Math.abs(v) < 1e-12) {
      if (q < lo || q > hi) return Infinity;
      continue;
    }
    const a = (lo - q) / v,
      c = (hi - q) / v;
    near = Math.max(near, Math.min(a, c));
    far = Math.min(far, Math.max(a, c));
    if (near > far) return Infinity;
  }
  return near;
}
const segmentHits = (x0, y0, x1, y1, margin, b) =>
  rectRay(x0, y0, x1 - x0, y1 - y0, margin, b) <= 1;
const hardLine = (tiles, x0, y0, x1, y1) =>
  tiles.some((t) => t.steel && segmentHits(x0, y0, x1, y1, 2, t)) ||
  segmentHits(x0, y0, x1, y1, 2, BASE);
const softLine = (tiles, x0, y0, x1, y1) =>
  tiles.some((t) => !t.steel && segmentHits(x0, y0, x1, y1, 2, t));

const SHELL_SPEED = 300;
// The enemy to shoot: nearest the beacon first, lead on its velocity, brick in the way counts
// against it and steel in the way rules it out until the tank steps aside.
function chooseTarget(seen, now, lag) {
  const p = now.player;
  let best = null;
  for (const e of seen.enemies) {
    let ex = e.x + e.vx * lag,
      ey = e.y + e.vy * lag;
    for (let k = 0; k < 3; k++) {
      const flight = Math.hypot(ex - p.x, ey - p.y) / SHELL_SPEED;
      ex = e.x + e.vx * (lag + flight);
      ey = e.y + e.vy * (lag + flight);
    }
    const aim = Math.atan2(ey - p.y, ex - p.x),
      mx = p.x + Math.cos(aim) * 10,
      my = p.y + Math.sin(aim) * 10,
      hard = hardLine(now.tiles, mx, my, ex, ey),
      soft = !hard && softLine(now.tiles, mx, my, ex, ey),
      threat = e.y + (e.hp === 1 ? 20 : 0) - (hard ? 1000 : 0) - (soft ? 150 : 0);
    if (!best || threat > best.threat)
      best = { aim, dist: Math.hypot(ex - p.x, ey - p.y), hard, threat, ex, ey, e };
  }
  return best;
}
// An enemy shell that will reach the beacon before it meets any cover, and that one of ours can
// meet first once the turret has swung round.
function chooseShell(seen, now, lag) {
  const p = now.player;
  let best = null;
  for (const b of seen.bullets) {
    if (b.owner !== 'enemy') continue;
    const bx = b.x + b.vx * lag,
      by = b.y + b.vy * lag,
      arrival = rectRay(bx, by, b.vx, b.vy, 2, BASE);
    if (!Number.isFinite(arrival) || arrival > 1.6) continue;
    if (now.tiles.some((t) => rectRay(bx, by, b.vx, b.vy, 2, t) < arrival)) continue;
    let tau = Math.hypot(bx - p.x, by - p.y) / SHELL_SPEED,
      ex = bx,
      ey = by;
    for (let k = 0; k < 6; k++) {
      ex = bx + b.vx * tau;
      ey = by + b.vy * tau;
      const swing = Math.abs(wrap(Math.atan2(ey - p.y, ex - p.x) - p.turret)) / 4 + 0.03;
      tau = swing + Math.hypot(ex - p.x, ey - p.y) / SHELL_SPEED;
    }
    if (tau > arrival - 0.05) continue;
    const aim = Math.atan2(ey - p.y, ex - p.x),
      mx = p.x + Math.cos(aim) * 10,
      my = p.y + Math.sin(aim) * 10;
    if (hardLine(now.tiles, mx, my, ex, ey) || softLine(now.tiles, mx, my, ex, ey)) continue;
    if (!best || arrival < best.arrival)
      best = {
        aim,
        dist: Math.hypot(ex - p.x, ey - p.y),
        hard: false,
        arrival,
        shell: true,
        ex,
        ey,
        e: { hp: 1 },
      };
  }
  return best;
}
// Own shells already on their way to this enemy.
function inFlightAt(now, e, lag) {
  let count = 0;
  for (const b of now.bullets) {
    if (b.owner !== 'player') continue;
    const rx = e.x + e.vx * lag - b.x,
      ry = e.y + e.vy * lag - b.y,
      vx = e.vx - b.vx,
      vy = e.vy - b.vy,
      vv = vx * vx + vy * vy,
      t = vv > 1e-9 ? Math.max(0, -(rx * vx + ry * vy) / vv) : 0;
    if (t < 2 && Math.hypot(rx + vx * t, ry + vy * t) < 12) count++;
  }
  return count;
}

const NAV = { pitch: 12, x0: 20, y0: 56, cols: 37, rows: 21 };
const navX = (n) => NAV.x0 + (n % NAV.cols) * NAV.pitch;
const navY = (n) => NAV.y0 + Math.floor(n / NAV.cols) * NAV.pitch;
function navGrid(tiles) {
  const free = [];
  for (let r = 0; r < NAV.rows; r++)
    for (let c = 0; c < NAV.cols; c++) {
      const x = NAV.x0 + c * NAV.pitch,
        y = NAV.y0 + r * NAV.pitch;
      free.push(
        x >= 20 &&
          x <= 460 &&
          y >= 56 &&
          y <= 300 &&
          [BASE, ...tiles].every((t) => {
            const px = Math.max(t.x, Math.min(x, t.x + t.w)),
              py = Math.max(t.y, Math.min(y, t.y + t.h));
            return (x - px) ** 2 + (y - py) ** 2 > 169;
          }),
      );
    }
  return free;
}
function nearestNode(free, x, y) {
  let best = -1,
    d = Infinity;
  free.forEach((ok, n) => {
    const v = (navX(n) - x) ** 2 + (navY(n) - y) ** 2;
    if (ok && v < d) {
      d = v;
      best = n;
    }
  });
  return best;
}
function distancesFrom(free, start) {
  const dist = new Map([[start, 0]]),
    queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const n = queue[k],
      x = n % NAV.cols,
      y = Math.floor(n / NAV.cols);
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + ox,
        yy = y + oy,
        next = yy * NAV.cols + xx;
      if (xx >= 0 && xx < NAV.cols && yy >= 0 && yy < NAV.rows && free[next] && !dist.has(next)) {
        dist.set(next, dist.get(n) + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

function strip(state) {
  const { toast, status, ...rest } = state;
  return JSON.stringify(rest);
}

const allFinite = (v) =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : v !== null && typeof v === 'object'
      ? Object.values(v).every(allFinite)
      : true;
// Invariants checked on every frame of every bot run: finite state, no tank inside a solid,
// and armor or beacon points are lost only when a shell (or a point-blank gun) is right there.
function invariantViolations(prev, now) {
  let bad = 0;
  if (!allFinite(now)) bad++;
  for (const a of [now.player, ...now.enemies])
    if ([BASE, ...now.tiles].some((t) => circleHitsRect(a.x, a.y, 11.5, t))) bad++;
  const near = (b, x, y, d) => Math.hypot(b.x - x, b.y - y) <= d;
  if (now.lives < prev.lives) {
    const p = prev.player;
    if (
      !prev.bullets.some((b) => near(b, p.x, p.y, 26)) &&
      !prev.enemies.some((e) => near(e, p.x, p.y, 45))
    )
      bad++;
  }
  if (now.baseHealth < prev.baseHealth && !prev.bullets.some((b) => near(b, 240, 295, 40))) bad++;
  return bad;
}

// Plays one field to its end. mode 'kb' turns the turret with X + arrows and fires with Space;
// mode 'ptr' points at the target and lets the cannon fire once the turret has settled.
function runBot({ field, hz = 60, mode = 'kb', seed = 1, lang = 'en', lag = 0.2 }) {
  const { game, h, store } = open(field, { seed, lang }),
    delay = Math.round(lag * hz),
    lagSeconds = delay / hz,
    history = [],
    abandoned = new Set();
  let goal = null,
    goalAge = 0,
    violations = 0,
    previous = null,
    state = game.getState();
  for (let n = 0; n < hz * FIELD_SECONDS; n++) {
    state = game.getState();
    if (previous) violations += invariantViolations(previous, state);
    previous = state;
    if (state.phase !== 'playing' || state.field !== field) break;
    history.push(state);
    const seen = history[Math.max(0, history.length - 1 - delay)],
      p = state.player,
      resting = state.transition > 0 || state.clearing,
      held = [],
      pressed = [],
      awayFromBeacon = Math.hypot(p.x - BEACON.x, p.y - BEACON.y);
    let pointer = {},
      moving = false;
    if (
      state.kits > 0 &&
      n % Math.round(hz / 2) === 0 &&
      (state.lives <= 2 || (state.baseHealth <= 4 && awayFromBeacon <= 75))
    )
      pressed.push('KeyH');
    const plan = resting
        ? null
        : chooseShell(seen, state, lagSeconds) || chooseTarget(seen, state, lagSeconds),
      needRepair = state.kits > 0 && state.baseHealth <= 4 && awayFromBeacon > 68;
    if (needRepair || plan?.hard) {
      if (goal && goalAge > hz * 2) {
        abandoned.add(goal.node);
        goal = null;
      }
      if (needRepair) {
        const free = navGrid(state.tiles);
        goal = { node: nearestNode(free, 190, 284), free };
        goalAge = 0;
      }
      if (!goal) {
        const free = navGrid(state.tiles),
          dist = distancesFrom(free, nearestNode(free, p.x, p.y)),
          targets = seen.enemies.map((e) => ({ x: e.x + e.vx * 0.5, y: e.y + e.vy * 0.5 }));
        let bestNode = -1,
          bestScore = -Infinity;
        for (const [node, d] of dist) {
          const x = navX(node),
            y = navY(node);
          if (y < 190 || Math.hypot(x - 166, y - 284) > 170 || abandoned.has(node)) continue;
          const clear = targets.filter((t) => !hardLine(state.tiles, x, y, t.x, t.y)).length;
          if (clear > 0 && clear * 12 - d > bestScore) {
            bestScore = clear * 12 - d;
            bestNode = node;
          }
        }
        goal = bestNode >= 0 ? { node: bestNode, free } : null;
        goalAge = 0;
      }
      if (goal) {
        goalAge++;
        const dist = distancesFrom(goal.free, goal.node),
          here = nearestNode(goal.free, p.x, p.y);
        if (Math.hypot(navX(goal.node) - p.x, navY(goal.node) - p.y) > 5) {
          let next = here,
            best = dist.get(here) ?? Infinity;
          for (const nb of [here - 1, here + 1, here - NAV.cols, here + NAV.cols])
            if ((dist.get(nb) ?? Infinity) < best) {
              best = dist.get(nb);
              next = nb;
            }
          const dx = (next === here ? navX(goal.node) : navX(next)) - p.x,
            dy = (next === here ? navY(goal.node) : navY(next)) - p.y;
          if (dx > 3) held.push('ArrowRight');
          else if (dx < -3) held.push('ArrowLeft');
          if (dy > 3) held.push('ArrowDown');
          else if (dy < -3) held.push('ArrowUp');
          moving = held.length > 0;
        }
      }
    } else goal = null;
    if (!moving && plan && !plan.hard) {
      const worthAShot = plan.shell || inFlightAt(state, plan.e, lagSeconds) < plan.e.hp;
      if (mode === 'kb') {
        const stop = p.turret + (p.turretOmega * Math.abs(p.turretOmega)) / 48,
          err = wrap(plan.aim - stop),
          reach = Math.hypot(plan.ex - p.x, plan.ey - p.y),
          muzzle = { x: p.x + Math.cos(p.turret) * 10, y: p.y + Math.sin(p.turret) * 10 },
          blocked = hardLine(
            state.tiles,
            muzzle.x,
            muzzle.y,
            p.x + Math.cos(p.turret) * reach,
            p.y + Math.sin(p.turret) * reach,
          );
        // A turret resting a hair off the line of a gap is nudged until the line is clean.
        const band = blocked ? 0.004 : 0.02;
        if (err > band) held.push('ArrowRight');
        else if (err < -band) held.push('ArrowLeft');
        if (
          Math.abs(wrap(plan.aim - p.turret)) < Math.atan((plan.shell ? 3 : 10) / plan.dist) &&
          p.charge >= 1 &&
          Math.abs(p.turretOmega) < 0.8 &&
          worthAShot &&
          !blocked
        )
          held.push('Space');
      } else
        pointer = {
          x: Math.max(1, Math.min(479, p.x + Math.cos(plan.aim) * 90)),
          y: Math.max(45, Math.min(319, p.y + Math.sin(plan.aim) * 90)),
          down: worthAShot,
        };
    }
    if (!moving && mode === 'kb') held.push('KeyX');
    game.update(1 / hz, input(held, pressed, pointer));
  }
  state = game.getState();
  // Whatever happens at the end, the callback fires once and the state freezes.
  const frozen = strip(state),
    rand = rng(seed);
  for (let n = 0; n < 40 && state.phase !== 'playing'; n++)
    game.update(1 / hz, input(['Space', 'ArrowUp'], rand() < 0.3 ? ['KeyH'] : []));
  return {
    field,
    hz,
    mode,
    seed,
    cleared: state.field > field || state.phase === 'won',
    phase: state.phase,
    time: state.time,
    ends: h.ends.length,
    won: h.ends[0]?.won ?? null,
    frozen: state.phase === 'playing' || strip(game.getState()) === frozen,
    unlocked: store.value,
    violations,
    fingerprint: frozen,
    endState: h.ends.length ? frozen : null,
  };
}

const DIRECTIONS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const BLIND = {
  idle: () => () => [[], [], {}],
  holdSpace: () => () => [['Space'], [], {}],
  randomMash: (r) => {
    let held = [];
    return (n) => {
      if (n % 20 === 0) held = [...DIRECTIONS, 'Space', 'KeyX'].filter(() => r() < 0.4);
      return [held, r() < 0.02 ? ['KeyH'] : [], {}];
    };
  },
  spaceRandomDir: (r) => {
    let held = [];
    return (n) => {
      if (n % 30 === 0) {
        held = ['Space'];
        if (r() < 0.8) held.push(DIRECTIONS[Math.floor(r() * 4)]);
        if (r() < 0.3) held.push('KeyX');
      }
      return [held, r() < 0.01 ? ['KeyH'] : [], {}];
    };
  },
  brakeSweepFire: (r) => {
    const per = 30 + Math.floor(r() * 200);
    return (n) => [
      ['Space', 'KeyX', Math.floor(n / per) % 2 ? 'ArrowLeft' : 'ArrowRight'],
      n % 150 === 0 ? ['KeyH'] : [],
      {},
    ];
  },
  // Hold the pointer down and sweep it along the spawn row; the tank never moves.
  pointerSweep: (r) => {
    const y = 50 + r() * 40,
      speed = 0.5 + r() * 4,
      lo = 20 + r() * 150,
      hi = 300 + r() * 160,
      phase = Math.floor(r() * 1000);
    return (n) => {
      const span = hi - lo,
        t = ((n + phase) * speed) % (2 * span),
        x = lo + (t < span ? t : 2 * span - t);
      return [[], n % 240 === 0 ? ['KeyH'] : [], { x, y, down: true }];
    };
  },
  // Random taps across the upper field, each held for a fraction of a second.
  pointerTaps: (r) => {
    let at = { x: 240, y: 100 },
      hold = 0;
    return (n) => {
      if (hold-- <= 0) {
        hold = 6 + Math.floor(r() * 36);
        at = { x: 30 + r() * 420, y: 50 + r() * 110 };
      }
      return [[], n % 300 === 0 ? ['KeyH'] : [], { ...at, down: true }];
    };
  },
  pointerParked: (r) => {
    const x = LANES[Math.floor(r() * LANES.length)];
    return (n) => [[], n % 300 === 0 ? ['KeyH'] : [], { x, y: 120, down: true }];
  },
};
function runBlind({ policy, field, seed }) {
  const { game } = open(field, { seed }),
    play = BLIND[policy](rng(seed * 7919 + 13));
  let state = game.getState();
  for (let n = 0; n < 60 * BLIND_SECONDS; n++) {
    const [held, pressed, pointer] = play(n);
    game.update(1 / 60, input(held, pressed, pointer));
    if (n % 10 === 0) {
      state = game.getState();
      if (state.phase !== 'playing' || state.field !== field) break;
    }
  }
  state = game.getState();
  return { policy, field, seed, won: state.phase === 'won' || state.field > field };
}

// ---------------------------------------------------------------------------------------------
// A pool of worker threads (this same file) keeps the many long runs inside a few minutes.
// ---------------------------------------------------------------------------------------------
const JOBS = { bot: runBot, blind: runBlind };
if (!isMainThread)
  parentPort.on('message', ({ id, kind, spec }) =>
    parentPort.postMessage({ id, result: JOBS[kind](spec) }),
  );

function createPool(size) {
  const idle = [],
    queue = [],
    pending = new Map();
  let next = 0;
  const workers = Array.from({ length: size }, () => {
    const worker = new Worker(new URL(import.meta.url));
    worker.on('message', ({ id, result }) => {
      pending.get(id).resolve(result);
      pending.delete(id);
      dispatch(worker);
    });
    worker.on('error', (error) => {
      for (const job of pending.values()) job.reject(error);
      pending.clear();
    });
    idle.push(worker);
    return worker;
  });
  function dispatch(worker) {
    const job = queue.shift();
    if (job) {
      worker.postMessage(job.message);
      return;
    }
    idle.push(worker);
  }
  return {
    run(kind, spec) {
      return new Promise((resolve, reject) => {
        const id = next++,
          message = { id, kind, spec };
        pending.set(id, { resolve, reject });
        const worker = idle.pop();
        if (worker) worker.postMessage(message);
        else queue.push({ message });
      });
    },
    close: () => Promise.all(workers.map((worker) => worker.terminate())),
  };
}

const memo = new Map();
let pool = null;
const submit = (kind, spec) => {
  const key = kind + JSON.stringify(spec);
  if (!memo.has(key)) memo.set(key, pool.run(kind, spec));
  return memo.get(key);
};

function defineTests() {
  pool = createPool(Math.max(2, Math.min(8, (os.availableParallelism?.() ?? 4) - 1)));
  // Queue the long runs in the order the tests will ask for them.
  for (const f of FIELDS)
    for (const mode of ['kb', 'ptr'])
      for (const hz of HZS)
        for (const seed of BOT_SEEDS) submit('bot', { field: f.n, hz, mode, seed });
  for (const policy of BLIND_POLICIES)
    for (let field = FIRST_BLIND_FIELD; field <= FIELD_COUNT; field++)
      for (const seed of BLIND_SEEDS) submit('blind', { policy, field, seed });
  after(() => pool.close());
  // ---------------------------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------------------------
  const hasRole = (f, role) => f.roster.some((e) => e.role === role);
  const countRole = (f, role) => f.roster.filter((e) => e.role === role).length;
  const steelTiles = (f) => f.tiles.filter((t) => t.steel);
  const brickCover = (f) => f.tiles.filter((t) => !t.steel && t.y < 250);
  const deepFrozen = (v) =>
    v === null ||
    typeof v !== 'object' ||
    (Object.isFrozen(v) && Object.values(v).every((child) => deepFrozen(child)));

  {
    for (const f of FIELDS)
      test(`field ${f.n} ${f.name.en}: the aiming bots clear it at 30, 60 and 120 Hz`, async () => {
        for (const mode of ['kb', 'ptr'])
          for (const hz of HZS)
            for (const seed of BOT_SEEDS) {
              const r = await submit('bot', { field: f.n, hz, mode, seed });
              assert.equal(
                r.cleared,
                true,
                `${mode} ${hz} Hz seed ${seed}: ${r.phase} at ${r.time}`,
              );
              assert.equal(r.unlocked, Math.min(FIELD_COUNT, f.n + 1));
              assert.equal(r.frozen, true);
              assert.equal(r.violations, 0, `${mode} ${hz} Hz seed ${seed} broke an invariant`);
              // Only the last field ends the run, with exactly one win callback.
              assert.equal(r.ends, f.n === FIELD_COUNT ? 1 : 0);
              assert.equal(r.won, f.n === FIELD_COUNT ? true : null);
            }
      });

    test('blind play never wins more than a quarter of any field from field 3', async () => {
      const rows = [];
      for (const policy of BLIND_POLICIES)
        for (let field = FIRST_BLIND_FIELD; field <= FIELD_COUNT; field++) {
          const runs = await Promise.all(
            BLIND_SEEDS.map((seed) => submit('blind', { policy, field, seed })),
          );
          rows.push({ policy, field, wins: runs.filter((r) => r.won).length });
        }
      assert.equal(rows.length, BLIND_POLICIES.length * (FIELD_COUNT - FIRST_BLIND_FIELD + 1));
      for (const row of rows)
        assert.ok(
          row.wins / BLIND_SEEDS.length <= BLIND_MAX_WIN_RATE,
          `${row.policy} won ${row.wins}/${BLIND_SEEDS.length} of field ${row.field}`,
        );
    });
    test('pointer sweeps, random taps and keyboard mash also lose the first two fields most of the time', async () => {
      let wins = 0,
        runs = 0;
      for (const policy of ['pointerSweep', 'pointerTaps', 'randomMash'])
        for (const field of [1, 2])
          for (const seed of BLIND_SEEDS) {
            const r = runBlind({ policy, field, seed });
            wins += r.won ? 1 : 0;
            runs++;
          }
      assert.equal(runs, 36);
      assert.ok(wins / runs <= 0.25, `${wins}/${runs}`);
    });
    test('English and Chinese play are identical in every number', async () => {
      for (const [field, mode] of [
        [1, 'kb'],
        [9, 'ptr'],
        [FIELD_COUNT, 'kb'],
      ]) {
        const en = runBot({ field, mode, lang: 'en' }),
          zh = runBot({ field, mode, lang: 'zh' });
        assert.equal(en.fingerprint, zh.fingerprint);
        assert.equal(en.cleared, true);
      }
    });
  }

  test('every frame rate follows exactly the same trajectory', () => {
    const script = (k) => [
      k < 45
        ? ['ArrowRight']
        : k < 75
          ? ['KeyX', 'ArrowLeft']
          : k < 150
            ? ['Space', 'ArrowUp']
            : k < 240
              ? ['Space', 'KeyX', k % 60 < 30 ? 'ArrowLeft' : 'ArrowRight']
              : ['Space'],
      k % 90 === 0 ? ['KeyH'] : [],
      k > 300 && k < 400 ? { x: 100 + (k % 50) * 6, y: 100, down: true } : {},
    ];
    for (const [field, seed] of [
      [1, 3],
      [8, 5],
      [FIELD_COUNT, 7],
    ]) {
      const runs = HZS.map((hz) => {
        const { game } = open(field, { seed }),
          snaps = [],
          step = hz / 30;
        for (let n = 0; n < hz * 14; n++) {
          const k = Math.floor(n / step),
            [held, pressed, pointer] = script(k);
          game.update(1 / hz, input(held, n % step === 0 ? pressed : [], pointer));
          if ((n + 1) % (hz * 2) === 0) snaps.push(JSON.stringify(game.getState()));
        }
        return snaps;
      });
      assert.equal(runs[0].length, 7);
      runs[0].forEach((snap, i) => {
        assert.equal(runs[1][i], snap, `field ${field} 60 Hz checkpoint ${i}`);
        assert.equal(runs[2][i], snap, `field ${field} 120 Hz checkpoint ${i}`);
      });
      const last = JSON.parse(runs[0][6]);
      assert.ok(last.player.rounds < fieldOf(field).ammo, 'the script really fired');
    }
  });

  test('odd frame times never break the simulation', () => {
    const { game } = open(1);
    const before = game.getState();
    for (const dt of [NaN, -1, -Infinity, Infinity, 0, undefined, null, 'x', 1e-9])
      game.update(dt, input(['ArrowRight', 'Space']));
    const same = game.getState();
    assert.equal(same.player.x, before.player.x);
    assert.ok(same.time <= 1e-9 + 0.01);
    const slice = game.getState().time;
    game.update(1e9, input(['ArrowRight']));
    game.update(Number.MAX_VALUE, input([]));
    const huge = game.getState();
    assert.ok(huge.time - slice <= 2 / 30 + 1e-9, 'a huge frame is clamped to 1/30 s');
    for (let n = 0; n < 600; n++) game.update(n % 7 === 0 ? 1 : 1 / 61, input(['Space']));
    const finite = (v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v));
      else if (v && typeof v === 'object') Object.values(v).forEach(finite);
    };
    finite(game.getState());
    game.draw(mockContext());
  });

  test('odd pointer values are ignored or aimed without a crash and never produce non-finite state', () => {
    const values = [
      NaN,
      Infinity,
      -Infinity,
      1e308,
      -1e308,
      -5,
      481,
      99999,
      undefined,
      null,
      '240',
    ];
    for (const x of values)
      for (const y of values) {
        const { game } = open(1),
          before = game.getState();
        for (let n = 0; n < 6; n++) game.update(1 / 60, input([], [], { x, y, down: true }));
        const s = game.getState();
        for (const v of [s.player.x, s.player.y, s.player.turret, s.player.vx, s.player.vy])
          assert.ok(Number.isFinite(v), `pointer ${x},${y}`);
        const outside = !(
          Number(x) >= 0 &&
          Number(x) <= 480 &&
          Number(y) >= 44 &&
          Number(y) <= 320
        );
        if (outside) {
          assert.equal(s.player.rounds, before.player.rounds, `ignored pointer ${x},${y}`);
          assert.equal(s.player.turret, before.player.turret);
        }
      }
    const { game } = open(1);
    game.update(1 / 60, { held: () => false, pressed: () => false, pointer: undefined });
    game.update(1 / 60, { held: () => false, pressed: () => false, pointer: { down: true } });
    assert.equal(game.getState().phase, 'playing');
  });

  test('a pointer on the tank centre leaves the turret alone instead of snapping it east', () => {
    const { game } = open(1);
    for (const offset of [0, 1, 3, AIM_DEAD_ZONE - 0.5]) {
      const s = game.getState();
      game.update(1 / 60, input([], [], { x: s.player.x + offset, y: s.player.y, down: true }));
    }
    const s = game.getState();
    assert.ok(Math.abs(s.player.turret - -Math.PI / 2) < 1e-9, 'turret still faces up');
    assert.ok(s.player.rounds < fieldOf(1).ammo, 'and the cannon fires along its own heading');
    const first = s.bullets[0] ?? { vx: 0 };
    assert.ok(Math.abs(first.vx) < 1);
    // A few pixels further out the turret does follow.
    const far = open(1).game;
    for (let n = 0; n < 40; n++) far.update(1 / 60, input([], [], { x: 266, y: 284, down: true }));
    assert.ok(Math.abs(far.getState().player.turret) < 0.1);
  });

  test('a pointer fires only once the turret has settled on it, and a press that started in the menu is ignored', () => {
    const { game } = open(1);
    game.update(1 / 60, input([], [], { x: 466, y: 284, down: true }));
    assert.equal(game.getState().player.rounds, fieldOf(1).ammo, 'turret still swinging round');
    for (let n = 0; n < 90; n++) game.update(1 / 60, input([], [], { x: 466, y: 284, down: true }));
    assert.ok(game.getState().player.rounds < fieldOf(1).ammo);
    const g = open(4, { start: false }).game;
    g.update(
      1 / 60,
      input([], [], { x: MENU.x + 3 * MENU.w + 10, y: MENU.y + 10, down: true, clicked: true }),
    );
    assert.equal(g.getState().field, 4);
    assert.equal(g.getState().menu, null);
    for (let n = 0; n < 60; n++) g.update(1 / 60, input([], [], { x: 400, y: 200, down: true }));
    assert.equal(g.getState().player.rounds, fieldOf(4).ammo, 'the held press is not a shot');
    assert.equal(g.getState().pointerHeld, true);
    g.update(1 / 60, input());
    assert.equal(g.getState().pointerHeld, false);
    for (let n = 0; n < 90; n++) g.update(1 / 60, input([], [], { x: 400, y: 200, down: true }));
    assert.ok(g.getState().player.rounds < fieldOf(4).ammo, 'a fresh press does shoot');
  });

  test('the magazine holds four shells and recharges slowly, so holding fire is not enough', () => {
    const { game } = open(1);
    const p0 = game.getState().player;
    assert.equal(p0.charge, MAGAZINE);
    for (let n = 0; n < 60; n++) game.update(1 / 60, input(['Space']));
    const one = game.getState().player;
    assert.ok(fieldOf(1).ammo - one.rounds <= 6, 'a second of held fire is a short burst');
    for (let n = 0; n < 600; n++) game.update(1 / 60, input(['Space']));
    const ten = game.getState();
    assert.ok(
      fieldOf(1).ammo - ten.player.rounds <= 22,
      'ten seconds cannot empty the stock freely',
    );
  });

  test('seeded variety: lanes and timing change with the seed and repeat for the same seed', () => {
    const firstArrival = (seed) => {
      const h = harness({ seed: seed * 104729 }),
        s = createBastionState(5),
        log = [];
      s.player.x = 400;
      s.player.y = 280;
      let t = 0;
      while (s.enemies.length < 3 && t < 40) {
        stepBastion(s, 1 / 60, input(), h.env);
        t += 1 / 60;
        for (const e of s.enemies)
          if (!log.some((l) => l.id === e.id))
            log.push({ id: e.id, x: Math.round(e.x), t: Math.round(t * 20) });
      }
      return JSON.stringify(log);
    };
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(firstArrival);
    assert.equal(firstArrival(3), runs[2], 'deterministic for a seed');
    assert.ok(new Set(runs).size >= 8, 'different seeds give different arrivals');
    const lanes = new Set(runs.map((r) => JSON.parse(r)[0].x));
    assert.ok(lanes.size >= 3, `first-arrival lanes vary: ${[...lanes]}`);
    const times = new Set(runs.map((r) => JSON.parse(r)[1].t));
    assert.ok(times.size >= 4, 'arrival gaps vary');
  });

  test('scouts really weave, gunners really halt and fire at the beacon, raiders hunt a close tank', () => {
    const h = harness({ seed: 3 }),
      s = createBastionState(5);
    s.player.x = 400;
    s.player.y = 280;
    s.toSpawn = 1;
    s.enemies = [];
    s.spawned = 0;
    s.spawnClock = 0;
    const signs = new Set();
    for (let n = 0; n < 60 * 30 && s.phase === 'playing'; n++) {
      stepBastion(s, 1 / 60, input(), h.env);
      for (const e of s.enemies) signs.add(e.jink);
    }
    assert.equal(signs.size, 2, 'the scout flips its weave direction');
    const g = createBastionState(2);
    g.player.x = 400;
    g.player.y = 280;
    g.tiles = [];
    g.spawned = g.toSpawn;
    g.enemies = [
      {
        ...createBastionState(1).player,
        id: 'enemy:2:0',
        role: 'gunner',
        hp: 1,
        x: 240,
        y: 100,
        mass: 100,
        rounds: 120,
        cooldown: 0,
        charge: 0,
        aim: 0,
        think: 0,
        jink: 1,
        jinkTime: 0,
        angle: Math.PI / 2,
        bearing: Math.PI / 2,
        turret: Math.PI / 2,
      },
    ];
    for (let n = 0; n < 60 * 4; n++) stepBastion(g, 1 / 60, input(), harness().env);
    const gunner = g.enemies[0] ?? { x: 240, y: 100, vx: 0, vy: 0 };
    assert.ok(Math.hypot(gunner.vx, gunner.vy) < 3, 'halted at range');
    assert.ok(g.bullets.length > 0 || g.baseHealth < 5, 'and shelled the beacon');
    assert.ok(
      ROLES.raider.chase && !ROLES.gunner.chase && !ROLES.heavy.chase && !ROLES.scout.chase,
    );
  });

  test('every third wreck drops a repair kit that a driver can collect', () => {
    const s = createBastionState(1),
      h = harness();
    s.tiles = [];
    s.player.x = 100;
    s.player.y = 200;
    s.spawnClock = 999;
    s.kits = 0;
    for (let k = 0; k < 3; k++) {
      s.enemies = [
        {
          ...s.player,
          id: `e${k}`,
          role: 'raider',
          hp: 1,
          x: 240,
          y: 100,
          cooldown: 99,
          charge: 0,
          aim: 0,
          think: 99,
          jink: 1,
          jinkTime: 99,
        },
      ];
      s.bullets = [
        {
          id: `s${k}`,
          x: 200,
          y: 100,
          vx: 900,
          vy: 0,
          r: 2,
          mass: 0.02,
          owner: 'player',
          shooter: 'player',
          life: 2,
        },
      ];
      stepShells(s, 0.1, h.env);
    }
    assert.equal(s.defeated, 3);
    assert.equal(s.pickups.length, 1);
    assert.equal(s.score, 300);
  });

  test('heavy and armored tanks need exactly their hit points', () => {
    assert.equal(ROLES.heavy.hp, 2);
    assert.ok(FIELDS.some((f) => f.roster.some((e) => e.role === 'heavy' && e.hp === 3)));
    const s = createBastionState(11),
      h = harness();
    s.tiles = [];
    s.player.x = 100;
    s.player.y = 200;
    s.enemies = [{ ...s.player, id: 'e', role: 'heavy', hp: 3, x: 240, y: 100, mass: 130 }];
    for (let k = 1; k <= 3; k++) {
      s.bullets = [
        {
          id: `s${k}`,
          x: 200,
          y: 100,
          vx: 900,
          vy: 0,
          r: 2,
          mass: 0.02,
          owner: 'player',
          shooter: 'player',
          life: 2,
        },
      ];
      stepShells(s, 0.1, h.env);
      assert.equal(s.enemies.length, k < 3 ? 1 : 0, `after hit ${k}`);
    }
  });

  test('the exported data is deeply frozen and cannot be changed by the game or by callers', () => {
    for (const data of [BASE, BEACON, ARENA, LANES, PLAYER_START, ROLES, THEMES, FIELDS, meta])
      assert.equal(deepFrozen(data), true);
    assert.throws(() => {
      BASE.x = 1;
    }, TypeError);
    assert.throws(() => {
      FIELDS[0].roster[0].lane = 4;
    }, TypeError);
    assert.throws(() => {
      meta.touchControls.push({});
    }, TypeError);
    assert.throws(() => {
      meta.name.en = 'x';
    }, TypeError);
    assert.throws(() => {
      ROLES.raider.hp = 9;
    }, TypeError);
    const s = createBastionState(3);
    s.tiles[0].hp = 0;
    assert.notEqual(fieldOf(3).tiles[0].hp, 0);
    assert.equal(BASE.x, 225);
  });

  test('no dead code is left in the public surface or the state', async () => {
    const game = await import('../src/games/iron-bastion.js'),
      physics = await import('../src/games/iron-bastion-physics.js'),
      s = createBastionState(1);
    assert.equal('bulletHitsTile' in game, false);
    assert.equal('bulletHitsTile' in physics, false);
    assert.equal('interceptions' in s, false);
    assert.equal('engineerCrates' in s, false);
    s.player.turret = 0;
    s.tiles = [];
    stepBastion(s, 1 / 60, input(['Space']), harness().env);
    assert.ok(s.bullets.length > 0);
    assert.ok(s.bullets.every((b) => !('armed' in b)));
  });

  test('the field table: distinct, well formed and a real teaching curve', () => {
    assert.ok(FIELD_COUNT >= 20);
    assert.equal(FIELDS.length, FIELD_COUNT);
    assert.equal(new Set(FIELDS.map((f) => f.name.en)).size, FIELD_COUNT);
    assert.equal(new Set(FIELDS.map((f) => f.name.zh)).size, FIELD_COUNT);
    assert.equal(new Set(FIELDS.map((f) => f.tip.en)).size, FIELD_COUNT);
    assert.equal(new Set(FIELDS.map((f) => f.tip.zh)).size, FIELD_COUNT);
    assert.equal(
      new Set(FIELDS.map((f) => f.tiles.map((t) => `${t.x},${t.y},${t.steel}`).join(';'))).size,
      FIELD_COUNT,
      'no two fields share a cover layout',
    );
    assert.equal(
      new Set(FIELDS.map((f) => f.roster.map((e) => `${e.role}${e.lane}${e.hp}`).join(' '))).size,
      FIELD_COUNT,
      'no two fields share a roster',
    );
    FIELDS.forEach((f, i) => {
      assert.equal(f.n, i + 1);
      assert.ok(THEMES[f.theme]);
      assert.ok(f.roster.length >= 4 && f.roster.length <= 15);
      assert.ok(f.ammo > f.hp * 2.9, `field ${f.n} leaves a human room to miss`);
      assert.ok(f.ammo < f.hp * 7.3);
      assert.ok(f.live >= 2 && f.live <= 4);
      assert.ok(f.rate > 0 && f.speed > 0 && f.gap > 1);
      assert.ok(fieldOf(f.n) === f);
    });
    // Teaching: one idea at a time, in order.
    assert.deepEqual([...new Set(FIELDS[0].roster.map((e) => e.role))], ['raider']);
    assert.equal(hasRole(FIELDS[1], 'gunner'), true);
    assert.equal(steelTiles(FIELDS[2]).length > 0 && brickCover(FIELDS[2]).length > 0, true);
    assert.equal(hasRole(FIELDS[3], 'heavy'), true);
    assert.equal(hasRole(FIELDS[4], 'scout'), true);
    assert.equal(steelTiles(FIELDS[0]).length + steelTiles(FIELDS[1]).length, 0);
    assert.equal(hasRole(FIELDS[0], 'heavy') || hasRole(FIELDS[1], 'scout'), false);
    // Combination then mastery: more tanks, more armor, less spare ammunition.
    const mean = (a, b, key) => FIELDS.slice(a, b).reduce((sum, f) => sum + key(f), 0) / (b - a);
    const hp = [0, 6, 12, 18, 24]
        .map((from, i, all) => (i ? mean(all[i - 1], from, (f) => f.hp) : 0))
        .slice(1),
      spare = [0, 6, 12, 18, 24]
        .map((from, i, all) => (i ? mean(all[i - 1], from, (f) => f.ammo / f.hp) : 0))
        .slice(1);
    hp.forEach((v, i) => i && assert.ok(v > hp[i - 1], `hit points rise in block ${i + 1}`));
    spare.forEach(
      (v, i) => i && assert.ok(v < spare[i - 1], `spare ammunition falls in block ${i + 1}`),
    );
    assert.ok(
      FIELDS.slice(6).every(
        (f) => ['raider', 'gunner', 'heavy', 'scout'].filter((r) => hasRole(f, r)).length >= 3,
      ),
    );
    assert.ok(FIELDS.slice(10).some((f) => f.roster.some((e) => e.hp === 3)));
    assert.ok(FIELDS.slice(15).every((f) => f.hp >= 11));
    assert.equal(new Set(FIELDS.map((f) => f.theme)).size, THEMES.length);
  });

  test('field tips are accurate for the field they describe, in both languages', () => {
    const claims = [
      [/gunner/i, /炮手/, (f) => hasRole(f, 'gunner')],
      [/heav/i, /重型/, (f) => hasRole(f, 'heavy')],
      [/scout/i, /侦察/, (f) => hasRole(f, 'scout')],
      [/raider/i, /突袭/, (f) => hasRole(f, 'raider')],
      [/steel/i, /钢/, (f) => steelTiles(f).length > 0],
      [/brick/i, /砖/, (f) => brickCover(f).length > 0],
      [/three hits/i, /三发/, (f) => f.roster.some((e) => e.hp === 3)],
      [/two hits/i, /两发/, (f) => brickCover(f).length > 0 || hasRole(f, 'heavy')],
      [/four gunners/i, /四辆炮手/, (f) => countRole(f, 'gunner') === 4],
      [/three heavies/i, /三辆重型/, (f) => countRole(f, 'heavy') === 3],
      [/both edges|opposite/i, /两侧/, (f) => f.roster[0].lane === 0 && f.roster[1].lane === 4],
      [/three lanes/i, /三条路/, (f) => steelTiles(f).filter((t) => t.y === 124).length === 8],
      [/open ground/i, /开阔/, (f) => brickCover(f).length <= 4],
      [/dense brick/i, /密集砖墙/, (f) => brickCover(f).length >= 12],
      [
        /heavies lead, scouts flank/i,
        /重型车领头/,
        (f) =>
          f.roster[0].role === 'heavy' &&
          f.roster[1].role === 'heavy' &&
          f.roster.some((e) => e.role === 'scout' && e.lane === 0),
      ],
      [
        /fast scouts and slow heavies/i,
        /快速侦察车与慢速重型车/,
        (f) => ROLES.scout.speed > ROLES.heavy.speed && hasRole(f, 'scout') && hasRole(f, 'heavy'),
      ],
      [
        /every kind of tank/i,
        /所有车型/,
        (f) => ['raider', 'gunner', 'heavy', 'scout'].every((r) => hasRole(f, r)),
      ],
      [/last field/i, /最后一战/, (f) => f.n === FIELD_COUNT],
      [/arches/i, /钢拱/, (f) => steelTiles(f).length >= 6],
      [/steer/i, /引路/, (f) => steelTiles(f).length >= 10],
    ];
    const seen = new Set();
    for (const f of FIELDS)
      claims.forEach(([en, zh, holds], i) => {
        assert.equal(
          en.test(f.tip.en),
          zh.test(f.tip.zh),
          `field ${f.n}: EN/ZH tips make the same claim #${i}`,
        );
        if (en.test(f.tip.en)) {
          seen.add(i);
          assert.equal(holds(f), true, `field ${f.n} "${f.tip.en}" claim #${i}`);
        }
      });
    assert.equal(seen.size, claims.length, 'every checked claim is actually used by some tip');
    // Mechanic claims.
    assert.match(fieldOf(1).tip.en, /Hold X.*Left\/Right.*Space/);
    assert.match(fieldOf(6).tip.en, /third kill/);
    assert.match(fieldOf(10).tip.en, /shot down/);
    assert.match(fieldOf(5).tip.en, /weave/);
    assert.match(fieldOf(2).tip.en, /halt/);
    assert.match(fieldOf(8).tip.en, /chase/);
    assert.match(fieldOf(9).tip.en, /Break a brick gap/);
  });

  // Pressure never eases from field 13 on, and the last three fields are the hardest.
  test('pressure never eases from field 13 and peaks on the last three fields', () => {
    const late = FIELDS.slice(12);
    for (let i = 1; i < late.length; i++) {
      const prev = late[i - 1],
        f = late[i];
      assert.ok(f.speed >= prev.speed, `field ${f.n} is slower than field ${prev.n}`);
      assert.ok(f.rate <= prev.rate, `field ${f.n} reloads slower than field ${prev.n}`);
      assert.ok(f.gap <= prev.gap, `field ${f.n} lets enemies arrive later than ${prev.n}`);
    }
    const peak = late.at(-1);
    for (const f of FIELDS.slice(-3)) {
      assert.equal(f.speed, peak.speed);
      assert.equal(f.rate, peak.rate);
      assert.equal(f.gap, peak.gap);
    }
  });

  // Cover skipped because the tank stood on its slot comes back once the tank has left.
  test('skipped cover is rebuilt once the tank leaves, never under it', () => {
    const h = harness(),
      s = createBastionState(1);
    s.player.x = 119;
    s.player.y = 147;
    s.enemies = [];
    s.spawned = s.toSpawn;
    s.clearing = true;
    s.bullets = [];
    s.transition = 1e-6;
    stepBastion(s, 1 / 120, input(), h.env);
    assert.equal(s.field, 2);
    const skipped = s.constructionSkipped.length,
      full = fieldOf(2).tiles.length;
    assert.ok(skipped > 0);
    assert.equal(s.tiles.length + skipped, full);
    // While the tank stays put the slots stay empty.
    for (let k = 0; k < 20; k++) stepBastion(s, 1 / 120, input(['KeyX']), h.env);
    assert.equal(s.constructionSkipped.length, skipped);
    assert.equal(s.tiles.length + skipped, full);
    // Once it drives away every tile returns, none of them under the tank.
    s.player.x = 240;
    s.player.y = 230;
    s.player.vx = 0;
    s.player.vy = 0;
    for (let k = 0; k < 4; k++) {
      stepBastion(s, 1 / 120, input(['KeyX']), h.env);
      assert.ok(s.tiles.every((t) => !circleHitsRect(s.player.x, s.player.y, 12, t)));
    }
    assert.equal(s.constructionSkipped.length, 0);
    assert.deepEqual(
      s.tiles.map((t) => t.id).sort(),
      fieldOf(2)
        .tiles.map((t) => t.id)
        .sort(),
    );
  });

  // The teaching fields give a player time to read the tip before the first hit lands.
  test('an idle tank survives the opening of the teaching fields', () => {
    const MIN_SURVIVAL = { 1: 28, 2: 22 };
    for (const [field, minimum] of Object.entries(MIN_SURVIVAL))
      for (const seed of [1, 2, 3, 4, 5]) {
        const { game } = open(Number(field), { seed });
        let state = game.getState();
        for (let n = 0; n < 60 * 120 && state.phase === 'playing'; n++) {
          game.update(1 / 60, input());
          state = game.getState();
        }
        assert.equal(state.phase, 'lost', `field ${field} seed ${seed} ends`);
        assert.ok(
          state.time >= minimum,
          `field ${field} seed ${seed}: idle tank lost at ${state.time.toFixed(1)} s`,
        );
      }
  });

  // A cover layout must leave one connected stretch of road for a tank and never shield the spawn
  // row, the beacon front or the starting position.
  test('every cover layout is well formed and one connected battlefield', () => {
    const FILL = 3,
      SPAWN_ROW = 60,
      MIN_FRONT_CELLS = 150,
      MAX_STRANDED = 25;
    for (const f of FIELDS) {
      const tiles = coverFor(f.n),
        s = { tiles };
      for (const t of tiles) {
        assert.ok(
          t.x >= ARENA.left &&
            t.x + t.w <= ARENA.right &&
            t.y >= ARENA.top &&
            t.y + t.h <= ARENA.bottom,
          `field ${f.n} tile inside the arena`,
        );
        assert.ok(t.y > 90, 'nothing blocks the spawn row');
        assert.equal(
          circleHitsRect(PLAYER_START.x, PLAYER_START.y, 12, t),
          false,
          `field ${f.n} start is clear`,
        );
      }
      tiles.forEach((a, i) =>
        tiles.slice(i + 1).forEach((b) => {
          assert.ok(
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
            `field ${f.n} tiles ${a.id} ${b.id} overlap`,
          );
        }),
      );
      // Flood-fill the road at 3 px resolution, moving to all eight neighbours.
      const seen = new Set(),
        key = (x, y) => `${x},${y}`,
        queue = [[Math.round(PLAYER_START.x / FILL), Math.round(PLAYER_START.y / FILL)]],
        steps = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [dx, dy]));
      seen.add(key(...queue[0]));
      for (let k = 0; k < queue.length; k++) {
        const [x, y] = queue[k];
        for (const [dx, dy] of steps) {
          const nx = x + dx,
            ny = y + dy;
          if (!seen.has(key(nx, ny)) && bodyFree(s, nx * FILL, ny * FILL)) {
            seen.add(key(nx, ny));
            queue.push([nx, ny]);
          }
        }
      }
      for (const lane of LANES)
        assert.ok(
          seen.has(key(Math.round(lane / FILL), Math.round(SPAWN_ROW / FILL))),
          `field ${f.n} lane ${lane} reaches the start`,
        );
      const frontCells = queue.filter(
        ([gx, gy]) => Math.abs(gx * FILL - BEACON.x) <= 60 && gy * FILL >= 200 && gy * FILL <= 262,
      ).length;
      assert.ok(frontCells >= MIN_FRONT_CELLS, `field ${f.n} beacon front has ${frontCells} cells`);
      // Every pocket a tank could not leave is tiny.
      let stranded = 0;
      for (let x = Math.ceil(ARENA.minX / FILL); x * FILL <= ARENA.maxX; x++)
        for (let y = Math.ceil(ARENA.minY / FILL); y * FILL <= ARENA.maxY; y++)
          if (bodyFree(s, x * FILL, y * FILL) && !seen.has(key(x, y))) stranded++;
      assert.ok(stranded <= MAX_STRANDED, `field ${f.n} has ${stranded} stranded samples`);
    }
  });

  // Engineers rebuild cover while the tank stands somewhere on the old field. Wherever it stands,
  // it must be free of the new cover and still able to reach the spawn row.
  test('construction between fields never walls the tank in', () => {
    const h = harness(),
      GRID = 4; // fine enough to see a lane only a few pixels wider than the tank
    let positions = 0;
    for (let n = 1; n < FIELD_COUNT; n++)
      for (let x = 20; x <= 460; x += 44)
        for (let y = 56; y <= 300; y += 40) {
          const s = createBastionState(n);
          s.player.x = x;
          s.player.y = y;
          if (!bodyFree(s, x, y)) continue;
          s.enemies = [];
          s.spawned = s.toSpawn;
          s.clearing = true;
          s.bullets = [];
          s.transition = 1e-6;
          stepBastion(s, 1 / 60, input(), h.env);
          assert.equal(s.field, n + 1, `field ${n} advanced from ${x},${y}`);
          positions++;
          const p = s.player;
          assert.ok(
            s.tiles.every((t) => !circleHitsRect(p.x, p.y, 12, t)),
            `embedded at ${x},${y} entering field ${n + 1}`,
          );
          const seen = new Set([`${Math.round(p.x / GRID)},${Math.round(p.y / GRID)}`]),
            queue = [[Math.round(p.x / GRID), Math.round(p.y / GRID)]];
          let top = false;
          for (let k = 0; k < queue.length && !top; k++) {
            const [gx, gy] = queue[k];
            if (gy * GRID <= 80) top = true;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const key = `${gx + dx},${gy + dy}`;
              if (!seen.has(key) && bodyFree(s, (gx + dx) * GRID, (gy + dy) * GRID)) {
                seen.add(key);
                queue.push([gx + dx, gy + dy]);
              }
            }
          }
          assert.equal(top, true, `enclosed at ${x},${y} entering field ${n + 1}`);
        }
    assert.ok(positions > 1000);
  });

  test('level select: continue, choose, locked cells, keys and taps', () => {
    const { game, store } = open(5, { start: false });
    let s = game.getState();
    assert.equal(s.menu.unlocked, 5);
    assert.equal(s.menu.cursor, 5);
    assert.match(s.status.en, /choose a field/);
    assert.match(s.status.zh, /选择战场/);
    game.update(1 / 60, input([], ['ArrowLeft']));
    assert.equal(game.getState().menu.cursor, 4);
    game.update(1 / 60, input([], ['KeyA']));
    assert.equal(game.getState().menu.cursor, 3);
    game.update(1 / 60, input([], ['ArrowUp']));
    assert.equal(game.getState().menu.cursor, 1, 'up a row clamps at the first field');
    for (let n = 0; n < 9; n++) game.update(1 / 60, input([], ['ArrowRight']));
    assert.equal(game.getState().menu.cursor, 5, 'never past the open fields');
    game.update(1 / 60, input([], ['ArrowDown']));
    assert.equal(game.getState().menu.cursor, 5);
    game.update(1 / 60, input([], ['KeyD']));
    game.update(1 / 60, input([], ['KeyW']));
    game.update(1 / 60, input([], ['KeyS']));
    game.update(1 / 60, input([], ['ArrowLeft']));
    game.update(1 / 60, input([], ['ArrowLeft']));
    assert.equal(game.getState().menu.cursor, 3);
    // A locked cell only explains itself.
    game.update(
      1 / 60,
      input([], [], { x: MENU.x + 4 * MENU.w + 5, y: MENU.y + MENU.h + 5, clicked: true }),
    );
    s = game.getState();
    assert.equal(s.menu.locked, 5);
    assert.equal(s.field, 1);
    game.draw(mockContext());
    createGame(harness({ lang: 'zh' }).env).draw(mockContext());
    // Confirm with each start key.
    for (const key of ['Space', 'Enter', 'NumpadEnter']) {
      const { game: g } = open(3, { start: false });
      g.update(1 / 60, input([], [key]));
      const t = g.getState();
      assert.equal(t.menu, null, key);
      assert.equal(t.field, 3);
      assert.equal(t.player.rounds, fieldOf(3).ammo);
      assert.equal(t.lives, 4);
      assert.equal(t.baseHealth, 5);
    }
    // Tap a cell.
    const tapped = open(8, { start: false }).game;
    tapped.update(
      1 / 60,
      input([], [], { x: MENU.x + 2 * MENU.w + 8, y: MENU.y + 8, clicked: true }),
    );
    assert.equal(tapped.getState().field, 3);
    assert.equal(store.value, 5);
    assert.equal(menuCellAt(-1, -1), 0);
    assert.equal(menuCellAt(MENU.x + 7 * MENU.w, MENU.y), 0);
    assert.equal(menuCellAt(MENU.x, MENU.y + 4 * MENU.h), 0);
    assert.equal(menuCellAt(MENU.x + MENU.w * 6 - 1, MENU.y + MENU.h * 4 - 1), FIELD_COUNT);
    // Time does not run in the menu, and a loss restarts at the menu with progress kept.
    const waiting = open(6, { start: false }).game;
    for (let n = 0; n < 120; n++) waiting.update(1 / 60, input());
    assert.equal(waiting.getState().time, 0);
    assert.equal(waiting.getState().enemies.length, 0);
  });

  test('a fresh profile starts straight on field 1 with no menu', () => {
    const h = harness();
    h.env.progress = { unlocked: () => 1, unlock() {} };
    const s = createGame(h.env).getState();
    assert.equal(s.menu, null);
    assert.equal(s.field, 1);
    assert.match(s.status.en, /Courtyard 1\/24/);
  });

  test('a broken or hostile progress store never stops the game', () => {
    const stores = [
      undefined,
      null,
      {},
      { unlocked: () => NaN, unlock() {} },
      { unlocked: () => 'abc', unlock() {} },
      { unlocked: () => undefined, unlock() {} },
      { unlocked: () => -3, unlock() {} },
      { unlocked: () => 0, unlock() {} },
      { unlocked: () => Infinity, unlock() {} },
      {
        unlocked: () => {
          throw new Error('storage disabled');
        },
        unlock() {
          throw new Error('quota exceeded');
        },
      },
      { unlocked: () => 2, unlock: undefined },
    ];
    for (const progress of stores) {
      const h = harness();
      h.env.progress = progress;
      const game = createGame(h.env),
        s = game.getState();
      assert.ok(s.field >= 1 && s.field <= FIELD_COUNT);
      if (s.menu) assert.ok(s.menu.unlocked >= 1 && s.menu.unlocked <= FIELD_COUNT);
      // Clear field 1 with the store failing at the moment progress would be saved.
      game.update(1 / 60, input([], ['Space']));
      const t = game.getState();
      t.menu === null || assert.fail('the first press confirms the menu');
      game.draw(mockContext());
    }
    // The write that fails is the one at clearing a field.
    const h = harness();
    let writes = 0;
    h.env.progress = {
      unlocked: () => 1,
      unlock: () => {
        writes++;
        throw new Error('quota exceeded');
      },
    };
    const game = createGame(h.env),
      s = game.getState();
    assert.equal(s.menu, null);
    const r = runBotWith(game, h);
    assert.equal(r.cleared, true);
    assert.ok(writes >= 1);
    assert.equal(game.getState().phase, 'playing');
    assert.equal(h.ends.length, 0);
  });

  // Clear field 1 in this thread through an already built game (used for the broken-store test).
  function runBotWith(game, h) {
    const history = [];
    for (let n = 0; n < 60 * FIELD_SECONDS; n++) {
      const state = game.getState();
      if (state.field !== 1 || state.phase !== 'playing') return { cleared: state.field > 1 };
      history.push(state);
      const seen = history[Math.max(0, history.length - 1 - 12)],
        p = state.player,
        plan = state.transition > 0 || state.clearing ? null : chooseTarget(seen, state, 0.2),
        held = ['KeyX'];
      if (plan && !plan.hard) {
        const stop = p.turret + (p.turretOmega * Math.abs(p.turretOmega)) / 48,
          err = wrap(plan.aim - stop);
        if (err > 0.02) held.push('ArrowRight');
        else if (err < -0.02) held.push('ArrowLeft');
        if (
          Math.abs(wrap(plan.aim - p.turret)) < 0.04 &&
          p.charge >= 1 &&
          inFlightAt(state, plan.e, 0.2) < plan.e.hp
        )
          held.push('Space');
      }
      game.update(1 / 60, input(held));
    }
    assert.ok(h);
    return { cleared: false };
  }

  test('progress is written when a field is cleared and the next field follows automatically', () => {
    const r = runBot({ field: 1 });
    assert.equal(r.cleared, true);
    assert.equal(r.unlocked, 2);
    const { game, store } = open(3);
    assert.equal(store.value, 3);
    game.update(1 / 60, input([], ['Space']));
    assert.equal(game.getState().field, 3);
  });

  test('terminal states: exactly one result, a frozen state and a faithful callback', () => {
    for (const hz of HZS) {
      const h = harness();
      let seen = null;
      const game = createGame(h.env);
      h.env.end = (r) => {
        h.ends.push(r);
        seen = structuredClone(game.getState());
      };
      for (let n = 0; n < hz * 200 && game.getState().phase === 'playing'; n++)
        game.update(1 / hz, input());
      const final = game.getState();
      assert.equal(final.phase, 'lost');
      assert.equal(h.ends.length, 1);
      assert.equal(h.ends[0].won, false);
      assert.equal(h.ends[0].score, final.score);
      assert.match(h.ends[0].message, /field 1/);
      assert.deepEqual(final, seen);
      for (let n = 0; n < 50; n++) game.update(1 / hz, input(['Space', 'ArrowUp'], ['KeyH']));
      assert.deepEqual(game.getState(), final);
      assert.equal(h.ends.length, 1);
      game.draw(mockContext());
    }
    // The three ways to lose, in both languages.
    const enemyShell = (x, y, vy) => ({
      id: 'x',
      x,
      y,
      vx: 0,
      vy,
      r: 2,
      mass: 0.02,
      owner: 'enemy',
      shooter: 'z',
      life: 2,
    });
    const cases = [
      [
        (s) => {
          s.baseHealth = 1;
          s.bullets = [enemyShell(240, 262, 900)];
        },
        /beacon fell on field 7/,
        /信标在第7战场被摧毁/,
      ],
      [
        (s) => {
          s.player.rounds = 0;
        },
        /Out of rounds on field 7/,
        /第7战场弹药耗尽/,
      ],
      [
        (s) => {
          s.lives = 1;
          s.bullets = [enemyShell(100, 170, 900)];
        },
        /armor gone on field 7/,
        /第7战场装甲耗尽/,
      ],
    ];
    for (const [setup, pattern, patternZh] of cases)
      for (const lang of ['en', 'zh']) {
        const h = harness({ lang }),
          s = createBastionState(7);
        s.tiles = [];
        s.spawnClock = 999;
        s.player.x = 100;
        s.player.y = 200;
        setup(s);
        stepBastion(s, 1 / 30, input(), h.env);
        assert.equal(s.phase, 'lost');
        assert.equal(h.ends.length, 1);
        assert.match(h.ends[0].message, lang === 'en' ? pattern : patternZh);
      }
  });

  test('the last field ends the run with one win and the score includes the beacon bonus', () => {
    const r = runBot({ field: FIELD_COUNT, mode: 'kb' });
    assert.equal(r.cleared, true);
    assert.equal(r.won, true);
    assert.equal(r.ends, 1);
    assert.equal(r.frozen, true);
    assert.equal(r.unlocked, FIELD_COUNT);
    assert.ok(JSON.parse(r.endState).score >= 100);
  });

  // ---------------------------------------------------------------------------------------------
  // Text: every string fits the 480 px canvas in both languages and the HUD never overlaps.
  // ---------------------------------------------------------------------------------------------
  function recorder() {
    const texts = [],
      props = { font: 'bold 10px monospace', textAlign: 'left' };
    const ctx = new Proxy(props, {
      get(target, key) {
        if (key === 'fillText')
          return (text, x, y) => {
            const size = Number(/(\d+)px/.exec(target.font)[1]),
              width = [...String(text)].reduce(
                (sum, ch) => sum + (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.62),
                0,
              ),
              left =
                target.textAlign === 'center'
                  ? x - width / 2
                  : target.textAlign === 'right'
                    ? x - width
                    : x;
            texts.push({ text: String(text), left, right: left + width, y, size });
          };
        if (key === 'measureText') return (t) => ({ width: String(t).length * 7 });
        return key in target ? target[key] : () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    return { ctx, texts };
  }

  test('every string fits the canvas and the HUD row never overlaps, in English and Chinese', () => {
    for (const lang of ['en', 'zh'])
      for (const f of FIELDS) {
        const h = harness({ lang });
        for (const variant of ['toast', 'idle', 'clearing', 'transition']) {
          const s = createBastionState(f.n);
          s.player.rounds = fieldOf(f.n).ammo;
          s.kits = 3;
          s.toast.time = variant === 'toast' ? 3 : 0;
          s.clearing = variant === 'clearing';
          s.transition = variant === 'transition' ? 1 : 0;
          if (f.n === FIELD_COUNT) s.transition = 0;
          const { ctx, texts } = recorder();
          drawBastion(ctx, s, h.env);
          assert.ok(texts.length >= 6);
          for (const t of texts)
            assert.ok(
              t.left >= 0 && t.right <= 480,
              `${lang} field ${f.n} ${variant}: "${t.text}" ${t.left.toFixed(0)}-${t.right.toFixed(0)}`,
            );
          const hud = texts.filter((t) => t.y < 44).sort((a, b) => a.y - b.y || a.left - b.left);
          hud.forEach((t, i) => {
            const next = hud[i + 1];
            if (next && next.y === t.y)
              assert.ok(
                t.right + 2 <= next.left,
                `${lang} field ${f.n} HUD "${t.text}" overlaps "${next.text}"`,
              );
          });
          assert.ok(hud.every((t) => t.right <= 478));
        }
        const menuState = createBastionState(1);
        menuState.menu = { cursor: f.n, unlocked: FIELD_COUNT, locked: 0 };
        const { ctx, texts } = recorder();
        drawMenu(ctx, menuState, h.env);
        for (const t of texts)
          assert.ok(t.left >= 0 && t.right <= 480, `${lang} menu field ${f.n}: "${t.text}"`);
        assert.ok(texts.some((t) => t.text.includes(lang === 'en' ? f.tip.en : f.tip.zh)));
      }
  });

  test('every theme, role, shell, particle and overlay draws', () => {
    for (const lang of ['en', 'zh'])
      for (const f of FIELDS) {
        const h = harness({ lang }),
          s = createBastionState(f.n);
        const base = {
          ...s.player,
          mass: 100,
          rounds: 99,
          cooldown: 0,
          think: 0,
          aim: 0.3,
          jink: 1,
          jinkTime: 1,
        };
        s.enemies = ['raider', 'gunner', 'heavy', 'scout'].map((role, i) => ({
          ...base,
          id: `e${i}`,
          role,
          hp: 1 + i,
          x: 90 + i * 90,
          y: 110,
          charge: i % 2 ? 0.3 : 0,
          flash: i === 2 ? 0.2 : 0,
          muzzle: i === 3 ? 0.05 : 0,
          vx: 20,
          vy: 10,
        }));
        s.player.flash = 0.2;
        s.player.muzzle = 0.05;
        s.player.charge = 2.5;
        s.player.vx = 30;
        s.bullets = [
          {
            id: 'a',
            x: 200,
            y: 150,
            vx: 0,
            vy: 100,
            r: 2,
            mass: 0.02,
            owner: 'player',
            shooter: 'player',
            life: 1,
          },
          {
            id: 'b',
            x: 220,
            y: 150,
            vx: 0,
            vy: 100,
            r: 2,
            mass: 0.02,
            owner: 'enemy',
            shooter: 'e0',
            life: 1,
          },
        ];
        s.pickups = [{ id: 'k', x: 300, y: 200, kind: 'kit' }];
        s.rubble = [{ x: 150, y: 150 }];
        s.constructionSkipped = [{ x: 150, y: 190, w: 22, h: 22 }];
        s.pendingSpawn = { x: 240, y: 60, warning: 0.5, role: 'raider', hp: 1 };
        s.particles = ['intercept', 'steel', 'brick', 'hurt', 'tank'].map((kind, i) => ({
          x: 100 + i * 30,
          y: 250,
          vx: 0,
          vy: 0,
          life: 0.2,
          kind,
        }));
        s.tiles.forEach((t, i) => i % 5 === 0 && !t.steel && (t.hp = 1));
        s.baseHealth = 1;
        s.time = 0.4;
        s.toast = { en: 'Kit used', zh: '使用维修包', time: 1 };
        const ctx = mockContext();
        drawBastion(ctx, s, h.env);
        s.transition = 1;
        drawBastion(ctx, s, h.env);
      }
  });
}

if (isMainThread) defineTests();
