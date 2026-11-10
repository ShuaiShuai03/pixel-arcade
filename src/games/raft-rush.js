import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT, currentAt } from './raft-rush-levels.js';
import { MENU_COLUMNS, drawSelect, menuTarget } from './raft-rush-menu.js';
import {
  PHYSICS,
  R,
  LOOK_AHEAD,
  TERMINAL_TEXT,
  countFlags,
  createRaftState,
  objectiveOf,
  stepRaft,
  STEP,
} from './raft-rush-step.js';
import { drawScene } from './raft-rush-draw.js';

export { PHYSICS, LEVELS, createRaftState, currentAt, stepRaft };

export const meta = {
  id: 'raft-rush',
  name: { en: 'Raft Rush', zh: '激流木筏' },
  genre: 'sports',
  players: '1',
  touch: true,
  description: {
    en: 'Steer a log raft down twenty rivers. The current always carries you, and your paddling adds to it. Arrows push the raft, Space is a strong paddle stroke that spends stamina, and X holds the raft against the water so you can slow down. Pick up rescue flags, thread the rock gates, cross the back-currents and stop inside the dock marker at the end of each river. Hard hits on banks or rocks cost hull; the raft breaks apart when the hull is gone. Pick any unlocked river and continue where you left off.',
    zh: '驾驶木筏漂流二十段河流。水流始终推着你前进，划桨的力量会叠加在水流之上：方向键推动木筏，空格是消耗体力的强力划桨，X 用来对抗水流减速。拾取救援旗帜，穿过岩石门，冲过逆流，并在每段河流终点的码头标记内停稳。撞上河岸或岩石过猛会损坏船体，船体耗尽木筏即解体。可选择任一已解锁的河流，并从上次进度继续。',
  },
  keys: [
    { label: { en: 'Push the raft', zh: '推动木筏' }, keys: 'Arrows / WASD' },
    {
      label: { en: 'Strong paddle stroke (uses stamina)', zh: '强力划桨（消耗体力）' },
      keys: 'Space',
    },
    { label: { en: 'Hold to brake against the water', zh: '按住逆水减速' }, keys: 'X' },
    {
      label: { en: 'River select', zh: '选择河流' },
      keys: { en: 'Arrows + Space, or tap a river', zh: '方向键 + 空格，或点按河流' },
    },
  ],
  touchControls: [
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Paddle', '划桨', 'right'],
    ['KeyX', 'Brake', '减速', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

const MAX_DT = 0.1;

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
    const level = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a river · ${menu.cursor}/${LEVEL_COUNT} ${level.name.en}`,
      zh: `选择河流 · ${menu.cursor}/${LEVEL_COUNT} ${level.name.zh}`,
    };
  }
  const level = LEVELS[s.index],
    n = countFlags(s),
    goal = s.tip > 0 ? level.tip : objectiveOf(s);
  return {
    en: `Level ${s.index + 1}/${LEVEL_COUNT} · Flags ${n}/${level.flags.length} (need ${level.need}) · Hull ${s.hull} · ${goal.en}`,
    zh: `第 ${s.index + 1}/${LEVEL_COUNT} 关 · 旗帜 ${n}/${level.flags.length}（需 ${level.need}）· 船体 ${s.hull} · ${goal.zh}`,
  };
}

export function createGame(env) {
  const t = env.t;
  let s = createRaftState(0),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null,
    remainder = 0,
    spaceWasHeld = false,
    ended = false;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createRaftState(menu.cursor - 1);
    menu = null;
    remainder = 0;
  }

  function advance(dt, input) {
    const edge = input.pressed('Space') || (input.held('Space') && !spaceWasHeld),
      ctl = {
        dx: (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0),
        dy: (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0),
        brake: input.held('KeyX'),
      };
    remainder += dt;
    for (let first = true; remainder + 1e-9 >= STEP && s.phase === 'playing'; first = false) {
      remainder = Math.max(0, remainder - STEP);
      const before = s.index;
      for (const e of stepRaft(s, { ...ctl, stroke: edge && first })) {
        if (e === 'clear') env.sound('coin');
        else env.sound(e);
      }
      if (s.index > before && env.progress) {
        unlocked = Math.max(unlocked, s.index + 1);
        saveUnlocked(env.progress, s.index + 1);
      }
    }
  }

  function update(dt, input) {
    if (ended || !Number.isFinite(dt) || dt <= 0 || dt > MAX_DT) return;
    const spaceHeld = input.held('Space');
    if (menu) {
      menuStep(input);
      spaceWasHeld = spaceHeld;
      return;
    }
    advance(dt, input);
    spaceWasHeld = spaceHeld;
    if (s.phase === 'playing') return;
    ended = true;
    const won = s.phase === 'won',
      msg = TERMINAL_TEXT[s.phase];
    env.end({ won, score: s.score, message: t(msg.en, msg.zh) });
  }

  function getState() {
    const level = LEVELS[s.index],
      w = currentAt(level, s.x, s.y),
      count = countFlags(s);
    return {
      phase: s.phase,
      score: s.score,
      level: s.index + 1,
      levelName: level.name,
      tip: level.tip,
      totalLevels: LEVEL_COUNT,
      unlocked,
      menu: menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null,
      time: s.t,
      hull: s.hull,
      stamina: s.stamina,
      cooldown: s.cooldown,
      invulnerable: s.invulnerable,
      player: { x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: R },
      water: { vx: w.vx, vy: w.vy },
      flags: {
        got: [...s.got],
        total: level.flags.length,
        need: level.need,
        count,
        list: level.flags,
      },
      rocks: level.rocks,
      gates: level.gates,
      fields: level.fields,
      eddies: level.eddies,
      river: { length: level.length, path: level.path },
      dock: {
        x0: level.dock.x0,
        x1: level.dock.x1,
        open: count >= level.need,
        progress: s.dockTimer / PHYSICS.dockTime,
      },
      camera: { x: s.camX, lookAhead: LOOK_AHEAD },
      prompt: { text: { ...(s.tip > 0 ? level.tip : objectiveOf(s)) } },
      status: statusOf(s, menu),
    };
  }

  return {
    update,
    draw: (ctx) =>
      menu ? drawSelect(ctx, env, { cursor: menu.cursor, unlocked }) : drawScene(ctx, s, t),
    getState,
  };
}
