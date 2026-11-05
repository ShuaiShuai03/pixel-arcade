import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'ember-knights',
  name: { en: 'Ember Knights', zh: '余烬骑士' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Duel a rival or the castle champion. Manage stamina, block attacks and win two rounds.',
    zh: '与朋友或城堡冠军决斗。管理体力、格挡攻击，赢下两回合。',
  },
  touchControls: [
    { code: 'KeyA', label: { en: 'Left', zh: '左' } },
    { code: 'KeyD', label: { en: 'Right', zh: '右' } },
    { code: 'KeyW', label: { en: 'Jump', zh: '跳' } },
    { code: 'KeyS', label: { en: 'Block', zh: '格挡' } },
    { code: 'KeyJ', label: { en: 'Strike', zh: '轻击' } },
    { code: 'KeyK', label: { en: 'Heavy', zh: '重击' } },
  ],
  keys: [
    {
      label: { en: 'P1 move / jump / block', zh: '玩家1 移动 / 跳跃 / 格挡' },
      keys: 'A D / W / S',
    },
    { label: { en: 'P1 quick / heavy attack', zh: '玩家1 轻击 / 重击' }, keys: 'J or Space / K' },
    {
      label: { en: 'P2 move / jump / block', zh: '玩家2 移动 / 跳跃 / 格挡' },
      keys: '← → / ↑ / ↓',
    },
    { label: { en: 'P2 quick / heavy attack', zh: '玩家2 轻击 / 重击' }, keys: ', / .' },
  ],
};

export function resolveStrike(attacker, target, type) {
  const range = type === 'heavy' ? 58 : 44;
  const dx = target.x - attacker.x;
  if (Math.abs(dx) > range || Math.abs(target.y - attacker.y) > 30 || dx * attacker.face < -4)
    return { hit: false, damage: 0, knock: 0 };
  const blocked = target.blocking && target.face * dx < 0;
  return {
    hit: true,
    damage: blocked ? (type === 'heavy' ? 4 : 2) : type === 'heavy' ? 16 : 10,
    knock: blocked ? 5 : 15,
  };
}

function fighter(x, face) {
  return {
    x,
    y: 260,
    vy: 0,
    face,
    health: 100,
    stamina: 100,
    blocking: false,
    cooldown: 0,
    stun: 0,
    attack: null,
    flash: 0,
  };
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    round = 1,
    remaining = 60,
    elapsed = 0,
    roundPause = 0,
    banner = '',
    winner = 0,
    aiClock = 0.6;
  let fighters = [fighter(130, 1), fighter(350, -1)];
  const wins = [0, 0];
  let sparks = [];

  function finish(index, draw = false) {
    if (phase !== 'playing') return;
    winner = draw ? 0 : index + 1;
    phase = index === 0 && !draw ? 'won' : 'lost';
    env.sound(phase === 'won' ? 'win' : 'lose');
    env.end({
      won: phase === 'won',
      score,
      message: draw
        ? env.t('An even match! The duel ends in a draw.', '势均力敌！本场决斗平局。')
        : env.t(`Player ${index + 1} is the castle champion!`, `玩家${index + 1}成为城堡冠军！`),
    });
  }
  function closeRound(index) {
    if (roundPause > 0) return;
    if (index >= 0) {
      wins[index]++;
      score += index === 0 ? 500 + Math.round(fighters[0].health * 5) : 0;
      banner = env.t(`PLAYER ${index + 1} WINS`, `玩家${index + 1}获胜`);
    } else banner = env.t('ROUND DRAW', '回合平局');
    if (wins.some((w) => w === 2)) {
      finish(wins[0] === 2 ? 0 : 1);
      return;
    }
    if (round === 5) {
      finish(wins[0] > wins[1] ? 0 : 1, wins[0] === wins[1]);
      return;
    }
    roundPause = 1.7;
    env.sound('win');
  }
  function attack(f, type) {
    const cost = type === 'heavy' ? 24 : 9;
    if (f.cooldown > 0 || f.stun > 0 || f.stamina < cost || f.blocking) return;
    f.stamina -= cost;
    f.cooldown = type === 'heavy' ? 0.78 : 0.38;
    f.attack = {
      type,
      clock: type === 'heavy' ? 0.18 : 0.06,
      spent: false,
      remaining: type === 'heavy' ? 0.45 : 0.22,
    };
    env.sound('shoot');
  }

  return {
    update(dt, input) {
      if (phase !== 'playing') return;
      elapsed += dt;
      sparks = sparks.filter((s) => (s.life -= dt) > 0);
      if (roundPause > 0) {
        roundPause -= dt;
        if (roundPause <= 0) {
          round++;
          fighters = [fighter(130, 1), fighter(350, -1)];
          remaining = 60;
          aiClock = 0.6;
        }
        return;
      }
      remaining -= dt;
      aiClock -= dt;
      const a = fighters[0],
        b = fighters[1];
      const aiDistance = Math.abs(a.x - b.x);
      const aiBlock = a.attack && b.stamina > 15 && aiDistance < 70 && Math.sin(elapsed * 6) > 0.25;
      const controls = [
        {
          move: Number(input.held('KeyD')) - Number(input.held('KeyA')),
          jump: input.pressed('KeyW') || input.held('KeyW'),
          block: input.held('KeyS'),
          light: input.held('KeyJ', 'Space'),
          heavy: input.held('KeyK'),
        },
        env.mode === 2
          ? {
              move: Number(input.held('ArrowRight')) - Number(input.held('ArrowLeft')),
              jump: input.pressed('ArrowUp') || input.held('ArrowUp'),
              block: input.held('ArrowDown'),
              light: input.held('Comma'),
              heavy: input.held('Period'),
            }
          : {
              move: aiDistance > 38 ? Math.sign(a.x - b.x) : 0,
              jump: b.stun > 0 && b.y === 260 && env.random() < 0.01,
              block: !!aiBlock,
              light: aiClock <= 0,
              heavy: aiClock <= 0 && env.random() < 0.3,
            },
      ];
      if (env.mode !== 2 && aiClock <= 0) aiClock = 0.55 + env.random() * 0.5;
      for (let i = 0; i < 2; i++) {
        const f = fighters[i],
          other = fighters[1 - i],
          c = controls[i];
        f.face = other.x >= f.x ? 1 : -1;
        f.cooldown = Math.max(0, f.cooldown - dt);
        f.stun = Math.max(0, f.stun - dt);
        f.flash = Math.max(0, f.flash - dt);
        f.blocking = c.block && f.stamina > 0 && f.y >= 259 && f.stun <= 0 && !f.attack;
        f.stamina = clamp(f.stamina + (f.blocking ? -10 : 17) * dt, 0, 100);
        if (f.stun <= 0) {
          f.x = clamp(f.x + c.move * (f.blocking ? 35 : f.attack ? 45 : 105) * dt, 22, 458);
          if (c.jump && f.y === 260 && !f.blocking) {
            f.vy = -240;
            env.sound('move');
          }
          if (c.heavy) attack(f, 'heavy');
          else if (c.light) attack(f, 'light');
        }
        f.vy += 640 * dt;
        f.y = Math.min(260, f.y + f.vy * dt);
        if (f.y === 260) f.vy = 0;
      }
      if (Math.abs(a.x - b.x) < 26 && Math.abs(a.y - b.y) < 26) {
        const middle = (a.x + b.x) / 2;
        const sign = a.x <= b.x ? 1 : -1;
        a.x = clamp(middle - 13 * sign, 22, 458);
        b.x = clamp(middle + 13 * sign, 22, 458);
      }
      for (let i = 0; i < 2; i++) {
        const f = fighters[i],
          target = fighters[1 - i];
        if (!f.attack) continue;
        f.attack.clock -= dt;
        f.attack.remaining -= dt;
        if (f.attack.clock <= 0 && !f.attack.spent) {
          f.attack.spent = true;
          const hit = resolveStrike(f, target, f.attack.type);
          if (hit.hit) {
            target.health = Math.max(0, target.health - hit.damage);
            target.x = clamp(target.x + f.face * hit.knock, 22, 458);
            target.stun = target.blocking ? 0.08 : 0.16;
            target.flash = 0.14;
            if (target.blocking) target.stamina = Math.max(0, target.stamina - 12);
            if (i === 0) score += hit.damage;
            env.sound('hit');
            for (let n = 0; n < 7; n++)
              sparks.push({
                x: target.x + (env.random() - 0.5) * 20,
                y: target.y - 15 + (env.random() - 0.5) * 20,
                life: 0.16,
                blocked: target.blocking,
              });
          }
        }
        if (f.attack.remaining <= 0) f.attack = null;
      }
      if (a.health <= 0 || b.health <= 0)
        closeRound(a.health === b.health ? -1 : a.health > b.health ? 0 : 1);
      else if (remaining <= 0) closeRound(a.health === b.health ? -1 : a.health > b.health ? 0 : 1);
    },
    draw(ctx) {
      background(ctx, '#252a39');
      ctx.fillStyle = '#a6524c';
      ctx.fillRect(0, 74, 480, 148);
      ctx.fillStyle = '#e09c64';
      ctx.fillRect(304, 84, 55, 55);
      ctx.fillRect(311, 77, 41, 69);
      ctx.fillStyle = '#3f3d4b';
      for (let x = 0; x < 480; x += 47) {
        const h = 30 + ((x * 7) % 50);
        ctx.fillRect(x, 222 - h, 35, h);
        ctx.fillRect(x + 3, 211 - h, 6, 14);
        ctx.fillRect(x + 25, 211 - h, 6, 14);
      }
      ctx.fillStyle = '#262c3a';
      ctx.fillRect(0, 222, 480, 50);
      for (const x of [14, 440]) {
        ctx.fillStyle = '#676174';
        ctx.fillRect(x, 116, 25, 158);
        ctx.fillRect(x - 4, 116, 33, 10);
        ctx.fillStyle = '#fead51';
        ctx.fillRect(x + 6, 150, 10, 16);
        ctx.fillStyle = '#ffe1a1';
        ctx.fillRect(x + 8, 153 + Math.sin(elapsed * 12) * 3, 6, 10);
      }
      ctx.fillStyle = '#807680';
      ctx.fillRect(0, 260, 480, 8);
      ctx.fillStyle = '#4c4b60';
      ctx.fillRect(0, 268, 480, 52);
      for (let y = 270; y < 320; y += 15)
        for (let x = (y % 2) * 22; x < 480; x += 44) {
          ctx.strokeStyle = '#686273';
          ctx.strokeRect(x, y, 42, 13);
        }
      for (let i = 0; i < 2; i++) {
        const f = fighters[i];
        const color = f.flash > 0 ? '#fff1c8' : i === 0 ? '#62d9c8' : '#ee8b74';
        const x = Math.round(f.x),
          y = Math.round(f.y);
        ctx.fillStyle = '#1d233080';
        ctx.fillRect(x - 16, 260, 32, 4);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(f.face, 1);
        pixelSprite(
          ctx,
          [
            '...aaaa...',
            '..aaaaaa..',
            '..abbbaa..',
            '...bbb....',
            '..cccccc..',
            '.ccccccc..',
            '..cccc....',
            '..c..c....',
            '.dd..dd...',
          ],
          -10,
          -36,
          2,
          { a: '#d4d5d7', b: '#384452', c: color, d: '#283543' },
        );
        ctx.fillStyle = '#d6e2e5';
        const length = f.attack ? (f.attack.type === 'heavy' ? 34 : 26) : 14;
        ctx.fillRect(8, f.attack ? -26 : -22, length, 4);
        ctx.fillStyle = '#f0bf6a';
        ctx.fillRect(8, -30, 4, 12);
        if (f.blocking) {
          ctx.fillStyle = '#f3c778';
          ctx.fillRect(10, -30, 6, 22);
          ctx.fillStyle = '#758ba0';
          ctx.fillRect(11, -27, 4, 16);
        }
        ctx.restore();
      }
      for (const s of sparks) {
        ctx.fillStyle = s.blocked ? '#b3eeff' : '#ffd294';
        ctx.fillRect(s.x, s.y, 3, 3);
      }
      ctx.fillStyle = '#171e2c';
      ctx.fillRect(0, 0, 480, 69);
      for (let i = 0; i < 2; i++) {
        const f = fighters[i],
          x = i === 0 ? 15 : 285;
        ctx.fillStyle = '#414253';
        ctx.fillRect(x, 25, 180, 13);
        ctx.fillStyle = i === 0 ? '#62d9c8' : '#ee8b74';
        ctx.fillRect(x, 25, (180 * f.health) / 100, 13);
        ctx.fillStyle = '#e9bf68';
        ctx.fillRect(x, 41, (180 * f.stamina) / 100, 3);
        drawPixelText(
          ctx,
          `${env.t('PLAYER', '玩家')} ${i + 1}${i === 1 && env.mode !== 2 ? ' CPU' : ''}`,
          x,
          8,
          '#e6e0d3',
          10,
        );
        for (let w = 0; w < 2; w++) {
          ctx.fillStyle = wins[i] > w ? '#ffd477' : '#525064';
          ctx.fillRect(x + w * 14, 52, 9, 8);
        }
      }
      drawPixelText(
        ctx,
        String(Math.max(0, Math.ceil(remaining))),
        240,
        26,
        '#f3e3c7',
        20,
        'center',
      );
      drawPixelText(ctx, `${env.t('ROUND', '回合')} ${round}`, 240, 53, '#e4cbb0', 9, 'center');
      if (roundPause > 0) {
        ctx.fillStyle = '#171e2ce8';
        ctx.fillRect(70, 130, 340, 45);
        drawPixelText(ctx, banner, 240, 144, '#ffd477', 18, 'center');
      }
    },
    getState() {
      return {
        phase,
        score,
        round,
        remaining,
        wins: [...wins],
        winner,
        fighters: fighters.map((f) => ({ ...f, attack: f.attack ? { ...f.attack } : null })),
        status: {
          en: `Round ${round} · ${wins[0]} : ${wins[1]} · First to 2`,
          zh: `回合 ${round} · ${wins[0]} : ${wins[1]} · 先赢2回合`,
        },
      };
    },
  };
}
