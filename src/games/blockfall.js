import { LEVELS, LEVEL_COUNT } from './blockfall-levels.js';
import { SHAPES, rotatePiece, turnPiece, canPlace, clearRows } from './blockfall-board.js';
import { MENU_COLUMNS, menuTarget, readUnlocked, saveUnlocked } from './blockfall-menu.js';
import { createBlockState, stepBlock, grounded, landingY } from './blockfall-rules.js';
import { endMessage, statusText } from './blockfall-text.js';
import { drawGame, drawMenu } from './blockfall-draw.js';

export {
  LEVELS,
  LEVEL_COUNT,
  SHAPES,
  rotatePiece,
  turnPiece,
  canPlace,
  clearRows,
  createBlockState,
  stepBlock,
};

export const meta = {
  id: 'blockfall',
  name: { en: 'Blockfall', zh: '方块降临' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: `Rebuild ${LEVEL_COUNT} city districts. Clear lines, dig out marked rubble, drop an I down a shaft for a four-row burst, or finish within a fixed supply of pieces. Preview the next three pieces and hold one for later. X retries a district with its original board, queue and score. Cleared districts unlock a level select.`,
    zh: `重建${LEVEL_COUNT}个城区：消除行数、挖出标记碎砖、让长条落入竖井一次消除四行，或在固定数量的方块内完成目标。可预览接下来三个方块，并暂存一个留待后用。X会用原始棋盘、队列和分数重试本城区。通关后可在城区选择中继续。`,
  },
  keys: [
    { label: { en: 'Move / soft drop', zh: '移动 / 软降' }, keys: 'Arrows / WASD' },
    { label: { en: 'Rotate / reverse', zh: '旋转 / 反转' }, keys: 'Up / W / Z' },
    { label: { en: 'Hard drop / start district', zh: '瞬间落下 / 开始城区' }, keys: 'Space' },
    { label: { en: 'Hold once per lock', zh: '每次锁定前暂存一次' }, keys: 'C / Shift' },
    {
      label: {
        en: 'Retry this district (restores entry score and queue)',
        zh: '重试本城区（恢复初始分数和队列）',
      },
      keys: 'X',
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', label: { en: 'Turn ↻', zh: '顺转↻' } },
    { code: 'KeyZ', label: { en: 'Turn ↺', zh: '逆转↺' } },
    { code: 'ArrowDown', label: { en: 'Soft drop', zh: '软降' } },
    { code: 'Space', label: { en: 'Drop', zh: '落下' } },
    { code: 'KeyC', label: { en: 'Hold', zh: '暂存' } },
    { code: 'KeyX', label: { en: 'Retry district', zh: '重试城区' } },
  ],
};

export function createGame(env) {
  const seed = Math.floor(env.random() * 4294967296);
  let unlocked = readUnlocked(env.progress),
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    s = createBlockState(seed, menu ? menu.cursor : 1),
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createBlockState(seed, menu.cursor);
    menu = null;
  }
  function recordClear() {
    const next = s.phase === 'won' ? LEVEL_COUNT : s.litTimer > 0 ? s.level + 1 : 0;
    if (next <= unlocked) return;
    unlocked = Math.min(LEVEL_COUNT, next);
    saveUnlocked(env.progress, unlocked);
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score: s.score, message: endMessage(s, env) });
  }
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) {
        menuStep(input);
        return;
      }
      const { locks, lines, retries, hold } = s;
      stepBlock(s, dt, input);
      if (s.lines > lines) env.sound('coin');
      else if (s.locks > locks) env.sound('hit');
      else if (s.retries > retries || s.hold !== hold) env.sound('move');
      recordClear();
      if (s.phase !== 'playing' && !ended) finish();
    },
    draw(ctx) {
      if (menu) drawMenu(ctx, { cursor: menu.cursor, unlocked }, env);
      else drawGame(ctx, s, env);
    },
    getState: () => {
      const clone = structuredClone(s);
      delete clone.checkpoint;
      const level = LEVELS[s.level - 1];
      return {
        ...clone,
        totalLevels: LEVEL_COUNT,
        unlocked,
        next: s.preview[0],
        grounded: Boolean(grounded(s)),
        ghostY: landingY(s),
        objective: structuredClone(level),
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
        status: statusText(s, menu),
      };
    },
  };
}
