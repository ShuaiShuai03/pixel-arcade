import { clamp } from '../shared/utils.js';
import { COURSES, LEVEL_COUNT, PADS, getCourse } from './wallrunner-relay-levels.js';
import { MENU_COLUMNS, drawSelect, menuTarget } from './wallrunner-relay-menu.js';
import {
  LIMITS,
  createRunState,
  movementMode,
  padUnder,
  stepRun,
  wallContact,
} from './wallrunner-relay-step.js';
import { drawRun } from './wallrunner-relay-draw.js';

export { createRunState, getCourse, padUnder, stepRun, wallContact };

export const meta = {
  id: 'wallrunner-relay',
  name: { en: 'Wallrunner Relay', zh: '飞檐接力' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Run the rooftops through twenty courses and touch each beacon. Hold X against a chalk-marked wall to run up it: that spends energy and needs real wall contact. Space jumps, or kicks away from a non-slick wall for a bounded push. Energy refills only on glowing RELAY pads. Falling or running out of energy costs a life and returns you to your last relay pad. Pick any unlocked course and continue where you left off.',
    zh: '穿越二十条屋顶赛道，触碰每条赛道的终点信标。贴着白粉笔标记的墙按住X即可沿墙奔跑，这会消耗能量，并且必须真实贴墙。空格跳跃；贴着非湿滑的墙时空格会蹬离墙面，获得有限的反推力。能量只能在发光的接力台上恢复。坠落或能量耗尽会失去一条生命，并回到最近的接力台。可选择任一已解锁赛道，并从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / Left Right' },
    { label: { en: 'Jump; kick away from a wall', zh: '跳跃；贴墙时蹬墙' }, keys: 'Space' },
    { label: { en: 'Hold to run up a chalk wall', zh: '按住沿粉笔墙奔跑' }, keys: 'X' },
    {
      label: { en: 'Course select', zh: '选择赛道' },
      keys: { en: 'Arrows + Space, or tap a course', zh: '方向键 + 空格，或点按赛道' },
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Jump / Kick', '跳跃 / 蹬墙', 'right'],
    ['KeyX', 'Wall-run (hold)', '沿墙跑（按住）', 'right'],
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
function saveUnlocked(progress, course) {
  try {
    progress.unlock(course);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}
const STATE_NAMES = Object.freeze({
  run: { en: 'WALL-RUN', zh: '沿墙跑' },
  cling: { en: 'CLINGING', zh: '贴墙' },
  air: { en: 'AIRBORNE', zh: '空中' },
  ground: { en: 'RUNNING', zh: '地面' },
  pad: { en: 'RELAYING', zh: '接力补能' },
});
function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a course · ${menu.cursor}/${LEVEL_COUNT} ${COURSES[menu.cursor - 1].name.en}`,
      zh: `选择赛道 · ${menu.cursor}/${LEVEL_COUNT} ${COURSES[menu.cursor - 1].name.zh}`,
    };
  const mode = STATE_NAMES[movementMode(s)];
  return {
    en: `Course ${s.course}/${LEVEL_COUNT} · Energy ${Math.ceil(s.energy)} · Lives ${s.lives} · ${mode.en}`,
    zh: `赛道${s.course}/${LEVEL_COUNT} · 能量${Math.ceil(s.energy)} · 生命${s.lives} · ${mode.zh}`,
  };
}

const END_TEXT = Object.freeze({
  won: Object.freeze([
    'The relay is complete! All twenty courses cleared.',
    '接力完成！二十条赛道全部通关。',
  ]),
  energy: Object.freeze([
    'The energy reserve ran out. Refill at relay pads.',
    '能量耗尽了。请在接力台补充能量。',
  ]),
  fall: Object.freeze(['You fell between the rooftops.', '你从屋顶间坠落了。']),
});
/** The closing line for a finished run: a win, or the reason the last life was lost. */
export function endMessage(t, s) {
  const reason = s.phase === 'won' ? 'won' : s.cause === 'energy' ? 'energy' : 'fall';
  return t(...END_TEXT[reason]);
}

export function createGame(env) {
  let s = createRunState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createRunState(menu.cursor);
    menu = null;
  }
  function finishRun() {
    ended = true;
    const won = s.phase === 'won';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score: s.score,
      message: won
        ? env.t(
            'The relay is complete! All twenty courses cleared.',
            '接力完成！二十条赛道全部通关。',
          )
        : env.t(
            s.cause === 'energy'
              ? 'The energy reserve ran out. Refill at relay pads.'
              : 'You fell between the rooftops.',
            s.cause === 'energy' ? '能量耗尽了。请在接力台补充能量。' : '你从屋顶间坠落了。',
          ),
    });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      const course = s.course,
        lives = s.lives;
      stepRun(s, dt, input);
      if (s.lives < lives) env.sound('hit');
      else if (s.course > course) env.sound('coin');
      else if (s.event === 'jump' || s.event === 'kick') env.sound('move');
      else if (s.event === 'pad') env.sound('coin');
      if (s.course > course) {
        unlocked = Math.max(unlocked, s.course);
        if (env.progress) saveUnlocked(env.progress, s.course);
      }
      if (s.phase !== 'playing') finishRun();
    },
    draw(ctx) {
      if (menu) drawSelect(ctx, env, { cursor: menu.cursor, unlocked });
      else drawRun(ctx, s, env);
    },
    getState() {
      const c = COURSES[s.course - 1],
        p = s.player;
      return {
        ...structuredClone(s),
        courseName: c.name,
        tip: c.tip,
        solids: structuredClone(c.solids),
        pads: structuredClone(PADS[s.course - 1]),
        goal: { ...c.goal },
        mode: movementMode(s),
        onPad: Boolean(padUnder(s)),
        wallContact: wallContact(p, c.solids),
        totalLevels: LEVEL_COUNT,
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
        limits: LIMITS,
        status: statusText(s, menu),
      };
    },
  };
}
