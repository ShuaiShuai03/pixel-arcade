import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './clockwork-bridge-levels.js';
import { MENU_COLUMNS, drawMenu, menuTarget } from './clockwork-bridge-menu.js';
import {
  GEAR_REACH,
  GRAVITY,
  JUMP_SPEED,
  REWIND_KEY,
  RUN_SPEED,
  bridgePhase,
  createMachine,
  nearestGear,
  stepMachine,
} from './clockwork-bridge-step.js';
import { PLAYER_SPRITES, drawMachine } from './clockwork-bridge-draw.js';

export { createMachine, stepMachine, PLAYER_SPRITES };
export const meta = {
  id: 'clockwork-bridge',
  name: { en: 'Clockwork Bridge', zh: '发条桥梁' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Escape twenty clockwork machines. Stand near a brass gear and press X to turn it: linked rods slide ferries, lift decks and presses at a finite speed, and decks carry you along. Take the key with Z, carry it across, then press Z at the locked exit door. A press that meets you or a key simply jams. Falling into the pit costs a life and rewinds the machine; Q rewinds for free. Pick a machine from the select screen and continue where you left off.',
    zh: '逃出二十台发条机器。靠近黄铜齿轮按X转动它：连杆会以有限速度推动渡台、升降台和压板，台面会带着你移动。按Z拿起钥匙，带过去后在上锁的出口门前再按Z开锁。压板碰到你或钥匙时只会卡住。坠入深坑会失去一条命并让机器复位，按Q可免费复位。可在选择界面挑选机器，并从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / Left Right' },
    {
      label: { en: 'Jump (buffered, short edge grace)', zh: '跳跃（有缓冲和边缘宽限）' },
      keys: 'Space',
    },
    { label: { en: 'Turn the nearby gear', zh: '转动附近的齿轮' }, keys: 'X' },
    { label: { en: 'Take, drop or use a key', zh: '拿起、放下或使用钥匙' }, keys: 'Z' },
    { label: { en: 'Rewind the machine (free)', zh: '免费复位机器' }, keys: 'Q' },
    {
      label: { en: 'Machine select', zh: '选择机器' },
      keys: { en: 'Arrows + Space, or tap a machine', zh: '方向键 + 空格，或点按机器' },
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Jump', '跳跃', 'right'],
    ['KeyX', 'Gear', '转齿轮', 'right'],
    ['KeyZ', 'Key', '钥匙', 'right'],
    [REWIND_KEY, 'Rewind', '复位', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

/** Saved progress as a machine number; a missing, throwing or junk store counts as machine 1. */
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

function statusOf(s, menu) {
  if (menu) {
    const m = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a machine · ${menu.cursor}/${LEVEL_COUNT} ${m.name.en}`,
      zh: `选择机器 · ${menu.cursor}/${LEVEL_COUNT} ${m.name.zh}`,
    };
  }
  const m = LEVELS[s.machine],
    carried = s.keys.some((k) => k.state === 'carried');
  return {
    en: `Machine ${s.level}/${LEVEL_COUNT} ${m.name.en} · Lives ${s.lives} · ${carried ? 'Key carried' : 'No key'} · Stuck? Press Q to rewind · ${m.tip.en}`,
    zh: `机器 ${s.level}/${LEVEL_COUNT} ${m.name.zh} · 生命 ${s.lives} · ${carried ? '携带钥匙' : '无钥匙'} · 卡住了？按Q复位 · ${m.tip.zh}`,
  };
}

function soundFor(before, s, env) {
  const st = s.stats;
  if (st.falls > before.falls || st.jams > before.jams) env.sound('hit');
  else if (s.cleared > before.cleared || st.picks > before.picks || st.unlocks > before.unlocks)
    env.sound('coin');
  else if (st.jumps > before.jumps || st.cranks > before.cranks || st.drops > before.drops)
    env.sound('move');
}

export function createGame(env) {
  let s = createMachine(0),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createMachine(menu.cursor - 1);
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
        ? env.t('You escaped all twenty clockwork machines!', '你逃出了全部二十台发条机器！')
        : env.t('The machines swallowed you. Try again.', '机器吞没了你。再试一次。'),
    });
  }
  return {
    update(dt, input) {
      if (ended) return;
      if (menu) return menuStep(input);
      const before = { ...s.stats, score: s.score, cleared: s.cleared, level: s.level };
      if (!stepMachine(s, dt, input)) return;
      soundFor(before, s, env);
      if (s.level > before.level) {
        unlocked = Math.max(unlocked, s.level);
        if (env.progress) saveUnlocked(env.progress, s.level);
      }
      if (s.phase !== 'playing') finish();
    },
    draw(ctx) {
      if (menu) drawMenu(ctx, { cursor: menu.cursor, unlocked }, env);
      else drawMachine(ctx, s, env);
    },
    getState() {
      const gearNear = s.phase === 'playing' ? nearestGear(s) : null,
        phases = s.bridges.map(bridgePhase);
      return {
        ...structuredClone(s),
        bridges: s.bridges.map((b, i) => ({ ...structuredClone(b), phase: phases[i] })),
        nearGear: gearNear ? gearNear.id : null,
        carryingKey: s.keys.some((k) => k.state === 'carried'),
        machineName: LEVELS[s.machine].name,
        totalLevels: LEVEL_COUNT,
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
        jumpEnvelope: {
          speed: JUMP_SPEED,
          gravity: GRAVITY,
          height: (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY),
          runSpeed: RUN_SPEED,
          gearReach: GEAR_REACH,
        },
        status: statusOf(s, menu),
      };
    },
  };
}
