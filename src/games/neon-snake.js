import { LEVELS, LEVEL_COUNT } from './neon-snake-levels.js';
import { MENU_COLUMNS, menuTarget } from './neon-snake-menu.js';
import {
  createSnakeState,
  readUnlocked,
  updateSnake,
  isGateOpen,
  stepSnake,
  spawnFood,
  advanceLevel,
} from './neon-snake-rules.js';
import { statusText } from './neon-snake-text.js';
import { drawGame } from './neon-snake-hud.js';

export {
  LEVELS,
  LEVEL_COUNT,
  createSnakeState,
  updateSnake,
  isGateOpen,
  stepSnake,
  spawnFood,
  advanceLevel,
};

export const meta = {
  id: 'neon-snake',
  name: { en: 'Neon Snake', zh: '霓虹贪吃蛇' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: `Clear ${LEVEL_COUNT} snake gardens, from an open meadow to a gated, tunnelled grand garden. Each level gives you time to read its tip. Ruin gates swap every few moves and stay open while occupied; underpasses are ordinary connected cells. Hold Space for Focus; release to recharge. C toggles Calm pace. Cleared levels unlock a level select.`,
    zh: `通关${LEVEL_COUNT}座贪吃蛇花园，从开阔草地一直到有闸门和隧道的盛大花园。每关开始前有时间阅读提示。遗迹闸门每隔数步交替，身体占用时保持打开；地下通道由连续格子组成。按住空格消耗专注减速，松开恢复；C切换舒缓速度。通关后可在关卡选择中继续。`,
  },
  keys: [
    {
      label: { en: 'Turn / swipe', zh: '转向 / 滑动' },
      keys: { en: 'Arrows / WASD · swipe', zh: '方向键 / WASD · 滑动' },
    },
    { label: { en: 'Hold Focus; release to refill', zh: '按住专注，松开恢复' }, keys: 'Space' },
    {
      label: { en: 'Next level / choose level', zh: '下一关 / 选择关卡' },
      keys: { en: 'Enter · arrows · tap', zh: '回车 · 方向键 · 点按' },
    },
    { label: { en: 'Calm pace', zh: '舒缓速度' }, keys: 'C' },
  ],
  touchControls: [
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'Space', side: 'right', label: { en: 'Focus', zh: '专注' } },
    { code: 'Enter', side: 'right', label: { en: 'Next', zh: '下一关' } },
    { code: 'KeyC', side: 'right', label: { en: 'Calm', zh: '舒缓' } },
  ],
};

export function createGame(env) {
  let state = createSnakeState(1, env.random),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    state = createSnakeState(menu.cursor, env.random);
    menu = null;
  }
  return {
    update(dt, input) {
      if (state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) {
        menuStep(input);
        return;
      }
      updateSnake(state, dt, input, env);
      unlocked = Math.max(
        unlocked,
        Math.min(LEVEL_COUNT, state.level + (state.betweenGardens ? 1 : 0)),
      );
    },
    draw: (ctx) => drawGame(ctx, state, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(state),
      totalLevels: LEVEL_COUNT,
      unlocked,
      stepTime:
        LEVELS[state.level - 1].period * (state.calm ? 1.35 : 1) * (state.braking ? 1.9 : 1),
      gates: state.gates.map((g) => ({ ...g, open: isGateOpen(state, g) })),
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      status: statusText(state, menu),
    }),
  };
}
