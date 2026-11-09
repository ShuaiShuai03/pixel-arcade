import { background } from '../shared/utils.js';
import { FLOOR } from './ember-knights-physics.js';

function drawWalls(ctx, wall) {
  ctx.fillStyle = wall;
  ctx.fillRect(0, 70, 480, 157);
  for (let y = 76; y < 223; y += 20) {
    ctx.fillStyle = '#18243833';
    ctx.fillRect(0, y, 480, 1);
    for (let x = (Math.floor(y / 20) % 2) * 25; x < 480; x += 50) ctx.fillRect(x, y, 1, 20);
  }
}
function drawTorches(ctx, time) {
  for (const x of [17, 441]) {
    ctx.fillStyle = '#5c5c67';
    ctx.fillRect(x, 90, 22, 169);
    ctx.fillRect(x - 3, 88, 28, 8);
    ctx.fillStyle = '#a67851';
    ctx.fillRect(x + 4, 141, 14, 6);
    ctx.fillStyle = '#ffc275';
    ctx.fillRect(x + 7, 126 + Math.floor(Math.sin(time * 9 + x) * 2), 7, 16);
    ctx.fillStyle = '#ffe3a2';
    ctx.fillRect(x + 9, 130, 3, 11);
  }
}
function drawFloor(ctx) {
  ctx.fillStyle = '#6f737c';
  ctx.fillRect(0, FLOOR, 480, 7);
  ctx.fillStyle = '#383f4d';
  ctx.fillRect(0, FLOOR + 7, 480, 53);
  for (let y = 271; y < 320; y += 15)
    for (let x = (y % 2) * 22; x < 480; x += 44) {
      ctx.strokeStyle = '#505a66';
      ctx.strokeRect(x, y, 43, 14);
    }
}

const SCENES = {
  courtyard(ctx) {
    ctx.fillStyle = '#e9bd7c88';
    ctx.fillRect(317, 90, 34, 29);
    ctx.fillRect(321, 86, 26, 37);
    battlements(ctx);
  },
  rampart(ctx) {
    ctx.fillStyle = '#b8d2cf88';
    ctx.fillRect(317, 90, 34, 29);
    ctx.fillRect(321, 86, 26, 37);
    battlements(ctx);
  },
  forge(ctx, time) {
    ctx.fillStyle = '#302831';
    ctx.fillRect(167, 132, 147, 112);
    ctx.fillStyle = '#ad613d';
    ctx.fillRect(185, 158, 110, 76);
    ctx.fillStyle = '#e5ac55';
    for (let n = 0; n < 7; n++) ctx.fillRect(191 + n * 14, 181 + Math.sin(time * 5 + n) * 6, 9, 52);
    ctx.fillStyle = '#3a3540';
    ctx.fillRect(177, 203, 125, 7);
    ctx.fillRect(237, 151, 7, 85);
  },
  garden(ctx) {
    ctx.fillStyle = '#304337';
    for (const x of [72, 391]) {
      ctx.fillRect(x, 119, 7, 120);
      for (let n = 0; n < 5; n++) ctx.fillRect(x - 18 + (n % 2) * 6, 137 + n * 17, 40, 9);
    }
    ctx.fillStyle = '#b699a15e';
    ctx.fillRect(176, 107, 123, 87);
    ctx.fillStyle = '#4d3f5255';
    ctx.fillRect(184, 114, 107, 80);
  },
  hall(ctx) {
    pillars(ctx);
  },
  throne(ctx) {
    pillars(ctx);
    ctx.fillStyle = '#7f5e434f';
    ctx.fillRect(193, 174, 95, 65);
    ctx.fillRect(211, 153, 59, 90);
    ctx.fillStyle = '#d1b57755';
    ctx.fillRect(235, 162, 9, 57);
    ctx.fillRect(218, 181, 43, 7);
  },
  cellar(ctx, time) {
    ctx.fillStyle = '#1b1f2a99';
    for (const x of [60, 150, 330, 410]) ctx.fillRect(x, 70, 22, 157);
    for (const x of [100, 366]) {
      ctx.fillStyle = '#5b4636';
      ctx.fillRect(x, 190, 34, 46);
      ctx.fillStyle = '#7a6046';
      ctx.fillRect(x, 202, 34, 4);
      ctx.fillRect(x, 222, 34, 4);
    }
    ctx.fillStyle = '#8c8f9a';
    for (const x of [214, 262])
      for (let y = 74; y < 128; y += 8) ctx.fillRect(x + (y % 16 ? 2 : 0), y, 3, 5);
    ctx.fillStyle = '#e9843b';
    ctx.fillRect(230, 218 + Math.sin(time * 6), 20, 4);
  },
  bridge(ctx, time) {
    ctx.fillStyle = '#0f1930';
    ctx.fillRect(0, 70, 480, 157);
    ctx.fillStyle = '#dfe6f0';
    ctx.fillRect(372, 88, 26, 26);
    ctx.fillStyle = '#0f1930';
    ctx.fillRect(382, 84, 22, 24);
    ctx.fillStyle = '#c9d4e8';
    for (let n = 0; n < 16; n++)
      ctx.fillRect((n * 97) % 470, 78 + ((n * 41) % 70), 2 + (Math.floor(time * 2 + n) % 2), 2);
    ctx.fillStyle = '#1b2a45';
    for (const x of [30, 150, 290]) {
      ctx.fillRect(x, 150, 46, 77);
      ctx.fillRect(x + 6, 136, 8, 14);
      ctx.fillRect(x + 30, 136, 8, 14);
    }
    ctx.fillStyle = '#3a4258';
    ctx.fillRect(0, 214, 480, 13);
    for (let x = 0; x < 480; x += 30) ctx.fillRect(x, 200, 18, 14);
  },
};
function battlements(ctx) {
  ctx.fillStyle = '#283744';
  for (let x = 0; x < 480; x += 48) {
    ctx.fillRect(x, 180 - (x % 31), 35, 58 + (x % 31));
    ctx.fillRect(x + 2, 170 - (x % 31), 8, 13);
    ctx.fillRect(x + 25, 170 - (x % 31), 8, 13);
  }
}
function pillars(ctx) {
  for (const x of [67, 220, 373]) {
    ctx.fillStyle = '#28333e88';
    ctx.fillRect(x, 94, 40, 111);
    ctx.fillRect(x + 7, 85, 26, 124);
    ctx.fillStyle = '#c7b98e44';
    ctx.fillRect(x + 18, 100, 4, 99);
    ctx.fillRect(x + 5, 135, 30, 4);
  }
}

export const ARENAS = Object.keys(SCENES);

export function drawArena(ctx, champion, time) {
  background(ctx, '#222938');
  drawWalls(ctx, champion.color);
  SCENES[champion.arena](ctx, time);
  drawTorches(ctx, time);
  drawFloor(ctx);
}
