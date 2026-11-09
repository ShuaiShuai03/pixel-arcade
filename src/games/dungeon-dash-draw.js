// Chamber, actor and HUD drawing. The HUD strips sit on the outer wall rows, never over the floor.
import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './dungeon-dash-levels.js';
import { drawMenu } from './dungeon-dash-menu.js';
import { WARNING_HALF_ARC, enemyBlade } from './dungeon-dash-foes.js';
import { exitOpen, playerBlade } from './dungeon-dash-rules.js';
import { weaponSegment } from './dungeon-dash-world.js';

const HERO = [
  '..1111..',
  '.122221.',
  '.123321.',
  '..2222..',
  '.444444.',
  '44544544',
  '..4444..',
  '..5..5..',
];
const GUARD = [
  '..1111..',
  '.122221.',
  '.123321.',
  '..2222..',
  '.444444.',
  '44544544',
  '..4444..',
  '.55..55.',
];
const ARCHER = [
  '..11....',
  '.1221...',
  '123321..',
  '.1221...',
  '..44.5..',
  '.44455..',
  '..4..5..',
  '.6.6....',
];
const WARDEN = [
  '1..11..1',
  '11222211',
  '.233332.',
  '.223322.',
  '14444441',
  '14444441',
  '..4..4..',
  '.55..55.',
];
const SPRITES = { guard: GUARD, archer: ARCHER, warden: WARDEN };
const PALETTES = [
  ['#1b3337', '#43565a'],
  ['#29343b', '#565f65'],
  ['#293443', '#586275'],
  ['#362e2a', '#6e5547'],
  ['#2e3041', '#615770'],
];
const ENEMY_COLOR = { guard: '#9cb2a1', archer: '#cfad73', warden: '#bd8fbc' };
const ARMOR_COLOR = '#7fa6d6';
const STONE = '#6f7a78';

export function objective(s) {
  if (s.levers.some((l) => !l.on && l.opens !== 'spikes'))
    return { en: 'E: pull the lever to open the gate', zh: '按E拉动拉杆，打开闸门' };
  const needsClear = LEVELS[s.level - 1].needsClear;
  if (needsClear && s.enemies.length)
    return {
      en: `Defeat ${s.enemies.length} ${s.enemies.length === 1 ? 'guardian' : 'guardians'} · ${s.hasKey ? 'Key secured' : 'Find the key'}`,
      zh: `击败${s.enemies.length}名守卫 · ${s.hasKey ? '已取得钥匙' : '寻找钥匙'}`,
    };
  if (!s.hasKey)
    return { en: 'Find the gold key, then reach the exit door', zh: '寻找金色钥匙，然后前往出口' };
  return { en: 'Key in hand — enter the glowing exit', zh: '已有钥匙，进入发光的出口' };
}
function bladeDraw(ctx, blade, color) {
  if (!blade) return;
  for (const [style, width] of [
    ['#263b42', 6],
    [color, blade.r * 2],
  ]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(blade.ax, blade.ay);
    ctx.lineTo(blade.bx, blade.by);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff2c8';
  ctx.fillRect(blade.bx - 1, blade.by - 1, 2, 2);
}
function drawTiles(ctx, s) {
  const [floor, wall] = PALETTES[Math.min(4, Math.floor((s.level - 1) / 4))];
  background(ctx, '#0e1c26');
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 22; x++) {
      const px = 20 + x * 20,
        py = 30 + y * 20,
        tile = s.tiles[y][x];
      ctx.fillStyle = tile ? (tile === 2 ? '#35434d' : wall) : floor;
      ctx.fillRect(px, py, 20, 20);
      if (!tile) {
        ctx.fillStyle = '#3a5053';
        ctx.fillRect(px + 2, py + 17, 16, 1);
        continue;
      }
      ctx.fillStyle = tile === 2 ? '#b6a16e' : '#75807b';
      ctx.fillRect(px, py, 20, 3);
      ctx.fillStyle = '#142630';
      ctx.fillRect(px, py + 18, 20, 2);
      ctx.fillRect(px + 18, py + 3, 2, 15);
      if (tile === 2) {
        ctx.fillStyle =
          s.gates.find((g) => g.cx === x && g.cy === y).id === 'D' ? '#a5b4af' : '#d59756';
        for (let k = 3; k < 18; k += 5) ctx.fillRect(px + k, py + 3, 2, 15);
      } else {
        ctx.fillStyle = '#34484c';
        ctx.fillRect(px + 2, py + 10, 16, 1);
      }
    }
}
function drawSpike(ctx, h) {
  ctx.fillStyle = h.disabled ? '#415456' : '#151e25';
  ctx.fillRect(h.x - 9, h.y - 9, 18, 18);
  if (h.state === 'active') {
    ctx.fillStyle = '#efd1ad';
    for (const n of [-1, 0, 1]) {
      ctx.fillRect(h.x + n * 5 - 1, h.y - 8, 2, 16);
      ctx.fillRect(h.x + n * 5 - 2, h.y - 3, 4, 6);
    }
  } else if (h.state === 'warning') {
    ctx.fillStyle = '#df9d62';
    ctx.fillRect(h.x - 9, h.y - 9, 18, 2);
    ctx.fillRect(h.x - 9, h.y + 7, 18, 2);
    ctx.fillRect(h.x - 1, h.y - 4, 2, 6);
    ctx.fillRect(h.x - 1, h.y + 4, 2, 2);
  } else {
    ctx.fillStyle = '#55666a';
    for (const n of [-1, 0, 1]) ctx.fillRect(h.x + n * 5 - 1, h.y - 2, 2, 4);
  }
}
const flask = (ctx, x, y) => {
  ctx.fillStyle = '#d5e5cd';
  ctx.fillRect(x - 2, y - 6, 4, 4);
  ctx.fillStyle = '#d9786e';
  ctx.fillRect(x - 4, y - 2, 8, 7);
  ctx.fillStyle = '#f8c9a4';
  ctx.fillRect(x - 2, y - 1, 2, 4);
};
function drawProps(ctx, s) {
  s.hazards.forEach((h) => drawSpike(ctx, h));
  const ready = exitOpen(s);
  ctx.fillStyle = ready ? '#d8d49b' : '#547271';
  ctx.fillRect(s.exit.x - 9, s.exit.y - 10, 18, 20);
  ctx.fillStyle = '#102b32';
  ctx.fillRect(s.exit.x - 6, s.exit.y - 7, 12, 17);
  ctx.fillStyle = ready ? '#b7e0bb' : '#bcae77';
  if (ready) ctx.fillRect(s.exit.x - 4, s.exit.y - 5, 8, 15);
  else ctx.fillRect(s.exit.x - 2, s.exit.y - 1, 4, 5);
  for (const p of s.treasures) {
    ctx.fillStyle = '#ac7742';
    ctx.fillRect(p.x - 5, p.y - 4, 10, 8);
    ctx.fillStyle = '#ffe2a0';
    ctx.fillRect(p.x - 2, p.y - 3, 4, 6);
  }
  s.potions.forEach((p) => flask(ctx, p.x, p.y));
  for (const c of s.chests) {
    ctx.fillStyle = c.opened ? '#35524f' : '#ac864d';
    ctx.fillRect(c.x - 7, c.y - 6, 14, 12);
    ctx.fillStyle = c.opened ? '#799d83' : '#ecd096';
    ctx.fillRect(c.x - 5, c.y - 1, 10, 2);
    ctx.fillRect(c.x - 1, c.y - 4, 2, 8);
  }
  for (const r of s.shrines) {
    ctx.fillStyle = r.used ? '#3b5255' : '#6ea9aa';
    ctx.fillRect(r.x - 7, r.y - 7, 14, 14);
    ctx.fillStyle = '#b6d3b6';
    ctx.fillRect(r.x - 1, r.y - 4, 2, 8);
    ctx.fillRect(r.x - 4, r.y - 1, 8, 2);
  }
  for (const p of s.levers) {
    ctx.fillStyle = p.opens === 'spikes' ? '#7a5a5a' : p.opens === 'd' ? '#8a6a45' : '#67747a';
    ctx.fillRect(p.x - 7, p.y - 5, 14, 10);
    ctx.fillStyle = p.on ? '#9ec99d' : '#edbb73';
    ctx.fillRect(p.x + (p.on ? 1 : -5), p.y - 6, 4, 8);
  }
  if (!s.hasKey) {
    ctx.fillStyle = '#f1cf78';
    ctx.fillRect(s.key.x - 6, s.key.y - 4, 7, 7);
    ctx.fillRect(s.key.x, s.key.y - 1, 8, 3);
    ctx.fillRect(s.key.x + 5, s.key.y + 1, 3, 3);
    ctx.fillStyle = '#4c5143';
    ctx.fillRect(s.key.x - 4, s.key.y - 2, 3, 3);
  }
  for (const p of s.projectiles) {
    const speed = Math.hypot(p.vx, p.vy) || 1;
    ctx.strokeStyle = '#deb57b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - (p.vx / speed) * 8, p.y - (p.vy / speed) * 8);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = '#f3e0ba';
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
}
function drawWarning(ctx, e) {
  const a = Math.atan2(e.aim.y, e.aim.x),
    range = e.type === 'warden' ? 54 : e.type === 'archer' ? 145 : 35;
  ctx.strokeStyle = '#d78f61';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (e.type === 'archer') {
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(a) * range, e.y + Math.sin(a) * range);
  } else if (e.type === 'warden') ctx.arc(e.x, e.y, range, 0, Math.PI * 2);
  else ctx.arc(e.x, e.y, range, a - WARNING_HALF_ARC, a + WARNING_HALF_ARC);
  ctx.stroke();
  text(ctx, '!', e.x, e.y - 23, '#ffdda0', 13, 'center');
}
function drawEnemy(ctx, s, e) {
  if (e.state === 'windup') drawWarning(ctx, e);
  const asleep = e.state === 'sleep',
    statue = asleep && e.wake === 'key',
    color = e.hit > 0 ? '#fff0c9' : statue ? STONE : e.armor ? ARMOR_COLOR : ENEMY_COLOR[e.type];
  ctx.fillStyle = '#102128';
  ctx.fillRect(e.x - 8, e.y + 5, 16, 4);
  pixelSprite(ctx, SPRITES[e.type], e.x - 8, e.y - 8, 2, {
    1: '#74858b',
    2: color,
    3: '#20323a',
    4: color,
    5: '#acbab1',
    6: '#a99a72',
  });
  if (asleep && !statue) text(ctx, 'z', e.x + 6, e.y - 20, '#a9c8d0', 11);
  for (let n = 0; n < e.hp; n++) {
    ctx.fillStyle = '#da9a7d';
    ctx.fillRect(e.x - e.hp * 2 + n * 4, e.y - 13, 3, 2);
  }
  bladeDraw(ctx, enemyBlade(s, e), '#f1ab73');
}
function drawPlayer(ctx, s) {
  const { player } = s;
  if (s.dash > 0) {
    ctx.fillStyle = '#668e92';
    ctx.fillRect(player.x - 5 - s.dashDir.x * 9, player.y - 5 - s.dashDir.y * 9, 10, 10);
  }
  ctx.fillStyle = '#102128';
  ctx.fillRect(player.x - 8, player.y + 5, 16, 4);
  const rows = [...HERO];
  if (Math.hypot(player.vx, player.vy) > 10)
    rows[7] = Math.floor(s.time * 10) % 2 ? '...5.5..' : '..5.5...';
  pixelSprite(ctx, rows, player.x - 8, player.y - 8, 2, {
    1: '#d5b77e',
    2: '#efd09b',
    3: '#233b44',
    4: s.invulnerable > 0 && Math.floor(s.invulnerable * 16) % 2 === 0 ? '#edc6a7' : '#75bdc0',
    5: '#b4c8b4',
  });
  bladeDraw(ctx, playerBlade(s), '#fff0b5');
  if (s.swing && s.swing.elapsed < 0.07)
    bladeDraw(ctx, weaponSegment(s, player, s.swing.angle - 1.05, 25), '#7c9c96');
}
function drawHud(ctx, s, env) {
  const spec = LEVELS[s.level - 1];
  ctx.fillStyle = '#10222d';
  ctx.fillRect(0, 0, 480, 30);
  ctx.fillRect(16, 292, 448, 28);
  text(ctx, `${s.level}/${LEVEL_COUNT} ${env.t(spec.name.en, spec.name.zh)}`, 18, 8, '#d4d1b9', 10);
  text(ctx, `${s.health} ♥`, 257, 7, '#e9a18b', 13, 'center');
  text(ctx, env.t('STAMINA', '体力'), env.lang === 'zh' ? 198 : 170, 19, '#bec7ad', 10);
  ctx.fillStyle = '#394e53';
  ctx.fillRect(224, 24, 66, 3);
  ctx.fillStyle = s.stamina < 18 ? '#d4886d' : '#c8c588';
  ctx.fillRect(224, 24, s.stamina * 0.66, 3);
  flask(ctx, 358, 14);
  text(ctx, `${s.flasks}/3`, 373, 8, '#ead5aa', 12);
  const task = objective(s);
  text(ctx, env.t(task.en, task.zh), 240, 295, '#c7d3b5', 10, 'center');
  const hint =
    s.toast.time > 0
      ? env.t(s.toast.en, s.toast.zh)
      : env.t('Space: sword · K: dodge · E: use · H: heal', '空格挥剑 · K闪避 · E使用 · H喝药');
  text(ctx, hint, 240, 308, '#93b0b0', 10, 'center');
}
function drawParticles(ctx, s) {
  for (const p of s.particles) {
    ctx.fillStyle = p.kind === 'hurt' ? '#e5a088' : '#efd59d';
    const d = (0.25 - p.life) * 25;
    for (let n = 0; n < 4; n++)
      ctx.fillRect(
        p.x + Math.cos((n * Math.PI) / 2) * d,
        p.y + Math.sin((n * Math.PI) / 2) * d,
        2,
        2,
      );
  }
}
export function drawDungeon(ctx, s, env, menu) {
  if (menu) return drawMenu(ctx, menu, env);
  drawTiles(ctx, s);
  drawProps(ctx, s);
  s.enemies.forEach((e) => drawEnemy(ctx, s, e));
  drawPlayer(ctx, s);
  drawParticles(ctx, s);
  drawHud(ctx, s, env);
}
