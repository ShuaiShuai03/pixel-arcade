import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
export const meta = {
  id: 'dungeon-dash',
  name: { en: 'Dungeon Dash', zh: '地牢冲刺' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Clear five chambers, find each key and defeat the vault warden. Hold the sword button to sweep in your facing direction. Read enemy windups, dodge by moving, use switches and supply caches, and drink carried flasks when hurt.',
    zh: '清理五座密室，寻找钥匙并击败宝库守卫。按住攻击键朝面向方向挥剑。观察蓄力并移动闪避，操作开关和补给箱，受伤后饮用携带的药水。',
  },
  keys: [
    { label: { en: 'Move / face', zh: '移动 / 朝向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Hold to swing', zh: '按住挥剑' }, keys: 'Space / J' },
    { label: { en: 'Dodge step', zh: '闪步' }, keys: 'K / Shift' },
    { label: { en: 'Use switch / cache / shrine', zh: '开关 / 补给 / 神龛' }, keys: 'E / Enter' },
    { label: { en: 'Drink flask', zh: '饮用药水' }, keys: 'H / X' },
  ],
};
const HALF = 8,
  STEP = 20;
const pos = (x, y) => ({ x: 30 + x * STEP, y: 40 + y * STEP });
const NAMES = [
  ['Entry Hall', '入口大厅'],
  ['Arrow Gallery', '箭廊'],
  ['Sealed Archive', '封印书库'],
  ['Furnace Walk', '熔炉走廊'],
  ['Vault Warden', '宝库守卫'],
];
export function buildRoom(room) {
  const tiles = Array.from({ length: 14 }, (_, y) =>
    Array.from({ length: 22 }, (_, x) => +(x === 0 || x === 21 || y === 0 || y === 13)),
  );
  const walls = [
    [
      [5, 4, 16, 4],
      [4, 8, 17, 8],
      [12, 5, 12, 11],
    ],
    [
      [7, 3, 7, 10],
      [14, 3, 14, 11],
      [8, 7, 13, 7],
    ],
    [
      [4, 8, 17, 8],
      [12, 5, 12, 11],
    ],
    [
      [6, 3, 6, 11],
      [15, 3, 15, 11],
      [7, 6, 14, 6],
    ],
    [
      [6, 4, 8, 4],
      [13, 4, 15, 4],
      [6, 9, 8, 9],
      [13, 9, 15, 9],
    ],
  ][room - 1];
  for (const [x1, y1, x2, y2] of walls)
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) if ((x + y) % 5 !== 0) tiles[y][x] = 1;
  for (let x = 1; x < 21; x++) {
    tiles[2][x] = 0;
    tiles[11][x] = 0;
  }
  for (let y = 1; y < 13; y++) {
    tiles[y][2] = 0;
    tiles[y][19] = 0;
  }
  const definitions = [
    [
      [9, 2, 'guard'],
      [17, 6, 'guard'],
      [18, 11, 'guard'],
    ],
    [
      [10, 6, 'guard'],
      [17, 11, 'guard'],
      [16, 2, 'archer'],
      [7, 10, 'guard'],
    ],
    [
      [9, 9, 'guard'],
      [17, 7, 'guard'],
      [16, 2, 'archer'],
      [5, 2, 'guard'],
    ],
    [
      [9, 7, 'guard'],
      [17, 10, 'guard'],
      [16, 2, 'archer'],
      [4, 3, 'archer'],
      [10, 11, 'guard'],
    ],
    [
      [5, 6, 'guard'],
      [17, 6, 'guard'],
      [17, 2, 'archer'],
      [11, 7, 'warden'],
    ],
  ][room - 1];
  const enemies = definitions.map(([x, y, type], index) => ({
    id: `${room}:${index}`,
    ...pos(x, y),
    vx: 0,
    vy: 0,
    hp: type === 'warden' ? 8 : room < 3 ? 2 : 3,
    type,
    speed: type === 'warden' ? 28 : type === 'archer' ? 31 : 35 + room * 2,
    hit: 0,
    state: 'approach',
    timer: 0,
    aim: { x: 1, y: 0 },
    struck: false,
  }));
  const key = pos(
    ...[
      [2, 2],
      [18, 6],
      [17, 2],
      [3, 3],
      [11, 2],
    ][room - 1],
  );
  const chest = { ...pos(...(room === 3 ? [4, 2] : [17, 11])), opened: false };
  const shrine = { ...pos(3, 11), used: false };
  const lever =
    room === 3
      ? { ...pos(3, 10), on: false, purpose: 'gate' }
      : room === 4
        ? { ...pos(3, 2), on: false, purpose: 'spikes' }
        : null;
  const hazards = (
    room === 1
      ? []
      : room === 2
        ? [
            [10, 5],
            [16, 9],
          ]
        : room === 3
          ? [
              [9, 6],
              [15, 6],
            ]
          : room === 4
            ? [
                [9, 5],
                [12, 8],
                [17, 9],
              ]
            : [
                [8, 7],
                [14, 7],
              ]
  ).map(([x, y], index) => ({ ...pos(x, y), offset: index * 0.8, disabled: false, state: 'safe' }));
  const potions = [pos(5, 10)];
  for (const obj of [
    ...enemies,
    key,
    chest,
    shrine,
    ...hazards,
    ...potions,
    ...(lever ? [lever] : []),
  ]) {
    const cx = Math.floor((obj.x - 20) / 20),
      cy = Math.floor((obj.y - 30) / 20);
    tiles[cy][cx] = 0;
  }
  const gates = [];
  if (room === 3) {
    for (let x = 1; x < 21; x++) tiles[4][x] = 1;
    tiles[4][10] = 2;
    gates.push({ cx: 10, cy: 4 });
  }
  return {
    tiles,
    exit: pos(19, 1),
    boss: room === 5,
    roomName: { en: NAMES[room - 1][0], zh: NAMES[room - 1][1] },
    enemies,
    key,
    chest,
    shrine,
    lever,
    hazards,
    potions,
    gates,
    treasures: [pos(4, 2), pos(18, 5)],
  };
}
function enterRoom(s, room) {
  Object.assign(s, buildRoom(room));
  s.room = room;
  s.player = { ...pos(2, 11), vx: 0, vy: 0, facing: 1 };
  s.facingY = 0;
  s.hasKey = false;
  s.projectiles = [];
  s.attack = 0;
  s.cooldown = 0;
  s.swing = null;
  s.path = [];
  s.pathTimer = 0;
  s.invulnerable = 0.65;
  s.dash = 0;
  s.toast = { en: s.roomName.en, zh: s.roomName.zh, time: 1.8 };
}
export function createDungeonState() {
  const s = {
    phase: 'playing',
    score: 0,
    room: 1,
    health: 5,
    kills: 0,
    stamina: 100,
    dash: 0,
    dashCooldown: 0,
    dashDir: { x: 1, y: 0 },
    facingY: 0,
    pickups: 0,
    flasks: 1,
    healCooldown: 0,
    invulnerable: 0,
    time: 0,
    particles: [],
    swing: null,
    attack: 0,
    cooldown: 0,
    drank: 0,
  };
  enterRoom(s, 1);
  return s;
}
function cellAt(x, y) {
  return [Math.floor((x - 20) / 20), Math.floor((y - 30) / 20)];
}
function solid(s, cx, cy) {
  return s.tiles[cy]?.[cx] !== 0;
}
function blocked(s, x, y, r = HALF) {
  for (const dx of [-r + 0.001, r - 0.001])
    for (const dy of [-r + 0.001, r - 0.001]) {
      const [cx, cy] = cellAt(x + dx, y + dy);
      if (solid(s, cx, cy)) return true;
    }
  return false;
}
function sight(s, ax, ay, bx, by) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
  for (let n = 1; n < steps; n++)
    if (blocked(s, ax + ((bx - ax) * n) / steps, ay + ((by - ay) * n) / steps, 0)) return false;
  return true;
}
function moveBody(s, a, dx, dy) {
  // Sweep each footprint axis against every tile crossed, then slide along walls.
  let next = a.x + dx;
  const ymin = Math.floor((a.y - HALF + 0.001 - 30) / 20),
    ymax = Math.floor((a.y + HALF - 0.001 - 30) / 20);
  for (let cy = ymin; cy <= ymax; cy++)
    for (
      let cx = Math.floor((Math.min(a.x, next) - HALF - 20) / 20);
      cx <= Math.floor((Math.max(a.x, next) + HALF - 20) / 20);
      cx++
    )
      if (solid(s, cx, cy)) {
        const left = 20 + cx * 20,
          right = left + 20;
        if (dx > 0 && a.x + HALF <= left + 0.001 && next + HALF > left) {
          next = Math.min(next, left - HALF);
          a.vx = Math.min(a.vx || 0, 0);
        }
        if (dx < 0 && a.x - HALF >= right - 0.001 && next - HALF < right) {
          next = Math.max(next, right + HALF);
          a.vx = Math.max(a.vx || 0, 0);
        }
      }
  a.x = next;
  next = a.y + dy;
  const xmin = Math.floor((a.x - HALF + 0.001 - 20) / 20),
    xmax = Math.floor((a.x + HALF - 0.001 - 20) / 20);
  for (let cx = xmin; cx <= xmax; cx++)
    for (
      let cy = Math.floor((Math.min(a.y, next) - HALF - 30) / 20);
      cy <= Math.floor((Math.max(a.y, next) + HALF - 30) / 20);
      cy++
    )
      if (solid(s, cx, cy)) {
        const top = 30 + cy * 20,
          bottom = top + 20;
        if (dy > 0 && a.y + HALF <= top + 0.001 && next + HALF > top) {
          next = Math.min(next, top - HALF);
          a.vy = Math.min(a.vy || 0, 0);
        }
        if (dy < 0 && a.y - HALF >= bottom - 0.001 && next - HALF < bottom) {
          next = Math.max(next, bottom + HALF);
          a.vy = Math.max(a.vy || 0, 0);
        }
      }
  a.y = next;
}
function driveBody(s, a, tx, ty, acceleration, dt) {
  a.vx ??= 0;
  a.vy ??= 0;
  const dx = tx - a.vx,
    dy = ty - a.vy,
    d = Math.hypot(dx, dy),
    scale = d ? Math.min(1, (acceleration * dt) / d) : 0;
  const vx = a.vx,
    vy = a.vy;
  a.vx += dx * scale;
  a.vy += dy * scale;
  moveBody(s, a, (vx + a.vx) * 0.5 * dt, (vy + a.vy) * 0.5 * dt);
}
function separate(s, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ox = 16 - Math.abs(dx),
    oy = 16 - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return;
  const nx = ox < oy ? (dx >= 0 ? 1 : -1) : 0,
    ny = ox < oy ? 0 : dy >= 0 ? 1 : -1,
    depth = Math.min(ox, oy);
  const am = a.type === 'warden' ? 3 : 1,
    bm = b.type === 'warden' ? 3 : 1;
  moveBody(s, a, (-nx * depth * bm) / (am + bm), (-ny * depth * bm) / (am + bm));
  moveBody(s, b, (nx * depth * am) / (am + bm), (ny * depth * am) / (am + bm));
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    const j = -vn / (1 / am + 1 / bm);
    a.vx -= (j * nx) / am;
    a.vy -= (j * ny) / am;
    b.vx += (j * nx) / bm;
    b.vy += (j * ny) / bm;
  }
}
function pathField(s) {
  const [cx, cy] = cellAt(s.player.x, s.player.y),
    d = Array.from({ length: 14 }, () => Array(22).fill(1000));
  if (!d[cy] || cx < 0 || cx >= 22) return d;
  d[cy][cx] = 0;
  const q = [[cx, cy]];
  for (let k = 0; k < q.length; k++) {
    const [x, y] = q[k];
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (!solid(s, x + ox, y + oy) && d[y + oy][x + ox] > d[y][x] + 1) {
        d[y + oy][x + ox] = d[y][x] + 1;
        q.push([x + ox, y + oy]);
      }
  }
  return d;
}
// Both the drawn blade and its damage use this wall-clipped segment.
export function weaponSegment(s, actor, angle, length) {
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  let reach = length;
  for (let d = 8; d <= length; d += 1)
    if (blocked(s, actor.x + dx * d, actor.y + dy * d, 2)) {
      reach = Math.max(8, d - 1);
      break;
    }
  return {
    ax: actor.x + dx * 8,
    ay: actor.y + dy * 8,
    bx: actor.x + dx * reach,
    by: actor.y + dy * reach,
    r: 2,
  };
}
function playerBlade(s) {
  if (!s.swing || s.swing.elapsed < 0.07 || s.swing.elapsed >= 0.23) return null;
  return weaponSegment(
    s,
    s.player,
    s.swing.angle - 1.05 + ((s.swing.elapsed - 0.07) / 0.16) * 2.1,
    32,
  );
}
function enemyBlade(s, e) {
  if (e.state !== 'active' || e.type === 'archer') return null;
  const duration = e.type === 'warden' ? 0.5 : 0.18,
    progress = 1 - e.timer / duration;
  return weaponSegment(
    s,
    e,
    Math.atan2(e.aim.y, e.aim.x) +
      (e.type === 'warden' ? -Math.PI + progress * 2 * Math.PI : -0.8 + progress * 1.6),
    e.type === 'warden' ? 44 : 25,
  );
}
function bladeHits(blade, target) {
  return (
    rayBox(
      blade.ax,
      blade.ay,
      blade.bx - blade.ax,
      blade.by - blade.ay,
      target.x - HALF - blade.r,
      target.y - HALF - blade.r,
      target.x + HALF + blade.r,
      target.y + HALF + blade.r,
    ) <= 1
  );
}
function toast(s, en, zh) {
  s.toast = { en, zh, time: 1.5 };
}
function hurt(s, env, x, y) {
  if (s.invulnerable > 0) return;
  s.health--;
  s.invulnerable = 0.9;
  const d = Math.hypot(s.player.x - x, s.player.y - y) || 1;
  s.player.vx += ((s.player.x - x) / d) * 70;
  s.player.vy += ((s.player.y - y) / d) * 70;
  s.particles.push({ x: s.player.x, y: s.player.y, life: 0.25, kind: 'hurt' });
  env.sound('hit');
}
function end(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All five chambers cleared. The vault is yours!'
        : 'The guardians caught you. Read their windups and use your healing flasks.',
      won ? '五座密室全部通过，宝库属于你！' : '你被守卫击败。观察蓄力，及时使用药水。',
    ),
  });
}
function use(s, env) {
  const near = (o) =>
    o &&
    Math.hypot(o.x - s.player.x, o.y - s.player.y) < 28 &&
    sight(s, s.player.x, s.player.y, o.x, o.y);
  if (near(s.lever) && !s.lever.on) {
    s.lever.on = true;
    for (const g of s.gates) s.tiles[g.cy][g.cx] = 0;
    if (s.lever.purpose === 'spikes') for (const h of s.hazards) h.disabled = true;
    s.pathTimer = 0;
    s.score += 100;
    toast(
      s,
      s.lever.purpose === 'gate' ? 'Archive gate opened' : 'Spike mechanism disabled',
      s.lever.purpose === 'gate' ? '书库闸门已打开' : '尖刺机关已关闭',
    );
    env.sound('coin');
  } else if (near(s.chest) && !s.chest.opened) {
    if (s.flasks >= 3) {
      toast(s, 'Flask pack full — use one first', '药水已满，先使用一瓶');
      return;
    }
    s.chest.opened = true;
    s.flasks++;
    s.score += 200;
    s.pickups++;
    toast(s, 'Supply cache: +1 flask', '补给箱：药水+1');
    env.sound('coin');
  } else if (near(s.shrine) && !s.shrine.used) {
    if (s.health === 5 && s.stamina > 95) {
      toast(s, 'Shrine saved until you need recovery', '状态良好，神龛留待恢复');
      return;
    }
    s.shrine.used = true;
    s.health = Math.min(5, s.health + 2);
    s.stamina = 100;
    toast(s, 'Shrine restored health and stamina', '神龛恢复生命与体力');
    env.sound('coin');
  } else toast(s, 'Stand near a switch, cache or shrine', '靠近开关、补给箱或神龛再使用');
}
function rayBox(x, y, dx, dy, left, top, right, bottom) {
  let t0 = 0,
    t1 = 1;
  for (const [p, v, lo, hi] of [
    [x, dx, left, right],
    [y, dy, top, bottom],
  ]) {
    if (Math.abs(v) < 1e-12) {
      if (p < lo || p > hi) return Infinity;
    } else {
      const a = (lo - p) / v,
        b = (hi - p) / v;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}
function stepArrows(s, dt, env) {
  for (const p of s.projectiles) {
    const travel = Math.min(dt, Math.max(0, p.life));
    if (travel === 0) continue;
    const dx = p.vx * travel,
      dy = p.vy * travel;
    let wall = Infinity;
    for (
      let cy = Math.max(0, Math.floor((Math.min(p.y, p.y + dy) - 2 - 30) / 20));
      cy <= Math.min(13, Math.floor((Math.max(p.y, p.y + dy) + 2 - 30) / 20));
      cy++
    )
      for (
        let cx = Math.max(0, Math.floor((Math.min(p.x, p.x + dx) - 2 - 20) / 20));
        cx <= Math.min(21, Math.floor((Math.max(p.x, p.x + dx) + 2 - 20) / 20));
        cx++
      )
        if (solid(s, cx, cy))
          wall = Math.min(
            wall,
            rayBox(
              p.x,
              p.y,
              dx,
              dy,
              20 + cx * 20 - 2,
              30 + cy * 20 - 2,
              40 + cx * 20 + 2,
              50 + cy * 20 + 2,
            ),
          );
    const player = rayBox(
      p.x,
      p.y,
      dx,
      dy,
      s.player.x - HALF - 2,
      s.player.y - HALF - 2,
      s.player.x + HALF + 2,
      s.player.y + HALF + 2,
    );
    const active = p.active !== false && Math.hypot(p.vx, p.vy) > 1;
    const hit = Math.min(1, wall, active ? player : Infinity);
    p.x += dx * hit;
    p.y += dy * hit;
    p.life -= travel;
    if (wall <= 1 && (!active || wall <= player)) p.life = 0;
    else if (active && player <= 1) {
      hurt(s, env, p.x - p.vx * 0.01, p.y - p.vy * 0.01);
      p.life = 0;
    }
  }
  s.projectiles = s.projectiles.filter((p) => p.life > 1e-8);
}
export function stepDungeon(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  if (s.health <= 0) {
    end(s, env, false);
    return;
  }
  dt = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  if (dt === 0) return;
  const inputX = Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA')),
    inputY = Number(i.held('ArrowDown', 'KeyS')) - Number(i.held('ArrowUp', 'KeyW')),
    inputLength = Math.hypot(inputX, inputY);
  if (inputLength) {
    s.player.facing = inputX / inputLength;
    s.facingY = inputY / inputLength;
  }
  if (i.pressed('KeyK', 'ShiftLeft', 'ShiftRight') && s.dashCooldown === 0 && s.stamina >= 22) {
    s.stamina -= 22;
    s.dash = 0.18;
    s.dashCooldown = 0.8;
    s.dashDir = { x: s.player.facing, y: s.facingY };
    env.sound('move');
  }
  if (i.pressed('KeyH', 'KeyX') && s.healCooldown === 0) {
    if (s.health < 5 && s.flasks > 0) {
      s.flasks--;
      s.drank++;
      const restored = Math.min(2, 5 - s.health);
      s.health += restored;
      s.healCooldown = 0.4;
      toast(
        s,
        `Flask restored ${restored} ${restored === 1 ? 'heart' : 'hearts'}`,
        `药水恢复${restored}颗心`,
      );
      env.sound('coin');
    } else
      toast(
        s,
        s.flasks ? 'Health full — flask saved' : 'No healing flasks',
        s.flasks ? '生命已满，药水保留' : '没有治疗药水',
      );
  }
  if (i.pressed('KeyE', 'Enter')) use(s, env);
  for (let n = 0; n < s.enemies.length; n++) {
    const e = s.enemies[n];
    e.id ??= `${s.room}:${n}`;
    e.vx ??= 0;
    e.vy ??= 0;
    e.state ??= 'approach';
    e.aim ??= { x: 1, y: 0 };
    e.type ??= 'guard';
    e.struck ??= false;
  }
  const wish = i.held('Space', 'KeyJ') || i.pressed('Space', 'KeyJ');
  // Limit relative footprint travel even after an unusually strong impulse.
  const fastest = Math.max(
    Math.hypot(s.player.vx, s.player.vy),
    ...s.enemies.map((e) => Math.hypot(e.vx, e.vy)),
  );
  const count = Math.max(1, Math.ceil(dt * Math.max(240, (fastest + 230) / 3))),
    h = dt / count;
  for (let step = 0; step < count && s.phase === 'playing'; step++) {
    s.time += h;
    s.stamina = Math.min(100, s.stamina + 24 * h);
    s.dash = Math.max(0, s.dash - h);
    s.dashCooldown = Math.max(0, s.dashCooldown - h);
    s.healCooldown = Math.max(0, s.healCooldown - h);
    s.invulnerable = Math.max(0, s.invulnerable - h);
    s.cooldown = Math.max(0, s.cooldown - h);
    s.toast.time = Math.max(0, s.toast.time - h);
    s.particles = s.particles.filter((p) => (p.life -= h) > 0);
    const speed = s.dash > 0 ? 230 : 100,
      dx = s.dash > 0 ? s.dashDir.x : inputLength ? inputX / inputLength : 0,
      dy = s.dash > 0 ? s.dashDir.y : inputLength ? inputY / inputLength : 0;
    driveBody(s, s.player, dx * speed, dy * speed, s.dash > 0 ? 2600 : 1800, h);
    if (wish && s.cooldown === 0 && s.stamina >= 18) {
      s.stamina -= 18;
      s.cooldown = 0.42;
      s.attack = 0.4;
      s.swing = { elapsed: 0, angle: Math.atan2(s.facingY, s.player.facing), hitIds: [] };
      env.sound('shoot');
    }
    if (s.swing) {
      s.swing.elapsed += h;
      s.attack = Math.max(0, 0.4 - s.swing.elapsed);
      if (s.swing.elapsed >= 0.07 && s.swing.elapsed < 0.23) {
        const blade = playerBlade(s);
        for (const e of s.enemies)
          if (
            !s.swing.hitIds.includes(e.id) &&
            bladeHits(blade, e) &&
            sight(s, s.player.x, s.player.y, e.x, e.y)
          ) {
            s.swing.hitIds.push(e.id);
            e.hp--;
            e.hit = 0.2;
            const d = Math.hypot(e.x - s.player.x, e.y - s.player.y) || 1;
            e.vx += ((e.x - s.player.x) / d) * 90;
            e.vy += ((e.y - s.player.y) / d) * 90;
            if (e.type !== 'warden') {
              e.state = 'recover';
              e.timer = 0.45;
            }
            s.particles.push({ x: e.x, y: e.y, life: 0.22, kind: 'hit' });
            env.sound('hit');
          }
      }
      if (s.swing.elapsed >= 0.4) s.swing = null;
    }
    const dead = s.enemies.filter((e) => e.hp <= 0);
    if (dead.length) {
      s.kills += dead.length;
      s.score += dead.length * 100;
      env.sound('coin');
    }
    s.enemies = s.enemies.filter((e) => e.hp > 0);
    s.pathTimer -= h;
    if (s.pathTimer <= 0) {
      s.path = pathField(s);
      s.pathTimer = 0.18;
    }
    for (const e of s.enemies) {
      e.hit = Math.max(0, e.hit - h);
      e.timer = Math.max(0, (e.timer || 0) - h);
      const pd = Math.hypot(e.x - s.player.x, e.y - s.player.y);
      let vx = 0,
        vy = 0;
      if (e.state === 'approach') {
        const reach = e.type === 'archer' ? 150 : e.type === 'warden' ? 58 : 30;
        if (pd < reach && sight(s, e.x, e.y, s.player.x, s.player.y)) {
          e.state = 'windup';
          e.timer = e.type === 'warden' ? 0.85 : e.type === 'archer' ? 0.7 : 0.55;
          e.aim = { x: (s.player.x - e.x) / (pd || 1), y: (s.player.y - e.y) / (pd || 1) };
          e.struck = false;
        } else {
          const [cx, cy] = cellAt(e.x, e.y);
          let target = s.player,
            lowest = s.path[cy]?.[cx] ?? 1000;
          for (const [ox, oy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const d = s.path[cy + oy]?.[cx + ox] ?? 1000;
            if (d < lowest) {
              lowest = d;
              target = pos(cx + ox, cy + oy);
            }
          }
          const ex = target.x - e.x,
            ey = target.y - e.y,
            d = Math.hypot(ex, ey);
          if (d > 1 && e.hit === 0) {
            vx = (ex / d) * e.speed;
            vy = (ey / d) * e.speed;
          }
        }
      } else if (e.state === 'windup' && e.timer === 0) {
        if (e.type === 'archer') {
          s.projectiles.push({
            x: e.x,
            y: e.y,
            vx: e.aim.x * 150,
            vy: e.aim.y * 150,
            life: 3,
            active: true,
          });
          e.state = 'recover';
          e.timer = 0.8;
          env.sound('shoot');
        } else {
          e.state = 'active';
          e.timer = e.type === 'warden' ? 0.5 : 0.18;
        }
      } else if (e.state === 'active') {
        const blade = enemyBlade(s, e);
        if (!e.struck && bladeHits(blade, s.player) && sight(s, e.x, e.y, s.player.x, s.player.y)) {
          e.struck = true;
          hurt(s, env, e.x, e.y);
        }
        if (e.timer === 0) {
          e.state = 'recover';
          e.timer = e.type === 'warden' ? 1.1 : 0.65;
        }
      } else if (e.state === 'recover' && e.timer === 0) e.state = 'approach';
      driveBody(s, e, vx, vy, 420, h);
    }
    const actors = [s.player, ...s.enemies];
    for (let a = 0; a < actors.length; a++)
      for (let b = a + 1; b < actors.length; b++) separate(s, actors[a], actors[b]);
    stepArrows(s, h, env);
    for (const hazard of s.hazards) {
      const phase = (s.time + hazard.offset) % 3;
      hazard.state = hazard.disabled
        ? 'safe'
        : phase < 1.8
          ? 'safe'
          : phase < 2.4
            ? 'warning'
            : 'active';
      if (
        hazard.state === 'active' &&
        Math.abs(s.player.x - hazard.x) < HALF + 7 &&
        Math.abs(s.player.y - hazard.y) < HALF + 7
      )
        hurt(s, env, hazard.x, hazard.y);
    }
    s.treasures = s.treasures.filter((p) => {
      if (
        Math.hypot(p.x - s.player.x, p.y - s.player.y) > 14 ||
        !sight(s, p.x, p.y, s.player.x, s.player.y)
      )
        return true;
      s.score += 60;
      s.pickups++;
      env.sound('coin');
      return false;
    });
    s.potions = s.potions.filter((p) => {
      if (s.flasks >= 3 || Math.hypot(p.x - s.player.x, p.y - s.player.y) > 14) return true;
      s.flasks++;
      toast(s, 'Picked up a healing flask', '拾取治疗药水');
      env.sound('coin');
      return false;
    });
    if (
      !s.hasKey &&
      Math.hypot(s.key.x - s.player.x, s.key.y - s.player.y) < 14 &&
      sight(s, s.key.x, s.key.y, s.player.x, s.player.y)
    ) {
      s.hasKey = true;
      s.score += 100;
      toast(s, 'Key found — clear the guardians', '找到钥匙，清理剩余守卫');
      env.sound('coin');
    }
    if (s.health <= 0) {
      end(s, env, false);
      break;
    }
    if (
      s.hasKey &&
      s.enemies.length === 0 &&
      Math.hypot(s.exit.x - s.player.x, s.exit.y - s.player.y) < 16
    ) {
      s.score += 500;
      if (s.room === 5) {
        end(s, env, true);
        break;
      }
      s.health = Math.min(5, s.health + 1);
      enterRoom(s, s.room + 1);
      env.sound('win');
      break;
    }
    if (s.particles.length > 24) s.particles.splice(0, s.particles.length - 24);
  }
}

const HERO = [
  '..1111..',
  '.122221.',
  '.123321.',
  '..2222..',
  '.444444.',
  '44544544',
  '..4444..',
  '..5..5..',
];
const GUARD = [
  '..1111..',
  '.122221.',
  '.123321.',
  '..2222..',
  '.444444.',
  '44544544',
  '..4444..',
  '.55..55.',
];
const ARCHER = [
  '..11....',
  '.1221...',
  '123321..',
  '.1221...',
  '..44.5..',
  '.44455..',
  '..4..5..',
  '.6.6....',
];
const WARDEN = [
  '1..11..1',
  '11222211',
  '.233332.',
  '.223322.',
  '14444441',
  '14444441',
  '..4..4..',
  '.55..55.',
];
function objective(s) {
  if (s.lever?.purpose === 'gate' && !s.lever.on)
    return { en: 'E: use the switch to open the archive gate', zh: '按E操作开关，打开书库闸门' };
  if (s.enemies.length)
    return {
      en: `Defeat ${s.enemies.length} ${s.enemies.length === 1 ? 'guardian' : 'guardians'} · ${s.hasKey ? 'Key secured' : 'Find the key'}`,
      zh: `击败${s.enemies.length}名守卫 · ${s.hasKey ? '已取得钥匙' : '寻找钥匙'}`,
    };
  if (!s.hasKey)
    return {
      en: 'Find the gold key, then reach the northeast exit',
      zh: '寻找金色钥匙，然后前往东北出口',
    };
  return { en: 'All clear — enter the glowing northeast exit', zh: '守卫已清除，进入东北发光出口' };
}
function bladeDraw(ctx, blade, color) {
  if (!blade) return;
  ctx.strokeStyle = '#263b42';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(blade.ax, blade.ay);
  ctx.lineTo(blade.bx, blade.by);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = blade.r * 2;
  ctx.beginPath();
  ctx.moveTo(blade.ax, blade.ay);
  ctx.lineTo(blade.bx, blade.by);
  ctx.stroke();
  ctx.fillStyle = '#fff2c8';
  ctx.fillRect(blade.bx - 1, blade.by - 1, 2, 2);
}
function drawDungeon(ctx, s, env) {
  const palettes = [
    ['#1b3337', '#43565a'],
    ['#29343b', '#565f65'],
    ['#293443', '#586275'],
    ['#362e2a', '#6e5547'],
    ['#2e3041', '#615770'],
  ];
  const [floor, wall] = palettes[s.room - 1];
  background(ctx, '#0e1c26');
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 22; x++) {
      const px = 20 + x * 20,
        py = 30 + y * 20,
        tile = s.tiles[y][x];
      if (tile) {
        ctx.fillStyle = tile === 2 ? '#35434d' : wall;
        ctx.fillRect(px, py, 20, 20);
        ctx.fillStyle = tile === 2 ? '#b6a16e' : '#75807b';
        ctx.fillRect(px, py, 20, 3);
        ctx.fillStyle = '#142630';
        ctx.fillRect(px, py + 18, 20, 2);
        ctx.fillRect(px + 18, py + 3, 2, 15);
        if (tile === 2) {
          ctx.fillStyle = '#a5b4af';
          for (let k = 3; k < 18; k += 5) ctx.fillRect(px + k, py + 3, 2, 15);
          ctx.fillStyle = '#d4bb70';
          ctx.fillRect(px + 7, py + 8, 6, 7);
        } else {
          ctx.fillStyle = '#34484c';
          ctx.fillRect(px + 2, py + 10, 16, 1);
          ctx.fillRect(px + ((x + y) % 2 ? 7 : 13), py + 3, 1, 7);
        }
      } else {
        ctx.fillStyle = floor;
        ctx.fillRect(px, py, 20, 20);
        ctx.fillStyle = '#3a5053';
        ctx.fillRect(px + 2, py + 17, 16, 1);
        if ((x * 7 + y * 13) % 9 === 0) {
          ctx.fillRect(px + 5, py + 5, 1, 5);
          ctx.fillRect(px + 6, py + 9, 4, 1);
        }
      }
    }
  for (const x of [3, 8, 13, 18]) {
    const px = 20 + x * 20,
      py = 35;
    ctx.fillStyle = '#1a292e';
    ctx.fillRect(px + 4, py + 3, 9, 10);
    ctx.fillStyle = '#d59756';
    ctx.fillRect(px + 6, py, 5, 8);
    ctx.fillStyle = '#ffe1a0';
    ctx.fillRect(px + 7, py - (Math.floor(s.time * 9 + x) % 2), 3, 5);
  }
  for (const g of s.gates)
    if (s.tiles[g.cy][g.cx] === 0) {
      ctx.fillStyle = '#829188';
      ctx.fillRect(20 + g.cx * 20, 30 + g.cy * 20, 20, 2);
      ctx.fillRect(20 + g.cx * 20, 48 + g.cy * 20, 20, 2);
    }
  for (const h of s.hazards) {
    ctx.fillStyle = h.disabled ? '#415456' : '#151e25';
    ctx.fillRect(h.x - 7, h.y - 7, 14, 14);
    if (h.state === 'active') {
      ctx.fillStyle = '#efd1ad';
      for (let n = -1; n <= 1; n++) {
        ctx.fillRect(h.x + n * 4 - 1, h.y - 6, 2, 11);
        ctx.fillRect(h.x + n * 4 - 2, h.y - 3, 4, 6);
      }
    } else if (h.state === 'warning') {
      ctx.fillStyle = '#df9d62';
      ctx.fillRect(h.x - 6, h.y - 6, 12, 2);
      ctx.fillRect(h.x - 1, h.y - 2, 2, 6);
      ctx.fillRect(h.x - 1, h.y + 5, 2, 2);
    } else {
      ctx.fillStyle = '#55666a';
      for (let n = -1; n <= 1; n++) ctx.fillRect(h.x + n * 4 - 1, h.y - 3, 2, 5);
    }
  }
  const ready = s.hasKey && s.enemies.length === 0;
  ctx.fillStyle = ready ? '#d8d49b' : '#547271';
  ctx.fillRect(s.exit.x - 9, s.exit.y - 10, 18, 20);
  ctx.fillStyle = '#102b32';
  ctx.fillRect(s.exit.x - 6, s.exit.y - 7, 12, 17);
  if (ready) {
    ctx.fillStyle = '#b7e0bb';
    ctx.fillRect(s.exit.x - 4, s.exit.y - 5, 8, 15);
  } else {
    ctx.fillStyle = '#bcae77';
    ctx.fillRect(s.exit.x - 2, s.exit.y - 1, 4, 5);
  }
  for (const p of s.treasures) {
    ctx.fillStyle = '#ac7742';
    ctx.fillRect(p.x - 5, p.y - 4, 10, 8);
    ctx.fillStyle = '#ffe2a0';
    ctx.fillRect(p.x - 2, p.y - 3, 4, 6);
  }
  const flask = (x, y) => {
    ctx.fillStyle = '#d5e5cd';
    ctx.fillRect(x - 2, y - 6, 4, 4);
    ctx.fillStyle = '#d9786e';
    ctx.fillRect(x - 4, y - 2, 8, 7);
    ctx.fillStyle = '#f8c9a4';
    ctx.fillRect(x - 2, y - 1, 2, 4);
  };
  for (const p of s.potions) flask(p.x, p.y);
  ctx.fillStyle = s.chest.opened ? '#35524f' : '#ac864d';
  ctx.fillRect(s.chest.x - 7, s.chest.y - 6, 14, 12);
  ctx.fillStyle = s.chest.opened ? '#799d83' : '#ecd096';
  ctx.fillRect(s.chest.x - 5, s.chest.y - 1, 10, 2);
  ctx.fillRect(s.chest.x - 1, s.chest.y - 4, 2, 8);
  ctx.fillStyle = s.shrine.used ? '#3b5255' : '#6ea9aa';
  ctx.fillRect(s.shrine.x - 7, s.shrine.y - 7, 14, 14);
  ctx.fillStyle = '#b6d3b6';
  ctx.fillRect(s.shrine.x - 1, s.shrine.y - 4, 2, 8);
  ctx.fillRect(s.shrine.x - 4, s.shrine.y - 1, 8, 2);
  if (s.lever) {
    const p = s.lever;
    ctx.fillStyle = '#67747a';
    ctx.fillRect(p.x - 7, p.y - 5, 14, 10);
    ctx.fillStyle = p.on ? '#9ec99d' : '#edbb73';
    ctx.fillRect(p.x + (p.on ? 1 : -5), p.y - 6, 4, 8);
  }
  if (!s.hasKey) {
    ctx.fillStyle = '#f1cf78';
    ctx.fillRect(s.key.x - 6, s.key.y - 4, 7, 7);
    ctx.fillRect(s.key.x, s.key.y - 1, 8, 3);
    ctx.fillRect(s.key.x + 5, s.key.y + 1, 3, 3);
    ctx.fillStyle = '#4c5143';
    ctx.fillRect(s.key.x - 4, s.key.y - 2, 3, 3);
  }
  for (const p of s.projectiles) {
    const speed = Math.hypot(p.vx, p.vy) || 1;
    ctx.strokeStyle = '#deb57b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - (p.vx / speed) * 8, p.y - (p.vy / speed) * 8);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = '#f3e0ba';
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  for (const e of s.enemies) {
    if (e.state === 'windup') {
      const a = Math.atan2(e.aim.y, e.aim.x),
        range = e.type === 'warden' ? 54 : e.type === 'archer' ? 145 : 35;
      ctx.strokeStyle = '#d78f61';
      ctx.lineWidth = 1;
      if (e.type === 'archer') {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(a) * range, e.y + Math.sin(a) * range);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(
          e.x,
          e.y,
          range,
          e.type === 'warden' ? 0 : a - 0.8,
          e.type === 'warden' ? Math.PI * 2 : a + 0.8,
        );
        ctx.stroke();
      }
      text(ctx, '!', e.x, e.y - 23, '#ffdda0', 13, 'center');
    }
    ctx.fillStyle = '#102128';
    ctx.fillRect(e.x - 8, e.y + 5, 16, 4);
    const color =
      e.hit > 0
        ? '#fff0c9'
        : e.type === 'warden'
          ? '#bd8fbc'
          : e.type === 'archer'
            ? '#cfad73'
            : '#9cb2a1';
    pixelSprite(
      ctx,
      e.type === 'warden' ? WARDEN : e.type === 'archer' ? ARCHER : GUARD,
      e.x - 8,
      e.y - 8,
      2,
      { 1: '#74858b', 2: color, 3: '#20323a', 4: color, 5: '#acbab1', 6: '#a99a72' },
    );
    for (let n = 0; n < e.hp; n++) {
      ctx.fillStyle = '#da9a7d';
      ctx.fillRect(e.x - e.hp * 2 + n * 4, e.y - 13, 3, 2);
    }
    bladeDraw(ctx, enemyBlade(s, e), '#f1ab73');
  }
  const moving = Math.hypot(s.player.vx, s.player.vy) > 10;
  if (s.dash > 0) {
    ctx.fillStyle = '#668e92';
    ctx.fillRect(s.player.x - 5 - s.dashDir.x * 9, s.player.y - 5 - s.dashDir.y * 9, 10, 10);
  }
  ctx.fillStyle = '#102128';
  ctx.fillRect(s.player.x - 8, s.player.y + 5, 16, 4);
  {
    const hurtFlash = s.invulnerable > 0 && Math.floor(s.invulnerable * 16) % 2 === 0;
    const rows = [...HERO];
    if (moving) rows[7] = Math.floor(s.time * 10) % 2 ? '...5.5..' : '..5.5...';
    pixelSprite(ctx, rows, s.player.x - 8, s.player.y - 8, 2, {
      1: '#d5b77e',
      2: '#efd09b',
      3: '#233b44',
      4: hurtFlash ? '#edc6a7' : '#75bdc0',
      5: '#b4c8b4',
    });
  }
  bladeDraw(ctx, playerBlade(s), '#fff0b5');
  if (s.swing && s.swing.elapsed < 0.07)
    bladeDraw(ctx, weaponSegment(s, s.player, s.swing.angle - 1.05, 25), '#7c9c96');
  for (const p of s.particles) {
    ctx.fillStyle = p.kind === 'hurt' ? '#e5a088' : '#efd59d';
    const d = (0.25 - p.life) * 25;
    for (let n = 0; n < 4; n++)
      ctx.fillRect(
        p.x + Math.cos((n * Math.PI) / 2) * d,
        p.y + Math.sin((n * Math.PI) / 2) * d,
        2,
        2,
      );
  }
  ctx.fillStyle = '#10222d';
  ctx.fillRect(0, 0, 480, 30);
  ctx.fillRect(16, 292, 448, 28);
  text(
    ctx,
    env.t(`${s.room}/5 ${s.roomName.en}`, `${s.room}/5 ${s.roomName.zh}`),
    18,
    8,
    '#d4d1b9',
    10,
  );
  text(ctx, `${s.health} ♥`, 257, 7, '#e9a18b', 13, 'center');
  text(ctx, env.t('STAMINA', '体力'), env.lang === 'zh' ? 198 : 170, 19, '#bec7ad', 10);
  ctx.fillStyle = '#394e53';
  ctx.fillRect(224, 24, 66, 3);
  ctx.fillStyle = s.stamina < 18 ? '#d4886d' : '#c8c588';
  ctx.fillRect(224, 24, s.stamina * 0.66, 3);
  flask(358, 14);
  text(ctx, `${s.flasks}/3`, 373, 8, '#ead5aa', 12);
  const task = objective(s);
  text(ctx, env.t(task.en, task.zh), 240, 295, '#c7d3b5', 10, 'center');
  const hint =
    s.toast.time > 0
      ? env.t(s.toast.en, s.toast.zh)
      : env.t('Space: sword · K: dodge · E: use · H: heal', '空格挥剑 · K闪避 · E使用 · H喝药');
  text(ctx, hint, 240, 308, '#93b0b0', 10, 'center');
}
meta.touchControls = [
  { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
  { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
  { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
  { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
  { code: 'Space', side: 'right', label: { en: 'Sword', zh: '挥剑' } },
  { code: 'KeyK', side: 'right', label: { en: 'Dodge', zh: '闪步' } },
  { code: 'KeyE', side: 'right', label: { en: 'Use', zh: '使用' } },
  { code: 'KeyH', side: 'right', label: { en: 'Heal', zh: '喝药' } },
];
export function createGame(env) {
  const s = createDungeonState();
  return {
    update: (dt, i) => stepDungeon(s, dt, i, env),
    draw: (ctx) => drawDungeon(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${s.roomName.en} ${s.room}/5 · ${s.health} ${s.health === 1 ? 'heart' : 'hearts'} · ${s.flasks} ${s.flasks === 1 ? 'flask' : 'flasks'} · ${objective(s).en}`,
        zh: `${s.roomName.zh} ${s.room}/5 · ${s.health}颗心 · ${s.flasks}瓶药水 · ${objective(s).zh}`,
      },
    }),
  };
}
