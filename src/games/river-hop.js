import { clamp } from '../shared/utils.js';
import { LEVEL_COUNT, riverLanes } from './river-hop-levels.js';
import { MENU_COLUMNS, menuTarget } from './river-hop-menu.js';
import { createRiverState, stepRiver, riverFeet, riverSupport } from './river-hop-step.js';
import { drawRiver } from './river-hop-draw.js';
import { statusText } from './river-hop-text.js';

export { createRiverState, stepRiver, riverLanes, riverFeet, riverSupport };
export const meta = {
  id: 'river-hop',
  name: { en: 'River Hop', zh: '青蛙过河' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Bring four frogs home across each of twenty crossings, from a quiet ford to turtle marshes and cable ferries. Tap a direction for one hop; hold for repeated hops and release to wait. Both feet need a deck at landing. Cars are taller than your hop. Striped turtles warn before diving; the cable ferry reverses. Reach each home within 45 seconds. Pick up from your latest crossing.',
    zh: '在二十处渡口各护送四只青蛙回家，从安静的浅滩到龟沼和缆绳渡船。轻点方向跳一次，按住连续跳跃，松开等待。落地时双脚都需要浮台支撑，跳跃无法越过车辆。带条纹的乌龟潜水前会预警。每只青蛙须在45秒内到家，并可从最新渡口继续。',
  },
  keys: [
    {
      label: { en: 'Hop / hold to repeat; release to wait', zh: '跳跃 / 按住连跳；松开等待' },
      keys: 'Arrows / WASD',
    },
    {
      label: {
        en: 'Adjust in the air; a late tap buffers the next hop',
        zh: '空中微调；落地前轻点可预存下一跳',
      },
      keys: 'Arrows / WASD',
    },
    {
      label: { en: 'Crossing select', zh: '选择渡口' },
      keys: { en: 'Arrows + Space, or tap a crossing', zh: '方向键 + 空格，或点按渡口' },
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左'],
    ['ArrowRight', 'Right', '右'],
    ['ArrowUp', 'Up', '上'],
    ['ArrowDown', 'Down', '下'],
  ].map(([code, en, zh]) => ({ code, side: 'left', label: { en, zh } })),
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
/** The highest crossing a run has earned: a cleared crossing opens the next one. */
const earnedLevel = (s) => (s.phase === 'won' ? LEVEL_COUNT : s.level + Number(s.transition > 0));

export function createGame(env) {
  let s = createRiverState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createRiverState(menu.cursor);
    menu = null;
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score: s.score,
      message: won
        ? env.t(
            'Eighty frogs home across all twenty crossings!',
            '二十处渡口的八十只青蛙全部到家！',
          )
        : env.t(
            'The crossing needs another try. Wait on grass; watch deck edges and turtle arrows.',
            '再试一次。可在草地等待，留意浮台边缘和乌龟潜水箭头。',
          ),
    });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      const lives = s.lives,
        rescued = s.rescued,
        score = s.score;
      stepRiver(s, dt, input);
      if (s.lives < lives) env.sound('hit');
      else if (s.rescued > rescued) env.sound('coin');
      else if (s.score > score) env.sound('move');
      const earned = earnedLevel(s);
      if (earned > unlocked) {
        unlocked = earned;
        if (env.progress) saveUnlocked(env.progress, earned);
      }
      if (s.phase !== 'playing') finish();
    },
    draw: (ctx) => drawRiver(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
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
