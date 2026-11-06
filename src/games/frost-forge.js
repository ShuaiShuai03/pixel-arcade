import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'frost-forge',
  name: { en: 'Frost Forge', zh: '霜火工坊' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Repair freezing engines across 22 workshops, from one part to four: clearing a workshop unlocks the next, and the start screen lets you continue or replay any open one. Each socket accepts one part, and only while the part is inside its printed temperature window (for example 70~115). Parts warm on the red furnace pad, cool on the blue chiller pad and settle on the amber warm plate; every temperature moves toward its source by Newton cooling. Space picks up, puts down on a pad, or installs. X cycles the tool: off, torch (+20 degrees per second) or frost spray (-20 per second). Held parts heat or chill your gloves: at 65 degrees or above, or at -10 or below, the gauge flashes a warning; past 85 or -25 you lose 8 HP per second. A pad holds one part at a time, so share it by taking turns. Ice is slippery and melts under a hot part. Some engine sockets are frozen shut: stand at one with a part ready and press X for the torch, which melts the socket ice in about 3 seconds and then shuts itself off. The engine seizes at -30 degrees, so watch its clock.',
    zh: '在22间工坊里修好冻僵的发动机，从一个零件到四个零件：通关一间会解锁下一间，开局菜单可继续或重玩任何已开放的工坊。每个插槽只接受一个零件，并且零件温度必须落在标出的温度窗口内（例如 70~115）。零件在红色熔炉台升温，在蓝色冷却台降温，在琥珀色温热板上趋于稳定；所有温度都按牛顿冷却定律趋向热源。空格键拾取、放到台上或安装。X键切换工具：关闭、喷灯（每秒+20度）、冷冻喷雾（每秒-20度）。手持零件会加热或冻伤手套：达到65度以上或-10度以下时仪表闪烁警告，超过85度或低于-25度每秒损失8点生命。一个台子同一时间只放一个零件，要轮流使用。冰面很滑，热零件会把冰融化。有些发动机插槽被冻住了：带着合适的零件站在插槽前按X开启喷灯，约3秒融化插槽冰，随后喷灯自动关闭。发动机降到-30度就会卡死，请留意倒计时。',
  },
  keys: [
    { label: { en: 'Move (ice is slippery)', zh: '移动（冰面很滑）' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Pick up / put on pad / install', zh: '拾取 / 放到台上 / 安装' },
      keys: 'Space',
    },
    { label: { en: 'Tool: off, torch, frost', zh: '工具：关、喷灯、冷冻' }, keys: 'X' },
    {
      label: { en: 'Pick a workshop (start screen)', zh: '选择工坊（开始界面）' },
      keys: 'Arrows + Space',
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Handle', '操作', 'right'],
    ['KeyX', 'Tool', '工具', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// All temperatures are degrees C. Every rule below is stated here and nowhere else: temperatures
// change by explicit Euler steps of dT/dt = sum of k * (T_other - T) (Newton cooling), plus the
// tool power. Nothing jumps. Simulation ticks are 1/120 s.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 10,
  top: 28,
  step: 1 / 120,
  maxDt: 0.1,
  half: 8, // player collision half-size
  maxSpeed: 96,
  reach: 26, // pick-up distance
  socketReach: 30,
  padReach: 20,
  // Traction: accel is used while a direction is held, fric while coasting (px/s^2).
  ground: {
    dry: { accel: 900, fric: 1200 },
    wet: { accel: 480, fric: 520 },
    ice: { accel: 200, fric: 90 },
  },
  iceBelow: -5, // floor colder than this is ice; colder than wetBelow is a wet puddle
  wetBelow: 8,
  tileRelax: 0.06, // floor toward its own source temperature
  tileFromPart: 0.12, // floor toward a part lying on it
  partFromTile: 0.15, // part toward the floor it lies on
  air: 12,
  body: 30,
  gloveFromPart: 0.15,
  partFromGlove: 0.02,
  gloveFromBody: 0.15,
  partFromAir: 0.003, // carried parts only
  toolPower: 20,
  toolMax: 180,
  toolMin: -90,
  settleNear: 40, // a loose part this close to its take band is worth waiting for
  thawRate: 30, // ice units per second the torch melts (a frozen socket holds 100)
  carryBudget: 11, // seconds a part must survive being carried to count as ready to take
  warnHot: 65,
  warnCold: -10,
  harmHot: 85,
  harmCold: -25,
  partWarnHot: 130,
  partWarnCold: -65,
  damage: 8,
  regen: 2,
  hpMax: 100,
  stageHeal: 30,
  frost: -45, // the engine cools toward this
  seize: -30,
  engineStart: -6,
  promptHold: 72,
  promptMin: 66, // a prompt always stays at least 0.55 s
  messageTicks: 300,
  clearTicks: 300,
  installScore: 100,
  clearScore: 300,
});
const { tile: TILE, cols: COLS, rows: ROWS, top: TOP, step: STEP, half: HALF } = RULES;
const FIELD_BOTTOM = TOP + ROWS * TILE;
const SPRITE = 16; // art, hit rects and the player's collision box are all 16 px

const freeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v));
  return Object.freeze(o);
};
export const PADS = freeze({
  F: { temp: 105, k: 0.45, name: { en: 'furnace', zh: '熔炉' } },
  C: { temp: -52, k: 0.45, name: { en: 'chiller', zh: '冷却台' } },
  W: { temp: 50, k: 0.5, name: { en: 'warm plate', zh: '温热板' } },
});
export const PARTS = freeze({
  gear: { en: 'Gear', zh: '齿轮' },
  valve: { en: 'Valve', zh: '阀门' },
  coil: { en: 'Coil', zh: '线圈' },
  piston: { en: 'Piston', zh: '活塞' },
});
const FLOOR_TEMP = { '.': 12, i: -35 };

const cx = (c) => c * TILE + TILE / 2;
const cy = (r) => TOP + r * TILE + TILE / 2;
const win = (kind, r, lo, hi, start, ice = 0) => ({ kind, c: 16, r, lo, hi, start, ice });

// Windows are inclusive. `start` is where the loose part first lies. Lists are "x y, x y".
const cells = (str) => (str ? str.split(',').map((e) => e.trim().split(' ').map(Number)) : []);
const pads = (str) => str.split(',').map((e) => [e.trim()[0], ...cells(e.trim().slice(1))[0]]);
const stage = (en, zh, frostRate, player, padList, wallList, ice, sockets) => ({
  name: { en, zh },
  frostRate,
  player,
  pads: pads(padList),
  walls: cells(wallList),
  ice,
  sockets,
});
export const STAGES = freeze([
  // 1-11 teach one idea at a time; 12-17 combine them; 18-22 master them. Each workshop is data:
  // name, engine cooling rate, player start, pads, walls, ice rectangles and sockets (win(): part,
  // row, window lo/hi, where the part lies, frozen ice 0-100).
  stage(
    'Cold Start',
    '冷启动',
    0.008,
    [6, 5],
    'F 3 2, C 3 7',
    '9 4, 9 5, 9 6',
    [],
    [win('gear', 5, 70, 115, [8, 7])],
  ),
  stage(
    'Chill Out',
    '冷却一下',
    0.008,
    [7, 5],
    'C 4 2, F 4 7',
    '',
    [],
    [win('valve', 4, -55, -25, [10, 7])],
  ),
  stage(
    'Hot and Cold',
    '一热一冷',
    0.0085,
    [6, 5],
    'F 3 2, C 3 7',
    '',
    [],
    [win('gear', 3, 70, 115, [9, 2]), win('valve', 6, -55, -25, [9, 7])],
  ),
  stage(
    'Slick Floor',
    '打滑的地面',
    0.0085,
    [4, 5],
    'F 3 3, C 3 6',
    '',
    [[7, 1, 11, 8]],
    [win('gear', 4, 70, 115, [5, 7])],
  ),
  stage(
    'Frozen Socket',
    '冻住的插槽',
    0.0085,
    [8, 4],
    'F 4 2, C 4 7',
    '',
    [],
    [win('gear', 4, 70, 115, [9, 6], 100)],
  ),
  stage(
    'Warm Plate',
    '温热板',
    0.008,
    [7, 5],
    'W 5 3, F 5 7',
    '',
    [],
    [win('coil', 6, 38, 62, [10, 3])],
  ),
  stage(
    'Ice Rink',
    '溜冰场',
    0.009,
    [4, 5],
    'F 3 2, C 3 7',
    '',
    [[6, 1, 13, 8]],
    [win('gear', 3, 70, 115, [5, 3]), win('valve', 6, -55, -25, [5, 6])],
  ),
  stage(
    'Ice Hall',
    '冰厅',
    0.009,
    [6, 4],
    'F 3 2, C 3 7',
    '',
    [[7, 1, 12, 8]],
    [win('gear', 3, 70, 115, [5, 4], 100), win('valve', 6, -55, -25, [5, 6])],
  ),
  stage(
    'Warm Pair',
    '温热搭档',
    0.009,
    [6, 5],
    'W 3 5, F 4 2',
    '',
    [],
    [win('coil', 3, 38, 62, [9, 3]), win('gear', 6, 75, 118, [9, 7])],
  ),
  stage(
    'Wall Run',
    '绕墙',
    0.009,
    [3, 4],
    'C 3 2, F 3 7',
    '6 1, 6 2, 6 3, 6 4, 6 5, 6 6, 10 3, 10 4, 10 5, 10 6, 10 7, 10 8',
    [],
    [win('valve', 5, -55, -25, [8, 4])],
  ),
  stage(
    'Pillar Yard',
    '立柱场',
    0.009,
    [6, 5],
    'W 3 3, C 3 6',
    '5 3, 5 6, 8 2, 8 5, 8 8, 11 3, 11 6',
    [],
    [win('coil', 3, 38, 62, [9, 7]), win('valve', 6, -55, -25, [9, 3])],
  ),
  // Combine.
  stage(
    'Triple Play',
    '三重奏',
    0.009,
    [6, 5],
    'F 3 2, C 3 5, W 3 8',
    '9 3, 9 4, 12 6, 12 7',
    [],
    [
      win('gear', 2, 70, 115, [8, 6]),
      win('valve', 4, -55, -25, [8, 2]),
      win('coil', 7, 38, 62, [12, 3]),
    ],
  ),
  stage(
    'One Furnace',
    '一座熔炉',
    0.0095,
    [6, 5],
    'F 3 3, C 3 7',
    '',
    [],
    [
      win('gear', 2, 70, 115, [9, 4]),
      win('piston', 4, 80, 120, [9, 6]),
      win('valve', 7, -55, -25, [11, 7]),
    ],
  ),
  stage(
    'Long Haul',
    '长途搬运',
    0.009,
    [3, 4],
    'F 2 1, C 2 8',
    '6 1, 6 2, 6 3, 6 4, 6 5, 6 6, 10 3, 10 4, 10 5, 10 6, 10 7, 10 8',
    [],
    [win('gear', 3, 70, 115, [8, 7], 100), win('valve', 6, -55, -25, [8, 2])],
  ),
  stage(
    'Plate Share',
    '共用温板',
    0.008,
    [6, 5],
    'W 3 4, F 3 7',
    '9 3, 9 4, 9 5',
    [],
    [
      win('coil', 2, 38, 62, [8, 7]),
      win('piston', 4, 40, 60, [12, 2]),
      win('gear', 7, 80, 120, [12, 7]),
    ],
  ),
  stage(
    'Deep Freeze',
    '深冻车间',
    0.0085,
    [6, 4],
    'F 2 2, C 2 7, W 8 8',
    '9 3, 9 4, 12 5, 12 6',
    [
      [5, 1, 7, 4],
      [10, 5, 14, 8],
    ],
    [
      win('gear', 3, 80, 120, [6, 6]),
      win('valve', 5, -60, -30, [11, 3], 100),
      win('coil', 7, 38, 62, [13, 6], 100),
    ],
  ),
  stage(
    'Cold Chain',
    '冷链',
    0.0075,
    [5, 4],
    'F 2 2, C 2 7, W 2 4',
    '8 3, 8 4, 8 5, 12 5, 12 6, 12 7',
    [[5, 1, 7, 8]],
    [
      win('valve', 2, -60, -30, [9, 7], 100),
      win('gear', 4, 80, 120, [10, 2]),
      win('coil', 7, 38, 62, [14, 3], 100),
    ],
  ),
  // Master: four parts, scarce pads, tighter windows and clocks.
  stage(
    'Four Square',
    '四方阵',
    0.0085,
    [6, 4],
    'F 2 2, F 2 7, C 3 4, W 3 5',
    '8 3, 8 6, 11 2, 11 7',
    [],
    [
      win('gear', 2, 70, 115, [9, 4]),
      win('valve', 4, -55, -25, [10, 6]),
      win('coil', 6, 38, 62, [10, 2]),
      win('piston', 8, 80, 120, [13, 5]),
    ],
  ),
  stage(
    'Juggler',
    '杂耍',
    0.0085,
    [6, 5],
    'F 3 2, C 3 7, W 3 5',
    '8 4, 8 5',
    [],
    [
      win('gear', 2, 85, 120, [9, 3]),
      win('piston', 4, 85, 120, [9, 6]),
      win('valve', 6, -60, -34, [12, 7]),
      win('coil', 8, 40, 60, [12, 2]),
    ],
  ),
  stage(
    'Snap Freeze',
    '骤冷',
    0.007,
    [6, 4],
    'F 2 2, C 2 7, W 3 4',
    '7 3, 7 4, 11 5, 11 6',
    [[8, 1, 9, 8]],
    [
      win('valve', 1, -60, -30, [12, 7], 100),
      win('gear', 3, 80, 120, [12, 2]),
      win('coil', 5, 38, 62, [13, 7]),
      win('piston', 7, 80, 120, [13, 3], 100),
    ],
  ),
  stage(
    'Glacier',
    '冰川',
    0.0065,
    [7, 5],
    'F 2 2, C 2 7, W 3 4',
    '8 4, 8 5',
    [
      [4, 1, 5, 8],
      [12, 1, 15, 8],
    ],
    [
      win('gear', 2, 80, 120, [9, 2], 100),
      win('valve', 4, -60, -30, [9, 7]),
      win('coil', 6, 38, 62, [10, 4]),
      win('piston', 8, 80, 120, [10, 6], 100),
    ],
  ),
  stage(
    'Master Forge',
    '大师熔炉',
    0.0062,
    [4, 4],
    'F 2 2, C 2 7, W 4 5',
    '7 1, 7 2, 7 3, 7 4, 7 5, 7 6',
    [[12, 1, 15, 8]],
    [
      win('gear', 2, 85, 120, [10, 7], 100),
      win('valve', 4, -62, -34, [9, 2]),
      win('coil', 6, 40, 60, [11, 8]),
      win('piston', 8, 85, 120, [9, 5], 100),
    ],
  ),
]);
const ENGINE_COL = 16;
const ENGINE_ROWS = [1, 8];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function buildGrid(stage) {
  const grid = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? '#' : '.',
    ),
  );
  for (const [x0, y0, x1, y1] of stage.ice)
    for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) grid[r][c] = 'i';
  for (const [c, r] of stage.walls) grid[r][c] = '#';
  for (const [kind, c, r] of stage.pads) grid[r][c] = kind;
  for (let r = ENGINE_ROWS[0]; r <= ENGINE_ROWS[1]; r++)
    for (let c = ENGINE_COL; c < COLS - 1; c++) grid[r][c] = 'E';
  return grid;
}

const envTemp = (ch) => (PADS[ch] ? PADS[ch].temp : (FLOOR_TEMP[ch] ?? null));

export function loadStage(s, index) {
  const def = STAGES[index];
  s.stage = index;
  s.grid = buildGrid(def);
  s.tiles = s.grid.map((row) => row.map((ch) => envTemp(ch)));
  s.sockets = def.sockets.map((k) => ({ ...k, done: false }));
  s.comps = def.sockets.map((k, i) => ({
    id: i,
    kind: k.kind,
    x: cx(k.start[0]),
    y: cy(k.start[1]),
    T: s.tiles[k.start[1]][k.start[0]],
    held: false,
    done: false,
  }));
  s.player = {
    x: cx(def.player[0]),
    y: cy(def.player[1]),
    vx: 0,
    vy: 0,
    glove: RULES.body,
    tool: 0,
  };
  s.engine = RULES.engineStart;
  s.clear = 0;
  s.hp = Math.min(RULES.hpMax, s.hp + RULES.stageHeal);
  s.harming = false;
  const name = def.name;
  say(s, `Workshop ${index + 1}: ${name.en}`, `第${index + 1}间工坊：${name.zh}`);
}

export function newState() {
  const s = {
    phase: 'playing',
    ticks: 0,
    acc: 0,
    score: 0,
    hp: RULES.hpMax,
    pendingHandle: false,
    pendingTool: false,
    msg: null,
    prompt: { id: '', key: '', subject: null, age: 0 },
    stats: { installs: 0, rejects: 0, burns: 0, tools: 0 },
    cause: null,
    unlockTo: 0, // workshop number (1-based) the host should unlock; 0 until the first clear
    menu: null,
    menuClock: 0, // seconds on the select screen (animation only)
  };
  loadStage(s, 0);
  setPrompt(s, true);
  return s;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const tileOf = (x, y) => ({ c: Math.floor(x / TILE), r: Math.floor((y - TOP) / TILE) });
const charAt = (s, c, r) => s.grid[r]?.[c] ?? '#';
const solid = (s, c, r) => '#E'.includes(charAt(s, c, r));
const heldComp = (s) => s.comps.find((c) => c.held) ?? null;
const socketOf = (s, comp) => s.sockets.find((k) => k.kind === comp.kind);
const inWindow = (comp, k) => comp.T >= k.lo && comp.T <= k.hi;
// Carried parts drift toward body temperature, so "ready to take" keeps a margin on that side.
// The band is derived from the carry rules: a part taken inside it is still inside its window
// after carryBudget seconds of carrying (a 4.3 s walk at full speed, a slower one and the time to press Space).
function carried(temp, seconds) {
  let T = temp;
  let glove = RULES.body;
  for (let i = 0; i < seconds * 120; i++) {
    const dT = (glove - T) * RULES.partFromGlove + (RULES.air - T) * RULES.partFromAir;
    glove +=
      ((T - glove) * RULES.gloveFromPart + (RULES.body - glove) * RULES.gloveFromBody) * STEP;
    T += dT * STEP;
  }
  return T;
}
const bands = new Map();
export function takeAt(k) {
  const id = `${k.lo}~${k.hi}`;
  if (bands.has(id)) return bands.get(id);
  const hot = (k.lo + k.hi) / 2 >= RULES.body;
  let a = k.lo;
  let b = k.hi;
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if (hot ? carried(mid, RULES.carryBudget) >= k.lo : carried(mid, RULES.carryBudget) <= k.hi) {
      if (hot) b = mid;
      else a = mid;
    } else if (hot) a = mid;
    else b = mid;
  }
  const band = hot ? { lo: b, hi: k.hi } : { lo: k.lo, hi: a };
  bands.set(id, band);
  return band;
}
const takeReady = (comp, k) => {
  const t = takeAt(k);
  return comp.T >= t.lo && comp.T <= t.hi;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const padChar = (s, comp) => {
  const t = tileOf(comp.x, comp.y);
  return PADS[charAt(s, t.c, t.r)] ? charAt(s, t.c, t.r) : null;
};

export function groundClass(temp) {
  return temp <= RULES.iceBelow ? 'ice' : temp < RULES.wetBelow ? 'wet' : 'dry';
}
function groundAt(s, x, y) {
  const t = tileOf(x, y);
  const temp = s.tiles[t.r]?.[t.c];
  return typeof temp === 'number' && !PADS[charAt(s, t.c, t.r)] ? groundClass(temp) : 'dry';
}

// The pad that moves a part toward its window: it must lie in or beyond the window on the
// correct side. Prefer the pad closest to the middle of the window (no overshoot).
// A pad suits a part when it moves it toward its window (or keeps it inside); Space only
// auto-places a held part onto a suitable pad, so an adjacent wrong pad never swallows it.
const padSuits = (comp, k, temp) =>
  comp.T < k.lo ? temp >= k.lo : comp.T > k.hi ? temp <= k.hi : temp >= k.lo && temp <= k.hi;
// A pad holds one loose part: whoever lies on its tile has it.
const occupant = (s, c, r, except = null) =>
  s.comps.find((o) => {
    const at = tileOf(o.x, o.y);
    return o !== except && !o.held && !o.done && at.c === c && at.r === r;
  });
// Free pads come first; among them the one closest to the middle of the window (no overshoot).
export function bestPad(s, comp) {
  const k = socketOf(s, comp);
  const mid = (k.lo + k.hi) / 2;
  const pads = [];
  s.grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const p = PADS[ch];
      if (!p) return;
      const helps = comp.T < k.lo ? p.temp >= k.lo : comp.T > k.hi ? p.temp <= k.hi : false;
      if (helps)
        pads.push({ ch, c, r, busy: !!occupant(s, c, r, comp), score: Math.abs(p.temp - mid) });
    }),
  );
  pads.sort((a, b) => a.busy - b.busy || a.score - b.score || a.r - b.r || a.c - b.c);
  return pads[0] ?? null;
}
// Ambient floor evens a part out gently: if it lies beyond the window on the far side from the
// floor temperature, resting on bare floor drifts it back through the window (slowly, easy to hit).
export const floorEvens = (comp, k) =>
  comp.T > k.hi ? RULES.air < k.lo : comp.T < k.lo ? RULES.air > k.hi : false;
const onGoodPad = (s, comp) => {
  const ch = padChar(s, comp);
  const k = socketOf(s, comp);
  if (!ch) return false;
  const t = PADS[ch].temp;
  return comp.T < k.lo ? t >= k.lo : comp.T > k.hi ? t <= k.hi : true;
};

export function glowLevel(s) {
  const { glove } = s.player;
  const held = heldComp(s);
  if (glove >= RULES.harmHot || glove <= RULES.harmCold) return 'harm';
  if (glove >= RULES.warnHot) return 'hot';
  if (glove <= RULES.warnCold) return 'cold';
  if (held && held.T >= RULES.partWarnHot) return 'hot';
  if (held && held.T <= RULES.partWarnCold) return 'cold';
  return null;
}
// Only the glove itself can say "put it down"; a hot or cold part is a warning to hurry.
const warnKind = (s) => {
  const { glove } = s.player;
  return glove >= RULES.warnHot ? 'hot' : glove <= RULES.warnCold ? 'cold' : null;
};
export const engineEta = (s) => {
  const rate = STAGES[s.stage].frostRate;
  const gap = (s.engine - RULES.frost) / (RULES.seize - RULES.frost);
  return gap <= 1 ? 0 : Math.log(gap) / rate;
};
// A torch aimed within reach of a frozen socket works on the socket, not on the part in hand.
const frozenSocket = (s) =>
  s.player.tool === 1
    ? s.sockets.find(
        (k) =>
          !k.done &&
          k.ice > 0 &&
          Math.hypot(cx(k.c) - s.player.x, cy(k.r) - s.player.y) <= RULES.socketReach,
      )
    : null;
const toolTarget = (s) => {
  const ice = frozenSocket(s);
  if (ice) return { x: cx(ice.c), y: cy(ice.r), socket: ice };
  const held = heldComp(s);
  if (held) return held;
  let best = null;
  for (const c of s.comps) {
    if (c.done) continue;
    const d = dist(c, s.player);
    if (d <= RULES.reach && (!best || d < best.d)) best = { c, d };
  }
  return best?.c ?? null;
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function say(s, en, zh) {
  s.msg = { en, zh, left: RULES.messageTicks };
}

function handle(s, emit) {
  const p = s.player;
  const held = heldComp(s);
  if (!held) {
    let best = null;
    for (const c of s.comps) {
      const d = dist(c, p);
      if (!c.done && d <= RULES.reach && (!best || d < best.d)) best = { c, d };
    }
    // Space takes the part the prompt names when it is in reach, not just the closest one.
    const named = s.comps[s.prompt.subject];
    if (['take', 'bring', 'lift'].includes(s.prompt.key) && named && !named.done)
      if (dist(named, p) <= RULES.reach) best = { c: named, d: dist(named, p) };
    if (!best) return;
    best.c.held = true;
    emit('move');
    say(s, `Picked up the ${PARTS[best.c.kind].en}.`, `拿起了${PARTS[best.c.kind].zh}。`);
    return;
  }
  const sock = s.sockets
    .filter((k) => !k.done && Math.hypot(cx(k.c) - p.x, cy(k.r) - p.y) <= RULES.socketReach)
    .sort(
      (a, b) => Math.hypot(cx(a.c) - p.x, cy(a.r) - p.y) - Math.hypot(cx(b.c) - p.x, cy(b.r) - p.y),
    )[0];
  if (sock && (!warnKind(s) || (sock.kind === held.kind && inWindow(held, sock))))
    return install(s, held, sock, emit);
  const free = [];
  const bare = floorEvens(held, socketOf(s, held));
  s.grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const spot = { x: cx(c), y: cy(r) };
      if (
        PADS[ch] &&
        !bare &&
        padSuits(held, socketOf(s, held), PADS[ch].temp) &&
        !occupant(s, c, r) &&
        dist(spot, p) <= RULES.padReach
      )
        free.push(spot);
    }),
  );
  held.held = false;
  const spot = free.sort((a, b) => dist(a, p) - dist(b, p))[0];
  const at = spot ?? floorSpot(s, p);
  held.x = at.x;
  held.y = at.y;
  say(
    s,
    spot ? 'Placed on the pad.' : 'Put the part down.',
    spot ? '放到了台上。' : '放下了零件。',
  );
}

// A part put down at the player's feet. Standing on a pad that is taken (or must stay bare), it
// goes to the nearest bare floor tile beside it instead, so a pad never heats two parts.
function floorSpot(s, p) {
  const here = tileOf(p.x, p.y);
  if (!PADS[charAt(s, here.c, here.r)]) return { x: p.x, y: p.y };
  const beside = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const ch = charAt(s, here.c + dc, here.r + dr);
      if (ch === '.' || ch === 'i') beside.push({ x: cx(here.c + dc), y: cy(here.r + dr) });
    }
  const ice = (q) => Number(charAt(s, tileOf(q.x, q.y).c, tileOf(q.x, q.y).r) === 'i');
  return beside.sort((a, b) => ice(a) - ice(b) || dist(a, p) - dist(b, p))[0] ?? p;
}

function install(s, held, sock, emit) {
  const name = PARTS[held.kind];
  if (sock.ice > 0) {
    s.stats.rejects++;
    emit('hit');
    say(
      s,
      `The socket is frozen shut (${Math.ceil(sock.ice)}%): X torch it.`,
      `插槽被冻住了（${Math.ceil(sock.ice)}%）：按X喷灯融化。`,
    );
    return;
  }
  if (sock.kind !== held.kind) {
    s.stats.rejects++;
    emit('hit');
    say(s, `This socket takes the ${PARTS[sock.kind].en}.`, `这个插槽装${PARTS[sock.kind].zh}。`);
    return;
  }
  if (!inWindow(held, sock)) {
    s.stats.rejects++;
    emit('hit');
    const cold = held.T < sock.lo;
    say(
      s,
      `${name.en} is ${Math.round(held.T)}C, too ${cold ? 'cold' : 'hot'}: needs ${sock.lo}~${sock.hi}.`,
      `${name.zh}${Math.round(held.T)}度，${cold ? '太冷' : '太热'}：需要${sock.lo}~${sock.hi}度。`,
    );
    return;
  }
  held.held = false;
  held.done = true;
  held.x = cx(sock.c);
  held.y = cy(sock.r);
  sock.done = true;
  s.stats.installs++;
  s.score += RULES.installScore;
  emit('coin');
  say(
    s,
    `${name.en} installed at ${Math.round(held.T)}C!`,
    `${name.zh}在${Math.round(held.T)}度时安装成功！`,
  );
}

function approach(vx, vy, tx, ty, maxDelta) {
  const dx = tx - vx;
  const dy = ty - vy;
  const d = Math.hypot(dx, dy);
  return d <= maxDelta ? [tx, ty] : [vx + (dx / d) * maxDelta, vy + (dy / d) * maxDelta];
}

// Swept axis move: the box can only end a step flush against the first solid tile edge.
function moveAxis(s, axis, delta) {
  const p = s.player;
  const horizontal = axis === 'x';
  const origin = horizontal ? 0 : TOP;
  const crossOrigin = horizontal ? TOP : 0;
  const cross = horizontal ? p.y : p.x;
  const next = p[axis] + delta;
  const edge = next + Math.sign(delta) * HALF - (delta > 0 ? 1e-9 : 0);
  const line = Math.floor((edge - origin) / TILE);
  const lo = Math.floor((cross - HALF - crossOrigin) / TILE);
  const hi = Math.floor((cross + HALF - 1e-9 - crossOrigin) / TILE);
  let hit = false;
  for (let k = lo; k <= hi; k++) hit ||= horizontal ? solid(s, line, k) : solid(s, k, line);
  if (!hit) {
    p[axis] = next;
    return;
  }
  p[axis] = origin + (delta > 0 ? line : line + 1) * TILE - Math.sign(delta) * HALF;
  p[horizontal ? 'vx' : 'vy'] = 0;
}

function movePlayer(s, dir) {
  const p = s.player;
  const { accel, fric } = RULES.ground[groundAt(s, p.x, p.y)];
  const len = Math.hypot(dir.dx, dir.dy);
  if (len) {
    const t = RULES.maxSpeed / len;
    [p.vx, p.vy] = approach(p.vx, p.vy, dir.dx * t, dir.dy * t, accel * STEP);
  } else {
    [p.vx, p.vy] = approach(p.vx, p.vy, 0, 0, fric * STEP);
  }
  if (p.vx) moveAxis(s, 'x', p.vx * STEP);
  if (p.vy) moveAxis(s, 'y', p.vy * STEP);
}

// One thermal step. Every delta is computed from the temperatures at the start of the tick.
function heat(s) {
  const p = s.player;
  const tileDelta = s.tiles.map((row) => row.map(() => 0));
  let gloveDelta = (RULES.body - p.glove) * RULES.gloveFromBody;
  const target = p.tool ? toolTarget(s) : null;
  if (target?.socket) {
    target.socket.ice = Math.max(0, target.socket.ice - RULES.thawRate * STEP);
    if (target.socket.ice === 0) {
      p.tool = 0; // the torch shuts off once its target is clear
      say(s, 'Socket thawed. The torch is off.', '插槽解冻了，喷灯已关闭。');
    }
  }
  const deltas = s.comps.map((c) => {
    if (c.done) return 0;
    if (c.held) {
      gloveDelta += (c.T - p.glove) * RULES.gloveFromPart;
      return (p.glove - c.T) * RULES.partFromGlove + (RULES.air - c.T) * RULES.partFromAir;
    }
    const t = tileOf(c.x, c.y);
    const pad = PADS[charAt(s, t.c, t.r)];
    if (pad) return (pad.temp - c.T) * pad.k;
    const floor = s.tiles[t.r][t.c];
    tileDelta[t.r][t.c] += (c.T - floor) * RULES.tileFromPart;
    return (floor - c.T) * RULES.partFromTile;
  });
  s.comps.forEach((c, i) => {
    c.T += deltas[i] * STEP;
    if (c !== target) return;
    if (p.tool === 1) c.T = Math.max(c.T, Math.min(RULES.toolMax, c.T + RULES.toolPower * STEP));
    else c.T = Math.min(c.T, Math.max(RULES.toolMin, c.T - RULES.toolPower * STEP));
  });
  s.tiles.forEach((row, r) =>
    row.forEach((temp, c) => {
      const source = envTemp(s.grid[r][c]);
      if (temp === null || PADS[s.grid[r][c]]) return;
      row[c] = temp + ((source - temp) * RULES.tileRelax + tileDelta[r][c]) * STEP;
    }),
  );
  p.glove += gloveDelta * STEP;
}

function body(s, emit) {
  const level = glowLevel(s);
  if (level === 'harm') {
    s.hp -= RULES.damage * STEP;
    if (!s.harming) {
      s.harming = true;
      s.stats.burns++;
      emit('hit');
      const hot = s.player.glove > RULES.body;
      say(
        s,
        hot ? 'Burning! Put the part down.' : 'Frostbite! Put the part down.',
        hot ? '烫伤了！快放下零件。' : '冻伤了！快放下零件。',
      );
    }
  } else {
    s.harming = false;
    if (!level) s.hp = Math.min(RULES.hpMax, s.hp + RULES.regen * STEP);
  }
}

function runActions(s, emit) {
  if (s.pendingHandle) {
    handle(s, emit);
    // A handled part changes the situation: refresh the prompt as soon as it was readable.
    if (s.prompt.age >= RULES.promptMin) s.prompt.age = RULES.promptHold;
  }
  if (s.pendingTool) {
    s.player.tool = (s.player.tool + 1) % 3;
    s.stats.tools++;
    emit('shoot');
    const names = [
      ['Tool off.', '工具已关闭。'],
      ['Torch on: heats a part 20 per second.', '喷灯开启：每秒加热20度。'],
      ['Frost spray on: cools a part 20 per second.', '冷冻喷雾开启：每秒降温20度。'],
    ][s.player.tool];
    say(s, names[0], names[1]);
  }
  s.pendingHandle = false;
  s.pendingTool = false;
}

function finish(s, phase, cause, emit) {
  s.phase = phase;
  s.cause = cause;
  emit(phase === 'won' ? 'win' : 'lose');
}

function tick(s, dir, emit) {
  s.ticks++;
  if (s.msg && --s.msg.left <= 0) s.msg = null;
  if (s.clear > 0) {
    if (--s.clear === 0) {
      if (s.stage === STAGES.length - 1) {
        s.score += Math.round(s.hp) * 5;
        finish(s, 'won', null, emit);
      } else loadStage(s, s.stage + 1);
    }
    s.pendingHandle = s.pendingTool = false;
    setPrompt(s);
    return;
  }
  runActions(s, emit);
  movePlayer(s, dir);
  for (const c of s.comps) if (c.held) Object.assign(c, { x: s.player.x, y: s.player.y });
  heat(s);
  body(s, emit);
  s.engine += (RULES.frost - s.engine) * STAGES[s.stage].frostRate * STEP;
  if (s.sockets.every((k) => k.done)) {
    s.clear = RULES.clearTicks;
    s.unlockTo = Math.min(STAGES.length, s.stage + 2);
    s.score += RULES.clearScore + Math.round(engineEta(s) * 2);
    emit('win');
    say(s, 'Engine running! Workshop repaired.', '发动机启动了！工坊修好了。');
  } else if (s.hp <= 0) finish(s, 'lost', 'body', emit);
  else if (s.engine <= RULES.seize) finish(s, 'lost', 'engine', emit);
  setPrompt(s);
}

function readDir(input) {
  const axis = (neg, pos) => Number(input.held(...pos)) - Number(input.held(...neg));
  return {
    dx: axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']),
    dy: axis(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']),
  };
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuStep(s, dt, input, emit);
    return true;
  }
  if (input.pressed('Space')) s.pendingHandle = true;
  if (input.pressed('KeyX')) s.pendingTool = true;
  const dir = readDir(input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, emit);
  return true;
}

// ---------------------------------------------------------------------------
// Workshop select
// ---------------------------------------------------------------------------

const MENU = { cols: 6, w: 68, h: 46, gap: 8, x0: 16, y0: 44 };
export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: MENU.x0 + (i % MENU.cols) * (MENU.w + MENU.gap),
    y: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.h + MENU.gap),
    w: MENU.w,
    h: MENU.h,
  };
};
const menuHit = (pointer) =>
  STAGES.findIndex((_, i) => {
    const q = menuCell(i + 1);
    return pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h;
  }) + 1;

// The select screen only opens when there is something to choose: more than workshop 1 is open.
export function openMenu(s, unlocked) {
  s.menu = { cursor: unlocked, unlocked };
  s.msg = null;
  setPrompt(s, true);
}

function menuStep(s, dt, input, emit) {
  const m = s.menu;
  s.menuClock += dt;
  if (s.msg && (s.msg.left -= dt / STEP) <= 0) s.msg = null;
  const was = m.cursor;
  const pick = (neg, pos, size) =>
    Number(input.pressed(...pos)) * size - Number(input.pressed(...neg)) * size;
  const move =
    pick(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD'], 1) +
    pick(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS'], MENU.cols);
  m.cursor = Math.max(1, Math.min(m.unlocked, m.cursor + move));
  if (m.cursor !== was) emit('move');
  const tapped = input.pointer?.clicked ? menuHit(input.pointer) : 0;
  if (tapped > m.unlocked) {
    emit('hit');
    say(s, `Clear workshop ${m.unlocked} first.`, `先通关第${m.unlocked}间工坊。`);
  } else if (tapped) m.cursor = tapped;
  if (tapped <= m.unlocked && (tapped || input.pressed('Space', 'Enter', 'NumpadEnter'))) {
    loadStage(s, m.cursor - 1);
    s.menu = null;
    setPrompt(s, true);
    emit('move');
  }
}

// ---------------------------------------------------------------------------
// Prompts and status
// ---------------------------------------------------------------------------

export const PROMPTS = freeze({
  warnHot: ['Gloves are hot ({g}C)! Space: put it down', '手套太烫（{g}度）！空格：放下'],
  warnCold: ['Gloves are cold ({g}C)! Space: put it down', '手套太冷（{g}度）！空格：放下'],
  thaw: ['{p} is ready: X torch the frozen socket, Space', '{p}就绪：按X喷灯融化插槽冰再按空格'],
  install: ['Carry the {p} to its engine socket: Space', '把{p}送到发动机插槽：空格'],
  tooHot: ['{p} {t}C is too hot: the {s}, or X frost', '{p}{t}度太热：去{s}或按X冷冻'],
  tooCold: ['{p} {t}C is too cold: the {s}, or X torch', '{p}{t}度太冷：去{s}或按X喷灯'],
  partHot: ['{p} {t}C is scorching: hurry to the {s}, Space', '{p}{t}度很烫：快到{s}按空格'],
  floorHot: [
    '{p} {t}C is too hot: bare floor, Space, or X frost',
    '{p}{t}度太热：放空地按空格，或按X冷冻',
  ],
  floorCold: [
    '{p} {t}C is too cold: bare floor, Space, or X torch',
    '{p}{t}度太冷：放空地按空格，或按X喷灯',
  ],
  padBusy: ['{p} {t}C: {s} busy. Space: put on bare floor', '{p}{t}度：{s}被占用，空格放空地'],
  lift: ['Space: lift the {p} off the {s} to even out', '空格：把{p}从{s}上拿开，让它回稳'],
  settle: ['{p} {t}C settling on the floor: take it at {m}', '{p}{t}度在地面回稳：到{m}时拿起'],
  partCold: ['{p} {t}C is frozen: hurry to the {s}, Space', '{p}{t}度已冻透：快到{s}按空格'],
  take: ['Space: pick up the ready {p} ({t}C)', '空格：拿起合适的{p}（{t}度）'],
  bring: ['Space: take the {p} to the {s}', '空格：把{p}拿到{s}'],
  wait: ['{p} on the {s}: {t}C, take it at {m}', '{p}在{s}上：{t}度，到{m}时拿起'],
  cleared: ['Engine running! Next workshop soon', '发动机启动！即将进入下一间'],
  menu: ['Arrows: pick a workshop. Space: start', '方向键选工坊，空格开始'],
});

// Pick the one thing the player should do next. Hazard warnings win; the rest follows the parts.
function wantPrompt(s) {
  if (s.menu) return ['menu', null];
  if (s.clear > 0 || s.phase !== 'playing') return ['cleared', null];
  const held = heldComp(s);
  const warn = warnKind(s);
  if (warn) return [warn === 'hot' ? 'warnHot' : 'warnCold', held?.id ?? null];
  if (held) {
    const k = socketOf(s, held);
    if (inWindow(held, k)) return [k.ice > 0 ? 'thaw' : 'install', held.id];
    if (floorEvens(held, k)) return [held.T > k.hi ? 'floorHot' : 'floorCold', held.id];
    if (bestPad(s, held)?.busy) return ['padBusy', held.id]; // its pad is taken: set it aside
    if (held.T >= RULES.partWarnHot) return ['partHot', held.id];
    if (held.T <= RULES.partWarnCold) return ['partCold', held.id];
    return [held.T > k.hi ? 'tooHot' : 'tooCold', held.id];
  }
  const pending = s.comps.filter((c) => !c.done);
  const loose = (c) => floorEvens(c, socketOf(s, c));
  // A stray part is only worth fetching while a pad that suits it is free. If every such pad is
  // taken, the strays lying on a wrong pad come first: moving one off frees its pad for another.
  const unplaced = pending.filter((c) => !loose(c) && !onGoodPad(s, c));
  const free = unplaced.filter((c) => !bestPad(s, c)?.busy);
  const strays = free.length ? free : unplaced.filter((c) => padChar(s, c));
  // Ready parts and strays are served nearest first, so a trip is never turned around. The part
  // already named stays named while it is still a candidate, so a delayed reader never watches
  // the prompt flip between two parts that are about equally far.
  const nearest = (list) => [...list].sort((a, b) => dist(a, s.player) - dist(b, s.player))[0];
  const choose = (list) =>
    (['take', 'bring'].includes(s.prompt.key) && list.find((c) => c.id === s.prompt.subject)) ||
    nearest(list);
  const ready = pending.filter((c) => takeReady(c, socketOf(s, c)));
  if (ready.length) {
    const next = choose([...ready, ...strays]);
    return [ready.includes(next) ? 'take' : 'bring', next.id];
  }
  const lift = pending.find((c) => loose(c) && padChar(s, c));
  if (lift) return ['lift', lift.id];
  const soon = (c) => {
    const band = takeAt(socketOf(s, c));
    return loose(c) && Math.abs(c.T - (c.T > band.hi ? band.hi : band.lo)) <= RULES.settleNear;
  };
  const near = pending.find((c) => soon(c) && !padChar(s, c));
  if (near) return ['settle', near.id]; // stay by a part that is about to be ready
  if (strays.length) return ['bring', choose(strays).id];
  const settling = pending.find((c) => loose(c));
  if (settling) return ['settle', settling.id];
  return ['wait', (pending.find((c) => onGoodPad(s, c)) ?? pending[0]).id];
}

function setPrompt(s, force = false) {
  const [key, subject] = wantPrompt(s);
  const id = `${key}:${subject}`;
  s.prompt.age++;
  if (id === s.prompt.id || (!force && s.prompt.age < RULES.promptHold)) return;
  s.prompt = { id, key, subject, age: 0 };
}

export function promptText(s) {
  const { key, subject } = s.prompt;
  const comp = s.comps[subject] ?? null;
  const fill = (lang) => {
    let out = PROMPTS[key][lang === 'en' ? 0 : 1];
    if (comp) {
      const k = socketOf(s, comp);
      const pad = bestPad(s, comp) ?? { ch: padChar(s, comp) ?? 'F' };
      const here = padChar(s, comp) ?? pad.ch;
      out = out
        .replace('{p}', PARTS[comp.kind][lang])
        .replace('{t}', Math.round(comp.T))
        .replace('{m}', `${Math.ceil(takeAt(k).lo)}~${Math.floor(takeAt(k).hi)}`)
        .replace('{s}', PADS[key === 'wait' || key === 'lift' ? here : pad.ch].name[lang]);
    }
    return out.replace('{g}', Math.round(s.player.glove));
  };
  return { key, en: fill('en'), zh: fill('zh') };
}

function buildStatus(s, prompt) {
  if (s.menu) {
    const { unlocked } = s.menu;
    return {
      en: `Frost Forge · ${unlocked}/${STAGES.length} workshops open · ${prompt.en}`,
      zh: `霜火工坊 · 已开放 ${unlocked}/${STAGES.length} 间工坊 · ${prompt.zh}`,
    };
  }
  const note = (lang) => (s.msg ? `${s.msg[lang]} · ` : '');
  const eta = Math.round(engineEta(s));
  const done = s.sockets.filter((k) => k.done).length;
  return {
    en: `Workshop ${s.stage + 1}/${STAGES.length} · Parts ${done}/${s.sockets.length} · HP ${Math.max(0, Math.round(s.hp))} · Engine ${Math.round(s.engine)}C, seizes in ${eta}s · ${note('en')}${prompt.en}`,
    zh: `工坊 ${s.stage + 1}/${STAGES.length} · 零件 ${done}/${s.sockets.length} · 生命 ${Math.max(0, Math.round(s.hp))} · 发动机 ${Math.round(s.engine)}度，${eta}秒后卡死 · ${note('zh')}${prompt.zh}`,
  };
}

export function snapshot(s) {
  const prompt = promptText(s);
  const p = s.player;
  const rect = (o) => ({ x: o.x - SPRITE / 2, y: o.y - SPRITE / 2, w: SPRITE, h: SPRITE });
  const held = heldComp(s);
  return {
    phase: s.phase,
    cause: s.cause,
    score: s.score,
    time: s.ticks * STEP,
    stage: s.stage + 1,
    stageCount: STAGES.length,
    stageName: STAGES[s.stage].name,
    menu: s.menu ? { ...s.menu, total: STAGES.length } : null,
    hp: Math.max(0, s.hp),
    hpMax: RULES.hpMax,
    tiles: s.grid.map((row) => row.join('')),
    ground: s.tiles.map((row, r) =>
      row.map((t, c) => (t === null || PADS[s.grid[r][c]] ? 'dry' : groundClass(t))).join(','),
    ),
    pads: s.grid.flatMap((row, r) =>
      row.flatMap((ch, c) =>
        PADS[ch] ? [{ ch, c, r, x: cx(c), y: cy(r), temp: PADS[ch].temp }] : [],
      ),
    ),
    engine: {
      temp: s.engine,
      seizeAt: RULES.seize,
      eta: engineEta(s),
      frostRate: STAGES[s.stage].frostRate,
    },
    sockets: s.sockets.map((k) => ({ ...k, x: cx(k.c), y: cy(k.r) })),
    comps: s.comps.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: c.x,
      y: c.y,
      temp: c.T,
      held: c.held,
      done: c.done,
      ready: !c.done && inWindow(c, socketOf(s, c)),
      takeReady: !c.done && takeReady(c, socketOf(s, c)),
      rect: rect(c),
    })),
    player: {
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      speed: Math.hypot(p.vx, p.vy),
      glove: p.glove,
      glow: glowLevel(s),
      tool: ['off', 'torch', 'frost'][p.tool],
      holding: held ? held.id : null,
      ground: groundAt(s, p.x, p.y),
      rect: rect(p),
    },
    hud: { top: [0, TOP], bottom: [FIELD_BOTTOM, 320] },
    prompt,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    stats: { ...s.stats },
    status: buildStatus(s, prompt),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STOPS = [
  [-90, [90, 170, 255]],
  [-30, [140, 210, 255]],
  [10, [160, 170, 185]],
  [50, [255, 205, 100]],
  [100, [255, 125, 45]],
  [150, [255, 65, 45]],
  [180, [255, 235, 210]],
];
export function heatColor(temp) {
  const t = Math.max(STOPS[0][0], Math.min(STOPS.at(-1)[0], temp));
  const i = Math.max(
    1,
    STOPS.findIndex(([at]) => at >= t),
  );
  const [t0, a] = STOPS[i - 1];
  const [t1, b] = STOPS[i];
  const k = (t - t0) / (t1 - t0);
  return `rgb(${a.map((v, n) => Math.round(v + (b[n] - v) * k)).join(',')})`;
}

const sheet = (str) => str.split(' ');
const SPRITES = {
  gear: sheet('.b.bb.b. bbbbbbbb .baaaab. bbabbabb bbabbabb .baaaab. bbbbbbbb .b.bb.b.'),
  valve: sheet('..bbbb.. .baaaab. baabbaab babbbbab baabbaab .baaaab. ..bbbb.. ...bb...'),
  coil: sheet('bbbbbbbb baaaaaab bbbbbbbb .baaaab. bbbbbbbb baaaaaab bbbbbbbb ........'),
  piston: sheet('..bbbb.. ..baab.. ..baab.. ..bbbb.. ...bb... ...bb... .bbbbbb. .baaaab.'),
};
const PLAYER = sheet('..oooo.. .oooooo. .offffo. .offffo. goooooog g.oooo.g ..oooo.. ..kk.kk.');
const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const GROUND_COLOR = {
  dry: ['#33455f', '#3a4d69'],
  wet: ['#3d6b8c', '#467596'],
  ice: ['#a8d8ee', '#bfe6f6'],
};

function drawFloor(ctx, s, f) {
  s.grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const x = c * TILE;
      const y = TOP + r * TILE;
      if (ch === '#') {
        rect(ctx, '#18202e', x, y, TILE, TILE);
        rect(ctx, '#56657f', x + 3, y + 8, TILE - 6, 5);
        rect(ctx, '#2c3a52', x + 3, y + 13, TILE - 6, 3);
        rect(ctx, '#dff3ff', x + 2, y + 1, 7, 3);
        return;
      }
      if (ch === 'E') return;
      const ground = PADS[ch] ? 'dry' : groundClass(s.tiles[r][c]);
      rect(ctx, GROUND_COLOR[ground][(r + c) % 2], x, y, TILE, TILE);
      if (ground === 'ice') {
        rect(ctx, '#ffffff', x + 4 + ((c * 7) % 9), y + 5, 6, 1);
        rect(ctx, '#7fb5d0', x + 12, y + 14 + (r % 3), 8, 1);
        if ((f + c * 17 + r * 31) % 90 < 6) rect(ctx, '#ffffff', x + 15, y + 6, 3, 3);
      } else if (ground === 'wet') {
        rect(ctx, '#8fc4e4', x + 5, y + 10, 12, 2);
        rect(ctx, '#8fc4e4', x + 9, y + 15, 8, 1);
      } else rect(ctx, '#27374f', x + 2, y + 2, 2, 2);
    }),
  );
}

function drawPad(ctx, pad, f) {
  const x = pad.c * TILE;
  const y = TOP + pad.r * TILE;
  const palette = {
    F: ['#5a1f1f', '#ff7a2f'],
    C: ['#1f3f66', '#7fd0ff'],
    W: ['#5c4a1f', '#ffc45a'],
  }[pad.ch];
  rect(ctx, palette[0], x + 1, y + 1, TILE - 2, TILE - 2);
  for (let i = 0; i < 4; i++) rect(ctx, palette[1], x + 4, y + 4 + i * 5, TILE - 8, 2);
  if (pad.ch === 'F') rect(ctx, '#ffe08a', x + 8 + (f % 14 < 7 ? 0 : 4), y + 2, 4, 3);
  if (pad.ch === 'C' && f % 40 < 20) rect(ctx, '#ffffff', x + 10, y + 3, 3, 3);
  for (let i = 0; i < 2; i++) {
    const rise = (f * 0.4 + i * 14) % 22;
    ctx.globalAlpha = 0.5 * (1 - rise / 22);
    rect(ctx, pad.ch === 'F' ? '#ffffff' : '#bfe9ff', x + 6 + i * 8, y - rise, 4, 4);
  }
  ctx.globalAlpha = 1;
  text(ctx, `${pad.temp}`, x + TILE / 2, y - 15, palette[1], 14, 'center');
}

function drawEngine(ctx, s, f) {
  const x0 = ENGINE_COL * TILE;
  const y0 = TOP + ENGINE_ROWS[0] * TILE;
  const h = (ENGINE_ROWS[1] - ENGINE_ROWS[0] + 1) * TILE;
  rect(ctx, '#202c3f', x0, y0, 3 * TILE, h);
  rect(ctx, '#5b6e8c', x0 + 2, y0 + 2, 3 * TILE - 4, 6);
  rect(ctx, '#3b4a63', x0 + 2, y0 + h - 8, 3 * TILE - 4, 6);
  const ice = Math.max(0, Math.min(1, (-s.engine - 6) / 24));
  for (let i = 0; i < 12; i++) {
    const fy = y0 + 8 + ((i * 29) % (h - 14));
    if (i / 12 < ice) rect(ctx, '#e8f8ff', x0 + 26 + ((i * 13) % 40), fy, 8 + (i % 4) * 3, 3);
  }
  s.sockets.forEach((k) => {
    const x = k.c * TILE;
    const y = TOP + k.r * TILE;
    rect(ctx, k.done ? '#2f9d55' : '#0b111b', x + 1, y + 1, TILE - 2, TILE - 2);
    rect(ctx, '#8fa6c4', x + 1, y + 1, TILE - 2, 1);
    if (k.done) drawPart(ctx, k.kind, x + 4, y + 4, '#d8ffe6');
    else {
      ctx.globalAlpha = 0.35;
      drawPart(ctx, k.kind, x + 4, y + 4, '#c9d6ee');
      ctx.globalAlpha = 1;
      text(ctx, `${k.lo}~${k.hi}`, x + TILE + 4, y + 5, '#ffe9a8', 14);
    }
    if (k.ice > 0) {
      ctx.globalAlpha = 0.35 + (0.6 * k.ice) / 100;
      rect(ctx, '#e4f8ff', x + 1, y + 1, TILE - 2, TILE - 2);
      rect(ctx, '#9fd3ea', x + 4, y + 4 + (f % 40 < 20 ? 0 : 2), 5, 2);
      ctx.globalAlpha = 1;
    }
  });
  if (f % 60 < 30 && ice > 0.5) rect(ctx, '#ff5a5a', x0 + 4, y0 + h - 18, 6, 6);
}

function drawPart(ctx, kind, x, y, color) {
  pixelSprite(ctx, SPRITES[kind], x, y, 2, { a: color, b: '#10151f' });
}

function drawComp(ctx, c, f) {
  if (c.done) return;
  const lift = c.held ? 18 : 0;
  const x = c.x - 8;
  const y = c.y - 8 - lift;
  const color = heatColor(c.T);
  if (c.T >= 60)
    for (let i = 0; i < 3; i++) {
      const rise = (f * 0.5 + i * 11) % 26;
      ctx.globalAlpha = 0.55 * (1 - rise / 26);
      rect(ctx, '#ffffff', c.x - 7 + i * 6 + Math.sin(f * 0.07 + i * 2) * 3, y - rise, 4, 4);
    }
  if (c.T <= 0)
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(f * 0.1 + i * 2);
      rect(ctx, '#e8fbff', c.x - 8 + i * 7, y + 2 + ((i * 7) % 9), 2, 2);
    }
  ctx.globalAlpha = 1;
  drawPart(ctx, c.kind, x, y, color);
  const extreme = c.T >= RULES.partWarnHot || c.T <= RULES.partWarnCold;
  if (extreme && f % 30 < 18) rect(ctx, '#ffffff', x - 2, y - 2, 20, 2);
  text(ctx, `${Math.round(c.T)}`, c.x, y + 17, color, 14, 'center');
}

function drawPlayer(ctx, s, f) {
  const p = s.player;
  const moving = Math.hypot(p.vx, p.vy) > 6;
  const bob = moving ? (Math.floor(f / 8) % 2) * 2 : Math.floor(f / 40) % 2;
  const glow = glowLevel(s);
  const x = Math.round(p.x - 8);
  const y = Math.round(p.y - 8 - bob);
  const hurt = glow === 'harm' && f % 20 < 10;
  pixelSprite(ctx, PLAYER, x, y, 2, {
    o: hurt ? '#ff4040' : '#e8742c',
    f: '#ffd9b0',
    k: '#2b2f3a',
    g: heatColor(p.glove),
  });
  if (p.tool) {
    const target = toolTarget(s);
    if (target) {
      ctx.strokeStyle = p.tool === 1 ? '#ffb347' : '#8fe3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(target.x, target.y - (target.held ? 18 : 0));
      ctx.stroke();
    }
  }
  if (glow && f % 24 < 16) {
    rect(ctx, glow === 'cold' ? '#7fd0ff' : '#ff6a3a', p.x - 5, y - 30, 10, 12);
    text(ctx, '!', p.x, y - 30, '#101010', 14, 'center');
  }
}

function drawBands(ctx, s, snap, lang, t) {
  const put = (str, x, y, color) => text(ctx, str, x, y, color, 14);
  const bottom = FIELD_BOTTOM;
  rect(ctx, '#0b111b', 0, 0, 480, TOP);
  rect(ctx, '#0b111b', 0, bottom, 480, 320 - bottom);
  rect(ctx, '#3b4a63', 0, TOP - 1, 480, 1);
  rect(ctx, '#3b4a63', 0, bottom, 480, 1);
  const hp = Math.max(0, s.hp);
  put(
    t(
      `Shop ${s.stage + 1}/${STAGES.length}  HP ${Math.round(hp)}`,
      `工坊${s.stage + 1}/${STAGES.length} 生命${Math.round(hp)}`,
    ),
    6,
    4,
    '#e8f1ff',
  );
  rect(ctx, '#3a2230', 6, 21, 130, 5);
  rect(ctx, hp < 35 ? '#ff5a5a' : '#58d68d', 6, 21, Math.round((130 * hp) / RULES.hpMax), 5);
  const eta = Math.round(engineEta(s));
  const engine = Math.round(s.engine);
  const alarm = s.engine < -22 ? '#ff9a8a' : '#bfe9ff';
  put(t(`Engine ${engine}C  seizes in ${eta}s`, `发动机${engine}度 ${eta}秒后卡死`), 164, 4, alarm);
  const at = (v) => Math.round(164 + (310 * (v - RULES.frost)) / 40);
  rect(ctx, '#233248', 164, 21, 310, 5);
  rect(ctx, heatColor(s.engine), 164, 21, Math.max(1, at(Math.min(s.engine, -5)) - 164), 5);
  rect(ctx, '#ff5a5a', at(RULES.seize), 19, 2, 9);
  put(snap.prompt[lang], 6, bottom + 2, '#ffe9a8');
  const tool = [t('off', '关'), t('TORCH', '喷灯'), t('FROST', '冷冻')][s.player.tool];
  const glove = Math.round(s.player.glove);
  const gloveText = t(`Tool X: ${tool}   Gloves ${glove}C`, `工具X：${tool}   手套${glove}度`);
  put(gloveText, 6, bottom + 18, heatColor(s.player.glove));
  const gx = (v) => 330 + Math.round(((v + 40) / 130) * 140);
  rect(ctx, '#233248', 330, bottom + 22, 140, 6);
  rect(ctx, '#58d68d', gx(RULES.warnCold), bottom + 22, gx(RULES.warnHot) - gx(RULES.warnCold), 6);
  rect(ctx, '#ffffff', Math.max(330, Math.min(468, gx(s.player.glove))), bottom + 18, 3, 14);
  if (s.msg) put(s.msg[lang], 6, bottom + 33, '#9fe3b0');
}

function drawMenu(ctx, s, env) {
  const { cursor, unlocked } = s.menu;
  const f = Math.floor(s.menuClock * 60);
  background(ctx, '#0d1624');
  rect(ctx, '#0b111b', 0, 0, 480, TOP);
  rect(ctx, '#3b4a63', 0, TOP - 1, 480, 1);
  text(ctx, env.t('Frost Forge: choose a workshop', '霜火工坊：选择工坊'), 6, 4, '#e8f1ff', 14);
  STAGES.forEach((def, i) => {
    const n = i + 1;
    const q = menuCell(n);
    const open = n <= unlocked;
    rect(ctx, n === cursor ? '#ffe9a8' : '#3b4a63', q.x, q.y, q.w, q.h);
    rect(ctx, open ? '#1d2a40' : '#121a28', q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    if (open && n < unlocked) rect(ctx, '#58d68d', q.x + 2, q.y + 2, q.w - 4, 4);
    if (n === unlocked && f % 60 < 40) rect(ctx, '#ffb347', q.x + 2, q.y + 2, q.w - 4, 4);
    text(ctx, `${n}`, q.x + q.w / 2, q.y + 10, open ? '#ffffff' : '#56657f', 16, 'center');
    def.sockets.forEach((k, j) => {
      const dot = n < unlocked ? '#58d68d' : open ? '#ffe9a8' : '#3b4a63';
      rect(ctx, dot, q.x + q.w / 2 - def.sockets.length * 6 + j * 12 + 2, q.y + q.h - 12, 8, 6);
    });
  });
  rect(ctx, '#0b111b', 0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  rect(ctx, '#3b4a63', 0, FIELD_BOTTOM, 480, 1);
  const name = STAGES[cursor - 1].name;
  const line = env.t(`${cursor}. ${name.en}`, `${cursor}. ${name.zh}`);
  text(ctx, line, 6, FIELD_BOTTOM + 2, '#ffe9a8', 14);
  text(ctx, snapshot(s).prompt[env.lang], 6, FIELD_BOTTOM + 18, '#bfe9ff', 14);
  if (s.msg) text(ctx, s.msg[env.lang], 6, FIELD_BOTTOM + 33, '#ff9a8a', 14);
}

export function render(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  const f = s.ticks;
  background(ctx, '#0d1624');
  drawFloor(ctx, s, f);
  for (const pad of snapshot(s).pads) drawPad(ctx, pad, f);
  drawEngine(ctx, s, f);
  s.comps.forEach((c) => !c.held && drawComp(ctx, c, f));
  drawPlayer(ctx, s, f);
  s.comps.forEach((c) => c.held && drawComp(ctx, c, f));
  drawBands(ctx, s, snapshot(s), env.lang, env.t);
  if (s.clear > 0) text(ctx, env.t('REPAIRED!', '修好了！'), 240, 130, '#9fe3b0', 16, 'center');
}

// ---------------------------------------------------------------------------
// Public game
// ---------------------------------------------------------------------------

export function createGame(env) {
  const s = newState();
  let unlocked = Math.max(1, Math.min(STAGES.length, Math.floor(env.progress?.unlocked?.()) || 1));
  if (unlocked > 1) openMenu(s, unlocked);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.unlockTo > unlocked) {
        unlocked = s.unlockTo;
        env.progress?.unlock?.(unlocked);
      }
      if (s.phase === 'playing' || ended) return;
      ended = true;
      const won = s.phase === 'won';
      env.end({
        won,
        score: Math.round(s.score),
        message: won
          ? env.t(
              'Every engine is running. Frost Forge is warm again!',
              '所有发动机都启动了，霜火工坊重新暖和起来！',
            )
          : s.cause === 'engine'
            ? env.t(
                'The engine froze solid. Warm parts faster next time.',
                '发动机冻死了。下次要更快地加热零件。',
              )
            : env.t(
                'Your hands gave out. Put hot and cold parts down in time.',
                '你的双手撑不住了。要及时放下过热或过冷的零件。',
              ),
      });
    },
    draw(ctx) {
      render(ctx, s, env);
    },
    getState() {
      return snapshot(s);
    },
  };
}
