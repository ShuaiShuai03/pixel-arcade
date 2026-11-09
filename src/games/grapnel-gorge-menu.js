// Route select: layout, keyboard/touch input and drawing, plus text wrapping shared with the HUD.
import { clamp, background, drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './grapnel-gorge-levels.js';

export const MENU_COLUMNS = 6;
const CELL = { w: 70, h: 36, gap: 6, x: 15, y: 28 };
const WIDE_GLYPH = /[　-〿一-鿿＀-￯]/;
const TIP_SIZE = 11;
const TIP_WIDTH = 440;

export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: CELL.x + (i % MENU_COLUMNS) * (CELL.w + CELL.gap),
    y: CELL.y + Math.floor(i / MENU_COLUMNS) * (CELL.h + CELL.gap),
    w: CELL.w,
    h: CELL.h,
  };
};
const glyphWidth = (ch, size) => (WIDE_GLYPH.test(ch) ? size : size * 0.62);
/** Greedy line breaking by monospace advance width; Latin text breaks at spaces. */
export function wrapText(value, size, maxWidth = TIP_WIDTH) {
  const lines = [];
  let line = '',
    width = 0,
    lastSpace = -1;
  for (const ch of value) {
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

/** One menu update: where the cursor goes, and whether the player launched the chosen route. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter');
  return { cursor: next, moved: next !== cursor, denied, start };
}
export function drawSelect(ctx, env, menu) {
  background(ctx, '#27384a');
  const lang = env.t('en', 'zh');
  text(ctx, env.t('CHOOSE A ROUTE', '选择路线'), 240, 8, '#f0d49b', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      chosen = n === menu.cursor;
    ctx.fillStyle = locked ? '#1a2832' : chosen ? '#3d6f8c' : '#2c4a5c';
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
    const tone = locked ? '#5d6f86' : '#f0f6e5';
    text(ctx, String(n), q.x + q.w / 2, q.y + 4, tone, 14, 'center');
    text(ctx, label, q.x + q.w / 2, q.y + 23, locked ? '#5d6f86' : '#9fe8ea', 9, 'center');
  }
  const route = LEVELS[menu.cursor - 1],
    rows = Math.ceil(LEVEL_COUNT / MENU_COLUMNS),
    top = menuCell(rows * MENU_COLUMNS).y + CELL.h + 12;
  text(ctx, `${menu.cursor}. ${route.name[lang]}`, 240, top, '#aee1e5', 13, 'center');
  wrapText(route.lesson[lang], TIP_SIZE).forEach((line, i) =>
    text(ctx, line, 240, top + 18 + i * 13, '#c9d8e6', TIP_SIZE, 'center'),
  );
  text(
    ctx,
    env.t('ARROWS MOVE · SPACE / TAP STARTS', '方向键移动 · 空格 / 点击开始'),
    240,
    304,
    '#e7dcb6',
    10,
    'center',
  );
}
