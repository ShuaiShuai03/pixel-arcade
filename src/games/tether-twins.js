import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'tether-twins',
  name: { en: 'Tether Twins', zh: '牵绳双子' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Two linked robots share one insulated cable of fixed length. The cable bends around posts and wall corners, never stretches and never crosses a wall. Plates light while the cable lies across them, gates open while powered, and tension relays latch when the cable is wrapped round them and pulled TAUT. Live strips zap a robot that touches them. Put both robots on their pads in all three rooms. Solo: X switches the active robot, the partner holds still. Co-op: one player each.',
    zh: '两个相连的机器人共用一根固定长度的绝缘电缆。电缆会绕过立柱和墙角，不会拉长，也不会穿墙。电缆压过电板时电板亮起，通电时闸门开启；电缆绕在张力继电柱上并拉紧时，继电器锁定。带电条会电击接触它的机器人。在三个房间中让两个机器人都站上各自的终点板。单人：按 X 切换当前机器人，另一个保持不动。双人：各控制一个。',
  },
  keys: [
    { label: { en: 'Red (P1) move', zh: '红色（玩家一）移动' }, keys: 'W A S D' },
    { label: { en: 'Red reel in / pay out', zh: '红色 收线 / 放线' }, keys: 'F / G' },
    { label: { en: 'Blue (P2) move', zh: '蓝色（玩家二）移动' }, keys: '↑ ← ↓ →' },
    { label: { en: 'Blue reel in / pay out', zh: '蓝色 收线 / 放线' }, keys: ', / .' },
    { label: { en: 'Solo: switch robot', zh: '单人：切换机器人' }, keys: 'X' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['KeyX', 'Switch', '切换', 'right'],
    ['KeyF', 'Reel in', '收线', 'right'],
    ['KeyG', 'Pay out', '放线', 'right'],
  ]),
  multiplayerTouchControls: touch([
    ['KeyA', 'A', 'A', 'left'],
    ['KeyW', 'W', 'W', 'left'],
    ['KeyS', 'S', 'S', 'left'],
    ['KeyD', 'D', 'D', 'left'],
    ['KeyF', 'Reel', '收', 'left'],
    ['KeyG', 'Pay', '放', 'left'],
    ['ArrowLeft', '◀', '◀', 'right'],
    ['ArrowUp', '▲', '▲', 'right'],
    ['ArrowDown', '▼', '▼', 'right'],
    ['ArrowRight', '▶', '▶', 'right'],
    ['Comma', 'Reel', '收', 'right'],
    ['Period', 'Pay', '放', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 26,
  bottom: 290,
  step: 1 / 120,
  maxDt: 0.1,
  robot: 22,
  speed: 104,
  accel: 1300,
  post: 16,
  plate: 20,
  reel: 160,
  minLen: 40,
  tautEps: 1.5,
  stretchTol: 0.01,
  ring: 6,
  cells: 3,
  freeze: 0.7,
  promptHold: 0.5,
  msgTime: 1.6,
  gateGrow: 2,
  padReach: 12,
  roomScore: 1000,
  cellScore: 250,
  gateScore: 100,
});
const { tile: T, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
const H = RULES.robot / 2;
const EPS = 1e-9;
const SIDE_EPS = 1e-6;
const X = (c) => c * T + T / 2;
const Y = (r) => TOP + r * T + T / 2;
const NAMES = [
  { en: 'Red', zh: '红色' },
  { en: 'Blue', zh: '蓝色' },
];
const KEYS = [
  { en: 'WASD', zh: 'WASD' },
  { en: 'Arrows', zh: '方向键' },
];

const TXT = {
  plate: ['step on the glowing plate', '踩上发光的电板'],
  toGate: ['walk to the gate', '走到闸门前'],
  thru: ['go through the gate', '穿过闸门'],
  padR: ['stand on the red pad', '站上红色终点板'],
  padB: ['stand on the blue pad', '站上蓝色终点板'],
  downRight: ['head down the right side', '沿右侧向下走'],
  park: ['park under the post', '停在立柱下方'],
  over: ['cross above the post', '从立柱上方越过'],
  right: ['keep going right', '继续向右'],
  comeDown: ['come down to the gate', '下到闸门前'],
  left: ['walk left along the floor', '沿底部向左走'],
  upLeft: ['go up the left side', '沿左侧向上'],
  relay: ['sweep the cable over the relay', '用电缆扫过继电柱'],
  reel: ['reel in until the cable is TAUT', '收线直到电缆绷紧'],
  pay: ['pay out the cable', '放出电缆'],
  top: ['wait at the top', '到上方等待'],
  downLeft: ['go down the left side', '沿左侧向下'],
  down: ['head down', '向下走'],
};
const WALL = '####################';
const ROOMS = [
  {
    name: { en: 'Spool Test', zh: '线轴测试' },
    len: 320,
    map: [
      WALL,
      '#........#.........#',
      '#........#.........#',
      '#........#.........#',
      '#........A.........#',
      '#........A........x#',
      '#........#........x#',
      '#........#.........#',
      '#........#.........#',
      '#........#.........#',
      WALL,
    ],
    start: [2, 2, 2, 8],
    pads: [16, 2, 16, 8],
    posts: [],
    plates: [{ c: 5, r: 7, gate: 'A' }],
    holds: [[1, 2, (v) => v.open.A || v.R.x >= 262, 0]],
    steps: [
      [1, X(5), Y(7), (v) => v.open.A || v.R.x >= 262, 'plate'],
      [0, X(8.5), Y(4.5), (v) => v.R.x >= 190, 'toGate'],
      [0, X(11), Y(4.4), (v) => v.R.x >= 262, 'thru'],
      [0, 'pad', 0, (v) => v.pad[0], 'padR'],
      [1, X(8.5), Y(4.5), (v) => v.B.x >= 190, 'toGate'],
      [1, X(11), Y(4.5), (v) => v.B.x >= 262, 'thru'],
      [1, X(11), Y(8), (v) => v.B.y >= 215, 'downRight'],
      [1, 'pad', 1, (v) => v.pad[1], 'padB'],
    ],
  },
  {
    name: { en: 'Live Pit', zh: '带电深坑' },
    len: 420,
    map: [
      WALL,
      '#.............#....#',
      '#.............#....#',
      '#.............#....#',
      '#.............A....#',
      '#.............A....#',
      '#.............#....#',
      '#.............#....#',
      '#.............#....#',
      '#.............#....#',
      WALL,
    ],
    start: [7, 8, 2, 2],
    pads: [17, 8, 17, 2],
    posts: [{ c: 7, r: 3 }],
    plates: [{ c: 7, r: 5, gate: 'A' }],
    rings: [{ c: 7, r: 5 }],
    holds: [[2, 3, (v) => v.open.A || v.B.x >= 350, 0]],
    steps: [
      [0, X(7), Y(8.5), (v) => v.near(0, X(7), Y(8.5), 14), 'park'],
      [1, X(8.5), Y(1.5), (v) => v.B.x >= 205, 'over'],
      [1, X(11), Y(1.5), (v) => v.B.x >= 258, 'right'],
      [1, X(11), Y(4.5), (v) => v.B.y >= 134 || v.B.x >= 350, 'comeDown'],
      [1, X(15), Y(4.5), (v) => v.B.x >= 362, 'thru'],
      [1, 'pad', 1, (v) => v.pad[1], 'padB'],
      [0, X(3), Y(8.5), (v) => v.R.x <= 134 || v.R.y <= 100 || v.R.x >= 250, 'left'],
      [0, X(3), Y(1.5), (v) => v.R.y <= 86 || v.R.x >= 250, 'upLeft'],
      [0, X(11), Y(1.5), (v) => v.R.x >= 258, 'over'],
      [0, X(11), Y(4.5), (v) => v.R.y >= 134 || v.R.x >= 350, 'comeDown'],
      [0, X(15), Y(4.5), (v) => v.R.x >= 362, 'thru'],
      [0, 'pad', 0, (v) => v.pad[0], 'padR'],
    ],
  },
  {
    name: { en: 'Switchyard', zh: '配电场' },
    len: 400,
    map: [
      WALL,
      '#....#.........#...#',
      '#....#.........#...#',
      '#....#.........#...#',
      '#....B.........A...#',
      '#....B.........A...#',
      '#....#.........#...#',
      '#....#.........#...#',
      '#....#.........#...#',
      '#....#.........#...#',
      WALL,
    ],
    start: [1, 2, 1, 8],
    pads: [16, 3, 18, 8],
    posts: [{ c: 10, r: 3 }],
    relays: [{ c: 2, r: 5, gate: 'B' }],
    plates: [{ c: 10, r: 5, gate: 'A' }],
    rings: [{ c: 10, r: 5 }],
    holds: [
      [1, 1, (v) => v.wrapped || v.latched.B, 0],
      [10, 12, (v) => v.open.A || v.R.x >= 372, 9],
    ],
    steps: [
      [0, X(3), Y(1.5), (v) => v.wrapped || v.latched.B, 'relay'],
      [-1, 0, 0, (v) => v.latched.B, 'reel'],
      [-1, 0, 1, (v) => v.len >= 0.9 * v.max, 'pay'],
      [0, X(4), Y(4.5), (v) => v.R.x >= 150 || (v.R.y >= 130 && v.R.x >= 96), 'toGate'],
      [0, X(7), Y(4.5), (v) => v.R.x >= 156, 'thru'],
      [0, X(7), Y(1.5), (v) => (v.R.y <= 86 && v.R.x >= 156) || v.R.x >= 280, 'top'],
      [1, X(4), Y(4.5), (v) => v.B.x >= 150 || (v.B.y <= 160 && v.B.x >= 96), 'toGate'],
      [1, X(7), Y(4.5), (v) => v.B.x >= 156, 'thru'],
      [
        1,
        X(7),
        Y(8.5),
        (v) => (v.B.y >= 220 && v.B.x >= 156) || v.open.A || v.R.x >= 300,
        'downLeft',
      ],
      [1, X(10), Y(8.5), (v) => v.near(1, X(10), Y(8.5), 14), 'park'],
      [0, X(13), Y(1.5), (v) => v.R.x >= 300, 'over'],
      [0, X(13), Y(4.5), (v) => (v.R.y >= 134 && v.R.x >= 300) || v.R.x >= 370, 'comeDown'],
      [0, X(16), Y(4.5), (v) => v.R.x >= 372, 'thru'],
      [0, 'pad', 0, (v) => v.pad[0], 'padR'],
      [1, X(7), Y(8.5), (v) => v.B.x <= 200 || v.B.y <= 100 || v.B.x >= 290, 'left'],
      [1, X(7), Y(1.5), (v) => v.B.y <= 86 || v.B.x >= 290, 'upLeft'],
      [1, X(13), Y(1.5), (v) => v.B.x >= 300, 'over'],
      [1, X(13), Y(4.5), (v) => (v.B.y >= 134 && v.B.x >= 300) || v.B.x >= 370, 'comeDown'],
      [1, X(16), Y(5), (v) => v.B.x >= 372, 'thru'],
      [1, X(17), Y(8), (v) => v.B.y >= 215, 'down'],
      [1, 'pad', 1, (v) => v.pad[1], 'padB'],
    ],
  },
];
const ROOM_COUNT = ROOMS.length;

// --- Geometry ---

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const tileRect = (c, r) => ({ x: c * T, y: TOP + r * T, w: T, h: T });
const overlap = (a, b, g = 0) =>
  a.x < b.x + b.w + g && a.x + a.w > b.x - g && a.y < b.y + b.h + g && a.y + a.h > b.y - g;

// Does segment a-b cross the interior of `r` grown by `g`? (negative g shrinks it)
export function segHitsRect(a, b, r, g = 0) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  // Liang-Barsky clipping against the four sides: [direction, distance to that side].
  const sides = [-dx, dx, -dy, dy];
  const gaps = [a.x - r.x + g, r.x + r.w + g - a.x, a.y - r.y + g, r.y + r.h + g - a.y];
  for (let k = 0; k < 4; k++) {
    if (sides[k] === 0) {
      if (gaps[k] <= 0) return false;
      continue;
    }
    const t = gaps[k] / sides[k];
    if (sides[k] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const worlds = new Map();
// Static, immutable description of one room (walls, posts, hazards, wrap points).
function worldOf(index) {
  if (worlds.has(index)) return worlds.get(index);
  const room = ROOMS[index];
  const at = (c, r) => room.map[r]?.[c] ?? '#';
  const walls = [],
    hazards = [],
    pegs = [],
    gates = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      if (ch === '#') walls.push(tileRect(c, r));
      else if (ch === 'x') hazards.push(tileRect(c, r));
      else if (ch === 'A' || ch === 'B') (gates[ch] ||= []).push(tileRect(c, r));
    }
  for (let j = 1; j < ROWS; j++)
    for (let i = 1; i < COLS; i++) {
      const a = at(i - 1, j - 1) === '#',
        b = at(i, j - 1) === '#',
        c = at(i - 1, j) === '#',
        d = at(i, j) === '#';
      const n = a + b + c + d;
      if (n === 1 || (n === 2 && a === d)) pegs.push({ x: i * T, y: TOP + j * T, post: -1 });
    }
  // A pit is a thin continuous live ring round a plate tile: a 22 px robot cannot step inside,
  // but the cable can lie across it.
  for (const { c, r } of room.rings || []) {
    const x = c * T,
      y = TOP + r * T,
      k = RULES.ring;
    hazards.push(
      { x: x - k, y: y - k, w: T + 2 * k, h: k },
      { x: x - k, y: y + T, w: T + 2 * k, h: k },
      { x: x - k, y: y, w: k, h: T },
      { x: x + T, y: y, w: k, h: T },
    );
  }
  const relayList = room.relays || [];
  const posts = [...room.posts, ...relayList].map((p, index) => {
    const x = X(p.c),
      y = Y(p.r),
      h = RULES.post / 2;
    for (let k = 0; k < 4; k++) {
      const dx = k === 1 || k === 2 ? 1 : -1,
        dy = k > 1 ? 1 : -1;
      pegs.push({ x: x + dx * h, y: y + dy * h, post: index });
    }
    return { x: x - h, y: y - h, w: RULES.post, h: RULES.post, cx: x, cy: y, gate: p.gate || null };
  });
  const world = {
    room,
    walls,
    hazards,
    pegs,
    gates,
    posts,
    relayFirst: room.posts.length,
    plates: room.plates.map((p) => ({
      ...p,
      x: X(p.c) - RULES.plate / 2,
      y: Y(p.r) - RULES.plate / 2,
      w: RULES.plate,
      h: RULES.plate,
    })),
    pads: [0, 2].map((i) => ({ cx: X(room.pads[i]), cy: Y(room.pads[i + 1]) })),
  };
  worlds.set(index, world);
  return world;
}

// --- State ---

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    cells: RULES.cells,
    room: 0,
    active: 0,
    mode: env.mode === 2 ? 2 : 1,
    ticks: 0,
    acc: 0,
    msg: null,
    zap: null,
    shown: null,
    shownAge: 0,
    paid: {},
    stats: { zaps: 0, snags: 0, rooms: 0 },
  };
  loadRoom(s, 0);
  return s;
}

export function loadRoom(s, index) {
  const w = worldOf(index);
  s.room = index;
  s.robots = [0, 2].map((i) => ({
    x: X(w.room.start[i]),
    y: Y(w.room.start[i + 1]),
    vx: 0,
    vy: 0,
  }));
  s.len = w.room.len;
  s.bends = [];
  s.sides = [];
  s.open = {};
  s.latched = {};
  s.lit = w.plates.map(() => false);
  s.freeze = 0;
  s.stage = 0;
  s.wrapped = false;
  s.taut = false;
  for (const id of Object.keys(w.gates)) s.open[id] = false;
  s.shown = null;
  refreshPrompt(s, w);
}

const robotRect = (r) => ({ x: r.x - H, y: r.y - H, w: RULES.robot, h: RULES.robot });
const pointsOf = (s, w) => [
  { x: s.robots[0].x, y: s.robots[0].y },
  ...s.bends.map((i) => w.pegs[i]),
  { x: s.robots[1].x, y: s.robots[1].y },
];
const lengthOf = (pts) => {
  let sum = 0;
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
};
// A locked relay sinks into the floor: it stops being a solid post or a wrap point.
const retracted = (s, w, i) => i >= w.relayFirst && !!s.latched[w.posts[i].gate];
const solidsOf = (s, w, withGates = true) => {
  const list = [...w.walls, ...w.posts.filter((_, i) => !retracted(s, w, i))];
  if (withGates)
    for (const [id, cells] of Object.entries(w.gates)) if (!s.open[id]) list.push(...cells);
  return list;
};

// --- Cable: wraps convex wall/post corners, releases them when it can run straight ---

// Is the straight line a-b blocked by a solid (grown a hair so a tangent line still counts)?
function lineBlocked(a, b, solids, grow = 0.01) {
  const box = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
  return solids.some((r) => overlap(box, r, 0.5) && segHitsRect(a, b, r, grow));
}

function updateCable(s, w, old, solids) {
  const freed = new Set();
  for (let again = true; again;) {
    again = false;
    const pts = pointsOf(s, w);
    for (let k = 0; k < s.bends.length; k++) {
      const a = pts[k],
        g = pts[k + 1],
        b = pts[k + 2];
      if (s.sides[k] * cross(g.x - a.x, g.y - a.y, b.x - g.x, b.y - g.y) <= EPS) {
        freed.add(s.bends[k]);
        s.bends.splice(k, 1);
        s.sides.splice(k, 1);
        again = true;
        break;
      }
    }
  }
  for (let guard = 0; guard < 8; guard++) {
    const pts = pointsOf(s, w);
    const before = [old[0], ...pts.slice(1, -1), old[1]];
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i],
        q1 = pts[i + 1],
        p0 = before[i],
        q0 = before[i + 1];
      const len2 = (q1.x - p1.x) ** 2 + (q1.y - p1.y) ** 2;
      if (len2 < EPS || (p0 === p1 && q0 === q1)) continue;
      for (let j = 0; j < w.pegs.length; j++) {
        const g = w.pegs[j];
        if (freed.has(j) || j === s.bends[i - 1] || j === s.bends[i]) continue;
        if (g.post >= 0 && retracted(s, w, g.post)) continue;
        const so = cross(q0.x - p0.x, q0.y - p0.y, g.x - p0.x, g.y - p0.y);
        const sn = cross(q1.x - p1.x, q1.y - p1.y, g.x - p1.x, g.y - p1.y);
        // |so| below the noise floor means the peg already lay on the old segment: not a crossing.
        if (!((so > SIDE_EPS && sn <= 0) || (so < -SIDE_EPS && sn >= 0))) continue;
        const t = ((g.x - p1.x) * (q1.x - p1.x) + (g.y - p1.y) * (q1.y - p1.y)) / len2;
        if (t <= 0 || t >= 1) continue;
        // Only a segment pushed INTO a solid needs a bend: a clear line needs none, and one already
        // inside (within tolerance) is leaving the wall, not being caught by the corner.
        if (!lineBlocked(p1, q1, solids) || lineBlocked(p0, q0, solids, -0.001)) continue;
        const frac = Math.abs(so) / (Math.abs(so) + Math.abs(sn));
        if (!best || frac < best.frac) best = { i, j, frac, side: so > 0 ? 1 : -1 };
      }
    }
    if (!best) return;
    s.bends.splice(best.i, 0, best.j);
    s.sides.splice(best.i, 0, best.side);
  }
}

function cableClear(pts, solids) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const box = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
    for (const r of solids) if (overlap(box, r) && segHitsRect(a, b, r, -0.5)) return false;
  }
  return true;
}

// --- Simulation tick ---

function readCommand(input, s) {
  const axis = (neg, pos) => (input.held(...pos) ? 1 : 0) - (input.held(...neg) ? 1 : 0);
  const dirs =
    s.mode === 2
      ? [
          { dx: axis(['KeyA'], ['KeyD']), dy: axis(['KeyW'], ['KeyS']) },
          { dx: axis(['ArrowLeft'], ['ArrowRight']), dy: axis(['ArrowUp'], ['ArrowDown']) },
        ]
      : [0, 1].map((i) =>
          i === s.active
            ? {
                dx: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
                dy: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
              }
            : { dx: 0, dy: 0 },
        );
  const reel = (input.held('KeyF', 'Comma') ? 1 : 0) - (input.held('KeyG', 'Period') ? 1 : 0);
  return { dirs, reel };
}

// Corner assist: a robot that clips a wall corner by a few pixels is eased around it.
const CORNER = 4;
function slide(robot, dx, dy, solids, other) {
  const blockers = other ? [...solids, other] : solids;
  for (const axis of ['x', 'y']) {
    const d = axis === 'x' ? dx : dy;
    if (!d) continue;
    const side = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'w' : 'h';
    const sideSize = axis === 'x' ? 'h' : 'w';
    const start = robot[axis];
    robot[axis] += d;
    const hit = blockers.find((b) => overlap(robotRect(robot), b, -1e-6));
    if (!hit) continue;
    // Stop at the blocker's face, but never move farther than the requested step.
    const edge = d > 0 ? hit[axis] - H : hit[axis] + hit[size] + H;
    robot[axis] =
      d > 0
        ? Math.min(start + d, Math.max(start, edge))
        : Math.max(start + d, Math.min(start, edge));
    robot['v' + axis] = 0;
    const depth = Math.min(
      robot[side] + H - hit[side],
      hit[side] + hit[sideSize] - (robot[side] - H),
    );
    if (depth <= 0 || depth > CORNER) continue;
    const away = robot[side] < hit[side] + hit[sideSize] / 2 ? -1 : 1;
    const saved = robot[side];
    robot[side] += away * Math.min(depth, Math.abs(d) * 1.5);
    if (blockers.some((b) => overlap(robotRect(robot), b, -1e-6))) robot[side] = saved;
  }
}

function tick(s, cmd, emit) {
  const w = worldOf(s.room);
  s.ticks++;
  s.shownAge += STEP;
  if (s.msg && (s.msg.left -= STEP) <= 0) s.msg = null;
  if (s.zap && (s.zap.left -= STEP) <= 0) s.zap = null;
  if (s.freeze > 0) {
    s.freeze = Math.max(0, s.freeze - STEP);
    refreshPrompt(s, w);
    return;
  }
  const before = s.robots.map((r) => ({ ...r }));
  const snapshot = { bends: [...s.bends], sides: [...s.sides] };
  // Winch: reeling in can only take up slack; paying out never moves a robot.
  const pts0 = pointsOf(s, w);
  const path0 = lengthOf(pts0);
  if (cmd.reel > 0) s.len = Math.max(RULES.minLen, path0, s.len - RULES.reel * STEP);
  if (cmd.reel < 0) s.len = Math.min(w.room.len, s.len + RULES.reel * STEP);
  // Accelerate toward the commanded velocity.
  s.robots.forEach((r, i) => {
    const d = cmd.dirs[i];
    const norm = d.dx && d.dy ? Math.SQRT1_2 : 1;
    const da = RULES.accel * STEP;
    r.vx += Math.max(-da, Math.min(da, d.dx * norm * RULES.speed - r.vx));
    r.vy += Math.max(-da, Math.min(da, d.dy * norm * RULES.speed - r.vy));
    const speed = Math.hypot(r.vx, r.vy);
    if (speed > RULES.speed) {
      r.vx *= RULES.speed / speed;
      r.vy *= RULES.speed / speed;
    }
  });
  limitTension(s, pts0, path0);
  const solids = solidsOf(s, w);
  // Robots resolve one after the other against the partner's current position; the order alternates.
  for (const i of s.ticks % 2 ? [1, 0] : [0, 1]) {
    const r = s.robots[i];
    slide(r, r.vx * STEP, r.vy * STEP, solids, robotRect(s.robots[1 - i]));
  }
  // Wrap points belong to fixed walls and posts, so a gate's state never decides a wrap.
  updateCable(s, w, before, solidsOf(s, w, false));
  pullIn(s, w, solids);
  const pts = pointsOf(s, w);
  if (!cableClear(pts, solids) || lengthOf(pts) > s.len + RULES.stretchTol) {
    // The cable would be dragged through a wall (or stretched): it snags and nothing moves.
    s.robots.forEach((r, i) => Object.assign(r, before[i], { vx: 0, vy: 0 }));
    s.bends = snapshot.bends;
    s.sides = snapshot.sides;
    s.stats.snags++;
  }
  if (checkHazards(s, w, emit)) return;
  updateSwitches(s, w, emit);
  if (padsReached(s, w)) clearRoom(s, emit);
  else refreshPrompt(s, w);
}

// Remove only the velocity that would stretch the cable; the energy is dissipated, never added.
function limitTension(s, pts, path) {
  const slack = s.len - path;
  const dirs = [unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2])];
  const out = s.robots.map((r, i) => Math.max(0, r.vx * dirs[i].x + r.vy * dirs[i].y));
  const want = (out[0] + out[1]) * STEP;
  if (want <= 1e-12 || want <= slack) return;
  const keep = Math.max(0, slack) / want;
  s.robots.forEach((r, i) => {
    const cut = out[i] * (1 - keep);
    r.vx -= cut * dirs[i].x;
    r.vy -= cut * dirs[i].y;
  });
}
const unit = (from, to) => {
  const d = Math.hypot(from.x - to.x, from.y - to.y) || 1;
  return { x: (from.x - to.x) / d, y: (from.y - to.y) / d };
};

// Second-order tangential drift is removed by pulling both robots symmetrically along their segments.
function pullIn(s, w, solids) {
  for (let pass = 0; pass < 4; pass++) {
    const pts = pointsOf(s, w);
    const excess = lengthOf(pts) - s.len;
    if (excess <= 1e-7) return;
    const dirs = [unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2])];
    s.robots.forEach((r, i) => {
      const o = s.robots[1 - i];
      slide(r, (-dirs[i].x * excess) / 2, (-dirs[i].y * excess) / 2, solids, robotRect(o));
    });
  }
}

function checkHazards(s, w, emit) {
  // Both robots are tested the same way; a simultaneous touch costs one cell and names both.
  const hits = [0, 1].filter((i) =>
    w.hazards.some((h) => overlap(robotRect(s.robots[i]), h, -0.5)),
  );
  if (!hits.length) return false;
  s.cells--;
  s.stats.zaps++;
  const [first] = hits;
  s.zap = { x: s.robots[first].x, y: s.robots[first].y, who: hits, left: 0.6 };
  emit('hit');
  if (s.cells <= 0) {
    s.phase = 'lost';
    return true;
  }
  const zap = s.zap;
  loadRoom(s, s.room);
  s.zap = zap;
  s.freeze = RULES.freeze;
  const name = (lang) =>
    hits.length > 1 ? (lang === 'en' ? 'Both robots' : '两个机器人') : NAMES[first][lang];
  say(
    s,
    `${name('en')} touched a live strip. Room reset, ${s.cells} ${s.cells === 1 ? 'cell' : 'cells'} left`,
    `${name('zh')}碰到带电条。房间重置，剩余${s.cells}格电量`,
  );
  return true;
}

function say(s, en, zh) {
  s.msg = { en, zh, left: RULES.msgTime };
}

function updateSwitches(s, w, emit) {
  const pts = pointsOf(s, w);
  const touches = (r, g = 0) => {
    for (let i = 1; i < pts.length; i++) if (segHitsRect(pts[i - 1], pts[i], r, g)) return true;
    return false;
  };
  const powered = {};
  w.plates.forEach((p, i) => {
    s.lit[i] = touches(p);
    if (s.lit[i]) powered[p.gate] = true;
  });
  const taut = lengthOf(pts) >= s.len - RULES.tautEps;
  s.taut = taut;
  s.wrapped = s.bends.some((b) => w.pegs[b].post >= w.relayFirst);
  w.posts.forEach((p, i) => {
    if (i < w.relayFirst || s.latched[p.gate] || !taut) return;
    if (s.bends.some((b) => w.pegs[b].post === i)) {
      s.latched[p.gate] = true;
      const keep = s.bends.map((b) => w.pegs[b].post !== i);
      s.sides = s.sides.filter((_, k) => keep[k]);
      s.bends = s.bends.filter((_, k) => keep[k]);
      emit('coin');
      say(s, `Relay locked: gate ${p.gate} stays open`, `继电器已锁定：闸门${p.gate}保持开启`);
    }
  });
  for (const [id, cells] of Object.entries(w.gates)) {
    const held =
      s.open[id] &&
      cells.some(
        (c) =>
          s.robots.some((r) => overlap(robotRect(r), c, RULES.gateGrow)) ||
          touches(c, RULES.gateGrow),
      );
    const next = !!(powered[id] || s.latched[id] || held);
    if (next && !s.open[id]) {
      emit('move');
      if (!s.paid[`${s.room}${id}`]) {
        s.paid[`${s.room}${id}`] = true;
        s.score += RULES.gateScore;
        if (!s.latched[id]) say(s, `Gate ${id} opens`, `闸门${id}开启`);
      }
    }
    s.open[id] = next;
  }
}

const onPad = (r, pad) =>
  Math.abs(r.x - pad.cx) <= RULES.padReach && Math.abs(r.y - pad.cy) <= RULES.padReach;
const padsReached = (s, w) => s.robots.every((r, i) => onPad(r, w.pads[i]));

function clearRoom(s, emit) {
  s.score += RULES.roomScore + RULES.cellScore * s.cells;
  s.stats.rooms++;
  if (s.room + 1 >= ROOM_COUNT) {
    s.phase = 'won';
    return;
  }
  emit('coin');
  const index = s.room + 1;
  const had = s.cells;
  s.cells = Math.min(RULES.cells, s.cells + 1);
  loadRoom(s, index);
  s.active = 0;
  say(
    s,
    `Room ${index} clear! ${had === s.cells ? '' : 'A cell recharges. '}Next room`,
    `第${index}间完成！${had === s.cells ? '' : '回复一格电量。'}进入下一间`,
  );
}

// --- Prompts: one current objective, held for at least half a second ---

function viewOf(s, w) {
  return {
    R: s.robots[0],
    B: s.robots[1],
    open: s.open,
    latched: s.latched,
    len: s.len,
    max: w.room.len,
    wrapped: !!s.wrapped,
    pad: s.robots.map((r, i) => onPad(r, w.pads[i])),
    near: (i, x, y, d) => Math.hypot(s.robots[i].x - x, s.robots[i].y - y) <= d,
  };
}

// Progress through a room's guide only moves forward (a hold can send it back), so the prompt
// never flickers when a robot wobbles near a threshold.
function objective(s, w) {
  const v = viewOf(s, w),
    steps = w.room.steps;
  for (const [from, to, ok, back] of w.room.holds || [])
    if (s.stage >= from && s.stage <= to && !ok(v)) s.stage = back;
  while (s.stage < steps.length && steps[s.stage][3](v)) s.stage++;
  if (s.stage < steps.length) {
    const [who, x, y, , key] = steps[s.stage];
    const pad = x === 'pad' ? w.pads[y] : null;
    return { index: s.stage, who, x: pad ? pad.cx : x, y: pad ? pad.cy : y, key };
  }
  // Guide finished: point at whichever robot is not (or no longer) on its pad.
  const i = Math.max(
    0,
    s.robots.findIndex((r, k) => !onPad(r, w.pads[k])),
  );
  return {
    index: steps.length + i,
    who: i,
    x: w.pads[i].cx,
    y: w.pads[i].cy,
    key: i ? 'padB' : 'padR',
  };
}

function promptFor(s, w) {
  let o = objective(s, w);
  // A reeled-in, taut cable is the only thing that can stop a robot short of its marker: say how to recover.
  const solo = s.mode !== 2;
  if (o.who >= 0 && s.taut && s.len < w.room.len - 5)
    return {
      who: -1,
      x: null,
      y: null,
      id: `${s.room}:taut`,
      en: solo ? 'Cable taut: hold G to pay out' : 'Cable taut: hold G (Red) / . (Blue) to pay out',
      zh: solo ? '电缆已绷紧：按住G放线' : '电缆已绷紧：红按住G／蓝按住.放线',
    };
  [o.en, o.zh] = TXT[o.key];
  const base = { who: o.who, x: o.who < 0 ? null : o.x, y: o.who < 0 ? null : o.y };
  if (o.who < 0) {
    const reel = o.y === 0;
    return {
      ...base,
      id: `${s.room}:${o.index}`,
      en: solo
        ? `Hold ${reel ? 'F' : 'G'}: ${o.en}`
        : `Hold ${reel ? 'F or ,' : 'G or .'}: ${o.en}`,
      zh: solo ? `按住${reel ? 'F' : 'G'}：${o.zh}` : `按住${reel ? 'F或,' : 'G或.'}：${o.zh}`,
    };
  }
  const nm = NAMES[o.who];
  if (solo && s.active !== o.who)
    return {
      ...base,
      id: `${s.room}:${o.index}:x`,
      en: `Press X to control ${nm.en}`,
      zh: `按 X 切换到${nm.zh}`,
    };
  const k = solo ? { en: 'WASD', zh: 'WASD' } : KEYS[o.who];
  return {
    ...base,
    id: `${s.room}:${o.index}`,
    en: `${nm.en}${solo ? '' : ` (${k.en})`}: ${o.en}${solo ? ' (WASD)' : ''}`,
    zh: `${nm.zh}${solo ? '' : `（${k.zh}）`}：${o.zh}${solo ? '（WASD）' : ''}`,
  };
}

function refreshPrompt(s, w) {
  const next = promptFor(s, w);
  if (!s.shown || (next.id !== s.shown.id && s.shownAge >= RULES.promptHold)) {
    s.shown = next;
    s.shownAge = 0;
  }
}

// --- Public update loop ---

const STILL = { dx: 0, dy: 0 };
const IDLE_COMMAND = { dirs: [STILL, STILL], reel: 0 };

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.mode !== 2 && input.pressed('KeyX') && s.freeze <= 0) {
    s.active = 1 - s.active;
    emit('move');
    say(s, `Now controlling ${NAMES[s.active].en}`, `现在控制${NAMES[s.active].zh}`);
  }
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  // The command is read per tick so a mid-update room change or freeze end behaves the same at any frame rate.
  for (let n = 0; n < steps && s.phase === 'playing'; n++)
    tick(s, s.freeze > 0 ? IDLE_COMMAND : readCommand(input, s), emit);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      if (!advance(s, dt, input, emit) && s.phase === 'playing') return;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        emit(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'All three rooms are wired. The twins are home!',
                '三个房间全部接通，双子顺利回家！',
              )
            : env.t(
                'The cells ran dry. Keep the robots off live strips and try again.',
                '电量耗尽。让机器人远离带电条，再试一次。',
              ),
        });
      }
    },
    draw(ctx) {
      drawGame(ctx, s, env);
    },
    getState() {
      return snapshotOf(s, env);
    },
  };
}

export function snapshotOf(s) {
  const w = worldOf(s.room);
  const pts = pointsOf(s, w);
  const path = lengthOf(pts);
  const shown = s.shown;
  const shownText = s.msg || shown;
  const who = s.mode === 2 ? { en: 'Both', zh: '双人' } : NAMES[s.active];
  const label = (lang) =>
    `${lang === 'en' ? 'Room' : '房间'} ${s.room + 1}/${ROOM_COUNT} · ${lang === 'en' ? 'Active' : '当前'}: ${who[lang]} · ${shownText[lang]}`;
  const finished = s.phase !== 'playing';
  const end = {
    won: { en: 'All rooms wired!', zh: '全部接通！' },
    lost: { en: 'Cells empty', zh: '电量耗尽' },
  }[s.phase];
  return {
    phase: s.phase,
    score: s.score,
    cells: s.cells,
    time: s.ticks * STEP,
    mode: s.mode,
    room: s.room + 1,
    rooms: ROOM_COUNT,
    roomName: w.room.name,
    active: s.mode === 2 ? 'both' : s.active === 0 ? 'red' : 'blue',
    robots: s.robots.map((r, i) => ({
      id: i === 0 ? 'red' : 'blue',
      x: r.x,
      y: r.y,
      vx: r.vx,
      vy: r.vy,
      rect: robotRect(r),
      onPad: onPad(r, w.pads[i]),
    })),
    cable: {
      path: pts.map((p) => ({ x: p.x, y: p.y })),
      bends: [...s.bends],
      length: path,
      max: s.len,
      spool: w.room.len,
      slack: Math.max(0, s.len - path),
      tension: s.len > 0 ? Math.min(1, path / s.len) : 1,
      taut: path >= s.len - RULES.tautEps,
    },
    gates: Object.fromEntries(
      Object.entries(w.gates).map(([id, c]) => [
        id,
        { open: !!s.open[id], cells: c.map((x) => ({ ...x })) },
      ]),
    ),
    plates: w.plates.map((p, i) => ({ ...p, lit: !!s.lit[i] })),
    posts: w.posts.map((p, i) => ({
      ...p,
      relay: i >= w.relayFirst,
      latched: !!(p.gate && s.latched[p.gate]),
    })),
    hazards: w.hazards.map((h) => ({ ...h })),
    solids: solidsOf(s, w).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    pads: w.pads.map((p) => ({ ...p })),
    hint: finished
      ? null
      : { who: shown.who < 0 ? 'any' : shown.who === 0 ? 'red' : 'blue', x: shown.x, y: shown.y },
    prompt: { en: shown.en, zh: shown.zh },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    zap: s.zap ? { x: s.zap.x, y: s.zap.y, who: [...s.zap.who] } : null,
    stats: { ...s.stats },
    hud: { top: [0, TOP], bottom: [RULES.bottom, 320] },
    status: finished
      ? { en: `${end.en} Score ${s.score}`, zh: `${end.zh} 得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const COLORS = ['#ff5a4f', '#4aa8ff'];
const ROBOT = [
  '.....a.....',
  '.....o.....',
  '..ooooooo..',
  '.obbbbbbbo.',
  '.obvvvvvbo.',
  '.obvevevbo.',
  '.obvvvvvbo.',
  '.obbbbbbbo.',
  '..ooooooo..',
  '.wwwo.owww.',
  '.wwwo.owww.',
];

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

function drawFloor(ctx, w) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      box(ctx, (c + r) % 2 ? '#18233a' : '#1b2842', c * T, TOP + r * T, T, T);
  for (const r of w.walls) {
    box(ctx, '#4a5a80', r.x, r.y, r.w, r.h);
    box(ctx, '#6a7ca6', r.x, r.y, r.w, 3);
    box(ctx, '#6a7ca6', r.x + 3, r.y + 7, 2, 2);
    box(ctx, '#2d3956', r.x, r.y + r.h - 3, r.w, 3);
  }
}

function drawHazards(ctx, w, t) {
  const phase = Math.floor(t * 12) % 3;
  for (const h of w.hazards) {
    box(ctx, '#22232b', h.x, h.y, h.w, h.h);
    for (let k = 0; k < Math.max(h.w, h.h); k += 8) {
      if (h.w >= h.h) box(ctx, '#ffd23f', h.x + k, h.y + ((k >> 3) % 2) * (h.h - 3), 4, 3);
      else box(ctx, '#ffd23f', h.x + ((k >> 3) % 2) * (h.w - 3), h.y + k, 3, 4);
    }
    if (h.w >= T && h.h >= T) {
      box(ctx, '#fff6b0', h.x + 3 + phase * 6, h.y + 4, 3, 6);
      box(ctx, '#fff6b0', h.x + 9 + phase * 3, h.y + 11, 3, 6);
    } else
      box(ctx, '#fff6b0', h.x + ((phase * 11) % Math.max(1, h.w - 3)), h.y, 3, Math.min(h.h, 3));
  }
}

function drawGates(ctx, s, w) {
  for (const [id, cells] of Object.entries(w.gates)) {
    const open = !!s.open[id];
    for (const c of cells) {
      if (open) {
        box(ctx, '#2f9e6a', c.x, c.y, 4, c.h);
        box(ctx, '#2f9e6a', c.x + c.w - 4, c.y, 4, c.h);
      } else {
        box(ctx, '#7a4a4a', c.x, c.y, c.w, c.h);
        for (let k = 0; k < c.h; k += 8) box(ctx, '#ffcf4a', c.x + 3, c.y + k, c.w - 6, 4);
      }
    }
    text(ctx, id, cells[0].x + 8, cells[0].y - 18, open ? '#7dffb0' : '#ffb0b0', 14);
  }
}

function drawPosts(ctx, s, w) {
  w.posts.forEach((p, i) => {
    const relay = i >= w.relayFirst;
    if (relay && s.latched[p.gate]) {
      box(ctx, '#2a4a3c', p.x, p.y, p.w, p.h);
      box(ctx, '#5dff9d', p.x + 4, p.y + 4, 8, 8);
      return;
    }
    box(ctx, '#d7deea', p.x, p.y, p.w, p.h);
    box(ctx, '#6b7a99', p.x, p.y + 4, p.w, 3);
    box(ctx, '#6b7a99', p.x, p.y + 10, p.w, 3);
    box(ctx, '#2b3550', p.x, p.y, p.w, 2);
    box(ctx, '#2b3550', p.x, p.y + p.h - 2, p.w, 2);
    if (relay) box(ctx, s.wrapped && s.taut ? '#ffe14a' : '#ff9d3f', p.x + 4, p.y + 4, 8, 8);
  });
}

function drawPlates(ctx, s, w, t) {
  w.plates.forEach((p, i) => {
    box(ctx, s.lit[i] ? '#79f5ff' : '#1f6a78', p.x, p.y, p.w, p.h);
    const mark = s.lit[i] ? '#ffffff' : '#0f3a44';
    box(ctx, mark, p.x + 8, p.y + 3, 4, 14);
    box(ctx, mark, p.x + 3, p.y + 8, 14, 4);
    if (s.lit[i] && Math.floor(t * 8) % 2) box(ctx, mark, p.x - 2, p.y - 2, 4, 4);
  });
}

function drawPads(ctx, s, w) {
  w.pads.forEach((p, i) => {
    box(ctx, COLORS[i], p.cx - 12, p.cy - 12, 24, 24);
    box(ctx, '#10182a', p.cx - 9, p.cy - 9, 18, 18);
    box(ctx, onPad(s.robots[i], p) ? '#ffffff' : COLORS[i], p.cx - 3, p.cy - 3, 6, 6);
  });
}

// Taut: thick red/white stripes. Slack: thin yellow/navy stripes with a gentle wave.
function drawCable(ctx, s, w, t) {
  const pts = pointsOf(s, w);
  const path = lengthOf(pts);
  const taut = path >= s.len - RULES.tautEps;
  const wave = taut ? 0 : Math.min(4, (s.len - path) * 0.05);
  const [a, b] = taut ? ['#ff5a4f', '#fff3a0'] : ['#ffd23f', '#2a3a5c'];
  const size = taut ? 5 : 3;
  let travelled = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1],
      q = pts[i];
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    for (let u = 0; u < d; u += 4) {
      const off = Math.sin((travelled + u) / 7 + t * (taut ? 30 : 3)) * wave;
      const x = p.x + ((q.x - p.x) * u) / d - ((q.y - p.y) / d) * off;
      const y = p.y + ((q.y - p.y) * u) / d + ((q.x - p.x) / d) * off;
      box(ctx, Math.floor((travelled + u) / 4) % 2 ? a : b, x - size / 2, y - size / 2, size, size);
    }
    travelled += d;
  }
  for (const idx of s.bends) box(ctx, '#ffffff', w.pegs[idx].x - 2, w.pegs[idx].y - 2, 4, 4);
}

function drawRobot(ctx, s, i, t) {
  const r = s.robots[i];
  const active = s.mode === 2 || s.active === i;
  const flash = s.zap && s.zap.who.includes(i) && Math.floor(t * 16) % 2;
  const body = flash ? '#ffffff' : active ? COLORS[i] : IDLE[i];
  const x = Math.round(r.x - H),
    y = Math.round(r.y - H) + (active ? Math.round(Math.sin(t * 8)) : 0);
  if (active) box(ctx, 'rgba(255,255,255,0.25)', x - 2, y + 20, 26, 4);
  const palette = { o: '#0b1020', b: body, v: '#14203a', e: '#ffffff', w: '#394560' };
  pixelSprite(ctx, ROBOT, x, y, 2, { ...palette, a: active ? '#ffe14a' : '#88aaaa' });
  if (active && s.mode !== 2) {
    box(ctx, '#ffffff', x + 9, y - 8, 4, 3);
    box(ctx, '#ffffff', x + 10, y - 5, 2, 2);
  }
}
const IDLE = ['#a8433f', '#3a76ad'];

function drawFx(ctx, s, t) {
  if (!s.zap) return;
  const reach = 6 + (0.6 - s.zap.left) * 40;
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785 + t * 10;
    box(ctx, '#fff6b0', s.zap.x + Math.cos(a) * reach, s.zap.y + Math.sin(a) * reach, 4, 4);
  }
}

function drawHud(ctx, s, w, lang) {
  const t = s.ticks * STEP;
  box(ctx, '#0b1222', 0, 0, 480, TOP);
  box(ctx, '#0b1222', 0, RULES.bottom, 480, 320 - RULES.bottom);
  box(ctx, '#3a4a70', 0, TOP - 1, 480, 1);
  box(ctx, '#3a4a70', 0, RULES.bottom, 480, 1);
  text(ctx, `${s.room + 1}/${ROOM_COUNT} ${w.room.name[lang]}`, 8, 6, '#cfe0ff', 14);
  const path = lengthOf(pointsOf(s, w));
  const taut = path >= s.len - RULES.tautEps;
  box(ctx, '#26324f', 190, 7, 90, 12);
  box(ctx, taut ? '#ff5a4f' : '#4aa8ff', 191, 8, Math.round(88 * Math.min(1, path / s.len)), 10);
  const label = taut ? { en: 'TAUT', zh: '绷紧' } : { en: 'SLACK', zh: '松弛' };
  text(ctx, label[lang], 288, 6, taut ? '#ff9d8f' : '#9ccaff', 14);
  for (let i = 0; i < RULES.cells; i++) {
    box(ctx, i < s.cells ? '#7dffb0' : '#2a3a4a', 398 + i * 22, 7, 18, 12);
    box(ctx, '#0b1222', 416 + i * 22, 11, 2, 4);
  }
  const shown = s.msg || s.shown;
  text(ctx, shown[lang], 240, 297, s.msg ? '#ffe14a' : '#ffffff', 14, 'center');
  const m = s.shown;
  if (s.phase === 'playing' && m.x != null && Math.floor(t * 3) % 2 === 0) {
    const color = m.who === 0 ? COLORS[0] : m.who === 1 ? COLORS[1] : '#ffffff';
    box(ctx, color, m.x - 8, m.y - 1, 16, 2);
    box(ctx, color, m.x - 1, m.y - 8, 2, 16);
  }
}

function drawGame(ctx, s, env) {
  const w = worldOf(s.room);
  const t = s.ticks * STEP;
  background(ctx, '#0e1628');
  drawFloor(ctx, w);
  drawPads(ctx, s, w);
  drawPlates(ctx, s, w, t);
  drawHazards(ctx, w, t);
  drawGates(ctx, s, w);
  drawPosts(ctx, s, w);
  drawCable(ctx, s, w, t);
  drawRobot(ctx, s, 0, t);
  drawRobot(ctx, s, 1, t);
  drawFx(ctx, s, t);
  drawHud(ctx, s, w, env.lang === 'zh' ? 'zh' : 'en');
}
