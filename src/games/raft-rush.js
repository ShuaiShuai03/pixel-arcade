import { clamp, background, drawPixelText as text } from '../shared/utils.js';

export const meta = {
  id: 'raft-rush',
  name: { en: 'Raft Rush', zh: '激流木筏' },
  genre: 'sports',
  players: '1',
  touch: true,
  description: {
    en: 'Steer a log raft down three rivers. The current always carries you, and your paddling adds to it. Arrows push the raft, Space is a strong paddle stroke that spends stamina, and X holds the raft against the water so you can slow down. Pick up rescue flags, thread the rock gates and stop inside the dock marker at the end of each river. Hard hits on banks or rocks cost hull; the raft breaks apart when the hull is gone.',
    zh: '驾驶木筏漂流三段河流。水流始终推着你前进，划桨的力量会叠加在水流之上：方向键推动木筏，空格是消耗体力的强力划桨，X 用来对抗水流减速。拾取救援旗帜，穿过岩石门，并在每段河流终点的码头标记内停稳。撞上河岸或岩石过猛会损坏船体，船体耗尽木筏即解体。',
  },
  keys: [
    { label: { en: 'Push the raft', zh: '推动木筏' }, keys: 'Arrows / WASD' },
    {
      label: { en: 'Strong paddle stroke (uses stamina)', zh: '强力划桨（消耗体力）' },
      keys: 'Space',
    },
    { label: { en: 'Hold to brake against the water', zh: '按住逆水减速' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Paddle', '划桨', 'right'],
    ['KeyX', 'Brake', '减速', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Distances are pixels and times are seconds. The simulation always advances in STEP slices.
export const PHYSICS = Object.freeze({
  step: 1 / 120,
  radius: 12,
  drag: 2.2,
  quadDrag: 0.004,
  thrust: 200,
  brakeDrag: 9,
  strokeAccel: 720,
  strokeTime: 0.28,
  strokeCost: 40,
  staminaMax: 100,
  staminaRegen: 22,
  strokeCooldown: 0.45,
  restitution: 0.3,
  safeImpact: 100,
  invulnerable: 1.3,
  hull: 3,
  dockSpeed: 20,
  dockTime: 0.8,
});
const P = PHYSICS;
const STEP = P.step,
  R = P.radius,
  MAX_DT = 0.1,
  SUB_DISTANCE = 3,
  FLAG_R = 11,
  CAM_LEAD = 150,
  CAM_EASE = 8,
  START_X = 70,
  WALL_PAD = 30,
  HUD_TOP = 28,
  HUD_BOTTOM = 292,
  BANNER_SECONDS = 3,
  LOOK = 90,
  STOP_K = 0.42,
  STEER_ON = 16,
  STEER_OFF = 7,
  FLAG_SCORE = 100,
  DOCK_SCORE = 250,
  HULL_SCORE = 50,
  FLAG_NEAR = 230,
  BRAKE_ON = 28,
  BRAKE_OFF = 16,
  STALL_ON = 8,
  STALL_OFF = 22,
  PROMPT_HOLD = 0.6;

const lerpKeys = (keys, x) => {
  if (x <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const a = keys[i - 1],
        b = keys[i],
        u = (x - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((v, k) => v + (b[k + 1] - v) * u);
    }
  }
  return keys[keys.length - 1].slice(1);
};

const rock = (x, dy, r) => ({ x, dy, r });
const gate = (x, gap, r = 17) => [rock(x, -(gap / 2 + r), r), rock(x, gap / 2 + r, r)];
const flag = (x, dy) => ({ x, dy });
const dock = (x0, x1) => ({ x0, x1 });

const SECTION_DATA = [
  {
    name: { en: 'Mill Run', zh: '磨坊河道' },
    length: 1800,
    path: [
      [0, 160, 92],
      [500, 150, 85],
      [1000, 178, 82],
      [1500, 160, 86],
      [1800, 160, 92],
    ],
    flow: [
      [0, 36],
      [700, 46],
      [1000, 10],
      [1120, 40],
      [1450, 44],
      [1560, 4],
      [1800, 0],
    ],
    fields: [],
    eddies: [{ x: 820, dy: -62, r: 50, s: 30, dir: 1 }],
    rocks: [...gate(600, 96), ...gate(1250, 90), rock(350, -60, 14), rock(950, 62, 16)],
    flags: [flag(300, -10), flag(700, 12), flag(1100, -14), flag(1400, 10)],
    dock: dock(1620, 1780),
  },
  {
    name: { en: 'Switchback Rapids', zh: '回弯急流' },
    length: 2200,
    path: [
      [0, 160, 88],
      [400, 140, 80],
      [800, 180, 76],
      [1200, 145, 74],
      [1600, 175, 76],
      [2200, 160, 86],
    ],
    flow: [
      [0, 48],
      [500, 56],
      [850, 56],
      [950, 8],
      [1050, 56],
      [1500, 62],
      [1950, 40],
      [2060, 4],
      [2200, 0],
    ],
    fields: [
      { x0: 450, x1: 700, vx: 0, vy: -26 },
      { x0: 1250, x1: 1550, vx: 0, vy: 28 },
    ],
    eddies: [
      { x: 1000, dy: -62, r: 50, s: 32, dir: -1 },
      { x: 1800, dy: 62, r: 50, s: 32, dir: 1 },
    ],
    rocks: [
      ...gate(650, 96),
      ...gate(1350, 92),
      ...gate(1700, 92),
      rock(250, 58, 15),
      rock(1100, 60, 15),
    ],
    flags: [flag(300, -12), flag(820, 12), flag(1150, -12), flag(1900, 12)],
    dock: dock(2040, 2180),
  },
  {
    name: { en: 'Thunder Gorge', zh: '雷鸣峡谷' },
    length: 2600,
    path: [
      [0, 160, 78],
      [400, 135, 70],
      [800, 185, 66],
      [1200, 140, 64],
      [1600, 185, 66],
      [2000, 150, 68],
      [2600, 160, 80],
    ],
    flow: [
      [0, 60],
      [600, 72],
      [1000, 80],
      [1250, 26],
      [1400, 76],
      [1900, 80],
      [2300, 50],
      [2450, 4],
      [2600, 0],
    ],
    fields: [
      { x0: 610, x1: 830, vx: 0, vy: -32 },
      { x0: 950, x1: 1150, vx: 0, vy: 28 },
      { x0: 1620, x1: 1800, vx: 0, vy: -32 },
      { x0: 1800, x1: 2000, vx: -25, vy: 0 },
    ],
    eddies: [
      { x: 1250, dy: -62, r: 50, s: 34, dir: 1 },
      { x: 2150, dy: 62, r: 50, s: 34, dir: -1 },
    ],
    rocks: [
      ...gate(560, 90),
      ...gate(900, 86),
      ...gate(1560, 86),
      ...gate(1900, 84),
      ...gate(2200, 86),
      rock(330, 50, 14),
    ],
    flags: [flag(300, -10), flag(730, 12), flag(1300, -12), flag(2050, 12)],
    dock: dock(2440, 2580),
  },
];

const FIELD_RAMP = 40;
const SAMPLE = 60;
const jag = (i) => ((i * 7919) % 11) - 5;

function buildSection(d) {
  const centre = (x) => {
    const [cy, half] = lerpKeys(d.path, x);
    return { cy, half };
  };
  const top = [],
    bottom = [];
  for (let i = 0, x = -WALL_PAD; x < d.length; i++, x += SAMPLE) {
    const { cy, half } = centre(x);
    top.push([x, cy - half + jag(i) * 0.8]);
    bottom.push([x, cy + half - jag(i + 3) * 0.8]);
  }
  const end = centre(d.length);
  top.push([d.length, end.cy - end.half]);
  bottom.push([d.length, end.cy + end.half]);
  const segs = [];
  const add = (ax, ay, bx, by, sign) => {
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, nx: (-(by - ay) / len) * sign, ny: ((bx - ax) / len) * sign });
  };
  for (let i = 1; i < top.length; i++) add(...top[i - 1], ...top[i], 1);
  for (let i = 1; i < bottom.length; i++) add(...bottom[i - 1], ...bottom[i], -1);
  add(d.length, bottom[bottom.length - 1][1], d.length, top[top.length - 1][1], -1);
  add(0, centre(0).cy - centre(0).half, 0, centre(0).cy + centre(0).half, -1);
  const place = (o) => ({ ...o, y: centre(o.x).cy + o.dy });
  return {
    ...d,
    need: d.flags.length - 1,
    centre,
    top,
    bottom,
    segs,
    rocks: d.rocks.map(place),
    flags: d.flags.map(place),
    eddies: d.eddies.map(place),
  };
}
export const SECTIONS = SECTION_DATA.map(buildSection);

// Water velocity at a point: base flow (fastest mid-river) plus cross-current fields plus eddies.
export function currentAt(sec, x, y) {
  const { cy, half } = sec.centre(x);
  const off = clamp((y - cy) / half, -1, 1);
  let vx = lerpKeys(sec.flow, x)[0] * (1 - 0.4 * off * off),
    vy = 0;
  for (const f of sec.fields) {
    const w = clamp(Math.min(x - f.x0, f.x1 - x) / FIELD_RAMP, 0, 1);
    vx += f.vx * w;
    vy += f.vy * w;
  }
  for (const e of sec.eddies) {
    const dx = x - e.x,
      dy = y - e.y,
      d = Math.hypot(dx, dy);
    if (d < e.r && d > 1e-6) {
      const k = (1 - d / e.r) * e.s * e.dir;
      vx += (-dy / d) * k;
      vy += (dx / d) * k;
    }
  }
  return { vx, vy };
}

const pair = (en, zh) => ({ en, zh });
const KEY_WORDS = {
  Up: ['Up', '上'],
  Down: ['Down', '下'],
  Left: ['Left', '左'],
  Right: ['Right', '右'],
  Space: ['Space', '空格'],
  X: ['X', 'X'],
};
const pressText = (keys) =>
  pair(
    `Press ${keys.map((k) => KEY_WORDS[k][0]).join(' + ')}`,
    `按 ${keys.map((k) => KEY_WORDS[k][1]).join(' + ')}`,
  );
const NOTES = {
  collect: pair('Arrows steer to the flags', '方向键对准旗帜'),
  dockOpen: pair('Arrows steer to the dock', '方向键驶向码头'),
  docking: pair('Docking... hold still', '停靠中…保持不动'),
};

export function createRaftState(section = 0, carry = {}) {
  const sec = SECTIONS[section];
  const y = sec.centre(START_X).cy;
  const c = currentAt(sec, START_X, y);
  return {
    section,
    t: 0,
    x: START_X,
    y,
    vx: c.vx,
    vy: c.vy,
    hull: carry.hull ?? P.hull,
    score: carry.score ?? 0,
    stamina: P.staminaMax,
    cooldown: 0,
    stroke: 0,
    strokeX: 1,
    strokeY: 0,
    invulnerable: P.invulnerable,
    bump: 0,
    got: sec.flags.map(() => false),
    dockTimer: 0,
    camX: 0,
    banner: carry.banner ?? 0,
    cue: {
      y: 0,
      x: 0,
      brake: false,
      keys: [],
      text: NOTES.collect,
      held: 0,
      shownBrake: false,
      docking: false,
      hull: carry.hull ?? P.hull,
    },
    phase: 'playing',
  };
}

function closestOnSegment(seg, px, py) {
  const dx = seg.bx - seg.ax,
    dy = seg.by - seg.ay,
    u = clamp(((px - seg.ax) * dx + (py - seg.ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return [seg.ax + dx * u, seg.ay + dy * u];
}

// Pushes the raft out of every overlapped bank or rock and reflects only the inward velocity.
function resolveContacts(s, sec, events) {
  const touch = (nx, ny, depth) => {
    s.x += nx * depth;
    s.y += ny * depth;
    const vn = s.vx * nx + s.vy * ny;
    if (vn >= 0) return;
    s.vx -= (1 + P.restitution) * vn * nx;
    s.vy -= (1 + P.restitution) * vn * ny;
    s.bump = 0.25;
    if (-vn > P.safeImpact && s.invulnerable <= 0) {
      s.hull -= 1;
      s.invulnerable = P.invulnerable;
      events.push('hit');
    }
  };
  for (let pass = 0, touched = true; touched && pass < 4; pass++) {
    touched = false;
    for (const seg of sec.segs) {
      if (Math.min(seg.ax, seg.bx) > s.x + R || Math.max(seg.ax, seg.bx) < s.x - R) continue;
      const [cx, cy] = closestOnSegment(seg, s.x, s.y),
        d = Math.hypot(s.x - cx, s.y - cy),
        side = (s.x - cx) * seg.nx + (s.y - cy) * seg.ny;
      if (d >= R) continue;
      if (side <= 0) touch(seg.nx, seg.ny, R - side);
      else touch((s.x - cx) / d, (s.y - cy) / d, R - d);
      touched = true;
    }
    for (const r of sec.rocks) {
      const dx = s.x - r.x,
        dy = s.y - r.y,
        d = Math.hypot(dx, dy);
      if (d >= R + r.r) continue;
      touch(d > 1e-6 ? dx / d : 0, d > 1e-6 ? dy / d : -1, R + r.r - d);
      touched = true;
    }
  }
}

function collectFlags(s, sec, events) {
  sec.flags.forEach((f, i) => {
    if (!s.got[i] && Math.hypot(s.x - f.x, s.y - f.y) < R + FLAG_R) {
      s.got[i] = true;
      s.score += FLAG_SCORE;
      events.push('coin');
    }
  });
}

function moveRaft(s, sec, events) {
  const dist = Math.hypot(s.vx, s.vy) * STEP,
    n = Math.max(1, Math.ceil(dist / SUB_DISTANCE));
  for (let i = 0; i < n; i++) {
    s.x += (s.vx * STEP) / n;
    s.y += (s.vy * STEP) / n;
    collectFlags(s, sec, events);
    resolveContacts(s, sec, events);
  }
}

const countFlags = (s) => s.got.filter(Boolean).length;

// Updates the prompt with hysteresis. Pure guidance: it never changes the physics.
function guide(s, sec) {
  const c = s.cue,
    collected = countFlags(s),
    open = collected >= sec.need,
    speed = Math.hypot(s.vx, s.vy),
    inZone = s.x >= sec.dock.x0 && s.x <= sec.dock.x1,
    ahead = sec.flags.filter((f, i) => !s.got[i] && f.x > s.x - 20);
  let target = null;
  if (!open && collected + ahead.length < sec.need) {
    const missed = sec.flags.filter((f, i) => !s.got[i] && f.x <= s.x - 20);
    target = missed[missed.length - 1];
  } else if (ahead.length && ahead[0].x - s.x < FLAG_NEAR) target = ahead[0];
  const ty = target ? target.y : sec.centre(s.x + LOOK).cy,
    dx = target ? target.x - s.x : 1,
    docking = open && inZone && speed <= P.dockSpeed,
    err = ty - s.y - STOP_K * s.vy;
  if (docking) c.y = 0;
  else if (c.y === 0) c.y = Math.abs(err) > STEER_ON ? Math.sign(err) : 0;
  else if (c.y * err < -STEER_ON) c.y = Math.sign(err);
  else if (c.y * err < STEER_OFF) c.y = 0;
  if (c.x === -1) c.x = dx > -10 ? 0 : -1;
  else if (c.x === 1) c.x = s.vx >= STALL_OFF || (open && inZone) ? 0 : 1;
  else if (target && dx < -30) c.x = -1;
  else if (s.vx < STALL_ON && !(open && inZone)) c.x = 1;
  c.brake = open && s.x > sec.dock.x0 - 40 && speed > (c.brake ? BRAKE_OFF : BRAKE_ON);
  const keys = [];
  if (c.y) keys.push(c.y < 0 ? 'Up' : 'Down');
  if (c.x) keys.push(c.x < 0 ? 'Left' : 'Right');
  if (c.x && s.stamina >= P.strokeCost && s.cooldown <= 0) keys.push('Space');
  if (c.brake) keys.push('X');
  const text = keys.length
    ? pressText(keys)
    : docking
      ? NOTES.docking
      : open
        ? NOTES.dockOpen
        : NOTES.collect;
  // The shown prompt is steady: it changes at most every PROMPT_HOLD seconds, except for dock and damage events.
  c.held += STEP;
  const urgent = docking || c.docking || c.brake !== c.shownBrake || s.hull < c.hull;
  c.hull = s.hull;
  if (text.en !== c.text.en && (c.held >= PROMPT_HOLD || urgent)) {
    Object.assign(c, { keys, text, held: 0, shownBrake: c.brake, docking });
  }
}

// One fixed simulation slice. ctl: {dx, dy, stroke (edge), brake}. Returns the events it produced.
export function stepRaft(s, ctl) {
  const events = [];
  if (s.phase !== 'playing') return events;
  const sec = SECTIONS[s.section];
  s.t += STEP;
  s.cooldown = Math.max(0, s.cooldown - STEP);
  s.invulnerable = Math.max(0, s.invulnerable - STEP);
  s.bump = Math.max(0, s.bump - STEP);
  s.banner = Math.max(0, s.banner - STEP);
  s.stamina = Math.min(P.staminaMax, s.stamina + P.staminaRegen * STEP);
  let ax = ctl.dx,
    ay = ctl.dy;
  const len = Math.hypot(ax, ay);
  if (len > 1) {
    ax /= len;
    ay /= len;
  }
  if (ctl.stroke && s.cooldown <= 0 && s.stamina >= P.strokeCost && s.stroke <= 0) {
    s.stamina -= P.strokeCost;
    s.cooldown = P.strokeCooldown;
    s.stroke = P.strokeTime;
    s.strokeX = len > 0 ? ax : 1;
    s.strokeY = len > 0 ? ay : 0;
    events.push('move');
  }
  let fx = ax * P.thrust,
    fy = ay * P.thrust;
  if (s.stroke > 0) {
    s.stroke = Math.max(0, s.stroke - STEP);
    fx += s.strokeX * P.strokeAccel;
    fy += s.strokeY * P.strokeAccel;
  }
  // Implicit damping toward the local water velocity keeps very large speeds stable.
  const w = currentAt(sec, s.x, s.y),
    rx = s.vx - w.vx,
    ry = s.vy - w.vy,
    k = 1 + ((ctl.brake ? P.brakeDrag : P.drag) + P.quadDrag * Math.hypot(rx, ry)) * STEP;
  s.vx = w.vx + (rx + fx * STEP) / k;
  s.vy = w.vy + (ry + fy * STEP) / k;
  moveRaft(s, sec, events);
  const camTarget = clamp(s.x - CAM_LEAD, 0, sec.length + WALL_PAD - 480);
  s.camX += (camTarget - s.camX) * Math.min(1, CAM_EASE * STEP);
  if (s.hull <= 0) {
    s.phase = 'lost';
    events.push('lose');
    return events;
  }
  dockCheck(s, sec, events);
  if (s.phase === 'playing' && SECTIONS[s.section] === sec) guide(s, sec);
  return events;
}

function dockCheck(s, sec, events) {
  const inZone = s.x >= sec.dock.x0 && s.x <= sec.dock.x1;
  if (countFlags(s) >= sec.need && inZone && Math.hypot(s.vx, s.vy) <= P.dockSpeed) {
    s.dockTimer += STEP;
  } else s.dockTimer = Math.max(0, s.dockTimer - 2 * STEP);
  if (s.dockTimer < P.dockTime) return;
  s.score += DOCK_SCORE + s.hull * HULL_SCORE;
  events.push('coin');
  if (s.section === SECTIONS.length - 1) {
    s.phase = 'won';
    events.push('win');
    return;
  }
  const carry = { hull: Math.min(P.hull, s.hull + 1), score: s.score, banner: BANNER_SECONDS };
  Object.assign(s, createRaftState(s.section + 1, carry));
}

const TERMINAL_TEXT = {
  won: pair('You docked all three rivers!', '三条河流全部靠岸成功！'),
  lost: pair('The raft broke apart.', '木筏解体了。'),
};

function statusOf(s) {
  const sec = SECTIONS[s.section],
    n = countFlags(s),
    tail = s.phase === 'playing' ? s.cue.text : TERMINAL_TEXT[s.phase];
  return {
    en: `Section ${s.section + 1}/3 · Flags ${n}/${sec.flags.length} (need ${sec.need}) · Hull ${s.hull} · ${tail.en}`,
    zh: `第 ${s.section + 1}/3 段 · 旗帜 ${n}/${sec.flags.length}（需 ${sec.need}）· 船体 ${s.hull} · ${tail.zh}`,
  };
}

export function createGame(env) {
  const t = env.t;
  let s = createRaftState(0),
    remainder = 0,
    spaceWasHeld = false,
    ended = false;

  function update(dt, input) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_DT || s.phase !== 'playing') return;
    const spaceHeld = input.held('Space'),
      edge = input.pressed('Space') || (spaceHeld && !spaceWasHeld);
    spaceWasHeld = spaceHeld;
    const ctl = {
      dx: (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0),
      dy: (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0),
      brake: input.held('KeyX'),
    };
    remainder += dt;
    for (let first = true; remainder + 1e-9 >= STEP && s.phase === 'playing'; first = false) {
      remainder = Math.max(0, remainder - STEP);
      for (const e of stepRaft(s, { ...ctl, stroke: edge && first })) env.sound(e);
    }
    if (s.phase === 'playing' || ended) return;
    ended = true;
    const won = s.phase === 'won',
      msg = TERMINAL_TEXT[s.phase];
    env.end({ won, score: s.score, message: t(msg.en, msg.zh) });
  }

  function getState() {
    const sec = SECTIONS[s.section],
      w = currentAt(sec, s.x, s.y),
      count = countFlags(s);
    return {
      phase: s.phase,
      score: s.score,
      level: s.section + 1,
      section: s.section,
      sectionName: { ...sec.name },
      time: s.t,
      hull: s.hull,
      stamina: s.stamina,
      cooldown: s.cooldown,
      invulnerable: s.invulnerable,
      player: { x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: R },
      water: { vx: w.vx, vy: w.vy },
      flags: { got: [...s.got], total: sec.flags.length, need: sec.need, count },
      dock: {
        x0: sec.dock.x0,
        x1: sec.dock.x1,
        open: count >= sec.need,
        progress: s.dockTimer / P.dockTime,
      },
      camera: { x: s.camX, lookAhead: 480 - CAM_LEAD },
      prompt: { keys: [...s.cue.keys], text: { ...s.cue.text } },
      status: statusOf(s),
    };
  }

  return { update, draw: (ctx) => drawScene(ctx, s, t), getState };
}

// ---------------------------------------------------------------- rendering

const TAU = Math.PI * 2;
const COL = {
  water: '#1f6f9a',
  deep: '#195f88',
  shallow: '#2b86b0',
  ripple: '#4aa3cc',
  foam: '#dff4ff',
  sand: '#d9b977',
  wet: '#9c8454',
  grass: '#3b7d3c',
  dark: '#25562b',
  reed: '#6aa84f',
  cliff: '#5b6f7c',
  cliffFar: '#3d5666',
  rock: '#7b7f8a',
  rockDark: '#4d515c',
  log: '#a8642d',
  logDark: '#6e3f1b',
  rope: '#f2d16b',
  flag: '#ff5a4f',
  hud: '#0b1a2b',
  go: '#7dffa0',
  plank: '#c98f4f',
};

function poly(ctx, pts, camX, closeY, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] - camX, closeY);
  for (const [x, y] of pts) ctx.lineTo(x - camX, y);
  ctx.lineTo(pts[pts.length - 1][0] - camX, closeY);
  ctx.closePath();
  ctx.fill();
}

// Distant cliffs and tree line above the north bank, scrolling slower than the water for depth.
function drawFarShore(ctx, sec, camX) {
  for (const [par, color, amp] of [
    [0.3, COL.cliffFar, 22],
    [0.55, COL.cliff, 14],
  ]) {
    ctx.fillStyle = color;
    const off = camX * par;
    for (let x = -20; x < 500; x += 10) {
      const n = Math.floor((x + off) / 10),
        wx = camX + x,
        { cy, half } = sec.centre(wx),
        room = cy - half - 24 - HUD_TOP,
        h = Math.min(room, 6 + ((n * 37) % 11) * (amp / 11));
      if (h > 0) ctx.fillRect(x, HUD_TOP - 4, 10, h);
    }
  }
}

function drawBanks(ctx, sec, camX, time) {
  const shift = (pts, d) => pts.map(([x, y]) => [x, y + d]);
  const sides = [
    [sec.top, -1, 0],
    [sec.bottom, 1, 320],
  ];
  for (const [line, dir, edge] of sides) {
    poly(ctx, shift(line, dir * 16), camX, edge, COL.dark);
    poly(ctx, shift(line, dir * 7), camX, edge, COL.grass);
    poly(ctx, shift(line, dir * 3), camX, edge, COL.sand);
    poly(ctx, line, camX, edge, COL.wet);
    ctx.strokeStyle = COL.foam;
    ctx.lineWidth = 2;
    ctx.beginPath();
    line.forEach(([x, y], i) => {
      const wob = Math.sin(time * 3 + i) * 1.5 - dir * 1;
      if (i) ctx.lineTo(x - camX, y + wob);
      else ctx.moveTo(x - camX, y + wob);
    });
    ctx.stroke();
    line.forEach(([x, y], i) => {
      const sx = x - camX;
      ctx.fillStyle = COL.reed;
      ctx.fillRect(sx - 8, y + dir * 6 - (dir < 0 ? 6 : 0), 2, 6);
      ctx.fillRect(sx - 5, y + dir * 7 - (dir < 0 ? 8 : 0), 2, 8);
      ctx.fillStyle = COL.rockDark;
      ctx.fillRect(sx + 10, y + dir * 5 - 2, 6, 4);
      ctx.fillStyle = COL.dark;
      ctx.fillRect(sx - 4, y + dir * (22 + (i % 3) * 4) - 7, 8, 14);
      ctx.fillStyle = COL.grass;
      ctx.fillRect(sx - 7, y + dir * (22 + (i % 3) * 4) - 12, 14, 7);
      ctx.fillStyle = COL.reed;
      ctx.fillRect(sx - 4, y + dir * (22 + (i % 3) * 4) - 14, 8, 4);
    });
  }
}

function drawArrow(ctx, x, y, vx, vy, phase) {
  const speed = Math.hypot(vx, vy),
    ux = vx / speed,
    uy = vy / speed,
    len = 7 + speed * 0.22,
    x0 = x - ux * (len / 2) + ux * phase * 8,
    y0 = y - uy * (len / 2) + uy * phase * 8,
    x1 = x0 + ux * len,
    y1 = y0 + uy * len;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - ux * 4 - uy * 3, y1 - uy * 4 + ux * 3);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * 4 + uy * 3, y1 - uy * 4 - ux * 3);
  ctx.stroke();
}

// Ripples drift with the current; fast water gets whitecaps.
function drawFlow(ctx, sec, camX, time) {
  for (let wx = Math.floor(camX / 24) * 24; wx < camX + 504; wx += 24) {
    const { cy, half } = sec.centre(wx);
    for (let wy = 34; wy < 290; wy += 22) {
      const y = wy + ((wx / 24) % 3) * 6;
      if (Math.abs(y - cy) > half - 4) continue;
      const c = currentAt(sec, wx, y),
        speed = Math.hypot(c.vx, c.vy);
      if (speed < 3) continue;
      const slide = (time * speed * 0.5 + wx * 7) % 24,
        len = 4 + speed * 0.1,
        ux = c.vx / speed,
        uy = c.vy / speed,
        x = wx - camX + ux * slide - 12,
        yy = y + uy * slide;
      ctx.fillStyle = speed > 62 ? COL.foam : COL.ripple;
      ctx.fillRect(x, yy, Math.max(2, Math.abs(ux) * len), Math.max(2, 1 + Math.abs(uy) * len));
    }
  }
}

function drawWater(ctx, sec, camX, time) {
  ctx.fillStyle = COL.water;
  ctx.fillRect(0, 0, 480, 320);
  for (let wx = Math.floor(camX / 52) * 52; wx < camX + 532; wx += 52) {
    const { cy, half } = sec.centre(wx);
    ctx.fillStyle = COL.shallow;
    ctx.fillRect(wx - camX, cy - half, 52, 14);
    ctx.fillRect(wx - camX, cy + half - 14, 52, 14);
  }
  drawFlow(ctx, sec, camX, time);
  ctx.lineWidth = 2;
  for (let wx = Math.floor(camX / 52) * 52; wx < camX + 532; wx += 52) {
    const { cy, half } = sec.centre(wx);
    for (let wy = 50; wy < 290; wy += 40) {
      const y = wy + (wx % 3) * 4;
      if (Math.abs(y - cy) > half - 10) continue;
      const c = currentAt(sec, wx, y),
        speed = Math.hypot(c.vx, c.vy);
      if (speed < 6) continue;
      ctx.strokeStyle = speed > 62 ? COL.foam : '#7fc4e6';
      drawArrow(ctx, wx - camX, y, c.vx, c.vy, (time * 0.8 + wx * 0.013) % 1);
    }
  }
  for (const e of sec.eddies) {
    const ex = e.x - camX;
    ctx.fillStyle = 'rgba(20,70,110,0.35)';
    ctx.beginPath();
    ctx.arc(ex, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COL.foam;
    for (let a = 0; a < 4; a++) {
      const base = time * e.dir * (2.2 - a * 0.35) + a * 1.6,
        rad = e.r * (0.25 + 0.2 * a);
      ctx.beginPath();
      ctx.arc(ex, e.y, rad, base, base + 2);
      ctx.stroke();
      const tipX = ex + Math.cos(base + 2) * rad,
        tipY = e.y + Math.sin(base + 2) * rad;
      ctx.fillStyle = COL.foam;
      ctx.fillRect(tipX - 1, tipY - 1, 3, 3);
    }
  }
}

function drawRocks(ctx, sec, camX, time) {
  ctx.lineWidth = 2;
  for (const r of sec.rocks) {
    const x = r.x - camX;
    ctx.strokeStyle = COL.foam;
    ctx.beginPath();
    ctx.arc(x, r.y, r.r + 3 + Math.sin(time * 4 + r.x) * 1.5, 0, TAU);
    ctx.stroke();
    const flow = currentAt(sec, r.x, r.y),
      speed = Math.max(8, Math.hypot(flow.vx, flow.vy));
    ctx.fillStyle = COL.foam;
    for (let k = 1; k <= 4; k++) {
      const jitter = Math.sin(time * 6 + k + r.y) * 3;
      ctx.fillRect(x + r.r + k * 7 * (speed / 40), r.y - 5 + jitter + k, 8 - k, 2);
      ctx.fillRect(x + r.r + k * 7 * (speed / 40), r.y + 5 - jitter - k, 8 - k, 2);
    }
    ctx.fillStyle = COL.rockDark;
    ctx.beginPath();
    ctx.arc(x, r.y, r.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = COL.rock;
    ctx.beginPath();
    ctx.arc(x - 2, r.y - 2, r.r - 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a7abb6';
    ctx.fillRect(x - 6, r.y - 7, 5, 3);
  }
}

function drawFlags(ctx, sec, s, camX, time) {
  ctx.strokeStyle = COL.rope;
  sec.flags.forEach((f, i) => {
    if (s.got[i]) return;
    const x = f.x - camX,
      bob = Math.sin(time * 3 + i) * 2;
    ctx.fillStyle = COL.logDark;
    ctx.fillRect(x - 1, f.y - 12 + bob, 3, 24);
    ctx.fillStyle = COL.flag;
    ctx.fillRect(x + 2, f.y - 12 + bob, 12, 8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 2, f.y - 12 + bob, 12, 2);
    ctx.beginPath();
    ctx.arc(x, f.y, FLAG_R + 2, 0, TAU);
    ctx.stroke();
  });
}

// Wooden landing: planked quays along both banks, posts, a sign and the end pier.
function drawDock(ctx, sec, s, camX, t) {
  const { x0, x1 } = sec.dock,
    open = countFlags(s) >= sec.need,
    mid = sec.centre((x0 + x1) / 2),
    a = x0 - camX,
    b = x1 - camX,
    top = mid.cy - mid.half,
    bottom = mid.cy + mid.half;
  ctx.fillStyle = open ? 'rgba(120,255,160,0.28)' : 'rgba(255,255,255,0.12)';
  ctx.fillRect(a, top + 6, b - a, mid.half * 2 - 12);
  ctx.strokeStyle = open ? COL.go : '#cfd8e0';
  ctx.lineWidth = 2;
  ctx.strokeRect(a, top + 6, b - a, mid.half * 2 - 12);
  for (const [y, h] of [
    [top - 2, 10],
    [bottom - 8, 10],
  ]) {
    for (let x = x0 - 24; x < sec.length; x += 8) {
      ctx.fillStyle = (x / 8) % 2 ? COL.plank : '#b57d3f';
      ctx.fillRect(x - camX, y, 8, h);
    }
    for (let x = x0 - 24; x <= sec.length; x += 40) {
      ctx.fillStyle = COL.logDark;
      ctx.fillRect(x - camX - 2, y - 3, 5, h + 6);
    }
  }
  const start = sec.centre(0);
  ctx.fillStyle = COL.log;
  ctx.fillRect(-camX - 14, start.cy - start.half - 8, 14, start.half * 2 + 16);
  ctx.fillStyle = COL.log;
  ctx.fillRect(sec.length - camX, top - 8, 14, mid.half * 2 + 16);
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(sec.length - camX + 12, top - 8, 2, mid.half * 2 + 16);
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(a - 3, top - 18, 4, 26);
  ctx.fillStyle = open ? COL.go : COL.flag;
  ctx.fillRect(a + 1, top - 18, 22, 10);
  text(
    ctx,
    open ? t('DOCK', '码头') : t('LOCKED', '未开放'),
    (a + b) / 2,
    mid.cy - 8,
    '#fff',
    14,
    'center',
  );
  ctx.fillStyle = COL.go;
  ctx.fillRect(a, bottom - 22, (b - a) * Math.min(1, s.dockTimer / P.dockTime), 6);
}

// The raft flexes with its speed and tilts with its heading; a V wake and foam trail follow the water-relative motion.
function drawRaft(ctx, s, camX, time) {
  const sec = SECTIONS[s.section],
    w = currentAt(sec, s.x, s.y),
    rx = s.vx - w.vx,
    ry = s.vy - w.vy,
    relSpeed = Math.hypot(rx, ry),
    x = s.x - camX,
    y = s.y + Math.sin(time * 5) * 1.2,
    blink = s.invulnerable > 0 && Math.floor(time * 12) % 2 === 0;
  if (relSpeed > 12) {
    const ux = rx / relSpeed,
      uy = ry / relSpeed;
    ctx.fillStyle = COL.foam;
    for (let k = 1; k <= 6; k++) {
      const d = R + k * (5 + relSpeed * 0.06),
        spread = k * 1.8;
      for (const side of [-1, 1]) {
        ctx.fillRect(
          x - ux * d - uy * spread * side,
          y - uy * d + ux * spread * side,
          4 - (k > 3 ? 1 : 0),
          2,
        );
      }
    }
    ctx.fillRect(x + ux * (R + 2) - 3, y + uy * (R + 2) - 1, 6, 2);
  }
  if (blink) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(clamp(ry / 260, -0.3, 0.3) + clamp(rx / 900, -0.1, 0.1));
  ctx.fillStyle = 'rgba(0,30,50,0.35)';
  ctx.fillRect(-R - 2, R - 3, 2 * R + 4, 4);
  const flex = Math.min(3, relSpeed / 30);
  for (let i = 0; i < 4; i++) {
    const bend = Math.sin(time * 6 + i * 1.3) * flex * 0.5;
    ctx.fillStyle = i % 2 ? COL.log : '#bd7436';
    ctx.fillRect(-R, -R + i * 6 + bend, 2 * R, 6);
    ctx.fillStyle = COL.logDark;
    ctx.fillRect(-R, -R + i * 6 + 5 + bend, 2 * R, 1);
    ctx.fillStyle = '#d9954f';
    ctx.fillRect(R - 3, -R + i * 6 + 1 + bend, 3, 3);
  }
  ctx.fillStyle = COL.rope;
  ctx.fillRect(-7, -R, 3, 2 * R);
  ctx.fillRect(3, -R, 3, 2 * R);
  // Paddler: body, head with hat and a paddle that swings during a stroke.
  ctx.fillStyle = '#2f5fa8';
  ctx.fillRect(-5, -4, 9, 8);
  ctx.fillStyle = '#f2c9a0';
  ctx.fillRect(-3, -9, 6, 5);
  ctx.fillStyle = '#e0453a';
  ctx.fillRect(-4, -11, 8, 3);
  const swing = s.stroke > 0 ? Math.sin((1 - s.stroke / P.strokeTime) * Math.PI) : 0,
    reach = 8 + swing * 8,
    dip = swing * 7;
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(4, 0, reach, 2);
  ctx.fillStyle = '#d9a35f';
  ctx.fillRect(4 + reach, -2 + dip * 0.2, 5, 6);
  if (s.stroke > 0 || s.bump > 0) {
    ctx.fillStyle = s.bump > 0 ? '#ffe28a' : COL.foam;
    ctx.fillRect(-R - 8, 4, 8, 3);
    ctx.fillRect(R + 4 + reach - 8, 6 + dip, 8, 3);
  }
  ctx.restore();
}

function drawHud(ctx, s, t) {
  const sec = SECTIONS[s.section],
    n = countFlags(s),
    prompt = s.phase === 'playing' ? s.cue.text : TERMINAL_TEXT[s.phase];
  ctx.fillStyle = COL.hud;
  ctx.fillRect(0, 0, 480, HUD_TOP - 4);
  ctx.fillRect(0, HUD_BOTTOM, 480, 320 - HUD_BOTTOM);
  text(ctx, t(`Section ${s.section + 1}/3`, `第 ${s.section + 1}/3 段`), 8, 4, '#fff', 14);
  const flagText = t(
    `Flags ${n}/${sec.flags.length} (need ${sec.need})`,
    `旗帜 ${n}/${sec.flags.length}（需 ${sec.need}）`,
  );
  text(ctx, flagText, 150, 4, n >= sec.need ? COL.go : '#ffe28a', 14);
  for (let i = 0; i < P.hull; i++) {
    ctx.fillStyle = i < s.hull ? COL.flag : '#44526a';
    ctx.fillRect(400 + i * 22, 5, 16, 12);
  }
  text(ctx, t(prompt.en, prompt.zh), 8, 298, '#fff', 16);
  text(ctx, t('Paddle', '划桨'), 296, 300, '#fff', 14);
  ctx.fillStyle = '#44526a';
  ctx.fillRect(350, 304, 120, 8);
  ctx.fillStyle = s.stamina >= P.strokeCost ? COL.go : '#ffb347';
  ctx.fillRect(350, 304, 120 * (s.stamina / P.staminaMax), 8);
  if (s.banner > 0) text(ctx, t(sec.name.en, sec.name.zh), 240, 40, '#fff', 16, 'center');
}

function drawScene(ctx, s, t) {
  const sec = SECTIONS[s.section];
  background(ctx, COL.deep);
  drawWater(ctx, sec, s.camX, s.t);
  drawDock(ctx, sec, s, s.camX, t);
  drawBanks(ctx, sec, s.camX, s.t);
  drawFarShore(ctx, sec, s.camX);
  drawRocks(ctx, sec, s.camX, s.t);
  drawFlags(ctx, sec, s, s.camX, s.t);
  drawRaft(ctx, s, s.camX, s.t);
  drawHud(ctx, s, t);
}
