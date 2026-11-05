import { background, drawPixelText, clamp, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'memory-grove',
  name: { en: 'Memory Grove', zh: '记忆森林' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Restore three woodland clearings: match pairs, follow a visible lantern order, then remember triples. The decision clock pauses during feedback. Timed H study costs 5 seconds of decision time; relaxed study lasts until closed. T can rescue a timed visit into relaxed play at any time. Turning or studying a card locks out a return to timed mode.',
    zh: '修复三片林间空地：自由配对、按灯笼顺序配对、记住三张一组。反馈期间暂停计时。计时模式H查看会扣除5秒思考时间，休闲模式可一直查看至关闭。T可随时从计时转为休闲。翻牌或查看后不能再转回计时模式。',
  },
  keys: [
    { label: { en: 'Move focus', zh: '移动焦点' }, keys: 'Arrows / WASD' },
    { label: { en: 'Turn / next clearing', zh: '翻牌 / 下一空地' }, keys: 'Space / Enter' },
    { label: { en: 'Choose a card', zh: '选择卡片' }, keys: 'Tap' },
    { label: { en: 'Study / close study', zh: '查看 / 关闭查看' }, keys: 'H' },
    { label: { en: 'Mode / rescue into relaxed play', zh: '模式 / 转为休闲' }, keys: 'T' },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '向右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '向上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '向下' } },
    { code: 'Space', label: { en: 'Turn / Next', zh: '翻牌 / 下一关' } },
    { code: 'KeyH', label: { en: 'Study / Close', zh: '查看 / 关闭' } },
    { code: 'KeyT', label: { en: 'Mode / Relax', zh: '模式 / 休闲' } },
  ],
};
const EPS = 1e-9,
  FLIP = 0.22,
  MISMATCH = 1.3,
  MATCH = 0.6,
  STUDY = 2.4;
const LAYOUT = { x: 120, y: 62, cw: 62, ch: 66, cols: 4, rows: 3 };
const TITLES = [
  ['Fern Clearing', '蕨叶空地'],
  ['Lantern Trail', '灯笼小径'],
  ['Star Glade', '星光林地'],
];
const RULES = ['pairs', 'route', 'triples'];
const TIMES = [90, 120, 150];
export const ICONS = [
  ['...gg...', '..gggg..', '.gggggg.', 'gggggggg', '..gggg..', '...tt...', '...tt...', '..tttt..'],
  ['..rrr...', '.rrrrr..', 'rrwrrwrr', 'rrrrrrrr', '..yyyy..', '..yyyy..', '..yyyy..', '...yy...'],
  ['..oooo..', '.oooooo.', '.owwwwo.', '.wwbbww.', '.wwwwww.', '..wyyw..', '...ww...', '...ww...'],
  ['....gg..', '..ggggg.', '.gggggg.', '.ggggg..', '..ggg...', '..gt....', '.tt.....', 'tt......'],
  ['.y....y.', '..yyyy..', '.yyyyyy.', 'yybyybyy', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '...yy...'],
  ['....bb..', '...bbbb.', '..bbb...', '.bbb....', '.bbb....', '..bbb...', '...bbbb.', '....bb..'],
];
const PAL = {
  g: '#72a97b',
  t: '#9e7150',
  r: '#d77d6d',
  y: '#e7c779',
  o: '#a98769',
  w: '#f0e0bc',
  b: '#7da2bd',
};
function shuffled(values, random) {
  const list = values.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = clamp(Math.floor(random() * (i + 1)), 0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export function makeDeck(pairs, random, copies = 2) {
  if (!Number.isInteger(pairs) || pairs < 1 || !Number.isInteger(copies) || copies < 2)
    throw new RangeError('A memory deck needs repeated symbols');
  return shuffled(
    Array.from({ length: pairs * copies }, (_, i) => i % pairs),
    random,
  );
}
export function createMemoryState(env, stage = 1) {
  const groupSize = stage === 3 ? 3 : 2,
    symbolCount = stage === 3 ? 4 : 6;
  return {
    phase: 'playing',
    mode: 'ready',
    stage,
    rule: RULES[stage - 1],
    groupSize,
    symbolCount,
    deck: makeDeck(symbolCount, env.random, groupSize),
    matched: Array(12).fill(false),
    flipped: [],
    cursor: 0,
    flip: null,
    reveal: null,
    closing: null,
    study: null,
    route: stage === 2 ? shuffled([0, 1, 2, 3, 4, 5], env.random) : [],
    routeIndex: 0,
    score: 0,
    turns: 0,
    stageTurns: 0,
    streak: 0,
    bestStreak: 0,
    remaining: TIMES[stage - 1],
    time: 0,
    timed: true,
    started: false,
    stageStarted: false,
    helps: 0,
    stageHelps: 0,
    feedback: 'welcome',
    feedbackTime: 4,
  };
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function studyOpen(s) {
  if (!s.study) return 0;
  if (s.study.phase === 'opening') return smooth(s.study.time / FLIP);
  if (s.study.phase === 'closing') return 1 - smooth(s.study.time / FLIP);
  return 1;
}
export function memoryCardOpen(s, i) {
  if (s.matched[i]) return 1;
  let open = 0;
  if (s.flipped.includes(i)) {
    if (s.flip?.index === i) open = smooth(s.flip.time / FLIP);
    else if (s.closing) open = 1 - smooth(s.closing.time / FLIP);
    else open = 1;
  }
  return Math.max(open, studyOpen(s));
}
function visibleCards(s) {
  return s.deck.map((value, i) => (memoryCardOpen(s, i) >= 0.5 ? value : null));
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.mode = 'terminal';
  s.feedback = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t('Three woodland clearings restored!', '三片林间空地修复完成！')
      : env.t(
          'The clearing fell asleep. Try relaxed play or visit again.',
          '林间空地睡着了。试试休闲模式，或重新探访。',
        ),
  });
}
function notice(s, text, seconds = 2.5) {
  s.feedback = text;
  s.feedbackTime = seconds;
}
function checkGroup(s, env) {
  if (s.flipped.length < s.groupSize) {
    s.mode = 'ready';
    return;
  }
  s.turns++;
  s.stageTurns++;
  const same = s.flipped.every((i) => s.deck[i] === s.deck[s.flipped[0]]),
    inOrder = s.rule !== 'route' || s.deck[s.flipped[0]] === s.route[s.routeIndex],
    correct = same && inOrder;
  s.reveal = { time: 0, duration: correct ? MATCH : MISMATCH, correct };
  s.mode = 'reveal';
  if (correct) {
    for (const i of s.flipped) s.matched[i] = true;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.score += 100 + 20 * Math.min(s.streak, 5);
    if (s.rule === 'route') s.routeIndex++;
    notice(s, 'match');
    env.sound('coin');
  } else {
    s.streak = 0;
    notice(s, same ? 'order' : 'mismatch', 3);
    env.sound('hit');
  }
}
function turnCard(s, i, env) {
  if (s.mode !== 'ready' || !Number.isInteger(i) || i < 0 || i >= 12) return;
  if (s.matched[i] || s.flipped.includes(i)) {
    notice(s, 'already');
    return;
  }
  s.cursor = i;
  s.started = true;
  s.stageStarted = true;
  s.flipped.push(i);
  s.flip = { index: i, time: 0 };
  s.mode = 'opening';
  env.sound('move');
}
function beginStudy(s, env) {
  if (s.timed && s.remaining <= 5 + EPS) {
    notice(s, 'need-time');
    env.sound('hit');
    return;
  }
  if (s.timed) s.remaining -= 5;
  s.started = true;
  s.helps++;
  s.stageHelps++;
  s.study = { phase: 'opening', time: 0, duration: FLIP, hold: s.timed ? STUDY : null };
  s.mode = 'study';
  notice(s, 'study');
  env.sound('move');
}
function nextStage(s, env) {
  const saved = {
    score: s.score,
    turns: s.turns,
    bestStreak: s.bestStreak,
    timed: s.timed,
    started: s.started,
    helps: s.helps,
    time: s.time,
  };
  Object.assign(s, createMemoryState(env, s.stage + 1), saved);
  env.sound('move');
}
function relax(s, env) {
  if (!s.started) s.timed = !s.timed;
  else if (s.timed) s.timed = false;
  else {
    notice(s, 'relaxed');
    return;
  }
  if (!s.timed && s.study) {
    s.study.hold = null;
    if (s.study.phase === 'hold') s.study.duration = null;
  }
  notice(s, s.timed ? 'timed' : 'relaxed');
  env.sound('move');
}
function handleInput(s, input, env) {
  if (input.pressed('KeyT')) {
    relax(s, env);
    return;
  }
  if (s.mode === 'garden-clear') {
    const p = input.pointer;
    if (
      input.pressed('Space', 'Enter') ||
      (p.clicked && p.x >= 172 && p.x <= 308 && p.y >= 282 && p.y <= 308)
    )
      nextStage(s, env);
    return;
  }
  if (s.mode === 'study') {
    if (s.study.phase === 'hold' && input.pressed('KeyH', 'Space', 'Enter')) {
      s.study.phase = 'closing';
      s.study.time = 0;
      s.study.duration = FLIP;
    }
    return;
  }
  if (s.mode !== 'ready') return;
  if (input.pressed('KeyH')) {
    beginStudy(s, env);
    return;
  }
  const dx =
      Number(input.pressed('ArrowRight', 'KeyD')) - Number(input.pressed('ArrowLeft', 'KeyA')),
    dy = Number(input.pressed('ArrowDown', 'KeyS')) - Number(input.pressed('ArrowUp', 'KeyW')),
    col = s.cursor % 4,
    row = Math.floor(s.cursor / 4);
  if (dx && !dy) s.cursor = row * 4 + ((col + dx + 4) % 4);
  if (dy && !dx) s.cursor = ((row + dy + 3) % 3) * 4 + col;
  if (input.pointer.clicked) {
    const p = input.pointer,
      x = Math.floor((p.x - LAYOUT.x) / LAYOUT.cw),
      y = Math.floor((p.y - LAYOUT.y) / LAYOUT.ch);
    if (x >= 0 && x < 4 && y >= 0 && y < 3) {
      const lx = p.x - LAYOUT.x - x * LAYOUT.cw,
        ly = p.y - LAYOUT.y - y * LAYOUT.ch;
      if (lx >= 4 && lx <= 58 && ly >= 4 && ly <= 62) turnCard(s, y * 4 + x, env);
    }
  } else if (input.pressed('Space', 'Enter')) turnCard(s, s.cursor, env);
}
function advance(s, t) {
  s.time += t;
  s.feedbackTime = Math.max(0, s.feedbackTime - t);
}
export function stepMemory(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  if (s.timed && s.stageStarted && s.remaining <= 0 && s.mode === 'ready') {
    finish(s, env, false);
    return;
  }
  handleInput(s, input, env);
  let left = Math.min(dt, 1 / 30);
  while (left > EPS && s.phase === 'playing') {
    if (s.mode === 'opening') {
      const f = s.flip,
        t = Math.min(left, FLIP - f.time);
      advance(s, t);
      f.time += t;
      left -= t;
      if (f.time >= FLIP - EPS) {
        s.flip = null;
        checkGroup(s, env);
      }
    } else if (s.mode === 'reveal') {
      const r = s.reveal,
        t = Math.min(left, r.duration - r.time);
      advance(s, t);
      r.time += t;
      left -= t;
      if (r.time >= r.duration - EPS) {
        s.reveal = null;
        if (r.correct) {
          s.flipped = [];
          if (s.matched.every(Boolean)) {
            if (s.stage === 3) finish(s, env, true);
            else {
              s.mode = 'garden-clear';
              notice(s, 'garden-clear');
              env.sound('win');
            }
          } else s.mode = 'ready';
        } else {
          s.mode = 'closing';
          s.closing = { time: 0 };
        }
      }
    } else if (s.mode === 'closing') {
      const c = s.closing,
        t = Math.min(left, FLIP - c.time);
      advance(s, t);
      c.time += t;
      left -= t;
      if (c.time >= FLIP - EPS) {
        s.closing = null;
        s.flipped = [];
        s.mode = 'ready';
      }
    } else if (s.mode === 'study') {
      const m = s.study,
        t = m.duration === null ? left : Math.min(left, m.duration - m.time);
      advance(s, t);
      m.time += t;
      left -= t;
      if (m.duration !== null && m.time >= m.duration - EPS) {
        if (m.phase === 'opening') {
          m.phase = 'hold';
          m.time = 0;
          m.duration = m.hold;
        } else if (m.phase === 'hold') {
          m.phase = 'closing';
          m.time = 0;
          m.duration = FLIP;
        } else {
          s.study = null;
          s.mode = 'ready';
        }
      }
    } else {
      const running = s.mode === 'ready' && s.timed && s.stageStarted,
        t = running ? Math.min(left, s.remaining) : left;
      advance(s, t);
      left -= t;
      if (running) {
        s.remaining = Math.max(0, s.remaining - t);
        if (s.remaining <= EPS) {
          s.remaining = 0;
          finish(s, env, false);
        }
      }
    }
  }
}
function prompt(s, env) {
  if (s.phase === 'won') return env.t('THREE CLEARINGS RESTORED', '三片空地修复完成');
  if (s.phase === 'lost') return env.t('THE GROVE SLEEPS · VISIT AGAIN', '森林睡着了 · 重新探访');
  if (s.mode === 'garden-clear')
    return env.t('CLEARING RESTORED · NEXT WHEN READY', '空地已修复 · 准备好后进入下一关');
  if (s.mode === 'study')
    return s.study.phase === 'hold'
      ? s.timed
        ? env.t('STUDY · H / TURN TO CLOSE', '查看中 · H / 翻牌键关闭')
        : env.t('STUDY AS LONG AS YOU NEED · H TO CLOSE', '慢慢查看 · H关闭后开始配对')
      : env.t('Turning the study cards · clock paused', '正在翻动查看卡片 · 暂停计时');
  if (s.feedbackTime > 0) {
    if (s.feedback === 'order')
      return env.t(
        'A later pair · follow the gold lantern first',
        '这组在后面 · 先找金框灯笼的图案',
      );
    if (s.feedback === 'mismatch')
      return env.t('Different symbols · remember their places', '图案不同 · 记住它们的位置');
    if (s.feedback === 'need-time')
      return env.t('Study needs 5s · T rescues into relaxed play', '查看需要5秒 · T可转为休闲模式');
    if (s.feedback === 'relaxed')
      return env.t(
        'RELAXED · no deadline · H study is unhurried',
        '休闲模式 · 不限时 · H可慢慢查看',
      );
    if (s.feedback === 'already')
      return env.t('Choose another unmatched card', '请选择另一张未配对的卡片');
  }
  if (s.mode === 'opening' || s.mode === 'closing' || s.mode === 'reveal')
    return env.t('Remember the symbols · clock paused', '记住这些图案 · 暂停计时');
  if (s.rule === 'route')
    return env.t(
      'Match the GOLD lantern symbol · then the next',
      '配对金框灯笼的图案 · 再按顺序继续',
    );
  if (s.rule === 'triples')
    return env.t(
      'Turn THREE different cards with the same symbol',
      '翻开三张不同卡片 · 找到同一图案',
    );
  return env.t('Turn two matching cards · H study · T relax', '翻开两张相同图案 · H查看 · T休闲');
}
function icon(ctx, type, x, y, scale = 4) {
  pixelSprite(ctx, ICONS[type], x, y, scale, PAL);
}
function card(ctx, s, i) {
  const x = LAYOUT.x + (i % 4) * LAYOUT.cw + 31,
    y = LAYOUT.y + Math.floor(i / 4) * LAYOUT.ch + 33,
    open = memoryCardOpen(s, i),
    front = open >= 0.5,
    width = Math.max(0.045, Math.abs(Math.cos(open * Math.PI)));
  ctx.fillStyle = '#081c20';
  ctx.fillRect(x - 26, y - 25, 54, 56);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width, 1);
  ctx.fillStyle = s.matched[i]
    ? '#4d7c61'
    : front
      ? '#e7d6a7'
      : s.stage === 3
        ? '#385166'
        : '#3d6457';
  ctx.fillRect(-26, -28, 52, 56);
  ctx.fillStyle = front ? '#f6e9bf' : '#779380';
  ctx.fillRect(-24, -26, 48, 3);
  ctx.fillStyle = front ? '#ac946b' : '#213e38';
  ctx.fillRect(-24, 22, 48, 4);
  if (front) {
    icon(ctx, s.deck[i], -16, -18, 4);
    if (s.matched[i]) {
      ctx.fillStyle = '#f5e3a7';
      ctx.fillRect(14, 17, 3, 3);
      ctx.fillRect(17, 20, 3, 3);
      ctx.fillRect(20, 14, 3, 7);
    }
  } else {
    ctx.fillStyle = s.stage === 3 ? '#9aacbd' : '#9db18d';
    for (const [px, py, w, h] of [
      [-2, -19, 4, 37],
      [-13, -7, 26, 3],
      [-10, -14, 20, 3],
      [-9, 3, 18, 3],
      [-7, 10, 14, 3],
    ])
      ctx.fillRect(px, py, w, h);
    ctx.fillStyle = '#29453e';
    ctx.fillRect(-2, -4, 4, 6);
    for (const [px, py] of [
      [-20, -22],
      [18, -22],
      [-20, 19],
      [18, 19],
    ])
      ctx.fillRect(px, py, 3, 3);
  }
  ctx.restore();
  if (s.cursor === i) {
    ctx.strokeStyle = '#f0d18a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 29, y - 31, 58, 62);
    ctx.fillStyle = '#f0d18a';
    ctx.fillRect(x - 4, y + 28, 8, 3);
  }
}
export function drawMemory(ctx, s, env) {
  ctx.save();
  background(ctx, ['#18372f', '#233a37', '#1c2e42'][s.stage - 1]);
  ctx.fillStyle = s.stage === 3 ? '#365371' : '#638274';
  ctx.fillRect(0, 0, 480, 92);
  ctx.fillStyle = s.stage === 3 ? '#cbd8b5' : '#e7d39a';
  ctx.fillRect(s.stage === 2 ? 362 : 380, 21, 21, 21);
  ctx.fillStyle = s.stage === 3 ? '#365371' : '#638274';
  ctx.fillRect(s.stage === 3 ? 389 : 397, 18, 14, 25);
  for (let layer = 0; layer < 3; layer++)
    for (let i = 0; i < 9; i++) {
      const x = i * 67 - layer * 21,
        y = 38 + layer * 28 + (i % 3) * 9;
      ctx.fillStyle = ['#466b5a', '#2b5447', '#1b3b34'][layer];
      ctx.fillRect(x + 24, y, 9, 220);
      ctx.fillRect(x + 5, y + 18, 47, 15);
      ctx.fillRect(x + 13, y + 4, 31, 22);
    }
  ctx.fillStyle = '#152c29';
  ctx.fillRect(0, 267, 480, 53);
  for (let i = 0; i < 16; i++) {
    const x = (i * 41) % 480;
    ctx.fillStyle = i % 2 ? '#4c6a45' : '#7c8455';
    ctx.fillRect(x, 271 + (i % 3) * 7, 18, 4);
  }
  if (s.stage === 2)
    for (const x of [20, 90, 390, 460]) {
      ctx.fillStyle = '#80674d';
      ctx.fillRect(x, 42, 2, 35);
      ctx.fillStyle = '#dbaf60';
      ctx.fillRect(x - 5, 66, 12, 16);
      ctx.fillStyle = '#f2daa1';
      ctx.fillRect(x - 2, 70, 6, 8);
    }
  if (s.stage === 3)
    for (const [x, y] of [
      [25, 18],
      [72, 39],
      [112, 24],
      [351, 28],
      [441, 15],
      [466, 50],
    ]) {
      ctx.fillStyle = '#bdcbd0';
      ctx.fillRect(x, y, 2, 6);
      ctx.fillRect(x - 2, y + 2, 6, 2);
    }
  ctx.fillStyle = '#112a29';
  ctx.fillRect(0, 0, 480, 34);
  drawPixelText(ctx, env.t(...TITLES[s.stage - 1]).toUpperCase(), 240, 11, '#eddbad', 13, 'center');
  ctx.fillStyle = '#102724';
  ctx.fillRect(9, 47, 97, 224);
  ctx.fillRect(378, 47, 93, 224);
  drawPixelText(ctx, env.t('CLEARING', '林间空地'), 18, 57, '#a1b69b', 10);
  drawPixelText(ctx, `${s.stage} / 3`, 18, 75, '#f0d28f', 22);
  drawPixelText(ctx, env.t('DECISION TIME', '思考时间'), 18, 114, '#a1b69b', 10);
  drawPixelText(
    ctx,
    s.timed ? String(Math.ceil(s.remaining)) : '∞',
    18,
    133,
    s.remaining < 15 && s.timed ? '#e99e86' : '#efdeb3',
    28,
  );
  drawPixelText(
    ctx,
    s.timed ? env.t('TIMED', '计时模式') : env.t('RELAXED', '休闲模式'),
    18,
    174,
    '#b9c9ab',
    11,
  );
  drawPixelText(
    ctx,
    s.timed ? env.t('T  RELAX', 'T  转为休闲') : env.t('NO DEADLINE', '没有时限'),
    18,
    193,
    '#a1b69b',
    10,
  );
  drawPixelText(ctx, env.t('H  STUDY', 'H  查看'), 18, 225, '#e0c88f', 12);
  drawPixelText(
    ctx,
    s.timed ? env.t('COST 5s', '花费5秒') : env.t('CLOSE WITH H', 'H关闭查看'),
    18,
    246,
    '#a1b69b',
    10,
  );
  const count = s.matched.filter(Boolean).length / s.groupSize,
    total = 12 / s.groupSize;
  drawPixelText(
    ctx,
    s.rule === 'triples'
      ? env.t('TRIPLES', '三张一组')
      : s.rule === 'route'
        ? env.t('LANTERNS', '灯笼顺序')
        : env.t('PAIRS', '相同配对'),
    387,
    57,
    '#a1b69b',
    10,
  );
  drawPixelText(ctx, `${count}/${total}`, 387, 78, '#f0d28f', 23);
  if (s.rule === 'route') {
    drawPixelText(ctx, env.t('NEXT SYMBOL', '下一个图案'), 387, 113, '#c5d0b0', 10);
    if (s.routeIndex < 6) icon(ctx, s.route[s.routeIndex], 406, 133, 4);
    for (let n = 0; n < 6; n++) {
      const x = 388 + (n % 3) * 25,
        y = 184 + Math.floor(n / 3) * 38;
      ctx.fillStyle = n < s.routeIndex ? '#375c45' : n === s.routeIndex ? '#8a7445' : '#29433b';
      ctx.fillRect(x - 2, y - 3, 23, 33);
      icon(ctx, s.route[n], x + 1, y + 1, 2);
      drawPixelText(
        ctx,
        String(n + 1),
        x + 8,
        y + 20,
        n < s.routeIndex ? '#8fbc92' : '#ecdda7',
        10,
        'center',
      );
      if (n < s.routeIndex) {
        ctx.fillStyle = '#e4e6b1';
        ctx.fillRect(x + 13, y + 22, 2, 2);
        ctx.fillRect(x + 15, y + 24, 2, 2);
        ctx.fillRect(x + 17, y + 20, 2, 5);
      }
      if (n === s.routeIndex) {
        ctx.strokeStyle = '#f0d18a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 3, y - 4, 25, 35);
      }
    }
  } else {
    drawPixelText(
      ctx,
      s.rule === 'triples' ? env.t('THREE CARDS', '翻开三张') : env.t('TWO CARDS', '翻开两张'),
      387,
      121,
      '#c5d0b0',
      10,
    );
    for (let i = 0; i < s.groupSize; i++) {
      ctx.fillStyle = i < s.flipped.length ? '#e6cf96' : '#4b6e5a';
      ctx.fillRect(390 + i * 24, 143, 17, 23);
      ctx.fillStyle = '#203c34';
      ctx.fillRect(395 + i * 24, 150, 7, 9);
    }
    drawPixelText(ctx, env.t('SAME SYMBOL', '相同图案'), 387, 185, '#c5d0b0', 10);
    drawPixelText(ctx, env.t('TURNS', '翻牌次数'), 387, 222, '#a1b69b', 10);
    drawPixelText(ctx, String(s.stageTurns), 387, 241, '#e2d1a0', 15);
  }
  ctx.fillStyle = '#0d2528';
  ctx.fillRect(114, 55, 258, 212);
  ctx.fillStyle = '#876e4a';
  ctx.fillRect(115, 55, 256, 3);
  ctx.fillRect(115, 265, 256, 3);
  for (let i = 0; i < 12; i++) card(ctx, s, i);
  ctx.fillStyle = '#102724';
  ctx.fillRect(0, 283, 480, 37);
  if (s.mode === 'garden-clear') {
    ctx.fillStyle = '#637548';
    ctx.fillRect(172, 282, 136, 26);
    drawPixelText(ctx, env.t('NEXT CLEARING', '下一空地'), 240, 291, '#f5e4b6', 12, 'center');
  } else drawPixelText(ctx, prompt(s, env), 240, 296, '#d0d7b4', 10, 'center');
  ctx.restore();
}
export function createGame(env) {
  const s = createMemoryState(env);
  return {
    update: (dt, input) => stepMemory(s, dt, input, env),
    draw: (ctx) => drawMemory(ctx, s, env),
    getState: () => {
      const visible = visibleCards(s);
      return {
        phase: s.phase,
        mode: s.mode,
        stage: s.stage,
        rule: s.rule,
        groupSize: s.groupSize,
        symbolCount: s.symbolCount,
        score: s.score,
        deck: visible.slice(),
        visible,
        matched: s.matched.slice(),
        flipped: s.flipped.slice(),
        cursor: s.cursor,
        remaining: s.remaining,
        time: s.time,
        turns: s.turns,
        stageTurns: s.stageTurns,
        timed: s.timed,
        started: s.started,
        stageStarted: s.stageStarted,
        streak: s.streak,
        bestStreak: s.bestStreak,
        helps: s.helps,
        stageHelps: s.stageHelps,
        route: s.route.slice(),
        routeIndex: s.routeIndex,
        flip: s.flip && { ...s.flip },
        reveal: s.reveal && { ...s.reveal },
        closing: s.closing && { ...s.closing },
        study: s.study && { ...s.study },
        feedback: s.feedback,
        feedbackTime: s.feedbackTime,
        layout: { ...LAYOUT },
        status: {
          en: `${TITLES[s.stage - 1][0]} ${s.stage}/3 · ${s.matched.filter(Boolean).length / s.groupSize}/${12 / s.groupSize} ${s.groupSize === 3 ? 'triples' : 'pairs'} · ${prompt(s, { t: (en) => en })}`,
          zh: `${TITLES[s.stage - 1][1]} ${s.stage}/3 · ${s.matched.filter(Boolean).length / s.groupSize}/${12 / s.groupSize} 组 · ${prompt(s, { t: (_, zh) => zh })}`,
        },
      };
    },
  };
}
