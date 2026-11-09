// Clockwork rendering: backdrop, linkage rods, decks, gears, door, actor and heads-up bars.
import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './clockwork-bridge-levels.js';
import {
  DOOR_REACH,
  KEY_REACH,
  SPRITE_SCALE,
  bridgeAt,
  bridgePhase,
  centerOf,
  gap2,
  nearestGear,
} from './clockwork-bridge-step.js';

const BRASS = '#d9a441',
  BRASS_LIGHT = '#f6d27a',
  BRASS_DARK = '#7a5420',
  INK = '#150f0b';
const COAT_PALETTE = {
  o: '#150f0b',
  h: '#c8923a',
  H: '#f0c765',
  s: '#f0c2a0',
  g: '#9fe3ff',
  b: '#3b6ea5',
  B: '#27496f',
  k: '#7a4a24',
  w: '#d4dbe0',
};
const BODY_TOP = ['..ooo..', '.ohHho.', 'ohhhhho', 'oggsggo', '.ossso.', 'obbkbbo', 'owbbbwo'];
const LEGS = {
  stand: ['.oBoBo.', '.okoko.', '.oo.oo.'],
  runA: ['.oBoBo.', 'okoo.o.', 'ooo.oo.'],
  runB: ['.oBoBo.', '.o.ooko', '.oo.ooo'],
  jump: ['oBo.oBo', 'oko.oko', 'ooo.ooo'],
};
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
const SPRITES = Object.fromEntries(
  Object.entries(LEGS).flatMap(([name, legs]) => [
    [`${name}R`, [...BODY_TOP, ...legs]],
    [`${name}L`, mirror([...BODY_TOP, ...legs])],
  ]),
);
export const PLAYER_SPRITES = SPRITES;
const KEY_SPRITE = ['.yyy..', 'y...y.', 'y...y.', '.yyy..', '..y...', '..yy..'];
const HEART = ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'];

function fillRect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function drawGear(ctx, x, y, r, angle, body, light, teeth = 8) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = body;
  for (let i = 0; i < teeth; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / teeth);
    ctx.fillRect(-2, -r - 3, 4, 5);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.fillRect(-1, -r + 2, 2, r - 2);
  ctx.fillRect(-r + 2, -1, r - 2, 2);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, r / 4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackdrop(ctx, s) {
  const t = LEVELS[s.machine].theme;
  background(ctx, t.bg);
  for (let y = 0; y < 320; y += 16) {
    fillRect(ctx, t.brick, 0, y, 480, 1);
    for (let x = (y / 16) % 2 ? 0 : 16; x < 480; x += 32) fillRect(ctx, t.brick, x, y, 1, 16);
  }
  for (const [x, y, r, dir] of [
    [70, 150, 64, 1],
    [150, 120, 40, -1],
    [300, 130, 52, 1],
    [430, 80, 44, -1],
  ]) {
    drawGear(ctx, x, y, r, dir * s.time * 0.2 + x, t.gear, t.brick, 12);
  }
  for (let x = 0; x < 480; x += 12) {
    const flick = 4 + ((x * 7 + Math.floor(s.time * 8)) % 7);
    fillRect(ctx, '#2a0e08', x, 312 - flick, 12, 8 + flick);
    fillRect(ctx, t.glow, x + 2, 316 - (flick >> 1), 8, 4 + (flick >> 1));
  }
}

function drawSolid(ctx, o, theme) {
  if (o.style === 'wall') return;
  const crate = o.style === 'crate';
  fillRect(ctx, crate ? '#6a4a2a' : theme.wall, o.x, o.y, o.w, o.h);
  fillRect(ctx, crate ? '#a8783e' : '#9a8a78', o.x, o.y, o.w, 3);
  fillRect(ctx, INK, o.x, o.y + o.h - 1, o.w, 1);
  fillRect(ctx, 'rgba(0,0,0,0.25)', o.x + o.w - 3, o.y + 3, 3, Math.max(0, o.h - 3));
  for (let x = o.x + 6; x < o.x + o.w - 3; x += 16) {
    fillRect(ctx, BRASS, x, o.y + 6, 2, 2);
    if (o.h > 30) fillRect(ctx, BRASS_DARK, x, o.y + 22, 2, 2);
  }
  if (crate) {
    fillRect(ctx, INK, o.x + 2, o.y + 2, o.w - 4, 1);
    fillRect(ctx, INK, o.x + 2, o.y + o.h - 3, o.w - 4, 1);
  }
}

const bridgeLetter = (id) => String.fromCharCode(65 + id);

// Each gear-to-bridge link gets its own overhead lane so rods never overlap.
function linkLanes(s) {
  const links = [];
  for (const g of s.gears) for (const [id] of g.drives) links.push([g, s.bridges[id]]);
  return links.map(([g, b], n) => ({ g, b, lane: 28 + n * 8 }));
}

function drawRod(ctx, x, y, w, h, offset, horizontal) {
  fillRect(
    ctx,
    INK,
    x - (horizontal ? 0 : 1),
    y - (horizontal ? 1 : 0),
    w + (horizontal ? 0 : 2),
    h + (horizontal ? 2 : 0),
  );
  fillRect(ctx, BRASS_DARK, x, y, w, h);
  const len = horizontal ? w : h;
  for (let d = ((offset % 12) + 12) % 12; d < len; d += 12) {
    if (horizontal) fillRect(ctx, BRASS_LIGHT, x + d, y, 6, h);
    else fillRect(ctx, BRASS_LIGHT, x, y + d, w, 6);
  }
}

function drawLinkage(ctx, s) {
  for (const { g, b, lane } of linkLanes(s)) {
    const tx = Math.round(b.x + b.w / 2),
      move = b.p * 96 * (g.drives.find((d) => d[0] === b.id)[1] ? -1 : 1),
      x0 = Math.min(g.x, tx),
      x1 = Math.max(g.x, tx);
    drawRod(ctx, g.x - 1, lane, 3, g.y - lane, move, false);
    drawRod(ctx, x0, lane - 1, x1 - x0 + 1, 3, g.x < tx ? move : -move, true);
    drawRod(ctx, tx - 1, lane, 3, b.y - lane, 0, false);
    for (const [px, py] of [
      [g.x, lane],
      [tx, lane],
    ]) {
      fillRect(ctx, INK, px - 4, py - 4, 8, 8);
      fillRect(ctx, BRASS, px - 3, py - 3, 6, 6);
      fillRect(ctx, BRASS_LIGHT, px - 1, py - 1, 2, 2);
    }
    fillRect(ctx, INK, tx - 5, b.y - 3, 10, 3);
    fillRect(ctx, BRASS_LIGHT, tx - 4, b.y - 3, 8, 2);
  }
}

function drawBridge(ctx, s, b) {
  const moving = bridgePhase(b) === 'moving',
    x = Math.round(b.x),
    y = Math.round(b.y);
  const a = bridgeAt(b, 0),
    z = bridgeAt(b, 1);
  fillRect(
    ctx,
    'rgba(0,0,0,0.35)',
    Math.min(a.x, z.x),
    Math.min(a.y, z.y) + b.h - 2,
    Math.abs(z.x - a.x) + b.w,
    2,
  );
  if (b.kind === 'press') {
    const floor = s.solids.find(
      (o) => o.style !== 'wall' && x + b.w / 2 >= o.x && x + b.w / 2 <= o.x + o.w && o.y >= y,
    );
    if (floor && (b.p > 0.02 || moving)) {
      fillRect(ctx, 'rgba(220,40,40,0.35)', x, y + b.h, b.w, floor.y - y - b.h);
      for (let xx = x; xx < x + b.w; xx += 8) fillRect(ctx, '#ff4a3a', xx, floor.y - 2, 4, 2);
    }
  }
  fillRect(ctx, b.kind === 'press' ? '#8a8e96' : BRASS, x, y, b.w, b.h);
  fillRect(ctx, b.kind === 'press' ? '#c8ccd4' : BRASS_LIGHT, x, y, b.w, 2);
  for (let tx = 0; tx < b.w; tx += 4) fillRect(ctx, BRASS_DARK, x + tx, y + b.h - 4, 2, 4);
  for (let tx = 0; tx < b.w; tx += 8) {
    fillRect(ctx, moving || b.kind === 'press' ? '#f7d23a' : BRASS_DARK, x + tx, y + 2, 4, 2);
    fillRect(ctx, INK, x + tx + 4, y + 2, 4, 2);
  }
  const dirX = Math.sign(b.target - b.p) * Math.sign(b.b.x - b.a.x || 0),
    dirY = Math.sign(b.target - b.p) * Math.sign(b.b.y - b.a.y || 0);
  if (moving) {
    const cx = x + b.w / 2,
      cy = y + b.h / 2;
    fillRect(ctx, INK, cx - 3 + dirX * 2, cy - 1 + dirY * 2, 6, 2);
    fillRect(ctx, '#ffffff', cx - 1 + dirX * 4, cy - 1 + dirY * 4, 2, 2);
  }
  fillRect(ctx, INK, x + b.w / 2 - 6, y + b.h + 1, 12, 15);
  text(ctx, bridgeLetter(b.id), x + b.w / 2, y + b.h + 2, BRASS_LIGHT, 14, 'center');
  if (b.jam) {
    ctx.strokeStyle = Math.floor(s.time * 8) % 2 ? '#ff4a3a' : '#ffd24a';
    ctx.strokeRect(x - 1, y - 1, b.w + 2, b.h + 2);
  }
}

function drawGearsAndPads(ctx, s) {
  for (const pad of s.pads) {
    for (let xx = pad.x; xx < pad.x + pad.w; xx += 8) {
      fillRect(ctx, (xx - pad.x) % 16 ? INK : '#7be28a', xx, pad.y - 3, 4, 3);
    }
  }
  const near = nearestGear(s);
  for (const g of s.gears) {
    const b = s.bridges[g.drives[0][0]],
      sign = g.drives[0][1] ? -1 : 1;
    fillRect(ctx, BRASS_DARK, g.x - 2, g.y, 4, 14);
    drawGear(
      ctx,
      g.x,
      g.y,
      g.r,
      sign * b.p * 7 + g.state * 0.4 + s.gearSpin * 2,
      BRASS,
      BRASS_LIGHT,
      8,
    );
    fillRect(ctx, INK, g.x - 4, g.y - 4, 8, 8);
    fillRect(ctx, g.state ? '#7be28a' : '#e86a4a', g.x - 3, g.y - 3, 6, 6);
    // Shape cue besides colour: a lit gear shows a plus, an unlit one a single dot.
    if (g.state) {
      fillRect(ctx, '#ffffff', g.x - 1, g.y - 3, 2, 6);
      fillRect(ctx, '#ffffff', g.x - 3, g.y - 1, 6, 2);
    } else fillRect(ctx, INK, g.x - 1, g.y - 1, 2, 2);
    if (near === g) {
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(g.x - 13, g.y - 13, 26, 26);
    }
    fillRect(ctx, INK, g.x - g.drives.length * 4 - 2, g.y - 31, g.drives.length * 8 + 4, 15);
    text(
      ctx,
      g.drives.map(([id]) => bridgeLetter(id)).join(''),
      g.x,
      g.y - 30,
      BRASS_LIGHT,
      14,
      'center',
    );
  }
}

function drawKeyIcon(ctx, x, y) {
  pixelSprite(ctx, KEY_SPRITE, x, y, SPRITE_SCALE, { y: '#ffd24a' });
}

function drawDoor(ctx, s, env) {
  const d = s.door,
    open = !d.locked;
  fillRect(ctx, INK, d.x - 2, d.y - 2, d.w + 4, d.h + 2);
  fillRect(ctx, open ? '#7be28a' : '#5a3a22', d.x, d.y, d.w, d.h);
  if (open) {
    fillRect(ctx, '#d6ffd6', d.x + 4, d.y + 4, d.w - 8, d.h - 4);
    for (let n = 0; n < 4; n++)
      fillRect(
        ctx,
        '#ffffff',
        d.x + 3 + n * 4,
        d.y + 2 + ((n * 5 + Math.floor(s.time * 10)) % 9),
        2,
        2,
      );
  } else {
    fillRect(ctx, BRASS, d.x + d.w / 2 - 4, d.y + 9, 8, 7);
    fillRect(ctx, BRASS_LIGHT, d.x + d.w / 2 - 2, d.y + 5, 4, 5);
    fillRect(ctx, INK, d.x + d.w / 2 - 1, d.y + 11, 2, 3);
  }
  text(
    ctx,
    env.t('EXIT', '出口'),
    d.x + d.w / 2,
    d.y - 17,
    open ? '#7be28a' : '#d8c8a8',
    14,
    'center',
  );
}

function drawPlayer(ctx, s) {
  const p = s.player,
    side = p.facing < 0 ? 'L' : 'R';
  let frame = 'stand';
  if (!p.grounded) frame = 'jump';
  else if (Math.abs(p.vx) > 10) frame = Math.floor(s.time * 10) % 2 ? 'runA' : 'runB';
  pixelSprite(ctx, SPRITES[frame + side], p.x, p.y, SPRITE_SCALE, COAT_PALETTE);
  const carried = s.keys.find((k) => k.state === 'carried');
  if (carried) drawKeyIcon(ctx, p.x + 1, p.y - 14 - Math.round(Math.sin(s.time * 6)));
}

const TIP_SIZE = 12;
const TIP_HOLD = 4;
const STUCK_AFTER = 20;

function promptFor(s, env) {
  const tip = env.t(LEVELS[s.machine].tip.en, LEVELS[s.machine].tip.zh);
  if (s.message) return env.t(s.message.en, s.message.zh);
  if (s.time < TIP_HOLD) return tip;
  if (s.idle >= STUCK_AFTER) return env.t('Stuck? Press Q to rewind', '卡住了？按Q复位');
  const c = centerOf(s.player),
    carried = s.keys.find((k) => k.state === 'carried');
  if (carried && s.door.locked && gap2(c, centerOf(s.door)) <= DOOR_REACH)
    return env.t('Z: unlock the door', 'Z：打开门锁');
  if (nearestGear(s)) return env.t('X: turn the gear', 'X：转动齿轮');
  if (!carried && s.keys.some((k) => k.state === 'floor' && gap2(c, centerOf(k)) <= KEY_REACH))
    return env.t('Z: take the key', 'Z：拿起钥匙');
  return tip;
}

function drawHud(ctx, s, env) {
  const m = LEVELS[s.machine];
  fillRect(ctx, 'rgba(10,6,4,0.85)', 0, 0, 480, 20);
  text(ctx, `${s.level}/${LEVEL_COUNT} ${env.t(m.name.en, m.name.zh)}`, 6, 3, BRASS_LIGHT, 14);
  const carried = s.keys.find((k) => k.state === 'carried');
  if (carried) drawKeyIcon(ctx, 300, 4);
  else if (s.door.locked) text(ctx, env.t('no key', '无钥匙'), 270, 3, '#a89a88', 14);
  text(ctx, env.t('Q: rewind', 'Q：复位'), 322, 4, '#e8dcc4', 12);
  for (let n = 0; n < s.lives; n++) pixelSprite(ctx, HEART, 440 - n * 10, 7, 1, { r: '#ff5a5a' });
  fillRect(ctx, 'rgba(10,6,4,0.85)', 0, 298, 480, 22);
  const line = promptFor(s, env),
    isTip = line === env.t(m.tip.en, m.tip.zh);
  text(ctx, line, 240, 301, s.message ? '#ffe9a8' : '#ffffff', isTip ? TIP_SIZE : 14, 'center');
}

export function drawMachine(ctx, s, env) {
  const theme = LEVELS[s.machine].theme;
  drawBackdrop(ctx, s);
  drawLinkage(ctx, s);
  for (const o of s.solids) drawSolid(ctx, o, theme);
  drawGearsAndPads(ctx, s);
  drawDoor(ctx, s, env);
  for (const b of s.bridges) drawBridge(ctx, s, b);
  for (const k of s.keys) {
    if (k.state === 'floor')
      drawKeyIcon(ctx, k.x, k.y - Math.round((Math.sin(s.time * 4) + 1) / 2));
  }
  drawPlayer(ctx, s);
  for (const f of s.fx) {
    const col = { spark: '#ffd24a', steam: '#e8f0f4', dust: '#b8a890' }[f.kind];
    fillRect(ctx, col, f.x, f.y, 2, 2);
  }
  drawHud(ctx, s, env);
}
