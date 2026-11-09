import { clamp } from '../shared/utils.js';
import { COURSES, LEVEL_COUNT } from './glider-ridge-levels.js';
import { PHYSICS, MAX_DT, terrainAt, windAt, liftCoefficient } from './glider-ridge-world.js';
import { createGliderState, stepGlider } from './glider-ridge-physics.js';
import { describe, statusLine } from './glider-ridge-guidance.js';
import { drawGlider } from './glider-ridge-draw.js';
import { MENU_COLUMNS, menuTarget, drawSelect } from './glider-ridge-menu.js';

export {
  COURSES,
  PHYSICS,
  terrainAt,
  windAt,
  liftCoefficient,
  createGliderState,
  stepGlider,
  describe,
  statusLine,
  drawGlider,
};
export const meta = {
  id: 'glider-ridge',
  name: { en: 'Glider Ridge', zh: '滑翔山脊' },
  genre: 'sports',
  players: '1',
  touch: true,
  description: {
    en: 'Fly a motorless fabric glider through twenty ridge courses, from a gentle meadow glide to gusty needle crests. Pass the gates in order, then land on the marked pad. Pitch trades altitude for speed; pull too far and the wing stalls. Thermals and ridge lift are the only energy sources, crosswinds push you sideways, and a flare slows you for touchdown. A hard landing or terrain strike costs one of three attempts per course. Cleared courses unlock in the course select.',
    zh: '驾驶无动力织物滑翔翼飞越二十条山脊赛道，从平缓草甸到多阵风的针峰。依次穿过检查门，再降落在标记的着陆台上。俯仰可用高度换速度，拉得过猛机翼会失速。只有热气流和山脊上升气流能补充能量，侧风会把你吹偏，拉平可在触地前减速。硬着陆或撞山会消耗该赛道三次机会之一。通关的赛道会在选择界面解锁。',
  },
  keys: [
    { label: { en: 'Pitch: nose up / nose down', zh: '俯仰：抬头 / 低头' }, keys: 'Up Down / W S' },
    {
      label: { en: 'Bank and steer left / right', zh: '向左 / 向右倾斜转向' },
      keys: 'Left Right / A D',
    },
    {
      label: { en: 'Hold to flare (slow for landing)', zh: '按住拉平（着陆减速）' },
      keys: 'Space',
    },
    {
      label: { en: 'Course select / relaunch', zh: '选择赛道 / 重新起飞' },
      keys: { en: 'Arrows + Space, or tap', zh: '方向键 + 空格，或点按' },
    },
  ],
  touchControls: [
    ['ArrowUp', 'Nose up', '抬头', 'left'],
    ['ArrowDown', 'Nose down', '低头', 'left'],
    ['ArrowLeft', 'Bank left', '左倾', 'right'],
    ['ArrowRight', 'Bank right', '右倾', 'right'],
    ['Space', 'Flare', '拉平', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Progress counts the next course to unlock; one past the last means every course is cleared.
const ALL_CLEARED = LEVEL_COUNT + 1;
const SOUND_FOR_EVENT = Object.freeze({
  gate: 'gate',
  coin: 'coin',
  win: 'win',
  lose: 'lose',
  crash: 'hit',
  miss: 'hit',
  move: 'move',
});

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, ALL_CLEARED) : 1;
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
function menuStatus(menu) {
  const course = COURSES[menu.cursor - 1];
  return {
    en: `Choose a course · ${menu.cursor}/${LEVEL_COUNT} ${course.name.en}`,
    zh: `选择赛道 · ${menu.cursor}/${LEVEL_COUNT} ${course.name.zh}`,
  };
}

export function createGame(env) {
  let s = createGliderState(0),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: Math.min(unlocked, LEVEL_COUNT) } : null,
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, Math.min(unlocked, LEVEL_COUNT));
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createGliderState(menu.cursor - 1);
    menu = null;
  }
  function recordClear() {
    const next = s.course + 2;
    if (next <= unlocked) return;
    unlocked = next;
    if (env.progress) saveUnlocked(env.progress, next);
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    env.end({
      won,
      score: s.score,
      message: won
        ? env.t('All twenty ridges flown with precise landings!', '二十条山脊飞行完成，着陆精准！')
        : env.t(
            'Out of attempts. Fly smoother and use the lift.',
            '机会用完了。飞得更平稳，并利用好上升气流。',
          ),
    });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0 || dt > MAX_DT) return;
      if (menu) return menuStep(input);
      stepGlider(s, dt, input);
      for (const name of s.events.splice(0)) env.sound(SOUND_FOR_EVENT[name]);
      if (s.phase === 'landed' || s.phase === 'won') recordClear();
      if (s.phase === 'won' || s.phase === 'lost') finish();
    },
    draw(ctx) {
      if (menu) drawSelect(ctx, env, menu, unlocked);
      else drawGlider(ctx, s, env);
    },
    getState: () => ({
      ...describe(s),
      levels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      status: menu ? menuStatus(menu) : describe(s).status,
    }),
  };
}
