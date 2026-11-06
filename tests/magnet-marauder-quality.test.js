import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createWorld,
  loadChamber,
  spawnPending,
  stepWorld,
  snapshot,
  STEP,
  PROMPTS,
  ARENA,
  ARMOR_V,
  REPEL_V,
  FIELD_R,
  MACHINE_HP,
  CHAMBER_COUNT,
  inLane,
} from '../src/games/magnet-marauder.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ------------------------------------------------------------ human-like policy
// The policy sees only what the screen shows: positions, the orbit, the red bracket, wind-up
// lanes, glowing metal and the prompt text. It acts on a view that is `delay` seconds old.

const keysFor = (dx, dy, th = 4) => {
  const k = [];
  if (dx > th) k.push('ArrowRight');
  if (dx < -th) k.push('ArrowLeft');
  if (dy > th) k.push('ArrowDown');
  if (dy < -th) k.push('ArrowUp');
  return k;
};
const CELL = 8;
const COLS = 60;
const ROWS = 40;

function makeSteer() {
  const cache = new Map();
  const gridFor = (s) => {
    const key = `${s.chamber}:${s.machines.map((m) => m.id).join()}`;
    if (cache.has(key)) return cache.get(key);
    const boxes = [
      ...s.walls,
      ...s.machines.map((m) => ({
        x0: m.x - m.hw,
        y0: m.y - m.hh,
        x1: m.x + m.hw,
        y1: m.y + m.hh,
      })),
    ];
    const blocked = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL + CELL / 2,
          y = r * CELL + CELL / 2;
        if (boxes.some((b) => x > b.x0 - 11 && x < b.x1 + 11 && y > b.y0 - 11 && y < b.y1 + 11)) {
          blocked[r * COLS + c] = 1;
        }
      }
    }
    cache.set(key, blocked);
    return blocked;
  };
  const cell = (x, y) => [
    Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL))),
    Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL))),
  ];
  // Breadth-first walk around the drawn walls toward a point, returning arrow keys.
  return (s, tx, ty) => {
    const p = s.player;
    const blocked = gridFor(s);
    const [sc, sr] = cell(p.x, p.y);
    const [gc, gr] = cell(tx, ty);
    const prev = new Int32Array(COLS * ROWS).fill(-2);
    prev[gr * COLS + gc] = -1;
    const queue = [gr * COLS + gc];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const c = cur % COLS,
        r = (cur / COLS) | 0;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const nc = c + dc,
          nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = nr * COLS + nc;
        if (prev[n] !== -2 || (blocked[n] && n !== sr * COLS + sc)) continue;
        prev[n] = cur;
        queue.push(n);
      }
    }
    const here = sr * COLS + sc;
    if (prev[here] < 0) return keysFor(tx - p.x, ty - p.y, 6);
    const next = prev[prev[here]] >= 0 ? prev[prev[here]] : prev[here];
    return keysFor(
      (next % COLS) * CELL + CELL / 2 - p.x,
      ((next / COLS) | 0) * CELL + CELL / 2 - p.y,
      3,
    );
  };
}

export function makePolicy() {
  const steer = makeSteer();
  let lastX = -10;
  return function decide(s) {
    const p = s.player;
    const out = { held: ['Space'], pressed: [] };
    const foes = s.foes.filter((f) => !f.spawning);
    // 1. step out of a red charge lane
    for (const f of foes) {
      if (!f.lane) continue;
      const rx = p.x - f.x,
        ry = p.y - f.y;
      const along = rx * f.lane.x + ry * f.lane.y,
        side = -rx * f.lane.y + ry * f.lane.x;
      if (along > -14 && along < f.lane.length && Math.abs(side) < f.lane.half + 14) {
        const sign = side >= 0 ? 1 : -1;
        out.held.push(...keysFor(-f.lane.y * sign * 100, f.lane.x * sign * 100));
        return out;
      }
    }
    // 2. pick the most urgent foe: winding up, then chargers, then the weakest machine
    const machineOf = (f) =>
      s.machines.reduce((best, m) =>
        Math.hypot(m.x - f.x, m.y - f.y) < Math.hypot(best.x - f.x, best.y - f.y) ? m : best,
      );
    const urgency = (f) => {
      const m = machineOf(f);
      return (
        Math.hypot(f.x - m.x, f.y - m.y) -
        (f.state === 'wind' ? 400 : 0) -
        (f.type === 'charger' ? 60 : 0) -
        (MACHINE_HP - m.hp) * 40
      );
    };
    const foe = [...foes].sort((a, b) => urgency(a) - urgency(b))[0];
    const slow = s.metals.filter((m) => !m.held && !m.fast);
    const closest = [...slow].sort(
      (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    )[0];
    const fetch = () => {
      if (closest && Math.hypot(closest.x - p.x, closest.y - p.y) > 70) {
        out.held.push(...steer(s, closest.x, closest.y));
      }
      return out;
    };
    if (s.held > 0 && foe) {
      const target = foes.find((f) => f.id === s.aim);
      if (target && Math.hypot(target.x - p.x, target.y - p.y) < 190) {
        if (s.time - lastX >= 0.5) {
          out.pressed = ['KeyX'];
          lastX = s.time;
        }
        return out;
      }
      if (target && s.held < 2 && closest) return fetch();
      if (s.aimBlocked) {
        out.held.push(...keysFor(0, 162 - p.y >= 0 ? 100 : -100));
        return out;
      }
      const d = Math.hypot(foe.x - p.x, foe.y - p.y);
      out.held.push(...(d > 130 ? steer(s, foe.x, foe.y) : keysFor(foe.x - p.x, foe.y - p.y, 10)));
      return out;
    }
    return fetch();
  };
}

// Plays one chamber (or the whole campaign) through the public game API only. A later chamber is
// reached the way a player does: the progress stub reports it as the highest unlocked one and the
// first update presses Space on the "continue" highlight of the chamber select.
export function playPolicy({
  hz,
  seed,
  chamber = 0,
  minDelay = 0.15,
  span = 0.2,
  maxSeconds = 150,
  policy = makePolicy(),
  observe = () => {},
  campaign = false,
}) {
  const h = harness({ seed });
  const unlocks = [];
  h.env.progress = { unlocked: () => chamber + 1, unlock: (n) => unlocks.push(n) };
  const g = createGame(h.env);
  if (chamber > 0) g.update(1 / 60, input([], ['Space']));
  const rnd = seeded(seed * 7 + 3);
  const dt = 1 / hz;
  const history = [];
  let delay = minDelay + rnd() * span,
    nextJitter = 0;
  const limit = campaign ? maxSeconds * CHAMBER_COUNT : maxSeconds;
  for (let t = 0; t < limit && h.ends.length === 0 && (campaign || unlocks.length === 0); t += dt) {
    const s = g.getState();
    history.push({ t, s });
    if (history.length > 130) history.shift();
    if (t >= nextJitter) {
      delay = minDelay + rnd() * span;
      nextJitter = t + 1 + rnd() * 2;
    }
    const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
    const a = policy(seen.s);
    observe(s, g);
    g.update(dt, input(a.held, a.pressed));
  }
  const cleared = unlocks.length > 0 || h.ends.some((e) => e.won);
  return { h, g, unlocks, cleared };
}

// A casual player: holds Space, walks in straight lines (no path planning), faces the foe nearest
// to them, throws whenever the red bracket shows, steps out of red lanes, and does not triage
// which machine is in danger.
export function makeCasualPolicy() {
  let lastX = -9;
  return (s) => {
    const p = s.player;
    const held = ['Space'];
    const out = { held, pressed: [] };
    const dist = (o) => Math.hypot(o.x - p.x, o.y - p.y);
    const foes = s.foes.filter((f) => !f.spawning);
    for (const f of foes) {
      if (!f.lane) continue;
      const rx = p.x - f.x,
        ry = p.y - f.y;
      const along = rx * f.lane.x + ry * f.lane.y,
        side = -rx * f.lane.y + ry * f.lane.x;
      if (along > -14 && along < f.lane.length && Math.abs(side) < f.lane.half + 14) {
        const sign = side >= 0 ? 1 : -1;
        held.push(...keysFor(-f.lane.y * sign * 100, f.lane.x * sign * 100));
        return out;
      }
    }
    if (s.held > 0) {
      if (s.aim && s.time - lastX >= 0.5) {
        out.pressed = ['KeyX'];
        lastX = s.time;
      }
      // a blocked line of fire: back off toward the middle of the room and try again
      if (s.aimBlocked && !s.aim) {
        held.push(...keysFor(240 - p.x, 162 - p.y, 10));
        return out;
      }
      const nearest = [...foes].sort((a, b) => dist(a) - dist(b))[0];
      if (nearest && !s.aim) held.push(...keysFor(nearest.x - p.x, nearest.y - p.y, 10));
      return out;
    }
    const metal = s.metals.filter((m) => !m.held && !m.fast).sort((a, b) => dist(a) - dist(b))[0];
    if (metal && dist(metal) > 70) held.push(...keysFor(metal.x - p.x, metal.y - p.y, 6));
    return out;
  };
}

const HZ = [30, 60, 120];
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const seedsOf = (n) => Array.from({ length: n }, (_, i) => i + 1);
const ALL = Array.from({ length: CHAMBER_COUNT }, (_, i) => i);
// five rooms that differ in what they teach: orbit, a charger lane, two machines, a slab gate, the finale
const FIVE = [0, 5, 8, 15, CHAMBER_COUNT - 1];
// a spread used by the long invariant checks that would be too slow on all 25
const SAMPLE = [0, 3, 6, 12, 17, 22];

function clears(chamber, hz, minDelay, span, make = makePolicy, n = 30) {
  let wins = 0;
  for (const seed of seedsOf(n)) {
    const r = playPolicy({ hz, seed, chamber, minDelay, span, policy: make() });
    if (r.cleared) wins++;
  }
  return wins;
}

test('quality: every chamber is cleared by a 0.15-0.35 s visible-information policy (60 Hz)', () => {
  for (const chamber of ALL) {
    const wins = clears(chamber, 60, 0.15, 0.2);
    assert.ok(wins >= 27, `chamber ${chamber + 1}: ${wins}/30`);
  }
});

test('quality: every chamber is cleared by a slow, jittery 0.4-0.6 s policy (60 Hz)', () => {
  for (const chamber of ALL) {
    const wins = clears(chamber, 60, 0.4, 0.2);
    assert.ok(wins >= 24, `chamber ${chamber + 1}: ${wins}/30`);
  }
});

test('quality: every chamber is cleared by a casual player (nearest foe, straight lines, no triage)', () => {
  for (const chamber of ALL) {
    const wins = clears(chamber, 60, 0.4, 0.2, makeCasualPolicy);
    assert.ok(wins >= 24, `chamber ${chamber + 1}: ${wins}/30`);
  }
});

test('quality: five different chambers hold all three gates at 30 and 120 Hz', () => {
  for (const hz of [30, 120]) {
    for (const chamber of FIVE) {
      const fast = clears(chamber, hz, 0.15, 0.2);
      const slow = clears(chamber, hz, 0.4, 0.2);
      const casual = clears(chamber, hz, 0.4, 0.2, makeCasualPolicy);
      assert.ok(fast >= 27, `chamber ${chamber + 1} ${hz} Hz fast: ${fast}/30`);
      assert.ok(slow >= 24, `chamber ${chamber + 1} ${hz} Hz slow: ${slow}/30`);
      assert.ok(casual >= 24, `chamber ${chamber + 1} ${hz} Hz casual: ${casual}/30`);
    }
  }
});

// ------------------------------------------------------------ a scripted legal clear per chamber

// The key presses of a successful run are recorded frame by frame, then replayed open loop (the
// script reads nothing from the screen) on a fresh game: it must clear the same chamber with the
// same score, which also proves the run depends on nothing but the keys and the seed.
test('quality: every chamber has a scripted, replayable legal clear using only held keys and X', () => {
  const dt = 1 / 60;
  for (const chamber of ALL) {
    const frames = [];
    let recorded = null;
    for (const seed of seedsOf(5)) {
      frames.length = 0;
      const inner = makePolicy();
      const r = playPolicy({
        hz: 60,
        seed,
        chamber,
        policy: (s) => {
          const a = inner(s);
          frames.push(a);
          return a;
        },
      });
      if (r.cleared) {
        recorded = { seed, state: r.g.getState(), count: frames.length };
        break;
      }
    }
    assert.ok(recorded, `chamber ${chamber + 1}: no scripted clear found`);
    // the policy is called once per frame, so frames line up with game updates
    const script = frames.slice(0, recorded.count);
    const h = harness({ seed: recorded.seed });
    const unlocks = [];
    h.env.progress = { unlocked: () => chamber + 1, unlock: (n) => unlocks.push(n) };
    const g = createGame(h.env);
    if (chamber > 0) g.update(dt, input([], ['Space']));
    for (const a of script) {
      assert.ok(
        a.held.every((k) => ['Space', ...ARROWS].includes(k)) &&
          a.pressed.every((k) => k === 'KeyX'),
      );
      g.update(dt, input(a.held, a.pressed));
    }
    assert.equal(unlocks.length, 1, `chamber ${chamber + 1}: the replay clears the chamber`);
    const replay = g.getState();
    assert.equal(replay.score, recorded.state.score);
    assert.equal(replay.time, recorded.state.time);
    assert.equal(replay.hp, recorded.state.hp);
  }
});

// ------------------------------------------------------------ a whole campaign

const wonCampaigns = new Map();
function wonCampaign() {
  for (const seed of seedsOf(6)) {
    if (!wonCampaigns.has(seed)) {
      wonCampaigns.set(seed, playPolicy({ hz: 60, seed, campaign: true }));
    }
    if (wonCampaigns.get(seed).g.getState().phase === 'won') return wonCampaigns.get(seed);
  }
  assert.fail('no campaign was won in six tries');
}

test('quality: a casual player can play the whole campaign through to the end', () => {
  let wins = 0;
  const seeds = seedsOf(8);
  for (const seed of seeds) {
    const r = playPolicy({
      hz: 60,
      seed,
      minDelay: 0.4,
      span: 0.2,
      policy: makeCasualPolicy(),
      campaign: true,
    });
    assert.equal(r.h.ends.length, 1, 'every campaign ends exactly once');
    if (r.g.getState().phase === 'won') wins++;
  }
  assert.ok(wins >= 3, `${wins}/${seeds.length} casual campaigns won`);
});

test('quality: clearing a chamber unlocks the next, in order, and the last win keeps the last', () => {
  const r = wonCampaign();
  const expected = [...Array.from({ length: CHAMBER_COUNT - 1 }, (_, i) => i + 2), CHAMBER_COUNT];
  assert.deepEqual(r.unlocks.slice(0, expected.length), expected.slice(0, r.unlocks.length));
  assert.equal(r.unlocks.length, CHAMBER_COUNT, 'one unlock per cleared chamber');
  assert.equal(r.unlocks.at(-1), CHAMBER_COUNT);
  // a lost run unlocks nothing further than the chambers cleared before the loss
  const lost = playPolicy({
    hz: 60,
    seed: 1,
    chamber: 4,
    policy: () => ({ held: [], pressed: [] }),
  });
  assert.equal(lost.h.ends.length, 1);
  assert.equal(lost.h.ends[0].won, false);
  assert.deepEqual(lost.unlocks, []);
});

test('quality: a won campaign ends once, freezes, and a new game starts from scratch', () => {
  const r = wonCampaign();
  const s = r.g.getState();
  assert.equal(s.phase, 'won');
  assert.equal(r.h.ends.length, 1);
  assert.equal(r.h.ends[0].won, true);
  assert.equal(r.h.ends[0].score, s.score);
  assert.match(r.h.ends[0].message, new RegExp(`all ${CHAMBER_COUNT} chambers`, 'i'));
  assert.equal(r.h.sounds.at(-1), 'win');
  const frozen = JSON.stringify(s);
  for (let i = 0; i < 300; i++) r.g.update(1 / 60, input(['Space', 'ArrowUp'], ['KeyX']));
  assert.equal(JSON.stringify(r.g.getState()), frozen);
  assert.equal(r.h.ends.length, 1);
  const fresh = createGame(harness({ seed: 2 }).env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.chamber, 1);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.hp, 4);
  assert.ok(s.chamber === CHAMBER_COUNT && s.score > 5000);
});

// ------------------------------------------------------------ crude play must not win

const crude = {
  'hold Space only': () => ({ held: ['Space'], pressed: [] }),
  'do nothing': () => ({ held: [], pressed: [] }),
  'Space + mash X standing still': (() => {
    let n = 0;
    return () => ({ held: ['Space'], pressed: n++ % 24 === 0 ? ['KeyX'] : [] });
  })(),
  'spin with Space and X': (() => {
    let n = 0;
    const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    return () => {
      n++;
      return { held: ['Space', dirs[(n >> 6) % 4]], pressed: n % 24 === 0 ? ['KeyX'] : [] };
    };
  })(),
  // Open-loop scripts that read nothing: hold Space, tap X on a timer, wander in a fixed cycle.
  ...Object.fromEntries(
    [
      ['blind 0.2 s X, 0.67 s walk', 12, 40],
      ['blind 0.5 s X, 1 s walk', 30, 60],
      ['blind 0.2 s X, 0.33 s walk', 12, 20],
      ['blind 0.3 s X, 1.3 s walk', 18, 80],
    ].map(([name, every, walk]) => [name, { every, walk }]),
  ),
  'mash X only': () => ({ held: [], pressed: [] }),
};
// each script is built fresh per run so its counter starts at zero
function blindScript(name) {
  const spec = crude[name];
  let n = 0;
  if (
    typeof spec === 'function' &&
    name !== 'Space + mash X standing still' &&
    name !== 'spin with Space and X' &&
    name !== 'mash X only'
  ) {
    return spec;
  }
  if (name === 'Space + mash X standing still') {
    return () => ({ held: ['Space'], pressed: n++ % 24 === 0 ? ['KeyX'] : [] });
  }
  if (name === 'spin with Space and X') {
    const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    return () => {
      n++;
      return { held: ['Space', dirs[(n >> 6) % 4]], pressed: n % 24 === 0 ? ['KeyX'] : [] };
    };
  }
  if (name === 'mash X only') return () => ({ held: [], pressed: n++ % 12 === 0 ? ['KeyX'] : [] });
  const dirs = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  return () => {
    const i = n++;
    return {
      held: ['Space', dirs[Math.floor(i / spec.walk) % 4]],
      pressed: i % spec.every === 0 ? ['KeyX'] : [],
    };
  };
}

test('quality: in every chamber blind and spam scripts win at most half the time (and the pull alone harms nothing)', () => {
  for (const chamber of ALL) {
    for (const name of Object.keys(crude)) {
      let wins = 0;
      const seeds = seedsOf(8);
      for (const seed of seeds) {
        const r = playPolicy({ hz: 60, seed, chamber, maxSeconds: 100, policy: blindScript(name) });
        if (r.cleared) wins++;
      }
      assert.ok(wins <= seeds.length / 2, `chamber ${chamber + 1} "${name}": ${wins}/8 wins`);
    }
  }
  // Attraction by itself never harms an enemy: foes keep every point of armor.
  for (const chamber of [0, 12]) {
    const stand = playPolicy({
      hz: 60,
      seed: 2,
      chamber,
      maxSeconds: 25,
      policy: blindScript('hold Space only'),
    });
    const s = stand.g.getState();
    assert.ok(s.foes.every((f) => f.hp === f.maxHp));
    assert.equal(s.score, 0);
  }
});

// ------------------------------------------------------------ prompts

test('quality: one always-true prompt names the keys; messages hold 0.7 s and never flip back quickly', () => {
  const [en, zh] = PROMPTS.play;
  assert.match(en, /Space.*X/);
  assert.match(zh, /空格.*X/);
  const shown = [];
  for (const chamber of SAMPLE) {
    for (const seed of [1, 2]) {
      let cur = null,
        since = 0;
      playPolicy({
        hz: 120,
        seed,
        chamber,
        observe: (s) => {
          assert.equal(s.prompt.key, 'play', 'the standing prompt never changes');
          // only real events carry a dwell promise; lane warnings and advice are condition-bound
          const text = s.messageKind === 'event' ? s.message.en : null;
          const preempted = s.messageKind === 'lane' || s.messageKind === 'attack';
          if (text !== cur && !preempted) {
            if (cur !== null) shown.push({ text: cur, d: s.time - since });
            cur = text;
            since = s.time;
          }
        },
      });
    }
  }
  assert.ok(shown.length > 30);
  const shortest = Math.min(...shown.map((e) => e.d));
  assert.ok(shortest >= 0.7 - 1e-6, `a message was readable for only ${shortest} s`);
});

const inAnyLane = (s) =>
  s.foes.some(
    (f) =>
      f.lane &&
      inLane(s.player, {
        type: f.type,
        state: f.state,
        x: f.x,
        y: f.y,
        hw: f.hw,
        dirx: f.lane.x,
        diry: f.lane.y,
      }),
  );
const crossesMachine = (p, f, m) => {
  const dx = f.x - p.x,
    dy = f.y - p.y;
  const t = Math.max(0, Math.min(1, ((m.x - p.x) * dx + (m.y - p.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x + dx * t - m.x, p.y + dy * t - m.y) < m.hw;
};

test('quality: lane warnings and X advice always match the screen they describe', () => {
  for (const chamber of SAMPLE) {
    for (const seed of [1, 2]) {
      playPolicy({
        hz: 120,
        seed,
        chamber,
        observe: (s) => {
          // the warning is shown exactly while the player stands in a live lane, no earlier, no later
          assert.equal(
            s.messageKind === 'lane',
            inAnyLane(s),
            `lane warning mismatch at ${s.time}`,
          );
          // the attack warning never shows without a live wind-up, and a live one is never hidden by
          // anything except a lane warning or a fresh event
          const winding = s.foes.some((f) => f.state === 'wind' && !f.spawning);
          if (s.messageKind === 'attack') assert.ok(winding, 'attack warning without a wind-up');
          if (winding && s.messageKind === 'advice') assert.fail('advice shown over a live attack');
          if (s.messageKind === 'attack') assert.match(s.message.en, /^Machine \d under attack!$/);
          if (s.messageKind === 'advice') {
            const en = s.message.en;
            if (/^No lock-on/.test(en)) assert.ok(!s.aim && !s.aimBlocked && s.held > 0, en);
            if (/^Line of fire blocked/.test(en)) assert.ok(!s.aim && s.aimBlocked, en);
            if (/^Nothing in orbit/.test(en)) assert.equal(s.held, 0, en);
          }
          if (s.aim) {
            const target = s.foes.find((f) => f.id === s.aim);
            assert.ok(s.machines.every((m) => !crossesMachine(s.player, target, m)));
          }
        },
      });
    }
  }
});

// ------------------------------------------------------------ physics and fairness in real play

test('quality: during real play metal stays inside the arena, below launch speed, and gains energy only from stated sources', () => {
  let ticks = 0;
  for (const chamber of SAMPLE) {
    let prev = null;
    playPolicy({
      hz: 120,
      seed: 1,
      chamber,
      maxSeconds: 120,
      observe: (s) => {
        ticks++;
        for (const m of s.metals) {
          assert.ok(m.x > ARENA.x0 && m.x < ARENA.x1 && m.y > ARENA.y0 && m.y < ARENA.y1);
          assert.ok(m.speed <= REPEL_V + 1e-6);
          for (const b of s.walls) {
            assert.ok(
              !(m.x > b.x0 - m.hw && m.x < b.x1 + m.hw && m.y > b.y0 - m.hw && m.y < b.y1 + m.hw),
              `metal inside a solid at ${m.x},${m.y}`,
            );
          }
          const before = prev?.metals.find((e) => e.id === m.id);
          if (before && prev.chamber === s.chamber && !m.held && !before.held) {
            const gain = m.speed - before.speed;
            const stated = s.events.includes('repel') || s.events.includes('attract');
            // A foe walking or dashing into a piece can hand it a little of its own motion.
            const shoved = m.contacts.some((id) => id.startsWith('f')) && gain <= 330;
            // Pull gives at most ATTRACT_A / mass * dt per tick (4 px/s); bounces never add speed.
            assert.ok(gain <= 4.01 || stated || shoved, `gained ${gain} px/s in one tick`);
          }
        }
        prev = s;
      },
    });
  }
  assert.ok(ticks > 5000);
});

test('quality: every hit on the player or machinery was telegraphed and nothing hurts at the start', () => {
  for (const chamber of SAMPLE) {
    for (const seed of [1, 2]) {
      let prev = null;
      const warned = { time: -99 };
      playPolicy({
        hz: 60,
        seed,
        chamber,
        observe: (s) => {
          if (s.foes.some((f) => f.state === 'wind' || f.lane)) warned.time = s.time;
          if (prev && prev.chamber === s.chamber) {
            const hit = prev.machines.filter((m, i) => s.machines[i].hp < m.hp);
            // damage from the player's own fast metal needs no wind-up; everything else does
            const ownMetal = hit.some((m) =>
              prev.metals.some((q) => q.fast && Math.hypot(q.x - m.x, q.y - m.y) < 40),
            );
            if (hit.length && !ownMetal) {
              assert.ok(
                s.time - warned.time < 2.5,
                'machinery was struck without a visible wind-up',
              );
            }
            if (s.hp < prev.hp) {
              assert.ok(
                prev.foes.some((f) => f.state === 'dash'),
                'only a charge hurts the player',
              );
              assert.ok(s.time - warned.time < 3, 'the charge was not telegraphed by a lane');
            }
          }
          prev = s;
        },
      });
    }
  }
  // A player who never acts is never hurt during the first seconds of any chamber.
  for (const chamber of ALL) {
    const r = playPolicy({
      hz: 60,
      seed: 1,
      chamber,
      maxSeconds: 4,
      policy: () => ({ held: [], pressed: [] }),
    });
    const s = r.g.getState();
    assert.equal(s.hp, 4, `chamber ${chamber + 1}`);
    assert.ok(s.machines.every((m) => m.hp === MACHINE_HP));
  }
});

test('quality: standing still loses fairly without any hidden deadline', () => {
  for (const chamber of [0, 9, 20]) {
    const r = playPolicy({
      hz: 60,
      seed: 3,
      chamber,
      maxSeconds: 400,
      policy: () => ({ held: [], pressed: [] }),
    });
    assert.equal(r.h.ends.length, 1);
    assert.equal(r.h.ends[0].won, false);
    const s = r.g.getState();
    assert.ok(s.time > 15, `chamber ${chamber + 1} lost after ${s.time}s`);
    assert.ok(s.machines.some((m) => m.hp === 0));
    assert.match(s.status.en, new RegExp(`Chamber ${chamber + 1}/${CHAMBER_COUNT}`));
  }
});

// ------------------------------------------------------------ layout

test('quality: the screen keeps HUD bands clear, text 14-16 px and actors big during real play', () => {
  const ctx = mockContext();
  const texts = [];
  ctx.fillText = (text, x, y) => texts.push({ text, x, y, font: ctx.font });
  const hudRects = [];
  ctx.fillRect = (x, y, w, h) => {
    if (y < 30 || y >= 294) hudRects.push({ x, y, w, h });
  };
  const seen = new Set();
  for (const chamber of [0, 11, 24]) {
    playPolicy({
      hz: 60,
      seed: 4,
      chamber,
      observe: (s, g) => {
        for (const a of [s.player, ...s.foes, ...s.machines]) {
          assert.ok(a.hw * 2 >= 16 && a.hh * 2 >= 16, 'actors are at least 16 px');
          assert.ok(
            a.y - a.hh >= ARENA.y0 && a.y + a.hh <= ARENA.y1,
            'actors stay between the HUD bands',
          );
        }
        seen.add(s.message?.en ?? s.prompt.key);
        if (Math.round(s.time * 60) % 15 === 0) g.draw(ctx);
      },
    });
  }
  assert.ok(texts.length > 100);
  for (const t of texts) {
    const size = Number(/(\d+)px/.exec(t.font)[1]);
    assert.ok(size >= 14 && size <= 16);
    assert.ok(t.y + size <= 30 || t.y >= 294, 'text sits inside a HUD band');
  }
  assert.ok(hudRects.length > 0 && FIELD_R < 160 && ARMOR_V > 0);
  assert.ok(seen.size >= 3, `prompts seen: ${[...seen]}`);
});

test('quality: prompt flip-backs within 2 s stay under 10% at every rate and delay band', () => {
  // metric: change i goes back to the prompt shown two changes earlier, and the prompt between
  // them lasted under 2 s. With one standing prompt there are no changes at all.
  for (const hz of HZ) {
    for (const [minDelay, span] of [
      [0.15, 0.2],
      [0.4, 0.2],
    ]) {
      let changes = 0,
        flips = 0;
      for (const chamber of [0, 12, 24]) {
        const log = [];
        playPolicy({
          hz,
          seed: 1,
          chamber,
          minDelay,
          span,
          observe: (s) => {
            if (!log.length || log.at(-1).key !== s.prompt.key) {
              log.push({ key: s.prompt.key, t: s.time });
            }
          },
        });
        for (let i = 2; i < log.length; i++) {
          changes++;
          if (log[i].key === log[i - 2].key && log[i].t - log[i - 1].t < 2) flips++;
        }
      }
      assert.ok(flips <= 0.1 * Math.max(changes, 1), `${hz} Hz: ${flips}/${changes}`);
    }
  }
});

// A brute is already at a machine and the player starts on the machine's far side from it, so the
// line of fire to the brute runs through the machine: the casual player must work out how to
// get a clear shot (the grey bracket says the line is blocked).
function casualAtMachine(seed, chamber, machine, offset) {
  const w = createWorld(seeded(seed), chamber);
  const k = w.machines[machine];
  w.foes = [];
  w.pending = [{ type: 'brute', x: k.x + 30, y: k.y, after: 0 }];
  spawnPending(w);
  w.foes[0].spawnT = 0;
  w.p.x = k.x + offset[0];
  w.p.y = k.y + offset[1];
  const policy = makeCasualPolicy();
  const history = [];
  const delay = 0.4 + (seed % 5) * 0.05;
  for (let t = 0; t < 90 && w.phase === 'playing' && w.defeated < 1; t += 1 / 60) {
    history.push({ t, s: snapshot(w) });
    if (history.length > 80) history.shift();
    const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
    const a = policy(seen.s);
    for (let i = 0; i < 2; i++) stepWorld(w, STEP, input(a.held, i === 0 ? a.pressed : []));
  }
  return w.defeated >= 1 && w.phase === 'playing';
}

test('quality: a casual player at a machine whose line to the attacking brute is blocked still gets the kill', () => {
  for (const [chamber, machine, offset] of [
    [10, 0, [-30, 0]],
    [10, 1, [0, 40]],
    [12, 0, [-30, 0]],
    [12, 1, [-30, 0]],
  ]) {
    let wins = 0;
    for (const seed of seedsOf(10)) if (casualAtMachine(seed, chamber, machine, offset)) wins++;
    assert.ok(wins >= 8, `chamber ${chamber + 1} machine ${machine + 1}: ${wins}/10`);
  }
});

test('quality: no event message ever flashes for a tick or two (a replaced event never reappears)', () => {
  let runs = 0;
  for (const chamber of SAMPLE) {
    for (const seed of [1, 2, 3, 4]) {
      const log = [];
      playPolicy({
        hz: 120,
        seed,
        chamber,
        observe: (s) => {
          const key = `${s.messageKind}:${s.message?.en ?? ''}`;
          if (!log.length || log.at(-1).key !== key) log.push({ key, t: s.time });
        },
      });
      for (let i = 0; i < log.length - 1; i++) {
        if (!log[i].key.startsWith('event:')) continue;
        runs++;
        const shown = log[i + 1].t - log[i].t;
        assert.ok(shown >= 0.05, `seed ${seed}: "${log[i].key}" flashed for ${shown} s`);
      }
    }
  }
  assert.ok(runs > 50);
});
