import { background, drawPixelText as text, clamp } from '../shared/utils.js';
export const meta = {
  id: 'minefield',
  name: { en: 'Minefield', zh: '扫雷远征' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Survey Camp, Quarry and Ridge. Reveal every safe tile; clues count mines in the eight neighboring active cells. Rubble is inactive. Ridge also shows truthful sector totals. The first opening is safe. F cycles marks, C chords exact flags, I inspects, H explains a visible deduction, X spends a probe without moving mines. V changes tap mode; Enter travels after a clear. G selects the guide before opening.',
    zh: '依次勘探营地、采石场与山脊，揭开所有安全地块。数字统计周围八个有效格内的雷；废石格无效。山脊另有真实分区雷数。首次揭开安全。F循环标记，C按旗数展开，I检查，H解释可见推理，X消耗探针且不移动地雷。V切换点击模式，通关后回车前进；首次揭开前G选择指导级别。',
  },
  keys: [
    {
      label: { en: 'Move cursor', zh: '移动光标' },
      keys: { en: 'Arrows / WASD', zh: '方向键 / WASD' },
    },
    { label: { en: 'Reveal / travel', zh: '揭开 / 前进' }, keys: 'Space / Enter' },
    { label: { en: 'Flag / question / clear', zh: '旗帜 / 存疑 / 清除' }, keys: 'F' },
    { label: { en: 'Chord exact flags', zh: '按准确旗数展开' }, keys: 'C' },
    { label: { en: 'Inspect neighbors', zh: '检查相邻格' }, keys: 'I' },
    { label: { en: 'Explain a deduction', zh: '解释推理' }, keys: 'H' },
    { label: { en: 'Probe selected tile', zh: '探测选中格' }, keys: 'X' },
    { label: { en: 'Tap: reveal / mark / select', zh: '点击：揭开 / 标记 / 选择' }, keys: 'V' },
    { label: { en: 'Guide before opening', zh: '首次揭开前选指导' }, keys: 'G' },
  ],
  touchControls: [
    { code: 'KeyV', side: 'left', label: { en: 'Tap mode', zh: '点击模式' } },
    { code: 'KeyG', side: 'left', label: { en: 'Guide', zh: '指导' } },
    { code: 'KeyI', side: 'left', label: { en: 'Inspect', zh: '检查' } },
    { code: 'KeyH', side: 'left', label: { en: 'Hint', zh: '推理' } },
    { code: 'Space', side: 'right', label: { en: 'Reveal', zh: '揭开' } },
    { code: 'KeyF', side: 'right', label: { en: 'Mark', zh: '标记' } },
    { code: 'KeyC', side: 'right', label: { en: 'Chord', zh: '展开' } },
    { code: 'KeyX', side: 'right', label: { en: 'Probe', zh: '探针' } },
    { code: 'Enter', side: 'right', label: { en: 'Next', zh: '下一关' } },
  ],
};
const TITLES = [
  ['Camp Survey', '营地勘探'],
  ['Split Quarry', '裂隙采石场'],
  ['Ridge Sectors', '山脊分区'],
];
const NUMBER_COLORS = [
  '',
  '#75b9f0',
  '#78be91',
  '#df9c88',
  '#b5a3db',
  '#dbc084',
  '#78c2c8',
  '#d6bbcd',
  '#edf0df',
];
export function neighbors(index, w, h) {
  if (!Number.isInteger(index) || index < 0 || index >= w * h) return [];
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
export function stagePlan(level, difficulty = 1) {
  const [w, h, cell] = [
      [9, 8, 28],
      [10, 9, 26],
      [12, 9, 24],
    ][level - 1],
    mask = Array(w * h).fill(true);
  if (level === 2)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (
          ((x === 4 || x === 5) && (y < 3 || y > 5)) ||
          (x === 0 && y === 0) ||
          (x === 9 && y === 8)
        )
          mask[y * w + x] = false;
  if (level === 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (
          ((x === 5 || x === 6) && y >= 3 && y <= 5) ||
          ((x === 0 || x === 11) && (y === 0 || y === 8))
        )
          mask[y * w + x] = false;
  const count = [
      [8, 10, 14],
      [10, 12, 16],
      [12, 14, 18],
    ][difficulty - 1][level - 1],
    regions = [];
  if (level === 3)
    for (let n = 0; n < 3; n++)
      regions.push({
        id: n,
        name: { en: ['West', 'Centre', 'East'][n], zh: ['西区', '中区', '东区'][n] },
        cells: mask.flatMap((v, i) => (v && Math.floor((i % w) / 4) === n ? [i] : [])),
      });
  return {
    w,
    h,
    mask,
    count,
    regions,
    layout: { x: (480 - w * cell) / 2, y: level === 2 ? 48 : level === 3 ? 62 : 54, cell },
  };
}
function fieldFrom(w, h, count, mines, mask, regions = []) {
  const numbers = mines.map((_, i) =>
    mask[i] ? neighbors(i, w, h).filter((n) => mines[n]).length : 0,
  );
  return Object.freeze({
    w,
    h,
    count,
    mask: Object.freeze(mask.slice()),
    mines: Object.freeze(mines.slice()),
    numbers: Object.freeze(numbers),
    regions: Object.freeze(
      regions.map((r) =>
        Object.freeze({
          ...r,
          cells: Object.freeze(r.cells.slice()),
          total: r.cells.filter((i) => mines[i]).length,
        }),
      ),
    ),
  });
}
export function createField(
  w,
  h,
  count,
  first,
  random,
  mask = Array(w * h).fill(true),
  regions = [],
) {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    mask.length !== w * h ||
    !Number.isInteger(first) ||
    !mask[first] ||
    !Number.isInteger(count) ||
    count < 0
  )
    throw new RangeError('Invalid field geometry or opening');
  const excluded = new Set([first, ...neighbors(first, w, h)]),
    candidates = [];
  for (let i = 0; i < w * h; i++) if (mask[i] && !excluded.has(i)) candidates.push(i);
  if (count > candidates.length)
    throw new RangeError('Mine count exceeds the safe-opening capacity');
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const mines = Array(w * h).fill(false);
  for (const i of candidates.slice(0, count)) mines[i] = true;
  return fieldFrom(w, h, count, mines, mask, regions);
}
export function revealCells(field, revealed, flags, index) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= field.w * field.h ||
    (!field.mask?.[index] && field.mask) ||
    revealed[index] ||
    flags[index] ||
    field.mines[index]
  )
    return [];
  const seen = new Set(),
    queue = [index];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (seen.has(i) || revealed[i] || flags[i] || field.mines[i] || (field.mask && !field.mask[i]))
      continue;
    seen.add(i);
    if (field.numbers[i] === 0)
      for (const n of neighbors(i, field.w, field.h)) if (!seen.has(n)) queue.push(n);
  }
  return [...seen];
}
const cellName = (i, w) => String.fromCharCode(65 + (i % w)) + (Math.floor(i / w) + 1);
// The proof engine never reads hidden numbers or mine locations. Unverified
// player flags are hypotheses, not premises; probes supply verified mine facts.
export function deduceVisible(field, revealed, verified = Array(field.w * field.h).fill(false)) {
  const constraints = [];
  const add = (cells, count, title) => {
    if (cells.length && count >= 0 && count <= cells.length)
      constraints.push({ cells: cells.toSorted((a, b) => a - b), count, title });
  };
  for (let i = 0; i < revealed.length; i++)
    if (revealed[i]) {
      const near = neighbors(i, field.w, field.h).filter((n) => field.mask[n]);
      add(
        near.filter((n) => !revealed[n] && !verified[n]),
        field.numbers[i] - near.filter((n) => verified[n]).length,
        { en: `Clue ${cellName(i, field.w)}`, zh: `线索 ${cellName(i, field.w)}` },
      );
    }
  add(
    field.mask.flatMap((v, i) => (v && !revealed[i] && !verified[i] ? [i] : [])),
    field.count - verified.filter(Boolean).length,
    { en: 'Total mine count', zh: '总雷数' },
  );
  for (const r of field.regions || [])
    add(
      r.cells.filter((i) => !revealed[i] && !verified[i]),
      r.total - r.cells.filter((i) => verified[i]).length,
      { en: `${r.name.en} sector`, zh: r.name.zh },
    );
  const safe = new Set(),
    mines = new Set(),
    proofs = new Map();
  for (let pass = 0; pass < field.w * field.h; pass++) {
    let progress = false;
    const reduced = [],
      seen = new Set();
    const inspect = (c) => {
      const type = c.count === 0 ? 'safe' : c.count === c.cells.length ? 'mine' : null;
      if (type)
        for (const i of c.cells) {
          const set = type === 'safe' ? safe : mines;
          if (!set.has(i)) {
            set.add(i);
            progress = true;
            proofs.set(i, {
              target: i,
              type,
              source: c.title,
              cells: c.cells.slice(),
              count: c.count,
            });
          }
        }
    };
    for (const original of constraints) {
      const cells = original.cells.filter((i) => !safe.has(i) && !mines.has(i)),
        count = original.count - original.cells.filter((i) => mines.has(i)).length;
      if (!cells.length || count < 0 || count > cells.length) continue;
      const key = cells.join(',') + ':' + count;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = { ...original, cells, count };
      reduced.push(c);
      inspect(c);
    }
    if (!progress) {
      const before = reduced.slice();
      for (const a of before)
        for (const b of before)
          if (a.cells.length < b.cells.length && a.cells.every((i) => b.cells.includes(i))) {
            const cells = b.cells.filter((i) => !a.cells.includes(i)),
              count = b.count - a.count,
              key = cells.join(',') + ':' + count;
            if (count < 0 || count > cells.length || seen.has(key)) continue;
            seen.add(key);
            const c = {
              cells,
              count,
              title: {
                en: `${b.title.en} minus ${a.title.en}`,
                zh: `${b.title.zh}减去${a.title.zh}`,
              },
            };
            inspect(c);
            if (reduced.length < 256) reduced.push(c);
          }
    }
    if (!progress && reduced.length === constraints.length) break;
    constraints.splice(0, constraints.length, ...reduced);
    if (!constraints.length) break;
  }
  return {
    safe: [...safe].toSorted((a, b) => a - b),
    mines: [...mines].toSorted((a, b) => a - b),
    proofs,
  };
}
export function deductionSolves(field, first) {
  const revealed = Array(field.w * field.h).fill(false),
    known = revealed.slice();
  const open = (i) => {
    for (const n of revealCells(field, revealed, known, i)) revealed[n] = true;
  };
  open(first);
  const needed = field.mask.filter(Boolean).length - field.count;
  for (let pass = 0; pass < field.w * field.h; pass++) {
    if (revealed.filter(Boolean).length === needed) return true;
    const d = deduceVisible(field, revealed, known);
    if (!d.safe.length && !d.mines.length) return false;
    for (const i of d.mines) {
      if (!field.mines[i]) return false;
      known[i] = true;
    }
    for (const i of d.safe) {
      if (field.mines[i]) return false;
      open(i);
    }
  }
  return false;
}
export function certifiedField(plan, first, random) {
  const seed = Math.floor(random() * 4294967296) >>> 0;
  for (let attempt = 0; attempt < 96; attempt++) {
    let value = (seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
    const local = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
    const field = createField(plan.w, plan.h, plan.count, first, local, plan.mask, plan.regions);
    if (deductionSolves(field, first)) return field;
  }
  return fallbackField(plan, first);
}
export function fallbackField(plan, first) {
  // A distant edge band is solvable on every supported terrain/opening pair.
  // Exhaustive tests certify this bounded fallback independently of random retries.
  const excluded = new Set([first, ...neighbors(first, plan.w, plan.h)]),
    top = Math.floor(first / plan.w) >= plan.h / 2,
    candidates = [];
  for (let row = 0; row < plan.h; row++) {
    const y = top ? row : plan.h - 1 - row;
    for (let x = 0; x < plan.w; x++) {
      const i = y * plan.w + x;
      if (plan.mask[i] && !excluded.has(i)) candidates.push(i);
    }
  }
  const mines = Array(plan.w * plan.h).fill(false);
  for (const i of candidates.slice(0, plan.count)) mines[i] = true;
  return fieldFrom(plan.w, plan.h, plan.count, mines, plan.mask, plan.regions);
}
function setBoard(s) {
  const plan = stagePlan(s.level, s.difficulty);
  Object.assign(s, {
    width: plan.w,
    height: plan.h,
    mask: plan.mask,
    mineCount: plan.count,
    regions: plan.regions,
    layout: plan.layout,
    field: null,
    revealed: Array(plan.w * plan.h).fill(false),
    flags: Array(plan.w * plan.h).fill(false),
    questions: Array(plan.w * plan.h).fill(false),
    verified: Array(plan.w * plan.h).fill(false),
    cursor: Math.floor(plan.h / 2) * plan.w + Math.floor(plan.w / 2),
    tapMode: 0,
    flagMode: false,
    probes: 4 - s.difficulty,
    elapsed: 0,
    betweenStages: false,
    exploded: -1,
    triggered: [],
    inspect: -1,
    hint: null,
    pulse: 0,
    nav: { direction: null, delay: 0 },
  });
  if (!s.mask[s.cursor]) s.cursor = s.mask.findIndex(Boolean);
  s.notice = {
    en:
      s.level === 1
        ? 'First opening and its active neighbors are safe.'
        : s.level === 2
          ? 'Rubble is inactive; diagonal active neighbors still count.'
          : 'Sector totals are additional truthful clues.',
    zh:
      s.level === 1
        ? '首次揭开及其有效相邻格均安全。'
        : s.level === 2
          ? '废石格无效，有效对角格仍计入线索。'
          : '分区雷数是额外的真实线索。',
  };
}
export function createMinefieldState() {
  const s = {
    phase: 'playing',
    score: 0,
    level: 1,
    difficulty: 1,
    campaignStarted: false,
    totalElapsed: 0,
    totalProbesUsed: 0,
    ended: false,
  };
  setBoard(s);
  return s;
}
function notice(s, en, zh) {
  s.notice = { en, zh };
}
function finish(s, env, won) {
  if (s.ended) return;
  s.phase = won ? 'won' : 'lost';
  s.ended = true;
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All three survey sites mapped!'
        : 'A live mine was uncovered. Flags are hypotheses; inspect or probe uncertain ground.',
      won ? '三处勘探地全部探明！' : '触发了地雷。旗帜只是判断，请检查线索或探测不确定地块。',
    ),
  });
}
function openBoard(s, index, env) {
  if (s.field) return;
  s.field = certifiedField(stagePlan(s.level, s.difficulty), index, env.random);
  s.campaignStarted = true;
  s.regions = s.field.regions;
}
function boardClear(s, env) {
  if (s.revealed.filter(Boolean).length !== s.mask.filter(Boolean).length - s.mineCount) return;
  s.score += 500 * s.difficulty;
  s.hint = null;
  s.inspect = -1;
  if (s.level === 3) {
    finish(s, env, true);
    return;
  }
  s.betweenStages = true;
  notice(
    s,
    'Site clear. Enter travels; probe stock is renewed.',
    '本处已探明，回车前往下一处并补充探针。',
  );
  env.sound('win');
}
export function revealAction(s, index, env, chordOnly = false) {
  if (
    s.phase !== 'playing' ||
    s.betweenStages ||
    !Number.isInteger(index) ||
    !s.mask[index] ||
    s.flags[index]
  )
    return;
  if (!s.field) {
    if (chordOnly) {
      notice(s, 'Open a tile before using its clue.', '先揭开地块，才能使用线索。');
      return;
    }
    openBoard(s, index, env);
  }
  let targets = [index];
  if (s.revealed[index]) {
    const near = neighbors(index, s.width, s.height).filter((i) => s.mask[i]),
      flagged = near.filter((i) => s.flags[i]).length;
    if (flagged !== s.field.numbers[index]) {
      notice(
        s,
        `Chord needs ${s.field.numbers[index]} flags here; currently ${flagged}.`,
        `此处展开需要${s.field.numbers[index]}面旗，当前${flagged}面。`,
      );
      return;
    }
    targets = near.filter((i) => !s.revealed[i] && !s.flags[i]);
  } else if (chordOnly) {
    notice(
      s,
      'Chord a revealed number, not a covered tile.',
      '请对已揭开的数字展开，而非未揭开格。',
    );
    return;
  }
  const hit = targets.filter((i) => s.field.mines[i]).toSorted((a, b) => a - b);
  if (hit.length) {
    s.exploded = hit[0];
    s.triggered = hit;
    finish(s, env, false);
    return;
  }
  const opening = new Set();
  for (const target of targets)
    for (const n of revealCells(s.field, s.revealed, s.flags, target)) opening.add(n);
  if (!opening.size) return;
  for (const i of opening) {
    s.revealed[i] = true;
    s.questions[i] = false;
  }
  s.score += opening.size * 10;
  s.pulse = 0.2;
  s.hint = null;
  env.sound('coin');
  boardClear(s, env);
}
export function flagAction(s, index, env) {
  if (s.phase !== 'playing' || s.betweenStages || !s.mask[index] || s.revealed[index]) return;
  if (s.verified[index]) {
    notice(
      s,
      'Probe-confirmed mine: its safety flag stays locked.',
      '探针已确认地雷，安全旗保持锁定。',
    );
    return;
  }
  if (s.flags[index]) {
    s.flags[index] = false;
    s.questions[index] = true;
  } else if (s.questions[index]) s.questions[index] = false;
  else s.flags[index] = true;
  s.hint = null;
  env.sound('move');
}
function inspectAction(s) {
  s.inspect = s.cursor;
  s.hint = null;
  if (!s.field) {
    notice(s, 'Choose any active tile: the first opening is safe.', '任选有效格，第一次揭开安全。');
    return;
  }
  if (s.verified[s.cursor]) {
    notice(
      s,
      `${cellName(s.cursor, s.width)} is a probe-confirmed mine.`,
      `${cellName(s.cursor, s.width)}已被探针确认有雷。`,
    );
    return;
  }
  if (!s.revealed[s.cursor]) {
    notice(
      s,
      'Covered tile: flags and questions are your hypotheses.',
      '未揭开格，旗帜与问号仅表示你的判断。',
    );
    return;
  }
  const near = neighbors(s.cursor, s.width, s.height).filter((i) => s.mask[i]),
    flags = near.filter((i) => s.flags[i]).length,
    hidden = near.filter((i) => !s.revealed[i] && !s.flags[i]).length,
    clue = s.field.numbers[s.cursor];
  notice(
    s,
    `${cellName(s.cursor, s.width)}: clue ${clue}, ${flags} flagged, ${hidden} unmarked. ${flags > clue ? 'Too many flags.' : flags === clue ? 'C can open the unmarked neighbors.' : 'Compare nearby clues.'}`,
    `${cellName(s.cursor, s.width)}：线索${clue}，${flags}面旗，${hidden}未标记。${flags > clue ? '旗帜过多。' : flags === clue ? 'C可展开未标记邻格。' : '请比较附近线索。'}`,
  );
}
function hintAction(s) {
  if (!s.field) {
    notice(
      s,
      'Open the protected first area; hints use only visible clues.',
      '先揭开安全首区，推理只使用可见线索。',
    );
    return;
  }
  const result = deduceVisible(s.field, s.revealed, s.verified),
    safe = result.safe.find((i) => s.flags[i]) ?? result.safe[0],
    target = safe ?? result.mines.find((i) => !s.flags[i]);
  if (target === undefined) {
    notice(
      s,
      'No immediate forced tile. Recheck flags or use a probe.',
      '暂无直接确定格，请复核旗帜或使用探针。',
    );
    return;
  }
  s.hint = result.proofs.get(target);
  s.cursor = target;
  s.inspect = -1;
  const p = s.hint,
    n = cellName(target, s.width),
    verb = p.type === 'safe' ? 'safe' : 'a mine';
  notice(
    s,
    `${n} is ${verb}: ${p.source.en} leaves ${p.count} mines in ${p.cells.length} unresolved tiles.${s.flags[target] && p.type === 'safe' ? ' Clear this mistaken flag.' : ''}`,
    `${n}${p.type === 'safe' ? '安全' : '有雷'}：${p.source.zh}在${p.cells.length}个未确定格中剩${p.count}雷。${s.flags[target] && p.type === 'safe' ? '请清除此错误旗帜。' : ''}`,
  );
}
function probeAction(s, env) {
  const i = s.cursor;
  if (!s.field) {
    notice(
      s,
      'The first opening is already safe; reveal before probing.',
      '首次揭开已经安全，请先揭开再使用探针。',
    );
    return;
  }
  if (s.revealed[i] || s.verified[i]) {
    notice(s, 'This tile is already known; probe saved.', '该格已知，保留探针。');
    return;
  }
  if (s.probes === 0) {
    notice(
      s,
      'No probes left. H still explains visible deductions for free.',
      '探针已耗尽，H仍可免费解释可见推理。',
    );
    return;
  }
  s.probes--;
  s.totalProbesUsed++;
  s.inspect = -1;
  s.hint = null;
  if (s.field.mines[i]) {
    s.flags[i] = true;
    s.questions[i] = false;
    s.verified[i] = true;
    notice(s, 'Probe confirmed a mine; its flag is secured.', '探针确认有雷，已锁定安全旗。');
    env.sound('move');
  } else {
    s.flags[i] = false;
    s.questions[i] = false;
    notice(s, 'Probe confirmed safe ground; revealing it.', '探针确认安全，正在揭开。');
    revealAction(s, i, env);
  }
}
function moveCursor(s, dx, dy) {
  const x = s.cursor % s.width,
    y = Math.floor(s.cursor / s.width),
    limit = dx ? s.width : s.height;
  for (let n = 1; n <= limit; n++) {
    const nx = (x + dx * n + s.width * n) % s.width,
      ny = (y + dy * n + s.height * n) % s.height,
      i = ny * s.width + nx;
    if (s.mask[i]) {
      s.cursor = i;
      s.inspect = -1;
      s.hint = null;
      return;
    }
  }
}
export function updateMinefield(s, dt, input, env) {
  if (s.phase !== 'playing') return;
  dt = Number.isFinite(dt) ? Math.max(0, Math.min(1 / 30, dt)) : 0;
  if (dt === 0) return;
  if (s.betweenStages) {
    if (input.pressed('Enter')) {
      s.level++;
      setBoard(s);
    }
    return;
  }
  if (s.field) {
    s.elapsed += dt;
    s.totalElapsed += dt;
  }
  s.pulse = Math.max(0, s.pulse - dt);
  const ix =
      Number(input.held('ArrowRight', 'KeyD') || input.pressed('ArrowRight', 'KeyD')) -
      Number(input.held('ArrowLeft', 'KeyA') || input.pressed('ArrowLeft', 'KeyA')),
    iy =
      Number(input.held('ArrowDown', 'KeyS') || input.pressed('ArrowDown', 'KeyS')) -
      Number(input.held('ArrowUp', 'KeyW') || input.pressed('ArrowUp', 'KeyW'));
  const direction = ix && !iy ? `${ix},0` : iy && !ix ? `0,${iy}` : null;
  if (direction) {
    const edge = input.pressed(
      ix > 0 ? 'ArrowRight' : ix < 0 ? 'ArrowLeft' : iy > 0 ? 'ArrowDown' : 'ArrowUp',
      ix > 0 ? 'KeyD' : ix < 0 ? 'KeyA' : iy > 0 ? 'KeyS' : 'KeyW',
    );
    if (direction !== s.nav.direction || edge) {
      moveCursor(s, ix, iy);
      s.nav = { direction, delay: 0.28 - dt };
    } else {
      s.nav.delay -= dt;
      if (s.nav.delay <= 1e-9) {
        moveCursor(s, ix, iy);
        s.nav.delay += 0.09;
      }
    }
  } else {
    s.nav.direction = null;
    s.nav.delay = 0;
  }
  let tapped = -1;
  const p = input.pointer;
  if (p.clicked) {
    const x = Math.floor((p.x - s.layout.x) / s.layout.cell),
      y = Math.floor((p.y - s.layout.y) / s.layout.cell);
    if (x >= 0 && x < s.width && y >= 0 && y < s.height && s.mask[y * s.width + x]) {
      s.cursor = y * s.width + x;
      tapped = s.cursor;
    }
  }
  const command = input.pressed('KeyX')
    ? 'probe'
    : input.pressed('KeyH')
      ? 'hint'
      : input.pressed('KeyI')
        ? 'inspect'
        : input.pressed('KeyF')
          ? 'flag'
          : input.pressed('KeyC')
            ? 'chord'
            : input.pressed('Space', 'Enter')
              ? 'reveal'
              : null;
  if (command === 'probe') {
    probeAction(s, env);
    return;
  }
  if (command === 'hint') {
    hintAction(s);
    return;
  }
  if (command === 'inspect') {
    inspectAction(s);
    return;
  }
  if (command === 'flag') {
    flagAction(s, s.cursor, env);
    return;
  }
  if (command === 'chord') {
    revealAction(s, s.cursor, env, true);
    return;
  }
  if (command === 'reveal') {
    revealAction(s, s.cursor, env);
    return;
  }
  if (!s.campaignStarted) {
    const requested = input.pressed('KeyG') ? (s.difficulty % 3) + 1 : 0;
    if (requested && requested !== s.difficulty) {
      s.difficulty = requested;
      setBoard(s);
      notice(
        s,
        'Guide changed before opening; old hypotheses cleared.',
        '首次揭开前已更改指导级别，清除旧标记。',
      );
      return;
    }
  }
  if (input.pressed('KeyV')) {
    s.tapMode = (s.tapMode + 1) % 3;
    s.flagMode = s.tapMode === 1;
    return;
  }
  if (p.clicked && p.x >= 396 && p.x < 474) {
    const mode = [56, 94, 132].findIndex((y) => p.y >= y && p.y < y + 32);
    if (mode >= 0) {
      s.tapMode = mode;
      s.flagMode = mode === 1;
      return;
    }
  }
  if (tapped >= 0) {
    if (s.tapMode === 0) revealAction(s, tapped, env);
    else if (s.tapMode === 1) flagAction(s, tapped, env);
    else inspectAction(s);
  }
}
function drawField(ctx, s, env) {
  background(ctx, ['#203c34', '#303d44', '#283d4e'][s.level - 1]);
  const l = s.layout;
  // Quiet survey lines unify the terrain without obscuring its cell boundaries.
  ctx.strokeStyle = '#ffffff05';
  ctx.lineWidth = 1;
  for (let x = 4; x < 480; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x, 286);
    ctx.stroke();
  }
  const adjacent = s.inspect >= 0 ? new Set(neighbors(s.inspect, s.width, s.height)) : new Set(),
    proof = new Set(s.hint?.cells || []);
  for (let i = 0; i < s.mask.length; i++) {
    const x = l.x + (i % s.width) * l.cell,
      y = l.y + Math.floor(i / s.width) * l.cell,
      c = l.cell;
    if (!s.mask[i]) {
      ctx.fillStyle = '#1b2b30';
      ctx.fillRect(x + 2, y + 2, c - 4, c - 4);
      ctx.strokeStyle = '#6c767160';
      ctx.beginPath();
      ctx.moveTo(x + 6, y + c - 7);
      ctx.lineTo(x + c / 2, y + 6);
      ctx.lineTo(x + c - 6, y + c - 7);
      ctx.closePath();
      ctx.stroke();
      continue;
    }
    const open = s.revealed[i];
    ctx.fillStyle = open ? '#3b5556' : '#a5ac92';
    ctx.fillRect(x + 1, y + 1, c - 2, c - 2);
    if (!open) {
      ctx.fillStyle = '#c3c9aa';
      ctx.fillRect(x + 2, y + 2, c - 4, 2);
      ctx.fillRect(x + 2, y + 2, 2, c - 4);
      ctx.fillStyle = '#677866';
      ctx.fillRect(x + 2, y + c - 4, c - 4, 2);
      ctx.fillRect(x + c - 4, y + 2, 2, c - 4);
      ctx.fillStyle = '#89997d';
      ctx.fillRect(x + c / 2 - 1, y + c / 2 - 1, 2, 2);
    } else if (s.field.numbers[i])
      text(
        ctx,
        String(s.field.numbers[i]),
        x + c / 2,
        y + (c - 20) / 2,
        NUMBER_COLORS[s.field.numbers[i]],
        18,
        'center',
      );
    else {
      ctx.fillStyle = '#759389';
      ctx.fillRect(x + c / 2 - 1, y + c / 2 - 1, 2, 2);
    }
    if (s.flags[i]) {
      ctx.fillStyle = s.verified[i] ? '#8ddfca' : '#754a43';
      ctx.fillRect(x + Math.floor(c / 2) - 4, y + 6, 2, c - 11);
      ctx.fillRect(x + Math.floor(c / 2) - 7, y + c - 7, 10, 2);
      ctx.beginPath();
      ctx.moveTo(x + c / 2 - 2, y + 6);
      ctx.lineTo(x + c / 2 + 6, y + 9);
      ctx.lineTo(x + c / 2 - 2, y + 13);
      ctx.fill();
    } else if (s.questions[i]) text(ctx, '?', x + c / 2, y + (c - 20) / 2, '#493f31', 18, 'center');
    if (s.phase === 'lost' && s.field.mines[i]) {
      ctx.fillStyle = s.triggered.includes(i) ? '#df765f' : '#d2b6a0';
      ctx.beginPath();
      ctx.arc(x + c / 2, y + c / 2, c * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + c / 2 - 1, y + 5, 2, c - 10);
      ctx.fillRect(x + 5, y + c / 2 - 1, c - 10, 2);
    }
    if (adjacent.has(i) || proof.has(i)) {
      ctx.strokeStyle = proof.has(i) ? '#b6d7f0' : '#9dc4b2';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 3, y + 3, c - 6, c - 6);
    }
  }
  const cx = l.x + (s.cursor % s.width) * l.cell,
    cy = l.y + Math.floor(s.cursor / s.width) * l.cell;
  ctx.strokeStyle = s.hint?.type === 'mine' ? '#e7a48a' : s.hint ? '#94e7d0' : '#fff0b4';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + 1, cy + 1, l.cell - 2, l.cell - 2);
  ctx.fillStyle = '#112a30';
  ctx.fillRect(0, 0, 480, 30);
  text(ctx, `${s.level}/3 ${env.t(...TITLES[s.level - 1])}`, 12, 7, '#e4e5c5', 13);
  text(ctx, env.t(`MINES ${s.mineCount}`, `地雷 ${s.mineCount}`), 466, 7, '#edd29c', 12, 'right');
  const safe = s.mask.filter(Boolean).length - s.mineCount,
    done = s.revealed.filter(Boolean).length;
  text(ctx, env.t(`SAFE ${done}/${safe}`, `安全 ${done}/${safe}`), 8, 35, '#bfd6c0', 10);
  text(
    ctx,
    env.t(
      ['GUIDED', 'STANDARD', 'EXPERT'][s.difficulty - 1],
      ['指导', '标准', '专家'][s.difficulty - 1],
    ),
    466,
    35,
    '#bdc9b2',
    10,
    'right',
  );
  if (s.level === 3) {
    for (const r of s.regions) {
      const x = l.x + (r.id * 4 + 2) * l.cell;
      const total = s.field ? r.total : '?';
      text(
        ctx,
        env.t(`${r.name.en} ${total}`, `${r.name.zh} ${total}`),
        x,
        47,
        ['#d2c8a1', '#a9cdc2', '#b7c6e1'][r.id],
        10,
        'center',
      );
    }
    for (const x of [l.x + 4 * l.cell, l.x + 8 * l.cell]) {
      ctx.strokeStyle = '#b5cbcd80';
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, 280);
      ctx.stroke();
    }
  }
  text(ctx, env.t('PROBES', '探针'), 8, 65, '#c5ccae', 9);
  text(ctx, String(s.probes), 28, 79, '#e6d49e', 21, 'center');
  text(ctx, env.t('FLAGS', '旗帜'), 8, 117, '#c5ccae', 9);
  text(ctx, String(s.flags.filter(Boolean).length), 28, 131, '#e1ccb4', 19, 'center');
  text(ctx, env.t('CURSOR', '光标'), 8, 174, '#b5c7b9', 9);
  text(ctx, cellName(s.cursor, s.width), 28, 189, '#f1dda4', 13, 'center');
  for (let m = 0; m < 3; m++) {
    ctx.fillStyle = m === s.tapMode ? '#b6a16d' : '#465e5d';
    ctx.fillRect(396, 56 + m * 38, 78, 32);
    text(
      ctx,
      env.t(['REVEAL', 'MARK', 'SELECT'][m], ['揭开', '标记', '选择'][m]),
      435,
      66 + m * 38,
      m === s.tapMode ? '#182d30' : '#e2dec1',
      10,
      'center',
    );
  }
  text(ctx, env.t('H: proof', 'H：推理'), 435, 188, '#bed2bc', 10, 'center');
  text(ctx, env.t('I: inspect', 'I：检查'), 435, 206, '#bed2bc', 10, 'center');
  text(ctx, env.t('X: probe', 'X：探针'), 435, 224, '#bed2bc', 10, 'center');
  ctx.fillStyle = '#102930';
  ctx.fillRect(0, 287, 480, 33);
  const message = env.t(s.notice.en, s.notice.zh),
    limit = env.lang === 'zh' ? 43 : 81;
  const lines = [];
  let line = '';
  for (const ch of message) {
    if (line.length >= limit && (env.lang === 'zh' || ch === ' ')) {
      lines.push(line);
      line = '';
    }
    line += ch;
  }
  lines.push(line);
  lines
    .slice(0, 2)
    .forEach((v, n) => text(ctx, v.trim(), 240, 291 + n * 13, '#d3d7bf', 10, 'center'));
  if (s.betweenStages) {
    ctx.fillStyle = '#16313bf5';
    ctx.fillRect(72, 126, 336, 82);
    ctx.strokeStyle = '#d6c38e';
    ctx.strokeRect(74, 128, 332, 78);
    text(ctx, env.t('SITE MAPPED', '本处已探明'), 240, 138, '#f0dda2', 17, 'center');
    text(
      ctx,
      env.t('ENTER: next site · probes refilled', '回车前往下一处，探针补满'),
      240,
      175,
      '#c3dac4',
      11,
      'center',
    );
  }
}
export function createGame(env) {
  const s = createMinefieldState();
  return {
    update: (dt, i) => updateMinefield(s, dt, i, env),
    draw: (ctx) => drawField(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      started: !!s.field,
      mines: s.field ? s.field.mines.slice() : Array(s.width * s.height).fill(false),
      numbers: s.field ? s.field.numbers.slice() : Array(s.width * s.height).fill(0),
      status: {
        en: `${TITLES[s.level - 1][0]} ${s.level}/3 · ${s.revealed.filter(Boolean).length}/${s.mask.filter(Boolean).length - s.mineCount} safe · ${s.probes} ${s.probes === 1 ? 'probe' : 'probes'} · ${s.notice.en}`,
        zh: `${TITLES[s.level - 1][1]} ${s.level}/3 · 安全${s.revealed.filter(Boolean).length}/${s.mask.filter(Boolean).length - s.mineCount} · ${s.probes}探针 · ${s.notice.zh}`,
      },
    }),
  };
}
