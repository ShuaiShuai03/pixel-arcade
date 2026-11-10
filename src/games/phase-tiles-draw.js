// Phase Tiles drawing: the woven board, the influence preview, the side cards and the menu.
import { background, drawPixelText as text } from '../shared/utils.js';
import { RULES, SHAPE_NAMES, reach } from './phase-tiles-rules.js';

const CELL = RULES.cell;
const GRID_TOP = 44;
const GRID_AREA_H = 248;
export const MENU = Object.freeze({ x: 16, y: 66, w: 56, h: 44 });
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export const C = Object.freeze({
  bg: '#0c0b1c',
  hole: '#07060f',
  holeDot: '#1b1838',
  text: '#e8e4ff',
  dim: '#9a94c8',
  hint: '#ffe27a',
  hintDim: '#b8942a',
  preview: '#7df9ff',
  good: '#6dffc0',
  bad: '#ff6b8a',
  ink: '#0b0a1a',
  phase: ['#3b52b8', '#f4c14e', '#e0508c'],
  phaseEdge: ['#1a2760', '#a77c1c', '#8e2a58'],
});
const rect = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

// --- Geometry -------------------------------------------------------------------------------
export function layoutOf(board) {
  return {
    x: Math.floor((480 - board.w * CELL) / 2),
    y: GRID_TOP + Math.floor((GRID_AREA_H - board.h * CELL) / 2),
  };
}
export function cellAt(board, px, py) {
  const o = layoutOf(board);
  const x = Math.floor((px - o.x) / CELL);
  const y = Math.floor((py - o.y) / CELL);
  return px >= o.x && py >= o.y && x < board.w && y < board.h ? { x, y } : null;
}
export function menuCellAt(px, py, count) {
  const col = Math.floor((px - MENU.x) / MENU.w);
  const row = Math.floor((py - MENU.y) / MENU.h);
  const n = row * RULES.menuCols + col + 1;
  const inside = px >= MENU.x && py >= MENU.y && col < RULES.menuCols && row >= 0;
  return inside && n <= count ? n : -1;
}

// --- Pieces ---------------------------------------------------------------------------------
// A shape icon: the reach of a press from the middle of a 5 by 5 patch, `unit` pixels per cell.
function drawShape(ctx, shape, x, y, unit, color, centre) {
  rect(ctx, x, y, unit * 5, unit * 5, C.ink);
  for (const [cx, cy] of reach(shape, 2, 2, 5, 5)) {
    const self = cx === 2 && cy === 2;
    rect(
      ctx,
      x + cx * unit,
      y + cy * unit,
      unit - (unit > 3 ? 1 : 0),
      unit - (unit > 3 ? 1 : 0),
      self ? centre : color,
    );
  }
  if (!reach(shape, 2, 2, 5, 5).some(([cx, cy]) => cx === 2 && cy === 2))
    rect(ctx, x + 2 * unit, y + 2 * unit, unit, unit, '#3a3566');
}

const BARS = Object.freeze({ w: 3, h: 10, gap: 2 });
const MINI_BARS = Object.freeze({ w: 1, gap: 1 });
const MINI_INK = ['#ffffff', C.ink, '#ffffff']; // bar colours that stay legible on each phase colour

// phase + 1 bars, centred on x: the same count marks a phase on tiles, swatches and target marks.
function drawBars(ctx, x, y, count, color, size = BARS) {
  const total = count * size.w + (count - 1) * size.gap;
  for (let n = 0; n < count; n++)
    rect(ctx, x - total / 2 + n * (size.w + size.gap), y, size.w, size.h, color);
}

// A small swatch of a target phase: its colour plus its bar count, so colour is never the only cue.
function drawTargetMark(ctx, x, y, size, phase) {
  rect(ctx, x, y, size, size, C.phase[phase]);
  const bars = { ...MINI_BARS, h: size - 2 };
  drawBars(ctx, x + size / 2, y + 1, phase + 1, MINI_INK[phase], bars);
}

function drawLock(ctx, x, y) {
  rect(ctx, x + 2, y, 6, 2, '#c9c4ee');
  rect(ctx, x + 2, y, 2, 5, '#c9c4ee');
  rect(ctx, x + 6, y, 2, 5, '#c9c4ee');
  rect(ctx, x, y + 4, 10, 7, '#c9c4ee');
  rect(ctx, x + 4, y + 6, 2, 3, C.ink);
}

function drawFrame(ctx, x, y, size, thick, color) {
  rect(ctx, x, y, size, thick, color);
  rect(ctx, x, y + size - thick, size, thick, color);
  rect(ctx, x, y, thick, size, color);
  rect(ctx, x + size - thick, y, thick, size, color);
}

function drawTile(ctx, s, i, x, y, matched) {
  const { board } = s;
  const cell = board.cells[i];
  if (cell.hole) {
    rect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, C.hole);
    for (const [dx, dy] of [
      [5, 5],
      [27, 7],
      [9, 26],
      [26, 27],
    ])
      rect(ctx, x + dx, y + dy, 3, 3, C.holeDot);
    return;
  }
  const phase = s.cells[i];
  rect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, C.phaseEdge[phase]);
  rect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, C.phase[phase]);
  ctx.globalAlpha = 0.22;
  for (let r = 0; r < 7; r++) rect(ctx, x + 3, y + 5 + r * 4, CELL - 6, 1, C.ink);
  ctx.globalAlpha = 1;
  drawBars(ctx, x + CELL / 2, y + 13, phase + 1, C.ink);
  // The ghost mark: the phase this tile should end on.
  rect(ctx, x + 4, y + 4, 9, 9, C.ink);
  drawTargetMark(ctx, x + 5, y + 5, 7, board.target[i]);
  if (matched) drawFrame(ctx, x + 2, y + 2, CELL - 4, 2, C.good);
  if (cell.locked) drawLock(ctx, x + 23, y + 23);
  if (board.mixed) drawShape(ctx, cell.shape, x + 3, y + 23, 2, '#f1edff', '#ffffff');
}

function drawArrow(ctx, cx, cy, dir, color) {
  for (let r = 0; r < 4; r++) {
    const along = 3 - r;
    for (let k = -r; k <= r; k++) {
      const px = dir % 2 === 0 ? cx + (dir === 0 ? -along : along) * 2 : cx + k * 2;
      const py = dir % 2 === 0 ? cy + k * 2 : cy + (dir === 1 ? -along : along) * 2;
      rect(ctx, px - 1, py - 1, 2, 2, color);
    }
  }
}

// The undo hint points at the tile whose press Z takes back.
function drawUndoMark(ctx, o, board, i, pulse) {
  const x = o.x + (i % board.w) * CELL;
  const y = o.y + Math.floor(i / board.w) * CELL;
  drawFrame(ctx, x, y, CELL, 3, pulse ? C.bad : '#ffffff');
  rect(ctx, x + CELL - 14, y + 2, 12, 12, C.ink);
  text(ctx, 'Z', x + CELL - 8, y + 2, C.hint, 12, 'center');
}

function drawCursor(ctx, s, o, previewSet) {
  const pulse = Math.floor(s.clock * 4) % 2;
  const h = s.hint;
  if (h.x !== null && (h.kind === 'move' || h.kind === 'act'))
    drawFrame(ctx, o.x + h.x * CELL, o.y + h.y * CELL, CELL, 3, pulse ? C.hint : C.hintDim);
  for (const j of previewSet) {
    const px = o.x + (j % s.board.w) * CELL;
    const py = o.y + Math.floor(j / s.board.w) * CELL;
    const next = (s.cells[j] + 1) % s.board.phases;
    drawFrame(ctx, px + 1, py + 1, CELL - 2, 2, C.preview);
    rect(ctx, px + 10, py + 10, 16, 16, C.ink);
    rect(ctx, px + 11, py + 11, 14, 14, C.phase[next]);
    drawBars(ctx, px + CELL / 2, py + 13, next + 1, C.ink);
  }
  const x = o.x + s.cx * CELL;
  const y = o.y + s.cy * CELL;
  for (const [ax, ay, sx, sy] of [
    [0, 0, 1, 1],
    [CELL, 0, -1, 1],
    [0, CELL, 1, -1],
    [CELL, CELL, -1, -1],
  ]) {
    rect(ctx, sx > 0 ? x + ax : x + ax - 10, y + ay + (sy > 0 ? 0 : -3), 10, 3, '#fff');
    rect(ctx, x + ax + (sx > 0 ? 0 : -3), sy > 0 ? y + ay : y + ay - 10, 3, 10, '#fff');
  }
  if (h.kind === 'undo' && s.history.length > 0)
    drawUndoMark(ctx, o, s.board, s.history.at(-1).i, pulse);
  if (h.kind === 'move')
    drawArrow(ctx, x + CELL / 2 + DX[h.dir] * 24, y + CELL / 2 + DY[h.dir] * 24, h.dir, C.hint);
}

// --- Side cards -----------------------------------------------------------------------------
function drawTargetCard(ctx, s, lang, o) {
  const { board } = s;
  const left = o.x + board.w * CELL;
  const cx = Math.floor((left + 480) / 2);
  text(ctx, lang === 'zh' ? '目标' : 'TARGET', cx, 52, C.dim, 10, 'center');
  const unit = 9;
  const gx = cx - (board.w * unit) / 2;
  rect(ctx, gx - 2, 66, board.w * unit + 4, board.h * unit + 4, C.dim);
  for (let i = 0; i < board.cells.length; i++) {
    const cx0 = gx + (i % board.w) * unit;
    const cy0 = 68 + Math.floor(i / board.w) * unit;
    if (board.cells[i].hole) rect(ctx, cx0, cy0, unit - 1, unit - 1, C.hole);
    else drawTargetMark(ctx, cx0, cy0, unit - 1, board.target[i]);
  }
  const off = board.cells.filter((c, i) => !c.hole && s.cells[i] !== board.target[i]).length;
  const ok = off === 0;
  text(
    ctx,
    lang === 'zh' ? `错位 ${off}` : `Off ${off}`,
    cx,
    78 + board.h * unit,
    ok ? C.good : C.text,
    12,
    'center',
  );
}

function drawShapeCard(ctx, s, lang, o) {
  const { board } = s;
  const cx = Math.floor(o.x / 2);
  const cell = board.cells[s.cy * board.w + s.cx];
  text(ctx, lang === 'zh' ? '形状' : 'SHAPE', cx, 52, C.dim, 10, 'center');
  if (cell.hole) text(ctx, lang === 'zh' ? '无方格' : 'no tile', cx, 80, C.dim, 10, 'center');
  else {
    drawShape(ctx, cell.shape, cx - 20, 66, 8, C.preview, '#ffffff');
    text(ctx, SHAPE_NAMES[cell.shape][lang === 'zh' ? 1 : 0], cx, 110, C.text, 10, 'center');
  }
  text(ctx, lang === 'zh' ? '相位' : 'PHASES', cx, 134, C.dim, 10, 'center');
  const count = board.phases;
  const span = count * 16 + (count - 1) * 6;
  for (let p = 0; p < count; p++) {
    const px = cx - span / 2 + p * 22;
    rect(ctx, px, 150, 16, 16, C.ink);
    rect(ctx, px + 1, 151, 14, 14, C.phase[p]);
    drawBars(ctx, px + 8, 154, p + 1, C.ink);
  }
  text(ctx, lang === 'zh' ? '每按一次进一格' : 'each press: +1', cx, 174, C.dim, 10, 'center');
}

// --- Screens --------------------------------------------------------------------------------
function drawHud(ctx, s, lang, loseIn) {
  const { board } = s;
  const zh = lang === 'zh';
  text(ctx, `${s.index + 1}/${s.count}  ${board.name[lang]}`, 8, 4, C.text, 12);
  const budget = board.budget === null ? '' : `/${board.budget}`;
  const left = board.budget === null ? Infinity : board.budget - s.moves;
  text(
    ctx,
    `${zh ? '按压' : 'Presses'} ${s.moves}${budget}`,
    472,
    4,
    left <= 1 ? C.bad : C.text,
    12,
    'right',
  );
  const urgent = loseIn !== null;
  const secs = Math.ceil(loseIn ?? 0);
  const countdown = {
    en: `Out of presses: undo with Z (${secs} s)`,
    zh: `次数用完：按 Z 撤销（${secs} 秒）`,
  };
  const note = urgent ? countdown : s.msg || board.tip;
  text(ctx, note[lang], 8, 23, urgent || s.msg ? C.bad : C.dim, 10);
  text(ctx, s.line[lang], 240, 298, C.hint, 12, 'center');
}

function drawBanner(ctx, s, lang) {
  let banner = null;
  if (s.phase === 'won') banner = ['ALL BOARDS CLEAR', '全部通关', C.good];
  else if (s.phase === 'lost') banner = ['OUT OF PRESSES', '次数用完', C.bad];
  else if (s.cleared) banner = ['BOARD CLEAR', '过关', C.good];
  if (!banner) return;
  ctx.globalAlpha = 0.8;
  rect(ctx, 0, 128, 480, 50, '#000');
  ctx.globalAlpha = 1;
  text(ctx, banner[lang === 'zh' ? 1 : 0], 240, 142, banner[2], 24, 'center');
}

export function drawPlay(ctx, s, lang, previewSet, loseIn) {
  const o = layoutOf(s.board);
  background(ctx, C.bg);
  for (let i = 0; i < s.board.cells.length; i++)
    drawTile(
      ctx,
      s,
      i,
      o.x + (i % s.board.w) * CELL,
      o.y + Math.floor(i / s.board.w) * CELL,
      s.cells[i] === s.board.target[i],
    );
  for (const p of s.sparks) rect(ctx, p.x, p.y, 3, 3, p.color);
  drawCursor(ctx, s, o, previewSet);
  drawTargetCard(ctx, s, lang, o);
  drawShapeCard(ctx, s, lang, o);
  drawHud(ctx, s, lang, loseIn);
  drawBanner(ctx, s, lang);
}

export function drawMenu(ctx, s, lang, boards) {
  background(ctx, C.bg);
  text(
    ctx,
    lang === 'zh' ? '相位方格：选择棋盘' : 'PHASE TILES: PICK A BOARD',
    240,
    22,
    C.text,
    16,
    'center',
  );
  text(ctx, s.line[lang], 240, 46, C.hint, 12, 'center');
  boards.forEach((board, k) => {
    const n = k + 1;
    const x = MENU.x + (k % RULES.menuCols) * MENU.w;
    const y = MENU.y + Math.floor(k / RULES.menuCols) * MENU.h;
    const open = n <= s.menu.unlocked;
    rect(
      ctx,
      x + 3,
      y + 3,
      MENU.w - 6,
      MENU.h - 6,
      n === s.menu.sel ? C.hint : open ? '#2c3a82' : '#141230',
    );
    rect(ctx, x + 6, y + 6, MENU.w - 12, MENU.h - 12, open ? '#15163a' : '#0d0b22');
    text(ctx, String(n), x + MENU.w / 2, y + 14, open ? C.text : '#3a3666', 14, 'center');
  });
  const pick = boards[s.menu.sel - 1];
  text(ctx, pick.name[lang], 240, 262, C.text, 12, 'center');
}
