// Rendering for Orbit Invaders: the moonbase scene, fleet, fire, craft, HUD, banners and level select.
import { drawPixelText, pixelSprite, background } from '../shared/utils.js';
import { BONUS, LINE, SHIP, SPRITES, body } from './orbit-invaders-sprites.js';
import { LEVEL_COUNT, LEVELS, TIER_NAME, bossPhase, levelOf } from './orbit-invaders-waves.js';
import { plate } from './orbit-invaders-physics.js';
import { menuCell } from './orbit-invaders-menu.js';

/** Size of the lesson line on the deploy banner; the level tests check it fits 480 px. */
export const TIP_SIZE = 10;
const ROLE_COLOR = {
  diver: '#85bfd8',
  artillery: '#caa689',
  gunner: '#c79ad6',
  warden: '#d8c27a',
};
const TIER_COLOR = { teach: '#3f7a74', combo: '#8a7a45', master: '#8a4f55' };
const levelName = (s, env) => {
  const name = levelOf(s.wave).name;
  return env.t(name.en, name.zh);
};
function drawBackdrop(ctx, s, env) {
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
}
function drawFleet(ctx, s, env) {
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
      ctx.fillStyle = ['#b8d5aa', '#edbe86', '#eb8d7b'][bossPhase(e)];
      ctx.fillRect(x, y - 8, (68 * Math.max(0, e.hp)) / e.maxHp, 4);
      ctx.fillStyle = '#f2e8c5';
      ctx.fillRect(x + 22, y - 9, 1, 6);
      ctx.fillRect(x + 45, y - 9, 1, 6);
    } else {
      const color =
        e.flash > 0
          ? '#fff2c6'
          : (ROLE_COLOR[e.role] ?? ['#f2ad7c', '#9bd5a5', '#86b7d3'][e.type % 3]);
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
}
function drawFire(ctx, s, env) {
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
}
function drawCraft(ctx, s, env) {
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
}
function drawHud(ctx, s, env) {
  ctx.fillStyle = '#0b1729';
  ctx.fillRect(0, 0, 480, 33);
  drawPixelText(ctx, env.t('WAVE ', '波次 ') + s.wave + '/' + LEVEL_COUNT, 12, 6, '#a3d7ce', 11);
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
  drawPixelText(ctx, levelName(s, env), 240, 307, '#afc8be', 10, 'center');
}
function drawBanner(ctx, s, env) {
  if (s.deploy > 0) {
    const level = levelOf(s.wave),
      tip = level.tip;
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#0b1729';
    ctx.fillRect(16, 168, 448, level.armor > 0 ? 62 : 48);
    ctx.globalAlpha = 1;
    drawPixelText(ctx, levelName(s, env), 240, 173, '#e9d4ad', 15, 'center');
    drawPixelText(ctx, env.t(tip.en, tip.zh), 240, 196, '#b3d1bd', TIP_SIZE, 'center');
    if (level.armor > 0)
      drawPixelText(
        ctx,
        env.t(
          `ARMORED SCOUTS AND DIVERS: ${level.armor + 1} HITS`,
          `装甲侦察机与俯冲机：需${level.armor + 1}发`,
        ),
        240,
        212,
        '#e0b88a',
        10,
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
}
function cellLabel(n, unlocked, env) {
  if (n > unlocked) return env.t('LOCKED', '未解锁');
  if (n < unlocked) return env.t('CLEARED', '已通关');
  return n === LEVEL_COUNT ? env.t('FINAL', '最终') : env.t('NEXT', '下一关');
}
function drawMenu(ctx, menu, env) {
  ctx.fillStyle = '#0f1d2e';
  ctx.fillRect(0, 0, 480, 320);
  drawPixelText(ctx, env.t('CHOOSE AN ENCOUNTER', '选择战斗'), 240, 8, '#d8e8e5', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? TIER_COLOR[LEVELS[n - 1].tier] : '#25364a';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = open ? '#13263a' : '#1a2838';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    drawPixelText(
      ctx,
      String(n),
      q.x + q.w / 2,
      q.y + 5,
      open ? '#f2f0dc' : '#58697c',
      16,
      'center',
    );
    drawPixelText(
      ctx,
      cellLabel(n, menu.unlocked, env),
      q.x + q.w / 2,
      q.y + 26,
      open ? '#bfe3d6' : '#58697c',
      9,
      'center',
    );
    if (n === menu.cursor) {
      ctx.strokeStyle = '#ffe0a0';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x - 1, q.y - 1, q.w + 2, q.h + 2);
    }
  }
  const chosen = LEVELS[menu.cursor - 1],
    tier = TIER_NAME[chosen.tier],
    top = menuCell(LEVEL_COUNT).y + 52;
  drawPixelText(
    ctx,
    `${menu.cursor}. ${env.t(chosen.name.en, chosen.name.zh)} · ${env.t(tier.en, tier.zh)}`,
    240,
    top,
    '#ffe0a0',
    12,
    'center',
  );
  drawPixelText(
    ctx,
    env.t(chosen.tip.en, chosen.tip.zh),
    240,
    top + 20,
    '#bed4d2',
    TIP_SIZE,
    'center',
  );
  drawPixelText(
    ctx,
    env.t('Arrows or tap to choose · Fire to launch', '方向键或点按选择 · 射击键出发'),
    240,
    top + 40,
    '#8fa6b4',
    9,
    'center',
  );
}
/** One frame: the level select when `menu` is set, otherwise the battle. */
export function drawInvaders(ctx, s, env, menu) {
  if (menu) {
    drawMenu(ctx, menu, env);
    return;
  }
  drawBackdrop(ctx, s, env);
  drawFleet(ctx, s, env);
  drawFire(ctx, s, env);
  drawCraft(ctx, s, env);
  drawHud(ctx, s, env);
  drawBanner(ctx, s, env);
}
