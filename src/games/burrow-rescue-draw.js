// Drawing: the mine, actors, cracks, banner and HUD, all in 480x320 pixel art.
import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { LEVEL_COUNT } from './burrow-rescue-levels.js';
import {
  FIELD_BOTTOM,
  RULES,
  COLS,
  ROWS,
  STEP,
  TILE,
  TOP,
  actorPos,
  drainRate,
  followers,
  fuseTicks,
  levelOf,
} from './burrow-rescue-map.js';
import { wrapText } from './burrow-rescue-menu.js';
import { shownPrompt, warnings } from './burrow-rescue-view.js';

// The level banner sits over rows 1-2, clear of the lift row and of the first miner pockets.
export const BANNER = { x: 40, y: TOP + TILE, w: 400, h: 48, size: 12 };
const STRATA =
  '#7a5238 #6f4a33 #654230 #5b3b2b #523526 #493021 #402a1d #38251a #302016 #2a1c14'.split(' ');
// Sprite keys: helmet, lamp, boots/brim, skin, eyes, suit, vest stripe.
const palette = (list) => Object.fromEntries(list.split(' ').map((c, i) => ['hlbsecv'[i], c]));
const PLAYER_ROWS = [
  '...hhhh...',
  '..hhhhhh..',
  '..hhhhhhl.',
  '.bbbbbbbb.',
  '..ssesse..',
  '..ssssss..',
  '.cccccccc.',
  '.ccvvvvcc.',
  '.ccvvvvcc.',
  '.sscccc.ss',
  '..cc..cc..',
  '..bb..bb..',
];
const PLAYER_STEP = [...PLAYER_ROWS.slice(0, 10), '.cc....cc.', '.bb....bb.'];
const PLAYER_PALETTE = palette('#f2c230 #fff6a8 #7a4a1a #f0c19c #1d1d1d #2f6fb3 #e8e8e8');
const MINER_PALETTE = palette('#e9772e #9dffb0 #5a3a24 #d9a07c #1d1d1d #b8452c #f2d49a');
const mirror = (rows) => rows.map((row) => [...row].reverse().join(''));

// Headframe and cage: the goal of every level. Flashes green while miners board.
function drawLift(ctx, x, y, flash) {
  const lit = flash > 0 && (flash >> 3) % 2 === 0;
  ctx.fillStyle = lit ? '#7dffa0' : '#9aa4b2';
  ctx.fillRect(x, y, 3, TILE - 4);
  ctx.fillRect(x + TILE - 3, y, 3, TILE - 4);
  ctx.fillRect(x, y, TILE, 3);
  ctx.fillStyle = lit ? '#3fbf6a' : '#d9a82a';
  ctx.fillRect(x + 3, y + 3, TILE - 6, 3);
  ctx.fillStyle = '#5a6270';
  ctx.fillRect(x + 11, y + 6, 2, TILE - 12);
  ctx.fillStyle = '#d9a82a';
  ctx.fillRect(x + 2, y + TILE - 7, TILE - 4, 4);
  ctx.fillStyle = '#222';
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 4 + k * 7, y + TILE - 7, 3, 4);
}

function drawTile(ctx, ch, x, y, r, c, boardFlash) {
  const seed = (c * 31 + r * 17) % 7;
  if (r === 0) {
    ctx.fillStyle = '#2a4a72';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#4f8a3c';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
    if (ch === 'L') drawLift(ctx, x, y, boardFlash);
    return;
  }
  if (ch === 'R') {
    ctx.fillStyle = '#5d6670';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7a8591';
    ctx.fillRect(x + 2, y + 2, 9, 7);
    ctx.fillRect(x + 12, y + 11, 9, 8);
    ctx.fillStyle = '#434a53';
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
    ctx.fillRect(x + TILE - 2, y, 2, TILE);
  } else if (ch === 'E' || ch === 'W') {
    ctx.fillStyle = ch === 'W' ? '#b08a58' : STRATA[(r - 1) % STRATA.length];
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = ch === 'W' ? '#d8b878' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 3 + seed, y + 4, 3, 2);
    ctx.fillRect(x + 14 - seed, y + 13, 3, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 6, y + 18 - seed / 2, 4, 2);
    if (ch === 'W') {
      ctx.fillStyle = '#7a5a34';
      ctx.fillRect(x + 4, y + 10, 2, 2);
      ctx.fillRect(x + 16, y + 6, 2, 2);
    }
  } else if (ch === 'B') {
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7d6a58';
    ctx.fillRect(x + 2, y + 12, 9, 10);
    ctx.fillRect(x + 11, y + 8, 10, 14);
    ctx.fillStyle = '#9a8570';
    ctx.fillRect(x + 4, y + 13, 4, 3);
    ctx.fillRect(x + 13, y + 10, 4, 3);
  } else {
    ctx.fillStyle = ch === 'T' ? '#1c2438' : '#2b1c15';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = ch === 'T' ? '#2c3650' : '#3d2a1e';
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(x, y, TILE, 3);
  }
  if (ch === 'P') {
    ctx.fillStyle = '#c58a3d';
    ctx.fillRect(x + 1, y, 5, TILE - 3);
    ctx.fillRect(x + TILE - 6, y, 5, TILE - 3);
    ctx.fillRect(x, y, TILE, 6);
    ctx.fillStyle = '#8a5a22';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 3, y + 3 + k * 5, 1, 3);
    for (let k = 0; k < 4; k++) ctx.fillRect(x + TILE - 4, y + 5 + k * 5, 1, 3);
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 2 + k * 4, y + 1 + (k % 2) * 2, 2, 1);
    ctx.fillStyle = '#e8b86a';
    ctx.fillRect(x + 1, y, 1, TILE - 3);
    ctx.fillRect(x + TILE - 6, y, 1, TILE - 3);
    for (let k = 0; k < 8; k++) ctx.fillRect(x + 6 + k, y + 6 + k, 2, 2);
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(x + 3, y + 2, 2, 2);
    ctx.fillRect(x + TILE - 5, y + 2, 2, 2);
  }
}

function drawCracks(ctx, s, warns) {
  for (const w of warns) {
    const x = w.c0 * TILE;
    const y = TOP + w.r * TILE;
    const width = (w.c1 - w.c0 + 1) * TILE;
    ctx.fillStyle = 'rgba(255,90,60,0.22)';
    ctx.fillRect(x, y, width, TILE);
    ctx.fillStyle = '#ff7a4a';
    for (let k = 0; k < width / 6; k++) ctx.fillRect(x + k * 6, y + 3 + (k % 2) * 4, 4, 2);
    for (let c = w.c0; c <= w.c1; c++) {
      ctx.fillRect(c * TILE + 11, y + 5, 2, 8 + (c % 3) * 2);
      if (Math.floor(s.ticks / 12 + c) % 3 === 0)
        ctx.fillRect(c * TILE + 6, y + 12 + (c % 2) * 4, 2, 2);
    }
    ctx.fillStyle = '#d8c3a0';
    for (let k = 0; k < width / 8; k++) {
      const fall = (s.ticks * 2 + k * 17) % TILE;
      ctx.fillRect(x + 3 + k * 8 + (k % 3), y + 4 + fall, 2, 2);
    }
    ctx.fillStyle = '#240d0a';
    ctx.fillRect(x, y - 1, width, 5);
    ctx.fillStyle = '#ff5a3c';
    ctx.fillRect(x + 1, y, Math.max(1, ((width - 2) * w.remaining) / (fuseTicks(s) * STEP)), 3);
    text(
      ctx,
      String(Math.ceil(w.remaining)),
      x + width / 2,
      y + TILE / 2 - 4,
      '#fff2b0',
      14,
      'center',
    );
  }
}

// Underground is dim; helmet lamps lift the dark in soft stepped discs.
function shade(ctx) {
  ctx.fillStyle = 'rgba(6,8,16,0.32)';
  ctx.fillRect(0, TOP + TILE, 480, (ROWS - 1) * TILE);
}
function halo(ctx, cx, cy, radius, color) {
  ctx.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const rad = radius * (1 - k * 0.3);
    ctx.globalAlpha = 0.09;
    for (let dy = -rad; dy < rad; dy += 4) {
      const half = Math.sqrt(rad * rad - dy * dy);
      const y = Math.max(TOP + TILE, cy + dy);
      if (y < FIELD_BOTTOM) ctx.fillRect(cx - half, y, half * 2, 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTank(ctx, t, ticks) {
  const x = t.c * TILE + 7;
  const y = TOP + t.r * TILE + 6;
  ctx.fillStyle = '#35c7e8';
  ctx.fillRect(x, y + 3, 10, 14);
  ctx.fillRect(x + 2, y, 6, 4);
  ctx.fillStyle = '#dff8ff';
  ctx.fillRect(x + 2, y + 7, 6, 3);
  if ((ticks >> 5) % 2) ctx.fillRect(x + 11, y + 1, 2, 2);
}

function drawLamp(ctx, x, y, f, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const cx = x + 10 + f.dx * 8;
  const cy = y + 9 + f.dy * 8;
  for (let k = 0; k < 3; k++) {
    const w = 6 + k * 6;
    ctx.fillRect(
      f.dx ? cx + (f.dx > 0 ? k * 9 : -k * 9 - 9) : cx - w / 2,
      f.dy ? cy + (f.dy > 0 ? k * 9 : -k * 9 - 9) : cy - w / 2,
      f.dx ? 9 : w,
      f.dy ? 9 : w,
    );
  }
  ctx.globalAlpha = 1;
}

function drawActor(ctx, pos, rows, palette, face) {
  pixelSprite(ctx, face < 0 ? mirror(rows) : rows, pos.x + 2, pos.y, 2, palette);
}

function drawWorld(ctx, s, env, warns) {
  const level = levelOf(s);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++)
      drawTile(ctx, s.grid[r][c], c * TILE, TOP + r * TILE, r, c, s.boardFlash);
  }
  shade(ctx);
  const lamps = [actorPos(s.player, RULES.moveTicks)];
  for (const m of s.miners) if (m.state !== 'rescued') lamps.push(actorPos(m, RULES.minerTicks));
  lamps.forEach((pos, i) =>
    halo(ctx, pos.x + 12, pos.y + 11, i ? 44 : 64, i ? '#b8ffc8' : '#fff0a0'),
  );
  drawCracks(ctx, s, warns);
  const right = s.lift.c > 15;
  const label = s.boardFlash > 0 ? `+${RULES.minerScore}` : env.t('LIFT', '升降梯');
  const labelX = right ? s.lift.c * TILE - 2 : s.lift.c * TILE + TILE + 2;
  text(
    ctx,
    label,
    labelX,
    TOP + 3,
    s.boardFlash > 0 ? '#7dffa0' : '#ffe36a',
    14,
    right ? 'right' : 'left',
  );
  s.tanks.filter((t) => !t.taken).forEach((t) => drawTank(ctx, t, s.ticks));
  const p = s.player;
  const pp = actorPos(p, RULES.moveTicks);
  const pface = p.facing.dx || (p.c !== p.from.c ? p.c - p.from.c : 1);
  const lead = [...followers(s)];
  s.miners.forEach((m) => {
    if (m.state === 'rescued') return;
    const pos = actorPos(m, RULES.minerTicks);
    const walking = m.prog > 0;
    const rows = walking && (s.ticks >> 3) % 2 ? PLAYER_STEP : PLAYER_ROWS;
    if (m.state === 'following') {
      const idx = lead.indexOf(m);
      const prev = idx > 0 ? actorPos(lead[idx - 1], RULES.minerTicks) : pp;
      ctx.fillStyle = '#9dffb0';
      const steps = 6;
      for (let k = 1; k < steps; k++) {
        ctx.fillRect(
          pos.x + 11 + ((prev.x - pos.x) * k) / steps,
          pos.y + 12 + ((prev.y - pos.y) * k) / steps,
          2,
          2,
        );
      }
    } else {
      const glow = (s.ticks >> 4) % 2 ? 'rgba(157,255,176,0.30)' : 'rgba(157,255,176,0.15)';
      ctx.fillStyle = glow;
      ctx.fillRect(pos.x - 4, pos.y - 4, TILE + 8, TILE + 8);
    }
    drawActor(ctx, pos, rows, MINER_PALETTE, m.c > m.from.c ? 1 : -1);
    if (m.state === 'waiting') text(ctx, '!', pos.x + 12, pos.y - 14, '#ffe36a', 16, 'center');
    if (m.blocked) text(ctx, '?', pos.x + 12, pos.y - 14, '#ff9a8a', 16, 'center');
  });
  const f =
    p.prog > 0 ? { dx: Math.sign(p.c - p.from.c), dy: Math.sign(p.r - p.from.r) } : p.facing;
  drawLamp(ctx, pp.x, pp.y, f, '#fff6a8', 0.16);
  const rows = p.prog > 0 && (s.ticks >> 3) % 2 ? PLAYER_STEP : PLAYER_ROWS;
  drawActor(ctx, pp, rows, PLAYER_PALETTE, pface);
  if (p.dig > 0) {
    const swing = (p.dig >> 2) % 2;
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(pp.x + 12 + f.dx * (10 + swing * 4), pp.y + 10 + f.dy * (10 + swing * 4), 7, 5);
    ctx.fillStyle = '#7a4a1a';
    ctx.fillRect(pp.x + 11 + f.dx * 6, pp.y + 12 + f.dy * 6, 8, 2);
  }
  if (p.hurt > 0 && (p.hurt >> 3) % 2) {
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(pp.x + 1, pp.y - 2, 22, 2);
    ctx.fillRect(pp.x + 1, pp.y + TILE, 22, 2);
  }
  for (const fx of s.fx) {
    ctx.fillStyle = fx.color;
    ctx.fillRect(Math.round(fx.x), Math.round(fx.y), 3, 3);
  }
  if (s.banner > 0) {
    ctx.globalAlpha = Math.min(1, s.banner / 60);
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    ctx.fillRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h);
    text(
      ctx,
      `${env.t('Level', '关卡')} ${s.level + 1}: ${env.t(level.name.en, level.name.zh)}`,
      240,
      BANNER.y + 3,
      '#ffe36a',
      16,
      'center',
    );
    wrapText(env.t(level.tip.en, level.tip.zh), BANNER.size, BANNER.w - 20).forEach((row, i) =>
      text(ctx, row, 240, BANNER.y + 22 + i * 13, '#e8e8e8', BANNER.size, 'center'),
    );
    ctx.globalAlpha = 1;
  }
}

function drawHud(ctx, s, env, prompt, warns) {
  ctx.fillStyle = '#0d1018';
  ctx.fillRect(0, 0, 480, TOP);
  ctx.fillRect(0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  const saved = s.miners.filter((m) => m.state === 'rescued').length;
  text(ctx, `${env.t('Lv', '关')} ${s.level + 1}/${LEVEL_COUNT}`, 6, 6, '#ffe36a', 14);
  text(ctx, `${env.t('Miners', '矿工')} ${saved}/${s.miners.length}`, 76, 6, '#ffb070', 14);
  const low = s.oxygen < RULES.lowAir;
  text(ctx, env.t('Air', '氧气'), 168, 6, low ? '#ff8a70' : '#7fe0ff', 14);
  ctx.fillStyle = '#1b2a3a';
  ctx.fillRect(206, 7, 62, 12);
  ctx.fillStyle = low ? '#ff5a3c' : '#35c7e8';
  ctx.fillRect(207, 8, Math.round((60 * s.oxygen) / 100), 10);
  text(ctx, `-${drainRate(s).toFixed(1)}`, 272, 6, '#9aa4b2', 14);
  text(ctx, `${env.t('Beams', '支架')} ${s.beams}`, 330, 6, '#e0a850', 14);
  for (let i = 0; i < RULES.lives; i++) {
    ctx.fillStyle = i < s.lives ? '#ff4d6d' : '#3a2a30';
    const hx = 410 + i * 18;
    ctx.fillRect(hx, 7, 5, 6);
    ctx.fillRect(hx + 7, 7, 5, 6);
    ctx.fillRect(hx, 10, 12, 3);
    ctx.fillRect(hx + 2, 13, 8, 3);
    ctx.fillRect(hx + 4, 16, 4, 2);
  }
  const alarm = warns.length > 0 && Math.floor(s.ticks / 20) % 2 === 0;
  const warnColor = warns.length ? (alarm ? '#ffd0c0' : '#ff8a70') : '#f4f4f4';
  const line = s.message && prompt.quiet ? s.message : prompt;
  text(ctx, env.t(line.en, line.zh), 240, FIELD_BOTTOM + 6, warnColor, 16, 'center');
}

export function drawBurrow(ctx, s, env) {
  background(ctx, '#0d1018');
  const warns = warnings(s);
  drawWorld(ctx, s, env, warns);
  drawHud(ctx, s, env, shownPrompt(s, warns), warns);
}
