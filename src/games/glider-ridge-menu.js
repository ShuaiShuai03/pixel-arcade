// Course select: a grid of numbered courses, locked beyond the saved progress.
import { clamp, background, drawPixelText as text } from '../shared/utils.js';
import { COURSES, LEVEL_COUNT } from './glider-ridge-levels.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 86, h: 36, gap: 8, x: 9, y: 28 },
  TIP_SIZE = 14,
  TIP_WIDTH = 450,
  LATIN_WIDTH = 0.62;

export const menuCell = (n) => ({
  x: CELL.x + ((n - 1) % MENU_COLUMNS) * (CELL.w + CELL.gap),
  y: CELL.y + Math.floor((n - 1) / MENU_COLUMNS) * (CELL.h + CELL.gap),
  w: CELL.w,
  h: CELL.h,
});

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

/** One menu update: where the cursor goes, and whether the player launched the chosen course. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0,
    denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || Boolean(input.pressed('Space', 'Enter', 'NumpadEnter'));
  return { cursor: next, moved: next !== cursor, denied, start };
}

const isWide = (ch) => /[⺀-鿿＀-￯]/u.test(ch);
const widthOf = (str) =>
  [...str].reduce((sum, ch) => sum + (isWide(ch) ? TIP_SIZE : TIP_SIZE * LATIN_WIDTH), 0);
/** Breaks a tip into lines no wider than the canvas allows (words in English, glyphs in Chinese). */
export function wrapTip(str) {
  const lines = [];
  let line = '';
  for (const token of str.match(/[⺀-鿿＀-￯]|[^\s⺀-鿿＀-￯]+\s*/gu) ?? []) {
    if (line && widthOf(line + token.trimEnd()) > TIP_WIDTH) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += token;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

export function drawSelect(ctx, env, menu, unlocked) {
  const lang = env.lang === 'zh' ? 'zh' : 'en';
  background(ctx, '#101b2d');
  text(ctx, env.t('CHOOSE A COURSE', '选择赛道'), 240, 6, '#ffe45e', 16, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > unlocked,
      chosen = n === menu.cursor;
    ctx.fillStyle = chosen ? '#e5cf62' : locked ? '#1b2438' : '#2b3a5c';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = locked ? '#141c2e' : '#0b1020';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    const tag = locked
      ? env.t('LOCKED', '未解锁')
      : n < unlocked
        ? env.t('CLEARED', '已通关')
        : env.t('NEXT', '下一关');
    if (chosen) {
      // A pointer under the chosen course, so the selection does not rely on colour alone.
      ctx.fillStyle = '#e5cf62';
      for (let i = 0; i < 4; i++) ctx.fillRect(q.x + q.w / 2 - i, q.y + q.h + 1 + i, 2 * i + 1, 1);
    }
    text(ctx, String(n), q.x + q.w / 2, q.y + 3, locked ? '#6a7a96' : '#f0f6e5', 14, 'center');
    text(ctx, tag, q.x + q.w / 2, q.y + 19, locked ? '#6a7a96' : '#9fe8ea', 12, 'center');
  }
  const course = COURSES[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + CELL.h + 14;
  text(ctx, `${menu.cursor}. ${course.name[lang]}`, 240, top, '#aee1e5', 16, 'center');
  wrapTip(course.brief[lang]).forEach((line, i) =>
    text(ctx, line, 240, top + 22 + i * 16, '#c9d8e6', TIP_SIZE, 'center'),
  );
  text(
    ctx,
    env.t('ARROWS MOVE · SPACE / TAP STARTS', '方向键移动 · 空格 / 点击开始'),
    240,
    300,
    '#e7dcb6',
    12,
    'center',
  );
}
