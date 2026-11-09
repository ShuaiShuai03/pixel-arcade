import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, makeBricks } from './starbreaker-levels.js';
import { MENU_COLUMNS, menuTarget } from './starbreaker-menu.js';
import { createBreakerState, stepBreaker, circleRect } from './starbreaker-step.js';
import { drawBreaker } from './starbreaker-draw.js';

export { makeBricks, createBreakerState, stepBreaker, circleRect };
export const meta = {
  id: 'starbreaker',
  name: { en: 'Starbreaker', zh: '星砖破坏者' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Launch', zh: '发球' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Catch', zh: '接球' } },
  ],
  description: {
    en: 'Clear twenty orbital fields, from a plain lattice to chain reactors and drifting fleets. Steer with the paddle edge, catch upgrades, use emergency catches (Down), and pick up where you left off.',
    zh: '清除二十片轨道砖阵，从简单晶格到连锁反应堆和漂移舰队。用球拍边缘控制反弹，接住强化，下键可紧急接球，并可从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move paddle', zh: '移动球拍' }, keys: 'Left / Right or A / D; drag' },
    { label: { en: 'Launch ball', zh: '发球' }, keys: 'Space / Up / click' },
    {
      label: { en: 'Emergency catch', zh: '紧急接球' },
      keys: { en: 'Down / S (3 charges)', zh: '↓ / S（3次）' },
    },
    {
      label: { en: 'Field select', zh: '选择区域' },
      keys: { en: 'Arrows + Space, or tap a field', zh: '方向键 + 空格，或点按区域' },
    },
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
function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a field · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.en}`,
      zh: `选择区域 · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.zh}`,
    };
  return {
    en: `Field ${s.level}/${LEVEL_COUNT} · ${s.lives} balls`,
    zh: `区域 ${s.level}/${LEVEL_COUNT} · ${s.lives} 个球`,
  };
}

export function createGame(env) {
  let s = createBreakerState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false,
    lastScore = 0,
    lastLives = s.lives,
    lastLevel = 1;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createBreakerState(menu.cursor);
    lastLevel = s.level;
    menu = null;
  }
  function finish() {
    ended = true;
    env.sound(s.phase === 'won' ? 'win' : 'lose');
    env.end({
      won: s.phase === 'won',
      score: s.score,
      message:
        s.phase === 'won'
          ? env.t('All orbital fields cleared!', '所有轨道砖阵已清除！')
          : env.t('Out of balls. The stars await another try.', '小球用完了，再次挑战星空吧。'),
    });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      stepBreaker(s, dt, input, env.random);
      if (s.score > lastScore) env.sound('coin');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.level > lastLevel) {
        lastLevel = s.level;
        unlocked = Math.max(unlocked, s.level);
        if (env.progress) saveUnlocked(env.progress, s.level);
      }
      if (s.phase !== 'playing') finish();
    },
    draw: (ctx) => drawBreaker(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(s),
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      status: statusText(s, menu),
    }),
  };
}
