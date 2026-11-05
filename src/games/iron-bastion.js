import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'iron-bastion',
  name: { en: 'Iron Bastion', zh: '钢铁堡垒' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Defend the beacon across Courtyard, Foundry and Siege Line. Move and fire, break brick (steel is solid), and intercept shells. Hold X to brake and turn the turret with Left/Right; touch the field to aim/fire directly. H uses a kit: +2 armor and +1 nearby beacon. Live shells can hit friendly armor. Carry 600 rounds; two engineer crates rearm the cannon and fund between-wave repairs.',
    zh: '保卫信标，依次通过庭院、铸造厂与围攻防线。移动射击，击碎砖墙（钢墙不可摧毁），拦截炮弹。按住X刹车，左右键转动炮塔；触按场地直接瞄准射击。H使用维修包：装甲+2，附近信标+1。实弹会伤及友方。携带600发炮弹，两箱工程补给支持波次间补弹与维修。',
  },
  keys: [
    { label: { en: 'Drive and face', zh: '行驶 / 朝向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Hold fire', zh: '按住射击' }, keys: 'Space / J' },
    { label: { en: 'Hold brake; Left/Right aim', zh: '按住刹车；左右瞄准' }, keys: 'X / K' },
    { label: { en: 'Repair kit', zh: '维修包' }, keys: 'H / E' },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'KeyX', side: 'right', label: { en: 'Brake/Aim', zh: '刹车瞄准' } },
    { code: 'KeyH', side: 'right', label: { en: 'Repair', zh: '维修' } },
  ],
};
const R = 12,
  SHELL_R = 2,
  SHELL_MASS = 0.02;
export const BASE = { x: 225, y: 282, w: 30, h: 26 };
const NAMES = [
  ['Courtyard', '庭院'],
  ['Foundry', '铸造厂'],
  ['Siege Line', '围攻防线'],
];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function circleHitsRect(x, y, r, box) {
  const px = clamp(x, box.x, box.x + box.w),
    py = clamp(y, box.y, box.y + box.h);
  return (x - px) ** 2 + (y - py) ** 2 <= r * r;
}
export function bulletHitsTile(b, tiles) {
  return tiles.findIndex((t) => circleHitsRect(b.x, b.y, b.r ?? SHELL_R, t));
}
function circleTOI(x, y, dx, dy, cx, cy, r) {
  const ox = x - cx,
    oy = y - cy,
    c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = 2 * (ox * dx + oy * dy),
    disc = b * b - 4 * a * c;
  if (a === 0 || b >= 0 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : Infinity;
}
export function sweepCircleRect(x, y, dx, dy, r, box) {
  if (circleHitsRect(x, y, r, box)) return 0;
  let best = Infinity;
  if (dx !== 0)
    for (const edge of [box.x - r, box.x + box.w + r]) {
      const t = (edge - x) / dx,
        py = y + dy * t;
      if (t >= 0 && t <= 1 && py >= box.y && py <= box.y + box.h) best = Math.min(best, t);
    }
  if (dy !== 0)
    for (const edge of [box.y - r, box.y + box.h + r]) {
      const t = (edge - y) / dy,
        px = x + dx * t;
      if (t >= 0 && t <= 1 && px >= box.x && px <= box.x + box.w) best = Math.min(best, t);
    }
  for (const cx of [box.x, box.x + box.w])
    for (const cy of [box.y, box.y + box.h])
      best = Math.min(best, circleTOI(x, y, dx, dy, cx, cy, r));
  return best;
}
function coverPlan(wave) {
  const out = [],
    add = (x, y, steel = false) =>
      out.push({ id: `${wave}:${x}:${y}`, x, y, w: 22, h: 22, hp: steel ? null : 2, steel });
  const plans = [
    [
      [76, 112],
      [100, 112],
      [76, 136],
      [356, 112],
      [380, 112],
      [380, 136],
      [156, 160, 1],
      [300, 160, 1],
    ],
    [
      [108, 136, 1],
      [132, 136, 1],
      [300, 136, 1],
      [324, 136, 1],
      [60, 208],
      [84, 208],
      [348, 208],
      [372, 208],
      [216, 112],
      [240, 112],
    ],
    [
      [84, 112, 1],
      [372, 112, 1],
      [156, 184, 1],
      [300, 184, 1],
      [108, 208],
      [132, 208],
      [324, 208],
      [348, 208],
      [216, 136],
      [240, 136],
    ],
  ][wave - 1];
  for (const [x, y, steel] of plans) add(x, y, !!steel);
  for (const x of [204, 228, 252]) add(x, 256);
  for (const x of [204, 256])
    out.push({ id: `${wave}:bunker:${x}`, x, y: 282, w: 20, h: 26, hp: 2, steel: false });
  return out;
}
function roster(wave) {
  return [
    [
      { lane: 1, role: 'raider' },
      { lane: 3, role: 'raider' },
      { lane: 2, role: 'gunner' },
      { lane: 0, role: 'raider' },
    ],
    [
      { lane: 0, role: 'gunner' },
      { lane: 4, role: 'gunner' },
      { lane: 1, role: 'raider' },
      { lane: 3, role: 'raider' },
      { lane: 2, role: 'heavy' },
    ],
    [
      { lane: 2, role: 'heavy' },
      { lane: 0, role: 'raider' },
      { lane: 4, role: 'raider' },
      { lane: 1, role: 'heavy' },
      { lane: 3, role: 'gunner' },
      { lane: 2, role: 'raider' },
    ],
  ][wave - 1];
}
export function createBastionState() {
  return {
    phase: 'playing',
    score: 0,
    wave: 1,
    lives: 4,
    baseHealth: 5,
    time: 0,
    spawned: 0,
    toSpawn: 4,
    spawnClock: 0.5,
    pendingSpawn: null,
    transition: 0,
    clearing: false,
    engineerCrates: 2,
    kits: 2,
    defeated: 0,
    shellId: 0,
    interceptions: 0,
    constructionSkipped: [],
    tiles: coverPlan(1),
    enemies: [],
    bullets: [],
    pickups: [],
    particles: [],
    rubble: [],
    toast: { en: 'Courtyard: protect the central road', zh: '庭院：守住中央通路', time: 3 },
    player: {
      id: 'player',
      x: 166,
      y: 284,
      r: R,
      mass: 100,
      rounds: 600,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      omega: 0,
      turret: -Math.PI / 2,
      turretOmega: 0,
      bearing: -Math.PI / 2,
      cooldown: 0,
      flash: 0,
      muzzle: 0,
    },
  };
}
function toast(s, en, zh) {
  s.toast = { en, zh, time: 2 };
}
function sparks(s, x, y, kind) {
  for (let n = 0; n < 6; n++)
    s.particles.push({
      x,
      y,
      vx: Math.cos((n * Math.PI) / 3) * 50,
      vy: Math.sin((n * Math.PI) / 3) * 50,
      life: 0.3,
      kind,
    });
  if (s.particles.length > 120) s.particles.splice(0, s.particles.length - 120);
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'Three battlefields secured. The beacon stands!'
        : s.baseHealth === 0
          ? 'The beacon was destroyed. Preserve its brick shield and repair nearby.'
          : s.player.rounds === 0
            ? 'Carried ammunition exhausted. Make every live round count.'
            : 'Tank armor exhausted. Brake, intercept shells and use repair kits.',
      won
        ? '三座战场全部守住，信标屹立不倒！'
        : s.baseHealth === 0
          ? '信标被摧毁。保护砖墙掩体，靠近维修。'
          : s.player.rounds === 0
            ? '携带弹药耗尽，注意珍惜每发实弹。'
            : '坦克装甲耗尽。刹车拦截炮弹，及时使用维修包。',
    ),
  });
}
function bodyFree(s, x, y, r = R) {
  return (
    x - r >= 8 &&
    x + r <= 472 &&
    y - r >= 44 &&
    y + r <= 312 &&
    !circleHitsRect(x, y, r, BASE) &&
    !s.tiles.some((t) => circleHitsRect(x, y, r, t))
  );
}
function staticContact(s, a) {
  for (const t of [BASE, ...s.tiles]) {
    const px = clamp(a.x, t.x, t.x + t.w),
      py = clamp(a.y, t.y, t.y + t.h);
    let dx = a.x - px,
      dy = a.y - py,
      d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-9) {
      const edges = [
        { d: Math.abs(a.x - t.x), nx: -1, ny: 0 },
        { d: Math.abs(a.x - t.x - t.w), nx: 1, ny: 0 },
        { d: Math.abs(a.y - t.y), nx: 0, ny: -1 },
        { d: Math.abs(a.y - t.y - t.h), nx: 0, ny: 1 },
      ].sort((b, c) => b.d - c.d);
      dx = edges[0].nx;
      dy = edges[0].ny;
      d = -edges[0].d;
    } else {
      dx /= d;
      dy /= d;
    }
    a.x += dx * (R - d + 0.0001);
    a.y += dy * (R - d + 0.0001);
    const vn = a.vx * dx + a.vy * dy;
    if (vn < 0) {
      a.vx -= vn * dx;
      a.vy -= vn * dy;
    }
  }
  if (a.x < 20) {
    a.x = 20;
    a.vx = Math.max(0, a.vx);
  }
  if (a.x > 460) {
    a.x = 460;
    a.vx = Math.min(0, a.vx);
  }
  if (a.y < 56) {
    a.y = 56;
    a.vy = Math.max(0, a.vy);
  }
  if (a.y > 300) {
    a.y = 300;
    a.vy = Math.min(0, a.vy);
  }
}
export function resolveTankContacts(s) {
  const actors = [s.player, ...s.enemies.filter((e) => e.hp > 0)].toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (let n = 0; n < 6; n++) {
    for (let i = 0; i < actors.length; i++)
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i],
          b = actors[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= R * 2) continue;
        const nx = d > 1e-9 ? dx / d : 1,
          ny = d > 1e-9 ? dy / d : 0,
          am = a.mass || 1.5,
          bm = b.mass || 1.5,
          total = am + bm,
          depth = R * 2 - d;
        a.x -= (nx * depth * bm) / total;
        a.y -= (ny * depth * bm) / total;
        b.x += (nx * depth * am) / total;
        b.y += (ny * depth * am) / total;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const impulse = -vn / (1 / am + 1 / bm);
          a.vx -= (impulse * nx) / am;
          a.vy -= (impulse * ny) / am;
          b.vx += (impulse * nx) / bm;
          b.vy += (impulse * ny) / bm;
        }
      }
    for (const a of actors) staticContact(s, a);
  }
}
function turn(a, key, velocityKey, target, dt, manual = null) {
  const wanted = manual === null ? clamp(wrap(target - a[key]) * 8, -5, 5) : manual;
  a[velocityKey] += clamp(wanted - a[velocityKey], -24 * dt, 24 * dt);
  a[key] = wrap(a[key] + a[velocityKey] * dt);
}
function drive(s, a, bearing, throttle, dt, maxSpeed) {
  turn(a, 'angle', 'omega', bearing, dt);
  const fx = Math.cos(a.angle),
    fy = Math.sin(a.angle),
    along = a.vx * fx + a.vy * fy,
    lateral = -a.vx * fy + a.vy * fx;
  const desired =
    throttle && Math.abs(wrap(bearing - a.angle)) < 0.8
      ? maxSpeed * Math.max(0, Math.cos(wrap(bearing - a.angle)))
      : 0;
  const forward = along + clamp(desired - along, -350 * dt, 190 * dt),
    side = lateral + clamp(-lateral, -260 * dt, 260 * dt);
  const oldVX = a.vx,
    oldVY = a.vy;
  a.vx = fx * forward - fy * side;
  a.vy = fy * forward + fx * side;
  a.x += (oldVX + a.vx) * 0.5 * dt;
  a.y += (oldVY + a.vy) * 0.5 * dt;
}
export function fireShell(s, a, owner, env) {
  const dx = Math.cos(a.turret),
    dy = Math.sin(a.turret),
    speed = owner === 'player' ? 300 : 160;
  if (a.mass <= SHELL_MASS || a.rounds === 0) return false;
  if (a.rounds !== undefined) a.rounds--;
  const previousVX = a.vx,
    previousVY = a.vy,
    remainingMass = a.mass - SHELL_MASS;
  s.bullets.push({
    id: `shell:${s.shellId++}`,
    x: a.x + dx * 10,
    y: a.y + dy * 10,
    vx: a.vx + dx * speed,
    vy: a.vy + dy * speed,
    r: SHELL_R,
    mass: SHELL_MASS,
    owner,
    shooter: a.id,
    life: 3.5,
    armed: true,
  });
  // The stored round was already moving with the vehicle. Ejection removes
  // its mass and momentum from the loaded hull in every inertial frame.
  a.vx = (a.mass * previousVX - SHELL_MASS * (previousVX + dx * speed)) / remainingMass;
  a.vy = (a.mass * previousVY - SHELL_MASS * (previousVY + dy * speed)) / remainingMass;
  a.mass = remainingMass;
  a.muzzle = 0.08;
  env.sound('shoot');
}
function destroy(s, e, playerDamage, env) {
  s.defeated++;
  if (playerDamage) s.score += 100 * s.wave;
  sparks(s, e.x, e.y, 'tank');
  env.sound('coin');
  if (s.defeated % 3 === 0)
    s.pickups.push({ id: `kit:${s.defeated}`, x: e.x, y: e.y, kind: 'kit' });
}
// Global earliest-event processing: exact circle/rectangle corners and moving
// circle targets; tied impacts accumulate before any terminal result is chosen.
export function stepShells(s, dt, env, starts = new Map()) {
  let left = dt,
    elapsed = 0;
  for (let loop = 0; loop < 128 && left > 1e-10 && s.phase === 'playing'; loop++) {
    s.bullets = s.bullets.filter((b) => b.life > 1e-10);
    const events = [],
      bodies = [s.player, ...s.enemies.filter((e) => e.hp > 0)];
    const add = (t, kind, b, target = null) => {
      if (t >= -1e-10 && t <= left + 1e-10) events.push({ t: Math.max(0, t), kind, b, target });
    };
    for (const b of s.bullets) {
      add(b.life, 'expire', b);
      for (const t of s.tiles)
        add(sweepCircleRect(b.x, b.y, b.vx * left, b.vy * left, SHELL_R, t) * left, 'tile', b, t);
      add(sweepCircleRect(b.x, b.y, b.vx * left, b.vy * left, SHELL_R, BASE) * left, 'base', b);
      for (const a of bodies)
        if (a.id !== b.shooter) {
          const old = starts.get(a.id) || a,
            mvx = (a.x - old.x) / dt,
            mvy = (a.y - old.y) / dt,
            ax = old.x + mvx * elapsed,
            ay = old.y + mvy * elapsed;
          add(
            circleTOI(b.x, b.y, (b.vx - mvx) * left, (b.vy - mvy) * left, ax, ay, R + SHELL_R) *
              left,
            'tank',
            b,
            a,
          );
        }
      if (b.vx < 0) add((10 - b.x) / b.vx, 'wall', b);
      if (b.vx > 0) add((470 - b.x) / b.vx, 'wall', b);
      if (b.vy < 0) add((46 - b.y) / b.vy, 'wall', b);
      if (b.vy > 0) add((310 - b.y) / b.vy, 'wall', b);
    }
    for (let i = 0; i < s.bullets.length; i++)
      for (let j = i + 1; j < s.bullets.length; j++) {
        const a = s.bullets[i],
          b = s.bullets[j];
        if (a.armed && b.armed && Math.hypot(a.vx, a.vy) > 1 && Math.hypot(b.vx, b.vy) > 1)
          add(
            circleTOI(a.x, a.y, (a.vx - b.vx) * left, (a.vy - b.vy) * left, b.x, b.y, 4) * left,
            'shell',
            a,
            b,
          );
      }
    const first = events.length ? Math.min(...events.map((e) => e.t)) : left;
    for (const b of s.bullets) {
      b.x += b.vx * first;
      b.y += b.vy * first;
      b.life -= first;
    }
    left -= first;
    elapsed += first;
    const due = events.filter((e) => Math.abs(e.t - first) < 1e-8),
      priority = { shell: 0, tile: 1, base: 2, tank: 3, wall: 4, expire: 5 };
    due.sort(
      (a, b) =>
        priority[a.kind] - priority[b.kind] ||
        String(a.target?.id || '').localeCompare(String(b.target?.id || '')) ||
        a.b.id.localeCompare(b.b.id),
    );
    if (!due.length) break;
    const used = new Set(),
      tileDamage = new Map(),
      tankDamage = new Map();
    let baseHits = 0,
      playerHits = 0;
    for (const e of due) {
      const b = e.b;
      const live = b.armed && Math.hypot(b.vx, b.vy) > 1;
      if (used.has(b.id)) continue;
      if (e.kind === 'shell') {
        if (used.has(e.target.id)) continue;
        used.add(b.id);
        used.add(e.target.id);
        if (b.owner !== e.target.owner) s.interceptions++;
        sparks(s, (b.x + e.target.x) / 2, (b.y + e.target.y) / 2, 'intercept');
        env.sound('hit');
        continue;
      }
      used.add(b.id);
      if (e.kind === 'tile') {
        sparks(s, b.x, b.y, e.target.steel || !live ? 'steel' : 'brick');
        if (live && !e.target.steel) {
          const d = tileDamage.get(e.target.id) || { tile: e.target, count: 0, player: false };
          d.count++;
          d.player ||= b.owner === 'player';
          tileDamage.set(e.target.id, d);
        }
      }
      if (e.kind === 'base' && live) {
        baseHits++;
        sparks(s, b.x, b.y, 'hurt');
        if (b.owner === 'player') toast(s, 'Friendly shell hit the beacon!', '友方炮弹击中信标！');
      }
      if (e.kind === 'tank') {
        const a = e.target,
          mass = b.mass ?? SHELL_MASS,
          total = a.mass + mass;
        // Armor retains shell fragments: an inelastic capture adds their mass.
        a.vx = (a.mass * a.vx + mass * b.vx) / total;
        a.vy = (a.mass * a.vy + mass * b.vy) / total;
        a.mass = total;
        if (live) a.flash = 0.45;
        if (live && a.id === 'player') playerHits++;
        else if (live) {
          const d = tankDamage.get(a.id) || { tank: a, count: 0, player: false };
          d.count++;
          d.player ||= b.owner === 'player';
          tankDamage.set(a.id, d);
        }
        sparks(s, b.x, b.y, live ? 'hurt' : 'steel');
      }
    }
    for (const d of tileDamage.values()) {
      d.tile.hp -= d.count;
      if (d.tile.hp <= 0) {
        if (d.player) s.score += 10;
        s.rubble.push({ x: d.tile.x, y: d.tile.y });
      }
    }
    s.tiles = s.tiles.filter((t) => t.steel || t.hp > 0);
    if (s.rubble.length > 60) s.rubble.splice(0, s.rubble.length - 60);
    for (const d of tankDamage.values()) {
      d.tank.hp -= d.count;
      if (d.tank.hp <= 0) destroy(s, d.tank, d.player, env);
    }
    s.enemies = s.enemies.filter((e) => e.hp > 0);
    s.baseHealth = Math.max(0, s.baseHealth - baseHits);
    s.lives = Math.max(0, s.lives - playerHits);
    if (baseHits || playerHits) env.sound('hit');
    s.bullets = s.bullets.filter((b) => !used.has(b.id) && b.life > 1e-10);
    if (s.baseHealth === 0 || s.lives === 0) {
      finish(s, env, false);
      return;
    }
  }
}
function sightBlock(s, a, b, r = R) {
  let nearest = Infinity,
    target = null;
  for (const t of s.tiles) {
    const d = sweepCircleRect(a.x, a.y, b.x - a.x, b.y - a.y, r, t);
    if (d < nearest) {
      nearest = d;
      target = t;
    }
  }
  return target;
}
function nav(s, a, goal) {
  if (!sightBlock(s, a, goal)) return Math.atan2(goal.y - a.y, goal.x - a.x);
  const nodes = [],
    cols = 37,
    rows = 21;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const px = 20 + x * 12,
        py = 56 + y * 12;
      nodes.push(bodyFree(s, px, py));
    }
  const nearest = (p) => {
    let best = -1,
      d = Infinity;
    for (let n = 0; n < nodes.length; n++)
      if (nodes[n]) {
        const dx = 20 + (n % cols) * 12 - p.x,
          dy = 56 + Math.floor(n / cols) * 12 - p.y,
          v = dx * dx + dy * dy;
        if (v < d) {
          d = v;
          best = n;
        }
      }
    return best;
  };
  const start = nearest(a),
    end = nearest(goal);
  if (start < 0 || end < 0) return a.angle;
  const q = [end],
    distance = new Map([[end, 0]]);
  for (let k = 0; k < q.length; k++) {
    const n = q[k],
      x = n % cols,
      y = Math.floor(n / cols);
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + ox,
        yy = y + oy,
        nn = yy * cols + xx;
      if (xx >= 0 && xx < cols && yy >= 0 && yy < rows && nodes[nn] && !distance.has(nn)) {
        distance.set(nn, distance.get(n) + 1);
        q.push(nn);
      }
    }
  }
  let next = start,
    best = distance.get(start) ?? Infinity;
  for (const n of [start - 1, start + 1, start - cols, start + cols])
    if ((distance.get(n) ?? Infinity) < best) {
      next = n;
      best = distance.get(n);
    }
  return Math.atan2(56 + Math.floor(next / cols) * 12 - a.y, 20 + (next % cols) * 12 - a.x);
}
function spawn(s, h) {
  s.spawnClock -= h;
  const positions = [50, 145, 240, 335, 430],
    safe = (x) =>
      bodyFree(s, x, 60) &&
      Math.hypot(x - s.player.x, 60 - s.player.y) > 44 &&
      !s.enemies.some((e) => Math.hypot(x - e.x, 60 - e.y) < 40);
  if (s.pendingSpawn) {
    s.pendingSpawn.warning -= h;
    if (s.pendingSpawn.warning <= 0) {
      const p = s.pendingSpawn;
      if (safe(p.x)) {
        s.enemies.push({
          id: `enemy:${s.wave}:${s.spawned}`,
          x: p.x,
          y: 60,
          r: R,
          mass: p.role === 'heavy' ? 130 : 100,
          rounds: 120,
          vx: 0,
          vy: 0,
          angle: Math.PI / 2,
          omega: 0,
          turret: Math.PI / 2,
          turretOmega: 0,
          bearing: Math.PI / 2,
          role: p.role,
          hp: p.role === 'heavy' ? 2 : 1,
          cooldown: 1.1,
          charge: 0,
          aim: Math.PI / 2,
          think: 0,
          flash: 0,
          muzzle: 0,
        });
        s.spawned++;
        s.spawnClock = 2.8;
        s.pendingSpawn = null;
      } else {
        const x = positions.find(safe);
        if (x !== undefined) {
          p.x = x;
          p.warning = 1.1;
        } else p.warning = 0.2;
      }
    }
  } else if (s.spawned < s.toSpawn && s.enemies.length < 3 && s.spawnClock <= 0) {
    const spec = roster(s.wave)[s.spawned],
      preferred = positions[spec.lane],
      x = safe(preferred) ? preferred : positions.find(safe);
    if (x !== undefined) s.pendingSpawn = { x, y: 60, warning: 1.1, role: spec.role };
  }
}
function repair(s, env) {
  const near = Math.hypot(s.player.x - 240, s.player.y - 295) <= 75,
    armor = s.lives < 4,
    beacon = near && s.baseHealth < 5;
  if (s.kits === 0) {
    toast(s, 'No repair kits — collect a marked supply', '没有维修包，收集标记补给');
    return;
  }
  if (!armor && !beacon) {
    toast(
      s,
      s.baseHealth < 5 ? 'Approach the beacon to repair it' : 'Armor and beacon full — kit saved',
      s.baseHealth < 5 ? '靠近信标才能维修' : '装甲和信标完好，保留维修包',
    );
    return;
  }
  s.kits--;
  s.lives = Math.min(4, s.lives + 2);
  if (near) s.baseHealth = Math.min(5, s.baseHealth + 1);
  toast(s, 'Kit used: armor +2, nearby beacon +1', '使用维修包：装甲+2，附近信标+1');
  env.sound('coin');
}
function buildNext(s) {
  const load = (600 - s.player.rounds) * SHELL_MASS,
    oldMass = s.player.mass;
  s.player.mass += load;
  s.player.vx *= oldMass / s.player.mass;
  s.player.vy *= oldMass / s.player.mass;
  s.player.rounds = 600;
  s.engineerCrates--;
  s.wave++;
  s.toSpawn = roster(s.wave).length;
  s.spawned = 0;
  s.spawnClock = 0.5;
  s.pendingSpawn = null;
  s.clearing = false;
  s.constructionSkipped = [];
  s.tiles = coverPlan(s.wave).filter((t) => {
    if (
      circleHitsRect(s.player.x, s.player.y, R + 18, t) ||
      s.pickups.some((k) => circleHitsRect(k.x, k.y, R + 10, t))
    ) {
      s.constructionSkipped.push({ ...t });
      return false;
    }
    return true;
  });
  s.baseHealth = Math.min(5, s.baseHealth + 1);
  s.lives = Math.min(4, s.lives + 1);
  s.kits = Math.min(3, s.kits + 1);
  s.rubble = [];
  toast(
    s,
    `${NAMES[s.wave - 1][0]}: engineers preserved your position and access`,
    `${NAMES[s.wave - 1][1]}：工程队保留了你的站位与通路`,
  );
}
export function stepBastion(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  dt = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  if (dt === 0) return;
  if (i.pressed('KeyH', 'KeyE')) repair(s, env);
  const ix = Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA')),
    iy = Number(i.held('ArrowDown', 'KeyS')) - Number(i.held('ArrowUp', 'KeyW')),
    park = i.held('KeyX', 'KeyK'),
    pointer = i.pointer.down && i.pointer.y >= 44 && i.pointer.x >= 0;
  const fastest = Math.max(
      Math.hypot(s.player.vx, s.player.vy),
      ...s.enemies.map((e) => Math.hypot(e.vx, e.vy)),
    ),
    steps = Math.max(1, Math.ceil(dt * Math.max(240, (fastest + 90) / 2))),
    h = dt / steps;
  for (let tick = 0; tick < steps && s.phase === 'playing'; tick++) {
    s.time += h;
    s.toast.time = Math.max(0, s.toast.time - h);
    s.particles = s.particles.filter((p) => (p.life -= h) > 0);
    for (const p of s.particles) {
      p.x += p.vx * h;
      p.y += p.vy * h;
    }
    const starts = new Map([s.player, ...s.enemies].map((a) => [a.id, { x: a.x, y: a.y }]));
    const p = s.player;
    p.cooldown = Math.max(0, p.cooldown - h);
    p.flash = Math.max(0, p.flash - h);
    p.muzzle = Math.max(0, p.muzzle - h);
    if (!park && (ix || iy)) p.bearing = Math.atan2(iy, ix);
    const aim = pointer ? Math.atan2(i.pointer.y - p.y, i.pointer.x - p.x) : p.bearing;
    turn(p, 'turret', 'turretOmega', aim, h, park && !pointer ? ix * 2.8 : null);
    if (!s.transition && !s.clearing && (i.held('Space', 'KeyJ') || pointer) && p.cooldown === 0) {
      fireShell(s, p, 'player', env);
      p.cooldown = 0.32;
    }
    drive(s, p, p.bearing, !park && (ix !== 0 || iy !== 0), h, 88);
    if (s.transition > 0) {
      s.transition = Math.max(0, s.transition - h);
      resolveTankContacts(s);
      if (s.transition === 0) buildNext(s);
      continue;
    }
    spawn(s, h);
    for (const e of s.enemies) {
      e.cooldown = Math.max(0, e.cooldown - h);
      e.flash = Math.max(0, e.flash - h);
      e.muzzle = Math.max(0, e.muzzle - h);
      e.think -= h;
      const goal =
        e.role === 'raider' && Math.hypot(p.x - e.x, p.y - e.y) < 190
          ? { x: p.x, y: p.y }
          : { x: 240, y: 295 };
      const block = sightBlock(s, e, goal, SHELL_R),
        range = Math.hypot(goal.x - e.x, goal.y - e.y),
        canFire = !block || !block.steel;
      if (e.think <= 0) {
        e.bearing = nav(s, e, { x: goal.x, y: Math.min(goal.y, 238) });
        e.think = 0.3;
      }
      const desiredAim = e.charge > 0 ? e.aim : Math.atan2(goal.y - e.y, goal.x - e.x);
      turn(e, 'turret', 'turretOmega', desiredAim, h);
      let halted = e.charge > 0 || (canFire && range < (e.role === 'gunner' ? 220 : 150));
      if (e.charge > 0) {
        e.charge = Math.max(0, e.charge - h);
        if (e.charge === 0) {
          fireShell(s, e, 'enemy', env);
          e.cooldown = e.role === 'heavy' ? 2.3 : 1.8;
        }
      } else if (e.cooldown === 0 && canFire && Math.abs(wrap(desiredAim - e.turret)) < 0.1) {
        e.charge = 0.7;
        e.aim = e.turret;
        halted = true;
      }
      drive(
        s,
        e,
        e.bearing,
        !halted,
        h,
        e.role === 'heavy' ? 24 : e.role === 'gunner' ? 26 : 34 + s.wave * 2,
      );
    }
    resolveTankContacts(s);
    stepShells(s, h, env, starts);
    if (s.phase !== 'playing') break;
    s.pickups = s.pickups.filter((k) => {
      if (s.kits >= 3 || Math.hypot(k.x - p.x, k.y - p.y) > 22) return true;
      s.kits++;
      toast(s, 'Repair kit collected', '已收集维修包');
      env.sound('coin');
      return false;
    });
    if (s.spawned === s.toSpawn && s.enemies.length === 0 && !s.pendingSpawn) s.clearing = true;
    if (s.player.rounds === 0 && s.bullets.length === 0 && !s.clearing) {
      finish(s, env, false);
      break;
    }
    if (s.clearing && s.bullets.length === 0) {
      s.score += s.baseHealth * 100;
      if (s.wave === 3) {
        finish(s, env, true);
        break;
      }
      s.transition = 2;
      toast(
        s,
        'Cease fire: one engineer crate supplies +1 armor / beacon / kit',
        '停火整备：消耗一箱工程补给，装甲／信标／维修包各+1',
      );
      env.sound('win');
    }
  }
}
function pixelDisc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  for (let row = -r; row <= r; row++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - row * row)));
    ctx.fillRect(Math.round(x) - half, Math.round(y) + row, half * 2 + 1, 1);
  }
}
function tankPixel(ctx, a, x, y, w, h, color) {
  const co = Math.cos(a.angle + Math.PI / 2),
    si = Math.sin(a.angle + Math.PI / 2);
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h; yy += 2)
    for (let xx = x; xx < x + w; xx += 2) {
      if (Math.hypot(xx + 1, yy + 1) > 11) continue;
      ctx.fillRect(Math.round(a.x + xx * co - yy * si), Math.round(a.y + xx * si + yy * co), 2, 2);
    }
}
function aimEnd(s, a, length) {
  const dx = Math.cos(a.turret) * length,
    dy = Math.sin(a.turret) * length;
  let limit = 1;
  for (const t of [BASE, ...s.tiles])
    limit = Math.min(limit, sweepCircleRect(a.x, a.y, dx, dy, SHELL_R, t));
  return { x: a.x + dx * limit, y: a.y + dy * limit };
}
function drawBastion(ctx, s, env) {
  const ground = [
    ['#39493e', '#455546'],
    ['#46453c', '#535047'],
    ['#37434a', '#46525a'],
  ][s.wave - 1];
  background(ctx, '#192b30');
  ctx.fillStyle = ground[0];
  ctx.fillRect(8, 44, 464, 268);
  for (let y = 48; y < 310; y += 16)
    for (let x = 12; x < 470; x += 16) {
      ctx.fillStyle = ground[(x + y) % 3 ? 0 : 1];
      ctx.fillRect(x, y, 14, 14);
      ctx.fillStyle = '#526052';
      if ((x * 3 + y) % 7 === 0) ctx.fillRect(x + 3, y + 9, 3, 1);
    }
  // Painted road, metal floor panels and scorch marks are flat visual surfaces.
  ctx.fillStyle = s.wave === 2 ? '#55564b' : '#4a544b';
  ctx.fillRect(218, 44, 44, 211);
  for (let y = 60; y < 251; y += 28) {
    ctx.fillStyle = '#9a9876';
    ctx.fillRect(239, y, 2, 10);
  }
  if (s.wave === 2) {
    ctx.fillStyle = '#65665c';
    for (const x of [18, 450])
      for (let y = 90; y < 286; y += 36) {
        ctx.fillRect(x, y, 10, 20);
        ctx.fillStyle = '#a18d5d';
        ctx.fillRect(x + 2, y + 3, 6, 2);
        ctx.fillStyle = '#65665c';
      }
  }
  if (s.wave === 3)
    for (const [x, y] of [
      [42, 153],
      [432, 192],
      [177, 93],
      [278, 231],
    ]) {
      pixelDisc(ctx, x, y, 8, '#29383c');
      ctx.fillStyle = '#536064';
      ctx.fillRect(x - 3, y + 6, 7, 1);
    }
  ctx.fillStyle = '#87917d';
  ctx.fillRect(4, 40, 472, 4);
  ctx.fillRect(4, 312, 472, 4);
  ctx.fillRect(4, 44, 4, 268);
  ctx.fillRect(472, 44, 4, 268);
  for (const r of s.rubble) {
    ctx.fillStyle = '#7d6550';
    ctx.fillRect(r.x + 2, r.y + 15, 5, 3);
    ctx.fillRect(r.x + 10, r.y + 10, 8, 3);
    ctx.fillRect(r.x + 15, r.y + 17, 4, 2);
  }
  for (const t of s.constructionSkipped) {
    ctx.fillStyle = '#a49565';
    ctx.fillRect(t.x, t.y, 5, 2);
    ctx.fillRect(t.x, t.y, 2, 5);
    ctx.fillRect(t.x + t.w - 5, t.y + t.h - 2, 5, 2);
  }
  for (const t of s.tiles) {
    ctx.fillStyle = t.steel ? '#526970' : t.hp === 2 ? '#aa7955' : '#80604c';
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = t.steel ? '#aec4bf' : '#d6a47a';
    ctx.fillRect(t.x + 1, t.y + 1, t.w - 2, 3);
    ctx.fillStyle = t.steel ? '#2b454e' : '#5e5144';
    ctx.fillRect(t.x, t.y + t.h - 3, t.w, 3);
    if (t.steel) {
      ctx.fillStyle = '#b8c6ba';
      for (const [x, y] of [
        [3, 6],
        [t.w - 5, 6],
        [3, t.h - 7],
        [t.w - 5, t.h - 7],
      ])
        ctx.fillRect(t.x + x, t.y + y, 2, 2);
      ctx.fillStyle = '#78959a';
      ctx.fillRect(t.x + 9, t.y + 6, 4, t.h - 13);
    } else {
      ctx.fillStyle = '#554b3f';
      ctx.fillRect(t.x, t.y + 10, t.w, 2);
      ctx.fillRect(t.x + 9, t.y, 2, 10);
      ctx.fillRect(t.x + 4, t.y + 12, 2, t.h - 12);
      if (t.hp === 1) {
        ctx.fillStyle = '#252f2d';
        ctx.fillRect(t.x + 15, t.y + 3, 2, 8);
        ctx.fillRect(t.x + 12, t.y + 9, 4, 2);
        ctx.fillRect(t.x + 12, t.y + 11, 2, 7);
      }
    }
  }
  ctx.fillStyle = '#8e8c5f';
  ctx.fillRect(BASE.x, BASE.y, BASE.w, BASE.h);
  ctx.fillStyle = '#c1b77a';
  ctx.fillRect(BASE.x + 2, BASE.y + 2, BASE.w - 4, 3);
  ctx.fillStyle = '#344c50';
  ctx.fillRect(234, 287, 12, 16);
  ctx.fillStyle = s.baseHealth < 2 ? '#f2a387' : '#f4dfa0';
  ctx.fillRect(237, 285, 6, 18);
  ctx.fillStyle = '#ffedba';
  ctx.fillRect(239, 286, 2, 9);
  for (let n = 0; n < 5; n++) {
    ctx.fillStyle = n < s.baseHealth ? '#e5cd8e' : '#4d594e';
    ctx.fillRect(226 + n * 6, 305, 4, 2);
  }
  if (s.pendingSpawn) {
    const a = s.pendingSpawn,
      blink = Math.floor(s.time * 6) % 2;
    ctx.strokeStyle = blink ? '#f3ca8b' : '#aa8461';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x - 15, a.y - 15, 30, 30);
    text(ctx, '!', a.x, a.y - 9, '#ffe1a2', 15, 'center');
    ctx.fillStyle = '#efd4a2';
    ctx.fillRect(a.x - 12, a.y + 18, 24 * Math.min(1, a.warning / 1.1), 2);
  }
  for (const a of [...s.enemies, s.player]) {
    if (a.charge > 0) {
      const end = aimEnd(s, a, 190);
      ctx.strokeStyle = '#d9a07d';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, '!', a.x, a.y - 26, '#ffdaa0', 13, 'center');
      ctx.fillStyle = '#e7b586';
      ctx.fillRect(a.x - 9, a.y - 17, 18 * (1 - a.charge / 0.7), 2);
    }
    pixelDisc(ctx, a.x, a.y + 3, 12, '#233432');
    pixelDisc(ctx, a.x, a.y, 12, '#182e32');
    const damaged = a.flash > 0 && Math.floor(a.flash * 16) % 2 === 0,
      color = damaged
        ? '#f2d4ad'
        : a.id === 'player'
          ? '#83c9a6'
          : a.role === 'heavy'
            ? '#b0bdbe'
            : a.role === 'gunner'
              ? '#caa16e'
              : '#c78770';
    pixelDisc(ctx, a.x, a.y, 10, color);
    tankPixel(ctx, a, -10, -7, 4, 14, '#213a3d');
    tankPixel(ctx, a, 6, -7, 4, 14, '#213a3d');
    const tread = Math.floor(s.time * (Math.hypot(a.vx, a.vy) > 5 ? 15 : 0)) % 2;
    for (let y = -6; y <= 6; y += 4) {
      tankPixel(ctx, a, -10, y + tread, 4, 2, '#7b8a79');
      tankPixel(ctx, a, 6, y + tread, 4, 2, '#7b8a79');
    }
    tankPixel(ctx, a, -5, -6, 10, 12, color);
    pixelDisc(ctx, a.x, a.y, 5, '#304b4d');
    pixelDisc(ctx, a.x, a.y, 4, color);
    if (a.role === 'heavy') {
      tankPixel(ctx, a, -6, -2, 12, 4, '#d3d2b7');
      tankPixel(ctx, a, -2, -6, 4, 12, '#d3d2b7');
    }
    if (a.role === 'gunner') {
      tankPixel(ctx, a, -4, -6, 2, 4, '#ead8a3');
      tankPixel(ctx, a, 2, -6, 2, 4, '#ead8a3');
    }
    ctx.strokeStyle = '#23393c';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + Math.cos(a.turret) * 9, a.y + Math.sin(a.turret) * 9);
    ctx.stroke();
    ctx.strokeStyle = damaged ? '#fff0cc' : '#e3d29a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + Math.cos(a.turret) * 10, a.y + Math.sin(a.turret) * 10);
    ctx.stroke();
    if (a.muzzle > 0) {
      const x = a.x + Math.cos(a.turret) * 14,
        y = a.y + Math.sin(a.turret) * 14;
      ctx.fillStyle = '#ffdfa2';
      ctx.fillRect(x - 3, y - 1, 6, 2);
      ctx.fillRect(x - 1, y - 3, 2, 6);
    }
    if (a.id !== 'player')
      for (let n = 0; n < a.hp; n++) {
        ctx.fillStyle = '#d8bd8e';
        ctx.fillRect(a.x - 4 + n * 5, a.y + 14, 3, 2);
      }
  }
  for (const b of s.bullets) {
    ctx.fillStyle = b.owner === 'player' ? '#fff0c1' : '#ff9f85';
    ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 1, 4, 2);
    ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 2, 2, 4);
  }
  for (const k of s.pickups) {
    ctx.fillStyle = '#31483e';
    ctx.fillRect(k.x - 8, k.y - 8, 16, 16);
    ctx.fillStyle = '#dfcf8c';
    ctx.fillRect(k.x - 7, k.y - 7, 14, 14);
    ctx.fillStyle = '#3b6351';
    ctx.fillRect(k.x - 1, k.y - 5, 2, 10);
    ctx.fillRect(k.x - 5, k.y - 1, 10, 2);
  }
  for (const p of s.particles) {
    ctx.fillStyle =
      p.kind === 'intercept'
        ? '#fff1b2'
        : p.kind === 'steel'
          ? '#b9d9da'
          : p.kind === 'brick'
            ? '#cf9b6c'
            : '#e7a182';
    ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    if (p.kind === 'intercept') {
      ctx.fillRect(p.x - 3, p.y, 7, 1);
      ctx.fillRect(p.x, p.y - 3, 1, 7);
    }
  }
  // Separate quantities, shape gauges and a full-width notice row avoid overlaps.
  ctx.fillStyle = '#14292f';
  ctx.fillRect(0, 0, 480, 44);
  text(ctx, `${s.wave}/3 ${env.t(...NAMES[s.wave - 1])}`, 12, 3, '#e0dcc1', 11);
  text(ctx, env.t(`ARMOR ${s.lives}/4`, `装甲 ${s.lives}/4`), 174, 3, '#9ed9b8', 11);
  text(ctx, env.t(`BEACON ${s.baseHealth}/5`, `信标 ${s.baseHealth}/5`), 285, 3, '#f1d89d', 11);
  text(ctx, env.t(`KITS ${s.kits}`, `维修包 ${s.kits}`), 465, 3, '#e4d2a6', 11, 'right');
  text(ctx, env.t(`AMMO ${s.player.rounds}`, `弹药 ${s.player.rounds}`), 12, 17, '#b8d3cb', 10);
  for (let n = 0; n < 4; n++) {
    ctx.fillStyle = n < s.lives ? '#86bc9a' : '#3b5552';
    ctx.fillRect(184 + n * 11, 18, 8, 6);
  }
  for (let n = 0; n < 5; n++) {
    ctx.fillStyle = n < s.baseHealth ? '#d2bc7b' : '#4a5551';
    ctx.fillRect(291 + n * 10, 18, 7, 6);
  }
  for (let n = 0; n < 3; n++) {
    ctx.fillStyle = n < s.kits ? '#e1cf9b' : '#425b56';
    ctx.fillRect(431 + n * 12, 18, 8, 6);
    if (n < s.kits) {
      ctx.fillStyle = '#3c5d4a';
      ctx.fillRect(434 + n * 12, 19, 2, 4);
    }
  }
  const notice =
    s.transition > 0
      ? env.t('Engineers use one crate — rearm and repair', '工程队消耗一箱补给，补充弹药并维修')
      : s.clearing
        ? env.t('Cease fire — clearing live shells', '停火，等待实弹清除')
        : s.toast.time > 0
          ? env.t(s.toast.en, s.toast.zh)
          : env.t(
              'X hold: brake / aim · H: repair · Touch field: aim / fire',
              '按住X刹车瞄准 · H维修 · 触按场地瞄准射击',
            );
  text(ctx, notice, 12, 31, '#b8c8b9', 10);
  if (s.transition > 0) {
    ctx.fillStyle = '#132b31ef';
    ctx.fillRect(62, 126, 356, 78);
    ctx.strokeStyle = '#b6ad7e';
    ctx.lineWidth = 2;
    ctx.strokeRect(62, 126, 356, 78);
    text(ctx, env.t('BATTLEFIELD SECURED', '战场已守住'), 240, 136, '#ebdba1', 16, 'center');
    text(
      ctx,
      env.t('One crate: armor / beacon / kit +1', '一箱工程补给：装甲／信标／维修包各+1'),
      240,
      164,
      '#d1d3b6',
      10,
      'center',
    );
    text(
      ctx,
      env.t('Cannon rearmed · occupied ground kept clear', '炮弹补满，保留站位与补给通路'),
      240,
      181,
      '#b6cabc',
      10,
      'center',
    );
  }
}
export function createGame(env) {
  const s = createBastionState();
  return {
    update: (dt, i) => stepBastion(s, dt, i, env),
    draw: (ctx) => drawBastion(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${NAMES[s.wave - 1][0]} ${s.wave}/3 · Armor ${s.lives}/4 · Beacon ${s.baseHealth}/5 · ${s.kits} repair ${s.kits === 1 ? 'kit' : 'kits'} · ${s.player.rounds} rounds`,
        zh: `${NAMES[s.wave - 1][1]} ${s.wave}/3 · 装甲 ${s.lives}/4 · 信标 ${s.baseHealth}/5 · ${s.kits}维修包 · ${s.player.rounds}发炮弹`,
      },
    }),
  };
}
