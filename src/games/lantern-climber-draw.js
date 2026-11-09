import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { SECTIONS, stepHint } from './lantern-climber-layout.js';
export function revealed(s, l) {
  const x = s.player.x + s.player.w / 2,
    y = s.player.y + 10;
  return (
    l.lit ||
    Math.hypot(x - clamp(x, l.x, l.x + l.w), y - clamp(y, l.y, l.y + l.h)) <= 60 + s.light * 0.7
  );
}
export function drawClimb(ctx, s, env, view) {
  const section = SECTIONS[s.level - 1],
    p = s.player;
  background(ctx, section.sky);
  for (let n = 0; n < 48; n++) {
    ctx.fillStyle = n % 4 ? '#3c536a' : '#94a9ae';
    ctx.fillRect((n * 73) % 480, 48 + ((n * 41) % 270), 1, 1);
  }
  for (let y = -40; y < 350; y += 28) {
    const py = y - (s.camera % 28);
    ctx.fillStyle = '#303754';
    ctx.fillRect(16, py, 16, 28);
    ctx.fillRect(448, py, 16, 28);
    ctx.fillStyle = '#68718a';
    ctx.fillRect(18, py + 1, 13, 2);
    ctx.fillRect(450, py + 1, 13, 2);
    ctx.fillStyle = '#202a47';
    ctx.fillRect(16, py + 25, 16, 3);
    ctx.fillRect(448, py + 25, 16, 3);
  }
  for (let n = 0; n < 8; n++) {
    const x = 48 + n * 55,
      y = ((n * 137 - s.camera * 0.3) % 390) - 50;
    ctx.fillStyle = '#293250';
    ctx.fillRect(x, y, 25, 67);
    ctx.fillStyle = '#202944';
    ctx.fillRect(x + 5, y + 4, 15, 48);
    ctx.fillStyle = '#414865';
    ctx.fillRect(x + 3, y - 3, 19, 3);
    ctx.fillRect(x + 7, y - 6, 11, 3);
    ctx.fillRect(x, y + 3, 3, 59);
    ctx.fillRect(x + 22, y + 3, 3, 59);
    ctx.fillStyle = '#303b58';
    ctx.fillRect(x + 4, y + 17, 17, 2);
    ctx.fillRect(x + 11, y + 2, 2, 48);
  }
  for (let n = 0; n < 5; n++) {
    const bx = n % 2 ? 407 : 55,
      by = ((n * 173 - s.camera * 0.6) % 520) - 90;
    ctx.fillStyle = '#5a4962';
    ctx.fillRect(bx, by, 12, 36);
    ctx.fillStyle = '#75627b';
    ctx.fillRect(bx + 2, by + 3, 2, 26);
    ctx.fillStyle = section.sky;
    ctx.fillRect(bx + 1, by + 31, 3, 5);
    ctx.fillRect(bx + 8, by + 34, 3, 4);
    ctx.fillStyle = '#737b68';
    ctx.fillRect(bx - 4, by + 5, 2, 25);
    ctx.fillRect(bx - 8, by + 12, 5, 2);
    ctx.fillRect(bx - 3, by + 23, 5, 2);
  }
  if (s.respawn === 0) {
    const cx = s.player.x + s.player.w / 2,
      cy = s.player.y - s.camera + 10,
      radius = 60 + s.light * 0.7;
    for (const [scale, color] of [
      [1, '#edc48109'],
      [0.76, '#edc4810b'],
      [0.5, '#f0c7810e'],
      [0.24, '#f4d39116'],
    ]) {
      const r = Math.round(radius * scale),
        a = Math.round(r * 0.45),
        b = Math.round(r * 0.75);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy - r);
      ctx.lineTo(cx + a, cy - r);
      ctx.lineTo(cx + a, cy - b);
      ctx.lineTo(cx + b, cy - b);
      ctx.lineTo(cx + b, cy - a);
      ctx.lineTo(cx + r, cy - a);
      ctx.lineTo(cx + r, cy + a);
      ctx.lineTo(cx + b, cy + a);
      ctx.lineTo(cx + b, cy + b);
      ctx.lineTo(cx + a, cy + b);
      ctx.lineTo(cx + a, cy + r);
      ctx.lineTo(cx - a, cy + r);
      ctx.lineTo(cx - a, cy + b);
      ctx.lineTo(cx - b, cy + b);
      ctx.lineTo(cx - b, cy + a);
      ctx.lineTo(cx - r, cy + a);
      ctx.lineTo(cx - r, cy - a);
      ctx.lineTo(cx - b, cy - a);
      ctx.lineTo(cx - b, cy - b);
      ctx.lineTo(cx - a, cy - b);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const r of s.rails) {
    const y = r.y - s.camera;
    ctx.fillStyle = '#827a78';
    ctx.fillRect(r.x - 2, y, 4, r.h);
    for (let h = 0; h < r.h; h += 15) {
      ctx.fillStyle = '#c3b897';
      ctx.fillRect(r.x - 10, y + h, 20, 3);
      ctx.fillStyle = '#5a566a';
      ctx.fillRect(r.x - 8, y + h + 3, 2, 3);
      ctx.fillRect(r.x + 6, y + h + 3, 2, 3);
    }
    text(ctx, '↕', r.x, y - 14, '#d5d6a4', 14, 'center');
  }
  const lamp = { x: p.x + p.w / 2, y: p.y + 10 };
  for (const l of s.ledges) {
    const y = l.y - s.camera;
    if (y < 40 || y > 326) continue;
    const visible = revealed(s, l);
    if (l.moving) {
      ctx.strokeStyle = '#526b76';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.home - 35, y - 12);
      ctx.lineTo(l.home + l.w + 35, y - 12);
      ctx.stroke();
      ctx.fillStyle = '#6f8f91';
      ctx.fillRect(l.x + 5, y - 12, 2, 12);
      ctx.fillRect(l.x + l.w - 7, y - 12, 2, 12);
    }
    ctx.fillStyle = visible ? section.stone : '#373e5d';
    ctx.fillRect(l.x, y, l.w, l.h);
    ctx.fillStyle = visible ? '#b0bbb0' : '#526571';
    ctx.fillRect(l.x, y, l.w, 2);
    ctx.fillStyle = '#41475f';
    ctx.fillRect(l.x + 3, y + 5, l.w - 6, 3);
    for (let x = l.x + 13; x < l.x + l.w; x += 22) {
      ctx.fillStyle = '#4b526c';
      ctx.fillRect(x, y + 3, 2, 4);
    }
    ctx.fillStyle = '#77816c';
    for (let n = 0; n < 5; n++) ctx.fillRect(l.x + 7 + n * 17, y + 2, 5, 2);
    const bx = l.x + l.w / 2;
    if (l.shrine) {
      ctx.fillStyle = '#7d7c70';
      ctx.fillRect(bx - 7, y - 13, 14, 13);
      ctx.fillStyle = '#c4b681';
      ctx.fillRect(bx - 9, y - 14, 18, 3);
      ctx.fillStyle = '#b8cc9c';
      ctx.fillRect(l.x + 3, y - 4, 4, 4);
      if (visible) text(ctx, 'X', bx, y - 30, '#e5d4a7', 12, 'center');
    } else {
      ctx.fillStyle = '#4c646e';
      ctx.fillRect(bx - 3, y - 10, 6, 10);
    }
    if (l.lit || l.shrine) {
      ctx.fillStyle = '#eabf7b';
      ctx.fillRect(bx - 3, y - 20, 6, 7);
      ctx.fillStyle = '#ffdf9b';
      ctx.fillRect(bx - 1, y - 22 - (Math.floor(s.time * 8) % 2), 2, 7);
    }
    if (l.beacon) {
      text(ctx, String(l.id / 6), l.x + l.w - 11, y - 16, '#d8d4b1', 12, 'center');
    }
  }
  if (s.respawn === 0) {
    const py = p.y - s.camera,
      grip = p.grip !== null,
      rows = grip
        ? [
            '..hhhhh',
            '..hsssh',
            '..ss.ss',
            'a.ccc.a',
            'a.ccc.a',
            '..ccc..',
            '..ccc..',
            '..bbb..',
            '..b.b..',
            '..b.b..',
            'kk...kk',
          ]
        : [
            '..hhh..',
            '.hhhhh.',
            '..sss..',
            '..s.s..',
            '..ccc..',
            '.accca.',
            '.acccl.',
            '..bbb..',
            '..b.b..',
            '.kb.bk.',
            'kk...kk',
          ];
    ctx.fillStyle = '#102a3b88';
    ctx.fillRect(p.x - 2, py + p.h - 2, p.w + 4, 3);
    pixelSprite(ctx, rows, Math.round(p.x), Math.round(py), 2, {
      h: '#c0a275',
      s: '#edd3ab',
      a: '#e0c69c',
      c: grip ? '#c3baa2' : '#8399ba',
      b: '#596982',
      k: '#223b4a',
      l: '#efd392',
    });
    ctx.fillStyle = '#e4c882';
    ctx.fillRect(p.x + p.w, py + 10, 4, 7);
    ctx.fillStyle = '#ffdfa0';
    ctx.fillRect(p.x + p.w + 1, py + 11, 2, 4);
    if (grip) {
      ctx.strokeStyle = '#d8deb1';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 2, py - 2, p.w + 4, p.h + 4);
    }
  }
  ctx.fillStyle = '#18223b';
  ctx.fillRect(0, 0, 480, 43);
  text(ctx, `${s.level}/3 ${env.t(section.en, section.zh)}`, 10, 5, '#d7d7b1', 14);
  text(ctx, `${env.t('LIVES', '生命')} ${s.lives}`, 470, 5, '#d6dfc5', 14, 'right');
  for (const [x, value, label, color] of [
    [10, s.stamina, env.t('GRIP', '体力'), '#b7c1d1'],
    [246, s.light, env.t('LAMP', '灯油'), s.light < 20 ? '#edb084' : '#d8c18d'],
  ]) {
    text(ctx, `${label} ${Math.ceil(value)}`, x, 24, color, 14);
    ctx.fillStyle = '#355261';
    ctx.fillRect(x + 92, 28, 112, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x + 92, 28, (112 * value) / 100, 5);
  }
  const tip = stepHint(s);
  ctx.fillStyle = '#18223bc8';
  ctx.fillRect(0, 43, 480, 16);
  text(ctx, env.t(tip.en, tip.zh), 240, 45, '#e5d4a7', 12, 'center');
  ctx.fillStyle = '#18223bf0';
  ctx.fillRect(0, 300, 480, 20);
  const status =
    s.respawn > 0
      ? env.t('RECOVERING AT THE LAST BRAZIER', '返回上一座火盆')
      : p.grip !== null
        ? env.t('GRIP · ↑/↓ CLIMB · SPACE JUMP', '抓握中 · 上下攀爬 · SPACE蹬跳')
        : s.light < 20
          ? env.t('LOW LAMP · X AT A BRAZIER', '灯油不足 · 火盆旁按X补油')
          : view.ledge?.shrine && view.rest
            ? env.t('RESTING · X REFILLS THE LAMP', '休息中 · X补充灯油')
            : env.t('SPACE JUMP · HOLD Z AT RAILS', 'SPACE跳跃 · 扶轨旁按住Z抓握');
  text(ctx, status, 240, 303, '#d2d4bf', 14, 'center');
}
