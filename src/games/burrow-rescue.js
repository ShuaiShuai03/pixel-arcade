import { clamp } from '../shared/utils.js';
import { LEVELS, LEVEL_COUNT } from './burrow-rescue-levels.js';
import { RULES, actorPos, drainRate, levelOf, playerRect } from './burrow-rescue-map.js';
import { advance, newState } from './burrow-rescue-sim.js';
import { buildStatus, objectiveOf, shownPrompt, warnings } from './burrow-rescue-view.js';
import { drawBurrow } from './burrow-rescue-draw.js';
import { MENU_COLUMNS, drawMenu, menuTarget } from './burrow-rescue-menu.js';

export { RULES, advance, newState };

export const meta = {
  id: 'burrow-rescue',
  name: { en: 'Burrow Rescue', zh: '地底救援' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Dig tunnels, wake stranded miners and lead them to the lift through twenty mine levels. Space digs the earth you face. Four dug tiles in a row (three in loose soil) crack and collapse when the countdown ends: press X on a dug tile to place a beam and split the tunnel. Air drains underground and refills at the surface or from tanks. X also wakes a miner beside you. Stand on the lift while they walk to it. Pick a level on the select screen and continue where you left off.',
    zh: '挖掘隧道，唤醒被困矿工，并在二十个矿区关卡中带他们回到升降梯。空格键挖开面前的泥土。连续挖出4格隧道（松软土为3格）会出现裂缝，倒计时结束后坍塌：在挖出的格子上按X放置支架即可分段。氧气在地下持续下降，在地面或氧气罐处补充。X也可唤醒身边的矿工。矿工走向升降梯时请站在梯上等候。可在选择界面挑选关卡，并从上次进度继续。',
  },
  keys: [
    { label: { en: 'Move / face', zh: '移动 / 转向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Dig the earth you face', zh: '挖掘面前的泥土' }, keys: 'Space' },
    { label: { en: 'Place a beam / wake a miner', zh: '放置支架 / 唤醒矿工' }, keys: 'X' },
    {
      label: { en: 'Level select', zh: '选择关卡' },
      keys: { en: 'Arrows + Space, or tap a level', zh: '方向键 + 空格，或点按关卡' },
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Dig', '挖掘', 'right'],
    ['KeyX', 'Beam / Guide', '支架 / 带人', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

/** Saved progress as a level number; a missing, throwing or junk store counts as level 1. */
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT + 1) : 1;
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
  const spec = LEVELS[menu.cursor - 1];
  return {
    en: `Choose a level · ${menu.cursor}/${LEVEL_COUNT} ${spec.name.en}`,
    zh: `选择关卡 · ${menu.cursor}/${LEVEL_COUNT} ${spec.name.zh}`,
  };
}

export function createGame(env) {
  let s = newState();
  let unlocked = env.progress ? readUnlocked(env.progress) : 1;
  let menu = unlocked > 1 ? { cursor: Math.min(unlocked, LEVEL_COUNT) } : null;
  let ended = false;
  const emit = (name) => env.sound(name);

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, Math.min(unlocked, LEVEL_COUNT));
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = newState(menu.cursor - 1);
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
        ? env.t(
            'All twenty mine levels are clear. Every miner is home!',
            '二十个矿区关卡全部通关，矿工们都平安回家了！',
          )
        : env.t(
            `The mine took your last life on level ${s.level + 1}. Brace and watch your air.`,
            `矿井在第${s.level + 1}关夺走了最后一条生命。记得加支架，留意氧气。`,
          ),
    });
  }
  return {
    update(dt, input) {
      if (ended) return;
      if (menu) return menuStep(input);
      const before = s.level;
      if (!advance(s, dt, input, emit)) return;
      if (s.level > before) {
        unlocked = Math.max(unlocked, s.level + 1);
        if (env.progress) saveUnlocked(env.progress, unlocked);
      }
      if (s.phase === 'won') {
        // One past the last level marks it cleared on the select screen.
        unlocked = LEVEL_COUNT + 1;
        if (env.progress) saveUnlocked(env.progress, unlocked);
      }
      if (s.phase !== 'playing') finish();
    },
    draw(ctx) {
      if (menu) drawMenu(ctx, { cursor: menu.cursor, unlocked }, env);
      else drawBurrow(ctx, s, env);
    },
    getState() {
      const warns = warnings(s);
      const prompt = shownPrompt(s, warns);
      const p = s.player;
      const level = levelOf(s);
      return {
        phase: s.phase,
        score: s.score,
        lives: s.lives,
        time: s.ticks * RULES.step,
        level: s.level + 1,
        totalLevels: LEVEL_COUNT,
        levelName: level.name,
        tip: level.tip,
        cleared: s.cleared,
        unlocked: Math.min(unlocked, LEVEL_COUNT),
        completed: unlocked > LEVEL_COUNT,
        menu: menu
          ? {
              cursor: menu.cursor,
              unlocked: Math.min(unlocked, LEVEL_COUNT),
              total: LEVEL_COUNT,
              columns: MENU_COLUMNS,
            }
          : null,
        oxygen: s.oxygen,
        oxygenDrain: drainRate(s),
        beams: s.beams,
        beamsMax: level.beams,
        fuse: level.fuse,
        lift: { ...s.lift },
        tiles: s.grid.map((row) => row.join('')),
        tanks: s.tanks.map((t) => ({ ...t })),
        warnings: warns,
        miners: s.miners.map((m) => ({
          id: m.id,
          c: m.c,
          r: m.r,
          state: m.state,
          order: m.order,
          blocked: m.blocked,
          moving: m.prog > 0,
          rect: { ...actorPos(m, RULES.minerTicks), w: 24, h: RULES.tile },
        })),
        minersRescued: s.miners.filter((m) => m.state === 'rescued').length,
        minersTotal: s.miners.length,
        player: {
          c: p.c,
          r: p.r,
          from: { ...p.from },
          moving: p.prog > 0,
          digging: p.dig > 0,
          facing: { ...p.facing },
          hurt: p.hurt > 0,
          rect: playerRect(s),
        },
        camera: { x: 0, y: RULES.top, width: 480, height: RULES.rows * RULES.tile },
        hud: { top: [0, RULES.top], bottom: [RULES.top + RULES.rows * RULES.tile, 320] },
        objective: objectiveOf(s),
        prompt: { en: prompt.en, zh: prompt.zh },
        message: s.message ? { en: s.message.en, zh: s.message.zh } : null,
        stats: { ...s.stats },
        status: menu ? menuStatus(menu) : buildStatus(s, prompt),
      };
    },
  };
}
