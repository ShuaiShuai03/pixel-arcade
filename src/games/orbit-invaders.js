import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';
export const meta = {
  id: 'orbit-invaders',
  name: { en: 'Orbit Invaders', zh: '轨道入侵者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'ShiftLeft', side: 'right', label: { en: 'Guard plate', zh: '护板' } },
  ],
  description: {
    en: 'Defend four lunar encounters. Bunkers stop both sides: fire through gaps or cut a slot. Shoot down incoming rounds; Shift deploys a 0.9-second guard plate for up to three normal hits, with a 5-second activation cooldown. Your gun pauses while guarding; heat cools automatically.',
    zh: '守住四场月面战斗。掩体会挡住双方炮弹：利用空隙或打出射孔。可射落来弹；Shift展开护板0.9秒，最多挡住三发普通弹，每次启动后冷却5秒。护板展开时暂停开火，炮管会自动冷却。',
  },
  keys: [
    {
      label: { en: 'Move', zh: '移动' },
      keys: { en: 'Left / Right or A / D', zh: '左右方向键 / A / D' },
    },
    { label: { en: 'Fire', zh: '射击' }, keys: { en: 'Space / Z', zh: '空格 / Z' } },
    {
      label: { en: 'Guard plate', zh: '护板' },
      keys: {
        en: 'Shift (5s recharge; gun safe while guarding)',
        zh: 'Shift（5秒充能；护板展开时暂停开火）',
      },
    },
  ],
};
const HULL = { w: 28, h: 20 },
  LINE = 236,
  SPEED = 220,
  ACCEL = 1400;
const SHAPES = {
  scout: { w: 20, h: 16 },
  diver: { w: 24, h: 16 },
  artillery: { w: 26, h: 20 },
  commander: { w: 68, h: 30 },
};
const NAMES = [
  { en: 'Scout March', zh: '侦察行军' },
  { en: 'Diving Wings', zh: '俯冲之翼' },
  { en: 'Crossfire Battery', zh: '交叉炮阵' },
  { en: 'Siege Frigate', zh: '围攻旗舰' },
];
const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);
function body(e) {
  return SHAPES[e.role] || SHAPES.scout;
}
export function makeFleet(wave) {
  const fleet = [];
  const add = (x, y, role = 'scout', type = 0, hp = 1) =>
    fleet.push({
      id: wave * 100 + fleet.length + 1,
      x,
      y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      type,
      role,
      mode: 'formation',
      homeY: y,
      slotX: x - 240,
      slotY: y - 60,
      flash: 0,
    });
  if (wave === 1) {
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 8; col++) add(68 + col * 45, 62 + row * 29, 'scout', row);
  }
  if (wave === 2) {
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 6; col++) add(90 + col * 58, 64 + row * 30, 'scout', row);
    for (const x of [66, 182, 298, 414]) add(x, 130, 'diver', 1);
  }
  if (wave === 3) {
    for (const x of [80, 160, 240, 320, 400]) add(x, 64, 'artillery', 0, 2);
    for (const x of [120, 200, 280, 360]) add(x, 104, 'scout', 1);
    for (const x of [80, 240, 400]) add(x, 136, 'diver', 2);
  }
  if (wave === 4) {
    for (const x of [65, 100, 135, 170, 310, 345, 380, 415]) add(x, 125, 'scout', 2);
    add(240, 65, 'commander', 3, 24);
  }
  return fleet;
}
function makeBunkers() {
  return [55, 165, 275, 385].map((x, id) => {
    const blocks = [];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 7; col++)
        if (row === 0 || col < 2 || col > 4)
          blocks.push({ x: x + col * 6, y: 244 + row * 6, w: 6, h: 6, hp: 1 });
    return { id, x, y: 244, w: 42, h: 18, hp: blocks.length, blocks };
  });
}
function formation() {
  return { x: 240, y: 60, vx: 0, vy: 0, phase: 'sweep', direction: 1, targetY: 60 };
}
export function createInvaderState() {
  return {
    phase: 'playing',
    score: 0,
    wave: 1,
    lives: 3,
    ship: { x: 240, y: 283, vx: 0 },
    enemies: makeFleet(1),
    shots: [],
    bullets: [],
    shields: makeBunkers(),
    formation: formation(),
    direction: 1,
    fireCooldown: 0,
    enemyCooldown: 1.2,
    invulnerable: 1.2,
    particles: [],
    time: 0,
    waveTime: 100,
    ufo: null,
    ufoTimer: 12,
    ufoPasses: 1,
    warnings: [],
    barrier: 0,
    barrierCooldown: 0,
    barrierHp: 0,
    barrierWidth: 0,
    heat: 0,
    overheated: false,
    intercepts: 0,
    shotsFired: 0,
    enemyShotsFired: 0,
    banner: 2.6,
    deploy: 1.2,
    diveTimer: 4,
    intermission: 0,
    cleared: false,
    nextId: 1000,
  };
}
function prepare(s) {
  s.formation ??= formation();
  s.ship.vx ??= 0;
  s.heat ??= 0;
  s.overheated ??= false;
  s.intercepts ??= 0;
  s.shotsFired ??= 0;
  s.enemyShotsFired ??= 0;
  s.barrierWidth ??= 0;
  s.barrierHp ??= 0;
  s.nextId ??= 1000;
  s.waveTime ??= 100;
  s.deploy ??= 0;
  s.intermission ??= 0;
  s.ufoPasses ??= 1;
  for (const e of s.enemies) {
    e.id ??= s.nextId++;
    e.role ??= 'scout';
    e.mode ??= 'formation';
    e.vx ??= 0;
    e.vy ??= 0;
    e.slotX ??= e.x - s.formation.x;
    e.slotY ??= e.y - s.formation.y;
    e.homeY ??= e.y;
    e.flash ??= 0;
  }
  for (const b of s.shields)
    if (!b.blocks) b.blocks = [{ x: b.x, y: b.y, w: b.w, h: b.h, hp: b.hp }];
  for (const p of [...s.shots, ...s.bullets]) {
    p.vx ??= 0;
    p.w ??= 3;
    p.h ??= 8;
    p.damage ??= 1;
    p.hp ??= 1;
    p.life ??= 3;
  }
}
function steer(e, tx, ty, vx, vy, dt, maxSpeed = 125) {
  const safeY = LINE - body(e).h / 2 - 12;
  ty = Math.min(ty, safeY);
  const dx = tx - e.x,
    dy = ty - e.y,
    d = Math.hypot(dx, dy),
    targetX = vx + dx * 2,
    targetY = vy + dy * 2,
    length = Math.hypot(targetX, targetY);
  const desiredX = length > maxSpeed ? (targetX / length) * maxSpeed : targetX;
  // Reserve enough stopping distance for the vertical thrusters before the bunker line.
  const safeDown = Math.max(0, Math.sqrt(220 * Math.max(0, safeY - e.y)) - 110 * dt);
  const desiredY = Math.min(length > maxSpeed ? (targetY / length) * maxSpeed : targetY, safeDown);
  const oldX = e.vx,
    oldY = e.vy,
    change = clamp(desiredY - e.vy, -110 * dt, 110 * dt);
  e.vy += change;
  const horizontal = Math.sqrt(Math.max(0, (110 * dt) ** 2 - change ** 2));
  e.vx += clamp(desiredX - e.vx, -horizontal, horizontal);
  e.x += ((oldX + e.vx) * dt) / 2;
  e.y += ((oldY + e.vy) * dt) / 2;
  return d;
}
function moveFormation(s, dt) {
  const f = s.formation,
    group = s.enemies.filter((e) => e.mode === 'formation');
  let dx = 0,
    dy = 0;
  const activeWing = s.enemies.some((e) => e.mode !== 'formation');
  if (f.phase === 'hold' && !activeWing) f.phase = 'brake';
  const oldVx = f.vx,
    oldVy = f.vy;
  if (f.phase === 'drop') {
    f.dropStart ??= f.targetY - 18;
    f.dropTime = Math.min(1.5, (f.dropTime || 0) + dt);
    const t = f.dropTime / 1.5,
      next = f.dropStart + 18 * (3 * t * t - 2 * t * t * t);
    dy = next - f.y;
    f.vy = (18 * (6 * t - 6 * t * t)) / 1.5;
    f.vx = approach(f.vx, 0, 35 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    if (f.dropTime >= 1.5) {
      f.phase = 'sweep';
      f.direction *= -1;
      f.vy = 0;
    }
  } else if (!group.length) {
    f.vx = approach(f.vx, 0, 35 * dt);
    f.vy = approach(f.vy, 0, 70 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    dy = ((oldVy + f.vy) * dt) / 2;
  } else {
    // Reserve returning wings' slots so the fleet never strands a diver offscreen.
    const slots = s.enemies.map((e) => ({
      x: e.mode === 'formation' ? e.x : f.x + e.slotX,
      w: body(e).w,
    }));
    const left = Math.min(...slots.map((e) => e.x - e.w / 2)) - 8,
      right = 472 - Math.max(...slots.map((e) => e.x + e.w / 2));
    const speed =
      18 + s.wave * 2 + Math.max(0, [24, 16, 12, 9][s.wave - 1] - s.enemies.length) * 0.65;
    if (f.phase === 'sweep' && (f.direction > 0 ? right : left) <= (f.vx * f.vx) / 70 + 0.1)
      f.phase = 'brake';
    f.vx = approach(f.vx, f.phase === 'sweep' ? f.direction * speed : 0, 35 * dt);
    f.vy = approach(f.vy, 0, 70 * dt);
    dx = ((oldVx + f.vx) * dt) / 2;
    const allowed = clamp(dx, -Math.max(0, left), Math.max(0, right));
    if (allowed !== dx) {
      dx = allowed;
      f.vx = 0;
      f.phase = 'brake';
    }
    if (f.phase === 'brake' && Math.abs(f.vx) < 0.001) {
      if (activeWing) f.phase = 'hold';
      else {
        f.phase = 'drop';
        f.targetY = f.y + 18;
        f.dropStart = f.y;
        f.dropTime = 0;
      }
    }
  }
  f.x += dx;
  f.y += dy;
  s.direction = f.direction;
  for (const e of group) {
    e.x += dx;
    e.y += dy;
    e.vx = dt ? dx / dt : f.vx;
    e.vy = dt ? dy / dt : f.vy;
    e.homeY = f.y + e.slotY;
  }
  for (const e of s.enemies.filter((e) => e.mode !== 'formation')) {
    const targetX = f.x + e.slotX,
      targetY = Math.min(f.y + e.slotY, LINE - body(e).h / 2 - 12);
    const peers = s.enemies.filter((p) => p !== e && p.mode === 'formation');
    const laneY = Math.min(LINE - body(e).h / 2 - 12, Math.max(190, ...peers.map((p) => p.y + 32)));
    if (e.mode === 'windup') {
      e.x += dx;
      e.y += dy;
      e.vx = dt ? dx / dt : f.vx;
      e.vy = dt ? dy / dt : f.vy;
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        e.mode = 'dive';
        e.attackTimer = 2;
      }
    } else if (e.mode === 'dive') {
      e.attackTimer -= dt;
      const clear = e.y >= laneY - 4;
      steer(e, clear ? e.targetX : e.x, laneY, clear ? 0 : f.vx, 0, dt);
      if (e.attackTimer <= 0 || (clear && Math.hypot(e.x - e.targetX, e.y - laneY) < 9))
        e.mode = 'align';
    } else if (e.mode === 'align') {
      steer(e, targetX, laneY, f.vx, f.vy, dt);
      if (Math.abs(e.x - targetX) < 5 && Math.abs(e.y - laneY) < 8) e.mode = 'return';
    } else {
      const d = steer(e, targetX, targetY, f.vx, f.vy, dt);
      if (d < 1 && Math.hypot(e.vx - f.vx, e.vy - f.vy) < 110 * dt) {
        e.mode = 'formation';
        e.slotX = e.x - f.x;
        e.slotY = e.y - f.y;
      }
    }
  }
}
function round(s, x, y, vx, vy, owner, hostile = false, heavy = false) {
  const p = {
    id: s.nextId++,
    x,
    y,
    vx,
    vy,
    w: heavy ? 6 : 3,
    h: heavy ? 10 : 8,
    damage: heavy ? 2 : 1,
    hp: heavy ? 2 : 1,
    owner,
    life: 3,
  };
  (hostile ? s.bullets : s.shots).push(p);
  if (hostile) s.enemyShotsFired++;
  else s.shotsFired++;
}
function warn(
  s,
  e,
  { vx = 0, vy = 150, delay = 0.65, aim = false, offset = 0, heavy = false } = {},
) {
  s.warnings.push({
    id: s.nextId++,
    owner: e.id,
    offset,
    vx,
    vy,
    delay,
    aim,
    targetX: s.ship.x,
    targetY: s.ship.y,
    heavy,
    x: e.x + offset,
    y: e.y + body(e).h / 2 + 5,
  });
}
function enemyFire(s, dt, random) {
  if (s.deploy > 0 || s.intermission > 0 || !s.enemies.length) return;
  s.enemyCooldown -= dt;
  s.diveTimer -= dt;
  if (s.diveTimer <= 0) {
    const diver = s.enemies.find((e) => e.role === 'diver' && e.mode === 'formation');
    if (
      diver &&
      s.formation.phase === 'sweep' &&
      diver.y + 32 <= LINE - body(diver).h / 2 - 12 &&
      !s.enemies.some((e) => e.mode !== 'formation')
    ) {
      diver.mode = 'windup';
      diver.attackTimer = 0.75;
      diver.targetX = clamp(s.ship.x, 40, 440);
    }
    s.diveTimer = 5;
  }
  if (s.enemyCooldown <= 0) {
    const boss = s.enemies.find((e) => e.role === 'commander');
    if (boss) {
      if (boss.hp > 16) {
        for (const vx of [-50, 0, 50]) warn(s, boss, { vx, vy: 145, delay: 0.75, offset: vx / 3 });
      } else if (boss.hp > 8) {
        warn(s, boss, { vy: 165, aim: true, heavy: true, delay: 0.8 });
        for (const side of [-1, 1])
          warn(s, boss, { vx: side * 65, vy: 155, offset: side * 24, delay: 1 });
      } else {
        for (const vx of [-70, -35, 0, 35, 70])
          warn(s, boss, { vx, vy: 175, delay: 0.7, offset: vx / 3 });
      }
      s.enemyCooldown = boss.hp <= 8 ? 1.65 : 1.8;
    } else {
      const eligible = s.enemies
        .filter(
          (e) =>
            e.mode === 'formation' &&
            !s.enemies.some((o) => o !== e && o.y > e.y && Math.abs(o.x - e.x) < body(o).w / 2 + 2),
        )
        .sort((a, b) => a.id - b.id);
      if (eligible.length) {
        const e = eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))];
        warn(s, e, {
          vy: 125 + s.wave * 15,
          aim: e.role === 'artillery',
          heavy: e.role === 'artillery',
          delay: e.role === 'artillery' ? 0.8 : 0.65,
        });
      }
      s.enemyCooldown = 1.05 - s.wave * 0.1 + random() * 0.2;
    }
  }
}
function fireWarnings(s, dt) {
  for (const w of s.warnings) {
    const e = s.enemies.find((e) => e.id === w.owner && e.hp > 0);
    if (!e) {
      w.dead = true;
      continue;
    }
    w.x = e.x + w.offset;
    w.y = e.y + body(e).h / 2 + 5;
    w.delay -= dt;
    if (w.delay > 0) continue;
    let vx = w.vx + e.vx,
      vy = w.vy + e.vy;
    if (w.aim) {
      const dx = w.targetX - w.x,
        dy = w.targetY - w.y,
        speed = w.vy,
        a = e.vx * e.vx + e.vy * e.vy - speed * speed,
        b = -2 * (dx * e.vx + dy * e.vy),
        c = dx * dx + dy * dy,
        disc = b * b - 4 * a * c;
      const roots =
        disc >= 0
          ? [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)].filter(
              (t) => t > 0,
            )
          : [];
      const t = roots.length ? Math.min(...roots) : Math.hypot(dx, dy) / speed;
      if (t > 0) {
        vx = dx / t;
        vy = dy / t;
      }
    }
    round(s, w.x, w.y, vx, vy, e.id, true, w.heavy);
    w.dead = true;
  }
  s.warnings = s.warnings.filter((w) => !w.dead);
}
function plate(s) {
  const w = s.barrierWidth,
    cx = clamp(s.ship.x, 8 + w / 2, 472 - w / 2);
  return { x: cx - w / 2, y: 266, w, h: 4, vx: s.ship.motionVx || 0, vy: 0 };
}
function hitTime(p, r, dt) {
  const vx = p.vx - (r.vx || 0),
    vy = p.vy - (r.vy || 0),
    left = r.x - p.w / 2,
    right = r.x + r.w + p.w / 2,
    top = r.y - p.h / 2,
    bottom = r.y + r.h + p.h / 2;
  let enter = 0,
    leave = Infinity;
  for (const [position, velocity, min, max] of [
    [p.x, vx, left, right],
    [p.y, vy, top, bottom],
  ]) {
    if (Math.abs(velocity) < 1e-12) {
      if (position < min || position > max) return Infinity;
      continue;
    }
    const a = (min - position) / velocity,
      b = (max - position) / velocity;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave + 1e-10) return Infinity;
  }
  return leave > enter + 1e-10 && enter >= -1e-10 && enter <= dt + 1e-10
    ? Math.max(0, enter)
    : Infinity;
}
function spriteContactTime(p, rect, mask, dt) {
  if (!Number.isFinite(hitTime(p, rect, dt))) return Infinity;
  let first = Infinity;
  for (const part of mask)
    first = Math.min(
      first,
      hitTime(
        p,
        { x: rect.x + part.x, y: rect.y + part.y, w: part.w, h: part.h, vx: rect.vx, vy: rect.vy },
        dt,
      ),
    );
  return first;
}
function sparks(s, x, y, color = '#ffda98') {
  s.particles.push({ x, y, life: 0.35, color });
}
function projectilePhase(s, dt) {
  let clock = 0,
    remaining = dt;
  const projectiles = [...s.shots, ...s.bullets];
  const advance = (time) => {
    for (const p of projectiles)
      if (!p.dead) {
        p.x += p.vx * time;
        p.y += p.vy * time;
        p.life -= time;
      }
  };
  const targetRect = (e) => {
    const size = body(e);
    return {
      x: e.startX + e.motionVx * clock - size.w / 2,
      y: e.startY + e.motionVy * clock - size.h / 2,
      w: size.w,
      h: size.h,
      vx: e.motionVx,
      vy: e.motionVy,
    };
  };
  for (let iteration = 0; iteration < projectiles.length * 2 + s.enemies.length + 2; iteration++) {
    let earliest = Infinity,
      events = [];
    const add = (time, event) => {
      if (time < earliest - 1e-8) {
        earliest = time;
        events = [event];
      } else if (Math.abs(time - earliest) < 1e-8) events.push(event);
    };
    for (const p of projectiles)
      if (!p.dead && p.life > 0) {
        const hostile = s.bullets.includes(p),
          travel = Math.min(remaining, p.life);
        for (const b of s.shields)
          for (const block of b.blocks)
            if (block.hp > 0)
              add(hitTime(p, block, travel), { kind: 'cover', p, target: block, bunker: b });
        if (s.barrierWidth > 0 && s.barrierHp > 0) {
          const guard = plate(s);
          guard.x -= s.ship.motionVx * (dt - clock);
          add(hitTime(p, guard, travel), { kind: 'guard', p });
        }
        if (hostile) {
          const hull = {
            x: s.ship.startX + s.ship.motionVx * clock - HULL.w / 2,
            y: s.ship.y - HULL.h / 2,
            w: HULL.w,
            h: HULL.h,
            vx: s.ship.motionVx,
            vy: 0,
          };
          add(spriteContactTime(p, hull, MASKS.player, travel), { kind: 'ship', p });
        }
        for (const e of s.enemies)
          if (e.hp > 0 && e.id !== p.owner)
            add(spriteContactTime(p, targetRect(e), MASKS[e.role] || MASKS.scout, travel), {
              kind: 'enemy',
              p,
              target: e,
              hostile,
            });
        if (!hostile && s.ufo && s.ufo.hp > 0)
          add(
            spriteContactTime(
              p,
              {
                x: s.ufo.startX + s.ufo.vx * clock - 20,
                y: s.ufo.y - 6,
                w: 42,
                h: 12,
                vx: s.ufo.vx,
                vy: 0,
              },
              MASKS.bonus,
              travel,
            ),
            { kind: 'bonus', p, target: s.ufo },
          );
      }
    for (const shot of s.shots)
      if (!shot.dead && shot.life > 0)
        for (const bullet of s.bullets)
          if (!bullet.dead && bullet.life > 0)
            add(
              hitTime(
                shot,
                {
                  x: bullet.x - bullet.w / 2,
                  y: bullet.y - bullet.h / 2,
                  w: bullet.w,
                  h: bullet.h,
                  vx: bullet.vx,
                  vy: bullet.vy,
                },
                Math.min(remaining, shot.life, bullet.life),
              ),
              { kind: 'intercept', p: shot, target: bullet },
            );
    for (const e of s.enemies)
      if (e.hp > 0) {
        const rect = targetRect(e);
        if (rect.y + rect.h >= LINE - 1e-9) add(0, { kind: 'breach', target: e });
        else if (e.motionVy > 0)
          add((LINE - rect.y - rect.h) / e.motionVy, { kind: 'breach', target: e });
      }
    events = events.filter((e) => e.kind !== 'breach' || earliest <= remaining + 1e-9);
    if (!Number.isFinite(earliest) || earliest > remaining + 1e-9 || !events.length) {
      advance(remaining);
      clock += remaining;
      remaining = 0;
      break;
    }
    advance(earliest);
    clock += earliest;
    remaining = Math.max(0, remaining - earliest);
    const enemyDamage = new Map(),
      coverDamage = new Map(),
      interceptDamage = new Map(),
      bonusDamage = new Map();
    let shipHit = false,
      guardDamage = 0,
      breach = false;
    const used = new Set();
    // A projectile has one contact at a simultaneous timestamp; solids take precedence.
    const rank = { cover: 0, guard: 1, ship: 2, enemy: 3, bonus: 4 };
    const solidEvents = new Map();
    const canonical = (e) =>
      `${String(e.target?.id ?? 0).padStart(8, '0')}:${e.target?.x ?? 0}:${e.target?.y ?? 0}`;
    for (const e of events)
      if (e.p && e.kind !== 'intercept') {
        const prior = solidEvents.get(e.p);
        if (
          !prior ||
          rank[e.kind] < rank[prior.kind] ||
          (rank[e.kind] === rank[prior.kind] && canonical(e) < canonical(prior))
        )
          solidEvents.set(e.p, e);
      }
    const chosenInterceptions = new Map();
    for (const e of events
      .filter((e) => e.kind === 'intercept')
      .sort((a, b) => (a.target.id ?? 0) - (b.target.id ?? 0)))
      if (!solidEvents.has(e.p) && !solidEvents.has(e.target) && !chosenInterceptions.has(e.p))
        chosenInterceptions.set(e.p, e);
    events = [
      ...events.filter((e) => e.kind === 'breach'),
      ...solidEvents.values(),
      ...chosenInterceptions.values(),
    ];
    for (const event of events) {
      const p = event.p;
      if (event.kind === 'breach') {
        breach = true;
        continue;
      }
      if (p.dead) continue;
      if (event.kind === 'intercept') {
        interceptDamage.set(event.target, (interceptDamage.get(event.target) || 0) + 1);
        used.add(p);
        sparks(s, p.x, p.y, '#a9f4df');
      } else if (event.kind === 'cover') {
        coverDamage.set(event.target, (coverDamage.get(event.target) || 0) + p.damage);
        used.add(p);
        sparks(s, p.x, p.y);
      } else if (event.kind === 'guard') {
        guardDamage += p.damage;
        used.add(p);
        if (s.bullets.includes(p)) {
          s.intercepts++;
          s.score += 10;
        }
        sparks(s, p.x, p.y, '#a9f4df');
      } else if (event.kind === 'ship') {
        shipHit = true;
        used.add(p);
        sparks(s, p.x, p.y);
      } else if (event.kind === 'enemy') {
        const damage = enemyDamage.get(event.target) || { n: 0, player: false };
        damage.n += p.damage;
        damage.player ||= !event.hostile;
        enemyDamage.set(event.target, damage);
        used.add(p);
        sparks(s, p.x, p.y);
      } else {
        bonusDamage.set(event.target, (bonusDamage.get(event.target) || 0) + p.damage);
        used.add(p);
        sparks(s, p.x, p.y);
      }
    }
    for (const [p, damage] of interceptDamage) {
      p.hp -= damage;
      if (p.hp <= 0) {
        used.add(p);
        s.intercepts++;
        s.score += 15;
      }
    }
    for (const [bonus, damage] of bonusDamage) {
      bonus.hp -= damage;
      if (bonus.hp <= 0) {
        s.score += 250;
        s.ufo = null;
      }
    }
    for (const p of used) p.dead = true;
    for (const [block, damage] of coverDamage) block.hp = Math.max(0, block.hp - damage);
    for (const [e, damage] of enemyDamage) {
      e.hp -= damage.n;
      e.flash = 0.2;
      if (e.hp <= 0 && damage.player)
        s.score +=
          e.role === 'commander'
            ? 1500
            : e.role === 'artillery'
              ? 175
              : e.role === 'diver'
                ? 150
                : 100;
    }
    s.barrierHp = Math.max(0, s.barrierHp - guardDamage);
    if (s.barrierHp === 0 && s.barrier > 0) {
      s.barrier = 0;
      s.barrierWidth = 0;
    }
    if (shipHit && s.invulnerable <= 0) {
      s.lives--;
      s.invulnerable = 1.1;
      s.hitFlash = 0.35;
    }
    if (s.lives <= 0 || breach) {
      s.phase = 'lost';
      s.reason = breach ? 'breach' : 'hull';
      break;
    }
    if (remaining <= 1e-12) break;
  }
  if (remaining > 0 && s.phase === 'playing') advance(remaining);
  s.shots = s.shots.filter(
    (p) => !p.dead && p.life > 0 && p.y > -10 && p.y < 330 && p.x > -10 && p.x < 490,
  );
  s.bullets = s.bullets.filter(
    (p) => !p.dead && p.life > 0 && p.y > -10 && p.y < 330 && p.x > -10 && p.x < 490,
  );
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  for (const b of s.shields) b.hp = b.blocks.reduce((hp, c) => hp + c.hp, 0);
  s.warnings = s.warnings.filter((w) => s.enemies.some((e) => e.id === w.owner));
}
function nextEncounter(s) {
  s.wave++;
  s.enemies = makeFleet(s.wave);
  s.formation = formation();
  s.direction = 1;
  s.enemyCooldown = 1.2;
  s.diveTimer = 4;
  s.deploy = 1.2;
  s.banner = 2.6;
  s.waveTime = 100;
  s.cleared = false;
  s.ufo = null;
  s.ufoTimer = 12;
  s.ufoPasses = 1;
  s.warnings = [];
  s.lives = Math.min(3, s.lives + 1);
  s.invulnerable = 1.2;
  s.score += 500;
  for (const bunker of s.shields) {
    let repaired = 0;
    for (const block of bunker.blocks) if (block.hp === 0 && repaired++ < 3) block.hp = 1;
    bunker.hp = bunker.blocks.reduce((n, b) => n + b.hp, 0);
  }
}
export function stepInvaders(s, dt, input, random) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  prepare(s);
  const count = Math.max(1, Math.ceil(Math.min(dt, 1 / 30) * 240)),
    sub = Math.min(dt, 1 / 30) / count;
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    tick(
      s,
      sub,
      i === 0
        ? input
        : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      random,
    );
}
function tick(s, dt, input, random) {
  s.time += dt;
  for (const key of [
    'barrier',
    'barrierCooldown',
    'banner',
    'deploy',
    'invulnerable',
    'fireCooldown',
    'hitFlash',
  ])
    s[key] = Math.max(0, (s[key] || 0) - dt);
  s.heat = Math.max(0, s.heat - 0.26 * dt);
  if (s.overheated && s.heat <= 0.25) s.overheated = false;
  if (input.pressed('ShiftLeft', 'ShiftRight') && s.barrierCooldown <= 0 && s.intermission <= 0) {
    s.barrier = 0.9;
    s.barrierCooldown = 5;
    s.barrierHp = 3;
  }
  s.barrierWidth = approach(s.barrierWidth, s.barrier > 0 ? 48 : 0, 480 * dt);
  const axis = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  let desired = axis * SPEED;
  if (input.pointer.down && input.pointer.x >= 0)
    desired = clamp((input.pointer.x - s.ship.x) * 8, -SPEED, SPEED);
  const oldX = s.ship.x,
    oldV = s.ship.vx,
    newV = approach(oldV, desired, ACCEL * dt);
  s.ship.startX = oldX;
  s.ship.x = clamp(oldX + ((oldV + newV) * dt) / 2, 22, 458);
  s.ship.vx = s.ship.x === 22 || s.ship.x === 458 ? 0 : newV;
  s.ship.motionVx = dt ? (s.ship.x - oldX) / dt : 0;
  if (s.intermission > 0) {
    s.intermission = Math.max(0, s.intermission - dt);
    if (s.intermission === 0) nextEncounter(s);
  } else if (s.enemies.length) {
    s.waveTime -= dt;
    if (s.waveTime <= 0) {
      s.phase = 'lost';
      s.reason = 'time';
      return;
    }
  }
  for (const e of s.enemies) {
    e.startX = e.x;
    e.startY = e.y;
    e.flash = Math.max(0, e.flash - dt);
  }
  moveFormation(s, dt);
  for (const e of s.enemies) {
    e.motionVx = dt ? (e.x - e.startX) / dt : e.vx;
    e.motionVy = dt ? (e.y - e.startY) / dt : e.vy;
  }
  if (
    (input.held('Space', 'KeyZ') || input.pointer.down) &&
    s.fireCooldown <= 0 &&
    s.barrierWidth <= 0 &&
    !s.overheated &&
    s.intermission <= 0
  ) {
    round(s, s.ship.startX, 270, oldV, -390, 0);
    s.heat = Math.min(1, s.heat + 0.11);
    s.fireCooldown = 0.22;
    if (s.heat >= 1) s.overheated = true;
  }
  enemyFire(s, dt, random);
  fireWarnings(s, dt);
  s.ufoTimer -= dt;
  if (s.ufoTimer <= 0 && s.ufoPasses > 0 && !s.ufo && s.enemies.length && s.intermission <= 0) {
    s.ufo = { x: -24, startX: -24, y: 43, vx: 55, hp: 1 };
    s.ufoPasses--;
  }
  if (s.ufo) {
    s.ufo.startX = s.ufo.x;
    s.ufo.x += s.ufo.vx * dt;
    if (s.ufo.x > 510) s.ufo = null;
  }
  projectilePhase(s, dt);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-60);
  if (s.phase === 'playing' && !s.enemies.length && !s.bullets.length && !s.cleared) {
    s.cleared = true;
    if (s.wave === 4) s.phase = 'won';
    else {
      s.intermission = 1.3;
      s.banner = 0;
    }
  }
}
const SPRITES = {
  scout: [
    '..a....a..',
    '...a..a...',
    '..aaaaaa..',
    '.aa.bb.aa.',
    'aaaaaaaaaa',
    'a.aaaaaa.a',
    'a.a....a.a',
    '..aa..aa..',
  ],
  diver: [
    'a..........a',
    '.aa......aa.',
    '..aaaaaaaa..',
    '...a.bb.a...',
    'aaaaaaaaaaaa',
    '..a.aaaa.a..',
    '....aaaa....',
    '.....aa.....',
  ],
  artillery: [
    '..aaaaaaaaa..',
    '.aaaaaaaaaaa.',
    'aaa.bbbbb.aaa',
    'aaaaaaaaaaaaa',
    '..aa.c.c.aa..',
    'aaaaaaaaaaaaa',
    'aaa.aaaaa.aaa',
    'aaa..aaa..aaa',
    '.aa..aaa..aa.',
    '.....aaa.....',
  ],
};
const SHIP = [
  '......aa......',
  '......aa......',
  '.....aaaa.....',
  '.....abba.....',
  '....aabbaa....',
  '..aaaaaaaaaa..',
  '.aaaaaaaaaaaa.',
  'aaaaaaaaaaaaaa',
  'aa..aa..aa..aa',
  'aa..aa..aa..aa',
];
const BONUS = ['...aaaaaaaa...', '.aaaaaaaaaaaa.', 'aaaaaaaaaaaaaa', '..aa.a..a.aa..'];
function maskFromSprite(rows, scale) {
  const rectangles = [];
  rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      if (x < row.length && row[x] !== '.') {
        if (start < 0) start = x;
      } else if (start >= 0) {
        const px = start * scale,
          w = (x - start) * scale;
        const prior = rectangles.find((r) => r.x === px && r.w === w && r.y + r.h === y * scale);
        if (prior) prior.h += scale;
        else rectangles.push({ x: px, y: y * scale, w, h: scale });
        start = -1;
      }
    }
  });
  return rectangles;
}
const MASKS = {
  ...Object.fromEntries(
    Object.entries(SPRITES).map(([role, rows]) => [role, maskFromSprite(rows, 2)]),
  ),
  player: maskFromSprite(SHIP, 2),
  bonus: maskFromSprite(BONUS, 3),
  commander: [
    { x: 0, y: 5, w: 68, h: 20 },
    { x: 8, y: 0, w: 52, h: 30 },
    { x: 3, y: 24, w: 8, h: 6 },
    { x: 57, y: 24, w: 8, h: 6 },
  ],
};
export function createGame(env) {
  const s = createInvaderState();
  let ended = false,
    lastScore = 0,
    lastLives = 3,
    lastShots = 0,
    lastIntercepts = 0;
  return {
    update(dt, input) {
      stepInvaders(s, dt, input, env.random);
      if (s.shotsFired > lastShots) env.sound('shoot');
      if (s.intercepts > lastIntercepts) env.sound('coin');
      else if (s.score > lastScore) env.sound('hit');
      if (s.lives < lastLives) env.sound('hit');
      lastShots = s.shotsFired;
      lastScore = s.score;
      lastLives = s.lives;
      lastIntercepts = s.intercepts;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t(
                  'Four encounters cleared. The colony stands!',
                  '四场战斗全部通关，殖民地守住了！',
                )
              : s.reason === 'time'
                ? env.t(
                    'The siege breached the perimeter. Intercept and advance sooner.',
                    '围攻突破防线，请更快拦截并击退敌人。',
                  )
                : s.reason === 'breach'
                  ? env.t('The formation crossed the defense line.', '敌方编队越过了防线。')
                  : env.t(
                      'Turret lost. Cover and guard timing can save the next crew.',
                      '炮台损毁。利用掩体和护板时机保护下一组乘员。',
                    ),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#0a1728');
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = i % 7 ? '#263b51' : '#81939d';
        ctx.fillRect((i * 79) % 480, (i * 47) % 310, i % 7 ? 1 : 2, 1);
      }
      ctx.fillStyle = '#152b3e';
      for (let y = -38; y < 38; y += 3)
        for (let x = -38; x < 38; x += 3)
          if (x * x + y * y < 36 * 36) ctx.fillRect(405 + x, 94 + y, 3, 3);
      ctx.fillStyle = '#1c3548';
      ctx.fillRect(383, 76, 30, 4);
      ctx.fillRect(400, 102, 29, 5);
      ctx.fillRect(379, 114, 23, 3);
      ctx.fillStyle = '#203744';
      for (const [x, h] of [
        [12, 16],
        [43, 11],
        [107, 20],
        [320, 12],
        [347, 19],
        [440, 15],
      ]) {
        ctx.fillRect(x, 307 - h, 20, h);
        ctx.fillRect(x + 7, 302 - h, 6, 5);
      }
      ctx.fillStyle = '#182c3b';
      for (let x = 0; x < 480; x += 30) {
        const h = 8 + ((x * 7) % 13);
        ctx.fillRect(x, 308 - h, 30, h + 12);
      }
      ctx.fillStyle = '#324b58';
      ctx.fillRect(8, 297, 464, 5);
      ctx.fillStyle = '#b39b6e';
      ctx.fillRect(8, 294, 4, 9);
      ctx.fillRect(468, 294, 4, 9);
      ctx.fillStyle = '#172b3a';
      for (let x = 12; x < 472; x += 12) ctx.fillRect(x, 299, 5, 2);
      ctx.strokeStyle = '#a2775e';
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      ctx.moveTo(9, LINE);
      ctx.lineTo(471, LINE);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const bunker of s.shields)
        for (const b of bunker.blocks)
          if (b.hp > 0) {
            ctx.fillStyle = '#5b998d';
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.fillStyle = '#a3cdb5';
            ctx.fillRect(b.x, b.y, b.w, 1);
            ctx.fillStyle = '#37665f';
            ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
          }
      for (const e of s.enemies) {
        const size = body(e),
          x = Math.round(e.x - size.w / 2),
          y = Math.round(e.y - size.h / 2);
        if (e.role === 'commander') {
          ctx.fillStyle = e.flash > 0 ? '#fff2c6' : '#935e8f';
          ctx.fillRect(x, y + 5, 68, 20);
          ctx.fillRect(x + 8, y, 52, 30);
          ctx.fillStyle = '#c38ba9';
          ctx.fillRect(x + 6, y + 5, 56, 5);
          ctx.fillStyle = '#26304e';
          ctx.fillRect(x + 18, y + 13, 32, 7);
          ctx.fillStyle = '#eac588';
          ctx.fillRect(x + 26, y + 13, 16, 4);
          ctx.fillRect(x + 3, y + 24, 8, 6);
          ctx.fillRect(x + 57, y + 24, 8, 6);
          ctx.fillStyle = '#384355';
          ctx.fillRect(x, y - 8, 68, 4);
          ctx.fillStyle = e.hp > 16 ? '#b8d5aa' : e.hp > 8 ? '#edbe86' : '#eb8d7b';
          ctx.fillRect(x, y - 8, (68 * Math.max(0, e.hp)) / 24, 4);
          ctx.fillStyle = '#f2e8c5';
          ctx.fillRect(x + 22, y - 9, 1, 6);
          ctx.fillRect(x + 45, y - 9, 1, 6);
        } else {
          const color =
            e.flash > 0
              ? '#fff2c6'
              : e.role === 'diver'
                ? '#85bfd8'
                : e.role === 'artillery'
                  ? '#caa689'
                  : ['#f2ad7c', '#9bd5a5', '#86b7d3'][e.type % 3];
          pixelSprite(ctx, SPRITES[e.role] || SPRITES.scout, x, y, 2, {
            a: color,
            b: '#172c40',
            c: '#fff0b4',
          });
          if (e.hp > 1) {
            ctx.fillStyle = '#f9e7b9';
            ctx.fillRect(e.x - 5, e.y - 2, 3, 3);
            ctx.fillRect(e.x + 2, e.y - 2, 3, 3);
          }
          if (e.mode !== 'formation') {
            ctx.fillStyle = '#f2c77e';
            ctx.fillRect(e.x - 3, e.y - size.h / 2 - 4, 6, 4);
          } else if (Math.floor(s.time * 5) % 2) {
            ctx.fillStyle = '#213748';
            ctx.fillRect(x + 3, y + size.h - 2, 3, 2);
          }
        }
        if (e.mode === 'windup') {
          ctx.strokeStyle = '#edc98d';
          ctx.strokeRect(e.x - size.w / 2 - 3, e.y - size.h / 2 - 3, size.w + 6, size.h + 6);
          ctx.fillStyle = '#edc98d';
          ctx.fillRect(e.targetX - 8, 208, 16, 2);
          ctx.fillRect(e.targetX - 1, 204, 2, 10);
        }
      }
      for (const w of s.warnings) {
        const emitter = s.enemies.find((e) => e.id === w.owner);
        if (!emitter) continue;
        ctx.strokeStyle = '#efd495';
        ctx.strokeRect(w.x - 5, w.y - 5, 10, 10);
        ctx.fillStyle = '#efd495';
        ctx.fillRect(w.x - 1, w.y + 7, 2, 5);
        if (w.aim) {
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.moveTo(w.x, w.y + 8);
          ctx.lineTo(w.targetX, s.ship.y - 15);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeRect(w.targetX - 5, s.ship.y - 21, 10, 7);
        }
      }
      for (const p of s.shots) {
        ctx.fillStyle = '#b5f2df';
        ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      }
      for (const p of s.bullets) {
        ctx.fillStyle = p.hp > 1 ? '#ffd69a' : '#f39a76';
        if (p.hp > 1) {
          ctx.fillRect(p.x - 3, p.y - 5, 6, 10);
          ctx.fillStyle = '#703e45';
          ctx.fillRect(p.x - 1, p.y - 2, 2, 4);
        } else {
          ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
          ctx.fillRect(p.x - 3, p.y - 1, 6, 2);
        }
      }
      pixelSprite(ctx, SHIP, Math.round(s.ship.x - 14), s.ship.y - 10, 2, {
        a: s.hitFlash > 0 ? '#fff3c4' : '#a4ded4',
        b: s.overheated ? '#e6976f' : '#335d70',
      });
      ctx.fillStyle = '#526f78';
      ctx.fillRect(s.ship.x - 13, 294, 7, 3);
      ctx.fillRect(s.ship.x + 6, 294, 7, 3);
      if (s.invulnerable > 0 || s.hitFlash > 0) {
        ctx.strokeStyle = s.hitFlash > 0 ? '#ffd59c' : '#74a99d';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.ship.x - 15, s.ship.y - 11, 30, 22);
      }
      if (s.barrierWidth > 0) {
        const g = plate(s);
        ctx.fillStyle = s.barrierHp > 0 ? '#a3d4c6' : '#526567';
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.fillStyle = '#476d70';
        for (let x = g.x + 2; x < g.x + g.w; x += 6) ctx.fillRect(x, g.y, 2, g.h);
        ctx.strokeStyle = '#6f9995';
        ctx.beginPath();
        ctx.moveTo(s.ship.x - 8, 274);
        ctx.lineTo(g.x + 4, 270);
        ctx.moveTo(s.ship.x + 8, 274);
        ctx.lineTo(g.x + g.w - 4, 270);
        ctx.stroke();
        for (let i = 0; i < s.barrierHp; i++) {
          ctx.fillStyle = '#f5e3a7';
          ctx.fillRect(g.x + g.w / 2 - 7 + i * 6, g.y - 3, 3, 2);
        }
      }
      if (s.ufo) {
        const x = s.ufo.x - 20,
          y = s.ufo.y - 6;
        pixelSprite(ctx, BONUS, x, y, 3, { a: '#d89a92' });
      }
      for (const p of s.particles) {
        ctx.fillStyle = p.color;
        const spread = (0.35 - p.life) * 28;
        ctx.fillRect(p.x - spread, p.y, 3, 2);
        ctx.fillRect(p.x + spread, p.y, 3, 2);
        ctx.fillRect(p.x, p.y - spread, 2, 3);
      }
      ctx.fillStyle = '#0b1729';
      ctx.fillRect(0, 0, 480, 33);
      drawPixelText(ctx, env.t('WAVE ', '波次 ') + s.wave + '/4', 12, 6, '#a3d7ce', 11);
      drawPixelText(ctx, env.t('HULL ', '船体 ') + s.lives, 238, 6, '#edcc97', 11, 'center');
      drawPixelText(
        ctx,
        Math.ceil(Math.max(0, s.waveTime)) + env.t('s TO BREACH', '秒后突破'),
        468,
        6,
        '#a6b8c5',
        10,
        'right',
      );
      const gun =
        s.barrierWidth > 0
          ? env.t('GUN SAFE', '炮管锁定')
          : s.overheated
            ? env.t('GUN COOLING', '炮管冷却')
            : env.t('HEAT ', '热量 ') + Math.round(s.heat * 100) + '%';
      drawPixelText(ctx, gun, 12, 21, s.overheated ? '#f1af7c' : '#a6c8ce', 10);
      const guard =
        s.barrier > 0
          ? `${s.barrierHp} · ${s.barrier.toFixed(1)}s`
          : s.barrierWidth > 0
            ? env.t('STOWING', '收起中')
            : s.barrierCooldown > 0
              ? env.t('CHARGE ', '充能 ') + s.barrierCooldown.toFixed(1) + 's'
              : env.t('READY', '就绪');
      drawPixelText(ctx, env.t('GUARD ', '护板 ') + guard, 232, 21, '#b4d7b7', 10, 'center');
      const cover = s.shields.reduce((n, b) => n + b.hp, 0);
      drawPixelText(ctx, env.t('COVER ', '掩体 ') + cover, 468, 21, '#9dbdb6', 10, 'right');
      drawPixelText(
        ctx,
        env.t(NAMES[s.wave - 1].en, NAMES[s.wave - 1].zh),
        240,
        307,
        '#afc8be',
        10,
        'center',
      );
      if (s.deploy > 0) {
        drawPixelText(
          ctx,
          env.t(NAMES[s.wave - 1].en, NAMES[s.wave - 1].zh),
          240,
          178,
          '#e9d4ad',
          15,
          'center',
        );
        drawPixelText(
          ctx,
          env.t('GAPS FIRE · COVER STOPS BOTH SIDES', '空隙可射击 · 掩体阻挡双方炮弹'),
          240,
          198,
          '#b3d1bd',
          11,
          'center',
        );
      } else if (s.intermission > 0) {
        drawPixelText(
          ctx,
          env.t('CREW SERVICE • +1 HULL / REPAIR', '乘员整备 · 船体+1 / 修补掩体'),
          240,
          187,
          '#e9d4ad',
          13,
          'center',
        );
      } else if (!s.enemies.length && s.bullets.length) {
        drawPixelText(
          ctx,
          env.t('CLEAR THE STRAY FIRE', '清除残余来弹'),
          240,
          187,
          '#e9d4ad',
          13,
          'center',
        );
      }
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Wave ${s.wave}/4 · ${s.enemies.length} ${s.enemies.length === 1 ? 'enemy' : 'enemies'} · Hull ${s.lives} · ${s.intercepts} interceptions`,
        zh: `波次 ${s.wave}/4 · 剩余 ${s.enemies.length} 个敌人 · 船体 ${s.lives} · 拦截 ${s.intercepts}`,
      },
    }),
  };
}
