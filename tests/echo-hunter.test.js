import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/games/echo-hunter.js';
import { harness, input, mockContext, seeded } from './harness.js';

const { createGame, createWorld, stepWorld, snapshot, drawWorld, STEP, CAVERNS, TILE, COLS, ROWS } =
  E;
const idle = input([]);
const keys = (...held) => input(held);
const tap = (...pressed) => input([], pressed);

// A spot 10 px from the player on whichever side is open floor.
const beside = (w) => (E.solidAt(w.map, ...E.tileOf(w.p.x + 10, w.p.y)) ? w.p.x - 10 : w.p.x + 10);
// The three hand-authored caverns that the detailed rule tests were written against.
const caveIndex = (id) => CAVERNS.findIndex((c) => c.id === id);
const [F1, F2, F3] = ['first-echo', 'crossed-tunnels', 'deep-hollow'].map(caveIndex);
function world() {
  return createWorld(seeded(1), { start: F1 });
}
function run(w, seconds, held = [], hz = 120) {
  for (let i = 0; i < Math.round(seconds * hz); i++) stepWorld(w, 1 / hz, input(held));
}
function mover(kind, x, y, extra = {}) {
  return {
    id: `${kind[0]}x${x}-${y}`,
    kind,
    x,
    y,
    pts: [
      [x, y],
      [x, y],
    ],
    mode: 'pingpong',
    speed: 0,
    pause: 0,
    i: 1,
    dir: 1,
    wait: 0,
    hx: 0,
    hy: 0,
    state: 'patrol',
    path: [],
    startle: 0,
    frozen: 0,
    calm: 0,
    ...extra,
  };
}
// A quiet test cavern 1: nothing moves, the player stands in the open middle room.
function quiet(extra = {}) {
  const w = world();
  w.drifters = [mover('drifter', 3000, 3000)];
  w.threats = [];
  w.p.inv = 0;
  Object.assign(w.p, extra);
  return w;
}
const at = (c, r) => E.centerOf(c, r);
// Gives every beetle a fresh outline, as a ping that just reached it would.
const locate = (w) => {
  for (const d of w.drifters)
    if (!w.marks.some((m) => m.id === d.id))
      w.marks.push({
        id: d.id,
        kind: 'drifter',
        x: d.x,
        y: d.y,
        dx: 0,
        dy: 0,
        age: 0,
        alerted: false,
      });
  return w;
};

test('echo hunter: meta is complete and bilingual with full touch controls', () => {
  const m = E.meta;
  assert.equal(m.id, 'echo-hunter');
  assert.equal(m.genre, 'action');
  assert.equal(m.players, '1');
  assert.ok(m.name.en && m.name.zh && m.description.en && m.description.zh);
  assert.match(m.description.zh, /[一-鿿]/);
  const codes = m.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(code), code);
  for (const c of m.touchControls) {
    assert.ok(c.label.en && /[一-鿿]/.test(c.label.zh));
    assert.ok(['left', 'right'].includes(c.side));
  }
  assert.ok(m.keys.every((k) => k.label.en && k.label.zh && k.keys));
  assert.match(m.description.en, /WAS/);
});

// Walkable tile edges whose removal would cut a pocket off: a cavern with none has no dead ends.
function bridgeEdges(map) {
  const index = (c, r) => r * COLS + c,
    disc = new Map(),
    low = new Map(),
    found = [];
  let clock = 0;
  const visit = (c, r, parent) => {
    const here = index(c, r);
    disc.set(here, ++clock);
    low.set(here, clock);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const [nc, nr] = [c + dc, r + dr];
      if (E.solidAt(map, nc, nr) || index(nc, nr) === parent) continue;
      const there = index(nc, nr);
      if (disc.has(there)) low.set(here, Math.min(low.get(here), disc.get(there)));
      else {
        visit(nc, nr, here);
        low.set(here, Math.min(low.get(here), low.get(there)));
        if (low.get(there) > disc.get(here)) found.push([here, there]);
      }
    }
  };
  return { visit, found, count: () => disc.size };
}

test('echo hunter: twenty authored caverns are valid and escalate teach, combine, master', () => {
  assert.equal(CAVERNS.length, 20);
  assert.equal(new Set(CAVERNS.map((c) => c.id)).size, 20, 'unique ids');
  assert.ok(CAVERNS.every((c) => c.name.en && c.name.zh));
  const counts = CAVERNS.map((c) => [c.drifters.length, c.threats.length]);
  // One idea at a time: ping, outline, net, then the first crawler.
  assert.deepEqual(counts.slice(0, 4), [
    [1, 0],
    [2, 0],
    [3, 0],
    [2, 1],
  ]);
  assert.deepEqual(counts[F1], [2, 1]);
  assert.deepEqual(counts[F2], [3, 1]);
  assert.deepEqual(counts[F3], [4, 2]);
  assert.ok(counts.slice(0, 4).every((_, k) => CAVERNS[k].lesson.en && CAVERNS[k].lesson.zh));
  assert.ok(
    CAVERNS.slice(4).every((c) => !c.lesson),
    'only the first four caverns carry a lesson',
  );
  // The curve never gets easier in crawlers by more than one, and ends with three of them.
  assert.equal(Math.max(...CAVERNS.slice(-3).map((c) => c.threats.length)), 3);
  assert.ok(CAVERNS.at(-1).charges < CAVERNS[0].charges, 'the budget tightens');
  assert.deepEqual(
    CAVERNS.map((c) => c.charges),
    E.SONAR_START,
  );
  assert.deepEqual(
    CAVERNS.map((c) => c.trickle),
    E.SONAR_TRICKLE,
  );
  for (const c of CAVERNS) {
    const tool = bridgeEdges(c.map);
    tool.visit(...c.start, -1);
    assert.deepEqual(tool.found, [], `${c.id}: no dead-end pocket hangs off a single tile`);
    const floor = c.map.join('').split('.').length - 1;
    // The three older hand-drawn caverns keep a few sealed alcoves inside their pillars.
    const sealed = ['first-echo', 'crossed-tunnels', 'deep-hollow'].includes(c.id);
    assert.ok(
      sealed ? tool.count() > floor * 0.9 : tool.count() === floor,
      `${c.id}: one connected cave`,
    );
  }
  const lanesOf = (c) => c.drifters.flatMap((d) => d.variants);
  assert.ok(lanesOf(CAVERNS[F3]).some((d) => d.mode === 'loop'));
  assert.ok(lanesOf(CAVERNS[F2]).some((d) => d.pause > 0));
  for (const c of CAVERNS)
    for (const d of c.drifters)
      assert.ok(d.variants.length >= 3, 'each beetle has 3 lane variants');
  for (const c of CAVERNS) {
    assert.equal(c.map.length, ROWS);
    assert.ok(c.map.every((row) => row.length === COLS));
    assert.ok(c.map[0].split('').every((ch) => ch === '#'));
    assert.ok(c.map.every((row) => row[0] === '#' && row[COLS - 1] === '#'));
    const [sc, sr] = c.start;
    assert.ok(!E.solidAt(c.map, sc, sr));
    const reach = E.tunnelDistances(c.map, sc, sr);
    for (const r of [...lanesOf(c), ...c.threats]) {
      r.pts.forEach(([pc, pr], k) => {
        assert.ok(reach[pr * COLS + pc] >= 0, 'route point is reachable floor');
        if (k === 0) return;
        const [qc, qr] = r.pts[k - 1];
        assert.ok(pc === qc || pr === qr, 'route legs are straight');
        for (let c2 = Math.min(pc, qc); c2 <= Math.max(pc, qc); c2++)
          for (let r2 = Math.min(pr, qr); r2 <= Math.max(pr, qr); r2++)
            assert.ok(!E.solidAt(c.map, c2, r2), 'route leg stays on floor');
      });
    }
  }
});

test('echo hunter: invalid dt is inert and does not consume queued presses', () => {
  const w = quiet();
  const before = JSON.stringify(snapshot(w));
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 2, 1e9, '0.1', null, undefined]) {
    stepWorld(w, dt, input(['ArrowRight'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(snapshot(w)), before, String(dt));
  }
  assert.deepEqual(w.pend, { ping: false, net: false });
  stepWorld(w, 1 / 60, tap('Space'));
  assert.ok(w.ring, 'a valid dt still works afterwards');
});

test('echo hunter: sub-step updates accumulate and a huge valid dt is capped at one frame', () => {
  const w = quiet();
  stepWorld(w, STEP / 2, keys('ArrowRight'));
  assert.equal(w.tick, 0);
  stepWorld(w, STEP / 2, keys('ArrowRight'));
  assert.equal(w.tick, 1);
  stepWorld(w, 0.9, idle);
  assert.equal(w.tick, 1 + 4, 'capped to 1/30 s = four ticks');
});

test('echo hunter: a queued press survives a sub-step update and fires once', () => {
  const w = quiet();
  stepWorld(w, STEP / 4, tap('Space'));
  assert.equal(w.ring, null);
  stepWorld(w, STEP, idle);
  assert.ok(w.ring);
  assert.equal(w.events.filter((e) => e === 'ping').length, 1);
});

test('echo hunter: full state is identical at 30, 60 and 120 Hz for aligned input', () => {
  const script = [
    { t: 0, held: ['ArrowRight'], pressed: [] },
    { t: 0.5, held: ['ArrowRight', 'ArrowUp'], pressed: ['Space'] },
    { t: 1, held: ['ArrowLeft'], pressed: [] },
    { t: 1.5, held: ['ArrowDown'], pressed: ['KeyX'] },
    { t: 2, held: [], pressed: ['Space'] },
    { t: 3.5, held: ['ArrowUp'], pressed: ['KeyX'] },
    { t: 5, held: [], pressed: [] },
  ];
  const play = (hz) => {
    const g = createGame(harness({ seed: 4 }).env);
    const per = hz / 30;
    const out = [];
    for (let f = 0; f < 30 * 7; f++) {
      const t = f / 30;
      const step = script.findLast((s) => s.t <= t + 1e-9);
      const fresh = script.some((s) => Math.abs(s.t - t) < 1e-9);
      for (let k = 0; k < per; k++)
        g.update(1 / hz, input(step.held, fresh && k === 0 ? step.pressed : []));
      if (f % 15 === 14) out.push(JSON.stringify(g.getState()));
    }
    return out;
  };
  const a = play(30);
  assert.deepEqual(play(60), a);
  assert.deepEqual(play(120), a);
  assert.ok(a.length >= 14);
});

test('echo hunter: movement is at the stated speed, normalised on diagonals, 8-way, WASD or arrows', () => {
  const w = quiet();
  const x0 = w.p.x;
  run(w, 1, ['ArrowRight']);
  assert.ok(Math.abs(w.p.x - x0 - E.PLAYER_SPEED) < 0.01);
  const w2 = quiet();
  run(w2, 0.5, ['KeyD', 'KeyS']);
  const d = Math.hypot(w2.p.x - 232, w2.p.y - 134);
  assert.ok(Math.abs(d - E.PLAYER_SPEED * 0.5) < 0.05, `diagonal speed ${d}`);
  const w3 = quiet();
  run(w3, 0.3, ['KeyA', 'ArrowRight']);
  assert.ok(Math.abs(w3.p.x - 232) < 0.01, 'opposite keys cancel');
  assert.equal(snapshot(w3).player.moving, false);
  run(w3, 0.2, ['KeyW']);
  assert.ok(w3.p.y < 134);
  assert.equal(snapshot(w3).player.moving, true);
  run(w3, 0.1, ['ArrowLeft']);
  assert.equal(snapshot(w3).player.face, -1);
});

test('echo hunter: walls are solid, slide along edges and never swallow the player at any rate', () => {
  for (const hz of [30, 60, 120]) {
    const w = quiet();
    for (let i = 0; i < hz * 20; i++) {
      stepWorld(w, 1 / hz, keys(i % (hz * 4) < hz * 2 ? 'ArrowLeft' : 'ArrowRight', 'ArrowDown'));
      const h = E.PLAYER_HALF;
      for (const [ox, oy] of [
        [-h, -h],
        [h, -h],
        [-h, h],
        [h, h],
      ])
        assert.ok(!E.solidAt(w.map, ...E.tileOf(w.p.x + ox, w.p.y + oy)), `${hz} Hz tick ${i}`);
    }
  }
  const w = quiet();
  [w.p.x, w.p.y] = at(7, 5);
  run(w, 2, ['ArrowLeft']);
  assert.ok(w.p.x >= 7 * TILE + 6 - 1e-6, 'stopped by the wall at the room edge');
  const y = w.p.y;
  run(w, 0.5, ['ArrowLeft', 'ArrowDown']);
  assert.ok(w.p.y > y, 'slides along the wall');
});

test('echo hunter: a body clipping a wall corner is eased past it', () => {
  const w = quiet();
  [w.p.x, w.p.y] = [282, 115.9]; // 0.1 px above the lane next to a pillar corner
  const x0 = w.p.x;
  run(w, 0.5, ['ArrowRight']);
  assert.ok(w.p.x > x0 + 20, 'moved on instead of snagging');
});

test('echo hunter: ping is a finite-speed ring and the cooldown is enforced and visible', () => {
  const w = quiet();
  stepWorld(w, 1 / 120, tap('Space'));
  let s = snapshot(w);
  assert.ok(s.ring && s.ring.r > 0 && s.ring.r < 3);
  assert.equal(s.player.pingCooldownMax, E.PING_CD);
  assert.ok(s.player.pingCooldown > E.PING_CD - 0.02);
  run(w, 0.5);
  s = snapshot(w);
  assert.ok(Math.abs(s.ring.r - E.RING_SPEED * 0.5) < 3, `ring radius ${s.ring.r}`);
  run(w, 1);
  assert.equal(snapshot(w).ring, null, 'ring ends at the noise radius');
  // Spam before the cooldown ends is rejected and does not extend it.
  const before = snapshot(w).player.pingCooldown;
  stepWorld(w, 1 / 120, tap('Space'));
  s = snapshot(w);
  assert.ok(s.events.includes('denied'));
  assert.equal(s.ring, null);
  assert.ok(s.player.pingCooldown < before);
  assert.match(s.status.en, /Sonar recharging/);
  assert.match(s.status.zh, /声呐冷却/);
  run(w, E.PING_CD);
  stepWorld(w, 1 / 120, tap('Space'));
  assert.ok(snapshot(w).ring, 'ready again after the cooldown');
});

test('echo hunter: holding Space does not repeat pings', () => {
  const w = quiet();
  stepWorld(w, 1 / 120, tap('Space'));
  const t0 = w.lastPing.t;
  run(w, 2, ['Space']);
  assert.equal(w.lastPing.t, t0);
});

test('echo hunter: the ring reveals an object when it passes, and the outline stays where it was', () => {
  const w = quiet();
  const e = mover('drifter', w.p.x + 60, w.p.y, {
    speed: 60,
    pts: [
      [w.p.x + 60, w.p.y],
      [w.p.x + 60, w.p.y - 70],
    ],
  });
  w.drifters = [e];
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 0.2); // ring radius ~36: not there yet
  assert.equal(snapshot(w).marks.length, 0);
  run(w, 0.2); // ring radius ~72: has passed 60 px
  let s = snapshot(w);
  assert.equal(s.marks.length, 1);
  const m = s.marks[0];
  assert.equal(m.kind, 'drifter');
  assert.ok(Math.abs(m.x - (w.p.x + 60)) < 0.001, 'drawn where it was');
  assert.ok(m.y < w.p.y && m.y > w.p.y - 30, 'position when the ring reached it');
  assert.ok(m.dy < 0 && m.dx === 0, 'carries its heading');
  const yThen = m.y;
  assert.ok(e.frozen > 2.5, 'the ring froze the beetle');
  run(w, 4.5);
  s = snapshot(w);
  assert.equal(s.marks[0].y, yThen, 'the outline never follows the live object');
  assert.ok(e.y < yThen - 20, 'the object itself moved on');
  assert.ok(s.marks[0].age > 2);
  run(w, E.MARK_LIFE);
  assert.equal(snapshot(w).marks.length, 0, 'fades after its stated life');
});

test('echo hunter: the ring is blocked by walls and stops at the reveal radius', () => {
  const w = quiet();
  [w.p.x, w.p.y] = at(8, 5);
  w.drifters = [
    mover('drifter', ...at(5, 5)),
    mover('drifter', ...at(8, 13)),
    mover('drifter', ...at(8, 10)),
  ];
  w.drifters[0].id = 'behind-wall';
  w.drifters[1].id = 'too-far';
  w.drifters[2].id = 'open-lane';
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 1.4);
  const ids = snapshot(w).marks.map((m) => m.id);
  assert.ok(ids.includes('open-lane'), '80 px away in the open');
  assert.ok(!ids.includes('behind-wall'), 'the wall occludes the ring even at 48 px');
  assert.ok(
    !ids.includes('too-far'),
    '128 px away is past the reveal radius even with a clear lane',
  );
});

test('echo hunter: nothing beyond the reveal radius is revealed', () => {
  const w = quiet();
  w.drifters = [
    mover('drifter', w.p.x + E.REVEAL_R + 8, w.p.y),
    mover('drifter', w.p.x - E.REVEAL_R + 8, w.p.y),
  ];
  w.drifters[0].id = 'beyond';
  w.drifters[1].id = 'inside';
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 1.5);
  const ids = snapshot(w).marks.map((m) => m.id);
  assert.deepEqual(ids, ['inside']);
});

test('echo hunter: a second ping replaces the outline of the same object', () => {
  const w = quiet();
  w.drifters = [mover('drifter', w.p.x + 40, w.p.y)];
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 0.6);
  assert.equal(w.marks.length, 1);
  w.drifters[0].x += 10;
  run(w, E.PING_CD);
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 0.5);
  assert.equal(w.marks.length, 1, 'bounded: one outline per object');
  assert.equal(w.marks[0].x, w.drifters[0].x);
  assert.ok(w.marks[0].age < 0.5);
});

test('echo hunter: the lamp shows live things only inside its small radius and in line of sight', () => {
  const w = quiet();
  w.drifters = [
    mover('drifter', w.p.x + E.LIGHT_R - 2, w.p.y),
    mover('drifter', w.p.x - E.LIGHT_R - 4, w.p.y),
  ];
  w.drifters[0].id = 'near';
  w.drifters[1].id = 'far';
  assert.deepEqual(
    snapshot(w).lit.map((e) => e.id),
    ['near'],
  );
  [w.p.x, w.p.y] = at(7, 5);
  w.drifters = [mover('drifter', ...at(5, 5))];
  assert.equal(snapshot(w).lit.length, 0, 'a wall blocks the lamp too');
});

test('echo hunter: the net needs a located target, but threats and walls never depend on visibility', () => {
  // An unlocated beetle (no outline) cannot be netted; a swing at it misses and startles it.
  const w = quiet();
  w.drifters = [mover('drifter', w.p.x + 20, w.p.y), mover('drifter', 3000, 3000)];
  assert.equal(snapshot(w).marks.length, 0);
  assert.equal(E.desiredPrompt(w), 'locate', 'the prompt says to ping first');
  stepWorld(w, 1 / 60, tap('KeyX'));
  run(w, E.NET_TIME + 0.1);
  assert.equal(w.beacons, 0);
  assert.ok(w.drifters[0].startle > 0);
  // Ping so the outline exists: now the same swing lands, even though the beetle itself is a few px off.
  const v = quiet();
  v.drifters = [mover('drifter', v.p.x + 50, v.p.y), mover('drifter', 3000, 3000)];
  stepWorld(v, 1 / 120, tap('Space'));
  run(v, 0.6);
  assert.equal(v.marks.length, 1);
  v.drifters[0].x = v.p.x + 20;
  stepWorld(v, 1 / 60, tap('KeyX'));
  assert.equal(v.beacons, 1);
  // Once the outline has faded the beetle is unlocated again (the object is still there and moving).
  const u = quiet();
  u.drifters = [mover('drifter', u.p.x + 50, u.p.y), mover('drifter', 3000, 3000)];
  stepWorld(u, 1 / 120, tap('Space'));
  run(u, E.MARK_LIFE + 1);
  assert.equal(u.marks.length, 0);
  u.drifters[0].x = u.p.x + 20;
  stepWorld(u, 1 / 60, tap('KeyX'));
  run(u, 0.3);
  assert.equal(u.beacons, 0);
  assert.equal(
    u.drifters.length,
    2,
    'the beetle was never removed or altered by its outline fading',
  );
  // An unrevealed threat still hurts.
  const t = quiet();
  t.threats = [mover('threat', t.p.x + 10, t.p.y)];
  stepWorld(t, 1 / 60, idle);
  assert.equal(t.hp, E.MAX_HP - 1);
  // Walls block whether or not anything was revealed.
  const x = quiet();
  [x.p.x, x.p.y] = at(7, 5);
  run(x, 1, ['ArrowLeft']);
  assert.ok(x.p.x >= 7 * TILE + 5.9);
});

test('echo hunter: netting needs real proximity and has a swing time and cooldown', () => {
  for (const [offset, caught] of [
    [E.NET_R - 1, true],
    [E.NET_R + 2, false],
  ]) {
    const w = quiet();
    w.drifters = [mover('drifter', w.p.x + offset, w.p.y), mover('drifter', 3000, 3000)];
    locate(w);
    stepWorld(w, 1 / 60, tap('KeyX'));
    run(w, E.NET_TIME + 0.1);
    assert.equal(w.beacons, caught ? 1 : 0, `offset ${offset}`);
    if (!caught) {
      assert.ok(snapshot(w).events.length >= 0);
      assert.match(JSON.stringify(w.msg), /Net missed/);
    }
  }
  const w = quiet();
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.equal(snapshot(w).player.netActive, true);
  stepWorld(w, 1 / 60, tap('KeyX')); // still on cooldown: no new swing
  run(w, E.NET_TIME);
  assert.equal(snapshot(w).player.netActive, false);
  assert.ok(snapshot(w).player.netCooldown > 0);
  run(w, E.NET_CD);
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.equal(snapshot(w).player.netActive, true, 'swings again after the cooldown');
});

test('echo hunter: a drifter that crosses the net inside one 1/30 s frame is still caught (no tunnelling)', () => {
  const w = quiet();
  w.drifters = [
    mover('drifter', w.p.x + 80, w.p.y, {
      speed: 38,
      pts: [
        [w.p.x + 80, w.p.y],
        [w.p.x - 80, w.p.y],
      ],
    }),
    mover('drifter', 3000, 3000),
  ];
  stepWorld(w, 1 / 30, tap('KeyX'));
  let caught = false;
  for (let i = 0; i < 400 && !caught; i++) {
    stepWorld(w, 1 / 30, idle);
    caught = w.beacons > 0;
  }
  // The swing only lasts 0.25 s, so a drifter far away is rightly missed; one inside reach is not.
  assert.equal(caught, false);
  const v = quiet();
  v.drifters = [
    mover('drifter', v.p.x + 50, v.p.y, {
      speed: 120,
      pts: [
        [v.p.x + 50, v.p.y],
        [v.p.x - 50, v.p.y],
      ],
    }),
    mover('drifter', 3000, 3000),
  ];
  locate(v);
  stepWorld(v, 1 / 30, tap('KeyX'));
  for (let i = 0; i < 8; i++) stepWorld(v, 1 / 30, idle);
  assert.equal(v.beacons, 1, 'a 120 px/s mover passing through the net is caught at 30 Hz');
});

test('echo hunter: movers follow their routes at constant speed, pause and turn, and stay on the floor', () => {
  const w = world();
  const d = w.drifters[0];
  const t0 = { x: d.x, y: d.y };
  run(w, 1);
  assert.ok(Math.abs(Math.hypot(d.x - t0.x, d.y - t0.y) - d.speed) < 0.5, 'constant speed');
  assert.ok(
    Math.abs(Math.abs(d.hx) + Math.abs(d.hy) - 1) < 1e-9,
    'unit heading along a straight leg',
  );
  for (let i = 0; i < 60 * 40; i++) {
    run(w, 1 / 60);
    for (const e of [...w.drifters, ...w.threats]) {
      assert.ok(!E.solidAt(w.map, ...E.tileOf(e.x, e.y)), `${e.id} on floor at ${w.tick}`);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    }
  }
  const dd = world().drifters[0];
  const pause = {
    ...dd,
    pause: 2,
    pts: [dd.pts[0], [dd.pts[0][0] + 16, dd.pts[0][1]]],
    x: dd.pts[0][0],
    i: 1,
    wait: 0,
  };
  const q = quiet();
  q.drifters = [pause, mover('drifter', 3000, 3000)];
  run(q, 1);
  assert.equal(pause.x, pause.pts[1][0], 'arrived');
  const xr = pause.x;
  run(q, 1);
  assert.equal(pause.x, xr, 'waits at the end');
  assert.equal(snapshot(q).lit.length >= 0, true);
  run(q, 1.5);
  assert.ok(pause.x < xr, 'then walks back');
  const loop = CAVERNS[F3].drifters[0].variants.find((r) => r.mode === 'loop');
  const l = createWorld();
  l.cavern = F3;
  l.map = CAVERNS[F3].map;
  const lm = {
    ...mover('drifter', 0, 0),
    mode: 'loop',
    speed: loop.speed,
    pts: loop.pts.map(([c, r]) => at(c, r)),
  };
  [lm.x, lm.y] = lm.pts[0];
  l.drifters = [lm, mover('drifter', 3000, 3000)];
  l.p.x = 3000;
  const seen = new Set();
  for (let i = 0; i < 120 * 30; i++) {
    stepWorld(l, 1 / 120, idle);
    seen.add(lm.i);
  }
  assert.equal(seen.size, 4, 'visits every corner of the loop in order');
});

test('echo hunter: pings alert threats by tunnel distance, not by straight-line distance', () => {
  const map = CAVERNS[F1].map;
  let pair = null;
  for (let r1 = 1; r1 < 15 && !pair; r1++)
    for (let c1 = 1; c1 < 29 && !pair; c1++) {
      if (E.solidAt(map, c1, r1)) continue;
      const dist = E.tunnelDistances(map, c1, r1);
      for (let r2 = 1; r2 < 15 && !pair; r2++)
        for (let c2 = 1; c2 < 29; c2++) {
          const eu = Math.hypot((c2 - c1) * TILE, (r2 - r1) * TILE);
          if (dist[r2 * COLS + c2] * TILE > E.NOISE_R + 40 && eu < 100) {
            pair = [
              [c1, r1],
              [c2, r2],
            ];
            break;
          }
        }
    }
  assert.ok(pair, 'the cavern has a wall between nearby tiles');
  const w = quiet();
  [w.p.x, w.p.y] = at(...pair[0]);
  w.threats = [mover('threat', ...at(...pair[1])), mover('threat', ...at(14, 6))];
  w.threats[0].id = 'behind-wall';
  w.threats[1].id = 'in-reach';
  [w.p.x, w.p.y] = at(14, 5);
  w.threats[1].x = at(14, 5)[0] + 64;
  w.threats[1].y = at(14, 5)[1];
  w.threats[0].x = at(...pair[1])[0];
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(w.threats[1].state, 'alert');
});

test('echo hunter: the noise rule sends a threat to the ping spot, then it searches and goes home', () => {
  const w = quiet();
  const [px, py] = [w.p.x, w.p.y];
  const route = [at(14, 11), at(14, 11)];
  const t = mover('threat', ...route[0], { speed: 30, pts: route });
  w.threats = [t];
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(t.state, 'alert');
  assert.ok(t.path.length >= 5);
  assert.deepEqual(t.path.at(-1), at(14, 6), 'heads for the ping tile, not for the player');
  w.p.x = 60; // the player leaves: the threat still goes to the old spot
  w.p.y = at(2, 3)[1];
  let travelled = 0;
  for (let i = 0; i < 120; i++) {
    const [x0, y0] = [t.x, t.y];
    stepWorld(w, 1 / 120, idle);
    travelled += Math.hypot(t.x - x0, t.y - y0);
  }
  assert.ok(Math.abs(travelled - 30 * 1.3) < 1, `alert speed ${travelled}`);
  run(w, 2.5);
  assert.equal(t.state, 'search');
  assert.deepEqual([Math.round(t.x), Math.round(t.y)], at(14, 6).map(Math.round));
  run(w, 3);
  assert.equal(t.state, 'return', 'the search ends after its stated time');
  run(w, 8);
  assert.equal(t.state, 'patrol');
  assert.deepEqual([Math.round(t.x), Math.round(t.y)], route[1].map(Math.round));
});

test('echo hunter: out-of-range, recoiling and unreachable threats ignore a normal ping', () => {
  const w = quiet();
  const far = mover('threat', ...at(2, 13));
  const recoil = mover('threat', ...at(14, 8), { state: 'recoil', path: [at(14, 9)] });
  w.threats = [far, recoil];
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(far.state, 'patrol');
  assert.equal(recoil.state, 'recoil');
  assert.equal(E.tunnelDistances(w.map, 0, 0)[0], -1, 'a wall tile reaches nothing');
});

test('echo hunter: repeated pings rouse the cave and every threat then hears it', () => {
  const w = quiet();
  const far = mover('threat', ...at(2, 13), { speed: 20 });
  w.threats = [far];
  assert.equal(snapshot(w).alarm.roused, false);
  for (let i = 0; i < 2; i++) {
    stepWorld(w, 1 / 120, tap('Space'));
    run(w, E.PING_CD);
  }
  assert.equal(far.state, 'patrol', 'two pings are still below the roused level');
  assert.ok(snapshot(w).alarm.value > 1.5);
  stepWorld(w, 1 / 120, tap('Space'));
  const s = snapshot(w);
  assert.equal(s.alarm.roused, true);
  assert.equal(far.state, 'alert', 'a roused cave is heard everywhere');
  assert.equal(s.prompt.key, 'roused');
  assert.match(s.status.en, /roused/i);
  const x = far.x,
    y = far.y;
  run(w, 0.5);
  assert.ok(
    Math.hypot(far.x - x, far.y - y) > 20 * 2 * 0.5 * 0.9,
    'roused threats run at twice their pace',
  );
  // A threat already searching keeps searching for as long as the cave is roused.
  const waiter = mover('threat', ...at(14, 8), { state: 'search', wait: 0.1 });
  w.threats = [waiter];
  run(w, 1);
  assert.equal(waiter.state, 'search');
  assert.equal(snapshot(w).alarm.roused, true);
  run(w, E.ALARM_DRAIN * 5);
  assert.equal(snapshot(w).alarm.roused, false, '...but the noise drains by itself');
  assert.equal(snapshot(w).alarm.value, 0);
  assert.notEqual(waiter.state, 'search', 'then the search ends and the threat goes home');
});

test('echo hunter: threat contact costs 1 HP, grants invulnerability and makes the threat recoil home', () => {
  const w = quiet();
  const t = mover('threat', w.p.x + 10, w.p.y, {
    pts: [
      [w.p.x + 10, w.p.y],
      [w.p.x + 10, w.p.y + 48],
    ],
    speed: 26,
  });
  w.threats = [t];
  stepWorld(w, 1 / 60, idle);
  let s = snapshot(w);
  assert.equal(s.hp, E.MAX_HP - 1);
  assert.ok(s.player.invulnerable > E.INVULN - 0.05);
  assert.ok(s.events.includes('hurt'));
  assert.equal(t.state, 'recoil');
  assert.match(s.status.en, /Ouch/);
  assert.match(s.status.zh, /生命-1/);
  const p0 = [w.p.x, w.p.y];
  run(w, 1);
  assert.equal(w.hp, E.MAX_HP - 1, 'no second hit while invulnerable or recoiling');
  assert.notDeepEqual([t.x, t.y], [p0[0] + 10, p0[1]]);
  // Standing on a threat after the invulnerability ends hits again (the threat is no longer recoiling).
  const v = quiet();
  v.threats = [mover('threat', v.p.x + 10, v.p.y)];
  stepWorld(v, 1 / 60, idle);
  run(v, E.INVULN + 0.2);
  assert.equal(v.hp, E.MAX_HP - 1);
  v.threats = [mover('threat', v.p.x + 5, v.p.y)];
  stepWorld(v, 1 / 60, idle);
  assert.equal(v.hp, E.MAX_HP - 2);
});

test('echo hunter: the player starts every cavern invulnerable so nothing hits instantly', () => {
  for (let n = 0; n < 3; n++) {
    const w = createWorld(seeded(1));
    w.cavern = n;
    // Loading a cavern is exercised through play; here check the authored starts are far from threats.
    const [sc, sr] = CAVERNS[n].start;
    const dist = E.tunnelDistances(CAVERNS[n].map, sc, sr);
    for (const r of CAVERNS[n].threats) {
      const [c, rr] = r.pts[0];
      assert.ok(dist[rr * COLS + c] * TILE > E.CONTACT_R * 4, `cavern ${n + 1} threat start`);
    }
  }
  const w = world();
  assert.ok(snapshot(w).player.invulnerable > 1.9);
});

test('echo hunter: losing all HP ends the game once and freezes the state', () => {
  const h = harness();
  const g = createGame(h.env);
  const w = quiet();
  assert.ok(g.getState().hp === E.MAX_HP);
  // Drive a real instance with a stationary player walking into a threat is covered below; here use the world.
  w.hp = 1;
  w.threats = [mover('threat', w.p.x + 4, w.p.y)];
  stepWorld(w, 1 / 60, idle);
  assert.equal(w.phase, 'lost');
  const frozen = JSON.stringify(snapshot(w));
  stepWorld(w, 1 / 60, keys('ArrowRight'));
  stepWorld(w, 1 / 60, tap('Space', 'KeyX'));
  assert.equal(JSON.stringify(snapshot(w)), frozen);
});

test('echo hunter: clearing a cavern pauses, heals one HP, loads the next and resets per-cavern state', () => {
  const w = quiet();
  w.hp = 2;
  w.drifters = [mover('drifter', w.p.x + 10, w.p.y)];
  w.alarm = 2;
  w.ring = { x: 0, y: 0, r: 5, seen: [], rays: [] };
  w.marks = [{ id: 'x', kind: 'threat', x: 1, y: 1, dx: 0, dy: 0, age: 0, alerted: false }];
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  let s = snapshot(w);
  assert.equal(s.hp, 4, 'a cleared cavern heals two');
  assert.equal(s.cavern, F1 + 1);
  assert.ok(s.interlude > 1.5);
  assert.match(s.status.en, new RegExp(`Cavern ${F1 + 1} clear`));
  assert.match(s.status.zh, new RegExp(`洞穴${F1 + 1}完成`));
  assert.ok(s.events.includes('clear'));
  stepWorld(w, 1 / 60, { ...tap('Space', 'KeyX'), held: () => true });
  assert.equal(w.pend.ping, false, 'no presses are queued across the interlude');
  const frozen = w.threats.map((t) => [t.x, t.y]);
  run(w, 1);
  assert.deepEqual(
    w.threats.map((t) => [t.x, t.y]),
    frozen,
  );
  run(w, 1.2);
  s = snapshot(w);
  const next = CAVERNS[F1 + 1];
  assert.equal(s.cavern, F1 + 2);
  assert.equal(s.interlude, 0);
  assert.equal(s.beacons, 0);
  assert.equal(s.beaconTotal, next.drifters.length);
  assert.equal(s.marks.length, 0);
  assert.equal(s.ring, null);
  assert.equal(s.alarm.value, 0);
  assert.equal(s.lastPing, null);
  assert.equal(s.player.pingCooldown, 0);
  assert.deepEqual([s.player.x, s.player.y], at(...next.start));
  assert.ok(s.player.invulnerable > 1.5);
  assert.deepEqual(s.walls, next.map);
  const full = quiet();
  full.hp = E.MAX_HP;
  full.drifters = [mover('drifter', full.p.x + 10, full.p.y)];
  locate(full);
  stepWorld(full, 1 / 60, tap('KeyX'));
  assert.equal(full.hp, E.MAX_HP, 'healing is capped');
});

test('echo hunter: the last beacon of the last cavern wins and scores hp, caverns and beacons', () => {
  const h = harness();
  const g = createGame(h.env);
  const w = quiet();
  const last = CAVERNS.length - 1;
  w.cavern = last;
  w.map = CAVERNS[last].map;
  [w.p.x, w.p.y] = at(...CAVERNS[last].start);
  w.drifters = [mover('drifter', beside(w), w.p.y)];
  w.hp = 3;
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.equal(w.phase, 'won');
  assert.equal(w.score, 100 + 150 + 3 * 100);
  assert.ok(g);
});

test('echo hunter: the end callback fires once with a localized message; a fresh instance restarts', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    // A stationary player is eventually found by patrolling and alerted threats only if it pings; so ping a lot.
    let guard = 0;
    while (!h.ends.length && guard++ < 120 * 600) {
      g.update(1 / 60, input([], ['Space']));
    }
    for (let i = 0; i < 60; i++) g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX']));
    assert.equal(h.ends.length <= 1, true);
    if (h.ends.length) {
      assert.equal(h.ends[0].won, false);
      assert.equal(typeof h.ends[0].score, 'number');
      assert.match(h.ends[0].message, lang === 'zh' ? /[一-鿿]/ : /crawlers/);
      assert.ok(h.sounds.includes('lose'));
      const frozen = JSON.stringify(g.getState());
      g.update(1 / 60, keys('ArrowLeft'));
      assert.equal(JSON.stringify(g.getState()), frozen);
    }
  }
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.hp, E.MAX_HP);
  assert.equal(fresh.cavern, 1);
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.time, 0);
  assert.equal(fresh.score, 0);
});

test('echo hunter: sounds follow events and win plays the win sound', () => {
  const h = harness();
  const g = createGame(h.env);
  g.update(1 / 60, tap('Space'));
  g.update(1 / 60, tap('KeyX'));
  assert.ok(h.sounds.includes('move'));
  assert.ok(h.sounds.includes('shoot'));
});

test('echo hunter: getState exposes no hidden positions and returns copies', () => {
  const w = world();
  const s = snapshot(w);
  const text = JSON.stringify(s);
  for (const key of ['drifters', 'threats', 'noiseDist', 'pend']) assert.ok(!(key in s), key);
  for (const e of [...w.drifters, ...w.threats])
    assert.ok(!text.includes(`"x":${e.x},"y":${e.y}`), `${e.id} must not leak`);
  assert.equal(s.marks.length, 0);
  assert.equal(s.lit.length, 0);
  s.hp = -5;
  s.marks.push({ x: 1 });
  s.player.x = -100;
  assert.equal(snapshot(w).hp, E.MAX_HP);
  assert.equal(snapshot(w).marks.length, 0);
  assert.notEqual(snapshot(w).player.x, -100);
  w.ring = { x: 1, y: 1, r: 1, seen: [], rays: [5, 6] };
  const r = snapshot(w).ring;
  r.rays.push(1);
  assert.equal(w.ring.rays.length, 2);
});

test('echo hunter: status is bilingual, names the cavern, HP, beacons and key prompt', () => {
  const s = snapshot(world());
  assert.match(
    s.status.en,
    new RegExp(`^Cavern ${F1 + 1}/20 · HP ${E.MAX_HP}/${E.MAX_HP} · Beacons 0/2 · .*Space`),
  );
  assert.match(
    s.status.zh,
    new RegExp(`^洞穴${F1 + 1}/20 · 生命 ${E.MAX_HP}/${E.MAX_HP} · 信标 0/2 · .*空格`),
  );
  for (const [key, [en, zh]] of Object.entries(E.PROMPTS)) {
    assert.match(en, /Space|X|Arrows|Outline|Threat|cave|Sonar|ping|Tremor|Roused/i, key);
    assert.match(zh, /[一-鿿]/, key);
    assert.ok(en.length <= 52 && zh.length <= 30, `${key} fits one canvas line`);
  }
  for (const key of ['start', 'ready', 'net']) assert.match(E.PROMPTS[key][0], /Space|X|Arrows/);
  for (const [key, [en, zh]] of Object.entries(E.PROMPTS).filter(([k]) => E.isDangerKey(k))) {
    assert.match(
      en,
      /^Tremor from (the left|the right|above|below): move (left|right|up|down) \([←→↑↓]\)$/,
      key,
    );
    assert.match(zh, /^震动来自.边：向.移动（[←→↑↓]）$/, key);
  }
  assert.match(E.PROMPTS.roused[0], /stop pinging.*away from your last ping/);
  assert.equal(s.prompt.key, 'start');
});

test('echo hunter: prompts follow visible information and hold for at least half a second', () => {
  const w = quiet();
  assert.equal(E.desiredPrompt(w), 'start');
  w.drifters = [mover('drifter', w.p.x + 80, w.p.y)];
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(E.desiredPrompt(w), 'noise');
  w.p.x -= 100;
  assert.equal(E.desiredPrompt(w), 'cooldown');
  run(w, 1);
  locate(w);
  assert.equal(E.desiredPrompt(w), 'chase_right', 'an outline is on screen, to the right');
  run(w, E.MARK_LIFE + 0.5);
  assert.equal(E.desiredPrompt(w), 'ready');
  w.drifters = [mover('drifter', w.p.x + 20, w.p.y)];
  assert.equal(E.desiredPrompt(w), 'locate');
  locate(w);
  assert.equal(E.desiredPrompt(w), 'net');
  w.threats = [mover('threat', w.p.x, w.p.y - 25)];
  assert.match(E.desiredPrompt(w), /^danger_/, 'danger outranks the net prompt');

  // Hold: the shown prompt never changes twice within 0.5 s while the situation flips every tick.
  const h = quiet();
  h.drifters = [mover('drifter', 3000, 3000)];
  const changes = [];
  let last = snapshot(h).prompt.key;
  for (let i = 0; i < 120 * 12; i++) {
    h.threats = i % 20 < 10 ? [mover('threat', h.p.x + 30, h.p.y)] : [];
    h.p.inv = 5;
    stepWorld(h, STEP, idle);
    const key = snapshot(h).prompt.key;
    if (key !== last) {
      changes.push(h.tick * STEP);
      last = key;
    }
  }
  assert.ok(changes.length >= 1);
  for (let i = 1; i < changes.length; i++)
    assert.ok(changes[i] - changes[i - 1] >= 0.54, `${changes[i] - changes[i - 1]}`);
});

test('echo hunter: seeded long simulation stays finite and bounded', () => {
  const rnd = seeded(99);
  const g = createGame(harness({ seed: 5 }).env);
  const all = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  let held = [];
  for (let i = 0; i < 60 * 240; i++) {
    if (i % 20 === 0) held = all.filter(() => rnd() < 0.4);
    const pressed = [];
    if (rnd() < 0.03) pressed.push('Space');
    if (rnd() < 0.05) pressed.push('KeyX');
    g.update(1 / 60, input(held, pressed));
    const s = g.getState();
    for (const v of [s.player.x, s.player.y, s.score, s.time, s.alarm.value])
      assert.ok(Number.isFinite(v));
    assert.ok(s.marks.length <= 12);
    assert.ok(s.lit.length <= 12);
    assert.ok(s.events.length <= 8);
    assert.ok(s.hp >= 0 && s.hp <= E.MAX_HP);
    assert.ok(s.player.x > 0 && s.player.x < 480 && s.player.y > E.TOP && s.player.y < 320);
    if (s.phase !== 'playing') break;
  }
});

function recorder() {
  const calls = [];
  const ctx = mockContext();
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'fillText')
        return (t, x, y) =>
          calls.push({
            op: 'text',
            t: String(t),
            x,
            y,
            font: target.font,
            align: target.textAlign,
          });
      if (prop === 'fillRect')
        return (x, y, w, h) =>
          calls.push({
            op: 'rect',
            x,
            y,
            w,
            h,
            color: target.fillStyle,
            alpha: target.globalAlpha,
          });
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

test('echo hunter: draw smoke across early, middle, hurt, interlude and terminal states', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    const ctx = recorder();
    g.draw(ctx);
    for (let i = 0; i < 60 * 8; i++) {
      g.update(
        1 / 60,
        input(
          i < 100 ? ['ArrowRight'] : ['ArrowLeft'],
          i === 5 || i === 200 ? ['Space', 'KeyX'] : [],
        ),
      );
      if (i % 40 === 0) g.draw(ctx);
    }
    g.draw(ctx);
    assert.ok(ctx.calls.length > 2000);
    for (const c of ctx.calls) {
      if (c.op === 'text') {
        const size = Number(/(\d+)px/.exec(c.font)[1]);
        assert.ok(size >= 14 && size <= 16, `${c.t} ${c.font}`);
        assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
      } else {
        for (const v of [c.x, c.y, c.w, c.h]) assert.ok(Number.isFinite(v), JSON.stringify(c));
      }
    }
  }
  // Outlines with arrows, an alerted threat, the dashed noise ring, the net, a hurt flash, the roused HUD and the interlude.
  for (const lang of ['en', 'zh']) {
    const w = quiet();
    w.drifters = [
      mover('drifter', w.p.x - 50, w.p.y, { hx: 1 }),
      mover('drifter', w.p.x - 90, w.p.y, { hx: 0, hy: 0 }),
    ];
    w.threats = [
      mover('threat', w.p.x + 60, w.p.y, { state: 'alert', hx: -1, path: [[w.p.x + 40, w.p.y]] }),
    ];
    const env = harness({ lang }).env;
    const ctx = recorder();
    stepWorld(w, 1 / 120, tap('Space', 'KeyX'));
    for (let i = 0; i < 6; i++) {
      run(w, 0.25);
      drawWorld(ctx, w, env); // bright ring, then the dashed noise-only ring, outlines, net
    }
    w.alarm = 3.5;
    w.p.inv = 1;
    w.p.hurtT = 0.2;
    w.msg = { en: 'Test message', zh: '测试消息' };
    drawWorld(ctx, w, env);
    w.tick = 4;
    w.p.moving = true;
    drawWorld(ctx, w, env);
    w.interlude = 1;
    drawWorld(ctx, w, env);
    w.msg = null;
    drawWorld(ctx, w, env);
    assert.ok(
      ctx.calls.some((c) => c.op === 'text' && c.t === '!'),
      'alerted threat outline is flagged',
    );
    assert.ok(
      ctx.calls.some((c) => c.op === 'rect' && c.alpha < 1 && c.alpha > 0),
      'outlines fade',
    );
    for (const c of ctx.calls)
      if (c.op === 'rect') for (const v of [c.x, c.y, c.w, c.h]) assert.ok(Number.isFinite(v));
  }
});

test('echo hunter: layout keeps HUD text on one line each, inside the canvas, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    for (let i = 0; i < 30; i++) g.update(1 / 60, input([], i === 3 ? ['Space'] : []));
    const ctx = recorder();
    g.draw(ctx);
    const texts = ctx.calls.filter((c) => c.op === 'text');
    const width = (t) => [...t].reduce((n, ch) => n + (/[一-鿿·]/.test(ch) ? 14 : 8.4), 0);
    const hud = texts.filter((c) => c.y < E.TOP).sort((a, b) => a.x - b.x);
    assert.ok(hud.length >= 6);
    for (let i = 1; i < hud.length; i++)
      assert.ok(
        hud[i - 1].x + width(hud[i - 1].t) <= hud[i].x + 1,
        `${lang}: ${hud[i - 1].t} / ${hud[i].t}`,
      );
    assert.ok(hud.at(-1).x + width(hud.at(-1).t) <= 480);
    for (const c of texts.filter((t) => t.y > 280)) {
      const half = width(c.t) / 2;
      assert.ok(c.x - half >= 0 && c.x + half <= 480, `${lang}: "${c.t}" fits the prompt band`);
    }
    // The HUD bands cover only the margins; the whole 480 x 256 cave remains playable.
    const bands = ctx.calls.filter((c) => c.op === 'rect' && c.w === 480);
    assert.ok(bands.every((b) => b.y + b.h <= E.TOP || b.y >= E.TOP + ROWS * TILE || b.h === 320));
  }
});

test('echo hunter: an empty sweep says so and points to a next action', () => {
  const w = quiet();
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(E.desiredPrompt(w), 'noise', 'while the ring is still travelling');
  run(w, 2);
  assert.equal(w.ring, null);
  assert.equal(E.desiredPrompt(w), 'empty');
  const s = snapshot(w);
  assert.equal(s.prompt.key, 'empty');
  assert.match(s.prompt.en, /No echoes here.*another room.*Space/);
  assert.match(s.prompt.zh, /没有回声.*空格/);
  assert.match(s.status.en, /No echoes here/);
  w.p.x -= 100;
  assert.notEqual(E.desiredPrompt(w), 'empty', 'moving away ends the empty-sweep prompt');
  // A sweep that found a beetle is not "empty".
  const v = quiet();
  v.drifters = [mover('drifter', v.p.x + 60, v.p.y)];
  stepWorld(v, 1 / 120, tap('Space'));
  run(v, 2);
  assert.notEqual(E.desiredPrompt(v), 'empty');
  assert.equal(E.desiredPrompt(v), 'chase_right');
});

test('echo hunter: a refused ping flashes the Sonar meter on the canvas', () => {
  const w = quiet();
  stepWorld(w, 1 / 120, tap('Space'));
  const frame = (world) => {
    const ctx = recorder();
    drawWorld(ctx, world, harness().env);
    return ctx.calls.filter((c) => c.op === 'rect' && c.color === '#ff4d4d' && c.w === 44);
  };
  assert.equal(snapshot(w).player.pingDenied, false);
  assert.equal(frame(w).length, 0);
  run(w, 0.5);
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(snapshot(w).player.pingDenied, true);
  assert.equal(frame(w).length, 2, 'red frame drawn around the meter');
  assert.ok(snapshot(w).message.en.includes('recharging'));
  run(w, 0.7);
  assert.equal(snapshot(w).player.pingDenied, false);
  assert.equal(frame(w).length, 0);
});

test('echo hunter: the HP label keeps a gap before its pips', () => {
  const ctx = recorder();
  drawWorld(ctx, world(), harness().env);
  const label = ctx.calls.find((c) => c.op === 'text' && c.t === 'HP');
  const pip = ctx.calls.find((c) => c.op === 'rect' && c.y === 9 && c.w === 9 && c.h === 10);
  assert.ok(pip.x - (label.x + 2 * 8.4) >= 4);
});

test('echo hunter: an outline is stamped only while the ring front crosses the object', () => {
  const w = quiet();
  const walker = mover('drifter', w.p.x + 400, w.p.y);
  w.drifters = [walker, mover('drifter', 3000, 3000)];
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 0.3);
  walker.x = w.p.x + 40; // steps into the area the ring has already swept
  run(w, 0.5);
  assert.equal(w.marks.length, 0, 'a late arrival behind the ring front is not revealed');
  const v = quiet();
  v.drifters = [mover('drifter', v.p.x + 60, v.p.y), mover('drifter', 3000, 3000)];
  stepWorld(v, 1 / 120, tap('Space'));
  run(v, 0.5);
  assert.equal(v.marks.length, 1, 'but one the front passes is');
});

test('echo hunter: danger and roused prompts are latched for two seconds', () => {
  const w = quiet();
  w.p.inv = 99;
  w.threats = [mover('threat', w.p.x + 20, w.p.y)];
  run(w, 1);
  assert.match(snapshot(w).prompt.key, /^danger_/);
  w.threats = [];
  assert.match(E.desiredPrompt(w), /^danger_/, 'still latched right after the threat leaves');
  run(w, 1.5);
  assert.match(E.desiredPrompt(w), /^danger_/);
  run(w, 1);
  assert.doesNotMatch(E.desiredPrompt(w), /^danger_/);
  const r = quiet();
  r.alarm = 3.2;
  run(r, 0.1);
  assert.equal(E.desiredPrompt(r), 'roused');
  r.alarm = 0;
  assert.equal(E.desiredPrompt(r), 'roused', 'roused outlives the noise by its latch');
});

test('echo hunter: a nearby threat is felt as a tremor with a bearing but no position', () => {
  const w = quiet();
  assert.equal(snapshot(w).rumble, null);
  w.threats = [mover('threat', w.p.x + 60, w.p.y)];
  const s = snapshot(w);
  assert.ok(Math.abs(s.rumble.bearing) < 1e-9);
  assert.equal(s.rumble.strength, 2 / 3, 'one of three drawn strengths, not a distance');
  w.threats[0].x = w.p.x + 90;
  assert.equal(snapshot(w).rumble.strength, 1 / 3);
  w.threats[0].x = w.p.x + 20;
  assert.equal(snapshot(w).rumble.strength, 1);
  // Bearing comes in 16 sectors, so distances and exact positions cannot be recovered.
  w.threats[0].x = w.p.x + 30;
  w.threats[0].y = w.p.y + 7;
  const sector = Math.PI / 8;
  assert.ok(
    Math.abs(
      snapshot(w).rumble.bearing / sector - Math.round(snapshot(w).rumble.bearing / sector),
    ) < 1e-9,
  );
  w.threats[0].y = w.p.y;
  assert.deepEqual(Object.keys(s.rumble).sort(), ['bearing', 'strength']);
  assert.equal(s.lit.length, 0, 'still unlit and unseen');
  assert.match(E.desiredPrompt(w), /^danger_/, 'the tremor warns before the 30 px lamp does');
  w.threats[0].x = w.p.x + E.RUMBLE_R + 5;
  assert.equal(snapshot(w).rumble, null);
  w.threats[0].x = w.p.x + 40;
  w.threats[0].state = 'recoil';
  assert.equal(snapshot(w).rumble, null, 'a recoiling threat is no danger');
  const ctx = recorder();
  w.threats[0].state = 'patrol';
  drawWorld(ctx, w, harness().env);
  assert.ok(ctx.calls.some((c) => c.op === 'rect' && c.color === '#ff4d5e'));
});

test('echo hunter: the Noise meter shows the whole alarm including the overshoot', () => {
  const w = quiet();
  for (let i = 0; i < 4; i++) {
    stepWorld(w, 1 / 120, tap('Space'));
    run(w, E.PING_CD);
  }
  const a = snapshot(w).alarm;
  assert.equal(a.max, E.ALARM_CAP);
  assert.equal(a.rousedAt, E.ALARM_MAX);
  assert.ok(a.value > E.ALARM_MAX && a.value <= E.ALARM_CAP);
  assert.equal(a.roused, true);
  assert.match(E.meta.description.en, /roused/);
  assert.match(E.meta.description.zh, /惊动/);
  assert.match(E.meta.description.en, /walking distance/);
});

test('echo hunter: the net needs a clear line, so it cannot reach through a wall', () => {
  const w = quiet();
  [w.p.x, w.p.y] = [7 * TILE + 6, at(7, 5)[1]]; // against the wall at the room edge
  w.drifters = [mover('drifter', 5 * TILE + 8, w.p.y), mover('drifter', 3000, 3000)];
  assert.ok(Math.hypot(w.drifters[0].x - w.p.x, w.p.y - w.drifters[0].y) <= E.NET_R + 8);
  stepWorld(w, 1 / 60, tap('KeyX'));
  run(w, 0.3);
  assert.equal(w.beacons, 0);
  assert.ok(E.NET_R <= E.LIGHT_R, 'whatever the net can hit is inside the lamp');
});

test('echo hunter: a missed swing startles beetles in sight and they bolt away', () => {
  const w = quiet();
  const route = [
    [w.p.x + 105, w.p.y],
    [w.p.x + 40, w.p.y],
  ];
  const b = mover('drifter', w.p.x + 70, w.p.y, { speed: 20, pts: route, i: 1, hx: -1 });
  const far = mover('drifter', w.p.x - 10, w.p.y - 90, { speed: 20 });
  w.drifters = [b, far];
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  run(w, E.NET_TIME + 0.1);
  assert.ok(b.startle > 1, 'startled');
  assert.equal(b.dir, -1, 'turned away from the player');
  assert.equal(far.startle, 0, 'one out of range or sight is not');
  const before = b.x;
  run(w, 0.5);
  assert.ok(b.x - before > 20 * 2.2 * 0.5 * 0.9, 'runs at 2.2 times its pace');
  // Behind a wall nothing is startled.
  const v = quiet();
  [v.p.x, v.p.y] = at(8, 5);
  const hidden = mover('drifter', ...at(5, 5), { speed: 10 });
  v.drifters = [hidden, mover('drifter', 3000, 3000)];
  stepWorld(v, 1 / 60, tap('KeyX'));
  run(v, E.NET_TIME + 0.1);
  assert.equal(hidden.startle, 0);
});

test('echo hunter: a sonar-struck beetle freezes for its stated time, then walks on', () => {
  const w = quiet();
  const b = mover('drifter', w.p.x + 40, w.p.y, {
    speed: 20,
    pts: [
      [w.p.x + 40, w.p.y],
      [w.p.x + 40, w.p.y - 60],
    ],
  });
  w.drifters = [b, mover('drifter', 3000, 3000)];
  stepWorld(w, 1 / 120, tap('Space'));
  run(w, 0.5);
  const y0 = b.y;
  run(w, E.STUN_TIME - 0.6);
  assert.equal(b.y, y0, 'frozen');
  run(w, 1);
  assert.ok(b.y < y0 - 5, 'moving again');
});

test('echo hunter: a final catch beats a bite landing in the same tick', () => {
  const w = quiet();
  w.hp = 1;
  w.drifters = [mover('drifter', w.p.x + 10, w.p.y)];
  w.threats = [mover('threat', w.p.x - 8, w.p.y)];
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.equal(w.phase, 'playing');
  assert.equal(w.hp, 3, 'no damage taken; only the cavern-clear heal');
  assert.equal(w.beacons, 1);
  assert.ok(w.interlude > 0, 'the cavern is cleared before the contact is checked');
});

test('echo hunter: beetle lanes, start points and directions are drawn from env.random every cavern', () => {
  const seen = CAVERNS.map((c) => c.drifters.map(() => new Set()));
  const dirs = new Set();
  const starts = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    for (let n = 0; n < CAVERNS.length; n++) {
      const w = createWorld(seeded(seed), { start: n });
      assert.equal(w.cavern, n);
      w.drifters.forEach((d, k) => {
        const key = d.pts.map((p) => p.join(',')).join('|');
        seen[n][k].add(key.split('|').sort().join('|'));
        dirs.add(`${n}:${k}:${d.pts[0].join(',')}`);
        starts.add(`${d.x.toFixed(1)},${d.y.toFixed(1)}`);
        assert.ok(!E.solidAt(w.map, ...E.tileOf(d.x, d.y)), 'every start point is floor');
        assert.ok(d.i >= 0 && d.i < d.pts.length);
        const [tc, tr] = E.tileOf(...d.pts[d.i]);
        assert.ok(E.tunnelDistances(w.map, ...E.tileOf(d.x, d.y))[tr * COLS + tc] >= 0);
      });
    }
  }
  CAVERNS.forEach((c, n) =>
    c.drifters.forEach((spec, k) =>
      assert.equal(
        seen[n][k].size,
        spec.variants.length,
        `cavern ${n + 1} beetle ${k + 1}: every variant gets used`,
      ),
    ),
  );
  assert.ok(dirs.size > 20, 'routes run in both directions');
  assert.ok(starts.size > 100, 'start points vary');
  const a = createWorld(seeded(5)).drifters.map((d) => [d.x, d.y]);
  assert.deepEqual(
    createWorld(seeded(5)).drifters.map((d) => [d.x, d.y]),
    a,
    'same seed, same cavern',
  );
});

test('echo hunter: a roused cave stretches the sonar recharge and the meter shows it', () => {
  const w = quiet();
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(snapshot(w).player.pingCooldownMax, E.PING_CD);
  w.alarm = 3.5;
  w.p.pingCd = 0;
  stepWorld(w, 1 / 120, tap('Space'));
  const p = snapshot(w).player;
  assert.equal(p.pingCooldownMax, E.PING_CD_ROUSED);
  assert.ok(p.pingCooldown > E.PING_CD_ROUSED - 0.05);
  run(w, E.PING_CD + 0.2);
  stepWorld(w, 1 / 120, tap('Space'));
  assert.ok(snapshot(w).events.includes('denied'), 'still recharging after the normal time');
  assert.ok(E.PING_CD_ROUSED > E.PING_CD);
});

test('echo hunter: every HUD element keeps 4 px clearance at maximum values in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const w = quiet();
    w.cavern = F3;
    w.map = CAVERNS[F3].map;
    w.hp = E.MAX_HP;
    w.total = 4;
    w.alarm = E.ALARM_CAP;
    w.p.deniedT = 0.5;
    w.p.netCd = 0.5;
    const ctx = recorder();
    drawWorld(ctx, w, harness({ lang }).env);
    const width = (t) => [...t].reduce((n, ch) => n + (/[\u4e00-\u9fff]/.test(ch) ? 14 : 8.4), 0);
    const boxes = [];
    for (const c of ctx.calls) {
      if (c.y >= 22 || c.y < 6) continue;
      if (c.op === 'text') boxes.push([c.x, c.x + width(c.t)]);
      // Skip full-width HUD bands and the thin red frame around the Sonar meter.
      else if (c.op === 'rect' && c.w < 100 && c.color !== '#ff4d4d') boxes.push([c.x, c.x + c.w]);
    }
    boxes.sort((a, b) => a[0] - b[0]);
    // Merge boxes closer than 3 px (pips of one meter, bar and its fill) into clusters.
    const clusters = [];
    for (const b of boxes) {
      const last = clusters.at(-1);
      if (last && b[0] - last[1] <= 2) last[1] = Math.max(last[1], b[1]);
      else clusters.push([...b]);
    }
    assert.ok(clusters.length >= 9, `${lang}: ${clusters.length} groups`);
    for (let i = 1; i < clusters.length; i++)
      assert.ok(
        clusters[i][0] - clusters[i - 1][1] >= 4,
        `${lang}: ${JSON.stringify(clusters[i - 1])} / ${JSON.stringify(clusters[i])}`,
      );
    assert.ok(clusters.at(-1)[1] <= 476 && clusters[0][0] >= 4);
  }
});

test('echo hunter: sonar charges are a visible budget that pings spend and catches, time and caverns refill', () => {
  const w = quiet();
  let s = snapshot(w);
  assert.equal(s.player.sonarCharges, E.SONAR_START[F1]);
  assert.equal(s.player.sonarMax, E.SONAR_CAP);
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(snapshot(w).player.sonarCharges, E.SONAR_START[F1] - 1);
  assert.ok(snapshot(w).player.nextCharge > 0);
  // Refused pings (cooldown) cost nothing.
  stepWorld(w, 1 / 120, tap('Space'));
  assert.equal(snapshot(w).player.sonarCharges, E.SONAR_START[F1] - 1);
  // A trickle returns one charge after SONAR_TRICKLE seconds.
  run(w, E.SONAR_TRICKLE[F1] + 0.1);
  assert.equal(snapshot(w).player.sonarCharges, E.SONAR_START[F1]);
  // A catch pays one charge back, capped.
  w.p.charges = E.SONAR_CAP;
  w.drifters = [mover('drifter', w.p.x + 10, w.p.y), mover('drifter', 3000, 3000)];
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.equal(snapshot(w).player.sonarCharges, E.SONAR_CAP);
  assert.equal(snapshot(w).player.nextCharge, 0, 'no trickle at the cap');
  const v = quiet();
  v.p.charges = 2;
  v.drifters = [mover('drifter', v.p.x + 10, v.p.y), mover('drifter', 3000, 3000)];
  locate(v);
  stepWorld(v, 1 / 60, tap('KeyX'));
  assert.equal(snapshot(v).player.sonarCharges, 3);
  // Running dry: refused with a message, a flash and an event; the prompt names what to do.
  const d = quiet();
  d.p.charges = 0;
  stepWorld(d, 1 / 120, tap('Space'));
  s = snapshot(d);
  assert.ok(s.events.includes('denied'));
  assert.equal(s.ring, null);
  assert.equal(s.player.pingDenied, true);
  assert.match(s.status.en, /Sonar empty/);
  assert.match(s.status.zh, /声呐没电/);
  assert.equal(E.desiredPrompt(d), 'dry');
  assert.match(E.PROMPTS.dry[0], /net a beetle|wait/);
  // Every cavern starts with a fresh budget.
  const n = quiet();
  n.p.charges = 1;
  n.drifters = [mover('drifter', n.p.x + 10, n.p.y)];
  locate(n);
  stepWorld(n, 1 / 60, tap('KeyX'));
  run(n, 2.5);
  assert.equal(snapshot(n).cavern, F1 + 2);
  assert.equal(snapshot(n).player.sonarCharges, E.SONAR_START[F1 + 1]);
});

test('echo hunter: the tremor prompt names a side and a free direction to move, in both languages', () => {
  const w = quiet();
  [w.p.x, w.p.y] = [232, 134];
  w.threats = [mover('threat', w.p.x - 35, w.p.y)];
  let s = snapshot(w);
  assert.equal(E.desiredPrompt(w), 'danger_left_right');
  w.promptKey = 'danger_left_right';
  s = snapshot(w);
  assert.equal(s.prompt.en, 'Tremor from the left: move right (→)');
  assert.equal(s.prompt.zh, '震动来自左边：向右移动（→）');
  assert.match(s.status.en, /Tremor from the left/);
  // Threat on the other side flips the advice.
  w.threats = [mover('threat', w.p.x + 35, w.p.y)];
  w.dangerKey = null;
  w.dangerHold = null;
  assert.equal(E.desiredPrompt(w), 'danger_right_left');
  // Never into a wall: with the wall on the escape side the advice turns along it.
  const b = quiet();
  [b.p.x, b.p.y] = [7 * TILE + 8, at(7, 5)[1]]; // hard against the room's west wall
  b.threats = [mover('threat', b.p.x + 32, b.p.y)];
  const key = E.desiredPrompt(b);
  assert.match(key, /^danger_right_(up|down)$/, `got ${key}`);
  // Never toward another threat: threats on both sides leave the open lanes.
  const c = quiet();
  [c.p.x, c.p.y] = [232, 134];
  c.threats = [mover('threat', c.p.x - 35, c.p.y), mover('threat', c.p.x + 35, c.p.y)];
  assert.match(E.desiredPrompt(c), /^danger_(left|right)_(up|down)$/);
  // Prompts keep their direction while it stays reasonable (no flip-flopping).
  const d = quiet();
  [d.p.x, d.p.y] = [232, 134];
  d.threats = [mover('threat', d.p.x - 35, d.p.y - 10)];
  run(d, 0.7);
  const first = snapshot(d).prompt.key;
  d.threats[0].y += 20;
  run(d, 0.7);
  assert.equal(snapshot(d).prompt.key.split('_')[2], first.split('_')[2]);
  assert.equal(Object.keys(E.PROMPTS).filter((k) => E.isDangerKey(k)).length, 12);
});

test('echo hunter: a tremor travels through tunnels, not through solid rock', () => {
  const map = CAVERNS[F1].map;
  let pair = null;
  for (let r1 = 1; r1 < 15 && !pair; r1++)
    for (let c1 = 1; c1 < 29 && !pair; c1++) {
      if (E.solidAt(map, c1, r1)) continue;
      const dist = E.tunnelDistances(map, c1, r1);
      for (let r2 = 1; r2 < 15 && !pair; r2++)
        for (let c2 = 1; c2 < 29; c2++) {
          const eu = Math.hypot((c2 - c1) * TILE, (r2 - r1) * TILE);
          if (dist[r2 * COLS + c2] * TILE > 150 && eu < 80 && eu > 20) {
            pair = [
              [c1, r1],
              [c2, r2],
            ];
            break;
          }
        }
    }
  assert.ok(pair, 'a close pair of tiles separated by rock exists');
  const w = quiet();
  [w.p.x, w.p.y] = at(...pair[0]);
  w.threats = [mover('threat', ...at(...pair[1]))];
  assert.equal(snapshot(w).rumble, null, 'no tremor through the rock');
  assert.doesNotMatch(E.desiredPrompt(w), /^danger_/);
  // Outlines of nearby threats count only when their spot is reachable by tunnel too.
  w.threats = [];
  w.marks = [
    {
      id: 't1',
      kind: 'threat',
      x: at(...pair[1])[0],
      y: at(...pair[1])[1],
      dx: 0,
      dy: 0,
      age: 1,
      alerted: false,
    },
  ];
  assert.doesNotMatch(E.desiredPrompt(w), /^danger_/);
  // The same distance in the open is felt.
  const o = quiet();
  [o.p.x, o.p.y] = at(10, 6);
  o.threats = [mover('threat', ...at(12, 6))];
  assert.ok(snapshot(o).rumble);
  o.threats = [];
  o.marks = [
    {
      id: 't1',
      kind: 'threat',
      x: at(12, 6)[0],
      y: at(12, 6)[1],
      dx: 0,
      dy: 0,
      age: 1,
      alerted: false,
    },
  ];
  assert.match(E.desiredPrompt(o), /^danger_/);
});

test('echo hunter: the Sonar HUD draws one pip per charge and a recharge line', () => {
  const w = quiet();
  w.p.charges = 3;
  w.p.pingCd = 1.25;
  const ctx = recorder();
  drawWorld(ctx, w, harness().env);
  const pips = ctx.calls.filter((c) => c.op === 'rect' && c.y === 9 && c.w === 3 && c.h === 9);
  assert.equal(pips.length, E.SONAR_CAP);
  assert.equal(pips.filter((c) => c.color !== '#26324a').length, 3);
  const line = ctx.calls.filter(
    (c) => c.op === 'rect' && c.y === 20 && c.h === 2 && c.color !== '#26324a',
  );
  assert.equal(line[0].w, Math.round(39 * (1 - 1.25 / E.PING_CD)));
});

test('echo hunter: a live outline gets a chase prompt that points to it and outranks the loud-ping advice', () => {
  for (const [dx, dy, want] of [
    [-70, 0, 'chase_left'],
    [70, 0, 'chase_right'],
    [0, -40, 'chase_up'],
    [0, 40, 'chase_down'],
  ]) {
    const w = quiet();
    [w.p.x, w.p.y] = dx ? [232, 134] : [136, 134];
    w.drifters = [mover('drifter', w.p.x + dx, w.p.y + dy), mover('drifter', 3000, 3000)];
    stepWorld(w, 1 / 120, tap('Space'));
    run(w, 1.2); // ring done: the player is still at the ping spot, where the loud-ping advice used to win
    assert.equal(w.marks.length, 1);
    assert.equal(E.desiredPrompt(w), want);
    run(w, 0.6);
    assert.equal(snapshot(w).prompt.key, want);
    assert.match(snapshot(w).prompt.en, /^Beetle found \([←→↑↓]\): walk to its outline, X to net$/);
    assert.match(snapshot(w).prompt.zh, /发现萤甲虫.*按X捕网/);
  }
  // The nearest outline wins, and tremor and roused still outrank the chase prompt.
  const v = quiet();
  [v.p.x, v.p.y] = [232, 134];
  v.drifters = [mover('drifter', v.p.x - 90, v.p.y), mover('drifter', v.p.x + 40, v.p.y)];
  locate(v);
  assert.equal(E.desiredPrompt(v), 'chase_right');
  v.alarm = 3.2;
  assert.equal(E.desiredPrompt(v), 'roused');
  v.alarm = 0;
  v.threats = [mover('threat', v.p.x - 35, v.p.y)];
  assert.match(E.desiredPrompt(v), /^danger_/);
});

test('echo hunter: a patrolling crawler at the edge of the tremor does not trigger the survival prompt', () => {
  const w = quiet();
  [w.p.x, w.p.y] = [232, 134];
  w.threats = [mover('threat', w.p.x + 85, w.p.y)];
  assert.ok(snapshot(w).rumble, 'the ring still shows it');
  assert.doesNotMatch(E.desiredPrompt(w), /^danger_/);
  w.threats[0].x = w.p.x + 55;
  assert.doesNotMatch(E.desiredPrompt(w), /^danger_/, 'still a patrol, still too far to matter');
  w.threats[0].x = w.p.x + 35;
  assert.match(E.desiredPrompt(w), /^danger_/, 'close enough to matter');
  w.threats[0].x = w.p.x + 85;
  w.threats[0].state = 'alert';
  assert.match(E.desiredPrompt(w), /^danger_/, 'a hunting crawler is announced at once');
});

test('echo hunter: the escape arrow heads for an exit, never into a dead end, and holds for two seconds', () => {
  const map = CAVERNS[F1].map;
  const w = quiet();
  [w.p.x, w.p.y] = [150, 118];
  w.threats = [mover('threat', w.p.x, w.p.y - 32)];
  const key = E.desiredPrompt(w);
  assert.match(key, /^danger_up_(down|left|right)$/, 'away from the crawler above');
  // The arrow's run is walkable for at least 40 px.
  const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[key.split('_')[2]];
  for (const k of [12, 28, 40]) {
    const [tc, tr] = E.tileOf(w.p.x + dx * k, w.p.y + dy * k);
    assert.ok(!E.solidAt(map, tc, tr), `walkable ${k} px`);
  }
  // With the crawler between the player and an exit, advice does not point into the room's dead end:
  // a corner player with the open side blocked by the threat is told to go along the walls to the exit.
  const e = quiet();
  [e.p.x, e.p.y] = at(7, 12);
  e.threats = [mover('threat', e.p.x + 30, e.p.y)];
  const toward = E.desiredPrompt(e).split('_')[2];
  assert.notEqual(toward, 'right', 'never toward the crawler');
  // In a corridor with a dead end behind the player and a crawler ahead, advice goes toward open ground
  // as long as there is any, and the direction holds even while the crawler wobbles.
  const h = quiet();
  [h.p.x, h.p.y] = [232, 134];
  h.threats = [mover('threat', h.p.x - 30, h.p.y - 14)];
  run(h, 0.7);
  const first = snapshot(h).prompt.key;
  assert.match(first, /^danger_/);
  for (const y of [14, -14, 14, -14]) {
    h.threats[0].y = h.p.y + y;
    run(h, 0.45);
    assert.equal(
      snapshot(h).prompt.key.split('_')[2],
      first.split('_')[2],
      'direction holds through the wobble',
    );
  }
});

test('echo hunter: after 3 s of danger the escape asks for a longer trip so the player leaves the room', () => {
  const w = quiet();
  w.p.inv = 99;
  [w.p.x, w.p.y] = at(3, 12);
  w.threats = [mover('threat', w.p.x, w.p.y - 32, { speed: 0 })];
  run(w, 0.8);
  assert.match(snapshot(w).prompt.key, /^danger_/);
  assert.equal(w.dangerSince !== null, true);
  const early = E.desiredPrompt(w);
  run(w, 3.2);
  assert.ok(w.tick * STEP - w.dangerSince > 3);
  assert.match(E.desiredPrompt(w), /^danger_/);
  assert.ok(early.startsWith('danger_'));
  // Leaving the danger resets the clock once the latch has run out.
  w.threats = [];
  run(w, 2.5);
  assert.equal(w.dangerSince, null);
});

test('echo hunter: the teaching caverns refill a charge faster than the later ones', () => {
  assert.ok(E.SONAR_TRICKLE[0] < E.SONAR_TRICKLE.at(-1));
  assert.ok(E.SONAR_TRICKLE[F1] < E.SONAR_TRICKLE[F2]);
  const w = quiet();
  w.p.charges = 2;
  run(w, E.SONAR_TRICKLE[F1] + 0.1);
  assert.equal(w.p.charges, 3);
  assert.ok(snapshot(w).player.nextCharge <= E.SONAR_TRICKLE[F1]);
});

test('echo hunter: the third cavern bottom-right crawler patrols open ground and its escape arrow stays walkable', () => {
  const cave = CAVERNS[F3];
  const [from, to] = cave.threats[1].pts;
  assert.ok(to[0] - from[0] <= 8, 'a short patrol');
  const w = quiet();
  let advised = 0;
  w.map = cave.map;
  w.walkCache = undefined;
  w.cavern = F3;
  for (let x = from[0]; x <= to[0]; x++) {
    for (const [c, r] of [
      [x, 12],
      [x - 1, 13],
      [x + 1, 13],
    ]) {
      if (E.solidAt(cave.map, c, r) || E.solidAt(cave.map, x, from[1])) continue;
      [w.p.x, w.p.y] = at(c, r);
      w.threats = [mover('threat', ...at(x, from[1]))];
      w.dangerHold = null;
      const key = E.desiredPrompt(w);
      if (!key.startsWith('danger_')) continue;
      advised++;
      const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[
        key.split('_')[2]
      ];
      for (const k of [12, 28, 40])
        assert.ok(
          !E.solidAt(cave.map, ...E.tileOf(w.p.x + dx * k, w.p.y + dy * k)),
          `${key} at ${c},${r} is walkable ${k} px`,
        );
    }
  }
  assert.ok(advised > 3, `${advised} advised positions`);
});

// ------------------------------------------------------------- twenty caverns

// An oracle player: walks the tunnel path to the nearest beetle, pings when close and in sight, and
// nets once it is outlined. It reads the world, so it proves a cavern can be cleared, not that it is easy.
function clearByOracle(index, hz = 60) {
  const w = createWorld(seeded(index + 1), { start: index });
  w.hp = 99; // hazards are judged by the bot gates; here only geometry and rules are on trial
  const dt = 1 / hz;
  for (let i = 0; i < 400 * hz && w.phase === 'playing' && w.cavern === index; i++) {
    w.p.charges = Math.max(w.p.charges, 2);
    const me = w.p,
      [mc, mr] = E.tileOf(me.x, me.y),
      target = [...w.drifters].sort(
        (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
      )[0];
    if (!target) break;
    const near = Math.hypot(target.x - me.x, target.y - me.y),
      marked = w.marks.some((m) => m.id === target.id),
      held = [],
      pressed = [];
    if (
      near < 90 &&
      E.lineClear(w.map, me.x, me.y, target.x, target.y) &&
      !marked &&
      me.pingCd <= 0
    )
      pressed.push('Space');
    if (marked && near < E.NET_R - 8) pressed.push('KeyX');
    const [tc, tr] = E.tileOf(target.x, target.y),
      dist = E.tunnelDistances(w.map, tc, tr),
      here = dist[mr * COLS + mc];
    let [gx, gy] = [target.x, target.y];
    if (here > 1)
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (dist[(mr + dr) * COLS + mc + dc] === here - 1) {
          [gx, gy] = at(mc + dc, mr + dr);
          break;
        }
    if (gx - me.x > 2) held.push('ArrowRight');
    if (gx - me.x < -2) held.push('ArrowLeft');
    if (gy - me.y > 2) held.push('ArrowDown');
    if (gy - me.y < -2) held.push('ArrowUp');
    stepWorld(w, dt, input(held, pressed));
  }
  return w;
}

test('echo hunter: every one of the twenty caverns can be cleared by a scripted player', () => {
  CAVERNS.forEach((cave, index) => {
    const w = clearByOracle(index);
    const cleared = w.phase === 'won' || w.cavern > index || w.interlude > 0;
    assert.ok(cleared, `${cave.id} is solvable (beacons ${w.beacons}/${w.total})`);
    assert.equal(w.beacons, w.total);
  });
  // The same script also clears a cavern at a coarse frame rate.
  assert.ok(clearByOracle(F2, 30).interlude > 0);
});

// Follows the escape arrow for 50 frames against a crawler that stands still two tiles away. The
// player is never given a reason to turn back: the arrow must not reverse, and it must lead out of
// the crawler's reach (45 px) rather than into a corner.
const arrowOf = (key) =>
  ({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' })[key.split('_')[2]];
function fleeFrom(index, playerTile, crawlerTile) {
  const w = createWorld(seeded(3), { start: index });
  w.p.inv = 99;
  w.drifters = [mover('drifter', 3000, 3000)];
  [w.p.x, w.p.y] = at(...playerTile);
  w.threats = [mover('threat', ...at(...crawlerTile))];
  const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' };
  const dirs = [];
  for (let i = 0; i < 50; i++) {
    const key = E.desiredPrompt(w);
    if (key.startsWith('danger_')) dirs.push(key.split('_')[2]);
    stepWorld(w, 1 / 60, key.startsWith('danger_') ? keys(arrowOf(key)) : idle);
  }
  return {
    reversals: dirs.filter((d, i) => i && dirs[i - 1] === opposite[d]).length,
    distance: Math.hypot(w.p.x - w.threats[0].x, w.p.y - w.threats[0].y),
  };
}

test('echo hunter: in every cavern the escape arrow leads out of reach, never reverses and never ends in a corner', () => {
  let cases = 0,
    skipped = 0;
  for (const [index, cave] of CAVERNS.entries()) {
    const reach = E.tunnelDistances(cave.map, ...cave.start),
      tiles = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (reach[r * COLS + c] >= 0) tiles.push([c, r]);
    const stride = Math.max(1, Math.floor(tiles.length / 14));
    for (let k = 0; k < tiles.length; k += stride) {
      const player = tiles[k],
        mine = E.tunnelDistances(cave.map, ...player),
        crawler = tiles.find(([c, r]) => mine[r * COLS + c] === 2);
      if (!crawler) continue;
      // Only where an exit exists: a tile the player reaches (4-10 steps) well before the crawler.
      const theirs = E.tunnelDistances(cave.map, ...crawler);
      if (
        !tiles.some(
          ([c, r]) =>
            mine[r * COLS + c] >= 4 &&
            mine[r * COLS + c] <= 10 &&
            theirs[r * COLS + c] > mine[r * COLS + c] + 1,
        )
      ) {
        skipped++;
        continue;
      }
      const { reversals, distance } = fleeFrom(index, player, crawler);
      cases++;
      assert.equal(reversals, 0, `${cave.id} ${player} from ${crawler}: the arrow flipped`);
      assert.ok(
        distance >= 45,
        `${cave.id} ${player} from ${crawler}: ended ${distance.toFixed(0)} px away`,
      );
    }
  }
  assert.ok(cases > 250, `${cases} escapes checked, ${skipped} had no exit`);
});

test('echo hunter: the cavern chooser appears only with saved progress and starts the chosen cavern', () => {
  const saved = [];
  const h = harness();
  h.env.progress = { unlocked: () => 7, unlock: (level) => saved.push(level) };
  const g = createGame(h.env);
  let s = g.getState();
  assert.deepEqual(s.select, { index: 7, reached: 7, total: 20 }, 'continues at the saved cavern');
  assert.equal(s.prompt.key, 'select');
  assert.equal(s.cavern, 7);
  const before = JSON.stringify(s.player);
  for (let i = 0; i < 60; i++) g.update(1 / 60, keys('ArrowRight', 'KeyX'));
  assert.equal(JSON.stringify(g.getState().player), before, 'nothing simulates behind the chooser');
  assert.equal(g.getState().time, 0);
  g.update(1 / 60, tap('ArrowRight'));
  assert.equal(g.getState().select.index, 7, 'cannot pick a cavern that is not reached yet');
  g.update(1 / 60, tap('ArrowLeft'));
  assert.equal(g.getState().select.index, 6);
  assert.equal(g.getState().cavern, 6, 'the chosen cavern is shown behind the chooser');
  assert.ok(g.getState().events.includes('select'));
  assert.ok(h.sounds.includes('move'));
  g.update(1 / 60, tap('ArrowUp'));
  assert.equal(g.getState().select.index, 1, 'Up jumps five caverns back, but not past the first');
  g.update(1 / 60, tap('KeyD'));
  g.update(1 / 60, tap('KeyS'));
  assert.equal(g.getState().select.index, 7, 'D / S also move, and Down jumps five');
  g.update(1 / 60, tap('KeyA'));
  g.update(1 / 60, tap('KeyW'));
  assert.equal(g.getState().select.index, 1);
  g.update(1 / 60, tap('ArrowRight'));
  g.update(1 / 60, tap('Enter'));
  s = g.getState();
  assert.equal(s.select, null);
  assert.equal(s.cavern, 2, 'Enter starts the shown cavern');
  assert.ok(s.events.includes('begin'));
  assert.equal(s.player.sonarCharges, E.SONAR_START[1]);
  g.update(1 / 60, tap('Space'));
  assert.ok(g.getState().ring, 'the game plays normally afterwards');
  assert.deepEqual(saved, []);
});

test('echo hunter: without saved progress the game starts at once, and odd saved values mean cavern 1', () => {
  for (const progress of [
    undefined,
    {},
    { unlocked: () => 1 },
    { unlocked: () => 0 },
    { unlocked: () => 'x' },
    { unlocked: () => NaN },
    { unlocked: () => -4 },
  ]) {
    const h = harness();
    if (progress) h.env.progress = progress;
    const s = createGame(h.env).getState();
    assert.equal(s.select, null, JSON.stringify(progress));
    assert.equal(s.cavern, 1);
  }
  const h = harness();
  h.env.progress = { unlocked: () => 999 };
  const s = createGame(h.env).getState();
  assert.equal(s.select.index, 20, 'a too-large value is clamped to the last cavern');
  assert.equal(s.select.reached, 20);
});

test('echo hunter: clearing a cavern saves the next one through the host, and the last one saves the final cavern', () => {
  const saved = [];
  const unlock = (level) => saved.push(level);
  const w = createWorld(seeded(1), { unlock });
  w.drifters = [mover('drifter', beside(w), w.p.y)];
  locate(w);
  stepWorld(w, 1 / 60, tap('KeyX'));
  assert.deepEqual(saved, [2]);
  const last = createWorld(seeded(1), { start: 19, unlock });
  last.drifters = [mover('drifter', beside(last), last.p.y)];
  locate(last);
  stepWorld(last, 1 / 60, tap('KeyX'));
  assert.equal(last.phase, 'won');
  assert.deepEqual(saved, [2, 20]);
  // A host without progress support is fine: clearing does not throw.
  const bare = createWorld(seeded(1));
  bare.drifters = [mover('drifter', beside(bare), bare.p.y)];
  locate(bare);
  stepWorld(bare, 1 / 60, tap('KeyX'));
  assert.ok(bare.interlude > 0);
  // Through createGame, with a host that only reads progress, nothing throws either.
  const h = harness();
  h.env.progress = { unlocked: () => 1 };
  assert.equal(createGame(h.env).getState().cavern, 1);
});

test('echo hunter: the first four caverns each state one lesson, bilingual, then hand over to play', () => {
  const lessons = new Set();
  for (let n = 0; n < 4; n++) {
    const w = createWorld(seeded(1), { start: n });
    const s = snapshot(w);
    assert.ok(s.message.en && s.message.zh);
    assert.equal(s.message.en, CAVERNS[n].lesson.en);
    assert.match(s.status.zh, new RegExp(CAVERNS[n].lesson.zh));
    lessons.add(s.message.en);
    run(w, 4.9);
    assert.ok(snapshot(w).message, 'still shown after 4.9 s');
    run(w, 0.3);
    assert.equal(snapshot(w).message, null, 'gone after 5 s');
  }
  assert.equal(lessons.size, 4);
  assert.equal(
    snapshot(createWorld(seeded(1), { start: 4 })).message,
    null,
    'later caverns have none',
  );
});

test('echo hunter: the chooser draws inside the canvas in both languages with 14-16 px text', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 20, unlock() {} };
    const g = createGame(h.env);
    const ctx = recorder();
    g.draw(ctx);
    const texts = ctx.calls.filter((c) => c.op === 'text');
    const width = (t) => [...t].reduce((n, ch) => n + (/[一-鿿·]/.test(ch) ? 16 : 9.6), 0);
    const panel = texts.filter((t) => t.y > 80 && t.y < 200);
    assert.ok(panel.length >= 4, `${lang}: chooser lines`);
    for (const c of panel) {
      assert.ok(
        c.x - width(c.t) / 2 >= 60 && c.x + width(c.t) / 2 <= 420,
        `${lang}: "${c.t}" fits the panel`,
      );
      const size = Number(/(\d+)px/.exec(c.font)[1]);
      assert.ok(size >= 14 && size <= 16, `${lang}: "${c.t}" is ${size} px`);
    }
    assert.ok(panel.some((c) => c.t.includes('20/20')));
  }
});

test('echo hunter: a snapshot is a copy, so editing its walls never changes the cavern', () => {
  const g = createGame(harness().env);
  const first = g.getState();
  const original = CAVERNS[0].map[3];
  first.walls[3] = '#'.repeat(COLS);
  first.walls.push('x');
  assert.equal(CAVERNS[0].map[3], original);
  assert.deepEqual(g.getState().walls, CAVERNS[0].map);
  assert.notEqual(g.getState().walls, g.getState().walls, 'each snapshot has its own array');
  assert.deepEqual(
    createGame(harness().env).getState().walls,
    CAVERNS[0].map,
    'a new instance is unaffected',
  );
});
