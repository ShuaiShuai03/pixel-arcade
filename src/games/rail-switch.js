import { background, drawPixelText as text, clamp } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'rail-switch',
  name: { en: 'Rail Switch', zh: '铁轨调度' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Run a rail yard through 20 timetables. Trains leave their portals on schedule and each must reach the platform that shows its own colour and cargo symbol. Arrow keys select a junction, Space flips it (a junction is locked while a train is on it) and X previews the route of the next train. Set the points before the train arrives: a train sent to the wrong platform, two trains meeting head-on or on a crossing, or a fast train catching a slow one each cost a strike, and the third strike ends the timetable. Deliver the quota to clear a timetable: Spare shows how many more trains you can still lose, and every strike is explained on screen. A train that circles a loop for more than 2 minutes is written off as late and costs a strike too. Loops, passing loops, timed signals and express trains join in later. You can also tap a junction: once to select it, again to flip it.',
    zh: '在 20 张时刻表里调度铁路编组场。列车按时刻表从入口出发，必须开到标有自己颜色和货物符号的站台。方向键选择道岔，空格扳动道岔（有列车在上面时道岔会锁定），X 键预览下一列车的路线。要在列车到达前扳好道岔：开错站台、两列车迎面相撞或在交叉口相撞、快车追尾慢车，每次都扣一次失误，三次失误则本张时刻表失败。送达指定数量即可过关：屏幕上的“余量”表示还能损失几列车，每次失误都会说明原因。列车在环线上绕行超过 2 分钟会被撤销，同样扣一次失误。后面会出现环线、会让线、定时信号灯和特快列车。也可以直接点按道岔：点一次选中，再点一次扳动。',
  },
  keys: [
    { label: { en: 'Select a junction', zh: '选择道岔' }, keys: 'Arrows / WASD' },
    { label: { en: 'Flip the selected junction', zh: '扳动选中的道岔' }, keys: 'Space' },
    { label: { en: 'Preview the next train route', zh: '预览下一列车路线' }, keys: 'X' },
    { label: { en: 'Pause', zh: '暂停' }, keys: 'P' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Flip', '扳道', 'right'],
    ['KeyX', 'Route', '路线', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 1 / 30,
  cols: 30,
  rows: 16,
  tile: 16,
  top: 32,
  bottom: 288,
  lives: 3,
  speeds: Object.freeze({ s: 1.0, n: 1.6, x: 2.5 }),
  hitDist: 0.3,
  brakeGap: 0.9,
  portalClear: 1.3,
  spawnSpan: 3,
  jitter: 0.25,
  jitterGap: 1,
  jitterTries: 10,
  lateWarn: 30,
  strikeMsgTime: 3,
  stopU: 0.45,
  lockRadius: 0.55,
  transit: 120,
  horizon: 9,
  promptHold: 0.5,
  clearTime: 2,
  introTime: 4.5,
  msgTime: 1.2,
  wreckTime: 1.2,
  ghostStep: 1 / 40,
  planSpan: 400,
  planSlip: 0.1,
  menuCols: 5,
  tapReach: 1.2,
  scoreDeliver: 100,
  scoreExpress: 50,
  scoreClear: 200,
  scoreLife: 100,
});
const STEP = RULES.step;
const COLS = RULES.cols;
const ROWS = RULES.rows;
const TILE = RULES.tile;

// Directions: 0 north, 1 east, 2 south, 3 west.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const ARROW = ['↑', '→', '↓', '←'];
export const PRESS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const DIR_NAME = 'NESW';

// Platform digit n shows colour n and cargo symbol n; a train's colour is its destination's.
const KINDS = [
  { en: 'red', zh: '红色', hex: '#e5484d' },
  { en: 'blue', zh: '蓝色', hex: '#4c8dff' },
  { en: 'green', zh: '绿色', hex: '#3fb950' },
  { en: 'yellow', zh: '黄色', hex: '#f2c94c' },
  { en: 'purple', zh: '紫色', hex: '#a678f0' },
  { en: 'orange', zh: '橙色', hex: '#f0883e' },
];
const CARGO = [
  ['#####', '#####', '#####', '#####', '#####'],
  ['.###.', '#####', '#####', '#####', '.###.'],
  ['..#..', '.###.', '.###.', '#####', '#####'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  ['..#..', '..#..', '#####', '..#..', '..#..'],
  ['#.#.#', '.###.', '#####', '.###.', '#.#.#'],
];

// --- Level compilation (pure, exported for tests) ---

const ACCEPT = { '-': 10, '=': 10, '|': 5, '!': 5, '+': 15, F: 6, 7: 12, L: 3, J: 9 };
const kindOf = (ch) =>
  '-|=!FLJ7'.includes(ch)
    ? 'track'
    : ch === '+'
      ? 'cross'
      : /[a-f]/.test(ch)
        ? 'portal'
        : /[1-6]/.test(ch)
          ? 'platform'
          : /[A-Z]/.test(ch)
            ? 'switch'
            : /[g-z]/.test(ch)
              ? 'merge'
              : null;
const accepts = (ch) => (ch in ACCEPT ? ACCEPT[ch] : kindOf(ch) ? 15 : undefined);
const ARMS = { track: 2, cross: 4, switch: 3, merge: 3, portal: 1, platform: 1 };

// Each junction letter sits in an empty cell diagonal to its junction so the rails stay visible.
const DIAGONALS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
export function labelCells(tiles, junctions) {
  const used = new Set();
  return junctions.map((j) => {
    for (const [dx, dy] of DIAGONALS) {
      const x = j.x + dx;
      const y = j.y + dy;
      const cell = y * COLS + x;
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS || tiles[cell] || used.has(cell)) continue;
      used.add(cell);
      return { x, y };
    }
    return { x: j.x, y: j.y };
  });
}

export function compileLevel(def, index = 0) {
  const fail = (m) => {
    throw new Error(`level ${index + 1}: ${m}`);
  };
  const map = def.map;
  if (map.length !== ROWS || map.some((r) => r.length !== COLS)) fail('map must be 30 x 16');
  const tiles = new Array(COLS * ROWS).fill(null);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const ch = map[y][x];
      if (ch === '.') continue;
      const mask = accepts(ch);
      if (mask === undefined) fail(`unknown tile ${ch}`);
      const arms = [-1, -1, -1, -1];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || !(mask & (1 << d))) continue;
        const other = accepts(map[ny][nx]);
        if (other !== undefined && other & (1 << ((d + 2) % 4))) arms[d] = ny * COLS + nx;
      }
      const kind = kindOf(ch);
      const count = arms.filter((a) => a >= 0).length;
      if (count !== ARMS[kind]) fail(`tile ${ch} at ${x},${y} has ${count} connections`);
      tiles[y * COLS + x] = { ch, kind, x, y, cell: y * COLS + x, arms, stem: -1, br: [] };
    }
  const junctions = [];
  const jAt = new Int16Array(COLS * ROWS).fill(-1);
  const sigAt = new Int16Array(COLS * ROWS).fill(-1);
  const sigs = [];
  const portals = {};
  const platforms = {};
  for (const t of tiles) {
    if (!t) continue;
    if (t.kind === 'switch' || t.kind === 'merge') {
      const stem = DIR_NAME.indexOf(def.stem?.[t.ch]);
      if (stem < 0 || t.arms[stem] < 0) fail(`junction ${t.ch} needs a stem on a connected side`);
      t.stem = stem;
      t.br = [0, 1, 2, 3].filter((d) => d !== stem && t.arms[d] >= 0);
      if (t.kind === 'switch') {
        if (junctions.some((j) => j.id === t.ch)) fail(`junction ${t.ch} appears twice`);
        jAt[t.cell] = junctions.length;
        junctions.push({
          id: t.ch,
          cell: t.cell,
          x: t.x,
          y: t.y,
          stem,
          br: t.br,
          init: def.init?.[t.ch] ?? 0,
        });
      }
    } else if (t.ch === '=' || t.ch === '!') {
      const sg = def.sig?.[sigs.length];
      if (!sg) fail('a signal tile has no timing');
      sigAt[t.cell] = sigs.length;
      sigs.push({ cell: t.cell, x: t.x, y: t.y, period: sg[0], green: sg[1], offset: sg[2] });
    } else if (t.kind === 'portal' || t.kind === 'platform') {
      const book = t.kind === 'portal' ? portals : platforms;
      if (book[t.ch] !== undefined) fail(`${t.kind} ${t.ch} appears twice`);
      book[t.ch] = t.cell;
    }
  }
  if (sigs.length !== (def.sig?.length ?? 0)) fail('signal timings do not match signal tiles');
  const trains = def.trains
    .map(([t, p, d, k, need = ''], i) => {
      if (portals[p] === undefined || platforms[d] === undefined)
        fail(`train ${i} has no route ends`);
      const needs = {};
      for (const m of need.matchAll(/([A-Z]):([01]+)/g)) {
        const ji = junctions.findIndex((j) => j.id === m[1]);
        if (ji < 0) fail(`train ${i} uses unknown junction ${m[1]}`);
        needs[ji] = m[2];
      }
      return {
        t,
        portal: portals[p],
        dest: d,
        ci: Number(d) - 1,
        k,
        speed: RULES.speeds[k],
        need: needs,
        order: i,
      };
    })
    .sort((a, b) => a.t - b.t || a.order - b.order);
  return {
    name: def.name,
    tip: def.tip,
    tiles,
    junctions,
    labels: labelCells(tiles, junctions),
    jAt,
    sigAt,
    sigs,
    portals,
    platforms,
    trains,
    quota: def.quota ?? Math.max(1, trains.length - 2),
    cx: Float64Array.from({ length: COLS * ROWS }, (_, c) => (c % COLS) + 0.5),
    cy: Float64Array.from({ length: COLS * ROWS }, (_, c) => Math.floor(c / COLS) + 0.5),
  };
}

// --- Selection graph ---

// The junction one arrow press away from `from` in direction `dir` (-1 when none lies that way).
export function neighbourJunction(js, from, dir) {
  const a = js[from];
  let best = -1;
  let bestCost = Infinity;
  js.forEach((b, i) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = dir === 0 ? -dy : dir === 1 ? dx : dir === 2 ? dy : -dx;
    if (i === from || along <= 0) return;
    const cost = along + 2 * (dir % 2 === 0 ? Math.abs(dx) : Math.abs(dy));
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  });
  return best;
}

// First arrow (0-3) of a shortest selection path, or -1 when already there or unreachable.
export function selectStep(js, from, to) {
  if (from === to) return -1;
  const first = new Array(js.length).fill(-2);
  first[from] = -1;
  const queue = [from];
  for (let q = 0; q < queue.length; q++)
    for (let d = 0; d < 4; d++) {
      const n = neighbourJunction(js, queue[q], d);
      if (n < 0 || first[n] !== -2) continue;
      first[n] = queue[q] === from ? d : first[queue[q]];
      queue.push(n);
    }
  return first[to] >= 0 ? first[to] : -1;
}

// --- World simulation (shared by the game and by the dispatcher's look-ahead) ---

const dirBetween = (a, b) => {
  const d = b - a;
  return d === -COLS ? 0 : d === 1 ? 1 : d === COLS ? 2 : 3;
};
const signalGreen = (sg, t) => (t + sg.offset) % sg.period < sg.green;

function newWorld(L, timetable = L.trains) {
  return {
    L,
    t: 0,
    sw: L.junctions.map((j) => j.init),
    trains: timetable.map((d, i) => ({
      i,
      d,
      st: 'wait',
      f: -1,
      to: -1,
      pv: -1,
      u: 0,
      halted: false,
      held: false,
      hold: -1,
      spawnT: 0,
      pc: L.junctions.map(() => 0),
      s: new Float64Array(6),
    })),
  };
}

function ghostOf(w) {
  return {
    L: w.L,
    t: w.t,
    sw: w.sw,
    rec: [],
    spawn: [],
    trains: w.trains.map((tr) => ({ ...tr, pc: [...tr.pc], s: Float64Array.from(tr.s) })),
  };
}

// Samples of a running train at head, 0.25 and 0.5 tiles behind it, in tile units.
function sample(L, tr) {
  const at = (d, k) => {
    const near = d <= tr.u;
    const a = near ? tr.f : tr.pv;
    const b = near ? tr.to : tr.f;
    const k2 = near ? tr.u - d : 1 - (d - tr.u);
    tr.s[k] = L.cx[a] + (L.cx[b] - L.cx[a]) * k2;
    tr.s[k + 1] = L.cy[a] + (L.cy[b] - L.cy[a]) * k2;
  };
  at(0, 0);
  at(0.25, 2);
  at(0.5, 4);
}

const nearPoint = (tr, x, y, r) => {
  for (let k = 0; k < 6; k += 2) if (Math.hypot(tr.s[k] - x, tr.s[k + 1] - y) < r) return true;
  return false;
};

// True when train `o` is heading towards the portal at (x, y) and would meet a train that leaves it
// at `speed` before that train has cleared the first stretch of track.
function oncoming(L, o, x, y, speed) {
  const hx = L.cx[o.to] - L.cx[o.f];
  const hy = L.cy[o.to] - L.cy[o.f];
  const dx = x - o.s[0];
  const dy = y - o.s[1];
  if (hx * dx + hy * dy <= 0 || Math.abs(hx * dy - hy * dx) > 0.5) return false;
  return Math.hypot(dx, dy) < RULES.portalClear + (o.d.speed * RULES.spawnSpan) / speed;
}

function trySpawn(w, tr) {
  const L = w.L;
  if (w.t + 1e-9 < tr.d.t) return false;
  if (w.trains.some((o) => o.i < tr.i && o.st === 'wait' && o.d.portal === tr.d.portal))
    return false;
  const x = L.cx[tr.d.portal];
  const y = L.cy[tr.d.portal];
  if (w.trains.some((o) => o.st === 'run' && nearPoint(o, x, y, RULES.portalClear))) return false;
  if (w.trains.some((o) => o.st === 'run' && oncoming(L, o, x, y, tr.d.speed))) return false;
  const tile = L.tiles[tr.d.portal];
  tr.st = 'run';
  tr.f = tr.d.portal;
  tr.pv = tr.f;
  tr.to = tile.arms.find((a) => a >= 0);
  tr.u = 0.5;
  tr.spawnT = w.t;
  if (w.spawn) w.spawn[tr.i] = w.t;
  sample(L, tr);
  return true;
}

// The exit direction of a tile for a train that entered through side `entry`.
function exitDir(tile, entry, pick) {
  if (tile.kind === 'cross') return (entry + 2) % 4;
  if (tile.kind === 'track') return tile.arms.findIndex((a, d) => a >= 0 && d !== entry);
  return entry === tile.stem ? tile.br[tile.kind === 'merge' ? 0 : pick()] : tile.stem;
}

function finish(tr, kind, log) {
  tr.st = 'done';
  log?.push({ k: kind, tr: tr.i });
}

function arrive(w, tr, log) {
  const L = w.L;
  const c = tr.to;
  const tile = L.tiles[c];
  const entry = (dirBetween(tr.f, c) + 2) % 4;
  tr.pv = tr.f;
  tr.f = c;
  if (tile.kind === 'platform' || tile.kind === 'portal') {
    finish(tr, tile.ch === String(tr.d.dest) ? 'deliver' : 'wrong', log);
    return;
  }
  const ji = L.jAt[c];
  const pick = () => {
    const seq = tr.d.need[ji];
    const pass = tr.pc[ji];
    const b = w.rec && seq ? Number(seq[Math.min(pass, seq.length - 1)]) : w.sw[ji];
    w.rec?.push({ j: ji, tr: tr.i, n: pass, eta: w.t, need: b });
    tr.pc[ji] = pass + 1;
    return b;
  };
  tr.to = tile.arms[exitDir(tile, entry, pick)];
}

function blockedAhead(w, tr) {
  const L = w.L;
  const ux = L.cx[tr.to] - L.cx[tr.f];
  const uy = L.cy[tr.to] - L.cy[tr.f];
  for (const o of w.trains) {
    if (o === tr || o.st !== 'run' || !o.halted) continue;
    for (let k = 0; k < 6; k += 2) {
      const qx = o.s[k] - tr.s[0];
      const qy = o.s[k + 1] - tr.s[1];
      const along = qx * ux + qy * uy;
      if (along > 0 && along < RULES.brakeGap && Math.abs(qx * uy - qy * ux) < 0.3) return true;
    }
  }
  return false;
}

function moveTrain(w, tr, dt, log) {
  const L = w.L;
  const sg = L.sigAt[tr.to];
  const red = sg >= 0 && !signalGreen(L.sigs[sg], w.t);
  tr.halted = false;
  if (red && (tr.u < RULES.stopU || tr.hold === tr.to)) {
    tr.u = Math.min(tr.u + tr.d.speed * dt, RULES.stopU);
    tr.hold = tr.to;
    tr.halted = tr.u >= RULES.stopU;
  } else if (blockedAhead(w, tr)) {
    tr.halted = true;
  } else {
    tr.hold = -1;
    tr.u += tr.d.speed * dt;
    while (tr.u >= 1 && tr.st === 'run') {
      tr.u -= 1;
      arrive(w, tr, log);
    }
  }
  if (tr.st === 'run') sample(L, tr);
}

function locked(w, ji) {
  const j = w.L.junctions[ji];
  return w.trains.some(
    (tr) => tr.st === 'run' && nearPoint(tr, j.x + 0.5, j.y + 0.5, RULES.lockRadius),
  );
}

function collide(w, a, b, log) {
  const L = w.L;
  const ha = [L.cx[a.to] - L.cx[a.f], L.cy[a.to] - L.cy[a.f]];
  const hb = [L.cx[b.to] - L.cx[b.f], L.cy[b.to] - L.cy[b.f]];
  const dot = ha[0] * hb[0] + ha[1] * hb[1];
  a.st = 'done';
  b.st = 'done';
  log.push({
    k: 'crash',
    tr: a.i,
    other: b.i,
    type: dot <= -0.5 ? 'head-on' : dot >= 0.5 ? 'rear-end' : 'side',
    x: (a.s[0] + b.s[0]) / 2,
    y: (a.s[1] + b.s[1]) / 2,
  });
}

function collisions(w, log) {
  const live = w.trains.filter((tr) => tr.st === 'run');
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.st !== 'run' || b.st !== 'run') continue;
      let hit = false;
      for (let p = 0; p < 6 && !hit; p += 2)
        for (let q = 0; q < 6 && !hit; q += 2)
          hit = Math.hypot(a.s[p] - b.s[q], a.s[p + 1] - b.s[q + 1]) < RULES.hitDist;
      if (hit) collide(w, a, b, log);
    }
}

function stepWorld(w, dt, real, log) {
  w.t += dt;
  for (const tr of w.trains) {
    if (tr.st === 'wait') {
      tr.held = w.t + 1e-9 >= tr.d.t;
      if (!trySpawn(w, tr)) continue;
      log?.push({ k: 'spawn', tr: tr.i });
    }
    if (tr.st !== 'run') continue;
    if (real && w.t - tr.spawnT > RULES.transit) {
      finish(tr, 'late', log);
      continue;
    }
    moveTrain(w, tr, dt, log);
  }
  if (real) collisions(w, log);
}

// The dispatcher's plan: when every unfinished train will reach each facing junction and which
// setting it needs there, found by running the same simulation ahead on the authored routes.
function buildPlan(w) {
  const g = ghostOf(w);
  const end = g.t + RULES.planSpan;
  while (g.t < end && g.trains.some((tr) => tr.st === 'wait' || tr.st === 'run'))
    stepWorld(g, RULES.ghostStep, false, null);
  return { events: g.rec.sort((a, b) => a.eta - b.eta), spawn: g.spawn };
}

const alive = (tr) => tr.st === 'wait' || tr.st === 'run';
const pending = (w, e) => alive(w.trains[e.tr]) && w.trains[e.tr].pc[e.j] <= e.n;

// The most urgent junction that must be flipped now: the next train to use it needs the other
// setting and nothing is on it. Later trains never trigger an early flip.
function nextAction(w, plan) {
  const seen = new Set();
  for (const e of plan.events) {
    if (e.eta - w.t > RULES.horizon) break;
    if (!pending(w, e) || seen.has(e.j)) continue;
    seen.add(e.j);
    if (w.sw[e.j] !== e.need && !locked(w, e.j)) return e;
  }
  return null;
}

// Cells a train will visit on its authored route, for the route preview.
function traceRoute(w, tr) {
  const L = w.L;
  const waiting = tr.st === 'wait';
  const pc = [...tr.pc];
  let from = waiting ? tr.d.portal : tr.f;
  let at = waiting ? L.tiles[from].arms.find((a) => a >= 0) : tr.to;
  const cells = [];
  for (let n = 0; n < 400; n++) {
    cells.push(at);
    const tile = L.tiles[at];
    if (tile.kind === 'platform' || tile.kind === 'portal') break;
    const ji = L.jAt[at];
    const seq = tr.d.need[ji];
    const pick = () => (seq ? Number(seq[Math.min(pc[ji]++, seq.length - 1)]) : w.sw[ji]);
    const next = tile.arms[exitDir(tile, (dirBetween(from, at) + 2) % 4, pick)];
    from = at;
    at = next;
  }
  return cells;
}

// --- Game state ---

// A host's saved progress; anything malformed counts as no saved progress.
function savedLevel(progress) {
  try {
    return Math.floor(Number(progress.unlocked()));
  } catch {
    return NaN;
  }
}

function saveLevel(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}

export function newState(env = {}, levels = BUILT) {
  const s = {
    levels,
    phase: 'playing',
    score: 0,
    acc: 0,
    progress: env.progress || null,
    random: typeof env.random === 'function' ? env.random : () => 0.5,
    stats: { delivered: 0, wrong: 0, crashes: 0, late: 0, flips: 0, refused: 0, cleared: 0 },
    cause: null,
    menu: null,
    line: null,
    actSeq: 0,
  };
  const raw = savedLevel(s.progress);
  const unlocked = Number.isNaN(raw) ? 1 : clamp(raw, 1, levels.length);
  loadLevel(s, 0);
  if (unlocked > 1) s.menu = { sel: unlocked, unlocked };
  return s;
}

// Each run shifts every departure by a small seeded amount; a portal's trains keep their order
// and stay at least `jitterGap` apart.
function jitteredTimetable(L, random) {
  const lastAt = {};
  return L.trains.map((d) => {
    const shifted = Math.max(0, d.t + (random() * 2 - 1) * RULES.jitter);
    const t = Math.max(shifted, (lastAt[d.portal] ?? -Infinity) + RULES.jitterGap);
    lastAt[d.portal] = t;
    return { ...d, t: Math.round(t * 100) / 100 };
  });
}

// True when the authored routes, run on this timetable, reach every platform with no strike.
function runsClean(L, timetable) {
  const w = newWorld(L, timetable);
  w.rec = [];
  const log = [];
  while (w.t < RULES.planSpan && w.trains.some(alive)) {
    stepWorld(w, STEP, true, log);
    if (log.some((e) => e.k !== 'spawn' && e.k !== 'deliver')) return false;
  }
  return true;
}

// A jittered timetable the authored routes survive; the authored one when none of a few draws is.
function safeTimetable(L, random) {
  for (let attempt = 0; attempt < RULES.jitterTries; attempt++) {
    const timetable = jitteredTimetable(L, random);
    if (runsClean(L, timetable)) return timetable;
  }
  return L.trains;
}

function loadLevel(s, index) {
  const L = s.levels[index];
  s.level = index;
  s.L = L;
  s.w = newWorld(L, safeTimetable(L, s.random));
  s.plan = buildPlan(s.w);
  s.dirty = false;
  s.strikes = 0;
  s.last = null;
  s.delivered = 0;
  s.sel = 0;
  s.acc = 0;
  s.clear = 0;
  s.preview = false;
  s.wrecks = [];
  s.msg = {
    en: `Timetable ${index + 1}: ${L.name[0]}`,
    zh: `第 ${index + 1} 张时刻表：${L.name[1]}`,
    tip: L.tip,
    age: 0,
    dur: RULES.introTime,
  };
  s.line = null;
}

function say(s, en, zh) {
  s.msg = { en, zh, tip: null, age: 0, dur: RULES.msgTime };
}

function flip(s, emit) {
  const w = s.w;
  if (locked(w, s.sel)) {
    s.stats.refused++;
    say(s, 'Locked: a train is on that junction', '已锁定：有列车在这个道岔上');
    return;
  }
  w.sw[s.sel] ^= 1;
  s.stats.flips++;
  s.actSeq++;
  emit('move');
}

function select(s, to, emit) {
  if (to < 0 || to === s.sel) return;
  s.sel = to;
  s.actSeq++;
  emit('move');
}

function act(s, input, emit) {
  for (let d = 0; d < 4; d++) {
    const keys = [
      ['ArrowUp', 'KeyW'],
      ['ArrowRight', 'KeyD'],
      ['ArrowDown', 'KeyS'],
      ['ArrowLeft', 'KeyA'],
    ][d];
    if (input.pressed(...keys)) select(s, neighbourJunction(s.L.junctions, s.sel, d), emit);
  }
  if (input.pressed('Space', 'Enter')) flip(s, emit);
  if (input.pressed('KeyX')) s.preview = !s.preview;
  const p = input.pointer;
  if (p?.clicked) {
    const x = p.x / TILE - 0.5;
    const y = (p.y - RULES.top) / TILE - 0.5;
    let ji = -1;
    let best = RULES.tapReach;
    s.L.junctions.forEach((j, i) => {
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < best) {
        best = d;
        ji = i;
      }
    });
    if (ji === s.sel) flip(s, emit);
    else select(s, ji, emit);
  }
}

function lose(s, cause) {
  s.phase = 'lost';
  s.cause = cause;
}

const STRIKE_TEXT = {
  'head-on': ['Strike! Two trains met head-on', '失误！两列车迎面相撞'],
  'rear-end': ['Strike! A fast train rammed a slow one', '失误！快车追尾了慢车'],
  side: ['Strike! Two trains collided on a crossing', '失误！两列车在交叉口相撞'],
  wrong: ['Strike! A train reached the wrong platform', '失误！列车开到了错误的站台'],
  late: [
    'Strike! A train circled for 2 minutes and was written off',
    '失误！列车绕行超过两分钟，被撤销',
  ],
};

function tick(s, emit) {
  const w = s.w;
  const log = [];
  stepWorld(w, STEP, true, log);
  for (const e of log) {
    const tr = w.trains[e.tr];
    if (e.k === 'spawn') {
      if (Math.abs((s.plan.spawn[e.tr] ?? w.t) - w.t) > RULES.planSlip) s.dirty = true;
    } else if (e.k === 'deliver') {
      s.delivered++;
      s.stats.delivered++;
      s.score += RULES.scoreDeliver + (tr.d.k === 'x' ? RULES.scoreExpress : 0);
      emit('coin');
    } else {
      s.strikes++;
      s.dirty = true;
      s.stats[e.k === 'crash' ? 'crashes' : e.k]++;
      s.wrecks.push({
        x: e.k === 'crash' ? e.x : s.L.cx[tr.f],
        y: e.k === 'crash' ? e.y : s.L.cy[tr.f],
        age: 0,
      });
      emit('hit');
      s.last = e.k === 'crash' ? e.type : e.k;
      const [en, zh] = STRIKE_TEXT[s.last];
      s.msg = { en, zh, tip: null, age: 0, dur: RULES.strikeMsgTime };
    }
  }
  for (const k of s.wrecks) k.age += STEP;
  s.wrecks = s.wrecks.filter((k) => k.age < RULES.wreckTime);
  if (s.strikes >= RULES.lives) lose(s, 'strikes');
  else if (s.delivered >= s.L.quota) clearLevel(s, emit);
  else if (s.delivered + w.trains.filter(alive).length < s.L.quota) lose(s, 'quota');
}

function clearLevel(s, emit) {
  s.stats.cleared++;
  s.score += RULES.scoreClear + (RULES.lives - s.strikes) * RULES.scoreLife;
  saveLevel(s.progress, Math.min(s.levels.length, s.level + 2));
  emit('win');
  if (s.level + 1 >= s.levels.length) {
    s.phase = 'won';
    return;
  }
  s.clear = RULES.clearTime;
  say(s, 'Timetable cleared!', '时刻表完成！');
}

const trainName = (s, i) => KINDS[s.w.trains[i].d.ci];

// The one line shown at the bottom: the next useful action, kept on screen for at least half a
// second unless the player's own action changed what it is about.
function describe(s) {
  const w = s.w;
  const e = nextAction(w, s.plan);
  if (!e) {
    const next = w.trains.find((tr) => alive(tr));
    const c = next ? KINDS[next.d.ci] : null;
    return {
      key: `watch:${next?.i}`,
      kind: 'watch',
      target: null,
      press: null,
      en: c
        ? `Junctions are set - watch the ${c.en} train`
        : 'Junctions are set - last trains rolling',
      zh: c ? `道岔已就位，留意${c.zh}列车` : '道岔已就位，最后几列车正在行驶',
    };
  }
  const j = s.L.junctions[e.j];
  const c = trainName(s, e.tr);
  const press = selectStep(s.L.junctions, s.sel, e.j);
  if (s.sel !== e.j)
    return {
      key: `select:${e.j}:${press}`,
      kind: 'select',
      target: j.id,
      press: PRESS[press],
      en: `Press ${ARROW[press]} to select junction ${j.id} (${c.en} train)`,
      zh: `按 ${ARROW[press]} 选择道岔 ${j.id}（${c.zh}列车）`,
    };
  const arrow = ARROW[j.br[e.need]];
  return {
    key: `flip:${e.j}:${e.need}`,
    kind: 'flip',
    target: j.id,
    press: 'Space',
    en: `Press Space: flip ${j.id} to ${arrow} for the ${c.en} train`,
    zh: `按空格，把道岔 ${j.id} 扳向${arrow}（${c.zh}列车）`,
  };
}

function advise(s, dt) {
  if (s.dirty) {
    s.plan = buildPlan(s.w);
    s.dirty = false;
  }
  const next = describe(s);
  const cur = s.line;
  if (cur && cur.key === next.key) {
    cur.age += dt;
    return;
  }
  if (cur && cur.age < RULES.promptHold && cur.seq === s.actSeq) {
    cur.age += dt;
    return;
  }
  s.line = { ...next, age: 0, seq: s.actSeq };
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * RULES.menuCols, 1, m.unlocked);
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  const p = input.pointer;
  if (p?.clicked) {
    const hit = menuCellAt(p.x, p.y);
    if (hit >= 1 && hit <= m.unlocked) {
      if (hit === m.sel) m.go = true;
      m.sel = hit;
    }
  }
  if (input.pressed('Space', 'Enter') || m.go) {
    loadLevel(s, m.sel - 1);
    s.menu = null;
    emit('move');
  }
}

export const MENU = Object.freeze({ x: 60, y: 70, w: 72, h: 44 });
function menuCellAt(px, py) {
  const col = Math.floor((px - MENU.x) / MENU.w);
  const row = Math.floor((py - MENU.y) / MENU.h);
  if (col < 0 || col >= RULES.menuCols || row < 0 || px < MENU.x || py < MENU.y) return -1;
  return row * RULES.menuCols + col + 1;
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return false;
  dt = Math.min(dt, RULES.maxDt);
  if (s.menu) {
    menuInput(s, input, emit);
    return true;
  }
  if (s.clear > 0) {
    s.clear -= dt;
    if (s.clear <= 0) loadLevel(s, s.level + 1);
    return true;
  }
  act(s, input, emit);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing' && s.clear <= 0; n++) tick(s, emit);
  s.msg.age += dt;
  if (s.phase === 'playing') advise(s, dt);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  return {
    update(dt, input) {
      // The host plays the win and lose sounds itself, so the final update stays silent.
      const heard = [];
      advance(s, dt, input, (name) => heard.push(name));
      if (s.phase === 'playing') {
        for (const name of heard) env.sound(name);
        return;
      }
      if (ended) return;
      ended = true;
      env.end({
        won: s.phase === 'won',
        score: s.score,
        message:
          s.phase === 'won'
            ? env.t(
                'Every timetable is run - the yard is spotless!',
                '所有时刻表都已完成，编组场井井有条！',
              )
            : s.cause === 'quota'
              ? env.t(
                  `Too many trains were lost to meet the quota in timetable ${s.level + 1}.`,
                  `第 ${s.level + 1} 张时刻表里损失的列车太多，达不到送达数量。`,
                )
              : env.t(
                  `Three strikes in timetable ${s.level + 1}: the yard is shut down.`,
                  `第 ${s.level + 1} 张时刻表发生三次失误，编组场停运。`,
                ),
      });
    },
    draw(ctx) {
      drawGame(ctx, s, env);
    },
    getState() {
      return snapshotOf(s);
    },
  };
}

// --- Snapshot ---

export function snapshotOf(s) {
  const w = s.w;
  const L = s.L;
  const finished = s.phase !== 'playing';
  const dirOf = (tr) => (tr.st === 'run' ? DIR_NAME[dirBetween(tr.f, tr.to)] : null);
  const label = (lang) =>
    lang === 'en'
      ? `Timetable ${s.level + 1}/${s.levels.length}  Delivered ${s.delivered}/${L.quota}  Strikes ${s.strikes}/${RULES.lives}  Spare ${spareOf(s)}`
      : `时刻表 ${s.level + 1}/${s.levels.length}  送达 ${s.delivered}/${L.quota}  失误 ${s.strikes}/${RULES.lives}  余量 ${spareOf(s)}`;
  const line = s.line
    ? {
        kind: s.line.kind,
        target: s.line.target,
        press: s.line.press,
        en: s.line.en,
        zh: s.line.zh,
      }
    : null;
  return {
    phase: s.phase,
    score: s.score,
    level: s.level + 1,
    levelCount: s.levels.length,
    name: { en: L.name[0], zh: L.name[1] },
    time: w.t,
    strikes: s.strikes,
    lives: RULES.lives,
    delivered: s.delivered,
    quota: L.quota,
    spare: spareOf(s),
    total: L.trains.length,
    selected: L.junctions[s.sel].id,
    junctions: L.junctions.map((j, i) => ({
      id: j.id,
      x: j.x,
      y: j.y,
      state: w.sw[i],
      exit: DIR_NAME[j.br[w.sw[i]]],
      locked: locked(w, i),
      selected: i === s.sel,
    })),
    signals: L.sigs.map((g) => ({ x: g.x, y: g.y, green: signalGreen(g, w.t) })),
    portals: Object.entries(L.portals).map(([id, cell]) => ({
      id,
      x: L.tiles[cell].x,
      y: L.tiles[cell].y,
      held: w.trains.some((tr) => tr.st === 'wait' && tr.held && tr.d.portal === cell),
    })),
    platforms: Object.entries(L.platforms).map(([id, cell]) => ({
      id,
      x: L.tiles[cell].x,
      y: L.tiles[cell].y,
      color: KINDS[Number(id) - 1].en,
    })),
    trains: w.trains.map((tr) => ({
      id: tr.i,
      state: tr.st,
      color: KINDS[tr.d.ci].en,
      cargo: tr.d.ci,
      dest: tr.d.dest,
      speed: tr.d.k,
      due: tr.d.t,
      x: tr.st === 'run' ? tr.s[0] : null,
      y: tr.st === 'run' ? tr.s[1] : null,
      dir: dirOf(tr),
      waiting: tr.halted,
      timeLeft: tr.st === 'run' ? Math.max(0, Math.round(timeLeftOf(w, tr) * 10) / 10) : null,
    })),
    preview: s.preview ? previewOf(s) : null,
    prompt: line,
    line,
    message: s.msg.age < s.msg.dur ? { en: s.msg.en, zh: s.msg.zh } : null,
    incident: s.last,
    clearing: s.clear > 0,
    menu: s.menu ? { sel: s.menu.sel, unlocked: s.menu.unlocked } : null,
    stats: { ...s.stats },
    wrecks: s.wrecks.map((k) => ({ x: k.x, y: k.y })),
    hud: { top: [0, RULES.top], bottom: [RULES.bottom, 320] },
    status: finished
      ? s.phase === 'won'
        ? {
            en: `Every timetable is run! Score ${s.score}`,
            zh: `所有时刻表都完成了！得分 ${s.score}`,
          }
        : { en: `The yard shut down. Score ${s.score}`, zh: `编组场停运。得分 ${s.score}` }
      : s.menu
        ? menuStatus(s)
        : { en: playStatus(s, label, 'en'), zh: playStatus(s, label, 'zh') },
  };
}

// The host's status line: counters, then the level tip while it is fresh, then the prompt.
function playStatus(s, label, lang) {
  const tip = s.msg.tip && s.msg.age < s.msg.dur ? s.msg.tip[lang === 'en' ? 0 : 1] : null;
  return [label(lang), tip, s.line?.[lang]].filter(Boolean).join(' · ');
}

function menuStatus(s) {
  const open = s.menu.unlocked;
  return {
    en: `Rail Switch · ${open}/${s.levels.length} timetables open · Arrows choose, Space starts`,
    zh: `铁轨调度 · 已开放 ${open}/${s.levels.length} 张时刻表 · 方向键选择，空格开始`,
  };
}

// The route of the next train to use the selected junction (or, failing that, the first live train).
function previewOf(s) {
  const w = s.w;
  const e = s.plan.events.find((ev) => ev.j === s.sel && pending(w, ev));
  const tr = e ? w.trains[e.tr] : w.trains.find(alive);
  if (!tr) return null;
  return {
    train: tr.i,
    cells: traceRoute(w, tr).map((c) => ({ x: s.L.tiles[c].x, y: s.L.tiles[c].y })),
  };
}

// --- Drawing ---

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const sprite = (ctx, rows, x, y, color) =>
  rows.forEach((row, ry) =>
    [...row].forEach((c, rx) => {
      if (c === '#') box(ctx, color, x + rx, y + ry, 1, 1);
    }),
  );
const FONT = 14;
const BANNER_LINE = 16;
const WRAP_EN = 50;
const WRAP_ZH = 29;
const px = (x) => x * TILE;
const py = (y) => RULES.top + y * TILE;

function drawArm(ctx, x, y, d, rail) {
  const near = d === 1 || d === 2 ? 8 : 0;
  for (let i = 0; i < 2; i++) {
    if (d % 2) box(ctx, '#6b4f33', x + near + i * 4 + 1, y + 3, 2, 10);
    else box(ctx, '#6b4f33', x + 3, y + near + i * 4 + 1, 10, 2);
  }
  if (d % 2) {
    box(ctx, rail, x + near, y + 5, 8, 1);
    box(ctx, rail, x + near, y + 10, 8, 1);
  } else {
    box(ctx, rail, x + 5, y + near, 1, 8);
    box(ctx, rail, x + 10, y + near, 1, 8);
  }
}

function drawTile(ctx, s, t, tick) {
  const x = px(t.x);
  const y = py(t.y);
  const ji = s.L.jAt[t.cell];
  box(ctx, t.kind === 'platform' ? '#2b3b52' : '#3a352e', x, y, TILE, TILE);
  t.arms.forEach((a, d) => {
    if (a < 0) return;
    const off = ji >= 0 && d !== t.stem && d !== t.br[s.w.sw[ji]];
    drawArm(ctx, x, y, d, off ? '#5b5f68' : '#d5d9e0');
  });
  if (t.kind === 'platform') {
    const k = Number(t.ch) - 1;
    box(ctx, '#10151d', x + 2, y + 2, 12, 12);
    box(ctx, KINDS[k].hex, x + 3, y + 3, 10, 10);
    sprite(ctx, CARGO[k], x + 5, y + 5, '#10151d');
  } else if (t.kind === 'portal') {
    const open = !s.w.trains.some((tr) => tr.st === 'wait' && tr.held && tr.d.portal === t.cell);
    box(ctx, '#161616', x + 2, y + 2, 12, 12);
    box(ctx, open ? '#3fb950' : tick % 20 < 10 ? '#f2994a' : '#7a3b13', x + 6, y + 6, 4, 4);
  } else if (s.L.sigAt[t.cell] >= 0) {
    const green = signalGreen(s.L.sigs[s.L.sigAt[t.cell]], s.w.t);
    box(ctx, '#10151d', x + 4, y + 4, 8, 8);
    box(ctx, green ? '#3fb950' : '#e5484d', x + 5, y + 5, 6, 6);
  }
}

function drawLabel(ctx, id, at, selected) {
  const x = px(at.x) + TILE / 2;
  const y = py(at.y) + 1;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
    text(ctx, id, x + dx, y + dy, '#10151d', FONT, 'center');
  text(ctx, id, x, y, selected ? '#4dd0e1' : '#f2c94c', FONT, 'center');
}

function drawLate(ctx, tr, left) {
  const x = Math.round(px(tr.s[0]));
  const y = Math.round(py(tr.s[1])) - 22;
  box(ctx, '#10151d', x - 14, y, 28, 16);
  box(ctx, tick20(left) ? '#e5484d' : '#7a1f23', x - 13, y + 1, 26, 14);
  text(ctx, String(Math.max(0, Math.ceil(left))), x, y + 1, '#ffffff', FONT, 'center');
}
const tick20 = (left) => Math.floor(left * 4) % 2 === 0;

function drawTrain(ctx, tr) {
  const color = KINDS[tr.d.ci].hex;
  const size = tr.d.k === 's' ? 6 : 7;
  for (let k = 4; k >= 0; k -= 2) {
    const x = px(tr.s[k]) - size / 2;
    const y = py(tr.s[k + 1]) - size / 2;
    box(ctx, '#10151d', x - 1, y - 1, size + 2, size + 2);
    box(ctx, color, x, y, size, size);
    if (tr.d.k === 'x') box(ctx, '#ffffff', x + 1, y + 3, size - 2, 1);
  }
  sprite(
    ctx,
    CARGO[tr.d.ci],
    Math.round(px(tr.s[2]) - 2.5),
    Math.round(py(tr.s[3]) - 2.5),
    '#10151d',
  );
  box(ctx, '#ffffff', px(tr.s[0]) - 1, py(tr.s[1]) - 1, 2, 2);
}

// How many more trains may still be lost before the quota can no longer be met.
function spareOf(s) {
  return Math.max(0, s.delivered + s.w.trains.filter(alive).length - s.L.quota);
}

// Seconds a running train has left before it is written off as late.
const timeLeftOf = (w, tr) => RULES.transit - (w.t - tr.spawnT);

function drawHud(ctx, s, env) {
  box(ctx, '#0d1420', 0, 0, 480, RULES.top);
  const name = env.t(s.L.name[0], s.L.name[1]);
  text(ctx, env.t(`T${s.level + 1} ${name}`, `第${s.level + 1}张 ${name}`), 8, 8, '#ffffff', FONT);
  text(ctx, env.t('Strikes', '失误'), 292, 8, '#9fb0c8', FONT, 'right');
  for (let i = 0; i < RULES.lives; i++)
    box(ctx, i < s.strikes ? '#e5484d' : '#2d3748', 300 + i * 16, 9, 12, 14);
  text(ctx, env.t(`Spare ${spareOf(s)}`, `余量 ${spareOf(s)}`), 418, 8, '#9fb0c8', FONT, 'right');
  text(ctx, `${s.delivered}/${s.L.quota}`, 472, 8, '#3fb950', FONT, 'right');
  box(ctx, '#0d1420', 0, RULES.bottom, 480, 320 - RULES.bottom);
  const line = s.line;
  if (line) text(ctx, env.t(line.en, line.zh), 240, RULES.bottom + 9, '#ffffff', FONT, 'center');
}

// Greedy word wrap: Latin text breaks at spaces, Chinese text after `max` characters.
export function wrapText(str, max) {
  const lines = [];
  let cur = '';
  for (const word of /[\u3000-\u9fff]/.test(str)
    ? str.match(new RegExp(`.{1,${max}}`, 'gu'))
    : str.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  return cur ? [...lines, cur] : lines;
}

function drawMenu(ctx, s, env) {
  background(ctx, '#101b2d');
  text(ctx, env.t('Choose a timetable', '选择时刻表'), 240, 22, '#ffffff', 16, 'center');
  s.levels.forEach((L, i) => {
    const col = i % RULES.menuCols;
    const row = Math.floor(i / RULES.menuCols);
    const open = i < s.menu.unlocked;
    const x = MENU.x + col * MENU.w;
    const y = MENU.y + row * MENU.h;
    box(ctx, i + 1 === s.menu.sel ? '#f2c94c' : '#1f3a5a', x, y, MENU.w - 6, MENU.h - 6);
    box(ctx, open ? '#1f3a5a' : '#1a2230', x + 2, y + 2, MENU.w - 10, MENU.h - 10);
    text(
      ctx,
      String(i + 1),
      x + (MENU.w - 6) / 2,
      y + 11,
      open ? '#ffffff' : '#4a5568',
      14,
      'center',
    );
  });
  const L = s.levels[s.menu.sel - 1];
  text(ctx, env.t(L.name[0], L.name[1]), 240, 262, '#f2c94c', FONT, 'center');
  text(
    ctx,
    env.t('Arrows choose, Space starts', '方向键选择，空格开始'),
    240,
    288,
    '#9fb0c8',
    FONT,
    'center',
  );
}

export function drawGame(ctx, s, env) {
  if (s.menu) {
    drawMenu(ctx, s, env);
    return;
  }
  background(ctx, '#18241c');
  const tick = Math.floor(s.w.t * 20);
  for (const t of s.L.tiles) if (t) drawTile(ctx, s, t, tick);
  s.L.junctions.forEach((q, i) => drawLabel(ctx, q.id, s.L.labels[i], i === s.sel));
  if (s.preview) {
    const pv = previewOf(s);
    const color = pv ? KINDS[s.w.trains[pv.train].d.ci].hex : '#fff';
    pv?.cells.forEach((c, i) => {
      if (i % 2 === 0) box(ctx, color, px(c.x) + 6, py(c.y) + 6, 4, 4);
    });
  }
  const j = s.L.junctions[s.sel];
  const target = s.line?.kind === 'flip' || s.line?.kind === 'select' ? s.line.target : null;
  for (const q of s.L.junctions) {
    if (q.id === target && tick % 10 < 6) {
      box(ctx, '#4dd0e1', px(q.x) - 2, py(q.y) - 2, 20, 2);
      box(ctx, '#4dd0e1', px(q.x) - 2, py(q.y) + 16, 20, 2);
    }
  }
  for (const [k, c] of [
    [px(j.x) - 1, py(j.y) - 1],
    [px(j.x) + 15, py(j.y) - 1],
    [px(j.x) - 1, py(j.y) + 15],
    [px(j.x) + 15, py(j.y) + 15],
  ])
    box(ctx, '#f2c94c', k, c, 2, 2);
  for (const tr of s.w.trains) if (tr.st === 'run') drawTrain(ctx, tr);
  for (const tr of s.w.trains) {
    const left = tr.st === 'run' ? timeLeftOf(s.w, tr) : Infinity;
    if (left <= RULES.lateWarn) drawLate(ctx, tr, left);
  }
  for (const k of s.wrecks) {
    const r = 4 + Math.floor(k.age * 10);
    box(ctx, k.age < 0.6 ? '#ffd36e' : '#e5484d', px(k.x) - r, py(k.y) - 1, r * 2, 2);
    box(ctx, k.age < 0.6 ? '#ffd36e' : '#e5484d', px(k.x) - 1, py(k.y) - r, 2, r * 2);
  }
  drawHud(ctx, s, env);
  if (s.msg.age < s.msg.dur || s.clear > 0) {
    const width = env.t(WRAP_EN, WRAP_ZH);
    const head = wrapText(env.t(s.msg.en, s.msg.zh), width);
    const tip = s.msg.tip ? wrapText(env.t(s.msg.tip[0], s.msg.tip[1]), width) : [];
    box(ctx, '#0d1420', 16, 38, 448, 8 + (head.length + tip.length) * BANNER_LINE);
    head.forEach((ln, i) => text(ctx, ln, 240, 42 + i * BANNER_LINE, '#ffffff', FONT, 'center'));
    tip.forEach((ln, i) =>
      text(ctx, ln, 240, 42 + (head.length + i) * BANNER_LINE, '#9fb0c8', FONT, 'center'),
    );
  }
}

// LEVELS-BEGIN
// Level data is generated from authored maps and timetables; every route was checked by
// simulation to be collision-free when the junctions are set in time.
export const LEVELS = [
  {
    name: ['First Points', '第一个道岔'],
    tip: [
      'Select the junction and flip it so each train reaches its own colour.',
      '选中道岔并扳动，让每列车开到自己颜色的站台。',
    ],
    stem: { A: 'W' },
    init: { A: 1 },
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.......a-----A-------1........',
      '.............|................',
      '.............L-------2........',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'A:0'],
      [10, 'a', '2', 'n', 'A:1'],
      [16, 'a', '2', 'n', 'A:1'],
      [22, 'a', '1', 'n', 'A:0'],
      [28, 'a', '2', 'n', 'A:1'],
      [34, 'a', '1', 'n', 'A:0'],
    ],
  },
  {
    name: ['Fork Chain', '连环岔'],
    tip: [
      'Two junctions in a row: the first train needs both set before it arrives.',
      '两个道岔相连：列车到达前两个都要扳好。',
    ],
    stem: { A: 'W', B: 'W' },
    init: { A: 1 },
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............F--------2......',
      '..............|...............',
      '....a---A-----B--------1......',
      '........|.....................',
      '........L---------------3.....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'A:0 B:1'],
      [9, 'a', '2', 'n', 'A:0 B:0'],
      [14, 'a', '3', 'n', 'A:1'],
      [19, 'a', '1', 'n', 'A:0 B:1'],
      [24, 'a', '3', 'n', 'A:1'],
      [29, 'a', '2', 'n', 'A:0 B:0'],
      [34, 'a', '2', 'n', 'A:0 B:0'],
      [39, 'a', '1', 'n', 'A:0 B:1'],
    ],
  },
  {
    name: ['Two Entrances', '双入口'],
    tip: [
      'Two portals share one trunk. Trains merge on their own - you only fork them.',
      '两个入口共用一条干线，列车自动汇入，你只负责分叉。',
    ],
    stem: { m: 'E', A: 'W', B: 'W' },
    init: { A: 1 },
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..a-----7...........F------2..',
      '........|...........|.........',
      '........m-----A-----B------1..',
      '........|.....|...............',
      '..b-----J.....L------------3..',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'A:0 B:1'],
      [8.45, 'b', '2', 'n', 'A:0 B:0'],
      [12.9, 'b', '3', 'n', 'A:1'],
      [17.1, 'a', '3', 'n', 'A:1'],
      [21.55, 'a', '2', 'n', 'A:0 B:0'],
      [26, 'b', '1', 'n', 'A:0 B:1'],
      [30.45, 'b', '2', 'n', 'A:0 B:0'],
      [34.9, 'a', '3', 'n', 'A:1'],
      [39.35, 'b', '1', 'n', 'A:0 B:1'],
      [43.8, 'a', '2', 'n', 'A:0 B:0'],
    ],
  },
  {
    name: ['Crossing', '交叉口'],
    tip: [
      'Two lines cross in a diamond. Send one train round the bypass so they never meet.',
      '两条线在菱形口交叉，把一列车绕行旁路，避免相撞。',
    ],
    stem: { P: 'W', m: 'E', Y: 'W' },
    init: { P: 1, Y: 1 },
    map: [
      '..............................',
      '..............................',
      '..............................',
      '...........b..................',
      '...........|..................',
      '...........|..................',
      '...........|..................',
      '.a---P-----+-----m----Y----1..',
      '.....|.....|.....|....|.......',
      '.....|.....|.....|....L----3..',
      '.....|.....2.....|............',
      '.....|...........|............',
      '.....L-----------J............',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'P:0 Y:0'],
      [5, 'b', '2', 'n', ''],
      [8, 'a', '3', 'n', 'P:0 Y:1'],
      [12, 'a', '1', 'n', 'P:0 Y:0'],
      [13, 'b', '2', 'n', ''],
      [16, 'a', '3', 'n', 'P:0 Y:1'],
      [20, 'a', '1', 'n', 'P:0 Y:0'],
      [21, 'b', '2', 'n', ''],
      [24, 'a', '3', 'n', 'P:0 Y:1'],
      [28, 'a', '1', 'n', 'P:0 Y:0'],
      [29, 'b', '2', 'n', ''],
      [32, 'a', '3', 'n', 'P:0 Y:1'],
    ],
  },
  {
    name: ['Comb Yard', '梳形编组场'],
    tip: [
      'Four platforms along one line. Express trains (striped) arrive much sooner - watch the clock.',
      '一条线上有四个站台。带条纹的特快列车来得更快，注意时间。',
    ],
    stem: { A: 'W', B: 'W', C: 'W' },
    init: { A: 1, B: 1, C: 1 },
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '......a---A---B---C---1.......',
      '..........|...|...|...........',
      '..........2...3...4...........',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'A:0 B:0 C:0'],
      [8, 'a', '3', 'n', 'A:0 B:1'],
      [12.75, 'a', '2', 'x', 'A:1'],
      [15.75, 'a', '4', 'n', 'A:0 B:0 C:1'],
      [22.25, 'a', '1', 'x', 'A:0 B:0 C:0'],
      [25.25, 'a', '2', 'n', 'A:1'],
      [30, 'a', '4', 'x', 'A:0 B:0 C:1'],
      [33, 'a', '3', 'n', 'A:0 B:1'],
      [37, 'a', '1', 'n', 'A:0 B:0 C:0'],
      [41, 'a', '4', 'n', 'A:0 B:0 C:1'],
      [46.5, 'a', '3', 'x', 'A:0 B:1'],
      [49.5, 'a', '2', 'n', 'A:1'],
    ],
  },
  {
    name: ['Passing Loop', '会让线'],
    tip: [
      'A fast train behind a slow one will crash into it. Park the slow one in the loop.',
      '快车追上慢车会追尾。把慢车引进会让线，让快车先过。',
    ],
    stem: { A: 'W', m: 'E', B: 'W' },
    init: {},
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.....F-----------7............',
      '.....|...........|............',
      '.a---A-----------m----B----1..',
      '......................|.......',
      '......................L----2..',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:1 B:0'],
      [10.25, 'a', '2', 'x', 'A:0 B:1'],
      [12.75, 'a', '1', 'n', 'A:0 B:0'],
      [15.25, 'a', '2', 's', 'A:0 B:1'],
      [21.75, 'a', '1', 'x', 'A:1 B:0'],
      [24.25, 'a', '2', 's', 'A:1 B:1'],
      [39.25, 'a', '1', 'x', 'A:0 B:0'],
      [41.75, 'a', '2', 'n', 'A:0 B:1'],
      [44.25, 'a', '1', 's', 'A:0 B:0'],
      [51.25, 'a', '2', 'x', 'A:1 B:1'],
    ],
  },
  {
    name: ['Signal Gate', '信号门'],
    tip: [
      'Red lamps hold trains for a few seconds. The prompt already counts the wait.',
      '红灯会让列车停几秒，提示已经把等待时间算进去了。',
    ],
    stem: { A: 'W', B: 'W' },
    init: { A: 1, B: 1 },
    sig: [
      [8, 4, 0],
      [9, 5, 3],
    ],
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '....a---=---A---=---B----1....',
      '............|.......|.........',
      '............2.......3.........',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'x', 'A:0 B:0'],
      [10.5, 'a', '2', 'x', 'A:1'],
      [13, 'a', '1', 'x', 'A:0 B:0'],
      [16.75, 'a', '2', 'n', 'A:1'],
      [19.25, 'a', '1', 'x', 'A:0 B:0'],
      [21.75, 'a', '3', 's', 'A:0 B:1'],
      [25.25, 'a', '2', 's', 'A:1'],
      [35.25, 'a', '2', 'x', 'A:1'],
      [41, 'a', '3', 'n', 'A:0 B:1'],
      [43.5, 'a', '2', 'x', 'A:1'],
      [46, 'a', '2', 'n', 'A:1'],
    ],
  },
  {
    name: ['Single Track', '单线会车'],
    tip: [
      'One track, two directions, two loops. Park one train in a loop so the other can pass.',
      '单线双向行车，有两处会让线：让一列车进会让线，另一列车从旁通过。',
    ],
    stem: { A: 'E', B: 'W', C: 'E', D: 'W', G: 'W', H: 'E' },
    init: { A: 1, G: 1, C: 1, D: 1 },
    quota: 12,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '....2....F----------7...1.....',
      '....|....|..........|...|.....',
      '.a--A----B-G------H-C---D---b.',
      '...........|......|...........',
      '...........L------J...........',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'B:1 G:0 D:0'],
      [6, 'b', '2', 'n', 'A:0 C:0'],
      [8, 'a', '1', 's', 'B:1 G:0 D:0'],
      [17.75, 'b', '2', 'x', 'A:0 C:0'],
      [28, 'a', '1', 'n', 'B:1 G:0 D:0'],
      [30, 'b', '2', 's', 'A:0 C:0'],
      [42.25, 'b', '2', 'n', 'A:0 C:0'],
      [44.25, 'a', '1', 'x', 'B:1 G:0 D:0'],
      [58.25, 'a', '1', 's', 'B:1 G:0 D:0'],
      [60.25, 'b', '2', 'n', 'A:0 C:0'],
      [67.5, 'a', '1', 'n', 'B:1 G:1 D:0'],
      [81.75, 'b', '2', 's', 'A:0 H:1 C:1'],
      [90, 'b', '2', 'n', 'A:0 C:0'],
      [92, 'a', '1', 'x', 'B:1 G:1 D:0'],
    ],
  },
  {
    name: ['Crossover', '渡线'],
    tip: [
      'Two lines, two crossovers. Trains can switch sides, but the merges are shared.',
      '两条线、两处渡线：列车可以换线，但汇合处要错开。',
    ],
    stem: { A: 'W', n: 'E', B: 'W', m: 'E', D: 'W', C: 'W' },
    init: { A: 1, B: 1 },
    quota: 10,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '....a---A---n---B-------1.....',
      '........|...|...|.............',
      '........|...|...3.............',
      '........|...|.................',
      '....b---m---D-----C-----2.....',
      '..................|...........',
      '..................L-----4.....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'A:0 B:0'],
      [6.5, 'b', '4', 'n', 'D:1 C:1'],
      [9, 'a', '2', 'n', 'A:1 D:1 C:0'],
      [17, 'b', '1', 'x', 'B:0 D:0'],
      [19.5, 'a', '1', 'n', 'A:0 B:0'],
      [22, 'b', '4', 'x', 'D:1 C:1'],
      [24.5, 'a', '2', 'n', 'A:1 D:1 C:0'],
      [28.25, 'b', '1', 's', 'B:0 D:0'],
      [30.75, 'a', '1', 'n', 'A:0 B:0'],
      [33.25, 'b', '1', 's', 'B:0 D:0'],
      [35.75, 'a', '3', 's', 'A:1 B:1 D:0'],
      [48.5, 'b', '2', 'x', 'D:1 C:0'],
      [51, 'a', '1', 'n', 'A:1 B:0 D:0'],
    ],
  },
  {
    name: ['Overtaking', '超车'],
    tip: [
      'Two loops: use them to let each express train overtake the slow ones.',
      '两处会让线：让特快列车依次超过慢车。',
    ],
    stem: { A: 'W', m: 'E', B: 'W', n: 'E', C: 'W' },
    init: { B: 1, C: 1 },
    quota: 10,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '...F------7...................',
      '...|......|...................',
      'a--A------m---B------n---C---1',
      '..............|......|...|....',
      '..............L------J...L---2',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:1 B:0 C:0'],
      [19.5, 'a', '2', 'x', 'A:0 B:1 C:1'],
      [22, 'a', '1', 's', 'A:1 B:0 C:0'],
      [36.75, 'a', '1', 'x', 'A:0 B:1 C:0'],
      [39.25, 'a', '2', 'n', 'A:0 B:0 C:1'],
      [41.75, 'a', '2', 's', 'A:0 B:0 C:1'],
      [49.25, 'a', '1', 'x', 'A:1 B:1 C:0'],
      [51.75, 'a', '2', 's', 'A:1 B:0 C:1'],
      [67.25, 'a', '1', 'x', 'A:0 B:1 C:0'],
      [69.75, 'a', '2', 'n', 'A:0 B:0 C:1'],
      [72.25, 'a', '1', 's', 'A:0 B:0 C:0'],
      [79, 'a', '2', 'x', 'A:1 B:1 C:1'],
    ],
  },
  {
    name: ['Delay Loop', '延时环线'],
    tip: [
      'Send a train round the ring once and it comes back behind the express. A train still circling after 2 minutes is written off.',
      '把列车绕环线跑一圈，就能排到特快列车后面。绕行超过 2 分钟的列车会被撤销。',
    ],
    stem: { m: 'E', A: 'W', B: 'W' },
    init: { B: 1 },
    quota: 9,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '......F---------7.............',
      '......|.........|.............',
      '..a---m---------A----B----1...',
      '.....................|........',
      '.....................L----2...',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:1 B:0'],
      [16.25, 'a', '2', 'x', 'A:01 B:1'],
      [25, 'a', '2', 's', 'A:1 B:1'],
      [37.25, 'a', '1', 'x', 'A:01 B:0'],
      [39.25, 'a', '1', 'n', 'A:1 B:0'],
      [50.25, 'a', '2', 'x', 'A:1 B:1'],
      [52.25, 'a', '1', 's', 'A:1 B:0'],
      [64.5, 'a', '2', 'x', 'A:01 B:1'],
      [66.5, 'a', '2', 'n', 'A:1 B:1'],
      [77.5, 'a', '1', 'x', 'A:1 B:0'],
    ],
  },
  {
    name: ['Double Crossing', '双交叉口'],
    tip: [
      'Four diamonds. Cross-town trains cannot stop: move the main-line trains between tracks.',
      '四个交叉口。南北向的列车不能停，用渡线把东西向列车换到另一条线。',
    ],
    stem: { P: 'W', n: 'E', Y: 'W', m: 'E', Q: 'W', Z: 'W' },
    init: { P: 1, Y: 1, Q: 1, Z: 1 },
    quota: 14,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.........c.........d..........',
      '.........|.........|..........',
      'a--P--n--+---------+----Y----1',
      '...|..|..|.........|....5.....',
      '...|..|..|.........|..........',
      'b--m--Q--+---------+----Z----2',
      '.........|.........|....|.....',
      '.........3.........4....6.....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'P:0 Y:0'],
      [19.5, 'a', '1', 'x', 'P:1 Y:0 Q:0'],
      [21, 'c', '3', 'n', ''],
      [22.5, 'b', '2', 'n', 'Q:1 Z:0'],
      [24, 'd', '4', 'n', ''],
      [25.5, 'b', '2', 's', 'Q:1 Z:0'],
      [43.5, 'b', '2', 'x', 'Q:1 Z:0'],
      [46, 'c', '3', 'x', ''],
      [47.5, 'a', '5', 'n', 'P:0 Y:1'],
      [49, 'b', '6', 'n', 'Q:1 Z:1'],
      [50.5, 'a', '6', 's', 'P:1 Q:1 Z:1'],
      [68.5, 'a', '6', 'x', 'P:1 Q:1 Z:1'],
      [70.75, 'd', '4', 'n', ''],
      [72.25, 'c', '3', 'n', ''],
      [73.75, 'b', '1', 'n', 'Y:0 Q:0'],
    ],
  },
  {
    name: ['Traffic Light', '红绿灯路口'],
    tip: [
      'Timed lamps share the crossing. Send a train round the bypass to skip the red lamp and the crossing.',
      '定时信号灯共用一个交叉口。把列车引上旁路，可以避开红灯和交叉口。',
    ],
    stem: { P: 'W', m: 'E', Y: 'W', Z: 'N' },
    init: { P: 1, Y: 1 },
    sig: [
      [12, 5, 6],
      [12, 5, 0],
    ],
    quota: 13,
    map: [
      '..............................',
      '..............................',
      '.............c................',
      '.............|................',
      '.............!................',
      '.............|................',
      '...a---P--=--+---m---Y----1...',
      '.......|.....|...|...|........',
      '.......|.....Z--4|...3........',
      '.......|.....|...|............',
      '.......|.....2...|............',
      '.......|.........|............',
      '.......L---------J............',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'P:0 Y:0'],
      [5.5, 'c', '2', 'n', 'Z:1'],
      [15, 'a', '3', 'x', 'P:0 Y:1'],
      [16.5, 'c', '4', 'n', 'Z:0'],
      [18, 'a', '1', 'n', 'P:0 Y:0'],
      [19.5, 'c', '2', 's', 'Z:1'],
      [23.5, 'a', '3', 'x', 'P:1 Y:1'],
      [25, 'c', '4', 'n', 'Z:0'],
      [26.5, 'a', '1', 's', 'P:0 Y:0'],
      [34, 'c', '2', 'x', 'Z:1'],
      [35.5, 'a', '3', 'n', 'P:1 Y:1'],
      [37, 'c', '4', 's', 'Z:0'],
      [45.5, 'a', '1', 'x', 'P:1 Y:0'],
      [47, 'c', '2', 'n', 'Z:1'],
      [48.5, 'a', '3', 's', 'P:0 Y:1'],
      [54.25, 'a', '1', 'x', 'P:1 Y:0'],
    ],
  },
  {
    name: ['Single Track II', '单线会车二'],
    tip: [
      'Two loops on a long single track, and westbound trains pick between two platforms.',
      '长单线上有两处会让线，西行列车还要选择两个站台之一。',
    ],
    stem: { A: 'E', B: 'E', C: 'W', D: 'E', E: 'W', G: 'E', H: 'W' },
    init: { A: 1, B: 1, C: 1, G: 1, H: 1 },
    quota: 9,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..................F-----7.....',
      '...3..2...........|.....|..1..',
      'a--A--B-C-----D---E-----G--H-b',
      '........|.....|...............',
      '........L-----J...............',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'C:0 E:1 H:0'],
      [7, 'b', '2', 'n', 'B:0 D:1 G:0'],
      [12.75, 'a', '1', 'x', 'C:1 E:1 H:0'],
      [14.25, 'b', '3', 'n', 'A:0 B:1 D:1 G:0'],
      [22.75, 'b', '2', 's', 'B:0 D:1 G:1'],
      [32.25, 'a', '1', 'n', 'C:1 E:1 H:0'],
      [38.25, 'b', '3', 'n', 'A:0 B:1 D:1 G:0'],
      [43.5, 'a', '1', 's', 'C:1 E:1 H:0'],
      [56.25, 'a', '1', 'n', 'C:1 E:1 H:0'],
      [65.5, 'b', '2', 'x', 'B:0 D:1 G:0'],
      [67, 'b', '3', 'n', 'A:0 B:1 D:1 G:0'],
      [68.75, 'a', '1', 'n', 'C:1 E:1 H:0'],
    ],
  },
  {
    name: ['Ladder Yard', '梯形编组场'],
    tip: [
      'Three lines joined by four crossovers. Merges are shared: keep trains apart.',
      '三条线由四处渡线相连。汇合处共用，要让列车错开。',
    ],
    stem: { A: 'W', m: 'E', B: 'W', q: 'E', G: 'W', n: 'E', D: 'W', r: 'E' },
    init: { A: 1, B: 1, G: 1 },
    quota: 13,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '...a---A-----------r-----1....',
      '.......|...........|..........',
      '...b---m---B---q---G-----2....',
      '...........|...|..............',
      '...c-------n---D---------3....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:0'],
      [9.75, 'a', '1', 'x', 'A:1 B:0 G:0'],
      [11.25, 'b', '2', 'n', 'B:0 G:1'],
      [12.75, 'c', '3', 's', 'D:1'],
      [26.5, 'c', '3', 'x', 'D:1'],
      [28, 'b', '1', 'n', 'B:0 G:0'],
      [29.5, 'a', '2', 's', 'A:1 B:0 G:1'],
      [43, 'a', '2', 'x', 'A:1 B:1 G:1 D:0'],
      [44.5, 'c', '1', 'n', 'G:0 D:0'],
      [46, 'b', '3', 's', 'B:1 D:1'],
      [61, 'b', '3', 'x', 'B:1 D:1'],
      [62.5, 'a', '3', 'n', 'A:1 B:1 D:1'],
      [64.5, 'c', '2', 's', 'G:1 D:0'],
      [79.5, 'c', '2', 'x', 'G:1 D:0'],
      [81, 'b', '2', 'n', 'B:0 G:1'],
    ],
  },
  {
    name: ['Rush Hour', '高峰时段'],
    tip: [
      'Three portals feed one trunk. Trains are frequent: work in order.',
      '三个入口共用一条干线，列车密集，按顺序处理。',
    ],
    stem: { m: 'E', n: 'E', A: 'W', B: 'W', C: 'W' },
    init: { A: 1, C: 1 },
    quota: 14,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.a---m-----7..................',
      '.....|.....|..................',
      '.b---J.....|.......2..........',
      '...........|.......|..........',
      '.c---------n---A---B---C---1..',
      '...............|.......|......',
      '...............3.......L---4..',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:0 B:1 C:0'],
      [16, 'b', '4', 'n', 'A:0 B:1 C:1'],
      [17.5, 'c', '1', 's', 'A:0 B:1 C:0'],
      [25.75, 'a', '1', 'n', 'A:0 B:1 C:0'],
      [27.25, 'b', '3', 's', 'A:1'],
      [28.75, 'c', '1', 's', 'A:0 B:1 C:0'],
      [39.5, 'a', '1', 'n', 'A:0 B:1 C:0'],
      [46, 'b', '3', 'x', 'A:1'],
      [47.5, 'c', '1', 's', 'A:0 B:1 C:0'],
      [49.75, 'a', '1', 'x', 'A:0 B:1 C:0'],
      [51.25, 'b', '3', 's', 'A:1'],
      [58, 'c', '1', 'n', 'A:0 B:1 C:0'],
      [63.5, 'a', '4', 'n', 'A:0 B:1 C:1'],
      [70, 'b', '3', 'x', 'A:1'],
      [72.75, 'c', '2', 'n', 'A:0 B:0'],
      [74.25, 'a', '3', 's', 'A:1'],
    ],
  },
  {
    name: ['Signal Loop', '信号环线'],
    tip: [
      'A delay loop, a timed lamp and three platforms on one line. A train still circling after 2 minutes is written off.',
      '一条线上有延时环线、定时信号灯和三个站台。绕行超过 2 分钟的列车会被撤销。',
    ],
    stem: { m: 'E', A: 'W', B: 'W', C: 'W' },
    init: { C: 1 },
    sig: [[10, 6, 0]],
    quota: 12,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '....F---------7......2........',
      '....|.........|......|........',
      'a---m---------A---=--B---C---1',
      '.........................|....',
      '.........................3....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 's', 'A:1 B:1 C:0'],
      [15.75, 'a', '2', 'x', 'A:01 B:0'],
      [17.25, 'a', '3', 'n', 'A:01 B:1 C:1'],
      [32.25, 'a', '1', 's', 'A:1 B:1 C:0'],
      [44, 'a', '3', 'x', 'A:01 B:1 C:1'],
      [52.5, 'a', '2', 's', 'A:1 B:0'],
      [64.25, 'a', '1', 'x', 'A:01 B:1 C:0'],
      [65.75, 'a', '3', 'n', 'A:01 B:1 C:1'],
      [80.75, 'a', '2', 's', 'A:1 B:0'],
      [92.5, 'a', '2', 'x', 'A:01 B:0'],
      [94, 'a', '1', 'n', 'A:01 B:1 C:0'],
      [109, 'a', '3', 's', 'A:1 B:1 C:1'],
      [120.75, 'a', '1', 'x', 'A:01 B:1 C:0'],
    ],
  },
  {
    name: ['Mountain Pass', '山间单线'],
    tip: [
      'A zig-zag single track with two loops. Trains run both ways, so every meeting needs a loop.',
      '之字形单线上有两处会让线，双向行车，每次会车都要用到会让线。',
    ],
    stem: { A: 'E', B: 'W', C: 'E', K: 'E', N: 'E', G: 'W', D: 'E' },
    init: { A: 1, K: 1 },
    quota: 11,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '.........3..F---7.............',
      '......a--A--B---C-----7.......',
      '......................|.......',
      '......b--K--N--G---D--J.......',
      '.........1..2..L---J..........',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'B:1 K:0 N:1 D:1'],
      [8.75, 'b', '3', 'n', 'A:0 C:1 G:1'],
      [21.25, 'a', '2', 'x', 'B:0 N:0 D:1'],
      [25.5, 'b', '3', 'x', 'A:0 C:1 G:1'],
      [29.5, 'a', '1', 'n', 'B:0 K:0 N:1 D:1'],
      [35.75, 'b', '3', 'n', 'A:0 C:1 G:1'],
      [48.25, 'a', '2', 'x', 'B:0 N:0 D:1'],
      [52.5, 'b', '3', 'x', 'A:0 C:1 G:1'],
      [54.5, 'a', '1', 's', 'B:0 K:0 N:1 D:1'],
      [71, 'b', '3', 'n', 'A:0 C:1 G:1'],
      [83.5, 'a', '2', 'x', 'B:0 N:0 D:1'],
      [89, 'b', '3', 'x', 'A:0 C:1 G:1'],
      [93, 'a', '1', 'n', 'B:0 K:0 N:1 D:1'],
    ],
  },
  {
    name: ['Through Line', '贯通线'],
    tip: [
      'A crossing with a bypass, a passing loop and a fork: every trick on one line.',
      '带旁路的交叉口、会让线和分叉口，各种技巧集于一条线。',
    ],
    stem: { P: 'W', m: 'E', A: 'W', n: 'E', Y: 'W' },
    init: { P: 1, Y: 1 },
    sig: [[10, 5, 0]],
    quota: 13,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '.......c......................',
      '.......|......................',
      '.......!......F------7........',
      '.......|......|......|........',
      'a--P---+---m--A------n---Y---1',
      '...|...|...|.............|....',
      '...|...|...|.............L---2',
      '...|...4...|..................',
      '...|.......|..................',
      '...L-------J..................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '1', 'n', 'P:0 A:1 Y:0'],
      [6, 'c', '4', 'n', ''],
      [8, 'a', '2', 's', 'P:0 A:1 Y:1'],
      [20.75, 'a', '1', 'x', 'P:1 A:0 Y:0'],
      [22.75, 'c', '4', 'n', ''],
      [24.75, 'a', '2', 'n', 'P:0 A:1 Y:1'],
      [26.75, 'a', '1', 's', 'P:0 A:1 Y:0'],
      [28.75, 'c', '4', 'x', ''],
      [39.5, 'a', '2', 'x', 'P:1 A:0 Y:1'],
      [41.5, 'a', '1', 'n', 'P:1 A:1 Y:0'],
      [43.5, 'c', '4', 'n', ''],
      [45.5, 'a', '2', 's', 'P:0 A:1 Y:1'],
      [58.25, 'a', '1', 'x', 'P:1 A:0 Y:0'],
      [60.25, 'a', '2', 'n', 'P:1 A:1 Y:1'],
    ],
  },
  {
    name: ['Central Terminal', '中央总站'],
    tip: [
      'The finale: three portals, five platforms, crossovers and lamps. Slow trains hold up the express, so route them the long way round.',
      '终章：三个入口、五个站台、渡线和信号灯。慢车会拖住特快列车，要让慢车绕行。',
    ],
    stem: { A: 'W', m: 'E', B: 'W', q: 'E', G: 'W', n: 'E', D: 'W', r: 'E', X: 'W', Z: 'W' },
    init: { X: 1, B: 1, Z: 1 },
    sig: [
      [9, 5, 0],
      [9, 5, 3],
      [9, 5, 6],
    ],
    quota: 15,
    map: [
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '........................4.....',
      'a---A-----------r---=---X---1.',
      '....|...........|.............',
      'b---m---B---q---G---=-------2.',
      '........|...|.................',
      'c-------n---D-------=---Z---3.',
      '........................5.....',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ],
    trains: [
      [4, 'a', '2', 'n', 'A:1 B:0 G:1'],
      [6.25, 'b', '3', 's', 'B:1 D:1 Z:0'],
      [27, 'b', '3', 'x', 'B:1 D:1 Z:0'],
      [28.5, 'c', '4', 'n', 'X:0 G:0 D:0'],
      [32.75, 'a', '5', 'x', 'A:1 B:1 D:1 Z:1'],
      [34.25, 'c', '5', 's', 'D:1 Z:1'],
      [53.5, 'c', '5', 'x', 'D:1 Z:1'],
      [55, 'b', '4', 'n', 'X:0 B:0 G:0'],
      [56.5, 'a', '1', 's', 'A:0 X:1'],
      [70.75, 'a', '1', 'x', 'A:1 X:1 B:1 G:0 D:0'],
      [72.25, 'b', '3', 'n', 'B:1 D:1 Z:0'],
      [73.75, 'c', '4', 's', 'X:0 G:0 D:0'],
      [93.75, 'c', '4', 'x', 'X:0 G:0 D:0'],
      [95.25, 'a', '2', 'n', 'A:1 B:0 G:1'],
      [101.75, 'b', '5', 'x', 'B:1 D:1 Z:1'],
      [103.25, 'a', '2', 's', 'A:1 B:0 G:1'],
      [118.5, 'a', '2', 'x', 'A:1 B:1 G:1 D:0'],
    ],
  },
];
// LEVELS-END

const BUILT = LEVELS.map(compileLevel);
export const LEVEL_COUNT = BUILT.length;
