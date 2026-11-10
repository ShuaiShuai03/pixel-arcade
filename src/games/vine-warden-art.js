// Sprites and tile art for Vine Warden.
import { TILE } from './vine-warden-core.js';

const pal = (list) => Object.fromEntries(list.split(' ').map((c, i) => ['abcdefghijklm'[i], c]));
export const mirror = (rows) => rows.map((row) => [...row].reverse().join(''));
const keyed = (list) => Object.fromEntries(list.split(' ').map((e) => [e[0], e.slice(1)]));
const sheet = (str) => str.trim().split(/\s+/);
export const PLANT_PAL = keyed(
  'y#ffd24a r#e0405a R#8f1b3a p#ff9ab8 w#fff4d8 g#3fae4a G#1f7a35 l#9fe463 b#7a4a28 B#4a2c16 s#8d8a6a',
);
export const PLANT_ROWS = [
  sheet(`........... ........... ........... ........... ........... .....y.....
         ....bbb.... ...bbBbb... ..bbbbbbb.. .bbBbbbBbb. .BBBBBBBBB.`),
  sheet(`........... ........... ........... ..ll...ll.. .llgl.lgll. ..lgGgGgl..
         ...lgGgl... .....g..... .....G..... ...bbGbb... ..bbbbbbb..`),
  sheet(`.....r..... ....rRr.... ....rpr.... .....R..... .ll..G..ll. .lgl.G.lgl.
         ..lgGgGgl.. ...lgGgl... .....G..... ...bbGbb... ..bbbbbbb..`),
  sheet(`...yyyyy... ..yrrrrry.. .yrrpppRry. .yrpwwwprR. .yrrpppRry. ..yrrRRry..
         ...yyGyy... ..lgGGGgl.. .lgGgGgGgl. ..bbbGbbb.. .bbbbbbbbb.`),
];
export const WITHERED_ROWS =
  sheet(`........... ........... .....s..... ....sss.... ...s.s.s... ..s..s..s..
  .....s..... .....s..... ....bsb.... ...bbbbb... ..bbbbbbb..`);
// Positional palettes: letters a, b, c, ... map to the listed colours in order.
export const PEST_PAL = {
  beetle: pal('#2b1a3a #4a3a5a #8a46b8 #d19cf5 #ffffff'),
  weevil: pal('#6a3a14 #e8812c #a8541a #ffcf7a #ffffff #4a2a10'),
  hopper: pal('#9ff0ee #4fb7c2 #ffffff #202020 #ffe36a'),
};
export const PEST_ROWS = {
  beetle: sheet(`.a.......a. ..a.bbb.a.. ...bebeb... ..cccdccc.. .ccdcccdcc. acccdcdccca
    .ccdcccdcc. acccdcdccca .ccccccccc. ..cccdccc.. ...a...a...`),
  weevil: sheet(`........... ...bbbbb... ..bcbbbcb.. .bbbdbdbbb. fbbcbbbcbbf .bbbbbbbbb.
    fbbcbbbcbbf .bbbbbbbbb. ..bbbbbbb.. ...eaaae... .....a.....`),
  hopper: sheet(`.c.......c. ..c.aaa.c.. ...adada... ..aaaaaaa.. .abaaaaaba. .aaaacaaaa.
    .abaaaaaba. e.aaaaaaa.e ee.aaaaa.ee ee.......ee e.........e`),
};
export const PLAYER_PAL = keyed(
  'h#e8c050 H#b8452c s#f0c19c e#1d1d1d a#3a9a54 o#2f6fb3 b#5a3a24 t#d8d8e0',
);
export const PLAYER_IDLE =
  sheet(`..hhhhhhh.. .hhhHHHhhh. hhhhhhhhhhh ...sssss... ...seses... ...sssss...
  ..oaaaaao.. .sooaaaoos. ..ooaaaoo.. ...oo.oo... ...bb.bb...`);
export const PLAYER_STEP = [...PLAYER_IDLE.slice(0, 9), '..oo...oo..', '..bb...bb..'];
export const PLAYER_ACT = [
  ...PLAYER_IDLE.slice(0, 6),
  '.soaaaaaos.',
  't.ooaaaoo..',
  '.t.ooaoo...',
  '...oo.oo...',
  '...bb.bb...',
];

export const hash = (a, b, c = 0) =>
  (Math.imul(a + 7, 73856093) ^ Math.imul(b + 3, 19349663) ^ Math.imul(c + 1, 83492791)) >>> 0;

export function leaf(ctx, x, y, size, dark, light) {
  ctx.fillStyle = dark;
  ctx.fillRect(x + size * 0.25, y, size * 0.5, size);
  ctx.fillRect(x, y + size * 0.25, size, size * 0.5);
  ctx.fillStyle = light;
  ctx.fillRect(x + size * 0.45, y + 2, 2, size - 4);
}

export function drawWall(ctx, c, r, x, y) {
  ctx.fillStyle = '#0f3a2c';
  ctx.fillRect(x, y, TILE, TILE);
  const layers = [
    ['#14583d', '#2f8a58', 18],
    ['#1b7a4a', '#58c274', 14],
    ['#2aa05a', '#a6e86a', 10],
  ];
  layers.forEach(([dark, light, size], n) => {
    for (let i = 0; i < 2; i++) {
      const h = hash(c, r, n * 2 + i);
      leaf(
        ctx,
        x + (h % (TILE - size + 6)) - 3,
        y + ((h >> 8) % (TILE - size + 6)) - 3,
        size,
        dark,
        light,
      );
    }
  });
}

export function drawFloor(ctx, ch, c, r, x, y) {
  const h = hash(c, r);
  if (ch === 's') {
    ctx.fillStyle = '#5b3a22';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#44291a';
    ctx.fillRect(x + 1, y + 7, TILE - 2, 2);
    ctx.fillRect(x + 1, y + 16, TILE - 2, 2);
    ctx.fillStyle = '#7d5532';
    ctx.fillRect(x + 4 + (h % 8), y + 3, 2, 2);
    ctx.fillRect(x + 12 + ((h >> 4) % 8), y + 20, 2, 2);
    ctx.fillStyle = '#7ad46a';
    ctx.fillRect(x + 10, y + 11, 4, 2);
    ctx.fillRect(x + 11, y + 10, 2, 4);
  } else if (ch === 'w') {
    ctx.fillStyle = '#9a7648';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7d5c36';
    ctx.fillRect(x, y + 11, TILE, 2);
    ctx.fillRect(x + (h % 2 ? 7 : 15), y, 2, 11);
    ctx.fillRect(x + (h % 2 ? 16 : 6), y + 13, 2, 11);
  } else {
    ctx.fillStyle = '#cdb98a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#b09c6e';
    ctx.fillRect(x + (h % 16) + 2, y + ((h >> 5) % 16) + 2, 3, 2);
    ctx.fillStyle = '#e6d8b0';
    ctx.fillRect(x + ((h >> 9) % 16) + 2, y + ((h >> 3) % 16) + 3, 2, 2);
  }
}

export function drawGate(ctx, x, y) {
  ctx.fillStyle = '#1a0f12';
  ctx.fillRect(x + 6, y + 2, 18, 20);
  ctx.fillStyle = '#6a3a24';
  ctx.fillRect(x + 4, y, 4, 24);
  ctx.fillStyle = '#e84a4a';
  ctx.fillRect(x + 12, y + 9, 3, 3);
  ctx.fillRect(x + 18, y + 9, 3, 3);
}

export function drawHeart(ctx, x, y, flash, tick) {
  ctx.fillStyle = flash ? '#ff5a3c' : '#2a7a3a';
  ctx.fillRect(x + 8, y + 12, 8, 12);
  const cx = x + 12;
  const cy = y + 10 + (Math.floor(tick / 30) % 2);
  ctx.fillStyle = flash ? '#ffd0c0' : '#ff7aa8';
  [
    [-7, 0],
    [7, 0],
    [0, -7],
    [0, 7],
  ].forEach(([dx, dy]) => ctx.fillRect(cx + dx - 4, cy + dy - 4, 8, 8));
  ctx.fillStyle = '#ffd24a';
  ctx.fillRect(cx - 5, cy - 5, 10, 10);
  ctx.fillStyle = '#fff4d8';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);
}
