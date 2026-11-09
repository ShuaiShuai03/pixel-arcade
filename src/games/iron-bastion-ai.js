// Iron Bastion enemy side: path finding, arrivals and the tank crews' behaviour.
import { BEACON, LANES, R, ROLES, SHELL_R, SPAWN_Y } from './iron-bastion-data.js';
import { bodyFree, drive, fireShell, sweepCircleRect, turn, wrap } from './iron-bastion-physics.js';

const NAV_COLS = 37;
const NAV_ROWS = 21;
const NAV_PITCH = 12;
const NAV_X = 20;
const NAV_Y = 56;
const NAV_GOAL_LIMIT_Y = 238;
const THINK_TIME = 0.3;
const WARNING_TIME = 1.1;
const RETRY_TIME = 0.2;
const CHARGE_TIME = 0.7;
const AIM_TOLERANCE = 0.1;
const CHASE_RANGE = 190;
const JINK_ANGLE = 0.7;
const MIN_ARRIVAL_CLEARANCE = 44;
const MIN_ENEMY_GAP = 40;
const LANE_SHIFT_CHANCE = 0.25;
const ARRIVAL_COOLDOWN = 2.2;

export function sightBlock(s, a, b, r = R) {
  let nearest = Infinity,
    target = null;
  for (const t of s.tiles) {
    const d = sweepCircleRect(a.x, a.y, b.x - a.x, b.y - a.y, r, t);
    if (d < nearest) {
      nearest = d;
      target = t;
    }
  }
  return target;
}

// The free-space grid depends only on which tiles still stand, so it is cached per tile count.
const gridCache = new WeakMap();
function navGrid(s) {
  const key = `${s.field}:${s.tiles.length}`,
    hit = gridCache.get(s);
  if (hit && hit.key === key) return hit.nodes;
  const nodes = [];
  for (let y = 0; y < NAV_ROWS; y++)
    for (let x = 0; x < NAV_COLS; x++)
      nodes.push(bodyFree(s, NAV_X + x * NAV_PITCH, NAV_Y + y * NAV_PITCH));
  gridCache.set(s, { key, nodes });
  return nodes;
}

const nodeX = (n) => NAV_X + (n % NAV_COLS) * NAV_PITCH;
const nodeY = (n) => NAV_Y + Math.floor(n / NAV_COLS) * NAV_PITCH;

// Heading for a tank at `a` to reach `goal`: straight when clear, else down a breadth-first field.
export function nav(s, a, goal) {
  if (!sightBlock(s, a, goal)) return Math.atan2(goal.y - a.y, goal.x - a.x);
  const nodes = navGrid(s);
  const nearest = (p) => {
    let best = -1,
      d = Infinity;
    for (let n = 0; n < nodes.length; n++)
      if (nodes[n]) {
        const dx = nodeX(n) - p.x,
          dy = nodeY(n) - p.y,
          v = dx * dx + dy * dy;
        if (v < d) {
          d = v;
          best = n;
        }
      }
    return best;
  };
  const start = nearest(a),
    end = nearest(goal);
  if (start < 0 || end < 0) return a.angle;
  const q = [end],
    distance = new Map([[end, 0]]);
  for (let k = 0; k < q.length; k++) {
    const n = q[k],
      x = n % NAV_COLS,
      y = Math.floor(n / NAV_COLS);
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + ox,
        yy = y + oy,
        nn = yy * NAV_COLS + xx;
      if (xx >= 0 && xx < NAV_COLS && yy >= 0 && yy < NAV_ROWS && nodes[nn] && !distance.has(nn)) {
        distance.set(nn, distance.get(n) + 1);
        q.push(nn);
      }
    }
  }
  let next = start,
    best = distance.get(start) ?? Infinity;
  for (const n of [start - 1, start + 1, start - NAV_COLS, start + NAV_COLS])
    if ((distance.get(n) ?? Infinity) < best) {
      next = n;
      best = distance.get(n);
    }
  return Math.atan2(nodeY(next) - a.y, nodeX(next) - a.x);
}

const ENEMY_ROUNDS = 120; // shells an enemy tank carries
const arrivalSafe = (s, x) =>
  bodyFree(s, x, SPAWN_Y) &&
  Math.hypot(x - s.player.x, SPAWN_Y - s.player.y) > MIN_ARRIVAL_CLEARANCE &&
  !s.enemies.some((e) => Math.hypot(x - e.x, SPAWN_Y - e.y) < MIN_ENEMY_GAP);

function newEnemy(s, pending) {
  const role = ROLES[pending.role];
  return {
    id: `enemy:${s.field}:${s.spawned}`,
    x: pending.x,
    y: SPAWN_Y,
    r: R,
    mass: role.mass,
    rounds: ENEMY_ROUNDS,
    vx: 0,
    vy: 0,
    angle: Math.PI / 2,
    omega: 0,
    turret: Math.PI / 2,
    turretOmega: 0,
    bearing: Math.PI / 2,
    role: pending.role,
    hp: pending.hp,
    cooldown: ARRIVAL_COOLDOWN,
    charge: 0,
    aim: Math.PI / 2,
    think: 0,
    jink: 1,
    jinkTime: 0,
    flash: 0,
    muzzle: 0,
  };
}

// Arrivals: a short warning, then the tank rolls in. Lane and gap vary with env.random.
export function spawn(s, h, env, field) {
  s.spawnClock -= h;
  if (s.pendingSpawn) {
    const p = s.pendingSpawn;
    p.warning -= h;
    if (p.warning > 0) return;
    if (arrivalSafe(s, p.x)) {
      s.enemies.push(newEnemy(s, p));
      s.spawned++;
      s.spawnClock = field.gap * (0.75 + 0.5 * env.random());
      s.pendingSpawn = null;
    } else {
      const x = LANES.find((lane) => arrivalSafe(s, lane));
      if (x !== undefined) {
        p.x = x;
        p.warning = WARNING_TIME;
      } else p.warning = RETRY_TIME;
    }
    return;
  }
  if (s.spawned >= s.toSpawn || s.enemies.length >= field.live || s.spawnClock > 0) return;
  const spec = field.roster[s.spawned],
    roll = env.random(),
    shift = roll < LANE_SHIFT_CHANCE ? -1 : roll < 2 * LANE_SHIFT_CHANCE ? 1 : 0,
    wanted = Math.max(0, Math.min(LANES.length - 1, spec.lane + shift)),
    x = [LANES[wanted], LANES[spec.lane], ...LANES].find((lane) => arrivalSafe(s, lane));
  if (x !== undefined)
    s.pendingSpawn = { x, y: SPAWN_Y, warning: WARNING_TIME, role: spec.role, hp: spec.hp };
}

export function stepEnemies(s, h, env, field) {
  const p = s.player;
  for (const e of s.enemies) {
    const role = ROLES[e.role];
    e.cooldown = Math.max(0, e.cooldown - h);
    e.flash = Math.max(0, e.flash - h);
    e.muzzle = Math.max(0, e.muzzle - h);
    e.think -= h;
    const goal =
      role.chase && Math.hypot(p.x - e.x, p.y - e.y) < CHASE_RANGE ? { x: p.x, y: p.y } : BEACON;
    const block = sightBlock(s, e, goal, SHELL_R),
      range = Math.hypot(goal.x - e.x, goal.y - e.y),
      canFire = !block || !block.steel;
    if (e.think <= 0) {
      e.bearing = nav(s, e, { x: goal.x, y: Math.min(goal.y, NAV_GOAL_LIMIT_Y) });
      e.think = THINK_TIME;
    }
    if (role.jink) {
      e.jinkTime -= h;
      if (e.jinkTime <= 0) {
        e.jink = env.random() < 0.5 ? -1 : 1;
        e.jinkTime = 0.6 + 0.9 * env.random();
      }
    }
    const desiredAim = e.charge > 0 ? e.aim : Math.atan2(goal.y - e.y, goal.x - e.x);
    turn(e, 'turret', 'turretOmega', desiredAim, h);
    let halted = e.charge > 0 || (canFire && range < role.range);
    if (e.charge > 0) {
      e.charge = Math.max(0, e.charge - h);
      if (e.charge === 0) {
        fireShell(s, e, 'enemy', env);
        e.cooldown = role.cooldown * field.rate;
      }
    } else if (
      e.cooldown === 0 &&
      canFire &&
      Math.abs(wrap(desiredAim - e.turret)) < AIM_TOLERANCE
    ) {
      e.charge = CHARGE_TIME;
      e.aim = e.turret;
      halted = true;
    }
    drive(
      e,
      role.jink ? e.bearing + e.jink * JINK_ANGLE : e.bearing,
      !halted,
      h,
      role.speed * field.speed,
    );
  }
}
