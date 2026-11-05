import { drawPixelText, pixelSprite, background } from '../shared/utils.js';

export const meta = {
  id: 'bomb-garden',
  name: { en: 'Bomb Garden', zh: '炸弹花园' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Plant bombs, escape their cross-shaped blasts and clear three gardens. Pick up extra range and bomb capacity. Or duel a friend!',
    zh: '放置炸弹，躲开十字爆炸，清空三座花园。拾取火力和炸弹容量道具，也可与好友对战！',
  },
  touchControls: [
    { code: 'KeyA', label: { en: 'Left', zh: '左' } },
    { code: 'KeyD', label: { en: 'Right', zh: '右' } },
    { code: 'KeyW', label: { en: 'Up', zh: '上' } },
    { code: 'KeyS', label: { en: 'Down', zh: '下' } },
    { code: 'Space', label: { en: 'Bomb', zh: '炸弹' } },
  ],
  keys: [
    {
      label: { en: 'P1 move / bomb', zh: '玩家1 移动 / 炸弹' },
      keys: {
        en: 'WASD (solo: also arrows) / Space or J',
        zh: 'WASD（单人也可用方向键）/ 空格或 J',
      },
    },
    {
      label: { en: 'P2 move / bomb (duel)', zh: '玩家2 移动 / 炸弹（对战）' },
      keys: { en: 'Arrows / Enter or /', zh: '方向键 / 回车或 /' },
    },
  ],
};

const COLS = 15,
  ROWS = 9,
  CELL = 30,
  OX = 15,
  OY = 42;
const DIRS = [
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 0],
];
const BODY = [
  '..aaaa..',
  '.aaaaaa.',
  '.abbbba.',
  '.abccba.',
  '..dddd..',
  '.dddddd.',
  '..d..d..',
  '.ee..ee.',
];

/** Walls absorb blasts; a destructible crate is included and then stops the ray. */
export function blastCells(board, x, y, range) {
  const cells = [[x, y]];
  for (const [dx, dy] of DIRS)
    for (let n = 1; n <= range; n++) {
      const nx = x + dx * n,
        ny = y + dy * n;
      if (!board[ny] || board[ny][nx] === undefined || board[ny][nx] === 1) break;
      cells.push([nx, ny]);
      if (board[ny][nx] === 2) break;
    }
  return cells;
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    level = 1,
    time = 100,
    elapsed = 0,
    transition = 0,
    nextId = 0;
  let board,
    players,
    enemies,
    bombs = [],
    flames = [],
    pickups = [],
    particles = [];

  function actor(x, y, id, ai = false) {
    return {
      x,
      y,
      id,
      ai,
      alive: true,
      range: 2,
      capacity: 1,
      speed: ai ? 0.23 : 0.13,
      moveClock: 0,
      bombClock: 1 + env.random() * 2,
    };
  }
  function newGarden() {
    time = 100;
    bombs = [];
    flames = [];
    pickups = [];
    board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0))
          return 1;
        return env.random() < 0.48 ? 2 : 0;
      }),
    );
    const spawn = [
      [1, 1],
      [13, 7],
      [13, 1],
      [1, 7],
      [7, 7],
    ];
    for (const [x, y] of spawn)
      for (const [dx, dy] of [[0, 0], ...DIRS])
        if (board[y + dy]?.[x + dx] === 2) board[y + dy][x + dx] = 0;
    board[1][3] = 2;
    board[3][1] = 2;
    players = [actor(1, 1, 0)];
    if (env.mode === 2) {
      players.push(actor(13, 7, 1));
      enemies = [];
    } else enemies = spawn.slice(1, 2 + level).map(([x, y], i) => actor(x, y, i + 2, true));
  }
  newGarden();

  function finish(won, message) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score, message });
  }
  function canMove(x, y, a) {
    return (
      board[y]?.[x] === 0 &&
      !bombs.some((b) => b.x === x && b.y === y) &&
      ![...players, ...enemies].some((p) => p !== a && p.alive && p.x === x && p.y === y)
    );
  }
  function plant(a) {
    if (
      !a.alive ||
      bombs.some((b) => b.x === a.x && b.y === a.y) ||
      bombs.filter((b) => b.owner === a.id).length >= a.capacity
    )
      return;
    bombs.push({ id: nextId++, x: a.x, y: a.y, range: a.range, fuse: 2.25, owner: a.id });
    env.sound('shoot');
  }
  function explode(bomb) {
    if (!bombs.includes(bomb)) return;
    bombs = bombs.filter((b) => b !== bomb);
    const cells = blastCells(board, bomb.x, bomb.y, bomb.range);
    flames.push({ cells, life: 0.45 });
    env.sound('hit');
    for (const [x, y] of cells) {
      if (board[y][x] === 2) {
        board[y][x] = 0;
        if (bomb.owner === 0) score += 10;
        if (env.random() < 0.28)
          pickups.push({ x, y, type: env.random() < 0.55 ? 'range' : 'capacity' });
        for (let n = 0; n < 5; n++)
          particles.push({
            x: OX + x * CELL + 15,
            y: OY + y * CELL + 15,
            vx: (env.random() - 0.5) * 100,
            vy: -env.random() * 100,
            life: 0.4,
          });
      } else pickups = pickups.filter((p) => p.x !== x || p.y !== y);
      for (const other of [...bombs]) if (other.x === x && other.y === y) explode(other);
    }
  }
  function dangerSet() {
    return new Set(
      [
        ...bombs.flatMap((b) => blastCells(board, b.x, b.y, b.range)),
        ...flames.flatMap((f) => f.cells),
      ].map(([x, y]) => `${x},${y}`),
    );
  }
  function safeStep(a, danger) {
    const queue = [{ x: a.x, y: a.y, first: null, distance: 0 }],
      visited = new Set([`${a.x},${a.y}`]);
    while (queue.length) {
      const p = queue.shift();
      if (p.first && !danger.has(`${p.x},${p.y}`)) return p.first;
      if (p.distance >= 6) continue;
      for (const [dx, dy] of DIRS) {
        const x = p.x + dx,
          y = p.y + dy,
          key = `${x},${y}`;
        if (!visited.has(key) && canMove(x, y, a)) {
          visited.add(key);
          queue.push({ x, y, first: p.first || [dx, dy], distance: p.distance + 1 });
        }
      }
    }
    return null;
  }
  function walk(a, dx, dy) {
    if (!a.alive || a.moveClock > 0 || (!dx && !dy)) return;
    a.moveClock = a.speed;
    if (canMove(a.x + dx, a.y + dy, a)) {
      a.x += dx;
      a.y += dy;
    }
  }

  return {
    update(dt, input) {
      if (phase !== 'playing') return;
      elapsed += dt;
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 200 * dt;
      }
      if (transition > 0) {
        transition -= dt;
        if (transition <= 0) {
          level++;
          if (level > 3) {
            level = 3;
            finish(true, env.t('All three gardens are clear!', '三座花园全部清空！'));
          } else newGarden();
        }
        return;
      }
      time -= dt;
      if (time <= 0) {
        finish(false, env.t('Time is up! Try a quicker route.', '时间到了！试试更快的路线。'));
        return;
      }
      for (const a of [...players, ...enemies]) {
        a.moveClock -= dt;
        a.bombClock -= dt;
      }
      for (let i = 0; i < players.length; i++) {
        const a = players[i];
        let dx = 0,
          dy = 0;
        if (i === 0) {
          dx =
            Number(input.held('KeyD', ...(env.mode === 2 ? [] : ['ArrowRight']))) -
            Number(input.held('KeyA', ...(env.mode === 2 ? [] : ['ArrowLeft'])));
          dy =
            Number(input.held('KeyS', ...(env.mode === 2 ? [] : ['ArrowDown']))) -
            Number(input.held('KeyW', ...(env.mode === 2 ? [] : ['ArrowUp'])));
          if (input.pressed('Space', 'KeyJ')) plant(a);
        } else {
          dx = Number(input.held('ArrowRight')) - Number(input.held('ArrowLeft'));
          dy = Number(input.held('ArrowDown')) - Number(input.held('ArrowUp'));
          if (input.pressed('Enter', 'Slash')) plant(a);
        }
        walk(a, dx, dx ? 0 : dy);
      }
      const danger = dangerSet();
      for (const a of enemies) {
        if (!a.alive) continue;
        if (a.moveClock <= 0) {
          let direction;
          if (danger.has(`${a.x},${a.y}`)) direction = safeStep(a, danger);
          else {
            const options = DIRS.filter(
              ([dx, dy]) =>
                canMove(a.x + dx, a.y + dy, a) && !danger.has(`${a.x + dx},${a.y + dy}`),
            );
            if (options.length) direction = options[Math.floor(env.random() * options.length)];
          }
          if (direction) walk(a, ...direction);
          else a.moveClock = a.speed;
        }
        const nearCrate = DIRS.some(([dx, dy]) => board[a.y + dy]?.[a.x + dx] === 2);
        const nearPlayer = Math.abs(a.x - players[0].x) + Math.abs(a.y - players[0].y) < 5;
        if (a.bombClock <= 0 && !danger.has(`${a.x},${a.y}`) && (nearCrate || nearPlayer)) {
          plant(a);
          a.bombClock = 2.6 + env.random() * 2;
        }
      }
      for (const b of [...bombs]) {
        b.fuse -= dt;
        if (b.fuse <= 0) explode(b);
      }
      flames = flames.filter((f) => (f.life -= dt) > 0);
      for (const a of [...players, ...enemies]) {
        if (!a.alive) continue;
        if (flames.some((f) => f.cells.some(([x, y]) => x === a.x && y === a.y))) {
          a.alive = false;
          if (a.ai) score += 150;
          env.sound('hit');
        }
        const p = pickups.find((p) => p.x === a.x && p.y === a.y);
        if (p) {
          if (p.type === 'range') a.range = Math.min(5, a.range + 1);
          else a.capacity = Math.min(4, a.capacity + 1);
          pickups = pickups.filter((item) => item !== p);
          if (a.id === 0) score += 25;
          env.sound('coin');
        }
      }
      if (env.mode === 2) {
        if (players.some((p) => !p.alive)) {
          const living = players.filter((p) => p.alive);
          finish(
            players[0].alive,
            living.length
              ? env.t(
                  `Player ${living[0].id + 1} wins the garden!`,
                  `玩家${living[0].id + 1}赢得花园对决！`,
                )
              : env.t('A double knockout! The garden is a draw.', '双双出局！花园对决平局。'),
          );
        }
      } else if (!players[0].alive)
        finish(
          false,
          env.t(
            'Caught in the blast! Leave yourself an escape path.',
            '被爆炸击中！记得留下逃生路线。',
          ),
        );
      else if (enemies.every((e) => !e.alive)) {
        transition = 1.3;
        score += Math.ceil(time) * 3;
        env.sound('win');
      }
    },
    draw(ctx) {
      background(ctx, '#183b35');
      ctx.fillStyle = '#0f282b';
      ctx.fillRect(0, 0, 480, 36);
      drawPixelText(ctx, `${env.t('GARDEN', '花园')} ${level}/3`, 16, 11, '#d8eab7', 12);
      drawPixelText(
        ctx,
        `${env.t('RANGE', '火力')} ${players[0].range}  ${env.t('BOMBS', '炸弹')} ${players[0].capacity}`,
        170,
        12,
        '#a6d6b5',
        10,
      );
      drawPixelText(
        ctx,
        `${Math.max(0, Math.ceil(time))}s`,
        462,
        11,
        time < 20 ? '#ff9a76' : '#f5edc6',
        12,
        'right',
      );
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const px = OX + x * CELL,
            py = OY + y * CELL;
          ctx.fillStyle = (x + y) % 2 ? '#265347' : '#2b5b4b';
          ctx.fillRect(px, py, CELL, CELL);
          if (board[y][x] === 1) {
            ctx.fillStyle = '#5b7a6c';
            ctx.fillRect(px + 1, py + 1, 28, 28);
            ctx.fillStyle = '#9bb8a0';
            ctx.fillRect(px + 2, py + 2, 25, 5);
            ctx.fillStyle = '#3b5b53';
            ctx.fillRect(px + 4, py + 11, 8, 3);
            ctx.fillRect(px + 17, py + 21, 8, 3);
          }
          if (board[y][x] === 2) {
            ctx.fillStyle = '#654b36';
            ctx.fillRect(px + 2, py + 5, 26, 24);
            ctx.fillStyle = '#bc9359';
            ctx.fillRect(px + 3, py + 3, 24, 21);
            ctx.fillStyle = '#815e38';
            ctx.fillRect(px + 5, py + 10, 20, 3);
            ctx.fillRect(px + 5, py + 18, 20, 3);
            ctx.fillStyle = '#8fba72';
            ctx.fillRect(px + 11, py, 5, 6);
          }
        }
      for (const p of pickups) {
        const x = OX + p.x * CELL,
          y = OY + p.y * CELL;
        ctx.fillStyle = '#fae5a4';
        ctx.fillRect(x + 7, y + 7, 16, 16);
        drawPixelText(ctx, p.type === 'range' ? '+' : 'B', x + 15, y + 8, '#b75a41', 13, 'center');
      }
      for (const b of bombs) {
        const x = OX + b.x * CELL,
          y = OY + b.y * CELL;
        ctx.fillStyle = b.fuse < 0.65 && Math.floor(elapsed * 12) % 2 ? '#d6654e' : '#192b33';
        ctx.fillRect(x + 7, y + 9, 17, 16);
        ctx.fillRect(x + 10, y + 6, 11, 22);
        ctx.fillStyle = '#efcf88';
        ctx.fillRect(x + 15, y + 4, 4, 6);
        ctx.fillStyle = '#ff8054';
        ctx.fillRect(x + 18, y + 2, 4, 4);
      }
      for (const f of flames)
        for (const [x, y] of f.cells) {
          const px = OX + x * CELL,
            py = OY + y * CELL;
          ctx.fillStyle = '#e87847';
          ctx.fillRect(px + 1, py + 6, 28, 18);
          ctx.fillRect(px + 6, py + 1, 18, 28);
          ctx.fillStyle = '#ffe199';
          ctx.fillRect(px + 9, py + 3, 12, 24);
          ctx.fillRect(px + 3, py + 9, 24, 12);
        }
      for (const a of [...players, ...enemies])
        if (a.alive)
          pixelSprite(ctx, BODY, OX + a.x * CELL + 7, OY + a.y * CELL + 7, 2, {
            a: a.ai ? '#d17b79' : a.id === 0 ? '#83ddd0' : '#efc467',
            b: '#fff0d1',
            c: '#293d43',
            d: a.ai ? '#89545c' : a.id === 0 ? '#3f8f93' : '#bd8750',
            e: '#18333a',
          });
      for (const p of particles) {
        ctx.fillStyle = '#be9359';
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      if (transition > 0) {
        ctx.fillStyle = '#152f2deb';
        ctx.fillRect(60, 144, 360, 42);
        drawPixelText(
          ctx,
          env.t('GARDEN CLEARED!', '花园已清空！'),
          240,
          157,
          '#f5e4ac',
          18,
          'center',
        );
      }
    },
    getState() {
      return {
        phase,
        score,
        level,
        time,
        board: board.map((row) => [...row]),
        players: players.map((p) => ({ ...p })),
        enemies: enemies.map((p) => ({ ...p })),
        bombs: bombs.map((b) => ({ ...b })),
        flames: flames.map((f) => ({ ...f, cells: f.cells.map((c) => [...c]) })),
        pickups: pickups.map((p) => ({ ...p })),
        status: {
          en:
            env.mode === 2
              ? 'Local duel · Last gardener standing'
              : `Garden ${level}/3 · ${enemies.filter((e) => e.alive).length} rivals left`,
          zh:
            env.mode === 2
              ? '本地对战 · 最后幸存者获胜'
              : `花园 ${level}/3 · 剩余 ${enemies.filter((e) => e.alive).length} 个对手`,
        },
      };
    },
  };
}
