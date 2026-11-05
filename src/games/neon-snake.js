import { drawPixelText as text, background } from '../shared/utils.js';
export const meta = {
  id: 'neon-snake',
  name: { en: 'Neon Snake', zh: '霓虹贪吃蛇' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Harvest six fruit in each of three grid gardens. Your growing body carries between gardens; Enter travels after a clear. Ruin gates alternate every four moves and stay open while occupied. Underpasses are ordinary connected cells. Hold Space for Focus; release to recharge. C toggles Calm pace.',
    zh: '在三座网格花园中各收获六颗果实。身体会继续增长，通关后按回车前往下一园。遗迹闸门每四步交替，身体占用时保持打开。地下通道由连续格子组成。按住空格消耗专注减速，松开恢复；C切换舒缓速度。',
  },
  keys: [
    {
      label: { en: 'Turn / swipe', zh: '转向 / 滑动' },
      keys: { en: 'Arrows / WASD · swipe', zh: '方向键 / WASD · 滑动' },
    },
    { label: { en: 'Hold Focus; release to refill', zh: '按住专注，松开恢复' }, keys: 'Space' },
    { label: { en: 'Next garden', zh: '下一花园' }, keys: 'Enter' },
    { label: { en: 'Calm pace', zh: '舒缓速度' }, keys: 'C' },
  ],
  touchControls: [
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Focus', zh: '专注' } },
    { code: 'Enter', side: 'right', label: { en: 'Next', zh: '下一园' } },
    { code: 'KeyC', side: 'right', label: { en: 'Calm', zh: '舒缓' } },
  ],
};
const COLS = 24,
  ROWS = 14,
  CELL = 20;
const NAMES = [
  ['Orchard', '果园'],
  ['Ruin Gates', '遗迹闸门'],
  ['Underpass Garden', '地下通道花园'],
];
const same = (a, b) => a.x === b.x && a.y === b.y;
const cardinal = (d) =>
  d && Number.isInteger(d.x) && Number.isInteger(d.y) && Math.abs(d.x) + Math.abs(d.y) === 1;
const inside = (p) => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS;
export function gardenRocks(level) {
  const rocks = [];
  const add = (x, y, n = 1) => {
    for (let k = 0; k < n; k++) rocks.push({ x: x + k, y });
  };
  if (level === 1) {
    add(4, 4, 4);
    add(17, 9, 3);
  }
  if (level === 2) {
    for (let x = 0; x < COLS; x++) if (x !== 5 && x !== 18) add(x, 6);
    add(8, 2);
    add(8, 3);
    add(15, 9);
    add(15, 10);
  }
  if (level === 3) {
    for (let y = 0; y < ROWS; y++) if (y !== 3 && y !== 10) add(11, y);
    add(6, 3, 2);
    add(7, 10, 2);
    add(16, 3, 2);
    add(16, 10, 2);
  }
  return rocks;
}
const BEDS = [
  [
    [
      [12, 7],
      [13, 7],
    ],
    [
      [18, 4],
      [19, 4],
    ],
    [
      [20, 11],
      [19, 11],
    ],
    [
      [11, 11],
      [10, 10],
    ],
    [
      [3, 9],
      [3, 8],
    ],
    [
      [5, 2],
      [6, 2],
    ],
  ],
  [
    [
      [4, 2],
      [7, 2],
    ],
    [
      [18, 10],
      [20, 10],
    ],
    [
      [20, 2],
      [18, 3],
    ],
    [
      [4, 11],
      [7, 11],
    ],
    [
      [12, 2],
      [12, 4],
    ],
    [
      [20, 11],
      [21, 9],
    ],
  ],
  [
    [
      [18, 4],
      [19, 5],
    ],
    [
      [4, 4],
      [3, 3],
    ],
    [
      [18, 11],
      [20, 10],
    ],
    [
      [4, 10],
      [5, 11],
    ],
    [
      [20, 3],
      [18, 2],
    ],
    [
      [3, 2],
      [5, 4],
    ],
  ],
];
export function isGateOpen(s, g, offset = 0) {
  return (
    s.snake.some((p) => same(p, g)) ||
    Math.floor(((s.stageSteps || 0) + offset) / 4) % 2 === g.group
  );
}
function zone(s, p) {
  return s.level === 2
    ? s.stageFruit % 2 === 0
      ? p.y < 6
      : p.y > 6
    : s.level === 3
      ? s.stageFruit % 2 === 0
        ? p.x > 11
        : p.x < 11
      : true;
}
export function spawnFood(s, random) {
  const available = (p) =>
    inside(p) &&
    ![...s.snake, ...s.rocks, ...(s.gates || []), ...(s.underpasses || [])].some((v) =>
      same(v, p),
    ) &&
    zone(s, p);
  let free = (BEDS[s.level - 1]?.[s.stageFruit || 0] || [])
    .map(([x, y]) => ({ x, y }))
    .filter(available);
  if (!free.length) {
    free = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) if (available({ x, y })) free.push({ x, y });
  }
  if (!free.length) return null;
  return free[Math.max(0, Math.min(free.length - 1, Math.floor(random() * free.length)))];
}
function terrain(s) {
  s.rocks = gardenRocks(s.level);
  s.gates =
    s.level === 2
      ? [
          { x: 5, y: 6, group: 0, label: 'A' },
          { x: 18, y: 6, group: 1, label: 'B' },
        ]
      : [];
  s.underpasses =
    s.level === 3
      ? [
          { x: 11, y: 3, label: 'I' },
          { x: 11, y: 10, label: 'II' },
        ]
      : [];
}
export function createSnakeState(random = () => 0.5) {
  const s = {
    phase: 'playing',
    score: 0,
    eaten: 0,
    level: 1,
    snake: [
      { x: 8, y: 7 },
      { x: 7, y: 7 },
      { x: 6, y: 7 },
      { x: 5, y: 7 },
    ],
    direction: { x: 1, y: 0 },
    brake: 1,
    braking: false,
    focusLocked: false,
    steps: 0,
    stageSteps: 0,
    stageFruit: 0,
    food: null,
    progress: 0,
    time: 0,
    flash: 0,
    calm: false,
    betweenGardens: false,
    queue: [],
    controls: { held: [], pointer: null, pointerDown: false },
    crossings: 0,
    crossingFrom: null,
    crash: null,
    ended: false,
    celebration: [],
  };
  terrain(s);
  s.food = spawnFood(s, random);
  return s;
}
function entranceRail(level, length) {
  const x = level === 2 ? 5 : 2,
    right = level === 2 ? 20 : 9,
    rail = [];
  for (let y = 7; y <= 12; y++) rail.push({ x, y });
  for (let xx = x + 1; xx <= right; xx++) rail.push({ x: xx, y: 12 });
  for (let y = 11; y >= 8; y--) rail.push({ x: right, y });
  for (let xx = right - 1; xx > x; xx--) rail.push({ x: xx, y: 8 });
  return rail.slice(0, length);
}
export function advanceGarden(s, random) {
  if (s.phase !== 'playing' || !s.betweenGardens || s.level >= 3) return false;
  const length = s.snake.length;
  s.level++;
  s.stageFruit = 0;
  s.stageSteps = 0;
  terrain(s);
  s.snake = entranceRail(s.level, length);
  s.direction = { x: 0, y: -1 };
  s.betweenGardens = false;
  s.brake = 1;
  s.braking = false;
  s.focusLocked = false;
  s.progress = 0;
  s.queue = [];
  s.controls = { held: [], pointer: null, pointerDown: false };
  s.crossingFrom = null;
  s.food = spawnFood(s, random);
  return true;
}
export function stepSnake(s, direction, random) {
  if (s.phase !== 'playing' || s.betweenGardens) return;
  if (cardinal(direction) && !(direction.x === -s.direction.x && direction.y === -s.direction.y))
    s.direction = { ...direction };
  const old = s.snake[0],
    head = { x: old.x + s.direction.x, y: old.y + s.direction.y },
    eating = s.food && same(head, s.food),
    body = eating ? s.snake : s.snake.slice(0, -1);
  let reason = !inside(head)
    ? 'edge'
    : s.rocks.some((p) => same(p, head))
      ? 'stone'
      : (s.gates || []).some((g) => same(g, head) && !isGateOpen(s, g))
        ? 'gate'
        : body.some((p) => same(p, head))
          ? 'body'
          : null;
  if (reason) {
    s.phase = 'lost';
    s.crash = { ...head, reason };
    return;
  }
  s.steps++;
  s.stageSteps++;
  s.snake.unshift(head);
  if (!eating) s.snake.pop();
  if (s.level === 3) {
    if (head.x === 11 && s.underpasses.some((p) => same(p, head)))
      s.crossingFrom = old.x < 11 ? 'left' : 'right';
    else if (s.crossingFrom && old.x === 11) {
      if ((s.crossingFrom === 'left' && head.x > 11) || (s.crossingFrom === 'right' && head.x < 11))
        s.crossings++;
      s.crossingFrom = null;
    }
  }
  if (eating) {
    s.eaten++;
    s.stageFruit++;
    s.score += 100;
    s.brake = Math.min(1, s.brake + 0.25);
    s.flash = 0.25;
    s.celebration.push({ x: head.x, y: head.y, life: 0.35 });
    if (s.celebration.length > 4) s.celebration.shift();
    if (s.stageFruit === 6) {
      s.score += 200;
      s.food = null;
      s.queue = [];
      s.progress = 0;
      s.braking = false;
      if (s.level === 3) s.phase = 'won';
      else s.betweenGardens = true;
    } else {
      s.food = spawnFood(s, random);
      if (!s.food) {
        s.phase = 'won';
        s.filled = true;
      }
    }
  }
}
function queueTurn(s, d) {
  const last = s.queue.at(-1) || s.direction;
  if (
    s.queue.length < 2 &&
    cardinal(d) &&
    !(d.x === last.x && d.y === last.y) &&
    !(d.x === -last.x && d.y === -last.y)
  )
    s.queue.push({ ...d });
}
function collectTurns(s, input) {
  const keys = [
      ['ArrowUp', 'KeyW', 0, -1],
      ['ArrowDown', 'KeyS', 0, 1],
      ['ArrowLeft', 'KeyA', -1, 0],
      ['ArrowRight', 'KeyD', 1, 0],
    ],
    current = [],
    fresh = [];
  for (let n = 0; n < 4; n++) {
    const [a, b] = keys[n];
    if (input.held(a, b)) current.push(n);
    if (input.pressed(a, b) || (input.held(a, b) && !s.controls.held.includes(n))) fresh.push(n);
  }
  const cancelled = new Set();
  for (const [a, b] of [
    [0, 1],
    [2, 3],
  ])
    if ((current.includes(a) && current.includes(b)) || (fresh.includes(a) && fresh.includes(b))) {
      cancelled.add(a);
      cancelled.add(b);
    }
  const planned = s.queue.at(-1) || s.direction;
  const valid = fresh.filter(
    (n) =>
      !cancelled.has(n) &&
      !(keys[n][2] === planned.x && keys[n][3] === planned.y) &&
      !(keys[n][2] === -planned.x && keys[n][3] === -planned.y),
  );
  // A frame has no ordering between simultaneous keys; accept one legal turn.
  if (valid.length === 1) queueTurn(s, { x: keys[valid[0]][2], y: keys[valid[0]][3] });
  s.controls.held = current;
  const p = input.pointer;
  if (p.down && (p.clicked || !s.controls.pointerDown)) s.controls.pointer = { x: p.x, y: p.y };
  if (p.down && s.controls.pointer) {
    const dx = p.x - s.controls.pointer.x,
      dy = p.y - s.controls.pointer.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 15) {
      queueTurn(
        s,
        Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) },
      );
      s.controls.pointer = { x: p.x, y: p.y };
    }
  }
  if (!p.down) s.controls.pointer = null;
  s.controls.pointerDown = p.down;
}
function terminal(s, env) {
  if (s.phase === 'playing' || s.ended) return;
  s.ended = true;
  env.sound(s.phase === 'won' ? 'win' : 'lose');
  const reasons = {
    edge: ['Garden edge reached — turn before the border.', '到达花园边缘，请提前转向。'],
    stone: ['A garden obstacle blocked the route.', '花园障碍格挡住了路线。'],
    gate: [
      'The gate was closed — circle until the other gate opens.',
      '闸门关闭，请绕行等待另一闸门开放。',
    ],
    body: ['The body had not cleared that cell.', '身体尚未离开该格。'],
  };
  env.end({
    won: s.phase === 'won',
    score: s.score,
    message:
      s.phase === 'won'
        ? env.t('All three gardens harvested!', '三座花园收获完成！')
        : env.t(...reasons[s.crash.reason]),
  });
}
export function updateSnake(s, dt, input, env) {
  if (s.phase !== 'playing') return;
  dt = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  if (dt === 0) return;
  if (input.pressed('KeyC')) s.calm = !s.calm;
  if (s.betweenGardens) {
    s.time += dt;
    if (input.pressed('Enter')) advanceGarden(s, env.random);
    return;
  }
  collectTurns(s, input);
  const focus = input.held('Space') || input.pressed('Space');
  if (!focus) {
    s.braking = false;
    s.focusLocked = false;
  } else if (!s.focusLocked && (s.braking || s.brake >= 0.1)) s.braking = true;
  else {
    s.braking = false;
    s.focusLocked = true;
  }
  let left = dt;
  for (
    let events = 0;
    events < 8 && left > 1e-12 && s.phase === 'playing' && !s.betweenGardens;
    events++
  ) {
    const period = [0.18, 0.17, 0.16][s.level - 1] * (s.calm ? 1.35 : 1),
      rate = 1 / (period * (s.braking ? 1.9 : 1));
    const moveTime = (1 - s.progress) / rate,
      emptyTime = s.braking ? s.brake / 0.22 : Infinity,
      part = Math.min(left, moveTime, emptyTime);
    s.progress += part * rate;
    s.brake = Math.max(0, Math.min(1, s.brake + part * (s.braking ? -0.22 : !focus ? 0.12 : 0)));
    s.time += part;
    s.flash = Math.max(0, s.flash - part);
    s.celebration = s.celebration.filter((p) => (p.life -= part) > 0);
    left -= part;
    if (emptyTime <= part + 1e-10) {
      s.brake = 0;
      s.braking = false;
      s.focusLocked = true;
    }
    if (moveTime <= part + 1e-10) {
      s.progress = 0;
      const eaten = s.eaten;
      stepSnake(s, s.queue.shift(), env.random);
      if (s.eaten !== eaten) env.sound('coin');
      if (s.phase !== 'playing') {
        terminal(s, env);
        return;
      }
      if (s.betweenGardens) s.queue = [];
    }
  }
}
function focusLabel(s) {
  if (s.betweenGardens) return ['Travel refills', '前往时补满'];
  if (s.focusLocked) return ['Release Focus', '松开专注键'];
  if (s.braking) return ['Focus active', '专注生效中'];
  return s.brake < 0.1 ? ['Charge to 10%', '恢复到10%'] : ['Focus ready', '专注可用'];
}
function arrow(ctx, x, y, d, color, size = 5) {
  const px = -d.y,
    py = d.x;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - d.x * size, y - d.y * size);
  ctx.lineTo(x + d.x * size, y + d.y * size);
  ctx.moveTo(x + d.x * size - px * 3 - d.x * 3, y + d.y * size - py * 3 - d.y * 3);
  ctx.lineTo(x + d.x * size, y + d.y * size);
  ctx.lineTo(x + d.x * size + px * 3 - d.x * 3, y + d.y * size + py * 3 - d.y * 3);
  ctx.stroke();
}
function fruit(ctx, p, level) {
  const x = p.x * CELL,
    y = p.y * CELL + 40;
  ctx.fillStyle = '#0b272f';
  ctx.fillRect(x + 3, y + 6, 15, 12);
  ctx.fillRect(x + 5, y + 3, 11, 16);
  ctx.fillStyle = level === 2 ? '#d7bb72' : level === 3 ? '#e7ad7b' : '#ffc264';
  ctx.fillRect(x + 3, y + 7, 15, 8);
  ctx.fillRect(x + 5, y + 5, 11, 12);
  ctx.fillStyle = '#f8f1bb';
  ctx.fillRect(x + 6, y + 6, 4, 4);
  ctx.fillStyle = '#cb7856';
  ctx.fillRect(x + 8, y + 14, 7, 2);
  ctx.fillStyle = '#8bd3a3';
  ctx.fillRect(x + 10, y + 1, 2, 5);
  ctx.fillRect(x + 12, y + 2, 5, 3);
  ctx.fillStyle = '#fff0b5';
  ctx.fillRect(x + 1, y + 10, 2, 3);
  ctx.fillRect(x + 18, y + 9, 1, 4);
}
function drawSnake(ctx, s, env) {
  const palettes = [
    ['#123a35', '#193f39', '#2d5547'],
    ['#1c3445', '#243d4b', '#3b5961'],
    ['#173b44', '#21434d', '#375e64'],
  ];
  const [floor, accent, edge] = palettes[s.level - 1];
  background(ctx, '#102530');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 40, 480, 280);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const px = x * CELL,
        py = y * CELL + 40;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, 19, 19);
      if (s.level === 1 && (x * 7 + y * 11) % 13 === 0) {
        ctx.fillStyle = '#397352';
        ctx.fillRect(px + 5, py + 13, 2, 4);
        ctx.fillRect(px + 8, py + 11, 2, 5);
      }
      if (s.level === 2 && (x + y) % 4 === 0) {
        ctx.fillStyle = '#36535d';
        ctx.fillRect(px + 3, py + 14, 5, 1);
        ctx.fillRect(px + 8, py + 9, 1, 6);
      }
      if (s.level === 3 && (x * 3 + y) % 7 === 0) {
        ctx.fillStyle = '#3c6670';
        ctx.fillRect(px + 3, py + 8, 8, 1);
        ctx.fillRect(px + 8, py + 12, 7, 1);
      }
    }
  for (const p of s.underpasses) {
    for (let x = 9; x <= 13; x++) {
      ctx.fillStyle = '#456b69';
      ctx.fillRect(x * CELL, p.y * CELL + 40, 20, 20);
      ctx.fillStyle = '#769c89';
      ctx.fillRect(x * CELL, p.y * CELL + 41, 20, 2);
      ctx.fillRect(x * CELL, p.y * CELL + 57, 20, 2);
      arrow(ctx, x * CELL + 10, p.y * CELL + 50, { x: x < 11 ? 1 : -1, y: 0 }, '#9db9a1', 4);
    }
  }
  for (const r of s.rocks) {
    const x = r.x * CELL,
      y = r.y * CELL + 40;
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, 20, 20);
    ctx.fillStyle = '#769486';
    ctx.fillRect(x + 1, y + 1, 18, 2);
    ctx.fillStyle = '#122c37';
    ctx.fillRect(x + 1, y + 17, 18, 3);
    if (s.level === 1) {
      ctx.fillStyle = '#355c46';
      ctx.fillRect(x + 2, y + 4, 16, 12);
      ctx.fillStyle = '#68a366';
      ctx.fillRect(x + 4, y + 3, 5, 5);
      ctx.fillRect(x + 11, y + 5, 5, 6);
      ctx.fillStyle = '#95bd78';
      ctx.fillRect(x + 5, y + 4, 2, 2);
    } else {
      ctx.fillStyle = s.level === 2 ? '#4e6b70' : '#557778';
      ctx.fillRect(x + 2, y + 4, 16, 12);
      ctx.fillStyle = '#1e3c46';
      ctx.fillRect(x + 2, y + 10, 16, 2);
      ctx.fillRect(x + 8, y + 4, 2, 6);
      ctx.fillStyle = '#87a899';
      ctx.fillRect(x + 12, y + 6, 3, 2);
    }
  }
  for (const g of s.gates) {
    const x = g.x * CELL,
      y = g.y * CELL + 40,
      open = isGateOpen(s, g),
      scheduled = Math.floor(s.stageSteps / 4) % 2 === g.group;
    ctx.fillStyle = '#122b37';
    ctx.fillRect(x, y, 20, 20);
    ctx.fillStyle = open ? '#85bda5' : '#c6a082';
    ctx.fillRect(x, y, 3, 20);
    ctx.fillRect(x + 17, y, 3, 20);
    if (!open) {
      ctx.fillStyle = '#b98b7f';
      for (let k = 5; k < 17; k += 5) ctx.fillRect(x + k, y + 2, 2, 16);
      ctx.fillStyle = '#ead3a6';
      ctx.fillRect(x + 7, y + 8, 6, 4);
    } else {
      ctx.fillStyle = '#466f65';
      ctx.fillRect(x + 4, y + 2, 12, 2);
      ctx.fillRect(x + 4, y + 16, 12, 2);
    }
    text(ctx, g.label, x + 10, y + 4, open ? '#a9d4b5' : '#233e48', 10, 'center');
    if (open && !scheduled) {
      ctx.fillStyle = '#f0d7a1';
      ctx.fillRect(x + 1, y + 1, 4, 4);
      ctx.fillRect(x + 15, y + 15, 4, 4);
    }
  }
  if (s.food) fruit(ctx, s.food, s.level);
  if (s.queue.length && !s.betweenGardens) {
    const p = s.snake[0],
      d = s.queue[0],
      x = (p.x + d.x) * CELL,
      y = (p.y + d.y) * CELL + 40;
    if (x >= 0 && x < 480 && y >= 40 && y < 320) {
      ctx.strokeStyle = '#92bccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, 18, 18);
      arrow(ctx, x + 10, y + 10, d, '#9dc9cd', 4);
    }
  }
  // All body links join adjacent cell centers; no segment jumps through space.
  ctx.strokeStyle = '#79be9b';
  ctx.lineWidth = 12;
  ctx.beginPath();
  for (let n = s.snake.length - 1; n >= 0; n--) {
    const p = s.snake[n];
    if (n === s.snake.length - 1) ctx.moveTo(p.x * CELL + 10, p.y * CELL + 50);
    else ctx.lineTo(p.x * CELL + 10, p.y * CELL + 50);
  }
  ctx.stroke();
  for (let n = s.snake.length - 1; n >= 0; n--) {
    const p = s.snake[n],
      x = p.x * CELL,
      y = p.y * CELL + 40,
      cx = x + 10,
      cy = y + 10;
    ctx.strokeStyle = '#315f50';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 19, 19);
    if (n === s.snake.length - 1) {
      const next = s.snake[Math.max(0, n - 1)],
        dx = next.x - p.x,
        dy = next.y - p.y;
      ctx.fillStyle = '#78b68e';
      ctx.beginPath();
      ctx.moveTo(cx - dx * 7, cy - dy * 7);
      ctx.lineTo(cx + dx * 4 - dy * 5, cy + dy * 4 + dx * 5);
      ctx.lineTo(cx + dx * 4 + dy * 5, cy + dy * 4 - dx * 5);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    ctx.fillStyle = n === 0 ? (s.flash > 0 ? '#f1f3b6' : '#c3e995') : n % 2 ? '#68b995' : '#80c79d';
    ctx.fillRect(x + 4, y + 2, 12, 16);
    ctx.fillRect(x + 2, y + 4, 16, 12);
    ctx.fillStyle = '#326e5c';
    ctx.fillRect(x + 4, y + 14, 12, 2);
    if (n) {
      ctx.fillStyle = '#abd4a0';
      ctx.fillRect(x + 8, y + 6, 4, 2);
      ctx.fillRect(x + 6, y + 8, 2, 4);
      ctx.fillRect(x + 12, y + 8, 2, 4);
      ctx.fillRect(x + 8, y + 12, 4, 2);
    } else {
      const d = s.direction,
        px = -d.y,
        py = d.x;
      ctx.fillStyle = '#14323b';
      for (const side of [-1, 1])
        ctx.fillRect(
          Math.round(cx + d.x * 3 + px * side * 4) - 2,
          Math.round(cy + d.y * 3 + py * side * 4) - 2,
          4,
          4,
        );
      ctx.fillStyle = '#fff5c9';
      for (const side of [-1, 1])
        ctx.fillRect(
          Math.round(cx + d.x * 4 + px * side * 4) - 1,
          Math.round(cy + d.y * 4 + py * side * 4) - 1,
          2,
          2,
        );
      ctx.fillStyle = '#3a6b52';
      ctx.fillRect(cx + d.x * 7 - 1, cy + d.y * 7 - 1, 2, 2);
    }
  }
  for (const e of s.celebration) {
    const spread = (0.35 - e.life) * 20;
    ctx.fillStyle = '#f5dfa1';
    for (let n = 0; n < 4; n++)
      ctx.fillRect(
        e.x * CELL + 9 + Math.cos((n * Math.PI) / 2) * (8 + spread),
        e.y * CELL + 49 + Math.sin((n * Math.PI) / 2) * (8 + spread),
        2,
        2,
      );
  }
  if (s.crash) {
    const x = Math.max(0, Math.min(23, s.crash.x)) * CELL,
      y = Math.max(0, Math.min(13, s.crash.y)) * CELL + 40;
    ctx.strokeStyle = '#e0a08b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, 18, 18);
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 5);
    ctx.lineTo(x + 15, y + 15);
    ctx.moveTo(x + 15, y + 5);
    ctx.lineTo(x + 5, y + 15);
    ctx.stroke();
  }
  ctx.strokeStyle = '#6c9588';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 41, 478, 278);
  ctx.fillStyle = '#102a35';
  ctx.fillRect(0, 0, 480, 40);
  text(ctx, `${s.level}/3 ${env.t(...NAMES[s.level - 1])}`, 12, 4, '#bfdbb8', 11);
  text(ctx, env.t(`FRUIT ${s.eaten}/18`, `果实 ${s.eaten}/18`), 468, 4, '#f4d19a', 12, 'right');
  text(
    ctx,
    env.t(s.calm ? 'C: CALM' : 'C: NORMAL', s.calm ? 'C：舒缓' : 'C：标准'),
    304,
    4,
    '#adc9ca',
    10,
  );
  text(ctx, env.t(`LEN ${s.snake.length}`, `长度 ${s.snake.length}`), 12, 24, '#a9c8b3', 10);
  text(ctx, `${s.stageFruit}/6`, 82, 24, '#d4cf9e', 10);
  if (s.level === 2) {
    text(ctx, Math.floor(s.stageSteps / 4) % 2 === 0 ? 'A' : 'B', 121, 24, '#dfc28f', 10);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k < 4 - (s.stageSteps % 4) ? '#bdd2a1' : '#385763';
      ctx.fillRect(134 + k * 7, 26, 5, 5);
    }
  }
  if (s.level === 3)
    text(
      ctx,
      s.crossingFrom
        ? env.t('PASS 1/2', '通过 1/2')
        : env.t(`PASS ${s.crossings}`, `通过 ${s.crossings}`),
      120,
      24,
      '#abc9c0',
      10,
    );
  text(ctx, env.t('FOCUS', '专注'), 235, 2, '#c2d7c6', 10, 'center');
  for (let n = 0; n < 10; n++) {
    ctx.fillStyle = '#34585d';
    ctx.fillRect(185 + n * 10, 16, 9, 6);
    ctx.fillStyle = s.braking ? '#ecd5a0' : s.brake < 0.1 || s.focusLocked ? '#9c8c75' : '#7dbba3';
    ctx.fillRect(185 + n * 10, 16, Math.max(0, Math.min(9, s.brake * 100 - n * 10)), 6);
  }
  ctx.fillStyle = '#e5d7ad';
  ctx.fillRect(194, 14, 1, 10);
  text(ctx, env.t(...focusLabel(s)), 235, 27, '#b9cdba', 10, 'center');
  text(ctx, env.t('NEXT', '下步'), 306, 25, '#89b9bf', 10);
  for (let n = 0; n < s.queue.length; n++) arrow(ctx, 354 + n * 24, 29, s.queue[n], '#c4dfce', 5);
  if (s.betweenGardens) {
    ctx.fillStyle = '#0e2833ef';
    ctx.fillRect(58, 128, 364, 106);
    ctx.strokeStyle = '#7fac9d';
    ctx.lineWidth = 2;
    ctx.strokeRect(58, 128, 364, 106);
    text(ctx, env.t('GARDEN HARVESTED', '本园收获完成'), 240, 141, '#e2dda4', 16, 'center');
    text(
      ctx,
      env.t(`ENTER: ${NAMES[s.level][0]}`, `回车前往：${NAMES[s.level][1]}`),
      240,
      170,
      '#c1d9c5',
      12,
      'center',
    );
    text(
      ctx,
      env.t(`Length ${s.snake.length} kept · Focus refills`, `保留长度${s.snake.length}，专注补满`),
      240,
      192,
      '#a7c8be',
      11,
      'center',
    );
    text(
      ctx,
      env.t('Next garden waits for your command', '准备好后再进入下一花园'),
      240,
      212,
      '#91b0b4',
      10,
      'center',
    );
  }
}
export function createGame(env) {
  const state = createSnakeState(env.random);
  return {
    update: (dt, input) => updateSnake(state, dt, input, env),
    draw: (ctx) => drawSnake(ctx, state, env),
    getState: () => ({
      ...structuredClone(state),
      gates: state.gates.map((g) => ({ ...g, open: isGateOpen(state, g) })),
      status: {
        en: `${NAMES[state.level - 1][0]} ${state.level}/3 · ${state.stageFruit}/6 fruit · Length ${state.snake.length} · ${state.calm ? 'Calm' : 'Normal'} pace · ${focusLabel(state)[0]} · ${state.betweenGardens ? 'Enter to travel' : state.level === 2 ? 'Gates: 4 moves per phase' : state.level === 3 ? 'Loop until the tail clears each crossing' : 'Queue turns early'}`,
        zh: `${NAMES[state.level - 1][1]} ${state.level}/3 · ${state.stageFruit}/6果实 · 长度${state.snake.length} · ${state.calm ? '舒缓' : '标准'}速度 · ${focusLabel(state)[1]} · ${state.betweenGardens ? '回车前往下一园' : state.level === 2 ? '闸门每四步交替' : state.level === 3 ? '绕行等待尾部让出通道' : '提前输入转向'}`,
      },
    }),
  };
}
