import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRiverState,
  stepRiver,
  meta,
  riverLanes,
} from '../src/games/river-hop.js';
import { drawRiver } from '../src/games/river-hop-draw.js';
import { LEVELS, LEVEL_COUNT, LANE_ROWS, clampLevel } from '../src/games/river-hop-levels.js';
import { MENU_COLUMNS, menuCell, menuTarget } from '../src/games/river-hop-menu.js';
import { riverCue, riverPrompt, wrapText } from '../src/games/river-hop-text.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const CJK = /[一-鿿]/;
const CLEAR_LIMIT = 300;
const BLIND_HORIZON = 100;
const BLIND_SEEDS = [1, 2];
const MARGIN_STEPS = [
  { feet: 5, car: 10 },
  { feet: 3, car: 6 },
  { feet: 2, car: 3 },
];

// ---------------------------------------------------------------------------------------------
// A reaction-limited player. It reads only getState() from `delay` seconds ago, predicts the
// lanes from the published speeds, and plans hops on its own geometric model of the river.
// ---------------------------------------------------------------------------------------------
const FLIGHT = 0.24;
const HOP_PX = 24;
const FEET_HALF = 11;
const SAMPLE = 0.03;
const KEYS = [
  { dx: 0, dy: -1, key: 'ArrowUp' },
  { dx: -1, dy: 0, key: 'ArrowLeft' },
  { dx: 1, dy: 0, key: 'ArrowRight' },
  { dx: 0, dy: 1, key: 'ArrowDown' },
];
const cycleOf = (t, lane) => ((t % lane.cycle) + lane.cycle) % lane.cycle;
const ferryAt = (lane, t) =>
  lane.ferry.center + lane.ferry.amp * Math.sin((t * 2 * Math.PI) / lane.ferry.period);
function laneVelocity(lane, t) {
  if (lane.kind !== 'ferry') return lane.speed;
  const { amp, period } = lane.ferry;
  return ((amp * 2 * Math.PI) / period) * Math.cos((t * 2 * Math.PI) / period);
}
function deckAt(lane, obj, from, t) {
  if (lane.kind === 'ferry') return ferryAt(lane, t);
  const x = obj.x + lane.speed * (t - from);
  if (!lane.span) return x;
  const lo = -obj.w - 24;
  return lo + ((((x - lo) % lane.span) + lane.span) % lane.span);
}
function buildModel(obs, margin) {
  const lanes = new Map(obs.lanes.map((l) => [l.row, l])),
    from = obs.time,
    laneHit = (row, x, t) => {
      const lane = lanes.get(row);
      return (
        lane &&
        !lane.water &&
        lane.objects.some((o) => {
          const left = deckAt(lane, o, from, t);
          return x + 7 + margin.car > left && x - 7 - margin.car < left + o.w;
        })
      );
    },
    onDeck = (row, x, t) => {
      const lane = lanes.get(row);
      if (!lane || (lane.kind === 'turtles' && cycleOf(t, lane) >= 6.45)) return false;
      return lane.objects.some((o) => {
        const left = deckAt(lane, o, from, t);
        return x - FEET_HALF - margin.feet >= left && x + FEET_HALF + margin.feet <= left + o.w;
      });
    },
    onFreePad = (x) =>
      [0, 1, 2, 3].some(
        (n) =>
          !obs.homes.includes(n) &&
          x - FEET_HALF - 5 >= n * 120 + 18 &&
          x + FEET_HALF + 5 <= n * 120 + 102,
      ),
    standable = (row, x, t) => {
      if (x < 14 || x > 466) return false;
      if (row === 9 || row === 4) return true;
      if (row === 0) return onFreePad(x);
      return lanes.get(row)?.water ? onDeck(row, x, t) : !laneHit(row, x, t);
    },
    drift = (row, t, to) => {
      const lane = lanes.get(row);
      if (!lane?.water) return 0;
      return lane.kind === 'ferry' ? ferryAt(lane, to) - ferryAt(lane, t) : lane.speed * (to - t);
    };
  return { lanes, laneHit, standable, drift };
}
function stay(model, row, x, t, until) {
  let at = x;
  for (let tau = t; tau < until - 1e-9;) {
    const next = Math.min(until, tau + SAMPLE);
    at += model.drift(row, tau, next);
    tau = next;
    if (!model.standable(row, at, tau)) return null;
  }
  return at;
}
function hopFrom(model, node, move, lockedUntil) {
  const lane = model.lanes.get(node.row),
    carried = lane?.water ? laneVelocity(lane, node.t) : 0,
    row = node.row + move.dy;
  if (row < 0 || row > 9) return null;
  const landing = node.x + carried * FLIGHT + move.dx * HOP_PX;
  if (landing < 14 || landing > 466) return null;
  for (let tau = SAMPLE; tau <= FLIGHT + 1e-9; tau += SAMPLE) {
    const x = node.x + carried * tau + (move.dx * HOP_PX * tau) / FLIGHT,
      fraction = tau / FLIGHT,
      rows = [fraction < 0.25 ? null : row, fraction > 0.85 ? null : node.row];
    if (rows.some((r) => r !== null && model.laneHit(r, x, node.t + tau))) return null;
  }
  if (!model.standable(row, landing, node.t + FLIGHT)) return null;
  const x = stay(model, row, landing, node.t + FLIGHT, lockedUntil);
  return x === null ? null : { row, x, t: lockedUntil };
}
/** Minimal binary min-heap keyed on `f`. */
function pushHeap(heap, node) {
  heap.push(node);
  for (let i = heap.length - 1; i > 0;) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}
function popHeap(heap) {
  const top = heap[0],
    last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1,
        r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].f < heap[m].f) m = l;
      if (r < heap.length && heap[r].f < heap[m].f) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}
function planHops(model, obs, now, frog, lock) {
  const free = [0, 1, 2, 3].filter((n) => !obs.homes.includes(n)).map((n) => n * 120 + 60),
    open = [],
    seen = new Set(),
    limit = now + Math.min(30, obs.timeLeft - 1),
    push = (n) =>
      pushHeap(open, {
        ...n,
        f: 0.5 * n.t + n.row * 0.6 + Math.min(...free.map((c) => Math.abs(n.x - c))) / 60,
      });
  push({ ...frog, t: now, path: [] });
  for (let expanded = 0; open.length && expanded < 40000; expanded++) {
    const node = popHeap(open),
      key = `${node.row}:${Math.round(node.x / 4)}:${Math.round(node.t * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (node.row === 0) return node.path;
    if (node.t > limit) continue;
    const waited = stay(model, node.row, node.x, node.t, node.t + 0.1);
    if (waited !== null) push({ ...node, x: waited, t: node.t + 0.1 });
    for (const move of KEYS) {
      const next = hopFrom(model, node, move, node.t + lock);
      if (next) push({ ...next, path: [...node.path, { key: move.key, at: node.t }] });
    }
  }
  return null;
}
/** One input frame per call: the returned function maps the live snapshot to that frame's keys. */
function reactionBot({ hz, delay }) {
  const lag = Math.round(delay * hz),
    history = [],
    lock = 0.32 + delay;
  let sent = null,
    schedule = null;
  return (state) => {
    history.push(state);
    const obs = history[Math.max(0, history.length - 1 - lag)],
      none = input();
    const ready =
      obs.phase === 'playing' &&
      obs.spawnDelay === 0 &&
      obs.transition === 0 &&
      !obs.needsRelease &&
      obs.frog.grounded &&
      obs.frog.pose !== 'rescued';
    if (!ready) {
      schedule = null;
      return none;
    }
    if (sent?.level === obs.level && obs.time < sent.time + 0.3) return none;
    const now = obs.time + delay;
    if (schedule && schedule.lives !== obs.lives) schedule = null;
    if (!schedule || schedule.level !== obs.level || schedule.rescued !== obs.rescued) {
      let path = null;
      for (const margin of MARGIN_STEPS) {
        const model = buildModel(obs, margin),
          frog = { row: obs.frog.row, x: obs.frog.x + model.drift(obs.frog.row, obs.time, now) };
        path = planHops(model, obs, now, frog, lock);
        if (path) break;
      }
      if (!path) return none;
      schedule = { level: obs.level, rescued: obs.rescued, lives: obs.lives, path: [...path] };
    }
    const step = schedule.path[0];
    if (!step || now + 1e-9 < step.at) return none;
    schedule = { ...schedule, path: schedule.path.slice(1) };
    sent = { level: obs.level, time: now };
    return input([step.key], [step.key]);
  };
}

// ---------------------------------------------------------------------------------------------
// Harness helpers.
// ---------------------------------------------------------------------------------------------
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
/** Start a run on `level` the way a player does: through the crossing select when offered. */
function open(level, { seed = 1, lang = 'en', progress = memoryStore(level) } = {}) {
  const h = harness({ seed, lang });
  if (progress) h.env.progress = progress;
  const g = createGame(h.env);
  if (level > 1 && progress) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const cleared = (state, level) => state.level > level || state.phase === 'won';
function playLevel(level, hz, delay, { seed = 1, draw = false } = {}) {
  const { g, h } = open(level, { seed }),
    bot = reactionBot({ hz, delay }),
    ctx = mockContext();
  let frames = 0,
    lost = 0,
    previousLives = 4,
    state = g.getState();
  for (; frames < CLEAR_LIMIT * hz; frames++) {
    state = g.getState();
    if (cleared(state, level) || state.phase !== 'playing') break;
    lost += Math.max(0, previousLives - state.lives);
    previousLives = state.lives;
    if (draw && frames % 20 === 0) g.draw(ctx);
    g.update(1 / hz, bot(state));
  }
  return { g, h, state: g.getState(), lost, seconds: frames / hz, level };
}
function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------
// Blind players: none of them looks at the state.
// ---------------------------------------------------------------------------------------------
const UP = 'ArrowUp';
const cycleKeys = (keys, period) => (frame) => {
  const length = Math.round(period * 60),
    key = keys[Math.floor(frame / length) % keys.length];
  return key ? input([key], frame % length === 0 ? [key] : []) : input();
};
const BLIND_POLICIES = {
  idle: () => () => input(),
  mash: () => () => input([], ['Space', UP, 'Enter']),
  holdUp: () => () => input([UP], [UP]),
  randomKeys: (rng) => {
    let held = [];
    return (frame) => {
      if (frame % 12 === 0)
        held = [['ArrowLeft'], ['ArrowRight'], [], [UP], [UP], ['ArrowDown']][
          Math.floor(rng() * 6)
        ];
      return input(held, frame % 12 === 0 ? held : []);
    };
  },
  'up-left-right@0.7': () => cycleKeys([UP, UP, 'ArrowLeft', UP, UP, 'ArrowRight'], 0.7),
  'up-left@0.5': () => cycleKeys([UP, 'ArrowLeft'], 0.5),
  'up-right@1.3': () => cycleKeys([UP, 'ArrowRight'], 1.3),
  'up-down@1.7': () => cycleKeys([UP, UP, 'ArrowDown'], 1.7),
};
function blindWins(policy, level, seed) {
  const { g } = open(level, { seed }),
    act = BLIND_POLICIES[policy](seeded(seed * 31 + level));
  for (let frame = 0; frame < BLIND_HORIZON * 60; frame++) {
    const state = g.getState();
    if (cleared(state, level) || state.phase !== 'playing') return cleared(state, level);
    g.update(1 / 60, act(frame));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The crossing table.
// ---------------------------------------------------------------------------------------------
const featuresOf = (n) => {
  const lanes = riverLanes(n);
  return {
    turtles: lanes.some((l) => l.kind === 'turtles'),
    ferry: lanes.some((l) => l.kind === 'ferry'),
    trucks: lanes.some((l) => l.kind === 'traffic' && l.objects.some((o) => o.w >= 70)),
    traffic: lanes.filter((l) => l.kind === 'traffic' && l.objects.length).length,
  };
};
test('there are at least twenty distinct crossings, each with a name and a bilingual tip', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.equal(new Set(LEVELS.map((l) => JSON.stringify(l.lanes))).size, LEVEL_COUNT);
  assert.equal(new Set(LEVELS.map((l) => l.name.en)).size, LEVEL_COUNT);
  for (const level of LEVELS) {
    assert.ok(level.name.en && CJK.test(level.name.zh));
    assert.ok(level.tip.en.length > 25 && CJK.test(level.tip.zh));
    assert.ok(level.cue.en && CJK.test(level.cue.zh));
    assert.equal(level.lanes.length, LANE_ROWS.length);
  }
});
test('exported crossing data is frozen all the way down', () => {
  assert.ok(Object.isFrozen(LEVELS) && Object.isFrozen(LANE_ROWS));
  for (const level of LEVELS) {
    assert.ok(Object.isFrozen(level) && Object.isFrozen(level.name) && Object.isFrozen(level.tip));
    assert.ok(Object.isFrozen(level.lanes) && level.lanes.every(Object.isFrozen));
  }
  const lanes = riverLanes(3);
  lanes[0].objects[0].x = 9999;
  assert.notEqual(riverLanes(3)[0].objects[0].x, 9999, 'riverLanes hands out fresh copies');
  assert.equal(clampLevel('x'), 1);
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel(99), LEVEL_COUNT);
  assert.equal(riverLanes(-4).length, LANE_ROWS.length);
});
test('the curve teaches one new thing at a time, then combines, then masters', () => {
  const firstSeen = {};
  for (const n of LEVEL_NUMBERS)
    for (const [key, on] of Object.entries(featuresOf(n))) if (on) firstSeen[key] ??= n;
  assert.equal(firstSeen.traffic, 1);
  assert.equal(firstSeen.turtles, 4);
  assert.equal(firstSeen.ferry, 6);
  assert.equal(firstSeen.trucks, 7);
  assert.ok(featuresOf(1).traffic < featuresOf(3).traffic);
  for (const n of LEVEL_NUMBERS.slice(0, 7))
    assert.ok(Object.values(featuresOf(n)).filter(Boolean).length <= 3, `crossing ${n}`);
  const combined = LEVEL_NUMBERS.slice(7, 14).filter((n) => {
    const f = featuresOf(n);
    return [f.turtles, f.ferry, f.trucks].filter(Boolean).length >= 2;
  });
  assert.ok(combined.length >= 3, 'combination crossings mix at least two ideas');
  const pace = (n) => {
    const lanes = riverLanes(n).filter((l) => l.objects.length && l.kind !== 'ferry');
    return lanes.reduce((sum, l) => sum + Math.abs(l.speed), 0) / lanes.length;
  };
  const third = (from) => LEVEL_NUMBERS.slice(from, from + 6).reduce((sum, n) => sum + pace(n), 0);
  assert.ok(third(0) < third(7) && third(7) < third(14), 'average speed rises across the curve');
  for (const n of LEVEL_NUMBERS.slice(14)) {
    const f = featuresOf(n);
    assert.equal(f.traffic, 4, `mastery crossing ${n} uses every road lane`);
  }
});
test('every tip and cue names only what its crossing really contains', () => {
  for (const n of LEVEL_NUMBERS) {
    const f = featuresOf(n),
      { tip, cue } = LEVELS[n - 1],
      both = `${tip.en} ${cue.en}`.toLowerCase();
    if (/turtle|stripe|dive/.test(both)) assert.ok(f.turtles, `crossing ${n} turtles`);
    if (/turtle|stripe|dive/.test(both)) assert.match(`${tip.zh}${cue.zh}`, /乌龟|条纹|潜水/);
    if (/ferry/.test(both)) assert.ok(f.ferry, `crossing ${n} ferry`);
    if (/ferry/.test(both)) assert.match(`${tip.zh}${cue.zh}`, /渡船/);
    if (/truck|convoy/.test(both)) assert.ok(f.trucks, `crossing ${n} trucks`);
    if (/truck|convoy/.test(both)) assert.match(`${tip.zh}${cue.zh}`, /卡车|车队/);
  }
  for (const n of [4, 5, 8, 9, 11, 14, 16, 17, 19, 20]) assert.ok(featuresOf(n).turtles, `${n}`);
  for (const n of [6, 9, 12, 17, 20]) assert.ok(featuresOf(n).ferry, `${n}`);
  for (const n of [7, 8, 10, 14, 17, 20]) assert.ok(featuresOf(n).trucks, `${n}`);
});
test('decks stay on the canvas rows, keep real gaps and never overlap within a lane', () => {
  for (const n of LEVEL_NUMBERS)
    for (const lane of riverLanes(n)) {
      assert.equal(lane.water, lane.row < 4);
      if (lane.kind === 'ferry') {
        assert.equal(lane.objects.length, 1);
        assert.ok(
          lane.ferry.center - lane.ferry.amp >= 24 &&
            lane.ferry.center + lane.ferry.amp + lane.objects[0].w <= 456,
        );
        continue;
      }
      const sorted = lane.objects.map((o) => o).sort((a, b) => a.x - b.x);
      sorted.slice(1).forEach((o, i) => {
        const gap = o.x - (sorted[i].x + sorted[i].w);
        assert.ok(gap >= (lane.water ? 20 : 70), `crossing ${n} row ${lane.row} gap ${gap}`);
      });
    }
});

// ---------------------------------------------------------------------------------------------
// Scripted legal clears and the reaction-limited bot at 30, 60 and 120 Hz.
// ---------------------------------------------------------------------------------------------
test('a scripted legal player clears every crossing through the public input', () => {
  for (const n of LEVEL_NUMBERS) {
    const run = playLevel(n, 60, 0, { draw: true });
    assert.ok(
      cleared(run.state, n),
      `crossing ${n} ended ${run.state.phase} after ${run.seconds}s`,
    );
    assert.equal(run.state.phase, n === LEVEL_COUNT ? 'won' : 'playing');
    assert.equal(run.lost, 0, `crossing ${n} lost frogs`);
  }
});
test('a reaction-limited bot (0.25 s and 0.35 s) clears every crossing at 30, 60 and 120 Hz with margin', () => {
  for (const hz of HZS)
    for (const delay of DELAYS)
      for (const n of LEVEL_NUMBERS) {
        const run = playLevel(n, hz, delay),
          label = `crossing ${n} at ${hz} Hz, ${delay}s`;
        assert.ok(cleared(run.state, n), `${label}: ${run.state.phase} after ${run.seconds}s`);
        assert.ok(run.lost <= 1, `${label}: lost ${run.lost} frogs`);
        assert.ok(run.seconds < 150, `${label}: took ${run.seconds}s`);
      }
});
test('idle, mash and timed-pattern players win at most a quarter of any crossing from crossing 3', () => {
  for (const policy of Object.keys(BLIND_POLICIES)) {
    const levels = policy === 'idle' ? [3, 11, 20] : BLIND_LEVELS;
    for (const n of levels) {
      const wins = BLIND_SEEDS.filter((seed) => blindWins(policy, n, seed)).length;
      assert.ok(wins / BLIND_SEEDS.length <= 0.25, `${policy} won ${wins} on crossing ${n}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Fair start.
// ---------------------------------------------------------------------------------------------
test('a new player gets time to read: an idle opening loses nothing for the first seconds', () => {
  const { g, h } = open(1, { progress: null }),
    ctx = mockContext(),
    drawn = [];
  ctx.fillText = (value, x, y) => drawn.push({ value, x, y });
  for (let i = 0; i < 20 * 60; i++) g.update(1 / 60, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.lives, 4);
  assert.equal(s.menu, null);
  assert.equal(s.frog.row, 9);
  assert.equal(h.ends.length, 0);
  g.draw(ctx);
  assert.ok(drawn.length >= 4);
  for (const t of drawn)
    if (!/^[1-4]$/.test(t.value)) assert.ok(t.y < 34, `"${t.value}" must stay in the HUD strip`);
  assert.ok(!drawn.some((t) => t.value.includes(LEVELS[0].tip.en)), 'the long tip is host text');
  assert.ok(s.status.en.includes(LEVELS[0].tip.en) && s.status.zh.includes(LEVELS[0].tip.zh));
});
test('the first crossing has quiet roads and long logs for a first hop', () => {
  const lanes = riverLanes(1);
  assert.ok(lanes.filter((l) => !l.water && l.objects.length).length <= 2);
  for (const l of lanes.filter((l) => l.water)) assert.ok(l.objects[0].w >= 140);
});

// ---------------------------------------------------------------------------------------------
// Select, continue and progress.
// ---------------------------------------------------------------------------------------------
test('a fresh player starts on crossing 1 and a returning player gets the crossing select', () => {
  const fresh = open(1, { progress: memoryStore(1) }).g.getState();
  assert.equal(fresh.menu, null);
  const { g } = open(1, { progress: memoryStore(7) });
  assert.equal(g.getState().menu.cursor, 7);
  assert.equal(g.getState().menu.unlocked, 7);
  assert.equal(g.getState().menu.total, LEVEL_COUNT);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['KeyD']));
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 7);
  assert.match(g.getState().status.en, /Choose a crossing/);
  g.update(1 / 60, input([], ['Enter']));
  const started = g.getState();
  assert.equal(started.menu, null);
  assert.equal(started.level, 7);
  assert.equal(started.lives, 4);
});
test('the select never starts a locked crossing and a tap starts exactly the cell it hits', () => {
  const { g, h } = open(1, { progress: memoryStore(5) }),
    cell = (n) => {
      const q = menuCell(n);
      return { x: q.x + q.w / 2, y: q.y + q.h / 2, clicked: true };
    };
  g.update(1 / 60, input([], [], cell(12)));
  assert.equal(g.getState().menu.cursor, 5);
  assert.ok(h.sounds.includes('hit'));
  g.update(1 / 60, input([], [], cell(2)));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 2);
  assert.equal(MENU_COLUMNS, 5);
  const cursor = menuTarget(input([], ['ArrowRight']), 5, 5);
  assert.deepEqual([cursor.cursor, cursor.moved, cursor.start], [5, false, false]);
});
test('clearing a crossing unlocks the next one through env.progress and never lowers it', () => {
  const progress = memoryStore(1),
    run = playLevel(1, 60, 0.25, { seed: 3 });
  assert.ok(cleared(run.state, 1));
  const { g } = open(1, { progress });
  assert.equal(g.getState().menu, null);
  const store = memoryStore(4),
    second = open(4, { progress: store }),
    bot = reactionBot({ hz: 60, delay: 0.25 });
  for (let i = 0; i < 60 * CLEAR_LIMIT && second.g.getState().level === 4; i++)
    second.g.update(1 / 60, bot(second.g.getState()));
  assert.equal(second.g.getState().level, 5);
  assert.equal(store.value, 5);
  assert.deepEqual(store.calls, [5]);
  assert.equal(open(1, { progress: store }).g.getState().menu.cursor, 5);
});
test('the final crossing records the whole table as cleared and wins once', () => {
  const store = memoryStore(LEVEL_COUNT),
    run = playLevel(LEVEL_COUNT, 60, 0.25),
    final = run.g.getState();
  assert.equal(final.phase, 'won');
  assert.equal(final.level, LEVEL_COUNT);
  assert.equal(run.h.ends.length, 1);
  assert.equal(run.h.ends[0].won, true);
  assert.equal(store.value, LEVEL_COUNT);
});
test('junk, missing and throwing progress stores never break the game', () => {
  for (const junk of [NaN, -5, 0, 'x', null, undefined, Infinity, -Infinity, 2.7, 999, '3', {}]) {
    const progress = { unlocked: () => junk, unlock() {} },
      { g } = open(1, { progress }),
      s = g.getState();
    assert.ok(s.unlocked >= 1 && s.unlocked <= LEVEL_COUNT, `junk ${String(junk)}`);
    g.update(1 / 60, input([], ['Space']));
    g.update(1 / 60, input());
    g.draw(mockContext());
  }
  assert.equal(
    open(1, { progress: { unlocked: () => 2.7, unlock() {} } }).g.getState().unlocked,
    2,
  );
  const brokenRead = { unlocked: () => assert.fail('boom'), unlock() {} },
    brokenWrite = { unlocked: () => 3, unlock: () => assert.fail('boom') };
  assert.equal(open(1, { progress: brokenRead }).g.getState().menu, null);
  const { g, h } = open(3, { progress: brokenWrite });
  const bot = reactionBot({ hz: 60, delay: 0.25 });
  for (let i = 0; i < 60 * CLEAR_LIMIT && g.getState().level === 3; i++)
    g.update(1 / 60, bot(g.getState()));
  assert.equal(g.getState().level, 4, 'a store that throws on unlock does not stop the run');
  assert.equal(h.ends.length, 0);
  const none = harness();
  assert.equal(createGame(none.env).getState().menu, null);
});

// ---------------------------------------------------------------------------------------------
// Determinism, hostile input, terminal state.
// ---------------------------------------------------------------------------------------------
test('the same scripted hops give the same river at 30, 60 and 120 Hz', () => {
  const recorded = [],
    { g: source } = open(3),
    bot = reactionBot({ hz: 30, delay: 0.25 });
  for (let frame = 0; frame < 30 * 30; frame++) {
    const state = source.getState(),
      keys = bot(state);
    if (keys.pressed('ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'))
      recorded.push({
        frame,
        key: ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].find((k) => keys.pressed(k)),
      });
    source.update(1 / 30, keys);
  }
  assert.ok(recorded.length > 8);
  const snapshots = HZS.map((hz) => {
    const { g } = open(3);
    for (let frame = 0; frame < hz * 30; frame++) {
      const hop = recorded.find((r) => r.frame * (hz / 30) === frame);
      g.update(1 / hz, hop ? input([hop.key], [hop.key]) : input());
    }
    return g.getState();
  });
  for (const other of snapshots.slice(1)) {
    assert.equal(other.lives, snapshots[0].lives);
    assert.equal(other.rescued, snapshots[0].rescued);
    assert.equal(other.score, snapshots[0].score);
    assert.ok(Math.abs(other.time - snapshots[0].time) < 1e-6);
    assert.ok(Math.abs(other.frog.x - snapshots[0].frog.x) < 1e-3);
    assert.ok(Math.abs(other.frog.y - snapshots[0].frog.y) < 1e-3);
  }
});
test('hostile dt, pointer and input values cannot corrupt a crossing', () => {
  const hostileDt = [0, -1, NaN, Infinity, -Infinity, 1e9, 1e-12, '0.5', null, undefined, {}];
  const pointers = [
    undefined,
    null,
    { x: NaN, y: Infinity, clicked: true },
    { x: 'a', y: {}, clicked: true },
    { x: -1e9, y: 1e9, clicked: true },
  ];
  for (const level of [1, 8, 20]) {
    const { g, h } = open(level),
      ctx = mockContext(),
      random = seeded(level);
    for (let i = 0; i < 600; i++) {
      const dt = hostileDt[i % hostileDt.length],
        key = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'][Math.floor(random() * 4)];
      g.update(dt, {
        ...input([key], [key]),
        pointer: pointers[i % pointers.length],
      });
      if (i % 50 === 0) {
        finiteDeep(g.getState());
        g.draw(ctx);
      }
    }
    const s = g.getState();
    assert.ok(s.frog.x >= 11 - 1e-6 && s.frog.x <= 469 + 1e-6);
    assert.ok(h.ends.length <= 1);
  }
  const menuGame = open(1, { progress: memoryStore(6) }).g;
  for (const pointer of pointers) {
    menuGame.update(1 / 60, { ...input(), pointer });
    assert.ok(menuGame.getState().menu || menuGame.getState().level >= 1);
  }
});
test('losing and winning end exactly once in English and Chinese with a frozen terminal state', () => {
  for (const lang of ['en', 'zh']) {
    const lost = open(1, { lang, progress: null });
    for (let i = 0; i < 20 * 60 * 10 && lost.g.getState().phase === 'playing'; i++)
      lost.g.update(1 / 10, input());
    const end = lost.g.getState();
    assert.equal(end.phase, 'lost');
    assert.equal(lost.h.ends.length, 1);
    assert.equal(lost.h.ends[0].won, false);
    assert.match(lost.h.ends[0].message, lang === 'zh' ? CJK : /another try/);
    lost.g.update(1 / 30, input(['ArrowUp'], ['ArrowUp']));
    lost.g.draw(mockContext());
    assert.deepEqual(lost.g.getState(), end);
    assert.equal(lost.h.ends.length, 1);
    assert.ok(lost.h.sounds.includes('lose'));

    const { g, h } = open(LEVEL_COUNT, { lang }),
      bot = reactionBot({ hz: 60, delay: 0.25 });
    for (let i = 0; i < 60 * CLEAR_LIMIT && g.getState().phase === 'playing'; i++)
      g.update(1 / 60, bot(g.getState()));
    const won = g.getState();
    assert.equal(won.phase, 'won');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(h.ends[0].message, lang === 'zh' ? CJK : /twenty crossings/);
    g.update(1 / 30, input(['ArrowUp'], ['ArrowUp']));
    assert.deepEqual(g.getState(), won);
    assert.equal(h.ends.length, 1);
    assert.ok(h.sounds.includes('win'));
  }
});

// ---------------------------------------------------------------------------------------------
// Text and touch.
// ---------------------------------------------------------------------------------------------
const glyph = (ch, size) => (CJK.test(ch) || /[　-〿＀-￯]/.test(ch) ? size : size * 0.62);
const widthOf = (value, size) => [...String(value)].reduce((sum, ch) => sum + glyph(ch, size), 0);
function drawnText(draw) {
  const calls = [],
    ctx = mockContext();
  ctx.fillText = (value, x, y) =>
    calls.push({
      value,
      x,
      y,
      size: parseFloat(ctx.font.match(/(\d+)px/)[1]),
      align: ctx.textAlign,
    });
  draw(ctx);
  return calls;
}
const fits = ({ value, x, size, align }) => {
  const w = widthOf(value, size),
    left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return left >= 0 && left + w <= 480;
};
test('English and Chinese text fits the 480 by 320 canvas on every crossing and the select', () => {
  for (const lang of ['en', 'zh'])
    for (const n of LEVEL_NUMBERS) {
      const { g } = open(n, { lang });
      for (const call of drawnText((ctx) => g.draw(ctx)))
        assert.ok(fits(call), `${lang} crossing ${n}: "${call.value}"`);
      const state = g.getState();
      assert.ok(state.status[lang].length > 20);
      const cue = drawnText((ctx) => g.draw(ctx)).find((c) => c.align === 'center');
      assert.ok(widthOf(cue.value, cue.size) <= 260, `${lang} cue ${n}`);
    }
  for (const lang of ['en', 'zh'])
    for (let cursor = 1; cursor <= LEVEL_COUNT; cursor++) {
      const { g } = open(1, { lang, progress: memoryStore(LEVEL_COUNT) });
      for (let i = LEVEL_COUNT; i > cursor; i--) g.update(1 / 60, input([], ['ArrowLeft']));
      const calls = drawnText((ctx) => g.draw(ctx));
      assert.equal(g.getState().menu.cursor, cursor);
      for (const call of calls) assert.ok(fits(call), `${lang} select ${cursor}: "${call.value}"`);
      const tip = wrapText(LEVELS[cursor - 1].tip[lang], 10, 440);
      assert.ok(tip.length <= 3 && tip.every((line) => widthOf(line, 10) <= 440));
    }
});
test('touch covers every action: four direction buttons, tapping a crossing and the end text', () => {
  assert.deepEqual(meta.touchControls.map((c) => c.code).toSorted(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
  ]);
  for (const c of meta.touchControls) assert.ok(c.label.en && CJK.test(c.label.zh));
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en)));
  assert.match(meta.description.en, /twenty crossings/);
  assert.match(meta.description.zh, /二十处渡口/);
  assert.equal(wrapText('one two three', 10, 40).length > 1, true);
  assert.equal(wrapText('一二三四五六', 10, 25).length > 1, true);
});

test('a filled pad and a wall bump each explain the way forward, and mid-size cars draw', () => {
  const s = createRiverState(3);
  s.feedback = { type: 'occupied', x: 60, y: 48, life: 1 };
  assert.match(riverPrompt(s).en, /Filled pad/);
  assert.match(riverCue(s).zh, /已住满/);
  s.feedback = { type: 'edge', x: 0, y: 0, life: 1 };
  assert.match(riverPrompt(s).en, /edge/);
  assert.match(riverCue(s).en, /EDGE/);
  for (const w of [40, 56, 90]) {
    const lane = s.lanes.find((l) => l.row === 6);
    lane.objects = [{ id: 'car', x: 200, w }];
    assert.doesNotThrow(() => drawRiver(mockContext(), s, harness().env, null));
  }
});
test('pad landings and wall clamps follow the rules for every way of arriving', () => {
  const stand = (s, row, x) => {
    Object.assign(s.frog, { x, y: 34 + row * 28 + 14, row, grounded: true, hop: null });
    s.spawnDelay = 0;
    s.needsRelease = false;
  };
  const resting = createRiverState(1);
  stand(resting, 0, 60);
  stepRiver(resting, 1 / 60, input());
  assert.deepEqual(resting.homes, [0]);
  const filled = createRiverState(1);
  filled.homes = [0];
  stand(filled, 1, 60);
  filled.lanes.find((l) => l.row === 1).objects = [{ id: 'deck', x: 0, w: 200 }];
  filled.lanes.find((l) => l.row === 1).speed = 0;
  stepRiver(filled, 1 / 60, input([], ['ArrowUp']));
  for (let i = 0; i < 20; i++) stepRiver(filled, 1 / 60, input());
  assert.equal(filled.lives, 4);
  assert.equal(filled.feedback.type, 'occupied');
  const wall = createRiverState(1);
  stand(wall, 9, 20);
  stepRiver(wall, 1 / 60, input([], ['ArrowLeft']));
  for (let i = 0; i < 30; i++) stepRiver(wall, 1 / 60, input());
  assert.equal(wall.frog.x, 11);
  assert.equal(wall.lives, 4);
});
