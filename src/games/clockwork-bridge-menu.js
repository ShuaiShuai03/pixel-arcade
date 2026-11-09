// Machine select: a grid of numbered machines, locked beyond the saved progress.
import { background, clamp, drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './clockwork-bridge-levels.js';

export const MENU_COLUMNS = 6;
const CELL = { w: 70, h: 36, gap: 6, x: 15, y: 30 };
const TIP_WIDTH = 440;
const TIP_SIZE = 12;

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

/** One menu update: where the cursor goes, and whether the player launched the chosen machine. */
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

const glyphWidth = (ch, size) => (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62);

/** Greedy wrap: Chinese breaks anywhere, English at spaces. */
export function wrapText(line, size, width) {
  const rows = [];
  let row = '';
  for (const word of line.match(/\S+\s*|\s+/g) ?? []) {
    const pieces = /[^\x00-\x7f]/.test(word) ? [...word] : [word];
    for (const piece of pieces) {
      const w = [...(row + piece).trimEnd()].reduce((sum, ch) => sum + glyphWidth(ch, size), 0);
      if (w > width && row) {
        rows.push(row.trimEnd());
        row = piece.trimStart();
      } else row += piece;
    }
  }
  if (row.trim()) rows.push(row.trimEnd());
  return rows;
}

export function drawMenu(ctx, menu, env) {
  background(ctx, '#1c1713');
  ctx.fillStyle = '#2b221b';
  ctx.fillRect(0, 0, 480, 22);
  text(ctx, env.t('CHOOSE A MACHINE', '选择机器'), 240, 4, '#f6d27a', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked,
      cleared = n < menu.unlocked,
      picked = n === menu.cursor;
    ctx.fillStyle = picked ? '#f6d27a' : '#5a4a3b';
    ctx.fillRect(q.x - 2, q.y - 2, q.w + 4, q.h + 4);
    ctx.fillStyle = open ? '#3a2c20' : '#241b14';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(ctx, String(n), q.x + q.w / 2, q.y + 3, open ? '#f6d27a' : '#6d5d4b', 14, 'center');
    const label = cleared ? env.t('CLEARED', '已通关') : open ? '' : env.t('LOCKED', '未解锁');
    text(ctx, label, q.x + q.w / 2, q.y + 21, cleared ? '#9fd88a' : '#a89a88', 11, 'center');
  }
  const spec = LEVELS[clamp(menu.cursor, 1, LEVEL_COUNT) - 1];
  text(ctx, env.t(spec.name.en, spec.name.zh), 240, 224, '#f6d27a', 14, 'center');
  wrapText(env.t(spec.tip.en, spec.tip.zh), TIP_SIZE, TIP_WIDTH).forEach((row, i) =>
    text(ctx, row, 240, 246 + i * 16, '#e8dcc4', TIP_SIZE, 'center'),
  );
  text(
    ctx,
    env.t('Arrows move · Space / tap to start', '方向键移动 · 空格或点按开始'),
    240,
    300,
    '#a89a88',
    12,
    'center',
  );
}
