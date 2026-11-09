import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { COURSES, LEVEL_COUNT, LOOKS, PADS } from './wallrunner-relay-levels.js';
import {
  LIMITS,
  VIEW_H,
  VIEW_W,
  ZOOM,
  movementMode,
  padUnder,
  wallContact,
} from './wallrunner-relay-step.js';

const TIP_SECONDS = 6; // how long a course's tip stays in the bottom bar after it starts
const BANNER_Y = 44; // the course-clear line sits in the empty strip between the HUD and the runner

function prompt(s) {
  const p = s.player,
    course = COURSES[s.course - 1],
    wall = wallContact(p, course.solids),
    t = (en, zh) => ({ en, zh });
  if (s.energy < 25 && !padUnder(s))
    return t('Low energy! Find a RELAY pad.', '能量不足！去找接力台。');
  if (s.courseClock < TIP_SECONDS) return course.tip;
  if (padUnder(s)) return t('RELAY pad: energy refills here.', '接力台：在此恢复能量。');
  if (!p.ground && wall?.slick)
    return t('Slick wall: no run, no kick.', '湿滑墙：不能跑也不能蹬。');
  if (!p.ground && wall?.chalk) return t('Hold X to run up the chalk.', '按住X沿粉笔墙奔跑。');
  if (!p.ground && wall) {
    const ready = p.kickCooldown <= 0 && p.kickFace !== wall.face && s.energy > LIMITS.kickCost;
    return ready
      ? t('Space: kick across, then kick the opposite wall.', '空格：蹬向对面，再蹬对面墙。')
      : t('Kick spent here. Land or change wall.', '此墙已蹬过。落地或换一面墙。');
  }
  return course.tip;
}

const RUNNER = {
  idle: ['..hh...', '.hhhh..', '.hsss..', '..cc...', '.ccccc.', '.c.c...', '.b.b...', '.bb.bb.'],
  run1: ['..hh...', '.hhhh..', '.hsss..', '.cccc..', 'cc.cc..', '..bb...', '.b..b..', 'bb..bb.'],
  run2: ['..hh...', '.hhhh..', '.hsss..', '..ccc..', '.cc.cc.', '.bb.b..', '..bb...', '..b.bb.'],
  air: ['..hh...', '.hhhh..', '.hsss.c', 'cccccc.', '.cc.c..', '.bb.bb.', 'b....b.', '.......'],
  wall: ['.hh....', 'hhhh.c.', 'hsss.c.', '.ccccc.', '.ccc...', '.bb....', '.bbb...', '.b.b...'],
  kick: ['...hh..', '..hhhh.', '..hsss.', 'cccccc.', '.cc.c..', 'bb..bb.', 'b.....b', '.......'],
};
const RUNNER_COLORS = { h: '#2b2f4a', s: '#f2c9a0', c: '#e0614f', b: '#2d3a5a' };
const RUNNER_OUTLINE = { h: '#fff3c4', s: '#fff3c4', c: '#fff3c4', b: '#fff3c4' };
function flipRows(rows) {
  return rows.map((r) => [...r].reverse().join(''));
}

function drawSky(ctx, s, look) {
  const bands = look.sky;
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, i * 107, 480, 108);
  });
  const cam = s.camera;
  for (let layer = 0; layer < 2; layer++) {
    const par = layer ? 0.45 : 0.2,
      col = layer ? '#1c2a3a' : '#152233';
    for (let i = 0; i < 12; i++) {
      const w = 34 + ((i * 29 + layer * 13) % 30),
        hgt = 70 + ((i * 53 + layer * 31) % 90),
        x = ((i * 83 + layer * 41 - cam.x * par) % 1000) - 60,
        y = 330 - hgt - cam.y * par * 0.4;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, 420);
      ctx.fillStyle = layer ? '#f0c36a' : '#6d7f93';
      for (let wy = y + 8; wy < 320; wy += 14)
        for (let wx = x + 5; wx < x + w - 6; wx += 9) {
          if ((wx * 7 + wy * 3 + i) % 5 < 2) ctx.fillRect(wx, wy, 3, 4);
        }
    }
  }
}
function drawRain(ctx, s) {
  ctx.fillStyle = '#8fb3c9';
  for (let i = 0; i < 46; i++) {
    const x = (i * 97 + s.time * 60) % 500,
      y = (i * 61 + s.time * 330 + (i % 5) * 40) % 340;
    ctx.fillRect(x - 6, y - 6, 1, 6);
    ctx.fillRect(x - 3, y - 3, 1, 3);
  }
}
function drawBuilding(ctx, o, i, look, cam) {
  const x = Math.round(o.x - cam.x),
    y = Math.round(o.y - cam.y),
    h = Math.min(o.h, VIEW_H + 40 - Math.min(y, VIEW_H + 40));
  if (x > VIEW_W || x + o.w < 0 || y > VIEW_H + 10) return;
  ctx.fillStyle = look.brick[1];
  ctx.fillRect(x, y, o.w, h);
  ctx.fillStyle = look.brick[0];
  for (let by = y + 4; by < y + h; by += 8) {
    const off = ((by - y) / 8) % 2 ? 6 : 0;
    for (let bx = x + off; bx < x + o.w; bx += 12) ctx.fillRect(bx, by, 10, 3);
  }
  ctx.fillStyle = look.brick[2];
  ctx.fillRect(x - 2, y, o.w + 4, 5);
  ctx.fillStyle = '#0e1620';
  ctx.fillRect(x - 2, y + 5, o.w + 4, 2);
  ctx.fillStyle = '#9fc7d6';
  for (let wx = x + 8; wx < x + o.w - 10 && !o.boundary; wx += 22) ctx.fillRect(wx, y + 20, 5, 1);
  if (i % 2 === 0 && o.w > 50 && !o.boundary) {
    ctx.fillStyle = '#26303a';
    ctx.fillRect(x + o.w - 14, y - 9, 8, 9);
    ctx.fillStyle = '#4a5864';
    ctx.fillRect(x + o.w - 15, y - 11, 10, 3);
  } else if (o.w > 40 && !o.boundary) {
    ctx.fillStyle = '#7d8a96';
    ctx.fillRect(x + 8, y - 22, 1, 22);
    ctx.fillRect(x + 4, y - 18, 9, 1);
    ctx.fillRect(x + 5, y - 13, 7, 1);
  }
}
function drawFaces(ctx, o, cam, time) {
  const draw = (side, ranges, kind) =>
    ranges.forEach(([y0, y1]) => {
      const fx = Math.round((side === 'L' ? o.x : o.x + o.w) - cam.x),
        ex = side === 'L' ? fx - 4 : fx,
        top = Math.round(y0 - cam.y),
        len = y1 - y0;
      if (kind === 'chalk') {
        const cx = side === 'L' ? fx - 4 : fx + 3;
        ctx.fillStyle = 'rgba(20,28,40,0.55)';
        ctx.fillRect(cx - 3, top, 7, len);
        ctx.fillStyle = '#fffdf0';
        ctx.fillRect(side === 'L' ? fx - 2 : fx, top, 2, len);
        for (let k = 8; k < len + 6; k += 12) {
          const cy = top + len - k;
          ctx.fillRect(cx - 3, cy + 3, 2, 2);
          ctx.fillRect(cx - 2, cy + 2, 2, 2);
          ctx.fillRect(cx - 1, cy + 1, 3, 2);
          ctx.fillRect(cx + 1, cy + 2, 2, 2);
          ctx.fillRect(cx + 2, cy + 3, 2, 2);
        }
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(cx - 3, top - 2, 7, 2);
      } else {
        ctx.fillStyle = '#4fa3a5';
        ctx.fillRect(ex, top, 4, len);
        ctx.fillStyle = '#b4eef0';
        for (let k = 0; k < len; k += 16)
          ctx.fillRect(ex + (side === 'L' ? 0 : 2), top + ((k + time * 40) % len), 2, 4);
      }
    });
  draw('L', o.chalk.L, 'chalk');
  draw('R', o.chalk.R, 'chalk');
  draw('L', o.slick.L, 'slick');
  draw('R', o.slick.R, 'slick');
}
function drawPads(ctx, s, cam, active) {
  PADS[s.course - 1].forEach((pad) => {
    const x = Math.round(pad.x0 - cam.x),
      y = Math.round(pad.y - cam.y),
      w = pad.x1 - pad.x0,
      on = active && active.id === pad.id,
      seen = s.padsSeen.includes(pad.id);
    ctx.fillStyle = on ? '#ffd27a' : seen ? '#f0a04b' : '#c97a3c';
    ctx.fillRect(x, y - 3, w, 3);
    ctx.fillStyle = '#6a3a22';
    ctx.fillRect(x, y - 1, w, 1);
    ctx.fillStyle = on ? '#fff2c2' : '#ffd8a0';
    for (let k = 4; k < w - 4; k += 8) ctx.fillRect(x + k, y - 3, 4, 1);
    if (on) {
      const glow = 3 + Math.floor(Math.abs(Math.sin(s.time * 6)) * 4);
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(x, y - 3 - glow, w, 1);
      ctx.fillRect(x + 2, y - 5 - glow, w - 4, 1);
    }
  });
}
function drawPadLabels(ctx, s, active, env) {
  const cam = s.camera;
  PADS[s.course - 1].forEach((pad) => {
    const cx = ((pad.x0 + pad.x1) / 2 - cam.x) * ZOOM,
      sy = (pad.y - cam.y) * ZOOM + 6,
      on = active && active.id === pad.id;
    if (cx < 20 || cx > 460 || sy < 44 || sy > 290) return;
    text(ctx, env.t('RELAY', '接力'), cx, sy, on ? '#ffe9ab' : '#f0b36a', 14, 'center');
  });
}
function drawGoal(ctx, g, cam, time) {
  const x = Math.round(g.x - cam.x),
    y = Math.round(g.y - cam.y);
  ctx.fillStyle = '#8b97a3';
  ctx.fillRect(x + 7, y, 2, g.h);
  const wave = Math.round(Math.sin(time * 5) * 2);
  ctx.fillStyle = '#6fe0b8';
  ctx.fillRect(x + 9, y + 1, 12, 8);
  ctx.fillRect(x + 21, y + 2 + wave, 3, 6);
  ctx.fillStyle = '#e9fff5';
  ctx.fillRect(x + 11, y + 3, 4, 2);
  ctx.fillStyle = 'rgba(111,224,184,0.25)';
  ctx.fillRect(x - 2, y - 4, 24, 4);
}
function drawRunner(ctx, s, cam) {
  const p = s.player,
    mode = movementMode(s),
    frame = Math.floor(s.time * 10) % 2;
  let rows = RUNNER.idle;
  if (mode === 'run' || mode === 'cling') rows = RUNNER.wall;
  else if (!p.ground) rows = s.event === 'kick' || p.kickCooldown > 0.05 ? RUNNER.kick : RUNNER.air;
  else if (Math.abs(p.vx) > 20) rows = frame ? RUNNER.run1 : RUNNER.run2;
  const face = mode === 'run' || mode === 'cling' ? p.wall : p.facing;
  const x = Math.round(p.x - cam.x - 2),
    y = Math.round(p.y - cam.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 18, 10, 2);
  const shown = face < 0 ? flipRows(rows) : rows;
  [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].forEach(([dx, dy]) => pixelSprite(ctx, shown, x + dx, y + dy + 2, 2, RUNNER_OUTLINE));
  pixelSprite(ctx, shown, x, y + 2, 2, RUNNER_COLORS);
  if (mode === 'run') {
    ctx.fillStyle = '#cfe8f5';
    ctx.fillRect(Math.round(p.x - cam.x + (p.wall > 0 ? 10 : -2)), y + 18 + (frame ? 2 : 0), 2, 3);
  }
}
function drawTrail(ctx, s, cam) {
  s.trail.forEach((t) => {
    ctx.fillStyle = t.life > 0.6 ? '#e8f6ff' : t.life > 0.3 ? '#a6cde0' : '#6a92aa';
    const x = Math.round(t.x - cam.x),
      y = Math.round(t.y - cam.y);
    if (t.wall) {
      ctx.fillRect(x - 1, y - 2, 3, 4);
      ctx.fillRect(x + (t.wall > 0 ? 2 : -3), y - 1, 1, 2);
    } else {
      ctx.fillRect(x - 2, y - 2, 4, 2);
      ctx.fillRect(x - 1, y, 2, 1);
    }
  });
}
function drawHud(ctx, s, env) {
  const c = COURSES[s.course - 1];
  ctx.fillStyle = 'rgba(8,13,22,0.82)';
  ctx.fillRect(0, 0, 480, 40);
  text(ctx, `${s.course}/${LEVEL_COUNT} ${env.t(c.name.en, c.name.zh)}`, 8, 3, '#d8ecf2', 14);
  text(
    ctx,
    `${env.t('LIVES', '生命')} ${'♥'.repeat(Math.max(0, s.lives))}`,
    472,
    3,
    '#ff9a8a',
    14,
    'right',
  );
  const low = s.energy < 25;
  text(ctx, env.t('ENERGY', '能量'), 8, 21, low ? '#ff8a7a' : '#ffe08a', 14);
  const bx = env.t(80, 56);
  ctx.fillStyle = '#1a2431';
  ctx.fillRect(bx, 23, 204, 12);
  ctx.fillStyle = low ? '#e0584a' : '#f4c24a';
  ctx.fillRect(bx + 2, 25, Math.round((s.energy / LIMITS.maxEnergy) * 200), 8);
  ctx.fillStyle = '#fff6d0';
  for (let k = 1; k < 4; k++) ctx.fillRect(bx + 2 + k * 50, 25, 1, 8);
  text(ctx, String(Math.ceil(s.energy)), bx + 212, 21, low ? '#ff8a7a' : '#ffe08a', 14);
  text(
    ctx,
    `${env.t('PADS', '接力台')} ${s.padsSeen.length}/${PADS[s.course - 1].length}`,
    472,
    21,
    '#f0b36a',
    14,
    'right',
  );
}
export function drawRun(ctx, s, env) {
  const c = COURSES[s.course - 1],
    look = LOOKS[c.look],
    cam = s.camera,
    pad = padUnder(s);
  background(ctx, look.sky[0]);
  drawSky(ctx, s, look);
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  c.solids.forEach((o, i) => drawBuilding(ctx, o, i, look, cam));
  c.solids.forEach((o) => drawFaces(ctx, o, cam, s.time));
  drawPads(ctx, s, cam, pad);
  drawGoal(ctx, c.goal, cam, s.time);
  drawTrail(ctx, s, cam);
  drawRunner(ctx, s, cam);
  ctx.restore();
  drawPadLabels(ctx, s, pad, env);
  drawRain(ctx, s);
  if (s.flash > 0) {
    ctx.fillStyle = `rgba(255,120,100,${(s.flash * 0.5).toFixed(2)})`;
    ctx.fillRect(0, 0, 480, 320);
  }
  drawHud(ctx, s, env);
  if (s.banner > 0) {
    text(ctx, env.t('COURSE CLEAR!', '赛道完成！'), 241, BANNER_Y + 1, '#0b1018', 14, 'center');
    text(ctx, env.t('COURSE CLEAR!', '赛道完成！'), 240, BANNER_Y, '#6fe0b8', 14, 'center');
  }
  const msg = prompt(s);
  ctx.fillStyle = 'rgba(8,13,22,0.78)';
  ctx.fillRect(0, 296, 480, 24);
  text(ctx, env.t(msg.en, msg.zh), 240, 300, '#d8ecf2', 14, 'center');
}
