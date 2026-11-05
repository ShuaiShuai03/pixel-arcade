import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createDungeonState,
  stepDungeon,
  buildRoom,
} from '../src/games/dungeon-dash.js';
import { harness, input, mockContext } from './harness.js';
test('Dungeon all room keys and exits are reachable by flood fill', () => {
  for (let room = 1; room <= 5; room++) {
    const r = buildRoom(room);
    const seen = new Set(['2,11']);
    const q = [[2, 11]];
    for (let k = 0; k < q.length; k++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [x, y] = [q[k][0] + dx, q[k][1] + dy];
        if (r.tiles[y]?.[x] !== undefined && r.tiles[y][x] !== 1 && !seen.has(`${x},${y}`)) {
          seen.add(`${x},${y}`);
          q.push([x, y]);
        }
      }
    assert.ok(seen.has('2,2'));
    assert.ok(seen.has('19,1'));
  }
});
test('Dungeon walls stop movement and melee defeats nearby enemies', () => {
  const { env } = harness();
  const s = createDungeonState(env);
  s.player.x = 48;
  s.player.y = 60;
  stepDungeon(s, 1 / 30, input(['ArrowLeft']), env);
  assert.ok(s.player.x >= 47);
  s.enemies = [{ x: s.player.x + 20, y: s.player.y, hp: 1, speed: 0, hit: 0 }];
  stepDungeon(s, 1 / 30, input([], ['Space']), env);
  assert.equal(s.enemies.length, 0);
  assert.ok(s.score >= 100);
});
test('Dungeon key unlocks next room only after clearing enemies', () => {
  const { env } = harness();
  const s = createDungeonState(env);
  s.enemies = [];
  s.player.x = s.key.x;
  s.player.y = s.key.y;
  stepDungeon(s, 1 / 60, input(), env);
  assert.equal(s.hasKey, true);
  s.player.x = s.exit.x;
  s.player.y = s.exit.y;
  stepDungeon(s, 1 / 60, input(), env);
  assert.equal(s.room, 2);
  assert.equal(s.hasKey, false);
});
test('Dungeon loss and final exit are terminal', () => {
  for (const win of [false, true]) {
    const { env, ends } = harness();
    const s = createDungeonState(env);
    if (win) {
      s.room = 5;
      s.hasKey = true;
      s.enemies = [];
      s.player.x = s.exit.x;
      s.player.y = s.exit.y;
    } else s.health = 0;
    stepDungeon(s, 1 / 60, input(), env);
    assert.equal(s.phase, win ? 'won' : 'lost');
    assert.equal(ends.length, 1);
  }
  const { env } = harness();
  const g = createGame(env);
  g.draw(mockContext());
  assert.equal(g.getState().room, 1);
});
function dungeonPath(s, goal) {
  const start = [Math.floor((s.player.x - 20) / 20), Math.floor((s.player.y - 30) / 20)];
  const target = [Math.floor((goal.x - 20) / 20), Math.floor((goal.y - 30) / 20)];
  const q = [start],
    parents = new Map([[start.join(','), null]]);
  for (let k = 0; k < q.length; k++) {
    const p = q[k];
    if (p[0] === target[0] && p[1] === target[1]) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = [p[0] + dx, p[1] + dy],
        key = n.join(',');
      if (s.tiles[n[1]]?.[n[0]] === 0 && !parents.has(key)) {
        parents.set(key, p);
        q.push(n);
      }
    }
  }
  let next = target;
  while (parents.get(next.join(',')) && parents.get(next.join(',')).join(',') !== start.join(','))
    next = parents.get(next.join(','));
  return next;
}
test('Dungeon can clear five full rooms with legal movement and attacks', () => {
  const { env, ends } = harness();
  const g = createGame(env);
  let maxRoom = 1;
  for (let frame = 0; frame < 60000 && g.getState().phase === 'playing'; frame++) {
    const s = g.getState();
    maxRoom = Math.max(maxRoom, s.room);
    const enemies = [...s.enemies].sort(
      (a, b) =>
        Math.hypot(a.x - s.player.x, a.y - s.player.y) -
        Math.hypot(b.x - s.player.x, b.y - s.player.y),
    );
    const nearest = enemies[0];
    let goal = nearest || (!s.hasKey ? s.key : s.exit);
    const keys = ['Space'];
    const d = nearest ? Math.hypot(nearest.x - s.player.x, nearest.y - s.player.y) : 1000;
    if (d > 31) {
      const cell = dungeonPath(s, goal);
      let tx = 30 + cell[0] * 20,
        ty = 40 + cell[1] * 20;
      const sx = Math.floor((s.player.x - 20) / 20),
        sy = Math.floor((s.player.y - 30) / 20);
      if (sx === cell[0] && sy === cell[1]) {
        tx = goal.x;
        ty = goal.y;
      }
      if (Math.abs(tx - s.player.x) > 2) keys.push(tx > s.player.x ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(ty - s.player.y) > 2) keys.push(ty > s.player.y ? 'ArrowDown' : 'ArrowUp');
    }
    g.update(1 / 60, input(keys));
  }
  assert.equal(
    g.getState().phase,
    'won',
    `reached room ${maxRoom}, health ${g.getState().health}, pos ${JSON.stringify(g.getState().player)}`,
  );
  assert.equal(ends.length, 1);
  assert.ok(g.getState().kills >= 25);
});
