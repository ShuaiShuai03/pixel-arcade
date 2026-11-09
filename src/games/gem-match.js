import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './gem-match-levels.js';
import { MENU_COLUMNS, menuTarget } from './gem-match-menu.js';
import { createGemState, stepGem, gemObjective } from './gem-match-step.js';
import { drawGame, drawMenu, gemSwapPose, instruction } from './gem-match-draw.js';

export { findMatches, applySwap, legalSwaps, makeBoard } from './gem-match-rules.js';
export { LEVELS, LEVEL_COUNT, createGemState, stepGem, gemObjective, gemSwapPose };
export const meta = {
  id: 'gem-match',
  name: { en: 'Gem Match', zh: '宝石花园' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Restore twenty conservatory gardens: match gems to score, gather leaf, sun and dew specimens, and uncover soil beds within a move budget. Tap or drag gems to swap. Illegal swaps cost nothing, dead boards remix for free, and you can pick up where you left off.',
    zh: '修复二十座温室花园：在步数限制内连线得分、收集叶、阳光和露珠标本、清理土壤。点按或拖动宝石即可交换。无效交换不扣步数，无解棋盘会免费重排，并可从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move cursor', zh: '移动光标' }, keys: 'Arrows / WASD' },
    {
      label: { en: 'Select / swap / next garden', zh: '选择 / 交换 / 下一花园' },
      keys: 'Space / Enter',
    },
    {
      label: { en: 'Swap by touch', zh: '触屏交换' },
      keys: {
        en: 'Tap two gems, or drag a gem onto its neighbour',
        zh: '依次点两颗宝石，或把宝石拖向相邻宝石',
      },
    },
    { label: { en: 'Pick a garden', zh: '选择花园' }, keys: 'Tap' },
    { label: { en: 'Hint', zh: '提示' }, keys: 'H' },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '向右' } },
    { code: 'ArrowUp', label: { en: 'Up', zh: '向上' } },
    { code: 'ArrowDown', label: { en: 'Down', zh: '向下' } },
    { code: 'Space', label: { en: 'Select / Next', zh: '选择 / 下一关' } },
    { code: 'KeyH', label: { en: 'Hint', zh: '提示' } },
  ],
};

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT + 1) : 1;
  } catch {
    return 1;
  }
}
const ENGLISH = { t: (en) => en },
  CHINESE = { t: (_, zh) => zh };

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: Math.min(unlocked, LEVEL_COUNT) } : null,
    s = createGemState(env, 1);

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, Math.min(unlocked, LEVEL_COUNT));
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createGemState(env, menu.cursor);
    menu = null;
  }
  return {
    update(dt, input) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      stepGem(s, dt, input, env);
      unlocked = Math.max(
        unlocked,
        s.phase === 'won' ? LEVEL_COUNT + 1 : s.level + (s.mode === 'garden-clear' ? 1 : 0),
      );
    },
    draw: (ctx) =>
      menu ? drawMenu(ctx, env, { cursor: menu.cursor, unlocked }) : drawGame(ctx, s, env),
    getState: () => ({
      ...structuredClone(s),
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      objective: gemObjective(s),
      resolving: !['ready', 'garden-clear', 'terminal'].includes(s.mode),
      status: {
        en: `${LEVELS[s.level - 1].name.en} ${s.level}/${LEVEL_COUNT} · ${s.moves} moves · ${instruction(s, ENGLISH)}`,
        zh: `${LEVELS[s.level - 1].name.zh} ${s.level}/${LEVEL_COUNT} · ${s.moves} 步 · ${instruction(s, CHINESE)}`,
      },
    }),
  };
}
