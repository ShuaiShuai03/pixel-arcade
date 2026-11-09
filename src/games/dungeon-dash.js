import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, buildLevel } from './dungeon-dash-levels.js';
import { MENU_COLUMNS, menuTarget } from './dungeon-dash-menu.js';
import { createDungeonState, stepDungeon } from './dungeon-dash-rules.js';
import { drawDungeon, objective } from './dungeon-dash-draw.js';
import { weaponSegment } from './dungeon-dash-world.js';

export { LEVELS, LEVEL_COUNT, buildLevel, createDungeonState, stepDungeon, weaponSegment };
export const meta = {
  id: 'dungeon-dash',
  name: { en: 'Dungeon Dash', zh: '地牢冲刺' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Clear twenty chambers, from a quiet hall to the Vault Warden. Hold the sword button to sweep, read enemy windups and spike warnings, pull levers, lift the key and reach the exit. Pick a cleared chamber from the select screen.',
    zh: '清理二十座密室，从安静的大厅一直到宝库守卫长。按住攻击键挥剑，观察敌人蓄力和尖刺警告，拉动拉杆，取得钥匙并抵达出口。可在选择界面重玩已通关的密室。',
  },
  keys: [
    { label: { en: 'Move / face', zh: '移动 / 朝向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Hold to swing', zh: '按住挥剑' }, keys: 'Space / J' },
    { label: { en: 'Dodge step', zh: '闪步' }, keys: 'K / Shift' },
    { label: { en: 'Use lever / cache / shrine', zh: '拉杆 / 补给 / 神龛' }, keys: 'E / Enter' },
    { label: { en: 'Drink flask', zh: '饮用药水' }, keys: 'H / X' },
    {
      label: { en: 'Chamber select', zh: '选择密室' },
      keys: { en: 'Arrows + Space, or tap', zh: '方向键 + 空格，或点按' },
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'Space', side: 'right', label: { en: 'Sword', zh: '挥剑' } },
    { code: 'KeyK', side: 'right', label: { en: 'Dodge', zh: '闪步' } },
    { code: 'KeyE', side: 'right', label: { en: 'Use', zh: '使用' } },
    { code: 'KeyH', side: 'right', label: { en: 'Heal', zh: '喝药' } },
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
function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a chamber · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.en}`,
      zh: `选择密室 · ${menu.cursor}/${LEVEL_COUNT} ${LEVELS[menu.cursor - 1].name.zh}`,
    };
  const name = LEVELS[s.level - 1].name,
    task = objective(s);
  return {
    en: `${name.en} ${s.level}/${LEVEL_COUNT} · ${s.health} ${s.health === 1 ? 'heart' : 'hearts'} · ${s.flasks} ${s.flasks === 1 ? 'flask' : 'flasks'} · ${task.en}`,
    zh: `${name.zh} ${s.level}/${LEVEL_COUNT} · ${s.health}颗心 · ${s.flasks}瓶药水 · ${task.zh}`,
  };
}

export function createGame(env) {
  let s = createDungeonState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createDungeonState(menu.cursor);
    menu = null;
  }
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      const before = s.level;
      stepDungeon(s, dt, input, env);
      if (s.level > before) {
        unlocked = Math.max(unlocked, s.level);
        if (env.progress) saveUnlocked(env.progress, s.level);
      }
    },
    draw: (ctx) => drawDungeon(ctx, s, env, menu && { cursor: menu.cursor, unlocked }),
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
