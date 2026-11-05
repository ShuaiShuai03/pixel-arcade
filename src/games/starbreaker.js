import { clamp, drawPixelText, background } from '../shared/utils.js';
export const meta = {
  id: 'starbreaker',
  name: { en: 'Starbreaker', zh: '星砖破坏者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Launch', zh: '发球' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Catch', zh: '接球' } },
  ],
  description: {
    en: 'Clear three orbital puzzles: lattice, reactor chain and drifting fleet. Move the paddle through contact to steer, catch upgrades, and use three emergency catches (Down).',
    zh: '清除晶格、反应堆连锁和漂移舰队三片砖阵。接触时移动球拍来控制反弹，接住强化；下键可使用三次紧急接球。',
  },
  keys: [
    { label: { en: 'Move paddle', zh: '移动球拍' }, keys: 'Left / Right or A / D; drag' },
    { label: { en: 'Launch ball', zh: '发球' }, keys: 'Space / Up / click' },
    {
      label: { en: 'Emergency catch', zh: '紧急接球' },
      keys: { en: 'Down / S (3 charges)', zh: '↓ / S（3次）' },
    },
  ],
};
const COLORS = ['#fb8264', '#eab961', '#7ad7a6', '#70baf3'];
export function makeBricks(level) {
  const bricks = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++) {
      if (level === 2 && (row === 0 || row === 3) && (col === 0 || col === 7)) continue;
      const x = 48 + col * 48 + (level === 2 && row % 2 ? 9 : 0);
      const y = 58 + row * (level === 2 ? 25 : 21) + (level === 3 ? Math.abs(3.5 - col) * 3 : 0);
      bricks.push({
        x,
        y,
        baseX: x,
        w: level === 2 ? 36 : 42,
        h: 14,
        hp: level > 1 && row === 0 ? 2 : 1,
        color: row,
        kind:
          level === 2 && ((row === 1 && col === 2) || (row === 2 && col === 5))
            ? 'reactor'
            : 'normal',
        drift: level === 3 ? (row % 2 ? -1 : 1) : 0,
      });
    }
  return bricks;
}
export function circleRect(ball, r) {
  const x = clamp(ball.x, r.x, r.x + r.w),
    y = clamp(ball.y, r.y, r.y + r.h);
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
// Circle contact normals follow the visible rectangular bodies, including their corners.
function contactNormal(ball, rect) {
  const px = clamp(ball.x, rect.x, rect.x + rect.w),
    py = clamp(ball.y, rect.y, rect.y + rect.h);
  const dx = ball.x - px,
    dy = ball.y - py,
    d = Math.hypot(dx, dy);
  if (d > 1e-9) return { x: dx / d, y: dy / d, depth: Math.max(0, ball.r - d) };
  const faces = [
    { x: -1, y: 0, depth: ball.x - rect.x + ball.r },
    { x: 1, y: 0, depth: rect.x + rect.w - ball.x + ball.r },
    { x: 0, y: -1, depth: ball.y - rect.y + ball.r },
    { x: 0, y: 1, depth: rect.y + rect.h - ball.y + ball.r },
  ];
  return faces.sort((a, b) => a.depth - b.depth)[0];
}
function paddleContact(ball, paddle) {
  const half = paddle.w / 2;
  let x = clamp(ball.x, paddle.x - half, paddle.x + half);
  for (let i = 0; i < 6; i++) {
    const u = (x - paddle.x) / half,
      y = 286 + 8 * u * u,
      slope = (16 * u) / half;
    const gradient = x - ball.x + (y - ball.y) * slope;
    const curvature = 1 + slope * slope + ((y - ball.y) * 16) / (half * half);
    x = clamp(x - gradient / Math.max(0.2, curvature), paddle.x - half, paddle.x + half);
  }
  const u = (x - paddle.x) / half,
    y = 286 + 8 * u * u,
    dx = ball.x - x,
    dy = ball.y - y,
    d = Math.hypot(dx, dy);
  if (d > ball.r || dy > 0 || d < 1e-9) {
    const body = { x: paddle.x - half, y: 294, w: paddle.w, h: 9 };
    return circleRect(ball, body) ? contactNormal(ball, body) : null;
  }
  return { x: dx / d, y: dy / d, depth: ball.r - d, surfaceX: x };
}
// Heavy walls and motor-driven bodies are kinematic: reflect in their rest frame.
// A damped paddle dissipates normal energy; no contact normalizes ball speed.
function resolveContact(ball, n, bodyVx, restitution) {
  const normal = (ball.vx - bodyVx) * n.x + ball.vy * n.y;
  const impulse = -(1 + restitution) * normal;
  ball.vx += impulse * n.x;
  ball.vy += impulse * n.y;
  ball.x += n.x * (n.depth + 0.0001);
  ball.y += n.y * (n.depth + 0.0001);
}
export function createBreakerState() {
  return {
    phase: 'playing',
    score: 0,
    level: 1,
    lives: 3,
    paddle: { x: 240, w: 80, vx: 0 },
    ball: { x: 240, y: 277, vx: 100, vy: -190, r: 4 },
    bricks: makeBricks(1),
    docked: true,
    dockOffset: 0,
    dockY: 277,
    powerups: [],
    particles: [],
    wide: 0,
    slow: 0,
    catches: 3,
    catchReady: 0,
    combo: 0,
    banner: 2,
    trail: [],
    destroyed: 0,
    time: 0,
  };
}
export function stepBreaker(s, dt, input, random) {
  const count = Math.max(1, Math.ceil(dt * Math.max(240, Math.hypot(s.ball.vx, s.ball.vy) / 1.5)));
  for (let i = 0; i < count; i++)
    simulateBreaker(
      s,
      dt / count,
      i === 0
        ? input
        : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      random,
    );
}
function simulateBreaker(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.slow = Math.max(0, (s.slow || 0) - dt);
  s.catchReady = Math.max(0, (s.catchReady || 0) - dt);
  s.banner = Math.max(0, (s.banner || 0) - dt);
  if (input.pressed('ArrowDown', 'KeyS') && s.catches > 0 && !s.docked) {
    s.catchReady = 3;
    s.catches--;
  }
  for (const b of s.bricks)
    if (b.drift) {
      b.x = b.baseX + Math.sin(s.time * 0.65) * 18 * b.drift;
      b.vx = Math.cos(s.time * 0.65) * 11.7 * b.drift;
    }
  s.wide = Math.max(0, s.wide - dt);
  const previousWidth = s.paddle.w,
    targetWidth = s.wide > 0 ? 120 : 80;
  s.paddle.w += clamp(targetWidth - s.paddle.w, -80 * dt, 80 * dt);
  s.paddle.widthVelocity = dt > 0 ? (s.paddle.w - previousWidth) / dt : 0;
  const axis =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  const oldPaddleX = s.paddle.x;
  let movement = axis * 310 * dt;
  if (input.pointer.down && input.pointer.x >= 0)
    movement = clamp(input.pointer.x - s.paddle.x, -310 * dt, 310 * dt);
  const leftRail = Math.max(s.paddle.w / 2 + 8, s.docked ? 12 - s.dockOffset : 0);
  const rightRail = Math.min(472 - s.paddle.w / 2, s.docked ? 468 - s.dockOffset : 480);
  s.paddle.x = clamp(s.paddle.x + movement, leftRail, rightRail);
  s.paddle.vx = dt > 0 ? (s.paddle.x - oldPaddleX) / dt : 0;
  if (s.docked) {
    s.ball.x = s.paddle.x + s.dockOffset;
    s.ball.y = s.dockY;
    s.ball.vx = s.paddle.vx;
    s.ball.vy = 0;
    if (input.pressed('Space', 'ArrowUp', 'KeyW') || input.pointer.clicked) {
      s.docked = false;
      s.ball.vx = s.paddle.vx + 95;
      s.ball.vy = -195;
    }
  }
  const steps = Math.max(1, Math.ceil(dt * Math.max(180, Math.hypot(s.ball.vx, s.ball.vy) / 2))),
    sub = dt / steps;
  for (let i = 0; i < steps && !s.docked; i++) {
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
    const contact = paddleContact(s.ball, s.paddle);
    if (contact) {
      const surfaceX =
        contact.surfaceX ??
        clamp(s.ball.x, s.paddle.x - s.paddle.w / 2, s.paddle.x + s.paddle.w / 2);
      const bodyVx = s.paddle.vx + ((surfaceX - s.paddle.x) / s.paddle.w) * s.paddle.widthVelocity;
      const approach = (s.ball.vx - bodyVx) * contact.x + s.ball.vy * contact.y;
      if (approach < 0) {
        s.combo = 0;
        if (s.catchReady > 0 && contact.y < 0) {
          s.ball.x += contact.x * contact.depth;
          s.ball.y += contact.y * contact.depth;
          s.dockOffset = s.ball.x - s.paddle.x;
          s.dockY = s.ball.y;
          s.docked = true;
          s.catchReady = 0;
          s.ball.vx = s.paddle.vx;
          s.ball.vy = 0;
          break;
        }
        resolveContact(s.ball, contact, bodyVx, s.slow > 0 ? 0.8 : 1);
        s.particles.push({ x: s.ball.x, y: 286, life: 0.22 });
      }
    }
    for (let b = s.bricks.length - 1; b >= 0; b--) {
      const brick = s.bricks[b];
      if (!circleRect(s.ball, brick)) continue;
      const contact = contactNormal(s.ball, brick);
      const approach = (s.ball.vx - (brick.vx || 0)) * contact.x + s.ball.vy * contact.y;
      if (approach >= 0) continue;
      resolveContact(s.ball, contact, brick.vx || 0, 1);
      brick.hp--;
      s.combo++;
      s.score += 25 + Math.min(5, s.combo - 1) * 5;
      s.particles.push({ x: brick.x + 21, y: brick.y + 7, life: 0.4 });
      if (brick.hp <= 0) {
        s.bricks.splice(b, 1);
        s.destroyed++;
        if (brick.kind === 'reactor') {
          for (const neighbor of s.bricks)
            if (neighbor !== brick && Math.hypot(neighbor.x - brick.x, neighbor.y - brick.y) < 76) {
              neighbor.hp--;
              if (neighbor.hp <= 0) {
                s.score += 75;
                s.destroyed++;
                s.particles.push({ x: neighbor.x + 18, y: neighbor.y + 7, life: 0.5 });
              }
            }
          s.bricks = s.bricks.filter((b) => b.hp > 0);
        }
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
      s.combo = 0;
      s.catchReady = 0;
      if (s.lives <= 0) s.phase = 'lost';
      else {
        s.docked = true;
        s.dockOffset = 0;
        s.dockY = 277;
      }
      break;
    }
  }
  for (const p of s.powerups) {
    p.y += 75 * dt;
    if (Math.abs(p.x - s.paddle.x) < s.paddle.w / 2 + 6 && p.y > 280 && p.y < 303) {
      if (p.type === 'wide') {
        s.wide = 15;
      }
      if (p.type === 'life') s.lives = Math.min(5, s.lives + 1);
      if (p.type === 'slow') {
        s.slow = 12;
      }
      p.y = 400;
      s.score += 50;
    }
  }
  s.powerups = s.powerups.filter((p) => p.y < 330);
  if (!s.docked) s.trail.push({ x: s.ball.x, y: s.ball.y });
  s.trail = s.trail.slice(-9);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-30);
  if (s.bricks.length === 0 && s.phase === 'playing') {
    if (s.level === 3) s.phase = 'won';
    else {
      s.level++;
      s.bricks = makeBricks(s.level);
      s.docked = true;
      s.dockOffset = 0;
      s.dockY = 277;
      s.powerups = [];
      s.score += 300;
      s.catches = Math.min(3, s.catches + 1);
      s.banner = 2;
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
      ctx.fillRect(8, 29, 464, 3);
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
          p.type === 'wide' ? 'W' : p.type === 'life' ? '+' : 'D',
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
      ctx.fillRect(s.paddle.x - s.paddle.w / 2, 296, s.paddle.w, 7);
      ctx.fillStyle = s.slow > 0 ? '#92bbff' : '#9fe8ea';
      for (let x = -s.paddle.w / 2; x < s.paddle.w / 2; x += 2) {
        const top = 286 + 8 * (x / (s.paddle.w / 2)) ** 2;
        ctx.fillRect(s.paddle.x + x, top, 2, 300 - top);
      }
      for (let i = 0; i < s.trail.length; i++) {
        ctx.fillStyle = i < 4 ? '#2b525d' : '#52868d';
        ctx.fillRect(s.trail[i].x - 2, s.trail[i].y - 2, 4, 4);
      }
      if (s.catchReady > 0) {
        ctx.strokeStyle = '#ffdc83';
        ctx.strokeRect(s.paddle.x - s.paddle.w / 2 - 3, 281, s.paddle.w + 6, 15);
      }
      for (const b of s.bricks)
        if (b.kind === 'reactor') {
          ctx.fillStyle = '#ffea9c';
          ctx.fillRect(b.x + b.w / 2 - 2, b.y + 2, 4, 10);
          ctx.fillRect(b.x + b.w / 2 - 6, b.y + 5, 12, 4);
        }
      if (s.docked) {
        ctx.strokeStyle = '#b2c3cf';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.paddle.x, 299);
        ctx.lineTo(s.ball.x, 299);
        ctx.lineTo(s.ball.x, s.ball.y + 6);
        ctx.stroke();
        ctx.strokeRect(s.ball.x - 6, s.ball.y - 5, 12, 11);
      }
      ctx.fillStyle = '#f0f6e5';
      ctx.fillRect(Math.round(s.ball.x - 4), Math.round(s.ball.y - 4), 8, 8);
      ctx.fillStyle = '#b4e3df';
      ctx.fillRect(s.ball.x - 2, s.ball.y + 4, 4, 2);
      drawPixelText(ctx, env.t('FIELD', '区域') + ' ' + s.level + '/3', 14, 12, '#97d5ed', 13);
      drawPixelText(ctx, '● '.repeat(Math.max(0, s.lives)), 466, 12, '#f5c276', 13, 'right');
      drawPixelText(
        ctx,
        env.t('CATCH', '接球') + ' ' + s.catches,
        240,
        12,
        '#c7a2e8',
        11,
        'center',
      );
      if (s.banner > 0)
        drawPixelText(
          ctx,
          [
            env.t('I • CRYSTAL LATTICE', '一 · 晶体格阵'),
            env.t('II • CHAIN REACTORS', '二 · 连锁反应堆'),
            env.t('III • DRIFTING FLEET', '三 · 漂移舰队'),
          ][s.level - 1],
          240,
          200,
          '#aee1e5',
          13,
          'center',
        );
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
