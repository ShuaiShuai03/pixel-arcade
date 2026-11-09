// Rendering for the field, its HUD, the notice bar, and the field-select menu.
import { background, drawPixelText as text } from '../shared/utils.js';
import { neighbors } from './minefield-field.js';
import { cellName } from './minefield-solver.js';
import { LEVEL_COUNT, LEVELS, levelOf } from './minefield-levels.js';
import { MENU_COLUMNS, menuCell } from './minefield-menu.js';
import { MODE_BUTTON, TAP_MODES, placedFlags } from './minefield-actions.js';

const NUMBER_COLORS = Object.freeze([
  '',
  '#75b9f0',
  '#78be91',
  '#df9c88',
  '#b5a3db',
  '#dbc084',
  '#78c2c8',
  '#d6bbcd',
  '#edf0df',
]);
const TERRAIN_COLORS = Object.freeze(['#203c34', '#303d44', '#283d4e', '#33362f']);
const SECTOR_COLORS = Object.freeze(['#d2c8a1', '#a9cdc2', '#b7c6e1', '#dcb7b0']);
const LINE_WIDTH = 460;
const NOTICE_LINES = 2;
const glyphWidth = (ch) => (ch.charCodeAt(0) > 255 ? 10 : 6);
const textWidth = (str) => [...str].reduce((sum, ch) => sum + glyphWidth(ch), 0);

/** Wraps 10px notice text to the 480px canvas: at spaces in English, anywhere in Chinese. */
export function noticeLines(message, lang) {
  const tokens = lang === 'zh' ? [...message] : message.split(/(?<= )/),
    lines = [];
  let line = '';
  for (const token of tokens) {
    if (line && textWidth((line + token).trimEnd()) > LINE_WIDTH) {
      lines.push(line.trim());
      line = '';
    }
    line += token;
  }
  lines.push(line.trim());
  return lines;
}

export const noticeFits = (message, lang) => {
  const lines = noticeLines(message, lang);
  return lines.length <= NOTICE_LINES && lines.every((v) => textWidth(v) <= LINE_WIDTH);
};

function drawTile(ctx, s, i) {
  const l = s.layout,
    c = l.cell,
    x = l.x + (i % s.width) * c,
    y = l.y + Math.floor(i / s.width) * c;
  if (!s.mask[i]) {
    ctx.fillStyle = '#1b2b30';
    ctx.fillRect(x + 2, y + 2, c - 4, c - 4);
    ctx.strokeStyle = '#6c767160';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + c - 7);
    ctx.lineTo(x + c / 2, y + 6);
    ctx.lineTo(x + c - 6, y + c - 7);
    ctx.closePath();
    ctx.stroke();
    return;
  }
  const open = s.revealed[i],
    clue = open ? s.field.numbers[i] : 0;
  ctx.fillStyle = open ? '#3b5556' : '#a5ac92';
  ctx.fillRect(x + 1, y + 1, c - 2, c - 2);
  if (!open) {
    ctx.fillStyle = '#c3c9aa';
    ctx.fillRect(x + 2, y + 2, c - 4, 2);
    ctx.fillRect(x + 2, y + 2, 2, c - 4);
    ctx.fillStyle = '#677866';
    ctx.fillRect(x + 2, y + c - 4, c - 4, 2);
    ctx.fillRect(x + c - 4, y + 2, 2, c - 4);
    ctx.fillStyle = '#89997d';
    ctx.fillRect(x + c / 2 - 1, y + c / 2 - 1, 2, 2);
  } else if (clue)
    text(ctx, String(clue), x + c / 2, y + (c - 20) / 2, NUMBER_COLORS[clue], 18, 'center');
  else {
    ctx.fillStyle = '#759389';
    ctx.fillRect(x + c / 2 - 1, y + c / 2 - 1, 2, 2);
  }
  if (s.flags[i]) {
    ctx.fillStyle = s.verified[i] ? '#8ddfca' : '#754a43';
    ctx.fillRect(x + Math.floor(c / 2) - 4, y + 6, 2, c - 11);
    ctx.fillRect(x + Math.floor(c / 2) - 7, y + c - 7, 10, 2);
    ctx.beginPath();
    ctx.moveTo(x + c / 2 - 2, y + 6);
    ctx.lineTo(x + c / 2 + 6, y + 9);
    ctx.lineTo(x + c / 2 - 2, y + 13);
    ctx.fill();
  } else if (s.questions[i]) text(ctx, '?', x + c / 2, y + (c - 20) / 2, '#493f31', 18, 'center');
  if (s.phase === 'lost' && s.field.mines[i]) {
    ctx.fillStyle = s.triggered.includes(i) ? '#df765f' : '#d2b6a0';
    ctx.beginPath();
    ctx.arc(x + c / 2, y + c / 2, c * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + c / 2 - 1, y + 5, 2, c - 10);
    ctx.fillRect(x + 5, y + c / 2 - 1, c - 10, 2);
  }
}

function drawSectors(ctx, s, env) {
  const l = s.layout;
  s.regions.forEach((r, n) => {
    const cols = r.cells.map((i) => i % s.width),
      first = Math.min(...cols),
      last = Math.max(...cols),
      total = s.field ? r.total : '?';
    text(
      ctx,
      env.t(`S${n + 1}: ${total} ${total === 1 ? 'mine' : 'mines'}`, `${n + 1}区：${total}雷`),
      l.x + ((first + last + 1) / 2) * l.cell,
      l.y - 12,
      SECTOR_COLORS[n % SECTOR_COLORS.length],
      10,
      'center',
    );
    if (n === s.regions.length - 1) return;
    ctx.strokeStyle = '#b5cbcd80';
    ctx.beginPath();
    ctx.moveTo(l.x + (last + 1) * l.cell, l.y);
    ctx.lineTo(l.x + (last + 1) * l.cell, l.y + s.height * l.cell);
    ctx.stroke();
  });
}

function drawPanels(ctx, s, env) {
  const safe = s.mask.filter(Boolean).length - s.mineCount,
    flags = s.flagLimit
      ? `${placedFlags(s)}/${s.flagLimit}`
      : String(s.flags.filter(Boolean).length);
  text(
    ctx,
    env.t(
      `SAFE ${s.revealed.filter(Boolean).length}/${safe}`,
      `安全 ${s.revealed.filter(Boolean).length}/${safe}`,
    ),
    8,
    35,
    '#bfd6c0',
    10,
  );
  text(ctx, env.t('PROBES', '探针'), 8, 65, '#c5ccae', 9);
  text(ctx, String(s.probes), 28, 79, '#e6d49e', 21, 'center');
  text(ctx, env.t('FLAGS', '旗帜'), 8, 117, '#c5ccae', 9);
  text(ctx, flags, 28, 131, '#e1ccb4', s.flagLimit ? 13 : 19, 'center');
  text(ctx, env.t('CURSOR', '光标'), 8, 174, '#b5c7b9', 9);
  text(ctx, cellName(s.cursor, s.width), 28, 189, '#f1dda4', 13, 'center');
  for (let m = 0; m < TAP_MODES; m++) {
    const top = MODE_BUTTON.y + m * MODE_BUTTON.step;
    ctx.fillStyle = m === s.tapMode ? '#b6a16d' : '#465e5d';
    ctx.fillRect(MODE_BUTTON.x, top, MODE_BUTTON.w, MODE_BUTTON.h);
    text(
      ctx,
      env.t(['REVEAL', 'MARK', 'SELECT'][m], ['揭开', '标记', '选择'][m]),
      MODE_BUTTON.x + MODE_BUTTON.w / 2,
      top + 10,
      m === s.tapMode ? '#182d30' : '#e2dec1',
      10,
      'center',
    );
  }
  text(ctx, env.t('H: proof', 'H：推理'), 435, 188, '#bed2bc', 10, 'center');
  text(ctx, env.t('I: inspect', 'I：检查'), 435, 206, '#bed2bc', 10, 'center');
  text(ctx, env.t('X: probe', 'X：探针'), 435, 224, '#bed2bc', 10, 'center');
}

function drawNotice(ctx, s, env) {
  ctx.fillStyle = '#102930';
  ctx.fillRect(0, 287, 480, 33);
  noticeLines(env.t(s.notice.en, s.notice.zh), env.lang)
    .slice(0, NOTICE_LINES)
    .forEach((v, n) => text(ctx, v, 240, 291 + n * 13, '#d3d7bf', 10, 'center'));
}

export function drawField(ctx, s, env) {
  background(ctx, TERRAIN_COLORS[Math.floor((s.level - 1) / 5)]);
  const l = s.layout,
    adjacent = s.inspect >= 0 ? new Set(neighbors(s.inspect, s.width, s.height)) : new Set(),
    proof = new Set(s.hint?.cells ?? []);
  ctx.strokeStyle = '#ffffff05';
  ctx.lineWidth = 1;
  for (let x = 4; x < 480; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x, 286);
    ctx.stroke();
  }
  for (let i = 0; i < s.mask.length; i++) {
    drawTile(ctx, s, i);
    if (!s.mask[i] || !(adjacent.has(i) || proof.has(i))) continue;
    ctx.strokeStyle = proof.has(i) ? '#b6d7f0' : '#9dc4b2';
    ctx.strokeRect(
      l.x + (i % s.width) * l.cell + 3,
      l.y + Math.floor(i / s.width) * l.cell + 3,
      l.cell - 6,
      l.cell - 6,
    );
  }
  ctx.strokeStyle = s.hint ? '#94e7d0' : '#fff0b4';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    l.x + (s.cursor % s.width) * l.cell + 1,
    l.y + Math.floor(s.cursor / s.width) * l.cell + 1,
    l.cell - 2,
    l.cell - 2,
  );
  ctx.fillStyle = '#112a30';
  ctx.fillRect(0, 0, 480, 30);
  const name = levelOf(s.level).name;
  text(ctx, `${s.level}/${LEVEL_COUNT} ${env.t(name.en, name.zh)}`, 12, 7, '#e4e5c5', 13);
  text(ctx, env.t(`MINES ${s.mineCount}`, `地雷 ${s.mineCount}`), 466, 7, '#edd29c', 12, 'right');
  drawSectors(ctx, s, env);
  drawPanels(ctx, s, env);
  drawNotice(ctx, s, env);
  if (!s.betweenStages) return;
  ctx.fillStyle = '#16313bf5';
  ctx.fillRect(72, 126, 336, 82);
  ctx.strokeStyle = '#d6c38e';
  ctx.strokeRect(74, 128, 332, 78);
  text(ctx, env.t('SITE MAPPED', '本处已探明'), 240, 138, '#f0dda2', 17, 'center');
  text(ctx, env.t('ENTER: next field', '回车前往下一处'), 240, 175, '#c3dac4', 11, 'center');
}

export function drawMenu(ctx, env, menu) {
  background(ctx, '#203c34');
  ctx.fillStyle = '#112a30';
  ctx.fillRect(0, 0, 480, 30);
  text(ctx, env.t('CHOOSE A FIELD', '选择勘探地'), 240, 8, '#e4e5c5', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      here = n === menu.cursor;
    ctx.fillStyle = locked ? '#27383a' : here ? '#b6a16d' : '#465e5d';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(
      ctx,
      String(n),
      q.x + q.w / 2,
      q.y + 12,
      locked ? '#5d7370' : here ? '#182d30' : '#e2dec1',
      16,
      'center',
    );
    if (here) {
      ctx.strokeStyle = '#fff0b4';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x + 1, q.y + 1, q.w - 2, q.h - 2);
    }
  }
  const level = LEVELS[menu.cursor - 1];
  text(ctx, env.t(level.name.en, level.name.zh), 240, 232, '#f1dda4', 14, 'center');
  text(
    ctx,
    env.t(
      `${level.w}x${level.h} · ${level.mines} mines`,
      `${level.w}x${level.h} · ${level.mines}雷`,
    ),
    240,
    252,
    '#bfd6c0',
    11,
    'center',
  );
  const tip = env.t(level.teach.en, level.teach.zh);
  noticeLines(tip, env.lang)
    .slice(0, NOTICE_LINES)
    .forEach((v, n) => text(ctx, v, 240, 271 + n * 13, '#d3d7bf', 10, 'center'));
  if (menu.unlocked < LEVEL_COUNT)
    text(
      ctx,
      env.t('Locked fields open as you clear them', '通关后解锁更多勘探地'),
      240,
      218,
      '#8aa09a',
      9,
      'center',
    );
}
