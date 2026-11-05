import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';
export const meta = {
  id: 'river-hop',
  name: { en: 'River Hop', zh: '青蛙过河' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
  ],
  description: {
    en: 'Reach all four lily homes in three rounds. Dodge traffic and ride floating logs before time runs out.',
    zh: '在三轮中抵达四个荷叶家园。避开车辆、搭乘浮木，并留意倒计时。',
  },
  keys: [{ label: { en: 'Hop one tile', zh: '跳跃一格' }, keys: 'Arrow keys / WASD' }],
};
const TOP = 30,
  STEP = 28;
export function riverLanes(round) {
  return [1, 2, 3, 5, 6, 7, 8].map((row, i) => {
    const water = row < 4,
      w = water ? [108, 96, 120][i] : [38, 56, 40, 66][i - 3],
      spacing = water ? 172 : [170, 210, 165, 230][i - 3],
      speed = (water ? [26, -32, 21][i] : [-50, 62, -72, 45][i - 3]) * (1 + (round - 1) * 0.18);
    return {
      row,
      water,
      speed,
      objects: Array.from({ length: Math.ceil((480 + w) / spacing) }, (_, n) => ({
        x: n * spacing + (i % 2 ? 65 : -20),
        w,
      })),
    };
  });
}
export function createRiverState() {
  return {
    phase: 'playing',
    score: 0,
    round: 1,
    lives: 4,
    frog: { x: 240, row: 9 },
    lanes: riverLanes(1),
    homes: [],
    timeLeft: 35,
    hopCooldown: 0,
    invulnerable: 0,
    minRow: 9,
    time: 0,
    splash: 0,
  };
}
function respawn(s) {
  s.frog = { x: 240, row: 9 };
  s.timeLeft = 35;
  s.minRow = 9;
  s.invulnerable = 1;
  s.splash = 0.55;
  s.hopCooldown = 0.18;
}
function hurt(s) {
  if (s.invulnerable > 0) return;
  s.lives--;
  if (s.lives <= 0) s.phase = 'lost';
  else respawn(s);
}
export function stepRiver(s, dt, input) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.timeLeft -= dt;
  s.hopCooldown = Math.max(0, s.hopCooldown - dt);
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.splash = Math.max(0, s.splash - dt);
  for (const lane of s.lanes)
    for (const object of lane.objects) {
      object.x += lane.speed * dt;
      if (object.x > 480 + object.w) object.x = -object.w;
      if (object.x < -object.w) object.x = 480;
    }
  if (s.hopCooldown <= 0) {
    let dx = 0,
      dy = 0;
    if (input.pressed('ArrowUp', 'KeyW')) dy = -1;
    else if (input.pressed('ArrowDown', 'KeyS')) dy = 1;
    else if (input.pressed('ArrowLeft', 'KeyA')) dx = -24;
    else if (input.pressed('ArrowRight', 'KeyD')) dx = 24;
    if (dx || dy) {
      s.frog.x = clamp(s.frog.x + dx, 12, 468);
      s.frog.row = clamp(s.frog.row + dy, 0, 9);
      s.hopCooldown = 0.12;
      if (s.frog.row < s.minRow) {
        s.score += 10;
        s.minRow = s.frog.row;
      }
    }
  }
  if (s.frog.row === 0) {
    const home = Math.floor(s.frog.x / 120),
      center = home * 120 + 60;
    if (Math.abs(s.frog.x - center) > 43 || s.homes.includes(home)) {
      hurt(s);
    } else {
      s.homes.push(home);
      s.score += 250 + Math.max(0, Math.floor(s.timeLeft)) * 5;
      if (s.homes.length === 4) {
        if (s.round === 3) {
          s.phase = 'won';
          return;
        }
        s.round++;
        s.homes = [];
        s.lanes = riverLanes(s.round);
        s.score += 500;
      }
      respawn(s);
    }
    return;
  }
  const lane = s.lanes.find((l) => l.row === s.frog.row);
  if (lane) {
    const object = lane.objects.find((o) => s.frog.x + 7 > o.x && s.frog.x - 7 < o.x + o.w);
    if (lane.water) {
      if (object) {
        s.frog.x += lane.speed * dt;
        if (s.frog.x < 7 || s.frog.x > 473) hurt(s);
      } else hurt(s);
    } else if (object) hurt(s);
  }
  if (s.timeLeft <= 0) hurt(s);
}
export function createGame(env) {
  const s = createRiverState();
  let ended = false,
    lastLives = s.lives,
    lastHomes = 0,
    lastScore = 0;
  return {
    update(dt, input) {
      stepRiver(s, dt, input);
      if (s.lives < lastLives) env.sound('hit');
      if (s.score > lastScore) {
        env.sound(s.homes.length !== lastHomes ? 'coin' : 'move');
      }
      lastLives = s.lives;
      lastHomes = s.homes.length;
      lastScore = s.score;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t('Every frog is home!', '所有青蛙都到家了！')
              : env.t('Watch the lanes and try again.', '看准车道，再试一次。'),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#172c2d');
      ctx.fillStyle = '#285444';
      ctx.fillRect(0, TOP, 480, 28);
      ctx.fillRect(0, TOP + 4 * STEP, 480, 28);
      ctx.fillRect(0, TOP + 9 * STEP, 480, 38);
      for (let i = 0; i < 4; i++) {
        const x = i * 120 + 60;
        ctx.fillStyle = '#0d343b';
        ctx.fillRect(x - 39, TOP + 3, 78, 23);
        ctx.fillStyle = s.homes.includes(i) ? '#a0dc7d' : '#5a9170';
        ctx.fillRect(x - 22, TOP + 8, 44, 15);
        ctx.fillRect(x - 15, TOP + 4, 30, 21);
        ctx.fillStyle = '#285444';
        ctx.fillRect(x + 2, TOP + 5, 5, 10);
        if (s.homes.includes(i))
          pixelSprite(ctx, ['A...A', 'AAAAA', 'A.A.A', '.AAA.'], x - 10, TOP + 8, 4, {
            A: '#e4f1a3',
          });
      }
      for (const lane of s.lanes) {
        const y = TOP + lane.row * STEP;
        ctx.fillStyle = lane.water ? '#24516a' : '#2c3444';
        ctx.fillRect(0, y, 480, 28);
        if (lane.water) {
          ctx.fillStyle = '#35627b';
          for (let x = -20; x < 480; x += 35)
            ctx.fillRect((x + Math.floor(s.time * lane.speed * 0.3)) % 510, y + 7, 12, 2);
        } else {
          ctx.fillStyle = '#777f7a';
          for (let x = 7; x < 480; x += 40) ctx.fillRect(x, y + 25, 20, 2);
        }
        for (const o of lane.objects) {
          if (lane.water) {
            ctx.fillStyle = '#735b44';
            ctx.fillRect(o.x, y + 4, o.w, 20);
            ctx.fillStyle = '#ab875b';
            ctx.fillRect(o.x + 3, y + 4, o.w - 6, 4);
            ctx.fillStyle = '#513f33';
            for (let x = o.x + 12; x < o.x + o.w; x += 22) ctx.fillRect(x, y + 6, 2, 14);
          } else {
            ctx.fillStyle = ['#f1b65a', '#dd7966', '#78a4bd', '#a4bd6a'][lane.row - 5];
            ctx.fillRect(o.x, y + 5, o.w, 18);
            ctx.fillStyle = '#b4d9db';
            ctx.fillRect(o.x + 8, y + 7, Math.min(17, o.w - 16), 6);
            ctx.fillStyle = '#111e2a';
            ctx.fillRect(o.x + 5, y + 3, 8, 3);
            ctx.fillRect(o.x + 5, y + 22, 8, 3);
            ctx.fillRect(o.x + o.w - 13, y + 3, 8, 3);
            ctx.fillRect(o.x + o.w - 13, y + 22, 8, 3);
          }
        }
      }
      if (s.invulnerable === 0 || Math.floor(s.time * 10) % 2 === 0) {
        pixelSprite(
          ctx,
          ['AA...AA', 'AAAAAAA', '.AAAAA.', 'AA.A.AA', 'AAAAAAA', '..AAA..', 'AA...AA'],
          s.frog.x - 10.5,
          TOP + s.frog.row * STEP + 4,
          3,
          { A: '#b2e87a' },
        );
        ctx.fillStyle = '#182f31';
        ctx.fillRect(s.frog.x - 7, TOP + s.frog.row * STEP + 7, 3, 3);
        ctx.fillRect(s.frog.x + 4, TOP + s.frog.row * STEP + 7, 3, 3);
      }
      ctx.fillStyle = '#122a2e';
      ctx.fillRect(0, 0, 480, 30);
      drawPixelText(ctx, env.t('ROUND', '轮次') + ' ' + s.round + '/3', 12, 9, '#b0d88c', 12);
      drawPixelText(
        ctx,
        env.t('TIME', '时间') + ' ' + Math.ceil(Math.max(0, s.timeLeft)),
        240,
        9,
        s.timeLeft < 10 ? '#ff9e6c' : '#e3d9ab',
        12,
        'center',
      );
      drawPixelText(ctx, env.t('LIVES', '生命') + ' ' + s.lives, 468, 9, '#b0d88c', 12, 'right');
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Round ${s.round}/3 · Homes ${s.homes.length}/4 · ${s.lives} lives`,
        zh: `轮次 ${s.round}/3 · 家园 ${s.homes.length}/4 · 生命 ${s.lives}`,
      },
    }),
  };
}
