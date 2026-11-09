// Field select layout and input: a grid of numbered fields, locked beyond the saved progress.
import { clamp } from '../shared/utils.js';
import { LEVEL_COUNT } from './minefield-levels.js';

export const MENU_COLUMNS = 6;
const CELL = { w: 70, h: 40, gap: 6, x: 15, y: 40 };

export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: CELL.x + (i % MENU_COLUMNS) * (CELL.w + CELL.gap),
    y: CELL.y + Math.floor(i / MENU_COLUMNS) * (CELL.h + CELL.gap),
    w: CELL.w,
    h: CELL.h,
  };
};
const cellAt = (x, y) => {
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player launched the chosen field. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const p = input.pointer ?? {},
    tapped = p.clicked ? cellAt(Number(p.x), Number(p.y)) : 0,
    denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter');
  return { cursor: next, moved: next !== cursor, denied, start };
}
