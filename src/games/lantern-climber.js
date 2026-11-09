import { clamp } from '../shared/utils.js';
import {
  LIGHT_DRAIN,
  LEDGE_COUNT,
  BEACONS,
  createLayout,
  stepHint,
} from './lantern-climber-layout.js';
import { drawClimb, revealed } from './lantern-climber-draw.js';
export const meta = {
  id: 'lantern-climber',
  name: { en: 'Lantern Climber', zh: '提灯攀登' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Light the three summit beacons. Jump between revealed stone ledges; four steep steps need a rail: hold Grip beside it and press Up to climb. Climbing drains Grip, which recovers only while resting on a ledge, and the lamp burns faster higher up. X refills it at a brazier. Falling or an empty lamp costs a life. On touch, hold Grip with one thumb and Climb with the other.',
    zh: '点亮三座峰顶信标。在提灯照亮的石台间跳跃；四处陡坎必须靠扶轨：在轨旁按住抓握，再按上攀爬。攀爬消耗体力，只有在石台静止休息才能恢复，越往上灯油耗得越快，X可在火盆旁补油。坠落或灯油耗尽会失去一次生命。触屏时一指按住抓握，另一指按上爬/下爬。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / Left Right' },
    {
      label: {
        en: 'Jump; Space + direction also jumps from Grip',
        zh: '固定高度跳跃；落地后再次轻点',
      },
      keys: 'Space',
    },
    {
      label: {
        en: 'Hold Grip at a rail, then Up/Down to climb (touch: Grip + Climb)',
        zh: '扶轨旁按住抓握，再按上/下攀爬（触屏：抓握＋上爬/下爬）',
      },
      keys: 'Z + Up Down / W S',
    },
    { label: { en: 'Relight at a resting brazier', zh: '在火盆旁停稳补油' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Climb ↑', '上爬↑'],
    ['ArrowDown', 'Climb ↓', '下爬↓'],
    ['Space', 'Jump', '跳跃'],
    ['KeyZ', 'Hold Grip', '按住抓握'],
    ['KeyX', 'Relight', '补充灯油'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};
export const REST_RATE = 8,
  CLIMB_DRAIN = 15;
const EPS = 1e-8,
  STEP = 1 / 240,
  G = 800,
  JUMP = 324,
  MIN_X = 32,
  MAX_X = 434,
  RAIL_REACH = 16,
  CLIMB_SPEED = 48;
export function createClimbState(random = null) {
  const { ledges, rails } = createLayout(random);
  return {
    phase: 'playing',
    score: 0,
    lives: 4,
    level: 1,
    time: 0,
    checkpoint: 0,
    at: 0,
    camera: 0,
    stamina: 100,
    light: 100,
    respawn: 0,
    jumpBuffer: 0,
    coyote: 0,
    edge: null,
    grabCooldown: 0,
    jumpCount: 0,
    relights: 0,
    landings: 0,
    lastCause: '',
    feedback: null,
    lastImpulse: null,
    ledges,
    rails,
    player: {
      x: 120,
      y: 260,
      w: 14,
      h: 22,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      ground: 0,
      grip: null,
      facing: 1,
    },
  };
}
// Stamina per second: climbing up costs the most, hanging still the least.
const gripDrain = (command) => (command.vertical < 0 ? CLIMB_DRAIN : command.vertical > 0 ? 8 : 5);
const lightRate = (s) => LIGHT_DRAIN[s.level - 1];
const motion = (p, v, a, t) => p + v * t + 0.5 * a * t * t;
function roots(p, v, a, target, dt) {
  const c = p - target;
  if (Math.abs(a) < EPS) {
    if (Math.abs(v) < EPS) return [];
    const t = -c / v;
    return t >= -EPS && t <= dt + EPS ? [clamp(t, 0, dt)] : [];
  }
  const d = v * v - 2 * a * c;
  if (d < -EPS) return [];
  const r = Math.sqrt(Math.max(0, d));
  return [(-v - r) / a, (-v + r) / a]
    .filter((t) => t >= -EPS && t <= dt + EPS)
    .map((t) => clamp(t, 0, dt));
}
function approach(pos, size, lo, hi, v, a) {
  if (pos + size <= lo + EPS) return v > EPS || (Math.abs(v) <= EPS && a > EPS);
  if (pos >= hi - EPS) return v < -EPS || (Math.abs(v) <= EPS && a < -EPS);
  return true;
}
function swept(p, l, dt) {
  const vx = p.vx - l.vx,
    ax = p.ax - l.ax,
    vy = p.vy,
    ay = p.ay;
  const times = [
    0,
    dt,
    ...roots(p.x, vx, ax, l.x - p.w, dt),
    ...roots(p.x, vx, ax, l.x + l.w, dt),
    ...roots(p.y, vy, ay, l.y - p.h, dt),
    ...roots(p.y, vy, ay, l.y + l.h, dt),
  ].sort((a, b) => a - b);
  for (const t of times) {
    const x = motion(p.x, vx, ax, t),
      y = motion(p.y, vy, ay, t);
    if (x + p.w < l.x - EPS || x > l.x + l.w + EPS || y + p.h < l.y - EPS || y > l.y + l.h + EPS)
      continue;
    if (
      !approach(x, p.w, l.x, l.x + l.w, vx + ax * t, ax) ||
      !approach(y, p.h, l.y, l.y + l.h, vy + ay * t, ay)
    )
      continue;
    const normals = [];
    if (
      Math.abs(y + p.h - l.y) < 1e-6 &&
      (vy + ay * t > EPS || (Math.abs(vy + ay * t) <= EPS && ay > EPS))
    )
      normals.push({ x: 0, y: -1 });
    if (Math.abs(y - l.y - l.h) < 1e-6 && vy + ay * t < -EPS) normals.push({ x: 0, y: 1 });
    if (
      Math.abs(x + p.w - l.x) < 1e-6 &&
      (vx + ax * t > EPS || (Math.abs(vx + ax * t) <= EPS && ax > EPS))
    )
      normals.push({ x: -1, y: 0 });
    if (
      Math.abs(x - l.x - l.w) < 1e-6 &&
      (vx + ax * t < -EPS || (Math.abs(vx + ax * t) <= EPS && ax < -EPS))
    )
      normals.push({ x: 1, y: 0 });
    if (normals.length) return { time: t, normals, ledge: l };
  }
  return null;
}
function wallTime(p, dt) {
  let best = null;
  for (const [bound, sign] of [
    [MIN_X, -1],
    [MAX_X, 1],
  ])
    for (const t of roots(p.x, p.vx, p.ax, bound, dt)) {
      if ((p.vx + p.ax * t) * sign > EPS || (Math.abs(p.vx + p.ax * t) <= EPS && p.ax * sign > EPS))
        if (!best || t < best.time) best = { time: t, sign };
    }
  return best;
}
function railContact(s) {
  const p = s.player;
  return s.rails.find(
    (r) =>
      Math.abs(p.x + p.w / 2 - r.x) <= RAIL_REACH + EPS &&
      p.y + 7 >= r.y - EPS &&
      p.y + 7 <= r.y + r.h + EPS,
  );
}
function support(s) {
  const p = s.player,
    l = s.ledges[p.ground];
  return l && Math.abs(p.y + p.h - l.y) < 1e-6 && p.x + p.w > l.x - EPS && p.x < l.x + l.w + EPS
    ? l
    : null;
}
function resting(s) {
  const l = support(s);
  return Boolean(
    l && s.player.grip === null && Math.abs(s.player.vx - l.vx) < 12 && Math.abs(s.player.vy) < EPS,
  );
}
function impulse(s, source, vx, vy) {
  const p = s.player,
    before = 0.5 * (p.vx * p.vx + p.vy * p.vy),
    ix = vx - p.vx,
    iy = vy - p.vy;
  p.vx = vx;
  p.vy = vy;
  s.lastImpulse = {
    source,
    x: ix,
    y: iy,
    reaction: { x: -ix, y: -iy },
    work: 0.5 * (vx * vx + vy * vy) - before,
  };
}
function lose(s, cause) {
  if (s.respawn > 0 || s.phase !== 'playing') return;
  s.lives--;
  s.lastCause = cause;
  s.feedback = { type: cause, life: 0.7 };
  s.jumpBuffer = 0;
  s.coyote = 0;
  s.edge = null;
  s.player.grip = null;
  s.player.ground = null;
  if (s.lives <= 0) s.phase = 'lost';
  else s.respawn = 0.6;
}
function reset(s) {
  const l = s.ledges[s.checkpoint],
    p = s.player;
  Object.assign(p, {
    x: l.x + l.w / 2 - p.w / 2,
    y: l.y - p.h,
    vx: l.vx,
    vy: 0,
    ax: 0,
    ay: 0,
    ground: l.id,
    grip: null,
  });
  s.stamina = 100;
  s.light = 100;
  s.grabCooldown = 0.12;
  s.jumpBuffer = 0;
  s.coyote = 0.09;
  s.edge = l.id;
  s.at = l.id;
}
function land(s, l) {
  const p = s.player;
  impulse(s, 'landing', l.vx, 0);
  p.y = l.y - p.h;
  p.ground = l.id;
  p.grip = null;
  s.landings++;
  s.coyote = 0.09;
  s.edge = l.id;
  if (!l.lit) {
    l.lit = true;
    s.score += 100;
    s.feedback = { type: 'lantern', life: 0.4 };
  }
  if (l.shrine && l.id > s.checkpoint) s.checkpoint = l.id;
  s.at = l.id;
  s.level = Math.min(3, 1 + Math.floor(l.id / 6));
  if (l.id === LEDGE_COUNT - 1 && BEACONS.every((n) => s.ledges[n].lit)) {
    s.phase = 'won';
    s.feedback = { type: 'summit', life: 1 };
  }
}
function forces(s, command) {
  const p = s.player,
    l = support(s);
  if (p.grip !== null) {
    p.ax = clamp((command.axis * 45 - p.vx) * 14, -400, 400);
    p.ay = clamp((command.vertical * CLIMB_SPEED - p.vy) * 12, -600, 600);
  } else {
    const target = (l?.vx ?? 0) + command.axis * 150,
      gain = l ? 16 : 5;
    p.ax = (l?.ax ?? 0) + clamp((target - p.vx) * gain, -(l ? 950 : 520), l ? 950 : 520);
    p.ay = l ? 0 : G;
  }
  if (
    (p.x <= MIN_X + EPS && p.vx <= EPS && p.ax < 0) ||
    (p.x >= MAX_X - EPS && p.vx >= -EPS && p.ax > 0)
  )
    p.ax = 0;
}
function reachableEdge(s) {
  const p = s.player,
    l = s.ledges[s.edge];
  return (
    s.coyote > 0 &&
    l &&
    p.x + p.w >= l.x - 5 &&
    p.x <= l.x + l.w + 5 &&
    p.y + p.h >= l.y - 1 &&
    p.y + p.h <= l.y + 5
  );
}
function jump(s, command) {
  const p = s.player;
  if (s.jumpBuffer <= 0 || !(support(s) || p.grip !== null || reachableEdge(s))) return false;
  if (p.grip !== null && s.stamina < 12) return false;
  const fromGrip = p.grip !== null;
  if (fromGrip) s.stamina -= 12;
  impulse(s, 'jump', fromGrip ? p.vx + command.axis * 125 : p.vx, -JUMP);
  p.ground = null;
  p.grip = null;
  s.jumpBuffer = 0;
  s.coyote = 0;
  s.edge = null;
  s.grabCooldown = 0.16;
  s.jumpCount++;
  return true;
}
function constraints(s, command) {
  const p = s.player;
  let changed = false;
  if (p.ground !== null && !support(s)) {
    s.edge = p.ground;
    s.coyote = 0.09;
    p.ground = null;
    changed = true;
  }
  if (p.grip !== null && (!command.grip || !railContact(s) || s.stamina <= EPS)) {
    p.grip = null;
    s.grabCooldown = 0.08;
    changed = true;
  }
  if (
    command.grip &&
    p.grip === null &&
    s.grabCooldown <= EPS &&
    s.stamina >= 8 &&
    Math.abs(p.vy) <= 260
  ) {
    const r = railContact(s);
    if (r && (!support(s) || command.vertical)) {
      p.ground = null;
      p.grip = r.id;
      impulse(s, 'grip', 0, 0);
      changed = true;
    }
  }
  if (jump(s, command)) changed = true;
  return changed;
}
function exitTime(s, dt) {
  const p = s.player;
  let best = null;
  if (p.ground !== null) {
    const l = support(s);
    if (l)
      for (const [bound, sign] of [
        [l.x - p.w, -1],
        [l.x + l.w, 1],
      ])
        for (const t of roots(p.x, p.vx - l.vx, p.ax - l.ax, bound, dt))
          if ((p.vx - l.vx + (p.ax - l.ax) * t) * sign > EPS)
            if (best === null || t < best) best = t;
  }
  if (p.grip !== null) {
    const r = s.rails[p.grip];
    for (const [pos, v, a, lo, hi] of [
      [p.x + p.w / 2, p.vx, p.ax, r.x - RAIL_REACH, r.x + RAIL_REACH],
      [p.y + 7, p.vy, p.ay, r.y, r.y + r.h],
    ])
      for (const [bound, sign] of [
        [lo, -1],
        [hi, 1],
      ])
        for (const t of roots(pos, v, a, bound, dt))
          if ((v + a * t) * sign > EPS) if (best === null || t < best) best = t;
  }
  return best;
}
function advance(s, t, command) {
  const p = s.player,
    rest = resting(s),
    grip = p.grip !== null;
  for (const l of s.ledges) {
    l.x = motion(l.x, l.vx, l.ax, t);
    l.vx += l.ax * t;
  }
  if (s.respawn === 0) {
    p.x = motion(p.x, p.vx, p.ax, t);
    p.y = motion(p.y, p.vy, p.ay, t);
    p.vx += p.ax * t;
    p.vy += p.ay * t;
    s.light = Math.max(0, s.light - lightRate(s) * t);
    if (grip) s.stamina = Math.max(0, s.stamina - gripDrain(command) * t);
    else if (rest) s.stamina = Math.min(100, s.stamina + REST_RATE * t);
  }
  s.time += t;
  s.jumpBuffer = Math.max(0, s.jumpBuffer - t);
  s.coyote = Math.max(0, s.coyote - t);
  s.grabCooldown = Math.max(0, s.grabCooldown - t);
  if (s.feedback) s.feedback.life = Math.max(0, s.feedback.life - t);
  s.camera += (Math.min(0, p.y - 180) - s.camera) * Math.min(1, 9 * t);
}
function tick(s, h, command) {
  for (const l of s.ledges) l.ax = l.moving ? -(l.x - l.home) * l.k : 0;
  constraints(s, command);
  forces(s, command);
  let remaining = h;
  while (remaining > EPS && s.phase === 'playing') {
    if (s.respawn > 0) {
      const t = Math.min(remaining, s.respawn);
      advance(s, t, command);
      s.respawn = Math.max(0, s.respawn - t);
      remaining -= t;
      if (s.respawn <= EPS) {
        s.respawn = 0;
        reset(s);
        forces(s, command);
      }
      continue;
    }
    const p = s.player,
      events = [];
    for (const l of s.ledges) {
      const hit = swept(p, l, remaining);
      if (hit) events.push({ type: 'solid', ...hit });
    }
    const wall = wallTime(p, remaining);
    if (wall) events.push({ type: 'wall', ...wall });
    const exit = exitTime(s, remaining);
    if (exit !== null) events.push({ type: 'exit', time: exit });
    const fall = s.ledges[s.checkpoint].y + 180;
    for (const t of roots(p.y, p.vy, p.ay, fall, remaining))
      if (p.vy + p.ay * t > 0) events.push({ type: 'fall', time: t });
    const fuel = s.light / lightRate(s);
    if (fuel <= remaining) events.push({ type: 'fuel', time: fuel });
    const drain = p.grip !== null ? gripDrain(command) : 0;
    if (drain && s.stamina / drain <= remaining)
      events.push({ type: 'fatigue', time: s.stamina / drain });
    const time = Math.max(0, Math.min(remaining, ...events.map((e) => e.time)));
    advance(s, time, command);
    remaining -= time;
    const group = events.filter((e) => Math.abs(e.time - time) < 1e-7);
    if (group.some((e) => e.type === 'fall' || e.type === 'fuel')) {
      lose(s, group.some((e) => e.type === 'fuel') ? 'light' : 'fall');
      continue;
    }
    let dirty = false;
    for (const e of group) {
      if (e.type === 'wall') {
        impulse(s, 'wall', 0, p.vy);
        p.x = clamp(p.x, MIN_X, MAX_X);
        p.ax = 0;
      } else if (e.type === 'solid') {
        for (const n of e.normals) {
          if (n.y === -1) {
            land(s, e.ledge);
            dirty = true;
          } else if (n.y === 1) {
            impulse(s, 'ceiling', p.vx, 0);
            if (p.ay < 0) p.ay = 0;
          } else {
            impulse(s, 'side', e.ledge.vx, p.vy);
            p.ax = e.ledge.ax;
          }
        }
      } else if (e.type === 'exit' || e.type === 'fatigue') {
        if (e.type === 'exit' && p.ground !== null) {
          s.edge = p.ground;
          s.coyote = 0.09;
        }
        p.ground = null;
        p.grip = null;
        s.grabCooldown = 0.08;
        dirty = true;
      }
    }
    if (constraints(s, command)) dirty = true;
    if (dirty) forces(s, command);
  }
}
export function stepClimb(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  const command = {
    axis: Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    vertical: Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW')),
    grip: input.held('KeyZ'),
  };
  if (input.pressed('Space')) s.jumpBuffer = 0.14;
  if (input.pressed('KeyX') && s.respawn === 0) {
    const l = support(s);
    if (l?.shrine && resting(s)) {
      s.light = 100;
      s.relights++;
      s.feedback = { type: 'relight', life: 0.5 };
    }
  }
  if (command.axis) s.player.facing = command.axis;
  let remaining = Math.min(dt, 1 / 30);
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(STEP, remaining);
    tick(s, h, command);
    remaining -= h;
  }
}
export function createGame(env) {
  const s = createClimbState(env.random);
  let ended = false;
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      const lives = s.lives,
        score = s.score,
        jumps = s.jumpCount,
        relights = s.relights;
      stepClimb(s, dt, input);
      if (s.lives < lives) env.sound('hit');
      else if (s.score > score || s.relights > relights) env.sound('coin');
      else if (s.jumpCount > jumps) env.sound('move');
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.sound(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t('Three summit beacons shine through the night!', '三座峰顶信标照亮了夜空！')
            : env.t(
                'The watch is over. Rest for grip and refill at braziers.',
                '守灯之旅结束；停稳恢复体力，并在火盆补充灯油。',
              ),
        });
      }
    },
    draw(ctx) {
      drawClimb(ctx, s, env, { ledge: support(s), rest: resting(s) });
    },
    getState: () => ({
      ...structuredClone(s),
      ledges: s.ledges.map((l) => ({ ...l, revealed: revealed(s, l) })),
      revealRadius: 60 + s.light * 0.7,
      jumpEnvelope: { speed: JUMP, gravity: G, height: (JUMP * JUMP) / (2 * G) },
      resting: resting(s),
      atBrazier: Boolean(support(s)?.shrine),
      canRelight: Boolean(support(s)?.shrine && resting(s)),
      beacons: BEACONS.filter((n) => s.ledges[n].lit).length,
      status: {
        en: `Summit ${s.level}/3 · Grip ${Math.ceil(s.stamina)} · Lamp ${Math.ceil(s.light)} · ${s.player.grip !== null ? 'GRIPPING' : resting(s) ? 'RESTING' : 'CLIMBING'} · ${stepHint(s).en}`,
        zh: `峰塔${s.level}/3 · 体力${Math.ceil(s.stamina)} · 灯油${Math.ceil(s.light)} · ${s.player.grip !== null ? '抓握中' : resting(s) ? '休息中' : '攀登中'} · ${stepHint(s).zh}`,
      },
    }),
  };
}
