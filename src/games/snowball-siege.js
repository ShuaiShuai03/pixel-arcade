import { clamp, rectsOverlap, drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'snowball-siege',
  name: { en: 'Snowball Siege', zh: '雪球攻城' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Free six frostbound chambers. Hold Snow to freeze monsters; get close and press Kick to send them rolling. Frozen monsters are harmless. Chain launched balls, climb with deliberate jumps, and face the Frost Warden.',
    zh: '解放六座冰霜大厅。按住雪球冻住怪物，靠近后按踢球让它滚动。冻结怪物无害；用滚动雪球连击，用定高跳跃攀登，挑战冰霜守卫。',
  },
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'Jump', zh: '跳' } },
    { code: 'Space', side: 'right', label: { en: 'Snow', zh: '雪球' } },
    { code: 'KeyK', side: 'right', label: { en: 'Kick', zh: '踢球' } },
  ],
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: '← → / A D' },
    {
      label: {
        en: 'Jump (fixed arc; release before next jump)',
        zh: '跳跃（固定弧线，松开后再跳）',
      },
      keys: '↑ / W',
    },
    { label: { en: 'Hold to throw snow', zh: '按住投雪球' }, keys: 'Space / J' },
    { label: { en: 'Kick nearby frozen monster', zh: '踢出附近冻结怪物' }, keys: 'K / X' },
  ],
};

const GRAVITY = 600;
const FLOOR = { x: 0, y: 294, w: 480, h: 26 };
const stages = [
  {
    en: 'Lantern Gate',
    zh: '灯笼之门',
    color: '#17324a',
    ledges: [
      [18, 236, 184],
      [278, 236, 184],
      [108, 178, 264],
    ],
    foes: [
      [0, 350, 'walker'],
      [1, 70, 'walker'],
      [2, 370, 'walker'],
    ],
  },
  {
    en: 'Twin Stair',
    zh: '双子阶梯',
    color: '#243454',
    ledges: [
      [16, 236, 174],
      [290, 236, 174],
      [80, 178, 160],
      [274, 178, 170],
      [170, 120, 150],
    ],
    foes: [
      [0, 390, 'walker'],
      [1, 70, 'hopper'],
      [2, 350, 'walker'],
      [5, 220, 'walker'],
    ],
  },
  {
    en: 'Ice Orchard',
    zh: '寒冰果园',
    color: '#193e46',
    ledges: [
      [24, 236, 200],
      [254, 236, 200],
      [112, 178, 256],
      [24, 120, 180],
      [278, 120, 180],
    ],
    foes: [
      [0, 360, 'hopper'],
      [1, 70, 'walker'],
      [2, 360, 'hopper'],
      [3, 200, 'walker'],
      [4, 90, 'walker'],
    ],
  },
  {
    en: 'Crystal Bridge',
    zh: '水晶之桥',
    color: '#342d53',
    ledges: [
      [12, 236, 180],
      [282, 236, 186],
      [110, 178, 260],
      [20, 120, 176],
      [282, 120, 178],
    ],
    foes: [
      [0, 360, 'walker'],
      [1, 55, 'hopper'],
      [2, 340, 'walker'],
      [3, 170, 'hopper'],
      [5, 360, 'walker'],
    ],
  },
  {
    en: 'Moonlit Vault',
    zh: '月光穹顶',
    color: '#233c59',
    ledges: [
      [20, 236, 210],
      [258, 236, 202],
      [118, 178, 252],
      [18, 120, 190],
      [274, 120, 186],
    ],
    foes: [
      [0, 380, 'hopper'],
      [1, 80, 'walker'],
      [2, 330, 'hopper'],
      [3, 190, 'walker'],
      [4, 75, 'hopper'],
      [5, 360, 'walker'],
    ],
  },
  {
    en: 'Frost Warden',
    zh: '冰霜守卫',
    color: '#372f54',
    ledges: [
      [18, 236, 190],
      [270, 236, 190],
      [100, 178, 280],
      [24, 120, 180],
      [276, 120, 180],
    ],
    foes: [
      [0, 360, 'warden'],
      [1, 80, 'hopper'],
      [2, 350, 'walker'],
      [3, 175, 'hopper'],
      [4, 65, 'walker'],
      [5, 350, 'hopper'],
    ],
  },
];

const EPSILON = 1e-7;
const overlapsAt = (x, width, left, span, vx = 0) =>
  (x + width > left + EPSILON && x < left + span - EPSILON) ||
  (Math.abs(x + width - left) < EPSILON && vx > 0) ||
  (Math.abs(x - left - span) < EPSILON && vx < 0);

/** Constant gravity with swept collisions on all four faces of solid ice.
 * Support cancels gravity until the trailing edge leaves. Normal velocity is
 * removed on contact; optional horizontal restitution can only dissipate energy.
 */
export function moveOnPlatforms(body, platforms, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  body.hitX = false;
  body.hitCeiling = false;
  const gravity = GRAVITY;
  let remaining = dt;
  for (let segment = 0; segment < 16 && remaining > EPSILON; segment++) {
    const support =
      body.grounded && body.vy >= 0
        ? platforms.find(
            (p) =>
              Math.abs(body.y + body.h - p.y) < EPSILON &&
              overlapsAt(body.x, body.w, p.x, p.w, body.vx),
          )
        : null;
    const g = support ? 0 : gravity;
    if (support) body.vy = 0;
    let event = null,
      time = remaining + 1;
    function consider(t, kind, surface) {
      if (t < -EPSILON || t > remaining + EPSILON) return;
      if (t < time - EPSILON || (Math.abs(t - time) < EPSILON && kind === 'top')) {
        time = Math.max(0, t);
        event = { kind, surface };
      }
    }
    if (support && body.vx) {
      const edge =
        body.vx > 0
          ? (support.x + support.w - body.x) / body.vx
          : (support.x - body.x - body.w) / body.vx;
      consider(edge, 'edge', support);
    }
    if (body.vx > 0) consider((480 - body.w - body.x) / body.vx, 'wallRight', null);
    else if (body.vx < 0) consider(-body.x / body.vx, 'wallLeft', null);
    for (const platform of platforms) {
      const height = platform.h ?? 13;
      if (body.vx) {
        const t =
          body.vx > 0
            ? (platform.x - body.w - body.x) / body.vx
            : (platform.x + platform.w - body.x) / body.vx;
        const y = body.y + body.vy * t + (g * t * t) / 2;
        if (y + body.h > platform.y + EPSILON && y < platform.y + height - EPSILON)
          consider(t, body.vx > 0 ? 'left' : 'right', platform);
      }
      if (g > 0) {
        for (const [kind, target] of [
          ['top', platform.y - body.h],
          ['bottom', platform.y + height],
        ]) {
          const discriminant = body.vy * body.vy + 2 * g * (target - body.y);
          if (discriminant < 0) continue;
          const t = (-body.vy + (kind === 'top' ? 1 : -1) * Math.sqrt(discriminant)) / g;
          const atVelocity = body.vy + g * t;
          if (kind === 'top' ? atVelocity < -EPSILON : atVelocity >= -EPSILON) continue;
          const x = clamp(body.x + body.vx * Math.max(0, t), 0, 480 - body.w);
          if (overlapsAt(x, body.w, platform.x, platform.w, body.vx)) consider(t, kind, platform);
        }
      }
    }
    const travel = event ? Math.min(time, remaining) : remaining;
    body.x = clamp(body.x + body.vx * travel, 0, 480 - body.w);
    body.y += body.vy * travel + (g * travel * travel) / 2;
    body.vy += g * travel;
    remaining -= travel;
    body.grounded = !!support;
    if (!event) return;
    if (event.kind === 'edge') {
      body.grounded = false;
      continue;
    }
    if (event.kind === 'top') {
      body.y = event.surface.y - body.h;
      body.vy = 0;
      body.grounded = true;
    } else if (event.kind === 'bottom') {
      body.y = event.surface.y + (event.surface.h ?? 13);
      body.vy = 0;
      body.grounded = false;
      body.hitCeiling = true;
    } else {
      body.x =
        event.kind === 'wallRight'
          ? 480 - body.w
          : event.kind === 'wallLeft'
            ? 0
            : event.kind === 'left'
              ? event.surface.x - body.w
              : event.surface.x + event.surface.w;
      const restitution = clamp(body.restitutionX ?? 0, 0, 1);
      body.vx = restitution > 0 ? -body.vx * restitution : 0;
      body.hitX = true;
    }
  }
}

/** Rolling resistance and inelastic impacts never add horizontal kinetic energy. */
export function rollSnowball(ball, platforms, dt) {
  const friction = ball.grounded ? 65 : 8;
  ball.vx = Math.sign(ball.vx) * Math.max(0, Math.abs(ball.vx) - friction * dt);
  ball.restitutionX = 0.72;
  moveOnPlatforms(ball, platforms, dt);
  if (Math.abs(ball.vx) < 25) {
    ball.vx = 0;
    ball.launched = false;
    ball.life = Math.min(ball.life, 0.55);
  }
  ball.spin += (dt * ball.vx) / Math.max(8, ball.w / 2);
  ball.life -= dt;
}

function sweptRect(a, oldX, oldY, b) {
  const dx = a.x - oldX,
    dy = a.y - oldY;
  let near = 0,
    far = 1;
  for (const [start, delta, min, max] of [
    [oldX, dx, b.x - a.w, b.x + b.w],
    [oldY, dy, b.y - a.h, b.y + b.h],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta,
      t2 = (max - start) / delta;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

const HERO = [
  '..hhhh..',
  '.hhhhhh.',
  '.hffffh.',
  '..feef..',
  '.cccccc.',
  'cccccccc',
  '.cccccc.',
  '..c..c..',
  '.bb..bb.',
];
const WALKER = [
  '..aaaaa..',
  '.aaaaaaa.',
  'aaaccaaca',
  'aaaccaaca',
  'aaaaaaaaa',
  '.aaaaaaa.',
  '..aaaaa..',
  '..a...a..',
  '.bb...bb.',
];
const HOPPER = [
  '.a.....a.',
  '.aa...aa.',
  '.aaaaaaa.',
  'aaaccaaca',
  'aaaccaaca',
  'aaaaaaaaa',
  '.aaaaaaa.',
  '..a...a..',
  '.bb...bb.',
];
const WARDEN = [
  '..aaaaaaaa..',
  '.aaaaaaaaaa.',
  'aaaaccaacaaa',
  'aaaaccaacaaa',
  'aaaaaaaaaaaa',
  '.aaaaaaaaaa.',
  '..aaaaaaaa..',
  '..aaa..aaa..',
  '.bbbb..bbbb.',
];
const approach = (current, target, amount) =>
  current < target ? Math.min(target, current + amount) : Math.max(target, current - amount);

function drawChamber(ctx, stage, level, time) {
  background(ctx, stage.color);
  for (let y = 34; y < 294; y += 22) {
    ctx.fillStyle = '#0713232b';
    ctx.fillRect(0, y, 480, 1);
    for (let x = (Math.floor(y / 22) % 2) * 28; x < 480; x += 56) ctx.fillRect(x, y, 1, 22);
  }
  for (const x of [14, 132, 334, 452]) {
    ctx.fillStyle = '#0a182b65';
    ctx.fillRect(x, 32, 14, 262);
    ctx.fillStyle = '#50748a35';
    ctx.fillRect(x + 2, 34, 3, 257);
    ctx.fillRect(x - 3, 37, 20, 5);
    ctx.fillRect(x - 3, 283, 20, 9);
  }
  for (const x of [57, 223, 389]) {
    ctx.fillStyle = '#091b2ddd';
    ctx.fillRect(x, 65, 34, 57);
    ctx.fillRect(x + 5, 59, 24, 67);
    ctx.fillRect(x + 11, 55, 12, 75);
    ctx.fillStyle = level === 5 ? '#718b9c55' : '#5490a342';
    ctx.fillRect(x + 4, 68, 26, 51);
    ctx.fillStyle = '#7eafc34d';
    ctx.fillRect(x + 8, 71, 3, 43);
    ctx.fillRect(x + 4, 95, 26, 2);
    ctx.fillStyle = '#122737';
    ctx.fillRect(x + 15, 63, 4, 58);
    ctx.fillRect(x - 4, 122, 42, 5);
    ctx.fillStyle = '#aed8df3b';
    ctx.fillRect(x + 2, 124, 30, 2);
  }
  if (level === 1) {
    ctx.fillStyle = '#0a1c2a88';
    ctx.fillRect(215, 224, 50, 70);
    ctx.fillRect(223, 217, 34, 77);
    ctx.fillStyle = '#45647a66';
    for (let x = 221; x < 262; x += 8) ctx.fillRect(x, 230, 3, 62);
    ctx.fillStyle = '#779da65a';
    ctx.fillRect(216, 244, 48, 3);
  } else if (level === 2) {
    for (const x of [40, 413]) {
      ctx.fillStyle = '#5c8c9866';
      ctx.fillRect(x, 55, 24, 79);
      ctx.fillRect(x + 4, 134, 16, 7);
      ctx.fillRect(x + 8, 141, 8, 6);
      ctx.fillStyle = '#b1c5a45c';
      ctx.fillRect(x + 10, 65, 4, 42);
      ctx.fillRect(x + 5, 80, 14, 4);
      ctx.fillStyle = '#779ea46e';
      ctx.fillRect(x - 4, 51, 32, 4);
    }
  } else if (level === 3) {
    for (const x of [39, 422]) {
      ctx.fillStyle = '#102d395e';
      ctx.fillRect(x + 7, 168, 6, 126);
      for (let n = 0; n < 4; n++) {
        const y = 185 + n * 23;
        ctx.fillRect(x - 17 - n * 3, y, 53 + n * 6, 7);
        ctx.fillRect(x - 9 - n * 3, y - 8, 37 + n * 6, 8);
      }
      ctx.fillStyle = '#739d9e3e';
      ctx.fillRect(x - 8, 208, 34, 3);
      ctx.fillRect(x - 14, 254, 47, 3);
    }
  } else if (level === 4) {
    for (const [x, h] of [
      [34, 49],
      [61, 28],
      [409, 57],
      [442, 35],
    ]) {
      ctx.fillStyle = '#6e7fbd38';
      ctx.fillRect(x, 294 - h, 13, h);
      ctx.fillRect(x + 4, 287 - h, 5, 7);
      ctx.fillStyle = '#a0a4cd3d';
      ctx.fillRect(x + 3, 298 - h, 3, h - 4);
    }
  } else if (level === 5) {
    ctx.fillStyle = '#9cbdce55';
    ctx.fillRect(178, 47, 42, 30);
    ctx.fillRect(184, 41, 30, 42);
    ctx.fillRect(191, 37, 16, 50);
    ctx.fillStyle = stage.color;
    ctx.fillRect(197, 40, 25, 29);
    ctx.fillRect(205, 47, 20, 28);
    for (const x of [73, 110, 334, 390]) {
      ctx.fillStyle = '#9ebdca4f';
      ctx.fillRect(x, 45 + (x % 23), 2, 2);
    }
  } else {
    ctx.fillStyle = '#121d365e';
    ctx.fillRect(202, 202, 76, 86);
    ctx.fillRect(211, 188, 58, 99);
    ctx.fillRect(223, 178, 34, 111);
    ctx.fillStyle = '#7f74aa4d';
    ctx.fillRect(209, 211, 5, 71);
    ctx.fillRect(266, 211, 5, 71);
    ctx.fillRect(202, 281, 76, 6);
    ctx.fillStyle = '#b09baf42';
    ctx.fillRect(236, 197, 8, 39);
    ctx.fillRect(223, 209, 34, 6);
  }
  for (const x of [34, 442]) {
    const y = level === 3 ? 143 : 158;
    ctx.fillStyle = '#0c213766';
    ctx.fillRect(x + 3, 31, 2, y - 31);
    ctx.fillRect(x, y, 10, 17);
    ctx.fillRect(x - 2, y, 14, 3);
    ctx.fillRect(x - 2, y + 15, 14, 3);
    ctx.fillStyle = Math.floor(time * 5 + x) % 3 ? '#dbbb795a' : '#ffda926b';
    ctx.fillRect(x + 2, y + 4, 6, 9);
    ctx.fillStyle = '#fbdb9a38';
    ctx.fillRect(x - 3, y - 3, 16, 23);
  }
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i % 3 ? '#89b8c55a' : '#c9f5fb77';
    ctx.fillRect((i * 89 + time * 4) % 480, (i * 53 + time * (8 + (i % 3))) % 294, 2, 2);
  }
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    level = 1,
    lives = 3,
    timer = 120,
    elapsed = 0,
    transition = 0,
    shotClock = 0,
    kickClock = 0;
  let jumpWasDown = false,
    jumpBuffer = 0,
    coyote = 0,
    kickFlash = 0,
    combo = 0,
    comboClock = 0,
    tutorial = 0;
  let platforms = [],
    enemies = [],
    shots = [],
    snowballs = [],
    particles = [];
  const player = {
    x: 232,
    y: 276,
    w: 16,
    h: 18,
    vx: 0,
    vy: 0,
    grounded: true,
    face: 1,
    invincible: 2,
  };
  function spawnLevel() {
    platforms = [
      { ...FLOOR },
      ...stages[level - 1].ledges.map(([x, y, w]) => ({ x, y, w, h: 13 })),
    ];
    enemies = stages[level - 1].foes.map(([platform, x, type], id) => ({
      id,
      x,
      y: platforms[platform].y - 18,
      w: type === 'warden' ? 24 : 18,
      h: 18,
      vx: 0,
      vy: 0,
      grounded: true,
      dir: id % 2 ? 1 : -1,
      snow: 0,
      freezeHits: type === 'warden' ? 5 : 3,
      thaw: 0,
      active: true,
      type,
      hopClock: 2 + id * 0.3,
      telegraph: 0,
      flash: 0,
      stance: type === 'warden' ? 'guard' : 'patrol',
      stanceTimer: 1.6,
    }));
    Object.assign(player, { x: 232, y: 276, vx: 0, vy: 0, grounded: true, face: 1, invincible: 2 });
    shots = [];
    snowballs = [];
    timer = 120;
    shotClock = 0;
    jumpBuffer = 0;
    coyote = 0;
    combo = 0;
  }
  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t(
            'Six chambers freed. The Frost Warden has fallen!',
            '六座大厅解放，冰霜守卫已倒下！',
          )
        : env.t(
            'The frost remains. Freeze first, then get close and kick!',
            '冰霜仍在。先冻结，再靠近踢球！',
          ),
    });
  }
  function burst(x, y, color, count = 8) {
    for (let n = 0; n < count; n++)
      particles.push({
        x,
        y,
        vx: (env.random() - 0.5) * 110,
        vy: -env.random() * 100,
        life: 0.45,
        color,
      });
    if (particles.length > 160) particles.splice(0, particles.length - 160);
  }
  function defeat(e, chain = 1) {
    if (!e.active) return;
    e.active = false;
    score += 100 * chain + (e.type === 'warden' ? 600 : 0);
    combo = Math.max(combo, chain);
    comboClock = 1.3;
    env.sound('coin');
    burst(e.x + e.w / 2, e.y + 8, '#d2f8ff', 12);
  }
  function hurt(enemy) {
    if (player.invincible > 0) return;
    lives--;
    env.sound('hit');
    burst(player.x + 8, player.y, '#ff9b8e');
    if (lives <= 0) {
      finish(false);
      return;
    }
    player.invincible = 2.5;
    if (enemy) player.vx = (player.x + player.w / 2 < enemy.x + enemy.w / 2 ? -1 : 1) * 145;
    jumpBuffer = 0;
  }
  spawnLevel();
  return {
    update(dt, input) {
      if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 1 / 30);
      elapsed += dt;
      player.invincible = Math.max(0, player.invincible - dt);
      kickFlash = Math.max(0, kickFlash - dt);
      comboClock = Math.max(0, comboClock - dt);
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 200 * dt;
      }
      const jumpDown = input.held('ArrowUp', 'KeyW');
      const jumpPressed = input.pressed('ArrowUp', 'KeyW') || (jumpDown && !jumpWasDown);
      jumpWasDown = jumpDown;
      if (transition > 0) {
        transition -= dt;
        if (transition <= 0) {
          if (level === 6) {
            finish(true);
            return;
          }
          level++;
          lives = Math.min(5, lives + 1);
          spawnLevel();
        }
        return;
      }
      timer -= dt;
      if (timer <= 0) {
        finish(false);
        return;
      }
      const direction =
        Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
      const oldVX = player.vx;
      player.vx = approach(
        player.vx,
        direction * 130,
        (direction ? (player.grounded ? 1200 : 750) : player.grounded ? 1300 : 160) * dt,
      );
      const nextVX = player.vx;
      if (direction) player.face = direction;
      jumpBuffer = jumpPressed ? 0.13 : Math.max(0, jumpBuffer - dt);
      coyote = player.grounded ? 0.1 : Math.max(0, coyote - dt);
      if (jumpBuffer > 0 && coyote > 0) {
        player.vy = -300;
        player.grounded = false;
        jumpBuffer = 0;
        coyote = 0;
        env.sound('move');
      }
      player.vx = (oldVX + nextVX) / 2;
      moveOnPlatforms(player, [...platforms, ...enemies.filter((e) => e.active), ...snowballs], dt);
      player.vx = player.hitX ? 0 : nextVX;
      if (player.y > 330) {
        finish(false);
        return;
      }
      shotClock -= dt;
      kickClock -= dt;
      if (input.held('Space', 'KeyJ') && shotClock <= 0) {
        shots.push({
          x: player.x + (player.face > 0 ? 16 : -6),
          y: player.y + 5,
          w: 6,
          h: 6,
          vx: player.face * 270,
          vy: -70,
          grounded: false,
          life: 1.25,
        });
        shotClock = 0.21;
        env.sound('shoot');
      }
      if (input.pressed('KeyK', 'KeyX') && kickClock <= 0) {
        kickClock = 0.2;
        kickFlash = 0.16;
        const frozen = enemies
          .filter(
            (e) =>
              e.active &&
              e.snow >= e.freezeHits &&
              Math.abs(e.x + e.w / 2 - (player.x + 8)) <= 42 &&
              (e.x + e.w / 2 - (player.x + 8)) * player.face >= -4 &&
              Math.abs(e.y - player.y) < 25,
          )
          .sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
        if (frozen) {
          const direction = player.face,
            size = frozen.type === 'warden' ? 24 : 20;
          snowballs.push({
            x: clamp(frozen.x + (frozen.w - size) / 2, 0, 480 - size),
            y: frozen.y + frozen.h - size,
            w: size,
            h: size,
            vx: direction * 220,
            vy: frozen.vy,
            grounded: frozen.grounded,
            life: 7,
            chain: 1,
            launched: true,
            spin: 0,
          });
          defeat(frozen);
          tutorial = 2;
          env.sound('shoot');
        }
      }
      for (const e of enemies) {
        if (!e.active) continue;
        e.thaw = Math.max(0, e.thaw - dt);
        e.flash = Math.max(0, e.flash - dt);
        if (e.snow > 0 && e.thaw <= 0) {
          e.snow--;
          e.thaw = e.snow >= e.freezeHits ? 8 : 3;
        }
        if (e.snow >= e.freezeHits) {
          e.stance = 'frozen';
          e.vx = approach(e.vx, 0, (e.grounded ? 180 : 25) * dt);
          moveOnPlatforms(e, platforms, dt);
          continue;
        }
        e.hopClock = Math.max(0, e.hopClock - dt);
        e.telegraph = 0;
        const support = platforms.find(
          (p) => Math.abs(e.y + e.h - p.y) < 1 && e.x + e.w > p.x && e.x < p.x + p.w,
        );
        if (support && (e.x < support.x + 3 || e.x + e.w > support.x + support.w - 3))
          e.dir = e.x < support.x + 3 ? 1 : -1;
        let targetSpeed = e.dir * (e.type === 'hopper' ? 32 : 27) * (1 - e.snow * 0.2);
        if (e.type === 'warden') {
          if (e.stance === 'frozen') {
            e.stance = 'recover';
            e.stanceTimer = 2;
          }
          e.stanceTimer = Math.max(0, e.stanceTimer - dt);
          if (e.stance === 'guard' && e.stanceTimer === 0) {
            e.stance = 'windup';
            e.stanceTimer = 0.65;
            e.dir = player.x < e.x ? -1 : 1;
          } else if (e.stance === 'windup' && e.stanceTimer === 0) {
            e.stance = 'leap';
            e.vy = -230;
            e.grounded = false;
          } else if (e.stance === 'recover' && e.stanceTimer === 0) {
            e.stance = 'guard';
            e.stanceTimer = 1.6;
          }
          if (e.stance === 'windup') e.telegraph = e.stanceTimer;
          targetSpeed = e.stance === 'leap' ? e.dir * 70 * (1 - e.snow * 0.08) : 0;
        } else if (e.type === 'hopper' && e.grounded) {
          if (e.hopClock < 0.4) e.telegraph = Math.max(0, e.hopClock);
          if (e.hopClock <= 0) {
            e.vy = -175;
            e.hopClock = 3.1;
            e.grounded = false;
          }
        }
        e.vx = approach(e.vx, targetSpeed, 240 * dt);
        moveOnPlatforms(
          e,
          [...platforms, player, ...enemies.filter((other) => other !== e && other.active)],
          dt,
        );
        if (e.type === 'warden' && e.stance === 'leap' && e.grounded) {
          e.stance = 'recover';
          e.stanceTimer = 2;
          burst(e.x + e.w / 2, e.y + e.h, '#c1d6e0', 8);
        }
        if (e.hitX) e.dir *= -1;
        if (e.y > 330) {
          e.active = false;
        }
      }
      for (const shot of shots) {
        const ox = shot.x,
          oy = shot.y;
        moveOnPlatforms(shot, platforms, dt);
        shot.life -= dt;
        for (const e of enemies) {
          if (shot.life <= 0 || !e.active || !sweptRect(shot, ox, oy, e)) continue;
          shot.life = 0;
          if (e.type === 'warden' && e.stance !== 'recover' && e.stance !== 'frozen') {
            burst(e.x + e.w / 2, e.y + 5, '#a0aebb', 4);
            break;
          }
          if (e.snow < e.freezeHits) {
            e.snow++;
            e.flash = 0.1;
            if (e.snow === e.freezeHits) tutorial = Math.max(1, tutorial);
            e.thaw = e.snow === e.freezeHits ? 10 : 4;
            env.sound('hit');
            burst(e.x + 8, e.y, '#e5ffff', 4);
          } else e.thaw = 10;
          break;
        }
        if ((shot.grounded || shot.hitX || shot.hitCeiling) && shot.life > 0) {
          shot.life = 0;
          burst(shot.x, shot.y, '#bbdce5', 3);
        }
      }
      shots = shots.filter((s) => s.life > 0 && s.x > -12 && s.x < 492);
      for (const ball of snowballs) {
        const ox = ball.x,
          oy = ball.y;
        rollSnowball(ball, [...platforms, player], dt);
        for (const e of enemies)
          if (ball.launched && e.active && sweptRect(ball, ox, oy, e)) {
            ball.chain++;
            defeat(e, ball.chain);
            ball.vx *= 0.82;
            if (Math.abs(ball.vx) < 25) ball.launched = false;
          }
      }
      snowballs = snowballs.filter((b) => b.life > 0 && b.y < 330);
      // Only a mobile, unfrozen monster can damage the hero. Balls never displace the hero.
      for (const e of enemies)
        if (
          e.active &&
          e.snow < e.freezeHits &&
          player.x <= e.x + e.w + EPSILON &&
          player.x + player.w >= e.x - EPSILON &&
          player.y <= e.y + e.h + EPSILON &&
          player.y + player.h >= e.y - EPSILON
        ) {
          hurt(e);
          break;
        }
      if (phase === 'playing' && enemies.every((e) => !e.active)) {
        score += Math.ceil(timer) * 3;
        transition = 1.5;
        env.sound('win');
      }
    },
    draw(ctx) {
      const stage = stages[level - 1];
      drawChamber(ctx, stage, level, elapsed);
      for (const p of platforms) {
        ctx.fillStyle = '#365c79';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#a4e5ee';
        ctx.fillRect(p.x, p.y, p.w, 4);
        ctx.fillStyle = '#e5ffff';
        ctx.fillRect(p.x, p.y, p.w, 1);
        ctx.fillStyle = '#6aa8bd';
        for (let x = p.x + 9; x < p.x + p.w - 7; x += 25) {
          ctx.fillRect(x, p.y + 4, 4, 8);
          if (p.h > 14) ctx.fillRect(x, p.y + 15, 1, 9);
        }
      }
      for (const e of enemies)
        if (e.active) {
          const frozen = e.snow >= e.freezeHits;
          const x = Math.round(e.x),
            y = Math.round(e.y);
          if (frozen) {
            ctx.fillStyle = '#78aabe';
            ctx.fillRect(x, y, e.w, e.h);
            ctx.fillStyle = '#defaff';
            ctx.fillRect(x + 2, y, e.w - 4, e.h);
            ctx.fillRect(x, y + 3, e.w, e.h - 6);
            ctx.fillStyle = '#8ebbc9';
            ctx.fillRect(x + 4, y + 5, 3, 3);
            ctx.fillRect(x + e.w - 7, y + 10, 4, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x + 3, y + 1, 5, 2);
            if (e.thaw < 3 && Math.floor(elapsed * 7) % 2) {
              ctx.fillStyle = '#688b9f';
              ctx.fillRect(x + 10, y + 2, 2, 10);
            }
            drawPixelText(ctx, env.t('KICK', '踢'), x + e.w / 2, y - 12, '#d5ffda', 8, 'center');
          } else {
            pixelSprite(
              ctx,
              e.type === 'warden' ? WARDEN : e.type === 'hopper' ? HOPPER : WALKER,
              x,
              y,
              2,
              {
                a:
                  e.flash > 0
                    ? '#ffffff'
                    : e.snow
                      ? '#a2cede'
                      : e.type === 'warden'
                        ? e.stance === 'recover'
                          ? '#c6a8ec'
                          : '#8f9db8'
                        : e.type === 'hopper'
                          ? '#efb46c'
                          : '#ef8c83',
                b: '#20334b',
                c: '#fff2cd',
                d: '#ad4e68',
              },
            );
            if (e.type === 'warden') {
              ctx.fillStyle = '#e0bf79';
              ctx.fillRect(x + 2, y - 4, 20, 3);
              for (let n = 0; n < 3; n++) ctx.fillRect(x + 3 + n * 7, y - 7, 3, 4);
              if (e.stance === 'guard') {
                ctx.fillStyle = '#bacbdf';
                ctx.fillRect(x + (e.dir > 0 ? 18 : 1), y + 4, 5, 11);
                ctx.fillStyle = '#67768f';
                ctx.fillRect(x + (e.dir > 0 ? 19 : 2), y + 6, 3, 6);
              }
              if (e.stance === 'recover') {
                ctx.fillStyle = Math.floor(elapsed * 8) % 2 ? '#d8ffff' : '#a9e5e9';
                ctx.fillRect(x + 9, y + 7, 6, 5);
                drawPixelText(ctx, env.t('OPEN', '破绽'), x + 12, y - 18, '#ceffdd', 8, 'center');
              }
              if (e.stance === 'windup') {
                ctx.fillStyle = '#f2bd85';
                ctx.fillRect(x + 3, y + 14, 18, 3);
              }
            }
            if (e.telegraph > 0) {
              ctx.fillStyle = '#fbd18c';
              ctx.fillRect(x + 6, y - 10, 3, 5);
              ctx.fillRect(x + 6, y - 3, 3, 2);
            }
          }
          for (let n = 0; n < e.freezeHits; n++) {
            ctx.fillStyle = n < e.snow ? '#f5ffff' : '#344961';
            ctx.fillRect(x + n * 4, y - 5, 3, 2);
          }
        }
      {
        if (player.invincible > 0) {
          ctx.strokeStyle = '#c6ffff';
          ctx.strokeRect(player.x - 3, player.y - 3, 22, 24);
        }
        const x = Math.round(player.x),
          y = Math.round(player.y);
        ctx.save();
        ctx.translate(x + 8, y);
        ctx.scale(player.face, 1);
        pixelSprite(ctx, HERO, -8, 0, 2, {
          h: '#f1fcff',
          f: '#e7ad8d',
          e: '#29435b',
          c: '#67ddc3',
          b: '#2e758d',
        });
        ctx.fillStyle = '#8af0d2';
        ctx.fillRect(-8, 8, Math.floor(elapsed * 10) % 2 ? 4 : 6, 2);
        if (player.grounded && Math.abs(player.vx) > 0) {
          ctx.fillStyle = '#2e758d';
          ctx.fillRect(Math.floor(elapsed * 12) % 2 ? -6 : 1, 16, 4, 2);
        }
        if (kickFlash > 0) {
          ctx.fillStyle = '#b5ffee';
          ctx.fillRect(10, 11, 13, 3);
        }
        ctx.restore();
      }
      ctx.fillStyle = '#f0ffff';
      for (const s of shots) {
        ctx.fillRect(s.x, s.y, 6, 6);
        ctx.fillStyle = '#a0dbeaaa';
        ctx.fillRect(s.x - Math.sign(s.vx) * 5, s.y + 2, 4, 2);
        ctx.fillStyle = '#f0ffff';
      }
      for (const b of snowballs) {
        ctx.fillStyle = '#89bdd2';
        ctx.fillRect(b.x, b.y + 2, b.w, b.h - 4);
        ctx.fillStyle = '#e0fbff';
        ctx.fillRect(b.x + 2, b.y, b.w - 4, b.h);
        ctx.fillRect(b.x, b.y + 3, b.w, b.h - 6);
        ctx.fillStyle = '#8eb4c8';
        ctx.fillRect(
          b.x + b.w / 2 - 2 + Math.sin(b.spin) * 4,
          b.y + b.h / 2 - 2 + Math.cos(b.spin) * 4,
          4,
          3,
        );
      }
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.fillStyle = '#0e1d30';
      ctx.fillRect(0, 0, 480, 28);
      drawPixelText(ctx, `${level}/6 ${env.t(stage.en, stage.zh)}`, 10, 8, '#d8f7ff', 11);
      drawPixelText(ctx, '♥'.repeat(Math.max(0, lives)), 300, 8, '#ffa39e', 11);
      drawPixelText(
        ctx,
        `${Math.max(0, Math.ceil(timer))}s`,
        470,
        8,
        timer < 20 ? '#ffb899' : '#e4f8ff',
        11,
        'right',
      );
      ctx.fillStyle = '#0d1a2ad9';
      ctx.fillRect(0, 306, 480, 14);
      const hint =
        level === 1
          ? tutorial === 0
            ? env.t('SNOW ×3 → FROZEN → GET CLOSE + KICK', '雪球×3 → 冻结 → 靠近踢球')
            : env.t(
                'FROZEN = SAFE · FACE IT + K · JUMP AROUND LEDGE EDGES',
                '冻结后无伤害 · 面向它按K · 从平台边缘跳上',
              )
          : level === 6
            ? env.t(
                'WARDEN: DODGE THE LEAP → FREEZE DURING RECOVERY',
                '守卫：躲开跃击 → 落地后冻结',
              )
            : env.t(
                'JUMP AROUND SOLID LEDGES · FROZEN FOES NEED A KICK',
                '平台不可穿透 · 从边缘跳上 · 冻结后踢球',
              );
      drawPixelText(ctx, hint, 240, 309, '#a6c9d6', 8, 'center');
      if (comboClock > 0 && combo > 1)
        drawPixelText(ctx, `${combo}× ${env.t('CHAIN', '连击')}`, 240, 49, '#ffe59d', 13, 'center');
      if (transition > 0) {
        ctx.fillStyle = '#10243ceb';
        ctx.fillRect(60, 132, 360, 50);
        drawPixelText(ctx, env.t('CHAMBER FREED', '大厅已解放'), 240, 149, '#c2f4f5', 18, 'center');
      }
    },
    getState() {
      return {
        phase,
        score,
        level,
        totalLevels: 6,
        lives,
        timer,
        transition,
        tutorial,
        player: { ...player },
        platforms: platforms.map((p) => ({ ...p })),
        enemies: enemies.map((e) => ({ ...e })),
        shots: shots.map((s) => ({ ...s })),
        snowballs: snowballs.map((b) => ({ ...b })),
        particles: particles.length,
        status: {
          en: `${level}/6 ${stages[level - 1].en} · Snow → freeze · K → kick · ${lives} hearts`,
          zh: `${level}/6 ${stages[level - 1].zh} · 雪球冻结 → K踢球 · ${lives}生命`,
        },
      };
    },
  };
}
