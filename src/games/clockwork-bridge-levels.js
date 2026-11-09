// The twenty clockwork machines: terrain, decks, gears, key and door, with bilingual names and tips.
// Curve: 1-5 teach one mechanism each, 6-10 combine them, 11-15 couple gears so a crank has a
// side effect, 16-20 add presses and long round trips where every gear matters.
const PLAYER_HEIGHT = 20;
const KEY_HEIGHT = 12;
const DOOR_HEIGHT = 24;
const GEAR_HEIGHT = 14;

const THEMES = {
  copper: { bg: '#1c1713', brick: '#2b221b', wall: '#5a4a3b', glow: '#ff7a2e', gear: '#3a2c20' },
  steel: { bg: '#10202b', brick: '#182f3d', wall: '#46606e', glow: '#46c8ff', gear: '#1e3a4a' },
  verdigris: { bg: '#102419', brick: '#183326', wall: '#4a6d58', glow: '#5be3a0', gear: '#1f4130' },
  violet: { bg: '#1b1530', brick: '#291f45', wall: '#5d4c80', glow: '#ffd24a', gear: '#352a58' },
};

const bridge = (id, kind, w, h, ax, ay, bx, by, rate) => ({
  id,
  kind,
  w,
  h,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  rate,
});
const deck = (id, kind, w, ax, ay, bx, by, rate) => bridge(id, kind, w, 10, ax, ay, bx, by, rate);
const block = (x, y, w, h, style = 'stone') => ({ x, y, w, h, style });
const ground = (x, top, w) => block(x, top, w, 320 - top);
const gearAt = (id, x, top, drives) => ({ id, x, y: top - GEAR_HEIGHT, r: 9, drives });
const spawnAt = (x, top) => ({ x, y: top - PLAYER_HEIGHT });
const keyAt = (x, top) => ({ x, y: top - KEY_HEIGHT });
const doorAt = (x, top) => ({ x, y: top - DOOR_HEIGHT, w: 20, h: DOOR_HEIGHT });
const padAt = (x, top, w) => ({ x, y: top, w });

const LEVEL_LIST = [
  {
    name: { en: 'First Winding', zh: '初次上弦' },
    tip: {
      en: 'Move, jump, press Z by the key, then Z again at the door.',
      zh: '走到钥匙旁按Z拿起，跳过障碍，到门前再按Z。',
    },
    theme: THEMES.copper,
    spawn: spawnAt(20, 250),
    solids: [ground(0, 250, 480), block(200, 226, 40, 24), block(310, 236, 24, 14, 'crate')],
    bridges: [],
    gears: [],
    keys: [keyAt(120, 250)],
    door: doorAt(436, 250),
    pads: [],
  },
  {
    name: { en: 'Boiler Gate', zh: '锅炉闸门' },
    tip: {
      en: 'Stand on the ferry, press X at a gear, ride across.',
      zh: '站上渡台，按X转动齿轮，随台过坑。',
    },
    theme: THEMES.copper,
    spawn: { x: 24, y: 230 },
    solids: [block(0, 250, 150, 70), block(330, 250, 150, 70), block(380, 236, 24, 14, 'crate')],
    bridges: [deck(0, 'slide', 64, 150, 250, 266, 250, 0.4)],
    gears: [gearAt(0, 136, 250, [[0, 0]]), gearAt(1, 344, 250, [[0, 0]])],
    keys: [keyAt(50, 250)],
    door: doorAt(436, 250),
    pads: [padAt(4, 250, 100)],
  },
  {
    name: { en: 'Lift Shaft', zh: '升降井' },
    tip: {
      en: 'Step on the lift first, then press X to ride it up.',
      zh: '先站上升降台，再按X，随台上行。',
    },
    theme: THEMES.copper,
    spawn: spawnAt(20, 260),
    solids: [block(0, 260, 120, 60), block(180, 170, 300, 150)],
    bridges: [deck(0, 'lift', 60, 120, 260, 120, 170, 0.4)],
    gears: [gearAt(0, 108, 260, [[0, 0]]), gearAt(1, 192, 170, [[0, 0]])],
    keys: [keyAt(40, 260)],
    door: doorAt(440, 170),
    pads: [],
  },
  {
    name: { en: 'Down Elevator', zh: '下行电梯' },
    tip: {
      en: 'Ride down for the key; the gear below lifts you back.',
      zh: '乘台下行取钥匙，下层齿轮送你回去。',
    },
    theme: THEMES.copper,
    spawn: spawnAt(20, 170),
    solids: [block(0, 170, 120, 150), block(180, 260, 300, 60)],
    bridges: [deck(0, 'lift', 60, 120, 170, 120, 260, 0.4)],
    gears: [gearAt(0, 108, 170, [[0, 0]]), gearAt(1, 192, 260, [[0, 0]])],
    keys: [keyAt(330, 260)],
    door: doorAt(60, 170),
    pads: [],
  },
  {
    name: { en: 'Two Ferries', zh: '双渡台' },
    tip: {
      en: 'Two ferries, two gears: cross one, then the next.',
      zh: '两台渡台各有齿轮：先过一台，再过下一台。',
    },
    theme: THEMES.copper,
    spawn: spawnAt(8, 250),
    solids: [ground(0, 250, 80), ground(216, 250, 76), ground(428, 250, 52)],
    bridges: [
      deck(0, 'slide', 56, 80, 250, 160, 250, 0.5),
      deck(1, 'slide', 56, 292, 250, 372, 250, 0.5),
    ],
    gears: [gearAt(0, 66, 250, [[0, 0]]), gearAt(1, 278, 250, [[1, 0]])],
    keys: [keyAt(30, 250)],
    door: doorAt(448, 250),
    pads: [],
  },
  {
    name: { en: 'Piston Hall', zh: '活塞大厅' },
    tip: {
      en: 'Ride the lift up; the top gear works lift and ferry.',
      zh: '乘升降台上行；上层齿轮同时驱动升降台和渡台。',
    },
    theme: THEMES.steel,
    spawn: { x: 20, y: 240 },
    solids: [block(0, 260, 110, 60), block(170, 170, 90, 150), block(400, 170, 80, 150)],
    bridges: [
      deck(0, 'lift', 60, 110, 260, 110, 178, 0.4),
      deck(1, 'slide', 60, 260, 170, 340, 170, 0.35),
    ],
    gears: [
      gearAt(0, 98, 260, [[0, 0]]),
      gearAt(1, 182, 170, [[0, 0]]),
      gearAt(2, 250, 170, [
        [1, 0],
        [0, 0],
      ]),
      gearAt(3, 410, 170, [[1, 0]]),
    ],
    keys: [keyAt(40, 260)],
    door: doorAt(446, 170),
    pads: [padAt(4, 260, 100), padAt(176, 170, 78), padAt(406, 170, 40)],
  },
  {
    name: { en: 'Summon', zh: '召唤渡台' },
    tip: {
      en: 'The ferry waits far away: press X to call it, then ride.',
      zh: '渡台停在远端：按X召唤，再乘它过去。',
    },
    theme: THEMES.steel,
    spawn: spawnAt(10, 250),
    solids: [ground(0, 250, 110), ground(330, 250, 150)],
    bridges: [deck(0, 'slide', 64, 110, 250, 266, 250, 0.4)],
    gears: [gearAt(0, 96, 250, [[0, 1]])],
    keys: [keyAt(40, 250)],
    door: doorAt(440, 250),
    pads: [],
  },
  {
    name: { en: 'Counterweight', zh: '配重' },
    tip: {
      en: 'One gear moves two ferries in opposite directions.',
      zh: '一个齿轮让两台渡台反向移动。',
    },
    theme: THEMES.steel,
    spawn: spawnAt(8, 250),
    solids: [ground(0, 250, 84), ground(216, 250, 72), ground(420, 250, 60)],
    bridges: [
      deck(0, 'slide', 56, 84, 250, 160, 250, 0.5),
      deck(1, 'slide', 56, 288, 250, 364, 250, 0.5),
    ],
    gears: [
      gearAt(0, 70, 250, [
        [0, 0],
        [1, 1],
      ]),
      gearAt(1, 278, 250, [[1, 0]]),
    ],
    keys: [keyAt(30, 250)],
    door: doorAt(448, 250),
    pads: [],
  },
  {
    name: { en: 'Stairwell', zh: '阶梯井' },
    tip: {
      en: 'Two lifts in a row: climb one stage at a time.',
      zh: '两台升降台接力：一段一段往上爬。',
    },
    theme: THEMES.steel,
    spawn: spawnAt(8, 260),
    solids: [block(0, 260, 100, 60), block(160, 200, 100, 120), block(320, 140, 160, 180)],
    bridges: [
      deck(0, 'lift', 60, 100, 260, 100, 200, 0.4),
      deck(1, 'lift', 60, 260, 200, 260, 140, 0.4),
    ],
    gears: [gearAt(0, 92, 260, [[0, 0]]), gearAt(1, 252, 200, [[1, 0]])],
    keys: [keyAt(30, 260)],
    door: doorAt(440, 140),
    pads: [],
  },
  {
    name: { en: 'Stepping Stones', zh: '垫脚石' },
    tip: {
      en: 'Cross by ferry, then hop three narrow ledges.',
      zh: '乘渡台过坑，再连跳三块窄台。',
    },
    theme: THEMES.verdigris,
    spawn: spawnAt(8, 250),
    solids: [
      ground(0, 250, 84),
      ground(216, 250, 56),
      ground(306, 236, 34),
      ground(374, 222, 34),
      ground(442, 208, 38),
    ],
    bridges: [deck(0, 'slide', 56, 84, 250, 160, 250, 0.5)],
    gears: [gearAt(0, 66, 250, [[0, 0]])],
    keys: [keyAt(30, 250)],
    door: doorAt(452, 208),
    pads: [],
  },
  {
    name: { en: 'Swing Shift', zh: '换班' },
    tip: {
      en: 'Cranking can send a ferry away: plan the way back.',
      zh: '转动齿轮可能把渡台推走：先想好回程。',
    },
    theme: THEMES.verdigris,
    spawn: spawnAt(6, 250),
    solids: [ground(0, 250, 84), ground(216, 250, 72), ground(420, 250, 60)],
    bridges: [
      deck(0, 'slide', 56, 84, 250, 160, 250, 0.5),
      deck(1, 'slide', 56, 288, 250, 364, 250, 0.5),
    ],
    gears: [
      gearAt(0, 70, 250, [
        [0, 0],
        [1, 1],
      ]),
      gearAt(1, 278, 250, [
        [0, 0],
        [1, 0],
      ]),
      gearAt(2, 434, 250, [
        [0, 0],
        [1, 0],
      ]),
      gearAt(3, 228, 250, [[0, 0]]),
    ],
    keys: [keyAt(458, 250)],
    door: doorAt(24, 250),
    pads: [],
  },
  {
    name: { en: 'Ferry Then Lift', zh: '渡台接升降台' },
    tip: {
      en: 'Ferry, then lift: the key is up top, the door is back.',
      zh: '先渡台后升降台：钥匙在上层，门在起点。',
    },
    theme: THEMES.verdigris,
    spawn: spawnAt(6, 260),
    solids: [ground(0, 260, 84), ground(216, 260, 72), ground(348, 170, 132)],
    bridges: [
      deck(0, 'slide', 56, 84, 260, 160, 260, 0.5),
      deck(1, 'lift', 60, 288, 260, 288, 170, 0.4),
    ],
    gears: [
      gearAt(0, 66, 260, [[0, 0]]),
      gearAt(1, 226, 260, [[0, 0]]),
      gearAt(2, 278, 260, [[1, 0]]),
      gearAt(3, 358, 170, [[1, 0]]),
    ],
    keys: [keyAt(440, 170)],
    door: doorAt(24, 260),
    pads: [],
  },
  {
    name: { en: 'Master Clockwork', zh: '主发条室' },
    tip: {
      en: 'Wait in the safe nook when the press is down.',
      zh: '压板落下时，在安全角落等待。',
    },
    theme: THEMES.violet,
    spawn: { x: 16, y: 240 },
    solids: [
      block(0, 260, 100, 60),
      block(246, 260, 80, 60),
      block(386, 150, 94, 170),
      block(410, 136, 24, 14, 'crate'),
    ],
    bridges: [
      deck(0, 'slide', 56, 100, 260, 190, 260, 0.5),
      deck(1, 'lift', 60, 326, 260, 326, 158, 0.4),
      bridge(2, 'press', 52, 16, 264, 196, 264, 238, 0.5),
    ],
    gears: [
      gearAt(0, 90, 260, [[0, 0]]),
      gearAt(1, 252, 260, [
        [1, 0],
        [2, 0],
      ]),
      gearAt(2, 322, 260, [
        [1, 0],
        [2, 0],
      ]),
      gearAt(3, 394, 150, [
        [1, 0],
        [2, 0],
      ]),
    ],
    keys: [keyAt(34, 260)],
    door: doorAt(450, 150),
    pads: [padAt(4, 260, 90), padAt(246, 260, 16), padAt(390, 150, 16)],
  },
  {
    name: { en: 'Seesaw', zh: '跷跷板' },
    tip: {
      en: 'One gear raises one lift, lowers the other: go, fetch, return.',
      zh: '一个齿轮升一台、降一台：过去取钥匙再回来。',
    },
    theme: THEMES.verdigris,
    spawn: spawnAt(8, 260),
    solids: [block(0, 260, 100, 60), block(160, 170, 140, 150), block(360, 260, 120, 60)],
    bridges: [
      deck(0, 'lift', 60, 100, 260, 100, 170, 0.4),
      deck(1, 'lift', 60, 300, 260, 300, 170, 0.4),
    ],
    gears: [
      gearAt(0, 88, 260, [
        [0, 0],
        [1, 1],
      ]),
      gearAt(1, 372, 260, [
        [0, 0],
        [1, 0],
      ]),
    ],
    keys: [keyAt(440, 260)],
    door: doorAt(30, 260),
    pads: [],
  },
  {
    name: { en: 'Long Haul', zh: '长途' },
    tip: {
      en: 'A long round trip: each gear moves more than one deck.',
      zh: '漫长的往返：每个齿轮都牵动不止一个台面。',
    },
    theme: THEMES.verdigris,
    spawn: spawnAt(6, 260),
    solids: [ground(0, 260, 90), ground(150, 170, 100), ground(370, 170, 110)],
    bridges: [
      deck(0, 'lift', 60, 90, 260, 90, 170, 0.45),
      deck(1, 'slide', 48, 250, 170, 322, 170, 0.5),
    ],
    gears: [
      gearAt(0, 76, 260, [
        [1, 0],
        [0, 0],
      ]),
      gearAt(1, 162, 170, [[0, 0]]),
      gearAt(2, 238, 170, [
        [0, 0],
        [1, 1],
      ]),
      gearAt(3, 382, 170, [
        [1, 0],
        [0, 1],
      ]),
    ],
    keys: [keyAt(440, 170)],
    door: doorAt(30, 260),
    pads: [],
  },
  {
    name: { en: 'Press Gates', zh: '压板闸门' },
    tip: {
      en: 'Presses and a ferry share gears: open the way, fetch the key.',
      zh: '压板与渡台共用齿轮：开路、取钥匙、再回来。',
    },
    theme: THEMES.violet,
    spawn: spawnAt(2, 260),
    solids: [ground(0, 260, 70), ground(190, 260, 290), block(232, 20, 156, 160)],
    bridges: [
      deck(0, 'slide', 48, 70, 260, 142, 260, 0.5),
      bridge(1, 'press', 40, 56, 240, 180, 240, 204, 0.5),
      bridge(2, 'press', 40, 56, 340, 180, 340, 204, 0.5),
    ],
    gears: [
      gearAt(0, 62, 260, [
        [2, 0],
        [0, 1],
        [1, 0],
      ]),
      gearAt(1, 198, 260, [
        [2, 0],
        [0, 0],
      ]),
      gearAt(2, 310, 260, [
        [1, 0],
        [0, 0],
        [2, 1],
      ]),
      gearAt(3, 396, 260, [
        [0, 0],
        [1, 1],
      ]),
    ],
    keys: [keyAt(440, 260)],
    door: doorAt(20, 260),
    pads: [padAt(196, 260, 36), padAt(284, 260, 50), padAt(384, 260, 40)],
  },
  {
    name: { en: 'Gate Tower', zh: '闸门塔' },
    tip: {
      en: 'Lift, press gate, ferry: the ferry must shuttle twice.',
      zh: '升降台、压板闸门、渡台：渡台要往返两次。',
    },
    theme: THEMES.violet,
    spawn: spawnAt(2, 260),
    solids: [
      ground(0, 260, 60),
      ground(110, 170, 180),
      ground(404, 170, 76),
      block(172, 20, 56, 70),
    ],
    bridges: [
      deck(0, 'lift', 50, 60, 260, 60, 170, 0.45),
      bridge(1, 'press', 40, 56, 180, 90, 180, 114, 0.5),
      deck(2, 'slide', 40, 290, 170, 364, 170, 0.5),
    ],
    gears: [
      gearAt(0, 52, 260, [[0, 1]]),
      gearAt(1, 118, 170, [
        [0, 0],
        [1, 0],
      ]),
      gearAt(2, 160, 170, [[2, 1]]),
      gearAt(3, 240, 170, [[2, 1]]),
      gearAt(4, 276, 170, [[2, 1]]),
      gearAt(5, 412, 170, [
        [2, 0],
        [1, 1],
      ]),
    ],
    keys: [keyAt(452, 170)],
    door: doorAt(20, 260),
    pads: [padAt(150, 170, 26), padAt(224, 170, 40)],
  },
  {
    name: { en: 'Gate Ferries', zh: '闸门渡台' },
    tip: {
      en: 'Two ferries and a press gate share gears: plan the round trip.',
      zh: '两台渡台和一道压板闸门共用齿轮：规划好往返。',
    },
    theme: THEMES.violet,
    spawn: spawnAt(2, 260),
    solids: [
      ground(0, 260, 56),
      ground(168, 260, 140),
      ground(420, 260, 60),
      block(210, 20, 56, 160),
    ],
    bridges: [
      deck(0, 'slide', 40, 56, 260, 128, 260, 0.5),
      bridge(1, 'press', 40, 56, 218, 180, 218, 204, 0.5),
      deck(2, 'slide', 40, 308, 260, 380, 260, 0.5),
    ],
    gears: [
      gearAt(0, 48, 260, [
        [1, 0],
        [2, 0],
        [0, 0],
      ]),
      gearAt(1, 176, 260, [[0, 0]]),
      gearAt(2, 300, 260, [
        [2, 0],
        [0, 0],
      ]),
      gearAt(3, 428, 260, [
        [2, 1],
        [1, 0],
      ]),
    ],
    keys: [keyAt(456, 260)],
    door: doorAt(16, 260),
    pads: [padAt(172, 260, 40), padAt(270, 260, 30)],
  },
  {
    name: { en: 'Three Steps', zh: '三级台阶' },
    tip: {
      en: 'Two lifts and a ferry: read the gears before you ride.',
      zh: '两台升降台加一台渡台：先看清齿轮再上台。',
    },
    theme: THEMES.violet,
    spawn: spawnAt(2, 260),
    solids: [ground(0, 260, 60), ground(110, 200, 90), ground(250, 140, 50), ground(420, 140, 60)],
    bridges: [
      deck(0, 'lift', 50, 60, 260, 60, 200, 0.45),
      deck(1, 'lift', 50, 200, 200, 200, 140, 0.45),
      deck(2, 'slide', 44, 300, 140, 376, 140, 0.5),
    ],
    gears: [
      gearAt(0, 52, 260, [[0, 0]]),
      gearAt(1, 118, 200, [
        [0, 1],
        [2, 0],
      ]),
      gearAt(2, 192, 200, [
        [1, 0],
        [0, 0],
      ]),
      gearAt(3, 258, 140, [
        [1, 0],
        [2, 0],
      ]),
      gearAt(4, 292, 140, [
        [0, 0],
        [2, 0],
      ]),
      gearAt(5, 428, 140, [
        [2, 0],
        [1, 1],
      ]),
    ],
    keys: [keyAt(460, 140)],
    door: doorAt(20, 260),
    pads: [],
  },
  {
    name: { en: 'Grand Mechanism', zh: '总机关' },
    tip: {
      en: 'Lift, ferry, lift: every gear has a price.',
      zh: '升降台、渡台、升降台：每个齿轮都有代价。',
    },
    theme: THEMES.violet,
    spawn: spawnAt(2, 260),
    solids: [ground(0, 260, 60), ground(110, 200, 60), ground(290, 200, 60), ground(400, 140, 80)],
    bridges: [
      deck(0, 'lift', 50, 60, 260, 60, 200, 0.45),
      deck(1, 'slide', 44, 170, 200, 246, 200, 0.5),
      deck(2, 'lift', 50, 350, 200, 350, 140, 0.45),
    ],
    gears: [
      gearAt(0, 52, 260, [
        [0, 1],
        [1, 0],
      ]),
      gearAt(1, 118, 200, [[0, 0]]),
      gearAt(2, 162, 200, [
        [2, 0],
        [1, 0],
      ]),
      gearAt(3, 298, 200, [
        [1, 1],
        [0, 0],
      ]),
      gearAt(4, 342, 200, [[2, 1]]),
      gearAt(5, 408, 140, [[2, 0]]),
    ],
    keys: [keyAt(456, 140)],
    door: doorAt(20, 260),
    pads: [],
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export const LEVELS = deepFreeze(LEVEL_LIST);
export const LEVEL_COUNT = LEVELS.length;
