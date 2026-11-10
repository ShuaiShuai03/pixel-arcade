// Level select: a grid of numbered levels, locked beyond the saved progress.
import { background, clamp, drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './vine-warden-levels.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 86, h: 38, gapX: 8, gapY: 6, x: 9, y: 30 };
const TIERS = Object.freeze({
  teach: Object.freeze({ en: 'TEACH', zh: '教学', color: '#9fd88a' }),
  combo: Object.freeze({ en: 'COMBO', zh: '组合', color: '#ffd24a' }),
  master: Object.freeze({ en: 'MASTER', zh: '精通', color: '#ff9a7a' }),
});

export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: CELL.x + (i % MENU_COLUMNS) * (CELL.w + CELL.gapX),
    y: CELL.y + Math.floor(i / MENU_COLUMNS) * (CELL.h + CELL.gapY),
    w: CELL.w,
    h: CELL.h,
  };
};
const cellAt = (pointer) => {
  const px = Number(pointer.x);
  const py = Number(pointer.y);
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h) return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update (`unlocked` may be LEVEL_COUNT + 1: every level cleared): where the cursor goes, and whether the player started the chosen level. */
export function menuTarget(input, cursor, unlocked) {
  const open = Math.min(unlocked, LEVEL_COUNT);
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, open);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > open;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter');
  return { cursor: next, moved: next !== cursor, denied, start };
}

export function drawMenu(ctx, env, menu) {
  background(ctx, '#0a1812');
  ctx.fillStyle = '#14301f';
  ctx.fillRect(0, 0, 480, 24);
  text(ctx, env.t('CHOOSE A LEVEL', '选择关卡'), 240, 5, '#ffe36a', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    const open = n <= menu.unlocked;
    const tier = TIERS[LEVELS[n - 1].tier];
    ctx.fillStyle = n === menu.cursor ? '#ffe36a' : '#3f6a4a';
    ctx.fillRect(q.x - 2, q.y - 2, q.w + 4, q.h + 4);
    ctx.fillStyle = open ? '#1c3a28' : '#101c14';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(ctx, String(n), q.x + q.w / 2, q.y + 3, open ? '#ffe36a' : '#6a7e70', 14, 'center');
    const label =
      n < menu.unlocked ? env.t('CLEARED', '已通关') : open ? '' : env.t('LOCKED', '未解锁');
    text(
      ctx,
      label || env.t(tier.en, tier.zh),
      q.x + q.w / 2,
      q.y + 21,
      open ? tier.color : '#8a9a90',
      14,
      'center',
    );
  }
  const level = LEVELS[menu.cursor - 1];
  ctx.fillStyle = '#14301f';
  ctx.fillRect(0, 214, 480, 106);
  text(
    ctx,
    `${menu.cursor}. ${env.t(level.name.en, level.name.zh)}`,
    240,
    222,
    '#ffffff',
    16,
    'center',
  );
  text(ctx, env.t(level.tip.en, level.tip.zh), 240, 250, '#c8e87a', 14, 'center');
  text(
    ctx,
    env.t('Arrows choose, Space starts, or tap', '方向键选择，空格开始，或点按'),
    240,
    292,
    '#9ad7ff',
    14,
    'center',
  );
}
