import { clamp, background, drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, currentAt } from './raft-rush-levels.js';
import {
  PHYSICS as P,
  R,
  FLAG_R,
  HUD_TOP,
  HUD_BOTTOM,
  countFlags,
  objectiveOf,
} from './raft-rush-step.js';

const TAU = Math.PI * 2;
const LABEL_MARGIN = 40;
const COL = {
  water: '#1f6f9a',
  deep: '#195f88',
  shallow: '#2b86b0',
  ripple: '#4aa3cc',
  foam: '#dff4ff',
  sand: '#d9b977',
  wet: '#9c8454',
  grass: '#3b7d3c',
  dark: '#25562b',
  reed: '#6aa84f',
  cliff: '#5b6f7c',
  cliffFar: '#3d5666',
  rock: '#7b7f8a',
  rockDark: '#4d515c',
  log: '#a8642d',
  logDark: '#6e3f1b',
  rope: '#f2d16b',
  flag: '#ff5a4f',
  hud: '#0b1a2b',
  go: '#7dffa0',
  plank: '#c98f4f',
};

function poly(ctx, pts, camX, closeY, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] - camX, closeY);
  for (const [x, y] of pts) ctx.lineTo(x - camX, y);
  ctx.lineTo(pts[pts.length - 1][0] - camX, closeY);
  ctx.closePath();
  ctx.fill();
}

// Distant cliffs and tree line above the north bank, scrolling slower than the water for depth.
function drawFarShore(ctx, level, camX) {
  for (const [par, color, amp] of [
    [0.3, COL.cliffFar, 22],
    [0.55, COL.cliff, 14],
  ]) {
    ctx.fillStyle = color;
    const off = camX * par;
    for (let x = -20; x < 500; x += 10) {
      const n = Math.floor((x + off) / 10),
        wx = camX + x,
        { cy, half } = level.centre(wx),
        room = cy - half - 24 - HUD_TOP,
        h = Math.min(room, 6 + ((n * 37) % 11) * (amp / 11));
      if (h > 0) ctx.fillRect(x, HUD_TOP - 4, 10, h);
    }
  }
}

function drawBanks(ctx, level, camX, time) {
  const shift = (pts, d) => pts.map(([x, y]) => [x, y + d]);
  const sides = [
    [level.top, -1, 0],
    [level.bottom, 1, 320],
  ];
  for (const [line, dir, edge] of sides) {
    poly(ctx, shift(line, dir * 16), camX, edge, COL.dark);
    poly(ctx, shift(line, dir * 7), camX, edge, COL.grass);
    poly(ctx, shift(line, dir * 3), camX, edge, COL.sand);
    poly(ctx, line, camX, edge, COL.wet);
    ctx.strokeStyle = COL.foam;
    ctx.lineWidth = 2;
    ctx.beginPath();
    line.forEach(([x, y], i) => {
      const wob = Math.sin(time * 3 + i) * 1.5 - dir * 1;
      if (i) ctx.lineTo(x - camX, y + wob);
      else ctx.moveTo(x - camX, y + wob);
    });
    ctx.stroke();
    line.forEach(([x, y], i) => {
      const sx = x - camX;
      ctx.fillStyle = COL.reed;
      ctx.fillRect(sx - 8, y + dir * 6 - (dir < 0 ? 6 : 0), 2, 6);
      ctx.fillRect(sx - 5, y + dir * 7 - (dir < 0 ? 8 : 0), 2, 8);
      ctx.fillStyle = COL.rockDark;
      ctx.fillRect(sx + 10, y + dir * 5 - 2, 6, 4);
      ctx.fillStyle = COL.dark;
      ctx.fillRect(sx - 4, y + dir * (22 + (i % 3) * 4) - 7, 8, 14);
      ctx.fillStyle = COL.grass;
      ctx.fillRect(sx - 7, y + dir * (22 + (i % 3) * 4) - 12, 14, 7);
      ctx.fillStyle = COL.reed;
      ctx.fillRect(sx - 4, y + dir * (22 + (i % 3) * 4) - 14, 8, 4);
    });
  }
}

function drawArrow(ctx, x, y, vx, vy, phase) {
  const speed = Math.hypot(vx, vy),
    ux = vx / speed,
    uy = vy / speed,
    len = 7 + speed * 0.22,
    x0 = x - ux * (len / 2) + ux * phase * 8,
    y0 = y - uy * (len / 2) + uy * phase * 8,
    x1 = x0 + ux * len,
    y1 = y0 + uy * len;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - ux * 4 - uy * 3, y1 - uy * 4 + ux * 3);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * 4 + uy * 3, y1 - uy * 4 - ux * 3);
  ctx.stroke();
}

// Ripples drift with the current; fast water gets whitecaps.
function drawFlow(ctx, level, camX, time) {
  for (let wx = Math.floor(camX / 24) * 24; wx < camX + 504; wx += 24) {
    const { cy, half } = level.centre(wx);
    for (let wy = 34; wy < 290; wy += 22) {
      const y = wy + ((wx / 24) % 3) * 6;
      if (Math.abs(y - cy) > half - 4) continue;
      const c = currentAt(level, wx, y),
        speed = Math.hypot(c.vx, c.vy);
      if (speed < 3) continue;
      const slide = (time * speed * 0.5 + wx * 7) % 24,
        len = 4 + speed * 0.1,
        ux = c.vx / speed,
        uy = c.vy / speed,
        x = wx - camX + ux * slide - 12,
        yy = y + uy * slide;
      ctx.fillStyle = speed > 62 ? COL.foam : COL.ripple;
      ctx.fillRect(x, yy, Math.max(2, Math.abs(ux) * len), Math.max(2, 1 + Math.abs(uy) * len));
    }
  }
}

function drawWater(ctx, level, camX, time) {
  ctx.fillStyle = COL.water;
  ctx.fillRect(0, 0, 480, 320);
  for (let wx = Math.floor(camX / 52) * 52; wx < camX + 532; wx += 52) {
    const { cy, half } = level.centre(wx);
    ctx.fillStyle = COL.shallow;
    ctx.fillRect(wx - camX, cy - half, 52, 14);
    ctx.fillRect(wx - camX, cy + half - 14, 52, 14);
  }
  drawFlow(ctx, level, camX, time);
  ctx.lineWidth = 2;
  for (let wx = Math.floor(camX / 52) * 52; wx < camX + 532; wx += 52) {
    const { cy, half } = level.centre(wx);
    for (let wy = 50; wy < 290; wy += 40) {
      const y = wy + (wx % 3) * 4;
      if (Math.abs(y - cy) > half - 10) continue;
      const c = currentAt(level, wx, y),
        speed = Math.hypot(c.vx, c.vy);
      if (speed < 6) continue;
      ctx.strokeStyle = speed > 62 ? COL.foam : '#7fc4e6';
      drawArrow(ctx, wx - camX, y, c.vx, c.vy, (time * 0.8 + wx * 0.013) % 1);
    }
  }
  for (const e of level.eddies) {
    const ex = e.x - camX;
    ctx.fillStyle = 'rgba(20,70,110,0.35)';
    ctx.beginPath();
    ctx.arc(ex, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COL.foam;
    for (let a = 0; a < 4; a++) {
      const base = time * e.dir * (2.2 - a * 0.35) + a * 1.6,
        rad = e.r * (0.25 + 0.2 * a);
      ctx.beginPath();
      ctx.arc(ex, e.y, rad, base, base + 2);
      ctx.stroke();
      const tipX = ex + Math.cos(base + 2) * rad,
        tipY = e.y + Math.sin(base + 2) * rad;
      ctx.fillStyle = COL.foam;
      ctx.fillRect(tipX - 1, tipY - 1, 3, 3);
    }
  }
}

function drawRocks(ctx, level, camX, time) {
  ctx.lineWidth = 2;
  for (const r of level.rocks) {
    const x = r.x - camX;
    ctx.strokeStyle = COL.foam;
    ctx.beginPath();
    ctx.arc(x, r.y, r.r + 3 + Math.sin(time * 4 + r.x) * 1.5, 0, TAU);
    ctx.stroke();
    const flow = currentAt(level, r.x, r.y),
      speed = Math.max(8, Math.hypot(flow.vx, flow.vy));
    ctx.fillStyle = COL.foam;
    for (let k = 1; k <= 4; k++) {
      const jitter = Math.sin(time * 6 + k + r.y) * 3;
      ctx.fillRect(x + r.r + k * 7 * (speed / 40), r.y - 5 + jitter + k, 8 - k, 2);
      ctx.fillRect(x + r.r + k * 7 * (speed / 40), r.y + 5 - jitter - k, 8 - k, 2);
    }
    ctx.fillStyle = COL.rockDark;
    ctx.beginPath();
    ctx.arc(x, r.y, r.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = COL.rock;
    ctx.beginPath();
    ctx.arc(x - 2, r.y - 2, r.r - 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a7abb6';
    ctx.fillRect(x - 6, r.y - 7, 5, 3);
  }
}

function drawFlags(ctx, level, s, camX, time) {
  ctx.strokeStyle = COL.rope;
  level.flags.forEach((f, i) => {
    if (s.got[i]) return;
    const x = f.x - camX,
      bob = Math.sin(time * 3 + i) * 2;
    ctx.fillStyle = COL.logDark;
    ctx.fillRect(x - 1, f.y - 12 + bob, 3, 24);
    ctx.fillStyle = COL.flag;
    ctx.fillRect(x + 2, f.y - 12 + bob, 12, 8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 2, f.y - 12 + bob, 12, 2);
    ctx.beginPath();
    ctx.arc(x, f.y, FLAG_R + 2, 0, TAU);
    ctx.stroke();
  });
}

// Wooden landing: planked quays along both banks, posts, a sign and the end pier.
function drawDock(ctx, level, s, camX, t) {
  const { x0, x1 } = level.dock,
    open = countFlags(s) >= level.need,
    mid = level.centre((x0 + x1) / 2),
    a = x0 - camX,
    b = x1 - camX,
    top = mid.cy - mid.half,
    bottom = mid.cy + mid.half;
  ctx.fillStyle = open ? 'rgba(120,255,160,0.28)' : 'rgba(255,255,255,0.12)';
  ctx.fillRect(a, top + 6, b - a, mid.half * 2 - 12);
  ctx.strokeStyle = open ? COL.go : '#cfd8e0';
  ctx.lineWidth = 2;
  ctx.strokeRect(a, top + 6, b - a, mid.half * 2 - 12);
  for (const [y, h] of [
    [top - 2, 10],
    [bottom - 8, 10],
  ]) {
    for (let x = x0 - 24; x < level.length; x += 8) {
      ctx.fillStyle = (x / 8) % 2 ? COL.plank : '#b57d3f';
      ctx.fillRect(x - camX, y, 8, h);
    }
    for (let x = x0 - 24; x <= level.length; x += 40) {
      ctx.fillStyle = COL.logDark;
      ctx.fillRect(x - camX - 2, y - 3, 5, h + 6);
    }
  }
  const start = level.centre(0);
  ctx.fillStyle = COL.log;
  ctx.fillRect(-camX - 14, start.cy - start.half - 8, 14, start.half * 2 + 16);
  ctx.fillStyle = COL.log;
  ctx.fillRect(level.length - camX, top - 8, 14, mid.half * 2 + 16);
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(level.length - camX + 12, top - 8, 2, mid.half * 2 + 16);
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(a - 3, top - 18, 4, 26);
  ctx.fillStyle = open ? COL.go : COL.flag;
  ctx.fillRect(a + 1, top - 18, 22, 10);
  if ((a + b) / 2 > LABEL_MARGIN && (a + b) / 2 < 480 - LABEL_MARGIN) {
    text(
      ctx,
      open ? t('DOCK', '码头') : t('LOCKED', '未开放'),
      (a + b) / 2,
      mid.cy - 8,
      '#fff',
      14,
      'center',
    );
  }
  ctx.fillStyle = COL.go;
  ctx.fillRect(a, bottom - 22, (b - a) * Math.min(1, s.dockTimer / P.dockTime), 6);
}

// The raft flexes with its speed and tilts with its heading; a V wake and foam trail follow the water-relative motion.
function drawRaft(ctx, s, camX, time) {
  const level = LEVELS[s.index],
    w = currentAt(level, s.x, s.y),
    rx = s.vx - w.vx,
    ry = s.vy - w.vy,
    relSpeed = Math.hypot(rx, ry),
    x = s.x - camX,
    y = s.y + Math.sin(time * 5) * 1.2,
    blink = s.invulnerable > 0 && Math.floor(time * 12) % 2 === 0;
  if (relSpeed > 12) {
    const ux = rx / relSpeed,
      uy = ry / relSpeed;
    ctx.fillStyle = COL.foam;
    for (let k = 1; k <= 6; k++) {
      const d = R + k * (5 + relSpeed * 0.06),
        spread = k * 1.8;
      for (const side of [-1, 1]) {
        ctx.fillRect(
          x - ux * d - uy * spread * side,
          y - uy * d + ux * spread * side,
          4 - (k > 3 ? 1 : 0),
          2,
        );
      }
    }
    ctx.fillRect(x + ux * (R + 2) - 3, y + uy * (R + 2) - 1, 6, 2);
  }
  if (blink) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(clamp(ry / 260, -0.3, 0.3) + clamp(rx / 900, -0.1, 0.1));
  ctx.fillStyle = 'rgba(0,30,50,0.35)';
  ctx.fillRect(-R - 2, R - 3, 2 * R + 4, 4);
  const flex = Math.min(3, relSpeed / 30);
  for (let i = 0; i < 4; i++) {
    const bend = Math.sin(time * 6 + i * 1.3) * flex * 0.5;
    ctx.fillStyle = i % 2 ? COL.log : '#bd7436';
    ctx.fillRect(-R, -R + i * 6 + bend, 2 * R, 6);
    ctx.fillStyle = COL.logDark;
    ctx.fillRect(-R, -R + i * 6 + 5 + bend, 2 * R, 1);
    ctx.fillStyle = '#d9954f';
    ctx.fillRect(R - 3, -R + i * 6 + 1 + bend, 3, 3);
  }
  ctx.fillStyle = COL.rope;
  ctx.fillRect(-7, -R, 3, 2 * R);
  ctx.fillRect(3, -R, 3, 2 * R);
  // Paddler: body, head with hat and a paddle that swings during a stroke.
  ctx.fillStyle = '#2f5fa8';
  ctx.fillRect(-5, -4, 9, 8);
  ctx.fillStyle = '#f2c9a0';
  ctx.fillRect(-3, -9, 6, 5);
  ctx.fillStyle = '#e0453a';
  ctx.fillRect(-4, -11, 8, 3);
  const swing = s.stroke > 0 ? Math.sin((1 - s.stroke / P.strokeTime) * Math.PI) : 0,
    reach = 8 + swing * 8,
    dip = swing * 7;
  ctx.fillStyle = COL.logDark;
  ctx.fillRect(4, 0, reach, 2);
  ctx.fillStyle = '#d9a35f';
  ctx.fillRect(4 + reach, -2 + dip * 0.2, 5, 6);
  if (s.stroke > 0 || s.bump > 0) {
    ctx.fillStyle = s.bump > 0 ? '#ffe28a' : COL.foam;
    ctx.fillRect(-R - 8, 4, 8, 3);
    ctx.fillRect(R + 4 + reach - 8, 6 + dip, 8, 3);
  }
  ctx.restore();
}

function drawHud(ctx, s, t) {
  const level = LEVELS[s.index],
    n = countFlags(s),
    goal = s.tip > 0 ? level.tip : objectiveOf(s),
    ready = s.stamina >= P.strokeCost;
  ctx.fillStyle = COL.hud;
  ctx.fillRect(0, 0, 480, HUD_TOP - 4);
  ctx.fillRect(0, HUD_BOTTOM, 480, 320 - HUD_BOTTOM);
  text(
    ctx,
    t(`Level ${s.index + 1}/${LEVEL_COUNT}`, `第 ${s.index + 1}/${LEVEL_COUNT} 关`),
    8,
    4,
    '#fff',
    14,
  );
  text(
    ctx,
    t(
      `Flags ${n}/${level.flags.length} (need ${level.need})`,
      `旗帜 ${n}/${level.flags.length}（需 ${level.need}）`,
    ),
    112,
    4,
    n >= level.need ? COL.go : '#ffe28a',
    14,
  );
  ctx.fillStyle = '#44526a';
  ctx.fillRect(278, 7, 80, 8);
  ctx.fillStyle = ready ? COL.go : '#ffb347';
  ctx.fillRect(278, 7, 80 * (s.stamina / P.staminaMax), 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(278 + 80 * (P.strokeCost / P.staminaMax), 5, 2, 12);
  text(ctx, ready ? t('Ready', '就绪') : t('Rest', '蓄力'), 364, 6, ready ? COL.go : '#ffb347', 10);
  for (let i = 0; i < P.hull; i++) {
    ctx.fillStyle = COL.flag;
    ctx.fillRect(416 + i * 20, 5, 14, 12);
    if (i >= s.hull) {
      ctx.fillStyle = COL.hud;
      ctx.fillRect(418 + i * 20, 7, 10, 8);
    }
  }
  text(ctx, t(goal.en, goal.zh), 8, 298, '#fff', 12);
}

export function drawScene(ctx, s, t) {
  const level = LEVELS[s.index];
  background(ctx, COL.deep);
  drawWater(ctx, level, s.camX, s.t);
  drawDock(ctx, level, s, s.camX, t);
  drawBanks(ctx, level, s.camX, s.t);
  drawFarShore(ctx, level, s.camX);
  drawRocks(ctx, level, s.camX, s.t);
  drawFlags(ctx, level, s, s.camX, s.t);
  drawRaft(ctx, s, s.camX, s.t);
  drawHud(ctx, s, t);
}
