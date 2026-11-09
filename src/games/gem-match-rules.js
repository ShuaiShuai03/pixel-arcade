// Board rules: match finding, legal swaps and match-free generation. Pure functions on plain arrays.
export const SIZE = 7;
export const GEM_KINDS = 6;
const DIRECTIONS = Object.freeze([
  [1, 0],
  [0, 1],
]);

export const validCell = (board, p) =>
  Boolean(p) &&
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  p.y >= 0 &&
  p.y < board.length &&
  p.x >= 0 &&
  p.x < board[0].length;

export function findMatches(board) {
  const found = new Set(),
    h = board.length,
    w = board[0]?.length || 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const value = board[y][x];
      if (value < 0) continue;
      if (x + 2 < w && board[y][x + 1] === value && board[y][x + 2] === value)
        for (let c = x; c < w && board[y][c] === value; c++) found.add(`${y},${c}`);
      if (y + 2 < h && board[y + 1][x] === value && board[y + 2][x] === value)
        for (let r = y; r < h && board[r][x] === value; r++) found.add(`${r},${x}`);
    }
  return [...found];
}

/** The board after swapping two adjacent gems, or null when the swap makes no match. */
export function applySwap(board, a, b) {
  if (
    !validCell(board, a) ||
    !validCell(board, b) ||
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 ||
    board[a.y][a.x] < 0 ||
    board[b.y][b.x] < 0
  )
    return null;
  const out = board.map((r) => r.slice());
  [out[a.y][a.x], out[b.y][b.x]] = [out[b.y][b.x], out[a.y][a.x]];
  const matches = findMatches(out);
  return matches.includes(`${a.y},${a.x}`) || matches.includes(`${b.y},${b.x}`) ? out : null;
}

export function legalSwaps(board) {
  const result = [];
  for (let y = 0; y < board.length; y++)
    for (let x = 0; x < board[0].length; x++)
      for (const [dx, dy] of DIRECTIONS) {
        const a = { x, y },
          b = { x: x + dx, y: y + dy };
        if (applySwap(board, a, b)) result.push({ a, b });
      }
  return result;
}

/**
 * Writes a gem into (x, y) that completes no match, scanning from a random start kind. A refill cell
 * boxed in by matching pairs on every kind keeps the start kind and simply cascades.
 */
export function chooseColor(board, x, y, random, kinds = GEM_KINDS) {
  const start = Math.min(kinds - 1, Math.max(0, Math.floor(random() * kinds)));
  for (let n = 0; n < kinds; n++) {
    const value = (start + n) % kinds;
    board[y][x] = value;
    if (!findMatches(board).includes(`${y},${x}`)) return value;
  }
  board[y][x] = start;
  return start;
}

export function makeBoard(random, kinds = GEM_KINDS, size = SIZE) {
  if (!Number.isInteger(size) || size < 3)
    throw new RangeError('Board needs at least three cells per side');
  for (let attempt = 0; attempt < 24; attempt++) {
    const board = Array.from({ length: size }, () => Array(size).fill(-1));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) chooseColor(board, x, y, random, kinds);
    if (legalSwaps(board).length) return board;
  }
  const board = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => (x + 2 * y) % kinds),
  );
  board[0][0] = 0;
  board[0][1] = 1;
  board[0][2] = 0;
  board[1][1] = 0;
  return board;
}
