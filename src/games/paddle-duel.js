import { clamp, background, drawPixelText as text } from '../shared/utils.js';

export const meta = {
  id: 'paddle-duel',
  name: { en: 'Paddle Duel', zh: '球拍对决' },
  description: {
    en: 'First to seven, win by two (eleven-point cap). Bowed paddle edges angle returns; moving into contact adds spin. Beat three rising CPU tiers or play a friend. A stalled ball or a 45-second rally is a let. Your returns bank up to 50 bonus points per completed point; lets earn none.',
    zh: '先得七分并领先两分获胜，十一分封顶。弧形球拍边缘改变回球角度，击球时移动可增加旋转。挑战逐渐增强的电脑或与朋友对战，停滞球或45秒回合判重发。你的有效回球每回合最多奖励50分，得失分后结算，重发不计分。',
  },
  genre: 'sports',
  players: '1-2',
  touch: true,
  keys: [
    {
      label: { en: 'Player 1', zh: '玩家一' },
      keys: { en: 'W / S · solo: ↑ / ↓', zh: 'W / S · 单人：↑ / ↓' },
    },
    { label: { en: 'Player 2', zh: '玩家二' }, keys: '↑ / ↓' },
    { label: { en: 'Serve / let restart', zh: '发球 / 重发' }, keys: 'Space / Enter' },
  ],
};
const RADIUS = 5,
  INERTIA = 12.5,
  PADDLE_RADIUS = 70;
const COURT_TOP = 37,
  COURT_BOTTOM = 283;
// The bowed face is a circular arc. These same vertices drive rendering and
// collision; the body has a flat back, with solid top and bottom edges.
const PROFILE = Array.from({ length: 9 }, (_, n) => {
  const y = n * 7;
  return { x: -26 + Math.sqrt(PADDLE_RADIUS ** 2 - (y - 28) ** 2), y };
}).concat([
  { x: 27, y: 56 },
  { x: 27, y: 0 },
]);
export function paddleOutline(paddle, right = false) {
  return PROFILE.map((p) => ({ x: right ? 480 - p.x : p.x, y: paddle.y + p.y }));
}
const energy = (b) => (b.vx * b.vx + b.vy * b.vy) / 2 + (INERTIA * (b.spin || 0) ** 2) / 2;

// Infinite-mass motorized paddle, unit-mass disc: normal restitution and
// Coulomb-limited tangential friction. Motor work and dissipated energy remain
// separate, so a passive contact cannot secretly accelerate the ball.
export function paddleContact(b, nx, ny, ux = 0, uy = 0, restitution = 1, friction = 0.18) {
  b.spin ??= 0;
  const normal = (b.vx - ux) * nx + (b.vy - uy) * ny;
  if (normal >= 0) return { work: 0, dissipated: 0, impulseN: 0, impulseT: 0 };
  const before = energy(b),
    tx = -ny,
    ty = nx;
  const impulseN = -(1 + clamp(restitution, 0, 1)) * normal;
  const tangent = (b.vx - ux) * tx + (b.vy - uy) * ty - b.spin * RADIUS;
  const impulseT = clamp(
    -tangent / (1 + (RADIUS * RADIUS) / INERTIA),
    -friction * impulseN,
    friction * impulseN,
  );
  b.vx += impulseN * nx + impulseT * tx;
  b.vy += impulseN * ny + impulseT * ty;
  b.spin -= (RADIUS * impulseT) / INERTIA;
  const work = (impulseN * nx + impulseT * tx) * ux + (impulseN * ny + impulseT * ty) * uy;
  return { work, dissipated: Math.max(0, before + work - energy(b)), impulseN, impulseT };
}
export function createPaddleState(env) {
  return {
    phase: 'playing',
    score: 0,
    points: [0, 0],
    left: { y: 132, vy: 0 },
    right: { y: 132, vy: 0 },
    ball: { x: 240, y: 160, vx: 0, vy: 0, spin: 0, rotation: 0 },
    serve: 1.2,
    serveVelocity: { vx: 220, vy: 65 },
    server: 0,
    rally: 0,
    bestRally: 0,
    totalHits: 0,
    pointHits: [0, 0],
    returnBonus: 0,
    aiTier: 1,
    ai: { timer: 0, target: 132 },
    impact: 0,
    time: 0,
    trail: [],
    particles: [],
    pointFlash: 0,
    lastScorer: -1,
    rallyTime: 0,
    slowTime: 0,
    lets: 0,
    letReason: '',
    motorWork: 0,
    dissipated: 0,
    serveWork: 0,
    mode: env.mode || 1,
  };
}
function prepareServe(s, env, dir, letReason = '') {
  s.ball = { x: 240, y: 160, vx: 0, vy: 0, spin: 0, rotation: 0 };
  s.serveVelocity = { vx: dir * 220, vy: (env.random() - 0.5) * 180 };
  s.serve = letReason ? 1.6 : 1.1;
  s.rally = 0;
  s.rallyTime = 0;
  s.pointHits = [0, 0];
  s.slowTime = 0;
  s.trail = [];
  s.letReason = letReason;
}
function point(s, env, scorer) {
  s.points[scorer]++;
  s.lastScorer = scorer;
  s.pointFlash = 1;
  s.returnBonus += Math.min(s.pointHits[0], 10) * 5;
  s.score = s.points[0] * 100 + s.returnBonus;
  env.sound('coin');
  const won =
    s.points[scorer] >= 11 ||
    (s.points[scorer] >= 7 && s.points[scorer] - s.points[1 - scorer] >= 2);
  if (won) {
    s.phase = scorer === 0 ? 'won' : 'lost';
    env.sound(scorer === 0 ? 'win' : 'lose');
    env.end({
      won: scorer === 0,
      score: s.score,
      message: env.t(
        `Player ${scorer + 1} wins ${s.points[0]}–${s.points[1]}!`,
        `玩家${scorer + 1}以${s.points[0]}–${s.points[1]}赢得比赛！`,
      ),
    });
  } else {
    s.server = 1 - scorer;
    prepareServe(s, env, scorer === 0 ? 1 : -1);
  }
}
function drive(p, desired, dt, maxSpeed = 220) {
  const previous = p.vy;
  const accel = desired === 0 ? 2200 : 1500;
  p.vy += clamp(clamp(desired, -maxSpeed, maxSpeed) - p.vy, -accel * dt, accel * dt);
  p.y += (previous + p.vy) * 0.5 * dt;
  if (p.y < 32) {
    p.y = 32;
    p.vy = 0;
  }
  if (p.y > 232) {
    p.y = 232;
    p.vy = 0;
  }
}
function seek(p, target, maxSpeed = 220) {
  const delta = clamp(target, 32, 232) - p.y;
  return Math.sign(delta) * Math.min(maxSpeed, Math.sqrt(2 * 1400 * Math.abs(delta)));
}
function cpuTarget(s, dt, env) {
  s.ai.timer -= dt;
  if (s.ai.timer > 0) return;
  s.aiTier = Math.min(3, 1 + Math.floor((s.points[0] + s.points[1]) / 4));
  s.ai.timer = [0, 0.2, 0.16, 0.12][s.aiTier];
  let y = s.ball.y;
  if (s.ball.vx > 0) {
    y += s.ball.vy * Math.max(0, (431 - s.ball.x) / s.ball.vx) * [0, 0, 0.2, 0.42][s.aiTier];
    y = COURT_TOP + ((((y - COURT_TOP) % 492) + 492) % 492);
    if (y > COURT_BOTTOM) y = 566 - y;
    s.ai.target = clamp(y - 28 + (env.random() - 0.5) * (38 - s.aiTier * 6), 32, 232);
  } else s.ai.target = 132;
}
function hitPaddle(s, p, right, env) {
  const b = s.ball;
  if (right ? b.x < 420 || b.x > 463 : b.x < 17 || b.x > 60) return;
  const vertices = paddleOutline(p, right);
  let closest = null,
    minDistance = Infinity,
    inside = true,
    maxSigned = -Infinity,
    insideEdge = null;
  for (let n = 0; n < vertices.length; n++) {
    const a = vertices[n],
      z = vertices[(n + 1) % vertices.length],
      dx = z.x - a.x,
      dy = z.y - a.y;
    const length = Math.hypot(dx, dy),
      nx = ((right ? -1 : 1) * dy) / length,
      ny = ((right ? 1 : -1) * dx) / length;
    const signed = (b.x - a.x) * nx + (b.y - a.y) * ny;
    if (signed > 0) inside = false;
    if (signed > maxSigned) {
      maxSigned = signed;
      insideEdge = { nx, ny };
    }
    const t = clamp(((b.x - a.x) * dx + (b.y - a.y) * dy) / (length * length), 0, 1);
    const x = a.x + t * dx,
      y = a.y + t * dy,
      d = Math.hypot(b.x - x, b.y - y);
    if (d < minDistance) {
      minDistance = d;
      closest = { x, y, nx, ny };
    }
  }
  if (!inside && minDistance >= RADIUS) return;
  let nx, ny, penetration;
  if (inside) {
    nx = insideEdge.nx;
    ny = insideEdge.ny;
    penetration = RADIUS - maxSigned;
  } else {
    nx = (b.x - closest.x) / (minDistance || 1);
    ny = (b.y - closest.y) / (minDistance || 1);
    penetration = RADIUS - minDistance;
  }
  b.x += nx * (penetration + 0.0001);
  b.y += ny * (penetration + 0.0001);
  const result = paddleContact(b, nx, ny, 0, p.vy);
  s.motorWork += result.work;
  s.dissipated += result.dissipated;
  if (result.impulseN > 0) {
    s.rally++;
    s.totalHits++;
    s.pointHits[right ? 1 : 0]++;
    s.bestRally = Math.max(s.bestRally, s.rally);
    s.impact = 0.15;

    env.sound('hit');
    s.particles.push({ x: b.x, y: b.y, life: 0.2, right });
    if (s.particles.length > 12) s.particles.shift();
  }
}
export function stepPaddle(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  dt = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  if (dt === 0) return;
  s.time += dt;
  s.impact = Math.max(0, s.impact - dt);
  s.pointFlash = Math.max(0, s.pointFlash - dt);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0);
  let launchPressed = i.pressed('Space', 'Enter');
  const p1 =
    Number(i.held('KeyS') || (s.mode === 1 && i.held('ArrowDown'))) -
    Number(i.held('KeyW') || (s.mode === 1 && i.held('ArrowUp')));
  const p2 = Number(i.held('ArrowDown')) - Number(i.held('ArrowUp'));
  // Bound relative travel below 1.5px even for an unusually fast test shot.
  const slices = Math.max(
    1,
    Math.ceil(dt * Math.max(600, (Math.hypot(s.ball.vx, s.ball.vy) + 220) / 1.5)),
  );
  const h = dt / slices;
  for (let n = 0; n < slices && s.phase === 'playing'; n++) {
    if (s.mode === 1) cpuTarget(s, h, env);
    const leftDesired =
      i.pointer.down && i.pointer.x < 240 ? seek(s.left, i.pointer.y - 28) : p1 * 220;
    const rightDesired =
      s.mode === 2
        ? i.pointer.down && i.pointer.x >= 240
          ? seek(s.right, i.pointer.y - 28)
          : p2 * 220
        : seek(s.right, s.ai.target, 105 + s.aiTier * 12);
    drive(s.left, leftDesired, h);
    drive(s.right, rightDesired, h, s.mode === 2 ? 220 : 105 + s.aiTier * 12);
    if (s.serve > 0) {
      s.serve = Math.max(0, s.serve - h);
      if (launchPressed) s.serve = 0;
      launchPressed = false;
      if (s.serve === 0) {
        Object.assign(s.ball, s.serveVelocity);
        s.serveWork += energy(s.ball);
        s.letReason = '';
        env.sound('shoot');
      }
      continue;
    }
    const b = s.ball;
    b.spin ??= 0;
    b.rotation ??= 0;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.rotation += b.spin * h;
    s.rallyTime += h;
    if (b.y < COURT_TOP) {
      b.y = 2 * COURT_TOP - b.y;
      b.vy = Math.abs(b.vy);
      env.sound('move');
    }
    if (b.y > COURT_BOTTOM) {
      b.y = 2 * COURT_BOTTOM - b.y;
      b.vy = -Math.abs(b.vy);
      env.sound('move');
    }
    hitPaddle(s, s.left, false, env);
    hitPaddle(s, s.right, true, env);
    if (b.x < -RADIUS || b.x > 480 + RADIUS) {
      point(s, env, b.x > 480 ? 0 : 1);
      break;
    }
    s.slowTime = Math.abs(b.vx) < 8 ? s.slowTime + h : 0;
    if (s.slowTime >= 3 || s.rallyTime >= 45) {
      s.lets++;
      prepareServe(s, env, s.server === 0 ? 1 : -1, s.slowTime >= 3 ? 'slow' : 'time');
      env.sound('move');
      break;
    }
  }
  if (s.serve === 0) {
    s.trail.push({ x: s.ball.x, y: s.ball.y });
    if (s.trail.length > 9) s.trail.shift();
  }
}

function drawPaddle(ctx, s, env) {
  const themes = [
    ['#12333e', '#1b4550'],
    ['#173342', '#234854'],
    ['#273341', '#384855'],
  ];
  const [court, paint] = themes[s.aiTier - 1];
  background(ctx, '#101e2b');
  ctx.fillStyle = court;
  ctx.fillRect(16, 32, 448, 256);
  for (let y = 42; y < 286; y += 20)
    for (let x = 26; x < 455; x += 20) {
      ctx.fillStyle = (x + y) % 40 ? paint : '#234451';
      ctx.fillRect(x, y, 2, 2);
    }
  // Court lines are paint; only the upper and lower rails reflect the ball.
  ctx.fillStyle = '#66858b';
  ctx.fillRect(16, 30, 448, 2);
  ctx.fillRect(16, 288, 448, 2);
  for (let y = 38; y < 286; y += 16) {
    ctx.fillStyle = '#507680';
    ctx.fillRect(239, y, 2, 8);
  }
  for (let y = 42; y < 286; y += 20) {
    ctx.fillStyle = '#49656f';
    ctx.fillRect(4, y, 2, 7);
    ctx.fillRect(474, y, 2, 7);
  }
  ctx.strokeStyle = paint;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(240, 160, 48, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, env.t('ION COURT', '离子球场'), 240, 190, paint, 10, 'center');
  for (let k = 0; k < 2; k++) {
    const paddle = k ? s.right : s.left,
      vertices = paddleOutline(paddle, !!k);
    ctx.fillStyle = k ? '#6fc6c8' : '#edbf73';
    ctx.beginPath();
    vertices.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    // The inset grip and motor lights stay inside the solid bowed silhouette.
    ctx.fillStyle = k ? '#265d70' : '#88633f';
    ctx.fillRect(k ? 445 : 30, paddle.y + 7, 5, 42);
    ctx.fillStyle = Math.abs(paddle.vy) > 60 ? '#f1edc8' : '#bba981';
    for (let n = 0; n < 4; n++) ctx.fillRect(k ? 446 : 31, paddle.y + 12 + n * 9, 3, 3);
    for (let n = 0; n < Math.min(11, s.points[k]); n++) {
      ctx.fillStyle = k ? '#81cdd0' : '#edc580';
      ctx.fillRect(k ? 468 : 8, 46 + n * 21, 4, 12);
    }
  }
  for (let n = 0; n < s.trail.length; n++) {
    const p = s.trail[n];
    ctx.fillStyle = n < s.trail.length - 3 ? '#3e646e' : '#77a5aa';
    ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
  }
  for (const p of s.particles) {
    const spread = (0.2 - p.life) * 55;
    ctx.fillStyle = p.right ? '#8de1dc' : '#f4d69a';
    for (let n = -1; n <= 1; n++)
      ctx.fillRect(p.x + (p.right ? -1 : 1) * spread, p.y + n * spread, 2, 2);
  }
  const b = s.ball;
  ctx.fillStyle = '#071e2b';
  ctx.fillRect(Math.round(b.x) - 4, Math.round(b.y) + 3, 8, 4);
  ctx.fillStyle = '#fff2cd';
  ctx.fillRect(Math.round(b.x) - 5, Math.round(b.y) - 3, 10, 6);
  ctx.fillRect(Math.round(b.x) - 3, Math.round(b.y) - 5, 6, 10);
  ctx.fillStyle = '#487987';
  ctx.fillRect(
    Math.round(b.x + Math.cos(b.rotation || 0) * 2) - 1,
    Math.round(b.y + Math.sin(b.rotation || 0) * 2) - 1,
    2,
    2,
  );
  text(ctx, env.t('PLAYER 1', '玩家一'), 16, 10, '#edbf73', 10);
  text(ctx, `${s.points[0]}  :  ${s.points[1]}`, 240, 4, '#e6e4c9', 20, 'center');
  text(
    ctx,
    env.t(
      s.mode === 2 ? 'PLAYER 2' : `CPU ${s.aiTier}`,
      s.mode === 2 ? '玩家二' : `电脑 ${s.aiTier}级`,
    ),
    464,
    10,
    '#6fc6c8',
    10,
    'right',
  );
  text(ctx, env.t('WIN BY 2 · CAP 11', '领先两分 · 十一分封顶'), 240, 301, '#a0b6b5', 10, 'center');
  text(
    ctx,
    env.t(
      `+${Math.min(s.pointHits[0], 10) * 5} PENDING`,
      `待结算+${Math.min(s.pointHits[0], 10) * 5}`,
    ),
    17,
    301,
    '#799b9f',
    9,
  );
  text(ctx, env.t('MOVE = SPIN', '移动加旋转'), 463, 301, '#799b9f', 9, 'right');
  if (s.serve > 0) {
    const reason = s.letReason
      ? env.t(
          s.letReason === 'time' ? '45s LET — REPLAY POINT' : 'SLOW BALL — REPLAY POINT',
          s.letReason === 'time' ? '45秒重发 — 不计分' : '停滞球重发 — 不计分',
        )
      : s.lastScorer >= 0
        ? env.t(`PLAYER ${s.lastScorer + 1} POINT`, `玩家${s.lastScorer + 1}得分`)
        : env.t('READY TO RALLY', '准备回球');
    text(ctx, reason, 240, 112, '#e3cca0', 12, 'center');
    text(
      ctx,
      env.t('SPACE / ENTER TO SERVE', '空格 / 回车发球'),
      240,
      208,
      '#c4cebd',
      10,
      'center',
    );
    text(ctx, `${Math.ceil(s.serve)}`, 240, 232, '#6fa4a9', 11, 'center');
  } else if (s.slowTime > 1 || s.rallyTime > 40) {
    text(
      ctx,
      env.t(
        s.slowTime > 1 ? 'SLOW BALL — LET IN' : 'RALLY LIMIT — LET IN',
        s.slowTime > 1 ? '停滞球 — 即将重发' : '回合时限 — 即将重发',
      ),
      240,
      112,
      '#c4cebd',
      10,
      'center',
    );
    text(
      ctx,
      `${Math.max(1, Math.ceil(s.slowTime > 1 ? 3 - s.slowTime : 45 - s.rallyTime))}`,
      240,
      128,
      '#e3cca0',
      12,
      'center',
    );
  }
}
meta.touchControls = [
  { code: 'KeyW', side: 'left', label: { en: 'Up', zh: '上' } },
  { code: 'KeyS', side: 'left', label: { en: 'Down', zh: '下' } },
  { code: 'Space', side: 'right', label: { en: 'Serve', zh: '发球' } },
];
meta.multiplayerTouchControls = [
  { code: 'KeyW', side: 'left', label: { en: 'P1 Up', zh: '一上' } },
  { code: 'KeyS', side: 'left', label: { en: 'P1 Down', zh: '一下' } },
  { code: 'Space', side: 'left', label: { en: 'P1 Serve', zh: '一发球' } },
  { code: 'ArrowUp', side: 'right', label: { en: 'P2 Up', zh: '二上' } },
  { code: 'ArrowDown', side: 'right', label: { en: 'P2 Down', zh: '二下' } },
  { code: 'Enter', side: 'right', label: { en: 'P2 Serve', zh: '二发球' } },
];
export function createGame(env) {
  const s = createPaddleState(env);
  return {
    update: (dt, i) => stepPaddle(s, dt, i, env),
    draw: (ctx) => drawPaddle(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${s.points[0]} : ${s.points[1]} · Win by 2, cap 11 · ${s.mode === 1 ? 'CPU tier ' + s.aiTier : 'Local duel'}`,
        zh: `${s.points[0]} : ${s.points[1]} · 领先两分，11分封顶 · ${s.mode === 1 ? '电脑 ' + s.aiTier + ' 级' : '本地对战'}`,
      },
    }),
  };
}
