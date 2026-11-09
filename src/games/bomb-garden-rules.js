// Shared geometry and blast rules for Bomb Garden. Pure data and functions: no game state.
export const COLS = 15,
  ROWS = 9,
  CELL = 30,
  OX = 15,
  OY = 42;
export const DIRS = Object.freeze(
  [
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 0],
  ].map((d) => Object.freeze(d)),
);
export const FUSE = 2.4,
  WET_FUSE = 3,
  FRONT_STEP = 0.045,
  ACTIVE = 0.3,
  EMBER = 0.18,
  BARREL_DELAY = 0.18,
  BARREL_RANGE = 2,
  PLAYER_SPEED = 0.15,
  RADIUS = 0.27;

// Board cell codes.
export const FLOOR = 0,
  WALL = 1,
  CRATE = 2,
  BARREL = 3;

export const key = (x, y) => `${x},${y}`;

/** Walls absorb blasts; a destructible crate or barrel is included and then stops the ray. */
export function blastCells(board, x, y, range) {
  const cells = [[x, y]];
  for (const [dx, dy] of DIRS)
    for (let n = 1; n <= range; n++) {
      const nx = x + dx * n,
        ny = y + dy * n;
      if (!board[ny] || board[ny][nx] === undefined || board[ny][nx] === WALL) break;
      cells.push([nx, ny]);
      if (board[ny][nx] === CRATE || board[ny][nx] === BARREL) break;
    }
  return cells;
}

/**
 * A charge's whole footprint: the direct cross plus the crosses of every compost barrel the
 * jets reach, barrel after barrel. Crates the first jets break stop shielding the barrel jets.
 * `chained` lists only the cells the direct cross does not already cover.
 */
export function blastPlan(board, x, y, range) {
  const terrain = board.map((row) => [...row]),
    cells = blastCells(terrain, x, y, range),
    shown = new Set(cells.map(([a, b]) => key(a, b))),
    chained = [],
    pending = [];
  const strike = (list, into) => {
    for (const [a, b] of list) {
      if (terrain[b][a] === BARREL) pending.push([a, b]);
      if (into && !shown.has(key(a, b))) {
        shown.add(key(a, b));
        into.push([a, b]);
      }
    }
    for (const [a, b] of list) if (terrain[b][a] === CRATE) terrain[b][a] = FLOOR;
  };
  strike(cells, null);
  while (pending.length) {
    const [bx, by] = pending.shift();
    if (terrain[by][bx] !== BARREL) continue;
    terrain[by][bx] = FLOOR;
    strike(blastCells(terrain, bx, by, BARREL_RANGE), chained);
  }
  return { cells, chained };
}

/** Every cell a charge can burn, direct and chained, as a flat list. */
export const blastReach = (board, x, y, range) => {
  const plan = blastPlan(board, x, y, range);
  return [...plan.cells, ...plan.chained];
};

/** Cells a travelling jet front will still cover, plus what any barrel on its path adds. */
export function frontReach(board, f) {
  const cells = [];
  for (let n = 0; n < f.remaining; n++) {
    const x = f.x + f.dx * n,
      y = f.y + f.dy * n;
    if (board[y]?.[x] === undefined || board[y][x] === WALL) break;
    cells.push([x, y]);
    if (board[y][x] === BARREL) cells.push(...blastReach(board, x, y, BARREL_RANGE));
    if (board[y][x] >= CRATE) break;
  }
  return cells;
}

/** Steps to every floor cell reachable on foot from x,y (crates, barrels and walls block). */
export function walkingDistances(board, x, y) {
  const distance = new Map([[key(x, y), 0]]),
    queue = [[x, y]];
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (board[ny]?.[nx] !== FLOOR || distance.has(key(nx, ny))) continue;
      distance.set(key(nx, ny), distance.get(key(cx, cy)) + 1);
      queue.push([nx, ny]);
    }
  }
  return distance;
}

// Garden select screen: a grid of numbered tiles (shared by hit testing and drawing).
export const MENU = Object.freeze({ cols: 6, x0: 10, y0: 36, w: 70, h: 44, gapX: 8, gapY: 6 });
export const menuCell = (n) => ({
  x: MENU.x0 + ((n - 1) % MENU.cols) * (MENU.w + MENU.gapX),
  y: MENU.y0 + Math.floor((n - 1) / MENU.cols) * (MENU.h + MENU.gapY),
  w: MENU.w,
  h: MENU.h,
});
/** The 1-based tile under a point, or 0 when the point misses every tile. */
export function menuHit(x, y, count) {
  for (let n = 1; n <= count; n++) {
    const q = menuCell(n);
    if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) return n;
  }
  return 0;
}
