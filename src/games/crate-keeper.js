import { background, drawPixelText, clamp, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'crate-keeper',
  name: { en: 'Crate Keeper', zh: '仓库守护者' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
    { code: 'KeyZ', label: { en: 'Undo', zh: '撤销' } },
    { code: 'KeyH', label: { en: 'Hint', zh: '提示' } },
  ],
  description: {
    en: 'Push every crate onto a golden marker. Eight warehouses, unlimited undo, and a hint when you need one.',
    zh: '把每个木箱推到金色标记上。挑战八间仓库，可无限撤销并获取提示。',
  },
  keys: [
    { label: { en: 'Walk / push', zh: '行走 / 推箱' }, keys: 'Arrows / WASD / Tap arrows' },
    { label: { en: 'Undo', zh: '撤销' }, keys: 'Z' },
    { label: { en: 'Hint', zh: '提示' }, keys: 'H' },
  ],
};
export const LEVELS = [
  ['#######', '#     #', '# @$. #', '#     #', '#######'],
  ['#######', '# .   #', '# $   #', '# @   #', '#     #', '#######'],
  ['########', '# .  . #', '# $  $ #', '#      #', '#  @   #', '########'],
  ['########', '#  .   #', '#      #', '# $ #  #', '#   @  #', '#      #', '########'],
  ['########', '# . .  #', '#   #  #', '# $$   #', '#  @   #', '#      #', '########'],
  ['#########', '#   .   #', '# #   # #', '# $ $   #', '#   #   #', '#   @ . #', '#########'],
  [
    '#########',
    '# . . . #',
    '#       #',
    '# $ # $ #',
    '#   $   #',
    '# #   # #',
    '#   @   #',
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
const DIRECTIONS = [
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowUp', 0, -1],
  ['ArrowDown', 0, 1],
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
function reach(state) {
  const blocked = new Set([...state.walls, ...state.crates]),
    paths = new Map([[state.player, []]]),
    queue = [state.player];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head],
      x = p % state.w,
      y = Math.floor(p / state.w);
    for (const [key, dx, dy] of DIRECTIONS) {
      const nx = x + dx,
        ny = y + dy,
        n = ny * state.w + nx;
      if (nx >= 0 && nx < state.w && ny >= 0 && ny < state.h && !blocked.has(n) && !paths.has(n)) {
        paths.set(n, [...paths.get(p), key]);
        queue.push(n);
      }
    }
  }
  return paths;
}
export function solveLevel(level, maxNodes = 80000) {
  const start = Array.isArray(level) ? parseLevel(level) : level;
  const queue = [{ state: start, path: [] }],
    seen = new Set();
  for (let head = 0; head < queue.length && head < maxNodes; head++) {
    const { state, path } = queue[head];
    if (state.crates.every((c) => state.goals.includes(c))) return path;
    const paths = reach(state),
      signature = state.crates.join(',') + '|' + Math.min(...paths.keys());
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const crate of state.crates)
      for (const [key, dx, dy] of DIRECTIONS) {
        const behind = crate - dy * state.w - dx,
          to = crate + dy * state.w + dx;
        if (!paths.has(behind) || state.walls.includes(to) || state.crates.includes(to)) continue;
        if (to < 0 || to >= state.w * state.h || Math.abs((to % state.w) - (crate % state.w)) > 1)
          continue;
        if (!state.goals.includes(to)) {
          const wall = (n) => n < 0 || n >= state.w * state.h || state.walls.includes(n);
          if ((wall(to - 1) || wall(to + 1)) && (wall(to - state.w) || wall(to + state.w)))
            continue;
        }
        const crates = state.crates.map((c) => (c === crate ? to : c)).sort((a, b) => a - b);
        queue.push({
          state: { ...state, player: crate, crates },
          path: [...path, ...paths.get(behind), key],
        });
      }
  }
  return null;
}
export function createGame(env) {
  let level = 1,
    state = parseLevel(LEVELS[0]),
    history = [],
    moves = 0,
    totalMoves = 0,
    score = 0,
    phase = 'playing',
    transition = 0,
    hint = '',
    hintTimer = 0;
  function undo() {
    if (!history.length) return;
    const last = history.pop();
    state = last.state;
    moves = last.moves;
    transition = 0;
    hint = '';
    env.sound('move');
  }
  function move(dx, dy) {
    const next = moveState(state, dx, dy);
    hint = '';
    if (next === state) {
      env.sound('hit');
      return;
    }
    history.push({ state, moves });
    const pushed = state.crates.some((c) => !next.crates.includes(c));
    state = next;
    moves++;
    env.sound(pushed ? 'coin' : 'move');
    if (state.crates.every((c) => state.goals.includes(c))) transition = 0.8;
  }
  function advance() {
    score += Math.max(100, 1200 - moves * 15);
    totalMoves += moves;
    if (level === LEVELS.length) {
      phase = 'won';
      env.sound('win');
      env.end({
        won: true,
        score,
        message: env.t('All eight warehouses are in order!', '八间仓库全部整理完毕！'),
      });
      return;
    }
    level++;
    state = parseLevel(LEVELS[level - 1]);
    history = [];
    moves = 0;
    hint = '';
    env.sound('win');
  }
  function update(dt, input) {
    if (phase !== 'playing') return;
    dt = clamp(dt, 0, 0.05);
    hintTimer = Math.max(0, hintTimer - dt);
    let action = '';
    if (input.pointer.clicked) {
      const { x, y } = input.pointer;
      if (x >= 367 && x <= 471) {
        if (y >= 238 && y < 266) action = x < 418 ? 'undo' : 'hint';
        else if (y >= 127 && y < 159) action = 'up';
        else if (y >= 167 && y < 199) action = x < 418 ? 'left' : 'right';
        else if (y >= 207 && y < 235) action = 'down';
      }
    }
    if (input.pressed('KeyZ') || action === 'undo') {
      undo();
      return;
    }
    if (transition > 0) {
      transition -= dt;
      if (transition <= 0) advance();
      return;
    }
    if (input.pressed('KeyH') || action === 'hint') {
      const solution = solveLevel(state, 40000);
      const names = {
        ArrowLeft: env.t('LEFT', '向左'),
        ArrowRight: env.t('RIGHT', '向右'),
        ArrowUp: env.t('UP', '向上'),
        ArrowDown: env.t('DOWN', '向下'),
      };
      hint = solution?.length ? names[solution[0]] : env.t('Try undo', '请尝试撤销');
      hintTimer = 4;
      return;
    }
    if (input.pressed('ArrowLeft', 'KeyA') || action === 'left') move(-1, 0);
    else if (input.pressed('ArrowRight', 'KeyD') || action === 'right') move(1, 0);
    else if (input.pressed('ArrowUp', 'KeyW') || action === 'up') move(0, -1);
    else if (input.pressed('ArrowDown', 'KeyS') || action === 'down') move(0, 1);
  }
  function draw(ctx) {
    ctx.save();
    background(ctx, '#202636');
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = '#2a3041';
      ctx.fillRect((i * 83) % 480, (i * 37) % 310, 35, 2);
    }
    drawPixelText(ctx, env.t('WAREHOUSE', '仓库'), 16, 47, '#97a0ac', 10);
    drawPixelText(ctx, `${level} / 8`, 16, 66, '#edcf80', 18);
    drawPixelText(ctx, env.t('MOVES', '步数'), 16, 111, '#97a0ac', 10);
    drawPixelText(ctx, String(moves), 16, 130, '#e8e5db', 21);
    const size = Math.min(28, Math.floor(258 / state.w), Math.floor(235 / state.h)),
      ox = 100 + Math.floor((258 - state.w * size) / 2),
      oy = 47 + Math.floor((235 - state.h * size) / 2);
    for (let y = 0; y < state.h; y++)
      for (let x = 0; x < state.w; x++) {
        const i = y * state.w + x,
          px = ox + x * size,
          py = oy + y * size;
        if (state.walls.includes(i)) {
          ctx.fillStyle = '#5b6573';
          ctx.fillRect(px, py, size, size);
          ctx.fillStyle = '#717e88';
          ctx.fillRect(px + 1, py + 1, size - 2, 3);
          ctx.fillStyle = '#3e4859';
          ctx.fillRect(px, py + size - 3, size, 3);
          ctx.fillRect(px + size - 2, py, 2, size);
        } else {
          ctx.fillStyle = (x + y) % 2 ? '#303a46' : '#343e49';
          ctx.fillRect(px, py, size, size);
          ctx.fillStyle = '#3f4850';
          ctx.fillRect(px + 4, py + 6, 3, 2);
          if (state.goals.includes(i)) {
            ctx.strokeStyle = '#d5b761';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 5, py + 5, size - 10, size - 10);
            ctx.fillStyle = '#d5b761';
            ctx.fillRect(px + size / 2 - 2, py + size / 2 - 2, 4, 4);
          }
        }
      }
    for (const c of state.crates) {
      const px = ox + (c % state.w) * size,
        py = oy + Math.floor(c / state.w) * size,
        done = state.goals.includes(c);
      ctx.fillStyle = done ? '#6caa7a' : '#b27f4c';
      ctx.fillRect(px + 2, py + 2, size - 4, size - 4);
      ctx.fillStyle = done ? '#9ed69e' : '#dfaf69';
      ctx.fillRect(px + 3, py + 3, size - 6, 3);
      ctx.fillRect(px + 3, py + 3, 3, size - 6);
      ctx.fillStyle = done ? '#427355' : '#754f38';
      ctx.fillRect(px + size - 6, py + 4, 3, size - 7);
      ctx.fillRect(px + 4, py + size - 6, size - 7, 3);
      ctx.strokeStyle = done ? '#477a56' : '#795537';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 6, py + 6);
      ctx.lineTo(px + size - 6, py + size - 6);
      ctx.moveTo(px + size - 6, py + 6);
      ctx.lineTo(px + 6, py + size - 6);
      ctx.stroke();
    }
    const px = ox + (state.player % state.w) * size + Math.floor((size - 18) / 2),
      py = oy + Math.floor(state.player / state.w) * size + Math.floor((size - 20) / 2);
    pixelSprite(
      ctx,
      [
        '..YYYY..',
        'YYYYYYYY',
        '.SSSSSS.',
        '.SKSSKS.',
        '..SSSS..',
        '.BBBBBB.',
        'BBYBBYBB',
        '.BBBBBB.',
        '..KKKK..',
        '.KK..KK.',
      ],
      px,
      py,
      2,
      { Y: '#efca6d', S: '#ecc1a0', K: '#1a2939', B: '#6eacc6' },
    );
    for (const [label, bx, by, w] of [
      ['▲', 395, 127, 46],
      ['◀', 367, 167, 46],
      ['▶', 423, 167, 46],
      ['▼', 395, 207, 46],
      [env.t('UNDO', '撤销'), 367, 238, 50],
      [env.t('HINT', '提示'), 423, 238, 48],
    ]) {
      ctx.fillStyle = '#394658';
      ctx.fillRect(bx, by, w, 28);
      drawPixelText(ctx, label, bx + w / 2, by + 8, '#e5ddc9', 10, 'center');
    }
    drawPixelText(
      ctx,
      transition > 0
        ? env.t('Warehouse complete!', '仓库整理完成！')
        : hintTimer > 0
          ? hint
          : env.t('Push carefully. Undo freely.', '谨慎推箱，随时撤销。'),
      240,
      298,
      transition > 0 ? '#a2d18a' : '#adb6be',
      11,
      'center',
    );
    ctx.restore();
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      level,
      moves,
      totalMoves,
      ...state,
      walls: state.walls.slice(),
      goals: state.goals.slice(),
      crates: state.crates.slice(),
      status: { en: `Warehouse ${level}/8 · ${moves} moves`, zh: `仓库 ${level}/8 · ${moves} 步` },
    }),
  };
}
