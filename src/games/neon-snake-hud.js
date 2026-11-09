// Neon Snake header, level select and banners. All text fits the 480 x 320 canvas in EN and ZH.
import { drawPixelText as text } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './neon-snake-levels.js';
import { focusLabel } from './neon-snake-text.js';
import { CELL, TOP, arrow, drawBoard } from './neon-snake-draw.js';
import { menuCell } from './neon-snake-menu.js';

const CJK = /[　-鿿＀-￯]/;
const glyphWidth = (ch, size) => (CJK.test(ch) ? size : size * 0.62);

/** Break a line into rows no wider than maxWidth: at spaces for English, anywhere for Chinese. */
export function wrapText(line, maxWidth, size) {
  const rows = [];
  let row = '',
    width = 0;
  for (const word of line.split(/(?<=[ ])|(?=[　-鿿＀-￯])/)) {
    const w = [...word].reduce((sum, ch) => sum + glyphWidth(ch, size), 0);
    if (row && width + w > maxWidth) {
      rows.push(row.trimEnd());
      row = '';
      width = 0;
    }
    row += word;
    width += w;
  }
  rows.push(row.trimEnd());
  return rows;
}

function drawHeader(ctx, s, env) {
  const level = LEVELS[s.level - 1];
  ctx.fillStyle = '#102a35';
  ctx.fillRect(0, 0, 480, 40);
  text(
    ctx,
    `${s.level}/${LEVEL_COUNT} ${env.t(level.name.en, level.name.zh)}`,
    12,
    4,
    '#bfdbb8',
    11,
  );
  text(
    ctx,
    env.t(`FRUIT ${s.stageFruit}/${s.target}`, `果实 ${s.stageFruit}/${s.target}`),
    468,
    4,
    '#f4d19a',
    12,
    'right',
  );
  text(
    ctx,
    env.t(s.calm ? 'C: CALM' : 'C: NORMAL', s.calm ? 'C：舒缓' : 'C：标准'),
    304,
    4,
    '#adc9ca',
    10,
  );
  text(ctx, env.t(`LEN ${s.snake.length}`, `长度 ${s.snake.length}`), 12, 24, '#a9c8b3', 10);
  if (s.gates.length) {
    text(ctx, Math.floor(s.stageSteps / s.gatePeriod) % 2 === 0 ? 'A' : 'B', 70, 24, '#dfc28f', 10);
    for (let k = 0; k < s.gatePeriod; k++) {
      ctx.fillStyle = k < s.gatePeriod - (s.stageSteps % s.gatePeriod) ? '#bdd2a1' : '#385763';
      ctx.fillRect(82 + k * 7, 26, 5, 5);
    }
  }
  if (s.underpasses.length)
    text(
      ctx,
      s.crossingFrom
        ? env.t('PASS 1/2', '通过 1/2')
        : env.t(`PASS ${s.crossings}`, `通过 ${s.crossings}`),
      125,
      24,
      '#abc9c0',
      10,
    );
  text(ctx, env.t('FOCUS', '专注'), 235, 2, '#c2d7c6', 10, 'center');
  for (let n = 0; n < 10; n++) {
    ctx.fillStyle = '#34585d';
    ctx.fillRect(185 + n * 10, 16, 9, 6);
    ctx.fillStyle = s.braking ? '#ecd5a0' : s.brake < 0.1 || s.focusLocked ? '#9c8c75' : '#7dbba3';
    ctx.fillRect(185 + n * 10, 16, Math.max(0, Math.min(9, s.brake * 100 - n * 10)), 6);
  }
  ctx.fillStyle = '#e5d7ad';
  ctx.fillRect(194, 14, 1, 10);
  text(ctx, env.t(...focusLabel(s)), 235, 27, '#b9cdba', 10, 'center');
  text(ctx, env.t('NEXT', '下步'), 306, 25, '#89b9bf', 10);
  for (let n = 0; n < s.queue.length; n++) arrow(ctx, 354 + n * 24, 29, s.queue[n], '#c4dfce', 5);
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = '#0e2833ef';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fac9d';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

const READY_PANEL = { x: 30, w: 420, h: 76 };
const READY_TOPS = [236, 44, 140];

/** Countdown panel rectangle: the first position that leaves the head, the cells ahead and the fruit visible. */
export function readyPanel(level) {
  const head = level.snake[0],
    cells = [
      ...Array.from({ length: 4 }, (_, i) => ({
        x: head.x + level.direction.x * i,
        y: head.y + level.direction.y * i,
      })),
      ...level.beds[0],
    ];
  const clear = (y) =>
    cells.every((p) => {
      const top = TOP + p.y * CELL;
      return (
        top + CELL <= y ||
        top >= y + READY_PANEL.h ||
        (p.x + 1) * CELL <= READY_PANEL.x ||
        p.x * CELL >= READY_PANEL.x + READY_PANEL.w
      );
    });
  const y = READY_TOPS.find(clear) ?? READY_TOPS[0];
  return { x: READY_PANEL.x, y, w: READY_PANEL.w, h: READY_PANEL.h };
}

function drawReady(ctx, s, env) {
  const level = LEVELS[s.level - 1],
    box = readyPanel(level);
  panel(ctx, box.x, box.y, box.w, box.h);
  text(
    ctx,
    env.t(`LEVEL ${s.level} · ${level.name.en}`, `第${s.level}关 · ${level.name.zh}`),
    240,
    box.y + 7,
    '#e2dda4',
    13,
    'center',
  );
  wrapText(env.t(level.tip.en, level.tip.zh), 390, 11).forEach((row, i) =>
    text(ctx, row, 240, box.y + 28 + i * 14, '#c1d9c5', 11, 'center'),
  );
  text(
    ctx,
    env.t(`Starting in ${Math.ceil(s.ready)}`, `${Math.ceil(s.ready)}秒后开始`),
    240,
    box.y + 61,
    '#91b0b4',
    10,
    'center',
  );
}

function drawCleared(ctx, s, env) {
  const next = LEVELS[s.level];
  panel(ctx, 58, 128, 364, 106);
  text(ctx, env.t('LEVEL CLEARED', '本关通过'), 240, 141, '#e2dda4', 16, 'center');
  text(
    ctx,
    env.t(`ENTER: ${next.name.en}`, `回车前往：${next.name.zh}`),
    240,
    170,
    '#c1d9c5',
    12,
    'center',
  );
  text(
    ctx,
    env.t('Focus refills on the next level', '下一关开始时专注补满'),
    240,
    192,
    '#a7c8be',
    11,
    'center',
  );
  text(
    ctx,
    env.t('The next level waits for your command', '准备好后再进入下一关'),
    240,
    212,
    '#91b0b4',
    10,
    'center',
  );
}

function cellLabel(n, unlocked, env) {
  if (n > unlocked) return env.t('LOCKED', '未解锁');
  if (n < unlocked) return env.t('CLEARED', '已通关');
  return n === LEVEL_COUNT ? env.t('FINAL', '最终') : env.t('NEXT', '下一关');
}

export function drawMenu(ctx, menu, env) {
  ctx.fillStyle = '#102530';
  ctx.fillRect(0, 0, 480, 320);
  text(ctx, env.t('CHOOSE A LEVEL', '选择关卡'), 240, 8, '#e2dda4', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? '#1d4a48' : '#16303a';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    text(ctx, String(n), q.x + q.w / 2, q.y + 5, open ? '#e2dda4' : '#5f7b80', 14, 'center');
    text(
      ctx,
      cellLabel(n, menu.unlocked, env),
      q.x + q.w / 2,
      q.y + 23,
      open ? '#a9d4b5' : '#5f7b80',
      9,
      'center',
    );
    if (n === menu.cursor) {
      ctx.strokeStyle = '#f4d19a';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x - 1, q.y - 1, q.w + 2, q.h + 2);
    }
  }
  const chosen = LEVELS[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + 48;
  text(
    ctx,
    `${menu.cursor}. ${env.t(chosen.name.en, chosen.name.zh)}`,
    240,
    top,
    '#e2dda4',
    13,
    'center',
  );
  wrapText(env.t(chosen.tip.en, chosen.tip.zh), 440, 11).forEach((row, i) =>
    text(ctx, row, 240, top + 20 + i * 14, '#c1d9c5', 11, 'center'),
  );
  text(
    ctx,
    env.t('Arrows move · Enter or tap starts', '方向键移动 · 回车或点按开始'),
    240,
    300,
    '#91b0b4',
    10,
    'center',
  );
}

export function drawGame(ctx, s, env, menu) {
  if (menu) {
    drawMenu(ctx, menu, env);
    return;
  }
  drawBoard(ctx, s, LEVELS[s.level - 1].theme);
  drawHeader(ctx, s, env);
  if (s.ready > 0) drawReady(ctx, s, env);
  if (s.betweenGardens) drawCleared(ctx, s, env);
}
