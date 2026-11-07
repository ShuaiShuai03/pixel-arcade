import {
  RULES,
  DIRS,
  ARROWS,
  TILE_TYPES,
  canTurn,
  analyze,
  networkAt,
  solve,
} from './circuit-weaver-engine.js';
import { BOARDS, BOARD_COUNT } from './circuit-weaver-boards.js';
import { drawGame, layoutOf, menuLayout } from './circuit-weaver-draw.js';

export {
  RULES,
  DIRS,
  TILE_TYPES,
  rotateMask,
  portMask,
  parseBoard,
  analyze,
  networkAt,
  solve,
  probe,
  masksOf,
} from './circuit-weaver-engine.js';
export { BOARDS, BOARD_COUNT } from './circuit-weaver-boards.js';
export { layoutOf, menuLayout } from './circuit-weaver-draw.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'circuit-weaver',
  name: { en: 'Circuit Weaver', zh: '电路织匠' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Rotate etched copper tiles until every lamp glows at its own voltage. Two neighbouring tiles only connect when BOTH show a port on the shared edge, so a bend that points at a wall or a gap is an open end. Different voltages that meet make a SHORT, and a short blocks the win. Bridges let two tracks cross without touching, locked tiles will not turn, and some boards give a limited number of turns before a fuse blows (three fuses per run). Arrows move the cursor, Space rotates, X inspects a network, Z undoes; on a phone tap a tile to select it and tap again to turn it. Wire up all boards; progress is saved.',
    zh: '转动蚀刻的铜线块，让每盏灯都以自己的电压亮起。相邻两块只有在公共边上两边都有接口时才会连通，所以对着墙或空格的弯头只是断头。不同电压相遇会造成短路，短路时无法通关。桥接块能让两条线交叉而不相连，锁定的块无法转动，有些电路板限制转动次数，用完会烧断保险丝（每局三根）。方向键移动光标，空格转动，X 检查线网，Z 撤销；手机上点一下选中块，再点一下转动。完成所有电路板，进度会被保存。',
  },
  keys: [
    { label: { en: 'Move the cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    { label: { en: 'Rotate the tile', zh: '转动块' }, keys: 'Space' },
    { label: { en: 'Inspect a network', zh: '检查线网' }, keys: 'X' },
    { label: { en: 'Undo a turn', zh: '撤销转动' }, keys: 'Z' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Turn', '转动', 'right'],
    ['KeyX', 'Inspect', '检查', 'right'],
    ['KeyZ', 'Undo', '撤销', 'right'],
  ]),
};

const R = RULES;
const STEP = R.step;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// --- Prompt ---
const KIND = {
  straight: ['straight', '直线块'],
  corner: ['corner', '转角块'],
  tee: ['tee', '三通块'],
};

// The terminal a tile sits beside, or null when none is near or two are equally near.
function landmarkOf(board, i) {
  const c = i % board.cols;
  const r = (i / board.cols) | 0;
  let best = null;
  let tied = false;
  for (const j of [...board.sources, ...board.sinks]) {
    const gap = Math.abs((j % board.cols) - c) + Math.abs(((j / board.cols) | 0) - r);
    if (gap > 2) continue;
    if (!best || gap < best.gap) {
      best = { j, gap };
      tied = false;
    } else if (gap === best.gap) tied = true;
  }
  if (!best || tied) return null;
  const cell = board.cells[best.j];
  const src = cell.type === 'source';
  return {
    en: `by the ${cell.volt} V ${src ? 'source' : 'lamp'}`,
    zh: `${cell.volt} V${src ? '电源' : '灯'}旁`,
    volt: cell.volt,
    role: cell.type,
  };
}

// Whether a tile sits within two cells of any terminal that has this landmark's voltage and role.
function nearLandmark(board, i, mark) {
  const c = i % board.cols;
  const r = (i / board.cols) | 0;
  return [...board.sources, ...board.sinks].some((j) => {
    const cell = board.cells[j];
    const gap = Math.abs((j % board.cols) - c) + Math.abs(((j / board.cols) | 0) - r);
    return gap <= 2 && cell.volt === mark.volt && cell.type === mark.role;
  });
}

// Names a tile so that exactly one tile on the board fits: its landmark when no tile of the same
// kind shares it, otherwise its row and column.
export function describeTile(board, i) {
  const mark = landmarkOf(board, i);
  const twins = (j) => board.cells[j].type === board.cells[i].type && nearLandmark(board, j, mark);
  if (mark && board.cells.filter((_, j) => twins(j)).length === 1) return mark;
  const c = i % board.cols;
  const r = (i / board.cols) | 0;
  return { en: `at row ${r + 1}, col ${c + 1}`, zh: `第${r + 1}行第${c + 1}列` };
}

// The next useful turn from the CURRENT state, or an undo when the turns left cannot finish.
export function adviceFor(board, rots, cursor, left, canUndo, plan = solve(board, rots)) {
  if (!plan)
    return { id: 'none', en: 'No wiring fits this board', zh: '这块板无法接通', hint: null };
  if (left !== null && plan.cost > left && canUndo)
    return {
      id: 'undo',
      en: 'Press Z to undo: too few turns left',
      zh: '按 Z 撤销：剩余转动不够',
      hint: { press: 'KeyZ', c: cursor.c, r: cursor.r, dir: null, count: 0 },
    };
  const need = [];
  board.cells.forEach((cell, i) => {
    const period = TILE_TYPES[cell.type].period;
    const count = (plan.target[i] - rots[i] + period) % period;
    if (canTurn(cell) && count > 0) need.push({ i, count });
  });
  if (!need.length) return { id: 'done', en: 'Wiring is complete', zh: '接线已完成', hint: null };
  const dist = (n) =>
    Math.abs((n.i % board.cols) - cursor.c) + Math.abs(((n.i / board.cols) | 0) - cursor.r);
  const goal = need.reduce((a, n) => (dist(n) < dist(a) ? n : a));
  const c = goal.i % board.cols;
  const r = (goal.i / board.cols) | 0;
  const kind = KIND[board.cells[goal.i].type];
  if (c === cursor.c && r === cursor.r) {
    const times = goal.count > 1;
    return {
      id: 'turn',
      en: `Press Space to turn this ${kind[0]}${times ? ` (${goal.count}x)` : ''}`,
      zh: `按空格转动这个${kind[1]}${times ? `（${goal.count}次）` : ''}`,
      hint: { press: 'Space', c, r, dir: null, count: goal.count },
    };
  }
  const dir = r !== cursor.r ? (r > cursor.r ? 2 : 0) : c > cursor.c ? 1 : 3;
  const mark = describeTile(board, goal.i);
  return {
    id: 'move',
    en: `Move the cursor ${ARROWS[dir]} to the ${kind[0]} ${mark.en}, then Space`,
    zh: `把光标向${ARROWS[dir]}移到${mark.zh}的${kind[1]}，再按空格`,
    hint: {
      press: ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][dir],
      c,
      r,
      dir: DIRS[dir],
      count: goal.count,
    },
  };
}

// --- State ---
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  turn: ['Space', 'Enter'],
  inspect: ['KeyX'],
  undo: ['KeyZ'],
};

function say(s, en, zh) {
  s.msg = { en, zh, time: R.msgTime };
}

function enterBoard(s, level) {
  const b = BOARDS[level];
  s.level = level;
  s.board = b;
  s.rots = b.start.slice();
  s.cursor = { c: 0, r: 0 };
  s.moves = 0;
  s.undo = [];
  s.inspect = false;
  s.stage = 'play';
  s.freeze = 0;
  s.menu = null;
  s.adviceKey = null;
  s.tipLeft = R.tipTime;
  refresh(s);
  const first = b.cells.findIndex((cell) => canTurn(cell));
  if (first >= 0) s.cursor = { c: first % b.cols, r: (first / b.cols) | 0 };
}

function refresh(s) {
  s.an = analyze(s.board, s.rots);
  s.shorted = s.an.shorts.length > 0;
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    stage: 'play',
    score: 0,
    acc: 0,
    ticks: 0,
    fuses: R.fuses,
    best: BOARDS.map(() => 0),
    progress: env.progress || null,
    prev: {},
    msg: null,
    stats: { turns: 0, undos: 0, shorts: 0, blown: 0, cleared: 0, locked: 0 },
  };
  const raw = Number(s.progress?.unlocked?.());
  const unlocked = Number.isNaN(raw) ? 1 : clamp(Math.floor(raw), 1, BOARD_COUNT);
  enterBoard(s, 0);
  if (unlocked > 1) {
    s.stage = 'menu';
    s.menu = { sel: unlocked, unlocked };
  }
  return s;
}

// --- Actions ---
function trigger(s, input, name) {
  const codes = KEYS[name];
  const held = input.held(...codes);
  const fired = input.pressed(...codes) || (held && !s.prev[name]);
  s.prev[name] = held;
  return fired;
}

function moveCursor(s, dc, dr, emit) {
  const c = clamp(s.cursor.c + dc, 0, s.board.cols - 1);
  const r = clamp(s.cursor.r + dr, 0, s.board.rows - 1);
  if (c !== s.cursor.c || r !== s.cursor.r) emit('move');
  s.cursor = { c, r };
}

function turnTile(s, emit) {
  const i = s.cursor.r * s.board.cols + s.cursor.c;
  const cell = s.board.cells[i];
  if (!canTurn(cell)) {
    s.stats.locked++;
    say(
      s,
      cell.locked ? 'Locked tile' : 'This tile does not turn',
      cell.locked ? '已锁定' : '此块不能转动',
    );
    emit('hit');
    return;
  }
  s.undo.push({ rots: s.rots, moves: s.moves, cursor: { ...s.cursor } });
  if (s.undo.length > R.undoLimit) s.undo.shift();
  const rots = s.rots.slice();
  rots[i] = (rots[i] + 1) % TILE_TYPES[cell.type].period;
  s.rots = rots;
  s.moves++;
  s.stats.turns++;
  emit('move');
  settle(s, emit);
}

function undoTurn(s, emit) {
  if (!s.undo.length) {
    say(s, 'Nothing to undo', '没有可撤销的转动');
    return;
  }
  const last = s.undo.pop();
  s.rots = last.rots;
  s.moves = last.moves;
  s.cursor = { ...last.cursor };
  s.stats.undos++;
  emit('move');
  refresh(s);
}

// After every turn: a short is announced, a lit board starts its victory pause, and an empty
// turn budget blows a fuse. A board that is solved on its last turn counts as solved.
function settle(s, emit) {
  const wasShorted = s.shorted;
  refresh(s);
  if (s.shorted && !wasShorted) {
    s.stats.shorts++;
    emit('hit');
  }
  if (s.an.solved) {
    s.stage = 'powered';
    s.freeze = R.clearPause;
    emit('coin');
    return;
  }
  if (s.board.budget !== null && s.moves >= s.board.budget) {
    s.fuses--;
    s.stats.blown++;
    s.stage = 'blown';
    s.freeze = R.blowPause;
    emit('hit');
    if (s.fuses <= 0) s.phase = 'lost';
  }
}

function finishBoard(s) {
  const b = s.board;
  const par = solve(b, b.start).cost;
  const extra = s.moves - par;
  const gained =
    R.clearScore +
    (extra <= 0 ? R.perfectScore : extra <= 2 ? R.closeScore : 0) +
    s.fuses * R.fuseScore;
  s.best[s.level] = Math.max(s.best[s.level], gained);
  s.score = clamp(
    s.best.reduce((a, v) => a + v, 0),
    0,
    R.maxScore,
  );
  s.stats.cleared++;
  s.progress?.unlock?.(Math.min(BOARD_COUNT, s.level + 2));
  if (s.level === BOARD_COUNT - 1) s.phase = 'won';
  else enterBoard(s, s.level + 1);
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const dx = (trigger(s, input, 'right') ? 1 : 0) - (trigger(s, input, 'left') ? 1 : 0);
  const dy = (trigger(s, input, 'down') ? 1 : 0) - (trigger(s, input, 'up') ? 1 : 0);
  const sel = clamp(m.sel + dx + dy * R.menuCols, 1, m.unlocked);
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  const start = trigger(s, input, 'turn');
  const p = input.pointer;
  if (p?.clicked) {
    const lay = menuLayout(BOARD_COUNT);
    const c = Math.floor((p.x - lay.x) / lay.cell);
    const r = Math.floor((p.y - lay.y) / lay.cell);
    const hit = r * lay.cols + c + 1;
    if (c >= 0 && c < lay.cols && r >= 0 && hit >= 1 && hit <= m.unlocked) {
      if (hit === m.sel) enterBoard(s, hit - 1);
      else {
        m.sel = hit;
        emit('move');
      }
      return;
    }
  }
  if (start) {
    enterBoard(s, m.sel - 1);
    emit('move');
  }
}

function playInput(s, input, emit) {
  const dx = (trigger(s, input, 'right') ? 1 : 0) - (trigger(s, input, 'left') ? 1 : 0);
  const dy = (trigger(s, input, 'down') ? 1 : 0) - (trigger(s, input, 'up') ? 1 : 0);
  if (dx || dy) moveCursor(s, dx, dy, emit);
  const p = input.pointer;
  if (p?.clicked) {
    const lay = layoutOf(s.board);
    const c = Math.floor((p.x - lay.x) / lay.tile);
    const r = Math.floor((p.y - lay.y) / lay.tile);
    if (c >= 0 && r >= 0 && c < s.board.cols && r < s.board.rows) {
      const same = c === s.cursor.c && r === s.cursor.r;
      s.cursor = { c, r };
      if (same) turnTile(s, emit);
      else emit('move');
    }
  }
  if (trigger(s, input, 'turn')) turnTile(s, emit);
  if (trigger(s, input, 'inspect')) s.inspect = !s.inspect;
  if (trigger(s, input, 'undo')) undoTurn(s, emit);
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > R.maxDt) return false;
  if (s.stage === 'menu') menuInput(s, input, emit);
  else if (s.stage === 'play') playInput(s, input, emit);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, emit);
  return true;
}

function tick(s, emit) {
  s.ticks++;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.stage === 'play' && s.tipLeft > 0) s.tipLeft = Math.max(0, s.tipLeft - STEP);
  if (s.stage === 'powered' && (s.freeze -= STEP) <= 0) {
    emit('win');
    finishBoard(s);
  } else if (s.stage === 'blown' && (s.freeze -= STEP) <= 0) {
    if (s.phase === 'playing') enterBoard(s, s.level);
  }
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        emit(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t('Every board is wired and humming!', '所有电路板都接通了，嗡嗡作响！')
            : env.t('All three fuses blew. Try again!', '三根保险丝都烧断了，再试一次！'),
        });
      }
    },
    draw(ctx) {
      const playing = s.phase === 'playing' && s.stage === 'play';
      drawGame(ctx, s, env, playing ? adviceOfState(s) : null, bannerOf(s));
    },
    getState() {
      return snapshotOf(s);
    },
  };
}

// --- Snapshot ---
// The solver runs once per arrangement of the tiles; moving the cursor only re-picks the target.
function planOfState(s) {
  const key = `${s.level}:${s.rots.join('')}`;
  if (s.planKey !== key) {
    s.plan = solve(s.board, s.rots);
    s.planKey = key;
  }
  return s.plan;
}

function adviceOfState(s) {
  const key = `${s.level}:${s.rots.join('')}:${s.cursor.c},${s.cursor.r}:${s.moves}`;
  if (s.adviceKey !== key) {
    const left = s.board.budget === null ? null : s.board.budget - s.moves;
    s.advice = adviceFor(s.board, s.rots, s.cursor, left, s.undo.length > 0, planOfState(s));
    s.adviceKey = key;
  }
  return s.advice;
}

export function bannerOf(s) {
  const an = s.an;
  if (s.phase === 'won')
    return { en: `All boards wired! Score ${s.score}`, zh: `全部电路板完成！得分 ${s.score}` };
  if (s.phase === 'lost')
    return { en: `Out of fuses. Score ${s.score}`, zh: `保险丝用完。得分 ${s.score}` };
  if (s.stage === 'menu') return { en: 'Pick a board', zh: '选择电路板' };
  if (s.stage === 'blown')
    return { en: 'Fuse blown: out of turns', zh: '保险丝烧断：转动次数用完' };
  if (s.stage === 'powered') return { en: 'Every lamp is lit!', zh: '所有灯都亮了！' };
  if (an.shorts.length) {
    const v = an.shorts[0].volts.map((x) => `${x} V`).join(' + ');
    return { en: `SHORT! ${v} touch`, zh: `短路！${v} 相碰` };
  }
  if (s.board.sealed && an.leaks.length)
    return { en: `Open ends: ${an.leaks.length}`, zh: `断头：${an.leaks.length}` };
  return {
    en: `Lamps lit ${an.sinksOk}/${an.sinks.length}`,
    zh: `已亮的灯 ${an.sinksOk}/${an.sinks.length}`,
  };
}

export function snapshotOf(s) {
  const b = s.board;
  const an = s.an;
  const finished = s.phase !== 'playing';
  const i = s.cursor.r * b.cols + s.cursor.c;
  const out = {
    phase: s.phase,
    stage: s.stage,
    score: s.score,
    time: s.ticks * STEP,
    level: s.level + 1,
    levels: BOARD_COUNT,
    boardName: { ...b.name },
    tip: { ...b.tip },
    tipShown: s.stage === 'play' && s.tipLeft > 0 && s.moves === 0,
    sealed: b.sealed,
    moves: s.moves,
    budget: b.budget,
    left: b.budget === null ? null : Math.max(0, b.budget - s.moves),
    fuses: clamp(s.fuses, 0, R.fuses),
    cursor: { ...s.cursor },
    cols: b.cols,
    rows: b.rows,
    tiles: b.cells.map((cell, k) => ({
      type: cell.type,
      rot: s.rots[k],
      locked: Boolean(cell.locked),
      mask: an.mask[k],
      volt: cell.volt ?? null,
    })),
    lamps: an.sinks.map((x) => ({ c: x.c, r: x.r, volt: x.volt, status: x.status })),
    lit: an.sinksOk,
    short: an.shorts.length > 0,
    shorts: an.shorts.map((x) => ({ volts: [...x.volts] })),
    leaks: an.leaks.map((x) => ({ c: x.c, r: x.r, dir: DIRS[x.dir] })),
    solved: an.solved,
    inspect: s.inspect
      ? networkAt(b, an, i).map((n) => ({
          kind: n.kind,
          volts: [...n.volts],
          tiles: n.tiles.map((t) => ({ c: t % b.cols, r: (t / b.cols) | 0 })),
        }))
      : null,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
  };
  // The prompt asks the solver, so it is only worked out when someone reads it.
  const lazy = (pick) => ({ enumerable: true, get: () => pick(adviceOfState(s)) });
  const idle = { en: '', zh: '', id: 'idle' };
  const playing = !finished && s.stage === 'play';
  Object.defineProperties(out, {
    line: {
      enumerable: true,
      get: () =>
        playing ? lazy((a) => ({ en: a.en, zh: a.zh })).get() : { en: idle.en, zh: idle.zh },
    },
    prompt: {
      enumerable: true,
      get: () => (playing ? lazy((a) => ({ en: a.en, zh: a.zh, id: a.id })).get() : { ...idle }),
    },
    hint: {
      enumerable: true,
      get: () => (playing ? lazy((a) => (a.hint ? { ...a.hint } : null)).get() : null),
    },
    // While playing, the status line carries the banner, the tip (until the first turn) and the
    // prompt last, so a screen reader that only sees the status still hears the hint.
    status: {
      enumerable: true,
      get: () => {
        const banner = bannerOf(s);
        if (!playing) return banner;
        const advice = adviceOfState(s);
        const part = (lang) =>
          [banner[lang], out.tipShown ? b.tip[lang] : null, advice[lang]]
            .filter(Boolean)
            .join(' · ');
        return { en: part('en'), zh: part('zh') };
      },
    },
    optimal: { enumerable: true, get: () => planOfState(s)?.cost ?? null },
  });
  return out;
}
