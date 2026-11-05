import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'pinball-pocket',
  name: { en: 'Pinball Pocket', zh: '口袋弹球' },
  description: {
    en: 'Play three balls on the star table. Time rotating flippers, light bumper banks, shoot the right ramp and clear top targets to build a 5× multiplier.',
    zh: '挑战三颗弹球。把握挡板时机，点亮碰撞器，射入右侧坡道并击落顶部标靶，将倍率提升至5倍。',
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
    multiplier: 1,
    targets: [false, false, false],
    targetCool: [0, 0, 0],
    ramps: 0,
    rampCool: 0,
    bumperHits: 0,
    targetHits: 0,
    rolloverHits: 0,
    bumperWork: 0,
    motorWork: 0,
    plungerWork: 0,
    flippers: [
      { angle: 0.31, omega: 0 },
      { angle: Math.PI - 0.31, omega: 0 },
    ],
    rollovers: [false, false],
    rolloverCool: [0, 0],
  };
}
// Unit ball mass. Coordinates point down, so gravity is +230 px/s².
// Prescribed flipper motors / pop-bumper solenoids are the only energy sources.
export function contactImpulse(ball, nx, ny, surfaceVX = 0, surfaceVY = 0, restitution = 0.83) {
  const inward = (ball.vx - surfaceVX) * nx + (ball.vy - surfaceVY) * ny;
  if (inward >= 0) return 0;
  const before = (ball.vx * ball.vx + ball.vy * ball.vy) / 2;
  const e = Math.abs(inward) < 8 ? 0 : clamp(restitution, 0, 1);
  ball.vx -= (1 + e) * inward * nx;
  ball.vy -= (1 + e) * inward * ny;
  return (ball.vx * ball.vx + ball.vy * ball.vy) / 2 - before;
}
function segmentHit(b, ax, ay, bx, by, r = 9, previous = null) {
  const dx = bx - ax,
    dy = by - ay,
    len2 = dx * dx + dy * dy;
  let t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / len2, 0, 1);
  let x = ax + t * dx,
    y = ay + t * dy,
    dist = Math.hypot(b.x - x, b.y - y);
  // Sweep a circle against the capsule's side and round endpoints. This also
  // catches a complete crossing at unusually high speed, not just penetration.
  if (dist >= r && previous) {
    const mx = b.x - previous.x,
      my = b.y - previous.y;
    const len = Math.sqrt(len2),
      nx = -dy / len,
      ny = dx / len;
    const a = (previous.x - ax) * nx + (previous.y - ay) * ny,
      den = mx * nx + my * ny;
    let earliest = Infinity;
    if (den !== 0)
      for (const side of [-r, r]) {
        const u = (side - a) / den;
        const along = ((previous.x + mx * u - ax) * dx + (previous.y + my * u - ay) * dy) / len2;
        if (u >= 0 && u <= 1 && along >= 0 && along <= 1) earliest = Math.min(earliest, u);
      }
    for (const [ex, ey] of [
      [ax, ay],
      [bx, by],
    ]) {
      const ox = previous.x - ex,
        oy = previous.y - ey,
        A = mx * mx + my * my,
        B = 2 * (ox * mx + oy * my),
        C = ox * ox + oy * oy - r * r;
      const disc = B * B - 4 * A * C;
      if (A > 0 && disc >= 0) {
        const u = (-B - Math.sqrt(disc)) / (2 * A);
        if (u >= 0 && u <= 1) earliest = Math.min(earliest, u);
      }
    }
    if (!Number.isFinite(earliest)) return null;
    b.x = previous.x + mx * earliest;
    b.y = previous.y + my * earliest;
    t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / len2, 0, 1);
    x = ax + t * dx;
    y = ay + t * dy;
    dist = Math.hypot(b.x - x, b.y - y);
  } else if (dist >= r) return null;
  let nx = (b.x - x) / (dist || 1),
    ny = (b.y - y) / (dist || 1);
  if (dist < 1e-8) {
    const length = Math.sqrt(len2);
    nx = -dy / length;
    ny = dx / length;
    if (b.vx * nx + b.vy * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  b.x = x + nx * (r + 0.001);
  b.y = y + ny * (r + 0.001);
  const inward = b.vx * nx + b.vy * ny;
  contactImpulse(b, nx, ny);
  return { x, y, nx, ny, t, impact: inward < 0 };
}
function driveFlipper(f, active, left, dt) {
  const target = left ? (active ? -0.3 : 0.31) : active ? Math.PI + 0.3 : Math.PI - 0.31;
  // Motor torque gives finite angular acceleration; hard travel stops absorb
  // any remaining rotor energy instead of rotating through the table.
  const desired = clamp((target - f.angle) * 60, -12, 12);
  f.omega += clamp(desired - f.omega, -260 * dt, 260 * dt);
  const next = f.angle + f.omega * dt;
  if ((target - f.angle) * (target - next) <= 0) {
    f.angle = target;
    f.omega = 0;
  } else f.angle = next;
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
  dt = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  s.time += dt;
  s.rampCool = Math.max(0, s.rampCool - dt);
  s.targetCool = s.targetCool.map((t) => Math.max(0, t - dt));
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
      const before = (s.ball.vx * s.ball.vx + s.ball.vy * s.ball.vy) / 2;
      s.ball.vy -= 390;
      s.plungerWork += (s.ball.vx * s.ball.vx + s.ball.vy * s.ball.vy) / 2 - before;
      env.sound('shoot');
    } else {
      for (let k = 0; k < 2; k++)
        driveFlipper(s.flippers[k], k === 0 ? s.left : s.right, k === 0, dt);
      return;
    }
  }
  const b = s.ball;
  const count = Math.max(1, Math.ceil(dt * Math.max(720, (Math.hypot(b.vx, b.vy) + 912) / 1.5))),
    step = dt / count;
  for (let n = 0; n < count; n++) {
    b.vy += 230 * step;
    b.x += b.vx * step;
    b.y += b.vy * step;
    // The visible diagonal return rail bends the plunger shot into the field.
    const previous = { x: b.x - b.vx * step, y: b.y - b.vy * step };
    segmentHit(b, 392, 35, 427, 64, 9, previous);
    segmentHit(b, 402, 117, 402, 318, 7.5, previous);
    segmentHit(b, 370, 117, 386, 70, 8.5, previous);
    segmentHit(b, 386, 70, 338, 42, 8.5, previous);
    if (s.launchLane && b.x < 395) s.launchLane = false;
    if (b.x < 60) {
      b.x = 60;
      contactImpulse(b, 1, 0, 0, 0, 0.94);
    }
    if (b.x > 420) {
      b.x = 420;
      contactImpulse(b, -1, 0, 0, 0, 0.94);
    }
    if (b.y < 40) {
      b.y = 40;
      contactImpulse(b, 0, 1, 0, 0, 0.95);
    }
    for (const bumper of s.bumpers) {
      const dx = b.x - bumper.x,
        dy = b.y - bumper.y,
        d = Math.hypot(dx, dy);
      if (d < 23) {
        const nx = d > 1e-8 ? dx / d : 0,
          ny = d > 1e-8 ? dy / d : -1;
        b.x = bumper.x + nx * 23.001;
        b.y = bumper.y + ny * 23.001;
        const incoming = b.vx * nx + b.vy * ny;
        contactImpulse(b, nx, ny, 0, 0, 0.82);
        if (bumper.cool === 0 && incoming < 0) {
          // A visible, powered pop bumper gives one outward solenoid impulse.
          // Tangential momentum is preserved; cooldown prevents repeated energy.
          const before = (b.vx * b.vx + b.vy * b.vy) / 2;
          b.vx += nx * 90;
          b.vy += ny * 90;
          s.bumperWork += (b.vx * b.vx + b.vy * b.vy) / 2 - before;
          s.bumperHits++;
          bumper.cool = 0.13;
          bumper.lit = true;
          s.score += 100 * s.multiplier;
          env.sound('coin');
          if (s.bumpers.every((p) => p.lit)) {
            s.score += 500 * s.multiplier;
            s.bonus = 1.5;
            s.bumpers.forEach((p) => (p.lit = false));
            env.sound('win');
          }
        }
      }
    }
    if (!s.launchLane) {
      segmentHit(b, 57, 211, 139, 284, 9.5, previous);
      segmentHit(b, 391, 211, 341, 284, 9.5, previous);
    }
    for (let k = 0; k < 2; k++) {
      const f = s.flippers[k],
        active = k === 0 ? s.left : s.right;
      driveFlipper(f, active, k === 0, step);
      if (s.launchLane) continue;
      const ax = k === 0 ? 150 : 330,
        ay = 250;
      const bx = ax + 76 * Math.cos(f.angle),
        by = ay + 76 * Math.sin(f.angle);
      // Rotating capsule contact. Only the surface can impart flipper energy.
      const dx = bx - ax,
        dy = by - ay,
        t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / (76 * 76), 0, 1);
      const cx = ax + t * dx,
        cy = ay + t * dy,
        dist = Math.hypot(b.x - cx, b.y - cy);
      if (dist < 12) {
        const nx = dist > 0.001 ? (b.x - cx) / dist : 0,
          ny = dist > 0.001 ? (b.y - cy) / dist : -1;
        const svx = -f.omega * (cy - ay),
          svy = f.omega * (cx - ax);
        const dot = (b.vx - svx) * nx + (b.vy - svy) * ny;
        b.x = cx + nx * 12.001;
        b.y = cy + ny * 12.001;
        if (dot < 0) {
          const work = contactImpulse(b, nx, ny, svx, svy, 0.65);
          if (f.omega !== 0) s.motorWork += work;
          env.sound('hit');
        }
      }
    }
    // Real rectangle/circle contact for raised targets; a lit target is down.
    for (let k = 0; k < 3; k++)
      if (!s.launchLane && !s.targets[k]) {
        const cx = 210 + k * 30;
        const px = clamp(b.x, cx - 8, cx + 8),
          py = clamp(b.y, 34, 41);
        const dx = b.x - px,
          dy = b.y - py,
          d = Math.hypot(dx, dy);
        if (d < 6 && b.vx * dx + b.vy * dy < 0) {
          const nx = dx / (d || 1),
            ny = dy / (d || 1);
          b.x = px + nx * 6.001;
          b.y = py + ny * 6.001;
          contactImpulse(b, nx, ny, 0, 0, 0.72);
          if (s.targetCool[k] > 0) continue;
          s.targetHits++;
          s.targets[k] = true;
          s.targetCool[k] = 0.35;
          s.score += 75 * s.multiplier;
          env.sound('coin');
          if (s.targets.every(Boolean)) {
            s.targets = [false, false, false];
            s.multiplier = Math.min(5, s.multiplier + 1);
            s.bonus = 1.5;
          }
        }
      }
    // Optical ramp gate awards the physical pass; it never moves the ball.
    if (
      !s.launchLane &&
      s.rampCool === 0 &&
      b.x > 365 &&
      b.x < 390 &&
      previous.y >= 118 &&
      b.y < 118 &&
      b.vy < -150
    ) {
      s.ramps++;
      s.rampCool = 1.3;
      s.score += 300 * s.multiplier;

      s.bonus = 1.5;
      env.sound('coin');
    }
    for (let k = 0; k < 2; k++) {
      if (
        !s.rollovers[k] &&
        s.rolloverCool[k] === 0 &&
        Math.abs(b.x - (k ? 365 : 115)) < 14 &&
        b.y < 66
      ) {
        s.rolloverHits++;
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
  line(ctx, 402, 117, 402, 318, '#476973', 3);
  line(ctx, 392, 35, 427, 64, '#8cbdb7', 6);
  for (const b of s.bumpers) {
    // A painted shadow sits on the playfield; the colored 17px disc is solid.
    for (let y = -17; y < 17; y += 2) {
      const half = Math.floor(Math.sqrt(Math.max(0, 17 * 17 - y * y)));
      ctx.fillStyle = '#0c2230';
      ctx.fillRect(b.x - half, b.y + y + 5, half * 2, 2);
    }
    const color = b.cool > 0 ? '#fff0b6' : b.lit ? '#edc46e' : '#d17972';
    for (let y = -17; y < 17; y += 2) {
      const half = Math.floor(Math.sqrt(Math.max(0, 17 * 17 - y * y)));
      ctx.fillStyle = color;
      ctx.fillRect(b.x - half, b.y + y, half * 2, 2);
    }
    ctx.fillStyle = '#1d3845';
    ctx.fillRect(b.x - 7, b.y - 7, 14, 14);
    ctx.fillStyle = '#f5dfa8';
    ctx.fillRect(b.x - 3, b.y - 10, 6, 20);
    ctx.fillRect(b.x - 10, b.y - 3, 20, 6);
  }
  ctx.fillStyle = '#607e8a';
  ctx.fillRect(411, 283, 10, 22);
  for (let y = 286; y < 306; y += 5) {
    ctx.fillStyle = '#aac0bd';
    ctx.fillRect(408, y, 16, 2);
  }
  ctx.fillStyle = '#d9b977';
  ctx.fillRect(408, 278, 16, 5);
  text(ctx, 'STAR', 240, 56, '#71aba7', 22, 'center');
  text(ctx, env.t('POCKET', '弹球台'), 240, 82, '#6a999c', 10, 'center');
  for (let k = 0; k < 2; k++) {
    ctx.fillStyle = s.rollovers[k] ? '#f3cf83' : '#45686b';
    ctx.fillRect((k ? 365 : 115) - 8, 49, 16, 8);
  }
  for (let k = 0; k < 2; k++) {
    const ax = k === 0 ? 150 : 330,
      f = s.flippers[k];
    const bx = ax + 76 * Math.cos(f.angle),
      by = 250 + 76 * Math.sin(f.angle);
    line(ctx, ax, 250, bx, by, '#527b82', 12);
    line(ctx, ax, 247, bx, by - 3, '#e7bf80', 9);
    ctx.fillStyle = '#f6deb1';
    ctx.fillRect(ax - 3, 247, 6, 6);
  }
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = s.targets[k] ? '#edc46e' : '#708ea8';
    ctx.fillRect(202 + k * 30, s.targets[k] ? 37 : 34, 16, s.targets[k] ? 2 : 7);
  }
  line(ctx, 370, 117, 386, 70, '#8a72a7', 5);
  line(ctx, 386, 70, 338, 42, '#8a72a7', 5);
  for (let k = 0; k < 3; k++) text(ctx, String(k + 1), 210 + k * 30, 46, '#b3c8ca', 8, 'center');
  text(ctx, `×${s.multiplier}`, 78, 175, '#eed599', 16);
  ctx.fillStyle = s.rampCool > 0 ? '#f9dea2' : '#c2abce';
  for (let x = 375; x < 395; x += 5) ctx.fillRect(x, 117, 3, 2);
  text(ctx, env.t('RAMP', '坡道'), 376, 128, '#beabd3', 9, 'center');
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
  { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左挡板' } },
  { code: 'ArrowRight', side: 'right', label: { en: 'Right', zh: '右挡板' } },
  { code: 'Space', side: 'right', label: { en: 'Launch', zh: '发射' } },
];

export function createGame(env) {
  const s = createPinballState();
  return {
    update: (dt, i) => stepPinball(s, dt, i, env),
    draw: (ctx) => drawPinball(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${s.balls} balls · ×${s.multiplier} · ${s.ramps} ramps · Drop targets raise multiplier`,
        zh: `${s.balls}颗球 · ×${s.multiplier} · ${s.ramps}次坡道 · 击落标靶提升倍率`,
      },
    }),
  };
}
