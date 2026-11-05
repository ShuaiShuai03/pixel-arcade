import { background, drawPixelText, clamp } from '../shared/utils.js';

export const meta = {
  id: 'minefield',
  name: { en: 'Minefield', zh: '扫雷远征' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Reveal every safe tile. Numbers count neighboring mines; flag suspected mines. Your first reveal is always safe.',
    zh: '揭开所有安全地块，数字代表周围的雷数。标记可疑地块，第一次揭开一定安全。',
  },
  keys: [
    { label: { en: 'Move cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    { label: { en: 'Reveal / chord', zh: '揭开 / 快速展开' }, keys: 'Space / Enter / Tap' },
    { label: { en: 'Flag cursor / flag mode', zh: '标记光标 / 标记模式' }, keys: 'F / V' },
  ],
  touchControls: [
    { code: 'KeyV', label: { en: 'Flag mode', zh: '标记模式' } },
    { code: 'KeyF', label: { en: 'Flag cursor', zh: '标记光标' } },
  ],
};
const W = 9,
  H = 9,
  COUNT = 10,
  CELL = 28,
  X = 114,
  Y = 36;
const NUMBER_COLORS = [
  '',
  '#79bfff',
  '#7fd6a2',
  '#f39a8b',
  '#baa5f2',
  '#eab270',
  '#6ed2d5',
  '#ebdae0',
  '#efefde',
];
export function neighbors(index, w, h) {
  const x = index % w,
    y = Math.floor(index / w),
    out = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < w && ny >= 0 && ny < h) out.push(ny * w + nx);
    }
  return out;
}
export function createField(w, h, count, first, random) {
  const excluded = new Set([first, ...neighbors(first, w, h)]),
    candidates = [];
  for (let i = 0; i < w * h; i++) if (!excluded.has(i)) candidates.push(i);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const mines = Array(w * h).fill(false);
  for (const i of candidates.slice(0, Math.min(count, candidates.length))) mines[i] = true;
  return {
    w,
    h,
    mines,
    numbers: mines.map((_, i) => neighbors(i, w, h).filter((n) => mines[n]).length),
  };
}
export function revealCells(field, revealed, flags, index) {
  if (
    index < 0 ||
    index >= revealed.length ||
    revealed[index] ||
    flags[index] ||
    field.mines[index]
  )
    return [];
  const seen = new Set(),
    queue = [index];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (seen.has(i) || revealed[i] || flags[i] || field.mines[i]) continue;
    seen.add(i);
    if (field.numbers[i] === 0)
      for (const n of neighbors(i, field.w, field.h)) if (!seen.has(n)) queue.push(n);
  }
  return [...seen];
}
export function createGame(env) {
  let field = null,
    revealed = Array(W * H).fill(false),
    flags = Array(W * H).fill(false),
    cursor = 0,
    phase = 'playing',
    score = 0,
    elapsed = 0,
    flagMode = false,
    exploded = -1,
    pulse = 0;
  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    if (won) score += Math.max(0, 1000 - Math.floor(elapsed) * 2);
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('Every safe tile has been mapped!', '全部安全地块已探明！')
        : env.t(
            'A mine was uncovered. Plan your flags and try again.',
            '触发了地雷。规划标记，再试一次。',
          ),
    });
  }
  function flag(index) {
    if (revealed[index]) return;
    flags[index] = !flags[index];
    env.sound('move');
  }
  function reveal(index) {
    if (flags[index]) return;
    if (!field) field = createField(W, H, COUNT, index, env.random);
    if (field.mines[index]) {
      exploded = index;
      finish(false);
      return;
    }
    let targets = [index];
    if (revealed[index]) {
      const around = neighbors(index, W, H);
      if (around.filter((n) => flags[n]).length !== field.numbers[index]) return;
      targets = around.filter((n) => !flags[n] && !revealed[n]);
    }
    let count = 0;
    for (const target of targets) {
      if (field.mines[target]) {
        exploded = target;
        finish(false);
        return;
      }
      for (const n of revealCells(field, revealed, flags, target)) {
        revealed[n] = true;
        count++;
      }
    }
    if (count) {
      score += count * 10;
      env.sound('coin');
      pulse = 0.2;
    }
    if (revealed.filter(Boolean).length === W * H - COUNT) finish(true);
  }
  function update(dt, input) {
    if (phase !== 'playing') return;
    dt = clamp(dt, 0, 0.05);
    if (field) elapsed += dt;
    pulse = Math.max(0, pulse - dt);
    if (input.pressed('ArrowLeft', 'KeyA'))
      cursor = Math.floor(cursor / W) * W + (((cursor % W) + W - 1) % W);
    if (input.pressed('ArrowRight', 'KeyD'))
      cursor = Math.floor(cursor / W) * W + (((cursor % W) + 1) % W);
    if (input.pressed('ArrowUp', 'KeyW')) cursor = (cursor + W * H - W) % (W * H);
    if (input.pressed('ArrowDown', 'KeyS')) cursor = (cursor + W) % (W * H);
    if (input.pressed('KeyV')) {
      flagMode = !flagMode;
      env.sound('move');
    }
    if (input.pressed('KeyF')) flag(cursor);
    if (input.pressed('Space', 'Enter')) reveal(cursor);
    if (input.pointer.clicked) {
      const { x, y } = input.pointer;
      if (x >= 382 && x < 470 && y >= 126 && y < 174) {
        flagMode = !flagMode;
        env.sound('move');
        return;
      }
      const bx = Math.floor((x - X) / CELL),
        by = Math.floor((y - Y) / CELL);
      if (bx >= 0 && bx < W && by >= 0 && by < H) {
        cursor = by * W + bx;
        if (flagMode) flag(cursor);
        else reveal(cursor);
      }
    }
  }
  function drawFlag(ctx, x, y) {
    ctx.fillStyle = '#e8d8b9';
    ctx.fillRect(x + 12, y + 7, 2, 16);
    ctx.fillStyle = '#ee8662';
    ctx.fillRect(x + 14, y + 7, 8, 6);
    ctx.fillStyle = '#e8d8b9';
    ctx.fillRect(x + 8, y + 23, 10, 2);
  }
  function drawMine(ctx, x, y, danger) {
    ctx.fillStyle = danger ? '#b83f3f' : '#332f33';
    ctx.fillRect(x + 8, y + 8, 12, 12);
    ctx.fillRect(x + 12, y + 4, 4, 20);
    ctx.fillRect(x + 4, y + 12, 20, 4);
    ctx.fillStyle = '#f8dbb1';
    ctx.fillRect(x + 10, y + 10, 3, 3);
  }
  function draw(ctx) {
    ctx.save();
    background(ctx, '#322c2b');
    for (let i = 0; i < 23; i++) {
      ctx.fillStyle = i % 2 ? '#453732' : '#3a302e';
      ctx.fillRect((i * 83) % 480, 290 - ((i * 17) % 92), 58, 100);
    }
    ctx.fillStyle = '#1d2327';
    ctx.fillRect(X - 5, Y - 5, W * CELL + 10, H * CELL + 10);
    drawPixelText(ctx, env.t('MINES', '地雷'), 16, 46, '#c2ad91', 10);
    drawPixelText(
      ctx,
      String(COUNT - flags.filter(Boolean).length).padStart(2, '0'),
      16,
      65,
      '#f0c674',
      25,
    );
    drawPixelText(ctx, env.t('TIME', '用时'), 16, 116, '#c2ad91', 10);
    drawPixelText(ctx, `${Math.floor(elapsed)}s`, 16, 134, '#e4d9c7', 17);
    drawPixelText(ctx, env.t('FIRST TILE', '首次揭开'), 16, 193, '#c2ad91', 9);
    drawPixelText(ctx, env.t('IS SAFE', '必定安全'), 16, 209, '#99c68c', 11);
    for (let i = 0; i < W * H; i++) {
      const x = X + (i % W) * CELL,
        y = Y + Math.floor(i / W) * CELL;
      if (revealed[i]) {
        ctx.fillStyle = pulse > 0 ? '#53585b' : '#464b50';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        if (field.numbers[i])
          drawPixelText(
            ctx,
            String(field.numbers[i]),
            x + 14,
            y + 6,
            NUMBER_COLORS[field.numbers[i]],
            16,
            'center',
          );
      } else {
        ctx.fillStyle = '#81756a';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = '#ad9c87';
        ctx.fillRect(x + 1, y + 1, CELL - 2, 3);
        ctx.fillRect(x + 1, y + 1, 3, CELL - 2);
        ctx.fillStyle = '#5c5350';
        ctx.fillRect(x + CELL - 4, y + 4, 3, CELL - 5);
        ctx.fillRect(x + 4, y + CELL - 4, CELL - 5, 3);
        if (phase === 'lost' && field?.mines[i]) drawMine(ctx, x, y, i === exploded);
        else if (flags[i]) drawFlag(ctx, x, y);
        if (phase === 'lost' && flags[i] && !field.mines[i]) {
          ctx.strokeStyle = '#ff665f';
          ctx.beginPath();
          ctx.moveTo(x + 6, y + 6);
          ctx.lineTo(x + 22, y + 22);
          ctx.moveTo(x + 22, y + 6);
          ctx.lineTo(x + 6, y + 22);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = flagMode ? '#eea279' : '#f6e9bb';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      X + (cursor % W) * CELL + 2,
      Y + Math.floor(cursor / W) * CELL + 2,
      CELL - 4,
      CELL - 4,
    );
    drawPixelText(ctx, env.t('TAP MODE', '点击模式'), 426, 83, '#c2ad91', 10, 'center');
    drawPixelText(
      ctx,
      flagMode ? env.t('FLAG', '标记') : env.t('REVEAL', '揭开'),
      426,
      101,
      '#f4dcaf',
      12,
      'center',
    );
    ctx.fillStyle = flagMode ? '#9d6348' : '#665446';
    ctx.fillRect(382, 126, 88, 48);
    drawFlag(ctx, 391, 134);
    drawPixelText(ctx, env.t('SWITCH', '切换'), 446, 145, '#f4ead5', 9, 'center');
    drawPixelText(
      ctx,
      env.t('Numbers count mines in the 8 surrounding tiles.', '数字表示周围八格内的地雷数量。'),
      240,
      301,
      '#c7b9a5',
      10,
      'center',
    );
    ctx.restore();
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      width: W,
      height: H,
      mines: field ? field.mines.slice() : Array(W * H).fill(false),
      numbers: field ? field.numbers.slice() : Array(W * H).fill(0),
      revealed: revealed.slice(),
      flags: flags.slice(),
      cursor,
      flagMode,
      elapsed,
      started: !!field,
      status: {
        en: `${revealed.filter(Boolean).length}/71 safe tiles`,
        zh: `安全地块 ${revealed.filter(Boolean).length}/71`,
      },
    }),
  };
}
