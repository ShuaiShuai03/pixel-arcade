import { clamp } from '../shared/utils.js';
import {
  INVADERS,
  RULES,
  SPRITE,
  STEP,
  TILE,
  TOP,
  FIELD_BOTTOM,
  facingOf,
  isIdle,
  isLive,
  rootTilesAt,
  stageOf,
  GROW_TICKS,
} from './vine-warden-core.js';
import { LEVELS, LEVEL_COUNT } from './vine-warden-levels.js';
import { MENU_COLUMNS, drawMenu, menuTarget } from './vine-warden-menu.js';
import { PROMPTS, buildStatus, promptText, refreshPrompt } from './vine-warden-prompts.js';
import { isBare, pestRoute } from './vine-warden-route.js';
import { advance, loadLevel, newState } from './vine-warden-world.js';
import { pestPos, playerPos, render, targetKind } from './vine-warden-draw.js';

export { INVADERS, LEVELS, LEVEL_COUNT, PROMPTS, RULES, advance, loadLevel, newState, render };

export const meta = {
  id: 'vine-warden',
  name: { en: 'Vine Warden', zh: '藤蔓守卫' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Guard the greenhouse through 20 levels, from a single beetle road to the Grand Greenhouse. You carry no weapon: plant seeds with Space on brown soil beside the pest path. A plant needs 6 seconds to grow (seed, sprout, bud, bloom) and only a full bloom has live roots, shown as orange hatched tiles. Roots hold a pest and bite it once every 0.8 seconds; each bloom has 4 bites. Press X facing a bloom to harvest it: 2 seeds back (1 once its bites are spent), so seeds never run out. Weevils sense live roots and take another lane when they can. Every pest that reaches the garden bloom costs 1 health. Progress is saved: pick any cleared level.',
    zh: '穿过20个关卡守护温室，从单条甲虫小路一路守到大温室。你没有武器：按空格键把种子种在虫道旁的棕色泥土上。植物需要6秒成长（种子、幼苗、花苞、盛开），只有盛开的植物才有活跃的根，根会显示为橙色斜纹地砖。根会抓住害虫，每0.8秒咬一口，每株盛开的植物有4口。面对盛开的植物按X收获：返还2颗种子（根的次数用完后返还1颗），所以种子永远不会耗尽。象鼻虫能察觉活跃的根，有路可绕时会改走另一条道。每只抵达花圃之心的害虫会扣1点生命。进度会保存，可选择任何已通关的关卡。',
  },
  keys: [
    {
      label: { en: 'Walk / turn (tap to turn)', zh: '移动 / 转向（轻点转向）' },
      keys: 'WASD / Arrows',
    },
    { label: { en: 'Plant a seed on soil you face', zh: '在面前的泥土上播种' }, keys: 'Space' },
    { label: { en: 'Harvest the plant you face', zh: '收获面前的植物' }, keys: 'X' },
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
    ['Space', 'Plant', '播种', 'right'],
    ['KeyX', 'Harvest', '收获', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

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

const END_TEXT = {
  won: [
    'All twenty gardens are safe. The greenhouse thrives!',
    '二十个花圃都守住了，温室生机勃勃！',
  ],
  lost: [
    'Pests overran the garden bloom. Keep blooms ready on the path.',
    '害虫占领了花圃之心。记得让盛开的植物守住虫道。',
  ],
};

function snapshot(s) {
  const prompt = promptText(s);
  const p = s.player;
  const pp = playerPos(p);
  const rect = (pos) => ({ x: pos.x - SPRITE / 2, y: pos.y - SPRITE / 2, w: SPRITE, h: SPRITE });
  const due = s.def.spawns[s.spawned];
  return {
    phase: s.phase,
    score: s.score,
    time: s.ticks * STEP,
    level: s.level,
    levelCount: LEVEL_COUNT,
    tier: s.def.tier,
    levelName: s.def.name,
    tip: s.def.tip,
    seeds: s.seeds,
    seedCap: RULES.seedCap,
    health: Math.max(0, s.health),
    healthMax: s.def.health,
    tiles: s.grid.map((row) => row.join('')),
    heart: {
      ...s.heart,
      rect: { x: s.heart.c * TILE, y: TOP + s.heart.r * TILE, w: TILE, h: TILE },
    },
    gates: s.gates.map((g) => ({ ...g })),
    plants: s.plants.map((q) => ({
      id: q.id,
      c: q.c,
      r: q.r,
      stage: stageOf(q),
      age: q.age * STEP,
      readyIn: Math.max(0, (GROW_TICKS - q.age) * STEP),
      charges: q.charges,
      live: isLive(q),
      idle: isIdle(q),
      spent: stageOf(q) === 3 && q.charges <= 0,
      busy: q.grip !== null,
      rootTiles: rootTilesAt(s, q.c, q.r),
      rect: { x: q.c * TILE, y: TOP + q.r * TILE, w: TILE, h: TILE },
    })),
    pests: s.invaders.map((v) => {
      const pos = pestPos(v);
      return {
        id: v.id,
        kind: v.kind,
        c: v.c,
        r: v.r,
        x: pos.x,
        y: pos.y,
        hp: v.hp,
        held: v.held !== null,
        bare: isBare(s, v),
        route: pestRoute(s, v).map((t) => ({ ...t })),
        rect: rect(pos),
      };
    }),
    pestsLeft: s.def.spawns.length - s.resolved,
    nextPestIn: due ? Math.max(0, due[0] - s.levelTicks * STEP) : null,
    player: {
      c: p.c,
      r: p.r,
      x: pp.x,
      y: pp.y,
      moving: p.left > 0,
      facing: { ...p.facing },
      target: { ...facingOf(p), action: targetKind(s) },
      rect: rect(pp),
    },
    hud: { top: [0, TOP], bottom: [FIELD_BOTTOM, 320] },
    prompt,
    message: s.message ? { en: s.message.en, zh: s.message.zh } : null,
    stats: { ...s.stats },
    status: buildStatus(s, prompt, LEVEL_COUNT),
  };
}

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1;
  // `unlocked` is the next level to play; LEVEL_COUNT + 1 means the whole garden is cleared.
  let menu = unlocked > 1 ? { cursor: Math.min(unlocked, LEVEL_COUNT) } : null;
  let s = newState(1);
  let ended = false;
  const emit = (name) => env.sound(name);

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = newState(menu.cursor);
    menu = null;
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    refreshPrompt(s);
    env.sound(won ? 'win' : 'lose');
    const [en, zh] = END_TEXT[s.phase];
    env.end({ won, score: s.score, message: env.t(en, zh) });
  }
  return {
    update(dt, input) {
      if (ended) return;
      if (menu) return menuStep(input);
      advance(s, dt, input, emit);
      const reached = s.phase === 'won' || s.clear > 0 ? s.level + 1 : 0;
      if (reached > unlocked) {
        unlocked = reached;
        if (env.progress) saveUnlocked(env.progress, unlocked);
      }
      if (s.phase !== 'playing') finish();
    },
    draw(ctx) {
      if (menu) drawMenu(ctx, env, { cursor: menu.cursor, unlocked });
      else render(ctx, s, env);
    },
    getState() {
      return {
        ...snapshot(s),
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
          : null,
      };
    },
  };
}
