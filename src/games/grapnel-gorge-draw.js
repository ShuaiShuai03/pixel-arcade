// Canvas rendering: canyon scene, landing preview, HUD strip and message bar.
import { background, drawPixelText as text } from '../shared/utils.js';
import { PHYSICS, G, R, anchorPose } from './grapnel-gorge-math.js';
import { LEVEL_COUNT } from './grapnel-gorge-levels.js';
import { available, selected } from './grapnel-gorge-core.js';
import { landingPreview } from './grapnel-gorge-step.js';
import { wrapText } from './grapnel-gorge-menu.js';

const TOP_STRIP = 36;
const BOTTOM_STRIP = 304;
const TEXT_SIZE = 11;
const TEXT_LINE = 12;
const TEXT_WIDTH = 464;

function drawWorld(ctx, s) {
  background(ctx, ['#27384a', '#343d4c', '#283e4f'][s.route.theme]);
  const colors = [
    ['#60687a', '#746574', '#a47063'],
    ['#596779', '#6c6172', '#92745e'],
    ['#5d7183', '#746c80', '#9a7a66'],
  ][s.route.theme];
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = colors[layer];
    for (let i = 0; i < 11; i++) {
      const x = i * 53 - layer * 17,
        top = 100 + layer * 37 + Math.sin(i * 2.1 + layer) * 29;
      ctx.fillRect(x, top, 42, 220);
      ctx.fillRect(x + 6, top - 12, 25, 14);
      ctx.fillStyle = layer === 2 ? '#bc927243' : '#ffffff08';
      for (let y = top + 15; y < 300; y += 19) ctx.fillRect(x, y, 42, 2);
      ctx.fillStyle = colors[layer];
    }
  }
  ctx.fillStyle = '#344f61';
  ctx.fillRect(0, 301, 480, 19);
  ctx.strokeStyle = '#92bbc1';
  ctx.lineWidth = 1;
  for (let x = 12; x < 468; x += 19) {
    ctx.beginPath();
    ctx.moveTo(x, 306 + Math.sin(s.time * 2 + x) * 2);
    ctx.lineTo(x + 10, 306 + Math.sin(s.time * 2 + x + 1) * 2);
    ctx.stroke();
  }
  for (const r of s.route.solids) {
    if (r.kind === 'rail') {
      ctx.fillStyle = '#354b58';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#a5b9b8';
      ctx.fillRect(r.x, r.y, r.w, 2);
      for (let x = r.x + 4; x < r.x + r.w; x += 10) {
        ctx.fillStyle = '#d2a36e';
        ctx.fillRect(x, r.y + 4, 3, 3);
      }
      continue;
    }
    ctx.fillStyle = r.kind === 'cairn' ? '#8f6354' : '#725955';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#c18b67';
    ctx.fillRect(r.x, r.y, r.w, 3);
    ctx.fillStyle = '#ac785e';
    ctx.fillRect(r.x + 3, r.y + 4, Math.max(0, r.w - 6), 5);
    for (let y = r.y + 15; y < Math.min(320, r.y + r.h); y += 17) {
      ctx.fillStyle = y % 2 ? '#6f4e4b' : '#b080602a';
      ctx.fillRect(r.x, y, r.w, 2);
      for (let x = r.x + (Math.floor(y / 17) % 2) * 13; x < r.x + r.w; x += 29) {
        ctx.fillStyle = '#5f4849';
        ctx.fillRect(x, y + 2, 2, 11);
      }
    }
  }
  for (const pad of s.route.pads) {
    if (pad.exit) {
      ctx.fillStyle = '#eee0ad';
      ctx.fillRect(pad.x + pad.w - 21, pad.y - 38, 2, 38);
      ctx.fillStyle = '#7be2bc';
      ctx.beginPath();
      ctx.moveTo(pad.x + pad.w - 19, pad.y - 37);
      ctx.lineTo(pad.x + pad.w - 3, pad.y - 31);
      ctx.lineTo(pad.x + pad.w - 19, pad.y - 24);
      ctx.fill();
    } else {
      const x = pad.x + 18;
      if (s.visited.includes(pad.id)) {
        ctx.fillStyle = '#94d5bd';
        ctx.fillRect(x - 7, pad.y - 16, 18, 2);
      }
      ctx.fillStyle = '#d7c6a0';
      ctx.fillRect(x - 5, pad.y - 4, 14, 4);
      ctx.fillRect(x - 3, pad.y - 8, 10, 4);
      ctx.fillRect(x, pad.y - 12, 5, 4);
      ctx.fillStyle = '#8fe0cb';
      ctx.fillRect(x + 3, pad.y - 10, 2, 2);
    }
  }
  const target = selected(s),
    anchors = available(s);
  for (const a of anchors) {
    const source = s.route.anchors[a.id];
    ctx.strokeStyle = '#d1b58a80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, 55);
    ctx.lineTo(a.x, a.y - 8);
    ctx.stroke();
    ctx.fillStyle = '#3e5663';
    ctx.fillRect(a.x - 9, a.y - 9, 18, 18);
    const chosen = a.id === target?.id;
    ctx.strokeStyle = chosen ? '#ffe5a3' : a.eligible ? '#a5e7da' : '#809197';
    ctx.lineWidth = chosen ? 2 : 1;
    ctx.strokeRect(a.x - 8, a.y - 8, 16, 16);
    ctx.fillStyle = '#e0c190';
    ctx.fillRect(a.x - 3, a.y - 3, 6, 6);
    // Shape cues, so state never relies on colour alone: a pointer under the chosen
    // anchor, and a slash through an anchor that cannot be hooked from here.
    if (chosen) {
      ctx.fillStyle = '#ffe5a3';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + 11);
      ctx.lineTo(a.x - 5, a.y + 18);
      ctx.lineTo(a.x + 5, a.y + 18);
      ctx.fill();
    } else if (!a.eligible) {
      ctx.strokeStyle = '#d7897a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x - 8, a.y - 8);
      ctx.lineTo(a.x + 8, a.y + 8);
      ctx.stroke();
    }
    text(ctx, String(a.id + 1), a.x, a.y - 26, a.eligible ? '#fff0c6' : '#b3b9b7', 16, 'center');
    if (a.moving) {
      text(
        ctx,
        source.amplitudeX ? (a.vx >= 0 ? '→' : '←') : a.vy >= 0 ? '↓' : '↑',
        a.x + 18,
        a.y - 6,
        '#a8e5dc',
        13,
        'center',
      );
    }
  }
  for (const relic of s.route.relics)
    if (!s.collected.includes(relic.id)) {
      ctx.strokeStyle = '#eac57c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(relic.x, relic.y - 9);
      ctx.lineTo(relic.x + 7, relic.y);
      ctx.lineTo(relic.x, relic.y + 9);
      ctx.lineTo(relic.x - 7, relic.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#d7b877';
      ctx.fillRect(relic.x - 2, relic.y - 3, 4, 6);
    }
}
function drawActors(ctx, s) {
  const preview = landingPreview(s);
  for (const p of preview) {
    ctx.fillStyle = p.landing ? '#a4edc3' : p.water ? '#e5a07e' : '#e8d7af90';
    if (p.blocked || p.water) {
      ctx.strokeStyle = p.landing ? '#a4edc3' : '#f0ac8c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (p.landing) {
        ctx.moveTo(p.x - 4, p.y);
        ctx.lineTo(p.x - 1, p.y + 3);
        ctx.lineTo(p.x + 5, p.y - 4);
      } else {
        ctx.moveTo(p.x - 4, p.y - 4);
        ctx.lineTo(p.x + 4, p.y + 4);
        ctx.moveTo(p.x - 4, p.y + 4);
        ctx.lineTo(p.x + 4, p.y - 4);
      }
      ctx.stroke();
    } else ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  if (s.rope) {
    const a = anchorPose(s.route.anchors[s.rope.id], s.routeTime);
    ctx.strokeStyle = s.rope.taut ? '#ffe1a0' : '#b9c6ba';
    ctx.lineWidth = 2;
    ctx.setLineDash?.(s.rope.taut ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (!s.rope.taut) {
      const slack = Math.max(0, s.rope.length - Math.hypot(s.player.x - a.x, s.player.y - a.y));
      ctx.quadraticCurveTo(
        (a.x + s.player.x) / 2,
        (a.y + s.player.y) / 2 + Math.min(22, slack / 3),
        s.player.x,
        s.player.y,
      );
    } else ctx.lineTo(s.player.x, s.player.y);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
  const p = s.player;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#273743';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#87dbcb';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e2b874';
  ctx.fillRect(-5, -8, 10, 5);
  ctx.fillRect(-6, -5, 12, 2);
  ctx.fillStyle = '#f0d4aa';
  ctx.fillRect(-3, -2, 6, 4);
  ctx.fillStyle = '#47748a';
  ctx.fillRect(-5, 3, 4, 5);
  ctx.fillRect(1, 3, 4, 5);
  ctx.strokeStyle = '#9ddfce';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(s.rope ? -8 : -7, s.rope ? -8 : 4);
  ctx.moveTo(5, 0);
  ctx.lineTo(s.rope ? 7 : 8, s.rope ? -7 : 3);
  ctx.stroke();
  ctx.fillStyle = '#f6c781';
  ctx.fillRect(-5, 1, 10, 2);
  ctx.fillStyle = '#253441';
  ctx.fillRect(-6, 7, 5, 2);
  ctx.fillRect(1, 7, 5, 2);
  ctx.restore();
  if (s.flash) {
    ctx.strokeStyle = s.flash.type === 'cut' ? '#f3ac87' : '#c1e9c0';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        d = 9 + (0.65 - s.flash.time) * 20;
      ctx.beginPath();
      ctx.moveTo(s.flash.x + Math.cos(a) * d, s.flash.y + Math.sin(a) * d);
      ctx.lineTo(s.flash.x + Math.cos(a) * (d + 5), s.flash.y + Math.sin(a) * (d + 5));
      ctx.stroke();
    }
  }
}

function statusLine(s, env, target) {
  if (s.betweenRoutes)
    return env.t('ROUTE CROSSED · ENTER OR TAP: NEXT ROUTE', '本路线已通过 · 回车或点击：下一路线');
  if (s.recovering > 0) return env.t('RESCUED AT THE CAIRN', '已返回石台');
  if (s.rope) {
    const load = (s.rope.tension / G).toFixed(1);
    return env.t(
      `${s.rope.taut ? 'TAUT' : 'SLACK'} ${Math.round(s.rope.length)} · LOAD ${load}g · ↑↓ WINCH · SPACE RELEASE`,
      `${s.rope.taut ? '受力' : '松弛'}${Math.round(s.rope.length)} · 张力${load}g · ↑↓收放 · 空格松开`,
    );
  }
  if (target)
    return env.t(
      `TARGET ${target.id + 1} · ${Math.round(target.distance)}/${PHYSICS.hookRange}px · SPACE HOOK · X SWITCH`,
      `锚点${target.id + 1} · ${Math.round(target.distance)}/${PHYSICS.hookRange} · 空格钩索 · X切换`,
    );
  return env.t('NO CLEAR ANCHOR · WALK OR RESCUE (Z)', '暂无可用锚点 · 走动或按Z救援');
}
function drawStrips(ctx, s, env) {
  const lang = env.t('en', 'zh'),
    winch = Math.ceil((s.charge / PHYSICS.battery) * 100);
  ctx.fillStyle = '#192d38';
  ctx.fillRect(0, 0, 480, TOP_STRIP);
  text(ctx, `${s.level}/${LEVEL_COUNT} ${s.route.name[lang]}`, 8, 1, '#f0d49b', TEXT_SIZE);
  text(ctx, env.t(`WINCH ${winch}%`, `绞盘${winch}%`), 330, 1, '#aedfd0', TEXT_SIZE, 'center');
  text(ctx, env.t(`LIVES ${s.lives}`, `生命 ${s.lives}`), 472, 1, '#d4e9d2', TEXT_SIZE, 'right');
  wrapText(s.notice[lang], TEXT_SIZE, TEXT_WIDTH)
    .slice(0, 2)
    .forEach((line, i) => text(ctx, line, 240, 13 + i * TEXT_LINE, '#e1d5b8', TEXT_SIZE, 'center'));
  ctx.fillStyle = '#182e37';
  ctx.fillRect(0, BOTTOM_STRIP, 480, 320 - BOTTOM_STRIP);
  text(ctx, statusLine(s, env, selected(s)), 240, BOTTOM_STRIP + 3, '#9fe0d0', TEXT_SIZE, 'center');
}
export function draw(ctx, s, env) {
  drawWorld(ctx, s);
  drawStrips(ctx, s, env);
  drawActors(ctx, s);
}
