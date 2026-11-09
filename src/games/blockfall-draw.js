// Blockfall drawing: the well, side panels, level tip and the level select.
import { background, drawPixelText as text, clamp } from '../shared/utils.js';
import { SHAPES } from './blockfall-board.js';
import { LEVELS, LEVEL_COUNT } from './blockfall-levels.js';
import { menuCell } from './blockfall-menu.js';
import { CONTACT_LIMIT, LOCK, grounded, landingY, piecesLeft } from './blockfall-rules.js';
import { goalLabel, progressLabel, wrapText } from './blockfall-text.js';

const COLORS = Object.freeze([
  '',
  '#69c6cd',
  '#e5c786',
  '#b4a2ca',
  '#99be91',
  '#d58f8d',
  '#8badd0',
  '#daa981',
  '#7f8d9b',
  '#5c6f7c',
]);
const X = 167,
  Y = 24,
  CELL = 14;
export const TIP_BOX = Object.freeze({ x: 333, y: 162, width: 132, size: 12, step: 14, lines: 8 });

function tile(ctx, value, x, y, size = CELL, active = false) {
  ctx.fillStyle = active ? '#d9e9df' : '#243f4e';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = COLORS[value];
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.fillStyle = '#eff1d270';
  ctx.fillRect(x + 2, y + 2, size - 4, 2);
  ctx.fillStyle = '#21364588';
  ctx.fillRect(x + 2, y + size - 3, size - 4, 1);
  ctx.fillRect(x + size - 3, y + 3, 1, size - 5);
  ctx.fillStyle = value === 8 ? '#d6c6a0' : '#263d4c';
  if (value === 8) {
    ctx.fillRect(x + 3, y + 3, 2, 2);
    ctx.fillRect(x + size - 5, y + size - 5, 2, 2);
    ctx.fillRect(x + 3, y + size - 5, 2, 2);
    ctx.fillRect(x + size - 5, y + 3, 2, 2);
  } else if (value === 9) {
    ctx.fillRect(x + 3, y + 6, size - 6, 1);
  } else {
    const mark = value % 3;
    ctx.fillRect(x + 4, y + 5, mark + 2, 1);
    ctx.fillRect(x + 5, y + 6, 1, 2);
    if (value > 3) ctx.fillRect(x + size - 5, y + size - 5, 2, 2);
  }
}
function preview(ctx, name, x, y, size) {
  if (!name) return;
  const cells = SHAPES[name].flatMap((r, py) => r.flatMap((v, px) => (v ? [{ v, px, py }] : []))),
    minX = Math.min(...cells.map((c) => c.px)),
    minY = Math.min(...cells.map((c) => c.py));
  for (const c of cells) tile(ctx, c.v, x + (c.px - minX) * size, y + (c.py - minY) * size, size);
}
function city(ctx, level) {
  background(ctx, '#112b3b');
  for (let n = 0; n < 12; n++) {
    const x = n * 43,
      y = 208 - (n % 4) * 19;
    ctx.fillStyle = n % 2 ? '#193749' : '#1d3e4e';
    ctx.fillRect(x, y, 34, 320 - y);
    for (let w = 0; w < 3; w++)
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = r < Math.floor(level / 5) ? '#c5b67c' : '#345561';
        ctx.fillRect(x + 5 + w * 9, y + 10 + r * 17, 4, 6);
      }
  }
}
function drawLeftPanel(ctx, s, env) {
  const level = LEVELS[s.level - 1],
    goal = goalLabel(level),
    progress = progressLabel(s),
    left = piecesLeft(s);
  ctx.fillStyle = '#1c3a49';
  ctx.fillRect(10, 17, 137, 270);
  text(ctx, env.t('BLOCKFALL', '方块降临'), 18, 23, '#d3dfc6', 14);
  text(ctx, `${s.level}/${LEVEL_COUNT}`, 18, 44, '#e8ce90', 24);
  text(ctx, env.t(level.name.en, level.name.zh), 18, 76, '#b4c7bf', 12);
  text(ctx, env.t(goal[0], goal[1]), 18, 98, '#e0d4a6', 12);
  text(ctx, env.t(progress[0], progress[1]), 18, 118, '#e4e7d3', 14);
  if (left !== null) text(ctx, env.t(`PIECES ${left}`, `方块 ${left}`), 18, 140, '#e4e7d3', 12);
  text(ctx, env.t('HOLD', '暂存'), 18, 165, '#93b5bd', 12);
  preview(ctx, s.hold, 26, 187, 16);
  if (!s.hold) text(ctx, '—', 34, 197, '#75939e', 22);
  const note =
    s.ready > 0
      ? env.t('GET READY', '准备')
      : s.rearm
        ? env.t('RELEASE TO READY', '松开操作键以继续')
        : s.holdUsed
          ? env.t('LOCK TO REFILL', '锁定后可再用')
          : env.t('ONCE PER LOCK', '每次锁定前一次');
  text(ctx, note, 18, 240, '#bbccbb', 12);
  text(ctx, env.t('X ↺ RETRY', 'X ↺ 重试城区'), 18, 269, '#d6c68f', 12);
}
function drawRightPanel(ctx, s, env) {
  ctx.fillStyle = '#1c3a49';
  ctx.fillRect(325, 17, 145, 270);
  text(ctx, env.t('NEXT', '接下来'), 335, 25, '#93b5bd', 12);
  s.preview.forEach((name, n) => {
    text(ctx, String(n + 1), 335, 48 + n * 36, '#789aa4', 12);
    preview(ctx, name, 358, 46 + n * 36, n ? 14 : 16);
  });
  text(ctx, env.t('TIP', '提示'), 335, TIP_BOX.y - 18, '#93b5bd', 12);
  const tip = LEVELS[s.level - 1].tip;
  wrapText(env.t(tip.en, tip.zh), TIP_BOX.width, TIP_BOX.size).forEach((line, i) =>
    text(ctx, line, TIP_BOX.x, TIP_BOX.y + i * TIP_BOX.step, '#bbccbb', TIP_BOX.size),
  );
}
function drawWell(ctx, s) {
  ctx.fillStyle = '#719094';
  ctx.fillRect(X - 4, Y - 4, 148, 288);
  ctx.fillStyle = '#0c2231';
  ctx.fillRect(X, Y, 140, 280);
  ctx.strokeStyle = '#1b3747';
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
  s.board.forEach((r, y) =>
    r.forEach((v, x) => {
      if (v) tile(ctx, v, X + x * CELL, Y + y * CELL);
    }),
  );
  if (s.piece) drawPiece(ctx, s);
  for (const row of s.clearing) {
    ctx.fillStyle = Math.floor(s.clearTimer * 45) % 2 ? '#e9dcabdd' : '#b9d6c5aa';
    ctx.fillRect(X, Y + row * CELL, 140, CELL);
  }
  ctx.fillStyle = '#344f5c';
  ctx.fillRect(X, 309, 140, 4);
  ctx.fillStyle = s.contactAge >= CONTACT_LIMIT ? '#dbaf84' : '#afc2a2';
  ctx.fillRect(
    X,
    309,
    140 *
      clamp(s.touched ? Math.max(s.groundedTime / LOCK, s.contactAge / CONTACT_LIMIT) : 0, 0, 1),
    4,
  );
}
function drawPiece(ctx, s) {
  const ghost = landingY(s),
    offset = grounded(s) ? 0 : clamp(s.fall, 0, 1) * CELL;
  s.piece.matrix.forEach((r, y) =>
    r.forEach((v, x) => {
      if (!v) return;
      if (ghost + y >= 0) {
        ctx.strokeStyle = '#b6ccc0';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          X + (s.piece.x + x) * CELL + 2,
          Y + (ghost + y) * CELL + 2,
          CELL - 4,
          CELL - 4,
        );
        ctx.fillStyle = '#7e9f9d';
        ctx.fillRect(X + (s.piece.x + x) * CELL + 5, Y + (ghost + y) * CELL + 6, 4, 2);
      }
      if (s.piece.y + y >= 0)
        tile(ctx, v, X + (s.piece.x + x) * CELL, Y + (s.piece.y + y) * CELL + offset, CELL, true);
    }),
  );
}
export function drawGame(ctx, s, env) {
  city(ctx, s.level);
  drawLeftPanel(ctx, s, env);
  drawWell(ctx, s);
  drawRightPanel(ctx, s, env);
  if (s.litTimer > 0) {
    ctx.fillStyle = '#173b49ec';
    ctx.fillRect(X, Y + 108, 140, 58);
    text(ctx, env.t('DISTRICT LIT', '城区已点亮'), X + 70, Y + 122, '#eee0ad', 12, 'center');
    text(ctx, env.t('NEXT →', '下一区→'), X + 70, Y + 143, '#bcd4c2', 12, 'center');
  }
}
export function drawMenu(ctx, menu, env) {
  city(ctx, menu.cursor);
  text(ctx, env.t('CHOOSE A DISTRICT', '选择城区'), 240, 10, '#eee0ad', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const c = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = n === menu.cursor ? '#e8ce90' : open ? '#2f5666' : '#1a2f3a';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = open ? '#173b49' : '#122632';
    ctx.fillRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
    text(ctx, String(n), c.x + c.w / 2, c.y + 8, open ? '#eee0ad' : '#5f7a86', 16, 'center');
    text(
      ctx,
      open ? (n < menu.unlocked ? '✓' : '▶') : '—',
      c.x + c.w / 2,
      c.y + 26,
      open ? '#bcd4c2' : '#5f7a86',
      10,
      'center',
    );
  }
  const level = LEVELS[menu.cursor - 1],
    goal = goalLabel(level);
  text(ctx, `${menu.cursor}. ${env.t(level.name.en, level.name.zh)}`, 18, 232, '#e8ce90', 14);
  text(ctx, env.t(goal[0], goal[1]), 18, 252, '#e0d4a6', 12);
  const tip = wrapText(env.t(level.tip.en, level.tip.zh), 444, 12);
  tip.forEach((line, i) => text(ctx, line, 18, 270 + i * 14, '#bbccbb', 12));
  text(
    ctx,
    env.t('ARROWS · SPACE / TAP', '方向键 · 空格 / 点按'),
    462,
    301,
    '#93b5bd',
    12,
    'right',
  );
}
