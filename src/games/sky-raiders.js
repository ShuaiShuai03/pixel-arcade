import { clamp, drawPixelText as text, background } from '../shared/utils.js';

export const meta = {
  id: 'sky-raiders',
  name: { en: 'Sky Raiders', zh: '天空突袭' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Pilot a vector-thrust interceptor through six sectors and defeat their carriers. Hold Fire; let the cannon cool when hot. Break marked turrets before armored cores. Your three interception charges expand at a visible finite speed; use them before incoming rounds reach you. Supply pods and sector recharge restore shields.',
    zh: '驾驶矢量推进截击机穿越六片空域，击败航母。按住射击，炮口过热时等待冷却；先击破标记炮塔，再攻击装甲核心。三枚拦截弹以可见速度向外扩散，要在敌弹接近前使用。补给舱和区域充能可恢复护盾。',
  },
  keys: [
    {
      label: { en: 'Fly (assisted thrust / release to brake)', zh: '飞行（辅助推进，松开减速）' },
      keys: 'WASD / Arrows',
    },
    {
      label: { en: 'Hold fire / automatic cooling', zh: '按住射击 / 自动冷却' },
      keys: 'Space / J',
    },
    { label: { en: 'Interception charge (3 initially)', zh: '拦截弹（初始3枚）' }, keys: 'K / X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
    ['Space', 'Fire', '射击'],
    ['KeyK', 'Charge', '拦截弹'],
  ].map(([code, en, zh], i) => ({ code, side: i < 4 ? 'left' : 'right', label: { en, zh } })),
};
// Mass is in nominal kilograms; velocity is in logical pixels per second.
const ROUND_MASS = 0.04;
const STEP = 1 / 120,
  EPS = 1e-7,
  LIMIT = { minX: 24, maxX: 456, minY: 72, maxY: 288 };
const approach = (a, b, t) => (a < b ? Math.min(b, a + t) : Math.max(b, a - t));
const length = (v) => Math.hypot(v.vx, v.vy);
export const circleHit = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r;
const PLAYER = [
  '......aa......',
  '.....aaaa.....',
  '.....abba.....',
  '....aabbaa....',
  '...aaabbaaa...',
  '..aaaabbaaaa..',
  'aaaaaabbaaaaaa',
  'aaaaaabbaaaaaa',
  '..aaaccccaaa..',
  '...aaccccaa...',
  '...aa.aa.aa...',
  '...aa.aa.aa...',
  '....a....a....',
  '....a....a....',
];
const SCOUT = [
  '.....aa.....',
  '....aaaa....',
  '...aabbaa...',
  'aaa aabbaa aaa'.replaceAll(' ', ''),
  'aaaaabbaaaaa',
  '..aaacaaa...',
  '...aaaaaa...',
  '....a..a....',
  '....a..a....',
];
const SKIMMER = [
  'aa..........aa',
  'aaa........aaa',
  'aaaa..aa..aaaa',
  '.aaaaaaaaaaaa.',
  '..aaaabbaaaa..',
  '...aaabbaaa...',
  '....aacaaa....',
  '....aa..aa....',
  '.....a..a.....',
];
const GUNSHIP = [
  '....aaaaaa....',
  '...aabbbbaa...',
  '..aaabbbbaaa..',
  'aaaaaaaaaaaaaa',
  'aaccaaaaaaccaa',
  'aaccaaaaaaccaa',
  'aaaaaaaaaaaaaa',
  '..aaaccccaaa..',
  '...aaaaaaaa...',
  '...aa....aa...',
  '...aa....aa...',
];
function carrierRows() {
  const rows = Array.from({ length: 22 }, () => Array(40).fill('.'));
  const fill = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) rows[j][i] = c;
  };
  fill(10, 3, 20, 15, 'h');
  fill(6, 6, 28, 11, 'h');
  fill(0, 8, 40, 6, 'h');
  fill(3, 11, 7, 9, 'l');
  fill(30, 11, 7, 9, 'r');
  fill(17, 13, 6, 9, 'c');
  fill(14, 1, 12, 4, 'h');
  return rows.map((r) => r.join(''));
}
const ATLAS = {
  player: PLAYER,
  scout: SCOUT,
  skimmer: SKIMMER,
  gunship: GUNSHIP,
  carrier: carrierRows(),
};
const MASKS = {};
for (const [name, rows] of Object.entries(ATLAS)) {
  const width = Math.max(...rows.map((r) => r.length)),
    rects = [];
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length;) {
      const ch = rows[y][x];
      if (ch === '.') {
        x++;
        continue;
      }
      let end = x + 1;
      const part = name === 'carrier' ? ch : 'h';
      while (
        end < rows[y].length &&
        rows[y][end] !== '.' &&
        (name !== 'carrier' || rows[y][end] === ch)
      )
        end++;
      const previous = rects.find(
        (r) =>
          r.x === x * 2 - width &&
          r.w === (end - x) * 2 &&
          r.y + r.h === y * 2 - rows.length &&
          r.part === part,
      );
      if (previous) previous.h += 2;
      else rects.push({ x: x * 2 - width, y: y * 2 - rows.length, w: (end - x) * 2, h: 2, part });
      x = end;
    }
  MASKS[name] = { width: width * 2, height: rows.length * 2, rects };
}
export function hullRects(actor) {
  return (MASKS[actor.shape ?? (actor.boss ? 'carrier' : 'scout')] ?? MASKS.scout).rects
    .filter((r) => !actor.parts || !['l', 'r'].includes(r.part) || actor.parts[r.part] > 0)
    .map((r) => ({ ...r, x: r.x + actor.x, y: r.y + actor.y }));
}
function bounds(actor) {
  const m = MASKS[actor.shape ?? 'scout'] ?? MASKS.scout;
  return { x: actor.x - m.width / 2, y: actor.y - m.height / 2, w: m.width, h: m.height };
}
function overlap(a, b, pad = 0) {
  return (
    a.x + a.w >= b.x - pad &&
    a.x <= b.x + b.w + pad &&
    a.y + a.h >= b.y - pad &&
    a.y <= b.y + b.h + pad
  );
}
function bodyContact(a, b, dt = 0, margin = 0) {
  if (!overlap(bounds(a), bounds(b), margin + Math.max(length(a), length(b)) * dt)) return null;
  let earliest = null;
  for (const ra of hullRects(a))
    for (const rb of hullRects(b)) {
      const dx = ra.x + ra.w / 2 - rb.x - rb.w / 2,
        dy = ra.y + ra.h / 2 - rb.y - rb.h / 2;
      let enter = 0,
        exit = dt,
        normal = null,
        depth = Infinity,
        inside = null;
      for (const [d, v, r, nx, ny] of [
        [dx, a.vx - b.vx, (ra.w + rb.w) / 2, 1, 0],
        [dy, a.vy - b.vy, (ra.h + rb.h) / 2, 0, 1],
      ]) {
        const penetration = r - Math.abs(d);
        if (penetration < depth) {
          depth = penetration;
          inside = { nx: nx * (d >= 0 ? 1 : -1), ny: ny * (d >= 0 ? 1 : -1) };
        }
        if (Math.abs(v) < EPS) {
          if (Math.abs(d) > r + margin) {
            exit = -1;
            break;
          }
          continue;
        }
        const t1 = (-r - d) / v,
          t2 = (r - d) / v,
          near = Math.min(t1, t2),
          far = Math.max(t1, t2);
        if (near > enter) {
          enter = near;
          const sign = d + v * near >= 0 ? 1 : -1;
          normal = { nx: nx * sign, ny: ny * sign };
        }
        exit = Math.min(exit, far);
        if (enter > exit + EPS) break;
      }
      if (enter > exit + EPS || exit < -EPS || enter > dt + EPS) continue;
      normal ??= inside;
      if (
        enter <= EPS &&
        depth <= EPS &&
        (a.vx - b.vx) * normal.nx + (a.vy - b.vy) * normal.ny >= -EPS &&
        margin === 0
      )
        continue;
      const hit = { ...normal, time: Math.max(0, enter), penetration: Math.max(0, depth) };
      if (
        !earliest ||
        hit.time < earliest.time ||
        (hit.time === earliest.time && hit.penetration < earliest.penetration)
      )
        earliest = hit;
    }
  return earliest;
}
export function resolveHullImpact(a, b, { nx, ny }, restitution = 0.08) {
  const closing = -((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  if (closing <= 0) return 0;
  const impulse = ((1 + restitution) * closing) / (1 / a.mass + 1 / b.mass);
  a.vx += (impulse * nx) / a.mass;
  a.vy += (impulse * ny) / a.mass;
  b.vx -= (impulse * nx) / b.mass;
  b.vy -= (impulse * ny) / b.mass;
  return closing;
}
function thrust(body, h, dx, dy, config = {}) {
  let norm = Math.hypot(dx, dy);
  if (norm > 1) {
    dx /= norm;
    dy /= norm;
  }
  const speed = config.speed ?? 170,
    gain = config.gain ?? 18,
    maxAcceleration = config.acceleration ?? 1000,
    drag = config.drag ?? 0.8;
  let tx = dx * speed,
    ty = dy * speed;
  if (config.limits !== false) {
    const limit = config.limits ?? LIMIT;
    tx = clamp(tx, -3.8 * (body.x - limit.minX), 3.8 * (limit.maxX - body.x));
    ty = clamp(ty, -3.8 * (body.y - limit.minY), 3.8 * (limit.maxY - body.y));
  }
  let ax = (tx - body.vx) * gain - drag * body.vx,
    ay = (ty - body.vy) * gain - drag * body.vy;
  const acceleration = Math.hypot(ax, ay);
  if (acceleration > maxAcceleration) {
    ax *= maxAcceleration / acceleration;
    ay *= maxAcceleration / acceleration;
  }
  body.ax = ax;
  body.ay = ay;
  body.vx += ax * h;
  body.vy += ay * h;
}
/** Bounded vector-thrust and powered edge assistance; no position or velocity snap. */
export function advanceFlight(body, dt, command) {
  let rest = dt;
  if (!Number.isFinite(rest) || rest <= 0) return;
  while (rest > EPS) {
    const h = Math.min(STEP, rest),
      vx = body.vx,
      vy = body.vy;
    thrust(body, h, command.dx ?? 0, command.dy ?? 0);
    body.x += ((vx + body.vx) * h) / 2;
    body.y += ((vy + body.vy) * h) / 2;
    rest -= h;
  }
}
function circleRect(x, y, r, rect) {
  return (
    Math.hypot(x - clamp(x, rect.x, rect.x + rect.w), y - clamp(y, rect.y, rect.y + rect.h)) <=
    r + EPS
  );
}
function sweepCircleRect(x, y, vx, vy, r, rect, dt) {
  if (circleRect(x, y, r, rect)) {
    const cx = clamp(x, rect.x, rect.x + rect.w),
      cy = clamp(y, rect.y, rect.y + rect.h),
      dx = x - cx,
      dy = y - cy,
      distance = Math.hypot(dx, dy);
    if (
      distance < r - EPS ||
      (x > rect.x + EPS &&
        x < rect.x + rect.w - EPS &&
        y > rect.y + EPS &&
        y < rect.y + rect.h - EPS)
    )
      return 0;
    let nx = dx,
      ny = dy;
    if (distance < EPS) {
      nx = x <= rect.x + EPS ? -1 : x >= rect.x + rect.w - EPS ? 1 : 0;
      ny = y <= rect.y + EPS ? -1 : y >= rect.y + rect.h - EPS ? 1 : 0;
    }
    return vx * nx + vy * ny < -EPS ? 0 : null;
  }
  let best = Infinity;
  const consider = (t) => {
    if (t >= -EPS && t <= dt + EPS && circleRect(x + vx * t, y + vy * t, r, rect))
      best = Math.min(best, Math.max(0, t));
  };
  if (vx > 0) consider((rect.x - r - x) / vx);
  else if (vx < 0) consider((rect.x + rect.w + r - x) / vx);
  if (vy > 0) consider((rect.y - r - y) / vy);
  else if (vy < 0) consider((rect.y + rect.h + r - y) / vy);
  const speed = vx * vx + vy * vy;
  if (speed > EPS)
    for (const [cx, cy] of [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ]) {
      const dx = x - cx,
        dy = y - cy,
        b = 2 * (dx * vx + dy * vy),
        c = dx * dx + dy * dy - r * r,
        d = b * b - 4 * speed * c;
      if (d >= 0) consider((-b - Math.sqrt(d)) / (2 * speed));
    }
  return best === Infinity ? null : best;
}
function projectileContacts(projectile, target, dt) {
  const parts = new Map();
  for (const r of hullRects(target)) {
    const time = sweepCircleRect(
      projectile.x,
      projectile.y,
      projectile.vx - (target.vx ?? 0),
      projectile.vy - (target.vy ?? 0),
      projectile.r,
      r,
      dt,
    );
    if (time !== null && (!parts.has(r.part) || time < parts.get(r.part))) parts.set(r.part, time);
  }
  return [...parts].map(([part, time]) => ({ part, time }));
}
const partPriority = (part) => (['c', 'l', 'r'].includes(part) ? 0 : 1);
export function sweepProjectile(projectile, target, dt) {
  return (
    projectileContacts(projectile, target, dt).sort(
      (a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part),
    )[0] ?? null
  );
}
/** Dry hull plus a cartridge share launch momentum; the gun supplies the energy. */
export function fireRound(shooter, angle, speed, options = {}) {
  const mass = options.mass ?? ROUND_MASS,
    share = shooter.mass / (shooter.mass + mass),
    rx = Math.cos(angle) * speed,
    ry = Math.sin(angle) * speed;
  const bullet = {
    id: options.id ?? 0,
    x: options.x ?? shooter.x,
    y: options.y ?? shooter.y,
    vx: shooter.vx + rx * share,
    vy: shooter.vy + ry * share,
    r: options.r ?? 2,
    damage: options.damage ?? 1,
    mass,
    owner: options.owner ?? 'enemy',
    ownerId: shooter.id,
    life: 2.4,
  };
  shooter.vx -= (rx * mass) / (shooter.mass + mass);
  shooter.vy -= (ry * mass) / (shooter.mass + mass);
  return bullet;
}
const SECTORS = [
  {
    en: 'Cloudbreak',
    zh: '破云空域',
    color: '#26465d',
    sky: '#162c42',
    pattern: 'fan',
    kinds: ['scout', 'scout', 'scout', 'skimmer', 'scout', 'gunship'],
    core: 24,
    lesson: {
      en: 'Move across aimed fire; release Fire when the cannon overheats.',
      zh: '横向避开瞄准弹；炮口过热时等待冷却。',
    },
  },
  {
    en: 'Copper Coast',
    zh: '铜色海岸',
    color: '#6a5a56',
    sky: '#293e52',
    pattern: 'burst',
    kinds: ['skimmer', 'scout', 'skimmer', 'gunship', 'skimmer', 'scout'],
    core: 28,
    lesson: {
      en: 'Burst volleys follow the warning line, not your new position.',
      zh: '连射沿预警线发射，及时改变位置。',
    },
  },
  {
    en: 'Storm Channel',
    zh: '风暴航道',
    color: '#425778',
    sky: '#232f4c',
    pattern: 'gap',
    kinds: ['gunship', 'skimmer', 'scout', 'gunship', 'skimmer', 'scout', 'gunship'],
    core: 30,
    lesson: {
      en: 'Slow fans leave gaps. Fire into the carrier recovery window.',
      zh: '慢速扇形弹幕留有空隙，趁航母收招时攻击。',
    },
  },
  {
    en: 'Night Convoy',
    zh: '夜间船团',
    color: '#344c62',
    sky: '#14273c',
    pattern: 'turrets',
    kinds: ['gunship', 'scout', 'skimmer', 'gunship', 'skimmer', 'gunship', 'scout'],
    core: 28,
    parts: true,
    lesson: {
      en: 'Break the two hanging turrets, then aim at the gold core.',
      zh: '先摧毁两侧炮塔，再攻击金色核心。',
    },
  },
  {
    en: 'Cinder Gate',
    zh: '余烬之门',
    color: '#74525c',
    sky: '#352f45',
    pattern: 'beam',
    kinds: ['skimmer', 'gunship', 'scout', 'gunship', 'skimmer', 'gunship'],
    core: 28,
    lesson: {
      en: 'The charged cannon commits to its line. Strike after the volley.',
      zh: '蓄能炮沿预警线发射，齐射后抓住攻击机会。',
    },
  },
  {
    en: 'Regent Carrier',
    zh: '摄政航母',
    color: '#635575',
    sky: '#302c49',
    pattern: 'master',
    kinds: ['scout', 'gunship', 'skimmer', 'gunship', 'skimmer', 'gunship', 'scout', 'gunship'],
    core: 36,
    parts: true,
    lesson: {
      en: 'Break the turrets and combine movement, cooling and interception.',
      zh: '击破炮塔，结合移动、冷却与拦截完成决战。',
    },
  },
];
export function createSkyState() {
  return {
    phase: 'playing',
    score: 0,
    level: 1,
    lives: 3,
    pulses: 3,
    elapsed: 0,
    sectorTime: 0,
    spawned: 0,
    quota: SECTORS[0].kinds.length,
    spawnClock: 1.3,
    carrierSpawned: false,
    transition: 0,
    cleanup: false,
    shotClock: 0,
    chargeClock: 0,
    pulseWasDown: false,
    nextId: 1,
    kills: 0,
    damageCause: '',
    player: {
      id: 0,
      shape: 'player',
      x: 240,
      y: 270,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      mass: 80,
      power: 1,
      heat: 0,
      overheated: false,
      invincible: 1.5,
    },
    enemies: [],
    bullets: [],
    pickups: [],
    waves: [],
    particles: [],
    damageFlash: 0,
  };
}
function burst(s, env, x, y, color, count = 8) {
  for (let n = 0; n < count; n++)
    s.particles.push({
      x,
      y,
      vx: (env.random() - 0.5) * 110,
      vy: (env.random() - 0.5) * 110,
      life: 0.4,
      color,
    });
  if (s.particles.length > 160) s.particles.splice(0, s.particles.length - 160);
}
function hitPlayer(s, env, damage, cause) {
  if (damage <= 0 || s.player.invincible > 0 || s.lives <= 0) return;
  s.lives = Math.max(0, s.lives - Math.min(1, damage));
  s.player.invincible = 0.95;
  s.damageFlash = 0.22;
  s.damageCause = cause;
  burst(s, env, s.player.x, s.player.y, '#a8edee', 12);
  env.sound('hit');
}
function openCore(enemy) {
  return (!enemy.parts || (enemy.parts.l <= 0 && enemy.parts.r <= 0)) && enemy.open !== false;
}
function hitEnemy(s, env, enemy, damage, part, credit, coreAvailable = openCore(enemy)) {
  if (enemy.dead) return;
  if (enemy.parts && ['l', 'r'].includes(part) && enemy.parts[part] > 0) {
    enemy.parts[part] = Math.max(0, enemy.parts[part] - damage);
    enemy.flash = 0.1;
    return;
  }
  if (enemy.boss && (!coreAvailable || part !== 'c')) {
    burst(s, env, enemy.x, enemy.y + 15, '#a5b1be', 3);
    return;
  }
  enemy.hp -= damage;
  enemy.flash = 0.1;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.dead = true;
    enemy.credited = !!credit;
    if (credit) {
      s.kills++;
      s.score += enemy.boss ? 500 * s.level : enemy.shape === 'gunship' ? 180 : 100;
    }
    burst(s, env, enemy.x, enemy.y, '#f7c383', enemy.boss ? 28 : 10);
    env.sound('coin');
    if (!enemy.boss && credit && s.kills % 3 === 0)
      s.pickups.push({
        id: s.nextId++,
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx * 0.3,
        vy: 25,
        kind: s.kills % 6 === 0 ? 'shield' : 'power',
        life: 10,
      });
  }
}
function movingCircle(a, b, dt) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    vx = a.vx - b.vx,
    vy = a.vy - b.vy,
    r = a.r + b.r,
    c = dx * dx + dy * dy - r * r;
  if (c < -EPS) return 0;
  if (c <= EPS) return dx * vx + dy * vy < -EPS ? 0 : null;
  const aa = vx * vx + vy * vy,
    bb = 2 * (dx * vx + dy * vy),
    d = bb * bb - 4 * aa * c;
  if (aa < EPS || d < 0) return null;
  const t = (-bb - Math.sqrt(d)) / (2 * aa);
  return t >= 0 && t <= dt ? t : null;
}
function waveTime(w, object, dt) {
  const radius = object.r ?? 0,
    old = Math.hypot(object.x - w.x, object.y - w.y) - radius;
  if (w.radius > EPS && old < w.radius - EPS) return null;
  const at = (t) =>
    Math.hypot(object.x + object.vx * t - w.x, object.y + object.vy * t - w.y) -
    radius -
    w.radius -
    w.speed * t;
  if (at(0) <= 0) return 0;
  if (at(dt) > 0) return null;
  let lo = 0,
    hi = dt;
  for (let n = 0; n < 16; n++) {
    const m = (lo + hi) / 2;
    if (at(m) > 0) lo = m;
    else hi = m;
  }
  return hi;
}
function waveHullContacts(w, actor, dt) {
  const parts = new Map();
  for (const r of hullRects(actor)) {
    const distance = (t) =>
      Math.hypot(
        w.x - clamp(w.x, r.x + actor.vx * t, r.x + r.w + actor.vx * t),
        w.y - clamp(w.y, r.y + actor.vy * t, r.y + r.h + actor.vy * t),
      );
    const old = distance(0);
    if (w.radius > EPS && old < w.radius - EPS) continue;
    const at = (t) => distance(t) - w.radius - w.speed * t;
    if (at(dt) > 0) continue;
    let lo = 0,
      hi = dt;
    if (at(0) <= 0) hi = 0;
    else
      for (let n = 0; n < 18; n++) {
        const m = (lo + hi) / 2;
        if (at(m) > 0) lo = m;
        else hi = m;
      }
    if (!parts.has(r.part) || hi < parts.get(r.part)) parts.set(r.part, hi);
  }
  return [...parts].map(([part, time]) => ({ part, time }));
}
function pickupTime(p, player, dt) {
  let nearest = null;
  for (const r of hullRects(player)) {
    const time = sweepCircleRect(
      p.x,
      p.y,
      p.vx - player.vx,
      p.vy - player.vy,
      0,
      { x: r.x - 7, y: r.y - 7, w: r.w + 14, h: r.h + 14 },
      dt,
    );
    if (time !== null && (nearest === null || time < nearest)) nearest = time;
  }
  return nearest;
}
/** Replan at every physical event: destroyed geometry cannot affect a later trajectory. */
export function resolveProjectileStep(s, dt, env, integrateHulls = false) {
  const actors = [s.player, ...s.enemies],
    original = actors.map((a) => ({ x: a.x, y: a.y })),
    spent = new Set(),
    contacts = new Map();
  let remaining = dt;
  const advance = (h) => {
    for (const a of actors)
      if (!a.dead) {
        a.x += a.vx * h;
        a.y += a.vy * h;
      }
    for (const b of s.bullets)
      if (!spent.has(b.id)) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.life -= h;
      }
    for (const w of s.waves) {
      w.radius += w.speed * h;
      w.life -= h;
    }
    for (const p of s.pickups)
      if (!p.collected) {
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.life -= h;
      }
  };
  const settleContacts = () => {
    for (const [key, e] of contacts) {
      if (e.a.dead || e.b.dead || !bodyContact(e.a, e.b, 0, 1e-6)) contacts.delete(key);
    }
    for (let pass = 0; pass < 64; pass++) {
      let change = 0;
      for (const e of contacts.values())
        change = Math.max(change, resolveHullImpact(e.a, e.b, e, 0));
      if (change < EPS) break;
    }
  };
  // Each event consumes a projectile, pickup, wave target or previously unseen hull pair.
  // Rebuilding the queue also accounts for velocity changes from hull impulses.
  while (remaining > EPS) {
    settleContacts();
    const events = [];
    for (const bullet of s.bullets) {
      if (spent.has(bullet.id) || bullet.life <= 0) continue;
      for (const actor of actors) {
        if (
          actor.id === bullet.ownerId ||
          actor.dead ||
          (bullet.owner === 'player' && actor.id === 0)
        )
          continue;
        const hit = sweepProjectile(bullet, actor, Math.min(remaining, bullet.life));
        if (hit) events.push({ ...hit, type: 'hull', bullet, actor });
      }
    }
    for (let i = 0; i < s.bullets.length; i++)
      for (let j = i + 1; j < s.bullets.length; j++) {
        const a = s.bullets[i],
          b = s.bullets[j];
        if (spent.has(a.id) || spent.has(b.id) || a.life <= 0 || b.life <= 0 || a.owner === b.owner)
          continue;
        const time = movingCircle(a, b, Math.min(remaining, a.life, b.life));
        if (time !== null) events.push({ time, type: 'rounds', a, b });
      }
    for (const wave of s.waves) {
      if (wave.life <= 0 || wave.energy <= 0 || wave.radius >= wave.maxRadius) continue;
      const horizon = Math.min(remaining, wave.life, (wave.maxRadius - wave.radius) / wave.speed);
      for (const bullet of s.bullets)
        if (
          !spent.has(bullet.id) &&
          bullet.life > 0 &&
          bullet.owner === 'enemy' &&
          !wave.hit.includes(`b${bullet.id}`) &&
          wave.energy > 0.2
        ) {
          const time = waveTime(wave, bullet, Math.min(horizon, bullet.life));
          if (time !== null) events.push({ time, type: 'waveRound', wave, bullet });
        }
      for (const actor of actors)
        if (actor.id !== 0 && !actor.dead && !wave.hit.includes(`e${actor.id}`)) {
          const hit = waveHullContacts(wave, actor, horizon).sort(
            (a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part),
          )[0];
          if (hit) events.push({ ...hit, type: 'waveHull', wave, actor });
        }
    }
    for (const pod of s.pickups)
      if (!pod.collected && pod.life > 0 && s.lives > 0) {
        const time = pickupTime(pod, s.player, Math.min(remaining, pod.life));
        if (time !== null) events.push({ time, type: 'pickup', pod });
      }
    if (integrateHulls)
      for (let i = 0; i < actors.length; i++)
        for (let j = i + 1; j < actors.length; j++) {
          const a = actors[i],
            b = actors[j],
            key = `${a.id}:${b.id}`;
          if (a.dead || b.dead || contacts.has(key)) continue;
          const hit = bodyContact(a, b, remaining);
          if (hit) events.push({ ...hit, type: 'body', a, b, key });
        }
    if (!events.length) {
      advance(remaining);
      remaining = 0;
      break;
    }
    events.sort((a, b) => a.time - b.time || partPriority(a.part) - partPriority(b.part));
    const time = Math.min(remaining, events[0].time),
      group = events.filter((e) => Math.abs(e.time - time) < EPS);
    advance(time);
    remaining -= time;
    const damages = new Map(),
      impacts = new Map(),
      newSpent = new Set();
    let playerDamage = 0,
      collisionDamage = 0;
    // Supplies at this instant are collected before simultaneous damage. A previous fatal event stays fatal.
    for (const e of group)
      if (e.type === 'pickup' && !e.pod.collected && s.lives > 0) {
        e.pod.collected = true;
        if (e.pod.kind === 'shield') s.lives = Math.min(4, s.lives + 1);
        else if (e.pod.kind === 'charge') s.pulses = Math.min(3, s.pulses + 1);
        else s.player.power = Math.min(3, s.player.power + 1);
        s.score += 50;
        env.sound('coin');
      }
    const addDamage = (actor, part, damage, credit) => {
      const key = `${actor.id}:${part}`,
        entry = damages.get(key) ?? {
          actor,
          part,
          damage: 0,
          credit: false,
          coreAvailable: openCore(actor),
        };
      entry.damage += damage;
      entry.credit ||= credit;
      damages.set(key, entry);
    };
    for (const e of group) {
      if (
        e.type === 'hull' &&
        !spent.has(e.bullet.id) &&
        !newSpent.has(e.bullet.id) &&
        !e.actor.dead
      ) {
        newSpent.add(e.bullet.id);
        const impact = impacts.get(e.actor.id) ?? { actor: e.actor, mass: 0, px: 0, py: 0 };
        impact.mass += e.bullet.mass;
        impact.px += e.bullet.mass * e.bullet.vx;
        impact.py += e.bullet.mass * e.bullet.vy;
        impacts.set(e.actor.id, impact);
        if (e.actor.id === 0) playerDamage++;
        else addDamage(e.actor, e.part, e.bullet.damage, e.bullet.owner === 'player');
      } else if (e.type === 'rounds' && !spent.has(e.a.id) && !spent.has(e.b.id)) {
        newSpent.add(e.a.id);
        newSpent.add(e.b.id);
      } else if (e.type === 'waveRound' && !spent.has(e.bullet.id) && e.wave.energy > 0.2) {
        newSpent.add(e.bullet.id);
        e.wave.energy -= 0.2;
        e.wave.hit.push(`b${e.bullet.id}`);
      } else if (
        e.type === 'waveHull' &&
        !e.actor.dead &&
        e.wave.energy > 0 &&
        !e.wave.hit.includes(`e${e.actor.id}`)
      ) {
        const damage = Math.min(e.actor.boss ? 7 : 4, e.wave.energy);
        e.wave.energy -= damage;
        e.wave.hit.push(`e${e.actor.id}`);
        addDamage(e.actor, e.part, damage, true);
      } else if (e.type === 'body' && !e.a.dead && !e.b.dead) {
        contacts.set(e.key, e);
        const closing = resolveHullImpact(e.a, e.b, e);
        if ((e.a.id === 0 || e.b.id === 0) && closing > 45) collisionDamage++;
      }
    }
    // Absorbed cartridges add their mass and momentum; thrusters correct the small kick next tick.
    for (const { actor, mass, px, py } of impacts.values()) {
      actor.vx = (actor.mass * actor.vx + px) / (actor.mass + mass);
      actor.vy = (actor.mass * actor.vy + py) / (actor.mass + mass);
      actor.mass += mass;
    }
    settleContacts();
    for (const id of newSpent) spent.add(id);
    for (const e of damages.values())
      hitEnemy(s, env, e.actor, e.damage, e.part, e.credit, e.coreAvailable);
    hitPlayer(s, env, playerDamage + collisionDamage, collisionDamage ? 'collision' : 'round');
  }
  if (!integrateHulls)
    for (let i = 0; i < actors.length; i++) Object.assign(actors[i], original[i]);
  s.bullets = s.bullets.filter(
    (b) => !spent.has(b.id) && b.life > 0 && b.x > -40 && b.x < 520 && b.y > -60 && b.y < 350,
  );
  s.waves = s.waves.filter((w) => w.radius < w.maxRadius && w.life > 0 && w.energy > 0);
}
function makeEnemy(s, kind, index) {
  const lane = [70, 175, 305, 410][index % 4],
    shape = kind === 'gunship' ? 'gunship' : kind === 'skimmer' ? 'skimmer' : 'scout';
  return {
    id: s.nextId++,
    shape,
    x: lane,
    y: -36,
    vx: 0,
    vy: 38,
    mass: kind === 'gunship' ? 100 : 50,
    hp: kind === 'gunship' ? 5 : 2,
    maxHp: kind === 'gunship' ? 5 : 2,
    age: 0,
    ai: true,
    kind,
    homeX: lane,
    shotClock: 1.2,
    burst: 0,
    burstClock: 0,
    fired: 0,
    phase: 'enter',
    entryWarning: true,
    tell: 0,
    angle: Math.PI / 2,
    flash: 0,
    dead: false,
  };
}
function makeCarrier(s) {
  const sector = SECTORS[s.level - 1];
  return {
    id: s.nextId++,
    shape: 'carrier',
    x: 240,
    y: -48,
    vx: 0,
    vy: 25,
    mass: 500,
    hp: sector.core,
    maxHp: sector.core,
    boss: true,
    script: true,
    age: 0,
    shotClock: 2,
    tell: 0,
    angle: Math.PI / 2,
    flash: 0,
    dead: false,
    parts: sector.parts ? { l: 9, r: 9 } : null,
    open: true,
    phase: 'enter',
    fired: 0,
    burst: 0,
    burstClock: 0,
  };
}
function muzzlePoint(e, offset = 0) {
  return { x: e.x + offset, y: e.y + (MASKS[e.shape]?.height ?? 20) / 2 + 4 };
}
function attackPattern(s, e) {
  const base = e.boss
    ? SECTORS[s.level - 1].pattern
    : e.kind === 'gunship'
      ? 'fan'
      : e.kind === 'skimmer'
        ? 'burst'
        : 'aim';
  if (base !== 'master') return base;
  if (e.fired % 3 === 2) return 'beam';
  if (e.parts && (e.parts.l > 0 || e.parts.r > 0)) return 'turrets';
  return e.fired % 3 === 1 ? 'burst' : 'fan';
}
function volleyPlan(e) {
  const pattern = e.attackKind ?? 'aim';
  if (pattern === 'beam' || pattern === 'burst') return [{ angle: e.angle, speed: 125, offset: 0 }];
  if (pattern === 'turrets')
    return [-1, 1]
      .filter((side) => !e.parts || e.parts[side < 0 ? 'l' : 'r'] > 0)
      .map((side) => ({ angle: e.angle, speed: 90, offset: side * 26 }));
  const spreads =
    pattern === 'gap'
      ? [-0.72, -0.48, -0.24, 0.24, 0.48, 0.72]
      : pattern === 'fan'
        ? [-0.3, 0, 0.3]
        : [0];
  return spreads.map((spread) => ({ angle: e.angle + spread, speed: e.boss ? 87 : 95, offset: 0 }));
}
/** Gyro-mounted guns compensate hull drift; warning rays show their world velocity. */
export function warningRays(e) {
  return volleyPlan(e).map((plan) => ({
    origin: muzzlePoint(e, plan.offset),
    vx: Math.cos(plan.angle) * plan.speed,
    vy: Math.sin(plan.angle) * plan.speed,
  }));
}
function emit(s, e, angle, speed, env, offset = 0) {
  const origin = muzzlePoint(e, offset),
    mass = ROUND_MASS,
    share = e.mass / (e.mass + mass);
  const rx = (Math.cos(angle) * speed - e.vx) / share,
    ry = (Math.sin(angle) * speed - e.vy) / share;
  const b = fireRound(e, Math.atan2(ry, rx), Math.hypot(rx, ry), {
    id: s.nextId++,
    owner: 'enemy',
    x: origin.x,
    y: origin.y,
    r: 3,
    mass,
  });
  b.aimAngle = angle;
  s.bullets.push(b);
}
function enemyAttack(s, e, dt, env) {
  if (e.age < 1.5 || e.y < 60 || e.y > 218) return;
  e.shotClock = Math.max(0, e.shotClock - dt);
  e.burstClock = Math.max(0, e.burstClock - dt);
  if (e.burst > 0 && e.burstClock === 0) {
    emit(s, e, e.angle, 125, env);
    e.burst--;
    e.burstClock = 0.09;
    e.phase = e.burst ? 'fire' : 'recover';
  }
  if (e.tell > 0) {
    e.tell = Math.max(0, e.tell - dt);
    if (e.tell === 0) {
      if (e.attackKind === 'beam' || e.attackKind === 'burst') {
        e.burst = e.attackKind === 'beam' ? 6 : 3;
        e.burstClock = 0;
        e.phase = 'fire';
      } else {
        for (const plan of volleyPlan(e)) emit(s, e, plan.angle, plan.speed, env, plan.offset);
        e.phase = 'recover';
      }
      e.fired++;
      e.shotClock = e.boss ? 1.65 : 2.1;
    }
  } else if (e.shotClock === 0 && e.burst === 0 && s.player.y >= e.y + 40) {
    e.attackKind = attackPattern(s, e);
    e.aim = { x: s.player.x, y: s.player.y };
    const origin = muzzlePoint(e);
    e.angle = Math.atan2(e.aim.y - origin.y, e.aim.x - origin.x);
    e.tell = e.attackKind === 'beam' ? 1 : 0.55;
    e.phase = 'charge';
  }
  if (e.boss) {
    const p = SECTORS[s.level - 1].pattern;
    e.open = !(p === 'gap' || p === 'beam') || e.phase === 'recover';
  }
}

function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t('All six carriers destroyed. The route is clear!', '六艘航母全部击破，航线已清空！')
      : s.damageCause === 'collision'
        ? env.t(
            'Hull collision exhausted your shields. Give large ships room.',
            '机体碰撞耗尽了护盾，请与大型舰船保持距离。',
          )
        : env.t(
            'Incoming fire exhausted your shields. Move across warning lines and use charges early.',
            '敌方炮火耗尽了护盾。横向避开预警线，提前使用拦截弹。',
          ),
  });
}
function tick(s, h, input, env) {
  s.elapsed += h;
  s.damageFlash = Math.max(0, s.damageFlash - h);
  s.sectorTime += h;
  s.player.invincible = Math.max(0, s.player.invincible - h);
  s.shotClock = Math.max(0, s.shotClock - h);
  s.chargeClock = Math.max(0, s.chargeClock - h);
  s.player.heat = Math.max(0, s.player.heat - 24 * h);
  if (s.player.overheated && s.player.heat <= 40) s.player.overheated = false;
  const dx = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    dy = Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW'));
  thrust(s.player, h, dx, dy);
  const pulseDown = input.held('KeyK', 'KeyX'),
    pulsePress = input.pressed('KeyK', 'KeyX') || (pulseDown && !s.pulseWasDown);
  s.pulseWasDown = pulseDown;
  {
    if (input.held('Space', 'KeyJ') && s.shotClock === 0 && !s.player.overheated) {
      const angles =
        s.player.power === 3 ? [-0.11, 0, 0.11] : s.player.power === 2 ? [-0.045, 0.045] : [0];
      for (const angle of angles)
        s.bullets.push(
          fireRound(s.player, -Math.PI / 2 + angle, 330, {
            id: s.nextId++,
            owner: 'player',
            x: s.player.x,
            y: s.player.y - 19,
            r: 2,
          }),
        );
      s.shotClock = 0.16;
      s.player.heat = Math.min(100, s.player.heat + 6);
      if (s.player.heat >= 100) s.player.overheated = true;
      env.sound('shoot');
    }
    if (pulsePress && s.pulses > 0 && s.chargeClock === 0) {
      s.pulses--;
      s.chargeClock = 0.5;
      s.waves.push({
        id: s.nextId++,
        x: s.player.x,
        y: s.player.y,
        radius: 0,
        speed: 420,
        maxRadius: 520,
        energy: 36,
        life: 1.3,
        hit: [],
      });
      env.sound('hit');
    }
  }
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.age = (e.age ?? 0) + h;
    e.flash = Math.max(0, (e.flash ?? 0) - h);
    if (e.ai) {
      const targetX =
        e.homeX +
        (e.kind === 'skimmer'
          ? Math.sin(e.age * 1.25) * 80
          : e.kind === 'gunship'
            ? Math.sin(e.age * 0.6) * 35
            : 0);
      thrust(e, h, (targetX - e.x) / 80, 1, {
        speed: e.kind === 'gunship' ? 31 : 46,
        gain: 4,
        acceleration: 160,
        drag: 0.3,
        limits: false,
      });
      enemyAttack(s, e, h, env);
    } else if (e.script) {
      const targetX = 240 + Math.sin(e.age * 0.42) * 125,
        targetY = 88;
      thrust(
        e,
        h,
        e.attackKind === 'beam' && ['charge', 'fire'].includes(e.phase) ? 0 : (targetX - e.x) / 70,
        (targetY - e.y) / 65,
        { speed: 48, gain: 4, acceleration: 180, drag: 0.4, limits: false },
      );
      enemyAttack(s, e, h, env);
    }
  }
  resolveProjectileStep(s, h, env, true);
  for (const e of s.enemies) e.entryWarning = e.y < 80;
  for (const p of s.pickups) {
    p.vx *= Math.exp(-0.6 * h);
  }
  s.pickups = s.pickups.filter((p) => !p.collected && p.life > 0 && p.y < 340);
  s.particles = s.particles.filter((p) => (p.life -= h) > 0);
  for (const p of s.particles) {
    p.x += p.vx * h;
    p.y += p.vy * h;
    p.vx *= Math.exp(-h);
    p.vy *= Math.exp(-h);
  }
  if (s.lives <= 0) {
    finish(s, env, false);
    return;
  }
  if (s.transition > 0) {
    s.transition = Math.max(0, s.transition - h);
    if (s.transition === 0) {
      if (s.level === 6) {
        finish(s, env, true);
        return;
      }
      s.level++;
      s.quota = SECTORS[s.level - 1].kinds.length;
      s.spawned = 0;
      s.spawnClock = 1.3;
      s.carrierSpawned = false;
      s.cleanup = false;
      s.sectorTime = 0;
      s.enemies = [];
      s.lives = Math.min(4, s.lives + 1);
    }
    return;
  }
  const boss = s.enemies.find((e) => e.boss);
  if (boss?.dead) s.cleanup = true;
  if (s.cleanup) {
    if (!s.bullets.some((b) => b.owner === 'enemy')) {
      s.cleanup = false;
      s.transition = 1.8;
      s.score += s.lives * 100;
    }
    return;
  }
  s.enemies = s.enemies.filter((e) => !e.dead && e.y < 350);
  s.spawnClock = Math.max(0, s.spawnClock - h);
  if (s.spawned < s.quota && s.spawnClock === 0) {
    const kind = SECTORS[s.level - 1].kinds[s.spawned],
      e = makeEnemy(s, kind, s.spawned + s.level);
    s.enemies.push(e);
    s.spawned++;
    s.spawnClock = 1.4;
  }
  if (s.spawned === s.quota && s.enemies.length === 0 && !s.carrierSpawned) {
    s.enemies.push(makeCarrier(s));
    s.carrierSpawned = true;
  }
}
export function stepSky(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  if (s.lives <= 0) {
    finish(s, env, false);
    return;
  }
  let remaining = Math.min(dt, 1 / 30),
    first = true;
  while (remaining > EPS && s.phase === 'playing') {
    const h = Math.min(STEP, remaining);
    tick(s, h, first ? input : { ...input, pressed: () => false }, env);
    remaining -= h;
    first = false;
  }
}
function drawActor(ctx, actor, s) {
  const rows = ATLAS[actor.shape] ?? SCOUT,
    w = Math.max(...rows.map((r) => r.length)),
    h = rows.length,
    pal =
      actor.id === 0
        ? { a: '#78d7df', b: '#e6f7eb', c: '#3b899d' }
        : {
            a: actor.shape === 'gunship' ? '#b99cbd' : '#e58f78',
            b: '#ffdb9a',
            c: '#664960',
            h: '#a384a9',
            l: '#d9ad87',
            r: '#d9ad87',
            c: openCore(actor) ? '#f7de9a' : '#727c96',
          };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.' || (actor.parts && ['l', 'r'].includes(c) && actor.parts[c] <= 0)) continue;
      ctx.fillStyle = actor.flash > 0 ? '#f9ead2' : (pal[c] ?? pal.a);
      ctx.fillRect(Math.round(actor.x - w + x * 2), Math.round(actor.y - h + y * 2), 2, 2);
    }
  if (actor.id === 0) {
    ctx.fillStyle = '#e9b578';
    ctx.fillRect(actor.x - 8, actor.y + 14, 4, 5 + (Math.floor(s.elapsed * 20) % 4));
    ctx.fillRect(actor.x + 4, actor.y + 14, 4, 5 + (Math.floor(s.elapsed * 20) % 4));
    ctx.fillStyle = '#294553';
    ctx.fillRect(actor.x - 14, actor.y + 24, 28, 2);
    ctx.fillStyle = actor.overheated ? '#ef997a' : '#8ccec8';
    ctx.fillRect(actor.x - 14, actor.y + 24, (28 * actor.heat) / 100, 2);
    if (actor.invincible > 0) {
      ctx.strokeStyle = '#c4f7f5';
      const b = bounds(actor);
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    }
  }
  if (actor.boss) {
    if (actor.parts)
      for (const [part, offset] of [
        ['l', -26],
        ['r', 26],
      ]) {
        if (actor.parts[part] <= 0) continue;
        ctx.fillStyle = '#4b3e50';
        ctx.fillRect(actor.x + offset - 8, actor.y + 25, 16, 2);
        ctx.fillStyle = '#e6bd8f';
        ctx.fillRect(actor.x + offset - 8, actor.y + 25, (16 * actor.parts[part]) / 9, 2);
      }
    if (openCore(actor)) {
      ctx.strokeStyle = '#f2d9a7';
      ctx.lineWidth = 1;
      ctx.strokeRect(actor.x - 8, actor.y + 4, 16, 15);
    }
  }
  if (actor.tell > 0) {
    text(ctx, '!', actor.x, actor.y - 26, '#ffe0a0', 13, 'center');
    ctx.strokeStyle = '#e4ad7355';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const ray of warningRays(actor)) {
      ctx.moveTo(ray.origin.x, ray.origin.y);
      ctx.lineTo(ray.origin.x + ray.vx * 4, ray.origin.y + ray.vy * 4);
    }
    ctx.stroke();
  }
}
function drawCloud(ctx, x, y, size, base, light) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y + 6, size, 10);
  ctx.fillRect(x + 9, y, size - 20, 22);
  ctx.fillRect(x + 21, y - 5, size - 41, 10);
  ctx.fillStyle = light;
  ctx.fillRect(x + 10, y + 1, size - 26, 3);
  ctx.fillRect(x + 2, y + 8, 12, 2);
}
function drawIsland(ctx, x, y, width, land, rim) {
  ctx.fillStyle = rim;
  ctx.fillRect(x + 9, y, width - 18, 7);
  ctx.fillRect(x, y + 7, width, 24);
  ctx.fillRect(x + 12, y + 31, width - 28, 10);
  ctx.fillStyle = land;
  ctx.fillRect(x + 13, y + 5, width - 28, 7);
  ctx.fillRect(x + 5, y + 12, width - 13, 15);
  ctx.fillRect(x + 20, y + 27, width - 43, 7);
}
function drawEnvironment(ctx, s, sector) {
  background(ctx, sector.sky);
  const scroll = s.elapsed * 15;
  // The ground layer moves more slowly than the clouds to preserve flight depth.
  if (s.level === 2 || s.level === 4) {
    for (let n = 0; n < 34; n++) {
      const x = (n * 97) % 480,
        y = ((n * 41 + scroll * 0.45) % 350) - 20;
      ctx.fillStyle = s.level === 2 ? '#334b5b' : '#1b3449';
      ctx.fillRect(x, y, 8 + (n % 4) * 5, 2);
    }
    if (s.level === 2) {
      for (let n = 0; n < 6; n++)
        drawIsland(
          ctx,
          n % 2 ? 385 : -28,
          ((n * 93 + scroll * 0.7) % 540) - 80,
          120,
          '#474a4a',
          '#70665a',
        );
    } else {
      for (let n = 0; n < 5; n++) {
        const x = 50 + n * 92,
          y = ((n * 89 + scroll * 0.65) % 450) - 65;
        ctx.fillStyle = '#243c50';
        ctx.fillRect(x - 7, y, 14, 52);
        ctx.fillRect(x - 4, y - 5, 8, 62);
        ctx.fillStyle = '#30475b';
        ctx.fillRect(x - 4, y + 10, 8, 28);
        ctx.fillRect(x - 2, y + 3, 4, 7);
        ctx.fillStyle = '#6e7360';
        ctx.fillRect(x - 2, y + 17, 2, 3);
        ctx.fillStyle = '#2c4557';
        ctx.fillRect(x - 8, y + 58, 2, 12);
        ctx.fillRect(x + 6, y + 58, 2, 12);
      }
    }
  }
  if (s.level === 5) {
    for (let n = 0; n < 8; n++) {
      const x = ((n * 163) % 510) - 30,
        y = ((n * 117 + scroll * 0.6) % 510) - 80;
      drawIsland(ctx, x, y, 76, '#49394b', '#634650');
      ctx.fillStyle = '#8b5b59';
      ctx.fillRect(x + 23, y + 12, 21, 3);
      ctx.fillRect(x + 38, y + 15, 4, 10);
    }
    for (let n = 0; n < 20; n++) {
      ctx.fillStyle = n % 3 ? '#6e4e57' : '#986d61';
      ctx.fillRect((n * 79 + s.elapsed * 4) % 480, (n * 61 + scroll) % 320, 2, 2);
    }
  }
  if (s.level === 6) {
    for (let n = 0; n < 4; n++) {
      const x = n % 2 ? 422 : -4,
        y = ((n * 121 + scroll * 0.5) % 490) - 90;
      ctx.fillStyle = '#3d3756';
      ctx.fillRect(x, y, 64, 89);
      ctx.fillRect(x - 8, y + 20, 80, 42);
      ctx.fillStyle = '#51455f';
      ctx.fillRect(x + 12, y + 9, 38, 6);
      ctx.fillRect(x + 12, y + 72, 38, 4);
      ctx.fillStyle = '#74636c';
      ctx.fillRect(x + 28, y + 23, 5, 9);
      ctx.fillRect(x + 28, y + 51, 5, 9);
    }
  }
  const cloudCount = s.level === 1 || s.level === 3 ? 14 : 6;
  for (let n = 0; n < cloudCount; n++) {
    const x = ((n * 139 + Math.floor(s.elapsed * (n % 2 ? 2 : -2)) + 600) % 600) - 70,
      y = ((n * 83 + scroll * (n % 2 ? 1.2 : 1)) % 410) - 55;
    drawCloud(
      ctx,
      x,
      y,
      64 + (n % 3) * 18,
      sector.color,
      s.level === 1 ? '#31556a' : s.level === 3 ? '#4a5e7b' : sector.color,
    );
  }
  if (s.level === 3) {
    ctx.strokeStyle = '#596888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let n = 0; n < 26; n++) {
      const x = (n * 113 + s.elapsed * 20) % 480,
        y = ((n * 53 + s.elapsed * 130) % 350) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 10);
    }
    ctx.stroke();
  }
}
function drawSky(ctx, s, env) {
  const sector = SECTORS[s.level - 1];
  drawEnvironment(ctx, s, sector);
  for (const p of s.pickups) {
    ctx.fillStyle = p.kind === 'shield' ? '#89ddbd' : p.kind === 'charge' ? '#b8c6f4' : '#ead38c';
    ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
    text(
      ctx,
      p.kind === 'shield' ? '+' : p.kind === 'charge' ? 'K' : 'W',
      p.x,
      p.y - 5,
      '#213448',
      10,
      'center',
    );
  }
  for (const e of s.enemies)
    if (!e.dead && e.entryWarning) {
      ctx.fillStyle = '#f3cd8a';
      ctx.fillRect(e.x - 6, 53, 12, 3);
      ctx.fillRect(e.x - 4, 56, 8, 3);
      ctx.fillRect(e.x - 2, 59, 4, 3);
    }
  for (const e of s.enemies) if (!e.dead) drawActor(ctx, e, s);
  drawActor(ctx, s.player, s);
  for (const b of s.bullets) {
    ctx.strokeStyle = b.owner === 'player' ? '#7bbfb6' : '#b78069';
    ctx.lineWidth = b.owner === 'player' ? 2 : 1;
    const speed = Math.hypot(b.vx, b.vy) || 1;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - (b.vx / speed) * 7, b.y - (b.vy / speed) * 7);
    ctx.stroke();
    ctx.fillStyle = b.owner === 'player' ? '#c0f6ec' : '#ffd08e';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const w of s.waves) {
    ctx.strokeStyle = '#adf5e7aa';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const p of s.particles) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  if (s.damageFlash > 0) {
    ctx.fillStyle = '#e6a995';
    ctx.fillRect(0, 48, 3, 256);
    ctx.fillRect(477, 48, 3, 256);
  }
  ctx.fillStyle = '#102436';
  ctx.fillRect(0, 0, 480, 48);
  text(ctx, `${s.level}/6 ${env.t(sector.en, sector.zh)}`, 10, 8, '#d8e8e5', 11);
  text(ctx, `${env.t('SHIELDS', '护盾')} ${s.lives}/4`, 470, 8, '#b3e9ca', 11, 'right');
  text(ctx, `${env.t('WEAPON', '武器')} ${s.player.power}`, 10, 28, '#e4d29b', 10);
  text(
    ctx,
    `${env.t('HEAT', '热量')} ${Math.round(s.player.heat)}${s.player.overheated ? env.t(' COOLING', ' 冷却中') : ''}`,
    153,
    28,
    '#edc397',
    10,
  );
  text(ctx, `${env.t('CHARGES', '拦截弹')} ${s.pulses}`, 470, 28, '#bad9ed', 10, 'right');
  ctx.fillStyle = '#344d5b';
  ctx.fillRect(235, 41, 90, 3);
  ctx.fillStyle = s.player.overheated ? '#ef997a' : '#b5d7bd';
  ctx.fillRect(235, 41, (90 * s.player.heat) / 100, 3);
  for (let n = 0; n < 4; n++) {
    ctx.fillStyle = n < s.lives ? '#a8d5bd' : '#37515c';
    ctx.fillRect(417 + n * 13, 22, 9, 2);
  }
  const boss = s.enemies.find((e) => e.boss && !e.dead);
  if (boss) {
    ctx.fillStyle = '#34495b';
    ctx.fillRect(130, 54, 220, 5);
    ctx.fillStyle = '#edb28f';
    ctx.fillRect(130, 54, (220 * boss.hp) / boss.maxHp, 5);
  }
  ctx.fillStyle = '#122639dd';
  ctx.fillRect(0, 304, 480, 16);
  text(ctx, env.t(sector.lesson.en, sector.lesson.zh), 240, 307, '#bed4d2', 9, 'center');
  if (s.cleanup) {
    ctx.fillStyle = '#192f43e8';
    ctx.fillRect(74, 279, 332, 22);
    text(
      ctx,
      env.t('CARRIER DOWN · INTERCEPT REMAINING FIRE', '航母击破 · 拦截剩余敌弹'),
      240,
      286,
      '#ffda9e',
      10,
      'center',
    );
  }
  if (s.transition > 0) {
    ctx.fillStyle = '#152b40e8';
    ctx.fillRect(62, 133, 356, 53);
    text(
      ctx,
      env.t('SECTOR CLEAR · SHIELDS RECHARGING', '空域清空 · 护盾充能中'),
      240,
      151,
      '#c2eee2',
      14,
      'center',
    );
  }
}
export function createGame(env) {
  const state = createSkyState();
  return {
    update: (dt, input) => stepSky(state, dt, input, env),
    draw: (ctx) => drawSky(ctx, state, env),
    getState: () => ({
      ...structuredClone(state),
      totalLevels: 6,
      sector: { en: SECTORS[state.level - 1].en, zh: SECTORS[state.level - 1].zh },
      status: {
        en: `Sector ${state.level}/6 · Shields ${state.lives}/4 · Weapon ${state.player.power} · ${state.pulses} interception charges`,
        zh: `空域 ${state.level}/6 · 护盾 ${state.lives}/4 · 武器 ${state.player.power} · ${state.pulses} 枚拦截弹`,
      },
    }),
  };
}
