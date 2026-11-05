import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createDungeonState,
  stepDungeon,
  buildRoom,
  weaponSegment,
} from '../src/games/dungeon-dash.js';
import { harness, input, mockContext, seeded } from './harness.js';
function flood(tiles, start = [2, 11]) {
  const seen = new Set([start.join(',')]),
    q = [start];
  for (let k = 0; k < q.length; k++)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = q[k][0] + dx,
        y = q[k][1] + dy,
        key = `${x},${y}`;
      if (tiles[y]?.[x] === 0 && !seen.has(key)) {
        seen.add(key);
        q.push([x, y]);
      }
    }
  return seen;
}
const cellKey = (p) => [Math.floor((p.x - 20) / 20), Math.floor((p.y - 30) / 20)].join(',');
test('Dungeon required switches are reachable before gates and all objectives after opening', () => {
  for (let number = 1; number <= 5; number++) {
    const room = buildRoom(number),
      before = flood(room.tiles);
    if (room.lever) assert.ok(before.has(cellKey(room.lever)));
    if (room.gates.length)
      assert.equal(before.has(cellKey(room.key)), false, 'archive key is actually sealed');
    for (const gate of room.gates) room.tiles[gate.cy][gate.cx] = 0;
    const after = flood(room.tiles);
    assert.ok(after.has(cellKey(room.key)));
    assert.ok(after.has(cellKey(room.exit)));
    for (const enemy of room.enemies) assert.ok(after.has(cellKey(enemy)));
  }
});
test('Dungeon walls stop movement and melee defeats nearby enemies', () => {
  const { env } = harness();
  const s = createDungeonState(env);
  s.player.x = 48;
  s.player.y = 60;
  stepDungeon(s, 1 / 30, input(['ArrowLeft']), env);
  assert.ok(s.player.x >= 47);
  s.player.facing = 1;
  s.enemies = [{ x: s.player.x + 20, y: s.player.y, hp: 1, speed: 0, hit: 0 }];
  stepDungeon(s, 1 / 30, input([], ['Space']), env);
  for (let f = 0; f < 30; f++) stepDungeon(s, 1 / 120, input(), env);
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
function campaign(hz = 60, mistake = false) {
  const { env, ends } = harness();
  const g = createGame(env);
  let maxRoom = 1,
    opened = false,
    healed = false;
  for (let frame = 0; frame < hz * 600 && g.getState().phase === 'playing'; frame++) {
    const s = g.getState();
    if (mistake && !healed && s.health > 3) {
      g.update(1 / hz, input());
      continue;
    }
    if (mistake && s.health <= 3) healed = true;
    if (s.room === 3 && s.lever.on) opened = true;
    if (frame % 600 === 0) g.draw(mockContext());
    maxRoom = Math.max(maxRoom, s.room);
    if (s.enemies.length === 1) assert.ok(!s.status.en.includes('1 guardians'));
    const enemies = [...s.enemies].sort(
      (a, b) =>
        Math.hypot(a.x - s.player.x, a.y - s.player.y) -
        Math.hypot(b.x - s.player.x, b.y - s.player.y),
    );
    const nearest = enemies[0];
    const recovery =
      s.health < 4 && s.flasks === 0 ? (!s.shrine.used ? s.shrine : s.potions[0]) : null;
    const switchGoal = s.lever && !s.lever.on ? s.lever : null;
    let goal = recovery || switchGoal || nearest || (!s.hasKey ? s.key : s.exit);
    const keys = ['Space'];
    if ((recovery || switchGoal) && Math.hypot(goal.x - s.player.x, goal.y - s.player.y) < 26)
      keys.push('KeyE');
    if (s.health <= 3 && s.flasks > 0) keys.push('KeyH');
    const d =
      recovery || switchGoal
        ? 1000
        : nearest
          ? Math.hypot(nearest.x - s.player.x, nearest.y - s.player.y)
          : 1000;
    if (nearest && d < 75 && nearest.state === 'windup' && nearest.type === 'warden') {
      keys.push('KeyK');
      keys.push(s.player.x < nearest.x ? 'ArrowLeft' : 'ArrowRight');
      keys.push(s.player.y < nearest.y ? 'ArrowUp' : 'ArrowDown');
    } else if (d > 26) {
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
    } else if (nearest) {
      const tx = nearest.x - s.player.x,
        ty = nearest.y - s.player.y;
      const dot = tx * s.player.facing + ty * s.facingY;
      if (dot < d * 0.5)
        keys.push(
          Math.abs(tx) > Math.abs(ty)
            ? tx > 0
              ? 'ArrowRight'
              : 'ArrowLeft'
            : ty > 0
              ? 'ArrowDown'
              : 'ArrowUp',
        );
    }
    g.update(
      1 / hz,
      input(keys, [
        ...(keys.includes('KeyK') ? ['KeyK'] : []),
        ...(keys.includes('KeyE') ? ['KeyE'] : []),
        ...(keys.includes('KeyH') ? ['KeyH'] : []),
      ]),
    );
  }
  return { g, ends, maxRoom, opened, healed };
}
test('Dungeon complete campaign and ordinary missed-defense recovery work through public controls at 30/60/120Hz', () => {
  for (const hz of [30, 60, 120])
    for (const mistake of [false, true]) {
      const { g, ends, maxRoom, opened, healed } = campaign(hz, mistake);
      assert.equal(g.getState().phase, 'won', `rate ${hz}, mistake ${mistake}, room ${maxRoom}`);
      assert.equal(g.getState().kills, 20);
      assert.equal(ends.length, 1);
      assert.ok(opened);
      if (mistake) {
        assert.ok(healed);
        assert.ok(g.getState().drank > 0);
      }
      const final = g.getState();
      g.update(1 / hz, input(['ArrowLeft', 'Space'], ['KeyH']));
      assert.deepEqual(g.getState(), final);
    }
});

test('Dungeon rooms have distinct layouts, boss and telegraphed attacks', () => {
  const layouts = Array.from({ length: 5 }, (_, n) => JSON.stringify(buildRoom(n + 1).tiles));
  assert.equal(new Set(layouts).size, 5);
  const s = createDungeonState();
  assert.ok(s.enemies.every((e) => typeof e.state === 'string'));
  assert.ok(buildRoom(5).boss);
});
test('Dungeon swings face the enemy and holding attack cannot bypass recovery', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.enemies = [
    {
      x: s.player.x - 22,
      y: s.player.y,
      hp: 3,
      speed: 0,
      hit: 0,
      state: 'recover',
      timer: 10,
      type: 'guard',
    },
  ];
  stepDungeon(s, 1 / 60, input([], ['Space']), env);
  assert.equal(s.enemies[0].hp, 3, 'enemy behind sword arc is protected');
  assert.ok(s.stamina < 100);
});

test('Dungeon telegraphs give player time to dodge, shrine heals once and chest opens once', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.invulnerable = 0;
  s.enemies = [
    {
      x: s.player.x + 28,
      y: s.player.y,
      hp: 3,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'approach',
      timer: 0,
    },
  ];
  stepDungeon(s, 1 / 60, input(), env);
  assert.equal(s.enemies[0].state, 'windup');
  assert.equal(s.health, 5);
  s.health = 2;
  s.player.x = s.shrine.x;
  s.player.y = s.shrine.y;
  stepDungeon(s, 1 / 60, input([], ['KeyE']), env);
  assert.equal(s.health, 4);
  stepDungeon(s, 1 / 60, input([], ['KeyE']), env);
  assert.equal(s.health, 4);
  s.player.x = s.chest.x;
  s.player.y = s.chest.y;
  stepDungeon(s, 1 / 60, input([], ['KeyE']), env);
  const score = s.score;
  stepDungeon(s, 1 / 60, input([], ['KeyE']), env);
  assert.equal(s.score, score);
  assert.ok(s.chest.opened);
});
test('Dungeon dodging consumes stamina and respects cooldown', () => {
  const { env } = harness();
  const s = createDungeonState();
  stepDungeon(s, 1 / 120, input(['ArrowRight'], ['KeyK']), env);
  assert.ok(s.dash > 0);
  assert.ok(s.stamina < 80);
  const stamina = s.stamina;
  stepDungeon(s, 1 / 120, input([], ['KeyK']), env);
  assert.ok(s.stamina > stamina);
});

test('Dungeon movement uses bounded acceleration and a dodge has no magical invulnerability', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.invulnerable = 0;
  const x = s.player.x;
  stepDungeon(s, 1 / 120, input(['ArrowRight'], ['KeyK']), env);
  assert.ok(s.player.vx > 0 && s.player.vx < 30);
  assert.ok(s.player.x - x < 0.2);
  assert.equal(s.invulnerable, 0);
});
test('Dungeon sword has a real windup and cannot hit outside its visible forward sector', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.enemies = [
    {
      id: 'side',
      x: s.player.x,
      y: s.player.y - 30,
      hp: 3,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'recover',
      timer: 10,
    },
  ];
  stepDungeon(s, 1 / 120, input([], ['Space']), env);
  assert.equal(s.enemies[0].hp, 3);
  for (let f = 0; f < 30; f++) stepDungeon(s, 1 / 120, input(), env);
  assert.equal(s.enemies[0].hp, 3);
});
test('Dungeon inactive body contact does no damage, and a locked guard swing cannot hit behind', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.invulnerable = 0;
  s.player.x = 170;
  s.player.y = 180;
  s.enemies = [
    {
      id: 'guard',
      x: 195,
      y: 180,
      hp: 3,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'windup',
      timer: 0.001,
      aim: { x: 1, y: 0 },
      vx: 0,
      vy: 0,
    },
  ];
  for (let f = 0; f < 35; f++) stepDungeon(s, 1 / 120, input(), env);
  assert.equal(s.health, 5);
});
test('Dungeon expired and wall-blocked arrows cannot hurt the player', () => {
  const { env } = harness();
  const s = createDungeonState();
  s.invulnerable = 0;
  s.enemies = [];
  s.projectiles = [
    { x: s.player.x - 25, y: s.player.y, vx: 100, vy: 0, life: 0.001, active: true },
  ];
  stepDungeon(s, 1 / 30, input(), env);
  assert.equal(s.health, 5);
  assert.equal(s.projectiles.length, 0);
});
test('Dungeon carries healing supplies and full-health recovery is not wasted', () => {
  const { env } = harness();
  const s = createDungeonState();
  assert.equal(s.flasks, 1);
  stepDungeon(s, 1 / 120, input([], ['KeyH']), env);
  assert.equal(s.flasks, 1);
  s.health = 2;
  stepDungeon(s, 1 / 120, input([], ['KeyH']), env);
  assert.equal(s.health, 4);
  assert.equal(s.flasks, 0);
});
test('Dungeon chamber three has an actual sealed gate and reachable lever', () => {
  const room = buildRoom(3);
  assert.ok(room.lever);
  assert.ok(room.gates.length > 0);
  assert.ok(room.gates.every((g) => room.tiles[g.cy][g.cx] !== 0));
});

function arena() {
  const s = createDungeonState();
  s.tiles = Array.from({ length: 14 }, (_, y) =>
    Array.from({ length: 22 }, (_, x) => +(x === 0 || x === 21 || y === 0 || y === 13)),
  );
  s.enemies = [];
  s.hazards = [];
  s.projectiles = [];
  s.treasures = [];
  s.potions = [];
  s.player = { x: 100, y: 150, vx: 0, vy: 0, facing: 1 };
  s.invulnerable = 0;
  return s;
}
test('Dungeon status uses singular English resource labels', () => {
  const game = createGame(harness().env);
  assert.match(game.getState().status.en, /1 flask(?!s)/);
});
test('Dungeon fast movement cannot tunnel and ordinary motion slides along walls', () => {
  const { env } = harness();
  const s = arena();
  s.tiles[6][5] = 1;
  s.player.y = 160;
  s.player.vx = 10000;
  stepDungeon(s, 1 / 30, input(['ArrowRight']), env);
  assert.ok(s.player.x <= 112 + 1e-8);
  assert.ok(s.player.vx <= 1e-8);
  const y = s.player.y;
  for (let n = 0; n < 20; n++) stepDungeon(s, 1 / 120, input(['ArrowRight', 'ArrowDown']), env);
  assert.ok(s.player.y > y);
});
test('Dungeon solid actor contact cannot become a passive attack or pass through a guardian', () => {
  const { env } = harness();
  const s = arena();
  s.enemies = [
    {
      id: 'idle',
      x: 124,
      y: 150,
      vx: 0,
      vy: 0,
      hp: 5,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'recover',
      timer: 10,
    },
  ];
  for (let n = 0; n < 60; n++) {
    stepDungeon(s, 1 / 120, input(['ArrowRight']), env);
    assert.ok(s.enemies[0].x - s.player.x >= 15.9);
  }
  assert.equal(s.health, 5);
  assert.equal(s.enemies[0].hp, 5);
});
test('Dungeon sword strike gives bounded impulse knockback and damages once per swing', () => {
  const { env } = harness();
  const s = arena();
  s.enemies = [
    {
      id: 'target',
      x: 124,
      y: 150,
      vx: 0,
      vy: 0,
      hp: 5,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'recover',
      timer: 10,
    },
  ];
  stepDungeon(s, 1 / 120, input([], ['Space']), env);
  let struck = false;
  for (let n = 0; n < 44; n++) {
    const before = s.enemies[0].x;
    stepDungeon(s, 1 / 120, input(), env);
    assert.ok(Math.abs(s.enemies[0].x - before) < 2);
    if (s.enemies[0].hp < 5) {
      struck = true;
    }
  }
  assert.ok(struck);
  assert.equal(s.enemies[0].hp, 4);
  assert.equal(s.score, 0);
});
test('Dungeon blade and arrow are stopped by the visible wall before actors behind it', () => {
  const { env } = harness();
  const s = arena();
  s.player.x = 110;
  s.tiles[6][5] = 1;
  const blade = weaponSegment(s, s.player, 0, 32);
  assert.ok(blade.bx <= 118 + 1e-8);
  s.player.x = 150;
  s.projectiles = [{ x: 100, y: 150, vx: 6000, vy: 0, life: 1, active: true }];
  stepDungeon(s, 1 / 30, input(), env);
  assert.equal(s.health, 5);
  assert.equal(s.projectiles.length, 0);
});
test('Dungeon inactive or stationary arrows cannot damage even on top of the player', () => {
  const { env } = harness();
  const s = arena();
  s.projectiles = [
    { x: 100, y: 150, vx: 0, vy: 0, life: 1, active: true },
    { x: 100, y: 150, vx: 150, vy: 0, life: 1, active: false },
  ];
  stepDungeon(s, 1 / 30, input(), env);
  assert.equal(s.health, 5);
});
test('Dungeon spikes warn before their active damage and switches disarm them', () => {
  const { env } = harness();
  const s = arena();
  s.hazards = [{ x: 100, y: 150, offset: 0, disabled: false, state: 'safe' }];
  s.time = 1.79;
  stepDungeon(s, 1 / 30, input(), env);
  assert.equal(s.hazards[0].state, 'warning');
  assert.equal(s.health, 5);
  s.time = 2.39;
  stepDungeon(s, 1 / 30, input(), env);
  assert.equal(s.hazards[0].state, 'active');
  assert.equal(s.health, 4);
  const fourth = arena();
  Object.assign(fourth, buildRoom(4));
  fourth.enemies = [];
  fourth.player.x = fourth.lever.x;
  fourth.player.y = fourth.lever.y;
  stepDungeon(fourth, 1 / 120, input([], ['KeyE']), env);
  assert.ok(fourth.hazards.every((h) => h.disabled));
  assert.ok(fourth.lever.on);
});
test('Dungeon actual switch interaction opens the archive for traversal and cannot repeat score', () => {
  const { env } = harness();
  const s = arena();
  Object.assign(s, buildRoom(3));
  s.enemies = [];
  s.player.x = s.lever.x;
  s.player.y = s.lever.y;
  const before = flood(s.tiles);
  assert.equal(before.has(cellKey(s.key)), false);
  stepDungeon(s, 1 / 120, input([], ['KeyE']), env);
  assert.ok(flood(s.tiles).has(cellKey(s.key)));
  const score = s.score;
  stepDungeon(s, 1 / 120, input([], ['KeyE']), env);
  assert.equal(s.score, score);
});
test('Dungeon full packs retain supplies and full-health shrines stay available', () => {
  const { env } = harness();
  const s = arena();
  s.flasks = 3;
  s.player.x = s.chest.x;
  s.player.y = s.chest.y;
  stepDungeon(s, 1 / 120, input([], ['KeyE']), env);
  assert.equal(s.chest.opened, false);
  s.potions = [{ x: s.player.x, y: s.player.y }];
  stepDungeon(s, 1 / 120, input(), env);
  assert.equal(s.potions.length, 1);
  s.player.x = s.shrine.x;
  s.player.y = s.shrine.y;
  stepDungeon(s, 1 / 120, input([], ['KeyE']), env);
  assert.equal(s.shrine.used, false);
  s.health = 2;
  stepDungeon(s, 1 / 120, input([], ['KeyE']), env);
  assert.equal(s.shrine.used, true);
  assert.equal(s.health, 4);
});
test('Dungeon movement and dodge distance agree at 30/60/120Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const { env } = harness();
    const s = arena();
    for (let n = 0; n < hz; n++)
      stepDungeon(s, 1 / hz, input(['ArrowRight'], n === 0 ? ['KeyK'] : []), env);
    return s;
  });
  for (const s of states) {
    assert.ok(Math.abs(s.player.x - states[0].player.x) < 1e-8);
    assert.ok(Math.abs(s.stamina - states[0].stamina) < 1e-8);
  }
});
test('Dungeon both Shift keys trigger the documented dodge', () => {
  for (const key of ['ShiftLeft', 'ShiftRight']) {
    const { env } = harness();
    const s = arena();
    stepDungeon(s, 1 / 120, input(['ArrowRight'], [key]), env);
    assert.ok(s.dash > 0);
    assert.ok(s.stamina < 80);
  }
});
test('Dungeon legal idle loss freezes once and a new campaign resets resources', () => {
  const { env, ends } = harness();
  const game = createGame(env);
  for (let n = 0; n < 3600 && game.getState().phase === 'playing'; n++)
    game.update(1 / 60, input());
  assert.equal(game.getState().phase, 'lost');
  assert.equal(ends.length, 1);
  const frozen = game.getState();
  game.update(1 / 30, input(['Space'], ['KeyH']));
  assert.deepEqual(game.getState(), frozen);
  const fresh = createGame(env).getState();
  assert.equal(fresh.health, 5);
  assert.equal(fresh.flasks, 1);
  assert.equal(fresh.room, 1);
  assert.equal(fresh.kills, 0);
});
test('Dungeon seeded public inputs remain finite, deterministic, and bounded', () => {
  const games = [createGame(harness().env), createGame(harness().env)],
    random = seeded(19);
  let held = [];
  const finite = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v));
    else if (v && typeof v === 'object') Object.values(v).forEach(finite);
  };
  for (let n = 0; n < 2400; n++) {
    if (n % 24 === 0)
      held = [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown']][
        Math.floor(random() * 4)
      ].concat(random() < 0.6 ? ['Space'] : []);
    for (const g of games) g.update(1 / 60, input(held, n % 90 === 0 ? ['KeyK'] : []));
    if (n % 120 === 0) {
      const s = games[0].getState();
      finite(s);
      assert.ok(s.projectiles.length <= 20);
      assert.ok(s.particles.length <= 24);
      games[0].draw(mockContext());
      assert.deepEqual(s, games[1].getState());
    }
  }
});
test('Dungeon every essential touch action has an explicit side', async () => {
  const { meta } = await import('../src/games/dungeon-dash.js');
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyK',
    'KeyE',
    'KeyH',
  ])
    assert.ok(meta.touchControls.some((c) => c.code === code && c.side));
});

test('Dungeon even fast knockback cannot tunnel through a solid guardian', () => {
  const { env } = harness();
  const s = arena();
  s.player.vx = 20000;
  s.enemies = [
    {
      id: 'solid',
      x: 180,
      y: 150,
      vx: 0,
      vy: 0,
      hp: 5,
      speed: 0,
      hit: 0,
      type: 'guard',
      state: 'recover',
      timer: 10,
    },
  ];
  stepDungeon(s, 1 / 30, input(), env);
  assert.ok(s.player.x + 15.9 <= s.enemies[0].x);
});
