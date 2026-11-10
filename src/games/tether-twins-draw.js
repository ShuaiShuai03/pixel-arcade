import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { COLS, HALF, ROWS, RULES, STEP, TILE, TOP } from './tether-twins-rules.js';
import { pulseLive, pulseWarn, worldOf } from './tether-twins-world.js';
import { ROOM_COUNT } from './tether-twins-rooms.js';
import { lengthOf, onPad, pointsOf } from './tether-twins-body.js';

const COLORS = ['#ff5a4f', '#4aa8ff'];
const IDLE = ['#a8433f', '#3a76ad'];
const ROBOT = [
  '.....a.....',
  '.....o.....',
  '..ooooooo..',
  '.obbbbbbbo.',
  '.obvvvvvbo.',
  '.obvevevbo.',
  '.obvvvvvbo.',
  '.obbbbbbbo.',
  '..ooooooo..',
  '.wwwo.owww.',
  '.wwwo.owww.',
];

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

function drawFloor(ctx, w) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      box(ctx, (c + r) % 2 ? '#18233a' : '#1b2842', c * TILE, TOP + r * TILE, TILE, TILE);
  for (const r of w.walls) {
    box(ctx, '#4a5a80', r.x, r.y, r.w, r.h);
    box(ctx, '#6a7ca6', r.x, r.y, r.w, 3);
    box(ctx, '#6a7ca6', r.x + 3, r.y + 7, 2, 2);
    box(ctx, '#2d3956', r.x, r.y + r.h - 3, r.w, 3);
  }
}

function drawLive(ctx, h, phase) {
  box(ctx, '#22232b', h.x, h.y, h.w, h.h);
  for (let k = 0; k < Math.max(h.w, h.h); k += 8) {
    if (h.w >= h.h) box(ctx, '#ffd23f', h.x + k, h.y + ((k >> 3) % 2) * (h.h - 3), 4, 3);
    else box(ctx, '#ffd23f', h.x + ((k >> 3) % 2) * (h.w - 3), h.y + k, 3, 4);
  }
  if (h.w >= TILE && h.h >= TILE) {
    box(ctx, '#fff6b0', h.x + 3 + phase * 6, h.y + 4, 3, 6);
    box(ctx, '#fff6b0', h.x + 9 + phase * 3, h.y + 11, 3, 6);
  } else box(ctx, '#fff6b0', h.x + ((phase * 11) % Math.max(1, h.w - 3)), h.y, 3, Math.min(h.h, 3));
}

// A dark pulse strip: a dim hollow frame with dotted edges and no yellow, so it reads as "off" by shape too.
function drawDark(ctx, h) {
  box(ctx, '#10131c', h.x, h.y, h.w, h.h);
  for (let k = 0; k < h.w; k += 6) {
    box(ctx, '#5a6385', h.x + k, h.y, 2, 2);
    box(ctx, '#5a6385', h.x + k, h.y + h.h - 2, 2, 2);
  }
  for (let k = 0; k < h.h; k += 6) {
    box(ctx, '#5a6385', h.x, h.y + k, 2, 2);
    box(ctx, '#5a6385', h.x + h.w - 2, h.y + k, 2, 2);
  }
  box(ctx, '#3a4260', h.x + h.w / 2 - 2, h.y + h.h / 2 - 2, 4, 4);
}

function drawHazards(ctx, s, w, t) {
  const phase = Math.floor(t * 12) % 3;
  for (const h of w.hazards) {
    if (h.group < 0) drawLive(ctx, h, phase);
    else if (pulseLive(w.room.pulse, h.group, s.clock)) drawLive(ctx, h, phase);
    else if (pulseWarn(w.room.pulse, h.group, s.clock) && Math.floor(t * 14) % 2)
      drawLive(ctx, h, phase);
    else drawDark(ctx, h);
  }
}

function drawGates(ctx, s, w) {
  for (const [id, cells] of Object.entries(w.gates)) {
    const open = !!s.open[id];
    for (const c of cells) {
      if (open) {
        box(ctx, '#2f9e6a', c.x, c.y, 4, c.h);
        box(ctx, '#2f9e6a', c.x + c.w - 4, c.y, 4, c.h);
      } else {
        box(ctx, '#7a4a4a', c.x, c.y, c.w, c.h);
        for (let k = 0; k < c.h; k += 8) box(ctx, '#ffcf4a', c.x + 3, c.y + k, c.w - 6, 4);
      }
    }
    text(ctx, id, cells[0].x + 8, cells[0].y - 18, open ? '#7dffb0' : '#ffb0b0', 14);
  }
}

function drawPosts(ctx, s, w) {
  w.posts.forEach((p, i) => {
    const relay = i >= w.relayFirst;
    if (relay && s.latched[p.gate]) {
      box(ctx, '#2a4a3c', p.x, p.y, p.w, p.h);
      box(ctx, '#5dff9d', p.x + 4, p.y + 4, 8, 8);
      return;
    }
    box(ctx, '#d7deea', p.x, p.y, p.w, p.h);
    box(ctx, '#6b7a99', p.x, p.y + 4, p.w, 3);
    box(ctx, '#6b7a99', p.x, p.y + 10, p.w, 3);
    box(ctx, '#2b3550', p.x, p.y, p.w, 2);
    box(ctx, '#2b3550', p.x, p.y + p.h - 2, p.w, 2);
    if (relay) box(ctx, s.wrapped && s.taut ? '#ffe14a' : '#ff9d3f', p.x + 4, p.y + 4, 8, 8);
  });
}

function drawPlates(ctx, s, w, t) {
  w.plates.forEach((p, i) => {
    box(ctx, s.lit[i] ? '#79f5ff' : '#1f6a78', p.x, p.y, p.w, p.h);
    const mark = s.lit[i] ? '#ffffff' : '#0f3a44';
    box(ctx, mark, p.x + 8, p.y + 3, 4, 14);
    box(ctx, mark, p.x + 3, p.y + 8, 14, 4);
    if (s.lit[i] && Math.floor(t * 8) % 2) box(ctx, mark, p.x - 2, p.y - 2, 4, 4);
  });
}

function drawPads(ctx, s, w) {
  w.pads.forEach((p, i) => {
    box(ctx, COLORS[i], p.cx - 12, p.cy - 12, 24, 24);
    box(ctx, '#10182a', p.cx - 9, p.cy - 9, 18, 18);
    box(ctx, onPad(s.robots[i], p) ? '#ffffff' : COLORS[i], p.cx - 3, p.cy - 3, 6, 6);
  });
}

// Taut: thick red/white stripes. Slack: thin yellow/navy stripes with a gentle wave.
function drawCable(ctx, s, w, t) {
  const pts = pointsOf(s, w);
  const path = lengthOf(pts);
  const taut = path >= s.len - RULES.tautEps;
  const wave = taut ? 0 : Math.min(4, (s.len - path) * 0.05);
  const [a, b] = taut ? ['#ff5a4f', '#fff3a0'] : ['#ffd23f', '#2a3a5c'];
  const size = taut ? 5 : 3;
  let travelled = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1],
      q = pts[i];
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    for (let u = 0; u < d; u += 4) {
      const off = Math.sin((travelled + u) / 7 + t * (taut ? 30 : 3)) * wave;
      const x = p.x + ((q.x - p.x) * u) / d - ((q.y - p.y) / d) * off;
      const y = p.y + ((q.y - p.y) * u) / d + ((q.x - p.x) / d) * off;
      box(ctx, Math.floor((travelled + u) / 4) % 2 ? a : b, x - size / 2, y - size / 2, size, size);
    }
    travelled += d;
  }
  for (const idx of s.bends) box(ctx, '#ffffff', w.pegs[idx].x - 2, w.pegs[idx].y - 2, 4, 4);
}

function drawRobot(ctx, s, i, t) {
  const r = s.robots[i];
  const active = s.mode === 2 || s.active === i;
  const flash = s.zap && s.zap.who.includes(i) && Math.floor(t * 16) % 2;
  const body = flash ? '#ffffff' : active ? COLORS[i] : IDLE[i];
  const x = Math.round(r.x - HALF),
    y = Math.round(r.y - HALF) + (active ? Math.round(Math.sin(t * 8)) : 0);
  if (active) box(ctx, 'rgba(255,255,255,0.25)', x - 2, y + 20, 26, 4);
  const palette = { o: '#0b1020', b: body, v: '#14203a', e: '#ffffff', w: '#394560' };
  pixelSprite(ctx, ROBOT, x, y, 2, { ...palette, a: active ? '#ffe14a' : '#88aaaa' });
  if (active && s.mode !== 2) {
    box(ctx, '#ffffff', x + 9, y - 8, 4, 3);
    box(ctx, '#ffffff', x + 10, y - 5, 2, 2);
  }
}

function drawFx(ctx, s, t) {
  if (!s.zap) return;
  const reach = 6 + (0.6 - s.zap.left) * 40;
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785 + t * 10;
    box(ctx, '#fff6b0', s.zap.x + Math.cos(a) * reach, s.zap.y + Math.sin(a) * reach, 4, 4);
  }
}

// The marker is a cross; while the guide waits for a strip to go dark it is a pause sign instead.
function drawMarker(ctx, s, t) {
  const m = s.shown;
  if (s.phase !== 'playing' || m.x == null || Math.floor(t * 3) % 2) return;
  const color = m.who === 0 ? COLORS[0] : m.who === 1 ? COLORS[1] : '#ffffff';
  if (m.wait) {
    box(ctx, color, m.x - 6, m.y - 8, 4, 16);
    box(ctx, color, m.x + 2, m.y - 8, 4, 16);
    return;
  }
  box(ctx, color, m.x - 8, m.y - 1, 16, 2);
  box(ctx, color, m.x - 1, m.y - 8, 2, 16);
}

function drawHud(ctx, s, w, lang) {
  const t = s.ticks * STEP;
  box(ctx, '#0b1222', 0, 0, 480, TOP);
  box(ctx, '#0b1222', 0, RULES.bottom, 480, 320 - RULES.bottom);
  box(ctx, '#3a4a70', 0, TOP - 1, 480, 1);
  box(ctx, '#3a4a70', 0, RULES.bottom, 480, 1);
  text(ctx, `${s.room + 1}/${ROOM_COUNT} ${w.room.name[lang]}`, 8, 6, '#cfe0ff', 14);
  const path = lengthOf(pointsOf(s, w));
  const taut = path >= s.len - RULES.tautEps;
  box(ctx, '#26324f', 190, 7, 90, 12);
  box(ctx, taut ? '#ff5a4f' : '#4aa8ff', 191, 8, Math.round(88 * Math.min(1, path / s.len)), 10);
  const label = taut ? { en: 'TAUT', zh: '绷紧' } : { en: 'SLACK', zh: '松弛' };
  text(ctx, label[lang], 288, 6, taut ? '#ff9d8f' : '#9ccaff', 14);
  for (let i = 0; i < RULES.cells; i++) {
    box(ctx, i < s.cells ? '#7dffb0' : '#2a3a4a', 398 + i * 22, 7, 18, 12);
    box(ctx, '#0b1222', 416 + i * 22, 11, 2, 4);
  }
  const tip = s.tipLeft > 0 ? w.room.tip : null;
  const shown = s.msg || tip || s.shown;
  text(ctx, shown[lang], 240, 297, s.msg ? '#ffe14a' : tip ? '#9fe8ea' : '#ffffff', 14, 'center');
}

export function drawGame(ctx, s, env) {
  const w = worldOf(s.room);
  const t = s.ticks * STEP;
  background(ctx, '#0e1628');
  drawFloor(ctx, w);
  drawPads(ctx, s, w);
  drawPlates(ctx, s, w, t);
  drawHazards(ctx, s, w, t);
  drawGates(ctx, s, w);
  drawPosts(ctx, s, w);
  drawCable(ctx, s, w, t);
  drawRobot(ctx, s, 0, t);
  drawRobot(ctx, s, 1, t);
  drawFx(ctx, s, t);
  drawMarker(ctx, s, t);
  drawHud(ctx, s, w, env.lang === 'zh' ? 'zh' : 'en');
}
