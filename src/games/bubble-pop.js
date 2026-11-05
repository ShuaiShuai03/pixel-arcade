import { clamp, background, drawPixelText as text } from '../shared/utils.js';
export const meta = {
  id: 'bubble-pop',
  name: { en: 'Bubble Pop', zh: '泡泡消消乐' },
  description: {
    en: 'Aim and match three bubbles. Detached groups fall away. Clear the cavern before five missed matches lower the ceiling.',
    zh: '瞄准并连接三个同色泡泡，悬空泡泡会掉落。每五次未消除会降低顶棚，赶快清空洞穴。',
  },
  genre: 'puzzle',
  players: '1',
  touch: true,
  keys: [
    { label: { en: 'Aim', zh: '瞄准' }, keys: 'A / D · ← / → · Pointer' },
    { label: { en: 'Shoot', zh: '发射' }, keys: 'Space / Enter · Click' },
    { label: { en: 'Swap next bubble', zh: '交换下一个泡泡' }, keys: 'X' },
  ],
};
const colors = ['#e89581', '#e6c66d', '#76bfa8', '#79a8c9'];
export function neighbors(r, c) {
  const shift = r % 2 ? 1 : -1;
  return [
    [r, c - 1],
    [r, c + 1],
    [r - 1, c],
    [r - 1, c + shift],
    [r + 1, c],
    [r + 1, c + shift],
  ].filter(([y, x]) => y >= 0 && y < 12 && x >= 0 && x < 12);
}
const point = (r, c, ceiling = 0) => ({ x: 102 + c * 24 + (r % 2) * 12, y: 51 + r * 21 + ceiling });
function palette(s) {
  const available = [...new Set(s.board.flat().filter((v) => v >= 0))];
  return available.length ? available : [0];
}
function nextColor(s, env) {
  const a = palette(s);
  return a[Math.floor(env.random() * a.length)];
}
export function createBubbleState(env) {
  const rotation = Math.floor(env.random() * 4);
  const board = Array.from({ length: 12 }, (_, r) =>
    Array.from({ length: 12 }, (_, c) =>
      r < 5 && !(r > 2 && (c < r - 2 || c > 13 - r))
        ? (Math.floor((c + r) / 3) + rotation) % 4
        : -1,
    ),
  );
  const s = {
    phase: 'playing',
    score: 0,
    board,
    angle: -Math.PI / 2,
    shot: null,
    current: 0,
    next: 0,
    ceiling: 0,
    misses: 0,
    shots: 0,
    popped: [],
    time: 0,
    combo: 0,
  };
  s.current = nextColor(s, env);
  s.next = nextColor(s, env);
  return s;
}
export function resolveBubble(s, row, col, color, env) {
  s.board[row][col] = color;
  const seen = new Set([`${row},${col}`]),
    cluster = [[row, col]];
  for (let k = 0; k < cluster.length; k++)
    for (const [r, c] of neighbors(...cluster[k]))
      if (s.board[r][c] === color && !seen.has(`${r},${c}`)) {
        seen.add(`${r},${c}`);
        cluster.push([r, c]);
      }
  let removed = 0;
  if (cluster.length >= 3) {
    for (const [r, c] of cluster) {
      s.board[r][c] = -1;
      s.popped.push({ ...point(r, c, s.ceiling), color, life: 0.7, vx: (c - 5) * 10 });
      removed++;
    }
    const connected = new Set(),
      q = [];
    for (let c = 0; c < 12; c++)
      if (s.board[0][c] >= 0) {
        connected.add(`0,${c}`);
        q.push([0, c]);
      }
    for (let k = 0; k < q.length; k++)
      for (const [r, c] of neighbors(...q[k]))
        if (s.board[r][c] >= 0 && !connected.has(`${r},${c}`)) {
          connected.add(`${r},${c}`);
          q.push([r, c]);
        }
    for (let r = 0; r < 12; r++)
      for (let c = 0; c < 12; c++)
        if (s.board[r][c] >= 0 && !connected.has(`${r},${c}`)) {
          s.popped.push({
            ...point(r, c, s.ceiling),
            color: s.board[r][c],
            life: 0.9,
            vx: (c - 5) * 12,
          });
          s.board[r][c] = -1;
          removed++;
        }
    s.combo = removed;
    s.score += cluster.length * 20 + (removed - cluster.length) * 35;
    env.sound('coin');
  } else {
    s.combo = 0;
    env.sound('move');
  }
  return removed;
}
function end(s, env, won) {
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'Cavern clear! Every bubble found its match.'
        : 'The bubbles reached the launcher. Try a wall shot.',
      won ? '洞穴清空！所有泡泡都已消除。' : '泡泡到达发射器，试试利用墙壁反弹。',
    ),
  });
}
function settle(s, env, hit) {
  const candidates = hit
    ? neighbors(hit[0], hit[1]).filter(([r, c]) => s.board[r][c] < 0)
    : Array.from({ length: 12 }, (_, c) => [0, c]).filter(([r, c]) => s.board[r][c] < 0);
  if (!candidates.length) {
    end(s, env, false);
    s.shot = null;
    return;
  }
  candidates.sort((a, b) => {
    const pa = point(...a, s.ceiling),
      pb = point(...b, s.ceiling);
    return (
      Math.hypot(pa.x - s.shot.x, pa.y - s.shot.y) - Math.hypot(pb.x - s.shot.x, pb.y - s.shot.y)
    );
  });
  const [r, c] = candidates[0];
  const removed = resolveBubble(s, r, c, s.shot.color, env);
  s.shot = null;
  if (!removed) {
    s.misses++;
    if (s.misses >= 5) {
      s.misses = 0;
      s.ceiling += 21;
      env.sound('hit');
    }
  }
  s.current = s.next;
  if (!palette(s).includes(s.current)) s.current = nextColor(s, env);
  s.next = nextColor(s, env);
}
export function stepBubble(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.popped = s.popped.filter((p) => {
    p.life -= dt;
    p.y += 120 * dt;
    p.x += p.vx * dt;
    return p.life > 0;
  });
  s.angle = clamp(
    s.angle +
      (Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA'))) * 1.65 * dt,
    -2.88,
    -0.26,
  );
  if (i.pointer.down && i.pointer.y < 292)
    s.angle = clamp(Math.atan2(i.pointer.y - 299, i.pointer.x - 240), -2.88, -0.26);
  if (i.pressed('KeyX') && !s.shot) [s.current, s.next] = [s.next, s.current];
  if ((i.pressed('Space', 'Enter') || i.pointer.clicked) && !s.shot) {
    s.shot = {
      x: 240,
      y: 297,
      vx: Math.cos(s.angle) * 350,
      vy: Math.sin(s.angle) * 350,
      color: s.current,
    };
    s.shots++;
    env.sound('shoot');
  }
  if (s.shot) {
    const steps = Math.max(1, Math.ceil(dt * 120)),
      dd = dt / steps;
    for (let n = 0; n < steps && s.shot; n++) {
      const b = s.shot;
      b.x += b.vx * dd;
      b.y += b.vy * dd;
      if (b.x < 101) {
        b.x = 202 - b.x;
        b.vx = Math.abs(b.vx);
      }
      if (b.x > 379) {
        b.x = 758 - b.x;
        b.vx = -Math.abs(b.vx);
      }
      let hit = null,
        best = Infinity;
      for (let r = 0; r < 12; r++)
        for (let c = 0; c < 12; c++)
          if (s.board[r][c] >= 0) {
            const p = point(r, c, s.ceiling),
              d = Math.hypot(p.x - b.x, p.y - b.y);
            if (d < 22.2 && d < best) {
              best = d;
              hit = [r, c];
            }
          }
      if (hit || b.y <= 51 + s.ceiling) settle(s, env, hit);
    }
  }
  if (s.phase !== 'playing') return;
  const occupied = [];
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < 12; c++) if (s.board[r][c] >= 0) occupied.push(point(r, c, s.ceiling));
  if (!occupied.length) {
    s.score += Math.max(0, 80 - s.shots) * 10;
    end(s, env, true);
  } else if (occupied.some((p) => p.y >= 266)) end(s, env, false);
}
function bubble(ctx, x, y, color, small = false) {
  const r = small ? 6 : 10;
  ctx.fillStyle = '#102932';
  ctx.fillRect(x - r - 1, y - r + 3, r * 2 + 2, r * 2 - 6);
  ctx.fillRect(x - r + 3, y - r - 1, r * 2 - 6, r * 2 + 2);
  ctx.fillStyle = colors[color];
  ctx.fillRect(x - r, y - r + 3, r * 2, r * 2 - 6);
  ctx.fillRect(x - r + 3, y - r, r * 2 - 6, r * 2);
  ctx.fillStyle = '#f0e9c8';
  ctx.fillRect(x - r + 4, y - r + 3, 4, 3);
  ctx.fillStyle = '#315764';
  ctx.fillRect(x + r - 6, y + r - 4, 4, 2);
}
function drawBubble(ctx, s, env) {
  background(ctx, '#112733');
  ctx.fillStyle = '#1c3a43';
  ctx.fillRect(87, 29, 306, 247);
  for (let y = 40; y < 274; y += 23) {
    ctx.fillStyle = '#244852';
    ctx.fillRect(88, y, 6, 12);
    ctx.fillRect(386, y + 6, 6, 12);
  }
  ctx.fillStyle = '#48767a';
  ctx.fillRect(87, 30, 4, 245);
  ctx.fillRect(389, 30, 4, 245);
  ctx.fillStyle = '#7fa5a0';
  ctx.fillRect(91, 29, 298, 4);
  ctx.fillStyle = '#a27364';
  for (let x = 93; x < 390; x += 12) ctx.fillRect(x, 268, 6, 2);
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < 12; c++)
      if (s.board[r][c] >= 0) {
        const p = point(r, c, s.ceiling);
        bubble(ctx, p.x, p.y, s.board[r][c]);
      }
  for (const p of s.popped) bubble(ctx, p.x, p.y, p.color, true);
  if (!s.shot) {
    let x = 240,
      y = 296,
      dx = Math.cos(s.angle),
      dy = Math.sin(s.angle);
    for (let k = 0; k < 13; k++) {
      x += dx * 12;
      y += dy * 12;
      if (x < 101 || x > 379) {
        dx = -dx;
        x = clamp(x, 101, 379);
      }
      if (y < 55 + s.ceiling) break;
      ctx.fillStyle = k % 2 ? '#5b8386' : '#709a97';
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
  }
  ctx.fillStyle = '#48787b';
  ctx.fillRect(220, 297, 40, 18);
  ctx.fillStyle = '#8db6a7';
  ctx.fillRect(228, 289, 24, 12);
  bubble(ctx, 240, 298, s.current);
  bubble(ctx, 291, 302, s.next, true);
  if (s.shot) bubble(ctx, s.shot.x, s.shot.y, s.shot.color);
  text(ctx, env.t('CAVERN CLEAR', '泡泡洞穴'), 16, 9, '#bdd2bb', 11);
  text(
    ctx,
    env.t(`${5 - s.misses} misses left`, `还可失误${5 - s.misses}次`),
    463,
    9,
    '#ddbd8e',
    11,
    'right',
  );
  text(ctx, env.t('NEXT', '下个'), 311, 299, '#8aabaa', 9);
  if (s.combo >= 6)
    text(ctx, `${s.combo} ${env.t('BUBBLES!', '连消！')}`, 240, 241, '#f4d289', 12, 'center');
}
meta.touchControls = [
  { code: 'ArrowLeft', label: { en: 'Aim left', zh: '左瞄准' } },
  { code: 'ArrowRight', label: { en: 'Aim right', zh: '右瞄准' } },
  { code: 'Space', label: { en: 'Shoot', zh: '发射' } },
  { code: 'KeyX', label: { en: 'Swap', zh: '交换' } },
];

export function createGame(env) {
  const s = createBubbleState(env);
  return {
    update: (dt, i) => stepBubble(s, dt, i, env),
    draw: (ctx) => drawBubble(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      remaining: s.board.flat().filter((v) => v >= 0).length,
      status: {
        en: `${s.board.flat().filter((v) => v >= 0).length} bubbles · ${5 - s.misses} misses before descent`,
        zh: `${s.board.flat().filter((v) => v >= 0).length}个泡泡 · 再失误${5 - s.misses}次后下降`,
      },
    }),
  };
}
