// Neon Snake rules: terrain from the level table, grid stepping, turn queue, Focus and pacing.
import { clamp } from '../shared/utils.js';
import { COLS, ROWS, LEVELS, LEVEL_COUNT } from './neon-snake-levels.js';
import { endMessage } from './neon-snake-text.js';

const same = (a, b) => a.x === b.x && a.y === b.y;
const cardinal = (d) =>
  d && Number.isInteger(d.x) && Number.isInteger(d.y) && Math.abs(d.x) + Math.abs(d.y) === 1;
const inside = (p) => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS;
const MAX_DT = 1 / 30;
const POINTER_SWIPE = 15;
const FOCUS_SLOW = 1.9;
const CALM_SLOW = 1.35;
const KEYS = [
  ['ArrowUp', 'KeyW', 0, -1],
  ['ArrowDown', 'KeyS', 0, 1],
  ['ArrowLeft', 'KeyA', -1, 0],
  ['ArrowRight', 'KeyD', 1, 0],
];

export function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
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

export function isGateOpen(s, g, offset = 0) {
  return (
    s.snake.some((p) => same(p, g)) ||
    Math.floor(((s.stageSteps || 0) + offset) / s.gatePeriod) % 2 === g.group
  );
}

/** Next fruit: a bed of the current level, else the free cell nearest to its first bed cell. */
export function spawnFood(s, random) {
  const available = (p) =>
    inside(p) && ![...s.snake, ...s.rocks, ...s.gates, ...s.underpasses].some((v) => same(v, p));
  const bed = LEVELS[s.level - 1].beds[s.stageFruit] ?? [{ x: 0, y: 0 }];
  const free = bed.filter(available);
  if (free.length)
    return { ...free[clamp(Math.floor(random() * free.length), 0, free.length - 1)] };
  let best = null,
    bestDistance = Infinity;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const distance = Math.abs(x - bed[0].x) + Math.abs(y - bed[0].y);
      if (distance < bestDistance && available({ x, y })) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  return best;
}

function loadLevel(s, level, random) {
  const def = LEVELS[level - 1];
  s.level = level;
  s.rocks = def.rocks;
  s.gates = def.gates;
  s.underpasses = def.passes;
  s.gatePeriod = def.gatePeriod;
  s.target = def.target;
  s.snake = def.snake.map((p) => ({ ...p }));
  s.direction = { ...def.direction };
  s.ready = def.ready;
  s.stageFruit = 0;
  s.stageSteps = 0;
  s.brake = 1;
  s.braking = false;
  s.focusLocked = false;
  s.progress = 0;
  s.queue = [];
  s.controls = { held: [], pointer: null, pointerDown: false };
  s.crossingFrom = null;
  s.betweenGardens = false;
  s.food = spawnFood(s, random);
}

export function createSnakeState(level = 1, random = () => 0.5) {
  const s = {
    phase: 'playing',
    score: 0,
    eaten: 0,
    steps: 0,
    time: 0,
    flash: 0,
    calm: false,
    crossings: 0,
    crash: null,
    ended: false,
    celebration: [],
  };
  loadLevel(s, clamp(Math.floor(level) || 1, 1, LEVEL_COUNT), random);
  return s;
}

export function advanceLevel(s, random) {
  if (s.phase !== 'playing' || !s.betweenGardens || s.level >= LEVEL_COUNT) return false;
  loadLevel(s, s.level + 1, random);
  return true;
}

const crashReason = (s, head) => {
  if (!inside(head)) return 'edge';
  if (s.rocks.some((p) => same(p, head))) return 'stone';
  if (s.gates.some((g) => same(g, head) && !isGateOpen(s, g))) return 'gate';
  return null;
};

function trackCrossing(s, old, head) {
  const onPass = (p) => s.underpasses.some((u) => same(u, p));
  if (onPass(head)) s.crossingFrom = head.x > old.x ? 'left' : head.x < old.x ? 'right' : null;
  else if (s.crossingFrom && onPass(old)) {
    if ((s.crossingFrom === 'left') === head.x > old.x) s.crossings++;
    s.crossingFrom = null;
  }
}

function eat(s, head, random) {
  s.eaten++;
  s.stageFruit++;
  s.score += 100;
  s.brake = Math.min(1, s.brake + 0.25);
  s.flash = 0.25;
  s.celebration.push({ x: head.x, y: head.y, life: 0.35 });
  if (s.celebration.length > 4) s.celebration.shift();
  if (s.stageFruit < s.target) {
    s.food = spawnFood(s, random);
    if (!s.food) {
      s.phase = 'won';
      s.filled = true;
    }
    return;
  }
  s.score += 200;
  s.food = null;
  s.queue = [];
  s.progress = 0;
  s.braking = false;
  if (s.level >= LEVEL_COUNT) s.phase = 'won';
  else s.betweenGardens = true;
}

export function stepSnake(s, direction, random) {
  if (s.phase !== 'playing' || s.betweenGardens) return;
  if (cardinal(direction) && !(direction.x === -s.direction.x && direction.y === -s.direction.y))
    s.direction = { ...direction };
  const old = s.snake[0],
    head = { x: old.x + s.direction.x, y: old.y + s.direction.y },
    eating = s.food && same(head, s.food),
    body = eating ? s.snake : s.snake.slice(0, -1),
    reason = crashReason(s, head) ?? (body.some((p) => same(p, head)) ? 'body' : null);
  if (reason) {
    s.phase = 'lost';
    s.crash = { ...head, reason };
    return;
  }
  s.steps++;
  s.stageSteps++;
  s.snake.unshift(head);
  if (!eating) s.snake.pop();
  trackCrossing(s, old, head);
  if (eating) eat(s, head, random);
}

function queueTurn(s, d) {
  const last = s.queue.at(-1) || s.direction;
  if (
    s.queue.length < 2 &&
    cardinal(d) &&
    !(d.x === last.x && d.y === last.y) &&
    !(d.x === -last.x && d.y === -last.y)
  )
    s.queue.push({ ...d });
}

function keyTurns(s, input) {
  const current = [],
    fresh = [];
  for (let n = 0; n < 4; n++) {
    const [a, b] = KEYS[n];
    if (input.held(a, b)) current.push(n);
    if (input.pressed(a, b) || (input.held(a, b) && !s.controls.held.includes(n))) fresh.push(n);
  }
  const cancelled = new Set();
  for (const [a, b] of [
    [0, 1],
    [2, 3],
  ])
    if ((current.includes(a) && current.includes(b)) || (fresh.includes(a) && fresh.includes(b))) {
      cancelled.add(a);
      cancelled.add(b);
    }
  const planned = s.queue.at(-1) || s.direction;
  const valid = fresh.filter(
    (n) =>
      !cancelled.has(n) &&
      !(KEYS[n][2] === planned.x && KEYS[n][3] === planned.y) &&
      !(KEYS[n][2] === -planned.x && KEYS[n][3] === -planned.y),
  );
  // A frame has no ordering between simultaneous keys; accept one legal turn.
  if (valid.length === 1) queueTurn(s, { x: KEYS[valid[0]][2], y: KEYS[valid[0]][3] });
  s.controls.held = current;
}

function swipeTurns(s, pointer) {
  const p = pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y) ? pointer : null,
    down = Boolean(p?.down);
  if (down && (p.clicked || !s.controls.pointerDown)) s.controls.pointer = { x: p.x, y: p.y };
  if (down && s.controls.pointer) {
    const dx = p.x - s.controls.pointer.x,
      dy = p.y - s.controls.pointer.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= POINTER_SWIPE) {
      queueTurn(
        s,
        Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) },
      );
      s.controls.pointer = { x: p.x, y: p.y };
    }
  }
  if (!down) s.controls.pointer = null;
  s.controls.pointerDown = down;
}

function terminal(s, env) {
  if (s.phase === 'playing' || s.ended) return;
  s.ended = true;
  env.sound(s.phase === 'won' ? 'win' : 'lose');
  env.end({ won: s.phase === 'won', score: s.score, message: endMessage(s, env) });
}

function updateFocus(s, focus) {
  if (!focus) {
    s.braking = false;
    s.focusLocked = false;
  } else if (!s.focusLocked && (s.braking || s.brake >= 0.1)) s.braking = true;
  else {
    s.braking = false;
    s.focusLocked = true;
  }
}

/** Advance `left` seconds of motion in whole step events, so every frame rate agrees. */
function move(s, left, focus, env) {
  const period = LEVELS[s.level - 1].period * (s.calm ? CALM_SLOW : 1);
  for (
    let events = 0;
    events < 8 && left > 1e-12 && s.phase === 'playing' && !s.betweenGardens;
    events++
  ) {
    const rate = 1 / (period * (s.braking ? FOCUS_SLOW : 1)),
      moveTime = (1 - s.progress) / rate,
      emptyTime = s.braking ? s.brake / 0.22 : Infinity,
      part = Math.min(left, moveTime, emptyTime);
    s.progress += part * rate;
    s.brake = clamp(s.brake + part * (s.braking ? -0.22 : !focus ? 0.12 : 0), 0, 1);
    s.time += part;
    s.flash = Math.max(0, s.flash - part);
    s.celebration = s.celebration.filter((p) => (p.life -= part) > 0);
    left -= part;
    if (emptyTime <= part + 1e-10) {
      s.brake = 0;
      s.braking = false;
      s.focusLocked = true;
    }
    if (moveTime <= part + 1e-10) {
      s.progress = 0;
      const eaten = s.eaten;
      stepSnake(s, s.queue.shift(), env.random);
      if (s.eaten !== eaten) env.sound('coin');
      if (s.betweenGardens) {
        s.queue = [];
        if (env.progress) saveUnlocked(env.progress, s.level + 1);
      }
    }
  }
  terminal(s, env);
}

export function updateSnake(s, dt, input, env) {
  if (s.phase !== 'playing') return;
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_DT);
  if (dt === 0) return;
  if (input.pressed('KeyC')) s.calm = !s.calm;
  if (s.betweenGardens) {
    s.time += dt;
    if (input.pressed('Enter')) advanceLevel(s, env.random);
    return;
  }
  keyTurns(s, input);
  swipeTurns(s, input.pointer);
  const focus = input.held('Space') || input.pressed('Space');
  updateFocus(s, focus);
  const waiting = Math.min(dt, s.ready);
  s.ready -= waiting;
  s.time += waiting;
  move(s, dt - waiting, focus, env);
}
