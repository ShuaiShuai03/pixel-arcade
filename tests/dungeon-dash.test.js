import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createDungeonState,
  stepDungeon,
  buildLevel,
  weaponSegment,
  meta,
} from '../src/games/dungeon-dash.js';
import { LEVELS } from '../src/games/dungeon-dash-levels.js';
import { WARNING_HALF_ARC } from '../src/games/dungeon-dash-foes.js';
import { harness, input, mockContext } from './harness.js';

function foe(x, y, extra = {}) {
  return {
    id: `t${x},${y}`,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: 3,
    type: 'guard',
    wake: 'near',
    speed: 0,
    hit: 0,
    state: 'recover',
    timer: 10,
    aim: { x: 1, y: 0 },
    struck: false,
    ...extra,
  };
}
/** An empty walled room with the player in the middle, ready for one rule at a time. */
function arena(level = 1) {
  const s = createDungeonState(level);
  s.tiles = Array.from({ length: 14 }, (_, y) =>
    Array.from({ length: 22 }, (_, x) => +(x === 0 || x === 21 || y === 0 || y === 13)),
  );
  Object.assign(s, {
    enemies: [],
    hazards: [],
    projectiles: [],
    treasures: [],
    potions: [],
    levers: [],
    chests: [],
    shrines: [],
    gates: [],
    invulnerable: 0,
  });
  s.player = { x: 100, y: 150, vx: 0, vy: 0, facing: 1 };
  s.key = { x: 400, y: 280 };
  s.exit = { x: 420, y: 60 };
  return s;
}
const run = (s, frames, held = [], pressed = []) => {
  const { env } = harness();
  for (let n = 0; n < frames; n++)
    stepDungeon(s, 1 / 120, input(held, n === 0 ? pressed : []), env);
  return env;
};

test('walls stop movement, slide, and a fast body cannot tunnel', () => {
  const s = arena();
  s.tiles[6][5] = 1;
  s.player.y = 160;
  s.player.vx = 10000;
  run(s, 1, ['ArrowRight']);
  assert.ok(s.player.x <= 112 + 1e-8 && s.player.vx <= 1e-8);
  const y = s.player.y;
  run(s, 20, ['ArrowRight', 'ArrowDown']);
  assert.ok(s.player.y > y);
});
test('the sword has a windup, a forward sector and strikes once per swing', () => {
  const s = arena();
  s.enemies = [foe(124, 150, { hp: 5 }), foe(100, 120, { hp: 5, id: 'side' })];
  run(s, 1, [], ['Space']);
  assert.equal(s.enemies[0].hp, 5, 'no damage before the windup ends');
  run(s, 60);
  assert.equal(s.enemies[0].hp, 4);
  assert.equal(s.enemies[1].hp, 5, 'enemies beside the swing are untouched');
  assert.equal(s.stamina < 100, true);
});
test('dodging costs stamina, has a cooldown and no invulnerability, with both Shift keys', () => {
  for (const key of ['KeyK', 'ShiftLeft', 'ShiftRight']) {
    const s = arena();
    run(s, 1, ['ArrowRight'], [key]);
    assert.ok(s.dash > 0 && s.stamina < 80 && s.invulnerable === 0);
    assert.ok(s.player.vx > 0 && s.player.vx < 30, 'acceleration is bounded');
  }
});
test('a tap during a cooldown is kept and answered, not silently dropped', () => {
  const s = arena();
  run(s, 1, [], ['Space']);
  assert.ok(s.cooldown > 0);
  run(s, 20, [], []);
  const stamina = s.stamina;
  const env = harness().env;
  stepDungeon(s, 1 / 120, input([], ['Space']), env);
  for (let n = 0; n < 90 && !s.swing; n++) stepDungeon(s, 1 / 120, input(), env);
  assert.ok(s.swing || s.stamina < stamina + 24, 'the buffered tap became a second swing');
  const t = arena();
  t.stamina = 0;
  run(t, 1, [], ['KeyK']);
  run(t, 15);
  assert.equal(t.dash, 0);
  run(t, 40);
  assert.match(t.toast.en, /Dodge needs more stamina/);
  assert.match(t.toast.zh, /闪步/);
  const u = arena();
  u.health = 2;
  u.flasks = 2;
  run(u, 1, [], ['KeyH']);
  run(u, 1, [], ['KeyH']);
  assert.equal(u.health, 4);
  run(u, 70);
  assert.equal(u.health, 5, 'the second tap drank once the first flask cooldown ended');
});
test('a guard telegraphs, a locked swing cannot reach behind, body contact is harmless', () => {
  const s = arena();
  s.enemies = [foe(128, 150, { state: 'approach', timer: 0 })];
  run(s, 2);
  assert.equal(s.enemies[0].state, 'windup');
  assert.equal(s.health, 5);
  const t = arena();
  t.player.x = 170;
  t.player.y = 180;
  t.enemies = [foe(195, 180, { state: 'windup', timer: 0.001 })];
  run(t, 35);
  assert.equal(t.health, 5, 'the enemy aimed away from the player');
  const u = arena();
  u.enemies = [foe(124, 150, { hp: 5 })];
  run(u, 60, ['ArrowRight']);
  assert.ok(u.enemies[0].x - u.player.x >= 15.9);
  assert.equal(u.health, 5);
});
test('blades and arrows stop at walls, and idle or expired arrows are harmless', () => {
  const s = arena();
  s.player.x = 110;
  s.tiles[6][5] = 1;
  assert.ok(weaponSegment(s, s.player, 0, 32).bx <= 118 + 1e-8);
  s.player.x = 150;
  s.projectiles = [{ x: 100, y: 150, vx: 6000, vy: 0, life: 1, active: true }];
  run(s, 1);
  assert.equal(s.health, 5);
  assert.equal(s.projectiles.length, 0);
  const t = arena();
  t.projectiles = [
    { x: 100, y: 150, vx: 0, vy: 0, life: 1, active: true },
    { x: 100, y: 150, vx: 150, vy: 0, life: 1, active: false },
    { x: 75, y: 150, vx: 100, vy: 0, life: 0.001, active: true },
  ];
  run(t, 130);
  assert.equal(t.health, 5);
  assert.equal(t.projectiles.length, 0);
  const u = arena();
  u.player.x = 300;
  u.projectiles = [{ x: 200, y: 150, vx: 150, vy: 0, life: 3, active: true }];
  run(u, 360);
  assert.equal(u.health, 4, 'a live arrow does hit');
});
test('spikes warn before they strike and the spike lever disarms them', () => {
  const s = arena();
  s.hazards = [{ x: 100, y: 150, offset: 0, disabled: false, state: 'safe' }];
  s.time = 2.39;
  run(s, 1);
  assert.equal(s.hazards[0].state, 'warning');
  assert.equal(s.health, 5);
  s.time = 2.395;
  run(s, 40);
  assert.equal(s.hazards[0].state, 'active');
  assert.equal(s.health, 4);
  const l = createDungeonState(11);
  l.enemies = [];
  const lever = l.levers[0];
  l.player.x = lever.x;
  l.player.y = lever.y;
  run(l, 1, [], ['KeyE']);
  assert.ok(l.hazards.every((h) => h.disabled) && lever.on);
});
test('a lever opens only its own gate and cannot repeat its score', () => {
  const s = createDungeonState(13);
  s.enemies = [];
  const [first] = s.levers;
  s.player.x = first.x;
  s.player.y = first.y;
  const closed = s.gates.filter((g) => s.tiles[g.cy][g.cx] === 2).length;
  run(s, 1, [], ['KeyE']);
  const open = s.gates.filter((g) => s.tiles[g.cy][g.cx] === 2).length;
  assert.equal(closed - open, 1);
  const score = s.score;
  run(s, 1, [], ['KeyE']);
  assert.equal(s.score, score);
});
test('supply, flasks and shrine: full packs and full health keep them available', () => {
  const s = arena();
  s.chests = [{ x: 100, y: 150, opened: false }];
  s.shrines = [{ x: 100, y: 150, used: false }];
  s.flasks = 3;
  run(s, 1, [], ['KeyE']);
  assert.equal(s.chests[0].opened, false);
  s.potions = [{ x: 100, y: 150 }];
  run(s, 1);
  assert.equal(s.potions.length, 1);
  s.chests[0].opened = true;
  run(s, 1, [], ['KeyE']);
  assert.equal(s.shrines[0].used, false);
  s.health = 2;
  run(s, 1, [], ['KeyE']);
  assert.equal(s.shrines[0].used, true);
  assert.equal(s.health, 4);
  s.potions = [];
  s.flasks = 1;
  s.health = 5;
  run(s, 1, [], ['KeyH']);
  assert.equal(s.flasks, 1, 'full health keeps the flask');
  s.flasks = 0;
  run(s, 1, [], ['KeyE']);
  assert.match(s.toast.en, /Stand near/);
  s.chests[0].opened = false;
  s.health = 3;
  run(s, 1, [], ['KeyH']);
  assert.match(s.toast.en, /No healing flasks/);
});
test('the key wakes statues, proximity wakes sleepers, and the exit needs the key', () => {
  const s = createDungeonState(9);
  assert.ok(s.enemies.every((e) => e.state === 'sleep' && e.wake === 'key'));
  s.player.x = s.key.x;
  s.player.y = s.key.y;
  run(s, 1);
  assert.ok(s.hasKey && s.enemies.every((e) => e.state === 'approach'));
  const t = createDungeonState(2);
  const guard = t.enemies[0];
  assert.equal(guard.state, 'sleep');
  t.player.x = guard.x - 60;
  t.player.y = guard.y;
  run(t, 40);
  assert.notEqual(t.enemies[0].state, 'sleep');
  const u = createDungeonState(1);
  u.player.x = u.exit.x;
  u.player.y = u.exit.y;
  run(u, 2);
  assert.equal(u.level, 1);
  u.hasKey = true;
  run(u, 2);
  assert.equal(u.level, 2);
  assert.equal(u.health, 5);
  assert.equal(u.hasKey, false);
});
test('a level that does not need a clear lets the key holder leave past live guards', () => {
  const s = createDungeonState(14);
  assert.ok(s.enemies.length > 0);
  s.hasKey = true;
  s.invulnerable = 5;
  s.player.x = s.exit.x;
  s.player.y = s.exit.y;
  run(s, 2);
  assert.equal(s.level, 15);
});
test('every chamber is walled in and its objects stand on open floor', () => {
  for (let n = 1; n <= 20; n++) {
    const room = buildLevel(n);
    assert.equal(room.tiles.length, 14);
    for (const p of [room.key, room.exit, room.start, ...room.enemies, ...room.levers]) {
      const cx = Math.floor((p.x - 20) / 20),
        cy = Math.floor((p.y - 30) / 20);
      assert.equal(room.tiles[cy][cx], 0, `level ${n}`);
    }
    for (const g of room.gates) assert.equal(room.tiles[g.cy][g.cx], 2);
  }
});
test('a legal idle loss freezes once and a new game starts fresh', () => {
  const s = createDungeonState(2);
  s.health = 0;
  const { env, ends } = harness();
  stepDungeon(s, 1 / 60, input(), env);
  stepDungeon(s, 1 / 60, input(['Space'], ['KeyH']), env);
  assert.equal(s.phase, 'lost');
  assert.equal(ends.length, 1);
  const fresh = createGame(harness().env).getState();
  assert.deepEqual([fresh.health, fresh.flasks, fresh.level, fresh.kills], [5, 1, 1, 0]);
  assert.match(fresh.status.en, /1 flask(?!s)/);
});
test('the last exit wins', () => {
  const s = createDungeonState(20);
  s.enemies = [];
  s.hasKey = true;
  s.player.x = s.exit.x;
  s.player.y = s.exit.y;
  const { env, ends } = harness();
  stepDungeon(s, 1 / 60, input(), env);
  assert.equal(s.phase, 'won');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].won, true);
});
test('movement and dodge distance agree at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const { env } = harness(),
      s = arena();
    for (let n = 0; n < hz; n++)
      stepDungeon(s, 1 / hz, input(['ArrowRight'], n === 0 ? ['KeyK'] : []), env);
    return s;
  });
  for (const s of states) {
    assert.ok(Math.abs(s.player.x - states[0].player.x) < 1e-8);
    assert.ok(Math.abs(s.stamina - states[0].stamina) < 1e-8);
  }
});
test('fast knockback cannot tunnel through a solid guardian', () => {
  const s = arena();
  s.player.vx = 20000;
  s.enemies = [foe(180, 150, { hp: 5 })];
  run(s, 4);
  assert.ok(s.player.x + 15.9 <= s.enemies[0].x);
});
test('every essential touch action has an explicit side', () => {
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
  assert.ok(createGame(harness().env).draw(mockContext()) === undefined);
});
test('a hit staggers a guard for less than the swing cooldown, so swings cannot be chained for free', () => {
  const s = arena();
  s.enemies = [foe(124, 150, { hp: 5, state: 'approach', timer: 0, speed: 0 })];
  s.enemies[0].state = 'windup';
  s.enemies[0].timer = 5;
  run(s, 1, [], ['Space']);
  run(s, 28);
  assert.equal(s.enemies[0].state, 'recover');
  assert.ok(s.enemies[0].timer <= 0.3);
  run(s, 40);
  assert.notEqual(s.enemies[0].state, 'recover');
});
test('an armoured guard finishes a started windup when hit, a plain guard is interrupted', () => {
  for (const armor of [false, true]) {
    const s = arena();
    s.enemies = [foe(124, 150, { hp: 5, state: 'windup', timer: 5, armor })];
    run(s, 1, [], ['Space']);
    run(s, 40);
    assert.equal(s.enemies[0].hp, 4);
    assert.equal(s.enemies[0].state, armor ? 'windup' : 'recover');
  }
});
test('armoured sleepers wake as a pack, plain sleepers wake alone', () => {
  for (const armor of [false, true]) {
    const s = arena();
    s.pathTimer = 0;
    s.enemies = [
      foe(130, 150, { state: 'sleep', wake: 'near', armor }),
      foe(240, 150, { state: 'sleep', wake: 'near', armor, id: 'second' }),
    ];
    s.player.x = 100;
    run(s, 2);
    assert.equal(s.enemies[1].state === 'sleep', !armor);
  }
});
test('each level starts with its own flask count and the tip on screen', () => {
  assert.equal(createDungeonState(2).flasks, 1);
  assert.equal(createDungeonState(17).flasks, 0);
  assert.equal(createDungeonState(2).toast.en, LEVELS[1].tip.en);
});
test('a straight push at the edge of a one-cell doorway slides into it', () => {
  const s = arena();
  for (let y = 1; y < 13; y++) if (y !== 6) s.tiles[y][5] = 1;
  s.player.x = 100;
  s.player.y = 164;
  run(s, 240, ['ArrowRight']);
  assert.ok(s.player.x > 150, `stuck at ${s.player.x}`);
  const wall = arena();
  for (let y = 1; y < 13; y++) wall.tiles[y][5] = 1;
  wall.player.x = 100;
  wall.player.y = 164;
  run(wall, 240, ['ArrowRight']);
  assert.ok(
    wall.player.x <= 112 + 1e-6 && Math.abs(wall.player.y - 164) < 0.01,
    'a plain wall does not drag',
  );
});
test('the drawn guard warning arc covers every angle a static player can be hit from at 30 px', () => {
  let widest = 0;
  for (let degrees = 0; degrees <= 110; degrees += 2) {
    const s = arena();
    const angle = (degrees * Math.PI) / 180;
    s.player.x = 200 + Math.cos(angle) * 30;
    s.player.y = 150 + Math.sin(angle) * 30;
    s.enemies = [foe(200, 150, { state: 'windup', timer: 0.001, aim: { x: 1, y: 0 } })];
    run(s, 40);
    if (s.health < 5) widest = degrees;
  }
  assert.ok(widest > 0 && (widest * Math.PI) / 180 <= WARNING_HALF_ARC, `hit at ${widest} degrees`);
});
