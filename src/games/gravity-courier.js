import { clampLevel, COURIER_ROOMS, LEVEL_COUNT } from './gravity-courier-rooms.js';
import { MENU_COLUMNS, menuTarget } from './gravity-courier-menu.js';
import { courierDockCue, courierField, courierLanding, room } from './gravity-courier-physics.js';
import { createCourierState, stepCourier } from './gravity-courier-step.js';
import { drawCourier } from './gravity-courier-draw.js';
import { statusText } from './gravity-courier-text.js';

export {
  COURIER_ROOMS,
  courierDockCue,
  courierField,
  courierLanding,
  createCourierState,
  drawCourier,
  stepCourier,
};
export const meta = {
  id: 'gravity-courier',
  name: { en: 'Gravity Courier', zh: '重力信使' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Carry fragile mail through twenty powered-field chambers. Space reverses acceleration, never momentum: reverse near halfway to brake a landing. X collects, delivers, or repacks at the source. Bulkheads, windows and marked strong/weak field zones change your route and braking distance. Three spare packs per chamber allow recovery, and you can pick up where you left off.',
    zh: '在二十座动力场舱室运送易碎邮件。空格只反转加速度，不改变动量：接近半程时反向制动。X收取、交付或在起点重新包装。隔板、窗口及标明的强弱场区会改变路线和制动距离。每个舱室有三个备用包装，并可从上次进度继续。',
  },
  keys: [
    { label: { en: 'Thrusters / brake', zh: '推进 / 制动' }, keys: 'A D / ← →' },
    { label: { en: 'Reverse powered field', zh: '反转动力场' }, keys: 'Space / W / ↑' },
    {
      label: { en: 'Collect / hand off / repack / next', zh: '收取 / 交付 / 重新包装 / 下一舱' },
      keys: 'X / Enter',
    },
    {
      label: { en: 'Chamber select', zh: '选择舱室' },
      keys: { en: 'Arrows + Space, or tap a chamber', zh: '方向键 + 空格，或点按舱室' },
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Left', zh: '向左' } },
    { code: 'ArrowRight', label: { en: 'Right', zh: '向右' } },
    { code: 'Space', label: { en: 'Reverse field', zh: '反转动力场' } },
    { code: 'KeyX', label: { en: 'Handle / Next', zh: '装卸 / 下一舱' } },
  ],
};

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

export function createGame(env) {
  let s = createCourierState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    savedFor = 0;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createCourierState(menu.cursor);
    menu = null;
  }
  function recordProgress() {
    if (s.mode !== 'clear' || savedFor === s.level) return;
    savedFor = s.level;
    unlocked = Math.max(unlocked, s.level + 1);
    if (env.progress) saveUnlocked(env.progress, s.level + 1);
  }
  return {
    update(dt, input) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      stepCourier(s, dt, input, env);
      recordProgress();
    },
    draw: (ctx) => drawCourier(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
    getState: () => ({
      ...structuredClone(s),
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      fieldStrength: courierField(s),
      fieldAcceleration: s.gravity * courierField(s),
      flipCooldown: Math.max(0, s.flipReadyAt - s.time),
      walls: room(s).walls.map((w) => ({ ...w })),
      zones: room(s).zones.map((z) => ({ ...z })),
      source: { ...room(s).source },
      destination: { ...room(s).destination },
      landing: courierLanding(s),
      docking: courierDockCue(s),
      status: statusText(s, menu),
    }),
  };
}
