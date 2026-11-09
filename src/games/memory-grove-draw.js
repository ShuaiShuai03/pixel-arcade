// Memory Grove rendering: scenery, the cards, rule panels, the timing strip and the select screen.
import { background, drawPixelText, pixelSprite } from '../shared/utils.js';
import { ICONS, LEAF, PALETTE } from './memory-grove-art.js';
import { LEVELS, LEVEL_COUNT, RULE_NAMES, levelBand } from './memory-grove-levels.js';
import { menuCell } from './memory-grove-menu.js';
import { NEXT_BUTTON, memoryCardOpen } from './memory-grove-rules.js';
import { promptText, wrapText } from './memory-grove-text.js';

const SKY = Object.freeze(['#638274', '#5a6f7a', '#365371']);
const GROUND = Object.freeze(['#18372f', '#233a37', '#1c2e42']);
const GOLD = '#f0d18a';
const INK = '#a1b69b';
const CREAM = '#efdeb3';
const WARN = '#e99e86';
const TIP_WIDTH = 440;

function scenery(ctx, band) {
  background(ctx, GROUND[band]);
  ctx.fillStyle = SKY[band];
  ctx.fillRect(0, 0, 480, 92);
  ctx.fillStyle = band === 2 ? '#cbd8b5' : '#e7d39a';
  ctx.fillRect(band === 1 ? 362 : 380, 21, 21, 21);
  for (let layer = 0; layer < 3; layer++)
    for (let i = 0; i < 9; i++) {
      const x = i * 67 - layer * 21,
        y = 38 + layer * 28 + (i % 3) * 9;
      ctx.fillStyle = ['#466b5a', '#2b5447', '#1b3b34'][layer];
      ctx.fillRect(x + 24, y, 9, 220);
      ctx.fillRect(x + 5, y + 18, 47, 15);
      ctx.fillRect(x + 13, y + 4, 31, 22);
    }
  ctx.fillStyle = '#152c29';
  ctx.fillRect(0, 267, 480, 53);
  ctx.fillStyle = '#112a29';
  ctx.fillRect(0, 0, 480, 34);
}
function mark(ctx, kind, x, y, size) {
  ctx.strokeStyle = kind === 'check' ? '#f5e3a7' : WARN;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (kind === 'check') {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size / 3, y + size * 0.7);
    ctx.lineTo(x + size, y - size * 0.7);
  } else {
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
  }
  ctx.stroke();
}
function cardFace(ctx, s, i, rect, open) {
  const half = rect.w / 2,
    front = open >= 0.5,
    cell = LEVELS[s.level - 1].layout.cell,
    scale = cell >= 56 ? 4 : 3;
  ctx.fillStyle = s.matched[i] ? '#4d7c61' : front ? '#e7d6a7' : '#3d6457';
  ctx.fillRect(-half, -half, rect.w, rect.h);
  ctx.fillStyle = front ? '#f6e9bf' : '#779380';
  ctx.fillRect(-half + 2, -half + 2, rect.w - 4, 2);
  if (front) {
    pixelSprite(ctx, ICONS[s.deck[i]], -4 * scale, -4 * scale, scale, PALETTE);
    return;
  }
  ctx.fillStyle = '#9db18d';
  ctx.fillRect(-1, -half + 6, 3, rect.h - 12);
  ctx.fillRect(-half + 6, -1, rect.w - 12, 3);
}
function card(ctx, s, i) {
  const rect = LEVELS[s.level - 1].layout.cards[i],
    open = memoryCardOpen(s, i),
    cx = rect.x + rect.w / 2,
    cy = rect.y + rect.h / 2,
    lit = s.echo?.lit === i;
  ctx.fillStyle = '#081c20';
  ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(0.045, Math.abs(Math.cos(open * Math.PI))), 1);
  cardFace(ctx, s, i, rect, open);
  ctx.restore();
  const shown = s.flipped.includes(i) && s.mode === 'reveal' && open >= 1;
  if (s.matched[i] || (shown && s.correct)) mark(ctx, 'check', cx + rect.w / 4, cy + rect.h / 4, 5);
  else if (shown) mark(ctx, 'cross', cx, cy, rect.w / 4);
  if (lit) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    drawPixelText(ctx, String(s.echo.step + 1), rect.x + 4, rect.y + 3, '#10231f', 11);
  }
  if (s.cursor === i && s.mode === 'ready') {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - 4, rect.y + rect.h + 3, 8, 3);
  }
}

/** What the timing strip says and how full it is: the player always sees how long a phase lasts. */
export function timingStrip(s, t) {
  const left = Math.max(0, s.dur - s.t),
    secs = `${left.toFixed(1)}s`;
  switch (s.mode) {
    case 'preview':
      return { label: t(`STUDY ${secs}`, `记忆 ${secs}`), fill: left / s.dur };
    case 'listen':
      return { label: t(`GET READY ${secs}`, `准备 ${secs}`), fill: left / s.dur };
    case 'cue-on':
    case 'cue-gap':
      return {
        label: t(
          `CUE ${s.echo.step + 1}/${s.echo.length}`,
          `提示 ${s.echo.step + 1}/${s.echo.length}`,
        ),
        fill: left / s.dur,
      };
    case 'reveal':
    case 'opening':
    case 'closing':
      return {
        label: t(`LOOK ${secs}`, `观察 ${secs}`),
        fill: s.mode === 'reveal' ? left / s.dur : 1,
      };
    case 'ready':
      if (s.timed && s.clock > 0 && s.started)
        return {
          label: t(`CLOCK ${Math.ceil(s.remaining)}s`, `计时 ${Math.ceil(s.remaining)}秒`),
          fill: s.remaining / s.clock,
        };
      return { label: t('YOUR TURN', '轮到你'), fill: 1 };
    default:
      return { label: '', fill: 0 };
  }
}
function strip(ctx, s, t) {
  const { label, fill } = timingStrip(s, t);
  drawPixelText(ctx, label, 114, 40, CREAM, 10);
  ctx.fillStyle = '#0a1c1c';
  ctx.fillRect(214, 41, 154, 10);
  ctx.fillStyle = fill < 0.2 && s.mode === 'ready' && s.timed && s.clock > 0 ? WARN : GOLD;
  ctx.fillRect(216, 43, Math.round(150 * fill), 6);
}
function leftPanel(ctx, s, t) {
  const def = LEVELS[s.level - 1];
  ctx.fillStyle = '#102724';
  ctx.fillRect(9, 47, 97, 224);
  drawPixelText(ctx, t('CLEARING', '林间空地'), 14, 52, INK, 10);
  drawPixelText(ctx, `${s.level}/${LEVEL_COUNT}`, 14, 66, GOLD, 20);
  drawPixelText(ctx, t('LEAVES', '叶子'), 14, 96, INK, 10);
  if (s.lives === null) drawPixelText(ctx, t('NO LIMIT', '不限'), 14, 110, CREAM, 11);
  else {
    drawPixelText(ctx, `x${s.lives}`, 62, 96, CREAM, 11);
    for (let k = 0; k < s.lives; k++)
      pixelSprite(ctx, LEAF, 13 + (k % 7) * 13, 110 + Math.floor(k / 7) * 12, 2, PALETTE);
  }
  drawPixelText(ctx, t('CLOCK', '思考时间'), 14, 160, INK, 10);
  const running = def.clock > 0 && s.timed;
  drawPixelText(
    ctx,
    running ? String(Math.ceil(s.remaining)) : '--',
    14,
    173,
    running && s.remaining < 15 ? WARN : CREAM,
    24,
  );
  drawPixelText(
    ctx,
    def.clock === 0
      ? t('NO CLOCK', '无计时')
      : s.timed
        ? t('TIMED', '计时模式')
        : t('RELAXED', '休闲模式'),
    14,
    202,
    '#b9c9ab',
    11,
  );
  if (def.clock > 0) drawPixelText(ctx, t('T: RELAX', 'T 转休闲'), 14, 218, INK, 10);
  drawPixelText(ctx, t('SCORE', '得分'), 14, 238, INK, 10);
  drawPixelText(ctx, String(s.score), 14, 252, GOLD, 16);
}
function routePanel(ctx, s, t) {
  drawPixelText(ctx, t('ORDER', '顺序'), 387, 106, INK, 10);
  s.route.forEach((symbol, n) => {
    const x = 385 + (n % 3) * 29,
      y = 124 + Math.floor(n / 3) * 40,
      done = n < s.routeIndex;
    ctx.fillStyle = done ? '#375c45' : '#29433b';
    ctx.fillRect(x, y, 26, 36);
    pixelSprite(ctx, ICONS[symbol], x + 5, y + 2, 2, PALETTE);
    drawPixelText(ctx, String(n + 1), x + 13, y + 22, CREAM, 10, 'center');
    if (done) mark(ctx, 'check', x + 19, y + 28, 3);
    if (n === s.routeIndex) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, 28, 38);
      ctx.fillStyle = GOLD;
      ctx.fillRect(x + 9, y - 6, 8, 3);
    }
  });
}
function slotsPanel(ctx, s, t, total, filled, label) {
  drawPixelText(ctx, label, 387, 106, INK, 10);
  for (let k = 0; k < total; k++) {
    const x = 387 + (k % 4) * 21,
      y = 124 + Math.floor(k / 4) * 28;
    ctx.fillStyle = k < filled ? '#e6cf96' : '#4b6e5a';
    ctx.fillRect(x, y, 17, 23);
    ctx.fillStyle = '#203c34';
    ctx.fillRect(x + 5, y + 7, 7, 9);
    if (k < filled) mark(ctx, 'check', x + 9, y + 12, 3);
  }
  if (s.rule !== 'echo') {
    drawPixelText(ctx, t('TURNS', '翻牌次数'), 387, 190, INK, 10);
    drawPixelText(ctx, String(s.levelTurns), 387, 204, CREAM, 15);
  }
}
function rightPanel(ctx, s, t) {
  const def = LEVELS[s.level - 1];
  ctx.fillStyle = '#102724';
  ctx.fillRect(378, 47, 93, 224);
  drawPixelText(ctx, t(RULE_NAMES[s.rule].en, RULE_NAMES[s.rule].zh), 387, 52, INK, 10);
  const total = s.rule === 'echo' ? s.echo.length : s.matched.length / def.group,
    done = s.rule === 'echo' ? s.echo.input : s.matched.filter(Boolean).length / def.group;
  drawPixelText(ctx, `${done}/${total}`, 387, 66, GOLD, 20);
  if (s.rule === 'route') routePanel(ctx, s, t);
  else if (s.rule === 'echo') slotsPanel(ctx, s, t, total, done, t('REPEAT', '重复'));
  else
    slotsPanel(
      ctx,
      s,
      t,
      def.group,
      s.flipped.length,
      def.group === 3 ? t('THREE CARDS', '翻开三张') : t('TWO CARDS', '翻开两张'),
    );
}
function bottomBar(ctx, s, t) {
  ctx.fillStyle = '#102724';
  ctx.fillRect(0, 283, 480, 37);
  if (s.mode === 'level-clear') {
    const b = NEXT_BUTTON;
    ctx.fillStyle = '#637548';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    drawPixelText(ctx, t('NEXT CLEARING', '下一空地'), 240, b.y + 7, '#f5e4b6', 12, 'center');
    return;
  }
  const lines = wrapText(promptText(s, t), 10, TIP_WIDTH);
  lines
    .slice(0, 2)
    .forEach((line, n) =>
      drawPixelText(
        ctx,
        line,
        240,
        (lines.length > 1 ? 287 : 295) + n * 13,
        '#d0d7b4',
        10,
        'center',
      ),
    );
}
export function drawMemory(ctx, s, env) {
  const t = env.t;
  ctx.save();
  scenery(ctx, levelBand(s.level));
  drawPixelText(
    ctx,
    `${s.level}. ${t(LEVELS[s.level - 1].name.en, LEVELS[s.level - 1].name.zh)}`.toUpperCase(),
    240,
    11,
    '#eddbad',
    13,
    'center',
  );
  leftPanel(ctx, s, t);
  rightPanel(ctx, s, t);
  ctx.fillStyle = '#0d2528';
  ctx.fillRect(112, 54, 256, 218);
  strip(ctx, s, t);
  for (let i = 0; i < s.deck.length; i++) card(ctx, s, i);
  bottomBar(ctx, s, t);
  ctx.restore();
}

function selectCell(ctx, n, menu) {
  const q = menuCell(n),
    locked = n > menu.unlocked,
    def = LEVELS[n - 1];
  ctx.fillStyle = locked ? '#16282a' : n < menu.unlocked ? '#375c45' : '#4b6e5a';
  ctx.fillRect(q.x, q.y, q.w, q.h);
  drawPixelText(ctx, String(n), q.x + 8, q.y + 10, locked ? '#5d6f69' : CREAM, 16);
  if (locked) {
    ctx.fillStyle = '#5d6f69';
    ctx.fillRect(q.x + 56, q.y + 18, 14, 11);
    ctx.fillRect(q.x + 59, q.y + 11, 2, 8);
    ctx.fillRect(q.x + 65, q.y + 11, 2, 8);
    ctx.fillRect(q.x + 59, q.y + 10, 8, 2);
  } else {
    pixelSprite(
      ctx,
      ICONS[{ pairs: 0, route: 1, triples: 4, echo: 5 }[def.rule]],
      q.x + 52,
      q.y + 6,
      3,
      PALETTE,
    );
    if (n < menu.unlocked) mark(ctx, 'check', q.x + 34, q.y + 28, 4);
  }
  if (n === menu.cursor) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.strokeRect(q.x - 2, q.y - 2, q.w + 4, q.h + 4);
  }
}
export function drawSelect(ctx, env, menu) {
  const t = env.t;
  ctx.save();
  background(ctx, GROUND[levelBand(menu.cursor)]);
  drawPixelText(ctx, t('CHOOSE A CLEARING', '选择空地'), 240, 10, '#eddbad', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) selectCell(ctx, n, menu);
  const def = LEVELS[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + 50;
  drawPixelText(
    ctx,
    `${menu.cursor}. ${t(def.name.en, def.name.zh)}`,
    240,
    top,
    '#aee1e5',
    13,
    'center',
  );
  wrapText(t(def.tip.en, def.tip.zh), 10, TIP_WIDTH)
    .slice(0, 2)
    .forEach((line, n) =>
      drawPixelText(ctx, line, 240, top + 20 + n * 13, '#d0d7b4', 10, 'center'),
    );
  drawPixelText(
    ctx,
    t('Arrows + Space, or tap a clearing', '方向键 + 空格，或点按空地'),
    240,
    300,
    INK,
    10,
    'center',
  );
  ctx.restore();
}
