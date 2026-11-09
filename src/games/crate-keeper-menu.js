// Warehouse select: a grid of numbered rooms, locked beyond the saved progress.
import { background, drawPixelText as text, clamp } from '../shared/utils.js';
import { LEVEL_COUNT, TITLES, PAR_PUSHES } from './crate-keeper-levels.js';

export const MENU_COLUMNS = 5;
const HEADER_HEIGHT = 38;
const CELL = { w: 84, h: 44, gap: 8, x: 14, y: 44 };

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

/** One menu update: where the cursor goes, and whether the player chose the highlighted room. */
export function menuTarget(input, cursor, unlocked) {
  const playable = Math.min(unlocked, LEVEL_COUNT);
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, playable);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0,
    denied = tapped > playable;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Enter', 'Space', 'NumpadEnter'),
    tappedHeader =
      input.pointer?.clicked &&
      Number(input.pointer.y) < HEADER_HEIGHT &&
      Number.isFinite(Number(input.pointer.y)),
    cancel = input.pressed('KeyM', 'Escape') || Boolean(tappedHeader);
  return { cursor: next, moved: next !== cursor, denied, start, cancel };
}

export function drawMenu(ctx, menu, env) {
  background(ctx, '#172c36');
  ctx.fillStyle = '#142b35';
  ctx.fillRect(0, 0, 480, HEADER_HEIGHT);
  text(ctx, env.t('CHOOSE A WAREHOUSE', '选择仓库'), 240, 10, '#e0d7b6', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked,
      cleared = n < menu.unlocked,
      picked = n === menu.cursor;
    ctx.fillStyle = picked ? '#e6e1b5' : '#36545f';
    ctx.fillRect(q.x - 2, q.y - 2, q.w + 4, q.h + 4);
    ctx.fillStyle = open ? '#2b4651' : '#1b303a';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(ctx, String(n), q.x + q.w / 2, q.y + 6, open ? '#e0d7b6' : '#587079', 16, 'center');
    const label = cleared ? env.t('CLEARED', '已通关') : open ? '' : env.t('LOCKED', '未解锁');
    text(ctx, label, q.x + q.w / 2, q.y + 28, cleared ? '#b5d59a' : '#7f949a', 11, 'center');
  }
  const cursor = clamp(menu.cursor, 1, LEVEL_COUNT);
  text(ctx, env.t(...TITLES[cursor - 1]), 240, 262, '#e0d7b6', 14, 'center');
  text(
    ctx,
    `${env.t('PAR', '标准推数')} ${PAR_PUSHES[cursor - 1]} = ${env.t('fewest pushes', '最少推数')}`,
    240,
    282,
    '#b5c2ad',
    12,
    'center',
  );
  text(
    ctx,
    env.t('Arrows move · Enter / tap to start · M back', '方向键移动 · 回车或点按开始 · M返回'),
    240,
    302,
    '#a7bfc0',
    12,
    'center',
  );
}
