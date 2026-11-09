// Iron Bastion rendering: ground themes, cover, tanks, shells and the HUD.
import { background, drawPixelText as text } from '../shared/utils.js';
import {
  BASE,
  FIELD_COUNT,
  MAGAZINE,
  MAX_ARMOR,
  MAX_BEACON,
  MAX_KITS,
  SHELL_R,
  THEMES,
  fieldOf,
} from './iron-bastion-data.js';
import { sweepCircleRect } from './iron-bastion-physics.js';
import { drawMenu } from './iron-bastion-menu.js';

const CHARGE_TIME = 0.7;

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

// Painted road, floor panels and scorch marks are flat visual surfaces.
function drawGround(ctx, theme) {
  background(ctx, '#192b30');
  ctx.fillStyle = theme.floor[0];
  ctx.fillRect(8, 44, 464, 268);
  for (let y = 48; y < 310; y += 16)
    for (let x = 12; x < 470; x += 16) {
      ctx.fillStyle = theme.floor[(x + y) % 3 ? 0 : 1];
      ctx.fillRect(x, y, 14, 14);
      ctx.fillStyle = theme.accent + '55';
      if ((x * 3 + y) % 7 === 0) ctx.fillRect(x + 3, y + 9, 3, 1);
    }
  ctx.fillStyle = theme.road;
  ctx.fillRect(218, 44, 44, 211);
  for (let y = 60; y < 251; y += 28) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(239, y, 2, 10);
  }
  if (theme.name === 'foundry' || theme.name === 'night') {
    ctx.fillStyle = '#65665c';
    for (const x of [18, 450])
      for (let y = 90; y < 286; y += 36) {
        ctx.fillRect(x, y, 10, 20);
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x + 2, y + 3, 6, 2);
        ctx.fillStyle = '#65665c';
      }
  }
  if (theme.name === 'siege' || theme.name === 'desert' || theme.name === 'frost')
    for (const [x, y] of [
      [42, 153],
      [432, 192],
      [177, 93],
      [278, 231],
    ]) {
      pixelDisc(ctx, x, y, 8, '#29383c');
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x - 3, y + 6, 7, 1);
    }
  ctx.fillStyle = '#87917d';
  ctx.fillRect(4, 40, 472, 4);
  ctx.fillRect(4, 312, 472, 4);
  ctx.fillRect(4, 44, 4, 268);
  ctx.fillRect(472, 44, 4, 268);
}

function drawTile(ctx, t) {
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
    return;
  }
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

function drawBeacon(ctx, s) {
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
  for (let n = 0; n < MAX_BEACON; n++) {
    ctx.fillStyle = n < s.baseHealth ? '#e5cd8e' : '#4d594e';
    ctx.fillRect(226 + n * 6, 305, 4, 2);
  }
}

function drawTank(ctx, s, a) {
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
    ctx.fillRect(a.x - 9, a.y - 17, 18 * (1 - a.charge / CHARGE_TIME), 2);
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
            : a.role === 'scout'
              ? '#9fb7d6'
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
  if (a.role === 'scout') tankPixel(ctx, a, -1, -8, 2, 8, '#f3f0d0');
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

const PARTICLE_COLOR = { intercept: '#fff1b2', steel: '#b9d9da', brick: '#cf9b6c' };

function drawField(ctx, s, theme) {
  drawGround(ctx, theme);
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
  for (const t of s.tiles) drawTile(ctx, t);
  drawBeacon(ctx, s);
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
  for (const a of [...s.enemies, s.player]) drawTank(ctx, s, a);
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
    ctx.fillStyle = PARTICLE_COLOR[p.kind] ?? '#e7a182';
    ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    if (p.kind === 'intercept') {
      ctx.fillRect(p.x - 3, p.y, 7, 1);
      ctx.fillRect(p.x, p.y - 3, 1, 7);
    }
  }
}

function pips(ctx, x, y, count, full, on, off) {
  for (let n = 0; n < count; n++) {
    ctx.fillStyle = n < full ? on : off;
    ctx.fillRect(x + n * 11, y, 8, 6);
  }
}

// Separate quantities, shape gauges and a full-width notice row avoid overlaps.
function drawHud(ctx, s, env, field) {
  ctx.fillStyle = '#14292f';
  ctx.fillRect(0, 0, 480, 44);
  text(
    ctx,
    `${s.field}/${FIELD_COUNT} ${env.t(field.name.en, field.name.zh)}`,
    12,
    3,
    '#e0dcc1',
    11,
  );
  text(
    ctx,
    env.t(`ARMOR ${s.lives}/${MAX_ARMOR}`, `装甲 ${s.lives}/${MAX_ARMOR}`),
    174,
    3,
    '#9ed9b8',
    11,
  );
  text(
    ctx,
    env.t(`BEACON ${s.baseHealth}/${MAX_BEACON}`, `信标 ${s.baseHealth}/${MAX_BEACON}`),
    285,
    3,
    '#f1d89d',
    11,
  );
  text(ctx, env.t(`KITS ${s.kits}`, `维修包 ${s.kits}`), 465, 3, '#e4d2a6', 11, 'right');
  text(ctx, env.t(`AMMO ${s.player.rounds}`, `弹药 ${s.player.rounds}`), 12, 17, '#b8d3cb', 10);
  pips(ctx, 84, 18, MAGAZINE, Math.floor(s.player.charge), '#e7c98a', '#3b5552');
  pips(ctx, 184, 18, MAX_ARMOR, s.lives, '#86bc9a', '#3b5552');
  for (let n = 0; n < MAX_BEACON; n++) {
    ctx.fillStyle = n < s.baseHealth ? '#d2bc7b' : '#4a5551';
    ctx.fillRect(291 + n * 10, 18, 7, 6);
  }
  for (let n = 0; n < MAX_KITS; n++) {
    ctx.fillStyle = n < s.kits ? '#e1cf9b' : '#425b56';
    ctx.fillRect(431 + n * 12, 18, 8, 6);
    if (n < s.kits) {
      ctx.fillStyle = '#3c5d4a';
      ctx.fillRect(434 + n * 12, 19, 2, 4);
    }
  }
  const notice =
    s.transition > 0
      ? env.t('Engineers rearm and repair the line', '工程队补充弹药并维修防线')
      : s.clearing
        ? env.t('Cease fire — clearing live shells', '停火，等待实弹清除')
        : s.toast.time > 0
          ? env.t(s.toast.en, s.toast.zh)
          : env.t(
              'X hold: brake / aim · H: repair · Touch field: aim / fire',
              '按住X刹车瞄准 · H维修 · 触按场地瞄准射击',
            );
  text(ctx, notice, 12, 31, '#b8c8b9', 10);
}

function drawSecured(ctx, s, env) {
  const next = fieldOf(s.field + 1);
  ctx.fillStyle = '#132b31ef';
  ctx.fillRect(62, 126, 356, 78);
  ctx.strokeStyle = '#b6ad7e';
  ctx.lineWidth = 2;
  ctx.strokeRect(62, 126, 356, 78);
  text(ctx, env.t('BATTLEFIELD SECURED', '战场已守住'), 240, 136, '#ebdba1', 16, 'center');
  text(
    ctx,
    env.t('Engineers: armor / beacon / kit +1', '工程队：装甲／信标／维修包各+1'),
    240,
    164,
    '#d1d3b6',
    10,
    'center',
  );
  text(
    ctx,
    env.t(`Next: ${next.name.en} · rearmed`, `下一战场：${next.name.zh} · 弹药补满`),
    240,
    181,
    '#b6cabc',
    10,
    'center',
  );
}

export function drawBastion(ctx, s, env) {
  if (s.menu) {
    drawMenu(ctx, s, env);
    return;
  }
  const field = fieldOf(s.field);
  drawField(ctx, s, THEMES[field.theme]);
  drawHud(ctx, s, env, field);
  if (s.transition > 0) drawSecured(ctx, s, env);
}
