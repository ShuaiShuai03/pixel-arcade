import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/games/stacksmith.js';
import { harness, input, mockContext, seeded } from './harness.js';

const { RULES, KINDS, LEVELS, createGame, meta } = S;
const STEP = RULES.step;
const KEYS = { left: 'ArrowLeft', right: 'ArrowRight' };

function begin(level = 1, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  h.progress = h.env.progress;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}
const frames = (g, n, held = [], pressed = [], dt = 1 / 60) => {
  for (let i = 0; i < n; i++) g.update(dt, input(held, i === 0 ? pressed : []));
};
const seconds = (g, t, held = []) => frames(g, Math.round(t * 60), held);

// A scripted player. It reads the plan from LEVELS and the state from getState(), never the prompt text.
function solve(level, { hz = 60, noise = 0, seed = 1, stopAfter = Infinity, maxT = 400 } = {}) {
  const { g, h } = begin(level, { seed });
  const rnd = seeded(seed * 97 + level);
  const plan = LEVELS[level - 1].plan;
  let step = 0;
  let aim = null;
  for (let t = 0; t < maxT; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    if (step >= stopAfter) break;
    let held = [];
    let pressed = [];
    if (st.hook && step < plan.length) {
      const [kind, x] = plan[step];
      if (aim === null) aim = x + (rnd() * 2 - 1) * noise;
      if (st.hook.kind !== kind) pressed = ['KeyX'];
      else {
        const d = aim - st.hook.x;
        if (Math.abs(d) > 2.5 && Math.abs(st.hook.vx) < 6) held = [d > 0 ? KEYS.right : KEYS.left];
        else if (Math.abs(d) <= 3.5 && Math.abs(st.hook.vx) < 4 && st.quiet) {
          pressed = ['Space'];
          held = ['Space'];
          step++;
          aim = null;
        }
      }
    }
    g.update(1 / hz, input(held, pressed));
  }
  return { g, h, st: g.getState(), step };
}

const cleared = (r, level) => r.st.level > level || r.st.phase === 'won';

// --- Module contract ---

test('meta is bilingual, lists every control and the touch buttons cover every action', () => {
  assert.equal(meta.id, 'stacksmith');
  for (const pair of [meta.name, meta.description, ...meta.keys.map((k) => k.label)]) {
    assert.ok(pair.en.trim() && pair.zh.trim());
    assert.notEqual(pair.en, pair.zh);
  }
  assert.ok(/[一-鿿]/.test(meta.name.zh));
  assert.equal(meta.genre, 'arcade');
  assert.equal(meta.players, '1');
  assert.equal(meta.touch, true);
  const codes = meta.touchControls.map((c) => c.code);
  assert.deepEqual(codes.sort(), ['ArrowLeft', 'ArrowRight', 'KeyX', 'Space']);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && c.label.zh);
    assert.ok(['left', 'right'].includes(c.side));
    assert.ok(!['KeyP', 'KeyR', 'Escape'].includes(c.code));
  }
  assert.match(meta.description.en, new RegExp(`${LEVELS.length} building jobs`));
  assert.match(meta.description.zh, new RegExp(`${LEVELS.length} 项搭建任务`));
});

test('createGame follows the contract: update, draw and getState; one end callback; copies out', () => {
  const { g, h } = begin(1);
  assert.equal(typeof g.update, 'function');
  assert.equal(typeof g.draw, 'function');
  const a = g.getState();
  assert.equal(a.phase, 'playing');
  assert.equal(a.level, 1);
  assert.equal(a.levels, LEVELS.length);
  assert.equal(h.ends.length, 0);
  a.bodies.push({ fake: true });
  a.crane.x = -999;
  a.goals[0].fill = 99;
  a.queue.length = 0;
  a.stats.drops = 77;
  a.status.en = 'tampered';
  const b = g.getState();
  assert.equal(b.bodies.length, 0);
  assert.notEqual(b.crane.x, -999);
  assert.notEqual(b.goals[0].fill, 99);
  assert.ok(b.queue.length > 0);
  assert.equal(b.stats.drops, 0);
  assert.notEqual(b.status.en, 'tampered');
});

test('the state is JSON-safe and finite throughout a played level', () => {
  const { g } = begin(6);
  const finite = (v, path = 'state') => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), path);
    else if (v && typeof v === 'object')
      for (const [k, c] of Object.entries(v)) finite(c, `${path}.${k}`);
  };
  const plan = LEVELS[5].plan;
  for (let i = 0; i < 1200; i++) {
    const st = g.getState();
    if (i % 40 === 0) {
      finite(st);
      assert.doesNotThrow(() => JSON.stringify(st));
    }
    const want = plan[Math.min(st.plan.step, plan.length - 1)][1];
    const held =
      st.hook && Math.abs(st.hook.x - want) > 3 ? [st.hook.x < want ? KEYS.right : KEYS.left] : [];
    g.update(1 / 60, input(held, []));
  }
});

// --- Levels ---

test('the level table is frozen', () => {
  assert.ok(
    Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS[0]) && Object.isFrozen(LEVELS[0].plan),
  );
  assert.throws(() => LEVELS[0].plan.push(['cube', 1]));
});

test('there are at least 20 distinct, well-formed levels with a real difficulty curve', () => {
  assert.ok(LEVELS.length >= 20);
  assert.equal(S.LEVEL_COUNT, LEVELS.length);
  const sigs = new Set();
  for (const [i, L] of LEVELS.entries()) {
    assert.ok(L.name[0] && L.name[1] && L.tip[0] && L.tip[1], `level ${i + 1} text`);
    assert.ok(/[一-鿿]/.test(L.name[1]) && /[一-鿿]/.test(L.tip[1]));
    assert.ok(L.tip[0].length < 90 && L.tip[1].length < 40, `level ${i + 1} tip fits the banner`);
    assert.ok(L.plan.length >= 3 && L.loads.length >= L.plan.length, `level ${i + 1} budget`);
    assert.ok(L.goals.length >= 3);
    for (const [kind, x] of L.plan) {
      assert.ok(KINDS[kind], kind);
      assert.ok(x > RULES.quayLeft + 40 && x < RULES.quayRight - 40);
    }
    for (const kind of L.loads) assert.ok(KINDS[kind]);
    assert.ok(L.lot[0] < L.lot[1]);
    sigs.add(JSON.stringify([L.plan, L.goals, L.piers, L.swaps, L.wind, L.sea]));
    assert.ok(L.name[0] === L.name[0].trim());
  }
  assert.equal(sigs.size, LEVELS.length, 'every level is a different job');
  assert.equal(new Set(LEVELS.map((L) => L.name[0])).size, LEVELS.length);
  assert.equal(new Set(LEVELS.map((L) => L.name[1])).size, LEVELS.length);
  const third = Math.floor(LEVELS.length / 3);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const early = mean(LEVELS.slice(0, third).map((L) => L.plan.length));
  const late = mean(LEVELS.slice(-third).map((L) => L.plan.length));
  assert.ok(late > early, `late jobs (${late}) need more loads than early ones (${early})`);
  assert.ok(LEVELS.filter((L) => L.wind).length >= 3, 'wind gusts');
  assert.ok(LEVELS.filter((L) => L.sea).length >= 2, 'swaying sea');
  assert.ok(LEVELS.filter((L) => L.swaps).length >= 2, 'limited swaps');
  assert.ok(LEVELS.filter((L) => L.piers).length >= 3, 'bridges between two towers');
  const kinds = new Set(LEVELS.flatMap((L) => L.loads));
  assert.equal(kinds.size, Object.keys(KINDS).length, 'every load type is used');
  assert.ok(LEVELS.every((L) => !L.wind || L.wind[2] > 0));
});

test('every level plan is physically stable: loads dropped at the plan spots come to rest flat and meet the goals', () => {
  for (const [i, def] of LEVELS.entries()) {
    const level = S.compileLevel(def);
    const world = S.buildWorld(level);
    const placed = [];
    for (const p of level.plan) {
      const k = KINDS[p.kind];
      const body = S.spawnLoad(
        world,
        p.kind,
        p.x,
        S.boomHeight(world) + RULES.rope + RULES.hang + k.h / 2,
      );
      placed.push(body);
      for (let t = 0; t < 10 && !world.bodies.every((b) => b.fixed || !b.awake); t += STEP)
        S.stepWorld(world, STEP);
    }
    placed.forEach((b, j) => {
      assert.ok(Math.abs(b.a) < 0.03, `level ${i + 1} step ${j} rests flat (${b.a})`);
      assert.ok(Math.abs(b.x - level.plan[j].x) < 4, `level ${i + 1} step ${j} stays on its spot`);
    });
    const fills = S.goalFill(world, level.goals);
    fills.forEach((f, j) => assert.ok(f >= level.goals[j].need, `level ${i + 1} goal ${j}: ${f}`));
  }
});

test('every level has a scripted legal solution through public input, at three frame rates', () => {
  for (let level = 1; level <= LEVELS.length; level++)
    for (const hz of [30, 60, 120]) {
      const r = solve(level, { hz, seed: level });
      assert.ok(cleared(r, level), `level ${level} @${hz} Hz: ${r.st.phase} step ${r.step}`);
      assert.equal(r.st.tries, level === LEVELS.length ? 3 : r.st.tries);
    }
});

function noisyClears(noise) {
  let runs = 0;
  let wins = 0;
  for (let level = 1; level <= LEVELS.length; level++)
    for (let seed = 1; seed <= 4; seed++) {
      const r = solve(level, { noise, seed: seed * 13 + level });
      runs++;
      if (cleared(r, level)) wins++;
    }
  return { runs, wins };
}

test('the plan windows are wide: every level still clears when each drop is 2 px off, and nearly every one at 4 px', () => {
  const near = noisyClears(2);
  assert.ok(near.wins / near.runs >= 0.98, `${near.wins}/${near.runs} clears at 2 px`);
  // the outline jobs judge the fit on a finer grid, so they are the ones that notice 4 px
  const far = noisyClears(4);
  assert.ok(far.wins / far.runs >= 0.9, `${far.wins}/${far.runs} clears at 4 px`);
});

test('no level is hopeless at the start and the budget always holds a spare or an exact fit', () => {
  for (const def of LEVELS) {
    const level = S.compileLevel(def);
    const area = def.loads.reduce(
      (sum, k) => sum + KINDS[k].w * KINDS[k].h * (k === 'gable' ? 0.5 : 1),
      0,
    );
    const need = level.goals.reduce((sum, g) => sum + g.need * g.w * g.h, 0);
    assert.ok(need <= area * RULES.hopeSlack, `${def.name[0]}: needs ${need}, has ${area}`);
  }
});

// --- Polygon bodies and contacts ---

test('rectangle and gable bodies get the right mass, centre of mass and inertia', () => {
  const box = S.makeBody(S.rectPoints(24, 12), { x: 10, y: 20, density: 2 });
  assert.ok(Math.abs(box.mass - 24 * 12 * 2) < 1e-9);
  assert.ok(Math.abs(box.inertia - (box.mass * (24 * 24 + 12 * 12)) / 12) < 1e-6);
  assert.equal(box.invM, 1 / box.mass);
  const roof = S.makeBody(S.gablePoints(48, 24), { x: 0, y: 0, density: 1 });
  assert.ok(Math.abs(roof.mass - 48 * 12) < 1e-9);
  const lowest = Math.max(...roof.wy);
  const apex = Math.min(...roof.wy);
  assert.ok(Math.abs(lowest - 8) < 1e-9, 'base is h/3 below the centroid');
  assert.ok(Math.abs(apex + 16) < 1e-9, 'apex is 2h/3 above the centroid');
  const fixed = S.makeBody(S.rectPoints(10, 10), { x: 0, y: 0, fixed: true });
  assert.equal(fixed.invM, 0);
  assert.equal(fixed.invI, 0);
  assert.equal(fixed.awake, false);
  assert.ok(S.motionOf(box) >= 0);
});

test('contact detection: separated, touching, overlapping, rotated and speculative pairs', () => {
  const a = S.makeBody(S.rectPoints(20, 20), { x: 0, y: 0 });
  const far = S.makeBody(S.rectPoints(20, 20), { x: 100, y: 0 });
  assert.equal(S.collide(a, far), null);
  const above = S.makeBody(S.rectPoints(20, 20), { x: 0, y: -19 });
  const m = S.collide(a, above);
  assert.ok(m, 'overlapping boxes collide');
  assert.ok(Math.abs(m.ny) > 0.99 && m.ny < 0, 'normal points from a up towards b');
  assert.equal(m.pts.length, 2);
  assert.ok(m.pts.every((p) => p.sep < 0 && p.sep > -2));
  const near = S.makeBody(S.rectPoints(20, 20), { x: 0, y: -22 });
  const spec = S.collide(a, near);
  assert.ok(spec && spec.pts.every((p) => p.sep > 0), 'a small gap yields speculative contacts');
  const tilted = S.makeBody(S.rectPoints(20, 20), { x: 0, y: -26 });
  tilted.a = Math.PI / 4;
  S.updateGeometry(tilted);
  const corner = S.collide(a, tilted);
  assert.ok(corner && corner.pts.length >= 1);
  const flipped = S.collide(above, a);
  assert.ok(flipped.ny > 0, 'order of the pair flips the normal');
  const tri = S.makeBody(S.gablePoints(30, 20), { x: 0, y: -19 });
  assert.ok(S.collide(a, tri), 'a gable resting on a box touches');
  const side = S.makeBody(S.rectPoints(20, 20), { x: 19, y: 0 });
  assert.ok(Math.abs(S.collide(a, side).nx) > 0.99);
});

// --- Rest, support geometry and tipping ---

const GROUND_TOP = RULES.quayTop;
function emptyWorld(piers = []) {
  return S.buildWorld({ piers });
}
function settleWorld(world, maxT = 12) {
  let t = 0;
  while (t < maxT && !world.bodies.every((b) => b.fixed || !b.awake)) {
    S.stepWorld(world, STEP);
    t += STEP;
  }
  return t;
}
const drop = (world, kind, x, high = 30) => {
  const k = KINDS[kind];
  const top = Math.min(...world.bodies.map((b) => b.minY));
  const b = S.spawnLoad(world, kind, x, top - high - k.h / 2);
  settleWorld(world);
  return b;
};

test('resting stacks stop completely: sleeping bodies keep exactly the same pose and nothing jitters', () => {
  const world = emptyWorld();
  const stack = [];
  for (let i = 0; i < 6; i++) stack.push(drop(world, 'cube', 240 + (i % 2 ? 2 : -2)));
  assert.ok(
    world.bodies.every((b) => b.fixed || !b.awake),
    'the stack falls asleep',
  );
  const before = stack.map((b) => [b.x, b.y, b.a]);
  for (let i = 0; i < 600; i++) S.stepWorld(world, STEP);
  assert.deepEqual(
    stack.map((b) => [b.x, b.y, b.a]),
    before,
  );
  stack.forEach((b, i) => {
    assert.equal(b.vx, 0);
    assert.equal(b.vy, 0);
    assert.ok(Math.abs(b.y - (GROUND_TOP - 12 - 24 * i)) < 1, `cube ${i} sits on the one below`);
  });
  // A resting-but-awake stack is quiet too: record the motion before it sleeps.
  const w2 = emptyWorld();
  const cubes = [];
  for (let i = 0; i < 4; i++) {
    const k = KINDS.cube;
    cubes.push(S.spawnLoad(w2, 'cube', 240, GROUND_TOP - 12 - 24 * i - 2 - k.h / 2));
  }
  let worst = 0;
  for (let i = 0; i < 360; i++) {
    S.stepWorld(w2, STEP);
    if (i > 240) worst = Math.max(worst, ...cubes.map((b) => S.motionOf(b)));
  }
  assert.ok(worst < 3, `awake stack jitters at ${worst} px/s`);
});

test('a block never sinks into or passes through the one below: overlaps stay under 1.5 px', () => {
  const world = emptyWorld();
  const loads = [];
  for (const [kind, x] of [
    ['slab', 240],
    ['weight', 236],
    ['plank', 250],
    ['brick', 270],
    ['cube', 230],
    ['gable', 240],
  ]) {
    const k = KINDS[kind];
    const top = Math.min(...world.bodies.map((b) => b.minY));
    loads.push(S.spawnLoad(world, kind, x, top - 60 - k.h / 2, 0, 160));
    for (let i = 0; i < 1500; i++) {
      S.stepWorld(world, STEP);
      for (let p = 0; p < world.bodies.length; p++)
        for (let q = p + 1; q < world.bodies.length; q++) {
          const m = S.collide(world.bodies[p], world.bodies[q]);
          if (m) for (const pt of m.pts) assert.ok(pt.sep > -1.5, `${kind}: penetration ${pt.sep}`);
        }
    }
  }
});

test('support geometry: a plank on a crate stays while its centre of mass is over the crate and tips over the edge beyond it', () => {
  const half = KINDS.cube.w / 2;
  const outcomes = [];
  for (const offset of [0, 4, 8, 10, 14, 18, 24, 36]) {
    for (const side of [1, -1]) {
      const world = emptyWorld();
      const crate = drop(world, 'cube', 240);
      const plank = drop(world, 'plank', 240 + side * offset, 20);
      const tipped = Math.abs(plank.a) > 0.1 || plank.y > crate.minY + 2;
      outcomes.push([offset, tipped]);
      if (offset <= half - 3) assert.ok(!tipped, `offset ${offset} should stand`);
      if (offset >= half + 3) assert.ok(tipped, `offset ${offset} should tip`);
      if (tipped)
        assert.ok(
          Math.sign(plank.x - 240) === side || plank.x === 240,
          'it tips towards the overhang',
        );
    }
  }
  assert.ok(outcomes.some(([, t]) => !t) && outcomes.some(([, t]) => t));
});

test('support geometry: the combined centre of mass of everything above must lie over the support below', () => {
  // slab (support) + plank + steel weight at the plank tip: predicted by statics, then compared with the engine.
  const slabHalf = KINDS.slab.w / 2;
  let agree = 0;
  let cases = 0;
  for (const tip of [236, 248, 258, 266, 274, 284, 296]) {
    const world = emptyWorld();
    const slab = drop(world, 'slab', 240);
    const plank = drop(world, 'plank', 256, 20);
    const settledPlank = plank.x;
    const w = drop(world, 'weight', tip, 20);
    const m = [plank.mass, w.mass];
    const comX = (settledPlank * m[0] + tip * m[1]) / (m[0] + m[1]);
    const predictedStable = comX < slab.x + slabHalf - 2;
    const stable =
      Math.abs(plank.a) < 0.05 && Math.abs(w.a) < 0.05 && Math.abs(plank.x - settledPlank) < 3;
    cases++;
    if (predictedStable === stable) agree++;
    if (comX < slab.x + slabHalf - 6)
      assert.ok(stable, `tip at ${tip}: COM ${comX} is inside the slab`);
    if (comX > slab.x + slabHalf + 6)
      assert.ok(!stable, `tip at ${tip}: COM ${comX} is outside the slab`);
  }
  assert.ok(agree >= cases - 1, `${agree}/${cases} cases agree with statics`);
});

test('a counterweight behind the pivot lets a heavy tip stand; the same tip without it tips the plank', () => {
  const run = (withWeight) => {
    const world = emptyWorld();
    drop(world, 'slab', 240);
    const plank = drop(world, 'plank', 262, 20);
    if (withWeight) drop(world, 'weight', 241, 20);
    const brick = drop(world, 'brick', 284, 20);
    return Math.abs(plank.a) < 0.05 && Math.abs(brick.a) < 0.05 && brick.y < GROUND_TOP - 20;
  };
  assert.equal(run(true), true);
  assert.equal(run(false), false);
});

test('heavy and light loads: a steel weight on a pier-bridging beam stays, shifted off the piers it falls', () => {
  const piers = [
    [168, 230, 36, 40],
    [276, 230, 36, 40],
  ];
  const stand = (beamX) => {
    const world = emptyWorld(piers);
    const beam = drop(world, 'beam', beamX, 30);
    const weight = drop(world, 'weight', 240, 20);
    return beam.y < 232 && Math.abs(beam.a) < 0.03 && weight.y < beam.y;
  };
  assert.equal(stand(240), true);
  assert.equal(stand(226), true);
  assert.equal(stand(160), false, 'a beam centred far off the piers misses one pier');
});

test('a tower of crates, each over the one below, stays; an unbalanced pile falls', () => {
  const tall = emptyWorld();
  for (let i = 0; i < 6; i++) drop(tall, 'cube', 240 + (i % 2 ? 3 : -3));
  assert.ok(tall.bodies.filter((b) => !b.fixed).every((b) => Math.abs(b.a) < 0.02));
  const lean = emptyWorld();
  const cubes = [0, 6, 12, 18, 24, 30].map((o) => drop(lean, 'cube', 240 + o));
  assert.ok(
    cubes.some((c) => Math.abs(c.a) > 0.2 || c.y > GROUND_TOP - 20),
    'a staircase of crates falls',
  );
});

test('fast thin planks do not tunnel through the quay or each other', () => {
  const world = emptyWorld();
  const lower = drop(world, 'plank', 240, 10);
  for (const speed of [200, 360, 480, 520]) {
    const b = S.spawnLoad(world, 'plank', 240, lower.y - 150, 0, speed);
    let lowest = -Infinity;
    for (let i = 0; i < 1500; i++) {
      S.stepWorld(world, STEP);
      lowest = Math.max(lowest, b.y);
    }
    assert.ok(lowest < lower.y, `speed ${speed}: the new plank stayed above the old one`);
    assert.ok(lowest < GROUND_TOP, 'and above the quay');
    S.removeBody(world, b);
  }
});

test('energy never rises: after a load is released the mechanical energy only falls (up to resting-contact noise)', () => {
  const world = emptyWorld();
  const pool = ['slab', 'weight', 'plank', 'brick', 'cube', 'gable', 'pillar', 'beam'];
  const noise = 0.6 * RULES.gravity * 2080; // a 0.6 px lift of the heaviest load
  for (const kind of pool) {
    const k = KINDS[kind];
    const x = 230 + (pool.indexOf(kind) % 3) * 12;
    const top = Math.min(...world.bodies.map((b) => b.minY));
    S.spawnLoad(world, kind, x, top - 40 - k.h / 2, 0, 90);
    const start = S.worldEnergy(world, GROUND_TOP);
    let prev = start;
    let peak = start;
    for (let i = 0; i < 2000; i++) {
      S.stepWorld(world, STEP);
      const e = S.worldEnergy(world, GROUND_TOP);
      assert.ok(e <= prev + noise, `${kind}: energy rose ${prev} -> ${e}`);
      assert.ok(
        e <= start * 1.0001 + noise,
        `${kind}: energy ${e} above the release energy ${start}`,
      );
      prev = e;
      peak = Math.max(peak, e);
    }
    assert.ok(prev < start, `${kind}: impact dissipates energy`);
  }
});

test('sleep: a settled world stops simulating, and a new load wakes it', () => {
  const world = emptyWorld();
  const a = drop(world, 'cube', 240);
  assert.equal(a.awake, false);
  assert.equal(S.stepWorld(world, STEP), 0);
  const t = world.time;
  S.stepWorld(world, STEP);
  assert.ok(world.time > t, 'time still advances');
  const b = S.spawnLoad(world, 'cube', 240, 150);
  assert.equal(a.awake, true, 'adding a body wakes the stack');
  settleWorld(world);
  assert.equal(b.awake, false);
  S.wakeAll(world);
  assert.equal(a.awake, true);
  S.removeBody(world, b);
  assert.ok(b.gone);
  assert.equal(world.bodies.includes(b), false);
  assert.ok(S.SLEEP_TIME > 0 && S.SLEEP_SPEED > 0);
});

test('goal helpers: samples cover the rectangle, point tests follow rotated bodies', () => {
  const pts = S.goalSamples({ x: 10, y: 20, w: 24, h: 12 });
  assert.equal(pts.length, 8);
  assert.ok(pts.every(([x, y]) => x > 10 && x < 34 && y > 20 && y < 32));
  assert.equal(S.goalSamples({ x: 0, y: 0, w: 2, h: 2 }).length, 1);
  const b = S.makeBody(S.rectPoints(20, 10), { x: 50, y: 50 });
  assert.ok(S.pointInBody(b, 50, 50));
  assert.ok(!S.pointInBody(b, 50, 58));
  b.a = Math.PI / 2;
  S.updateGeometry(b);
  assert.ok(S.pointInBody(b, 50, 58));
  assert.ok(!S.pointInBody(b, 58, 50));
  const level = S.compileLevel({ ...LEVELS[0] });
  const world = S.buildWorld(level);
  assert.deepEqual(
    S.goalFill(world, level.goals),
    level.goals.map(() => 0),
  );
  assert.equal(S.unmetCentre(level, [1, 1, 1]), null);
  assert.equal(S.unmetCentre(level, [0, 1, 1]), level.goals[0].x + level.goals[0].w / 2);
});

// --- The pendulum ---

function swingTrace(level, push = 0.6, secs = 24) {
  const { g } = begin(level);
  seconds(g, 1.6); // the first load is hooked on
  frames(g, Math.round(push * 60), [KEYS.right]);
  const trace = [];
  for (let i = 0; i < secs * 60; i++) {
    g.update(1 / 60, input([], []));
    const c = g.getState().crane;
    trace.push([c.hookX - c.x, c.theta]);
  }
  return trace;
}

test('the hook is a damped pendulum: its period follows the rope length and gravity, and the swing decays', () => {
  const trace = swingTrace(1).slice(120);
  const crossings = [];
  for (let i = 1; i < trace.length; i++)
    if (trace[i - 1][1] < 0 && trace[i][1] >= 0) crossings.push(i / 60);
  assert.ok(crossings.length >= 3, 'several full swings');
  const periods = crossings.slice(1).map((t, i) => t - crossings[i]);
  const omega0 = Math.sqrt(RULES.gravity / RULES.rope);
  const damped = Math.sqrt(omega0 * omega0 - (RULES.damping / 2) ** 2);
  const expected = (2 * Math.PI) / damped;
  for (const p of periods)
    assert.ok(Math.abs(p - expected) / expected < 0.03, `period ${p} vs ${expected}`);
  const peak = (a, b) => Math.max(...trace.slice(a, b).map(([x]) => Math.abs(x)));
  const first = peak(0, 190);
  const later = peak(380, 570);
  const ratio = later / first;
  const predicted = Math.exp((-RULES.damping / 2) * (380 / 60));
  assert.ok(
    ratio < 0.6 && Math.abs(ratio - predicted) / predicted < 0.35,
    `decay ${ratio} vs ${predicted}`,
  );
});

test('releasing a swinging load keeps its momentum: the fall starts with the hook velocity', () => {
  const { g } = begin(1);
  seconds(g, 1.6);
  frames(g, 60, [KEYS.right]);
  seconds(g, 0.3);
  const hook = g.getState().hook;
  assert.ok(Math.abs(hook.vx) > 8, 'it is really swinging');
  g.update(1 / 120, input([], ['Space']));
  const body = g.getState().bodies[0];
  assert.ok(Math.abs(body.vx - hook.vx) < 3, `${body.vx} vs ${hook.vx}`);
  assert.ok(body.vy > 0);
  let x0 = body.x;
  seconds(g, 0.3);
  assert.ok((g.getState().bodies[0].x - x0) * hook.vx > 0, 'it drifts the way it was swinging');
});

test('wind pushes the hook to a new equilibrium and a rocking sea moves the whole boom', () => {
  const windy = LEVELS.findIndex((L) => L.wind) + 1;
  const { g } = begin(windy);
  seconds(g, 40);
  const samples = [];
  for (let i = 0; i < 600; i++) {
    g.update(1 / 60, input([], []));
    const st = g.getState();
    samples.push([st.crane.hookX - st.crane.x, st.wind]);
  }
  const L = LEVELS[windy - 1];
  const mean = samples.reduce((a, b) => a + b[0], 0) / samples.length;
  const expected = RULES.rope * Math.sin(Math.atan(L.wind[0] / RULES.gravity));
  assert.ok(Math.abs(mean - expected) < 3, `mean offset ${mean} vs ${expected}`);
  assert.ok(
    samples.some(([, w]) => w > L.wind[0] + 1) && samples.some(([, w]) => w < L.wind[0] - 1),
  );
  const seaLevel = LEVELS.findIndex((x) => x.sea) + 1;
  const { g: g2 } = begin(seaLevel);
  const seas = [];
  for (let i = 0; i < 60 * 30; i++) {
    g2.update(1 / 60, input([], []));
    seas.push(g2.getState().sea);
  }
  const amp = LEVELS[seaLevel - 1].sea[0];
  assert.ok(Math.max(...seas) > amp * 0.95 && Math.min(...seas) < -amp * 0.95);
  assert.ok(
    Math.abs(S.seaSpeed(LEVELS[seaLevel - 1]) - (amp * 2 * Math.PI) / LEVELS[seaLevel - 1].sea[1]) <
      1e-9,
  );
  assert.equal(S.seaSpeed({ sea: null }), 0);
  assert.equal(S.windAccel({ wind: null }, 3), 0);
  assert.ok(Math.abs(S.seaAccel({ sea: [4, 6] }, 1.5) + 4 * ((2 * Math.PI) / 6) ** 2) < 1e-9);
});

// --- Input ---

test('arrow keys and A/D move the trolley, opposite keys cancel, and it stops at the rail ends', () => {
  const { g } = begin(1);
  const x0 = g.getState().crane.x;
  seconds(g, 1, [KEYS.right]);
  const x1 = g.getState().crane.x;
  assert.ok(x1 > x0 + 15);
  seconds(g, 1, ['KeyA']);
  assert.ok(g.getState().crane.x < x1);
  seconds(g, 1);
  const before = g.getState().crane.x;
  seconds(g, 1, [KEYS.left, KEYS.right]);
  assert.ok(Math.abs(g.getState().crane.x - before) < 0.5, 'both keys cancel');
  seconds(g, 12, ['KeyD']);
  assert.equal(g.getState().crane.x, RULES.trolleyMax);
  seconds(g, 20, [KEYS.left]);
  assert.equal(g.getState().crane.x, RULES.trolleyMin);
  assert.ok(Math.abs(g.getState().crane.v) <= RULES.trolleySpeed);
});

test('the trolley creeps near the drop mark so a late stop cannot overshoot it', () => {
  const { g } = begin(3);
  seconds(g, 1.6);
  const mark = g.getState().guide.x;
  const speeds = [];
  for (let i = 0; i < 60 * 8; i++) {
    const st = g.getState();
    g.update(1 / 60, input([st.crane.x < mark ? KEYS.right : KEYS.left], []));
    const d = Math.abs(mark - g.getState().crane.x);
    speeds.push([d, Math.abs(g.getState().crane.v)]);
  }
  const far = Math.max(...speeds.filter(([d]) => d > 60).map(([, v]) => v));
  const near = Math.max(...speeds.filter(([d]) => d < 5).map(([, v]) => v));
  assert.ok(far > 30, `cruise ${far}`);
  assert.ok(near < 15, `near the mark ${near}`);
});

test('Space releases once per press, from either a pressed edge or a rising held key, and never repeats while held', () => {
  const a = begin(1).g;
  seconds(a, 1.6);
  a.update(1 / 60, input([], ['Space']));
  assert.equal(a.getState().stats.drops, 1);
  const b = begin(1).g;
  seconds(b, 1.6);
  seconds(b, 4, ['Space']);
  assert.equal(b.getState().stats.drops, 1, 'holding Space drops one load only');
  seconds(b, 0.1, []);
  seconds(b, 0.1, ['Space']);
  assert.equal(b.getState().stats.drops, 2, 'a fresh press drops the next');
  const c = begin(1).g;
  c.update(1 / 60, input([], ['Space']));
  seconds(c, 0.5);
  assert.equal(c.getState().stats.drops, 0, 'nothing hangs while the load is being hooked on');
  assert.equal(c.getState().hook, null);
});

test('X swaps the hooked load for the next one while swaps remain, and only then', () => {
  const level = LEVELS.findIndex((L) => L.swaps === 1) + 1;
  const { g } = begin(level);
  seconds(g, 1.6);
  const st = g.getState();
  assert.equal(st.swapsLeft, 1);
  const hooked = st.hook.kind;
  const next = st.queue[0];
  g.update(1 / 60, input([], ['KeyX']));
  assert.equal(g.getState().swapsLeft, 0);
  assert.equal(g.getState().hook, null, 'the hook is busy while the new load comes');
  seconds(g, 1.3);
  const after = g.getState();
  assert.equal(after.hook.kind, next);
  assert.equal(after.queue[0], hooked, 'the old load goes back to the front of the queue');
  assert.equal(after.loadsLeft, st.loadsLeft);
  g.update(1 / 60, input(['KeyX'], ['KeyX']));
  seconds(g, 1.3);
  assert.equal(g.getState().hook.kind, next, 'no swaps left');
  const none = begin(1).g;
  seconds(none, 1.6);
  const k0 = none.getState().hook.kind;
  none.update(1 / 60, input([], ['KeyX']));
  assert.equal(none.getState().hook.kind, k0, 'jobs without swaps ignore X');
  assert.equal(none.getState().stats.swaps, 0);
});

test('zero, negative and non-finite steps do nothing and keep key presses; oversized steps are clamped to the maximum step', () => {
  const { g } = begin(1);
  seconds(g, 1.6);
  const frozen = JSON.stringify(g.getState());
  for (const dt of [0, -1 / 60, NaN, Infinity])
    g.update(dt, input(['ArrowRight', 'Space'], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().stats.drops, 1, 'the press was not consumed by the invalid frames');
  const big = begin(1).g;
  const ref = begin(1).g;
  seconds(big, 1.6);
  seconds(ref, 1.6);
  big.update(5, input(['ArrowRight'], []));
  ref.update(RULES.maxDt, input(['ArrowRight'], []));
  assert.deepEqual(big.getState(), ref.getState(), 'a huge dt advances exactly one maximum step');
  const tiny = begin(1).g;
  seconds(tiny, 1.6);
  tiny.update(STEP / 4, input([], ['Space']));
  tiny.update(STEP / 4, input([], []));
  assert.equal(tiny.getState().stats.drops, 0);
  tiny.update(STEP, input([], []));
  assert.equal(
    tiny.getState().stats.drops,
    1,
    'a sub-step frame keeps the press until a step runs',
  );
});

// --- Level select and progress ---

test('with unlocked levels a level select opens: arrows move, locked jobs are skipped, Space/Enter/tap start', () => {
  const h = harness();
  let unlocked = 5;
  const unlock = [];
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      unlock.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  let st = g.getState();
  assert.deepEqual(st.menu, { sel: 5, unlocked: 5 });
  assert.equal(st.line.en, 'Arrows pick a job, Space starts it');
  assert.ok(/[一-鿿]/.test(st.line.zh));
  g.update(1 / 60, input([], ['ArrowRight']));
  assert.equal(g.getState().menu.sel, 5, 'cannot pick a locked job');
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.sel, 4);
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.sel, 1);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.sel, 5);
  g.update(1 / 60, input([], ['KeyA']));
  g.update(1 / 60, input([], ['KeyW']));
  assert.equal(g.getState().menu.sel, 1);
  const cell = { x: 36 + 3, y: 78 + 3 };
  g.update(1 / 60, input([], [], { clicked: true, x: 36 + 68 * 2 + 3, y: 78 + 3 }));
  st = g.getState();
  assert.equal(st.menu, null);
  assert.equal(st.level, 3, 'tapping the third cell starts job 3');
  const g2 = createGame(h.env);
  g2.update(1 / 60, input([], [], { clicked: true, ...cell, x: 36 + 68 * 5, y: 78 + 3 }));
  assert.ok(g2.getState().menu, 'a locked cell is ignored');
  g2.update(1 / 60, input([], ['Enter']));
  assert.equal(g2.getState().level, 5, 'Enter starts the selected job');
  assert.equal(S.menuCellAt(10, 10, 5), 0);
  assert.equal(S.menuCellAt(36 + 68 * 6 + 1, 80, 22), 0);
  assert.equal(S.menuCellAt(40, 80, 22), 1);
  assert.equal(S.menuCellAt(40, 80 + 40 * 3, 22), 19);
  assert.equal(unlock.length, 0);
});

test('without saved progress the game starts at job 1 and a bad progress value is clamped', () => {
  const { g } = begin(1);
  assert.equal(g.getState().menu, null);
  for (const bad of [NaN, -3, 0, 99, 'x', undefined]) {
    const h = harness();
    h.env.progress = { unlocked: () => bad, unlock() {} };
    const st = createGame(h.env).getState();
    if (bad === 99) assert.equal(st.menu.sel, LEVELS.length);
    else assert.equal(st.menu, null);
    assert.equal(st.level, 1);
  }
  const plain = createGame(harness().env);
  assert.equal(plain.getState().level, 1);
});

// --- Winning, losing, restarting ---

test('clearing a job holds the tower for 3 s, banners the result, unlocks the next job and then starts it', () => {
  const { g, h } = begin(1);
  const plan = LEVELS[0].plan;
  let step = 0;
  let sawHold = 0;
  let maxHold = 0;
  let banner = false;
  for (let i = 0; i < 60 * 80; i++) {
    const st = g.getState();
    if (st.level !== 1) break;
    if (st.mode === 'cleared') banner = true;
    if (st.hold.time > 0) {
      sawHold++;
      maxHold = Math.max(maxHold, st.hold.time);
    }
    let held = [];
    let pressed = [];
    if (st.hook && step < plan.length) {
      const d = plan[step][1] - st.hook.x;
      if (Math.abs(d) > 2.5) held = [d > 0 ? KEYS.right : KEYS.left];
      else if (Math.abs(st.hook.vx) < 4 && st.quiet) {
        pressed = ['Space'];
        step++;
      }
    }
    g.update(1 / 60, input(held, pressed));
  }
  const st = g.getState();
  assert.equal(st.level, 2, 'the next job started');
  assert.ok(banner, 'the clear banner appeared');
  assert.ok(
    sawHold > 60 * 2.5 && maxHold <= RULES.holdTime + 0.05 && maxHold >= RULES.holdTime - 0.1,
  );
  assert.ok(h.progress.unlocked() >= 2);
  assert.equal(st.tries, RULES.tries, 'tries reset for the new job');
  assert.ok(st.score >= RULES.scoreLevel);
  assert.equal(h.ends.length, 0);
});

test('the hold timer restarts if the tower is disturbed before 3 seconds pass', () => {
  const { g } = begin(1);
  const plan = LEVELS[0].plan;
  let step = 0;
  let disturbed = false;
  let reset = false;
  let last = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const st = g.getState();
    if (st.level !== 1) break;
    if (disturbed && st.hold.time < last - 0.5) reset = true;
    last = st.hold.time;
    let held = [];
    let pressed = [];
    if (st.hook && step < plan.length) {
      const d = plan[step][1] - st.hook.x;
      if (Math.abs(d) > 2.5) held = [d > 0 ? KEYS.right : KEYS.left];
      else if (Math.abs(st.hook.vx) < 4 && st.quiet) {
        pressed = ['Space'];
        step++;
      }
    } else if (st.hook && st.hold.time > 1.2 && !disturbed) {
      pressed = ['Space']; // drop the spare crate on the finished tower
      disturbed = true;
    }
    g.update(1 / 60, input(held, pressed));
  }
  assert.ok(disturbed && reset, 'dropping another load resets the hold');
});

test('spending every load without meeting the goals fails the job, costs a try and restarts it fresh', () => {
  const { g } = begin(2);
  seconds(g, 1.6);
  const fresh = g.getState();
  let tries = fresh.tries;
  const seen = [];
  for (let i = 0; i < 60 * 120 && g.getState().tries === tries; i++) {
    const st = g.getState();
    const held = st.hook && st.hook.x > 60 ? [KEYS.left] : [];
    const pressed = st.hook && st.hook.x <= 60 ? ['Space'] : [];
    g.update(1 / 60, input(held, pressed));
    if (st.mode === 'failed') seen.push(st.line.en);
  }
  let st = g.getState();
  assert.equal(st.mode, 'failed');
  assert.equal(st.tries, tries - 1);
  seconds(g, 0.7);
  assert.equal(g.getState().line.en, 'Out of loads. Try again');
  assert.equal(g.getState().mode, 'failed');
  assert.ok(st.stats.lost >= 1, 'dropped loads fell into the sea');
  seconds(g, RULES.failPause + 0.5);
  st = g.getState();
  assert.equal(st.mode, 'play');
  assert.equal(st.level, 2);
  assert.equal(st.tries, tries - 1, 'the retry keeps the remaining tries');
  assert.equal(st.bodies.length, 0, 'a fresh yard');
  assert.equal(st.loadsLeft, fresh.loadsLeft, 'and a full budget');
});

test('running out of material before the budget ends fails at once and says so, without claiming a collapse', () => {
  const { g } = begin(5);
  const level = LEVELS[4];
  seconds(g, 1.6);
  // Send two loads into the sea: nothing fell down, the material is simply gone.
  let drops = 0;
  for (let i = 0; i < 60 * 80 && g.getState().mode === 'play'; i++) {
    const st = g.getState();
    let held = [];
    let pressed = [];
    if (st.hook && drops < 2) {
      if (st.hook.x > 60) held = [KEYS.left];
      else if (st.quiet && Math.abs(st.hook.vx) < 5) {
        pressed = ['Space'];
        drops++;
      }
    }
    g.update(1 / 60, input(held, pressed));
  }
  const st = g.getState();
  assert.equal(st.mode, 'failed');
  assert.ok(st.loadsLeft >= 1, 'a load was still left');
  assert.equal(st.tries, RULES.tries - 1);
  seconds(g, 0.1);
  assert.equal(g.getState().line.en, 'Not enough material left. Try again');
  assert.ok(/吊载不够了/.test(g.getState().line.zh));
  const ctx = recordingContext();
  g.draw(ctx);
  assert.ok(ctx.calls.text.includes('Not enough material left'));
  assert.ok(!ctx.calls.text.includes('The tower fell'));
  assert.equal(level.loads.length, 3);
});

test('a real collapse (coverage that was reached and then lost) is reported as a fall', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 11, unlock() {} };
  const s = S.newState(h.env);
  S.advance(s, 1 / 60, input([], ['Space']));
  assert.equal(s.level, 10);
  const frame = () => S.advance(s, 1 / 60, input([], []));
  for (let i = 0; i < 100; i++) frame();
  s.queue = [];
  s.next = null;
  s.hook = { kind: 'cube' };
  s.released = 2;
  s.peakFill = 4;
  s.sleepT = 2;
  frame();
  assert.equal(s.mode, 'failed');
  assert.equal(s.failWhy, 'collapse');
  assert.equal(S.snapshotOf(s).line.en, 'The tower fell. Try again');
});

test('three failed tries end the campaign with a loss, one end callback and a frozen state', () => {
  const { g, h } = begin(3);
  for (let i = 0; i < 60 * 600 && g.getState().phase === 'playing'; i++) {
    const st = g.getState();
    const held = st.hook && st.hook.x > 60 ? [KEYS.left] : [];
    const pressed = st.hook && st.hook.x <= 60 ? ['Space'] : [];
    g.update(1 / 60, input(held, pressed));
  }
  const st = g.getState();
  assert.equal(st.phase, 'lost');
  assert.equal(st.tries, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.ends[0].message.length > 5);
  assert.equal(h.ends[0].score, st.score);
  assert.equal(st.status.en, `Out of tries. Score ${st.score}`);
  assert.equal(st.line.en, 'Out of tries', 'no stale drop prompt on the end screen');
  assert.ok(/机会已用完/.test(st.line.zh));
  assert.equal(st.guide, null);
  assert.ok(/机会用完/.test(st.status.zh));
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(st);
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['Space', 'ArrowRight'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
});

test('finishing the last job wins the campaign: one end callback, a win sound, a frozen state', () => {
  const { g, h } = begin(LEVELS.length);
  const r = solve(LEVELS.length);
  assert.equal(r.st.phase, 'won');
  assert.equal(r.h.ends.length, 1);
  assert.equal(r.h.ends[0].won, true);
  assert.ok(r.h.sounds.includes('win'));
  assert.ok(r.h.ends[0].score > 0);
  assert.equal(r.st.status.en, `All jobs built! Score ${r.st.score}`);
  assert.equal(r.st.line.en, 'Every job is built');
  assert.equal(r.st.guide, null);
  assert.ok(/全部任务完成/.test(r.st.status.zh));
  const frozen = JSON.stringify(r.g.getState());
  for (let i = 0; i < 120; i++) r.g.update(1 / 60, input(['Space'], ['Space']));
  assert.equal(JSON.stringify(r.g.getState()), frozen);
  assert.equal(h.ends.length, 0);
  assert.equal(g.getState().phase, 'playing');
});

test('a restart is a fresh game: identical first state and no leftover bodies or score', () => {
  const run = () => {
    const h = harness({ seed: 5 });
    const g = createGame(h.env);
    return g;
  };
  const a = run();
  seconds(a, 10, [KEYS.right]);
  const b = run();
  assert.deepEqual(b.getState(), run().getState());
  assert.equal(b.getState().score, 0);
  assert.equal(b.getState().stats.drops, 0);
});

test('a load that falls into the sea or is left beside the lot is cleared away and counted', () => {
  const { g } = begin(1);
  seconds(g, 1.6);
  seconds(g, 10, [KEYS.left]);
  g.update(1 / 60, input([], ['Space']));
  seconds(g, 3);
  let st = g.getState();
  assert.equal(st.bodies.length, 0, 'the load sank');
  assert.equal(st.stats.lost, 1);
  assert.equal(st.message.en, 'A load fell into the sea');
  assert.ok(/海里/.test(st.message.zh));
  seconds(g, 1.2);
  seconds(g, 3, [KEYS.right]);
  // beside the lot but still on the quay: swept once everything is quiet
  const lot = LEVELS[0].lot;
  const { g: g2 } = begin(1);
  seconds(g2, 1.6);
  for (let i = 0; i < 900 && g2.getState().crane.x > lot[0] - 30; i++)
    g2.update(1 / 60, input([KEYS.left], []));
  seconds(g2, 8);
  assert.ok(g2.getState().hook.x > RULES.quayLeft + 10);
  g2.update(1 / 60, input([], ['Space']));
  seconds(g2, 5);
  st = g2.getState();
  assert.equal(st.bodies.length, 0, 'swept off the quay');
  assert.ok(st.stats.lost >= 1);
});

// --- Prompt and guide basics ---

test('the prompt names the next action with a direction, and the guide matches it', () => {
  const { g } = begin(3);
  const seen = new Set();
  for (let i = 0; i < 60 * 20; i++) {
    const st = g.getState();
    seen.add(st.prompt.id);
    if (/^Move/.test(st.line.en)) {
      assert.ok(st.line.en.includes(st.guide.dir > 0 ? '→' : '←'));
      assert.ok(st.line.zh.includes(st.guide.dir > 0 ? '右' : '左'));
    }
    assert.equal(st.status.en.endsWith(st.line.en), true);
    assert.equal(st.status.zh.endsWith(st.line.zh), true);
    const keys = /^Move →/.test(st.line.en)
      ? [KEYS.right]
      : /^Move ←/.test(st.line.en)
        ? [KEYS.left]
        : [];
    g.update(1 / 60, input(keys, /Press Space/.test(st.line.en) ? ['Space'] : []));
  }
  for (const id of ['reel', 'move+', 'steady', 'drop']) assert.ok(seen.has(id), id);
});

test('when the plan is lost the prompt aims at the empty part of the silhouette instead', () => {
  const { g } = begin(2);
  seconds(g, 1.6);
  // drop the slab far from its mark
  let guard = 0;
  while (g.getState().hook.x < 330 && guard++ < 600) g.update(1 / 60, input([KEYS.right], []));
  seconds(g, 4);
  g.update(1 / 60, input([], ['Space']));
  seconds(g, 5);
  const st = g.getState();
  assert.equal(st.plan.off, true);
  assert.ok(st.message === null || /plan|计划/.test(st.message.en + st.message.zh));
  const level = S.compileLevel(LEVELS[1]);
  const fills = st.goals.map((x) => x.fill);
  const gap = S.unmetCentre(level, fills);
  assert.ok(gap !== null);
  assert.ok(
    Math.abs(st.guide.x - Math.max(RULES.trolleyMin, Math.min(RULES.trolleyMax, gap))) < 1e-6,
  );
});

test('a plan that expects a different load makes the prompt fall back to the gap, not lock up', () => {
  const level = LEVELS.findIndex((L) => L.swaps === 2) + 1;
  const { g } = begin(level);
  seconds(g, 1.6);
  const st0 = g.getState();
  // swap away from the plan on purpose: use up both swaps, then the hook no longer matches the plan
  g.update(1 / 60, input([], ['KeyX']));
  seconds(g, 1.3);
  g.update(1 / 60, input([], ['KeyX']));
  seconds(g, 1.3);
  seconds(g, 1);
  const st = g.getState();
  assert.ok(st.swapsLeft === 0 && st0.swapsLeft === 2);
  assert.ok(st.guide === null || Number.isFinite(st.guide.x));
  assert.ok(typeof st.line.en === 'string' && st.line.en.length > 0);
});

// --- Rendering ---

function recordingContext() {
  const calls = { text: [], textAlpha: [], fills: 0, strokes: 0, paths: 0, shaded: [] };
  const ctx = mockContext();
  return new Proxy(ctx, {
    get: (t, p) => {
      if (p === 'fillText')
        return (s) => {
          calls.text.push(String(s));
          calls.textAlpha.push([String(s), t.globalAlpha]);
        };
      if (p === 'fillRect')
        return () => {
          calls.fills++;
          calls.shaded.push([t.fillStyle, t.globalAlpha]);
        };
      if (p === 'stroke') return () => calls.strokes++;
      if (p === 'beginPath') return () => calls.paths++;
      if (p === 'calls') return calls;
      return t[p];
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
}

test('every screen draws in both languages: menu, play, banners, hold bar, wind, sea and the end states', () => {
  for (const lang of ['en', 'zh']) {
    const shots = [];
    const snap = (g, label) => {
      const ctx = recordingContext();
      g.draw(ctx);
      shots.push([label, ctx.calls]);
      return ctx.calls;
    };
    const h = harness({ lang });
    h.env.progress = { unlocked: () => 9, unlock() {} };
    const menu = createGame(h.env);
    const m = snap(menu, 'menu');
    assert.ok(m.text.includes(lang === 'en' ? 'Choose a job' : '选择任务'));
    assert.ok(m.text.includes('9') && m.text.includes('?'));
    for (const level of [1, 4, 5, 7, 10, 14, 15, 22]) {
      const { g } = begin(level, { lang });
      seconds(g, 2);
      const intro = snap(g, `intro ${level}`);
      assert.ok(intro.text.includes(LEVELS[level - 1].name[lang === 'en' ? 0 : 1]));
      const r = solve(level, { stopAfter: Math.max(1, LEVELS[level - 1].plan.length - 1) });
      const mid = recordingContext();
      r.g.draw(mid);
      assert.ok(mid.calls.fills > 100);
      assert.ok(
        mid.calls.text.some((s) => s.includes('/')),
        'HUD shows progress',
      );
    }
    // banners
    const { g } = begin(1, { lang });
    const plan = LEVELS[0].plan;
    let step = 0;
    let holdShot = false;
    let clearShot = null;
    for (let i = 0; i < 60 * 60 && !clearShot; i++) {
      const st = g.getState();
      let held = [];
      let pressed = [];
      if (st.hook && step < plan.length) {
        const d = plan[step][1] - st.hook.x;
        if (Math.abs(d) > 2.5 && Math.abs(st.hook.vx) < 6) held = [d > 0 ? KEYS.right : KEYS.left];
        else if (Math.abs(d) <= 3.5 && Math.abs(st.hook.vx) < 4 && st.quiet) {
          pressed = ['Space'];
          step++;
        }
      }
      g.update(1 / 60, input(held, pressed));
      if (g.getState().hold.time > 1 && !holdShot) {
        holdShot = true;
        snap(g, 'hold');
      }
      if (g.getState().mode === 'cleared') clearShot = snap(g, 'cleared');
    }
    assert.ok(holdShot);
    assert.ok(
      clearShot.text.includes(lang === 'en' ? 'Job complete!' : '任务完成！'),
      lang + JSON.stringify(clearShot.text),
    );
    // a failed job
    const f = begin(2, { lang }).g;
    seconds(f, 1.6);
    for (let i = 0; i < 60 * 120 && f.getState().mode !== 'failed'; i++) {
      const st = f.getState();
      f.update(
        1 / 60,
        input(
          st.hook && st.hook.x > 60 ? [KEYS.left] : [],
          st.hook && st.hook.x <= 60 ? ['Space'] : [],
        ),
      );
    }
    const failed = snap(f, 'failed');
    assert.ok(
      failed.text.includes(lang === 'en' ? 'Not enough material left' : '吊载不够了') ||
        failed.text.includes(lang === 'en' ? 'Out of loads' : '吊载用完了'),
    );
    assert.ok(!failed.text.includes(lang === 'en' ? 'Job complete!' : '任务完成！'));
    assert.ok(failed.text.some((s) => /^(Tries left|剩余机会)/.test(s)));
    const lost = begin(3, { lang }).g;
    for (let i = 0; i < 60 * 600 && lost.getState().phase === 'playing'; i++) {
      const st = lost.getState();
      lost.update(
        1 / 60,
        input(
          st.hook && st.hook.x > 60 ? [KEYS.left] : [],
          st.hook && st.hook.x <= 60 ? ['Space'] : [],
        ),
      );
    }
    snap(lost, 'lost');
    const won = solve(S.LEVEL_COUNT, {}).g;
    snap(won, 'won');
    assert.ok(shots.length >= 12);
  }
});

test('tipped and flying loads are drawn rotated in every material, and the queue and swap counters stay non-negative', () => {
  for (const level of [6, 7, 11, 17]) {
    const { g } = begin(level);
    for (let i = 0; i < 60 * 30; i++) {
      const st = g.getState();
      const held =
        st.hook && Math.abs(st.hook.x - 400) > 3 ? [st.hook.x < 400 ? KEYS.right : KEYS.left] : [];
      g.update(1 / 60, input(held, i % 150 === 149 ? ['Space', 'KeyX'] : []));
      if (i % 30 === 0) {
        const ctx = recordingContext();
        g.draw(ctx);
        for (const s of ctx.calls.text)
          assert.ok(!/-\d/.test(s.replace(/\d+\/\d+/, '')), `negative counter in "${s}"`);
      }
    }
  }
});

test('draw is safe on every kind of load and on the sea, wind and menu helpers', () => {
  const ctx = recordingContext();
  for (const kind of Object.keys(KINDS)) {
    const { g } = begin(1);
    void kind;
    g.draw(ctx);
  }
  assert.ok(ctx.calls.fills > 0);
  assert.equal(typeof S.MENU_ROWS, 'number');
});

test('sounds are only the allowed names', () => {
  const allowed = new Set(['coin', 'hit', 'shoot', 'win', 'lose', 'move']);
  const r = solve(1);
  for (const s of r.h.sounds) assert.ok(allowed.has(s), s);
  assert.ok(r.h.sounds.includes('move'));
  assert.ok(r.h.sounds.includes('hit'));
  assert.ok(r.h.sounds.includes('coin'));
});

test('state advance and snapshot are usable without a host: newState, advance, snapshotOf', () => {
  const s = S.newState({});
  assert.equal(S.advance(s, 1 / 60, input([], [])), true);
  assert.equal(S.advance(s, NaN, input([], [])), false);
  const snap = S.snapshotOf(s);
  assert.equal(snap.level, 1);
  assert.equal(snap.hook, null);
  assert.equal(S.hookOf(s).y > 0, true);
  assert.equal(S.kindMass('cube'), 576);
  assert.equal(S.kindMass('gable'), 672);
  const w = emptyWorld();
  const hook = { x: 240, y: 100, vx: 0, vy: 0 };
  const land = S.predictLanding(w, hook, 'cube');
  assert.ok(Math.abs(land.y - (GROUND_TOP - 12)) < 0.5 && land.t > 0.3);
  assert.equal(S.predictLanding(w, { x: 240, y: -4000, vx: 0, vy: 0 }, 'cube').t, 4);
});

const WOOD = '#c8955a';
const STONE = '#9aa3ad';

test('unbuilt goal pictures and the marker ghost are drawn translucent, never as solid blocks', () => {
  // Level 2: a slab and two crates are still to be built; nothing is placed yet.
  const { g } = begin(2);
  seconds(g, 0.5);
  const start = recordingContext();
  g.draw(start);
  assert.ok(
    start.calls.shaded.some(([c, a]) => c === STONE && a === 0.22),
    'the slab picture in the silhouette is faint',
  );
  assert.ok(
    start.calls.shaded.some(([c, a]) => c === WOOD && a === 0.22),
    'so are the crates',
  );
  // While a load hangs and the prompt names a mark, its ghost at the mark is faint too.
  seconds(g, 1.5);
  const hooked = g.getState();
  assert.ok(hooked.hook && hooked.guide);
  const ctx = recordingContext();
  g.draw(ctx);
  assert.ok(
    ctx.calls.shaded.some(([, a]) => a === 0.35),
    'the ghost is drawn at 35% alpha',
  );
  // Every block fill is either faint (goal picture or ghost), the hung load, a queue icon, or a placed block;
  // a faint draw must never be followed by an opaque one inside the same load.
  for (const [, a] of ctx.calls.shaded)
    if (typeof a === 'number') assert.ok(a >= 0 && a <= 1, String(a));
});

test('only upright loads fill the silhouette: a tilted or toppled load fills nothing', () => {
  const level = S.compileLevel(LEVELS[0]);
  const world = S.buildWorld(level);
  const goal = level.goals[0];
  const b = S.spawnLoad(world, 'cube', goal.x + goal.w / 2, goal.y + goal.h / 2);
  b.vx = b.vy = 0;
  assert.ok(S.goalFill(world, level.goals)[0] >= goal.need, 'upright it counts');
  b.a = 0.3;
  S.updateGeometry(b);
  assert.equal(S.goalFill(world, level.goals)[0], 0, 'tilted it does not');
  b.a = 2 * Math.PI + 0.02;
  S.updateGeometry(b);
  assert.ok(S.goalFill(world, level.goals)[0] >= goal.need, 'a full turn is upright again');
});

test('goals only take loads of their own kind', () => {
  const idx = LEVELS.findIndex((L) => L.goals.some((g) => g[5] === 'slab'));
  const level = S.compileLevel(LEVELS[idx]);
  const world = S.buildWorld(level);
  const goal = level.goals.find((g) => g.kind === 'slab');
  const cube = S.spawnLoad(world, 'cube', goal.x + goal.w / 2, goal.y + goal.h / 2);
  assert.equal(cube.tag, 'cube');
  const fills = S.goalFill(world, level.goals);
  assert.equal(fills[level.goals.indexOf(goal)], 0);
  assert.ok(level.goals.every((g) => g.kind));
});

test('on windy and rocking jobs the landing prediction appears only while the prompt asks for the drop', () => {
  const windy = LEVELS.map((L, i) => ((L.wind || L.sea) && !L.aim ? i + 1 : 0)).filter(Boolean);
  const calm = LEVELS.map((L, i) => (L.wind || L.sea ? 0 : i + 1)).filter(Boolean);
  assert.ok(windy.length >= 4 && calm.length >= 10);
  const run = (level) => {
    const { g } = begin(level, { seed: 4 });
    const seen = { drop: 0, other: 0, otherWith: 0 };
    const plan = LEVELS[level - 1].plan;
    for (let i = 0; i < 60 * 60; i++) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      if (st.guide) {
        if (/^Press Space/.test(st.line.en)) {
          seen.drop++;
          assert.ok(st.guide.landing, `level ${level}: no landing in the drop state`);
        } else {
          seen.other++;
          if (st.guide.landing) seen.otherWith++;
        }
      }
      const keys = /^Move →/.test(st.line.en)
        ? [KEYS.right]
        : /^Move ←/.test(st.line.en)
          ? [KEYS.left]
          : [];
      g.update(
        1 / 60,
        input(
          keys,
          /^Press Space/.test(st.line.en) ? ['Space'] : /^Press X/.test(st.line.en) ? ['KeyX'] : [],
        ),
      );
    }
    void plan;
    return seen;
  };
  for (const level of windy) {
    const seen = run(level);
    assert.ok(seen.drop > 0 && seen.other > 0);
    assert.equal(
      seen.otherWith,
      0,
      `level ${level} leaks the landing prediction outside the drop state`,
    );
  }
  for (const level of calm.slice(0, 6))
    assert.ok(run(level).otherWith > 0, `level ${level} keeps the aid`);
  // and the aid is not drawn either
  const level = windy[0];
  const { g } = begin(level);
  seconds(g, 1.6);
  const st = g.getState();
  assert.ok(st.hook && !/^Press Space/.test(st.line.en));
  const hidden = recordingContext();
  g.draw(hidden);
  const guideColour = hidden.calls.shaded.filter(([c]) => c === '#7ee7ff').length;
  assert.ok(guideColour <= 2, 'only the arrow/ghost colours, no fall line');
});

// Builds a level from its own plan in a physics world, with an optional edit of the plan order.
function buildPlan(level, edit = (plan) => plan) {
  const def = S.compileLevel(LEVELS[level - 1]);
  const world = S.buildWorld(def);
  for (const p of edit(def.plan)) {
    const k = KINDS[p.kind];
    S.spawnLoad(world, p.kind, p.x, S.boomHeight(world) + RULES.rope + RULES.hang + k.h / 2);
    settleWorld(world);
  }
  const fills = S.goalFill(world, def.goals);
  return fills.every((f, i) => f >= def.goals[i].need);
}

test('order traps are real: the tip before the steel ballast, or a skipped steel weight, ruins the build', () => {
  for (const level of [6, 11, 17, 18]) {
    const n = LEVELS[level - 1].plan.length;
    assert.equal(buildPlan(level), true, `level ${level} in the right order`);
    const swapped = (plan) => [...plan.slice(0, n - 2), plan[n - 1], plan[n - 2]];
    assert.equal(
      buildPlan(level, swapped),
      false,
      `level ${level}: the tip before the ballast falls`,
    );
  }
  // Level 21: the second steel weight is pictured, and skipping it breaks the build.
  assert.equal(buildPlan(21), true);
  assert.equal(
    buildPlan(21, (plan) => plan.filter((_, i) => i !== 3)),
    false,
    'dropping the second weight breaks the build',
  );
});

test('every required load has a visible goal picture, and similar loads are told apart by their mass label', () => {
  for (const [i, L] of LEVELS.entries()) {
    assert.equal(
      L.goals.length,
      L.plan.length,
      `level ${i + 1}: a required load without a picture`,
    );
    L.plan.forEach(([kind], j) =>
      assert.equal(L.goals[j][5], kind, `level ${i + 1} goal ${j} shows its kind`),
    );
  }
  assert.notEqual(S.kindMass('brick'), S.kindMass('weight'));
  const labelsAt = (level) => {
    const { g } = begin(level);
    seconds(g, 0.5);
    const ctx = recordingContext();
    g.draw(ctx);
    // the labels must be readable: drawn at high opacity and short enough for the half-width goals
    for (const [label, alpha] of ctx.calls.textAlpha.filter(
      ([x]) => /^\d+t$/.test(x) && x.length <= 3 + 0,
    ))
      assert.ok(
        typeof alpha !== 'number' || alpha >= 0.7,
        `label ${label} drawn at alpha ${alpha}`,
      );
    return ctx.calls.text;
  };
  const bricks = labelsAt(3);
  assert.ok(bricks.includes(`${Math.round(S.kindMass('brick') / 100)}t`), 'stone block label');
  assert.ok(!bricks.includes(`${Math.round(S.kindMass('weight') / 100)}t`));
  assert.ok(
    labelsAt(21).includes(`${Math.round(S.kindMass('weight') / 100)}t`),
    'steel weight label',
  );
});

// --- Outline jobs, progress stores, buffered presses, pauses and labels ---

// A canvas that records every text (with its box) and rectangle that is drawn.
function boxContext() {
  const texts = [];
  const rects = [];
  const ctx = mockContext();
  return new Proxy(ctx, {
    get: (t, p) => {
      if (p === 'fillText')
        return (str, x, y) => {
          const size = Number(/(\d+)px/.exec(t.font)[1]);
          const w = [...String(str)].reduce(
            (n, ch) => n + (/[一-鿿]/.test(ch) ? size : size * 0.6),
            0,
          );
          const left = t.textAlign === 'center' ? x - w / 2 : t.textAlign === 'right' ? x - w : x;
          texts.push({ str: String(str), x0: left, x1: left + w, y0: y, y1: y + size, size });
        };
      if (p === 'fillRect') return (x, y, w, h) => rects.push({ x, y, w, h, color: t.fillStyle });
      if (p === 'texts') return texts;
      if (p === 'rects') return rects;
      return t[p];
    },
    set: (t, p, v) => ((t[p] = v), true),
  });
}
const touching = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const outlineJobs = LEVELS.map((L, i) => (L.aim === 'outline' ? i + 1 : 0)).filter(Boolean);

test('the last seven jobs show outlines only: no mark, no direction, no swap named, and the landing preview stays on', () => {
  assert.deepEqual(outlineJobs, [16, 17, 18, 19, 20, 21, 22]);
  for (const level of outlineJobs) {
    const { g } = begin(level, { seed: 2 });
    const ids = new Set();
    let hooked = 0;
    for (let i = 0; i < 60 * 45; i++) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      ids.add(st.prompt.id);
      assert.doesNotMatch(st.line.en, /^(Move|Press X|Press Space)/, st.line.en);
      if (st.hook) {
        hooked++;
        assert.equal(st.guide.x, null, 'no per-step x');
        assert.equal(st.guide.outline, true);
        assert.equal(st.guide.dir, 0);
        assert.ok(st.guide.landing, `job ${level}: landing preview`);
      }
      const keys = i % 360 < 180 ? [KEYS.left] : [KEYS.right];
      g.update(1 / 60, input(keys, i % 200 === 199 ? ['Space', 'KeyX'] : []));
    }
    assert.ok(hooked > 100);
    for (const id of ids)
      assert.ok(
        [
          'reel',
          'aim',
          'steady',
          'settle',
          'hold',
          'failed',
          'collapsed',
          'wasted',
          'cleared',
        ].includes(id),
        id,
      );
  }
  // and the teaching jobs keep their exact marker
  for (const level of [1, 3, 5, 9, 15]) {
    const { g } = begin(level);
    seconds(g, 3);
    const st = g.getState();
    assert.equal(st.guide.outline, false);
    assert.ok(Number.isFinite(st.guide.x), `job ${level}`);
  }
});

test('an outline job is still judged on the exact fit: the same drop that meets a teaching goal can fall short', () => {
  const def = LEVELS[outlineJobs[0] - 1];
  const level = S.compileLevel(def);
  assert.ok(level.outline);
  const [goal] = level.goals;
  const fit = (dx) => {
    const w = S.buildWorld(level);
    S.spawnLoad(w, goal.kind, goal.x + goal.w / 2 + dx, goal.y + goal.h / 2 - 1);
    for (let i = 0; i < 300; i++) S.stepWorld(w, 1 / 120);
    return S.goalFill(w, level.goals)[0];
  };
  assert.ok(fit(0) >= goal.need, 'centred meets the goal');
  assert.ok(fit(2) >= goal.need, 'a small slip still meets it');
  assert.ok(fit(14) < goal.need, 'a wide slip does not');
  assert.ok(goal.w === KINDS[goal.kind].w, "the outline is the load's own footprint");
});

test('a progress store that throws never stops the game: reads, writes and odd values', () => {
  const boom = {
    unlocked: () => {
      throw new Error('read failed');
    },
    unlock: () => {
      throw new Error('write failed');
    },
  };
  const a = createGame({ ...harness().env, progress: boom });
  assert.equal(a.getState().menu, null, 'a failed read starts at job 1');
  assert.equal(a.getState().level, 1);
  const { g } = (() => {
    const h = harness();
    h.env.progress = {
      unlocked: () => 1,
      unlock: () => {
        throw new Error('write failed');
      },
    };
    return { g: createGame(h.env) };
  })();
  // clear job 1 through the public input with the unlock write throwing
  const plan = LEVELS[0].plan;
  let step = 0;
  for (let i = 0; i < 60 * 120 && g.getState().level === 1; i++) {
    const st = g.getState();
    let held = [];
    let pressed = [];
    if (st.hook && step < plan.length) {
      const d = plan[step][1] - st.hook.x;
      if (Math.abs(d) > 2.5 && Math.abs(st.hook.vx) < 6) held = [d > 0 ? KEYS.right : KEYS.left];
      else if (Math.abs(d) <= 3.5 && Math.abs(st.hook.vx) < 4 && st.quiet) {
        pressed = ['Space'];
        step++;
      }
    }
    assert.doesNotThrow(() => g.update(1 / 60, input(held, pressed)));
  }
  assert.equal(g.getState().stats.cleared, 1, 'the job still counts as cleared');
  const cases = [
    [Infinity, 22],
    [1e9, 22],
    [-Infinity, 1],
    [NaN, 1],
    ['x', 1],
    [null, 1],
    [undefined, 1],
    [7.9, 7],
  ];
  for (const [raw, want] of cases) {
    const h = harness();
    h.env.progress = { unlocked: () => raw, unlock() {} };
    const game = createGame(h.env);
    assert.equal(game.getState().menu?.unlocked ?? 1, want, `unlocked() = ${String(raw)}`);
  }
  const none = createGame({ ...harness().env, progress: undefined });
  assert.equal(none.getState().level, 1);
});

test('a press made while the next load is being hooked on is kept and used the moment it attaches', () => {
  const { g } = begin(3);
  seconds(g, 0.3);
  assert.equal(g.getState().hook, null);
  g.update(1 / 60, input([], ['Space']));
  seconds(g, 0.5);
  assert.equal(g.getState().stats.drops, 0, 'nothing hangs yet');
  seconds(g, 0.4);
  assert.equal(g.getState().stats.drops, 1, 'the press waited for the hook');
  // the same for X during a swap
  const level = LEVELS.findIndex((L) => L.swaps === 2) + 1;
  const x = begin(level).g;
  seconds(x, 1.6);
  x.update(1 / 60, input([], ['KeyX']));
  seconds(x, 0.3);
  x.update(1 / 60, input([], ['KeyX']));
  seconds(x, 1.2);
  assert.equal(x.getState().stats.swaps, 2, 'a second X during the swap is kept');
  // a key already down when the game starts, or a second tap right after an action, is not a press
  const held = begin(1).g;
  held.update(1 / 60, input(['Space'], []));
  seconds(held, 2.5, ['Space']);
  assert.equal(held.getState().stats.drops, 0, 'a held key from before the start is ignored');
  const tap = begin(3).g;
  seconds(tap, 1.6);
  tap.update(1 / 60, input([], ['Space']));
  tap.update(1 / 60, input([], ['Space']));
  seconds(tap, 2.5);
  assert.equal(tap.getState().stats.drops, 1, 'a bounce after a drop does not drop the next load');
});

test('a press in the clear or fail pause carries on at once, but not in the first moment of the pause', () => {
  for (const mode of ['cleared', 'failed']) {
    const { g } = begin(2);
    const play = (until) => {
      const plan = LEVELS[1].plan;
      let step = 0;
      for (let i = 0; i < 60 * 150 && g.getState().mode !== until; i++) {
        const st = g.getState();
        let held = [];
        let pressed = [];
        if (st.hook && st.level === 2) {
          if (mode === 'failed') {
            held = st.hook.x > 60 ? [KEYS.left] : [];
            pressed = st.hook.x <= 60 ? ['Space'] : [];
          } else if (step < plan.length) {
            const d = plan[step][1] - st.hook.x;
            if (Math.abs(d) > 2.5 && Math.abs(st.hook.vx) < 6)
              held = [d > 0 ? KEYS.right : KEYS.left];
            else if (Math.abs(d) <= 3.5 && Math.abs(st.hook.vx) < 4 && st.quiet) {
              pressed = ['Space'];
              step++;
            }
          }
        }
        g.update(1 / 60, input(held, pressed));
      }
    };
    play(mode);
    assert.equal(g.getState().mode, mode);
    const level = g.getState().level;
    g.update(1 / 60, input([], ['Space']));
    seconds(g, 0.3);
    assert.equal(g.getState().mode, mode, 'too early to skip');
    seconds(g, 0.6);
    g.update(1 / 60, input([], ['Space']));
    seconds(g, 0.1);
    assert.equal(g.getState().mode, 'play', `${mode}: Space carries on`);
    assert.equal(g.getState().level, mode === 'cleared' ? level + 1 : level);
    // tapping on through the next job's opening second must not drop its first load
    const dropsBefore = g.getState().stats.drops;
    for (let i = 0; i < 9; i++) frames(g, 6, [], ['Space']);
    seconds(g, 1.5);
    assert.equal(
      g.getState().stats.drops,
      dropsBefore,
      `${mode}: taps after the skip dropped a load`,
    );
  }
});

test('mass labels use 吨 in Chinese and t in English, stay on the canvas and fit their goal', () => {
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVELS.length; level++) {
      const { g } = begin(level, { lang });
      for (let i = 0; i < 60 * 12; i++) {
        g.update(1 / 60, input([i % 400 < 200 ? KEYS.left : KEYS.right], []));
        if (i % 20) continue;
        const ctx = boxContext();
        g.draw(ctx);
        for (const t of ctx.texts) {
          assert.ok(t.x0 >= 0 && t.x1 <= 480, `job ${level} ${lang} "${t.str}" ${t.x0}..${t.x1}`);
          if (lang === 'zh')
            assert.doesNotMatch(t.str, /^\d+t$/, `Latin unit in Chinese: ${t.str}`);
        }
        const labels = ctx.texts.filter(
          (t) => /^\d+(t|吨)?$/.test(t.str) && t.size >= 7 && t.size <= 9,
        );
        for (const a of labels)
          for (const b of labels)
            if (a !== b && a.str !== b.str) assert.ok(!touching(a, b), `${a.str} on ${b.str}`);
      }
    }
  const zh = boxContext();
  const { g } = begin(2, { lang: 'zh' });
  seconds(g, 1.6);
  g.draw(zh);
  assert.ok(
    zh.texts.some((t) => /^\d+吨$/.test(t.str)),
    'the hung load says 吨',
  );
  const en = boxContext();
  const e = begin(2).g;
  seconds(e, 1.6);
  e.draw(en);
  assert.ok(en.texts.some((t) => /^\d+t$/.test(t.str)));
});

test('goal labels never spill their goal: the unit drops first, then the size', () => {
  for (const lang of ['en', 'zh']) {
    const level = LEVELS.findIndex((L) => L.goals.some((g) => g[5] === 'weight')) + 1;
    const { g } = begin(level, { lang });
    seconds(g, 0.5);
    const ctx = boxContext();
    g.draw(ctx);
    const weights = LEVELS[level - 1].goals.filter((x) => x[5] === 'weight');
    for (const w of weights) {
      const cx = w[0] + w[2] / 2;
      const inside = ctx.texts.filter(
        (t) => t.y0 < w[1] + w[3] && t.y1 > w[1] && Math.abs((t.x0 + t.x1) / 2 - cx) < 1.5,
      );
      assert.ok(inside.length > 0, `${lang}: weight goal label drawn`);
      for (const t of inside)
        assert.ok(
          t.x1 - t.x0 <= w[2] + 0.01,
          `${lang}: "${t.str}" ${t.x1 - t.x0} px > goal ${w[2]} px`,
        );
    }
  }
});

test('tries differ by shape as well as colour, and a job message clears the opening title and tip', () => {
  const rectsAt = (g) => {
    const ctx = boxContext();
    g.draw(ctx);
    return ctx.rects.filter((r) => r.y >= 6 && r.y <= 16 && r.x >= 392 && r.x < 436);
  };
  const fresh = begin(3).g;
  seconds(fresh, 0.5);
  const full = rectsAt(fresh);
  // use up a try: drop the first load far from its mark until the job fails
  const f = begin(3).g;
  for (let i = 0; i < 60 * 200 && f.getState().tries === 3; i++) {
    const st = f.getState();
    f.update(
      1 / 60,
      input(
        st.hook && st.hook.x > 60 ? [KEYS.left] : [],
        st.hook && st.hook.x <= 60 ? ['Space'] : [],
      ),
    );
  }
  assert.ok(f.getState().tries < 3);
  seconds(f, 3.6);
  while (f.getState().mode !== 'play') seconds(f, 0.5);
  const spent = rectsAt(f);
  assert.ok(
    spent.length > full.length,
    'a spent try is drawn with more strokes than a solid square',
  );
  assert.ok(
    new Set(spent.map((r) => `${r.w}x${r.h}`)).size >
      new Set(full.map((r) => `${r.w}x${r.h}`)).size - 1,
  );
  // a message that appears during the opening banner is drawn clear of the title and the tip
  const m = begin(3).g;
  m.update(1 / 60, input([], ['Space']));
  let checked = false;
  for (let i = 0; i < 60 * 4; i++) {
    m.update(1 / 60, input([], []));
    const st = m.getState();
    if (!st.message || st.time >= RULES.introTime) continue;
    const ctx = boxContext();
    m.draw(ctx);
    const msg = ctx.texts.find((t) => t.str === st.message.en);
    const title = ctx.texts.find((t) => t.str === st.levelName.en);
    const tip = ctx.texts.find((t) => t.str === st.tip.en);
    assert.ok(msg && title && tip, 'message, title and tip are all drawn');
    assert.ok(!touching(msg, title) && !touching(msg, tip), 'no overlap with the opening banner');
    checked = true;
    break;
  }
  assert.ok(checked, 'a message was shown during the opening banner');
});

test('every level name fits the menu cell, and every EN tip fits the intro panel', () => {
  const width = (str, size) =>
    [...str].reduce((n, ch) => n + (/[一-鿿←→]/.test(ch) ? size : size * 0.6), 0);
  for (const L of LEVELS) {
    assert.ok(width(L.name[0], 8) <= 62, `${L.name[0]} in the menu`);
    assert.ok(width(L.name[1], 8) <= 62, `${L.name[1]} in the menu`);
    assert.ok(width(L.tip[0], 10) <= 400, `${L.tip[0]} in the intro`);
    assert.ok(width(L.tip[1], 10) <= 400, `${L.tip[1]} in the intro`);
  }
});

test('Lean Tower steps right on every brick', () => {
  const lean = LEVELS.find((L) => L.name[0] === 'Lean Tower');
  const xs = lean.plan.map((p) => p[1]);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `step ${i}: ${xs.join(',')}`);
});

test('outline jobs list their goals bottom row first, so the list does not give away the build order', () => {
  for (const level of outlineJobs) {
    const { g } = begin(level);
    const goals = g.getState().goals;
    for (let i = 1; i < goals.length; i++) {
      const prev = goals[i - 1];
      const cur = goals[i];
      assert.ok(
        prev.y + prev.h >= cur.y + cur.h,
        `job ${level}: goal ${i} is lower than the one before`,
      );
      if (prev.y + prev.h === cur.y + cur.h)
        assert.ok(prev.x <= cur.x, `job ${level}: left to right`);
    }
    assert.equal(goals.length, LEVELS[level - 1].goals.length);
  }
  const marked = begin(8).g.getState().goals;
  assert.deepEqual(
    marked.map((x) => x.kind),
    LEVELS[7].goals.map((x) => x[5]),
    'marked jobs keep the plan order',
  );
});

test('an off-plan drop on an outline job does not announce the plan', () => {
  const { g } = begin(outlineJobs[0]);
  let seen = null;
  for (let i = 0; i < 60 * 40 && !seen; i++) {
    const st = g.getState();
    if (st.message) seen = st.message.en;
    g.update(1 / 60, input([KEYS.left], i % 90 === 89 ? ['Space'] : []));
  }
  assert.ok(seen === null || !/plan/i.test(seen), String(seen));
});
