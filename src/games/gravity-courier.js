import { background, drawPixelText as text, clamp, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'gravity-courier',
  name: { en: 'Gravity Courier', zh: '重力信使' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Carry fragile mail through three powered-field chambers. Space reverses acceleration, never momentum: reverse near halfway to brake a landing. X collects, delivers, or repacks at the source. Later bulkheads and marked strong/weak field zones change your route and braking distance. Three spare packs allow recovery; a broken parcel without a spare ends the shift.',
    zh: '在三座动力场舱室运送易碎邮件。空格只反转加速度，不改变动量：接近半程时反向制动。X收取、交付或在起点重新包装。后续隔板及标明的强弱场区会改变路线和制动距离。共有三个备用包装；包裹破损且无备用时任务结束。',
  },
  keys: [
    { label: { en: 'Thrusters / brake', zh: '推进 / 制动' }, keys: 'A D / ← →' },
    { label: { en: 'Reverse powered field', zh: '反转动力场' }, keys: 'Space / W / ↑' },
    {
      label: { en: 'Collect / hand off / repack / next', zh: '收取 / 交付 / 重新包装 / 下一舱' },
      keys: 'X / Enter',
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '向右' } },
    { code: 'Space', label: { en: 'Reverse field', zh: '反转动力场' } },
    { code: 'KeyX', label: { en: 'Handle / Next', zh: '装卸 / 下一舱' } },
  ],
};
const HW = 10,
  HH = 12,
  LEFT = 34,
  RIGHT = 446,
  TOP = 64,
  BOTTOM = 264,
  EPS = 1e-9,
  GEOM = 1e-7;
export const COURIER_ROOMS = [
  {
    name: ['Polarity Post', '极性邮站'],
    walls: [],
    zones: [{ from: 24, to: 456, g: 180 }],
    source: { x: 64, y: BOTTOM, side: 1 },
    destination: { x: 416, y: TOP, side: -1 },
    integrity: 3,
    safeSpeed: 115,
    mass: 0.65,
  },
  {
    name: ['Bulkhead Sorting', '隔板分拣舱'],
    walls: [
      { x: 156, y: 52, w: 24, h: 144 },
      { x: 290, y: 156, w: 24, h: 120 },
    ],
    zones: [{ from: 24, to: 456, g: 180 }],
    source: { x: 64, y: BOTTOM, side: 1 },
    destination: { x: 416, y: BOTTOM, side: 1 },
    integrity: 3,
    safeSpeed: 115,
    mass: 0.65,
  },
  {
    name: ['Glass Coil Relay', '玻璃邮件中继'],
    walls: [
      { x: 164, y: 180, w: 24, h: 96 },
      { x: 300, y: 52, w: 24, h: 108 },
    ],
    zones: [
      { from: 24, to: 180, g: 150 },
      { from: 180, to: 310, g: 90 },
      { from: 310, to: 456, g: 240 },
    ],
    source: { x: 64, y: BOTTOM, side: 1 },
    destination: { x: 416, y: TOP, side: -1 },
    integrity: 2,
    safeSpeed: 90,
    mass: 0.8,
  },
];
const room = (s) => COURIER_ROOMS[s.level - 1];
const carried = (s) => s.parcel.status === 'carried';
const mass = (s) => 1 + (carried(s) ? s.parcel.mass : 0);
const axisOf = (input) =>
  Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
export function createCourierState(env, level = 1) {
  const r = COURIER_ROOMS[level - 1];
  return {
    phase: 'playing',
    mode: 'flying',
    level,
    score: 0,
    time: 0,
    gravity: 1,
    player: { x: 64, y: BOTTOM, w: 20, h: 24, vx: 0, vy: 0 },
    parcel: {
      status: 'stored',
      integrity: r.integrity,
      maxIntegrity: r.integrity,
      safeSpeed: r.safeSpeed,
      mass: r.mass,
    },
    spares: 3,
    deliveries: 0,
    repacks: 0,
    flips: 0,
    flipReadyAt: 0,
    flipIntent: null,
    interactIntent: null,
    repackLeft: 0,
    airlockLeft: 0,
    rearm: false,
    impacts: [],
    feedback: 'welcome',
    feedbackTime: 4,
    flash: 0,
  };
}
function say(s, kind, time = 2) {
  s.feedback = kind;
  s.feedbackTime = time;
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.mode = 'terminal';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t('Every fragile shipment delivered!', '所有易碎邮件均已送达！')
      : env.t(
          'No spare packaging remains. Start a new courier shift.',
          '备用包装已用完。请开始新的信使任务。',
        ),
  });
}
export function courierField(s, axis = 0) {
  const direction = Math.abs(s.player.vx) > EPS ? Math.sign(s.player.vx) : axis,
    x = s.player.x + direction * GEOM;
  return (
    room(s).zones.find((z) => x >= z.from - GEOM / 2 && x < z.to - GEOM / 2)?.g ||
    room(s).zones.at(-1).g
  );
}
function overlapsAt(value, half, lo, hi, velocity, acceleration) {
  const a = value + half - lo,
    b = hi - (value - half);
  if (a > GEOM && b > GEOM) return true;
  if (Math.abs(a) <= GEOM)
    return velocity > EPS || (Math.abs(velocity) <= EPS && acceleration > EPS);
  if (Math.abs(b) <= GEOM)
    return velocity < -EPS || (Math.abs(velocity) <= EPS && acceleration < -EPS);
  return false;
}
function constraints(s, axis, g) {
  const p = s.player,
    ax = (axis * 360 - 3 * p.vx) / mass(s),
    ay = s.gravity * g;
  let bx =
      (p.x <= LEFT + GEOM && Math.abs(p.vx) < EPS && ax < 0) ||
      (p.x >= RIGHT - GEOM && Math.abs(p.vx) < EPS && ax > 0),
    by =
      (p.y <= TOP + GEOM && Math.abs(p.vy) < EPS && ay < 0) ||
      (p.y >= BOTTOM - GEOM && Math.abs(p.vy) < EPS && ay > 0);
  for (const w of room(s).walls) {
    if (Math.abs(p.vx) < EPS && overlapsAt(p.y, HH, w.y, w.y + w.h, p.vy, ay)) {
      if (Math.abs(p.x + HW - w.x) <= GEOM && ax > 0) bx = true;
      if (Math.abs(p.x - HW - w.x - w.w) <= GEOM && ax < 0) bx = true;
    }
    if (Math.abs(p.vy) < EPS && overlapsAt(p.x, HW, w.x, w.x + w.w, p.vx, ax)) {
      if (Math.abs(p.y + HH - w.y) <= GEOM && ay > 0) by = true;
      if (Math.abs(p.y - HH - w.y - w.h) <= GEOM && ay < 0) by = true;
    }
  }
  return { bx, by };
}
function trajectory(s, axis) {
  const p = s.player,
    g = courierField(s, axis),
    c = constraints(s, axis, g),
    k = 3 / mass(s),
    terminal = axis * 120,
    ay = c.by ? 0 : s.gravity * g;
  const at = (t) => {
    const q = -Math.expm1(-k * t),
      vx = c.bx ? 0 : terminal + (p.vx - terminal) * (1 - q),
      x = c.bx ? p.x : p.x + terminal * t + ((p.vx - terminal) * q) / k;
    return {
      x,
      y: p.y + p.vy * t + (ay * t * t) / 2,
      vx,
      vy: p.vy + ay * t,
      ax: c.bx ? 0 : k * (terminal - vx),
      ay,
    };
  };
  return { at, k, terminal, ay, bx: c.bx };
}
function rootsY(p, ay, target, limit) {
  const result = [],
    d = p.y - target;
  if (Math.abs(ay) < EPS) {
    if (Math.abs(p.vy) > EPS) result.push(-d / p.vy);
    else if (Math.abs(d) < GEOM) result.push(0);
  } else {
    const discriminant = p.vy * p.vy - 2 * ay * d;
    if (discriminant >= -EPS) {
      const root = Math.sqrt(Math.max(0, discriminant));
      result.push((-p.vy - root) / ay, (-p.vy + root) / ay);
    }
  }
  return result.filter((t) => t >= -EPS && t <= limit + EPS).map((t) => clamp(t, 0, limit));
}
function rootsX(p, tr, target, limit) {
  if (tr.bx) return Math.abs(p.x - target) < GEOM ? [0] : [];
  const cuts = [0, limit];
  if (p.vx * tr.terminal < 0) {
    const zero = Math.log((p.vx - tr.terminal) / -tr.terminal) / tr.k;
    if (zero > EPS && zero < limit - EPS) cuts.splice(1, 0, zero);
  }
  const result = [];
  for (let i = 1; i < cuts.length; i++) {
    let a = cuts[i - 1],
      b = cuts[i],
      fa = tr.at(a).x - target,
      fb = tr.at(b).x - target;
    if (Math.abs(fa) < 1e-8) result.push(a);
    if (Math.abs(fb) < 1e-8) result.push(b);
    if (fa * fb < 0) {
      for (let n = 0; n < 48; n++) {
        const mid = (a + b) / 2,
          fm = tr.at(mid).x - target;
        if (fa * fm <= 0) {
          b = mid;
          fb = fm;
        } else {
          a = mid;
          fa = fm;
        }
      }
      result.push((a + b) / 2);
    }
  }
  return result.filter((t, i, a) => a.findIndex((v) => Math.abs(v - t) < EPS) === i);
}
function nextMotionEvent(s, tr, limit) {
  let time = limit,
    hits = [];
  const add = (t, hit = null) => {
    if (t < -EPS || t > limit + EPS) return;
    t = clamp(t, 0, limit);
    if (t < time - EPS) {
      time = t;
      hits = hit ? [hit] : [];
    } else if (Math.abs(t - time) <= EPS && hit) hits.push(hit);
  };
  const face = (dimension, value, nx, ny, w = null) => {
    const roots =
      dimension === 'x'
        ? rootsX(s.player, tr, value, limit)
        : rootsY(s.player, tr.ay, value, limit);
    for (const t of roots) {
      const q = tr.at(t),
        speed = -(q.vx * nx + q.vy * ny),
        force = -(q.ax * nx + q.ay * ny);
      if (speed <= EPS && !(Math.abs(speed) <= EPS && force > EPS)) continue;
      if (
        w &&
        !overlapsAt(
          dimension === 'x' ? q.y : q.x,
          dimension === 'x' ? HH : HW,
          dimension === 'x' ? w.y : w.x,
          dimension === 'x' ? w.y + w.h : w.x + w.w,
          dimension === 'x' ? q.vy : q.vx,
          dimension === 'x' ? q.ay : q.ax,
        )
      )
        continue;
      add(t, { dimension, value, nx, ny });
    }
  };
  face('x', LEFT, 1, 0);
  face('x', RIGHT, -1, 0);
  face('y', TOP, 0, 1);
  face('y', BOTTOM, 0, -1);
  for (const w of room(s).walls) {
    face('x', w.x - HW, -1, 0, w);
    face('x', w.x + w.w + HW, 1, 0, w);
    face('y', w.y - HH, 0, -1, w);
    face('y', w.y + w.h + HH, 0, 1, w);
    for (const x of [w.x - HW, w.x + w.w + HW])
      for (const t of rootsX(s.player, tr, x, limit)) if (t > EPS) add(t);
    for (const y of [w.y - HH, w.y + w.h + HH])
      for (const t of rootsY(s.player, tr.ay, y, limit)) if (t > EPS) add(t);
  }
  for (const z of room(s).zones.slice(0, -1))
    for (const t of rootsX(s.player, tr, z.to, limit)) if (t > EPS) add(t);
  return { time, hits };
}
function impact(s, hits, before, env) {
  const x = hits.some((h) => h.nx),
    y = hits.some((h) => h.ny),
    speed = Math.hypot(x ? before.vx : 0, y ? before.vy : 0);
  let damage = 0;
  if (carried(s) && s.parcel.integrity > 0 && speed > s.parcel.safeSpeed + GEOM) {
    damage = 1 + Number(speed > 2 * s.parcel.safeSpeed + GEOM);
    s.parcel.integrity = Math.max(0, s.parcel.integrity - damage);
    s.flash = 0.45;
    say(s, s.parcel.integrity ? 'damaged' : 'broken', 3);
    env.sound('hit');
  }
  if (speed > EPS)
    s.impacts.push({
      time: s.time,
      speed,
      damage,
      normals: hits.map((h) => ({ x: h.nx, y: h.ny })),
      integrity: s.parcel.integrity,
    });
  s.impacts = s.impacts.slice(-16);
  if (damage && s.parcel.integrity === 0 && s.spares === 0) finish(s, env, false);
}
function atPad(s, pad) {
  const p = s.player;
  return (
    Math.abs(p.x - pad.x) <= 22 &&
    Math.abs(p.y - pad.y) <= GEOM &&
    Math.abs(p.vx) <= 8 &&
    Math.abs(p.vy) <= EPS &&
    s.gravity === pad.side
  );
}
function interact(s, env) {
  const r = room(s),
    p = s.player;
  if (carried(s) && atPad(s, r.destination)) {
    if (!s.parcel.integrity) {
      say(s, 'return', 3);
      s.interactIntent = null;
      return;
    }
    s.parcel.status = 'delivered';
    s.score += 300 + s.parcel.integrity * 60;
    s.deliveries++;
    s.interactIntent = null;
    s.flipIntent = null;
    p.vx = 0;
    p.vy = 0;
    env.sound('win');
    if (s.level === 3) finish(s, env, true);
    else {
      s.mode = 'clear';
      say(s, 'clear', 4);
    }
    return;
  }
  if (atPad(s, r.source)) {
    if (s.parcel.status === 'stored') {
      p.vx /= 1 + s.parcel.mass;
      s.parcel.status = 'carried';
      s.interactIntent = null;
      say(s, 'carrying', 3);
      env.sound('coin');
    } else if (carried(s) && s.parcel.integrity < s.parcel.maxIntegrity) {
      if (!s.spares) {
        say(s, 'no-spare', 3);
        s.interactIntent = null;
        if (!s.parcel.integrity) finish(s, env, false);
        return;
      }
      s.spares--;
      s.mode = 'repack';
      s.repackLeft = 0.7;
      s.interactIntent = null;
      s.flipIntent = null;
      say(s, 'repack');
      env.sound('move');
    } else {
      s.interactIntent = null;
      say(s, 'loaded');
    }
  }
}
function actions(s, env) {
  if (s.mode !== 'flying') return;
  if (s.interactIntent !== null) {
    if (s.time <= s.interactIntent + EPS) interact(s, env);
    else {
      s.interactIntent = null;
      say(s, 'pad');
    }
  }
  if (s.mode !== 'flying') return;
  if (s.flipIntent !== null) {
    if (s.time > s.flipIntent + EPS) s.flipIntent = null;
    else if (s.time >= s.flipReadyAt - EPS) {
      s.gravity *= -1;
      s.flipReadyAt = s.time + 0.24;
      s.flipIntent = null;
      s.flips++;
      say(s, 'flip', 1);
      env.sound('move');
      if (s.interactIntent !== null && s.time <= s.interactIntent + EPS) interact(s, env);
    }
  }
}
function inputFrame(s, input, env) {
  if (s.rearm) {
    if (
      !input.held(
        'ArrowLeft',
        'ArrowRight',
        'KeyA',
        'KeyD',
        'Space',
        'KeyW',
        'ArrowUp',
        'KeyX',
        'Enter',
      ) &&
      !input.pressed('Space', 'KeyW', 'ArrowUp', 'KeyX', 'Enter')
    )
      s.rearm = false;
    else return;
  }
  if (s.mode === 'clear') {
    if (input.pressed('KeyX', 'Enter')) {
      s.mode = 'airlock';
      s.airlockLeft = 0.7;
      s.flipIntent = null;
      s.interactIntent = null;
      env.sound('move');
    }
    return;
  }
  if (s.mode !== 'flying') return;
  if (input.pressed('Space', 'KeyW', 'ArrowUp')) s.flipIntent = s.time + 0.22;
  if (input.pressed('KeyX', 'Enter')) s.interactIntent = s.time + 0.25;
  actions(s, env);
}
function advance(s, t) {
  s.time += t;
  s.feedbackTime = Math.max(0, s.feedbackTime - t);
  s.flash = Math.max(0, s.flash - t);
}
function nextRoom(s, env) {
  const saved = {
    score: s.score,
    time: s.time,
    spares: s.spares,
    deliveries: s.deliveries,
    repacks: s.repacks,
    flips: s.flips,
  };
  Object.assign(s, createCourierState(env, s.level + 1), saved, { rearm: true });
}
function integrate(s, dt, input, env) {
  let left = dt,
    events = 0;
  while (left > EPS && s.phase === 'playing') {
    if (++events > 100) throw new Error('Courier event loop failed to make progress');
    if (s.mode === 'clear') {
      advance(s, left);
      return;
    }
    if (s.mode === 'airlock') {
      const t = Math.min(left, s.airlockLeft);
      advance(s, t);
      s.airlockLeft -= t;
      left -= t;
      if (s.airlockLeft <= EPS) nextRoom(s, env);
      continue;
    }
    actions(s, env);
    if (s.phase !== 'playing') return;
    const axis = s.mode === 'repack' || s.rearm ? 0 : axisOf(input),
      tr = trajectory(s, axis);
    let limit = left;
    for (const t of [s.flipIntent, s.interactIntent, s.flipIntent !== null ? s.flipReadyAt : null])
      if (t !== null && t > s.time + EPS) limit = Math.min(limit, t - s.time);
    if (s.mode === 'repack') limit = Math.min(limit, s.repackLeft);
    const event = nextMotionEvent(s, tr, limit),
      t = event.time,
      q = tr.at(t);
    Object.assign(s.player, { x: q.x, y: q.y, vx: q.vx, vy: q.vy });
    advance(s, t);
    left -= t;
    if (s.mode === 'repack') {
      s.repackLeft -= t;
      if (s.repackLeft <= EPS) {
        s.repackLeft = 0;
        s.parcel.integrity = s.parcel.maxIntegrity;
        s.repacks++;
        s.mode = 'flying';
        say(s, 'repacked', 2);
        env.sound('coin');
      }
    }
    if (event.hits.length) {
      const before = { vx: s.player.vx, vy: s.player.vy };
      for (const hit of event.hits) {
        s.player[hit.dimension] = hit.value;
        if (hit.nx) s.player.vx = 0;
        if (hit.ny) s.player.vy = 0;
      }
      impact(s, event.hits, before, env);
    }
    if (s.flipIntent !== null && s.time >= s.flipIntent - EPS && s.time < s.flipReadyAt - EPS)
      s.flipIntent = null;
    if (s.interactIntent !== null && s.time >= s.interactIntent - EPS) {
      actions(s, env);
      s.interactIntent = null;
    }
    if (s.phase === 'playing') actions(s, env);
  }
}
export function stepCourier(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  inputFrame(s, input, env);
  if (s.phase !== 'playing') return;
  const duration = Math.min(dt, 1 / 30),
    count = Math.max(1, Math.ceil(duration * 240 - EPS));
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    integrate(s, duration / count, input, env);
}
export function courierLanding(s) {
  const predicted = { ...s, player: { ...s.player } },
    path = [{ x: s.player.x, y: s.player.y }];
  let elapsed = 0;
  for (let iteration = 0; iteration < 80; iteration++) {
    const tr = trajectory(predicted, 0),
      p = predicted.player;
    if (Math.abs(p.vy) <= EPS && Math.abs(tr.ay) <= EPS && Math.abs(p.vx) <= EPS)
      return { x: p.x, y: p.y, speed: 0, safe: true, kind: 'rest', time: elapsed, path };
    const turning = p.vy * tr.ay < 0 ? -p.vy / tr.ay : Infinity,
      event = nextMotionEvent(predicted, tr, Math.min(10, turning)),
      t = event.time,
      q = tr.at(t);
    for (let sample = 1; sample <= 4; sample++) {
      const at = tr.at((t * sample) / 4);
      path.push({ x: at.x, y: at.y });
    }
    elapsed += t;
    if (event.hits.length) {
      const speed = Math.hypot(
        event.hits.some((h) => h.nx) ? q.vx : 0,
        event.hits.some((h) => h.ny) ? q.vy : 0,
      );
      return {
        x: q.x,
        y: q.y,
        speed,
        safe: !carried(s) || speed <= s.parcel.safeSpeed + GEOM,
        kind: 'contact',
        time: elapsed,
        path,
      };
    }
    if (Math.abs(t - turning) <= EPS)
      return { x: q.x, y: q.y, speed: 0, safe: true, kind: 'turn', time: elapsed, path };
    Object.assign(predicted.player, { x: q.x, y: q.y, vx: q.vx, vy: q.vy });
    if (t >= 10 - EPS)
      return { x: q.x, y: q.y, speed: 0, safe: true, kind: 'coast', time: elapsed, path };
  }
  throw new Error('Courier coast forecast did not converge');
}
export function courierDockCue(s) {
  const p = s.player,
    r = room(s),
    destination = carried(s) && s.parcel.integrity > 0,
    pad = destination ? r.destination : r.source,
    near = Math.abs(p.x - pad.x) <= 36 && Math.abs(p.y - pad.y) <= 48;
  if (!near) return { near: false, ready: false, reason: 'travel' };
  let reason;
  if (Math.abs(p.x - pad.x) > 22) reason = 'align';
  else if (Math.abs(p.y - pad.y) > GEOM || Math.abs(p.vy) > EPS) reason = 'land';
  else if (s.gravity !== pad.side) reason = 'field';
  else if (Math.abs(p.vx) > 8) reason = 'slow';
  else if (destination) reason = 'deliver';
  else if (s.parcel.status === 'stored') reason = 'collect';
  else if (s.parcel.integrity < s.parcel.maxIntegrity) reason = s.spares ? 'repack' : 'no-spare';
  else reason = 'loaded';
  return {
    near: true,
    ready: ['deliver', 'collect', 'repack'].includes(reason),
    reason,
    horizontalSpeed: Math.abs(p.vx),
    fieldRequired: pad.side,
  };
}
function prompt(s, env) {
  if (s.phase === 'won') return env.t('THREE SHIPMENTS DELIVERED', '三份邮件全部送达');
  if (s.phase === 'lost') return env.t('NO SPARES · SHIFT ENDED', '备用包装耗尽 · 任务结束');
  if (s.mode === 'clear') return env.t('DELIVERED · X FOR NEXT CHAMBER', '已送达 · X前往下一舱');
  if (s.mode === 'airlock')
    return env.t('AIRLOCK TRANSFER · RELEASE KEYS', '气闸转运中 · 松开控制键');
  if (s.mode === 'repack')
    return env.t('REPACKING · ONE SPARE USED', '重新包装中 · 使用一个备用包装');
  const cue = courierDockCue(s);
  if (cue.near) {
    const labels = {
      align: ['ALIGN WITH THE PAD', '请对准装卸台'],
      field: ['POINT FIELD TOWARD THE PAD', '将动力场朝向装卸台'],
      land: ['BRAKE BEFORE RAIL CONTACT', '先制动 · 再贴靠装卸轨道'],
      slow: [
        `SLOW TO DOCK · H-SPEED ${Math.round(cue.horizontalSpeed)}`,
        `减速后装卸 · 横向速度${Math.round(cue.horizontalSpeed)}`,
      ],
      deliver: ['READY · X TO HAND OFF', '已就绪 · X交付'],
      collect: ['READY · X TO COLLECT', '已就绪 · X收取'],
      repack: ['READY · X TO REPACK', '已就绪 · X重新包装'],
      'no-spare': ['NO SPARES · PROTECT THIS PACK', '没有备用包装 · 保护当前包裹'],
      loaded: ['LOADED · HEAD TO DELIVERY', '已装载 · 前往终点'],
    };
    return env.t(...labels[cue.reason]);
  }
  if (s.parcel.integrity === 0) return env.t('BROKEN · RETURN TO SOURCE', '包裹破损 · 返回起点');
  if (s.feedbackTime > 0 && s.feedback === 'damaged') {
    const normals = s.impacts.at(-1)?.normals || [],
      horizontal = normals.some((n) => n.x),
      vertical = normals.some((n) => n.y);
    return horizontal && vertical
      ? env.t('HARD CORNER · BRAKE BOTH AXES', '转角冲击 · 两个方向都需制动')
      : horizontal
        ? env.t('WALL IMPACT · COUNTER-THRUST TO BRAKE', '撞到隔板 · 反向推进制动')
        : env.t('HARD LANDING · REVERSE FIELD EARLIER', '着陆冲击 · 提前反转动力场');
  }
  if (!carried(s)) return env.t('SOURCE PAD · STOP · X TO COLLECT', '起点装卸台 · 停稳后X收取');
  return s.level === 3
    ? env.t('GLASS MAIL · WATCH THE FIELD ZONES', '玻璃邮件 · 注意不同场强区域')
    : env.t('REVERSE NEAR MIDWAY TO BRAKE', '接近半程时反转动力场制动');
}
function lowerHint(s, env) {
  if (s.mode === 'airlock' || s.phase !== 'playing')
    return env.t('A/D THRUST · SPACE FIELD · X HANDLE', 'A/D推进 · 空格动力场 · X装卸');
  const cue = courierDockCue(s);
  if (cue.reason === 'slow')
    return env.t('RELEASE / COUNTER-THRUST · DOCK NEEDS ≤8', '松开或反向推进 · 装卸需横向速度≤8');
  if (cue.reason === 'field')
    return env.t('SPACE REVERSES ACCELERATION', '空格反转加速度 · 动量保持连续');
  if (cue.reason === 'land')
    return env.t(
      'BRAKE FIRST · FIELD INTO RAIL AFTER CONTACT',
      '先降低纵向速度 · 贴靠后再将动力场朝向轨道',
    );
  if (s.parcel.integrity === 0)
    return env.t('X AT SOURCE USES ONE SPARE PACK', '在起点按X使用一个备用包装');
  if (cue.ready) return env.t('A/D THRUST / BRAKE · SPACE FIELD', 'A/D推进和制动 · 空格反转动力场');
  return env.t('GUIDE: COAST UNDER THE CURRENT FIELD', '轨迹提示：松开推进，保持当前动力场');
}
function crate(ctx, x, y, integrity, max, glass = false) {
  ctx.fillStyle = glass ? '#7faeb9' : '#c58e57';
  ctx.fillRect(x - 6, y - 5, 12, 10);
  ctx.fillStyle = '#f1d69c';
  ctx.fillRect(x - 6, y - 5, 12, 2);
  ctx.fillStyle = '#64564b';
  ctx.fillRect(x - 1, y - 5, 2, 10);
  if (integrity < max) {
    ctx.fillStyle = '#4c3834';
    ctx.fillRect(x - 4, y - 2, 4, 2);
    ctx.fillRect(x - 2, y, 2, 3);
    if (integrity === 0) {
      ctx.fillRect(x + 1, y - 3, 2, 5);
      ctx.fillRect(x + 2, y + 1, 3, 2);
    }
  }
}
function pad(ctx, p, label, color, env) {
  const yy = p.side > 0 ? 271 : 52;
  ctx.fillStyle = '#223b43';
  ctx.fillRect(p.x - 24, p.side > 0 ? 250 : 52, 48, 26);
  ctx.fillStyle = color;
  ctx.fillRect(p.x - 24, yy, 48, 5);
  ctx.fillStyle = '#a7b7a0';
  for (const x of [-18, 12]) ctx.fillRect(p.x + x, p.side > 0 ? 265 : 57, 6, 6);
  text(ctx, label, p.x, p.side > 0 ? 236 : 83, color, 14, 'center');
}
export function drawCourier(ctx, s, env) {
  const r = room(s),
    p = s.player,
    g = courierField(s),
    landing = courierLanding(s);
  ctx.save();
  background(ctx, '#112b39');
  for (let x = 24; x < 456; x += 36) {
    ctx.fillStyle = '#193744';
    ctx.fillRect(x, 52, 1, 224);
    for (let y = 64; y < 276; y += 24) ctx.fillRect(x + 14, y, 2, 2);
  }
  for (const z of r.zones) {
    ctx.fillStyle = z.g >= 200 ? '#263c46' : z.g < 120 ? '#173e48' : '#1b3943';
    ctx.fillRect(z.from, 52, z.to - z.from, 224);
    for (let x = z.from + 26; x < z.to - 8; x += 48)
      for (let y = 106; y <= 230; y += 62) {
        ctx.fillStyle = '#43626a';
        const yy = y + (s.gravity > 0 ? 0 : 6);
        ctx.fillRect(x, yy, 2, 8);
        ctx.fillRect(x - 3, s.gravity > 0 ? yy + 5 : yy, 8, 2);
      }
  }
  for (const z of r.zones.slice(0, -1)) {
    ctx.fillStyle = '#8baec0';
    for (let y = 54; y < 276; y += 12) ctx.fillRect(z.to - 1, y, 2, 5);
  }
  for (const y of [60, 268]) {
    ctx.fillStyle = '#755f4e';
    ctx.fillRect(30, y, 420, 3);
    ctx.fillStyle = '#b68a5a';
    ctx.fillRect(30, y, 420, 1);
    for (let x = 44; x < 450; x += 52) {
      ctx.fillStyle = '#374d54';
      ctx.fillRect(x, y - 2, 5, 7);
      ctx.fillStyle = '#a68257';
      ctx.fillRect(x + 1, y - 2, 2, 7);
    }
  }
  for (const x of [39, 216, 385]) {
    ctx.fillStyle = '#203f4a';
    ctx.fillRect(x, 112, 53, 63);
    ctx.strokeStyle = '#3b5356';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 112, 53, 63);
    ctx.fillStyle = '#6b6254';
    ctx.fillRect(x + 7, 120, 37, 3);
    ctx.fillRect(x + 7, 120, 3, 44);
    ctx.fillRect(x + 7, 160, 32, 3);
    ctx.fillStyle = '#9b8059';
    ctx.fillRect(x + 8, 121, 34, 1);
    ctx.fillRect(x + 8, 161, 30, 1);
    ctx.fillStyle = '#496d6b';
    ctx.fillRect(x + 17, 133, 22, 13);
    ctx.fillStyle = '#71958a';
    ctx.fillRect(x + 20, 136, 5, 3);
    ctx.fillRect(x + 29, 141, 6, 2);
  }
  ctx.fillStyle = '#6b7776';
  ctx.fillRect(16, 44, 448, 8);
  ctx.fillRect(16, 276, 448, 8);
  ctx.fillRect(16, 44, 8, 240);
  ctx.fillRect(456, 44, 8, 240);
  ctx.fillStyle = '#b08c62';
  for (let x = 24; x < 456; x += 24) {
    ctx.fillRect(x, 44, 15, 3);
    ctx.fillRect(x + 3, 281, 15, 3);
  }
  for (const w of r.walls) {
    ctx.fillStyle = '#3b535d';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = '#9a8b70';
    ctx.fillRect(w.x, w.y, 3, w.h);
    ctx.fillRect(w.x + w.w - 3, w.y, 3, w.h);
    ctx.fillStyle = '#213741';
    for (let y = w.y + 20; y < w.y + w.h; y += 32) ctx.fillRect(w.x + 3, y, w.w - 6, 2);
    ctx.fillStyle = '#c29a60';
    ctx.fillRect(w.x + 4, w.y + 4, w.w - 8, 4);
    ctx.fillRect(w.x + 4, w.y + w.h - 8, w.w - 8, 4);
  }
  for (const z of r.zones) {
    const x = (z.from + z.to) / 2;
    ctx.fillStyle = '#284e59';
    ctx.fillRect(x - 21, 46, 42, 6);
  }
  pad(ctx, r.source, env.t('SOURCE', '起点'), '#e8bb72', env);
  pad(ctx, r.destination, env.t('DELIVER', '终点'), '#83c79d', env);
  if (s.parcel.status === 'stored')
    crate(ctx, r.source.x, r.source.y, s.parcel.integrity, s.parcel.maxIntegrity, s.level === 3);
  if (s.parcel.status === 'delivered')
    crate(
      ctx,
      r.destination.x,
      r.destination.y,
      s.parcel.integrity,
      s.parcel.maxIntegrity,
      s.level === 3,
    );
  if (carried(s)) {
    ctx.strokeStyle = landing.kind === 'turn' ? '#87b4c7' : landing.safe ? '#82b19d' : '#d2987f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const point of landing.path) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.fillStyle = landing.kind === 'turn' ? '#87b4c7' : landing.safe ? '#82b19d' : '#d2987f';
    ctx.fillRect(landing.x - 3, landing.y - 1, 6, 2);
    if (landing.kind === 'turn') ctx.fillRect(landing.x - 1, landing.y - 3, 2, 6);
  }
  pixelSprite(
    ctx,
    [
      '..cccccc..',
      '.caaaaaac.',
      'cabbwwbbac',
      'cabbwwbbac',
      '.caaaaaac.',
      'ddccccccdd',
      'ddaeeeeadd',
      'ddaeffeadd',
      '.daeeeead.',
      '..dddddd..',
      '.d......d.',
      'ddd....ddd',
    ],
    p.x - HW,
    p.y - HH,
    2,
    {
      a: '#d69e68',
      b: '#284858',
      w: '#b5d8d5',
      c: '#8ba5a4',
      d: '#577c88',
      e: '#cb8e58',
      f: '#765344',
    },
  );
  if (carried(s))
    crate(ctx, p.x, p.y + 1, s.parcel.integrity, s.parcel.maxIntegrity, s.level === 3);
  if (s.mode === 'clear' || s.mode === 'repack') {
    ctx.fillStyle = '#d8b576';
    ctx.fillRect(p.x - 13, p.y - 8, 3, 16);
    ctx.fillRect(p.x + 10, p.y - 8, 3, 16);
  }
  if (s.flash > 0) {
    ctx.strokeStyle = '#efb49a';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 13, p.y - 15, 26, 30);
  }
  ctx.fillStyle = '#102633';
  ctx.fillRect(0, 0, 480, 44);
  text(ctx, `${s.level}/3 ${env.t(...r.name)}`, 12, 7, '#e2c699', 14);
  text(ctx, env.t(`SPARES ${s.spares}`, `备用 ${s.spares}`), 468, 7, '#c9d3b7', 14, 'right');
  text(ctx, env.t('PACK', '包装'), 282, 7, '#c9d3b7', 14);
  const hp = s.parcel.status === 'stored' ? r.integrity : s.parcel.integrity;
  for (let i = 0; i < s.parcel.maxIntegrity; i++) {
    ctx.fillStyle = i < hp ? '#e1bf7a' : '#51474a';
    ctx.fillRect(330 + i * 17, 10, 13, 10);
  }
  text(ctx, `${env.t('FIELD', '动力场')} ${s.gravity > 0 ? '↓' : '↑'}${g}`, 12, 28, '#a7c9bf', 14);
  text(ctx, `${env.t('H', '横')} ${Math.round(Math.abs(p.vx))}`, 145, 28, '#b6c9bb', 14);
  text(ctx, `${env.t('V', '纵')} ${Math.round(Math.abs(p.vy))}`, 216, 28, '#b6c9bb', 14);
  ctx.fillStyle = '#2e4d53';
  ctx.fillRect(286, 31, 89, 9);
  ctx.fillStyle = Math.abs(p.vy) > s.parcel.safeSpeed ? '#d49c7e' : '#7fb29a';
  ctx.fillRect(286, 31, 89 * Math.min(1, Math.abs(p.vy) / 300), 9);
  ctx.fillStyle = '#f3ddad';
  ctx.fillRect(286 + (89 * s.parcel.safeSpeed) / 300, 29, 2, 13);
  text(ctx, `${env.t('SAFE', '安全')}≤${s.parcel.safeSpeed}`, 468, 28, '#c9d3b7', 14, 'right');
  ctx.fillStyle = '#102633';
  ctx.fillRect(0, 285, 480, 35);
  text(ctx, prompt(s, env), 240, 288, '#d8d8b8', 14, 'center');
  text(ctx, lowerHint(s, env), 240, 305, '#a9c2b8', 14, 'center');
  if (s.mode === 'airlock') {
    ctx.fillStyle = '#152e3e';
    ctx.fillRect(24, 52, 432, 224);
    text(ctx, env.t('AIRLOCK TRANSFER', '气闸转运'), 240, 151, '#e3c699', 16, 'center');
  }
  ctx.restore();
}
export function createGame(env) {
  const s = createCourierState(env);
  return {
    update: (dt, input) => stepCourier(s, dt, input, env),
    draw: (ctx) => drawCourier(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      fieldStrength: courierField(s),
      fieldAcceleration: s.gravity * courierField(s),
      flipCooldown: Math.max(0, s.flipReadyAt - s.time),
      walls: room(s).walls.map((w) => ({ ...w })),
      zones: room(s).zones.map((z) => ({ ...z })),
      source: { ...room(s).source },
      destination: { ...room(s).destination },
      landing: courierLanding(s),
      docking: courierDockCue(s),
      status: {
        en: `Chamber ${s.level}/3 · ${prompt(s, { t: (en) => en })}`,
        zh: `舱室 ${s.level}/3 · ${prompt(s, { t: (_, zh) => zh })}`,
      },
    }),
  };
}
