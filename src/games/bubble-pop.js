import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'bubble-pop',
  name: { en: 'Bubble Pop', zh: '泡泡消消乐' },
  description: {
    en: 'Clear three air-table caverns. Match three symbols to open drain sockets; cut anchored links to clear groups. Bank off rails, swap the next capsule, and watch the moving pusher. The guide shows the reachable socket.',
    zh: '挑战三座气垫洞穴。连接三个同符号泡泡开启排放槽，切断锚定连接可清除整组。利用导轨反弹、交换下个泡泡，并留意移动推板。瞄准线显示可达卡槽。',
  },
  genre: 'puzzle',
  players: '1',
  touch: true,
  keys: [
    {
      label: { en: 'Aim', zh: '瞄准' },
      keys: { en: 'A / D · Left / Right · Drag to aim', zh: 'A / D · 左右方向键 · 拖动瞄准' },
    },
    {
      label: { en: 'Shoot', zh: '发射' },
      keys: {
        en: 'Space / Enter · Click target to aim and shoot',
        zh: '空格 / 回车 · 点击目标后瞄准发射',
      },
    },
    { label: { en: 'Swap next bubble', zh: '交换下一个泡泡' }, keys: 'X' },
  ],
};
const R = 12,
  COLS = 12,
  ROWS = 12,
  ROW_H = Math.sqrt(3) * 12,
  LEFT = 108,
  RIGHT = 372,
  ROOF = 48,
  LIMIT = 270,
  SHOT_Y = 297;
const TAU = Math.PI * 2,
  EPS = 1e-6;
const colors = ['#e89581', '#e6c66d', '#76bfa8', '#79a8c9'];
const CAVERNS = [
  {
    en: 'Pearl Pairs',
    zh: '贝珠配对',
    misses: 5,
    rows: ['001122001122', '00112200112', '001122001122', '.00.11.22..'],
  },
  {
    en: 'Basalt Gates',
    zh: '玄岩拱门',
    misses: 4,
    rows: [
      '001122330011',
      '01122330011',
      '.0011223300.',
      '00.#..0#.11',
      '0112..003321',
      '.11....33..',
    ],
  },
  {
    en: 'Hanging Keys',
    zh: '悬挂之钥',
    misses: 4,
    rows: [
      '001122330011',
      '...2...3...',
      '#.222.333..#',
      '.0011.2233.',
      '.0011.2233..',
      '..01..23...',
    ],
  },
];
const slots = (r) => (r % 2 ? 11 : 12);
const wrapAngle = (a) => ((a % TAU) + TAU) % TAU;
export function neighbors(r, c) {
  const shift = r % 2 ? 1 : -1;
  return [
    [r, c - 1],
    [r, c + 1],
    [r - 1, c],
    [r - 1, c + shift],
    [r + 1, c],
    [r + 1, c + shift],
  ].filter(([y, x]) => y >= 0 && y < ROWS && x >= 0 && x < slots(y));
}
export const bubblePoint = (r, c, ceiling = 0) => ({
  x: 108 + c * 24 + (r % 2) * 12,
  y: ROOF + r * ROW_H + ceiling,
});
const point = bubblePoint;
function palette(s) {
  return [...new Set(s.board.flat().filter((v) => v >= 0))].sort((a, b) => a - b);
}
function nextColor(s, env) {
  const available = palette(s);
  if (!available.length) return 0;
  while (s.colorBag.length) {
    const color = s.colorBag.shift();
    if (available.includes(color)) return color;
  }
  s.colorBag = [...available];
  for (let i = s.colorBag.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(env.random() * (i + 1)));
    [s.colorBag[i], s.colorBag[j]] = [s.colorBag[j], s.colorBag[i]];
  }
  return s.colorBag.shift();
}
export function createBubbleState(env, level = 1) {
  const spec = CAVERNS[level - 1],
    rotation = Math.floor(env.random() * 4),
    obstacles = [];
  const board = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => {
      const code = c < slots(r) ? spec.rows[r]?.[c] : '.';
      if (code === '#') obstacles.push({ row: r, col: c });
      return code !== undefined && code !== '.' && code !== '#'
        ? (Number(code) + rotation) % 4
        : -1;
    }),
  );
  const s = {
    phase: 'playing',
    level,
    totalLevels: 3,
    transition: 0,
    score: 0,
    board,
    obstacles,
    angle: -Math.PI / 2,
    angularVelocity: 0,
    aimTarget: null,
    queuedFire: false,
    shot: null,
    capture: null,
    current: 0,
    next: 0,
    colorBag: [],
    ceiling: 0,
    ceilingMotion: null,
    pressureWarning: 0,
    misses: 0,
    maxMisses: spec.misses,
    shots: 0,
    stageShots: 0,
    popped: [],
    time: 0,
    combo: 0,
    message: '',
    messageTime: 0,
  };
  s.current = nextColor(s, env);
  s.next = nextColor(s, env);
  return s;
}
function solidCells(s) {
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0)
        cells.push({ ...point(r, c, s.ceiling), row: r, col: c, kind: 'bubble' });
  for (const p of s.obstacles)
    cells.push({ ...point(p.row, p.col, s.ceiling), row: p.row, col: p.col, kind: 'peg' });
  return cells;
}
function blockedSocket(s, r, c) {
  return (
    !s.board[r] ||
    c < 0 ||
    c >= slots(r) ||
    s.board[r][c] >= 0 ||
    s.obstacles.some((o) => o.row === r && o.col === c)
  );
}
export function resolveBubble(s, row, col, color, env) {
  if (blockedSocket(s, row, col) || !Number.isInteger(color) || color < 0 || color > 3)
    throw new Error('Invalid or occupied bubble cell');
  s.board[row][col] = color;
  const cluster = [[row, col]],
    seen = new Set([`${row},${col}`]);
  for (let at = 0; at < cluster.length; at++)
    for (const [r, c] of neighbors(...cluster[at]))
      if (s.board[r][c] === color && !seen.has(`${r},${c}`)) {
        seen.add(`${r},${c}`);
        cluster.push([r, c]);
      }
  let removed = 0;
  const drain = (r, c, kind) => {
    s.popped.push({
      ...point(r, c, s.ceiling),
      color: s.board[r][c],
      z: 0,
      vz: 0,
      life: 0.75,
      kind,
    });
    s.board[r][c] = -1;
    removed++;
  };
  if (cluster.length >= 3) {
    for (const [r, c] of cluster) drain(r, c, 'match');
    const anchored = new Set(),
      queue = [];
    const anchor = (r, c) => {
      if (s.board[r]?.[c] >= 0 && !anchored.has(`${r},${c}`)) {
        anchored.add(`${r},${c}`);
        queue.push([r, c]);
      }
    };
    for (let c = 0; c < COLS; c++) anchor(0, c);
    for (const o of s.obstacles) for (const [r, c] of neighbors(o.row, o.col)) anchor(r, c);
    for (let at = 0; at < queue.length; at++)
      for (const [r, c] of neighbors(...queue[at])) anchor(r, c);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < slots(r); c++)
        if (s.board[r][c] >= 0 && !anchored.has(`${r},${c}`)) drain(r, c, 'detach');
    s.combo = removed;
    s.score += cluster.length * 20 + (removed - cluster.length) * 35;
    env.sound('coin');
  } else {
    s.combo = 0;
    env.sound('move');
  }
  return removed;
}
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
          'Three air-table caverns drained. Every valve is clear!',
          '三座气垫洞穴已排空，所有阀门都已清除！',
        )
      : env.t(
          'The locked rack crossed the safety line. Open a matching route sooner.',
          '固定泡泡架越过了安全线，请更早打通同色路线。',
        ),
  });
}
function segmentClear(a, b, objects, s) {
  if (
    Math.min(a.x, b.x) < LEFT - EPS ||
    Math.max(a.x, b.x) > RIGHT + EPS ||
    Math.min(a.y, b.y) < ROOF + s.ceiling - EPS
  )
    return false;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  for (const o of objects) {
    const t = length ? clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / length, 0, 1) : 0;
    if (Math.hypot(a.x + dx * t - o.x, a.y + dy * t - o.y) < R * 2 - EPS) return false;
  }
  return true;
}
function onArc(angle, from, span) {
  return (span >= 0 ? wrapAngle(angle - from) : wrapAngle(from - angle)) <= Math.abs(span) + 1e-7;
}
function arcClear(arc, objects, s) {
  const angles = [arc.from, arc.from + arc.span];
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
    if (onArc(a, arc.from, arc.span)) angles.push(a);
  const samples = angles.map((a) => ({
    x: arc.cx + 24 * Math.cos(a),
    y: arc.cy + 24 * Math.sin(a),
  }));
  if (samples.some((p) => p.x < LEFT - EPS || p.x > RIGHT + EPS || p.y < ROOF + s.ceiling - EPS))
    return false;
  for (const o of objects) {
    if (Math.hypot(o.x - arc.cx, o.y - arc.cy) < EPS) continue;
    const angle = Math.atan2(o.y - arc.cy, o.x - arc.cx);
    let distance = Math.min(
      ...[arc.from, arc.from + arc.span].map((a) =>
        Math.hypot(arc.cx + 24 * Math.cos(a) - o.x, arc.cy + 24 * Math.sin(a) - o.y),
      ),
    );
    if (onArc(angle, arc.from, arc.span))
      distance = Math.min(distance, Math.abs(Math.hypot(o.x - arc.cx, o.y - arc.cy) - 24));
    if (distance < 24 - EPS) return false;
  }
  return true;
}
function capturePlan(s, b, event, objects = solidCells(s)) {
  const candidateMap = new Map();
  const add = (r, c) => {
    if (!blockedSocket(s, r, c)) candidateMap.set(`${r},${c}`, [r, c]);
  };
  if (event.roof) for (let c = 0; c < COLS; c++) add(0, c);
  for (const contact of event.contacts)
    for (const [r, c] of neighbors(contact.row, contact.col)) add(r, c);
  const plans = [];
  for (const [row, col] of candidateMap.values()) {
    const target = point(row, col, s.ceiling),
      direct = Math.hypot(target.x - b.x, target.y - b.y);
    if (segmentClear(b, target, objects, s))
      plans.push({
        row,
        col,
        target,
        segments: [{ kind: 'line', from: { x: b.x, y: b.y }, to: target, length: direct }],
        length: direct,
      });
    for (const contact of event.contacts) {
      if (Math.abs(Math.hypot(target.x - contact.x, target.y - contact.y) - 24) > EPS) continue;
      const from = Math.atan2(b.y - contact.y, b.x - contact.x),
        to = Math.atan2(target.y - contact.y, target.x - contact.x),
        short = ((to - from + Math.PI * 3) % TAU) - Math.PI;
      for (const span of [short, short >= 0 ? short - TAU : short + TAU]) {
        if (Math.abs(span) > Math.PI * 1.99) continue;
        const arc = {
          kind: 'arc',
          cx: contact.x,
          cy: contact.y,
          radius: 24,
          from,
          span,
          length: Math.abs(span) * 24,
        };
        if (arcClear(arc, objects, s))
          plans.push({ row, col, target, segments: [arc], length: arc.length });
      }
    }
  }
  plans.sort(
    (a, bp) =>
      a.length - bp.length ||
      Math.abs(a.target.x - b.x - b.vx * 0.01) - Math.abs(bp.target.x - b.x - b.vx * 0.01) ||
      a.row - bp.row ||
      a.col - bp.col,
  );
  return plans[0] || null;
}
function nextEvent(s, b) {
  let time = Infinity,
    wall = false,
    roof = false,
    contacts = [];
  const add = (t, kind, object = null) => {
    if (!Number.isFinite(t) || t < -1e-8) return;
    t = Math.max(0, t);
    if (t < time - 1e-8) {
      time = t;
      wall = false;
      roof = false;
      contacts = [];
    }
    if (Math.abs(t - time) <= 1e-8) {
      if (kind === 'wall') wall = true;
      else if (kind === 'roof') roof = true;
      else contacts.push(object);
    }
  };
  if (b.vx < 0) add((LEFT - b.x) / b.vx, 'wall');
  else if (b.vx > 0) add((RIGHT - b.x) / b.vx, 'wall');
  if (b.vy < 0) add((ROOF + s.ceiling - b.y) / b.vy, 'roof');
  const speed = b.vx * b.vx + b.vy * b.vy,
    objects = solidCells(s);
  for (const o of objects) {
    const dx = b.x - o.x,
      dy = b.y - o.y,
      dot = dx * b.vx + dy * b.vy,
      c = dx * dx + dy * dy - 24 * 24;
    if (speed < 1e-12 || dot >= -1e-9) continue;
    const discriminant = dot * dot - speed * c;
    if (discriminant >= 0) add((-dot - Math.sqrt(discriminant)) / speed, 'bubble', o);
  }
  return { time, wall, roof, contacts, objects };
}
function trace(s, angle) {
  const b = { x: 240, y: SHOT_Y, vx: Math.cos(angle) * 350, vy: Math.sin(angle) * 350 },
    segments = [];
  for (let n = 0; n < 20; n++) {
    const event = nextEvent(s, b);
    if (!Number.isFinite(event.time)) return { segments, plan: null };
    const from = { x: b.x, y: b.y };
    b.x += b.vx * event.time;
    b.y += b.vy * event.time;
    segments.push({ from, to: { x: b.x, y: b.y } });
    if (event.roof || event.contacts.length)
      return {
        segments,
        plan: capturePlan(s, b, event, event.objects),
        contact: { x: b.x, y: b.y },
        event,
      };
    b.x = clamp(b.x, LEFT, RIGHT);
    b.vx = -b.vx;
  }
  return { segments, plan: null };
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
function drainBusy(s) {
  return s.popped.some((p) => p.z < 24 + EPS);
}
function deepest(s) {
  let y = -Infinity;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0) y = Math.max(y, point(r, c, s.ceiling).y + R);
  for (const o of s.obstacles) y = Math.max(y, point(o.row, o.col, s.ceiling).y + R);
  return y;
}
function progress(s, env) {
  if (deepest(s) >= LIMIT - EPS) {
    end(s, env, false);
    return;
  }
  if (!palette(s).length && !s.capture && !s.shot && s.transition <= 0 && s.popped.length === 0) {
    s.score += Math.max(0, 60 - s.stageShots) * 10;
    if (s.level === s.totalLevels) end(s, env, true);
    else {
      s.transition = 1.2;
      s.pressureWarning = 0;
      s.ceilingMotion = null;
      s.queuedFire = false;
      env.sound('win');
    }
  }
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
  s.angle = clamp(s.angle + omega * dt + (acceleration * dt * dt) / 2, -2.88, -0.26);
  if (s.angle === -2.88 || s.angle === -0.26) s.angularVelocity = 0;
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
  const busy = !!(
    s.shot ||
    s.capture ||
    s.ceilingMotion ||
    s.transition > 0 ||
    drainBusy(s) ||
    !palette(s).length
  );
  const axis = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  if (axis) {
    s.aimTarget = null;
    s.queuedFire = false;
  }
  if (input.pointer.down && input.pointer.y < 292)
    s.aimTarget = clamp(Math.atan2(input.pointer.y - SHOT_Y, input.pointer.x - 240), -2.88, -0.26);
  if (input.pointer.clicked && input.pointer.y < 292 && !busy) {
    s.aimTarget = clamp(Math.atan2(input.pointer.y - SHOT_Y, input.pointer.x - 240), -2.88, -0.26);
    s.queuedFire = true;
  }
  if (input.pressed('KeyX') && !busy) {
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
        : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      env,
    );
}
function bubble(ctx, x, y, color, r = R, outline = true) {
  const shade = [
    ['#b76061', '#e89581', '#f3bea3'],
    ['#b89748', '#e6c66d', '#f2e0a0'],
    ['#458d85', '#76bfa8', '#b3dbbd'],
    ['#527b9d', '#79a8c9', '#bdd3db'],
  ][color] || ['#667c83', '#a1b5b6', '#e2e8da'];
  const unit = r >= 9 ? 2 : 1;
  for (let py = -r; py < r; py += unit)
    for (let px = -r; px < r; px += unit) {
      if ((px + unit / 2) ** 2 + (py + unit / 2) ** 2 > (r - 0.5) ** 2) continue;
      ctx.fillStyle = px + py > r * 0.35 ? shade[0] : px + py < -r * 0.45 ? shade[2] : shade[1];
      ctx.fillRect(Math.round(x + px), Math.round(y + py), unit, unit);
    }
  if (outline) {
    ctx.strokeStyle = '#0c2430';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, TAU);
    ctx.stroke();
  }
  if (r >= 6) {
    ctx.fillStyle = '#fcf0cc';
    ctx.fillRect(x - r * 0.45, y - r * 0.5, Math.max(2, r * 0.35), 2);
    ctx.fillStyle = '#274b59';
    const u = r >= 10 ? 2 : 1;
    if (color === 0) ctx.fillRect(x - (3 * u) / 2, y - u / 2, 3 * u, u);
    if (color === 1) {
      ctx.fillRect(x - u / 2, y - (3 * u) / 2, u, 3 * u);
      ctx.fillRect(x - (3 * u) / 2, y - u / 2, 3 * u, u);
    }
    if (color === 2) {
      ctx.fillRect(x - 2 * u, y - 2 * u, u, 4 * u);
      ctx.fillRect(x + u, y - 2 * u, u, 4 * u);
    }
    if (color === 3) {
      ctx.fillRect(x - u, y - 2 * u, 2 * u, u);
      ctx.fillRect(x - 2 * u, y - u, u, 2 * u);
      ctx.fillRect(x + u, y - u, u, 2 * u);
      ctx.fillRect(x - u, y + u, 2 * u, u);
    }
  }
}
function dotted(ctx, from, to, color = '#759c9c', spacing = 10) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  for (let d = 5; d < length; d += spacing) {
    ctx.fillStyle = color;
    ctx.fillRect(from.x + (dx * d) / length - 1, from.y + (dy * d) / length - 1, 2, 2);
  }
}
function guidePath(ctx, segments, color) {
  for (const p of segments) {
    if (p.kind === 'arc') {
      const n = Math.max(2, Math.ceil(p.length / 6));
      for (let j = 0; j <= n; j++) {
        const a = p.from + (p.span * j) / n;
        ctx.fillStyle = color;
        ctx.fillRect(p.cx + 24 * Math.cos(a) - 1, p.cy + 24 * Math.sin(a) - 1, 2, 2);
      }
    } else dotted(ctx, p.from, p.to, color, 6);
  }
}
function drawBubble(ctx, s, env) {
  const materials = [
    { back: '#192d39', rock: '#31424a', edge: '#738d89', floor: '#254650', light: '#9fc7b8' },
    { back: '#1a2631', rock: '#303747', edge: '#6f8293', floor: '#263e50', light: '#aac0d0' },
    { back: '#203234', rock: '#364d44', edge: '#8b9874', floor: '#2b4947', light: '#c0cd9b' },
  ][s.level - 1];
  background(ctx, materials.back);
  for (let side = 0; side < 2; side++)
    for (let row = 0; row < 8; row++) {
      const x = side ? 398 + (row % 3) * 5 : 7 + (row % 3) * 4,
        y = 31 + row * 34;
      ctx.fillStyle = materials.rock;
      ctx.fillRect(x, y, 70 - (row % 2) * 9, 26);
      ctx.fillRect(x + 7, y - 4, 45, 34);
      ctx.fillStyle = materials.edge;
      ctx.fillRect(x + 10, y + 1, 23, 2);
      if (s.level === 1) {
        ctx.fillStyle = '#56777a';
        ctx.fillRect(x + 45, y + 9, 4, 5);
      }
      if (s.level === 2) {
        ctx.fillStyle = '#465267';
        ctx.fillRect(x + 4, y + 18, 36, 3);
      }
      if (s.level === 3) {
        ctx.fillStyle = '#638572';
        ctx.fillRect(x + 38, y + 3, 3, 22);
        ctx.fillRect(x + 29, y + 12, 12, 3);
      }
    }
  ctx.fillStyle = '#102834';
  ctx.fillRect(92, 28, 296, 288);
  ctx.fillStyle = materials.floor;
  ctx.fillRect(96, 36, 288, 278);
  ctx.fillStyle = '#1d3743';
  ctx.fillRect(96, 270, 288, 44);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++) {
      const p = point(r, c, s.ceiling);
      if (p.y > 264 || p.y < 36 + s.ceiling) continue;
      ctx.fillStyle = '#42636a';
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
  for (const [x, flip] of [
    [92, 1],
    [384, -1],
  ]) {
    ctx.fillStyle = materials.edge;
    ctx.fillRect(x, 28, 4, 288);
    ctx.fillStyle = '#bdd0b4';
    ctx.fillRect(x + (flip > 0 ? 2 : 0), 28, 1, 288);
    ctx.fillStyle = '#1b3541';
    for (let y = 37; y < 314; y += 12) ctx.fillRect(x, y, 2, 5);
  }
  const roof = 36 + s.ceiling;
  ctx.fillStyle = '#354d58';
  ctx.fillRect(96, 28, 288, roof - 28);
  ctx.fillStyle = materials.light;
  ctx.fillRect(96, roof - 3, 288, 3);
  ctx.fillStyle = '#48636a';
  for (let x = 104; x < 380; x += 12) ctx.fillRect(x, roof - 6, 5, 3);
  for (const x of [84, 389]) {
    ctx.fillStyle = '#496c73';
    ctx.fillRect(x, 168, 7, 50);
    ctx.fillStyle = '#8cb2ac';
    for (let k = 0; k < 4; k++)
      ctx.fillRect(x + 1, 172 + k * 12 + (Math.floor(s.time * 8) % 3), 5, 2);
  }
  ctx.fillStyle = '#ad8b74';
  for (let x = 98; x < 383; x += 10) ctx.fillRect(x, 269, 5, 2);
  for (const o of s.obstacles) {
    const p = point(o.row, o.col, s.ceiling);
    ctx.fillStyle = '#1d303e';
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#a1b2b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R - 1, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#7f929d';
    ctx.fillRect(p.x - 6, p.y - 2, 12, 4);
    ctx.fillRect(p.x - 2, p.y - 6, 4, 12);
    ctx.fillStyle = '#d5ded0';
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0) {
        const p = point(r, c, s.ceiling);
        bubble(ctx, p.x, p.y, s.board[r][c]);
      }
  for (const p of s.popped) {
    ctx.fillStyle = '#132c39';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12.5, 0, TAU);
    ctx.fill();
    const scale = Math.max(1.5, R / (1 + p.z / 22));
    bubble(ctx, p.x, p.y, p.color, scale);
    ctx.strokeStyle = '#8baba6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, TAU);
    ctx.stroke();
  }
  const busy = !!(
    s.shot ||
    s.capture ||
    s.ceilingMotion ||
    s.transition > 0 ||
    drainBusy(s) ||
    !palette(s).length
  );
  if (!busy) {
    const preview = trace(s, s.angle);
    for (const segment of preview.segments)
      dotted(ctx, segment.from, segment.to, preview.plan ? '#8eb8aa' : '#ba8c80');
    if (preview.plan) {
      guidePath(ctx, preview.plan.segments, '#9cc9bb');
      const p = preview.plan.target;
      ctx.strokeStyle = '#c5e7bc';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c5e7bc';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    } else if (preview.contact) {
      ctx.strokeStyle = '#dfaf8c';
      ctx.beginPath();
      ctx.moveTo(preview.contact.x - 4, preview.contact.y - 4);
      ctx.lineTo(preview.contact.x + 4, preview.contact.y + 4);
      ctx.moveTo(preview.contact.x + 4, preview.contact.y - 4);
      ctx.lineTo(preview.contact.x - 4, preview.contact.y + 4);
      ctx.stroke();
    }
  }
  if (s.capture) {
    guidePath(ctx, s.capture.segments, '#d1e2ae');
    const p = s.capture.target;
    ctx.strokeStyle = '#bedbaa';
    ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
    bubble(ctx, s.capture.x, s.capture.y, s.capture.color);
  }
  if (s.shot) bubble(ctx, s.shot.x, s.shot.y, s.shot.color);
  // The launch cup is open above the air-table plane; its aim vane is a projected sight.
  ctx.fillStyle = '#67858a';
  ctx.fillRect(220, 311, 40, 5);
  ctx.fillRect(227, 308, 6, 6);
  ctx.fillRect(247, 308, 6, 6);
  ctx.fillStyle = '#afc9b5';
  ctx.fillRect(227, 311, 26, 2);
  const aim = { x: 240 + Math.cos(s.angle) * 21, y: SHOT_Y + Math.sin(s.angle) * 21 };
  ctx.fillStyle = '#c2d9ba';
  ctx.fillRect(aim.x - 2, aim.y - 2, 4, 4);
  ctx.fillStyle = '#789e9c';
  ctx.fillRect(238, 312, 4, 3);
  if (!s.shot && !s.capture) bubble(ctx, 240, SHOT_Y, s.current);
  text(ctx, env.t('CURRENT', '当前'), 44, 229, '#d4d8bc', 10, 'center');
  bubble(ctx, 44, 256, s.current, 9);
  text(ctx, env.t('NEXT', '下个'), 435, 229, '#d4d8bc', 10, 'center');
  bubble(ctx, 435, 256, s.next, 9);
  text(ctx, env.t('SWAP X', 'X 交换'), 435, 276, '#abbfb7', 10, 'center');
  text(ctx, env.t('PRESSURE', '推板压力'), 44, 64, '#cfbea0', 10, 'center');
  for (let n = 0; n < s.maxMisses; n++) {
    ctx.fillStyle = n < s.misses ? '#d69d7b' : '#40565d';
    ctx.fillRect(17 + n * 11, 84, 8, 7);
  }
  text(ctx, String(s.maxMisses - s.misses), 44, 104, '#e3c992', 16, 'center');
  text(ctx, env.t('MISSES LEFT', '还可失误'), 44, 125, '#9fb8b2', 9, 'center');
  if (s.level > 1) {
    text(ctx, env.t('BOLTS', '固定栓'), 435, 72, '#b8c9c0', 10, 'center');
    text(ctx, env.t('DO NOT MATCH', '不可消除'), 435, 88, '#91a7a8', 9, 'center');
  }
  ctx.fillStyle = '#112b37';
  ctx.fillRect(0, 0, 480, 25);
  text(
    ctx,
    env.t(
      `${CAVERNS[s.level - 1].en.toUpperCase()} ${s.level}/3`,
      `${CAVERNS[s.level - 1].zh} ${s.level}/3`,
    ),
    12,
    7,
    '#d0dfc4',
    11,
  );
  const remaining = palette(s).length ? s.board.flat().filter((v) => v >= 0).length : 0;
  text(ctx, env.t(`DRAIN ${remaining}`, `待排空 ${remaining}`), 468, 7, '#c6d9c8', 11, 'right');
  let state = env.t('AIR TABLE · MATCH THREE', '气垫台 · 三个同色配对');
  if (s.shot) state = env.t('CAPSULE IN FLIGHT', '泡泡飞行中');
  else if (s.capture) state = env.t('SOCKET GUIDE ACTIVE', '卡槽导引中');
  else if (s.pressureWarning > 0) state = env.t('PUSHER WARNING', '推板即将移动');
  else if (s.ceilingMotion) state = env.t('PUSHER MOVING', '推板移动中');
  else if (drainBusy(s) || !palette(s).length) state = env.t('DRAINS CLEARING', '排放槽清理中');
  else if (s.queuedFire) state = env.t('AIMING · SHOT QUEUED', '瞄准中 · 已排队发射');
  else if (s.messageTime > 0)
    state = env.t('NO CLEAR SOCKET · ADJUST AIM', '无可达卡槽 · 调整瞄准');
  text(ctx, state, 240, 278, s.pressureWarning > 0 ? '#f0bd8d' : '#9cbcb7', 10, 'center');
  if (s.transition > 0) {
    ctx.fillStyle = '#18333be8';
    ctx.fillRect(107, 174, 266, 39);
    text(ctx, env.t('TABLE DRAINED', '气垫台已排空'), 240, 180, '#e5d5a9', 14, 'center');
    text(ctx, env.t('NEXT CAVERN LOADING', '下一座洞穴准备中'), 240, 198, '#b8d2c1', 10, 'center');
  }
  if (s.combo >= 6)
    text(
      ctx,
      env.t(`${s.combo} DRAINED!`, `${s.combo} 个排空！`),
      240,
      256,
      '#ead19f',
      11,
      'center',
    );
}
meta.touchControls = [
  { code: 'ArrowLeft', side: 'left', label: { en: 'Aim left', zh: '左瞄准' } },
  { code: 'ArrowRight', side: 'left', label: { en: 'Aim right', zh: '右瞄准' } },
  { code: 'Space', side: 'right', label: { en: 'Shoot', zh: '发射' } },
  { code: 'KeyX', side: 'right', label: { en: 'Swap', zh: '交换' } },
];
export function createGame(env) {
  const s = createBubbleState(env);
  return {
    update: (dt, input) => stepBubble(s, dt, input, env),
    draw: (ctx) => drawBubble(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      remaining: s.board.flat().filter((v) => v >= 0).length,
      cavern: { en: CAVERNS[s.level - 1].en, zh: CAVERNS[s.level - 1].zh },
      status: {
        en: `Cavern ${s.level}/3 · ${s.board.flat().filter((v) => v >= 0).length} capsules · ${s.maxMisses - s.misses} misses before pusher`,
        zh: `洞穴 ${s.level}/3 · ${s.board.flat().filter((v) => v >= 0).length} 个泡泡 · 再失误 ${s.maxMisses - s.misses} 次后推板移动`,
      },
    }),
  };
}
