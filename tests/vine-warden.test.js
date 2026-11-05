import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVADERS,
  PLOTS,
  PROMPTS,
  RULES,
  advance,
  createGame,
  loadPlot,
  meta,
  newState,
  render,
} from '../src/games/vine-warden.js';
import { harness, input, mockContext, seeded } from './harness.js';

const TICK = 1 / 120;
const GROWN = RULES.stageTicks * 3;

function run(s, ticks, held = [], pressed = []) {
  for (let i = 0; i < ticks; i++) advance(s, TICK, input(held, i === 0 ? pressed : []));
}
const secs = (n) => Math.round(n * 120);
function addPlant(s, c, r, age = GROWN, charges = RULES.charges) {
  const plant = { id: s.nextId++, c, r, age, bloomTicks: 0, charges, grip: null };
  s.plants.push(plant);
  s.rootVer++;
  return plant;
}
function addPest(s, kind, c, r) {
  const pest = {
    id: s.nextId++,
    kind,
    c,
    r,
    tc: c,
    tr: r,
    left: 0,
    hp: INVADERS[kind].hp,
    held: null,
    bite: 0,
    plan: null,
    prev: null,
    dead: false,
  };
  s.invaders.push(pest);
  return pest;
}
// A quiet plot: no pest is ever scheduled, so a test places exactly the pests it studies.
function quiet(index = 0) {
  const s = newState();
  loadPlot(s, index);
  s.plotTicks = -1e9;
  return s;
}
// A plot whose last pest has already been dealt with.
function finished(index = 0) {
  const s = quiet(index);
  s.plotTicks = 0;
  s.spawned = PLOTS[index].spawns.length;
  return s;
}
const face = (s, dx, dy) => Object.assign(s.player.facing, { dx, dy });

test('meta follows the contract and every control has a touch button', () => {
  assert.equal(meta.id, 'vine-warden');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  assert.deepEqual(meta.name, { en: 'Vine Warden', zh: '藤蔓守卫' });
  assert.ok(meta.description.en.length > 100 && meta.description.zh.length > 40);
  const codes = meta.touchControls.map((b) => b.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX']) {
    assert.ok(codes.includes(code), code);
  }
  assert.ok(meta.touchControls.every((b) => b.label.en && b.label.zh));
  assert.ok(meta.keys.length >= 3);
});

test('maps are 20x11, reachable, and give every plot soil beside the pest path', () => {
  PLOTS.forEach((plot, index) => {
    const s = quiet(index);
    assert.equal(plot.map.length, 11);
    assert.ok(plot.map.every((row) => row.length === 20));
    assert.ok(s.usefulSoil.length >= 8, `plot ${index + 1} soil`);
    assert.ok(s.gates.length >= 1 && plot.spawns.every((e) => s.gates[e[1]]));
    for (const g of s.gates) {
      const seen = new Set([`${g.c},${g.r}`]);
      const queue = [g];
      for (let i = 0; i < queue.length; i++) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const c = queue[i].c + dx;
          const r = queue[i].r + dy;
          if (!'.Gh'.includes(plot.map[r]?.[c] ?? '#') || seen.has(`${c},${r}`)) continue;
          seen.add(`${c},${r}`);
          queue.push({ c, r });
        }
      }
      assert.ok(seen.has(`${s.heart.c},${s.heart.r}`), 'gate reaches the bloom');
    }
    assert.ok(!'#h'.includes(plot.map[plot.start.r][plot.start.c]));
  });
});

test('invalid dt is inert and does not consume the buffered action', () => {
  const s = newState();
  face(s, 0, -1);
  const before = JSON.stringify(s);
  for (const dt of [0, -1, NaN, Infinity, 0.5]) {
    assert.equal(advance(s, dt, input(['ArrowUp'], ['Space', 'KeyX'])), false);
  }
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.latch.plant, 0);
  run(s, 3);
  assert.equal(s.plants.length, 0, 'the rejected Space press was not remembered');
  assert.equal(advance(s, TICK, input([], ['Space'])), true);
  assert.equal(s.plants.length, 1);
});

test('full game state is identical at 30, 60 and 120 Hz for aligned input', () => {
  const script = (frame30) => {
    if (frame30 < 6) return { held: ['ArrowUp'], pressed: [] };
    if (frame30 === 8) return { held: [], pressed: ['Space'] };
    if (frame30 < 20) return { held: ['KeyD'], pressed: [] };
    if (frame30 === 30) return { held: [], pressed: ['KeyX'] };
    return {
      held: frame30 % 40 < 12 ? ['ArrowDown'] : [],
      pressed: frame30 === 90 ? ['Space'] : [],
    };
  };
  const finals = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ seed: 5 }).env);
    const per = hz / 30;
    for (let f = 0; f < 30 * 40; f++) {
      const { held, pressed } = script(f);
      for (let k = 0; k < per; k++) g.update(1 / hz, input(held, k === 0 ? pressed : []));
    }
    return JSON.stringify(g.getState());
  });
  assert.equal(finals[0], finals[1]);
  assert.equal(finals[1], finals[2]);
  assert.ok(JSON.parse(finals[0]).stats.planted >= 1);
});

test('tap turns without walking, a hold walks one tile per 0.15 s, and solids block', () => {
  const s = quiet();
  const start = { c: s.player.c, r: s.player.r };
  run(s, 6, ['ArrowUp']);
  assert.deepEqual([s.player.c, s.player.r], [start.c, start.r]);
  assert.deepEqual(s.player.facing, { dx: 0, dy: -1 });
  const walker = quiet();
  Object.assign(walker.player, { c: 2, r: 5, from: { c: 2, r: 5 } });
  run(walker, secs(0.45), ['ArrowRight']);
  assert.equal(walker.player.c - 2, 3, 'three tiles in 0.45 s');
  assert.ok(walker.player.moving === undefined && walker.player.left >= 0);
  // Walls stop the gardener and WASD works the same way.
  const t = quiet();
  Object.assign(t.player, { c: 3, r: 1, from: { c: 3, r: 1 } });
  run(t, 40, ['KeyW']);
  assert.equal(t.player.r, 1);
  run(t, 40, ['KeyA', 'KeyD']);
  assert.equal(t.player.c, 3, 'opposite keys cancel');
  run(t, 40, ['ArrowRight', 'ArrowDown']);
  assert.ok(t.player.c > 3 || t.player.r > 1);
  // Plants and the garden bloom block movement.
  const u = quiet();
  addPlant(u, 7, 5, 0);
  face(u, 1, 0);
  Object.assign(u.player, { c: 6, r: 5, from: { c: 6, r: 5 } });
  run(u, 60, ['ArrowRight']);
  assert.equal(u.player.c, 6);
  Object.assign(u.player, { c: 18, r: 7, from: { c: 18, r: 7 } });
  run(u, 60, ['ArrowRight']);
  assert.equal(u.player.c, 18, 'the bloom is solid');
});

test('seeds only go into visibly suitable soil and never into occupied or unaffordable tiles', () => {
  const s = quiet();
  face(s, 1, 0);
  run(s, 2, [], ['Space']);
  assert.equal(s.seeds, 3);
  assert.match(s.message.en, /brown soil/);
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  run(s, 2, [], ['Space']);
  assert.equal(s.seeds, 2);
  assert.equal(s.plants.length, 1);
  run(s, 2, [], ['Space']);
  assert.equal(s.seeds, 2);
  assert.match(s.message.en, /already/);
  s.seeds = 0;
  face(s, 0, 1);
  Object.assign(s.player, { c: 6, r: 3 });
  run(s, 2, [], ['Space']);
  assert.match(s.message.en, /No seeds/);
  assert.equal(s.plants.length, 1);
  face(s, 0, -1);
  assert.equal(s.player.facing.dy, -1);
  // The row-3 path is not plantable.
  face(s, 1, 0);
  s.seeds = 3;
  run(s, 2, [], ['Space']);
  assert.equal(s.plants.length, 1);
});

test('a planted seed passes through stated stages and only blooms after 6 seconds', () => {
  const s = quiet();
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  run(s, 1, [], ['Space']);
  const plant = s.plants[0];
  const stages = [];
  for (let t = 0; t < 6.05; t += 0.5) {
    stages.push([t, Math.min(3, Math.floor(plant.age / RULES.stageTicks))]);
    run(s, secs(0.5));
  }
  const at = (t) => stages.find(([x]) => x === t)[1];
  assert.deepEqual([at(0), at(1.5), at(2), at(3.5), at(4), at(5.5), at(6)], [0, 0, 1, 1, 2, 2, 3]);
  const game = createGame(harness().env);
  game.update(1 / 60, input([], ['Space']));
  assert.equal(game.getState().plants.length, 0, 'the first tile faced is a walkway');
});

test('growth delay: a fresh plant cannot trap a pest standing on its roots', () => {
  const s = quiet();
  addPlant(s, 6, 2, 0);
  const pest = addPest(s, 'beetle', 6, 3);
  pest.plan = { c: 6, r: 3 };
  pest.left = 0;
  run(s, secs(1));
  assert.equal(pest.held, null);
  assert.equal(pest.hp, INVADERS.beetle.hp);
  assert.equal(s.plants[0].charges, RULES.charges);
});

test('seedlings, sprouts and buds never hold or damage a pest', () => {
  for (const age of [0, RULES.stageTicks, RULES.stageTicks * 2, GROWN - 2]) {
    const s = quiet();
    const plant = addPlant(s, 6, 2, age);
    const pest = addPest(s, 'weevil', 6, 3);
    run(s, secs(1.5));
    if (age < GROWN - 2) {
      assert.equal(plant.grip, null);
      assert.equal(pest.hp, 3);
    }
    assert.equal(s.stats.caught, 0);
  }
});

test('a bloom holds a pest in reach, bites every 0.8 s and catches it for a score', () => {
  const s = quiet();
  const plant = addPlant(s, 6, 2);
  const pest = addPest(s, 'beetle', 7, 3);
  run(s, 2);
  assert.equal(pest.held, plant.id);
  assert.equal(plant.grip, pest.id);
  run(s, secs(0.7));
  assert.equal(pest.hp, 2, 'no bite before 0.8 s');
  run(s, secs(0.2));
  assert.equal(pest.hp, 1);
  assert.equal(plant.charges, 3);
  const tile = [pest.c, pest.r];
  run(s, secs(0.8));
  assert.deepEqual(s.invaders, []);
  assert.equal(s.score, RULES.catchScore);
  assert.equal(plant.charges, 2);
  assert.equal(plant.grip, null);
  assert.equal(s.stats.caught, 1);
  assert.match(s.message.en, /caught/);
  assert.deepEqual(tile, [7, 3]);
});

test('roots reach the 3x3 tiles around a bloom and one bloom holds one pest at a time', () => {
  const s = quiet();
  const plant = addPlant(s, 6, 2);
  const outside = addPest(s, 'beetle', 8, 3);
  run(s, 4);
  assert.equal(outside.held, null, 'two tiles away is out of reach');
  const diag = addPest(s, 'beetle', 5, 3);
  run(s, 2);
  assert.equal(diag.held, plant.id, 'diagonal tiles are covered');
  s.invaders.splice(s.invaders.indexOf(outside), 1);
  const second = addPest(s, 'beetle', 7, 3);
  run(s, 4);
  assert.equal(second.held, null, 'the grip is busy');
  assert.equal(second.left > 0 || second.c !== 7, true, 'the second pest keeps moving on');
});

test('spent roots release a surviving pest and the plant wilts for a smaller harvest', () => {
  const s = quiet();
  const plant = addPlant(s, 6, 2, GROWN, 1);
  const pest = addPest(s, 'weevil', 6, 3);
  run(s, 2);
  run(s, secs(0.85));
  assert.equal(plant.charges, 0);
  assert.equal(pest.hp, 2);
  assert.equal(pest.held, null);
  assert.equal(plant.grip, null);
  assert.match(s.message.en, /Roots spent/);
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  s.seeds = 1;
  run(s, 1, [], ['KeyX']);
  assert.equal(s.seeds, 1 + RULES.harvestSpent);
  assert.equal(s.plants.length, 0);
});

test('harvesting returns seeds by the stated rule and rejects every illegal harvest', () => {
  const s = quiet();
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  run(s, 1, [], ['KeyX']);
  assert.match(s.message.en, /Nothing/);
  const plant = addPlant(s, 6, 2, GROWN - secs(2.5));
  run(s, 1, [], ['KeyX']);
  assert.match(s.message.en, /Still growing: 3s left/);
  assert.equal(s.plants.length, 1);
  run(s, secs(2.6));
  plant.grip = 99;
  run(s, 1, [], ['KeyX']);
  assert.match(s.message.en, /holding/);
  plant.grip = null;
  s.seeds = RULES.seedCap - 1;
  run(s, 1, [], ['KeyX']);
  assert.match(s.message.en, /pouch full/);
  assert.equal(s.plants.length, 1);
  s.seeds = 0;
  run(s, 1, [], ['KeyX']);
  assert.equal(s.seeds, RULES.harvestFull);
  assert.equal(s.stats.harvested, 1);
  assert.equal(s.plants.length, 0);
});

test('seed supply is sustainable: a plant always returns at least the seed it cost', () => {
  const s = quiet();
  s.seeds = 1;
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  for (let cycle = 0; cycle < 5; cycle++) {
    run(s, 1, [], ['Space']);
    assert.equal(s.seeds, cycle);
    run(s, secs(6.1));
    run(s, 1, [], ['KeyX']);
    assert.equal(s.seeds, cycle + 2);
  }
  // Out of seeds with only an unripe plant on the field is a short wait, never a dead end.
  const t = quiet();
  t.seeds = 0;
  addPlant(t, 6, 2, 0);
  Object.assign(t.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(t, 0, -1);
  run(t, secs(6.1));
  run(t, 1, [], ['KeyX']);
  assert.equal(t.seeds, 2);
});

test('seeds plus plants never decrease over seeded random play in every plot', () => {
  for (let index = 0; index < PLOTS.length; index++) {
    const s = newState();
    loadPlot(s, index);
    const rnd = seeded(40 + index);
    let floor = s.seeds;
    const all = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    for (let n = 0; n < 4000 && s.phase === 'playing' && s.plot === index; n++) {
      const held = rnd() < 0.7 ? [all[Math.floor(rnd() * 4)]] : [];
      const pressed = rnd() < 0.2 ? [rnd() < 0.5 ? 'Space' : 'KeyX'] : [];
      for (let k = 0; k < 20; k++) advance(s, TICK * 6, input(held, k ? [] : pressed));
      assert.ok(s.seeds + s.plants.length >= floor, 'a plant is worth at least its seed');
      assert.ok(s.seeds <= RULES.seedCap && s.seeds >= 0);
      floor = s.seeds + s.plants.length;
    }
  }
});

test('wary weevils route around live roots while beetles walk straight in', () => {
  const lanes = (kind, withRoots, oddId = false) => {
    const s = quiet(1);
    s.nextId = oddId ? 21 : 20;
    if (withRoots) addPlant(s, 8, 7);
    const pest = addPest(s, kind, 4, 5);
    pest.prev = { c: 3, r: 5 };
    run(s, secs(0.1));
    return pest.tr;
  };
  assert.equal(lanes('weevil', false), 6, 'an even weevil takes the lower lane of an even fork');
  assert.equal(lanes('weevil', false, true), 4, 'an odd weevil takes the upper lane');
  assert.equal(lanes('weevil', true), 4, 'roots on the lower lane send it up');
  assert.equal(lanes('beetle', true), 6, 'beetles do not avoid roots');
  assert.equal(lanes('beetle', false, true), 6, 'beetles always break ties downwards');
  // A lane with several blooms is not worse than one bloom: both are rooted, so weevils alternate.
  const heavy = (oddId) => {
    const s = quiet(1);
    s.nextId = oddId ? 31 : 30;
    [8, 9, 10].forEach((c) => addPlant(s, c, 3));
    addPlant(s, 8, 7);
    const pest = addPest(s, 'weevil', 4, 5);
    pest.prev = { c: 3, r: 5 };
    run(s, secs(0.1));
    return pest.tr;
  };
  assert.deepEqual([heavy(false), heavy(true)], [6, 4], 'capped detour cost ties rooted lanes');
});

test('pests never overlap, wait for a claimed tile and hold the gate until it is free', () => {
  const s = newState();
  for (let n = 0; n < secs(40); n++) {
    advance(s, TICK, input([]));
    const tiles = s.invaders.map((v) => `${v.c},${v.r}`);
    assert.equal(new Set(tiles).size, tiles.length);
    for (const v of s.invaders) {
      for (const u of s.invaders) {
        if (u !== v && u.left > 0) assert.notDeepEqual([u.tc, u.tr], [v.c, v.r]);
      }
    }
  }
  const t = quiet();
  t.spawned = 0;
  const gate = t.gates[0];
  const blocker = addPest(t, 'beetle', gate.c, gate.r);
  blocker.plan = { c: gate.c, r: gate.r };
  t.plotTicks = secs(PLOTS[0].spawns[0][0]) + 5;
  advance(t, TICK, input([]));
  assert.equal(t.spawned, 0, 'no spawn onto an occupied gate');
});

test('pests head to the bloom by the shortest path, never turning back', () => {
  const s = quiet();
  const pest = addPest(s, 'hopper', 0, 3);
  const seen = [];
  for (let n = 0; n < secs(12) && s.invaders.length; n++) {
    advance(s, TICK, input([]));
    if (!seen.length || seen.at(-1) !== `${pest.c},${pest.r}`) seen.push(`${pest.c},${pest.r}`);
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(s.health, PLOTS[0].health - 1);
  assert.equal(s.invaders.length, 0);
});

test('routing falls back safely at dead ends and unreachable tiles', () => {
  const s = quiet();
  const dead = addPest(s, 'beetle', 0, 3);
  dead.prev = { c: 1, r: 3 };
  run(s, secs(0.1));
  assert.deepEqual([dead.tc, dead.tr], [1, 3], 'turns back only when it is the sole way');
  const lost = addPest(s, 'beetle', 5, 5);
  run(s, 20);
  assert.equal(lost.left, 0, 'a pest off the path simply waits');
});

test('a pest at the bloom costs one health, flashes the bloom and ends the plot at zero', () => {
  const h = harness();
  const g = createGame(h.env);
  const s = quiet();
  s.health = 2;
  const pest = addPest(s, 'beetle', 18, 7);
  run(s, secs(0.7));
  assert.equal(s.health, 1);
  assert.equal(s.stats.leaked, 1);
  assert.ok(s.heartFlash > 0 && !s.invaders.includes(pest));
  assert.match(s.message.zh, /花心/);
  addPest(s, 'beetle', 18, 7);
  run(s, secs(0.7));
  assert.equal(s.phase, 'lost');
  assert.equal(s.health, 0);
  assert.equal(g.getState().phase, 'playing');
});

test('loss: callback fires once, the world freezes, and a new instance starts fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  for (let i = 0; i < 60 * 80 && !h.ends.length; i++) g.update(1 / 60, input([]));
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.ends[0].message.length > 10);
  assert.ok(h.sounds.includes('lose'));
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 120; i++) g.update(1 / 60, input(['ArrowUp'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.equal(g.getState().prompt.key, 'lost');
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.plot, 1);
  assert.equal(fresh.seeds, PLOTS[0].seeds);
  assert.equal(fresh.score, 0);
});

test('clearing a plot pays out, shows a visible countdown and starts the next garden fresh', () => {
  const s = finished();
  addPlant(s, 6, 2);
  s.seeds = 0;
  run(s, 2);
  assert.ok(s.clear >= RULES.clearTicks - 2);
  assert.equal(s.score, RULES.plotScore + RULES.healthScore * 5);
  run(s, 6);
  assert.equal(s.shownKey, 'saved');
  assert.match(s.message.en, /Plot 1 saved/);
  run(s, secs(1));
  assert.equal(
    s.plants[0].age > GROWN - 1,
    true,
    'plants keep growing while the garden is celebrated',
  );
  run(s, secs(2.1));
  assert.equal(s.plot, 1);
  assert.equal(s.seeds, PLOTS[1].seeds);
  assert.equal(s.plants.length, 0);
  assert.equal(s.health, PLOTS[1].health);
  assert.equal(s.invaders.length, 0);
  assert.equal(s.shownKey, 'intro2');
});

test('win: finishing the third plot is terminal and the score counts remaining health', () => {
  const done = finished(2);
  done.health = 3;
  run(done, 2);
  assert.equal(done.phase, 'won');
  assert.equal(done.score, RULES.plotScore + 3 * RULES.healthScore);
  const frozen = JSON.stringify(done);
  assert.equal(advance(done, TICK, input(['ArrowUp'], ['Space'])), false);
  assert.equal(JSON.stringify(done), frozen);
});

test('status strings are bilingual, include the event message, and track resources', () => {
  const g = createGame(harness().env);
  const first = g.getState();
  assert.equal(typeof first.status.en, 'string');
  assert.equal(typeof first.status.zh, 'string');
  assert.match(first.status.en, /^Plot 1\/3 · Seeds 3 · Health 5 · Plot 1: Seedling Row · /);
  assert.match(first.status.zh, /^花圃 1\/3 · 种子 3 · 生命 5 · /);
  assert.match(first.status.zh, /育苗畦/);
  assert.deepEqual(first.hud, { top: [0, 28], bottom: [292, 320] });
  g.update(1 / 60, input(['ArrowUp'], ['Space']));
  const later = g.getState();
  assert.ok(later.status.en.length > 20);
  assert.equal(later.prompt.key, 'intro1');
  assert.match(PROMPTS[later.prompt.key][0], /Space/);
});

test('prompts follow the situation and always name a key', () => {
  const s = quiet();
  const key = () => {
    s.shownSince = -1e9;
    s.ticks = 6;
    run(s, 6);
    return s.shownKey;
  };
  s.plotTicks = secs(7);
  assert.equal(key(), 'plant');
  s.seeds = 0;
  addPlant(s, 8, 2, 0);
  assert.equal(key(), 'wait');
  s.plants.length = 0;
  addPlant(s, 6, 2);
  assert.equal(key(), 'harvestNone');
  s.plants[0].charges = 0;
  assert.equal(key(), 'harvestSpent');
  s.plants[0].charges = RULES.charges;
  s.plants[0].grip = 7;
  assert.equal(key(), 'hold');
  s.plants[0].grip = null;
  s.seeds = 2;
  s.usefulSoil.forEach(
    (t) => !s.plants.some((p) => p.c === t.c && p.r === t.r) && addPlant(s, t.c, t.r, 0),
  );
  assert.equal(key(), 'harvestFull');
  const g = createGame(harness().env);
  const state = g.getState();
  assert.equal(state.prompt.en, PROMPTS.intro1[0]);
  const wait = { ...PROMPTS.wait };
  assert.ok(PROMPTS.wait[0].includes('{n}') && wait);
});

test('the prompt never changes more than once per 0.6 s outside plot changes', () => {
  const s = newState();
  const rnd = seeded(8);
  let last = s.shownKey;
  let since = 0;
  for (let n = 0; n < secs(60); n++) {
    const held = rnd() < 0.5 ? ['ArrowDown'] : ['ArrowUp'];
    advance(s, TICK, input(held, n % 97 === 0 ? ['Space'] : n % 131 === 0 ? ['KeyX'] : []));
    if (s.shownKey !== last) {
      if (!s.shownKey.startsWith('intro') && s.shownKey !== 'saved' && !last.startsWith('intro')) {
        assert.ok(
          n - since >= RULES.promptHoldTicks - 6,
          `${last} -> ${s.shownKey} after ${n - since}`,
        );
      }
      last = s.shownKey;
      since = n;
    }
  }
});

test('seeded random play stays finite and every array stays bounded', () => {
  for (const seed of [1, 2, 3]) {
    const h = harness({ seed });
    const g = createGame(h.env);
    const rnd = seeded(seed + 100);
    const all = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA'];
    let held = [];
    for (let i = 0; i < 60 * 240 && !h.ends.length; i++) {
      if (i % 20 === 0) held = rnd() < 0.8 ? [all[Math.floor(rnd() * all.length)]] : [];
      g.update(1 / 60, input(held, rnd() < 0.08 ? [rnd() < 0.5 ? 'Space' : 'KeyX'] : []));
      if (i % 120 === 0) {
        const s = g.getState();
        const text = JSON.stringify(s);
        assert.ok(!/null,null|NaN|Infinity/.test(text));
        assert.ok(s.plants.length <= 40 && s.pests.length <= 20);
        assert.ok(s.seeds >= 0 && s.seeds <= RULES.seedCap);
      }
    }
    assert.ok(h.ends.length <= 1);
  }
});

test('drawing covers every stage, pest, state and language without throwing', () => {
  for (const lang of ['en', 'zh']) {
    const env = harness({ lang }).env;
    for (let index = 0; index < PLOTS.length; index++) {
      const s = quiet(index);
      [0, 1, 2, 3].forEach((stage, n) => {
        const spot = s.usefulSoil[n];
        addPlant(s, spot.c, spot.r, stage * RULES.stageTicks + 5);
      });
      const spent = s.usefulSoil[4];
      addPlant(s, spent.c, spent.r, GROWN, 0);
      const holder = s.plants[3];
      const t = holder.c === 0 ? { c: 1, r: holder.r } : { c: holder.c, r: holder.r + 1 };
      for (const kind of Object.keys(INVADERS)) {
        const pest = addPest(s, kind, t.c, t.r);
        pest.left = 10;
        pest.tc = t.c + 1;
        pest.tr = t.r;
        pest.hp = 1;
      }
      s.invaders[0].held = holder.id;
      holder.grip = s.invaders[0].id;
      s.fx.push({ x: 40, y: 80, vx: 0, vy: 0, life: 5, color: '#fff' });
      s.heartFlash = 5;
      for (const facing of [
        [1, 0],
        [-1, 0],
        [0, -1],
        [0, 1],
      ]) {
        face(s, facing[0], facing[1]);
        render(mockContext(), s, env);
      }
      s.player.act = 5;
      s.player.left = 7;
      s.player.facing.dx = -1;
      s.message = null;
      s.seeds = 0;
      render(mockContext(), s, env);
      s.phase = 'won';
      s.shownKey = 'won';
      render(mockContext(), s, env);
      s.clear = 200;
      s.shownKey = 'saved';
      render(mockContext(), s, env);
    }
    const g = createGame(env);
    g.draw(mockContext());
  }
});

test('hud draws the countdown to the next pest and the last-pest label', () => {
  const lines = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (x) => lines.push(x) : p in t ? t[p] : () => {}),
  });
  const s = newState();
  render(ctx, s, harness().env);
  assert.ok(lines.some((l) => /Next 8s/.test(l)));
  s.spawned = PLOTS[0].spawns.length;
  lines.length = 0;
  render(ctx, s, harness().env);
  assert.ok(lines.some((l) => /Last one/.test(l)));
});

test('wait countdown counts only plants that are still growing', () => {
  const s = quiet();
  s.plotTicks = secs(7);
  s.seeds = 0;
  const ripe = addPlant(s, 6, 2);
  ripe.grip = 9;
  addPlant(s, 8, 2, GROWN - secs(3.5));
  s.shownSince = -1e9;
  run(s, 6);
  assert.equal(s.shownKey, 'wait');
  const lines = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillText' ? (text) => lines.push(text) : p in t ? t[p] : () => {}),
  });
  render(ctx, s, harness().env);
  assert.ok(
    lines.some((l) => l === 'Plants are growing: bloom in 4s'),
    lines.join('|'),
  );
  assert.ok(!lines.some((l) => /bloom in 0s/.test(l)));
});

test('harvest copy is singular for one seed and plural for two', () => {
  const s = quiet();
  Object.assign(s.player, { c: 6, r: 3, from: { c: 6, r: 3 } });
  face(s, 0, -1);
  addPlant(s, 6, 2, GROWN, 0);
  run(s, 1, [], ['KeyX']);
  assert.equal(s.message.en, 'Harvested +1 seed');
  addPlant(s, 6, 2);
  run(s, 1, [], ['KeyX']);
  assert.equal(s.message.en, 'Harvested +2 seeds');
});

test('copy tells players that weevils dodge live roots', () => {
  assert.match(meta.description.en, /Weevils sense live roots/);
  assert.match(meta.description.zh, /象鼻虫/);
});

test('a bare lane is announced, drawn ahead of the pest, and ends once a root covers it', () => {
  const s = quiet(1);
  s.plotTicks = secs(7);
  const pest = addPest(s, 'beetle', 4, 5);
  pest.prev = { c: 3, r: 5 };
  const key = () => {
    s.shownSince = -1e9;
    s.ticks = 6;
    run(s, 6);
    return s.shownKey;
  };
  assert.equal(key(), 'bare');
  const drawn = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (p === 'fillRect' ? (...a) => drawn.push(a) : p in t ? t[p] : () => {}),
  });
  render(ctx, s, harness().env);
  assert.ok(drawn.length > 100);
  addPlant(s, 8, 7, 0);
  assert.equal(key(), 'plant', 'a growing plant already guards the beetle route');
  assert.match(PROMPTS.bare[0], /Space/);
});

test('an unused full bloom is flagged idle after 15 s and offered for harvest when seeds run out', () => {
  const s = quiet();
  s.plotTicks = secs(7);
  s.seeds = 0;
  const bloom = addPlant(s, 6, 2);
  bloom.bloomTicks = secs(14);
  const key = () => {
    s.shownSince = -1e9;
    s.ticks = 6;
    run(s, 6);
    return s.shownKey;
  };
  assert.equal(key(), 'harvestNone');
  run(s, secs(1.2));
  assert.equal(key(), 'harvestIdle');
  bloom.charges = 3;
  assert.equal(key(), 'harvestNone', 'a bloom that has bitten is not idle');
  render(mockContext(), s, harness().env);
  assert.ok(PROMPTS.harvestIdle[0].length <= 42);
});
