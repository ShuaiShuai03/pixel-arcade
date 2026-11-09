import { clamp, background, drawPixelText as text } from '../shared/utils.js';
import { PHYSICS, terrainAt, windAt, HOLD_SECONDS, PATH_AIM } from './glider-ridge-world.js';
import { glidePath, guidance, describe, prompt } from './glider-ridge-guidance.js';
import { COURSES } from './glider-ridge-levels.js';
const VIEW_Y = 150;
const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const label = (ctx, str, x, y, color = '#fff', size = 14, align = 'left') => {
  text(ctx, str, x + 1, y + 1, '#0b1020', size, align);
  text(ctx, str, x, y, color, size, align);
};
const hash = (n) => (Math.imul(n | 0, 2654435761) >>> 0) / 4294967296;
const skyline = (x, seed, amp) =>
  amp *
  (0.55 +
    0.3 * Math.sin(x * 0.011 + seed) +
    0.22 * Math.sin(x * 0.031 + seed * 2.3) +
    0.1 * Math.sin(x * 0.083 + seed * 5));
const view = (s) => ({ sx: (x) => x - s.camX, sy: (h) => VIEW_Y - (h - s.camH) });
const groundTop = (c, x) => terrainAt(c, clamp(x, c.xmin, c.xmax), 0);

function drawSky(ctx, s, c) {
  const [horizon, mid, top] = c.palette;
  const bands = [top, top, mid, mid, horizon, horizon];
  bands.forEach((color, i) => rect(ctx, color, 0, i * 54, 480, 54));
  rect(ctx, '#fff6d8', 380, 28, 18, 18);
  rect(ctx, '#ffe9a8', 376, 32, 26, 10);
  const layers = [
    { k: 0.08, base: 205, amp: 80, color: '#8da3c4', snow: true },
    { k: 0.2, base: 235, amp: 70, color: '#6f86ab', snow: true },
    { k: 0.4, base: 262, amp: 55, color: '#4e6a7d', snow: false },
  ];
  layers.forEach((layer, i) => {
    const shift = s.camX * layer.k - s.camH * layer.k * 0.3;
    for (let px = 0; px < 480; px += 2) {
      const top = layer.base - skyline(px + shift, i * 3.1, layer.amp);
      rect(ctx, layer.color, px, top, 2, 320 - top);
      if (layer.snow && top < layer.base - layer.amp * 0.55) rect(ctx, '#f4f7fb', px, top, 2, 3);
    }
  });
  for (let n = 0; n < 5; n++) {
    const cx = ((n * 173 - s.camX * 0.12) % 560) - 40;
    rect(ctx, '#ffffffcc', cx, 40 + n * 14, 44, 5);
    rect(ctx, '#ffffffcc', cx + 10, 36 + n * 14, 26, 5);
  }
}

function drawTerrain(ctx, s, c) {
  const { sx, sy } = view(s);
  for (let px = 0; px < 480; px += 2) {
    const x = s.camX + px,
      top = sy(groundTop(c, x)),
      outside = x < c.xmin || x > c.xmax,
      snowy = groundTop(c, x) > c.snow;
    if (top > 320) continue;
    const y = Math.max(top, 0);
    rect(ctx, outside ? '#3b3a46' : '#5d5148', px, y, 2, 320 - y);
    rect(ctx, snowy ? '#eef3f7' : '#4f7d3b', px, y, 2, 4);
    rect(ctx, snowy ? '#c8d6e4' : '#3d6630', px, y + 4, 2, 3);
    if ((Math.floor(x / 2) + Math.floor(top / 6)) % 9 === 0) rect(ctx, '#7b6c60', px, y + 12, 2, 3);
    if (Math.floor(x) % 14 === 0) rect(ctx, '#473e38', px, y + 22, 2, 5);
  }
  for (let x = Math.floor(s.camX / 9) * 9; x < s.camX + 490; x += 9) {
    const n = hash(x);
    const ground = groundTop(c, x);
    const inPad = x > c.zone.x0 - 20 && x < c.zone.x1 + 20;
    if (n > 0.45 || ground > c.snow - 25 || x < c.xmin || x > c.xmax || inPad) continue;
    const bx = sx(x),
      by = sy(ground),
      tall = 10 + Math.floor(n * 22);
    rect(ctx, '#4a3326', bx, by - 3, 2, 4);
    for (let row = 0; row < 3; row++) {
      const w = 12 - row * 3;
      rect(
        ctx,
        row % 2 ? '#2f5a34' : '#26492c',
        bx + 1 - w / 2,
        by - 4 - row * (tall / 3),
        w,
        tall / 3 + 1,
      );
    }
  }
}

function drawLiftAir(ctx, s, c, glider, env) {
  const { sx, sy } = view(s),
    pulse = (s.time * 24) % 24;
  for (const r of c.ridges) {
    const sink = r.w < 0;
    for (let x = r.x0; x <= r.x1; x += 30) {
      for (let k = 0; k < 4; k++) {
        const agl = (k * r.depth) / 4 + (sink ? 12 - pulse : pulse) * 1.5;
        const h = groundTop(c, x) + (((agl % r.depth) + r.depth) % r.depth),
          px = sx(x),
          py = sy(h);
        if (px < -10 || px > 490) continue;
        const arrow = sink ? '#8a63b8' : '#7fe8ee',
          dir = sink ? 1 : -1;
        rect(ctx, arrow, px, py, 2, 8);
        rect(ctx, arrow, px - 3, py + (sink ? 5 : 0), 8, 2);
        rect(ctx, arrow, px - 1, py + dir * 0 + (sink ? 7 : -1), 4, 2);
      }
    }
    const mid = sx((r.x0 + r.x1) / 2);
    if (sink && mid > 30 && mid < 450) {
      const y = clamp(sy(groundTop(c, (r.x0 + r.x1) / 2) + r.depth) - 18, 100, 240);
      label(ctx, env.t('SINK', '下沉'), mid, y, '#c9a8f0', 14, 'center');
    }
  }
  for (const t of c.thermals) {
    const near = clamp(1 - Math.abs(glider.z - t.z) / (t.rz * 3), 0.25, 1),
      alpha = Math.round(near * 200)
        .toString(16)
        .padStart(2, '0');
    for (let k = -2; k <= 2; k++) {
      const x = t.x + (k * t.rx) / 2.6;
      for (let h = groundTop(c, x) + 6; h < t.top; h += 7) {
        const wiggle = Math.sin(h * 0.09 + s.time * 3 + k) * 5,
          py = sy(h + ((s.time * 40) % 7));
        if (py < -8 || py > 328) continue;
        rect(ctx, (k % 2 ? '#ffb347' : '#ffd96b') + alpha, sx(x) + wiggle, py, 3, 5);
      }
    }
    const top = sy(t.top);
    rect(ctx, '#fffaf0', sx(t.x) - 24, top - 8, 48, 8);
    rect(ctx, '#ffffff', sx(t.x) - 14, top - 14, 28, 8);
    rect(ctx, '#dfe8f3', sx(t.x) - 24, top - 2, 48, 3);
  }
}

function drawSocks(ctx, s, c) {
  const { sx, sy } = view(s);
  for (const x of c.socks) {
    const w = windAt(c, x, 0, groundTop(c, x) + 20),
      speed = Math.hypot(w.x, w.z),
      by = sy(groundTop(c, x)),
      px = sx(x);
    if (px < -50 || px > 530) continue;
    rect(ctx, '#d8d8d8', px, by - 30, 2, 30);
    const flow = Math.abs(w.x) >= Math.abs(w.z) ? Math.sign(w.x || -1) : 0,
      len = clamp(Math.round(speed * 2.2), 6, 26),
      droop = Math.round((1 - clamp(speed / 9, 0, 1)) * 8);
    for (let i = 0; i < 4; i++) {
      const seg = (len / 4) * i,
        flutter = Math.round(Math.sin(s.time * 8 + i) * (speed > 2 ? 1 : 0));
      const gx =
        flow === 0
          ? px + 2 + seg * 0.4 * (w.z < 0 ? -1 : 1)
          : px + (flow > 0 ? 2 + seg : -seg - len / 4);
      const gy = by - 30 + flutter + (flow === 0 ? seg * 0.7 : (droop * i) / 3);
      rect(ctx, i % 2 ? '#f4f4f4' : '#e0482e', gx, gy, Math.ceil(len / 4), 5 - i * 0.5);
    }
  }
}

// Shape cues for gate state, so passed / next / waiting never depend on colour alone.
function drawTick(ctx, x, y) {
  [
    [0, 3],
    [1, 4],
    [2, 5],
    [3, 4],
    [4, 3],
    [5, 2],
    [6, 1],
    [7, 0],
  ].forEach(([dx, dy]) => rect(ctx, '#0b1020', x - 4 + dx, y + dy, 2, 2));
}
function drawPointer(ctx, x, y) {
  for (let i = 0; i < 5; i++) rect(ctx, '#ffe45e', x - 4 + i, y + i, 9 - 2 * i, 1);
}

function drawPadAndGates(ctx, s, c) {
  const { sx, sy } = view(s),
    z = c.zone,
    padTop = sy(groundTop(c, z.x0 + 2)),
    x0 = sx(z.x0),
    x1 = sx(z.x1);
  if (x1 > -20 && x0 < 500) {
    rect(ctx, '#e5cf62', x0, padTop - 2, x1 - x0, 4);
    for (let x = z.x0; x < z.x1; x += 16)
      rect(ctx, x % 32 ? '#d33a2f' : '#ffffff', sx(x), padTop - 1, 8, 2);
    const mid = sx((z.x0 + z.x1) / 2);
    rect(ctx, '#d33a2f', mid - 6, padTop - 4, 12, 2);
    rect(ctx, '#ffffff', mid - 3, padTop - 4, 6, 2);
    [x0, x1].forEach((fx) => {
      rect(ctx, '#f2f2f2', fx, padTop - 18, 2, 18);
      rect(ctx, '#ff5d3a', fx + 2, padTop - 18, 9, 6);
    });
  }
  c.gates.forEach((g, i) => {
    const px = sx(g.x),
      top = sy(g.h + g.hi),
      bottom = sy(g.h - g.lo),
      next = i === s.gate,
      color =
        i < s.gate
          ? '#5fd38a'
          : next
            ? Math.floor(s.time * 4) % 2
              ? '#ffe45e'
              : '#ffbf3b'
            : '#9aa7c2';
    if (px < -30 || px > 510) return;
    rect(ctx, color, px - 1, top, 3, bottom - top);
    rect(ctx, color, px - 9, top, 18, 3);
    rect(ctx, color, px - 9, bottom - 3, 18, 3);
    rect(ctx, '#2b3552', px - 1, bottom, 3, Math.max(0, sy(groundTop(c, g.x)) - bottom));
    for (let y = top + 4; y < bottom - 4; y += 6) rect(ctx, color + '88', px - 7, y, 14, 2);
    label(ctx, String(i + 1), px, top - 18, color, 14, 'center');
    if (i < s.gate) drawTick(ctx, px, top + 6);
    else if (next) drawPointer(ctx, px, top - 24);
    if (next && Math.abs(g.z) > 4)
      label(ctx, g.z > 0 ? '<' : '>', px, top + 2, '#ffffff', 14, 'center');
  });
}

function drawWing(ctx, s, p) {
  const face = Math.cos(s.heading) >= 0 ? 1 : -1,
    bank = Math.abs(Math.sin(s.bank)),
    thick = 3 + Math.round(bank * 8),
    flutter = s.stallWarn || s.stalled ? Math.round(Math.sin(s.time * 60) * 2) : 0;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y + flutter));
  ctx.rotate(-(s.pitch ?? s.alpha) * face);
  ctx.scale(face, 1);
  rect(ctx, '#2a2336', -15, -12 - thick / 2, 31, 2);
  for (let i = 0; i < 8; i++) {
    const color = ['#e8442b', '#ffffff', '#f5a623', '#ffffff'][i % 4];
    rect(ctx, color, -14 + i * 4, -11 - thick / 2, 4, thick);
  }
  rect(ctx, '#b3261e', 14, -11 - thick / 2, 3, thick);
  rect(ctx, '#2a2336', -2, -9, 1, 9);
  rect(ctx, '#2a2336', 2, -9, 1, 9);
  rect(ctx, '#f3d4a4', 1, -1, 5, 4);
  rect(ctx, '#d8d8d8', 0, -3, 6, 3);
  rect(ctx, '#2f6fb0', -1, 3, 5, 6);
  rect(ctx, '#222a3a', -1, 9, 3, 4);
  rect(ctx, '#222a3a', 3, 9, 3, 3);
  if (s.flare) rect(ctx, '#ffffff', -17, -12, 3, 2);
  ctx.restore();
}

function drawHud(ctx, s, g, c, env) {
  const t = env.t;
  rect(ctx, '#0b1020cc', 4, 4, 124, 70);
  const sign = g.verticalSpeed >= 0 ? '+' : '';
  const lines = [
    [t(`AIR ${Math.round(g.airspeed)}`, `空速 ${Math.round(g.airspeed)}`), '#fff'],
    [
      t(`VS ${sign}${g.verticalSpeed.toFixed(1)}`, `升降 ${sign}${g.verticalSpeed.toFixed(1)}`),
      g.verticalSpeed >= 0 ? '#7ff0a8' : '#ffb3a0',
    ],
    [
      t(`ALT ${Math.round(g.altitude)}`, `高度 ${Math.round(g.altitude)}`),
      g.agl < 25 ? '#ffd36b' : '#fff',
    ],
  ];
  lines.forEach(([str, color], i) => text(ctx, str, 10, 7 + i * 18, color, 16));
  const ratio = clamp(s.alpha / PHYSICS.criticalAlpha, 0, 1.2);
  rect(ctx, '#222a3a', 10, 63, 112, 6);
  rect(
    ctx,
    ratio > 1 || s.stalled ? '#e8442b' : ratio > 0.86 ? '#ffd36b' : '#5fd38a',
    10,
    63,
    Math.round((112 * ratio) / 1.2),
    6,
  );
  rect(ctx, '#ffffff', 10 + Math.round(112 / 1.2), 61, 1, 10);
  label(ctx, c.name[env.lang === 'zh' ? 'zh' : 'en'], 474, 6, '#fff', 14, 'right');
  label(
    ctx,
    t(
      `Gate ${Math.min(s.gate + 1, c.gates.length)}/${c.gates.length}`,
      `检查门 ${Math.min(s.gate + 1, c.gates.length)}/${c.gates.length}`,
    ),
    474,
    22,
    '#ffe45e',
    14,
    'right',
  );
  for (let i = 0; i < PHYSICS.attempts; i++) {
    rect(ctx, '#ff6b6b', 438 + i * 12, 40, 9, 9);
    if (i >= s.attempts) rect(ctx, '#0b1020', 440 + i * 12, 42, 5, 5);
  }
  label(ctx, t(`Score ${s.score}`, `得分 ${s.score}`), 474, 52, '#fff', 14, 'right');
}

function drawPlan(ctx, s, c) {
  const X = 340,
    Y = 252,
    W = 134,
    H = 64,
    range = 520,
    back = 90;
  rect(ctx, '#0b1020dd', X - 2, Y - 2, W + 4, H + 4);
  const px = (x) => X + ((x - (s.x - back)) / range) * W,
    pz = (z) => Y + H / 2 - (z / c.half) * (H / 2);
  rect(ctx, '#7c5a4a', X, Y, W, 2);
  rect(ctx, '#7c5a4a', X, Y + H - 2, W, 2);
  rect(ctx, '#2a3a52', X, Y + 2, W, H - 4);
  const zone = c.zone;
  rect(
    ctx,
    '#e5cf62',
    clamp(px(zone.x0), X, X + W),
    pz(zone.z + zone.hw),
    clamp(px(zone.x1), X, X + W) - clamp(px(zone.x0), X, X + W),
    (zone.hw / c.half) * H,
  );
  for (const t of c.thermals) {
    const cx = px(t.x);
    if (cx > X - 6 && cx < X + W + 6) {
      rect(ctx, '#ffb347', cx - 5, pz(t.z) - 4, 10, 8);
      rect(ctx, '#ffd96b', cx - 3, pz(t.z) - 6, 6, 12);
    }
  }
  c.gates.forEach((g, i) => {
    const gx = px(g.x);
    if (gx < X || gx > X + W) return;
    const color = i < s.gate ? '#5fd38a' : i === s.gate ? '#ffe45e' : '#9aa7c2',
      top = pz(g.z + g.hw),
      height = (g.hw / c.half) * H * 2;
    // Passed gates are dotted and the next gate is thick, so state is not colour alone.
    if (i < s.gate) for (let y = 0; y < height; y += 4) rect(ctx, color, gx, top + y, 2, 2);
    else rect(ctx, color, gx, top, i === s.gate ? 4 : 2, height);
  });
  const wz = (s.wind ?? windAt(c, s.x, s.z, s.h)).z,
    len = Math.round(clamp(Math.abs(wz) * 2, 0, 24));
  if (len > 2) {
    const base = Y + H / 2 + (wz > 0 ? len / 2 : -len / 2);
    rect(ctx, '#9fd8ff', X + 6, Math.min(base, base - Math.sign(wz) * len), 2, len);
    rect(ctx, '#9fd8ff', X + 3, wz > 0 ? base - len - 1 : base + len - 1, 8, 2);
  }
  const gx = px(s.x),
    gz = pz(s.z);
  rect(ctx, '#ffffff', gx - 2, gz - 2, 5, 5);
  rect(
    ctx,
    '#ff5d3a',
    gx + Math.round(Math.cos(s.heading) * 6) - 1,
    gz - Math.round(Math.sin(s.heading) * 6) - 1,
    3,
    3,
  );
}

function bannerFor(s, c, env) {
  const t = env.t;
  const zh = env.lang === 'zh',
    auto = Math.max(0, Math.ceil(HOLD_SECONDS - s.timer));
  if (s.phase === 'won')
    return [t('ALL RIDGES FLOWN', '全部山脊完成'), t(`Final score ${s.score}`, `总分 ${s.score}`)];
  if (s.phase === 'lost')
    return [t('OUT OF ATTEMPTS', '机会用完'), s.message ? s.message[zh ? 'zh' : 'en'] : ''];
  if (s.phase === 'landed')
    return [
      t('COURSE COMPLETE', '赛道完成'),
      t(`Space: next ridge (auto in ${auto} s)`, `空格：下一条山脊（${auto} 秒后自动）`),
    ];
  if (s.phase === 'crashed')
    return [
      s.message ? s.message[zh ? 'zh' : 'en'] : '',
      t(`Space: relaunch (auto in ${auto} s)`, `空格：重新起飞（${auto} 秒后自动）`),
    ];
  return null;
}

function edgeArrow(ctx, color, x, y, dir) {
  for (let i = 0; i < 7; i++) rect(ctx, color, dir > 0 ? x - i : x + i, y - i, 1, 2 * i + 1);
}

function drawGuidance(ctx, s, c, env) {
  const { sx, sy } = view(s),
    cues = guidance(s, c),
    t = env.t;
  for (const th of c.thermals) {
    const px = sx(th.x),
      half = Math.round(th.rx * 0.45),
      chosen = cues.lift && cues.lift.x === th.x,
      color = chosen ? '#fff27a' : '#ffd36bcc';
    if (px < -th.rx || px > 480 + th.rx) continue;
    for (let h = terrainAt(c, th.x, 0) + 4; h < th.top; h += 10) {
      const y = sy(h);
      if (y < 0 || y > 320) continue;
      rect(ctx, color, px - half, y, 3, 6);
      rect(ctx, color, px + half, y, 3, 6);
    }
    const labelY = clamp(sy(Math.min(th.top - 15, s.camH + 95)), 100, 220);
    if (px > 30 && px < 450)
      label(ctx, t('LIFT', '升力'), px, labelY, chosen ? '#fff27a' : '#ffd36b', 14, 'center');
  }
  if (cues.lift && cues.cue === 'low') {
    const px = sx(cues.lift.x);
    if (px > 478) {
      edgeArrow(ctx, '#fff27a', 474, 120, 1);
      label(
        ctx,
        t(`LIFT ${Math.round(cues.lift.dx)}`, `升力 ${Math.round(cues.lift.dx)}`),
        464,
        112,
        '#fff27a',
        14,
        'right',
      );
    } else if (px < 2) {
      edgeArrow(ctx, '#fff27a', 6, 120, -1);
      label(ctx, t('LIFT behind', '升力在后'), 14, 112, '#fff27a', 14, 'left');
    }
  }
  if (cues.kind === 'gate' && cues.cue === 'low') {
    const y = clamp(sy(cues.need), 84, 292);
    for (let x = 140; x < 470; x += 12) rect(ctx, '#7fe8ee', x, y, 6, 2);
    label(ctx, t(`ALT ${cues.need}`, `高度 ${cues.need}`), 470, y - 17, '#7fe8ee', 14, 'right');
  }
  if (cues.kind === 'pad') {
    for (let x = c.zone.x0 - 700; x < c.zone.x0 + PATH_AIM; x += 14) {
      const px = sx(x);
      if (px > -4 && px < 484) rect(ctx, '#7fe8ee', px, sy(glidePath(c, x)), 7, 2);
    }
  }
  const gx = sx(cues.x);
  if (cues.kind === 'gate' && (gx > 478 || gx < 2)) {
    const y = clamp(sy(cues.window.low + (cues.window.high - cues.window.low) / 2), 150, 232),
      ahead = gx > 0;
    edgeArrow(ctx, '#ffe45e', ahead ? 474 : 6, y, ahead ? 1 : -1);
    label(
      ctx,
      `${s.gate + 1}: ${Math.round(Math.abs(cues.distance))}`,
      ahead ? 464 : 14,
      y - 8,
      '#ffe45e',
      14,
      ahead ? 'right' : 'left',
    );
  }
}

export function drawGlider(ctx, s, env) {
  const c = COURSES[s.course],
    g = describe(s).glider,
    { sx, sy } = view(s),
    zh = env.lang === 'zh';
  background(ctx, '#101b2d');
  drawSky(ctx, s, c);
  drawTerrain(ctx, s, c);
  drawLiftAir(ctx, s, c, g, env);
  drawSocks(ctx, s, c);
  drawPadAndGates(ctx, s, c);
  drawGuidance(ctx, s, c, env);
  drawWing(ctx, s, { x: sx(s.x), y: sy(s.h) });
  drawHud(ctx, s, g, c, env);
  drawPlan(ctx, s, c);
  if (g.stalled || g.stallWarning) {
    if (Math.floor(s.time * 6) % 2 === 0)
      label(ctx, env.t('STALL!', '失速！'), 240, 36, '#ff6b5a', 16, 'center');
  }
  if (s.phase === 'playing') {
    const intro = s.time < 6 && !g.stalled && !g.stallWarning;
    label(ctx, intro ? c.brief[zh ? 'zh' : 'en'] : prompt(s, g, c, env), 8, 298, '#ffffff', 14);
    if (s.message) label(ctx, s.message[zh ? 'zh' : 'en'], 240, 80, '#ffffff', 16, 'center');
  } else {
    const banner = bannerFor(s, c, env);
    rect(ctx, '#0b1020dd', 60, 176, 360, 70);
    label(ctx, banner[0], 240, 184, '#ffe45e', 16, 'center');
    label(ctx, banner[1], 240, 208, '#ffffff', 14, 'center');
    if (s.landing && s.landing.kind)
      label(
        ctx,
        env.t(
          `Sink ${s.landing.sink.toFixed(1)} m/s  Speed ${Math.round(s.landing.speed)}`,
          `下沉 ${s.landing.sink.toFixed(1)}  速度 ${Math.round(s.landing.speed)}`,
        ),
        240,
        228,
        '#9fd8ff',
        14,
        'center',
      );
  }
}
