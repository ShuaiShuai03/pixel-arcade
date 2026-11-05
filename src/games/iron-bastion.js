import { clamp, rectsOverlap, drawPixelText, background } from '../shared/utils.js';

export const meta = {
  id: 'iron-bastion',
  name: { en: 'Iron Bastion', zh: '钢铁堡垒' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Defend the beacon through three tank waves. Break brick cover, collect repair kits and keep enemy shells away from your base.',
    zh: '抵御三波坦克进攻，保卫信标。击碎砖墙、收集维修包，阻止敌弹命中基地。',
  },
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
    { code: 'Space', label: { en: 'Fire', zh: '射击' } },
  ],
  keys: [
    { label: { en: 'Move and aim', zh: '移动和瞄准' }, keys: 'WASD / Arrows' },
    { label: { en: 'Fire', zh: '开火' }, keys: 'Space / J' },
  ],
};

const BASE = { x: 225, y: 282, w: 30, h: 26 };
const DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export function bulletHitsTile(bullet, tiles) {
  return tiles.findIndex(
    (t) => bullet.x >= t.x && bullet.x <= t.x + t.w && bullet.y >= t.y && bullet.y <= t.y + t.h,
  );
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    wave = 1,
    lives = 3,
    baseHealth = 3,
    elapsed = 0,
    toSpawn = 4,
    spawned = 0,
    spawnClock = 1,
    transition = 0;
  const player = { x: 158, y: 271, w: 20, h: 20, dir: 0, cooldown: 0, invincible: 2, rapid: 0 };
  let tiles = [],
    enemies = [],
    bullets = [],
    pickups = [],
    particles = [],
    defeated = 0;

  function makeCover() {
    tiles = [];
    for (let row = 0; row < 7; row++)
      for (const col of [3, 6, 13, 16]) {
        if ((row + col + wave) % 4 === 0) continue;
        tiles.push({
          x: col * 24,
          y: 72 + row * 24,
          w: 22,
          h: 22,
          hp: row === 2 && (col === 6 || col === 13) ? 99 : 2,
          steel: row === 2 && (col === 6 || col === 13),
        });
      }
    for (const x of [204, 228, 252]) tiles.push({ x, y: 257, w: 22, h: 22, hp: 2, steel: false });
    tiles.push(
      { x: 204, y: 281, w: 20, h: 27, hp: 2, steel: false },
      { x: 256, y: 281, w: 20, h: 27, hp: 2, steel: false },
    );
  }
  makeCover();

  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('Three waves repelled. The beacon stands!', '三波进攻已击退，信标屹立不倒！')
        : baseHealth <= 0
          ? env.t('The beacon was destroyed. Rebuild your defense!', '信标被摧毁了。重新部署防线！')
          : env.t('Your tank is out of armor. Try again!', '坦克装甲耗尽。再试一次！'),
    });
  }
  function spark(x, y, color) {
    for (let n = 0; n < 8; n++)
      particles.push({
        x,
        y,
        vx: (env.random() - 0.5) * 140,
        vy: (env.random() - 0.5) * 140,
        life: 0.35,
        color,
      });
  }
  function blocked(tank, x, y) {
    return (
      x < 5 ||
      x + tank.w > 475 ||
      y < 43 ||
      y + tank.h > 313 ||
      rectsOverlap({ x, y, w: tank.w, h: tank.h }, BASE) ||
      tiles.some((t) => rectsOverlap({ x, y, w: tank.w, h: tank.h }, t))
    );
  }
  function fire(tank, owner) {
    const [dx, dy] = DIRECTIONS[tank.dir];
    bullets.push({
      x: tank.x + tank.w / 2 + dx * 14,
      y: tank.y + tank.h / 2 + dy * 14,
      vx: dx * (owner === 'player' ? 240 : 145),
      vy: dy * (owner === 'player' ? 240 : 145),
      owner,
      life: 3,
    });
    if (owner === 'player') env.sound('shoot');
  }
  function hurtPlayer() {
    if (player.invincible > 0) return;
    lives--;
    player.invincible = 2.2;
    player.x = 158;
    player.y = 271;
    spark(player.x, player.y, '#ffe29c');
    env.sound('hit');
    if (lives <= 0) finish(false);
  }
  function destroyEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    score += 100 * wave;
    defeated++;
    spark(enemy.x + 10, enemy.y + 10, '#ffb56d');
    env.sound('coin');
    if (defeated % 3 === 0)
      pickups.push({
        x: enemy.x,
        y: enemy.y,
        w: 18,
        h: 18,
        kind: defeated % 6 === 0 ? 'rapid' : 'repair',
        life: 12,
      });
  }

  return {
    update(dt, input) {
      if (phase !== 'playing') return;
      elapsed += dt;
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (transition > 0) {
        transition -= dt;
        if (transition <= 0) {
          wave++;
          if (wave > 3) {
            wave = 3;
            finish(true);
            return;
          }
          toSpawn = 2 + wave * 2;
          spawned = 0;
          spawnClock = 1;
          makeCover();
          if (blocked(player, player.x, player.y)) {
            player.x = 158;
            player.y = 271;
            player.dir = 0;
            player.cooldown = 0;
          }
          bullets = [];
          baseHealth = Math.min(3, baseHealth + 1);
          player.invincible = 2;
        }
        return;
      }
      player.cooldown -= dt;
      player.invincible = Math.max(0, player.invincible - dt);
      player.rapid = Math.max(0, player.rapid - dt);
      let dx = 0,
        dy = 0;
      if (input.held('ArrowLeft', 'KeyA')) {
        dx = -1;
        player.dir = 3;
      } else if (input.held('ArrowRight', 'KeyD')) {
        dx = 1;
        player.dir = 1;
      } else if (input.held('ArrowUp', 'KeyW')) {
        dy = -1;
        player.dir = 0;
      } else if (input.held('ArrowDown', 'KeyS')) {
        dy = 1;
        player.dir = 2;
      }
      const nx = player.x + dx * 98 * dt,
        ny = player.y + dy * 98 * dt;
      if (!blocked(player, nx, ny)) {
        player.x = nx;
        player.y = ny;
      }
      if (input.held('Space', 'KeyJ') && player.cooldown <= 0) {
        fire(player, 'player');
        player.cooldown = player.rapid > 0 ? 0.14 : 0.3;
      }
      spawnClock -= dt;
      if (spawned < toSpawn && enemies.length < 4 && spawnClock <= 0) {
        const positions = [24, 120, 228, 336, 432],
          x = positions[(spawned + wave) % positions.length];
        enemies.push({
          x,
          y: 45,
          w: 20,
          h: 20,
          dir: 2,
          hp: wave === 3 && spawned % 2 === 0 ? 2 : 1,
          cooldown: 1.2 + env.random() * 0.6,
          turn: 0.7,
          stuck: 0,
          dead: false,
        });
        spawned++;
        spawnClock = 2.5;
      }
      for (const e of enemies) {
        if (e.dead) continue;
        e.cooldown -= dt;
        e.turn -= dt;
        const ex = e.x + 10,
          ey = e.y + 10,
          px = player.x + 10,
          py = player.y + 10;
        if (e.turn <= 0) {
          e.turn = 0.65 + env.random() * 0.3;
          if (Math.abs(ex - px) < 22 && Math.abs(ey - py) < 170) e.dir = py > ey ? 2 : 0;
          else if (Math.abs(ey - py) < 22 && Math.abs(ex - px) < 170) e.dir = px > ex ? 1 : 3;
          else if (ey > 238 && Math.abs(ex - 240) > 10) e.dir = ex < 240 ? 1 : 3;
          else e.dir = 2;
          if (e.stuck > 0.9) {
            e.dir = ex < 240 ? 1 : 3;
            e.stuck = 0;
          }
        }
        const [mx, my] = DIRECTIONS[e.dir],
          nx = e.x + mx * (25 + wave * 5) * dt,
          ny = e.y + my * (25 + wave * 5) * dt;
        if (!blocked(e, nx, ny)) {
          e.x = nx;
          e.y = ny;
          e.stuck = 0;
        } else e.stuck += dt;
        if (e.cooldown <= 0) {
          fire(e, 'enemy');
          e.cooldown = 1.6 - wave * 0.15 + env.random() * 0.5;
        }
        if (rectsOverlap(e, player)) hurtPlayer();
      }
      for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0) continue;
        const tileIndex = bulletHitsTile(b, tiles);
        if (tileIndex >= 0) {
          const tile = tiles[tileIndex];
          b.life = 0;
          spark(b.x, b.y, tile.steel ? '#a4bdc9' : '#c68e6a');
          if (!tile.steel && --tile.hp <= 0) {
            tiles.splice(tileIndex, 1);
            if (b.owner === 'player') score += 10;
          }
          continue;
        }
        const projectile = { x: b.x - 2, y: b.y - 2, w: 4, h: 4 };
        if (rectsOverlap(projectile, BASE)) {
          b.life = 0;
          if (b.owner === 'enemy') {
            baseHealth--;
            env.sound('hit');
            spark(240, 295, '#ff806a');
            if (baseHealth <= 0) {
              finish(false);
              return;
            }
          }
          continue;
        }
        if (b.owner === 'player') {
          const target = enemies.find((e) => !e.dead && rectsOverlap(projectile, e));
          if (target) {
            b.life = 0;
            target.hp--;
            env.sound('hit');
            if (target.hp <= 0) destroyEnemy(target);
          }
        } else if (rectsOverlap(projectile, player)) {
          b.life = 0;
          hurtPlayer();
        }
      }
      bullets = bullets.filter(
        (b) => b.life > 0 && b.x >= 0 && b.x <= 480 && b.y >= 36 && b.y <= 320,
      );
      enemies = enemies.filter((e) => !e.dead);
      for (const p of pickups) {
        p.life -= dt;
        if (rectsOverlap(player, p)) {
          p.life = 0;
          score += 50;
          if (p.kind === 'repair') {
            lives = Math.min(4, lives + 1);
            baseHealth = Math.min(3, baseHealth + 1);
          } else player.rapid = 10;
          env.sound('coin');
        }
      }
      pickups = pickups.filter((p) => p.life > 0);
      if (phase === 'playing' && spawned === toSpawn && enemies.length === 0) {
        transition = 2;
        score += baseHealth * 200;
        env.sound('win');
      }
    },
    draw(ctx) {
      background(ctx, '#273536');
      for (let y = 40; y < 320; y += 24)
        for (let x = 0; x < 480; x += 24) {
          ctx.fillStyle = (x / 24 + y / 24) % 2 ? '#2b3938' : '#293735';
          ctx.fillRect(x, y, 24, 24);
          ctx.fillStyle = '#34443e';
          ctx.fillRect(x + 5, y + 16, 3, 2);
        }
      for (const t of tiles) {
        ctx.fillStyle = t.steel ? '#879ca4' : t.hp === 2 ? '#a46f52' : '#6f5547';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.fillStyle = t.steel ? '#b3c8c5' : '#c68c64';
        ctx.fillRect(t.x + 1, t.y + 1, t.w - 2, 3);
        ctx.fillStyle = '#3c433e';
        ctx.fillRect(t.x, t.y + 11, t.w, 2);
        ctx.fillRect(t.x + 10, t.y, 2, 11);
        ctx.fillRect(t.x + 5, t.y + 12, 2, 10);
      }
      ctx.fillStyle = baseHealth > 0 ? '#bca75e' : '#5d5144';
      ctx.fillRect(BASE.x, BASE.y, BASE.w, BASE.h);
      ctx.fillStyle = '#f6dc86';
      ctx.fillRect(236, 277, 8, 25);
      ctx.fillStyle = '#fff5c1';
      ctx.fillRect(238, 279, 4, 12);
      const drawTank = (tank, color) => {
        ctx.save();
        ctx.translate(Math.round(tank.x + 10), Math.round(tank.y + 10));
        ctx.rotate((tank.dir * Math.PI) / 2);
        ctx.fillStyle = '#172527';
        ctx.fillRect(-11, -11, 5, 22);
        ctx.fillRect(6, -11, 5, 22);
        ctx.fillStyle = '#60716a';
        for (let y = -9; y < 10; y += 5) {
          ctx.fillRect(-11, y, 5, 2);
          ctx.fillRect(6, y, 5, 2);
        }
        ctx.fillStyle = color;
        ctx.fillRect(-7, -8, 14, 17);
        ctx.fillStyle = '#e2db9a';
        ctx.fillRect(-2, -16, 4, 15);
        ctx.fillStyle = color;
        ctx.fillRect(-5, -4, 10, 9);
        ctx.restore();
      };
      for (const e of enemies) drawTank(e, e.hp > 1 ? '#b4a4a3' : '#d38061');
      if (!(player.invincible > 0 && Math.floor(elapsed * 12) % 2)) drawTank(player, '#77cba3');
      for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#fff3ba' : '#ff9475';
        ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
      }
      for (const p of pickups) {
        ctx.fillStyle = '#f2d78b';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        drawPixelText(
          ctx,
          p.kind === 'repair' ? '+' : '>>',
          p.x + 9,
          p.y + 3,
          '#315947',
          11,
          'center',
        );
      }
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.fillStyle = '#172a2d';
      ctx.fillRect(0, 0, 480, 36);
      drawPixelText(ctx, `${env.t('WAVE', '波次')} ${wave}/3`, 12, 12, '#e9e4bd', 11);
      drawPixelText(ctx, `${env.t('ARMOR', '装甲')} ${lives}`, 160, 12, '#85d1b0', 11);
      drawPixelText(ctx, `${env.t('BASE', '基地')} ${baseHealth}/3`, 323, 12, '#f4d984', 11);
      if (transition > 0) {
        ctx.fillStyle = '#142a2ee8';
        ctx.fillRect(72, 132, 336, 48);
        drawPixelText(ctx, env.t('WAVE REPELLED', '进攻已击退'), 240, 147, '#f4d984', 18, 'center');
      }
    },
    getState() {
      return {
        phase,
        score,
        wave,
        lives,
        baseHealth,
        player: { ...player },
        enemies: enemies.map((e) => ({ ...e })),
        bullets: bullets.map((b) => ({ ...b })),
        tiles: tiles.map((t) => ({ ...t })),
        pickups: pickups.map((p) => ({ ...p })),
        spawned,
        toSpawn,
        status: {
          en: `Wave ${wave}/3 · Armor ${lives} · Beacon ${baseHealth}/3`,
          zh: `波次 ${wave}/3 · 装甲 ${lives} · 信标 ${baseHealth}/3`,
        },
      };
    },
  };
}
