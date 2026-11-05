import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
export const meta = {
  id: 'lantern-climber',
  name: { en: 'Lantern Climber', zh: '提灯攀登' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Light the three summit beacons. Jump between revealed stone ledges; hold Grip at a marked rail and use Up/Down to climb. Grip drains stamina, which recovers only while resting on a ledge. X refills your lamp at a brazier. Falling or an empty lamp costs a life and returns you to a brazier checkpoint.',
    zh: '点亮三座峰顶信标。在提灯照亮的石台间跳跃；靠近标记扶轨时按住抓握，配合上/下攀爬。抓握消耗体力，只有在石台静止休息才能恢复。X可在火盆旁补充灯油。坠落或灯油耗尽会失去一次生命，并返回火盆存档点。',
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
        en: 'Hold Grip at a rail; Up/Down while holding to climb',
        zh: '扶轨旁按住抓握；同时按上/下攀爬',
      },
      keys: 'Z + Up Down / W S',
    },
    { label: { en: 'Relight at a resting brazier', zh: '在火盆旁停稳补油' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Climb ↑ + Grip', '上爬↑＋抓握'],
    ['ArrowDown', 'Climb ↓ + Grip', '下爬↓＋抓握'],
    ['Space', 'Jump', '跳跃'],
    ['KeyZ', 'Hold Grip', '按住抓握'],
    ['KeyX', 'Relight', '补充灯油'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};
const EPS = 1e-8,
  STEP = 1 / 240,
  G = 800,
  JUMP = 324,
  MIN_X = 32,
  MAX_X = 434;
const SECTIONS = [
  {
    en: 'Moonlit Atrium',
    zh: '月光前庭',
    hint: {
      en: 'Run to an edge, then jump across. Rest at the braziers.',
      zh: '靠近边缘起跳，跨向下一石台；可在火盆处休息。',
    },
    sky: '#171d37',
    stone: '#777f9b',
  },
  {
    en: 'Cable Gallery',
    zh: '缆索长廊',
    hint: {
      en: 'Watch the cable decks. Their motion follows your launch.',
      zh: '观察缆索石台；起跳时会保留石台的运动速度。',
    },
    sky: '#1d2541',
    stone: '#7f8aa8',
  },
  {
    en: 'Broken Spire',
    zh: '断裂尖塔',
    hint: {
      en: 'The broken step is too high. Grip the rail, then climb.',
      zh: '断层超过跳跃高度，抓住扶轨再向上攀爬。',
    },
    sky: '#2a2541',
    stone: '#9a89a1',
  },
];
export function createClimbState() {
  const ledges = Array.from({ length: 19 }, (_, id) => {
    const y = 282 - id * 48 - (id >= 14 ? 40 : 0),
      x = id % 2 ? 220 : 70,
      moving = id === 8 || id === 10;
    return {
      id,
      x,
      y,
      w: id > 6 && id % 3 ? 110 : 120,
      h: 8,
      home: x,
      vx: moving ? (id === 8 ? 30 : -30) : 0,
      ax: 0,
      moving,
      shrine: id % 3 === 0,
      beacon: [6, 12, 18].includes(id),
      lit: id === 0,
    };
  });
  return {
    phase: 'playing',
    score: 0,
    lives: 4,
    level: 1,
    time: 0,
    checkpoint: 0,
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
    rails: [
      { id: 0, x: 194, y: -181, h: 126 },
      { id: 1, x: 194, y: -492, h: 178 },
    ],
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
      Math.abs(p.x + p.w / 2 - r.x) <= 11 + EPS &&
      p.y + 7 >= r.y - EPS &&
      p.y + 7 <= r.y + r.h + EPS,
  );
}
function support(s) {
  const p = s.player,
    l = s.ledges[p.ground];
  return l && Math.abs(p.y + p.h - l.y) < 1e-6 && p.x + p.w > l.x + EPS && p.x < l.x + l.w - EPS
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
  s.level = Math.min(3, 1 + Math.floor(l.id / 6));
  if (l.id === 18 && [6, 12, 18].every((n) => s.ledges[n].lit)) {
    s.phase = 'won';
    s.feedback = { type: 'summit', life: 1 };
  }
}
function forces(s, command) {
  const p = s.player,
    l = support(s);
  if (p.grip !== null) {
    p.ax = clamp((command.axis * 45 - p.vx) * 14, -400, 400);
    p.ay = clamp((command.vertical * 56 - p.vy) * 12, -600, 600);
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
      [p.x + p.w / 2, p.vx, p.ax, r.x - 11, r.x + 11],
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
    s.light = Math.max(0, s.light - 1.4 * t);
    if (grip)
      s.stamina = Math.max(
        0,
        s.stamina - (command.vertical < 0 ? 14 : command.vertical > 0 ? 8 : 5) * t,
      );
    else if (rest) s.stamina = Math.min(100, s.stamina + 32 * t);
  }
  s.time += t;
  s.jumpBuffer = Math.max(0, s.jumpBuffer - t);
  s.coyote = Math.max(0, s.coyote - t);
  s.grabCooldown = Math.max(0, s.grabCooldown - t);
  if (s.feedback) s.feedback.life = Math.max(0, s.feedback.life - t);
  s.camera += (Math.min(0, p.y - 180) - s.camera) * Math.min(1, 9 * t);
}
function tick(s, h, command) {
  for (const l of s.ledges) l.ax = l.moving ? -(l.x - l.home) * 1.1 - 0.03 * l.vx : 0;
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
    const fuel = s.light / 1.4;
    if (fuel <= remaining) events.push({ type: 'fuel', time: fuel });
    const drain = p.grip !== null ? (command.vertical < 0 ? 14 : command.vertical > 0 ? 8 : 5) : 0;
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
  const s = createClimbState();
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
      drawClimb(ctx, s, env);
    },
    getState: () => ({
      ...structuredClone(s),
      ledges: s.ledges.map((l) => ({ ...l, revealed: revealed(s, l) })),
      revealRadius: 60 + s.light * 0.7,
      jumpEnvelope: { speed: JUMP, gravity: G, height: (JUMP * JUMP) / (2 * G) },
      resting: resting(s),
      atBrazier: Boolean(support(s)?.shrine),
      canRelight: Boolean(support(s)?.shrine && resting(s)),
      beacons: [6, 12, 18].filter((n) => s.ledges[n].lit).length,
      status: {
        en: `Summit ${s.level}/3 · Grip ${Math.ceil(s.stamina)} · Lamp ${Math.ceil(s.light)} · ${s.player.grip !== null ? 'GRIPPING' : resting(s) ? 'RESTING' : 'CLIMBING'} · ${SECTIONS[s.level - 1].hint.en}`,
        zh: `峰塔${s.level}/3 · 体力${Math.ceil(s.stamina)} · 灯油${Math.ceil(s.light)} · ${s.player.grip !== null ? '抓握中' : resting(s) ? '休息中' : '攀登中'} · ${SECTIONS[s.level - 1].hint.zh}`,
      },
    }),
  };
}
function revealed(s, l) {
  const x = s.player.x + s.player.w / 2,
    y = s.player.y + 10;
  return (
    l.lit ||
    Math.hypot(x - clamp(x, l.x, l.x + l.w), y - clamp(y, l.y, l.y + l.h)) <= 60 + s.light * 0.7
  );
}
function drawClimb(ctx, s, env) {
  const section = SECTIONS[s.level - 1],
    p = s.player;
  background(ctx, section.sky);
  for (let n = 0; n < 48; n++) {
    ctx.fillStyle = n % 4 ? '#3c536a' : '#94a9ae';
    ctx.fillRect((n * 73) % 480, 48 + ((n * 41) % 270), 1, 1);
  }
  for (let y = -40; y < 350; y += 28) {
    const py = y - (s.camera % 28);
    ctx.fillStyle = '#303754';
    ctx.fillRect(16, py, 16, 28);
    ctx.fillRect(448, py, 16, 28);
    ctx.fillStyle = '#68718a';
    ctx.fillRect(18, py + 1, 13, 2);
    ctx.fillRect(450, py + 1, 13, 2);
    ctx.fillStyle = '#202a47';
    ctx.fillRect(16, py + 25, 16, 3);
    ctx.fillRect(448, py + 25, 16, 3);
  }
  for (let n = 0; n < 8; n++) {
    const x = 48 + n * 55,
      y = ((n * 137 - s.camera * 0.3) % 390) - 50;
    ctx.fillStyle = '#293250';
    ctx.fillRect(x, y, 25, 67);
    ctx.fillStyle = '#202944';
    ctx.fillRect(x + 5, y + 4, 15, 48);
    ctx.fillStyle = '#414865';
    ctx.fillRect(x + 3, y - 3, 19, 3);
    ctx.fillRect(x + 7, y - 6, 11, 3);
    ctx.fillRect(x, y + 3, 3, 59);
    ctx.fillRect(x + 22, y + 3, 3, 59);
    ctx.fillStyle = '#303b58';
    ctx.fillRect(x + 4, y + 17, 17, 2);
    ctx.fillRect(x + 11, y + 2, 2, 48);
  }
  for (let n = 0; n < 5; n++) {
    const bx = n % 2 ? 407 : 55,
      by = ((n * 173 - s.camera * 0.6) % 520) - 90;
    ctx.fillStyle = '#5a4962';
    ctx.fillRect(bx, by, 12, 36);
    ctx.fillStyle = '#75627b';
    ctx.fillRect(bx + 2, by + 3, 2, 26);
    ctx.fillStyle = section.sky;
    ctx.fillRect(bx + 1, by + 31, 3, 5);
    ctx.fillRect(bx + 8, by + 34, 3, 4);
    ctx.fillStyle = '#737b68';
    ctx.fillRect(bx - 4, by + 5, 2, 25);
    ctx.fillRect(bx - 8, by + 12, 5, 2);
    ctx.fillRect(bx - 3, by + 23, 5, 2);
  }
  if (s.respawn === 0) {
    const cx = s.player.x + s.player.w / 2,
      cy = s.player.y - s.camera + 10,
      radius = 60 + s.light * 0.7;
    for (const [scale, color] of [
      [1, '#edc48109'],
      [0.76, '#edc4810b'],
      [0.5, '#f0c7810e'],
      [0.24, '#f4d39116'],
    ]) {
      const r = Math.round(radius * scale),
        a = Math.round(r * 0.45),
        b = Math.round(r * 0.75);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy - r);
      ctx.lineTo(cx + a, cy - r);
      ctx.lineTo(cx + a, cy - b);
      ctx.lineTo(cx + b, cy - b);
      ctx.lineTo(cx + b, cy - a);
      ctx.lineTo(cx + r, cy - a);
      ctx.lineTo(cx + r, cy + a);
      ctx.lineTo(cx + b, cy + a);
      ctx.lineTo(cx + b, cy + b);
      ctx.lineTo(cx + a, cy + b);
      ctx.lineTo(cx + a, cy + r);
      ctx.lineTo(cx - a, cy + r);
      ctx.lineTo(cx - a, cy + b);
      ctx.lineTo(cx - b, cy + b);
      ctx.lineTo(cx - b, cy + a);
      ctx.lineTo(cx - r, cy + a);
      ctx.lineTo(cx - r, cy - a);
      ctx.lineTo(cx - b, cy - a);
      ctx.lineTo(cx - b, cy - b);
      ctx.lineTo(cx - a, cy - b);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const r of s.rails) {
    const y = r.y - s.camera;
    ctx.fillStyle = '#827a78';
    ctx.fillRect(r.x - 2, y, 4, r.h);
    for (let h = 0; h < r.h; h += 15) {
      ctx.fillStyle = '#c3b897';
      ctx.fillRect(r.x - 10, y + h, 20, 3);
      ctx.fillStyle = '#5a566a';
      ctx.fillRect(r.x - 8, y + h + 3, 2, 3);
      ctx.fillRect(r.x + 6, y + h + 3, 2, 3);
    }
    text(ctx, '↕', r.x, y - 14, '#d5d6a4', 14, 'center');
  }
  const lamp = { x: p.x + p.w / 2, y: p.y + 10 };
  for (const l of s.ledges) {
    const y = l.y - s.camera;
    if (y < 40 || y > 326) continue;
    const visible = revealed(s, l);
    if (l.moving) {
      ctx.strokeStyle = '#526b76';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.home - 35, y - 12);
      ctx.lineTo(l.home + l.w + 35, y - 12);
      ctx.stroke();
      ctx.fillStyle = '#6f8f91';
      ctx.fillRect(l.x + 5, y - 12, 2, 12);
      ctx.fillRect(l.x + l.w - 7, y - 12, 2, 12);
    }
    ctx.fillStyle = visible ? section.stone : '#373e5d';
    ctx.fillRect(l.x, y, l.w, l.h);
    ctx.fillStyle = visible ? '#b0bbb0' : '#526571';
    ctx.fillRect(l.x, y, l.w, 2);
    ctx.fillStyle = '#41475f';
    ctx.fillRect(l.x + 3, y + 5, l.w - 6, 3);
    for (let x = l.x + 13; x < l.x + l.w; x += 22) {
      ctx.fillStyle = '#4b526c';
      ctx.fillRect(x, y + 3, 2, 4);
    }
    ctx.fillStyle = '#77816c';
    for (let n = 0; n < 5; n++) ctx.fillRect(l.x + 7 + n * 17, y + 2, 5, 2);
    const bx = l.x + l.w / 2;
    if (l.shrine) {
      ctx.fillStyle = '#7d7c70';
      ctx.fillRect(bx - 7, y - 13, 14, 13);
      ctx.fillStyle = '#c4b681';
      ctx.fillRect(bx - 9, y - 14, 18, 3);
      ctx.fillStyle = '#b8cc9c';
      ctx.fillRect(l.x + 3, y - 4, 4, 4);
      if (visible) text(ctx, 'X', bx, y - 30, '#e5d4a7', 12, 'center');
    } else {
      ctx.fillStyle = '#4c646e';
      ctx.fillRect(bx - 3, y - 10, 6, 10);
    }
    if (l.lit || l.shrine) {
      ctx.fillStyle = '#eabf7b';
      ctx.fillRect(bx - 3, y - 20, 6, 7);
      ctx.fillStyle = '#ffdf9b';
      ctx.fillRect(bx - 1, y - 22 - (Math.floor(s.time * 8) % 2), 2, 7);
    }
    if (l.beacon) {
      text(ctx, String(l.id / 6), l.x + l.w - 11, y - 16, '#d8d4b1', 12, 'center');
    }
  }
  if (s.respawn === 0) {
    const py = p.y - s.camera,
      grip = p.grip !== null,
      rows = grip
        ? [
            '..hhhhh',
            '..hsssh',
            '..ss.ss',
            'a.ccc.a',
            'a.ccc.a',
            '..ccc..',
            '..ccc..',
            '..bbb..',
            '..b.b..',
            '..b.b..',
            'kk...kk',
          ]
        : [
            '..hhh..',
            '.hhhhh.',
            '..sss..',
            '..s.s..',
            '..ccc..',
            '.accca.',
            '.acccl.',
            '..bbb..',
            '..b.b..',
            '.kb.bk.',
            'kk...kk',
          ];
    ctx.fillStyle = '#102a3b88';
    ctx.fillRect(p.x - 2, py + p.h - 2, p.w + 4, 3);
    pixelSprite(ctx, rows, Math.round(p.x), Math.round(py), 2, {
      h: '#c0a275',
      s: '#edd3ab',
      a: '#e0c69c',
      c: grip ? '#c3baa2' : '#8399ba',
      b: '#596982',
      k: '#223b4a',
      l: '#efd392',
    });
    ctx.fillStyle = '#e4c882';
    ctx.fillRect(p.x + p.w, py + 10, 4, 7);
    ctx.fillStyle = '#ffdfa0';
    ctx.fillRect(p.x + p.w + 1, py + 11, 2, 4);
    if (grip) {
      ctx.strokeStyle = '#d8deb1';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 2, py - 2, p.w + 4, p.h + 4);
    }
  }
  ctx.fillStyle = '#18223b';
  ctx.fillRect(0, 0, 480, 43);
  text(ctx, `${s.level}/3 ${env.t(section.en, section.zh)}`, 10, 5, '#d7d7b1', 14);
  text(ctx, `${env.t('LIVES', '生命')} ${s.lives}`, 470, 5, '#d6dfc5', 14, 'right');
  for (const [x, value, label, color] of [
    [10, s.stamina, env.t('GRIP', '体力'), '#b7c1d1'],
    [246, s.light, env.t('LAMP', '灯油'), s.light < 20 ? '#edb084' : '#d8c18d'],
  ]) {
    text(ctx, `${label} ${Math.ceil(value)}`, x, 24, color, 14);
    ctx.fillStyle = '#355261';
    ctx.fillRect(x + 92, 28, 112, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x + 92, 28, (112 * value) / 100, 5);
  }
  ctx.fillStyle = '#18223bf0';
  ctx.fillRect(0, 300, 480, 20);
  const status =
    s.respawn > 0
      ? env.t('RECOVERING AT THE LAST BRAZIER', '返回上一座火盆')
      : p.grip !== null
        ? env.t('GRIP · ↑/↓ CLIMB · SPACE JUMP', '抓握中 · 上下攀爬 · SPACE蹬跳')
        : s.light < 20
          ? env.t('LOW LAMP · X AT A BRAZIER', '灯油不足 · 火盆旁按X补油')
          : support(s)?.shrine && resting(s)
            ? env.t('RESTING · X REFILLS THE LAMP', '休息中 · X补充灯油')
            : env.t('SPACE JUMP · HOLD Z AT RAILS', 'SPACE跳跃 · 扶轨旁按住Z抓握');
  text(ctx, status, 240, 303, '#d2d4bf', 14, 'center');
}
