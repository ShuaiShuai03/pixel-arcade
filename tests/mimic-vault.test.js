import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, RULES, LEVELS, ROOM_COUNT } from '../src/games/mimic-vault.js';
import { harness, input, mockContext, seeded } from './harness.js';

const T = RULES.tile;
const TOP = RULES.top;
const DT = 1 / 60;
const TICK = RULES.step;
const px = (c) => c * T + T / 2;
const py = (r) => TOP + r * T + T / 2;

// Starts a game on a given level through the public level-select menu, like a returning player.
function start(level = 1, { lang = 'en', seed = 1 } = {}) {
  const h = harness({ lang, seed });
  const saved = [];
  let unlocked = level;
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      saved.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  if (level > 1) g.update(DT, input([], ['Space']));
  return { g, h, saved };
}

function driver(g) {
  const d = {
    g,
    st: () => g.getState(),
    step(held = [], pressed = [], n = 1) {
      for (let i = 0; i < n; i++) g.update(DT, input(held, i === 0 ? pressed : []));
    },
    press: (key) => d.step([], [key]),
    // Shortest tile route over the walls and the doors that are open right now.
    path(goal, from, avoidEcho = false) {
      const s = d.st();
      const blocked = new Set(s.walls.map((w) => `${w.x / T},${(w.y - TOP) / T}`));
      for (const door of s.doors)
        if (!door.open) for (const c of door.cells) blocked.add(`${c.x / T},${(c.y - TOP) / T}`);
      if (avoidEcho && s.echo) {
        // The parked echo is solid: its tile cannot be part of a route.
        blocked.add(`${Math.floor(s.echo.x / T)},${Math.floor((s.echo.y - TOP) / T)}`);
      }
      const start = from || [Math.floor(s.player.x / T), Math.floor((s.player.y - TOP) / T)];
      const prev = new Map([[start.join(), null]]);
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const [c, r] = queue[i];
        if (c === goal[0] && r === goal[1]) break;
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ]) {
          const key = `${c + dc},${r + dr}`;
          if (blocked.has(key) || prev.has(key)) continue;
          prev.set(key, queue[i]);
          queue.push([c + dc, r + dr]);
        }
      }
      if (!prev.has(goal.join())) return null;
      const out = [];
      for (let at = goal; at; at = prev.get(at.join())) out.unshift(at);
      return out;
    },
    walkTo(goal, maxSeconds = 40) {
      const room = d.st().room;
      for (let f = 0; f < maxSeconds * 60; f++) {
        const s = d.st();
        if (s.room !== room || s.phase !== 'playing') return;
        const dx0 = px(goal[0]) - s.player.x;
        const dy0 = py(goal[1]) - s.player.y;
        if (Math.abs(dx0) < 1.2 && Math.abs(dy0) < 1.2) return;
        const route = d.path(goal);
        assert.ok(route, `no route to ${goal} in room ${room} at t=${s.time.toFixed(1)}`);
        const next = route[Math.min(1, route.length - 1)];
        const dx = px(next[0]) - s.player.x;
        const dy = py(next[1]) - s.player.y;
        const held = [];
        if (dx > 1) held.push('ArrowRight');
        if (dx < -1) held.push('ArrowLeft');
        if (dy > 1) held.push('ArrowDown');
        if (dy < -1) held.push('ArrowUp');
        d.step(held);
      }
      assert.fail(`never reached ${goal}`);
    },
    until(pred, maxSeconds = 30) {
      for (let f = 0; f < maxSeconds * 60; f++) {
        if (pred(d.st())) return;
        d.step();
      }
      assert.fail('condition never became true');
    },
  };
  return d;
}

// The authored solution of one leg, played with public inputs only.
function solveLeg(d, level, legIndex) {
  const leg = LEVELS[level - 1].legs[legIndex];
  d.press('Space');
  for (const stop of leg.route) d.walkTo(stop);
  d.step([], [], 6);
  d.press('Space');
  assert.ok(d.st().saved.ok, 'the recording ends on the echo perch');
  assert.ok(d.st().saved.seconds >= 1, 'recordings are comfortably longer than the minimum');
  d.press('KeyX');
  leg.after.forEach((item, i) => {
    d.walkTo(item.at);
    if (item.wait === 'home') {
      d.until((s) => s.echo && !s.echo.playing);
      // Even if you wandered off the plate, the way on must stay open around the parked echo.
      const echo = d.st().echo;
      const ec = Math.floor(echo.x / T);
      const er = Math.floor((echo.y - TOP) / T);
      const around = [
        [ec + 1, er],
        [ec - 1, er],
        [ec, er + 1],
        [ec, er - 1],
      ].filter(
        ([c, r]) =>
          ![...d.st().walls, ...d.st().doors.flatMap((door) => door.cells)].some(
            (w) => w.x === c * T && w.y === TOP + r * T,
          ),
      );
      assert.ok(
        around.some((from) => d.path(leg.after[i + 1].at, from, true)),
        `level ${level}: the parked echo blocks the way on`,
      );
    }
    if (item.wait === 'open') d.until(() => d.path(leg.after[i + 1].at));
  });
}

function solveLevel(level, d = driver(start(level).g)) {
  LEVELS[level - 1].legs.forEach((_, i) => solveLeg(d, level, i));
  return d;
}

const find = (s, id) => s.plates.find((p) => p.id === id);
const doorOf = (s, id) => s.doors.find((x) => x.id === id);

test('metadata is complete, bilingual and the touch layout covers every action', () => {
  assert.equal(meta.id, 'mimic-vault');
  assert.equal(meta.genre, 'puzzle');
  assert.equal(meta.players, '1');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.match(meta.description.zh, /[一-鿿]/);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX', 'KeyZ'])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
  assert.deepEqual(
    meta.touchControls.filter((c) => /Record|Replay|Reset/.test(c.label.en)).map((c) => c.label.zh),
    ['录制/停止', '回放', '重置'],
  );
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
  assert.equal(ROOM_COUNT, 22);
  assert.equal(LEVELS.length, ROOM_COUNT);
});

test('every one of the 22 vault rooms has a legal scripted solution played through public inputs', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    const { g, h, saved } = start(level);
    const d = driver(g);
    solveLevel(level, d);
    const s = d.st();
    if (level < ROOM_COUNT) {
      assert.equal(s.room, level + 1, `level ${level} should lead to ${level + 1}`);
      assert.deepEqual(saved, [level + 1]);
      assert.equal(s.phase, 'playing');
    } else {
      assert.equal(s.phase, 'won');
      assert.equal(h.ends.length, 1);
    }
    assert.ok(s.score >= RULES.roomScore, `level ${level} score ${s.score}`);
  }
});

test('the first rooms teach one idea at a time and the campaign has teach, combine and master stages', () => {
  const legs = LEVELS.map((l) => l.legs.length);
  assert.deepEqual(legs.slice(0, 5), [1, 1, 1, 1, 1]);
  assert.ok(legs.some((n) => n === 2) && legs.some((n) => n === 3));
  const names = new Set(LEVELS.map((l) => l.name.en));
  assert.equal(names.size, ROOM_COUNT);
  const { g } = start(1);
  const s = g.getState();
  assert.equal(s.doors.length, 1);
  assert.equal(s.doors[0].hold, 0);
  assert.equal(s.plates.length, 1);
  const timed = start(4).g.getState();
  assert.ok(timed.doors.some((x) => x.hold > 0));
  const pair = start(5).g.getState();
  assert.ok(pair.doors.some((x) => x.needs.length === 2));
  assert.match(g.getState().message.en, /echo/i);
});

test('invalid frame times are inert and never consume a press', () => {
  for (const dt of [0, -1, NaN, Infinity, 0.5, 5, undefined, '0.01']) {
    const { g } = start(1);
    const before = JSON.stringify(g.getState());
    g.update(dt, input(['ArrowRight'], ['Space']));
    assert.equal(JSON.stringify(g.getState()), before, `dt=${dt}`);
    g.update(DT, input([], ['Space']));
    assert.ok(g.getState().recording.active, `the press survives an invalid dt (${dt})`);
  }
});

test('the same aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  const rnd = seeded(77);
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const plan = [];
  for (let slot = 0; slot < 900; slot++) {
    const held = rnd() < 0.2 ? [] : [keys[Math.floor(rnd() * 4)]];
    const pressed = [];
    if (slot % 40 === 0) pressed.push('Space');
    if (slot % 40 === 20) pressed.push(rnd() < 0.5 ? 'KeyX' : 'Space');
    if (slot % 170 === 169) pressed.push('KeyZ');
    plan.push({ held, pressed });
  }
  for (const level of [1, 4, 5]) {
    const traces = [30, 60, 120].map((hz) => {
      const { g } = start(level);
      const states = [];
      const per = hz / 30;
      plan.forEach((slot, i) => {
        for (let k = 0; k < per; k++)
          g.update(1 / hz, input(slot.held, k === 0 ? slot.pressed : []));
        if (i % 15 === 14) states.push(JSON.stringify(g.getState()));
      });
      return states;
    });
    assert.deepEqual(traces[1], traces[0], `60 Hz differs from 30 Hz on level ${level}`);
    assert.deepEqual(traces[2], traces[0], `120 Hz differs from 30 Hz on level ${level}`);
  }
});

test('movement is wall-blocked, speed-limited and uses a 16 px actor', () => {
  const { g } = start(1);
  const d = driver(g);
  const s0 = d.st();
  assert.equal(s0.player.rect.w, 16);
  d.step(['ArrowRight'], [], 60);
  const s1 = d.st();
  assert.ok(Math.abs(s1.player.x - s0.player.x - RULES.speed) < 1.5);
  d.step(['ArrowUp', 'ArrowLeft'], [], 400);
  const s2 = d.st();
  assert.ok(s2.player.rect.x >= T - 1e-6 && s2.player.rect.y >= TOP + T - 1e-6, 'stops at walls');
  d.step(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], [], 30);
  assert.equal(d.st().player.x, s2.player.x);
  // WASD works too.
  d.step(['KeyD'], [], 30);
  assert.ok(d.st().player.x > s2.player.x);
  // A diagonal is not faster than a straight line.
  const a = d.st();
  d.step(['KeyS', 'KeyD'], [], 30);
  const b = d.st();
  assert.ok(Math.hypot(b.player.x - a.player.x, b.player.y - a.player.y) < RULES.speed * 0.5 + 1);
});

test('recording: Space starts and stops, timeline is visible, short takes are discarded', () => {
  const { g } = start(1);
  const d = driver(g);
  assert.equal(d.st().saved, null);
  assert.equal(d.st().timeline.max, RULES.maxRec);
  d.press('Space');
  assert.ok(d.st().recording.active);
  d.step(['ArrowRight'], [], 60);
  const mid = d.st();
  assert.ok(Math.abs(mid.recording.seconds - 1) < 0.05);
  // The visible timeline is run-length encoded: one frame of idling (the press frame), then walking right.
  assert.deepEqual(
    mid.timeline.segments.map((x) => x.mask),
    [0, 2],
  );
  assert.equal(
    mid.timeline.segments.reduce((n, x) => n + x.ticks, 0),
    mid.recording.ticks,
  );
  d.press('Space');
  const after = d.st();
  assert.ok(!after.recording.active && after.saved && after.saved.seconds > 0.9);
  assert.match(after.message.en, /saved/);
  // Accidental double press: discarded, previous recording kept.
  d.press('Space');
  d.press('Space');
  assert.match(d.st().message.en, /Too short/);
  assert.equal(d.st().saved.ticks, after.saved.ticks);
});

test('a recording stops by itself at the visible maximum length', () => {
  const { g } = start(1);
  const d = driver(g);
  d.press('Space');
  d.step(['ArrowUp'], [], 60 * 11);
  assert.ok(d.st().recording.active && d.st().recording.seconds < RULES.maxRec);
  d.step(['ArrowUp'], [], 60 * 2);
  const s = d.st();
  assert.ok(!s.recording.active);
  assert.ok(Math.abs(s.saved.seconds - RULES.maxRec) < 1e-6);
  assert.match(s.message.en, /Recording full/);
});

test('the echo repeats the recorded inputs through the same physics, step for step', () => {
  const { g } = start(1);
  const d = driver(g);
  const trace = [];
  d.press('Space');
  const begin = d.st().player;
  for (const [held, n] of [
    [['ArrowDown'], 40],
    [['ArrowRight'], 25],
    [[], 10],
    [['ArrowUp', 'ArrowRight'], 20],
  ])
    for (let i = 0; i < n; i++) {
      d.step(held);
      trace.push({ x: d.st().player.x, y: d.st().player.y });
    }
  d.press('Space');
  d.step(['ArrowLeft'], [], 30); // wander off so the echo is not hidden under the player
  d.press('KeyX');
  const echoTrace = [];
  let prev = null;
  for (let i = 0; i < trace.length + 60 && (!prev || d.st().echo.playing); i++) {
    d.step();
    const e = d.st().echo;
    echoTrace.push({ x: e.x, y: e.y });
    if (prev) {
      const jump = Math.hypot(e.x - prev.x, e.y - prev.y);
      assert.ok(jump <= RULES.speed * DT + 1e-6, `echo teleported by ${jump}`);
    }
    prev = e;
  }
  const first = d.st();
  assert.equal(first.echo.playing, false);
  // Compare at the recording's own pace: both are sampled once per 1/60 s frame.
  trace.forEach((p, i) => {
    assert.ok(
      Math.abs(echoTrace[i].x - p.x) < 1e-6 && Math.abs(echoTrace[i].y - p.y) < 1e-6,
      `frame ${i}`,
    );
  });
  assert.ok(Math.abs(begin.x - trace[0].x) < 3);
});

test('an echo is blocked by walls and closed doors exactly like the player', () => {
  const { g } = start(1);
  const d = driver(g);
  const s0 = d.st();
  const door = doorOf(s0, 'A').cells[0];
  d.press('Space');
  d.walkTo([8, 4]);
  d.step(['ArrowRight'], [], 90); // pushes into the closed door
  const pushed = d.st().player.x;
  assert.ok(pushed + 8 <= door.x + 1e-6, 'the player is stopped by the closed door');
  d.press('Space');
  d.step(['ArrowLeft'], [], 60);
  d.press('KeyX');
  d.step([], [], 60 * 8);
  const s = d.st();
  assert.equal(s.echo.playing, false);
  assert.ok(s.echo.x + 8 <= door.x + 1e-6, 'the echo never passes the door');
  assert.ok(s.stats.blocked > 0 && s.echo.x > 0);
  assert.ok(Math.abs(s.echo.x - pushed) < 0.8, 'it repeats the same bump');
});

test('a recording made through an open door cannot bypass it once the door closes', () => {
  const { g } = start(1);
  const d = driver(g);
  d.press('Space');
  d.walkTo([3, 6]);
  d.step([], [], 12);
  d.press('Space');
  d.press('KeyX');
  d.until((s) => s.echo && !s.echo.playing); // the echo parks on the plate, the door is open
  const door = doorOf(d.st(), 'A').cells[0];
  assert.ok(doorOf(d.st(), 'A').open);
  d.walkTo([8, 4]);
  d.press('Space');
  d.walkTo([12, 4]);
  d.press('Space');
  assert.ok(d.st().player.x > door.x + T, 'the player crossed while the old echo held the plate');
  d.press('KeyX'); // the new echo replaces the old one: the plate is released
  d.step([], [], 60 * 6);
  const s = d.st();
  assert.ok(!doorOf(s, 'A').open, 'nobody holds the plate any more');
  assert.ok(s.echo.x + 8 <= door.x + 1e-6, 'the new echo stops at the closed door');
  assert.ok(s.stats.blocked > 0);
});

test('the echo is solid to the player and can hold a plate while the player passes', () => {
  const { g } = start(1);
  const d = driver(g);
  d.press('Space');
  d.walkTo([3, 6]);
  d.press('Space');
  d.press('KeyX');
  d.until((s) => s.echo && !s.echo.playing);
  const s = d.st();
  assert.ok(find(s, 'a').pressed && doorOf(s, 'A').open);
  // Step off the plate: the echo alone keeps the door open.
  d.walkTo([5, 6]);
  assert.ok(doorOf(d.st(), 'A').open);
  // Walking into the echo is blocked.
  const e = d.st().echo;
  d.walkTo([Math.floor(e.x / T) + 1, 6]);
  d.step(['ArrowLeft'], [], 120);
  const p = d.st().player;
  assert.ok(
    Math.abs(p.x - e.x) >= 16 - 1e-6 || Math.abs(p.y - e.y) >= 16 - 1e-6,
    'bodies do not overlap',
  );
  assert.ok(p.x > e.x, 'the player stays on the near side');
  // Clearing the recording removes the echo and releases the plate.
  d.press('KeyZ');
  d.step([], [], 10);
  assert.equal(d.st().echo, null);
  assert.ok(!find(d.st(), 'a').pressed);
  assert.ok(!doorOf(d.st(), 'A').open);
});

test('timed doors stay open for their hold time and never close on an actor', () => {
  const { g } = start(4);
  const d = driver(g);
  const a = find(d.st(), 'a');
  const door = doorOf(d.st(), 'A');
  assert.ok(door.hold >= 5 && !door.open);
  d.walkTo([Math.floor(a.x / T), Math.floor((a.y - TOP) / T)]);
  assert.ok(doorOf(d.st(), 'A').open);
  d.walkTo([5, 5]);
  d.step([], [], 60 * 2);
  assert.ok(doorOf(d.st(), 'A').open, 'still open after leaving the plate');
  // Stand in the doorway past the hold time: the door cannot close on the player.
  const dc = door.cells[0];
  d.walkTo([Math.floor(dc.x / T), Math.floor((dc.y - TOP) / T)]);
  d.step([], [], 60 * (door.hold + 2));
  assert.ok(doorOf(d.st(), 'A').open, 'open while occupied');
  d.walkTo([8, Math.floor((dc.y - TOP) / T)]);
  d.step([], [], 60 * 2);
  assert.ok(!doorOf(d.st(), 'A').open, 'closes once nobody is in it');
});

test('a two-plate door needs both plates and keeps humane timing', () => {
  const { g } = start(5);
  const d = driver(g);
  const [pa, pb] = d.st().plates;
  d.walkTo([Math.floor(pa.x / T), Math.floor((pa.y - TOP) / T)]);
  assert.ok(!doorOf(d.st(), 'A').open, 'one plate is not enough');
  const door = doorOf(d.st(), 'A');
  assert.equal(door.needs.length, 2);
  assert.ok(door.hold >= 8, 'a pair door stays open long enough to cross');
  assert.ok(pb.id !== pa.id);
});

test('Z clears the recording, then returns to the checkpoint, then opens the vault list', () => {
  const { g, saved } = start(2);
  const d = driver(g);
  assert.equal(saved.length, 0);
  d.press('Space');
  d.walkTo([2, 5]);
  d.press('Space');
  d.press('KeyX');
  d.press('KeyZ');
  let s = d.st();
  assert.ok(!s.saved && !s.echo && !s.recording.active);
  assert.match(s.message.en, /cleared/);
  d.walkTo([6, 7]);
  d.press('KeyZ');
  s = d.st();
  assert.match(s.message.en, /checkpoint/);
  assert.ok(Math.hypot(s.player.x - s.start.x, s.player.y - s.start.y) < 1);
  assert.equal(s.menu, null);
  d.press('KeyZ');
  assert.equal(d.st().menu.sel, 2);
  assert.ok(d.st().prompt.en.includes('Space'));
  d.press('ArrowLeft');
  d.press('Space');
  const back = d.st();
  assert.equal(back.room, 1);
  assert.equal(back.menu, null);
});

test('a first-time player has no menu, and Z at the checkpoint just restarts the room', () => {
  const h = harness();
  const g = createGame(h.env);
  const d = driver(g);
  assert.equal(d.st().menu, null);
  d.step(['ArrowDown'], [], 30);
  d.press('KeyZ'); // checkpoint
  d.press('KeyZ'); // already there: restarts the room
  assert.equal(d.st().menu, null);
  assert.equal(d.st().room, 1);
  assert.ok(d.st().stats.resets >= 2);
});

test('progress: continue lands on the unlocked room, select is clamped, the best score is not farmed', () => {
  const { g, saved } = start(3);
  const d = driver(g);
  assert.equal(d.st().room, 3);
  assert.deepEqual(saved, []);
  solveLevel(3, d);
  d.step([], [], 60);
  assert.deepEqual(saved, [4]);
  const first = d.st().score;
  assert.ok(first >= RULES.roomScore);
  // Return to room 3 via the menu and clear it again: no extra score.
  d.press('KeyZ');
  d.press('KeyZ');
  assert.ok(d.st().menu);
  d.press('ArrowRight');
  assert.equal(d.st().menu.sel, 4, 'cannot select beyond the unlocked rooms');
  for (let i = 0; i < 6; i++) d.press('ArrowLeft');
  assert.equal(d.st().menu.sel, 1);
  d.press('ArrowDown');
  assert.equal(d.st().menu.sel, 4, 'down moves a row but is clamped to the unlocked rooms');
  d.press('ArrowUp');
  assert.equal(d.st().menu.sel, 1);
  d.press('ArrowRight');
  d.press('ArrowRight');
  d.press('Space');
  assert.equal(d.st().room, 3);
  solveLevel(3, d);
  assert.equal(d.st().score, first);
  // A returning player starts from the menu and a fresh player from room 1.
  assert.equal(start(1).g.getState().menu, null);
  assert.equal(start(7).g.getState().room, 7);
});

test('a player can always get out: after any wandering, Z returns to a clean checkpoint', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    const { g } = start(level);
    const d = driver(g);
    const rnd = seeded(level * 31);
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    for (let slot = 0; slot < 400; slot++) {
      const pressed = [];
      if (slot % 25 === 0) pressed.push(['Space', 'KeyX', 'Space'][Math.floor(rnd() * 3)]);
      d.step([keys[Math.floor(rnd() * 4)]], pressed, 6);
    }
    for (let i = 0; i < 2; i++) d.press('KeyZ');
    let s = d.st();
    if (s.menu) {
      d.press('Space');
      s = d.st();
    }
    assert.equal(s.saved, null, `level ${level}`);
    assert.equal(s.echo, null);
    assert.ok(Math.hypot(s.player.x - s.start.x, s.player.y - s.start.y) < 32, `level ${level}`);
    assert.equal(s.leg, 1);
    solveLevel(level, d);
    assert.ok(d.st().room > level || d.st().phase === 'won', `level ${level} still solvable`);
  }
});

test('crude play does not win: idling, random keys and never recording leave every room unsolved', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    const { g, h } = start(level);
    const d = driver(g);
    const rnd = seeded(level);
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA'];
    for (let slot = 0; slot < 1500; slot++)
      d.step([keys[Math.floor(rnd() * keys.length)], keys[Math.floor(rnd() * keys.length)]], [], 4);
    assert.equal(d.st().room, level, `random walking cleared room ${level}`);
    assert.equal(h.ends.length, 0);
    // Walking straight to the exit without recording is stopped by the doors.
    const solo = start(level);
    const e = LEVELS[level - 1].exit;
    const dd = driver(solo.g);
    const route = dd.path(e);
    assert.equal(route, null, `level ${level} exit is not reachable on foot`);
  }
});

test('terminal: the end callback fires once, the game freezes, a new instance starts fresh', () => {
  const { g, h } = start(ROOM_COUNT);
  const d = driver(g);
  solveLevel(ROOM_COUNT, d);
  const won = d.st();
  assert.equal(won.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, won.score);
  assert.ok(h.ends[0].message.length > 5);
  assert.ok(won.status.en.includes('Score') && /得分/.test(won.status.zh));
  const frozen = JSON.stringify(won);
  d.step(['ArrowLeft'], ['Space', 'KeyX', 'KeyZ'], 120);
  assert.equal(JSON.stringify(d.st()), frozen);
  assert.equal(h.ends.length, 1);
  assert.deepEqual(
    h.sounds.filter((x) => x === 'win'),
    ['win'],
  );
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.score, 0);
  assert.equal(fresh.room, 1);
});

test('the status is bilingual, names the room and the keys, and events reach it', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = start(2, { lang });
    const s = g.getState();
    assert.ok(s.status.en.includes('Room 2/22') && s.status.en.includes('Around the Bend'));
    assert.ok(s.status.zh.includes('房间 2/22') && s.status.zh.includes('绕过拐角'));
  }
  const { g } = start(2);
  const d = driver(g);
  d.step([], [], 60 * 4);
  assert.match(d.st().status.en, /Space/);
  assert.match(d.st().status.zh, /空格/);
  d.press('Space');
  assert.match(d.st().status.en, /Recording/);
  assert.match(d.st().status.zh, /录制/);
  d.press('KeyX');
  assert.match(d.st().status.en, /Stop recording first/);
  d.press('Space');
  d.press('Space');
  d.press('Space');
  d.step(['ArrowDown'], [], 40);
  d.press('Space');
  d.press('KeyZ');
  assert.match(d.st().status.zh, /录制已清除/);
  const fresh = start(1).g;
  const e = driver(fresh);
  e.press('KeyX');
  assert.match(e.st().status.en, /Nothing recorded/);
});

test('long seeded chaos stays finite and bounded', () => {
  for (const level of [1, 6, 13, 21, 22]) {
    const { g } = start(level);
    const rnd = seeded(level + 100);
    const keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
    ];
    for (let i = 0; i < 4000; i++) {
      const held = rnd() < 0.3 ? [] : [keys[Math.floor(rnd() * keys.length)]];
      const pressed = rnd() < 0.02 ? [['Space', 'KeyX', 'KeyZ'][Math.floor(rnd() * 3)]] : [];
      g.update(rnd() * 0.03 + 0.001, input(held, pressed));
    }
    const s = g.getState();
    assert.ok(
      Number.isFinite(s.player.x) && Number.isFinite(s.player.y) && Number.isFinite(s.time),
    );
    assert.ok(s.timeline.segments.length <= RULES.maxRec / TICK);
    assert.ok(s.walls.length < 220 && s.plates.length <= 5 && s.doors.length <= 5);
    assert.ok(s.player.rect.x >= 0 && s.player.rect.y >= TOP);
  }
});

function fontCapture() {
  const calls = [];
  const state = { font: '' };
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
  return { calls, ctx };
}

test('drawing: every phase renders, text is 14-16 px, fits the canvas and stays out of the play area', () => {
  for (const lang of ['en', 'zh']) {
    const { calls, ctx } = fontCapture();
    const plain = mockContext();
    // Early, recording, replaying, door open, message, menu, win.
    const { g } = start(2, { lang });
    const d = driver(g);
    g.draw(ctx);
    d.press('Space');
    d.step(['ArrowDown'], [], 90);
    g.draw(ctx);
    d.press('Space');
    d.press('KeyX');
    d.step([], [], 45);
    g.draw(ctx);
    d.press('KeyZ');
    d.press('KeyZ');
    d.press('KeyZ');
    g.draw(ctx);
    const s = start(21, { lang });
    const e = driver(s.g);
    solveLeg(e, 21, 0);
    s.g.draw(ctx);
    const f = start(ROOM_COUNT, { lang });
    const win = driver(f.g);
    solveLevel(ROOM_COUNT, win);
    f.g.draw(ctx);
    g.draw(plain);
    assert.ok(calls.length > 12);
    for (const c of calls) {
      const size = Number(/(\d+)px/.exec(c.font)[1]);
      assert.ok(size >= 14 && size <= 16, `${size}px "${c.str}"`);
      const w = [...c.str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? size : size * 0.6), 0);
      const left = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
      assert.ok(left >= 0 && left + w <= 480, `"${c.str}" overflows (${left}..${left + w})`);
    }
  }
});

test('layout: HUD bands do not cover play, actors are at least 16 px and the echo looks different', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    const s = start(level).g.getState();
    assert.deepEqual(s.hud, { top: [0, 26], bottom: [290, 320] });
    assert.ok(s.player.rect.y >= s.hud.top[1] && s.player.rect.y + 16 <= s.hud.bottom[0]);
    for (const p of s.plates) assert.ok(p.y >= 26 && p.y + p.h <= 290);
    assert.ok(s.exit.y >= 26 && s.exit.y + s.exit.h <= 290);
  }
  const fills = [];
  const alphas = [];
  const state = {};
  const ctx = new Proxy(
    { measureText: () => ({ width: 10 }), canvas: { width: 480, height: 320 } },
    {
      get: (t, p) => {
        if (p === 'fillRect')
          return (x, y, w, h) =>
            fills.push({ x, y, w, h, color: state.fillStyle, a: state.globalAlpha });
        return p in state ? state[p] : p in t ? t[p] : () => {};
      },
      set: (t, p, v) => {
        if (p === 'globalAlpha') alphas.push(v);
        return ((state[p] = v), true);
      },
    },
  );
  const { g } = start(1);
  const d = driver(g);
  d.press('Space');
  d.walkTo([3, 6]);
  d.step([], [], 12);
  d.press('Space');
  d.press('KeyX');
  d.until((s) => s.echo && !s.echo.playing);
  g.draw(ctx);
  assert.ok(
    alphas.includes(0.55) && alphas.at(-1) === 1,
    'the echo is drawn translucent, then alpha is restored',
  );
  const echoPixels = fills.filter((x) => x.a === 0.55);
  assert.ok(echoPixels.length > 10 && echoPixels.every((x) => x.w >= 2));
  const colors = new Set(echoPixels.map((x) => x.color));
  const playerColors = new Set(
    fills
      .filter((x) => x.a !== 0.55 && ['#ff7a2f', '#ffd24a'].includes(x.color))
      .map((x) => x.color),
  );
  assert.ok(playerColors.size === 2 && ![...colors].some((c) => playerColors.has(c)));
});

test('F1: stepping off the plate before the echo parks never stalls the leg (rooms 1 and 6)', () => {
  for (const level of [1, 6]) {
    const { g } = start(level);
    const d = driver(g);
    const first = LEVELS[level - 1].legs[0];
    d.press('Space');
    d.walkTo(first.route[0]);
    d.step([], [], 12);
    d.press('Space');
    const plate = first.route[0];
    d.walkTo([plate[0] + 1, plate[1]]); // one tile off the plate
    d.press('KeyX');
    d.until((s) => s.echo && !s.echo.playing);
    d.step([], [], 60);
    let s = d.st();
    assert.ok(
      !/Follow the marker/.test(s.prompt.en) || !s.hint || s.hint.goal.x !== s.echo.x,
      'marker not on the echo',
    );
    if (s.hint) {
      const onEcho =
        Math.abs(s.hint.goal.x - s.echo.x) < 12 && Math.abs(s.hint.goal.y - s.echo.y) < 12;
      assert.ok(!onEcho, `the marker points at the parked echo in room ${level}`);
    }
    // Follow the on-screen marker (what a player does) to the end of the leg.
    const roomBefore = s.room;
    let guard = 0;
    while (d.st().room === roomBefore && d.st().leg === 1 && guard++ < 60 * 40) {
      const st = d.st();
      assert.ok(st.hint, `prompt "${st.prompt.en}" has no marker`);
      const goal = [Math.floor(st.hint.goal.x / T), Math.floor((st.hint.goal.y - TOP) / T)];
      d.walkTo(goal, 20);
      d.step([], [], 12);
      if (level === 1) break;
    }
    s = d.st();
    if (level === 6) {
      assert.equal(s.leg, 2, 'the leg advanced after passing the held door');
      assert.ok(s.start.x > 7 * T, 'the checkpoint moved to the second zone');
    } else assert.equal(s.room, 2);
  }
});

test('F3: the walls in the snapshot cannot be mutated', () => {
  const s = start(1).g.getState();
  assert.ok(Object.isFrozen(s.walls));
  assert.throws(() => s.walls.push({}), TypeError);
  assert.throws(() => {
    s.walls[0].x = 99;
  }, TypeError);
  assert.notEqual(start(1).g.getState().walls[0].x, 99);
});

test('F4: the copy matches the behaviour and the touch label says Record/Stop', () => {
  assert.match(meta.description.en, /once more than one room is unlocked/);
  assert.match(meta.description.zh, /解锁多于一间/);
  const space = meta.touchControls.find((c) => c.code === 'Space');
  assert.deepEqual(space.label, { en: 'Record/Stop', zh: '录制/停止' });
});

test('F1: the marker routes around the parked echo instead of through it (room 5)', () => {
  const { g } = start(5);
  const d = driver(g);
  const perch = LEVELS[4].legs[0].route[0];
  d.press('Space');
  d.walkTo(perch);
  d.step([], [], 12);
  d.press('Space');
  d.press('KeyX');
  d.until((s) => s.echo && !s.echo.playing);
  d.walkTo([perch[0], perch[1] - 1]); // directly above the parked echo
  d.step([], [], 30);
  // Follow the marker the way a player does: straight at it, no cleverness.
  for (let f = 0; f < 60 * 25 && d.st().player.y < py(6); f++) {
    const { hint, player } = d.st();
    assert.ok(hint, 'a marker is always shown while walking');
    const held = [];
    if (hint.x - player.x > 3) held.push('ArrowRight');
    if (hint.x - player.x < -3) held.push('ArrowLeft');
    if (hint.y - player.y > 3) held.push('ArrowDown');
    if (hint.y - player.y < -3) held.push('ArrowUp');
    d.step(held);
  }
  assert.ok(d.st().player.y >= py(6), 'the player got past the solid echo');
});
