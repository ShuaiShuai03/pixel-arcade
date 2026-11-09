// Actors, strike zones, the HUD and the sector select, drawn into the 480 x 320 canvas.
import { drawPixelText as text } from '../shared/utils.js';
import { ATLAS, bounds, turretOffset, hullHeight } from './sky-raiders-sprites.js';
import { openCore } from './sky-raiders-step.js';
import { warningRays } from './sky-raiders-ai.js';
import { SECTORS, SECTOR_COUNT } from './sky-raiders-sectors.js';
import { drawScenery } from './sky-raiders-scenery.js';
import { menuCell, MENU_COLUMNS } from './sky-raiders-menu.js';

const PLAYER_PALETTE = { a: '#78d7df', b: '#e6f7eb', c: '#3b899d' };
const RAY_LENGTH_SECONDS = 4;

function palette(actor) {
  if (actor.id === 0) return PLAYER_PALETTE;
  return {
    a: actor.shape === 'gunship' ? '#b99cbd' : actor.shape === 'sniper' ? '#9bb7d8' : '#e58f78',
    b: '#ffdb9a',
    h: '#a384a9',
    l: '#d9ad87',
    r: '#d9ad87',
    c: openCore(actor) ? '#f7de9a' : '#727c96',
  };
}
function drawTell(ctx, actor) {
  text(ctx, '!', actor.x, actor.y - hullHeight(actor.shape) / 2 - 12, '#ffe0a0', 13, 'center');
  // The ray brightens as the lock completes, so the last moments are the clearest.
  const last = actor.tell < 0.2;
  ctx.strokeStyle = last ? '#fff0c4' : '#ffb868';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const ray of warningRays(actor)) {
    ctx.moveTo(ray.origin.x, ray.origin.y);
    ctx.lineTo(
      ray.origin.x + ray.vx * RAY_LENGTH_SECONDS,
      ray.origin.y + ray.vy * RAY_LENGTH_SECONDS,
    );
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function drawBossGauges(ctx, actor) {
  if (actor.parts)
    for (const [part, side] of [
      ['l', -1],
      ['r', 1],
    ]) {
      if (actor.parts[part] <= 0) continue;
      const x = actor.x + side * turretOffset(actor.shape) - 8,
        y = actor.y + hullHeight(actor.shape) / 2 + 3;
      ctx.fillStyle = '#4b3e50';
      ctx.fillRect(x, y, 16, 2);
      ctx.fillStyle = '#e6bd8f';
      ctx.fillRect(x, y, (16 * actor.parts[part]) / actor.partMax, 2);
    }
  if (openCore(actor)) {
    ctx.strokeStyle = '#f2d9a7';
    ctx.lineWidth = 1;
    const core = hullHeight(actor.shape) / 2;
    ctx.strokeRect(actor.x - 8, actor.y + core - 18, 16, 15);
  }
}
function drawActor(ctx, actor, s) {
  const rows = ATLAS[actor.shape] ?? ATLAS.scout,
    w = Math.max(...rows.map((r) => r.length)),
    h = rows.length,
    pal = palette(actor);
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
  if (actor.boss) drawBossGauges(ctx, actor);
  if (actor.tell > 0) drawTell(ctx, actor);
}
/** A strike zone: a growing tint and bright edges while warning, a white flash while it fires. */
function drawHazard(ctx, hazard, elapsed) {
  const armed = hazard.warn > 0,
    progress = 1 - hazard.warn / hazard.warnTotal,
    blink = armed && hazard.warn < 0.35 && Math.floor(elapsed * 16) % 2 === 0;
  for (const zone of hazard.rects) {
    ctx.globalAlpha = armed ? 0.16 + 0.22 * progress + (blink ? 0.2 : 0) : 0.9;
    ctx.fillStyle = armed ? '#ff9a52' : '#fff4d0';
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = armed ? '#ffc07a' : '#ffffff';
    if (zone.w >= 480) {
      ctx.fillRect(zone.x, zone.y, zone.w, 2);
      ctx.fillRect(zone.x, zone.y + zone.h - 2, zone.w, 2);
    } else {
      ctx.fillRect(zone.x, zone.y, 2, zone.h);
      ctx.fillRect(zone.x + zone.w - 2, zone.y, 2, zone.h);
    }
    if (armed)
      text(
        ctx,
        '!',
        Math.min(468, zone.x + zone.w / 2),
        Math.max(zone.y, 52),
        '#fff0c4',
        12,
        'center',
      );
  }
}
function drawPickup(ctx, p) {
  const look = { shield: ['#89ddbd', '+'], charge: ['#b8c6f4', 'K'], power: ['#ead38c', 'W'] }[
    p.kind
  ];
  ctx.fillStyle = look[0];
  ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
  text(ctx, look[1], p.x, p.y - 5, '#213448', 10, 'center');
}
function drawBullet(ctx, b) {
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
function drawHud(ctx, s, env, sector) {
  ctx.fillStyle = '#102436';
  ctx.fillRect(0, 0, 480, 48);
  text(ctx, `${s.level}/${SECTOR_COUNT} ${env.t(sector.en, sector.zh)}`, 10, 8, '#d8e8e5', 11);
  text(ctx, `${env.t('SHIELDS', '护盾')} ${s.lives}/4`, 470, 8, '#b3e9ca', 11, 'right');
  text(ctx, `${env.t('WEAPON', '武器')} ${s.player.power}`, 10, 28, '#e4d29b', 10);
  const cooling = s.player.overheated ? env.t(' COOLING', ' 冷却中') : '';
  text(
    ctx,
    `${env.t('HEAT', '热量')} ${Math.round(s.player.heat)}${cooling}`,
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
  ctx.fillStyle = '#122639dd';
  ctx.fillRect(0, 304, 480, 16);
  text(ctx, env.t(sector.lesson.en, sector.lesson.zh), 240, 307, '#bed4d2', 9, 'center');
}
function drawBanners(ctx, s, env) {
  const boss = s.enemies.find((e) => e.boss && !e.dead);
  if (boss) {
    ctx.fillStyle = '#34495b';
    ctx.fillRect(130, 54, 220, 5);
    ctx.fillStyle = '#edb28f';
    ctx.fillRect(130, 54, (220 * boss.hp) / boss.maxHp, 5);
  }
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
function drawFlight(ctx, s, env) {
  const sector = SECTORS[s.level - 1];
  drawScenery(ctx, s, sector);
  for (const p of s.pickups) drawPickup(ctx, p);
  for (const hazard of s.hazards) drawHazard(ctx, hazard, s.elapsed);
  for (const e of s.enemies)
    if (!e.dead && e.entryWarning) {
      ctx.fillStyle = '#f3cd8a';
      ctx.fillRect(e.x - 6, 53, 12, 3);
      ctx.fillRect(e.x - 4, 56, 8, 3);
      ctx.fillRect(e.x - 2, 59, 4, 3);
    }
  for (const e of s.enemies) if (!e.dead) drawActor(ctx, e, s);
  drawActor(ctx, s.player, s);
  for (const b of s.bullets) drawBullet(ctx, b);
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
  drawHud(ctx, s, env, sector);
  drawBanners(ctx, s, env);
}
const TIER_NAME = {
  teach: { en: 'TRAINING', zh: '训练' },
  combo: { en: 'COMBINED', zh: '综合' },
  master: { en: 'MASTERY', zh: '精通' },
};
const TIER_COLOR = { teach: '#3f7a74', combo: '#8a7a45', master: '#8a4f55' };
function cellLabel(n, unlocked, env) {
  if (n > unlocked) return env.t('LOCKED', '未解锁');
  if (n < unlocked) return env.t('CLEARED', '已通关');
  return n === SECTOR_COUNT ? env.t('FINAL', '最终') : env.t('NEXT', '下一关');
}
function drawMenu(ctx, menu, env) {
  ctx.fillStyle = '#0f1d2e';
  ctx.fillRect(0, 0, 480, 320);
  text(ctx, env.t('CHOOSE A SECTOR', '选择空域'), 240, 8, '#d8e8e5', 14, 'center');
  for (let n = 1; n <= SECTOR_COUNT; n++) {
    const q = menuCell(n),
      sector = SECTORS[n - 1],
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? TIER_COLOR[sector.tier] : '#25364a';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = open ? sector.palette[0] : '#1a2838';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    text(ctx, String(n), q.x + q.w / 2, q.y + 6, open ? '#f2f0dc' : '#58697c', 16, 'center');
    text(
      ctx,
      cellLabel(n, menu.unlocked, env),
      q.x + q.w / 2,
      q.y + 28,
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
  const chosen = SECTORS[menu.cursor - 1],
    tier = TIER_NAME[chosen.tier],
    rows = Math.ceil(SECTOR_COUNT / MENU_COLUMNS),
    top = menuCell(rows * MENU_COLUMNS).y + 52;
  text(
    ctx,
    `${menu.cursor}. ${env.t(chosen.en, chosen.zh)} · ${env.t(tier.en, tier.zh)}`,
    240,
    top,
    '#ffe0a0',
    12,
    'center',
  );
  text(ctx, env.t(chosen.lesson.en, chosen.lesson.zh), 240, top + 20, '#bed4d2', 9, 'center');
  text(
    ctx,
    env.t('Arrows or tap to choose · Fire to launch', '方向键或点按选择 · 射击键出发'),
    240,
    top + 38,
    '#8fa6b4',
    9,
    'center',
  );
}
export function drawSky(ctx, s, env, menu) {
  if (menu) drawMenu(ctx, menu, env);
  else drawFlight(ctx, s, env);
}
