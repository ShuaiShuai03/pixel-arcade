import {
  RULES,
  deepFreeze,
  parseBoard,
  solveFrom,
  isMatched,
  mismatches,
  pressable,
  pressed,
  advise,
} from './phase-tiles-rules.js';
import { BOARD_DEFS } from './phase-tiles-boards.js';
import { drawPlay, drawMenu, layoutOf, cellAt, menuCellAt } from './phase-tiles-draw.js';

export {
  RULES,
  SHAPE_KEYS,
  reach,
  parseBoard,
  solveFrom,
  isMatched,
  mismatches,
  pressable,
  pressed,
  advise,
} from './phase-tiles-rules.js';
export { layoutOf, cellAt, menuCellAt } from './phase-tiles-draw.js';

const R = RULES;
const STEP = R.step;

export const BOARDS = Object.freeze(BOARD_DEFS.map(parseBoard));
export const BOARD_COUNT = BOARDS.length;

// --- Metadata -------------------------------------------------------------------------------
const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));
export const meta = deepFreeze({
  id: 'phase-tiles',
  name: { en: 'Phase Tiles', zh: '相位方格' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: `Glowing tiles sit on a woven board, each one showing a phase. Press a tile and every tile in its influence shape, shown as a preview under the cursor, moves one phase on and wraps around at the end. Match the small target card. Later boards bring holes, locked tiles that still change, diagonal, ring, line and knight shapes, tiles with their own icons and three phases. Many boards allow only a limited number of presses, and undo refunds one. The first ${R.hintFreeBoards} boards glow the next move for you; after that the goal is yours to work out, and the H key buys a hint for ${R.hintPenalty} points. Clear all ${BOARD_COUNT} boards; progress is saved.`,
    zh: `发光的方格排在织纹棋盘上，每格显示一个相位。按下一个方格，它影响范围内的所有方格（光标下会预览）都前进一个相位，到头后循环回到开头。让棋盘与右侧的小目标卡一致。后面的棋盘会出现空洞、仍会被带动的锁定方格、斜叉、圆环、整行整列和马步等影响范围、各带图标的方格以及三个相位。许多棋盘限制按压次数，撤销会退还一次。前 ${R.hintFreeBoards} 块棋盘会用发光提示告诉你下一步；之后要靠自己思考，按 H 键可花 ${R.hintPenalty} 分换一次提示。完成全部 ${BOARD_COUNT} 块棋盘，进度会被保存。`,
  },
  keys: [
    { label: { en: 'Move the cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    { label: { en: 'Press the tile', zh: '按下方格' }, keys: 'Space' },
    { label: { en: 'Undo the last press', zh: '撤销上一次按压' }, keys: 'Z' },
    { label: { en: 'Reset this board', zh: '重置本棋盘' }, keys: 'Q' },
    {
      label: {
        en: `Show the next move (board ${R.hintFreeBoards + 1} on, -${R.hintPenalty} points)`,
        zh: `显示下一步（第 ${R.hintFreeBoards + 1} 块起，扣 ${R.hintPenalty} 分）`,
      },
      keys: 'H',
    },
    {
      label: {
        en: 'Tap a tile to select it, tap again to press it',
        zh: '点一下选中方格，再点一下按下',
      },
      keys: { en: 'Tap', zh: '点按' },
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Press', '按下', 'right'],
    ['KeyZ', 'Undo', '撤销', 'right'],
    ['KeyQ', 'Reset', '重置', 'right'],
    ['KeyH', 'Hint', '提示', 'right'],
  ]),
});

// --- Prompt ---------------------------------------------------------------------------------
const ARROW_GLYPH = ['→', '↓', '←', '↑'];
const DIR_CODES = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
const PLAIN = {
  menu: ['Choose a board: arrows, then Space', '选择棋盘：方向键，再按空格'],
  match: ['Matched! Hold still', '已对齐！请稍等'],
  cleared: ['Board clear! Next board coming', '过关！即将进入下一块'],
  won: ['Every board is clear. Well done!', '全部棋盘已通关，做得好！'],
  lost: ['Out of presses: the board failed', '次数用完：本块棋盘失败'],
  undo: ['Z: undo the extra press', 'Z：撤销多余的一步'],
  press: ['Space: press this tile', '空格：按下这个方格'],
  again: ['Space: press this tile again', '空格：再按一次这个方格'],
};

// What the default prompt says on the boards that do not hand out the next move: the goal only.
export const goalLine = () => [
  `Match every tile to the target card  [H] hint -${R.hintPenalty}`,
  `让每个方格与目标卡一致  [H] 提示 -${R.hintPenalty}`,
];

export function adviceLine(adv, again = false) {
  if (adv.kind === 'undo') return [...PLAIN.undo];
  if (adv.kind === 'done') return [...PLAIN.match];
  if (adv.kind === 'act') return [...(again ? PLAIN.again : PLAIN.press)];
  return [
    `Move ${ARROW_GLYPH[adv.dir]} ${adv.steps} to row ${adv.y + 1}, col ${adv.x + 1}`,
    `光标向${'右下左上'[adv.dir]}移 ${adv.steps} 格，到第 ${adv.y + 1} 行第 ${adv.x + 1} 列`,
  ];
}

// --- Game state -----------------------------------------------------------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isNaN(n) ? 1 : clamp(n, 1, BOARD_COUNT);
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

const pressesLeftOf = (s) => (s.board.budget === null ? Infinity : s.board.budget - s.moves);
const say = (s, en, zh) => {
  s.msg = { en, zh, time: R.msgTime };
};

// The influence set under the cursor, or nothing when that tile cannot be pressed.
const hintShown = (s) => s.index < R.hintFreeBoards || s.hintOn;
const previewOf = (s) => {
  const i = s.cy * s.board.w + s.cx;
  return pressable(s.board, i) ? s.board.influence[i] : [];
};

function startCursor(board) {
  const mid = { x: (board.w - 1) / 2, y: (board.h - 1) / 2 };
  let best = null;
  board.cells.forEach((c, i) => {
    if (!pressable(board, i)) return;
    const gap = Math.abs((i % board.w) - mid.x) + Math.abs(Math.floor(i / board.w) - mid.y);
    if (!best || gap < best.gap) best = { x: i % board.w, y: Math.floor(i / board.w), gap };
  });
  return best;
}

function refresh(s) {
  let adv = { kind: 'none' };
  let words;
  if (s.menu) words = PLAIN.menu;
  else if (s.phase === 'won') words = PLAIN.won;
  else if (s.phase === 'lost') words = PLAIN.lost;
  else if (s.cleared) words = PLAIN.cleared;
  else {
    if (hintShown(s)) {
      adv = advise(s.board, s.cells, { x: s.cx, y: s.cy }, pressesLeftOf(s), s.history.length > 0);
      words = adviceLine(adv, adv.kind === 'act' && s.history.at(-1)?.i === adv.i);
    } else {
      adv = { kind: 'hidden' };
      words = goalLine();
    }
  }
  s.line = { en: words[0], zh: words[1] };
  s.hint = {
    kind: adv.kind,
    x: adv.x ?? null,
    y: adv.y ?? null,
    dir: adv.kind === 'move' ? adv.dir : null,
    steps: adv.kind === 'move' ? adv.steps : 0,
    key: { move: DIR_CODES[adv.dir], undo: 'KeyZ', act: 'Space' }[adv.kind] ?? null,
    shown: adv.kind !== 'hidden' && adv.kind !== 'none',
  };
}

function loadBoard(s, index) {
  s.index = index;
  s.board = BOARDS[index];
  s.cells = [...s.board.start];
  s.moves = 0;
  s.history = [];
  s.hintOn = false;
  s.roomHints = 0;
  const cursor = startCursor(s.board);
  s.cx = cursor.x;
  s.cy = cursor.y;
  s.cleared = false;
  s.clearT = 0;
  s.settle = 0;
  s.msg = null;
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
    hints: 0,
    sparks: [],
    clock: 0,
    acc: 0,
    count: BOARD_COUNT,
    progress: env.progress || null,
  };
  const unlocked = s.progress ? readUnlocked(s.progress) : 1;
  loadBoard(s, 0);
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

function clearBoard(s, env) {
  const extra = Math.max(0, s.moves - s.board.optimal);
  const cost = R.extraPressPenalty * extra + R.hintPenalty * s.roomHints;
  s.score += Math.max(R.minBoardScore, R.clearScore - cost);
  saveUnlocked(s.progress, Math.min(BOARD_COUNT, s.index + 2));
  s.cleared = true;
  env.sound('win');
  if (s.index + 1 >= BOARD_COUNT) {
    s.phase = 'won';
    finish(
      s,
      env,
      true,
      env.t('Every board is clear. The loom is yours!', '全部棋盘通关，织机归你了！'),
    );
  }
  refresh(s);
}

function loseBoard(s, env) {
  s.phase = 'lost';
  env.sound('lose');
  finish(
    s,
    env,
    false,
    env.t(
      `Out of presses on board ${s.index + 1}. Try it again.`,
      `第 ${s.index + 1} 块棋盘的按压次数用完了，再试一次。`,
    ),
  );
  refresh(s);
}

function spark(s, i) {
  const o = layoutOf(s.board);
  const x = o.x + (i % s.board.w) * R.cell + R.cell / 2;
  const y = o.y + Math.floor(i / s.board.w) * R.cell + R.cell / 2;
  for (let k = 0; k < 4 && s.sparks.length < 80; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    s.sparks.push({
      x,
      y,
      vx: Math.cos(a) * 50,
      vy: Math.sin(a) * 50,
      life: 0.35,
      color: '#6dffc0',
    });
  }
}

function stepSim(s, env) {
  s.clock += STEP;
  s.sparks = s.sparks
    .map((p) => ({ ...p, x: p.x + p.vx * STEP, y: p.y + p.vy * STEP, life: p.life - STEP }))
    .filter((p) => p.life > 0);
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.cleared) {
    s.clearT += STEP;
    if (s.phase === 'playing' && s.clearT >= R.clearPause) loadBoard(s, s.index + 1);
    return;
  }
  s.settle += STEP;
  if (isMatched(s.board, s.cells)) {
    if (s.settle >= R.settleWin) clearBoard(s, env);
  } else if (pressesLeftOf(s) <= 0 && s.settle >= R.settleLose) loseBoard(s, env);
}

// --- Player actions -------------------------------------------------------------------------
function pressUnderCursor(s, env) {
  const i = s.cy * s.board.w + s.cx;
  const cell = s.board.cells[i];
  if (!pressable(s.board, i)) {
    if (cell.locked) say(s, 'Locked: it cannot be pressed', '已锁定：不能按');
    else say(s, 'No tile here', '这里没有方格');
    env.sound('hit');
    return;
  }
  if (pressesLeftOf(s) <= 0) {
    say(s, 'No presses left: undo with Z', '没有剩余次数：按 Z 撤销');
    env.sound('hit');
    return;
  }
  const before = s.cells;
  s.history.push({ i, moves: s.moves });
  if (s.history.length > R.historyMax) s.history.shift();
  s.cells = pressed(s.board, s.cells, i);
  s.hintOn = false;
  s.moves = Math.min(R.pressesMax, s.moves + 1);
  s.settle = 0;
  for (const j of s.board.influence[i])
    if (s.cells[j] === s.board.target[j] && before[j] !== s.board.target[j]) spark(s, j);
  env.sound('move');
  refresh(s);
}

function undoPress(s, env) {
  const last = s.history.pop();
  if (!last) {
    say(s, 'Nothing to undo', '没有可撤销的操作');
    return;
  }
  s.cells = pressed(s.board, s.cells, last.i, -1);
  s.moves = last.moves;
  s.cx = last.i % s.board.w;
  s.cy = Math.floor(last.i / s.board.w);
  s.undos++;
  s.hintOn = false;
  s.settle = 0;
  env.sound('move');
  refresh(s);
}

// Asking for the next move costs points; the hint covers one move, and a press, undo or reset hides it.
function requestHint(s, env) {
  if (hintShown(s) || isMatched(s.board, s.cells)) return;
  s.hintOn = true;
  s.hints++;
  s.roomHints++;
  say(s, `Hint: -${R.hintPenalty} points`, `提示：扣 ${R.hintPenalty} 分`);
  env.sound('coin');
  refresh(s);
}

function restartBoard(s, env) {
  const { roomHints } = s;
  const restarts = s.restarts + 1;
  loadBoard(s, s.index);
  s.restarts = restarts;
  s.roomHints = roomHints;
  say(s, 'Board reset', '棋盘已重置');
  env.sound('move');
}

function moveCursor(s, env, input) {
  const dx =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const dy =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  if ((dx === 0) === (dy === 0)) return; // idle, opposite keys or a diagonal press
  const x = clamp(s.cx + dx, 0, s.board.w - 1);
  const y = clamp(s.cy + dy, 0, s.board.h - 1);
  if (x === s.cx && y === s.cy) return;
  s.cx = x;
  s.cy = y;
  env.sound('move');
  refresh(s);
}

function playInput(s, env, input) {
  const p = input.pointer;
  if (p?.clicked) {
    const hit = cellAt(s.board, p.x, p.y);
    if (hit && hit.x === s.cx && hit.y === s.cy) pressUnderCursor(s, env);
    else if (hit) {
      s.cx = hit.x;
      s.cy = hit.y;
      env.sound('move');
      refresh(s);
    }
  }
  moveCursor(s, env, input);
  if (input.pressed('KeyQ')) return restartBoard(s, env);
  if (input.pressed('KeyH')) requestHint(s, env);
  if (input.pressed('KeyZ')) undoPress(s, env);
  if (input.pressed('Space')) pressUnderCursor(s, env);
  return undefined;
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
    const hit = menuCellAt(p.x, p.y, BOARD_COUNT);
    if (hit >= 1 && hit <= m.unlocked) {
      go = hit === m.sel;
      m.sel = hit;
    }
  }
  if (go || input.pressed('Space', 'Enter')) {
    loadBoard(s, m.sel - 1);
    s.menu = null;
    refresh(s);
    env.sound('move');
  }
}

// Any of these (or a tap) skips the pause after a board is cleared.
const SKIP_CODES = [
  'Space',
  'Enter',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
];

function frameInput(s, env, input) {
  if (s.menu) return menuInput(s, env, input);
  if (s.cleared) {
    if (s.phase === 'playing' && (input.pressed(...SKIP_CODES) || input.pointer?.clicked))
      loadBoard(s, s.index + 1);
    return undefined;
  }
  return playInput(s, env, input);
}

// Seconds left before an unsolved board with no presses left is lost; null while that is not so.
const loseCountdown = (s) =>
  s.board.budget !== null && pressesLeftOf(s) <= 0 && !isMatched(s.board, s.cells) && !s.cleared
    ? Math.max(0, R.settleLose - s.settle)
    : null;

// --- Status ---------------------------------------------------------------------------------
function statusFor(s) {
  if (s.menu) return { en: s.line.en, zh: s.line.zh };
  const off = mismatches(s.board, s.cells);
  const budget = s.board.budget === null ? '' : `/${s.board.budget}`;
  return {
    en: `Board ${s.index + 1}/${BOARD_COUNT} · Presses ${s.moves}${budget} · Off ${off} · ${s.line.en}`,
    zh: `第 ${s.index + 1}/${BOARD_COUNT} 块 · 按压 ${s.moves}${budget} · 错位 ${off} · ${s.line.zh}`,
  };
}

const rowsOf = (board, values) =>
  Array.from({ length: board.h }, (_, y) =>
    Array.from({ length: board.w }, (__, x) =>
      board.cells[y * board.w + x].hole ? '#' : String(values[y * board.w + x]),
    ).join(''),
  );

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
      if (s.menu) drawMenu(ctx, s, lang, BOARDS);
      else drawPlay(ctx, s, lang, previewOf(s), loseCountdown(s));
    },
    getState() {
      const preview = previewOf(s);
      return {
        phase: s.phase,
        score: s.score,
        level: s.index + 1,
        levelCount: BOARD_COUNT,
        name: { ...s.board.name },
        tip: { ...s.board.tip },
        phases: s.board.phases,
        width: s.board.w,
        height: s.board.h,
        board: rowsOf(s.board, s.cells),
        target: rowsOf(s.board, s.board.target),
        cursor: { x: s.cx, y: s.cy },
        moves: s.moves,
        budget: s.board.budget,
        movesLeft: s.board.budget === null ? null : s.board.budget - s.moves,
        optimal: s.board.optimal,
        off: mismatches(s.board, s.cells),
        solved: isMatched(s.board, s.cells),
        loseIn: loseCountdown(s),
        cleared: s.cleared,
        preview: preview.map((i) => ({ x: i % s.board.w, y: Math.floor(i / s.board.w) })),
        undos: s.undos,
        hints: s.hints,
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
