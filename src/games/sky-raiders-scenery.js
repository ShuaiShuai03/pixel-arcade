// Scrolling backgrounds, one per scenery type. Every sector picks a type and a palette.
import { background } from '../shared/utils.js';

const SCROLL_SPEED = 15;

function cloud(ctx, x, y, size, base, light) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y + 6, size, 10);
  ctx.fillRect(x + 9, y, size - 20, 22);
  ctx.fillRect(x + 21, y - 5, size - 41, 10);
  ctx.fillStyle = light;
  ctx.fillRect(x + 10, y + 1, size - 26, 3);
  ctx.fillRect(x + 2, y + 8, 12, 2);
}
function island(ctx, x, y, width, land, rim) {
  ctx.fillStyle = rim;
  ctx.fillRect(x + 9, y, width - 18, 7);
  ctx.fillRect(x, y + 7, width, 24);
  ctx.fillRect(x + 12, y + 31, width - 28, 10);
  ctx.fillStyle = land;
  ctx.fillRect(x + 13, y + 5, width - 28, 7);
  ctx.fillRect(x + 5, y + 12, width - 13, 15);
  ctx.fillRect(x + 20, y + 27, width - 43, 7);
}
const wrap = (value, span, shift = 0) => (((value % span) + span) % span) - shift;
const streaks = (ctx, scroll, color, count = 34) => {
  for (let n = 0; n < count; n++) {
    ctx.fillStyle = color;
    ctx.fillRect((n * 97) % 480, wrap(n * 41 + scroll * 0.45, 350, 20), 8 + (n % 4) * 5, 2);
  }
};
function derrick(ctx, x, y, hull, glow) {
  ctx.fillStyle = hull;
  ctx.fillRect(x - 7, y, 14, 52);
  ctx.fillRect(x - 4, y - 5, 8, 62);
  ctx.fillStyle = glow;
  ctx.fillRect(x - 4, y + 10, 8, 28);
  ctx.fillRect(x - 2, y + 3, 4, 7);
  ctx.fillStyle = hull;
  ctx.fillRect(x - 8, y + 58, 2, 12);
  ctx.fillRect(x + 6, y + 58, 2, 12);
}
function wall(ctx, x, y, body, trim, lamp) {
  ctx.fillStyle = body;
  ctx.fillRect(x, y, 64, 89);
  ctx.fillRect(x - 8, y + 20, 80, 42);
  ctx.fillStyle = trim;
  ctx.fillRect(x + 12, y + 9, 38, 6);
  ctx.fillRect(x + 12, y + 72, 38, 4);
  ctx.fillStyle = lamp;
  ctx.fillRect(x + 28, y + 23, 5, 9);
  ctx.fillRect(x + 28, y + 51, 5, 9);
}
const SCENES = {
  cloud: () => {},
  coast: (ctx, s, [, base, light], scroll) => {
    streaks(ctx, scroll, '#334b5b');
    for (let n = 0; n < 6; n++)
      island(ctx, n % 2 ? 385 : -28, wrap(n * 93 + scroll * 0.7, 540, 80), 120, light, base);
  },
  convoy: (ctx, s, [, base, light], scroll) => {
    streaks(ctx, scroll, '#1b3449');
    for (let n = 0; n < 5; n++)
      derrick(ctx, 50 + n * 92, wrap(n * 89 + scroll * 0.65, 450, 65), light, base);
  },
  cinder: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 8; n++) {
      const x = ((n * 163) % 510) - 30,
        y = wrap(n * 117 + scroll * 0.6, 510, 80);
      island(ctx, x, y, 76, light, base);
      ctx.fillStyle = '#8b5b59';
      ctx.fillRect(x + 23, y + 12, 21, 3);
      ctx.fillRect(x + 38, y + 15, 4, 10);
    }
    for (let n = 0; n < 20; n++) {
      ctx.fillStyle = n % 3 ? '#6e4e57' : '#986d61';
      ctx.fillRect((n * 79 + s.elapsed * 4) % 480, (n * 61 + scroll) % 320, 2, 2);
    }
  },
  citadel: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 4; n++)
      wall(ctx, n % 2 ? 422 : -4, wrap(n * 121 + scroll * 0.5, 490, 90), light, '#51455f', base);
  },
  storm: (ctx, s) => {
    ctx.strokeStyle = '#596888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let n = 0; n < 26; n++) {
      const x = (n * 113 + s.elapsed * 20) % 480,
        y = wrap(n * 53 + s.elapsed * 130, 350, 20);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 10);
    }
    ctx.stroke();
  },
  desert: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 12; n++) {
      ctx.fillStyle = n % 2 ? base : light;
      ctx.fillRect(
        wrap(n * 71, 560, 40),
        wrap(n * 53 + scroll * 0.5, 360, 30),
        90 + (n % 3) * 30,
        6,
      );
    }
    for (let n = 0; n < 4; n++) {
      const y = wrap(n * 130 + scroll * 0.6, 520, 90);
      ctx.fillStyle = light;
      ctx.fillRect(n % 2 ? 420 : 0, y, 60, 70);
      ctx.fillStyle = base;
      ctx.fillRect(n % 2 ? 420 : 0, y + 52, 60, 18);
    }
  },
  aurora: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 5; n++) {
      ctx.fillStyle = `${light}33`;
      ctx.fillRect(wrap(n * 120 + s.elapsed * 8, 600, 60), 48, 46, 256);
    }
    for (let n = 0; n < 10; n++) {
      const x = wrap(n * 131, 540, 40),
        y = wrap(n * 79 + scroll * 0.55, 400, 40);
      ctx.fillStyle = base;
      ctx.fillRect(x, y, 56, 18);
      ctx.fillStyle = light;
      ctx.fillRect(x + 4, y + 2, 40, 4);
    }
  },
  reef: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 8; n++) {
      const x = wrap(n * 149, 560, 50),
        y = wrap(n * 97 + scroll * 0.5, 420, 50);
      ctx.fillStyle = base;
      ctx.fillRect(x, y, 70, 26);
      ctx.fillRect(x + 12, y - 8, 40, 12);
      ctx.fillStyle = light;
      ctx.fillRect(x + 8, y + 6, 6, 6);
      ctx.fillRect(x + 40, y + 12, 8, 6);
    }
  },
  city: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 10; n++) {
      const x = n % 2 ? 420 - (n % 3) * 14 : (n % 3) * 14 - 10,
        y = wrap(n * 83 + scroll * 0.6, 500, 90),
        h = 60 + (n % 4) * 14;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, 70, h);
      ctx.fillStyle = light;
      for (let w = 0; w < 6; w++)
        ctx.fillRect(x + 8 + (w % 3) * 20, y + 8 + Math.floor(w / 3) * 18, 6, 8);
    }
  },
  forest: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 16; n++) {
      const x = wrap(n * 113, 560, 40),
        y = wrap(n * 67 + scroll * 0.55, 400, 40);
      ctx.fillStyle = base;
      ctx.fillRect(x, y + 6, 48, 26);
      ctx.fillRect(x + 8, y, 32, 38);
      ctx.fillStyle = light;
      ctx.fillRect(x + 10, y + 4, 12, 6);
      ctx.fillRect(x + 28, y + 20, 8, 6);
    }
  },
  space: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 50; n++) {
      ctx.fillStyle = n % 5 ? base : '#c8d0f0';
      ctx.fillRect((n * 83) % 480, wrap(n * 47 + scroll * (0.3 + (n % 3) * 0.25), 330, 10), 2, 2);
    }
    for (let n = 0; n < 6; n++) {
      const x = wrap(n * 191, 560, 40),
        y = wrap(n * 113 + scroll * 0.7, 440, 50);
      ctx.fillStyle = base;
      ctx.fillRect(x, y + 6, 30, 18);
      ctx.fillRect(x + 6, y, 18, 30);
      ctx.fillStyle = light;
      ctx.fillRect(x + 8, y + 8, 8, 4);
    }
  },
  foundry: (ctx, s, [, base, light], scroll) => {
    for (let n = 0; n < 6; n++) {
      ctx.fillStyle = base;
      ctx.fillRect(60 + n * 74, 48, 6, 256);
    }
    for (let n = 0; n < 14; n++) {
      const x = 52 + (n % 6) * 74,
        y = wrap(n * 71 + scroll * 1.1, 360, 30);
      ctx.fillStyle = n % 3 ? base : light;
      ctx.fillRect(x, y, 22, 12);
    }
  },
};
// Cloud decks: how many cloud banks drift over each scenery type.
const CLOUD_BANKS = {
  cloud: 14,
  storm: 14,
  coast: 6,
  convoy: 6,
  cinder: 6,
  citadel: 6,
  aurora: 5,
  desert: 4,
  reef: 4,
  city: 4,
  forest: 4,
  space: 0,
  foundry: 3,
};

export function drawScenery(ctx, s, sector) {
  const [sky, base, light] = sector.palette,
    scroll = s.elapsed * SCROLL_SPEED;
  background(ctx, sky);
  SCENES[sector.scene](ctx, s, sector.palette, scroll);
  const banks = CLOUD_BANKS[sector.scene] ?? 4;
  for (let n = 0; n < banks; n++) {
    const x = wrap(n * 139 + Math.floor(s.elapsed * (n % 2 ? 2 : -2)) + 600, 600, 70),
      y = wrap(n * 83 + scroll * (n % 2 ? 1.2 : 1), 410, 55);
    cloud(ctx, x, y, 64 + (n % 3) * 18, base, sector.scene === 'cloud' ? light : base);
  }
}
export const SCENERY_TYPES = Object.keys(SCENES);
