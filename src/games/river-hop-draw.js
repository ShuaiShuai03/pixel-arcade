// Canvas drawing for River Hop: frog, banks, decks, traffic, HUD and the crossing select.
import { drawPixelText as text, background } from '../shared/utils.js';
import { TOP, ROW, LEVELS, LEVEL_COUNT, ferryV } from './river-hop-levels.js';
import {
  FROG_TIME,
  turtleState,
  laneVelocity,
  frogRects,
  homeRect,
  carRects,
} from './river-hop-step.js';
import { riverCue, wrapText } from './river-hop-text.js';
import { menuCell } from './river-hop-menu.js';

const THEMES = Object.freeze(
  [
    { sky: '#183c42', water: '#24586c', bank: '#42684d' },
    { sky: '#203b49', water: '#325b70', bank: '#4f6752' },
    { sky: '#393d50', water: '#44536c', bank: '#61684c' },
    { sky: '#2c3446', water: '#2d4d66', bank: '#55644f' },
  ].map(Object.freeze),
);

function drawFrog(ctx, f, s) {
  const lift = Math.max(0, f.z),
    shadow = 10 - lift * 0.22;
  ctx.fillStyle = '#142e3b99';
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + 6, shadow, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const r of frogRects(f)) {
    ctx.fillStyle = '#233f39';
    ctx.fillRect(Math.round(r.x), Math.round(r.y - lift), r.w, r.h);
    ctx.fillStyle = f.pose === 'takeoff' ? '#d5e88f' : '#aad779';
    ctx.fillRect(
      Math.round(r.x + 1),
      Math.round(r.y - lift + 1),
      Math.max(1, r.w - 2),
      Math.max(1, r.h - 2),
    );
  }
  ctx.fillStyle = '#d7e89c';
  ctx.fillRect(f.x - 4, f.y - 4 - lift, 8, 7);
  ctx.fillStyle = '#6a9a61';
  ctx.fillRect(f.x - 6, f.y - 1 - lift, 2, 3);
  ctx.fillRect(f.x + 4, f.y - 1 - lift, 2, 3);
  ctx.fillStyle = '#192f35';
  const blink = f.grounded && Math.floor(s.totalTime * 2) % 9 === 8;
  ctx.fillRect(f.x - 6, f.y - 8 - lift, 2, blink ? 1 : 2);
  ctx.fillRect(f.x + 4, f.y - 8 - lift, 2, blink ? 1 : 2);
  ctx.fillRect(f.x - 2, f.y + 2 - lift, 4, 1);
  if (f.pose === 'landed') {
    ctx.fillStyle = '#e2ebaf';
    ctx.fillRect(f.x - 10, f.y + 6, 4, 1);
    ctx.fillRect(f.x + 6, f.y + 6, 4, 1);
  }
}
function drawBank(ctx, y, stage, median = false) {
  ctx.fillStyle = '#2a4f48';
  ctx.fillRect(0, y, 480, 28);
  ctx.fillStyle = stage.bank;
  ctx.fillRect(0, y + 2, 480, 24);
  ctx.fillStyle = '#8b9b6a';
  ctx.fillRect(0, y + 2, 480, 2);
  ctx.fillStyle = '#314e43';
  ctx.fillRect(0, y + 25, 480, 2);
  for (let n = 0; n < 24; n++) {
    const x = (n * 23) % 480,
      py = y + 7 + (n % 3) * 6;
    ctx.fillStyle = n % 3 ? '#6d8156' : '#8d9663';
    ctx.fillRect(x, py, 2, 2);
    ctx.fillRect(x + 3, py - 2, 1, 3);
  }
  for (const x of [3, 12, 463, 474]) {
    ctx.fillStyle = '#304f40';
    ctx.fillRect(x, y + 7, 2, 13);
    ctx.fillRect(x + 4, y + 10, 2, 10);
    ctx.fillStyle = '#a4a06d';
    ctx.fillRect(x, y + 5, 2, 5);
  }
  if (median) {
    ctx.fillStyle = '#b7bb8a';
    ctx.fillRect(23, y + 8, 5, 8);
    ctx.fillRect(453, y + 8, 5, 8);
    ctx.fillStyle = '#314e43';
    ctx.fillRect(24, y + 9, 3, 5);
    ctx.fillRect(454, y + 9, 3, 5);
  }
}
function drawHome(ctx, s, n) {
  const r = homeRect(n),
    occupied = s.homes.includes(n),
    cx = n * 120 + 60;
  // The entire outlined landing dock is solid; the lily and reeds are surface decoration.
  ctx.fillStyle = '#183d40';
  ctx.fillRect(r.x - 2, r.y - 1, r.w + 4, r.h + 1);
  ctx.fillStyle = occupied ? '#718958' : '#6d9965';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#afba7a';
  ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, 2);
  ctx.fillStyle = '#456a4d';
  ctx.fillRect(cx - 18, r.y + 6, 36, 16);
  ctx.fillRect(cx - 12, r.y + 3, 24, 21);
  ctx.fillStyle = '#95b574';
  ctx.fillRect(cx - 15, r.y + 7, 30, 2);
  ctx.fillRect(cx - 2, r.y + 9, 2, 12);
  ctx.fillStyle = '#375d49';
  ctx.fillRect(r.x + 5, r.y + 7, 2, 14);
  ctx.fillRect(r.x + r.w - 7, r.y + 7, 2, 14);
  if (occupied) {
    ctx.fillStyle = '#d9e7a0';
    ctx.fillRect(cx - 6, r.y + 9, 12, 9);
    ctx.fillRect(cx - 7, r.y + 7, 4, 4);
    ctx.fillRect(cx + 3, r.y + 7, 4, 4);
    ctx.fillStyle = '#274d43';
    ctx.fillRect(cx - 6, r.y + 8, 2, 2);
    ctx.fillRect(cx + 4, r.y + 8, 2, 2);
    ctx.fillStyle = '#d9e7a0';
    ctx.fillRect(cx - 9, r.y + 17, 5, 3);
    ctx.fillRect(cx + 4, r.y + 17, 5, 3);
  } else {
    text(ctx, String(n + 1), cx, r.y + 7, '#dce5b0', 12, 'center');
  }
}
function drawLog(ctx, lane, o) {
  const y = TOP + lane.row * ROW;
  ctx.fillStyle = '#483d34';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#7f674a';
  ctx.fillRect(o.x + 1, y + 5, o.w - 2, 17);
  ctx.fillStyle = '#b29361';
  ctx.fillRect(o.x + 2, y + 5, o.w - 4, 3);
  ctx.fillStyle = '#5c4939';
  ctx.fillRect(o.x + 2, y + 20, o.w - 4, 3);
  for (const x of [o.x + 3, o.x + o.w - 12]) {
    ctx.fillStyle = '#bb9a68';
    ctx.fillRect(x, y + 7, 9, 13);
    ctx.fillStyle = '#6b523d';
    ctx.fillRect(x + 2, y + 9, 5, 1);
    ctx.fillRect(x + 2, y + 17, 5, 1);
    ctx.fillRect(x + 1, y + 11, 1, 5);
    ctx.fillRect(x + 7, y + 11, 1, 5);
    ctx.fillStyle = '#e0ba7d';
    ctx.fillRect(x + 4, y + 12, 1, 3);
  }
  for (let x = o.x + 21; x < o.x + o.w - 17; x += 23) {
    ctx.fillStyle = '#544b3b';
    ctx.fillRect(x, y + 11, 9, 1);
    ctx.fillRect(x + 5, y + 15, 12, 1);
    ctx.fillStyle = '#9d7f54';
    ctx.fillRect(x - 3, y + 18, 11, 1);
  }
}
function drawTurtles(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW,
    phase = turtleState(lane, s.time);
  if (phase === 'down') {
    ctx.fillStyle = '#7d9b9c';
    for (let x = o.x + 2; x < o.x + o.w; x += 12) {
      ctx.fillRect(x, y + 8, 6, 1);
      ctx.fillRect(x + 4, y + 21, 6, 1);
    }
    text(ctx, '≈', o.x + o.w / 2, y + 6, '#9bb7b6', 14, 'center');
    return;
  }
  // A rope mat bridges the turtles, so every visible part of this deck can carry a foot.
  ctx.fillStyle = '#46685b';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#a4b27a';
  ctx.fillRect(o.x, y + 4, o.w, 2);
  ctx.fillRect(o.x, y + 22, o.w, 2);
  for (let x = o.x; x < o.x + o.w; x += 24) {
    const w = Math.min(24, o.x + o.w - x);
    ctx.fillStyle = phase === 'warning' ? '#ceb470' : '#7fab77';
    ctx.fillRect(x + 1, y + 6, Math.max(1, w - 2), 15);
    ctx.fillStyle = '#3e6c58';
    ctx.fillRect(x + 4, y + 8, Math.max(1, w - 8), 11);
    ctx.fillStyle = phase === 'warning' ? '#ead69a' : '#a1c48a';
    ctx.fillRect(x + 6, y + 9, Math.max(1, w - 12), 2);
    ctx.fillRect(x + 6, y + 16, Math.max(1, w - 12), 2);
    ctx.fillStyle = '#2b564c';
    ctx.fillRect(x + Math.max(1, w - 6), y + 7, 2, 2);
    if (phase === 'warning') {
      ctx.fillStyle = '#ead69a';
      ctx.fillRect(x + 7, y + 9, 2, 10);
      ctx.fillRect(x + 13, y + 9, 2, 10);
    }
  }
  if (phase === 'warning') text(ctx, '↓', o.x + o.w / 2, y + 5, '#f1e1ab', 14, 'center');
}
function drawFerry(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW;
  ctx.fillStyle = '#463f3a';
  ctx.fillRect(o.x, y + 4, o.w, 20);
  ctx.fillStyle = '#a48a61';
  ctx.fillRect(o.x + 1, y + 5, o.w - 2, 18);
  ctx.fillStyle = '#d0b483';
  ctx.fillRect(o.x + 3, y + 5, o.w - 6, 2);
  ctx.fillRect(o.x + 3, y + 21, o.w - 6, 2);
  for (let x = o.x + 11; x < o.x + o.w - 8; x += 14) {
    ctx.fillStyle = '#77644f';
    ctx.fillRect(x, y + 8, 1, 12);
  }
  ctx.fillStyle = '#ddd0a4';
  ctx.fillRect(o.x + 2, y + 4, 3, 20);
  ctx.fillRect(o.x + o.w - 5, y + 4, 3, 20);
  for (const x of [o.x + 11, o.x + o.w - 23]) {
    ctx.fillStyle = '#374d4e';
    ctx.fillRect(x, y + 8, 12, 12);
    ctx.fillStyle = '#bac2a0';
    const turn = Math.floor(s.time * 8) % 3;
    ctx.fillRect(x + 2 + turn * 2, y + 10, 2, 8);
    ctx.fillRect(x + 2, y + 13, 8, 2);
  }
  text(ctx, ferryV(lane, s.time) > 0 ? '→' : '←', o.x + o.w / 2, y + 6, '#f0e1b0', 14, 'center');
}
function drawCar(ctx, lane, o, s) {
  const y = TOP + lane.row * ROW,
    forward = lane.speed > 0,
    pal = ['#dea264', '#78a3b6', '#b78385', '#a8ad72'][lane.row - 5];
  for (const r of carRects(lane, o)) {
    ctx.fillStyle = '#172b36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.fillStyle = '#91a4a8';
  for (const x of [o.x + 6, o.x + o.w - 12]) {
    ctx.fillRect(x, y + 3, 5, 1);
    ctx.fillRect(x, y + 24, 5, 1);
  }
  ctx.fillStyle = pal;
  ctx.fillRect(o.x + 1, y + 6, o.w - 2, 16);
  ctx.fillStyle = '#e4c7a2';
  ctx.fillRect(o.x + 3, y + 6, o.w - 6, 1);
  const cab = forward ? o.x + o.w - 22 : o.x + 5;
  ctx.fillStyle = '#3c586b';
  ctx.fillRect(cab, y + 8, 17, 12);
  ctx.fillStyle = '#bad5d1';
  ctx.fillRect(cab + 2, y + 9, 13, 4);
  ctx.fillRect(cab + 2, y + 15, 13, 4);
  ctx.fillStyle = pal;
  ctx.fillRect(cab + 7, y + 8, 3, 12);
  if (o.w > 65) {
    for (let x = o.x + 9; x < o.x + o.w - 8; x += 11)
      if (x < cab - 1 || x > cab + 16) {
        ctx.fillStyle = '#3c586b';
        ctx.fillRect(x, y + 9, 7, 10);
        ctx.fillStyle = '#9db9bb';
        ctx.fillRect(x + 1, y + 10, 5, 3);
      }
    ctx.fillStyle = '#899281';
    ctx.fillRect(o.x + o.w / 2 - 7, y + 12, 14, 4);
  } else if (o.w > 48) {
    const bx = forward ? o.x + 5 : o.x + 27;
    ctx.fillStyle = '#556760';
    ctx.fillRect(bx, y + 9, o.w - 33, 10);
    ctx.fillStyle = '#a8a176';
    ctx.fillRect(bx + 2, y + 11, Math.max(2, o.w - 38), 2);
    ctx.fillRect(bx + 2, y + 15, Math.max(2, o.w - 38), 2);
  }
  ctx.fillStyle = '#f0ddb0';
  const front = forward ? o.x + o.w - 2 : o.x + 1;
  ctx.fillRect(front, y + 7, 1, 3);
  ctx.fillRect(front, y + 18, 1, 3);
  ctx.fillStyle = '#bc7768';
  const back = forward ? o.x + 1 : o.x + o.w - 2;
  ctx.fillRect(back, y + 8, 1, 2);
  ctx.fillRect(back, y + 18, 1, 2);
}
function drawCrossing(ctx, s, env) {
  const level = LEVELS[s.level - 1],
    stage = THEMES[level.theme];
  background(ctx, stage.sky);
  ctx.fillStyle = stage.water;
  ctx.fillRect(0, TOP, 480, ROW);
  drawBank(ctx, TOP + 4 * ROW, stage, true);
  drawBank(ctx, TOP + 9 * ROW, stage);
  for (let n = 0; n < 4; n++) drawHome(ctx, s, n);
  for (const lane of s.lanes) {
    const y = TOP + lane.row * ROW;
    ctx.fillStyle = lane.water ? stage.water : '#30394a';
    ctx.fillRect(0, y, 480, 28);
    if (lane.water) {
      ctx.fillStyle = '#6f919744';
      for (let n = 0; n < 16; n++) {
        const x = ((n * 37 + s.time * laneVelocity(lane, s.time) * 0.24 + 960) % 540) - 30;
        ctx.fillRect(x, y + 8 + (n % 3) * 6, 11, 1);
      }
      ctx.fillStyle = '#7e999277';
      for (let n = 0; n < 5; n++) {
        const x = n * 105 + 16;
        ctx.fillRect(x, y + 1, 6, 1);
        ctx.fillRect(x + (laneVelocity(lane, s.time) > 0 ? 5 : 0), y, 1, 3);
      }
    } else {
      ctx.fillStyle = '#202f3b';
      ctx.fillRect(0, y, 480, 2);
      ctx.fillStyle = '#7d8583';
      for (let x = 8; x < 480; x += 44) ctx.fillRect(x, y + 26, 21, 1);
    }
    if (lane.kind === 'ferry') {
      ctx.fillStyle = '#87978d';
      ctx.fillRect(0, y + 2, 480, 1);
      ctx.fillRect(0, y + 25, 480, 1);
      for (const x of [3, 469]) {
        ctx.fillStyle = '#263f48';
        ctx.fillRect(x, y + 1, 8, 26);
        ctx.fillStyle = '#bdc5a6';
        ctx.fillRect(x + 2, y + 5, 4, 18);
        ctx.fillStyle = '#59726e';
        ctx.fillRect(x + 3, y + 9, 2, 10);
      }
    }
    for (const o of lane.objects) {
      if (lane.kind === 'turtles') drawTurtles(ctx, lane, o, s);
      else if (lane.kind === 'ferry') drawFerry(ctx, lane, o, s);
      else if (lane.water) drawLog(ctx, lane, o);
      else drawCar(ctx, lane, o, s);
    }
  }
  for (const r of s.ripples) {
    ctx.strokeStyle = r.type === 'water' ? '#b2d4d8' : '#c8e0a8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      r.x,
      r.y + 5,
      8 + (1 - r.life / 0.55) * 18,
      3 + (1 - r.life / 0.55) * 5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  if (s.feedback?.type === 'traffic') {
    const p = s.feedback;
    ctx.fillStyle = '#edc39a';
    for (let n = 0; n < 8; n++) {
      const a = (n * Math.PI) / 4,
        d = 8 + (1 - p.life / 0.65) * 14;
      ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 3, 3);
    }
  }
  if (s.spawnDelay === 0 && s.transition === 0 && s.phase !== 'lost') drawFrog(ctx, s.frog, s);
  ctx.fillStyle = '#152f37';
  ctx.fillRect(0, 0, 480, 32);
  text(
    ctx,
    `${s.level}/${LEVEL_COUNT} ${env.t(level.name.en, level.name.zh)}`,
    10,
    4,
    '#d3e2b5',
    12,
  );
  text(
    ctx,
    `${env.t('TIME', '时间')} ${Math.ceil(Math.max(0, s.timeLeft))}`,
    470,
    4,
    s.timeLeft < 10 ? '#efb18c' : '#e6dfbd',
    12,
    'right',
  );
  text(ctx, `${env.t('HOMES', '家园')} ${s.homes.length}/4`, 10, 19, '#b6cead', 12);
  const cue = riverCue(s);
  text(ctx, env.t(cue.en, cue.zh), 240, 19, '#e0d5a6', 12, 'center');
  text(ctx, `${env.t('FROGS', '青蛙')} ${s.lives}`, 470, 19, '#b6cead', 12, 'right');
  ctx.fillStyle = '#3b5658';
  ctx.fillRect(0, 31, 480, 1);
  ctx.fillStyle = s.timeLeft < 10 ? '#d9a27e' : '#93ae81';
  ctx.fillRect(0, 31, (480 * Math.max(0, s.timeLeft)) / FROG_TIME, 1);
}

const TIP_SIZE = 10,
  TIP_WIDTH = 440;
function drawSelect(ctx, env, menu) {
  background(ctx, THEMES[0].sky);
  const lang = env.t('en', 'zh');
  text(ctx, env.t('CHOOSE A CROSSING', '选择渡口'), 240, 8, '#d3e2b5', 13, 'center');
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const q = menuCell(n),
      locked = n > menu.unlocked,
      chosen = n === menu.cursor;
    ctx.fillStyle = locked ? '#1d3036' : chosen ? '#4a7a63' : '#2d5148';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    if (chosen) {
      ctx.strokeStyle = '#f0e1b0';
      ctx.lineWidth = 2;
      ctx.strokeRect(q.x + 1, q.y + 1, q.w - 2, q.h - 2);
    }
    const label = locked
      ? env.t('LOCKED', '未解锁')
      : n < menu.unlocked
        ? env.t('CLEARED', '已通关')
        : env.t('NEXT', '下一关');
    text(ctx, String(n), q.x + q.w / 2, q.y + 4, locked ? '#5d7478' : '#f0f6e5', 14, 'center');
    text(ctx, label, q.x + q.w / 2, q.y + 21, locked ? '#5d7478' : '#b6cead', 9, 'center');
  }
  const level = LEVELS[menu.cursor - 1],
    top = menuCell(LEVEL_COUNT).y + 44;
  text(ctx, `${menu.cursor}. ${level.name[lang]}`, 240, top, '#e0d5a6', 13, 'center');
  wrapText(level.tip[lang], TIP_SIZE, TIP_WIDTH).forEach((line, i) =>
    text(ctx, line, 240, top + 20 + i * 13, '#c9d8c0', TIP_SIZE, 'center'),
  );
  text(
    ctx,
    env.t('ARROWS MOVE · SPACE / TAP STARTS', '方向键移动 · 空格 / 点击开始'),
    240,
    304,
    '#e7dcb6',
    10,
    'center',
  );
}

export function drawRiver(ctx, s, env, menu) {
  if (menu) drawSelect(ctx, env, menu);
  else drawCrossing(ctx, s, env);
}
