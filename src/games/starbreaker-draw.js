// Starbreaker rendering: the field, the select screen and the opening lesson.
import { drawPixelText, background } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './starbreaker-levels.js';
import { MENU_COLUMNS, menuCell } from './starbreaker-menu.js';

const COLORS = Object.freeze(['#fb8264', '#eab961', '#7ad7a6', '#70baf3']);
const WIDE_GLYPH = /[　-〿一-鿿＀-￯]/;
const TEXT_WIDTH = 420;
const TIP_SIZE = 11;

const glyphWidth = (ch, size) => (WIDE_GLYPH.test(ch) ? size : size * 0.62);
/** Greedy line breaking by the monospace advance width; Latin text breaks at spaces. */
export function wrapText(text, size, maxWidth = TEXT_WIDTH) {
  const lines = [];
  let line = '',
    width = 0,
    lastSpace = -1;
  for (const ch of text) {
    const w = glyphWidth(ch, size);
    if (width + w > maxWidth && line) {
      if (lastSpace > 0) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
      } else {
        lines.push(line);
        line = '';
      }
      width = [...line].reduce((sum, c) => sum + glyphWidth(c, size), 0);
      lastSpace = -1;
    }
    if (ch === ' ') lastSpace = line.length;
    line += ch;
    width += w;
  }
  if (line) lines.push(line);
  return lines;
}

function drawBrick(ctx, b) {
  ctx.fillStyle = COLORS[b.color];
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = '#ffffff66';
  ctx.fillRect(b.x + 2, b.y + 1, b.w - 4, 2);
  ctx.fillStyle = '#10172f66';
  ctx.fillRect(b.x + 2, b.y + b.h - 3, b.w - 4, 3);
  ctx.fillStyle = '#fff1cf';
  for (let bar = 1; bar < b.hp; bar++) ctx.fillRect(b.x + b.w / 2 - 4, b.y + 2 + bar * 4, 8, 2);
  if (b.drift) {
    ctx.fillStyle = '#10172f';
    const tip = b.drift > 0 ? b.x + b.w - 3 : b.x + 3;
    ctx.fillRect(tip - 1, b.y + 5, 2, 4);
    ctx.fillRect(tip - b.drift * 2, b.y + 6, 2, 2);
  }
  if (b.kind === 'reactor') {
    ctx.fillStyle = '#ffea9c';
    ctx.fillRect(b.x + b.w / 2 - 2, b.y + 2, 4, 10);
    ctx.fillRect(b.x + b.w / 2 - 6, b.y + 5, 12, 4);
  }
}
function drawPaddle(ctx, s) {
  ctx.fillStyle = '#315878';
  ctx.fillRect(s.paddle.x - s.paddle.w / 2, 296, s.paddle.w, 7);
  ctx.fillStyle = s.slow > 0 ? '#92bbff' : '#9fe8ea';
  for (let x = -s.paddle.w / 2; x < s.paddle.w / 2; x += 2) {
    const top = 286 + 8 * (x / (s.paddle.w / 2)) ** 2;
    ctx.fillRect(s.paddle.x + x, top, 2, 300 - top);
  }
  if (s.catchReady > 0) {
    ctx.strokeStyle = '#ffdc83';
    ctx.strokeRect(s.paddle.x - s.paddle.w / 2 - 3, 281, s.paddle.w + 6, 15);
  }
}
function drawBall(ctx, s) {
  for (let i = 0; i < s.trail.length; i++) {
    ctx.fillStyle = i < 4 ? '#2b525d' : '#52868d';
    ctx.fillRect(s.trail[i].x - 2, s.trail[i].y - 2, 4, 4);
  }
  if (s.docked) {
    ctx.strokeStyle = '#b2c3cf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.paddle.x, 299);
    ctx.lineTo(s.ball.x, 299);
    ctx.lineTo(s.ball.x, s.ball.y + 6);
    ctx.stroke();
    ctx.strokeRect(s.ball.x - 6, s.ball.y - 5, 12, 11);
  }
  ctx.fillStyle = '#f0f6e5';
  ctx.fillRect(Math.round(s.ball.x - 4), Math.round(s.ball.y - 4), 8, 8);
  ctx.fillStyle = '#b4e3df';
  ctx.fillRect(s.ball.x - 2, s.ball.y + 4, 4, 2);
}
function drawUpgrades(ctx, s) {
  for (const p of s.powerups) {
    ctx.fillStyle = p.type === 'wide' ? '#89e4b0' : p.type === 'life' ? '#fa866f' : '#92bbff';
    ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
    const glyph = p.type === 'wide' ? 'W' : p.type === 'life' ? '+' : 'D';
    drawPixelText(ctx, glyph, p.x, p.y - 5, '#182436', 10, 'center');
  }
  for (const p of s.particles) {
    ctx.strokeStyle = '#fef4b6';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 8 * (0.4 - p.life) * 8, p.y - 5, 16 * (0.4 - p.life) * 8, 10);
  }
}
function drawLesson(ctx, s, env) {
  const field = LEVELS[s.level - 1],
    lang = env.t('en', 'zh');
  drawPixelText(ctx, field.name[lang], 240, 188, '#aee1e5', 13, 'center');
  if (!s.intro) return;
  wrapText(field.tip[lang], TIP_SIZE).forEach((line, i) =>
    drawPixelText(ctx, line, 240, 206 + i * 14, '#c9d8e6', TIP_SIZE, 'center'),
  );
}
function drawHud(ctx, s, env) {
  drawPixelText(
    ctx,
    env.t('FIELD', '区域') + ' ' + s.level + '/' + LEVEL_COUNT,
    14,
    12,
    '#97d5ed',
    13,
  );
  drawPixelText(ctx, '● '.repeat(Math.max(0, s.lives)), 466, 12, '#f5c276', 13, 'right');
  drawPixelText(ctx, env.t('CATCH', '接球') + ' ' + s.catches, 240, 12, '#c7a2e8', 11, 'center');
}
function drawStars(ctx) {
  background(ctx, '#0c162b');
  for (let i = 0; i < 75; i++) {
    ctx.fillStyle = i % 4 ? '#263958' : '#7387a0';
    ctx.fillRect((i * 97) % 480, (i * 61) % 320, i % 4 ? 1 : 2, 1);
  }
}
function drawSelect(ctx, env, menu) {
  drawStars(ctx);
  const lang = env.t('en', 'zh');
  drawPixelText(ctx, env.t('CHOOSE A FIELD', '选择区域'), 240, 8, '#97d5ed', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      chosen = n === menu.cursor;
    ctx.fillStyle = locked ? '#1a2538' : chosen ? '#3d6f8c' : '#27455f';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    if (chosen) {
      ctx.strokeStyle = '#ffdc83';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x + 1, q.y + 1, q.w - 2, q.h - 2);
    }
    const label = locked
      ? env.t('LOCKED', '未解锁')
      : n < menu.unlocked
        ? env.t('CLEARED', '已通关')
        : env.t('NEXT', '下一关');
    drawPixelText(
      ctx,
      String(n),
      q.x + q.w / 2,
      q.y + 6,
      locked ? '#5d6f86' : '#f0f6e5',
      15,
      'center',
    );
    drawPixelText(ctx, label, q.x + q.w / 2, q.y + 26, locked ? '#5d6f86' : '#9fe8ea', 9, 'center');
  }
  const field = LEVELS[menu.cursor - 1],
    rows = Math.ceil(LEVEL_COUNT / MENU_COLUMNS),
    top = menuCell(rows * MENU_COLUMNS).y + 46;
  drawPixelText(ctx, `${menu.cursor}. ${field.name[lang]}`, 240, top, '#aee1e5', 13, 'center');
  wrapText(field.tip[lang], TIP_SIZE).forEach((line, i) =>
    drawPixelText(ctx, line, 240, top + 18 + i * 13, '#c9d8e6', TIP_SIZE, 'center'),
  );
  drawPixelText(
    ctx,
    env.t('ARROWS MOVE · SPACE / TAP STARTS', '方向键移动 · 空格 / 点击开始'),
    240,
    304,
    '#e7dcb6',
    10,
    'center',
  );
}

export function drawBreaker(ctx, s, env, menu) {
  if (menu) return drawSelect(ctx, env, menu);
  drawStars(ctx);
  ctx.fillStyle = '#192b43';
  ctx.fillRect(4, 32, 4, 288);
  ctx.fillRect(472, 32, 4, 288);
  ctx.fillRect(8, 29, 464, 3);
  for (const b of s.bricks) drawBrick(ctx, b);
  if (s.net > 0) {
    ctx.fillStyle = '#6bd6c1';
    ctx.fillRect(8, 312, 464, s.net * 2);
  }
  drawUpgrades(ctx, s);
  drawPaddle(ctx, s);
  drawBall(ctx, s);
  drawHud(ctx, s, env);
  if (s.intro || s.banner > 0) drawLesson(ctx, s, env);
  if (s.docked)
    drawPixelText(
      ctx,
      env.t('SPACE / TAP TO LAUNCH', '空格 / 点击发球'),
      240,
      252,
      '#e7dcb6',
      12,
      'center',
    );
}
