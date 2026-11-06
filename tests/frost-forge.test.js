import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  STAGES,
  PADS,
  PARTS,
  PROMPTS,
  createGame,
  newState,
  loadStage,
  advance,
  snapshot,
  bestPad,
  groundClass,
  heatColor,
  render,
  engineEta,
  glowLevel,
  takeAt,
  menuCell,
  openMenu,
} from '../src/games/frost-forge.js';
import { harness, input, mockContext, seeded } from './harness.js';

// The first workshop plus the two original multi-part workshops, found by name.
const index = (name) => STAGES.findIndex((st) => st.name.en === name);
const HALL = index('Ice Hall');
const DEEP = index('Deep Freeze');
const STEP = RULES.step;
const TILE = RULES.tile;
const cx = (c) => c * TILE + TILE / 2;
const cy = (r) => RULES.top + r * TILE + TILE / 2;
const run = (s, seconds, held = []) => {
  const inp = input(held);
  for (let i = 0; i < Math.round(seconds * 120); i++) advance(s, STEP, inp);
};
const tap = (s, code) => advance(s, STEP, input([], [code]));
const stage = (index) => {
  const s = newState();
  loadStage(s, index);
  s.hp = RULES.hpMax;
  return s;
};
const put = (comp, c, r, T) => Object.assign(comp, { x: cx(c), y: cy(r), T });
const stand = (s, c, r) => Object.assign(s.player, { x: cx(c), y: cy(r), vx: 0, vy: 0 });
const hold = (s, comp) => {
  comp.held = true;
  stand(s, 1, 1);
};
// A host stub: progress.unlocked() reads the stored value, unlock(n) raises it and is logged.
const progressEnv = (unlocked, lang = 'en') => {
  const h = harness({ lang });
  const calls = [];
  const store = { unlocked };
  h.env.progress = {
    unlocked: () => store.unlocked,
    unlock: (n) => {
      calls.push(n);
      store.unlocked = Math.max(store.unlocked, n);
    },
  };
  return { ...h, calls, store };
};
const clone = (s) => JSON.parse(JSON.stringify(s));
const socketFor = (s, comp) => s.sockets.find((k) => k.kind === comp.kind);
const inWindowOf = (comp, k) => comp.T >= k.lo && comp.T <= k.hi;

test('meta follows the module contract and is bilingual', () => {
  assert.equal(meta.id, 'frost-forge');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.match(meta.description.zh, /[一-龥]/);
  assert.ok(meta.keys.length >= 3);
  for (const key of meta.keys) assert.ok(key.label.en && key.label.zh && key.keys);
});

test('touch controls cover every key the game reads and are bilingual', () => {
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(code), code);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en && /[一-龥]/.test(c.label.zh));
    assert.ok(['left', 'right'].includes(c.side));
  }
});

test('invalid, zero, negative, NaN and huge dt leave the simulation untouched', () => {
  const s = newState();
  const before = JSON.stringify(s);
  for (const dt of [0, -1 / 60, NaN, Infinity, undefined, RULES.maxDt * 2, 5]) {
    assert.equal(advance(s, dt, input(['ArrowRight'], ['Space', 'KeyX'])), false);
  }
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.pendingHandle, false, 'a rejected update does not consume or queue actions');
});

test('full state is identical at 30, 60 and 120 Hz with the same aligned input', () => {
  const script = seeded(11);
  const blocks = Array.from({ length: 30 * 40 }, (_, i) => ({
    held: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => script() < 0.3),
    pressed: i % 17 === 5 ? ['Space'] : i % 53 === 7 ? ['KeyX'] : [],
  }));
  const results = [30, 60, 120].map((hz) => {
    const s = newState();
    blocks.forEach((b) => {
      for (let n = 0; n < hz / 30; n++) advance(s, 1 / hz, input(b.held, n === 0 ? b.pressed : []));
    });
    return { ...clone(s), acc: 0 };
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
  assert.ok(results[0].ticks === 30 * 40 * 4);
  assert.ok(results[0].stats.tools > 0);
});

test('a part on a pad approaches the pad temperature by Newton cooling', () => {
  for (const [ch, c, r] of [
    ['F', 3, 2],
    ['C', 3, 7],
  ]) {
    const s = stage(0);
    put(s.comps[0], c, r, 12);
    stand(s, 12, 8);
    const pad = PADS[ch];
    let last = s.comps[0].T;
    for (let i = 1; i <= 240; i++) {
      advance(s, STEP, input([]));
      const T = s.comps[0].T;
      assert.ok(Math.abs(T - pad.temp) < Math.abs(last - pad.temp), 'monotone approach');
      last = T;
    }
    const exact = pad.temp + (12 - pad.temp) * Math.exp(-pad.k * 2);
    assert.ok(Math.abs(last - exact) < 0.5, `${ch}: ${last} vs ${exact}`);
  }
});

test('floor and part exchange heat with the stated rates in one tick', () => {
  const s = stage(0);
  put(s.comps[0], 10, 2, 100);
  stand(s, 12, 8);
  const floor = s.tiles[2][10];
  advance(s, STEP, input([]));
  assert.ok(
    Math.abs(s.comps[0].T - (100 + (floor - 100) * RULES.partFromTile * STEP)) < 1e-9,
    'part follows the floor',
  );
  const expectFloor = floor + (100 - floor) * RULES.tileFromPart * STEP;
  assert.ok(Math.abs(s.tiles[2][10] - expectFloor) < 1e-9, 'floor follows the part');
  assert.equal(s.tiles[3][10], floor, 'neighbouring floor is untouched');
});

test('a hot part melts ice under it and a very cold part freezes dry floor', () => {
  const hot = stage(HALL);
  put(hot.comps[0], 9, 4, 100);
  stand(hot, 5, 8);
  assert.equal(groundClass(hot.tiles[4][9]), 'ice');
  run(hot, 4);
  assert.notEqual(groundClass(hot.tiles[4][9]), 'ice', 'melted into a puddle or dry floor');
  const cold = stage(0);
  put(cold.comps[0], 10, 2, -90);
  stand(cold, 5, 8);
  assert.equal(groundClass(cold.tiles[2][10]), 'dry');
  run(cold, 4);
  assert.equal(groundClass(cold.tiles[2][10]), 'ice');
  assert.equal(groundClass(8), 'dry');
  assert.equal(groundClass(7.9), 'wet');
  assert.equal(groundClass(-5), 'ice');
});

test('carrying exchanges heat between glove and part at the stated rates', () => {
  const s = stage(0);
  const g = s.comps[0];
  g.T = 100;
  hold(s, g);
  s.player.glove = 30;
  advance(s, STEP, input([]));
  const gloveRate = (RULES.body - 30) * RULES.gloveFromBody + (100 - 30) * RULES.gloveFromPart;
  assert.ok(Math.abs(s.player.glove - (30 + gloveRate * STEP)) < 1e-9);
  const partRate = (30 - 100) * RULES.partFromGlove + (RULES.air - 100) * RULES.partFromAir;
  assert.ok(Math.abs(g.T - (100 + partRate * STEP)) < 1e-9);
  const idle = stage(0);
  idle.player.glove = 0;
  run(idle, 1);
  assert.ok(idle.player.glove > 0 && idle.player.glove < RULES.body, 'gloves warm toward the body');
});

test('the tool heats or cools by exactly its power and stops at its limits', () => {
  const s = stage(0);
  const g = s.comps[0];
  stand(s, 8, 7);
  g.T = 50;
  s.player.tool = 1;
  const before = g.T;
  const floor = s.tiles[7][8];
  advance(s, STEP, input([]));
  const natural = (floor - before) * RULES.partFromTile * STEP;
  assert.ok(Math.abs(g.T - (before + natural + RULES.toolPower * STEP)) < 1e-9);
  g.T = 179.99;
  advance(s, STEP, input([]));
  assert.ok(g.T <= RULES.toolMax + 1e-9);
  s.player.tool = 2;
  g.T = -89.99;
  advance(s, STEP, input([]));
  assert.ok(g.T >= RULES.toolMin - 0.5 && g.T <= -88);
  const far = stage(0);
  stand(far, 15, 8);
  far.player.tool = 1;
  const t0 = far.comps[0].T;
  run(far, 1);
  assert.ok(far.comps[0].T <= t0 + 1e-9, 'out of reach: no heating');
});

test('X cycles the tool off, torch, frost and back', () => {
  const s = stage(0);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    tap(s, 'KeyX');
    seen.push(snapshot(s).player.tool);
  }
  assert.deepEqual(seen, ['torch', 'frost', 'off', 'torch']);
});

test('temperatures never jump: every tick change is bounded by the stated rates', () => {
  const rnd = seeded(5);
  const s = stage(DEEP);
  const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const maxRate = (hi, lo) => (hi - lo) * 0.5 + RULES.toolPower;
  let prev = clone(s);
  for (let n = 0; n < 120 * 90; n++) {
    const pressed = n % 97 === 0 ? ['Space'] : n % 211 === 0 ? ['KeyX'] : [];
    advance(
      s,
      STEP,
      input(
        codes.filter(() => rnd() < 0.3),
        pressed,
      ),
    );
    s.comps.forEach((c, i) => {
      assert.ok(Math.abs(c.T - prev.comps[i].T) <= maxRate(200, -100) * STEP + 1e-9, 'part');
    });
    assert.ok(Math.abs(s.player.glove - prev.player.glove) <= 0.5 * 300 * STEP);
    assert.ok(Math.abs(s.engine - prev.engine) <= 0.02 * 60 * STEP);
    prev = clone(s);
    if (s.phase !== 'playing') break;
  }
});

function slide(index, key, ground) {
  const s = stage(index);
  stand(s, index === HALL ? 7 : 3, index === HALL ? 2 : 3);
  s.player.x -= 8;
  const inp = input([key]);
  let t = 0;
  while (Math.abs(s.player.vx) < RULES.maxSpeed && t++ < 1200) advance(s, STEP, inp);
  const speed = s.player.vx;
  const x0 = s.player.x;
  for (let i = 0; i < 1200 && s.player.vx > 0; i++) advance(s, STEP, input([]));
  assert.equal(snapshot(s).player.ground, ground);
  return { speed, coast: s.player.x - x0, accelTicks: t };
}

test('ice has less traction than a puddle, which has less than dry floor', () => {
  const dry = slide(0, 'ArrowRight', 'dry');
  const ice = slide(HALL, 'ArrowRight', 'ice');
  const expected = (g) => RULES.maxSpeed ** 2 / (2 * RULES.ground[g].fric);
  assert.ok(Math.abs(ice.coast - expected('ice')) < 3, `${ice.coast}`);
  assert.ok(Math.abs(dry.coast - expected('dry')) < 2, `${dry.coast}`);
  assert.ok(ice.accelTicks > dry.accelTicks * 3, 'ice accelerates slowly');
  assert.equal(dry.speed, RULES.maxSpeed);
  const wet = stage(0);
  wet.tiles = wet.tiles.map((row) => row.map((t) => (t === null ? t : 0)));
  stand(wet, 3, 3);
  wet.player.vx = RULES.maxSpeed;
  run(wet, 0.05);
  assert.equal(snapshot(wet).player.ground, 'wet');
  assert.ok(Math.abs(wet.player.vx - (RULES.maxSpeed - RULES.ground.wet.fric * 0.05)) < 1);
});

test('acceleration is finite and momentum survives a reversal on ice', () => {
  const s = stage(HALL);
  stand(s, 8, 4);
  run(s, 1, ['ArrowRight']);
  const v = s.player.vx;
  assert.ok(v > 150 * 0.5 && v <= RULES.maxSpeed);
  let last = v;
  const left = input(['ArrowLeft']);
  for (let i = 0; i < 12; i++) {
    advance(s, STEP, left);
    assert.ok(last - s.player.vx <= RULES.ground.ice.accel * STEP + 1e-9, 'bounded decel');
    last = s.player.vx;
  }
  assert.ok(s.player.vx > 0, 'still sliding right 0.1 s after pressing left');
  const diag = stage(0);
  run(diag, 1, ['ArrowRight', 'ArrowDown']);
  assert.ok(Math.hypot(diag.player.vx, diag.player.vy) <= RULES.maxSpeed + 1e-9);
  const cancel = stage(0);
  run(cancel, 0.5, ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
  assert.equal(cancel.player.vx, 0, 'opposite keys cancel');
});

const overlapsSolid = (s) => {
  const { x, y } = s.player;
  for (const [px, py] of [
    [x - 8, y - 8],
    [x + 7.999, y - 8],
    [x - 8, y + 7.999],
    [x + 7.999, y + 7.999],
  ]) {
    const ch = s.grid[Math.floor((py - RULES.top) / TILE)]?.[Math.floor(px / TILE)] ?? '#';
    if ('#E'.includes(ch)) return true;
  }
  return false;
};

test('walls, pillars and the engine stop the player flush without tunnelling', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const run1 = (index, key, c, r) => {
      const s = stage(index);
      stand(s, c, r);
      for (let i = 0; i < 6 / dt; i++) {
        advance(s, dt, input(key));
        assert.equal(overlapsSolid(s), false);
      }
      return s.player;
    };
    assert.equal(run1(0, ['ArrowLeft'], 6, 5).x, TILE + 8);
    assert.equal(run1(0, ['ArrowUp'], 6, 5).y, RULES.top + TILE + 8);
    assert.equal(run1(0, ['ArrowDown'], 6, 5).y, RULES.top + 9 * TILE - 8);
    assert.equal(run1(0, ['ArrowRight'], 6, 5).x, 9 * TILE - 8, 'pillar');
    assert.equal(run1(0, ['ArrowRight'], 6, 1).x, 16 * TILE - 8, 'engine face, top row');
    assert.equal(run1(0, ['ArrowRight'], 6, 8).x, 16 * TILE - 8, 'engine face, bottom row');
    assert.equal(run1(0, ['ArrowRight'], 12, 5).x, 16 * TILE - 8, 'engine face');
  }
  const slideWall = stage(0);
  stand(slideWall, 6, 1);
  run(slideWall, 3, ['ArrowUp', 'ArrowRight']);
  assert.equal(slideWall.player.y, RULES.top + TILE + 8);
  assert.ok(slideWall.player.x > 6 * TILE, 'slides along the wall');
});

test('Space picks up the nearest loose part inside reach only', () => {
  const s = stage(HALL);
  put(s.comps[0], 5, 4, 12);
  put(s.comps[1], 5, 5, 12);
  Object.assign(s.player, { x: cx(5), y: cy(4) + 5 });
  tap(s, 'Space');
  assert.deepEqual(
    s.comps.map((c) => c.held),
    [true, false],
  );
  assert.equal(snapshot(s).player.holding, 0);
  const far = stage(HALL);
  stand(far, 12, 8);
  tap(far, 'Space');
  assert.ok(far.comps.every((c) => !c.held));
  far.player.x = far.comps[0].x + RULES.reach + 1;
  far.player.y = far.comps[0].y;
  tap(far, 'Space');
  assert.ok(
    far.comps.every((c) => !c.held),
    'just outside reach',
  );
  far.player.x -= 2;
  tap(far, 'Space');
  assert.ok(far.comps[0].held);
});

test('Space puts a held part on a free pad, or on the floor when the pad is taken', () => {
  const s = stage(HALL);
  const [g, v] = s.comps;
  hold(s, g);
  Object.assign(s.player, { x: cx(3) + 6, y: cy(2) - 4 });
  tap(s, 'Space');
  assert.equal(g.held, false);
  assert.deepEqual([g.x, g.y], [cx(3), cy(2)], 'snapped to the pad centre');
  v.held = true;
  tap(s, 'Space');
  assert.equal(v.held, false);
  assert.notDeepEqual([v.x, v.y], [cx(3), cy(2)], 'a pad heats only one part');
  assert.equal(s.grid[Math.floor((v.y - RULES.top) / TILE)][Math.floor(v.x / TILE)], '.');
  assert.ok(Math.hypot(v.x - s.player.x, v.y - s.player.y) <= TILE * 1.5, 'beside the pad');
  assert.match(s.msg.en, /down/);
  hold(s, g);
  stand(s, 12, 8);
  tap(s, 'Space');
  assert.deepEqual([g.x, g.y], [s.player.x, s.player.y], 'bare floor: at the feet');
});

test('a part installs only inside its window, edges included, in the matching socket', () => {
  const at = (T, mutate) => {
    const s = stage(0);
    const g = s.comps[0];
    g.T = T;
    g.held = true;
    stand(s, 15, 5);
    s.player.glove = RULES.body;
    mutate?.(s);
    s.hp = 50;
    tap(s, 'Space');
    return s;
  };
  for (const T of [70, 90, 115]) {
    const s = at(T);
    assert.equal(s.sockets[0].done, true);
    assert.equal(s.comps[0].done, true);
    assert.equal(s.stats.installs, 1);
    assert.equal(s.score > 100 - 1, true);
    assert.equal(s.clear, RULES.clearTicks, 'last socket fills: stage cleared');
  }
  for (const T of [69.9, 115.1, 12, 125]) {
    const s = at(T);
    assert.equal(s.sockets[0].done, false);
    assert.equal(s.comps[0].held, true, 'still in hand');
    assert.equal(s.stats.rejects, 1);
    assert.match(s.msg.en, new RegExp(T < 70 ? 'too cold' : 'too hot'));
    assert.match(s.msg.zh, new RegExp(T < 70 ? '太冷' : '太热'));
  }
  const wrong = stage(HALL);
  wrong.comps[0].held = true;
  wrong.comps[0].T = 90;
  stand(wrong, 15, 6);
  tap(wrong, 'Space');
  assert.equal(wrong.stats.rejects, 1);
  assert.match(wrong.msg.en, /takes the Valve/);
  assert.ok(wrong.sockets.every((k) => !k.done));
});

test('near a socket with a warning, Space puts the part down instead of rejecting it', () => {
  const s = stage(0);
  const g = s.comps[0];
  g.held = true;
  g.T = 150;
  stand(s, 15, 5);
  s.player.glove = 70;
  tap(s, 'Space');
  assert.equal(g.held, false);
  assert.equal(s.stats.rejects, 0);
});

test('hot parts warn before they hurt, and harm is an explicit HP drain', () => {
  const s = stage(0);
  const g = s.comps[0];
  put(g, 4, 4, 100);
  stand(s, 4, 4);
  tap(s, 'Space');
  s.player.tool = 1;
  let warnAt = null;
  let harmAt = null;
  let lastHp = s.hp;
  for (let i = 0; i < 120 * 60 && s.phase === 'playing'; i++) {
    advance(s, STEP, input([]));
    const level = glowLevel(s);
    if (level && warnAt === null) warnAt = s.ticks;
    if (s.hp < lastHp - 1e-12) {
      harmAt ??= s.ticks;
      assert.ok(s.player.glove >= RULES.harmHot, 'only past the harm limit');
      assert.ok(lastHp - s.hp <= RULES.damage * STEP + 1e-9, 'bounded per tick');
    }
    lastHp = s.hp;
  }
  assert.ok(warnAt !== null && harmAt !== null);
  assert.ok((harmAt - warnAt) * STEP > 0.5, `warned ${(harmAt - warnAt) * STEP}s ahead`);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'body');
  assert.equal(s.stats.burns, 1);
});

test('frostbite works the same way for cold parts, and putting the part down heals', () => {
  const s = stage(HALL);
  const v = s.comps[1];
  v.T = -90;
  v.held = true;
  stand(s, 1, 1);
  s.player.tool = 2;
  let warned = false;
  while (s.hp >= RULES.hpMax && s.ticks < 120 * 120) {
    advance(s, STEP, input([]));
    warned ||= glowLevel(s) === 'cold';
  }
  assert.ok(warned, 'warned first');
  assert.ok(s.player.glove <= RULES.harmCold + 0.1);
  assert.match(s.msg.en, /Frostbite/);
  const low = s.hp;
  tap(s, 'Space');
  run(s, 10);
  assert.ok(s.player.glove > RULES.warnCold, 'gloves recover');
  assert.ok(s.hp > low, 'HP regenerates at the stated rate when safe');
  assert.ok(s.hp <= RULES.hpMax);
});

test('warning levels follow glove and part limits', () => {
  const s = stage(0);
  assert.equal(glowLevel(s), null);
  const g = s.comps[0];
  g.held = true;
  s.player.glove = RULES.warnHot - 0.1;
  g.T = RULES.partWarnHot - 0.1;
  assert.equal(glowLevel(s), null);
  g.T = RULES.partWarnHot;
  assert.equal(glowLevel(s), 'hot');
  g.T = RULES.partWarnCold;
  assert.equal(glowLevel(s), 'cold');
  g.T = 50;
  s.player.glove = RULES.warnHot;
  assert.equal(glowLevel(s), 'hot');
  s.player.glove = RULES.warnCold;
  assert.equal(glowLevel(s), 'cold');
  s.player.glove = RULES.harmHot;
  assert.equal(glowLevel(s), 'harm');
  s.player.glove = RULES.harmCold;
  assert.equal(glowLevel(s), 'harm');
});

test('the engine cools by Newton cooling and seizes at the printed time', () => {
  const s = stage(0);
  const rate = STAGES[0].frostRate;
  const eta0 = engineEta(s);
  run(s, 20);
  const expected = RULES.frost + (RULES.engineStart - RULES.frost) * Math.exp(-rate * 20);
  assert.ok(Math.abs(s.engine - expected) < 0.05);
  assert.ok(Math.abs(engineEta(s) - (eta0 - 20)) < 0.2, 'the countdown is the cooling curve');
  const seizeAt = s.ticks * STEP + engineEta(s);
  while (s.phase === 'playing') advance(s, STEP, input([]));
  assert.equal(s.cause, 'engine');
  assert.ok(Math.abs(s.ticks * STEP - seizeAt) < 0.1, `${s.ticks * STEP} vs ${seizeAt}`);
  assert.equal(engineEta({ stage: 0, engine: RULES.seize }), 0);
});

test('22 authored workshops teach, combine and master temperature windows', () => {
  assert.ok(STAGES.length >= 20, 'level-based games ship at least 20 levels');
  assert.equal(STAGES.length, 22);
  assert.equal(new Set(STAGES.map((st) => st.name.en)).size, STAGES.length);
  assert.equal(new Set(STAGES.map((st) => st.name.zh)).size, STAGES.length);
  const counts = STAGES.map((st) => st.sockets.length);
  assert.deepEqual(counts.slice(0, 2), [1, 1], 'one part at a time to begin with');
  assert.ok(
    counts.slice(0, 11).every((n) => n <= 2),
    'teaching: one or two parts',
  );
  assert.ok(
    counts.slice(11, 17).every((n) => n >= 2 && n <= 3),
    'combining: up to three parts',
  );
  assert.ok(counts.slice(11, 17).filter((n) => n === 3).length >= 5);
  assert.ok(
    counts.slice(17).every((n) => n === 4),
    'mastery: four parts',
  );
  // Each idea enters on its own: two parts, ice, a frozen socket, then the coil and warm plate.
  const first = (test) => STAGES.findIndex(test);
  const order = [
    first((st) => st.sockets.length === 2),
    first((st) => st.ice.length > 0),
    first((st) => st.sockets.some((k) => k.ice > 0)),
    first((st) => st.sockets.some((k) => k.kind === 'coil')),
  ];
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.equal(new Set(order).size, 4, 'no teaching workshop introduces two of them at once');
  assert.deepEqual(
    [STAGES[0].ice.length, STAGES[0].sockets[0].ice, STAGES[0].walls.length > 0],
    [0, 0, true],
  );
  // Scarce pads: workshops where more parts need one kind of pad than there are such pads.
  const scarce = STAGES.filter((st) =>
    ['F', 'C', 'W'].some((ch) => {
      const need = st.sockets.filter((k) => PADS[ch].temp >= k.lo && PADS[ch].temp <= k.hi).length;
      return need > st.pads.filter(([p]) => p === ch).length;
    }),
  );
  assert.ok(scarce.length >= 3);
  assert.ok(STAGES.some((st) => st.pads.filter(([ch]) => ch === 'F').length === 2));
  // Engine clocks: always above 90 s, long for the lone-part workshops.
  const budget = (st) =>
    Math.log((RULES.engineStart - RULES.frost) / (RULES.seize - RULES.frost)) / st.frostRate;
  STAGES.forEach((st) => assert.ok(budget(st) >= 100, `${st.name.en}: ${budget(st)}`));
  const narrowest = (list) => Math.min(...list.flatMap((st) => st.sockets.map((k) => k.hi - k.lo)));
  assert.ok(
    narrowest(STAGES.slice(17)) < narrowest(STAGES.slice(0, 11)),
    'mastery windows tighten',
  );
  STAGES.forEach((st) => {
    assert.equal(new Set(st.sockets.map((k) => k.kind)).size, st.sockets.length);
    for (const k of st.sockets) {
      assert.ok(PARTS[k.kind].en && PARTS[k.kind].zh);
      assert.ok(12 < k.lo || 12 > k.hi, 'ambient temperature never satisfies a window');
      assert.ok(k.hi - k.lo >= 20, 'window wide enough to hit by hand');
      // A pad sits inside the take band, so a part resting on it ends up ready and stays ready.
      const band = takeAt(k);
      assert.ok(
        st.pads.some(([ch]) => PADS[ch].temp >= band.lo && PADS[ch].temp <= band.hi),
        `${st.name.en}: no pad settles the ${k.kind} window ${k.lo}~${k.hi}`,
      );
    }
  });
});

test('every part starts on plain floor, outside its window and its take band', () => {
  STAGES.forEach((st, index) => {
    const s = stage(index);
    for (const c of s.comps) {
      const at = [Math.floor(c.x / TILE), Math.floor((c.y - RULES.top) / TILE)];
      const ch = s.grid[at[1]][at[0]];
      assert.ok('.i'.includes(ch), `${st.name.en} ${c.kind} starts on plain floor`);
      assert.equal(c.T, ch === 'i' ? -35 : RULES.air);
      assert.ok(!inWindowOf(c, socketFor(s, c)));
      assert.ok(!snapshot(s).comps[c.id].takeReady);
    }
    const p = [Math.floor(s.player.x / TILE), Math.floor((s.player.y - RULES.top) / TILE)];
    assert.ok('.i'.includes(s.grid[p[1]][p[0]]), 'the player starts on plain floor');
  });
});

test('every stage is reachable: parts, pads and socket approaches are walkable', () => {
  STAGES.forEach((st, index) => {
    const s = stage(index);
    const seen = new Set();
    const queue = [[Math.floor(s.player.x / TILE), Math.floor((s.player.y - RULES.top) / TILE)]];
    while (queue.length) {
      const [c, r] = queue.pop();
      if (seen.has(`${c},${r}`) || '#E'.includes(s.grid[r]?.[c] ?? '#')) continue;
      seen.add(`${c},${r}`);
      queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    for (const c of s.comps)
      assert.ok(seen.has(`${Math.floor(c.x / TILE)},${Math.floor((c.y - RULES.top) / TILE)}`));
    for (const p of snapshot(s).pads) assert.ok(seen.has(`${p.c},${p.r}`));
    for (const k of s.sockets) assert.ok(seen.has(`${k.c - 1},${k.r}`), `${k.kind} approach`);
    // Every part can be brought into its window from either side with the pads and the tool.
    for (const k of st.sockets) {
      const hot = st.pads.some(([ch]) => PADS[ch].temp >= k.lo);
      const cool = st.pads.some(([ch]) => PADS[ch].temp <= k.hi);
      assert.ok(hot && cool, `${k.kind} can be warmed and cooled by a pad`);
    }
  });
});

test('bestPad picks the pad that approaches the window without overshooting', () => {
  const s = stage(DEEP);
  const [gear, valve, coil] = s.comps;
  gear.T = 12;
  assert.equal(bestPad(s, gear).ch, 'F');
  valve.T = 12;
  assert.equal(bestPad(s, valve).ch, 'C');
  coil.T = 12;
  assert.equal(bestPad(s, coil).ch, 'W', 'the warm plate settles inside the coil window');
  coil.T = 140;
  assert.equal(bestPad(s, coil).ch, 'W');
  gear.T = 130;
  assert.equal(bestPad(s, gear).ch, 'F', 'the furnace now settles inside the gear window');
  gear.T = 90;
  assert.equal(bestPad(s, gear), null, 'already in the window');
  assert.equal(bestPad(stage(0), { ...stage(0).comps[0], T: 200 }).ch, 'F');
});

test('stage clear scores, heals, then loads the next workshop; the last one wins', () => {
  const h = harness();
  const game = createGame(h.env);
  assert.equal(game.getState().stage, 1);
  const s = stage(0);
  s.hp = 40;
  s.comps[0].T = 90;
  s.comps[0].held = true;
  stand(s, 15, 5);
  const eta = engineEta(s);
  tap(s, 'Space');
  assert.equal(s.score, RULES.installScore + RULES.clearScore + Math.round(eta * 2));
  assert.equal(s.prompt.key !== undefined, true);
  const frozen = s.engine;
  run(s, RULES.clearTicks * STEP);
  assert.equal(s.stage, 1);
  assert.equal(s.engine, RULES.engineStart);
  assert.notEqual(s.engine, frozen);
  assert.ok(Math.abs(s.hp - (40 + RULES.stageHeal)) < 0.1);
  assert.equal(s.player.tool, 0);
  assert.equal(s.comps.length, STAGES[1].sockets.length);
  assert.equal(snapshot(s).stage, 2);
  assert.match(s.msg.en, /^Workshop 2: Chill Out/);
  s.hp = 90;
  loadStage(s, DEEP);
  assert.equal(s.hp, RULES.hpMax, 'healing is capped');
});

test('winning the last workshop ends the game once with a bonus for HP', () => {
  const h = harness();
  const g = createGame(h.env);
  const last = STAGES.length - 1;
  const s = stage(last);
  const final = s.sockets.length - 1;
  s.sockets.forEach((k, i) => {
    if (i < final) {
      k.done = true;
      s.comps[i].done = true;
    }
  });
  const k = s.sockets[final];
  k.ice = 0;
  s.comps[final].T = (k.lo + k.hi) / 2;
  s.comps[final].held = true;
  stand(s, k.c - 1, k.r);
  tap(s, 'Space');
  assert.equal(s.phase, 'playing');
  const score = s.score;
  run(s, RULES.clearTicks * STEP + 0.05);
  assert.equal(s.phase, 'won');
  assert.equal(s.score, score + RULES.hpMax * 5);
  assert.equal(snapshot(s).prompt.key, 'cleared');
  assert.equal(s.unlockTo, STAGES.length, 'the last unlock never exceeds the catalog');
  assert.equal(g.getState().phase, 'playing');
});

test('terminal conditions end once, freeze the game and a new instance starts fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  const idle = input([]);
  const fresh = JSON.stringify(g.getState());
  for (let i = 0; i < 60 * 400 && h.ends.length === 0; i++) g.update(1 / 60, idle);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /froze/);
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  const again = createGame(harness().env);
  assert.equal(JSON.stringify(again.getState()), fresh);
  const zh = harness({ lang: 'zh' });
  const gz = createGame(zh.env);
  for (let i = 0; i < 60 * 400 && zh.ends.length === 0; i++) gz.update(1 / 60, idle);
  assert.match(zh.ends[0].message, /发动机/);
});

test('losing to burns reports the body message', () => {
  const h = harness();
  const g = createGame(h.env);
  g.update(1 / 60, input([]));
  assert.equal(h.ends.length, 0);
  const s = stage(0);
  s.hp = 0.01;
  s.player.glove = 100;
  advance(s, 1 / 30, input([]));
  assert.equal(s.cause, 'body');
});

test('status is bilingual and carries stage, parts, HP, engine, events and the prompt', () => {
  const s = stage(HALL);
  s.comps[0].held = true;
  stand(s, 1, 1);
  tap(s, 'Space');
  run(s, 1);
  const { status, prompt } = snapshot(s);
  assert.equal(typeof status.en, 'string');
  assert.equal(typeof status.zh, 'string');
  assert.match(
    status.en,
    new RegExp(
      `^Workshop ${HALL + 1}/22 · Parts 0/2 · HP 100 · Engine -?\\d+C, seizes in \\d+s · `,
    ),
  );
  assert.match(
    status.zh,
    new RegExp(`^工坊 ${HALL + 1}/22 · 零件 0/2 · 生命 100 · 发动机 -?\\d+度，\\d+秒后卡死 · `),
  );
  assert.ok(status.en.endsWith(prompt.en) && status.zh.endsWith(prompt.zh));
  assert.match(status.en, /Put the part down|Placed|Picked/);
  assert.match(status.zh, /放下|拿起|放到/);
});

test('prompts name their keys and change only after being readable for 0.55 s', () => {
  for (const [key, [en, zh]] of Object.entries(PROMPTS)) {
    if (!['cleared', 'wait', 'settle'].includes(key)) assert.match(en, /Space|X/, key);
    assert.ok(zh.length >= 6 && /[一-龥]/.test(zh), key);
    assert.ok(en.length <= 52 && zh.length <= 30, `${key} fits the 14 px bottom band`);
  }
  const s = stage(HALL);
  const keys = [];
  const rnd = seeded(2);
  for (let i = 0; i < 120 * 60; i++) {
    const held = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => rnd() < 0.2);
    advance(s, STEP, input(held, i % 150 === 0 ? ['Space'] : []));
    const id = s.prompt.id;
    if (!keys.length || keys.at(-1).id !== id) keys.push({ id, tick: s.ticks });
    if (s.phase !== 'playing') break;
  }
  assert.ok(keys.length >= 2);
  for (let i = 1; i < keys.length - 1; i++)
    assert.ok((keys[i + 1].tick - keys[i].tick) * STEP >= 0.55 - 1e-9, `${keys[i].id} too brief`);
});

test('the prompt follows the situation and never tells the player into a hazard', () => {
  const settle = (s) => {
    run(s, 0.7);
    return snapshot(s).prompt;
  };
  let s = stage(0);
  stand(s, 12, 8);
  assert.equal(settle(s).key, 'bring');
  assert.match(snapshot(s).prompt.en, /take the Gear to the furnace/);
  assert.match(snapshot(s).prompt.zh, /齿轮.*熔炉/);
  s.comps[0].T = 130;
  assert.equal(settle(s).key, 'settle', 'an overheated gear on the floor evens out by itself');
  assert.match(snapshot(s).prompt.en, /settling on the floor: take it at \d+~115/);
  put(s.comps[0], 3, 2, 130);
  assert.equal(settle(s).key, 'lift');
  assert.match(snapshot(s).prompt.en, /lift the Gear off the furnace/);
  put(s.comps[0], 3, 2, 90);
  assert.equal(settle(s).key, 'take');
  put(s.comps[0], 3, 2, 30);
  assert.equal(settle(s).key, 'wait');
  assert.match(snapshot(s).prompt.en, /on the furnace/);
  s.comps[0].held = true;
  s.player.glove = 30;
  assert.equal(settle(s).key, 'tooCold');
  s.comps[0].T = 130;
  s.player.glove = 40;
  const scorching = settle(s);
  assert.equal(scorching.key, 'floorHot', 'an overshot gear: bare floor brings it back gently');
  assert.match(scorching.en, /too hot: bare floor, Space, or X frost/);
  assert.doesNotMatch(scorching.en, /Gloves/);
  s.player.glove = 70;
  const hot = settle(s);
  assert.equal(hot.key, 'warnHot', 'a warning beats the tool advice');
  assert.match(hot.en, /Gloves are hot \(\d+C\).*put it down/);
  s.comps[0].T = 90;
  s.player.glove = 30;
  assert.equal(settle(s).key, 'install');
  s = stage(HALL);
  s.comps[1].held = true;
  s.comps[1].T = 20;
  assert.equal(settle(s).key, 'tooHot');
  assert.match(snapshot(s).prompt.en, /too hot: the chiller, or X frost/);
  s.comps[1].T = 150;
  assert.equal(settle(s).key, 'partHot');
  assert.match(snapshot(s).prompt.en, /hurry to the chiller, Space/);
  s.comps[1].T = -80;
  s.player.glove = 0;
  assert.equal(settle(s).key, 'floorCold');
  s.comps[1].held = false;
  s.comps[0].held = true;
  s.comps[0].T = -80;
  assert.equal(settle(s).key, 'partCold');
  assert.match(snapshot(s).prompt.en, /hurry to the furnace, Space/);
  s.comps[0].held = false;
  s.comps[1].held = true;
  s.comps[1].T = -80;
  s.player.glove = -12;
  assert.equal(settle(s).key, 'warnCold');
});

test('getState is a defensive copy with no cheat controls', () => {
  const s = newState();
  const g = createGame(harness().env);
  const state = g.getState();
  assert.deepEqual(Object.keys(state).sort(), Object.keys(snapshot(s)).sort());
  const before = JSON.stringify(g.getState());
  state.comps[0].temp = 999;
  state.player.x = -5;
  state.sockets[0].done = true;
  state.pads.length = 0;
  state.hp = 1000;
  assert.equal(JSON.stringify(g.getState()), before);
  for (const value of Object.values(state)) assert.notEqual(typeof value, 'function');
  assert.deepEqual(state.hud, { top: [0, 28], bottom: [268, 320] });
  assert.equal(
    state.comps.every((c) => c.rect.w >= 16 && c.rect.h >= 16),
    true,
  );
  assert.ok(state.player.rect.w >= 16);
});

test('a long seeded random run stays finite and bounded', () => {
  for (const seed of [1, 2, 3]) {
    const rnd = seeded(seed);
    const s = newState();
    const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA'];
    for (let i = 0; i < 60 * 600 && s.phase === 'playing'; i++) {
      const pressed = rnd() < 0.03 ? ['Space'] : rnd() < 0.01 ? ['KeyX'] : [];
      advance(
        s,
        1 / 60,
        input(
          codes.filter(() => rnd() < 0.25),
          pressed,
        ),
      );
      assert.equal(overlapsSolid(s), false);
    }
    const numbers = [s.hp, s.engine, s.score, s.player.x, s.player.y, s.player.glove]
      .concat(s.comps.flatMap((c) => [c.T, c.x, c.y]))
      .concat(s.tiles.flat().filter((t) => t !== null));
    assert.ok(numbers.every(Number.isFinite));
    assert.ok(s.comps.length <= 3 && s.tiles.length === RULES.rows);
    assert.ok(s.hp <= RULES.hpMax);
    for (const c of s.comps) assert.ok(c.T >= -200 && c.T <= 300);
  }
});

test('heat colours run from icy blue through grey to red-hot and clamp at the ends', () => {
  const rgb = (t) => heatColor(t).match(/\d+/g).map(Number);
  assert.deepEqual(rgb(-500), rgb(-90));
  assert.deepEqual(rgb(900), rgb(180));
  assert.ok(rgb(-60)[2] > rgb(-60)[0], 'cold is blue');
  assert.ok(rgb(120)[0] > rgb(120)[2], 'hot is red');
  assert.deepEqual(rgb(10), [160, 170, 185]);
});

function fontsOf(ctx, fonts) {
  return new Proxy(ctx, {
    set: (t, p, v) => {
      if (p === 'font') fonts.push(Number(/(\d+)px/.exec(v)[1]));
      t[p] = v;
      return true;
    },
    get: (t, p) => (p in t ? t[p] : () => {}),
  });
}

test('every state draws with 14 px or larger text in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const game = createGame(h.env);
    const fonts = [];
    const ctx = fontsOf(mockContext(), fonts);
    game.draw(ctx);
    const states = [];
    const s = stage(DEEP);
    const [gear, valve, coil] = s.comps;
    gear.T = 160;
    valve.T = -95;
    coil.T = 30;
    gear.held = true;
    stand(s, 8, 4);
    s.player.tool = 1;
    s.player.glove = 90;
    s.engine = -28;
    s.msg = { en: 'Hello', zh: '你好', left: 100 };
    s.tiles[2][3] = 3;
    states.push(clone(s));
    s.player.tool = 2;
    s.player.glove = -12;
    s.player.vx = 50;
    gear.held = false;
    put(gear, 5, 3, 130);
    valve.held = true;
    valve.T = -70;
    states.push(clone(s));
    s.clear = 100;
    s.sockets[0].done = true;
    s.comps[0].done = true;
    s.ticks = 77;
    states.push(clone(s));
    for (const state of states) render(fontsOf(mockContext(), fonts), state, h.env);
    assert.ok(fonts.length > 5 && Math.min(...fonts) >= 14 && Math.max(...fonts) <= 16, lang);
  }
});

test('every text line, including the event line, keeps a 2 px margin inside the canvas', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const s = stage(DEEP);
    s.msg = { en: 'Picked up the Gear.', zh: '拿起了齿轮。', left: 100 };
    const lines = [];
    const base = mockContext();
    const ctx = new Proxy(base, {
      get: (t, p) =>
        p === 'fillText'
          ? (str, x, y) => lines.push({ str, y, size: Number(/(\d+)px/.exec(base.font)[1]) })
          : p in t
            ? t[p]
            : () => {},
      set: (t, p, v) => ((t[p] = v), true),
    });
    render(ctx, s, h.env);
    assert.ok(lines.some((l) => l.str === s.msg[lang]));
    for (const l of lines) assert.ok(l.y + l.size * 1.2 <= 318, `${l.str}: ${l.y + l.size * 1.2}`);
  }
});

test('the exported tables are frozen and the take band is derived from the carry rules', () => {
  for (const table of [PADS, PARTS, STAGES, PROMPTS]) assert.ok(Object.isFrozen(table));
  assert.ok(Object.isFrozen(STAGES[0].sockets[0]));
  const rows = STAGES.flatMap((st) => st.sockets);
  for (const k of rows) {
    const band = takeAt(k);
    assert.ok(band.lo >= k.lo && band.hi <= k.hi && band.hi - band.lo >= 12, `${k.kind} band`);
    const edge = (k.lo + k.hi) / 2 >= RULES.body ? band.lo : band.hi;
    const after = carriedFor(edge);
    assert.ok(
      after >= k.lo - 0.01 && after <= k.hi + 0.01,
      `${k.kind} still in window after carrying`,
    );
  }
});

function carriedFor(T0) {
  const s = stage(0);
  const g = s.comps[0];
  g.T = T0;
  g.held = true;
  stand(s, 1, 1);
  s.player.glove = RULES.body;
  run(s, RULES.carryBudget);
  return g.T;
}

test('a scorching part can be carried to a pad after a 0.6 s hesitation without the glove warning', () => {
  const s = stage(HALL);
  const v = s.comps[1];
  put(v, 3, 2, 150);
  Object.assign(s.player, { x: cx(3), y: cy(2) + 12 });
  tap(s, 'Space');
  assert.equal(v.held, true);
  run(s, 0.6);
  run(s, 1.5, ['ArrowDown']);
  assert.ok(s.player.glove < RULES.warnHot, `glove ${s.player.glove}`);
  assert.equal(s.hp, RULES.hpMax);
  assert.equal(snapshot(s).player.glow, 'hot', 'the part itself still shows its warning');
});

test('a part resting on its intended pad reaches its take band and then stays in it', () => {
  STAGES.forEach((st, index) => {
    st.sockets.forEach((k, part) => {
      const s = stage(index);
      const comp = s.comps[part];
      const pad = snapshot(s).pads.find((p) => p.ch === bestPad(s, comp).ch);
      put(comp, pad.c, pad.r, RULES.air);
      stand(s, 1, 1);
      let entered = null;
      for (let i = 0; i < 120 * 60; i++) {
        advance(s, STEP, input([]));
        const ready = snapshot(s).comps[part].takeReady;
        if (ready && entered === null) entered = s.ticks;
        if (entered !== null)
          assert.ok(ready, `${k.kind} left its take band at ${s.ticks * STEP}s`);
        if (s.phase !== 'playing') break;
      }
      assert.ok(
        entered !== null && entered * STEP < 8,
        `${k.kind} gets there in ${entered * STEP}s`,
      );
    });
  });
});

test('a frozen socket refuses parts until the torch melts it, then the torch shuts off', () => {
  const s = stage(HALL);
  const g = s.comps[0];
  assert.equal(s.sockets[0].ice, 100);
  Object.assign(g, { T: 90, held: true });
  stand(s, 15, 3);
  tap(s, 'Space');
  assert.equal(s.sockets[0].done, false);
  assert.match(s.msg.en, /frozen shut \(100%\)/);
  assert.equal(s.stats.rejects, 1);
  s.player.tool = 2;
  run(s, 2);
  assert.equal(s.sockets[0].ice, 100, 'frost spray does not melt it');
  s.player.tool = 1;
  const before = g.T;
  run(s, 1);
  assert.ok(Math.abs(s.sockets[0].ice - (100 - RULES.thawRate)) < 0.5, `${s.sockets[0].ice}`);
  assert.ok(g.T <= before, 'the torch works on the socket, not on the part in hand');
  run(s, 2.5);
  assert.equal(s.sockets[0].ice, 0);
  assert.equal(snapshot(s).player.tool, 'off', 'the torch shuts off when the ice is gone');
  assert.match(s.msg.en, /Socket thawed/);
  s.comps[0].T = 90;
  tap(s, 'Space');
  assert.equal(s.sockets[0].done, true);
  const open = stage(HALL);
  open.sockets[1].ice = 0;
  Object.assign(open.comps[1], { T: -40, held: true });
  stand(open, 15, 6);
  tap(open, 'Space');
  assert.equal(open.sockets[1].done, true, 'unfrozen sockets install at once');
});

test('the torch still heats the part when no frozen socket is in reach, and prompts say what to do', () => {
  const s = stage(HALL);
  const g = s.comps[0];
  Object.assign(g, { T: 50, held: true });
  stand(s, 10, 4);
  s.player.tool = 1;
  run(s, 1);
  assert.ok(g.T > 60, 'heated by the torch');
  Object.assign(g, { T: 90 });
  s.player.tool = 0;
  stand(s, 12, 4);
  run(s, 0.7);
  assert.equal(snapshot(s).prompt.key, 'thaw');
  assert.match(snapshot(s).prompt.en, /Gear is ready: X torch the frozen socket, Space/);
  assert.match(snapshot(s).prompt.zh, /喷灯/);
  assert.equal(PROMPTS.thaw.length, 2);
  assert.equal(snapshot(s).sockets[0].ice, 100);
});

const center = (n) => {
  const q = menuCell(n);
  return { x: q.x + q.w / 2, y: q.y + q.h / 2 };
};

test('the start screen opens only when more than workshop 1 is unlocked, and freezes the world', () => {
  for (const unlocked of [undefined, 1]) {
    const h = progressEnv(unlocked ?? 1);
    if (unlocked === undefined) delete h.env.progress;
    const game = createGame(h.env);
    assert.equal(game.getState().menu, null);
    assert.equal(game.getState().stage, 1);
  }
  const h = progressEnv(5);
  const game = createGame(h.env);
  const menu = game.getState();
  assert.deepEqual(menu.menu, { cursor: 5, unlocked: 5, total: 22 });
  assert.equal(menu.phase, 'playing');
  assert.equal(menu.prompt.key, 'menu');
  assert.match(menu.status.en, /^Frost Forge · 5\/22 workshops open · Arrows: pick a workshop/);
  assert.match(menu.status.zh, /^霜火工坊 · 已开放 5\/22 间工坊 · 方向键选工坊/);
  assert.equal(menu.message, null, 'no stage banner on the select screen');
  for (let i = 0; i < 600; i++) game.update(1 / 60, input([]));
  const later = game.getState();
  assert.equal(later.time, 0, 'the engine clock waits on the select screen');
  assert.equal(later.engine.temp, menu.engine.temp);
  assert.equal(h.ends.length, 0);
  const huge = progressEnv(999);
  assert.equal(createGame(huge.env).getState().menu.cursor, 22, 'clamped to the catalog');
  const odd = progressEnv(-3);
  assert.equal(createGame(odd.env).getState().menu, null, 'nonsense values mean workshop 1');
});

test('arrows and WASD move the cursor inside the open workshops; Space or Enter starts it', () => {
  const walk = (keys, start) => {
    const h = progressEnv(9);
    const game = createGame(h.env);
    for (const key of keys) game.update(1 / 60, input([], [key]));
    game.update(1 / 60, input([], [start]));
    return { s: game.getState(), sounds: h.sounds };
  };
  assert.equal(walk(['ArrowLeft', 'ArrowLeft'], 'Space').s.stage, 7);
  assert.equal(walk(['KeyA', 'KeyA', 'KeyD'], 'Enter').s.stage, 8);
  assert.equal(walk(['ArrowUp'], 'NumpadEnter').s.stage, 3, 'up moves a whole row back');
  assert.equal(walk(['KeyW', 'KeyS'], 'Space').s.stage, 9);
  assert.equal(walk(['ArrowRight', 'ArrowDown'], 'Space').s.stage, 9, 'never past the open ones');
  assert.equal(walk(['ArrowUp', 'ArrowUp'], 'Space').s.stage, 1, 'never before workshop 1');
  const started = walk(['ArrowLeft'], 'Space');
  assert.equal(started.s.menu, null);
  assert.equal(started.s.hp, RULES.hpMax);
  assert.match(started.s.message.en, /^Workshop 8: Ice Hall/);
  assert.match(started.s.message.zh, /^第8间工坊：冰厅/);
  assert.ok(started.sounds.includes('move'));
  assert.equal(started.s.stageName.en, 'Ice Hall');
  // Keys held for a long time move one step per press, not per frame.
  const h = progressEnv(9);
  const game = createGame(h.env);
  game.update(1 / 60, input([], ['ArrowLeft']));
  for (let i = 0; i < 60; i++) game.update(1 / 60, input(['ArrowLeft']));
  assert.equal(game.getState().menu.cursor, 8);
  // Once started, the select screen stays closed and the engine runs.
  game.update(1 / 60, input([], ['Space']));
  for (let i = 0; i < 60; i++) game.update(1 / 60, input([]));
  assert.ok(game.getState().time > 0.9);
  assert.equal(game.getState().menu, null);
});

test('tapping a workshop starts it; a locked workshop only explains itself and then fades', () => {
  const h = progressEnv(4);
  const game = createGame(h.env);
  const locked = center(9);
  game.update(1 / 60, input([], [], { ...locked, clicked: true, down: true }));
  let s = game.getState();
  assert.ok(s.menu, 'still on the select screen');
  assert.match(s.message.en, /^Clear workshop 4 first/);
  assert.match(s.message.zh, /^先通关第4间工坊/);
  assert.ok(h.sounds.includes('hit'));
  game.update(1 / 60, input([], ['Space'], { ...locked, clicked: true }));
  assert.ok(game.getState().menu, 'Space on the same frame does not start a locked tap');
  for (let i = 0; i < 60 * 3; i++) game.update(1 / 60, input([]));
  assert.equal(game.getState().message, null, 'the note fades even with the world frozen');
  game.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.ok(game.getState().menu, 'a tap outside every cell does nothing');
  game.update(1 / 60, input([], [], { ...center(2), clicked: true }));
  s = game.getState();
  assert.equal(s.menu, null);
  assert.equal(s.stage, 2);
  // Every cell sits inside the field, at least 44 px tall and wide enough to tap.
  for (let n = 1; n <= STAGES.length; n++) {
    const q = menuCell(n);
    assert.ok(q.x >= 0 && q.x + q.w <= 480 && q.y >= RULES.top && q.y + q.h <= 268, `cell ${n}`);
    assert.ok(q.w >= 44 && q.h >= 44);
  }
  const { calls } = progressEnv(1);
  assert.deepEqual(calls, []);
});

test('the start screen draws every workshop in both languages with 14-16 px text', () => {
  for (const lang of ['en', 'zh']) {
    const h = progressEnv(8, lang);
    const game = createGame(h.env);
    const fonts = [];
    const texts = [];
    const ctx = new Proxy(fontsOf(mockContext(), fonts), {
      get: (t, p) =>
        p === 'fillText' ? (str) => texts.push(String(str)) : p in t ? t[p] : () => {},
      set: (t, p, v) => ((t[p] = v), true),
    });
    game.draw(ctx);
    game.update(1 / 60, input([], [], { ...center(20), clicked: true }));
    game.draw(ctx);
    game.update(0.5, input([]));
    for (let n = 1; n <= 22; n++) assert.ok(texts.includes(String(n)), `cell ${n}`);
    assert.ok(texts.some((x) => x.startsWith('8. ')));
    assert.ok(fonts.length > 20 && Math.min(...fonts) >= 14 && Math.max(...fonts) <= 16, lang);
    assert.ok(texts.some((x) => /先通关|Clear workshop/.test(x)));
    game.update(0.016, input([]));
    game.draw(ctx);
    assert.ok(texts.some((x) => x.includes(lang === 'en' ? 'Arrows' : '方向键')));
  }
  const s = newState();
  openMenu(s, 3);
  assert.equal(s.menu.cursor, 3);
  assert.equal(s.prompt.key, 'menu');
});

test('clearing a workshop asks the host to unlock the next one, and never lowers it', () => {
  const s = stage(0);
  assert.equal(s.unlockTo, 0);
  s.comps[0].T = 90;
  s.comps[0].held = true;
  stand(s, 15, 5);
  tap(s, 'Space');
  assert.equal(s.unlockTo, 2, 'workshop 2 opens as soon as the engine runs');
  run(s, RULES.clearTicks * STEP + 0.05);
  assert.equal(s.stage, 1);
  assert.equal(s.unlockTo, 2);
});

const settle = (s) => {
  for (let i = 0; i < RULES.promptHold + 2; i++) advance(s, STEP, input([]));
};

test('a pad heats one part: prompts wait for the occupant instead of fetching for a taken pad', () => {
  const s = stage(index('One Furnace'));
  const [gear, piston, valve] = s.comps;
  put(gear, 3, 3, 30);
  put(piston, 9, 6, 12);
  put(valve, 9, 3, 12);
  stand(s, 8, 4);
  assert.equal(bestPad(s, piston).busy, true, 'the only furnace is taken by the gear');
  assert.equal(bestPad(s, piston).ch, 'F');
  assert.equal(bestPad(s, gear).busy, false, 'a part never blocks itself');
  assert.equal(bestPad(s, valve).ch, 'C');
  assert.equal(bestPad(s, valve).busy, false);
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['bring', valve.id], 'the free chiller first');
  put(valve, 3, 7, -20);
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['wait', gear.id], 'the piston has to wait');
  assert.match(snapshot(s).prompt.en, /^Gear on the furnace: \d+C, take it at /);
  put(gear, 3, 3, 100);
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['take', gear.id]);
  gear.done = true;
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['bring', piston.id], 'the furnace is free');
});

test('standing on a taken pad, a part is laid on the floor beside it, never on the pad', () => {
  const s = stage(index('One Furnace'));
  const [gear, piston] = s.comps;
  put(gear, 3, 3, 60);
  piston.held = true;
  Object.assign(s.player, { x: cx(3) + 2, y: cy(3) + 1 });
  tap(s, 'Space');
  assert.equal(piston.held, false);
  const tileChar = (comp) =>
    s.grid[Math.floor((comp.y - RULES.top) / TILE)][Math.floor(comp.x / TILE)];
  assert.equal(tileChar(piston), '.');
  assert.equal(tileChar(gear), 'F');
  // Boxed in, it stays at the feet; ice is the last choice.
  const boxed = stage(index('One Furnace'));
  boxed.comps[1].held = true;
  put(boxed.comps[0], 3, 3, 60);
  Object.assign(boxed.player, { x: cx(3), y: cy(3) });
  for (const [dc, dr] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ])
    boxed.grid[3 + dr][3 + dc] = '#';
  tap(boxed, 'Space');
  assert.deepEqual([boxed.comps[1].x, boxed.comps[1].y], [cx(3), cy(3)]);
  const iced = stage(index('One Furnace'));
  iced.comps[1].held = true;
  put(iced.comps[0], 3, 3, 60);
  Object.assign(iced.player, { x: cx(3) - 3, y: cy(3) });
  iced.grid[3][2] = 'i';
  tap(iced, 'Space');
  assert.notEqual(Math.floor(iced.comps[1].x / TILE), 2, 'bare floor beats a nearer ice tile');
});

test('ready parts and strays are served nearest first, so a trip is never turned around', () => {
  const s = stage(index('Triple Play'));
  const [gear, valve, coil] = s.comps;
  put(gear, 3, 2, 100);
  put(valve, 9, 6, 12);
  put(coil, 12, 8, 12);
  stand(s, 10, 6);
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['bring', valve.id], 'the valve is close');
  stand(s, 4, 3);
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['take', gear.id], 'the gear is close now');
  stand(s, 11, 7);
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  assert.deepEqual([s.prompt.key, s.prompt.subject], ['bring', coil.id]);
});

test('Space takes the part the prompt names when it is in reach, even if another is closer', () => {
  const s = stage(index('Hot and Cold'));
  const [gear, valve] = s.comps;
  put(gear, 3, 2, 12);
  Object.assign(valve, { x: cx(3) + 14, y: cy(2) + 10, T: -45 });
  Object.assign(s.player, { x: cx(3) - 6, y: cy(2) + 4 });
  settle(s);
  for (let i = 0; i < 80; i++) advance(s, STEP, input([]));
  assert.equal(snapshot(s).comps[valve.id].takeReady, true);
  assert.equal(s.prompt.key, 'take');
  assert.equal(s.prompt.subject, valve.id);
  assert.ok(
    Math.hypot(gear.x - s.player.x, gear.y - s.player.y) <
      Math.hypot(valve.x - s.player.x, valve.y - s.player.y),
    'the gear is closer',
  );
  tap(s, 'Space');
  assert.equal(valve.held, true);
  assert.equal(gear.held, false);
});

test('a prompt that names a part nobody can reach leaves Space on the nearest part', () => {
  const s = stage(0);
  put(s.comps[0], 8, 7, 12);
  s.prompt = { id: 'take:0', key: 'take', subject: 0, age: 0 };
  Object.assign(s.player, { x: cx(8) + 40, y: cy(7) });
  tap(s, 'Space');
  assert.equal(s.comps[0].held, false, 'out of reach');
  put(s.comps[0], 8, 7, 12);
  Object.assign(s.player, { x: cx(8) + 5, y: cy(7) });
  tap(s, 'Space');
  assert.equal(s.comps[0].held, true, 'in reach: the named part');
});

test("two parts on each other's pads get bring guidance, never a false wait", () => {
  const s = stage(index('Hot and Cold'));
  const [gear, valve] = s.comps;
  put(gear, 3, 7, -30);
  put(valve, 3, 2, 60);
  stand(s, 8, 5);
  settle(s);
  assert.equal(s.prompt.key, 'bring');
  assert.equal(bestPad(s, gear).busy, true, 'the valve lies on the furnace');
  assert.equal(bestPad(s, gear).ch, 'F');
});

test('the prompt keeps naming the same ready part while it is still a candidate', () => {
  const s = stage(index('Ice Rink'));
  const [gear, valve] = s.comps;
  put(gear, 3, 2, 105);
  put(valve, 3, 7, -52);
  stand(s, 3, 4);
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  const first = s.prompt.subject;
  for (const row of [3, 6, 5, 4, 6, 3]) {
    stand(s, 3, row);
    settle(s);
    assert.equal(s.prompt.subject, first, `row ${row}`);
  }
});

test('a stray lying on a pad another part needs is moved first, so the pad frees up', () => {
  const s = stage(index('One Furnace'));
  const [gear, piston, valve] = s.comps;
  put(gear, 3, 3, 90);
  put(piston, 3, 7, -52);
  put(valve, 8, 6, 12);
  stand(s, 5, 6);
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  assert.deepEqual(
    [s.prompt.key, s.prompt.subject],
    ['bring', piston.id],
    'the piston blocks the chiller',
  );
});

test('with nothing ready, the prompt keeps naming the same stray while it stays a candidate', () => {
  const s = stage(index('One Furnace'));
  const [gear, piston, valve] = s.comps;
  Object.assign(gear, { x: 84, y: 136, T: 12 });
  Object.assign(valve, { x: 132, y: 208, T: 12 });
  Object.assign(piston, { done: true, T: 99 }); // installed already: two strays, nothing ready
  s.sockets[piston.id].done = true;
  Object.assign(s.player, { x: 240, y: 148 });
  s.prompt = { id: '', key: '', subject: null, age: RULES.promptHold };
  settle(s);
  assert.equal(s.prompt.key, 'bring');
  const first = s.prompt.subject;
  for (const [x, y] of [
    [100, 150],
    [120, 190],
    [110, 170],
    [90, 150],
    [125, 200],
  ]) {
    Object.assign(s.player, { x, y });
    settle(s);
    assert.equal(s.prompt.subject, first, `player at ${x},${y}`);
  }
});

test('Space auto-places a held part only onto a pad that suits it, otherwise on the floor', () => {
  const s = stage(index('Four Square'));
  const pads = snapshot(s).pads;
  const chiller = pads.find((p) => p.ch === 'C');
  const plate = pads.find((p) => p.ch === 'W');
  const [, valve, coil] = s.comps;
  // A cold coil held beside the chiller: the chiller is wrong for it, the warm plate is right.
  coil.held = true;
  coil.T = -50;
  Object.assign(s.player, { x: chiller.x, y: chiller.y });
  tap(s, 'Space');
  assert.equal(coil.held, false);
  assert.notDeepEqual([coil.x, coil.y], [chiller.x, chiller.y], 'not swallowed by the chiller');
  assert.equal(s.msg.en, 'Put the part down.');
  coil.held = true;
  Object.assign(s.player, { x: plate.x, y: plate.y });
  tap(s, 'Space');
  assert.deepEqual([coil.x, coil.y], [plate.x, plate.y], 'the warm plate suits a cold coil');
  // A warm valve held over the warm plate (taken): it goes to the floor, and a hot one to the chiller.
  valve.held = true;
  valve.T = 49;
  Object.assign(s.player, { x: chiller.x, y: chiller.y });
  tap(s, 'Space');
  assert.deepEqual([valve.x, valve.y], [chiller.x, chiller.y], 'the chiller suits a warm valve');
});

test('a held part whose pad is taken is told to set it on bare floor', () => {
  const s = stage(index('Four Square'));
  const pads = snapshot(s).pads;
  const chiller = pads.find((p) => p.ch === 'C');
  const [, valve, coil] = s.comps;
  put(coil, 0, 0, -50);
  Object.assign(coil, { x: chiller.x, y: chiller.y }); // the coil lies on the chiller
  valve.held = true;
  valve.T = 49;
  Object.assign(s.player, { x: 200, y: 200 });
  settle(s);
  assert.equal(s.prompt.key, 'padBusy');
  assert.match(snapshot(s).prompt.en, /^Valve 49C: chiller busy\. Space: put on bare floor/);
  assert.match(snapshot(s).prompt.zh, /阀门49度：冷却台被占用，空格放空地/);
});
