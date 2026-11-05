import { background, drawPixelText, clamp, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'memory-grove',
  name: { en: 'Memory Grove', zh: '记忆森林' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Match woodland pairs across three clearings before time runs out. A peek costs five seconds.',
    zh: '在时间用尽前配对森林图案，穿过三片林间空地。查看全部图案会消耗五秒。',
  },
  keys: [
    { label: { en: 'Choose card', zh: '选择卡片' }, keys: 'Arrows / WASD / Tap' },
    { label: { en: 'Turn card', zh: '翻开卡片' }, keys: 'Space / Enter' },
    { label: { en: 'Peek once per stage', zh: '每关查看一次' }, keys: 'H' },
  ],
  touchControls: [{ code: 'KeyH', label: { en: 'Peek −5s', zh: '查看 -5秒' } }],
};
export function makeDeck(pairs, random) {
  const deck = Array.from({ length: pairs * 2 }, (_, i) => i % pairs);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
const ICONS = [
  ['...aa...', '..aaaa..', '.aaaaaa.', '..aaaa..', '...a....', '...a....', '..aaa...', '........'],
  ['........', '..rrrr..', '.rrrrrr.', 'rrwrrwrr', '..yyyy..', '..yyyy..', '..yyyy..', '........'],
  ['...yy...', '..yyyy..', '.yyyyyy.', '..bbbb..', '..bbbb..', '...bb...', '...bb...', '........'],
  ['........', '..aa....', '.aaaa...', 'aaaaaa..', '..aaaaa.', '...aa...', '..a.a...', '........'],
  ['...yy...', '..yyyy..', '.yyyyy..', '.yyyy...', '.yyyy...', '..yyyy..', '...yy...', '........'],
  ['........', '...bb...', '..bbbb.a', '.bbbbbaa', '..bbbb.a', '...bb...', '........', '........'],
  ['...y....', '.y.y.y..', '..yyy...', 'yyyyyyy.', '..yyy...', '.y.y.y..', '...y....', '........'],
  ['........', '...w....', '..www...', '.wwwww..', '..www...', '...w....', '...w....', '........'],
  ['..rr.rr.', '.rrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..', '...rr...', '........', '........'],
  ['...bb...', '..bwwb..', '.bwwwwb.', 'bwwwwwwb', '.bwwwwb.', '..bwwb..', '...bb...', '........'],
];
export function createGame(env) {
  let stage = 1,
    deck = makeDeck(6, env.random),
    matched = Array(12).fill(false),
    flipped = [],
    cursor = 0,
    phase = 'playing',
    score = 0,
    remaining = 65,
    turns = 0,
    streak = 0,
    wait = 0,
    advance = 0,
    peek = 0,
    peekUsed = false,
    elapsed = 0;
  const pairs = () => [6, 8, 10][stage - 1];
  const columns = () => (stage === 3 ? 5 : 4);
  function finish(won) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score,
      message: won
        ? env.t('Every woodland friend has a pair!', '每个森林伙伴都找到配对了！')
        : env.t('The clearing fell asleep. Try another visit.', '林间空地睡着了，再来探访吧。'),
    });
  }
  function nextStage() {
    if (stage === 3) {
      finish(true);
      return;
    }
    score += Math.ceil(remaining) * 5;
    stage++;
    deck = makeDeck(pairs(), env.random);
    matched = Array(deck.length).fill(false);
    flipped = [];
    cursor = 0;
    wait = 0;
    advance = 0;
    remaining = 65 + (stage - 1) * 15;
    peek = 0;
    peekUsed = false;
    streak = 0;
    env.sound('win');
  }
  function flip(index) {
    if (wait > 0 || advance > 0 || peek > 0 || matched[index] || flipped.includes(index)) return;
    cursor = index;
    flipped.push(index);
    env.sound('move');
    if (flipped.length === 2) {
      turns++;
      if (deck[flipped[0]] === deck[flipped[1]]) {
        for (const i of flipped) matched[i] = true;
        streak++;
        score += 100 + Math.min(streak, 5) * 20;
        wait = 0.28;
        env.sound('coin');
      } else {
        streak = 0;
        wait = 0.78;
        env.sound('hit');
      }
    }
  }
  function usePeek() {
    if (peekUsed || wait > 0 || advance > 0) return;
    peekUsed = true;
    peek = 1.4;
    remaining = Math.max(0, remaining - 5);
    if (!remaining) finish(false);
  }
  function layout() {
    const cols = columns(),
      rows = Math.ceil(deck.length / cols),
      cw = 58,
      ch = 54;
    return { cols, rows, cw, ch, x: 100 + (300 - cols * cw) / 2, y: 53 + (225 - rows * ch) / 2 };
  }
  function update(dt, input) {
    if (phase !== 'playing') return;
    dt = clamp(dt, 0, 0.05);
    elapsed += dt;
    if (!matched.every(Boolean)) {
      remaining = Math.max(0, remaining - dt);
      if (!remaining) {
        finish(false);
        return;
      }
    }
    if (peek > 0) {
      peek = Math.max(0, peek - dt);
      return;
    }
    if (wait > 0) {
      wait -= dt;
      if (wait <= 0) {
        flipped = [];
        if (matched.every(Boolean)) advance = 0.65;
      }
      return;
    }
    if (advance > 0) {
      advance -= dt;
      if (advance <= 0) nextStage();
      return;
    }
    if (input.pressed('ArrowLeft', 'KeyA')) cursor = (cursor + deck.length - 1) % deck.length;
    if (input.pressed('ArrowRight', 'KeyD')) cursor = (cursor + 1) % deck.length;
    if (input.pressed('ArrowUp', 'KeyW')) cursor = (cursor + deck.length - columns()) % deck.length;
    if (input.pressed('ArrowDown', 'KeyS')) cursor = (cursor + columns()) % deck.length;
    if (input.pressed('Space', 'Enter')) flip(cursor);
    if (input.pressed('KeyH')) usePeek();
    if (input.pointer.clicked) {
      const { x, y } = input.pointer;
      if (x >= 12 && x <= 91 && y >= 208 && y < 244) {
        usePeek();
        return;
      }
      const l = layout(),
        cx = Math.floor((x - l.x) / l.cw),
        cy = Math.floor((y - l.y) / l.ch);
      if (cx >= 0 && cx < l.cols && cy >= 0 && cy < l.rows) {
        const i = cy * l.cols + cx;
        if (i < deck.length) flip(i);
      }
    }
  }
  function draw(ctx) {
    ctx.save();
    background(ctx, '#142c2b');
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#1c4038';
      ctx.fillRect(i * 56 - 14, 14, 15, 310);
      ctx.fillStyle = '#204a3d';
      ctx.fillRect(i * 56 - 45, 40 + (i % 3) * 15, 78, 20);
      ctx.fillRect(i * 56 - 34, 18 + (i % 3) * 15, 57, 28);
    }
    ctx.fillStyle = '#102321';
    ctx.fillRect(98, 46, 306, 235);
    drawPixelText(ctx, env.t('CLEARING', '林间空地'), 14, 57, '#a2bb9a', 9);
    drawPixelText(ctx, `${stage} / 3`, 14, 76, '#efd798', 20);
    drawPixelText(ctx, env.t('TIME', '剩余时间'), 14, 121, '#a2bb9a', 9);
    drawPixelText(
      ctx,
      String(Math.ceil(remaining)),
      14,
      141,
      remaining < 15 ? '#f1a38a' : '#efd798',
      24,
    );
    ctx.fillStyle = peekUsed ? '#34483d' : '#5c6b42';
    ctx.fillRect(12, 208, 79, 36);
    drawPixelText(
      ctx,
      peekUsed ? env.t('PEEK USED', '已查看') : env.t('PEEK −5s', '查看 -5秒'),
      51,
      221,
      peekUsed ? '#8d9d83' : '#f1e4b6',
      9,
      'center',
    );
    const l = layout();
    for (let i = 0; i < deck.length; i++) {
      const x = l.x + (i % l.cols) * l.cw + 4,
        y = l.y + Math.floor(i / l.cols) * l.ch + 3,
        open = matched[i] || flipped.includes(i) || peek > 0;
      ctx.fillStyle = matched[i] ? '#446c4d' : open ? '#eee2b9' : '#35584d';
      ctx.fillRect(x, y, l.cw - 8, l.ch - 6);
      ctx.fillStyle = open ? '#d5c48f' : '#547968';
      ctx.fillRect(x + 2, y + 2, l.cw - 12, 3);
      ctx.fillStyle = open ? '#c6b57f' : '#213e35';
      ctx.fillRect(x + 2, y + l.ch - 12, l.cw - 12, 4);
      if (open) {
        pixelSprite(ctx, ICONS[deck[i]], x + 9, y + 7, 4, {
          a: '#5e9869',
          r: '#d46f5b',
          y: '#d2a646',
          b: '#788daa',
          w: '#f0e8c9',
        });
      } else {
        ctx.fillStyle = '#6f9274';
        for (const [px, py, w, h] of [
          [21, 10, 4, 26],
          [12, 17, 22, 4],
          [15, 12, 16, 3],
          [15, 28, 16, 3],
        ])
          ctx.fillRect(x + px, y + py, w, h);
      }
      if (cursor === i) {
        ctx.strokeStyle = '#f2d98c';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, l.cw - 4, l.ch - 2);
      }
    }
    const count = matched.filter(Boolean).length / 2;
    drawPixelText(
      ctx,
      env.t(
        `${count}/${pairs()} pairs · ${turns} turns`,
        `${count}/${pairs()} 对 · 翻牌 ${turns} 次`,
      ),
      250,
      291,
      '#c9d0ab',
      11,
      'center',
    );
    if (advance > 0) {
      ctx.fillStyle = '#253e31';
      ctx.fillRect(147, 145, 209, 35);
      drawPixelText(
        ctx,
        env.t('A clearing restored!', '一片空地恢复了生机！'),
        252,
        156,
        '#f3de9d',
        12,
        'center',
      );
    }
    ctx.restore();
  }
  return {
    update,
    draw,
    getState: () => ({
      phase,
      score,
      stage,
      deck: deck.slice(),
      matched: matched.slice(),
      flipped: flipped.slice(),
      cursor,
      remaining,
      turns,
      peekUsed,
      layout: layout(),
      status: {
        en: `Clearing ${stage}/3 · ${matched.filter(Boolean).length / 2}/${pairs()} pairs`,
        zh: `林间空地 ${stage}/3 · ${matched.filter(Boolean).length / 2}/${pairs()} 对`,
      },
    }),
  };
}
