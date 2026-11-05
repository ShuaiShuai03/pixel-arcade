import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'clockwork-bridge',
  name: { en: 'Clockwork Bridge', zh: '发条桥梁' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Escape three clockwork machines. Stand near a brass gear and press X to turn it: linked rods slide ferries, lift decks and presses at a finite speed, and decks carry you along. Take the key with Z, carry it across, then press Z at the locked exit door. A press that meets you or a key simply jams, so wait in the marked safe spots. Falling into the pit costs a life and rewinds the machine.',
    zh: '逃出三台发条机器。靠近黄铜齿轮按X转动它：连杆会以有限速度推动渡台、升降台和压板，台面会带着你移动。按Z拿起钥匙，带过去后在上锁的出口门前再按Z开锁。压板碰到你或钥匙时只会卡住，请在标记的安全点等待。坠入深坑会失去一条命，并让机器复位。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / Left Right' },
    {
      label: { en: 'Jump (buffered, short edge grace)', zh: '跳跃（有缓冲和边缘宽限）' },
      keys: 'Space',
    },
    { label: { en: 'Turn the nearby gear', zh: '转动附近的齿轮' }, keys: 'X' },
    { label: { en: 'Take, drop or use a key', zh: '拿起、放下或使用钥匙' }, keys: 'Z' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Jump', '跳跃', 'right'],
    ['KeyX', 'Gear', '转齿轮', 'right'],
    ['KeyZ', 'Key', '钥匙', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

const STEP = 1 / 240,
  MAX_DT = 0.1,
  GRAVITY = 720,
  JUMP_SPEED = 260,
  RUN_SPEED = 80,
  GROUND_ACCEL = 1100,
  AIR_ACCEL = 500,
  MAX_FALL = 420,
  COYOTE = 0.1,
  BUFFER = 0.12,
  GEAR_REACH = 40,
  KEY_REACH = 30,
  DOOR_REACH = 40,
  DEATH_Y = 345,
  LIVES = 5,
  EPS = 1e-6,
  SUPPORT_TOL = 1e-4,
  SLIDE_SPEED = 60,
  MESSAGE_TIME = 2.4,
  MAX_FX = 48,
  CLEAR_SCORE = 1000,
  UNLOCK_SCORE = 200,
  LIFE_SCORE = 100,
  PW = 14,
  PH = 20,
  KEY_SIZE = 12,
  SPRITE_SCALE = 2;
const WALLS = [
  { x: -40, y: -400, w: 40, h: 1000, style: 'wall' },
  { x: 480, y: -400, w: 40, h: 1000, style: 'wall' },
  { x: 0, y: -40, w: 480, h: 40, style: 'wall' },
];

const bridge = (id, kind, w, h, ax, ay, bx, by, rate) => ({
  id,
  kind,
  w,
  h,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  rate,
});
const gear = (id, x, y, drives) => ({ id, x, y, r: 9, drives });
const block = (x, y, w, h, style = 'stone') => ({ x, y, w, h, style });

const MACHINES = [
  {
    name: { en: 'Boiler Gate', zh: '锅炉闸门' },
    hint: {
      en: 'Crank, ride the ferry, take the key to the door.',
      zh: '转动齿轮，乘渡台过坑，把钥匙带到门前。',
    },
    theme: { bg: '#1c1713', brick: '#2b221b', wall: '#5a4a3b', glow: '#ff7a2e', gear: '#3a2c20' },
    spawn: { x: 24, y: 230 },
    solids: [block(0, 250, 150, 70), block(330, 250, 150, 70), block(380, 236, 24, 14, 'crate')],
    bridges: [bridge(0, 'slide', 64, 10, 150, 250, 266, 250, 0.4)],
    gears: [gear(0, 136, 236, [[0, 0]]), gear(1, 344, 236, [[0, 0]])],
    keys: [{ x: 50, y: 238 }],
    door: { x: 436, y: 226, w: 20, h: 24 },
    pads: [{ x: 4, y: 250, w: 100 }],
  },
  {
    name: { en: 'Piston Hall', zh: '活塞大厅' },
    hint: {
      en: 'Ride the lift up. The top gear moves it too.',
      zh: '乘升降台上行；上层齿轮同时驱动升降台。',
    },
    theme: { bg: '#10202b', brick: '#182f3d', wall: '#46606e', glow: '#46c8ff', gear: '#1e3a4a' },
    spawn: { x: 20, y: 240 },
    solids: [block(0, 260, 110, 60), block(170, 170, 90, 150), block(400, 170, 80, 150)],
    bridges: [
      bridge(0, 'lift', 60, 10, 110, 260, 110, 178, 0.4),
      bridge(1, 'slide', 60, 10, 260, 170, 340, 170, 0.35),
    ],
    gears: [
      gear(0, 98, 246, [[0, 0]]),
      gear(1, 182, 156, [[0, 0]]),
      gear(2, 250, 156, [
        [1, 0],
        [0, 0],
      ]),
      gear(3, 410, 156, [[1, 0]]),
    ],
    keys: [{ x: 40, y: 248 }],
    door: { x: 446, y: 146, w: 20, h: 24 },
    pads: [
      { x: 4, y: 260, w: 100 },
      { x: 176, y: 170, w: 78 },
      { x: 406, y: 170, w: 40 },
    ],
  },
  {
    name: { en: 'Master Clockwork', zh: '主发条室' },
    hint: {
      en: 'Wait in the safe nook when the press is down.',
      zh: '压板落下时，在安全角落等待。',
    },
    theme: { bg: '#1b1530', brick: '#291f45', wall: '#5d4c80', glow: '#ffd24a', gear: '#352a58' },
    spawn: { x: 16, y: 240 },
    solids: [
      block(0, 260, 100, 60),
      block(246, 260, 80, 60),
      block(386, 150, 94, 170),
      block(410, 136, 24, 14, 'crate'),
    ],
    bridges: [
      bridge(0, 'slide', 56, 10, 100, 260, 190, 260, 0.5),
      bridge(1, 'lift', 60, 10, 326, 260, 326, 158, 0.4),
      bridge(2, 'press', 52, 16, 264, 196, 264, 238, 0.5),
    ],
    gears: [
      gear(0, 90, 246, [[0, 0]]),
      gear(1, 252, 246, [
        [1, 0],
        [2, 0],
      ]),
      gear(2, 322, 246, [
        [1, 0],
        [2, 0],
      ]),
      gear(3, 394, 136, [
        [1, 0],
        [2, 0],
      ]),
    ],
    keys: [{ x: 34, y: 248 }],
    door: { x: 450, y: 126, w: 20, h: 24 },
    pads: [
      { x: 4, y: 260, w: 90 },
      { x: 246, y: 260, w: 16 },
      { x: 390, y: 150, w: 16 },
    ],
  },
];

const rectOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
const overlaps = (a, b) =>
  a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
const centerOf = (o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
const gap2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clampSpan = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (v, target, d) => (v < target ? Math.min(target, v + d) : Math.max(target, v - d));
const bridgeAt = (b, p) => ({
  x: b.a.x + (b.b.x - b.a.x) * p,
  y: b.a.y + (b.b.y - b.a.y) * p,
});

function groupRoots(bridges, gears) {
  const parent = bridges.map((b) => b.id);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const g of gears) {
    for (const d of g.drives) parent[find(d[0])] = find(g.drives[0][0]);
  }
  return bridges.map((b) => find(b.id));
}

function retarget(s) {
  for (const b of s.bridges) {
    let t = 0;
    for (const g of s.gears) for (const d of g.drives) if (d[0] === b.id) t ^= g.state ^ d[1];
    b.target = t;
  }
}

function loadMachine(s, index, gearStates = []) {
  const m = MACHINES[index];
  s.machine = index;
  s.level = index + 1;
  s.solids = [...WALLS, ...m.solids].map((o) => ({ ...o }));
  s.gears = m.gears.map((g) => ({
    ...g,
    drives: g.drives.map((d) => [...d]),
    state: gearStates[g.id] ? 1 : 0,
  }));
  s.bridges = m.bridges.map((b) => ({
    ...b,
    a: { ...b.a },
    b: { ...b.b },
    p: 0,
    target: 0,
    x: b.a.x,
    y: b.a.y,
    vx: 0,
    vy: 0,
    jam: '',
  }));
  retarget(s);
  const roots = groupRoots(s.bridges, s.gears);
  for (const b of s.bridges) {
    b.group = roots[b.id];
    b.p = b.target;
    Object.assign(b, bridgeAt(b, b.p));
  }
  s.keys = m.keys.map((k, id) => ({
    id,
    x: k.x,
    y: k.y,
    w: KEY_SIZE,
    h: KEY_SIZE,
    state: 'floor',
    on: -1,
  }));
  s.door = { ...m.door, locked: true };
  s.pads = m.pads.map((o) => ({ ...o }));
  s.player = {
    x: m.spawn.x,
    y: m.spawn.y,
    w: PW,
    h: PH,
    vx: 0,
    vy: 0,
    grounded: true,
    ground: -1,
    coyote: 0,
    jumpBuffer: 0,
    facing: 1,
  };
  s.latch = { crank: false, key: false };
  s.fx = [];
}

export function createMachine(index = 0, gearStates = []) {
  const s = {
    phase: 'playing',
    score: 0,
    lives: LIVES,
    cleared: 0,
    time: 0,
    acc: 0,
    seed: 7,
    message: null,
    gearSpin: 0,
    stats: {
      jumps: 0,
      cranks: 0,
      jams: 0,
      falls: 0,
      picks: 0,
      drops: 0,
      unlocks: 0,
      landings: 0,
      edgeExits: 0,
      rejected: 0,
    },
  };
  loadMachine(s, index, gearStates);
  return s;
}

function say(s, en, zh) {
  s.message = { en, zh, t: MESSAGE_TIME };
}

function spawnFx(s, kind, x, y, count = 4) {
  for (let n = 0; n < count; n++) {
    s.seed = (Math.imul(1664525, s.seed) + 1013904223) >>> 0;
    const r = s.seed / 4294967296;
    s.fx.push({ kind, x, y, vx: (r - 0.5) * 60, vy: -10 - r * 40, t: 0.45 });
  }
  if (s.fx.length > MAX_FX) s.fx.splice(0, s.fx.length - MAX_FX);
}

function allRects(s) {
  return [
    ...s.solids.map((o) => ({ ...rectOf(o), id: -1 })),
    ...s.bridges.map((b) => ({ ...rectOf(b), id: b.id })),
  ];
}

function supportOf(s) {
  const p = s.player,
    feet = p.y + p.h;
  let best = null;
  for (const r of allRects(s)) {
    const gap = Math.abs(r.y - feet);
    if (gap > SUPPORT_TOL || p.x >= r.x + r.w - EPS || p.x + p.w <= r.x + EPS) continue;
    const mid = p.x + p.w / 2,
      centered = mid >= r.x && mid <= r.x + r.w,
      tip = centered ? 0 : mid < r.x ? -1 : 1;
    const better =
      !best ||
      (centered && best.tip !== 0) ||
      (centered === (best.tip === 0) && (gap < best.gap || (gap === best.gap && r.id >= 0)));
    if (better) best = { id: r.id, gap, tip, rect: r };
  }
  return best;
}

function tryMoveGroup(s, group, h) {
  const moves = group.map((b) => {
    const np = approach(b.p, b.target, b.rate * h),
      pos = bridgeAt(b, np);
    return { b, np, pos, dx: pos.x - b.x, dy: pos.y - b.y };
  });
  const next = new Map(s.bridges.map((b) => [b.id, rectOf(b)]));
  for (const m of moves) next.set(m.b.id, { ...rectOf(m.b), ...m.pos });
  const p = s.player,
    ride = p.grounded ? moves.find((m) => m.b.id === p.ground) : null,
    body = { ...rectOf(p) };
  if (ride) {
    body.x += ride.dx;
    body.y += ride.dy;
  }
  let landing = null;
  if (!ride) {
    for (const m of moves) {
      const r = next.get(m.b.id),
        feet = p.y + p.h;
      if (
        m.dy < 0 &&
        feet <= m.b.y + EPS &&
        feet > r.y + EPS &&
        body.x < r.x + r.w - EPS &&
        body.x + body.w > r.x + EPS
      ) {
        body.y = r.y - p.h;
        landing = m;
      }
    }
  }
  let cause = '';
  const blockers = [...s.solids, ...[...next.values()]];
  if (blockers.some((r) => overlaps(body, r))) cause = 'player';
  const carriedKeys = [];
  for (const k of s.keys) {
    if (k.state !== 'floor') continue;
    const m = moves.find((q) => q.b.id === k.on),
      kr = m ? { ...rectOf(k), x: k.x + m.dx, y: k.y + m.dy } : rectOf(k);
    if (m) carriedKeys.push([k, m]);
    if (!cause && blockers.some((r) => overlaps(kr, r))) cause = 'key';
  }
  for (const m of moves) {
    const r = next.get(m.b.id);
    const hitsSolid = s.solids.some((o) => overlaps(r, o));
    const hitsBridge = s.bridges.some((o) => o.id !== m.b.id && overlaps(r, next.get(o.id)));
    if (!cause && (hitsSolid || hitsBridge)) cause = 'solid';
  }
  if (cause) {
    if (moves.some((m) => !m.b.jam)) {
      s.stats.jams++;
      say(s, 'Gear jammed: something is in the way', '齿轮卡住：有东西挡路');
      const lead = moves[0].b;
      spawnFx(s, 'spark', lead.x + lead.w / 2, lead.y + lead.h / 2, 6);
    }
    for (const m of moves) m.b.jam = cause;
    return;
  }
  for (const m of moves) {
    m.b.p = m.np;
    m.b.x = m.pos.x;
    m.b.y = m.pos.y;
    m.b.vx = m.dx / h;
    m.b.vy = m.dy / h;
    m.b.jam = '';
  }
  if (ride) Object.assign(p, { x: body.x, y: body.y });
  if (landing) {
    Object.assign(p, { y: body.y, grounded: true, ground: landing.b.id, vy: 0, coyote: 0 });
    p.vx -= landing.b.vx;
  }
  for (const [k, m] of carriedKeys) {
    k.x += m.dx;
    k.y += m.dy;
  }
}

function moveBridges(s, h) {
  const groups = new Map();
  for (const b of s.bridges) {
    b.vx = 0;
    b.vy = 0;
    if (Math.abs(b.p - b.target) < 1e-9) {
      if (b.p !== b.target) {
        b.p = b.target;
        Object.assign(b, bridgeAt(b, b.p));
      }
      b.jam = '';
      continue;
    }
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(b);
  }
  for (const group of groups.values()) tryMoveGroup(s, group, h);
}

function moveX(s, dx) {
  const p = s.player;
  let allowed = dx;
  for (const r of allRects(s)) {
    if (p.y >= r.y + r.h - EPS || p.y + p.h <= r.y + EPS) continue;
    if (dx > 0) {
      const gap = r.x - (p.x + p.w);
      if (gap >= -EPS && gap < allowed) allowed = Math.max(gap, 0);
    } else {
      const gap = r.x + r.w - p.x;
      if (gap <= EPS && gap > allowed) allowed = Math.min(gap, 0);
    }
  }
  if (allowed !== dx) p.vx = 0;
  p.x += allowed;
}

function moveY(s, dy) {
  const p = s.player;
  let allowed = dy,
    hit = null;
  for (const r of allRects(s)) {
    if (p.x >= r.x + r.w - EPS || p.x + p.w <= r.x + EPS) continue;
    if (dy > 0) {
      const gap = r.y - (p.y + p.h);
      if (gap >= -EPS && gap < allowed) {
        allowed = Math.max(gap, 0);
        hit = r;
      }
    } else {
      const gap = r.y + r.h - p.y;
      if (gap <= EPS && gap > allowed) {
        allowed = Math.min(gap, 0);
        hit = r;
      }
    }
  }
  p.y += allowed;
  if (!hit) return;
  if (dy < 0) {
    p.vy = 0;
    return;
  }
  const b = s.bridges.find((q) => q.id === hit.id);
  s.stats.landings++;
  if (p.vy > 140) spawnFx(s, 'dust', p.x + p.w / 2, p.y + p.h, 3);
  Object.assign(p, { grounded: true, ground: hit.id, vy: 0, coyote: 0 });
  if (b) p.vx -= b.vx;
}

function movePlayer(s, h, dir) {
  const p = s.player;
  let sup = null;
  if (p.grounded) {
    sup = supportOf(s);
    if (sup) {
      p.ground = sup.id;
      p.vy = 0;
    } else {
      const b = s.bridges.find((q) => q.id === p.ground);
      if (b) {
        p.vx += b.vx;
        p.vy += b.vy;
      }
      Object.assign(p, { grounded: false, ground: null, coyote: COYOTE });
      s.stats.edgeExits++;
    }
  }
  if (dir) p.facing = dir;
  if (p.grounded) {
    p.vx = approach(p.vx, dir * RUN_SPEED, GROUND_ACCEL * h);
    if (sup && sup.tip) p.vx = sup.tip * SLIDE_SPEED;
  } else if (dir && dir * p.vx < RUN_SPEED) {
    p.vx += dir * AIR_ACCEL * h;
    if (dir * p.vx > RUN_SPEED) p.vx = dir * RUN_SPEED;
  }
  if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0)) {
    const b = p.grounded ? s.bridges.find((q) => q.id === p.ground) : null;
    if (b) p.vx += b.vx;
    p.vy = -JUMP_SPEED + (b ? b.vy : 0);
    Object.assign(p, { grounded: false, ground: null, jumpBuffer: 0, coyote: 0 });
    s.stats.jumps++;
  }
  if (!p.grounded) p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * h);
  moveX(s, p.vx * h);
  if (!p.grounded) moveY(s, p.vy * h);
}

function operateGear(s) {
  const c = centerOf(s.player);
  let best = null,
    bestD = GEAR_REACH;
  for (const g of s.gears) {
    const d = gap2(c, g);
    if (d <= bestD) [best, bestD] = [g, d];
  }
  if (!best) {
    s.stats.rejected++;
    say(s, 'No gear in reach: move next to one', '够不到齿轮：请靠近一个');
    return;
  }
  best.state ^= 1;
  retarget(s);
  s.stats.cranks++;
  s.gearSpin = 0.5;
  spawnFx(s, 'steam', best.x, best.y - 8, 4);
}

function keyAction(s) {
  const p = s.player,
    c = centerOf(p),
    carried = s.keys.find((k) => k.state === 'carried');
  if (carried) {
    if (s.door.locked && gap2(c, centerOf(s.door)) <= DOOR_REACH) {
      s.door.locked = false;
      carried.state = 'used';
      s.stats.unlocks++;
      say(s, 'Door unlocked: walk in', '门已解锁：走进去');
      spawnFx(s, 'spark', s.door.x + s.door.w / 2, s.door.y + 8, 8);
    } else if (!p.grounded) {
      s.stats.rejected++;
      say(s, 'Drop keys on solid ground', '请在稳固地面上放下钥匙');
    } else {
      const sup = supportOf(s),
        x = sup ? clampSpan(c.x - KEY_SIZE / 2, sup.rect.x, sup.rect.x + sup.rect.w - KEY_SIZE) : 0,
        spot = { x, y: p.y + p.h - KEY_SIZE, w: KEY_SIZE, h: KEY_SIZE };
      if (!sup || allRects(s).some((r) => overlaps(spot, r))) {
        s.stats.rejected++;
        say(s, 'No room to drop the key here', '这里放不下钥匙');
      } else {
        Object.assign(carried, { state: 'floor', x: spot.x, y: spot.y, on: sup.id });
        s.stats.drops++;
        say(s, 'Key dropped', '钥匙已放下');
      }
    }
    return;
  }
  let best = null,
    bestD = KEY_REACH;
  for (const k of s.keys) {
    const d = k.state === 'floor' ? gap2(c, centerOf(k)) : Infinity;
    if (d <= bestD) [best, bestD] = [k, d];
  }
  if (best) {
    Object.assign(best, { state: 'carried', on: null });
    s.stats.picks++;
    say(s, 'Key taken', '已拿起钥匙');
  } else {
    s.stats.rejected++;
    say(s, 'Nothing to take here', '这里没有可拿的东西');
  }
}

function rewind(s) {
  s.lives -= 1;
  s.stats.falls++;
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  loadMachine(s, s.machine);
  say(s, 'You fell: machine rewound', '你坠落了：机器已复位');
}

function clearMachine(s) {
  s.cleared++;
  s.score += CLEAR_SCORE + UNLOCK_SCORE;
  if (s.machine + 1 >= MACHINES.length) {
    s.score += s.lives * LIFE_SCORE;
    s.phase = 'won';
    return;
  }
  loadMachine(s, s.machine + 1);
  say(s, 'Machine escaped', '成功逃出一台机器');
}

function substep(s, dir) {
  const h = STEP,
    p = s.player;
  s.time += h;
  p.jumpBuffer = Math.max(0, p.jumpBuffer - h);
  if (!p.grounded) p.coyote = Math.max(0, p.coyote - h);
  s.gearSpin = Math.max(0, s.gearSpin - h);
  if (s.message && (s.message.t -= h) <= 0) s.message = null;
  for (const f of s.fx) {
    f.t -= h;
    f.x += f.vx * h;
    f.y += f.vy * h;
    f.vy += (f.kind === 'spark' ? 200 : -10) * h;
  }
  s.fx = s.fx.filter((f) => f.t > 0);
  if (s.latch.crank) operateGear(s);
  if (s.latch.key) keyAction(s);
  s.latch.crank = s.latch.key = false;
  moveBridges(s, h);
  movePlayer(s, h, dir);
  if (p.y > DEATH_Y) rewind(s);
  else if (!s.door.locked && overlaps(p, s.door)) clearMachine(s);
}

export function stepMachine(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_DT) return false;
  if (input.pressed('Space', 'ArrowUp', 'KeyW')) s.player.jumpBuffer = BUFFER;
  if (input.pressed('KeyX')) s.latch.crank = true;
  if (input.pressed('KeyZ')) s.latch.key = true;
  const dir =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) substep(s, dir);
  return true;
}

function nearestGear(s) {
  const c = centerOf(s.player);
  let best = null,
    bestD = GEAR_REACH;
  for (const g of s.gears) {
    const d = gap2(c, g);
    if (d <= bestD) [best, bestD] = [g, d];
  }
  return best;
}

function bridgePhase(b) {
  if (b.jam) return 'jammed';
  if (Math.abs(b.p - b.target) > 1e-9) return 'moving';
  return b.p < 0.5 ? 'retracted' : 'extended';
}

export function createGame(env) {
  const s = createMachine(0);
  let ended = false;
  return {
    update(dt, input) {
      if (s.phase !== 'playing') return;
      const before = { ...s.stats, score: s.score, cleared: s.cleared };
      if (!stepMachine(s, dt, input)) return;
      const st = s.stats;
      if (st.falls > before.falls || st.jams > before.jams) env.sound('hit');
      else if (s.cleared > before.cleared || st.picks > before.picks || st.unlocks > before.unlocks)
        env.sound('coin');
      else if (st.jumps > before.jumps || st.cranks > before.cranks || st.drops > before.drops)
        env.sound('move');
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.sound(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t('You escaped all three clockwork machines!', '你逃出了全部三台发条机器！')
            : env.t('The machines swallowed you. Try again.', '机器吞没了你。再试一次。'),
        });
      }
    },
    draw(ctx) {
      drawMachine(ctx, s, env);
    },
    getState() {
      const gearNear = s.phase === 'playing' ? nearestGear(s) : null,
        carried = s.keys.find((k) => k.state === 'carried');
      const m = MACHINES[s.machine],
        phases = s.bridges.map(bridgePhase);
      return {
        ...structuredClone(s),
        bridges: s.bridges.map((b, i) => ({ ...structuredClone(b), phase: phases[i] })),
        nearGear: gearNear ? gearNear.id : null,
        carryingKey: Boolean(carried),
        machineName: m.name,
        jumpEnvelope: {
          speed: JUMP_SPEED,
          gravity: GRAVITY,
          height: (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY),
          runSpeed: RUN_SPEED,
          gearReach: GEAR_REACH,
        },
        status: {
          en: `Machine ${s.level}/3 ${m.name.en} · Lives ${s.lives} · ${carried ? 'Key carried' : 'No key'} · ${m.hint.en}`,
          zh: `机器 ${s.level}/3 ${m.name.zh} · 生命 ${s.lives} · ${carried ? '携带钥匙' : '无钥匙'} · ${m.hint.zh}`,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BRASS = '#d9a441',
  BRASS_LIGHT = '#f6d27a',
  BRASS_DARK = '#7a5420',
  INK = '#150f0b';
const COAT_PALETTE = {
  o: '#150f0b',
  h: '#c8923a',
  H: '#f0c765',
  s: '#f0c2a0',
  g: '#9fe3ff',
  b: '#3b6ea5',
  B: '#27496f',
  k: '#7a4a24',
  w: '#d4dbe0',
};
const BODY_TOP = ['..ooo..', '.ohHho.', 'ohhhhho', 'oggsggo', '.ossso.', 'obbkbbo', 'owbbbwo'];
const LEGS = {
  stand: ['.oBoBo.', '.okoko.', '.oo.oo.'],
  runA: ['.oBoBo.', 'okoo.o.', 'ooo.oo.'],
  runB: ['.oBoBo.', '.o.ooko', '.oo.ooo'],
  jump: ['oBo.oBo', 'oko.oko', 'ooo.ooo'],
};
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
const SPRITES = Object.fromEntries(
  Object.entries(LEGS).flatMap(([name, legs]) => [
    [`${name}R`, [...BODY_TOP, ...legs]],
    [`${name}L`, mirror([...BODY_TOP, ...legs])],
  ]),
);
export const PLAYER_SPRITES = SPRITES;
const KEY_SPRITE = ['.yyy..', 'y...y.', 'y...y.', '.yyy..', '..y...', '..yy..'];
const HEART = ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'];

function fillRect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function drawGear(ctx, x, y, r, angle, body, light, teeth = 8) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = body;
  for (let i = 0; i < teeth; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / teeth);
    ctx.fillRect(-2, -r - 3, 4, 5);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.fillRect(-1, -r + 2, 2, r - 2);
  ctx.fillRect(-r + 2, -1, r - 2, 2);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, r / 4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackdrop(ctx, s) {
  const t = MACHINES[s.machine].theme;
  background(ctx, t.bg);
  for (let y = 0; y < 320; y += 16) {
    fillRect(ctx, t.brick, 0, y, 480, 1);
    for (let x = (y / 16) % 2 ? 0 : 16; x < 480; x += 32) fillRect(ctx, t.brick, x, y, 1, 16);
  }
  for (const [x, y, r, dir] of [
    [70, 150, 64, 1],
    [150, 120, 40, -1],
    [300, 130, 52, 1],
    [430, 80, 44, -1],
  ]) {
    drawGear(ctx, x, y, r, dir * s.time * 0.2 + x, t.gear, t.brick, 12);
  }
  for (let x = 0; x < 480; x += 12) {
    const flick = 4 + ((x * 7 + Math.floor(s.time * 8)) % 7);
    fillRect(ctx, '#2a0e08', x, 312 - flick, 12, 8 + flick);
    fillRect(ctx, t.glow, x + 2, 316 - (flick >> 1), 8, 4 + (flick >> 1));
  }
}

function drawSolid(ctx, o, theme) {
  if (o.style === 'wall') return;
  const crate = o.style === 'crate';
  fillRect(ctx, crate ? '#6a4a2a' : theme.wall, o.x, o.y, o.w, o.h);
  fillRect(ctx, crate ? '#a8783e' : '#9a8a78', o.x, o.y, o.w, 3);
  fillRect(ctx, INK, o.x, o.y + o.h - 1, o.w, 1);
  fillRect(ctx, 'rgba(0,0,0,0.25)', o.x + o.w - 3, o.y + 3, 3, Math.max(0, o.h - 3));
  for (let x = o.x + 6; x < o.x + o.w - 3; x += 16) {
    fillRect(ctx, BRASS, x, o.y + 6, 2, 2);
    if (o.h > 30) fillRect(ctx, BRASS_DARK, x, o.y + 22, 2, 2);
  }
  if (crate) {
    fillRect(ctx, INK, o.x + 2, o.y + 2, o.w - 4, 1);
    fillRect(ctx, INK, o.x + 2, o.y + o.h - 3, o.w - 4, 1);
  }
}

const bridgeLetter = (id) => String.fromCharCode(65 + id);

// Each gear-to-bridge link gets its own overhead lane so rods never overlap.
function linkLanes(s) {
  const links = [];
  for (const g of s.gears) for (const [id] of g.drives) links.push([g, s.bridges[id]]);
  return links.map(([g, b], n) => ({ g, b, lane: 28 + n * 8 }));
}

function drawRod(ctx, x, y, w, h, offset, horizontal) {
  fillRect(
    ctx,
    INK,
    x - (horizontal ? 0 : 1),
    y - (horizontal ? 1 : 0),
    w + (horizontal ? 0 : 2),
    h + (horizontal ? 2 : 0),
  );
  fillRect(ctx, BRASS_DARK, x, y, w, h);
  const len = horizontal ? w : h;
  for (let d = ((offset % 12) + 12) % 12; d < len; d += 12) {
    if (horizontal) fillRect(ctx, BRASS_LIGHT, x + d, y, 6, h);
    else fillRect(ctx, BRASS_LIGHT, x, y + d, w, 6);
  }
}

function drawLinkage(ctx, s) {
  for (const { g, b, lane } of linkLanes(s)) {
    const tx = Math.round(b.x + b.w / 2),
      move = b.p * 96 * (g.drives.find((d) => d[0] === b.id)[1] ? -1 : 1),
      x0 = Math.min(g.x, tx),
      x1 = Math.max(g.x, tx);
    drawRod(ctx, g.x - 1, lane, 3, g.y - lane, move, false);
    drawRod(ctx, x0, lane - 1, x1 - x0 + 1, 3, g.x < tx ? move : -move, true);
    drawRod(ctx, tx - 1, lane, 3, b.y - lane, 0, false);
    for (const [px, py] of [
      [g.x, lane],
      [tx, lane],
    ]) {
      fillRect(ctx, INK, px - 4, py - 4, 8, 8);
      fillRect(ctx, BRASS, px - 3, py - 3, 6, 6);
      fillRect(ctx, BRASS_LIGHT, px - 1, py - 1, 2, 2);
    }
    fillRect(ctx, INK, tx - 5, b.y - 3, 10, 3);
    fillRect(ctx, BRASS_LIGHT, tx - 4, b.y - 3, 8, 2);
  }
}

function drawBridge(ctx, s, b) {
  const moving = bridgePhase(b) === 'moving',
    x = Math.round(b.x),
    y = Math.round(b.y);
  const a = bridgeAt(b, 0),
    z = bridgeAt(b, 1);
  fillRect(
    ctx,
    'rgba(0,0,0,0.35)',
    Math.min(a.x, z.x),
    Math.min(a.y, z.y) + b.h - 2,
    Math.abs(z.x - a.x) + b.w,
    2,
  );
  if (b.kind === 'press') {
    const floor = s.solids.find(
      (o) => o.style !== 'wall' && x + b.w / 2 >= o.x && x + b.w / 2 <= o.x + o.w && o.y >= y,
    );
    if (floor && (b.p > 0.02 || moving)) {
      fillRect(ctx, 'rgba(220,40,40,0.35)', x, y + b.h, b.w, floor.y - y - b.h);
      for (let xx = x; xx < x + b.w; xx += 8) fillRect(ctx, '#ff4a3a', xx, floor.y - 2, 4, 2);
    }
  }
  fillRect(ctx, b.kind === 'press' ? '#8a8e96' : BRASS, x, y, b.w, b.h);
  fillRect(ctx, b.kind === 'press' ? '#c8ccd4' : BRASS_LIGHT, x, y, b.w, 2);
  for (let tx = 0; tx < b.w; tx += 4) fillRect(ctx, BRASS_DARK, x + tx, y + b.h - 4, 2, 4);
  for (let tx = 0; tx < b.w; tx += 8) {
    fillRect(ctx, moving || b.kind === 'press' ? '#f7d23a' : BRASS_DARK, x + tx, y + 2, 4, 2);
    fillRect(ctx, INK, x + tx + 4, y + 2, 4, 2);
  }
  const dirX = Math.sign(b.target - b.p) * Math.sign(b.b.x - b.a.x || 0),
    dirY = Math.sign(b.target - b.p) * Math.sign(b.b.y - b.a.y || 0);
  if (moving) {
    const cx = x + b.w / 2,
      cy = y + b.h / 2;
    fillRect(ctx, INK, cx - 3 + dirX * 2, cy - 1 + dirY * 2, 6, 2);
    fillRect(ctx, '#ffffff', cx - 1 + dirX * 4, cy - 1 + dirY * 4, 2, 2);
  }
  fillRect(ctx, INK, x + b.w / 2 - 6, y + b.h + 1, 12, 15);
  text(ctx, bridgeLetter(b.id), x + b.w / 2, y + b.h + 2, BRASS_LIGHT, 14, 'center');
  if (b.jam) {
    ctx.strokeStyle = Math.floor(s.time * 8) % 2 ? '#ff4a3a' : '#ffd24a';
    ctx.strokeRect(x - 1, y - 1, b.w + 2, b.h + 2);
  }
}

function drawGearsAndPads(ctx, s) {
  for (const pad of s.pads) {
    for (let xx = pad.x; xx < pad.x + pad.w; xx += 8) {
      fillRect(ctx, (xx - pad.x) % 16 ? INK : '#7be28a', xx, pad.y - 3, 4, 3);
    }
  }
  const near = nearestGear(s);
  for (const g of s.gears) {
    const b = s.bridges[g.drives[0][0]],
      sign = g.drives[0][1] ? -1 : 1;
    fillRect(ctx, BRASS_DARK, g.x - 2, g.y, 4, 14);
    drawGear(
      ctx,
      g.x,
      g.y,
      g.r,
      sign * b.p * 7 + g.state * 0.4 + s.gearSpin * 2,
      BRASS,
      BRASS_LIGHT,
      8,
    );
    fillRect(ctx, g.state ? '#7be28a' : '#e86a4a', g.x - 2, g.y - 2, 4, 4);
    if (near === g) {
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(g.x - 13, g.y - 13, 26, 26);
    }
    fillRect(ctx, INK, g.x - g.drives.length * 4 - 2, g.y - 31, g.drives.length * 8 + 4, 15);
    text(
      ctx,
      g.drives.map(([id]) => bridgeLetter(id)).join(''),
      g.x,
      g.y - 30,
      BRASS_LIGHT,
      14,
      'center',
    );
  }
}

function drawKeyIcon(ctx, x, y) {
  pixelSprite(ctx, KEY_SPRITE, x, y, SPRITE_SCALE, { y: '#ffd24a' });
}

function drawDoor(ctx, s, env) {
  const d = s.door,
    open = !d.locked;
  fillRect(ctx, INK, d.x - 2, d.y - 2, d.w + 4, d.h + 2);
  fillRect(ctx, open ? '#7be28a' : '#5a3a22', d.x, d.y, d.w, d.h);
  if (open) {
    fillRect(ctx, '#d6ffd6', d.x + 4, d.y + 4, d.w - 8, d.h - 4);
    for (let n = 0; n < 4; n++)
      fillRect(
        ctx,
        '#ffffff',
        d.x + 3 + n * 4,
        d.y + 2 + ((n * 5 + Math.floor(s.time * 10)) % 9),
        2,
        2,
      );
  } else {
    fillRect(ctx, BRASS, d.x + d.w / 2 - 4, d.y + 9, 8, 7);
    fillRect(ctx, BRASS_LIGHT, d.x + d.w / 2 - 2, d.y + 5, 4, 5);
    fillRect(ctx, INK, d.x + d.w / 2 - 1, d.y + 11, 2, 3);
  }
  text(
    ctx,
    env.t('EXIT', '出口'),
    d.x + d.w / 2,
    d.y - 17,
    open ? '#7be28a' : '#d8c8a8',
    14,
    'center',
  );
}

function drawPlayer(ctx, s) {
  const p = s.player,
    side = p.facing < 0 ? 'L' : 'R';
  let frame = 'stand';
  if (!p.grounded) frame = 'jump';
  else if (Math.abs(p.vx) > 10) frame = Math.floor(s.time * 10) % 2 ? 'runA' : 'runB';
  pixelSprite(ctx, SPRITES[frame + side], p.x, p.y, SPRITE_SCALE, COAT_PALETTE);
  const carried = s.keys.find((k) => k.state === 'carried');
  if (carried) drawKeyIcon(ctx, p.x + 1, p.y - 14 - Math.round(Math.sin(s.time * 6)));
}

function promptFor(s, env) {
  if (s.message) return env.t(s.message.en, s.message.zh);
  const c = centerOf(s.player),
    carried = s.keys.find((k) => k.state === 'carried');
  if (carried && s.door.locked && gap2(c, centerOf(s.door)) <= DOOR_REACH)
    return env.t('Z: unlock the door', 'Z：打开门锁');
  if (nearestGear(s)) return env.t('X: turn the gear', 'X：转动齿轮');
  if (!carried && s.keys.some((k) => k.state === 'floor' && gap2(c, centerOf(k)) <= KEY_REACH))
    return env.t('Z: take the key', 'Z：拿起钥匙');
  return env.t(MACHINES[s.machine].hint.en, MACHINES[s.machine].hint.zh);
}

function drawHud(ctx, s, env) {
  const m = MACHINES[s.machine];
  fillRect(ctx, 'rgba(10,6,4,0.85)', 0, 0, 480, 20);
  text(ctx, `${s.level}/3 ${env.t(m.name.en, m.name.zh)}`, 6, 3, BRASS_LIGHT, 14);
  const carried = s.keys.find((k) => k.state === 'carried');
  if (carried) drawKeyIcon(ctx, 300, 4);
  else if (s.door.locked) text(ctx, env.t('no key', '无钥匙'), 270, 3, '#a89a88', 14);
  for (let n = 0; n < s.lives; n++) pixelSprite(ctx, HEART, 440 - n * 10, 7, 1, { r: '#ff5a5a' });
  fillRect(ctx, 'rgba(10,6,4,0.85)', 0, 298, 480, 22);
  text(ctx, promptFor(s, env), 240, 301, s.message ? '#ffe9a8' : '#ffffff', 14, 'center');
}

function drawMachine(ctx, s, env) {
  const theme = MACHINES[s.machine].theme;
  drawBackdrop(ctx, s);
  drawLinkage(ctx, s);
  for (const o of s.solids) drawSolid(ctx, o, theme);
  drawGearsAndPads(ctx, s);
  drawDoor(ctx, s, env);
  for (const b of s.bridges) drawBridge(ctx, s, b);
  for (const k of s.keys) {
    if (k.state === 'floor')
      drawKeyIcon(ctx, k.x, k.y - Math.round((Math.sin(s.time * 4) + 1) / 2));
  }
  drawPlayer(ctx, s);
  for (const f of s.fx) {
    const col = { spark: '#ffd24a', steam: '#e8f0f4', dust: '#b8a890' }[f.kind];
    fillRect(ctx, col, f.x, f.y, 2, 2);
  }
  drawHud(ctx, s, env);
}
