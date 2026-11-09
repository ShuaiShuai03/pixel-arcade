// Bomb Garden drawing. Reads the live view that createGame passes in; owns no game state.
import { drawPixelText, pixelSprite, background } from '../shared/utils.js';
import { GARDENS, GARDEN_COUNT, ROLES } from './bomb-garden-gardens.js';
import {
  COLS,
  ROWS,
  CELL,
  OX,
  OY,
  FUSE,
  FRONT_STEP,
  WALL,
  CRATE,
  BARREL,
  key,
  blastPlan,
  menuCell,
} from './bomb-garden-rules.js';

const BODY = [
  '..aaaa..',
  '.aaaaaa.',
  '.abbbba.',
  '.abccba.',
  '..dddd..',
  '.dddddd.',
  '..d..d..',
  '.ee..ee.',
];
const ROLE_ORDER = ['bomber', 'scout', 'warden'];
const STRIP = { x: 15, y: 284, w: 450, h: 26 };

const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Distinct rival roles in a garden, in teaching order. */
export const rolesIn = (garden) =>
  ROLE_ORDER.filter((role) => garden.foes.some((foe) => foe[2] === role));

function drawHud(ctx, v) {
  const { env } = v;
  background(ctx, '#183b35');
  rect(ctx, '#0f282b', 0, 0, 480, 40);
  drawPixelText(
    ctx,
    v.duel ? env.t('DUEL', '对决') : `${env.t('GARDEN', '花园')} ${v.level}/${GARDEN_COUNT}`,
    16,
    11,
    '#d8eab7',
    12,
  );
  if (v.duel) {
    for (const p of v.players)
      drawPixelText(
        ctx,
        env.t(
          `P${p.id + 1} RANGE ${p.range} BOMBS ${p.capacity}`,
          `玩家${p.id + 1} 火力${p.range} 炸弹${p.capacity}`,
        ),
        p.id === 0 ? 84 : 270,
        12,
        p.id === 0 ? '#a0e0d3' : '#edcf88',
        10,
      );
  } else {
    const me = v.players[0];
    drawPixelText(
      ctx,
      `${env.t('RANGE', '火力')} ${me.range}  ${env.t('BOMBS', '炸弹')} ${me.capacity}`,
      170,
      12,
      '#a6d6b5',
      10,
    );
  }
  drawPixelText(
    ctx,
    `${Math.max(0, Math.ceil(v.time))}s`,
    462,
    11,
    v.time < 20 ? '#ff9a76' : '#f5edc6',
    12,
    'right',
  );
  if (v.duel)
    drawPixelText(
      ctx,
      env.t('DUEL · LAST GARDENER STANDING', '对决 · 最后幸存者获胜'),
      16,
      27,
      '#dcb689',
      10,
    );
  else {
    drawPixelText(ctx, env.t('HEARTS ', '生命 ') + v.lives, 16, 27, '#dcb689', 10);
    drawPixelText(
      ctx,
      env.t(`DEFEAT ALL RIVALS (${v.rivalsLeft} LEFT)`, `击败所有对手（剩${v.rivalsLeft}个）`),
      84,
      27,
      '#f2e0ac',
      10,
    );
  }
  drawPixelText(
    ctx,
    env.t('WALLS / CRATES / BARRELS STOP JETS', '墙壁 / 木箱 / 堆肥桶可挡喷焰'),
    462,
    27,
    '#9ac5ac',
    10,
    'right',
  );
}

function drawTile(ctx, v, x, y) {
  const px = OX + x * CELL,
    py = OY + y * CELL,
    cell = v.board[y][x];
  rect(ctx, (x + y) % 2 ? v.garden.ground : '#24443f', px, py, CELL, CELL);
  if (v.wet.has(key(x, y))) {
    rect(ctx, '#315f6a', px + 1, py + 1, 28, 28);
    rect(ctx, '#709ca0', px + 5, py + 12, 18, 2);
    rect(ctx, '#709ca0', px + 9, py + 18, 14, 2);
  }
  if (cell === BARREL) {
    rect(ctx, '#653d32', px + 5, py + 5, 20, 22);
    rect(ctx, '#c88c53', px + 5, py + 7, 20, 3);
    rect(ctx, '#c88c53', px + 5, py + 22, 20, 3);
    rect(ctx, '#ffe5a0', px + 13, py + 10, 4, 11);
    rect(ctx, '#ffe5a0', px + 9, py + 14, 12, 3);
  }
  if (cell === WALL) {
    rect(ctx, '#5b7a6c', px + 1, py + 1, 28, 28);
    rect(ctx, '#9bb8a0', px + 2, py + 2, 25, 5);
    rect(ctx, '#3b5b53', px + 4, py + 11, 8, 3);
    rect(ctx, '#3b5b53', px + 17, py + 21, 8, 3);
  }
  if (cell === CRATE) {
    rect(ctx, '#654b36', px + 2, py + 5, 26, 24);
    rect(ctx, '#bc9359', px + 3, py + 3, 24, 21);
    rect(ctx, '#815e38', px + 5, py + 10, 20, 3);
    rect(ctx, '#815e38', px + 5, py + 18, 20, 3);
    rect(ctx, '#8fba72', px + 11, py, 5, 6);
    const upgrade = v.drops.get(key(x, y));
    if (upgrade) {
      rect(ctx, '#3c2a1a', px + 9, py + 7, 13, 14);
      drawPixelText(ctx, upgrade === 'range' ? '+' : 'B', px + 15, py + 8, '#ffe58a', 12, 'center');
    }
  }
}

function drawBomb(ctx, v, b) {
  const x = OX + b.x * CELL,
    y = OY + b.y * CELL,
    body = b.at - v.elapsed < 0.65 && Math.floor(v.elapsed * 12) % 2 ? '#d6654e' : '#192b33';
  rect(ctx, body, x + 7, y + 9, 17, 16);
  rect(ctx, body, x + 10, y + 6, 11, 22);
  rect(ctx, '#efcf88', x + 15, y + 4, 4, 6);
  rect(ctx, '#ff8054', x + 18, y + 2, 4, 4);
  for (const [dx, dy, w, h] of [
    [3, 14, 7, 4],
    [20, 14, 7, 4],
    [13, 5, 4, 7],
    [13, 21, 4, 7],
  ])
    rect(ctx, '#82939b', x + dx, y + dy, w, h);
  drawPixelText(
    ctx,
    Math.max(0, b.at - v.elapsed).toFixed(1),
    x + 15,
    y - 3,
    '#fff2c8',
    10,
    'center',
  );
  rect(
    ctx,
    b.owner === 0 ? '#9ce7dc' : b.owner === 1 ? '#f1cf81' : '#eeb099',
    x + 12,
    y + 13,
    6,
    5,
  );
}

function drawFlame(ctx, f, elapsed) {
  const px = OX + f.x * CELL,
    py = OY + f.y * CELL;
  if (f.until <= elapsed) {
    rect(ctx, '#ad7550', px + 7, py + 23, 3, 2);
    rect(ctx, '#ad7550', px + 19, py + 19, 3, 2);
    return;
  }
  ctx.strokeStyle = '#ffb764';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 1, py + 1, 28, 28);
  rect(ctx, '#e87847', px + 1, py + 6, 28, 18);
  rect(ctx, '#e87847', px + 6, py + 1, 18, 28);
  rect(ctx, '#ffe199', px + 9, py + 3, 12, 24);
  rect(ctx, '#ffe199', px + 3, py + 9, 24, 12);
}

function drawActor(ctx, v, a) {
  const { env } = v,
    ax = OX + a.px * CELL + 7,
    ay = OY + a.py * CELL + 7;
  pixelSprite(ctx, BODY, ax, ay, 2, {
    a: a.ai ? '#d17b79' : a.id === 0 ? '#83ddd0' : '#efc467',
    b: '#fff0d1',
    c: '#293d43',
    d: a.ai ? '#89545c' : a.id === 0 ? '#3f8f93' : '#bd8750',
    e: '#18333a',
  });
  if (!a.ai) {
    if (v.duel) drawPixelText(ctx, String(a.id + 1), ax + 8, ay - 8, '#f7e7b7', 9, 'center');
    return;
  }
  const role = ROLES[a.role];
  drawPixelText(
    ctx,
    env.t(role.letter.en, role.letter.zh),
    ax + 8,
    ay - 10,
    role.color,
    10,
    'center',
  );
  if (a.restUntil > v.elapsed) drawPixelText(ctx, 'Z', ax + 22, ay + 2, '#c0dcb6', 10, 'center');
  else if (a.arming > v.elapsed) drawPixelText(ctx, '!', ax + 22, ay + 2, '#fff0ad', 10, 'center');
}

function drawBanner(ctx, v) {
  const { env, garden } = v;
  rect(ctx, '#152f2dee', STRIP.x, STRIP.y, STRIP.w, STRIP.h);
  const solo = !v.duel;
  if (v.banner > 0 && v.transition <= 0 && v.respawn <= 0) {
    drawPixelText(
      ctx,
      solo
        ? `${v.level}. ${env.t(garden.name.en, garden.name.zh)}`
        : env.t('SYMMETRIC DUEL ARENA', '对称决斗场'),
      240,
      285,
      '#f2e0ac',
      12,
      'center',
    );
    drawPixelText(
      ctx,
      solo
        ? env.t(garden.tip.en, garden.tip.zh)
        : env.t(`${FUSE}s FUSE · LEAVE A SIDE EXIT`, `${FUSE}秒引信 · 留好侧向退路`),
      240,
      299,
      '#b9d8bd',
      10,
      'center',
    );
    return;
  }
  const legend = solo
    ? rolesIn(garden)
        .map((name) => {
          const role = ROLES[name];
          return env.t(
            `${role.letter.en} ${role.name.en}: ${role.note.en}`,
            `${role.letter.zh} ${role.name.zh}：${role.note.zh}`,
          );
        })
        .join(' · ')
    : env.t('P1 WASD + Space · P2 Arrows + Enter', '玩家1 WASD+空格 · 玩家2 方向键+回车');
  drawPixelText(ctx, legend, 240, 292, '#b9d8bd', 10, 'center');
}

function drawOverlay(ctx, v) {
  const { env } = v;
  rect(ctx, '#152f2deb', 60, 144, 360, 42);
  drawPixelText(
    ctx,
    v.respawn > 0
      ? env.t(`TRY AGAIN — ${v.lives} HEARTS`, `再试一次 — ${v.lives} 生命`)
      : env.t('GARDEN CLEARED!', '花园已清空！'),
    240,
    157,
    '#f5e4ac',
    18,
    'center',
  );
}

export function drawGame(ctx, v) {
  drawHud(ctx, v);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(ctx, v, x, y);
  for (const p of v.pickups) {
    const x = OX + p.x * CELL,
      y = OY + p.y * CELL;
    rect(ctx, '#fae5a4', x + 7, y + 7, 16, 16);
    drawPixelText(ctx, p.type === 'range' ? '+' : 'B', x + 15, y + 8, '#b75a41', 13, 'center');
  }
  // Preview: white-gold dots where the jets will pass, orange where compost barrels add more.
  for (const b of v.bombs) {
    const plan = blastPlan(v.board, b.x, b.y, b.range),
      soon = b.at - v.elapsed < 0.75;
    for (const [list, soonColor, farColor] of [
      [plan.cells, '#ffc677cc', '#f3c87880'],
      [plan.chained, '#ff7a4fee', '#ff7a4fb0'],
    ])
      for (const [x, y] of list)
        rect(ctx, soon ? soonColor : farColor, OX + x * CELL + 12, OY + y * CELL + 12, 6, 6);
  }
  for (const b of v.bombs) drawBomb(ctx, v, b);
  for (const f of v.flames) drawFlame(ctx, f, v.elapsed);
  for (const f of v.fronts) {
    if (v.board[f.y]?.[f.x] === WALL || v.board[f.y]?.[f.x] === undefined) continue;
    const t = Math.max(0, Math.min(1, 1 - (f.at - v.elapsed) / FRONT_STEP)),
      x = OX + (f.x - f.dx * (1 - t)) * CELL + 15,
      y = OY + (f.y - f.dy * (1 - t)) * CELL + 15;
    rect(ctx, '#fff0b4', x - 3, y - 3, 6, 6);
    rect(ctx, '#fff0b4', x - f.dx * 6 - 2, y - f.dy * 6 - 2, 4, 4);
  }
  for (const a of [...v.players, ...v.enemies]) if (a.alive) drawActor(ctx, v, a);
  for (const p of v.particles) rect(ctx, '#be9359', p.x, p.y, 3, 3);
  drawBanner(ctx, v);
  if (v.transition > 0 || v.respawn > 0) drawOverlay(ctx, v);
}

export function drawMenu(ctx, v) {
  const { env, menu } = v;
  background(ctx, '#183b35');
  rect(ctx, '#0f282b', 0, 0, 480, 30);
  drawPixelText(
    ctx,
    env.t('BOMB GARDEN · CHOOSE A GARDEN', '炸弹花园 · 选择花园'),
    16,
    9,
    '#d8eab7',
    12,
  );
  if (v.menuNote)
    drawPixelText(ctx, env.t(v.menuNote.en, v.menuNote.zh), 464, 10, '#ff9a76', 10, 'right');
  GARDENS.forEach((g, i) => {
    const n = i + 1,
      q = menuCell(n),
      open = n <= menu.unlocked;
    rect(ctx, n === menu.cursor ? '#f5e4ac' : '#3b5b53', q.x, q.y, q.w, q.h);
    rect(ctx, open ? '#1d4a42' : '#102a28', q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    if (open) rect(ctx, n < menu.unlocked ? '#8fba72' : '#ffb764', q.x + 2, q.y + 2, q.w - 4, 4);
    drawPixelText(
      ctx,
      String(n),
      q.x + q.w / 2,
      q.y + 10,
      open ? '#ffffff' : '#56756d',
      16,
      'center',
    );
    if (!open) {
      rect(ctx, '#56756d', q.x + q.w / 2 - 6, q.y + 31, 12, 8);
      return;
    }
    const roles = g.foes.map((foe) => ROLES[foe[2]]);
    roles.forEach((role, k) => {
      const x = q.x + q.w / 2 + (k - (roles.length - 1) / 2) * 12;
      drawPixelText(
        ctx,
        env.t(role.letter.en, role.letter.zh),
        x,
        q.y + 30,
        role.color,
        10,
        'center',
      );
    });
  });
  const garden = GARDENS[menu.cursor - 1];
  rect(ctx, '#152f2d', 10, 238, 460, 74);
  drawPixelText(
    ctx,
    `${menu.cursor}. ${env.t(garden.name.en, garden.name.zh)}`,
    20,
    243,
    '#f2e0ac',
    14,
  );
  drawPixelText(ctx, env.t(garden.tip.en, garden.tip.zh), 20, 262, '#b9d8bd', 10);
  const rivals = rolesIn(garden)
    .map((name) => env.t(ROLES[name].name.en, ROLES[name].name.zh))
    .join(', ');
  drawPixelText(
    ctx,
    env.t(
      `RIVALS ${garden.foes.length}: ${rivals} · TIME ${garden.time}s`,
      `对手 ${garden.foes.length}：${rivals} · 时间 ${garden.time}秒`,
    ),
    20,
    277,
    '#dcb689',
    10,
  );
  drawPixelText(
    ctx,
    env.t(
      'ARROWS / WASD: PICK · SPACE OR 2ND TAP: START',
      '方向键 / WASD：选择 · 空格或再点一次：开始',
    ),
    20,
    294,
    '#9ac5ac',
    10,
  );
}
