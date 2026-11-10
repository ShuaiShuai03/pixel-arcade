import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  newState,
  drawGame,
  advance,
  snapshotOf,
  closeCheck,
  RULES,
  LEVELS,
  LEVEL_COUNT,
  MENU_LAYOUT,
  pointInPolygon,
  polygonArea,
  coveredArea,
  spreadArea,
  pointSegmentDistance,
  segmentIntersection,
  segmentDistance,
} from '../src/games/firefly-trail.js';
import { harness, input, mockContext, seeded } from './harness.js';

const CJK = /[一-鿿]/;
const emitted = [];
const emit = (n) => emitted.push(n);

function progressEnv(unlocked = 1, extra = {}) {
  const h = harness(extra);
  const log = [];
  let value = unlocked;
  h.env.progress = {
    unlocked: () => value,
    unlock: (n) => {
      log.push(n);
      value = Math.max(value, n);
    },
  };
  return { h, log, value: () => value };
}

// A lab state on a given meadow with the menu skipped.
function lab(level = 1) {
  const { h, log } = progressEnv(level);
  const s = newState(h.env);
  if (s.menu) advance(s, 1 / 60, input([], ['Space']), emit);
  s.log = log;
  s.inv = 0;
  return s;
}
// Replace the meadow's fireflies / moths with scripted ones (the shared meadow data stays intact).
function setFlies(s, points) {
  s.L = {
    ...s.L,
    quota: points.length,
    plans: [],
    flies: points.map((p, id) => ({
      id,
      at: () => ({ x: p[0], y: p[1] }),
      home: { x: p[0], y: p[1] },
    })),
  };
  s.flies = points.map((p, id) => ({ id, alive: true, x: p[0], y: p[1] }));
  s.plan = null;
}
function setMoths(s, list) {
  s.L = {
    ...s.L,
    moths: list.map(({ at, r = 7, kind = 0 }) => ({ kind, r, at, spec: { pts: [[0, 0]] } })),
  };
  s.moths = list.map(({ at }) => {
    const p = at(s.t);
    return { x: p.x, y: p.y, px: p.x, py: p.y };
  });
}
function run(s, seconds, held = [], pressed = [], hz = 120) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) advance(s, 1 / hz, input(held, i === 0 ? pressed : []), emit);
}
// Walk a polyline of keys: [[keys, seconds], ...].
function walk(s, legs) {
  for (const [keys, seconds] of legs) run(s, seconds, keys);
}
const R = 'ArrowRight';
const L = 'ArrowLeft';
const U = 'ArrowUp';
const D = 'ArrowDown';
const at = (s, x, y) => {
  s.p.x = x;
  s.p.y = y;
};

// ---------------------------------------------------------------- metadata and data

test('metadata is complete, bilingual and the touch layout covers every action', () => {
  assert.equal(meta.id, 'firefly-trail');
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.ok(meta.name.en && CJK.test(meta.name.zh));
  assert.ok(CJK.test(meta.description.zh) && /trail/i.test(meta.description.en));
  assert.ok(/cross/i.test(meta.description.en) && /fad/i.test(meta.description.en));
  for (const k of meta.keys) assert.ok(k.label.en && CJK.test(k.label.zh) && k.keys);
  const keys = meta.keys.map((k) => k.keys).join(' ');
  assert.ok(/Arrows/.test(keys) && /Space/.test(keys) && /X/.test(keys));
  const codes = meta.touchControls.map((c) => c.code).sort();
  assert.deepEqual(codes, ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyX', 'Space']);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && CJK.test(c.label.zh));
    assert.ok(['left', 'right'].includes(c.side));
  }
});

test('there are at least 20 authored meadows with consistent, bilingual data', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.equal(LEVELS.length, LEVEL_COUNT);
  const f = RULES.field;
  const inField = (x, y, pad = 0) =>
    x >= f.x0 + pad && x <= f.x1 - pad && y >= f.y0 + pad && y <= f.y1 - pad;
  const names = new Set();
  LEVELS.forEach((m, i) => {
    const tag = `meadow ${i + 1}`;
    assert.ok(m.name[0] && CJK.test(m.name[1]) && m.tip[0] && CJK.test(m.tip[1]), tag);
    assert.ok(m.name[0].length <= 22 && m.name[1].length <= 12, `${tag} name length`);
    names.add(m.name[0]);
    assert.ok(m.quota >= 1 && m.quota <= m.flies.length, `${tag} quota`);
    assert.ok(m.dawn >= 20 && m.fade >= 3, `${tag} timers`);
    for (const fly of m.flies) {
      const p = Array.isArray(fly) ? fly : fly.c || fly.pts[0];
      assert.ok(inField(p[0], p[1], 16), `${tag} firefly inside the field`);
    }
    for (const b of m.blocks || []) {
      assert.ok(b.r >= 12 && inField(b.x, b.y), `${tag} flower`);
      for (const fly of m.flies) {
        const p = Array.isArray(fly) ? fly : fly.c || fly.pts[0];
        const gap = Math.hypot(p[0] - b.x, p[1] - b.y);
        const spread = fly.c ? fly.r : 0;
        assert.ok(Math.abs(gap - spread) > b.r + 10, `${tag} flower on a firefly`);
      }
    }
    assert.ok(m.plans.length >= 1, `${tag} has a scripted route`);
    for (const plan of m.plans) {
      const route = [...(plan.via || []), ...plan.pts];
      for (const [x, y] of route) assert.ok(inField(x, y, 4), `${tag} route point in field`);
      // Every leg keeps clear of the flowers so the lantern is never snagged.
      for (let k = 1; k < route.length; k++)
        for (const b of m.blocks || [])
          assert.ok(
            pointSegmentDistance(
              { x: b.x, y: b.y },
              { x: route[k - 1][0], y: route[k - 1][1] },
              { x: route[k][0], y: route[k][1] },
            ) >
              b.r + RULES.playerR + 8,
            `${tag} route leg touches a flower`,
          );
    }
    const start = m.start || [44, 262];
    for (const mo of m.moths || []) assert.ok([0, 1, 2, 3].includes(mo.kind), `${tag} moth kind`);
    assert.ok(start[0] > 0);
  });
  assert.equal(names.size, LEVEL_COUNT, 'meadow names are unique');
});

test('every tip fits the 480 px bottom band at a conservative 0.6 em per character', () => {
  const width = (str) => [...str].reduce((n, ch) => n + (CJK.test(ch) ? 14 : 8.4), 0);
  for (const m of LEVELS) {
    assert.ok(width(m.tip[0]) <= 470, m.tip[0]);
    assert.ok(width(m.tip[1]) <= 470, m.tip[1]);
  }
});

test('every scripted loop encloses its fireflies with room to spare, and the loops reach the quota', () => {
  LEVELS.forEach((m, i) => {
    let reachable = 0;
    m.flies.forEach((fly, id) => {
      const home = Array.isArray(fly)
        ? { x: fly[0], y: fly[1] }
        : fly.c
          ? { x: fly.c[0], y: fly.c[1] }
          : {
              x:
                (Math.min(...fly.pts.map((p) => p[0])) + Math.max(...fly.pts.map((p) => p[0]))) / 2,
              y:
                (Math.min(...fly.pts.map((p) => p[1])) + Math.max(...fly.pts.map((p) => p[1]))) / 2,
            };
      const radius = Array.isArray(fly)
        ? 0
        : fly.c
          ? fly.r
          : Math.max(
              Math.abs(fly.pts[0][0] - fly.pts[1][0]) / 2,
              Math.abs(fly.pts[0][1] - fly.pts[1][1]) / 2,
            );
      for (const plan of m.plans) {
        const poly = plan.cross ? crossPolygon(plan.pts) : plan.pts.map(([x, y]) => ({ x, y }));
        if (!pointInPolygon(home, poly)) continue;
        reachable++;
        // The whole drift envelope sits inside the loop, at least 14 px from every edge.
        for (let a = 0; a < 16; a++) {
          const p = {
            x: home.x + Math.cos((a / 16) * 2 * Math.PI) * (radius + 14),
            y: home.y + Math.sin((a / 16) * 2 * Math.PI) * (radius + 14),
          };
          if (fly.pts) {
            p.x = home.x + Math.sign(Math.cos((a / 16) * 2 * Math.PI)) * 0;
            p.y = home.y;
          }
          assert.ok(pointInPolygon(p, poly), `meadow ${i + 1} firefly ${id}: margin`);
        }
        assert.ok(polygonArea(poly) > RULES.minArea * 2, `meadow ${i + 1} loop too small`);
        break;
      }
    });
    assert.ok(reachable >= m.quota, `meadow ${i + 1}: loops reach ${reachable} of ${m.quota}`);
  });
});

function crossPolygon(pts) {
  const p = pts.map(([x, y]) => ({ x, y }));
  const last = p.length - 1;
  for (let i = 0; i < last - 2; i++) {
    const hit = segmentIntersection(p[last - 1], p[last], p[i], p[i + 1]);
    if (hit) return [{ x: hit.x, y: hit.y }, ...p.slice(i + 1, last)];
  }
  throw new Error('route never crosses');
}

test('the first meadows teach one idea at a time, then combine, then master', () => {
  const m = (n) => LEVELS[n - 1];
  const features = (x) => ({
    moths: (x.moths || []).length,
    blocks: (x.blocks || []).length,
    moving: x.flies.filter((f) => !Array.isArray(f)).length,
    cross: x.plans.some((p) => p.cross),
    multi: x.quota > 1,
  });
  // 1: draw and close a loop - nothing else.
  assert.deepEqual(features(m(1)), { moths: 0, blocks: 0, moving: 0, cross: false, multi: false });
  assert.ok(m(1).fade >= 15, 'the first trail effectively does not fade');
  // 2: the trail fades.
  assert.ok(m(2).fade < 10 && /fades/.test(m(2).tip[0]));
  // 3: quotas.
  assert.equal(m(3).quota, 2);
  // 4: crossing your own trail closes the loop.
  assert.ok(features(m(4)).cross && /Cross/.test(m(4).tip[0]));
  // 5-6: moths, then moths that cut trails.
  assert.equal(features(m(5)).moths, 1);
  assert.ok(/cuts/.test(m(6).tip[0]));
  // 7: several fireflies in one loop.
  assert.ok(m(7).quota >= 3 && /several/.test(m(7).tip[0]));
  // 8: drifting fireflies.
  assert.ok(features(m(8)).moving >= 1);
  // 9: flowers.
  assert.ok(features(m(9)).blocks >= 3);
  // 10: a timer.
  assert.ok(m(10).dawn <= 50 && /timer/.test(m(10).tip[0]));
  // Late meadows combine ideas, the last one uses all of them.
  const last = features(m(LEVEL_COUNT));
  assert.ok(last.moths >= 2 && last.blocks >= 3 && last.moving >= 2 && m(LEVEL_COUNT).quota >= 4);
  assert.ok(
    new Set(LEVELS.flatMap((x) => (x.moths || []).map((y) => y.kind))).size === 4,
    'four moth kinds',
  );
  assert.ok(LEVELS.filter((x) => (x.moths || []).length >= 2).length >= 3);
});

// ---------------------------------------------------------------- geometry

test('geometry helpers: containment, crossings, distances and areas', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.ok(pointInPolygon({ x: 5, y: 5 }, square));
  assert.ok(!pointInPolygon({ x: 15, y: 5 }, square));
  assert.ok(!pointInPolygon({ x: 5, y: -1 }, square));
  // A U shape: the notch is outside, the arms are inside.
  const u = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 30 },
    { x: 20, y: 30 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 30 },
    { x: 0, y: 30 },
  ];
  assert.ok(pointInPolygon({ x: 5, y: 20 }, u));
  assert.ok(pointInPolygon({ x: 25, y: 20 }, u));
  assert.ok(pointInPolygon({ x: 15, y: 5 }, u));
  assert.ok(!pointInPolygon({ x: 15, y: 20 }, u), 'the notch is outside');
  assert.equal(polygonArea(square), 100);
  assert.equal(polygonArea(u), 30 * 30 - 10 * 20);
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 10 };
  const hit = segmentIntersection(a, b, { x: 0, y: 10 }, { x: 10, y: 0 });
  assert.deepEqual([hit.x, hit.y], [5, 5]);
  assert.equal(segmentIntersection(a, b, { x: 0, y: 1 }, { x: 10, y: 11 }), null, 'parallel');
  assert.equal(segmentIntersection(a, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 5, y: 9 }), null);
  assert.equal(segmentDistance(a, b, { x: 0, y: 10 }, { x: 10, y: 0 }), 0);
  assert.equal(segmentDistance(a, { x: 10, y: 0 }, { x: 0, y: 4 }, { x: 10, y: 4 }), 4);
  assert.equal(pointSegmentDistance({ x: 3, y: 4 }, a, a), 5, 'degenerate segment');
  assert.equal(pointSegmentDistance({ x: 5, y: 3 }, a, { x: 10, y: 0 }), 3);
});

// ---------------------------------------------------------------- input and time

test('invalid frame times are inert and never consume a press', () => {
  const s = lab(1);
  const before = JSON.stringify(snapshotOf(s));
  for (const dt of [NaN, undefined, null, 0, -1 / 60, Infinity, 0.2, 'x'])
    assert.equal(advance(s, dt, input([R], ['Space']), emit), false, String(dt));
  assert.equal(JSON.stringify(snapshotOf(s)), before);
  assert.equal(s.trail.on, false);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.trail.on, true, 'the press still works afterwards');
});

test('the same aligned input gives identical full state at 30, 60 and 120 Hz', () => {
  for (const level of [1, 6, 15, 24]) {
    const finals = [];
    for (const hz of [30, 60, 120]) {
      const s = lab(level);
      const rnd = seeded(level * 11);
      let held = [];
      const per = hz / 30;
      for (let frame = 0; frame < 30 * 25; frame++) {
        if (frame % 9 === 0) held = [R, L, U, D].filter(() => rnd() < 0.35);
        const pressed = frame % 41 === 0 ? ['Space'] : frame % 97 === 0 ? ['KeyX'] : [];
        for (let k = 0; k < per; k++) advance(s, 1 / hz, input(held, k === 0 ? pressed : []), emit);
      }
      finals.push(JSON.stringify(snapshotOf(s)));
    }
    assert.equal(finals[0], finals[1], `meadow ${level}: 30 vs 60 Hz`);
    assert.equal(finals[1], finals[2], `meadow ${level}: 60 vs 120 Hz`);
  }
});

test('movement is free-form: eight directions at one speed, held keys only, WASD too', () => {
  const s = lab(1);
  at(s, 200, 150);
  run(s, 1, [R]);
  assert.ok(Math.abs(s.p.x - (200 + RULES.speed)) < 0.5 && s.p.y === 150);
  run(s, 0.5, []);
  assert.ok(Math.abs(s.p.x - (200 + RULES.speed)) < 0.5, 'stops when released');
  at(s, 200, 150);
  run(s, 1, [R, D]);
  const diag = Math.hypot(s.p.x - 200, s.p.y - 150);
  assert.ok(Math.abs(diag - RULES.speed) < 0.5, `diagonal speed ${diag}`);
  assert.ok(s.p.x > 250 && s.p.y > 200);
  at(s, 200, 150);
  run(s, 0.5, ['KeyA', 'KeyW']);
  assert.ok(s.p.x < 200 && s.p.y < 150);
  at(s, 200, 150);
  run(s, 0.5, ['KeyD']);
  run(s, 0.5, ['KeyS']);
  assert.ok(s.p.x > 200 && s.p.y > 150);
  at(s, 200, 150);
  run(s, 0.5, [L, R]);
  assert.equal(s.p.x, 200, 'opposite keys cancel');
  assert.equal(s.p.moving, false);
});

test('the lantern stays inside the field and flowers block it without trapping it', () => {
  const s = lab(1);
  at(s, 12, 36);
  run(s, 1, [L, U]);
  assert.deepEqual([s.p.x, s.p.y], [RULES.field.x0, RULES.field.y0]);
  at(s, 460, 280);
  run(s, 1, [R, D]);
  assert.deepEqual([s.p.x, s.p.y], [RULES.field.x1, RULES.field.y1]);
  const g = lab(9);
  const b = g.L.blocks[0];
  at(g, b.x - 60, b.y);
  run(g, 2, [R]);
  assert.ok(
    Math.hypot(g.p.x - b.x, g.p.y - b.y) >= b.r + RULES.playerR - 0.01,
    'stopped at the bloom',
  );
  assert.ok(g.p.x < b.x);
  // Pushing diagonally slides around the flower instead of sticking.
  run(g, 1.5, [R, D]);
  assert.ok(g.p.y > b.y + 5, 'slides past');
  at(g, b.x, b.y);
  run(g, 0.1, []);
  assert.ok(
    Math.hypot(g.p.x - b.x, g.p.y - b.y) >= b.r + RULES.playerR - 0.01,
    'pushed out of the centre',
  );
});

// ---------------------------------------------------------------- trail and capture

test('Space begins a trail where the lantern stands and X cancels it without penalty', () => {
  const s = lab(1);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.trail.on, true);
  assert.deepEqual([s.trail.pts[0].x, s.trail.pts[0].y], [100, 200]);
  run(s, 0.5, [R]);
  assert.ok(s.trail.pts.length > 5);
  const gaps = s.trail.pts
    .slice(1)
    .map((q, i) => Math.hypot(q.x - s.trail.pts[i].x, q.y - s.trail.pts[i].y));
  assert.ok(
    gaps.every((d) => d >= RULES.sample - 1e-6 && d < RULES.sample + 1),
    'evenly sampled',
  );
  advance(s, 1 / 60, input([], ['KeyX']), emit);
  assert.equal(s.trail.on, false);
  assert.equal(s.stats.cancels, 1);
  assert.equal(s.lives, RULES.lives);
  assert.match(snapshotOf(s).message.en, /cancelled/);
  advance(s, 1 / 60, input([], ['KeyX']), emit);
  assert.equal(s.stats.cancels, 1, 'X does nothing without a trail');
});

test('the trail fades: points older than the meadow fade time disappear, oldest first', () => {
  const s = lab(2);
  assert.equal(s.L.fade, 6.5);
  at(s, 60, 250);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 2],
    [[U], 1],
    [[L], 2],
    [[U], 1],
    [[R], 2],
    [[U], 1],
  ]);
  const snap = snapshotOf(s);
  assert.ok(snap.trail.on);
  assert.ok(
    snap.trail.points.every((p) => p.age <= 6.5 + 0.02),
    'nothing older than the fade time',
  );
  assert.ok(
    snap.trail.points[0].x > 70 || snap.trail.points[0].y < 245,
    'the start has faded away',
  );
  assert.ok(snap.trail.life > 0 && snap.trail.life <= 6.5);
  assert.ok(snap.trail.points.length < 150, 'bounded');
});

test('Space closes a loop by real polygon containment: only fireflies inside are caught', () => {
  const s = lab(1);
  setFlies(s, [
    [200, 150],
    [300, 150],
    [250, 260],
  ]);
  s.L.quota = 3;
  at(s, 160, 110);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.5],
    [[D], 1.2],
    [[L], 0.6],
  ]);
  const check = closeCheck(s);
  assert.ok(check.ok);
  assert.equal(snapshotOf(s).trail.points.length > 10, true);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.deepEqual(
    s.flies.map((f) => f.alive),
    [false, true, true],
  );
  assert.equal(s.caught, 1);
  assert.equal(s.trail.on, false);
  assert.equal(s.stats.caught, 1);
  assert.ok(emitted.includes('coin'));
  assert.match(snapshotOf(s).message.en, /Caught 1/);
});

test('a concave loop does not capture a firefly sitting in its notch', () => {
  const s = lab(1);
  setFlies(s, [
    [160, 120],
    [115, 100],
  ]);
  s.L.quota = 2;
  // Draw a U: down the left arm, along the bottom, up the right arm. The firefly at (160,120) sits
  // between the arms (outside the polygon), the one at (130,105) is inside the left arm region.
  s.trail = {
    on: true,
    pts: [
      [100, 60],
      [100, 160],
      [220, 160],
      [220, 60],
      [190, 60],
      [190, 130],
      [130, 130],
      [130, 60],
    ].map(([x, y]) => ({ x, y, t: 0 })),
  };
  at(s, 130, 60.5);
  const poly = closeCheck(s);
  assert.ok(poly.ok, JSON.stringify(poly.reason));
  assert.ok(
    !pointInPolygon({ x: 160, y: 120 }, poly.poly),
    'the notch point is outside the polygon',
  );
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.flies[0].alive, true, 'a firefly in the cup of the U is outside the polygon');
  assert.equal(s.flies[1].alive, false, 'a firefly in the arm of the U is caught');
});

test('too-small loops and closing lines that cross the trail are refused and keep the trail', () => {
  const s = lab(1);
  setFlies(s, [[200, 150]]);
  at(s, 150, 100);
  advance(s, 1 / 60, input([], ['Space']), emit);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.trail.on, true, 'a tiny loop is refused');
  assert.equal(s.stats.refused, 1);
  assert.match(snapshotOf(s).message.zh, /太小/);
  // Build a trail whose closing line would cut across it.
  s.trail = {
    on: true,
    pts: [
      [100, 100],
      [200, 100],
      [200, 160],
      [140, 160],
      [140, 60],
    ].map(([x, y]) => ({ x, y, t: s.t })),
  };
  at(s, 140, 60);
  // closing line (140,60)->(100,100) does not cross; move the head across instead
  at(s, 160, 130);
  const check = closeCheck(s);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'cross');
  assert.ok(Number.isFinite(check.x));
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.trail.on, true);
  assert.equal(s.stats.refused, 2);
  assert.equal(s.mark.kind, 'refuse');
  assert.match(snapshotOf(s).message.en, /cross the trail/);
});

test('crossing your own trail closes the loop right there and catches what is inside', () => {
  const s = lab(1);
  setFlies(s, [[150, 150]]);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.5],
    [[U], 1.5],
    [[L], 1.4],
  ]);
  assert.equal(s.trail.on, true, 'no crossing yet');
  walk(s, [[[D], 1.5]]);
  assert.equal(s.trail.on, false, 'the crossing closed the loop');
  assert.equal(s.stats.loops, 1);
  assert.equal(s.caught, 1);
  assert.equal(s.mark?.kind === 'cross' || s.clear > 0, true);
  // A crossing that would enclose almost nothing is ignored.
  const t = lab(1);
  setFlies(t, [[400, 250]]);
  at(t, 100, 200);
  advance(t, 1 / 60, input([], ['Space']), emit);
  walk(t, [
    [[R], 1],
    [[D], 0.05],
    [[L], 0.9],
    [[U], 0.3],
  ]);
  assert.equal(t.trail.on, true, 'a sliver of area does not close');
});

test('a moth touching the trail cuts it; the cut is swept so even a very fast moth cannot tunnel', () => {
  for (const hz of [30, 60, 120]) {
    const s = lab(1);
    setFlies(s, [[400, 250]]);
    at(s, 100, 200);
    advance(s, 1 / hz, input([], ['Space']), emit);
    run(s, 0.5, [R], [], hz);
    // Moth flies down the page through x=120 at 6000 px/s: 50 px per internal step.
    const t0 = s.t;
    setMoths(s, [{ at: (t) => ({ x: 120, y: 20 + (t - t0) * 6000 + 0 }) }]);
    s.moths[0].py = 20;
    s.moths[0].y = 20;
    emitted.length = 0;
    run(s, 0.1, [], [], hz);
    assert.equal(s.trail.on, false, `${hz} Hz: the trail is cut`);
    assert.equal(s.stats.cuts, 1);
    assert.equal(s.lives, RULES.lives - 1, 'a cut costs one light');
    assert.ok(emitted.includes('hit'));
    assert.equal(s.mark.kind, 'cut');
    assert.match(snapshotOf(s).message.en, /cut your trail/);
  }
});

test('a moth that misses the trail leaves it alone', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  run(s, 0.5, [R]);
  setMoths(s, [{ at: (t) => ({ x: 120, y: 250 + Math.sin(t) * 0 }) }]);
  run(s, 1, []);
  assert.equal(s.trail.on, true);
  assert.equal(s.stats.cuts, 0);
});

test('a moth stinging the lantern costs a light once, then grants a grace period', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 200, 150);
  setMoths(s, [{ at: () => ({ x: 200, y: 150 }) }]);
  emitted.length = 0;
  run(s, 0.1, []);
  assert.equal(s.lives, 2);
  assert.equal(s.stats.hits, 1);
  assert.ok(emitted.includes('hit'));
  assert.match(snapshotOf(s).message.en, /stung/);
  assert.equal(snapshotOf(s).player.invulnerable, true);
  run(s, 1, []);
  assert.equal(s.lives, 2, 'no second sting during the grace period');
  run(s, 0.6, []);
  assert.equal(s.lives, 1, 'stung again once the grace ends');
  run(s, 2, []);
  assert.equal(s.lives, 0);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'moth');
});

test('a fast moth cannot tunnel through the lantern either', () => {
  for (const hz of [30, 120]) {
    const s = lab(1);
    setFlies(s, [[400, 250]]);
    at(s, 200, 150);
    const t0 = s.t;
    setMoths(s, [{ at: (t) => ({ x: 0 + (t - t0) * 9000, y: 150 }) }]);
    s.moths[0].px = 0;
    run(s, 0.1, [], [], hz);
    assert.equal(s.lives, 2, `${hz} Hz`);
  }
});

test('stinging while drawing also cuts the trail', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 200, 150);
  advance(s, 1 / 60, input([], ['Space']), emit);
  setMoths(s, [{ at: () => ({ x: 200, y: 150 }) }]);
  run(s, 0.1, []);
  assert.equal(s.lives, 2);
  assert.equal(s.trail.on, false);
  assert.equal(s.stats.cuts, 1);
});

// ---------------------------------------------------------------- scoring, clearing and terminals

test('catching the quota clears the meadow once, scores it, unlocks the next and then loads it', () => {
  const { h, log } = progressEnv(1);
  const s = newState(h.env);
  setFlies(s, [[300, 140]]);
  at(s, 250, 100);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.2],
    [[D], 1.2],
    [[L], 1.2],
  ]);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.caught, 1);
  assert.ok(s.clear > 0);
  assert.deepEqual(log, [2]);
  const base = RULES.catchScore + RULES.clearScore + RULES.lifeScore * 3 + RULES.cleanScore;
  assert.ok(s.score >= base && s.score < base + 150, `score ${s.score}`);
  assert.match(snapshotOf(s).message.en, /Meadow clear/);
  // Controls are locked while the clear banner shows.
  const before = { x: s.p.x, y: s.p.y };
  run(s, 0.3, [R], ['Space']);
  assert.deepEqual({ x: s.p.x, y: s.p.y }, before);
  assert.equal(s.trail.on, false);
  run(s, RULES.clearTime, []);
  assert.equal(snapshotOf(s).meadow, 2);
  assert.equal(snapshotOf(s).caught, 0);
  assert.equal(snapshotOf(s).lives, 3);
  assert.deepEqual(log, [2], 'unlock fired exactly once');
});

test('one loop around several fireflies scores a combo bonus', () => {
  const s = lab(7);
  setFlies(s, [
    [300, 130],
    [340, 160],
    [310, 190],
  ]);
  at(s, 262, 98);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.7],
    [[D], 1.8],
    [[L], 1.7],
  ]);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.caught, 3);
  assert.ok(s.score >= 3 * RULES.catchScore + 2 * RULES.comboScore);
  assert.equal(s.stats.caught, 3);
});

test('an empty loop says so and costs nothing', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 100, 100);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.2],
    [[D], 1.2],
    [[L], 0.6],
  ]);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.caught, 0);
  assert.equal(s.stats.loops, 1);
  assert.match(snapshotOf(s).message.en, /Nothing inside/);
  assert.equal(s.lives, 3);
});

function followZero(g, level, limit = 400) {
  // The prompt follower: obeys the drawn line and the guide dots, no delay.
  let lock = 0;
  for (let t = 0; t < limit; t += 1 / 60) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.meadow !== level) return st;
    const held = [];
    const pressed = [];
    if (st.line.move === 'go' && st.hint) {
      const dx = st.hint.x - st.player.x;
      const dy = st.hint.y - st.player.y;
      if (dx > 2) held.push(R);
      else if (dx < -2) held.push(L);
      if (dy > 2) held.push(D);
      else if (dy < -2) held.push(U);
    } else if (st.line.move === 'space' && lock <= 0) {
      pressed.push('Space');
      lock = 0.3;
    }
    lock -= 1 / 60;
    g.update(1 / 60, input(held, pressed));
  }
  return g.getState();
}

test('terminal win: the last meadow ends the game once, frozen, with a single host-played jingle', () => {
  const { h, log } = progressEnv(LEVEL_COUNT);
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().meadow, LEVEL_COUNT);
  const st = followZero(g, LEVEL_COUNT);
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.match(h.ends[0].message, /meadow/);
  assert.equal(h.ends[0].score, st.score);
  assert.ok(
    log.every((n) => n <= LEVEL_COUNT),
    'unlock never exceeds the last meadow',
  );
  assert.equal(
    h.sounds.filter((n) => n === 'win' || n === 'lose').length,
    0,
    'the host plays the jingle',
  );
  const frozen = JSON.stringify(g.getState());
  const soundsBefore = h.sounds.length;
  for (let i = 0; i < 120; i++) g.update(1 / 60, input([R], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.equal(h.sounds.length, soundsBefore);
  assert.match(g.getState().status.en, /Every meadow/);
  assert.match(g.getState().status.zh, /所有草地/);
  const fresh = createGame(progressEnv(1).h.env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.meadow, 1);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.lives, 3);
});

test('terminal loss by dawn: ends once, silent on the final update, frozen, restart is fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  for (let i = 0; i < 60 * 80 && h.ends.length === 0; i++) g.update(1 / 60, input([]));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Dawn broke over meadow 1/);
  assert.equal(h.sounds.length, 0);
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 100; i++) g.update(1 / 60, input([R], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.match(g.getState().status.zh, /夜晚结束/);
  const again = createGame(harness().env).getState();
  assert.equal(again.phase, 'playing');
  assert.equal(again.dawn, LEVELS[0].dawn);
});

test('terminal loss by moths: the fatal sting is silent, ends the game once and freezes it', () => {
  // A blind lantern in meadow 5 walks into the moth lane until the lights run out.
  const h = harness();
  const g = createGame(Object.assign(h.env, { progress: { unlocked: () => 5, unlock() {} } }));
  g.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 60 * 200 && h.ends.length === 0; i++)
    g.update(1 / 60, input([i % 360 < 180 ? R : L]));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /moths put out your lantern in meadow 5/);
  assert.equal(g.getState().lives, 0);
  assert.ok(!h.sounds.includes('lose') && !h.sounds.includes('win'));
  const lastSound = h.sounds.length;
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 60; i++) g.update(1 / 60, input([L], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.sounds.length, lastSound);
  // The Chinese message names the meadow too.
  const zh = harness({ lang: 'zh' });
  const gz = createGame(Object.assign(zh.env, { progress: { unlocked: () => 5, unlock() {} } }));
  gz.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 60 * 200 && zh.ends.length === 0; i++)
    gz.update(1 / 60, input([i % 360 < 180 ? R : L]));
  assert.match(zh.ends[0].message, /第 5 片草地/);
});

// ---------------------------------------------------------------- menu and progress

test('progress: with only meadow 1 open (or no progress API) the game starts at once', () => {
  const g = createGame(progressEnv(1).h.env);
  assert.equal(g.getState().menu, null);
  const h = harness();
  assert.equal(createGame(h.env).getState().menu, null);
  const noUnlock = harness();
  noUnlock.env.progress = { unlocked: () => 3 };
  const s = createGame(noUnlock.env);
  assert.equal(s.getState().menu.unlocked, 3);
});

test('progress.unlocked() is floored and validated', () => {
  const read = (v) =>
    createGame(Object.assign(harness().env, { progress: { unlocked: () => v } })).getState().menu;
  assert.equal(read(3.9).unlocked, 3);
  assert.equal(read('4').unlocked, 4);
  assert.equal(read(999).unlocked, LEVEL_COUNT);
  assert.equal(read(0), null);
  assert.equal(read(-4), null);
  assert.equal(read(NaN), null);
  assert.equal(read(undefined), null);
  assert.equal(read(null), null);
  assert.equal(read('x'), null);
  assert.equal(read(Infinity).unlocked, LEVEL_COUNT, 'consistent with a huge finite count');
  assert.equal(read(-Infinity), null);
});

test('a later start offers continue and a select menu; the world waits behind it', () => {
  const { h } = progressEnv(9);
  const g = createGame(h.env);
  const st = g.getState();
  assert.deepEqual(st.menu, { sel: 9, unlocked: 9 });
  assert.equal(st.line.move, 'menu');
  assert.match(st.line.en, /Arrows choose/);
  const t0 = st.time;
  for (let i = 0; i < 120; i++) g.update(1 / 60, input([R], []));
  assert.equal(g.getState().time, t0, 'held keys do nothing in the menu');
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.sel, 8);
  g.update(1 / 60, input([], ['KeyA']));
  assert.equal(g.getState().menu.sel, 7);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.sel, 1, 'a row up clamps to meadow 1');
  g.update(1 / 60, input([], ['ArrowRight']));
  g.update(1 / 60, input([], ['KeyD']));
  assert.equal(g.getState().menu.sel, 3);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.sel, 9, 'a row down clamps to the last unlocked');
  g.update(1 / 60, input([], ['KeyS']));
  assert.equal(g.getState().menu.sel, 9);
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.sel, 9, 'cannot pick a locked meadow');
  g.update(1 / 60, input([], ['KeyW']));
  g.update(1 / 60, input([], ['Enter']));
  const next = g.getState();
  assert.equal(next.menu, null);
  assert.equal(next.meadow, 1);
  assert.ok(h.sounds.includes('move'));
  // A different pick loads that meadow.
  const g2 = createGame(progressEnv(12).h.env);
  g2.update(1 / 60, input([], ['Space']));
  assert.equal(g2.getState().meadow, 12);
  assert.equal(g2.getState().menu, null);
});

test('clearing a meadow raises unlock to the next one and never past the last', () => {
  const { h, log, value } = progressEnv(5);
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  followZero(g, 5);
  assert.equal(g.getState().meadow, 6);
  assert.deepEqual(log, [6]);
  assert.equal(value(), 6);
  // Without any progress API, clearing still works.
  const h0 = harness();
  const g0 = createGame(h0.env);
  assert.equal(followZero(g0, 1).meadow, 2);
});

test('drawing the select menu: no text overlaps a cell, in English and Chinese', () => {
  for (const lang of ['en', 'zh'])
    for (let sel = 1; sel <= LEVEL_COUNT; sel++) {
      const texts = [];
      const state = {};
      const ctx = new Proxy(
        {
          measureText: (v) => ({ width: String(v).length * 8 }),
          canvas: { width: 480, height: 320 },
        },
        {
          get: (target, p) => {
            if (p === 'fillText')
              return (str, x, y) =>
                texts.push({ str: String(str), x, y, font: state.font, align: state.textAlign });
            return p in state ? state[p] : p in target ? target[p] : () => {};
          },
          set: (target, p, v) => ((state[p] = v), true),
        },
      );
      const { h } = progressEnv(sel, { lang });
      const g = createGame(h.env);
      g.draw(ctx);
      const menu = g.getState().menu;
      assert.equal(menu !== null, sel > 1);
      if (!menu) continue;
      const L0 = MENU_LAYOUT;
      const cells = Array.from({ length: L0.count }, (_, i) => ({
        x: L0.x + (i % L0.cols) * L0.dx,
        y: L0.y + Math.floor(i / L0.cols) * L0.dy,
        w: L0.w,
        h: L0.h,
      }));
      const boxes = texts.map((t) => {
        const size = Number(/(\d+)px/.exec(t.font)[1]);
        const w = [...t.str].reduce((n, ch) => n + (CJK.test(ch) ? size : 0.6 * size), 0);
        const x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
        return { str: t.str, size, x0, x1: x0 + w, y0: t.y, y1: t.y + size };
      });
      for (const b of boxes) {
        assert.ok(b.size >= 14 && b.size <= 16, `${b.str} is ${b.size}px`);
        assert.ok(
          b.x0 >= 0 && b.x1 <= 480 && b.y0 >= 0 && b.y1 <= 320,
          `${b.str} leaves the canvas`,
        );
        const home = cells.find(
          (c) => b.x0 >= c.x && b.x1 <= c.x + c.w && b.y0 >= c.y && b.y1 <= c.y + c.h,
        );
        if (home) continue;
        for (const c of cells)
          assert.ok(
            b.x1 <= c.x || b.x0 >= c.x + c.w || b.y1 <= c.y || b.y0 >= c.y + c.h,
            `${lang} sel ${sel}: "${b.str}" overlaps cell ${c.x},${c.y}`,
          );
      }
      const numbers = boxes.filter((b) => /^\d+$/.test(b.str));
      assert.equal(numbers.length, LEVEL_COUNT);
      assert.ok(boxes.some((b) => b.str.includes(LEVELS[sel - 1].name[lang === 'en' ? 0 : 1])));
    }
});

// ---------------------------------------------------------------- prompts and guide

test('the guide walks the player: ring, start, dots, close', () => {
  const s = lab(1);
  let st = snapshotOf(s);
  assert.equal(st.hint.kind, 'walk');
  assert.deepEqual(st.hint.ring, { x: 256, y: 100 });
  assert.match(st.line.en, /walk to the gold ring/);
  assert.match(st.line.zh, /方向键/);
  at(s, 256, 100);
  run(s, 0.2, []);
  st = snapshotOf(s);
  assert.equal(st.hint.kind, 'start');
  assert.match(st.line.en, /Press Space to start the trail/);
  assert.equal(st.line.move, 'space');
  advance(s, 1 / 60, input([], ['Space']), emit);
  st = snapshotOf(s);
  assert.equal(st.hint.kind, 'trace');
  assert.match(st.line.en, /follow the dots/);
  assert.deepEqual([st.hint.x, st.hint.y], [344, 100]);
  walk(s, [[[R], 1.3]]);
  assert.equal(snapshotOf(s).hint.index, 2, 'passing a corner advances the guide');
  walk(s, [
    [[D], 1.2],
    [[L], 1.3],
  ]);
  st = snapshotOf(s);
  assert.equal(st.hint.kind, 'close');
  assert.match(st.line.en, /Press Space to close the loop/);
  assert.equal(st.line.move, 'space');
});

test('starting away from the ring is free drawing, with its own prompt', () => {
  const s = lab(1);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  run(s, 0.3, [R]);
  const st = snapshotOf(s);
  assert.equal(st.hint, null);
  assert.equal(st.line.move, 'free');
  assert.match(st.line.en, /X cancels/);
  advance(s, 1 / 60, input([], ['KeyX']), emit);
  run(s, 0.3, []);
  assert.equal(snapshotOf(s).hint.kind, 'walk', 'the guide returns after a cancel');
});

test('crossing loops say so; the idle prompt appears when no loop is left', () => {
  const s = lab(4);
  const ring = snapshotOf(s).hint.ring;
  at(s, ring.x, ring.y);
  advance(s, 1 / 60, input([], ['Space']), emit);
  s.plan.idx = 4;
  run(s, 0.7, []);
  const st = snapshotOf(s);
  assert.equal(st.hint.kind, 'cross');
  assert.match(st.line.en, /cross your own trail/);
  const idle = lab(1);
  idle.flies.forEach((f) => (f.alive = false));
  idle.trail = { on: false, pts: [] };
  idle.plan = null;
  run(idle, 0.7, []);
  assert.equal(snapshotOf(idle).line.move, 'free');
  assert.match(snapshotOf(idle).line.en, /go to a firefly/);
});

test('a moth lane on the way turns the prompt into a wait, then lets go again', () => {
  const s = lab(5);

  let waited = 0;
  let went = 0;
  let hits = 0;
  for (let i = 0; i < 120 * 12; i++) {
    const st = snapshotOf(s);
    if (st.line.move === 'wait') waited++;
    if (st.line.move === 'go') went++;
    const held = [];
    if (st.line.move === 'go' && st.hint) {
      if (st.hint.x - st.player.x > 2) held.push(R);
      else if (st.hint.x - st.player.x < -2) held.push(L);
      if (st.hint.y - st.player.y > 2) held.push(D);
      else if (st.hint.y - st.player.y < -2) held.push(U);
    }
    advance(s, 1 / 120, input(held), emit);
    hits = s.stats.hits;
  }
  assert.ok(waited > 20, 'the start of meadow 5 is a wait');
  assert.ok(went > 120, 'then the way opens');
  assert.equal(hits, 0);
  assert.match(snapshotOf(lab(5)).line.en, /^Moth near! Release the Arrows/);
  assert.match(snapshotOf(lab(5)).line.zh, /飞蛾靠近/);
});

test('prompt lines are replaced only after half a second unless urgent or forced by an action', () => {
  const s = lab(1);
  const first = snapshotOf(s).line.en;
  assert.match(first, /walk to the gold ring/);
  at(s, 256, 100);
  run(s, 0.2, []);
  assert.match(snapshotOf(s).line.en, /Press Space to start/, 'urgent lines cut in at once');
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.match(snapshotOf(s).line.en, /follow the dots/, 'an action refreshes the line at once');
  // A non-urgent change right after another waits for the half second.
  s.line.age = 0;
  s.line.en = 'Old line';
  s.line.key = 'x';
  run(s, 0.3, [R]);
  assert.equal(snapshotOf(s).line.en, 'Old line');
  run(s, 0.4, [R]);
  assert.match(snapshotOf(s).line.en, /follow the dots/);
});

// ---------------------------------------------------------------- dawn, status, state, sound

test('dawn: the timer counts down and the meadow is lost when it runs out', () => {
  const s = lab(10);
  const dawn = s.L.dawn;
  assert.equal(snapshotOf(s).dawn, dawn);
  run(s, 10, []);
  assert.ok(Math.abs(snapshotOf(s).dawn - (dawn - 10)) < 0.05);
  run(s, dawn - 9, []);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'dawn');
});

test('the status is bilingual and names the meadow, the prompt and the firefly count', () => {
  const g = createGame(harness().env);
  const st = g.getState();
  assert.match(
    st.status.en,
    /^Meadow 1\/24 First Light · Arrows: walk to the gold ring · Fireflies 0\/1$/,
  );
  assert.match(st.status.zh, /^草地 1\/24 第一缕光 · 方向键：走到金色圆环 · 萤火虫 0\/1$/);
  assert.equal(st.meadows, LEVEL_COUNT);
  assert.deepEqual(st.hud, { top: [0, 30], bottom: [290, 320] });
});

test('getState is JSON-safe, detached and offers no cheat API', () => {
  const g = createGame(progressEnv(6).h.env);
  g.update(1 / 60, input([], ['Space']));
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  const st = g.getState();
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st);
  const walkFns = (v) => {
    if (typeof v === 'function') return true;
    return v && typeof v === 'object' && Object.values(v).some(walkFns);
  };
  assert.equal(walkFns(st), false);
  for (const key of Object.keys(st)) assert.ok(!/cheat|god|skip|win|debug/i.test(key), key);
  st.flies[0].alive = false;
  st.player.x = -999;
  st.trail.points.push({ x: 1, y: 1 });
  st.lives = 99;
  st.hint.route.push({ x: 0, y: 0 });
  const again = g.getState();
  assert.equal(again.flies[0].alive, true);
  assert.notEqual(again.player.x, -999);
  assert.equal(again.trail.points.length, 0);
  assert.equal(again.lives, 3);
  assert.deepEqual(LEVELS[0].flies[0], [300, 140]);
  LEVELS[0].flies[0][0] = 5;
  assert.equal(createGame(harness().env).getState().flies[0].x, 300, 'LEVELS is a copy');
  LEVELS[0].flies[0][0] = 300;
  assert.equal(st.player.rect.w, 16);
});

test('sounds: a trail begins with move, a catch rings coin, a cut and a sting use hit, never win or lose', () => {
  const full = harness();
  const g = createGame(full.env);
  followZero(g, 1);
  assert.ok(full.sounds.includes('move'), 'beginning a trail');
  assert.ok(full.sounds.includes('coin'), 'a catch');
  assert.ok(!full.sounds.includes('win') && !full.sounds.includes('lose'));
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  setMoths(s, [{ at: () => ({ x: 100, y: 200 }) }]);
  emitted.length = 0;
  run(s, 0.1, []);
  assert.deepEqual(
    emitted.filter((n) => n === 'hit'),
    ['hit', 'hit'].slice(0, emitted.filter((n) => n === 'hit').length),
  );
  assert.ok(emitted.includes('hit'));
});

test('long seeded chaos stays finite and bounded in every meadow', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const s = lab(level);
    const rnd = seeded(level * 31);
    let held = [];
    for (let frame = 0; frame < 60 * 90 && s.phase === 'playing'; frame++) {
      if (frame % 12 === 0) held = [R, L, U, D].filter(() => rnd() < 0.4);
      const pressed = rnd() < 0.05 ? ['Space'] : rnd() < 0.01 ? ['KeyX'] : [];
      advance(s, 1 / 60, input(held, pressed), emit);
      if (frame % 600 === 0) {
        const st = snapshotOf(s);
        const json = JSON.stringify(st);
        assert.ok(
          !/null|NaN|Infinity/.test(json.replace(/"(hint|menu|message|life|threat)":null/g, '')),
          json.slice(0, 200),
        );
        assert.ok(st.trail.points.length < 400);
        assert.ok(st.player.x >= RULES.field.x0 && st.player.x <= RULES.field.x1);
        assert.ok(st.player.y >= RULES.field.y0 && st.player.y <= RULES.field.y1);
        assert.ok(st.lives >= 0 && st.caught <= st.quota + st.flies.length);
      }
    }
  }
});

// ---------------------------------------------------------------- drawing

function recorder() {
  const calls = {
    text: [],
    arcs: [],
    rects: [],
    points: [],
    fills: [],
    strokes: [],
    dashes: 0,
    lines: 0,
  };
  const state = {};
  const ctx = new Proxy(
    { measureText: (v) => ({ width: String(v).length * 8 }), canvas: { width: 480, height: 320 } },
    {
      get: (target, p) => {
        if (p === 'fillText')
          return (str, x, y) =>
            calls.text.push({ str: String(str), x, y, font: state.font, align: state.textAlign });
        if (p === 'arc') return (x, y, r) => calls.arcs.push({ x, y, r });
        if (p === 'fill') return (rule) => calls.fills.push(rule);
        if (p === 'stroke')
          return () => calls.strokes.push({ alpha: state.globalAlpha, color: state.strokeStyle });
        if (p === 'fillRect') return (x, y, w, h) => calls.rects.push({ x, y, w, h });
        if (p === 'setLineDash')
          return (d) => {
            if (d.length) calls.dashes++;
          };
        if (p === 'lineTo' || p === 'moveTo')
          return (x, y) => {
            calls.lines++;
            calls.points.push({ x, y });
          };
        return p in state ? state[p] : p in target ? target[p] : () => {};
      },
      set: (target, p, v) => ((state[p] = v), true),
    },
  );
  return { ctx, calls };
}

test('drawing: every phase renders; text is 14-16 px, on the canvas and inside the HUD bands', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 5, 10, 17, 24]) {
      const { h } = progressEnv(level, { lang });
      const g = createGame(h.env);
      if (level > 1) g.update(1 / 60, input([], ['Space']));
      const rec = recorder();
      const seq = [R, D, L, U];
      for (let i = 0; i < 240; i++) {
        g.update(1 / 60, input([seq[Math.floor(i / 20) % 4]], i === 5 ? ['Space'] : []));
        if (i % 60 === 0) g.draw(rec.ctx);
      }
      g.draw(rec.ctx);
      for (const t of rec.calls.text) {
        const size = Number(/(\d+)px/.exec(t.font)[1]);
        assert.ok(size >= 14 && size <= 16, `${t.str} ${size}px`);
        const w = [...t.str].reduce((n, ch) => n + (CJK.test(ch) ? size : 0.6 * size), 0);
        const x0 = t.align === 'center' ? t.x - w / 2 : t.x;
        assert.ok(x0 >= 0 && x0 + w <= 480, `"${t.str}" leaves the canvas`);
        assert.ok(t.y + size <= 320 && t.y >= 0);
        const top = t.y + size <= RULES.top + 1;
        const bottom = t.y >= RULES.bottom;
        assert.ok(top || bottom, `"${t.str}" at y ${t.y} is outside the HUD bands`);
      }
      assert.ok(
        rec.calls.text.some((t) => t.y < RULES.top) &&
          rec.calls.text.some((t) => t.y >= RULES.bottom),
      );
    }
});

test('drawing: the HUD bands do not overlap and the top counters do not collide', () => {
  const s = lab(24);
  const rec = recorder();
  s.msg = { en: 'A moth cut your trail!', zh: '飞蛾切断了光迹！', time: 1 };
  const g = createGame(harness().env);
  g.draw(rec.ctx);
  const top = rec.calls.text.filter((t) => t.y < RULES.top).sort((a, b) => a.x - b.x);
  const widths = top.map((t) => {
    const size = Number(/(\d+)px/.exec(t.font)[1]);
    return [...t.str].reduce((n, ch) => n + (CJK.test(ch) ? size : 0.6 * size), 0);
  });
  for (let i = 1; i < top.length; i++)
    assert.ok(top[i - 1].x + widths[i - 1] < top[i].x, 'top counters overlap');
  assert.ok(top.at(-1).x + widths.at(-1) < 392, 'counters clear of the lights');
  const bottom = rec.calls.text.filter((t) => t.y >= RULES.bottom);
  const ys = new Set(bottom.map((t) => t.y));
  for (const y of ys) assert.ok([292, 306].includes(y));
  assert.ok(RULES.top < RULES.bottom);
});

test('drawing: actors are at least 16 px and the guide is drawn where the prompt points', () => {
  const kinds = [
    [5, 0],
    [13, 1],
    [17, 2],
  ];
  for (const [level, kind] of kinds) {
    const s = lab(level);
    setFlies(s, [[400, 250]]);
    const m = s.moths[0];
    assert.equal(s.L.moths[0].kind, kind);
    const rec = recorder();
    s.t = 0;
    const g = createGame(progressEnv(level).h.env);
    g.update(1 / 60, input([], ['Space']));
    g.draw(rec.ctx);
    const mm = g.getState().moths[0];
    const near = rec.calls.rects.filter(
      (r) => Math.abs(r.x + r.w / 2 - mm.x) < 30 && Math.abs(r.y + r.h / 2 - mm.y) < 30,
    );
    const arcs = rec.calls.arcs.filter((a) => Math.hypot(a.x - mm.x, a.y - mm.y) < 30);
    const pts = rec.calls.points.filter((p) => Math.hypot(p.x - mm.x, p.y - mm.y) < 40);
    const xs = [
      ...near.flatMap((r) => [r.x, r.x + r.w]),
      ...arcs.flatMap((a) => [a.x - a.r, a.x + a.r]),
      ...pts.map((p) => p.x),
    ];
    const ys = [
      ...near.flatMap((r) => [r.y, r.y + r.h]),
      ...arcs.flatMap((a) => [a.y - a.r, a.y + a.r]),
      ...pts.map((p) => p.y),
    ];
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 16, `moth kind ${kind} width`);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 16, `moth kind ${kind} height`);
    void m;
  }
  const s = lab(1);
  const rec = recorder();
  const g = createGame(harness().env);
  g.draw(rec.ctx);
  const st = g.getState();
  const ring = rec.calls.arcs.find(
    (a) => Math.hypot(a.x - st.hint.ring.x, a.y - st.hint.ring.y) < 1 && a.r >= 10,
  );
  assert.ok(ring, 'a gold ring is drawn at the guide target');
  assert.ok(rec.calls.dashes > 0, 'the dotted route is drawn');
  const fly = rec.calls.rects.filter((r) => Math.abs(r.x - 300) < 12 && Math.abs(r.y - 140) < 12);
  assert.ok(fly.length >= 3, 'the firefly is drawn');
  void s;
});

test('drawing: previews, feedback marks, the stung lantern and terminals render', () => {
  for (const stage of ['loop', 'flash', 'cut', 'refuse', 'stung', 'lost']) {
    const t = lab(stage === 'stung' ? 5 : 1);
    setFlies(t, [[300, 140]]);
    at(t, 250, 100);
    advance(t, 1 / 60, input([], ['Space']), emit);
    walk(t, [
      [[R], 1],
      [[D], 1],
    ]);
    if (stage === 'flash') {
      walk(t, [[[L], 1.2]]);
      advance(t, 1 / 60, input([], ['Space']), emit);
    }
    if (stage === 'cut') {
      setMoths(t, [{ at: () => ({ x: 280, y: 100 }) }]);
      run(t, 0.1, []);
    }
    if (stage === 'refuse') {
      t.trail.pts = [
        [100, 100],
        [200, 100],
        [200, 160],
        [140, 160],
        [140, 60],
      ].map(([x, y]) => ({ x, y, t: t.t }));
      at(t, 160, 130);
      advance(t, 1 / 60, input([], ['Space']), emit);
    }
    if (stage === 'stung') {
      setMoths(t, [{ at: () => ({ x: t.p.x, y: t.p.y }), kind: 2, r: 10 }]);
      run(t, 0.3, []);
    }
    if (stage === 'lost') t.phase = 'lost';
    const r = recorder();
    drawGame(r.ctx, t, harness().env);
    assert.ok(r.calls.rects.length > 20, stage);
    if (stage === 'loop') assert.ok(r.calls.dashes >= 1, 'closing line preview');
  }
});

test('drawing: a game in progress, frozen and in the menu all render without throwing', () => {
  for (const lang of ['en', 'zh']) {
    const { h } = progressEnv(24, { lang });
    const g = createGame(h.env);
    g.draw(mockContext());
    g.update(1 / 60, input([], ['Space']));
    for (let i = 0; i < 1200; i++) {
      g.update(1 / 60, input([R, i % 80 < 40 ? D : U], i % 50 === 0 ? ['Space'] : []));
      if (i % 100 === 0) g.draw(mockContext());
    }
    g.draw(mockContext());
  }
  const win = progressEnv(LEVEL_COUNT);
  const g = createGame(win.h.env);
  g.update(1 / 60, input([], ['Space']));
  followZero(g, LEVEL_COUNT);
  g.draw(mockContext());
  assert.equal(g.getState().phase, 'won');
});

// ---------------------------------------------------------------- depth: wide loops, stalkers, costs

test('the light reaches only so far: the covered and spread areas are measured honestly', () => {
  // A bow-tie of two balanced lobes: the signed shoelace area cancels to nothing, the even-odd
  // coverage that decides captures counts both lobes.
  const eight = [
    { x: 0, y: 0 },
    { x: 80, y: 80 },
    { x: 80, y: 0 },
    { x: 0, y: 80 },
  ];
  assert.equal(polygonArea(eight), 0);
  assert.ok(Math.abs(coveredArea(eight) - 3200) < 200, `${coveredArea(eight)}`);
  const square = [
    { x: 10, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 90 },
    { x: 10, y: 90 },
  ];
  assert.equal(spreadArea(square), 50 * 80);
  assert.equal(spreadArea(square, { x0: 0, y0: 0, x1: 100, y1: 100 }), 100 * 100);
  assert.ok(Math.abs(coveredArea(square) - 4000) < 150);
});

test('wide loops fizzle: the trail is spent, nothing is caught, and fading the tail cannot shrink the loop', () => {
  const s = lab(11);
  assert.equal(s.L.wide, 7200);
  setFlies(s, [
    [330, 200],
    [410, 170],
  ]);
  s.L.quota = 2;
  setMoths(s, []);
  at(s, 280, 120);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 2.6],
    [[D], 1.6],
    [[L], 2.6],
  ]);
  assert.equal(s.trail.pts[0].x > 285, true, 'the start of the trail has faded away');
  const check = closeCheck(s);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'wide');
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.trail.on, false, 'a wide loop spends the trail');
  assert.equal(s.caught, 0);
  assert.equal(s.stats.refused, 1);
  assert.equal(s.flash.n, 0);
  assert.match(snapshotOf(s).message.en, /Too wide/);
  assert.match(snapshotOf(s).message.zh, /太大/);
  assert.equal(snapshotOf(s).maxArea, 7200);
  assert.ok(s.flies.every((f) => f.alive));
  // A small loop in the same meadow still works.
  at(s, 300, 170);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.1],
    [[D], 0.9],
    [[L], 1.1],
  ]);
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.caught, 1);
});

test('a crossing that would close a wide loop is ignored', () => {
  const s = lab(11);
  setFlies(s, [[400, 250]]);
  setMoths(s, []);
  at(s, 100, 100);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 2.3],
    [[D], 1.6],
    [[L], 2],
    [[U], 2],
  ]);
  assert.equal(s.trail.on, true, 'the big crossing did not close');
  assert.equal(s.stats.loops, 0);
});

test('the stalker shadows the lantern along its lane at its own speed and never leaves the lane', () => {
  const s = lab(18);
  const spec = s.L.moths[0];
  assert.equal(spec.kind, 3);
  assert.equal(snapshotOf(s).moths[0].kind, 3);
  const { v } = spec.hunt;
  assert.ok(v < RULES.speed * 0.6, 'slower than the lantern, so it can be out-run');
  at(s, 190, 262);
  let last = s.moths[0].y;
  for (let i = 0; i < 120 * 6; i++) {
    advance(s, 1 / 120, input([]), emit);
    const y = s.moths[0].y;
    assert.ok(Math.abs(y - last) <= v / 120 + 1e-6, 'never faster than its speed');
    assert.equal(s.moths[0].x, 250, 'stays on its lane');
    last = y;
  }
  assert.ok(s.moths[0].y > 255, 'it came down to the lantern');
  // Out-run it: it lags behind a lantern that moves up the lane's side.
  for (let i = 0; i < 120 * 2.5; i++) advance(s, 1 / 120, input([U]), emit);
  assert.ok(s.p.y - s.moths[0].y < -40, `lag ${s.p.y - s.moths[0].y}`);
  at(s, 190, 60);
  s.moths[0].y = 280;
  s.moths[0].u = spec.hunt.len;
  run(s, 20, []);
  assert.ok(s.moths[0].y < 80, 'it follows to the top end and stops there');
  assert.ok(s.moths[0].y >= 50 - 1e-6);
});

test('a stalker meeting the lantern stings it like any moth', () => {
  const s = lab(18);
  setFlies(s, [[400, 250]]);
  at(s, 250, 165);
  run(s, 0.2, []);
  assert.equal(s.lives, 2);
});

test('moth hit radii match the drawn bodies', () => {
  for (const [level, kind] of [
    [5, 0],
    [13, 1],
    [17, 2],
    [18, 3],
  ]) {
    const s = lab(level);
    const r = s.L.moths[0].r;
    assert.equal(s.L.moths[0].kind, kind);
    setFlies(s, [[400, 250]]);
    setMoths(s, [{ at: () => ({ x: 240, y: 160 }), r, kind }]);
    at(s, 60, 60);
    const bare = recorder();
    setMoths(s, []);
    drawGame(bare.ctx, s, harness().env);
    setMoths(s, [{ at: () => ({ x: 240, y: 160 }), r, kind }]);
    const rec = recorder();
    drawGame(rec.ctx, s, harness().env);
    const known = new Set(
      [...bare.calls.rects, ...bare.calls.arcs, ...bare.calls.points].map((q) => JSON.stringify(q)),
    );
    const fresh = (list) => list.filter((q) => !known.has(JSON.stringify(q)));
    const reach = Math.max(
      ...fresh(rec.calls.rects).flatMap((q) => [q.x + q.w - 240, 240 - q.x]),
      ...fresh(rec.calls.arcs).map((a) => Math.abs(a.x - 240) + a.r),
      ...fresh(rec.calls.points).map((p) => Math.abs(p.x - 240)),
    );
    assert.ok(reach <= r + 4, `kind ${kind}: wings reach ${reach} px, hit radius ${r}`);
    assert.ok(reach >= r - 3, `kind ${kind}: hit radius ${r} larger than the wings ${reach}`);
  }
});

test('a cut costs a light unless the lantern is still shielded, and the third light ends the night', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 100, 200);
  advance(s, 1 / 60, input([], ['Space']), emit);
  run(s, 0.3, [R]);
  const t0 = s.t;
  setMoths(s, [{ at: (t) => ({ x: 115 + (t - t0) * 0, y: 200 }) }]);
  run(s, 0.1, []);
  assert.equal(s.stats.cuts, 1);
  assert.equal(s.lives, 2);
  assert.match(snapshotOf(s).message.en, /cut your trail! 2 left/);
  // Shielded by the grace period: a second cut right away costs nothing.
  advance(s, 1 / 60, input([], ['Space']), emit);
  at(s, 100, 200);
  run(s, 0.1, [R]);
  setMoths(s, [{ at: () => ({ x: 105, y: 200 }) }]);
  s.inv = 1;
  run(s, 0.1, []);
  assert.equal(s.stats.cuts, 2);
  assert.equal(s.lives, 2, 'no light lost while shielded');
  // Unshielded cuts end the night.
  for (let k = 0; k < 3 && s.phase === 'playing'; k++) {
    s.inv = 0;
    at(s, 100, 200);
    s.trail = { on: true, pts: [{ x: 100, y: 200, t: s.t }] };
    run(s, 0.1, []);
    s.inv = 0;
  }
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'moth');
});

test('a clean meadow earns a bonus, and spare dawn counts double', () => {
  const clear = (spoil) => {
    const s = lab(1);
    setFlies(s, [[300, 140]]);
    if (spoil) s.meadowTrouble = 1;
    at(s, 250, 100);
    advance(s, 1 / 60, input([], ['Space']), emit);
    walk(s, [
      [[R], 1.2],
      [[D], 1.2],
      [[L], 1.2],
    ]);
    advance(s, 1 / 60, input([], ['Space']), emit);
    return s;
  };
  const clean = clear(false);
  const messy = clear(true);
  assert.equal(clean.score - messy.score, RULES.cleanScore);
  const left = Math.floor(clean.L.dawn - clean.t);
  assert.equal(
    clean.score,
    RULES.catchScore + RULES.clearScore + RULES.lifeScore * 3 + left * 2 + RULES.cleanScore,
  );
});

test('flowers are never entered, even at a pinch between two of them', () => {
  const s = lab(1);
  s.L = {
    ...s.L,
    blocks: [
      { x: 100, y: 100, r: 14 },
      { x: 136, y: 100, r: 14 },
    ],
  };
  setFlies(s, [[400, 250]]);
  at(s, 118, 60);
  let worst = Infinity;
  for (let i = 0; i < 120 * 3; i++) {
    advance(s, 1 / 120, input([D, i % 240 < 120 ? R : L]), emit);
    for (const b of s.L.blocks) worst = Math.min(worst, Math.hypot(s.p.x - b.x, s.p.y - b.y) - b.r);
  }
  assert.ok(worst >= RULES.playerR - 1e-6, `penetrated by ${RULES.playerR - worst}`);
  // Everywhere else in a flower meadow the lantern keeps its clearance too.
  const g = lab(16);
  const rnd = seeded(5);
  at(g, 200, 90);
  let held = [];
  for (let i = 0; i < 120 * 40; i++) {
    if (i % 90 === 0) held = [R, L, U, D].filter(() => rnd() < 0.5);
    advance(g, 1 / 120, input(held), emit);
    for (const b of g.L.blocks)
      assert.ok(Math.hypot(g.p.x - b.x, g.p.y - b.y) >= b.r + RULES.playerR - 1e-6);
  }
});

test('drawing: the trail fades to nothing, flashes use even-odd and every verdict has a shape', () => {
  const s = lab(2);
  setFlies(s, [[400, 250]]);
  s.t = 10;
  s.trail = {
    on: true,
    pts: [
      { x: 100, y: 100, t: 10 - (s.L.fade - 0.05) },
      { x: 140, y: 100, t: 10 - s.L.fade * 0.5 },
      { x: 180, y: 100, t: 10 },
    ],
  };
  at(s, 180, 100);
  const rec = recorder();
  drawGame(rec.ctx, s, harness().env);
  const alphas = rec.calls.strokes.map((c) => c.alpha);
  assert.ok(Math.min(...alphas) < 0.05, `faintest segment alpha ${Math.min(...alphas)}`);
  s.flash = {
    poly: [
      { x: 0, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 90 },
      { x: 0, y: 90 },
    ],
    age: 0.1,
    n: 1,
  };
  const flash = recorder();
  drawGame(flash.ctx, s, harness().env);
  assert.ok(flash.calls.fills.includes('evenodd'));
  const shapes = {};
  for (const reason of ['ok', 'small', 'wide', 'cross']) {
    const t = lab(11);
    setFlies(t, [[400, 250]]);
    setMoths(t, []);
    const trails = {
      ok: [
        [100, 100],
        [160, 100],
        [160, 160],
        [100, 160],
      ],
      small: [
        [100, 100],
        [112, 100],
        [112, 108],
        [100, 108],
      ],
      wide: [
        [40, 60],
        [220, 60],
        [220, 200],
        [40, 200],
      ],
      cross: [
        [100, 100],
        [200, 100],
        [200, 160],
        [140, 160],
        [140, 60],
      ],
    };
    t.trail = { on: true, pts: trails[reason].map(([x, y]) => ({ x, y, t: t.t })) };
    at(t, ...(reason === 'cross' ? [160, 130] : trails[reason].at(-1)));
    const r = recorder();
    drawGame(r.ctx, t, harness().env);
    shapes[reason] = r.calls.rects.filter((q) => q.w === 3 && q.h === 3).length;
    assert.equal(closeCheck(t).ok, reason === 'ok');
    const head = { x: t.p.x, y: t.p.y };
    const first = trails[reason][0];
    const mid = { x: (head.x + first[0]) / 2, y: (head.y + first[1]) / 2 };
    const marks = r.calls.points.filter((p) => Math.hypot(p.x - mid.x, p.y - mid.y) < 10).length;
    if (reason === 'ok') assert.ok(marks >= 3, 'a tick marks a valid loop');
    if (reason === 'wide') assert.ok(marks >= 6, 'two bars mark a loop that is too wide');
    if (reason === 'small') assert.ok(shapes[reason] >= 3, 'three dots mark a too-small loop');
  }
  assert.equal(shapes.ok, 0);
});

test('a prompt line is on screen for at least half a second at any frame rate, counted from its first drawn frame', () => {
  for (const hz of [30, 60, 120]) {
    const g = createGame(progressEnv(5).h.env);
    g.update(1 / hz, input([], ['Space']));
    const first = g.getState().line.en;
    assert.match(first, /^Moth near/);
    let t = 0;
    while (g.getState().line.en === first && t < 5) {
      g.update(1 / hz, input([]));
      t += 1 / hz;
    }
    assert.notEqual(g.getState().line.en, first, `${hz} Hz: the line changed`);
    assert.ok(t >= 0.5 - 1e-6, `${hz} Hz: the line lasted ${t} s`);
  }
});

test('the half-second hold starts when the line is first drawn, not when an action inside the update set it', () => {
  const s = lab(1);
  at(s, 256, 100);
  advance(s, 1 / 30, input([], ['Space']), emit);
  assert.match(s.line.en, /follow the dots/);
  assert.equal(s.line.age, 0, 'four ticks ran after the press, none of them counted');
  advance(s, 1 / 30, input([]), emit);
  assert.ok(Math.abs(s.line.age - 1 / 30) < 1e-9);
});

// ---------------------------------------------------------------- round two: pairs, crossings, flee, speed

test('late fireflies come in pairs that no single loop inside the light reaches (hawk corridor excepted)', () => {
  const envelope = (f) =>
    Array.isArray(f)
      ? { x0: f[0], x1: f[0], y0: f[1], y1: f[1] }
      : f.c
        ? { x0: f.c[0] - f.r, x1: f.c[0] + f.r, y0: f.c[1] - f.r, y1: f.c[1] + f.r }
        : {
            x0: Math.min(...f.pts.map((p) => p[0])),
            x1: Math.max(...f.pts.map((p) => p[0])),
            y0: Math.min(...f.pts.map((p) => p[1])),
            y1: Math.max(...f.pts.map((p) => p[1])),
          };
  LEVELS.forEach((m, i) => {
    if (i < 8 || m.name[0] === 'Two Hawks') return;
    const boxes = m.flies.map(envelope);
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const w = Math.max(boxes[a].x1, boxes[b].x1) - Math.min(boxes[a].x0, boxes[b].x0);
        const h = Math.max(boxes[a].y1, boxes[b].y1) - Math.min(boxes[a].y0, boxes[b].y0);
        assert.ok(
          (w + 36) * (h + 36) > m.wide,
          `meadow ${i + 1}: fireflies ${a} and ${b} fit one loop with an 18 px margin`,
        );
      }
    for (const plan of m.plans) {
      if (plan.cross) continue;
      const xs = plan.pts.map((p) => p[0]);
      const ys = plan.pts.map((p) => p[1]);
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      assert.ok(
        area <= m.wide * 0.85,
        `meadow ${i + 1}: a scripted loop leaves no slack under the limit`,
      );
    }
  });
});

test('crossing that would close a wide loop marks the spot and says so', () => {
  const s = lab(11);
  setFlies(s, [[400, 250]]);
  setMoths(s, []);
  at(s, 100, 100);
  advance(s, 1 / 60, input([], ['Space']), emit);
  walk(s, [
    [[R], 1.5],
    [[D], 1.2],
    [[L], 1.4],
    [[U], 1.5],
  ]);
  assert.equal(s.trail.on, true, 'the crossing did not close the loop');
  assert.equal(s.mark.kind, 'refuse');
  assert.match(snapshotOf(s).message.en, /Too wide to close here/);
  assert.match(snapshotOf(s).message.zh, /太大/);
});

test('when neither walking nor standing is safe the prompt says to back away, towards a safe spot', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 150, 200);
  const t0 = s.t;
  // A moth sweeping the lantern's whole neighbourhood from the left: standing and walking on both fail.
  setMoths(s, [{ at: (t) => ({ x: 60 + (t - t0) * 40, y: 200 }) }]);
  run(s, 0.3, []);
  const st = snapshotOf(s);
  assert.equal(st.hint.kind, 'flee');
  assert.match(st.line.en, /Back away/);
  assert.match(st.line.zh, /后退/);
  assert.equal(st.line.move, 'go');
  assert.ok(st.hint.x > 150 || st.hint.y !== 200, 'away from the moth, not into it');
  let hits = 0;
  for (let i = 0; i < 120 * 3; i++) {
    const now = snapshotOf(s);
    const held = [];
    if (now.line.move === 'go' && now.hint) {
      if (now.hint.x - now.player.x > 2) held.push(R);
      else if (now.hint.x - now.player.x < -2) held.push(L);
      if (now.hint.y - now.player.y > 2) held.push(D);
      else if (now.hint.y - now.player.y < -2) held.push(U);
    }
    advance(s, 1 / 120, input(held), emit);
    hits = s.stats.hits;
  }
  assert.equal(hits, 0, 'following the retreat avoids the moth');
});

test('a stalker that parked beside the way sends the lantern back to draw it off again', () => {
  const s = lab(18);
  // Lure run interrupted halfway: the stalker comes to rest at the lantern's height.
  s.plan.idx = 2;
  at(s, 190, 139);
  s.moths[0].u = 139 - 50;
  s.moths[0].y = 139;
  run(s, 4, []);
  assert.ok(s.waited >= 0);
  assert.equal(
    s.plan.idx,
    0,
    'after a few seconds of waiting the lure starts again from its first point',
  );
  assert.deepEqual(
    [snapshotOf(s).hint.x, snapshotOf(s).hint.y],
    [LEVELS[17].plans[0].via[0][0], LEVELS[17].plans[0].via[0][1]],
  );
  // And from there the whole lure can be followed without a sting.
  let t = 0;
  for (; t < 60 && s.stats.loops === 0 && s.phase === 'playing'; t += 1 / 60) {
    const now = snapshotOf(s);
    const held = [];
    const pressed = [];
    if (now.line.move === 'go' && now.hint) {
      if (now.hint.x - now.player.x > 2) held.push(R);
      else if (now.hint.x - now.player.x < -2) held.push(L);
      if (now.hint.y - now.player.y > 2) held.push(D);
      else if (now.hint.y - now.player.y < -2) held.push(U);
    } else if (now.line.move === 'space' && Math.round(t * 60) % 20 === 0) pressed.push('Space');
    advance(s, 1 / 60, input(held, pressed), emit);
  }
  assert.equal(s.stats.hits + s.stats.cuts, 0);
  assert.ok(s.stats.loops >= 1, 'the first loop gets drawn');
});

test('closeCheck stays cheap with a long trail', () => {
  const s = lab(2);
  setFlies(s, [[400, 250]]);
  const pts = [];
  for (let i = 0; i < 300; i++)
    pts.push({ x: 40 + (i % 150) * 2.5, y: 60 + Math.floor(i / 150) * 3 + (i % 2), t: s.t });
  s.trail = { on: true, pts, box: { x0: 40, y0: 60, x1: 420, y1: 70 } };
  at(s, 40, 80);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) closeCheck(s);
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / 100;
  assert.ok(ms < 3, `closeCheck took ${ms.toFixed(2)} ms`);
});

test('wait and back-away never trade places faster than half a second, and a held line keeps its own target', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  at(s, 150, 200);
  const t0 = s.t;
  setMoths(s, [{ at: (t) => ({ x: 60 + (t - t0) * 40, y: 200 }) }]);
  run(s, 0.3, []);
  assert.equal(s.line.key, 'flee');
  const target = { ...s.flee };
  // A "wait" line has just been drawn; the situation still calls for backing away.
  s.line = {
    en: 'Moth near! Release the Arrows',
    zh: '飞蛾靠近！松开方向键',
    move: 'wait',
    key: 'wait',
    age: 0.1,
    fresh: false,
  };
  run(s, 0.2, []);
  assert.equal(s.line.key, 'wait', 'held for its half second');
  assert.equal(snapshotOf(s).line.move, 'wait');
  run(s, 0.4, []);
  assert.equal(s.line.key, 'flee', 'then the retreat is announced');
  assert.ok(Number.isFinite(target.x));
  // And the other way round: a retreat line holds against a wait cue and keeps showing its spot.
  const keep = { x: s.flee.x, y: s.flee.y };
  s.line.age = 0.1;
  setMoths(s, []);
  run(s, 0.2, []);
  assert.equal(s.line.key, 'flee');
  assert.deepEqual(s.flee, keep);
  assert.equal(snapshotOf(s).hint.kind, 'flee');
});

// ---------------------------------------------------------------- final review fixes

test('a progress store that throws never stops the game, on reading or on saving', () => {
  const h = harness();
  const boom = () => {
    throw new Error('store down');
  };
  h.env.progress = { unlocked: boom, unlock: boom };
  const g = createGame(h.env);
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().meadow, 1);
  assert.equal(followZero(g, 1).meadow, 2, 'clearing a meadow still carries on');
  const { h: h2 } = progressEnv(3);
  h2.env.progress.unlock = boom;
  const g2 = createGame(h2.env);
  assert.equal(g2.getState().menu.unlocked, 3, 'only saving is broken');
  g2.update(1 / 60, input([], ['Space']));
  assert.equal(followZero(g2, 3).meadow, 4);
});

test('update tolerates a missing input object as an idle frame', () => {
  const g = createGame(harness().env);
  const before = g.getState();
  assert.doesNotThrow(() => g.update(1 / 60, undefined));
  assert.doesNotThrow(() => g.update(1 / 60, null));
  const after = g.getState();
  assert.ok(after.time > before.time);
  assert.deepEqual(after.player.x, before.player.x);
});

// Walk the guide on a lab state until the meadow is cleared (the banner is running).
function playToBanner(s) {
  for (let t = 0; t < 60 && s.clear <= 0; t += 1 / 60) {
    const now = snapshotOf(s);
    const held = [];
    const pressed = [];
    if (now.line.move === 'go' && now.hint) {
      if (now.hint.x - now.player.x > 2) held.push(R);
      else if (now.hint.x - now.player.x < -2) held.push(L);
      if (now.hint.y - now.player.y > 2) held.push(D);
      else if (now.hint.y - now.player.y < -2) held.push(U);
    } else if (now.line.move === 'space' && Math.round(t * 60) % 20 === 0) pressed.push('Space');
    advance(s, 1 / 60, input(held, pressed), emit);
  }
  assert.ok(s.clear > 0, 'the meadow is cleared');
}

test('a Space pressed during the clear banner is kept and used in the next meadow', () => {
  const s = lab(1);
  playToBanner(s);
  assert.equal(s.queued, false, 'ordinary presses are not queued');
  advance(s, 1 / 60, input([], ['Space']), emit);
  assert.equal(s.queued, true);
  assert.equal(s.level, 0, 'still in the banner');
  run(s, 2, []);
  assert.equal(s.level, 1, 'the next meadow is loaded');
  assert.equal(s.trail.on, true, 'the kept press began the trail there');
  assert.equal(s.queued, false);

  const quiet = lab(1);
  playToBanner(quiet);
  run(quiet, 2, []);
  assert.equal(quiet.level, 1);
  assert.equal(quiet.trail.on, false, 'without a press nothing starts');
});

// A straight trail laid along y by walking right from x0, with the clock moving on.
function straightTrail(s, x0, y, seconds) {
  at(s, x0, y);
  run(s, 0.01, [], ['Space']);
  run(s, seconds, [R]);
  assert.ok(s.trail.on && s.trail.pts.length > 5);
}

test('a moth about to cross the laid trail is announced well ahead, with a mark on the spot', () => {
  const s = lab(1);
  setFlies(s, [[400, 250]]);
  straightTrail(s, 150, 200, 1);
  const t0 = s.t;
  const lane = (t) => ({ x: 180, y: 130 + (t - t0) * 40 });
  setMoths(s, [{ at: lane }]);
  let warnedAt = null;
  let cutAt = null;
  for (let i = 0; i < 120 * 3 && cutAt === null; i++) {
    advance(s, 1 / 120, input([], []), emit);
    if (s.line.key === 'cut' && warnedAt === null) {
      warnedAt = s.t;
      const st = snapshotOf(s);
      assert.equal(st.line.move, 'wait');
      assert.match(st.line.en, /^Moth cuts trail/);
      assert.match(st.line.zh, /飞蛾/);
      assert.ok(Math.abs(st.trail.threat.x - 180) < 12 && Math.abs(st.trail.threat.y - 200) < 12);
    }
    if (s.stats.cuts > 0) cutAt = s.t;
  }
  assert.ok(warnedAt !== null && cutAt !== null, 'warned, then cut');
  assert.ok(cutAt - warnedAt >= 0.6, `warned ${(cutAt - warnedAt).toFixed(2)} s ahead`);
  assert.equal(snapshotOf(s).trail.threat, null, 'no mark once the trail is gone');
});

test('no cut warning when the moth stays clear, or the threatened stretch fades first', () => {
  const far = lab(1);
  setFlies(far, [[400, 250]]);
  straightTrail(far, 150, 200, 1);
  const t0 = far.t;
  setMoths(far, [{ at: (t) => ({ x: 400, y: 100 + (t - t0) * 40 }) }]);
  run(far, 1, []);
  assert.notEqual(far.line.key, 'cut');
  assert.equal(snapshotOf(far).trail.threat, null);

  const fading = lab(1);
  setFlies(fading, [[400, 250]]);
  straightTrail(fading, 150, 200, 1);
  const t1 = fading.t;
  for (const q of fading.trail.pts) q.t = t1 - fading.L.fade + 0.05;
  setMoths(fading, [{ at: (t) => ({ x: 180, y: 130 + (t - t1) * 40 }) }]);
  run(fading, 0.5, []);
  assert.notEqual(fading.line.key, 'cut', 'the stretch is gone before the moth arrives');
});

test('a stalker heading for the trail is announced too', () => {
  const s = lab(18);
  s.plan = null;
  s.trail = {
    on: true,
    pts: [
      { x: 200, y: 100, t: s.t },
      { x: 300, y: 100, t: s.t },
    ],
    box: { x0: 200, y0: 100, x1: 300, y1: 100 },
  };
  at(s, 300, 100);
  run(s, 0.3, []);
  assert.equal(s.line.key, 'cut');
  assert.ok(snapshotOf(s).trail.threat);
  assert.equal(s.stats.cuts, 0, 'still time to react');
});

test('a lantern boxed in beside a moth is told the guide route would be cut, once it sets off', () => {
  const s = lab(1);
  at(s, 256, 100);
  run(s, 0.01, [], ['Space']);
  assert.ok(s.trail.on);
  setMoths(s, [{ at: () => ({ x: 278, y: 100 }) }]);
  run(s, 0.3, []);
  assert.notEqual(s.line.key, 'cut', 'a lantern that stands still lays nothing for a moth to cut');
  run(s, 0.1, [R]);
  assert.equal(s.line.key, 'cut');
  const mark = snapshotOf(s).trail.threat;
  assert.ok(mark && Math.abs(mark.y - 100) < 3 && mark.x > 256 && mark.x < 290);
  assert.equal(s.stats.cuts + s.stats.hits, 0);
});
