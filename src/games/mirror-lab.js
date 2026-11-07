import { background, drawPixelText as text } from '../shared/utils.js';
import { ROOM_DEFS } from './mirror-lab-rooms.js';

// --- Optics rules -------------------------------------------------------------------------
// Directions are 0 right, 1 down, 2 left, 3 up (screen coordinates, y grows downward).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const ARROW_GLYPH = ['→', '↓', '←', '↑'];

// A '/' mirror (orientation 0) turns right into up, up into right, left into down and down into left.
// A '\' mirror (orientation 1) turns right into down, down into right, left into up and up into left.
export const reflect = (dir, orientation) => (orientation === 0 ? 3 - dir : dir ^ 1);

export const RULES = Object.freeze({
  step: 1 / 120, // fixed simulation step, seconds
  maxDt: 0.1,
  cell: 36,
  maxCols: 10,
  maxRows: 7,
  maxToggles: 12,
  beamSpeed: 40, // cells per second
  settle: 0.6, // the finished beam must hold still this long before a room is judged
  clearPause: 1.8,
  historyMax: 400,
  movesMax: 999,
  msgTime: 1.6,
  clearScore: 100,
  extraMovePenalty: 8,
  minRoomScore: 20,
  menuCols: 6,
});
const R = RULES;
const STEP = R.step;
const CELL = R.cell;
const GRID_TOP = 44;
const GRID_AREA_H = 248;
const MENU = Object.freeze({ x: 48, y: 74, w: 64, h: 44 });

// --- Room authoring -------------------------------------------------------------------------
// Legend: # wall, . floor, > v < ^ laser emitter (the arrow is the way it fires),
// / \ rotatable mirror, a b locked mirror (/ and \), s t rotatable splitter (/ and \),
// c d locked splitter (/ and \), 1-9 sensors, X crystal that must stay dark,
// = closed shutter, _ open shutter. A splitter passes the beam on AND reflects a second beam.
const SIMPLE = {
  '#': { k: 'wall' },
  '.': { k: 'floor' },
  '/': { k: 'mirror', o: 0, fixed: false },
  '\\': { k: 'mirror', o: 1, fixed: false },
  a: { k: 'mirror', o: 0, fixed: true },
  b: { k: 'mirror', o: 1, fixed: true },
  s: { k: 'splitter', o: 0, fixed: false },
  t: { k: 'splitter', o: 1, fixed: false },
  c: { k: 'splitter', o: 0, fixed: true },
  d: { k: 'splitter', o: 1, fixed: true },
  X: { k: 'crystal' },
  '=': { k: 'shutter', open: 0 },
  _: { k: 'shutter', open: 1 },
};
const EMITTER_CHARS = '>v<^';
const MIRROR_CHARS = { mirror: ['/', '\\', 'a', 'b'], splitter: ['s', 't', 'c', 'd'] };

function cellFor(ch) {
  if (SIMPLE[ch]) return { ...SIMPLE[ch] };
  if (EMITTER_CHARS.includes(ch)) return { k: 'emitter', d: EMITTER_CHARS.indexOf(ch) };
  if (/[1-9]/.test(ch)) return { k: 'sensor', n: Number(ch) };
  throw new Error(`Unknown room symbol "${ch}"`);
}

export function parseRoom(def) {
  const { rows } = def;
  const w = rows[0].length;
  const h = rows.length;
  if (w > R.maxCols || h > R.maxRows) throw new Error(`Room ${def.name[0]} is too large`);
  const cells = [];
  const emitters = [];
  const toggles = [];
  const toggleOf = Array(w * h).fill(-1);
  let sensors = 0;
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`Room ${def.name[0]} has a ragged row`);
    [...row].forEach((ch, x) => {
      const cell = cellFor(ch);
      if (cell.k === 'emitter') emitters.push({ x, y, d: cell.d });
      if (cell.k === 'sensor') sensors = Math.max(sensors, cell.n);
      if (cell.k === 'shutter' || ((cell.k === 'mirror' || cell.k === 'splitter') && !cell.fixed)) {
        toggleOf[y * w + x] = toggles.length;
        toggles.push(y * w + x);
      }
      cells.push(cell);
    });
  });
  if (toggles.length > R.maxToggles) throw new Error(`Room ${def.name[0]} has too many toggles`);
  if (!emitters.length) throw new Error(`Room ${def.name[0]} has no emitter`);
  for (let n = 1; n <= sensors; n++)
    if (!cells.some((c) => c.k === 'sensor' && c.n === n))
      throw new Error(`Room ${def.name[0]} lacks sensor ${n}`);
  return {
    name: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    w,
    h,
    cells,
    emitters,
    sensors,
    toggles,
    toggleOf,
    ordered: Boolean(def.ordered),
    budget: def.budget ?? null,
  };
}

// The board as text for the current switch settings: a mirror shows as / or \ whatever turned it.
export function rowsAt(room, bits) {
  const out = [];
  for (let y = 0; y < room.h; y++) {
    let line = '';
    for (let x = 0; x < room.w; x++) {
      const i = y * room.w + x;
      const c = room.cells[i];
      const flip = room.toggleOf[i] >= 0 ? (bits >> room.toggleOf[i]) & 1 : 0;
      if (c.k === 'mirror' || c.k === 'splitter')
        line += MIRROR_CHARS[c.k][(c.fixed ? 2 : 0) + (c.o ^ flip)];
      else if (c.k === 'shutter') line += c.open ^ flip ? '_' : '=';
      else if (c.k === 'emitter') line += EMITTER_CHARS[c.d];
      else if (c.k === 'sensor') line += String(c.n);
      else line += c.k === 'wall' ? '#' : c.k === 'crystal' ? 'X' : '.';
    }
    out.push(line);
  }
  return out;
}

// --- Beam tracing ---------------------------------------------------------------------------
// All beams advance one cell per tick, so a split beam races down both branches together. A
// beam state is (cell, direction, sensor progress); meeting a state twice means a loop and that
// branch ends. In an ordered room a sensor only registers when the beam that reaches it has
// already passed every lower-numbered sensor.
export function traceBeam(room, bits) {
  const { w, h, cells } = room;
  const steps = [];
  const lit = Array(room.sensors).fill(-1);
  const crystals = [];
  const seen = new Set();
  let looped = false;
  let frontier = [];
  for (const e of room.emitters) {
    steps.push({ x: e.x, y: e.y, din: -1, outs: [e.d], t: 0 });
    frontier.push({ x: e.x, y: e.y, d: e.d, p: 0 });
  }
  let t = 0;
  while (frontier.length) {
    t++;
    const next = [];
    for (const f of frontier) {
      const x = f.x + DX[f.d];
      const y = f.y + DY[f.d];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      const c = cells[i];
      const flip = room.toggleOf[i] >= 0 ? (bits >> room.toggleOf[i]) & 1 : 0;
      if (c.k === 'wall' || c.k === 'emitter' || (c.k === 'shutter' && !(c.open ^ flip))) continue;
      if (c.k === 'crystal') {
        steps.push({ x, y, din: f.d, outs: [], t });
        crystals.push({ x, y, t });
        continue;
      }
      const key = (i * 4 + f.d) * 10 + f.p;
      if (seen.has(key)) {
        looped = true;
        continue;
      }
      seen.add(key);
      let p = f.p;
      if (c.k === 'sensor' && (!room.ordered || c.n <= p + 1)) {
        if (lit[c.n - 1] < 0) lit[c.n - 1] = t;
        if (room.ordered) p = Math.max(p, c.n);
      }
      const turned = reflect(f.d, c.o ^ flip);
      let outs = [f.d];
      if (c.k === 'mirror') outs = [turned];
      if (c.k === 'splitter') outs = [f.d, turned];
      steps.push({ x, y, din: f.d, outs, t });
      for (const d of outs) next.push({ x, y, d, p });
    }
    frontier = next;
  }
  const litCount = lit.filter((n) => n >= 0).length;
  return {
    steps,
    lit,
    litCount,
    crystals,
    looped,
    maxT: steps.reduce((m, s) => Math.max(m, s.t), 0),
    solved: litCount === room.sensors && crystals.length === 0,
  };
}

// --- Solver ---------------------------------------------------------------------------------
// A room's settings are a bit mask over its switches (turnable mirrors, splitters, shutters).
// `dist[mask]` is the fewest turns that reach a solved board from that mask.
const SOLVED = new WeakMap();
export function solveRoom(room) {
  if (SOLVED.has(room)) return SOLVED.get(room);
  const k = room.toggles.length;
  const dist = new Uint8Array(1 << k).fill(255);
  const queue = [];
  for (let m = 0; m < 1 << k; m++)
    if (traceBeam(room, m).solved) {
      dist[m] = 0;
      queue.push(m);
    }
  const wins = queue.length;
  for (let q = 0; q < queue.length; q++)
    for (let i = 0; i < k; i++) {
      const n = queue[q] ^ (1 << i);
      if (dist[n] === 255) {
        dist[n] = dist[queue[q]] + 1;
        queue.push(n);
      }
    }
  const solution = { dist, wins, optimal: dist[0] };
  SOLVED.set(room, solution);
  return solution;
}

// The next useful move from the current settings: the nearest switch whose turn lies on a shortest
// way to a solved board, or an undo when the moves left are too few to finish from here.
export function advise(room, bits, cursor, movesLeft, canUndo) {
  const { dist } = solveRoom(room);
  const d = dist[bits];
  if (d === 0) return { kind: 'done' };
  if (d > movesLeft && canUndo) return { kind: 'undo' };
  let best = null;
  room.toggles.forEach((ci, i) => {
    if (dist[bits ^ (1 << i)] !== d - 1) return;
    const x = ci % room.w;
    const y = Math.floor(ci / room.w);
    const total = Math.abs(x - cursor.x) + Math.abs(y - cursor.y);
    if (!best || total < best.total) best = { x, y, total, cell: room.cells[ci] };
  });
  const dx = best.x - cursor.x;
  const dy = best.y - cursor.y;
  const dir = dx !== 0 ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
  return {
    kind: best.total ? 'move' : 'act',
    x: best.x,
    y: best.y,
    // The length of the first leg, along `dir`: the number the prompt shows beside its arrow.
    steps: dir % 2 === 0 ? Math.abs(dx) : Math.abs(dy),
    dir,
    cell: best.cell,
  };
}

const NOUN = {
  mirror: ['mirror', '镜子'],
  splitter: ['splitter', '分光镜'],
  shutter: ['shutter', '光闸'],
};
const PLAIN = {
  menu: ['Choose a room: arrows, then Space', '选择房间：方向键，再按空格'],
  watch: ['Hold still: watch the beam', '别动，看光束走完'],
  cleared: ['Room clear! Next room coming', '过关！即将进入下一间'],
  won: ['Every room is clear. Well done!', '全部房间已通关，做得好！'],
  lost: ['Out of moves: the room failed', '步数用完：本房间失败'],
  undo: ['Too few moves left: press Z to undo', '剩余步数不足：按 Z 撤销'],
};

export function adviceLine(adv) {
  if (adv.kind === 'undo') return PLAIN.undo;
  if (adv.kind === 'done') return PLAIN.watch;
  const [en, zh] = NOUN[adv.cell.k];
  if (adv.kind === 'move')
    return [
      `Move cursor ${ARROW_GLYPH[adv.dir]} ${adv.steps} to the glowing ${en}`,
      `光标向${'右下左上'[adv.dir]}移 ${adv.steps} 格到发光的${zh}`,
    ];
  if (adv.cell.k === 'shutter') return [`Press X to flip the ${en}`, `按 X 切换${zh}`];
  return [`Press Space to turn the ${en}`, `按空格转动${zh}`];
}

// --- Room list ------------------------------------------------------------------------------
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value))
    Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};
export const ROOMS = deepFreeze(ROOM_DEFS.map(parseRoom));
export const ROOM_COUNT = ROOMS.length;

// --- Metadata -------------------------------------------------------------------------------
const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));
export const meta = {
  id: 'mirror-lab',
  name: { en: 'Mirror Lab', zh: '镜光实验室' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: `A laser fires across a dark optical bench. Move the cursor over a mirror and turn it so the beam bends, bounces and lights every numbered sensor. Walls and closed shutters stop the beam, splitters send out a second beam, crystals must stay dark, and some rooms light sensors only in number order or allow a limited number of turns. Undo freely and a glowing hint names the next move. Clear all ${ROOM_COUNT} rooms; progress is saved.`,
    zh: `一束激光射过漆黑的光学实验台。把光标移到镜子上并转动它，让光束拐弯、反射，点亮每一个编号传感器。墙和关闭的光闸会挡住光束，分光镜会分出第二束光，水晶必须保持黑暗；有些房间要求按编号顺序点亮，或限制转动次数。可以随时撤销，发光提示会告诉你下一步。完成全部 ${ROOM_COUNT} 个房间，进度会被保存。`,
  },
  keys: [
    { label: { en: 'Move the cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    {
      label: { en: 'Turn the mirror or flip the shutter', zh: '转动镜子或切换光闸' },
      keys: 'Space',
    },
    { label: { en: 'Flip a shutter', zh: '切换光闸' }, keys: 'X' },
    { label: { en: 'Undo the last turn', zh: '撤销上一步' }, keys: 'Z' },
    { label: { en: 'Reset this room', zh: '重置本房间' }, keys: 'Q' },
    {
      label: {
        en: 'Tap a cell to select it, tap again to turn it',
        zh: '点一下选中格子，再点一下转动',
      },
      keys: { en: 'Tap', zh: '点按' },
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Turn', '转动', 'right'],
    ['KeyX', 'Shutter', '光闸', 'right'],
    ['KeyZ', 'Undo', '撤销', 'right'],
    ['KeyQ', 'Reset', '重置', 'right'],
  ]),
};

// --- Geometry helpers -----------------------------------------------------------------------
export function gridOrigin(room) {
  return {
    x: Math.floor((480 - room.w * CELL) / 2),
    y: GRID_TOP + Math.floor((GRID_AREA_H - room.h * CELL) / 2),
  };
}
export function cellAt(room, px, py) {
  const o = gridOrigin(room);
  const x = Math.floor((px - o.x) / CELL);
  const y = Math.floor((py - o.y) / CELL);
  return px >= o.x && py >= o.y && x < room.w && y < room.h ? { x, y } : null;
}
export function menuCellAt(px, py) {
  const col = Math.floor((px - MENU.x) / MENU.w);
  const row = Math.floor((py - MENU.y) / MENU.h);
  const n = row * R.menuCols + col + 1;
  const inside = px >= MENU.x && py >= MENU.y && col < R.menuCols && row >= 0;
  return inside && n <= ROOM_COUNT ? n : -1;
}

// --- Game state -----------------------------------------------------------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const DIR_CODES = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isNaN(n) ? 1 : clamp(n, 1, ROOM_COUNT);
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}

const movesLeftOf = (s) => (s.room.budget === null ? Infinity : s.room.budget - s.moves);
const say = (s, en, zh) => {
  s.msg = { en, zh, time: R.msgTime };
};

function retrace(s) {
  s.trace = traceBeam(s.room, s.bits);
  s.tr = 0;
  s.settle = 0;
  s.resolved = false;
  s.chimed = s.trace.lit.map(() => false);
  s.crystalSeen = s.trace.crystals.map(() => false);
}

function refresh(s) {
  const cursor = { x: s.cx, y: s.cy };
  let adv = { kind: 'none' };
  let words;
  if (s.menu) words = PLAIN.menu;
  else if (s.phase === 'won') words = PLAIN.won;
  else if (s.phase === 'lost') words = PLAIN.lost;
  else if (s.cleared) words = PLAIN.cleared;
  else {
    adv = advise(s.room, s.bits, cursor, movesLeftOf(s), s.history.length > 0);
    words = adviceLine(adv);
  }
  s.line = { en: words[0], zh: words[1] };
  const key = { move: DIR_CODES[adv.dir], undo: 'KeyZ' }[adv.kind];
  const act = adv.kind === 'act' ? (adv.cell.k === 'shutter' ? 'KeyX' : 'Space') : null;
  s.hint = {
    kind: adv.kind,
    x: adv.x ?? null,
    y: adv.y ?? null,
    dir: adv.dir ?? null,
    steps: adv.steps ?? 0,
    key: key ?? act,
  };
}

function loadRoom(s, index) {
  s.index = index;
  s.room = ROOMS[index];
  s.bits = 0;
  s.moves = 0;
  s.history = [];
  s.cx = s.room.emitters[0].x;
  s.cy = s.room.emitters[0].y;
  s.cleared = false;
  s.clearT = 0;
  s.msg = null;
  s.sensorCells = s.room.cells.map((c, i) => (c.k === 'sensor' ? i : -1)).filter((i) => i >= 0);
  retrace(s);
  refresh(s);
}

function newState(env) {
  const s = {
    phase: 'playing',
    score: 0,
    menu: null,
    ended: false,
    restarts: 0,
    undos: 0,
    sparks: [],
    clock: 0,
    acc: 0,
    progress: env.progress || null,
  };
  const unlocked = s.progress ? readUnlocked(s.progress) : 1;
  loadRoom(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    refresh(s);
  }
  return s;
}

function finish(s, env, won, message) {
  if (s.ended) return;
  s.ended = true;
  env.end({ won, score: s.score, message });
}

function clearRoom(s, env) {
  const extra = Math.max(0, s.moves - solveRoom(s.room).optimal);
  s.score += Math.max(R.minRoomScore, R.clearScore - R.extraMovePenalty * extra);
  saveUnlocked(s.progress, Math.min(ROOM_COUNT, s.index + 2));
  s.cleared = true;
  env.sound('win');
  if (s.index + 1 >= ROOM_COUNT) {
    s.phase = 'won';
    finish(
      s,
      env,
      true,
      env.t('Every room is clear. The bench is yours!', '全部房间通关，实验台归你了！'),
    );
  }
  refresh(s);
}

function loseRoom(s, env) {
  s.phase = 'lost';
  env.sound('lose');
  finish(
    s,
    env,
    false,
    env.t(
      `Out of turns in room ${s.index + 1}. Try it again.`,
      `第 ${s.index + 1} 间的转动次数用完了，再试一次。`,
    ),
  );
  refresh(s);
}

function spark(s, x, y, color) {
  for (let i = 0; i < 6 && s.sparks.length < 80; i++) {
    const a = (i / 6) * Math.PI * 2;
    s.sparks.push({ x, y, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, life: 0.4, color });
  }
}

function centreOf(s, x, y) {
  const o = gridOrigin(s.room);
  return { x: o.x + x * CELL + CELL / 2, y: o.y + y * CELL + CELL / 2 };
}

function stepSim(s, env) {
  s.clock += STEP;
  s.sparks = s.sparks
    .map((p) => ({ ...p, x: p.x + p.vx * STEP, y: p.y + p.vy * STEP, life: p.life - STEP }))
    .filter((p) => p.life > 0);
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.cleared) {
    s.clearT += STEP;
    if (s.phase === 'playing' && s.clearT >= R.clearPause) loadRoom(s, s.index + 1);
    return;
  }
  const end = s.trace.maxT + 1;
  if (s.tr < end) {
    s.tr = Math.min(end, s.tr + R.beamSpeed * STEP);
    revealEffects(s, env);
    return;
  }
  s.settle += STEP;
  if (s.resolved || s.settle < R.settle) return;
  s.resolved = true;
  if (s.trace.solved) clearRoom(s, env);
  else if (movesLeftOf(s) <= 0) loseRoom(s, env);
}

function revealEffects(s, env) {
  const { lit, crystals } = s.trace;
  lit.forEach((t, k) => {
    if (s.chimed[k] || t < 0 || s.tr < t) return;
    s.chimed[k] = true;
    env.sound('coin');
    const i = s.sensorCells.find((ci) => s.room.cells[ci].n === k + 1);
    const c = centreOf(s, i % s.room.w, Math.floor(i / s.room.w));
    spark(s, c.x, c.y, '#7dffb2');
  });
  crystals.forEach((c, k) => {
    if (s.crystalSeen[k] || s.tr < c.t) return;
    s.crystalSeen[k] = true;
    env.sound('hit');
    const p = centreOf(s, c.x, c.y);
    spark(s, p.x, p.y, '#ff5c8a');
  });
}

// --- Player actions -------------------------------------------------------------------------
function turnUnderCursor(s, env, shutterOnly) {
  const i = s.cy * s.room.w + s.cx;
  const cell = s.room.cells[i];
  const ti = s.room.toggleOf[i];
  if (ti < 0 || (shutterOnly && cell.k !== 'shutter')) {
    if (cell.fixed) say(s, 'Bolted down: this one will not turn', '已被锁定，无法转动');
    else say(s, 'Nothing to turn here', '这里没有可转动的东西');
    env.sound('hit');
    return;
  }
  if (movesLeftOf(s) <= 0) {
    say(s, 'No turns left: undo with Z', '没有剩余次数：按 Z 撤销');
    env.sound('hit');
    return;
  }
  s.history.push({ bits: s.bits, moves: s.moves, x: s.cx, y: s.cy });
  if (s.history.length > R.historyMax) s.history.shift();
  s.bits ^= 1 << ti;
  s.moves = Math.min(R.movesMax, s.moves + 1);
  env.sound('move');
  retrace(s);
  refresh(s);
}

function undoTurn(s, env) {
  const last = s.history.pop();
  if (!last) {
    say(s, 'Nothing to undo', '没有可撤销的操作');
    return;
  }
  s.bits = last.bits;
  s.moves = last.moves;
  s.cx = last.x;
  s.cy = last.y;
  s.undos++;
  env.sound('move');
  retrace(s);
  refresh(s);
}

function restartRoom(s, env) {
  const { index } = s;
  const restarts = s.restarts + 1;
  loadRoom(s, index);
  s.restarts = restarts;
  say(s, 'Room reset', '房间已重置');
  env.sound('move');
}

function moveCursor(s, env, input) {
  const dx =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const dy =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  if ((dx === 0) === (dy === 0)) return; // idle, opposite keys or a diagonal press
  const x = clamp(s.cx + dx, 0, s.room.w - 1);
  const y = clamp(s.cy + dy, 0, s.room.h - 1);
  if (x === s.cx && y === s.cy) return;
  s.cx = x;
  s.cy = y;
  env.sound('move');
  refresh(s);
}

function playInput(s, env, input) {
  const p = input.pointer;
  if (p?.clicked) {
    const hit = cellAt(s.room, p.x, p.y);
    if (hit && hit.x === s.cx && hit.y === s.cy) turnUnderCursor(s, env, false);
    else if (hit) {
      s.cx = hit.x;
      s.cy = hit.y;
      env.sound('move');
      refresh(s);
    }
  }
  moveCursor(s, env, input);
  if (input.pressed('KeyQ')) return restartRoom(s, env);
  if (input.pressed('KeyZ')) undoTurn(s, env);
  if (input.pressed('Space')) turnUnderCursor(s, env, false);
  if (input.pressed('KeyX')) turnUnderCursor(s, env, true);
}

function menuInput(s, env, input) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * R.menuCols, 1, m.unlocked);
  if (sel !== m.sel) env.sound('move');
  m.sel = sel;
  let go = false;
  const p = input.pointer;
  if (p?.clicked) {
    const hit = menuCellAt(p.x, p.y);
    if (hit >= 1 && hit <= m.unlocked) {
      go = hit === m.sel;
      m.sel = hit;
    }
  }
  if (go || input.pressed('Space', 'Enter')) {
    loadRoom(s, m.sel - 1);
    s.menu = null;
    refresh(s);
    env.sound('move');
  }
}

function frameInput(s, env, input) {
  if (s.menu) return menuInput(s, env, input);
  if (s.cleared) {
    if (input.pressed('Space', 'Enter') && s.phase === 'playing') loadRoom(s, s.index + 1);
    return undefined;
  }
  return playInput(s, env, input);
}

// --- Rendering ------------------------------------------------------------------------------
const C = {
  bg: '#080c18',
  tile: '#0f1830',
  grid: '#18274a',
  wall: '#2b3656',
  wallHi: '#46557f',
  text: '#dfe8ff',
  dim: '#7d8db8',
  beam: '#ff5873',
  beamCore: '#ffd4dc',
  mirror: '#bfeaff',
  mirrorEdge: '#4f9bff',
  split: '#e0b0ff',
  lit: '#5dfc9c',
  hint: '#ffe27a',
  bad: '#ff5c8a',
};
const rect = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

function drawSegment(ctx, x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  const horizontal = w >= h;
  const wide = (th) => (horizontal ? [x, y - th / 2, w, th] : [x - th / 2, y, th, h]);
  ctx.globalAlpha = 0.35;
  rect(ctx, ...wide(10), C.beam);
  ctx.globalAlpha = 1;
  rect(ctx, ...wide(4), C.beam);
  rect(ctx, ...wide(2), C.beamCore);
}

function drawBeam(ctx, s) {
  const o = gridOrigin(s.room);
  const half = CELL / 2;
  for (const step of s.trace.steps) {
    const q = clamp(s.tr - (step.t - 1), 0, 1);
    if (q <= 0) continue;
    const cx = o.x + step.x * CELL + half;
    const cy = o.y + step.y * CELL + half;
    if (step.din >= 0) {
      const f = Math.min(1, q * 2);
      const ex = cx - DX[step.din] * half;
      const ey = cy - DY[step.din] * half;
      drawSegment(ctx, ex, ey, ex + (cx - ex) * f, ey + (cy - ey) * f);
    }
    const g = Math.max(0, q * 2 - 1);
    for (const d of step.outs)
      drawSegment(ctx, cx, cy, cx + DX[d] * half * g, cy + DY[d] * half * g);
  }
}

function drawDiagonal(ctx, x, y, orientation, color, edge, dashed) {
  for (let i = 0; i < 14; i++) {
    if (dashed && i % 3 === 1) continue;
    const bx = x + 4 + i * 2;
    const by = y + 4 + (orientation === 0 ? 13 - i : i) * 2;
    rect(ctx, bx - 1, by - 1, 6, 6, edge);
    rect(ctx, bx, by, 4, 4, color);
  }
}

function drawCell(ctx, s, i, x, y) {
  const c = s.room.cells[i];
  const ti = s.room.toggleOf[i];
  const flip = ti >= 0 ? (s.bits >> ti) & 1 : 0;
  rect(ctx, x, y, CELL, CELL, C.tile);
  rect(ctx, x, y, CELL, 1, C.grid);
  rect(ctx, x, y, 1, CELL, C.grid);
  if (c.k === 'wall') {
    rect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, C.wall);
    rect(ctx, x + 1, y + 1, CELL - 2, 3, C.wallHi);
    rect(ctx, x + 6, y + 14, 4, 4, C.wallHi);
    rect(ctx, x + 24, y + 22, 4, 4, C.wallHi);
  } else if (c.k === 'emitter') {
    rect(ctx, x + 5, y + 5, CELL - 10, CELL - 10, '#8a2a3c');
    rect(ctx, x + 9, y + 9, CELL - 18, CELL - 18, '#ff7b92');
    const nx = x + 15 + DX[c.d] * 12;
    const ny = y + 15 + DY[c.d] * 12;
    rect(ctx, nx, ny, 6, 6, C.beamCore);
  } else if (c.k === 'mirror' || c.k === 'splitter') {
    const o = c.o ^ flip;
    const split = c.k === 'splitter';
    drawDiagonal(ctx, x, y, o, split ? C.split : C.mirror, split ? '#7a3fb0' : C.mirrorEdge, split);
    if (c.fixed)
      for (const [bx, by] of [
        [3, 3],
        [28, 3],
        [3, 28],
        [28, 28],
      ])
        rect(ctx, x + bx, y + by, 4, 4, '#98a3c4');
    else rect(ctx, x + 16, y + 16, 4, 4, '#ffffff');
  } else if (c.k === 'sensor') {
    const k = c.n - 1;
    const shown = s.trace.lit[k] >= 0 && s.tr >= s.trace.lit[k];
    rect(ctx, x + 6, y + 6, CELL - 12, CELL - 12, shown ? '#1c7a4a' : '#2a3556');
    rect(ctx, x + 9, y + 9, CELL - 18, CELL - 18, shown ? C.lit : '#10172c');
    text(ctx, String(c.n), x + CELL / 2, y + 11, shown ? '#06281a' : C.dim, 13, 'center');
  } else if (c.k === 'crystal') {
    const hit = s.trace.crystals.some(
      (h, k) => h.x === i % s.room.w && h.y === Math.floor(i / s.room.w) && s.crystalSeen[k],
    );
    const body = hit && Math.floor(s.clock * 8) % 2 ? '#ffffff' : C.bad;
    for (let r = 0; r < 9; r++) {
      const w = (r < 5 ? r : 8 - r) * 4 + 4;
      rect(ctx, x + CELL / 2 - w / 2, y + 5 + r * 3, w, 3, body);
    }
    rect(ctx, x + 16, y + 14, 4, 6, '#5a1030');
  } else if (c.k === 'shutter') {
    const open = c.open ^ flip;
    if (open) {
      rect(ctx, x + 3, y + 4, CELL - 6, 3, '#8b6a30');
      rect(ctx, x + 3, y + CELL - 7, CELL - 6, 3, '#8b6a30');
    } else for (let b = 0; b < 4; b++) rect(ctx, x + 3, y + 4 + b * 8, CELL - 6, 5, '#f2a93b');
  }
}

function drawCursor(ctx, s, o) {
  const pulse = Math.floor(s.clock * 4) % 2;
  const h = s.hint;
  if (h.x !== null && (h.kind === 'move' || h.kind === 'act')) {
    const x = o.x + h.x * CELL;
    const y = o.y + h.y * CELL;
    const color = pulse ? C.hint : '#b8942a';
    rect(ctx, x, y, CELL, 3, color);
    rect(ctx, x, y + CELL - 3, CELL, 3, color);
    rect(ctx, x, y, 3, CELL, color);
    rect(ctx, x + CELL - 3, y, 3, CELL, color);
  }
  const x = o.x + s.cx * CELL;
  const y = o.y + s.cy * CELL;
  for (const [ax, ay, sx, sy] of [
    [0, 0, 1, 1],
    [CELL, 0, -1, 1],
    [0, CELL, 1, -1],
    [CELL, CELL, -1, -1],
  ]) {
    rect(ctx, sx > 0 ? x + ax : x + ax - 10, y + ay + (sy > 0 ? 0 : -3), 10, 3, '#fff');
    rect(ctx, x + ax + (sx > 0 ? 0 : -3), sy > 0 ? y + ay : y + ay - 10, 3, 10, '#fff');
  }
  if (h.kind === 'move') {
    const gx = x + CELL / 2 + DX[h.dir] * 26;
    const gy = y + CELL / 2 + DY[h.dir] * 26 - 7;
    text(ctx, ARROW_GLYPH[h.dir], gx, gy, C.hint, 16, 'center');
  }
}

function drawBanner(ctx, s, lang) {
  let banner = null;
  if (s.phase === 'won') banner = ['ALL ROOMS CLEAR', '全部通关', C.lit];
  else if (s.phase === 'lost') banner = ['OUT OF TURNS', '次数用完', C.bad];
  else if (s.cleared) banner = ['ROOM CLEAR', '过关', C.lit];
  if (!banner) return;
  ctx.globalAlpha = 0.8;
  rect(ctx, 0, 128, 480, 50, '#000');
  ctx.globalAlpha = 1;
  text(ctx, banner[lang === 'zh' ? 1 : 0], 240, 142, banner[2], 24, 'center');
}

function drawMenu(ctx, s, lang) {
  text(
    ctx,
    lang === 'zh' ? '镜光实验室：选择房间' : 'MIRROR LAB: PICK A ROOM',
    240,
    22,
    C.text,
    16,
    'center',
  );
  text(ctx, s.line[lang], 240, 48, C.hint, 12, 'center');
  for (let n = 1; n <= ROOM_COUNT; n++) {
    const x = MENU.x + ((n - 1) % R.menuCols) * MENU.w;
    const y = MENU.y + Math.floor((n - 1) / R.menuCols) * MENU.h;
    const open = n <= s.menu.unlocked;
    rect(
      ctx,
      x + 3,
      y + 3,
      MENU.w - 6,
      MENU.h - 6,
      n === s.menu.sel ? C.hint : open ? '#24366a' : '#141c34',
    );
    rect(ctx, x + 6, y + 6, MENU.w - 12, MENU.h - 12, open ? '#0f1830' : '#0b1124');
    text(ctx, String(n), x + MENU.w / 2, y + 14, open ? C.text : '#3a4668', 14, 'center');
  }
}

function drawHud(ctx, s, lang) {
  const room = s.room;
  const total = room.sensors;
  const shown = s.trace.lit.filter((t) => t >= 0 && s.tr >= t).length;
  text(ctx, `${s.index + 1}/${ROOM_COUNT}  ${room.name[lang]}`, 8, 4, C.text, 12);
  const budget = room.budget === null ? '' : `/${room.budget}`;
  const moves = lang === 'zh' ? `转动 ${s.moves}${budget}` : `Turns ${s.moves}${budget}`;
  text(
    ctx,
    moves,
    472,
    4,
    room.budget !== null && movesLeftOf(s) <= 1 ? C.bad : C.text,
    12,
    'right',
  );
  const note = s.msg || room.tip;
  text(ctx, note[lang], 8, 23, s.msg ? C.bad : C.dim, 10);
  text(ctx, `${lang === 'zh' ? '点亮' : 'Lit'} ${shown}/${total}`, 472, 23, C.lit, 10, 'right');
  text(ctx, s.line[lang], 240, 298, C.hint, 12, 'center');
}

function drawPlay(ctx, s, lang) {
  const o = gridOrigin(s.room);
  for (let i = 0; i < s.room.cells.length; i++)
    drawCell(ctx, s, i, o.x + (i % s.room.w) * CELL, o.y + Math.floor(i / s.room.w) * CELL);
  drawBeam(ctx, s);
  // Items that sit on the beam are redrawn so the beam looks like it passes through them.
  for (let i = 0; i < s.room.cells.length; i++) {
    const k = s.room.cells[i].k;
    if (k === 'mirror' || k === 'splitter' || k === 'sensor' || k === 'emitter')
      drawCell(ctx, s, i, o.x + (i % s.room.w) * CELL, o.y + Math.floor(i / s.room.w) * CELL);
  }
  for (const p of s.sparks) rect(ctx, p.x, p.y, 3, 3, p.color);
  drawCursor(ctx, s, o);
  drawHud(ctx, s, lang);
  drawBanner(ctx, s, lang);
}

function statusFor(s) {
  const line = s.line;
  if (s.menu) return { en: line.en, zh: line.zh };
  const lit = s.trace.lit.filter((t) => t >= 0 && s.tr >= t).length;
  const budget = s.room.budget === null ? '' : `/${s.room.budget}`;
  return {
    en: `Room ${s.index + 1}/${ROOM_COUNT} · Turns ${s.moves}${budget} · Lit ${lit}/${s.room.sensors} · ${line.en}`,
    zh: `第 ${s.index + 1}/${ROOM_COUNT} 间 · 转动 ${s.moves}${budget} · 点亮 ${lit}/${s.room.sensors} · ${line.zh}`,
  };
}

// --- Game -----------------------------------------------------------------------------------
export function createGame(env) {
  const s = newState(env);
  const lang = env.lang === 'zh' ? 'zh' : 'en';
  return {
    update(dt, input) {
      if (!Number.isFinite(dt) || dt <= 0 || s.phase !== 'playing') return;
      frameInput(s, env, input);
      s.acc += Math.min(dt, R.maxDt);
      while (s.acc >= STEP - 1e-9 && s.phase === 'playing') {
        s.acc -= STEP;
        if (!s.menu) stepSim(s, env);
      }
    },
    draw(ctx) {
      background(ctx, C.bg);
      if (s.menu) drawMenu(ctx, s, lang);
      else drawPlay(ctx, s, lang);
    },
    getState() {
      return {
        phase: s.phase,
        score: s.score,
        level: s.index + 1,
        levelCount: ROOM_COUNT,
        name: { ...s.room.name },
        tip: { ...s.room.tip },
        board: rowsAt(s.room, s.bits),
        cursor: { x: s.cx, y: s.cy },
        moves: s.moves,
        budget: s.room.budget,
        movesLeft: s.room.budget === null ? null : s.room.budget - s.moves,
        optimal: solveRoom(s.room).optimal,
        sensors: s.room.sensors,
        lit: s.trace.lit.map((t) => t >= 0),
        litShown: s.trace.lit.filter((t) => t >= 0 && s.tr >= t).length,
        crystalsLit: s.trace.crystals.length,
        solved: s.trace.solved,
        cleared: s.cleared,
        beam: { progress: s.tr, length: s.trace.maxT + 1, looped: s.trace.looped },
        undos: s.undos,
        restarts: s.restarts,
        menu: s.menu ? { ...s.menu } : null,
        message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
        line: { ...s.line },
        hint: { ...s.hint },
        status: statusFor(s),
      };
    },
  };
}
