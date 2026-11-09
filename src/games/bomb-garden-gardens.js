// Bomb Garden content: rival roles, the authored gardens and the duel arena, all as plain data.
// A garden is nine strings of fifteen characters, one per row of the board:
//   #  wall (the border and the pillars on even columns and rows are always walls)
//   .  floor        ~  wet floor (bombs there burn 3 s)       @  gardener start (always 1,1)
//   c  crate        C  crate on wet floor                     o  compost barrel
//   &  second gardener start (duel arena only)
//   r  crate hiding a range upgrade     p  crate hiding an extra-bomb upgrade
//   b  bomber   s  scout   w  warden    rival starting cells
import { COLS, ROWS, FLOOR, WALL, CRATE, BARREL, key } from './bomb-garden-rules.js';

/** Rival roles. Speed is seconds per cell; caution is how soon before a blast a rival
 * heeds a charge, react how long it takes to start running once it stands in one. */
const freezeDeep = (value) => {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freezeDeep(child);
  return Object.freeze(value);
};
export const ROLES = freezeDeep({
  bomber: {
    letter: { en: 'B', zh: '炸' },
    name: { en: 'Bomber', zh: '投弹手' },
    note: { en: 'bombs crates', zh: '炸木箱' },
    range: 2,
    speed: 0.3,
    stamina: 4,
    rest: 0.85,
    caution: 0.9,
    react: 0.45,
    gap: 3.1,
    color: '#f4a480',
  },
  scout: {
    letter: { en: 'S', zh: '追' },
    name: { en: 'Scout', zh: '斥候' },
    note: { en: 'chases you', zh: '追着你' },
    range: 2,
    speed: 0.225,
    stamina: 6,
    rest: 0.65,
    caution: 1,
    react: 0.25,
    gap: 4,
    color: '#bfe8cd',
  },
  warden: {
    letter: { en: 'W', zh: '守' },
    name: { en: 'Warden', zh: '守卫' },
    note: { en: 'jet range 3', zh: '火力3' },
    range: 3,
    speed: 0.3,
    stamina: 3,
    rest: 1.1,
    caution: 1.1,
    react: 0.35,
    gap: 4,
    color: '#e6cf7e',
  },
});
const FOE_SYMBOL = { b: 'bomber', s: 'scout', w: 'warden' };
const CELL_CODE = {
  '.': FLOOR,
  '~': FLOOR,
  '@': FLOOR,
  '&': FLOOR,
  c: CRATE,
  C: CRATE,
  r: CRATE,
  p: CRATE,
  o: BARREL,
};
const UPGRADE = { r: 'range', p: 'capacity' };

/** The things a garden can be the first to show; each is introduced by exactly one garden. */
export const FEATURES = Object.freeze([
  'basics',
  'upgrade',
  'scout',
  'wall',
  'warden',
  'wet',
  'barrel',
]);

const fail = (def, why) => {
  throw new Error(`Garden "${def.id}": ${why}`);
};

/** Turn a definition into frozen board data, rejecting anything malformed. */
export function parseGarden(def) {
  const { rows } = def;
  if (rows.length !== ROWS) fail(def, `needs ${ROWS} rows`);
  const board = [],
    wet = [],
    drops = [],
    foes = [];
  let start = null,
    start2 = null;
  rows.forEach((row, y) => {
    if (row.length !== COLS) fail(def, `row ${y} is ragged`);
    board.push(
      [...row].map((ch, x) => {
        const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        if ((border || (x % 2 === 0 && y % 2 === 0)) && ch !== '#')
          fail(def, `${x},${y} must be a wall`);
        if (ch === '#') return WALL;
        if (ch === '~' || ch === 'C') wet.push(key(x, y));
        if (UPGRADE[ch]) drops.push([key(x, y), UPGRADE[ch]]);
        if (FOE_SYMBOL[ch]) {
          foes.push([x, y, FOE_SYMBOL[ch]]);
          return FLOOR;
        }
        if (ch === '@') start = [x, y];
        if (ch === '&') start2 = [x, y];
        if (CELL_CODE[ch] === undefined) fail(def, `unknown symbol "${ch}"`);
        return CELL_CODE[ch];
      }),
    );
  });
  if (!start || start[0] !== 1 || start[1] !== 1) fail(def, 'the gardener starts at 1,1');
  if (!(def.pace >= 0.5 && def.pace <= 1.5)) fail(def, 'pace must be between 0.5 and 1.5');
  const count = (code) => board.flat().filter((c) => c === code).length;
  return Object.freeze({
    ...def,
    board: Object.freeze(board.map((r) => Object.freeze(r))),
    wet: Object.freeze(wet),
    drops: Object.freeze(drops),
    foes: Object.freeze(foes),
    start,
    start2,
    crates: count(CRATE),
    barrels: count(BARREL),
  });
}

const DEFS = [
  {
    id: 'seed-bed',
    name: { en: 'Seed Bed', zh: '种子苗床' },
    tip: {
      en: 'Space or J drops a bomb. It bursts four ways after 2.4 s, so step away!',
      zh: '空格或 J 放炸弹，2.4秒后向四个方向喷焰，快走开！',
    },
    news: ['basics'],
    pace: 1.25,
    time: 240,
    ground: '#295548',
    rows: [
      '###############',
      '#@..cccc..c.cc#',
      '#.#.#.#c#c#c#.#',
      '#.c..cc..ccc.c#',
      '#c#.#.#.#.#c#c#',
      '#.cc.cc....c..#',
      '#.#.#c#.#.#c#.#',
      '#.cc...c.ccc.b#',
      '###############',
    ],
  },
  {
    id: 'pea-patch',
    name: { en: 'Pea Patch', zh: '豌豆田' },
    tip: {
      en: 'Crates marked + or B hide upgrades: + adds range, B adds a bomb.',
      zh: '标有 + 或 B 的木箱藏着升级：+ 加火力，B 加炸弹数。',
    },
    news: ['upgrade'],
    pace: 1.2,
    time: 240,
    ground: '#284e59',
    rows: [
      '###############',
      '#@..rccccc....#',
      '#.#.#c#c#.#c#c#',
      '#.c.c.c.cccc.c#',
      '#p#.#c#.#c#.#.#',
      '#.....c.cc.c.b#',
      '#c#c#c#.#c#.#.#',
      '#.cc....cc.c..#',
      '###############',
    ],
  },
  {
    id: 'scout-lane',
    name: { en: 'Scout Lane', zh: '斥候小径' },
    tip: {
      en: 'Scouts (S) chase and bomb open lines. Blast crates to reach a sealed one.',
      zh: '斥候（追）会追击并沿直线放炸弹。被木箱围住时，炸开木箱去找它。',
    },
    news: ['scout'],
    pace: 1.1,
    time: 240,
    ground: '#59444c',
    rows: [
      '###############',
      '#@..rcc.ccc..c#',
      '#.#.#c#.#.#c#c#',
      '#....cc..cc.c.#',
      '#p#.#.#c#.#c#.#',
      '#cc....c...c.c#',
      '#c#c#c#c#.#c#.#',
      '#..c...c..cc.s#',
      '###############',
    ],
  },
  {
    id: 'stone-rows',
    name: { en: 'Stone Rows', zh: '石墙行列' },
    tip: {
      en: 'Stone walls never break and stop jets. Use them as cover.',
      zh: '石墙炸不坏，还能挡住喷焰，拿来当掩体。',
    },
    news: ['wall'],
    pace: 1.15,
    time: 240,
    ground: '#485936',
    rows: [
      '###############',
      '#@..rc.#cc.cc.#',
      '#.#.#.###c#c#c#',
      '#cccc...ccc.c.#',
      '#p#.#c#c#.#.#.#',
      '#c..........c.#',
      '#.#c#.###.#.#.#',
      '#..c.cc#c.cc.b#',
      '###############',
    ],
  },
  {
    id: 'double-trouble',
    name: { en: 'Double Trouble', zh: '双重麻烦' },
    tip: {
      en: 'A bomber and a scout at once. The scout is quicker: deal with it first.',
      zh: '投弹手和斥候同场。斥候更快，先对付它。',
    },
    news: [],
    pace: 1,
    time: 240,
    ground: '#3d4563',
    rows: [
      '###############',
      '#@..rc.ccc...b#',
      '#.#.#c#c#c#.#.#',
      '#cccc#.c......#',
      '#p#c###.###.#.#',
      '#c.ccc...#....#',
      '#.#c#c#.#c#c#.#',
      '#cc...cc.c...s#',
      '###############',
    ],
  },
  {
    id: 'warden-post',
    name: { en: 'Warden Post', zh: '守卫岗哨' },
    tip: {
      en: 'Wardens (W) blast 3 cells and rest after 3 steps. Stay out of their line.',
      zh: '守卫（守）喷焰可达3格，走3步就要歇息。别站在它的直线上。',
    },
    news: ['warden'],
    pace: 1,
    time: 225,
    ground: '#4e4b36',
    rows: [
      '###############',
      '#@..rc..cc.cc.#',
      '#.#.###.###c#.#',
      '#cc..c.c...cc.#',
      '#p#c#.#.#c#c#.#',
      '#..cccccc..c..#',
      '#.#c###c###c#.#',
      '#ccc....c....w#',
      '###############',
    ],
  },
  {
    id: 'watchtower',
    name: { en: 'Watchtower', zh: '瞭望塔' },
    tip: {
      en: 'Warden plus bomber. Every bomb shows its countdown: read it, then move.',
      zh: '守卫加投弹手。炸弹上方显示倒计时，看清再行动。',
    },
    news: [],
    pace: 1,
    time: 225,
    ground: '#295548',
    rows: [
      '###############',
      '#@..rc.#.c.c.w#',
      '#.#.#.###c#c#.#',
      '#..ccc.#cc...c#',
      '#p#c#.#.#c#.#c#',
      '#.c.c....ccccc#',
      '#.#c#c###c#c#.#',
      '#c.cc.c#.....b#',
      '###############',
    ],
  },
  {
    id: 'wet-bed',
    name: { en: 'Wet Bed', zh: '湿润苗圃' },
    tip: {
      en: 'Wet soil (blue) slows fuses: a bomb planted there waits 3 s, not 2.4 s.',
      zh: '湿地（蓝色）引信更慢：在上面放的炸弹要等3秒，而不是2.4秒。',
    },
    news: ['wet'],
    pace: 1.1,
    time: 225,
    ground: '#284e59',
    rows: [
      '###############',
      '#@..rc.cccccc.#',
      '#.#.#.#.#c#c#c#',
      '#c..~~~~~~~cc.#',
      '#p#c#c#c#.#.#.#',
      '#cccC~CCCC~..c#',
      '#c#.#.#.#.#.#.#',
      '#..cc...c..c.b#',
      '###############',
    ],
  },
  {
    id: 'puddle-chase',
    name: { en: 'Puddle Chase', zh: '水洼追逐' },
    tip: {
      en: 'Scout, bomber, wet soil: bombs there wait 3 s, so time your escape.',
      zh: '斥候、投弹手加湿地。湿地上的炸弹要等3秒，把握好撤退时机。',
    },
    news: [],
    pace: 1,
    time: 225,
    ground: '#59444c',
    rows: [
      '###############',
      '#@..rcc.cc...s#',
      '#.#.#c#C#.#c#.#',
      '#.cr.cC~~c..cc#',
      '#p#.#c#~#c#c#.#',
      '#.....~C~.ccc.#',
      '#c#c#.#C#.#.#.#',
      '#c...ccc.c...b#',
      '###############',
    ],
  },
  {
    id: 'barrel-corner',
    name: { en: 'Barrel Corner', zh: '堆肥桶角落' },
    tip: {
      en: 'Compost barrels explode 0.18 s after a jet hits them, blasting 2 cells.',
      zh: '堆肥桶被喷焰击中0.18秒后爆炸，波及2格。',
    },
    news: ['barrel'],
    pace: 1.1,
    time: 210,
    ground: '#485936',
    rows: [
      '###############',
      '#@..rcc.......#',
      '#.#.#.#.#.#c#.#',
      '#..r.o.ccoc...#',
      '#p#c#c#.#.#.#.#',
      '#cc..o.c.o....#',
      '#.#.#.#c#c#c#.#',
      '#cc..c.c.....b#',
      '###############',
    ],
  },
  {
    id: 'barrel-alley',
    name: { en: 'Barrel Alley', zh: '堆肥桶巷' },
    tip: {
      en: 'Barrels chain into barrels. The orange preview shows the whole chain.',
      zh: '堆肥桶会连环爆炸。橙色预览标出整条连锁。',
    },
    news: [],
    pace: 1,
    time: 210,
    ground: '#3d4563',
    rows: [
      '###############',
      '#@..rccc.ccc.c#',
      '#.#.#.#c#c#c#.#',
      '#....o.#.ococc#',
      '#p#o#.###.#.#.#',
      '#..rco.c.occcb#',
      '#.#.#.#.#.#c#.#',
      '#..c.c..cc...s#',
      '###############',
    ],
  },
  {
    id: 'mud-and-barrels',
    name: { en: 'Mud and Barrels', zh: '泥地与木桶' },
    tip: {
      en: 'A warden reaches 3 cells and a barrel adds 2 more: count the whole cross.',
      zh: '守卫喷焰3格，堆肥桶再加2格：数清整个十字。',
    },
    news: [],
    pace: 0.8,
    time: 210,
    ground: '#4e4b36',
    rows: [
      '###############',
      '#@..rcc..cc..s#',
      '#.#.#.#.#.#c#.#',
      '#c.rco~~Co..c.#',
      '#p#.#.#o#c#.#c#',
      '#.c..o~~~o.c..#',
      '#c#.#.#c#c#c#.#',
      '#...cccc.....w#',
      '###############',
    ],
  },
  {
    id: 'three-rivals',
    name: { en: 'Three Rivals', zh: '三位对手' },
    tip: {
      en: 'Two scouts and a warden at once. Clear them one at a time.',
      zh: '两名斥候和一名守卫齐上阵。逐个击破。',
    },
    news: [],
    pace: 0.65,
    time: 210,
    ground: '#295548',
    rows: [
      '###############',
      '#@..rcc....c.s#',
      '#.#.###.###c#.#',
      '#.cr.c.ccc.ccc#',
      '#p#.#.#.#.#c#.#',
      '#ccc...cc.cc..#',
      '#.#c###.###.#.#',
      '#s...c.......w#',
      '###############',
    ],
  },
  {
    id: 'crossroads',
    name: { en: 'Crossroads', zh: '十字路口' },
    tip: {
      en: 'Two scouts bomb exits in a walled crossroads. Never wait in a dead end.',
      zh: '两名斥候会炸封出口。在带墙的十字路口别守在死胡同里。',
    },
    news: [],
    pace: 1,
    time: 210,
    ground: '#284e59',
    rows: [
      '###############',
      '#@..rc.#c.c..s#',
      '#.#.#.###.#.#.#',
      '#..rcc...c....#',
      '#p###c#.#.###.#',
      '#.cc..c.....c.#',
      '#.#c#.###c#c#.#',
      '#c.c.cc#c..c.s#',
      '###############',
    ],
  },
  {
    id: 'wet-crossing',
    name: { en: 'Wet Crossing', zh: '湿地横贯' },
    tip: {
      en: 'Wet soil crosses the middle. Bombs on it wait 3 s: use the delay.',
      zh: '湿地横贯中央。上面的炸弹等3秒：利用这段延迟。',
    },
    news: [],
    pace: 0.9,
    time: 210,
    ground: '#59444c',
    rows: [
      '###############',
      '#@..rc...ccc.w#',
      '#.#.#.#c#c#c#.#',
      '#.cr~~C~~~~~.c#',
      '#p#C#.#c#.#~#.#',
      '#.c~~~~~C~CC.c#',
      '#.#.#c#c#c#.#.#',
      '#.c..c.......s#',
      '###############',
    ],
  },
  {
    id: 'barrel-maze',
    name: { en: 'Barrel Maze', zh: '堆肥桶迷宫' },
    tip: {
      en: 'Ten barrels: one spark can chain through the lot. Watch the orange.',
      zh: '十个堆肥桶：一点火星就能连成一片。留意橙色预览。',
    },
    news: [],
    pace: 0.9,
    time: 210,
    ground: '#485936',
    rows: [
      '###############',
      '#@..rc....c..b#',
      '#.#.#.#.#c#.#.#',
      '#.co.o.o.o.o.c#',
      '#p#.#.#c#.#c#c#',
      '#r.o.o.o.oco.c#',
      '#.#c#c#.#.#.#.#',
      '#cccccc.c..c.s#',
      '###############',
    ],
  },
  {
    id: 'tight-clock',
    name: { en: 'Tight Clock', zh: '紧迫时钟' },
    tip: {
      en: 'Only 150 s on the clock. Skip needless crates and go hunting.',
      zh: '时间只有150秒。别炸多余的木箱，主动出击。',
    },
    news: [],
    pace: 0.6,
    time: 150,
    ground: '#3d4563',
    rows: [
      '###############',
      '#@..rc.c.....b#',
      '#.#.#.###c#c#.#',
      '#ccr..c#c....c#',
      '#p#.#.#c#c#c#c#',
      '#cc.c#c..#....#',
      '#.#c#.#.#c#.#.#',
      '#b...c.s.cc..w#',
      '###############',
    ],
  },
  {
    id: 'wardens-court',
    name: { en: "Wardens' Court", zh: '守卫庭院' },
    tip: {
      en: 'Two wardens and a scout. Jets reach 3 cells: break their line of sight.',
      zh: '两名守卫加一名斥候。喷焰可达3格：挡住它们的视线。',
    },
    news: [],
    pace: 0.8,
    time: 210,
    ground: '#4e4b36',
    rows: [
      '###############',
      '#@..rc.#..c..w#',
      '#.#.#c#c#.#c#.#',
      '#..r.#.c.#....#',
      '#p#.#c#c#c#c#.#',
      '#.ccc.cccc..cc#',
      '#.#.#.#.#c#c#.#',
      '#w..ccc#.c.c.s#',
      '###############',
    ],
  },
  {
    id: 'chain-reaction',
    name: { en: 'Chain Reaction', zh: '连锁反应' },
    tip: {
      en: 'Barrels two apart chain, but a crate between them stops the blast.',
      zh: '相距两格的堆肥桶会连锁，中间夹着木箱则会被挡住。',
    },
    news: [],
    pace: 0.8,
    time: 210,
    ground: '#295548',
    rows: [
      '###############',
      '#@..roc..o...b#',
      '#.#.#c#.#c#c#.#',
      '#c.r.o...occ.c#',
      '#p#c#.#.#.#c#.#',
      '#cc..occ.oc..c#',
      '#.#.#c#c#.#.#.#',
      '#s...o..co...w#',
      '###############',
    ],
  },
  {
    id: 'four-corners',
    name: { en: 'Four Corners', zh: '四方对手' },
    tip: {
      en: 'Four rivals, one in every direction. Keep moving and keep an exit.',
      zh: '四名对手，四面包抄。保持移动，时刻留好退路。',
    },
    news: [],
    pace: 0.75,
    time: 195,
    ground: '#284e59',
    rows: [
      '###############',
      '#@..rc.c.ccc.w#',
      '#.#.#c#.#c#c#.#',
      '#c.#c..c.cc#cc#',
      '#p#.#c#.#.#.#.#',
      '#..r.#.c.#.cc.#',
      '#.#.#.#.#c#.#.#',
      '#b.c.c.s.cc..s#',
      '###############',
    ],
  },
  {
    id: 'mudslide',
    name: { en: 'Mudslide', zh: '泥石流' },
    tip: {
      en: 'Mud everywhere: every bomb on wet soil waits 3 s. Barrels punish haste.',
      zh: '遍地泥泞：湿地上的炸弹都要等3秒。堆肥桶惩罚急躁。',
    },
    news: [],
    pace: 0.75,
    time: 195,
    ground: '#59444c',
    rows: [
      '###############',
      '#@..rccc.c...w#',
      '#.#.#c#c#c#.#.#',
      '#~~rCoC~~o~~C~#',
      '#p#.#c#.#.#.#.#',
      '#C~oC~~oCCCoCC#',
      '#.#.#.#c#.#.#.#',
      '#s..c.c....c.b#',
      '###############',
    ],
  },
  {
    id: 'royal-conservatory',
    name: { en: 'Royal Conservatory', zh: '皇家温室' },
    tip: {
      en: 'The final test: walls, barrels, wet soil and four rivals.',
      zh: '最终考验：墙壁、堆肥桶、湿地和四名对手。',
    },
    news: [],
    pace: 0.7,
    time: 195,
    ground: '#485936',
    rows: [
      '###############',
      '#@..rcc#.....w#',
      '#.#.#c###.#.#.#',
      '#.cr.o.~coc...#',
      '#p###~#b#C###.#',
      '#....o.~cocc.c#',
      '#.#.#c###.#.#.#',
      '#w.cc..#c....s#',
      '###############',
    ],
  },
];

const DUEL_DEF = {
  id: 'duel-arena',
  name: { en: 'Symmetric Duel Arena', zh: '对称决斗场' },
  tip: { en: '', zh: '' },
  news: [],
  pace: 1,
  time: 180,
  ground: '#295548',
  rows: [
    '###############',
    '#@............#',
    '#.#.#.#.#.#.#.#',
    '#....c.c.c....#',
    '#.#.#.#.#.#.#.#',
    '#....c.c.c....#',
    '#.#.#.#.#.#.#.#',
    '#............&#',
    '###############',
  ],
};

export const GARDENS = Object.freeze(DEFS.map(parseGarden));
export const GARDEN_COUNT = GARDENS.length;
/** The fixed, point-symmetric duel arena; players start at 1,1 and 13,7. */
export const DUEL_ARENA = parseGarden(DUEL_DEF);
