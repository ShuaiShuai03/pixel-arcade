// Meteor Drift rock physics: contacts, fracture and the energy bookkeeping behind them.
import { wrap, delta, torusDistance, WIDTH, HEIGHT } from './meteor-drift-math.js';

export const radius = (size) => (size === 3 ? 26 : size === 2 ? 16 : 8);
export const rockRadius = (r) => r.radius ?? radius(r.size);
export const rockMass = (r) => r.mass ?? rockRadius(r) ** 2;
export const inertia = (r) => r.inertia ?? 0.5 * rockMass(r) * rockRadius(r) ** 2;
/** Fragments per break, and the size a fragment takes, by rock material. */
export const splitCount = (kind) => (kind === 'ice' ? 3 : kind === 'volatile' ? 4 : 2);
export const energyDensity = (kind) => (kind === 'ice' ? 150 : kind === 'volatile' ? 2450 : 0);
export const childSize = (kind, size) => (kind === 'volatile' ? 1 : size - 1);
export function identify(s, r) {
  r.id ??= s.nextId++;
  r.mass ??= rockMass(r);
  r.radius ??= radius(r.size);
  r.hp ??= r.kind === 'iron' ? 2 : 1;
  r.storedEnergy ??= r.mass * energyDensity(r.kind);
  r.impactEnergy ??= 0;
  r.angle ??= 0;
  r.spin ??= 0;
}
// Exact first contact of two linearly moving circles, including translated torus images.
export function sweptContact(a, b, dt, combinedRadius) {
  const rx = delta(a.x - b.x, WIDTH),
    ry = delta(a.y - b.y, HEIGHT),
    vx = a.vx - b.vx,
    vy = a.vy - b.vy;
  const nx = Math.ceil(Math.abs(vx * dt) / WIDTH) + 1,
    ny = Math.ceil(Math.abs(vy * dt) / HEIGHT) + 1;
  let first = Infinity;
  for (let ix = -nx; ix <= nx; ix++)
    for (let iy = -ny; iy <= ny; iy++) {
      const x = rx + ix * WIDTH,
        y = ry + iy * HEIGHT,
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
export function dust(s, r, count = 8) {
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
      x: wrap(r.x + dx * orbit, WIDTH),
      y: wrap(r.y + dy * orbit, HEIGHT),
      vx: r.vx + dx * speed - omega * dy * orbit,
      vy: r.vy + dy * speed + omega * dx * orbit,
      life: 0.6,
      mass: m,
      kind: r.kind,
    });
  }
}
export function fracture(s, r, random, extraEnergy = 0) {
  if (r.dead) return;
  r.dead = true;
  s.score += r.size === 3 ? 40 : r.size === 2 ? 80 : 120;
  dust(s, { ...r, mass: 0 });
  if (r.size <= 1) {
    dust(s, r);
    return;
  }
  const count = splitCount(r.kind),
    nextSize = childSize(r.kind, r.size);
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
      x: wrap(r.x + ox, WIDTH),
      y: wrap(r.y + oy, HEIGHT),
      vx: r.vx + ux * radial - omega * oy,
      vy: r.vy + uy * radial + omega * ox,
      size: nextSize,
      radius: childRadius,
      mass: childMass,
      kind: r.kind,
      storedEnergy: retained / count,
      impactEnergy: 0,
      hp: r.kind === 'iron' && nextSize > 1 ? 2 : 1,
      angle: r.angle,
      spin: omega,
      flash: 0.3,
    });
  }
}
export function hitRock(s, r, shot, random) {
  const mass = rockMass(r),
    pelletMass = shot.mass ?? 0,
    total = mass + pelletMass;
  const rx = r.x,
    ry = r.y,
    bx = shot.x,
    by = shot.y;
  const ox = delta(bx - rx, WIDTH),
    oy = delta(by - ry, HEIGHT),
    reduced = (mass * pelletMass) / total;
  const angular = inertia(r) * r.spin + reduced * (ox * (shot.vy - r.vy) - oy * (shot.vx - r.vx));
  const newI = inertia(r) + reduced * (ox * ox + oy * oy);
  const before =
    0.5 * mass * (r.vx * r.vx + r.vy * r.vy) +
    0.5 * inertia(r) * r.spin * r.spin +
    0.5 * pelletMass * (shot.vx * shot.vx + shot.vy * shot.vy);
  r.x = wrap(rx + (ox * pelletMass) / total, WIDTH);
  r.y = wrap(ry + (oy * pelletMass) / total, HEIGHT);
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
export function resolvePair(a, b, ra, rb, ma, mb) {
  let dx = delta(b.x - a.x, WIDTH),
    dy = delta(b.y - a.y, HEIGHT),
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
  a.x = wrap(a.x - (nx * depth * mb) / total, WIDTH);
  a.y = wrap(a.y - (ny * depth * mb) / total, HEIGHT);
  b.x = wrap(b.x + (nx * depth * ma) / total, WIDTH);
  b.y = wrap(b.y + (ny * depth * ma) / total, HEIGHT);
  return {
    speed: Math.max(0, -relative),
    x: wrap(a.x + nx * ra, WIDTH),
    y: wrap(a.y + ny * ra, HEIGHT),
  };
}
export function safestLaunch(rocks) {
  let best = { x: 240, y: 160 },
    clearance = -Infinity;
  for (let y = 40; y < HEIGHT; y += 60)
    for (let x = 40; x < WIDTH; x += 80) {
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
