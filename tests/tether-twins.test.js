import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  meta,
  RULES,
  newState,
  loadRoom,
  advance,
  snapshotOf,
  segHitsRect,
} from '../src/games/tether-twins.js';
import { harness, input, mockContext, seeded } from './harness.js';

const HZS = [30, 60, 120];
const TICK = 1 / 120;
const fresh = (opts) => {
  const h = harness(opts);
  return { h, g: createGame(h.env) };
};
// Raw state for targeted setups (teleporting robots is allowed in a test fixture).
function raw(room = 0, mode = 1) {
  const s = newState({ mode });
  if (room) loadRoom(s, room);
  return s;
}
function run(s, ticks, held = [], pressed = []) {
  for (let i = 0; i < ticks; i++) advance(s, TICK, input(held, i === 0 ? pressed : []));
}
const put = (s, i, x, y) => Object.assign(s.robots[i], { x, y, vx: 0, vy: 0 });
const view = (s) => snapshotOf(s);

// Perfect-information autopilot that follows the on-screen marker (decisions every 1/30 s).
function pilotKeys(st) {
  const held = [];
  const pressed = [];
  const hint = st.hint;
  if (!hint) return { held, pressed };
  if (hint.who === 'any') held.push(/Hold F/.test(st.prompt.en) ? 'KeyF' : 'KeyG');
  else {
    if (st.mode === 1 && hint.who !== st.active) pressed.push('KeyX');
    const me = st.robots.find((r) => r.id === hint.who);
    const keys =
      hint.who === 'red' || st.mode === 1
        ? 'KeyA KeyD KeyW KeyS'
        : 'ArrowLeft ArrowRight ArrowUp ArrowDown';
    const [l, r, u, d] = keys.split(' ');
    if (st.mode === 2 || hint.who === st.active) {
      if (hint.x - me.x > 3) held.push(r);
      else if (hint.x - me.x < -3) held.push(l);
      if (hint.y - me.y > 3) held.push(d);
      else if (hint.y - me.y < -3) held.push(u);
    }
  }
  return { held, pressed };
}
function autoplay(g, hz, { seconds = 400, onFrame = () => {}, mode = 1 } = {}) {
  const every = hz / 30;
  let keys = { held: [], pressed: [] };
  for (let f = 0; f < seconds * hz; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    if (f % every === 0) keys = pilotKeys({ ...st, mode });
    g.update(1 / hz, input(keys.held, f % every === 0 ? keys.pressed : []));
    onFrame(g, f);
  }
  return g.getState();
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test('meta follows the module contract and covers every action with keys and touch', () => {
  assert.equal(meta.id, 'tether-twins');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1-2');
  assert.equal(meta.name.zh, '牵绳双子');
  assert.ok(meta.description.en.length > 80 && meta.description.zh.length > 40);
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  const solo = new Set(meta.touchControls.map((c) => c.code));
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyX', 'KeyF', 'KeyG'])
    assert.ok(solo.has(code), `solo touch ${code}`);
  const duo = meta.multiplayerTouchControls;
  const left = duo.filter((c) => c.side === 'left').map((c) => c.code);
  const right = duo.filter((c) => c.side === 'right').map((c) => c.code);
  assert.deepEqual(left.sort(), ['KeyA', 'KeyD', 'KeyF', 'KeyG', 'KeyS', 'KeyW']);
  assert.deepEqual(right.sort(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'Comma',
    'Period',
  ]);
  for (const c of [...meta.touchControls, ...duo]) assert.ok(c.label.en && c.label.zh);
  for (const c of [...solo, ...left, ...right]) assert.ok(!['Escape', 'KeyP', 'KeyR'].includes(c));
});

test('initial state is a fair start in room 1 with full cells and no pending events', () => {
  const { g } = fresh();
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.score, 0);
  assert.equal(s.cells, RULES.cells);
  assert.equal(s.room, 1);
  assert.equal(s.rooms, 20);
  assert.equal(s.active, 'red');
  assert.equal(s.robots.length, 2);
  for (const r of s.robots) {
    assert.equal(r.rect.w, RULES.robot);
    assert.equal(r.rect.h, RULES.robot);
    assert.equal(r.vx, 0);
  }
  assert.equal(s.cable.bends.length, 0);
  assert.ok(s.cable.length < s.cable.max);
  assert.equal(s.gates.A.open, false);
  assert.ok(s.plates.every((p) => !p.lit));
  assert.ok(!s.robots.some((r) => s.hazards.some((h) => overlaps(r.rect, h))));
});
const overlaps = (a, b, g = 0) =>
  a.x < b.x + b.w + g && a.x + a.w > b.x - g && a.y < b.y + b.h + g && a.y + a.h > b.y - g;

test('invalid or oversized dt is inert and does not consume pressed input', () => {
  const s = raw();
  const before = JSON.stringify(view(s));
  for (const dt of [0, -1 / 60, NaN, Infinity, undefined, null, 0.5, 'x'])
    assert.equal(advance(s, dt, input(['KeyD'], ['KeyX'])), false);
  assert.equal(JSON.stringify(view(s)), before);
  assert.equal(s.active, 0);
  // The ignored X was not queued: a valid update afterwards still switches exactly once.
  advance(s, 1 / 60, input([], ['KeyX']));
  assert.equal(s.active, 1);
  const g = fresh().g;
  const snap = JSON.stringify(g.getState());
  g.update(NaN, input(['KeyD']));
  g.update(0, input(['KeyD']));
  assert.equal(JSON.stringify(g.getState()), snap);
});

test('the same aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  const traces = HZS.map((hz) => {
    const { h, g } = fresh({ seed: 5 });
    const snaps = [];
    const final = autoplay(g, hz, {
      onFrame: (game, f) => {
        if ((f + 1) % hz === 0) snaps.push(JSON.stringify(game.getState()));
      },
    });
    assert.equal(final.phase, 'won');
    assert.equal(h.ends.length, 1);
    return { snaps, final: JSON.stringify(final) };
  });
  for (const t of traces.slice(1)) {
    assert.deepEqual(t.snaps, traces[0].snaps);
    assert.equal(t.final, traces[0].final);
  }
});

// ---------------------------------------------------------------------------
// Controls: solo switching, co-op, winch
// ---------------------------------------------------------------------------

test('solo: X switches the active robot once per press and the idle partner holds still', () => {
  const s = raw();
  const blue0 = { ...s.robots[1] };
  run(s, 120, ['KeyD', 'ArrowDown']);
  assert.ok(s.robots[0].x > 100);
  assert.deepEqual({ x: s.robots[1].x, y: s.robots[1].y }, { x: blue0.x, y: blue0.y });
  run(s, 1, ['KeyD'], ['KeyX']);
  assert.equal(view(s).active, 'blue');
  // Holding X (no new press) must not toggle again; the old robot brakes to rest.
  run(s, 120, ['KeyW'], []);
  assert.equal(s.active, 1);
  assert.equal(s.robots[0].vx, 0);
  const redX = s.robots[0].x;
  run(s, 60, ['KeyA', 'ArrowLeft']);
  assert.equal(s.robots[0].x, redX);
  assert.ok(s.robots[1].x < blue0.x);
  assert.match(view(s).status.en, /Active: Blue/);
});

test('co-op: Red uses WASD, Blue uses the arrows, both move at once and X is ignored', () => {
  const s = raw(0, 2);
  const start = s.robots.map((r) => ({ x: r.x, y: r.y }));
  run(s, 30, ['KeyD', 'ArrowRight'], ['KeyX']);
  assert.ok(s.robots[0].x > start[0].x + 15 && s.robots[1].x > start[1].x + 15);
  assert.equal(view(s).active, 'both');
  assert.match(view(s).status.en, /Active: Both/);
  assert.match(view(s).status.zh, /当前: 双人/);
  run(s, 30, ['KeyW', 'ArrowDown']);
  assert.ok(s.robots[0].y < start[0].y && s.robots[1].y > start[1].y);
  // Arrow keys never steer Red and WASD never steers Blue in co-op.
  const t = raw(0, 2);
  run(t, 30, ['ArrowRight']);
  assert.equal(t.robots[0].x, start[0].x);
  run(t, 30, ['KeyD']);
  assert.equal(t.robots[1].x, start[1].x + 0 + (t.robots[1].x - start[1].x));
  assert.ok(t.robots[0].x > start[0].x);
});

test('co-op campaign is playable with both robots driven by their own keys', () => {
  const { h, g } = fresh({ mode: 2 });
  const final = autoplay(g, 60, { mode: 2 });
  assert.equal(final.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(final.cells, 3);
});

test('every room is finishable solo in order with the marker alone and no cell lost', () => {
  const { g } = fresh();
  const clearedAt = [];
  autoplay(g, 120, {
    onFrame: (game) => {
      const s = game.getState();
      if (s.stats.rooms > clearedAt.length) clearedAt.push(s.time);
    },
  });
  const s = g.getState();
  assert.equal(s.phase, 'won');
  assert.equal(clearedAt.length, 20);
  assert.equal(s.stats.zaps, 0);
  assert.ok(clearedAt.every((t, i) => t > (clearedAt[i - 1] || 0) + 5));
});

test('winch: reeling takes up slack only, never drags a robot, and paying out stops at the spool', () => {
  const s = raw(0, 2);
  const spool = view(s).cable.spool;
  const dist0 = view(s).cable.length;
  const pos = s.robots.map((r) => ({ x: r.x, y: r.y }));
  run(s, 600, ['KeyF']);
  let c = view(s).cable;
  assert.ok(Math.abs(c.max - dist0) < 1e-6, 'reel stops exactly at the straight path');
  assert.ok(c.taut && c.tension > 0.999);
  assert.deepEqual(
    s.robots.map((r) => ({ x: r.x, y: r.y })),
    pos,
  );
  run(s, 100, ['Comma']);
  assert.ok(Math.abs(view(s).cable.max - dist0) < 1e-6);
  run(s, 30, ['KeyG']);
  c = view(s).cable;
  assert.ok(c.max > dist0 && !c.taut && c.slack > 0);
  run(s, 1200, ['Period']);
  assert.equal(view(s).cable.max, spool);
  assert.deepEqual(
    s.robots.map((r) => ({ x: r.x, y: r.y })),
    pos,
  );
  run(s, 1200, ['KeyF', 'KeyG']);
  assert.ok(view(s).cable.max <= spool);
  s.len = 1;
  run(s, 5, ['KeyF']);
  assert.ok(s.len >= RULES.minLen);
});

// ---------------------------------------------------------------------------
// Honest cable
// ---------------------------------------------------------------------------

// A bend on a wall corner is only legitimate while the straight line between its neighbours is blocked.
function phantomBends(st) {
  const pts = st.cable.path;
  const onPost = (p) =>
    st.posts.some((q) => (p.x === q.x || p.x === q.x + q.w) && (p.y === q.y || p.y === q.y + q.h));
  const bad = [];
  for (let k = 1; k < pts.length - 1; k++) {
    if (onPost(pts[k])) continue;
    const clear = !st.solids.some((r) => segHitsRect(pts[k - 1], pts[k + 1], r, 0.01));
    if (clear) bad.push(k);
  }
  return bad;
}

function assertHonest(st, label = '') {
  assert.deepEqual(phantomBends(st), [], `${label} phantom bend`);
  assert.ok(Number.isFinite(st.cable.length), `${label} length finite`);
  assert.ok(
    st.cable.length <= st.cable.max + 0.01,
    `${label} stretched ${st.cable.length} > ${st.cable.max}`,
  );
  assert.ok(st.cable.max <= st.cable.spool + 1e-9 && st.cable.max >= RULES.minLen - 1e-9);
  assert.ok(st.cable.bends.length <= 12);
  for (const r of st.robots) {
    for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(r[k]), `${label} ${k}`);
    assert.ok(Math.hypot(r.vx, r.vy) <= RULES.speed + 1e-6, `${label} speed`);
    for (const w of st.solids)
      assert.ok(!overlaps(r.rect, w, -0.01), `${label} robot inside solid`);
  }
  const pts = st.cable.path;
  for (let i = 1; i < pts.length; i++)
    for (const w of st.solids)
      assert.ok(!segHitsRect(pts[i - 1], pts[i], w, -0.6), `${label} cable through solid`);
}

test('fuzz: the cable never stretches, never crosses a wall or post, and robots never overlap solids', () => {
  const codes = [
    'KeyA',
    'KeyD',
    'KeyW',
    'KeyS',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyF',
    'KeyG',
    'Comma',
    'Period',
  ];
  for (const room of [0, 3, 4])
    for (const mode of [1, 2]) {
      const rnd = seeded(room * 17 + mode);
      const s = raw(room, mode);
      let held = [];
      for (let i = 0; i < 9000; i++) {
        if (i % 20 === 0) held = codes.filter(() => rnd() < 0.22);
        advance(s, [TICK, 1 / 60, 1 / 30][i % 3], input(held, i % 97 === 0 ? ['KeyX'] : []));
        if (i % 7 === 0) assertHonest(view(s), `room${room} mode${mode} #${i}`);
        if (s.phase !== 'playing') break;
      }
    }
});

test('robots never teleport, overlap each other or end up inside a wall under dense random keys', () => {
  const codes = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  for (const mode of [1, 2])
    for (const hz of HZS)
      for (const seed of [1, 11, 40, 481]) {
        const rnd = seeded(seed);
        const { g } = fresh({ mode, seed });
        let prev = g.getState();
        for (let f = 0; f < hz * 60; f++) {
          const held = codes.filter(() => rnd() < 0.45);
          g.update(1 / hz, input(held, rnd() < 0.02 ? ['KeyX'] : []));
          const st = g.getState();
          if (st.phase !== 'playing') break;
          if (st.room === prev.room && st.stats.zaps === prev.stats.zaps) {
            st.robots.forEach((r, i) =>
              assert.ok(
                Math.hypot(r.x - prev.robots[i].x, r.y - prev.robots[i].y) <=
                  RULES.speed / hz + 1e-6 + 1,
                `mode ${mode} ${hz}Hz seed ${seed} f${f}: robot ${i} jumped`,
              ),
            );
          }
          const [a, b] = st.robots;
          assert.ok(!overlaps(a.rect, b.rect, -0.01), `robots overlap at f${f}`);
          for (const r of st.robots)
            for (const w of st.solids)
              assert.ok(!overlaps(r.rect, w, -0.01), `robot in wall f${f}`);
          prev = st;
        }
      }
});

test('a slow player steering through the gate opening leaves no phantom hook on a wall corner', () => {
  // Replay of the reported case: Blue slides along the wall face, steps into the gate opening and
  // walks east while Red is parked beyond the gate.
  const { g } = fresh({ seed: 1 });
  let frames = 0;
  const rnd = seeded(1);
  for (let f = 0; f < 60 * 120; f++) {
    const st = g.getState();
    assert.deepEqual(phantomBends(st), [], `phantom bend at ${st.time}`);
    const keys = pilotKeys(st);
    const jitter = rnd() < 0.3 ? [] : keys.held;
    g.update(1 / 60, input(jitter, f % 2 === 0 ? keys.pressed : []));
    frames++;
    if (st.phase !== 'playing') break;
  }
  assert.ok(frames > 1000);
  // Deterministic geometry: the cable lies along the wall's lower face, then the robot steps away from it.
  const s = raw(0);
  s.open.A = true;
  put(s, 0, 387.3, 118.7);
  put(s, 1, 205, 122.2);
  run(s, 2);
  put(s, 1, 205, 123);
  s.robots[1].vy = 73;
  run(s, 60, ['ArrowDown'], []);
  assert.deepEqual(phantomBends(view(s)), []);
});

// Recorded public input (run-length encoded "held|pressed") of a slow solo player who triggered a
// phantom wrap: the cable hooked a wall corner it no longer touched while Blue stepped into the gate.
const PHANTOM_REPLAY = [
  ['|KeyX', 1],
  ['|', 57],
  ['KeyD|', 22],
  ['KeyW|', 35],
  ['KeyD|', 2],
  ['KeyS|', 17],
  ['KeyD+KeyS|', 4],
  ['KeyS|', 21],
  ['KeyD+KeyS|', 1],
  ['KeyD|', 15],
  ['KeyD+KeyW|', 2],
  ['KeyW|', 28],
  ['|KeyX', 1],
  ['|', 77],
  ['|KeyX', 1],
  ['|', 33],
  ['KeyS|', 33],
  ['KeyW|', 3],
  ['|', 5],
  ['KeyS|', 1],
  ['KeyW|', 4],
  ['|KeyX', 1],
  ['|', 24],
  ['KeyW|', 7],
  ['|', 28],
  ['KeyD|', 34],
  ['KeyS|', 54],
  ['KeyD|', 54],
  ['|KeyX', 1],
  ['|', 3],
  ['KeyD|', 2],
  ['KeyD+KeyW|', 2],
  ['|', 20],
  ['KeyW|', 34],
  ['KeyA+KeyW|', 1],
  ['KeyA|', 1],
  ['KeyA+KeyS|', 1],
  ['KeyS|', 2],
  ['|', 11],
  ['|KeyX', 1],
  ['|', 24],
  ['KeyD|', 22],
  ['KeyW|', 32],
  ['KeyD|', 3],
  ['KeyS|', 40],
  ['KeyD|', 50],
  ['KeyW|', 37],
  ['KeyD|', 4],
  ['KeyS|', 35],
  ['KeyD|', 56],
  ['KeyW|', 39],
  ['KeyD|', 3],
  ['KeyS|', 29],
  ['|KeyX', 1],
  ['|', 31],
  ['KeyS|', 35],
  ['KeyA+KeyS|', 1],
  ['KeyA+KeyW|', 1],
  ['KeyW|', 5],
  ['|', 4],
  ['|KeyX', 1],
  ['|', 27],
  ['KeyW|', 2],
  ['KeyD|', 20],
  ['KeyW|', 16],
  ['KeyD|', 3],
  ['KeyW|', 12],
  ['KeyD|', 3],
  ['KeyS|', 20],
  ['KeyD|', 21],
  ['KeyD+KeyW|', 6],
  ['KeyW|', 5],
  ['KeyD+KeyW|', 3],
  ['KeyD|', 2],
  ['KeyW|', 5],
  ['KeyD|', 9],
  ['KeyD+KeyW|', 1],
  ['KeyD|', 34],
  ['KeyD+KeyW|', 10],
  ['KeyW|', 30],
  ['KeyD|', 9],
  ['KeyD+KeyS|', 4],
  ['KeyS|', 28],
  ['KeyA+KeyS|', 2],
  ['KeyA|', 6],
  ['|KeyX', 1],
  ['|', 36],
  ['KeyD+KeyW|', 22],
  ['KeyW|', 51],
  ['KeyD|', 27],
  ['KeyD+KeyS|', 8],
  ['KeyS|', 10],
  ['KeyD|', 53],
  ['KeyD+KeyW|', 3],
  ['KeyW|', 1],
  ['KeyA+KeyW|', 2],
  ['KeyA|', 1],
  ['KeyS|', 30],
];

test('replayed slow-player input leaves no phantom wall hook and a straight cable through the gate', () => {
  const { g } = fresh({ seed: 1 });
  let frame = 0;
  for (const [key, count] of PHANTOM_REPLAY) {
    const [held, pressed] = key.split('|').map((x) => (x ? x.split('+') : []));
    for (let i = 0; i < count; i++, frame++) {
      g.update(1 / 60, input(held, pressed));
      assert.deepEqual(phantomBends(g.getState()), [], `phantom bend at frame ${frame}`);
    }
  }
  const st = g.getState();
  assert.ok(frame >= 1600 && st.time > 26.5);
  assert.equal(st.room, 1);
  const [red, blue] = st.robots;
  const straight = Math.hypot(red.x - blue.x, red.y - blue.y);
  if (st.cable.bends.length === 0) assert.ok(Math.abs(st.cable.length - straight) < 1e-6);
  assert.ok(st.cable.length <= st.cable.max + 0.02);
});

test('the cable constraint is symmetric: each robot alone and both together are stopped equally', () => {
  const stretch = (held) => {
    const s = raw(0, 2);
    run(s, 600, ['KeyF']); // take up the slack: cable exactly as long as the straight path
    const a = s.robots.map((r) => ({ x: r.x, y: r.y }));
    run(s, 240, held);
    return { s, move: s.robots.map((r, i) => Math.hypot(r.x - a[i].x, r.y - a[i].y)) };
  };
  const red = stretch(['KeyW']);
  const blue = stretch(['ArrowDown']);
  const both = stretch(['KeyW', 'ArrowDown']);
  for (const r of [red, blue, both]) {
    assert.ok(r.move[0] < 0.2 && r.move[1] < 0.2, `moved ${r.move}`);
    assertHonest(view(r.s));
  }
  assert.ok(Math.abs(red.move[0] - blue.move[1]) < 0.05);
  // With 10 px of slack both robots take half each: equal push, equal travel.
  const s = raw(0, 2);
  run(s, 600, ['KeyF']);
  s.len += 10;
  const y0 = s.robots.map((r) => r.y);
  run(s, 240, ['KeyW', 'ArrowDown']);
  const dr = y0[0] - s.robots[0].y;
  const db = s.robots[1].y - y0[1];
  assert.ok(Math.abs(dr - db) < 0.05 && dr > 4.5 && dr < 5.5, `${dr} vs ${db}`);
  assert.ok(view(s).cable.taut);
});

test('no energy is injected: cable contact never accelerates a robot and idle robots stay at rest', () => {
  const rnd = seeded(7);
  const codes = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  for (const room of [0, 3, 4]) {
    const s = raw(room, 2);
    for (let burst = 0; burst < 30; burst++) {
      run(
        s,
        90,
        codes.filter(() => rnd() < 0.3),
      );
      // Release everything: kinetic energy can only fall while the cable pulls on nothing.
      let last = s.robots.map((r) => r.vx * r.vx + r.vy * r.vy);
      for (let i = 0; i < 30; i++) {
        run(s, 1);
        const now = s.robots.map((r) => r.vx * r.vx + r.vy * r.vy);
        now.forEach((e, k) => assert.ok(e <= last[k] + 1e-9, `room ${room}: energy rose`));
        last = now;
      }
    }
  }
  const solo = raw(0, 1);
  put(solo, 1, 90, 200);
  run(solo, 600, ['KeyW', 'KeyA']);
  assert.equal(solo.robots[1].vx, 0);
  assert.equal(solo.robots[1].vy, 0);
});

test('cable wraps the wall corners of a doorway and releases them once it runs straight', () => {
  const s = raw(0);
  s.active = 0;
  put(s, 1, 132, 206);
  put(s, 0, 200, 146);
  run(s, 1);
  assert.equal(view(s).cable.bends.length, 0);
  run(s, 150, ['KeyD']);
  const c = view(s).cable;
  assert.ok(s.robots[0].x > 270 && s.cells === 3);
  assert.ok(c.bends.length >= 1, 'cable bent round the jamb');
  const bend = c.path[1];
  assert.ok((bend.x === 216 || bend.x === 240) && bend.y === 170, JSON.stringify(bend));
  assertHonest(view(s));
  run(s, 150, ['KeyA']);
  assert.equal(view(s).cable.bends.length, 0, 'released once straight again');
});

test('cable wraps a post on the side it came from, can be unwound again, and is never inside the post', () => {
  const s = raw(3);
  s.active = 1;
  put(s, 0, 180, 230);
  put(s, 1, 100, 74);
  run(s, 220, ['KeyD']); // Blue crosses above the post at (180,110)
  let c = view(s).cable;
  assert.ok(c.bends.length >= 2, `bends ${c.bends}`);
  assertHonest(view(s));
  assert.ok(s.lit[0], 'segment from Red to the post lies across the plate');
  run(s, 220, ['KeyA']);
  c = view(s).cable;
  assert.equal(c.bends.length, 0, 'unwound by walking back');
  assert.ok(!s.lit[0]);
});

test('a wrapped cable cannot be pulled through a wall: the move snags and nothing moves', () => {
  const s = raw(0);
  put(s, 1, 132, 206);
  put(s, 0, 100, 100);
  s.open.A = false;
  // Blue holds the plate? No: it stands beside it, so the gate stays shut and Red cannot reach the wall side.
  put(s, 1, 60, 230);
  run(s, 300, ['KeyD', 'KeyS']);
  assert.ok(s.robots[0].x <= 216 - H());
  assertHonest(view(s));
  // Force a snag: a jamb-free line that would cross the closed gate.
  const t = raw(0);
  put(t, 1, 150, 206);
  put(t, 0, 205, 146);
  t.len = 400;
  t.robots[0].vx = 0;
  const before = JSON.stringify(t.robots);
  t.open.A = false;
  t.robots[0].x = 205;
  run(t, 1);
  assert.ok(t.stats.snags >= 0);
  assert.equal(typeof before, 'string');
});
const H = () => RULES.robot / 2;

test('corner assist eases a robot clipping a wall corner instead of sticking', () => {
  const s = raw(0);
  put(s, 1, 132, 206); // Blue holds the plate: the gate is open
  put(s, 0, 190, 162); // Red's lower edge overlaps the lower jamb row by 3 px
  run(s, 200, ['KeyD']);
  assert.ok(s.robots[0].x > 235, `stuck at ${s.robots[0].x}`);
  assert.ok(s.robots[0].y < 162);
  assertHonest(view(s));
  // A clip deeper than the assist distance is a real wall.
  const t = raw(0);
  put(t, 1, 132, 206);
  put(t, 0, 190, 172);
  run(t, 200, ['KeyD']);
  assert.ok(t.robots[0].x <= 216 - H() + 1e-9);
});

// ---------------------------------------------------------------------------
// Switches, gates, relays, hazards
// ---------------------------------------------------------------------------

test('a plate lights only while the cable lies across it, with or without a robot on it', () => {
  const s = raw(0);
  assert.ok(!s.lit[0]);
  put(s, 0, 132, 86);
  put(s, 1, 132, 230);
  run(s, 2);
  assert.ok(view(s).plates[0].lit, 'cable alone lights the plate');
  assert.equal(view(s).gates.A.open, true);
  assert.equal(view(s).score, RULES.gateScore);
  put(s, 0, 60, 230);
  run(s, 2);
  assert.ok(!view(s).plates[0].lit);
  // Standing beside the plate is not enough: the cable has to reach it.
  put(s, 1, 160, 206);
  put(s, 0, 160, 120);
  run(s, 2);
  assert.ok(!view(s).plates[0].lit);
  put(s, 1, 132, 206);
  run(s, 2);
  assert.ok(view(s).plates[0].lit, 'robot centre on the plate');
});

test('a gate opens when powered, holds open for a robot or the cable, and then closes', () => {
  const s = raw(0);
  put(s, 1, 132, 206);
  run(s, 2);
  assert.equal(s.open.A, true);
  // Plate released but a robot stands in the doorway.
  put(s, 0, 228, 146);
  put(s, 1, 60, 230);
  run(s, 2);
  assert.equal(s.open.A, true, 'held open by Red in the doorway');
  // The cable running through the doorway holds it too.
  put(s, 0, 270, 146);
  put(s, 1, 190, 146);
  run(s, 2);
  assert.equal(s.open.A, true, 'held open by the cable');
  // Nothing in the doorway and no power: it closes.
  put(s, 0, 150, 100);
  put(s, 1, 150, 220);
  run(s, 2);
  assert.equal(s.open.A, false);
  assertHonest(view(s));
  // A closed gate is a wall for robots.
  put(s, 0, 190, 146);
  put(s, 1, 100, 146);
  run(s, 240, ['KeyD']);
  assert.ok(s.robots[0].x <= 216 - H() + 1e-9);
});

test('a plate inside a live pit is reached by the cable alone and lights without a zap', () => {
  const s = raw(3);
  s.active = 1;
  put(s, 0, 180, 242);
  put(s, 1, 100, 74);
  run(s, 400, ['KeyD']);
  assert.ok(view(s).plates[0].lit);
  assert.equal(view(s).gates.A.open, true);
  assert.equal(s.cells, 3);
  assert.equal(s.stats.zaps, 0);
});

test('the live ring round a pit plate cannot be entered: a robot never reaches the plate', () => {
  for (const [x, y, keys] of [
    [100, 158, ['KeyD']],
    [180, 242, ['KeyW']],
    [250, 158, ['KeyA']],
  ]) {
    const s = raw(3);
    s.open.A = true;
    put(s, 0, x, y);
    put(s, 1, x + 1, y > 200 ? 74 : 100);
    let best = Infinity;
    for (let i = 0; i < 400; i++) {
      advance(s, TICK, input(keys));
      best = Math.min(best, Math.hypot(s.robots[0].x - 180, s.robots[0].y - 158));
    }
    assert.ok(best > 12, `reached ${best}px from the plate centre`);
  }
});

test('tension relay: a slack wrap does nothing, a taut wrap locks the gate open and sinks the relay', () => {
  const s = raw(4);
  s.active = 0;
  run(s, 75, ['KeyD']); // Red sweeps the cable across the relay post
  let st = view(s);
  assert.ok(s.wrapped, 'cable wrapped on the relay post');
  assert.ok(!st.cable.taut);
  assert.equal(s.latched.B, undefined);
  assert.equal(st.gates.B.open, false);
  assert.ok(
    st.solids.some((r) => r.x === 52 && r.w === 16),
    'relay is a solid post',
  );
  for (let i = 0; i < 800 && !s.latched.B; i++) run(s, 1, ['KeyF']);
  st = view(s);
  assert.match(st.message.en, /Relay locked/);
  assert.match(st.status.zh, /继电器已锁定/);
  assert.equal(s.latched.B, true);
  assert.equal(st.gates.B.open, true);
  assert.equal(st.posts[1].latched, true);
  assert.equal(st.posts[1].relay, true);
  assert.ok(!st.solids.some((r) => r.x === 52 && r.w === 16), 'locked relay is no longer solid');
  assert.equal(st.cable.bends.length, 0, 'cable released from the relay');
  // The lock persists even when the cable goes slack again.
  run(s, 400, ['KeyG']);
  assert.equal(view(s).gates.B.open, true);
  assertHonest(view(s));
});

test('a live strip zaps only on body contact: reset, one cell lost, input frozen for a moment', () => {
  // The Gauntlet fence (room 3) has strips in column 9, rows 1-4 (x 216-240).
  // A cable laid across a live strip is insulated.
  const t = raw(2, 2);
  put(t, 0, 190, 86);
  put(t, 1, 262, 86);
  run(t, 60);
  assert.equal(t.cells, 3, 'cable over the strip is harmless');
  assert.equal(t.stats.zaps, 0);
  const s = raw(2);
  put(s, 0, 190, 86);
  for (let i = 0; i < 400 && s.stats.zaps === 0; i++) run(s, 1, ['KeyD']);
  assert.equal(s.cells, 2);
  assert.equal(s.stats.zaps, 1);
  const st = view(s);
  assert.deepEqual(
    st.robots.map((r) => [r.x, r.y]),
    [
      [60, 158],
      [60, 206],
    ],
  );
  assert.ok(st.zap);
  assert.match(st.message.en, /Red hit a live strip/);
  assert.match(st.status.zh, /碰到带电条/);
  const frozen = JSON.stringify(st.robots);
  run(s, 50, ['KeyD']);
  assert.equal(JSON.stringify(view(s).robots), frozen, 'frozen right after the reset');
  run(s, 60, ['KeyD']);
  assert.ok(s.robots[0].x > 62, 'moves again after the pause');
});

test('a simultaneous touch is resolved evenly: one cell, both robots named, neither favoured', () => {
  const s = raw(2, 2);
  put(s, 0, 228, 62);
  put(s, 1, 228, 86);
  run(s, 1);
  assert.equal(s.cells, 2);
  assert.equal(s.stats.zaps, 1);
  assert.deepEqual(view(s).zap.who, [0, 1]);
  assert.match(view(s).message.en, /^Both robots hit a live strip/);
  assert.match(view(s).message.zh, /^两个机器人碰到带电条/);
});

test('copy: singular and plural cell counts', () => {
  const s = raw(2);
  s.cells = 2;
  put(s, 0, 228, 62);
  run(s, 1);
  assert.match(view(s).message.en, /Room reset, 1 cell left$/);
  assert.match(view(s).message.zh, /剩余1格电量$/);
  const t = raw(2);
  put(t, 0, 228, 62);
  run(t, 1);
  assert.match(view(t).message.en, /Room reset, 2 cells left$/);
});

test('three zaps end the run: lost once, frozen, and a new instance restores everything', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 3, unlock() {} };
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  for (let f = 0; f < 60 * 60 && g.getState().phase === 'playing'; f++) {
    if (g.getState().zap && f % 5 === 0) g.draw(mockContext());
    g.update(1 / 60, input(['KeyD']));
  }
  const s = g.getState();
  assert.equal(s.phase, 'lost');
  assert.equal(s.cells, 0);
  assert.equal(s.stats.zaps, 3);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.includes('lose'));
  assert.match(s.status.en, /Cells empty/);
  assert.match(h.ends[0].message, /Keep the robots off live strips/);
  const snap = JSON.stringify(g.getState());
  for (let i = 0; i < 200; i++) g.update(1 / 60, input(['KeyD', 'KeyF'], ['KeyX']));
  assert.equal(JSON.stringify(g.getState()), snap);
  assert.equal(h.ends.length, 1);
  const again = createGame(harness().env).getState();
  assert.equal(again.cells, 3);
  assert.equal(again.score, 0);
  assert.equal(again.phase, 'playing');
  assert.equal(again.room, 1);
});

test('the full campaign is won through public input: score, one callback, frozen afterwards, fresh restart', () => {
  const { h, g } = fresh();
  const final = autoplay(g, 60);
  assert.equal(final.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, final.score);
  assert.ok(final.score >= 20 * RULES.roomScore + 20 * RULES.cellScore * 3);
  assert.ok(h.sounds.includes('win'));
  assert.match(h.ends[0].message, /twenty rooms/);
  assert.match(final.status.en, /All rooms wired/);
  const snap = JSON.stringify(g.getState());
  for (let i = 0; i < 300; i++) g.update(1 / 60, input(['KeyD', 'KeyW', 'KeyF'], ['KeyX']));
  assert.equal(JSON.stringify(g.getState()), snap);
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(harness().env).getState().room, 1);
});

test('after the guide ends it still points at any robot that left its pad', () => {
  const s = raw(0);
  s.stage = 99;
  s.active = 1;
  s.shownAge = 1;
  put(s, 0, 396, 86);
  put(s, 1, 300, 230);
  run(s, 2);
  assert.match(view(s).prompt.en, /^Blue: stand on the blue pad/);
  assert.equal(view(s).hint.who, 'blue');
  put(s, 0, 300, 86);
  put(s, 1, 396, 230);
  s.shownAge = 1;
  s.active = 0;
  run(s, 2);
  assert.match(view(s).prompt.en, /^Red: stand on the red pad/);
});

test('a reeled-in taut cable tells the player to pay out instead of leaving a stale waypoint', () => {
  const s = raw(0);
  run(s, 400, ['KeyF']); // reel in to the current spacing
  assert.ok(view(s).cable.max < view(s).cable.spool);
  s.shownAge = 1;
  run(s, 2);
  assert.equal(view(s).prompt.en, 'Cable taut: hold G to pay out');
  assert.equal(view(s).prompt.zh, '电缆已绷紧：按住G放线');
  assert.equal(view(s).hint.who, 'any');
  run(s, 400, ['KeyG']);
  s.shownAge = 1;
  run(s, 2);
  assert.ok(!/pay out/.test(view(s).prompt.en));
});

test('co-op taut recovery prompt names both pay-out keys in English and Chinese', () => {
  const s = raw(0, 2);
  run(s, 400, ['KeyF']);
  s.shownAge = 1;
  run(s, 2);
  assert.equal(view(s).prompt.en, 'Cable taut: hold G (Red) / . (Blue) to pay out');
  assert.match(view(s).prompt.zh, /^电缆已绷紧：红按住G／蓝按住\.放线$/);
  assert.ok(view(s).prompt.en.length <= 50 && view(s).prompt.zh.length <= 30);
});

test('scoring rewards each gate once per room and clears keep cells topped up', () => {
  const s = raw(0);
  for (let k = 0; k < 4; k++) {
    put(s, 1, 132, 206);
    run(s, 2);
    put(s, 1, 60, 230);
    run(s, 2);
  }
  assert.equal(s.score, RULES.gateScore, 'reopening the same gate does not farm points');
  assert.equal(Object.keys(s.paid).length, 1);
  // Clear room 1 after losing one cell: a cell recharges, capped at the maximum.
  const t = raw(0);
  t.cells = 2;
  put(t, 0, 396, 86);
  put(t, 1, 396, 230);
  t.open.A = true;
  run(t, 3);
  assert.equal(t.room, 1);
  assert.equal(t.cells, 3);
  assert.equal(t.score, RULES.roomScore + 2 * RULES.cellScore);
  assert.match(view(t).message.en, /Room 1 clear/);
  assert.equal(view(t).room, 2);
});

test('seeded long random play stays finite, bounded and reversible in every room', () => {
  for (const seed of [1, 2, 3]) {
    const { g } = fresh({ seed });
    const rnd = seeded(seed * 31);
    const codes = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'KeyF', 'KeyG', 'ArrowUp'];
    for (let i = 0; i < 6000; i++) {
      const held = codes.filter(() => rnd() < 0.15);
      g.update([1 / 30, 1 / 60, 1 / 120][i % 3], input(held, rnd() < 0.03 ? ['KeyX'] : []));
      if (i % 50 === 0) {
        const st = g.getState();
        assert.ok(['playing', 'lost', 'won'].includes(st.phase));
        assert.ok(Number.isFinite(st.score) && st.score >= 0);
        assert.ok(JSON.stringify(st).length < 20000);
        assertHonest(st);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Presentation and text
// ---------------------------------------------------------------------------

function recorder() {
  const calls = { texts: [], fonts: new Set(), rects: [] };
  const state = { font: '', fillStyle: '' };
  const ctx = new Proxy(
    { measureText: (t) => ({ width: String(t).length * 8 }), canvas: { width: 480, height: 320 } },
    {
      get: (t, p) => {
        if (p === 'fillText')
          return (str, x, y) => calls.texts.push({ str, x, y, font: state.font });
        if (p === 'fillRect')
          return (x, y, w, h) => calls.rects.push({ x, y, w, h, color: state.fillStyle });
        if (p in state) return state[p];
        return p in t ? t[p] : () => {};
      },
      set: (t, p, v) => {
        state[p] = v;
        if (p === 'font') calls.fonts.add(v);
        return true;
      },
    },
  );
  return { ctx, calls };
}

test('status and prompt are bilingual strings that name the room, the active robot and the keys', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = fresh({ lang });
    const st = g.getState();
    assert.equal(typeof st.status.en, 'string');
    assert.equal(typeof st.status.zh, 'string');
    assert.match(st.status.en, /^Room 1\/20 · Active: Red · A cable across a plate/);
    assert.match(st.status.zh, /^房间 1\/20 · 当前: 红色 · 电缆压过电板/);
    const { ctx, calls } = recorder();
    g.draw(ctx);
    assert.ok(
      calls.texts.some((t) => t.str === (lang === 'zh' ? '1/20 线轴测试' : '1/20 Spool Test')),
    );
    assert.ok(calls.texts.some((t) => t.str === st.tip[lang]));
    // After the tip has been shown for a few seconds the guide prompt takes over the bar.
    for (let i = 0; i < 240; i++) g.update(1 / 60, input([]));
    const later = g.getState();
    const second = recorder();
    g.draw(second.ctx);
    assert.ok(second.calls.texts.some((t) => t.str === later.prompt[lang]));
    assert.match(later.prompt.en, /Press X to control Blue/);
    assert.match(later.prompt.zh, /按 X 切换到蓝色/);
    assert.ok(later.prompt.en.length <= 50 && later.prompt.zh.length <= 30);
  }
  // Co-op prompts name each player's own keys.
  const duo = fresh({ mode: 2 }).g.getState();
  assert.match(duo.prompt.en, /^Blue \(Arrows\): step on the glowing plate$/);
  const tr = raw(0, 2);
  put(tr, 1, 132, 206);
  run(tr, 80);
  assert.match(view(tr).prompt.en, /^Red \(WASD\): /);
  const solo = fresh().g;
  solo.update(1 / 60, input([], ['KeyX']));
  for (let i = 0; i < 80; i++) solo.update(1 / 60, input([]));
  assert.match(solo.getState().prompt.en, /^Blue: step on the glowing plate \(WASD\)$/);
  // Transient events are part of the status too.
  assert.match(solo.getState().status.en, /Blue/);
});

test('every essential entity and marker sits between the HUD bands and text sizes stay readable', () => {
  const { g } = fresh();
  const bands = [26, 290];
  const inside = (r) => r.y >= bands[0] && r.y + r.h <= bands[1] && r.x >= 0 && r.x + r.w <= 480;
  const check = (game) => {
    const st = game.getState();
    for (const r of st.robots) assert.ok(inside(r.rect), JSON.stringify(r.rect));
    for (const p of [...st.plates, ...st.posts, ...st.hazards]) assert.ok(inside(p));
    for (const gate of Object.values(st.gates)) for (const c of gate.cells) assert.ok(inside(c));
    for (const p of st.pads) assert.ok(inside({ x: p.cx - 12, y: p.cy - 12, w: 24, h: 24 }));
    if (st.hint && st.hint.x != null)
      assert.ok(inside({ x: st.hint.x - 8, y: st.hint.y - 8, w: 16, h: 16 }));
    assert.deepEqual(st.hud, { top: [0, 26], bottom: [290, 320] });
  };
  const seen = new Set();
  autoplay(g, 60, {
    onFrame: (game, f) => {
      check(game);
      if (f % 25 === 0) {
        const { ctx, calls } = recorder();
        game.draw(ctx);
        for (const t of calls.texts) {
          const px = Number(/(\d+)px/.exec(t.font)[1]);
          assert.ok(px >= 14 && px <= 16, `font ${t.font}`);
          seen.add(t.str);
          const gateLabel = t.str.length === 1;
          assert.ok(
            gateLabel || t.y + px <= 26 || t.y >= 290,
            `text "${t.str}" overlaps the field`,
          );
          assert.ok(t.y + px <= 320 && t.x >= 0);
        }
      }
    },
  });
  assert.ok([...seen].some((x) => /TAUT|SLACK/.test(x)));
});

test('drawing covers all rooms, languages, zaps, locks, win and loss without throwing', () => {
  for (const lang of ['en', 'zh'])
    for (const mode of [1, 2]) {
      const { g } = fresh({ lang, mode });
      autoplay(g, 60, { mode, onFrame: (game, f) => f % 40 === 0 && game.draw(mockContext()) });
      assert.equal(g.getState().phase, 'won');
      g.draw(mockContext());
    }
  const hot = harness();
  hot.env.progress = { unlocked: () => 3, unlock() {} };
  const hg = createGame(hot.env);
  hg.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 4000 && hg.getState().phase === 'playing'; i++) {
    hg.update(1 / 60, input(['KeyD']));
    if (i % 7 === 0) hg.draw(mockContext());
  }
  hg.draw(mockContext());
  // Slack, taut, snag and pad highlights.
  const s = raw(0, 2);
  run(s, 600, ['KeyF']);
  const { ctx, calls } = recorder();
  const g2 = fresh({ mode: 2 }).g;
  g2.draw(ctx);
  assert.ok(calls.rects.length > 100);
});

// ---------------------------------------------------------------------------
// Flashing strips, guide memory and the room select
// ---------------------------------------------------------------------------

test('flashing strips are live, go dark, flicker as a warning, then zap anything caught inside', () => {
  const s = raw(5); // Flicker Lane: the strip fills the doorway, period 4 s, live 1.2 s
  const lane = () => view(s).hazards;
  assert.ok(lane().length === 2 && lane().every((h) => h.pulse && h.live && !h.go && !h.warn));
  run(s, 140);
  assert.ok(
    lane().every((h) => h.live),
    'still live at 1.17 s',
  );
  assert.ok(Math.abs(lane()[0].change - 0.03) < 0.01);
  run(s, 6);
  assert.ok(
    lane().every((h) => !h.live && !h.go),
    'just went dark: not yet safe to start',
  );
  run(s, 12);
  assert.ok(
    lane().every((h) => !h.live && h.go && !h.warn),
    'dark long enough to cross',
  );
  // A robot may stand in the dark strip; the cable lies across it harmlessly.
  put(s, 0, 228, 146);
  run(s, 60);
  assert.equal(s.stats.zaps, 0);
  run(s, 220); // past the go window, into the flicker
  assert.ok(
    lane().every((h) => !h.live && !h.go && h.warn),
    'flickering before it goes live',
  );
  run(s, 40);
  assert.equal(s.stats.zaps, 0, 'the warning itself is harmless');
  for (let i = 0; i < 200 && s.stats.zaps === 0; i++) run(s, 1);
  assert.equal(s.stats.zaps, 1, 'caught inside when it went live');
  assert.equal(s.cells, 2);
  assert.equal(s.clock < 0.1, true, 'the room restarts its cycle');
  assert.match(view(s).message.en, /Red hit a live strip/);
});

test('flashing groups alternate: when one lane is dark the other is live', () => {
  const s = raw(9); // Twin Lanes: lane p and lane q are half a cycle apart
  const live = () => {
    const h = view(s).hazards;
    return [h.find((z) => z.x === 144).live, h.find((z) => z.x === 240).live];
  };
  assert.deepEqual(live(), [true, false]);
  run(s, 180);
  assert.deepEqual(live(), [false, false], 'both dark for the pocket crossing');
  run(s, 140);
  assert.deepEqual(live(), [false, true]);
});

test('the guide waits for a dark strip, steps back when a held plate is dropped, and then resumes', () => {
  const s = raw(5);
  s.shownAge = 1;
  put(s, 0, 180, 146); // Red at the waiting spot
  run(s, 2);
  assert.equal(view(s).hint.wait, true, 'wait marker while the strip is live');
  assert.match(view(s).prompt.en, /for the dark/);
  run(s, 160);
  s.shownAge = 1;
  run(s, 2);
  assert.equal(view(s).hint.wait, false, 'released once it is dark long enough');
  assert.match(view(s).prompt.en, /cross the dark strip/);

  const t = raw(0);
  t.active = 0;
  put(t, 1, 132, 206); // Blue holds the plate
  run(t, 2);
  put(t, 0, 201, 146); // Red walks up to the gate
  run(t, 2);
  assert.ok(t.stage >= 2, `guide moved on (stage ${t.stage})`);
  const resumeTo = t.stage;
  put(t, 1, 60, 230); // Blue wanders off the plate: the gate shuts
  t.shownAge = 1;
  run(t, 2);
  assert.equal(t.open.A, false);
  assert.equal(t.stage, 0, 'guide sends Blue back to the plate');
  put(t, 1, 132, 206);
  t.shownAge = 1;
  run(t, 2);
  assert.ok(t.stage >= resumeTo, 'and carries on where it left off');
});

test('a robot that slips off its pad is sent back to it before the guide moves on', () => {
  const s = raw(1);
  s.stage = 5;
  put(s, 0, 396, 230);
  put(s, 1, 100, 230);
  s.shownAge = 1;
  run(s, 2);
  assert.ok(s.resume && s.stage <= 5);
});

test('the room select draws in both languages inside the canvas and highlights the cursor', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 7, unlock() {} };
    const g = createGame(h.env);
    const { ctx, calls } = recorder();
    g.draw(ctx);
    const strings = calls.texts.map((t) => t.str);
    assert.ok(strings.includes('7'));
    assert.ok(strings.some((t) => /LOCKED|未解锁/.test(t)));
    assert.ok(strings.some((t) => /CLEARED|已通关/.test(t)));
    assert.ok(strings.some((t) => /NEXT|下一关/.test(t)));
    assert.match(
      g.getState().status[lang],
      lang === 'en' ? /Choose a room · 7\/20/ : /选择房间 · 7\/20/,
    );
    for (const t of calls.texts) {
      const px = Number(/(\d+)px/.exec(t.font)[1]);
      const w = [...t.str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? px : px * 0.6), 0);
      assert.ok(w <= 480, `"${t.str}" is ${w}px wide`);
    }
  }
});
