// Meteor Drift rendering: the field, the pilot, the HUD and the opening lesson.
import { drawPixelText, background } from '../shared/utils.js';
import { WIDTH, HEIGHT } from './meteor-drift-math.js';
import { LEVELS, LEVEL_COUNT } from './meteor-drift-levels.js';
import { rockRadius } from './meteor-drift-physics.js';
import { HULL_RADIUS, MAX_HULL } from './meteor-drift-step.js';
import { drawSelect, wrapText } from './meteor-drift-menu.js';

const TIP_SIZE = 11;
const TIP_TOP = 277;
const TIP_LINE = 12;
const BURST_COOLDOWN = 7;

function drawRock(ctx, r) {
  const rad = rockRadius(r),
    unit = rad > 20 ? 3 : 2;
  const colors =
    r.kind === 'ice'
      ? ['#d7f5f1', '#517d9b', '#8dc4d6']
      : r.kind === 'iron'
        ? ['#d1ccce', '#505b72', '#929ba5']
        : r.kind === 'volatile'
          ? ['#f4cc89', '#8d514b', '#bd7a58']
          : ['#cab894', '#53605f', '#899783'];
  for (let y = -rad; y < rad; y += unit)
    for (let x = -rad; x < rad; x += unit) {
      if ((x + unit / 2) ** 2 + (y + unit / 2) ** 2 > (rad - unit / 2) ** 2) continue;
      ctx.fillStyle =
        r.flash > 0
          ? '#eff5d4'
          : x + y < -rad * 0.25
            ? colors[0]
            : x + y > rad * 0.4
              ? colors[1]
              : colors[2];
      ctx.fillRect(Math.round(r.x + x), Math.round(r.y + y), unit, unit);
    }
  ctx.fillStyle = '#565f5b';
  const crater = rad > 20 ? 5 : rad > 12 ? 4 : 3;
  ctx.fillRect(Math.round(r.x - rad * 0.35), Math.round(r.y - rad * 0.2), crater * 2, crater);
  if (r.kind === 'iron') {
    ctx.fillStyle = '#e5d5b7';
    ctx.fillRect(r.x - rad * 0.5, r.y + rad * 0.15, rad, 2);
    if (r.hp > 1) {
      ctx.fillRect(r.x - 5, r.y - 3, 3, 3);
      ctx.fillRect(r.x + 2, r.y - 3, 3, 3);
    }
  }
  if (r.kind === 'ice') {
    ctx.fillStyle = '#e8ffff';
    ctx.fillRect(r.x - 1, r.y - rad * 0.65, 2, rad * 1.2);
    ctx.fillRect(r.x - rad * 0.4, r.y, rad * 0.8, 2);
  }
  if (r.kind === 'volatile') {
    const flash = r.fuse !== undefined && Math.floor(r.fuse * 16) % 2 === 0;
    ctx.fillStyle = flash ? '#fff4c0' : '#ff865e';
    ctx.fillRect(r.x - 4, r.y - 4, 8, 8);
    ctx.fillStyle = '#56333d';
    ctx.fillRect(r.x - 2, r.y - 2, 4, 4);
    if (r.fuse !== undefined) {
      ctx.strokeStyle = '#ffc98a';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - rad - 3, r.y - rad - 3, rad * 2 + 6, rad * 2 + 6);
    }
  }
}
function drawShip(ctx, ship, thrust, time) {
  const cos = Math.cos(ship.angle),
    sin = Math.sin(ship.angle);
  const local = (x, y) => ({ x: ship.x + x * cos - y * sin, y: ship.y + x * sin + y * cos });
  for (let y = -8; y <= 8; y += 3)
    for (let x = -8; x <= 13; x += 3) {
      if (x > 12 - Math.abs(y) * 1.7 || x < -6 + Math.abs(y) * 0.1) continue;
      const p = local(x, y);
      ctx.fillStyle = Math.abs(y) < 3 ? '#f6efca' : '#8cd7d7';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
    }
  if (thrust) {
    for (let i = 0; i < 3; i++) {
      const p = local(-12 - i * 3, i % 2 ? 2 : -2);
      ctx.fillStyle = i === 0 ? '#ffd173' : '#ed8155';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3 + (Math.floor(time * 20) % 2));
    }
  }
}
function wrappedPositions(entity, extent) {
  const xs = [entity.x],
    ys = [entity.y];
  if (entity.x < extent) xs.push(entity.x + WIDTH);
  if (entity.x > WIDTH - extent) xs.push(entity.x - WIDTH);
  if (entity.y < extent) ys.push(entity.y + HEIGHT);
  if (entity.y > HEIGHT - extent) ys.push(entity.y - HEIGHT);
  return xs.flatMap((x) => ys.map((y) => ({ ...entity, x, y })));
}
export function drawWrappedRock(ctx, rock) {
  for (const copy of wrappedPositions(rock, rockRadius(rock))) drawRock(ctx, copy);
}
export function drawWrappedShip(ctx, ship, thrust, time) {
  for (const copy of wrappedPositions(ship, 23)) drawShip(ctx, copy, thrust, time);
}
function drawSky(ctx) {
  background(ctx, '#0b1727');
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = i % 8 ? '#2d4054' : '#9eafbd';
    ctx.fillRect((i * 113) % WIDTH, (i * 67) % HEIGHT, i % 8 ? 1 : 2, 1);
  }
  ctx.fillStyle = '#152d3b';
  for (let y = -50; y < 45; y += 4)
    for (let x = -48; x < 48; x += 4)
      if (x * x + y * y < 44 * 44) ctx.fillRect(415 + x, 285 + y, 4, 4);
  ctx.fillStyle = '#1e3a44';
  ctx.fillRect(401, 270, 40, 8);
  ctx.fillRect(385, 287, 46, 5);
}
function drawRocks(ctx, rocks) {
  for (const r of rocks)
    for (const copy of wrappedPositions(r, rockRadius(r) + 5)) {
      drawRock(ctx, copy);
      if ((r.birth ?? 0) > 0) {
        ctx.strokeStyle = '#8ad3cd';
        ctx.lineWidth = 1;
        const box = rockRadius(r) + 4;
        ctx.strokeRect(copy.x - box, copy.y - box, box * 2, box * 2);
      }
    }
}
function drawShots(ctx, shots) {
  for (const b of shots)
    for (const copy of wrappedPositions(b, (b.radius ?? 2) + 2)) {
      ctx.fillStyle = b.charged ? '#ffd695' : '#c4f7ec';
      const r = b.radius ?? 2;
      ctx.fillRect(Math.round(copy.x - r), Math.round(copy.y - r), r * 2, r * 2);
    }
}
function drawHullRing(ctx, s) {
  for (const copy of wrappedPositions(s.ship, HULL_RADIUS + 3)) {
    ctx.strokeStyle = s.impactFlash > 0 ? '#ffd59b' : s.invulnerable > 0 ? '#99e9db' : '#496f83';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(copy.x, copy.y, HULL_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    if (s.turning) {
      ctx.fillStyle = '#92d8eb';
      ctx.fillRect(copy.x - 12, copy.y - 9 * s.turning, 3, 3);
      ctx.fillRect(copy.x + 10, copy.y + 9 * s.turning, 3, 3);
    }
    if (s.braking) {
      ctx.fillStyle = '#82e0ef';
      for (const [dx, dy] of [
        [-17, 0],
        [15, 0],
        [0, -17],
        [0, 15],
      ])
        ctx.fillRect(copy.x + dx, copy.y + dy, 3, 3);
    }
  }
}
function drawHud(ctx, s, env) {
  ctx.fillStyle = '#0b1727bb';
  ctx.fillRect(0, 0, WIDTH, 42);
  drawPixelText(
    ctx,
    env.t('SECTOR', '星区') + ' ' + s.level + '/' + LEVEL_COUNT,
    10,
    7,
    '#b4dbd2',
    11,
  );
  drawPixelText(ctx, env.t('SHIPS', '飞船') + ' ' + s.lives, 470, 7, '#f1cf94', 11, 'right');
  drawPixelText(
    ctx,
    env.t('HULL', '船体') + ' ' + '▮'.repeat(Math.max(0, Math.min(MAX_HULL, s.hull))),
    240,
    7,
    '#a9e2b0',
    10,
    'center',
  );
  const ammo =
    s.reload > 0
      ? env.t('RELOAD ', '装填 ') + s.reload.toFixed(1) + 's'
      : env.t('AMMO ', '弹药 ') + s.ammo;
  drawPixelText(
    ctx,
    ammo + ' · ' + env.t('RES ', '储备 ') + s.reserve,
    10,
    25,
    s.ammo < 5 ? '#ffb37c' : '#99bbc5',
    10,
  );
  const charge =
    s.pulseCooldown > 0
      ? Math.ceil((1 - s.pulseCooldown / BURST_COOLDOWN) * 100) + '%'
      : env.t('READY', '就绪');
  drawPixelText(ctx, env.t('BURST ', '蓄能弹 ') + charge, 470, 25, '#e5c595', 10, 'right');
}
function drawLesson(ctx, s, env) {
  const lang = env.t('en', 'zh'),
    sector = LEVELS[s.level - 1];
  drawPixelText(ctx, sector.name[lang], 240, 262, '#e5d4b0', 12, 'center');
  wrapText(sector.tip[lang], TIP_SIZE).forEach((line, i) =>
    drawPixelText(ctx, line, 240, TIP_TOP + i * TIP_LINE, '#cbd8ce', TIP_SIZE, 'center'),
  );
}
export function drawMeteors(ctx, s, env, menu) {
  if (menu) return drawSelect(ctx, env, menu);
  drawSky(ctx);
  drawRocks(ctx, s.rocks);
  drawShots(ctx, s.shots);
  for (const p of s.particles) {
    ctx.fillStyle = p.life > 0.3 ? '#ffc47d' : '#bf7459';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
  }
  drawWrappedShip(ctx, s.ship, s.thrusting, s.time);
  drawHullRing(ctx, s);
  drawHud(ctx, s, env);
  if (s.banner > 0) drawLesson(ctx, s, env);
}
