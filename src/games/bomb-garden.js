import { drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'bomb-garden',
  name: { en: 'Bomb Garden', zh: '炸弹花园' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Clear six gardens with four-port blast charges. Walls and crates stop jets; wet fuses burn longer, compost barrels chain. Leave an escape route, trap rivals and carry upgrades forward. Or duel a friend!',
    zh: '使用四向喷焰炸弹清理六座花园。墙壁和木箱会挡住喷焰，湿地引信更慢，堆肥桶会连爆。留下逃生路线、围困对手并保留升级；也可与好友对战！',
  },
  touchControls: [
    { code: 'KeyA', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'KeyD', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'KeyW', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'KeyS', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'Space', side: 'right', label: { en: 'Bomb', zh: '炸弹' } },
  ],
  multiplayerTouchControls: [
    { code: 'KeyW', side: 'left', label: { en: 'P1 Up', zh: '1 上' } },
    { code: 'KeyA', side: 'left', label: { en: 'P1 Left', zh: '1 左' } },
    { code: 'KeyS', side: 'left', label: { en: 'P1 Down', zh: '1 下' } },
    { code: 'KeyD', side: 'left', label: { en: 'P1 Right', zh: '1 右' } },
    { code: 'Space', side: 'left', label: { en: 'P1 Bomb', zh: '1 炸弹' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'P2 Up', zh: '2 上' } },
    { code: 'ArrowLeft', side: 'right', label: { en: 'P2 Left', zh: '2 左' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'P2 Down', zh: '2 下' } },
    { code: 'ArrowRight', side: 'right', label: { en: 'P2 Right', zh: '2 右' } },
    { code: 'Enter', side: 'right', label: { en: 'P2 Bomb', zh: '2 炸弹' } },
  ],
  keys: [
    {
      label: { en: 'P1 move / bomb', zh: '玩家1 移动 / 炸弹' },
      keys: {
        en: 'WASD (solo: also arrows) / Space or J',
        zh: 'WASD（单人也可用方向键）/ 空格或 J',
      },
    },
    {
      label: { en: 'P2 move / bomb (duel)', zh: '玩家2 移动 / 炸弹（对战）' },
      keys: { en: 'Arrows / Enter or /', zh: '方向键 / 回车或 /' },
    },
  ],
};

const COLS = 15,
  ROWS = 9,
  CELL = 30,
  OX = 15,
  OY = 42;
const DIRS = [
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 0],
];
const BODY = [
  '..aaaa..',
  '.aaaaaa.',
  '.abbbba.',
  '.abccba.',
  '..dddd..',
  '.dddddd.',
  '..d..d..',
  '.ee..ee.',
];

/** Walls absorb blasts; a destructible crate is included and then stops the ray. */
export function blastCells(board, x, y, range) {
  const cells = [[x, y]];
  for (const [dx, dy] of DIRS)
    for (let n = 1; n <= range; n++) {
      const nx = x + dx * n,
        ny = y + dy * n;
      if (!board[ny] || board[ny][nx] === undefined || board[ny][nx] === 1) break;
      cells.push([nx, ny]);
      if (board[ny][nx] === 2 || board[ny][nx] === 3) break;
    }
  return cells;
}

/** Plan an entire chain against an immutable terrain snapshot. Crates shield every ray in this batch. */
export function resolveBlastChain(board, bombs, initialIds) {
  const pending = [...initialIds],
    seen = new Set(),
    cells = new Map(),
    exploded = [];
  for (let n = 0; n < pending.length; n++) {
    const id = pending[n];
    if (seen.has(id)) continue;
    seen.add(id);
    const bomb = bombs.find((b) => b.id === id);
    if (!bomb) continue;
    exploded.push(id);
    for (const [x, y] of blastCells(board, bomb.x, bomb.y, bomb.range)) {
      cells.set(`${x},${y}`, [x, y]);
      for (const other of bombs)
        if (other.x === x && other.y === y && !seen.has(other.id)) pending.push(other.id);
    }
  }
  return { exploded, cells: [...cells.values()] };
}
const GARDENS = [
  { en: 'Clover Courtyard', zh: '三叶庭院', style: 0, ground: '#295548' },
  { en: 'Canal Walk', zh: '水渠长廊', style: 1, ground: '#284e59' },
  { en: 'Rose Crossroads', zh: '蔷薇路口', style: 2, ground: '#59444c' },
  { en: 'Orchard Alleys', zh: '果园小巷', style: 3, ground: '#485936' },
  { en: 'Moon Garden', zh: '月下花园', style: 4, ground: '#3d4563' },
  { en: 'Royal Conservatory', zh: '皇家温室', style: 5, ground: '#4e4b36' },
];

const LAYOUTS = [
  {
    walls: [],
    crates: [
      [4, 1],
      [1, 4],
      [5, 1],
      [7, 1],
      [9, 1],
      [3, 3],
      [5, 3],
      [7, 3],
      [9, 3],
      [11, 3],
      [3, 5],
      [5, 5],
      [7, 5],
      [9, 5],
      [11, 5],
      [3, 7],
      [5, 7],
      [9, 7],
      [11, 7],
    ],
    barrels: [],
    wet: [],
    foes: [
      [11, 1, 'bomber'],
      [13, 7, 'scout'],
    ],
  },
  {
    walls: [
      [7, 1],
      [7, 2],
      [7, 4],
      [7, 5],
      [7, 6],
    ],
    crates: [
      [4, 1],
      [1, 4],
      [5, 1],
      [3, 3],
      [6, 3],
      [8, 3],
      [11, 3],
      [3, 5],
      [5, 5],
      [9, 5],
      [11, 5],
      [5, 7],
      [7, 7],
      [9, 7],
    ],
    barrels: [],
    wet: [
      [5, 3],
      [6, 3],
      [7, 3],
      [8, 3],
      [9, 3],
      [6, 7],
      [7, 7],
      [8, 7],
    ],
    foes: [
      [13, 1, 'bomber'],
      [11, 7, 'warden'],
    ],
  },
  {
    walls: [
      [5, 2],
      [5, 4],
      [9, 4],
      [9, 6],
    ],
    crates: [
      [4, 1],
      [1, 4],
      [7, 1],
      [9, 1],
      [3, 3],
      [7, 3],
      [11, 3],
      [5, 5],
      [7, 5],
      [11, 5],
      [3, 7],
      [5, 7],
      [9, 7],
    ],
    barrels: [
      [7, 4],
      [11, 4],
    ],
    wet: [],
    foes: [
      [13, 1, 'scout'],
      [1, 7, 'bomber'],
      [13, 7, 'warden'],
    ],
  },
  {
    walls: [
      [7, 2],
      [7, 6],
    ],
    crates: [
      [4, 1],
      [1, 4],
      [5, 1],
      [7, 1],
      [9, 1],
      [3, 3],
      [5, 3],
      [7, 3],
      [9, 3],
      [11, 3],
      [3, 5],
      [5, 5],
      [7, 5],
      [9, 5],
      [11, 5],
      [3, 7],
      [5, 7],
      [9, 7],
    ],
    barrels: [
      [5, 4],
      [9, 4],
    ],
    wet: [
      [3, 3],
      [5, 3],
      [7, 3],
      [9, 3],
      [11, 3],
    ],
    foes: [
      [11, 1, 'warden'],
      [1, 7, 'bomber'],
      [13, 7, 'scout'],
    ],
  },
  {
    walls: [
      [7, 2],
      [7, 4],
      [7, 6],
      [3, 4],
      [5, 4],
      [9, 4],
      [11, 4],
    ],
    crates: [
      [4, 1],
      [1, 4],
      [5, 1],
      [9, 1],
      [3, 3],
      [7, 3],
      [11, 3],
      [3, 5],
      [7, 5],
      [11, 5],
      [5, 7],
      [9, 7],
    ],
    barrels: [
      [5, 3],
      [9, 5],
    ],
    wet: [],
    foes: [
      [13, 1, 'warden'],
      [1, 7, 'scout'],
      [13, 7, 'bomber'],
    ],
  },
  {
    walls: [
      [7, 1],
      [7, 2],
      [7, 6],
      [7, 7],
      [5, 4],
      [9, 4],
    ],
    crates: [
      [4, 1],
      [1, 4],
      [5, 1],
      [9, 1],
      [3, 3],
      [5, 3],
      [9, 3],
      [11, 3],
      [3, 5],
      [5, 5],
      [7, 5],
      [9, 5],
      [11, 5],
      [3, 7],
      [5, 7],
      [9, 7],
    ],
    barrels: [
      [3, 4],
      [11, 4],
    ],
    wet: [
      [5, 3],
      [6, 3],
      [7, 3],
      [8, 3],
      [9, 3],
      [7, 5],
    ],
    foes: [
      [13, 1, 'warden'],
      [1, 7, 'bomber'],
      [13, 7, 'scout'],
      [7, 3, 'warden'],
    ],
  },
];
const FUSE = 2.4,
  FRONT_STEP = 0.045,
  ACTIVE = 0.3,
  EMBER = 0.18,
  PLAYER_SPEED = 0.15,
  RADIUS = 0.27;
const key = (x, y) => `${x},${y}`;

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    level = 1,
    time = 210,
    elapsed = 0,
    transition = 0,
    respawn = 0,
    lives = 3,
    nextId = 1,
    stageScore = 0,
    stageUpgrades = { range: 2, capacity: 1 };
  let board,
    players,
    enemies,
    bombs = [],
    flames = [],
    fronts = [],
    pickups = [],
    particles = [],
    wet = new Set(),
    banner = 2.5;
  const all = () => [...players, ...enemies];
  function actor(x, y, id, role = 'player') {
    return {
      x,
      y,
      px: x,
      py: y,
      id,
      ai: role !== 'player',
      role,
      alive: true,
      range: role === 'warden' ? 3 : 2,
      capacity: 1,
      speed: role === 'player' ? PLAYER_SPEED : role === 'scout' ? 0.225 : 0.3,
      direction: [0, 1],
      moving: null,
      moveClock: 0,
      anim: 0,
      thinkAt: elapsed,
      bombAt: elapsed + 2.5 + env.random(),
      arming: 0,
      pendingBomb: false,
      stamina: role === 'scout' ? 6 : role === 'warden' ? 3 : 4,
      restUntil: 0,
    };
  }
  function newGarden() {
    time = env.mode === 2 ? 180 : 210;
    bombs = [];
    flames = [];
    fronts = [];
    pickups = [];
    particles = [];
    banner = 2.5;
    const layout = LAYOUTS[level - 1];
    board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) =>
        x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)
          ? 1
          : 0,
      ),
    );
    if (env.mode === 2) {
      for (const [x, y] of [
        [5, 3],
        [7, 3],
        [9, 3],
        [5, 5],
        [7, 5],
        [9, 5],
      ])
        board[y][x] = 2;
      wet = new Set();
    } else {
      for (const [x, y] of layout.walls) board[y][x] = 1;
      for (const [x, y] of layout.crates) if (board[y][x] === 0) board[y][x] = 2;
      for (const [x, y] of layout.barrels) if (board[y][x] === 0) board[y][x] = 3;
      wet = new Set(layout.wet.map(([x, y]) => key(x, y)));
    }
    players = [actor(1, 1, 0)];
    enemies = [];
    if (env.mode === 2) players.push(actor(13, 7, 1));
    else {
      Object.assign(players[0], stageUpgrades);
      enemies = layout.foes.map(([x, y, role], i) => actor(x, y, i + 2, role));
    }
    for (const a of all())
      for (const [dx, dy] of [[0, 0], ...DIRS])
        if (board[a.y + dy]?.[a.x + dx] !== 1) board[a.y + dy][a.x + dx] = 0;
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
      [1, 2],
      [13, 7],
      [12, 7],
      [11, 7],
      [11, 6],
      [13, 6],
    ])
      board[y][x] = 0;
    if (env.mode !== 2) {
      if (board[1][4] === 0) board[1][4] = 2;
      if (board[4][1] === 0) board[4][1] = 2;
    }
  }
  newGarden();
  function finish(won, message) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score, message });
  }
  function occupied(x, y, a) {
    return all().some(
      (other) =>
        other !== a &&
        other.alive &&
        ((other.x === x && other.y === y) ||
          (other.moving && other.moving.x === x && other.moving.y === y)),
    );
  }
  function canMove(x, y, a, ignoreActors = false) {
    return (
      board[y]?.[x] === 0 &&
      !bombs.some((b) => b.x === x && b.y === y && !b.passIds.includes(a.id)) &&
      (!ignoreActors ? !occupied(x, y, a) : true)
    );
  }
  function plant(a) {
    if (
      !a.alive ||
      a.moving ||
      board[a.y][a.x] !== 0 ||
      bombs.some((b) => b.x === a.x && b.y === a.y) ||
      bombs.filter((b) => b.owner === a.id && !b.barrel).length >= a.capacity
    )
      return false;
    const fuse = wet.has(key(a.x, a.y)) ? 3 : FUSE;
    bombs.push({
      id: nextId++,
      x: a.x,
      y: a.y,
      range: a.range,
      at: activeAt(a.x, a.y) ? elapsed : elapsed + fuse,
      planted: elapsed,
      owner: a.id,
      passIds: [a.id],
      barrel: false,
    });
    a.pendingBomb = false;
    env.sound('shoot');
    return true;
  }
  function activeAt(x, y) {
    return flames.some((f) => f.until > elapsed + 1e-9 && f.x === x && f.y === y);
  }
  function burnCell(x, y, owners) {
    const existing = flames.find((f) => f.x === x && f.y === y && f.emberUntil > elapsed);
    if (existing) {
      if (existing.until <= elapsed + 1e-9) existing.owners = [];
      existing.until = Math.max(existing.until, elapsed + ACTIVE);
      existing.emberUntil = Math.max(existing.emberUntil, elapsed + ACTIVE + EMBER);
      existing.owners = [...new Set([...existing.owners, ...owners])];
    } else
      flames.push({
        x,
        y,
        until: elapsed + ACTIVE,
        emberUntil: elapsed + ACTIVE + EMBER,
        owners: [...owners],
      });
  }
  function breakCrate(x, y, owners) {
    board[y][x] = 0;
    if (owners.includes(0)) score += 10;
    const guaranteed = x === 4 && y === 1 ? 'range' : x === 1 && y === 4 ? 'capacity' : null;
    if (guaranteed || (x + y + level) % 4 === 0)
      pickups.push({
        x,
        y,
        type: guaranteed || ((x + y) % 3 === 0 ? 'capacity' : 'range'),
        protectedUntil: elapsed + ACTIVE,
      });
    for (let n = 0; n < 5; n++)
      particles.push({
        x: OX + x * CELL + 15,
        y: OY + y * CELL + 15,
        vx: (env.random() - 0.5) * 70,
        vy: -env.random() * 70,
        life: 0.45,
      });
  }
  // Process a whole event timestamp against one terrain snapshot. Later fronts see opened cover.
  function processEvents() {
    let safety = 0;
    while (safety++ < 100) {
      const next = Math.min(...bombs.map((b) => b.at), ...fronts.map((f) => f.at));
      if (next > elapsed + 1e-9) break;
      const terrain = board.map((r) => [...r]),
        due = fronts.filter((f) => Math.abs(f.at - next) < 1e-8),
        roots = new Set(bombs.filter((b) => Math.abs(b.at - next) < 1e-8).map((b) => b.id)),
        hits = new Map();
      fronts = fronts.filter((f) => Math.abs(f.at - next) >= 1e-8);
      const hit = (x, y, owner) => {
        const k = key(x, y);
        if (!hits.has(k)) hits.set(k, { x, y, owners: [] });
        hits.get(k).owners.push(owner);
      };
      for (const f of due) {
        if (terrain[f.y]?.[f.x] === undefined || terrain[f.y][f.x] === 1) continue;
        hit(f.x, f.y, f.owner);
        const charge = bombs.find((b) => b.x === f.x && b.y === f.y);
        if (charge) {
          roots.add(charge.id);
          continue;
        }
        if (terrain[f.y][f.x] === 2 || terrain[f.y][f.x] === 3) continue;
        if (f.remaining > 1)
          fronts.push({
            ...f,
            x: f.x + f.dx,
            y: f.y + f.dy,
            remaining: f.remaining - 1,
            at: next + FRONT_STEP,
          });
      }
      const exploding = bombs.filter((b) => roots.has(b.id)).sort((a, b) => a.x - b.x || a.y - b.y);
      for (const b of exploding) {
        hit(b.x, b.y, b.owner);
        if (b.barrel) board[b.y][b.x] = 0;
        for (const [dx, dy] of DIRS)
          fronts.push({
            x: b.x + dx,
            y: b.y + dy,
            dx,
            dy,
            remaining: b.range,
            at: next + FRONT_STEP,
            owner: b.owner,
          });
      }
      bombs = bombs.filter((b) => !roots.has(b.id));
      if (exploding.length) env.sound('hit');
      for (const { x, y, owners } of hits.values()) {
        burnCell(x, y, owners);
        if (terrain[y][x] === 2) breakCrate(x, y, owners);
        else if (
          terrain[y][x] === 3 &&
          !bombs.some((b) => b.x === x && b.y === y) &&
          !exploding.some((b) => b.x === x && b.y === y)
        ) {
          bombs.push({
            id: nextId++,
            x,
            y,
            range: 2,
            at: next + 0.18,
            planted: next,
            owner: owners.includes(0) ? 0 : Math.min(...owners),
            passIds: [],
            barrel: true,
          });
        } else
          pickups = pickups.filter((p) => p.x !== x || p.y !== y || p.protectedUntil >= elapsed);
      }
    }
  }
  function dangerSet(a = null) {
    const cells = [];
    for (const b of bombs)
      if (
        !a ||
        b.owner === a.id ||
        b.at - elapsed < (a.role === 'warden' ? 1.4 : a.role === 'scout' ? 1.25 : 1)
      )
        cells.push(...blastCells(board, b.x, b.y, b.range));
    for (const f of fronts)
      for (let n = 0; n < f.remaining; n++) {
        const x = f.x + f.dx * n,
          y = f.y + f.dy * n;
        if (board[y]?.[x] === undefined || board[y][x] === 1) break;
        cells.push([x, y]);
        if (board[y][x] >= 2) break;
      }
    for (const f of flames) if (f.until > elapsed) cells.push([f.x, f.y]);
    return new Set(cells.map(([x, y]) => key(x, y)));
  }
  function escape(a, danger, limit = 12) {
    const queue = [{ x: a.x, y: a.y, first: null, n: 0 }],
      seen = new Set([key(a.x, a.y)]);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p.first && !danger.has(key(p.x, p.y))) return p.first;
      if (p.n >= limit) continue;
      for (const [dx, dy] of DIRS) {
        const x = p.x + dx,
          y = p.y + dy,
          k = key(x, y);
        if (seen.has(k) || !canMove(x, y, a) || activeAt(x, y)) continue;
        seen.add(k);
        queue.push({ x, y, first: p.first || [dx, dy], n: p.n + 1 });
      }
    }
    return null;
  }
  function startMove(a, dx, dy) {
    if (!a.alive || a.moving || (!dx && !dy) || !canMove(a.x + dx, a.y + dy, a)) return false;
    a.direction = [dx, dy];
    a.moving = { x: a.x + dx, y: a.y + dy, progress: 0 };
    a.moveClock = a.speed;
    return true;
  }
  function enemyDecision(a) {
    if (!a.alive || a.moving) return;
    if (a.restUntil > elapsed) return;
    if (a.stamina === 0) a.stamina = a.role === 'scout' ? 6 : a.role === 'warden' ? 3 : 4;
    const danger = dangerSet(a);
    if (danger.has(key(a.x, a.y))) {
      a.arming = 0;
      const route = escape(a, danger);
      if (route) startMove(a, ...route);
      return;
    }
    if (a.arming > 0) {
      if (elapsed < a.arming) return;
      const future = new Set([
        ...danger,
        ...blastCells(board, a.x, a.y, a.range).map(([x, y]) => key(x, y)),
      ]);
      const retreat = escape(a, future, Math.min(a.stamina, Math.floor((FUSE - 0.3) / a.speed)));
      const planted = retreat && plant(a);
      a.arming = 0;
      a.bombAt = elapsed + (a.role === 'bomber' ? 3.1 : 4) + env.random() * 0.5;
      if (planted) {
        startMove(a, ...retreat);
        return;
      }
    }
    const nearCrate = DIRS.some(([dx, dy]) => board[a.y + dy]?.[a.x + dx] >= 2);
    const attack = blastCells(board, a.x, a.y, a.range).some(([x, y]) =>
      players.some((p) => p.alive && p.x === x && p.y === y),
    );
    if (
      elapsed >= a.bombAt &&
      a.stamina === (a.role === 'scout' ? 6 : a.role === 'warden' ? 3 : 4) &&
      (nearCrate || attack)
    ) {
      const future = new Set([
        ...danger,
        ...blastCells(board, a.x, a.y, a.range).map(([x, y]) => key(x, y)),
      ]);
      if (escape(a, future, Math.min(a.stamina, Math.floor((FUSE - 0.3) / a.speed)))) {
        a.arming = elapsed + 0.5;
        a.bombAt = elapsed + 4;
        return;
      }
    }
    if (elapsed < a.thinkAt) return;
    const options = DIRS.filter(
      ([dx, dy]) =>
        canMove(a.x + dx, a.y + dy, a) &&
        !danger.has(key(a.x + dx, a.y + dy)) &&
        !activeAt(a.x + dx, a.y + dy),
    );
    if (options.length) {
      if (a.role === 'scout')
        options.sort(
          (u, v) =>
            Math.abs(a.x + u[0] - players[0].x) +
            Math.abs(a.y + u[1] - players[0].y) -
            Math.abs(a.x + v[0] - players[0].x) -
            Math.abs(a.y + v[1] - players[0].y),
        );
      startMove(
        a,
        ...(a.role === 'scout' ? options[0] : options[Math.floor(env.random() * options.length)]),
      );
    }
    a.thinkAt = elapsed + 0.12;
  }
  function hitActors() {
    for (const a of all()) {
      if (!a.alive) continue;
      const hit = flames.find(
        (f) =>
          f.until > elapsed + 1e-9 &&
          Math.abs(a.px - f.x) < 0.5 + RADIUS &&
          Math.abs(a.py - f.y) < 0.5 + RADIUS,
      );
      if (hit) {
        a.alive = false;
        a.moving = null;
        if (a.ai) score += hit.owners.includes(0) ? 150 : 50;
        env.sound('hit');
        continue;
      }
      if (!a.moving) {
        const pickup = pickups.find(
          (p) => p.x === a.x && p.y === a.y && p.protectedUntil < elapsed,
        );
        if (pickup) {
          if (pickup.type === 'range') a.range = Math.min(a.ai ? 3 : 4, a.range + 1);
          else a.capacity = Math.min(a.ai ? 1 : 3, a.capacity + 1);
          pickups = pickups.filter((p) => p !== pickup);
          if (a.id === 0) score += 25;
          env.sound('coin');
        }
      }
    }
  }
  function checkRound() {
    if (env.mode === 2) {
      if (players.some((p) => !p.alive)) {
        const living = players.filter((p) => p.alive);
        finish(
          players[0].alive,
          living.length
            ? env.t(
                `Player ${living[0].id + 1} wins the garden!`,
                `玩家${living[0].id + 1}赢得花园对决！`,
              )
            : env.t('A double knockout! The garden is a draw.', '双双出局！花园对决平局。'),
        );
      }
    } else if (!players[0].alive) {
      lives--;
      score = stageScore;
      if (lives <= 0)
        finish(
          false,
          env.t(
            'Out of hearts. Leave an escape route before planting.',
            '生命耗尽。放置炸弹前请留下逃生路线。',
          ),
        );
      else respawn = 1.2;
    } else if (enemies.every((e) => !e.alive)) {
      transition = 1.3;
      score += Math.ceil(time) * 3;
      env.sound('win');
    }
  }
  function tick(dt, input) {
    elapsed += dt;
    banner = Math.max(0, banner - dt);
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
    }
    particles = particles.filter((p) => p.life > 0).slice(-100);
    if (respawn > 0) {
      respawn = Math.max(0, respawn - dt);
      if (respawn === 0) newGarden();
      return;
    }
    if (transition > 0) {
      transition = Math.max(0, transition - dt);
      if (transition === 0) {
        if (level === 6) {
          finish(true, env.t('All six gardens are clear!', '六座花园全部清空！'));
          return;
        }
        stageUpgrades = { range: players[0].range, capacity: players[0].capacity };
        stageScore = score;
        level++;
        lives = Math.min(3, lives + 1);
        newGarden();
      }
      return;
    }
    time -= dt;
    if (time <= 0) {
      finish(
        false,
        env.mode === 2
          ? env.t('Time is up. The duel is a draw.', '时间到，双方平局。')
          : env.t('Time is up. Find a faster route.', '时间到，请寻找更快的路线。'),
      );
      return;
    }
    const intents = [];
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      let dx = 0,
        dy = 0;
      if (i === 0) {
        dx =
          Number(input.held('KeyD', ...(env.mode === 2 ? [] : ['ArrowRight']))) -
          Number(input.held('KeyA', ...(env.mode === 2 ? [] : ['ArrowLeft'])));
        dy =
          Number(input.held('KeyS', ...(env.mode === 2 ? [] : ['ArrowDown']))) -
          Number(input.held('KeyW', ...(env.mode === 2 ? [] : ['ArrowUp'])));
        if (input.pressed('Space', 'KeyJ')) a.pendingBomb = true;
      } else {
        dx = Number(input.held('ArrowRight')) - Number(input.held('ArrowLeft'));
        dy = Number(input.held('ArrowDown')) - Number(input.held('ArrowUp'));
        if (input.pressed('Enter', 'Slash')) a.pendingBomb = true;
      }
      if (env.mode !== 2 && input.pointer.clicked) {
        const vx = input.pointer.x - (OX + a.px * CELL + 15),
          vy = input.pointer.y - (OY + a.py * CELL + 15);
        if (Math.hypot(vx, vy) < 14) a.pendingBomb = true;
        else if (Math.abs(vx) > Math.abs(vy)) dx = Math.sign(vx);
        else dy = Math.sign(vy);
      }
      if (a.pendingBomb && !a.moving) {
        plant(a);
        a.pendingBomb = false;
      }
      if (a.alive && !a.moving && (dx || dy)) {
        const direction = [dx, dx ? 0 : dy];
        intents.push({
          a,
          dx: direction[0],
          dy: direction[1],
          x: a.x + direction[0],
          y: a.y + direction[1],
        });
      }
    }
    for (const intent of intents)
      if (intents.filter((i) => i.x === intent.x && i.y === intent.y).length === 1)
        startMove(intent.a, intent.dx, intent.dy);
    for (const a of enemies) enemyDecision(a);
    for (const a of all())
      if (a.alive && a.moving) {
        a.moving.progress = Math.min(1, a.moving.progress + dt / a.speed);
        const t = a.moving.progress;
        a.px = a.x + (a.moving.x - a.x) * t;
        a.py = a.y + (a.moving.y - a.y) * t;
        a.moveClock = Math.max(0, a.speed * (1 - t));
        a.anim = t;
        if (t >= 1 - 1e-9) {
          a.x = a.moving.x;
          a.y = a.moving.y;
          a.px = a.x;
          a.py = a.y;
          a.moving = null;
          a.moveClock = 0;
          if (a.ai) {
            a.stamina--;
            if (a.stamina <= 0)
              a.restUntil =
                elapsed + (a.role === 'scout' ? 0.65 : a.role === 'warden' ? 1.1 : 0.85);
          }
          if (a.pendingBomb) {
            plant(a);
            a.pendingBomb = false;
          }
        }
      }
    for (const b of bombs)
      b.passIds = b.passIds.filter((id) => {
        const a = all().find((p) => p.id === id);
        return a?.alive && Math.hypot(a.px - b.x, a.py - b.y) <= RADIUS + 0.32;
      });
    processEvents();
    flames = flames.filter((f) => f.emberUntil > elapsed);
    hitActors();
    checkRound();
  }
  function update(dt, input) {
    if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    const count = Math.max(1, Math.ceil(Math.min(dt, 1 / 30) * 240)),
      sub = Math.min(dt, 1 / 30) / count;
    for (let i = 0; i < count && phase === 'playing'; i++)
      tick(
        sub,
        i === 0
          ? input
          : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      );
  }
  return {
    update,
    draw(ctx) {
      background(ctx, '#183b35');
      ctx.fillStyle = '#0f282b';
      ctx.fillRect(0, 0, 480, 40);
      drawPixelText(
        ctx,
        env.mode === 2 ? env.t('DUEL', '对决') : `${env.t('GARDEN', '花园')} ${level}/6`,
        16,
        11,
        '#d8eab7',
        12,
      );
      if (env.mode === 2) {
        for (const p of players)
          drawPixelText(
            ctx,
            env.t(
              `P${p.id + 1} RANGE ${p.range} BOMBS ${p.capacity}`,
              `玩家${p.id + 1} 火力${p.range} 炸弹${p.capacity}`,
            ),
            p.id === 0 ? 84 : 270,
            12,
            p.id === 0 ? '#a0e0d3' : '#edcf88',
            10,
          );
      } else
        drawPixelText(
          ctx,
          `${env.t('RANGE', '火力')} ${players[0].range}  ${env.t('BOMBS', '炸弹')} ${players[0].capacity}`,
          170,
          12,
          '#a6d6b5',
          10,
        );
      drawPixelText(
        ctx,
        `${Math.max(0, Math.ceil(time))}s`,
        462,
        11,
        time < 20 ? '#ff9a76' : '#f5edc6',
        12,
        'right',
      );
      drawPixelText(
        ctx,
        env.mode === 2
          ? env.t('DUEL · FOUR-PORT CHARGES', '对决 · 四向喷焰')
          : env.t('HEARTS ', '生命 ') + lives,
        16,
        27,
        '#dcb689',
        10,
      );
      drawPixelText(
        ctx,
        env.t('WALLS / CRATES STOP JETS', '墙壁 / 木箱可挡喷焰'),
        462,
        27,
        '#9ac5ac',
        10,
        'right',
      );
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const px = OX + x * CELL,
            py = OY + y * CELL;
          ctx.fillStyle = (x + y) % 2 ? GARDENS[level - 1].ground : '#24443f';
          ctx.fillRect(px, py, CELL, CELL);
          if (wet.has(key(x, y))) {
            ctx.fillStyle = '#315f6a';
            ctx.fillRect(px + 1, py + 1, 28, 28);
            ctx.fillStyle = '#709ca0';
            ctx.fillRect(px + 5, py + 12, 18, 2);
            ctx.fillRect(px + 9, py + 18, 14, 2);
          }
          if (board[y][x] === 3) {
            ctx.fillStyle = '#653d32';
            ctx.fillRect(px + 5, py + 5, 20, 22);
            ctx.fillStyle = '#c88c53';
            ctx.fillRect(px + 5, py + 7, 20, 3);
            ctx.fillRect(px + 5, py + 22, 20, 3);
            ctx.fillStyle = '#ffe5a0';
            ctx.fillRect(px + 13, py + 10, 4, 11);
            ctx.fillRect(px + 9, py + 14, 12, 3);
          }
          if (board[y][x] === 1) {
            ctx.fillStyle = '#5b7a6c';
            ctx.fillRect(px + 1, py + 1, 28, 28);
            ctx.fillStyle = '#9bb8a0';
            ctx.fillRect(px + 2, py + 2, 25, 5);
            ctx.fillStyle = '#3b5b53';
            ctx.fillRect(px + 4, py + 11, 8, 3);
            ctx.fillRect(px + 17, py + 21, 8, 3);
          }
          if (board[y][x] === 2) {
            ctx.fillStyle = '#654b36';
            ctx.fillRect(px + 2, py + 5, 26, 24);
            ctx.fillStyle = '#bc9359';
            ctx.fillRect(px + 3, py + 3, 24, 21);
            ctx.fillStyle = '#815e38';
            ctx.fillRect(px + 5, py + 10, 20, 3);
            ctx.fillRect(px + 5, py + 18, 20, 3);
            ctx.fillStyle = '#8fba72';
            ctx.fillRect(px + 11, py, 5, 6);
          }
        }
      for (const p of pickups) {
        const x = OX + p.x * CELL,
          y = OY + p.y * CELL;
        ctx.fillStyle = '#fae5a4';
        ctx.fillRect(x + 7, y + 7, 16, 16);
        drawPixelText(ctx, p.type === 'range' ? '+' : 'B', x + 15, y + 8, '#b75a41', 13, 'center');
      }
      for (const b of bombs)
        for (const [x, y] of blastCells(board, b.x, b.y, b.range)) {
          if (board[y][x] === 1) continue;
          ctx.fillStyle = b.at - elapsed < 0.75 ? '#ffc67755' : '#f3c87820';
          ctx.fillRect(OX + x * CELL + 12, OY + y * CELL + 12, 6, 6);
        }
      for (const b of bombs) {
        const x = OX + b.x * CELL,
          y = OY + b.y * CELL;
        ctx.fillStyle =
          b.at - elapsed < 0.65 && Math.floor(elapsed * 12) % 2 ? '#d6654e' : '#192b33';
        ctx.fillRect(x + 7, y + 9, 17, 16);
        ctx.fillRect(x + 10, y + 6, 11, 22);
        ctx.fillStyle = '#efcf88';
        ctx.fillRect(x + 15, y + 4, 4, 6);
        ctx.fillStyle = '#ff8054';
        ctx.fillRect(x + 18, y + 2, 4, 4);
        ctx.fillStyle = '#82939b';
        ctx.fillRect(x + 3, y + 14, 7, 4);
        ctx.fillRect(x + 20, y + 14, 7, 4);
        ctx.fillRect(x + 13, y + 5, 4, 7);
        ctx.fillRect(x + 13, y + 21, 4, 7);
        drawPixelText(
          ctx,
          Math.max(0, b.at - elapsed).toFixed(1),
          x + 15,
          y - 3,
          '#fff2c8',
          10,
          'center',
        );
        ctx.fillStyle = b.owner === 0 ? '#9ce7dc' : b.owner === 1 ? '#f1cf81' : '#eeb099';
        ctx.fillRect(x + 12, y + 13, 6, 5);
      }
      for (const f of flames)
        for (const [x, y] of [[f.x, f.y]]) {
          const px = OX + x * CELL,
            py = OY + y * CELL;
          if (f.until <= elapsed) {
            ctx.fillStyle = '#ad7550';
            ctx.fillRect(px + 7, py + 23, 3, 2);
            ctx.fillRect(px + 19, py + 19, 3, 2);
            continue;
          }
          ctx.strokeStyle = '#ffb764';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1, py + 1, 28, 28);
          ctx.fillStyle = '#e87847';
          ctx.fillRect(px + 1, py + 6, 28, 18);
          ctx.fillRect(px + 6, py + 1, 18, 28);
          ctx.fillStyle = '#ffe199';
          ctx.fillRect(px + 9, py + 3, 12, 24);
          ctx.fillRect(px + 3, py + 9, 24, 12);
        }
      for (const f of fronts) {
        if (board[f.y]?.[f.x] === 1 || board[f.y]?.[f.x] === undefined) continue;
        const t = Math.max(0, Math.min(1, 1 - (f.at - elapsed) / FRONT_STEP)),
          x = OX + (f.x - f.dx * (1 - t)) * CELL + 15,
          y = OY + (f.y - f.dy * (1 - t)) * CELL + 15;
        ctx.fillStyle = '#fff0b4';
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillRect(x - f.dx * 6 - 2, y - f.dy * 6 - 2, 4, 4);
      }
      for (const a of [...players, ...enemies])
        if (a.alive) {
          const ax = OX + a.px * CELL + 7,
            ay = OY + a.py * CELL + 7;
          pixelSprite(ctx, BODY, ax, ay, 2, {
            a: a.ai ? '#d17b79' : a.id === 0 ? '#83ddd0' : '#efc467',
            b: '#fff0d1',
            c: '#293d43',
            d: a.ai ? '#89545c' : a.id === 0 ? '#3f8f93' : '#bd8750',
            e: '#18333a',
          });
          if (!a.ai && env.mode === 2)
            drawPixelText(ctx, String(a.id + 1), ax + 8, ay - 5, '#f7e7b7', 9, 'center');
          if (a.ai) {
            if (a.restUntil > elapsed)
              drawPixelText(ctx, 'Z', ax + 8, ay - 8, '#c0dcb6', 10, 'center');
            if (a.arming > elapsed) {
              ctx.fillStyle = '#fff0ad';
              ctx.fillRect(ax + 5, ay - 9, 6, 5);
            }
            ctx.fillStyle =
              a.role === 'warden' ? '#e6cf7e' : a.role === 'bomber' ? '#f4a480' : '#bfe8cd';
            ctx.fillRect(ax + 3, ay - 3, a.role === 'warden' ? 10 : 6, 3);
          }
        }
      for (const p of particles) {
        ctx.fillStyle = '#be9359';
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      if (banner > 0 && transition <= 0 && respawn <= 0) {
        ctx.fillStyle = '#152f2ddd';
        ctx.fillRect(85, 282, 310, 30);
        drawPixelText(
          ctx,
          env.mode === 2
            ? env.t('SYMMETRIC DUEL ARENA', '对称决斗场')
            : env.t(GARDENS[level - 1].en, GARDENS[level - 1].zh),
          240,
          285,
          '#f2e0ac',
          13,
          'center',
        );
        drawPixelText(
          ctx,
          env.t('2.4s FUSE · LEAVE A SIDE EXIT', '2.4秒引信 · 留好侧向退路'),
          240,
          299,
          '#b9d8bd',
          10,
          'center',
        );
      }
      if (transition > 0 || respawn > 0) {
        ctx.fillStyle = '#152f2deb';
        ctx.fillRect(60, 144, 360, 42);
        drawPixelText(
          ctx,
          respawn > 0
            ? env.t('TRY AGAIN — ' + lives + ' HEARTS', '再试一次 — ' + lives + ' 生命')
            : env.t('GARDEN CLEARED!', '花园已清空！'),
          240,
          157,
          '#f5e4ac',
          18,
          'center',
        );
      }
    },
    getState() {
      return {
        phase,
        score,
        level,
        time,
        totalLevels: 6,
        lives,
        respawn,
        transition,
        elapsed,
        garden: { en: GARDENS[level - 1].en, zh: GARDENS[level - 1].zh },
        danger: [...dangerSet()].map((k) => k.split(',').map(Number)),
        wetCells: [...wet].map((k) => k.split(',').map(Number)),
        board: board.map((row) => [...row]),
        players: players.map((p) => structuredClone(p)),
        enemies: enemies.map((p) => structuredClone(p)),
        bombs: bombs.map((b) => ({
          ...b,
          passIds: [...b.passIds],
          fuse: Math.max(0, b.at - elapsed),
        })),
        fronts: fronts.map((f) => ({ ...f })),
        flames: flames.map((f) => ({
          ...f,
          owners: [...f.owners],
          cells: [[f.x, f.y]],
          active: f.until > elapsed,
          life: Math.max(0, f.emberUntil - elapsed),
        })),
        pickups: pickups.map((p) => ({ ...p })),
        status: {
          en:
            env.mode === 2
              ? 'Local duel · Four-port charges · Last gardener standing'
              : `Garden ${level}/6 · ${lives} hearts · ${enemies.filter((e) => e.alive).length} rivals`,
          zh:
            env.mode === 2
              ? '本地对战 · 四向喷焰炸弹 · 最后幸存者获胜'
              : `花园 ${level}/6 · ${lives} 生命 · 剩余 ${enemies.filter((e) => e.alive).length} 个对手`,
        },
      };
    },
  };
}
