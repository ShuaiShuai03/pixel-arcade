import { background, drawPixelText, clamp } from '../shared/utils.js';

export const meta = {
  id: 'blockfall',
  name: { en: 'Blockfall', zh: '方块降临' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Build complete lines. Clear 30 lines to light the city; the fall gets faster every five.',
    zh: '填满整行消除方块。消除30行点亮城市，每5行加速一次。',
  },
  keys: [
    { label: { en: 'Move / soft drop', zh: '移动 / 软降' }, keys: 'Arrows / WASD' },
    { label: { en: 'Rotate / reverse', zh: '旋转 / 反转' }, keys: 'Up / W / Z' },
    { label: { en: 'Hard drop', zh: '瞬间落下' }, keys: 'Space' },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Rotate', zh: '旋转' } },
    { code: 'ArrowDown', label: { en: 'Soft drop', zh: '软降' } },
    { code: 'Space', label: { en: 'Drop', zh: '落下' } },
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
const COLORS = ['', '#53d9e9', '#f7d466', '#be90ec', '#75d79d', '#f57b88', '#6f9feb', '#efa563'];
const X = 167,
  Y = 28,
  CELL = 14;
export function rotatePiece(matrix, clockwise = true) {
  const n = matrix.length;
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (clockwise ? matrix[n - 1 - x][y] : matrix[x][n - 1 - y])),
  );
}
export function canPlace(board, matrix, px, py) {
  return matrix.every((row, y) =>
    row.every(
      (value, x) =>
        !value ||
        (px + x >= 0 && px + x < 10 && py + y < 20 && (py + y < 0 || !board[py + y][px + x])),
    ),
  );
}
export function clearRows(board) {
  const kept = board.filter((row) => row.some((value) => !value)).map((row) => row.slice());
  const count = board.length - kept.length;
  return { count, board: [...Array.from({ length: count }, () => Array(10).fill(0)), ...kept] };
}
export function createGame(env) {
  let board = Array.from({ length: 20 }, () => Array(10).fill(0));
  let bag = [],
    piece,
    next = take(),
    score = 0,
    lines = 0,
    phase = 'playing',
    fall = 0,
    repeat = 0,
    lastDir = 0,
    flash = 0;
  function take() {
    if (!bag.length) {
      bag = Object.keys(SHAPES);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(env.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }
  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('The whole city is shining!', '整座城市都亮起来了！')
        : env.t('The tower reached the sky. Try a new stack!', '方块堆到了天空，再来一次！'),
    });
  }
  function spawn() {
    piece = {
      name: next,
      matrix: SHAPES[next].map((row) => row.slice()),
      x: Math.floor((10 - SHAPES[next].length) / 2),
      y: 0,
    };
    next = take();
    fall = 0;
    if (!canPlace(board, piece.matrix, piece.x, piece.y)) finish(false);
  }
  function shift(dx) {
    if (canPlace(board, piece.matrix, piece.x + dx, piece.y)) {
      piece.x += dx;
      env.sound('move');
    }
  }
  function rotate(clockwise) {
    const matrix = rotatePiece(piece.matrix, clockwise);
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [-2, 0],
      [2, 0],
      [0, -1],
    ]) {
      if (canPlace(board, matrix, piece.x + dx, piece.y + dy)) {
        piece.matrix = matrix;
        piece.x += dx;
        piece.y += dy;
        env.sound('move');
        return;
      }
    }
  }
  function lock() {
    for (let y = 0; y < piece.matrix.length; y++)
      for (let x = 0; x < piece.matrix[y].length; x++) {
        if (piece.matrix[y][x]) {
          if (piece.y + y < 0) {
            finish(false);
            return;
          }
          board[piece.y + y][piece.x + x] = piece.matrix[y][x];
        }
      }
    const cleared = clearRows(board);
    board = cleared.board;
    if (cleared.count) {
      score += [0, 100, 300, 500, 800][cleared.count] * (1 + Math.floor(lines / 5));
      lines += cleared.count;
      flash = 0.25;
      env.sound('coin');
    } else env.sound('hit');
    if (lines >= 30) finish(true);
    else spawn();
  }
  function drop() {
    if (canPlace(board, piece.matrix, piece.x, piece.y + 1)) {
      piece.y++;
      return true;
    }
    lock();
    return false;
  }
  spawn();
  function update(dt, input) {
    if (phase !== 'playing') return;
    dt = clamp(dt, 0, 0.05);
    flash = Math.max(0, flash - dt);
    let clicked = '';
    if (input.pointer.clicked && input.pointer.x >= 330 && input.pointer.x < 460) {
      const y = input.pointer.y;
      if (y >= 142 && y < 178) clicked = 'rotate';
      if (y >= 188 && y < 224) clicked = input.pointer.x < 393 ? 'left' : 'right';
      if (y >= 234 && y < 274) clicked = 'drop';
    }
    const dir = input.held('ArrowLeft', 'KeyA') ? -1 : input.held('ArrowRight', 'KeyD') ? 1 : 0;
    if (input.pressed('ArrowLeft', 'KeyA') || clicked === 'left') shift(-1);
    if (input.pressed('ArrowRight', 'KeyD') || clicked === 'right') shift(1);
    if (dir !== lastDir) {
      repeat = 0.18;
      lastDir = dir;
    } else if (dir) {
      repeat -= dt;
      if (repeat <= 0) {
        shift(dir);
        repeat = 0.075;
      }
    }
    if (input.pressed('ArrowUp', 'KeyW') || clicked === 'rotate') rotate(true);
    if (input.pressed('KeyZ')) rotate(false);
    if (input.pressed('Space') || clicked === 'drop') {
      while (canPlace(board, piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
        score += 2;
      }
      lock();
      return;
    }
    fall += dt;
    const soft = input.held('ArrowDown', 'KeyS');
    const interval = soft ? 0.045 : Math.max(0.1, 0.65 - Math.floor(lines / 5) * 0.085);
    if (fall >= interval) {
      fall = 0;
      if (drop() && soft) score++;
    }
  }
  function block(ctx, value, x, y, size = CELL) {
    ctx.fillStyle = COLORS[value];
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = '#ffffff75';
    ctx.fillRect(x + 2, y + 2, size - 4, 2);
    ctx.fillStyle = '#00000030';
    ctx.fillRect(x + size - 3, y + 3, 2, size - 4);
  }
  function draw(ctx) {
    ctx.save();
    background(ctx, '#0b1628');
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#172e42' : '#12253b';
      ctx.fillRect(i * 32, 245 - ((i * 29) % 100), 25, 90 + ((i * 29) % 100));
      for (let j = 0; j < 5; j++) {
        ctx.fillStyle = j < Math.ceil(lines / 6) ? '#f9d779' : '#294558';
        ctx.fillRect(i * 32 + 5, 255 - ((i * 29) % 100) + j * 15, 4, 5);
      }
    }
    drawPixelText(ctx, env.t('CITY POWER', '城市电力'), 18, 32, '#7fa1b8', 11);
    drawPixelText(
      ctx,
      String(Math.min(100, Math.floor((lines / 30) * 100))) + '%',
      18,
      52,
      '#f7d466',
      28,
    );
    drawPixelText(ctx, env.t('LINES', '行数'), 18, 103, '#7fa1b8', 10);
    drawPixelText(ctx, `${lines} / 30`, 18, 120, '#f4f7ed', 17);
    drawPixelText(ctx, env.t('LEVEL', '等级'), 18, 159, '#7fa1b8', 10);
    drawPixelText(ctx, String(1 + Math.floor(lines / 5)), 18, 177, '#f4f7ed', 20);
    drawPixelText(ctx, env.t('Keep it level.', '保持平整。'), 18, 216, '#7fa1b8', 10);
    ctx.fillStyle = '#284657';
    ctx.fillRect(X - 4, Y - 4, 148, 288);
    ctx.fillStyle = flash ? '#304e62' : '#0c1c2a';
    ctx.fillRect(X, Y, 140, 280);
    ctx.strokeStyle = '#1c3040';
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
    board.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v) block(ctx, v, X + x * CELL, Y + y * CELL);
      }),
    );
    let ghost = piece.y;
    while (canPlace(board, piece.matrix, piece.x, ghost + 1)) ghost++;
    piece.matrix.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v && ghost + y >= 0) {
          ctx.strokeStyle = COLORS[v];
          ctx.strokeRect(
            X + (piece.x + x) * CELL + 2,
            Y + (ghost + y) * CELL + 2,
            CELL - 4,
            CELL - 4,
          );
        }
        if (v && piece.y + y >= 0)
          block(ctx, v, X + (piece.x + x) * CELL, Y + (piece.y + y) * CELL);
      }),
    );
    drawPixelText(ctx, env.t('NEXT', '下一个'), 337, 32, '#7fa1b8', 11);
    SHAPES[next].forEach((row, y) =>
      row.forEach((v, x) => {
        if (v) block(ctx, v, 345 + x * 18, 57 + y * 18, 18);
      }),
    );
    for (const [y, text] of [
      [142, env.t('ROTATE  ↻', '旋转  ↻')],
      [188, '◀       ▶'],
      [234, env.t('DROP  ▼', '落下  ▼')],
    ]) {
      ctx.fillStyle = '#1d3548';
      ctx.fillRect(330, y, 130, 36);
      drawPixelText(ctx, text, 395, y + 11, '#e6eddc', 12, 'center');
    }
    drawPixelText(ctx, env.t('Tap controls', '点击按钮操作'), 395, 289, '#7fa1b8', 10, 'center');
    ctx.restore();
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      lines,
      level: 1 + Math.floor(lines / 5),
      board: board.map((r) => r.slice()),
      piece: { ...piece, matrix: piece.matrix.map((r) => r.slice()) },
      next,
      status: { en: `${lines}/30 lines`, zh: `已消除 ${lines}/30 行` },
    }),
  };
}
