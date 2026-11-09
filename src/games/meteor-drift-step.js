// Meteor Drift simulation: the pilot, weapons, sector flow and the fixed-step update.
import { wrap, delta, WIDTH, HEIGHT } from './meteor-drift-math.js';
import { LEVEL_COUNT, LEVELS, makeRocks } from './meteor-drift-levels.js';
import {
  rockRadius,
  rockMass,
  identify,
  sweptContact,
  dust,
  hitRock,
  fracture,
  resolvePair,
  safestLaunch,
} from './meteor-drift-physics.js';

export const HULL_RADIUS = 15;
export const MAX_HULL = 3;
export const MAX_LIVES = 5;
export const MAGAZINE = 24;
export const START_SHIELD = 3;
export const TIP_SECONDS = 7;
const SUBSTEP_RATE = 240;
export const MAX_SPEED = 150;
const THRUST = 110;
export const SHOT_LIFE = 0.6;
const BASE_MASS = 12;
const ROUND_MASS = 0.02;
const RELOAD_SECONDS = 1.6;
const LIFE_EVERY = 4;
const CLEAR_BONUS = 500;
const ROCK_BIRTH = 1.1;
const HIT_SHIELD = 1.2;
const LAUNCH_SHIELD = 2;
const LEVEL_SHIELD = 1.1;

export function launchShip(ammo, x = WIDTH / 2, y = HEIGHT / 2) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    omega: 0,
    mass: BASE_MASS + ammo * ROUND_MASS,
  };
}
/** Stock the magazine and reserve for a sector and bring in its rocks. */
function beginLevel(s, level, random) {
  const spec = LEVELS[level - 1];
  s.level = level;
  s.ammo = Math.min(MAGAZINE, spec.ammo);
  s.reserve = spec.ammo - s.ammo;
  s.reload = 0;
  s.shots = [];
  s.banner = TIP_SECONDS;
  s.rocks = makeRocks(level, random, s.ship).map((r) => ({
    ...r,
    id: s.nextId++,
    birth: ROCK_BIRTH,
  }));
}
export function createMeteorState(random, level = 1) {
  const first = LEVELS[level - 1],
    s = {
      phase: 'playing',
      score: 0,
      level,
      lives: 3,
      hull: MAX_HULL,
      ship: launchShip(first.ammo),
      rocks: [],
      shots: [],
      particles: [],
      invulnerable: START_SHIELD,
      fireCooldown: 0,
      time: 0,
      thrusting: false,
      braking: false,
      pulseCooldown: 0,
      pulseFlash: 0,
      banner: 0,
      ammo: 0,
      reserve: 0,
      reload: 0,
      impactFlash: 0,
      nextId: 1,
      shotsFired: 0,
    };
  beginLevel(s, level, random);
  return s;
}
export function fire(s, charged) {
  const rounds = charged ? 5 : 1;
  if (s.ammo < rounds) return false;
  const mass = rounds * ROUND_MASS,
    speed = charged ? 300 : 350,
    ship = s.ship,
    dx = Math.cos(ship.angle),
    dy = Math.sin(ship.angle),
    oldVx = ship.vx,
    oldVy = ship.vy;
  s.shots.push({
    x: wrap(ship.x + dx * 18, WIDTH),
    y: wrap(ship.y + dy * 18, HEIGHT),
    vx: oldVx + dx * speed,
    vy: oldVy + dy * speed,
    life: SHOT_LIFE,
    radius: charged ? 4 : 2,
    mass,
    charged,
    damage: charged ? 2 : 1,
    energy: charged ? 12000 : 0,
  });
  ship.mass -= mass;
  ship.vx -= (dx * speed * mass) / ship.mass;
  ship.vy -= (dy * speed * mass) / ship.mass;
  s.ammo -= rounds;
  s.shotsFired++;
  s.muzzle = 0.08;
  if (charged) {
    s.pulseCooldown = 7;
    s.pulseFlash = 0.2;
  }
  if (s.ammo < 5 && s.reserve > 0 && s.reload <= 0) s.reload = RELOAD_SECONDS;
  return true;
}
export function stepMeteors(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.ship.omega ??= 0;
  s.ship.mass ??= BASE_MASS + (s.ammo + s.reserve) * ROUND_MASS;
  for (const r of s.rocks) identify(s, r);
  const fastest = Math.max(
    Math.hypot(s.ship.vx, s.ship.vy),
    ...s.rocks.map((r) => Math.hypot(r.vx, r.vy)),
    0,
  );
  const count = Math.max(1, Math.ceil(dt * Math.max(SUBSTEP_RATE, fastest / 2) - 1e-9)),
    sub = dt / count;
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    simulateMeteors(
      s,
      sub,
      i === 0
        ? input
        : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      random,
    );
}
export function simulateMeteors(s, dt, input, random) {
  s.time += dt;
  for (const key of [
    'invulnerable',
    'pulseCooldown',
    'pulseFlash',
    'banner',
    'impactFlash',
    'fireCooldown',
    'muzzle',
  ])
    s[key] = Math.max(0, (s[key] ?? 0) - dt);
  if (s.reload > 0) {
    s.reload = Math.max(0, s.reload - dt);
    if (s.reload === 0) {
      const rounds = Math.min(MAGAZINE - s.ammo, s.reserve);
      s.ammo += rounds;
      s.reserve -= rounds;
    }
  }
  const turn =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.braking = input.held('ArrowDown', 'KeyS');
  s.thrusting = input.held('ArrowUp', 'KeyW') && !s.braking;
  let alpha = turn * 9;
  if (turn && turn * s.ship.omega >= 3.4) alpha = 0;
  else if (turn && dt > 0 && turn * (s.ship.omega + alpha * dt) > 3.4)
    alpha = (turn * 3.4 - s.ship.omega) / dt;
  if (input.pointer.down && input.pointer.x >= 0) {
    const aim = Math.atan2(
      delta(input.pointer.y - s.ship.y, HEIGHT),
      delta(input.pointer.x - s.ship.x, WIDTH),
    );
    alpha = Math.max(
      -9,
      Math.min(9, 12 * delta(aim - s.ship.angle, Math.PI * 2) - 5 * s.ship.omega),
    );
  }
  if (s.braking && dt > 0)
    alpha = -Math.sign(s.ship.omega) * Math.min(12, Math.abs(s.ship.omega) / dt);
  let ax = 0,
    ay = 0;
  if (s.braking && dt > 0) {
    const speed = Math.hypot(s.ship.vx, s.ship.vy),
      force = Math.min(220, speed / dt);
    if (speed) {
      ax = (-s.ship.vx / speed) * force;
      ay = (-s.ship.vy / speed) * force;
    }
  } else if (s.thrusting) {
    const middle = s.ship.angle + (s.ship.omega * dt) / 2 + (alpha * dt * dt) / 8;
    const ux = Math.cos(middle),
      uy = Math.sin(middle),
      pushing = s.ship.vx * ux + s.ship.vy * uy > 0;
    // The thrusters cut out once the ship is at top speed and still pushing the same way.
    if (!pushing || Math.hypot(s.ship.vx, s.ship.vy) < MAX_SPEED) {
      ax = ux * THRUST;
      ay = uy * THRUST;
    }
  }
  s.turning = Math.abs(alpha) > 0.01 ? Math.sign(alpha) : 0;
  const charged = input.pressed('ShiftLeft', 'ShiftRight') && s.pulseCooldown <= 0 && fire(s, true);
  if (
    !charged &&
    (input.held('Space', 'KeyZ') || input.pointer.down) &&
    s.fireCooldown <= 0 &&
    fire(s, false)
  )
    s.fireCooldown = 0.18;
  s.ship.x = wrap(s.ship.x + s.ship.vx * dt + (ax * dt * dt) / 2, WIDTH);
  s.ship.y = wrap(s.ship.y + s.ship.vy * dt + (ay * dt * dt) / 2, HEIGHT);
  s.ship.vx += ax * dt;
  s.ship.vy += ay * dt;
  s.ship.angle = delta(s.ship.angle + s.ship.omega * dt + (alpha * dt * dt) / 2, Math.PI * 2);
  s.ship.omega += alpha * dt;
  // Resolve weapon events chronologically, then advance the remaining time once.
  let remaining = dt;
  const advance = (time) => {
    for (const r of s.rocks)
      if (!r.dead) {
        r.x = wrap(r.x + r.vx * time, WIDTH);
        r.y = wrap(r.y + r.vy * time, HEIGHT);
        r.angle = delta(r.angle + r.spin * time, Math.PI * 2);
      }
    for (const shot of s.shots)
      if (shot.life > 0) {
        const travel = Math.min(time, shot.life);
        shot.x = wrap(shot.x + shot.vx * travel, WIDTH);
        shot.y = wrap(shot.y + shot.vy * travel, HEIGHT);
        shot.life -= time;
      }
  };
  const maxEvents = s.shots.length;
  for (let event = 0; event <= maxEvents; event++) {
    let victim = null,
      bullet = null,
      time = Infinity;
    for (const shot of s.shots)
      if (shot.life > 0)
        for (const r of s.rocks) {
          if (r.dead || (r.birth ?? 0) > 0) continue;
          const hit = sweptContact(
            shot,
            r,
            Math.min(remaining, shot.life),
            rockRadius(r) + (shot.radius ?? 0),
          );
          if (hit < time) {
            time = hit;
            victim = r;
            bullet = shot;
          }
        }
    if (!victim) {
      advance(remaining);
      remaining = 0;
      break;
    }
    advance(time);
    remaining -= time;
    hitRock(s, victim, bullet, random);
  }
  if (remaining > 0) advance(remaining);
  s.shots = s.shots.filter((b) => b.life > 0);
  for (const r of [...s.rocks]) {
    if (r.dead) continue;
    r.birth = Math.max(0, (r.birth ?? 0) - dt);
    r.flash = Math.max(0, (r.flash ?? 0) - dt);
    if (r.fuse !== undefined) {
      r.fuse -= dt;
      if (r.fuse <= 0) fracture(s, r, random);
    }
  }
  s.rocks = s.rocks.filter((r) => !r.dead);
  const solid = s.rocks.filter((r) => (r.birth ?? 0) <= 0);
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++)
      resolvePair(
        solid[i],
        solid[j],
        rockRadius(solid[i]),
        rockRadius(solid[j]),
        rockMass(solid[i]),
        rockMass(solid[j]),
      );
  for (const r of solid) {
    const contact = resolvePair(s.ship, r, HULL_RADIUS, rockRadius(r), s.ship.mass, rockMass(r));
    if (!contact || contact.speed < 55 || s.invulnerable > 0) continue;
    s.hull--;
    s.impactFlash = 0.35;
    s.invulnerable = HIT_SHIELD;
    dust(s, { x: contact.x, y: contact.y, vx: s.ship.vx, vy: s.ship.vy, mass: 0, size: 1 });
    if (s.hull <= 0) {
      s.lives--;
      if (s.lives <= 0) {
        s.phase = 'lost';
        break;
      }
      const safe = safestLaunch(s.rocks);
      s.ship = launchShip(s.ammo + s.reserve, safe.x, safe.y);
      s.hull = MAX_HULL;
      s.invulnerable = LAUNCH_SHIELD;
      s.banner = 1;
    }
  }
  for (const p of s.particles) {
    p.x = wrap(p.x + p.vx * dt, WIDTH);
    p.y = wrap(p.y + p.vy * dt, HEIGHT);
    p.life -= dt;
  }
  s.particles = s.particles.filter((p) => p.life > 0).slice(-120);
  if (
    s.ammo === 0 &&
    s.reserve === 0 &&
    s.shots.length === 0 &&
    s.rocks.length &&
    !s.rocks.some((r) => r.fuse !== undefined)
  ) {
    s.phase = 'lost';
    s.reason = 'ammo';
  }
  if (!s.rocks.length && s.phase === 'playing') {
    s.score += CLEAR_BONUS;
    if (s.level === LEVEL_COUNT) s.phase = 'won';
    else {
      beginLevel(s, s.level + 1, random);
      s.hull = Math.min(MAX_HULL, s.hull + 1);
      if (s.level % LIFE_EVERY === 0) s.lives = Math.min(MAX_LIVES, s.lives + 1);
      s.invulnerable = Math.max(s.invulnerable, LEVEL_SHIELD);
      s.ship.mass = BASE_MASS + (s.ammo + s.reserve) * ROUND_MASS;
    }
  }
}
