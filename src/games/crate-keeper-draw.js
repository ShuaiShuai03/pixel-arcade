// Crate Keeper drawing: the warehouse board, crates, worker and heads-up display.
import { background, drawPixelText as text, clamp, pixelSprite } from '../shared/utils.js';
import { DIRECTIONS, adjacent, cellPoint } from './crate-keeper-solver.js';
import { LEVEL_COUNT, TITLES, LESSONS } from './crate-keeper-levels.js';

const TONES = [
  ['#293e46', '#65767d', '#b7a077'],
  ['#293d49', '#607282', '#93b1b2'],
  ['#353e49', '#737a82', '#c6aa81'],
];
const ARROWS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
const WORKER = [
  '..YYYY..',
  'YYYYYYYY',
  '.SSSSSS.',
  '.SKSSKS.',
  '..SSSS..',
  '.BBBBBB.',
  'BBYBBYBB',
  '.BBBBBB.',
  '..KKKK..',
  '.KK..KK.',
];

export function crateLayout(w, h) {
  const size = Math.min(46, Math.floor(420 / w), Math.floor(242 / h));
  return { size, ox: Math.floor((480 - w * size) / 2), oy: 42 + Math.floor((242 - h * size) / 2) };
}

function drawBackdrop(ctx) {
  background(ctx, '#172c36');
  for (let n = 0; n < 14; n++) {
    const x = n * 37;
    ctx.fillStyle = n % 2 ? '#203640' : '#223b44';
    ctx.fillRect(x, 40, 2, 246);
    ctx.fillStyle = '#334b51';
    ctx.fillRect(x + 7, 49, 19, 2);
    ctx.fillRect(x + 7, 274, 19, 2);
  }
  for (const x of [20, 450]) {
    ctx.fillStyle = '#354b50';
    ctx.fillRect(x, 62, 10, 188);
    ctx.fillStyle = '#65736e';
    ctx.fillRect(x + 2, 64, 2, 182);
    for (let y = 83; y < 246; y += 31) {
      ctx.fillStyle = '#afa87b';
      ctx.fillRect(x + 3, y, 5, 3);
    }
  }
}

function drawWall(ctx, tones, x, y, px, py, size) {
  ctx.fillStyle = '#374c59';
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = tones[1];
  ctx.fillRect(px + 1, py + 1, size - 2, size - 4);
  ctx.fillStyle = '#879394';
  ctx.fillRect(px + 2, py + 2, size - 4, 2);
  ctx.fillStyle = '#293f4c';
  ctx.fillRect(px + 1, py + size - 5, size - 2, 4);
  ctx.fillRect(px + size - 3, py + 3, 2, size - 7);
  ctx.fillStyle = '#4a5e68';
  ctx.fillRect(px + (x % 2 ? size * 0.35 : size * 0.65), py + 5, 1, size - 12);
  ctx.fillRect(px + 3, py + Math.floor(size * 0.58), size - 6, 1);
  if ((x + y) % 3 === 0) {
    ctx.fillStyle = tones[2];
    ctx.fillRect(px + 4, py + size - 9, 3, 2);
    ctx.fillRect(px + 10, py + size - 9, 3, 2);
  }
}

function drawFloor(ctx, tones, x, y, px, py, size, isGoal) {
  ctx.fillStyle = (x + y) % 2 ? tones[0] : '#2f454e';
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = '#3c535b';
  ctx.fillRect(px + 1, py + 1, size - 2, 1);
  ctx.fillStyle = '#20343f';
  ctx.fillRect(px + size - 1, py, 1, size);
  ctx.fillRect(px, py + size - 1, size, 1);
  ctx.fillStyle = '#4b5e60';
  ctx.fillRect(px + 6, py + 7, 3, 1);
  if ((x + y) % 3 === 0) ctx.fillRect(px + size - 10, py + size - 8, 5, 1);
  if (!isGoal) return;
  ctx.strokeStyle = '#c9b56e';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 4, py + 4, size - 8, size - 8);
  ctx.fillStyle = '#d7c58a';
  ctx.fillRect(px + size / 2 - 2, py + 8, 4, size - 16);
  ctx.fillRect(px + 8, py + size / 2 - 2, size - 16, 4);
  ctx.fillStyle = '#233a42';
  ctx.fillRect(px + size / 2 - 3, py + size / 2 - 3, 6, 6);
}

function drawBoard(ctx, s, { size, ox, oy }) {
  const { state } = s,
    tones = TONES[Math.floor((s.level - 1) / 7) % TONES.length];
  ctx.fillStyle = '#101f29';
  ctx.fillRect(ox - 4, oy - 4, state.w * size + 8, state.h * size + 8);
  for (let y = 0; y < state.h; y++)
    for (let x = 0; x < state.w; x++) {
      const i = y * state.w + x,
        px = ox + x * size,
        py = oy + y * size;
      if (state.walls.includes(i)) drawWall(ctx, tones, x, y, px, py, size);
      else drawFloor(ctx, tones, x, y, px, py, size, state.goals.includes(i));
    }
}

function drawHint(ctx, s, { size, ox, oy }) {
  if (!s.hint?.code) return;
  const { state } = s,
    [, dx, dy] = DIRECTIONS.find((d) => d[0] === s.hint.code),
    n = adjacent(state, state.player, dx, dy);
  if (n < 0) return;
  const px = ox + (n % state.w) * size,
    py = oy + Math.floor(n / state.w) * size;
  ctx.strokeStyle = '#e6e1b5';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 2, py + 2, size - 4, size - 4);
  text(ctx, ARROWS[s.hint.code], px + size - 8, py + 3, '#eee4b6', 12, 'center');
}

function drawCrate(ctx, s, crate, { size, ox, oy }) {
  const { state } = s,
    pos = s.visual.crate?.to === crate ? s.visual.crate.at : cellPoint(state, crate),
    px = ox + pos.x * size,
    py = oy + pos.y * size,
    moving = s.motion?.crate?.toIndex === crate,
    done = state.goals.includes(crate) && !moving,
    margin = Math.max(4, Math.floor(size * 0.13)),
    w = size - margin * 2;
  ctx.fillStyle = '#152b35aa';
  ctx.fillRect(px + margin + 1, py + size - margin - 1, w, 3);
  ctx.fillStyle = done ? '#335e4f' : '#634d3b';
  ctx.fillRect(px + margin, py + margin, w, w);
  ctx.fillStyle = done ? '#739b6d' : '#b28b59';
  ctx.fillRect(px + margin + 2, py + margin + 2, w - 4, w - 4);
  ctx.fillStyle = done ? '#a2bf89' : '#dbc18a';
  ctx.fillRect(px + margin + 2, py + margin + 2, w - 4, 3);
  ctx.fillStyle = done ? '#4a7659' : '#8a6847';
  ctx.fillRect(px + size / 2 - 1, py + margin + 6, 2, w - 9);
  ctx.fillRect(px + margin + 3, py + size / 2, w - 6, 2);
  ctx.strokeStyle = done ? '#c7daa1' : '#6e533a';
  ctx.lineWidth = Math.max(2, Math.floor(size / 15));
  ctx.beginPath();
  if (done) {
    ctx.moveTo(px + size * 0.3, py + size * 0.51);
    ctx.lineTo(px + size * 0.45, py + size * 0.67);
    ctx.lineTo(px + size * 0.73, py + size * 0.35);
  } else {
    ctx.moveTo(px + margin + 5, py + margin + 5);
    ctx.lineTo(px + size - margin - 5, py + size - margin - 5);
    ctx.moveTo(px + size - margin - 5, py + margin + 5);
    ctx.lineTo(px + margin + 5, py + size - margin - 5);
  }
  ctx.stroke();
  ctx.fillStyle = done ? '#c7d89e' : '#e1c697';
  for (const [dx, dy] of [
    [margin + 3, margin + 4],
    [size - margin - 5, margin + 4],
    [margin + 3, size - margin - 6],
    [size - margin - 5, size - margin - 6],
  ])
    ctx.fillRect(px + dx, py + dy, 2, 2);
  if (!s.trapped.includes(crate)) return;
  ctx.strokeStyle = '#ebbaa0';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + margin - 2, py + margin - 2, w + 4, w + 4);
  text(ctx, '!', px + size / 2, py + size / 2 - 6, '#fff0bc', 14, 'center');
}

function drawWorker(ctx, s, { size, ox, oy }) {
  const scale = size >= 40 ? 3 : 2,
    player = s.visual.player,
    walk = Boolean(s.motion),
    bob = walk ? Math.sin(clamp(s.motion.elapsed / s.motion.duration, 0, 1) * Math.PI) : 0,
    px = ox + player.x * size + (size - 8 * scale) / 2,
    py = oy + player.y * size + (size - 10 * scale) / 2 - bob,
    blink = !walk && Math.floor(s.time * 2) % 9 === 8,
    rows = WORKER.slice();
  ctx.fillStyle = '#142c38aa';
  ctx.beginPath();
  ctx.ellipse(
    ox + (player.x + 0.5) * size,
    oy + (player.y + 0.78) * size,
    size * 0.25,
    3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (blink) rows[3] = '.SKKKKS.';
  if (walk && Math.floor(s.motion.elapsed * 25) % 2) rows[9] = '.KK...K.';
  pixelSprite(ctx, rows, px, py, scale, {
    Y: '#e4c481',
    S: '#e5c6a4',
    K: '#163241',
    B: '#83b7be',
  });
  ctx.fillStyle = '#eff0c1';
  ctx.fillRect(px + 3 * scale, py + scale, 2 * scale, scale);
  ctx.fillStyle = '#e3cf98';
  const cx = ox + (player.x + 0.5) * size,
    cy = oy + (player.y + 0.5) * size;
  ctx.fillRect(cx + s.facing.dx * size * 0.29 - 1, cy + s.facing.dy * size * 0.31 - 1, 3, 3);
}

function drawFrame(ctx, s, { size, ox, oy }) {
  const { state } = s;
  if (s.feedback?.type === 'blocked' && s.feedback.life > 0) {
    ctx.strokeStyle = '#d8ac8c';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      ox + (state.player % state.w) * size + 2,
      oy + Math.floor(state.player / state.w) * size + 2,
      size - 4,
      size - 4,
    );
  }
  if (!s.solved) return;
  ctx.strokeStyle = '#b5d59a';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox - 3, oy - 3, state.w * size + 6, state.h * size + 6);
}

function footerMessage(s, env) {
  if (s.solved) return env.t('COMPLETE · ENTER / NEXT TO CONFIRM', '已完成 · 按回车或下一关确认');
  if (s.hint) return s.hint.text;
  if (s.trapped.length) return env.t('CRATE STUCK · Z UNDO / X RESET', '箱子卡死 · Z撤销 / X重置');
  return env.t('Z undo · H hint · X reset · M rooms', 'Z撤销 · H提示 · X重置 · M选关');
}

function drawHud(ctx, s, env) {
  const { state, level } = s,
    docked = state.crates.filter((c) => state.goals.includes(c)).length;
  ctx.fillStyle = '#142b35';
  ctx.fillRect(0, 0, 480, 39);
  ctx.fillRect(0, 287, 480, 33);
  text(ctx, `${env.t('ROOM', '仓库')} ${level}/${LEVEL_COUNT}`, 12, 7, '#b6c8c3', 12);
  text(ctx, env.t(...TITLES[level - 1]), 240, 6, '#e0d7b6', 14, 'center');
  text(
    ctx,
    `${docked}/${state.crates.length} ${env.t('DOCKED', '入位')}`,
    470,
    7,
    '#c3d2a7',
    12,
    'right',
  );
  text(ctx, env.t(...LESSONS[level - 1]), 240, 24, '#9eb6b8', 12, 'center');
  for (let n = 0; n < LEVEL_COUNT; n++) {
    ctx.fillStyle = n < level - 1 ? '#c8bc85' : n === level - 1 ? '#8fb4ab' : '#36545f';
    ctx.fillRect(12 + n * 23, 37, 20, 1);
  }
  text(ctx, `${env.t('MOVES', '步数')} ${s.moves}`, 12, 291, '#c9d6cc', 12);
  text(ctx, `${env.t('PUSHES', '推动')} ${s.pushes}`, 130, 291, '#c9d6cc', 12);
  text(
    ctx,
    `${env.t('PAR', '标准推数')} ${s.parPushes} = ${env.t('best pushes', '最少推数')}`,
    240,
    291,
    '#b5c2ad',
    12,
  );
  text(ctx, env.t('Z ↶ UNDO', 'Z ↶ 撤销'), 470, 291, '#cbbf98', 12, 'right');
  const color = s.solved ? '#cee1a8' : s.trapped.length ? '#ecc19f' : '#a7bfc0';
  text(ctx, footerMessage(s, env), 240, 306, color, 12, 'center');
}

export function drawWarehouse(ctx, s, env) {
  const layout = crateLayout(s.state.w, s.state.h);
  drawBackdrop(ctx);
  drawBoard(ctx, s, layout);
  drawHint(ctx, s, layout);
  for (const crate of s.state.crates) drawCrate(ctx, s, crate, layout);
  drawWorker(ctx, s, layout);
  drawFrame(ctx, s, layout);
  drawHud(ctx, s, env);
}
