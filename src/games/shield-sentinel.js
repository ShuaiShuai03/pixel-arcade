import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'shield-sentinel',
  name: { en: 'Shield Sentinel', zh: '护盾卫士' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Defend the stone observatory through three waves and a Guardian. Hold Space to raise your shield: it covers only the bright arc in front of you, and you cannot move while it is up. Cyan orbs bounce straight back into the armored turrets; orange slugs are only blocked; red lances ignore the shield, so step out of the red lane. Press X for a short bash against crawlers. The Guardian’s purple-circle slam breaks your shield, so run out of the circle.',
    zh: '穿过三波进攻并击败守护巨像，保卫石砌天文台。按住空格举盾：盾只覆盖面前明亮的弧形，举盾时不能移动。青色光球会被原路弹回，打中装甲炮台；橙色弹只能被挡下；红色长矛无视护盾，请离开红色通道。按X短距重击爬虫。守护巨像的紫圈重击会击碎护盾，请跑出圆圈。',
  },
  keys: [
    { label: { en: 'Move / aim facing', zh: '移动 / 瞄准朝向' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Hold to raise the shield (rooted)', zh: '按住举盾（原地不动）' },
      keys: 'Space',
    },
    { label: { en: 'Short bash', zh: '短距重击' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Shield (hold)', '举盾（按住）', 'right'],
    ['KeyX', 'Bash', '重击', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
export const PLAY_TOP = 30; // canvas rows above are the HUD band
export const PLAY_BOTTOM = 294; // canvas rows below are the prompt band
const SHOT_BOUNDS = { x0: 4, x1: 476, y0: 34, y1: 290 };
export const WALK = { x0: 52, x1: 428, y0: 90, y1: 256 };
const SPEED = 100;
export const BODY = { hw: 8, hh: 12 }; // matches the 16x24 sprite
export const SHIELD_R = 22; // centre line of the plates
export const SHIELD_THICK = 8; // drawn plates span SHIELD_R +/- 4 px
export const SHIELD_OUTER = SHIELD_R + SHIELD_THICK / 2;
export const SHIELD_INNER = SHIELD_R - SHIELD_THICK / 2;
export const SHIELD_HALF = Math.PI / 4; // 90 degree arc
const MAX_HP = 5;
const INVULN = 0.9;
const MAX_ENERGY = 100;
const DRAIN = 8;
const RECHARGE = 45;
const RECHARGE_DELAY = 0.35;
const MIN_RAISE = 10;
const BLOCK_COST = 8;
const BASH_COST = 12;
const BASH_ACTIVE = 0.15;
const BASH_CD = 0.8;
export const BASH_R = 34;
const BASH_HALF = (70 * Math.PI) / 180;
const REFLECT_BOOST = 1.2;
const SLAM_R = 36;
const BROKEN_TIME = 1.5;
const EXPOSE_TIME = 4;
const INTRO_TIME = 2.2;
const FIRST_DELAY = 1.2;
const LANCE_SPEED = 300;
const CRAWLER_PORTAL = 0.7;
const CRAWLER_STUN = 0.8;
const MAX_CRAWLERS = 3;
const MAX_FX = 40;
const BLOCK_FLASH = 0.25;
export const CHARGE = { orb: 0.7, slug: 0.7, lance: 1, slam: 1.3 };
const SHOT_R = { orb: 5, slug: 4, lance: 3 };
const SHOT_DAMAGE = { orb: 1, slug: 1, lance: 2 };
const WAVE_COUNT = 3;

const turret = (x, y, hp, pattern) => ({ type: 'turret', x, y, hp, pattern, hw: 10, hh: 10 });
const WAVES = [
  {
    name: { en: 'Wave 1', zh: '第1波' },
    rest: 0.9,
    orbSpeed: 140,
    slugSpeed: 130,
    crawlerSpeed: 0,
    crawlers: [],
    foes: [turret(80, 46, 2, ['orb']), turret(400, 46, 2, ['orb'])],
  },
  {
    name: { en: 'Wave 2', zh: '第2波' },
    rest: 0.7,
    orbSpeed: 160,
    slugSpeed: 140,
    crawlerSpeed: 40,
    crawlers: [8, 20],
    foes: [
      turret(90, 46, 2, ['orb', 'orb', 'slug']),
      turret(390, 46, 2, ['orb', 'slug']),
      turret(16, 170, 2, ['orb', 'lance']),
    ],
  },
  {
    name: { en: 'Wave 3', zh: '第3波' },
    rest: 0.55,
    orbSpeed: 180,
    slugSpeed: 150,
    crawlerSpeed: 46,
    crawlers: [6, 16, 28],
    foes: [
      turret(60, 46, 2, ['orb', 'lance']),
      turret(240, 46, 2, ['orb', 'slug']),
      turret(420, 46, 3, ['orb', 'lance']),
      turret(464, 170, 2, ['orb', 'slug']),
    ],
  },
  {
    name: { en: 'Guardian', zh: '守护巨像' },
    rest: 0.5,
    orbSpeed: 170,
    slugSpeed: 150,
    crawlerSpeed: 44,
    crawlers: [10, 24],
    foes: [
      {
        type: 'guardian',
        x: 240,
        y: 52,
        hp: 8,
        hw: 22,
        hh: 16,
        pattern: ['orb', 'slug', 'orb', 'lance', 'slam', 'orb', 'orb'],
      },
    ],
  },
];

// ---------------------------------------------------------------- geometry

export const angleBetween = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const inArc = (dx, dy, facing, half = SHIELD_HALF) =>
  angleBetween(Math.atan2(dy, dx), facing) <= half + 1e-9;

// Earliest time in [0,1] at which a moving point first enters a circle from outside.
export function segmentCircleEntry(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0,
    dy = y1 - y0,
    fx = x0 - cx,
    fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r,
    a = dx * dx + dy * dy,
    b = fx * dx + fy * dy;
  if (c <= 0 || a === 0 || b >= 0) return null;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? Math.max(0, t) : null;
}

// Earliest time in [0,1] at which a moving point touches a box (slab test); 0 when it starts inside.
export function segmentBoxEntry(x0, y0, x1, y1, cx, cy, hw, hh) {
  let tMin = 0,
    tMax = 1;
  for (const [o, d, lo, hi] of [
    [x0, x1 - x0, cx - hw, cx + hw],
    [y0, y1 - y0, cy - hh, cy + hh],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d,
      b = (hi - o) / d;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    if (tMin > tMax) return null;
  }
  return tMin;
}

// Earliest contact of a moving circle (radius r) with the segment A-B, null if it starts touching.
function capsuleEntry(x0, y0, x1, y1, ax, ay, bx, by, r) {
  const len = Math.hypot(bx - ax, by - ay),
    ux = (bx - ax) / len,
    uy = (by - ay) / len;
  const local = (x, y) => [(x - ax) * ux + (y - ay) * uy, -(x - ax) * uy + (y - ay) * ux];
  const [u0, v0] = local(x0, y0),
    [u1, v1] = local(x1, y1);
  if (Math.hypot(u0 - clamp(u0, 0, len), v0) <= r) return null;
  const hits = [
    segmentBoxEntry(u0, v0, u1, v1, len / 2, 0, len / 2, r),
    segmentCircleEntry(x0, y0, x1, y1, ax, ay, r),
    segmentCircleEntry(x0, y0, x1, y1, bx, by, r),
  ].filter((t) => t !== null);
  return hits.length ? Math.min(...hits) : null;
}

// Swept circle against the drawn plates: the outer face inside the arc plus both end faces.
// Returns the contact time, the shot centre relative to the sentinel and the surface normal.
export function shieldContact(cx, cy, face, x0, y0, x1, y1, r) {
  let best = null;
  const at = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const outer = segmentCircleEntry(x0, y0, x1, y1, cx, cy, SHIELD_OUTER + r);
  if (outer !== null) {
    const [hx, hy] = at(outer).map((v, i) => v - (i ? cy : cx)),
      len = Math.hypot(hx, hy);
    if (inArc(hx, hy, face)) best = { t: outer, hx, hy, nx: hx / len, ny: hy / len };
  }
  for (const sign of [-1, 1]) {
    const a = face + sign * SHIELD_HALF,
      ax = cx + Math.cos(a) * SHIELD_INNER,
      ay = cy + Math.sin(a) * SHIELD_INNER,
      bx = cx + Math.cos(a) * SHIELD_OUTER,
      by = cy + Math.sin(a) * SHIELD_OUTER;
    const t = capsuleEntry(x0, y0, x1, y1, ax, ay, bx, by, r);
    if (t === null || (best && best.t <= t)) continue;
    const [px, py] = at(t),
      along = clamp(
        ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (SHIELD_OUTER - SHIELD_INNER) ** 2,
        0,
        1,
      ),
      nx = px - (ax + (bx - ax) * along),
      ny = py - (ay + (by - ay) * along),
      len = Math.hypot(nx, ny) || 1;
    best = { t, hx: px - cx, hy: py - cy, nx: nx / len, ny: ny / len };
  }
  return best;
}

// Mirror reflection about the shield normal: v' = v - 2 (v . n) n.
export function reflect(vx, vy, nx, ny) {
  const dot = vx * nx + vy * ny;
  return { vx: vx - 2 * dot * nx, vy: vy - 2 * dot * ny };
}

// Half-width of the lane a lance of this heading sweeps across the sentinel's box.
export const laneHalfWidth = (dirx, diry, r = SHOT_R.lance) =>
  Math.abs(diry) * BODY.hw + Math.abs(dirx) * BODY.hh + r * (Math.abs(dirx) + Math.abs(diry));

const circleHitsBox = (cx, cy, r, bx, by, hw, hh) =>
  Math.hypot(cx - clamp(cx, bx - hw, bx + hw), cy - clamp(cy, by - hh, by + hh)) <= r;

// ------------------------------------------------------------------- world

const newFoe = (w, spec) => ({
  id: w.nextId++,
  ...spec,
  pattern: [...spec.pattern],
  maxHp: spec.hp,
  k: 0,
  charge: null,
  exposed: 0,
  flash: 0,
});

export function createWorld(random = Math.random) {
  const w = {
    phase: 'playing',
    tick: 0,
    acc: 0,
    score: 0,
    hp: MAX_HP,
    wave: 0,
    introT: 0,
    waveT: 0,
    nextId: 1,
    random,
    events: [],
    p: {
      x: 240,
      y: 190,
      face: -Math.PI / 2,
      shieldUp: false,
      energy: MAX_ENERGY,
      broken: 0,
      delay: 0,
      bashT: 0,
      bashCd: 0,
      inv: 0,
      blockT: 0,
    },
    foes: [],
    crawlers: [],
    shots: [],
    fx: [],
    atk: { wait: FIRST_DELAY, step: 0 },
    spawned: 0,
  };
  startWave(w, 0);
  return w;
}

export function startWave(w, index) {
  const cfg = WAVES[index];
  w.wave = index;
  w.introT = INTRO_TIME;
  w.waveT = 0;
  w.spawned = 0;
  w.foes = cfg.foes.map((spec) => newFoe(w, spec));
  w.crawlers = [];
  w.shots = [];
  w.atk = { wait: FIRST_DELAY, step: 0 };
}

const addFx = (w, kind, x, y, life = 0.35) => {
  w.fx.push({ kind, x, y, t: 0, life });
  if (w.fx.length > MAX_FX) w.fx.shift();
};

function hurt(w, damage, source) {
  const p = w.p;
  if (p.inv > 0) return false;
  w.hp = Math.max(0, w.hp - damage);
  p.inv = INVULN;
  w.events.push('hit');
  addFx(w, 'hurt', p.x, p.y);
  if (source === 'slam') {
    p.energy = 0;
    p.broken = BROKEN_TIME;
    p.shieldUp = false;
  }
  if (w.hp <= 0) w.phase = 'lost';
  return true;
}

const shieldIsUp = (p) => p.shieldUp && p.broken <= 0;

function updatePlayer(w, inp) {
  const p = w.p;
  const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
    dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;
  const wasUp = p.shieldUp;
  p.inv = Math.max(0, p.inv - STEP);
  p.blockT = Math.max(0, p.blockT - STEP);
  p.bashT = Math.max(0, p.bashT - STEP);
  p.bashCd = Math.max(0, p.bashCd - STEP);
  p.broken = Math.max(0, p.broken - STEP);
  p.shieldUp = inp.shield && p.broken <= 0 && (wasUp || p.energy >= MIN_RAISE);
  if (p.shieldUp && !wasUp) w.events.push('raise');
  if (moving) p.face = Math.atan2(dy, dx);
  if (moving && !p.shieldUp) {
    const len = Math.hypot(dx, dy);
    p.x = clamp(p.x + (dx / len) * SPEED * STEP, WALK.x0, WALK.x1);
    p.y = clamp(p.y + (dy / len) * SPEED * STEP, WALK.y0, WALK.y1);
  }
  if (p.shieldUp) {
    p.energy = Math.max(0, p.energy - DRAIN * STEP);
    p.delay = RECHARGE_DELAY;
    if (p.energy <= 0) breakShield(w);
  } else {
    p.delay = Math.max(0, p.delay - STEP);
    if (p.delay <= 0 && p.broken <= 0) p.energy = Math.min(MAX_ENERGY, p.energy + RECHARGE * STEP);
  }
  if (inp.bash && !p.shieldUp && p.bashCd <= 0 && p.energy >= BASH_COST) {
    p.energy -= BASH_COST;
    p.delay = RECHARGE_DELAY;
    p.bashT = BASH_ACTIVE;
    p.bashCd = BASH_CD;
    w.events.push('bash');
  }
}

function breakShield(w) {
  w.p.shieldUp = false;
  w.p.energy = 0;
  w.p.broken = BROKEN_TIME;
  addFx(w, 'shatter', w.p.x, w.p.y, 0.5);
}

const aliveFoes = (w) => w.foes.filter((f) => f.hp > 0);

function launch(w, foe, charge) {
  const kind = charge.kind,
    cfg = WAVES[w.wave],
    p = w.p;
  const dx = p.x - foe.x,
    dy = p.y - foe.y,
    len = Math.hypot(dx, dy) || 1;
  const speed = kind === 'orb' ? cfg.orbSpeed : kind === 'slug' ? cfg.slugSpeed : LANCE_SPEED;
  const dir = kind === 'lance' ? { x: charge.dirx, y: charge.diry } : { x: dx / len, y: dy / len };
  w.shots.push({
    id: w.nextId++,
    kind,
    x: foe.x,
    y: foe.y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    r: SHOT_R[kind],
    owner: 'foe',
    reflected: false,
    hit: [],
  });
  w.events.push('shoot');
}

function resolveSlam(w, foe, c) {
  addFx(w, 'slam', c.lx, c.ly, 0.5);
  w.events.push('slam');
  foe.exposed = EXPOSE_TIME;
  if (circleHitsBox(c.lx, c.ly, SLAM_R, w.p.x, w.p.y, BODY.hw, BODY.hh)) hurt(w, 2, 'slam');
}

function updateAttacks(w) {
  const cfg = WAVES[w.wave],
    alive = aliveFoes(w);
  for (const f of alive) {
    f.exposed = Math.max(0, f.exposed - STEP);
    f.flash = Math.max(0, f.flash - STEP);
  }
  const active = alive.find((f) => f.charge);
  if (active) {
    const c = active.charge;
    c.t += STEP;
    if (c.t + 1e-9 < c.dur) return;
    active.charge = null;
    w.atk.wait = cfg.rest;
    if (c.kind === 'slam') resolveSlam(w, active, c);
    else launch(w, active, c);
    return;
  }
  if (w.shots.length > 0) return;
  w.atk.wait = Math.max(0, w.atk.wait - STEP);
  if (w.atk.wait > 0 || alive.length === 0) return;
  const foe = alive[w.atk.step++ % alive.length];
  const kind = foe.pattern[foe.k++ % foe.pattern.length];
  const dx = w.p.x - foe.x,
    dy = w.p.y - foe.y,
    len = Math.hypot(dx, dy) || 1;
  foe.charge = {
    kind,
    t: 0,
    dur: CHARGE[kind],
    lx: w.p.x,
    ly: w.p.y,
    dirx: dx / len,
    diry: dy / len,
  };
  if (kind === 'slam') foe.charge.r = SLAM_R;
}

function updateCrawlers(w) {
  const cfg = WAVES[w.wave],
    p = w.p;
  w.waveT += STEP;
  const due = cfg.crawlers[w.spawned];
  if (due !== undefined && w.waveT >= due && w.crawlers.length < MAX_CRAWLERS) {
    w.spawned++;
    let x = w.random() < 0.5 ? WALK.x0 : WALK.x1;
    if (Math.abs(x - p.x) < 80) x = WALK.x0 + WALK.x1 - x;
    const y = 120 + Math.floor(w.random() * 130);
    w.crawlers.push({ id: w.nextId++, x, y, hw: 6, hh: 5, portal: CRAWLER_PORTAL, stun: 0 });
  }
  const kept = [];
  for (const c of w.crawlers) {
    const dx = c.x - p.x,
      dy = c.y - p.y,
      dist = Math.hypot(dx, dy);
    if (c.portal > 0) {
      c.portal = Math.max(0, c.portal - STEP);
      kept.push(c);
      continue;
    }
    if (p.bashT > 0 && dist <= BASH_R && angleBetween(Math.atan2(dy, dx), p.face) <= BASH_HALF) {
      w.score += 25;
      w.events.push('coin');
      addFx(w, 'puff', c.x, c.y);
      continue;
    }
    if (c.stun > 0) c.stun = Math.max(0, c.stun - STEP);
    else {
      const tx = p.x - c.x,
        ty = p.y - c.y,
        len = Math.hypot(tx, ty) || 1;
      c.x += (tx / len) * cfg.crawlerSpeed * STEP;
      c.y += (ty / len) * cfg.crawlerSpeed * STEP;
    }
    const nx = c.x - p.x,
      ny = c.y - p.y;
    if (shieldIsUp(p) && Math.hypot(nx, ny) < SHIELD_R + 8 && inArc(nx, ny, p.face)) {
      const len = Math.hypot(nx, ny) || 1;
      c.x = p.x + (nx / len) * (SHIELD_R + 12);
      c.y = p.y + (ny / len) * (SHIELD_R + 12);
      c.stun = CRAWLER_STUN;
      p.energy = Math.max(0, p.energy - 5);
      w.events.push('block');
      p.blockT = BLOCK_FLASH;
      addFx(w, 'spark', c.x, c.y, 0.2);
      if (p.energy <= 0) breakShield(w);
    } else if (Math.abs(nx) < BODY.hw + c.hw && Math.abs(ny) < BODY.hh + c.hh) {
      hurt(w, 1, 'crawler');
      addFx(w, 'puff', c.x, c.y);
      continue;
    }
    kept.push(c);
  }
  w.crawlers = kept;
}

function killFoe(w, foe) {
  w.score += 200;
  w.events.push('coin');
  addFx(w, 'puff', foe.x, foe.y, 0.5);
  if (foe.charge) {
    foe.charge = null;
    w.atk.wait = WAVES[w.wave].rest;
  }
}

// Collect the earliest event of each shot for this tick, then apply them in time order.
function shotEvent(w, s, x1, y1) {
  const p = w.p;
  if (s.owner === 'foe') {
    const body = segmentBoxEntry(s.x, s.y, x1, y1, p.x, p.y, BODY.hw + s.r, BODY.hh + s.r);
    const block =
      s.kind !== 'lance' && shieldIsUp(p)
        ? shieldContact(p.x, p.y, p.face, s.x, s.y, x1, y1, s.r)
        : null;
    if (block && (body === null || block.t <= body))
      return { t: block.t, s, type: 'block', ...block };
    return body === null ? null : { t: body, s, type: 'body' };
  }
  let best = null;
  for (const target of [...aliveFoes(w), ...w.crawlers.filter((c) => c.portal <= 0)]) {
    if (s.hit.includes(target.id)) continue;
    const t = segmentBoxEntry(
      s.x,
      s.y,
      x1,
      y1,
      target.x,
      target.y,
      target.hw + s.r,
      target.hh + s.r,
    );
    if (t !== null && (best === null || t < best.t)) best = { t, s, type: 'target', target };
  }
  return best;
}

function applyShotEvent(w, e) {
  const { s } = e;
  if (e.type === 'body') {
    s.dead = true;
    hurt(w, SHOT_DAMAGE[s.kind], s.kind);
  } else if (e.type === 'block') {
    w.p.energy = Math.max(0, w.p.energy - BLOCK_COST);
    w.events.push('block');
    w.p.blockT = BLOCK_FLASH;
    addFx(w, 'spark', w.p.x + e.hx, w.p.y + e.hy, 0.25);
    if (s.kind === 'slug') s.dead = true;
    else {
      const v = reflect(s.vx, s.vy, e.nx, e.ny);
      s.vx = v.vx * REFLECT_BOOST;
      s.vy = v.vy * REFLECT_BOOST;
      s.owner = 'player';
      s.reflected = true;
      s.x = w.p.x + e.hx;
      s.y = w.p.y + e.hy;
      s.held = true;
    }
    if (w.p.energy <= 0) breakShield(w);
  } else {
    const target = e.target;
    s.hit.push(target.id);
    w.score += 50;
    w.events.push('coin');
    target.flash = 0.15;
    if (target.type === undefined) {
      target.hp = 0;
      target.dead = true;
      w.score += 25;
      addFx(w, 'puff', target.x, target.y);
    } else {
      target.hp = Math.max(0, target.hp - (target.exposed > 0 ? 2 : 1));
      if (target.hp <= 0) killFoe(w, target);
    }
  }
}

function updateShots(w) {
  const events = [];
  for (const s of w.shots) {
    const x1 = s.x + s.vx * STEP,
      y1 = s.y + s.vy * STEP;
    s.nx = x1;
    s.ny = y1;
    const e = shotEvent(w, s, x1, y1);
    if (e) events.push(e);
  }
  events.sort((a, b) => a.t - b.t || a.s.id - b.s.id);
  for (const e of events) {
    if (w.phase !== 'playing') break;
    if (e.s.dead || (e.type === 'target' && e.target.hp <= 0 && e.target.type !== undefined))
      continue;
    if (e.type === 'target' && e.target.dead) continue;
    applyShotEvent(w, e);
  }
  w.crawlers = w.crawlers.filter((c) => !c.dead);
  for (const s of w.shots) {
    if (s.held) s.held = false;
    else {
      s.x = s.nx;
      s.y = s.ny;
    }
  }
  w.shots = w.shots.filter(
    (s) =>
      !s.dead &&
      s.x >= SHOT_BOUNDS.x0 &&
      s.x <= SHOT_BOUNDS.x1 &&
      s.y >= SHOT_BOUNDS.y0 &&
      s.y <= SHOT_BOUNDS.y1,
  );
  for (const s of w.shots) (delete s.nx, delete s.ny);
}

function clearWave(w) {
  w.score += 300;
  w.events.push('win');
  if (w.wave >= WAVE_COUNT) {
    w.score += 1000 + w.hp * 100;
    w.phase = 'won';
    return;
  }
  w.hp = Math.min(MAX_HP, w.hp + 1);
  startWave(w, w.wave + 1);
}

function tick(w, inp) {
  w.tick++;
  for (const f of w.fx) f.t += STEP;
  w.fx = w.fx.filter((f) => f.t < f.life);
  updatePlayer(w, inp);
  if (w.introT > 0) {
    w.introT = Math.max(0, w.introT - STEP);
    return;
  }
  updateAttacks(w);
  updateCrawlers(w);
  updateShots(w);
  if (w.phase === 'playing' && aliveFoes(w).length === 0) clearWave(w);
}

const readInput = (input, first) => ({
  left: input.held('ArrowLeft', 'KeyA'),
  right: input.held('ArrowRight', 'KeyD'),
  up: input.held('ArrowUp', 'KeyW'),
  down: input.held('ArrowDown', 'KeyS'),
  shield: input.held('Space'),
  bash: first && input.pressed('KeyX'),
});

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
  const total = w.acc + Math.min(dt, MAX_FRAME);
  w.events = [];
  if (total + 1e-9 < STEP) {
    w.acc = total;
    return;
  }
  w.acc = total;
  let first = true;
  while (w.acc + 1e-9 >= STEP && w.phase === 'playing') {
    w.acc -= STEP;
    tick(w, readInput(input, first));
    first = false;
  }
  if (Math.abs(w.acc) < 1e-9) w.acc = 0;
}

// ---------------------------------------------------------- readable state

export const PROMPTS = {
  intro: ['Arrows move · hold Space: shield · X: bash', '方向键移动 · 按住空格举盾 · X重击'],
  lance: ["RED LANE: step aside, shield can't stop it", '红色通道：侧移躲开，盾挡不住'],
  slam: ['PURPLE CIRCLE: run out of it!', '紫圈：快跑出去！'],
  crawler: ['Crawler close: face it, tap X to bash', '爬虫逼近：面向它，按X重击'],
  orb: ['Face the cyan orb, hold Space: reflect!', '面向青色光球，按住空格反射！'],
  slug: ['Face the orange slug, hold Space: block', '面向橙色弹，按住空格挡下'],
  broken: ['Shield broken: wait for it to recharge', '护盾破碎：等待恢复'],
  idle: ['Aim with Arrows, hold Space to shield', '方向键瞄准，按住空格举盾'],
};

export function promptKey(w) {
  if (w.introT > 0) return 'intro';
  const charges = w.foes.filter((f) => f.hp > 0 && f.charge).map((f) => f.charge.kind);
  const shots = w.shots.filter((s) => s.owner === 'foe').map((s) => s.kind);
  if (charges.includes('lance') || shots.includes('lance')) return 'lance';
  if (charges.includes('slam')) return 'slam';
  if (w.crawlers.some((c) => c.portal <= 0 && Math.hypot(c.x - w.p.x, c.y - w.p.y) < 70))
    return 'crawler';
  const threat = [...charges, ...shots].includes('orb')
    ? 'orb'
    : [...charges, ...shots].includes('slug')
      ? 'slug'
      : null;
  if (w.p.broken > 0) return 'broken';
  return threat || 'idle';
}

export function snapshot(w) {
  const key = promptKey(w),
    p = w.p;
  const [en, zh] = PROMPTS[key];
  const guardian = w.foes.find((f) => f.type === 'guardian');
  const label = guardian
    ? {
        en: `Guardian ${guardian.hp}/${guardian.maxHp}`,
        zh: `巨像 ${guardian.hp}/${guardian.maxHp}`,
      }
    : { en: `Wave ${w.wave + 1}/3`, zh: `第${w.wave + 1}/3波` };
  return {
    phase: w.phase,
    score: w.score,
    hp: w.hp,
    maxHp: MAX_HP,
    wave: w.wave + 1,
    waveCount: WAVE_COUNT,
    guardianWave: w.wave === WAVE_COUNT,
    time: w.tick * STEP,
    introLeft: w.introT,
    prompt: { key, en, zh },
    sentinel: {
      x: p.x,
      y: p.y,
      hw: BODY.hw,
      hh: BODY.hh,
      face: p.face,
      shieldUp: shieldIsUp(p),
      arc: { r: SHIELD_R, thickness: SHIELD_THICK, half: SHIELD_HALF, facing: p.face },
      energy: p.energy,
      broken: p.broken,
      bashActive: p.bashT > 0,
      bashCooldown: p.bashCd,
      bashCost: BASH_COST,
      invulnerable: p.inv,
      blockFlash: p.blockT,
    },
    foes: w.foes.map((f) => structuredClone(f)),
    crawlers: w.crawlers.map((c) => ({ ...c })),
    shots: w.shots.map((s) => ({ ...s, hit: [...s.hit] })),
    events: [...w.events],
    status: {
      en: `${label.en} · HP ${w.hp} · ${en}`,
      zh: `${label.zh} · 生命 ${w.hp} · ${zh}`,
    },
  };
}

const END_TEXT = {
  won: ['The observatory is safe: the Guardian has fallen!', '天文台得救了：守护巨像已倒下！'],
  lost: [
    'The sentinel fell. Heed the red lanes and purple circles, and keep the shield aimed.',
    '卫士倒下了。留意红色通道和紫色圆圈，并把盾对准来袭方向。',
  ],
};
const SOUND_FOR = {
  raise: 'move',
  bash: 'move',
  shoot: 'shoot',
  slam: 'hit',
  hit: 'hit',
  block: 'coin',
  coin: 'coin',
  win: 'win',
};

export function createGame(env) {
  const w = createWorld(env.random);
  let ended = false;
  return {
    update(dt, input) {
      if (ended) return;
      stepWorld(w, dt, input);
      for (const e of new Set(w.events)) if (SOUND_FOR[e]) env.sound(SOUND_FOR[e]);
      if (w.phase === 'playing') return;
      ended = true;
      const won = w.phase === 'won',
        [en, zh] = END_TEXT[w.phase];
      env.sound(won ? 'win' : 'lose');
      env.end({ won, score: w.score, message: env.t(en, zh) });
    },
    draw(ctx) {
      drawWorld(ctx, w, env);
    },
    getState() {
      return snapshot(w);
    },
  };
}

// --------------------------------------------------------------- rendering

const COLORS = {
  orb: '#37e6d2',
  slug: '#ff9a3c',
  lance: '#ff3b4a',
  shield: '#d8ecff',
  gold: '#ffd76a',
  slam: '#b04cff',
};
const SENTINEL = [
  '..hhhh..',
  '.hhhhhh.',
  '.hvvvvh.',
  '..hhhh..',
  '.aaaaaa.',
  'aaccccaa',
  'aaccccaa',
  '.aaaaaa.',
  '..bbbb..',
  '..b..b..',
  '..b..b..',
  '.bb..bb.',
];
const SENTINEL_PALETTE = { h: '#9fb4c8', v: '#37e6d2', a: '#4a6a9a', c: '#ffd76a', b: '#2b3a55' };
const TURRET = [
  '..mmmmmm..',
  '.mmssssmm.',
  'mmsEEEEsmm',
  'mmsEEEEsmm',
  'mmssssssmm',
  '.mmmmmmmm.',
  '..mmddmm..',
  '..mdddmm..',
  '.mmmmmmmm.',
  'mmmmmmmmmm',
];

function drawFloor(ctx) {
  background(ctx, '#0b1022');
  // Night sky seen through the observatory ring wall, with a telescope silhouette.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 5 === 0 ? '#ffe9a8' : '#8fa6d8';
    ctx.fillRect(((i * 97) % 470) + 4, PLAY_TOP + ((i * 53) % 22), 2, 2);
  }
  ctx.fillStyle = '#1c2540';
  ctx.beginPath();
  ctx.moveTo(300, PLAY_TOP + 30);
  ctx.lineTo(344, PLAY_TOP + 8);
  ctx.lineTo(352, PLAY_TOP + 14);
  ctx.lineTo(310, PLAY_TOP + 34);
  ctx.fill();
  ctx.fillStyle = '#3a4668';
  for (let x = 0; x < 480; x += 48) {
    ctx.fillRect(x, PLAY_TOP + 30, 48, 8);
    ctx.fillStyle = x % 96 ? '#46537a' : '#3a4668';
    ctx.fillRect(x + 2, PLAY_TOP + 32, 44, 4);
    ctx.fillStyle = '#3a4668';
  }
  // Flagstone floor with offset mortar joints.
  const top = PLAY_TOP + 38;
  ctx.fillStyle = '#262e44';
  ctx.fillRect(0, top, 480, PLAY_BOTTOM - top);
  for (let row = 0; row * 28 + top < PLAY_BOTTOM; row++) {
    const y = top + row * 28;
    for (let x = -(row % 2) * 24; x < 480; x += 48) {
      ctx.fillStyle = (x / 48 + row) % 3 ? '#2a3350' : '#30395a';
      ctx.fillRect(x + 1, y + 1, 46, 26);
      ctx.fillStyle = '#1b2236';
      ctx.fillRect(x, y, 48, 1);
      ctx.fillRect(x, y, 1, 28);
    }
  }
  ctx.fillStyle = '#4a5578';
  ctx.fillRect(0, PLAY_BOTTOM - 4, 480, 4);
}

function drawPlinth(ctx, f) {
  ctx.fillStyle = '#4a5578';
  ctx.fillRect(f.x - f.hw - 4, f.y + f.hh - 2, f.hw * 2 + 8, 7);
  ctx.fillStyle = '#2e3752';
  ctx.fillRect(f.x - f.hw - 4, f.y + f.hh + 3, f.hw * 2 + 8, 2);
}

function drawFoe(ctx, f, env) {
  drawPlinth(ctx, f);
  const kind = f.charge ? f.charge.kind : null;
  const eye = kind === 'slam' ? COLORS.slam : kind ? COLORS[kind] : '#6b7a99';
  if (f.type === 'guardian') {
    ctx.fillStyle = f.exposed > 0 ? '#8a6a5a' : '#5a6580';
    ctx.fillRect(f.x - f.hw, f.y - f.hh, f.hw * 2, f.hh * 2);
    ctx.fillStyle = '#3a4260';
    ctx.fillRect(f.x - f.hw, f.y + f.hh - 8, f.hw * 2, 8);
    ctx.fillStyle = eye;
    ctx.fillRect(f.x - 8, f.y - 6, 16, 8);
    if (f.exposed > 0)
      text(
        ctx,
        `${env.t('CRACKED', '碎裂')} ${f.exposed.toFixed(1)}`,
        f.x,
        f.y + 20,
        COLORS.gold,
        14,
        'center',
      );
  } else {
    pixelSprite(ctx, TURRET, f.x - f.hw, f.y - f.hh, 2, {
      m: '#6b7a99',
      s: '#3a4260',
      d: '#262c40',
      E: eye,
    });
  }
  for (let i = 0; i < f.maxHp; i++) {
    ctx.fillStyle = i < f.hp ? COLORS.gold : '#3a2a2a';
    ctx.fillRect(f.x - f.maxHp * 3 + i * 6, f.y + f.hh + 3, 5, 3);
  }
  if (f.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(f.x - f.hw, f.y - f.hh, f.hw * 2, f.hh * 2);
  }
}

function drawTelegraph(ctx, f, w) {
  const c = f.charge;
  if (!c) return;
  const k = c.t / c.dur;
  if (c.kind === 'lance') {
    const half = laneHalfWidth(c.dirx, c.diry);
    const nx = -c.diry * half,
      ny = c.dirx * half,
      len = 700;
    ctx.fillStyle = `rgba(255,59,74,${0.15 + 0.3 * k})`;
    ctx.beginPath();
    ctx.moveTo(f.x + nx, f.y + ny);
    ctx.lineTo(f.x + c.dirx * len + nx, f.y + c.diry * len + ny);
    ctx.lineTo(f.x + c.dirx * len - nx, f.y + c.diry * len - ny);
    ctx.lineTo(f.x - nx, f.y - ny);
    ctx.fill();
    ctx.strokeStyle = '#ff7080';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x + nx, f.y + ny);
    ctx.lineTo(f.x + c.dirx * len + nx, f.y + c.diry * len + ny);
    ctx.moveTo(f.x - nx, f.y - ny);
    ctx.lineTo(f.x + c.dirx * len - nx, f.y + c.diry * len - ny);
    ctx.stroke();
  } else if (c.kind === 'slam') {
    ctx.strokeStyle = COLORS.slam;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.lx, c.ly, SLAM_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(176,76,255,${0.1 + 0.35 * k})`;
    ctx.beginPath();
    ctx.arc(c.lx, c.ly, SLAM_R * k, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = COLORS[c.kind];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.hw + 14 - 10 * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(w.p.x, w.p.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawShot(ctx, s) {
  if (s.reflected) {
    const sp = Math.hypot(s.vx, s.vy) || 1;
    for (const [len, width, color] of [
      [40, 7, 'rgba(255,215,106,0.25)'],
      [30, 4, 'rgba(255,215,106,0.6)'],
      [20, 2, '#ffffff'],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (s.vx / sp) * len, s.y - (s.vy / sp) * len);
      ctx.stroke();
    }
  }
  if (s.kind === 'orb') {
    ctx.fillStyle = s.reflected ? COLORS.gold : COLORS.orb;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (s.kind === 'slug') {
    ctx.fillStyle = COLORS.slug;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    ctx.strokeStyle = '#442200';
    ctx.strokeRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  } else {
    const sp = Math.hypot(s.vx, s.vy) || 1,
      ux = s.vx / sp,
      uy = s.vy / sp;
    ctx.fillStyle = COLORS.lance;
    ctx.beginPath();
    ctx.moveTo(s.x + ux * 12, s.y + uy * 12);
    ctx.lineTo(s.x - ux * 8 - uy * 5, s.y - uy * 8 + ux * 5);
    ctx.lineTo(s.x - ux * 8 + uy * 5, s.y - uy * 8 - ux * 5);
    ctx.fill();
  }
}

function drawShield(ctx, p) {
  const a0 = p.face - SHIELD_HALF;
  if (!shieldIsUp(p)) {
    // Lowered: a faint dotted ghost shows where the plates will rise.
    ctx.strokeStyle = 'rgba(216,236,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R, a0, a0 + SHIELD_HALF * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const flash = p.blockT > 0,
    segs = 5,
    span = (SHIELD_HALF * 2) / segs;
  ctx.shadowColor = flash ? '#ffffff' : '#7fc4ff';
  ctx.shadowBlur = flash ? 14 : 8;
  for (let i = 0; i < segs; i++) {
    const s0 = a0 + i * span + 0.03,
      s1 = a0 + (i + 1) * span - 0.03;
    ctx.lineWidth = SHIELD_THICK;
    ctx.strokeStyle = flash ? '#ffffff' : i % 2 ? '#6fa8e8' : '#9fd0ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R, s0, s1);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_OUTER - 1, s0, s1);
    ctx.stroke();
    ctx.strokeStyle = '#25406e';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R - SHIELD_THICK / 2 + 1, s0, s1);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (flash) {
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 2;
    const mid = p.face;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(mid) * 18, p.y + Math.sin(mid) * 18);
    ctx.lineTo(p.x + Math.cos(mid + 0.15) * 28, p.y + Math.sin(mid + 0.15) * 28);
    ctx.stroke();
  }
}

function drawSentinel(ctx, w) {
  const p = w.p;
  if (p.inv > 0 && Math.floor(p.inv * 12) % 2) ctx.globalAlpha = 0.4;
  pixelSprite(ctx, SENTINEL, p.x - BODY.hw, p.y - BODY.hh, 2, SENTINEL_PALETTE);
  ctx.globalAlpha = 1;
  const fx = Math.cos(p.face),
    fy = Math.sin(p.face);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(Math.round(p.x + fx * 15 - 2), Math.round(p.y + fy * 15 - 2), 4, 4);
  drawShield(ctx, p);
  if (p.bashT > 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BASH_R, p.face - BASH_HALF, p.face + BASH_HALF);
    ctx.stroke();
  }
}

function drawHud(ctx, w, env) {
  const s = snapshot(w);
  ctx.fillStyle = '#0b0e16';
  ctx.fillRect(0, 0, 480, PLAY_TOP - 2);
  ctx.fillRect(0, PLAY_BOTTOM + 2, 480, 320 - PLAY_BOTTOM - 2);
  text(ctx, env.t(s.status.en.split(' · ')[0], s.status.zh.split(' · ')[0]), 8, 7, '#fff', 14);
  for (let i = 0; i < MAX_HP; i++) {
    ctx.fillStyle = i < w.hp ? '#ff4d6a' : '#3a2230';
    ctx.fillRect(150 + i * 16, 8, 12, 12);
  }
  text(ctx, env.t('Shield', '盾'), 250, 7, '#fff', 14);
  const e = s.sentinel;
  ctx.fillStyle = '#243049';
  ctx.fillRect(298, 9, 60, 10);
  ctx.fillStyle = e.broken > 0 ? COLORS.lance : COLORS.shield;
  ctx.fillRect(
    298,
    9,
    60 * (e.broken > 0 ? 1 - e.broken / BROKEN_TIME : e.energy / MAX_ENERGY),
    10,
  );
  text(ctx, env.t('Bash', '重击'), 366, 7, '#fff', 14);
  ctx.fillStyle = '#243049';
  ctx.fillRect(418, 9, 54, 10);
  ctx.fillStyle = e.bashCooldown > 0 ? '#7a6a3a' : COLORS.gold;
  ctx.fillRect(418, 9, 54 * (1 - e.bashCooldown / BASH_CD), 10);
  text(ctx, env.t(s.prompt.en, s.prompt.zh), 240, 301, '#fff', 14, 'center');
}

export function drawWorld(ctx, w, env) {
  drawFloor(ctx);
  for (const c of w.crawlers) {
    if (c.portal > 0) {
      ctx.fillStyle = 'rgba(176,76,255,0.55)';
      ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
      ctx.strokeStyle = '#d8c8ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(c.x - 13, c.y - 13, 26, 26);
      ctx.fillStyle = '#4a5578';
      for (const [dx, dy] of [
        [-15, -15],
        [11, -15],
        [-15, 11],
        [11, 11],
      ])
        ctx.fillRect(c.x + dx, c.y + dy, 4, 4);
    } else {
      ctx.fillStyle = '#c0d060';
      ctx.fillRect(c.x - c.hw, c.y - c.hh, c.hw * 2, c.hh * 2);
      ctx.fillStyle = '#2b3310';
      ctx.fillRect(c.x - 3, c.y - 2, 2, 2);
      ctx.fillRect(c.x + 1, c.y - 2, 2, 2);
    }
    if (c.stun > 0) text(ctx, '*', c.x, c.y - 14, COLORS.gold, 14, 'center');
  }
  for (const f of w.foes) if (f.hp > 0) drawTelegraph(ctx, f, w);
  for (const f of w.foes) if (f.hp > 0) drawFoe(ctx, f, env);
  drawSentinel(ctx, w);
  for (const s of w.shots) drawShot(ctx, s);
  for (const f of w.fx) {
    const k = f.t / f.life;
    ctx.strokeStyle = f.kind === 'hurt' ? '#ff4d6a' : COLORS.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 4 + (f.kind === 'slam' ? SLAM_R : 14) * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (w.introT > 0) {
    const n = WAVES[w.wave].name;
    text(ctx, `${env.t(n.en, n.zh)}  ${w.introT.toFixed(1)}s`, 240, 120, COLORS.gold, 16, 'center');
  }
  drawHud(ctx, w, env);
}
