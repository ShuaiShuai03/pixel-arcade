// Iron Bastion physics: swept circle geometry, tank contacts, driving, firing and shell chronology.
import { clamp } from '../shared/utils.js';
import { BASE, R, SHELL_MASS, SHELL_R, ARENA } from './iron-bastion-data.js';
import { destroy, finish, sparks, toast } from './iron-bastion-rules.js';

const EPSILON = 1e-10;
const MAX_EVENT_LOOPS = 128;
const SHELL_PAIR_RADIUS = 4;
const EVENT_PRIORITY = { shell: 0, tile: 1, base: 2, tank: 3, wall: 4, expire: 5 };

export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function circleHitsRect(x, y, r, box) {
  const px = clamp(x, box.x, box.x + box.w),
    py = clamp(y, box.y, box.y + box.h);
  return (x - px) ** 2 + (y - py) ** 2 <= r * r;
}

function circleTOI(x, y, dx, dy, cx, cy, r) {
  const ox = x - cx,
    oy = y - cy,
    c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = 2 * (ox * dx + oy * dy),
    disc = b * b - 4 * a * c;
  if (a === 0 || b >= 0 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : Infinity;
}

// First fraction (0..1) of the move at which a circle touches a rectangle, or Infinity.
export function sweepCircleRect(x, y, dx, dy, r, box) {
  if (circleHitsRect(x, y, r, box)) return 0;
  let best = Infinity;
  if (dx !== 0)
    for (const edge of [box.x - r, box.x + box.w + r]) {
      const t = (edge - x) / dx,
        py = y + dy * t;
      if (t >= 0 && t <= 1 && py >= box.y && py <= box.y + box.h) best = Math.min(best, t);
    }
  if (dy !== 0)
    for (const edge of [box.y - r, box.y + box.h + r]) {
      const t = (edge - y) / dy,
        px = x + dx * t;
      if (t >= 0 && t <= 1 && px >= box.x && px <= box.x + box.w) best = Math.min(best, t);
    }
  for (const cx of [box.x, box.x + box.w])
    for (const cy of [box.y, box.y + box.h])
      best = Math.min(best, circleTOI(x, y, dx, dy, cx, cy, r));
  return best;
}

export function bodyFree(s, x, y, r = R) {
  return (
    x - r >= ARENA.left &&
    x + r <= ARENA.right &&
    y - r >= ARENA.top &&
    y + r <= ARENA.bottom &&
    !circleHitsRect(x, y, r, BASE) &&
    !s.tiles.some((t) => circleHitsRect(x, y, r, t))
  );
}

function staticContact(s, a) {
  for (const t of [BASE, ...s.tiles]) {
    const px = clamp(a.x, t.x, t.x + t.w),
      py = clamp(a.y, t.y, t.y + t.h);
    let dx = a.x - px,
      dy = a.y - py,
      d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-9) {
      const edges = [
        { d: Math.abs(a.x - t.x), nx: -1, ny: 0 },
        { d: Math.abs(a.x - t.x - t.w), nx: 1, ny: 0 },
        { d: Math.abs(a.y - t.y), nx: 0, ny: -1 },
        { d: Math.abs(a.y - t.y - t.h), nx: 0, ny: 1 },
      ].sort((b, c) => b.d - c.d);
      dx = edges[0].nx;
      dy = edges[0].ny;
      d = -edges[0].d;
    } else {
      dx /= d;
      dy /= d;
    }
    a.x += dx * (R - d + 0.0001);
    a.y += dy * (R - d + 0.0001);
    const vn = a.vx * dx + a.vy * dy;
    if (vn < 0) {
      a.vx -= vn * dx;
      a.vy -= vn * dy;
    }
  }
  if (a.x < ARENA.minX) {
    a.x = ARENA.minX;
    a.vx = Math.max(0, a.vx);
  }
  if (a.x > ARENA.maxX) {
    a.x = ARENA.maxX;
    a.vx = Math.min(0, a.vx);
  }
  if (a.y < ARENA.minY) {
    a.y = ARENA.minY;
    a.vy = Math.max(0, a.vy);
  }
  if (a.y > ARENA.maxY) {
    a.y = ARENA.maxY;
    a.vy = Math.min(0, a.vy);
  }
}

export function resolveTankContacts(s) {
  const actors = [s.player, ...s.enemies.filter((e) => e.hp > 0)].toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (let n = 0; n < 6; n++) {
    for (let i = 0; i < actors.length; i++)
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i],
          b = actors[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= R * 2) continue;
        const nx = d > 1e-9 ? dx / d : 1,
          ny = d > 1e-9 ? dy / d : 0,
          am = a.mass,
          bm = b.mass,
          total = am + bm,
          depth = R * 2 - d;
        a.x -= (nx * depth * bm) / total;
        a.y -= (ny * depth * bm) / total;
        b.x += (nx * depth * am) / total;
        b.y += (ny * depth * am) / total;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const impulse = -vn / (1 / am + 1 / bm);
          a.vx -= (impulse * nx) / am;
          a.vy -= (impulse * ny) / am;
          b.vx += (impulse * nx) / bm;
          b.vy += (impulse * ny) / bm;
        }
      }
    for (const a of actors) staticContact(s, a);
  }
}

export function turn(a, key, velocityKey, target, dt, manual = null) {
  const wanted = manual === null ? clamp(wrap(target - a[key]) * 8, -5, 5) : manual;
  a[velocityKey] += clamp(wanted - a[velocityKey], -24 * dt, 24 * dt);
  a[key] = wrap(a[key] + a[velocityKey] * dt);
}

export function drive(a, bearing, throttle, dt, maxSpeed) {
  turn(a, 'angle', 'omega', bearing, dt);
  const fx = Math.cos(a.angle),
    fy = Math.sin(a.angle),
    along = a.vx * fx + a.vy * fy,
    lateral = -a.vx * fy + a.vy * fx;
  const desired =
    throttle && Math.abs(wrap(bearing - a.angle)) < 0.8
      ? maxSpeed * Math.max(0, Math.cos(wrap(bearing - a.angle)))
      : 0;
  const forward = along + clamp(desired - along, -350 * dt, 190 * dt),
    side = lateral + clamp(-lateral, -260 * dt, 260 * dt);
  const oldVX = a.vx,
    oldVY = a.vy;
  a.vx = fx * forward - fy * side;
  a.vy = fy * forward + fx * side;
  a.x += (oldVX + a.vx) * 0.5 * dt;
  a.y += (oldVY + a.vy) * 0.5 * dt;
}

export function fireShell(s, a, owner, env) {
  const dx = Math.cos(a.turret),
    dy = Math.sin(a.turret),
    speed = owner === 'player' ? 300 : 160;
  if (a.mass <= SHELL_MASS || a.rounds === 0) return false;
  a.rounds--;
  const previousVX = a.vx,
    previousVY = a.vy,
    remainingMass = a.mass - SHELL_MASS;
  s.bullets.push({
    id: `shell:${s.shellId++}`,
    x: a.x + dx * 10,
    y: a.y + dy * 10,
    vx: a.vx + dx * speed,
    vy: a.vy + dy * speed,
    r: SHELL_R,
    mass: SHELL_MASS,
    owner,
    shooter: a.id,
    life: 3.5,
  });
  // The stored round was already moving with the vehicle. Ejection removes
  // its mass and momentum from the loaded hull in every inertial frame.
  a.vx = (a.mass * previousVX - SHELL_MASS * (previousVX + dx * speed)) / remainingMass;
  a.vy = (a.mass * previousVY - SHELL_MASS * (previousVY + dy * speed)) / remainingMass;
  a.mass = remainingMass;
  a.muzzle = 0.08;
  env.sound('shoot');
  return true;
}

// Global earliest-event processing: exact circle/rectangle corners and moving
// circle targets; tied impacts accumulate before any terminal result is chosen.
export function stepShells(s, dt, env, starts = new Map()) {
  let left = dt,
    elapsed = 0;
  for (let loop = 0; loop < MAX_EVENT_LOOPS && left > EPSILON && s.phase === 'playing'; loop++) {
    s.bullets = s.bullets.filter((b) => b.life > EPSILON);
    const events = [],
      bodies = [s.player, ...s.enemies.filter((e) => e.hp > 0)];
    const add = (t, kind, b, target = null) => {
      if (t >= -EPSILON && t <= left + EPSILON) events.push({ t: Math.max(0, t), kind, b, target });
    };
    for (const b of s.bullets) {
      add(b.life, 'expire', b);
      for (const t of s.tiles)
        add(sweepCircleRect(b.x, b.y, b.vx * left, b.vy * left, SHELL_R, t) * left, 'tile', b, t);
      add(sweepCircleRect(b.x, b.y, b.vx * left, b.vy * left, SHELL_R, BASE) * left, 'base', b);
      for (const a of bodies)
        if (a.id !== b.shooter) {
          const old = starts.get(a.id) || a,
            mvx = (a.x - old.x) / dt,
            mvy = (a.y - old.y) / dt,
            ax = old.x + mvx * elapsed,
            ay = old.y + mvy * elapsed;
          add(
            circleTOI(b.x, b.y, (b.vx - mvx) * left, (b.vy - mvy) * left, ax, ay, R + SHELL_R) *
              left,
            'tank',
            b,
            a,
          );
        }
      if (b.vx < 0) add((ARENA.wallLeft - b.x) / b.vx, 'wall', b);
      if (b.vx > 0) add((ARENA.wallRight - b.x) / b.vx, 'wall', b);
      if (b.vy < 0) add((ARENA.wallTop - b.y) / b.vy, 'wall', b);
      if (b.vy > 0) add((ARENA.wallBottom - b.y) / b.vy, 'wall', b);
    }
    for (let i = 0; i < s.bullets.length; i++)
      for (let j = i + 1; j < s.bullets.length; j++) {
        const a = s.bullets[i],
          b = s.bullets[j];
        add(
          circleTOI(
            a.x,
            a.y,
            (a.vx - b.vx) * left,
            (a.vy - b.vy) * left,
            b.x,
            b.y,
            SHELL_PAIR_RADIUS,
          ) * left,
          'shell',
          a,
          b,
        );
      }
    const first = events.length ? Math.min(...events.map((e) => e.t)) : left;
    for (const b of s.bullets) {
      b.x += b.vx * first;
      b.y += b.vy * first;
      b.life -= first;
    }
    left -= first;
    elapsed += first;
    const due = events.filter((e) => Math.abs(e.t - first) < 1e-8);
    due.sort(
      (a, b) =>
        EVENT_PRIORITY[a.kind] - EVENT_PRIORITY[b.kind] ||
        String(a.target?.id || '').localeCompare(String(b.target?.id || '')) ||
        a.b.id.localeCompare(b.b.id),
    );
    if (!due.length) break;
    const used = new Set(),
      tileDamage = new Map(),
      tankDamage = new Map();
    let baseHits = 0,
      playerHits = 0;
    for (const e of due) {
      const b = e.b;
      if (used.has(b.id)) continue;
      if (e.kind === 'shell') {
        if (used.has(e.target.id)) continue;
        used.add(b.id);
        used.add(e.target.id);
        sparks(s, (b.x + e.target.x) / 2, (b.y + e.target.y) / 2, 'intercept');
        env.sound('hit');
        continue;
      }
      used.add(b.id);
      if (e.kind === 'tile') {
        sparks(s, b.x, b.y, e.target.steel ? 'steel' : 'brick');
        if (!e.target.steel) {
          const d = tileDamage.get(e.target.id) || { tile: e.target, count: 0, player: false };
          d.count++;
          d.player ||= b.owner === 'player';
          tileDamage.set(e.target.id, d);
        }
      }
      if (e.kind === 'base') {
        baseHits++;
        sparks(s, b.x, b.y, 'hurt');
        if (b.owner === 'player') toast(s, 'Friendly shell hit the beacon!', '友方炮弹击中信标！');
      }
      if (e.kind === 'tank') {
        const a = e.target,
          mass = b.mass,
          total = a.mass + mass;
        // Armor retains shell fragments: an inelastic capture adds their mass.
        a.vx = (a.mass * a.vx + mass * b.vx) / total;
        a.vy = (a.mass * a.vy + mass * b.vy) / total;
        a.mass = total;
        a.flash = 0.45;
        if (a.id === 'player') playerHits++;
        else {
          const d = tankDamage.get(a.id) || { tank: a, count: 0, player: false };
          d.count++;
          d.player ||= b.owner === 'player';
          tankDamage.set(a.id, d);
        }
        sparks(s, b.x, b.y, 'hurt');
      }
    }
    for (const d of tileDamage.values()) {
      d.tile.hp -= d.count;
      if (d.tile.hp <= 0) {
        if (d.player) s.score += 10;
        s.rubble.push({ x: d.tile.x, y: d.tile.y });
      }
    }
    s.tiles = s.tiles.filter((t) => t.steel || t.hp > 0);
    if (s.rubble.length > 60) s.rubble.splice(0, s.rubble.length - 60);
    for (const d of tankDamage.values()) {
      d.tank.hp -= d.count;
      if (d.tank.hp <= 0) destroy(s, d.tank, d.player, env);
    }
    s.enemies = s.enemies.filter((e) => e.hp > 0);
    s.baseHealth = Math.max(0, s.baseHealth - baseHits);
    s.lives = Math.max(0, s.lives - playerHits);
    if (baseHits || playerHits) env.sound('hit');
    s.bullets = s.bullets.filter((b) => !used.has(b.id) && b.life > EPSILON);
    if (s.baseHealth === 0 || s.lives === 0) {
      finish(s, env, false);
      return;
    }
  }
}
