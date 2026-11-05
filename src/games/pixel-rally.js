import { clamp, drawPixelText as text, background } from '../shared/utils.js';

export const meta = {
  id: 'pixel-rally',
  name: { en: 'Pixel Rally', zh: '像素拉力赛' },
  description: {
    en: 'Finish a 3.2 km, six-section rally in 120 seconds. Hold gas, steer around traffic and brake before tight gaps. Steering assist straightens the car when released. Gravel, rain and grass reduce grip; clean on-road passes and checkpoint gates earn bonuses.',
    zh: '在120秒内跑完3.2公里、六段路程。按住加速，转向避车，窄处提前刹车。松开转向时辅助系统回正。碎石、雨水和草地降低抓地力；赛道内无碰撞超车和检查点可获奖励。',
  },
  genre: 'sports',
  players: '1',
  touch: true,
  keys: [
    {
      label: { en: 'Steer (release to straighten)', zh: '转向（松开辅助回正）' },
      keys: 'A / D · ← / →',
    },
    { label: { en: 'Hold gas / brake', zh: '按住加速 / 刹车' }, keys: 'W / S · ↑ / ↓' },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'Gas', zh: '加速' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Brake', zh: '刹车' } },
  ],
};

// Positions are metres, velocities metres/second, time seconds and masses kilograms.
// The camera compresses longitudinal distance; all vehicle art uses the same projection.
const SX = 18,
  SZ = 7,
  G = 9.81,
  EPS = 1e-7,
  TICK = 1 / 120,
  SHOULDER = 2.2;
const sections = [
  {
    start: 0,
    end: 500,
    name: { en: 'ORCHARD', zh: '果园' },
    surface: { en: 'TARMAC', zh: '柏油' },
    grip: 0.95,
    rolling: 0.22,
    halfWidth: 5.4,
    lanes: [-3.4, 0, 3.4],
    land: '#41765a',
    road: '#39434a',
    edge: '#8b9871',
  },
  {
    start: 500,
    end: 1050,
    name: { en: 'QUARRY', zh: '采石场' },
    surface: { en: 'GRAVEL', zh: '碎石' },
    grip: 0.58,
    rolling: 0.65,
    halfWidth: 5,
    lanes: [-3.2, 0, 3.2],
    land: '#947650',
    road: '#796f61',
    edge: '#b49b74',
  },
  {
    start: 1050,
    end: 1600,
    name: { en: 'VIADUCT', zh: '高架桥' },
    surface: { en: 'NARROW BRIDGE', zh: '窄桥' },
    grip: 0.82,
    rolling: 0.25,
    halfWidth: 3.7,
    lanes: [-1.85, 1.85],
    land: '#385e6d',
    road: '#4b5260',
    edge: '#9a9d9b',
  },
  {
    start: 1600,
    end: 2100,
    name: { en: 'CEDAR BENDS', zh: '雪松弯道' },
    surface: { en: 'TARMAC', zh: '柏油' },
    grip: 0.85,
    rolling: 0.25,
    halfWidth: 4.8,
    lanes: [-3.1, 0, 3.1],
    land: '#315544',
    road: '#344148',
    edge: '#7b9271',
  },
  {
    start: 2100,
    end: 2650,
    name: { en: 'RAIN COAST', zh: '雨中海岸' },
    surface: { en: 'WET ROAD', zh: '湿滑路面' },
    grip: 0.48,
    rolling: 0.3,
    halfWidth: 4.5,
    lanes: [-2.9, 0, 2.9],
    land: '#456371',
    road: '#334855',
    edge: '#7e959c',
  },
  {
    start: 2650,
    end: 3200,
    name: { en: 'NIGHT RUN', zh: '夜间冲刺' },
    surface: { en: 'TARMAC', zh: '柏油' },
    grip: 0.88,
    rolling: 0.22,
    halfWidth: 5.2,
    lanes: [-3.3, 0, 3.3],
    land: '#273c4b',
    road: '#293744',
    edge: '#6a7b83',
  },
];
const bends = [
  [0, 0],
  [170, 0.5],
  [400, -2.6],
  [620, 4.2],
  [820, 2],
  [1040, -4.8],
  [1260, 3.6],
  [1480, 4.2],
  [1720, -4.4],
  [1900, 3.8],
  [2120, -3.8],
  [2340, 3.6],
  [2540, 0],
  [2730, -4.2],
  [2970, 4.8],
  [3200, 0],
];
const approach = (value, target, step) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);
const magnitude = (v) => Math.hypot(v.vx, v.vz);
const angle = (v) => (magnitude(v) > EPS ? Math.atan2(v.vx, v.vz) : v.heading);
const sectionIndex = (d) => {
  const index = sections.findIndex((s) => d < s.end);
  return index < 0 ? sections.length - 1 : index;
};
export const routeSection = (d) => sections[sectionIndex(d)];
export function roadCurve(distance) {
  const d = clamp(distance, 0, 3200);
  for (let n = 1; n < bends.length; n++)
    if (d <= bends[n][0]) {
      const [from, x0] = bends[n - 1],
        [to, x1] = bends[n],
        t = (d - from) / (to - from);
      return x0 + ((x1 - x0) * (1 - Math.cos(Math.PI * t))) / 2;
    }
  return 0;
}
const roadSlope = (d) => (roadCurve(d + 0.1) - roadCurve(d - 0.1)) / 0.2;
function halfWidth(d) {
  const i = sectionIndex(d),
    s = sections[i],
    next = sections[i + 1];
  if (!next || d < s.end - 55) return s.halfWidth;
  const t = clamp((d - s.end + 55) / 55, 0, 1),
    blend = t * t * (3 - 2 * t);
  return s.halfWidth + (next.halfWidth - s.halfWidth) * blend;
}
const edgeX = (d, side) => roadCurve(d) + side * (halfWidth(d) + SHOULDER);
function axes(v) {
  const c = Math.cos(v.heading),
    s = Math.sin(v.heading);
  return [
    [c, -s],
    [s, c],
  ];
}
function extent(v, nx, nz) {
  const [side, front] = axes(v);
  return (
    (v.width / 2) * Math.abs(nx * side[0] + nz * side[1]) +
    (v.length / 2) * Math.abs(nx * front[0] + nz * front[1])
  );
}
function overlap(a, b, padding = 0) {
  return [...axes(a), ...axes(b)].every(
    ([nx, nz]) =>
      Math.abs((a.x - b.x) * nx + (a.z - b.z) * nz) <=
      extent(a, nx, nz) + extent(b, nx, nz) + padding,
  );
}

/** Swept separating-axis collision for two oriented vehicle rectangles. */
export function sweepVehicles(a, b, dt) {
  let enter = 0,
    exit = dt,
    entryAxis = null,
    minimum = Infinity,
    overlapAxis = null;
  for (const [nx, nz] of [...axes(a), ...axes(b)]) {
    const d = (a.x - b.x) * nx + (a.z - b.z) * nz,
      v = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    const radius = extent(a, nx, nz) + extent(b, nx, nz);
    const penetration = radius - Math.abs(d);
    if (penetration < minimum) {
      minimum = penetration;
      overlapAxis = [nx, nz, d >= 0 ? 1 : -1];
    }
    if (Math.abs(v) < EPS) {
      if (Math.abs(d) > radius + EPS) return null;
      continue;
    }
    const t1 = (-radius - d) / v,
      t2 = (radius - d) / v,
      near = Math.min(t1, t2),
      far = Math.max(t1, t2);
    if (near > enter) {
      enter = near;
      entryAxis = [nx, nz, d + v * near >= 0 ? 1 : -1];
    }
    exit = Math.min(exit, far);
    if (enter > exit + EPS) return null;
  }
  if (exit < -EPS || enter > dt + EPS) return null;
  const axis = entryAxis ?? overlapAxis;
  const nx = axis[0] * axis[2],
    nz = axis[1] * axis[2];
  if (enter <= EPS && minimum <= EPS && (a.vx - b.vx) * nx + (a.vz - b.vz) * nz >= -EPS)
    return null;
  return { time: Math.max(0, enter), nx, nz, penetration: enter <= EPS ? Math.max(0, minimum) : 0 };
}

/** A low-restitution impulse conserves momentum and dissipates relative motion. */
export function resolveVehicleImpact(a, b, { nx, nz }) {
  const closing = -((a.vx - b.vx) * nx + (a.vz - b.vz) * nz);
  if (closing <= 0) return { closing: 0, impulse: 0 };
  const impulse = (1.08 * closing) / (1 / a.mass + 1 / b.mass);
  a.vx += (impulse * nx) / a.mass;
  a.vz += (impulse * nz) / a.mass;
  b.vx -= (impulse * nx) / b.mass;
  b.vz -= (impulse * nz) / b.mass;
  return { closing, impulse };
}
function vehicle(extra = {}) {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    yaw: 0,
    width: 1.8,
    length: 4.6,
    mass: 1100,
    wallContact: 0,
    ...extra,
  };
}
export function createRallyState() {
  return {
    phase: 'playing',
    score: 0,
    distance: 0,
    target: 3200,
    time: 120,
    elapsed: 0,
    speed: 0,
    speedKmh: 0,
    carX: 0,
    steerVelocity: 0,
    player: vehicle(),
    wheel: 0,
    steeringAngle: 0,
    throttle: false,
    braking: false,
    offroad: 0,
    sliding: false,
    section: 0,
    health: 4,
    invulnerable: 0,
    flash: 0,
    checkpoint: 0,
    checkpoints: sections.map((s) => s.end),
    checkpointFlash: 0,
    overtakes: 0,
    collected: 0,
    traffic: [],
    coins: [],
    dust: [],
    dustClock: 0,
    nextSpawn: 90,
    nextCoin: 100,
    nextId: 1,
    spawnCount: 0,
    contacts: [],
    notice: '',
    noticeClock: 0,
  };
}
function surfaceAt(v) {
  const section = routeSection(v.z),
    offset = Math.abs(v.x - roadCurve(v.z)),
    half = halfWidth(v.z);
  const offroad = clamp((offset + extent(v, 1, 0) - half) / Math.max(v.width, 0.1), 0, 1);
  const puddle =
    sectionIndex(v.z) === 4 &&
    Math.floor(v.z / 40) % 3 === 1 &&
    v.z % 40 < 23 &&
    Math.abs(v.x - roadCurve(v.z) - (Math.floor(v.z / 120) % 2 ? 2 : -2)) < 1.3;
  return {
    offroad,
    puddle,
    grip: (puddle ? 0.32 : section.grip) * (1 - offroad) + 0.4 * offroad,
    // Rolling resistance stays below low-speed tractive force, even on gravel.
    // The speed-squared grass drag still makes sustained shoulder driving slow.
    rolling: section.rolling + offroad * 1.5,
  };
}
function turnChassis(v, target, grip, h, obstacles) {
  const speed = magnitude(v),
    maxYaw = Math.min(speed * 0.2, (grip * G) / Math.max(speed, 1));
  const difference = Math.atan2(Math.sin(target - v.heading), Math.cos(target - v.heading));
  const desiredYaw = clamp(difference * 6, -maxYaw, maxYaw);
  v.yaw = clamp(approach(v.yaw ?? 0, desiredYaw, 1.4 * h), -maxYaw, maxYaw);
  const proposed = { ...v, heading: v.heading + v.yaw * h };
  // Steering torque cannot rotate a solid chassis through another body or rail.
  const blocked =
    obstacles.some((other) => other !== v && overlap(proposed, other, -1e-5)) ||
    [-1, 1].some(
      (side) =>
        wallInfo(proposed, side).penetration > Math.max(1e-6, wallInfo(v, side).penetration),
    );
  if (blocked) v.yaw = 0;
  else v.heading = proposed.heading;
}
function playerForces(s, h, input) {
  const p = s.player,
    surface = surfaceAt(p),
    speed = magnitude(p);
  s.throttle = input.held('ArrowUp', 'KeyW') && !input.held('ArrowDown', 'KeyS');
  s.braking = input.held('ArrowDown', 'KeyS');
  const steering =
    Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  s.wheel = approach(s.wheel, steering, 5 * h);
  // The named steering assist requests a chassis heading. Tyres supply bounded
  // lateral force separately; a collision's side-slip is never reprojected away.
  const desired = s.wheel * 0.2;
  turnChassis(p, desired, surface.grip, h, s.traffic);
  const [side, front] = axes(p),
    lateral = p.vx * side[0] + p.vz * side[1];
  const traction = surface.grip * G;
  const engine = s.throttle ? Math.min(traction, 4.3 * Math.max(0, 1 - (speed / 60) ** 2)) : 0;
  const braking = s.braking ? traction * 0.95 : 0;
  // Steered front-wheel traction can pull away from a rail even when the
  // chassis itself cannot yet rotate. Steering authority tapers smoothly with speed.
  s.steeringAngle = (s.wheel * 0.45) / (1 + (speed / 8) ** 2);
  const forwardEngine = engine * Math.cos(s.steeringAngle);
  const sidewaysEngine = engine * Math.sin(s.steeringAngle);
  const lateralBudget = Math.sqrt(
    Math.max(0, traction * traction - Math.max(forwardEngine, braking) ** 2),
  );
  const lateralForce = clamp(sidewaysEngine - lateral * 8, -lateralBudget, lateralBudget);
  p.vx += (forwardEngine * front[0] + lateralForce * side[0]) * h;
  p.vz += (forwardEngine * front[1] + lateralForce * side[1]) * h;
  const accelerated = magnitude(p);
  const resistance = surface.rolling + (0.0012 + 0.022 * surface.offroad) * speed * speed + braking;
  const drag = accelerated > EPS ? Math.max(0, 1 - (resistance * h) / accelerated) : 0;
  p.vx *= drag;
  p.vz *= drag;
  s.offroad = surface.offroad;
  s.sliding = speed > 22 && (Math.abs(lateral) > 0.8 || Math.abs(desired - p.heading) > 0.065);
}

function trafficForces(car, h, fleet) {
  const surface = surfaceAt(car),
    ahead = routeSection(car.z + 65);
  const slot = car.laneSlot ?? Math.sign(car.lane),
    lanes = ahead.lanes;
  const desiredLane =
    lanes.length === 2
      ? slot < 0
        ? -1.85
        : slot > 0
          ? 1.85
          : car.id % 2
            ? -1.85
            : 1.85
      : slot * lanes[lanes.length - 1];
  car.indicator = Math.abs(desiredLane - car.lane) > 0.12 ? Math.sign(desiredLane - car.lane) : 0;
  car.lane = approach(car.lane, desiredLane, 0.75 * h);
  const targetX = roadCurve(car.z + Math.max(car.vz, 0) * 0.5) + car.lane;
  const ax = clamp(
    (targetX - car.x) * 2.5 - car.vx * 2.6,
    -surface.grip * G * 0.6,
    surface.grip * G * 0.6,
  );
  car.vx += ax * h;
  car.vz = approach(car.vz, car.targetSpeed, (car.vz > car.targetSpeed ? 3.8 : 2) * h);
  const speed = magnitude(car),
    drag = surface.offroad * (1.5 + 0.022 * speed * speed);
  const damping = speed > EPS ? Math.max(0, 1 - (drag * h) / speed) : 1;
  car.vx *= damping;
  car.vz *= damping;
  turnChassis(car, angle(car), surface.grip, h, fleet);
}

function wallInfo(v, side, t = 0) {
  const z = v.z + v.vz * t,
    x = v.x + v.vx * t,
    slope = (edgeX(z + 0.1, side) - edgeX(z - 0.1, side)) / 0.2,
    norm = Math.hypot(1, slope);
  const nx = side / norm,
    nz = (-side * slope) / norm;
  return { nx, nz, penetration: (side * (x - edgeX(z, side))) / norm + extent(v, nx, nz) };
}
function sweepWall(v, side, dt) {
  const start = wallInfo(v, side),
    end = wallInfo(v, side, dt);
  if (start.penetration > EPS) return { time: 0, ...start, side };
  if (end.penetration <= EPS) return null;
  let lo = 0,
    hi = dt;
  for (let n = 0; n < 18; n++) {
    const middle = (lo + hi) / 2;
    if (wallInfo(v, side, middle).penetration > 0) hi = middle;
    else lo = middle;
  }
  return { time: hi, ...wallInfo(v, side, hi), side };
}
function damage(s, env, closing, label) {
  if (closing < 4 || s.invulnerable > 0) return;
  s.health--;
  s.invulnerable = 0.8;
  s.flash = 0.3;
  s.notice = label;
  s.noticeClock = 1;
  env.sound('hit');
}
function contactManifold(a, b, margin = 1e-5) {
  let depth = Infinity,
    normal = null;
  for (const [nx, nz] of [...axes(a), ...axes(b)]) {
    const d = (a.x - b.x) * nx + (a.z - b.z) * nz;
    const penetration = extent(a, nx, nz) + extent(b, nx, nz) - Math.abs(d);
    if (penetration < -margin) return null;
    if (penetration < depth) {
      depth = penetration;
      normal = { nx: nx * (d >= 0 ? 1 : -1), nz: nz * (d >= 0 ? 1 : -1) };
    }
  }
  return { ...normal, penetration: depth };
}
function collectContacts(fleet) {
  const contacts = [];
  for (let a = 0; a < fleet.length; a++) {
    for (const side of [-1, 1]) {
      const hit = wallInfo(fleet[a], side);
      if (hit.penetration >= -1e-5)
        contacts.push({ type: 'wall', a, hit: { ...hit, side }, key: `w${a}:${side}` });
    }
    for (let b = a + 1; b < fleet.length; b++) {
      const hit = contactManifold(fleet[a], fleet[b]);
      if (hit) contacts.push({ type: 'car', a, b, hit, key: `c${a}:${b}` });
    }
  }
  return contacts;
}
function reportImpact(s, fleet, contact, env) {
  const a = fleet[contact.a],
    hit = contact.hit;
  if (contact.type === 'car') {
    const b = fleet[contact.b],
      impact = resolveVehicleImpact(a, b, hit);
    if (a === s.player || b === s.player) {
      const other = a === s.player ? b : a;
      other.touched = true;
      if (!s.contacts.includes(other.id)) damage(s, env, impact.closing, 'traffic');
      if (!s.contacts.includes(other.id)) s.contacts.push(other.id);
    }
  } else {
    const closing = a.vx * hit.nx + a.vz * hit.nz;
    if (closing > 0) {
      a.vx -= 1.05 * closing * hit.nx;
      a.vz -= 1.05 * closing * hit.nz;
    }
    if (a === s.player && a.wallContact !== hit.side) damage(s, env, closing, 'barrier');
    a.wallContact = hit.side;
  }
}
function settleVelocities(fleet, contacts) {
  // Solve the whole resting-contact graph. A following engine may compress a
  // queue, but that queue cannot consume simulation time for unrelated cars.
  for (let pass = 0; pass < 48; pass++) {
    let maximum = 0;
    for (const contact of contacts) {
      const a = fleet[contact.a],
        { nx, nz } = contact.hit;
      if (contact.type === 'car') {
        const b = fleet[contact.b],
          closing = -((a.vx - b.vx) * nx + (a.vz - b.vz) * nz);
        if (closing <= 1e-9) continue;
        const impulse = closing / (1 / a.mass + 1 / b.mass);
        a.vx += (impulse * nx) / a.mass;
        a.vz += (impulse * nz) / a.mass;
        b.vx -= (impulse * nx) / b.mass;
        b.vz -= (impulse * nz) / b.mass;
        maximum = Math.max(maximum, closing);
      } else {
        const closing = a.vx * nx + a.vz * nz;
        if (closing <= 1e-9) continue;
        a.vx -= closing * nx;
        a.vz -= closing * nz;
        maximum = Math.max(maximum, closing);
      }
    }
    if (maximum < 1e-8) break;
  }
}
function projectContactSlop(fleet) {
  // CCD reaches the exact impact first. This projection removes only residual
  // solver roundoff or tiny penetration caused by a curved guardrail.
  for (let pass = 0; pass < 20; pass++) {
    let deepest = 0;
    for (const contact of collectContacts(fleet)) {
      const { penetration, nx, nz } = contact.hit;
      if (penetration < 1e-6) continue;
      deepest = Math.max(deepest, penetration);
      const a = fleet[contact.a],
        depth = penetration + EPS;
      if (contact.type === 'car') {
        const b = fleet[contact.b],
          share = 1 / a.mass / (1 / a.mass + 1 / b.mass);
        a.x += nx * depth * share;
        a.z += nz * depth * share;
        b.x -= nx * depth * (1 - share);
        b.z -= nz * depth * (1 - share);
      } else {
        a.x -= nx * depth;
        a.z -= nz * depth;
      }
    }
    if (deepest < 1e-6) break;
  }
}
function moveFleet(s, h, env) {
  const fleet = [s.player, ...s.traffic],
    seen = new Set();
  let remaining = h;
  const advance = (time) => {
    for (const v of fleet) {
      v.x += v.vx * time;
      v.z += v.vz * time;
    }
  };
  const eventBudget = fleet.length * fleet.length + 8;
  for (let eventCount = 0; eventCount < eventBudget && remaining > EPS; eventCount++) {
    const resting = collectContacts(fleet),
      active = new Set(resting.map((c) => c.key));
    for (const contact of resting)
      if (!seen.has(contact.key)) {
        reportImpact(s, fleet, contact, env);
        seen.add(contact.key);
      }
    settleVelocities(fleet, resting);
    let event = null,
      time = remaining + 1;
    for (let a = 0; a < fleet.length; a++) {
      for (const side of [-1, 1]) {
        const key = `w${a}:${side}`;
        if (active.has(key)) continue;
        const hit = sweepWall(fleet[a], side, remaining);
        if (hit && hit.time < time) {
          event = { type: 'wall', a, hit, key };
          time = hit.time;
        }
      }
      for (let b = a + 1; b < fleet.length; b++) {
        const key = `c${a}:${b}`;
        if (active.has(key)) continue;
        const hit = sweepVehicles(fleet[a], fleet[b], remaining);
        if (hit && hit.time < time) {
          event = { type: 'car', a, b, hit, key };
          time = hit.time;
        }
      }
    }
    const elapsed = event ? Math.min(time, remaining) : remaining;
    advance(elapsed);
    remaining -= elapsed;
    if (!event) break;
    reportImpact(s, fleet, event, env);
    seen.add(event.key);
  }
  // Never drop time globally. Resting contacts are solved as constraints before
  // advancing, including the bounded fallback for an unusually dense contact set.
  if (remaining > EPS) {
    settleVelocities(fleet, collectContacts(fleet));
    advance(remaining);
  }
  projectContactSlop(fleet);
  s.contacts = s.contacts.filter((id) =>
    s.traffic.some((car) => car.id === id && overlap(s.player, car, 0.15)),
  );
  for (const v of fleet)
    if (v.wallContact && wallInfo(v, v.wallContact).penetration < -0.15) v.wallContact = 0;
}

function spawnTraffic(s, env) {
  while (s.player.z >= s.nextSpawn && s.nextSpawn < s.target - 110) {
    const section = routeSection(s.nextSpawn + 90),
      i = sectionIndex(s.nextSpawn + 90),
      lanes = section.lanes;
    const selected = (s.spawnCount + Math.floor(env.random() * lanes.length)) % lanes.length;
    const group = i >= 3 && s.spawnCount % 3 === 1 ? [0, lanes.length - 1] : [selected];
    for (let n = 0; n < group.length; n++) {
      const lane = lanes[group[n]],
        kind = i === 2 ? 'truck' : s.spawnCount % 3 === 0 ? 'van' : 'hatch',
        z = s.nextSpawn + 95 + n * 14;
      const targetSpeed = kind === 'truck' ? 20 : kind === 'van' ? 23 : 26 + env.random() * 3;
      const candidate = vehicle({
        id: s.nextId++,
        x: roadCurve(z) + lane,
        z,
        vz: targetSpeed,
        heading: Math.atan(roadSlope(z)),
        lane,
        laneSlot: group[n] === 0 ? -1 : group[n] === lanes.length - 1 ? 1 : 0,
        targetSpeed,
        kind,
        color: s.spawnCount % 4,
        touched: false,
        passed: false,
        length: kind === 'truck' ? 6.2 : kind === 'van' ? 5.2 : 4.6,
        width: kind === 'truck' ? 2.05 : 1.8,
        mass: kind === 'truck' ? 3200 : kind === 'van' ? 1700 : 1200,
      });
      // Spawn only beyond the visible approach, with a real geometric gap.
      // Existing traffic never moves to make room for a newly generated car.
      for (
        let attempt = 0;
        attempt < 8 && s.traffic.some((other) => overlap(candidate, other, 1.5));
        attempt++
      ) {
        candidate.z += 12;
        candidate.x = roadCurve(candidate.z) + lane;
        candidate.heading = Math.atan(roadSlope(candidate.z));
      }
      if (
        candidate.z - s.player.z < 185 &&
        !s.traffic.some((other) => overlap(candidate, other, 1.5))
      )
        s.traffic.push(candidate);
    }
    s.spawnCount++;
    s.nextSpawn += i === 2 ? 190 : 150 + env.random() * 30;
  }
  while (s.player.z >= s.nextCoin && s.nextCoin < s.target - 60) {
    const section = routeSection(s.nextCoin + 65),
      lane = section.lanes[Math.floor(env.random() * section.lanes.length)];
    for (let n = 0; n < 3; n++) {
      const z = s.nextCoin + 60 + n * 7;
      s.coins.push({ x: roadCurve(z) + lane, z });
    }
    s.nextCoin += 175;
  }
}
function score(s, won = false) {
  return (
    Math.floor(Math.min(s.target, Math.max(0, s.distance))) +
    s.collected * 75 +
    s.overtakes * 100 +
    s.checkpoint * 150 +
    (won ? s.health * 150 + Math.ceil(s.time) * 10 : 0)
  );
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.score = score(s, won);
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t(
          'Six sections complete. Clean driving wins the rally!',
          '六段路程完成，平稳驾驶赢得拉力赛！',
        )
      : s.time <= 0
        ? env.t(
            'Time is up. Stay on the road and hold the gas between hazards.',
            '时间到了。保持在赛道内，在障碍之间按住加速。',
          )
        : env.t(
            'The car cannot continue. Brake early and leave a passing gap.',
            '赛车无法继续。提前刹车，给超车留出空间。',
          ),
  });
}
function tick(s, h, input, env) {
  s.time = Math.max(0, s.time - h);
  s.elapsed += h;
  s.invulnerable = Math.max(0, s.invulnerable - h);
  s.flash = Math.max(0, s.flash - h);
  s.checkpointFlash = Math.max(0, s.checkpointFlash - h);
  s.noticeClock = Math.max(0, s.noticeClock - h);
  playerForces(s, h, input);
  for (const car of s.traffic) trafficForces(car, h, [s.player, ...s.traffic]);
  moveFleet(s, h, env);
  s.distance = s.player.z;
  s.speed = magnitude(s.player);
  s.speedKmh = Math.round(s.speed * 3.6);
  s.carX = s.player.x;
  s.steerVelocity = s.player.vx;
  s.section = sectionIndex(s.distance);
  s.offroad = surfaceAt(s.player).offroad;
  spawnTraffic(s, env);
  for (const car of s.traffic) {
    if (!car.passed && car.z - s.player.z < -(car.length + s.player.length) / 2 - 1) {
      car.passed = true;
      if (!car.touched && s.offroad < 0.05) {
        s.overtakes++;
        s.notice = 'pass';
        s.noticeClock = 0.8;
        env.sound('move');
      }
    }
  }
  s.traffic = s.traffic.filter((car) => car.z - s.player.z > -28 && car.z - s.player.z < 190);
  for (const coin of s.coins)
    if (
      !coin.collected &&
      Math.abs(coin.z - s.player.z) < s.player.length / 2 + 0.6 &&
      Math.abs(coin.x - s.player.x) < s.player.width / 2 + 0.55
    ) {
      coin.collected = true;
      s.collected++;
      env.sound('coin');
    }
  s.coins = s.coins.filter((coin) => !coin.collected && coin.z - s.player.z > -8);
  while (s.checkpoint < s.checkpoints.length && s.distance >= s.checkpoints[s.checkpoint]) {
    s.checkpoint++;
    s.checkpointFlash = 1.5;
    env.sound('coin');
  }
  s.dust = s.dust.filter((p) => (p.life -= h) > 0);
  s.dustClock -= h;
  if (
    s.speed > 3 &&
    (s.offroad > 0.1 || routeSection(s.distance).grip < 0.65) &&
    s.dustClock <= 0
  ) {
    s.dustClock = 0.05;
    s.dust.push({
      x: s.player.x + (env.random() - 0.5) * s.player.width,
      z: s.player.z - 2,
      life: 0.6,
      wet: s.section === 4,
    });
  }
  for (const p of s.dust) p.z -= h * 2;
  s.score = score(s);
  if (s.distance >= s.target && s.health > 0) finish(s, env, true);
  else if (s.health <= 0 || s.time <= 0) finish(s, env, false);
}
export function stepRally(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(TICK, remaining, s.time);
    if (h <= EPS) {
      s.time = 0;
      finish(s, env, false);
      break;
    }
    tick(s, h, input, env);
    remaining -= h;
  }
}

const BODY = [
  '..aaaa..',
  '.aaaaaa.',
  '.abbbba.',
  'cabbbaac',
  'cabbbaac',
  '.aaaaaa.',
  '.aaddaa.',
  '.aaddaa.',
  '.aaddaa.',
  '.aaddaa.',
  'caaaaaac',
  'caaaaaac',
  '.abbbba.',
  '.abbbba.',
  '.aaaaaa.',
  '..aaaa..',
];
const COLORS = ['#d98068', '#7daebb', '#dfc67b', '#bac1c4'];
function drawVehicle(ctx, v, p, s) {
  const x = 240 + v.x * SX,
    y = 260 - (v.z - p.z) * SZ;
  if (y < -35 || y > 340) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(SX, SZ);
  ctx.rotate(v.heading);
  const dx = v.width / 8,
    dy = v.length / 16;
  ctx.fillStyle = '#101b2780';
  ctx.fillRect(-v.width / 2 + 0.05, -v.length / 2 + 0.2, v.width, v.length);
  const isPlayer = v === p,
    body = isPlayer ? (s.flash > 0 ? '#fff0cd' : '#e4b668') : COLORS[v.color ?? 0];
  for (let row = 0; row < BODY.length; row++)
    for (let col = 0; col < 8; col++) {
      const pixel = BODY[row][col];
      if (pixel === '.') continue;
      ctx.fillStyle =
        pixel === 'a'
          ? body
          : pixel === 'b'
            ? '#203b4c'
            : pixel === 'c'
              ? '#132129'
              : isPlayer
                ? '#efead0'
                : '#e9d9b4';
      ctx.fillRect((col - 4) * dx, (row - 8) * dy, dx + 0.003, dy + 0.003);
    }
  ctx.fillStyle = '#b6d6db';
  ctx.fillRect(-v.width * 0.26, -v.length * 0.34, v.width * 0.15, v.length * 0.09);
  ctx.fillStyle = '#fff0bb';
  ctx.fillRect(-v.width * 0.35, -v.length * 0.47, v.width * 0.2, 0.14);
  ctx.fillRect(v.width * 0.15, -v.length * 0.47, v.width * 0.2, 0.14);
  if (!isPlayer && v.indicator && Math.floor(s.elapsed * 5) % 2 === 0) {
    ctx.fillStyle = '#ffb654';
    ctx.fillRect(
      v.indicator < 0 ? -v.width * 0.48 : v.width * 0.34,
      v.length * 0.28,
      v.width * 0.14,
      0.24,
    );
  }
  const braking = isPlayer ? s.braking : v.vz > v.targetSpeed + 0.5;
  ctx.fillStyle = braking ? '#ff6251' : '#884b42';
  ctx.fillRect(-v.width * 0.35, v.length * 0.4, v.width * 0.18, 0.18);
  ctx.fillRect(v.width * 0.17, v.length * 0.4, v.width * 0.18, 0.18);
  if (isPlayer) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * v.width * 0.37, -v.length * 0.25);
      ctx.rotate(s.steeringAngle);
      ctx.fillStyle = '#132129';
      ctx.fillRect(-0.075, -0.28, 0.15, 0.56);
      ctx.restore();
    }
    ctx.fillStyle = '#fff1c4';
    ctx.fillRect(-0.2, -0.12, 0.4, 0.65);
    ctx.fillStyle = '#5c6865';
    ctx.fillRect(-0.08, 0.02, 0.16, 0.34);
  }
  if (v.kind === 'truck') {
    ctx.fillStyle = '#c5c9bd';
    ctx.fillRect(-v.width * 0.34, -0.8, v.width * 0.68, 2.7);
    ctx.fillStyle = '#8d9d99';
    for (let n = 0; n < 5; n++)
      ctx.fillRect(-v.width * 0.31, -0.6 + n * 0.45, v.width * 0.62, 0.06);
  }
  ctx.restore();
  if (isPlayer && s.invulnerable > 0) {
    ctx.strokeStyle = '#fff1c4';
    ctx.strokeRect(x - 20, y - 21, 40, 42);
  }
}
function drawRally(ctx, s, env) {
  const p = s.player,
    section = routeSection(p.z);
  background(ctx, section.land);
  for (let y = 31; y < 306; y += 3) {
    const z = p.z + (260 - y) / SZ,
      part = routeSection(z),
      cx = 240 + roadCurve(z) * SX,
      half = halfWidth(z) * SX;
    ctx.fillStyle = part.land;
    ctx.fillRect(0, y, 480, 3);
    if (sectionIndex(z) === 2) {
      ctx.fillStyle = '#6c919e';
      for (let x = (Math.floor(z / 3) % 2) * 14; x < 480; x += 29) ctx.fillRect(x, y, 12, 1);
    }
    ctx.fillStyle = part.edge;
    ctx.fillRect(cx - half - SHOULDER * SX, y, 2 * (half + SHOULDER * SX), 3);
    ctx.fillStyle = part.road;
    ctx.fillRect(cx - half, y, half * 2, 3);
    if (sectionIndex(z) === 1 && Math.floor(z) % 3 === 0) {
      ctx.fillStyle = '#9b8c7255';
      for (let x = cx - half + 5; x < cx + half; x += 14) ctx.fillRect(x, y, 2, 1);
    }
    if (sectionIndex(z) === 4 && Math.floor(z / 40) % 3 === 1 && z % 40 < 23) {
      const lane = Math.floor(z / 120) % 2 ? 2 : -2;
      ctx.fillStyle = '#617e9480';
      ctx.fillRect(cx + (lane - 1.3) * SX, y, 2.6 * SX, 3);
      ctx.fillStyle = '#a4bdc933';
      ctx.fillRect(cx + (lane - 0.8) * SX, y, 1.2 * SX, 1);
    }
    ctx.fillStyle = '#d8d2af';
    ctx.fillRect(cx - half + 2, y, 2, 3);
    ctx.fillRect(cx + half - 4, y, 2, 3);
    if (Math.floor(z / 5) % 2 === 0) {
      ctx.fillStyle = '#c4c7b7';
      const lines = part.lanes.length === 2 ? [0] : [-1.65, 1.65];
      for (const x of lines) ctx.fillRect(cx + x * SX, y, 2, 3);
    }
    for (const side of [-1, 1]) {
      ctx.fillStyle = Math.floor(z / 3) % 2 ? '#e0dfd0' : '#af6759';
      ctx.fillRect(cx + side * (half + SHOULDER * SX) - 2, y, 4, 3);
    }
  }
  const first = Math.floor((p.z - 8) / 9),
    last = Math.ceil((p.z + 36) / 9);
  for (let n = first; n <= last; n++)
    for (const side of [-1, 1]) {
      const z = n * 9,
        y = 260 - (z - p.z) * SZ,
        part = routeSection(z),
        i = sectionIndex(z),
        x = 240 + (roadCurve(z) + side * (halfWidth(z) + 3.4 + (Math.abs(n) % 3) * 0.3)) * SX;
      if (i === 2) continue;
      if (i === 1) {
        ctx.fillStyle = '#695f50';
        ctx.fillRect(x - 7, y - 4, 15, 11);
        ctx.fillStyle = '#b5a17f';
        ctx.fillRect(x - 4, y - 7, 10, 7);
      } else {
        ctx.fillStyle = '#243d37';
        ctx.fillRect(x - 2, y + 1, 4, 13);
        ctx.fillStyle = i === 5 ? '#3c625b' : i === 3 ? '#396c50' : '#659460';
        ctx.fillRect(x - 10, y - 7, 20, 13);
        ctx.fillRect(x - 7, y - 14, 14, 8);
        ctx.fillStyle = i === 5 ? '#57796c' : '#83a76d';
        ctx.fillRect(x - 5, y - 10, 4, 5);
      }
      if (i === 5 && n % 3 === 0) {
        ctx.fillStyle = '#78888b';
        ctx.fillRect(x, y - 22, 2, 30);
        ctx.fillStyle = '#e7d7a0';
        ctx.fillRect(x - 4, y - 22, 8, 3);
      }
    }
  for (const checkpoint of s.checkpoints) {
    const y = 260 - (checkpoint - p.z) * SZ;
    if (y < 30 || y > 306) continue;
    const cx = 240 + roadCurve(checkpoint) * SX,
      half = halfWidth(checkpoint) * SX;
    for (let x = 0; x < Math.ceil((half * 2) / 8); x++)
      for (let row = 0; row < 2; row++) {
        ctx.fillStyle = (x + row) % 2 ? '#273745' : '#e6e4cf';
        ctx.fillRect(cx - half + x * 8, y + row * 5, 8, 5);
      }
  }
  if (s.section === 5) {
    ctx.fillStyle = '#e7e4bf12';
    ctx.beginPath();
    ctx.moveTo(240 + p.x * SX - 13, 245);
    ctx.lineTo(240 + p.x * SX - 52, 120);
    ctx.lineTo(240 + p.x * SX + 52, 120);
    ctx.lineTo(240 + p.x * SX + 13, 245);
    ctx.closePath();
    ctx.fill();
  }
  for (const dust of s.dust) {
    const y = 260 - (dust.z - p.z) * SZ;
    ctx.fillStyle = dust.wet ? '#a8cbd485' : '#bcaa8166';
    ctx.fillRect(240 + dust.x * SX - 3, y, 5, 4);
  }
  for (const coin of s.coins) {
    const y = 260 - (coin.z - p.z) * SZ;
    if (y < 32 || y > 301) continue;
    const x = 240 + coin.x * SX;
    ctx.fillStyle = '#b38345';
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.fillStyle = '#ffe4a2';
    ctx.fillRect(x - 2, y - 4, 4, 8);
  }
  for (const other of s.traffic.toSorted((a, b) => b.z - a.z)) drawVehicle(ctx, other, p, s);
  if (s.sliding) {
    ctx.fillStyle = '#162a3380';
    ctx.fillRect(240 + p.x * SX - 12, 272, 3, 10);
    ctx.fillRect(240 + p.x * SX + 10, 272, 3, 10);
  }
  drawVehicle(ctx, p, p, s);
  ctx.fillStyle = '#112532';
  ctx.fillRect(0, 0, 480, 30);
  text(ctx, `${s.section + 1}/6 ${env.t(section.name.en, section.name.zh)}`, 10, 10, '#e8e4c9', 10);
  text(ctx, `${Math.ceil(s.time)}s`, 262, 8, s.time < 20 ? '#f2aa89' : '#fff1c5', 14, 'center');
  text(ctx, env.t('CAR', '车况'), 382, 10, '#d4ddd2', 10, 'right');
  for (let n = 0; n < 4; n++) {
    ctx.fillStyle = n < s.health ? '#d5a469' : '#42515b';
    ctx.fillRect(392 + n * 18, 10, 13, 10);
    ctx.fillStyle = '#f0d092';
    if (n < s.health) ctx.fillRect(393 + n * 18, 11, 11, 2);
  }
  ctx.fillStyle = '#102631ed';
  ctx.fillRect(0, 290, 480, 30);
  text(ctx, `${s.speedKmh} km/h`, 10, 294, '#f5deb0', 11);
  const surface =
    s.offroad > 0.1
      ? env.t('GRASS · DRAG', '草地 · 阻力')
      : s.sliding
        ? env.t('LOW GRIP', '抓地力低')
        : env.t(section.surface.en, section.surface.zh);
  text(ctx, surface, 240, 294, s.offroad > 0.1 || s.sliding ? '#f0bd86' : '#b6d2ce', 9, 'center');
  text(
    ctx,
    `${Math.min(3.2, s.distance / 1000).toFixed(2)} / 3.2 km`,
    470,
    294,
    '#d4ddd2',
    9,
    'right',
  );
  ctx.fillStyle = '#3a525a';
  ctx.fillRect(10, 311, 460, 4);
  ctx.fillStyle = '#eac283';
  ctx.fillRect(10, 311, 460 * clamp(s.distance / s.target, 0, 1), 4);
  for (const checkpoint of s.checkpoints) {
    ctx.fillStyle = '#e1ded0';
    ctx.fillRect(9 + (460 * checkpoint) / s.target, 310, 2, 6);
  }
  if (s.distance < 20)
    text(
      ctx,
      env.t('HOLD GAS · STEER · RELEASE TO STRAIGHTEN', '按住加速 · 转向 · 松开辅助回正'),
      240,
      48,
      '#f5e1ad',
      10,
      'center',
    );
  else if (s.checkpointFlash > 0)
    text(
      ctx,
      env.t(`CHECKPOINT ${s.checkpoint}/6`, `检查点 ${s.checkpoint}/6`),
      240,
      48,
      '#f6dfa2',
      12,
      'center',
    );
  else if (s.noticeClock > 0)
    text(
      ctx,
      s.notice === 'pass'
        ? env.t('CLEAN PASS +100', '无碰撞超车 +100')
        : env.t('IMPACT · KEEP A GAP', '发生碰撞 · 留出空间'),
      240,
      48,
      s.notice === 'pass' ? '#bfebd4' : '#f3b298',
      10,
      'center',
    );
}
export function createGame(env) {
  const state = createRallyState();
  return {
    update: (dt, input) => stepRally(state, dt, input, env),
    draw: (ctx) => drawRally(ctx, state, env),
    getState: () => ({
      ...structuredClone(state),
      status: {
        en: `${state.section + 1}/6 ${routeSection(state.distance).name.en} · Car ${state.health}/4 · ${Math.floor(state.distance)} / 3200 m · ${state.collected} coins · ${state.overtakes} clean passes`,
        zh: `${state.section + 1}/6 ${routeSection(state.distance).name.zh} · 车况 ${state.health}/4 · ${Math.floor(state.distance)} / 3200 米 · ${state.collected} 金币 · ${state.overtakes} 无碰撞超车`,
      },
    }),
  };
}
