import { clamp, drawPixelText as text, background } from '../shared/utils.js';

export const meta = {
  id: 'river-hop',
  name: { en: 'River Hop', zh: '青蛙过河' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Bring four frogs home in each of three crossings. Tap a direction for one hop; hold for repeated hops and release to wait. Both feet need a deck at landing. Cars are taller than your hop. Striped turtles warn before diving; the cable ferry reverses. Reach each home within 45 seconds. Filled pads are safe to leave. Release directions after a rescue or loss.',
    zh: '在三处渡口各护送四只青蛙回家。轻点方向跳一次，按住连续跳跃，松开等待。落地时双脚都需要浮台支撑，跳跃无法越过车辆。带条纹的乌龟潜水前会预警，缆绳渡船会往返换向。每只青蛙须在45秒内到家。已住满的荷叶可以安全离开；救援或失误后须松开方向键。',
  },
  keys: [
    {
      label: { en: 'Hop / hold to repeat; release to wait', zh: '跳跃 / 按住连跳；松开等待' },
      keys: 'Arrows / WASD',
    },
    {
      label: {
        en: 'Adjust in the air; a late tap buffers the next hop',
        zh: '空中微调；落地前轻点可预存下一跳',
      },
      keys: 'Arrows / WASD',
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
  ].map(([code, en, zh]) => ({ code, side: 'left', label: { en, zh } })),
};
const WIDTH = 480,
  TOP = 34,
  ROW = 28,
  STEP = 1 / 240,
  EPS = 1e-8;
const GRAVITY = 1250,
  FLIGHT = 0.24,
  JUMP = (GRAVITY * FLIGHT) / 2,
  MIN_X = 11,
  MAX_X = 469;
const center = (row) => TOP + row * ROW + 14;
const STAGES = [
  {
    en: 'Meadow Crossing',
    zh: '草地渡口',
    sky: '#183c42',
    water: '#24586c',
    bank: '#42684d',
    cue: { en: 'WAIT FOR A GAP', zh: '等车道空隙' },
    lesson: {
      en: 'Wait for a gap. Land both feet on a deck.',
      zh: '轻点一次，等待车道空隙；双脚落在木台上。',
    },
  },
  {
    en: 'Turtle Marsh',
    zh: '龟沼渡口',
    sky: '#203b49',
    water: '#325b70',
    bank: '#4f6752',
    cue: { en: '↓ STRIPES: DIVE', zh: '↓ 条纹：即将潜水' },
    lesson: {
      en: '↓ + stripes: dive soon. Wait on grass.',
      zh: '条纹龟背和↓表示即将潜水；可在草地中央带等待。',
    },
  },
  {
    en: 'Cable Ferry Reach',
    zh: '缆绳摆渡口',
    sky: '#393d50',
    water: '#44536c',
    bank: '#61684c',
    cue: { en: 'RIDE, THEN HOP UP', zh: '搭船靠岸再上跳' },
    lesson: {
      en: 'Ride the ferry toward a free pad; then hop up.',
      zh: '最上方渡船会换向；搭船靠近空荷叶后再跳回家。',
    },
  },
];
const ferryX = (t) => 150 + 126 * Math.sin((t * Math.PI) / 5);
const ferryV = (t) => ((126 * Math.PI) / 5) * Math.cos((t * Math.PI) / 5);
export function riverLanes(round) {
  const layouts = [
    [
      [104, 178, 28, 10],
      [116, 188, -31, 64],
      [126, 190, 24, -24],
      [42, 170, -47, 20],
      [62, 206, 57, 82],
      [40, 158, -64, -15],
      [72, 224, 41, 108],
    ],
    [
      [108, 182, 30, 45],
      [120, 190, -28, 24],
      [110, 180, 26, 70],
      [58, 196, -52, 80],
      [44, 172, 64, 8],
      [78, 232, -48, 105],
      [46, 182, 53, 32],
    ],
    [
      [180, 0, 0, 150],
      [122, 194, -30, 56],
      [116, 186, 28, 12],
      [44, 178, -60, 32],
      [76, 230, 53, 110],
      [42, 166, -72, 50],
      [58, 204, 48, 82],
    ],
  ][clamp(round, 1, 3) - 1];
  return [1, 2, 3, 5, 6, 7, 8].map((row, i) => {
    const [w, spacing, speed, offset] = layouts[i],
      water = row < 4,
      kind =
        round === 3 && row === 1
          ? 'ferry'
          : round >= 2 && row === 2
            ? 'turtles'
            : water
              ? 'logs'
              : 'traffic';
    const count = kind === 'ferry' ? 1 : Math.ceil((WIDTH + 2 * w + 48) / spacing),
      span = kind === 'ferry' ? 0 : count * spacing;
    return {
      row,
      water,
      kind,
      speed,
      span,
      cycle: kind === 'turtles' ? 8 : 0,
      objects: Array.from({ length: count }, (_, n) => ({
        id: `${row}:${n}`,
        x: kind === 'ferry' ? ferryX(0) : n * spacing + offset - w,
        w,
      })),
    };
  });
}
const freshFrog = () => ({
  x: 240,
  y: center(9),
  row: 9,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  mass: 1,
  grounded: true,
  hop: null,
  pose: 'idle',
  support: null,
});
export function createRiverState() {
  return {
    phase: 'playing',
    score: 0,
    round: 1,
    lives: 4,
    frog: freshFrog(),
    lanes: riverLanes(1),
    homes: [],
    rescued: 0,
    time: 0,
    totalTime: 0,
    timeLeft: 45,
    spawnDelay: 0,
    transition: 0,
    pendingHop: null,
    repeatClock: 0,
    rest: 0,
    needsRelease: false,
    lastHeld: null,
    minRow: 9,
    lastCause: '',
    feedback: null,
    ripples: [],
    lastImpulse: null,
  };
}
function directions(input, method) {
  const dx =
      Number(input[method]('ArrowRight', 'KeyD')) - Number(input[method]('ArrowLeft', 'KeyA')),
    dy = Number(input[method]('ArrowDown', 'KeyS')) - Number(input[method]('ArrowUp', 'KeyW'));
  return dx && dy ? null : dx || dy ? { dx, dy, key: `${dx}:${dy}` } : null;
}
const anyDirection = (input) =>
  input.held('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD');
function turtleState(lane, time) {
  if (lane.kind !== 'turtles') return 'up';
  const phase = ((time % lane.cycle) + lane.cycle) % lane.cycle;
  return phase + EPS >= 6.6 ? 'down' : phase + EPS >= 5.4 ? 'warning' : 'up';
}
function laneVelocity(lane, time) {
  return lane.kind === 'ferry' ? ferryV(time) : lane.speed;
}
function deck(lane, o) {
  return { x: o.x, y: TOP + lane.row * ROW + 4, w: o.w, h: 20 };
}
export function riverFeet(frog) {
  return [
    { x: frog.x - 11, y: frog.y + 4, w: 6, h: 4 },
    { x: frog.x + 5, y: frog.y + 4, w: 6, h: 4 },
  ];
}
function frogRects(f) {
  const airborne = !f.grounded && f.hop && f.hop.age > 0.045 && f.hop.age < 0.195;
  return [
    { x: f.x - 7, y: f.y - 6, w: 14, h: 12 },
    { x: f.x - 7, y: f.y - 9, w: 4, h: 4 },
    { x: f.x + 3, y: f.y - 9, w: 4, h: 4 },
    ...(airborne
      ? [
          { x: f.x - 9, y: f.y + 1, w: 4, h: 4 },
          { x: f.x + 5, y: f.y + 1, w: 4, h: 4 },
        ]
      : riverFeet(f)),
  ];
}
function homeRect(n) {
  return { x: n * 120 + 18, y: TOP + 1, w: 84, h: 27 };
}
function containingInterval(rects, foot) {
  const spans = rects
    .filter((r) => foot.y >= r.y - EPS && foot.y + foot.h <= r.y + r.h + EPS)
    .map((r) => [r.x, r.x + r.w])
    .sort((a, b) => a[0] - b[0]);
  let lo = null,
    hi = null;
  for (const [left, right] of spans) {
    if (lo === null || left > hi + EPS) {
      lo = left;
      hi = right;
    } else hi = Math.max(hi, right);
    if (foot.x >= lo - EPS && foot.x + foot.w <= hi + EPS) return { lo, hi };
  }
  return null;
}
/** Current-driven decks and the cable motor supply the work of carrying a passenger. */
export function riverSupport(s, f = s.frog) {
  const feet = riverFeet(f),
    grounds = [
      { x: 0, y: TOP + 4 * ROW, w: 480, h: 28 },
      { x: 0, y: TOP + 5 * ROW, w: 480, h: 5 * ROW },
    ];
  if (feet.every((foot) => containingInterval(grounds, foot)))
    return { kind: 'ground', vx: 0, rects: grounds };
  for (let n = 0; n < 4; n++)
    if (feet.every((foot) => containingInterval([homeRect(n)], foot)))
      return { kind: 'home', home: n, vx: 0, rects: [homeRect(n)] };
  for (const lane of s.lanes) {
    if (!lane.water || turtleState(lane, s.time) === 'down') continue;
    const rects = lane.objects.map((o) => deck(lane, o));
    if (feet.every((foot) => containingInterval(rects, foot)))
      return { kind: lane.kind, row: lane.row, vx: laneVelocity(lane, s.time), rects };
  }
  return null;
}
function overlapRect(a, b) {
  return (
    a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS
  );
}
const motion = (p, v, a, t) => p + v * t + 0.5 * a * t * t;
function roots(p, v, a, target, dt) {
  const c = p - target;
  if (Math.abs(a) < EPS) {
    if (Math.abs(v) < EPS) return [];
    const t = -c / v;
    return t >= -EPS && t <= dt + EPS ? [clamp(t, 0, dt)] : [];
  }
  const discriminant = v * v - 2 * a * c;
  if (discriminant < -EPS) return [];
  const r = Math.sqrt(Math.max(0, discriminant));
  return [(-v - r) / a, (-v + r) / a]
    .filter((t) => t >= -EPS && t <= dt + EPS)
    .map((t) => clamp(t, 0, dt));
}
function range(p, v, a, dt) {
  const values = [p, motion(p, v, a, dt)],
    turn = Math.abs(a) > EPS ? -v / a : -1;
  if (turn > 0 && turn < dt) values.push(motion(p, v, a, turn));
  return [Math.min(...values), Math.max(...values)];
}
function entering(pos, size, lo, hi, v, a) {
  if (pos + size <= lo + EPS) return v > EPS || (Math.abs(v) <= EPS && a > EPS);
  if (pos >= hi - EPS) return v < -EPS || (Math.abs(v) <= EPS && a < -EPS);
  return true;
}
function sweepRect(a, b, vx, vy, ax, ay, dt) {
  if (overlapRect(a, b)) return 0;
  const times = [
    0,
    dt,
    ...roots(a.x, vx, ax, b.x - a.w, dt),
    ...roots(a.x, vx, ax, b.x + b.w, dt),
    ...roots(a.y, vy, ay, b.y - a.h, dt),
    ...roots(a.y, vy, ay, b.y + b.h, dt),
  ].sort((a, b) => a - b);
  for (const t of times) {
    const x = motion(a.x, vx, ax, t),
      y = motion(a.y, vy, ay, t);
    if (x + a.w < b.x - EPS || x > b.x + b.w + EPS || y + a.h < b.y - EPS || y > b.y + b.h + EPS)
      continue;
    if (
      entering(x, a.w, b.x, b.x + b.w, vx + ax * t, ax) &&
      entering(y, a.h, b.y, b.y + b.h, vy + ay * t, ay)
    )
      return t;
  }
  return null;
}
function wallTime(p, v, a, lo, hi, dt) {
  let hit = null;
  for (const [bound, sign] of [
    [lo, -1],
    [hi, 1],
  ])
    for (const t of roots(p, v, a, bound, dt)) {
      if ((v + a * t) * sign <= EPS) continue;
      if (hit === null || t < hit) hit = t;
    }
  return hit;
}
function carRects(lane, o) {
  const y = TOP + lane.row * ROW;
  return [
    { x: o.x, y: y + 5, w: o.w, h: 18 },
    { x: o.x + 5, y: y + 3, w: 8, h: 3 },
    { x: o.x + o.w - 13, y: y + 3, w: 8, h: 3 },
    { x: o.x + 5, y: y + 22, w: 8, h: 3 },
    { x: o.x + o.w - 13, y: y + 22, w: 8, h: 3 },
  ];
}
function trafficTime(s, vx, vy, ax, ay, dt) {
  let hit = null;
  const f = s.frog,
    rx = range(f.x, vx, ax, dt),
    ry = range(f.y, vy, ay, dt);
  for (const lane of s.lanes)
    if (!lane.water) {
      const y = TOP + lane.row * ROW;
      if (ry[1] + 8 < y + 3 - EPS || ry[0] - 9 > y + 25 + EPS) continue;
      for (const o of lane.objects) {
        const ox = Math.min(o.x, o.x + lane.speed * dt),
          ow = o.w + Math.abs(lane.speed * dt);
        if (rx[1] + 11 < ox - EPS || rx[0] - 11 > ox + ow + EPS) continue;
        for (const a of frogRects(f))
          for (const b of carRects(lane, o)) {
            const time = sweepRect(a, b, vx - lane.speed, vy, ax, ay, dt);
            if (time !== null && (hit === null || time < hit)) hit = time;
          }
      }
    }
  return hit;
}
function note(s, type, x = s.frog.x, y = s.frog.y) {
  s.feedback = { type, x, y, life: 0.65 };
  if (['land', 'water', 'home'].includes(type)) {
    s.ripples.push({ x, y, life: 0.55, type });
    if (s.ripples.length > 12) s.ripples.shift();
  }
}
function resetFrog(s) {
  s.frog = freshFrog();
  s.timeLeft = 45;
  s.minRow = 9;
  s.pendingHop = null;
  s.repeatClock = 0;
  s.rest = 0.08;
  s.needsRelease = true;
  s.lastHeld = null;
}
function hurt(s, cause) {
  if (s.spawnDelay > 0 || s.transition > 0 || s.phase !== 'playing') return;
  s.lives--;
  s.lastCause = cause;
  note(s, cause);
  s.pendingHop = null;
  s.needsRelease = true;
  s.lastHeld = null;
  s.frog.hop = null;
  s.frog.pose = 'lost';
  if (s.lives <= 0) s.phase = 'lost';
  else s.spawnDelay = 0.65;
}
function rescue(s, home) {
  if (s.homes.includes(home)) {
    note(s, 'occupied');
    return;
  }
  s.homes.push(home);
  s.rescued++;
  s.score += 250 + Math.max(0, Math.floor(s.timeLeft + EPS)) * 5;
  note(s, 'home');
  s.pendingHop = null;
  s.needsRelease = true;
  s.lastHeld = null;
  if (s.homes.length === 4) {
    if (s.round === 3) {
      s.phase = 'won';
      return;
    }
    s.score += 500;
    s.transition = 0.95;
    s.spawnDelay = 0;
    s.frog.pose = 'rescued';
  } else {
    s.spawnDelay = 0.55;
    s.frog.pose = 'rescued';
  }
}
// Logical pixels, seconds and unit frog mass. The driven deck/ground receives the reaction.
function recordImpulse(s, source, before, after) {
  const mass = s.frog.mass,
    x = mass * (after.vx - before.vx),
    y = mass * (after.vy - before.vy),
    z = mass * (after.vz - before.vz),
    energy = (v) => 0.5 * mass * (v.vx * v.vx + v.vy * v.vy + v.vz * v.vz);
  s.lastImpulse = {
    source,
    x,
    y,
    z,
    reaction: { x: -x, y: -y, z: -z },
    work: energy(after) - energy(before),
  };
}
function launch(s, command, support) {
  const f = s.frog;
  if (
    (command.dx < 0 && f.x <= MIN_X + EPS) ||
    (command.dx > 0 && f.x >= MAX_X - EPS) ||
    (command.dy < 0 && f.y <= center(0) + EPS) ||
    (command.dy > 0 && f.y >= center(9) - EPS)
  ) {
    s.pendingHop = null;
    s.rest = 0.06;
    note(s, 'edge');
    return;
  }
  const before = { vx: f.vx, vy: f.vy, vz: f.vz };
  f.vx = support.vx + (command.dx * 24) / FLIGHT;
  f.vy = (command.dy * ROW) / FLIGHT;
  f.vz = JUMP;
  f.grounded = false;
  f.hop = { dx: command.dx, dy: command.dy, age: 0 };
  f.support = null;
  f.pose = 'takeoff';
  recordImpulse(s, 'legs', before, f);
  s.pendingHop = null;
  s.repeatClock = 0.32;
  note(s, 'hop');
}
function surfaceLoss(s, support, vx, dt) {
  if (support.kind === 'ground' || support.kind === 'home' || support.kind === 'ferry') return null;
  const relative = vx - support.vx;
  if (Math.abs(relative) < EPS) return null;
  let loss = null;
  for (const foot of riverFeet(s.frog)) {
    const span = containingInterval(support.rects, foot);
    if (!span) return 0;
    const time =
      relative > 0 ? (span.hi - foot.x - foot.w) / relative : (span.lo - foot.x) / relative;
    if (time >= -EPS && time <= dt + EPS && (loss === null || time < loss))
      loss = Math.max(0, time);
  }
  return loss;
}
function nextDive(s, dt) {
  let next = null;
  for (const l of s.lanes)
    if (l.kind === 'turtles') {
      const phase = ((s.time % l.cycle) + l.cycle) % l.cycle;
      for (const bound of [5.4, 6.6, 8]) {
        const t = bound - phase;
        if (t > EPS && t <= dt + EPS && (next === null || t < next)) next = t;
      }
    }
  return next;
}
function nextWrap(s, dt) {
  let next = null;
  for (const lane of s.lanes)
    if (lane.span && Math.abs(lane.speed) > EPS)
      for (const o of lane.objects) {
        const lo = -o.w - 24,
          hi = lo + lane.span,
          t = ((lane.speed > 0 ? hi : lo) - o.x) / lane.speed;
        if (t >= -EPS && t <= dt + EPS && (next === null || t < next)) next = Math.max(0, t);
      }
  return next;
}
function advance(s, h, vx = 0, vy = 0, air = false, ax = 0, ay = 0, ferryCarry = false) {
  const end = s.time + h;
  for (const lane of s.lanes)
    for (const o of lane.objects) {
      if (lane.kind === 'ferry') o.x = ferryX(end);
      else o.x += lane.speed * h;
      if (lane.span) {
        const lo = -o.w - 24,
          hi = lo + lane.span;
        if (o.x < lo - EPS || o.x > hi + EPS)
          o.x = lo + ((((o.x - lo) % lane.span) + lane.span) % lane.span);
        if (lane.speed > 0 && o.x >= hi - EPS) o.x -= lane.span;
        else if (lane.speed < 0 && o.x <= lo + EPS) o.x += lane.span;
      }
    }
  if (s.spawnDelay === 0 && s.transition === 0) {
    const f = s.frog;
    f.x += ferryCarry ? ferryX(end) - ferryX(s.time) : motion(0, vx, ax, h);
    if (ferryCarry) {
      const before = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.vx = ferryV(end);
      if (Math.abs(f.vx - before.vx) > EPS) recordImpulse(s, 'drive', before, f);
    }
    f.y += motion(0, vy, ay, h);
    if (air) {
      f.z += f.vz * h - 0.5 * GRAVITY * h * h;
      f.vz -= GRAVITY * h;
      f.vx += ax * h;
      f.vy += ay * h;
      f.hop.age += h;
      f.pose = f.vz > 0 ? 'air' : 'landing';
    }
    f.row = clamp(Math.round((f.y - center(0)) / ROW), 0, 9);
    s.timeLeft -= h;
  }
  s.time = end;
  s.totalTime += h;
  s.repeatClock = Math.max(0, s.repeatClock - h);
  s.rest = Math.max(0, s.rest - h);
  if (s.feedback && (s.feedback.life -= h) <= 0) s.feedback = null;
  s.ripples = s.ripples.filter((r) => (r.life -= h) > 0);
}
function tick(s, h, held) {
  let remaining = h;
  while (remaining > EPS && s.phase === 'playing') {
    if (s.transition > 0) {
      const t = Math.min(remaining, s.transition);
      advance(s, t);
      s.transition = Math.max(0, s.transition - t);
      remaining -= t;
      if (s.transition <= EPS) {
        s.transition = 0;
        s.round++;
        s.homes = [];
        s.lanes = riverLanes(s.round);
        s.time = 0;
        s.lives = Math.min(4, s.lives + 1);
        resetFrog(s);
      }
      continue;
    }
    if (s.spawnDelay > 0) {
      const t = Math.min(remaining, s.spawnDelay);
      advance(s, t);
      s.spawnDelay = Math.max(0, s.spawnDelay - t);
      remaining -= t;
      if (s.spawnDelay <= EPS) {
        s.spawnDelay = 0;
        resetFrog(s);
      }
      continue;
    }
    const f = s.frog;
    let support = null;
    if (f.grounded) {
      support = riverSupport(s);
      if (!support) {
        hurt(s, 'water');
        continue;
      }
      f.support = { kind: support.kind, row: support.row ?? f.row };
      const beforeGrip = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.vx = support.vx;
      f.vy = 0;
      f.vz = 0;
      f.z = 0;
      if (Math.hypot(f.vx - beforeGrip.vx, f.vy - beforeGrip.vy, f.vz - beforeGrip.vz) > EPS)
        recordImpulse(s, 'grip', beforeGrip, f);
      if (support.kind === 'home' && !s.homes.includes(support.home)) {
        rescue(s, support.home);
        continue;
      }
      if (s.pendingHop && s.pendingHop.expires < s.totalTime - EPS) s.pendingHop = null;
      const command =
        !s.needsRelease && s.rest <= EPS
          ? (s.pendingHop ?? (held && s.repeatClock <= EPS ? held : null))
          : null;
      if (command) {
        launch(s, command, support);
        if (!f.grounded) support = null;
      }
    }
    const air = !f.grounded;
    let ax = 0,
      ay = 0;
    if (air && held) {
      if (held.dx !== f.hop.dx) ax = held.dx * 90;
      if (held.dy !== f.hop.dy) ay = held.dy * 90;
    }
    let vx = f.vx,
      vy = f.vy;
    if (support?.kind === 'ferry') vx = (ferryX(s.time + remaining) - ferryX(s.time)) / remaining;
    if (
      (f.x <= MIN_X + EPS && (vx < 0 || (Math.abs(vx) < EPS && ax < 0))) ||
      (f.x >= MAX_X - EPS && (vx > 0 || (Math.abs(vx) < EPS && ax > 0)))
    ) {
      vx = 0;
      f.vx = 0;
      ax = 0;
    }
    if (
      (f.y <= center(0) + EPS && (vy < 0 || (Math.abs(vy) < EPS && ay < 0))) ||
      (f.y >= center(9) - EPS && (vy > 0 || (Math.abs(vy) < EPS && ay > 0)))
    ) {
      vy = 0;
      f.vy = 0;
      ay = 0;
    }
    const landing = air
        ? (f.vz + Math.sqrt(Math.max(0, f.vz * f.vz + 2 * GRAVITY * f.z))) / GRAVITY
        : null,
      traffic = trafficTime(s, vx, vy, ax, ay, remaining),
      loss = support ? surfaceLoss(s, support, vx, remaining) : null,
      dive = nextDive(s, remaining),
      wrap = nextWrap(s, remaining),
      timeout = Math.max(0, s.timeLeft),
      wallX = wallTime(f.x, vx, ax, MIN_X, MAX_X, remaining),
      wallY = wallTime(f.y, vy, ay, center(0), center(9), remaining);
    let t = remaining;
    for (const event of [landing, traffic, loss, dive, wrap, timeout, wallX, wallY])
      if (event !== null && event >= -EPS && event < t) t = Math.max(0, event);
    advance(s, t, vx, vy, air, ax, ay, support?.kind === 'ferry');
    remaining -= t;
    const at = (event) => event !== null && Math.abs(event - t) <= EPS;
    if (at(traffic)) {
      hurt(s, 'traffic');
      continue;
    }
    if (at(wallX)) {
      f.x = clamp(f.x, MIN_X, MAX_X);
      f.vx = 0;
      note(s, 'edge');
    }
    if (at(wallY)) {
      f.y = clamp(f.y, center(0), center(9));
      f.vy = 0;
      note(s, 'edge');
    }
    if (at(loss)) {
      hurt(s, 'water');
      continue;
    }
    if (at(landing)) {
      const landingVelocity = { vx: f.vx, vy: f.vy, vz: f.vz };
      f.z = 0;
      f.vz = 0;
      f.grounded = true;
      f.hop = null;
      support = riverSupport(s);
      if (!support) {
        hurt(s, 'water');
        continue;
      }
      const before = landingVelocity;
      f.vx = support.vx;
      f.vy = 0;
      recordImpulse(s, 'grip', before, f);
      f.pose = 'landed';
      s.rest = 0.055;
      note(s, 'land');
      if (f.row < s.minRow) {
        s.score += (s.minRow - f.row) * 10;
        s.minRow = f.row;
      }
      if (support.kind === 'home') {
        if (!s.homes.includes(support.home)) {
          rescue(s, support.home);
          continue;
        }
        note(s, 'occupied');
      }
    }
    if (at(timeout) && s.phase === 'playing' && s.spawnDelay === 0 && s.transition === 0) {
      hurt(s, 'time');
      continue;
    }
    if (f.grounded && s.spawnDelay === 0 && s.transition === 0 && !riverSupport(s)) {
      hurt(s, 'water');
      continue;
    }
  }
}
export function stepRiver(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  const held = directions(input, 'held'),
    pressed = directions(input, 'pressed');
  if (
    s.needsRelease &&
    !anyDirection(input) &&
    !pressed &&
    s.spawnDelay === 0 &&
    s.transition === 0
  )
    s.needsRelease = false;
  if (!s.needsRelease && s.spawnDelay === 0 && s.transition === 0) {
    const command = pressed ?? (held && held.key !== s.lastHeld ? held : null);
    if (command) s.pendingHop = { ...command, expires: s.totalTime + 0.18 };
  }
  s.lastHeld = held?.key ?? null;
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(STEP, remaining);
    tick(s, h, held);
    remaining -= h;
  }
}

function drawFrog(ctx, f, s) {
  const lift = Math.max(0, f.z),
    shadow = 10 - lift * 0.22;
  ctx.fillStyle = '#142e3b99';
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + 6, shadow, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const r of frogRects(f)) {
    ctx.fillStyle = '#233f39';
    ctx.fillRect(Math.round(r.x), Math.round(r.y - lift), r.w, r.h);
    ctx.fillStyle = f.pose === 'takeoff' ? '#d5e88f' : '#aad779';
    ctx.fillRect(
      Math.round(r.x + 1),
      Math.round(r.y - lift + 1),
      Math.max(1, r.w - 2),
      Math.max(1, r.h - 2),
    );
  }
  ctx.fillStyle = '#d7e89c';
  ctx.fillRect(f.x - 4, f.y - 4 - lift, 8, 7);
  ctx.fillStyle = '#6a9a61';
  ctx.fillRect(f.x - 6, f.y - 1 - lift, 2, 3);
  ctx.fillRect(f.x + 4, f.y - 1 - lift, 2, 3);
  ctx.fillStyle = '#192f35';
  const blink = f.grounded && Math.floor(s.totalTime * 2) % 9 === 8;
  ctx.fillRect(f.x - 6, f.y - 8 - lift, 2, blink ? 1 : 2);
  ctx.fillRect(f.x + 4, f.y - 8 - lift, 2, blink ? 1 : 2);
  ctx.fillRect(f.x - 2, f.y + 2 - lift, 4, 1);
  if (f.pose === 'landed') {
    ctx.fillStyle = '#e2ebaf';
    ctx.fillRect(f.x - 10, f.y + 6, 4, 1);
    ctx.fillRect(f.x + 6, f.y + 6, 4, 1);
  }
}
function drawBank(ctx, y, stage, median = false) {
  ctx.fillStyle = '#2a4f48';
  ctx.fillRect(0, y, 480, 28);
  ctx.fillStyle = stage.bank;
  ctx.fillRect(0, y + 2, 480, 24);
  ctx.fillStyle = '#8b9b6a';
  ctx.fillRect(0, y + 2, 480, 2);
  ctx.fillStyle = '#314e43';
  ctx.fillRect(0, y + 25, 480, 2);
  for (let n = 0; n < 24; n++) {
    const x = (n * 23) % 480,
      py = y + 7 + (n % 3) * 6;
    ctx.fillStyle = n % 3 ? '#6d8156' : '#8d9663';
    ctx.fillRect(x, py, 2, 2);
    ctx.fillRect(x + 3, py - 2, 1, 3);
  }
  for (const x of [3, 12, 463, 474]) {
    ctx.fillStyle = '#304f40';
    ctx.fillRect(x, y + 7, 2, 13);
    ctx.fillRect(x + 4, y + 10, 2, 10);
    ctx.fillStyle = '#a4a06d';
    ctx.fillRect(x, y + 5, 2, 5);
  }
  if (median) {
    ctx.fillStyle = '#b7bb8a';
    ctx.fillRect(23, y + 8, 5, 8);
    ctx.fillRect(453, y + 8, 5, 8);
    ctx.fillStyle = '#314e43';
    ctx.fillRect(24, y + 9, 3, 5);
    ctx.fillRect(454, y + 9, 3, 5);
  }
}
function drawHome(ctx, s, n) {
  const r = homeRect(n),
    occupied = s.homes.includes(n),
    cx = n * 120 + 60;
  // The entire outlined landing dock is solid; the lily and reeds are surface decoration.
  ctx.fillStyle = '#183d40';
  ctx.fillRect(r.x - 2, r.y - 1, r.w + 4, r.h + 1);
  ctx.fillStyle = occupied ? '#718958' : '#6d9965';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#afba7a';
  ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, 2);
  ctx.fillStyle = '#456a4d';
  ctx.fillRect(cx - 18, r.y + 6, 36, 16);
  ctx.fillRect(cx - 12, r.y + 3, 24, 21);
  ctx.fillStyle = '#95b574';
  ctx.fillRect(cx - 15, r.y + 7, 30, 2);
  ctx.fillRect(cx - 2, r.y + 9, 2, 12);
  ctx.fillStyle = '#375d49';
  ctx.fillRect(r.x + 5, r.y + 7, 2, 14);
  ctx.fillRect(r.x + r.w - 7, r.y + 7, 2, 14);
  if (occupied) {
    ctx.fillStyle = '#d9e7a0';
    ctx.fillRect(cx - 6, r.y + 9, 12, 9);
    ctx.fillRect(cx - 7, r.y + 7, 4, 4);
    ctx.fillRect(cx + 3, r.y + 7, 4, 4);
    ctx.fillStyle = '#274d43';
    ctx.fillRect(cx - 6, r.y + 8, 2, 2);
    ctx.fillRect(cx + 4, r.y + 8, 2, 2);
    ctx.fillStyle = '#d9e7a0';
    ctx.fillRect(cx - 9, r.y + 17, 5, 3);
    ctx.fillRect(cx + 4, r.y + 17, 5, 3);
  } else {
    text(ctx, String(n + 1), cx, r.y + 7, '#dce5b0', 12, 'center');
  }
}
function drawLog(ctx, lane, o) {
  const y = TOP + lane.row * ROW;
  ctx.fillStyle = '#483d34';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#7f674a';
  ctx.fillRect(o.x + 1, y + 5, o.w - 2, 17);
  ctx.fillStyle = '#b29361';
  ctx.fillRect(o.x + 2, y + 5, o.w - 4, 3);
  ctx.fillStyle = '#5c4939';
  ctx.fillRect(o.x + 2, y + 20, o.w - 4, 3);
  for (const x of [o.x + 3, o.x + o.w - 12]) {
    ctx.fillStyle = '#bb9a68';
    ctx.fillRect(x, y + 7, 9, 13);
    ctx.fillStyle = '#6b523d';
    ctx.fillRect(x + 2, y + 9, 5, 1);
    ctx.fillRect(x + 2, y + 17, 5, 1);
    ctx.fillRect(x + 1, y + 11, 1, 5);
    ctx.fillRect(x + 7, y + 11, 1, 5);
    ctx.fillStyle = '#e0ba7d';
    ctx.fillRect(x + 4, y + 12, 1, 3);
  }
  for (let x = o.x + 21; x < o.x + o.w - 17; x += 23) {
    ctx.fillStyle = '#544b3b';
    ctx.fillRect(x, y + 11, 9, 1);
    ctx.fillRect(x + 5, y + 15, 12, 1);
    ctx.fillStyle = '#9d7f54';
    ctx.fillRect(x - 3, y + 18, 11, 1);
  }
}
function drawTurtles(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW,
    phase = turtleState(lane, s.time);
  if (phase === 'down') {
    ctx.fillStyle = '#7d9b9c';
    for (let x = o.x + 2; x < o.x + o.w; x += 12) {
      ctx.fillRect(x, y + 8, 6, 1);
      ctx.fillRect(x + 4, y + 21, 6, 1);
    }
    text(ctx, '≈', o.x + o.w / 2, y + 6, '#9bb7b6', 14, 'center');
    return;
  }
  // A rope mat bridges the turtles, so every visible part of this deck can carry a foot.
  ctx.fillStyle = '#46685b';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#a4b27a';
  ctx.fillRect(o.x, y + 4, o.w, 2);
  ctx.fillRect(o.x, y + 22, o.w, 2);
  for (let x = o.x; x < o.x + o.w; x += 24) {
    const w = Math.min(24, o.x + o.w - x);
    ctx.fillStyle = phase === 'warning' ? '#ceb470' : '#7fab77';
    ctx.fillRect(x + 1, y + 6, Math.max(1, w - 2), 15);
    ctx.fillStyle = '#3e6c58';
    ctx.fillRect(x + 4, y + 8, Math.max(1, w - 8), 11);
    ctx.fillStyle = phase === 'warning' ? '#ead69a' : '#a1c48a';
    ctx.fillRect(x + 6, y + 9, Math.max(1, w - 12), 2);
    ctx.fillRect(x + 6, y + 16, Math.max(1, w - 12), 2);
    ctx.fillStyle = '#2b564c';
    ctx.fillRect(x + Math.max(1, w - 6), y + 7, 2, 2);
    if (phase === 'warning') {
      ctx.fillStyle = '#ead69a';
      ctx.fillRect(x + 7, y + 9, 2, 10);
      ctx.fillRect(x + 13, y + 9, 2, 10);
    }
  }
  if (phase === 'warning') text(ctx, '↓', o.x + o.w / 2, y + 5, '#f1e1ab', 14, 'center');
}
function drawFerry(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW;
  ctx.fillStyle = '#463f3a';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#a48a61';
  ctx.fillRect(o.x + 1, y + 5, o.w - 2, 18);
  ctx.fillStyle = '#d0b483';
  ctx.fillRect(o.x + 3, y + 5, o.w - 6, 2);
  ctx.fillRect(o.x + 3, y + 21, o.w - 6, 2);
  for (let x = o.x + 11; x < o.x + o.w - 8; x += 14) {
    ctx.fillStyle = '#77644f';
    ctx.fillRect(x, y + 8, 1, 12);
  }
  ctx.fillStyle = '#ddd0a4';
  ctx.fillRect(o.x + 2, y + 4, 3, 20);
  ctx.fillRect(o.x + o.w - 5, y + 4, 3, 20);
  for (const x of [o.x + 11, o.x + o.w - 23]) {
    ctx.fillStyle = '#374d4e';
    ctx.fillRect(x, y + 8, 12, 12);
    ctx.fillStyle = '#bac2a0';
    const turn = Math.floor(s.time * 8) % 3;
    ctx.fillRect(x + 2 + turn * 2, y + 10, 2, 8);
    ctx.fillRect(x + 2, y + 13, 8, 2);
  }
  text(ctx, ferryV(s.time) > 0 ? '→' : '←', o.x + o.w / 2, y + 6, '#f0e1b0', 14, 'center');
}
function drawCar(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW,
    forward = lane.speed > 0,
    pal = ['#dea264', '#78a3b6', '#b78385', '#a8ad72'][lane.row - 5];
  for (const r of carRects(lane, o)) {
    ctx.fillStyle = '#172b36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.fillStyle = '#91a4a8';
  for (const x of [o.x + 6, o.x + o.w - 12]) {
    ctx.fillRect(x, y + 3, 5, 1);
    ctx.fillRect(x, y + 24, 5, 1);
  }
  ctx.fillStyle = pal;
  ctx.fillRect(o.x + 1, y + 6, o.w - 2, 16);
  ctx.fillStyle = '#e4c7a2';
  ctx.fillRect(o.x + 3, y + 6, o.w - 6, 1);
  const cab = forward ? o.x + o.w - 22 : o.x + 5;
  ctx.fillStyle = '#3c586b';
  ctx.fillRect(cab, y + 8, 17, 12);
  ctx.fillStyle = '#bad5d1';
  ctx.fillRect(cab + 2, y + 9, 13, 4);
  ctx.fillRect(cab + 2, y + 15, 13, 4);
  ctx.fillStyle = pal;
  ctx.fillRect(cab + 7, y + 8, 3, 12);
  if (o.w > 65) {
    for (let x = o.x + 9; x < o.x + o.w - 8; x += 11)
      if (x < cab - 1 || x > cab + 16) {
        ctx.fillStyle = '#3c586b';
        ctx.fillRect(x, y + 9, 7, 10);
        ctx.fillStyle = '#9db9bb';
        ctx.fillRect(x + 1, y + 10, 5, 3);
      }
    ctx.fillStyle = '#899281';
    ctx.fillRect(o.x + o.w / 2 - 7, y + 12, 14, 4);
  } else if (o.w > 48) {
    const bx = forward ? o.x + 5 : o.x + 27;
    ctx.fillStyle = '#556760';
    ctx.fillRect(bx, y + 9, o.w - 33, 10);
    ctx.fillStyle = '#a8a176';
    ctx.fillRect(bx + 2, y + 11, Math.max(2, o.w - 38), 2);
    ctx.fillRect(bx + 2, y + 15, Math.max(2, o.w - 38), 2);
  }
  ctx.fillStyle = '#f0ddb0';
  const front = forward ? o.x + o.w - 2 : o.x + 1;
  ctx.fillRect(front, y + 7, 1, 3);
  ctx.fillRect(front, y + 18, 1, 3);
  ctx.fillStyle = '#bc7768';
  const back = forward ? o.x + 1 : o.x + o.w - 2;
  ctx.fillRect(back, y + 8, 1, 2);
  ctx.fillRect(back, y + 18, 1, 2);
}
function riverPrompt(s) {
  if (s.transition > 0)
    return {
      en: 'Four frogs safe. Preparing the next crossing.',
      zh: '四只青蛙已到家，正在准备下一渡口。',
    };
  if (s.spawnDelay > 0 || s.needsRelease)
    return {
      en: 'Release direction keys to ready the next frog.',
      zh: '请松开方向键，准备下一只青蛙。',
    };
  if (s.feedback?.type === 'edge')
    return {
      en: 'At the edge: hop inward. Other directions remain available.',
      zh: '已到边界：请向内跳跃，其他方向仍然可用。',
    };
  if (s.feedback?.type === 'occupied')
    return {
      en: 'Filled pad: wait for a deck below, hop Down, then choose a free home.',
      zh: '荷叶已住满：等待下方浮台，向下跳回河面，再选择空家园。',
    };
  return STAGES[s.round - 1].lesson;
}
function riverCue(s) {
  if (s.transition > 0) return { en: 'FOUR SAFE', zh: '四只青蛙已到家' };
  if (s.spawnDelay > 0) {
    if (s.frog.pose === 'rescued') return { en: 'HOME! RELEASE KEYS', zh: '到家了！请松开方向键' };
    return s.lastCause === 'water'
      ? { en: 'SPLASH · RELEASE', zh: '落水 · 请松开方向键' }
      : s.lastCause === 'traffic'
        ? { en: 'TRAFFIC · RELEASE', zh: '撞车 · 请松开方向键' }
        : { en: 'TIME UP · RELEASE', zh: '超时 · 请松开方向键' };
  }
  if (s.needsRelease) return { en: 'RELEASE DIRECTIONS', zh: '请松开方向键' };
  if (s.feedback?.type === 'edge') return { en: 'EDGE · HOP INWARD', zh: '边界 · 向内跳跃' };
  if (s.feedback?.type === 'occupied')
    return { en: 'FILLED · SAFE TO LEAVE', zh: '已住满 · 可安全离开' };
  return STAGES[s.round - 1].cue;
}
function drawRiver(ctx, s, env) {
  const stage = STAGES[s.round - 1];
  background(ctx, stage.sky);
  ctx.fillStyle = stage.water;
  ctx.fillRect(0, TOP, 480, ROW);
  drawBank(ctx, TOP + 4 * ROW, stage, true);
  drawBank(ctx, TOP + 9 * ROW, stage);
  for (let n = 0; n < 4; n++) drawHome(ctx, s, n);
  for (const lane of s.lanes) {
    const y = TOP + lane.row * ROW;
    ctx.fillStyle = lane.water ? stage.water : '#30394a';
    ctx.fillRect(0, y, 480, 28);
    if (lane.water) {
      ctx.fillStyle = '#6f919744';
      for (let n = 0; n < 16; n++) {
        const x = ((n * 37 + s.time * laneVelocity(lane, s.time) * 0.24 + 960) % 540) - 30;
        ctx.fillRect(x, y + 8 + (n % 3) * 6, 11, 1);
      }
      ctx.fillStyle = '#7e999277';
      for (let n = 0; n < 5; n++) {
        const x = n * 105 + 16;
        ctx.fillRect(x, y + 1, 6, 1);
        ctx.fillRect(x + (laneVelocity(lane, s.time) > 0 ? 5 : 0), y, 1, 3);
      }
    } else {
      ctx.fillStyle = '#202f3b';
      ctx.fillRect(0, y, 480, 2);
      ctx.fillStyle = '#7d8583';
      for (let x = 8; x < 480; x += 44) ctx.fillRect(x, y + 26, 21, 1);
    }
    if (lane.kind === 'ferry') {
      ctx.fillStyle = '#87978d';
      ctx.fillRect(0, y + 2, 480, 1);
      ctx.fillRect(0, y + 25, 480, 1);
      for (const x of [3, 469]) {
        ctx.fillStyle = '#263f48';
        ctx.fillRect(x, y + 1, 8, 26);
        ctx.fillStyle = '#bdc5a6';
        ctx.fillRect(x + 2, y + 5, 4, 18);
        ctx.fillStyle = '#59726e';
        ctx.fillRect(x + 3, y + 9, 2, 10);
      }
    }
    for (const o of lane.objects) {
      if (lane.kind === 'turtles') drawTurtles(ctx, lane, o, s);
      else if (lane.kind === 'ferry') drawFerry(ctx, lane, o, s);
      else if (lane.water) drawLog(ctx, lane, o);
      else drawCar(ctx, lane, o, s);
    }
  }
  for (const r of s.ripples) {
    ctx.strokeStyle = r.type === 'water' ? '#b2d4d8' : '#c8e0a8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      r.x,
      r.y + 5,
      8 + (1 - r.life / 0.55) * 18,
      3 + (1 - r.life / 0.55) * 5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  if (s.feedback?.type === 'traffic') {
    const p = s.feedback;
    ctx.fillStyle = '#edc39a';
    for (let n = 0; n < 8; n++) {
      const a = (n * Math.PI) / 4,
        d = 8 + (1 - p.life / 0.65) * 14;
      ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 3, 3);
    }
  }
  if (s.spawnDelay === 0 && s.transition === 0 && s.phase !== 'lost') drawFrog(ctx, s.frog, s);
  ctx.fillStyle = '#152f37';
  ctx.fillRect(0, 0, 480, 32);
  text(ctx, `${s.round}/3 ${env.t(stage.en, stage.zh)}`, 10, 4, '#d3e2b5', 12);
  text(
    ctx,
    `${env.t('TIME', '时间')} ${Math.ceil(Math.max(0, s.timeLeft))}`,
    470,
    4,
    s.timeLeft < 10 ? '#efb18c' : '#e6dfbd',
    12,
    'right',
  );
  text(ctx, `${env.t('HOMES', '家园')} ${s.homes.length}/4`, 10, 19, '#b6cead', 12);
  const cue = riverCue(s);
  text(ctx, env.t(cue.en, cue.zh), 240, 19, '#e0d5a6', 12, 'center');
  text(ctx, `${env.t('FROGS', '青蛙')} ${s.lives}`, 470, 19, '#b6cead', 12, 'right');
  ctx.fillStyle = '#3b5658';
  ctx.fillRect(0, 31, 480, 1);
  ctx.fillStyle = s.timeLeft < 10 ? '#d9a27e' : '#93ae81';
  ctx.fillRect(0, 31, (480 * Math.max(0, s.timeLeft)) / 45, 1);
}

export function createGame(env) {
  const s = createRiverState();
  let ended = false;
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      const lives = s.lives,
        rescued = s.rescued,
        score = s.score;
      stepRiver(s, dt, input);
      if (s.lives < lives) env.sound('hit');
      else if (s.rescued > rescued) env.sound('coin');
      else if (s.score > score) env.sound('move');
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.sound(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'Twelve frogs home across all three crossings!',
                '三处渡口的十二只青蛙全部到家！',
              )
            : env.t(
                'The crossing needs another try. Wait on grass; watch deck edges and turtle arrows.',
                '再试一次。可在草地等待，留意浮台边缘和乌龟潜水箭头。',
              ),
        });
      }
    },
    draw(ctx) {
      drawRiver(ctx, s, env);
    },
    getState: () => ({
      ...structuredClone(s),
      totalRounds: 3,
      stage: structuredClone(STAGES[s.round - 1]),
      status: {
        en: `Crossing ${s.round}/3 · Homes ${s.homes.length}/4 · ${s.lives} frogs · ${Math.ceil(Math.max(0, s.timeLeft))}s · ${riverPrompt(s).en}`,
        zh: `渡口 ${s.round}/3 · 家园 ${s.homes.length}/4 · ${s.lives}只青蛙 · ${Math.ceil(Math.max(0, s.timeLeft))}秒 · ${riverPrompt(s).zh}`,
      },
    }),
  };
}
