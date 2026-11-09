import { clamp } from '../shared/utils.js';
import { approach, enemyFire, fireWarnings, moveFormation, round } from './orbit-invaders-ai.js';
import { drawInvaders } from './orbit-invaders-draw.js';
import { MENU_COLUMNS, menuTarget } from './orbit-invaders-menu.js';
import { projectilePhase } from './orbit-invaders-physics.js';
import { LEVELS, LEVEL_COUNT, endMessage, levelOf, makeFleet } from './orbit-invaders-waves.js';

export { LEVELS, LEVEL_COUNT, makeFleet };

export const meta = {
  id: 'orbit-invaders',
  name: { en: 'Orbit Invaders', zh: '轨道入侵者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'ShiftLeft', side: 'right', label: { en: 'Guard plate', zh: '护板' } },
  ],
  description: {
    en: `Defend ${LEVEL_COUNT} lunar encounters. Bunkers stop both sides: fire through gaps or cut a slot. Shoot down incoming rounds; Shift deploys a 0.9-second guard plate for up to three normal hits, with a 5-second activation cooldown. Your gun pauses while guarding; heat cools automatically. Progress is saved, so you can pick any cleared encounter.`,
    zh: `守住${LEVEL_COUNT}场月面战斗。掩体会挡住双方炮弹：利用空隙或打出射孔。可射落来弹；Shift展开护板0.9秒，最多挡住三发普通弹，每次启动后冷却5秒。护板展开时暂停开火，炮管会自动冷却。进度会保存，可选择任何已通关的战斗。`,
  },
  keys: [
    {
      label: { en: 'Move', zh: '移动' },
      keys: { en: 'Left / Right or A / D', zh: '左右方向键 / A / D' },
    },
    { label: { en: 'Fire', zh: '射击' }, keys: { en: 'Space / Z', zh: '空格 / Z' } },
    {
      label: { en: 'Guard plate', zh: '护板' },
      keys: {
        en: 'Shift (5s recharge; gun safe while guarding)',
        zh: 'Shift（5秒充能；护板展开时暂停开火）',
      },
    },
    {
      label: { en: 'Level select: choose / launch / or tap', zh: '选关：选择 / 出发 / 或点按' },
      keys: { en: 'Arrows / Space', zh: '方向键 / 空格' },
    },
  ],
};

const SPEED = 220,
  ACCEL = 1400,
  MAX_LIVES = 3,
  SUBSTEPS_PER_SECOND = 240,
  MAX_DT = 1 / 30,
  BUNKER_Y = 244,
  REPAIRED_BLOCKS = 3,
  ROOF_WEAR_ORDER = [1, 4, 2, 5, 0, 6];

/** One bunker: a roof row over two legs, so a gap under the roof stays open. */
function makeBunker(x, id, worn) {
  const blocks = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 7; col++)
      if (row === 0 || col < 2 || col > 4)
        blocks.push({ x: x + col * 6, y: BUNKER_Y + row * 6, w: 6, h: 6, hp: 1 });
  for (const index of ROOF_WEAR_ORDER.slice(0, worn)) blocks[index].hp = 0;
  return { id, x, y: BUNKER_Y, w: 42, h: 18, hp: blocks.reduce((n, b) => n + b.hp, 0), blocks };
}
/** The level's bunkers; one already standing at the same place keeps its damage. */
function layoutBunkers(level, previous = []) {
  return level.bunkers.map(
    (x, id) => previous.find((b) => b.x === x) ?? makeBunker(x, id, level.worn),
  );
}
const newFormation = () => ({
  x: 240,
  y: 60,
  vx: 0,
  vy: 0,
  phase: 'sweep',
  direction: 1,
  targetY: 60,
});

/** Put the fleet, timers and bunkers of `s.wave` on the field. */
function loadLevel(s) {
  const level = levelOf(s.wave);
  s.enemies = makeFleet(s.wave);
  s.fleetSize = s.enemies.length;
  s.shields = layoutBunkers(level, s.shields);
  s.formation = newFormation();
  s.direction = 1;
  s.enemyCooldown = level.gap;
  s.diveTimer = level.dive || 4;
  s.deploy = level.intro;
  s.invulnerable = level.intro;
  s.waveTime = level.time;
  s.cleared = false;
  s.ufo = null;
  s.ufoTimer = 12;
  s.ufoPasses = 1;
  s.warnings = [];
}
/** A fresh run that starts in `level` with the full launch loadout. */
export function createInvaderState(level = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    wave: clamp(Math.floor(level), 1, LEVEL_COUNT),
    lives: MAX_LIVES,
    ship: { x: 240, y: 283, vx: 0 },
    shots: [],
    bullets: [],
    shields: [],
    particles: [],
    time: 0,
    fireCooldown: 0,
    ufoTimer: 12,
    barrier: 0,
    barrierCooldown: 0,
    barrierHp: 0,
    barrierWidth: 0,
    heat: 0,
    overheated: false,
    intercepts: 0,
    shotsFired: 0,
    enemyShotsFired: 0,
    intermission: 0,
    nextId: 1000,
  };
  loadLevel(s);
  return s;
}
/** Fill in the fields a hand-built snapshot may omit, so every system can rely on them. */
function normalize(s) {
  s.formation ??= newFormation();
  s.ship.vx ??= 0;
  s.fleetSize ??= s.enemies.length;
  for (const key of [
    'heat',
    'intercepts',
    'shotsFired',
    'enemyShotsFired',
    'barrierWidth',
    'barrierHp',
  ])
    s[key] ??= 0;
  s.overheated ??= false;
  s.nextId ??= 1000;
  s.waveTime ??= levelOf(s.wave).time;
  s.deploy ??= 0;
  s.intermission ??= 0;
  s.ufoPasses ??= 1;
  for (const e of s.enemies) {
    e.id ??= s.nextId++;
    e.role ??= 'scout';
    e.mode ??= 'formation';
    e.vx ??= 0;
    e.vy ??= 0;
    e.slotX ??= e.x - s.formation.x;
    e.slotY ??= e.y - s.formation.y;
    e.homeY ??= e.y;
    e.flash ??= 0;
    e.maxHp ??= e.hp;
  }
  for (const b of s.shields)
    if (!b.blocks) b.blocks = [{ x: b.x, y: b.y, w: b.w, h: b.h, hp: b.hp }];
  for (const p of [...s.shots, ...s.bullets]) {
    p.vx ??= 0;
    p.w ??= 3;
    p.h ??= 8;
    p.damage ??= 1;
    p.hp ??= 1;
    p.life ??= 3;
  }
}
function nextEncounter(s) {
  s.wave++;
  loadLevel(s);
  s.lives = Math.min(MAX_LIVES, s.lives + 1);
  s.score += 500;
  for (const bunker of s.shields) {
    let repaired = 0;
    for (const block of bunker.blocks)
      if (block.hp === 0 && repaired++ < REPAIRED_BLOCKS) block.hp = 1;
    bunker.hp = bunker.blocks.reduce((n, b) => n + b.hp, 0);
  }
}
/** Pointer fields the simulation trusts: a finite canvas x, or none. */
function readPointer(input) {
  const p = input.pointer,
    finite = (v) => (Number.isFinite(v) ? v : -1);
  return { down: Boolean(p?.down), x: finite(p?.x), y: finite(p?.y), clicked: Boolean(p?.clicked) };
}
/** Whole 1/240 s steps keep 30, 60 and 120 Hz identical; only the first step sees a fresh press. */
export function stepInvaders(s, dt, input, random) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  normalize(s);
  const frame = Math.min(dt, MAX_DT),
    count = Math.max(1, Math.ceil(frame * SUBSTEPS_PER_SECOND)),
    pointer = readPointer(input),
    first = { held: (...c) => input.held(...c), pressed: (...c) => input.pressed(...c), pointer },
    rest = { ...first, pressed: () => false, pointer: { ...pointer, clicked: false } };
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    tick(s, frame / count, i === 0 ? first : rest, random);
}
function updateShip(s, dt, input) {
  const axis = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    pointer = input.pointer;
  let desired = axis * SPEED;
  if (pointer.down && pointer.x >= 0) desired = clamp((pointer.x - s.ship.x) * 8, -SPEED, SPEED);
  const oldX = s.ship.x,
    oldV = s.ship.vx,
    newV = approach(oldV, desired, ACCEL * dt);
  s.ship.startX = oldX;
  s.ship.x = clamp(oldX + ((oldV + newV) * dt) / 2, 22, 458);
  s.ship.vx = s.ship.x === 22 || s.ship.x === 458 ? 0 : newV;
  s.ship.motionVx = (s.ship.x - oldX) / dt;
  return oldV;
}
function tick(s, dt, input, random) {
  s.time += dt;
  for (const key of [
    'barrier',
    'barrierCooldown',
    'deploy',
    'invulnerable',
    'fireCooldown',
    'hitFlash',
  ])
    s[key] = Math.max(0, (s[key] || 0) - dt);
  s.heat = Math.max(0, s.heat - 0.26 * dt);
  if (s.overheated && s.heat <= 0.25) s.overheated = false;
  if (input.pressed('ShiftLeft', 'ShiftRight') && s.barrierCooldown <= 0 && s.intermission <= 0) {
    s.barrier = 0.9;
    s.barrierCooldown = 5;
    s.barrierHp = 3;
  }
  s.barrierWidth = approach(s.barrierWidth, s.barrier > 0 ? 48 : 0, 480 * dt);
  const launchVx = updateShip(s, dt, input);
  if (s.intermission > 0) {
    s.intermission = Math.max(0, s.intermission - dt);
    if (s.intermission === 0) nextEncounter(s);
  } else if (s.enemies.length) {
    s.waveTime -= dt;
    if (s.waveTime <= 0) {
      s.phase = 'lost';
      s.reason = 'time';
      return;
    }
  }
  for (const e of s.enemies) {
    e.startX = e.x;
    e.startY = e.y;
    e.flash = Math.max(0, e.flash - dt);
  }
  moveFormation(s, dt);
  for (const e of s.enemies) {
    e.motionVx = (e.x - e.startX) / dt;
    e.motionVy = (e.y - e.startY) / dt;
  }
  if (
    (input.held('Space', 'KeyZ') || input.pointer.down) &&
    s.fireCooldown <= 0 &&
    s.barrierWidth <= 0 &&
    !s.overheated &&
    s.intermission <= 0
  ) {
    round(s, s.ship.startX, 270, launchVx, -390, 0);
    s.heat = Math.min(1, s.heat + 0.11);
    s.fireCooldown = 0.22;
    if (s.heat >= 1) s.overheated = true;
  }
  enemyFire(s, dt, random);
  fireWarnings(s, dt);
  s.ufoTimer -= dt;
  if (s.ufoTimer <= 0 && s.ufoPasses > 0 && !s.ufo && s.enemies.length && s.intermission <= 0) {
    s.ufo = { x: -24, startX: -24, y: 43, vx: 55, hp: 1 };
    s.ufoPasses--;
  }
  if (s.ufo) {
    s.ufo.startX = s.ufo.x;
    s.ufo.x += s.ufo.vx * dt;
    if (s.ufo.x > 510) s.ufo = null;
  }
  projectilePhase(s, dt);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-60);
  if (s.phase === 'playing' && !s.enemies.length && !s.bullets.length && !s.cleared) {
    s.cleared = true;
    if (s.wave === LEVEL_COUNT) s.phase = 'won';
    else s.intermission = 1.3;
  }
}

/** Saved progress as a level number; a missing, throwing or junk store counts as level 1. */
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the battle.
  }
}
function statusText(s, menu) {
  if (menu) {
    const name = LEVELS[menu.cursor - 1].name;
    return {
      en: `Choose an encounter · ${menu.cursor}/${LEVEL_COUNT} ${name.en}`,
      zh: `选择战斗 · ${menu.cursor}/${LEVEL_COUNT} ${name.zh}`,
    };
  }
  return {
    en: `Wave ${s.wave}/${LEVEL_COUNT} · ${s.enemies.length} ${s.enemies.length === 1 ? 'enemy' : 'enemies'} · Hull ${s.lives} · ${s.intercepts} interceptions`,
    zh: `波次 ${s.wave}/${LEVEL_COUNT} · 剩余 ${s.enemies.length} 个敌人 · 船体 ${s.lives} · 拦截 ${s.intercepts}`,
  };
}

export function createGame(env) {
  let s = createInvaderState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false,
    last = { score: 0, lives: MAX_LIVES, shots: 0, intercepts: 0 };

  function menuStep(input) {
    const target = menuTarget({ ...input, pointer: readPointer(input) }, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createInvaderState(menu.cursor);
    menu = null;
  }
  function playSounds() {
    if (s.shotsFired > last.shots) env.sound('shoot');
    if (s.intercepts > last.intercepts) env.sound('coin');
    else if (s.score > last.score) env.sound('hit');
    if (s.lives < last.lives) env.sound('hit');
    last = { score: s.score, lives: s.lives, shots: s.shotsFired, intercepts: s.intercepts };
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score: s.score, message: endMessage(env, { won, reason: s.reason }) });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      stepInvaders(s, dt, input, env.random);
      playSounds();
      const reached = Math.min(LEVEL_COUNT, s.wave + (s.intermission > 0 ? 1 : 0));
      if (reached > unlocked) {
        unlocked = reached;
        if (env.progress) saveUnlocked(env.progress, unlocked);
      }
      if (s.phase !== 'playing') finish();
    },
    draw: (ctx) => drawInvaders(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(s),
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      level: { name: levelOf(s.wave).name, tip: levelOf(s.wave).tip },
      status: statusText(s, menu),
    }),
  };
}
