// Sector select: a grid of numbered sectors, locked beyond the saved progress.
import { clamp, drawPixelText, background } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './meteor-drift-levels.js';

export const MENU_COLUMNS = 6;
const CELL = { w: 70, h: 40, gap: 6, x: 15, y: 30 };
const TIP_SIZE = 11;
const TIP_WIDTH = 440;
const WIDE_GLYPH = /[　-〿一-鿿＀-￯]/;

export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: CELL.x + (i % MENU_COLUMNS) * (CELL.w + CELL.gap),
    y: CELL.y + Math.floor(i / MENU_COLUMNS) * (CELL.h + CELL.gap),
    w: CELL.w,
    h: CELL.h,
  };
};
const cellAt = (pointer) => {
  const px = Number(pointer.x),
    py = Number(pointer.y);
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h) return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player launched the chosen sector. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyZ');
  return { cursor: next, moved: next !== cursor, denied, start };
}

const glyphWidth = (ch, size) => (WIDE_GLYPH.test(ch) ? size : size * 0.62);
/** Greedy line breaking by the monospace advance width; Latin text breaks at spaces. */
export function wrapText(text, size, maxWidth = TIP_WIDTH) {
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
export function drawSelect(ctx, env, menu) {
  background(ctx, '#0b1727');
  const lang = env.t('en', 'zh');
  drawPixelText(ctx, env.t('CHOOSE A SECTOR', '选择星区'), 240, 8, '#b4dbd2', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      chosen = n === menu.cursor;
    ctx.fillStyle = locked ? '#16222f' : chosen ? '#38667a' : '#203c4d';
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
    const dim = locked ? '#566a7c' : '#f0f6e5';
    drawPixelText(ctx, String(n), q.x + q.w / 2, q.y + 6, dim, 15, 'center');
    drawPixelText(ctx, label, q.x + q.w / 2, q.y + 26, locked ? '#566a7c' : '#9fe8d4', 9, 'center');
  }
  const sector = LEVELS[menu.cursor - 1],
    top = menuCell(Math.ceil(LEVEL_COUNT / MENU_COLUMNS) * MENU_COLUMNS).y + 46;
  drawPixelText(ctx, `${menu.cursor}. ${sector.name[lang]}`, 240, top, '#e5d4b0', 13, 'center');
  wrapText(sector.tip[lang], TIP_SIZE).forEach((line, i) =>
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
