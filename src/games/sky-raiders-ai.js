// Enemy and carrier construction, drift, and the telegraphed volleys they fire.
import { clamp } from '../shared/utils.js';
import { ROUND_MASS, LIMIT, thrust, fireRound } from './sky-raiders-physics.js';
import { hullHeight, turretOffset } from './sky-raiders-sprites.js';
import { KINDS, SECTORS } from './sky-raiders-sectors.js';

const LANES = [70, 175, 305, 410];
const LANE_JITTER = 40;
const AIM_TELL = 0.55;
const BEAM_TELL = 1;
const COMB_SLOTS = 9;
const COMB_STEP = 0.18;
const RING_COUNT = 12;
const LEAD_SPREAD = [-0.12, 0, 0.12];
const FAN_SPREAD = [-0.3, 0, 0.3];
const GAP_SPREAD = [-0.72, -0.48, -0.24, 0.24, 0.48, 0.72];
const sectorOf = (s) => SECTORS[s.level - 1];

export function makeEnemy(s, env, kind, index) {
  const spec = KINDS[kind],
    sector = sectorOf(s),
    lane = clamp(
      LANES[index % LANES.length] + (env.random() - 0.5) * LANE_JITTER,
      LIMIT.minX + 16,
      LIMIT.maxX - 16,
    );
  return {
    id: s.nextId++,
    shape: spec.shape,
    x: lane,
    y: -36,
    vx: 0,
    vy: spec.speed * sector.pace,
    pace: sector.pace,
    mass: spec.mass,
    hp: spec.hp,
    maxHp: spec.hp,
    score: spec.score,
    age: 0,
    ai: true,
    kind,
    homeX: lane,
    shotClock: 1.2 * sector.rate,
    burst: 0,
    burstClock: 0,
    fired: 0,
    phase: 'enter',
    entryWarning: true,
    tell: 0,
    angle: Math.PI / 2,
    flash: 0,
    dead: false,
  };
}
export function makeCarrier(s) {
  const { carrier } = sectorOf(s);
  return {
    id: s.nextId++,
    shape: carrier.shape,
    x: 240,
    y: -48,
    vx: 0,
    vy: 25,
    mass: 500,
    hp: carrier.core,
    maxHp: carrier.core,
    boss: true,
    script: true,
    pace: sectorOf(s).pace,
    age: 0,
    shotClock: 2 * carrier.rate,
    tell: 0,
    angle: Math.PI / 2,
    flash: 0,
    dead: false,
    parts: carrier.turrets ? { l: carrier.turrets, r: carrier.turrets } : null,
    partMax: carrier.turrets,
    open: true,
    phase: 'enter',
    fired: 0,
    burst: 0,
    burstClock: 0,
  };
}
/** Drift and thrust for one tick: raiders sway and descend, the carrier hovers and sweeps. */
export function steerEnemy(e, h) {
  if (e.ai) {
    const spec = KINDS[e.kind],
      targetX = e.homeX + Math.sin(e.age * spec.swing) * spec.sway;
    thrust(e, h, (targetX - e.x) / 80, 1, {
      speed: spec.speed * e.pace,
      gain: 4,
      acceleration: 160,
      drag: 0.3,
      limits: false,
    });
  } else if (e.script) {
    const targetX = 240 + Math.sin(e.age * 0.42) * 125,
      holding = e.attackKind === 'beam' && ['charge', 'fire'].includes(e.phase);
    thrust(e, h, holding ? 0 : (targetX - e.x) / 70, (88 - e.y) / 65, {
      speed: 48,
      gain: 4,
      acceleration: 180,
      drag: 0.4,
      limits: false,
    });
  }
}
const turretsAlive = (e) => Boolean(e.parts && (e.parts.l > 0 || e.parts.r > 0));
function attackPattern(e, s) {
  const base = e.boss
    ? sectorOf(s).carrier.pattern[e.fired % sectorOf(s).carrier.pattern.length]
    : KINDS[e.kind].pattern;
  return base === 'turrets' && !turretsAlive(e) ? 'fan' : base;
}
export function muzzlePoint(e, offset = 0) {
  return { x: e.x + offset, y: e.y + hullHeight(e.shape) / 2 + 4 };
}
/** Lead the player: aim where the pilot would be after the round's flight time if they keep moving. */
function leadAngle(origin, player, speed) {
  let tx = player.x,
    ty = player.y;
  for (let pass = 0; pass < 3; pass++) {
    const time = Math.hypot(tx - origin.x, ty - origin.y) / speed;
    tx = clamp(player.x + player.vx * time, LIMIT.minX, LIMIT.maxX);
    ty = clamp(player.y + player.vy * time, LIMIT.minY, LIMIT.maxY);
  }
  return Math.atan2(ty - origin.y, tx - origin.x);
}
const speedOf = (e, base) => base * (e.pace ?? 1);
function volleyPlan(e) {
  const pattern = e.attackKind ?? 'aim',
    muzzle = (angle, speed, offset = 0) => ({ angle, speed: speedOf(e, speed), offset });
  if (pattern === 'beam' || pattern === 'burst') return [muzzle(e.angle, 125)];
  if (pattern === 'turrets') {
    const reach = turretOffset(e.shape);
    return [-1, 1]
      .filter((side) => !e.parts || e.parts[side < 0 ? 'l' : 'r'] > 0)
      .map((side) => muzzle(e.angle, 90, side * reach));
  }
  if (pattern === 'comb') {
    const slots = e.boss ? COMB_SLOTS : 7,
      plans = [];
    for (let k = 0; k < slots; k++)
      if (k !== e.gap && k !== e.gap + 1)
        plans.push(muzzle(Math.PI / 2 + (k - (slots - 1) / 2) * COMB_STEP, 80));
    return plans;
  }
  if (pattern === 'ring')
    return Array.from({ length: RING_COUNT }, (_, k) =>
      muzzle(e.phaseOffset + (k * Math.PI * 2) / RING_COUNT, 75),
    );
  const spreads =
    pattern === 'gap'
      ? GAP_SPREAD
      : pattern === 'fan'
        ? FAN_SPREAD
        : pattern === 'lead'
          ? LEAD_SPREAD
          : [0];
  return spreads.map((spread) =>
    muzzle(e.angle + spread, pattern === 'lead' ? 110 : e.boss ? 87 : 95),
  );
}
/** Gyro-mounted guns compensate hull drift; warning rays show their world velocity. */
export function warningRays(e) {
  return volleyPlan(e).map((plan) => ({
    origin: muzzlePoint(e, plan.offset),
    vx: Math.cos(plan.angle) * plan.speed,
    vy: Math.sin(plan.angle) * plan.speed,
  }));
}
function emit(s, e, angle, speed, offset = 0) {
  const origin = muzzlePoint(e, offset),
    share = e.mass / (e.mass + ROUND_MASS),
    rx = (Math.cos(angle) * speed - e.vx) / share,
    ry = (Math.sin(angle) * speed - e.vy) / share;
  const b = fireRound(e, Math.atan2(ry, rx), Math.hypot(rx, ry), {
    id: s.nextId++,
    owner: 'enemy',
    x: origin.x,
    y: origin.y,
    r: 3,
    mass: ROUND_MASS,
  });
  b.aimAngle = angle;
  s.bullets.push(b);
}
/** Lock the aim, pattern and any random choice at the start of the tell so the rays tell the truth. */
function beginTell(s, e, env) {
  e.attackKind = attackPattern(e, s);
  const origin = muzzlePoint(e),
    player = s.player;
  e.angle = Math.atan2(player.y - origin.y, player.x - origin.x);
  if (e.attackKind === 'lead') e.angle = leadAngle(origin, player, speedOf(e, 110));
  if (e.attackKind === 'comb') {
    e.angle = Math.PI / 2;
    e.gap = Math.floor(env.random() * ((e.boss ? COMB_SLOTS : 7) - 1));
  }
  if (e.attackKind === 'ring') e.phaseOffset = (env.random() * Math.PI * 2) / RING_COUNT;
  e.tell = e.attackKind === 'beam' ? BEAM_TELL : AIM_TELL;
  e.phase = 'charge';
}
export function enemyAttack(s, e, dt, env) {
  if (e.age < 1.5 || e.y < 60 || e.y > 218) return;
  const rate = e.boss ? sectorOf(s).carrier.rate : sectorOf(s).rate;
  e.shotClock = Math.max(0, e.shotClock - dt);
  e.burstClock = Math.max(0, e.burstClock - dt);
  if (e.burst > 0 && e.burstClock === 0) {
    emit(s, e, e.angle, speedOf(e, 125));
    e.burst--;
    e.burstClock = 0.09;
    e.phase = e.burst ? 'fire' : 'recover';
  }
  if (e.tell > 0) {
    e.tell = Math.max(0, e.tell - dt);
    if (e.tell === 0) {
      if (e.attackKind === 'beam' || e.attackKind === 'burst') {
        e.burst = e.attackKind === 'beam' ? 6 : 3;
        e.burstClock = 0;
        e.phase = 'fire';
      } else {
        for (const plan of volleyPlan(e)) emit(s, e, plan.angle, plan.speed, plan.offset);
        e.phase = 'recover';
      }
      e.fired++;
      e.shotClock = (e.boss ? 1.65 : 2.1) * rate;
    }
  } else if (e.shotClock === 0 && e.burst === 0) beginTell(s, e, env);
  if (e.boss) e.open = !['gap', 'beam'].includes(e.attackKind) || e.phase === 'recover';
}
