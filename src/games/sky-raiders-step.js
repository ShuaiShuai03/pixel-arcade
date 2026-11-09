// Damage rules and the event-ordered projectile, wave, supply and hull-contact step.
import {
  EPS,
  bodyContact,
  separateHulls,
  resolveHullImpact,
  sweepProjectile,
  movingCircle,
  waveTime,
  waveHullContacts,
  pickupTime,
  partPriority,
} from './sky-raiders-physics.js';
import { hullRects } from './sky-raiders-sprites.js';

export function burst(s, env, x, y, color, count = 8) {
  for (let n = 0; n < count; n++)
    s.particles.push({
      x,
      y,
      vx: (env.random() - 0.5) * 110,
      vy: (env.random() - 0.5) * 110,
      life: 0.4,
      color,
    });
  if (s.particles.length > 160) s.particles.splice(0, s.particles.length - 160);
}
export function hitPlayer(s, env, damage, cause) {
  if (damage <= 0 || s.player.invincible > 0 || s.lives <= 0) return false;
  s.lives = Math.max(0, s.lives - Math.min(1, damage));
  s.player.invincible = 0.95;
  s.damageFlash = 0.22;
  s.damageCause = cause;
  burst(s, env, s.player.x, s.player.y, '#a8edee', 12);
  env.sound('hit');
  return true;
}
export function openCore(enemy) {
  return (!enemy.parts || (enemy.parts.l <= 0 && enemy.parts.r <= 0)) && enemy.open !== false;
}
const POD_CYCLE = ['power', 'shield', 'charge'];
/** Every third kill drops a supply pod that cycles power, shield and charge; a full stock is skipped. */
function podKind(s) {
  const start = (s.kills / 3 - 1) % POD_CYCLE.length,
    full = {
      power: s.player.power >= 3,
      shield: s.lives >= 4,
      charge: s.pulses >= 3,
    };
  for (let n = 0; n < POD_CYCLE.length; n++) {
    const kind = POD_CYCLE[(start + n) % POD_CYCLE.length];
    if (!full[kind]) return kind;
  }
  return POD_CYCLE[start];
}
function hitEnemy(s, env, enemy, damage, part, credit, coreAvailable = openCore(enemy)) {
  if (enemy.dead) return;
  if (enemy.parts && ['l', 'r'].includes(part) && enemy.parts[part] > 0) {
    enemy.parts[part] = Math.max(0, enemy.parts[part] - damage);
    enemy.flash = 0.1;
    return;
  }
  if (enemy.boss && (!coreAvailable || part !== 'c')) {
    burst(s, env, enemy.x, enemy.y + 15, '#a5b1be', 3);
    return;
  }
  enemy.hp -= damage;
  enemy.flash = 0.1;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.dead = true;
    enemy.credited = !!credit;
    if (credit) {
      s.kills++;
      s.score += enemy.boss ? 500 * s.level : (enemy.score ?? 100);
    }
    burst(s, env, enemy.x, enemy.y, '#f7c383', enemy.boss ? 28 : 10);
    env.sound('coin');
    if (!enemy.boss && credit && s.kills % 3 === 0)
      s.pickups.push({
        id: s.nextId++,
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx * 0.3,
        vy: 25,
        kind: podKind(s),
        life: 10,
      });
  }
}
/** Replan at every physical event: destroyed geometry cannot affect a later trajectory. */
export function resolveProjectileStep(s, dt, env, integrateHulls = false) {
  const actors = [s.player, ...s.enemies],
    original = actors.map((a) => ({ x: a.x, y: a.y })),
    spent = new Set(),
    contacts = new Map();
  let remaining = dt;
  const advance = (h) => {
    for (const a of actors)
      if (!a.dead) {
        a.x += a.vx * h;
        a.y += a.vy * h;
      }
    for (const b of s.bullets)
      if (!spent.has(b.id)) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.life -= h;
      }
    for (const w of s.waves) {
      w.radius += w.speed * h;
      w.life -= h;
    }
    for (const p of s.pickups)
      if (!p.collected) {
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.life -= h;
      }
  };
  const settleContacts = () => {
    for (const [key, e] of contacts) {
      if (e.a.dead || e.b.dead || !bodyContact(e.a, e.b, 0, 1e-6)) contacts.delete(key);
    }
    for (let pass = 0; pass < 64; pass++) {
      let change = 0;
      for (const e of contacts.values())
        change = Math.max(change, resolveHullImpact(e.a, e.b, e, 0));
      if (change < EPS) break;
    }
  };
  // Each event consumes a projectile, pickup, wave target or previously unseen hull pair.
  // Rebuilding the queue also accounts for velocity changes from hull impulses.
  while (remaining > EPS) {
    settleContacts();
    const events = [];
    for (const bullet of s.bullets) {
      if (spent.has(bullet.id) || bullet.life <= 0) continue;
      for (const actor of actors) {
        if (
          actor.id === bullet.ownerId ||
          actor.dead ||
          (bullet.owner === 'player' && actor.id === 0)
        )
          continue;
        const hit = sweepProjectile(bullet, actor, Math.min(remaining, bullet.life));
        if (hit) events.push({ ...hit, type: 'hull', bullet, actor });
      }
    }
    for (let i = 0; i < s.bullets.length; i++)
      for (let j = i + 1; j < s.bullets.length; j++) {
        const a = s.bullets[i],
          b = s.bullets[j];
        if (spent.has(a.id) || spent.has(b.id) || a.life <= 0 || b.life <= 0 || a.owner === b.owner)
          continue;
        const time = movingCircle(a, b, Math.min(remaining, a.life, b.life));
        if (time !== null) events.push({ time, type: 'rounds', a, b });
      }
    for (const wave of s.waves) {
      if (wave.life <= 0 || wave.energy <= 0 || wave.radius >= wave.maxRadius) continue;
      const horizon = Math.min(remaining, wave.life, (wave.maxRadius - wave.radius) / wave.speed);
      for (const bullet of s.bullets)
        if (
          !spent.has(bullet.id) &&
          bullet.life > 0 &&
          bullet.owner === 'enemy' &&
          !wave.hit.includes(`b${bullet.id}`) &&
          wave.energy > 0.2
        ) {
          const time = waveTime(wave, bullet, Math.min(horizon, bullet.life));
          if (time !== null) events.push({ time, type: 'waveRound', wave, bullet });
        }
      for (const actor of actors)
        if (actor.id !== 0 && !actor.dead && !wave.hit.includes(`e${actor.id}`)) {
          const hit = waveHullContacts(wave, actor, horizon).sort(
            (a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part),
          )[0];
          if (hit) events.push({ ...hit, type: 'waveHull', wave, actor });
        }
    }
    for (const pod of s.pickups)
      if (!pod.collected && pod.life > 0 && s.lives > 0) {
        const time = pickupTime(pod, s.player, Math.min(remaining, pod.life));
        if (time !== null) events.push({ time, type: 'pickup', pod });
      }
    if (integrateHulls)
      for (let i = 0; i < actors.length; i++)
        for (let j = i + 1; j < actors.length; j++) {
          const a = actors[i],
            b = actors[j],
            key = `${a.id}:${b.id}`;
          if (a.dead || b.dead || contacts.has(key)) continue;
          const hit = bodyContact(a, b, remaining);
          if (hit) events.push({ ...hit, type: 'body', a, b, key });
        }
    if (!events.length) {
      advance(remaining);
      remaining = 0;
      break;
    }
    events.sort((a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part));
    const time = Math.min(remaining, events[0].time),
      group = events.filter((e) => Math.abs(e.time - time) < EPS);
    advance(time);
    remaining -= time;
    const damages = new Map(),
      impacts = new Map(),
      newSpent = new Set();
    let playerDamage = 0,
      collisionDamage = 0;
    // Supplies at this instant are collected before simultaneous damage. A previous fatal event stays fatal.
    for (const e of group)
      if (e.type === 'pickup' && !e.pod.collected && s.lives > 0) {
        e.pod.collected = true;
        if (e.pod.kind === 'shield') s.lives = Math.min(4, s.lives + 1);
        else if (e.pod.kind === 'charge') s.pulses = Math.min(3, s.pulses + 1);
        else s.player.power = Math.min(3, s.player.power + 1);
        s.score += 50;
        env.sound('coin');
      }
    const addDamage = (actor, part, damage, credit) => {
      const key = `${actor.id}:${part}`,
        entry = damages.get(key) ?? {
          actor,
          part,
          damage: 0,
          credit: false,
          coreAvailable: openCore(actor),
        };
      entry.damage += damage;
      entry.credit ||= credit;
      damages.set(key, entry);
    };
    for (const e of group) {
      if (
        e.type === 'hull' &&
        !spent.has(e.bullet.id) &&
        !newSpent.has(e.bullet.id) &&
        !e.actor.dead
      ) {
        newSpent.add(e.bullet.id);
        const impact = impacts.get(e.actor.id) ?? { actor: e.actor, mass: 0, px: 0, py: 0 };
        impact.mass += e.bullet.mass;
        impact.px += e.bullet.mass * e.bullet.vx;
        impact.py += e.bullet.mass * e.bullet.vy;
        impacts.set(e.actor.id, impact);
        if (e.actor.id === 0) playerDamage++;
        else addDamage(e.actor, e.part, e.bullet.damage, e.bullet.owner === 'player');
      } else if (e.type === 'rounds' && !spent.has(e.a.id) && !spent.has(e.b.id)) {
        newSpent.add(e.a.id);
        newSpent.add(e.b.id);
      } else if (e.type === 'waveRound' && !spent.has(e.bullet.id) && e.wave.energy > 0.2) {
        newSpent.add(e.bullet.id);
        e.wave.energy -= 0.2;
        e.wave.hit.push(`b${e.bullet.id}`);
      } else if (
        e.type === 'waveHull' &&
        !e.actor.dead &&
        e.wave.energy > 0 &&
        !e.wave.hit.includes(`e${e.actor.id}`)
      ) {
        const damage = Math.min(e.actor.boss ? 7 : 4, e.wave.energy);
        e.wave.energy -= damage;
        e.wave.hit.push(`e${e.actor.id}`);
        addDamage(e.actor, e.part, damage, true);
      } else if (e.type === 'body' && !e.a.dead && !e.b.dead) {
        contacts.set(e.key, e);
        const closing = resolveHullImpact(e.a, e.b, e);
        if ((e.a.id === 0 || e.b.id === 0) && closing > 45) collisionDamage++;
      }
    }
    // Absorbed cartridges add their mass and momentum; thrusters correct the small kick next tick.
    for (const { actor, mass, px, py } of impacts.values()) {
      actor.vx = (actor.mass * actor.vx + px) / (actor.mass + mass);
      actor.vy = (actor.mass * actor.vy + py) / (actor.mass + mass);
      actor.mass += mass;
    }
    settleContacts();
    for (const id of newSpent) spent.add(id);
    for (const e of damages.values())
      hitEnemy(s, env, e.actor, e.damage, e.part, e.credit, e.coreAvailable);
    hitPlayer(s, env, playerDamage + collisionDamage, collisionDamage ? 'collision' : 'round');
  }
  if (integrateHulls) separateHulls(actors);
  else for (let i = 0; i < actors.length; i++) Object.assign(actors[i], original[i]);
  s.bullets = s.bullets.filter(
    (b) => !spent.has(b.id) && b.life > 0 && b.x > -40 && b.x < 520 && b.y > -60 && b.y < 350,
  );
  s.waves = s.waves.filter((w) => w.radius < w.maxRadius && w.life > 0 && w.energy > 0);
}
