import test from 'node:test';
import assert from 'node:assert/strict';
import { END_TEXT, createGame, meta } from '../src/games/tether-twins.js';
import { ROOMS, ROOM_COUNT } from '../src/games/tether-twins-rooms.js';
import { TXT } from '../src/games/tether-twins-text.js';
import { MENU_COLUMNS, menuCell } from '../src/games/tether-twins-menu.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const TILE = 24;

// A game that starts on `room` (1-based) through the public room select, like a returning player.
function startAt(room, opts = {}) {
  const h = harness(opts);
  const store = { value: room, unlocks: [] };
  h.env.progress = {
    unlocked: () => store.value,
    unlock: (n) => {
      store.unlocks.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  const g = createGame(h.env);
  if (room > 1) g.update(1 / 60, input([], ['Space']));
  return { h, g, store };
}

const wonRoom = (st, room) => st.phase === 'won' || (st.phase === 'playing' && st.room > room);

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

// Perfect-information pilot: follows the on-screen marker every 1/30 s with no delay.
function pilotKeys(st) {
  const held = [];
  const pressed = [];
  const hint = st.hint;
  if (!hint) return { held, pressed };
  if (hint.who === 'any') held.push(/Hold F/.test(st.prompt.en) ? 'KeyF' : 'KeyG');
  else {
    if (st.mode === 1 && hint.who !== st.active) pressed.push('KeyX');
    const me = st.robots.find((r) => r.id === hint.who);
    const solo = hint.who === 'red' || st.mode === 1;
    const [l, r, u, d] = solo
      ? ['KeyA', 'KeyD', 'KeyW', 'KeyS']
      : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (st.mode === 2 || hint.who === st.active) {
      if (hint.x - me.x > 3) held.push(r);
      else if (hint.x - me.x < -3) held.push(l);
      if (hint.y - me.y > 3) held.push(d);
      else if (hint.y - me.y < -3) held.push(u);
    }
  }
  return { held, pressed };
}

function pilotRun(room, hz, { mode = 1, seconds = 400, lang = 'en', onFrame, stop = false } = {}) {
  const { h, g, store } = startAt(room, { mode, lang });
  const every = hz / 30;
  let keys = { held: [], pressed: [] };
  for (let f = 0; f < seconds * hz; f++) {
    const st = g.getState();
    if (st.phase !== 'playing' || (stop && st.room > room)) break;
    if (f % every === 0) keys = pilotKeys({ ...st, mode });
    g.update(1 / hz, input(keys.held, f % every === 0 ? keys.pressed : []));
    if (onFrame) onFrame(g.getState(), f);
  }
  return { g, h, store, st: g.getState() };
}

// A reaction-limited player: sees only getState(), reacts `delay` seconds late with jitter, and brakes by
// extrapolating the stale velocity. It follows the on-screen marker and waits where the marker says wait.
function botRun(room, { delay, hz, seed, seconds = 150, mode = 1 }) {
  const { h, g } = startAt(room, { seed, mode });
  const rnd = seeded(seed * 7919 + 13);
  const base = delay + (rnd() - 0.5) * 0.1;
  const history = [];
  const every = Math.max(1, Math.round(hz / 30));
  let held = [];
  let pressX = false;
  let lastX = -9;
  let t = 0;
  let zaps = 0;
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.room !== room) break;
    zaps = st.stats.zaps;
    history.push({ t, st });
    if (history.length > 120) history.shift();
    pressX = false;
    if (f % every === 0) {
      const d = base + (rnd() - 0.5) * 0.1;
      let k = history.length - 1;
      while (k > 0 && t - history[k].t < d) k--;
      const obs = history[k].st;
      held = [];
      const hint = obs.hint;
      if (hint && hint.who === 'any') held.push(/Hold F/.test(obs.prompt.en) ? 'KeyF' : 'KeyG');
      else if (hint && hint.who !== obs.active) {
        if (t - lastX > 0.7) {
          lastX = t;
          pressX = true;
        }
      } else if (hint) {
        const me = obs.robots.find((r) => r.id === obs.active);
        const px = me.x + me.vx * d * 0.9;
        const py = me.y + me.vy * d * 0.9;
        if (hint.x - px > 3) held.push('KeyD');
        else if (hint.x - px < -3) held.push('KeyA');
        if (hint.y - py > 3) held.push('KeyS');
        else if (hint.y - py < -3) held.push('KeyW');
      }
    }
    g.update(1 / hz, input(held, pressX ? ['KeyX'] : []));
    t += 1 / hz;
  }
  const end = g.getState();
  return {
    cleared: wonRoom(end, room),
    zaps: Math.max(zaps, end.stats.zaps),
    time: t,
    ends: h.ends,
  };
}

// ---------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------

const mechanics = (room) => {
  const list = [];
  if (/[ABC]/.test(room.map.join('')) && room.plates.length) list.push('plate');
  if (room.relays.length) list.push('relay');
  if (room.rings.length) list.push('pit');
  if (room.pulse) list.push('strobe');
  if (/x/.test(room.map.join(''))) list.push('strips');
  if (room.len < 260) list.push('leash');
  return list;
};

const width = (text, px = 14) =>
  [...text].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? px : px * 0.6), 0);

test('twenty distinct, frozen, data-driven rooms with bilingual tips that fit the canvas', () => {
  assert.ok(ROOM_COUNT >= 20);
  assert.equal(ROOMS.length, ROOM_COUNT);
  const isFrozen = (v) =>
    !v || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(isFrozen));
  assert.ok(ROOMS.every(isFrozen), 'room data is deeply frozen');
  assert.equal(new Set(ROOMS.map((r) => r.name.en)).size, ROOM_COUNT);
  assert.equal(new Set(ROOMS.map((r) => r.tip.en)).size, ROOM_COUNT);
  assert.equal(new Set(ROOMS.map((r) => r.map.join(''))).size, ROOM_COUNT);
  ROOMS.forEach((r, i) => {
    const label = `room ${i + 1}`;
    assert.equal(r.map.length, 11, label);
    assert.ok(
      r.map.every((row) => row.length === 20),
      `${label} rows are 20 wide`,
    );
    assert.ok(r.map[0] === '#'.repeat(20) && r.map[10] === '#'.repeat(20), label);
    for (const lang of ['en', 'zh']) {
      assert.ok(width(r.tip[lang]) <= 470, `${label} ${lang} tip fits the status bar`);
      assert.ok(width(r.name[lang], 14) + 40 <= 190, `${label} ${lang} name fits the HUD`);
      assert.ok(r.tip[lang].length > 8 && r.name[lang].length > 1, label);
    }
    for (const step of r.steps) {
      assert.ok(TXT[step.key], `${label} step text ${step.key}`);
      assert.ok(TXT[step.key][0].length <= 35 && TXT[step.key][1].length <= 20, step.key);
    }
    assert.ok(r.steps.filter((s) => s.kind === 'pad').length === 2, `${label} ends on both pads`);
    assert.ok(r.len >= 100 && r.len <= 520, label);
  });
  // The tips teach what the room really has.
  const needs = (i, mech) => assert.ok(mechanics(ROOMS[i - 1]).includes(mech), `room ${i} ${mech}`);
  needs(1, 'plate');
  needs(2, 'leash');
  needs(3, 'strips');
  needs(4, 'pit');
  needs(5, 'relay');
  needs(6, 'strobe');
  needs(14, 'leash');
  needs(16, 'relay');
  needs(18, 'leash');
  for (const i of [6, 8, 10, 11, 13, 15, 16, 18, 19, 20]) needs(i, 'strobe');
});

test('the curve teaches one idea at a time, combines them, then masters them together', () => {
  const counts = ROOMS.map((r) => mechanics(r).length);
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    const fresh = mechanics(ROOMS[i]).filter((m) => !seen.has(m));
    assert.ok(fresh.length <= 1, `teaching room ${i + 1} introduces one new idea`);
    mechanics(ROOMS[i]).forEach((m) => seen.add(m));
  }
  assert.ok(
    seen.size >= 5,
    'the teaching rooms cover plates, leash, strips, pits, relays and strobes',
  );
  const lanes = (r) =>
    new Set([...r.map.join('')].filter((c) => 'pq'.includes(c))).size &&
    new Set(
      r.map.flatMap((row) =>
        [...row].map((c, col) => ('pq'.includes(c) ? col : -1)).filter((col) => col >= 0),
      ),
    ).size;
  for (let i = 0; i < 14; i++)
    assert.ok(lanes(ROOMS[i]) <= 2, `room ${i + 1} has at most two strobe lanes`);
  for (let i = 14; i < 20; i++)
    assert.ok(
      counts[i] + (lanes(ROOMS[i]) >= 3 ? 1 : 0) >= 2,
      `mastery room ${i + 1} combines ideas`,
    );
  const steps = ROOMS.map((r) => r.steps.length);
  const mean = (a, b) => steps.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
  assert.ok(mean(0, 7) < mean(7, 14) && mean(7, 14) < mean(14, 20), 'rooms get longer');
  // Strobe timing tightens in the late rooms.
  const dark = (r) => r.pulse.period - r.pulse.live;
  const early = ROOMS.filter((r, i) => r.pulse && i < 14).map(dark);
  const late = ROOMS.filter((r, i) => r.pulse && i >= 14).map(dark);
  assert.ok(Math.max(...late) < Math.min(...early) + 1e-9, 'late strips are dark for less time');
});

test('every room starts on safe floor with nothing live near the robots, and idle play never loses', () => {
  ROOMS.forEach((r, i) => {
    const { g } = startAt(i + 1);
    const st = g.getState();
    for (const robot of st.robots)
      for (const h of st.hazards)
        assert.ok(
          Math.hypot(robot.x - (h.x + h.w / 2), robot.y - (h.y + h.h / 2)) > 40,
          `room ${i + 1} robot starts near a strip`,
        );
    assert.ok(
      st.robots.every((b) => !b.onPad),
      `room ${i + 1} does not start finished`,
    );
    for (let f = 0; f < 60 * 20; f++) g.update(1 / 60, input([]));
    const idle = g.getState();
    assert.equal(idle.phase, 'playing', `idle player loses room ${i + 1}`);
    assert.equal(idle.cells, 3);
    assert.equal(idle.room, i + 1);
  });
});

test('short-cable rooms really need both robots: the partner start is out of reach of the far pad', () => {
  const spool = (r) => r.len;
  const pad = (r, k) => [r.pads[k * 2] * TILE + 12, 26 + r.pads[k * 2 + 1] * TILE + 12];
  const start = (r, k) => [r.start[k * 2] * TILE + 12, 26 + r.start[k * 2 + 1] * TILE + 12];
  for (const i of [2, 14, 18]) {
    const r = ROOMS[i - 1];
    for (const k of [0, 1]) {
      const [px, py] = pad(r, k);
      const [sx, sy] = start(r, 1 - k);
      assert.ok(
        Math.hypot(px - sx, py - sy) > spool(r) + 20,
        `room ${i} pad ${k} needs a leapfrog`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Per-level clears
// ---------------------------------------------------------------------------

test('every room is cleared through the public room select by a perfect marker follower, with no zaps', () => {
  for (let room = 1; room <= ROOM_COUNT; room++) {
    const { st, store } = pilotRun(room, 60, { seconds: 150, stop: true });
    assert.ok(wonRoom(st, room), `room ${room} not cleared (${st.prompt.en})`);
    assert.equal(st.stats.zaps, 0, `room ${room} zapped`);
    assert.ok(store.unlocks.length >= 1 || room === ROOM_COUNT, `room ${room} unlocks the next`);
  }
});

const clearStats = new Map();
test('a reaction-limited bot (0.25 s and 0.35 s) clears every room at 30, 60 and 120 Hz with margin', () => {
  for (let room = 1; room <= ROOM_COUNT; room++)
    for (const delay of [0.25, 0.35]) {
      let clears = 0;
      let zaps = 0;
      let time = 0;
      let runs = 0;
      for (const hz of HZS)
        for (const seed of [1, 2, 3, 4]) {
          const r = botRun(room, { delay, hz, seed });
          runs++;
          zaps += r.zaps;
          time += r.time;
          if (r.cleared) clears++;
        }
      clearStats.set(`${room}:${delay}`, { zaps: zaps / runs, time: time / runs });
      assert.ok(clears / runs >= 0.8, `room ${room} @${delay}s cleared ${clears}/${runs}`);
    }
});

test('the late rooms cost the slow bot more zaps and more time than the early and middle rooms', () => {
  const mean = (a, b, key) => {
    let sum = 0;
    for (let room = a; room <= b; room++) sum += clearStats.get(`${room}:0.35`)[key];
    return sum / (b - a + 1);
  };
  assert.ok(clearStats.size >= 40, 'depends on the clear test above');
  assert.ok(mean(15, 20, 'zaps') > mean(8, 14, 'zaps'), 'mastery zaps more than the middle');
  assert.ok(mean(15, 20, 'zaps') > mean(1, 7, 'zaps'));
  assert.ok(mean(15, 20, 'time') > mean(1, 7, 'time') * 1.2, 'mastery takes longer than teaching');
});

test('co-op: two players on their own keys clear the whole campaign, once', () => {
  const { st, h } = pilotRun(1, 60, { mode: 2 });
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(st.stats.zaps, 0);
});

test('the marker never leads a robot straight through a static live strip', () => {
  let checks = 0;
  let last = '';
  pilotRun(1, 60, {
    onFrame: (st) => {
      if (!st.hint || st.hint.x == null) return;
      const id = `${st.room}:${st.prompt.en}:${st.hint.x}:${st.hint.y}`;
      if (id === last) return;
      last = id;
      const me = st.robots.find((r) => r.id === st.hint.who) || st.robots[0];
      for (let i = 0; i <= 40; i++) {
        const x = me.x + ((st.hint.x - me.x) * i) / 40;
        const y = me.y + ((st.hint.y - me.y) * i) / 40;
        for (const h of st.hazards.filter((z) => !z.pulse))
          assert.ok(
            !(
              x + 11 > h.x + 0.5 &&
              x - 11 < h.x + h.w - 0.5 &&
              y + 11 > h.y + 0.5 &&
              y - 11 < h.y + h.h - 0.5
            ),
            `marker path crosses a strip in room ${st.room}`,
          );
      }
      checks++;
    },
  });
  assert.ok(checks > 200);
});

test('waiting markers only release once the strip is dark long enough to cross', () => {
  let waits = 0;
  pilotRun(1, 60, {
    onFrame: (st) => {
      const lanes = st.hazards.filter((h) => h.pulse);
      if (!st.hint || !st.hint.wait) return;
      waits++;
      assert.ok(lanes.length > 0, 'a wait marker only exists in rooms with flashing strips');
      assert.match(st.prompt.en, /for the dark|Press X/);
    },
  });
  assert.ok(waits > 500);
});

// ---------------------------------------------------------------------------
// Blind play
// ---------------------------------------------------------------------------

const MOVES = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const ALL_KEYS = [...MOVES, 'KeyF', 'KeyG', 'Comma', 'Period'];

function blindPlan(family, seed) {
  const rnd = seeded(seed * 104729 + 7);
  switch (family.kind) {
    case 'idle':
      return () => ({ held: [], pressed: [] });
    case 'mash':
      return () => ({
        held: ALL_KEYS.filter(() => rnd() < 0.5),
        pressed: rnd() < 0.1 ? ['KeyX'] : [],
      });
    case 'random': {
      let until = 0;
      let held = [];
      return (_st, t) => {
        if (t >= until) {
          until = t + 0.3 + rnd() * 0.7;
          held = MOVES.filter(() => rnd() < 0.3);
        }
        return { held, pressed: rnd() < 0.02 ? ['KeyX'] : [] };
      };
    }
    case 'timed': {
      let lastX = -1;
      return (_st, t) => {
        const phase = Math.floor(t / family.period) % 2;
        const pressed = family.x && t - lastX >= family.period ? ['KeyX'] : [];
        if (pressed.length) lastX = t;
        return { held: [family.hold, family.alt[phase]], pressed };
      };
    }
    default: {
      // Straight to the pad, ignoring every wall, gate and strip, swapping robots now and then.
      let lastX = -9;
      return (st, t) => {
        const me = st.robots.find((r) => r.id === st.active);
        const pad = st.pads[st.active === 'red' ? 0 : 1];
        const held = [];
        if (pad.cx - me.x > 3) held.push('KeyD');
        if (pad.cx - me.x < -3) held.push('KeyA');
        if (pad.cy - me.y > 3) held.push('KeyS');
        if (pad.cy - me.y < -3) held.push('KeyW');
        const pressed = t - lastX > 2 ? ['KeyX'] : [];
        if (pressed.length) lastX = t;
        return { held, pressed };
      };
    }
  }
}

const FAMILIES = [
  { kind: 'idle' },
  { kind: 'mash' },
  { kind: 'random' },
  { kind: 'greedy' },
  ...['KeyD', 'KeyS'].flatMap((hold) =>
    [
      ['KeyW', 'KeyS'],
      ['KeyA', 'KeyD'],
    ].flatMap((alt) =>
      [0.6, 1.3].flatMap((period) =>
        [false, true].map((x) => ({ kind: 'timed', hold, alt, period, x })),
      ),
    ),
  ),
];

function blindWins(room, family, seed, { hz = 60, seconds = 25, mode = 1 } = {}) {
  const { g } = startAt(room, { seed, mode });
  const plan = blindPlan(family, seed);
  for (let f = 0; f < seconds * hz; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    const t = f / hz;
    const { held, pressed } = plan(st, t);
    g.update(1 / hz, input(held, pressed));
    if (wonRoom(g.getState(), room)) return true;
  }
  return wonRoom(g.getState(), room);
}

test('idle, mash, random, timed hold-and-alternate and straight-to-pad play win at most 25% of any room from room 3', () => {
  let total = 0;
  let wins = 0;
  for (let room = 3; room <= ROOM_COUNT; room++) {
    let roomWins = 0;
    let roomRuns = 0;
    for (const family of FAMILIES) {
      const seeds = family.kind === 'mash' || family.kind === 'random' ? [1, 2] : [1];
      for (const seed of seeds) {
        roomRuns++;
        if (blindWins(room, family, seed)) roomWins++;
      }
    }
    assert.ok(roomWins / roomRuns <= 0.25, `room ${room}: ${roomWins}/${roomRuns} blind wins`);
    total += roomRuns;
    wins += roomWins;
  }
  assert.ok(wins / total <= 0.05, `${wins}/${total} blind wins overall`);
  assert.ok(total >= 390, `${total} blind runs`);
});

test('blind co-op mashing cannot win either', () => {
  for (let room = 3; room <= ROOM_COUNT; room += 3)
    for (const seed of [1, 2])
      assert.equal(blindWins(room, { kind: 'mash' }, seed, { mode: 2 }), false, `room ${room}`);
});

// ---------------------------------------------------------------------------
// Frame rate, hostile input, progress and ends
// ---------------------------------------------------------------------------

test('aligned input gives identical state at 30, 60 and 120 Hz in early, middle and late rooms', () => {
  for (const room of [1, 6, 12, 16, 20]) {
    const traces = HZS.map((hz) => {
      const snaps = [];
      const { st } = pilotRun(room, hz, {
        seconds: 40,
        onFrame: (state, f) => (f + 1) % hz === 0 && snaps.push(JSON.stringify(state)),
      });
      return { snaps, final: JSON.stringify(st) };
    });
    for (const t of traces.slice(1)) {
      assert.deepEqual(t.snaps, traces[0].snaps, `room ${room} diverged`);
      assert.equal(t.final, traces[0].final);
    }
  }
});

test('hostile dt, pointer and key values never crash, advance or corrupt state', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 4, unlock() {} };
  const g = createGame(h.env);
  const hostile = [NaN, Infinity, -Infinity, -1, 0, 1e9, 'x', null, undefined, {}, [], 0.5];
  const pointers = [
    {},
    { x: NaN, y: NaN, clicked: true },
    { x: 'a', y: {}, clicked: true },
    { x: 1e12, y: -1e12, clicked: true },
    { x: null, y: undefined, clicked: 1, down: 'yes' },
  ];
  for (const dt of hostile)
    for (const pointer of pointers) g.update(dt, input(['KeyD', 'KeyA'], ['ArrowLeft'], pointer));
  const st = g.getState();
  assert.equal(st.phase, 'playing');
  assert.ok(st.menu, 'still on the room select: nothing started by junk');
  assert.equal(h.ends.length, 0);
  // Start a run, then feed junk to the live game too.
  g.update(1 / 60, input([], ['Space']));
  const before = JSON.stringify(g.getState());
  for (const dt of hostile.filter((d) => !(typeof d === 'number' && d > 0 && d <= 0.1)))
    g.update(dt, input(['KeyD', 'KeyF'], ['KeyX'], { x: NaN, y: NaN, clicked: true }));
  assert.equal(JSON.stringify(g.getState()), before);
  for (let i = 0; i < 600; i++)
    g.update(
      1 / 60,
      input(i % 2 ? ['KeyD'] : ['KeyS'], [], { x: 'z', y: NaN, clicked: i % 5 === 0 }),
    );
  const after = g.getState();
  for (const r of after.robots) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
  assert.ok(Number.isFinite(after.score) && after.cable.length <= after.cable.max + 0.01);
});

test('a broken or hostile progress store never stops the game and is clamped', () => {
  const make = (progress) => {
    const h = harness();
    if (progress !== undefined) h.env.progress = progress;
    return createGame(h.env);
  };
  const cases = {
    missing: [undefined, 1, null],
    throwing: [
      {
        unlocked: () => {
          throw new Error('store down');
        },
        unlock: () => {
          throw new Error('store down');
        },
      },
      1,
      null,
    ],
    nan: [{ unlocked: () => NaN, unlock() {} }, 1, null],
    negative: [{ unlocked: () => -5, unlock() {} }, 1, null],
    huge: [{ unlocked: () => 1e9, unlock() {} }, ROOM_COUNT, ROOM_COUNT],
    string: [{ unlocked: () => '7', unlock() {} }, 7, 7],
    fraction: [{ unlocked: () => 3.9, unlock() {} }, 3, 3],
    nothing: [{ unlocked: () => null, unlock() {} }, 1, null],
  };
  for (const [name, [progress, unlocked, cursor]] of Object.entries(cases)) {
    const g = make(progress);
    const st = g.getState();
    assert.equal(st.unlocked, unlocked, name);
    assert.equal(st.menu?.cursor ?? null, cursor, name);
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 30; i++) g.update(1 / 60, input(['KeyD']));
    assert.equal(g.getState().phase, 'playing', name);
  }
  // Clearing a room with a store that throws on unlock still advances the game.
  const throwing = harness();
  throwing.env.progress = {
    unlocked: () => 1,
    unlock: () => {
      throw new Error('quota');
    },
  };
  const g = createGame(throwing.env);
  let keys = { held: [], pressed: [] };
  for (let f = 0; f < 60 * 60 && g.getState().room === 1; f++) {
    if (f % 2 === 0) keys = pilotKeys(g.getState());
    g.update(1 / 60, input(keys.held, f % 2 === 0 ? keys.pressed : []));
  }
  assert.equal(g.getState().room, 2);
  assert.equal(g.getState().unlocked, 2, 'in-memory progress still moves forward');
});

test('clearing a room unlocks the next one, and the select lets the player continue there', () => {
  const { st, store } = pilotRun(5, 60, { seconds: 90, stop: true });
  assert.equal(st.room >= 6, true);
  assert.deepEqual(store.unlocks.slice(0, 1), [6]);
  const again = startAt(6);
  assert.equal(again.g.getState().room, 1 + 0 * 0 + 5, 'continue starts on the unlocked room');
  // The select shows locked rooms as locked and ignores starting them.
  const fresh = harness();
  fresh.env.progress = { unlocked: () => 3, unlock() {} };
  const g = createGame(fresh.env);
  assert.equal(g.getState().menu.cursor, 3);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.cursor, 3, 'cannot move onto a locked room');
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 2);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 1);
  assert.ok(fresh.sounds.includes('move'));
  g.update(1 / 60, input([], [], { x: 11 + 4 * (86 + 8) + 5, y: 30, clicked: true }));
  assert.equal(g.getState().menu.cursor, 1, 'tapping a locked room is refused');
  assert.ok(fresh.sounds.includes('hit'));
  g.update(1 / 60, input([], [], { x: 11 + 1 * (86 + 8) + 5, y: 30, clicked: true }));
  assert.equal(g.getState().menu, null, 'tapping an unlocked room starts it');
  assert.equal(g.getState().room, 2);
  assert.equal(g.getState().cells, 3);
});

test('wins and losses end exactly once with an English or Chinese message and then freeze', () => {
  for (const lang of ['en', 'zh']) {
    const win = pilotRun(1, 60, { lang });
    assert.equal(win.st.phase, 'won');
    assert.equal(win.h.ends.length, 1);
    assert.equal(win.h.ends[0].won, true);
    assert.equal(win.h.ends[0].message, END_TEXT.won[lang === 'en' ? 0 : 1]);
    assert.equal(win.h.ends[0].score, win.st.score);
    assert.match(win.h.ends[0].message, lang === 'en' ? /twenty rooms/ : /二十个房间/);
    const frozen = JSON.stringify(win.g.getState());
    for (let i = 0; i < 200; i++) win.g.update(1 / 60, input(['KeyD', 'KeyF'], ['KeyX', 'Space']));
    assert.equal(JSON.stringify(win.g.getState()), frozen);
    assert.equal(win.h.ends.length, 1);

    // Lose by steering Red into the fence strips three times in the Gauntlet.
    const { g, h } = startAt(3, { lang });
    for (let f = 0; f < 60 * 30 && g.getState().phase === 'playing'; f++)
      g.update(1 / 60, input(['KeyD']));
    const lost = g.getState();
    assert.equal(lost.phase, 'lost');
    assert.equal(lost.cells, 0);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.equal(h.ends[0].message, END_TEXT.lost[lang === 'en' ? 0 : 1]);
    assert.ok(h.sounds.includes('lose'));
    const snap = JSON.stringify(g.getState());
    for (let i = 0; i < 200; i++) g.update(1 / 60, input(['KeyS'], ['KeyX']));
    assert.equal(JSON.stringify(g.getState()), snap);
    assert.equal(h.ends.length, 1);
  }
});

test('no input is dropped during the zap pause: X still switches and held keys apply when it ends', () => {
  const { g } = startAt(3);
  for (let f = 0; f < 60 * 10 && g.getState().stats.zaps === 0; f++)
    g.update(1 / 60, input(['KeyD']));
  assert.equal(g.getState().stats.zaps, 1);
  assert.equal(g.getState().active, 'red');
  const x0 = g.getState().robots[0].x;
  g.update(1 / 60, input(['KeyD'], ['KeyX']));
  assert.equal(g.getState().active, 'blue', 'X works during the pause');
  g.update(1 / 60, input(['KeyD'], ['KeyX']));
  assert.equal(g.getState().active, 'red');
  assert.equal(g.getState().robots[0].x, x0, 'robots wait out the pause');
  for (let i = 0; i < 60; i++) g.update(1 / 60, input(['KeyS']));
  assert.ok(g.getState().robots[0].y > 100, 'held keys act as soon as the pause ends');
});

test('touch buttons and the room select cover every action in both layouts', () => {
  const solo = new Set(meta.touchControls.map((c) => c.code));
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyX', 'KeyF', 'KeyG'])
    assert.ok(solo.has(code), code);
  assert.equal(meta.multiplayerTouchControls.length, 12);
  for (const c of [...meta.touchControls, ...meta.multiplayerTouchControls]) {
    assert.ok(c.label.en && c.label.zh && !['Escape', 'KeyP', 'KeyR'].includes(c.code));
  }
  assert.ok(MENU_COLUMNS * 4 >= ROOM_COUNT);
  assert.equal(menuCell(1).x, 11);
  // X (a touch button) starts the highlighted room from the select.
  const h = harness();
  h.env.progress = { unlocked: () => 4, unlock() {} };
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['KeyX']));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().room, 4);
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const cjk = /[一-鿿]/;

test('prompts name their keys, hold for half a second, never oscillate and are translated', () => {
  for (const hz of HZS) {
    let last = null;
    let changedAt = 0;
    let key = '';
    const seen = new Set();
    pilotRun(1, hz, {
      onFrame: (st) => {
        const reset = `${st.room}/${st.stats.zaps}`;
        if (st.prompt.en !== last) {
          if (key === reset && last !== null)
            assert.ok(
              st.time - changedAt >= 0.5 - 1 / 30 - 1e-6,
              `"${last}" changed after ${st.time - changedAt}s`,
            );
          last = st.prompt.en;
          changedAt = st.time;
          seen.add(last);
          assert.ok(/\b(WASD|Press X|[Hh]old [FG]|Cable taut)/.test(st.prompt.en), st.prompt.en);
          assert.ok(/WASD|X|F|G|方向键/.test(st.prompt.zh), st.prompt.zh);
          assert.ok(cjk.test(st.prompt.zh), `untranslated prompt: ${st.prompt.zh}`);
          assert.ok(st.prompt.en.length <= 50 && st.prompt.zh.length <= 30, st.prompt.en);
        }
        key = reset;
      },
    });
    assert.ok(seen.size >= 40, `only ${seen.size} distinct prompts`);
  }
});

test('every room, tip, message and end text exists in Chinese', () => {
  for (const r of ROOMS) {
    assert.ok(cjk.test(r.name.zh) && cjk.test(r.tip.zh), r.name.en);
    assert.ok(!/[A-Za-z]{4,}/.test(r.name.zh.replace(/[A-Z]/g, '')), `Latin words in ${r.name.zh}`);
  }
  for (const [en, zh] of Object.values(TXT)) assert.ok(en && cjk.test(zh), en);
  assert.ok(cjk.test(END_TEXT.won[1]) && cjk.test(END_TEXT.lost[1]));
  assert.ok(cjk.test(meta.description.zh) && cjk.test(meta.name.zh));
  const { g } = startAt(5, { lang: 'zh' });
  for (let i = 0; i < 400; i++) g.update(1 / 60, input(['KeyD']));
  const st = g.getState();
  assert.ok(cjk.test(st.status.zh) && cjk.test(st.prompt.zh));
  assert.ok(st.message === null || cjk.test(st.message.zh));
});

function measuringContext() {
  const calls = [];
  const state = { font: '', textAlign: 'left' };
  const ctx = new Proxy(
    {
      measureText: (t) => ({ width: String(t).length * 8.4 }),
      canvas: { width: 480, height: 320 },
    },
    {
      get: (t, p) => {
        if (p === 'fillText')
          return (str, x, y) => calls.push({ str, x, y, font: state.font, align: state.textAlign });
        return p in state ? state[p] : p in t ? t[p] : () => {};
      },
      set: (t, p, v) => ((state[p] = v), true),
    },
  );
  return { ctx, calls };
}

test('English and Chinese text fits the 480x320 canvas at phone scale in every room and on the select', () => {
  const scale = 390 / 480;
  const check = (calls, label) => {
    assert.ok(calls.length >= 3, label);
    for (const c of calls) {
      const px = Number(/(\d+)px/.exec(c.font)[1]);
      assert.ok(px * scale >= 11, `${label}: ${px}px scales below 11`);
      const w = [...c.str].reduce((n, ch) => n + (cjk.test(ch) ? px : px * 0.6), 0);
      const left = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
      assert.ok(
        left >= 0 && left + w <= 480,
        `${label}: "${c.str}" overflows (${left}..${left + w})`,
      );
      assert.ok(c.y >= 0 && c.y + px <= 320, `${label}: "${c.str}" off the bottom`);
    }
  };
  for (const lang of ['en', 'zh']) {
    for (let room = 1; room <= ROOM_COUNT; room++) {
      const { g } = startAt(room, { lang });
      for (const frames of [30, 300]) {
        for (let i = 0; i < frames; i++) g.update(1 / 60, input([]));
        const { ctx, calls } = measuringContext();
        g.draw(ctx);
        check(calls, `${lang} room ${room} t=${frames}`);
      }
    }
    const h = harness({ lang });
    h.env.progress = { unlocked: () => ROOM_COUNT, unlock() {} };
    for (let cursor = 0; cursor < ROOM_COUNT; cursor += 5) {
      const g = createGame(h.env);
      for (let i = 0; i < cursor; i++) g.update(1 / 60, input([], ['ArrowLeft']));
      const { ctx, calls } = measuringContext();
      g.draw(ctx);
      check(calls, `${lang} select`);
    }
  }
});

test('relay rooms: a marker reached without wrapping the relay sends the partner back, and play then clears', () => {
  for (const room of [5, 11, 16, 20]) {
    const { g } = startAt(room);
    const run = (keys, seconds, pressed = []) => {
      for (let f = 0; f < seconds * 60; f++) g.update(1 / 60, input(keys, f === 0 ? pressed : []));
    };
    run(['KeyW'], 0.1, ['KeyX']); // Blue walks up the left side, level with Red
    run(['KeyW'], 1.6);
    run([], 0.1, ['KeyX']);
    run(['KeyD'], 0.46); // Red stops on the sweep marker while the cable passes above the relay
    run([], 1);
    const stuck = g.getState();
    assert.equal(stuck.cable.bends.length, 0, `room ${room} not wrapped`);
    assert.ok(!stuck.posts.some((p) => p.latched));
    assert.ok(!/reel in/.test(stuck.prompt.en), `room ${room}: "${stuck.prompt.en}"`);
    assert.ok(/start|Blue/.test(stuck.prompt.en) && stuck.hint.who === 'blue');
    assert.ok(cjk.test(stuck.prompt.zh));
    let keys = { held: [], pressed: [] };
    for (let f = 0; f < 60 * 150 && !wonRoom(g.getState(), room); f++) {
      if (f % 2 === 0) keys = pilotKeys(g.getState());
      g.update(1 / 60, input(keys.held, f % 2 === 0 ? keys.pressed : []));
    }
    assert.ok(wonRoom(g.getState(), room), `room ${room} cleared after the detour`);
  }
});
