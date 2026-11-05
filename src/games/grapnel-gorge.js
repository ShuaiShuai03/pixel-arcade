import { background, drawPixelText as text, clamp } from '../shared/utils.js';

export const meta = {
  id: 'grapnel-gorge',
  name: { en: 'Grapnel Gorge', zh: '钩索峡谷' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Land at the flag in three canyon routes. Walk on stone; flight keeps its momentum. Space hooks the marked clear anchor 58–238 pixels away, or releases. Up powers the winch inward; Down pays rope out. Rest motionless on a cairn to recharge. X selects an anchor. Rock blocks hooks and cuts a touching rope. Z returns to the last cairn for one life. Enter travels after a clear. Relics are optional. Landing dots end in a check for safe stone or a cross for rock/water.',
    zh: '在三条峡谷路线的旗台着陆。石台上步行，腾空后保持惯性。空格连接58至238像素内高亮且无遮挡的锚点，或松开绳索。上键驱动绞盘收绳，下键放绳；在石台静止休息补充电量。X选择锚点。岩石阻挡钩索，也会切断接触它的绳索。Z消耗一条生命返回上一石台，通关后回车前进。遗物可选，松绳落点的对勾表示安全石台，叉号表示岩石或水面。',
  },
  keys: [
    {
      label: { en: 'Walk on stone (no air thrust)', zh: '石台上步行（空中无推力）' },
      keys: 'A D / ← →',
    },
    { label: { en: 'Hook / release', zh: '连接 / 松开' }, keys: 'Space' },
    { label: { en: 'Reel in / pay out', zh: '收绳 / 放绳' }, keys: 'W S / ↑ ↓' },
    { label: { en: 'Select available anchor', zh: '选择可用锚点' }, keys: 'X' },
    { label: { en: 'Rescue: one life', zh: '救援：消耗一条生命' }, keys: 'Z' },
    { label: { en: 'Travel after landing at flag', zh: '旗台着陆后前进' }, keys: 'Enter' },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Walk left', zh: '向左步行' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Walk right', zh: '向右步行' } },
    { code: 'KeyX', side: 'left', label: { en: 'Target', zh: '选锚点' } },
    { code: 'Space', side: 'right', label: { en: 'Hook / release', zh: '连接 / 松开' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'Reel in', zh: '收绳' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Pay out', zh: '放绳' } },
    { code: 'KeyZ', side: 'right', label: { en: 'Rescue −1 life', zh: '救援 −1生命' } },
    { code: 'Enter', side: 'right', label: { en: 'Next route', zh: '下一路线' } },
  ],
};
export const PHYSICS = Object.freeze({
  gravity: 420,
  step: 1 / 240,
  radius: 7,
  minLength: 58,
  maxLength: 238,
  hookRange: 238,
  reelSpeed: 32,
  walkSpeed: 130,
  walkForce: 780,
  battery: 300000,
  water: 306,
});
const G = PHYSICS.gravity,
  R = PHYSICS.radius,
  EPS = 1e-8;
const sq = (n) => n * n;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const wrap = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const sinc = (x) => (Math.abs(x) < 1e-6 ? 1 - (x * x) / 6 : Math.sin(x) / x);
export const mechanicalEnergy = (p) => (sq(p.vx) + sq(p.vy)) / 2 - G * p.y;

export function anchorPose(a, time) {
  const w = a.frequency || 0,
    angle = w * time + (a.phase || 0);
  const ax = a.amplitudeX || 0,
    ay = a.amplitudeY || 0;
  return {
    id: a.id,
    x: a.x + ax * Math.sin(angle),
    y: a.y + ay * Math.sin(angle),
    vx: ax * w * Math.cos(angle),
    vy: ay * w * Math.cos(angle),
    ax: -ax * w * w * Math.sin(angle),
    ay: -ay * w * w * Math.sin(angle),
  };
}
// Discrete-gradient pendulum step: gravity's potential difference is exactly
// the opposite of the change in tangential kinetic energy. No position repair.
export function pendulumStep(theta, omega, length, h) {
  if (!(h > 0) || !Number.isFinite(h)) return { theta, omega, residual: 0 };
  let d = h * omega;
  const c = (h * h * G) / (2 * length);
  for (let i = 0; i < 10; i++) d = h * omega - c * Math.sin(theta + d / 2) * sinc(d / 2);
  return {
    theta: wrap(theta + d),
    omega: (2 * d) / h - omega,
    residual: d - h * omega + c * Math.sin(theta + d / 2) * sinc(d / 2),
  };
}
function tension(theta, omega, length, a) {
  return (
    G * Math.cos(theta) - a.ax * Math.sin(theta) - a.ay * Math.cos(theta) + length * omega * omega
  );
}
function angularRK(theta, omega, length, rate, anchor, time, h) {
  const derivative = (q, w, t) => {
    const a = anchorPose(anchor, time + t),
      l = length + rate * t;
    return [w, (-G * Math.sin(q) - a.ax * Math.cos(q) + a.ay * Math.sin(q) - 2 * rate * w) / l];
  };
  const k1 = derivative(theta, omega, 0),
    k2 = derivative(theta + (k1[0] * h) / 2, omega + (k1[1] * h) / 2, h / 2),
    k3 = derivative(theta + (k2[0] * h) / 2, omega + (k2[1] * h) / 2, h / 2),
    k4 = derivative(theta + k3[0] * h, omega + k3[1] * h, h);
  return {
    theta: wrap(theta + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])),
    omega: omega + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  };
}
function pendulumBody(theta, omega, length, rate, a) {
  const nx = Math.sin(theta),
    ny = Math.cos(theta);
  return {
    x: a.x + length * nx,
    y: a.y + length * ny,
    vx: a.vx + rate * nx + length * omega * ny,
    vy: a.vy + rate * ny - length * omega * nx,
    ground: false,
  };
}
export function advanceTaut(rope, anchor, time, h) {
  const a0 = anchorPose(anchor, time),
    a1 = anchorPose(anchor, time + h),
    l0 = rope.length,
    rate = rope.rate || 0;
  const initial = pendulumBody(rope.theta, rope.omega, l0, rate, a0);
  const stationary = !anchor.amplitudeX && !anchor.amplitudeY && rate === 0;
  const end = stationary
    ? pendulumStep(rope.theta, rope.omega, l0, h)
    : angularRK(rope.theta, rope.omega, l0, rate, anchor, time, h);
  const middle = stationary
    ? pendulumStep(rope.theta, rope.omega, l0, h / 2)
    : angularRK(rope.theta, rope.omega, l0, rate, anchor, time, h / 2);
  const l1 = l0 + rate * h,
    p = pendulumBody(end.theta, end.omega, l1, rate, a1);
  const samples = [
    [rope.theta, rope.omega, l0, a0],
    [middle.theta, middle.omega, l0 + (rate * h) / 2, anchorPose(anchor, time + h / 2)],
    [end.theta, end.omega, l1, a1],
  ];
  let anchorWork = 0,
    winchWork = 0;
  const tensions = samples.map(([q, w, l, a], i) => {
    const force = tension(q, w, l, a),
      weight = i === 1 ? 4 : 1;
    anchorWork += (weight * -force * (a.vx * Math.sin(q) + a.vy * Math.cos(q)) * h) / 6;
    winchWork += (weight * -force * rate * h) / 6;
    return force;
  });
  return {
    player: p,
    rope: {
      ...rope,
      theta: end.theta,
      omega: end.omega,
      length: l1,
      x: a1.x,
      y: a1.y,
      tension: tensions[2],
      taut: true,
    },
    anchorWork,
    winchWork,
    numerical: mechanicalEnergy(p) - mechanicalEnergy(initial) - anchorWork - winchWork,
    residual: end.residual || 0,
    tensionStart: tensions[0],
    tensionEnd: tensions[2],
  };
}
// Capture is an inelastic collision with a moving, unilateral boundary. The
// moving anchor/winch supplies work; the relative radial capture loses energy.
export function captureRope(player, pose, length, rate = 0) {
  const dx = player.x - pose.x,
    dy = player.y - pose.y,
    d = Math.hypot(dx, dy),
    n = { x: dx / d, y: dy / d };
  const relative = (player.vx - pose.vx) * n.x + (player.vy - pose.vy) * n.y;
  const impulse = Math.min(0, rate - relative);
  const p = { ...player, vx: player.vx + impulse * n.x, vy: player.vy + impulse * n.y };
  const theta = Math.atan2(n.x, n.y),
    omega = ((p.vx - pose.vx) * n.y - (p.vy - pose.vy) * n.x) / length;
  const force = tension(theta, omega, length, pose);
  return {
    player: p,
    rope: {
      id: pose.id,
      x: pose.x,
      y: pose.y,
      length,
      rate,
      theta,
      omega,
      tension: relative >= rate - EPS && force >= 0 ? force : 0,
      taut: relative >= rate - EPS && force >= 0,
    },
    anchorWork: impulse * (pose.vx * n.x + pose.vy * n.y),
    winchWork: impulse * rate,
    captureLoss: (impulse * impulse) / 2,
  };
}
function roots(a, b, c) {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const d = Math.sqrt(Math.max(0, disc));
  return [(-b - d) / (2 * a), (-b + d) / (2 * a)];
}
export function sweepCircle(from, to, radius, rect) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    hits = [];
  const add = (at, nx, ny) => {
    if (at >= -EPS && at <= 1 + EPS && dx * nx + dy * ny < -EPS)
      hits.push({ at: clamp(at, 0, 1), nx, ny, rect });
  };
  for (const [x, nx] of [
    [rect.x - radius, -1],
    [rect.x + rect.w + radius, 1],
  ])
    if (dx * nx < 0) {
      const t = (x - from.x) / dx,
        y = from.y + dy * t;
      if (y >= rect.y - EPS && y <= rect.y + rect.h + EPS) add(t, nx, 0);
    }
  for (const [y, ny] of [
    [rect.y - radius, -1],
    [rect.y + rect.h + radius, 1],
  ])
    if (dy * ny < 0) {
      const t = (y - from.y) / dy,
        x = from.x + dx * t;
      if (x >= rect.x - EPS && x <= rect.x + rect.w + EPS) add(t, 0, ny);
    }
  for (const [x, y, sx, sy] of [
    [rect.x, rect.y, -1, -1],
    [rect.x + rect.w, rect.y, 1, -1],
    [rect.x, rect.y + rect.h, -1, 1],
    [rect.x + rect.w, rect.y + rect.h, 1, 1],
  ]) {
    const ox = from.x - x,
      oy = from.y - y;
    for (const t of roots(
      dx * dx + dy * dy,
      2 * (ox * dx + oy * dy),
      ox * ox + oy * oy - radius * radius,
    )) {
      const px = from.x + dx * t,
        py = from.y + dy * t;
      if ((px - x) * sx >= -EPS && (py - y) * sy >= -EPS)
        add(t, (px - x) / radius, (py - y) / radius);
    }
  }
  return hits.sort((a, b) => a.at - b.at)[0] || null;
}
export function segmentHit(a, b, rect, margin = 0) {
  const minX = rect.x - margin,
    maxX = rect.x + rect.w + margin,
    minY = rect.y - margin,
    maxY = rect.y + rect.h + margin;
  let enter = 0,
    exit = 1;
  for (const [p, d, lo, hi] of [
    [a.x, b.x - a.x, minX, maxX],
    [a.y, b.y - a.y, minY, maxY],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return null;
    } else {
      const q = (lo - p) / d,
        r = (hi - p) / d;
      enter = Math.max(enter, Math.min(q, r));
      exit = Math.min(exit, Math.max(q, r));
      if (enter > exit) return null;
    }
  }
  return { at: enter, x: a.x + (b.x - a.x) * enter, y: a.y + (b.y - a.y) * enter };
}
// A linearly moving rope can hit a corner between two clear endpoint frames.
// Collinearity is quadratic in time; endpoint/edge contacts complete the set.
export function movingRopeHit(a0, b0, a1, b1, solids) {
  let best = null;
  for (const rect of solids) {
    const r = { x: rect.x - 0.75, y: rect.y - 0.75, w: rect.w + 1.5, h: rect.h + 1.5 };
    const times = [0, 1],
      av = { x: a1.x - a0.x, y: a1.y - a0.y },
      bv = { x: b1.x - b0.x, y: b1.y - b0.y };
    for (const [start, velocity] of [
      [a0, av],
      [b0, bv],
    ]) {
      for (const x of [r.x, r.x + r.w]) if (velocity.x) times.push((x - start.x) / velocity.x);
      for (const y of [r.y, r.y + r.h]) if (velocity.y) times.push((y - start.y) / velocity.y);
    }
    const d0 = { x: b0.x - a0.x, y: b0.y - a0.y },
      dv = { x: bv.x - av.x, y: bv.y - av.y };
    for (const corner of [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
    ]) {
      const c0 = { x: corner.x - a0.x, y: corner.y - a0.y };
      times.push(...roots(-cross(dv, av), cross(dv, c0) - cross(d0, av), cross(d0, c0)));
    }
    for (const t of times.filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)) {
      const a = { x: a0.x + av.x * t, y: a0.y + av.y * t },
        b = { x: b0.x + bv.x * t, y: b0.y + bv.y * t },
        hit = segmentHit(a, b, r);
      if (hit && (!best || t < best.at)) best = { ...hit, at: t, rect };
    }
  }
  return best;
}
function circleGap(p, rect) {
  return (
    Math.hypot(
      p.x - clamp(p.x, rect.x, rect.x + rect.w),
      p.y - clamp(p.y, rect.y, rect.y + rect.h),
    ) - R
  );
}
function curvedContact(s, h, rect, approximate) {
  const initial = circleGap(s.player, rect);
  const normalVelocity = s.player.vx * approximate.nx + s.player.vy * approximate.ny;
  if (initial <= 1e-9 && approximate.at < 1e-8 && normalVelocity < -1e-7)
    return { time: 0, contact: approximate };
  const times = [
    approximate.at * h,
    ...Array.from({ length: 8 }, (_, i) => ((i + 1) * h) / 8),
  ].sort((a, b) => a - b);
  let lo = 0;
  for (const end of times) {
    if (end < lo || end <= 1e-12) continue;
    const gap = circleGap(predict(s, end).player, rect);
    if (initial <= 1e-9 && normalVelocity >= -1e-7 && gap > -1e-9) {
      lo = end;
      continue;
    }
    if (gap <= 0) {
      let hi = end;
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2;
        if (circleGap(predict(s, mid).player, rect) > 0) lo = mid;
        else hi = mid;
      }
      const p = predict(s, hi).player,
        x = clamp(p.x, rect.x, rect.x + rect.w),
        y = clamp(p.y, rect.y, rect.y + rect.h),
        d = Math.hypot(p.x - x, p.y - y);
      return { time: hi, contact: { ...approximate, nx: (p.x - x) / d, ny: (p.y - y) / d } };
    }
    lo = end;
  }
  return null;
}
function contactVelocity(vx, vy, contacts) {
  const legal = (v) => contacts.every((c) => v.x * c.nx + v.y * c.ny >= -1e-7);
  const candidates = [
    { x: vx, y: vy },
    { x: 0, y: 0 },
  ];
  for (const c of contacts) {
    const inward = vx * c.nx + vy * c.ny;
    candidates.push({ x: vx - inward * c.nx, y: vy - inward * c.ny });
  }
  return candidates
    .filter(legal)
    .sort((a, b) => sq(a.x - vx) + sq(a.y - vy) - sq(b.x - vx) - sq(b.y - vy))[0];
}
function support(s) {
  return (
    s.route.pads.find(
      (p) =>
        s.player.x >= p.x - EPS &&
        s.player.x <= p.x + p.w + EPS &&
        Math.abs(s.player.y + R - p.y) < 1e-5 &&
        s.player.vy >= -EPS,
    ) || null
  );
}
const anchor = (id, x, y, extras = {}) => ({
  id,
  x,
  y,
  amplitudeX: 0,
  amplitudeY: 0,
  frequency: 0,
  phase: 0,
  ...extras,
});
export function routePlan(level) {
  const frame = [
    { x: 0, y: 0, w: 480, h: 36, kind: 'ceiling' },
    { x: 0, y: 30, w: 12, h: 300, kind: 'wall' },
    { x: 468, y: 30, w: 12, h: 300, kind: 'wall' },
  ];
  const plans = [
    {
      id: 'copper-arch',
      name: { en: 'Copper Arch', zh: '赤铜拱' },
      lesson: {
        en: 'Reel to lift off; release toward the flag.',
        zh: '收绳离开石台，朝旗台松绳。',
      },
      pads: [
        { id: 0, x: 12, y: 252, w: 116 },
        { id: 1, x: 286, y: 252, w: 182, exit: true },
      ],
      anchors: [anchor(0, 190, 82)],
      relics: [{ id: 'copper-seal', x: 250, y: 161 }],
      rocks: [],
    },
    {
      id: 'split-spire',
      name: { en: 'Split Spire', zh: '双塔隘口' },
      lesson: {
        en: 'Rest on the middle cairn. Switch anchors around rock.',
        zh: '在中间石台休息，绕开岩壁更换锚点。',
      },
      pads: [
        { id: 0, x: 12, y: 252, w: 116 },
        { id: 1, x: 218, y: 258, w: 62 },
        { id: 2, x: 386, y: 246, w: 82, exit: true },
      ],
      anchors: [anchor(0, 151, 78), anchor(1, 324, 71)],
      relics: [{ id: 'quartz-mask', x: 357, y: 144 }],
      rocks: [{ x: 274, y: 36, w: 23, h: 101, kind: 'overhang' }],
    },
    {
      id: 'rail-of-winds',
      name: { en: 'Skyrail Crossing', zh: '天轨横渡' },
      lesson: {
        en: 'Rail motors move anchors. Watch their arrows and your landing dots.',
        zh: '轨道电机移动锚点，观察方向箭头和落点。',
      },
      pads: [
        { id: 0, x: 12, y: 252, w: 116 },
        { id: 1, x: 245, y: 252, w: 57 },
        { id: 2, x: 407, y: 234, w: 61, exit: true },
      ],
      anchors: [
        anchor(0, 173, 78, { amplitudeX: 25, frequency: 0.9 }),
        anchor(1, 350, 73, { amplitudeY: 13, frequency: 0.8, phase: 0.6 }),
      ],
      relics: [{ id: 'sky-compass', x: 385, y: 129 }],
      rocks: [{ x: 302, y: 36, w: 19, h: 91, kind: 'overhang' }],
    },
  ];
  const route = structuredClone(plans[level - 1]);
  for (const a of route.anchors)
    frame.push({
      x: a.x - a.amplitudeX - 18,
      y: 47,
      w: 36 + 2 * a.amplitudeX,
      h: 8,
      kind: 'rail',
      anchor: a.id,
    });
  route.solids = [
    ...frame,
    ...route.rocks,
    ...route.pads.map((p) => ({ ...p, h: 400 - p.y, kind: 'cairn' })),
  ];
  return route;
}
function freshLedger() {
  return { winch: 0, anchor: 0, ground: 0, contactLoss: 0, captureLoss: 0, numerical: 0, spent: 0 };
}
function setRoute(s, level) {
  s.level = level;
  s.route = routePlan(level);
  s.routeTime = 0;
  s.rope = null;
  s.contactArc = null;
  s.target = 0;
  s.checkpoint = 0;
  s.visited = [0];
  s.betweenRoutes = false;
  s.recovering = 0;
  s.charge = PHYSICS.battery;
  s.flash = null;
  s.ledger = freshLedger();
  s.player = { x: 62, y: s.route.pads[0].y - R, vx: 0, vy: 0, ground: true };
  s.energyBaseline = mechanicalEnergy(s.player);
  s.notice = s.route.lesson;
  s.lastEvent = 'route';
}
export function createGrapnelState() {
  const s = {
    phase: 'playing',
    score: 0,
    lives: 5,
    level: 1,
    time: 0,
    accumulator: 0,
    pending: [],
    collected: [],
    completed: [],
  };
  setRoute(s, 1);
  return s;
}
function notify(s, en, zh) {
  s.notice = { en, zh };
}
function available(s) {
  return s.route.anchors.map((a) => {
    const p = anchorPose(a, s.routeTime),
      distance = Math.hypot(p.x - s.player.x, p.y - s.player.y);
    const blocked = s.route.solids.find((r) => segmentHit(p, s.player, r, 0.75));
    return {
      ...p,
      distance,
      eligible:
        distance >= PHYSICS.minLength &&
        distance <= PHYSICS.hookRange &&
        p.y < s.player.y - 12 &&
        !blocked,
      blocked: !!blocked,
      moving: !!(a.amplitudeX || a.amplitudeY),
    };
  });
}
function selected(s) {
  const list = available(s);
  return (
    list.find((a) => a.id === s.target && a.eligible) ||
    list
      .filter((a) => a.eligible)
      .sort((a, b) => Math.abs(a.x - s.player.x - 70) - Math.abs(b.x - s.player.x - 70))[0] ||
    null
  );
}
function addWork(s, result) {
  s.ledger.anchor += result.anchorWork || 0;
  s.ledger.winch += result.winchWork || 0;
  s.ledger.captureLoss += result.captureLoss || 0;
  s.ledger.numerical += result.numerical || 0;
  const spent = Math.max(0, result.winchWork || 0);
  s.ledger.spent += spent;
  s.charge = Math.max(0, s.charge - spent);
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.lastEvent = won ? 'win' : 'loss';
  s.accumulator = 0;
  s.pending = [];
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All three canyon routes crossed. Your swings carried you home!'
        : 'No rescue lives remain. A fresh expedition restores all five.',
      won ? '三条峡谷路线全部穿越，平安归来！' : '救援生命已耗尽，新探险会恢复五条生命。',
    ),
  });
}
function rescue(s, env, reason = 'fall') {
  s.lives--;
  s.pending = [];
  s.lastEvent = reason;
  s.rope = null;
  s.contactArc = null;
  if (!s.lives) {
    finish(s, env, false);
    return;
  }
  const pad = s.route.pads.find((p) => p.id === s.checkpoint),
    x = pad.x + pad.w / 2;
  s.player = { x, y: pad.y - R, vx: 0, vy: 0, ground: true };
  s.charge = PHYSICS.battery;
  s.recovering = 0.35;
  s.ledger = freshLedger();
  s.energyBaseline = mechanicalEnergy(s.player);
  s.flash = { x, y: pad.y - 15, time: 0.6, type: 'rescue' };
  notify(
    s,
    'Rescued to the last cairn. One life spent; winch recharged.',
    '已返回上一石台，消耗一条生命，绞盘已充电。',
  );
  env.sound('hit');
}
function cutRope(s, env, hit) {
  s.rope = null;
  s.flash = { x: hit.x, y: hit.y, time: 0.65, type: 'cut' };
  s.lastEvent = 'cut';
  notify(
    s,
    'Rock cut the rope. Momentum remains: hook a clear anchor or use Z to rescue.',
    '岩石切断绳索，惯性仍保留。可连接无遮挡锚点，或按Z救援。',
  );
  env.sound('hit');
}
function hook(s, env) {
  if (s.rope) {
    s.rope = null;
    s.lastEvent = 'release';
    notify(
      s,
      'Released: your velocity carries you. Dots show the ballistic landing.',
      '已松绳，速度保持，点线显示抛物落点。',
    );
    env.sound('move');
    return;
  }
  const a = selected(s);
  if (!a) {
    notify(
      s,
      'No clear marked anchor above within 238 px. Walk closer or change your approach.',
      '上方238像素内没有无遮挡锚点，请靠近或改变路线。',
    );
    return;
  }
  const length = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  s.target = a.id;
  s.rope = {
    id: a.id,
    x: a.x,
    y: a.y,
    length,
    rate: 0,
    theta: Math.atan2(s.player.x - a.x, s.player.y - a.y),
    omega: 0,
    tension: 0,
    taut: false,
  };
  s.lastEvent = 'hook';
  notify(
    s,
    'Hook secured. Up reels; Down pays out; Space releases.',
    '钩索已固定。上键收绳，下键放绳，空格松开。',
  );
  env.sound('shoot');
}
function setRate(s, rate) {
  const rope = s.rope;
  if (!rope) return;
  if (
    (rope.length <= PHYSICS.minLength + EPS && rate < 0) ||
    (rope.length >= PHYSICS.maxLength - EPS && rate > 0)
  )
    rate = 0;
  if (rate < 0 && s.charge <= EPS) rate = 0;
  if (rope.rate === rate) return;
  if (rope.taut && rate > rope.rate) {
    // A cable may pull inward, never push outward. Relaxing its moving
    // maximum-length boundary releases tension and preserves world velocity.
    rope.rate = rate;
    rope.taut = false;
    rope.tension = 0;
    delete rope.wall;
    delete rope.corner;
    return;
  }

  if (rope.taut) {
    const a = anchorPose(s.route.anchors[rope.id], s.routeTime),
      n = { x: Math.sin(rope.theta), y: Math.cos(rope.theta) };
    const winchWork = (rate * rate - rope.rate * rope.rate) / 2;
    if (winchWork > s.charge + EPS) {
      rate = 0;
      notify(
        s,
        'Winch needs charge: rest on a cairn. Paying out and release still work.',
        '绞盘需要充电，请在石台休息；放绳和松开仍可用。',
      );
      if (rope.rate === 0) return;
    }
    const actualDelta = rate - rope.rate,
      work = (rate * rate - rope.rate * rope.rate) / 2;
    s.player.vx += actualDelta * n.x;
    s.player.vy += actualDelta * n.y;
    addWork(s, {
      anchorWork: actualDelta * (a.vx * n.x + a.vy * n.y),
      winchWork: work,
    });
    if (s.player.vy < -EPS) s.player.ground = false;
  }
  rope.rate = rate;
}
function wallPose(rope, anchor, time, h) {
  const a = anchorPose(anchor, time + h),
    length = rope.length + rope.rate * h,
    dx = rope.wall.x - a.x;
  const dy = rope.wall.sign * Math.sqrt(length * length - dx * dx),
    nx = dx / length,
    ny = dy / length;
  const vy = a.vy + (length * rope.rate + dx * a.vx) / dy;
  const tangential2 = Math.max(0, a.vx * a.vx + sq(vy - a.vy) - rope.rate * rope.rate);
  const ay = (nx * a.ax + ny * a.ay - tangential2 / length) / ny;
  const force = (G - ay) / ny,
    reaction = (force * nx) / rope.wall.nx;
  return {
    player: { x: rope.wall.x, y: a.y + dy, vx: 0, vy, ground: false },
    theta: Math.atan2(nx, ny),
    omega: (-a.vx * ny - (vy - a.vy) * nx) / length,
    length,
    a,
    force,
    reaction,
  };
}
function advanceWall(rope, anchor, time, h) {
  const nodes = [
    wallPose(rope, anchor, time, 0),
    wallPose(rope, anchor, time, h / 2),
    wallPose(rope, anchor, time, h),
  ];
  let anchorWork = 0,
    winchWork = 0;
  for (let i = 0; i < 3; i++) {
    const n = nodes[i],
      weight = i === 1 ? 4 : 1;
    anchorWork +=
      (-n.force * (n.a.vx * Math.sin(n.theta) + n.a.vy * Math.cos(n.theta)) * weight * h) / 6;
    winchWork += (-n.force * rope.rate * weight * h) / 6;
  }
  const last = nodes[2];
  return {
    player: last.player,
    rope: {
      ...rope,
      theta: last.theta,
      omega: last.omega,
      length: last.length,
      x: last.a.x,
      y: last.a.y,
      tension: Math.max(0, last.force),
    },
    anchorWork,
    winchWork,
    numerical:
      mechanicalEnergy(last.player) - mechanicalEnergy(nodes[0].player) - anchorWork - winchWork,
    tensionStart: nodes[0].force,
    tensionEnd: last.force,
    reactionEnd: last.reaction,
  };
}
function prepareWall(s) {
  const rope = s.rope;
  if (!rope) return;
  delete rope.wall;
  const a = anchorPose(s.route.anchors[rope.id], s.routeTime),
    distance = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  if (distance < rope.length - 1e-6) return;
  for (const rect of s.route.solids) {
    if (s.player.y < rect.y - EPS || s.player.y > rect.y + rect.h + EPS) continue;
    const nx =
      Math.abs(s.player.x - (rect.x + rect.w + R)) < 1e-7
        ? 1
        : Math.abs(s.player.x - (rect.x - R)) < 1e-7
          ? -1
          : 0;
    if (!nx || s.player.vx * nx > EPS) continue;
    if (
      (s.player.y <= rect.y + EPS && s.player.vy < 0) ||
      (s.player.y >= rect.y + rect.h - EPS && s.player.vy > 0)
    )
      continue;
    const wall = {
      x: s.player.x,
      nx,
      sign: Math.sign(s.player.y - a.y) || 1,
      minY: rect.y,
      maxY: rect.y + rect.h,
    };
    const model = wallPose({ ...rope, wall }, s.route.anchors[rope.id], s.routeTime, 0);
    if (!Number.isFinite(model.force) || model.force < 0 || model.reaction < 0) continue;
    if (model.force <= EPS || model.reaction <= EPS) {
      const future = wallPose({ ...rope, wall }, s.route.anchors[rope.id], s.routeTime, 1e-6);
      if (
        (model.force <= EPS && future.force < 0) ||
        (model.reaction <= EPS && future.reaction < 0)
      )
        continue;
    }
    const n = { x: (s.player.x - a.x) / rope.length, y: (s.player.y - a.y) / rope.length },
      dv = { x: -s.player.vx, y: model.player.vy - s.player.vy };
    const pull = -dv.y / n.y,
      reaction = (dv.x + pull * n.x) / nx;
    if (pull < -EPS || reaction < -EPS) continue;
    const winchWork = -pull * rope.rate;
    if (winchWork > s.charge + EPS) {
      setRate(s, 0);
      return prepareWall(s);
    }
    s.player.vx = 0;
    s.player.vy = model.player.vy;
    addWork(s, {
      anchorWork: -pull * (a.vx * n.x + a.vy * n.y),
      winchWork,
      captureLoss: (dv.x * dv.x + dv.y * dv.y) / 2,
    });
    Object.assign(rope, {
      wall,
      theta: model.theta,
      omega: model.omega,
      tension: Math.max(0, model.force),
      taut: true,
    });
    return;
  }
}
function cornerPose(rope, anchor, time, h) {
  const corner = rope.corner,
    a = anchorPose(anchor, time + h),
    length = rope.length + rope.rate * h;
  const dx = a.x - corner.x,
    dy = a.y - corner.y,
    d = Math.hypot(dx, dy),
    ux = dx / d,
    uy = dy / d;
  const along = (R * R - length * length + d * d) / (2 * d),
    height2 = R * R - along * along;
  if (height2 <= 0) return null;
  const across = corner.branch * Math.sqrt(height2),
    x = corner.x + along * ux - across * uy,
    y = corner.y + along * uy + across * ux;
  const nc = { x: (x - corner.x) / R, y: (y - corner.y) / R },
    nr = { x: (x - a.x) / length, y: (y - a.y) / length },
    tangent = { x: nc.y, y: -nc.x },
    denominator = dot(nr, tangent);
  if (Math.abs(denominator) < 1e-10) return null;
  const speed = (rope.rate + nr.x * a.vx + nr.y * a.vy) / denominator,
    vx = tangent.x * speed,
    vy = tangent.y * speed;
  const relative2 = sq(vx - a.vx) + sq(vy - a.vy) - rope.rate * rope.rate;
  const tangentialAcceleration =
    (nr.x * a.ax + nr.y * a.ay - relative2 / length + (dot(nr, nc) * speed * speed) / R) /
    denominator;
  const acceleration = {
    x: tangent.x * tangentialAcceleration - (nc.x * speed * speed) / R,
    y: tangent.y * tangentialAcceleration - (nc.y * speed * speed) / R,
  };
  const balance = { x: -acceleration.x, y: G - acceleration.y },
    det = cross(nr, nc);
  const force = cross(balance, nc) / det,
    reaction = -cross(nr, balance) / det;
  return {
    player: { x, y, vx, vy, ground: false },
    a,
    length,
    nr,
    nc,
    force,
    reaction,
    theta: Math.atan2(nr.x, nr.y),
    omega: ((vx - a.vx) * nr.y - (vy - a.vy) * nr.x) / length,
    quadrantX: nc.x * corner.sx,
    quadrantY: nc.y * corner.sy,
  };
}
function advanceCorner(rope, anchor, time, h) {
  const nodes = [
    cornerPose(rope, anchor, time, 0),
    cornerPose(rope, anchor, time, h / 2),
    cornerPose(rope, anchor, time, h),
  ];
  if (nodes.some((n) => !n)) return null;
  let anchorWork = 0,
    winchWork = 0;
  for (let i = 0; i < 3; i++) {
    const n = nodes[i],
      weight = i === 1 ? 4 : 1;
    anchorWork += (-n.force * (n.a.vx * n.nr.x + n.a.vy * n.nr.y) * weight * h) / 6;
    winchWork += (-n.force * rope.rate * weight * h) / 6;
  }
  const last = nodes[2];
  return {
    player: last.player,
    rope: {
      ...rope,
      x: last.a.x,
      y: last.a.y,
      length: last.length,
      theta: last.theta,
      omega: last.omega,
      tension: Math.max(0, last.force),
    },
    anchorWork,
    winchWork,
    numerical:
      mechanicalEnergy(last.player) - mechanicalEnergy(nodes[0].player) - anchorWork - winchWork,
    tensionStart: nodes[0].force,
    tensionEnd: last.force,
    reactionEnd: last.reaction,
    quadrantX: last.quadrantX,
    quadrantY: last.quadrantY,
  };
}
function prepareCorner(s) {
  const rope = s.rope;
  if (!rope) return;
  delete rope.corner;
  const a = anchorPose(s.route.anchors[rope.id], s.routeTime);
  if (Math.hypot(s.player.x - a.x, s.player.y - a.y) < rope.length - 1e-6) return;
  for (const rect of s.route.solids)
    for (const [x, y, sx, sy] of [
      [rect.x, rect.y, -1, -1],
      [rect.x + rect.w, rect.y, 1, -1],
      [rect.x, rect.y + rect.h, -1, 1],
      [rect.x + rect.w, rect.y + rect.h, 1, 1],
    ]) {
      const dx = s.player.x - x,
        dy = s.player.y - y,
        d = Math.hypot(dx, dy);
      if (
        Math.abs(d - R) > 1e-6 ||
        dx * sx < -EPS ||
        dy * sy < -EPS ||
        (s.player.vx * dx + s.player.vy * dy) / d > 1e-7
      )
        continue;
      if (
        (dx * sx <= EPS && s.player.vx * sx < -EPS) ||
        (dy * sy <= EPS && s.player.vy * sy < -EPS)
      )
        continue;
      const u = {
        x: (a.x - x) / Math.hypot(a.x - x, a.y - y),
        y: (a.y - y) / Math.hypot(a.x - x, a.y - y),
      };
      const corner = { x, y, sx, sy, branch: Math.sign(cross(u, { x: dx, y: dy })) || 1, rect };
      const model = cornerPose({ ...rope, corner }, s.route.anchors[rope.id], s.routeTime, 0);
      if (!model || model.force < 0 || model.reaction < 0) continue;
      if (model.force <= EPS || model.reaction <= EPS) {
        const future = cornerPose({ ...rope, corner }, s.route.anchors[rope.id], s.routeTime, 1e-6);
        if (
          future &&
          ((model.force <= EPS && future.force < 0) ||
            (model.reaction <= EPS && future.reaction < 0))
        )
          continue;
      }
      const dv = { x: model.player.vx - s.player.vx, y: model.player.vy - s.player.vy },
        det = cross(model.nr, model.nc);
      const pull = -cross(dv, model.nc) / det,
        reaction = cross(model.nr, dv) / det;
      if (pull < -EPS || reaction < -EPS) continue;
      const winchWork = -pull * rope.rate;
      if (winchWork > s.charge + EPS) {
        setRate(s, 0);
        return prepareCorner(s);
      }
      s.player.vx = model.player.vx;
      s.player.vy = model.player.vy;
      addWork(s, {
        anchorWork: -pull * (a.vx * model.nr.x + a.vy * model.nr.y),
        winchWork,
        captureLoss: (dv.x * dv.x + dv.y * dv.y) / 2,
      });
      delete rope.wall;
      Object.assign(rope, {
        corner,
        theta: model.theta,
        omega: model.omega,
        tension: Math.max(0, model.force),
        taut: true,
      });
      return;
    }
}
function prepareArc(s) {
  s.contactArc = null;
  if (s.rope?.taut || support(s)) return;
  for (const rect of s.route.solids)
    for (const [x, y, sx, sy] of [
      [rect.x, rect.y, -1, -1],
      [rect.x + rect.w, rect.y, 1, -1],
      [rect.x, rect.y + rect.h, -1, 1],
      [rect.x + rect.w, rect.y + rect.h, 1, 1],
    ]) {
      const dx = s.player.x - x,
        dy = s.player.y - y,
        d = Math.hypot(dx, dy);
      if (Math.abs(d - R) > 1e-6 || dx * sx < -EPS || dy * sy < -EPS) continue;
      const nx = dx / d,
        ny = dy / d,
        normalSpeed = s.player.vx * nx + s.player.vy * ny;
      if (normalSpeed > 1e-7) continue;
      if (
        (dx * sx <= EPS && s.player.vx * sx < -EPS) ||
        (dy * sy <= EPS && s.player.vy * sy < -EPS)
      )
        continue;
      const omega = (s.player.vx * ny - s.player.vy * nx) / R,
        reaction = -G * ny - R * omega * omega;
      if (reaction < -1e-7 || (reaction <= 1e-6 && 3 * G * omega * nx < 0)) continue;
      if (normalSpeed < 0) {
        s.ledger.contactLoss += (normalSpeed * normalSpeed) / 2;
        s.player.vx -= normalSpeed * nx;
        s.player.vy -= normalSpeed * ny;
      }
      s.contactArc = { x, y, sx, sy, theta: Math.atan2(nx, ny), omega, rect };
      return;
    }
}
function advanceArc(s, h) {
  const arc = s.contactArc,
    q = pendulumStep(arc.theta, arc.omega, R, h),
    nx = Math.sin(q.theta),
    ny = Math.cos(q.theta);
  const player = {
    x: arc.x + R * nx,
    y: arc.y + R * ny,
    vx: R * q.omega * ny,
    vy: -R * q.omega * nx,
    ground: false,
  };
  const reaction = -G * ny - R * q.omega * q.omega;
  const rope = s.rope
    ? {
        ...s.rope,
        length: s.rope.length + s.rope.rate * h,
        ...anchorPose(s.route.anchors[s.rope.id], s.routeTime + h),
        tension: 0,
      }
    : null;
  return {
    player,
    rope,
    anchorWork: 0,
    winchWork: 0,
    numerical: mechanicalEnergy(player) - mechanicalEnergy(s.player),
    reactionEnd: reaction,
    arcX: nx * arc.sx,
    arcY: ny * arc.sy,
  };
}
function predict(s, h) {
  const p = s.player;
  if (s.rope?.taut && s.rope.corner)
    return advanceCorner(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  if (s.contactArc) return advanceArc(s, h);
  if (s.rope?.wall) return advanceWall(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  if (s.rope?.taut) return advanceTaut(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  const grounded = support(s),
    ay = grounded ? 0 : G;
  return {
    player: {
      x: p.x + p.vx * h,
      y: p.y + p.vy * h + (ay * h * h) / 2,
      vx: p.vx,
      vy: p.vy + ay * h,
      ground: !!grounded,
    },
    rope: s.rope ? { ...s.rope, length: s.rope.length + s.rope.rate * h } : null,
    anchorWork: 0,
    winchWork: 0,
    numerical: 0,
  };
}
function curvedRelicEntry(s, h, relic, guess) {
  const gap = (t) => {
    const p = predict(s, t).player;
    return Math.hypot(p.x - relic.x, p.y - relic.y) - (R + 8);
  };
  if (gap(0) <= 0) return 0;
  const times = [guess * h, ...Array.from({ length: 8 }, (_, i) => ((i + 1) * h) / 8)].sort(
    (a, b) => a - b,
  );
  let lo = 0;
  for (const end of times) {
    if (end < lo) continue;
    if (gap(end) <= 0) {
      let hi = end;
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    lo = end;
  }
  return null;
}
function crossingTime(fn, h) {
  let lo = 0,
    hi = h;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) > 0) hi = mid;
    else lo = mid;
  }
  return hi;
}
function captureNow(s) {
  const r = s.rope,
    a = anchorPose(s.route.anchors[r.id], s.routeTime),
    dx = s.player.x - a.x,
    dy = s.player.y - a.y,
    d = Math.hypot(dx, dy),
    radial = ((s.player.vx - a.vx) * dx + (s.player.vy - a.vy) * dy) / d;
  if (d < r.length - 1e-6 || radial < r.rate - EPS) return false;
  if (support(s) && !r.rate && !a.vx && !a.vy && Math.abs(s.player.vx) < EPS) return false;
  let result = captureRope(s.player, a, r.length, r.rate);
  if (result.winchWork > s.charge + EPS) {
    r.rate = 0;
    result = captureRope(s.player, a, r.length, 0);
    notify(
      s,
      'Winch stalled under load. Rest to recharge; release and rescue remain available.',
      '绞盘负载过大，请休息充电；仍可松绳或救援。',
    );
  }
  Object.assign(s.player, result.player);
  s.rope = { ...r, ...result.rope };
  addWork(s, result);
  if (s.rope.taut && s.player.vy < -EPS) s.player.ground = false;
  return s.rope.taut || result.captureLoss > EPS;
}
function stepPhysics(s, h, controls, env) {
  if (s.recovering > 0) {
    s.recovering = Math.max(0, s.recovering - h);
    s.time += h;
    s.routeTime += h;
    return;
  }
  const floor = support(s);
  s.player.ground = !!floor;
  if (floor) {
    const target = controls.walk * PHYSICS.walkSpeed,
      before = s.player.vx;
    s.player.vx += clamp(target - s.player.vx, -PHYSICS.walkForce * h, PHYSICS.walkForce * h);
    s.ledger.ground += (sq(s.player.vx) - sq(before)) / 2;
    if (Math.abs(s.player.vx) < 5 && (!s.rope || !s.rope.taut))
      s.charge = Math.min(PHYSICS.battery, s.charge + PHYSICS.battery * 0.25 * h);
    if (s.rope?.taut) {
      s.rope.taut = false;
      s.rope.tension = 0;
      delete s.rope.wall;
      delete s.rope.corner;
    }
  }
  setRate(s, controls.reel * PHYSICS.reelSpeed);
  let remaining = h;
  while (remaining > 1e-10 && s.phase === 'playing' && !s.betweenRoutes) {
    prepareWall(s);
    prepareCorner(s);
    if (s.rope && !s.rope.taut) captureNow(s);
    if (s.rope?.taut) {
      const a = anchorPose(s.route.anchors[s.rope.id], s.routeTime);
      if (tension(s.rope.theta, s.rope.omega, s.rope.length, a) < -EPS) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
    }
    prepareArc(s);
    let span = remaining;
    if (s.rope?.rate < 0) span = Math.min(span, (s.rope.length - PHYSICS.minLength) / -s.rope.rate);
    if (s.rope?.rate > 0) span = Math.min(span, (PHYSICS.maxLength - s.rope.length) / s.rope.rate);
    while (
      s.rope?.corner &&
      !cornerPose(s.rope, s.route.anchors[s.rope.id], s.routeTime, span) &&
      span > 1e-10
    )
      span /= 2;
    if (span <= 1e-10) {
      setRate(s, 0);
      continue;
    }
    const horizon = span;
    let next = predict(s, horizon),
      kind = span < remaining - 1e-10 ? 'length' : null,
      hit = null;
    const pick = (time, type, info) => {
      if (time < span - 1e-10 || (!kind && Math.abs(time - span) < 1e-10)) {
        span = Math.max(0, time);
        kind = type;
        hit = info;
      }
    };
    if (s.rope?.taut && next.tensionEnd < 0)
      pick(
        crossingTime((t) => -predict(s, t).tensionEnd, horizon),
        'slack',
        null,
      );
    if (s.rope?.taut && next.winchWork > s.charge + EPS)
      pick(
        crossingTime((t) => predict(s, t).winchWork - s.charge, horizon),
        'battery',
        null,
      );
    if (s.rope?.wall) {
      const wall = s.rope.wall;
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'wall-end',
          null,
        );
      if (next.player.y < wall.minY)
        pick(
          crossingTime((t) => wall.minY - predict(s, t).player.y, horizon),
          'wall-end',
          null,
        );
      if (next.player.y > wall.maxY)
        pick(
          crossingTime((t) => predict(s, t).player.y - wall.maxY, horizon),
          'wall-end',
          null,
        );
    }
    if (s.contactArc) {
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'arc-end',
          null,
        );
      if (next.arcX < 0)
        pick(
          crossingTime((t) => -predict(s, t).arcX, horizon),
          'arc-end',
          null,
        );
      if (next.arcY < 0)
        pick(
          crossingTime((t) => -predict(s, t).arcY, horizon),
          'arc-end',
          null,
        );
    }
    if (s.rope?.corner) {
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'corner-end',
          null,
        );
      if (next.quadrantX < 0)
        pick(
          crossingTime((t) => -predict(s, t).quadrantX, horizon),
          'corner-end',
          null,
        );
      if (next.quadrantY < 0)
        pick(
          crossingTime((t) => -predict(s, t).quadrantY, horizon),
          'corner-end',
          null,
        );
    }
    const from = { ...s.player };
    for (const rect of s.route.solids) {
      if (s.contactArc?.rect === rect || s.rope?.corner?.rect === rect) continue;
      const c = sweepCircle(from, next.player, R, rect);
      if (c) {
        const exact = curvedContact(s, horizon, rect, c);
        if (exact) pick(exact.time, 'solid', exact.contact);
      }
    }
    if (next.player.y >= PHYSICS.water - R && from.y < PHYSICS.water - R) {
      const at = crossingTime((t) => predict(s, t).player.y - (PHYSICS.water - R), horizon);
      pick(at, 'water', null);
    }
    if (s.rope && !s.rope.taut) {
      const r = s.rope,
        distance = (t) => {
          const p = predict(s, t).player,
            a = anchorPose(s.route.anchors[r.id], s.routeTime + t);
          return Math.hypot(p.x - a.x, p.y - a.y) - (r.length + r.rate * t);
        };
      if (distance(horizon) > EPS) pick(crossingTime(distance, horizon), 'capture', null);
    }
    if (s.rope) {
      const a0 = anchorPose(s.route.anchors[s.rope.id], s.routeTime),
        a1 = anchorPose(s.route.anchors[s.rope.id], s.routeTime + horizon),
        obstruction = movingRopeHit(a0, from, a1, next.player, s.route.solids);
      if (obstruction) pick(obstruction.at * horizon, 'cut', obstruction);
    }
    for (const relic of s.route.relics)
      if (!s.collected.includes(relic.id)) {
        const d = { x: next.player.x - from.x, y: next.player.y - from.y },
          o = { x: from.x - relic.x, y: from.y - relic.y };
        const times = roots(dot(d, d), 2 * dot(o, d), dot(o, o) - sq(R + 8)).filter(
          (t) => t >= 0 && t <= 1,
        );
        if (dot(o, o) <= sq(R + 8)) pick(0, 'relic', relic);
        else if (times.length) {
          const exact = curvedRelicEntry(s, horizon, relic, times[0]);
          if (exact !== null) pick(exact, 'relic', relic);
        }
      }
    next = predict(s, span);
    Object.assign(s.player, next.player);
    if (s.rope && next.rope) s.rope = next.rope;
    addWork(s, next);
    s.time += span;
    s.routeTime += span;
    remaining -= span;
    if (kind === 'solid') {
      const contacts = s.route.solids
        .map((rect) => sweepCircle(from, s.player, R, rect))
        .filter((c) => c && c.at >= 1 - 1e-5);
      if (!contacts.length) contacts.push(hit);
      const v = contactVelocity(s.player.vx, s.player.vy, contacts),
        before = (sq(s.player.vx) + sq(s.player.vy)) / 2;
      s.player.vx = v.x;
      s.player.vy = v.y;
      s.ledger.contactLoss += Math.max(0, before - (sq(v.x) + sq(v.y)) / 2);
      if (s.rope) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
      s.player.ground = !!support(s);
      if (s.player.ground) {
        const pad = support(s);
        if (!s.visited.includes(pad.id)) {
          s.visited.push(pad.id);
          s.checkpoint = pad.id;
          if (!pad.exit) {
            s.score += 100;
            env.sound('coin');
            notify(
              s,
              'Cairn reached. Stop to recharge; choose the next anchor.',
              '已到达石台，停下充电并选择下一个锚点。',
            );
          }
        }
        if (pad.exit) {
          s.score += 500;
          s.completed.push(s.route.id);
          s.rope = null;
          s.lastEvent = 'clear';
          if (s.level === 3) {
            finish(s, env, true);
            return;
          } else {
            env.sound('win');
            s.betweenRoutes = true;
            notify(
              s,
              'Route clear. Enter travels to the next reach.',
              '本路线已通过，回车前往下一段峡谷。',
            );
          }
        }
      }
    } else if (kind === 'corner-end') {
      if (s.rope) delete s.rope.corner;
    } else if (kind === 'arc-end') {
      s.contactArc = null;
    } else if (kind === 'wall-end') {
      if (s.rope) delete s.rope.wall;
      delete s.rope.corner;
    } else if (kind === 'length') setRate(s, 0);
    else if (kind === 'capture') captureNow(s);
    else if (kind === 'slack') {
      if (s.rope) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
    } else if (kind === 'battery') {
      s.charge = 0;
      setRate(s, 0);
      notify(
        s,
        'Winch depleted. Pay out, release, or rescue; cairns recharge it.',
        '绞盘电量耗尽，可放绳、松开或救援，石台可充电。',
      );
    } else if (kind === 'cut') cutRope(s, env, hit);
    else if (kind === 'water') {
      rescue(s, env);
      if (s.phase === 'playing') {
        s.recovering = Math.max(0, s.recovering - remaining);
        s.time += remaining;
        s.routeTime += remaining;
      }
      return;
    } else if (kind === 'relic') {
      s.collected.push(hit.id);
      s.score += 250;
      s.lastEvent = 'relic';
      s.flash = { x: hit.x, y: hit.y, time: 0.5, type: 'relic' };
      env.sound('coin');
    }
    if (!kind) break;
  }
  s.player.ground = !!support(s);
  if (s.flash) {
    s.flash.time -= h;
    if (s.flash.time <= 0) s.flash = null;
  }
}
function landingPreview(s) {
  const points = [],
    p = s.player;
  for (let t = 0.08; t <= 1.5; t += 0.08) {
    const q = { x: p.x + p.vx * t, y: p.y + p.vy * t + (G * t * t) / 2 };
    const from = points[points.length - 1] || p;
    let nearest = null;
    for (const rect of s.route.solids) {
      const hit = sweepCircle(from, q, R, rect);
      if (hit && (!nearest || hit.at < nearest.at)) nearest = hit;
    }
    if (nearest) {
      points.push({
        x: from.x + (q.x - from.x) * nearest.at,
        y: from.y + (q.y - from.y) * nearest.at,
        landing: nearest.ny < -0.9 && nearest.rect.kind === 'cairn',
        blocked: true,
      });
      break;
    }
    if (q.y > PHYSICS.water - R || q.x < 12 || q.x > 468) {
      points.push({ ...q, water: true });
      break;
    }
    points.push(q);
  }
  return points;
}
function draw(ctx, s, env) {
  background(ctx, ['#27384a', '#343d4c', '#283e4f'][s.level - 1]);
  const colors = [
    ['#60687a', '#746574', '#a47063'],
    ['#596779', '#6c6172', '#92745e'],
    ['#5d7183', '#746c80', '#9a7a66'],
  ][s.level - 1];
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = colors[layer];
    for (let i = 0; i < 11; i++) {
      const x = i * 53 - layer * 17,
        top = 100 + layer * 37 + Math.sin(i * 2.1 + layer) * 29;
      ctx.fillRect(x, top, 42, 220);
      ctx.fillRect(x + 6, top - 12, 25, 14);
      ctx.fillStyle = layer === 2 ? '#bc927243' : '#ffffff08';
      for (let y = top + 15; y < 300; y += 19) ctx.fillRect(x, y, 42, 2);
      ctx.fillStyle = colors[layer];
    }
  }
  ctx.fillStyle = '#344f61';
  ctx.fillRect(0, 301, 480, 19);
  ctx.strokeStyle = '#92bbc1';
  ctx.lineWidth = 1;
  for (let x = 12; x < 468; x += 19) {
    ctx.beginPath();
    ctx.moveTo(x, 306 + Math.sin(s.time * 2 + x) * 2);
    ctx.lineTo(x + 10, 306 + Math.sin(s.time * 2 + x + 1) * 2);
    ctx.stroke();
  }
  for (const r of s.route.solids) {
    if (r.kind === 'rail') {
      ctx.fillStyle = '#354b58';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#a5b9b8';
      ctx.fillRect(r.x, r.y, r.w, 2);
      for (let x = r.x + 4; x < r.x + r.w; x += 10) {
        ctx.fillStyle = '#d2a36e';
        ctx.fillRect(x, r.y + 4, 3, 3);
      }
      continue;
    }
    ctx.fillStyle = r.kind === 'cairn' ? '#8f6354' : '#725955';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#c18b67';
    ctx.fillRect(r.x, r.y, r.w, 3);
    ctx.fillStyle = '#ac785e';
    ctx.fillRect(r.x + 3, r.y + 4, Math.max(0, r.w - 6), 5);
    for (let y = r.y + 15; y < Math.min(320, r.y + r.h); y += 17) {
      ctx.fillStyle = y % 2 ? '#6f4e4b' : '#b080602a';
      ctx.fillRect(r.x, y, r.w, 2);
      for (let x = r.x + (Math.floor(y / 17) % 2) * 13; x < r.x + r.w; x += 29) {
        ctx.fillStyle = '#5f4849';
        ctx.fillRect(x, y + 2, 2, 11);
      }
    }
  }
  for (const pad of s.route.pads) {
    if (pad.exit) {
      ctx.fillStyle = '#eee0ad';
      ctx.fillRect(pad.x + pad.w - 21, pad.y - 38, 2, 38);
      ctx.fillStyle = '#7be2bc';
      ctx.beginPath();
      ctx.moveTo(pad.x + pad.w - 19, pad.y - 37);
      ctx.lineTo(pad.x + pad.w - 3, pad.y - 31);
      ctx.lineTo(pad.x + pad.w - 19, pad.y - 24);
      ctx.fill();
    } else {
      const x = pad.x + 18;
      if (s.visited.includes(pad.id)) {
        ctx.fillStyle = '#94d5bd';
        ctx.fillRect(x - 7, pad.y - 16, 18, 2);
      }
      ctx.fillStyle = '#d7c6a0';
      ctx.fillRect(x - 5, pad.y - 4, 14, 4);
      ctx.fillRect(x - 3, pad.y - 8, 10, 4);
      ctx.fillRect(x, pad.y - 12, 5, 4);
      ctx.fillStyle = '#8fe0cb';
      ctx.fillRect(x + 3, pad.y - 10, 2, 2);
    }
  }
  const target = selected(s),
    anchors = available(s);
  for (const a of anchors) {
    const source = s.route.anchors[a.id];
    ctx.strokeStyle = '#d1b58a80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, 55);
    ctx.lineTo(a.x, a.y - 8);
    ctx.stroke();
    ctx.fillStyle = '#3e5663';
    ctx.fillRect(a.x - 9, a.y - 9, 18, 18);
    ctx.strokeStyle = a.id === target?.id ? '#ffe5a3' : a.eligible ? '#a5e7da' : '#809197';
    ctx.lineWidth = a.id === target?.id ? 2 : 1;
    ctx.strokeRect(a.x - 8, a.y - 8, 16, 16);
    ctx.fillStyle = '#e0c190';
    ctx.fillRect(a.x - 3, a.y - 3, 6, 6);
    text(ctx, String(a.id + 1), a.x, a.y - 26, a.eligible ? '#fff0c6' : '#b3b9b7', 16, 'center');
    if (a.moving) {
      text(
        ctx,
        source.amplitudeX ? (a.vx >= 0 ? '→' : '←') : a.vy >= 0 ? '↓' : '↑',
        a.x + 18,
        a.y - 6,
        '#a8e5dc',
        13,
        'center',
      );
    }
  }
  for (const relic of s.route.relics)
    if (!s.collected.includes(relic.id)) {
      ctx.strokeStyle = '#eac57c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(relic.x, relic.y - 9);
      ctx.lineTo(relic.x + 7, relic.y);
      ctx.lineTo(relic.x, relic.y + 9);
      ctx.lineTo(relic.x - 7, relic.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#d7b877';
      ctx.fillRect(relic.x - 2, relic.y - 3, 4, 6);
    }
  const preview = landingPreview(s);
  for (const p of preview) {
    ctx.fillStyle = p.landing ? '#a4edc3' : p.water ? '#e5a07e' : '#e8d7af90';
    if (p.blocked || p.water) {
      ctx.strokeStyle = p.landing ? '#a4edc3' : '#f0ac8c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (p.landing) {
        ctx.moveTo(p.x - 4, p.y);
        ctx.lineTo(p.x - 1, p.y + 3);
        ctx.lineTo(p.x + 5, p.y - 4);
      } else {
        ctx.moveTo(p.x - 4, p.y - 4);
        ctx.lineTo(p.x + 4, p.y + 4);
        ctx.moveTo(p.x - 4, p.y + 4);
        ctx.lineTo(p.x + 4, p.y - 4);
      }
      ctx.stroke();
    } else ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  if (s.rope) {
    const a = anchorPose(s.route.anchors[s.rope.id], s.routeTime);
    ctx.strokeStyle = s.rope.taut ? '#ffe1a0' : '#b9c6ba';
    ctx.lineWidth = 2;
    ctx.setLineDash?.(s.rope.taut ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (!s.rope.taut) {
      const slack = Math.max(0, s.rope.length - Math.hypot(s.player.x - a.x, s.player.y - a.y));
      ctx.quadraticCurveTo(
        (a.x + s.player.x) / 2,
        (a.y + s.player.y) / 2 + Math.min(22, slack / 3),
        s.player.x,
        s.player.y,
      );
    } else ctx.lineTo(s.player.x, s.player.y);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
  const p = s.player;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#273743';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#87dbcb';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e2b874';
  ctx.fillRect(-5, -8, 10, 5);
  ctx.fillRect(-6, -5, 12, 2);
  ctx.fillStyle = '#f0d4aa';
  ctx.fillRect(-3, -2, 6, 4);
  ctx.fillStyle = '#47748a';
  ctx.fillRect(-5, 3, 4, 5);
  ctx.fillRect(1, 3, 4, 5);
  ctx.strokeStyle = '#9ddfce';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(s.rope ? -8 : -7, s.rope ? -8 : 4);
  ctx.moveTo(5, 0);
  ctx.lineTo(s.rope ? 7 : 8, s.rope ? -7 : 3);
  ctx.stroke();
  ctx.fillStyle = '#f6c781';
  ctx.fillRect(-5, 1, 10, 2);
  ctx.fillStyle = '#253441';
  ctx.fillRect(-6, 7, 5, 2);
  ctx.fillRect(1, 7, 5, 2);
  ctx.restore();
  if (s.flash) {
    ctx.strokeStyle = s.flash.type === 'cut' ? '#f3ac87' : '#c1e9c0';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        d = 9 + (0.65 - s.flash.time) * 20;
      ctx.beginPath();
      ctx.moveTo(s.flash.x + Math.cos(a) * d, s.flash.y + Math.sin(a) * d);
      ctx.lineTo(s.flash.x + Math.cos(a) * (d + 5), s.flash.y + Math.sin(a) * (d + 5));
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#192d38';
  ctx.fillRect(0, 0, 480, 30);
  text(ctx, `${s.level}/3 ${env.t(s.route.name.en, s.route.name.zh)}`, 10, 6, '#f0d49b', 14);
  text(ctx, env.t(`LIVES ${s.lives}`, `生命 ${s.lives}`), 468, 6, '#d4e9d2', 14, 'right');
  ctx.fillStyle = '#1c313bdd';
  ctx.fillRect(14, 34, 113, 60);
  text(
    ctx,
    env.t(
      `WINCH ${Math.ceil((s.charge / PHYSICS.battery) * 100)}%`,
      `绞盘${Math.ceil((s.charge / PHYSICS.battery) * 100)}%`,
    ),
    20,
    38,
    '#aedfd0',
    14,
  );
  text(
    ctx,
    s.rope
      ? env.t(
          `${s.rope.taut ? 'TAUT' : 'SLACK'} ${Math.round(s.rope.length)}`,
          `${s.rope.taut ? '受力' : '松弛'}${Math.round(s.rope.length)}`,
        )
      : env.t(
          target ? `TARGET ${target.id + 1}` : 'NO TARGET',
          target ? `锚点 ${target.id + 1}` : '暂无锚点',
        ),
    20,
    56,
    '#e6d5b2',
    14,
  );
  text(
    ctx,
    s.rope
      ? env.t(`LOAD ${(s.rope.tension / G).toFixed(1)}g`, `张力${(s.rope.tension / G).toFixed(1)}g`)
      : env.t(
          target ? `${Math.round(target.distance)}px / 238` : 'X: SELECT',
          target ? `${Math.round(target.distance)} / 238` : 'X选择',
        ),
    20,
    74,
    '#c2cfbf',
    14,
  );
  ctx.fillStyle = '#182e37d9';
  ctx.fillRect(0, 300, 480, 20);
  const prompt =
    s.lastEvent === 'cut'
      ? env.t('ROPE CUT · SPACE hook / Z rescue', '绳索已断 · 空格钩索 / Z救援')
      : s.rope
        ? env.t('↑↓ WINCH · SPACE RELEASE', '↑↓收放绳 · 空格松开')
        : s.player.ground
          ? env.t('REST TO CHARGE · SPACE HOOK', '静止充电 · 空格钩索')
          : env.t('COASTING · SPACE HOOK / Z RESCUE', '惯性飞行 · 空格钩索 / Z救援');
  text(ctx, prompt, 240, 303, '#e1d5b8', 14, 'center');
  if (s.betweenRoutes) {
    ctx.fillStyle = '#19343deb';
    ctx.fillRect(68, 116, 344, 92);
    ctx.strokeStyle = '#e4c78e';
    ctx.strokeRect(70, 118, 340, 88);
    text(ctx, env.t('ROUTE CROSSED', '本路线已通过'), 240, 130, '#f7dc9f', 20, 'center');
    text(ctx, env.t('ENTER: next reach', '回车：下一段峡谷'), 240, 171, '#c0e5ce', 16, 'center');
  }
  if (s.recovering > 0) {
    ctx.fillStyle = '#cde4d52b';
    ctx.fillRect(0, 30, 480, 256);
    text(ctx, env.t('RESCUE CAIRN', '救援石台'), 240, 144, '#e4e8c5', 15, 'center');
  }
}
export function updateGrapnelState(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 1 / 30);
  if (s.betweenRoutes) {
    if (input.pressed('Enter')) setRoute(s, s.level + 1);
    return;
  }
  const action = input.pressed('KeyZ')
    ? 'rescue'
    : input.pressed('Space')
      ? 'hook'
      : input.pressed('KeyX')
        ? 'target'
        : null;
  if (action && !s.recovering && s.pending.length < 4) s.pending.push(action);
  const controls = {
    walk: Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    reel: Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW')),
  };
  s.accumulator += dt;
  while (s.accumulator + 1e-12 >= PHYSICS.step && s.phase === 'playing' && !s.betweenRoutes) {
    s.accumulator = Math.max(0, s.accumulator - PHYSICS.step);
    if (s.pending.length && !s.recovering) {
      const next = s.pending.shift();
      if (next === 'rescue') rescue(s, env, 'rescue');
      else if (next === 'hook') hook(s, env);
      else {
        const list = available(s).filter((a) => a.eligible);
        const at = list.findIndex((a) => a.id === s.target);
        if (list.length) s.target = list[(at + 1) % list.length].id;
      }
    }
    if (s.phase !== 'playing') return;
    stepPhysics(s, PHYSICS.step, controls, env);
  }
  if (s.phase !== 'playing') return;
  if (s.phase !== 'playing' || s.betweenRoutes) {
    s.accumulator = 0;
    s.pending = [];
  }
}
export function createGame(env) {
  const s = createGrapnelState();
  return {
    update: (dt, input) => updateGrapnelState(s, dt, input, env),
    draw(ctx) {
      draw(ctx, s, env);
    },
    getState() {
      const state = structuredClone(s);
      delete state.pending;
      state.energy = (s.charge / PHYSICS.battery) * 100;
      state.anchors = available(s);
      state.platforms = structuredClone(s.route.pads);
      state.relics = s.route.relics.map((r) => ({ ...r, taken: s.collected.includes(r.id) }));
      state.landing = landingPreview(s);
      state.energyBalance =
        mechanicalEnergy(s.player) -
        s.energyBaseline -
        s.ledger.winch -
        s.ledger.anchor -
        s.ledger.ground +
        s.ledger.contactLoss +
        s.ledger.captureLoss -
        s.ledger.numerical;
      state.status = {
        en: `${s.route.name.en} ${s.level}/3 · ${s.lives} ${s.lives === 1 ? 'life' : 'lives'} · ${Math.ceil(state.energy)}% winch · ${s.notice.en}`,
        zh: `${s.route.name.zh} ${s.level}/3 · ${s.lives}生命 · 绞盘${Math.ceil(state.energy)}% · ${s.notice.zh}`,
      };
      return state;
    },
  };
}
