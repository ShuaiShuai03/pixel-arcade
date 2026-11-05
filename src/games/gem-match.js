import { background, drawPixelText, clamp } from '../shared/utils.js';

export const meta = {
  id: 'gem-match',
  name: { en: 'Gem Match', zh: '宝石花园' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Restore three conservatory gardens: bloom matches, gather leaf and sun specimens, then uncover soil beds. Swap adjacent gems to match three. Illegal swaps cost nothing. H hints; X remixes a board with no legal move for free.',
    zh: '修复三座温室花园：连线开花、收集叶与太阳标本、清理土壤。交换相邻宝石连成三个，无效交换不扣步数。H提示；无可行交换时X免费重排。',
  },
  keys: [
    { label: { en: 'Move cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    {
      label: { en: 'Select / swap / next garden', zh: '选择 / 交换 / 下一花园' },
      keys: 'Space / Enter',
    },
    { label: { en: 'Select gems', zh: '选择宝石' }, keys: 'Tap' },
    { label: { en: 'Hint', zh: '提示' }, keys: 'H' },
    { label: { en: 'Remix when no moves', zh: '无可行交换时重排' }, keys: 'X' },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '向右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '向上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '向下' } },
    { code: 'Space', label: { en: 'Select / Next', zh: '选择 / 下一关' } },
    { code: 'KeyH', label: { en: 'Hint', zh: '提示' } },
    { code: 'KeyX', label: { en: 'Remix', zh: '重排' } },
  ],
};
const SIZE = 7,
  CELL = 34,
  X = 122,
  Y = 48,
  GRAVITY = 680,
  EPS = 1e-9;
const COLORS = ['#d96b75', '#64b99c', '#e2bc61', '#79a6cc', '#ae8fc5', '#d58d60'];
const NAMES = [
  ['Bloom Atrium', '繁花中庭'],
  ['Specimen House', '标本温室'],
  ['Root Terrace', '根系梯田'],
];
const BUDGETS = [20, 28, 32];
const center = (x, y) => ({ x: X + x * CELL + CELL / 2, y: Y + y * CELL + CELL / 2 });
const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
const validCell = (board, p) =>
  p &&
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  p.y >= 0 &&
  p.y < board.length &&
  p.x >= 0 &&
  p.x < board[0].length;
export function findMatches(board) {
  const found = new Set(),
    h = board.length,
    w = board[0]?.length || 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const value = board[y][x];
      if (value < 0) continue;
      if (x + 2 < w && board[y][x + 1] === value && board[y][x + 2] === value)
        for (let c = x; c < w && board[y][c] === value; c++) found.add(`${y},${c}`);
      if (y + 2 < h && board[y + 1][x] === value && board[y + 2][x] === value)
        for (let r = y; r < h && board[r][x] === value; r++) found.add(`${r},${x}`);
    }
  return [...found];
}
export function applySwap(board, a, b) {
  if (
    !validCell(board, a) ||
    !validCell(board, b) ||
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 ||
    board[a.y][a.x] < 0 ||
    board[b.y][b.x] < 0
  )
    return null;
  const out = board.map((r) => r.slice());
  [out[a.y][a.x], out[b.y][b.x]] = [out[b.y][b.x], out[a.y][a.x]];
  const matches = findMatches(out);
  return matches.includes(`${a.y},${a.x}`) || matches.includes(`${b.y},${b.x}`) ? out : null;
}
export function legalSwaps(board) {
  const result = [];
  for (let y = 0; y < board.length; y++)
    for (let x = 0; x < board[0].length; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const a = { x, y },
          b = { x: x + dx, y: y + dy };
        if (applySwap(board, a, b)) result.push({ a, b });
      }
  return result;
}
function chooseColor(board, x, y, random) {
  const start = Math.min(5, Math.max(0, Math.floor(random() * 6)));
  for (let n = 0; n < 6; n++) {
    const value = (start + n) % 6;
    board[y][x] = value;
    if (!findMatches(board).includes(`${y},${x}`)) return value;
  }
  throw new Error('No match-free refill color');
}
export function makeBoard(random, size = SIZE) {
  if (!Number.isInteger(size) || size < 3)
    throw new RangeError('Board needs at least three cells per side');
  for (let attempt = 0; attempt < 24; attempt++) {
    const board = Array.from({ length: size }, () => Array(size).fill(-1));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) chooseColor(board, x, y, random);
    if (legalSwaps(board).length) return board;
  }
  const board = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => (x + 2 * y) % 6),
  );
  board[0][0] = 0;
  board[0][1] = 1;
  board[0][2] = 0;
  board[1][1] = 0;
  return board;
}
export function createGemState(env, stage = 1) {
  stage = clamp(Math.floor(stage), 1, 3);
  return {
    phase: 'playing',
    mode: 'ready',
    time: 0,
    stage,
    score: 0,
    stageBaseScore: 0,
    moves: BUDGETS[stage - 1],
    board: makeBoard(env.random),
    cursor: { x: 0, y: 0 },
    selected: null,
    swap: null,
    pending: [],
    clearTime: 0,
    fall: null,
    mixer: null,
    combo: 0,
    collected: Array(6).fill(0),
    soil: Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => stage === 3 && y >= 2 && y <= 4 && x >= 1 && x <= 4),
    ),
    hint: null,
    hintTime: 0,
    feedback: 'welcome',
    feedbackTime: 3,
    sparkles: [],
    totalCleared: 0,
    mixes: 0,
  };
}
export function gemObjective(s) {
  if (s.stage === 1) return { kind: 'score', target: 600, progress: s.score - s.stageBaseScore };
  if (s.stage === 2)
    return {
      kind: 'collect',
      target: 16,
      progress: Math.min(8, s.collected[1]) + Math.min(8, s.collected[2]),
      leaf: s.collected[1],
      sun: s.collected[2],
    };
  return { kind: 'soil', target: 12, progress: 12 - s.soil.flat().filter(Boolean).length };
}
function end(s, env, won) {
  if (s.phase !== 'playing') return;
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
      ? env.t('Three gardens restored!', '三座花园恢复了光彩！')
      : env.t(
          'Out of moves. Restore the garden with a new plan.',
          '步数用完了，重新规划修复花园。',
        ),
  });
}
function stable(s, env) {
  s.combo = 0;
  const goal = gemObjective(s);
  if (goal.progress >= goal.target) {
    if (s.stage === 3) end(s, env, true);
    else {
      s.mode = 'garden-clear';
      s.selected = null;
      s.hint = null;
      s.feedback = 'garden-clear';
      env.sound('win');
    }
  } else if (s.moves <= 0) end(s, env, false);
  else {
    s.mode = 'ready';
    if (!legalSwaps(s.board).length) {
      s.feedback = 'dead';
      s.feedbackTime = 0;
      s.hint = null;
    }
  }
}
function settle(s, env) {
  const matches = findMatches(s.board);
  if (!matches.length) {
    stable(s, env);
    return;
  }
  s.pending = matches;
  s.combo++;
  s.mode = 'clear';
  s.clearTime = 0.22;
  s.hint = null;
  env.sound('coin');
}
function beginFall(s, env, wholeBoard = null) {
  const target = emptyBoard(),
    particles = [];
  const missing = [];
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
      const color = wholeBoard ? wholeBoard[y][x] : chooseColor(target, x, y, env.random);
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
    s.soil[y][x] = false;
    s.board[y][x] = -1;
    s.sparkles.push({ ...center(x, y), life: 0.35, color });
  }
  s.score += s.pending.length * 20 * Math.min(s.combo, 5);
  s.totalCleared += s.pending.length;
  s.pending = [];
  beginFall(s, env);
}
function feedback(s, kind, env) {
  s.feedback = kind;
  s.feedbackTime = 1.5;
  env.sound(kind === 'invalid' ? 'hit' : 'move');
}
function choose(s, x, y, env) {
  if (s.mode !== 'ready' || !validCell(s.board, { x, y })) return;
  s.cursor = { x, y };
  s.hint = null;
  if (s.selected && s.selected.x === x && s.selected.y === y) {
    s.selected = null;
    feedback(s, 'cancel', env);
    return;
  }
  if (!s.selected) {
    s.selected = { x, y };
    feedback(s, 'selected', env);
    return;
  }
  const a = { ...s.selected },
    b = { x, y };
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) {
    s.selected = b;
    feedback(s, 'selected', env);
    return;
  }
  const swapped = applySwap(s.board, a, b);
  s.swap = { a, b, time: 0, duration: 0.48, valid: !!swapped, target: swapped, returning: false };
  s.mode = 'swap';
  s.hint = null;
  env.sound('move');
}
function handleInput(s, input, env) {
  if (s.mode === 'garden-clear') {
    if (input.pressed('Space', 'Enter')) {
      const score = s.score,
        time = s.time,
        mixes = s.mixes,
        totalCleared = s.totalCleared,
        stage = s.stage + 1;
      Object.assign(s, createGemState(env, stage), {
        score,
        stageBaseScore: score,
        time,
        mixes,
        totalCleared,
      });
    }
    return;
  }
  if (s.mode !== 'ready') return;
  if (input.pressed('KeyX')) {
    if (!legalSwaps(s.board).length) {
      s.mode = 'mix-lift';
      s.mixes++;
      s.selected = null;
      s.hint = null;
      s.mixer = { time: 0, duration: 0.6 };
      feedback(s, 'mix', env);
    } else feedback(s, 'productive', env);
    return;
  }
  if (input.pressed('KeyH')) {
    const choices = legalSwaps(s.board);
    s.hint = choices[0] || null;
    s.hintTime = 3;
    feedback(s, choices.length ? 'hint' : 'dead', env);
    return;
  }
  const dx =
    Number(input.pressed('ArrowRight', 'KeyD')) - Number(input.pressed('ArrowLeft', 'KeyA'));
  const dy = Number(input.pressed('ArrowDown', 'KeyS')) - Number(input.pressed('ArrowUp', 'KeyW'));
  if (dx && !dy) s.cursor.x = (s.cursor.x + dx + SIZE) % SIZE;
  if (dy && !dx) s.cursor.y = (s.cursor.y + dy + SIZE) % SIZE;
  if (input.pointer.clicked) {
    const x = Math.floor((input.pointer.x - X) / CELL),
      y = Math.floor((input.pointer.y - Y) / CELL);
    if (validCell(s.board, { x, y })) choose(s, x, y, env);
  } else if (input.pressed('Space', 'Enter')) choose(s, s.cursor.x, s.cursor.y, env);
}
function advance(s, time) {
  s.time += time;
  s.feedbackTime = Math.max(0, s.feedbackTime - time);
  s.hintTime = Math.max(0, s.hintTime - time);
  if (!s.hintTime) s.hint = null;
  for (const p of s.sparkles) p.life -= time;
  s.sparkles = s.sparkles.filter((p) => p.life > 0).slice(-98);
}
export function stepGem(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  handleInput(s, input, env);
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    if (s.mode === 'swap') {
      const sw = s.swap,
        time = Math.min(remaining, sw.duration - sw.time);
      advance(s, time);
      sw.time += time;
      remaining -= time;
      if (sw.time >= sw.duration - EPS) {
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
      }
    } else if (s.mode === 'clear') {
      const time = Math.min(remaining, s.clearTime);
      advance(s, time);
      s.clearTime -= time;
      remaining -= time;
      if (s.clearTime <= EPS) {
        s.clearTime = 0;
        removeMatches(s, env);
      }
    } else if (s.mode === 'fall') {
      const f = s.fall,
        time = Math.min(remaining, f.duration - f.time);
      advance(s, time);
      f.time += time;
      remaining -= time;
      for (const p of f.particles) {
        p.y = Math.min(p.target, p.start + (GRAVITY * f.time * f.time) / 2);
        p.vy = p.y >= p.target - EPS ? 0 : GRAVITY * f.time;
      }
      if (f.time >= f.duration - EPS) {
        s.board = f.target;
        s.fall = null;
        settle(s, env);
      }
    } else if (s.mode === 'mix-lift') {
      const m = s.mixer,
        time = Math.min(remaining, m.duration - m.time);
      advance(s, time);
      m.time += time;
      remaining -= time;
      if (m.time >= m.duration - EPS) {
        const fresh = makeBoard(env.random);
        s.mixer = null;
        s.board = emptyBoard();
        beginFall(s, env, fresh);
      }
    } else {
      advance(s, remaining);
      remaining = 0;
    }
  }
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
export function gemSwapPose(sw) {
  const t = clamp(sw.time / sw.duration, 0, 1),
    travel = smooth(clamp((t - 0.25) / 0.5, 0, 1)),
    v = sw.returning ? 1 - travel : travel,
    lift = 24 * Math.min(smooth(clamp(t / 0.25, 0, 1)), smooth(clamp((1 - t) / 0.25, 0, 1))),
    a = center(sw.a.x, sw.a.y),
    b = center(sw.b.x, sw.b.y);
  return {
    a: { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v, z: lift },
    b: { x: b.x + (a.x - b.x) * v, y: b.y + (a.y - b.y) * v, z: -lift },
  };
}
function gem(ctx, type, x, y, z = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (z) {
    ctx.fillStyle = '#07191dcc';
    ctx.fillRect(Math.round(x - 12), Math.round(y + 4), 24, 9);
    ctx.strokeStyle = '#c4bd7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - z * 0.5);
    ctx.stroke();
    y -= z * 0.5;
  }
  const lift = 0;
  ctx.fillStyle = '#071d22';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 15), 32, 32);
  ctx.fillStyle = '#47665c';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 16), 32, 30);
  ctx.fillStyle = '#769481';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 17), 32, 3);
  ctx.fillStyle = '#bfd2aa';
  ctx.fillRect(Math.round(x - 13), Math.round(y + 14), 7, 3);
  ctx.fillRect(Math.round(x + 6), Math.round(y + 14), 7, 3);
  if (z) {
    ctx.fillStyle = '#07191dcc';
    ctx.fillRect(Math.round(x - 10), Math.round(y + 5), 20, 7);
  }
  const rows = [
    [
      '...##...',
      '..####..',
      '.######.',
      '########',
      '########',
      '.######.',
      '..####..',
      '...##...',
    ],
    [
      '.....##.',
      '...####.',
      '..#####.',
      '.######.',
      '.#####..',
      '.####...',
      '..##....',
      '..#.....',
    ],
    [
      '..####..',
      '.######.',
      '########',
      '########',
      '########',
      '########',
      '.######.',
      '..####..',
    ],
    [
      '...##...',
      '..####..',
      '.######.',
      '########',
      '########',
      '.######.',
      '..####..',
      '...##...',
    ],
    [
      '##....##',
      '###..###',
      '.######.',
      '..####..',
      '..####..',
      '.######.',
      '###..###',
      '##....##',
    ],
    [
      '..####..',
      '.######.',
      '########',
      '###..###',
      '###..###',
      '########',
      '.######.',
      '..####..',
    ],
  ][type];
  const top = Math.round(y - 12 - lift),
    left = Math.round(x - 12);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (rows[r][c] === '#') {
        ctx.fillStyle = r + c < 5 ? '#f3e4bd' : r + c > 10 ? '#243e43' : COLORS[type];
        ctx.fillRect(left + c * 3, top + r * 3, 3, 3);
      }
  ctx.fillStyle = '#f6e7bf';
  if (type === 0) {
    ctx.fillRect(x - 1, y - 6 - lift, 2, 12);
    ctx.fillRect(x - 6, y - 1 - lift, 12, 2);
  }
  if (type === 1) {
    ctx.fillStyle = '#194d43';
    ctx.fillRect(x - 1, y - 5 - lift, 2, 11);
    ctx.fillRect(x - 4, y + 1 - lift, 3, 2);
  }
  if (type === 2) {
    ctx.fillStyle = '#765c32';
    ctx.fillRect(x - 3, y - 3 - lift, 6, 6);
  }
  if (type === 3) {
    ctx.fillStyle = '#2c4f76';
    ctx.fillRect(x - 2, y - 5 - lift, 4, 10);
    ctx.fillRect(x - 5, y - 2 - lift, 10, 4);
  }
  if (type === 4) {
    ctx.fillRect(x - 2, y - 2 - lift, 4, 4);
  }
  ctx.globalAlpha = 1;
}
function instruction(s, env) {
  if (s.mode === 'garden-clear')
    return env.t('GARDEN RESTORED · SPACE / NEXT', '花园已修复 · 空格 / 下一关');
  if (s.mode === 'mix-lift')
    return env.t('LIFTING TO MIXER · NO MOVE COST', '升起重排 · 不消耗步数');
  if (s.mode === 'fall')
    return env.t('Gravity rails · wait for every gem to settle', '重力轨道 · 等待宝石全部落稳');
  if (s.mode === 'clear')
    return s.combo > 1
      ? env.t(`CASCADE ×${s.combo}`, `连锁 ×${s.combo}`)
      : env.t('Match found · clearing together', '连线成功 · 同时消除');
  if (s.mode === 'swap')
    return env.t('Powered lift lanes · swap in progress', '升降轨道 · 正在交换');
  if (s.phase === 'won') return env.t('THREE GARDENS RESTORED', '三座花园修复完成');
  if (s.phase === 'lost') return env.t('OUT OF MOVES · RESTART TO REPLANT', '步数用完 · 重新种植');
  if (!legalSwaps(s.board).length)
    return env.t('NO LEGAL SWAP · X / REMIX IS FREE', '没有可行交换 · X / 重排免费');
  if (s.feedbackTime > 0 && s.feedback === 'invalid')
    return env.t('No match · both gems returned · no move cost', '没有连线 · 宝石归位 · 不扣步数');
  if (s.feedbackTime > 0 && s.feedback === 'productive')
    return env.t('A legal swap is available · H shows one', '仍有可行交换 · H显示提示');
  return s.selected
    ? env.t('Choose an adjacent gem · same gem cancels', '选择相邻宝石 · 再选同一颗取消')
    : env.t('Select a gem, then its neighbor · H for hint', '选择宝石，再选相邻宝石 · H提示');
}
function drawGame(ctx, s, env) {
  ctx.save();
  background(ctx, ['#172d30', '#1c3030', '#26332c'][s.stage - 1]);
  ctx.fillStyle = '#0f2429';
  ctx.fillRect(0, 0, 480, 34);
  for (let x = 0; x < 480; x += 48) {
    ctx.fillStyle = '#38514b';
    ctx.fillRect(x + 3, 0, 2, 320);
    ctx.fillRect(x, 21, 48, 2);
    ctx.fillStyle = '#8c7650';
    ctx.fillRect(x + 2, 25, 4, 6);
  }
  for (let i = 0; i < 12; i++) {
    const px = (i * 67) % 480,
      py = 175 + ((i * 29) % 115);
    ctx.fillStyle = s.stage === 3 ? '#67533c' : '#3b6550';
    ctx.fillRect(px, py, 18, 44);
    ctx.fillStyle = '#192f2c';
    ctx.fillRect(px - 3, py + 38, 24, 8);
    ctx.fillStyle = s.stage === 1 ? '#bf7d83' : s.stage === 2 ? '#7caa89' : '#93a776';
    ctx.fillRect(px - 6, py - 4, 30, 7);
    ctx.fillStyle = '#719b76';
    ctx.fillRect(px + 6, py - 14, 3, 14);
  }
  drawPixelText(ctx, env.t(...NAMES[s.stage - 1]).toUpperCase(), 240, 10, '#ead6a7', 13, 'center');
  ctx.fillStyle = '#10262a';
  ctx.fillRect(8, 42, 102, 244);
  ctx.fillRect(370, 42, 102, 244);
  drawPixelText(ctx, env.t('GARDEN', '花园'), 18, 53, '#91b5a1', 10);
  drawPixelText(ctx, `${s.stage} / 3`, 18, 69, '#f3d89a', 19);
  drawPixelText(ctx, env.t('MOVES', '剩余步数'), 18, 107, '#91b5a1', 10);
  drawPixelText(ctx, String(s.moves), 18, 123, s.moves <= 4 ? '#ed997d' : '#efdeb4', 28);
  drawPixelText(ctx, env.t('SCORE', '总分'), 18, 167, '#91b5a1', 10);
  drawPixelText(ctx, String(s.score), 18, 183, '#c9d2b1', 16);
  drawPixelText(ctx, env.t('H  HINT', 'H  提示'), 18, 224, '#8eafa1', 10);
  drawPixelText(ctx, env.t('X  MIXER', 'X  重排'), 18, 242, '#8eafa1', 10);
  drawPixelText(ctx, env.t('GOAL', '目标'), 380, 53, '#91b5a1', 10);
  const goal = gemObjective(s);
  if (s.stage === 1) {
    drawPixelText(ctx, env.t('BLOOM', '繁花积分'), 380, 73, '#f3d89a', 12);
    drawPixelText(ctx, `${Math.min(600, goal.progress)}`, 380, 99, '#efdeb4', 23);
    drawPixelText(ctx, '/ 600', 380, 124, '#9eb4a1', 13);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < Math.floor(goal.progress / 120) ? '#d38c92' : '#3a5049';
      ctx.fillRect(382 + i * 16, 153, 10, 13);
    }
    drawPixelText(ctx, env.t('MATCH 3+', '连成三个'), 380, 201, '#c4d0b0', 10);
    drawPixelText(ctx, env.t('TO BLOOM', '让花盛开'), 380, 218, '#c4d0b0', 10);
  } else if (s.stage === 2) {
    drawPixelText(ctx, env.t('SPECIMENS', '收集标本'), 380, 73, '#f3d89a', 11);
    for (const [index, color] of [
      [0, 1],
      [1, 2],
    ]) {
      const yy = 109 + index * 67;
      gem(ctx, color, 396, yy, 0, 1);
      drawPixelText(ctx, `${Math.min(8, s.collected[color])}/8`, 419, yy - 6, '#efdeb4', 13);
      ctx.fillStyle = '#819d83';
      ctx.fillRect(381, yy + 22, 78, 3);
      ctx.fillStyle = COLORS[color];
      ctx.fillRect(381, yy + 22, 78 * Math.min(1, s.collected[color] / 8), 3);
    }
    drawPixelText(ctx, env.t('BOTH TYPES', '两类都收集'), 380, 233, '#c4d0b0', 10);
  } else {
    drawPixelText(ctx, env.t('SOIL BEDS', '清理土壤'), 380, 73, '#f3d89a', 11);
    drawPixelText(ctx, `${goal.progress}/12`, 380, 101, '#efdeb4', 22);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++) {
        const remaining = s.soil[row + 2][col + 1],
          px = 381 + col * 19,
          py = 146 + row * 19;
        ctx.fillStyle = remaining ? '#805c3f' : '#80aa85';
        ctx.fillRect(px, py, 14, 14);
        ctx.fillStyle = remaining ? '#e7b76f' : '#173b34';
        if (remaining) {
          ctx.fillRect(px + 3, py + 3, 2, 5);
          ctx.fillRect(px + 6, py + 6, 2, 5);
          ctx.fillRect(px + 9, py + 3, 2, 5);
        } else {
          ctx.fillRect(px + 3, py + 6, 2, 3);
          ctx.fillRect(px + 5, py + 8, 2, 3);
          ctx.fillRect(px + 7, py + 6, 2, 3);
          ctx.fillRect(px + 9, py + 3, 2, 4);
        }
      }
    drawPixelText(ctx, env.t('MATCH OVER', '在土块上方'), 380, 218, '#c4d0b0', 10);
    drawPixelText(ctx, env.t('MARKED SOIL', '连线消除'), 380, 235, '#c4d0b0', 10);
  }
  ctx.fillStyle = '#091e23';
  ctx.fillRect(X - 5, Y - 5, SIZE * CELL + 10, SIZE * CELL + 10);
  ctx.fillStyle = '#a18e62';
  ctx.fillRect(X - 3, Y - 3, SIZE * CELL + 6, 2);
  ctx.fillRect(X - 3, Y + SIZE * CELL + 1, SIZE * CELL + 6, 3);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const p = center(x, y);
      ctx.fillStyle = s.soil[y][x] ? '#79583d' : (x + y) % 2 ? '#1d3a39' : '#233f3d';
      ctx.fillRect(p.x - 17, p.y - 17, 33, 33);
      if (s.soil[y][x]) {
        ctx.fillStyle = '#cb9760';
        ctx.fillRect(p.x - 14, p.y - 13, 5, 2);
        ctx.fillRect(p.x + 8, p.y + 11, 5, 2);
        ctx.fillStyle = '#b18351';
        ctx.fillRect(p.x - 16, p.y - 16, 32, 2);
      }
    }
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, SIZE * CELL, SIZE * CELL);
  ctx.clip();
  if (s.fall) for (const p of s.fall.particles) gem(ctx, p.color, center(p.col, 0).x, p.y);
  else {
    const lift = s.mixer ? smooth(s.mixer.time / s.mixer.duration) * (SIZE + 1) * CELL : 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (s.board[y][x] < 0) continue;
        if (s.swap && [s.swap.a, s.swap.b].some((p) => p.x === x && p.y === y)) continue;
        const p = center(x, y),
          flash = s.pending.includes(`${y},${x}`) ? 0.5 + 0.45 * Math.sin(s.clearTime * 38) : 1;
        gem(ctx, s.board[y][x], p.x, p.y - lift, 0, flash);
      }
    if (s.swap) {
      const sw = s.swap,
        pose = gemSwapPose(sw),
        a = center(sw.a.x, sw.a.y),
        b = center(sw.b.x, sw.b.y);
      ctx.strokeStyle = '#b9bd7e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      gem(ctx, s.board[sw.b.y][sw.b.x], pose.b.x, pose.b.y, pose.b.z);
      gem(ctx, s.board[sw.a.y][sw.a.x], pose.a.x, pose.a.y, pose.a.z);
    }
  }
  ctx.restore();
  if (s.stage === 3)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (s.soil[y][x]) {
          const px = X + x * CELL,
            py = Y + y * CELL;
          ctx.fillStyle = '#4b3028';
          for (const [dx, dy] of [
            [0, 0],
            [25, 0],
            [0, 25],
            [25, 25],
          ])
            ctx.fillRect(px + dx, py + dy, 9, 9);
          ctx.fillStyle = '#e7b76f';
          for (const [dx, dy] of [
            [1, 1],
            [26, 1],
            [1, 26],
            [26, 26],
          ]) {
            ctx.fillRect(px + dx, py + dy, 7, 2);
            ctx.fillRect(px + dx, py + dy, 2, 7);
          }
        }
  for (const p of s.sparkles) {
    ctx.fillStyle = COLORS[p.color];
    const d = (0.35 - p.life) * 35;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      ctx.fillRect(p.x + dx * d, p.y + dy * d, 3, 3);
  }
  const ring = (p, color, width, inset = 2) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(
      X + p.x * CELL + inset,
      Y + p.y * CELL + inset,
      CELL - 2 * inset,
      CELL - 2 * inset,
    );
  };
  if (s.mode === 'ready') {
    ring(s.cursor, '#f2d78f', 2);
    if (s.selected) ring(s.selected, '#ffffff', 3, 5);
    if (s.hint) {
      ring(s.hint.a, '#8be5bb', 3, 3);
      ring(s.hint.b, '#8be5bb', 3, 3);
    }
  }
  ctx.fillStyle = '#10262a';
  ctx.fillRect(0, 294, 480, 26);
  drawPixelText(ctx, instruction(s, env), 240, 303, '#d5d8b5', 10, 'center');
  ctx.restore();
}
export function createGame(env) {
  const s = createGemState(env);
  return {
    update: (dt, input) => stepGem(s, dt, input, env),
    draw: (ctx) => drawGame(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      goal: gemObjective(s).target,
      objective: gemObjective(s),
      resolving: !['ready', 'garden-clear', 'terminal'].includes(s.mode),
      status: {
        en: `${NAMES[s.stage - 1][0]} ${s.stage}/3 · ${s.moves} moves · ${instruction(s, { t: (en) => en })}`,
        zh: `${NAMES[s.stage - 1][1]} ${s.stage}/3 · ${s.moves} 步 · ${instruction(s, { t: (_, zh) => zh })}`,
      },
    }),
  };
}
