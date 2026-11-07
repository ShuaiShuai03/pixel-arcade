import { background, drawPixelText as text } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'conveyor-chef',
  name: { en: 'Conveyor Chef', zh: '传送带厨房' },
  genre: 'arcade',
  players: '1-2',
  touch: true,
  description: {
    en: 'Run a conveyor kitchen through 22 shifts. Take each ticket, press Space at a crate to put one ingredient on the belt (items ride at the stated belt speed, one per tile), and steer it: press X to flip the nearest junction between its two arrows. Chop at the board (Space starts it and you must stay close until it is done), cook on the stove (it is ready when the bar turns green; press Space to take it out before the bar turns red, or it burns and is spat out), and let the belt carry the dish to the window. Raw, burnt, unchopped or wrong dishes are rejected and cost satisfaction, and every ticket scores once. Keep satisfaction above the shift target to clear the shift and unlock the next; the start screen lets you continue or replay any open shift. Two players share one kitchen: P1 WASD with F and G, P2 arrows with comma and period.',
    zh: '在22个班次里经营传送带厨房。接单后，在食材箱前按空格把一份食材放上传送带（食材按标明的速度前进，每格只容一个），再用X键扳动最近分流器的两个箭头来改道。在砧板前按空格开始切并留在旁边直到切完；在炉灶上烹饪，进度条变绿就是熟了，要在变红前按空格取出，否则会烧焦并被吐出；传送带会把菜送到出餐口。生的、烧焦的、没切的或做错的菜会被退回并扣满意度，每张订单只计一次分。让满意度保持在班次目标之上即可通关并解锁下一班；开局菜单可继续或重玩任何已开放的班次。双人共用一间厨房：玩家一用WASD加F、G，玩家二用方向键加逗号、句号。',
  },
  keys: [
    { label: { en: 'Move the chef', zh: '移动厨师' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Interact: crate, board, stove', zh: '操作：食材箱、砧板、炉灶' },
      keys: 'Space',
    },
    { label: { en: 'Reroute the nearest junction', zh: '扳动最近的分流器' }, keys: 'X' },
    {
      label: { en: 'Pick a shift (start screen)', zh: '选择班次（开始界面）' },
      keys: 'Arrows + Space',
    },
    {
      label: { en: 'Co-op P1: move, act, reroute', zh: '双人 玩家一：移动、操作、改道' },
      keys: 'W A S D, F, G',
    },
    {
      label: { en: 'Co-op P2: move, act, reroute', zh: '双人 玩家二：移动、操作、改道' },
      keys: '↑ ← ↓ →, Comma, Period',
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Act', '操作', 'right'],
    ['KeyX', 'Route', '改道', 'right'],
  ]),
  multiplayerTouchControls: touch([
    ['KeyA', 'A', 'A', 'left'],
    ['KeyW', 'W', 'W', 'left'],
    ['KeyS', 'S', 'S', 'left'],
    ['KeyD', 'D', 'D', 'left'],
    ['KeyF', 'Act', '操作', 'left'],
    ['KeyG', 'Route', '改道', 'left'],
    ['ArrowLeft', '◀', '◀', 'right'],
    ['ArrowUp', '▲', '▲', 'right'],
    ['ArrowDown', '▼', '▼', 'right'],
    ['ArrowRight', '▶', '▶', 'right'],
    ['Comma', 'Act', '操作', 'right'],
    ['Period', 'Route', '改道', 'right'],
  ]),
};

// Every number the rules use lives here; the status line and the tests quote the same values.
// Distances are pixels, times are seconds, belts are in tiles per second. Ticks are 1/120 s.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 9,
  top: 60, // the kitchen starts under the HUD line (0-20) and the ticket rail (20-60)
  bottom: 276, // the prompt, message and facts lines sit below the kitchen
  step: 1 / 120,
  maxDt: 0.1,
  half: 8, // chef collision half-size; the sprite is 16 px
  chefSpeed: 96,
  reach: 44, // a chef reaches a crate, board, stove or junction this close (centre to centre)
  beltSpeed: 2, // tiles per second unless a shift says otherwise
  chopTime: 1.6, // seconds of chopping, counted only while a chef is within reach
  cookTime: 3, // seconds on the stove until the dish is ready
  cookWindow: 4, // seconds a ready dish may stay before it burns (shifts may shorten it)
  burnWarn: 1.5, // the last seconds of the window flash red
  crateCooldown: 1.2, // a crate reloads this long after each item
  baseScore: 60, // satisfaction points for a ticket served on its last second
  fastBonus: 40, // plus up to this much for serving it at once
  rejectPenalty: 10,
  maxOpen: 6, // the ticket rail has this many slots
  tripSlack: 2.5, // seconds of reaction slack kept before a cooking dish burns when sending the chef away
  promptHold: 90, // ticks: a prompt stays at least 0.75 s
  promptEvery: 6,
  msgTicks: 300,
  clearTicks: 300,
  clearScore: 200,
});
const {
  tile: TILE,
  cols: COLS,
  rows: ROWS,
  top: TOP,
  bottom: BOTTOM,
  step: STEP,
  half: HALF,
} = RULES;
const SPRITE = 16;

const freeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v));
  return Object.freeze(o);
};
const cx = (c) => c * TILE + TILE / 2;
const cy = (r) => TOP + r * TILE + TILE / 2;

export const KINDS = freeze({
  bread: { ch: 'b', en: 'bread', many: 'bread', zh: '面包' },
  tomato: { ch: 't', en: 'tomato', many: 'tomatoes', zh: '番茄' },
  meat: { ch: 'm', en: 'patty', many: 'patties', zh: '肉饼' },
  fish: { ch: 'f', en: 'fish', many: 'fish', zh: '鱼' },
  egg: { ch: 'e', en: 'egg', many: 'eggs', zh: '鸡蛋' },
});
const KIND_OF = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.ch, k]));
const STATION_OF = { C: 'chopper', S: 'stove', W: 'window', X: 'bin' };
const ARROWS = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], v: [0, 1] };
const NEIGHBOURS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

// ---------------------------------------------------------------------------
// Shift data. A shift is data: name, tip, the kitchen as text, the junction exits (in reading
// order), crate stock, the tickets and the satisfaction target.
//   map:  # counter, . floor, > < ^ v belt, J junction, C chopper, S stove, W window, X bin,
//         b t m f e crates (bread, tomato, meat, fish, egg).
//   tickets: 'at patience part...' where a part is a crate letter plus :c (chopped) and/or :k
//         (cooked), e.g. 't:c', 'f:ck'.
// ---------------------------------------------------------------------------

function parseTicket(spec) {
  const [at, patience, ...parts] = spec.split(' ');
  return {
    at: Number(at),
    patience: Number(patience),
    parts: parts.map((p) => {
      const [letter, marks = ''] = p.split(':');
      return { kind: KIND_OF[letter], chop: marks.includes('c'), cook: marks.includes('k') };
    }),
  };
}

const shift = (en, zh, tipEn, tipZh, o) =>
  freeze({
    name: { en, zh },
    tip: { en: tipEn, zh: tipZh },
    map: o.map,
    junctions: o.junctions ?? [],
    stock: o.stock ?? {},
    speed: o.speed ?? RULES.beltSpeed,
    window: o.window ?? RULES.cookWindow,
    need: o.need,
    chefs: o.chefs,
    tickets: o.tickets.map(parseTicket),
  });

export const SHIFTS = freeze([
  shift(
    'First Plate',
    '第一盘',
    'Space at the crate puts one bread on the belt.',
    '在食材箱旁按空格，把面包放上传送带。',
    {
      map: [
        '####################',
        '#..................#',
        '#..................#',
        '#..b>>>>>>>>>>>>>W.#',
        '#..................#',
        '#..................#',
        '#..................#',
        '#..................#',
        '####################',
      ],
      stock: { b: 4 },
      need: 60,
      chefs: [
        [10, 6],
        [12, 6],
      ],
      tickets: ['3 45 b', '16 45 b', '29 45 b'],
    },
  ),
  shift(
    'Right Crate',
    '选对食材',
    'Read the ticket, then pick the matching crate.',
    '看清订单，再选对应的食材箱。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v...........#',
        '#......v...........#',
        '#......>>>>>>>>>>W.#',
        '#......^...........#',
        '#..t>>>^...........#',
        '#..................#',
        '####################',
      ],
      stock: { b: 3, t: 3 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 50 t', '12 50 b', '24 50 t', '34 50 b'],
    },
  ),
  shift(
    'Chop Chop',
    '切切切',
    'Space starts chopping; ignore the bread crate today.',
    '按空格开始切，今天别碰面包箱。',
    {
      map: [
        '####################',
        '#..b>>>v...........#',
        '#......v...........#',
        '#......v...........#',
        '#..t>>>>C>>>>>>>>W.#',
        '#..................#',
        '#..................#',
        '#..................#',
        '####################',
      ],
      stock: { t: 4, b: 3 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 50 t:c', '18 50 t:c', '33 50 t:c'],
    },
  ),
  shift(
    'Sizzle',
    '滋滋作响',
    'The stove cooks alone; take it out when green.',
    '炉灶自己煮；条变绿时取出。',
    {
      map: [
        '####################',
        '#..................#',
        '#..................#',
        '#..................#',
        '#..m>>>>S>>>>>>>>W.#',
        '#..................#',
        '#..................#',
        '#..................#',
        '####################',
      ],
      stock: { m: 4 },
      window: 6,
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 55 m:k', '20 55 m:k', '37 55 m:k'],
    },
  ),
  shift(
    'Mind the Pan',
    '小心糊锅',
    'Red means burning: take it out before the end.',
    '变红就要糊了：在结束前取出。',
    {
      map: [
        '####################',
        '#..................#',
        '#..................#',
        '#.......S>>>>>>>>W.#',
        '#.......^..........#',
        '#.......^..........#',
        '#..m>>>>^..........#',
        '#..................#',
        '####################',
      ],
      stock: { m: 5 },
      need: 65,
      chefs: [
        [13, 7],
        [15, 7],
      ],
      tickets: ['3 45 m:k', '14 45 m:k', '25 45 m:k', '36 45 m:k'],
    },
  ),
  shift(
    'Fork in the Belt',
    '分岔路',
    'X flips the junction: meat takes the stove branch.',
    '按X扳动分流器：肉走炉灶那一条。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v...........#',
        '#......v...........#',
        '#......>>J>>>>>>>W.#',
        '#......^.v.^.......#',
        '#..m>>>^.S>^.......#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { b: 3, m: 4 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 50 b', '12 50 m:k', '24 50 b', '33 50 m:k', '45 50 m:k'],
    },
  ),
  shift(
    'Board Branch',
    '砧板岔路',
    'Tomatoes take the board branch; bread goes straight.',
    '番茄走砧板那条，面包直行。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#......>>J>>>>>>>W.#',
        '#......^...........#',
        '#..t>>>^...........#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^'],
      stock: { b: 3, t: 4 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 50 b', '12 50 t:c', '24 50 t:c', '33 50 b', '44 50 t:c'],
    },
  ),
  shift(
    'Surf Line',
    '鱼线',
    'Chop, then cook: the belt carries it between.',
    '先切再煮：传送带负责送过去。',
    {
      map: [
        '####################',
        '#..................#',
        '#..................#',
        '#..................#',
        '#..f>>>>C>>S>>>>>W.#',
        '#..................#',
        '#..................#',
        '#..................#',
        '####################',
      ],
      stock: { f: 4 },
      window: 5,
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 60 f:ck', '22 60 f:ck', '41 60 f:ck'],
    },
  ),
  shift(
    'Sandwich',
    '三明治',
    'Two parts per ticket: send both to the window.',
    '每张订单有两样：都送到出餐口。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v...........#',
        '#......v...........#',
        '#......>>J>>>>>>>W.#',
        '#......^.v.^.......#',
        '#..m>>>^.S>^.......#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { b: 4, m: 4 },
      window: 5,
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 60 b m:k', '22 60 b m:k', '41 60 b m:k'],
    },
  ),
  shift(
    'The Bin',
    '垃圾桶',
    'The belt ends in the bin: flip the junction to serve.',
    '传送带通向垃圾桶：扳动分流器才能上菜。',
    {
      map: [
        '####################',
        '#..................#',
        '#..................#',
        '#..................#',
        '#..m>>>>S>J>>>>>>W.#',
        '#.........v........#',
        '#.........X........#',
        '#..................#',
        '####################',
      ],
      junctions: ['v>'],
      stock: { m: 5 },
      window: 3.5,
      need: 60,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 55 m:k', '14 55 m:k', '25 55 m:k', '36 55 m:k'],
    },
  ),
  shift(
    'Express Lane',
    '快车道',
    'The belt is faster here: flip junctions earlier.',
    '这里传送带更快：要更早扳分流器。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#......>>J>>>>>>>W.#',
        '#......^...........#',
        '#..t>>>^...........#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^'],
      stock: { b: 3, t: 5 },
      speed: 3,
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 45 t:c', '10 45 b', '18 45 t:c', '26 45 b', '34 45 t:c', '42 45 t:c'],
    },
  ),
  shift(
    'Rush Hour',
    '高峰期',
    'Tickets come fast; do the nearest job first.',
    '订单来得快；先做最近的活。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v...........#',
        '#......v...........#',
        '#......>>J>>>>>>>W.#',
        '#......^.v.^.......#',
        '#..m>>>^.S>^.......#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { b: 4, m: 5 },
      window: 5,
      need: 55,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 60 m:k', '12 60 b', '21 60 m:k', '30 60 b', '39 60 m:k', '48 60 m:k'],
    },
  ),
  shift(
    'Two Lines',
    '双线',
    'Patty and salad: send each down its own line with X.',
    '肉饼和沙拉：用X把它们送上各自的线。',
    {
      map: [
        '####################',
        '#..................#',
        '#..t>>>v...........#',
        '#......v...........#',
        '#......>>J>S>>>>>W.#',
        '#......^.v...^.....#',
        '#..m>>>^.>>C>^.....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { t: 4, m: 4 },
      need: 65,
      chefs: [
        [13, 2],
        [15, 2],
      ],
      tickets: ['3 50 t:c', '11 50 m:k', '19 50 t:c', '27 50 m:k', '35 50 t:c', '43 50 m:k'],
    },
  ),
  shift(
    'Full Kitchen',
    '全套厨房',
    'Bread, board and stove: route each to its station.',
    '面包、砧板、炉灶：各走各的路。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#.t>>>>>>J>>J>>>>W.#',
        '#......^....v.^....#',
        '#..m>>>^....S>^....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^', '>v'],
      stock: { b: 3, t: 3, m: 3 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 55 b', '12 55 t:c', '21 55 m:k', '31 55 t:c', '40 55 m:k', '50 55 b'],
    },
  ),
  shift(
    'Surf and Sandwich',
    '鱼肉三明治',
    'Bread skips the board and stove on the bypass.',
    '面包走旁路，不经过砧板和炉灶。',
    {
      map: [
        '####################',
        '#.......>>>>>>>v...#',
        '#..b>>>v^......v...#',
        '#......v^......v...#',
        '#..f>>>>J>C>S>>>>W.#',
        '#..................#',
        '#..................#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^'],
      stock: { f: 4, b: 4 },
      window: 5,
      need: 55,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 85 f:ck b', '28 85 f:ck b', '53 85 f:ck b'],
    },
  ),
  shift(
    'Breakfast',
    '早餐',
    'One stove, two dishes; skip the bread crate.',
    '一个炉灶两道菜；别碰面包箱。',
    {
      map: [
        '####################',
        '#..................#',
        '#..e>>>v...........#',
        '#......v...........#',
        '#.b>>>>>>>S>>>>>>W.#',
        '#......^...........#',
        '#..m>>>^...........#',
        '#..................#',
        '####################',
      ],
      stock: { e: 4, m: 4, b: 3 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 65 e:k m:k', '28 65 e:k m:k', '52 65 e:k m:k'],
    },
  ),
  shift(
    'Long Haul',
    '长途运输',
    'Walk ahead to the stove while the belt carries it.',
    '传送带运送时，先走到炉灶旁。',
    {
      map: [
        '####################',
        '#...W<<<<<<<<<<<<<.#',
        '#..b>>>v.........^.#',
        '#......v.........^.#',
        '#......>>J>>>>>>>^.#',
        '#......^.v.^.......#',
        '#..m>>>^.S>^.......#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { b: 3, m: 4 },
      speed: 2.5,
      need: 65,
      chefs: [
        [10, 7],
        [12, 7],
      ],
      tickets: ['3 60 m:k', '16 60 b', '28 60 m:k', '40 60 b', '52 60 m:k'],
    },
  ),
  shift(
    'Crowd Control',
    '人潮',
    'Five tickets at once: serve the oldest first.',
    '五张订单同时来：先做最早的。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#.t>>>>>>J>>J>>>>W.#',
        '#......^....v.^....#',
        '#..m>>>^....S>^....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^', '>v'],
      stock: { b: 3, t: 4, m: 4 },
      need: 60,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 80 b', '5 80 t:c', '7 80 m:k', '9 80 t:c', '11 80 m:k'],
    },
  ),
  shift(
    'Board and Pan',
    '砧板与平底锅',
    'Same crates, new layout: the board is straight ahead.',
    '食材不变，布局变了：砧板在正前方。',
    {
      map: [
        '####################',
        '#..................#',
        '#..t>>>v...........#',
        '#......v...........#',
        '#......>>J>C>>>>>W.#',
        '#......^.v...^.....#',
        '#..m>>>^.>>S>^.....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>v'],
      stock: { t: 4, m: 4 },
      need: 65,
      chefs: [
        [13, 2],
        [15, 2],
      ],
      tickets: ['3 50 m:k', '10 50 t:c', '17 50 m:k', '24 50 t:c', '31 50 m:k', '38 50 t:c'],
    },
  ),
  shift(
    'Feast',
    '盛宴',
    'Three parts per ticket: keep the belt moving.',
    '每张订单三样：让传送带一直转。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#.t>>>>>>J>>J>>>>W.#',
        '#......^....v.^....#',
        '#..m>>>^....S>^....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^', '>v'],
      stock: { b: 4, t: 4, m: 4 },
      need: 65,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 80 b t:c m:k', '30 80 b t:c m:k', '57 80 b t:c m:k'],
    },
  ),
  shift(
    'Master Fish',
    '鱼之大师',
    'Fish needs the board first, then the stove.',
    '鱼要先上砧板，再上炉灶。',
    {
      map: [
        '####################',
        '#..................#',
        '#..b>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#.f>>>>>>J>>J>>>>W.#',
        '#......^....v.^....#',
        '#..m>>>^....S>^....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^', '>v'],
      stock: { b: 3, f: 5, m: 3 },
      need: 55,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: ['3 90 f:ck', '22 90 f:ck b', '42 90 m:k f:ck', '64 90 f:ck b'],
    },
  ),
  shift(
    'Grand Service',
    '盛大晚宴',
    'Everything at once: plan your next three moves.',
    '样样齐上：提前想好接下来三步。',
    {
      map: [
        '####################',
        '#..................#',
        '#..t>>>v.C>v.......#',
        '#......v.^.v.......#',
        '#.f>>>>>>J>>J>>>>W.#',
        '#......^....v.^....#',
        '#..e>>>^....S>^....#',
        '#..................#',
        '####################',
      ],
      junctions: ['>^', '>v'],
      stock: { t: 4, f: 5, e: 4 },
      need: 55,
      chefs: [
        [12, 7],
        [14, 7],
      ],
      tickets: [
        '3 120 f:ck',
        '16 120 t:c e:k',
        '34 120 e:k f:ck',
        '52 120 f:ck t:c',
        '70 120 t:c e:k',
      ],
    },
  ),
]);

// ---------------------------------------------------------------------------
// Kitchen layout (static, parsed once per shift)
// ---------------------------------------------------------------------------

const isBeltChar = (ch) => ch in ARROWS || ch === 'J';
const layouts = [];

export function layoutOf(index) {
  if (layouts[index]) return layouts[index];
  const def = SHIFTS[index];
  const grid = def.map.map((row) => [...row]);
  const stations = [];
  const junctions = [];
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const kind = KIND_OF[ch] ? 'crate' : STATION_OF[ch];
      if (kind) stations.push({ id: stations.length, kind, ch, item: KIND_OF[ch] ?? null, c, r });
      else if (ch === 'J') {
        const pair = def.junctions[junctions.length] ?? '';
        junctions.push({ id: junctions.length, c, r, exits: [...pair].map((a) => ARROWS[a]) });
      }
    }),
  );
  const layout = { index, grid, stations, junctions, memo: new Map() };
  for (const st of stations) {
    st.out = null;
    if (st.kind === 'window' || st.kind === 'bin') continue;
    for (const [dx, dy] of NEIGHBOURS) {
      const nc = st.c + dx;
      const nr = st.r + dy;
      if (!isBeltChar(grid[nr]?.[nc] ?? '#')) continue;
      if (exitsAt(layout, nc, nr).some(([ex, ey]) => nc + ex === st.c && nr + ey === st.r))
        continue;
      st.out = [nc, nr];
      break;
    }
  }
  layouts[index] = layout;
  return layout;
}

const charAt = (lv, c, r) => lv.grid[r]?.[c] ?? '#';
export const stationAt = (lv, c, r) => lv.stations.find((st) => st.c === c && st.r === r) ?? null;
const junctionAt = (lv, c, r) => lv.junctions.find((j) => j.c === c && j.r === r) ?? null;
function exitsAt(lv, c, r) {
  const ch = charAt(lv, c, r);
  if (ch === 'J') return junctionAt(lv, c, r).exits;
  return ARROWS[ch] ? [ARROWS[ch]] : [];
}
function kindAt(lv, c, r) {
  const ch = charAt(lv, c, r);
  if (ch === '#') return 'wall';
  if (ch === '.') return 'floor';
  if (isBeltChar(ch)) return ch === 'J' ? 'junction' : 'belt';
  return stationAt(lv, c, r).kind;
}
const solidAt = (lv, c, r) => !['floor', 'belt', 'junction'].includes(kindAt(lv, c, r));

// ---------------------------------------------------------------------------
// Routes: what an item can still become, found by search over (tile, chopped, heat)
// ---------------------------------------------------------------------------

// Entering a tile applies its effect. Returns null when that is not allowed for this goal.
function enterTile(lv, c, r, chopped, heat, goal) {
  const kind = kindAt(lv, c, r);
  if (kind === 'belt' || kind === 'junction') return { chopped, heat };
  if (kind === 'chopper') {
    if (heat === 0 && !chopped) return goal.chop ? { chopped: true, heat } : null;
    return { chopped, heat };
  }
  if (kind === 'stove') {
    if (heat === 0) return goal.cook ? { chopped, heat: 1 } : null;
    return { chopped, heat };
  }
  if (kind === 'window') {
    if (goal.bin) return null;
    return chopped === goal.chop && heat === (goal.cook ? 1 : 0) ? { done: true } : null;
  }
  if (kind === 'bin') return goal.bin ? { done: true } : null;
  return null;
}

// Shortest route from a start node to the goal. `start.entering` means the item is still moving
// into (c, r), so that tile's effect has not been applied yet. Returns a list of nodes
// {c, r, kind, pick} where pick is the junction exit index chosen on leaving that node.
export function routeFor(lv, start, goal) {
  const key = `${start.c},${start.r},${start.entering ? 1 : 0},${start.chopped ? 1 : 0},${start.heat},${goal.bin ? 'B' : `${goal.chop ? 1 : 0}${goal.cook ? 1 : 0}`}`;
  if (lv.memo.has(key)) return lv.memo.get(key);
  let state = { chopped: start.chopped, heat: start.heat };
  let result = null;
  const first = start.entering
    ? enterTile(lv, start.c, start.r, state.chopped, state.heat, goal)
    : state;
  if (first?.done)
    result = [{ c: start.c, r: start.r, kind: kindAt(lv, start.c, start.r), pick: null }];
  else if (first) {
    state = first;
    const nodes = [{ c: start.c, r: start.r, chopped: state.chopped, heat: state.heat, from: -1 }];
    const seen = new Set([`${start.c},${start.r},${state.chopped},${state.heat}`]);
    for (let i = 0; i < nodes.length && !result; i++) {
      const n = nodes[i];
      for (const [pick, [ex, ey]] of outsOf(lv, n.c, n.r).entries()) {
        const nc = n.c + ex;
        const nr = n.r + ey;
        const entered = enterTile(lv, nc, nr, n.chopped, n.heat, goal);
        if (!entered) continue;
        const next = { c: nc, r: nr, chopped: entered.chopped, heat: entered.heat, from: i, pick };
        if (entered.done) {
          const path = [{ c: nc, r: nr, kind: kindAt(lv, nc, nr), pick: null }];
          for (let at = i, then = pick; at >= 0; then = nodes[at].pick, at = nodes[at].from) {
            const q = nodes[at];
            const multi = outsOf(lv, q.c, q.r).length > 1;
            path.unshift({ c: q.c, r: q.r, kind: kindAt(lv, q.c, q.r), pick: multi ? then : null });
          }
          result = path;
          break;
        }
        const id = `${nc},${nr},${next.chopped},${next.heat}`;
        if (seen.has(id)) continue;
        seen.add(id);
        nodes.push(next);
      }
    }
  }
  lv.memo.set(key, result);
  return result;
}

function outsOf(lv, c, r) {
  const st = stationAt(lv, c, r);
  if (st) return st.out ? [[st.out[0] - c, st.out[1] - r]] : [];
  return exitsAt(lv, c, r);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function newState(mode = 1) {
  const s = {
    phase: 'playing',
    cause: null,
    score: 0,
    mode: mode === 2 ? 2 : 1,
    ticks: 0,
    acc: 0,
    shiftIndex: 0,
    menu: null,
    menuClock: 0,
    clear: 0,
    unlockTo: 0,
    pend: [
      { act: false, route: false },
      { act: false, route: false },
    ],
    msg: null,
    refresh: false,
    prompt: { id: '', key: 'drop', subject: null, age: 0 },
    stats: {},
  };
  loadShift(s, 0);
  return s;
}

export function loadShift(s, index) {
  const def = SHIFTS[index];
  const lv = layoutOf(index);
  s.shiftIndex = index;
  s.def = def;
  s.lv = lv;
  s.ticks = 0;
  s.clear = 0;
  s.msg = null;
  s.items = [];
  s.nextId = 1;
  s.occ = new Array(COLS * ROWS).fill(-1);
  s.jn = lv.junctions.map(() => 0);
  s.stn = lv.stations.map((st) => ({
    stock: st.kind === 'crate' ? (def.stock[st.ch] ?? 3) : 0,
    cool: 0,
    slot: null,
    mode: 'empty',
    prog: 0,
    reserved: -1,
    flash: 0,
  }));
  s.chefs = def.chefs.slice(0, s.mode).map(([c, r], i) => ({
    x: cx(c),
    y: cy(r),
    face: 'down',
    walk: 0,
    flash: 0,
    id: i,
  }));
  s.orders = def.tickets.map((t, i) => ({
    id: i,
    at: Math.round(t.at * 120),
    patience: t.patience,
    left: t.patience,
    parts: t.parts.map((p) => ({ ...p, done: false })),
    state: 'future',
    pts: 0,
  }));
  s.points = 0;
  s.penalty = 0;
  s.verdict = null;
  s.stats = {
    acts: 0, // successful chef actions
    drops: 0,
    chops: 0,
    pulls: 0,
    reroutes: 0,
    rejects: 0,
    served: 0,
    expired: 0,
    burnt: 0,
    binned: 0,
  };
  s.prompt = { id: '', key: 'drop', subject: null, age: RULES.promptHold };
  setPrompt(s, true);
}

// A successful chef action: the prompt that asked for it moves on at once.
function act(s) {
  s.stats.acts++;
  s.refresh = true;
}

function say(s, en, zh) {
  s.msg = { en, zh, left: RULES.msgTicks };
}

const occIndex = (c, r) => r * COLS + c;

function canEnter(s, c, r) {
  const kind = kindAt(s.lv, c, r);
  if (kind === 'belt' || kind === 'junction') return s.occ[occIndex(c, r)] === -1;
  if (kind === 'chopper' || kind === 'stove') {
    const d = s.stn[stationAt(s.lv, c, r).id];
    return !d.slot && d.reserved === -1;
  }
  return kind === 'window' || kind === 'bin';
}

function reserve(s, c, r, id) {
  const kind = kindAt(s.lv, c, r);
  if (kind === 'belt' || kind === 'junction') s.occ[occIndex(c, r)] = id;
  else if (kind === 'chopper' || kind === 'stove') s.stn[stationAt(s.lv, c, r).id].reserved = id;
}

// Put an item on the belt from a crate or station tile heading into its out tile.
function launch(s, item, from, out) {
  Object.assign(item, {
    c: from.c,
    r: from.r,
    nc: out[0],
    nr: out[1],
    u: 0,
    released: true,
    wait: 0,
  });
  reserve(s, out[0], out[1], item.id);
  s.items.push(item);
}

function newItem(s, kind) {
  return { id: s.nextId++, kind, chopped: false, heat: 0 };
}

// ---------------------------------------------------------------------------
// Chefs
// ---------------------------------------------------------------------------

function blockedBox(lv, x, y) {
  const c0 = Math.floor((x - HALF) / TILE);
  const c1 = Math.floor((x + HALF - 1e-6) / TILE);
  const r0 = Math.floor((y - HALF - TOP) / TILE);
  const r1 = Math.floor((y + HALF - 1e-6 - TOP) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidAt(lv, c, r)) return true;
  return false;
}

function moveAxis(lv, chef, axis, delta) {
  if (!delta) return;
  chef[axis] += delta;
  if (!blockedBox(lv, chef.x, chef.y)) return;
  const origin = axis === 'x' ? 0 : TOP;
  const edge = chef[axis] - origin;
  chef[axis] =
    delta > 0
      ? Math.floor((edge + HALF - 1e-6) / TILE) * TILE - HALF + origin
      : (Math.floor((edge - HALF) / TILE) + 1) * TILE + HALF + origin;
}

function moveChef(s, chef, dir) {
  let { dx, dy } = dir;
  if (dx && dy) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  const d = RULES.chefSpeed * STEP;
  moveAxis(s.lv, chef, 'x', dx * d);
  moveAxis(s.lv, chef, 'y', dy * d);
  if (dx || dy) {
    chef.walk += STEP;
    chef.face = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }
  if (chef.flash > 0) chef.flash--;
}

const reachOf = (chef, c, r) => Math.hypot(chef.x - cx(c), chef.y - cy(r));

function nearestStation(s, chef, kinds) {
  let best = null;
  let bestD = RULES.reach + 1e-9;
  for (const st of s.lv.stations) {
    if (!kinds.includes(st.kind)) continue;
    const d = reachOf(chef, st.c, st.r);
    if (d < bestD - 1e-9) {
      best = st;
      bestD = d;
    }
  }
  return best;
}

// Space: the nearest crate, board or stove in reach.
function interact(s, chef, emit) {
  const st = nearestStation(s, chef, ['crate', 'chopper', 'stove']);
  if (!st)
    return say(s, 'Nothing in reach: stand next to a station.', '够不到：请站在工作台旁边。');
  const d = s.stn[st.id];
  chef.flash = 24;
  if (st.kind === 'crate') return dropFromCrate(s, st, d, emit);
  if (st.kind === 'chopper') return startChop(s, d);
  return pullFromStove(s, st, d, emit);
}

function dropFromCrate(s, st, d, emit) {
  const name = KINDS[st.item];
  if (d.stock <= 0) return say(s, `The ${name.en} crate is empty.`, `${name.zh}箱空了。`);
  if (d.cool > 0) return say(s, 'The crate is reloading.', '食材箱正在补货。');
  if (!canEnter(s, st.out[0], st.out[1]))
    return say(s, 'The belt is busy there.', '那里的传送带被占着。');
  d.stock--;
  d.cool = Math.round(RULES.crateCooldown / STEP);
  s.stats.drops++;
  act(s);
  launch(s, newItem(s, st.item), st, st.out);
  emit('move');
}

function startChop(s, d) {
  if (!d.slot) return say(s, 'Nothing on the board to chop.', '砧板上没有东西可切。');
  if (d.mode !== 'idle') return say(s, 'Already chopping.', '已经在切了。');
  d.mode = 'chopping';
  d.prog = 0;
  act(s);
}

function pullFromStove(s, st, d, emit) {
  if (!d.slot) return say(s, 'The stove is empty.', '炉灶是空的。');
  if (d.mode !== 'cook') return say(s, 'Nothing to take out.', '没有可取出的东西。');
  if (!canEnter(s, st.out[0], st.out[1]))
    return say(s, 'The belt is busy there.', '那里的传送带被占着。');
  const item = d.slot;
  s.stats.pulls++;
  act(s);
  if (item.heat === 0)
    say(
      s,
      `You took the ${KINDS[item.kind].en} out raw.`,
      `你把${KINDS[item.kind].zh}生着取了出来。`,
    );
  d.slot = null;
  d.mode = 'empty';
  launch(s, item, st, st.out);
  emit('move');
}

// X: the nearest junction in reach.
function reroute(s, chef, emit) {
  let best = null;
  let bestD = RULES.reach + 1e-9;
  for (const j of s.lv.junctions) {
    const d = reachOf(chef, j.c, j.r);
    if (d < bestD - 1e-9) {
      best = j;
      bestD = d;
    }
  }
  if (!best)
    return say(s, 'No junction in reach: stand next to one.', '够不到分流器：请站在它旁边。');
  s.jn[best.id] ^= 1;
  s.stats.reroutes++;
  act(s);
  chef.flash = 24;
  emit('move');
}

// ---------------------------------------------------------------------------
// Stations and items
// ---------------------------------------------------------------------------

const cookWindow = (s) => s.def.window;

function stationTick(s, emit) {
  s.lv.stations.forEach((st) => {
    const d = s.stn[st.id];
    if (d.cool > 0) d.cool--;
    if (d.flash > 0) d.flash--;
    if (st.kind === 'chopper' && d.mode === 'chopping') {
      if (s.chefs.some((chef) => reachOf(chef, st.c, st.r) <= RULES.reach)) d.prog += STEP;
      if (d.prog >= RULES.chopTime - 1e-9) {
        d.slot.chopped = true;
        d.mode = 'done';
        s.stats.chops++;
        emit('coin');
      }
    }
    if (st.kind === 'stove' && d.mode === 'cook') {
      d.prog += STEP;
      if (d.slot.heat === 0 && d.prog >= RULES.cookTime - 1e-9) {
        d.slot.heat = 1;
        emit('coin');
      } else if (d.slot.heat === 1 && d.prog >= RULES.cookTime + cookWindow(s) - 1e-9) {
        d.slot.heat = 2;
        d.mode = 'spit';
        s.stats.burnt++;
        say(
          s,
          `The ${KINDS[d.slot.kind].en} burnt and was spat out!`,
          `${KINDS[d.slot.kind].zh}烧焦了，被吐了出来！`,
        );
        emit('hit');
      }
    }
    if (['done', 'pass', 'spit'].includes(d.mode) && canEnter(s, st.out[0], st.out[1])) {
      const item = d.slot;
      d.slot = null;
      d.mode = 'empty';
      launch(s, item, st, st.out);
    }
  });
}

function departTile(s, item) {
  const lv = s.lv;
  const kind = kindAt(lv, item.c, item.r);
  if (kind === 'belt')
    return [item.c + exitsAt(lv, item.c, item.r)[0][0], item.r + exitsAt(lv, item.c, item.r)[0][1]];
  if (kind === 'junction') {
    const j = junctionAt(lv, item.c, item.r);
    const [ex, ey] = j.exits[s.jn[j.id]];
    return [item.c + ex, item.r + ey];
  }
  return null;
}

function itemTick(s, emit) {
  const order = s.items.slice().sort((a, b) => b.wait - a.wait || a.id - b.id);
  const speed = s.def.speed * STEP;
  for (const item of order) {
    if (item.nc < 0) {
      const to = departTile(s, item);
      if (!to || !canEnter(s, to[0], to[1])) {
        item.wait++;
        continue;
      }
      reserve(s, to[0], to[1], item.id);
      Object.assign(item, { nc: to[0], nr: to[1], u: 0, released: false, wait: 0 });
    }
    item.u += speed;
    if (item.u >= 0.5 && !item.released) {
      item.released = true;
      const k = occIndex(item.c, item.r);
      if (s.occ[k] === item.id) s.occ[k] = -1;
    }
    if (item.u >= 1 - 1e-9) arrive(s, item, emit);
  }
}

function arrive(s, item, emit) {
  item.c = item.nc;
  item.r = item.nr;
  item.nc = -1;
  item.u = 0;
  item.released = false;
  const kind = kindAt(s.lv, item.c, item.r);
  if (kind === 'belt' || kind === 'junction') return;
  s.items = s.items.filter((o) => o !== item);
  if (kind === 'window') return serve(s, item, emit);
  if (kind === 'bin') {
    s.stats.binned++;
    say(
      s,
      `The ${KINDS[item.kind].en} went into the bin.`,
      `${KINDS[item.kind].zh}被扔进了垃圾桶。`,
    );
    return;
  }
  const st = stationAt(s.lv, item.c, item.r);
  const d = s.stn[st.id];
  d.reserved = -1;
  d.slot = item;
  d.prog = 0;
  if (kind === 'chopper') d.mode = item.heat === 0 && !item.chopped ? 'idle' : 'pass';
  else d.mode = item.heat === 0 ? 'cook' : 'pass';
}

// ---------------------------------------------------------------------------
// Tickets, serving and satisfaction
// ---------------------------------------------------------------------------

const same = (item, part) =>
  item.kind === part.kind && item.chopped === part.chop && item.heat === (part.cook ? 1 : 0);
const openOrders = (s) => s.orders.filter((o) => o.state === 'open');

export function verdictFor(orders, item) {
  if (item.heat === 2) return { reject: 'burnt' };
  for (const o of orders) {
    const part = o.parts.find((p) => !p.done && same(item, p));
    if (part) return { order: o, part };
  }
  for (const o of orders) {
    const part = o.parts.find((p) => !p.done && p.kind === item.kind);
    if (!part) continue;
    if (part.cook && item.heat === 0) return { reject: 'raw' };
    if (part.chop && !item.chopped) return { reject: 'unchopped' };
    return { reject: 'wrong' };
  }
  return { reject: 'wrong' };
}

const REJECTS = {
  burnt: ['burnt', '烧焦了'],
  raw: ['raw', '是生的'],
  unchopped: ['not chopped', '没有切'],
  wrong: ['not what any ticket wants', '不是任何订单要的'],
};

function serve(s, item, emit) {
  const v = verdictFor(openOrders(s), item);
  const name = KINDS[item.kind];
  if (v.reject) {
    const [en, zh] = REJECTS[v.reject];
    s.penalty += RULES.rejectPenalty;
    s.score = Math.max(0, s.score - RULES.rejectPenalty);
    s.stats.rejects++;
    s.verdict = { ok: false, left: 120 };
    say(s, `Rejected: the ${name.en} is ${en}.`, `退回：${name.zh}${zh}。`);
    emit('hit');
    return;
  }
  v.part.done = true;
  s.verdict = { ok: true, left: 120 };
  if (v.order.parts.every((p) => p.done)) {
    const pts = Math.round(RULES.baseScore + (RULES.fastBonus * v.order.left) / v.order.patience);
    v.order.state = 'served';
    v.order.pts = pts;
    s.points += pts;
    s.score += pts;
    s.stats.served++;
    say(s, `Ticket served: +${pts}.`, `订单完成：+${pts}。`);
  }
  emit('coin');
}

export const satisfactionOf = (s) =>
  Math.max(0, Math.min(100, ((s.points - s.penalty) / (100 * s.orders.length)) * 100));

function ordersTick(s, emit) {
  for (const o of s.orders) {
    if (o.state === 'future' && s.ticks >= o.at) o.state = 'open';
    else if (o.state === 'open') {
      o.left -= STEP;
      if (o.left <= 0) {
        o.left = 0;
        o.state = 'expired';
        s.stats.expired++;
        say(s, 'A customer gave up waiting.', '有顾客等不及走了。');
        emit('hit');
      }
    }
  }
}

function finish(s, phase, cause) {
  s.phase = phase;
  s.cause = cause;
}

// Tickets that can still be made: every unfinished part needs an ingredient in a crate, on a
// belt or in a station. Tickets are served in order, so earlier ones claim the supply first.
// The largest number of the given part-needs the supply can cover together (exact, not greedy).
function bestCover(needs, have, from = 0) {
  if (from >= needs.length) return 0;
  const skip = bestCover(needs, have, from + 1);
  const need = needs[from];
  if (Object.keys(need).some((kind) => (have[kind] ?? 0) < need[kind])) return skip;
  const left = { ...have };
  for (const kind of Object.keys(need)) left[kind] -= need[kind];
  return Math.max(skip, 1 + bestCover(needs, left, from + 1));
}

function suppliedTickets(s, exact = false) {
  const have = {};
  for (const [k, st] of s.lv.stations.entries())
    if (st.kind === 'crate') have[st.item] = (have[st.item] ?? 0) + s.stn[k].stock;
  const dishes = [...s.items, ...s.stn.map((d) => d.slot).filter(Boolean)];
  for (const dish of dishes) if (dish.heat < 2) have[dish.kind] = (have[dish.kind] ?? 0) + 1;
  const needs = [];
  for (const o of s.orders) {
    if (o.state !== 'open' && o.state !== 'future') continue;
    const need = {};
    for (const p of o.parts) if (!p.done) need[p.kind] = (need[p.kind] ?? 0) + 1;
    needs.push(need);
  }
  let made = 0;
  let lacking = null;
  const left = { ...have };
  for (const need of needs) {
    const short = Object.keys(need).find((kind) => (left[kind] ?? 0) < need[kind]);
    if (short) lacking ??= short;
    else {
      for (const kind of Object.keys(need)) left[kind] -= need[kind];
      made++;
    }
  }
  // Greedy can undercount when tickets compete for one ingredient; check exactly before a loss.
  if (exact && lacking) made = bestCover(needs, have);
  return { made, lacking };
}

function settle(s, emit) {
  const total = s.orders.length;
  const resolved = s.orders.filter((o) => o.state === 'served' || o.state === 'expired').length;
  const percent = (open) =>
    Math.min(100, ((s.points - s.penalty + 100 * open) / (100 * total)) * 100);
  if (percent(total - resolved) < s.def.need - 1e-9) return finish(s, 'lost', 'satisfaction');
  let { made, lacking } = suppliedTickets(s);
  if (percent(made) < s.def.need - 1e-9) ({ made, lacking } = suppliedTickets(s, true));
  if (percent(made) < s.def.need - 1e-9) {
    s.lacking = lacking;
    return finish(s, 'lost', 'stock');
  }
  if (resolved < total) return;
  s.clear = RULES.clearTicks;
  s.score += RULES.clearScore + Math.round(satisfactionOf(s));
  const last = s.shiftIndex === SHIFTS.length - 1;
  if (!last) {
    s.unlockTo = s.shiftIndex + 2;
    emit('win');
  }
  say(s, 'Shift cleared!', '班次完成！');
}

// ---------------------------------------------------------------------------
// The simulation step
// ---------------------------------------------------------------------------

function tick(s, dirs, emit) {
  s.ticks++;
  if (s.msg && --s.msg.left <= 0) s.msg = null;
  if (s.verdict && --s.verdict.left <= 0) s.verdict = null;
  if (s.clear > 0) {
    if (--s.clear === 0) {
      if (s.shiftIndex === SHIFTS.length - 1) finish(s, 'won', null);
      else loadShift(s, s.shiftIndex + 1);
    }
    s.pend.forEach((p) => (p.act = p.route = false));
    return;
  }
  const first = s.ticks % 2 ? 0 : 1;
  for (const k of [first, 1 - first]) {
    const chef = s.chefs[k];
    if (!chef) continue;
    if (s.pend[k].act) interact(s, chef, emit);
    if (s.pend[k].route) reroute(s, chef, emit);
    s.pend[k].act = s.pend[k].route = false;
  }
  s.chefs.forEach((chef, k) => moveChef(s, chef, dirs[k]));
  stationTick(s, emit);
  itemTick(s, emit);
  ordersTick(s, emit);
  settle(s, emit);
  if (s.phase === 'playing' && (s.refresh || s.ticks % RULES.promptEvery === 0))
    setPrompt(s, s.refresh);
  s.refresh = false;
}

const axis = (input, neg, pos) => Number(input.held(...pos)) - Number(input.held(...neg));

function readDirs(s, input) {
  const left = ['ArrowLeft', 'KeyA'];
  const right = ['ArrowRight', 'KeyD'];
  const up = ['ArrowUp', 'KeyW'];
  const down = ['ArrowDown', 'KeyS'];
  if (s.mode === 1) return [{ dx: axis(input, left, right), dy: axis(input, up, down) }];
  return [
    { dx: axis(input, ['KeyA'], ['KeyD']), dy: axis(input, ['KeyW'], ['KeyS']) },
    { dx: axis(input, ['ArrowLeft'], ['ArrowRight']), dy: axis(input, ['ArrowUp'], ['ArrowDown']) },
  ];
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuStep(s, dt, input, emit);
    return true;
  }
  if (s.mode === 1) {
    if (input.pressed('Space')) s.pend[0].act = true;
    if (input.pressed('KeyX')) s.pend[0].route = true;
  } else {
    if (input.pressed('KeyF')) s.pend[0].act = true;
    if (input.pressed('KeyG')) s.pend[0].route = true;
    if (input.pressed('Comma')) s.pend[1].act = true;
    if (input.pressed('Period')) s.pend[1].route = true;
  }
  const dirs = readDirs(s, input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dirs, emit);
  return true;
}

// ---------------------------------------------------------------------------
// Prompts: the one thing the player should do next, found by routing every item
// ---------------------------------------------------------------------------

export const PROMPTS = freeze({
  menu: ['Arrows: pick a shift. {A}: start', '方向键选班次，按{A}开始'],
  drop: ['Go to the {i} crate: {A} puts one on the belt', '去{i}箱旁：按{A}放一份到传送带'],
  chop: ['At the board: {A} starts chopping the {i}', '在砧板旁：按{A}开始切{i}'],
  stay: ['Arrows: stay by the board while the {i} is chopped', '方向键：留在砧板旁，等{i}切好'],
  cook: ['Wait by the stove: {A} takes the {i} out when green', '守在炉灶旁：变绿时按{A}取出{i}'],
  clear: ['{A}: clear the stray {i} off the board', '按{A}：把多余的{i}从砧板上清走'],
  pull: ['{A} now: take the {i} off the stove!', '现在按{A}：把{i}从炉灶取出！'],
  preset: [
    '{R} at the junction: the next {i} goes to the {w}',
    '在分流器旁按{R}：下一份{i}要去{w}',
  ],
  reroute: ['{R} at the junction: send the {i} to the {w}', '在分流器旁按{R}：把{i}送往{w}'],
  wait: ['Arrows: watch the belt; {A} and {R} when told', '方向键：看着传送带；提示时按{A}或{R}'],
  cleared: ['Shift cleared! Arrows move you in the next one', '班次完成！下一班用方向键移动'],
});
const WHERE = {
  chopper: ['board', '砧板'],
  stove: ['stove', '炉灶'],
  window: ['window', '出餐口'],
  bin: ['bin', '垃圾桶'],
};

function sourcesOf(s) {
  const out = [];
  for (const item of s.items) {
    const entering = item.nc >= 0;
    out.push({
      item,
      lead: entering ? 1 - item.u : 0,
      start: {
        c: entering ? item.nc : item.c,
        r: entering ? item.nr : item.r,
        entering,
        chopped: item.chopped,
        heat: item.heat,
      },
    });
  }
  for (const st of s.lv.stations) {
    const d = s.stn[st.id];
    if (!d.slot) continue;
    const item = d.slot;
    const chopped = item.chopped || (st.kind === 'chopper' && d.mode !== 'pass');
    const heat = st.kind === 'stove' && d.mode === 'cook' ? Math.max(1, item.heat) : item.heat;
    out.push({
      item,
      station: st,
      lead: 0,
      start: { c: st.c, r: st.r, entering: false, chopped, heat },
    });
  }
  return out;
}

function assignParts(s) {
  const sources = sourcesOf(s);
  const taken = new Set();
  const plans = [];
  const unsupplied = [];
  for (const order of openOrders(s)) {
    for (const part of order.parts) {
      if (part.done) continue;
      let best = null;
      for (const src of sources) {
        if (taken.has(src) || src.item.kind !== part.kind || src.item.heat === 2) continue;
        const route = routeFor(s.lv, src.start, part);
        if (route && (!best || route.length < best.route.length)) best = { src, route };
      }
      if (best) {
        taken.add(best.src);
        plans.push({ ...best, part });
      } else unsupplied.push(part);
    }
  }
  for (const src of sources) {
    if (taken.has(src)) continue;
    const route = routeFor(s.lv, src.start, { bin: true });
    if (route) plans.push({ src, route, part: null });
  }
  return { plans, unsupplied };
}

const walkSeconds = (s, c, r) =>
  Math.min(...s.chefs.map((chef) => reachOf(chef, c, r))) / RULES.chefSpeed;

// Leaving a cooking dish to fetch an ingredient must leave time to come back before it burns.
function tripIsSafe(s, target) {
  return s.lv.stations.every((st) => {
    const d = s.stn[st.id];
    if (st.kind !== 'stove' || d.mode !== 'cook') return true;
    const deadline = RULES.cookTime + cookWindow(s) - d.prog;
    const there = Math.min(...s.chefs.map((chef) => reachOf(chef, target.c, target.r)));
    const back = Math.hypot(cx(target.c) - cx(st.c), cy(target.r) - cy(st.r));
    return ((there + back) / RULES.chefSpeed) * 1.3 + RULES.tripSlack <= deadline;
  });
}

function wantsOf(s) {
  const { plans, unsupplied } = assignParts(s);
  const wants = [];
  const decisions = new Map();
  for (const { src, route } of plans) {
    const kindOfItem = src.item.kind;
    if (src.station) {
      const st = src.station;
      const d = s.stn[st.id];
      if (st.kind === 'chopper' && d.mode === 'idle')
        wants.push({ urg: 2, key: 'chop', c: st.c, r: st.r, i: kindOfItem });
      else if (st.kind === 'chopper' && d.mode === 'chopping')
        wants.push({ urg: 2.5, key: 'stay', c: st.c, r: st.r, i: kindOfItem });
      else if (st.kind === 'stove' && d.mode === 'cook') {
        const left = RULES.cookTime + cookWindow(s) - d.prog;
        wants.push(
          d.slot.heat >= 1
            ? {
                urg: left - walkSeconds(s, st.c, st.r) * 1.3,
                key: 'pull',
                c: st.c,
                r: st.r,
                i: kindOfItem,
              }
            : { urg: 12, key: 'cook', c: st.c, r: st.r, i: kindOfItem },
        );
      }
      continue;
    }
    let viaStation = false;
    route.forEach((node, idx) => {
      if (node.pick !== null && !viaStation) {
        const j = junctionAt(s.lv, node.c, node.r);
        const after = route.slice(idx + 1).find((q) => WHERE[q.kind]);
        const eta = (src.lead + idx) / s.def.speed;
        const known = decisions.get(j.id);
        if (!known || eta < known.eta)
          decisions.set(j.id, {
            eta,
            pick: node.pick,
            j,
            i: kindOfItem,
            w: after?.kind ?? 'window',
          });
      }
      if (node.kind === 'chopper' || node.kind === 'stove') viaStation = true;
    });
  }
  for (const [id, dec] of decisions) {
    if (s.jn[id] === dec.pick) continue;
    const walk = walkSeconds(s, dec.j.c, dec.j.r);
    if (dec.eta <= 4 + walk * 1.5)
      wants.push({
        urg: dec.eta - walk * 1.3,
        key: 'reroute',
        c: dec.j.c,
        r: dec.j.r,
        i: dec.i,
        w: dec.w,
      });
  }
  for (const st of s.lv.stations) {
    const d = s.stn[st.id];
    const planned = plans.some((p) => p.src.station === st);
    if (st.kind === 'chopper' && d.mode === 'idle' && !planned)
      wants.push({ urg: 5, key: 'clear', c: st.c, r: st.r, i: d.slot.kind });
    if (st.kind === 'chopper' && d.mode === 'chopping' && !planned)
      wants.push({ urg: 2.5, key: 'stay', c: st.c, r: st.r, i: d.slot.kind });
  }
  // A new item is only sent while the junctions on its way are not promised to an earlier item
  // that needs the other exit; this keeps one junction flip enough for everything in flight.
  const pending = new Map();
  for (const { route } of plans)
    route.forEach((node) => {
      if (node.pick === null) return;
      const j = junctionAt(s.lv, node.c, node.r);
      pending.set(j.id, [...(pending.get(j.id) ?? []), node.pick]);
    });
  for (const part of unsupplied) {
    const crate = s.lv.stations.find(
      (st) => st.kind === 'crate' && st.item === part.kind && s.stn[st.id].stock > 0,
    );
    if (!crate || !tripIsSafe(s, crate)) continue;
    const route = routeFor(
      s.lv,
      { c: crate.out[0], r: crate.out[1], entering: true, chopped: false, heat: 0 },
      part,
    );
    const clash = route?.some((node) => {
      if (node.pick === null) return false;
      const picks = pending.get(junctionAt(s.lv, node.c, node.r).id) ?? [];
      return picks.some((p) => p !== node.pick);
    });
    if (route && !clash) {
      // Set every junction on the way first; nothing earlier is promised to the other exit.
      const unset = route
        .map((node, idx) => ({ node, idx }))
        .filter(({ node }) => node.pick !== null)
        .map(({ node, idx }) => ({
          j: junctionAt(s.lv, node.c, node.r),
          pick: node.pick,
          idx,
          node,
        }))
        .filter(({ j, pick }) => !(pending.get(j.id) ?? []).length && s.jn[j.id] !== pick);
      if (unset.length) {
        const first = unset.sort(
          (a, b) => walkSeconds(s, a.j.c, a.j.r) - walkSeconds(s, b.j.c, b.j.r),
        )[0];
        if (!tripIsSafe(s, first.j)) continue;
        const after = route.slice(first.idx + 1).find((q) => WHERE[q.kind]);
        wants.push({
          urg: 9,
          key: 'preset',
          c: first.j.c,
          r: first.j.r,
          i: part.kind,
          w: after?.kind ?? 'window',
        });
      } else wants.push({ urg: 10, key: 'drop', c: crate.c, r: crate.r, i: part.kind });
      break;
    }
  }
  wants.sort((a, b) => a.urg - b.urg);
  return wants[0] ?? { urg: 99, key: 'wait', c: -1, r: -1 };
}

function wantPrompt(s) {
  if (s.menu) return { key: 'menu', c: -1, r: -1 };
  if (s.clear > 0 || s.phase !== 'playing') return { key: 'cleared', c: -1, r: -1 };
  return wantsOf(s);
}

function setPrompt(s, force = false) {
  const w = wantPrompt(s);
  const id = `${w.key}:${w.c},${w.r}:${w.i ?? ''}:${w.w ?? ''}`;
  if (id === s.prompt.id) return;
  if (!force && s.ticks - s.prompt.born < RULES.promptHold) return;
  s.prompt = { id, key: w.key, c: w.c, r: w.r, i: w.i ?? null, w: w.w ?? null, born: s.ticks };
}

export function promptText(s) {
  const { key, i, w, c, r } = s.prompt;
  const keys = s.mode === 2 ? { A: 'F/,', R: 'G/.' } : { A: 'Space', R: 'X' };
  const fill = (lang) =>
    PROMPTS[key][lang === 'en' ? 0 : 1]
      .replace('{A}', keys.A)
      .replace('{R}', keys.R)
      .replace('{i}', i ? KINDS[i][lang] : '')
      .replace('{w}', w ? WHERE[w][lang === 'en' ? 0 : 1] : '');
  return { key, en: fill('en'), zh: fill('zh'), target: c >= 0 ? { c, r } : null };
}

// ---------------------------------------------------------------------------
// Shift select
// ---------------------------------------------------------------------------

const MENU = { cols: 6, w: 68, h: 44, gap: 8, x0: 16, y0: 36 };
export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: MENU.x0 + (i % MENU.cols) * (MENU.w + MENU.gap),
    y: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.h + MENU.gap),
    w: MENU.w,
    h: MENU.h,
  };
};
const menuHit = (pointer) =>
  SHIFTS.findIndex((_, i) => {
    const q = menuCell(i + 1);
    return pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h;
  }) + 1;

export function openMenu(s, unlocked) {
  s.menu = { cursor: unlocked, unlocked };
  s.msg = null;
  setPrompt(s, true);
}

function menuStep(s, dt, input, emit) {
  const m = s.menu;
  s.menuClock += dt;
  if (s.msg && (s.msg.left -= dt / STEP) <= 0) s.msg = null;
  const was = m.cursor;
  const step = (neg, pos, size) =>
    Number(input.pressed(...pos)) * size - Number(input.pressed(...neg)) * size;
  const move =
    step(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD'], 1) +
    step(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS'], MENU.cols);
  m.cursor = Math.max(1, Math.min(m.unlocked, m.cursor + move));
  if (m.cursor !== was) emit('move');
  const tapped = input.pointer?.clicked ? menuHit(input.pointer) : 0;
  if (tapped > m.unlocked) {
    emit('hit');
    say(s, `Clear shift ${m.unlocked} first.`, `请先通关第${m.unlocked}班。`);
  } else if (tapped) m.cursor = tapped;
  const confirm = input.pressed('Space', 'Enter', 'NumpadEnter', 'KeyF', 'Comma');
  if (tapped <= m.unlocked && (tapped || confirm)) {
    loadShift(s, m.cursor - 1);
    s.menu = null;
    setPrompt(s, true);
    emit('move');
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

const rectOf = (x, y) => ({ x: x - SPRITE / 2, y: y - SPRITE / 2, w: SPRITE, h: SPRITE });
const KEY_NAMES = { 1: 'Space / X', 2: 'F G , .' };

function stationView(s, st) {
  const d = s.stn[st.id];
  const view = {
    id: st.id,
    kind: st.kind,
    c: st.c,
    r: st.r,
    x: cx(st.c),
    y: cy(st.r),
    rect: rectOf(cx(st.c), cy(st.r)),
  };
  if (st.kind === 'crate')
    Object.assign(view, { item: st.item, stock: d.stock, reload: d.cool > 0 });
  if (st.kind === 'chopper' || st.kind === 'stove') {
    const item = d.slot;
    const total = RULES.cookTime + cookWindow(s);
    Object.assign(view, {
      holding: item ? { kind: item.kind, chopped: item.chopped, heat: item.heat } : null,
      mode: d.mode,
      fill:
        st.kind === 'chopper' ? Math.min(1, d.prog / RULES.chopTime) : Math.min(1, d.prog / total),
      warning:
        st.kind === 'stove' &&
        d.mode === 'cook' &&
        item.heat === 1 &&
        d.prog >= total - RULES.burnWarn,
      attended: s.chefs.some((chef) => reachOf(chef, st.c, st.r) <= RULES.reach),
    });
  }
  return view;
}

function buildStatus(s, prompt) {
  if (s.menu) {
    const { unlocked } = s.menu;
    return {
      en: `Conveyor Chef · ${unlocked}/${SHIFTS.length} shifts open · ${prompt.en}`,
      zh: `传送带厨房 · 已开放 ${unlocked}/${SHIFTS.length} 班 · ${prompt.zh}`,
    };
  }
  const n = s.shiftIndex + 1;
  const sat = Math.round(satisfactionOf(s));
  const served = s.orders.filter((o) => o.state === 'served').length;
  const tip = s.ticks < 1200 ? s.def.tip : null;
  const note = (lang) => (s.msg ? `${s.msg[lang]} · ` : tip ? `${tip[lang]} · ` : '');
  return {
    en: `Shift ${n}/${SHIFTS.length} · Satisfaction ${sat}% (need ${s.def.need}%) · Served ${served}/${s.orders.length} · Belt ${s.def.speed} tiles/s · ${note('en')}${prompt.en}`,
    zh: `第 ${n}/${SHIFTS.length} 班 · 满意度 ${sat}%（需要 ${s.def.need}%）· 已上菜 ${served}/${s.orders.length} · 传送带 ${s.def.speed} 格/秒 · ${note('zh')}${prompt.zh}`,
  };
}

export function snapshot(s) {
  const prompt = promptText(s);
  const speedPx = s.def.speed * TILE;
  return {
    phase: s.phase,
    cause: s.cause,
    score: s.score,
    mode: s.mode,
    time: s.ticks * STEP,
    shift: s.shiftIndex + 1,
    shiftCount: SHIFTS.length,
    shiftName: { ...s.def.name },
    tip: { ...s.def.tip },
    menu: s.menu ? { ...s.menu, total: SHIFTS.length } : null,
    satisfaction: satisfactionOf(s),
    need: s.def.need,
    belt: { tilesPerSecond: s.def.speed, pixelsPerSecond: speedPx },
    rules: { chopTime: RULES.chopTime, cookTime: RULES.cookTime, cookWindow: cookWindow(s) },
    tiles: s.lv.grid.map((row) => row.join('')),
    chefs: s.chefs.map((chef) => ({
      x: chef.x,
      y: chef.y,
      face: chef.face,
      rect: rectOf(chef.x, chef.y),
    })),
    stations: s.lv.stations.map((st) => stationView(s, st)),
    junctions: s.lv.junctions.map((j) => ({
      id: j.id,
      c: j.c,
      r: j.r,
      x: cx(j.c),
      y: cy(j.r),
      state: s.jn[j.id],
      exits: j.exits.map(([dx, dy]) => ({ dx, dy })),
    })),
    items: s.items.map((it) => {
      const t = it.nc >= 0 ? it.u : 0;
      const x = cx(it.c) + (it.nc >= 0 ? (it.nc - it.c) * TILE * t : 0);
      const y = cy(it.r) + (it.nc >= 0 ? (it.nr - it.r) * TILE * t : 0);
      return {
        id: it.id,
        kind: it.kind,
        chopped: it.chopped,
        heat: it.heat,
        x,
        y,
        rect: rectOf(x, y),
      };
    }),
    orders: s.orders.map((o) => ({
      id: o.id,
      state: o.state,
      patience: o.patience,
      left: o.state === 'open' ? o.left : null,
      parts: o.state === 'future' ? [] : o.parts.map((p) => ({ ...p })),
      pts: o.pts,
    })),
    ordersLeft: s.orders.filter((o) => o.state === 'future').length,
    prompt,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    verdict: s.verdict ? { ok: s.verdict.ok } : null,
    stats: { ...s.stats },
    keys: KEY_NAMES[s.mode],
    hud: { top: [0, TOP], bottom: [BOTTOM, 320] },
    status: buildStatus(s, prompt),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const PALETTE = {
  bread: ['#e8b25f', '#e8b25f'],
  tomato: ['#e5493a', '#b2352b'],
  meat: ['#e58a9a', '#8a4a2a'],
  fish: ['#8fd3ee', '#e8a65a'],
  egg: ['#fff3d1', '#fff9ea'],
};
const SIDE = { ink: '#1b1510', panel: '#241c14', line: '#4a3a2a' };

function drawItem(ctx, kind, x, y, chopped, heat, f = 0) {
  const base = heat === 2 ? '#2b2523' : PALETTE[kind][heat === 1 ? 1 : 0];
  if (chopped) {
    for (const [dx, dy] of [
      [-6, -6],
      [1, -6],
      [-6, 1],
      [1, 1],
    ])
      rect(ctx, base, x + dx, y + dy, 5, 5);
  } else if (kind === 'bread') {
    rect(ctx, base, x - 7, y - 4, 14, 9);
    rect(ctx, heat === 2 ? base : '#f4cc86', x - 6, y - 6, 12, 3);
    rect(ctx, '#b9783a', x - 3, y - 4, 2, 4);
    rect(ctx, '#b9783a', x + 2, y - 4, 2, 4);
  } else if (kind === 'tomato') {
    rect(ctx, base, x - 5, y - 6, 10, 13);
    rect(ctx, base, x - 7, y - 4, 14, 9);
    rect(ctx, '#3fa34d', x - 2, y - 8, 4, 3);
  } else if (kind === 'meat') {
    rect(ctx, base, x - 7, y - 5, 14, 10);
    rect(ctx, heat === 1 ? '#5c2c16' : '#c96a7c', x - 4, y - 2, 3, 3);
    rect(ctx, heat === 1 ? '#5c2c16' : '#c96a7c', x + 1, y + 1, 3, 2);
  } else if (kind === 'fish') {
    rect(ctx, base, x - 7, y - 3, 10, 7);
    rect(ctx, heat === 2 ? base : '#4ea7cc', x + 3, y - 5, 4, 11);
    rect(ctx, '#10202c', x - 5, y - 1, 2, 2);
  } else {
    rect(ctx, base, x - 5, y - 7, 10, 14);
    rect(ctx, base, x - 7, y - 4, 14, 8);
    rect(ctx, heat === 2 ? base : '#f6b93b', x - 2, y - 2, 4, 4);
  }
  if (chopped) rect(ctx, '#cfd6dd', x - 8, y + 5, 4, 3);
  if (heat === 1) rect(ctx, '#ff8a2a', x + 4, y + 5, 4, 3);
  if (heat === 2) {
    rect(ctx, '#9aa0a6', x - 2 + (f % 8 < 4 ? 0 : 2), y - 10, 2, 2);
    rect(ctx, '#9aa0a6', x + 2, y - 12 + (f % 8 < 4 ? 0 : 1), 2, 2);
  }
}

function drawTile(ctx, s, c, r, f) {
  const x = c * TILE;
  const y = TOP + r * TILE;
  const kind = kindAt(s.lv, c, r);
  if (kind === 'wall') {
    rect(ctx, '#5a4632', x, y, TILE, TILE);
    rect(ctx, '#7a6044', x, y, TILE, 3);
    rect(ctx, '#3d2f20', x, y + TILE - 2, TILE, 2);
    return;
  }
  rect(ctx, (c + r) % 2 ? '#c9b78f' : '#d4c39b', x, y, TILE, TILE);
  if (kind !== 'belt' && kind !== 'junction') return;
  rect(ctx, '#4a4f58', x, y, TILE, TILE);
  rect(ctx, '#363a42', x, y, TILE, 2);
  rect(ctx, '#363a42', x, y + TILE - 2, TILE, 2);
  const [dx, dy] = kind === 'belt' ? exitsAt(s.lv, c, r)[0] : [0, 0];
  if (!dx && !dy) return;
  const phase = (s.ticks * STEP * s.def.speed * TILE) % 12;
  for (let k = 0; k < 2; k++) {
    const a = ((phase + k * 12) % 24) - 12;
    for (const [ca, cb] of [
      [0, -2],
      [1, -1],
      [2, 0],
      [1, 1],
      [0, 2],
    ]) {
      const along = a + ca * 2 - 2;
      const across = cb * 2;
      if (Math.abs(along) > 10) continue;
      rect(
        ctx,
        '#8d96a3',
        cx(c) + (dx ? dx * along : across) - 1,
        cy(r) + (dy ? dy * along : across) - 1,
        2,
        2,
      );
    }
  }
}

function drawJunction(ctx, s, j) {
  const x = cx(j.c);
  const y = cy(j.r);
  rect(ctx, '#5a5f6a', x - 11, y - 11, 22, 22);
  j.exits.forEach(([dx, dy], k) => {
    const on = s.jn[j.id] === k;
    const color = on ? '#ffd23f' : '#6b7280';
    for (let n = 3; n <= 10; n += 2)
      rect(ctx, color, x + dx * n - 1, y + dy * n - 1, on ? 3 : 2, on ? 3 : 2);
    const hx = x + dx * 10;
    const hy = y + dy * 10;
    rect(ctx, color, hx - (dy ? 4 : 1), hy - (dx ? 4 : 1), dy ? 9 : 3, dx ? 9 : 3);
  });
  rect(ctx, '#2b2f36', x - 2, y - 2, 4, 4);
}

function drawStation(ctx, s, st, f) {
  const d = s.stn[st.id];
  const x = st.c * TILE;
  const y = TOP + st.r * TILE;
  const mx = x + TILE / 2;
  const my = y + TILE / 2;
  if (st.kind === 'crate') {
    rect(ctx, '#6b4423', x + 1, y + 1, 22, 22);
    rect(ctx, '#8a5a2b', x + 2, y + 2, 20, 20);
    rect(ctx, '#a8733a', x + 2, y + 2, 20, 3);
    drawItem(ctx, st.item, mx, my - 2, false, 0, f);
    for (let k = 0; k < Math.min(d.stock, 8); k++)
      rect(ctx, '#ffe9a8', x + 3 + (k % 4) * 5, y + 18 + Math.floor(k / 4) * 3, 3, 2);
    if (d.cool > 0) rect(ctx, '#00000066', x + 2, y + 2, 20, 20);
  } else if (st.kind === 'chopper') {
    rect(ctx, '#7a5a34', x + 1, y + 1, 22, 22);
    rect(ctx, '#c99a5b', x + 3, y + 3, 18, 18);
    rect(ctx, '#e0b878', x + 3, y + 3, 18, 3);
    const lift = d.mode === 'chopping' && f % 12 < 6 ? 4 : 0;
    rect(ctx, '#dfe6ee', x + 15, y + 5 - lift, 3, 9);
    rect(ctx, '#7a4a20', x + 15, y + 14 - lift, 3, 5);
    if (d.slot) drawItem(ctx, d.slot.kind, mx - 3, my + 1, d.slot.chopped, d.slot.heat, f);
    if (d.mode === 'idle' && f % 40 < 20) rect(ctx, '#ffd23f', x + 2, y + 2, 4, 4);
    drawBar(
      ctx,
      x + 2,
      y - 2,
      20,
      d.mode === 'chopping' || d.mode === 'done' ? d.prog / RULES.chopTime : 0,
      d.mode === 'chopping' && !stationView(s, st).attended ? '#8a8f98' : '#7be07b',
    );
  } else if (st.kind === 'stove') {
    rect(ctx, '#2b2b30', x + 1, y + 1, 22, 22);
    rect(ctx, '#44444c', x + 3, y + 3, 18, 18);
    rect(ctx, '#2b2b30', x + 6, y + 6, 12, 12);
    if (d.mode === 'cook' || d.mode === 'spit') {
      for (let k = 0; k < 4; k++)
        rect(ctx, f % 10 < 5 ? '#ff8a2a' : '#ffd23f', x + 5 + k * 4, y + 19 - ((k + f) % 2), 3, 3);
    }
    if (d.slot) drawItem(ctx, d.slot.kind, mx, my - 1, d.slot.chopped, d.slot.heat, f);
    const total = RULES.cookTime + cookWindow(s);
    const rawW = Math.round((20 * RULES.cookTime) / total);
    const warnW = Math.round((20 * RULES.burnWarn) / total);
    rect(ctx, '#d99a2b', x + 2, y - 4, rawW, 3);
    rect(ctx, '#3fbf5f', x + 2 + rawW, y - 4, 20 - rawW - warnW, 3);
    rect(ctx, '#e0453a', x + 22 - warnW, y - 4, warnW, 3);
    if (d.slot && d.mode === 'cook') {
      const px = Math.min(19, Math.floor((20 * d.prog) / total));
      const flash = d.slot.heat === 1 && d.prog >= total - RULES.burnWarn && f % 10 < 5;
      rect(ctx, flash ? '#ffffff' : '#101010', x + 2 + px, y - 6, 2, 7);
    }
    if (d.mode === 'spit') rect(ctx, '#9aa0a6', x + 8, y - 8 - (f % 6), 4, 4);
  } else if (st.kind === 'window') {
    rect(ctx, '#3a5a78', x + 1, y + 1, 22, 22);
    rect(ctx, '#e8eef5', x + 4, y + 8, 16, 11);
    rect(ctx, '#b9c6d4', x + 6, y + 10, 12, 7);
    rect(ctx, '#ffd23f', x + 10, y + 3, 4, 4);
    if (s.verdict) {
      const color = s.verdict.ok ? '#3fbf5f' : '#e0453a';
      rect(ctx, color, x, y, TILE, 2);
      rect(ctx, color, x, y + TILE - 2, TILE, 2);
      rect(ctx, color, x, y, 2, TILE);
      rect(ctx, color, x + TILE - 2, y, 2, TILE);
    }
  } else {
    rect(ctx, '#555c66', x + 4, y + 5, 16, 17);
    rect(ctx, '#7a828e', x + 2, y + 3, 20, 4);
    rect(ctx, '#2b2f36', x + 8, y + 10, 2, 8);
    rect(ctx, '#2b2f36', x + 14, y + 10, 2, 8);
  }
}

function drawBar(ctx, x, y, w, frac, color) {
  rect(ctx, '#1b1510', x, y, w, 4);
  rect(ctx, color, x, y, Math.round(w * Math.max(0, Math.min(1, frac))), 4);
}

function drawChef(ctx, chef, k, f) {
  const x = Math.round(chef.x);
  const y = Math.round(chef.y);
  const body = k === 0 ? '#e0523f' : '#3a7be0';
  const stride = chef.walk > 0 && Math.floor(chef.walk * 8) % 2;
  rect(ctx, '#1b1510', x - 7, y + 7, 14, 2);
  rect(ctx, '#f4f4f4', x - 5, y - 8, 10, 4);
  rect(ctx, '#f4f4f4', x - 3, y - 8, 6, 1);
  rect(ctx, '#f2c9a0', x - 4, y - 4, 8, 5);
  rect(
    ctx,
    '#1b1510',
    x - 3 + (chef.face === 'left' ? -1 : chef.face === 'right' ? 1 : 0),
    y - 3,
    2,
    2,
  );
  rect(
    ctx,
    '#1b1510',
    x + 1 + (chef.face === 'left' ? -1 : chef.face === 'right' ? 1 : 0),
    y - 3,
    2,
    2,
  );
  rect(ctx, body, x - 5, y + 1, 10, 6);
  rect(ctx, '#f2c9a0', x - 7, y + 2 - (chef.flash > 0 ? 3 : 0), 2, 3);
  rect(ctx, '#f2c9a0', x + 5, y + 2 - (chef.flash > 0 ? 3 : 0), 2, 3);
  rect(ctx, '#2d3142', x - 4, y + 7 + (stride ? 1 : 0), 3, 1);
  rect(ctx, '#2d3142', x + 1, y + 7 + (stride ? 0 : 1), 3, 1);
  if (chef.flash > 12) rect(ctx, '#ffd23f', x - 1, y - 11, 3, 3);
}

function drawRail(ctx, s) {
  rect(ctx, SIDE.panel, 0, 20, 480, 40);
  rect(ctx, SIDE.line, 0, 59, 480, 1);
  const slot = 480 / RULES.maxOpen;
  openOrders(s)
    .slice(0, RULES.maxOpen)
    .forEach((o, k) => {
      const x = k * slot;
      const frac = o.left / o.patience;
      rect(ctx, '#f1e6c8', x + 2, 22, slot - 4, 36);
      rect(ctx, '#d8c9a2', x + 2, 22, slot - 4, 3);
      o.parts.forEach((p, n) => {
        drawItem(ctx, p.kind, x + 16 + n * 24, 36, p.chop, p.cook ? 1 : 0, 0);
        if (p.done) {
          rect(ctx, '#3fbf5f', x + 20 + n * 24, 28, 8, 8);
          rect(ctx, '#ffffff', x + 22 + n * 24, 31, 2, 2);
          rect(ctx, '#ffffff', x + 24 + n * 24, 32, 3, 2);
        }
      });
      drawBar(
        ctx,
        x + 6,
        48,
        slot - 12,
        frac,
        frac > 0.5 ? '#3fbf5f' : frac > 0.25 ? '#e0a82b' : '#e0453a',
      );
    });
}

function drawHud(ctx, s, env) {
  rect(ctx, SIDE.ink, 0, 0, 480, 20);
  rect(ctx, SIDE.line, 0, 19, 480, 1);
  const served = s.orders.filter((o) => o.state === 'served').length;
  const sat = Math.round(satisfactionOf(s));
  const t = env.t;
  const ok = sat >= s.def.need;
  text(
    ctx,
    t(`Shift ${s.shiftIndex + 1}/${SHIFTS.length}`, `第${s.shiftIndex + 1}/${SHIFTS.length}班`),
    6,
    3,
    '#ffe9a8',
    14,
  );
  text(
    ctx,
    t(`Satisfied ${sat}% / ${s.def.need}%`, `满意度 ${sat}% / ${s.def.need}%`),
    240,
    3,
    ok ? '#9fe3b0' : '#ffb38a',
    14,
    'center',
  );
  text(
    ctx,
    t(`Served ${served}/${s.orders.length}`, `已上菜 ${served}/${s.orders.length}`),
    474,
    3,
    '#bfe9ff',
    14,
    'right',
  );
}

function drawBottom(ctx, s, env, snap) {
  rect(ctx, SIDE.ink, 0, BOTTOM, 480, 320 - BOTTOM);
  rect(ctx, SIDE.line, 0, BOTTOM, 480, 1);
  const t = env.t;
  text(ctx, snap.prompt[env.lang], 6, BOTTOM + 2, '#ffe9a8', 14);
  const tip = s.ticks < 1200 && !s.menu ? s.def.tip : null;
  const line = s.msg ? s.msg : tip;
  if (line) text(ctx, line[env.lang], 6, BOTTOM + 16, s.msg ? '#ff9a8a' : '#bfe9ff', 14);
  if (!s.menu) {
    const w = cookWindow(s);
    text(
      ctx,
      t(
        `Belt ${s.def.speed} tiles/s · Chop ${RULES.chopTime}s · Cook ${RULES.cookTime}s · Ready ${w}s`,
        `传送带${s.def.speed}格/秒 · 切${RULES.chopTime}秒 · 煮${RULES.cookTime}秒 · 可取${w}秒`,
      ),
      6,
      BOTTOM + 30,
      '#9aa7b8',
      14,
    );
  }
}

function drawMenu(ctx, s, env) {
  const { cursor, unlocked } = s.menu;
  const f = Math.floor(s.menuClock * 60);
  background(ctx, '#2a2118');
  drawBottom(ctx, s, env, snapshot(s));
  rect(ctx, SIDE.ink, 0, 0, 480, 28);
  text(ctx, env.t('Conveyor Chef: choose a shift', '传送带厨房：选择班次'), 6, 6, '#ffe9a8', 14);
  SHIFTS.forEach((def, i) => {
    const n = i + 1;
    const q = menuCell(n);
    const open = n <= unlocked;
    rect(ctx, n === cursor ? '#ffe9a8' : '#4a3a2a', q.x, q.y, q.w, q.h);
    rect(ctx, open ? '#3a2d20' : '#211a12', q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    if (open && n < unlocked) rect(ctx, '#3fbf5f', q.x + 2, q.y + 2, q.w - 4, 4);
    if (n === unlocked && f % 60 < 40) rect(ctx, '#ffb347', q.x + 2, q.y + 2, q.w - 4, 4);
    text(ctx, `${n}`, q.x + q.w / 2, q.y + 8, open ? '#ffffff' : '#6b5a48', 16, 'center');
    const kinds = [...new Set(def.tickets.flatMap((tk) => tk.parts.map((p) => p.kind)))].slice(
      0,
      4,
    );
    kinds.forEach((kind, k) =>
      rect(
        ctx,
        open ? PALETTE[kind][0] : '#3a2d20',
        q.x + q.w / 2 - kinds.length * 6 + k * 12 + 2,
        q.y + q.h - 14,
        8,
        8,
      ),
    );
  });
  const name = SHIFTS[cursor - 1].name;
  text(ctx, env.t(`${cursor}. ${name.en}`, `${cursor}. ${name.zh}`), 6, BOTTOM + 16, '#bfe9ff', 14);
  if (s.msg) text(ctx, s.msg[env.lang], 6, BOTTOM + 30, '#ff9a8a', 14);
}

export function render(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  const snap = snapshot(s);
  const f = s.ticks;
  background(ctx, '#2a2118');
  drawBottom(ctx, s, env, snap);
  drawHud(ctx, s, env);
  drawRail(ctx, s);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawTile(ctx, s, c, r, f);
  s.lv.junctions.forEach((j) => drawJunction(ctx, s, j));
  s.lv.stations.forEach((st) => drawStation(ctx, s, st, f));
  for (const it of snap.items) drawItem(ctx, it.kind, it.x, it.y, it.chopped, it.heat, f);
  s.chefs.forEach((chef, k) => drawChef(ctx, chef, k, f));
  const target = snap.prompt.target;
  if (target && s.clear === 0) {
    const bob = Math.floor(f / 10) % 2;
    const x = cx(target.c);
    const y = TOP + target.r * TILE - 8 + bob;
    rect(ctx, '#ffd23f', x - 4, y - 4, 9, 2);
    rect(ctx, '#ffd23f', x - 2, y - 2, 5, 2);
    rect(ctx, '#ffd23f', x - 1, y, 3, 2);
    if (s.chefs.some((chef) => reachOf(chef, target.c, target.r) <= RULES.reach)) {
      const px = target.c * TILE;
      const py = TOP + target.r * TILE;
      rect(ctx, '#3fbf5f', px, py + TILE - 2, TILE, 2);
    }
  }
  if (s.clear > 0)
    text(ctx, env.t('SHIFT CLEARED!', '班次完成！'), 240, 150, '#ffffff', 16, 'center');
}

// ---------------------------------------------------------------------------
// Public game
// ---------------------------------------------------------------------------

const unlockedOf = (env) => {
  const n = Math.floor(Number(env.progress?.unlocked?.()));
  return Number.isFinite(n) ? Math.max(1, Math.min(SHIFTS.length, n)) : 1;
};

const LOSS_MESSAGE = {
  en: (s) =>
    s.cause === 'stock'
      ? `Out of ${KINDS[s.lacking].many}: shift ${s.shiftIndex + 1} can no longer reach ${s.def.need}%.`
      : `Shift ${s.shiftIndex + 1} failed: satisfaction can no longer reach ${s.def.need}%.`,
  zh: (s) =>
    s.cause === 'stock'
      ? `${KINDS[s.lacking].zh}用完了：第${s.shiftIndex + 1}班已无法达到${s.def.need}%。`
      : `第${s.shiftIndex + 1}班失败：满意度已无法达到${s.def.need}%。`,
};

export function createGame(env) {
  const s = newState(env.mode);
  let unlocked = unlockedOf(env);
  if (unlocked > 1) openMenu(s, unlocked);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.unlockTo > 0) {
        const n = Math.min(SHIFTS.length, s.unlockTo);
        s.unlockTo = 0;
        unlocked = Math.max(unlocked, n);
        env.progress?.unlock?.(n);
      }
      if (s.phase === 'playing' || ended) return;
      ended = true;
      env.end({
        won: s.phase === 'won',
        score: Math.round(s.score),
        message:
          s.phase === 'won'
            ? env.t(
                'Every shift is served. The kitchen is yours!',
                '所有班次都完成了，这间厨房属于你！',
              )
            : env.t(LOSS_MESSAGE.en(s), LOSS_MESSAGE.zh(s)),
      });
    },
    draw(ctx) {
      render(ctx, s, env);
    },
    getState() {
      return snapshot(s);
    },
  };
}
