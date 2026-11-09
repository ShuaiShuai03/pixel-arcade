// Iron Bastion level select: geometry, input and drawing of the battlefield grid.
import { background, drawPixelText as text } from '../shared/utils.js';
import { FIELD_COUNT, fieldOf } from './iron-bastion-data.js';

export const MENU = Object.freeze({ x: 48, y: 64, w: 64, h: 38, cols: 6 });
const CONFIRM_KEYS = ['Space', 'Enter', 'NumpadEnter'];

export function menuCellAt(px, py) {
  const col = Math.floor((px - MENU.x) / MENU.w),
    row = Math.floor((py - MENU.y) / MENU.h),
    n = row * MENU.cols + col + 1;
  return px >= MENU.x && py >= MENU.y && col < MENU.cols && row >= 0 && n <= FIELD_COUNT ? n : 0;
}

const cellOf = (n) => ({
  x: MENU.x + ((n - 1) % MENU.cols) * MENU.w,
  y: MENU.y + Math.floor((n - 1) / MENU.cols) * MENU.h,
});

// Returns the field to start, or 0 while the player is still choosing.
export function menuStep(menu, i) {
  const move =
    Number(i.pressed('ArrowRight', 'KeyD')) -
    Number(i.pressed('ArrowLeft', 'KeyA')) +
    MENU.cols * (Number(i.pressed('ArrowDown', 'KeyS')) - Number(i.pressed('ArrowUp', 'KeyW')));
  menu.cursor = Math.max(1, Math.min(menu.unlocked, menu.cursor + move));
  const tapped = i.pointer?.clicked ? menuCellAt(i.pointer.x, i.pointer.y) : 0;
  if (tapped > menu.unlocked) {
    menu.locked = menu.unlocked;
    return 0;
  }
  if (tapped) return tapped;
  return i.pressed(...CONFIRM_KEYS) ? menu.cursor : 0;
}

export function drawMenu(ctx, s, env) {
  const { cursor, unlocked } = s.menu,
    blink = Math.floor(s.menuClock * 4) % 2 === 0;
  background(ctx, '#142b30');
  text(
    ctx,
    env.t('IRON BASTION · choose a battlefield', '钢铁堡垒 · 选择战场'),
    240,
    12,
    '#e0dcc1',
    14,
    'center',
  );
  text(
    ctx,
    env.t(`${unlocked}/${FIELD_COUNT} fields open`, `已开放 ${unlocked}/${FIELD_COUNT} 个战场`),
    240,
    38,
    '#9ed9b8',
    10,
    'center',
  );
  for (let n = 1; n <= FIELD_COUNT; n++) {
    const { x, y } = cellOf(n),
      open = n <= unlocked;
    ctx.fillStyle = n === cursor && blink ? '#f1d89d' : '#3d514c';
    ctx.fillRect(x + 2, y + 2, MENU.w - 4, MENU.h - 4);
    ctx.fillStyle = open ? '#1d3a3a' : '#16262a';
    ctx.fillRect(x + 4, y + 4, MENU.w - 8, MENU.h - 8);
    if (open && n < unlocked) {
      ctx.fillStyle = '#86bc9a';
      ctx.fillRect(x + 4, y + 4, MENU.w - 8, 3);
    }
    text(ctx, String(n), x + MENU.w / 2, y + 12, open ? '#f4efd0' : '#4b5b58', 14, 'center');
    if (!open) {
      ctx.fillStyle = '#4b5b58';
      ctx.fillRect(x + MENU.w / 2 - 4, y + MENU.h - 12, 8, 5);
    }
  }
  const field = fieldOf(cursor),
    tipY = MENU.y + 4 * MENU.h + 10;
  text(
    ctx,
    `${cursor}. ${env.t(field.name.en, field.name.zh)}`,
    240,
    tipY,
    '#f1d89d',
    12,
    'center',
  );
  text(ctx, env.t(field.tip.en, field.tip.zh), 240, tipY + 16, '#b8d3cb', 10, 'center');
  const note = s.menu.locked
    ? env.t(`Clear field ${s.menu.locked} first`, `先通关第${s.menu.locked}战场`)
    : env.t('Arrows + Space, or tap a field', '方向键加空格，或点按战场');
  text(ctx, note, 240, tipY + 34, s.menu.locked ? '#f2a387' : '#e4d2a6', 10, 'center');
}
