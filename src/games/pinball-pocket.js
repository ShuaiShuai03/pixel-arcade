import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'pinball-pocket',
  name: { en: 'Pinball Pocket', zh: '口袋弹球' },
  description: {
    en: 'Launch three balls into the star table. Light every bumper for a bonus and keep the ball alive with your flippers.',
    zh: '发射三颗弹球，点亮全部碰撞器获得奖励，用挡板保护弹球。',
  },
  genre: 'sports',
  players: '1',
  touch: true,
  keys: [
    { label: { en: 'Left / right flipper', zh: '左 / 右挡板' }, keys: 'A / D · ← / →' },
    { label: { en: 'Launch ball', zh: '发射弹球' }, keys: 'Space / Enter' },
  ],
};
const bumperPositions = [
  [169, 92],
  [311, 92],
  [240, 153],
];
export function createPinballState() {
  return {
    phase: 'playing',
    score: 0,
    balls: 3,
    ready: true,
    launchLane: false,
    ball: { x: 416, y: 275, vx: 0, vy: 0 },
    bumpers: bumperPositions.map(([x, y]) => ({ x, y, cool: 0, lit: false })),
    left: false,
    right: false,
    trail: [],
    time: 0,
    bonus: 0,
    rollovers: [false, false],
    rolloverCool: [0, 0],
  };
}
function segmentHit(b, ax, ay, bx, by, r = 7) {
  const dx = bx - ax,
    dy = by - ay,
    t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / (dx * dx + dy * dy), 0, 1),
    x = ax + t * dx,
    y = ay + t * dy,
    dist = Math.hypot(b.x - x, b.y - y);
  if (dist >= r) return false;
  let nx = (b.x - x) / (dist || 1),
    ny = (b.y - y) / (dist || 1);
  if (dist === 0) {
    nx = -dy / Math.hypot(dx, dy);
    ny = dx / Math.hypot(dx, dy);
  }
  b.x = x + nx * (r + 0.2);
  b.y = y + ny * (r + 0.2);
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= 1.83 * dot * nx;
    b.vy -= 1.83 * dot * ny;
  }
  return true;
}
function drain(s, env) {
  s.balls--;
  s.trail = [];
  env.sound('lose');
  if (s.balls <= 0) {
    s.phase = 'lost';
    env.end({
      won: false,
      score: s.score,
      message: env.t(
        'Three balls played. Can you beat that score?',
        '三颗弹球已用完，再来挑战最高分！',
      ),
    });
  } else {
    s.ready = true;
    s.launchLane = false;
    s.ball = { x: 416, y: 275, vx: 0, vy: 0 };
  }
}
export function stepPinball(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.bonus = Math.max(0, s.bonus - dt);
  s.left = i.held('ArrowLeft', 'KeyA');
  s.right = i.held('ArrowRight', 'KeyD');
  if (i.pointer.down) {
    s.left = i.pointer.x < 240;
    s.right = i.pointer.x >= 240;
  }
  for (const b of s.bumpers) b.cool = Math.max(0, b.cool - dt);
  s.rolloverCool = s.rolloverCool.map((c) => Math.max(0, c - dt));
  if (s.ready) {
    if (i.pressed('Space', 'Enter') || i.pointer.clicked) {
      s.ready = false;
      s.launchLane = true;
      s.ball.vx = 0;
      s.ball.vy = -390;
      env.sound('shoot');
    } else return;
  }
  const b = s.ball;
  const count = Math.max(1, Math.ceil(dt * 240)),
    step = dt / count;
  for (let n = 0; n < count; n++) {
    b.vy += 230 * step;
    b.x += b.vx * step;
    b.y += b.vy * step;
    if (s.launchLane && b.y <= 55) {
      s.launchLane = false;
      b.vx = -130;
      b.vy = -60;
    }
    if (!s.launchLane && b.x > 393 && b.y > 117) {
      b.x = 393;
      b.vx = -Math.abs(b.vx) * 0.94;
    }
    if (b.x < 55) {
      b.x = 55;
      b.vx = Math.abs(b.vx) * 0.94;
    }
    if (b.x > 425) {
      b.x = 425;
      b.vx = -Math.abs(b.vx) * 0.94;
    }
    if (b.y < 36) {
      b.y = 36;
      b.vy = Math.abs(b.vy) * 0.95;
    }
    for (const bumper of s.bumpers) {
      const dx = b.x - bumper.x,
        dy = b.y - bumper.y,
        d = Math.hypot(dx, dy);
      if (d < 23) {
        const nx = dx / (d || 1),
          ny = dy / (d || 1);
        b.x = bumper.x + nx * 23.2;
        b.y = bumper.y + ny * 23.2;
        b.vx = nx * 260;
        b.vy = ny * 260;
        if (bumper.cool === 0) {
          bumper.cool = 0.13;
          bumper.lit = true;
          s.score += 100;
          env.sound('coin');
          if (s.bumpers.every((p) => p.lit)) {
            s.score += 500;
            s.bonus = 1.5;
            s.bumpers.forEach((p) => (p.lit = false));
            env.sound('win');
          }
        }
      }
    }
    if (!s.launchLane) {
      segmentHit(b, 57, 211, 139, 284, 9);
      segmentHit(b, 391, 211, 341, 284, 9);
    }
    for (const [left, active] of s.launchLane
      ? []
      : [
          [true, s.left],
          [false, s.right],
        ]) {
      const ax = left ? 150 : 330,
        bx = left ? 222 : 258,
        by = active ? 230 : 273;
      if (
        active &&
        b.vy > 0 &&
        b.x > (left ? 144 : 251) &&
        b.x < (left ? 229 : 337) &&
        b.y > 224 &&
        b.y < 282
      ) {
        const t = clamp((b.x - ax) / (bx - ax), 0, 1);
        b.y = Math.min(b.y, 250 + (by - 250) * t - 10);
        b.vy = -285 - 100 * t;
        b.vx = (left ? 1 : -1) * (115 + 70 * (1 - t));
        env.sound('hit');
      } else segmentHit(b, ax, 250, bx, by, 10);
    }
    for (let k = 0; k < 2; k++) {
      if (
        !s.rollovers[k] &&
        s.rolloverCool[k] === 0 &&
        Math.abs(b.x - (k ? 365 : 115)) < 14 &&
        b.y < 66
      ) {
        s.rollovers[k] = true;
        s.rolloverCool[k] = 0.5;
        s.score += 200;
        env.sound('coin');
      }
    }
    if (s.rollovers.every(Boolean)) {
      s.score += 400;
      s.rollovers = [false, false];
      s.bonus = 1.5;
    }
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 470) {
      b.vx *= 470 / speed;
      b.vy *= 470 / speed;
    }
    if (b.y > 329) {
      drain(s, env);
      break;
    }
  }
  if (!s.ready) {
    s.trail.push({ x: b.x, y: b.y });
    if (s.trail.length > 10) s.trail.shift();
  }
}
function line(ctx, ax, ay, bx, by, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
function drawPinball(ctx, s, env) {
  background(ctx, '#101e32');
  ctx.fillStyle = '#24434d';
  ctx.fillRect(44, 24, 392, 284);
  ctx.fillStyle = '#142b3c';
  ctx.fillRect(52, 32, 376, 276);
  for (let y = 48; y < 275; y += 22)
    for (let x = 70; x < 420; x += 22) {
      ctx.fillStyle = (x + y) % 3 ? '#1c3845' : '#23414b';
      ctx.fillRect(x, y, 2, 2);
    }
  line(ctx, 51, 306, 51, 31, '#8cbdb7', 5);
  line(ctx, 429, 306, 429, 31, '#8cbdb7', 5);
  line(ctx, 51, 31, 429, 31, '#8cbdb7', 5);
  line(ctx, 57, 211, 139, 284, '#e1b674', 7);
  line(ctx, 391, 211, 341, 284, '#e1b674', 7);
  line(ctx, 402, 117, 402, 300, '#476973', 3);
  for (const b of s.bumpers) {
    ctx.fillStyle = '#37626a';
    ctx.fillRect(b.x - 22, b.y - 12, 44, 24);
    ctx.fillRect(b.x - 12, b.y - 22, 24, 44);
    ctx.fillStyle = b.cool > 0 ? '#fff0b6' : b.lit ? '#edc46e' : '#d17972';
    ctx.fillRect(b.x - 17, b.y - 10, 34, 20);
    ctx.fillRect(b.x - 10, b.y - 17, 20, 34);
    ctx.fillStyle = '#1d3845';
    ctx.fillRect(b.x - 7, b.y - 7, 14, 14);
    ctx.fillStyle = '#f5dfa8';
    ctx.fillRect(b.x - 3, b.y - 10, 6, 20);
    ctx.fillRect(b.x - 10, b.y - 3, 20, 6);
  }
  text(ctx, 'STAR', 240, 56, '#71aba7', 22, 'center');
  text(ctx, env.t('POCKET', '弹球台'), 240, 82, '#6a999c', 10, 'center');
  for (let k = 0; k < 2; k++) {
    ctx.fillStyle = s.rollovers[k] ? '#f3cf83' : '#45686b';
    ctx.fillRect((k ? 365 : 115) - 8, 49, 16, 8);
  }
  line(ctx, 150, 250, 222, s.left ? 230 : 273, '#527b82', 15);
  line(ctx, 150, 247, 222, (s.left ? 230 : 273) - 3, '#e7bf80', 10);
  line(ctx, 330, 250, 258, s.right ? 230 : 273, '#527b82', 15);
  line(ctx, 330, 247, 258, (s.right ? 230 : 273) - 3, '#e7bf80', 10);
  for (let k = 0; k < s.trail.length; k++) {
    ctx.fillStyle = k < 5 ? '#385665' : '#73939c';
    ctx.fillRect(s.trail[k].x - 2, s.trail[k].y - 2, 4, 4);
  }
  ctx.fillStyle = '#a7c4c8';
  ctx.fillRect(s.ball.x - 6, s.ball.y - 4, 12, 8);
  ctx.fillRect(s.ball.x - 4, s.ball.y - 6, 8, 12);
  ctx.fillStyle = '#f4f0d4';
  ctx.fillRect(s.ball.x - 3, s.ball.y - 4, 5, 4);
  text(ctx, `${s.score.toString().padStart(5, '0')}`, 14, 7, '#f1cf8f', 13);
  text(ctx, `${s.balls} ${env.t('BALLS', '球')}`, 466, 7, '#b6d3c7', 12, 'right');
  if (s.ready) {
    ctx.fillStyle = '#101e32';
    ctx.fillRect(115, 187, 250, 30);
    text(ctx, env.t('SPACE / TAP TO LAUNCH', '空格 / 点击发射'), 240, 197, '#f2d8a4', 12, 'center');
  } else if (s.bonus > 0)
    text(ctx, env.t('STAR BONUS!', '星星奖励！'), 240, 195, '#f9d880', 15, 'center');
}
meta.touchControls = [
  { code: 'ArrowLeft', label: { en: 'Left', zh: '左挡板' } },
  { code: 'ArrowRight', label: { en: 'Right', zh: '右挡板' } },
  { code: 'Space', label: { en: 'Launch', zh: '发射' } },
];

export function createGame(env) {
  const s = createPinballState();
  return {
    update: (dt, i) => stepPinball(s, dt, i, env),
    draw: (ctx) => drawPinball(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${s.balls} balls · Light all three bumpers`,
        zh: `${s.balls}颗球 · 点亮三个碰撞器`,
      },
    }),
  };
}
