// Drawing: the garden, plants, pests, gardener, cursor and the two HUD bands.
import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import {
  COLS,
  FIELD_BOTTOM,
  INVADERS,
  ROWS,
  RULES,
  SPRITE,
  STEP,
  TILE,
  TOP,
  facingOf,
  inGrid,
  isIdle,
  plantAt,
  rootTilesAt,
  stageOf,
  tileAt,
  tileCenter,
  tilesAround,
} from './vine-warden-core.js';
import {
  PEST_PAL,
  PEST_ROWS,
  PLANT_PAL,
  PLANT_ROWS,
  PLAYER_ACT,
  PLAYER_IDLE,
  PLAYER_PAL,
  PLAYER_STEP,
  WITHERED_ROWS,
  drawFloor,
  drawGate,
  drawHeart,
  drawWall,
  hash,
  leaf,
  mirror,
} from './vine-warden-art.js';
import { pestRoute, isBare } from './vine-warden-route.js';
import { promptText } from './vine-warden-prompts.js';
import { LEVELS } from './vine-warden-levels.js';

function drawRootTiles(ctx, s, plant, stage) {
  const live = plant.charges > 0;
  rootTilesAt(s, plant.c, plant.r).forEach((t) => {
    const x = t.c * TILE;
    const y = TOP + t.r * TILE;
    if (stage === 3 && live) {
      ctx.fillStyle = 'rgba(226,96,32,0.45)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a2a10';
      for (let k = -TILE; k < TILE; k += 8) {
        for (let d = 0; d < TILE; d += 3) {
          const px = x + k + d;
          if (px >= x && px < x + TILE) ctx.fillRect(px, y + d, 2, 2);
        }
      }
    } else if (stage >= 1 && stage < 3) {
      const pulse = stage === 2 && Math.floor(s.ticks / 24) % 2 === 0;
      ctx.fillStyle = pulse ? '#ffd24a' : 'rgba(255,210,74,0.55)';
      for (let k = 0; k < TILE; k += 6) {
        ctx.fillRect(x + k, y, 3, 2);
        ctx.fillRect(x + k, y + TILE - 2, 3, 2);
        ctx.fillRect(x, y + k, 2, 3);
        ctx.fillRect(x + TILE - 2, y + k, 2, 3);
      }
    }
  });
}

function drawPlant(ctx, s, p) {
  const stage = stageOf(p);
  const x = p.c * TILE;
  const y = TOP + p.r * TILE;
  const spent = stage === 3 && p.charges <= 0;
  pixelSprite(ctx, spent ? WITHERED_ROWS : PLANT_ROWS[stage], x + 1, y + 1, 2, PLANT_PAL);
  if (stage < 3) {
    for (let i = 0; i < 3; i++) {
      const fill = Math.max(0, Math.min(1, (p.age - i * RULES.stageTicks) / RULES.stageTicks));
      ctx.fillStyle = '#20301f';
      ctx.fillRect(x + 3 + i * 6, y + 1, 5, 3);
      ctx.fillStyle = '#ffe36a';
      ctx.fillRect(x + 3 + i * 6, y + 1, Math.round(5 * fill), 3);
    }
  } else if (!spent) {
    for (let i = 0; i < RULES.charges; i++) {
      ctx.fillStyle = i < p.charges ? (isIdle(p) ? '#9ad7ff' : '#ff8a3c') : '#4a2c16';
      ctx.fillRect(x + 4 + i * 5, y + 20, 3, 3);
    }
  }
  if (p.grip !== null) {
    ctx.fillStyle = '#7a2a10';
    tilesAround(p.c, p.r).forEach((t, n) =>
      ctx.fillRect(t.c * TILE + 4 + (n % 3) * 6, TOP + t.r * TILE + 10, 3, 6),
    );
  }
}

export function pestPos(v) {
  const a = tileCenter(v.c, v.r);
  if (v.left <= 0) return a;
  const k = 1 - v.left / INVADERS[v.kind].ticks;
  const b = tileCenter(v.tc, v.tr);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

function drawPest(ctx, v, tick) {
  const pos = pestPos(v);
  const left = v.tc < v.c;
  const rows = left ? mirror(PEST_ROWS[v.kind]) : PEST_ROWS[v.kind];
  const hop =
    v.kind === 'hopper' && v.left > 0
      ? -Math.round(Math.sin((v.left / INVADERS.hopper.ticks) * Math.PI) * 5)
      : 0;
  const wob = v.left > 0 && Math.floor(tick / 8) % 2 ? 1 : 0;
  pixelSprite(ctx, rows, pos.x - SPRITE / 2, pos.y - SPRITE / 2 + hop + wob, 2, PEST_PAL[v.kind]);
  const total = INVADERS[v.kind].hp;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < v.hp ? '#ff4d6d' : '#3a1a24';
    ctx.fillRect(pos.x - total * 3 + i * 6, pos.y - SPRITE / 2 - 4, 5, 3);
  }
}

export function playerPos(p) {
  const a = tileCenter(p.from.c, p.from.r);
  const b = tileCenter(p.c, p.r);
  const k = p.left > 0 ? 1 - p.left / RULES.moveTicks : 1;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

function drawPlayer(ctx, s) {
  const p = s.player;
  const pos = playerPos(p);
  const rows =
    p.act > 0 ? PLAYER_ACT : p.left > 0 && Math.floor(p.left / 5) % 2 ? PLAYER_STEP : PLAYER_IDLE;
  const bob = p.left <= 0 && Math.floor(s.ticks / 40) % 2 ? 1 : 0;
  pixelSprite(
    ctx,
    p.facing.dx < 0 ? mirror(rows) : rows,
    pos.x - SPRITE / 2,
    pos.y - SPRITE / 2 + bob,
    2,
    PLAYER_PAL,
  );
}

export function targetKind(s) {
  const { c, r } = facingOf(s.player);
  const plant = plantAt(s, c, r);
  if (plant) return stageOf(plant) === 3 && plant.grip === null ? 'harvest' : 'busy';
  if (tileAt(s, c, r) === 's') return s.seeds > 0 ? 'plant' : 'busy';
  return 'none';
}

// Chevrons on the road ahead of a pest that no root covers: that is where to plant.
function drawBareRoutes(ctx, s) {
  s.invaders.forEach((v) => {
    if (!isBare(s, v)) return;
    const pulse = Math.floor(s.ticks / 20) % 2;
    let from = { c: v.c, r: v.r };
    pestRoute(s, v).forEach((t, n) => {
      const { x, y } = tileCenter(t.c, t.r);
      const dx = t.c - from.c;
      const dy = t.r - from.r;
      from = t;
      if (n > 12 || tileAt(s, t.c, t.r) === 'h') return;
      ctx.fillStyle = pulse ? '#ff6a5a' : '#ffb09a';
      ctx.fillRect(x - 2 + dx * 3, y - 2 + dy * 3, 4, 4);
      ctx.fillRect(x - 2 - dx * 2 + dy * 4, y - 2 - dy * 2 + dx * 4, 3, 3);
      ctx.fillRect(x - 2 - dx * 2 - dy * 4, y - 2 - dy * 2 - dx * 4, 3, 3);
    });
  });
}

function drawCursor(ctx, s) {
  const { c, r } = facingOf(s.player);
  if (!inGrid(c, r)) return;
  const color = { plant: '#7cff8a', harvest: '#ffd24a', busy: '#ff9a5a', none: '#c0c8d0' }[
    targetKind(s)
  ];
  const x = c * TILE;
  const y = TOP + r * TILE;
  ctx.fillStyle = color;
  [
    [0, 0, 1, 1],
    [TILE - 6, 0, -1, 1],
    [0, TILE - 6, 1, -1],
    [TILE - 6, TILE - 6, -1, -1],
  ].forEach(([ox, oy]) => {
    ctx.fillRect(x + ox, y + oy, 6, 2);
    ctx.fillRect(x + ox, y + oy, 2, 6);
  });
}

function drawFoliageFront(ctx) {
  for (let c = 0; c < COLS; c++) {
    const h = hash(c, 0, 9);
    leaf(ctx, c * TILE + (h % 8) - 4, TOP + ((h >> 6) % 6) - 8, 16, '#12683f', '#3fae6a');
    leaf(
      ctx,
      c * TILE + ((h >> 3) % 8),
      FIELD_BOTTOM - 14 - ((h >> 9) % 6),
      16,
      '#12683f',
      '#3fae6a',
    );
  }
}

function drawHud(ctx, s, env, prompt) {
  ctx.fillStyle = '#0a1812';
  ctx.fillRect(0, 0, 480, TOP);
  ctx.fillRect(0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  text(ctx, `${env.t('Level', '关卡')} ${s.level}/${LEVELS.length}`, 6, 6, '#ffe36a', 14);
  text(ctx, `${env.t('Seeds', '种子')} ${s.seeds}`, 100, 6, '#c8e87a', 14);
  text(ctx, env.t('Health', '生命'), 172, 6, '#ff9ab8', 14);
  const maxHealth = s.def.health;
  for (let i = 0; i < maxHealth; i++) {
    ctx.fillStyle = i < s.health ? '#ff4d6d' : '#3a2a30';
    ctx.fillRect(224 + i * 12, 8, 9, 9);
  }
  const left = s.def.spawns.length - s.resolved;
  text(ctx, `${env.t('Pests', '害虫')} ${left}`, 292, 6, '#d19cf5', 14);
  const due = s.def.spawns[s.spawned];
  const next =
    s.clear > 0
      ? ''
      : due
        ? `${env.t('Next', '下一只')} ${Math.max(0, Math.ceil(due[0] - s.levelTicks * STEP))}${env.t('s', '秒')}`
        : env.t('Last one', '最后一只');
  text(ctx, next, 384, 6, '#9ad7ff', 14);
  const size = prompt.key === 'tip' ? 14 : 16;
  text(ctx, env.t(prompt.en, prompt.zh), 240, FIELD_BOTTOM + 6, '#f4f4f4', size, 'center');
}

function drawBanner(ctx, s, env) {
  if (!s.message) return;
  ctx.fillStyle = 'rgba(8,24,16,0.8)';
  ctx.fillRect(40, TOP + 4, 400, 20);
  text(ctx, env.t(s.message.en, s.message.zh), 240, TOP + 7, '#ffffff', 14, 'center');
}

export function render(ctx, s, env) {
  background(ctx, '#0a1812');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = s.grid[r][c];
      const x = c * TILE;
      const y = TOP + r * TILE;
      if (ch === '#') drawWall(ctx, c, r, x, y);
      else {
        drawFloor(ctx, ch === 'G' || ch === 'h' ? '.' : ch, c, r, x, y);
        if (ch === 'G') drawGate(ctx, x, y);
        if (ch === 'h') drawHeart(ctx, x, y, s.heartFlash > 0, s.ticks);
      }
    }
  }
  s.plants.forEach((p) => drawRootTiles(ctx, s, p, stageOf(p)));
  drawBareRoutes(ctx, s);
  drawCursor(ctx, s);
  s.plants.forEach((p) => drawPlant(ctx, s, p));
  s.invaders.forEach((v) => drawPest(ctx, v, s.ticks));
  drawPlayer(ctx, s);
  s.fx.forEach((f) => {
    ctx.fillStyle = f.color;
    ctx.fillRect(Math.round(f.x), Math.round(f.y), 3, 3);
  });
  drawFoliageFront(ctx);
  drawBanner(ctx, s, env);
  drawHud(ctx, s, env, promptText(s));
}
