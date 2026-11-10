import { background, pixelSprite } from '../shared/utils.js';
import { PLAY_BOTTOM, PLAY_TOP, deepFreeze } from './dash-duelist-geometry.js';

const sprite = (packed) => packed.split('|');
// 10x14 art drawn at 2x: exactly the 20x28 collider. Silhouettes: topknot, plumed hat, horned helm.
// prettier-ignore
export const FIGHTERS = deepFreeze({
  player: {
    rows: sprite('...gggg...|..gssssg.g|..s0ss0s..|...ssss...|..cccccc..|.ccwwwwcc.|.cccwwccc.|.cccccccc.|..cccccc..|..cddddc..|..cd..dc..|..dd..dd..|..dd..dd..|.ddd..ddd.'),
    palette: { g: '#ffd76a', s: '#f1c9a0', 0: '#1a1a2e', c: '#3d8bff', w: '#e8f4ff', d: '#1b2a5a' },
  },
  reed: {
    rows: sprite('....bb....|...bbbb...|...bssb...|...s0s0...|....ss....|...gggg...|..gggggg..|..gg..gg..|...gggg...|...gddg...|...gddg...|...d..d...|...d..d...|..dd..dd..'),
    palette: { b: '#58b368', s: '#f1c9a0', 0: '#1a1a2e', g: '#8fd08a', d: '#2d5a3a' },
  },
  mira: {
    rows: sprite('....pp....|...hhhh...|..hhhhhh..|...ssss...|..s0ss0s..|...tttt...|..tttttt..|..ttwwtt..|..tttttt..|..tttttt..|..ttddtt..|..ttddtt..|...d..d...|..dd..dd..'),
    palette: {p: '#ff9a3c', h: '#6aa8ff', s: '#f1c9a0', 0: '#1a1a2e', t: '#4a78d8', w: '#dce8ff', d: '#243a78' },
  },
  kade: {
    rows: sprite('h..hhhh..h|hh.hhhh.hh|.hhhhhhhh.|..hvvvvh..|..hhhhhh..|aaaaaaaaaa|aaccccccaa|aaccccccaa|aaaaaaaaaa|.aaaddaaa.|.aaaddaaa.|..add.dda.|..dd..dd..|.ddd..ddd.'),
    palette: { h: '#b9a6d8', v: '#ff3b4a', a: '#7a4cc0', c: '#ffd76a', d: '#35214f' },
  },
});
export const HEART = sprite('.h.h.|hhhhh|.hhh.|..h..');
// Weapons differ per rival: one blade, a long spear with a head, twin blades.
const ARMS = {
  player: { len: 18, spread: [0] },
  reed: { len: 22, spread: [0] },
  mira: { len: 36, spread: [0], head: true },
  kade: { len: 18, spread: [-0.45, 0.45] },
};
const POSE_ANGLE = { idle: 0.9, windup: 2.7, active: 0, recover: 1.6 };

export const COURTS = deepFreeze([
  { floor: ['#2a3040', '#2e3547'], mortar: '#1d222f', wall: '#4a5470', accent: '#8fd08a' },
  { floor: ['#352b31', '#3a2f36'], mortar: '#241b21', wall: '#6a4a55', accent: '#e0553f' },
  { floor: ['#262337', '#2b2840'], mortar: '#181626', wall: '#4d4272', accent: '#ff9a3c' },
]);
const pillar = (ctx, x, y, c, t) => {
  ctx.fillStyle = c.wall;
  ctx.fillRect(x - 7, y - 6, 14, 22);
  ctx.fillStyle = '#9aa3c4';
  ctx.fillRect(x - 9, y - 8, 18, 4);
  ctx.fillStyle = c.accent; // lantern flame
  ctx.fillRect(x - 3, y - 4 + (Math.floor(t * 4 + x) % 2), 6, 5);
};

// Calm, low-contrast courtyards so the red telegraphs stay the loudest thing on the floor.
export function drawCourtyard(ctx, t, index) {
  const c = COURTS[index];
  background(ctx, c.mortar);
  for (let row = 0, y = PLAY_TOP; y < PLAY_BOTTOM; row++, y += 24)
    for (let i = 0, x = -(row % 2) * 24; x < 480; i++, x += 48) {
      ctx.fillStyle = c.floor[(row + i) & 1];
      ctx.fillRect(x + 1, y + 1, 46, 22);
    }
  ctx.fillStyle = c.mortar;
  ctx.fillRect(0, PLAY_TOP, 480, 14);
  ctx.fillRect(0, 278, 480, PLAY_BOTTOM - 278);
  ctx.fillRect(0, PLAY_TOP, 24, 262);
  ctx.fillRect(456, PLAY_TOP, 24, 262);
  ctx.fillStyle = c.wall;
  ctx.fillRect(0, 34, 480, 10);
  ctx.fillRect(0, 278, 480, 8);
  ctx.strokeStyle = '#6a7394';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 44, 432, 234);
  for (const [x, y] of [
    [10, 52],
    [470, 52],
    [10, 262],
    [470, 262],
  ])
    pillar(ctx, x, y, c, t);
  if (index === 0) {
    ctx.fillStyle = '#5b3a24'; // old tree in the left margin
    ctx.fillRect(9, 150, 6, 30);
    ctx.fillStyle = '#2f7a43';
    ctx.fillRect(2, 112, 20, 14);
    ctx.fillRect(4, 124, 18, 24);
  } else if (index === 1) {
    for (const x of [96, 240, 384]) {
      ctx.fillStyle = c.accent; // hanging banners
      ctx.fillRect(x, 30, 16, 14);
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(x + 6, 30, 4, 12);
    }
  } else {
    for (const y of [150, 190]) {
      ctx.fillStyle = '#3a3150'; // braziers on the side walls
      ctx.fillRect(458, y, 16, 10);
      ctx.fillStyle = c.accent;
      ctx.fillRect(462, y - 8 + (Math.floor(t * 6 + y) % 3), 8, 8);
    }
  }
}

function drawArms(ctx, kind, b, aim, pose) {
  const arm = ARMS[kind],
    len = pose === 'recover' ? arm.len * 0.6 : arm.len;
  const hx = b.x + Math.cos(aim) * 8,
    hy = b.y + Math.sin(aim) * 8 + 2;
  ctx.lineWidth = 3;
  for (const sp of arm.spread) {
    const a = aim + POSE_ANGLE[pose] + sp,
      tx = hx + Math.cos(a) * len,
      ty = hy + Math.sin(a) * len;
    ctx.strokeStyle = '#dbe4f5';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (arm.head) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * 8, ty + Math.sin(a) * 8);
      ctx.lineTo(tx - Math.sin(a) * 4, ty + Math.cos(a) * 4);
      ctx.lineTo(tx + Math.sin(a) * 4, ty - Math.cos(a) * 4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// pose: idle guard, windup (leans back, weapon raised), active (weapon forward), recover (slumped).
export function drawFighter(ctx, kind, b, aim, pose = 'idle', flash = false) {
  const lean = pose === 'windup' ? -3 : 0,
    dy = pose === 'recover' ? 3 : 0;
  if (flash) ctx.globalAlpha = 0.45;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(b.x - 10, b.y + 12, 20, 4);
  const ox = Math.round(Math.cos(aim) * lean),
    oy = Math.round(Math.sin(aim) * lean);
  pixelSprite(
    ctx,
    FIGHTERS[kind].rows,
    b.x - 10 + ox,
    b.y - 14 + dy + oy,
    2,
    FIGHTERS[kind].palette,
  );
  ctx.globalAlpha = 1;
  drawArms(ctx, kind, { x: b.x + ox, y: b.y + dy + oy }, aim, pose);
}
