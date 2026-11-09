// Enemy behaviour: formation sweep, diver attacks, telegraphed volleys and their projectiles.
import { clamp } from '../shared/utils.js';
import { LINE, body } from './orbit-invaders-sprites.js';
import {
  BOSSES,
  FAN_SPREAD,
  PAIR_OFFSETS,
  STRAGGLERS,
  ROLES,
  bossPhase,
  fleetSpeed,
  levelOf,
} from './orbit-invaders-waves.js';

const LEAD_REACH = 330;
/** How far the fleet steps down at the end of each sweep. */
const DROP = 13;
export const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);
function steer(e, tx, ty, vx, vy, dt, maxSpeed = 125) {
  const safeY = LINE - body(e).h / 2 - 12;
  ty = Math.min(ty, safeY);
  const dx = tx - e.x,
    dy = ty - e.y,
    d = Math.hypot(dx, dy),
    targetX = vx + dx * 2,
    targetY = vy + dy * 2,
    length = Math.hypot(targetX, targetY);
  const desiredX = length > maxSpeed ? (targetX / length) * maxSpeed : targetX;
  // Reserve enough stopping distance for the vertical thrusters before the bunker line.
  const safeDown = Math.max(0, Math.sqrt(220 * Math.max(0, safeY - e.y)) - 110 * dt);
  const desiredY = Math.min(length > maxSpeed ? (targetY / length) * maxSpeed : targetY, safeDown);
  const oldX = e.vx,
    oldY = e.vy,
    change = clamp(desiredY - e.vy, -110 * dt, 110 * dt);
  e.vy += change;
  const horizontal = Math.sqrt(Math.max(0, (110 * dt) ** 2 - change ** 2));
  e.vx += clamp(desiredX - e.vx, -horizontal, horizontal);
  e.x += ((oldX + e.vx) * dt) / 2;
  e.y += ((oldY + e.vy) * dt) / 2;
  return d;
}
export function moveFormation(s, dt) {
  const f = s.formation,
    group = s.enemies.filter((e) => e.mode === 'formation');
  let dx = 0,
    dy = 0;
  const activeWing = s.enemies.some((e) => e.mode !== 'formation');
  if (f.phase === 'hold' && !activeWing) f.phase = 'brake';
  const oldVx = f.vx,
    oldVy = f.vy;
  if (f.phase === 'drop') {
    f.dropStart ??= f.targetY - DROP;
    f.dropTime = Math.min(1.5, (f.dropTime || 0) + dt);
    const t = f.dropTime / 1.5,
      next = f.dropStart + DROP * (3 * t * t - 2 * t * t * t);
    dy = next - f.y;
    f.vy = (DROP * (6 * t - 6 * t * t)) / 1.5;
    f.vx = approach(f.vx, 0, 35 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    if (f.dropTime >= 1.5) {
      f.phase = 'sweep';
      f.direction *= -1;
      f.vy = 0;
    }
  } else if (!group.length) {
    f.vx = approach(f.vx, 0, 35 * dt);
    f.vy = approach(f.vy, 0, 70 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    dy = ((oldVy + f.vy) * dt) / 2;
  } else {
    // Reserve returning wings' slots so the fleet never strands a diver offscreen.
    const slots = s.enemies.map((e) => ({
      x: e.mode === 'formation' ? e.x : f.x + e.slotX,
      w: body(e).w,
    }));
    const left = Math.min(...slots.map((e) => e.x - e.w / 2)) - 8,
      right = 472 - Math.max(...slots.map((e) => e.x + e.w / 2));
    const speed = fleetSpeed(levelOf(s.wave), s.enemies.length, s.fleetSize);
    if (f.phase === 'sweep' && (f.direction > 0 ? right : left) <= (f.vx * f.vx) / 70 + 0.1)
      f.phase = 'brake';
    f.vx = approach(f.vx, f.phase === 'sweep' ? f.direction * speed : 0, 35 * dt);
    f.vy = approach(f.vy, 0, 70 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    const allowed = clamp(dx, -Math.max(0, left), Math.max(0, right));
    if (allowed !== dx) {
      dx = allowed;
      f.vx = 0;
      f.phase = 'brake';
    }
    if (f.phase === 'brake' && Math.abs(f.vx) < 0.001) {
      if (activeWing) f.phase = 'hold';
      else {
        f.phase = 'drop';
        f.targetY = f.y + DROP;
        f.dropStart = f.y;
        f.dropTime = 0;
      }
    }
  }
  f.x += dx;
  f.y += dy;
  s.direction = f.direction;
  for (const e of group) {
    e.x += dx;
    e.y += dy;
    e.vx = dt ? dx / dt : f.vx;
    e.vy = dt ? dy / dt : f.vy;
    e.homeY = f.y + e.slotY;
  }
  for (const e of s.enemies.filter((e) => e.mode !== 'formation')) {
    const targetX = f.x + e.slotX,
      targetY = Math.min(f.y + e.slotY, LINE - body(e).h / 2 - 12);
    const peers = s.enemies.filter((p) => p !== e && p.mode === 'formation');
    const laneY = Math.min(LINE - body(e).h / 2 - 12, Math.max(190, ...peers.map((p) => p.y + 32)));
    if (e.mode === 'windup') {
      e.x += dx;
      e.y += dy;
      e.vx = dt ? dx / dt : f.vx;
      e.vy = dt ? dy / dt : f.vy;
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        e.mode = 'dive';
        e.attackTimer = 2;
      }
    } else if (e.mode === 'dive') {
      e.attackTimer -= dt;
      const clear = e.y >= laneY - 4;
      steer(e, clear ? e.targetX : e.x, laneY, clear ? 0 : f.vx, 0, dt);
      if (e.attackTimer <= 0 || (clear && Math.hypot(e.x - e.targetX, e.y - laneY) < 9))
        e.mode = 'align';
    } else if (e.mode === 'align') {
      steer(e, targetX, laneY, f.vx, f.vy, dt);
      if (Math.abs(e.x - targetX) < 5 && Math.abs(e.y - laneY) < 8) e.mode = 'return';
    } else {
      const d = steer(e, targetX, targetY, f.vx, f.vy, dt);
      if (d < 1 && Math.hypot(e.vx - f.vx, e.vy - f.vy) < 110 * dt) {
        e.mode = 'formation';
        e.slotX = e.x - f.x;
        e.slotY = e.y - f.y;
      }
    }
  }
}
export function round(s, x, y, vx, vy, owner, hostile = false, heavy = false) {
  const p = {
    id: s.nextId++,
    x,
    y,
    vx,
    vy,
    w: heavy ? 6 : 3,
    h: heavy ? 10 : 8,
    damage: heavy ? 2 : 1,
    hp: heavy ? 2 : 1,
    owner,
    life: 3,
  };
  (hostile ? s.bullets : s.shots).push(p);
  if (hostile) s.enemyShotsFired++;
  else s.shotsFired++;
}
/** Queue a telegraphed round; a leading round is aimed where the hull will be if it keeps moving. */
function warn(
  s,
  e,
  { vx = 0, vy = 150, delay = 0.65, aim = false, lead = false, offset = 0, heavy = false } = {},
) {
  const x = e.x + offset,
    y = e.y + body(e).h / 2 + 5,
    flight = delay + Math.max(0, s.ship.y - y) / vy;
  s.warnings.push({
    id: s.nextId++,
    owner: e.id,
    offset,
    vx,
    vy,
    delay,
    aim,
    targetX: clamp(
      s.ship.x + clamp(s.ship.vx * flight * Number(lead), -LEAD_REACH, LEAD_REACH),
      22,
      458,
    ),
    targetY: s.ship.y,
    heavy,
    x,
    y,
  });
}
function bossVolley(s, boss, level) {
  const phase = BOSSES[level.boss].phases[bossPhase(boss)];
  for (const shot of phase.shots) warn(s, boss, shot);
  s.enemyCooldown = phase.gap;
}
function rankVolley(s, level, random) {
  const pool = s.enemies
    .filter(
      (e) =>
        e.mode === 'formation' &&
        !s.enemies.some((o) => o !== e && o.y > e.y && Math.abs(o.x - e.x) < body(o).w / 2 + 2),
    )
    .sort((a, b) => a.id - b.id);
  for (let n = 0; n < level.volley && pool.length; n++) {
    const e = pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0];
    const kind = ROLES[e.role]?.fire;
    const plain = { vy: level.vy, delay: 0.65 };
    if (kind === 'aim')
      warn(s, e, { vy: level.vy, aim: true, lead: level.lead, heavy: true, delay: 0.8 });
    else if (kind === 'fan')
      for (const vx of FAN_SPREAD)
        warn(s, e, { ...plain, vx, offset: Math.round(vx / 3), delay: 0.7 });
    else if (kind === 'pair')
      for (const offset of PAIR_OFFSETS) warn(s, e, { ...plain, offset, delay: 0.7 });
    else if (random() < level.aimShare)
      // Crossfire: rounds where the hull is heading, half way, and now.
      for (const lead of [1, 0.5, 0])
        warn(s, e, { vy: level.vy + 50, delay: 0.5 + lead * 0.1, aim: true, lead });
    else warn(s, e, plain);
  }
  s.enemyCooldown = (level.gap + random() * 0.2) * (s.enemies.length <= STRAGGLERS ? 2 : 1);
}
/** Start a dive for the first ready diver when the fleet is sweeping and no wing is out. */
function startDive(s, level) {
  const diver = s.enemies.find((e) => e.role === 'diver' && e.mode === 'formation');
  if (
    !diver ||
    s.formation.phase !== 'sweep' ||
    diver.y + 32 > LINE - body(diver).h / 2 - 12 ||
    s.enemies.some((e) => e.mode !== 'formation')
  )
    return;
  diver.mode = 'windup';
  diver.attackTimer = 0.75;
  diver.targetX = clamp(s.ship.x, 40, 440);
  warn(s, diver, { vy: level.vy + 30, aim: true, lead: level.lead, delay: 0.7 });
}
export function enemyFire(s, dt, random) {
  if (s.deploy > 0 || s.intermission > 0 || !s.enemies.length) return;
  const level = levelOf(s.wave);
  s.enemyCooldown -= dt;
  s.diveTimer -= dt;
  if (s.diveTimer <= 0) {
    startDive(s, level);
    s.diveTimer = level.dive || 5;
  }
  if (s.enemyCooldown > 0) return;
  const boss = s.enemies.find((e) => e.role === 'commander');
  if (boss) bossVolley(s, boss, level);
  else rankVolley(s, level, random);
}
export function fireWarnings(s, dt) {
  for (const w of s.warnings) {
    const e = s.enemies.find((e) => e.id === w.owner && e.hp > 0);
    if (!e) {
      w.dead = true;
      continue;
    }
    w.x = e.x + w.offset;
    w.y = e.y + body(e).h / 2 + 5;
    w.delay -= dt;
    if (w.delay > 0) continue;
    let vx = w.vx + e.vx,
      vy = w.vy + e.vy;
    if (w.aim) {
      const dx = w.targetX - w.x,
        dy = w.targetY - w.y,
        speed = w.vy,
        a = e.vx * e.vx + e.vy * e.vy - speed * speed,
        b = -2 * (dx * e.vx + dy * e.vy),
        c = dx * dx + dy * dy,
        disc = b * b - 4 * a * c;
      const roots =
        disc >= 0
          ? [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)].filter(
              (t) => t > 0,
            )
          : [];
      const t = roots.length ? Math.min(...roots) : Math.hypot(dx, dy) / speed;
      if (t > 0) {
        vx = dx / t;
        vy = dy / t;
      }
    }
    round(s, w.x, w.y, vx, vy, e.id, true, w.heavy);
    w.dead = true;
  }
  s.warnings = s.warnings.filter((w) => !w.dead);
}
