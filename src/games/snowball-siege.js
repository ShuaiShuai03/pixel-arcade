import { clamp, rectsOverlap, drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'snowball-siege',
  name: { en: 'Snowball Siege', zh: '雪球攻城' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Pack each monster with three snow shots, then launch it! Clear all three frosty towers before time runs out.',
    zh: '用三发雪球冻住怪物，再发射它！在时间耗尽前清空三座冰霜高塔。',
  },
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Jump', zh: '跳' } },
    { code: 'Space', label: { en: 'Snow', zh: '雪球' } },
  ],
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: '← → / A D' },
    { label: { en: 'Jump (hold to hop)', zh: '跳跃（按住连续跳）' }, keys: '↑ / W' },
    {
      label: { en: 'Throw snow / launch frozen foe', zh: '投雪球 / 发射冰冻怪物' },
      keys: 'Space / J',
    },
  ],
};

const PLATFORMS = [
  { x: 0, y: 294, w: 480 },
  { x: 18, y: 236, w: 170 },
  { x: 290, y: 236, w: 172 },
  { x: 108, y: 178, w: 266 },
  { x: 20, y: 120, w: 170 },
  { x: 290, y: 120, w: 168 },
];
const HERO = [
  '..bbbb..',
  '.bccccb.',
  '.ccddcc.',
  '..dddd..',
  '.eeeeee.',
  'eeeeeeee',
  '..eeee..',
  '..f..f..',
];
const FOE = ['..aaaa..', '.aaaaaa.', 'aabaabaa', 'aabaabaa', 'aaaaaaaa', '.aaaaaa.', '.a....a.'];

/** Resolve downward-only platform collisions, allowing jumps through undersides. */
export function moveOnPlatforms(body, platforms, dt) {
  const oldBottom = body.y + body.h;
  body.x = clamp(body.x + body.vx * dt, 0, 480 - body.w);
  body.vy += 540 * dt;
  body.y += body.vy * dt;
  body.grounded = false;
  for (const p of platforms) {
    if (
      body.vy >= 0 &&
      oldBottom <= p.y + 0.01 &&
      body.y + body.h >= p.y &&
      body.x + body.w > p.x &&
      body.x < p.x + p.w
    ) {
      body.y = p.y - body.h;
      body.vy = 0;
      body.grounded = true;
      break;
    }
  }
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    level = 1,
    lives = 3,
    timer = 90,
    elapsed = 0,
    transition = 0,
    shotClock = 0,
    jumpClock = 0;
  const player = {
    x: 232,
    y: 276,
    w: 16,
    h: 18,
    vx: 0,
    vy: 0,
    grounded: true,
    face: 1,
    invincible: 1.5,
  };
  let enemies = [],
    shots = [],
    snowballs = [],
    particles = [];

  function spawnLevel() {
    timer = 90;
    shots = [];
    snowballs = [];
    const places =
      level === 1
        ? [
            [0, 365],
            [1, 64],
            [2, 350],
          ]
        : level === 2
          ? [
              [0, 350],
              [1, 58],
              [2, 340],
              [3, 215],
              [4, 70],
            ]
          : [
              [0, 350],
              [1, 50],
              [2, 340],
              [3, 150],
              [3, 310],
              [4, 65],
              [5, 365],
            ];
    enemies = places.map(([platform, x], i) => ({
      x,
      y: PLATFORMS[platform].y - 16,
      w: 16,
      h: 16,
      platform,
      dir: i % 2 ? 1 : -1,
      snow: 0,
      thaw: 0,
      active: true,
    }));
    player.x = 232;
    player.y = 276;
    player.vy = 0;
    player.grounded = true;
    player.invincible = 2;
  }
  spawnLevel();

  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('All three towers are free!', '三座高塔全部解放！')
        : env.t('The frost wins this time. Try another siege!', '这次冰霜获胜。再来一次攻城吧！'),
    });
  }
  function burst(x, y, color, count = 10) {
    for (let n = 0; n < count; n++)
      particles.push({
        x,
        y,
        vx: (env.random() - 0.5) * 100,
        vy: -env.random() * 100,
        life: 0.5,
        color,
      });
  }
  function defeat(enemy, chain = false) {
    enemy.active = false;
    score += chain ? 250 : 100;
    env.sound('coin');
    burst(enemy.x + 8, enemy.y + 8, '#b9f4ff');
  }

  return {
    update(dt, input) {
      if (phase !== 'playing') return;
      elapsed += dt;
      player.invincible = Math.max(0, player.invincible - dt);
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 200 * dt;
      }
      if (transition > 0) {
        transition -= dt;
        if (transition <= 0) {
          level++;
          if (level > 3) {
            level = 3;
            finish(true);
          } else spawnLevel();
        }
        return;
      }
      timer -= dt;
      if (timer <= 0) {
        lives--;
        if (lives <= 0) finish(false);
        else spawnLevel();
        return;
      }
      const direction =
        Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
      player.vx = direction * 125;
      if (direction) player.face = direction;
      jumpClock -= dt;
      if (input.held('ArrowUp', 'KeyW') && player.grounded && jumpClock <= 0) {
        player.vy = -278;
        player.grounded = false;
        jumpClock = 0.2;
        env.sound('move');
      }
      moveOnPlatforms(player, PLATFORMS, dt);
      shotClock -= dt;
      if (input.held('Space', 'KeyJ') && shotClock <= 0) {
        shots.push({
          x: player.x + (player.face > 0 ? 16 : -4),
          y: player.y + 7,
          w: 6,
          h: 6,
          vx: player.face * 240,
          life: 1.6,
        });
        shotClock = 0.23;
        env.sound('shoot');
      }
      for (const e of enemies) {
        if (!e.active) continue;
        e.thaw -= dt;
        if (e.snow && e.thaw <= 0) {
          e.snow = Math.max(0, e.snow - 1);
          e.thaw = 2;
        }
        if (e.snow < 3) {
          const p = PLATFORMS[e.platform];
          e.x += e.dir * (24 + level * 7) * (1 - e.snow * 0.24) * dt;
          if (e.x < p.x + 4 || e.x + e.w > p.x + p.w - 4) {
            e.x = clamp(e.x, p.x + 4, p.x + p.w - e.w - 4);
            e.dir *= -1;
          }
          if (player.invincible <= 0 && rectsOverlap(player, e)) {
            lives--;
            player.invincible = 2;
            player.vy = -170;
            player.x = clamp(player.x - e.dir * 24, 0, 464);
            env.sound('hit');
            burst(player.x, player.y, '#ff8278');
            if (lives <= 0) {
              finish(false);
              return;
            }
          }
        }
      }
      for (const b of shots) {
        b.x += b.vx * dt;
        b.life -= dt;
        for (const e of enemies) {
          if (b.life <= 0 || !e.active || !rectsOverlap(b, e)) continue;
          b.life = 0;
          if (e.snow < 3) {
            e.snow++;
            e.thaw = e.snow === 3 ? 7 : 3.5;
            env.sound('hit');
            burst(e.x + 8, e.y, '#fff', 4);
          } else {
            snowballs.push({ x: e.x, y: e.y, w: 20, h: 20, vx: Math.sign(b.vx) * 190, life: 3 });
            defeat(e);
          }
        }
      }
      shots = shots.filter((b) => b.life > 0 && b.x > -10 && b.x < 490);
      for (const ball of snowballs) {
        ball.life -= dt;
        ball.x += ball.vx * dt;
        if (ball.x < 0 || ball.x > 460) {
          ball.x = clamp(ball.x, 0, 460);
          ball.vx *= -1;
        }
        for (const e of enemies) if (e.active && rectsOverlap(ball, e)) defeat(e, true);
      }
      snowballs = snowballs.filter((b) => b.life > 0);
      if (enemies.every((e) => !e.active)) {
        score += Math.ceil(timer) * 5;
        transition = 1.5;
        env.sound('win');
      }
    },
    draw(ctx) {
      background(ctx, '#14253b');
      for (let x = 0; x < 480; x += 48) {
        ctx.fillStyle = '#1c334c';
        ctx.fillRect(x + 5, 32, 30, 262);
        ctx.fillStyle = '#28435e';
        ctx.fillRect(x + 8, 38, 3, 254);
      }
      for (let i = 0; i < 35; i++) {
        const x = (i * 89) % 480,
          y = (i * 53 + elapsed * (8 + (i % 3))) % 310;
        ctx.fillStyle = '#6996ab';
        ctx.fillRect(x, y, 2, 2);
      }
      for (const p of PLATFORMS) {
        ctx.fillStyle = '#4c7e99';
        ctx.fillRect(p.x, p.y, p.w, 10);
        ctx.fillStyle = '#c2f4f5';
        ctx.fillRect(p.x, p.y, p.w, 4);
        ctx.fillStyle = '#76becb';
        for (let x = p.x + 8; x < p.x + p.w - 5; x += 27) ctx.fillRect(x, p.y + 4, 4, 9);
      }
      for (const e of enemies)
        if (e.active) {
          if (e.snow === 3) {
            ctx.fillStyle = '#d8f7ff';
            ctx.fillRect(e.x - 2, e.y - 2, 20, 20);
            ctx.fillStyle = '#7baec9';
            ctx.fillRect(e.x + 2, e.y + 2, 4, 4);
          } else {
            pixelSprite(ctx, FOE, e.x, e.y + Math.sin(elapsed * 8) * 1, 2, {
              a: ['#ef7a6d', '#a5d2ee', '#d0e9f8'][e.snow],
              b: '#20314c',
            });
          }
          for (let n = 0; n < e.snow; n++) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(e.x + n * 5, e.y - 5, 3, 2);
          }
        }
      if (!(player.invincible > 0 && Math.floor(elapsed * 12) % 2))
        pixelSprite(ctx, HERO, player.x, player.y, 2, {
          b: '#cfedf4',
          c: '#fff',
          d: '#e9ad88',
          e: '#60ddc1',
          f: '#2d7895',
        });
      ctx.fillStyle = '#f4fcff';
      for (const b of shots) ctx.fillRect(b.x, b.y, b.w, b.h);
      for (const b of snowballs) {
        ctx.fillStyle = '#d8f7ff';
        ctx.fillRect(b.x + 2, b.y, 16, 20);
        ctx.fillRect(b.x, b.y + 2, 20, 16);
        ctx.fillStyle = '#8fc4d7';
        ctx.fillRect(b.x + 5, b.y + 5, 5, 5);
      }
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.fillStyle = '#0d1c2e';
      ctx.fillRect(0, 0, 480, 27);
      drawPixelText(ctx, `${env.t('TOWER', '高塔')} ${level}/3`, 10, 8, '#d8f7ff', 11);
      drawPixelText(
        ctx,
        `${env.t('HEARTS', '生命')} ${'♥'.repeat(Math.max(0, lives))}`,
        185,
        8,
        '#ff8c94',
        11,
      );
      drawPixelText(
        ctx,
        `${Math.max(0, Math.ceil(timer))}s`,
        462,
        8,
        timer < 15 ? '#ff8c94' : '#fff',
        11,
        'right',
      );
      if (transition > 0) {
        ctx.fillStyle = '#10243ce6';
        ctx.fillRect(60, 132, 360, 48);
        drawPixelText(
          ctx,
          env.t('TOWER CLEARED!', '高塔已清空！'),
          240,
          147,
          '#c2f4f5',
          18,
          'center',
        );
      }
    },
    getState() {
      return {
        phase,
        score,
        level,
        lives,
        timer,
        player: { ...player },
        enemies: enemies.map((e) => ({ ...e })),
        shots: shots.map((b) => ({ ...b })),
        snowballs: snowballs.map((b) => ({ ...b })),
        status: {
          en: `Tower ${level}/3 · ${lives} hearts · ${Math.ceil(Math.max(0, timer))}s`,
          zh: `高塔 ${level}/3 · ${lives} 生命 · ${Math.ceil(Math.max(0, timer))}秒`,
        },
      };
    },
  };
}
