import { clamp, drawPixelText as text, background, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'pixel-rally',
  name: { en: 'Pixel Rally', zh: '像素拉力赛' },
  description: {
    en: 'Race through three landscapes. Overtake traffic, collect coins, and finish before time runs out. Stay on the road: grass slows you down.',
    zh: '穿越三种地形，超越车辆并收集金币，在倒计时结束前抵达终点。保持在赛道上，草地会让你减速。',
  },
  genre: 'sports',
  players: '1',
  touch: true,
  keys: [
    { label: { en: 'Steer', zh: '转向' }, keys: 'A / D · ← / →' },
    { label: { en: 'Accelerate / brake', zh: '加速 / 刹车' }, keys: 'W / S · ↑ / ↓' },
  ],
};

export function createRallyState() {
  return {
    phase: 'playing',
    score: 0,
    distance: 0,
    target: 3200,
    time: 90,
    speed: 100,
    carX: 0,
    health: 4,
    invulnerable: 0,
    traffic: [],
    coins: [],
    collected: 0,
    spawnAt: 170,
    coinAt: 110,
    flash: 0,
  };
}
export const roadCurve = (d) => Math.sin(d / 310) * 36 + Math.sin(d / 740) * 20;
function finish(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  s.score =
    Math.floor(s.distance) +
    s.collected * 100 +
    (won ? s.health * 250 + Math.ceil(s.time) * 10 : 0);
  env.sound(won ? 'win' : 'lose');
  const message = won
    ? env.t('Finish line! The rally is yours.', '冲过终点！拉力赛胜利。')
    : s.time <= 0
      ? env.t(
          'Time ran out. Stay on the road and keep moving!',
          '时间用完了。保持在赛道上，继续前进！',
        )
      : env.t('Race over. Try braking before the traffic.', '比赛结束。接近车辆时试试刹车。');
  env.end({
    won,
    score: s.score,
    message,
  });
}
export function stepRally(s, dt, input, env) {
  if (s.phase !== 'playing') return;
  s.time = Math.max(0, s.time - dt);
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.flash = Math.max(0, s.flash - dt);
  const steer = Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));
  s.carX = clamp(s.carX + steer * (105 + s.speed * 0.28) * dt, -195, 195);
  const offroad = Math.abs(s.carX - roadCurve(s.distance)) > 105;
  const target = offroad
    ? 22
    : input.held('ArrowDown', 'KeyS')
      ? 18
      : input.held('ArrowUp', 'KeyW')
        ? 210
        : 135;
  s.speed += clamp(target - s.speed, -180 * dt, 80 * dt);
  s.distance += s.speed * dt;
  if (s.distance >= s.spawnAt) {
    s.spawnAt = s.distance + 160 + env.random() * 110;
    const lane = (Math.floor(env.random() * 3) - 1) * 65;
    s.traffic.push({
      z: 480,
      lane,
      speed: 40 + env.random() * 35,
      color: Math.floor(env.random() * 3),
    });
  }
  if (s.distance >= s.coinAt) {
    s.coinAt = s.distance + 140;
    const lane = (Math.floor(env.random() * 3) - 1) * 65;
    for (let i = 0; i < 3; i++) s.coins.push({ z: 450 + i * 35, lane });
  }
  for (const car of s.traffic) {
    car.z -= (s.speed - car.speed) * dt;
    if (
      Math.abs(car.z) < 27 &&
      Math.abs(s.carX - roadCurve(s.distance) - car.lane) < 25 &&
      s.invulnerable === 0
    ) {
      s.health--;
      s.speed = 60;
      s.invulnerable = 1.5;
      s.flash = 0.2;
      car.z = -65;
      env.sound('hit');
    }
  }
  for (const coin of s.coins) {
    coin.z -= s.speed * dt;
    if (Math.abs(coin.z) < 22 && Math.abs(s.carX - roadCurve(s.distance) - coin.lane) < 24) {
      coin.z = -99;
      s.collected++;
      env.sound('coin');
    }
  }
  s.traffic = s.traffic.filter((c) => c.z > -100);
  s.coins = s.coins.filter((c) => c.z > -50);
  s.score = Math.floor(s.distance) + s.collected * 100;
  if (s.health <= 0 || s.time <= 0) finish(s, env, false);
  else if (s.distance >= s.target) finish(s, env, true);
}
const carRows = [
  '..1111..',
  '.111111.',
  '21233212',
  '21233212',
  '.111111.',
  '21211212',
  '21211212',
  '..1111..',
];
function car(ctx, x, y, color, scale = 3) {
  pixelSprite(ctx, carRows, Math.round(x - 12), Math.round(y - 12), scale, {
    1: color,
    2: '#112332',
    3: '#b7e7eb',
  });
}
function drawRally(ctx, s, env) {
  const region = Math.min(2, Math.floor(s.distance / (s.target / 3)));
  const land = ['#39765c', '#ad814d', '#293f61'][region],
    edge = ['#77b779', '#dabd77', '#5d7e8a'][region];
  background(ctx, land);
  for (let y = 30; y < 320; y += 4) {
    const z = (260 - y) * 2;
    const cx = 240 + roadCurve(s.distance + z);
    ctx.fillStyle = edge;
    ctx.fillRect(cx - 122, y, 244, 4);
    ctx.fillStyle = '#25363d';
    ctx.fillRect(cx - 111, y, 222, 4);
    ctx.fillStyle = '#f0d68b';
    ctx.fillRect(cx - 109, y, 3, 4);
    ctx.fillRect(cx + 106, y, 3, 4);
    if (Math.floor((s.distance + z) / 35) % 2 === 0) {
      ctx.fillStyle = '#98a8a6';
      ctx.fillRect(cx - 34, y, 2, 4);
      ctx.fillRect(cx + 33, y, 2, 4);
    }
  }
  for (let i = 0; i < 13; i++) {
    const z = (i * 61 + s.distance * 0.7) % 660;
    const y = 320 - z * 0.5;
    const left = i % 2 === 0;
    const x = left ? 35 + ((i * 13) % 38) : 400 + ((i * 11) % 40);
    ctx.fillStyle = region === 1 ? '#805e43' : '#173f39';
    ctx.fillRect(x + 8, y, 5, 19);
    ctx.fillStyle = region === 1 ? '#669668' : '#559768';
    ctx.fillRect(x, y - 5, 20, 16);
    ctx.fillRect(x + 4, y - 12, 12, 10);
  }
  for (const coin of s.coins) {
    const y = 260 - coin.z * 0.5;
    if (y < 35 || y > 300) continue;
    const x = 240 + roadCurve(s.distance + coin.z) + coin.lane;
    ctx.fillStyle = '#d19740';
    ctx.fillRect(x - 5, y - 6, 10, 12);
    ctx.fillStyle = '#ffe195';
    ctx.fillRect(x - 2, y - 4, 4, 8);
  }
  for (const c of s.traffic) {
    const y = 260 - c.z * 0.5;
    if (y < 20 || y > 330) continue;
    car(
      ctx,
      240 + roadCurve(s.distance + c.z) + c.lane,
      y,
      ['#e67e68', '#78a9bc', '#e4be58'][c.color],
    );
  }
  if (s.distance > s.target - 450) {
    const y = 260 - (s.target - s.distance) * 0.5;
    if (y > 30) {
      const x = 240 + roadCurve(s.target) - 110;
      for (let i = 0; i < 22; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#112330' : '#eff1de';
          ctx.fillRect(x + i * 10, y + j * 8, 10, 8);
        }
    }
  }
  if (s.invulnerable === 0 || Math.floor(s.invulnerable * 12) % 2 === 0)
    car(ctx, 240 + s.carX, 260, '#e9b96b');
  ctx.fillStyle = '#122735';
  ctx.fillRect(0, 0, 480, 30);
  text(
    ctx,
    env.t(['MEADOW', 'DUNES', 'MIDNIGHT'][region], ['草原', '沙丘', '午夜'][region]),
    12,
    10,
    '#e3d8bb',
    11,
  );
  text(ctx, `${Math.ceil(s.time)}s`, 240, 8, s.time < 15 ? '#ef9588' : '#f5dfaa', 14, 'center');
  text(ctx, `${s.health} ♥`, 462, 8, '#ef9588', 13, 'right');
  ctx.fillStyle = '#0e2530';
  ctx.fillRect(10, 307, 460, 6);
  ctx.fillStyle = '#eac27a';
  ctx.fillRect(10, 307, 460 * Math.min(1, s.distance / s.target), 6);
  text(ctx, `${Math.round(s.speed)} km/h`, 16, 285, '#f0e5bd', 10);
  if (Math.abs(s.carX - roadCurve(s.distance)) > 105) {
    text(ctx, env.t('OFF ROAD - SLOW', '驶离赛道 - 减速'), 240, 285, '#ffe195', 10, 'center');
  }
  text(ctx, `${s.collected} ${env.t('coins', '金币')}`, 465, 285, '#f0e5bd', 10, 'right');
}
meta.touchControls = [
  { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
  { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
  { code: 'ArrowUp', label: { en: 'Gas', zh: '加速' } },
  { code: 'ArrowDown', label: { en: 'Brake', zh: '刹车' } },
];

export function createGame(env) {
  const s = createRallyState(env);
  return {
    update: (dt, i) => stepRally(s, dt, i, env),
    draw: (ctx) => drawRally(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `${Math.floor(s.distance)} / ${s.target} m · ${s.health} hearts`,
        zh: `${Math.floor(s.distance)} / ${s.target} 米 · ${s.health} 颗心`,
      },
    }),
  };
}
