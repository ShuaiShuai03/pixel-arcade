// Starbreaker simulation: state, ball and paddle physics, bricks, upgrades and field progression.
import { clamp } from '../shared/utils.js';
import {
  LEVEL_COUNT,
  clampLevel,
  makeBricks,
  DRIFT_AMPLITUDE,
  DRIFT_RATE,
} from './starbreaker-levels.js';

const STEP = 1 / 240;
const MAX_FRAME = 0.1;
const MAX_BALL_SPEED = 360;
const MIN_LATERAL_SPEED = 25;
const MIN_VERTICAL_SPEED = 40;
const WALL_LEFT = 12;
const WALL_RIGHT = 468;
const CEILING = 36;
const FLOOR = 327;
const PADDLE_SPEED = 310;
const PADDLE_WIDTH = 80;
const WIDE_WIDTH = 120;
const REACTOR_RADIUS = 76;
const MAX_LIVES = 5;
const MAX_CATCHES = 3;
const LIFE_EVERY = 5;
const DOCK_Y = 277;
const NET_Y = 312;
const NET_SAVES = 2;

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
// The motorised paddle can add energy on each hit; the launcher's rail speed caps it.
function capSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_BALL_SPEED) return;
  ball.vx *= MAX_BALL_SPEED / speed;
  ball.vy *= MAX_BALL_SPEED / speed;
}
// Rough walls turn a ball that would otherwise bounce along one axis forever. Speed is conserved.
function turnLateral(ball, minimum) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (Math.abs(ball.vx) >= minimum || speed <= minimum) return;
  ball.vx = (ball.x < (WALL_LEFT + WALL_RIGHT) / 2 ? 1 : -1) * minimum;
  ball.vy = Math.sign(ball.vy || 1) * Math.sqrt(speed * speed - minimum * minimum);
}
function turnVertical(ball, minimum) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (Math.abs(ball.vy) >= minimum || speed <= minimum) return;
  ball.vy = (ball.vy < 0 ? -1 : 1) * minimum;
  ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(speed * speed - minimum * minimum);
}

function startField(s, level) {
  s.level = level;
  s.bricks = makeBricks(level);
  s.docked = true;
  s.dockOffset = 0;
  s.dockY = DOCK_Y;
  s.powerups = [];
  s.banner = 2;
  s.intro = true;
  s.net = level === 1 ? NET_SAVES : 0;
}
export function createBreakerState(level = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    lives: 3,
    paddle: { x: 240, w: PADDLE_WIDTH, vx: 0 },
    ball: { x: 240, y: DOCK_Y, vx: 100, vy: -190, r: 4 },
    particles: [],
    wide: 0,
    slow: 0,
    catches: MAX_CATCHES,
    catchReady: 0,
    combo: 0,
    trail: [],
    destroyed: 0,
    time: 0,
  };
  startField(s, clampLevel(level));
  return s;
}

/** Whole 1/240 s steps keep 30, 60 and 120 Hz identical; only the first step sees a fresh press. */
export function stepBreaker(s, dt, input, random) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const frame = Math.min(dt, MAX_FRAME),
    count = Math.max(1, Math.ceil(frame / STEP - 1e-6)),
    held = { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } };
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    simulateBreaker(s, frame / count, i === 0 ? input : held, random);
}
function pointerTarget(pointer) {
  const x = Number(pointer?.x);
  return pointer?.down && Number.isFinite(x) && x >= 0 ? clamp(x, 0, 480) : null;
}
function detonate(s, origin) {
  const queue = [origin];
  while (queue.length) {
    const source = queue.shift();
    for (const neighbor of s.bricks) {
      if (
        neighbor.hp <= 0 ||
        Math.hypot(neighbor.x - source.x, neighbor.y - source.y) >= REACTOR_RADIUS
      )
        continue;
      neighbor.hp--;
      if (neighbor.hp > 0) continue;
      s.score += 75;
      s.destroyed++;
      s.particles.push({ x: neighbor.x + 18, y: neighbor.y + 7, life: 0.5 });
      if (neighbor.kind === 'reactor') queue.push(neighbor);
    }
  }
  s.bricks = s.bricks.filter((b) => b.hp > 0);
}
function hitBrick(s, index, random) {
  const brick = s.bricks[index];
  brick.hp--;
  s.combo++;
  s.score += 25 + Math.min(5, s.combo - 1) * 5;
  s.particles.push({ x: brick.x + 21, y: brick.y + 7, life: 0.4 });
  if (brick.hp > 0) return;
  s.bricks.splice(index, 1);
  s.destroyed++;
  if (brick.kind === 'reactor') detonate(s, brick);
  s.score += 50;
  if (s.destroyed % 6 === 0)
    s.powerups.push({
      x: brick.x + 21,
      y: brick.y,
      type: ['wide', 'slow', 'life'][Math.floor(random() * 3)],
    });
}
function bounceWalls(ball) {
  if (ball.x < WALL_LEFT) {
    ball.x = WALL_LEFT;
    ball.vx = Math.abs(ball.vx);
    turnVertical(ball, MIN_VERTICAL_SPEED);
  }
  if (ball.x > WALL_RIGHT) {
    ball.x = WALL_RIGHT;
    ball.vx = -Math.abs(ball.vx);
    turnVertical(ball, MIN_VERTICAL_SPEED);
  }
  if (ball.y < CEILING) {
    ball.y = CEILING;
    ball.vy = Math.abs(ball.vy);
    turnLateral(ball, MIN_LATERAL_SPEED);
  }
}
// Returns true when the ball was grabbed by an emergency catch.
function bouncePaddle(s) {
  const contact = paddleContact(s.ball, s.paddle);
  if (!contact) return false;
  const surfaceX =
    contact.surfaceX ?? clamp(s.ball.x, s.paddle.x - s.paddle.w / 2, s.paddle.x + s.paddle.w / 2);
  const bodyVx = s.paddle.vx + ((surfaceX - s.paddle.x) / s.paddle.w) * s.paddle.widthVelocity;
  const approach = (s.ball.vx - bodyVx) * contact.x + s.ball.vy * contact.y;
  if (approach >= 0) return false;
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
    return true;
  }
  resolveContact(s.ball, contact, bodyVx, s.slow > 0 ? 0.8 : 1);
  capSpeed(s.ball);
  s.particles.push({ x: s.ball.x, y: 286, life: 0.22 });
  return false;
}
function bounceBricks(s, random) {
  for (let b = s.bricks.length - 1; b >= 0; b--) {
    const brick = s.bricks[b];
    if (!circleRect(s.ball, brick)) continue;
    const contact = contactNormal(s.ball, brick);
    const approach = (s.ball.vx - (brick.vx || 0)) * contact.x + s.ball.vy * contact.y;
    if (approach >= 0) continue;
    resolveContact(s.ball, contact, brick.vx || 0, 1);
    hitBrick(s, b, random);
    return;
  }
}
function loseBall(s) {
  s.lives--;
  s.combo = 0;
  s.catchReady = 0;
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  s.docked = true;
  s.dockOffset = 0;
  s.dockY = DOCK_Y;
}
// The training net of the first field returns a ball that crosses it, a limited number of times.
function saveWithNet(s, before) {
  if (s.net <= 0 || s.ball.vy <= 0 || before > NET_Y || s.ball.y <= NET_Y) return;
  s.net--;
  s.combo = 0;
  s.ball.y = NET_Y;
  s.ball.vy = -s.ball.vy;
}
function moveBall(s, dt, random) {
  const steps = Math.max(1, Math.ceil(dt * Math.max(180, Math.hypot(s.ball.vx, s.ball.vy) / 2))),
    sub = dt / steps;
  for (let i = 0; i < steps && !s.docked; i++) {
    const before = s.ball.y;
    s.ball.x += s.ball.vx * sub;
    s.ball.y += s.ball.vy * sub;
    bounceWalls(s.ball);
    if (bouncePaddle(s)) return;
    bounceBricks(s, random);
    saveWithNet(s, before);
    if (s.ball.y > FLOOR) {
      loseBall(s);
      return;
    }
  }
}
function movePaddle(s, input, dt) {
  const previousWidth = s.paddle.w;
  s.wide = Math.max(0, s.wide - dt);
  s.paddle.w += clamp((s.wide > 0 ? WIDE_WIDTH : PADDLE_WIDTH) - s.paddle.w, -80 * dt, 80 * dt);
  s.paddle.widthVelocity = (s.paddle.w - previousWidth) / dt;
  const axis =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  const target = pointerTarget(input.pointer),
    oldX = s.paddle.x;
  const movement =
    target === null
      ? axis * PADDLE_SPEED * dt
      : clamp(target - s.paddle.x, -PADDLE_SPEED * dt, PADDLE_SPEED * dt);
  const leftRail = Math.max(s.paddle.w / 2 + 8, s.docked ? 12 - s.dockOffset : 0);
  const rightRail = Math.min(472 - s.paddle.w / 2, s.docked ? 468 - s.dockOffset : 480);
  s.paddle.x = clamp(s.paddle.x + movement, leftRail, rightRail);
  s.paddle.vx = (s.paddle.x - oldX) / dt;
}
function collectUpgrades(s, dt) {
  for (const p of s.powerups) {
    p.y += 75 * dt;
    if (Math.abs(p.x - s.paddle.x) >= s.paddle.w / 2 + 6 || p.y <= 280 || p.y >= 303) continue;
    if (p.type === 'wide') s.wide = 15;
    if (p.type === 'life') s.lives = Math.min(MAX_LIVES, s.lives + 1);
    if (p.type === 'slow') s.slow = 12;
    p.y = 400;
    s.score += 50;
  }
  s.powerups = s.powerups.filter((p) => p.y < 330);
}
function clearField(s) {
  if (s.level >= LEVEL_COUNT) {
    s.phase = 'won';
    return;
  }
  const cleared = s.level;
  startField(s, cleared + 1);
  s.score += 300;
  s.catches = Math.min(MAX_CATCHES, s.catches + 1);
  if (cleared % LIFE_EVERY === 0) s.lives = Math.min(MAX_LIVES, s.lives + 1);
}
function simulateBreaker(s, dt, input, random) {
  s.time += dt;
  s.slow = Math.max(0, s.slow - dt);
  s.catchReady = Math.max(0, s.catchReady - dt);
  s.banner = Math.max(0, s.banner - dt);
  if (input.pressed('ArrowDown', 'KeyS') && s.catches > 0 && !s.docked) {
    s.catchReady = 3;
    s.catches--;
  }
  for (const b of s.bricks)
    if (b.drift) {
      b.x = b.baseX + Math.sin(s.time * DRIFT_RATE) * DRIFT_AMPLITUDE * b.drift;
      b.vx = Math.cos(s.time * DRIFT_RATE) * DRIFT_AMPLITUDE * DRIFT_RATE * b.drift;
    }
  movePaddle(s, input, dt);
  if (s.docked) {
    s.ball.x = s.paddle.x + s.dockOffset;
    s.ball.y = s.dockY;
    s.ball.vx = s.paddle.vx;
    s.ball.vy = 0;
    if (input.pressed('Space', 'ArrowUp', 'KeyW') || input.pointer?.clicked) {
      s.docked = false;
      s.intro = false;
      s.ball.vx = s.paddle.vx + 95;
      s.ball.vy = -195;
    }
  }
  moveBall(s, dt, random);
  collectUpgrades(s, dt);
  if (!s.docked) s.trail.push({ x: s.ball.x, y: s.ball.y });
  s.trail = s.trail.slice(-9);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-30);
  if (s.bricks.length === 0 && s.phase === 'playing') clearField(s);
}
