// Phase Tiles rules: influence shapes, board parsing and the exact solver. No drawing, no input.

export const RULES = Object.freeze({
  step: 1 / 120, // fixed simulation step, seconds
  maxDt: 0.1,
  cell: 36,
  maxCols: 7,
  maxRows: 6,
  maxNullity: 10, // the solver lists every optimal answer, so the answer space stays small
  settleWin: 0.6, // a matched board must hold still this long before it counts
  settleLose: 8, // an out-of-presses board shows a countdown this long, so a touch player can undo
  clearPause: 1.4,
  historyMax: 400,
  pressesMax: 999,
  msgTime: 1.6,
  clearScore: 100,
  extraPressPenalty: 8,
  hintFreeBoards: 7, // boards 1 to 7 always show the next move; later boards need the H key
  hintPenalty: 10, // score taken for each hint asked for on a board
  minBoardScore: 20,
  menuCols: 8,
});

// --- Influence shapes -----------------------------------------------------------------------
// A press adds one phase to every tile of the pressed tile's influence set. Letters are the codes
// used by board definitions: p plus, x diagonal X, o ring of eight, h whole row, v whole column,
// c row and column together, k knight jumps.
const OFFSETS = {
  p: [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  x: [
    [0, 0],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ],
  o: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ],
  k: [
    [0, 0],
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1],
  ],
};
export const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value))
    Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};

export const SHAPE_KEYS = Object.freeze(['p', 'x', 'o', 'h', 'v', 'c', 'k']);
export const SHAPE_NAMES = deepFreeze({
  p: ['plus', '十字'],
  x: ['diagonal X', '斜叉'],
  o: ['ring', '圆环'],
  h: ['row', '整行'],
  v: ['column', '整列'],
  c: ['row and column', '行列十字'],
  k: ['knight', '马步'],
});

// Every grid position a shape reaches from (x, y), holes not yet removed.
export function reach(shape, x, y, w, h) {
  const out = [];
  if (shape === 'h' || shape === 'c') for (let i = 0; i < w; i++) out.push([i, y]);
  if (shape === 'v' || shape === 'c')
    for (let j = 0; j < h; j++) if (shape === 'v' || j !== y) out.push([x, j]);
  for (const [dx, dy] of OFFSETS[shape] || []) out.push([x + dx, y + dy]);
  return out.filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < w && cy < h);
}

// --- Board parsing --------------------------------------------------------------------------
// Layout rows: '.' tile, 'L' locked tile (changed by neighbours, never pressed), '#' hole.
// Target rows: a phase digit per tile and '#' for each hole.
// The start is the target with the `scramble` presses taken back out: [x, y, count] triples.
// So every board is solvable by construction, and the solver finds its true minimum.

export function parseBoard(def) {
  const name = def.name[0];
  const { layout, target: targetRows, scramble } = def;
  const phases = def.phases ?? 2;
  if (phases !== 2 && phases !== 3) throw new Error(`Board ${name} needs 2 or 3 phases`);
  const w = layout[0].length;
  const h = layout.length;
  if (w > RULES.maxCols || h > RULES.maxRows) throw new Error(`Board ${name} is too large`);
  const shapeRows = Array.isArray(def.shape) ? def.shape : null;
  const cells = [];
  const target = [];
  layout.forEach((row, y) => {
    if (row.length !== w || targetRows[y]?.length !== w) throw new Error(`Board ${name} is ragged`);
    [...row].forEach((ch, x) => {
      if (!'.L#'.includes(ch)) throw new Error(`Unknown layout symbol "${ch}"`);
      const shape = shapeRows ? shapeRows[y][x] : def.shape;
      if (ch !== '#' && !SHAPE_KEYS.includes(shape)) throw new Error(`Unknown shape "${shape}"`);
      const digit = targetRows[y][x];
      if ((digit === '#') !== (ch === '#'))
        throw new Error(`Board ${name} target and holes differ`);
      const phase = ch === '#' ? 0 : Number(digit);
      if (!(phase >= 0 && phase < phases)) throw new Error(`Board ${name} has a bad target phase`);
      cells.push({ hole: ch === '#', locked: ch === 'L', shape: ch === '#' ? null : shape });
      target.push(phase);
    });
  });
  const influence = cells.map((c, i) =>
    c.hole
      ? []
      : reach(c.shape, i % w, Math.floor(i / w), w, h)
          .map(([x, y]) => y * w + x)
          .filter((j) => !cells[j].hole)
          .sort((a, b) => a - b),
  );
  const start = [...target];
  for (const [x, y, n] of scramble) {
    const i = y * w + x;
    if (!cells[i] || cells[i].hole || cells[i].locked)
      throw new Error(`Board ${name} scrambles ${x},${y}`);
    if (!(n >= 1 && n < phases)) throw new Error(`Board ${name} scramble count ${n}`);
    for (const j of influence[i]) start[j] = (start[j] + phases * 4 - n) % phases;
  }
  const board = {
    name: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    w,
    h,
    phases,
    cells,
    target,
    start,
    influence,
    scramble: scramble.map(([x, y, n]) => [x, y, n]),
    mixed: Boolean(shapeRows),
    slack: def.slack ?? null,
    optimal: 0,
    budget: null,
  };
  if (start.every((p, i) => p === target[i])) throw new Error(`Board ${name} starts solved`);
  const sol = solveFrom(board, start);
  if (!sol) throw new Error(`Board ${name} is unsolvable`);
  board.optimal = sol.cost;
  board.budget = board.slack === null ? null : sol.cost + board.slack;
  return deepFreeze(board);
}

// --- Solver ---------------------------------------------------------------------------------
// Over the prime field Z_p (p = 2 or 3) the presses form a linear system: press counts x_j, one
// equation per tile, "sum of x_j over the tiles whose influence reaches i = target_i - phase_i".
// The matrix is reduced once per board; every state then costs one multiplication, and the
// solutions are a particular answer plus the null space, listed in full to find the minimum.
const PREPARED = new WeakMap();
const MEMO_MAX = 20000;

function prepare(board) {
  const p = board.phases;
  const rows = [];
  board.cells.forEach((c, i) => c.hole || rows.push(i));
  const cols = rows.filter((i) => !board.cells[i].locked);
  const m = rows.length;
  const n = cols.length;
  const rowOf = new Map(rows.map((i, r) => [i, r]));
  const M = rows.map((_, r) => {
    const line = new Int8Array(n + m);
    line[n + r] = 1;
    return line;
  });
  cols.forEach((j, c) => board.influence[j].forEach((i) => (M[rowOf.get(i)][c] = 1)));
  const pivots = [];
  let rank = 0;
  for (let c = 0; c < n && rank < m; c++) {
    let r = rank;
    while (r < m && M[r][c] === 0) r++;
    if (r === m) continue;
    [M[r], M[rank]] = [M[rank], M[r]];
    const lead = M[rank][c]; // the inverse of 1 and of 2 modulo 2 or 3 is the number itself
    for (let k = 0; k < n + m; k++) M[rank][k] = (M[rank][k] * lead) % p;
    for (let q = 0; q < m; q++) {
      const f = M[q][c];
      if (q === rank || f === 0) continue;
      for (let k = 0; k < n + m; k++) M[q][k] = (((M[q][k] - f * M[rank][k]) % p) + p) % p;
    }
    pivots.push(c);
    rank++;
  }
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  if (free.length > RULES.maxNullity)
    throw new Error(`Board ${board.name.en} has too many answers`);
  const basis = free.map((f) => {
    const v = new Int8Array(n);
    v[f] = 1;
    pivots.forEach((c, r) => (v[c] = (p - M[r][f]) % p));
    return v;
  });
  return { rows, cols, m, n, M, rank, pivots, basis, memo: new Map() };
}

// The cheapest set of presses that turns `cells` into the target: its total, one answer, and
// the union of every cheapest answer's tiles (each of those lies on some shortest way to the
// target). Null when no presses can reach the target.
export function solveFrom(board, cells) {
  let pre = PREPARED.get(board);
  if (!pre) PREPARED.set(board, (pre = prepare(board)));
  const key = cells.join('');
  if (pre.memo.has(key)) return pre.memo.get(key);
  const p = board.phases;
  const { rows, cols, m, n, M, rank, pivots, basis } = pre;
  const delta = rows.map((i) => (board.target[i] - cells[i] + p) % p);
  const t = M.map((line) => {
    let sum = 0;
    for (let q = 0; q < m; q++) sum += line[n + q] * delta[q];
    return sum % p;
  });
  let result = null;
  if (t.slice(rank).every((v) => v === 0)) {
    const base = new Int8Array(n);
    pivots.forEach((c, r) => (base[c] = t[r]));
    let best = Infinity;
    let support = new Set();
    let vector = null;
    const trial = new Int8Array(n);
    const total = p ** basis.length;
    for (let code = 0; code < total; code++) {
      trial.set(base);
      let rest = code;
      for (const v of basis) {
        const coef = rest % p;
        rest = (rest - coef) / p;
        if (coef) for (let c = 0; c < n; c++) trial[c] = (trial[c] + coef * v[c]) % p;
      }
      let cost = 0;
      for (let c = 0; c < n; c++) cost += trial[c];
      if (cost > best) continue;
      if (cost < best) {
        best = cost;
        support = new Set();
        vector = Array(board.cells.length).fill(0);
        trial.forEach((x, c) => (vector[cols[c]] = x));
      }
      trial.forEach((x, c) => x && support.add(cols[c]));
    }
    result = {
      cost: best,
      vector,
      support: [...support].sort((a, b) => a - b),
      answers: total,
    };
  }
  if (pre.memo.size >= MEMO_MAX) pre.memo.clear();
  pre.memo.set(key, result);
  return result;
}

export const isMatched = (board, cells) => cells.every((v, i) => v === board.target[i]);
export const mismatches = (board, cells) => cells.filter((v, i) => v !== board.target[i]).length;
export const pressable = (board, i) => !board.cells[i].hole && !board.cells[i].locked;

// A press adds one phase to the whole influence set; undo takes it back out.
export function pressed(board, cells, i, step = 1) {
  const out = [...cells];
  for (const j of board.influence[i]) out[j] = (out[j] + step + board.phases) % board.phases;
  return out;
}

// --- Advice ---------------------------------------------------------------------------------
// The next useful action from the current phases: an undo when the presses left cannot cover the
// way home, otherwise the nearest tile that sits on a shortest way to the target.
export function advise(board, cells, cursor, pressesLeft, canUndo) {
  const sol = solveFrom(board, cells);
  if (sol.cost === 0) return { kind: 'done', cost: 0 };
  if (sol.cost > pressesLeft && canUndo) return { kind: 'undo', cost: sol.cost };
  let best = null;
  for (const i of sol.support) {
    const x = i % board.w;
    const y = Math.floor(i / board.w);
    const total = Math.abs(x - cursor.x) + Math.abs(y - cursor.y);
    if (!best || total < best.total) best = { i, x, y, total };
  }
  const dx = best.x - cursor.x;
  const dy = best.y - cursor.y;
  const dir = dx !== 0 ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
  return {
    kind: best.total ? 'move' : 'act',
    cost: sol.cost,
    i: best.i,
    x: best.x,
    y: best.y,
    dir,
    // The length of the first leg, along `dir`: the number the prompt shows beside its arrow.
    steps: dir % 2 === 0 ? Math.abs(dx) : Math.abs(dy),
  };
}
