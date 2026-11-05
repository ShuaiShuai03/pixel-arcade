import { background, drawPixelText as text, clamp } from '../shared/utils.js';

export const meta = {
  id: 'blockfall',
  name: { en: 'Blockfall', zh: '方块降临' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Build through three city districts: complete four lines, excavate marked rubble, then clear four lines together to power the city. Preview the next three pieces and hold one for later. X retries this district with its original board, queue and score.',
    zh: '建设三个城区：先消除四行，再清除标记碎砖，最后一次消除四行点亮城市。可预览接下来三个方块，并暂存一个留待后用。X会用原始棋盘、队列和分数重试本城区。',
  },
  keys: [
    { label: { en: 'Move / soft drop', zh: '移动 / 软降' }, keys: 'Arrows / WASD' },
    { label: { en: 'Rotate / reverse', zh: '旋转 / 反转' }, keys: 'Up / W / Z' },
    { label: { en: 'Hard drop', zh: '瞬间落下' }, keys: 'Space' },
    { label: { en: 'Hold once per lock', zh: '每次锁定前暂存一次' }, keys: 'C / Shift' },
    {
      label: {
        en: 'Retry this district (restores entry score and queue)',
        zh: '重试本城区（恢复初始分数和队列）',
      },
      keys: 'X',
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Turn ↻', zh: '顺转↻' } },
    { code: 'KeyZ', label: { en: 'Turn ↺', zh: '逆转↺' } },
    { code: 'ArrowDown', label: { en: 'Soft drop', zh: '软降' } },
    { code: 'Space', label: { en: 'Drop', zh: '落下' } },
    { code: 'KeyC', label: { en: 'Hold', zh: '暂存' } },
    { code: 'KeyX', label: { en: 'Retry district', zh: '重试城区' } },
  ],
};
export const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [2, 2],
    [2, 2],
  ],
  T: [
    [0, 3, 0],
    [3, 3, 3],
    [0, 0, 0],
  ],
  S: [
    [0, 4, 4],
    [4, 4, 0],
    [0, 0, 0],
  ],
  Z: [
    [5, 5, 0],
    [0, 5, 5],
    [0, 0, 0],
  ],
  J: [
    [6, 0, 0],
    [6, 6, 6],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 7],
    [7, 7, 7],
    [0, 0, 0],
  ],
};
const COLORS = [
  '',
  '#69c6cd',
  '#e5c786',
  '#b4a2ca',
  '#99be91',
  '#d58f8d',
  '#8badd0',
  '#daa981',
  '#7f8d9b',
];
const X = 167,
  Y = 24,
  CELL = 14;
export function rotatePiece(matrix, clockwise = true) {
  const n = matrix.length;
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (clockwise ? matrix[n - 1 - x][y] : matrix[x][n - 1 - y])),
  );
}
// Rotation offsets use a stable pivot and include both wall and floor recovery.
const NORMAL_KICKS = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};
const LONG_KICKS = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};
export function turnPiece(board, piece, clockwise = true) {
  const rotation = (piece.rotation + (clockwise ? 1 : 3)) % 4;
  const matrix = rotatePiece(piece.matrix, clockwise);
  const offsets =
    piece.name === 'O'
      ? [[0, 0]]
      : (piece.name === 'I' ? LONG_KICKS : NORMAL_KICKS)[`${piece.rotation}>${rotation}`];
  for (const [dx, dy] of offsets) {
    const x = piece.x + dx,
      y = piece.y - dy;
    const path = (firstX) => {
      let px = piece.x,
        py = piece.y;
      for (const axis of firstX ? ['x', 'y'] : ['y', 'x']) {
        const n = axis === 'x' ? dx : -dy,
          step = Math.sign(n);
        for (let k = 0; k < Math.abs(n); k++) {
          if (axis === 'x') px += step;
          else py += step;
          if (!canPlace(board, piece.matrix, px, py)) return false;
        }
      }
      return true;
    };
    if (canPlace(board, matrix, x, y) && (path(true) || path(false)))
      return { ...piece, matrix, x, y, rotation };
  }
  return piece;
}
export function canPlace(board, matrix, px, py) {
  if (!Number.isInteger(px) || !Number.isInteger(py)) return false;
  return matrix.every((row, y) =>
    row.every(
      (value, x) =>
        !value ||
        (px + x >= 0 &&
          px + x < 10 &&
          py + y >= -2 &&
          py + y < 20 &&
          (py + y < 0 || !board[py + y][px + x])),
    ),
  );
}
export function clearRows(board) {
  const kept = board.filter((row) => row.some((value) => !value)).map((row) => row.slice());
  const count = board.length - kept.length;
  return { count, board: [...Array.from({ length: count }, () => Array(10).fill(0)), ...kept] };
}
const EPS = 1e-8,
  LOCK = 0.5,
  CONTACT_LIMIT = 3;
const DISTRICTS = [
  {
    en: 'FOUNDATION',
    zh: '基础区',
    goal: { en: 'CLEAR 4 LINES', zh: '消除4行' },
    hint: {
      en: 'Build flat. Use Hold to save a useful shape.',
      zh: '平整堆叠，可暂存需要的方块。',
    },
    interval: 0.65,
  },
  {
    en: 'REPAIR YARD',
    zh: '修复区',
    goal: { en: 'REMOVE × RUBBLE', zh: '清除×碎砖' },
    hint: {
      en: 'Two-cell shaft: clear the marked foundation. Retry restores it.',
      zh: '双格竖井：清除标记地基；重试可恢复。',
    },
    interval: 0.55,
  },
  {
    en: 'POWER SPINE',
    zh: '电力主井',
    goal: { en: '4 LINES AT ONCE', zh: '一次消除4行' },
    hint: {
      en: 'Keep column9 open. A vertical I powers all four rows.',
      zh: '保留第9列竖井，竖直长条可同时点亮四行。',
    },
    interval: 0.48,
  },
];
const occupied = (board) => board.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
function initialBoard(stage) {
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  if (stage > 1)
    for (let y = 16; y < 20; y++)
      for (let x = 0; x < 10; x++) if (stage === 2 ? ![4, 5].includes(x) : x !== 8) board[y][x] = 8;
  return board;
}
function random(s) {
  s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function take(s) {
  if (!s.bag.length) {
    s.bag = Object.keys(SHAPES);
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(random(s) * (i + 1));
      [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]];
    }
  }
  return s.bag.pop();
}
function spawn(s, name) {
  if (!name) {
    name = s.preview.shift();
    while (s.preview.length < 3) s.preview.push(take(s));
  }
  s.piece = {
    name,
    rotation: 0,
    matrix: SHAPES[name].map((r) => r.slice()),
    x: Math.floor((10 - SHAPES[name].length) / 2),
    y: 0,
  };
  s.fall = 0;
  s.groundedTime = 0;
  s.contactAge = 0;
  s.touched = false;
  s.lockResets = 0;
  s.maxDropY = 0;
  if (!canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y)) s.phase = 'lost';
}
function capture(s) {
  const names = [
    'board',
    'bag',
    'rng',
    'preview',
    'piece',
    'hold',
    'score',
    'lines',
    'stageLines',
    'placed',
    'removed',
    'injected',
    'discarded',
    'locks',
  ];
  s.checkpoint = Object.fromEntries(names.map((k) => [k, structuredClone(s[k])]));
}
function transient(s) {
  s.holdUsed = false;
  s.rearm = false;
  s.fall = 0;
  s.groundedTime = 0;
  s.contactAge = 0;
  s.touched = false;
  s.lockResets = 0;
  s.maxDropY = s.piece?.y ?? 0;
  s.clearTimer = 0;
  s.clearing = [];
  s.stageTimer = 0;
  s.buffer = null;
  s.repeat = 0.18;
  s.lastDir = 0;
  s.flash = 0;
}
function beginDistrict(s, stage) {
  s.discarded += occupied(s.board);
  s.stage = stage;
  s.board = initialBoard(stage);
  s.injected += occupied(s.board);
  s.stageLines = 0;
  s.hold = null;
  transient(s);
  spawn(s);
  capture(s);
}
export function createBlockState(seed = 1) {
  const s = {
    phase: 'playing',
    stage: 1,
    score: 0,
    lines: 0,
    stageLines: 0,
    board: initialBoard(1),
    bag: [],
    rng: seed >>> 0,
    preview: [],
    hold: null,
    piece: null,
    placed: 0,
    removed: 0,
    injected: 0,
    discarded: 0,
    locks: 0,
    retries: 0,
    time: 0,
    checkpoint: null,
  };
  while (s.preview.length < 4) s.preview.push(take(s));
  transient(s);
  spawn(s);
  capture(s);
  return s;
}
function retry(s) {
  for (const [key, value] of Object.entries(s.checkpoint)) s[key] = structuredClone(value);
  s.phase = 'playing';
  s.retries++;
  transient(s);
}
const grounded = (s) => s.piece && !canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1);
function resetLock(s) {
  if (s.touched && s.lockResets < 15 && s.contactAge < CONTACT_LIMIT - EPS) {
    s.groundedTime = 0;
    s.lockResets++;
  }
}
function shift(s, dx) {
  if (dx && canPlace(s.board, s.piece.matrix, s.piece.x + dx, s.piece.y)) {
    resetLock(s);
    s.piece.x += dx;
    return true;
  }
  return false;
}
function turn(s, direction) {
  const next = turnPiece(s.board, s.piece, direction > 0);
  if (next === s.piece) return false;
  const changed =
    next.x !== s.piece.x ||
    next.y !== s.piece.y ||
    JSON.stringify(next.matrix) !== JSON.stringify(s.piece.matrix);
  if (changed) resetLock(s);
  s.piece = next;
  s.maxDropY = Math.max(s.maxDropY, next.y);
  return changed;
}
function holdPiece(s) {
  if (s.holdUsed) return;
  const old = s.hold;
  s.hold = s.piece.name;
  s.holdUsed = true;
  spawn(s, old || undefined);
}
function descend(s, hard = false) {
  if (!canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1)) return false;
  s.piece.y++;
  if (s.piece.y > s.maxDropY) {
    s.score += hard ? 2 : 1;
    s.maxDropY = s.piece.y;
  }
  return true;
}
function commitClear(s) {
  const count = s.clearing.length;
  s.board = clearRows(s.board).board;
  s.removed += count * 10;
  s.lines += count;
  s.stageLines += count;
  s.score += [0, 100, 300, 500, 800][count] * s.stage;
  s.clearing = [];
  s.clearTimer = 0;
  s.flash = 0.3;
  const complete =
    s.stage === 1
      ? s.stageLines >= 4
      : s.stage === 2
        ? !s.board.some((r) => r.includes(8))
        : count >= 4;
  if (complete) {
    if (s.stage === 3) s.phase = 'won';
    else s.stageTimer = 0.8;
  } else {
    s.holdUsed = false;
    spawn(s);
    if (s.buffer) {
      const buffered = s.buffer;
      s.buffer = null;
      if (buffered.expires >= s.time - EPS && s.phase === 'playing') apply(s, buffered);
    }
  }
}
function lockPiece(s) {
  // Atomic validation prevents a partial stamp when any cell is above the roof or blocked.
  const p = s.piece;
  if (
    !canPlace(s.board, p.matrix, p.x, p.y) ||
    p.matrix.some((r, y) => r.some((v) => v && p.y + y < 0))
  ) {
    s.phase = 'lost';
    return;
  }
  p.matrix.forEach((r, y) =>
    r.forEach((v, x) => {
      if (v) s.board[p.y + y][p.x + x] = v;
    }),
  );
  s.placed += 4;
  s.locks++;
  s.piece = null;
  s.fall = 0;
  s.clearing = s.board.flatMap((r, y) => (r.every(Boolean) ? [y] : []));
  if (s.clearing.length) s.clearTimer = 0.22;
  else {
    s.holdUsed = false;
    spawn(s);
  }
}
function sample(input) {
  const held = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    move = Number(input.pressed('ArrowRight', 'KeyD')) - Number(input.pressed('ArrowLeft', 'KeyA')),
    rotate = Number(input.pressed('ArrowUp', 'KeyW')) - Number(input.pressed('KeyZ'));
  const opposed =
    (input.held('ArrowLeft', 'KeyA') || input.pressed('ArrowLeft', 'KeyA')) &&
    (input.held('ArrowRight', 'KeyD') || input.pressed('ArrowRight', 'KeyD'));
  return {
    held: opposed ? 0 : held,
    move: opposed ? 0 : move,
    rotate,
    soft: input.held('ArrowDown', 'KeyS'),
    hold: input.pressed('KeyC', 'ShiftLeft', 'ShiftRight'),
    drop: input.pressed('Space'),
    retry: input.pressed('KeyX'),
  };
}
function apply(s, a) {
  if (a.hold) {
    holdPiece(s);
    return 'hold';
  }
  if (s.contactAge < CONTACT_LIMIT - EPS) {
    if (a.rotate) turn(s, a.rotate);
    if (a.move) shift(s, a.move);
  }
  if (a.drop) {
    while (descend(s, true)) {}
    lockPiece(s);
    return 'drop';
  }
  return '';
}
export function stepBlock(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  let a = sample(input);
  if (a.retry && !s.rearm) {
    retry(s);
    s.rearm = true;
    a = { held: 0, move: 0, rotate: 0, soft: false, hold: false, drop: false, retry: false };
  } else if (s.rearm) {
    if (
      !input.held(
        'ArrowLeft',
        'ArrowRight',
        'ArrowDown',
        'ArrowUp',
        'KeyA',
        'KeyD',
        'KeyS',
        'KeyW',
        'KeyZ',
        'KeyC',
        'ShiftLeft',
        'ShiftRight',
        'Space',
        'KeyX',
      ) &&
      !a.move &&
      !a.rotate &&
      !a.hold &&
      !a.drop &&
      !a.retry
    )
      s.rearm = false;
    a = { held: 0, move: 0, rotate: 0, soft: false, hold: false, drop: false, retry: false };
  }
  if (a.held !== s.lastDir) {
    s.repeat = 0.18;
    s.lastDir = a.held;
    if (!a.move && a.held) a.move = a.held;
  }
  if (s.clearTimer > 0 || s.stageTimer > 0) {
    if (a.move || a.rotate || a.hold)
      s.buffer = { move: a.move, rotate: a.rotate, hold: a.hold, expires: s.time + 0.3 };
  } else if (s.piece) {
    apply(s, a);
  }
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    if (s.stageTimer > 0) {
      const t = Math.min(remaining, s.stageTimer);
      s.stageTimer = Math.max(0, s.stageTimer - t);
      s.time += t;
      remaining -= t;
      if (s.stageTimer <= EPS) {
        s.stageTimer = 0;
        beginDistrict(s, s.stage + 1);
      }
      continue;
    }
    if (s.clearTimer > 0) {
      const t = Math.min(remaining, s.clearTimer);
      s.clearTimer = Math.max(0, s.clearTimer - t);
      s.time += t;
      remaining -= t;
      if (s.clearTimer <= EPS) commitClear(s);
      continue;
    }
    if (!s.piece) break;
    if (s.buffer) {
      const b = s.buffer;
      s.buffer = null;
      if (b.expires >= s.time - EPS) apply(s, b);
      if (!s.piece || s.phase !== 'playing') continue;
    }
    const onFloor = grounded(s);
    if (onFloor && !s.touched) {
      s.touched = true;
      s.contactAge = 0;
      s.groundedTime = 0;
      s.fall = 0;
    }
    if (onFloor && (s.groundedTime >= LOCK - EPS || s.contactAge >= CONTACT_LIMIT - EPS)) {
      lockPiece(s);
      continue;
    }
    const interval = a.soft ? 0.045 : DISTRICTS[s.stage - 1].interval,
      fallIn = onFloor ? Infinity : (1 - s.fall) * interval,
      lockIn = onFloor ? Math.min(LOCK - s.groundedTime, CONTACT_LIMIT - s.contactAge) : Infinity,
      repeatIn = a.held && s.contactAge < CONTACT_LIMIT - EPS ? Math.max(0, s.repeat) : Infinity,
      deadlineIn =
        s.touched && s.contactAge < CONTACT_LIMIT - EPS ? CONTACT_LIMIT - s.contactAge : Infinity;
    let t = Math.min(remaining, fallIn, lockIn, repeatIn, deadlineIn);
    t = Math.max(0, t);
    s.time += t;
    s.flash = Math.max(0, s.flash - t);
    if (s.touched) s.contactAge += t;
    if (onFloor) s.groundedTime += t;
    else s.fall += t / interval;
    if (a.held) s.repeat = s.contactAge >= CONTACT_LIMIT - EPS ? 0.18 : Math.max(0, s.repeat - t);
    remaining -= t;
    if (repeatIn <= t + EPS && s.contactAge < CONTACT_LIMIT - EPS) {
      shift(s, a.held);
      s.repeat += 0.075;
    }
    if (fallIn <= t + EPS) {
      s.fall = 0;
      if (a.soft) descend(s, false);
      else if (canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1)) {
        s.piece.y++;
        s.maxDropY = Math.max(s.maxDropY, s.piece.y);
      }
    }
    if (grounded(s) && (s.groundedTime >= LOCK - EPS || s.contactAge >= CONTACT_LIMIT - EPS))
      lockPiece(s);
  }
}
function landingY(s) {
  if (!s.piece) return null;
  let y = s.piece.y;
  while (canPlace(s.board, s.piece.matrix, s.piece.x, y + 1)) y++;
  return y;
}
function tile(ctx, value, x, y, size = CELL, active = false) {
  ctx.fillStyle = active ? '#d9e9df' : '#243f4e';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = COLORS[value];
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.fillStyle = '#eff1d270';
  ctx.fillRect(x + 2, y + 2, size - 4, 2);
  ctx.fillStyle = '#21364588';
  ctx.fillRect(x + 2, y + size - 3, size - 4, 1);
  ctx.fillRect(x + size - 3, y + 3, 1, size - 5);
  ctx.fillStyle = value === 8 ? '#d6c6a0' : '#263d4c';
  if (value === 8) {
    ctx.fillRect(x + 3, y + 3, 2, 2);
    ctx.fillRect(x + size - 5, y + size - 5, 2, 2);
    ctx.fillRect(x + 3, y + size - 5, 2, 2);
    ctx.fillRect(x + size - 5, y + 3, 2, 2);
  } else {
    const mark = value % 3;
    ctx.fillRect(x + 4, y + 5, mark + 2, 1);
    ctx.fillRect(x + 5, y + 6, 1, 2);
    if (value > 3) ctx.fillRect(x + size - 5, y + size - 5, 2, 2);
  }
}
function preview(ctx, name, x, y, size) {
  if (!name) return;
  const m = SHAPES[name],
    cells = m.flatMap((r, py) => r.flatMap((v, px) => (v ? [{ v, px, py }] : []))),
    minX = Math.min(...cells.map((c) => c.px)),
    minY = Math.min(...cells.map((c) => c.py));
  for (const c of cells) tile(ctx, c.v, x + (c.px - minX) * size, y + (c.py - minY) * size, size);
}
function drawBlock(ctx, s, env) {
  background(ctx, '#112b3b');
  for (let n = 0; n < 12; n++) {
    const x = n * 43,
      y = 208 - (n % 4) * 19;
    ctx.fillStyle = n % 2 ? '#193749' : '#1d3e4e';
    ctx.fillRect(x, y, 34, 320 - y);
    ctx.fillStyle = '#345561';
    for (let w = 0; w < 3; w++)
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = r < s.stage - 1 ? '#c5b67c' : '#345561';
        ctx.fillRect(x + 5 + w * 9, y + 10 + r * 17, 4, 6);
      }
  }
  ctx.fillStyle = '#1c3a49';
  ctx.fillRect(10, 17, 137, 270);
  ctx.fillRect(325, 17, 145, 270);
  text(ctx, env.t('BLOCKFALL', '方块降临'), 18, 23, '#d3dfc6', 14);
  text(ctx, `${s.stage}/3`, 18, 48, '#e8ce90', 24);
  text(ctx, env.t(DISTRICTS[s.stage - 1].en, DISTRICTS[s.stage - 1].zh), 18, 79, '#b4c7bf', 12);
  const goal = DISTRICTS[s.stage - 1].goal;
  text(ctx, env.t(goal.en, goal.zh), 18, 108, '#e0d4a6', 12);
  const progress =
    s.stage === 1
      ? `${Math.min(4, s.stageLines)} / 4`
      : s.stage === 2
        ? `${s.board.flat().filter((v) => v === 8).length} ${env.t('LEFT', '剩余')}`
        : env.t('I → COLUMN9', '长条→第9列');
  text(ctx, progress, 18, 128, '#e4e7d3', 14);
  text(ctx, env.t('HOLD', '暂存'), 18, 165, '#93b5bd', 12);
  preview(ctx, s.hold, 26, 187, 16);
  if (!s.hold) text(ctx, '—', 34, 197, '#75939e', 22);
  text(
    ctx,
    s.rearm
      ? env.t('RELEASE TO READY', '松开操作键以继续')
      : s.holdUsed
        ? env.t('LOCK TO REFILL', '锁定后可再用')
        : env.t('ONCE PER LOCK', '每次锁定前一次'),
    18,
    240,
    '#bbccbb',
    12,
  );
  text(ctx, env.t('X ↺ RETRY', 'X ↺ 重试城区'), 18, 269, '#d6c68f', 12);
  ctx.fillStyle = '#719094';
  ctx.fillRect(X - 4, Y - 4, 148, 288);
  ctx.fillStyle = '#0c2231';
  ctx.fillRect(X, Y, 140, 280);
  ctx.strokeStyle = '#1b3747';
  ctx.lineWidth = 1;
  for (let x = 1; x < 10; x++) {
    ctx.beginPath();
    ctx.moveTo(X + x * CELL, Y);
    ctx.lineTo(X + x * CELL, Y + 280);
    ctx.stroke();
  }
  for (let y = 1; y < 20; y++) {
    ctx.beginPath();
    ctx.moveTo(X, Y + y * CELL);
    ctx.lineTo(X + 140, Y + y * CELL);
    ctx.stroke();
  }
  s.board.forEach((r, y) =>
    r.forEach((v, x) => {
      if (v) tile(ctx, v, X + x * CELL, Y + y * CELL);
    }),
  );
  if (s.piece) {
    const ghost = landingY(s),
      offset = grounded(s) ? 0 : clamp(s.fall, 0, 1) * CELL;
    s.piece.matrix.forEach((r, y) =>
      r.forEach((v, x) => {
        if (!v) return;
        if (ghost + y >= 0) {
          ctx.strokeStyle = '#b6ccc0';
          ctx.lineWidth = 1;
          ctx.strokeRect(
            X + (s.piece.x + x) * CELL + 2,
            Y + (ghost + y) * CELL + 2,
            CELL - 4,
            CELL - 4,
          );
          ctx.fillStyle = '#7e9f9d';
          ctx.fillRect(X + (s.piece.x + x) * CELL + 5, Y + (ghost + y) * CELL + 6, 4, 2);
        }
        if (s.piece.y + y >= 0)
          tile(ctx, v, X + (s.piece.x + x) * CELL, Y + (s.piece.y + y) * CELL + offset, CELL, true);
      }),
    );
  }
  for (const row of s.clearing) {
    ctx.fillStyle = Math.floor(s.clearTimer * 45) % 2 ? '#e9dcabdd' : '#b9d6c5aa';
    ctx.fillRect(X, Y + row * CELL, 140, CELL);
  }
  ctx.fillStyle = '#344f5c';
  ctx.fillRect(X, 309, 140, 4);
  ctx.fillStyle = s.contactAge >= CONTACT_LIMIT ? '#dbaf84' : '#afc2a2';
  ctx.fillRect(
    X,
    309,
    140 *
      clamp(s.touched ? Math.max(s.groundedTime / LOCK, s.contactAge / CONTACT_LIMIT) : 0, 0, 1),
    4,
  );
  text(ctx, env.t('NEXT', '接下来'), 335, 25, '#93b5bd', 12);
  s.preview.forEach((name, n) => {
    text(ctx, String(n + 1), 335, 52 + n * 57, '#789aa4', 12);
    preview(ctx, name, 358, 50 + n * 57, n ? 14 : 16);
  });
  text(ctx, env.t('7-PIECE BAG', '每袋七种方块'), 335, 225, '#bbccbb', 12);
  text(ctx, env.t('GHOST: LANDING', '影子：预计落点'), 335, 250, '#bbccbb', 12);
  text(ctx, env.t('LOCK:0.5s', '锁定：0.5秒'), 335, 273, '#bbccbb', 12);
  if (s.stageTimer > 0) {
    ctx.fillStyle = '#173b49ec';
    ctx.fillRect(X, Y + 108, 140, 58);
    text(ctx, env.t('DISTRICT LIT', '城区已点亮'), X + 70, Y + 122, '#eee0ad', 12, 'center');
    text(ctx, env.t('NEXT →', '下一区→'), X + 70, Y + 143, '#bcd4c2', 12, 'center');
  }
}
export function createGame(env) {
  const s = createBlockState(Math.floor(env.random() * 4294967296));
  let ended = false;
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      const locks = s.locks,
        lines = s.lines,
        retries = s.retries,
        hold = s.hold;
      stepBlock(s, dt, input);
      if (s.lines > lines) env.sound('coin');
      else if (s.locks > locks) env.sound('hit');
      else if (s.retries > retries || s.hold !== hold) env.sound('move');
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.sound(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'Three districts powered. The city is shining!',
                '三个城区供电完成，整座城市亮起来了！',
              )
            : env.t(
                'The well reached the roof. Restart, or use Retry District before the next top-out.',
                '方块已堆到井顶。可重新开始；下次封顶前可用重试城区恢复。',
              ),
        });
      }
    },
    draw(ctx) {
      drawBlock(ctx, s, env);
    },
    getState: () => {
      const clone = structuredClone(s);
      delete clone.checkpoint;
      return {
        ...clone,
        level: s.stage,
        totalStages: 3,
        next: s.preview[0],
        grounded: Boolean(grounded(s)),
        groundedTime: s.groundedTime,
        ghostY: landingY(s),
        objective: structuredClone(DISTRICTS[s.stage - 1]),
        status: {
          en: `District ${s.stage}/3 · ${DISTRICTS[s.stage - 1].goal.en} · ${s.rearm ? 'Release controls to ready the district.' : DISTRICTS[s.stage - 1].hint.en}`,
          zh: `城区${s.stage}/3 · ${DISTRICTS[s.stage - 1].goal.zh} · ${s.rearm ? '请松开操作键，准备本城区。' : DISTRICTS[s.stage - 1].hint.zh}`,
        },
      };
    },
  };
}
