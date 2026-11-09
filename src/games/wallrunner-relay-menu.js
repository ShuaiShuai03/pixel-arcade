// Course select: a grid of numbered courses, locked beyond the saved progress.
import { background, clamp, drawPixelText as text } from '../shared/utils.js';
import { COURSES, LEVEL_COUNT } from './wallrunner-relay-levels.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 86, h: 38, gap: 8, x: 11, y: 28 };

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

/** One menu update: where the cursor goes, and whether the player started the chosen course. */
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
  background(ctx, '#0d1624');
  text(ctx, env.t('CHOOSE A COURSE', '选择赛道'), 240, 8, '#97d5ed', 14, 'center');
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
    text(ctx, String(n), q.x + q.w / 2, q.y + 4, locked ? '#6d7f96' : '#f0f6e5', 14, 'center');
    text(ctx, label, q.x + q.w / 2, q.y + 23, locked ? '#6d7f96' : '#9fe8ea', 10, 'center');
  }
  const course = COURSES[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + CELL.h + 14;
  text(
    ctx,
    `${menu.cursor}. ${env.t(course.name.en, course.name.zh)}`,
    240,
    top,
    '#aee1e5',
    14,
    'center',
  );
  text(ctx, env.t(course.tip.en, course.tip.zh), 240, top + 20, '#c9d8e6', 12, 'center');
  text(
    ctx,
    env.t('ARROWS MOVE · SPACE / TAP STARTS', '方向键移动 · 空格 / 点击开始'),
    240,
    300,
    '#e7dcb6',
    11,
    'center',
  );
}
