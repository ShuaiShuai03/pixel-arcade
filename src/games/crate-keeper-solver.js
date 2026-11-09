// Crate Keeper rules and solver: grid parsing, legal moves, dead squares and a push-optimal search.
export const DIRECTIONS = Object.freeze(
  [
    ['ArrowLeft', -1, 0],
    ['ArrowRight', 1, 0],
    ['ArrowUp', 0, -1],
    ['ArrowDown', 0, 1],
  ].map((d) => Object.freeze(d)),
);

export function parseLevel(rows) {
  const w = Math.max(...rows.map((r) => r.length)),
    h = rows.length,
    walls = [],
    goals = [],
    crates = [];
  let player = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] ?? '#',
        i = y * w + x;
      if (c === '#') walls.push(i);
      if (c === '.' || c === '*' || c === '+') goals.push(i);
      if (c === '$' || c === '*') crates.push(i);
      if (c === '@' || c === '+') player = i;
    }
  return { w, h, walls, goals, crates: crates.sort((a, b) => a - b), player };
}

export function adjacent(s, index, dx, dy) {
  const x = (index % s.w) + dx,
    y = Math.floor(index / s.w) + dy;
  return x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : y * s.w + x;
}

export const cellPoint = (s, index) => ({ x: index % s.w, y: Math.floor(index / s.w) });

/** One walking step. A crate in the way moves too if the square behind it is free. */
export function moveState(state, dx, dy) {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1)
    return state;
  const next = adjacent(state, state.player, dx, dy);
  if (next < 0 || state.walls.includes(next)) return state;
  const idx = state.crates.indexOf(next);
  let crates = state.crates;
  if (idx >= 0) {
    const target = adjacent(state, next, dx, dy);
    if (target < 0 || state.walls.includes(target) || state.crates.includes(target)) return state;
    crates = state.crates.slice();
    crates[idx] = target;
    crates.sort((a, b) => a - b);
  }
  return { ...state, player: next, crates };
}

/** Reverse pushes ignore other crates: exclusion proves a square cannot reach any goal. */
export function deadSquares(s) {
  const walls = new Set(s.walls),
    good = new Set(s.goals),
    queue = s.goals.slice();
  for (let i = 0; i < queue.length; i++)
    for (const [, dx, dy] of DIRECTIONS) {
      const from = adjacent(s, queue[i], -dx, -dy),
        behind = from < 0 ? -1 : adjacent(s, from, -dx, -dy);
      if (from >= 0 && behind >= 0 && !walls.has(from) && !walls.has(behind) && !good.has(from)) {
        good.add(from);
        queue.push(from);
      }
    }
  return Array.from({ length: s.w * s.h }, (_, n) => n).filter(
    (n) => !walls.has(n) && !good.has(n),
  );
}

/** Every square the player can walk to, with the key path that gets there. */
export function reach(s) {
  const blocked = new Set([...s.walls, ...s.crates]),
    paths = new Map([[s.player, []]]),
    queue = [s.player];
  for (let i = 0; i < queue.length; i++)
    for (const [key, dx, dy] of DIRECTIONS) {
      const n = adjacent(s, queue[i], dx, dy);
      if (n >= 0 && !blocked.has(n) && !paths.has(n)) {
        paths.set(n, [...paths.get(queue[i]), key]);
        queue.push(n);
      }
    }
  return paths;
}

/** Shortest key path that walks the player to `target` without pushing a crate, or null. */
export const walkPath = (s, target) => reach(s).get(target) ?? null;

const keysOf = (node) => (node.parent ? [...keysOf(node.parent), ...node.segment] : []);

/** Breadth-first over pushes, so a solved result has the fewest possible pushes. */
export function searchLevel(level, maxNodes = 80000) {
  const start = Array.isArray(level) ? parseLevel(level) : level,
    dead = new Set(deadSquares(start)),
    queue = [{ state: start, parent: null, segment: [], pushes: 0 }],
    seen = new Set();
  let head = 0;
  for (; head < queue.length && head < maxNodes; head++) {
    const node = queue[head],
      { state } = node;
    if (state.crates.every((c) => state.goals.includes(c)))
      return { status: 'solved', path: keysOf(node), pushes: node.pushes, nodes: head + 1 };
    if (state.crates.some((c) => dead.has(c))) continue;
    const paths = reach(state),
      signature = state.crates.join(',') + '|' + Math.min(...paths.keys());
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const crate of state.crates)
      for (const [key, dx, dy] of DIRECTIONS) {
        const behind = adjacent(state, crate, -dx, -dy),
          to = adjacent(state, crate, dx, dy);
        if (
          to < 0 ||
          !paths.has(behind) ||
          state.walls.includes(to) ||
          state.crates.includes(to) ||
          dead.has(to)
        )
          continue;
        queue.push({
          state: {
            ...state,
            player: crate,
            crates: state.crates.map((c) => (c === crate ? to : c)).sort((a, b) => a - b),
          },
          parent: node,
          segment: [...paths.get(behind), key],
          pushes: node.pushes + 1,
        });
      }
  }
  return {
    status: head >= queue.length ? 'no-route' : 'limited',
    path: null,
    pushes: null,
    nodes: head,
  };
}

export function solveLevel(level, maxNodes = 80000) {
  return searchLevel(level, maxNodes).path;
}
