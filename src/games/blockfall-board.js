// Piece shapes, rotation with kicks, collision and line removal for the 10x20 well.
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const SHAPES = deepFreeze({
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [2, 2],
    [2, 2],
  ],
  T: [
    [0, 3, 0],
    [3, 3, 3],
    [0, 0, 0],
  ],
  S: [
    [0, 4, 4],
    [4, 4, 0],
    [0, 0, 0],
  ],
  Z: [
    [5, 5, 0],
    [0, 5, 5],
    [0, 0, 0],
  ],
  J: [
    [6, 0, 0],
    [6, 6, 6],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 7],
    [7, 7, 7],
    [0, 0, 0],
  ],
});
export function rotatePiece(matrix, clockwise = true) {
  const n = matrix.length;
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (clockwise ? matrix[n - 1 - x][y] : matrix[x][n - 1 - y])),
  );
}
// Rotation offsets use a stable pivot and include both wall and floor recovery.
const NORMAL_KICKS = deepFreeze({
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
});
const LONG_KICKS = deepFreeze({
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
});
export function turnPiece(board, piece, clockwise = true) {
  const rotation = (piece.rotation + (clockwise ? 1 : 3)) % 4;
  const matrix = rotatePiece(piece.matrix, clockwise);
  const offsets =
    piece.name === 'O'
      ? [[0, 0]]
      : (piece.name === 'I' ? LONG_KICKS : NORMAL_KICKS)[`${piece.rotation}>${rotation}`];
  for (const [dx, dy] of offsets) {
    const x = piece.x + dx,
      y = piece.y - dy;
    const path = (firstX) => {
      let px = piece.x,
        py = piece.y;
      for (const axis of firstX ? ['x', 'y'] : ['y', 'x']) {
        const n = axis === 'x' ? dx : -dy,
          step = Math.sign(n);
        for (let k = 0; k < Math.abs(n); k++) {
          if (axis === 'x') px += step;
          else py += step;
          if (!canPlace(board, piece.matrix, px, py)) return false;
        }
      }
      return true;
    };
    if (canPlace(board, matrix, x, y) && (path(true) || path(false)))
      return { ...piece, matrix, x, y, rotation };
  }
  return piece;
}
export function canPlace(board, matrix, px, py) {
  if (!Number.isInteger(px) || !Number.isInteger(py)) return false;
  return matrix.every((row, y) =>
    row.every(
      (value, x) =>
        !value ||
        (px + x >= 0 &&
          px + x < 10 &&
          py + y >= -2 &&
          py + y < 20 &&
          (py + y < 0 || !board[py + y][px + x])),
    ),
  );
}
export function clearRows(board) {
  const kept = board.filter((row) => row.some((value) => !value)).map((row) => row.slice());
  const count = board.length - kept.length;
  return { count, board: [...Array.from({ length: count }, () => Array(10).fill(0)), ...kept] };
}
