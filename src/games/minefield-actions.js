// Player actions on one field: reveal, chord, mark, inspect, explain, probe, cursor and taps.
import { neighbors, revealCells, certifiedField } from './minefield-field.js';
import { deduceVisible, cellName } from './minefield-solver.js';
import { LEVEL_COUNT, levelOf, planOf, tipOf } from './minefield-levels.js';

const NAV_FIRST = 0.28;
const NAV_REPEAT = 0.09;
const CLEAR_BONUS = 500;
const TILE_SCORE = 10;
export const TAP_MODES = 3;
export const MODE_BUTTON = Object.freeze({ x: 396, w: 78, y: 56, h: 32, step: 38 });
const MAX_DT = 1 / 30;

export function notice(s, en, zh) {
  s.notice = { en, zh };
}

/** Fresh covered field for a level; the mines are placed on the first reveal. */
export function createFieldState(level, score = 0) {
  const plan = planOf(level),
    cells = plan.w * plan.h,
    s = {
      phase: 'playing',
      score,
      level,
      width: plan.w,
      height: plan.h,
      mask: plan.mask,
      mineCount: plan.count,
      regions: plan.regions,
      layout: plan.layout,
      flagLimit: plan.flagLimit,
      probes: plan.probes,
      field: null,
      revealed: Array(cells).fill(false),
      flags: Array(cells).fill(false),
      questions: Array(cells).fill(false),
      verified: Array(cells).fill(false),
      cursor: Math.floor(plan.h / 2) * plan.w + Math.floor(plan.w / 2),
      tapMode: 0,
      betweenStages: false,
      exploded: -1,
      triggered: [],
      inspect: -1,
      hint: null,
      nav: { direction: null, delay: 0 },
      ended: false,
    };
  if (!s.mask[s.cursor]) s.cursor = s.mask.findIndex(Boolean);
  s.notice = tipOf(levelOf(level));
  return s;
}
export const placedFlags = (s) => s.flags.filter((v, i) => v && !s.verified[i]).length;

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
        ? `All ${LEVEL_COUNT} survey fields mapped!`
        : 'A live mine was uncovered. Flags are hypotheses; inspect or probe uncertain ground.',
      won
        ? `${LEVEL_COUNT}处勘探地全部探明！`
        : '触发了地雷。旗帜只是判断，请检查线索或探测不确定地块。',
    ),
  });
}

function boardClear(s, env) {
  if (s.revealed.filter(Boolean).length !== s.mask.filter(Boolean).length - s.mineCount) return;
  s.score += CLEAR_BONUS;
  s.hint = null;
  s.inspect = -1;
  if (s.level === LEVEL_COUNT) return finish(s, env, true);
  s.betweenStages = true;
  notice(s, 'Field clear. Enter travels to the next one.', '本处已探明，回车前往下一处。');
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
  const fresh = !s.field;
  if (fresh && chordOnly) {
    notice(s, 'Open a tile before using its clue.', '先揭开地块，才能使用线索。');
    return;
  }
  if (fresh) {
    try {
      s.field = certifiedField(planOf(s.level), index, env.random);
    } catch {
      notice(s, 'The survey failed to start. Try another tile.', '勘探未能开始，请换一格再试。');
      return;
    }
    s.regions = s.field.regions;
  }
  let targets = fresh ? s.field.opening : [index];
  if (!fresh && s.revealed[index]) {
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
  } else if (!fresh && chordOnly) {
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
  s.score += opening.size * TILE_SCORE;
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
  else if (s.flagLimit && placedFlags(s) >= s.flagLimit) {
    notice(
      s,
      `Flag ration spent: at most ${s.flagLimit}. Clear one first.`,
      `旗帜已用完，最多${s.flagLimit}面，请先清除一面。`,
    );
    return;
  } else s.flags[index] = true;
  s.hint = null;
  env.sound('move');
}

export function inspectAction(s) {
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

export function hintAction(s) {
  if (!s.field) {
    notice(
      s,
      'Open the protected first area; hints use only visible clues.',
      '先揭开安全首区，推理只使用可见线索。',
    );
    return;
  }
  // A certified field always has a safe tile to prove; a mistaken flag on one is offered first.
  const result = deduceVisible(s.field, s.revealed, s.verified),
    target = result.safe.find((i) => s.flags[i]) ?? result.safe[0];
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
    mistaken = s.flags[target];
  notice(
    s,
    `${n} is safe: ${p.source.en} leaves ${p.count} in ${p.cells.length} open tiles.${mistaken ? ' Clear this flag.' : ''}`,
    `${n}安全：${p.source.zh}在${p.cells.length}个未定格中剩${p.count}雷。${mistaken ? '请清除此旗。' : ''}`,
  );
}

export function probeAction(s, env) {
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
  s.inspect = -1;
  s.hint = null;
  s.flags[i] = false;
  s.questions[i] = false;
  if (s.field.mines[i]) {
    s.flags[i] = true;
    s.verified[i] = true;
    notice(s, 'Probe confirmed a mine; its flag is secured.', '探针确认有雷，已锁定安全旗。');
    env.sound('move');
    return;
  }
  notice(s, 'Probe confirmed safe ground; revealing it.', '探针确认安全，正在揭开。');
  revealAction(s, i, env);
}

function moveCursor(s, dx, dy) {
  const x = s.cursor % s.width,
    y = Math.floor(s.cursor / s.width),
    limit = dx ? s.width : s.height;
  for (let n = 1; n <= limit; n++) {
    const i =
      ((y + dy * n + s.height * n) % s.height) * s.width + ((x + dx * n + s.width * n) % s.width);
    if (!s.mask[i]) continue;
    s.cursor = i;
    s.inspect = -1;
    s.hint = null;
    return;
  }
}

const axis = (input, negative, positive) =>
  Number(input.held(...positive) || input.pressed(...positive)) -
  Number(input.held(...negative) || input.pressed(...negative));

function navigate(s, input, dt) {
  const ix = axis(input, ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']),
    iy = axis(input, ['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']),
    direction = ix && !iy ? `${ix},0` : iy && !ix ? `0,${iy}` : null;
  if (!direction) {
    s.nav = { direction: null, delay: 0 };
    return;
  }
  const edge = input.pressed(
    ...(ix > 0
      ? ['ArrowRight', 'KeyD']
      : ix < 0
        ? ['ArrowLeft', 'KeyA']
        : iy > 0
          ? ['ArrowDown', 'KeyS']
          : ['ArrowUp', 'KeyW']),
  );
  if (direction !== s.nav.direction || edge) {
    moveCursor(s, ix, iy);
    s.nav = { direction, delay: NAV_FIRST - dt };
    return;
  }
  s.nav.delay -= dt;
  if (s.nav.delay > 1e-9) return;
  moveCursor(s, ix, iy);
  s.nav.delay += NAV_REPEAT;
}

/** Index of the mode button under the pointer, or -1. */
export function modeButtonAt(x, y) {
  const b = MODE_BUTTON;
  if (!(x >= b.x && x < b.x + b.w)) return -1;
  for (let m = 0; m < TAP_MODES; m++) {
    const top = b.y + m * b.step;
    if (y >= top && y < top + b.h) return m;
  }
  return -1;
}

function pointerTarget(s, p) {
  const x = Math.floor((p.x - s.layout.x) / s.layout.cell),
    y = Math.floor((p.y - s.layout.y) / s.layout.cell);
  return x >= 0 && x < s.width && y >= 0 && y < s.height && s.mask[y * s.width + x]
    ? y * s.width + x
    : -1;
}

const KEY_COMMANDS = [
  ['KeyX', (s, env) => probeAction(s, env)],
  ['KeyH', (s) => hintAction(s)],
  ['KeyI', (s) => inspectAction(s)],
  ['KeyF', (s, env) => flagAction(s, s.cursor, env)],
  ['KeyC', (s, env) => revealAction(s, s.cursor, env, true)],
  ['Space', (s, env) => revealAction(s, s.cursor, env)],
  ['Enter', (s, env) => revealAction(s, s.cursor, env)],
];

/** One simulation step. Invalid or non-positive dt reads no input at all. */
export function updateField(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(MAX_DT, dt);
  if (s.betweenStages) {
    if (!input.pressed('Enter')) return;
    Object.assign(s, createFieldState(s.level + 1, s.score), { tapMode: s.tapMode });
    return;
  }
  navigate(s, input, dt);
  const p = input.pointer ?? {},
    px = Number(p.x),
    py = Number(p.y),
    clicked = Boolean(p.clicked) && Number.isFinite(px) && Number.isFinite(py);
  const tapped = clicked ? pointerTarget(s, { x: px, y: py }) : -1;
  if (tapped >= 0) s.cursor = tapped;
  const command = KEY_COMMANDS.find(([code]) => input.pressed(code));
  if (command) return command[1](s, env);
  if (input.pressed('KeyV')) {
    s.tapMode = (s.tapMode + 1) % TAP_MODES;
    return;
  }
  const mode = clicked ? modeButtonAt(px, py) : -1;
  if (mode >= 0) {
    s.tapMode = mode;
    return;
  }
  if (tapped < 0) return;
  if (s.tapMode === 0) revealAction(s, tapped, env);
  else if (s.tapMode === 1) flagAction(s, tapped, env);
  else inspectAction(s);
}
