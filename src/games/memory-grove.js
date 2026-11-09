import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './memory-grove-levels.js';
import { MENU_COLUMNS, menuTarget } from './memory-grove-menu.js';
import {
  createLevelState,
  memoryCardOpen,
  nextLevelState,
  stepMemory,
} from './memory-grove-rules.js';
import { drawMemory, drawSelect } from './memory-grove-draw.js';
import { promptText } from './memory-grove-text.js';

export { createLevelState, drawMemory, memoryCardOpen, stepMemory };
export { makeDeck } from './memory-grove-rules.js';
export const meta = {
  id: 'memory-grove',
  name: { en: 'Memory Grove', zh: '记忆森林' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Restore twenty woodland clearings: match pairs, follow numbered lanterns, find triples and repeat lit echoes. Watch the timing strip, keep your leaves, and pick up where you left off.',
    zh: '修复二十片林间空地：配对、按编号灯笼顺序配对、寻找三张一组，并重复亮起的回声顺序。留意计时条，保住叶子，并可从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move focus', zh: '移动焦点' }, keys: 'Arrows / WASD' },
    {
      label: {
        en: 'Turn card / next / skip preview (or tap)',
        zh: '翻牌 / 下一关 / 跳过预览（或点按）',
      },
      keys: 'Space / Enter',
    },
    { label: { en: 'Choose a card or clearing', zh: '选择卡片或空地' }, keys: 'Tap' },
    { label: { en: 'Relaxed mode (no clock)', zh: '休闲模式（不计时）' }, keys: 'T' },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '向右' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '向上' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '向下' } },
    { code: 'Space', side: 'right', label: { en: 'Turn / Next', zh: '翻牌 / 下一关' } },
    { code: 'KeyT', side: 'right', label: { en: 'Relax', zh: '休闲' } },
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
/** A JSON copy of the state without the hidden deck and echo answer. */
function publicCopy(s) {
  const copy = structuredClone(s);
  delete copy.deck;
  delete copy.sequence;
  return copy;
}

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1,
    s = createLevelState(1, env.random),
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false,
    savedFor = 0;

  function finish() {
    ended = true;
    env.end({
      won: s.phase === 'won',
      score: s.score,
      message:
        s.phase === 'won'
          ? env.t('All twenty clearings restored!', '二十片林间空地全部修复！')
          : env.t('The clearing fell asleep. Visit again.', '林间空地睡着了。再来探访一次吧。'),
    });
  }
  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createLevelState(menu.cursor, env.random);
    menu = null;
  }
  function record() {
    const reached = Math.min(LEVEL_COUNT, s.level + 1);
    if (savedFor === s.level) return;
    savedFor = s.level;
    unlocked = Math.max(unlocked, reached);
    if (env.progress) saveUnlocked(env.progress, reached);
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      stepMemory(s, dt, input, env.sound);
      if (s.mode === 'level-clear' || s.phase === 'won') record();
      if (s.next) s = nextLevelState(s, env.random);
      if (s.phase !== 'playing') finish();
    },
    draw: (ctx) => (menu ? drawSelect(ctx, env, { ...menu, unlocked }) : drawMemory(ctx, s, env)),
    getState: () => {
      const visible = s.deck.map((value, i) => (memoryCardOpen(s, i) >= 0.5 ? value : null)),
        def = LEVELS[s.level - 1];
      return {
        ...publicCopy(s),
        visible,
        deck: visible.slice(),
        totalLevels: LEVEL_COUNT,
        unlocked,
        columns: def.layout.cols,
        cards: def.layout.cards,
        timing: {
          preview: def.preview,
          show: def.show,
          cue: def.echo?.cue ?? 0,
          gap: def.echo?.gap ?? 0,
        },
        lit: s.echo ? s.echo.lit : -1,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
        status: {
          en: `Clearing ${s.level}/${LEVEL_COUNT} ${def.name.en} · ${promptText(s, (en) => en)}`,
          zh: `空地 ${s.level}/${LEVEL_COUNT} ${def.name.zh} · ${promptText(s, (_, zh) => zh)}`,
        },
      };
    },
  };
}
