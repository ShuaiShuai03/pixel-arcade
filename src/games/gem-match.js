import { background, drawPixelText, clamp } from '../shared/utils.js';

export const meta = {
  id: 'gem-match',
  name: { en: 'Gem Match', zh: '宝石花园' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  touchControls: [],
  description: {
    en: 'Swap neighboring gems to match three. Reach the target in each of three gardens before your moves run out.',
    zh: '交换相邻宝石，连成三个消除。在步数耗尽前达成三座花园的目标分数。',
  },
  keys: [
    { label: { en: 'Choose gem', zh: '选择宝石' }, keys: 'Arrows / WASD / Tap' },
    { label: { en: 'Select / swap', zh: '选中 / 交换' }, keys: 'Space / Enter' },
  ],
};
const SIZE = 7,
  CELL = 34,
  X = 122,
  Y = 48;
const COLORS = ['#ee7a81', '#6bd8c6', '#f5ca65', '#7caef5', '#c89ae9', '#f3a66a'];
export function findMatches(board) {
  const found = new Set(),
    h = board.length,
    w = board[0].length;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = board[y][x];
      if (v < 0) continue;
      if (x + 2 < w && board[y][x + 1] === v && board[y][x + 2] === v) {
        let end = x;
        while (end < w && board[y][end] === v) found.add(`${y},${end++}`);
      }
      if (y + 2 < h && board[y + 1][x] === v && board[y + 2][x] === v) {
        let end = y;
        while (end < h && board[end][x] === v) found.add(`${end++},${x}`);
      }
    }
  return [...found];
}
export function applySwap(board, a, b) {
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return null;
  const out = board.map((r) => r.slice());
  if (!out[a.y] || !out[b.y] || a.x < 0 || b.x < 0 || a.x >= out[0].length || b.x >= out[0].length)
    return null;
  [out[a.y][a.x], out[b.y][b.x]] = [out[b.y][b.x], out[a.y][a.x]];
  const matches = findMatches(out);
  return matches.includes(`${a.y},${a.x}`) || matches.includes(`${b.y},${b.x}`) ? out : null;
}
export function legalSwaps(board) {
  const swaps = [];
  for (let y = 0; y < board.length; y++)
    for (let x = 0; x < board[0].length; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const a = { x, y },
          b = { x: x + dx, y: y + dy };
        if (b.x < board[0].length && b.y < board.length && applySwap(board, a, b))
          swaps.push({ a, b });
      }
  return swaps;
}
export function makeBoard(random, size = SIZE) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const board = [];
    for (let y = 0; y < size; y++) {
      board[y] = [];
      for (let x = 0; x < size; x++) {
        const options = COLORS.map((_, i) => i).filter(
          (v) =>
            !(x >= 2 && board[y][x - 1] === v && board[y][x - 2] === v) &&
            !(y >= 2 && board[y - 1][x] === v && board[y - 2][x] === v),
        );
        board[y][x] = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
      }
    }
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
export function createGame(env) {
  let board = makeBoard(env.random),
    phase = 'playing',
    score = 0,
    stage = 1,
    moves = 20,
    cursor = { x: 0, y: 0 },
    selected = null,
    pending = [],
    timer = 0,
    combo = 0,
    notice = 0,
    sparkles = [];
  const goals = [1400, 3200, 5400];
  function end(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('Three gardens restored!', '三座花园恢复了光彩！')
        : env.t('Out of moves. Plan a chain reaction!', '步数用完了，试试制造连锁消除！'),
    });
  }
  function settle() {
    const matches = findMatches(board);
    if (matches.length) {
      combo++;
      pending = matches;
      timer = 0.19;
      env.sound('coin');
      return;
    }
    combo = 0;
    if (score >= goals[stage - 1]) {
      if (stage === 3) {
        end(true);
        return;
      }
      stage++;
      moves = 20 + (stage - 1) * 2;
      board = makeBoard(env.random);
      notice = 1.8;
      env.sound('win');
    } else if (moves <= 0) {
      end(false);
      return;
    }
    if (!legalSwaps(board).length) {
      board = makeBoard(env.random);
      notice = 1.8;
    }
  }
  function choose(x, y) {
    if (timer > 0 || phase !== 'playing') return;
    cursor = { x, y };
    if (selected && selected.x === x && selected.y === y) {
      selected = null;
      return;
    }
    if (selected) {
      const swapped = applySwap(board, selected, cursor);
      if (swapped) {
        board = swapped;
        moves--;
        selected = null;
        combo = 0;
        settle();
        return;
      }
      env.sound('hit');
    }
    selected = { x, y };
    env.sound('move');
  }
  function update(dt, input) {
    if (phase !== 'playing') return;
    dt = clamp(dt, 0, 0.05);
    notice = Math.max(0, notice - dt);
    sparkles = sparkles.filter((p) => (p.life -= dt) > 0);
    if (timer > 0) {
      timer -= dt;
      if (timer <= 0) {
        for (const key of pending) {
          const [y, x] = key.split(',').map(Number);
          board[y][x] = -1;
          sparkles.push({ x: X + x * CELL + 17, y: Y + y * CELL + 17, life: 0.4 });
        }
        score += pending.length * 20 * Math.min(combo, 5);
        pending = [];
        for (let x = 0; x < SIZE; x++) {
          const keep = [];
          for (let y = SIZE - 1; y >= 0; y--) if (board[y][x] >= 0) keep.push(board[y][x]);
          for (let y = SIZE - 1; y >= 0; y--)
            board[y][x] = keep[SIZE - 1 - y] ?? Math.floor(env.random() * COLORS.length);
        }
        if (combo >= 12) {
          board = makeBoard(env.random);
          combo = 0;
        }
        settle();
      }
      return;
    }
    if (input.pressed('ArrowLeft', 'KeyA')) cursor.x = (cursor.x + SIZE - 1) % SIZE;
    if (input.pressed('ArrowRight', 'KeyD')) cursor.x = (cursor.x + 1) % SIZE;
    if (input.pressed('ArrowUp', 'KeyW')) cursor.y = (cursor.y + SIZE - 1) % SIZE;
    if (input.pressed('ArrowDown', 'KeyS')) cursor.y = (cursor.y + 1) % SIZE;
    if (input.pressed('Space', 'Enter')) choose(cursor.x, cursor.y);
    if (input.pointer.clicked) {
      const x = Math.floor((input.pointer.x - X) / CELL),
        y = Math.floor((input.pointer.y - Y) / CELL);
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) choose(x, y);
    }
  }
  function gem(ctx, type, x, y, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS[type];
    ctx.beginPath();
    ctx.moveTo(x + 17, y + 5);
    ctx.lineTo(x + 28, y + 14);
    ctx.lineTo(x + 24, y + 26);
    ctx.lineTo(x + 10, y + 26);
    ctx.lineTo(x + 6, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff80';
    ctx.fillRect(x + 13, y + 9, 8, 3);
    ctx.fillStyle = '#00000035';
    ctx.fillRect(x + 11, y + 23, 14, 3);
    ctx.globalAlpha = 1;
  }
  function draw(ctx) {
    ctx.save();
    background(ctx, '#122c29');
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = i % 2 ? '#21433a' : '#193a32';
      ctx.fillRect((i * 31) % 480, 280 - ((i * 37) % 220), 17, 45);
      ctx.fillRect(((i * 31) % 480) - 6, 277 - ((i * 37) % 220), 29, 12);
    }
    ctx.fillStyle = '#0c211f';
    ctx.fillRect(X - 5, Y - 5, SIZE * CELL + 10, SIZE * CELL + 10);
    drawPixelText(ctx, env.t('GARDEN', '花园'), 17, 52, '#9bbfaf', 10);
    drawPixelText(ctx, `${stage} / 3`, 17, 70, '#f3e6b9', 19);
    drawPixelText(ctx, env.t('MOVES', '剩余步数'), 17, 112, '#9bbfaf', 10);
    drawPixelText(ctx, String(moves), 17, 130, '#f3e6b9', 25);
    drawPixelText(ctx, env.t('TARGET', '目标'), 377, 52, '#9bbfaf', 10);
    drawPixelText(ctx, String(goals[stage - 1]), 377, 70, '#f3e6b9', 19);
    drawPixelText(ctx, env.t('SCORE', '分数'), 377, 112, '#9bbfaf', 10);
    drawPixelText(ctx, String(score), 377, 130, '#f3e6b9', 19);
    board.forEach((row, y) =>
      row.forEach((type, x) => {
        ctx.fillStyle = (x + y) % 2 ? '#294a40' : '#244439';
        ctx.fillRect(X + x * CELL, Y + y * CELL, CELL - 1, CELL - 1);
        const flashing = pending.includes(`${y},${x}`);
        gem(
          ctx,
          type,
          X + x * CELL,
          Y + y * CELL,
          flashing ? 0.45 + Math.sin(timer * 40) * 0.3 : 1,
        );
      }),
    );
    ctx.strokeStyle = '#f7e6a5';
    ctx.lineWidth = 2;
    ctx.strokeRect(X + cursor.x * CELL + 2, Y + cursor.y * CELL + 2, CELL - 5, CELL - 5);
    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(X + selected.x * CELL + 4, Y + selected.y * CELL + 4, CELL - 9, CELL - 9);
    }
    for (const p of sparkles) {
      ctx.fillStyle = '#fff0b8';
      const d = (0.4 - p.life) * 45;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        ctx.fillRect(p.x + dx * d, p.y + dy * d, 3, 3);
    }
    drawPixelText(
      ctx,
      combo > 1
        ? env.t(`CHAIN ×${combo}`, `连锁 ×${combo}`)
        : env.t('Select a gem, then its neighbor.', '选择宝石，再选择相邻宝石。'),
      240,
      301,
      '#c7d9b8',
      10,
      'center',
    );
    if (notice > 0) {
      ctx.fillStyle = '#16352c';
      ctx.fillRect(145, 152, 193, 36);
      drawPixelText(
        ctx,
        env.t('A fresh garden awaits', '新花园已经准备好了'),
        241,
        164,
        '#f5d473',
        11,
        'center',
      );
    }
    ctx.restore();
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      stage,
      moves,
      goal: goals[stage - 1],
      board: board.map((r) => r.slice()),
      cursor: { ...cursor },
      selected: selected && { ...selected },
      combo,
      status: {
        en: `Garden ${stage}/3 · ${moves} moves`,
        zh: `花园 ${stage}/3 · 剩余 ${moves} 步`,
      },
    }),
  };
}
