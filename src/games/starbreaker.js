import { clamp, drawPixelText, background } from '../shared/utils.js';
export const meta = {
  id: 'starbreaker',
  name: { en: 'Starbreaker', zh: '星砖破坏者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'Space', label: { en: 'Launch', zh: '发球' } },
  ],
  description: {
    en: 'Clear three orbital brick fields. Catch upgrades and steer rebounds with your paddle.',
    zh: '清除三片轨道砖阵，接住强化道具，用球拍控制反弹方向。',
  },
  keys: [
    { label: { en: 'Move paddle', zh: '移动球拍' }, keys: 'Left / Right or A / D; drag' },
    { label: { en: 'Launch ball', zh: '发球' }, keys: 'Space / Up / click' },
  ],
};
const COLORS = ['#fb8264', '#eab961', '#7ad7a6', '#70baf3'];
export function makeBricks(level) {
  const bricks = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++)
      bricks.push({
        x: 48 + col * 48,
        y: 58 + row * 21,
        w: 42,
        h: 14,
        hp: level === 1 ? 1 : row < level - 1 ? 2 : 1,
        color: row,
      });
  return bricks;
}
export function circleRect(ball, r) {
  const x = clamp(ball.x, r.x, r.x + r.w),
    y = clamp(ball.y, r.y, r.y + r.h);
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
export function createBreakerState() {
  return {
    phase: 'playing',
    score: 0,
    level: 1,
    lives: 3,
    paddle: { x: 240, w: 80 },
    ball: { x: 240, y: 277, vx: 100, vy: -190, r: 4 },
    bricks: makeBricks(1),
    docked: true,
    powerups: [],
    particles: [],
    wide: 0,
    destroyed: 0,
    time: 0,
  };
}
export function stepBreaker(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.wide = Math.max(0, s.wide - dt);
  s.paddle.w = s.wide > 0 ? 120 : 80;
  const axis =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.paddle.x = clamp(s.paddle.x + axis * 310 * dt, s.paddle.w / 2 + 8, 472 - s.paddle.w / 2);
  if (input.pointer.down && input.pointer.x >= 0)
    s.paddle.x = clamp(input.pointer.x, s.paddle.w / 2 + 8, 472 - s.paddle.w / 2);
  if (s.docked) {
    s.ball.x = s.paddle.x;
    s.ball.y = 277;
    if (input.pressed('Space', 'ArrowUp', 'KeyW') || input.pointer.clicked) {
      s.docked = false;
      s.ball.vx = 95;
      s.ball.vy = -195;
    }
  }
  const steps = Math.max(1, Math.ceil(dt * 180)),
    sub = dt / steps;
  for (let i = 0; i < steps && !s.docked; i++) {
    const old = { x: s.ball.x, y: s.ball.y };
    s.ball.x += s.ball.vx * sub;
    s.ball.y += s.ball.vy * sub;
    if (s.ball.x < 12) {
      s.ball.x = 12;
      s.ball.vx = Math.abs(s.ball.vx);
    }
    if (s.ball.x > 468) {
      s.ball.x = 468;
      s.ball.vx = -Math.abs(s.ball.vx);
    }
    if (s.ball.y < 36) {
      s.ball.y = 36;
      s.ball.vy = Math.abs(s.ball.vy);
    }
    const paddle = { x: s.paddle.x - s.paddle.w / 2, y: 286, w: s.paddle.w, h: 9 };
    if (s.ball.vy > 0 && circleRect(s.ball, paddle)) {
      const offset = clamp((s.ball.x - s.paddle.x) / (s.paddle.w / 2), -1, 1),
        speed = 230 + (s.level - 1) * 25;
      s.ball.vx = offset * speed * 0.85;
      s.ball.vy = -Math.sqrt(speed * speed - s.ball.vx * s.ball.vx);
      s.ball.y = 281;
      s.particles.push({ x: s.ball.x, y: 286, life: 0.22 });
    }
    for (let b = s.bricks.length - 1; b >= 0; b--) {
      const brick = s.bricks[b];
      if (!circleRect(s.ball, brick)) continue;
      if (old.y <= brick.y || old.y >= brick.y + brick.h) {
        s.ball.vy *= -1;
        s.ball.y = s.ball.vy > 0 ? brick.y + brick.h + s.ball.r + 0.01 : brick.y - s.ball.r - 0.01;
      } else {
        s.ball.vx *= -1;
        s.ball.x = s.ball.vx > 0 ? brick.x + brick.w + s.ball.r + 0.01 : brick.x - s.ball.r - 0.01;
      }
      brick.hp--;
      s.score += 25;
      s.particles.push({ x: brick.x + 21, y: brick.y + 7, life: 0.4 });
      if (brick.hp <= 0) {
        s.bricks.splice(b, 1);
        s.destroyed++;
        s.score += 50;
        if (s.destroyed % 6 === 0)
          s.powerups.push({
            x: brick.x + 21,
            y: brick.y,
            type: ['wide', 'slow', 'life'][Math.floor(random() * 3)],
          });
      }
      break;
    }
    if (s.ball.y > 327) {
      s.lives--;
      if (s.lives <= 0) s.phase = 'lost';
      else s.docked = true;
      break;
    }
  }
  for (const p of s.powerups) {
    p.y += 75 * dt;
    if (Math.abs(p.x - s.paddle.x) < s.paddle.w / 2 + 6 && p.y > 280 && p.y < 303) {
      if (p.type === 'wide') {
        s.wide = 15;
        s.paddle.w = 120;
      }
      if (p.type === 'life') s.lives = Math.min(5, s.lives + 1);
      if (p.type === 'slow') {
        s.ball.vx *= 0.8;
        s.ball.vy *= 0.8;
      }
      p.y = 400;
      s.score += 50;
    }
  }
  s.powerups = s.powerups.filter((p) => p.y < 330);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-30);
  if (s.bricks.length === 0 && s.phase === 'playing') {
    if (s.level === 3) s.phase = 'won';
    else {
      s.level++;
      s.bricks = makeBricks(s.level);
      s.docked = true;
      s.powerups = [];
      s.score += 300;
    }
  }
}
export function createGame(env) {
  const s = createBreakerState();
  let ended = false,
    lastScore = 0,
    lastLives = 3;
  return {
    update(dt, input) {
      stepBreaker(s, dt, input, env.random);
      if (s.score > lastScore) env.sound('coin');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t('All orbital fields cleared!', '所有轨道砖阵已清除！')
              : env.t('Out of balls. The stars await another try.', '小球用完了，再次挑战星空吧。'),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#0c162b');
      for (let i = 0; i < 75; i++) {
        ctx.fillStyle = i % 4 ? '#263958' : '#7387a0';
        ctx.fillRect((i * 97) % 480, (i * 61) % 320, i % 4 ? 1 : 2, 1);
      }
      ctx.fillStyle = '#192b43';
      ctx.fillRect(4, 32, 4, 288);
      ctx.fillRect(472, 32, 4, 288);
      ctx.fillRect(8, 32, 464, 3);
      for (const b of s.bricks) {
        ctx.fillStyle = COLORS[b.color];
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#ffffff66';
        ctx.fillRect(b.x + 2, b.y + 1, b.w - 4, 2);
        ctx.fillStyle = '#10172f66';
        ctx.fillRect(b.x + 2, b.y + b.h - 3, b.w - 4, 3);
        if (b.hp > 1) {
          ctx.fillStyle = '#fff1cf';
          ctx.fillRect(b.x + 17, b.y + 5, 8, 3);
        }
      }
      for (const p of s.powerups) {
        ctx.fillStyle = p.type === 'wide' ? '#89e4b0' : p.type === 'life' ? '#fa866f' : '#92bbff';
        ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
        drawPixelText(
          ctx,
          p.type === 'wide' ? 'W' : p.type === 'life' ? '+' : 'S',
          p.x,
          p.y - 5,
          '#182436',
          10,
          'center',
        );
      }
      for (const p of s.particles) {
        ctx.strokeStyle = '#fef4b6';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 8 * (0.4 - p.life) * 8, p.y - 5, 16 * (0.4 - p.life) * 8, 10);
      }
      ctx.fillStyle = '#315878';
      ctx.fillRect(s.paddle.x - s.paddle.w / 2, 289, s.paddle.w, 9);
      ctx.fillStyle = '#9fe8ea';
      ctx.fillRect(s.paddle.x - s.paddle.w / 2, 285, s.paddle.w, 5);
      ctx.fillStyle = '#f0f6e5';
      ctx.fillRect(Math.round(s.ball.x - 4), Math.round(s.ball.y - 4), 8, 8);
      ctx.fillStyle = '#b4e3df';
      ctx.fillRect(s.ball.x - 2, s.ball.y + 4, 4, 2);
      drawPixelText(ctx, env.t('FIELD', '区域') + ' ' + s.level + '/3', 14, 12, '#97d5ed', 13);
      drawPixelText(ctx, '● '.repeat(Math.max(0, s.lives)), 466, 12, '#f5c276', 13, 'right');
      if (s.docked)
        drawPixelText(
          ctx,
          env.t('SPACE / TAP TO LAUNCH', '空格 / 点击发球'),
          240,
          244,
          '#e7dcb6',
          12,
          'center',
        );
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Field ${s.level}/3 · ${s.lives} balls`,
        zh: `区域 ${s.level}/3 · ${s.lives} 个球`,
      },
    }),
  };
}
