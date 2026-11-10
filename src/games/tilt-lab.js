import { background, drawPixelText as text } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'tilt-lab',
  name: { en: 'Tilt Lab', zh: '倾斜实验室' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Tilt the whole lab board to roll a glass marble past holes and into the goal socket. Hold an arrow to tilt that way (the tilt stays when you let go, so tilt gently); hold Space to ease the board back to level. Pressure plates open gates, but a plate and the socket only register while the board is level and the marble is slow. Ice slides far, sand drags, flaps open one way and moving blocks bounce you. Falling into a hole costs one of three lives. The yellow guide arrow leads the way at first; from lab 15 it appears only after a fall or a long stall. Clear all 22 labs; progress is saved.',
    zh: '倾斜整个实验台，让玻璃弹珠绕过坑洞滚进目标凹槽。按住方向键向该方向倾斜（松手后倾角保持不变，请轻轻倾斜），按住空格让台面缓缓回到水平。压力板能打开闸门，但压力板和凹槽只在台面水平且弹珠足够慢时才会起效。冰面滑得远，沙地拖慢，挡板只能单向通过，移动挡块会把你弹开。掉进坑里会失去三条命中的一条。黄色引导箭头起初会带路；从第 15 个实验起，只有在掉落或长时间卡住后才会出现。完成全部 22 个实验，进度会被保存。',
  },
  keys: [
    { label: { en: 'Tilt the board', zh: '倾斜台面' }, keys: 'Arrows / WASD' },
    { label: { en: 'Ease the board level', zh: '台面回平' }, keys: 'Space' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Level', '放平', 'right'],
  ]),
};

// Rules are exported read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 240,
  maxDt: 0.1,
  cell: 16,
  cols: 30,
  rows: 16,
  top: 42,
  radius: 5, // marble radius, px
  holeR: 7, // a marble falls when its centre is within this of a hole centre
  lipSpeed: 30, // px/s: below this a marble also tips in from the drawn rim, one pixel further out
  gravity: 1100, // px/s^2 per unit sin(tilt); includes the 5/7 solid-sphere rolling factor
  maxTilt: 9, // deg
  tiltRate: 9, // deg/s while an arrow is held
  easeRate: 24, // deg/s while Space is held
  goTilt: 8, // deg the guide asks for before a roll
  levelTol: 2, // deg: plates and the socket need a board at least this flat
  turnTol: 0.25, // deg: a turn at rest needs the board flatter than this, or the marble drifts
  guideFrom: 15, // 1-based lab where the route arrow stops showing until a fall or a stall
  pinSpeed: 2, // px/s: a marble this slow under a full tilt is pinned against something
  pinTime: 0.12, // s pinned before the hidden-route prompt reminds the player to level
  helpStall: 30, // s without reaching a new resting spot before the hidden route arrow returns
  rollFriction: Object.freeze({ floor: 40, ice: 4, sand: 130 }), // px/s^2 rolling resistance per surface
  restitution: 0.3,
  bounceMin: 12, // px/s: slower wall impacts are perfectly inelastic
  maxSpeed: 600,
  dishR: 11, // the socket is a shallow dish that pulls the marble toward its centre
  dishK: 45, // 1/s^2
  captureSpeed: 70, // px/s: slower than this inside the dish, the dish keeps the marble
  settleR: 6,
  settleSpeed: 25,
  settleTime: 0.5,
  plateR: 9,
  plateSpeed: 70,
  plateTime: 0.3,
  restSpeed: 10,
  restTime: 0.25,
  lives: 3,
  fall: 0.9,
  clearPause: 1.4,
  promptHold: 0.54, // a little over half a second, so frame quantisation never shows less
  stuckTime: 3,
  forecast: 4, // s: how far ahead the prompt looks for a moving block on the planned roll
  lags: [0, 0.3, 0.6], // s: reaction delays a follower of the prompt may have
  blockEvery: 24, // ticks between looks for a moving block on the planned roll
  waitMax: 12, // s: after this long the prompt stops asking to wait for a block
  think: 8,
  msgTime: 2,
  clearScore: 100,
  lifeScore: 25,
  parScore: 3,
});
const R = RULES;
const STEP = R.step;
const RAD = Math.PI / 180;
const CELL = R.cell;
const GAP = 1e-3;
const MENU_COLS = 11;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// --- Lab authoring ---
// Legend: # wall, . floor, ~ ice, : sand, S start, G socket, C checkpoint, O hole,
// 1 2 3 plates, a b c their gates, > < ^ v one-way flaps (the arrow is the way through).

const DIRS = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
const DIR_KEYS = Object.keys(DIRS);
const ARROW = { R: '→', L: '←', U: '↑', D: '↓' };
const FLAP_DIR = { '>': 'R', '<': 'L', '^': 'U', v: 'D' };
const lab = (name, tip, par, rows, extra = {}) => ({ name, tip, par, rows, ...extra });
const mover = (c0, r0, c1, r1, w, h, period, phase = 0) => ({
  c0,
  r0,
  c1,
  r1,
  w,
  h,
  period,
  phase,
});

const LAB_DEFS = [
  // BEGIN LABS
  lab(
    ['First Roll', '初次滚动'],
    ['Hold an arrow to tilt, then follow the yellow arrow', '按住方向键倾斜，跟着黄色箭头走'],
    30,
    [
      '##############################',
      '#S...........................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#.........########...........#',
      '#.........########...........#',
      '#.........########...........#',
      '#.........########...........#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#...........................G#',
      '##############################',
    ],
  ),
  lab(
    ['Switchback', '之字回廊'],
    ['Roll to the wall, level the board, then turn', '滚到墙边，放平台面，再转向'],
    60,
    [
      '##############################',
      '#S...........................#',
      '##O#O#O#O#O#O#O#O#O#O#O#O#OO.#',
      '##O#O#O#O#O#O#O#O#O#O#O#O#O#.#',
      '#............................#',
      '#.O###########################',
      '#.O#O#O#O#O#O#O#O#O#O#O#O#O###',
      '#............................#',
      '###########################O.#',
      '########O###################.#',
      '#............................#',
      '#.......#..............O.....#',
      '#.....O...........#..........#',
      '#.............O..............#',
      '#G...........................#',
      '##############################',
    ],
  ),
  lab(
    ['Pit Stop', '坑道驿站'],
    ['A marble falls when its centre crosses a hole', '弹珠中心越过坑沿就会掉下去'],
    55,
    [
      '##############################',
      '#S.##.........#####.O........#',
      '#..............O.............#',
      '#.......O............O.......#',
      '#............................#',
      '#............................#',
      '#.........O...O..........O..O#',
      '#............................#',
      '#............................#',
      '#............G...O...........#',
      '#............#..........O....#',
      '#.........O..#...O...........#',
      '#O..###......................#',
      '#............#...............#',
      '#............#...........O...#',
      '##############################',
    ],
  ),
  lab(
    ['Narrow Bridge', '窄桥'],
    [
      'Level the board before a bridge and tilt only along it',
      '过桥前先放平台面，只沿桥的方向倾斜',
    ],
    55,
    [
      '##############################',
      '#OOOOOOOOOOOOOOOOOOOOOOOOOOOO#',
      '#O##O####OO##O##O##O##O##O####',
      '#S........#.....#.....#......#',
      '#O##O####.###O###.#O###.#O##.#',
      '#OOOOOOOO.OOOOOOO.OOOOO.OOOO.#',
      '####OOOO#.#OOOOO#.#OOO#.#OO#.#',
      '######O##.#O#####.###O#.##O#.#',
      '#G.#.........................#',
      '#.##.#O####O####O####O####O###',
      '#.##.OOOOOOOOOOOOOOOOOOOOOOOO#',
      '#.##.###O####O####O####O####O#',
      '#............................#',
      '###O####O####O####O####O####O#',
      '#OOOOOOOOOOOOOOOOOOOOOOOOOOOO#',
      '##############################',
    ],
  ),
  lab(
    ['Pressure Plate', '压力板'],
    ['Level the board on the plate to open the gate', '在压力板上放平台面，闸门就会打开'],
    55,
    [
      '##############################',
      '#S...........1#.........OO...#',
      '#.............#......O.......#',
      '#...........O.#O.............#',
      '#.........##..#.......##.##..#',
      '#.............a..............#',
      '#........#....#......#..#....#',
      '###...........#....O.#..#..#.#',
      '#.............#O........#O..G#',
      '#..#.O........#.............##',
      '#..#....###...#..............#',
      '#O.#...####..##...#..O.#.....#',
      '#.........#...#...#....#.....#',
      '#.............#.....#O.#.....#',
      '#.O...###..O..#..............#',
      '##############################',
    ],
  ),
  lab(
    ['Sand Trap', '沙地陷阱'],
    ['Sand drags: keep the board tilted to the end', '沙地拖慢弹珠：一直保持倾斜'],
    80,
    [
      '##############################',
      '#S.....:::::::::::::::.......#',
      '##O#O#O#O#O#O#O#O#O#O#O#O#OO.#',
      '############################.#',
      '###########################O.#',
      '############################.#',
      '###########################O.#',
      '##O#O#O#O#O#O#O#O#O#O#O#O#O#.#',
      '#......:::::::::::::::.......#',
      '#.O###########################',
      '#.############################',
      '#.O###########################',
      '#.############################',
      '#.O#O#O#O#O#O#O#O#O#O#O#O#####',
      '#.......:::::::::::::.......G#',
      '##############################',
    ],
  ),
  lab(
    ['Ice Rink', '冰面赛场'],
    ['Ice barely slows you: wall stops are your brakes', '冰面几乎没有摩擦：靠墙来刹车'],
    65,
    [
      '##############################',
      '#S~~~O~~~~~~~~~~~~~~~~~~~~~~##',
      '#~~~~~~~~~~~~~~~~~O~~~~~~~~~##',
      '#~#~~~~~~~~~~~~~~~~~~~~~~~~~##',
      '#~~~~~~~~~~~~O~~~###~~~~~~~~~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '#~~~O~~~~~~~~~~~~~~~G~~~~~~~~#',
      '#~~~~~~~~##~~~~~~~~~#~~~~~~~~#',
      '##~~~~O~~~~~~~~~~~~~#~###~~~~#',
      '#~~~~~~~~~~~~~~~O~~~#~~~~~#~~#',
      '#~~~~~~~~~~#~~~~~~~~~~~~~##~~#',
      '#~~~~~~~~~~#~~~~~~~~~~O~~~~~~#',
      '#~~~~~~~~~~#~~~~~~~~~~~~~~~~~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '##############################',
    ],
  ),
  lab(
    ['Checkpoints', '检查点'],
    ['Flags save your place after a fall', '旗帜会在你掉落后保存位置'],
    45,
    [
      '##############################',
      '##S.........................C#',
      '#G##OOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.##OOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.##OOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#.OOOOOOOOOOOOOOOOOOOOOOOOOO.#',
      '#C..........................C#',
      '##############################',
    ],
  ),
  lab(
    ['One Way', '单向挡板'],
    ['Flaps open one way only: find the route they allow', '挡板只能单向通过：找出它允许的路线'],
    60,
    [
      '##############################',
      '#S...........................#',
      '#.O#O#O#O#O#O#O#O#O#O#O#O#OO.#',
      '#.#########################O.#',
      '#^##########################.#',
      '#.O#########################.#',
      '#.OO#O#O#O#O#O##O#O#O#O#O#O#.#',
      '#.............<..............#',
      '#.O###########################',
      '#.##########################G#',
      '#.O#########################.#',
      '#.O#########################^#',
      '#.#########################O.#',
      '#.#O#O#O#O#O#O#O#O#O#O#O#O#O.#',
      '#............................#',
      '##############################',
    ],
  ),
  lab(
    ['Two Keys', '双钥匙'],
    ['Two plates, two gates: open them in order', '两块压力板，两道闸门：依次打开'],
    110,
    [
      '##############################',
      '#S.......1#...2#....#.....#.G#',
      '#...O.....#.O..#....#....###.#',
      '#.O.....#.#......#..#.O...##.#',
      '#.........a.........#.....#..#',
      '#.....#..##.........#....#...#',
      '#.........#..###....#.....##.#',
      '#.....#...#.....#...#........#',
      '#....###..#.........b........#',
      '#...#.#...#.#...#..##....#...#',
      '#...#.....#.....#...#....#...#',
      '#...#..O#.#O....##..#....#..O#',
      '#......#O.#.....###.#........#',
      '####..O...#.......O.#........#',
      '#.........#O.....#..#OO......#',
      '##############################',
    ],
  ),
  lab(
    ['Pendulum', '摆动挡块'],
    ['A moving block bounces you back: wait for the gap', '移动挡块会把你弹回：等它让开'],
    90,
    [
      '##############################',
      '#S........#....#....#...O....#',
      '#..............#....#........#',
      '#..#.........###.##.#O.......#',
      '#...................#...#....#',
      '#...#....#..........#.###..O.#',
      '#.............O.....#.##.....#',
      '#.........#..##.....#...#....#',
      '##........#............O#....#',
      '###.......#..#.........OO....#',
      '#..#......#..................#',
      '#..#......#..#.#...#.........#',
      '#O##...#..#.O#...........O...#',
      '#.#O.O.#O.#.........#G.#.....#',
      '#O#..#....#.........##.......#',
      '##############################',
    ],
    { movers: [mover(10, 3, 10, 5, 16, 16, 7, 0), mover(20, 9, 20, 11, 16, 16, 8, 0.3)] },
  ),
  lab(
    ['Dune Bridge', '沙丘窄桥'],
    ['Sand bridge: slow, so level first and keep tilting', '沙桥很慢：先放平台面，再持续倾斜'],
    65,
    [
      '##############################',
      '#OOOOOOOOOOOOOOOOOOOOOOOOOOOO#',
      '#O##O####O####O####OOOO##O####',
      '#S::::::::::::::::::#:#::::::#',
      '#O##O####O####O####:#O#:#O##:#',
      '#OOOOOOOOOOOOOOOOOO:OOO:OOOO:#',
      '#OOOOOOO#####OOOOO#:#O#:#OO#:#',
      '###O#########O##O##:#O#:##O#:#',
      '#:::::::::G#:#:::::::::::::::#',
      '#:#O######:###:#O####O####O###',
      '#:OOOOOO##:##O:OOOOOOOOOOOOOO#',
      '#:#O####O#:###:###O####O####O#',
      '#::::::::::::::::::::::::::::#',
      '###O####O####O####O####O####O#',
      '#OOOOOOOOOOOOOOOOOOOOOOOOOOOO#',
      '##############################',
    ],
  ),
  lab(
    ['Timed Door', '限时闸门'],
    ['This gate shuts again after a while: do not dawdle', '这道闸门过一会儿会再关上：别磨蹭'],
    70,
    [
      '##############################',
      '#S..1#.........#..O....###.O.#',
      '#....#.........#.......#.....#',
      '#...##......#..#.............#',
      '#.......###....#.............#',
      '#...........O..#.............#',
      '#...........O..#........#....#',
      '#...O....#.....#........#....#',
      '#........#.....#.....#..#....#',
      '#..............##...O.......##',
      '#...O..........##.....O.O...##',
      '#.#.....#.O....#.........#.#.#',
      '#.#............a.........#.O.#',
      '#.....#..#O....#..#......#.O.#',
      '#........#.....#G.........O..#',
      '##############################',
    ],
    { timed: { a: 22 } },
  ),
  lab(
    ['Ice Bridge', '冰上窄桥'],
    ['Ice bridges are fast: tilt, then level at the wall', '冰桥很快：倾斜，到墙边再放平'],
    55,
    [
      '##############################',
      '#O#######################OOOO#',
      '#S~~~~~~~~~~~~~~~~~~~~~~~#~~~#',
      '#O######################~#O#~#',
      '#OOOOOOOOOOOOOOOOOOOOOO#~#O#~#',
      '####OOOOOOOOOOOOOOOOOOO#~#O#~#',
      '#######OOOOOOOOOOO######~###~#',
      '#G~~~~~#~~~#~~#~~#~~~~~~~~~~~#',
      '#~######~#O#~##~##~###########',
      '#~##OOO#~#O#~##~##~#OOOOOOOOO#',
      '#~#OOOO#~#O#~##~##~#OOOOOOOOO#',
      '#~######~###~##~##~###########',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '##############################',
      '#OOOOOOOOOOOOOOOOOOOOOOOOOOOO#',
      '##############################',
    ],
  ),
  lab(
    ['Flap Maze', '挡板迷宫'],
    ['Flaps only let you through one way: plan the loop', '挡板只能单向通过：规划好绕行'],
    90,
    [
      '##############################',
      '#S...........................#',
      '#..........#......###........#',
      '##.O.......#........O..O.>.#.#',
      '#.....>....................#.#',
      '#........###...............#.#',
      '#.....................^....###',
      '#........O................####',
      '#...........v.....O........###',
      '#..#..................###....#',
      '#......................G<.#..#',
      '#...........>..........<.....#',
      '#........^...................#',
      '#.......#....................#',
      '#...#........................#',
      '##############################',
    ],
  ),
  lab(
    ['Crossing Guards', '路口卫兵'],
    ['Blocks patrol the crossings: pass between them', '挡块在路口巡逻：从间隙中穿过'],
    110,
    [
      '##############################',
      '#S......#.....O#......#......#',
      '#...###.#.....##......#......#',
      '#..##O..#.....##......#....O.#',
      '#O...O.....###.#....O.#......#',
      '#...#..........#..OO..#....O.#',
      '#..............#.O.#.......#.#',
      '#..#...#.......#..##.#.....O.#',
      '#..O...........#.............#',
      '#.......#...O......#.........#',
      '#.......#..#................##',
      '###.....#.............#..#####',
      '#.......#..#..#.....O.#.....G#',
      '#.....###..#.......##.#......#',
      '#.......#......#...#..#......#',
      '##############################',
    ],
    {
      movers: [
        mover(8, 5, 8, 7, 16, 16, 6.5, 0),
        mover(15, 10, 15, 12, 16, 16, 8, 0.5),
        mover(22, 7, 22, 9, 16, 16, 7, 0.2),
      ],
    },
  ),
  lab(
    ['Three Gates', '三道闸门'],
    ['Three plates, three gates: up, down, up', '三块压力板，三道闸门：上、下、上'],
    145,
    [
      '##############################',
      '#S......#.....##......#....G##',
      '#...O...#...#.O##.#...#......#',
      '#.##.O..#...#..##.....#O.....#',
      '#.......#.#...##......#......#',
      '#..O....#2.....b.....3#......#',
      '#.....#.#...#..#..#...#..#...#',
      '#....#..#......#..#...#..#...#',
      '#.......a......#..#...#......#',
      '#.....###......#..#...#......#',
      '#....#..#...####......c......#',
      '#..O....#......#....###...#..#',
      '#.......#......#O.....#...#O.#',
      '#.......##.O...#......#.....##',
      '#......1##.....#.#...O#.....##',
      '##############################',
    ],
  ),
  lab(
    ['Race the Clock', '与时间赛跑'],
    [
      'Ice to the plate, sand to the gate: beat the clock',
      '冰面冲向压力板，沙地冲向闸门：赶在门关上之前',
    ],
    100,
    [
      '##############################',
      '#S~~~~~~~~~~##:::::::::::::::#',
      '#1~~~~~~~~~~~#::::O:#::::::::#',
      '####~O#~~~~~~#:::::::::::::::#',
      '#~~~~~~~~~~~~a>::::::::::::::#',
      '#~~~~~~~##~~~#::::::::::::::##',
      '#~~~~~~~###~~#:::::::::::::###',
      '#~~~O~~~O~~~~#:::::::::::::::#',
      '#~O~~#~~~~~~~#:#:::::::::::::#',
      '#~~~~~~~~~~~~#:#:O::O:O::::::#',
      '#~~~~~~~~~~~~#:#:::::::::::::#',
      '#~~~~~~~~~~#~#:::::::O::::::G#',
      '#~~~~~##~O~#~#:::::::::::#:###',
      '#~~~~~~~~~~#~#:::O::#:::O::###',
      '#~~~~~~~##~~~#::::::#::::::::#',
      '##############################',
    ],
    { timed: { a: 26 } },
  ),
  lab(
    ['Frozen Maze', '冰冻迷宫'],
    ['Ice, pits and flaps: think before each roll', '冰面、坑洞和挡板：每次滚动前先想好'],
    80,
    [
      '##############################',
      '#S~##~~~~~~~~~~~~~~~~O~~~~~~~#',
      '#~~~~~<~~~~~~~~~~~~~~~~~~~~~~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~####~#',
      '#~~~~~##~~~~~~#~~~O~~~~~~~~G~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '#~~~~##~~~~~~~~~~~~~~~~#~~~~~#',
      '#~~~#~#~~~~~~~~~~O~#~~~#~~#~~#',
      '#~~~#~#~~~~~~~~~~O~#~~~#~~#~~#',
      '#~~~#~#~~~~~~~~~~~~#~~~~~~#~~#',
      '#~###~~####~~~~###O~~~~~~~####',
      '#~~~~~~~#~~~~~~~~~~~~~O~~~~~~#',
      '#~~~#~#~#~~~~~~~~~~~~~~~~~~~~#',
      '#~#####~#~~~#~~~~~~~~O~~~~~~O#',
      '#~~#~O~~~#~~#~~~~~~~~~~~~~####',
      '##############################',
    ],
  ),
  lab(
    ['Spiral Stair', '螺旋阶梯'],
    ['A spiral of bridges: turn at each wall', '一圈圈的窄桥：每到墙边就转向'],
    90,
    [
      '##############################',
      '#S...........................#',
      '#O##########################.#',
      '#OOC.......................#.#',
      '#O#.##O####O####O####O####.#.#',
      '#O#.#OOOOOOOOOOOOOOOOOOOOO.#.#',
      '#OO.OOOOOOOOOOOOOOOOOOOOO#.#.#',
      '#O#.#OOOOOOOOOOOOOOOOOOOO#.#.#',
      '#O#.#OOOOOOOOOOOOOOOOOOOO#.#.#',
      '#O#.#OOOOOOOOOOOOOOOOOOOO#.#.#',
      '#O#.####OOOOOOOOOOOOOOOOOO.#.#',
      '#OO.####O####O####O####O##.#.#',
      '#O#.#G.....................#.#',
      '#O#.########################.#',
      '#O#.........................C#',
      '##############################',
    ],
  ),
  lab(
    ['Gauntlet', '重重关卡'],
    ['Ice, sand, plates, gates and flaps in one run', '一次跑完冰面、沙地、压力板、闸门和挡板'],
    125,
    [
      '##############################',
      '#S~~~~~~~#...2.....#:::::::::#',
      '#~~~~~~~~#....#....#:<:::::::#',
      '#~~^~~~~~#....#...##::::O::::#',
      '#~~~~~~#~#..>......b:::::::v:#',
      '#~~O#~~~~#.#..#....#::::#::::#',
      '#~~~~~~~~#.#...O...#G#::#:::O#',
      '#~~~^O~~~#.....##^.##:::#:::##',
      '#~~O~~~~~#.........#::#::::::#',
      '#~~~~~~#~#.........#:::##::::#',
      '#~~~O#~~~#...#.....#:::::::::#',
      '#1~^~~~~~a....^....#:::>::O::#',
      '#~~~~~#~##...O.....#:::::::::#',
      '#~~~O~~~~#.........#::O:::O::#',
      '#~~~~O~~~#..#..O...#::::::::O#',
      '##############################',
    ],
  ),
  lab(
    ['Final Exam', '毕业考试'],
    ['Everything you learned, with no extra hints', '把学过的一切用上'],
    110,
    [
      '##############################',
      '#S~~~~~~~~####~~~~>~~~##~~~~~#',
      '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
      '#~###~~~#~~#~~~~~~~~~~~~~~#~O#',
      '#~~~~~~~~~~##~~~~~~~~~~~~~#~~#',
      '#~~~~~~~~~~#~~~~~#~~~~~~~~~O~#',
      '#~~~~~~~~~~#~~~~~#~~~~~~~~~~~#',
      '##O~~~~~~~##~~~~G#~##~~~~~~~##',
      '#~~~~~~~~O##~~####~~~~~~~~~~##',
      '#~~~~~O~~###~~~~#~~~~####~~###',
      '##~##~~~O###~O~~#~~~~~~~~~O###',
      '##~~~~~~~#~<~~~~~~~~~~~~~~~#~#',
      '##~~~~~~~#~~~~~~~~~~~~~~~~~~~#',
      '##~O~~~~~#~~~~v~~~~#~~~~~~~~~#',
      '#~~~~~~~~~~~~~~~#~#~~~####~~~#',
      '##############################',
    ],
  ),
  // END LABS
];

// --- Building a lab from its authored rows ---

const cellX = (c) => c * CELL + CELL / 2;
const cellY = (r) => R.top + r * CELL + CELL / 2;
const cellOf = (x, y) => ({
  c: clamp(Math.floor(x / CELL), 0, R.cols - 1),
  r: clamp(Math.floor((y - R.top) / CELL), 0, R.rows - 1),
});
const grid = (fill) => Array.from({ length: R.rows }, () => Array(R.cols).fill(fill));

export function buildLab(def, index) {
  const b = {
    ...def,
    index,
    wall: grid(false),
    surface: grid(0), // 0 floor, 1 ice, 2 sand
    holeAt: grid(false),
    gateAt: grid(-1),
    plateAt: grid(-1),
    flapAt: grid(null),
    holes: [],
    plates: [],
    gates: [],
    flaps: [],
    checkpoints: [],
    start: null,
    goal: null,
    movers: def.movers || [],
    timed: def.timed || {},
  };
  if (def.rows.length !== R.rows) throw new Error(`lab ${index + 1}: needs ${R.rows} rows`);
  def.rows.forEach((row, r) => {
    if (row.length !== R.cols)
      throw new Error(`lab ${index + 1} row ${r}: needs ${R.cols} columns`);
    [...row].forEach((ch, c) => {
      const at = { c, r };
      if (ch === '#') b.wall[r][c] = true;
      else if (ch === 'O') {
        b.holeAt[r][c] = true;
        b.holes.push({ ...at, x: cellX(c), y: cellY(r) });
      } else if (ch === '~') b.surface[r][c] = 1;
      else if (ch === ':') b.surface[r][c] = 2;
      else if (ch === 'S') b.start = at;
      else if (ch === 'G') b.goal = at;
      else if (ch === 'C') b.checkpoints.push(at);
      else if ('123'.includes(ch)) {
        b.plateAt[r][c] = Number(ch) - 1;
        b.plates.push({ ...at, gate: Number(ch) - 1 });
      } else if ('abc'.includes(ch)) {
        b.gateAt[r][c] = ch.charCodeAt(0) - 97;
        b.gates.push({ ...at, id: ch.charCodeAt(0) - 97 });
      } else if (FLAP_DIR[ch]) {
        const dir = FLAP_DIR[ch];
        b.flapAt[r][c] = dir;
        b.flaps.push(flapSegment(c, r, dir));
      }
    });
  });
  if (!b.start || !b.goal) throw new Error(`lab ${index + 1}: needs a start and a socket`);
  return b;
}

// A flap is a hinged strip across the exit edge of its cell. It only stops a marble that is fully
// on the far side of it (clearance of one radius), so a marble pushing through is never moved
// sideways, and a marble turned back by it rests in the neighbouring cell, never inside the flap's.
function flapSegment(c, r, dir) {
  const x0 = c * CELL;
  const y0 = R.top + r * CELL;
  if (dir === 'R') return { axis: 'x', at: x0 + CELL, lo: y0, hi: y0 + CELL, side: 1 };
  if (dir === 'L') return { axis: 'x', at: x0, lo: y0, hi: y0 + CELL, side: -1 };
  if (dir === 'D') return { axis: 'y', at: y0 + CELL, lo: x0, hi: x0 + CELL, side: 1 };
  return { axis: 'y', at: y0, lo: x0, hi: x0 + CELL, side: -1 };
}

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.values(v).forEach(deepFreeze);
  }
  return v;
};
export const LABS = Object.freeze(LAB_DEFS.map((def, index) => deepFreeze(buildLab(def, index))));
export const LAB_COUNT = LABS.length;

// A moving block follows a triangle wave between two cells (uniform speed, deterministic).
function moverAt(m, clock) {
  const u = (((clock / m.period + m.phase) % 1) + 1) % 1;
  const k = u < 0.5 ? u * 2 : 2 - u * 2;
  const x0 = m.c0 * CELL;
  const y0 = R.top + m.r0 * CELL;
  const dx = (m.c1 - m.c0) * CELL;
  const dy = (m.r1 - m.r0) * CELL;
  const dir = u < 0.5 ? 1 : -1;
  const x = x0 + dx * k;
  const y = y0 + dy * k;
  return {
    x0: x,
    y0: y,
    x1: x + m.w,
    y1: y + m.h,
    vx: (dx * 2 * dir) / m.period,
    vy: (dy * 2 * dir) / m.period,
  };
}

// --- Physics: swept circle contact ---

// First time a circle at (px,py) moving by (dx,dy) touches the rectangle, as a fraction of the move.
// The rectangle grown by the radius is the union of two slabs and four corner discs, and the
// earliest entry into any piece is the true first contact. `only` limits it to one slab.
function rectHit(px, py, dx, dy, r, x0, y0, x1, y1, only) {
  const qx = clamp(px, x0, x1);
  const qy = clamp(py, y0, y1);
  const wx = px - qx;
  const wy = py - qy;
  const d2 = wx * wx + wy * wy;
  if (d2 < (r - 1e-6) * (r - 1e-6)) {
    let nx;
    let ny;
    let depth;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      nx = wx / d;
      ny = wy / d;
      depth = r - d;
    } else {
      const edges = [px - x0, x1 - px, py - y0, y1 - py];
      const k = edges.indexOf(Math.min(...edges));
      [nx, ny] = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ][k];
      depth = r + edges[k];
    }
    return dx * nx + dy * ny < 0 ? { s: 0, nx, ny, depth } : null;
  }
  let best = null;
  const take = (s, nx, ny) => {
    if (s >= -1e-9 && s <= 1 && (!best || s < best.s))
      best = { s: Math.max(0, s), nx, ny, depth: 0 };
  };
  const slab = (p, d, lo, hi) => {
    if (d === 0) return p >= lo && p <= hi ? [-Infinity, Infinity] : null;
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    return a < b ? [a, b] : [b, a];
  };
  if (only !== 'y') {
    const sx = slab(px, dx, x0 - r, x1 + r);
    const sy = slab(py, dy, y0, y1);
    if (sx && sy && sx[0] >= sy[0] && Math.max(sx[0], sy[0]) <= Math.min(sx[1], sy[1]))
      take(sx[0], dx > 0 ? -1 : 1, 0);
  }
  if (only !== 'x') {
    const sx = slab(px, dx, x0, x1);
    const sy = slab(py, dy, y0 - r, y1 + r);
    if (sx && sy && sy[0] > sx[0] && Math.max(sx[0], sy[0]) <= Math.min(sx[1], sy[1]))
      take(sy[0], 0, dy > 0 ? -1 : 1);
  }
  if (!only) {
    const a = dx * dx + dy * dy;
    for (const [cx, cy] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      const ox = px - cx;
      const oy = py - cy;
      const b = 2 * (dx * ox + dy * oy);
      const disc = b * b - 4 * a * (ox * ox + oy * oy - r * r);
      if (a === 0 || disc < 0) continue;
      const s = (-b - Math.sqrt(disc)) / (2 * a);
      if (s < 0 || s > 1) continue;
      take(s, (ox + dx * s) / r, (oy + dy * s) / r);
    }
  }
  return best;
}

const MAX_CONTACTS = 8;

// Advance one marble {x,y,vx,vy} by h seconds under acceleration (ax,ay) and rolling resistance
// `fric` (px/s^2). `world` = {solid(c,r), movers:[{x0,y0,x1,y1,vx,vy}], flaps:[...]} with the movers
// placed where they are at the start of the step. Returns a new marble plus the impact speed.
export function stepMarble(m, ax, ay, fric, h, world) {
  let vx = m.vx + ax * h;
  let vy = m.vy + ay * h;
  const sp = Math.hypot(vx, vy);
  if (sp <= fric * h) {
    vx = 0;
    vy = 0;
  } else {
    const k = (sp - fric * h) / sp;
    vx *= k;
    vy *= k;
  }
  const cap = Math.hypot(vx, vy);
  if (cap > R.maxSpeed) {
    vx *= R.maxSpeed / cap;
    vy *= R.maxSpeed / cap;
  }
  let { x, y } = m;
  let left = h;
  let elapsed = 0;
  let impact = 0;
  let mover = -1;
  const r = R.radius;
  for (let n = 0; n < MAX_CONTACTS && left > 1e-12; n++) {
    const dx = vx * left;
    const dy = vy * left;
    let hit = null;
    const consider = (h2, mvx = 0, mvy = 0, mi = -1) => {
      if (h2 && (!hit || h2.s < hit.s)) hit = { ...h2, mvx, mvy, mi };
    };
    const c0 = Math.floor((Math.min(x, x + dx) - r - 1) / CELL);
    const c1 = Math.floor((Math.max(x, x + dx) + r + 1) / CELL);
    const r0 = Math.floor((Math.min(y, y + dy) - r - 1 - R.top) / CELL);
    const r1 = Math.floor((Math.max(y, y + dy) + r + 1 - R.top) / CELL);
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++)
        if (world.solid(cc, rr))
          consider(
            rectHit(
              x,
              y,
              dx,
              dy,
              r,
              cc * CELL,
              R.top + rr * CELL,
              (cc + 1) * CELL,
              R.top + (rr + 1) * CELL,
            ),
          );
    for (const f of world.flaps) {
      const p = f.axis === 'x' ? x : y;
      if ((p - f.at) * f.side < r - 1e-6) continue;
      const box = f.axis === 'x' ? [f.at, f.lo, f.at, f.hi] : [f.lo, f.at, f.hi, f.at];
      consider(rectHit(x, y, dx, dy, r, ...box, f.axis));
    }
    for (const [mi, b] of world.movers.entries()) {
      const bx = b.x0 + b.vx * elapsed;
      const by = b.y0 + b.vy * elapsed;
      consider(
        rectHit(
          x,
          y,
          dx - b.vx * left,
          dy - b.vy * left,
          r,
          bx,
          by,
          bx + b.x1 - b.x0,
          by + b.y1 - b.y0,
        ),
        b.vx,
        b.vy,
        mi,
      );
    }
    if (!hit) {
      x += dx;
      y += dy;
      break;
    }
    x += dx * hit.s + hit.nx * (GAP + hit.depth);
    y += dy * hit.s + hit.ny * (GAP + hit.depth);
    if (hit.mi >= 0 && mover < 0) mover = hit.mi;
    elapsed += left * hit.s;
    left *= 1 - hit.s;
    const rvx = vx - hit.mvx;
    const rvy = vy - hit.mvy;
    const vn = rvx * hit.nx + rvy * hit.ny;
    if (vn < 0) {
      const e = -vn < R.bounceMin ? 0 : R.restitution;
      vx = rvx - (1 + e) * vn * hit.nx + hit.mvx;
      vy = rvy - (1 + e) * vn * hit.ny + hit.mvy;
      impact = Math.max(impact, -vn);
    }
  }
  const out = pushOut(x, y, world);
  return { x: out.x, y: out.y, vx, vy, impact, mover };
}

// A moving block can press the marble into a wall corner by a fraction of a pixel; settle it back
// on the surface (position only, so it can never add energy).
function pushOut(px, py, world) {
  let x = px;
  let y = py;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    const c1 = Math.floor((x + R.radius) / CELL);
    const r1 = Math.floor((y + R.radius - R.top) / CELL);
    for (let rr = Math.floor((y - R.radius - R.top) / CELL); rr <= r1; rr++)
      for (let cc = Math.floor((x - R.radius) / CELL); cc <= c1; cc++) {
        if (!world.solid(cc, rr)) continue;
        const x0 = cc * CELL;
        const y0 = R.top + rr * CELL;
        const wx = x - clamp(x, x0, x0 + CELL);
        const wy = y - clamp(y, y0, y0 + CELL);
        const d = Math.hypot(wx, wy);
        if (d < R.radius - 0.05 && d > 1e-9) {
          x += (wx / d) * (R.radius - d);
          y += (wy / d) * (R.radius - d);
          moved = true;
        } else if (d <= 1e-9) {
          // The centre itself is inside the cell: leave through the nearest face.
          const faces = [x - x0, x0 + CELL - x, y - y0, y0 + CELL - y];
          const k = faces.indexOf(Math.min(...faces));
          if (k === 0) x = x0 - R.radius;
          else if (k === 1) x = x0 + CELL + R.radius;
          else if (k === 2) y = y0 - R.radius;
          else y = y0 + CELL + R.radius;
          moved = true;
        }
      }
    if (!moved) break;
  }
  return { x, y };
}

// --- Advice: plan the next roll on the grid of "rolls until something stops you" ---

const AXIS = { R: 'x', L: 'x', U: 'y', D: 'y' };
const SIGN = { R: 1, L: -1, D: 1, U: -1 };

const blocked = (b, c, r, open) =>
  c < 0 ||
  r < 0 ||
  c >= R.cols ||
  r >= R.rows ||
  b.wall[r][c] ||
  (b.gateAt[r][c] >= 0 && !((open >> b.gateAt[r][c]) & 1));

// Where a marble tilted toward `dir` from a standing start at cell (c,r) comes to rest, or null if it
// cannot move or would roll into a hole on the way.
export function slideFrom(b, c, r, dir, open) {
  const [dc, dr] = DIRS[dir];
  const path = [];
  let cc = c;
  let rr = r;
  for (;;) {
    const nc = cc + dc;
    const nr = rr + dr;
    if (blocked(b, nc, nr, open)) break;
    const wrong = (f) => f && AXIS[f] === AXIS[dir] && f !== dir;
    if (wrong(b.flapAt[nr][nc])) break;
    if (b.holeAt[nr][nc]) return null;
    cc = nc;
    rr = nr;
    path.push({ c: cc, r: rr });
  }
  if (!path.length) return null;
  const plate = b.plateAt[rr][cc];
  return { c: cc, r: rr, path, open: plate >= 0 ? open | (1 << plate) : open };
}

function hintOf(b, move, open) {
  if (move.c === b.goal.c && move.r === b.goal.r) return 'goal';
  const plate = b.plateAt[move.r][move.c];
  if (plate >= 0 && !((open >> plate) & 1)) return 'plate';
  const horizontal = AXIS[move.dir] === 'x';
  let holes = 0;
  const found = new Set();
  for (const { c, r } of move.path) {
    const side = horizontal
      ? [b.holeAt[r - 1]?.[c], b.holeAt[r + 1]?.[c]]
      : [b.holeAt[r]?.[c - 1], b.holeAt[r]?.[c + 1]];
    holes = Math.max(holes, side.filter(Boolean).length);
    if (
      b.movers.some(
        (m) =>
          c >= Math.min(m.c0, m.c1) - 1 &&
          c <= Math.max(m.c0, m.c1) + 1 &&
          r >= Math.min(m.r0, m.r1) - 1 &&
          r <= Math.max(m.r0, m.r1) + 1,
      )
    )
      found.add('block');
    if (b.flapAt[r][c]) found.add('flap');
    if (b.gateAt[r][c] >= 0) found.add('gate');
    if (b.surface[r][c] === 1) found.add('ice');
    if (b.surface[r][c] === 2) found.add('sand');
  }
  if (holes === 2) return 'bridge';
  for (const k of ['block', 'flap', 'gate']) if (found.has(k)) return k;
  for (const k of ['ice', 'sand']) if (found.has(k)) return k;
  return holes === 1 ? 'holes' : 'wall';
}

// Fewest rolls from a standing start to the socket, remembering plates pressed along the way.
export function planRoute(b, c0, r0, open0, failed = new Set()) {
  const key = (c, r, o) => (r * R.cols + c) * 8 + o;
  const seen = new Set([key(c0, r0, open0)]);
  const queue = [{ c: c0, r: r0, open: open0, first: null }];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const dir of DIR_KEYS) {
      if (!n.first && failed.has(`${dir}`)) continue;
      const res = slideFrom(b, n.c, n.r, dir, n.open);
      if (!res) continue;
      const k = key(res.c, res.r, res.open);
      if (seen.has(k)) continue;
      seen.add(k);
      const first = n.first || { dir, c: res.c, r: res.r, path: res.path };
      if (res.c === b.goal.c && res.r === b.goal.r)
        return { ...first, hint: hintOf(b, first, open0) };
      queue.push({ ...res, first });
    }
  }
  return null;
}

const HINTS = {
  wall: ['roll to the wall', '滚到墙边'],
  goal: ['roll to the socket', '滚向凹槽'],
  plate: ['roll onto the plate', '滚上压力板'],
  bridge: ['bridge ahead', '前方是窄桥'],
  holes: ['holes beside the path', '路旁有坑'],
  gate: ['through the open gate', '穿过打开的闸门'],
  flap: ['push through the flap', '推开挡板'],
  block: ['mind the moving block', '留意移动挡块'],
  ice: ['ice slides far', '冰面滑得远'],
  sand: ['sand: keep tilting', '沙地：保持倾斜'],
};
const WORDS = {
  level: ['Zero the tilt (Space) before turning', '先把倾角归零（空格）再转向'],
  plateLevel: ['Level the board (Space) to stop on the plate', '放平台面（空格），停在压力板上'],
  plateHold: ['Hold still: the plate is charging', '保持不动：压力板正在充能'],
  settle: ['Level the board (Space) to settle in the socket', '放平台面（空格），停进凹槽'],
  settleHold: ['Hold still: the marble is settling in', '保持不动：弹珠正在停进凹槽'],
  read: ['Read the board, then tilt toward your next stop', '观察台面，再朝下一个停靠点倾斜'],
  hold: ['Steady: let the marble roll', '保持住：让弹珠滚动'],
  fall: ['Falling: back to the last checkpoint', '掉落了：回到上一个检查点'],
  nopath: ['Level the board (Space) and try another way', '放平台面（空格），换条路试试'],
  nopathLevel: ['No way from here: try another tilt', '这里走不通：换个方向倾斜'],
  cleared: ['Lab cleared!', '实验完成！'],
  lost: ['Out of lives', '生命用完'],
  menu: ['Arrows pick a lab, Space starts it', '方向键选择实验，空格开始'],
};

const waitWords = (dir, block) => [
  `Wait for the block ${block} to pass, then tilt ${ARROW[dir]}`,
  `等挡块${block}过去，再向${ARROW[dir]}倾斜`,
];

const waitBlindWords = (block) => [
  `Wait for the block ${block} to pass, then tilt`,
  `等挡块${block}过去，再倾斜`,
];

const tiltWords = (dir, hint) => [
  `Tilt ${ARROW[dir]}: ${HINTS[hint][0]}`,
  `向${ARROW[dir]}倾斜：${HINTS[hint][1]}`,
];

// Replays the planned roll with the moving blocks where they will be, for a player who starts
// `lag` seconds from now and holds the arrow until the tilt reaches the guide angle. Returns the
// block that would be hit, or null when the roll is clear.
function blockOnRoll(s, plan, lag) {
  const b = s.lab;
  const axis = AXIS[plan.dir];
  let m = { ...s.marble };
  let tilt = axis === 'x' ? s.tx : s.ty;
  const cross = axis === 'x' ? s.ty : s.tx;
  const h = 1 / 60;
  for (let t = 0; t < R.forecast; t += h) {
    if (t >= lag) tilt = clamp(tilt + SIGN[plan.dir] * R.tiltRate * h, -R.goTilt, R.goTilt);
    const here = cellOf(m.x, m.y);
    const fric = R.rollFriction[SURFACES[b.surface[here.r][here.c]]];
    const [tx, ty] = axis === 'x' ? [tilt, cross] : [cross, tilt];
    const world = { ...s.world, movers: b.movers.map((mv) => moverAt(mv, s.clock + t)) };
    const next = stepMarble(
      m,
      R.gravity * Math.sin(tx * RAD),
      R.gravity * Math.sin(ty * RAD),
      fric,
      h,
      world,
    );
    if (next.mover >= 0) return world.movers[next.mover];
    m = next;
    if (t > lag + 0.5 && speedOf(m) < R.restSpeed) break;
  }
  return null;
}

const blockArrow = (mv) =>
  Math.abs(mv.vy) >= Math.abs(mv.vx)
    ? mv.vy < 0
      ? ARROW.U
      : ARROW.D
    : mv.vx < 0
      ? ARROW.L
      : ARROW.R;

// --- State ---

const dist = (x, y, p) => Math.hypot(x - p.x, y - p.y);
const centreOf = (p) => ({ x: cellX(p.c), y: cellY(p.r) });
const isLevel = (s) => Math.abs(s.tx) <= R.levelTol && Math.abs(s.ty) <= R.levelTol;
// From lab `guideFrom` on, the route arrow and the direction in the prompt are held back until the
// player has fallen or gone `helpStall` seconds without reaching a new resting spot.
const isBlind = (s) => s.level + 1 >= R.guideFrom && !s.helped;
const speedOf = (m) => Math.hypot(m.vx, m.vy);

function loadLab(s, index) {
  const b = LABS[index];
  const p = centreOf(b.start);
  Object.assign(s, {
    level: index,
    lab: b,
    lives: R.lives,
    clock: 0,
    open: 0,
    timers: [0, 0, 0],
    dwell: [0, 0, 0],
    check: b.start,
    marble: { x: p.x, y: p.y, vx: 0, vy: 0 },
    tx: 0,
    ty: 0,
    fall: null,
    settleT: 0,
    restT: 0,
    pinT: 0,
    freeze: 0,
    pending: null,
    menu: null,
    msg: null,
    line: null,
    advice: null,
    adv: {
      key: '',
      plan: null,
      failed: new Set(),
      stuck: 0,
      waited: 0,
      block: null,
      blockAt: -1e9,
    },
    falls: 0,
    helped: false,
    progressAt: 0,
    seen: new Set(),
  });
  s.timedFor = [0, 1, 2].map((id) => b.timed[String.fromCharCode(97 + id)] || 0);
  s.world = {
    solid: (c, r) => blocked(b, c, r, s.open),
    flaps: b.flaps,
    movers: b.movers.map((mv) => moverAt(mv, 0)),
  };
  think(s);
}

// Progress is a convenience: a broken or hostile store must never stop the game.
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress?.unlocked?.()));
    return Number.isFinite(n) ? clamp(n, 1, LAB_COUNT) : 1;
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, level) {
  try {
    progress?.unlock?.(level);
  } catch {
    // The clear still counts for this session.
  }
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    acc: 0,
    ticks: 0,
    hitTick: -1e9,
    blockTick: -1e9,
    progress: env.progress || null,
    best: Array(LAB_COUNT).fill(0),
    stats: { falls: 0, plates: 0, bounces: 0, cleared: 0, blocks: 0 },
  };
  const unlocked = readUnlocked(s.progress);
  loadLab(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    s.line = null;
    think(s);
  }
  return s;
}

const say = (s, en, zh) => {
  s.msg = { en, zh, time: R.msgTime };
};

function adviceOf(s) {
  const b = s.lab;
  const m = s.marble;
  if (s.menu) return { id: 'menu', words: WORDS.menu };
  if (s.phase === 'lost') return { id: 'lost', words: WORDS.lost };
  if (s.pending !== null || s.phase !== 'playing') return { id: 'cleared', words: WORDS.cleared };
  if (s.fall) return { id: 'fall', words: WORDS.fall };
  const goal = centreOf(b.goal);
  if (dist(m.x, m.y, goal) <= R.dishR && speedOf(m) <= R.captureSpeed)
    return { id: 'settle', words: isLevel(s) ? WORDS.settleHold : WORDS.settle };
  const cell = cellOf(m.x, m.y);
  const rest = s.restT >= R.restTime;
  const plate = b.plateAt[cell.r][cell.c];
  if (
    plate >= 0 &&
    !((s.open >> plate) & 1) &&
    speedOf(m) <= R.plateSpeed &&
    dist(m.x, m.y, centreOf(cell)) <= R.plateR
  )
    return isLevel(s)
      ? { id: 'plateHold', words: WORDS.plateHold }
      : { id: 'plateLevel', words: WORDS.plateLevel };
  const plan = s.adv.plan;
  if (!plan) {
    if (!rest) return { id: 'hold', words: WORDS.hold };
    return { id: 'nopath', words: isLevel(s) ? WORDS.nopathLevel : WORDS.nopath };
  }
  const blind = isBlind(s);
  // Out of sight the line never reveals which way the plan goes: it asks for a flat board when the
  // marble sits pinned under a full tilt, and otherwise only when the weaker axis strays.
  const off = !blind
    ? Math.abs(plan.dir === 'R' || plan.dir === 'L' ? s.ty : s.tx)
    : s.pinT >= R.pinTime
      ? Math.max(Math.abs(s.tx), Math.abs(s.ty))
      : Math.min(Math.abs(s.tx), Math.abs(s.ty));
  const along = SIGN[plan.dir] * (AXIS[plan.dir] === 'x' ? s.tx : s.ty);
  const guide = { dir: plan.dir, c: plan.c, r: plan.r };
  // A turn needs the tilt at zero (turnTol), tighter than tilt.level, so this line never says "level".
  if (rest && off > R.turnTol) return { id: 'level', words: WORDS.level };
  if (rest && s.adv.block && along < 0.5)
    return blind
      ? { id: 'wait', words: waitBlindWords(s.adv.block) }
      : { id: 'wait', dir: plan.dir, words: waitWords(plan.dir, s.adv.block), guide };
  if (blind) return rest ? { id: 'read', words: WORDS.read } : { id: 'hold', words: WORDS.hold };
  if (along < R.goTilt - 1e-6)
    return { id: 'tilt', dir: plan.dir, words: tiltWords(plan.dir, plan.hint), guide };
  return { id: 'hold', dir: plan.dir, words: WORDS.hold, guide };
}

function think(s) {
  const adv = s.adv;
  const m = s.marble;
  const cell = cellOf(m.x, m.y);
  const rest = s.restT >= R.restTime && !s.menu && !s.fall;
  const plan = adv.plan;
  const pinned = plan && SIGN[plan.dir] * (AXIS[plan.dir] === 'x' ? s.tx : s.ty) >= R.goTilt - 1e-6;
  adv.stuck = rest && pinned ? adv.stuck + R.think * STEP : 0;
  if (rest) {
    const key = `${cell.c},${cell.r},${s.open}`;
    if (!s.seen.has(key)) {
      s.seen.add(key);
      s.progressAt = s.clock;
    }
    if (adv.key !== key) {
      Object.assign(adv, { key, failed: new Set(), stuck: 0, waited: 0 });
      adv.plan = planRoute(s.lab, cell.c, cell.r, s.open);
    } else if (adv.plan && adv.stuck > R.stuckTime) {
      adv.failed.add(adv.plan.dir);
      adv.stuck = 0;
      adv.plan = planRoute(s.lab, cell.c, cell.r, s.open, adv.failed);
      if (!adv.plan) {
        adv.failed.clear();
        adv.plan = planRoute(s.lab, cell.c, cell.r, s.open);
      }
    }
  }
  if (!s.helped && (s.falls > 0 || s.clock - s.progressAt > R.helpStall)) s.helped = true;
  const along = adv.plan ? SIGN[adv.plan.dir] * (AXIS[adv.plan.dir] === 'x' ? s.tx : s.ty) : 0;
  const watching = rest && adv.plan && s.lab.movers.length && along < 0.5 && adv.waited < R.waitMax;
  if (!watching) adv.block = null;
  else if (s.ticks - adv.blockAt >= R.blockEvery) {
    // The blocks move slowly, so looking again every tenth of a second is plenty.
    adv.blockAt = s.ticks;
    adv.block = null;
    for (const lag of R.lags) {
      const mv = blockOnRoll(s, adv.plan, lag);
      if (mv) {
        adv.block = blockArrow(mv);
        break;
      }
    }
  }
  adv.waited = adv.block ? adv.waited + R.think * STEP : adv.waited;
  s.advice = adviceOf(s);
  const words = s.advice.words;
  if (s.line && words[0] === s.line.en) {
    s.line.guide = s.advice.guide || null;
    return;
  }
  // The last word on a lab or a run is never held back.
  const final = s.advice.id === 'cleared' || s.advice.id === 'lost';
  if (s.line && s.line.age < R.promptHold && !final) return;
  s.line = { en: words[0], zh: words[1], age: 0, id: s.advice.id, guide: s.advice.guide || null };
}

// --- Simulation ---

const SURFACES = ['floor', 'ice', 'sand'];

function pointSegmentDistance(p, a, z) {
  const dx = z.x - a.x;
  const dy = z.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

// The hole whose lip the centre of the marble crossed while moving from a to z, if any.
function holeCrossed(b, a, z, reach = R.holeR) {
  const c0 = Math.floor(Math.min(a.x, z.x) / CELL) - 1;
  const c1 = Math.floor(Math.max(a.x, z.x) / CELL) + 1;
  const r0 = Math.floor((Math.min(a.y, z.y) - R.top) / CELL) - 1;
  const r1 = Math.floor((Math.max(a.y, z.y) - R.top) / CELL) + 1;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (b.holeAt[r]?.[c]) {
        const h = centreOf({ c, r });
        if (pointSegmentDistance(h, a, z) < reach) return h;
      }
  return null;
}

function stepTilt(s, keys) {
  const k = STEP;
  if (keys.level) {
    s.tx = Math.sign(s.tx) * Math.max(0, Math.abs(s.tx) - R.easeRate * k);
    s.ty = Math.sign(s.ty) * Math.max(0, Math.abs(s.ty) - R.easeRate * k);
    return;
  }
  s.tx = clamp(s.tx + keys.dx * R.tiltRate * k, -R.maxTilt, R.maxTilt);
  s.ty = clamp(s.ty + keys.dy * R.tiltRate * k, -R.maxTilt, R.maxTilt);
}

function startFall(s, hole, emit) {
  s.fall = { t: 0, hole, x: s.marble.x, y: s.marble.y };
  s.lives--;
  s.falls++;
  s.stats.falls++;
  emit('hit');
}

function endFall(s) {
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  const p = centreOf(s.check);
  Object.assign(s, {
    marble: { x: p.x, y: p.y, vx: 0, vy: 0 },
    tx: 0,
    ty: 0,
    fall: null,
    restT: 0,
  });
  s.adv.key = '';
  s.adv.plan = null;
  say(s, 'Back at the checkpoint', '回到检查点');
}

function closeGates(s) {
  const b = s.lab;
  for (let id = 0; id < 3; id++) {
    if (!s.timedFor[id] || !((s.open >> id) & 1)) continue;
    s.timers[id] = Math.max(0, s.timers[id] - STEP);
    if (s.timers[id] > 0) continue;
    const m = s.marble;
    const near = b.gates.some(
      (g) =>
        g.id === id &&
        Math.hypot(
          m.x - clamp(m.x, g.c * CELL, (g.c + 1) * CELL),
          m.y - clamp(m.y, R.top + g.r * CELL, R.top + (g.r + 1) * CELL),
        ) <
          R.radius + 1,
    );
    if (!near) {
      s.open &= ~(1 << id);
      s.adv.key = '';
    }
  }
}

function sensors(s, emit) {
  const b = s.lab;
  const m = s.marble;
  const slow = speedOf(m) <= R.plateSpeed && isLevel(s);
  for (const p of b.plates) {
    const near = slow && dist(m.x, m.y, centreOf(p)) <= R.plateR;
    s.dwell[p.gate] = near ? s.dwell[p.gate] + STEP : 0;
    if (s.dwell[p.gate] < R.plateTime) continue;
    s.dwell[p.gate] = 0;
    if (!((s.open >> p.gate) & 1)) {
      s.open |= 1 << p.gate;
      s.stats.plates++;
      s.adv.key = '';
      emit('coin');
      say(s, 'Plate pressed: a gate opened', '压力板触发：闸门已打开');
    }
    if (s.timedFor[p.gate]) s.timers[p.gate] = s.timedFor[p.gate];
  }
  const here = cellOf(m.x, m.y);
  const known = b.checkpoints.find((c) => c.c === here.c && c.r === here.r);
  if (known && s.check !== known) {
    s.check = known;
    emit('move');
    say(s, 'Checkpoint saved', '检查点已保存');
  }
  const settling =
    dist(m.x, m.y, centreOf(b.goal)) <= R.settleR && speedOf(m) <= R.settleSpeed && isLevel(s);
  s.settleT = settling ? s.settleT + STEP : 0;
  if (s.settleT >= R.settleTime) clearLab(s, emit);
}

function clearLab(s, emit) {
  const left = Math.max(0, Math.round((s.lab.par - s.clock) * R.parScore));
  const gained = R.clearScore + s.lives * R.lifeScore + left;
  s.best[s.level] = Math.max(s.best[s.level], gained);
  s.score = s.best.reduce((a, v) => a + v, 0);
  saveUnlocked(s.progress, Math.min(LAB_COUNT, s.level + 2));
  s.stats.cleared++;
  s.settleT = 0;
  emit('coin');
  if (s.level === LAB_COUNT - 1) {
    s.phase = 'won';
    return;
  }
  s.pending = s.level + 1;
  s.freeze = R.clearPause;
  think(s);
}

function rollStep(s, emit) {
  const b = s.lab;
  const m0 = s.marble;
  const cell = cellOf(m0.x, m0.y);
  const fric = R.rollFriction[SURFACES[b.surface[cell.r][cell.c]]];
  let ax = R.gravity * Math.sin(s.tx * RAD);
  let ay = R.gravity * Math.sin(s.ty * RAD);
  const goal = centreOf(b.goal);
  if (dist(m0.x, m0.y, goal) < R.dishR) {
    ax += R.dishK * (goal.x - m0.x);
    ay += R.dishK * (goal.y - m0.y);
  }
  const m1 = stepMarble(m0, ax, ay, fric, STEP, s.world);
  s.marble = { x: m1.x, y: m1.y, vx: m1.vx, vy: m1.vy };
  if (m1.mover >= 0 && m1.impact > 20 && s.ticks - s.blockTick > 60) {
    s.blockTick = s.ticks;
    s.stats.blocks++;
  }
  if (m1.impact > 60 && s.ticks - s.hitTick > 60) {
    s.hitTick = s.ticks;
    s.stats.bounces++;
    emit('move');
  }
  // A marble creeping onto the drawn rim (one pixel past the hole) cannot balance there and tips in.
  const hole = holeCrossed(
    b,
    m0,
    s.marble,
    speedOf(s.marble) <= R.lipSpeed ? R.holeR + 1 : R.holeR,
  );
  if (hole) startFall(s, hole, emit);
}

function tick(s, keys, emit) {
  s.ticks++;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.line) s.line.age += STEP;
  if (s.pending !== null) {
    s.freeze -= STEP;
    if (s.freeze <= 0) loadLab(s, s.pending);
    else if (s.ticks % R.think === 0) think(s);
    return;
  }
  s.clock += STEP;
  s.world.movers = s.lab.movers.map((mv) => moverAt(mv, s.clock));
  closeGates(s);
  if (s.fall) {
    s.fall.t += STEP;
    if (s.fall.t >= R.fall) endFall(s);
  } else {
    stepTilt(s, keys);
    rollStep(s, emit);
    s.restT = speedOf(s.marble) < R.restSpeed ? s.restT + STEP : 0;
    const pinned =
      speedOf(s.marble) < R.pinSpeed && Math.max(Math.abs(s.tx), Math.abs(s.ty)) >= R.goTilt - 1e-6;
    s.pinT = pinned ? s.pinT + STEP : 0;
    if (!s.fall) sensors(s, emit);
  }
  if (s.ticks % R.think === 0 || s.phase !== 'playing') think(s);
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * MENU_COLS, 1, m.unlocked);
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (input.pressed('Space', 'Enter')) {
    loadLab(s, sel - 1);
    emit('move');
  }
}

const keysOf = (input) => ({
  dx: (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0),
  dy: (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0),
  level: input.held('Space'),
});

const NO_KEYS = Object.freeze({ dx: 0, dy: 0, level: false });
const NO_INPUT = Object.freeze({ held: () => false, pressed: () => false });

export function advance(s, dt, pad, emit = () => {}) {
  const input = pad ?? NO_INPUT;
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > R.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    think(s);
    return true;
  }
  const held = keysOf(input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  // Input is dead while the marble falls or a clear is pausing, judged at every step so the
  // outcome never depends on how the steps were grouped into frames.
  for (let n = 0; n < steps && s.phase === 'playing'; n++)
    tick(s, s.pending !== null || s.fall ? NO_KEYS : held, emit);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        emit(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t('Every lab is cleared. The marble is home!', '所有实验都完成了，弹珠安然到家！')
            : env.t('The marble ran out of lives. Try again!', '弹珠的生命用完了，再试一次！'),
        });
      }
    },
    draw(ctx) {
      drawGame(ctx, s, env);
    },
    getState() {
      return snapshotOf(s);
    },
  };
}

// --- Snapshot ---

export function snapshotOf(s) {
  const b = s.lab;
  const m = s.marble;
  const finished = s.phase !== 'playing';
  const line = s.line || { en: '', zh: '', guide: null };
  const goal = centreOf(b.goal);
  const label = (lang) =>
    s.menu
      ? line[lang]
      : `${lang === 'en' ? 'Lab' : '实验'} ${s.level + 1}/${LAB_COUNT} ${lang === 'en' ? b.name[0] : b.name[1]} · ${line[lang]}`;
  return {
    phase: s.phase,
    score: s.score,
    time: s.clock,
    level: s.level + 1,
    levels: LAB_COUNT,
    labName: { en: b.name[0], zh: b.name[1] },
    par: b.par,
    lives: s.lives,
    marble: { x: m.x, y: m.y, vx: m.vx, vy: m.vy, speed: speedOf(m) },
    tilt: { x: s.tx, y: s.ty, level: isLevel(s) },
    resting: s.restT >= R.restTime,
    falling: s.fall ? { t: s.fall.t, x: s.fall.hole.x, y: s.fall.hole.y } : null,
    checkpoint: { ...s.check },
    goal: { c: b.goal.c, r: b.goal.r, x: goal.x, y: goal.y, settle: s.settleT / R.settleTime },
    gates: [0, 1, 2]
      .filter((id) => b.gates.some((g) => g.id === id))
      .map((id) => ({
        id,
        open: Boolean((s.open >> id) & 1),
        timer: s.timers[id],
        total: s.timedFor[id],
      })),
    plates: b.plates.map((p) => ({
      c: p.c,
      r: p.r,
      gate: p.gate,
      charge: (s.open >> p.gate) & 1 ? 0 : Math.min(1, s.dwell[p.gate] / R.plateTime),
    })),
    movers: s.world.movers.map((mv) => ({
      x: mv.x0,
      y: mv.y0,
      w: mv.x1 - mv.x0,
      h: mv.y1 - mv.y0,
    })),
    prompt: { en: line.en, zh: line.zh, id: line.id || null },
    line: { en: line.en, zh: line.zh },
    guide: finished || !line.guide ? null : { ...line.guide },
    routeHint: !isBlind(s),
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
    falls: s.falls,
    hud: { top: [0, R.top], bottom: [R.top + R.rows * CELL, 320] },
    status: finished
      ? s.phase === 'won'
        ? { en: `All labs cleared! Score ${s.score}`, zh: `全部实验完成！得分 ${s.score}` }
        : { en: `Out of lives. Score ${s.score}`, zh: `生命用完。得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const PALETTE = {
  floorA: '#24384c',
  floorB: '#21334a',
  wallTop: '#9fb4c8',
  wall: '#62768c',
  wallShade: '#34445a',
  hole: '#05080d',
  holeRim: '#0d1a2a',
  ice: '#a8e4f6',
  iceLine: '#e8fbff',
  sand: '#bf9c62',
  sandDot: '#9a7a44',
  gate: ['#ff6b5b', '#4fd1ff', '#ffd447'],
  goal: '#ffe066',
};

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// 3 x 5 letters A, B, C: each plate and its gate carry the same one, so the pairing never relies on colour.
const MARKS = [
  ['.#.', '#.#', '###', '#.#', '#.#'],
  ['##.', '#.#', '##.', '#.#', '##.'],
  ['.##', '#..', '#..', '#..', '.##'],
];
const PADLOCK = [
  '..###..',
  '.#...#.',
  '.#...#.',
  '#######',
  '#######',
  '###.###',
  '#######',
  '#######',
];

function bitmap(ctx, rows, color, x, y, scale = 1) {
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '#') box(ctx, color, x + i * scale, y + j * scale, scale, scale);
    }),
  );
}

function disc(ctx, color, cx, cy, r) {
  ctx.fillStyle = color;
  const x = Math.round(cx);
  const y = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    ctx.fillRect(x - w, y + dy, 2 * w + 1, 1);
  }
}

function drawFloor(ctx, b) {
  for (let r = 0; r < R.rows; r++)
    for (let c = 0; c < R.cols; c++) {
      const x = c * CELL;
      const y = R.top + r * CELL;
      if (b.wall[r][c]) {
        box(ctx, PALETTE.wall, x, y, CELL, CELL);
        box(ctx, PALETTE.wallTop, x, y, CELL, 2);
        box(ctx, PALETTE.wallTop, x, y, 2, CELL);
        box(ctx, PALETTE.wallShade, x, y + CELL - 2, CELL, 2);
        box(ctx, PALETTE.wallShade, x + CELL - 2, y, 2, CELL);
        continue;
      }
      const kind = b.surface[r][c];
      box(
        ctx,
        kind === 1
          ? PALETTE.ice
          : kind === 2
            ? PALETTE.sand
            : (r + c) % 2
              ? PALETTE.floorA
              : PALETTE.floorB,
        x,
        y,
        CELL,
        CELL,
      );
      if (kind === 1) {
        box(ctx, PALETTE.iceLine, x + 3, y + 4, 6, 1);
        box(ctx, PALETTE.iceLine, x + 8, y + 10, 5, 1);
      } else if (kind === 2) {
        box(ctx, PALETTE.sandDot, x + 3, y + 3, 2, 2);
        box(ctx, PALETTE.sandDot, x + 10, y + 7, 2, 2);
        box(ctx, PALETTE.sandDot, x + 5, y + 12, 2, 2);
      }
    }
}

function drawFeatures(ctx, s, b) {
  for (const h of b.holes) {
    disc(ctx, PALETTE.holeRim, h.x, h.y, R.holeR + 1);
    disc(ctx, PALETTE.hole, h.x, h.y, R.holeR);
  }
  const goal = centreOf(b.goal);
  disc(ctx, '#7a5c14', goal.x, goal.y, R.dishR);
  disc(ctx, '#2a1d05', goal.x, goal.y, R.dishR - 3);
  disc(ctx, PALETTE.goal, goal.x, goal.y, 2);
  for (const p of b.plates) {
    const on = (s.open >> p.gate) & 1;
    const c = centreOf(p);
    disc(ctx, PALETTE.gate[p.gate], c.x, c.y, R.plateR - 1);
    disc(ctx, on ? '#f4fff0' : '#16212e', c.x, c.y, R.plateR - 4);
    bitmap(ctx, MARKS[p.gate], on ? '#16212e' : '#f4fff0', c.x - 1, c.y - 2);
    const charge = on ? 0 : Math.min(1, s.dwell[p.gate] / R.plateTime);
    if (charge > 0) box(ctx, '#7dff9a', c.x - 6, c.y + R.plateR - 3, Math.round(12 * charge), 2);
  }
  for (const g of b.gates) {
    const open = (s.open >> g.id) & 1;
    const x = g.c * CELL;
    const y = R.top + g.r * CELL;
    if (open) {
      box(ctx, PALETTE.gate[g.id], x, y, CELL, 2);
      box(ctx, PALETTE.gate[g.id], x, y + CELL - 2, CELL, 2);
      const total = s.timedFor[g.id];
      bitmap(ctx, MARKS[g.id], PALETTE.gate[g.id], x + 6, y + 3);
      if (total) {
        // A fuse that burns down across the doorway; it blinks in the last five seconds.
        const left = s.timers[g.id] / total;
        const late = s.timers[g.id] < 5 && Math.floor(s.ticks / 30) % 2 === 0;
        box(ctx, '#0b1018', x, y + 9, CELL, 4);
        box(
          ctx,
          late ? '#ff6b5b' : PALETTE.gate[g.id],
          x + 1,
          y + 10,
          Math.round((CELL - 2) * left),
          2,
        );
      }
    } else {
      box(ctx, '#1b1f2a', x, y, CELL, CELL);
      for (let i = 0; i < CELL; i += 4) box(ctx, PALETTE.gate[g.id], x + i, y + 1, 2, CELL - 2);
      box(ctx, '#1b1f2a', x + 3, y + 2, 9, 12);
      bitmap(ctx, MARKS[g.id], '#f4fff0', x + 5, y + 3, 2);
    }
  }
  for (let r = 0; r < R.rows; r++)
    for (let c = 0; c < R.cols; c++) {
      const f = b.flapAt[r][c];
      if (f) drawFlap(ctx, c, r, f);
    }
  for (const k of b.checkpoints) {
    const c = centreOf(k);
    box(ctx, '#d8e4f0', c.x - 4, c.y - 6, 1, 12);
    if (s.check.c === k.c && s.check.r === k.r) box(ctx, '#7dff9a', c.x - 3, c.y - 6, 6, 4);
    else {
      // A saved flag is solid; the others are only outlines.
      box(ctx, '#6a8aa6', c.x - 3, c.y - 6, 6, 1);
      box(ctx, '#6a8aa6', c.x - 3, c.y - 3, 6, 1);
      box(ctx, '#6a8aa6', c.x - 3, c.y - 6, 1, 4);
      box(ctx, '#6a8aa6', c.x + 2, c.y - 6, 1, 4);
    }
  }
  for (const m of s.world.movers) {
    box(ctx, '#2a2118', m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
    for (let i = 0; i < m.x1 - m.x0 + m.y1 - m.y0; i += 6)
      box(ctx, '#ff9a3c', m.x0 + Math.min(i, m.x1 - m.x0 - 2), m.y0 + 2, 2, m.y1 - m.y0 - 4);
  }
}

function drawFlap(ctx, c, r, dir) {
  const cx = cellX(c);
  const cy = cellY(r);
  const f = flapSegment(c, r, dir);
  if (f.axis === 'y') box(ctx, '#d9b25f', f.lo + 1, f.at - 1, CELL - 2, 2);
  else box(ctx, '#d9b25f', f.at - 1, f.lo + 1, 2, CELL - 2);
  const [dc, dr] = DIRS[dir];
  for (const o of [-3, 0, 3]) {
    box(ctx, '#ffe9a8', cx + dc * 4 + dr * o - 1, cy + dr * 4 + dc * o - 1, 2, 2);
  }
}

function drawTiltShade(ctx, s) {
  const bands = [
    [s.tx, 'x', 1],
    [-s.tx, 'x', -1],
    [s.ty, 'y', 1],
    [-s.ty, 'y', -1],
  ];
  ctx.fillStyle = '#000';
  for (const [t, axis, side] of bands) {
    const w = Math.round((Math.max(0, t) / R.maxTilt) * 14);
    for (let i = 0; i < w; i += 2) {
      ctx.globalAlpha = 0.28 * (1 - i / 14);
      const bottom = R.top + R.rows * CELL;
      if (axis === 'x') ctx.fillRect(side > 0 ? 480 - i - 2 : i, R.top, 2, bottom - R.top);
      else ctx.fillRect(0, side > 0 ? bottom - i - 2 : R.top + i, 480, 2);
    }
  }
  ctx.globalAlpha = 1;
}

function drawMarble(ctx, s) {
  const m = s.marble;
  let x = m.x;
  let y = m.y;
  let rad = R.radius;
  if (s.fall) {
    const k = Math.min(1, s.fall.t / R.fall);
    x = s.fall.x + (s.fall.hole.x - s.fall.x) * k;
    y = s.fall.y + (s.fall.hole.y - s.fall.y) * k;
    rad = Math.max(1, Math.round(R.radius * (1 - k)));
  }
  const lx = Math.round(s.tx / 3);
  const ly = Math.round(s.ty / 3);
  ctx.globalAlpha = 0.45;
  disc(ctx, '#000', x + 2 + lx, y + 2 + ly, rad);
  ctx.globalAlpha = 1;
  disc(ctx, '#4f86a8', x, y, rad);
  disc(ctx, '#bfe9ff', x - 1, y - 1, Math.max(1, rad - 1));
  if (rad > 2) box(ctx, '#ffffff', x - 2 - lx, y - 2 - ly, 2, 2);
}

// Pixels from the marble centre to the first wall or hole lip straight ahead (capped at 40).
function freeAhead(s, dc, dr) {
  const b = s.lab;
  for (let d = 0; d < 40; d += 1) {
    const x = s.marble.x + dc * d;
    const y = s.marble.y + dr * d;
    const at = cellOf(x, y);
    if (b.wall[at.r][at.c] || b.holeAt[at.r][at.c]) return d - R.radius;
  }
  return 40;
}

function drawGuide(ctx, s) {
  const g = s.line?.guide;
  if (!g || s.fall || s.pending !== null) return;
  const t = centreOf(g);
  box(ctx, '#ffe066', t.x - 7, t.y - 7, 14, 1);
  box(ctx, '#ffe066', t.x - 7, t.y + 6, 14, 1);
  box(ctx, '#ffe066', t.x - 7, t.y - 7, 1, 14);
  box(ctx, '#ffe066', t.x + 6, t.y - 7, 1, 14);
  const [dc, dr] = DIRS[g.dir];
  const bob = Math.round(Math.sin(s.ticks / 24) * 2);
  // The arrow floats ahead of the marble but only over open floor: never on a wall or a hole.
  const reach = Math.min(16 + bob, freeAhead(s, dc, dr) - 8);
  if (reach < 14) return;
  const ax = s.marble.x + dc * reach;
  const ay = s.marble.y + dr * reach;
  for (let i = 0; i < 8; i += 2) box(ctx, '#ffe066', ax - dc * i - 1, ay - dr * i - 1, 3, 3);
  for (const o of [-3, -2, -1, 0, 1, 2, 3]) {
    const back = 3 - Math.abs(o);
    box(ctx, '#ffe066', ax + dc * (back + 3) + dr * o, ay + dr * (back + 3) + dc * o, 1, 1);
  }
}

function drawHud(ctx, s, env) {
  const b = s.lab;
  box(ctx, '#070b1f', 0, 0, 480, R.top);
  text(
    ctx,
    `${env.t('Lab', '实验')} ${s.level + 1}/${LAB_COUNT} ${env.t(...b.name)}`,
    6,
    3,
    '#9fb0ec',
    14,
  );
  for (let i = 0; i < R.lives; i++) {
    // A spent life is a hollow ring, a spare one a solid marble.
    if (i < s.lives) disc(ctx, '#bfe9ff', 440 + i * 14, 11, 5);
    else {
      disc(ctx, '#4a5578', 440 + i * 14, 11, 5);
      disc(ctx, '#070b1f', 440 + i * 14, 11, 3);
    }
  }
  const line = env.t(s.line.en, s.line.zh);
  text(ctx, line, 240, 23, '#ffffff', 14, 'center');
  const bottom = R.top + R.rows * CELL;
  box(ctx, '#070b1f', 0, bottom, 480, 320 - bottom);
  const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  text(
    ctx,
    `${env.t('Tilt', '倾角')} ${fmt(s.tx)} ${fmt(s.ty)}`,
    6,
    bottom + 4,
    isLevel(s) ? '#7dff9a' : '#cfd6ea',
    14,
  );
  if (s.msg) text(ctx, env.t(s.msg.en, s.msg.zh), 474, bottom + 4, '#ffe066', 14, 'right');
  else {
    const unit = env.t('s', '秒');
    text(
      ctx,
      `${s.clock.toFixed(1)}${unit} / ${b.par}${unit}`,
      474,
      bottom + 4,
      '#cfd6ea',
      14,
      'right',
    );
  }
}

function drawMenu(ctx, s, env) {
  background(ctx, '#070b1f');
  text(ctx, env.t('TILT LAB', '倾斜实验室'), 240, 14, '#ffe066', 16, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 1; i <= LAB_COUNT; i++) {
    const x = 20 + ((i - 1) % MENU_COLS) * 40;
    const y = 60 + Math.floor((i - 1) / MENU_COLS) * 44;
    const open = i <= unlocked;
    box(ctx, i === sel ? '#ffe066' : '#3a4258', x - 2, y - 2, 36, 36);
    box(ctx, open ? '#262c3e' : '#14171f', x, y, 32, 32);
    if (open) text(ctx, String(i), x + 16, y + 9, '#ffffff', 14, 'center');
    else bitmap(ctx, PADLOCK, '#6b7490', x + 9, y + 8, 2);
  }
  const b = LABS[sel - 1];
  text(ctx, `${sel}/${LAB_COUNT}  ${env.t(...b.name)}`, 240, 170, '#ffffff', 16, 'center');
  text(ctx, env.t(...b.tip), 240, 200, '#8d9ac4', 14, 'center');
  if (unlocked < LAB_COUNT)
    text(
      ctx,
      env.t('Padlock: clear the earlier labs first', '挂锁：先完成前面的实验'),
      240,
      240,
      '#8d9ac4',
      14,
      'center',
    );
  text(ctx, env.t(...WORDS.menu), 240, 270, '#cfd6ea', 14, 'center');
}

function drawGame(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  background(ctx, '#05080d');
  drawFloor(ctx, s.lab);
  drawFeatures(ctx, s, s.lab);
  drawGuide(ctx, s);
  drawMarble(ctx, s);
  drawTiltShade(ctx, s);
  drawHud(ctx, s, env);
}
