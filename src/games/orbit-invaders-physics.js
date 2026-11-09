// Swept projectile physics: exact contact times against sprite masks, bunkers, the guard plate and
// the ship, resolved in time order so no round can tunnel through a target at any frame rate.
import { clamp } from '../shared/utils.js';
import { HULL, LINE, MASKS, body } from './orbit-invaders-sprites.js';
import { ROLES } from './orbit-invaders-waves.js';

export function plate(s) {
  const w = s.barrierWidth,
    cx = clamp(s.ship.x, 8 + w / 2, 472 - w / 2);
  return { x: cx - w / 2, y: 266, w, h: 4, vx: s.ship.motionVx || 0, vy: 0 };
}
function hitTime(p, r, dt) {
  const vx = p.vx - (r.vx || 0),
    vy = p.vy - (r.vy || 0),
    left = r.x - p.w / 2,
    right = r.x + r.w + p.w / 2,
    top = r.y - p.h / 2,
    bottom = r.y + r.h + p.h / 2;
  let enter = 0,
    leave = Infinity;
  for (const [position, velocity, min, max] of [
    [p.x, vx, left, right],
    [p.y, vy, top, bottom],
  ]) {
    if (Math.abs(velocity) < 1e-12) {
      if (position < min || position > max) return Infinity;
      continue;
    }
    const a = (min - position) / velocity,
      b = (max - position) / velocity;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave + 1e-10) return Infinity;
  }
  return leave > enter + 1e-10 && enter >= -1e-10 && enter <= dt + 1e-10
    ? Math.max(0, enter)
    : Infinity;
}
function spriteContactTime(p, rect, mask, dt) {
  if (!Number.isFinite(hitTime(p, rect, dt))) return Infinity;
  let first = Infinity;
  for (const part of mask)
    first = Math.min(
      first,
      hitTime(
        p,
        { x: rect.x + part.x, y: rect.y + part.y, w: part.w, h: part.h, vx: rect.vx, vy: rect.vy },
        dt,
      ),
    );
  return first;
}
function sparks(s, x, y, color = '#ffda98') {
  s.particles.push({ x, y, life: 0.35, color });
}
export function projectilePhase(s, dt) {
  let clock = 0,
    remaining = dt;
  const projectiles = [...s.shots, ...s.bullets];
  const advance = (time) => {
    for (const p of projectiles)
      if (!p.dead) {
        p.x += p.vx * time;
        p.y += p.vy * time;
        p.life -= time;
      }
  };
  const targetRect = (e) => {
    const size = body(e);
    return {
      x: e.startX + e.motionVx * clock - size.w / 2,
      y: e.startY + e.motionVy * clock - size.h / 2,
      w: size.w,
      h: size.h,
      vx: e.motionVx,
      vy: e.motionVy,
    };
  };
  for (let iteration = 0; iteration < projectiles.length * 2 + s.enemies.length + 2; iteration++) {
    let earliest = Infinity,
      events = [];
    const add = (time, event) => {
      if (time < earliest - 1e-8) {
        earliest = time;
        events = [event];
      } else if (Math.abs(time - earliest) < 1e-8) events.push(event);
    };
    for (const p of projectiles)
      if (!p.dead && p.life > 0) {
        const hostile = s.bullets.includes(p),
          travel = Math.min(remaining, p.life);
        for (const b of s.shields)
          for (const block of b.blocks)
            if (block.hp > 0)
              add(hitTime(p, block, travel), { kind: 'cover', p, target: block, bunker: b });
        if (s.barrierWidth > 0 && s.barrierHp > 0) {
          const guard = plate(s);
          guard.x -= s.ship.motionVx * (dt - clock);
          add(hitTime(p, guard, travel), { kind: 'guard', p });
        }
        if (hostile) {
          const hull = {
            x: s.ship.startX + s.ship.motionVx * clock - HULL.w / 2,
            y: s.ship.y - HULL.h / 2,
            w: HULL.w,
            h: HULL.h,
            vx: s.ship.motionVx,
            vy: 0,
          };
          add(spriteContactTime(p, hull, MASKS.player, travel), { kind: 'ship', p });
        }
        for (const e of s.enemies)
          if (e.hp > 0 && e.id !== p.owner)
            add(spriteContactTime(p, targetRect(e), MASKS[e.role] || MASKS.scout, travel), {
              kind: 'enemy',
              p,
              target: e,
              hostile,
            });
        if (!hostile && s.ufo && s.ufo.hp > 0)
          add(
            spriteContactTime(
              p,
              {
                x: s.ufo.startX + s.ufo.vx * clock - 20,
                y: s.ufo.y - 6,
                w: 42,
                h: 12,
                vx: s.ufo.vx,
                vy: 0,
              },
              MASKS.bonus,
              travel,
            ),
            { kind: 'bonus', p, target: s.ufo },
          );
      }
    for (const shot of s.shots)
      if (!shot.dead && shot.life > 0)
        for (const bullet of s.bullets)
          if (!bullet.dead && bullet.life > 0)
            add(
              hitTime(
                shot,
                {
                  x: bullet.x - bullet.w / 2,
                  y: bullet.y - bullet.h / 2,
                  w: bullet.w,
                  h: bullet.h,
                  vx: bullet.vx,
                  vy: bullet.vy,
                },
                Math.min(remaining, shot.life, bullet.life),
              ),
              { kind: 'intercept', p: shot, target: bullet },
            );
    for (const e of s.enemies)
      if (e.hp > 0) {
        const rect = targetRect(e);
        if (rect.y + rect.h >= LINE - 1e-9) add(0, { kind: 'breach', target: e });
        else if (e.motionVy > 0)
          add((LINE - rect.y - rect.h) / e.motionVy, { kind: 'breach', target: e });
      }
    events = events.filter((e) => e.kind !== 'breach' || earliest <= remaining + 1e-9);
    if (!Number.isFinite(earliest) || earliest > remaining + 1e-9 || !events.length) {
      advance(remaining);
      clock += remaining;
      remaining = 0;
      break;
    }
    advance(earliest);
    clock += earliest;
    remaining = Math.max(0, remaining - earliest);
    const enemyDamage = new Map(),
      coverDamage = new Map(),
      interceptDamage = new Map(),
      bonusDamage = new Map();
    let shipHit = false,
      guardDamage = 0,
      breach = false;
    const used = new Set();
    // A projectile has one contact at a simultaneous timestamp; solids take precedence.
    const rank = { cover: 0, guard: 1, ship: 2, enemy: 3, bonus: 4 };
    const solidEvents = new Map();
    const canonical = (e) =>
      `${String(e.target?.id ?? 0).padStart(8, '0')}:${e.target?.x ?? 0}:${e.target?.y ?? 0}`;
    for (const e of events)
      if (e.p && e.kind !== 'intercept') {
        const prior = solidEvents.get(e.p);
        if (
          !prior ||
          rank[e.kind] < rank[prior.kind] ||
          (rank[e.kind] === rank[prior.kind] && canonical(e) < canonical(prior))
        )
          solidEvents.set(e.p, e);
      }
    const chosenInterceptions = new Map();
    for (const e of events
      .filter((e) => e.kind === 'intercept')
      .sort((a, b) => (a.target.id ?? 0) - (b.target.id ?? 0)))
      if (!solidEvents.has(e.p) && !solidEvents.has(e.target) && !chosenInterceptions.has(e.p))
        chosenInterceptions.set(e.p, e);
    events = [
      ...events.filter((e) => e.kind === 'breach'),
      ...solidEvents.values(),
      ...chosenInterceptions.values(),
    ];
    for (const event of events) {
      const p = event.p;
      if (event.kind === 'breach') {
        breach = true;
        continue;
      }
      if (p.dead) continue;
      if (event.kind === 'intercept') {
        interceptDamage.set(event.target, (interceptDamage.get(event.target) || 0) + 1);
        used.add(p);
        sparks(s, p.x, p.y, '#a9f4df');
      } else if (event.kind === 'cover') {
        coverDamage.set(event.target, (coverDamage.get(event.target) || 0) + p.damage);
        used.add(p);
        sparks(s, p.x, p.y);
      } else if (event.kind === 'guard') {
        guardDamage += p.damage;
        used.add(p);
        if (s.bullets.includes(p)) {
          s.intercepts++;
          s.score += 10;
        }
        sparks(s, p.x, p.y, '#a9f4df');
      } else if (event.kind === 'ship') {
        shipHit = true;
        used.add(p);
        sparks(s, p.x, p.y);
      } else if (event.kind === 'enemy') {
        const damage = enemyDamage.get(event.target) || { n: 0, player: false };
        damage.n += p.damage;
        damage.player ||= !event.hostile;
        enemyDamage.set(event.target, damage);
        used.add(p);
        sparks(s, p.x, p.y);
      } else {
        bonusDamage.set(event.target, (bonusDamage.get(event.target) || 0) + p.damage);
        used.add(p);
        sparks(s, p.x, p.y);
      }
    }
    for (const [p, damage] of interceptDamage) {
      p.hp -= damage;
      if (p.hp <= 0) {
        used.add(p);
        s.intercepts++;
        s.score += 15;
      }
    }
    for (const [bonus, damage] of bonusDamage) {
      bonus.hp -= damage;
      if (bonus.hp <= 0) {
        s.score += 250;
        s.ufo = null;
      }
    }
    for (const p of used) p.dead = true;
    for (const [block, damage] of coverDamage) block.hp = Math.max(0, block.hp - damage);
    for (const [e, damage] of enemyDamage) {
      e.hp -= damage.n;
      e.flash = 0.2;
      if (e.hp <= 0 && damage.player) s.score += ROLES[e.role]?.score ?? ROLES.scout.score;
    }
    s.barrierHp = Math.max(0, s.barrierHp - guardDamage);
    if (s.barrierHp === 0 && s.barrier > 0) {
      s.barrier = 0;
      s.barrierWidth = 0;
    }
    if (shipHit && s.invulnerable <= 0) {
      s.lives--;
      s.invulnerable = 1.1;
      s.hitFlash = 0.35;
    }
    if (s.lives <= 0 || breach) {
      s.phase = 'lost';
      s.reason = breach ? 'breach' : 'hull';
      break;
    }
    if (remaining <= 1e-12) break;
  }
  if (remaining > 0 && s.phase === 'playing') advance(remaining);
  s.shots = s.shots.filter(
    (p) => !p.dead && p.life > 0 && p.y > -10 && p.y < 330 && p.x > -10 && p.x < 490,
  );
  s.bullets = s.bullets.filter(
    (p) => !p.dead && p.life > 0 && p.y > -10 && p.y < 330 && p.x > -10 && p.x < 490,
  );
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  for (const b of s.shields) b.hp = b.blocks.reduce((hp, c) => hp + c.hp, 0);
  s.warnings = s.warnings.filter((w) => s.enemies.some((e) => e.id === w.owner));
}
