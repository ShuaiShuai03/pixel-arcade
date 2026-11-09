// Level select: a grid of numbered districts, locked beyond the saved progress.
import { clamp } from '../shared/utils.js';
import { LEVEL_COUNT } from './blockfall-levels.js';

export const MENU_COLUMNS = 5;
const CELL = { w: 84, h: 40, gap: 6, x: 18, y: 34 };

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
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n);
    if (pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h)
      return n;
  }
  return 0;
};
const axis = (input, negative, positive) =>
  Number(input.pressed(...positive)) - Number(input.pressed(...negative));

/** One menu update: where the cursor goes, and whether the player chose the level. */
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
  const start = (tapped > 0 && !denied) || input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyJ');
  return { cursor: next, moved: next !== cursor, denied, start };
}

/** Highest unlocked level from the host store; a missing, throwing or junk store means level 1. */
export function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
  } catch {
    return 1;
  }
}
export function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}
