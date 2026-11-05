import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'paddle-duel',
  name: { en: 'Paddle Duel', zh: '球拍对决' },
  description: {
    en: 'First to seven wins. Angle your returns with the paddle edge. Play the computer or a friend.',
    zh: '先得七分获胜，用球拍边缘改变回球角度。挑战电脑或与朋友对战。',
  },
  genre: 'sports',
  players: '1-2',
  touch: true,
  keys: [
    {
      label: { en: 'Player 1', zh: '玩家一' },
      keys: { en: 'W / S · solo: ↑ / ↓', zh: 'W / S · 单人模式：↑ / ↓' },
    },
    { label: { en: 'Player 2', zh: '玩家二' }, keys: '↑ / ↓' },
    { label: { en: 'Serve now', zh: '立即发球' }, keys: 'Space' },
  ],
};
export function createPaddleState(env) {
  return {
    phase: 'playing',
    score: 0,
    points: [0, 0],
    left: { y: 132 },
    right: { y: 132 },
    ball: { x: 240, y: 160, vx: 210, vy: 55 },
    serve: 1.2,
    rally: 0,
    time: 0,
    trail: [],
    mode: env.mode || 1,
  };
}
function resetBall(s, env, dir) {
  s.ball = { x: 240, y: 160, vx: dir * 210, vy: (env.random() - 0.5) * 140 };
  s.serve = 1.1;
  s.rally = 0;
  s.trail = [];
}
export function stepPaddle(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  const p1 =
    Number(i.held('KeyS') || (s.mode === 1 && i.held('ArrowDown'))) -
    Number(i.held('KeyW') || (s.mode === 1 && i.held('ArrowUp')));
  s.left.y = clamp(s.left.y + p1 * 220 * dt, 32, 232);
  if (i.pointer.down && i.pointer.x < 240) s.left.y = clamp(i.pointer.y - 28, 32, 232);
  if (s.mode === 2) {
    const p2 = Number(i.held('ArrowDown')) - Number(i.held('ArrowUp'));
    s.right.y = clamp(s.right.y + p2 * 220 * dt, 32, 232);
    if (i.pointer.down && i.pointer.x >= 240) s.right.y = clamp(i.pointer.y - 28, 32, 232);
  } else {
    const target = s.ball.vx > 0 ? s.ball.y - 28 + Math.sin(s.time * 1.9) * 19 : 132;
    const d = target - s.right.y;
    s.right.y = clamp(
      s.right.y + clamp(d, -(145 + s.points[0] * 5) * dt, (145 + s.points[0] * 5) * dt),
      32,
      232,
    );
  }
  if (s.serve > 0) {
    s.serve -= dt;
    if (i.pressed('Space')) s.serve = 0;
    return;
  }
  const b = s.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.y < 37) {
    b.y = 74 - b.y;
    b.vy = Math.abs(b.vy);
    env.sound('move');
  }
  if (b.y > 283) {
    b.y = 566 - b.y;
    b.vy = -Math.abs(b.vy);
    env.sound('move');
  }
  for (const [left, paddle] of [
    [true, s.left],
    [false, s.right],
  ]) {
    const face = left ? 38 : 442;
    if (
      (left
        ? b.vx < 0 && b.x <= face + 5 && b.x >= face - 16
        : b.vx > 0 && b.x >= face - 5 && b.x <= face + 16) &&
      b.y >= paddle.y - 5 &&
      b.y <= paddle.y + 61
    ) {
      const angle = clamp((b.y - (paddle.y + 28)) / 33, -1, 1) * 1.05;
      const speed = Math.min(370, Math.hypot(b.vx, b.vy) + 13);
      b.vx = (left ? 1 : -1) * speed * Math.cos(angle);
      b.vy = speed * Math.sin(angle);
      b.x = face + (left ? 6 : -6);
      s.rally++;
      env.sound('hit');
    }
  }
  s.trail.push({ x: b.x, y: b.y });
  if (s.trail.length > 7) s.trail.shift();
  if (b.x < 0 || b.x > 480) {
    const scorer = b.x > 480 ? 0 : 1;
    s.points[scorer]++;
    s.score = s.points[0] * 100 + s.rally * 5;
    env.sound('coin');
    if (s.points[scorer] >= 7) {
      s.phase = scorer === 0 ? 'won' : 'lost';
      env.sound(scorer === 0 ? 'win' : 'lose');
      env.end({
        won: scorer === 0,
        score: s.score,
        message: env.t(`Player ${scorer + 1} wins the match!`, `玩家${scorer + 1}赢得比赛！`),
      });
    } else resetBall(s, env, scorer === 0 ? -1 : 1);
  }
}
function drawPaddle(ctx, s, env) {
  background(ctx, '#102735');
  ctx.fillStyle = '#163541';
  ctx.fillRect(16, 30, 448, 260);
  ctx.strokeStyle = '#36565b';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 30, 448, 260);
  for (let y = 38; y < 285; y += 18) {
    ctx.fillStyle = '#36565b';
    ctx.fillRect(239, y, 2, 9);
  }
  ctx.strokeStyle = '#36565b';
  ctx.beginPath();
  ctx.arc(240, 160, 48, 0, Math.PI * 2);
  ctx.stroke();
  for (let n = 0; n < s.trail.length; n++) {
    ctx.fillStyle = ['#214d57', '#275b62', '#306d71', '#398387', '#58a49d', '#7ac3b1', '#b0e5c6'][
      n
    ];
    ctx.fillRect(Math.round(s.trail[n].x) - 3, Math.round(s.trail[n].y) - 3, 6, 6);
  }
  ctx.fillStyle = '#efc379';
  ctx.fillRect(27, s.left.y, 10, 56);
  ctx.fillStyle = '#70b7b7';
  ctx.fillRect(443, s.right.y, 10, 56);
  ctx.fillStyle = '#fff0bb';
  ctx.fillRect(Math.round(s.ball.x) - 5, Math.round(s.ball.y) - 5, 10, 10);
  text(ctx, `${s.points[0]}`, 187, 48, '#efc379', 34, 'center');
  text(ctx, `${s.points[1]}`, 293, 48, '#70b7b7', 34, 'center');
  text(ctx, env.t('PLAYER 1', '玩家一'), 20, 10, '#efc379', 11);
  text(
    ctx,
    env.t(s.mode === 2 ? 'PLAYER 2' : 'COMPUTER', s.mode === 2 ? '玩家二' : '电脑'),
    460,
    10,
    '#70b7b7',
    11,
    'right',
  );
  text(ctx, env.t('FIRST TO SEVEN', '先得七分获胜'), 240, 300, '#94b2ae', 10, 'center');
  if (s.serve > 0)
    text(ctx, env.t('SPACE TO SERVE', '空格发球'), 240, 216, '#f1e5c9', 12, 'center');
  else if (s.rally >= 3)
    text(ctx, `${s.rally} ${env.t('HIT RALLY', '次连击')}`, 240, 252, '#759f9e', 10, 'center');
}
meta.touchControls = [
  { code: 'KeyW', label: { en: 'Up', zh: '上' } },
  { code: 'KeyS', label: { en: 'Down', zh: '下' } },
  { code: 'Space', label: { en: 'Serve', zh: '发球' } },
];

export function createGame(env) {
  const s = createPaddleState(env);
  return {
    update: (dt, i) => stepPaddle(s, dt, i, env),
    draw: (ctx) => drawPaddle(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Player 1 ${s.points[0]} : ${s.points[1]} ${s.mode === 2 ? 'Player 2' : 'Computer'}`,
        zh: `玩家一 ${s.points[0]} : ${s.points[1]} ${s.mode === 2 ? '玩家二' : '电脑'}`,
      },
    }),
  };
}
