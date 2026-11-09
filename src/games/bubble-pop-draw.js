// Rendering: cavern, bubbles with symbol cues, aim guide, HUD and the level select.
import { drawPixelText as text, background } from '../shared/utils.js';
import {
  CREATURE,
  ROWS,
  R,
  SHOT_Y,
  TAU,
  bubblePoint as point,
  cellsLeft,
  creaturesLeft,
  drainBusy,
  isBusy,
  slots,
} from './bubble-pop-rules.js';
import { trace } from './bubble-pop-aim.js';
import { LEVELS, deepFreeze } from './bubble-pop-levels.js';
import { menuCell } from './bubble-pop-menu.js';
/** Colour-blind cue: every symbol is a distinct shape, as [x, y, w, h] pixels around the centre. */
export const SYMBOLS = deepFreeze([
  [[-1.5, -0.5, 3, 1]],
  [
    [-0.5, -1.5, 1, 3],
    [-1.5, -0.5, 3, 1],
  ],
  [
    [-2, -2, 1, 4],
    [1, -2, 1, 4],
  ],
  [
    [-1, -2, 2, 1],
    [-2, -1, 1, 2],
    [1, -1, 1, 2],
    [-1, 1, 2, 1],
  ],
]);
function bubble(ctx, x, y, color, r = R, outline = true) {
  const shade = [
    ['#b76061', '#e89581', '#f3bea3'],
    ['#b89748', '#e6c66d', '#f2e0a0'],
    ['#458d85', '#76bfa8', '#b3dbbd'],
    ['#527b9d', '#79a8c9', '#bdd3db'],
  ][color] || ['#667c83', '#a1b5b6', '#e2e8da'];
  const unit = r >= 9 ? 2 : 1;
  for (let py = -r; py < r; py += unit)
    for (let px = -r; px < r; px += unit) {
      if ((px + unit / 2) ** 2 + (py + unit / 2) ** 2 > (r - 0.5) ** 2) continue;
      ctx.fillStyle = px + py > r * 0.35 ? shade[0] : px + py < -r * 0.45 ? shade[2] : shade[1];
      ctx.fillRect(Math.round(x + px), Math.round(y + py), unit, unit);
    }
  if (outline) {
    ctx.strokeStyle = '#0c2430';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, TAU);
    ctx.stroke();
  }
  if (color === CREATURE && r >= 6) crab(ctx, x, y, r >= 10 ? 2 : 1);
  else if (r >= 6) {
    ctx.fillStyle = '#fcf0cc';
    ctx.fillRect(x - r * 0.45, y - r * 0.5, Math.max(2, r * 0.35), 2);
    ctx.fillStyle = '#274b59';
    const u = r >= 10 ? 2 : 1;
    for (const [dx, dy, w, h] of SYMBOLS[color] ?? [])
      ctx.fillRect(x + dx * u, y + dy * u, w * u, h * u);
  }
}
/** A small crab with raised claws: the creature a rescue level asks you to free. */
function crab(ctx, x, y, u) {
  ctx.fillStyle = '#e0765f';
  ctx.fillRect(x - 3 * u, y - u, 6 * u, 3 * u);
  ctx.fillRect(x - 5 * u, y - 4 * u, 2 * u, 3 * u);
  ctx.fillRect(x + 3 * u, y - 4 * u, 2 * u, 3 * u);
  ctx.fillStyle = '#f3b49b';
  ctx.fillRect(x - 3 * u, y - 2 * u, 2 * u, u);
  ctx.fillRect(x + u, y - 2 * u, 2 * u, u);
  ctx.fillStyle = '#10222c';
  ctx.fillRect(x - 2 * u, y - u, u, u);
  ctx.fillRect(x + u, y - u, u, u);
  ctx.fillStyle = '#b4503f';
  for (const dx of [-4, -2, 1, 3]) ctx.fillRect(x + dx * u, y + 2 * u, u, u);
}
function dotted(ctx, from, to, color = '#759c9c', spacing = 10) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  for (let d = 5; d < length; d += spacing) {
    ctx.fillStyle = color;
    ctx.fillRect(from.x + (dx * d) / length - 1, from.y + (dy * d) / length - 1, 2, 2);
  }
}
function guidePath(ctx, segments, color) {
  for (const p of segments) {
    if (p.kind === 'arc') {
      const n = Math.max(2, Math.ceil(p.length / 6));
      for (let j = 0; j <= n; j++) {
        const a = p.from + (p.span * j) / n;
        ctx.fillStyle = color;
        ctx.fillRect(p.cx + 24 * Math.cos(a) - 1, p.cy + 24 * Math.sin(a) - 1, 2, 2);
      }
    } else dotted(ctx, p.from, p.to, color, 6);
  }
}
function drawCavern(ctx, s, env) {
  const materials = [
    { back: '#192d39', rock: '#31424a', edge: '#738d89', floor: '#254650', light: '#9fc7b8' },
    { back: '#1a2631', rock: '#303747', edge: '#6f8293', floor: '#263e50', light: '#aac0d0' },
    { back: '#203234', rock: '#364d44', edge: '#8b9874', floor: '#2b4947', light: '#c0cd9b' },
  ][(s.level - 1) % 3];
  background(ctx, materials.back);
  for (let side = 0; side < 2; side++)
    for (let row = 0; row < 8; row++) {
      const x = side ? 398 + (row % 3) * 5 : 7 + (row % 3) * 4,
        y = 31 + row * 34;
      ctx.fillStyle = materials.rock;
      ctx.fillRect(x, y, 70 - (row % 2) * 9, 26);
      ctx.fillRect(x + 7, y - 4, 45, 34);
      ctx.fillStyle = materials.edge;
      ctx.fillRect(x + 10, y + 1, 23, 2);
      if ((s.level - 1) % 3 === 0) {
        ctx.fillStyle = '#56777a';
        ctx.fillRect(x + 45, y + 9, 4, 5);
      }
      if ((s.level - 1) % 3 === 1) {
        ctx.fillStyle = '#465267';
        ctx.fillRect(x + 4, y + 18, 36, 3);
      }
      if ((s.level - 1) % 3 === 2) {
        ctx.fillStyle = '#638572';
        ctx.fillRect(x + 38, y + 3, 3, 22);
        ctx.fillRect(x + 29, y + 12, 12, 3);
      }
    }
  ctx.fillStyle = '#102834';
  ctx.fillRect(92, 28, 296, 288);
  ctx.fillStyle = materials.floor;
  ctx.fillRect(96, 36, 288, 278);
  ctx.fillStyle = '#1d3743';
  ctx.fillRect(96, 270, 288, 44);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++) {
      const p = point(r, c, s.ceiling);
      if (p.y > 264 || p.y < 36 + s.ceiling) continue;
      ctx.fillStyle = '#42636a';
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
  for (const [x, flip] of [
    [92, 1],
    [384, -1],
  ]) {
    ctx.fillStyle = materials.edge;
    ctx.fillRect(x, 28, 4, 288);
    ctx.fillStyle = '#bdd0b4';
    ctx.fillRect(x + (flip > 0 ? 2 : 0), 28, 1, 288);
    ctx.fillStyle = '#1b3541';
    for (let y = 37; y < 314; y += 12) ctx.fillRect(x, y, 2, 5);
  }
  const roof = 36 + s.ceiling;
  ctx.fillStyle = '#354d58';
  ctx.fillRect(96, 28, 288, roof - 28);
  ctx.fillStyle = materials.light;
  ctx.fillRect(96, roof - 3, 288, 3);
  ctx.fillStyle = '#48636a';
  for (let x = 104; x < 380; x += 12) ctx.fillRect(x, roof - 6, 5, 3);
  for (const x of [84, 389]) {
    ctx.fillStyle = '#496c73';
    ctx.fillRect(x, 168, 7, 50);
    ctx.fillStyle = '#8cb2ac';
    for (let k = 0; k < 4; k++)
      ctx.fillRect(x + 1, 172 + k * 12 + (Math.floor(s.time * 8) % 3), 5, 2);
  }
  ctx.fillStyle = '#ad8b74';
  for (let x = 98; x < 383; x += 10) ctx.fillRect(x, 269, 5, 2);
  for (const o of s.obstacles) {
    const p = point(o.row, o.col, s.ceiling);
    ctx.fillStyle = '#1d303e';
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#a1b2b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R - 1, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#7f929d';
    ctx.fillRect(p.x - 6, p.y - 2, 12, 4);
    ctx.fillRect(p.x - 2, p.y - 6, 4, 12);
    ctx.fillStyle = '#d5ded0';
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0) {
        const p = point(r, c, s.ceiling);
        bubble(ctx, p.x, p.y, s.board[r][c]);
      }
  for (const p of s.popped) {
    ctx.fillStyle = '#132c39';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12.5, 0, TAU);
    ctx.fill();
    const scale = Math.max(1.5, R / (1 + p.z / 22));
    bubble(ctx, p.x, p.y, p.color, scale);
    ctx.strokeStyle = '#8baba6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, TAU);
    ctx.stroke();
  }
  const busy = isBusy(s);
  if (!busy) {
    const preview = trace(s, s.angle);
    for (const segment of preview.segments)
      dotted(ctx, segment.from, segment.to, preview.plan ? '#8eb8aa' : '#ba8c80');
    if (preview.plan) {
      guidePath(ctx, preview.plan.segments, '#9cc9bb');
      const p = preview.plan.target;
      ctx.strokeStyle = '#c5e7bc';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c5e7bc';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    } else if (preview.contact) {
      ctx.strokeStyle = '#dfaf8c';
      ctx.beginPath();
      ctx.moveTo(preview.contact.x - 4, preview.contact.y - 4);
      ctx.lineTo(preview.contact.x + 4, preview.contact.y + 4);
      ctx.moveTo(preview.contact.x + 4, preview.contact.y - 4);
      ctx.lineTo(preview.contact.x - 4, preview.contact.y + 4);
      ctx.stroke();
    }
  }
  if (s.capture) {
    guidePath(ctx, s.capture.segments, '#d1e2ae');
    const p = s.capture.target;
    ctx.strokeStyle = '#bedbaa';
    ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
    bubble(ctx, s.capture.x, s.capture.y, s.capture.color);
  }
  if (s.shot) bubble(ctx, s.shot.x, s.shot.y, s.shot.color);
  // The launch cup is open above the air-table plane; its aim vane is a projected sight.
  ctx.fillStyle = '#67858a';
  ctx.fillRect(220, 311, 40, 5);
  ctx.fillRect(227, 308, 6, 6);
  ctx.fillRect(247, 308, 6, 6);
  ctx.fillStyle = '#afc9b5';
  ctx.fillRect(227, 311, 26, 2);
  const aim = { x: 240 + Math.cos(s.angle) * 21, y: SHOT_Y + Math.sin(s.angle) * 21 };
  ctx.fillStyle = '#c2d9ba';
  ctx.fillRect(aim.x - 2, aim.y - 2, 4, 4);
  ctx.fillStyle = '#789e9c';
  ctx.fillRect(238, 312, 4, 3);
  if (!s.shot && !s.capture) bubble(ctx, 240, SHOT_Y, s.current);
  text(ctx, env.t('CURRENT', '当前'), 44, 229, '#d4d8bc', 10, 'center');
  bubble(ctx, 44, 256, s.current, 9);
  text(ctx, env.t('NEXT', '下个'), 435, 229, '#d4d8bc', 10, 'center');
  bubble(ctx, 435, 256, s.next, 9);
  text(ctx, env.t('SWAP X', 'X 交换'), 435, 276, '#abbfb7', 10, 'center');
  text(ctx, env.t('PRESSURE', '推板压力'), 44, 64, '#cfbea0', 10, 'center');
  for (let n = 0; n < s.maxMisses; n++) {
    ctx.fillStyle = n < s.misses ? '#d69d7b' : '#40565d';
    ctx.fillRect(17 + n * 11, 84, 8, 7);
  }
  text(ctx, String(s.maxMisses - s.misses), 44, 104, '#e3c992', 16, 'center');
  text(ctx, env.t('MISSES LEFT', '还可失误'), 44, 125, '#9fb8b2', 9, 'center');
  if (s.obstacles.length) {
    text(ctx, env.t('BOLTS', '固定栓'), 435, 72, '#b8c9c0', 10, 'center');
    text(ctx, env.t('DO NOT MATCH', '不可消除'), 435, 88, '#91a7a8', 9, 'center');
  }
  if (s.goal === 'free') {
    bubble(ctx, 435, 124, CREATURE, 9);
    text(ctx, env.t('FREE ALL', '全部放出'), 435, 140, '#b8c9c0', 10, 'center');
  }
  ctx.fillStyle = '#112b37';
  ctx.fillRect(0, 0, 480, 25);
  const spec = LEVELS[s.level - 1];
  text(
    ctx,
    env.t(
      `${spec.name.en.toUpperCase()} ${s.level}/${s.totalLevels}`,
      `${spec.name.zh} ${s.level}/${s.totalLevels}`,
    ),
    12,
    2,
    '#d0dfc4',
    11,
  );
  if (s.shotBudget)
    text(
      ctx,
      env.t(`CAPSULES ${s.shotsLeft}`, `泡泡 ${s.shotsLeft}`),
      240,
      2,
      s.shotsLeft <= 3 ? '#f0bd8d' : '#e3c992',
      11,
      'center',
    );
  const left = s.goal === 'free' ? creaturesLeft(s) : cellsLeft(s);
  text(
    ctx,
    s.goal === 'free'
      ? env.t(`CRABS ${left}`, `螃蟹 ${left}`)
      : env.t(`DRAIN ${left}`, `待排空 ${left}`),
    468,
    2,
    '#c6d9c8',
    11,
    'right',
  );
  text(ctx, env.t(spec.tip.en, spec.tip.zh), 12, 15, '#9fb8b2', 9);
  let state = env.t('AIR TABLE · MATCH THREE', '气垫台 · 三个同色配对');
  if (s.shot) state = env.t('CAPSULE IN FLIGHT', '泡泡飞行中');
  else if (s.capture) state = env.t('SOCKET GUIDE ACTIVE', '卡槽导引中');
  else if (s.pressureWarning > 0) state = env.t('PUSHER WARNING', '推板即将移动');
  else if (s.ceilingMotion) state = env.t('PUSHER MOVING', '推板移动中');
  else if (drainBusy(s) || isBusy(s)) state = env.t('DRAINS CLEARING', '排放槽清理中');
  else if (s.queuedFire) state = env.t('AIMING · SHOT QUEUED', '瞄准中 · 已排队发射');
  else if (s.messageTime > 0)
    state = env.t('NO CLEAR SOCKET · ADJUST AIM', '无可达卡槽 · 调整瞄准');
  text(ctx, state, 240, 278, s.pressureWarning > 0 ? '#f0bd8d' : '#9cbcb7', 10, 'center');
  if (s.transition > 0) {
    ctx.fillStyle = '#18333be8';
    ctx.fillRect(107, 174, 266, 39);
    text(ctx, env.t('TABLE DRAINED', '气垫台已排空'), 240, 180, '#e5d5a9', 14, 'center');
    text(ctx, env.t('NEXT CAVERN LOADING', '下一座洞穴准备中'), 240, 198, '#b8d2c1', 10, 'center');
  }
  if (s.combo >= 6)
    text(
      ctx,
      env.t(`${s.combo} DRAINED!`, `${s.combo} 个排空！`),
      240,
      256,
      '#ead19f',
      11,
      'center',
    );
}
const TIER_COLOR = { teach: '#6fa890', combo: '#c9a35e', master: '#c9705e' };
const TIER_NAME = {
  teach: { en: 'Teaching', zh: '教学' },
  combo: { en: 'Combination', zh: '组合' },
  master: { en: 'Mastery', zh: '精通' },
};
function cellLabel(n, unlocked, env) {
  if (n > unlocked) return env.t('LOCKED', '未解锁');
  if (n < unlocked) return env.t('CLEARED', '已通关');
  return n === LEVELS.length ? env.t('FINAL', '最终') : env.t('NEXT', '下一关');
}
function drawMenu(ctx, menu, env) {
  ctx.fillStyle = '#0f1d2e';
  ctx.fillRect(0, 0, 480, 320);
  text(ctx, env.t('CHOOSE A CAVERN', '选择洞穴'), 240, 8, '#d8e8e5', 14, 'center');
  for (let n = 1; n <= LEVELS.length; n++) {
    const q = menuCell(n),
      open = n <= menu.unlocked;
    ctx.fillStyle = open ? TIER_COLOR[LEVELS[n - 1].tier] : '#25364a';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = open ? '#13263a' : '#1a2838';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    text(ctx, String(n), q.x + q.w / 2, q.y + 5, open ? '#f2f0dc' : '#58697c', 16, 'center');
    text(
      ctx,
      cellLabel(n, menu.unlocked, env),
      q.x + q.w / 2,
      q.y + 26,
      open ? '#bfe3d6' : '#58697c',
      9,
      'center',
    );
    if (n === menu.cursor) {
      ctx.strokeStyle = '#ffe0a0';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x - 1, q.y - 1, q.w + 2, q.h + 2);
    }
  }
  const chosen = LEVELS[menu.cursor - 1],
    tier = TIER_NAME[chosen.tier],
    top = menuCell(LEVELS.length).y + 52;
  text(
    ctx,
    `${menu.cursor}. ${env.t(chosen.name.en, chosen.name.zh)} · ${env.t(tier.en, tier.zh)}`,
    240,
    top,
    '#ffe0a0',
    12,
    'center',
  );
  text(ctx, env.t(chosen.tip.en, chosen.tip.zh), 240, top + 20, '#bed4d2', 9, 'center');
  text(
    ctx,
    env.t('Arrows or tap to choose · Fire to launch', '方向键或点按选择 · 射击键出发'),
    240,
    top + 40,
    '#8fa6b4',
    9,
    'center',
  );
}
/** One frame: the level select when `menu` is set, otherwise the cavern. */
export function drawBubble(ctx, s, env, menu = null) {
  if (menu) drawMenu(ctx, menu, env);
  else drawCavern(ctx, s, env);
}
