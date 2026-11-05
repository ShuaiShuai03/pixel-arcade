import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';
export const meta = {
  id: 'orbit-invaders',
  name: { en: 'Orbit Invaders', zh: '轨道入侵者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'Space', label: { en: 'Fire', zh: '射击' } },
  ],
  description: {
    en: 'Defend the moon through four waves. Fire through gaps and use the bunkers to survive.',
    zh: '抵御四波月球入侵。穿过间隙射击，利用掩体生存。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'Left / Right or A / D' },
    { label: { en: 'Fire', zh: '射击' }, keys: 'Space / Z' },
  ],
};
export function makeFleet(wave) {
  const out = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      out.push({ x: 68 + c * 45, y: 62 + r * 29, hp: wave >= 3 && r === 0 ? 2 : 1, type: r });
  return out;
}
export function createInvaderState() {
  return {
    phase: 'playing',
    score: 0,
    wave: 1,
    lives: 3,
    ship: { x: 240, y: 283 },
    enemies: makeFleet(1),
    shots: [],
    bullets: [],
    shields: [78, 180, 282, 384].map((x) => ({ x, y: 244, w: 36, h: 13, hp: 6 })),
    direction: 1,
    fireCooldown: 0,
    enemyCooldown: 1.1,
    invulnerable: 1.5,
    particles: [],
    time: 0,
    ufo: null,
    ufoTimer: 12,
  };
}
const hit = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export function stepInvaders(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.fireCooldown -= dt;
  s.enemyCooldown -= dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.ufoTimer -= dt;
  const axis =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.ship.x = clamp(s.ship.x + axis * 215 * dt, 14, 466);
  if (input.pointer.down && input.pointer.x >= 0) s.ship.x = clamp(input.pointer.x, 14, 466);
  if ((input.held('Space', 'KeyZ') || input.pointer.down) && s.fireCooldown <= 0) {
    s.shots.push({ x: s.ship.x, y: 274, vy: -360 });
    s.fireCooldown = 0.23;
  }
  const speed = 14 + s.wave * 5 + (24 - s.enemies.length) * 1.6;
  let edge = false;
  for (const e of s.enemies) {
    e.x += s.direction * speed * dt;
    if (e.x < 20 || e.x > 460) edge = true;
  }
  if (edge) {
    s.direction *= -1;
    for (const e of s.enemies) {
      e.x = clamp(e.x, 20, 460);
      e.y += 11;
    }
  }
  if (s.enemyCooldown <= 0 && s.enemies.length) {
    const lower = s.enemies.filter(
      (e) => !s.enemies.some((o) => Math.abs(o.x - e.x) < 12 && o.y > e.y),
    );
    const e = lower[Math.floor(random() * lower.length)];
    s.bullets.push({ x: e.x, y: e.y + 10, vy: 120 + s.wave * 20 });
    s.enemyCooldown = Math.max(0.25, 1.05 - s.wave * 0.13) + random() * 0.45;
  }
  for (const shot of s.shots) {
    shot.y += shot.vy * dt;
    for (const e of s.enemies) {
      if (e.hp > 0 && Math.abs(e.x - shot.x) < 13 && Math.abs(e.y - shot.y) < 10) {
        e.hp--;
        shot.y = -100;
        s.particles.push({ x: e.x, y: e.y, life: 0.35 });
        if (e.hp <= 0) s.score += 100 + (2 - e.type) * 25;
        break;
      }
    }
    if (s.ufo && Math.abs(s.ufo.x - shot.x) < 21 && Math.abs(s.ufo.y - shot.y) < 10) {
      s.score += 300;
      shot.y = -100;
      s.particles.push({ x: s.ufo.x, y: s.ufo.y, life: 0.5 });
      s.ufo = null;
    }
  }
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  s.shots = s.shots.filter((b) => b.y > 30);
  for (const b of s.bullets) {
    b.y += b.vy * dt;
    const shield = s.shields.find((r) => r.hp > 0 && hit(b.x, b.y, r));
    if (shield) {
      shield.hp--;
      b.y = 400;
      continue;
    }
    if (s.invulnerable <= 0 && Math.abs(b.x - s.ship.x) < 12 && Math.abs(b.y - s.ship.y) < 10) {
      s.lives--;
      s.invulnerable = 1.7;
      b.y = 400;
      s.particles.push({ x: s.ship.x, y: s.ship.y, life: 0.5 });
      if (s.lives <= 0) s.phase = 'lost';
    }
  }
  s.bullets = s.bullets.filter((b) => b.y < 330);
  s.particles = s.particles.filter((p) => (p.life -= dt) > 0).slice(-40);
  if (s.ufoTimer <= 0 && !s.ufo) {
    s.ufo = { x: -25, y: 43 };
    s.ufoTimer = 14;
  }
  if (s.ufo) {
    s.ufo.x += 65 * dt;
    if (s.ufo.x > 510) s.ufo = null;
  }
  if (s.enemies.some((e) => e.y >= 272)) s.phase = 'lost';
  if (!s.enemies.length && s.phase === 'playing') {
    if (s.wave === 4) s.phase = 'won';
    else {
      s.wave++;
      s.enemies = makeFleet(s.wave);
      s.bullets = [];
      s.invulnerable = 1.5;
      s.score += 500;
      s.shields = s.shields.map((r) => ({ ...r, hp: Math.min(6, r.hp + 2) }));
    }
  }
}
const ENEMY = [
  '..A....A..',
  '...A..A...',
  '..AAAAAA..',
  '.AA.AA.AA.',
  'AAAAAAAAAA',
  'A.AAAAAA.A',
  'A.A....A.A',
  '...AA.AA..',
];
export function createGame(env) {
  const s = createInvaderState();
  let ended = false,
    lastScore = 0,
    lastLives = 3;
  return {
    update(dt, input) {
      const oldShots = s.shots.length;
      stepInvaders(s, dt, input, env.random);
      if (s.shots.length > oldShots) env.sound('shoot');
      if (s.score > lastScore) env.sound('coin');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t('Moon colony defended!', '月球殖民地保卫成功！')
              : env.t('The colony needs another defender.', '殖民地需要你再次出战。'),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#0a1629');
      for (let i = 0; i < 85; i++) {
        ctx.fillStyle = i % 5 ? '#2a4057' : '#a3b6be';
        ctx.fillRect((i * 79) % 480, (i * 47 + Math.floor(s.time * 4)) % 320, i % 5 ? 1 : 2, 1);
      }
      ctx.fillStyle = '#203341';
      ctx.fillRect(0, 307, 480, 13);
      for (let x = 0; x < 480; x += 27) {
        ctx.fillStyle = '#314754';
        ctx.fillRect(x, 308 + (x % 5), 17, 3);
      }
      for (const e of s.enemies) {
        pixelSprite(ctx, ENEMY, e.x - 10, e.y - 8, 2, {
          A: ['#fcab70', '#8ddaa3', '#78bded'][e.type],
        });
        if (e.hp > 1) {
          ctx.fillStyle = '#fdf7d5';
          ctx.fillRect(e.x - 3, e.y - 4, 6, 3);
        }
      }
      for (const r of s.shields)
        if (r.hp > 0) {
          ctx.fillStyle = r.hp > 3 ? '#70baa2' : '#507768';
          ctx.fillRect(r.x, r.y + 4, r.w, r.h - 4);
          ctx.fillRect(r.x + 5, r.y, r.w - 10, 5);
          ctx.fillStyle = '#0a1629';
          ctx.fillRect(r.x + 12, r.y + 8, 12, 5);
          if (r.hp < 5) ctx.fillRect(r.x + 6, r.y + 2, 5, 5);
          if (r.hp < 3) ctx.fillRect(r.x + 25, r.y + 3, 7, 5);
        }
      for (const b of s.shots) {
        ctx.fillStyle = '#b5f6e1';
        ctx.fillRect(b.x - 1, b.y - 6, 3, 9);
      }
      for (const b of s.bullets) {
        ctx.fillStyle = '#ff996c';
        ctx.fillRect(b.x - 2, b.y - 4, 4, 8);
      }
      if (s.invulnerable <= 0 || Math.floor(s.time * 10) % 2 === 0) {
        pixelSprite(
          ctx,
          [
            '....A....',
            '....A....',
            '...AAA...',
            '...AAA...',
            '.AAAAAAA.',
            'AAAAAAAAA',
            'AAA.A.AAA',
          ],
          s.ship.x - 13.5,
          s.ship.y - 8,
          3,
          { A: '#a3e7d9' },
        );
        ctx.fillStyle = '#f7ba6a';
        ctx.fillRect(s.ship.x - 4, s.ship.y + 13, 3, 4);
        ctx.fillRect(s.ship.x + 2, s.ship.y + 13, 3, 4);
      }
      if (s.ufo) {
        pixelSprite(
          ctx,
          ['...AAAAAA...', '.AAAAAAAAAA.', 'AAAAAAAAAAAA', '..AA.AA.AA..'],
          s.ufo.x - 18,
          s.ufo.y - 6,
          3,
          { A: '#ed9a83' },
        );
      }
      for (const p of s.particles) {
        ctx.fillStyle = '#ffe9a5';
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          ctx.fillRect(
            p.x + Math.cos(a) * (1 - p.life) * 20,
            p.y + Math.sin(a) * (1 - p.life) * 20,
            3,
            3,
          );
        }
      }
      drawPixelText(ctx, env.t('WAVE', '波次') + ' ' + s.wave + '/4', 12, 12, '#96d6de', 13);
      drawPixelText(ctx, env.t('LIVES', '生命') + ' ' + s.lives, 468, 12, '#f1c27d', 13, 'right');
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Wave ${s.wave}/4 · ${s.lives} lives`,
        zh: `波次 ${s.wave}/4 · 生命 ${s.lives}`,
      },
    }),
  };
}
