import { background, drawPixelText as text } from '../shared/utils.js';
import {
  RULES,
  DIRS,
  DX,
  DY,
  ARROWS,
  bit,
  popcount,
  nodeOf,
  canTurn,
  networkAt,
} from './circuit-weaver-engine.js';
import { BOARD_COUNT } from './circuit-weaver-boards.js';

const R = RULES;
const STEP = R.step;

// --- Layout ---
export function layoutOf(board) {
  const tile = Math.min(48, Math.floor(468 / board.cols), Math.floor(236 / board.rows));
  return {
    tile,
    x: Math.round((480 - tile * board.cols) / 2),
    y: 32 + Math.round((236 - tile * board.rows) / 2),
  };
}

export function menuLayout(count) {
  const cols = R.menuCols;
  return {
    cols,
    cell: 48,
    x: Math.round((480 - cols * 48) / 2),
    y: 76,
    rows: Math.ceil(count / cols),
  };
}

// --- Drawing ---
const PALETTE = {
  board: '#0c2a22',
  boardLine: '#14463a',
  pad: '#0f3a30',
  copper: '#b87333',
  copperDim: '#6f5236',
  ink: '#e6f0e8',
  warn: '#ff4d4d',
  gold: '#ffd166',
  panel: '#07130f',
  screw: '#2d3b36',
};
const VOLT_COLOR = { 3: '#4cc9f0', 5: '#8be36b', 9: '#ff9f1c', 12: '#f78fe0' };
const voltColor = (v) => VOLT_COLOR[v] || '#ffffff';

function frac(n) {
  return n - Math.floor(n);
}

function trackColor(an, board, root, flash) {
  const v = an.net.volts[root];
  if (!v) return PALETTE.copperDim;
  if (popcount(v) > 1) return flash ? PALETTE.warn : '#a02020';
  return voltColor(board.volts[Math.log2(v)]);
}

function drawTrack(ctx, x, y, size, d, color, width) {
  const mid = size / 2;
  const len = size / 2;
  ctx.fillStyle = color;
  if (d === 0) ctx.fillRect(x + mid - width / 2, y, width, len + width / 2);
  if (d === 2) ctx.fillRect(x + mid - width / 2, y + mid - width / 2, width, len + width / 2);
  if (d === 1) ctx.fillRect(x + mid - width / 2, y + mid - width / 2, len + width / 2, width);
  if (d === 3) ctx.fillRect(x, y + mid - width / 2, len + width / 2, width);
}

function drawPulse(ctx, x, y, size, d, phase, width) {
  const mid = size / 2;
  const t = frac(phase);
  const off = t * mid;
  const dx = DX[d] * off;
  const dy = DY[d] * off;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(
    Math.round(x + mid + dx - width / 2),
    Math.round(y + mid + dy - width / 2),
    width,
    width,
  );
}

function drawTile(ctx, s, i, x, y, size, time) {
  const b = s.board;
  const cell = b.cells[i];
  const an = s.an;
  const mask = an.mask[i];
  const width = Math.max(5, Math.round(size * 0.2));
  const flash = Math.floor(time * 4) % 2 === 0;
  ctx.fillStyle = PALETTE.pad;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  if (cell.type === 'source' || cell.type === 'sink') {
    drawTerminal(ctx, s, i, x, y, size, time, flash);
    return;
  }
  for (let d = 0; d < 4; d++) {
    if (!(mask & bit(d))) continue;
    const root = an.net.find(nodeOf(b, i, d));
    const color = trackColor(an, b, root, flash);
    if (cell.type === 'bridge' && d & 1) drawTrack(ctx, x, y, size, d, color, width - 1);
    else drawTrack(ctx, x, y, size, d, color, width);
    const live = an.net.volts[root] && !an.shortRoots.has(root);
    if (live)
      drawPulse(ctx, x, y, size, d, time * 1.4 - ((i + d) % 5) * 0.11, Math.max(3, width - 2));
  }
  if (cell.type === 'bridge') {
    ctx.fillStyle = PALETTE.pad;
    ctx.fillRect(x + size / 2 - width, y + size / 2 - width, width * 2, width * 2);
    ctx.fillStyle = trackColor(an, b, an.net.find(2 * i + 1), flash);
    ctx.fillRect(x + size / 2 - width, y + size / 2 - 2, width * 2, 4);
    ctx.fillStyle = PALETTE.copper;
    ctx.fillRect(x + size / 2 - 2, y + size / 2 - width, 4, 3);
    ctx.fillRect(x + size / 2 - 2, y + size / 2 + width - 3, 4, 3);
  } else if (mask) {
    ctx.fillStyle = trackColor(an, b, an.net.find(2 * i), flash);
    ctx.fillRect(x + size / 2 - width / 2, y + size / 2 - width / 2, width, width);
  }
  if (cell.locked || (!canTurn(cell) && cell.type !== 'empty')) {
    ctx.fillStyle = PALETTE.screw;
    for (const [sx, sy] of [
      [3, 3],
      [size - 6, 3],
      [3, size - 6],
      [size - 6, size - 6],
    ])
      ctx.fillRect(x + sx, y + sy, 3, 3);
  }
}

function drawTerminal(ctx, s, i, x, y, size, time, flash) {
  const b = s.board;
  const cell = b.cells[i];
  const an = s.an;
  const isSource = cell.type === 'source';
  const color = voltColor(cell.volt);
  const sink = an.sinks.find((k) => k.index === i);
  const lit = isSource || sink.status === 'ok';
  const width = Math.max(5, Math.round(size * 0.2));
  const root = an.net.find(2 * i);
  drawTrack(
    ctx,
    x,
    y,
    size,
    cell.dir,
    isSource || lit ? color : trackColor(an, b, root, flash),
    width,
  );
  const q = Math.round(size * 0.24);
  ctx.fillStyle = lit ? color : '#10201b';
  ctx.fillRect(x + q, y + q, size - 2 * q, size - 2 * q);
  ctx.fillStyle = isSource ? '#06110d' : lit ? '#06110d' : color;
  const bad = sink && (sink.status === 'wrong' || sink.status === 'short');
  if (!isSource) {
    ctx.fillStyle = bad && flash ? PALETTE.warn : lit ? '#ffffff' : color;
    ctx.fillRect(x + q, y + q, size - 2 * q, 2);
    ctx.fillRect(x + q, y + size - q - 2, size - 2 * q, 2);
    ctx.fillRect(x + q, y + q, 2, size - 2 * q);
    ctx.fillRect(x + size - q - 2, y + q, 2, size - 2 * q);
  }
  text(ctx, `${cell.volt}V`, x + size / 2, y + size / 2 - 5, lit ? '#06110d' : color, 11, 'center');
  if (!isSource && lit) {
    const p = Math.floor(time * 3) % 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + size / 2 - 1 + (p ? 3 : -3), y + 3, 2, 2);
  }
}

function drawBoard(ctx, s, time) {
  const b = s.board;
  const lay = layoutOf(b);
  ctx.fillStyle = PALETTE.board;
  ctx.fillRect(lay.x - 4, lay.y - 4, lay.tile * b.cols + 8, lay.tile * b.rows + 8);
  ctx.fillStyle = PALETTE.boardLine;
  for (let c = 0; c <= b.cols; c++)
    ctx.fillRect(lay.x + c * lay.tile - 1, lay.y, 1, lay.tile * b.rows);
  for (let r = 0; r <= b.rows; r++)
    ctx.fillRect(lay.x, lay.y + r * lay.tile - 1, lay.tile * b.cols, 1);
  const inspected = s.inspect ? networkAt(b, s.an, s.cursor.r * b.cols + s.cursor.c) : [];
  const marked = new Set(inspected.flatMap((n) => n.tiles));
  b.cells.forEach((cell, i) => {
    const x = lay.x + (i % b.cols) * lay.tile;
    const y = lay.y + Math.floor(i / b.cols) * lay.tile;
    drawTile(ctx, s, i, x, y, lay.tile, time);
    if (marked.has(i)) {
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(x + 1, y + 1, lay.tile - 2, 2);
      ctx.fillRect(x + 1, y + lay.tile - 3, lay.tile - 2, 2);
    }
  });
  const flash = Math.floor(time * 4) % 2 === 0;
  if (s.board.sealed || s.an.shorts.length)
    for (const leak of s.an.leaks) {
      const x = lay.x + leak.c * lay.tile + lay.tile / 2 + DX[leak.dir] * (lay.tile / 2 - 4) - 2;
      const y = lay.y + leak.r * lay.tile + lay.tile / 2 + DY[leak.dir] * (lay.tile / 2 - 4) - 2;
      ctx.fillStyle = flash ? PALETTE.warn : '#802020';
      ctx.fillRect(x, y, 5, 5);
    }
  return lay;
}

function drawCursor(ctx, s, lay, time, advice) {
  const hint = advice?.hint;
  if (hint && hint.press !== 'KeyZ') {
    const x = lay.x + hint.c * lay.tile;
    const y = lay.y + hint.r * lay.tile;
    ctx.fillStyle = Math.floor(time * 3) % 2 ? PALETTE.gold : '#fff2c4';
    ctx.fillRect(x, y, lay.tile, 3);
    ctx.fillRect(x, y + lay.tile - 3, lay.tile, 3);
    ctx.fillRect(x, y, 3, lay.tile);
    ctx.fillRect(x + lay.tile - 3, y, 3, lay.tile);
  }
  const cx = lay.x + s.cursor.c * lay.tile;
  const cy = lay.y + s.cursor.r * lay.tile;
  ctx.fillStyle = '#ffffff';
  const k = 8;
  for (const [ax, ay, sx, sy] of [
    [cx, cy, 1, 1],
    [cx + lay.tile, cy, -1, 1],
    [cx, cy + lay.tile, 1, -1],
    [cx + lay.tile, cy + lay.tile, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? ax : ax - k, ay + (sy > 0 ? 0 : -2), k, 2);
    ctx.fillRect(sx > 0 ? ax : ax - 2, sy > 0 ? ay : ay - k, 2, k);
  }
  if (hint && hint.dir) {
    const d = DIRS.indexOf(hint.dir);
    text(ctx, ARROWS[d], cx + lay.tile / 2, cy + lay.tile / 2 - 8, PALETTE.gold, 16, 'center');
  }
  if (hint && hint.press === 'Space')
    text(ctx, '↻', cx + lay.tile - 8, cy + 1, PALETTE.gold, 12, 'center');
}

function drawHud(ctx, s, env) {
  const b = s.board;
  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(0, 0, 480, 28);
  text(ctx, `${s.level + 1}/${BOARD_COUNT} ${env.t(b.name.en, b.name.zh)}`, 8, 7, PALETTE.ink, 12);
  const turns = b.budget === null ? `${s.moves}` : `${Math.min(s.moves, b.budget)}/${b.budget}`;
  text(
    ctx,
    env.t(`Turns ${turns}`, `转动 ${turns}`),
    330,
    7,
    b.budget !== null && s.moves >= b.budget - 1 ? PALETTE.gold : PALETTE.ink,
    12,
    'right',
  );
  for (let f = 0; f < R.fuses; f++) {
    ctx.fillStyle = f < s.fuses ? PALETTE.gold : '#3a3a3a';
    ctx.fillRect(344 + f * 14, 8, 10, 12);
  }
  text(ctx, `${env.t('Score', '得分')} ${s.score}`, 472, 7, PALETTE.ink, 12, 'right');
}

function drawFooter(ctx, s, env, advice, banner) {
  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(0, 272, 480, 48);
  const bad = s.stage === 'play' && s.an.shorts.length > 0;
  if (s.stage === 'play' && s.phase === 'playing')
    text(ctx, env.t(advice.en, advice.zh), 240, 276, PALETTE.gold, 12, 'center');
  const info = s.msg ? env.t(s.msg.en, s.msg.zh) : env.t(banner.en, banner.zh);
  let line = info;
  if (s.inspect && s.stage === 'play') {
    const nets = networkAt(s.board, s.an, s.cursor.r * s.board.cols + s.cursor.c);
    line = nets.length
      ? nets.map((n) => inspectText(n, env)).join('   ')
      : env.t('Empty cell', '空格');
  }
  const tipping =
    !s.inspect && !s.msg && !bad && s.stage === 'play' && s.tipLeft > 0 && s.moves === 0;
  if (tipping) line = env.t(s.board.tip.en, s.board.tip.zh);
  text(
    ctx,
    line,
    240,
    298,
    bad ? PALETTE.warn : tipping ? PALETTE.gold : PALETTE.ink,
    12,
    'center',
  );
}

function inspectText(net, env) {
  const v = net.volts.map((x) => `${x} V`).join(' + ');
  if (net.kind === 'short') return env.t(`SHORT ${v}`, `短路 ${v}`);
  if (net.kind === 'live')
    return env.t(`Net ${v}, ${net.tiles.length} tiles`, `线网 ${v}，${net.tiles.length} 块`);
  return env.t('Decorative wire: no source', '装饰导线：没有电源');
}

function drawMenu(ctx, s, env) {
  background(ctx, PALETTE.board);
  text(ctx, env.t('Circuit Weaver', '电路织匠'), 240, 18, PALETTE.gold, 20, 'center');
  text(ctx, env.t('Pick a board', '选择电路板'), 240, 48, PALETTE.ink, 12, 'center');
  const lay = menuLayout(BOARD_COUNT);
  for (let n = 1; n <= BOARD_COUNT; n++) {
    const x = lay.x + ((n - 1) % lay.cols) * lay.cell;
    const y = lay.y + Math.floor((n - 1) / lay.cols) * lay.cell;
    const open = n <= s.menu.unlocked;
    ctx.fillStyle = n === s.menu.sel ? PALETTE.gold : open ? PALETTE.pad : '#0a1a15';
    ctx.fillRect(x + 3, y + 3, lay.cell - 6, lay.cell - 6);
    text(
      ctx,
      String(n),
      x + lay.cell / 2,
      y + 15,
      n === s.menu.sel ? '#06110d' : open ? PALETTE.ink : '#3b4f48',
      14,
      'center',
    );
  }
  text(
    ctx,
    env.t('Arrows pick, Space starts', '方向键选择，空格开始'),
    240,
    290,
    PALETTE.ink,
    12,
    'center',
  );
}

export function drawGame(ctx, s, env, advice, banner) {
  if (s.stage === 'menu') return drawMenu(ctx, s, env);
  const time = s.ticks * STEP;
  background(ctx, PALETTE.panel);
  const lay = drawBoard(ctx, s, time);
  const playing = s.phase === 'playing' && s.stage === 'play';
  if (playing) drawCursor(ctx, s, lay, time, advice);
  drawHud(ctx, s, env);
  drawFooter(ctx, s, env, advice, banner);
}
