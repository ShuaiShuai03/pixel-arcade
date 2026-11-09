import { LEVELS, deepFreeze } from './bubble-pop-levels.js';
import {
  cellsLeft,
  createBubbleState,
  creaturesLeft,
  resolveBubble,
  neighbors,
  bubblePoint,
} from './bubble-pop-rules.js';
import { stepBubble } from './bubble-pop-step.js';
import { drawBubble } from './bubble-pop-draw.js';
import { MENU_COLUMNS, menuTarget, readUnlocked } from './bubble-pop-menu.js';

export { createBubbleState, stepBubble, resolveBubble, neighbors, bubblePoint };
export const meta = deepFreeze({
  id: 'bubble-pop',
  name: { en: 'Bubble Pop', zh: '泡泡消消乐' },
  description: {
    en: `Clear ${LEVELS.length} air-table caverns. Match three symbols to open drain sockets, cut anchored links to drop whole groups, and free the trapped crabs. Bank off the rails, swap the next capsule and watch the moving pusher. Every symbol has its own shape. Progress is saved, so you can pick any cleared cavern.`,
    zh: `挑战 ${LEVELS.length} 座气垫洞穴。连接三个同符号泡泡开启排放槽，切断锚定连接让整组掉落，并放出被困的螃蟹。利用导轨反弹、交换下个泡泡，并留意移动推板。每种符号都有独特形状。进度会保存，可选择任何已通关的洞穴。`,
  },
  genre: 'puzzle',
  players: '1',
  touch: true,
  keys: [
    {
      label: { en: 'Aim', zh: '瞄准' },
      keys: { en: 'A / D · Left / Right · Drag to aim', zh: 'A / D · 左右方向键 · 拖动瞄准' },
    },
    {
      label: { en: 'Shoot', zh: '发射' },
      keys: {
        en: 'Space / Enter · Click target to aim and shoot',
        zh: '空格 / 回车 · 点击目标后瞄准发射',
      },
    },
    {
      label: { en: 'Swap next bubble', zh: '交换下一个泡泡' },
      keys: { en: 'X · Tap the NEXT bubble', zh: 'X · 点按下个泡泡' },
    },
    {
      label: { en: 'Level select: choose / launch / or tap', zh: '选关：选择 / 出发 / 或点按' },
      keys: { en: 'Arrows · Space / Enter · Tap a cavern', zh: '方向键 · 空格 / 回车 · 点按洞穴' },
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Aim left', zh: '左瞄准' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Aim right', zh: '右瞄准' } },
    { code: 'Space', side: 'right', label: { en: 'Shoot', zh: '发射' } },
    { code: 'KeyX', side: 'right', label: { en: 'Swap', zh: '交换' } },
  ],
});

function statusText(s, menu) {
  const spec = LEVELS[(menu ? menu.cursor : s.level) - 1];
  if (menu)
    return {
      en: `Choose a cavern · ${menu.cursor}/${LEVELS.length} ${spec.name.en}`,
      zh: `选择洞穴 · ${menu.cursor}/${LEVELS.length} ${spec.name.zh}`,
    };
  const goal =
    s.goal === 'free'
      ? { en: `${creaturesLeft(s)} crabs to free`, zh: `还需放出 ${creaturesLeft(s)} 只螃蟹` }
      : { en: `${cellsLeft(s)} capsules`, zh: `${cellsLeft(s)} 个泡泡` };
  const budget = s.shotBudget
    ? { en: ` · ${s.shotsLeft} shots left`, zh: ` · 还剩 ${s.shotsLeft} 发` }
    : { en: '', zh: '' };
  return {
    en: `Cavern ${s.level}/${s.totalLevels} · ${goal.en}${budget.en} · ${s.maxMisses - s.misses} misses before pusher`,
    zh: `洞穴 ${s.level}/${s.totalLevels} · ${goal.zh}${budget.zh} · 再失误 ${s.maxMisses - s.misses} 次后推板移动`,
  };
}

export function createGame(env) {
  const unlocked = readUnlocked(env);
  let s = createBubbleState(env, 1),
    menu = unlocked > 1 ? { cursor: unlocked } : null;
  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createBubbleState(env, menu.cursor);
    menu = null;
  }
  return {
    update(dt, input) {
      if (menu) {
        if (Number.isFinite(dt) && dt > 0) menuStep(input);
        return;
      }
      stepBubble(s, dt, input, env);
    },
    draw: (ctx) => drawBubble(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(s),
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVELS.length, columns: MENU_COLUMNS }
        : null,
      remaining: cellsLeft(s),
      creatures: creaturesLeft(s),
      cavern: { en: LEVELS[s.level - 1].name.en, zh: LEVELS[s.level - 1].name.zh },
      tip: LEVELS[s.level - 1].tip,
      status: statusText(s, menu),
    }),
  };
}
