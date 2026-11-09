// Neon Snake board drawing: floor, terrain, fruit and the snake itself.
import { background, drawPixelText as text } from '../shared/utils.js';
import { COLS, ROWS } from './neon-snake-levels.js';
import { isGateOpen } from './neon-snake-rules.js';

export const CELL = 20;
export const TOP = 40;
// floor, grid line, stone edge, stone face, fruit colour per theme.
const THEMES = [
  ['#123a35', '#193f39', '#2d5547', '#355c46', '#ffc264'],
  ['#1c3445', '#243d4b', '#3b5961', '#4e6b70', '#d7bb72'],
  ['#173b44', '#21434d', '#375e64', '#557778', '#e7ad7b'],
  ['#1b3040', '#25404f', '#41606a', '#5b7b82', '#f0b38c'],
];

export function arrow(ctx, x, y, d, color, size = 5) {
  const px = -d.y,
    py = d.x;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - d.x * size, y - d.y * size);
  ctx.lineTo(x + d.x * size, y + d.y * size);
  ctx.moveTo(x + d.x * size - px * 3 - d.x * 3, y + d.y * size - py * 3 - d.y * 3);
  ctx.lineTo(x + d.x * size, y + d.y * size);
  ctx.lineTo(x + d.x * size + px * 3 - d.x * 3, y + d.y * size + py * 3 - d.y * 3);
  ctx.stroke();
}

function fruit(ctx, p, color) {
  const x = p.x * CELL,
    y = p.y * CELL + TOP;
  ctx.fillStyle = '#0b272f';
  ctx.fillRect(x + 3, y + 6, 15, 12);
  ctx.fillRect(x + 5, y + 3, 11, 16);
  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 7, 15, 8);
  ctx.fillRect(x + 5, y + 5, 11, 12);
  ctx.fillStyle = '#f8f1bb';
  ctx.fillRect(x + 6, y + 6, 4, 4);
  ctx.fillStyle = '#cb7856';
  ctx.fillRect(x + 8, y + 14, 7, 2);
  ctx.fillStyle = '#8bd3a3';
  ctx.fillRect(x + 10, y + 1, 2, 5);
  ctx.fillRect(x + 12, y + 2, 5, 3);
  ctx.fillStyle = '#fff0b5';
  ctx.fillRect(x + 1, y + 10, 2, 3);
  ctx.fillRect(x + 18, y + 9, 1, 4);
}

function floorTile(ctx, theme, x, y) {
  const px = x * CELL,
    py = y * CELL + TOP;
  ctx.strokeStyle = THEMES[theme][1];
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, 19, 19);
  if (theme === 0 && (x * 7 + y * 11) % 13 === 0) {
    ctx.fillStyle = '#397352';
    ctx.fillRect(px + 5, py + 13, 2, 4);
    ctx.fillRect(px + 8, py + 11, 2, 5);
  } else if (theme === 1 && (x + y) % 4 === 0) {
    ctx.fillStyle = '#36535d';
    ctx.fillRect(px + 3, py + 14, 5, 1);
    ctx.fillRect(px + 8, py + 9, 1, 6);
  } else if (theme >= 2 && (x * 3 + y) % 7 === 0) {
    ctx.fillStyle = '#3c6670';
    ctx.fillRect(px + 3, py + 8, 8, 1);
    ctx.fillRect(px + 8, py + 12, 7, 1);
  }
}

function underpass(ctx, p) {
  const x = p.x * CELL,
    y = p.y * CELL + TOP;
  ctx.fillStyle = '#456b69';
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = '#769c89';
  ctx.fillRect(x, y + 1, CELL, 2);
  ctx.fillRect(x, y + 17, CELL, 2);
  arrow(ctx, x + 5, y + 10, { x: -1, y: 0 }, '#9db9a1', 3);
  arrow(ctx, x + 15, y + 10, { x: 1, y: 0 }, '#9db9a1', 3);
}

function rock(ctx, theme, r) {
  const x = r.x * CELL,
    y = r.y * CELL + TOP,
    [, , edge, face] = THEMES[theme];
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, 20, 20);
  ctx.fillStyle = '#769486';
  ctx.fillRect(x + 1, y + 1, 18, 2);
  ctx.fillStyle = '#122c37';
  ctx.fillRect(x + 1, y + 17, 18, 3);
  ctx.fillStyle = face;
  ctx.fillRect(x + 2, y + 4, 16, 12);
  if (theme === 0) {
    ctx.fillStyle = '#68a366';
    ctx.fillRect(x + 4, y + 3, 5, 5);
    ctx.fillRect(x + 11, y + 5, 5, 6);
    ctx.fillStyle = '#95bd78';
    ctx.fillRect(x + 5, y + 4, 2, 2);
    return;
  }
  ctx.fillStyle = '#1e3c46';
  ctx.fillRect(x + 2, y + 10, 16, 2);
  ctx.fillRect(x + 8, y + 4, 2, 6);
  ctx.fillStyle = '#87a899';
  ctx.fillRect(x + 12, y + 6, 3, 2);
}

function gate(ctx, s, g) {
  const x = g.x * CELL,
    y = g.y * CELL + TOP,
    open = isGateOpen(s, g),
    scheduled = Math.floor(s.stageSteps / s.gatePeriod) % 2 === g.group;
  ctx.fillStyle = '#122b37';
  ctx.fillRect(x, y, 20, 20);
  ctx.fillStyle = open ? '#85bda5' : '#c6a082';
  ctx.fillRect(x, y, 3, 20);
  ctx.fillRect(x + 17, y, 3, 20);
  if (open) {
    ctx.fillStyle = '#466f65';
    ctx.fillRect(x + 4, y + 2, 12, 2);
    ctx.fillRect(x + 4, y + 16, 12, 2);
  } else {
    ctx.fillStyle = '#b98b7f';
    for (let k = 5; k < 17; k += 5) ctx.fillRect(x + k, y + 2, 2, 16);
    ctx.fillStyle = '#ead3a6';
    ctx.fillRect(x + 7, y + 8, 6, 4);
  }
  text(ctx, g.label, x + 10, y + 4, open ? '#a9d4b5' : '#233e48', 10, 'center');
  if (open && !scheduled) {
    ctx.fillStyle = '#f0d7a1';
    ctx.fillRect(x + 1, y + 1, 4, 4);
    ctx.fillRect(x + 15, y + 15, 4, 4);
  }
}

function snakeBody(ctx, s) {
  const last = s.snake.length - 1;
  // All body links join adjacent cell centers; no segment jumps through space.
  ctx.strokeStyle = '#79be9b';
  ctx.lineWidth = 12;
  ctx.beginPath();
  for (let n = last; n >= 0; n--) {
    const p = s.snake[n];
    if (n === last) ctx.moveTo(p.x * CELL + 10, p.y * CELL + TOP + 10);
    else ctx.lineTo(p.x * CELL + 10, p.y * CELL + TOP + 10);
  }
  ctx.stroke();
  for (let n = last; n >= 0; n--) {
    const p = s.snake[n],
      x = p.x * CELL,
      y = p.y * CELL + TOP,
      cx = x + 10,
      cy = y + 10;
    ctx.strokeStyle = '#315f50';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 19, 19);
    if (n === last && n > 0) {
      const next = s.snake[n - 1],
        dx = next.x - p.x,
        dy = next.y - p.y;
      ctx.fillStyle = '#78b68e';
      ctx.beginPath();
      ctx.moveTo(cx - dx * 7, cy - dy * 7);
      ctx.lineTo(cx + dx * 4 - dy * 5, cy + dy * 4 + dx * 5);
      ctx.lineTo(cx + dx * 4 + dy * 5, cy + dy * 4 - dx * 5);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    ctx.fillStyle = n === 0 ? (s.flash > 0 ? '#f1f3b6' : '#c3e995') : n % 2 ? '#68b995' : '#80c79d';
    ctx.fillRect(x + 4, y + 2, 12, 16);
    ctx.fillRect(x + 2, y + 4, 16, 12);
    ctx.fillStyle = '#326e5c';
    ctx.fillRect(x + 4, y + 14, 12, 2);
    if (n) {
      ctx.fillStyle = '#abd4a0';
      ctx.fillRect(x + 8, y + 6, 4, 2);
      ctx.fillRect(x + 6, y + 8, 2, 4);
      ctx.fillRect(x + 12, y + 8, 2, 4);
      ctx.fillRect(x + 8, y + 12, 4, 2);
    } else head(ctx, s.direction, cx, cy);
  }
}

function head(ctx, d, cx, cy) {
  const px = -d.y,
    py = d.x;
  ctx.fillStyle = '#14323b';
  for (const side of [-1, 1])
    ctx.fillRect(
      Math.round(cx + d.x * 3 + px * side * 4) - 2,
      Math.round(cy + d.y * 3 + py * side * 4) - 2,
      4,
      4,
    );
  ctx.fillStyle = '#fff5c9';
  for (const side of [-1, 1])
    ctx.fillRect(
      Math.round(cx + d.x * 4 + px * side * 4) - 1,
      Math.round(cy + d.y * 4 + py * side * 4) - 1,
      2,
      2,
    );
  ctx.fillStyle = '#3a6b52';
  ctx.fillRect(cx + d.x * 7 - 1, cy + d.y * 7 - 1, 2, 2);
}

function effects(ctx, s) {
  for (const e of s.celebration) {
    const spread = (0.35 - e.life) * 20;
    ctx.fillStyle = '#f5dfa1';
    for (let n = 0; n < 4; n++)
      ctx.fillRect(
        e.x * CELL + 9 + Math.cos((n * Math.PI) / 2) * (8 + spread),
        e.y * CELL + TOP + 9 + Math.sin((n * Math.PI) / 2) * (8 + spread),
        2,
        2,
      );
  }
  if (!s.crash) return;
  const x = Math.max(0, Math.min(COLS - 1, s.crash.x)) * CELL,
    y = Math.max(0, Math.min(ROWS - 1, s.crash.y)) * CELL + TOP;
  ctx.strokeStyle = '#e0a08b';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, 18, 18);
  ctx.beginPath();
  ctx.moveTo(x + 5, y + 5);
  ctx.lineTo(x + 15, y + 15);
  ctx.moveTo(x + 15, y + 5);
  ctx.lineTo(x + 5, y + 15);
  ctx.stroke();
}

function queuedTurn(ctx, s) {
  if (!s.queue.length || s.betweenGardens) return;
  const p = s.snake[0],
    d = s.queue[0],
    x = (p.x + d.x) * CELL,
    y = (p.y + d.y) * CELL + TOP;
  if (x < 0 || x >= 480 || y < TOP || y >= 320) return;
  ctx.strokeStyle = '#92bccc';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1, y + 1, 18, 18);
  arrow(ctx, x + 10, y + 10, d, '#9dc9cd', 4);
}

export function drawBoard(ctx, s, theme) {
  background(ctx, '#102530');
  ctx.fillStyle = THEMES[theme][0];
  ctx.fillRect(0, TOP, 480, 280);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) floorTile(ctx, theme, x, y);
  for (const p of s.underpasses) underpass(ctx, p);
  for (const r of s.rocks) rock(ctx, theme, r);
  for (const g of s.gates) gate(ctx, s, g);
  if (s.food) fruit(ctx, s.food, THEMES[theme][4]);
  queuedTurn(ctx, s);
  snakeBody(ctx, s);
  effects(ctx, s);
  ctx.strokeStyle = '#6c9588';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, TOP + 1, 478, 278);
}
