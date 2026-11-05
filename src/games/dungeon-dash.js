import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';
export const meta = {
  id: 'dungeon-dash',
  name: { en: 'Dungeon Dash', zh: '地牢冲刺' },
  description: {
    en: 'Explore five chambers. Defeat the guardians, collect the key, then enter the glowing exit. Pick up potions to heal.',
    zh: '探索五个房间，击败守卫、找到钥匙，再走进发光的出口。拾取药水恢复生命。',
  },
  genre: 'action',
  players: '1',
  touch: true,
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'WASD / Arrows' },
    { label: { en: 'Swing sword', zh: '挥剑' }, keys: 'Space / J' },
  ],
};
const pos = (x, y) => ({ x: 30 + x * 20, y: 40 + y * 20 });
export function buildRoom(room) {
  const tiles = Array.from({ length: 14 }, (_, y) =>
    Array.from({ length: 22 }, (_, x) => +(y === 0 || y === 13 || x === 0 || x === 21)),
  );
  for (let x = 5; x <= 16; x++) if (x !== 8 + (room % 3)) tiles[4][x] = 1;
  for (let x = 4; x <= 17; x++) if (x !== 6 + (room % 3) && x !== 14) tiles[8][x] = 1;
  for (let y = 5; y <= 11; y++) if (y !== 6 && y !== 10) tiles[y][12] = 1;
  return {
    tiles,
    key: pos(2, 2),
    exit: pos(19, 1),
    treasures: [pos(4, 2), pos(17, 11), pos(18, 5)],
    potions: [pos(5, 10)],
  };
}
function enterRoom(s, room) {
  const data = buildRoom(room);
  Object.assign(s, data);
  s.room = room;
  s.player = { ...pos(2, 11), facing: 1 };
  s.hasKey = false;
  s.enemies = Array.from({ length: 2 + room }, (_, n) => ({
    ...pos([9, 17, 18, 4, 16, 8, 19][n], [2, 6, 11, 6, 2, 10, 10][n]),
    hp: room < 3 ? 2 : 3,
    speed: 34 + room * 4 + (n % 2) * 7,
    hit: 0,
  }));
  s.attack = 0;
  s.pathTimer = 0;
  s.path = [];
  s.invulnerable = 0.8;
}
export function createDungeonState() {
  const s = {
    phase: 'playing',
    score: 0,
    room: 1,
    health: 5,
    kills: 0,
    attack: 0,
    cooldown: 0,
    invulnerable: 0,
    time: 0,
  };
  enterRoom(s, 1);
  return s;
}
function cellAt(x, y) {
  return [Math.floor((x - 20) / 20), Math.floor((y - 30) / 20)];
}
function blocked(s, x, y, r = 6) {
  for (const dx of [-r, r])
    for (const dy of [-r, r]) {
      const [cx, cy] = cellAt(x + dx, y + dy);
      if (s.tiles[cy]?.[cx] !== 0) return true;
    }
  return false;
}
function move(s, who, dx, dy) {
  if (!blocked(s, who.x + dx, who.y)) who.x += dx;
  if (!blocked(s, who.x, who.y + dy)) who.y += dy;
}
function pathField(s) {
  const [cx, cy] = cellAt(s.player.x, s.player.y);
  const d = Array.from({ length: 14 }, () => Array(22).fill(1000));
  d[cy][cx] = 0;
  const q = [[cx, cy]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (s.tiles[y + dy]?.[x + dx] === 0 && d[y + dy][x + dx] > d[y][x] + 1) {
        d[y + dy][x + dx] = d[y][x] + 1;
        q.push([x + dx, y + dy]);
      }
  }
  return d;
}
function end(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All five chambers cleared. The vault is yours!'
        : 'The guardians caught you. Keep your sword swinging.',
      won ? '五个房间全部通过，宝库属于你！' : '你被守卫击败了，记得持续挥剑。',
    ),
  });
}
export function stepDungeon(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  if (s.health <= 0) {
    end(s, env, false);
    return;
  }
  s.time += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.attack = Math.max(0, s.attack - dt);
  s.pathTimer -= dt;
  let dx = Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA')),
    dy = Number(i.held('ArrowDown', 'KeyS')) - Number(i.held('ArrowUp', 'KeyW'));
  if (dx || dy) {
    const scale = (100 * dt) / Math.hypot(dx, dy);
    move(s, s.player, dx * scale, dy * scale);
    if (dx) s.player.facing = Math.sign(dx);
  }
  if ((i.held('Space', 'KeyJ') || i.pressed('Space', 'KeyJ')) && s.cooldown === 0) {
    s.cooldown = 0.32;
    s.attack = 0.18;
    env.sound('shoot');
    for (const e of s.enemies)
      if (
        Math.hypot(e.x - s.player.x, e.y - s.player.y) < 42 &&
        !blocked(s, (e.x + s.player.x) / 2, (e.y + s.player.y) / 2, 0)
      ) {
        e.hp--;
        e.hit = 0.15;
        const n = Math.hypot(e.x - s.player.x, e.y - s.player.y) || 1;
        move(s, e, ((e.x - s.player.x) * 8) / n, ((e.y - s.player.y) * 8) / n);
      }
  }
  const dead = s.enemies.filter((e) => e.hp <= 0);
  if (dead.length) {
    s.kills += dead.length;
    s.score += dead.length * 100;
    env.sound('coin');
  }
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  if (s.pathTimer <= 0) {
    s.path = pathField(s);
    s.pathTimer = 0.2;
  }
  for (const e of s.enemies) {
    e.hit = Math.max(0, e.hit - dt);
    const [cx, cy] = cellAt(e.x, e.y);
    let target = s.player;
    let lowest = s.path[cy]?.[cx] ?? 1000;
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const d = s.path[cy + oy]?.[cx + ox] ?? 1000;
      if (d < lowest) {
        lowest = d;
        target = pos(cx + ox, cy + oy);
      }
    }
    const ex = target.x - e.x,
      ey = target.y - e.y,
      dist = Math.hypot(ex, ey);
    if (dist > 1 && e.hit <= 0) move(s, e, (ex / dist) * e.speed * dt, (ey / dist) * e.speed * dt);
    if (Math.hypot(e.x - s.player.x, e.y - s.player.y) < 17 && s.invulnerable === 0) {
      s.health--;
      s.invulnerable = 1.1;
      env.sound('hit');
    }
  }
  for (const list of ['treasures', 'potions'])
    s[list] = s[list].filter((p) => {
      if (Math.hypot(p.x - s.player.x, p.y - s.player.y) > 15) return true;
      if (list === 'treasures') {
        s.score += 60;
        env.sound('coin');
      } else {
        s.health = Math.min(5, s.health + 2);
        env.sound('win');
      }
      return false;
    });
  if (!s.hasKey && Math.hypot(s.key.x - s.player.x, s.key.y - s.player.y) < 15) {
    s.hasKey = true;
    s.score += 100;
    env.sound('coin');
  }
  if (s.health <= 0) {
    end(s, env, false);
    return;
  }
  if (
    s.hasKey &&
    s.enemies.length === 0 &&
    Math.hypot(s.exit.x - s.player.x, s.exit.y - s.player.y) < 16
  ) {
    s.score += 500;
    if (s.room === 5) {
      end(s, env, true);
      return;
    }
    s.health = Math.min(5, s.health + 1);
    enterRoom(s, s.room + 1);
    env.sound('win');
  }
}
const hero = [
  '..1111..',
  '.122221.',
  '.123321.',
  '..2222..',
  '.444444.',
  '44544544',
  '..4444..',
  '..5..5..',
];
function drawDungeon(ctx, s, env) {
  background(ctx, '#101e26');
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 22; x++) {
      const px = 20 + x * 20,
        py = 30 + y * 20;
      if (s.tiles[y][x]) {
        ctx.fillStyle = '#34474a';
        ctx.fillRect(px, py, 20, 20);
        ctx.fillStyle = '#536263';
        ctx.fillRect(px, py, 20, 3);
        ctx.fillStyle = '#1e3038';
        ctx.fillRect(px, py + 17, 20, 3);
        ctx.fillRect(px + 17, py + 4, 3, 13);
      } else {
        ctx.fillStyle = (x + y) % 2 ? '#1d3236' : '#20383a';
        ctx.fillRect(px, py, 20, 20);
        ctx.fillStyle = '#294144';
        ctx.fillRect(px + 3, py + 15, 5, 1);
      }
    }
  const exitReady = s.hasKey && s.enemies.length === 0;
  ctx.fillStyle = exitReady ? '#90cbb1' : '#3b5e5d';
  ctx.fillRect(s.exit.x - 9, s.exit.y - 10, 18, 20);
  ctx.fillStyle = '#12232d';
  ctx.fillRect(s.exit.x - 5, s.exit.y - 7, 10, 17);
  if (exitReady) {
    ctx.fillStyle = '#e1d79b';
    ctx.fillRect(s.exit.x - 3, s.exit.y - 5, 6, 15);
  }
  for (const p of s.treasures) {
    ctx.fillStyle = '#dca955';
    ctx.fillRect(p.x - 5, p.y - 4, 10, 8);
    ctx.fillStyle = '#ffe098';
    ctx.fillRect(p.x - 2, p.y - 3, 3, 6);
  }
  for (const p of s.potions) {
    ctx.fillStyle = '#d2e5d1';
    ctx.fillRect(p.x - 3, p.y - 7, 6, 4);
    ctx.fillStyle = '#db7f73';
    ctx.fillRect(p.x - 5, p.y - 3, 10, 10);
    ctx.fillStyle = '#eebba1';
    ctx.fillRect(p.x - 2, p.y - 1, 3, 5);
  }
  if (!s.hasKey) {
    ctx.fillStyle = '#f3d186';
    ctx.fillRect(s.key.x - 6, s.key.y - 5, 8, 8);
    ctx.fillRect(s.key.x, s.key.y - 2, 9, 3);
    ctx.fillRect(s.key.x + 6, s.key.y, 3, 4);
  }
  for (const e of s.enemies) {
    ctx.fillStyle = '#12232b';
    ctx.fillRect(e.x - 10, e.y + 6, 20, 5);
    ctx.fillStyle = e.hit > 0 ? '#f8e0c7' : s.room < 3 ? '#8ab383' : '#b78276';
    ctx.fillRect(e.x - 7, e.y - 7, 14, 14);
    ctx.fillRect(e.x - 9, e.y, 18, 7);
    ctx.fillStyle = '#20333a';
    ctx.fillRect(e.x - 4, e.y - 3, 3, 3);
    ctx.fillRect(e.x + 2, e.y - 3, 3, 3);
    for (let n = 0; n < e.hp; n++) {
      ctx.fillStyle = '#d19677';
      ctx.fillRect(e.x - 7 + n * 5, e.y - 13, 3, 2);
    }
  }
  ctx.fillStyle = '#12232b';
  ctx.fillRect(s.player.x - 10, s.player.y + 8, 20, 5);
  if (s.invulnerable === 0 || Math.floor(s.invulnerable * 12) % 2 === 0)
    pixelSprite(ctx, hero, s.player.x - 8, s.player.y - 10, 2, {
      1: '#d3b17c',
      2: '#ebcd9c',
      3: '#1c3842',
      4: '#6eafb0',
      5: '#a8b8a7',
    });
  if (s.attack > 0) {
    ctx.strokeStyle = '#f7e2a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.player.x, s.player.y, 28, -0.4 + s.player.facing, 2.2 + s.player.facing);
    ctx.stroke();
  }
  text(ctx, env.t(`CHAMBER ${s.room}/5`, `房间 ${s.room}/5`), 20, 9, '#c8cdb6', 11);
  text(ctx, `${s.health} ♥`, 240, 8, '#df9986', 13, 'center');
  text(
    ctx,
    env.t(
      `${s.enemies.length} guardians · ${s.hasKey ? 'KEY ✓' : 'Find key'}`,
      `${s.enemies.length}名守卫 · ${s.hasKey ? '已有钥匙' : '寻找钥匙'}`,
    ),
    460,
    9,
    '#b7c6ad',
    10,
    'right',
  );
}
meta.touchControls = [
  { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
  { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
  { code: 'ArrowUp', label: { en: 'Up', zh: '上' } },
  { code: 'ArrowDown', label: { en: 'Down', zh: '下' } },
  { code: 'Space', label: { en: 'Attack', zh: '攻击' } },
];

export function createGame(env) {
  const s = createDungeonState();
  return {
    update: (dt, i) => stepDungeon(s, dt, i, env),
    draw: (ctx) => drawDungeon(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Chamber ${s.room}/5 · ${s.health} hearts · ${s.enemies.length} guardians`,
        zh: `房间 ${s.room}/5 · ${s.health}颗心 · ${s.enemies.length}名守卫`,
      },
    }),
  };
}
