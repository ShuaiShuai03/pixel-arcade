// Rendering: the chamber, HUD, forecast path and the chamber select screen.
import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { COURIER_ROOMS, LEVEL_COUNT } from './gravity-courier-rooms.js';
import { HH, HW, carried, courierField, courierLanding, room } from './gravity-courier-physics.js';
import { menuCell } from './gravity-courier-menu.js';
import { lowerHint, prompt } from './gravity-courier-text.js';

const isGlass = (s) => room(s).integrity < 3;
function crate(ctx, x, y, integrity, max, glass = false) {
  ctx.fillStyle = glass ? '#7faeb9' : '#c58e57';
  ctx.fillRect(x - 6, y - 5, 12, 10);
  ctx.fillStyle = '#f1d69c';
  ctx.fillRect(x - 6, y - 5, 12, 2);
  ctx.fillStyle = '#64564b';
  ctx.fillRect(x - 1, y - 5, 2, 10);
  if (integrity < max) {
    ctx.fillStyle = '#4c3834';
    ctx.fillRect(x - 4, y - 2, 4, 2);
    ctx.fillRect(x - 2, y, 2, 3);
    if (integrity === 0) {
      ctx.fillRect(x + 1, y - 3, 2, 5);
      ctx.fillRect(x + 2, y + 1, 3, 2);
    }
  }
}
function pad(ctx, p, label, color, env) {
  const yy = p.side > 0 ? 271 : 52;
  ctx.fillStyle = '#223b43';
  ctx.fillRect(p.x - 24, p.side > 0 ? 250 : 52, 48, 26);
  ctx.fillStyle = color;
  ctx.fillRect(p.x - 24, yy, 48, 5);
  ctx.fillStyle = '#a7b7a0';
  for (const x of [-18, 12]) ctx.fillRect(p.x + x, p.side > 0 ? 265 : 57, 6, 6);
  text(ctx, label, p.x, p.side > 0 ? 236 : 83, color, 14, 'center');
}
export function drawCourier(ctx, s, env, menu = null) {
  if (menu) return drawMenu(ctx, env, menu);
  const r = room(s),
    p = s.player,
    g = courierField(s),
    landing = courierLanding(s);
  ctx.save();
  background(ctx, '#112b39');
  for (let x = 24; x < 456; x += 36) {
    ctx.fillStyle = '#193744';
    ctx.fillRect(x, 52, 1, 224);
    for (let y = 64; y < 276; y += 24) ctx.fillRect(x + 14, y, 2, 2);
  }
  for (const z of r.zones) {
    ctx.fillStyle = z.g >= 200 ? '#263c46' : z.g < 120 ? '#173e48' : '#1b3943';
    ctx.fillRect(z.from, 52, z.to - z.from, 224);
    for (let x = z.from + 26; x < z.to - 8; x += 48)
      for (let y = 106; y <= 230; y += 62) {
        ctx.fillStyle = '#43626a';
        const yy = y + (s.gravity > 0 ? 0 : 6);
        ctx.fillRect(x, yy, 2, 8);
        ctx.fillRect(x - 3, s.gravity > 0 ? yy + 5 : yy, 8, 2);
      }
  }
  for (const z of r.zones.slice(0, -1)) {
    ctx.fillStyle = '#8baec0';
    for (let y = 54; y < 276; y += 12) ctx.fillRect(z.to - 1, y, 2, 5);
  }
  for (const y of [60, 268]) {
    ctx.fillStyle = '#755f4e';
    ctx.fillRect(30, y, 420, 3);
    ctx.fillStyle = '#b68a5a';
    ctx.fillRect(30, y, 420, 1);
    for (let x = 44; x < 450; x += 52) {
      ctx.fillStyle = '#374d54';
      ctx.fillRect(x, y - 2, 5, 7);
      ctx.fillStyle = '#a68257';
      ctx.fillRect(x + 1, y - 2, 2, 7);
    }
  }
  for (const x of [39, 216, 385]) {
    ctx.fillStyle = '#203f4a';
    ctx.fillRect(x, 112, 53, 63);
    ctx.strokeStyle = '#3b5356';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 112, 53, 63);
    ctx.fillStyle = '#6b6254';
    ctx.fillRect(x + 7, 120, 37, 3);
    ctx.fillRect(x + 7, 120, 3, 44);
    ctx.fillRect(x + 7, 160, 32, 3);
    ctx.fillStyle = '#9b8059';
    ctx.fillRect(x + 8, 121, 34, 1);
    ctx.fillRect(x + 8, 161, 30, 1);
    ctx.fillStyle = '#496d6b';
    ctx.fillRect(x + 17, 133, 22, 13);
    ctx.fillStyle = '#71958a';
    ctx.fillRect(x + 20, 136, 5, 3);
    ctx.fillRect(x + 29, 141, 6, 2);
  }
  ctx.fillStyle = '#6b7776';
  ctx.fillRect(16, 44, 448, 8);
  ctx.fillRect(16, 276, 448, 8);
  ctx.fillRect(16, 44, 8, 240);
  ctx.fillRect(456, 44, 8, 240);
  ctx.fillStyle = '#b08c62';
  for (let x = 24; x < 456; x += 24) {
    ctx.fillRect(x, 44, 15, 3);
    ctx.fillRect(x + 3, 281, 15, 3);
  }
  for (const w of r.walls) {
    ctx.fillStyle = '#3b535d';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = '#9a8b70';
    ctx.fillRect(w.x, w.y, 3, w.h);
    ctx.fillRect(w.x + w.w - 3, w.y, 3, w.h);
    ctx.fillStyle = '#213741';
    for (let y = w.y + 20; y < w.y + w.h; y += 32) ctx.fillRect(w.x + 3, y, w.w - 6, 2);
    ctx.fillStyle = '#c29a60';
    ctx.fillRect(w.x + 4, w.y + 4, w.w - 8, 4);
    ctx.fillRect(w.x + 4, w.y + w.h - 8, w.w - 8, 4);
  }
  for (const z of r.zones) {
    const x = (z.from + z.to) / 2;
    ctx.fillStyle = '#284e59';
    ctx.fillRect(x - 21, 46, 42, 6);
    if (r.zones.length > 1) text(ctx, `g${z.g}`, x, 54, '#9fc3c8', 14, 'center');
  }
  pad(ctx, r.source, env.t('SOURCE', '起点'), '#e8bb72', env);
  pad(ctx, r.destination, env.t('DELIVER', '终点'), '#83c79d', env);
  if (s.parcel.status === 'stored')
    crate(ctx, r.source.x, r.source.y, s.parcel.integrity, s.parcel.maxIntegrity, isGlass(s));
  if (s.parcel.status === 'delivered')
    crate(
      ctx,
      r.destination.x,
      r.destination.y,
      s.parcel.integrity,
      s.parcel.maxIntegrity,
      isGlass(s),
    );
  if (carried(s)) {
    ctx.strokeStyle = landing.kind === 'turn' ? '#87b4c7' : landing.safe ? '#82b19d' : '#d2987f';
    ctx.lineWidth = 1;
    ctx.setLineDash(landing.safe ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const point of landing.path) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = landing.kind === 'turn' ? '#87b4c7' : landing.safe ? '#82b19d' : '#d2987f';
    ctx.fillRect(landing.x - 3, landing.y - 1, 6, 2);
    if (landing.kind === 'turn') ctx.fillRect(landing.x - 1, landing.y - 3, 2, 6);
  }
  pixelSprite(
    ctx,
    [
      '..cccccc..',
      '.caaaaaac.',
      'cabbwwbbac',
      'cabbwwbbac',
      '.caaaaaac.',
      'ddccccccdd',
      'ddaeeeeadd',
      'ddaeffeadd',
      '.daeeeead.',
      '..dddddd..',
      '.d......d.',
      'ddd....ddd',
    ],
    p.x - HW,
    p.y - HH,
    2,
    {
      a: '#d69e68',
      b: '#284858',
      w: '#b5d8d5',
      c: '#8ba5a4',
      d: '#577c88',
      e: '#cb8e58',
      f: '#765344',
    },
  );
  if (carried(s)) crate(ctx, p.x, p.y + 1, s.parcel.integrity, s.parcel.maxIntegrity, isGlass(s));
  if (s.mode === 'clear' || s.mode === 'repack') {
    ctx.fillStyle = '#d8b576';
    ctx.fillRect(p.x - 13, p.y - 8, 3, 16);
    ctx.fillRect(p.x + 10, p.y - 8, 3, 16);
  }
  if (s.flash > 0) {
    ctx.strokeStyle = '#efb49a';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 13, p.y - 15, 26, 30);
  }
  ctx.fillStyle = '#102633';
  ctx.fillRect(0, 0, 480, 44);
  text(ctx, `${s.level}/${LEVEL_COUNT} ${env.t(...r.name)}`, 12, 7, '#e2c699', 14);
  text(ctx, env.t(`SPARES ${s.spares}`, `备用 ${s.spares}`), 468, 7, '#c9d3b7', 14, 'right');
  text(ctx, env.t('PACK', '包装'), 282, 7, '#c9d3b7', 14);
  const hp = s.parcel.status === 'stored' ? r.integrity : s.parcel.integrity;
  for (let i = 0; i < s.parcel.maxIntegrity; i++) {
    ctx.fillStyle = i < hp ? '#e1bf7a' : '#51474a';
    ctx.fillRect(330 + i * 17, 10, 13, 10);
  }
  text(ctx, `${env.t('FIELD', '动力场')} ${s.gravity > 0 ? '↓' : '↑'}${g}`, 12, 28, '#a7c9bf', 14);
  text(ctx, `${env.t('H', '横')} ${Math.round(Math.abs(p.vx))}`, 145, 28, '#b6c9bb', 14);
  text(ctx, `${env.t('V', '纵')} ${Math.round(Math.abs(p.vy))}`, 216, 28, '#b6c9bb', 14);
  ctx.fillStyle = '#2e4d53';
  ctx.fillRect(286, 31, 89, 9);
  ctx.fillStyle = Math.abs(p.vy) > s.parcel.safeSpeed ? '#d49c7e' : '#7fb29a';
  ctx.fillRect(286, 31, 89 * Math.min(1, Math.abs(p.vy) / 300), 9);
  ctx.fillStyle = '#f3ddad';
  ctx.fillRect(286 + (89 * s.parcel.safeSpeed) / 300, 29, 2, 13);
  text(ctx, `${env.t('SAFE', '安全')}≤${s.parcel.safeSpeed}`, 468, 28, '#c9d3b7', 14, 'right');
  ctx.fillStyle = '#102633';
  ctx.fillRect(0, 285, 480, 35);
  text(ctx, prompt(s, env), 240, 288, '#d8d8b8', 14, 'center');
  text(ctx, lowerHint(s, env), 240, 305, '#a9c2b8', 14, 'center');
  ctx.restore();
}

function drawMenu(ctx, env, menu) {
  const chosen = COURIER_ROOMS[menu.cursor - 1];
  ctx.save();
  background(ctx, '#112b39');
  text(ctx, env.t('CHOOSE A CHAMBER', '选择舱室'), 240, 12, '#e2c699', 16, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const c = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? '#264a56' : '#1a2f38';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = n === menu.cursor ? '#f3ddad' : '#3b5356';
    ctx.lineWidth = n === menu.cursor ? 3 : 1;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    text(ctx, String(n), c.x + c.w / 2, c.y + 6, open ? '#e8d6a8' : '#68807f', 18, 'center');
    text(
      ctx,
      open ? 'OK' : env.t('LOCK', '锁定'),
      c.x + c.w / 2,
      c.y + 28,
      open ? '#9fc3a6' : '#68807f',
      14,
      'center',
    );
  }
  text(
    ctx,
    `${menu.cursor}/${LEVEL_COUNT} ${env.t(...chosen.name)}`,
    240,
    258,
    '#e2c699',
    14,
    'center',
  );
  text(ctx, env.t(...chosen.tip), 240, 276, '#a9c2b8', 14, 'center');
  text(
    ctx,
    env.t('ARROWS + SPACE, OR TAP A CHAMBER', '方向键 + 空格，或点按舱室'),
    240,
    298,
    '#a7c9bf',
    14,
    'center',
  );
  ctx.restore();
}
