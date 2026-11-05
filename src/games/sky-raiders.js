import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'sky-raiders',
  name: { en: 'Sky Raiders', zh: '天空突袭' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Fly through three hostile sectors and defeat their carriers. Collect weapon upgrades, dodge fire and save your three screen-clearing pulses.',
    zh: '穿越三个敌方空域，击败航母。收集武器升级、躲避炮火，并善用三次清屏脉冲。',
  },
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
    { code: 'Space', label: { en: 'Fire', zh: '射击' } },
    { code: 'KeyK', label: { en: 'Pulse', zh: '脉冲' } },
  ],
  keys: [
    { label: { en: 'Fly', zh: '飞行' }, keys: 'WASD / Arrows' },
    { label: { en: 'Fire', zh: '开火' }, keys: 'Space / J' },
    { label: { en: 'Pulse bomb (3 per run)', zh: '脉冲炸弹（每局3次）' }, keys: 'K / X' },
  ],
};
const SHIP = [
  '....aa....',
  '....aa....',
  '...abba...',
  '.aaabbaaa.',
  'aaabbbbaaa',
  'aaabbbbaaa',
  '..aacca...',
  '..a..a....',
];
const FOE = ['aa....aa', 'aaa..aaa', '.aaaaaa.', '..abba..', '...aa...', '...aa...'];
export const circleHit = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r;

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    level = 1,
    lives = 3,
    pulses = 3,
    elapsed = 0,
    spawnClock = 1,
    spawned = 0,
    quota = 10,
    shotClock = 0,
    transition = 0,
    kills = 0,
    flash = 0;
  const player = { x: 240, y: 271, r: 7, power: 1, invincible: 2 };
  let enemies = [],
    bullets = [],
    pickups = [],
    particles = [],
    bossSpawned = false;

  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('All carriers down. The skies are clear!', '所有航母已击败，天空重归平静！')
        : env.t(
            'Your squadron will return. Watch the incoming fire!',
            '你的机队会卷土重来。留意来袭炮火！',
          ),
    });
  }
  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++)
      particles.push({
        x,
        y,
        vx: (env.random() - 0.5) * 130,
        vy: (env.random() - 0.5) * 130,
        life: 0.5,
        color,
      });
  }
  function damageEnemy(enemy, damage) {
    if (enemy.dead) return;
    enemy.hp -= damage;
    enemy.flash = 0.08;
    if (enemy.hp <= 0) {
      enemy.dead = true;
      kills++;
      score += enemy.boss ? 1000 * level : 100;
      burst(enemy.x, enemy.y, '#ffc780', enemy.boss ? 30 : 10);
      env.sound('coin');
      if (enemy.boss) {
        transition = 2;
        bullets = [];
      } else if (kills % 4 === 0)
        pickups.push({ x: enemy.x, y: enemy.y, r: 11, type: kills % 8 === 0 ? 'repair' : 'power' });
    }
  }
  function enemyShot(enemy, angle, speed = 88) {
    bullets.push({
      x: enemy.x,
      y: enemy.y + 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 4,
      owner: 'enemy',
      life: 6,
    });
  }
  function hurt() {
    if (player.invincible > 0) return;
    lives--;
    player.invincible = 2;
    player.power = Math.max(1, player.power - 1);
    burst(player.x, player.y, '#7ce2ed');
    env.sound('hit');
    if (lives <= 0) finish(false);
  }

  return {
    update(dt, input) {
      if (phase !== 'playing') return;
      elapsed += dt;
      flash = Math.max(0, flash - dt);
      player.invincible = Math.max(0, player.invincible - dt);
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (transition > 0) {
        transition -= dt;
        if (transition <= 0) {
          level++;
          if (level > 3) {
            level = 3;
            finish(true);
            return;
          }
          spawned = 0;
          quota = 8 + level * 2;
          bossSpawned = false;
          spawnClock = 1;
          enemies = [];
          bullets = [];
          player.invincible = 2;
          lives = Math.min(4, lives + 1);
        }
        return;
      }
      const dx = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
      const dy = Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW'));
      const diagonal = dx && dy ? Math.SQRT1_2 : 1;
      player.x = clamp(player.x + dx * 160 * diagonal * dt, 14, 466);
      player.y = clamp(player.y + dy * 160 * diagonal * dt, 52, 302);
      shotClock -= dt;
      if (input.held('Space', 'KeyJ') && shotClock <= 0) {
        const offsets =
          player.power >= 3 ? [-0.13, 0, 0.13] : player.power === 2 ? [-0.045, 0.045] : [0];
        for (const angle of offsets)
          bullets.push({
            x: player.x,
            y: player.y - 13,
            vx: Math.sin(angle) * 300,
            vy: -Math.cos(angle) * 300,
            r: 3,
            owner: 'player',
            life: 1.2,
          });
        shotClock = 0.16;
        env.sound('shoot');
      }
      if (input.pressed('KeyK', 'KeyX') && pulses > 0) {
        pulses--;
        flash = 0.25;
        bullets = bullets.filter((b) => b.owner === 'player');
        for (const e of enemies) damageEnemy(e, e.boss ? 10 : 10);
        player.invincible = Math.max(player.invincible, 0.8);
        env.sound('hit');
      }
      spawnClock -= dt;
      if (spawned < quota && spawnClock <= 0) {
        const x = 40 + env.random() * 400;
        enemies.push({
          x,
          y: 29,
          originX: x,
          r: 11,
          hp: spawned % 4 === 3 ? 3 : 2,
          speed: 34 + level * 7,
          age: 0,
          shotClock: 1.1 + env.random() * 1.8,
          type: spawned % 3,
          boss: false,
          dead: false,
          flash: 0,
        });
        spawned++;
        spawnClock = 1.15 - level * 0.1;
      }
      if (spawned === quota && enemies.length === 0 && !bossSpawned) {
        enemies.push({
          x: 240,
          y: 35,
          r: 31,
          hp: 25 + level * 10,
          maxHp: 25 + level * 10,
          age: 0,
          shotClock: 1.8,
          boss: true,
          dead: false,
          flash: 0,
        });
        bossSpawned = true;
      }
      for (const e of enemies) {
        if (e.dead) continue;
        e.age += dt;
        e.flash = Math.max(0, e.flash - dt);
        e.shotClock -= dt;
        if (e.boss) {
          e.y = Math.min(84, e.y + 25 * dt);
          e.x = 240 + Math.sin(e.age * 0.65) * 145;
        } else {
          e.y += e.speed * dt;
          e.x = clamp(
            e.originX +
              (e.type === 1 ? Math.sin(e.age * 2) * 50 : e.type === 2 ? Math.sin(e.age) * 25 : 0),
            15,
            465,
          );
        }
        if (e.shotClock <= 0 && e.y > 45 && e.y < 235) {
          const angle = Math.atan2(player.y - e.y, player.x - e.x);
          if (e.boss) {
            for (const spread of [-0.42, -0.21, 0, 0.21, 0.42])
              enemyShot(e, angle + spread, 77 + level * 6);
            e.shotClock = 1.25 - level * 0.1;
          } else {
            enemyShot(e, angle, 78 + level * 8);
            e.shotClock = 2.5;
          }
        }
        if (circleHit(player, e)) {
          hurt();
          if (!e.boss) e.dead = true;
        }
        if (e.y > 340) e.dead = true;
      }
      for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0) continue;
        if (b.owner === 'player') {
          const target = enemies.find((e) => !e.dead && circleHit(b, e));
          if (target) {
            b.life = 0;
            damageEnemy(target, 1);
          }
        } else if (circleHit(b, player)) {
          b.life = 0;
          hurt();
        }
      }
      bullets = bullets.filter(
        (b) => b.life > 0 && b.x > -10 && b.x < 490 && b.y > 32 && b.y < 330,
      );
      enemies = enemies.filter((e) => !e.dead);
      for (const p of pickups) {
        p.y += 42 * dt;
        if (circleHit(p, player)) {
          p.y = 350;
          if (p.type === 'repair') lives = Math.min(4, lives + 1);
          else player.power = Math.min(3, player.power + 1);
          score += 50;
          env.sound('coin');
        }
      }
      pickups = pickups.filter((p) => p.y < 335);
    },
    draw(ctx) {
      background(ctx, ['#172940', '#26304c', '#302b44'][level - 1]);
      for (let i = 0; i < 60; i++) {
        const x = (i * 73) % 480,
          y = (i * 57 + elapsed * (15 + (i % 4) * 10)) % 320;
        ctx.fillStyle = i % 4 ? '#5d778e' : '#accdd6';
        ctx.fillRect(x, y, 2, i % 4 ? 2 : 4);
      }
      ctx.fillStyle = '#283c52';
      ctx.fillRect(330, ((elapsed * 5) % 480) - 160, 88, 80);
      ctx.fillRect(340, ((elapsed * 5) % 480) - 170, 68, 100);
      ctx.fillStyle = '#344e60';
      ctx.fillRect(349, ((elapsed * 5) % 480) - 148, 14, 20);
      for (const e of enemies) {
        if (e.boss) {
          ctx.fillStyle = e.flash > 0 ? '#fff' : '#ab7781';
          ctx.fillRect(e.x - 40, e.y - 18, 80, 30);
          ctx.fillRect(e.x - 28, e.y - 28, 56, 50);
          ctx.fillStyle = '#4b445c';
          ctx.fillRect(e.x - 30, e.y - 12, 60, 20);
          ctx.fillStyle = '#ffd595';
          ctx.fillRect(e.x - 8, e.y - 20, 16, 32);
          ctx.fillStyle = '#df8e72';
          ctx.fillRect(e.x - 34, e.y + 8, 8, 18);
          ctx.fillRect(e.x + 26, e.y + 8, 8, 18);
          ctx.fillStyle = '#413344';
          ctx.fillRect(140, 39, 200, 5);
          ctx.fillStyle = '#eea185';
          ctx.fillRect(140, 39, (200 * e.hp) / e.maxHp, 5);
        } else
          pixelSprite(ctx, FOE, e.x - 12, e.y - 9, 3, {
            a: e.flash > 0 ? '#fff' : e.hp > 2 ? '#bd9bd0' : '#e88f78',
            b: '#f8d493',
          });
      }
      if (!(player.invincible > 0 && Math.floor(elapsed * 13) % 2)) {
        pixelSprite(ctx, SHIP, player.x - 15, player.y - 12, 3, {
          a: '#90d9dd',
          b: '#e4f9ed',
          c: '#5bbabf',
        });
        ctx.fillStyle = '#f3b36a';
        ctx.fillRect(player.x - 8, player.y + 10, 4, 6 + (Math.floor(elapsed * 20) % 6));
        ctx.fillRect(player.x + 4, player.y + 10, 4, 6 + (Math.floor(elapsed * 20) % 6));
      }
      for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#b5f4ed' : '#ffba82';
        ctx.fillRect(
          b.x - 2,
          b.y - (b.owner === 'player' ? 5 : 2),
          4,
          b.owner === 'player' ? 9 : 5,
        );
      }
      for (const p of pickups) {
        ctx.fillStyle = p.type === 'repair' ? '#8de0b1' : '#f1dc87';
        ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
        drawPixelText(ctx, p.type === 'repair' ? '+' : 'W', p.x, p.y - 6, '#25394b', 12, 'center');
      }
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      if (flash > 0) {
        ctx.fillStyle = '#e1faff99';
        ctx.fillRect(0, 36, 480, 284);
      }
      ctx.fillStyle = '#101e31';
      ctx.fillRect(0, 0, 480, 33);
      drawPixelText(ctx, `${env.t('SECTOR', '空域')} ${level}/3`, 12, 11, '#c2ebec', 11);
      drawPixelText(ctx, `${env.t('SHIELDS', '护盾')} ${lives}`, 179, 11, '#9be4c4', 11);
      drawPixelText(ctx, `${env.t('PULSES', '脉冲')} ${pulses}`, 355, 11, '#f8d894', 11);
      if (transition > 0) {
        ctx.fillStyle = '#122037eb';
        ctx.fillRect(68, 134, 344, 48);
        drawPixelText(
          ctx,
          env.t('SECTOR SECURED', '空域已安全'),
          240,
          149,
          '#9eece6',
          17,
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
        pulses,
        player: { ...player },
        enemies: enemies.map((e) => ({ ...e })),
        bullets: bullets.map((b) => ({ ...b })),
        pickups: pickups.map((p) => ({ ...p })),
        spawned,
        quota,
        status: {
          en: `Sector ${level}/3 · Shields ${lives} · Pulses ${pulses} · Weapon ${player.power}`,
          zh: `空域 ${level}/3 · 护盾 ${lives} · 脉冲 ${pulses} · 武器 ${player.power}`,
        },
      };
    },
  };
}
