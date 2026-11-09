// Gem Match drawing: garden board, goal panel, garden select. All text fits 480 x 320 in EN and ZH.
import { background, drawPixelText as text, clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, GEM_NAMES } from './gem-match-levels.js';
import { SIZE } from './gem-match-rules.js';
import { X, Y, CELL, center, gemObjective } from './gem-match-step.js';
import { menuCell } from './gem-match-menu.js';

const COLORS = ['#d96b75', '#64b99c', '#e2bc61', '#79a6cc', '#ae8fc5', '#d58d60'];
const CJK = /[　-鿿＀-￯]/;
const glyphWidth = (ch, size) => (CJK.test(ch) ? size : size * 0.62);
const SKY = ['#172d30', '#1c3030', '#26332c'];
// One distinct silhouette per gem kind, so shape alone identifies a gem (and a bed's wanted gem).
const SPRITES = [
  ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'],
  ['.....##.', '...####.', '..#####.', '.######.', '.#####..', '.####...', '..##....', '..#.....'],
  ['#..##..#', '.#.##.#.', '..####..', '########', '########', '..####..', '.#.##.#.', '#..##..#'],
  ['...##...', '...##...', '..####..', '.######.', '########', '########', '.######.', '..####..'],
  ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'],
  ['########', '########', '.######.', '.######.', '..####..', '..####..', '...##...', '...##...'],
];
const smooth = (t) => t * t * (3 - 2 * t);

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
export function gemSwapPose(sw) {
  const t = clamp(sw.time / sw.duration, 0, 1),
    travel = smooth(clamp((t - 0.25) / 0.5, 0, 1)),
    v = sw.returning ? 1 - travel : travel,
    lift = 24 * Math.min(smooth(clamp(t / 0.25, 0, 1)), smooth(clamp((1 - t) / 0.25, 0, 1))),
    a = center(sw.a.x, sw.a.y),
    b = center(sw.b.x, sw.b.y);
  return {
    a: { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v, z: lift },
    b: { x: b.x + (a.x - b.x) * v, y: b.y + (a.y - b.y) * v, z: -lift },
  };
}
function gem(ctx, type, x, y, z = 0, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (z) {
    ctx.fillStyle = '#07191dcc';
    ctx.fillRect(Math.round(x - 12), Math.round(y + 4), 24, 9);
    ctx.strokeStyle = '#c4bd7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - z * 0.5);
    ctx.stroke();
    y -= z * 0.5;
  }
  ctx.fillStyle = '#071d22';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 15), 32, 32);
  ctx.fillStyle = '#47665c';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 16), 32, 30);
  ctx.fillStyle = '#769481';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 17), 32, 3);
  ctx.fillStyle = '#bfd2aa';
  ctx.fillRect(Math.round(x - 13), Math.round(y + 14), 7, 3);
  ctx.fillRect(Math.round(x + 6), Math.round(y + 14), 7, 3);
  if (z) {
    ctx.fillStyle = '#07191dcc';
    ctx.fillRect(Math.round(x - 10), Math.round(y + 5), 20, 7);
  }
  const top = Math.round(y - 12),
    left = Math.round(x - 12);
  SPRITES[type].forEach((row, r) =>
    [...row].forEach((cell, c) => {
      if (cell !== '#') return;
      ctx.fillStyle = r + c < 5 ? '#f3e4bd' : r + c > 10 ? '#243e43' : COLORS[type];
      ctx.fillRect(left + c * 3, top + r * 3, 3, 3);
    }),
  );
  ctx.fillStyle = '#f6e7bf';
  if (type === 0) {
    ctx.fillRect(x - 1, y - 6, 2, 12);
    ctx.fillRect(x - 6, y - 1, 12, 2);
  } else if (type === 1) {
    ctx.fillStyle = '#194d43';
    ctx.fillRect(x - 1, y - 5, 2, 11);
    ctx.fillRect(x - 4, y + 1, 3, 2);
  } else if (type === 2) {
    ctx.fillStyle = '#765c32';
    ctx.fillRect(x - 3, y - 3, 6, 6);
  } else if (type === 3) {
    ctx.fillStyle = '#2c4f76';
    ctx.fillRect(x - 2, y - 1, 4, 6);
  } else if (type === 4) ctx.fillRect(x - 2, y - 2, 4, 4);
  ctx.globalAlpha = 1;
}
export function instruction(s, env) {
  if (s.mode === 'garden-clear')
    return env.t('GARDEN RESTORED · SPACE / TAP FOR NEXT', '花园已修复 · 空格 / 点按进入下一关');
  if (s.mode === 'mix-lift') return env.t('NO MOVES LEFT · FREE REMIX', '没有可行交换 · 免费重排');
  if (s.mode === 'fall')
    return env.t('Gravity rails · wait for every gem to settle', '重力轨道 · 等待宝石全部落稳');
  if (s.mode === 'clear')
    return s.combo > 1
      ? env.t(`CASCADE ×${s.combo}`, `连锁 ×${s.combo}`)
      : env.t('Match found · clearing together', '连线成功 · 同时消除');
  if (s.mode === 'swap')
    return env.t('Powered lift lanes · swap in progress', '升降轨道 · 正在交换');
  if (s.phase === 'won') return env.t('ALL GARDENS RESTORED', '所有花园修复完成');
  if (s.phase === 'lost') return env.t('OUT OF MOVES · RESTART TO REPLANT', '步数用完 · 重新种植');
  if (s.feedbackTime > 0 && s.feedback === 'invalid')
    return env.t('No match · both gems returned · no move cost', '没有连线 · 宝石归位 · 不扣步数');
  return s.selected
    ? env.t('Choose an adjacent gem · same gem cancels', '选择相邻宝石 · 再选同一颗取消')
    : env.t('Select a gem, then its neighbor · H for hint', '选择宝石，再选相邻宝石 · H提示');
}
/** The bottom bar teaches the garden's goal until the first swap, then shows the live instruction. */
export function barLines(s, env) {
  const data = LEVELS[s.level - 1];
  if (s.mode === 'ready' && s.moves === data.moves && !s.selected)
    return wrapText(env.t(data.tip.en, data.tip.zh), 460, 10);
  return [instruction(s, env)];
}
function drawGoals(ctx, s, env) {
  ctx.fillStyle = '#10262a';
  ctx.fillRect(370, 42, 102, 244);
  text(ctx, env.t('GOAL', '目标'), 380, 50, '#91b5a1', 10);
  gemObjective(s).goals.forEach((g, i) => {
    const top = 68 + i * 70,
      shown = Math.min(g.progress, g.target),
      label =
        g.kind === 'score'
          ? env.t('BLOOM', '积分')
          : g.kind === 'soil'
            ? env.t('SOIL BEDS', '土壤')
            : env.t(GEM_NAMES[g.color].en.toUpperCase(), GEM_NAMES[g.color].zh);
    if (g.kind === 'collect') gem(ctx, g.color, 394, top + 14);
    text(
      ctx,
      label,
      g.kind === 'collect' ? 414 : 380,
      top + (g.kind === 'collect' ? 4 : 0),
      '#f3d89a',
      11,
    );
    text(ctx, `${shown}/${g.target}`, 380, top + 36, shown >= g.target ? '#8be5bb' : '#efdeb4', 13);
    ctx.fillStyle = '#819d83';
    ctx.fillRect(381, top + 54, 78, 3);
    ctx.fillStyle = g.kind === 'collect' ? COLORS[g.color] : '#d38c92';
    ctx.fillRect(381, top + 54, 78 * (shown / g.target), 3);
  });
}
function drawSide(ctx, s, env) {
  ctx.fillStyle = '#10262a';
  ctx.fillRect(8, 42, 102, 244);
  text(ctx, env.t('GARDEN', '花园'), 18, 53, '#91b5a1', 10);
  text(ctx, `${s.level} / ${LEVEL_COUNT}`, 18, 69, '#f3d89a', 19);
  text(ctx, env.t('MOVES', '剩余步数'), 18, 107, '#91b5a1', 10);
  text(ctx, String(s.moves), 18, 123, s.moves <= 4 ? '#ed997d' : '#efdeb4', 28);
  text(ctx, env.t('SCORE', '总分'), 18, 167, '#91b5a1', 10);
  text(ctx, String(s.score), 18, 183, '#c9d2b1', 16);
  text(ctx, env.t('H  HINT', 'H  提示'), 18, 224, '#8eafa1', 10);
}
function drawScenery(ctx, s) {
  background(ctx, SKY[Math.floor(((s.level - 1) / LEVEL_COUNT) * SKY.length)]);
  ctx.fillStyle = '#0f2429';
  ctx.fillRect(0, 0, 480, 34);
  for (let x = 0; x < 480; x += 48) {
    ctx.fillStyle = '#38514b';
    ctx.fillRect(x + 3, 0, 2, 320);
    ctx.fillRect(x, 21, 48, 2);
    ctx.fillStyle = '#8c7650';
    ctx.fillRect(x + 2, 25, 4, 6);
  }
  for (let i = 0; i < 12; i++) {
    const px = (i * 67) % 480,
      py = 175 + ((i * 29) % 115);
    ctx.fillStyle = '#3b6550';
    ctx.fillRect(px, py, 18, 44);
    ctx.fillStyle = '#192f2c';
    ctx.fillRect(px - 3, py + 38, 24, 8);
    ctx.fillStyle = '#7caa89';
    ctx.fillRect(px - 6, py - 4, 30, 7);
    ctx.fillStyle = '#719b76';
    ctx.fillRect(px + 6, py - 14, 3, 14);
  }
}
function drawCells(ctx, s) {
  ctx.fillStyle = '#091e23';
  ctx.fillRect(X - 5, Y - 5, SIZE * CELL + 10, SIZE * CELL + 10);
  ctx.fillStyle = '#a18e62';
  ctx.fillRect(X - 3, Y - 3, SIZE * CELL + 6, 2);
  ctx.fillRect(X - 3, Y + SIZE * CELL + 1, SIZE * CELL + 6, 3);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const p = center(x, y);
      ctx.fillStyle = s.soil[y][x] >= 0 ? '#79583d' : (x + y) % 2 ? '#1d3a39' : '#233f3d';
      ctx.fillRect(p.x - 17, p.y - 17, 33, 33);
      if (s.soil[y][x] >= 0) {
        ctx.fillStyle = '#cb9760';
        ctx.fillRect(p.x - 14, p.y - 13, 5, 2);
        ctx.fillRect(p.x + 8, p.y + 11, 5, 2);
        ctx.fillStyle = '#b18351';
        ctx.fillRect(p.x - 16, p.y - 16, 32, 2);
      }
    }
}
function drawGems(ctx, s) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, SIZE * CELL, SIZE * CELL);
  ctx.clip();
  if (s.fall) for (const p of s.fall.particles) gem(ctx, p.color, center(p.col, 0).x, p.y);
  else {
    const lift = s.mixer ? smooth(s.mixer.time / s.mixer.duration) * (SIZE + 1) * CELL : 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (s.board[y][x] < 0) continue;
        if (s.swap && [s.swap.a, s.swap.b].some((p) => p.x === x && p.y === y)) continue;
        const p = center(x, y),
          flash = s.pending.includes(`${y},${x}`) ? 0.5 + 0.45 * Math.sin(s.clearTime * 38) : 1;
        gem(ctx, s.board[y][x], p.x, p.y - lift, 0, flash);
      }
    if (s.swap) {
      const sw = s.swap,
        pose = gemSwapPose(sw),
        a = center(sw.a.x, sw.a.y),
        b = center(sw.b.x, sw.b.y);
      ctx.strokeStyle = '#b9bd7e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      gem(ctx, s.board[sw.b.y][sw.b.x], pose.b.x, pose.b.y, pose.b.z);
      gem(ctx, s.board[sw.a.y][sw.a.x], pose.a.x, pose.a.y, pose.a.z);
    }
  }
  ctx.restore();
}
/** A mini gem glyph: the same silhouette as the gem, drawn at one pixel per cell. */
function glyph(ctx, kind, left, top) {
  SPRITES[kind].forEach((row, r) =>
    [...row].forEach((cell, c) => {
      if (cell === '#') ctx.fillRect(left + c, top + r, 1, 1);
    }),
  );
}
/** Each bed wears a badge showing the wanted gem's shape and colour, plus colour brackets. */
function drawSoilFrames(ctx, s) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const kind = s.soil[y][x];
      if (kind < 0) continue;
      const px = X + x * CELL,
        py = Y + y * CELL;
      for (const [dx, dy] of [
        [25, 0],
        [0, 25],
        [25, 25],
      ]) {
        ctx.fillStyle = '#10201f';
        ctx.fillRect(px + dx, py + dy, 9, 9);
        ctx.fillStyle = COLORS[kind];
        ctx.fillRect(px + dx + 1, py + dy + 1, 7, 7);
      }
      ctx.fillStyle = '#10201f';
      ctx.fillRect(px, py, 11, 11);
      ctx.fillStyle = '#f3e4bd';
      ctx.fillRect(px + 1, py + 1, 9, 9);
      ctx.fillStyle = '#243e43';
      glyph(ctx, kind, px + 1, py + 1);
    }
}
function drawMarkers(ctx, s) {
  for (const p of s.sparkles) {
    ctx.fillStyle = COLORS[p.color];
    const d = (0.35 - p.life) * 35;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      ctx.fillRect(p.x + dx * d, p.y + dy * d, 3, 3);
  }
  if (s.mode !== 'ready') return;
  const ring = (p, color, width, inset = 2) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(
      X + p.x * CELL + inset,
      Y + p.y * CELL + inset,
      CELL - 2 * inset,
      CELL - 2 * inset,
    );
  };
  ring(s.cursor, '#f2d78f', 2);
  if (s.selected) ring(s.selected, '#ffffff', 3, 5);
  if (s.hint) {
    ring(s.hint.a, '#8be5bb', 3, 3);
    ring(s.hint.b, '#8be5bb', 3, 3);
  }
}
export function drawGame(ctx, s, env) {
  ctx.save();
  drawScenery(ctx, s);
  text(
    ctx,
    env.t(LEVELS[s.level - 1].name.en, LEVELS[s.level - 1].name.zh).toUpperCase(),
    240,
    10,
    '#ead6a7',
    13,
    'center',
  );
  drawSide(ctx, s, env);
  drawGoals(ctx, s, env);
  drawCells(ctx, s);
  drawGems(ctx, s);
  drawSoilFrames(ctx, s);
  drawMarkers(ctx, s);
  ctx.fillStyle = '#10262a';
  ctx.fillRect(0, 294, 480, 26);
  const lines = barLines(s, env);
  lines.forEach((line, i) =>
    text(ctx, line, 240, lines.length > 1 ? 296 + i * 11 : 303, '#d5d8b5', 10, 'center'),
  );
  ctx.restore();
}
export function drawMenu(ctx, env, menu) {
  ctx.save();
  background(ctx, '#172d30');
  text(ctx, env.t('CHOOSE A GARDEN', '选择花园'), 240, 9, '#ead6a7', 14, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const c = menuCell(n),
      locked = n > menu.unlocked,
      here = n === menu.cursor;
    ctx.fillStyle = here ? '#f2d78f' : '#091e23';
    ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.fillStyle = locked ? '#26383a' : n < menu.unlocked ? '#3d6b56' : '#5a7f62';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    text(ctx, String(n), c.x + c.w / 2, c.y + 6, locked ? '#6d8179' : '#f3e4bd', 16, 'center');
    text(
      ctx,
      locked
        ? env.t('LOCKED', '未解锁')
        : n < menu.unlocked
          ? env.t('CLEARED', '已通关')
          : env.t('OPEN', '可玩'),
      c.x + c.w / 2,
      c.y + 26,
      locked ? '#6d8179' : '#d5d8b5',
      9,
      'center',
    );
  }
  const chosen = LEVELS[menu.cursor - 1];
  text(ctx, env.t(chosen.name.en, chosen.name.zh).toUpperCase(), 240, 226, '#f3d89a', 12, 'center');
  wrapText(env.t(chosen.tip.en, chosen.tip.zh), 440, 10).forEach((row, i) =>
    text(ctx, row, 240, 244 + i * 13, '#c1d9c5', 10, 'center'),
  );
  text(
    ctx,
    env.t('ARROWS + SPACE, OR TAP A GARDEN', '方向键 + 空格，或点按花园'),
    240,
    300,
    '#8eafa1',
    10,
    'center',
  );
  ctx.restore();
}
