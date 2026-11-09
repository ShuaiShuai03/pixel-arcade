import { clamp } from '../shared/utils.js';
import { INTRO_BOX, drawMenu, drawWorld } from './shield-sentinel-draw.js';
import { LEVEL_COUNT, LEVELS } from './shield-sentinel-levels.js';
import { MENU_COLUMNS, menuTarget } from './shield-sentinel-menu.js';
import {
  PROMPTS,
  createWorld,
  promptKey,
  snapshot,
  startLevel,
  stepWorld,
} from './shield-sentinel-world.js';

export * from './shield-sentinel-geometry.js';
export {
  LEVELS,
  LEVEL_COUNT,
  PROMPTS,
  createWorld,
  INTRO_BOX,
  drawWorld,
  promptKey,
  snapshot,
  startLevel,
  stepWorld,
};

export const meta = {
  id: 'shield-sentinel',
  name: { en: 'Shield Sentinel', zh: '护盾卫士' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Defend the stone observatory through 20 levels, from a single turret to the Grand Guardian. Hold Space to raise your shield: it covers only the bright arc in front of you, and you cannot move while it is up. Cyan orbs bounce straight back into the turrets; orange slugs are only blocked; red lances ignore the shield, so step out of the red lane. Press X for a short bash against crawlers. A Guardian’s purple-circle slam breaks your shield, so run out of the circle. Progress is saved: pick any cleared level.',
    zh: '穿过20个关卡保卫石砌天文台，从单座炮台一路打到终极巨像。按住空格举盾：盾只覆盖面前明亮的弧形，举盾时不能移动。青色光球会被原路弹回，打中炮台；橙色弹只能被挡下；红色长矛无视护盾，请离开红色通道。按X短距重击爬虫。守护巨像的紫圈重击会击碎护盾，请跑出圆圈。进度会保存，可选择任何已通关的关卡。',
  },
  keys: [
    { label: { en: 'Move / aim facing', zh: '移动 / 瞄准朝向' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Hold to raise the shield (rooted)', zh: '按住举盾（原地不动）' },
      keys: 'Space',
    },
    { label: { en: 'Short bash', zh: '短距重击' }, keys: 'X' },
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
    ['Space', 'Shield (hold)', '举盾（按住）', 'right'],
    ['KeyX', 'Bash', '重击', 'right'],
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

const END_TEXT = {
  won: ['The observatory is safe: every level is cleared!', '天文台得救了：所有关卡已通关！'],
  lost: [
    'The sentinel fell. Heed the red lanes and purple circles, and keep the shield aimed.',
    '卫士倒下了。留意红色通道和紫色圆圈，并把盾对准来袭方向。',
  ],
};
const SOUND_FOR = {
  raise: 'move',
  bash: 'move',
  shoot: 'shoot',
  slam: 'hit',
  hit: 'hit',
  block: 'coin',
  coin: 'coin',
  win: 'win',
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
    w.shieldLatch = target.byKey;
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
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
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
