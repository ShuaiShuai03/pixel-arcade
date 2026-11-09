import { clamp } from '../shared/utils.js';
import { EPS, STEP, LIMIT, thrust, fireRound, separateHulls } from './sky-raiders-physics.js';
import { resolveProjectileStep } from './sky-raiders-step.js';
import { makeEnemy, makeCarrier, steerEnemy, enemyAttack } from './sky-raiders-ai.js';
import { scheduleHazards, stepHazards } from './sky-raiders-hazards.js';
import { SECTORS, SECTOR_COUNT, sectorPower } from './sky-raiders-sectors.js';
import { endMessage } from './sky-raiders-text.js';
import { MENU_COLUMNS, menuTarget } from './sky-raiders-menu.js';
import { drawSky } from './sky-raiders-draw.js';

export {
  advanceFlight,
  resolveHullImpact,
  fireRound,
  sweepProjectile,
} from './sky-raiders-physics.js';
export { hullRects } from './sky-raiders-sprites.js';
export { resolveProjectileStep } from './sky-raiders-step.js';
export { warningRays } from './sky-raiders-ai.js';
export { SECTORS, SECTOR_COUNT };

export const meta = {
  id: 'sky-raiders',
  name: { en: 'Sky Raiders', zh: '天空突袭' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: `Pilot a vector-thrust interceptor through ${SECTOR_COUNT} sectors and destroy each carrier. Hold Fire and let the cannon cool when hot. Flashing lanes and columns strike where you were, so keep moving. Break marked turrets before armored cores. Your three interception charges expand at a visible finite speed; use them before rounds reach you. Supply pods: W raises your cannon up to level 3, + restores a shield, K restores a charge. Progress is saved, so you can pick any cleared sector.`,
    zh: `驾驶矢量推进截击机穿越${SECTOR_COUNT}片空域，逐一击破航母。按住射击，炮口过热时等待冷却。闪烁的横带和光柱会打击你原先所在的位置，所以要不断移动。先击破标记炮塔，再攻击装甲核心。三枚拦截弹以可见速度向外扩散，要在敌弹接近前使用。补给舱：W 将火炮升至最高3级，+ 恢复护盾，K 恢复一枚拦截弹。进度会保存，可选择任何已通关的空域。`,
  },
  keys: [
    {
      label: { en: 'Fly (assisted thrust / release to brake)', zh: '飞行（辅助推进，松开减速）' },
      keys: 'WASD / Arrows',
    },
    {
      label: { en: 'Hold fire / automatic cooling', zh: '按住射击 / 自动冷却' },
      keys: 'Space / J',
    },
    { label: { en: 'Interception charge (3 initially)', zh: '拦截弹（初始3枚）' }, keys: 'K / X' },
    {
      label: { en: 'Sector select: move / launch / or tap', zh: '选择空域：移动 / 出发 / 或点按' },
      keys: 'Arrows / Space',
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
    ['Space', 'Fire', '射击'],
    ['KeyK', 'Charge', '拦截弹'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};

const MAX_SHIELDS = 4;
const MAX_CHARGES = 3;
const SPAWN_DELAY = 1.3;
const SPAWN_GAP = 1.4;
const TRANSITION_TIME = 1.8;
const SHOT_INTERVAL = 0.16;
const HEAT_PER_SHOT = 6;
const COOL_RATE = 24;
const RESUME_HEAT = 40;

/** A fresh run that starts in `level` with the full launch loadout for that sector. */
export function createSkyState(level = 1) {
  const sector = SECTORS[level - 1];
  return {
    phase: 'playing',
    score: 0,
    level,
    lives: 3,
    pulses: MAX_CHARGES,
    elapsed: 0,
    sectorTime: 0,
    spawned: 0,
    quota: sector.kinds.length,
    spawnClock: SPAWN_DELAY,
    carrierSpawned: false,
    transition: 0,
    cleanup: false,
    shotClock: 0,
    chargeClock: 0,
    pulseWasDown: false,
    nextId: 1,
    kills: 0,
    damageCause: '',
    hazardClock: sector.hazard?.first ?? 0,
    hazardCount: 0,
    player: {
      id: 0,
      shape: 'player',
      x: 240,
      y: 270,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      mass: 80,
      power: sectorPower(level),
      heat: 0,
      overheated: false,
      invincible: 1.5,
    },
    enemies: [],
    bullets: [],
    pickups: [],
    waves: [],
    hazards: [],
    particles: [],
    damageFlash: 0,
  };
}
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, SECTOR_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the flight.
  }
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: endMessage(env, { won, cause: s.damageCause, total: SECTOR_COUNT }),
  });
}
/** Soft walls: the pilot cannot leave the flight box, and an impact at the edge sheds its outward speed. */
function containPlayer(p) {
  for (const [axis, velocity, min, max] of [
    ['x', 'vx', LIMIT.minX, LIMIT.maxX],
    ['y', 'vy', LIMIT.minY, LIMIT.maxY],
  ]) {
    if (p[axis] < min) {
      p[axis] = min;
      p[velocity] = Math.max(0, p[velocity]);
    } else if (p[axis] > max) {
      p[axis] = max;
      p[velocity] = Math.min(0, p[velocity]);
    }
  }
}
function fireCannon(s, env) {
  const angles =
    s.player.power === 3 ? [-0.11, 0, 0.11] : s.player.power === 2 ? [-0.045, 0.045] : [0];
  for (const angle of angles)
    s.bullets.push(
      fireRound(s.player, -Math.PI / 2 + angle, 330, {
        id: s.nextId++,
        owner: 'player',
        x: s.player.x,
        y: s.player.y - 19,
        r: 2,
      }),
    );
  s.shotClock = SHOT_INTERVAL;
  s.player.heat = Math.min(100, s.player.heat + HEAT_PER_SHOT);
  if (s.player.heat >= 100) s.player.overheated = true;
  env.sound('shoot');
}
function releaseCharge(s, env) {
  s.pulses--;
  s.chargeClock = 0.5;
  s.waves.push({
    id: s.nextId++,
    x: s.player.x,
    y: s.player.y,
    radius: 0,
    speed: 420,
    maxRadius: 520,
    energy: 36,
    life: 1.3,
    hit: [],
  });
  env.sound('hit');
}
function pilotTick(s, h, input, env) {
  s.player.invincible = Math.max(0, s.player.invincible - h);
  s.shotClock = Math.max(0, s.shotClock - h);
  s.chargeClock = Math.max(0, s.chargeClock - h);
  s.player.heat = Math.max(0, s.player.heat - COOL_RATE * h);
  if (s.player.overheated && s.player.heat <= RESUME_HEAT) s.player.overheated = false;
  const dx = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    dy = Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW'));
  thrust(s.player, h, dx, dy);
  const pulseDown = input.held('KeyK', 'KeyX'),
    pulsePress = input.pressed('KeyK', 'KeyX') || (pulseDown && !s.pulseWasDown);
  s.pulseWasDown = pulseDown;
  if (input.held('Space', 'KeyJ') && s.shotClock === 0 && !s.player.overheated) fireCannon(s, env);
  if (pulsePress && s.pulses > 0 && s.chargeClock === 0) releaseCharge(s, env);
}
function advanceSector(s) {
  s.level++;
  const sector = SECTORS[s.level - 1];
  s.quota = sector.kinds.length;
  s.spawned = 0;
  s.spawnClock = SPAWN_DELAY;
  s.carrierSpawned = false;
  s.cleanup = false;
  s.sectorTime = 0;
  s.enemies = [];
  s.hazards = [];
  s.hazardClock = sector.hazard?.first ?? 0;
  s.hazardCount = 0;
  s.lives = Math.min(MAX_SHIELDS, s.lives + 1);
  s.player.power = Math.max(s.player.power, sectorPower(s.level));
}
function tick(s, h, input, env) {
  s.elapsed += h;
  s.damageFlash = Math.max(0, s.damageFlash - h);
  s.sectorTime += h;
  pilotTick(s, h, input, env);
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.age = (e.age ?? 0) + h;
    e.flash = Math.max(0, (e.flash ?? 0) - h);
    steerEnemy(e, h);
    if (e.ai || e.script) enemyAttack(s, e, h, env);
  }
  resolveProjectileStep(s, h, env, true);
  containPlayer(s.player);
  // Against the wall the pilot cannot give way, so the other hull yields.
  separateHulls([s.player, ...s.enemies], s.player);
  if (!s.cleanup && s.transition === 0) scheduleHazards(s, env, h);
  stepHazards(s, env, h);
  for (const e of s.enemies) e.entryWarning = e.y < 80;
  for (const p of s.pickups) p.vx *= Math.exp(-0.6 * h);
  s.pickups = s.pickups.filter((p) => !p.collected && p.life > 0 && p.y < 340);
  s.particles = s.particles.filter((p) => (p.life -= h) > 0);
  for (const p of s.particles) {
    p.x += p.vx * h;
    p.y += p.vy * h;
    p.vx *= Math.exp(-h);
    p.vy *= Math.exp(-h);
  }
  if (s.lives <= 0) return finish(s, env, false);
  if (s.transition > 0) {
    s.transition = Math.max(0, s.transition - h);
    if (s.transition > 0) return;
    if (s.level === SECTOR_COUNT) return finish(s, env, true);
    advanceSector(s);
    return;
  }
  const boss = s.enemies.find((e) => e.boss);
  if (boss?.dead) {
    s.cleanup = true;
    s.hazards = [];
  }
  if (s.cleanup) {
    if (!s.bullets.some((b) => b.owner === 'enemy')) {
      s.cleanup = false;
      s.transition = TRANSITION_TIME;
      s.score += s.lives * 100;
      if (env.progress && s.level < SECTOR_COUNT) saveUnlocked(env.progress, s.level + 1);
    }
    return;
  }
  s.enemies = s.enemies.filter((e) => !e.dead && e.y < 350);
  s.spawnClock = Math.max(0, s.spawnClock - h);
  if (s.spawned < s.quota && s.spawnClock === 0) {
    const kind = SECTORS[s.level - 1].kinds[s.spawned];
    s.enemies.push(makeEnemy(s, env, kind, s.spawned + s.level));
    s.spawned++;
    s.spawnClock = SPAWN_GAP;
  }
  if (s.spawned === s.quota && s.enemies.length === 0 && !s.carrierSpawned) {
    s.enemies.push(makeCarrier(s));
    s.carrierSpawned = true;
  }
}
/** Whole 1/120 s steps keep 30, 60 and 120 Hz identical; only the first step sees a fresh press. */
export function stepSky(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  if (s.lives <= 0) {
    finish(s, env, false);
    return;
  }
  const held = {
    held: (...codes) => input.held(...codes),
    pressed: () => false,
    pointer: input.pointer,
  };
  let remaining = Math.min(dt, 1 / 30),
    first = true;
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(STEP, remaining);
    tick(s, h, first ? input : held, env);
    remaining -= h;
    first = false;
  }
}
function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a sector · ${menu.cursor}/${SECTOR_COUNT} ${SECTORS[menu.cursor - 1].en}`,
      zh: `选择空域 · ${menu.cursor}/${SECTOR_COUNT} ${SECTORS[menu.cursor - 1].zh}`,
    };
  return {
    en: `Sector ${s.level}/${SECTOR_COUNT} · Shields ${s.lives}/4 · Weapon ${s.player.power} · ${s.pulses} interception charges`,
    zh: `空域 ${s.level}/${SECTOR_COUNT} · 护盾 ${s.lives}/4 · 武器 ${s.player.power} · ${s.pulses} 枚拦截弹`,
  };
}

export function createGame(env) {
  let state = createSkyState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    state = createSkyState(menu.cursor);
    menu = null;
  }
  return {
    update(dt, input) {
      if (state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) menuStep(input);
      else {
        stepSky(state, dt, input, env);
        unlocked = Math.max(
          unlocked,
          Math.min(SECTOR_COUNT, state.level + (state.transition > 0 ? 1 : 0)),
        );
      }
    },
    draw: (ctx) => drawSky(ctx, state, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(state),
      totalLevels: SECTOR_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: SECTOR_COUNT, columns: MENU_COLUMNS }
        : null,
      sector: { en: SECTORS[state.level - 1].en, zh: SECTORS[state.level - 1].zh },
      status: statusText(state, menu),
    }),
  };
}
