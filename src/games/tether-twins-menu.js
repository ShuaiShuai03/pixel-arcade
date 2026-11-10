// Room select: a grid of numbered rooms, locked beyond the saved progress.
import { background, clamp, drawPixelText as text } from '../shared/utils.js';
import { ROOMS, ROOM_COUNT } from './tether-twins-rooms.js';

export const MENU_COLUMNS = 5;
const CELL = Object.freeze({ w: 86, h: 38, gap: 8, x: 11, y: 28 });

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
  for (let n = 1; n <= ROOM_COUNT; n++) {
    const q = menuCell(n);
    if (px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h) return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player started the chosen room. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyX');
  return { cursor: next, moved: next !== cursor, denied, start };
}

export function drawSelect(ctx, env, menu) {
  background(ctx, '#0d1624');
  text(ctx, env.t('CHOOSE A ROOM', '选择房间'), 240, 8, '#97d5ed', 14, 'center');
  for (let n = 1; n <= ROOM_COUNT; n++) {
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
    text(ctx, String(n), q.x + q.w / 2, q.y + 3, locked ? '#6d7f96' : '#f0f6e5', 14, 'center');
    text(ctx, label, q.x + q.w / 2, q.y + 21, locked ? '#6d7f96' : '#9fe8ea', 14, 'center');
  }
  const room = ROOMS[menu.cursor - 1],
    top = menuCell(ROOM_COUNT).y + CELL.h + 14;
  text(
    ctx,
    `${menu.cursor}. ${env.t(room.name.en, room.name.zh)}`,
    240,
    top,
    '#aee1e5',
    14,
    'center',
  );
  text(ctx, env.t(room.tip.en, room.tip.zh), 240, top + 20, '#c9d8e6', 14, 'center');
  text(
    ctx,
    env.t('ARROWS MOVE · SPACE / X / TAP STARTS', '方向键移动 · 空格 / X / 点击开始'),
    240,
    298,
    '#e7dcb6',
    14,
    'center',
  );
}
