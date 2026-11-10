import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { HEART, drawCourtyard, drawFighter } from './dash-duelist-art.js';
import { PLAY_BOTTOM, PLAY_TOP, angleTo } from './dash-duelist-geometry.js';
import { LEVEL_COUNT, RIVAL_NAMES, levelOf } from './dash-duelist-levels.js';
import { menuCell } from './dash-duelist-menu.js';
import {
  FX_SECONDS,
  PLAYER,
  chargeCount,
  promptFor,
  strikeActive,
  tipVisible,
} from './dash-duelist-world.js';

const P = PLAYER;
const C = {
  danger: '#ff3b4a',
  dangerFill: 'rgba(255,59,74,',
  heavy: '#ff3bd0',
  heavyFill: 'rgba(255,59,208,',
  strike: '#e8f4ff',
  open: '#ffd76a',
  hp: '#ff6b81',
  dash: '#37e6d2',
};

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

// A word under the fighter says what the shape or the opening is, so colour is never the only cue.
function tag(ctx, label, b, color) {
  const width = textWidth(label, TAG_SIZE) + 8,
    y = Math.min(b.y + 20, PLAY_BOTTOM - 18);
  ctx.fillStyle = 'rgba(11,13,22,0.85)';
  ctx.fillRect(b.x - width / 2, y, width, 18);
  text(ctx, label, b.x, y + 2, color, TAG_SIZE, 'center');
}

export const TIP_SIZE = 14;
export const TIP_WIDTH = 440;
export const TIP_BOX = Object.freeze({ x: 16, y: PLAY_TOP + 1, w: 448, h: 32 });
const TAG_SIZE = 14;

function drawTip(ctx, w, env) {
  const cfg = levelOf(w.level);
  ctx.fillStyle = 'rgba(11,14,22,0.88)';
  ctx.fillRect(TIP_BOX.x, TIP_BOX.y, TIP_BOX.w, TIP_BOX.h);
  wrapLines(env.t(cfg.tip.en, cfg.tip.zh), TIP_SIZE, TIP_WIDTH).forEach((line, i) =>
    text(ctx, line, 240, TIP_BOX.y + 2 + i * 16, '#fff', TIP_SIZE, 'center'),
  );
}

function pathShape(ctx, s) {
  ctx.beginPath();
  if (s.shape === 'lane') {
    const c = Math.cos(s.angle),
      n = Math.sin(s.angle);
    const pt = (a, b) => [s.ox + a * c - b * n, s.oy + a * n + b * c];
    [pt(0, -s.hw), pt(s.len - 10, -s.hw), pt(s.len, 0), pt(s.len - 10, s.hw), pt(0, s.hw)].forEach(
      ([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)),
    );
    ctx.closePath();
  } else if (s.shape === 'ring') {
    ctx.arc(s.ox, s.oy, s.r1, 0, Math.PI * 2);
  } else {
    ctx.moveTo(s.ox, s.oy);
    ctx.arc(s.ox, s.oy, s.r1, s.angle - s.half, s.angle + s.half);
    ctx.closePath();
  }
}

function drawTelegraph(ctx, r) {
  const a = r.atk,
    active = r.state === 'active';
  const progress = active ? 1 : 1 - a.t / a.step.windup;
  const heavy = !!a.step.heavy;
  pathShape(ctx, a);
  ctx.fillStyle = active
    ? 'rgba(255,255,255,0.8)'
    : `${heavy ? C.heavyFill : C.dangerFill}${0.1 + 0.4 * progress})`;
  ctx.fill();
  ctx.strokeStyle = heavy ? C.heavy : C.danger;
  ctx.lineWidth = heavy ? 6 : 3;
  ctx.setLineDash(active ? [] : heavy ? [14, 5] : [6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (heavy) {
    // heavy shapes get a second, white inner line so they differ by shape and weight, not colour only
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (!active) {
    // a growing inner copy of the same shape shows how close the strike is
    ctx.save();
    ctx.translate(a.ox, a.oy);
    ctx.scale(progress, progress);
    ctx.translate(-a.ox, -a.oy);
    pathShape(ctx, a);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawStrike(ctx, p) {
  const s = p.strike;
  if (!s) return;
  if (strikeActive(s)) {
    pathShape(ctx, s);
    ctx.fillStyle = 'rgba(232,244,255,0.55)';
    ctx.fill();
    ctx.strokeStyle = C.strike;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (s.t < P.strikeStartup) {
    ctx.strokeStyle = C.strike;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(s.angle + 1.2) * 22, p.y + Math.sin(s.angle + 1.2) * 22);
    ctx.stroke();
  }
}

function drawRival(ctx, r, p, t, env) {
  const aiming = r.state === 'windup' || r.state === 'active';
  const aim = r.atk ? r.atk.angle : angleTo(r, p);
  const pose = aiming ? r.state : r.state === 'recover' ? 'recover' : 'idle';
  ctx.save();
  if (r.flinch > 0) ctx.translate(Math.sin(t * 90) * 2, 0);
  drawFighter(ctx, r.cfg.id, r, aim, pose);
  ctx.restore();
  const top = r.y - 40;
  if (aiming) {
    const heavy = r.atk.step.heavy;
    ctx.fillStyle = heavy ? C.heavy : C.danger;
    ctx.beginPath();
    ctx.moveTo(r.x, top - 2);
    ctx.lineTo(r.x + 9, top + 14);
    ctx.lineTo(r.x - 9, top + 14);
    ctx.closePath();
    ctx.fill();
    text(ctx, heavy ? '!!' : '!', r.x, top + 1, '#fff', 14, 'center');
    const [en, zh] = r.atk.step.label;
    tag(
      ctx,
      env.t(heavy ? `!! ${en.toUpperCase()}` : en.toUpperCase(), heavy ? `!! ${zh}` : zh),
      r,
      C.danger,
    );
  } else if (r.state === 'recover') {
    const bob = Math.sin(t * 8) * 2;
    ctx.fillStyle = C.open;
    ctx.strokeStyle = '#3a2a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, top - 4 + bob);
    ctx.lineTo(r.x + 9, top + 6 + bob);
    ctx.lineTo(r.x, top + 16 + bob);
    ctx.lineTo(r.x - 9, top + 6 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = C.open;
    ctx.strokeRect(r.x - 12, r.y - 16, 24, 32);
    tag(ctx, env.t('OPEN', '破绽'), r, C.open);
  }
}

function drawFx(ctx, fx) {
  for (const f of fx) {
    const k = 1 - f.t / FX_SECONDS;
    ctx.strokeStyle = f.kind === 'hurt' ? C.hp : f.kind === 'clang' ? '#fff' : C.open;
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(a) * (6 + k * 6), f.y + Math.sin(a) * (6 + k * 6));
      ctx.lineTo(f.x + Math.cos(a) * (12 + k * 14), f.y + Math.sin(a) * (12 + k * 14));
      ctx.stroke();
    }
  }
}

function drawHud(ctx, w, env) {
  const p = w.p,
    cfg = levelOf(w.level).rival;
  ctx.fillStyle = '#0b0d16';
  ctx.fillRect(0, 0, 480, PLAY_TOP);
  ctx.fillRect(0, PLAY_BOTTOM, 480, 320 - PLAY_BOTTOM);
  const name = RIVAL_NAMES[cfg.id];
  text(ctx, `${w.level}/${LEVEL_COUNT} ${env.t(name.en, name.zh)}`, 6, 7, '#ffb36b', 14);
  const rivalHp = w.r ? w.r.hp : 0;
  for (let i = 0; i < cfg.hp; i++) {
    ctx.fillStyle = i < rivalHp ? '#ff9a3c' : '#3a2a2a';
    ctx.fillRect(88 + i * 10, 8, 8, 13);
  }
  text(ctx, env.t('You', '你'), 184, 7, '#ff9aaa', 14);
  for (let i = 0; i < P.maxHp; i++)
    pixelSprite(ctx, HEART, 214 + i * 16, 9, 3, { h: i < p.hp ? C.hp : '#4a3038' });
  // dash charges, with a visible recharge fill on the next empty slot
  const full = chargeCount(p),
    frac = p.charges - Math.floor(p.charges + 1e-9);
  text(ctx, env.t('Dash', '闪身'), 300, 7, '#9fe9e0', 14);
  for (let i = 0; i < P.maxCharges; i++) {
    const x = 346 + i * 24;
    ctx.fillStyle = '#18323a';
    ctx.fillRect(x, 8, 20, 13);
    ctx.fillStyle = C.dash;
    if (i < full) ctx.fillRect(x, 8, 20, 13);
    else if (i === full) ctx.fillRect(x, 8, Math.round(20 * frac), 13);
    ctx.strokeStyle = '#9fe9e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 8.5, 19, 12);
  }
  const [en, zh] = promptFor(w);
  const danger = w.r && ['windup', 'active'].includes(w.r.state);
  const color = danger ? '#ff8a96' : w.r && w.r.state === 'recover' ? C.open : '#e8f4ff';
  text(ctx, env.t(en, zh), 240, 298, color, 16, 'center');
}

export function drawWorld(ctx, w, env) {
  const t = w.time,
    p = w.p,
    r = w.r;
  drawCourtyard(ctx, t, levelOf(w.level).court);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PLAY_TOP, 480, PLAY_BOTTOM - PLAY_TOP);
  ctx.clip();
  if (w.msg) text(ctx, env.t(w.msg.en, w.msg.zh), 240, PLAY_TOP + 2, '#fff', 14, 'center');
  else if (tipVisible(w)) drawTip(ctx, w, env);
  if (r && r.atk && (r.state === 'windup' || r.state === 'active')) drawTelegraph(ctx, r);
  if (r) drawRival(ctx, r, p, t, env);
  else if (w.defeated) {
    ctx.globalAlpha = 0.5;
    drawFighter(
      ctx,
      w.defeated.cfg.id,
      { x: w.defeated.x, y: w.defeated.y + 6 },
      Math.PI,
      'recover',
    );
    ctx.globalAlpha = 1;
  }
  const swing = !p.strike
    ? 'idle'
    : strikeActive(p.strike)
      ? 'active'
      : p.strike.t < P.strikeStartup
        ? 'windup'
        : 'recover';
  const blink = p.hitInv > 0 && Math.floor(p.hitInv * 14) % 2 === 0;
  drawFighter(ctx, 'player', p, p.strike ? p.strike.angle : p.face, swing, blink);
  if (p.dashInv > 0) {
    ctx.strokeStyle = C.dash;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 12, p.y - 16, 24, 32);
  }
  drawStrike(ctx, p);
  drawFx(ctx, w.fx);
  ctx.restore();
  drawHud(ctx, w, env);
}

const TIER_LABELS = Object.freeze({
  teach: Object.freeze(['TEACH', '教学']),
  combo: Object.freeze(['COMBO', '组合']),
  master: Object.freeze(['MASTER', '精通']),
});

export function drawMenu(ctx, env, menu) {
  background(ctx, '#0b1022');
  text(ctx, env.t('Choose a level', '选择关卡'), 240, 6, C.open, 16, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      lv = levelOf(n);
    ctx.fillStyle = locked ? '#1a2033' : '#2a3350';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.strokeStyle = n === menu.cursor ? C.open : '#4a5578';
    ctx.lineWidth = n === menu.cursor ? 3 : 1;
    ctx.strokeRect(q.x, q.y, q.w, q.h);
    const cx = q.x + q.w / 2;
    text(ctx, locked ? `${n} --` : `${n}`, cx, q.y + 3, locked ? '#667' : '#fff', 14, 'center');
    if (!locked) text(ctx, env.t(...TIER_LABELS[lv.tier]), cx, q.y + 21, C.dash, 14, 'center');
  }
  const lv = levelOf(menu.cursor);
  text(ctx, `${menu.cursor}. ${env.t(lv.name.en, lv.name.zh)}`, 240, 262, C.open, 14, 'center');
  text(
    ctx,
    env.t('Arrows choose · Space starts · or tap', '方向键选择 · 空格开始 · 或点按'),
    240,
    284,
    '#fff',
    14,
    'center',
  );
}
