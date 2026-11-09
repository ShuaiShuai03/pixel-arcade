// One simulation step: aiming servo, shot flight, guided capture, pusher motion and level flow.
import { clamp } from '../shared/utils.js';
import {
  EPS,
  LIMIT,
  RIGHT,
  LEFT,
  AIM_MAX,
  AIM_MIN,
  isBusy,
  ROW_H,
  SHOT_Y,
  createBubbleState,
  deepest,
  goalMet,
  nextColor,
  palette,
  resolveBubble,
} from './bubble-pop-rules.js';
import { capturePlan, nextEvent, trace } from './bubble-pop-aim.js';
import { saveUnlocked } from './bubble-pop-menu.js';
const LOSS_TEXT = {
  line: [
    'The pusher rack crossed the safety line. Clear matching groups sooner.',
    '推板架越过了安全线，请更早消除同色泡泡。',
  ],
  budget: [
    'Out of capsules before the cavern was done. Plan each shot and use the bank.',
    '泡泡用完了，洞穴还没完成。请规划每一发并善用反弹。',
  ],
  socket: ['A capsule found no legal socket.', '泡泡找不到合法的卡槽。'],
};
function end(s, env, won, reason = 'line') {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.queuedFire = false;
  s.reason = reason;
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t(
          `All ${s.totalLevels} caverns drained. Every valve is clear!`,
          `全部 ${s.totalLevels} 座洞穴已排空，所有阀门都已清除！`,
        )
      : env.t(...LOSS_TEXT[reason]),
  });
}
function shoot(s, env) {
  const preview = trace(s, s.angle);
  s.queuedFire = false;
  if (!preview.plan) {
    s.message = 'socket';
    s.messageTime = 1.5;
    env.sound('move');
    return false;
  }
  s.shot = {
    x: 240,
    y: SHOT_Y,
    vx: Math.cos(s.angle) * 350,
    vy: Math.sin(s.angle) * 350,
    color: s.current,
    event: null,
  };
  s.shots++;
  s.stageShots++;
  if (s.shotBudget) s.shotsLeft--;
  s.lastShotAngle = s.angle;
  env.sound('shoot');
  return true;
}
function capturePosition(c, distance) {
  let left = distance;
  for (const segment of c.segments) {
    if (left <= segment.length + EPS) {
      const t = segment.length ? clamp(left / segment.length, 0, 1) : 1;
      if (segment.kind === 'line')
        return {
          x: segment.from.x + (segment.to.x - segment.from.x) * t,
          y: segment.from.y + (segment.to.y - segment.from.y) * t,
        };
      const a = segment.from + segment.span * t;
      return { x: segment.cx + 24 * Math.cos(a), y: segment.cy + 24 * Math.sin(a) };
    }
    left -= segment.length;
  }
  return { ...c.target };
}
function beginCapture(s, b, event, env) {
  const plan = capturePlan(s, b, event, event.objects);
  if (!plan) {
    end(s, env, false, 'socket');
    s.shot = null;
    return;
  }
  const duration = Math.max(0.1, Math.sqrt((6 * plan.length) / 900), (1.5 * plan.length) / 140);
  s.capture = { ...plan, color: b.color, x: b.x, y: b.y, time: 0, duration, speed: 0 };
  s.shot = null;
}
function finishCapture(s, env) {
  const c = s.capture,
    removed = resolveBubble(s, c.row, c.col, c.color, env);
  s.capture = null;
  if (removed) s.misses = Math.max(0, s.misses - (removed >= 6 ? 2 : 1));
  else if (++s.misses >= s.maxMisses) {
    s.misses = 0;
    s.pressureWarning = 0.65;
    s.ceilingMotion = { from: s.ceiling, to: s.ceiling + ROW_H, time: 0, duration: 0.8 };
    env.sound('hit');
  }
  if (palette(s).length) {
    s.current = palette(s).includes(s.next) ? s.next : nextColor(s, env);
    s.next = nextColor(s, env);
  }
}
/** Pointer fields the simulation trusts: finite canvas coordinates, or off-canvas. */
function readPointer(input) {
  const p = input.pointer,
    finite = (v) => (Number.isFinite(v) ? v : -1);
  return { down: Boolean(p?.down), x: finite(p?.x), y: finite(p?.y), clicked: Boolean(p?.clicked) };
}
const NEXT_AT = { x: 435, y: 256 };
const aimAt = (p) => clamp(Math.atan2(p.y - SHOT_Y, p.x - 240), AIM_MIN, AIM_MAX);
function progress(s, env) {
  if (deepest(s) >= LIMIT - EPS) {
    end(s, env, false);
    return;
  }
  if (s.capture || s.shot || s.transition > 0 || s.popped.length) return;
  if (goalMet(s)) {
    s.score += Math.max(0, 60 - s.stageShots) * 10;
    saveUnlocked(env, Math.min(s.level + 1, s.totalLevels));
    if (s.level === s.totalLevels) end(s, env, true);
    else {
      s.transition = 1.2;
      s.pressureWarning = 0;
      s.ceilingMotion = null;
      s.queuedFire = false;
      env.sound('win');
    }
  } else if (s.shotBudget && s.shotsLeft <= 0 && !s.ceilingMotion && s.pressureWarning <= 0)
    end(s, env, false, 'budget');
}
function advance(s, dt, input) {
  s.time += dt;
  s.messageTime = Math.max(0, s.messageTime - dt);
  const axis = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  let acceleration;
  if (s.aimTarget !== null) {
    const error = s.aimTarget - s.angle;
    acceleration = clamp(50 * error - 14 * s.angularVelocity, -12, 12);
    if (
      (s.angularVelocity >= 2.6 && acceleration > 0) ||
      (s.angularVelocity <= -2.6 && acceleration < 0)
    )
      acceleration = 0;
  } else {
    const desired = axis * 1.65;
    acceleration = dt ? clamp((desired - s.angularVelocity) / dt, -12, 12) : 0;
  }
  const omega = s.angularVelocity;
  s.angularVelocity += acceleration * dt;
  s.angle = clamp(s.angle + omega * dt + (acceleration * dt * dt) / 2, AIM_MIN, AIM_MAX);
  if (s.angle === AIM_MIN || s.angle === AIM_MAX) s.angularVelocity = 0;
  for (const p of s.popped) {
    p.life -= dt;
    p.z += p.vz * dt + 300 * dt * dt;
    p.vz += 600 * dt;
  }
  s.popped = s.popped.filter((p) => p.life > 0).slice(-180);
}
function smooth(t) {
  return 3 * t * t - 2 * t * t * t;
}
function ceilingAdvance(s, dt, input, env) {
  const m = s.ceilingMotion,
    initial = s.ceiling,
    threshold = LIMIT - (deepest(s) - s.ceiling);
  let endTime = Math.min(m.duration, m.time + dt),
    fatal = false;
  if (m.to >= threshold - EPS) {
    let lo = m.time,
      hi = endTime;
    const level = (t) => m.from + (m.to - m.from) * smooth(t / m.duration);
    if (level(endTime) >= threshold - EPS) {
      for (let n = 0; n < 45; n++) {
        const mid = (lo + hi) / 2;
        if (level(mid) >= threshold) hi = mid;
        else lo = mid;
      }
      endTime = hi;
      fatal = true;
    }
  }
  const time = Math.max(0, endTime - m.time);
  advance(s, time, input);
  m.time = endTime;
  s.ceiling = m.from + (m.to - m.from) * smooth(m.time / m.duration);
  s.ceilingVelocity =
    ((m.to - m.from) * ((6 * m.time) / m.duration - 6 * (m.time / m.duration) ** 2)) / m.duration;
  if (fatal) {
    end(s, env, false);
    return time;
  }
  if (m.time >= m.duration - EPS) {
    s.ceiling = m.to;
    s.ceilingMotion = null;
    s.ceilingVelocity = 0;
  }
  if (s.ceiling < initial - EPS) throw new Error('Ceiling motor reversed unexpectedly');
  return time;
}
function tick(s, dt, input, env) {
  progress(s, env);
  if (s.phase !== 'playing') return;
  const busy = isBusy(s),
    pointer = readPointer(input);
  const axis = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  if (axis) {
    s.aimTarget = null;
    s.queuedFire = false;
  }
  // A press that starts on the NEXT bubble only swaps: it never aims or fires until released.
  const swapTapped =
    pointer.clicked && Math.hypot(pointer.x - NEXT_AT.x, pointer.y - NEXT_AT.y) < 22;
  if (swapTapped) s.swapPress = true;
  const aimable = !s.swapPress;
  if (!pointer.down) s.swapPress = false;
  if (pointer.down && pointer.y < 292 && aimable) s.aimTarget = aimAt(pointer);
  if (pointer.clicked && pointer.y < 292 && aimable && !busy) {
    s.aimTarget = aimAt(pointer);
    s.queuedFire = true;
  }
  if ((input.pressed('KeyX') || swapTapped) && !busy) {
    [s.current, s.next] = [s.next, s.current];
    env.sound('move');
  }
  if (
    !busy &&
    (input.pressed('Space', 'Enter') ||
      (s.queuedFire &&
        Math.abs(s.angle - s.aimTarget) < 0.008 &&
        Math.abs(s.angularVelocity) < 0.08))
  )
    shoot(s, env);
  let remaining = dt,
    events = 0;
  const eventBudget = s.shot ? Math.ceil((Math.abs(s.shot.vx) * dt) / (RIGHT - LEFT)) + 10 : 50;
  while (remaining > 1e-10 && s.phase === 'playing' && events++ < eventBudget) {
    if (s.transition > 0) {
      const time = Math.min(remaining, s.transition);
      advance(s, time, input);
      s.transition -= time;
      remaining -= time;
      if (s.transition <= EPS) {
        const saved = { score: s.score, shots: s.shots, time: s.time },
          next = s.level + 1;
        Object.assign(s, createBubbleState(env, next), saved);
      }
      continue;
    }
    if (s.pressureWarning > 0) {
      const time = Math.min(remaining, s.pressureWarning);
      advance(s, time, input);
      s.pressureWarning -= time;
      remaining -= time;
      continue;
    }
    if (s.ceilingMotion) {
      const time = ceilingAdvance(s, remaining, input, env);
      remaining -= time;
      continue;
    }
    if (s.capture) {
      const c = s.capture,
        time = Math.min(remaining, c.duration - c.time);
      advance(s, time, input);
      c.time += time;
      const t = clamp(c.time / c.duration, 0, 1),
        position = capturePosition(c, c.length * smooth(t));
      c.x = position.x;
      c.y = position.y;
      c.speed = (c.length * (6 * t - 6 * t * t)) / c.duration;
      remaining -= time;
      if (c.time >= c.duration - EPS) {
        finishCapture(s, env);
        progress(s, env);
      }
      continue;
    }
    if (s.shot) {
      const b = s.shot;
      if (
        !b.event ||
        Math.abs(b.x - (b.lastX ?? b.x)) > EPS ||
        Math.abs(b.y - (b.lastY ?? b.y)) > EPS ||
        b.vx !== b.lastVx ||
        b.vy !== b.lastVy
      )
        b.event = nextEvent(s, b);
      const time = Math.min(remaining, b.event.time);
      b.x += b.vx * time;
      b.y += b.vy * time;
      b.event.time -= time;
      advance(s, time, input);
      remaining -= time;
      if (b.event.time <= 1e-9) {
        if (b.event.roof || b.event.contacts.length) beginCapture(s, b, b.event, env);
        else {
          b.x = clamp(b.x, LEFT, RIGHT);
          b.vx = -b.vx;
          b.event = null;
          env.sound('move');
        }
      }
      if (s.shot) {
        b.lastX = b.x;
        b.lastY = b.y;
        b.lastVx = b.vx;
        b.lastVy = b.vy;
      }
      continue;
    }
    advance(s, remaining, input);
    remaining = 0;
  }
  progress(s, env);
}
export function stepBubble(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  const count = Math.max(1, Math.ceil(Math.min(dt, 1 / 30) * 240)),
    sub = Math.min(dt, 1 / 30) / count;
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    tick(
      s,
      sub,
      i === 0
        ? input
        : { ...input, pressed: () => false, pointer: { ...readPointer(input), clicked: false } },
      env,
    );
}
