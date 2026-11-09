// Blockfall rules: level setup, piece supply, gravity, locking, line clears and level goals.
import { clamp } from '../shared/utils.js';
import { SHAPES, turnPiece, canPlace, clearRows } from './blockfall-board.js';
import { LEVELS, LEVEL_COUNT, levelBoard } from './blockfall-levels.js';

export const LOCK = 0.5,
  CONTACT_LIMIT = 3;
const EPS = 1e-8,
  READY_TIME = 2.4,
  MAX_STEP = 1 / 30,
  LINE_POINTS = Object.freeze([0, 100, 300, 500, 800]),
  REPEAT_DELAY = 0.18,
  REPEAT_RATE = 0.075,
  CLEAR_TIME = 0.22,
  LIT_TIME = 0.8,
  BUFFER_TIME = 0.3,
  SOFT_INTERVAL = 0.045,
  LOCK_RESETS = 15,
  PREVIEW_SIZE = 3;
const NO_ACTION = Object.freeze({
  held: 0,
  move: 0,
  rotate: 0,
  soft: false,
  hold: false,
  drop: false,
  retry: false,
});
const CONTROL_KEYS = [
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
];
const CHECKPOINT_FIELDS = [
  'board',
  'bag',
  'rng',
  'supply',
  'preview',
  'piece',
  'hold',
  'score',
  'lines',
  'levelLines',
  'placed',
  'removed',
  'injected',
  'discarded',
  'locks',
];

const occupied = (board) => board.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
export const levelOf = (s) => LEVELS[s.level - 1];
export const grounded = (s) =>
  s.piece && !canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y + 1);
export function landingY(s) {
  if (!s.piece) return null;
  let y = s.piece.y;
  while (canPlace(s.board, s.piece.matrix, s.piece.x, y + 1)) y++;
  return y;
}
/** Marked rubble cells still in the well (value 8). */
export const rubbleLeft = (board) => board.flat().filter((v) => v === 8).length;
/** Pieces still to come on a limited-supply level: queue, preview, hold and the falling piece. */
export const piecesLeft = (s) =>
  s.supply
    ? s.supply.length + s.preview.length + Number(Boolean(s.hold)) + Number(Boolean(s.piece))
    : null;

function random(s) {
  s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function take(s) {
  if (s.supply) return s.supply.shift() ?? null;
  if (!s.bag.length) {
    s.bag = Object.keys(SHAPES);
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(random(s) * (i + 1));
      [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]];
    }
  }
  return s.bag.pop();
}
function fillPreview(s, size) {
  while (s.preview.length < size) {
    const name = take(s);
    if (!name) return;
    s.preview.push(name);
  }
}
function lose(s, reason) {
  s.phase = 'lost';
  s.reason = reason;
}
function spawn(s, name) {
  if (!name) {
    name = s.preview.shift();
    if (!name && s.hold) {
      name = s.hold;
      s.hold = null;
    }
    if (!name) {
      s.piece = null;
      lose(s, 'supply');
      return;
    }
    fillPreview(s, PREVIEW_SIZE);
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
  if (!canPlace(s.board, s.piece.matrix, s.piece.x, s.piece.y)) lose(s, 'roof');
}
function capture(s) {
  s.checkpoint = Object.fromEntries(CHECKPOINT_FIELDS.map((k) => [k, structuredClone(s[k])]));
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
  s.litTimer = 0;
  s.ready = 0;
  s.buffer = null;
  s.repeat = REPEAT_DELAY;
  s.lastDir = 0;
  s.flash = 0;
}
/** Sets up a level: its preset board, its piece supply, and a short reading pause. */
function beginLevel(s, level) {
  s.discarded += occupied(s.board);
  s.level = level;
  s.board = levelBoard(LEVELS[level - 1]);
  s.injected += occupied(s.board);
  s.levelLines = 0;
  s.hold = null;
  s.preview = [];
  const queue = LEVELS[level - 1].queue;
  s.supply = queue ? [...queue] : null;
  fillPreview(s, PREVIEW_SIZE + 1);
  transient(s);
  spawn(s);
  s.ready = READY_TIME;
  capture(s);
}
export function createBlockState(seed = 1, level = 1) {
  const s = {
    phase: 'playing',
    reason: null,
    level: 1,
    score: 0,
    lines: 0,
    levelLines: 0,
    board: levelBoard(LEVELS[0]),
    bag: [],
    rng: seed >>> 0,
    supply: null,
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
  beginLevel(s, clamp(Math.floor(Number(level)) || 1, 1, LEVEL_COUNT));
  return s;
}
function retry(s) {
  for (const [key, value] of Object.entries(s.checkpoint)) s[key] = structuredClone(value);
  s.phase = 'playing';
  s.retries++;
  transient(s);
}
function resetLock(s) {
  if (s.touched && s.lockResets < LOCK_RESETS && s.contactAge < CONTACT_LIMIT - EPS) {
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
  // On a limited supply the last piece cannot be swapped for a piece that does not exist.
  if (s.holdUsed || (!s.hold && !s.preview.length)) return;
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
function goalReached(s, count) {
  const goal = levelOf(s).goal;
  if (goal.kind === 'lines') return s.levelLines >= goal.n;
  if (goal.kind === 'rubble') return rubbleLeft(s.board) === 0;
  return count >= goal.n;
}
function commitClear(s) {
  const count = s.clearing.length;
  s.board = clearRows(s.board).board;
  s.removed += count * 10;
  s.lines += count;
  s.levelLines += count;
  s.score += LINE_POINTS[Math.min(count, 4)] * s.level;
  s.clearing = [];
  s.clearTimer = 0;
  s.flash = 0.3;
  if (goalReached(s, count)) {
    if (s.level === LEVEL_COUNT) s.phase = 'won';
    else s.litTimer = LIT_TIME;
    return;
  }
  s.holdUsed = false;
  spawn(s);
  if (!s.buffer) return;
  const buffered = s.buffer;
  s.buffer = null;
  if (buffered.expires >= s.time - EPS && s.phase === 'playing') apply(s, buffered);
}
function lockPiece(s) {
  // Atomic validation prevents a partial stamp when any cell is above the roof or blocked.
  const p = s.piece;
  if (
    !canPlace(s.board, p.matrix, p.x, p.y) ||
    p.matrix.some((r, y) => r.some((v) => v && p.y + y < 0))
  ) {
    lose(s, 'roof');
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
  if (s.clearing.length) s.clearTimer = CLEAR_TIME;
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
    return;
  }
  if (s.contactAge < CONTACT_LIMIT - EPS) {
    if (a.rotate) turn(s, a.rotate);
    if (a.move) shift(s, a.move);
  }
  if (a.drop) {
    while (descend(s, true)) {}
    lockPiece(s);
  }
}
/** Reads this frame's controls; Retry restores the level entry and waits for all keys to be released. */
function controls(s, input) {
  const a = sample(input);
  if (a.retry && !s.rearm) {
    retry(s);
    s.rearm = true;
    return NO_ACTION;
  }
  if (!s.rearm) return a;
  if (!input.held(...CONTROL_KEYS) && !a.move && !a.rotate && !a.hold && !a.drop && !a.retry)
    s.rearm = false;
  return NO_ACTION;
}
/** Advances a timer by up to `remaining`; returns the time used and whether it just finished. */
function tick(s, key, remaining) {
  const t = Math.min(remaining, s[key]);
  s[key] = s[key] - t <= EPS ? 0 : s[key] - t;
  s.time += t;
  return t;
}
function waitStep(s, remaining) {
  if (s.litTimer > 0) {
    const t = tick(s, 'litTimer', remaining);
    if (s.litTimer <= EPS) {
      s.litTimer = 0;
      beginLevel(s, s.level + 1);
    }
    return t;
  }
  const t = tick(s, 'clearTimer', remaining);
  if (s.clearTimer <= EPS) commitClear(s);
  return t;
}
function fallStep(s, a, remaining) {
  const onFloor = grounded(s);
  if (onFloor && !s.touched) {
    s.touched = true;
    s.contactAge = 0;
    s.groundedTime = 0;
    s.fall = 0;
  }
  const expired = s.groundedTime >= LOCK - EPS || s.contactAge >= CONTACT_LIMIT - EPS;
  if (onFloor && expired) {
    lockPiece(s);
    return 0;
  }
  const interval = a.soft ? SOFT_INTERVAL : levelOf(s).interval,
    fallIn = onFloor ? Infinity : (1 - s.fall) * interval,
    lockIn = onFloor ? Math.min(LOCK - s.groundedTime, CONTACT_LIMIT - s.contactAge) : Infinity,
    repeatIn = a.held && s.contactAge < CONTACT_LIMIT - EPS ? Math.max(0, s.repeat) : Infinity,
    deadlineIn =
      s.touched && s.contactAge < CONTACT_LIMIT - EPS ? CONTACT_LIMIT - s.contactAge : Infinity;
  const t = Math.max(0, Math.min(remaining, fallIn, lockIn, repeatIn, deadlineIn));
  s.time += t;
  s.flash = Math.max(0, s.flash - t);
  if (s.touched) s.contactAge += t;
  if (onFloor) s.groundedTime += t;
  else s.fall += t / interval;
  if (a.held)
    s.repeat = s.contactAge >= CONTACT_LIMIT - EPS ? REPEAT_DELAY : Math.max(0, s.repeat - t);
  if (repeatIn <= t + EPS && s.contactAge < CONTACT_LIMIT - EPS) {
    shift(s, a.held);
    s.repeat += REPEAT_RATE;
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
  return t;
}
export function stepBlock(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, MAX_STEP);
  // Inputs are ignored while the level's reading pause runs.
  const a = s.ready > 0 ? { ...NO_ACTION } : controls(s, input);
  if (a.held !== s.lastDir) {
    s.repeat = REPEAT_DELAY;
    s.lastDir = a.held;
    if (!a.move && a.held) a.move = a.held;
  }
  if (s.clearTimer > 0 || s.litTimer > 0) {
    if (a.move || a.rotate || a.hold)
      s.buffer = { move: a.move, rotate: a.rotate, hold: a.hold, expires: s.time + BUFFER_TIME };
  } else if (s.piece) {
    apply(s, a);
  }
  while (remaining > EPS && s.phase === 'playing') {
    if (s.ready > 0) {
      remaining -= tick(s, 'ready', remaining);
      continue;
    }
    if (s.litTimer > 0 || s.clearTimer > 0) {
      remaining -= waitStep(s, remaining);
      continue;
    }
    if (!s.piece) break;
    remaining -= fallStep(s, a, remaining);
  }
}
