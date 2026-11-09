// Chamber select: layout, input and drawing. Locked chambers lie beyond the saved progress.
import { clamp, drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './dungeon-dash-levels.js';

export const MENU_COLUMNS = 6;
const CELL = { w: 70, h: 38, gap: 6, x: 15, y: 34 };

export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: CELL.x + (i % MENU_COLUMNS) * (CELL.w + CELL.gap),
    y: CELL.y + Math.floor(i / MENU_COLUMNS) * (CELL.h + CELL.gap),
    w: CELL.w,
    h: CELL.h,
  };
};
function cellAt(pointer) {
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h)
      return n;
  }
  return 0;
}
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player chose a chamber. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const pointer = input.pointer,
    usable = pointer?.clicked && Number.isFinite(pointer.x) && Number.isFinite(pointer.y),
    tapped = usable ? cellAt(pointer) : 0,
    denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start =
    (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyJ', 'KeyE');
  return { cursor: next, moved: next !== cursor, denied, start };
}
function cellLabel(n, unlocked, env) {
  if (n > unlocked) return env.t('LOCKED', '未解锁');
  if (n < unlocked) return env.t('CLEARED', '已通关');
  return n === LEVEL_COUNT ? env.t('FINAL', '最终') : env.t('NEXT', '下一关');
}
export function drawMenu(ctx, menu, env) {
  ctx.fillStyle = '#10222d';
  ctx.fillRect(0, 0, 480, 320);
  text(ctx, env.t('CHOOSE A CHAMBER', '选择密室'), 240, 8, '#e2dda4', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? '#2c4a4c' : '#182c36';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(ctx, String(n), q.x + q.w / 2, q.y + 5, open ? '#e2dda4' : '#5f7b80', 14, 'center');
    text(
      ctx,
      cellLabel(n, menu.unlocked, env),
      q.x + q.w / 2,
      q.y + 23,
      open ? '#a9d4b5' : '#5f7b80',
      9,
      'center',
    );
    if (n === menu.cursor) {
      ctx.strokeStyle = '#f4d19a';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x - 1, q.y - 1, q.w + 2, q.h + 2);
    }
  }
  const chosen = LEVELS[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + 54;
  text(
    ctx,
    `${menu.cursor}. ${env.t(chosen.name.en, chosen.name.zh)}`,
    240,
    top,
    '#e2dda4',
    13,
    'center',
  );
  text(ctx, env.t(chosen.tip.en, chosen.tip.zh), 240, top + 22, '#c1d9c5', 10, 'center');
  text(
    ctx,
    env.t('Arrows move · Space or tap starts', '方向键移动 · 空格或点按开始'),
    240,
    300,
    '#91b0b4',
    10,
    'center',
  );
}
