// Circuit Weaver rules: ports, networks, shorts, leaks and the solver. No drawing, no input.

// Rules are exported read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 0.1,
  fuses: 3,
  clearPause: 1.1, // s the lit board is shown before the next one loads
  blowPause: 1.2, // s the blown fuse is shown before the board resets
  msgTime: 1.6,
  clearScore: 100,
  perfectScore: 30, // bonus for finishing in the optimal number of turns
  closeScore: 10, // bonus for finishing within two extra turns
  fuseScore: 10, // per fuse left
  maxScore: 99999,
  menuCols: 8,
  undoLimit: 200, // older turns drop off the undo stack
  tipTime: 6, // s a board's tip is shown while nothing has been turned
  hintFreeBoards: 7, // boards 1 to 7 always show the next move; later boards need the H key
  hintPenalty: 12, // score taken for each hint asked for on a board
  minBoardScore: 20, // a cleared board never scores less than this, whatever the hints cost
  inputBuffer: 6, // key presses kept from the lit and blown pauses
});

// --- Ports ---
// Directions run clockwise from north; a port is one bit of a 4-bit mask.
export const DIRS = Object.freeze(['N', 'E', 'S', 'W']);
export const DX = Object.freeze([0, 1, 0, -1]);
export const DY = Object.freeze([-1, 0, 1, 0]);
export const bit = (d) => 1 << d;
export const opposite = (d) => (d + 2) & 3;
export const ARROWS = ['↑', '→', '↓', '←'];

export function rotateMask(mask, turns) {
  let out = 0;
  for (let d = 0; d < 4; d++) if (mask & bit(d)) out |= bit((d + turns) & 3);
  return out;
}

// Base ports at rotation 0; `period` is how many presses return a tile to where it started.
export const TILE_TYPES = Object.freeze({
  empty: { base: 0, period: 1 },
  straight: { base: bit(0) | bit(2), period: 2 },
  corner: { base: bit(0) | bit(1), period: 4 },
  tee: { base: bit(3) | bit(0) | bit(1), period: 4 },
  cross: { base: 15, period: 1 },
  bridge: { base: 15, period: 1 }, // north-south and east-west tracks that never meet
  source: { base: 0, period: 1 },
  sink: { base: 0, period: 1 },
});

export function portMask(tile, rot) {
  if (tile.type === 'source' || tile.type === 'sink') return bit(tile.dir);
  const info = TILE_TYPES[tile.type];
  return rotateMask(info.base, rot % info.period);
}

export const isWire = (type) => type !== 'empty' && type !== 'source' && type !== 'sink';
export const canTurn = (tile) => !tile.locked && TILE_TYPES[tile.type].period > 1;
// A bridge keeps its two tracks apart: north/south use track 0, east/west track 1.
export const nodeOf = (board, i, d) => (board.cells[i].type === 'bridge' ? 2 * i + (d & 1) : 2 * i);

// --- Board parsing ---
// Tokens: . empty, I straight, L corner, T tee (a digit sets the start rotation, ! locks it),
// + cross, X bridge, S9E a 9 V source whose port faces east, K3W a lamp that wants 3 V (port west).
const TOKEN = /^(?:\.|[ILT]\d!?|\+|X|[SK]\d+[NESW])$/;

function parseToken(token) {
  if (!TOKEN.test(token)) throw new Error(`bad token ${token}`);
  if (token === '.') return { type: 'empty', rot: 0 };
  if (token === '+') return { type: 'cross', rot: 0 };
  if (token === 'X') return { type: 'bridge', rot: 0 };
  if (token[0] === 'S' || token[0] === 'K') {
    const dir = DIRS.indexOf(token.slice(-1));
    const volt = Number(token.slice(1, -1));
    return { type: token[0] === 'S' ? 'source' : 'sink', rot: 0, dir, volt };
  }
  const type = { I: 'straight', L: 'corner', T: 'tee' }[token[0]];
  return { type, rot: Number(token[1]) % TILE_TYPES[type].period, locked: token.endsWith('!') };
}

export function parseBoard(def) {
  const grid = def.rows.map((row) => row.trim().split(/\s+/).map(parseToken));
  const cols = grid[0].length;
  if (grid.some((row) => row.length !== cols)) throw new Error(`ragged board ${def.name[0]}`);
  const cells = grid.flat();
  const sources = [];
  const sinks = [];
  cells.forEach((cell, i) => {
    if (cell.type === 'source') sources.push(i);
    if (cell.type === 'sink') sinks.push(i);
  });
  const volts = [...new Set([...sources, ...sinks].map((i) => cells[i].volt))].sort(
    (a, b) => a - b,
  );
  return Object.freeze({
    name: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    cols,
    rows: grid.length,
    cells,
    start: cells.map((cell) => cell.rot),
    sources,
    sinks,
    volts,
    sealed: def.sealed !== false,
    budget: def.budget ?? null,
  });
}

// --- Analysis: connectivity by matching ports, shorts, leaks ---
export const popcount = (n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);

export function masksOf(board, rots) {
  return board.cells.map((cell, i) => portMask(cell, rots[i]));
}

// `known[i]` is 0 for cells a search has not decided yet; they are treated as absent but never
// counted as a mismatch, so a partial board can be pruned soundly.
const scratch = new WeakMap();

// A search probes thousands of partial boards, so it reuses one pair of buffers per board.
function buffersFor(board) {
  if (!scratch.has(board)) {
    const size = 2 * board.cols * board.rows;
    scratch.set(board, { parent: new Int32Array(size), volts: new Int32Array(size) });
  }
  return scratch.get(board);
}

function scan(board, mask, known, reuse = false) {
  const { cols, rows, cells } = board;
  const n = cols * rows;
  const buf = reuse ? buffersFor(board) : null;
  const parent = buf ? buf.parent : new Int32Array(2 * n);
  for (let k = 0; k < 2 * n; k++) parent[k] = k;
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = (i / cols) | 0;
    for (let d = 1; d <= 2; d++) {
      const nc = c + DX[d];
      const nr = r + DY[d];
      if (nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (known[i] && known[j] && mask[i] & bit(d) && mask[j] & bit(opposite(d)))
        parent[find(nodeOf(board, i, d))] = find(nodeOf(board, j, opposite(d)));
    }
  }
  const volts = buf ? buf.volts.fill(0) : new Int32Array(2 * n);
  for (const i of board.sources) volts[find(2 * i)] |= bit(board.volts.indexOf(cells[i].volt));
  return { parent, find, volts, n };
}

// A port is open when the cell it faces is off the board or has no port on the shared edge.
function openPort(board, mask, known, i, d) {
  const nc = (i % board.cols) + DX[d];
  const nr = ((i / board.cols) | 0) + DY[d];
  if (nc < 0 || nr < 0 || nc >= board.cols || nr >= board.rows) return true;
  const j = nr * board.cols + nc;
  return known[j] === 1 && !(mask[j] & bit(opposite(d)));
}

export function analyze(board, rots) {
  return evaluate(board, masksOf(board, rots));
}

function evaluate(board, mask) {
  const known = new Uint8Array(board.cells.length).fill(1);
  const net = scan(board, mask, known);
  const { find, volts } = net;
  const need = (i) => bit(board.volts.indexOf(board.cells[i].volt));
  const sinks = board.sinks.map((i) => {
    const v = volts[find(2 * i)];
    const status = v === need(i) ? 'ok' : v === 0 ? 'dead' : popcount(v) > 1 ? 'short' : 'wrong';
    return {
      index: i,
      c: i % board.cols,
      r: (i / board.cols) | 0,
      volt: board.cells[i].volt,
      status,
    };
  });
  const shortRoots = new Set();
  for (let k = 0; k < 2 * net.n; k++) if (popcount(volts[find(k)]) > 1) shortRoots.add(find(k));
  const leaks = [];
  board.cells.forEach((cell, i) => {
    if (!isWire(cell.type)) return;
    for (let d = 0; d < 4; d++)
      if (
        mask[i] & bit(d) &&
        volts[find(nodeOf(board, i, d))] &&
        openPort(board, mask, known, i, d)
      )
        leaks.push({ index: i, c: i % board.cols, r: (i / board.cols) | 0, dir: d });
  });
  const shorts = [...shortRoots].map((root) => ({
    root,
    volts: board.volts.filter((_, k) => volts[root] & bit(k)),
  }));
  const sinksOk = sinks.filter((s) => s.status === 'ok').length;
  const solved =
    sinksOk === sinks.length && shorts.length === 0 && (!board.sealed || leaks.length === 0);
  return { mask, net, sinks, sinksOk, shorts, shortRoots, leaks, solved };
}

// Which tiles belong to the network that touches cell `i` (both tracks for a bridge).
export function networkAt(board, an, i) {
  const { find, volts } = an.net;
  const tracks = [];
  for (let d = 0; d < (board.cells[i].type === 'bridge' ? 2 : 1); d++) {
    const root = find(2 * i + d);
    if (!an.mask[i]) continue;
    const tiles = [];
    for (let j = 0; j < board.cells.length; j++)
      for (let t = 0; t < 2; t++) if (find(2 * j + t) === root && an.mask[j]) tiles.push(j);
    const v = board.volts.filter((_, k) => volts[root] & bit(k));
    tracks.push({
      root,
      tiles: [...new Set(tiles)],
      volts: v,
      kind: v.length > 1 ? 'short' : v.length === 1 ? 'live' : 'idle',
    });
  }
  return tracks;
}

// --- Solver: fewest presses that satisfy the board from a given state ---
// The search only ever decides tiles that live current points at. A tile no live port faces is
// not part of any network, so leaving it as it is costs nothing and is always optimal; decoys
// therefore never widen the search.

// Can current of one voltage still get from the open ends of its networks to every lamp that
// wants it? Undecided tiles are assumed to turn whichever way helps; decided tiles keep their
// ports. If a lamp is out of reach no later choice can light it, so the branch is dead.
function reachable(board, mask, known, seeds, lit) {
  const { cells, cols, rows, sinks } = board;
  const seen = new Uint8Array(cells.length * 2);
  const reached = new Set();
  const queue = [];
  const enter = (j, d) => {
    const key = 2 * j + (cells[j].type === 'bridge' ? d & 1 : 0);
    if (seen[key]) return;
    seen[key] = 1;
    queue.push([j, d]);
  };
  for (const j of seeds) enter(j, -1);
  for (let q = 0; q < queue.length; q++) {
    const [x, from] = queue[q];
    for (let d = 0; d < 4; d++) {
      if (known[x] && !(mask[x] & bit(d))) continue;
      if (known[x] && cells[x].type === 'bridge' && from >= 0 && d !== opposite(from)) continue;
      if (known[x] && from >= 0 && d === from) continue;
      const nc = (x % cols) + DX[d];
      const nr = ((x / cols) | 0) + DY[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const y = nr * cols + nc;
      const cell = cells[y];
      if (cell.type === 'sink') {
        if (cell.dir === opposite(d)) reached.add(y);
      } else if (cell.type === 'empty' || cell.type === 'source') continue;
      else if (!known[y] || mask[y] & bit(opposite(d))) enter(y, opposite(d));
    }
  }
  return sinks.every((i) => lit.has(i) || reached.has(i));
}

// Returns -2 when the partial board already breaks a rule that more tiles can never repair,
// else the first undecided tile a live port points at (or -1 when there is none).
export function probe(board, mask, known) {
  const { find, volts } = scan(board, mask, known, true);
  const { cells, sinks, cols, rows } = board;
  for (let k = 0; k < volts.length; k++) if (popcount(volts[find(k)]) > 1) return -2;
  const lit = new Set();
  for (const i of sinks) {
    const v = volts[find(2 * i)];
    if (v && v !== bit(board.volts.indexOf(cells[i].volt))) return -2;
    if (known[i] && openPort(board, mask, known, i, cells[i].dir)) return -2;
    if (v) lit.add(i);
  }
  let pending = -1;
  const seeds = board.volts.map(() => []);
  for (let i = 0; i < cells.length; i++) {
    if (!known[i] || cells[i].type === 'empty') continue;
    for (let d = 0; d < 4; d++) {
      if (!(mask[i] & bit(d)) || !volts[find(nodeOf(board, i, d))]) continue;
      const nc = (i % cols) + DX[d];
      const nr = ((i / cols) | 0) + DY[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) {
        if (board.sealed && isWire(cells[i].type)) return -2;
        continue;
      }
      const j = nr * cols + nc;
      if (!known[j]) {
        if (pending < 0) pending = j;
        seeds[Math.log2(volts[find(nodeOf(board, i, d))])].push(j);
      } else if (board.sealed && isWire(cells[i].type) && !(mask[j] & bit(opposite(d)))) return -2;
    }
  }
  for (let k = 0; k < seeds.length; k++) {
    const wanting = new Set(sinks.filter((i) => board.volts.indexOf(cells[i].volt) !== k));
    if (!reachable(board, mask, known, seeds[k], new Set([...lit, ...wanting]))) return -2;
  }
  return pending;
}

// Returns {cost, target} for the cheapest solution reachable by turning tiles clockwise from
// `rots`, or null if none exists. Ties keep the first solution found, so the answer is stable.
export function solve(board, rots, maxNodes = Infinity) {
  const { cells } = board;
  const mask = masksOf(board, rots);
  const known = new Uint8Array(cells.length);
  cells.forEach((cell, i) => {
    if (!canTurn(cell)) known[i] = 1;
  });
  const target = rots.slice();
  let best = Infinity;
  let bestTarget = null;
  let nodes = 0;
  const visit = (i, cost) => {
    if (++nodes > maxNodes) throw new Error('search limit');
    const info = TILE_TYPES[cells[i].type];
    const was = mask[i];
    known[i] = 1;
    for (let press = 0; press < info.period && cost + press < best; press++) {
      const rot = (rots[i] + press) % info.period;
      mask[i] = rotateMask(info.base, rot);
      target[i] = rot;
      const next = probe(board, mask, known);
      if (next >= 0) visit(next, cost + press);
      else if (next === -1 && evaluate(board, mask).solved) {
        best = cost + press;
        bestTarget = target.slice();
      }
    }
    known[i] = 0;
    mask[i] = was;
    target[i] = rots[i];
  };
  const first = probe(board, mask, known);
  if (first >= 0) visit(first, 0);
  else if (first === -1 && evaluate(board, mask).solved) return { cost: 0, target };
  return bestTarget ? { cost: best, target: bestTarget } : null;
}

export const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

for (const info of Object.values(TILE_TYPES)) Object.freeze(info);
