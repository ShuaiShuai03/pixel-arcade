// Garden state and the turn engine: choose, swap, clear, fall, remix. Deterministic per env.random.
import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, soilGrid, levelObjective } from './gem-match-levels.js';
import {
  SIZE,
  validCell,
  findMatches,
  applySwap,
  legalSwaps,
  chooseColor,
  makeBoard,
} from './gem-match-rules.js';

export const X = 122,
  Y = 48,
  CELL = 34;
const GRAVITY = 680,
  EPS = 1e-9,
  MAX_STEP = 1 / 30,
  SWAP_TIME = 0.48,
  CLEAR_TIME = 0.22,
  MIX_TIME = 0.6,
  POINTS_PER_GEM = 20,
  MAX_COMBO = 5,
  HINT_SECONDS = 3,
  FEEDBACK_SECONDS = 1.5,
  SPARKLE_CAP = 98;
export const center = (x, y) => ({ x: X + x * CELL + CELL / 2, y: Y + y * CELL + CELL / 2 });
const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));

export function createGemState(env, level = 1, carriedScore = 0) {
  level = clamp(Math.floor(Number(level)) || 1, 1, LEVEL_COUNT);
  const data = LEVELS[level - 1];
  return {
    phase: 'playing',
    mode: 'ready',
    time: 0,
    level,
    score: carriedScore,
    levelScore: 0,
    moves: data.moves,
    board: makeBoard(env.random, data.kinds),
    cursor: { x: 0, y: 0 },
    selected: null,
    swap: null,
    drag: null,
    pending: [],
    clearTime: 0,
    fall: null,
    mixer: null,
    combo: 0,
    collected: Array(6).fill(0),
    soil: soilGrid(data),
    hint: null,
    hintTime: 0,
    feedback: 'welcome',
    feedbackTime: 3,
    sparkles: [],
    totalCleared: 0,
    mixes: 0,
  };
}
export const gemObjective = (s) => levelObjective(LEVELS[s.level - 1], s);

function end(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  s.mode = 'terminal';
  s.selected = null;
  s.hint = null;
  s.feedback = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t('All twenty gardens restored!', '二十座花园恢复了光彩！')
      : env.t(
          'Out of moves. Restore the garden with a new plan.',
          '步数用完了，重新规划修复花园。',
        ),
  });
}
function startMix(s, env) {
  s.mode = 'mix-lift';
  s.mixes++;
  s.selected = null;
  s.hint = null;
  s.mixer = { time: 0, duration: MIX_TIME };
  s.feedback = 'mix';
  s.feedbackTime = FEEDBACK_SECONDS;
  env.sound('move');
}
/** The board stopped moving: bank a clear, end the run, remix a dead board, or hand control back. */
function stable(s, env) {
  s.combo = 0;
  if (gemObjective(s).done) {
    if (s.level === LEVEL_COUNT) {
      if (env.progress) saveUnlocked(env.progress, LEVEL_COUNT + 1);
      return end(s, env, true);
    }
    s.mode = 'garden-clear';
    s.selected = null;
    s.hint = null;
    s.feedback = 'garden-clear';
    env.sound('win');
    if (env.progress) saveUnlocked(env.progress, s.level + 1);
    return;
  }
  if (s.moves <= 0) return end(s, env, false);
  if (legalSwaps(s.board).length) s.mode = 'ready';
  else startMix(s, env);
}
export function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}
function settle(s, env) {
  const matches = findMatches(s.board);
  if (!matches.length) return stable(s, env);
  s.pending = matches;
  s.combo++;
  s.mode = 'clear';
  s.clearTime = CLEAR_TIME;
  s.hint = null;
  env.sound('coin');
}
function beginFall(s, env, wholeBoard = null) {
  const kinds = LEVELS[s.level - 1].kinds,
    target = emptyBoard(),
    particles = [],
    missing = [];
  for (let x = 0; x < SIZE; x++) {
    let row = SIZE - 1;
    if (!wholeBoard)
      for (let y = SIZE - 1; y >= 0; y--)
        if (s.board[y][x] >= 0) {
          target[row][x] = s.board[y][x];
          particles.push({
            color: s.board[y][x],
            col: x,
            row,
            start: center(x, y).y,
            y: center(x, y).y,
            vy: 0,
            target: center(x, row).y,
          });
          row--;
        }
    missing[x] = row;
  }
  for (let x = 0; x < SIZE; x++)
    for (let y = 0; y <= missing[x]; y++) {
      const color = wholeBoard ? wholeBoard[y][x] : chooseColor(target, x, y, env.random, kinds);
      target[y][x] = color;
      const start = Y - CELL / 2 - (missing[x] - y) * CELL;
      particles.push({ color, col: x, row: y, start, y: start, vy: 0, target: center(x, y).y });
    }
  const duration = Math.max(
    ...particles.map((p) => Math.sqrt((2 * (p.target - p.start)) / GRAVITY)),
  );
  s.fall = { particles, target, time: 0, duration };
  s.mode = 'fall';
}
function removeMatches(s, env) {
  for (const key of s.pending) {
    const [y, x] = key.split(',').map(Number),
      color = s.board[y][x];
    s.collected[color]++;
    if (s.soil[y][x] === color) s.soil[y][x] = -1;
    s.board[y][x] = -1;
    s.sparkles.push({ ...center(x, y), life: 0.35, color });
  }
  const points = s.pending.length * POINTS_PER_GEM * Math.min(s.combo, MAX_COMBO);
  s.score += points;
  s.levelScore += points;
  s.totalCleared += s.pending.length;
  s.pending = [];
  beginFall(s, env);
}
function feedback(s, kind, env) {
  s.feedback = kind;
  s.feedbackTime = FEEDBACK_SECONDS;
  env.sound(kind === 'invalid' ? 'hit' : 'move');
}
function choose(s, x, y, env) {
  if (s.mode !== 'ready' || !validCell(s.board, { x, y })) return;
  s.cursor = { x, y };
  s.hint = null;
  if (s.selected && s.selected.x === x && s.selected.y === y) {
    s.selected = null;
    return feedback(s, 'cancel', env);
  }
  if (!s.selected) {
    s.selected = { x, y };
    return feedback(s, 'selected', env);
  }
  const a = { ...s.selected },
    b = { x, y };
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) {
    s.selected = b;
    return feedback(s, 'selected', env);
  }
  const swapped = applySwap(s.board, a, b);
  s.swap = {
    a,
    b,
    time: 0,
    duration: SWAP_TIME,
    valid: !!swapped,
    target: swapped,
    returning: false,
  };
  s.mode = 'swap';
  env.sound('move');
}
const pointerCell = (pointer) => ({
  x: Math.floor((Number(pointer?.x) - X) / CELL),
  y: Math.floor((Number(pointer?.y) - Y) / CELL),
});
/** Releasing a press-drag swaps the pressed gem with its neighbour in the dominant drag direction. */
function endDrag(s, pointer, env) {
  const from = s.drag,
    to = pointerCell(pointer);
  s.drag = null;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  s.selected = { ...from };
  if (!dx && !dy) return;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  choose(
    s,
    from.x + (horizontal ? Math.sign(dx) : 0),
    from.y + (horizontal ? 0 : Math.sign(dy)),
    env,
  );
}
function handleInput(s, input, env) {
  const clicked = Boolean(input.pointer?.clicked);
  if (s.mode !== 'ready') s.drag = null;
  if (s.mode === 'garden-clear') {
    if (clicked || input.pressed('Space', 'Enter'))
      Object.assign(s, createGemState(env, s.level + 1, s.score), {
        time: s.time,
        mixes: s.mixes,
        totalCleared: s.totalCleared,
      });
    return;
  }
  if (s.mode !== 'ready') return;
  if (input.pressed('KeyH')) {
    const choices = legalSwaps(s.board);
    s.hint = choices[0];
    s.hintTime = HINT_SECONDS;
    return feedback(s, 'hint', env);
  }
  const axis = (minus, plus) => Number(input.pressed(...plus)) - Number(input.pressed(...minus)),
    dx = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']),
    dy = axis(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  if (dx && !dy) s.cursor.x = (s.cursor.x + dx + SIZE) % SIZE;
  if (dy && !dx) s.cursor.y = (s.cursor.y + dy + SIZE) % SIZE;
  if (s.drag && !input.pointer?.down) endDrag(s, input.pointer, env);
  else if (clicked) {
    const { x, y } = pointerCell(input.pointer);
    choose(s, x, y, env);
    if (input.pointer.down && s.mode === 'ready' && validCell(s.board, { x, y })) s.drag = { x, y };
  } else if (input.pressed('Space', 'Enter')) choose(s, s.cursor.x, s.cursor.y, env);
}
function advance(s, time) {
  s.time += time;
  s.feedbackTime = Math.max(0, s.feedbackTime - time);
  s.hintTime = Math.max(0, s.hintTime - time);
  if (!s.hintTime) s.hint = null;
  for (const p of s.sparkles) p.life -= time;
  s.sparkles = s.sparkles.filter((p) => p.life > 0).slice(-SPARKLE_CAP);
}
function stepSwap(s, env, remaining) {
  const sw = s.swap,
    time = Math.min(remaining, sw.duration - sw.time);
  advance(s, time);
  sw.time += time;
  if (sw.time < sw.duration - EPS) return time;
  if (sw.returning) {
    s.swap = null;
    s.mode = 'ready';
    s.selected = { ...sw.a };
    feedback(s, 'invalid', env);
  } else if (!sw.valid) {
    sw.returning = true;
    sw.time = 0;
    env.sound('hit');
  } else {
    s.board = sw.target;
    s.moves--;
    s.selected = null;
    s.swap = null;
    settle(s, env);
  }
  return time;
}
function stepClear(s, env, remaining) {
  const time = Math.min(remaining, s.clearTime);
  advance(s, time);
  s.clearTime -= time;
  if (s.clearTime <= EPS) {
    s.clearTime = 0;
    removeMatches(s, env);
  }
  return time;
}
function stepFall(s, env, remaining) {
  const f = s.fall,
    time = Math.min(remaining, f.duration - f.time);
  advance(s, time);
  f.time += time;
  for (const p of f.particles) {
    p.y = Math.min(p.target, p.start + (GRAVITY * f.time * f.time) / 2);
    p.vy = p.y >= p.target - EPS ? 0 : GRAVITY * f.time;
  }
  if (f.time >= f.duration - EPS) {
    s.board = f.target;
    s.fall = null;
    settle(s, env);
  }
  return time;
}
function stepMix(s, env, remaining) {
  const m = s.mixer,
    time = Math.min(remaining, m.duration - m.time);
  advance(s, time);
  m.time += time;
  if (m.time >= m.duration - EPS) {
    const fresh = makeBoard(env.random, LEVELS[s.level - 1].kinds);
    s.mixer = null;
    s.board = emptyBoard();
    beginFall(s, env, fresh);
  }
  return time;
}
const STEPPERS = { swap: stepSwap, clear: stepClear, fall: stepFall, 'mix-lift': stepMix };

export function stepGem(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  handleInput(s, input, env);
  let remaining = Math.min(dt, MAX_STEP);
  while (remaining > EPS && s.phase === 'playing') {
    const stepper = STEPPERS[s.mode];
    if (stepper) remaining -= stepper(s, env, remaining);
    else {
      advance(s, remaining);
      remaining = 0;
    }
  }
}
