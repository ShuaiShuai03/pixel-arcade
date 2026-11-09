// Memory Grove rules: one state machine for pairs, lantern routes, triples and echoes.
import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './memory-grove-levels.js';

export const FLIP = 0.22;
export const MATCH_SHOW = 0.6;
export const LISTEN = 1;
export const ECHO_OK = 0.15;
export const ECHO_BAD = 1;
export const STEP_CAP = 1 / 30;
export const NEXT_BUTTON = Object.freeze({ x: 172, y: 282, w: 136, h: 26 });
const EPS = 1e-9;
const CLEAR_BONUS = 150;
const WELCOME_SECONDS = 4;
const NOTICE_SECONDS = 2.5;
const QUEUE_MAX = 2;
/** Animation locks: arrows still move the cursor and one or two taps wait for the next ready. */
const LOCKS = new Set(['opening', 'reveal', 'closing']);
/** Modes that run for a fixed duration; the rest wait for the player. */
const TIMED_MODES = new Set([
  'preview',
  'opening',
  'reveal',
  'closing',
  'listen',
  'cue-on',
  'cue-gap',
]);

export function shuffled(values, random) {
  const list = values.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = clamp(Math.floor(random() * (i + 1)), 0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export function makeDeck(symbols, random, copies = 2) {
  if (!Number.isInteger(symbols) || symbols < 1 || !Number.isInteger(copies) || copies < 2)
    throw new RangeError('A memory deck needs repeated symbols');
  return shuffled(
    Array.from({ length: symbols * copies }, (_, i) => i % symbols),
    random,
  );
}
const range = (n) => Array.from({ length: n }, (_, i) => i);
const smooth = (t) => t * t * (3 - 2 * t);

export function createLevelState(level, random, carry = {}) {
  const index = clamp(Math.floor(level), 1, LEVEL_COUNT) - 1,
    def = LEVELS[index];
  const echo = def.rule === 'echo';
  const deck = echo
    ? shuffled(
        Array.from({ length: def.count }, (_, i) => i % def.symbols),
        random,
      )
    : makeDeck(def.symbols, random, def.group);
  const s = {
    phase: 'playing',
    mode: 'ready',
    t: 0,
    dur: 0,
    level: index + 1,
    rule: def.rule,
    deck,
    matched: Array(def.count).fill(false),
    flipped: [],
    cursor: 0,
    route: def.rule === 'route' ? shuffled(range(def.symbols), random) : [],
    routeIndex: 0,
    sequence: echo ? shuffled(range(def.count), random).slice(0, def.echo.to) : [],
    echo: echo ? { length: def.echo.from, input: 0, step: 0, lit: -1 } : null,
    lives: def.lives,
    clock: def.clock,
    remaining: def.clock,
    timed: carry.timed ?? true,
    started: false,
    correct: false,
    next: false,
    queue: [],
    score: carry.score ?? 0,
    turns: carry.turns ?? 0,
    levelTurns: 0,
    streak: 0,
    bestStreak: carry.bestStreak ?? 0,
    time: carry.time ?? 0,
    feedback: 'welcome',
    feedbackTime: WELCOME_SECONDS,
  };
  if (echo) setMode(s, 'listen', LISTEN);
  else if (def.preview > 0) setMode(s, 'preview', def.preview);
  return s;
}
/** The next clearing, carrying the run's score and clock preference. */
export const nextLevelState = (s, random) =>
  createLevelState(s.level + 1, random, {
    score: s.score,
    turns: s.turns,
    bestStreak: s.bestStreak,
    timed: s.timed,
    time: s.time,
  });

function setMode(s, mode, dur = 0) {
  if (mode !== 'ready' && !LOCKS.has(mode)) s.queue = [];
  s.mode = mode;
  s.t = 0;
  s.dur = dur;
}
function notice(s, feedback, seconds = NOTICE_SECONDS) {
  s.feedback = feedback;
  s.feedbackTime = seconds;
}
function lose(s, sound) {
  s.phase = 'lost';
  s.mode = 'terminal';
  notice(s, 'lost', 0);
  sound('lose');
}
function complete(s, sound) {
  s.score += CLEAR_BONUS;
  sound('win');
  if (s.level === LEVEL_COUNT) {
    s.phase = 'won';
    s.mode = 'terminal';
    notice(s, 'won', 0);
  } else {
    setMode(s, 'level-clear');
    notice(s, 'level-clear', 0);
  }
}

/** How far card i is turned up, 0 (back) to 1 (front). */
export function memoryCardOpen(s, i) {
  if (s.matched[i] || s.echo?.lit === i) return 1;
  if (s.mode === 'preview')
    return Math.min(1, smooth(clamp(s.t / FLIP, 0, 1)), smooth(clamp((s.dur - s.t) / FLIP, 0, 1)));
  if (!s.flipped.includes(i)) return 0;
  if (s.mode === 'opening' && s.flipped[s.flipped.length - 1] === i)
    return smooth(clamp(s.t / FLIP, 0, 1));
  return s.mode === 'closing' ? 1 - smooth(clamp(s.t / FLIP, 0, 1)) : 1;
}

function cardAt(level, p) {
  const x = Number(p.x),
    y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  return LEVELS[level - 1].layout.cards.findIndex(
    (c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h,
  );
}
function onNext(p) {
  const b = NEXT_BUTTON;
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}
function relax(s, sound) {
  if (s.clock === 0) {
    notice(s, 'no-clock');
    return;
  }
  if (!s.started) s.timed = !s.timed;
  else if (s.timed) s.timed = false;
  else {
    notice(s, 'relaxed');
    return;
  }
  notice(s, s.timed ? 'timed' : 'relaxed');
  sound('move');
}
function turnCard(s, i, sound) {
  if (s.mode !== 'ready' || !(i >= 0 && i < s.deck.length)) return;
  if (s.matched[i] || s.flipped.includes(i)) {
    notice(s, 'already');
    return;
  }
  s.cursor = i;
  s.started = true;
  s.flipped.push(i);
  setMode(s, 'opening', FLIP);
  sound('move');
}
function moveCursor(s, input) {
  const { cols, rows } = LEVELS[s.level - 1].layout,
    dx = Number(input.pressed('ArrowRight', 'KeyD')) - Number(input.pressed('ArrowLeft', 'KeyA')),
    dy = Number(input.pressed('ArrowDown', 'KeyS')) - Number(input.pressed('ArrowUp', 'KeyW')),
    col = s.cursor % cols,
    row = Math.floor(s.cursor / cols);
  if (dx && !dy) s.cursor = row * cols + ((col + dx + cols) % cols);
  if (dy && !dx) s.cursor = ((row + dy + rows) % rows) * cols + col;
}
function handleInput(s, input, sound) {
  if (input.pressed('KeyT')) {
    relax(s, sound);
    return;
  }
  const p = input.pointer?.clicked ? input.pointer : null,
    confirm = input.pressed('Space', 'Enter');
  if (s.mode === 'level-clear') s.next = confirm || Boolean(p && onNext(p));
  else if (s.mode === 'preview') {
    if (confirm || (p && cardAt(s.level, p) >= 0)) s.t = Math.max(s.t, s.dur - FLIP);
  } else if (s.mode === 'ready' || LOCKS.has(s.mode)) {
    moveCursor(s, input);
    const hit = p ? cardAt(s.level, p) : -1,
      target = hit >= 0 ? hit : confirm ? s.cursor : -1;
    if (target < 0) return;
    if (s.mode === 'ready') turnCard(s, target, sound);
    else if (s.queue.length < QUEUE_MAX && s.queue[s.queue.length - 1] !== target)
      s.queue.push(target);
  }
}
/** Applies waiting taps the moment the board is ready again. */
function drainQueue(s, sound) {
  while (s.mode === 'ready' && s.queue.length) {
    const i = s.queue.shift();
    if (!s.matched[i] && !s.flipped.includes(i)) turnCard(s, i, sound);
  }
}

function checkGroup(s, sound) {
  const def = LEVELS[s.level - 1];
  if (s.flipped.length < def.group) {
    setMode(s, 'ready');
    return;
  }
  s.turns++;
  s.levelTurns++;
  const first = s.deck[s.flipped[0]],
    same = s.flipped.every((i) => s.deck[i] === first),
    inOrder = s.rule !== 'route' || first === s.route[s.routeIndex];
  s.correct = same && inOrder;
  setMode(s, 'reveal', s.correct ? MATCH_SHOW : def.show);
  if (s.correct) {
    for (const i of s.flipped) s.matched[i] = true;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.score += 100 + 20 * Math.min(s.streak, 5);
    if (s.rule === 'route') s.routeIndex++;
    notice(s, 'match');
    sound('coin');
    return;
  }
  s.streak = 0;
  if (s.lives !== null) s.lives--;
  notice(s, same ? 'order' : 'mismatch', 3);
  sound('hit');
}
function checkEcho(s, sound) {
  const e = s.echo;
  s.turns++;
  s.levelTurns++;
  s.correct = s.flipped[0] === s.sequence[e.input];
  setMode(s, 'reveal', s.correct ? ECHO_OK : ECHO_BAD);
  if (s.correct) {
    e.input++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.score += 50 + 10 * e.length;
    notice(s, 'echo-ok');
    sound('coin');
    return;
  }
  s.streak = 0;
  s.lives--;
  notice(s, 'echo-slip', 3);
  sound('hit');
}
function afterReveal(s, sound) {
  if (s.rule === 'echo' || !s.correct) {
    setMode(s, 'closing', FLIP);
    return;
  }
  s.flipped = [];
  if (s.matched.every(Boolean)) complete(s, sound);
  else setMode(s, 'ready');
}
function afterClose(s, sound) {
  s.flipped = [];
  if (s.lives === 0) lose(s, sound);
  else if (s.rule !== 'echo') setMode(s, 'ready');
  else {
    const e = s.echo;
    if (!s.correct) e.input = 0;
    else if (e.input === e.length) {
      if (e.length === s.sequence.length) {
        complete(s, sound);
        return;
      }
      e.length++;
      e.input = 0;
    } else {
      setMode(s, 'ready');
      return;
    }
    setMode(s, 'listen', LISTEN);
  }
}
function lightCue(s, sound) {
  const e = s.echo;
  e.lit = s.sequence[e.step];
  setMode(s, 'cue-on', LEVELS[s.level - 1].echo.cue);
  sound('move');
}
function finishMode(s, sound) {
  const def = LEVELS[s.level - 1];
  switch (s.mode) {
    case 'preview':
      setMode(s, 'ready');
      break;
    case 'opening':
      if (s.rule === 'echo') checkEcho(s, sound);
      else checkGroup(s, sound);
      break;
    case 'reveal':
      afterReveal(s, sound);
      break;
    case 'closing':
      afterClose(s, sound);
      break;
    case 'listen':
      s.echo.step = 0;
      lightCue(s, sound);
      break;
    case 'cue-on':
      s.echo.lit = -1;
      setMode(s, 'cue-gap', def.echo.gap);
      break;
    default:
      s.echo.step++;
      if (s.echo.step < s.echo.length) lightCue(s, sound);
      else {
        s.echo.input = 0;
        setMode(s, 'ready');
      }
  }
}
/** Spends up to `left` seconds in the current mode and returns what remains. */
function advance(s, left, sound) {
  let used = left;
  if (TIMED_MODES.has(s.mode)) {
    used = Math.min(left, Math.max(0, s.dur - s.t));
    s.t += used;
  }
  const running = s.mode === 'ready' && s.timed && s.clock > 0 && s.started;
  if (running) used = Math.min(used, s.remaining);
  s.time += used;
  s.feedbackTime = Math.max(0, s.feedbackTime - used);
  if (running) {
    s.remaining = Math.max(0, s.remaining - used);
    if (s.remaining <= EPS) {
      s.remaining = 0;
      lose(s, sound);
    }
  } else if (TIMED_MODES.has(s.mode) && s.t >= s.dur - EPS) {
    finishMode(s, sound);
    drainQueue(s, sound);
  }
  return left - used;
}
export function stepMemory(s, dt, input, sound) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  handleInput(s, input, sound);
  let left = Math.min(dt, STEP_CAP);
  while (left > EPS && s.phase === 'playing' && !s.next) left = advance(s, left, sound);
}
