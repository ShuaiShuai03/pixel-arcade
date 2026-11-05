import { drawPixelText, background } from '../shared/utils.js';
export const meta = {
  id: 'meteor-drift',
  name: { en: 'Meteor Drift', zh: '陨石漂流' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Turn left', zh: '左转' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Turn right', zh: '右转' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Thrust', zh: '推进' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Brake', zh: '刹车' } },
    { code: 'ShiftLeft', side: 'right', label: { en: 'Burst', zh: '蓄能弹' } },
  ],
  description: {
    en: 'Clear five asteroid sectors. Turn jets retain spin; counter-turn or hold Down to brake. Fire with Space; Shift launches a charged round. Onboard reserve reloads empty magazines.',
    zh: '清理五个陨石星区。转向后会保持旋转，可反向转动或按下键制动。空格射击，Shift发射蓄能弹；弹匣耗尽后从机载储备自动装填。',
  },
  keys: [
    { label: { en: 'Turn', zh: '转向' }, keys: 'Left / Right or A / D' },
    { label: { en: 'Thrust', zh: '推进' }, keys: 'Up / W' },
    { label: { en: 'Fire', zh: '射击' }, keys: 'Space / Z' },
    { label: { en: 'Counter-thrust / burst', zh: '反推制动 / 蓄能弹' }, keys: 'Down / S; Shift' },
  ],
};
export const wrap = (v, max) => ((v % max) + max) % max;
const radius = (size) => (size === 3 ? 26 : size === 2 ? 16 : 8);
const HULL_RADIUS = 15;
const BASE_MASS = 12;
const ROUND_MASS = 0.02;
const MAGAZINE = 400;
const RESERVE = 3600;
const delta = (value, span) => wrap(value + span / 2, span) - span / 2;
const rockRadius = (r) => r.radius ?? radius(r.size);
const rockMass = (r) => r.mass ?? rockRadius(r) ** 2;
const inertia = (r) => r.inertia ?? 0.5 * rockMass(r) * rockRadius(r) ** 2;
function torusDistance(a, b) {
  return Math.hypot(delta(a.x - b.x, 480), delta(a.y - b.y, 320));
}
export function makeRocks(wave, random, avoid = { x: 240, y: 160 }) {
  const rocks = [];
  for (let i = 0; i < 3 + wave; i++) {
    let point;
    for (let attempt = 0; attempt < 100; attempt++) {
      const edge = (i + attempt) % 4;
      const candidate =
        edge === 0
          ? { x: random() * 480, y: 18 }
          : edge === 1
            ? { x: 462, y: random() * 320 }
            : edge === 2
              ? { x: random() * 480, y: 302 }
              : { x: 18, y: random() * 320 };
      if (
        torusDistance(candidate, avoid) > 105 &&
        rocks.every((r) => torusDistance(candidate, r) > 57)
      ) {
        point = candidate;
        break;
      }
    }
    if (!point) {
      const candidates = [];
      for (let y = 24; y < 320; y += 48)
        for (let x = 24; x < 480; x += 48) candidates.push({ x, y });
      point = candidates.sort(
        (a, b) =>
          Math.min(torusDistance(b, avoid) - 60, ...rocks.map((r) => torusDistance(b, r) - 30)) -
          Math.min(torusDistance(a, avoid) - 60, ...rocks.map((r) => torusDistance(a, r) - 30)),
      )[0];
    }
    const a = random() * Math.PI * 2,
      speed = 25 + random() * 16 + wave * 4;
    const kind =
      wave === 1
        ? 'stone'
        : wave === 2
          ? 'ice'
          : wave === 3
            ? 'iron'
            : wave === 4
              ? 'volatile'
              : ['ice', 'iron', 'volatile'][i % 3];
    rocks.push({
      ...point,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 3,
      radius: 26,
      mass: 676,
      kind,
      storedEnergy: kind === 'ice' ? 676 * 150 : kind === 'volatile' ? 676 * 2450 : 0,
      hp: kind === 'iron' ? 2 : 1,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 1.3,
    });
  }
  return rocks;
}
function launchShip(x = 240, y = 160) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    omega: 0,
    mass: BASE_MASS + (MAGAZINE + RESERVE) * ROUND_MASS,
  };
}
export function createMeteorState(random) {
  const rocks = makeRocks(1, random).map((r, i) => ({ ...r, id: i + 1, birth: 0.8 }));
  return {
    phase: 'playing',
    score: 0,
    wave: 1,
    lives: 3,
    hull: 3,
    ship: launchShip(),
    rocks,
    shots: [],
    particles: [],
    invulnerable: 1.5,
    fireCooldown: 0,
    time: 0,
    thrusting: false,
    braking: false,
    pulseCooldown: 0,
    pulseFlash: 0,
    banner: 2.5,
    ammo: MAGAZINE,
    reserve: RESERVE,
    reload: 0,
    impactFlash: 0,
    nextId: rocks.length + 1,
    shotsFired: 0,
  };
}
function identify(s, r) {
  r.id ??= s.nextId++;
  r.mass ??= rockMass(r);
  r.radius ??= radius(r.size);
  r.hp ??= r.kind === 'iron' ? 2 : 1;
  r.storedEnergy ??= r.kind === 'ice' ? r.mass * 150 : r.kind === 'volatile' ? r.mass * 2450 : 0;
  r.impactEnergy ??= 0;
  r.angle ??= 0;
  r.spin ??= 0;
}
// Exact first contact of two linearly moving circles, including translated torus images.
function sweptContact(a, b, dt, combinedRadius) {
  const rx = delta(a.x - b.x, 480),
    ry = delta(a.y - b.y, 320),
    vx = a.vx - b.vx,
    vy = a.vy - b.vy;
  const nx = Math.ceil(Math.abs(vx * dt) / 480) + 1,
    ny = Math.ceil(Math.abs(vy * dt) / 320) + 1;
  let first = Infinity;
  for (let ix = -nx; ix <= nx; ix++)
    for (let iy = -ny; iy <= ny; iy++) {
      const x = rx + ix * 480,
        y = ry + iy * 320,
        c = x * x + y * y - combinedRadius * combinedRadius;
      if (c <= 0) {
        first = 0;
        continue;
      }
      const speed = vx * vx + vy * vy;
      if (speed === 0) continue;
      const dot = x * vx + y * vy,
        discriminant = dot * dot - speed * c;
      if (dot >= 0 || discriminant < 0) continue;
      const t = (-dot - Math.sqrt(discriminant)) / speed;
      if (t >= 0 && t <= dt && t < first) first = t;
    }
  return first;
}
function dust(s, r, count = 8) {
  const phase = r.angle || 0,
    mass = rockMass(r),
    m = mass / count,
    orbit = rockRadius(r);
  const parentI = inertia(r),
    L = parentI * (r.spin || 0),
    dustI = mass * orbit * orbit;
  const omega = dustI > 0 ? L / dustI : 0;
  const available =
    (r.storedEnergy ?? 0) +
    (r.impactEnergy ?? 0) +
    0.5 * parentI * (r.spin || 0) ** 2 -
    0.5 * dustI * omega ** 2;
  const speed = mass > 0 ? Math.sqrt(Math.max(0, (2 * available) / mass)) : 38;
  for (let i = 0; i < count; i++) {
    const a = phase + (i * Math.PI * 2) / count,
      dx = Math.cos(a),
      dy = Math.sin(a);
    s.particles.push({
      x: wrap(r.x + dx * orbit, 480),
      y: wrap(r.y + dy * orbit, 320),
      vx: r.vx + dx * speed - omega * dy * orbit,
      vy: r.vy + dy * speed + omega * dx * orbit,
      life: 0.6,
      mass: m,
      kind: r.kind,
    });
  }
}
function fracture(s, r, random, extraEnergy = 0) {
  if (r.dead) return;
  r.dead = true;
  s.score += r.size === 3 ? 40 : r.size === 2 ? 80 : 120;
  dust(s, { ...r, mass: 0 });
  if (r.size <= 1) {
    dust(s, r);
    return;
  }
  const count = r.kind === 'ice' ? 3 : r.kind === 'volatile' ? 4 : 2,
    childSize = r.kind === 'volatile' ? 1 : r.size - 1;
  const mass = rockMass(r),
    childMass = mass / count,
    childRadius = rockRadius(r) / Math.sqrt(count);
  const orbit = (childRadius + 1) / Math.sin(Math.PI / count);
  const parentI = inertia(r),
    childI = 0.5 * childMass * childRadius ** 2,
    totalI = count * (childI + childMass * orbit ** 2);
  const omega = (parentI * r.spin) / totalI;
  const retained = r.kind === 'ice' ? (r.storedEnergy ?? 0) * 0.35 : 0;
  const energy = (r.storedEnergy ?? 0) - retained + (r.impactEnergy ?? 0) + extraEnergy;
  const radial = Math.sqrt(
    Math.max(0, (2 * (energy + 0.5 * parentI * r.spin ** 2 - 0.5 * totalI * omega ** 2)) / mass),
  );
  const phase = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = phase + (i * Math.PI * 2) / count,
      ux = Math.cos(a),
      uy = Math.sin(a),
      ox = ux * orbit,
      oy = uy * orbit;
    s.rocks.push({
      id: s.nextId++,
      x: wrap(r.x + ox, 480),
      y: wrap(r.y + oy, 320),
      vx: r.vx + ux * radial - omega * oy,
      vy: r.vy + uy * radial + omega * ox,
      size: childSize,
      radius: childRadius,
      mass: childMass,
      kind: r.kind,
      storedEnergy: retained / count,
      impactEnergy: 0,
      hp: r.kind === 'iron' && childSize > 1 ? 2 : 1,
      angle: r.angle,
      spin: omega,
      flash: 0.3,
    });
  }
}
function hitRock(s, r, shot, random) {
  const mass = rockMass(r),
    pelletMass = shot.mass ?? 0,
    total = mass + pelletMass;
  const rx = r.x,
    ry = r.y,
    bx = shot.x,
    by = shot.y;
  const ox = delta(bx - rx, 480),
    oy = delta(by - ry, 320),
    reduced = (mass * pelletMass) / total;
  const angular = inertia(r) * r.spin + reduced * (ox * (shot.vy - r.vy) - oy * (shot.vx - r.vx));
  const newI = inertia(r) + reduced * (ox * ox + oy * oy);
  const before =
    0.5 * mass * (r.vx * r.vx + r.vy * r.vy) +
    0.5 * inertia(r) * r.spin * r.spin +
    0.5 * pelletMass * (shot.vx * shot.vx + shot.vy * shot.vy);
  r.x = wrap(rx + (ox * pelletMass) / total, 480);
  r.y = wrap(ry + (oy * pelletMass) / total, 320);
  r.vx = (mass * r.vx + pelletMass * shot.vx) / total;
  r.vy = (mass * r.vy + pelletMass * shot.vy) / total;
  r.mass = total;
  r.inertia = newI;
  r.spin = newI > 0 ? angular / newI : 0;
  const after = 0.5 * total * (r.vx * r.vx + r.vy * r.vy) + 0.5 * newI * r.spin * r.spin;
  r.impactEnergy = (r.impactEnergy ?? 0) + Math.max(0, before - after);
  r.hp -= shot.damage ?? 1;
  r.flash = 0.18;
  shot.life = 0;
  if (r.hp <= 0) {
    if (r.kind === 'volatile' && !shot.charged) {
      r.fuse ??= 0.65;
      r.hp = 1;
    } else fracture(s, r, random, shot.energy ?? 0);
  }
}
// Central impulses conserve pair momentum and cannot increase kinetic energy (e <= 1).
function resolvePair(a, b, ra, rb, ma, mb) {
  let dx = delta(b.x - a.x, 480),
    dy = delta(b.y - a.y, 320),
    distance = Math.hypot(dx, dy);
  if (distance >= ra + rb) return null;
  if (distance < 1e-9) {
    dx = 1;
    dy = 0;
  }
  const nx = distance < 1e-9 ? 1 : dx / distance,
    ny = distance < 1e-9 ? 0 : dy / distance,
    relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative < 0) {
    const impulse = (-(1 + 0.9) * relative) / (1 / ma + 1 / mb);
    a.vx -= (impulse * nx) / ma;
    a.vy -= (impulse * ny) / ma;
    b.vx += (impulse * nx) / mb;
    b.vy += (impulse * ny) / mb;
  }
  const depth = Math.max(0, ra + rb - distance) + 0.0001,
    total = ma + mb;
  a.x = wrap(a.x - (nx * depth * mb) / total, 480);
  a.y = wrap(a.y - (ny * depth * mb) / total, 320);
  b.x = wrap(b.x + (nx * depth * ma) / total, 480);
  b.y = wrap(b.y + (ny * depth * ma) / total, 320);
  return {
    speed: Math.max(0, -relative),
    x: wrap(a.x + nx * ra, 480),
    y: wrap(a.y + ny * ra, 320),
  };
}
function safestLaunch(rocks) {
  let best = { x: 240, y: 160 },
    clearance = -Infinity;
  for (let y = 40; y < 320; y += 60)
    for (let x = 40; x < 480; x += 80) {
      const candidate = { x, y },
        gap = Math.min(
          ...rocks.filter((r) => !r.dead).map((r) => torusDistance(candidate, r) - rockRadius(r)),
        );
      if (gap > clearance) {
        best = candidate;
        clearance = gap;
      }
    }
  return best;
}
function fire(s, charged) {
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
    x: wrap(ship.x + dx * 18, 480),
    y: wrap(ship.y + dy * 18, 320),
    vx: oldVx + dx * speed,
    vy: oldVy + dy * speed,
    life: 1.6,
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
  if (s.ammo < 5 && s.reserve > 0 && s.reload <= 0) s.reload = 2;
  return true;
}
export function stepMeteors(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.nextId ??= 1;
  s.hull ??= 3;
  s.ammo ??= MAGAZINE;
  s.reserve ??= RESERVE;
  s.reload ??= 0;
  s.impactFlash ??= 0;
  s.shotsFired ??= 0;
  s.ship.omega ??= 0;
  s.ship.mass ??= BASE_MASS + (s.ammo + s.reserve) * ROUND_MASS;
  for (const r of s.rocks) identify(s, r);
  const fastest = Math.max(
    Math.hypot(s.ship.vx, s.ship.vy),
    ...s.rocks.map((r) => Math.hypot(r.vx, r.vy)),
    0,
  );
  const count = Math.max(1, Math.ceil(dt * Math.max(240, fastest / 2))),
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
function simulateMeteors(s, dt, input, random) {
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
      delta(input.pointer.y - s.ship.y, 320),
      delta(input.pointer.x - s.ship.x, 480),
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
    ax = Math.cos(middle) * 110;
    ay = Math.sin(middle) * 110;
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
  s.ship.x = wrap(s.ship.x + s.ship.vx * dt + (ax * dt * dt) / 2, 480);
  s.ship.y = wrap(s.ship.y + s.ship.vy * dt + (ay * dt * dt) / 2, 320);
  s.ship.vx += ax * dt;
  s.ship.vy += ay * dt;
  s.ship.angle = delta(s.ship.angle + s.ship.omega * dt + (alpha * dt * dt) / 2, Math.PI * 2);
  s.ship.omega += alpha * dt;
  // Resolve weapon events chronologically, then advance the remaining time once.
  let remaining = dt;
  const advance = (time) => {
    for (const r of s.rocks)
      if (!r.dead) {
        r.x = wrap(r.x + r.vx * time, 480);
        r.y = wrap(r.y + r.vy * time, 320);
        r.angle = delta(r.angle + r.spin * time, Math.PI * 2);
      }
    for (const shot of s.shots)
      if (shot.life > 0) {
        const travel = Math.min(time, shot.life);
        shot.x = wrap(shot.x + shot.vx * travel, 480);
        shot.y = wrap(shot.y + shot.vy * travel, 320);
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
    s.invulnerable = 0.8;
    dust(s, { x: contact.x, y: contact.y, vx: s.ship.vx, vy: s.ship.vy, mass: 0, size: 1 });
    if (s.hull <= 0) {
      s.lives--;
      if (s.lives <= 0) {
        s.phase = 'lost';
        break;
      }
      const safe = safestLaunch(s.rocks);
      s.ship = launchShip(safe.x, safe.y);
      s.hull = 3;
      s.ammo = MAGAZINE;
      s.reserve = RESERVE;
      s.reload = 0;
      s.invulnerable = 2;
      s.banner = 1;
    }
  }
  for (const p of s.particles) {
    p.x = wrap(p.x + p.vx * dt, 480);
    p.y = wrap(p.y + p.vy * dt, 320);
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
    s.score += 500;
    if (s.wave === 5) s.phase = 'won';
    else {
      s.wave++;
      s.banner = 2.5;
      s.rocks = makeRocks(s.wave, random, s.ship).map((r) => ({
        ...r,
        id: s.nextId++,
        birth: 1.1,
      }));
      const rounds = Math.min(MAGAZINE - s.ammo, s.reserve);
      s.ammo += rounds;
      s.reserve -= rounds;
      s.reload = 0;
      s.hull = Math.min(3, s.hull + 1);
      s.invulnerable = Math.max(s.invulnerable, 1.1);
      s.shots = [];
    }
  }
}
function drawRock(ctx, r) {
  const rad = rockRadius(r),
    unit = rad > 20 ? 3 : 2;
  const colors =
    r.kind === 'ice'
      ? ['#d7f5f1', '#517d9b', '#8dc4d6']
      : r.kind === 'iron'
        ? ['#d1ccce', '#505b72', '#929ba5']
        : r.kind === 'volatile'
          ? ['#f4cc89', '#8d514b', '#bd7a58']
          : ['#cab894', '#53605f', '#899783'];
  for (let y = -rad; y < rad; y += unit)
    for (let x = -rad; x < rad; x += unit) {
      if ((x + unit / 2) ** 2 + (y + unit / 2) ** 2 > (rad - unit / 2) ** 2) continue;
      ctx.fillStyle =
        r.flash > 0
          ? '#eff5d4'
          : x + y < -rad * 0.25
            ? colors[0]
            : x + y > rad * 0.4
              ? colors[1]
              : colors[2];
      ctx.fillRect(Math.round(r.x + x), Math.round(r.y + y), unit, unit);
    }
  ctx.fillStyle = '#565f5b';
  const crater = rad > 20 ? 5 : rad > 12 ? 4 : 3;
  ctx.fillRect(Math.round(r.x - rad * 0.35), Math.round(r.y - rad * 0.2), crater * 2, crater);
  if (r.kind === 'iron') {
    ctx.fillStyle = '#e5d5b7';
    ctx.fillRect(r.x - rad * 0.5, r.y + rad * 0.15, rad, 2);
    if (r.hp > 1) {
      ctx.fillRect(r.x - 5, r.y - 3, 3, 3);
      ctx.fillRect(r.x + 2, r.y - 3, 3, 3);
    }
  }
  if (r.kind === 'ice') {
    ctx.fillStyle = '#e8ffff';
    ctx.fillRect(r.x - 1, r.y - rad * 0.65, 2, rad * 1.2);
    ctx.fillRect(r.x - rad * 0.4, r.y, rad * 0.8, 2);
  }
  if (r.kind === 'volatile') {
    const flash = r.fuse !== undefined && Math.floor(r.fuse * 16) % 2 === 0;
    ctx.fillStyle = flash ? '#fff4c0' : '#ff865e';
    ctx.fillRect(r.x - 4, r.y - 4, 8, 8);
    ctx.fillStyle = '#56333d';
    ctx.fillRect(r.x - 2, r.y - 2, 4, 4);
    if (r.fuse !== undefined) {
      ctx.strokeStyle = '#ffc98a';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - rad - 3, r.y - rad - 3, rad * 2 + 6, rad * 2 + 6);
    }
  }
}
function drawShip(ctx, ship, thrust, time) {
  const cos = Math.cos(ship.angle),
    sin = Math.sin(ship.angle);
  const local = (x, y) => ({ x: ship.x + x * cos - y * sin, y: ship.y + x * sin + y * cos });
  for (let y = -8; y <= 8; y += 3)
    for (let x = -8; x <= 13; x += 3) {
      if (x > 12 - Math.abs(y) * 1.7 || x < -6 + Math.abs(y) * 0.1) continue;
      const p = local(x, y);
      ctx.fillStyle = Math.abs(y) < 3 ? '#f6efca' : '#8cd7d7';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
    }
  if (thrust) {
    for (let i = 0; i < 3; i++) {
      const p = local(-12 - i * 3, i % 2 ? 2 : -2);
      ctx.fillStyle = i === 0 ? '#ffd173' : '#ed8155';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3 + (Math.floor(time * 20) % 2));
    }
  }
}
function wrappedPositions(entity, extent) {
  const xs = [entity.x],
    ys = [entity.y];
  if (entity.x < extent) xs.push(entity.x + 480);
  if (entity.x > 480 - extent) xs.push(entity.x - 480);
  if (entity.y < extent) ys.push(entity.y + 320);
  if (entity.y > 320 - extent) ys.push(entity.y - 320);
  return xs.flatMap((x) => ys.map((y) => ({ ...entity, x, y })));
}
export function drawWrappedRock(ctx, rock) {
  for (const copy of wrappedPositions(rock, rockRadius(rock))) drawRock(ctx, copy);
}
export function drawWrappedShip(ctx, ship, thrust, time) {
  for (const copy of wrappedPositions(ship, 23)) drawShip(ctx, copy, thrust, time);
}
export function createGame(env) {
  const s = createMeteorState(env.random);
  let ended = false,
    lastScore = 0,
    lastLives = 3;
  return {
    update(dt, input) {
      const bullets = s.shotsFired;
      stepMeteors(s, dt, input, env.random);
      if (s.shotsFired > bullets) env.sound('shoot');
      if (s.score > lastScore) env.sound('hit');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t(
                  'Five sectors secured. Welcome home, pilot.',
                  '五个星区已清理。欢迎归航，飞行员。',
                )
              : s.reason === 'ammo'
                ? env.t(
                    'Ammunition exhausted. Reload and reserve management matter.',
                    '弹药耗尽。请留意装填与储备。',
                  )
                : env.t('Your fleet is gone. Plot a new course.', '舰队损失殆尽，重新规划航线吧。'),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#0b1727');
      for (let i = 0; i < 110; i++) {
        ctx.fillStyle = i % 8 ? '#2d4054' : '#9eafbd';
        ctx.fillRect((i * 113) % 480, (i * 67) % 320, i % 8 ? 1 : 2, 1);
      }
      ctx.fillStyle = '#152d3b';
      for (let y = -50; y < 45; y += 4)
        for (let x = -48; x < 48; x += 4)
          if (x * x + y * y < 44 * 44) ctx.fillRect(415 + x, 285 + y, 4, 4);
      ctx.fillStyle = '#1e3a44';
      ctx.fillRect(401, 270, 40, 8);
      ctx.fillRect(385, 287, 46, 5);
      for (const r of s.rocks) {
        for (const copy of wrappedPositions(r, rockRadius(r) + 5)) {
          drawRock(ctx, copy);
          if ((r.birth ?? 0) > 0) {
            ctx.strokeStyle = '#8ad3cd';
            ctx.lineWidth = 1;
            ctx.strokeRect(
              copy.x - rockRadius(r) - 4,
              copy.y - rockRadius(r) - 4,
              rockRadius(r) * 2 + 8,
              rockRadius(r) * 2 + 8,
            );
          }
        }
      }
      for (const b of s.shots)
        for (const copy of wrappedPositions(b, (b.radius ?? 2) + 2)) {
          ctx.fillStyle = b.charged ? '#ffd695' : '#c4f7ec';
          const r = b.radius ?? 2;
          ctx.fillRect(Math.round(copy.x - r), Math.round(copy.y - r), r * 2, r * 2);
        }
      for (const p of s.particles) {
        ctx.fillStyle = p.life > 0.3 ? '#ffc47d' : '#bf7459';
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      }
      drawWrappedShip(ctx, s.ship, s.thrusting, s.time);
      for (const copy of wrappedPositions(s.ship, HULL_RADIUS + 3)) {
        ctx.strokeStyle =
          s.impactFlash > 0 ? '#ffd59b' : s.invulnerable > 0 ? '#99e9db' : '#496f83';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(copy.x, copy.y, HULL_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        if (s.turning) {
          ctx.fillStyle = '#92d8eb';
          ctx.fillRect(copy.x - 12, copy.y - 9 * s.turning, 3, 3);
          ctx.fillRect(copy.x + 10, copy.y + 9 * s.turning, 3, 3);
        }
        if (s.braking) {
          ctx.fillStyle = '#82e0ef';
          for (const [dx, dy] of [
            [-17, 0],
            [15, 0],
            [0, -17],
            [0, 15],
          ])
            ctx.fillRect(copy.x + dx, copy.y + dy, 3, 3);
        }
      }
      ctx.fillStyle = '#0b1727bb';
      ctx.fillRect(0, 0, 480, 42);
      drawPixelText(ctx, env.t('SECTOR', '星区') + ' ' + s.wave + '/5', 10, 7, '#b4dbd2', 11);
      drawPixelText(ctx, env.t('SHIPS', '飞船') + ' ' + s.lives, 470, 7, '#f1cf94', 11, 'right');
      drawPixelText(
        ctx,
        env.t('HULL', '船体') + ' ' + '▮'.repeat(Math.max(0, s.hull)),
        240,
        7,
        '#a9e2b0',
        10,
        'center',
      );
      const ammo =
        s.reload > 0
          ? env.t('RELOAD ', '装填 ') + s.reload.toFixed(1) + 's'
          : env.t('AMMO ', '弹药 ') + s.ammo;
      drawPixelText(
        ctx,
        ammo + ' · ' + env.t('RES ', '储备 ') + s.reserve,
        10,
        25,
        s.ammo < 20 ? '#ffb37c' : '#99bbc5',
        10,
      );
      const charge =
        s.pulseCooldown > 0
          ? Math.ceil((1 - s.pulseCooldown / 7) * 100) + '%'
          : env.t('READY', '就绪');
      drawPixelText(ctx, env.t('BURST ', '蓄能弹 ') + charge, 470, 25, '#e5c595', 10, 'right');
      if (s.banner > 0)
        drawPixelText(
          ctx,
          [
            env.t('STONE • MIND YOUR MOMENTUM', '岩石带 · 留意惯性'),
            env.t('ICE • PRESSURIZED GAS', '冰晶 · 内藏高压气体'),
            env.t('IRON TAKES TWO HITS', '铁质需要两次击中'),
            env.t('VOLATILE • FUSE THEN BLAST', '易爆矿石 · 引信后爆裂'),
            env.t('THE FINAL MIXED BELT', '最终混合陨石带'),
          ][s.wave - 1],
          240,
          265,
          '#e5d4b0',
          12,
          'center',
        );
      if (s.time < 4)
        drawPixelText(
          ctx,
          env.t('DOWN = COUNTER-THRUST BRAKE', '下键 = 反推制动'),
          240,
          298,
          '#cbd8ce',
          11,
          'center',
        );
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Sector ${s.wave}/5 · ${s.rocks.length} rocks · Hull ${s.hull}/3 · Ammo ${s.ammo}`,
        zh: `星区 ${s.wave}/5 · ${s.rocks.length} 块陨石 · 船体 ${s.hull}/3 · 弹药 ${s.ammo}`,
      },
    }),
  };
}
