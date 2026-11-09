// Stage select layout and input: a grid of numbered duels, locked beyond the saved progress.
import { clamp } from '../shared/utils.js';
import { STAGE_COUNT } from './ember-knights-stages.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 84, h: 42, gap: 6, x: 18, y: 32 };

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
  for (let n = 1; n <= STAGE_COUNT; n++) {
    const q = menuCell(n);
    if (pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h)
      return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player started the chosen duel. */
export function menuTarget(input, cursor, unlocked) {
  const step =
    axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) +
    MENU_COLUMNS * axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
  let next = clamp(cursor + step, 1, unlocked);
  const tapped = input.pointer?.clicked ? cellAt(input.pointer) : 0;
  const denied = tapped > unlocked;
  if (tapped && !denied) next = tapped;
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyJ');
  return { cursor: next, moved: next !== cursor, denied, start };
}
