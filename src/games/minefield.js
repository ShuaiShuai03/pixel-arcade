import { clamp } from '../shared/utils.js';
import { createFieldState, updateField } from './minefield-actions.js';
import { drawField, drawMenu } from './minefield-draw.js';
import { LEVEL_COUNT, LEVELS, levelOf } from './minefield-levels.js';
import { MENU_COLUMNS, menuTarget } from './minefield-menu.js';

export const meta = {
  id: 'minefield',
  name: { en: 'Minefield', zh: '扫雷远征' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Survey 20 fields by logic alone. Reveal every safe tile; clues count mines in the eight neighboring active cells. Rubble is inactive, sectors show truthful totals, and some fields pre-open tiles or ration flags. The first opening is safe and every field can be cleared without guessing. F cycles marks, C chords exact flags, I inspects, H explains a deduction, X spends a probe. V changes tap mode; Enter travels after a clear.',
    zh: '用逻辑勘探20处雷场，揭开所有安全地块；数字统计周围八个有效格内的雷。废石格无效，分区显示真实雷数，部分场地预开安全格或限制旗帜。首次揭开安全，每处都无需猜测。F循环标记，C按旗数展开，I检查，H解释推理，X消耗探针。V切换点击模式，通关后回车前进。',
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
    {
      label: { en: 'Field select', zh: '选择勘探地' },
      keys: { en: 'Arrows + Space, or tap a field', zh: '方向键 + 空格，或点按勘探地' },
    },
  ],
  touchControls: [
    { code: 'KeyV', side: 'left', label: { en: 'Tap mode', zh: '点击模式' } },
    { code: 'KeyI', side: 'left', label: { en: 'Inspect', zh: '检查' } },
    { code: 'KeyH', side: 'left', label: { en: 'Hint', zh: '推理' } },
    { code: 'Space', side: 'right', label: { en: 'Reveal', zh: '揭开' } },
    { code: 'KeyF', side: 'right', label: { en: 'Mark', zh: '标记' } },
    { code: 'KeyC', side: 'right', label: { en: 'Chord', zh: '展开' } },
    { code: 'KeyX', side: 'right', label: { en: 'Probe', zh: '探针' } },
    { code: 'Enter', side: 'right', label: { en: 'Next', zh: '下一关' } },
  ],
};

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}

export function createGame(env) {
  let s = createFieldState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    saved = 0;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createFieldState(menu.cursor);
    menu = null;
  }
  function recordClear() {
    if (!(s.betweenStages || s.phase === 'won') || saved >= s.level) return;
    saved = s.level;
    unlocked = Math.max(unlocked, Math.min(LEVEL_COUNT, s.level + 1));
    if (env.progress) saveUnlocked(env.progress, unlocked);
  }
  return {
    update(dt, input) {
      if (s.ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      updateField(s, dt, input, env);
      recordClear();
    },
    draw: (ctx) => (menu ? drawMenu(ctx, env, { ...menu, unlocked }) : drawField(ctx, s, env)),
    getState() {
      const { field, ...view } = structuredClone({ ...s, field: null }),
        solved = s.phase !== 'playing';
      return {
        ...view,
        started: !!s.field,
        totalLevels: LEVEL_COUNT,
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
        numbers: s.revealed.map((open, i) => (open ? s.field.numbers[i] : null)),
        mines: solved && s.field ? s.field.mines.slice() : [],
        status: statusOf(s, menu),
      };
    },
  };
}

function statusOf(s, menu) {
  if (menu) {
    const level = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a field · ${menu.cursor}/${LEVEL_COUNT} ${level.name.en}`,
      zh: `选择勘探地 · ${menu.cursor}/${LEVEL_COUNT} ${level.name.zh}`,
    };
  }
  const level = levelOf(s.level),
    safe = s.mask.filter(Boolean).length - s.mineCount,
    done = s.revealed.filter(Boolean).length;
  return {
    en: `${level.name.en} ${s.level}/${LEVEL_COUNT} · ${done}/${safe} safe · ${s.probes} ${s.probes === 1 ? 'probe' : 'probes'} · ${s.notice.en}`,
    zh: `${level.name.zh} ${s.level}/${LEVEL_COUNT} · 安全${done}/${safe} · ${s.probes}探针 · ${s.notice.zh}`,
  };
}
