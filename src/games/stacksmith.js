import { background, drawPixelText as text, clamp } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'stacksmith',
  name: { en: 'Stacksmith', zh: '叠塔工匠' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Run a harbour crane through 22 building jobs. The load hangs from a real pendulum: move the trolley with the arrow keys, let the swing die down, then press Space to drop it. Loads are rigid blocks of different sizes and weights, and a stack only stands when the combined centre of mass of everything above lies over the support below. Overhang too far and the block tips over the edge and falls. Build the dashed silhouette from the loads in the budget, then keep it standing for 3 seconds. Early jobs name each action and mark the ground where to drop; the last seven only show the outlines, so you judge the placement yourself. X swaps the hooked load for the next one when a job allows swaps. Wind and a rocking sea push the load later on. You have 3 tries per job, and finished jobs stay unlocked.',
    zh: '操纵港口起重机完成 22 项搭建任务。吊载是一个真实的单摆：用方向键移动小车，等摆动平息后按空格放下。吊载是不同大小和重量的刚性方块，只有当上方所有方块的合重心落在下方支撑面之内，塔才站得住；悬出太多，方块会绕边缘翻倒坠落。用预算内的吊载拼出虚线轮廓，并让它稳稳站立 3 秒。前面的任务会说出下一步动作，并在地面标出放下的位置；最后七项只显示轮廓，要自己判断放在哪里。部分任务允许按 X 把挂钩上的吊载换成下一件。后面的任务会有风和摇晃的海面推动吊载。每项任务有 3 次机会，完成的任务会保持解锁。',
  },
  keys: [
    {
      label: { en: 'Move the crane trolley', zh: '移动起重机小车' },
      keys: 'Left / Right or A / D',
    },
    { label: { en: 'Release the load', zh: '放下吊载' }, keys: 'Space' },
    { label: { en: 'Swap to the next load', zh: '换成下一件吊载' }, keys: 'X' },
    { label: { en: 'Pause', zh: '暂停' }, keys: 'P' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左移', 'left'],
    ['ArrowRight', 'Right', '右移', 'left'],
    ['Space', 'Drop', '放下', 'right'],
    ['KeyX', 'Swap', '换载', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 1 / 30,
  gravity: 300,
  railMin: 34,
  railMax: 200,
  clearance: 22,
  tallest: 40,
  boomSpeed: 36,
  rope: 72,
  damping: 1.0,
  trolleyMin: 28,
  trolleyMax: 452,
  trolleySpeed: 46,
  trolleyAccel: 70,
  trolleyBrake: 110,
  creepGain: 1.3,
  creepSpeed: 7,
  quayTop: 270,
  quayLeft: 36,
  quayRight: 444,
  tries: 3,
  holdTime: 3,
  promptHold: 0.55,
  think: 6,
  reelTime: 1,
  swapTime: 0.9,
  introTime: 4,
  clearPause: 3,
  skipAfter: 0.8,
  skipQuiet: 1,
  bounce: 0.25,
  failPause: 3.2,
  moveStart: 3.6,
  moveStop: 3,
  readyErr: 3.8,
  readySpeed: 5,
  holdStill: 0.7,
  readyAhead: Object.freeze([0, 0.2, 0.4, 0.6]),
  goalNeed: 0.55,
  goalCell: 6,
  outlineCell: 3,
  flatAngle: 0.1,
  planWindow: 12,
  impactSound: 70,
  sweepDelay: 1.2,
  hang: 3,
  hopeSlack: 1.15,
  collapseDrop: 0.4,
  scoreLevel: 100,
  scoreSpare: 40,
  scoreClean: 100,
  menuCols: 6,
});
const R = RULES;
const STEP = R.step;
const W = 480;
const H = 320;
const OMEGA_P = Math.sqrt(R.gravity / R.rope);

// Loads: size in pixels, density (mass per pixel^2), friction and material.
export const KINDS = Object.freeze({
  cube: { w: 24, h: 24, density: 1, mu: 0.6, mat: 'wood', name: ['crate', '木箱'] },
  plank: { w: 72, h: 8, density: 0.7, mu: 0.6, mat: 'wood', name: ['plank', '木板'] },
  beam: { w: 104, h: 10, density: 0.8, mu: 0.6, mat: 'wood', name: ['long beam', '长梁'] },
  brick: { w: 32, h: 16, density: 2.2, mu: 0.7, mat: 'stone', name: ['stone block', '石块'] },
  slab: { w: 60, h: 12, density: 2.2, mu: 0.7, mat: 'stone', name: ['stone slab', '石板'] },
  pillar: { w: 14, h: 40, density: 2.2, mu: 0.7, mat: 'stone', name: ['pillar', '石柱'] },
  weight: { w: 26, h: 16, density: 5, mu: 0.5, mat: 'steel', name: ['steel weight', '钢锭'] },
  gable: { w: 56, h: 24, density: 1, mu: 0.6, mat: 'roof', name: ['roof gable', '屋顶'] },
});
const kindArea = (kind) => (kind === 'gable' ? 0.5 : 1) * KINDS[kind].w * KINDS[kind].h;
export const kindMass = (kind) => kindArea(kind) * KINDS[kind].density;
const kindPoints = (kind) =>
  kind === 'gable'
    ? gablePoints(KINDS.gable.w, KINDS.gable.h)
    : rectPoints(KINDS[kind].w, KINDS[kind].h);
// --- Rigid-body engine (convex polygons, SAT + clipping, sequential impulses) ---

const SLOP = 0.35;
const BETA = 0.2;
const MAX_PUSH = 40;
const SPECULATIVE = 3.5;
const ITERATIONS = 40;
const GEOM_EPS = 1e-9;

// Polygon vertices are listed counter-clockwise in the maths sense (positive signed area), so the
// outward normal of the edge (ex, ey) is (ey, -ex). Screen y points down, gravity is +y.
function polygonProperties(points, density) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  cx /= 6 * area;
  cy /= 6 * area;
  const local = points.map(([x, y]) => [x - cx, y - cy]);
  let inertia = 0;
  for (let i = 0; i < local.length; i++) {
    const [x0, y0] = local[i];
    const [x1, y1] = local[(i + 1) % local.length];
    const cross = x0 * y1 - x1 * y0;
    inertia += cross * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1);
  }
  const mass = density * area;
  return { local, mass, inertia: (density * inertia) / 12, area, cx, cy };
}

export const rectPoints = (w, h) => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];
// A symmetric gable: base on the bottom edge, apex on top (screen y down, so apex has negative y).
export const gablePoints = (w, h) => [
  [0, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

export function makeBody(points, { x, y, density = 1, mu = 0.6, fixed = false, tag = null }) {
  const props = polygonProperties(points, density);
  const n = props.local.length;
  const body = {
    id: 0,
    tag,
    n,
    lx: Float64Array.from(props.local, (p) => p[0]),
    ly: Float64Array.from(props.local, (p) => p[1]),
    wx: new Float64Array(n),
    wy: new Float64Array(n),
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    x,
    y,
    a: 0,
    vx: 0,
    vy: 0,
    w: 0,
    pvx: 0,
    pvy: 0,
    pw: 0,
    mass: fixed ? 0 : props.mass,
    invM: fixed ? 0 : 1 / props.mass,
    invI: fixed ? 0 : 1 / props.inertia,
    inertia: props.inertia,
    area: props.area,
    mu,
    fixed,
    awake: !fixed,
    radius: Math.max(...props.local.map(([px, py]) => Math.hypot(px, py))),
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    gone: false,
  };
  updateGeometry(body);
  return body;
}

export function updateGeometry(b) {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < b.n; i++) {
    const x = b.x + c * b.lx[i] - s * b.ly[i];
    const y = b.y + s * b.lx[i] + c * b.ly[i];
    b.wx[i] = x;
    b.wy[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let i = 0; i < b.n; i++) {
    const j = (i + 1) % b.n;
    const ex = b.wx[j] - b.wx[i];
    const ey = b.wy[j] - b.wy[i];
    const len = Math.hypot(ex, ey) || GEOM_EPS;
    b.nx[i] = ey / len;
    b.ny[i] = -ex / len;
  }
  b.minX = minX;
  b.maxX = maxX;
  b.minY = minY;
  b.maxY = maxY;
}

function maxSeparation(a, b, found) {
  let best = -Infinity;
  for (let i = 0; i < a.n; i++) {
    const nx = a.nx[i];
    const ny = a.ny[i];
    const vx = a.wx[i];
    const vy = a.wy[i];
    let min = Infinity;
    for (let j = 0; j < b.n; j++) {
      const d = nx * (b.wx[j] - vx) + ny * (b.wy[j] - vy);
      if (d < min) min = d;
    }
    if (min > best) {
      best = min;
      found.edge = i;
    }
  }
  return best;
}

function clipSegment(p, q, dx, dy, offset, clipId) {
  const d0 = dx * p.x + dy * p.y - offset;
  const d1 = dx * q.x + dy * q.y - offset;
  const out = [];
  if (d0 >= 0) out.push(p);
  if (d1 >= 0) out.push(q);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y), id: clipId });
  }
  return out;
}

// Returns null or {nx, ny, pts:[{x, y, sep, id}]} with the normal pointing from a to b.
export function collide(a, b) {
  const found = { edge: 0 };
  const sepA = maxSeparation(a, b, found);
  if (sepA > SPECULATIVE) return null;
  const edgeA = found.edge;
  const sepB = maxSeparation(b, a, found);
  if (sepB > SPECULATIVE) return null;
  const edgeB = found.edge;
  const flip = sepB > sepA + 0.1;
  const ref = flip ? b : a;
  const inc = flip ? a : b;
  const re = flip ? edgeB : edgeA;
  const rnx = ref.nx[re];
  const rny = ref.ny[re];
  let ie = 0;
  let minDot = Infinity;
  for (let j = 0; j < inc.n; j++) {
    const d = rnx * inc.nx[j] + rny * inc.ny[j];
    if (d < minDot) {
      minDot = d;
      ie = j;
    }
  }
  const ie2 = (ie + 1) % inc.n;
  const p = { x: inc.wx[ie], y: inc.wy[ie], id: ie };
  const q = { x: inc.wx[ie2], y: inc.wy[ie2], id: ie2 };
  const re2 = (re + 1) % ref.n;
  const v1x = ref.wx[re];
  const v1y = ref.wy[re];
  const v2x = ref.wx[re2];
  const v2y = ref.wy[re2];
  const len = Math.hypot(v2x - v1x, v2y - v1y) || GEOM_EPS;
  const tx = (v2x - v1x) / len;
  const ty = (v2y - v1y) / len;
  let pts = clipSegment(p, q, tx, ty, tx * v1x + ty * v1y, 10);
  if (pts.length < 2) return null;
  pts = clipSegment(pts[0], pts[1], -tx, -ty, -(tx * v2x + ty * v2y), 11);
  if (pts.length < 2) return null;
  const out = [];
  for (const pt of pts) {
    const sep = rnx * (pt.x - v1x) + rny * (pt.y - v1y);
    if (sep > SPECULATIVE) continue;
    out.push({
      x: pt.x - 0.5 * sep * rnx,
      y: pt.y - 0.5 * sep * rny,
      sep,
      id: (flip ? 1000 : 0) + re * 100 + pt.id,
    });
  }
  if (!out.length) return null;
  return { nx: flip ? -rnx : rnx, ny: flip ? -rny : rny, pts: out };
}

export function createWorld(gravity) {
  return { gravity, bodies: [], arbiters: new Map(), quiet: 0, time: 0, seq: 0, impact: 0 };
}

export function addBody(world, body) {
  body.id = ++world.seq;
  world.bodies.push(body);
  if (!body.fixed) wakeAll(world);
  return body;
}

export function wakeAll(world) {
  world.quiet = 0;
  for (const b of world.bodies) if (!b.fixed) b.awake = true;
}

export function removeBody(world, body) {
  body.gone = true;
  world.bodies = world.bodies.filter((b) => b !== body);
  for (const key of [...world.arbiters.keys()]) {
    const arb = world.arbiters.get(key);
    if (arb.a === body || arb.b === body) world.arbiters.delete(key);
  }
}

function buildArbiters(world) {
  const { bodies, arbiters } = world;
  const seen = new Set();
  let woke = false;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (a.fixed && b.fixed) continue;
      if (!a.awake && !b.awake) continue;
      if (a.maxX < b.minX - SPECULATIVE || b.maxX < a.minX - SPECULATIVE) continue;
      if (a.maxY < b.minY - SPECULATIVE || b.maxY < a.minY - SPECULATIVE) continue;
      const first = a.id < b.id ? a : b;
      const second = first === a ? b : a;
      const m = collide(first, second);
      if (!m) continue;
      const key = first.id * 65536 + second.id;
      seen.add(key);
      const old = arbiters.get(key);
      const contacts = m.pts.map((pt) => {
        const prev = old && old.contacts.find((c) => c.id === pt.id);
        return {
          x: pt.x,
          y: pt.y,
          sep: pt.sep,
          id: pt.id,
          pn: prev ? prev.pn : 0,
          pt: prev ? prev.pt : 0,
          rax: 0,
          ray: 0,
          rbx: 0,
          rby: 0,
          massN: 0,
          massT: 0,
          bias: 0,
          push: 0,
          pnb: 0,
        };
      });
      arbiters.set(key, {
        a: first,
        b: second,
        nx: m.nx,
        ny: m.ny,
        mu: Math.sqrt(first.mu * second.mu),
        contacts,
      });
      const sleeper = (!a.fixed && !a.awake) || (!b.fixed && !b.awake);
      if (sleeper && m.pts.some((pt) => pt.sep < SLOP)) woke = true;
    }
  }
  for (const key of [...arbiters.keys()]) if (!seen.has(key)) arbiters.delete(key);
  return woke;
}

function prepareArbiter(arb, dt, world) {
  const { a, b, nx, ny } = arb;
  const tx = -ny;
  const ty = nx;
  for (const c of arb.contacts) {
    c.rax = c.x - a.x;
    c.ray = c.y - a.y;
    c.rbx = c.x - b.x;
    c.rby = c.y - b.y;
    const rnA = c.rax * ny - c.ray * nx;
    const rnB = c.rbx * ny - c.rby * nx;
    c.massN = 1 / (a.invM + b.invM + a.invI * rnA * rnA + b.invI * rnB * rnB);
    const rtA = c.rax * ty - c.ray * tx;
    const rtB = c.rbx * ty - c.rby * tx;
    c.massT = 1 / (a.invM + b.invM + a.invI * rtA * rtA + b.invI * rtB * rtB);
    if (c.sep < 0.5) {
      const vn =
        (b.vx - b.w * c.rby - a.vx + a.w * c.ray) * nx +
        (b.vy + b.w * c.rbx - a.vy - a.w * c.rax) * ny;
      if (-vn > world.impact) world.impact = -vn;
    }
    c.bias = c.sep > 0 ? -c.sep / dt : 0;
    c.push = c.sep > 0 ? 0 : Math.min(MAX_PUSH, (BETA / dt) * Math.max(0, -c.sep - SLOP));
    c.pnb = 0;
    applyImpulse(a, b, c, nx * c.pn + tx * c.pt, ny * c.pn + ty * c.pt);
  }
}

function applyImpulse(a, b, c, px, py) {
  a.vx -= a.invM * px;
  a.vy -= a.invM * py;
  a.w -= a.invI * (c.rax * py - c.ray * px);
  b.vx += b.invM * px;
  b.vy += b.invM * py;
  b.w += b.invI * (c.rbx * py - c.rby * px);
}

function solveArbiter(arb) {
  const { a, b, nx, ny, mu } = arb;
  const tx = -ny;
  const ty = nx;
  for (const c of arb.contacts) {
    let dvx = b.vx - b.w * c.rby - a.vx + a.w * c.ray;
    let dvy = b.vy + b.w * c.rbx - a.vy - a.w * c.rax;
    const vn = dvx * nx + dvy * ny;
    const pn0 = c.pn;
    c.pn = Math.max(0, pn0 + c.massN * (c.bias - vn));
    const dn = c.pn - pn0;
    applyImpulse(a, b, c, nx * dn, ny * dn);
    dvx = b.vx - b.w * c.rby - a.vx + a.w * c.ray;
    dvy = b.vy + b.w * c.rbx - a.vy - a.w * c.rax;
    const vt = dvx * tx + dvy * ty;
    const limit = mu * c.pn;
    const pt0 = c.pt;
    c.pt = Math.max(-limit, Math.min(limit, pt0 - c.massT * vt));
    const dt = c.pt - pt0;
    applyImpulse(a, b, c, tx * dt, ty * dt);
    if (c.push > 0) {
      // Penetration is removed with pseudo velocities that move bodies apart without adding kinetic energy.
      const vnb =
        (b.pvx - b.pw * c.rby - a.pvx + a.pw * c.ray) * nx +
        (b.pvy + b.pw * c.rbx - a.pvy - a.pw * c.rax) * ny;
      const pnb0 = c.pnb;
      c.pnb = Math.max(0, pnb0 + c.massN * (c.push - vnb));
      const dp = c.pnb - pnb0;
      a.pvx -= a.invM * nx * dp;
      a.pvy -= a.invM * ny * dp;
      a.pw -= a.invI * (c.rax * ny * dp - c.ray * nx * dp);
      b.pvx += b.invM * nx * dp;
      b.pvy += b.invM * ny * dp;
      b.pw += b.invI * (c.rbx * ny * dp - c.rby * nx * dp);
    }
  }
}

export const SLEEP_SPEED = 3;
export const SLEEP_TIME = 0.5;

// Motion of a body: the fastest point on it, in px/s.
export const motionOf = (b) => Math.hypot(b.vx, b.vy) + Math.abs(b.w) * b.radius;

export function stepWorld(world, dt) {
  const { bodies } = world;
  world.time += dt;
  let anyAwake = false;
  for (const b of bodies) if (b.awake && !b.fixed) anyAwake = true;
  if (!anyAwake) return 0;
  world.impact = 0;
  for (const b of bodies) {
    if (b.fixed || !b.awake) continue;
    b.vy += world.gravity * dt;
  }
  if (buildArbiters(world)) wakeAll(world);
  const arbs = [...world.arbiters.values()];
  for (const arb of arbs) prepareArbiter(arb, dt, world);
  for (let it = 0; it < ITERATIONS; it++) for (const arb of arbs) solveArbiter(arb);
  let fastest = 0;
  for (const b of bodies) {
    if (b.fixed || !b.awake) continue;
    b.x += (b.vx + b.pvx) * dt;
    b.y += (b.vy + b.pvy) * dt;
    b.a += (b.w + b.pw) * dt;
    b.pvx = 0;
    b.pvy = 0;
    b.pw = 0;
    updateGeometry(b);
    fastest = Math.max(fastest, motionOf(b));
  }
  world.quiet = fastest < SLEEP_SPEED ? world.quiet + dt : 0;
  if (world.quiet >= SLEEP_TIME) {
    for (const b of bodies) {
      if (b.fixed) continue;
      b.awake = false;
      b.vx = 0;
      b.vy = 0;
      b.w = 0;
    }
  }
  return world.impact;
}

// Mechanical energy of the dynamic bodies (kinetic + potential, y measured up from `floorY`).
export function worldEnergy(world, floorY) {
  let e = 0;
  for (const b of world.bodies) {
    if (b.fixed) continue;
    e += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.inertia * b.w * b.w;
    e += b.mass * world.gravity * (floorY - b.y);
  }
  return e;
}

// --- Geometry helpers (pure) ---

export function pointInBody(b, px, py) {
  for (let i = 0; i < b.n; i++)
    if (b.nx[i] * (px - b.wx[i]) + b.ny[i] * (py - b.wy[i]) > 0) return false;
  return true;
}

// Sample points of a goal rectangle {x, y, w, h} (top-left origin) on a coarse grid.
export function goalSamples(rect, cell = R.goalCell) {
  const nx = Math.max(1, Math.round(rect.w / cell));
  const ny = Math.max(1, Math.round(rect.h / cell));
  const pts = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      pts.push([rect.x + ((i + 0.5) * rect.w) / nx, rect.y + ((j + 0.5) * rect.h) / ny]);
  return pts;
}

// Fraction of each goal's sample points that lie inside a dynamic body.
export function goalFill(world, goals) {
  // A load only counts as built while it stands upright: tilted or toppled loads fill nothing.
  const loads = world.bodies.filter(
    (b) => !b.fixed && Math.abs(Math.atan2(Math.sin(b.a), Math.cos(b.a))) < R.flatAngle,
  );
  return goals.map((g) => {
    const mine = g.kind ? loads.filter((b) => b.tag === g.kind) : loads;
    let hit = 0;
    for (const [px, py] of g.samples) if (mine.some((b) => pointInBody(b, px, py))) hit++;
    return hit / g.samples.length;
  });
}

// --- Level compilation ---

export function compileLevel(def) {
  // Outline jobs are judged on a finer grid, so a load that sits off its outline is measurably short.
  const cell = def.aim === 'outline' ? R.outlineCell : R.goalCell;
  const goals = def.goals.map(([x, y, w, h, need, kind]) => {
    const rect = { x, y, w, h };
    return {
      ...rect,
      kind: kind || null,
      samples: goalSamples(rect, cell),
      need: need ?? def.need ?? R.goalNeed,
    };
  });
  return {
    name: def.name,
    tip: def.tip,
    piers: def.piers || [],
    lot: def.lot,
    loads: [...def.loads],
    plan: def.plan.map(([kind, x]) => ({ kind, x })),
    goals,
    swaps: def.swaps || 0,
    outline: def.aim === 'outline',
    wind: def.wind || null,
    sea: def.sea || null,
    start: def.start ?? 240,
    spare: def.loads.length - def.plan.length,
  };
}

export function buildWorld(level) {
  const world = createWorld(R.gravity);
  const quay = makeBody(rectPoints(R.quayRight - R.quayLeft, 40), {
    x: (R.quayLeft + R.quayRight) / 2,
    y: R.quayTop + 20,
    fixed: true,
    mu: 0.9,
    tag: 'quay',
  });
  addBody(world, quay);
  for (const [x, top, w, h] of level.piers)
    addBody(
      world,
      makeBody(rectPoints(w, h), {
        x: x + w / 2,
        y: top + h / 2,
        fixed: true,
        mu: 0.9,
        tag: 'pier',
      }),
    );
  return world;
}

export function spawnLoad(world, kind, x, y, vx = 0, vy = 0) {
  const k = KINDS[kind];
  const body = makeBody(kindPoints(kind), { x, y, density: k.density, mu: k.mu, tag: kind });
  body.vx = vx;
  body.vy = vy;
  return addBody(world, body);
}

// The crane boom rides up and down its mast so a hung load always clears the highest point by a margin.
export const boomHeight = (world) =>
  clamp(
    Math.min(...world.bodies.map((b) => b.minY)) - R.clearance - R.rope - R.tallest,
    R.railMin,
    R.railMax,
  );

// --- Wind, sea and the pendulum ---

export const windAccel = (level, t) =>
  level.wind ? level.wind[0] + level.wind[1] * Math.sin((2 * Math.PI * t) / level.wind[2]) : 0;
export const seaOffset = (level, t) =>
  level.sea ? level.sea[0] * Math.sin((2 * Math.PI * t) / level.sea[1]) : 0;
export const seaAccel = (level, t) =>
  level.sea
    ? -level.sea[0] *
      ((2 * Math.PI) / level.sea[1]) ** 2 *
      Math.sin((2 * Math.PI * t) / level.sea[1])
    : 0;
export const seaSpeed = (level) => (level.sea ? (level.sea[0] * 2 * Math.PI) / level.sea[1] : 0);

// Where a hung load would fall if released now: a ballistic fall until its footprint meets a body.
export function predictLanding(world, hook, kind) {
  const k = KINDS[kind];
  let x = hook.x;
  let y = hook.y + R.hang + k.h / 2;
  let vy = hook.vy;
  const dt = 1 / 60;
  for (let i = 0; i < 240; i++) {
    vy += R.gravity * dt;
    y += vy * dt;
    x += hook.vx * dt;
    for (const b of world.bodies) {
      if (b.gone || x + k.w / 2 <= b.minX || x - k.w / 2 >= b.maxX) continue;
      if (y + k.h / 2 >= b.minY && y - k.h / 2 <= b.maxY)
        return { x, y: b.minY - k.h / 2, t: (i + 1) * dt };
    }
  }
  return { x, y, t: 240 * dt };
}

// Largest drop-guide gap: the unmet goal samples' centre, used when the plan can no longer be followed.
export function unmetCentre(level, fills) {
  let sum = 0;
  let count = 0;
  level.goals.forEach((g, i) => {
    if (fills[i] >= g.need) return;
    sum += g.x + g.w / 2;
    count++;
  });
  return count ? sum / count : null;
}

// --- Levels ---
// Goals are the resting silhouettes of the planned loads, generated by simulating the plan.
const deepFreeze = (v) => {
  if (v && typeof v === 'object') Object.values(v).forEach(deepFreeze);
  return Object.freeze(v);
};
export const LEVELS = deepFreeze([
  {
    name: ['First Course', '第一层'],
    tip: [
      'Stack three crates, each one right above the one below.',
      '把三个木箱叠起来，每个都放在下面那个的正上方。',
    ],
    lot: [120, 360],
    loads: ['cube', 'cube', 'cube', 'cube'],
    plan: [
      ['cube', 240],
      ['cube', 240],
      ['cube', 240],
    ],
    goals: [
      [234, 246, 12, 24, null, 'cube'],
      [234, 222, 12, 24, null, 'cube'],
      [234, 198, 12, 24, null, 'cube'],
    ],
  },
  {
    name: ['Side by Side', '并肩而立'],
    tip: ['A stone slab carries two crates side by side.', '石板上并排放两个木箱。'],
    lot: [120, 360],
    loads: ['slab', 'cube', 'cube', 'cube'],
    plan: [
      ['slab', 240],
      ['cube', 222],
      ['cube', 258],
    ],
    goals: [
      [210, 258, 60, 12, null, 'slab'],
      [216, 234, 12, 24, null, 'cube'],
      [252, 234, 12, 24, null, 'cube'],
    ],
    start: 350,
  },
  {
    name: ['Pyramid', '小金字塔'],
    tip: [
      'Lay the wide row, then bridge the gaps above it.',
      '先摆最宽的一排，再在缝隙上搭上一层。',
    ],
    lot: [120, 360],
    loads: ['brick', 'brick', 'brick', 'brick', 'brick', 'brick', 'brick'],
    plan: [
      ['brick', 240],
      ['brick', 196],
      ['brick', 284],
      ['brick', 218],
      ['brick', 262],
      ['brick', 240],
    ],
    goals: [
      [232, 254, 16, 16, null, 'brick'],
      [188, 254, 16, 16, null, 'brick'],
      [276, 254, 16, 16, null, 'brick'],
      [210, 238, 16, 16, null, 'brick'],
      [254, 238, 16, 16, null, 'brick'],
      [232, 222, 16, 16, null, 'brick'],
    ],
    start: 350,
  },
  {
    name: ['The Gate', '石门'],
    tip: [
      'Two pillars, a beam, then a roof. Swap if the roof comes first.',
      '两根石柱，架上横梁，再盖屋顶。屋顶先到时按 X 换件。',
    ],
    lot: [120, 360],
    loads: ['pillar', 'pillar', 'gable', 'beam', 'cube'],
    plan: [
      ['pillar', 200],
      ['pillar', 280],
      ['beam', 240],
      ['gable', 240],
    ],
    goals: [
      [190, 230, 20, 40, 0.3, 'pillar'],
      [270, 230, 20, 40, 0.3, 'pillar'],
      [188, 220, 104, 10, null, 'beam'],
      [225, 210, 30, 8, null, 'gable'],
    ],
    swaps: 1,
    start: 350,
  },
  {
    name: ['Dock Bridge', '码头小桥'],
    tip: [
      'The piers are fixed. Lay the beam, then load the deck.',
      '桥墩是固定的。先架横梁，再在桥面上装货。',
    ],
    lot: [120, 360],
    piers: [
      [168, 230, 36, 40],
      [276, 230, 36, 40],
    ],
    loads: ['cube', 'beam', 'cube'],
    plan: [
      ['beam', 240],
      ['cube', 222],
      ['cube', 258],
    ],
    goals: [
      [188, 220, 104, 10, null, 'beam'],
      [216, 196, 12, 24, null, 'cube'],
      [252, 196, 12, 24, null, 'cube'],
    ],
    swaps: 1,
    start: 350,
  },
  {
    name: ['Cantilever', '悬臂'],
    tip: [
      'Steel behind the plank, then the far end. Swap to reorder.',
      '先在板后方放钢锭，再放远端。按 X 调整顺序。',
    ],
    lot: [120, 360],
    loads: ['slab', 'plank', 'brick', 'weight', 'brick'],
    plan: [
      ['slab', 242],
      ['plank', 256],
      ['weight', 239],
      ['brick', 278],
    ],
    goals: [
      [212, 258, 60, 12, null, 'slab'],
      [220, 250, 72, 8, null, 'plank'],
      [232, 234, 15, 16, null, 'weight'],
      [270, 234, 16, 16, null, 'brick'],
    ],
    swaps: 1,
    start: 350,
  },
  {
    name: ['Swap Shop', '换件作坊'],
    tip: [
      'The slab must go first. Press X to swap the hooked load.',
      '石板要先放。按 X 换下挂钩上的吊载。',
    ],
    lot: [120, 360],
    loads: ['cube', 'slab', 'cube', 'brick', 'brick'],
    plan: [
      ['slab', 244],
      ['cube', 224],
      ['cube', 260],
      ['brick', 234],
    ],
    goals: [
      [214, 258, 60, 12, null, 'slab'],
      [218, 234, 12, 24, null, 'cube'],
      [254, 234, 12, 24, null, 'cube'],
      [226, 218, 16, 16, null, 'brick'],
    ],
    swaps: 1,
    start: 350,
  },
  {
    name: ['Twin Towers', '双塔'],
    tip: [
      'Raise two towers, then lay the beam across their tops.',
      '先建两座塔，再把横梁架在塔顶。',
    ],
    lot: [120, 360],
    loads: ['brick', 'brick', 'brick', 'beam', 'brick', 'brick'],
    plan: [
      ['brick', 190],
      ['brick', 190],
      ['brick', 290],
      ['brick', 290],
      ['beam', 240],
    ],
    goals: [
      [182, 254, 16, 16, null, 'brick'],
      [182, 238, 16, 16, null, 'brick'],
      [282, 254, 16, 16, null, 'brick'],
      [282, 238, 16, 16, null, 'brick'],
      [188, 228, 104, 10, null, 'beam'],
    ],
    swaps: 1,
    start: 350,
    sea: [8, 6.5],
  },
  {
    name: ['Lean Tower', '斜塔'],
    tip: [
      'Each brick sits a little further right than the one below.',
      '每块石砖都比下面那块再靠右一点。',
    ],
    lot: [120, 360],
    loads: ['brick', 'brick', 'brick', 'brick', 'brick', 'brick'],
    plan: [
      ['brick', 228],
      ['brick', 230],
      ['brick', 232],
      ['brick', 234],
      ['brick', 236],
    ],
    goals: [
      [220, 254, 16, 16, null, 'brick'],
      [222, 238, 16, 16, null, 'brick'],
      [224, 222, 16, 16, null, 'brick'],
      [226, 206, 16, 16, null, 'brick'],
      [228, 190, 16, 16, null, 'brick'],
    ],
    start: 350,
  },
  {
    name: ['Tall Order', '高耸'],
    tip: ['Five crates high. A light breeze pushes the load.', '五个木箱叠高。微风会推动吊载。'],
    lot: [120, 360],
    loads: ['cube', 'cube', 'cube', 'cube', 'cube', 'cube'],
    plan: [
      ['cube', 240],
      ['cube', 240],
      ['cube', 240],
      ['cube', 240],
      ['cube', 240],
    ],
    goals: [
      [234, 246, 12, 24, null, 'cube'],
      [234, 222, 12, 24, null, 'cube'],
      [234, 198, 12, 24, null, 'cube'],
      [234, 174, 12, 24, null, 'cube'],
      [234, 150, 12, 24, null, 'cube'],
    ],
    start: 350,
    wind: [14, 8, 9],
  },
  {
    name: ['Long Arm', '长臂'],
    tip: [
      'Beam over the water: steel behind the arm before the tip.',
      '长梁伸向水面。尖端之前，先在臂后方放钢锭。',
    ],
    lot: [120, 360],
    loads: ['slab', 'beam', 'cube', 'weight', 'cube'],
    plan: [
      ['slab', 236],
      ['beam', 258],
      ['weight', 224],
      ['cube', 298],
    ],
    goals: [
      [206, 258, 60, 12, null, 'slab'],
      [206, 248, 104, 10, null, 'beam'],
      [216, 232, 15, 16, null, 'weight'],
      [291, 224, 12, 24, null, 'cube'],
    ],
    swaps: 1,
    start: 350,
  },
  {
    name: ['Lighthouse', '灯塔'],
    tip: [
      'Wind and swell sway the load. Release as it crosses the mark.',
      '风和涌浪让吊载摇摆。在它摆过标记时放下。',
    ],
    lot: [120, 360],
    loads: ['slab', 'brick', 'brick', 'cube', 'gable', 'cube'],
    plan: [
      ['slab', 240],
      ['brick', 240],
      ['brick', 240],
      ['cube', 240],
      ['gable', 240],
    ],
    goals: [
      [210, 258, 60, 12, null, 'slab'],
      [232, 242, 16, 16, null, 'brick'],
      [232, 226, 16, 16, null, 'brick'],
      [234, 202, 12, 24, null, 'cube'],
      [225, 192, 30, 8, null, 'gable'],
    ],
    start: 350,
    wind: [10, 6, 8],
    sea: [8, 6.5],
  },
  {
    name: ['Staircase', '台阶'],
    tip: [
      'Three columns of crates: one, two and three high.',
      '三列木箱：分别叠一个、两个、三个。',
    ],
    lot: [120, 360],
    loads: ['cube', 'cube', 'cube', 'cube', 'cube', 'cube', 'cube'],
    plan: [
      ['cube', 276],
      ['cube', 276],
      ['cube', 276],
      ['cube', 240],
      ['cube', 240],
      ['cube', 204],
    ],
    goals: [
      [270, 246, 12, 24, null, 'cube'],
      [270, 222, 12, 24, null, 'cube'],
      [270, 198, 12, 24, null, 'cube'],
      [234, 246, 12, 24, null, 'cube'],
      [234, 222, 12, 24, null, 'cube'],
      [198, 246, 12, 24, null, 'cube'],
    ],
    start: 130,
  },
  {
    name: ['Rolling Sea', '摇摆海面'],
    tip: [
      'The barge rocks in the swell. Drop as the load crosses the mark.',
      '驳船随海浪摇晃。吊载经过标记时放下。',
    ],
    lot: [120, 360],
    loads: ['slab', 'pillar', 'pillar', 'beam', 'gable', 'cube'],
    plan: [
      ['slab', 238],
      ['pillar', 222],
      ['pillar', 252],
      ['beam', 240],
      ['gable', 240],
    ],
    goals: [
      [208, 258, 60, 12, null, 'slab'],
      [212, 218, 20, 40, 0.3, 'pillar'],
      [242, 218, 20, 40, 0.3, 'pillar'],
      [188, 208, 104, 10, null, 'beam'],
      [225, 198, 30, 8, null, 'gable'],
    ],
    start: 350,
    sea: [6, 6.5],
  },
  {
    name: ['Gatehouse', '门楼'],
    tip: ['A gate on a bridge: beam, pillars, slab, roof.', '桥上的门楼：横梁、石柱、石板、屋顶。'],
    lot: [120, 360],
    piers: [
      [168, 230, 36, 40],
      [276, 230, 36, 40],
    ],
    loads: ['pillar', 'beam', 'pillar', 'gable', 'slab', 'cube'],
    plan: [
      ['beam', 240],
      ['pillar', 214],
      ['pillar', 266],
      ['slab', 240],
      ['gable', 240],
    ],
    goals: [
      [188, 220, 104, 10, null, 'beam'],
      [204, 180, 20, 40, 0.3, 'pillar'],
      [256, 180, 20, 40, 0.3, 'pillar'],
      [210, 168, 60, 12, null, 'slab'],
      [225, 158, 30, 8, null, 'gable'],
    ],
    swaps: 2,
    start: 350,
    sea: [8, 6.5],
  },
  {
    name: ['Windy Wall', '风中砖墙'],
    tip: [
      'Bricks, slab, roof in steady wind. Swap if the roof is early.',
      '强风中砌砖墙、盖石板和屋顶。屋顶先到时按 X 换件。',
    ],
    lot: [120, 360],
    loads: ['brick', 'brick', 'brick', 'brick', 'brick', 'brick', 'brick', 'gable', 'slab'],
    plan: [
      ['brick', 218],
      ['brick', 262],
      ['brick', 174],
      ['brick', 306],
      ['brick', 196],
      ['brick', 240],
      ['brick', 284],
      ['slab', 240],
      ['gable', 240],
    ],
    goals: [
      [202, 254, 32, 16, 0.7, 'brick'],
      [246, 254, 32, 16, 0.7, 'brick'],
      [158, 254, 32, 16, 0.7, 'brick'],
      [290, 254, 32, 16, 0.7, 'brick'],
      [180, 238, 32, 16, 0.7, 'brick'],
      [224, 238, 32, 16, 0.7, 'brick'],
      [268, 238, 32, 16, 0.7, 'brick'],
      [210, 226, 60, 12, 0.78, 'slab'],
      [225, 216, 30, 8, null, 'gable'],
    ],
    swaps: 1,
    aim: 'outline',
    start: 350,
    wind: [24, 12, 9],
  },
  {
    name: ['Right Order', '讲究顺序'],
    tip: [
      'Two swaps. Slab first; steel goes on before the tip.',
      '允许换两次。石板最先放，钢锭要在尖端之前放。',
    ],
    lot: [120, 360],
    loads: ['plank', 'slab', 'brick', 'weight', 'brick'],
    plan: [
      ['slab', 228],
      ['plank', 248],
      ['weight', 224],
      ['brick', 272],
    ],
    goals: [
      [198, 258, 60, 12, 0.78, 'slab'],
      [212, 250, 72, 8, 0.78, 'plank'],
      [210.5, 234, 26, 16, 0.68, 'weight'],
      [255, 234, 32, 16, 0.7, 'brick'],
    ],
    swaps: 2,
    aim: 'outline',
    start: 350,
  },
  {
    name: ['Left Reach', '向左伸出'],
    tip: [
      'Reach left. Steel behind the arm first, then the tip.',
      '向左伸出长臂。先放臂后方的钢锭，再放尖端。',
    ],
    lot: [120, 360],
    loads: ['slab', 'beam', 'cube', 'weight', 'cube'],
    plan: [
      ['slab', 244],
      ['beam', 222],
      ['weight', 256],
      ['cube', 182],
    ],
    goals: [
      [214, 258, 60, 12, 0.78, 'slab'],
      [170, 248, 104, 10, 0.78, 'beam'],
      [243.5, 232, 26, 16, 0.68, 'weight'],
      [171, 224, 24, 24, 0.68, 'cube'],
    ],
    swaps: 1,
    aim: 'outline',
    start: 130,
  },
  {
    name: ['Storm Bridge', '风暴天桥'],
    tip: [
      'Two crate towers, a plank across and a crate on top. Strong wind.',
      '两座木箱塔，架上木板，再放一个木箱，风很大。',
    ],
    lot: [120, 360],
    loads: ['cube', 'cube', 'cube', 'plank', 'cube', 'cube', 'cube', 'cube'],
    plan: [
      ['cube', 204],
      ['cube', 204],
      ['cube', 276],
      ['cube', 276],
      ['plank', 240],
      ['cube', 240],
    ],
    goals: [
      [192, 246, 24, 24, 0.5, 'cube'],
      [192, 222, 24, 24, 0.5, 'cube'],
      [264, 246, 24, 24, 0.5, 'cube'],
      [264, 222, 24, 24, 0.5, 'cube'],
      [204, 214, 72, 8, 0.78, 'plank'],
      [228, 190, 24, 24, 0.5, 'cube'],
    ],
    swaps: 1,
    aim: 'outline',
    start: 350,
    wind: [9, 8, 7],
    sea: [8, 6.5],
  },
  {
    name: ['Rocking Quay', '摇晃码头'],
    tip: [
      'A bigger swell: build the gate while the barge rocks.',
      '更大的涌浪：在驳船摇晃时建石门。',
    ],
    lot: [120, 360],
    loads: ['slab', 'pillar', 'pillar', 'beam', 'gable', 'cube'],
    plan: [
      ['slab', 238],
      ['pillar', 222],
      ['pillar', 252],
      ['beam', 240],
      ['gable', 240],
    ],
    goals: [
      [208, 258, 60, 12, 0.78, 'slab'],
      [214.5, 218, 15, 40, 0.4, 'pillar'],
      [244.5, 218, 15, 40, 0.4, 'pillar'],
      [188, 208, 104, 10, 0.78, 'beam'],
      [225, 198, 30, 8, null, 'gable'],
    ],
    aim: 'outline',
    start: 350,
    sea: [8, 6.5],
  },
  {
    name: ['Balance', '平衡'],
    tip: [
      'Steel at both ends of the plank, a second plank across them.',
      '板的两端各放钢锭，再横架一块木板。',
    ],
    lot: [120, 360],
    loads: ['plank', 'slab', 'weight', 'plank', 'weight', 'gable'],
    plan: [
      ['slab', 240],
      ['plank', 240],
      ['weight', 218],
      ['weight', 262],
      ['plank', 240],
    ],
    goals: [
      [210, 258, 60, 12, 0.78, 'slab'],
      [204, 250, 72, 8, 0.78, 'plank'],
      [205.5, 234, 26, 16, 0.68, 'weight'],
      [248.5, 234, 26, 16, 0.68, 'weight'],
      [204, 226, 72, 8, 0.78, 'plank'],
    ],
    swaps: 2,
    aim: 'outline',
    start: 350,
  },
  {
    name: ['Master Mason', '建造大师'],
    tip: [
      'Wind, swell and swaps together. Build the gatehouse.',
      '风、涌浪和换件一起来。建成门楼。',
    ],
    lot: [120, 360],
    piers: [
      [168, 230, 36, 40],
      [276, 230, 36, 40],
    ],
    loads: ['pillar', 'beam', 'pillar', 'slab', 'gable', 'weight', 'cube'],
    plan: [
      ['beam', 240],
      ['pillar', 214],
      ['pillar', 266],
      ['slab', 240],
      ['gable', 240],
    ],
    goals: [
      [188, 220, 104, 10, 0.78, 'beam'],
      [206.5, 180, 15, 40, 0.4, 'pillar'],
      [258.5, 180, 15, 40, 0.4, 'pillar'],
      [210, 168, 60, 12, 0.78, 'slab'],
      [225, 158, 30, 8, null, 'gable'],
    ],
    swaps: 2,
    aim: 'outline',
    start: 350,
    wind: [10, 8, 8],
    sea: [8, 6.5],
  },
]);

// --- Game state ---

const ARROW = { 1: '→', '-1': '←' };
const WORDS = {
  menu: ['Arrows pick a job, Space starts it', '方向键选择任务，空格开始'],
  reel: ['The next load is being hooked on', '正在挂上下一件吊载'],
  settle: ['Wait for the tower to settle', '等待塔身稳定'],
  hold: ['Tower built: keep clear for 3 seconds', '塔已建成：保持 3 秒不要动'],
  steady: ['Let the swing die down, then drop', '等摆动平息，再放下'],
  aim: ['Line the load up with its outline, then drop', '把吊载对准它的轮廓，再放下'],
  drop: ['Press Space to release the load', '按空格放下吊载'],
  cleared: ['Job done. The next job is coming up', '任务完成，下一项任务即将开始'],
  failed: ['Out of loads. Try again', '吊载用完了，再试一次'],
  collapsed: ['The tower fell. Try again', '塔倒了，再试一次'],
  wasted: ['Not enough material left. Try again', '吊载不够了，再试一次'],
  won: ['Every job is built', '所有任务都已建成'],
  lost: ['Out of tries', '机会已用完'],
};

export const LEVEL_COUNT = LEVELS.length;

function loadLevel(s, index, keepTries = false) {
  const def = compileLevel(LEVELS[index]);
  s.level = index;
  s.def = def;
  if (!keepTries) s.tries = R.tries;
  s.world = buildWorld(def);
  s.crane = { x: def.start, v: 0, th: 0, om: 0, aTr: 0 };
  s.rail = boomHeight(s.world);
  s.queue = [...def.loads];
  s.next = s.queue.shift() || null;
  s.reel = R.reelTime;
  s.hook = null;
  s.swapsLeft = def.swaps;
  s.mode = 'play';
  s.failWhy = null;
  s.modeT = 0;
  s.clock = 0;
  s.holdT = 0;
  s.movedAt = 0;
  s.peakFill = 0;
  s.step = 0;
  s.offPlan = false;
  s.verify = null;
  s.fills = goalFill(s.world, def.goals);
  s.dirty = false;
  s.sleepT = 0;
  s.marker = null;
  s.creepAt = null;
  s.pendingRelease = false;
  s.pendingSwap = false;
  s.actedAt = -1e9;
  s.quietUntil = -1e9;
  s.line = null;
  s.msg = null;
  s.intro = R.introTime;
  s.lastImpact = -1e9;
  s.splashes = [];
  s.released = 0;
  s.lost = 0;
  s.menu = null;
  think(s, true);
}

// Saved progress is a convenience: a broken store must never stop the game.
function readUnlocked(progress) {
  try {
    const raw = Number(progress?.unlocked?.());
    if (raw === Infinity) return LEVEL_COUNT;
    return Number.isFinite(raw) ? clamp(Math.floor(raw), 1, LEVEL_COUNT) : 1;
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, level) {
  try {
    progress?.unlock?.(level);
  } catch {
    // The level is still cleared in this session even when the store refuses the write.
  }
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    acc: 0,
    ticks: 0,
    time: 0,
    progress: env.progress || null,
    best: Array(LEVEL_COUNT).fill(0),
    stats: { drops: 0, tips: 0, lost: 0, swaps: 0, cleared: 0, failed: 0 },
    prevSpace: null,
    prevSwap: null,
    menu: null,
  };
  const unlocked = readUnlocked(s.progress);
  loadLevel(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    think(s, true);
  }
  return s;
}

const say = (s, en, zh) => {
  s.msg = { en, zh, time: 2.6 };
};

// --- Crane and pendulum ---

const windOffset = (s) => {
  const a = windAccel(s.def, s.clock);
  return R.rope * Math.sin(Math.atan(a / R.gravity));
};
const restX = (s) => s.crane.x + windOffset(s);

function hookAt(def, x, v, th, om, clock, rail) {
  const px = x + seaOffset(def, clock);
  const sv = seaSpeed(def) * Math.cos((2 * Math.PI * clock) / (def.sea ? def.sea[1] : 1)) || 0;
  return {
    x: px + R.rope * Math.sin(th),
    y: rail + R.rope * Math.cos(th),
    vx: v + sv + R.rope * Math.cos(th) * om,
    vy: -R.rope * Math.sin(th) * om,
    px,
  };
}

export function hookOf(s) {
  const c = s.crane;
  return hookAt(s.def, c.x, c.v, c.th, c.om, s.clock, s.rail);
}

// Where the hook will be at each of the given delays if the trolley stands still from now on.
function forecastHook(s, delays) {
  const c = s.crane;
  let th = c.th;
  let om = c.om;
  let t = s.clock;
  const out = [];
  const last = delays[delays.length - 1];
  for (let u = 0, i = 0; i < delays.length && u <= last + 1e-9; u += STEP) {
    if (u >= delays[i] - 1e-9) {
      out.push(hookAt(s.def, c.x, 0, th, om, t, s.rail));
      i++;
    }
    const push = windAccel(s.def, t) - seaAccel(s.def, t);
    om +=
      (-(R.gravity / R.rope) * Math.sin(th) - R.damping * om + (push / R.rope) * Math.cos(th)) *
      STEP;
    th += om * STEP;
    t += STEP;
  }
  return out;
}

function craneTick(s, dir) {
  const c = s.crane;
  let target = dir * R.trolleySpeed;
  // The trolley eases in near its target. On outline jobs the target is the nearest empty outline of the
  // hooked load's kind (all of them are drawn), and only an approach is eased, never a departure.
  const aimAt = s.marker ?? s.creepAt;
  if (dir !== 0 && aimAt !== null && (s.marker !== null || dir * (aimAt - restX(s)) > 0)) {
    const cap = Math.max(R.creepSpeed, R.creepGain * Math.abs(restX(s) - aimAt));
    target = dir * Math.min(R.trolleySpeed, cap);
  }
  const braking = Math.abs(target) < Math.abs(c.v) || target * c.v < 0;
  const rate = (braking ? R.trolleyBrake : R.trolleyAccel) * STEP;
  let nv = c.v + clamp(target - c.v, -rate, rate);
  let nx = c.x + nv * STEP;
  if (nx < R.trolleyMin || nx > R.trolleyMax) {
    nx = clamp(nx, R.trolleyMin, R.trolleyMax);
    nv = 0;
  }
  c.aTr = (nv - c.v) / STEP;
  c.v = nv;
  c.x = nx;
  const push = windAccel(s.def, s.clock) - c.aTr - seaAccel(s.def, s.clock);
  const acc =
    -(R.gravity / R.rope) * Math.sin(c.th) - R.damping * c.om + (push / R.rope) * Math.cos(c.th);
  c.om += acc * STEP;
  c.th += c.om * STEP;
}

function releaseLoad(s, emit) {
  const h = hookOf(s);
  const k = KINDS[s.hook.kind];
  const body = spawnLoad(s.world, s.hook.kind, h.x, h.y + R.hang + k.h / 2, h.vx, h.vy);
  s.released++;
  s.stats.drops++;
  s.verify = { body, step: !s.offPlan && s.step < s.def.plan.length ? s.step : -1 };
  if (!s.offPlan && s.step < s.def.plan.length) s.step++;
  s.hook = null;
  s.next = s.queue.shift() || null;
  s.reel = R.reelTime;
  s.dirty = true;
  s.actedAt = s.time;
  think(s, true);
  emit('move');
}

function swapLoad(s, emit) {
  const old = s.hook.kind;
  s.next = s.queue[0];
  s.queue[0] = old;
  s.hook = null;
  s.swapsLeft--;
  s.stats.swaps++;
  s.reel = R.swapTime;
  s.actedAt = s.time;
  think(s, true);
  emit('move');
}

// --- Plan, goals and the prompt ---

const allMet = (s) => s.fills.every((f, i) => f >= s.def.goals[i].need);
const asleep = (s) => s.world.bodies.every((b) => b.fixed || !b.awake);

function currentTarget(s) {
  if (!s.hook) return null;
  const plan = s.def.plan[s.step];
  if (!s.offPlan && plan) {
    if (plan.kind === s.hook.kind) return { x: plan.x, swap: false };
    if (s.swapsLeft > 0 && s.queue[0] === plan.kind)
      return { x: plan.x, swap: true, kind: plan.kind };
    s.offPlan = true;
    say(s, 'Off plan: aim at the empty target', '偏离计划：对准空缺的目标');
  }
  const gap = unmetCentre(s.def, s.fills);
  const lot = s.def.lot;
  return { x: clamp(gap ?? (lot[0] + lot[1]) / 2, R.trolleyMin, R.trolleyMax), swap: false };
}

// Outline jobs name no target: the prompt only says when the load is calm enough, never where to put it.
function outlineAdvice(s) {
  if (!asleep(s)) return { id: 'settle', words: WORDS.settle, marker: null };
  const calm = s.clock - s.movedAt >= R.holdStill;
  const speedOk = Math.abs(hookOf(s).vx) <= R.readySpeed + seaSpeed(s.def);
  const steering = Math.abs(s.crane.v) > 0.3;
  return steering || (calm && speedOk)
    ? { id: 'aim', words: WORDS.aim, marker: null }
    : { id: 'steady', words: WORDS.steady, marker: null };
}

function adviceOf(s) {
  if (s.phase === 'won' || s.phase === 'lost')
    return { id: s.phase, words: WORDS[s.phase], marker: null };
  if (s.menu) return { id: 'menu', words: WORDS.menu, marker: null };
  if (s.mode === 'cleared') return { id: 'cleared', words: WORDS.cleared, marker: null };
  if (s.mode === 'failed') {
    const why = { collapse: 'collapsed', waste: 'wasted' }[s.failWhy] || 'failed';
    return { id: why, words: WORDS[why], marker: null };
  }
  if (!s.hook) {
    if (s.reel > 0 || s.next) return { id: 'reel', words: WORDS.reel, marker: null };
    if (allMet(s) && asleep(s)) return { id: 'hold', words: WORDS.hold, marker: null };
    return { id: 'settle', words: WORDS.settle, marker: null };
  }
  if (allMet(s) && (s.def.outline || s.offPlan || s.step >= s.def.plan.length))
    return asleep(s)
      ? { id: 'hold', words: WORDS.hold, marker: null }
      : { id: 'settle', words: WORDS.settle, marker: null };
  if (s.def.outline) return outlineAdvice(s);
  const goal = currentTarget(s);
  if (goal.swap) {
    const k = KINDS[goal.kind].name;
    return {
      id: 'swap',
      words: [`Press X to swap in the ${k[0]}`, `按 X 换成${k[1]}`],
      marker: goal.x,
    };
  }
  const d = restX(s) - goal.x;
  const prev = s.line?.id;
  const moving = prev === 'move+' || prev === 'move-';
  if (Math.abs(d) > (moving ? R.moveStop : R.moveStart)) {
    const dir = d > 0 ? -1 : 1;
    return {
      id: dir > 0 ? 'move+' : 'move-',
      words: [
        `Move ${ARROW[dir]} until the load is over the mark`,
        `向${dir > 0 ? '右' : '左'}${ARROW[dir]}移动，直到吊载在标记上方`,
      ],
      marker: goal.x,
      dir,
    };
  }
  const h = hookOf(s);
  const land = predictLanding(s.world, h, s.hook.kind);
  const speedOk = Math.abs(h.vx) <= R.readySpeed + seaSpeed(s.def);
  // The drop is called only when the landing stays on the mark for the whole time a slow reader may need,
  // so waves and gusts cannot carry the load off while the key goes down.
  const ahead = forecastHook(s, R.readyAhead);
  const still = s.clock - s.movedAt >= R.holdStill;
  const ready =
    speedOk && still && ahead.every((f) => Math.abs(f.x + f.vx * land.t - goal.x) <= R.readyErr);
  if (!ready) return { id: 'steady', words: WORDS.steady, marker: goal.x };
  if (!asleep(s)) return { id: 'settle', words: WORDS.settle, marker: goal.x };
  return { id: 'drop', words: WORDS.drop, marker: goal.x };
}

// On windy or rocking jobs the landing prediction would do the timing for the player, so it only shows
// while the prompt is asking for the drop itself.
export const landingShown = (s) =>
  !(s.def.wind || s.def.sea) || s.def.outline || s.line?.id === 'drop';

function think(s, reset = false) {
  // A player who reads the prompt late keeps the trolley moving for a moment after a move line ends.
  if (s.line?.id?.startsWith('move') || Math.abs(s.crane.v) > 0.3) s.movedAt = s.clock;
  const a = adviceOf(s);
  const cur = s.line;
  if (reset || !cur || (a.id !== cur.id && cur.age >= R.promptHold)) {
    s.line = { id: a.id, en: a.words[0], zh: a.words[1], age: 0, dir: a.dir || 0 };
  } else {
    cur.age += R.think * STEP;
  }
  s.marker = a.marker ?? null;
  s.creepAt = s.def.outline && s.hook ? nearestOutline(s) : null;
}

function nearestOutline(s) {
  const here = restX(s);
  let best = null;
  s.def.goals.forEach((g, i) => {
    if (g.kind !== s.hook.kind || s.fills[i] >= g.need) return;
    const x = g.x + g.w / 2;
    if (best === null || Math.abs(x - here) < Math.abs(best - here)) best = x;
  });
  return best;
}

// --- Simulation tick ---

function attachNext(s) {
  if (!s.next) return;
  s.hook = { kind: s.next };
  s.movedAt = s.clock;
  s.next = null;
  s.dirty = true;
}

// Dock crew: loads that sank, or lie on the quay away from the building lot, are cleared away.
function cleanUp(s) {
  const world = s.world;
  for (const b of [...world.bodies]) {
    if (b.fixed) continue;
    const sunk = b.y > R.quayTop + 30 && (b.x < R.quayLeft || b.x > R.quayRight);
    if (b.y > H + 60 || sunk) {
      s.splashes.push({ x: clamp(b.x, 0, W), t: 0 });
      removeBody(world, b);
      s.lost++;
      s.stats.lost++;
      s.dirty = true;
      say(s, 'A load fell into the sea', '一件吊载掉进了海里');
      wakeAll(world);
    }
  }
  if (asleep(s)) {
    s.sleepT += STEP;
    if (s.sleepT >= R.sweepDelay) {
      const [x0, x1] = s.def.lot;
      for (const b of [...world.bodies]) {
        if (b.fixed || (b.x >= x0 && b.x <= x1) || b.maxY < R.quayTop - 1) continue;
        removeBody(world, b);
        s.stats.lost++;
        s.dirty = true;
        wakeAll(world);
        say(s, 'The dock crew cleared a fallen load', '码头工人清走了掉落的吊载');
      }
    }
  } else s.sleepT = 0;
}

function checkDrop(s) {
  const v = s.verify;
  if (!v || !asleep(s)) return;
  s.verify = null;
  if (v.step < 0 || !v.body || v.body.gone) return;
  const plan = s.def.plan[v.step];
  const b = v.body;
  if (Math.abs(b.x - plan.x) > R.planWindow || Math.abs(b.a) > 0.12) {
    s.stats.tips++;
    if (!s.offPlan && !s.def.outline)
      say(s, 'Off plan: that load shifted', '偏离计划：这件吊载移位了');
    s.offPlan = true;
  }
}

function finishLevel(s, emit) {
  const spare = s.queue.length + (s.hook ? 1 : 0) + (s.next ? 1 : 0);
  const gained = R.scoreLevel + spare * R.scoreSpare + (s.tries === R.tries ? R.scoreClean : 0);
  s.best[s.level] = Math.max(s.best[s.level], gained);
  s.score = s.best.reduce((a, v) => a + v, 0);
  saveUnlocked(s.progress, Math.min(LEVEL_COUNT, s.level + 2));
  s.stats.cleared++;
  if (s.level === LEVEL_COUNT - 1) {
    s.phase = 'won';
    think(s, true);
    return;
  }
  s.mode = 'cleared';
  s.modeT = R.clearPause;
  think(s, true);
  emit('coin');
}

// Necessary condition for a win: the remaining loads must have enough area to fill what the goals still need.
function hopeless(s) {
  let need = 0;
  s.def.goals.forEach((g, i) => {
    need += Math.max(0, g.need - s.fills[i]) * g.w * g.h;
  });
  const kinds = [...s.queue, ...(s.hook ? [s.hook.kind] : []), ...(s.next ? [s.next] : [])];
  const area = kinds.reduce((sum, kind) => sum + kindArea(kind), 0);
  return need > area * R.hopeSlack;
}

function failLevel(s, emit, why) {
  s.failWhy = why;
  s.tries--;
  s.stats.failed++;
  emit('hit');
  if (s.tries <= 0) {
    s.phase = 'lost';
    think(s, true);
    return;
  }
  s.mode = 'failed';
  s.modeT = R.failPause;
  think(s, true);
}

function tick(s, dir, emit) {
  s.ticks++;
  s.time += STEP;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  s.splashes = s.splashes.filter((p) => (p.t += STEP) < 1);
  if (s.mode !== 'play') {
    s.modeT -= STEP;
    // A fresh Space or X press after the first moment of the pause carries on at once.
    const length = s.mode === 'cleared' ? R.clearPause : R.failPause;
    const skipped = (s.pendingRelease || s.pendingSwap) && length - s.modeT >= R.skipAfter;
    if (skipped) s.modeT = 0;
    s.pendingRelease = false;
    s.pendingSwap = false;
    if (s.modeT <= 0) {
      if (s.mode === 'cleared') loadLevel(s, s.level + 1);
      else loadLevel(s, s.level, true);
      // Taps that carried the banner on must not also drop the first load of the next job.
      if (skipped) s.quietUntil = s.time + R.skipQuiet;
    }
    if (s.ticks % R.think === 0) think(s);
    return;
  }
  s.clock += STEP;
  if (s.intro > 0) s.intro -= STEP;
  if (s.reel > 0) {
    s.reel -= STEP;
    if (s.reel <= 0) attachNext(s);
  }
  craneTick(s, dir);
  const railTarget = boomHeight(s.world);
  s.rail += clamp(railTarget - s.rail, -R.boomSpeed * STEP, R.boomSpeed * STEP);
  // A press made while the next load is still being hooked on waits for the hook instead of vanishing.
  if (s.hook) {
    if (s.pendingRelease) releaseLoad(s, emit);
    else if (s.pendingSwap && s.swapsLeft > 0 && s.queue.length) swapLoad(s, emit);
    s.pendingRelease = false;
    s.pendingSwap = false;
  } else if (s.reel <= 0 && !s.next) {
    s.pendingRelease = false;
    s.pendingSwap = false;
  }
  const wasAwake = !asleep(s);
  const impact = stepWorld(s.world, STEP);
  if (impact > R.impactSound && s.time - s.lastImpact > 0.15) {
    s.lastImpact = s.time;
    emit('hit');
  }
  cleanUp(s);
  if (wasAwake || s.dirty) {
    s.fills = goalFill(s.world, s.def.goals);
    s.dirty = false;
  }
  checkDrop(s);
  s.peakFill = Math.max(
    s.peakFill,
    s.fills.reduce((sum, f) => sum + f, 0),
  );
  const settled = asleep(s);
  s.holdT = allMet(s) && settled ? s.holdT + STEP : 0;
  if (s.holdT >= R.holdTime) finishLevel(s, emit);
  else if (settled && s.sleepT >= 1 && s.released > 0 && !allMet(s)) {
    if (!s.hook && !s.next && s.reel <= 0) failLevel(s, emit, 'budget');
    else if (hopeless(s)) {
      // A drop in the fill since the best point means loads really fell; otherwise the budget was wasted.
      const total = s.fills.reduce((sum, f) => sum + f, 0);
      failLevel(s, emit, total < s.peakFill - R.collapseDrop ? 'collapse' : 'waste');
    }
  }
  if (s.ticks % R.think === 0) think(s);
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  let sel = clamp(m.sel + step + row * R.menuCols, 1, m.unlocked);
  let go = input.pressed('Space', 'Enter');
  const p = input.pointer;
  if (p && p.clicked) {
    const hit = menuCellAt(p.x, p.y, m.unlocked);
    if (hit) {
      sel = hit;
      go = true;
    }
  }
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (go) {
    loadLevel(s, sel - 1);
    emit('move');
  }
}

export function menuCellAt(x, y, unlocked) {
  const col = Math.floor((x - MENU.x0) / MENU.cw);
  const row = Math.floor((y - MENU.y0) / MENU.ch);
  if (col < 0 || col >= R.menuCols || row < 0 || x < MENU.x0 || y < MENU.y0) return 0;
  const n = row * R.menuCols + col + 1;
  return n >= 1 && n <= unlocked ? n : 0;
}
const MENU = { x0: 36, y0: 78, cw: 68, ch: 40 };

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return false;
  dt = Math.min(dt, R.maxDt);
  const space = input.held('Space');
  const swap = input.held('KeyX');
  if (s.menu) {
    menuInput(s, input, emit);
    // The key that opened a job must not count as a drop on the job's first frame.
    s.prevSpace = space;
    s.prevSwap = swap;
    think(s);
    return true;
  }
  // A second tap right after an action is key bounce, not a request for the next load.
  const bouncing = s.time - s.actedAt < R.bounce || s.time < s.quietUntil;
  // A key already down when the game was created (the key that started it) is not a press.
  const spaceEdge = input.pressed('Space') || (space && s.prevSpace === false);
  const swapEdge = input.pressed('KeyX') || (swap && s.prevSwap === false);
  if (!bouncing && spaceEdge) s.pendingRelease = true;
  if (!bouncing && swapEdge) s.pendingSwap = true;
  s.prevSpace = space;
  s.prevSwap = swap;
  const dir =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, emit);
  return true;
}

// --- Snapshot and game object ---

const polyOf = (b) => Array.from({ length: b.n }, (_, i) => [b.wx[i], b.wy[i]]);
const bodyView = (b) => ({
  id: b.id,
  kind: b.tag,
  x: b.x,
  y: b.y,
  angle: b.a,
  vx: b.vx,
  vy: b.vy,
  omega: b.w,
  mass: b.mass,
  awake: b.awake,
  verts: polyOf(b),
});

// The goals as the player sees them. On outline jobs they are listed bottom row first, left to right,
// so the list does not give away the order the loads are meant to go in.
function goalViews(s) {
  const views = s.def.goals.map((g, i) => ({
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    need: g.need,
    kind: g.kind,
    fill: s.fills[i],
    met: s.fills[i] >= g.need,
  }));
  return s.def.outline ? views.sort((a, b) => b.y + b.h - (a.y + a.h) || a.x - b.x) : views;
}

export function snapshotOf(s) {
  const finished = s.phase !== 'playing';
  const h = hookOf(s);
  const line = s.line || { en: '', zh: '', id: null, dir: 0 };
  const def = s.def;
  const loads = s.world.bodies.filter((b) => !b.fixed);
  const left = s.queue.length + (s.hook ? 1 : 0) + (s.next ? 1 : 0);
  const land = s.hook ? predictLanding(s.world, h, s.hook.kind) : null;
  const label = (lang) =>
    s.menu
      ? line[lang]
      : `${lang === 'en' ? 'Job' : '任务'} ${s.level + 1}/${LEVEL_COUNT} ${def.name[lang === 'en' ? 0 : 1]} · ${line[lang]}`;
  return {
    phase: s.phase,
    score: s.score,
    time: s.clock,
    level: s.level + 1,
    levels: LEVEL_COUNT,
    levelName: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    tries: s.tries,
    mode: s.mode,
    loadsLeft: left,
    queue: [...s.queue],
    swapsLeft: s.swapsLeft,
    hook: s.hook ? { kind: s.hook.kind, x: h.x, y: h.y, vx: h.vx, vy: h.vy } : null,
    crane: {
      x: s.crane.x,
      v: s.crane.v,
      theta: s.crane.th,
      omega: s.crane.om,
      hookX: h.x,
      hookY: h.y,
      swing: Math.hypot(R.rope * s.crane.th, (R.rope * s.crane.om) / OMEGA_P),
    },
    bodies: loads.map(bodyView),
    statics: s.world.bodies.filter((b) => b.fixed).map(bodyView),
    goals: goalViews(s),
    hold: { time: s.holdT, need: R.holdTime },
    quiet: asleep(s),
    energy: worldEnergy(s.world, R.quayTop),
    wind: windAccel(def, s.clock),
    sea: seaOffset(def, s.clock),
    plan: { step: Math.min(s.step, def.plan.length), steps: def.plan.length, off: s.offPlan },
    prompt: { en: line.en, zh: line.zh, id: line.id },
    line: { en: line.en, zh: line.zh },
    guide:
      finished || !s.hook || s.menu
        ? null
        : {
            x: s.marker,
            dir: line.dir,
            outline: def.outline,
            landing: land && landingShown(s) ? { x: land.x, y: land.y } : null,
          },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
    status: finished
      ? s.phase === 'won'
        ? { en: `All jobs built! Score ${s.score}`, zh: `全部任务完成！得分 ${s.score}` }
        : { en: `Out of tries. Score ${s.score}`, zh: `机会用完。得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        emit(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'Every job is built. The harbour is proud of you!',
                '所有任务都已建成，港口为你骄傲！',
              )
            : env.t(
                'Out of tries. The tower did not stand. Try again!',
                '机会用完了，塔没有立住，再试一次！',
              ),
        });
      }
    },
    draw(ctx) {
      drawGame(ctx, s, env);
    },
    getState() {
      return snapshotOf(s);
    },
  };
}

// --- Drawing ---

const PAL = {
  skyBands: [
    '#16213f',
    '#1b2a50',
    '#223460',
    '#2c4172',
    '#3b5483',
    '#566b94',
    '#8a7f9a',
    '#c98f7a',
  ],
  far: '#243049',
  near: '#1b2438',
  sea: '#1a4766',
  seaLight: '#2d7096',
  seaFoam: '#8bc4dc',
  quayTop: '#8b8f96',
  quayFace: '#5d6068',
  quayDark: '#454850',
  steelRail: '#d9a441',
  steelDark: '#8a6a22',
  rope: '#d8d2c0',
  panel: '#0a1220',
  panelEdge: '#2a3a5c',
  ink: '#e8eefc',
  dim: '#8b98b8',
  good: '#6fe08c',
  bad: '#ff6b5e',
  gold: '#ffd24a',
  guide: '#7ee7ff',
};
const MATS = {
  wood: { base: '#c8955a', dark: '#8a5a30', light: '#e3b983' },
  stone: { base: '#9aa3ad', dark: '#5f6873', light: '#c9d1d9' },
  steel: { base: '#6f8bb0', dark: '#3d5578', light: '#b4cbe6' },
  roof: { base: '#c0473f', dark: '#7d2a28', light: '#e88a7a' },
};
const FAR_CRANES = [
  [30, 60],
  [120, 92],
  [214, 54],
  [330, 80],
  [410, 64],
];

const box = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

function drawSky(ctx, t) {
  PAL.skyBands.forEach((c, i) => box(ctx, 0, i * 36, W, 37, c));
  for (const [x, h] of FAR_CRANES) {
    box(ctx, x, R.quayTop - h, 3, h, PAL.far);
    box(ctx, x - 14, R.quayTop - h, 34, 3, PAL.far);
    box(ctx, x + 14, R.quayTop - h + 3, 1, 12, PAL.far);
  }
  box(ctx, 0, R.quayTop - 14, W, 14, PAL.near);
  for (let i = 0; i < 9; i++)
    box(ctx, 20 + i * 54, R.quayTop - 20 - ((i * 7) % 9), 22, 20, PAL.near);
  const lamp = Math.floor(t * 2) % 2;
  box(ctx, 392, R.quayTop - 66, 2, 4, lamp ? PAL.bad : '#7a2b2b');
}

function drawSea(ctx, t, sway) {
  box(ctx, 0, R.quayTop, W, 60, PAL.sea);
  for (let x = 0; x < W; x += 6) {
    const y = R.quayTop + 2 + Math.round(Math.sin(x * 0.07 + t * 1.6) * 1.6);
    box(ctx, x, y, 4, 1, PAL.seaLight);
    if ((x / 6 + Math.floor(t * 2)) % 7 === 0) box(ctx, x, y - 1, 3, 1, PAL.seaFoam);
  }
  const bob = Math.round(sway * 0.25);
  for (const x0 of [0, W - 40]) {
    box(ctx, x0, R.quayTop + 4 + bob, 40, 8, '#3b3f48');
    box(ctx, x0, R.quayTop + 4 + bob, 40, 2, '#5a6070');
  }
}

function drawQuay(ctx) {
  const x0 = R.quayLeft;
  const w = R.quayRight - R.quayLeft;
  box(ctx, x0, R.quayTop, w, 30, PAL.quayFace);
  box(ctx, x0, R.quayTop, w, 3, PAL.quayTop);
  for (let x = x0 + 12; x < R.quayRight; x += 24) box(ctx, x, R.quayTop + 10, 10, 1, PAL.quayDark);
  for (let x = x0; x < R.quayRight; x += 24) box(ctx, x, R.quayTop + 20, 10, 1, PAL.quayDark);
  box(ctx, x0, R.quayTop + 28, w, 2, PAL.quayDark);
  for (const bx of [x0 + 8, R.quayRight - 14]) {
    box(ctx, bx, R.quayTop - 5, 6, 5, '#2f3238');
    box(ctx, bx + 1, R.quayTop - 6, 4, 2, '#4a4e57');
  }
}

function drawPier(ctx, b) {
  const x = b.minX;
  const y = b.minY;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  box(ctx, x, y, w, h, PAL.quayFace);
  box(ctx, x, y, w, 3, PAL.quayTop);
  for (let r = 8; r < h; r += 8) box(ctx, x, y + r, w, 1, PAL.quayDark);
  for (let r = 0; r < h; r += 16)
    for (let c = (r / 16) % 2 ? 6 : 18; c < w; c += 24)
      box(ctx, x + c, y + r + 3, 1, 5, PAL.quayDark);
  box(ctx, x + w - 2, y, 2, h, PAL.quayDark);
}

function polyPath(ctx, verts) {
  ctx.beginPath();
  verts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

// A load, drawn in its own rotated frame so every material keeps its texture when it tips.
function drawLoad(ctx, kind, x, y, angle, alpha = 1) {
  const k = KINDS[kind];
  const m = MATS[k.mat];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  const hw = k.w / 2;
  const hh = k.h / 2;
  if (kind === 'gable') {
    polyPath(ctx, [
      [0, -hh],
      [hw, hh],
      [-hw, hh],
    ]);
    ctx.fillStyle = m.base;
    ctx.fill();
    ctx.strokeStyle = m.dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = m.dark;
    for (let r = 1; r < 4; r++) ctx.fillRect(-hw * (r / 4) + 2, hh - r * 6, hw * (r / 2) - 4, 1);
    ctx.fillStyle = m.light;
    ctx.fillRect(-2, -hh + 4, 2, 2);
  } else {
    ctx.fillStyle = m.base;
    ctx.fillRect(-hw, -hh, k.w, k.h);
    ctx.fillStyle = m.light;
    ctx.fillRect(-hw, -hh, k.w, 1);
    ctx.fillRect(-hw, -hh, 1, k.h);
    ctx.fillStyle = m.dark;
    ctx.fillRect(-hw, hh - 1, k.w, 1);
    ctx.fillRect(hw - 1, -hh, 1, k.h);
    if (k.mat === 'wood') {
      for (let r = 4; r < k.h - 1; r += 5) ctx.fillRect(-hw + 2, -hh + r, k.w - 4, 1);
      if (kind === 'cube') {
        ctx.fillRect(-hw + 2, -hh + 2, 2, k.h - 4);
        ctx.fillRect(hw - 4, -hh + 2, 2, k.h - 4);
      }
    } else if (k.mat === 'stone') {
      for (let c = 10; c < k.w - 2; c += 14) ctx.fillRect(-hw + c, -hh + 2, 1, k.h - 4);
      ctx.fillRect(-hw + 3, -hh + 3, 4, 1);
    } else {
      for (const cx of [-hw + 3, hw - 5]) {
        ctx.fillStyle = m.light;
        ctx.fillRect(cx, -hh + 3, 2, 2);
        ctx.fillRect(cx, hh - 5, 2, 2);
      }
      ctx.fillStyle = m.dark;
      ctx.fillRect(-hw + 8, -hh + 2, 1, k.h - 4);
      ctx.fillRect(hw - 9, -hh + 2, 1, k.h - 4);
    }
  }
  ctx.restore();
}

// Dashed outline made of 3-pixel dashes, so it stays crisp and works on any canvas.
function dashedRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < w; i += 6) {
    ctx.fillRect(Math.round(x + i), Math.round(y), Math.min(3, w - i), 1);
    ctx.fillRect(Math.round(x + i), Math.round(y + h - 1), Math.min(3, w - i), 1);
  }
  for (let j = 0; j < h; j += 6) {
    ctx.fillRect(Math.round(x), Math.round(y + j), 1, Math.min(3, h - j));
    ctx.fillRect(Math.round(x + w - 1), Math.round(y + j), 1, Math.min(3, h - j));
  }
}

const WIDE_CHAR = /[　-鿿＀-￯]/;
const textWidth = (str, size) =>
  [...str].reduce((w, ch) => w + (WIDE_CHAR.test(ch) ? size : size * 0.6), 0);
const massTonnes = (kind) => Math.round(kindMass(kind) / 100);

// A mass label that fits `room` pixels: the unit goes first when it does not fit, then the size.
function massLabel(kind, zh, room, size = 8) {
  const n = String(massTonnes(kind));
  const tries = [
    [`${n}${zh ? '吨' : 't'}`, size],
    [`${n}${zh ? '吨' : 't'}`, size - 1],
    [n, size],
  ];
  const fit = tries.find(([str, sz]) => textWidth(str, sz) <= room) || [n, size - 1];
  return { str: fit[0], size: fit[1], w: textWidth(fit[0], fit[1]) };
}

// Mass labels stay inside the canvas, and labels never sit on top of each other.
const LABEL_EDGE = 3;
const labelBox = (label, cx, y) => {
  const x = clamp(cx, LABEL_EDGE + label.w / 2, W - LABEL_EDGE - label.w / 2);
  return { x0: x - label.w / 2 - 1, x1: x + label.w / 2 + 1, y0: y, y1: y + label.size + 1, x };
};
const boxesTouch = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function hookLabel(s, zh) {
  if (!s.hook || s.mode !== 'play') return null;
  const h = hookOf(s);
  const label = massLabel(s.hook.kind, zh, 40, 9);
  return { label, ...labelBox(label, h.x, h.y - 14) };
}

function drawGoals(ctx, s, zh) {
  const hung = hookLabel(s, zh);
  s.def.goals.forEach((g, i) => {
    const met = s.fills[i] >= g.need;
    if (met) {
      ctx.globalAlpha = 0.25;
      box(ctx, g.x, g.y, g.w, g.h, PAL.good);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.14;
      box(ctx, g.x, g.y, g.w, g.h, PAL.gold);
      if (g.kind) {
        // a faint picture of the load that belongs here
        const k = KINDS[g.kind];
        const cy = g.kind === 'gable' ? g.y + g.h + 2 - k.h / 2 : g.y + g.h / 2;
        drawLoad(ctx, g.kind, g.x + g.w / 2, cy, 0, 0.22);
        // The mass tells similar-looking loads apart (a stone block is 11 t, a steel weight 21 t). It is
        // left out while a banner covers the scene or the hung load's own label passes over it.
        const label = massLabel(g.kind, zh, g.w);
        const spot = labelBox(label, g.x + g.w / 2, cy - 4);
        if (s.mode === 'play' && !(hung && boxesTouch(spot, hung))) {
          ctx.globalAlpha = 0.9;
          text(ctx, label.str, spot.x + 1, cy - 3, PAL.panel, label.size, 'center');
          text(ctx, label.str, spot.x, cy - 4, MATS[k.mat].light, label.size, 'center');
        }
      }
      ctx.globalAlpha = 1;
    }
    dashedRect(ctx, g.x, g.y, g.w, g.h, met ? PAL.good : PAL.gold);
  });
}

function drawArrow(ctx, x, y, dir, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) ctx.fillRect(x + dir * i * 2, y - (4 - i), 2, (4 - i) * 2 + 1);
  ctx.fillRect(x - dir * 10, y - 1, 10, 3);
}

function drawGuide(ctx, s, t) {
  if (!s.hook || s.menu || s.mode !== 'play') return;
  const h = hookOf(s);
  const k = KINDS[s.hook.kind];
  const blink = Math.floor(t * 3) % 2;
  if (landingShown(s)) {
    const land = predictLanding(s.world, h, s.hook.kind);
    ctx.fillStyle = PAL.guide;
    for (let y = h.y + k.h + 2; y < land.y - k.h / 2; y += 6)
      ctx.fillRect(Math.round(h.x), Math.round(y), 1, 2);
    dashedRect(ctx, land.x - k.w / 2, land.y - k.h / 2, k.w, k.h, PAL.guide);
  }
  if (s.marker !== null) {
    const target = predictLanding(s.world, { x: s.marker, y: h.y, vx: 0, vy: 0 }, s.hook.kind);
    drawLoad(ctx, s.hook.kind, s.marker, target.y, 0, 0.35);
    dashedRect(ctx, s.marker - k.w / 2 - 1, target.y - k.h / 2 - 1, k.w + 2, k.h + 2, PAL.good);
    box(ctx, s.marker - 1, s.rail - 4, 3, 9, PAL.good);
    box(ctx, s.marker - 4, s.rail - 8 + blink, 9, 3, PAL.good);
    const dir = s.line?.dir || 0;
    if (dir) drawArrow(ctx, s.crane.x + dir * 22, s.rail + 22, dir, blink ? PAL.good : PAL.ink);
  }
}

function drawCrane(ctx, s, zh) {
  const sea = seaOffset(s.def, s.clock);
  const y = Math.round(s.rail);
  for (const x of [6, W - 14]) {
    box(ctx, x + Math.round(sea * 0.3), y - 4, 8, R.quayTop - y + 8, PAL.steelDark);
    for (let j = y; j < R.quayTop; j += 12)
      box(ctx, x + 2 + Math.round(sea * 0.3), j, 4, 1, PAL.steelRail);
  }
  box(ctx, 4 + sea * 0.3, y - 4, W - 8, 7, PAL.steelRail);
  box(ctx, 4 + sea * 0.3, y + 2, W - 8, 2, PAL.steelDark);
  const h = hookOf(s);
  box(ctx, h.px - 8, y - 7, 16, 12, '#c0392b');
  box(ctx, h.px - 8, y - 7, 16, 2, '#e8685b');
  box(ctx, h.px - 6, y + 5, 12, 2, PAL.steelDark);
  ctx.strokeStyle = PAL.rope;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(h.px, y + 5);
  ctx.lineTo(h.x, h.y);
  ctx.stroke();
  box(ctx, h.x - 2, h.y - 1, 5, 4, '#333b4a');
  if (s.hook) {
    const k = KINDS[s.hook.kind];
    const top = h.y + R.hang;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y + 2);
    ctx.lineTo(h.x - k.w / 2 + 2, top + 1);
    ctx.moveTo(h.x, h.y + 2);
    ctx.lineTo(h.x + k.w / 2 - 2, top + 1);
    ctx.stroke();
    drawLoad(ctx, s.hook.kind, h.x, top + k.h / 2, 0);
    const tag = hookLabel(s, zh);
    if (tag) text(ctx, tag.label.str, tag.x, h.y - 14, PAL.ink, tag.label.size, 'center');
  } else if (s.reel > 0) {
    const f = clamp(1 - s.reel / R.reelTime, 0, 1);
    ctx.globalAlpha = 0.5 * f;
    box(ctx, h.x - 6, h.y + 6, 12, 6, PAL.dim);
    ctx.globalAlpha = 1;
  }
}

// A try left is a solid square; a try used up is a hollow square with a cross, so colour is not needed.
function drawTry(ctx, x, left) {
  if (left) {
    box(ctx, x, 6, 10, 10, PAL.bad);
    box(ctx, x, 6, 10, 2, '#ff9d92');
    return;
  }
  const dim = '#8a5560';
  box(ctx, x, 6, 10, 1, dim);
  box(ctx, x, 15, 10, 1, dim);
  box(ctx, x, 6, 1, 10, dim);
  box(ctx, x + 9, 6, 1, 10, dim);
  for (let k = 2; k < 8; k++) {
    box(ctx, x + k, 6 + k, 1, 1, dim);
    box(ctx, x + 9 - k, 6 + k, 1, 1, dim);
  }
}

function drawHud(ctx, s, env) {
  box(ctx, 0, 0, W, 22, PAL.panel);
  box(ctx, 0, 22, W, 1, PAL.panelEdge);
  const name = s.def.name[env.lang === 'zh' ? 1 : 0];
  text(ctx, `${env.t('Job', '任务')} ${s.level + 1}/${LEVEL_COUNT}  ${name}`, 6, 5, PAL.ink, 11);
  const left = Math.max(0, s.queue.length + (s.hook ? 1 : 0) + (s.next ? 1 : 0));
  const swaps = s.def.swaps ? `  ${env.t('Swaps', '换件')} ${Math.max(0, s.swapsLeft)}` : '';
  text(ctx, `${env.t('Loads', '吊载')} ${left}${swaps}`, 380, 5, PAL.gold, 11, 'right');
  for (let i = 0; i < R.tries; i++) drawTry(ctx, 392 + i * 14, i < s.tries);
  const met = s.fills.filter((f, i) => f >= s.def.goals[i].need).length;
  text(
    ctx,
    `${met}/${s.def.goals.length}`,
    474,
    5,
    met === s.fills.length ? PAL.good : PAL.dim,
    11,
    'right',
  );
}

function drawQueue(ctx, s) {
  box(ctx, 0, 24, 118, 20, 'rgba(10,18,32,0.55)');
  s.queue.slice(0, 4).forEach((kind, i) => {
    const k = KINDS[kind];
    const sc = Math.min(1, 22 / k.w, 16 / k.h);
    ctx.save();
    ctx.translate(16 + i * 28, 34);
    ctx.scale(sc, sc);
    drawLoad(ctx, kind, 0, 0, 0);
    ctx.restore();
  });
  text(ctx, '>', 4, 28, PAL.dim, 9);
}

function drawBanner(ctx, s, env) {
  const lang = env.lang === 'zh' ? 1 : 0;
  if (s.mode === 'play' && s.intro > 0) {
    const a = clamp(s.intro / 0.6, 0, 1);
    ctx.globalAlpha = a;
    box(ctx, 40, 50, 400, 40, 'rgba(10,18,32,0.82)');
    text(ctx, s.def.name[lang], 240, 54, PAL.gold, 14, 'center');
    text(ctx, s.def.tip[lang], 240, 72, PAL.ink, 10, 'center');
    ctx.globalAlpha = 1;
  }
  if (s.mode === 'cleared' || s.mode === 'failed') {
    const good = s.mode === 'cleared';
    box(ctx, 60, 110, 360, 70, 'rgba(10,18,32,0.88)');
    dashedRect(ctx, 60, 110, 360, 70, good ? PAL.good : PAL.bad);
    text(
      ctx,
      good
        ? env.t('Job complete!', '任务完成！')
        : s.failWhy === 'collapse'
          ? env.t('The tower fell', '塔倒了')
          : s.failWhy === 'waste'
            ? env.t('Not enough material left', '吊载不够了')
            : env.t('Out of loads', '吊载用完了'),
      240,
      120,
      good ? PAL.good : PAL.bad,
      18,
      'center',
    );
    const sub = good
      ? `${env.t('Score', '得分')} ${s.score}`
      : `${env.t('Tries left', '剩余机会')} ${Math.max(0, s.tries)}`;
    text(ctx, sub, 240, 148, PAL.ink, 12, 'center');
    text(ctx, env.t('Press Space to continue', '按空格继续'), 240, 164, PAL.dim, 10, 'center');
  }
  if (s.msg && s.mode === 'play') {
    // Messages sit under the HUD, clear of the job title and tip that open each job.
    const line = s.msg[env.lang === 'zh' ? 'zh' : 'en'];
    const half = Math.ceil(textWidth(line, 10) / 2) + 8;
    box(ctx, 240 - half, 26, half * 2, 14, 'rgba(10,18,32,0.78)');
    text(ctx, line, 240, 28, PAL.gold, 10, 'center');
  }
}

function drawPrompt(ctx, s, env) {
  box(ctx, 0, 296, W, 24, PAL.panel);
  box(ctx, 0, 296, W, 1, PAL.panelEdge);
  const line = s.line;
  if (!line) return;
  const zh = env.lang === 'zh';
  text(ctx, zh ? line.zh : line.en, 240, 302, PAL.ink, zh ? 13 : 12, 'center');
  if (s.holdT > 0 && s.mode === 'play') {
    const f = clamp(s.holdT / R.holdTime, 0, 1);
    box(ctx, 140, 314, 200, 3, '#26324f');
    box(ctx, 140, 314, 200 * f, 3, PAL.good);
  }
}

export const MENU_ROWS = Math.ceil(22 / 6);
function drawMenu(ctx, s, env) {
  background(ctx, '#101b2d');
  text(ctx, env.t('Choose a job', '选择任务'), 240, 20, PAL.gold, 18, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const x = MENU.x0 + (i % R.menuCols) * MENU.cw;
    const y = MENU.y0 + Math.floor(i / R.menuCols) * MENU.ch;
    const open = i + 1 <= unlocked;
    box(ctx, x, y, MENU.cw - 6, MENU.ch - 6, open ? '#24385c' : '#161f33');
    if (i + 1 === sel) dashedRect(ctx, x - 2, y - 2, MENU.cw - 2, MENU.ch - 2, PAL.gold);
    text(
      ctx,
      String(i + 1),
      x + (MENU.cw - 6) / 2,
      y + 4,
      open ? PAL.ink : '#3b4766',
      14,
      'center',
    );
    const name = LEVELS[i].name[env.lang === 'zh' ? 1 : 0];
    text(
      ctx,
      open ? name : '?',
      x + (MENU.cw - 6) / 2,
      y + 20,
      open ? PAL.dim : '#3b4766',
      8,
      'center',
    );
  }
  text(ctx, env.t(...WORDS.menu), 240, 296, '#cfd6ea', 12, 'center');
}

function drawGame(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  const shake = s.time - s.lastImpact < 0.15 ? Math.round(Math.sin(s.time * 90) * 1.5) : 0;
  ctx.save();
  ctx.translate(0, shake);
  drawSky(ctx, s.time);
  drawSea(ctx, s.time, seaOffset(s.def, s.clock));
  drawQuay(ctx);
  drawGoals(ctx, s, env.lang === 'zh');
  for (const b of s.world.bodies) {
    if (b.fixed) {
      if (b.tag === 'pier') drawPier(ctx, b);
    } else drawLoad(ctx, b.tag, b.x, b.y, b.a);
  }
  drawGuide(ctx, s, s.time);
  drawCrane(ctx, s, env.lang === 'zh');
  for (const p of s.splashes) {
    const r = 3 + p.t * 18;
    ctx.globalAlpha = 1 - p.t;
    dashedRect(ctx, p.x - r, R.quayTop + 3 - r / 3, r * 2, r / 1.5, PAL.seaFoam);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  drawHud(ctx, s, env);
  drawQueue(ctx, s);
  drawBanner(ctx, s, env);
  drawPrompt(ctx, s, env);
}
