import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createRiverState, stepRiver, riverLanes } from '../src/games/river-hop.js';
import { harness, input, mockContext } from './harness.js';
test('river hop moves one grid cell and stays inside edges', () => {
  const s = createRiverState();
  s.lanes.find((l) => l.row === 8).objects = [];
  stepRiver(s, 0.01, input([], ['ArrowUp']));
  assert.equal(s.frog.row, 8);
  for (let i = 0; i < 30; i++) {
    s.hopCooldown = 0;
    stepRiver(s, 0, input([], ['ArrowLeft']));
  }
  assert(s.frog.x >= 12);
  assert.equal(riverLanes(3).length, 7);
});
test('river vehicle collisions and drowning consume lives', () => {
  for (const row of [6, 2]) {
    const s = createRiverState();
    s.frog = { x: 240, row };
    s.lanes = s.lanes.map((l) => ({
      ...l,
      objects: l.row === row ? (row === 6 ? [{ x: 240, w: 40 }] : []) : l.objects,
    }));
    stepRiver(s, 0.01, input());
    assert.equal(s.lives, 3);
    assert.equal(s.frog.row, 9);
  }
});
test('river logs carry the frog, home scores and round advances', () => {
  const s = createRiverState();
  s.frog = { x: 200, row: 2 };
  const lane = s.lanes.find((l) => l.row === 2);
  lane.objects = [{ x: 170, w: 100 }];
  const x = s.frog.x;
  stepRiver(s, 0.03, input());
  assert.notEqual(s.frog.x, x);
  for (let i = 0; i < 4; i++) {
    s.frog = { x: 60 + i * 120, row: 0 };
    s.hopCooldown = 0;
    stepRiver(s, 0, input());
  }
  assert.equal(s.round, 2);
  assert(s.score >= 1000);
  assert.equal(s.homes.length, 0);
});
test('river filled home and timeout hurt; final homes win', () => {
  const s = createRiverState();
  s.homes = [0];
  s.frog = { x: 60, row: 0 };
  stepRiver(s, 0, input());
  assert.equal(s.lives, 3);
  s.invulnerable = 0;
  s.timeLeft = 0;
  stepRiver(s, 0.01, input());
  assert.equal(s.lives, 2);
  const q = createRiverState();
  q.round = 3;
  q.homes = [0, 1, 2];
  q.frog = { x: 420, row: 0 };
  stepRiver(q, 0, input());
  assert.equal(q.phase, 'won');
});
test('river game ends once without input and resets cleanly', () => {
  const h = harness({ lang: 'zh' }),
    g = createGame(h.env);
  for (let i = 0; i < 14000; i++) {
    g.update(1 / 30, input());
    if (i % 400 === 0) g.draw(mockContext());
  }
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().round, 1);
});

test('legal timed hops fill every home in all three rounds without losing a life', () => {
  const keys = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: null };
  // A time-expanded route planner observes the public snapshot; only keyboard events change the game.
  function route(s, home) {
    const queue = [{ x: s.frog.x, row: s.frog.row, t: 0, path: [] }],
      seen = new Set();
    for (let i = 0; i < queue.length && i < 150000; i++) {
      const node = queue[i];
      if (node.t >= 240) continue;
      for (const action of ['U', 'L', 'R', 'W', 'D']) {
        let x = node.x + (action === 'L' ? -24 : action === 'R' ? 24 : 0),
          row = node.row + (action === 'U' ? -1 : action === 'D' ? 1 : 0);
        if (row < 0 || row > 9 || x < 12 || x > 468) continue;
        if (row === 0) {
          if (Math.abs(x - (home * 120 + 60)) < 40) return [...node.path, action];
          continue;
        }
        const lane = s.lanes.find((l) => l.row === row);
        let safe = true;
        for (let frame = 1; frame <= 9; frame++) {
          const t = (node.t * 9 + frame) / 60;
          if (lane) {
            const objects = lane.objects.map((o) => {
              let px = o.x + lane.speed * t;
              while (px > 480 + o.w) px -= 480 + 2 * o.w;
              while (px < -o.w) px += 480 + 2 * o.w;
              return { x: px, w: o.w };
            });
            const support = objects.find((o) => x + 7 > o.x && x - 7 < o.x + o.w);
            if (lane.water) {
              if (!support) {
                safe = false;
                break;
              }
              x += lane.speed / 60;
              if (x < 8 || x > 472) {
                safe = false;
                break;
              }
            } else if (support) {
              safe = false;
              break;
            }
          }
        }
        if (!safe) continue;
        const id = `${row}:${Math.round(x / 4)}:${node.t + 1}`;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push({ x, row, t: node.t + 1, path: [...node.path, action] });
      }
    }
    return null;
  }
  const h = harness(),
    g = createGame(h.env);
  let trips = 0;
  while (g.getState().phase === 'playing' && trips++ < 12) {
    while (g.getState().hopCooldown > 0) g.update(1 / 60, input());
    const s = g.getState(),
      home = [0, 1, 2, 3].find((i) => !s.homes.includes(i)),
      path = route(s, home);
    assert(path, `A safe route exists for round ${s.round}, home ${home}`);
    for (const action of path)
      for (let frame = 0; frame < 9; frame++)
        g.update(1 / 60, input([], frame === 0 && keys[action] ? [keys[action]] : []));
  }
  assert.equal(g.getState().phase, 'won');
  assert.equal(g.getState().round, 3);
  assert.equal(g.getState().lives, 4);
  assert.equal(h.ends.length, 1);
  assert(h.ends[0].won);
});
