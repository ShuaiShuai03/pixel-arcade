import { clamp } from '../shared/utils.js';
import {
  DIRECTIONS,
  adjacent,
  cellPoint,
  deadSquares,
  moveState,
  parseLevel,
  searchLevel,
  solveLevel,
  walkPath,
} from './crate-keeper-solver.js';
import { LEVELS, LEVEL_COUNT, LESSONS, PAR_PUSHES, roomScore } from './crate-keeper-levels.js';
import { MENU_COLUMNS, drawMenu, menuTarget } from './crate-keeper-menu.js';
import { crateLayout, drawWarehouse } from './crate-keeper-draw.js';

export { LEVELS, parseLevel, moveState, searchLevel, solveLevel, deadSquares, crateLayout };
export const meta = {
  id: 'crate-keeper',
  name: { en: 'Crate Keeper', zh: '仓库守护者' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Push one crate at a time onto every marked dock across twenty original warehouses, from a single shove to five-crate puzzles. Undo freely, ask for a hint, reset the room, and pick up where you left off.',
    zh: '每次推动一个木箱，把木箱放到标记货位。二十间原创仓库，从单箱入门到五箱难题。可随时撤销、提示或重置，并可从上次进度继续。',
  },
  keys: [
    {
      label: { en: 'Walk / push one tile', zh: '行走 / 推箱一格' },
      keys: {
        en: 'Arrows / WASD (hold to repeat); tap a tile to walk there',
        zh: '方向键 / WASD（按住连走）；点击格子走过去',
      },
    },
    { label: { en: 'Undo', zh: '撤销' }, keys: 'Z' },
    { label: { en: 'Hint', zh: '提示' }, keys: 'H' },
    { label: { en: 'Reset (Z undoes it)', zh: '重置（Z可撤销）' }, keys: 'X' },
    {
      label: { en: 'Warehouse select', zh: '选择仓库' },
      keys: { en: 'M (M / Esc closes)', zh: 'M（M / Esc 关闭）' },
    },
    { label: { en: 'Next after solving', zh: '完成后进入下一关' }, keys: 'Enter' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
    ['KeyZ', 'Undo', '撤销'],
    ['KeyH', 'Hint', '提示'],
    ['KeyX', 'Reset room', '重置本关'],
    ['KeyM', 'Rooms', '选关'],
    ['Enter', 'Next', '下一关'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};

const EPS = 1e-8;
const STEP_SECONDS = 0.1;
const PUSH_SECONDS = 0.14;
const UNDO_SECONDS = 0.1;
const BUFFER_SECONDS = 0.28;
const MAX_FRAME = 1 / 30;
const HINT_SECONDS = 4;
const HINT_NODES = 40000;
const HOLD_DELAY = 0.25;
const HOLD_REPEAT = 0.14;
const ALL_CLEARED = LEVEL_COUNT + 1;
const MOVE_KEYS = [
  'ArrowLeft',
  'KeyA',
  'ArrowRight',
  'KeyD',
  'ArrowUp',
  'KeyW',
  'ArrowDown',
  'KeyS',
];

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, ALL_CLEARED) : 1;
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
function direction(read) {
  const dx = Number(read('ArrowRight', 'KeyD')) - Number(read('ArrowLeft', 'KeyA')),
    dy = Number(read('ArrowDown', 'KeyS')) - Number(read('ArrowUp', 'KeyW'));
  return dx && dy ? null : dx || dy ? { dx, dy } : null;
}
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function createGame(env) {
  let level = 1,
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: Math.min(unlocked, LEVEL_COUNT) } : null,
    state = parseLevel(LEVELS[0]),
    history = [],
    moves = 0,
    pushes = 0,
    totalMoves = 0,
    totalPushes = 0,
    score = 0,
    phase = 'playing',
    time = 0,
    motion = null,
    pending = null,
    solved = false,
    confirmPending = false,
    pendingUndo = false,
    route = [],
    hold = null,
    hint = null,
    hintTimer = 0,
    feedback = { type: 'arrive', life: 0.6 },
    facing = { dx: 0, dy: 1 },
    dead = deadSquares(state);

  const done = () => state.crates.every((c) => state.goals.includes(c));
  const trapped = () => state.crates.filter((c) => dead.includes(c));
  const clearQueue = () => {
    pending = null;
    route = [];
    confirmPending = false;
    hint = null;
    hintTimer = 0;
  };

  function visuals() {
    const t = motion ? clamp(motion.elapsed / motion.duration, 0, 1) : 1;
    return {
      player: motion
        ? interpolate(motion.player.from, motion.player.to, t)
        : cellPoint(state, state.player),
      crate: motion?.crate
        ? { to: motion.crate.toIndex, at: interpolate(motion.crate.from, motion.crate.to, t) }
        : null,
    };
  }
  function load() {
    state = parseLevel(LEVELS[level - 1]);
    dead = deadSquares(state);
    history = [];
    moves = 0;
    pushes = 0;
    motion = null;
    solved = false;
    pendingUndo = false;
    hold = null;
    clearQueue();
    facing = { dx: 0, dy: 1 };
    feedback = { type: 'arrive', life: 0.6 };
  }
  function markSolved() {
    solved = true;
    pending = null;
    feedback = { type: 'solved', life: 0.6 };
    unlocked = Math.max(unlocked, level + 1);
    if (env.progress) saveUnlocked(env.progress, unlocked);
  }
  function advance() {
    if (!solved || motion) return;
    score += roomScore(level, moves);
    totalMoves += moves;
    totalPushes += pushes;
    env.sound('win');
    if (level < LEVEL_COUNT) {
      level++;
      load();
      return;
    }
    phase = 'won';
    pending = null;
    hint = null;
    hintTimer = 0;
    feedback = { type: 'complete', life: 1 };
    env.end({
      won: true,
      score,
      message: env.t('All twenty warehouses are in order!', '二十间仓库全部整理完毕！'),
    });
  }
  function startMove(dx, dy) {
    if (solved) return;
    const previousFacing = { ...facing },
      next = moveState(state, dx, dy);
    hint = null;
    hintTimer = 0;
    facing = { dx, dy };
    if (next === state) {
      feedback = { type: 'blocked', life: 0.25, cell: adjacent(state, state.player, dx, dy) };
      env.sound('hit');
      return;
    }
    const from = state,
      fromCrate = from.crates.find((c) => !next.crates.includes(c)),
      toCrate = next.crates.find((c) => !from.crates.includes(c)),
      pushed = fromCrate !== undefined;
    history.push({ state: from, moves, pushes, facing: previousFacing });
    state = next;
    moves++;
    if (pushed) pushes++;
    motion = {
      elapsed: 0,
      duration: pushed ? PUSH_SECONDS : STEP_SECONDS,
      player: { from: cellPoint(state, from.player), to: cellPoint(state, next.player) },
      crate: pushed
        ? {
            from: cellPoint(state, fromCrate),
            to: cellPoint(state, toCrate),
            toIndex: toCrate,
          }
        : null,
    };
    feedback = { type: pushed ? 'push' : 'walk', life: 0.25 };
    env.sound(pushed ? 'coin' : 'move');
  }
  // Rewind each cardinal segment fully before accepting a second undo.
  function undo() {
    clearQueue();
    if (motion) {
      pendingUndo = true;
      return;
    }
    pendingUndo = false;
    if (!history.length) return;
    const visible = visuals(),
      old = state,
      last = history.pop();
    state = last.state;
    moves = last.moves;
    pushes = last.pushes;
    facing = last.facing;
    solved = false;
    if (last.earlier) {
      history = last.earlier;
      solved = done();
      motion = null;
      feedback = { type: 'undo', life: 0.35 };
      env.sound('move');
      return;
    }
    const fromCrate = old.crates.find((c) => !state.crates.includes(c)),
      toCrate = state.crates.find((c) => !old.crates.includes(c));
    motion = {
      elapsed: 0,
      duration: UNDO_SECONDS,
      player: { from: visible.player, to: cellPoint(state, state.player) },
      crate:
        fromCrate !== undefined
          ? {
              from:
                visible.crate?.to === fromCrate ? visible.crate.at : cellPoint(state, fromCrate),
              to: cellPoint(state, toCrate),
              toIndex: toCrate,
            }
          : null,
    };
    feedback = { type: 'undo', life: 0.35 };
    env.sound('move');
  }
  function hintText(result) {
    const names = {
      ArrowLeft: env.t('← LEFT', '← 向左'),
      ArrowRight: env.t('RIGHT →', '向右 →'),
      ArrowUp: env.t('↑ UP', '↑ 向上'),
      ArrowDown: env.t('DOWN ↓', '向下 ↓'),
    };
    if (result.path?.length) return env.t('NEXT: ', '下一步：') + names[result.path[0]];
    if (result.status === 'limited')
      return env.t(
        'Search limit reached. Undo or reset remains available.',
        '搜索达到上限，仍可撤销或重置。',
      );
    if (result.status === 'solved')
      return env.t('All docks filled. Choose Next when ready.', '货位已满，准备好后选择下一关。');
    return env.t('No route from here. Undo or reset the room.', '此处已无解，请撤销或重置本关。');
  }
  // Reset is itself an undo step, so Z brings back the room exactly as it was.
  function resetRoom() {
    const before = { state, moves, pushes, facing, earlier: history };
    const wasPristine = !history.length && !motion;
    load();
    if (!wasPristine) history = [before];
    env.sound('move');
  }
  function askHint() {
    pending = null;
    route = [];
    pendingUndo = false;
    const result = searchLevel(state, HINT_NODES);
    hint = { status: result.status, code: result.path?.[0] ?? null, text: hintText(result) };
    hintTimer = HINT_SECONDS;
    env.sound('move');
  }
  function settleMotion() {
    motion = null;
    if (pendingUndo) {
      pendingUndo = false;
      undo();
      return;
    }
    if (done()) {
      markSolved();
      if (confirmPending) {
        confirmPending = false;
        advance();
      }
      return;
    }
    if (pending) {
      const action = pending;
      pending = null;
      if (action.expires >= time - EPS) startMove(action.dx, action.dy);
    } else stepRoute();
  }
  function stepRoute() {
    const key = route.shift();
    if (key === undefined || solved) return;
    const [, dx, dy] = DIRECTIONS.find((d) => d[0] === key);
    startMove(dx, dy);
  }
  function tick(dt) {
    let remaining = dt;
    while (remaining > EPS && phase === 'playing') {
      const t = motion ? Math.min(remaining, motion.duration - motion.elapsed) : remaining;
      time += t;
      hintTimer = Math.max(0, hintTimer - t);
      if (feedback) feedback.life = Math.max(0, feedback.life - t);
      if (motion) motion.elapsed += t;
      remaining -= t;
      if (motion && motion.elapsed >= motion.duration - EPS) settleMotion();
    }
  }
  // A tap on a neighbour steps (or pushes); a tap on any other reachable floor tile walks there.
  function pointerAction(input) {
    if (!input.pointer?.clicked || input.pressed(...MOVE_KEYS)) return null;
    const { size, ox, oy } = crateLayout(state.w, state.h),
      x = Math.floor((input.pointer.x - ox) / size),
      y = Math.floor((input.pointer.y - oy) / size);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null;
    if (x >= state.w || y >= state.h) return null;
    const dx = x - (state.player % state.w),
      dy = y - Math.floor(state.player / state.w);
    if (Math.abs(dx) + Math.abs(dy) === 1) return { dx, dy };
    return { target: y * state.w + x };
  }
  function heldAction(input, elapsed) {
    const dir = direction(input.held);
    if (!dir) {
      hold = null;
      return null;
    }
    if (hold?.dx !== dir.dx || hold?.dy !== dir.dy) {
      hold = { ...dir, left: HOLD_DELAY };
      return null;
    }
    hold.left -= elapsed;
    if (hold.left > EPS) return null;
    hold.left += HOLD_REPEAT;
    return dir;
  }
  function startRoute(target) {
    const path = walkPath(state, target);
    if (!path?.length) return;
    route = path.slice();
    if (!motion) stepRoute();
  }
  function openMenu() {
    menu = { cursor: level };
    env.sound('move');
  }
  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (target.cancel) {
      menu = null;
      env.sound('move');
      return;
    }
    if (!target.start) return;
    const same = menu.cursor === level;
    level = menu.cursor;
    menu = null;
    if (!same) load();
  }
  function update(dt, input) {
    if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    if (menu) return menuStep(input);
    const elapsed = Math.min(dt, MAX_FRAME);
    if (input.pressed('KeyM')) return openMenu();
    if (input.pressed('KeyX')) resetRoom();
    else if (input.pressed('KeyZ')) undo();
    else if (input.pressed('KeyH')) askHint();
    else if (input.pressed('Enter')) {
      pendingUndo = false;
      pending = null;
      route = [];
      if (done() && motion) confirmPending = true;
      else if (done()) {
        solved = true;
        advance();
      }
    } else {
      const pressedDir = direction(input.pressed);
      if (pressedDir) hold = { ...pressedDir, left: HOLD_DELAY };
      const action = pressedDir ?? heldAction(input, elapsed) ?? pointerAction(input);
      if (action?.target !== undefined) startRoute(action.target);
      else if (action && !solved) {
        route = [];
        if (motion) pending = { dx: action.dx, dy: action.dy, expires: time + BUFFER_SECONDS };
        else startMove(action.dx, action.dy);
      }
    }
    tick(elapsed);
  }
  function draw(ctx) {
    if (menu) return drawMenu(ctx, { cursor: menu.cursor, unlocked }, env);
    drawWarehouse(
      ctx,
      {
        level,
        state,
        moves,
        pushes,
        parPushes: PAR_PUSHES[level - 1],
        phase,
        time,
        motion,
        solved,
        hint: hintTimer > 0 ? hint : null,
        feedback,
        trapped: trapped(),
        facing,
        visual: visuals(),
      },
      env,
    );
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      level,
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      moves,
      pushes,
      totalMoves,
      totalPushes,
      time,
      solved,
      busy: Boolean(motion),
      motion: structuredClone(motion),
      pending: structuredClone(pending),
      confirmPending,
      pendingUndo,
      routeLength: route.length,
      parPushes: PAR_PUSHES[level - 1],
      deadlocked: trapped().length > 0,
      deadCrates: trapped(),
      undoCount: history.length,
      hint: hintTimer > 0 ? (hint?.text ?? null) : null,
      hintCode: hintTimer > 0 ? (hint?.code ?? null) : null,
      hintStatus: hintTimer > 0 ? (hint?.status ?? null) : null,
      ...structuredClone(state),
      status: {
        en: `Warehouse ${level}/${LEVEL_COUNT} · ${moves} moves · ${solved ? 'Complete. Undo, reset, or choose Next.' : trapped().length ? 'Crate cannot reach a dock. Undo or reset.' : LESSONS[level - 1][0]}`,
        zh: `仓库 ${level}/${LEVEL_COUNT} · ${moves} 步 · ${solved ? '已完成，可撤销、重置或选择下一关。' : trapped().length ? '箱子无法到达货位，请撤销或重置。' : LESSONS[level - 1][1]}`,
      },
    }),
  };
}
