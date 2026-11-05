import { background, drawPixelText as text, clamp, pixelSprite } from '../shared/utils.js';
export const meta = {
  id: 'crate-keeper',
  name: { en: 'Crate Keeper', zh: '仓库守护者' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Push one crate at a time onto every marked dock. Eight different warehouses; undo freely, ask for a hint or reset the room. Inspect a finished room, then choose Next to commit it.',
    zh: '每次推动一个木箱，把所有箱子放到标记货位。八间不同仓库，可随时撤销、查看提示或重置本关。完成后可先检查，再选下一关确认。',
  },
  keys: [
    {
      label: { en: 'Walk / push one tile', zh: '行走 / 推箱一格' },
      keys: { en: 'Arrows / WASD; tap an adjacent tile', zh: '方向键 / WASD；点击相邻格' },
    },
    { label: { en: 'Undo', zh: '撤销' }, keys: 'Z' },
    { label: { en: 'Hint', zh: '提示' }, keys: 'H' },
    { label: { en: 'Reset this warehouse', zh: '重置本关' }, keys: 'X' },
    { label: { en: 'Next after solving', zh: '完成后进入下一关' }, keys: 'Enter' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
    ['KeyZ', 'Undo', '撤销'],
    ['KeyH', 'Hint', '提示'],
    ['KeyX', 'Reset room', '重置本关'],
    ['Enter', 'Next', '下一关'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};
export const LEVELS = [
  ['#######', '#     #', '# @$. #', '#     #', '#######'],
  ['#######', '# .   #', '# #$  #', '# @   #', '#     #', '#######'],
  ['########', '# .  . #', '# $  $ #', '#      #', '#  @   #', '########'],
  ['########', '#  .   #', '#      #', '# $ #  #', '#   @  #', '#      #', '########'],
  ['########', '# . .  #', '#   #  #', '# $$   #', '#  @   #', '#      #', '########'],
  ['########', '#  .   #', '#  #   #', '# $$ $ #', '# .# . #', '#   @  #', '########'],
  [
    '#########',
    '# . # . #',
    '#   #   #',
    '# $   $ #',
    '##  #  ##',
    '#   $   #',
    '#   . @ #',
    '#########',
  ],
  [
    '#########',
    '# .   . #',
    '#   .   #',
    '#   #   #',
    '# $ $ $ #',
    '# #   # #',
    '#   @   #',
    '#########',
  ],
];
const TITLES = [
  ['Receiving dock', '收货码头'],
  ['Side passage', '侧边通道'],
  ['Twin freight', '双箱货运'],
  ['Around the pillar', '绕过立柱'],
  ['Split aisle', '分隔过道'],
  ['Switchback', '回转仓库'],
  ['Two wings', '双翼仓库'],
  ['Central junction', '中央枢纽'],
];
const PAR_PUSHES = [1, 2, 2, 3, 5, 6, 7, 14];
const EPS = 1e-8;
const DIRECTIONS = [
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowUp', 0, -1],
  ['ArrowDown', 0, 1],
];
const LESSONS = [
  ['Stand behind a crate and push it onto the dock.', '站在箱子后面，把它推到货位。'],
  ['Use the side passage to get behind the crate.', '利用侧通道绕到箱子后面。'],
  ['Plan a separate approach for each delivery.', '为两只箱子分别安排推动路线。'],
  ['Walk around the pillar before changing push direction.', '改变推箱方向前，先绕过立柱。'],
  ['Keep the split aisle open for the second crate.', '为第二只箱子保留过道。'],
  ['Use the open floor to reposition between pushes.', '利用空地绕行，调整推动方向。'],
  ['Plan the two wings and the lower delivery together.', '统筹两侧仓区和下方货位的路线。'],
  ['Leave room to turn around the central junction.', '在中央枢纽留出转身绕行的空间。'],
];
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
export function moveState(state, dx, dy) {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1)
    return state;
  const x = state.player % state.w,
    y = Math.floor(state.player / state.w),
    nx = x + dx,
    ny = y + dy;
  if (nx < 0 || nx >= state.w || ny < 0 || ny >= state.h) return state;
  const next = ny * state.w + nx;
  if (state.walls.includes(next)) return state;
  const idx = state.crates.indexOf(next);
  let crates = state.crates;
  if (idx >= 0) {
    const tx = nx + dx,
      ty = ny + dy,
      target = ty * state.w + tx;
    if (
      tx < 0 ||
      tx >= state.w ||
      ty < 0 ||
      ty >= state.h ||
      state.walls.includes(target) ||
      state.crates.includes(target)
    )
      return state;
    crates = state.crates.slice();
    crates[idx] = target;
    crates.sort((a, b) => a - b);
  }
  return { ...state, player: next, crates };
}
function adjacent(s, index, dx, dy) {
  const x = (index % s.w) + dx,
    y = Math.floor(index / s.w) + dy;
  return x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : y * s.w + x;
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
function reach(s) {
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
export function searchLevel(level, maxNodes = 80000) {
  const start = Array.isArray(level) ? parseLevel(level) : level,
    dead = new Set(deadSquares(start)),
    queue = [{ state: start, path: [] }],
    seen = new Set();
  let head = 0;
  for (; head < queue.length && head < maxNodes; head++) {
    const { state, path } = queue[head];
    if (state.crates.every((c) => state.goals.includes(c)))
      return { status: 'solved', path, nodes: head + 1 };
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
        const crates = state.crates.map((c) => (c === crate ? to : c)).sort((a, b) => a - b);
        queue.push({
          state: { ...state, player: crate, crates },
          path: [...path, ...paths.get(behind), key],
        });
      }
  }
  return { status: head >= queue.length ? 'no-route' : 'limited', path: null, nodes: head };
}
export function solveLevel(level, maxNodes = 80000) {
  return searchLevel(level, maxNodes).path;
}
export function crateLayout(w, h) {
  const size = Math.min(46, Math.floor(420 / w), Math.floor(242 / h));
  return { size, ox: Math.floor((480 - w * size) / 2), oy: 42 + Math.floor((242 - h * size) / 2) };
}
const point = (s, index) => ({ x: index % s.w, y: Math.floor(index / s.w) });
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function direction(input) {
  const dx =
      Number(input.pressed('ArrowRight', 'KeyD')) - Number(input.pressed('ArrowLeft', 'KeyA')),
    dy = Number(input.pressed('ArrowDown', 'KeyS')) - Number(input.pressed('ArrowUp', 'KeyW'));
  return dx && dy ? null : dx || dy ? { dx, dy } : null;
}
export function createGame(env) {
  let level = 1,
    state = parseLevel(LEVELS[0]),
    history = [],
    moves = 0,
    pushes = 0,
    totalMoves = 0,
    totalPushes = 0,
    score = 0,
    phase = 'playing',
    time = 0,
    motion = null,
    pending = null,
    solved = false,
    confirmPending = false,
    pendingUndo = false,
    hint = null,
    hintTimer = 0,
    feedback = { type: 'arrive', life: 0.6 },
    facing = { dx: 0, dy: 1 },
    dead = deadSquares(state);
  const done = () => state.crates.every((c) => state.goals.includes(c));
  const trapped = () => state.crates.filter((c) => dead.includes(c));
  function visuals() {
    const t = motion ? clamp(motion.elapsed / motion.duration, 0, 1) : 1;
    return {
      player: motion
        ? interpolate(motion.player.from, motion.player.to, t)
        : point(state, state.player),
      crate: motion?.crate
        ? { to: motion.crate.toIndex, at: interpolate(motion.crate.from, motion.crate.to, t) }
        : null,
    };
  }
  function load() {
    state = parseLevel(LEVELS[level - 1]);
    dead = deadSquares(state);
    history = [];
    moves = 0;
    pushes = 0;
    motion = null;
    pending = null;
    solved = false;
    confirmPending = false;
    pendingUndo = false;
    hint = null;
    hintTimer = 0;
    facing = { dx: 0, dy: 1 };
    feedback = { type: 'arrive', life: 0.6 };
  }
  function advance() {
    if (!solved || motion) return;
    score += Math.max(100, 1200 - moves * 15);
    totalMoves += moves;
    totalPushes += pushes;
    if (level === LEVELS.length) {
      phase = 'won';
      pending = null;
      hint = null;
      hintTimer = 0;
      feedback = { type: 'complete', life: 1 };
      env.sound('win');
      env.end({
        won: true,
        score,
        message: env.t('All eight warehouses are in order!', '八间仓库全部整理完毕！'),
      });
      return;
    }
    level++;
    load();
    env.sound('win');
  }
  function startMove(dx, dy) {
    if (solved) return;
    const previousFacing = { ...facing },
      next = moveState(state, dx, dy);
    hint = null;
    hintTimer = 0;
    facing = { dx, dy };
    if (next === state) {
      feedback = { type: 'blocked', life: 0.25, cell: adjacent(state, state.player, dx, dy) };
      env.sound('hit');
      return;
    }
    const from = state,
      fromCrate = from.crates.find((c) => !next.crates.includes(c)),
      toCrate = next.crates.find((c) => !from.crates.includes(c)),
      pushed = fromCrate !== undefined;
    history.push({ state: from, moves, pushes, facing: previousFacing });
    state = next;
    moves++;
    if (pushed) pushes++;
    motion = {
      elapsed: 0,
      duration: pushed ? 0.14 : 0.1,
      player: { from: point(state, from.player), to: point(state, next.player) },
      crate: pushed
        ? { from: point(state, fromCrate), to: point(state, toCrate), toIndex: toCrate }
        : null,
    };
    feedback = { type: pushed ? 'push' : 'walk', life: 0.25 };
    env.sound(pushed ? 'coin' : 'move');
  }
  // Rewind each cardinal segment fully before accepting a second undo.
  function undo() {
    pending = null;
    confirmPending = false;
    hint = null;
    hintTimer = 0;
    if (motion) {
      pendingUndo = true;
      return;
    }
    pendingUndo = false;
    pending = null;
    confirmPending = false;
    hint = null;
    hintTimer = 0;
    if (!history.length) return;
    const visible = visuals(),
      old = state,
      last = history.pop();
    state = last.state;
    moves = last.moves;
    pushes = last.pushes;
    facing = last.facing;
    solved = false;
    const fromCrate = old.crates.find((c) => !state.crates.includes(c)),
      toCrate = state.crates.find((c) => !old.crates.includes(c));
    motion = {
      elapsed: 0,
      duration: 0.1,
      player: { from: visible.player, to: point(state, state.player) },
      crate:
        fromCrate !== undefined
          ? {
              from: visible.crate?.to === fromCrate ? visible.crate.at : point(state, fromCrate),
              to: point(state, toCrate),
              toIndex: toCrate,
            }
          : null,
    };
    feedback = { type: 'undo', life: 0.35 };
    env.sound('move');
  }
  function askHint() {
    pending = null;
    pendingUndo = false;
    const result = searchLevel(state, 40000),
      names = {
        ArrowLeft: env.t('← LEFT', '← 向左'),
        ArrowRight: env.t('RIGHT →', '向右 →'),
        ArrowUp: env.t('↑ UP', '↑ 向上'),
        ArrowDown: env.t('DOWN ↓', '向下 ↓'),
      };
    hint = {
      status: result.status,
      code: result.path?.[0] ?? null,
      text: result.path?.length
        ? env.t('NEXT: ', '下一步：') + names[result.path[0]]
        : result.status === 'limited'
          ? env.t(
              'Search limit reached. Undo or reset remains available.',
              '搜索达到上限，仍可撤销或重置。',
            )
          : result.status === 'solved'
            ? env.t('All docks filled. Choose Next when ready.', '货位已满，准备好后选择下一关。')
            : env.t(
                'No route from here. Undo or reset the room.',
                '此处已无解，请撤销或重置本关。',
              ),
    };
    hintTimer = 4;
    env.sound('move');
  }
  function tick(dt) {
    let remaining = dt;
    while (remaining > EPS && phase === 'playing') {
      const t = motion ? Math.min(remaining, motion.duration - motion.elapsed) : remaining;
      time += t;
      hintTimer = Math.max(0, hintTimer - t);
      if (feedback) feedback.life = Math.max(0, feedback.life - t);
      if (motion) motion.elapsed += t;
      remaining -= t;
      if (motion && motion.elapsed >= motion.duration - 1e-8) {
        motion = null;
        if (pendingUndo) {
          pendingUndo = false;
          undo();
          continue;
        }
        if (done()) {
          solved = true;
          pending = null;
          feedback = { type: 'solved', life: 0.6 };
          if (confirmPending) {
            confirmPending = false;
            advance();
          }
        } else if (pending) {
          const action = pending;
          pending = null;
          if (action.expires >= time - 1e-8) startMove(action.dx, action.dy);
        }
      }
    }
  }
  function update(dt, input) {
    if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = Math.min(dt, 1 / 30);
    if (input.pressed('KeyX')) {
      load();
      env.sound('move');
      tick(elapsed);
      return;
    }
    if (input.pressed('KeyZ')) {
      undo();
      tick(elapsed);
      return;
    }
    if (input.pressed('KeyH')) {
      askHint();
      tick(elapsed);
      return;
    }
    if (input.pressed('Enter')) {
      pendingUndo = false;
      pending = null;
      if (done()) {
        if (motion) confirmPending = true;
        else {
          solved = true;
          advance();
        }
      }
      tick(elapsed);
      return;
    }
    let action = direction(input);
    if (
      !action &&
      !input.pressed(
        'ArrowLeft',
        'KeyA',
        'ArrowRight',
        'KeyD',
        'ArrowUp',
        'KeyW',
        'ArrowDown',
        'KeyS',
      ) &&
      input.pointer.clicked
    ) {
      const { size, ox, oy } = crateLayout(state.w, state.h),
        x = Math.floor((input.pointer.x - ox) / size),
        y = Math.floor((input.pointer.y - oy) / size),
        dx = x - (state.player % state.w),
        dy = y - Math.floor(state.player / state.w);
      if (Math.abs(dx) + Math.abs(dy) === 1) action = { dx, dy };
    }
    if (action && !solved) {
      if (motion) pending = { ...action, expires: time + 0.28 };
      else startMove(action.dx, action.dy);
    }
    tick(elapsed);
  }
  function draw(ctx) {
    drawWarehouse(
      ctx,
      {
        level,
        state,
        moves,
        pushes,
        totalMoves,
        score,
        phase,
        time,
        motion,
        solved,
        hint: hintTimer > 0 ? hint : null,
        feedback,
        trapped: trapped(),
        facing,
        visual: visuals(),
      },
      env,
    );
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      level,
      moves,
      pushes,
      totalMoves,
      totalPushes,
      time,
      solved,
      busy: Boolean(motion),
      motion: structuredClone(motion),
      pending: structuredClone(pending),
      confirmPending,
      pendingUndo,
      parPushes: PAR_PUSHES[level - 1],
      deadlocked: trapped().length > 0,
      deadCrates: trapped(),
      undoCount: history.length,
      transition: 0,
      hint: hintTimer > 0 ? (hint?.text ?? null) : null,
      hintCode: hintTimer > 0 ? (hint?.code ?? null) : null,
      hintStatus: hintTimer > 0 ? (hint?.status ?? null) : null,
      ...structuredClone(state),
      status: {
        en: `Warehouse ${level}/8 · ${moves} moves · ${solved ? 'Complete. Undo, reset, or choose Next.' : trapped().length ? 'Crate cannot reach a dock. Undo or reset.' : LESSONS[level - 1][0]}`,
        zh: `仓库 ${level}/8 · ${moves} 步 · ${solved ? '已完成，可撤销、重置或选择下一关。' : trapped().length ? '箱子无法到达货位，请撤销或重置。' : LESSONS[level - 1][1]}`,
      },
    }),
  };
}
function drawWarehouse(ctx, s, env) {
  const { state, level } = s,
    { size, ox, oy } = crateLayout(state.w, state.h),
    tones = [
      ['#293e46', '#65767d', '#b7a077'],
      ['#293d49', '#607282', '#93b1b2'],
      ['#353e49', '#737a82', '#c6aa81'],
    ][Math.floor((level - 1) / 3)];
  background(ctx, '#172c36');
  for (let n = 0; n < 14; n++) {
    const x = n * 37;
    ctx.fillStyle = n % 2 ? '#203640' : '#223b44';
    ctx.fillRect(x, 40, 2, 246);
    ctx.fillStyle = '#334b51';
    ctx.fillRect(x + 7, 49, 19, 2);
    ctx.fillRect(x + 7, 274, 19, 2);
  }
  for (const x of [20, 450]) {
    ctx.fillStyle = '#354b50';
    ctx.fillRect(x, 62, 10, 188);
    ctx.fillStyle = '#65736e';
    ctx.fillRect(x + 2, 64, 2, 182);
    for (let y = 83; y < 246; y += 31) {
      ctx.fillStyle = '#afa87b';
      ctx.fillRect(x + 3, y, 5, 3);
    }
  }
  ctx.fillStyle = '#101f29';
  ctx.fillRect(ox - 4, oy - 4, state.w * size + 8, state.h * size + 8);
  for (let y = 0; y < state.h; y++)
    for (let x = 0; x < state.w; x++) {
      const i = y * state.w + x,
        px = ox + x * size,
        py = oy + y * size;
      if (state.walls.includes(i)) {
        ctx.fillStyle = '#374c59';
        ctx.fillRect(px, py, size, size);
        ctx.fillStyle = tones[1];
        ctx.fillRect(px + 1, py + 1, size - 2, size - 4);
        ctx.fillStyle = '#879394';
        ctx.fillRect(px + 2, py + 2, size - 4, 2);
        ctx.fillStyle = '#293f4c';
        ctx.fillRect(px + 1, py + size - 5, size - 2, 4);
        ctx.fillRect(px + size - 3, py + 3, 2, size - 7);
        ctx.fillStyle = '#4a5e68';
        const seam = x % 2 ? size * 0.35 : size * 0.65;
        ctx.fillRect(px + seam, py + 5, 1, size - 12);
        ctx.fillRect(px + 3, py + Math.floor(size * 0.58), size - 6, 1);
        if ((x + y) % 3 === 0) {
          ctx.fillStyle = tones[2];
          ctx.fillRect(px + 4, py + size - 9, 3, 2);
          ctx.fillRect(px + 10, py + size - 9, 3, 2);
        }
      } else {
        ctx.fillStyle = (x + y) % 2 ? tones[0] : '#2f454e';
        ctx.fillRect(px, py, size, size);
        ctx.fillStyle = '#3c535b';
        ctx.fillRect(px + 1, py + 1, size - 2, 1);
        ctx.fillStyle = '#20343f';
        ctx.fillRect(px + size - 1, py, 1, size);
        ctx.fillRect(px, py + size - 1, size, 1);
        ctx.fillStyle = '#4b5e60';
        ctx.fillRect(px + 6, py + 7, 3, 1);
        if ((x + y) % 3 === 0) ctx.fillRect(px + size - 10, py + size - 8, 5, 1);
        if (state.goals.includes(i)) {
          ctx.strokeStyle = '#c9b56e';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 4, py + 4, size - 8, size - 8);
          ctx.fillStyle = '#d7c58a';
          ctx.fillRect(px + size / 2 - 2, py + 8, 4, size - 16);
          ctx.fillRect(px + 8, py + size / 2 - 2, size - 16, 4);
          ctx.fillStyle = '#233a42';
          ctx.fillRect(px + size / 2 - 3, py + size / 2 - 3, 6, 6);
        }
      }
    }
  if (s.hint?.code) {
    const [, dx, dy] = DIRECTIONS.find((d) => d[0] === s.hint.code),
      n = adjacent(state, state.player, dx, dy);
    if (n >= 0) {
      const px = ox + (n % state.w) * size,
        py = oy + Math.floor(n / state.w) * size;
      ctx.strokeStyle = '#e6e1b5';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, size - 4, size - 4);
      text(
        ctx,
        { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[s.hint.code],
        px + size - 8,
        py + 3,
        '#eee4b6',
        12,
        'center',
      );
    }
  }
  for (const crate of state.crates) {
    const pos = s.visual.crate?.to === crate ? s.visual.crate.at : point(state, crate),
      px = ox + pos.x * size,
      py = oy + pos.y * size,
      moving = s.motion?.crate?.toIndex === crate,
      done = state.goals.includes(crate) && !moving,
      margin = Math.max(4, Math.floor(size * 0.13)),
      w = size - margin * 2;
    ctx.fillStyle = '#152b35aa';
    ctx.fillRect(px + margin + 1, py + size - margin - 1, w, 3);
    ctx.fillStyle = done ? '#335e4f' : '#634d3b';
    ctx.fillRect(px + margin, py + margin, w, w);
    ctx.fillStyle = done ? '#739b6d' : '#b28b59';
    ctx.fillRect(px + margin + 2, py + margin + 2, w - 4, w - 4);
    ctx.fillStyle = done ? '#a2bf89' : '#dbc18a';
    ctx.fillRect(px + margin + 2, py + margin + 2, w - 4, 3);
    ctx.fillStyle = done ? '#4a7659' : '#8a6847';
    ctx.fillRect(px + size / 2 - 1, py + margin + 6, 2, w - 9);
    ctx.fillRect(px + margin + 3, py + size / 2, w - 6, 2);
    ctx.strokeStyle = done ? '#c7daa1' : '#6e533a';
    ctx.lineWidth = Math.max(2, Math.floor(size / 15));
    ctx.beginPath();
    if (done) {
      ctx.moveTo(px + size * 0.3, py + size * 0.51);
      ctx.lineTo(px + size * 0.45, py + size * 0.67);
      ctx.lineTo(px + size * 0.73, py + size * 0.35);
    } else {
      ctx.moveTo(px + margin + 5, py + margin + 5);
      ctx.lineTo(px + size - margin - 5, py + size - margin - 5);
      ctx.moveTo(px + size - margin - 5, py + margin + 5);
      ctx.lineTo(px + margin + 5, py + size - margin - 5);
    }
    ctx.stroke();
    ctx.fillStyle = done ? '#c7d89e' : '#e1c697';
    for (const [dx, dy] of [
      [margin + 3, margin + 4],
      [size - margin - 5, margin + 4],
      [margin + 3, size - margin - 6],
      [size - margin - 5, size - margin - 6],
    ])
      ctx.fillRect(px + dx, py + dy, 2, 2);
    if (s.trapped.includes(crate)) {
      ctx.strokeStyle = '#ebbaa0';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + margin - 2, py + margin - 2, w + 4, w + 4);
      text(ctx, '!', px + size / 2, py + size / 2 - 6, '#fff0bc', 14, 'center');
    }
  }
  const scale = size >= 40 ? 3 : 2,
    player = s.visual.player,
    walk = Boolean(s.motion),
    bob = walk ? Math.sin(clamp(s.motion.elapsed / s.motion.duration, 0, 1) * Math.PI) : 0,
    px = ox + player.x * size + (size - 8 * scale) / 2,
    py = oy + player.y * size + (size - 10 * scale) / 2 - bob;
  ctx.fillStyle = '#142c38aa';
  ctx.beginPath();
  ctx.ellipse(
    ox + (player.x + 0.5) * size,
    oy + (player.y + 0.78) * size,
    size * 0.25,
    3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  const blink = !walk && Math.floor(s.time * 2) % 9 === 8;
  pixelSprite(
    ctx,
    [
      '..YYYY..',
      'YYYYYYYY',
      '.SSSSSS.',
      blink ? '.SKKKKS.' : '.SKSSKS.',
      '..SSSS..',
      '.BBBBBB.',
      'BBYBBYBB',
      '.BBBBBB.',
      '..KKKK..',
      walk && Math.floor(s.motion.elapsed * 25) % 2 ? '.KK...K.' : '.KK..KK.',
    ],
    px,
    py,
    scale,
    { Y: '#e4c481', S: '#e5c6a4', K: '#163241', B: '#83b7be' },
  );
  ctx.fillStyle = '#eff0c1';
  ctx.fillRect(px + 3 * scale, py + scale, 2 * scale, scale);
  ctx.fillStyle = '#e3cf98';
  const cx = ox + (player.x + 0.5) * size,
    cy = oy + (player.y + 0.5) * size;
  ctx.fillRect(cx + s.facing.dx * size * 0.29 - 1, cy + s.facing.dy * size * 0.31 - 1, 3, 3);
  if (s.feedback?.type === 'blocked' && s.feedback.life > 0) {
    ctx.strokeStyle = '#d8ac8c';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      ox + (state.player % state.w) * size + 2,
      oy + Math.floor(state.player / state.w) * size + 2,
      size - 4,
      size - 4,
    );
  }
  if (s.solved) {
    ctx.strokeStyle = '#b5d59a';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 3, oy - 3, state.w * size + 6, state.h * size + 6);
  }
  ctx.fillStyle = '#142b35';
  ctx.fillRect(0, 0, 480, 39);
  ctx.fillRect(0, 287, 480, 33);
  text(ctx, `${env.t('ROOM', '仓库')} ${level}/8`, 12, 7, '#b6c8c3', 12);
  text(ctx, env.t(...TITLES[level - 1]), 240, 6, '#e0d7b6', 14, 'center');
  text(
    ctx,
    `${state.crates.filter((c) => state.goals.includes(c)).length}/${state.crates.length} ${env.t('DOCKED', '入位')}`,
    470,
    7,
    '#c3d2a7',
    12,
    'right',
  );
  text(ctx, env.t(...LESSONS[level - 1]), 240, 24, '#9eb6b8', 12, 'center');
  for (let n = 0; n < 8; n++) {
    ctx.fillStyle = n < level - 1 ? '#c8bc85' : n === level - 1 ? '#8fb4ab' : '#36545f';
    ctx.fillRect(12 + n * 58, 37, 50, 1);
  }
  text(ctx, `${env.t('MOVES', '步数')} ${s.moves}`, 12, 291, '#c9d6cc', 12);
  text(ctx, `${env.t('PUSHES', '推动')} ${s.pushes}`, 148, 291, '#c9d6cc', 12);
  text(ctx, `${env.t('PAR', '标准推数')} ${PAR_PUSHES[level - 1]}`, 286, 291, '#b5c2ad', 12);
  text(ctx, env.t('Z ↶ UNDO', 'Z ↶ 撤销'), 470, 291, '#cbbf98', 12, 'right');
  const message = s.solved
    ? env.t('COMPLETE · ENTER / NEXT TO CONFIRM', '已完成 · 按ENTER或下一关确认')
    : s.hint
      ? s.hint.text
      : s.trapped.length
        ? env.t('CRATE CANNOT REACH A DOCK · Z UNDO / X RESET', '箱子无法到达货位 · Z撤销 / X重置')
        : env.t(
            'One tile per tap · Z undo · H hint · X reset',
            '轻点逐格移动 · Z撤销 · H提示 · X重置',
          );
  text(
    ctx,
    message,
    240,
    306,
    s.solved ? '#cee1a8' : s.trapped.length ? '#ecc19f' : '#a7bfc0',
    12,
    'center',
  );
}
