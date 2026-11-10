import { background, drawPixelText as text } from '../shared/utils.js';

// --- Geometry -----------------------------------------------------------------------------------
export const GEO = Object.freeze({
  peg: 36, // distance between neighbouring peg distances, canvas pixels
  top: 46,
  bottom: 236,
  chip: 34,
  chipGap: 8,
  trayY: 250,
  menu: { x: 48, y: 74, w: 64, h: 44, cols: 6 },
});
const U = GEO.peg;
const MARGIN = { left: 36, right: 440 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Where every beam, peg and tray socket sits on the 480 x 320 canvas.
export function layoutOf(mach) {
  const nb = mach.beams.length;
  const band = (GEO.bottom - GEO.top) / nb;
  const rows = [];
  mach.beams.forEach((b, i) => {
    const reach = Math.max(...b.pegs.map(Math.abs)) + 0.6;
    const half = reach * U;
    let cx = 240;
    if (b.hang) {
      const parent = rows[b.hang.beam];
      cx = parent.cx + b.hang.pos * U;
    }
    cx = clamp(cx, MARGIN.left + half, MARGIN.right - half);
    const bandTop = GEO.top + i * band;
    rows.push({
      cx,
      half,
      bandTop,
      band,
      barY: Math.round(bandTop + Math.min(band * 0.55, 90) + 4),
    });
  });
  const total = mach.weights.length * GEO.chip + (mach.weights.length - 1) * GEO.chipGap;
  const chips = mach.weights.map((_, w) => ({
    x: Math.round(240 - total / 2 + w * (GEO.chip + GEO.chipGap)),
    y: GEO.trayY,
    w: GEO.chip,
    h: GEO.chip,
  }));
  return { rows, chips, nb };
}

export function pegX(lay, beam, pos) {
  return lay.rows[beam].cx + pos * U;
}

export function cellRect(lay, mach, row, col) {
  if (row === lay.nb) return lay.chips[col];
  const r = lay.rows[row];
  return { x: pegX(lay, row, mach.beams[row].pegs[col]) - U / 2, y: r.bandTop, w: U, h: r.band };
}

// The tray socket or peg cell under a canvas point, as a cursor position, or null.
export function hitTest(mach, px, py) {
  const lay = layoutOf(mach);
  const inside = (r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  const chip = lay.chips.findIndex(inside);
  if (chip >= 0) return { row: lay.nb, col: chip };
  for (let row = 0; row < lay.nb; row++) {
    const col = mach.beams[row].pegs.findIndex((_, c) => inside(cellRect(lay, mach, row, c)));
    if (col >= 0) return { row, col };
  }
  return null;
}

export function menuCellAt(px, py, count) {
  const m = GEO.menu;
  const col = Math.floor((px - m.x) / m.w);
  const row = Math.floor((py - m.y) / m.h);
  const n = row * m.cols + col + 1;
  const inside = px >= m.x && py >= m.y && col < m.cols && row >= 0;
  return inside && n <= count ? n : -1;
}

// --- Palette ------------------------------------------------------------------------------------
const C = {
  bg: '#1b130c',
  plank: '#24180f',
  panel: '#33220f',
  wood: '#a9743a',
  woodHi: '#d29a55',
  woodLo: '#6d4620',
  brass: '#e2b04a',
  brassHi: '#fff0b0',
  brassLo: '#8a6418',
  iron: '#7b8190',
  ironLo: '#444a58',
  steel: '#8cc2ff',
  steelLo: '#3b6aa6',
  text: '#f6e8c8',
  dim: '#a38d63',
  lit: '#6dfcaa',
  hint: '#ffe27a',
  bad: '#ff6f5e',
  lampOff: '#4a2a1e',
};
const rect = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const GLYPH = ['→', '↓', '←', '↑'];
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// --- Parts --------------------------------------------------------------------------------------
const BLOCK = {
  brass: [C.brass, C.brassHi, C.brassLo, '#3a2606'],
  iron: [C.iron, '#aab0be', C.ironLo, '#12151c'],
  steel: [C.steel, '#dff0ff', C.steelLo, '#0b1a30'],
};

// A mass block standing on a bar, its feet at `y`. Height grows a little with the mass.
function block(ctx, x, y, mass, kind, alpha = 1) {
  const [face, hi, lo, ink] = BLOCK[kind];
  const h = 12 + Math.min(mass, 9);
  const w = 28;
  ctx.globalAlpha = alpha;
  rect(ctx, x - w / 2, y - h, w, h, lo);
  rect(ctx, x - w / 2 + 1, y - h + 1, w - 2, h - 2, face);
  rect(ctx, x - w / 2 + 1, y - h + 1, w - 2, 2, hi);
  text(ctx, String(mass), x, y - h + (h - 12) / 2 + 1, ink, 11, 'center');
  if (kind === 'iron') {
    rect(ctx, x - w / 2 + 2, y - h + 3, 2, 2, lo);
    rect(ctx, x + w / 2 - 4, y - h + 3, 2, 2, lo);
  }
  ctx.globalAlpha = 1;
}

function lock(ctx, x, y) {
  rect(ctx, x - 4, y - 7, 8, 7, C.iron);
  rect(ctx, x - 3, y - 11, 2, 4, C.iron);
  rect(ctx, x + 1, y - 11, 2, 4, C.iron);
  rect(ctx, x - 3, y - 12, 6, 2, C.iron);
  rect(ctx, x - 1, y - 5, 2, 3, C.ironLo);
}

function line(ctx, x1, y1, x2, y2, color, dashed = false) {
  const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= n; i += 2) {
    if (dashed && Math.floor(i / 4) % 2) continue;
    rect(ctx, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, 2, 2, color);
  }
}

// The y of a bar at distance `dx` pixels from its pivot, for a needle angle.
const barYAt = (row, angle, dx) => row.barY + dx * Math.sin(angle);

function drawGauge(ctx, cx, y, angle) {
  rect(ctx, cx - 11, y - 2, 22, 12, C.ironLo);
  rect(ctx, cx - 10, y - 1, 20, 10, '#e9dcc0');
  for (const t of [-1, 0, 1]) rect(ctx, cx + t * 7 - 1, y, 2, 3, '#6b5a3a');
  const a = clamp(angle * 8, -1.1, 1.1);
  for (let i = 3; i <= 10; i++)
    rect(ctx, cx + Math.sin(a) * i - 1, y + 9 - Math.cos(a) * i, 2, 2, '#c8321f');
  rect(ctx, cx - 2, y + 7, 4, 4, '#2a2118');
}

const GATE_LABEL = { '=': ['LEVEL', '平衡'], '<': ['LEFT', '偏左'], '>': ['RIGHT', '偏右'] };

function drawLamp(ctx, row, b, lit, tau, lang) {
  const x = 446;
  const y = row.bandTop + 6;
  rect(ctx, x, y, 30, 24, C.ironLo);
  rect(ctx, x + 2, y + 2, 26, 20, lit ? '#1f8a4f' : C.lampOff);
  const color = lit ? C.lit : '#a8664a';
  if (b.gate === '=') {
    rect(ctx, x + 7, y + 7, 16, 3, color);
    rect(ctx, x + 7, y + 14, 16, 3, color);
  } else {
    const dir = b.gate === '<' ? -1 : 1;
    for (let i = 0; i < 6; i++)
      rect(ctx, x + 15 + dir * (i - 3) - 1, y + 12 - (5 - i), 3, 1 + (5 - i) * 2, color);
  }
  text(
    ctx,
    GATE_LABEL[b.gate][lang === 'zh' ? 1 : 0],
    x + 15,
    y + 26,
    lit ? C.lit : C.dim,
    9,
    'center',
  );
  const shown = tau > 0 ? `+${tau}` : String(tau);
  text(ctx, shown, x + 15, y + 37, C.text, 10, 'center');
}

function drawBeam(ctx, s, lay, b, lang) {
  const row = lay.rows[b.index];
  const angle = s.needles[b.index].a;
  const { cx, half } = row;
  text(ctx, b.label, 14, row.bandTop + 6, C.brass, 16, 'center');
  for (let dx = -half; dx < half; dx += 4) {
    const y = barYAt(row, angle, dx + 2);
    rect(ctx, cx + dx, y - 3, 4, 7, C.wood);
    rect(ctx, cx + dx, y - 3, 4, 2, C.woodHi);
    rect(ctx, cx + dx, y + 2, 4, 2, C.woodLo);
  }
  rect(ctx, cx - 8, row.barY + 6, 16, 4, C.ironLo);
  for (let i = 0; i < 4; i++)
    rect(ctx, cx - 10 - i * 2 + 1, row.barY + 10 + i * 4, 20 + i * 4 - 2, 4, C.iron);
  drawGauge(ctx, cx, row.barY + 12, angle);
  b.pegs.forEach((pos, col) => {
    const x = pegX(lay, b.index, pos);
    const y = barYAt(row, angle, pos * U);
    const id = b.slots[col];
    rect(ctx, x - 1, y - 4, 3, 3, C.brass);
    text(ctx, pos > 0 ? `+${pos}` : String(pos), x, y + 5, C.dim, 8, 'center');
    if (s.mach.why[id] === 'locked') lock(ctx, x, y - 3);
  });
}

function drawLoads(ctx, s, lay) {
  const m = s.mach;
  for (const b of m.beams) {
    const row = lay.rows[b.index];
    const angle = s.needles[b.index].a;
    const at = (pos) => ({ x: pegX(lay, b.index, pos), y: barYAt(row, angle, pos * U) - 3 });
    for (const f of b.fixed) block(ctx, at(f.pos).x, at(f.pos).y, f.m, 'iron');
    b.tips.forEach((t) => {
      const side = t.when === 'L' ? -1 : 1;
      const sx = row.cx + side * (row.half - 4);
      const sy = barYAt(row, angle, side * (row.half - 4)) - 4;
      rect(ctx, sx - 5, sy - 8, 10, 8, C.brassLo);
      rect(ctx, sx - 4, sy - 7, 8, 5, C.steel);
      const tr = lay.rows[t.beam];
      const tx = pegX(lay, t.beam, t.pos);
      const ty = barYAt(tr, s.needles[t.beam].a, t.pos * U) - 3;
      line(ctx, sx, sy - 9, tx, ty - 24, '#8cc2ff', true);
      const active = s.ev.tilt[b.index] === (t.when === 'L' ? -1 : 1);
      block(ctx, tx, ty, t.m, 'steel', active ? 1 : 0.35);
      if (!active) {
        const h = 12 + Math.min(t.m, 9);
        line(ctx, tx - 9, ty - h + 3, tx + 9, ty - 3, C.dim);
        line(ctx, tx + 9, ty - h + 3, tx - 9, ty - 3, C.dim);
      }
    });
  }
  s.where.forEach((id, w) => {
    if (id < 0) return;
    const { beam, pos } = m.slots[id];
    const p = {
      x: pegX(lay, beam, pos),
      y: barYAt(lay.rows[beam], s.needles[beam].a, pos * U) - 3,
    };
    block(ctx, p.x, p.y, m.weights[w].m, 'brass');
    if (m.weights[w].rail >= 0) rect(ctx, p.x - 14, p.y - 4, 28, 3, '#5fa8ff');
  });
}

function drawRopes(ctx, s, lay, lang) {
  for (const b of s.mach.beams) {
    if (!b.hang) continue;
    const parent = lay.rows[b.hang.beam];
    const row = lay.rows[b.index];
    const ax = pegX(lay, b.hang.beam, b.hang.pos);
    const ay = barYAt(parent, s.needles[b.hang.beam].a, b.hang.pos * U) + 2;
    const hookY = row.barY - 38;
    const midY = Math.round((ay + hookY) / 2);
    const color = '#d9c9a0';
    rect(ctx, ax - 5, ay - 1, 10, 4, C.brassLo);
    line(ctx, ax, ay, ax, midY, color);
    line(ctx, ax, midY, row.cx, midY, color);
    line(ctx, row.cx, midY, row.cx, hookY, color);
    rect(ctx, row.cx - 6, hookY, 12, 4, C.brass);
    const mass = s.ev.mass[b.index];
    text(ctx, `${mass} ${lang === 'zh' ? '千克' : 'kg'}`, row.cx + 10, hookY - 3, C.steel, 10);
  }
}

function drawTray(ctx, s, lay) {
  rect(ctx, 20, GEO.trayY - 4, 440, GEO.chip + 8, C.panel);
  rect(ctx, 20, GEO.trayY - 4, 440, 2, C.woodLo);
  s.mach.weights.forEach((wt, w) => {
    const c = lay.chips[w];
    rect(ctx, c.x, c.y, c.w, c.h, '#140d07');
    rect(ctx, c.x + 1, c.y + 1, c.w - 2, c.h - 2, '#2a1b0d');
    if (s.where[w] < 0) block(ctx, c.x + c.w / 2, c.y + c.h - 4, wt.m, 'brass');
    else text(ctx, '·', c.x + c.w / 2, c.y + 10, C.dim, 14, 'center');
    if (wt.rail >= 0) {
      rect(ctx, c.x + 1, c.y + c.h - 3, c.w - 2, 2, '#5fa8ff');
      text(ctx, 'ABC'[wt.rail], c.x + 3, c.y + 2, '#9fd0ff', 8);
    }
    if (w === s.sel) {
      const pulse = Math.floor(s.clock * 4) % 2;
      for (const [fx, fy, fw, fh] of [
        [0, 0, c.w, 2],
        [0, c.h - 2, c.w, 2],
        [0, 0, 2, c.h],
        [c.w - 2, 0, 2, c.h],
      ])
        rect(ctx, c.x + fx, c.y + fy, fw, fh, pulse ? '#fff' : C.brass);
    }
  });
}

function frame(ctx, r, color, thick = 3) {
  rect(ctx, r.x, r.y, r.w, thick, color);
  rect(ctx, r.x, r.y + r.h - thick, r.w, thick, color);
  rect(ctx, r.x, r.y, thick, r.h, color);
  rect(ctx, r.x + r.w - thick, r.y, thick, r.h, color);
}

function drawCursor(ctx, s, lay) {
  const pulse = Math.floor(s.clock * 4) % 2;
  const h = s.hint;
  if (h.row !== null && (h.kind === 'move' || h.kind === 'place' || h.kind === 'pick'))
    frame(ctx, cellRect(lay, s.mach, h.row, h.col), pulse ? C.hint : '#b8942a');
  if (h.kind === 'rotate') frame(ctx, lay.chips[h.weight], pulse ? C.hint : '#b8942a');
  const r = cellRect(lay, s.mach, s.cur.row, s.cur.col);
  frame(ctx, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, '#fff', 1);
  for (const [ax, ay, sx, sy] of [
    [0, 0, 1, 1],
    [r.w, 0, -1, 1],
    [0, r.h, 1, -1],
    [r.w, r.h, -1, -1],
  ]) {
    rect(ctx, sx > 0 ? r.x + ax : r.x + ax - 8, r.y + ay + (sy > 0 ? 0 : -2), 8, 2, '#fff');
    rect(ctx, r.x + ax + (sx > 0 ? 0 : -2), sy > 0 ? r.y + ay : r.y + ay - 8, 2, 8, '#fff');
  }
  if (h.kind === 'move') {
    const gx = r.x + r.w / 2 + DX[h.dir] * 24;
    const gy = r.y + r.h / 2 + DY[h.dir] * 14 - 7;
    text(ctx, GLYPH[h.dir], gx, gy, C.hint, 16, 'center');
  }
  // A ghost of the next mass shows where Space would put it.
  if (s.cur.row < lay.nb && s.sel >= 0) {
    const b = s.mach.beams[s.cur.row];
    const id = b.slots[s.cur.col];
    const free = s.mach.usable[id] && !s.where.includes(id);
    if (free) {
      const x = r.x + r.w / 2;
      block(
        ctx,
        x,
        barYAt(lay.rows[b.index], s.needles[b.index].a, b.pegs[s.cur.col] * U) - 3,
        s.mach.weights[s.sel].m,
        'brass',
        0.4,
      );
    }
  }
}

function drawBanner(ctx, s, lang) {
  let banner = null;
  if (s.phase === 'won') banner = ['ALL MACHINES BALANCED', '全部机器已平衡', C.lit];
  else if (s.phase === 'lost') banner = ['OUT OF MOVES', '步数用完', C.bad];
  else if (s.cleared) banner = ['BALANCED', '平衡了', C.lit];
  if (!banner) return;
  ctx.globalAlpha = 0.8;
  rect(ctx, 0, 118, 480, 50, '#000');
  ctx.globalAlpha = 1;
  text(ctx, banner[lang === 'zh' ? 1 : 0], 240, 132, banner[2], 22, 'center');
}

function drawHud(ctx, s, lang, count, lamps) {
  const m = s.mach;
  text(ctx, `${s.index + 1}/${count}  ${m.name[lang]}`, 8, 4, C.text, 12);
  const budget = m.budget === null ? '' : `/${m.budget}`;
  const left = m.budget === null ? Infinity : m.budget - s.moves;
  const label = lang === 'zh' ? `步数 ${s.moves}${budget}` : `Moves ${s.moves}${budget}`;
  text(ctx, label, 472, 4, left <= 1 ? C.bad : C.text, 12, 'right');
  const secs = s.graceLeft === null ? 0 : Math.ceil(s.graceLeft);
  const note =
    s.graceLeft !== null
      ? {
          en: `Out of moves! Press Z to undo (${secs} s)`,
          zh: `步数用完！按 Z 撤销（${secs} 秒）`,
        }
      : s.msg || m.tip;
  text(ctx, note[lang], 8, 23, s.msg || s.graceLeft !== null ? C.bad : C.dim, 10);
  const gates = `${lang === 'zh' ? '指示灯' : 'Gates'} ${lamps}/${m.beams.length}`;
  text(ctx, gates, 472, 23, C.lit, 10, 'right');
  text(ctx, s.line[lang], 240, 298, C.hint, 12, 'center');
}

// White corner brackets drawn in the gap around the selected menu cell, so selection is not just a colour.
function cornerBrackets(ctx, x, y, w, h) {
  const arm = 12;
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    rect(ctx, sx > 0 ? cx : cx - arm, sy > 0 ? cy : cy - 3, arm, 3, '#fff');
    rect(ctx, sx > 0 ? cx : cx - 3, sy > 0 ? cy : cy - arm, 3, arm, '#fff');
  }
}

function drawMenu(ctx, s, lang, count) {
  text(
    ctx,
    lang === 'zh' ? '天平工坊：选择机器' : 'WEIGHTWORKS: PICK A MACHINE',
    240,
    22,
    C.text,
    16,
    'center',
  );
  text(ctx, s.line[lang], 240, 48, C.hint, 12, 'center');
  const M = GEO.menu;
  for (let n = 1; n <= count; n++) {
    const x = M.x + ((n - 1) % M.cols) * M.w;
    const y = M.y + Math.floor((n - 1) / M.cols) * M.h;
    const open = n <= s.menu.unlocked;
    const selected = n === s.menu.sel;
    rect(ctx, x + 3, y + 3, M.w - 6, M.h - 6, selected ? C.hint : open ? C.brassLo : '#2a1c0e');
    rect(ctx, x + 6, y + 6, M.w - 12, M.h - 12, open ? C.panel : '#1d1309');
    text(ctx, String(n), x + M.w / 2, y + (open ? 14 : 9), open ? C.text : '#5a4730', 14, 'center');
    if (!open) lock(ctx, x + M.w / 2, y + 36);
    if (selected) cornerBrackets(ctx, x, y, M.w, M.h);
  }
}

export function drawGame(ctx, s, lang, count) {
  background(ctx, C.bg);
  for (let y = 40; y < 240; y += 40) rect(ctx, 0, y, 480, 1, C.plank);
  if (s.menu) return drawMenu(ctx, s, lang, count);
  const lay = layoutOf(s.mach);
  drawRopes(ctx, s, lay, lang);
  for (const b of s.mach.beams) drawBeam(ctx, s, lay, b, lang);
  drawLoads(ctx, s, lay);
  let lamps = 0;
  for (const b of s.mach.beams) {
    if (s.lamps[b.index]) lamps++;
    drawLamp(ctx, lay.rows[b.index], b, s.lamps[b.index], s.ev.tau[b.index], lang);
  }
  drawTray(ctx, s, lay);
  for (const p of s.sparks) rect(ctx, p.x, p.y, 3, 3, p.color);
  drawCursor(ctx, s, lay);
  drawHud(ctx, s, lang, count, lamps);
  drawBanner(ctx, s, lang);
  return undefined;
}
