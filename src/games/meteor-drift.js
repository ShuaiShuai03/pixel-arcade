import { wrap } from './meteor-drift-math.js';
import { LEVELS, LEVEL_COUNT, clampLevel, makeRocks } from './meteor-drift-levels.js';
import { MENU_COLUMNS, menuTarget } from './meteor-drift-menu.js';
import { createMeteorState, stepMeteors } from './meteor-drift-step.js';
import { drawMeteors, drawWrappedRock, drawWrappedShip } from './meteor-drift-draw.js';

export { wrap, makeRocks, createMeteorState, stepMeteors, drawWrappedRock, drawWrappedShip };
export const meta = {
  id: 'meteor-drift',
  name: { en: 'Meteor Drift', zh: '陨石漂流' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Turn left', zh: '左转' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Turn right', zh: '右转' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Thrust', zh: '推进' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Brake', zh: '刹车' } },
    { code: 'ShiftLeft', side: 'right', label: { en: 'Burst', zh: '蓄能弹' } },
  ],
  description: {
    en: 'Clear twenty-two asteroid sectors, from slow stone to fast mixed belts. Turn jets retain spin; counter-turn or hold Down to brake. Fire with Space; Shift launches a charged round. Each sector has limited ammunition, and your progress is saved.',
    zh: '清理二十二个陨石星区，从缓慢的岩石到高速混合陨石带。转向后会保持旋转，可反向转动或按下键制动。空格射击，Shift发射蓄能弹。每个星区弹药有限，进度会自动保存。',
  },
  keys: [
    { label: { en: 'Turn', zh: '转向' }, keys: 'Left / Right or A / D' },
    { label: { en: 'Thrust', zh: '推进' }, keys: 'Up / W' },
    { label: { en: 'Fire', zh: '射击' }, keys: 'Space / Z' },
    { label: { en: 'Counter-thrust / burst', zh: '反推制动 / 蓄能弹' }, keys: 'Down / S; Shift' },
    {
      label: { en: 'Sector select', zh: '选择星区' },
      keys: { en: 'Arrows + Space, or tap a sector', zh: '方向键 + 空格，或点按星区' },
    },
  ],
};
const STEP = 1 / 240;
const MAX_FRAME = 1 / 30;
const STEP_TOLERANCE = 1e-9;

function readUnlocked(progress) {
  try {
    return clampLevel(progress.unlocked());
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
/** The host's input with every value made safe: junk pointers become "no pointer". */
function cleanInput(input) {
  const pointer = input?.pointer ?? {},
    x = Number(pointer.x),
    y = Number(pointer.y),
    aimed = Number.isFinite(x) && Number.isFinite(y);
  return {
    held: (...codes) => Boolean(input?.held?.(...codes)),
    pressed: (...codes) => Boolean(input?.pressed?.(...codes)),
    pointer: {
      x: aimed ? x : -1,
      y: aimed ? y : -1,
      down: Boolean(pointer.down),
      clicked: Boolean(pointer.clicked),
    },
  };
}
const withoutEdges = (input) => ({
  ...input,
  pressed: () => false,
  pointer: { ...input.pointer, clicked: false },
});
function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a sector · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.en}`,
      zh: `选择星区 · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.zh}`,
    };
  return {
    en: `Sector ${s.level}/${LEVEL_COUNT} · ${s.rocks.length} rocks · Hull ${s.hull}/3 · Ammo ${s.ammo + s.reserve}`,
    zh: `星区 ${s.level}/${LEVEL_COUNT} · ${s.rocks.length} 块陨石 · 船体 ${s.hull}/3 · 弹药 ${s.ammo + s.reserve}`,
  };
}

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1,
    s = createMeteorState(env.random, 1),
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false,
    carry = 0,
    lastScore = 0,
    lastLives = s.lives,
    lastLevel = 1;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createMeteorState(env.random, menu.cursor);
    lastLevel = s.level;
    menu = null;
  }
  function finish() {
    ended = true;
    env.sound(s.phase === 'won' ? 'win' : 'lose');
    env.end({
      won: s.phase === 'won',
      score: s.score,
      message:
        s.phase === 'won'
          ? env.t(
              'All twenty-two sectors secured. Welcome home, pilot.',
              '二十二个星区已清理。欢迎归航，飞行员。',
            )
          : s.reason === 'ammo'
            ? env.t(
                'Ammunition exhausted. Reload and reserve management matter.',
                '弹药耗尽。请留意装填与储备。',
              )
            : env.t('Your fleet is gone. Plot a new course.', '舰队损失殆尽，重新规划航线吧。'),
    });
  }
  return {
    update(dt, rawInput) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      const input = cleanInput(rawInput);
      if (menu) return menuStep(input);
      const bullets = s.shotsFired;
      carry += Math.min(dt, MAX_FRAME);
      for (
        let first = true;
        carry >= STEP - STEP_TOLERANCE && s.phase === 'playing';
        first = false
      ) {
        stepMeteors(s, STEP, first ? input : withoutEdges(input), env.random);
        carry -= STEP;
      }
      if (s.shotsFired > bullets) env.sound('shoot');
      if (s.score > lastScore || s.level > lastLevel) env.sound('hit');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.level > lastLevel) {
        lastLevel = s.level;
        unlocked = Math.max(unlocked, s.level);
        if (env.progress) saveUnlocked(env.progress, s.level);
      }
      if (s.phase !== 'playing') finish();
    },
    draw: (ctx) => drawMeteors(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
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
