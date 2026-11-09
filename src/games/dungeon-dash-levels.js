// The twenty chambers as data. Coordinates are grid cells (x 1..20, y 1..12) inside the outer wall.
import { COLS, ROWS, SPIKE_PERIOD, pos } from './dungeon-dash-world.js';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const level = (en, zh, tipEn, tipZh, spec) => ({
  name: { en, zh },
  tip: { en: tipEn, zh: tipZh },
  start: [2, 11],
  needsClear: true,
  alert: false,
  guardHp: 2,
  armor: false,
  pace: 1,
  startFlasks: 1,
  wardenHp: 8,
  ...spec,
});

export const LEVELS = freeze([
  // Teaching: one new idea per chamber.
  level(
    'Entry Hall',
    '入口大厅',
    'Arrows or WASD move. Take the key, then walk into the exit door.',
    '用方向键移动。拿到钥匙，再走进出口。',
    {
      walls: [
        [3, 3, 4, 4],
        [13, 3, 14, 4],
        [8, 6, 11, 7],
        [18, 7, 19, 7],
        [13, 9, 14, 10],
      ],
      key: [18, 10],
      exit: [18, 2],
      treasures: [
        [18, 4],
        [3, 9],
      ],
    },
  ),
  level(
    'Sleeping Guard',
    '沉睡守卫',
    "Hold Space to swing. A guard's orange arc warns before it strikes.",
    '按住空格挥剑。守卫出招前会显示橙色弧线。',
    {
      walls: [
        [9, 3, 9, 5],
        [9, 8, 9, 12],
      ],
      guards: [[13, 7]],
      key: [18, 10],
      exit: [19, 2],
      treasures: [[17, 5]],
    },
  ),
  level(
    'Twin Guards',
    '双守卫',
    'Press K to dodge-step. Fight in the lanes, one guard at a time.',
    '按K闪步。在走廊里逐个对付守卫。',
    {
      walls: [
        [6, 1, 6, 9],
        [11, 4, 11, 12],
        [16, 1, 16, 9],
      ],
      guards: [
        [9, 5],
        [13, 8],
      ],
      key: [18, 6],
      exit: [19, 1],
      treasures: [
        [3, 3],
        [14, 11],
      ],
    },
  ),
  level(
    'Spike Hall',
    '尖刺厅',
    'Spikes flash orange, then strike. Cross while they are retracted.',
    '尖刺先闪橙光再弹出，趁收起时通过。',
    {
      walls: [
        [7, 1, 7, 5],
        [7, 8, 7, 12],
        [11, 1, 11, 5],
        [11, 8, 11, 12],
        [15, 1, 15, 5],
        [15, 8, 15, 12],
      ],
      spikes: [
        [7, 6],
        [7, 7],
        [15, 6],
        [15, 7],
      ],
      spikesB: [
        [11, 6],
        [11, 7],
      ],
      guards: [[18, 5]],
      key: [19, 10],
      exit: [19, 2],
      treasures: [[3, 3]],
    },
  ),
  level(
    'Sealed Gate',
    '封闭闸门',
    'Press E at the lever to open the gate to the key room.',
    '在拉杆旁按E，打开通向钥匙室的闸门。',
    {
      walls: [
        [14, 1, 14, 5],
        [14, 6, 20, 6],
        [5, 8, 6, 8],
      ],
      gates: [[17, 6]],
      levers: [[3, 3]],
      guards: [[11, 9]],
      key: [18, 3],
      exit: [19, 11],
    },
  ),
  level(
    'First Archer',
    '初遇弓手',
    'Archers show their aim line first. Step sideways, then close in.',
    '弓手会先显示瞄准线。向侧面移动，再靠近。',
    {
      walls: [
        [5, 3, 6, 4],
        [15, 3, 16, 4],
        [10, 6, 11, 7],
        [5, 9, 6, 10],
        [15, 9, 16, 10],
      ],
      archers: [[18, 7]],
      key: [19, 10],
      exit: [19, 1],
    },
  ),
  level(
    'Supply Cache',
    '补给仓',
    'Press E at a cache for a flask, and H to drink one when hurt.',
    '在补给箱旁按E获得药水，受伤时按H饮用。',
    {
      walls: [
        [3, 5, 8, 5],
        [13, 5, 18, 5],
        [5, 9, 10, 9],
        [15, 9, 20, 9],
      ],
      guards: [
        [15, 3],
        [6, 7],
        [14, 11],
      ],
      chests: [[4, 11]],
      flasks: [[2, 7]],
      key: [19, 11],
      exit: [19, 2],
    },
  ),
  level(
    'Shrine Chamber',
    '神龛室',
    'A shrine heals you once: press E at it when you are hurt.',
    '神龛只能恢复一次：受伤时在神龛旁按E。',
    {
      walls: [
        [7, 1, 7, 8],
        [7, 11, 7, 12],
        [15, 1, 15, 2],
        [15, 5, 15, 12],
      ],
      shrines: [[4, 4]],
      guards: [
        [10, 6],
        [11, 11],
      ],
      archers: [[18, 6]],
      key: [18, 11],
      exit: [19, 2],
    },
  ),
  // Combination: the ideas meet.
  level(
    'Key Trap',
    '钥匙陷阱',
    'Grey statues wake when you lift the key. Hold the doorway.',
    '拿起钥匙时灰色雕像会苏醒。守住门口。',
    {
      walls: [
        [6, 2, 14, 2],
        [6, 8, 14, 8],
        [14, 3, 14, 7],
        [6, 3, 6, 4],
        [6, 6, 6, 7],
      ],
      ambushGuards: [
        [7, 3],
        [13, 3],
        [13, 7],
      ],
      key: [10, 5],
      exit: [19, 2],
      shrines: [[3, 11]],
    },
  ),
  level(
    'Stone Warden',
    '石像守卫长',
    'The Warden spins all around. Back off at its wind-up, hit it after.',
    '守卫长会旋转攻击：蓄力时后退，之后反击。',
    {
      walls: [
        [8, 4, 9, 5],
        [8, 8, 9, 9],
      ],
      wardens: [[14, 6]],
      wardenHp: 5,
      shrines: [[3, 3]],
      key: [19, 11],
      exit: [19, 2],
    },
  ),
  level(
    'Spike Switch',
    '尖刺开关',
    'The lever in the middle hall turns off every spike on this level.',
    '中厅的拉杆可以关闭本关所有尖刺。',
    {
      walls: [
        [8, 1, 8, 5],
        [8, 8, 8, 12],
        [14, 1, 14, 5],
        [14, 8, 14, 12],
      ],
      spikes: [
        [8, 6],
        [8, 7],
      ],
      spikesB: [
        [14, 6],
        [14, 7],
      ],
      spikeLevers: [[11, 3]],
      guards: [
        [11, 10],
        [17, 4],
      ],
      key: [19, 10],
      exit: [19, 2],
    },
  ),
  level(
    'Crossfire',
    '交叉火力',
    'Two archers cover the hall. Use pillars as cover; mind the spike column.',
    '两名弓手封锁大厅。借石柱掩护，留意尖刺列。',
    {
      walls: [
        [6, 4, 7, 5],
        [6, 8, 7, 9],
        [12, 2, 13, 3],
        [12, 10, 13, 11],
        [10, 6, 11, 7],
      ],
      spikes: [
        [14, 5],
        [14, 6],
        [14, 7],
        [14, 8],
      ],
      archers: [
        [17, 3],
        [17, 10],
      ],
      key: [19, 6],
      exit: [19, 1],
      flasks: [[4, 11]],
    },
  ),
  level(
    'Twin Levers',
    '双拉杆',
    'Each lever opens its own gate: one for the key room, one for the exit.',
    '每根拉杆各开一道闸门：一道通钥匙室，一道通出口。',
    {
      walls: [
        [9, 1, 9, 5],
        [1, 5, 3, 5],
        [5, 5, 8, 5],
        [12, 8, 15, 8],
        [17, 8, 20, 8],
        [12, 9, 12, 12],
      ],
      gates: [[4, 5]],
      gates2: [[16, 8]],
      levers: [[12, 3]],
      levers2: [[18, 3]],
      guards: [
        [11, 6],
        [17, 5],
        [8, 10],
      ],
      guardHp: 3,
      key: [3, 2],
      exit: [18, 11],
    },
  ),
  level(
    'Gauntlet',
    '冲锋走廊',
    'Awake guards chase you. Only the key and the exit are needed.',
    '守卫已经苏醒并追击。只需钥匙和出口。',
    {
      walls: [
        [6, 3, 7, 4],
        [6, 8, 7, 9],
        [12, 5, 13, 6],
        [12, 10, 13, 11],
        [16, 3, 17, 4],
        [16, 8, 17, 9],
      ],
      guards: [
        [12, 2],
        [16, 7],
        [10, 12],
      ],
      alert: true,
      needsClear: false,
      key: [19, 2],
      exit: [2, 2],
      flasks: [[10, 7]],
    },
  ),
  // Mastery: every idea at once.
  level(
    'Archer Gallery',
    '弓手长廊',
    'Armoured guards finish a started swing even when hit: dodge first.',
    '重甲守卫被击中也会挥完这一击：先闪避再反击。',
    {
      walls: [
        [5, 3, 5, 5],
        [5, 8, 5, 10],
        [9, 2, 9, 4],
        [9, 9, 9, 11],
        [13, 3, 13, 5],
        [13, 8, 13, 10],
      ],
      archers: [
        [17, 2],
        [17, 11],
        [11, 6],
      ],
      guards: [
        [15, 6],
        [8, 6],
        [11, 10],
      ],
      chests: [[3, 11]],
      pace: 1.5,
      armor: true,
      guardHp: 3,
      key: [19, 12],
      exit: [19, 1],
    },
  ),
  level(
    'Grave Key',
    '墓室之钥',
    'Lifting the key wakes the statues. Spikes guard the way back out.',
    '拿起钥匙会唤醒雕像，回程还有尖刺拦路。',
    {
      walls: [
        [13, 1, 13, 5],
        [13, 8, 13, 12],
      ],
      spikes: [
        [13, 6],
        [13, 7],
      ],
      guards: [
        [8, 6],
        [9, 10],
      ],
      ambushArchers: [
        [17, 2],
        [17, 11],
      ],
      ambushGuards: [[19, 11]],
      flasks: [[5, 11]],
      pace: 1.5,
      armor: true,
      guardHp: 3,
      key: [17, 6],
      exit: [3, 2],
      treasures: [[19, 3]],
    },
  ),
  level(
    'Gate Maze',
    '闸门迷宫',
    'Lever one opens gate one, lever two gate two. Statues guard the key.',
    '拉杆一开第一道闸，拉杆二开第二道。雕像守着钥匙。',
    {
      walls: [
        [7, 1, 7, 5],
        [7, 7, 7, 12],
        [14, 1, 14, 8],
        [14, 10, 14, 12],
      ],
      gates: [[7, 6]],
      gates2: [[14, 9]],
      levers: [[4, 2]],
      levers2: [[11, 3]],
      guards: [
        [10, 9],
        [11, 5],
        [9, 3],
      ],
      ambushArchers: [[20, 5]],
      ambushGuards: [
        [16, 8],
        [19, 9],
        [17, 10],
      ],
      pace: 1.5,
      startFlasks: 0,
      armor: true,
      guardHp: 3,
      key: [18, 2],
      exit: [19, 11],
    },
  ),
  level(
    'Spike Arena',
    '尖刺竞技场',
    'The Warden fights among the spikes. Mind the flashing floor tiles.',
    '守卫长在尖刺间作战。留意闪烁的地砖。',
    {
      walls: [
        [5, 4, 5, 5],
        [16, 7, 16, 8],
      ],
      spikes: [
        [8, 4],
        [8, 9],
        [11, 6],
        [16, 3],
        [16, 10],
      ],
      spikesB: [
        [11, 3],
        [11, 9],
        [8, 6],
      ],
      guards: [
        [10, 11],
        [17, 5],
      ],
      archers: [
        [19, 7],
        [15, 12],
      ],
      wardens: [[14, 6]],
      wardenHp: 6,
      pace: 1.5,
      armor: true,
      guardHp: 3,
      key: [19, 11],
      exit: [19, 2],
    },
  ),
  level(
    'Long Vault',
    '长廊宝库',
    'Spikes, archers and statues wait in one long winding vault.',
    '蜿蜒的宝库里有尖刺、弓手和雕像。',
    {
      walls: [
        [6, 1, 6, 8],
        [11, 5, 11, 12],
        [16, 1, 16, 8],
      ],
      spikes: [
        [11, 1],
        [11, 2],
        [11, 3],
        [11, 4],
      ],
      spikesB: [
        [16, 9],
        [16, 10],
        [16, 11],
        [16, 12],
      ],
      guards: [
        [9, 5],
        [13, 7],
        [14, 3],
      ],
      archers: [[8, 9]],
      ambushGuards: [[18, 11]],
      ambushArchers: [[20, 3]],
      pace: 1.5,
      armor: true,
      guardHp: 3,
      key: [18, 6],
      exit: [17, 1],
    },
  ),
  level(
    'Vault Warden',
    '宝库守卫长',
    'Final vault: Warden, archers, guards. Use the shrine and the cache.',
    '最后的宝库：守卫长、弓手和守卫。善用神龛和补给箱。',
    {
      walls: [
        [7, 3, 8, 4],
        [7, 9, 8, 10],
        [14, 4, 15, 5],
        [14, 8, 15, 9],
      ],
      wardens: [[12, 6]],
      wardenHp: 8,
      archers: [
        [18, 2],
        [18, 11],
      ],
      guards: [
        [15, 6],
        [9, 6],
        [16, 10],
      ],
      shrines: [[3, 3]],
      chests: [[3, 10]],
      flasks: [[3, 7]],
      pace: 1.5,
      armor: true,
      guardHp: 3,
      key: [19, 6],
      exit: [19, 1],
    },
  ),
]);
export const LEVEL_COUNT = LEVELS.length;
export const clampLevel = (n) => {
  const level = Math.floor(Number(n));
  return Number.isFinite(level) ? Math.min(LEVEL_COUNT, Math.max(1, level)) : 1;
};

const CHARACTERS = {
  guard: { hp: (spec) => spec.guardHp, speed: 38 },
  archer: { hp: () => 2, speed: 31 },
  warden: { hp: (spec) => spec.wardenHp, speed: 28 },
};
function makeEnemies(spec, level) {
  const groups = [
    ['guards', 'guard', 'near'],
    ['archers', 'archer', 'near'],
    ['wardens', 'warden', 'near'],
    ['ambushGuards', 'guard', 'key'],
    ['ambushArchers', 'archer', 'key'],
  ];
  const enemies = [];
  for (const [field, type, wake] of groups)
    for (const [x, y] of spec[field] ?? []) {
      const awake = spec.alert && wake === 'near';
      enemies.push({
        id: `${level}:${enemies.length}`,
        ...pos(x, y),
        vx: 0,
        vy: 0,
        hp: CHARACTERS[type].hp(spec),
        type,
        wake,
        armor: type === 'guard' && spec.armor,
        speed: CHARACTERS[type].speed * spec.pace,
        hit: 0,
        state: awake ? 'approach' : 'sleep',
        timer: 0,
        aim: { x: 1, y: 0 },
        struck: false,
      });
    }
  return enemies;
}
const points = (list = []) => list.map(([x, y]) => pos(x, y));
/** Fresh, mutable chamber objects for one level. */
export function buildLevel(n) {
  const number = clampLevel(n),
    spec = LEVELS[number - 1],
    tiles = Array.from({ length: ROWS }, (_, y) =>
      Array.from(
        { length: COLS },
        (_, x) => +(x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1),
      ),
    );
  for (const [x1, y1, x2, y2] of spec.walls)
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) tiles[y][x] = 1;
  const gates = [];
  for (const [id, list] of [
    ['D', spec.gates],
    ['d', spec.gates2],
  ])
    for (const [x, y] of list ?? []) {
      tiles[y][x] = 2;
      gates.push({ cx: x, cy: y, id });
    }
  const levers = [
    ...(spec.levers ?? []).map((p) => ['D', p]),
    ...(spec.levers2 ?? []).map((p) => ['d', p]),
    ...(spec.spikeLevers ?? []).map((p) => ['spikes', p]),
  ].map(([opens, [x, y]]) => ({ ...pos(x, y), on: false, opens }));
  const hazards = [
    ...(spec.spikes ?? []).map((p) => [p, 0]),
    ...(spec.spikesB ?? []).map((p) => [p, SPIKE_PERIOD / 2]),
  ].map(([[x, y], offset]) => ({ ...pos(x, y), offset, disabled: false, state: 'safe' }));
  return {
    tiles,
    gates,
    levers,
    hazards,
    enemies: makeEnemies(spec, number),
    exit: pos(...spec.exit),
    key: pos(...spec.key),
    start: pos(...spec.start),
    chests: points(spec.chests).map((p) => ({ ...p, opened: false })),
    shrines: points(spec.shrines).map((p) => ({ ...p, used: false })),
    potions: points(spec.flasks),
    treasures: points(spec.treasures),
  };
}
