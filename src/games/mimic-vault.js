import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'mimic-vault',
  name: { en: 'Mimic Vault', zh: '幻影宝库' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Press Space to record a short walk, press Space again to stop, then press X to send your translucent echo to repeat exactly those key presses. The echo is solid, obeys the same walls and closed doors as you, and can hold pressure plates while you slip past. Hold doors stay open only while a plate is pressed, timed doors stay open for a while after it, and some doors need two plates at once. Z clears the recording, then returns you to your checkpoint, then (once more than one room is unlocked) opens the vault list. Reach the exit of all 22 vault rooms; your progress is saved.',
    zh: '按空格键录下一小段行走，再按空格键停止，然后按 X 让半透明的幻影重复完全相同的按键。幻影是实体，和你一样会被墙壁和关闭的门挡住，还能替你压住踏板。常开门只在踏板被压住时开启，限时门在松开后会再开一阵，有些门需要两块踏板同时被压住。Z 先清除录制，再回到检查点，（解锁多于一间后）再打开宝库列表。走到全部 22 间宝库的出口，进度会被保存。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'WASD / Arrows' },
    { label: { en: 'Record / stop', zh: '录制 / 停止' }, keys: 'Space' },
    { label: { en: 'Replay the echo', zh: '回放幻影' }, keys: 'X' },
    { label: { en: 'Clear recording / checkpoint', zh: '清除录制 / 回检查点' }, keys: 'Z' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Record/Stop', '录制/停止', 'right'],
    ['KeyX', 'Replay', '回放', 'right'],
    ['KeyZ', 'Reset', '重置', 'right'],
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
  actor: 16,
  speed: 72,
  maxRec: 12,
  minRec: 0.5,
  think: 6,
  promptHold: 0.5,
  markerReach: 6,
  msgTime: 1.6,
  introTime: 3.4,
  freeze: 0.8,
  stall: 6,
  roomScore: 600,
  bonusMax: 300,
  bonusPenalty: 100,
});
const { tile: T, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
const HALF = RULES.actor / 2;
const MAX_TICKS = Math.round(RULES.maxRec / STEP);
const MIN_TICKS = Math.round(RULES.minRec / STEP);
const DIAG = Math.SQRT1_2;
const MENU_COLS = 11;
const LEFT = 1;
const RIGHT = 2;
const UP = 4;
const DOWN = 8;
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const px = (c) => c * T + T / 2;
const py = (r) => TOP + r * T + T / 2;
const tileOf = (a) => [Math.floor(a.x / T), Math.floor((a.y - TOP) / T)];
const inTile = (a, [c, r]) => tileOf(a)[0] === c && tileOf(a)[1] === r;
const near = (a, [c, r]) => Math.hypot(a.x - px(c), a.y - py(r)) < 32;
const touches = (x, y, c, r) =>
  x - HALF < (c + 1) * T &&
  x + HALF > c * T &&
  y - HALF < TOP + (r + 1) * T &&
  y + HALF > TOP + r * T;

const TXT = {
  rec: ['Press Space to start recording', '按空格键开始录制'],
  stop: ['Press Space to stop recording', '按空格键停止录制'],
  plate: ['Step onto the marked plate (Arrows)', '走上标记的踏板（方向键）'],
  start: ['Return to the start marker (Arrows)', '回到起点标记（方向键）'],
  replay: ['Press X to replay your recording', '按 X 回放你的录制'],
  wait: ['Stand still: your echo opens the way', '站着别动：幻影会为你开路'],
  walk: ['Follow the marker (Arrows)', '跟着标记走（方向键）'],
  exit: ['Head for the glowing exit (Arrows)', '前往发光的出口（方向键）'],
  checkpoint: ['Move to the next marker (Arrows)', '前往下一个标记（方向键）'],
  bad: ['Missed the plate: press Z to clear it', '没踩到踏板：按 Z 清除录制'],
  missed: ['The echo missed the plate: press Z', '幻影没踩到踏板：按 Z 清除'],
  stall: ['Nothing is moving: press Z to clear', '毫无进展：按 Z 清除幻影'],
  menu: ['Pick a vault: Left / Right, then Space', '选择宝库：左 / 右，然后按空格'],
  stuck: ['Stuck? Press Z, then Z again to reset', '卡住了？按 Z，再按 Z 重置'],
};

// --- Rooms ---
// Rooms are written as compact stage specs and composed into a 20x11 map. Stages are laid out left to
// right, each closed by a wall with a door. Legend of the composed map: # wall, S start, X exit,
// a-e pressure plates, A-E doors. Doors open while all their plates are pressed (by you or the echo),
// stay open `hold` seconds longer, and never close on an actor. A leg is one record/replay cycle:
// `route` lists the plates the recording should visit (the last is where the echo must end) and
// `after` is what the player does while the echo works.
//   L  chain of zones, one plate per zone: z = {w: width, p: [col offset, row], d: door row}
//      (earlier doors are timed, the last one is held by the echo parked on its plate)
//   T  one zone with two plates {b, a} and a door that needs both: the echo holds b, you stand on a
//   P  the echo's route steps on timed plate p (door dA), then parks on q that holds door dB
// Every stage may carry `bars`: [column offset, first row, last row] wall segments.
const TIMED_HOLD = 6;
const PATROL_HOLD = 7;
const PAIR_HOLD = 10;

function compose({ start, stages }) {
  const g = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? '#' : '.',
    ),
  );
  const doors = {};
  const legs = [];
  let x = 1;
  let plates = 0;
  const nextPlate = () => String.fromCharCode(97 + plates++);
  const putPlate = (c, r) => {
    const id = nextPlate();
    g[r][c] = id;
    return id;
  };
  const putDoor = (col, row, needs, hold) => {
    const id = String.fromCharCode(65 + Object.keys(doors).length);
    doors[id] = { needs, hold };
    for (let r = 1; r < ROWS - 1; r++) g[r][col] = '#';
    g[row][col] = id;
  };
  let tail = null;
  for (const st of stages) {
    for (const [dc, r0, r1] of st.bars || []) for (let r = r0; r <= r1; r++) g[r][x + dc] = '#';
    if (st.k === 'L') {
      const route = [];
      st.zones.forEach((z, i) => {
        const at = [x + z.p[0], z.p[1]];
        const id = putPlate(...at);
        route.push(at);
        putDoor(x + z.w, z.d, [id], i < st.zones.length - 1 ? TIMED_HOLD : 0);
        x += z.w + 1;
        tail = [x, z.d];
      });
      legs.push({ route, after: [{ at: route.at(-1), wait: 'home' }, { at: tail }] });
    } else if (st.k === 'T') {
      const b = [x + st.b[0], st.b[1]];
      const a = [x + st.a[0], st.a[1]];
      const ids = [putPlate(...a), putPlate(...b)];
      putDoor(x + st.w, st.d, ids, PAIR_HOLD);
      x += st.w + 1;
      tail = [x, st.d];
      legs.push({ route: [b], after: [{ at: a, wait: 'open' }, { at: tail }] });
    } else {
      const p = [x + st.p[0], st.p[1]];
      const q = [x + st.q[0], st.q[1]];
      const ids = [putPlate(...p), putPlate(...q)];
      const wa = x + st.w;
      const wb = wa + 1 + st.tw;
      putDoor(wa, st.dA, [ids[0]], PATROL_HOLD);
      putDoor(wb, st.dB, [ids[1]], 0);
      x = wb + 1;
      tail = [x, st.dB];
      legs.push({
        route: [p, q],
        after: [
          { at: [wa - 1, st.dA], wait: 'open' },
          { at: [wb - 1, st.dB], wait: 'open' },
          { at: tail },
        ],
      });
    }
  }
  const exit = [Math.min(COLS - 2, x + 6), tail[1]];
  legs.at(-1).after.at(-1).at = exit;
  g[start[1]][start[0]] = 'S';
  g[exit[1]][exit[0]] = 'X';
  return { map: g.map((row) => row.join('')), doors, legs };
}

const L = (...zones) => ({ k: 'L', zones });
const z = (w, p, d) => ({ w, p, d });
const T2 = (w, b, a, d, bars) => ({ k: 'T', w, b, a, d, bars });
const P2 = (w, p, q, dA, tw, dB, bars) => ({ k: 'P', w, p, q, dA, tw, dB, bars });
const withBars = (stage, bars) => ({ ...stage, bars });

const ROOM_DEFS = [
  {
    name: ['First Echo', '初次回声'],
    tip: ['An echo can stand on a plate for you', '幻影能替你踩住踏板'],
    start: [2, 4],
    stages: [L(z(8, [2, 6], 4))],
  },
  {
    name: ['Around the Bend', '绕过拐角'],
    tip: ['The echo walks around walls like you', '幻影和你一样要绕开墙壁'],
    start: [2, 2],
    stages: [withBars(L(z(8, [5, 2], 8)), [[3, 1, 6]])],
  },
  {
    name: ['Winding Path', '蜿蜒小径'],
    tip: ['Recordings last 12 seconds at most', '录制最长 12 秒'],
    start: [2, 2],
    stages: [
      withBars(L(z(8, [6, 8], 2)), [
        [2, 1, 6],
        [5, 4, 9],
      ]),
    ],
  },
  {
    name: ['Passing Through', '穿门而过'],
    tip: ['A timed door stays open a while', '限时门松开后还会开一阵'],
    start: [2, 5],
    stages: [P2(6, [1, 2], [1, 8], 3, 5, 7)],
  },
  {
    name: ['Twin Plates', '双生踏板'],
    tip: ['Some doors need two plates at once', '有的门需要两块踏板同时被压住'],
    start: [2, 5],
    stages: [T2(9, [3, 2], [3, 8], 5)],
  },
  {
    name: ['Two Doors', '两扇门'],
    tip: ['Record again after each door', '每过一道门就重新录制'],
    start: [2, 5],
    stages: [L(z(6, [2, 2], 5)), L(z(6, [3, 8], 4))],
  },
  {
    name: ['Pillar Twins', '石柱双子'],
    tip: ['Plan the route around the pillar', '绕过石柱规划路线'],
    start: [2, 5],
    stages: [
      T2(9, [3, 2], [3, 8], 5, [
        [5, 4, 6],
        [6, 4, 6],
      ]),
    ],
  },
  {
    name: ['Timed Chain', '限时连锁'],
    tip: ['Your echo opens doors on its route', '幻影沿路线自己开门'],
    start: [2, 5],
    stages: [L(z(5, [1, 3], 7), z(6, [4, 3], 5))],
  },
  {
    name: ['Encore', '安可'],
    tip: ['Hold a door, then pair the plates', '先撑住门，再配对踏板'],
    start: [2, 5],
    stages: [L(z(5, [2, 2], 5)), T2(6, [2, 2], [2, 8], 5)],
  },
  {
    name: ['Back to Back', '背靠背'],
    tip: ['Pair first, then hold', '先配对，再撑门'],
    start: [2, 5],
    stages: [T2(6, [2, 2], [2, 8], 5), L(z(6, [3, 3], 6))],
  },
  {
    name: ['Dogleg Patrol', '曲折巡逻'],
    tip: ['Slip through the gap in time', '赶在门关前穿过窄缝'],
    start: [2, 5],
    stages: [
      P2(6, [1, 2], [1, 8], 5, 5, 3, [
        [3, 1, 4],
        [3, 6, 9],
      ]),
    ],
  },
  {
    name: ['Triple Hold', '三重撑门'],
    tip: ['Three doors, three recordings', '三道门，三次录制'],
    start: [2, 5],
    stages: [L(z(4, [1, 2], 5)), L(z(4, [1, 8], 3)), L(z(4, [2, 5], 7))],
  },
  {
    name: ['Long Patrol', '长巡逻'],
    tip: ['One route can open three doors', '一条路线能打开三道门'],
    start: [2, 5],
    stages: [L(z(4, [2, 3], 3), z(4, [3, 7], 7), z(4, [2, 3], 5))],
  },
  {
    name: ['Weave Twins', '编织双子'],
    tip: ['A long route: stay under 12 seconds', '路线很长：别超过 12 秒'],
    start: [2, 5],
    stages: [
      T2(12, [10, 2], [1, 8], 5, [
        [3, 1, 6],
        [7, 4, 9],
      ]),
    ],
  },
  {
    name: ['Patrol and Pair', '巡逻与配对'],
    tip: ['Timed doors first, then a pair', '先过限时门，再踩双踏板'],
    start: [2, 5],
    stages: [P2(5, [1, 2], [1, 8], 3, 3, 7), T2(5, [1, 2], [1, 8], 5)],
  },
  {
    name: ['Pair and Patrol', '配对与巡逻'],
    tip: ['A pair first, then timed doors', '先踩双踏板，再过限时门'],
    start: [2, 5],
    stages: [T2(5, [1, 2], [1, 8], 5), P2(5, [1, 2], [1, 8], 3, 3, 7)],
  },
  {
    name: ['Hall of Doors', '门厅'],
    tip: ['One recording per door chain', '每条门链录制一次'],
    start: [2, 5],
    stages: [L(z(4, [1, 2], 8), z(4, [2, 8], 3)), L(z(4, [2, 2], 5))],
  },
  {
    name: ['Twin Twice', '双重配对'],
    tip: ['Two pairs, two recordings', '两组双踏板，两次录制'],
    start: [2, 5],
    stages: [T2(6, [1, 2], [4, 8], 5), T2(6, [1, 8], [4, 2], 5)],
  },
  {
    name: ['Gauntlet', '考验'],
    tip: ['Hold first, then race the clock', '先撑门，再和时间赛跑'],
    start: [2, 5],
    stages: [L(z(3, [1, 2], 5)), P2(5, [1, 2], [1, 8], 4, 3, 6)],
  },
  {
    name: ['Echo Maze', '回声迷宫'],
    tip: ['The echo repeats every bump', '幻影会重复每次碰撞'],
    start: [2, 5],
    stages: [
      withBars(L(z(10, [7, 7], 3)), [
        [2, 1, 5],
        [4, 4, 9],
        [6, 1, 6],
      ]),
    ],
  },
  {
    name: ['Vault Heart', '宝库之心'],
    tip: ['Hold, pair and time: use all three', '撑住、配对、限时：三招合用'],
    map: [
      '####################',
      '#..a.....#..b......#',
      '#........#.........#',
      '#.S......A.........#',
      '#........#..c......#',
      '#################C##',
      '#....#...#.e.......#',
      '#.X..E...#.........#',
      '#....#...D.........#',
      '#....#...#....d....#',
      '####################',
    ],
    doors: {
      A: { needs: ['a'], hold: 0 },
      C: { needs: ['b', 'c'], hold: 8 },
      D: { needs: ['d'], hold: 7 },
      E: { needs: ['e'], hold: 0 },
    },
    legs: [
      { route: [[3, 1]], after: [{ at: [3, 1], wait: 'home' }, { at: [10, 3] }] },
      { route: [[12, 1]], after: [{ at: [12, 4], wait: 'open' }, { at: [17, 6] }] },
      {
        route: [
          [14, 9],
          [11, 6],
        ],
        after: [{ at: [10, 8], wait: 'open' }, { at: [6, 7], wait: 'open' }, { at: [2, 7] }],
      },
    ],
  },
  {
    name: ['The Grand Vault', '终极宝库'],
    tip: ['Use everything you have learned', '把学到的一切用上'],
    start: [2, 5],
    stages: [L(z(3, [1, 2], 7), z(3, [1, 8], 3)), T2(4, [1, 1], [2, 9], 5), L(z(3, [1, 8], 5))],
  },
];

const isDoor = (ch) => ch >= 'A' && ch <= 'E';
const isPlate = (ch) => ch >= 'a' && ch <= 'e';
function buildRoom(def) {
  const base = def.map ? def : { ...def, ...compose(def) };
  const room = {
    ...base,
    name: { en: def.name[0], zh: def.name[1] },
    grid: [],
    plates: [],
    cells: {},
    start: null,
    exit: null,
    plateDoor: {},
  };
  base.map.forEach((row, r) => {
    room.grid.push(
      [...row].map((ch, c) => {
        if (ch === 'S') room.start = [c, r];
        if (ch === 'X') room.exit = [c, r];
        if (isPlate(ch)) room.plates.push({ id: ch, c, r });
        if (isDoor(ch)) (room.cells[ch] ||= []).push({ c, r });
        return ch === '#' || isDoor(ch) ? ch : '.';
      }),
    );
  });
  for (const [id, d] of Object.entries(base.doors))
    for (const n of d.needs) room.plateDoor[n] ||= id;
  return room;
}
const ROOMS = ROOM_DEFS.map(buildRoom);
export const ROOM_COUNT = ROOMS.length;
export const LEVELS = ROOMS.map((r) => ({
  name: r.name,
  start: [...r.start],
  exit: [...r.exit],
  legs: r.legs.map((l) => ({
    route: l.route.map((p) => [...p]),
    after: l.after.map((a) => ({ ...a, at: [...a.at] })),
  })),
}));

const legStart = (room, leg) => (leg === 0 ? room.start : room.legs[leg - 1].after.at(-1).at);
const perchOf = (leg) => leg.route.at(-1);

// --- State ---

function loadRoom(s, index, fromClear = false) {
  const room = ROOMS[index];
  s.room = index;
  s.P = { x: px(room.start[0]), y: py(room.start[1]), vx: 0, vy: 0 };
  s.H = null;
  s.rec = null;
  s.cur = null;
  s.leg = 0;
  s.routeIdx = 0;
  s.afterIdx = 0;
  s.recsUsed = 0;
  s.doors = Object.fromEntries(
    Object.keys(room.doors).map((id) => [id, { timer: 0, open: false }]),
  );
  s.pressed = {};
  s.shown = null;
  s.marker = null;
  s.shownAge = 0;
  s.stall = 0;
  s.freeze = fromClear ? RULES.freeze : 0;
  s.dcache = new Map();
  s.menu = null;
  s.msg = null;
  s.line = null;
  say(s, room.tip[0], room.tip[1], RULES.introTime);
  refreshPrompt(s);
  updateLine(s);
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    mode: env.mode || 1,
    acc: 0,
    ticks: 0,
    recSeq: 0,
    reached: 1,
    progress: env.progress || null,
    roomBest: Array(ROOM_COUNT).fill(0),
    stats: { recordings: 0, replays: 0, clears: 0, resets: 0, blocked: 0 },
  };
  const unlocked = Math.min(ROOM_COUNT, s.progress?.unlocked?.() || 1);
  loadRoom(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    s.lineForce = true;
    updateLine(s);
  }
  return s;
}

// Messages caused by your own key press show at once; system events wait for the line to settle.
function say(s, en, zh, time = RULES.msgTime, forced = true, next = null) {
  s.msg = { en, zh, time, next };
  if (forced) s.lineForce = true;
}

// The line drawn in the top band (and used as the status): a held, key-naming copy of the prompt or message.
const KEY_TAG = {
  rec: ['Space', '空格'],
  stop: ['Space', '空格'],
  menu: ['Space', '空格'],
  replay: ['X', 'X'],
  wait: ['Stand still', '站着别动'],
  bad: ['Z', 'Z'],
  missed: ['Z', 'Z'],
  stall: ['Z', 'Z'],
  stuck: ['Z', 'Z'],
};
function lineCandidate(s) {
  const id = s.menu ? 'menu' : s.shown ? s.shown.id : 'rec';
  if (!s.msg || s.menu) return TXT[id];
  const tag = KEY_TAG[id] || ['Arrows', '方向键'];
  return [`[${tag[0]}] ${s.msg.en}`, `[${tag[1]}] ${s.msg.zh}`];
}
function updateLine(s) {
  const next = lineCandidate(s);
  const forced = s.lineForce;
  s.lineForce = false;
  if (s.line && next[0] === s.line.en) return;
  if (s.line && !forced && s.line.age < RULES.promptHold) return;
  s.line = { en: next[0], zh: next[1], age: 0 };
}

// --- Physics shared by the player and the echo ---

function solidAt(s, x, y) {
  const grid = ROOMS[s.room].grid;
  const c0 = Math.floor((x - HALF) / T);
  const c1 = Math.floor((x + HALF - 1e-6) / T);
  const r0 = Math.floor((y - HALF - TOP) / T);
  const r1 = Math.floor((y + HALF - 1e-6 - TOP) / T);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const ch = grid[r]?.[c] ?? '#';
      if (ch === '#') return 'wall';
      if (isDoor(ch) && !s.doors[ch].open) return 'door';
    }
  return null;
}
const overlaps = (a, b) => Math.abs(a.x - b.x) < RULES.actor && Math.abs(a.y - b.y) < RULES.actor;

function moveActor(s, a, mask, blocker) {
  const dx = (mask & RIGHT ? 1 : 0) - (mask & LEFT ? 1 : 0);
  const dy = (mask & DOWN ? 1 : 0) - (mask & UP ? 1 : 0);
  const k = dx && dy ? DIAG : 1;
  a.vx = dx * RULES.speed * k;
  a.vy = dy * RULES.speed * k;
  let hitDoor = false;
  const blockedBy = (x, y) => {
    const why = solidAt(s, x, y);
    if (why) return why;
    // Entering the echo's body is blocked; already overlapping it never traps the player.
    return blocker && overlaps({ x, y }, blocker) && !overlaps(a, blocker) ? 'echo' : null;
  };
  if (a.vx) {
    const why = blockedBy(a.x + a.vx * STEP, a.y);
    if (why) {
      hitDoor ||= why === 'door';
      a.vx = 0;
    } else a.x += a.vx * STEP;
  }
  if (a.vy) {
    const why = blockedBy(a.x, a.y + a.vy * STEP);
    if (why) {
      hitDoor ||= why === 'door';
      a.vy = 0;
    } else a.y += a.vy * STEP;
  }
  return hitDoor;
}

function updateDoors(s, emit) {
  const room = ROOMS[s.room];
  const on = {};
  for (const p of room.plates)
    on[p.id] = inTile(s.P, [p.c, p.r]) || (!!s.H && inTile(s.H, [p.c, p.r]));
  s.pressed = on;
  for (const [id, def] of Object.entries(room.doors)) {
    const d = s.doors[id];
    const powered = def.needs.every((n) => on[n]);
    d.timer = powered ? def.hold : Math.max(0, d.timer - STEP);
    const occupied = room.cells[id].some(
      ({ c, r }) => touches(s.P.x, s.P.y, c, r) || (s.H && touches(s.H.x, s.H.y, c, r)),
    );
    const open = powered || d.timer > 0 || occupied;
    if (open !== d.open) {
      d.open = open;
      emit('move');
    }
  }
}

// --- Navigation helpers for prompts and the on-screen marker ---

// A parked echo is solid, so routes and markers go around its tile.
const echoTile = (s) => (s.H && !s.H.playing ? tileOf(s.H) : null);
const passable = (s, c, r) => {
  const ch = ROOMS[s.room].grid[r]?.[c];
  const echo = echoTile(s);
  if (echo && echo[0] === c && echo[1] === r) return false;
  return ch !== undefined && ch !== '#' && (!isDoor(ch) || s.doors[ch].open);
};

function distances(s, goal) {
  const key = `${goal[0]},${goal[1]}|${Object.values(s.doors)
    .map((d) => +d.open)
    .join('')}|${echoTile(s)}`;
  if (!s.dcache.has(key)) s.dcache.set(key, floodFrom(s, goal));
  return s.dcache.get(key);
}

function floodFrom(s, goal) {
  const dist = new Array(COLS * ROWS).fill(-1);
  const queue = [goal[1] * COLS + goal[0]];
  dist[queue[0]] = 0;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i] % COLS;
    const r = Math.floor(queue[i] / COLS);
    for (const [dc, dr] of DIRS) {
      const k = (r + dr) * COLS + c + dc;
      if (dist[k] >= 0 || !passable(s, c + dc, r + dr)) continue;
      dist[k] = dist[queue[i]] + 1;
      queue.push(k);
    }
  }
  return dist;
}
// Distance from a tile; standing inside the parked echo's own tile counts as one step from its neighbours.
function distHere(s, dist, c, r) {
  const d = dist[r * COLS + c];
  const echo = echoTile(s);
  if (d >= 0 || !echo || echo[0] !== c || echo[1] !== r) return d;
  const around = DIRS.map(([dc, dr]) => dist[(r + dr) * COLS + c + dc]).filter((v) => v >= 0);
  return around.length ? Math.min(...around) + 1 : -1;
}
const reach = (s, from, goal) => {
  const [c, r] = tileOf(from);
  return distHere(s, distances(s, goal), c, r) >= 0;
};

// The marker sits at the end of the first straight run of the shortest route to the goal.
function markerFor(s, goal) {
  const dist = distances(s, goal);
  let [c, r] = tileOf(s.P);
  if (distHere(s, dist, c, r) <= 0) return { x: px(goal[0]), y: py(goal[1]) };
  let dir = null;
  for (;;) {
    const here = distHere(s, dist, c, r);
    const step = DIRS.find(([dc, dr]) => dist[(r + dr) * COLS + c + dc] === here - 1);
    if (!step || (dir && dir !== step)) break;
    dir = step;
    c += step[0];
    r += step[1];
    if (dist[r * COLS + c] === 0) break;
  }
  return { x: px(c), y: py(r) };
}

// --- Prompts: derived from the world, shown for at least promptHold seconds ---

function promptFor(s) {
  const room = ROOMS[s.room];
  const leg = room.legs[s.leg];
  const go = (id, goal) => {
    // Never point at a tile the parked echo is standing on: it is solid.
    const [gc, gr] = goal;
    const blockedByEcho = s.H && !s.H.playing && touches(s.H.x, s.H.y, gc, gr);
    if (!blockedByEcho && reach(s, s.P, goal)) return { id, goal };
    return s.H?.playing ? { id: 'wait', goal: null } : { id: 'stuck', goal: null };
  };
  if (s.cur)
    return s.routeIdx < leg.route.length
      ? go('plate', leg.route[s.routeIdx])
      : { id: 'stop', goal: null };
  const rec = s.rec;
  if (!rec || rec.leg !== s.leg) {
    const start = legStart(room, s.leg);
    return near(s.P, start) ? { id: 'rec', goal: null } : go('start', start);
  }
  if (!rec.ok) return { id: 'bad', goal: null };
  if (!s.H || s.H.id !== rec.id) return { id: 'replay', goal: null };
  if (!s.H.playing && !inTile(s.H, perchOf(leg))) return { id: 'missed', goal: null };
  const item = leg.after[s.afterIdx];
  const holding =
    item.wait === 'home' ? !waitDone(s, leg, item) : item.wait && inTile(s.P, item.at);
  if (holding) return { id: s.stall > RULES.stall ? 'stall' : 'wait', goal: null };
  const last = s.afterIdx === leg.after.length - 1;
  const kind = !last ? 'walk' : s.leg === room.legs.length - 1 ? 'exit' : 'checkpoint';
  return go(kind, item.at);
}

function refreshPrompt(s) {
  const next = promptFor(s);
  if (!s.shown || (next.id !== s.shown.id && s.shownAge >= RULES.promptHold)) {
    s.shown = next;
    s.shownAge = 0;
  } else if (next.id === s.shown.id) s.shown = { ...s.shown, goal: next.goal };
}

function waitDone(s, leg, item) {
  if (item.wait === 'home') return !!s.H && !s.H.playing && inTile(s.H, perchOf(leg));
  if (item.wait === 'open') return reach(s, s.P, leg.after[s.afterIdx + 1].at);
  return true;
}

function trackProgress(s) {
  const room = ROOMS[s.room];
  const leg = room.legs[s.leg];
  if (s.cur) {
    while (s.routeIdx < leg.route.length && inTile(s.P, leg.route[s.routeIdx])) s.routeIdx++;
    return;
  }
  if (!s.rec || s.rec.leg !== s.leg || !s.H || s.H.id !== s.rec.id) return;
  // Reaching the end of the leg always counts, however you got there.
  const lastItem = leg.after.length - 1;
  if (inTile(s.P, leg.after[lastItem].at)) s.afterIdx = lastItem;
  const item = leg.after[s.afterIdx];
  // Waiting for the echo to park needs no particular spot; waiting for a door means being at the door or plate.
  const here = item.wait === 'home' || inTile(s.P, item.at);
  if (here && waitDone(s, leg, item)) {
    if (s.afterIdx < leg.after.length - 1) s.afterIdx++;
    else if (s.leg < room.legs.length - 1) {
      s.leg++;
      s.routeIdx = 0;
      s.afterIdx = 0;
    }
    return;
  }
  // A timed door that closed before you crossed sends you back to wait for the echo again.
  while (
    s.afterIdx > 0 &&
    leg.after[s.afterIdx - 1].wait === 'open' &&
    !reach(s, s.P, leg.after[s.afterIdx].at)
  )
    s.afterIdx--;
}

function think(s) {
  trackProgress(s);
  const waiting = s.shown?.id === 'wait' && !s.H?.playing;
  s.stall = waiting ? s.stall + RULES.think * STEP : 0;
  refreshPrompt(s);
  refreshMarker(s);
}

// The marker stays on its corner until you reach it, so it never jumps ahead while you turn.
function refreshMarker(s) {
  const goal = s.shown?.goal;
  if (!goal) {
    s.marker = null;
    return;
  }
  const key = goal.join();
  const m = s.marker;
  if (m && m.key === key && Math.hypot(s.P.x - m.x, s.P.y - m.y) > RULES.markerReach) {
    // Keep the corner only while a straight, clear, shortest walk still leads to it.
    const dist = distances(s, goal);
    const [pc, pr] = tileOf(s.P);
    const [mc, mr] = tileOf(m);
    const steps = Math.abs(mc - pc) + Math.abs(mr - pr);
    if ((pc === mc || pr === mr) && steps > 0) {
      const dc = Math.sign(mc - pc);
      const dr = Math.sign(mr - pr);
      let want = distHere(s, dist, pc, pr);
      let clear = want > 0;
      for (let i = 1; i <= steps && clear; i++) {
        want -= 1;
        clear = dist[(pr + dr * i) * COLS + pc + dc * i] === want;
      }
      if (clear) return;
    }
  }
  s.marker = { key, ...markerFor(s, goal) };
}

// --- Recording and replay ---

const maskOf = (input) =>
  (input.held('ArrowLeft', 'KeyA') ? LEFT : 0) |
  (input.held('ArrowRight', 'KeyD') ? RIGHT : 0) |
  (input.held('ArrowUp', 'KeyW') ? UP : 0) |
  (input.held('ArrowDown', 'KeyS') ? DOWN : 0);

function stopRecording(s, emit, auto) {
  const cur = s.cur;
  s.cur = null;
  emit('move');
  if (cur.inputs.length < MIN_TICKS) {
    say(s, 'Too short: recording discarded', '太短了：录制已丢弃');
    return;
  }
  const leg = ROOMS[s.room].legs[s.leg];
  s.rec = {
    id: ++s.recSeq,
    leg: s.leg,
    inputs: cur.inputs,
    start: cur.start,
    ok: inTile(s.P, perchOf(leg)),
  };
  const secs = (cur.inputs.length * STEP).toFixed(1);
  if (auto) say(s, `Recording full (${secs} s) and saved`, `录制已满（${secs} 秒）并保存`);
  else say(s, `Recording saved (${secs} s)`, `录制已保存（${secs} 秒）`);
}

function act(s, input, emit) {
  if (input.pressed('KeyZ')) {
    if (s.cur || s.rec || s.H) {
      s.cur = null;
      s.rec = null;
      s.H = null;
      s.routeIdx = 0;
      s.afterIdx = 0;
      s.stats.clears++;
      say(s, 'Recording cleared', '录制已清除');
    } else if (!near(s.P, legStart(ROOMS[s.room], s.leg))) {
      const start = legStart(ROOMS[s.room], s.leg);
      Object.assign(s.P, { x: px(start[0]), y: py(start[1]), vx: 0, vy: 0 });
      s.stats.resets++;
      say(s, 'Back at the checkpoint', '回到检查点');
    } else if (unlockedCount(s) > 1) {
      s.menu = { sel: s.room + 1, unlocked: unlockedCount(s) };
      s.lineForce = true;
      updateLine(s);
      s.shown = null;
    } else {
      loadRoom(s, s.room);
      s.stats.resets++;
    }
    emit('move');
    return;
  }
  if (input.pressed('Space')) {
    if (s.cur) stopRecording(s, emit, false);
    else {
      s.cur = { inputs: [], start: { x: s.P.x, y: s.P.y } };
      s.routeIdx = 0;
      s.recsUsed++;
      s.stats.recordings++;
      say(s, 'Recording: walk, then press Space', '录制中：行走，然后按空格');
      emit('move');
    }
  }
  if (input.pressed('KeyX')) {
    if (s.cur) say(s, 'Stop recording first (Space)', '请先停止录制（空格）');
    else if (!s.rec) say(s, 'Nothing recorded yet (Space)', '还没有录制（空格）');
    else if (s.H?.playing) say(s, 'The echo is still replaying', '幻影仍在回放');
    else {
      s.H = { x: s.rec.start.x, y: s.rec.start.y, vx: 0, vy: 0, i: 0, playing: true, id: s.rec.id };
      s.afterIdx = 0;
      s.stats.replays++;
      say(s, 'Echo replaying your inputs', '幻影正在重复你的按键');
      emit('move');
    }
  }
}

const unlockedCount = (s) =>
  Math.min(ROOM_COUNT, Math.max(s.reached, s.progress?.unlocked?.() || 1));

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = Math.max(1, Math.min(m.unlocked, m.sel + step + row * MENU_COLS));
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (input.pressed('Space', 'Enter', 'KeyX')) {
    loadRoom(s, sel - 1);
    emit('move');
  }
}

function clearRoom(s, emit) {
  const room = ROOMS[s.room];
  const extra = Math.max(0, s.recsUsed - room.legs.length);
  const gain = RULES.roomScore + Math.max(0, RULES.bonusMax - RULES.bonusPenalty * extra);
  s.roomBest[s.room] = Math.max(s.roomBest[s.room], gain);
  s.score = s.roomBest.reduce((a, b) => a + b, 0);
  s.reached = Math.max(s.reached, s.room + 2);
  s.progress?.unlock?.(Math.min(ROOM_COUNT, s.room + 2));
  if (s.room === ROOM_COUNT - 1) {
    s.phase = 'won';
    return;
  }
  emit('coin');
  loadRoom(s, s.room + 1, true);
  const intro = s.msg;
  say(s, 'Room cleared!', '房间通关！', RULES.freeze, true, intro);
  updateLine(s);
}

function tick(s, mask, emit) {
  if (s.freeze > 0) {
    s.freeze = Math.max(0, s.freeze - STEP);
    mask = 0;
  }
  moveActor(s, s.P, mask, s.H);
  if (s.cur) {
    s.cur.inputs.push(mask);
    if (s.cur.inputs.length >= MAX_TICKS) stopRecording(s, emit, true);
  }
  const H = s.H;
  if (H?.playing) {
    if (moveActor(s, H, s.rec.inputs[H.i], null)) {
      s.stats.blocked++;
      if (s.stats.blocked % 60 === 1) {
        say(
          s,
          'The echo is blocked by a closed door',
          '幻影被关闭的门挡住了',
          RULES.msgTime,
          false,
        );
        emit('hit');
      }
    }
    if (++H.i >= s.rec.inputs.length) {
      H.playing = false;
      H.vx = H.vy = 0;
    }
  }
  updateDoors(s, emit);
  s.ticks++;
  s.shownAge += STEP;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = s.msg.next;
  if (s.line) s.line.age += STEP;
  updateLine(s);
  if (inTile(s.P, ROOMS[s.room].exit)) {
    clearRoom(s, emit);
    return;
  }
  if (s.ticks % RULES.think === 0) think(s);
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    return true;
  }
  if (s.freeze <= 0) act(s, input, emit);
  if (s.lineForce) updateLine(s);
  const mask = maskOf(input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, mask, emit);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase === 'won' && !ended) {
        ended = true;
        emit('win');
        env.end({
          won: true,
          score: s.score,
          message: env.t(
            'Every vault is solved. Your echo is proud of you!',
            '所有宝库都已解开，你的幻影为你骄傲！',
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

// --- Snapshot ---

const rle = (inputs) => {
  const out = [];
  for (const m of inputs) {
    const last = out.at(-1);
    if (last && last.mask === m) last.ticks++;
    else out.push({ mask: m, ticks: 1 });
  }
  return out;
};
const rectOf = (a) => ({ x: a.x - HALF, y: a.y - HALF, w: RULES.actor, h: RULES.actor });
const cellRect = ({ c, r }) => ({ x: c * T, y: TOP + r * T, w: T, h: T });

export function snapshotOf(s) {
  const room = ROOMS[s.room];
  const finished = s.phase !== 'playing';
  const shown = s.shown;
  const text2 = s.menu ? TXT.menu : shown ? TXT[shown.id] : TXT.rec;
  const prompt = { en: text2[0], zh: text2[1] };
  const marker =
    !finished && !s.menu && shown?.goal && s.marker
      ? { x: s.marker.x, y: s.marker.y, goal: { x: px(shown.goal[0]), y: py(shown.goal[1]) } }
      : null;
  room.wallRects ||= room.grid.flatMap((row, r) =>
    row.flatMap((ch, c) => (ch === '#' ? [Object.freeze(cellRect({ c, r }))] : [])),
  );
  room.wallRects = Object.freeze(room.wallRects);
  const walls = room.wallRects;
  const line = s.line || prompt;
  const label = (lang) =>
    `${lang === 'en' ? 'Room' : '房间'} ${s.room + 1}/${ROOM_COUNT} ${room.name[lang]} · ${line[lang]}`;
  const recording = s.cur ? s.cur.inputs : s.rec?.inputs;
  return {
    phase: s.phase,
    score: s.score,
    time: s.ticks * STEP,
    room: s.room + 1,
    rooms: ROOM_COUNT,
    roomName: room.name,
    leg: s.leg + 1,
    legs: room.legs.length,
    player: { x: s.P.x, y: s.P.y, vx: s.P.vx, vy: s.P.vy, rect: rectOf(s.P) },
    echo: s.H
      ? {
          x: s.H.x,
          y: s.H.y,
          vx: s.H.vx,
          vy: s.H.vy,
          rect: rectOf(s.H),
          playing: s.H.playing,
          progress: s.H.i,
        }
      : null,
    recording: {
      active: !!s.cur,
      ticks: s.cur ? s.cur.inputs.length : 0,
      seconds: s.cur ? s.cur.inputs.length * STEP : 0,
      max: RULES.maxRec,
    },
    saved: s.rec
      ? {
          ticks: s.rec.inputs.length,
          seconds: s.rec.inputs.length * STEP,
          start: { ...s.rec.start },
          ok: s.rec.ok,
        }
      : null,
    timeline: { max: RULES.maxRec, segments: rle(recording || []), playhead: s.H?.i ?? null },
    plates: room.plates.map((p) => ({
      id: p.id,
      ...cellRect(p),
      pressed: !!s.pressed[p.id],
    })),
    doors: Object.entries(room.doors).map(([id, def]) => ({
      id,
      needs: [...def.needs],
      hold: def.hold,
      open: s.doors[id].open,
      timer: s.doors[id].timer,
      cells: room.cells[id].map(cellRect),
    })),
    walls,
    exit: cellRect({ c: room.exit[0], r: room.exit[1] }),
    start: { x: px(legStart(room, s.leg)[0]), y: py(legStart(room, s.leg)[1]) },
    hint: marker,
    prompt,
    line: { en: line.en, zh: line.zh },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
    hud: { top: [0, TOP], bottom: [RULES.bottom, 320] },
    status: finished
      ? { en: `Vault cleared! Score ${s.score}`, zh: `宝库通关！得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const PLAYER = [
  '..oooo..',
  '.ohhhho.',
  '.ohffho.',
  '..oggo..',
  '.oggggo.',
  'og.gg.go',
  '.o.gg.o.',
  '.oo..oo.',
];
const GHOST = [
  '..cccc..',
  '.cwwwwc.',
  '.cwkkwc.',
  '.cwwwwc.',
  '.cwwwwc.',
  '.cwwwwc.',
  '.cwwwwc.',
  '.c.cc.c.',
];
const PLAYER_COLORS = { o: '#1b1020', h: '#ffd24a', f: '#2a1b3d', g: '#ff7a2f' };
const GHOST_COLORS = { c: '#7be8ff', w: '#b8f4ff', k: '#0b3a52' };
const DOOR_COLORS = { A: '#e5594f', B: '#4aa8ff', C: '#c46bff', D: '#ffb347', E: '#5ad68a' };
const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

function drawRoom(ctx, s, room) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = c * T;
      const y = TOP + r * T;
      if (room.grid[r][c] === '#') {
        box(ctx, '#4b5474', x, y, T, T);
        box(ctx, '#6c7898', x, y, T, 3);
        box(ctx, '#2b3149', x, y + T - 3, T, 3);
        box(ctx, '#5d6888', x + 5, y + 9, 10, 2);
        continue;
      }
      box(ctx, (c + r) % 2 ? '#262c3e' : '#2c3347', x, y, T, T);
      if ((c * 7 + r * 13) % 5 === 0) box(ctx, '#3d4663', x + 4, y + 6, 9, 2);
      if ((c * 5 + r * 3) % 7 === 0) box(ctx, '#3d4663', x + 12, y + 15, 2, 6);
    }
  const [ec, er] = room.exit;
  const pulse = Math.floor(s.ticks / 20) % 2;
  box(ctx, '#0e3b2c', ec * T + 2, TOP + er * T + 2, T - 4, T - 4);
  box(ctx, pulse ? '#5dffb0' : '#2fd68a', ec * T + 5, TOP + er * T + 5, T - 10, T - 10);
  box(ctx, '#e8fff4', ec * T + 9, TOP + er * T + 9, T - 18, T - 18);
}

function drawPlates(ctx, s, room) {
  for (const p of room.plates) {
    const lit = !!s.pressed[p.id];
    const door = room.plateDoor[p.id];
    const color = DOOR_COLORS[door];
    const x = p.c * T;
    const y = TOP + p.r * T;
    box(ctx, '#11141f', x + 2, y + 2, T - 4, T - 4);
    box(ctx, lit ? color : '#3a4258', x + 4, y + 4, T - 8, T - 8);
    box(ctx, lit ? '#ffffff' : color, x + 4, y + 4, T - 8, 2);
    text(ctx, door, x + T / 2, y + 5, lit ? '#101018' : '#e8ecf8', 14, 'center');
  }
}

function drawDoors(ctx, s, room) {
  for (const [id, cells] of Object.entries(room.cells)) {
    const d = s.doors[id];
    const color = DOOR_COLORS[id];
    for (const { c, r } of cells) {
      const x = c * T;
      const y = TOP + r * T;
      if (d.open) {
        box(ctx, color, x, y, T, 2);
        box(ctx, color, x, y + T - 2, T, 2);
        box(ctx, color, x, y, 2, 4);
        box(ctx, color, x + T - 2, y, 2, 4);
        const def = room.doors[id];
        if (def.hold && d.timer > 0)
          box(ctx, '#ffffff', x + 2, y + T / 2, Math.round(((T - 4) * d.timer) / def.hold), 3);
      } else {
        box(ctx, '#241a1a', x, y, T, T);
        for (let k = 3; k < T; k += 6) box(ctx, color, x + k, y, 3, T);
        text(ctx, id, x + T / 2, y + 5, '#10101a', 14, 'center');
      }
    }
  }
}

function drawActors(ctx, s) {
  const bob = Math.floor(s.ticks / 24) % 2;
  if (s.H) {
    const moving = s.H.playing;
    ctx.globalAlpha = 0.55;
    pixelSprite(ctx, GHOST, s.H.x - HALF, s.H.y - HALF - (moving ? 0 : bob), 2, GHOST_COLORS);
    ctx.globalAlpha = 1;
    box(ctx, '#7be8ff', s.H.x - HALF, s.H.y + HALF - 1, RULES.actor, 1);
  }
  const walking = s.P.vx !== 0 || s.P.vy !== 0;
  const lift = walking && Math.floor(s.ticks / 10) % 2 ? 1 : 0;
  if (s.cur) {
    const ring = Math.floor(s.ticks / 30) % 2 ? '#ff4a4a' : '#9c2b2b';
    box(ctx, ring, s.P.x - HALF - 2, s.P.y - HALF - 2, RULES.actor + 4, 2);
    box(ctx, ring, s.P.x - HALF - 2, s.P.y + HALF, RULES.actor + 4, 2);
    box(ctx, ring, s.P.x - HALF - 2, s.P.y - HALF - 2, 2, RULES.actor + 4);
    box(ctx, ring, s.P.x + HALF, s.P.y - HALF - 2, 2, RULES.actor + 4);
  }
  pixelSprite(ctx, PLAYER, s.P.x - HALF, s.P.y - HALF - lift, 2, PLAYER_COLORS);
}

function drawMarkers(ctx, s, room) {
  const start = legStart(room, s.leg);
  box(ctx, '#8d9ac4', px(start[0]) - 8, py(start[1]) + 9, 16, 2);
  if (s.rec) box(ctx, '#7be8ff', s.rec.start.x - 8, s.rec.start.y + 9, 16, 2);
  const m = s.marker;
  if (s.phase !== 'playing' || !s.shown?.goal || !m) return;
  const bob = Math.floor(s.ticks / 12) % 3;
  box(ctx, '#ffe066', m.x - 5, m.y - 16 + bob, 10, 3);
  box(ctx, '#ffe066', m.x - 3, m.y - 13 + bob, 6, 3);
  box(ctx, '#ffe066', m.x - 1, m.y - 10 + bob, 2, 3);
}

const TL = { x: 138, y: 296, w: 336, h: 14 };
function drawTimeline(ctx, s, env) {
  box(ctx, '#0b0e17', 0, RULES.bottom, 480, 320 - RULES.bottom);
  const perSec = TL.w / RULES.maxRec;
  const live = s.cur ? s.cur.inputs : s.rec?.inputs;
  const secs = live ? (live.length * STEP).toFixed(1) : '0.0';
  let label = env.t('NO REC', '无录制');
  if (s.cur) label = env.t(`REC ${secs}/${RULES.maxRec}s`, `录制 ${secs}/${RULES.maxRec}秒`);
  else if (live) label = env.t(`SAVED ${secs}s`, `已存 ${secs}秒`);
  text(ctx, label, 6, 294, s.cur ? '#ff6a6a' : '#cfd6ea', 14);
  box(ctx, '#1b2133', TL.x, TL.y, TL.w, TL.h);
  let at = 0;
  for (const seg of rle(live || [])) {
    const w = Math.max(1, Math.round(seg.ticks * STEP * perSec));
    box(
      ctx,
      seg.mask ? '#4ad991' : '#2d7a58',
      TL.x + Math.round(at * perSec),
      TL.y + 2,
      w,
      TL.h - 4,
    );
    at += seg.ticks * STEP;
  }
  for (let k = 0; k <= RULES.maxRec; k++)
    box(ctx, '#8d9ac4', TL.x + Math.round(k * perSec) - (k ? 1 : 0), TL.y + TL.h, 1, 4);
  box(ctx, '#cfd6ea', TL.x, TL.y - 1, TL.w, 1);
  if (s.H && s.rec) {
    const x = TL.x + Math.round(s.H.i * STEP * perSec);
    box(ctx, s.H.playing ? '#ffffff' : '#7be8ff', x, TL.y - 3, 2, TL.h + 6);
  }
}

function drawMenu(ctx, s, env) {
  background(ctx, '#0b0e17');
  text(ctx, env.t('MIMIC VAULT', '幻影宝库'), 240, 22, '#ffe066', 16, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 1; i <= ROOM_COUNT; i++) {
    const x = 20 + ((i - 1) % MENU_COLS) * 40;
    const y = 60 + Math.floor((i - 1) / MENU_COLS) * 44;
    const open = i <= unlocked;
    box(ctx, i === sel ? '#ffe066' : '#3a4258', x - 2, y - 2, 36, 36);
    box(ctx, open ? '#262c3e' : '#14171f', x, y, 32, 32);
    text(ctx, String(i), x + 16, y + 9, open ? '#ffffff' : '#555d75', 14, 'center');
  }
  const name = ROOMS[sel - 1].name;
  text(ctx, `${sel}/${ROOM_COUNT}  ${env.t(name.en, name.zh)}`, 240, 170, '#ffffff', 16, 'center');
  text(ctx, env.t(...ROOMS[sel - 1].tip), 240, 200, '#8d9ac4', 14, 'center');
  text(ctx, env.t(...TXT.menu), 240, 270, '#cfd6ea', 14, 'center');
}

function drawGame(ctx, s, env) {
  if (s.menu) {
    drawMenu(ctx, s, env);
    return;
  }
  const room = ROOMS[s.room];
  background(ctx, '#0b0e17');
  drawRoom(ctx, s, room);
  drawPlates(ctx, s, room);
  drawDoors(ctx, s, room);
  drawMarkers(ctx, s, room);
  drawActors(ctx, s);
  box(ctx, '#0b0e17', 0, 0, 480, TOP);
  const line = env.t(s.line.en, s.line.zh);
  text(ctx, line, 240, 6, s.msg ? '#ffe066' : '#ffffff', 14, 'center');
  text(ctx, `${s.room + 1}/${ROOM_COUNT}`, 474, 6, '#8d9ac4', 14, 'right');
  drawTimeline(ctx, s, env);
}
