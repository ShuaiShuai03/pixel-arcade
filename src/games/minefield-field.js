// Field construction: geometry, mine placement, flood opening and the no-guess certificate.
import { deduceVisible } from './minefield-solver.js';

const ATTEMPTS = 400;
const SEED_RANGE = 4294967296;

export function neighbors(index, w, h) {
  if (!Number.isInteger(index) || index < 0 || index >= w * h) return [];
  const x = index % w,
    y = Math.floor(index / w),
    out = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < w && ny >= 0 && ny < h) out.push(ny * w + nx);
    }
  return out;
}

function fieldFrom(plan, mines, opening) {
  const { w, h, mask } = plan,
    numbers = mines.map((_, i) =>
      mask[i] ? neighbors(i, w, h).filter((n) => mines[n]).length : 0,
    );
  return Object.freeze({
    w,
    h,
    count: plan.count,
    mask: Object.freeze(mask.slice()),
    mines: Object.freeze(mines.slice()),
    numbers: Object.freeze(numbers),
    opening: Object.freeze(opening.slice()),
    regions: Object.freeze(
      plan.regions.map((r) =>
        Object.freeze({
          ...r,
          cells: Object.freeze(r.cells.slice()),
          total: r.cells.filter((i) => mines[i]).length,
        }),
      ),
    ),
  });
}

/** Flood from `index` through zero-clue tiles; flags and mines stop it. */
export function revealCells(field, revealed, flags, index) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= field.w * field.h ||
    !field.mask[index] ||
    revealed[index] ||
    flags[index] ||
    field.mines[index]
  )
    return [];
  const seen = new Set(),
    queue = [index];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (seen.has(i) || revealed[i] || flags[i] || field.mines[i] || !field.mask[i]) continue;
    seen.add(i);
    if (field.numbers[i] === 0)
      for (const n of neighbors(i, field.w, field.h)) if (!seen.has(n)) queue.push(n);
  }
  return [...seen];
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Mines avoid the first tile and its neighbors; then `plan.hints` extra safe numbers open. */
export function createField(plan, first, random) {
  const { w, h, mask, count } = plan;
  if (!Number.isInteger(first) || first < 0 || first >= w * h || !mask[first])
    throw new RangeError('Invalid opening');
  const excluded = new Set([first, ...neighbors(first, w, h)]),
    candidates = [];
  for (let i = 0; i < w * h; i++) if (mask[i] && !excluded.has(i)) candidates.push(i);
  if (count > candidates.length)
    throw new RangeError('Mine count exceeds the safe-opening capacity');
  const mines = Array(w * h).fill(false);
  for (const i of shuffle(candidates, random).slice(0, count)) mines[i] = true;
  const base = fieldFrom(plan, mines, [first]);
  const opening = [first],
    shown = new Set(revealCells(base, [], [], first)),
    extras = shuffle(
      candidates.filter((i) => !mines[i] && base.numbers[i] > 0 && !shown.has(i)),
      random,
    );
  for (const i of extras.slice(0, plan.hints)) opening.push(i);
  return fieldFrom(plan, mines, opening);
}

/** Tiles opened by the field's opening moves (first tile, then pre-opened hints). */
export function openingCells(field) {
  const revealed = Array(field.w * field.h).fill(false);
  for (const i of field.opening)
    for (const n of revealCells(field, revealed, revealed, i)) revealed[n] = true;
  return revealed;
}

export function deductionSolves(field) {
  const known = Array(field.w * field.h).fill(false),
    revealed = openingCells(field),
    needed = field.mask.filter(Boolean).length - field.count;
  const open = (i) => {
    for (const n of revealCells(field, revealed, known, i)) revealed[n] = true;
  };
  for (let pass = 0; pass < field.w * field.h; pass++) {
    if (revealed.filter(Boolean).length === needed) return true;
    const d = deduceVisible(field, revealed, known);
    if (!d.safe.length && !d.mines.length) return false;
    for (const i of d.mines) {
      if (!field.mines[i]) return false;
      known[i] = true;
    }
    for (const i of d.safe) {
      if (field.mines[i]) return false;
      open(i);
    }
  }
  return false;
}

/** Regenerates until pure logic clears the field from its opening; deterministic per seed. */
export function certifiedField(plan, first, random) {
  const seed = Math.floor(random() * SEED_RANGE) >>> 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let value = (seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
    const local = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / SEED_RANGE;
    };
    const field = createField(plan, first, local);
    if (deductionSolves(field)) return field;
  }
  throw new RangeError('No certified field found for this opening');
}
