// Per-chamber state and the fixed-step simulation of the player, hazards and pickups.
import { LEVELS, LEVEL_COUNT, buildLevel } from './dungeon-dash-levels.js';
import {
  HALF,
  SPIKE,
  SPIKE_PERIOD,
  bladeHits,
  blocked,
  driveBody,
  pathField,
  separate,
  sight,
  weaponSegment,
} from './dungeon-dash-world.js';
import { hurt, stepArrows, stepEnemy, wakeAll } from './dungeon-dash-foes.js';

export const START_HEALTH = 5;
export const MAX_FLASKS = 3;
const TIP_TIME = 8;
export const BUFFER_TIME = { swing: 0.3, dash: 0.3, heal: 0.5 };
const SWING_COST = 18,
  DASH_COST = 22,
  STEP_LIMIT = 1 / 30;
// Shorter than the swing cooldown, so a staggered guard is never held in place for a free chain.
const STAGGER = 0.3;
const SPIKE_REACH = HALF + 9;

export const playerBlade = (s) =>
  !s.swing || s.swing.elapsed < 0.07 || s.swing.elapsed >= 0.23
    ? null
    : weaponSegment(
        s,
        s.player,
        s.swing.angle - 1.05 + ((s.swing.elapsed - 0.07) / 0.16) * 2.1,
        32,
      );

/** Phase of a spike plate: safe, then a visible warning, then active. */
export function spikeState(time, offset) {
  const phase = (time + offset) % SPIKE_PERIOD;
  return phase < SPIKE.safe ? 'safe' : phase < SPIKE.safe + SPIKE.warn ? 'warning' : 'active';
}
const toast = (s, en, zh, time = 1.5) => {
  s.toast = { en, zh, time };
};

/** Start a chamber: full health, one flask, the level's tip on screen. */
export function enterLevel(s, level) {
  Object.assign(s, buildLevel(level));
  s.level = level;
  s.player = { x: s.start.x, y: s.start.y, vx: 0, vy: 0, facing: 1 };
  Object.assign(s, {
    facingY: 0,
    hasKey: false,
    projectiles: [],
    attack: 0,
    cooldown: 0,
    swing: null,
    path: [],
    pathTimer: 0,
    invulnerable: 1,
    dash: 0,
    dashCooldown: 0,
    health: START_HEALTH,
    stamina: 100,
    flasks: LEVELS[level - 1].startFlasks,
    healCooldown: 0,
    time: 0,
    buffer: { swing: 0, dash: 0, heal: 0 },
  });
  toast(s, LEVELS[level - 1].tip.en, LEVELS[level - 1].tip.zh, TIP_TIME);
}
export function createDungeonState(level = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    kills: 0,
    pickups: 0,
    drank: 0,
    dashDir: { x: 1, y: 0 },
    particles: [],
  };
  enterLevel(s, level);
  return s;
}
function end(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All twenty chambers cleared. The vault is yours!'
        : 'The guardians caught you. Read their windups and use your healing flasks.',
      won ? '二十座密室全部通过，宝库属于你！' : '你被守卫击败。观察蓄力，及时使用药水。',
    ),
  });
}
function pullLever(s, env, lever) {
  lever.on = true;
  if (lever.opens === 'spikes') for (const h of s.hazards) h.disabled = true;
  else for (const g of s.gates) if (g.id === lever.opens) s.tiles[g.cy][g.cx] = 0;
  s.pathTimer = 0;
  s.score += 100;
  toast(
    s,
    lever.opens === 'spikes' ? 'Spike mechanism disabled' : 'A gate opened',
    lever.opens === 'spikes' ? '尖刺机关已关闭' : '一道闸门已打开',
  );
  env.sound('coin');
}
function use(s, env) {
  const near = (o) =>
    Math.hypot(o.x - s.player.x, o.y - s.player.y) < 28 &&
    sight(s, s.player.x, s.player.y, o.x, o.y);
  const lever = s.levers.find((o) => !o.on && near(o)),
    chest = s.chests.find((o) => !o.opened && near(o)),
    shrine = s.shrines.find((o) => !o.used && near(o));
  if (lever) pullLever(s, env, lever);
  else if (chest) {
    if (s.flasks >= MAX_FLASKS)
      return toast(s, 'Flask pack full — use one first', '药水已满，先使用一瓶');
    chest.opened = true;
    s.flasks++;
    s.score += 200;
    s.pickups++;
    toast(s, 'Supply cache: +1 flask', '补给箱：药水+1');
    env.sound('coin');
  } else if (shrine) {
    if (s.health === START_HEALTH && s.stamina > 95)
      return toast(s, 'Shrine saved until you need recovery', '状态良好，神龛留待恢复');
    shrine.used = true;
    s.health = Math.min(START_HEALTH, s.health + 2);
    s.stamina = 100;
    toast(s, 'Shrine restored health and stamina', '神龛恢复生命与体力');
    env.sound('coin');
  } else toast(s, 'Stand near a switch, cache or shrine', '靠近开关、补给箱或神龛再使用');
}
function drink(s, env) {
  if (s.health < START_HEALTH && s.flasks > 0) {
    s.flasks--;
    s.drank++;
    const restored = Math.min(2, START_HEALTH - s.health);
    s.health += restored;
    s.healCooldown = 0.4;
    toast(
      s,
      `Flask restored ${restored} ${restored === 1 ? 'heart' : 'hearts'}`,
      `药水恢复${restored}颗心`,
    );
    env.sound('coin');
  } else
    toast(
      s,
      s.flasks ? 'Health full — flask saved' : 'No healing flasks',
      s.flasks ? '生命已满，药水保留' : '没有治疗药水',
    );
}
const BLOCKED_TAP = {
  dash: (s) =>
    s.dashCooldown > 0
      ? { en: 'Dodge is recharging', zh: '闪步正在冷却' }
      : { en: 'Dodge needs more stamina', zh: '闪步需要更多体力' },
  swing: () => ({ en: 'Sword needs more stamina', zh: '挥剑需要更多体力' }),
  heal: () => ({ en: 'Flask not ready yet', zh: '药水尚未就绪' }),
};
/** A tap stays alive for a moment; consume it when its action becomes possible. */
function take(s, name, ready) {
  if (s.buffer[name] <= 0 || !ready) return false;
  s.buffer[name] = 0;
  return true;
}
function expireTaps(s, h) {
  for (const name of Object.keys(s.buffer)) {
    if (s.buffer[name] <= 0) continue;
    s.buffer[name] = Math.max(0, s.buffer[name] - h);
    if (s.buffer[name] === 0) {
      const reason = BLOCKED_TAP[name](s);
      toast(s, reason.en, reason.zh);
    }
  }
}
function stepPlayerActions(s, h, held, env) {
  if (take(s, 'heal', s.healCooldown === 0)) drink(s, env);
  if (take(s, 'dash', s.dashCooldown === 0 && s.stamina >= DASH_COST)) {
    s.stamina -= DASH_COST;
    s.dash = 0.18;
    s.dashCooldown = 0.8;
    s.dashDir = { x: s.player.facing, y: s.facingY };
    env.sound('move');
  }
  if ((held || s.buffer.swing > 0) && s.cooldown === 0 && s.stamina >= SWING_COST) {
    s.buffer.swing = 0;
    s.stamina -= SWING_COST;
    s.cooldown = 0.42;
    s.attack = 0.4;
    s.swing = { elapsed: 0, angle: Math.atan2(s.facingY, s.player.facing), hitIds: [] };
    env.sound('shoot');
  }
  expireTaps(s, h);
}
function stepSwing(s, h, env) {
  if (!s.swing) return;
  s.swing.elapsed += h;
  s.attack = Math.max(0, 0.4 - s.swing.elapsed);
  if (s.swing.elapsed >= 0.07 && s.swing.elapsed < 0.23) {
    const blade = playerBlade(s);
    for (const e of s.enemies)
      if (
        !s.swing.hitIds.includes(e.id) &&
        bladeHits(blade, e) &&
        sight(s, s.player.x, s.player.y, e.x, e.y)
      ) {
        s.swing.hitIds.push(e.id);
        e.hp--;
        e.hit = 0.2;
        const d = Math.hypot(e.x - s.player.x, e.y - s.player.y) || 1;
        e.vx += ((e.x - s.player.x) / d) * 90;
        e.vy += ((e.y - s.player.y) / d) * 90;
        if (e.type !== 'warden' && !(e.armor && (e.state === 'windup' || e.state === 'active'))) {
          e.state = 'recover';
          e.timer = STAGGER;
        }
        s.particles.push({ x: e.x, y: e.y, life: 0.22, kind: 'hit' });
        env.sound('hit');
      }
  }
  if (s.swing.elapsed >= 0.4) s.swing = null;
}
function stepHazards(s, env) {
  for (const hazard of s.hazards) {
    hazard.state = hazard.disabled ? 'safe' : spikeState(s.time, hazard.offset);
    if (
      hazard.state === 'active' &&
      Math.abs(s.player.x - hazard.x) < SPIKE_REACH &&
      Math.abs(s.player.y - hazard.y) < SPIKE_REACH
    )
      hurt(s, env, hazard.x, hazard.y);
  }
}
function collect(s, env) {
  const touching = (p) =>
    Math.hypot(p.x - s.player.x, p.y - s.player.y) <= 14 &&
    sight(s, p.x, p.y, s.player.x, s.player.y);
  s.treasures = s.treasures.filter((p) => {
    if (!touching(p)) return true;
    s.score += 60;
    s.pickups++;
    env.sound('coin');
    return false;
  });
  s.potions = s.potions.filter((p) => {
    if (s.flasks >= MAX_FLASKS || !touching(p)) return true;
    s.flasks++;
    toast(s, 'Picked up a healing flask', '拾取治疗药水');
    env.sound('coin');
    return false;
  });
  if (!s.hasKey && touching(s.key)) {
    s.hasKey = true;
    s.score += 100;
    wakeAll(s, 'key');
    toast(s, 'Key found — head for the exit', '找到钥匙，前往出口');
    env.sound('coin');
  }
}
/** The chamber is done when the key is held and, unless the level says otherwise, nobody is left. */
export const exitOpen = (s) =>
  s.hasKey && (!LEVELS[s.level - 1].needsClear || s.enemies.length === 0);

const ASSIST_REACH = 5,
  ASSIST_SHARE = 0.6;
/** A straight push into a doorway edge slides toward the opening, so 1-wide gaps need no pixel aim. */
function cornerAssist(s, move) {
  if ((move.x !== 0) === (move.y !== 0)) return move;
  const { player } = s,
    aheadX = player.x + move.x * 4,
    aheadY = player.y + move.y * 4;
  if (!blocked(s, aheadX, aheadY)) return move;
  for (let offset = 1; offset <= ASSIST_REACH; offset++)
    for (const sign of [1, -1]) {
      const x = aheadX + (move.y ? sign * offset : 0),
        y = aheadY + (move.x ? sign * offset : 0);
      if (!blocked(s, x, y))
        return {
          x: move.x + (move.y ? sign * ASSIST_SHARE : 0),
          y: move.y + (move.x ? sign * ASSIST_SHARE : 0),
        };
    }
  return move;
}
function stepBody(s, h, move) {
  s.time += h;
  s.stamina = Math.min(100, s.stamina + 24 * h);
  for (const name of ['dash', 'dashCooldown', 'healCooldown', 'invulnerable', 'cooldown'])
    s[name] = Math.max(0, s[name] - h);
  s.toast.time = Math.max(0, s.toast.time - h);
  s.particles = s.particles.filter((p) => (p.life -= h) > 0);
  const dashing = s.dash > 0,
    speed = dashing ? 230 : 100,
    steer = dashing ? s.dashDir : cornerAssist(s, move),
    dx = steer.x,
    dy = steer.y;
  driveBody(s, s.player, dx * speed, dy * speed, dashing ? 2600 : 1800, h);
}
function reapEnemies(s, env) {
  const dead = s.enemies.filter((e) => e.hp <= 0);
  if (!dead.length) return;
  s.kills += dead.length;
  s.score += dead.length * 100;
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  env.sound('coin');
}
function readMove(s, i) {
  const x = Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA')),
    y = Number(i.held('ArrowDown', 'KeyS')) - Number(i.held('ArrowUp', 'KeyW')),
    length = Math.hypot(x, y);
  if (length) {
    s.player.facing = x / length;
    s.facingY = y / length;
  }
  return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}
export function stepDungeon(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  if (s.health <= 0) return end(s, env, false);
  dt = Math.max(0, Math.min(STEP_LIMIT, Number.isFinite(dt) ? dt : 0));
  if (dt === 0) return;
  const move = readMove(s, i);
  if (i.pressed('KeyK', 'ShiftLeft', 'ShiftRight')) s.buffer.dash = BUFFER_TIME.dash;
  if (i.pressed('KeyH', 'KeyX')) s.buffer.heal = BUFFER_TIME.heal;
  if (i.pressed('Space', 'KeyJ')) s.buffer.swing = BUFFER_TIME.swing;
  if (i.pressed('KeyE', 'Enter')) use(s, env);
  const held = i.held('Space', 'KeyJ');
  // Limit relative footprint travel even after an unusually strong impulse.
  const fastest = Math.max(
      Math.hypot(s.player.vx, s.player.vy),
      ...s.enemies.map((e) => Math.hypot(e.vx, e.vy)),
    ),
    count = Math.max(1, Math.ceil(dt * Math.max(240, (fastest + 230) / 3))),
    h = dt / count;
  for (let step = 0; step < count && s.phase === 'playing'; step++) {
    stepBody(s, h, move);
    stepPlayerActions(s, h, held, env);
    stepSwing(s, h, env);
    reapEnemies(s, env);
    s.pathTimer -= h;
    if (s.pathTimer <= 0) {
      s.path = pathField(s);
      s.pathTimer = 0.18;
    }
    for (const e of s.enemies) stepEnemy(s, e, h, env);
    const actors = [s.player, ...s.enemies];
    for (let a = 0; a < actors.length; a++)
      for (let b = a + 1; b < actors.length; b++) separate(s, actors[a], actors[b]);
    stepArrows(s, h, env);
    stepHazards(s, env);
    collect(s, env);
    if (s.health <= 0) return end(s, env, false);
    if (exitOpen(s) && Math.hypot(s.exit.x - s.player.x, s.exit.y - s.player.y) < 16) {
      s.score += 500;
      if (s.level === LEVEL_COUNT) return end(s, env, true);
      enterLevel(s, s.level + 1);
      return env.sound('win');
    }
    if (s.particles.length > 24) s.particles.splice(0, s.particles.length - 24);
  }
}
