import { drawPixelText, background } from '../shared/utils.js';

export const meta = {
  id: 'neon-snake',
  name: { en: 'Neon Snake', zh: '霓虹贪吃蛇' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
  ],
  description: {
    en: 'Collect 18 energy fruits. Grow through three gardens without hitting walls, rocks, or yourself.',
    zh: '收集18颗能量果实，穿越三座花园，避开墙壁、岩石和自己的身体。',
  },
  keys: [{ label: { en: 'Turn', zh: '转向' }, keys: 'Arrow keys / WASD' }],
};
const COLS = 24,
  ROWS = 14,
  CELL = 20;
const same = (a, b) => a.x === b.x && a.y === b.y;
export function spawnFood(state, random) {
  const free = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = { x, y };
      if (!state.snake.some((s) => same(s, p)) && !state.rocks.some((s) => same(s, p)))
        free.push(p);
    }
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))] || null;
}
export function createSnakeState(random) {
  const state = {
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
    rocks: [],
    food: null,
    flash: 0,
  };
  state.food = spawnFood(state, random);
  return state;
}
export function stepSnake(state, direction, random) {
  if (state.phase !== 'playing') return;
  if (direction && !(direction.x === -state.direction.x && direction.y === -state.direction.y))
    state.direction = { ...direction };
  const head = { x: state.snake[0].x + state.direction.x, y: state.snake[0].y + state.direction.y };
  const eating = state.food && same(head, state.food);
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (
    head.x < 0 ||
    head.x >= COLS ||
    head.y < 0 ||
    head.y >= ROWS ||
    body.some((p) => same(p, head)) ||
    state.rocks.some((p) => same(p, head))
  ) {
    state.phase = 'lost';
    return;
  }
  state.snake.unshift(head);
  if (!eating) state.snake.pop();
  else {
    state.eaten++;
    state.score += 100;
    state.flash = 0.3;
    if (state.eaten >= 18) {
      state.phase = 'won';
      return;
    }
    const level = Math.floor(state.eaten / 6) + 1;
    if (level !== state.level) {
      state.level = level;
      const candidates =
        level === 2
          ? [
              { x: 5, y: 3 },
              { x: 6, y: 3 },
              { x: 7, y: 3 },
              { x: 16, y: 10 },
              { x: 17, y: 10 },
              { x: 18, y: 10 },
            ]
          : [
              { x: 5, y: 10 },
              { x: 6, y: 10 },
              { x: 17, y: 3 },
              { x: 18, y: 3 },
              { x: 11, y: 5 },
              { x: 12, y: 5 },
              { x: 11, y: 9 },
              { x: 12, y: 9 },
            ];
      state.rocks.push(...candidates.filter((p) => !state.snake.some((s) => same(s, p))));
    }
    state.food = spawnFood(state, random);
    if (!state.food) state.phase = 'won';
  }
}
export function createGame(env) {
  const state = createSnakeState(env.random);
  let elapsed = 0,
    clock = 0,
    pending = { x: 1, y: 0 },
    ended = false;
  function update(dt, input) {
    if (state.phase !== 'playing') return;
    clock += dt;
    state.flash = Math.max(0, state.flash - dt);
    const turns = [
      ['ArrowUp', 'KeyW', 0, -1],
      ['ArrowDown', 'KeyS', 0, 1],
      ['ArrowLeft', 'KeyA', -1, 0],
      ['ArrowRight', 'KeyD', 1, 0],
    ];
    for (const [a, b, x, y] of turns)
      if (input.pressed(a, b) && !(x === -state.direction.x && y === -state.direction.y))
        pending = { x, y };
    elapsed += dt;
    const interval = 0.16 - (state.level - 1) * 0.025;
    while (elapsed >= interval && state.phase === 'playing') {
      elapsed -= interval;
      const eaten = state.eaten;
      stepSnake(state, pending, env.random);
      pending = { ...state.direction };
      if (state.eaten !== eaten) env.sound('coin');
    }
    if (state.phase !== 'playing' && !ended) {
      ended = true;
      env.sound(state.phase === 'won' ? 'win' : 'lose');
      env.end({
        won: state.phase === 'won',
        score: state.score,
        message:
          state.phase === 'won'
            ? env.t('All gardens cleared!', '全部花园通关！')
            : env.t(
                'The garden keeps growing. Try a new route.',
                '花园还在生长，换条路线再试一次。',
              ),
      });
    }
  }
  function draw(ctx) {
    background(ctx, '#071c24');
    ctx.fillStyle = state.level === 1 ? '#102b30' : state.level === 2 ? '#152b38' : '#292733';
    ctx.fillRect(0, 40, 480, 280);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#15363b' : '#123139';
        ctx.fillRect(x * CELL + 1, y * CELL + 41, 18, 18);
        if ((x * 3 + y * 7) % 13 === 0) {
          ctx.fillStyle = '#1c4441';
          ctx.fillRect(x * CELL + 4, y * CELL + 46, 2, 5);
        }
      }
    for (const r of state.rocks) {
      const x = r.x * CELL,
        y = r.y * CELL + 40;
      ctx.fillStyle = '#456071';
      ctx.fillRect(x + 2, y + 4, 16, 14);
      ctx.fillStyle = '#738b95';
      ctx.fillRect(x + 4, y + 2, 11, 5);
      ctx.fillStyle = '#283e51';
      ctx.fillRect(x + 4, y + 15, 14, 3);
    }
    if (state.food) {
      const x = state.food.x * CELL,
        y = state.food.y * CELL + 40;
      ctx.fillStyle = '#ffba5a';
      ctx.fillRect(x + 5, y + 6, 11, 10);
      ctx.fillStyle = '#ff6c50';
      ctx.fillRect(x + 7, y + 14, 7, 3);
      ctx.fillStyle = '#fff2b0';
      ctx.fillRect(x + 6, y + 7, 3, 3);
      ctx.fillStyle = '#89d873';
      ctx.fillRect(x + 10, y + 2, 5, 4);
    }
    for (let i = state.snake.length - 1; i >= 0; i--) {
      const p = state.snake[i],
        x = p.x * CELL,
        y = p.y * CELL + 40;
      ctx.fillStyle = i === 0 ? '#c9ff83' : i % 2 ? '#51bd87' : '#79d78a';
      ctx.fillRect(x + 2, y + 2, 16, 16);
      ctx.fillStyle = '#257c65';
      ctx.fillRect(x + 3, y + 14, 14, 3);
      if (i === 0) {
        ctx.fillStyle = '#122a32';
        const dx = state.direction.x,
          dy = state.direction.y;
        if (dx) {
          ctx.fillRect(x + 9 + dx * 4, y + 5, 3, 3);
          ctx.fillRect(x + 9 + dx * 4, y + 12, 3, 3);
        } else {
          ctx.fillRect(x + 5, y + 9 + dy * 4, 3, 3);
          ctx.fillRect(x + 12, y + 9 + dy * 4, 3, 3);
        }
      }
    }
    ctx.fillStyle = '#08202b';
    ctx.fillRect(0, 0, 480, 40);
    drawPixelText(ctx, env.t('GARDEN', '花园') + ' ' + state.level + '/3', 14, 12, '#8bdbbd', 13);
    drawPixelText(
      ctx,
      env.t('FRUIT', '果实') + ' ' + state.eaten + '/18',
      466,
      12,
      '#ffcb72',
      13,
      'right',
    );
    if (clock < 3)
      drawPixelText(
        ctx,
        env.t('TURN WITH ARROWS / WASD', '方向键 / WASD 转向'),
        240,
        301,
        '#b8e6cd',
        11,
        'center',
      );
    if (state.flash > 0) {
      ctx.strokeStyle = '#ffe5a0';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 41, 478, 278);
    }
  }
  return {
    update,
    draw,
    getState: () => ({
      ...structuredClone(state),
      status: {
        en: `Garden ${state.level}/3 · Fruit ${state.eaten}/18`,
        zh: `花园 ${state.level}/3 · 果实 ${state.eaten}/18`,
      },
    }),
  };
}
