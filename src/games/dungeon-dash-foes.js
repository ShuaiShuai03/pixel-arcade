// Enemy behaviour, arrows and damage to the player.
import {
  HALF,
  bladeHits,
  cellAt,
  downhill,
  driveBody,
  rayBox,
  sight,
  solid,
  weaponSegment,
} from './dungeon-dash-world.js';

export const WAKE_CELLS = 5;
const PACK_RADIUS = 120;
// A static player is hit up to about 66 degrees off the aim at 30 px, so that is the drawn warning.
export const WARNING_HALF_ARC = 1.2;
export const ENEMY_BLADE = { guard: 25, warden: 44 };
const WINDUP = { guard: 0.55, archer: 0.7, warden: 0.85 };
const STRIKE = { guard: 0.18, warden: 0.5 };
const RECOVER = { guard: 0.65, warden: 1.1 };
const REACH = { guard: 30, archer: 150, warden: 58 };
const ARROW_SPEED = 150;

export function hurt(s, env, x, y) {
  if (s.invulnerable > 0) return;
  s.health--;
  s.invulnerable = 0.9;
  const d = Math.hypot(s.player.x - x, s.player.y - y) || 1;
  s.player.vx += ((s.player.x - x) / d) * 70;
  s.player.vy += ((s.player.y - y) / d) * 70;
  s.particles.push({ x: s.player.x, y: s.player.y, life: 0.25, kind: 'hurt' });
  env.sound('hit');
}
export function enemyBlade(s, e) {
  if (e.state !== 'active' || e.type === 'archer') return null;
  const progress = 1 - e.timer / STRIKE[e.type];
  return weaponSegment(
    s,
    e,
    Math.atan2(e.aim.y, e.aim.x) +
      (e.type === 'warden' ? -Math.PI + progress * 2 * Math.PI : -0.8 + progress * 1.6),
    ENEMY_BLADE[e.type],
  );
}
/** Wake every sleeper of one kind, for example the statues when the key is lifted. */
export function wakeAll(s, wake) {
  for (const e of s.enemies) if (e.wake === wake && e.state === 'sleep') e.state = 'approach';
}
function beginWindup(s, e, distance) {
  e.state = 'windup';
  e.timer = WINDUP[e.type];
  e.aim = {
    x: (s.player.x - e.x) / (distance || 1),
    y: (s.player.y - e.y) / (distance || 1),
  };
  e.struck = false;
}
function approach(s, e, distance) {
  if (distance < REACH[e.type] && sight(s, e.x, e.y, s.player.x, s.player.y)) {
    beginWindup(s, e, distance);
    return [0, 0];
  }
  const target = downhill(s, e.x, e.y),
    ex = target.x - e.x,
    ey = target.y - e.y,
    d = Math.hypot(ex, ey);
  return d > 1 && e.hit === 0 ? [(ex / d) * e.speed, (ey / d) * e.speed] : [0, 0];
}
function finishWindup(s, e, env) {
  if (e.type === 'archer') {
    s.projectiles.push({
      x: e.x,
      y: e.y,
      vx: e.aim.x * ARROW_SPEED,
      vy: e.aim.y * ARROW_SPEED,
      life: 3,
      active: true,
    });
    e.state = 'recover';
    e.timer = 0.8;
    env.sound('shoot');
    return;
  }
  e.state = 'active';
  e.timer = STRIKE[e.type];
}
function strike(s, e, env) {
  const blade = enemyBlade(s, e);
  if (!e.struck && bladeHits(blade, s.player) && sight(s, e.x, e.y, s.player.x, s.player.y)) {
    e.struck = true;
    hurt(s, env, e.x, e.y);
  }
  if (e.timer === 0) {
    e.state = 'recover';
    e.timer = RECOVER[e.type];
  }
}
export function stepEnemy(s, e, h, env) {
  e.hit = Math.max(0, e.hit - h);
  e.timer = Math.max(0, (e.timer || 0) - h);
  const [cx, cy] = cellAt(e.x, e.y),
    distance = Math.hypot(e.x - s.player.x, e.y - s.player.y);
  if (e.state === 'sleep' && e.wake === 'near' && (s.path[cy]?.[cx] ?? 1000) <= WAKE_CELLS) {
    e.state = 'approach';
    // Packs wake together: nearby sleepers hear the first one.
    if (e.armor)
      for (const o of s.enemies)
        if (
          o.state === 'sleep' &&
          o.wake === 'near' &&
          Math.hypot(o.x - e.x, o.y - e.y) <= PACK_RADIUS
        )
          o.state = 'approach';
  }
  let velocity = [0, 0];
  if (e.state === 'approach') velocity = approach(s, e, distance);
  else if (e.state === 'windup' && e.timer === 0) finishWindup(s, e, env);
  else if (e.state === 'active') strike(s, e, env);
  else if (e.state === 'recover' && e.timer === 0) e.state = 'approach';
  driveBody(s, e, velocity[0], velocity[1], 420, h);
}
export function stepArrows(s, dt, env) {
  for (const p of s.projectiles) {
    const travel = Math.min(dt, Math.max(0, p.life));
    if (travel === 0) continue;
    const dx = p.vx * travel,
      dy = p.vy * travel;
    let wall = Infinity;
    for (
      let cy = Math.max(0, Math.floor((Math.min(p.y, p.y + dy) - 2 - 30) / 20));
      cy <= Math.min(13, Math.floor((Math.max(p.y, p.y + dy) + 2 - 30) / 20));
      cy++
    )
      for (
        let cx = Math.max(0, Math.floor((Math.min(p.x, p.x + dx) - 2 - 20) / 20));
        cx <= Math.min(21, Math.floor((Math.max(p.x, p.x + dx) + 2 - 20) / 20));
        cx++
      )
        if (solid(s, cx, cy))
          wall = Math.min(
            wall,
            rayBox(
              p.x,
              p.y,
              dx,
              dy,
              20 + cx * 20 - 2,
              30 + cy * 20 - 2,
              40 + cx * 20 + 2,
              50 + cy * 20 + 2,
            ),
          );
    const player = rayBox(
      p.x,
      p.y,
      dx,
      dy,
      s.player.x - HALF - 2,
      s.player.y - HALF - 2,
      s.player.x + HALF + 2,
      s.player.y + HALF + 2,
    );
    const active = p.active !== false && Math.hypot(p.vx, p.vy) > 1;
    const hit = Math.min(1, wall, active ? player : Infinity);
    p.x += dx * hit;
    p.y += dy * hit;
    p.life -= travel;
    if (wall <= 1 && (!active || wall <= player)) p.life = 0;
    else if (active && player <= 1) {
      hurt(s, env, p.x - p.vx * 0.01, p.y - p.vy * 0.01);
      p.life = 0;
    }
  }
  s.projectiles = s.projectiles.filter((p) => p.life > 1e-8);
}
