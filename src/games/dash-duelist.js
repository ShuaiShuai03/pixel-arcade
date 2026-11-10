import { clamp } from '../shared/utils.js';
import { drawMenu, drawWorld } from './dash-duelist-draw.js';
import { LEVEL_COUNT } from './dash-duelist-levels.js';
import { MENU_COLUMNS, menuTarget } from './dash-duelist-menu.js';
import { createWorld, snapshot, stepWorld, validDt } from './dash-duelist-world.js';

export * from './dash-duelist-art.js';
export * from './dash-duelist-draw.js';
export * from './dash-duelist-geometry.js';
export * from './dash-duelist-levels.js';
export * from './dash-duelist-menu.js';
export * from './dash-duelist-world.js';

export const meta = {
  id: 'dash-duelist',
  name: { en: 'Dash Duelist', zh: '瞬步决斗' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Win 20 duels in a stone courtyard. A rival that raises its weapon paints a red danger shape on the floor and cannot change it: step out of the shape or press X to dash through it. After every attack the rival is open for a moment, and only then does Space strike hurt it (one clean hit per opening), so wait for the yellow OPEN mark, close in and cut. Magenta !! shapes are heavy and cost 3 HP. Dash is a short burst that cannot be hit for a fraction of a second and uses one of three charges that refill slowly. Progress is saved: pick any cleared level.',
    zh: '在石砌庭院中连胜20场决斗。对手举起武器时，地面会出现红色危险区域，且无法再改变：走出区域，或按X闪身穿过。每次攻击之后对手都会露出破绽，只有此时空格出招才能伤到它（每次破绽只能击中一次），所以请等黄色“破绽”标记出现，再贴近砍出。洋红色!!区域是重击，扣3点生命。闪身是短促冲刺，短暂内无法被击中，消耗三个会缓慢恢复的冲刺次数之一。进度会保存，可选择任何已通关的关卡。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Strike (only hurts an open rival)', zh: '出招（只能伤到露出破绽的对手）' },
      keys: 'Space',
    },
    {
      label: { en: 'Dash (brief invulnerability, 3 charges)', zh: '闪身（短暂无敌，3 次）' },
      keys: 'X',
    },
    {
      label: { en: 'Level select: choose / start / or tap', zh: '选关：选择 / 开始 / 或点按' },
      keys: 'Arrows / Space',
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Strike', '出招', 'right'],
    ['KeyX', 'Dash', '闪身', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
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

const SOUND_FOR = {
  strike: 'shoot',
  dash: 'move',
  hurt: 'hit',
  guard: 'hit',
  stagger: 'coin',
  dodge: 'coin',
  defeat: 'coin',
};
const END_TEXT = {
  won: [
    `All ${LEVEL_COUNT} rivals defeated. You are the courtyard champion!`,
    `${LEVEL_COUNT}位对手尽数击败，你是庭院冠军！`,
  ],
  lost: [
    'You fell in the courtyard. Read the windups and try again.',
    '你倒在了庭院中。看清起手，再试一次。',
  ],
};

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1;
  let menu = unlocked > 1 ? { cursor: unlocked } : null;
  let w = createWorld(env.random, 1);
  let ended = false;
  let lastLevel = 1;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    w = createWorld(env.random, menu.cursor);
    lastLevel = w.level;
    menu = null;
  }
  function finish() {
    ended = true;
    const won = w.phase === 'won',
      [en, zh] = END_TEXT[w.phase];
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score: w.score, message: env.t(en, zh) });
  }
  return {
    update(dt, input) {
      if (ended || !validDt(dt)) return;
      if (menu) return menuStep(input);
      stepWorld(w, dt, input);
      for (const e of new Set(w.events)) if (SOUND_FOR[e]) env.sound(SOUND_FOR[e]);
      if (w.level > lastLevel) {
        lastLevel = w.level;
        unlocked = Math.max(unlocked, w.level);
        if (env.progress) saveUnlocked(env.progress, w.level);
      }
      if (w.phase !== 'playing') finish();
    },
    draw(ctx) {
      if (menu) drawMenu(ctx, env, { cursor: menu.cursor, unlocked });
      else drawWorld(ctx, w, env);
    },
    getState() {
      return {
        ...snapshot(w),
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
      };
    },
  };
}
