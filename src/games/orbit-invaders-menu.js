// Level select layout and input: a grid of numbered encounters, locked beyond the saved progress.
import { clamp } from '../shared/utils.js';
import { LEVEL_COUNT } from './orbit-invaders-waves.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 86, h: 40, gapX: 8, gapY: 6, x: 9, y: 30 };

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
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h)
      return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player launched the chosen level. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyZ');
  return { cursor: next, moved: next !== cursor, denied, start };
}
