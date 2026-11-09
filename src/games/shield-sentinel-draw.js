import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import {
  BASH_CD,
  BASH_HALF,
  BASH_R,
  BODY,
  BROKEN_TIME,
  MAX_ENERGY,
  MAX_HP,
  PLAY_BOTTOM,
  PLAY_TOP,
  SHIELD_HALF,
  SHIELD_OUTER,
  SHIELD_R,
  SHIELD_THICK,
  SLAM_R,
  laneHalfWidth,
} from './shield-sentinel-geometry.js';
import { LEVEL_COUNT, levelOf } from './shield-sentinel-levels.js';
import { menuCell } from './shield-sentinel-menu.js';
import { shieldIsUp, snapshot } from './shield-sentinel-world.js';

const COLORS = {
  orb: '#37e6d2',
  slug: '#ff9a3c',
  lance: '#ff3b4a',
  shield: '#d8ecff',
  gold: '#ffd76a',
  slam: '#b04cff',
};
const SENTINEL = [
  '..hhhh..',
  '.hhhhhh.',
  '.hvvvvh.',
  '..hhhh..',
  '.aaaaaa.',
  'aaccccaa',
  'aaccccaa',
  '.aaaaaa.',
  '..bbbb..',
  '..b..b..',
  '..b..b..',
  '.bb..bb.',
];
const SENTINEL_PALETTE = { h: '#9fb4c8', v: '#37e6d2', a: '#4a6a9a', c: '#ffd76a', b: '#2b3a55' };
const TURRET = [
  '..mmmmmm..',
  '.mmssssmm.',
  'mmsEEEEsmm',
  'mmsEEEEsmm',
  'mmssssssmm',
  '.mmmmmmmm.',
  '..mmddmm..',
  '..mdddmm..',
  '.mmmmmmmm.',
  'mmmmmmmmmm',
];

function drawFloor(ctx) {
  background(ctx, '#0b1022');
  // Night sky seen through the observatory ring wall, with a telescope silhouette.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 5 === 0 ? '#ffe9a8' : '#8fa6d8';
    ctx.fillRect(((i * 97) % 470) + 4, PLAY_TOP + ((i * 53) % 22), 2, 2);
  }
  ctx.fillStyle = '#1c2540';
  ctx.beginPath();
  ctx.moveTo(300, PLAY_TOP + 30);
  ctx.lineTo(344, PLAY_TOP + 8);
  ctx.lineTo(352, PLAY_TOP + 14);
  ctx.lineTo(310, PLAY_TOP + 34);
  ctx.fill();
  ctx.fillStyle = '#3a4668';
  for (let x = 0; x < 480; x += 48) {
    ctx.fillRect(x, PLAY_TOP + 30, 48, 8);
    ctx.fillStyle = x % 96 ? '#46537a' : '#3a4668';
    ctx.fillRect(x + 2, PLAY_TOP + 32, 44, 4);
    ctx.fillStyle = '#3a4668';
  }
  // Flagstone floor with offset mortar joints.
  const top = PLAY_TOP + 38;
  ctx.fillStyle = '#262e44';
  ctx.fillRect(0, top, 480, PLAY_BOTTOM - top);
  for (let row = 0; row * 28 + top < PLAY_BOTTOM; row++) {
    const y = top + row * 28;
    for (let x = -(row % 2) * 24; x < 480; x += 48) {
      ctx.fillStyle = (x / 48 + row) % 3 ? '#2a3350' : '#30395a';
      ctx.fillRect(x + 1, y + 1, 46, 26);
      ctx.fillStyle = '#1b2236';
      ctx.fillRect(x, y, 48, 1);
      ctx.fillRect(x, y, 1, 28);
    }
  }
  ctx.fillStyle = '#4a5578';
  ctx.fillRect(0, PLAY_BOTTOM - 4, 480, 4);
}

function drawPlinth(ctx, f) {
  ctx.fillStyle = '#4a5578';
  ctx.fillRect(f.x - f.hw - 4, f.y + f.hh - 2, f.hw * 2 + 8, 7);
  ctx.fillStyle = '#2e3752';
  ctx.fillRect(f.x - f.hw - 4, f.y + f.hh + 3, f.hw * 2 + 8, 2);
}

function drawFoe(ctx, f, env) {
  drawPlinth(ctx, f);
  const kind = f.charge ? f.charge.kind : null;
  const eye = kind === 'slam' ? COLORS.slam : kind ? COLORS[kind] : '#6b7a99';
  if (f.type === 'guardian') {
    ctx.fillStyle = f.exposed > 0 ? '#8a6a5a' : '#5a6580';
    ctx.fillRect(f.x - f.hw, f.y - f.hh, f.hw * 2, f.hh * 2);
    ctx.fillStyle = '#3a4260';
    ctx.fillRect(f.x - f.hw, f.y + f.hh - 8, f.hw * 2, 8);
    ctx.fillStyle = eye;
    ctx.fillRect(f.x - 8, f.y - 6, 16, 8);
    if (f.exposed > 0)
      text(
        ctx,
        `${env.t('CRACKED', '碎裂')} ${f.exposed.toFixed(1)}`,
        f.x,
        f.y + f.hh + 22,
        COLORS.gold,
        14,
        'center',
      );
  } else {
    pixelSprite(ctx, TURRET, f.x - f.hw, f.y - f.hh, 2, {
      m: '#6b7a99',
      s: '#3a4260',
      d: '#262c40',
      E: eye,
    });
  }
  for (let i = 0; i < f.maxHp; i++) {
    ctx.fillStyle = i < f.hp ? COLORS.gold : '#3a2a2a';
    ctx.fillRect(f.x - f.maxHp * 3 + i * 6, f.y + f.hh + 3, 5, 3);
  }
  if (f.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(f.x - f.hw, f.y - f.hh, f.hw * 2, f.hh * 2);
  }
}

const KIND_WORD = {
  orb: ['ORB', '光球'],
  slug: ['SLUG', '橙弹'],
  lance: ['LANCE', '长矛'],
  slam: ['SLAM', '重击'],
};

function drawTelegraph(ctx, f, w, env) {
  const c = f.charge;
  if (!c) return;
  const k = c.t / c.dur;
  const [en, zh] = KIND_WORD[c.kind];
  text(ctx, env.t(en, zh), f.x, f.y + f.hh + 9, '#fff', 14, 'center');
  if (c.kind === 'lance') {
    const half = laneHalfWidth(c.dirx, c.diry);
    const nx = -c.diry * half,
      ny = c.dirx * half,
      len = 700;
    ctx.fillStyle = `rgba(255,59,74,${0.15 + 0.3 * k})`;
    ctx.beginPath();
    ctx.moveTo(f.x + nx, f.y + ny);
    ctx.lineTo(f.x + c.dirx * len + nx, f.y + c.diry * len + ny);
    ctx.lineTo(f.x + c.dirx * len - nx, f.y + c.diry * len - ny);
    ctx.lineTo(f.x - nx, f.y - ny);
    ctx.fill();
    ctx.strokeStyle = '#ff7080';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x + nx, f.y + ny);
    ctx.lineTo(f.x + c.dirx * len + nx, f.y + c.diry * len + ny);
    ctx.moveTo(f.x - nx, f.y - ny);
    ctx.lineTo(f.x + c.dirx * len - nx, f.y + c.diry * len - ny);
    ctx.stroke();
  } else if (c.kind === 'slam') {
    ctx.strokeStyle = COLORS.slam;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.lx, c.ly, SLAM_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(176,76,255,${0.1 + 0.35 * k})`;
    ctx.beginPath();
    ctx.arc(c.lx, c.ly, SLAM_R * k, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = COLORS[c.kind];
    ctx.lineWidth = 2;
    const ring = f.hw + 14 - 10 * k;
    ctx.beginPath();
    if (c.kind === 'slug') ctx.rect(f.x - ring, f.y - ring, ring * 2, ring * 2);
    else ctx.arc(f.x, f.y, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(w.p.x, w.p.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawShot(ctx, s) {
  if (s.reflected) {
    const sp = Math.hypot(s.vx, s.vy) || 1;
    for (const [len, width, color] of [
      [40, 7, 'rgba(255,215,106,0.25)'],
      [30, 4, 'rgba(255,215,106,0.6)'],
      [20, 2, '#ffffff'],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (s.vx / sp) * len, s.y - (s.vy / sp) * len);
      ctx.stroke();
    }
  }
  if (s.kind === 'orb') {
    ctx.fillStyle = s.reflected ? COLORS.gold : COLORS.orb;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (s.kind === 'slug') {
    ctx.fillStyle = COLORS.slug;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    ctx.strokeStyle = '#442200';
    ctx.strokeRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  } else {
    const sp = Math.hypot(s.vx, s.vy) || 1,
      ux = s.vx / sp,
      uy = s.vy / sp;
    ctx.fillStyle = COLORS.lance;
    ctx.beginPath();
    ctx.moveTo(s.x + ux * 12, s.y + uy * 12);
    ctx.lineTo(s.x - ux * 8 - uy * 5, s.y - uy * 8 + ux * 5);
    ctx.lineTo(s.x - ux * 8 + uy * 5, s.y - uy * 8 - ux * 5);
    ctx.fill();
  }
}

function drawShield(ctx, p) {
  const a0 = p.face - SHIELD_HALF;
  if (!shieldIsUp(p)) {
    // Lowered: a faint dotted ghost shows where the plates will rise.
    ctx.strokeStyle = 'rgba(216,236,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R, a0, a0 + SHIELD_HALF * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const flash = p.blockT > 0,
    segs = 5,
    span = (SHIELD_HALF * 2) / segs;
  ctx.shadowColor = flash ? '#ffffff' : '#7fc4ff';
  ctx.shadowBlur = flash ? 14 : 8;
  for (let i = 0; i < segs; i++) {
    const s0 = a0 + i * span + 0.03,
      s1 = a0 + (i + 1) * span - 0.03;
    ctx.lineWidth = SHIELD_THICK;
    ctx.strokeStyle = flash ? '#ffffff' : i % 2 ? '#6fa8e8' : '#9fd0ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R, s0, s1);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_OUTER - 1, s0, s1);
    ctx.stroke();
    ctx.strokeStyle = '#25406e';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SHIELD_R - SHIELD_THICK / 2 + 1, s0, s1);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (flash) {
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 2;
    const mid = p.face;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(mid) * 18, p.y + Math.sin(mid) * 18);
    ctx.lineTo(p.x + Math.cos(mid + 0.15) * 28, p.y + Math.sin(mid + 0.15) * 28);
    ctx.stroke();
  }
}

function drawSentinel(ctx, w) {
  const p = w.p;
  if (p.inv > 0 && Math.floor(p.inv * 12) % 2) ctx.globalAlpha = 0.4;
  pixelSprite(ctx, SENTINEL, p.x - BODY.hw, p.y - BODY.hh, 2, SENTINEL_PALETTE);
  ctx.globalAlpha = 1;
  const fx = Math.cos(p.face),
    fy = Math.sin(p.face);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(Math.round(p.x + fx * 15 - 2), Math.round(p.y + fy * 15 - 2), 4, 4);
  drawShield(ctx, p);
  if (p.bashT > 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BASH_R, p.face - BASH_HALF, p.face + BASH_HALF);
    ctx.stroke();
  }
}

function drawHud(ctx, w, env) {
  const s = snapshot(w);
  ctx.fillStyle = '#0b0e16';
  ctx.fillRect(0, 0, 480, PLAY_TOP - 2);
  ctx.fillRect(0, PLAY_BOTTOM + 2, 480, 320 - PLAY_BOTTOM - 2);
  text(ctx, env.t(s.status.en.split(' · ')[0], s.status.zh.split(' · ')[0]), 8, 7, '#fff', 14);
  for (let i = 0; i < MAX_HP; i++) {
    ctx.fillStyle = i < w.hp ? '#ff4d6a' : '#3a2230';
    ctx.fillRect(150 + i * 16, 8, 12, 12);
  }
  text(ctx, env.t('Shield', '盾'), 250, 7, '#fff', 14);
  const e = s.sentinel;
  ctx.fillStyle = '#243049';
  ctx.fillRect(298, 9, 60, 10);
  ctx.fillStyle = e.broken > 0 ? COLORS.lance : COLORS.shield;
  ctx.fillRect(
    298,
    9,
    60 * (e.broken > 0 ? 1 - e.broken / BROKEN_TIME : e.energy / MAX_ENERGY),
    10,
  );
  text(ctx, env.t('Bash', '重击'), 366, 7, '#fff', 14);
  ctx.fillStyle = '#243049';
  ctx.fillRect(418, 9, 54, 10);
  ctx.fillStyle = e.bashCooldown > 0 ? '#7a6a3a' : COLORS.gold;
  ctx.fillRect(418, 9, 54 * (1 - e.bashCooldown / BASH_CD), 10);
  text(ctx, env.t(s.prompt.en, s.prompt.zh), 240, 301, '#fff', 14, 'center');
}

export const TIP_SIZE = 14;
export const TIP_WIDTH = 440;
const CJK = /[一-鿿，。：；！？、·]/;
/** Estimated rendered width of bold monospace text: Latin 0.6 em, CJK 1 em. */
export const textWidth = (str, size) =>
  [...str].reduce((n, ch) => n + (CJK.test(ch) ? size : size * 0.6), 0);
/** Greedy wrap into lines no wider than maxWidth; breaks at spaces, or anywhere in CJK text. */
export function wrapLines(str, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const token of str.match(/[^\x00-\x7f]|[\x00-\x7f]+?(?=[^\x00-\x7f]|\s|$)\s*/g)) {
    if (line && textWidth(line + token.trimEnd(), size) > maxWidth) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += token;
  }
  return [...lines, line.trimEnd()];
}

export const INTRO_BOX = Object.freeze({ x: 16, y: 96, w: 448, h: 62 });

function drawIntro(ctx, w, env) {
  const cfg = levelOf(w.level);
  ctx.fillStyle = 'rgba(11,14,22,0.82)';
  ctx.fillRect(INTRO_BOX.x, INTRO_BOX.y, INTRO_BOX.w, INTRO_BOX.h);
  text(ctx, `${w.level}. ${env.t(cfg.name.en, cfg.name.zh)}`, 240, 99, COLORS.gold, 16, 'center');
  wrapLines(env.t(cfg.tip.en, cfg.tip.zh), TIP_SIZE, TIP_WIDTH).forEach((line, i) =>
    text(ctx, line, 240, 119 + i * 16, '#fff', TIP_SIZE, 'center'),
  );
}

export function drawWorld(ctx, w, env) {
  drawFloor(ctx);
  for (const c of w.crawlers) {
    if (c.portal > 0) {
      ctx.fillStyle = 'rgba(176,76,255,0.55)';
      ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
      ctx.strokeStyle = '#d8c8ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(c.x - 13, c.y - 13, 26, 26);
      ctx.fillStyle = '#4a5578';
      for (const [dx, dy] of [
        [-15, -15],
        [11, -15],
        [-15, 11],
        [11, 11],
      ])
        ctx.fillRect(c.x + dx, c.y + dy, 4, 4);
    } else {
      ctx.fillStyle = '#c0d060';
      ctx.fillRect(c.x - c.hw, c.y - c.hh, c.hw * 2, c.hh * 2);
      ctx.fillStyle = '#2b3310';
      ctx.fillRect(c.x - 3, c.y - 2, 2, 2);
      ctx.fillRect(c.x + 1, c.y - 2, 2, 2);
    }
    if (c.stun > 0) text(ctx, '*', c.x, c.y - 14, COLORS.gold, 14, 'center');
  }
  for (const f of w.foes) if (f.hp > 0) drawTelegraph(ctx, f, w, env);
  for (const f of w.foes) if (f.hp > 0) drawFoe(ctx, f, env);
  drawSentinel(ctx, w);
  for (const s of w.shots) drawShot(ctx, s);
  for (const f of w.fx) {
    const k = f.t / f.life;
    ctx.strokeStyle = f.kind === 'hurt' ? '#ff4d6a' : COLORS.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 4 + (f.kind === 'slam' ? SLAM_R : 14) * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (w.introT > 0) drawIntro(ctx, w, env);
  drawHud(ctx, w, env);
}

const TIER_LABELS = Object.freeze({
  teach: Object.freeze(['TEACH', '教学']),
  combo: Object.freeze(['COMBO', '组合']),
  master: Object.freeze(['MASTER', '精通']),
});

export function drawMenu(ctx, env, menu) {
  background(ctx, '#0b1022');
  text(ctx, env.t('Choose a level', '选择关卡'), 240, 6, COLORS.gold, 16, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      lv = levelOf(n);
    ctx.fillStyle = locked ? '#1a2033' : '#2a3350';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.strokeStyle = n === menu.cursor ? COLORS.gold : '#4a5578';
    ctx.lineWidth = n === menu.cursor ? 3 : 1;
    ctx.strokeRect(q.x, q.y, q.w, q.h);
    const cx = q.x + q.w / 2;
    text(ctx, locked ? `${n} --` : `${n}`, cx, q.y + 3, locked ? '#667' : '#fff', 14, 'center');
    if (!locked) {
      const tag = lv.guardian ? env.t('BOSS', '首领') : env.t(...TIER_LABELS[lv.tier]);
      text(ctx, tag, cx, q.y + 21, lv.guardian ? COLORS.lance : COLORS.shield, 14, 'center');
    }
  }
  const lv = levelOf(menu.cursor);
  text(
    ctx,
    `${menu.cursor}. ${env.t(lv.name.en, lv.name.zh)}`,
    240,
    262,
    COLORS.gold,
    14,
    'center',
  );
  const hint = env.t('Arrows choose · Space starts · or tap', '方向键选择 · 空格开始 · 或点按');
  text(ctx, hint, 240, 284, '#fff', 14, 'center');
}
