import { clamp, background, drawPixelText as text } from '../shared/utils.js';

export const meta = {
  id: 'echo-hunter',
  name: { en: 'Echo Hunter', zh: '回声猎手' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Recover the glow beetles carrying the beacons through twenty dark caverns. You see only a small lamp circle, so press Space to ping: a sonar ring spreads out, and everything it reaches leaves a hollow outline that fades after 5 seconds. An outline shows where the thing WAS, not where it is, and its arrow shows which way it was walking. Walk to where it is heading and press X to swing the net. Pings are loud: gloom crawlers within walking distance (the dashed outer ring is the farthest reach) rush to the spot you pinged, and a touch costs 1 HP. A red dotted ring warns when a crawler is within 100 px, even in the dark. Each ping fills the Noise meter; when it reaches 3 the cave is roused and every crawler hears every ping and runs far faster. The net needs a located target: only a beetle whose outline is on screen can be netted, and the ring freezes what it reaches for 4 seconds. A missed net startles nearby beetles. Each cavern draws a different lane for every beetle. Sonar needs 2.5 seconds to recharge and each cavern gives a limited number of pings. The first caverns teach one idea at a time; your progress is saved, so you can continue or pick any cavern you have reached.',
    zh: '在二十个黑暗洞穴中回收背着信标的萤甲虫。你只能看到身边一小圈灯光，所以按空格发射声呐：声呐环向外扩散，碰到的东西会留下空心轮廓，5秒后消失。轮廓表示它“曾经”所在的位置，而不是现在的位置，箭头表示它当时的行进方向。走到它前进的方向，按X挥网捕捉。声呐很响：步行距离内（虚线外环是最远范围）的暗影爬虫会冲向你发射声呐的地点，被碰到会失去1点生命。红色点状圆环会在爬虫进入100像素内时示警，即使在黑暗中。每次声呐都会填充噪音条，满3格时洞穴被惊动，所有爬虫都能听到每次声呐并且跑得快得多。网需要已定位的目标：只有轮廓还在屏幕上的萤甲虫才能被网住，声呐环扫到的目标会被冻住4秒。网扑空会惊吓附近的萤甲虫。每个洞穴里每只萤甲虫的路线都不同。声呐需要2.5秒冷却，每个洞穴的声呐次数有限。前几个洞穴一次只教一个要点；进度会自动保存，可以继续或选择已到达的洞穴。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'WASD / Arrows' },
    { label: { en: 'Sonar ping (2.5 s recharge)', zh: '发射声呐（冷却2.5秒）' }, keys: 'Space' },
    { label: { en: 'Swing the net', zh: '挥网捕捉' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Ping', '声呐', 'right'],
    ['KeyX', 'Net', '捕网', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
export const TILE = 16;
export const COLS = 30;
export const ROWS = 16;
export const TOP = 30; // canvas rows above are the HUD band
const BOTTOM = TOP + ROWS * TILE; // canvas rows below are the prompt band
export const PLAYER_HALF = 6;
export const PLAYER_SPEED = 90;
export const LIGHT_R = 30; // the lamp: live things inside are drawn where they really are
export const PING_CD = 2.5;
export const SONAR_CAP = 9;
export const PING_CD_ROUSED = 5; // a roused cave makes the sonar recharge twice as slowly (the meter shows it)
export const RING_SPEED = 180;
export const REVEAL_R = 120; // the bright ring reveals up to here
export const NOISE_R = 150; // the dashed outer ring: tunnel distance within which threats hear a ping
export const MARK_LIFE = 5; // remembered outlines fade out after this many seconds
export const NET_R = 28; // smaller than the lamp: whatever the net can hit is lit
export const NET_TIME = 0.25;
export const NET_CD = 1.5;
export const STARTLE_R = 110; // a missed swing scares beetles this close
export const STARTLE_TIME = 2.5;
const STARTLE_MULT = 2.2;
export const STUN_TIME = 4; // a beetle the sonar ring reaches freezes this long (its outline marks the spot)
export const RUMBLE_R = 100; // a threat this close is felt as a tremor even in the dark
const LATCH_TIME = 2;
export const ALARM_CAP = 4;
export const MAX_HP = 6;
export const INVULN = 2;
export const CONTACT_R = 13;
const ALERT_MULT = 1.3;
const FRONT_WIDTH = RING_SPEED * STEP * 2; // wide enough that a mover walking into the front is never skipped
export const ALARM_MAX = 3; // each ping adds ALARM_PER_PING noise; it drains one point per ALARM_DRAIN seconds
export const ALARM_DRAIN = 8;
export const ALARM_PER_PING = 1.5;
export const ROUSED_MULT = 2.5;
const SEARCH_TIME = 2.5;
const RECOIL_MULT = 1.6; // a threat that touched the player scuttles home this much faster
const PROMPT_HOLD = 0.55;
const MSG_TIME = 1.8;
const LESSON_TIME = 5; // a teaching cavern states its one idea for this long
const SKIP_LEVELS = 5; // Up/Down on the cavern chooser moves this many caverns
const DENIED_FLASH = 0.6; // the Sonar meter flashes red for this long after a refused ping
const CLEAR_TIME = 2;
const CLEAR_HEAL = 2;
const RAYS = 120;
const BEACON_SCORE = 100;
const CAVERN_SCORE = 150;
const HP_SCORE = 100;

const route = (mode, speed, pause, ...pts) => ({ mode, speed, pause, pts });
// A beetle's lane is drawn at the start of every cavern from its authored variants (plus a random
// start point and direction), so no run's lanes can be memorised.
const lanes = (...variants) => ({ variants });
export const CAVERNS = [
  {
    id: 'warm-echo',
    name: { en: 'Warm Echo', zh: '暖光回声' },
    lesson: {
      en: 'Space pings: rings leave beetle outlines',
      zh: '空格发射声呐，让萤甲虫显出轮廓',
    },
    start: [28, 1],
    charges: 9,
    trickle: 12,
    map: [
      '##############################',
      '#...........#................#',
      '#...........#................#',
      '#...........#................#',
      '#...........#................#',
      '#...........#................#',
      '#..###.......................#',
      '#..###......#..........###...#',
      '#...........#.....###..###...#',
      '#...........#.....###........#',
      '#...........#................#',
      '#............................#',
      '#...........#................#',
      '#...........#................#',
      '#...........#................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 20, 0, [3, 4], [8, 4]),
        route('pingpong', 20, 0, [20, 1], [26, 1]),
        route('pingpong', 20, 0, [22, 9], [27, 9]),
      ),
    ],
    threats: [],
  },
  {
    id: 'fading-outlines',
    name: { en: 'Fading Outlines', zh: '渐隐轮廓' },
    lesson: {
      en: 'An outline shows where it WAS: lead its arrow',
      zh: '轮廓是它曾经的位置：按箭头预判',
    },
    start: [28, 1],
    charges: 9,
    trickle: 12,
    map: [
      '##############################',
      '#...............#............#',
      '#.###...........#............#',
      '#.###...###..................#',
      '#.###...###.....#............#',
      '#...............#............#',
      '#...............#............#',
      '#............................#',
      '#####.########.####.##.#######',
      '#...............#............#',
      '#...............#............#',
      '#.........###................#',
      '#.........###...#............#',
      '#.........###...#............#',
      '#............................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 26, 0, [4, 10], [15, 10]),
        route('pingpong', 26, 0, [13, 1], [13, 7]),
        route('pingpong', 26, 0, [18, 11], [28, 11]),
      ),
      lanes(
        route('pingpong', 26, 0, [6, 9], [14, 9]),
        route('pingpong', 26, 0, [17, 1], [24, 1]),
        route('pingpong', 26, 0, [22, 12], [27, 12]),
      ),
    ],
    threats: [],
  },
  {
    id: 'cast-the-net',
    name: { en: 'Cast the Net', zh: '撒网时刻' },
    lesson: { en: 'X swings the net; a miss startles beetles', zh: 'X挥网；扑空会惊吓萤甲虫' },
    start: [28, 1],
    charges: 9,
    trickle: 12,
    map: [
      '##############################',
      '#....................#.......#',
      '#........#...........#.......#',
      '#........#..###..............#',
      '#.##.....#..###......#.......#',
      '#.##.....#..###......#.......#',
      '#........#...........#.......#',
      '#........#...................#',
      '#........#...........#.......#',
      '#........#..##.......#.......#',
      '#..##....#..##.......#.......#',
      '#..##....#...........#.......#',
      '#..##....#...........#.......#',
      '#....................#.......#',
      '#........#...........#.......#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 26, 0, [22, 9], [28, 9]),
        route('pingpong', 26, 0, [10, 11], [20, 11]),
        route('pingpong', 26, 0, [22, 11], [28, 11]),
      ),
      lanes(
        route('pingpong', 26, 0, [4, 4], [8, 4]),
        route('pingpong', 26, 0, [2, 6], [2, 13]),
        route('pingpong', 26, 0, [2, 6], [2, 14]),
      ),
      lanes(
        route('pingpong', 26, 0, [26, 5], [26, 14]),
        route('pingpong', 26, 0, [22, 4], [28, 4]),
        route('pingpong', 26, 0, [22, 2], [28, 2]),
      ),
    ],
    threats: [],
  },
  {
    id: 'first-rumble',
    name: { en: 'First Rumble', zh: '初次震动' },
    lesson: { en: 'Pings are loud: crawlers come to the sound', zh: '声呐很响：爬虫会循声而来' },
    start: [1, 1],
    charges: 9,
    trickle: 12,
    map: [
      '##############################',
      '#....................#.......#',
      '#..........#.................#',
      '#...###....#.........#.......#',
      '#...###....#.................#',
      '#...###..............#.......#',
      '#..........#.........#.......#',
      '#..........#.........#.......#',
      '####.####.####.###.#####.##.##',
      '#............................#',
      '#..........#.........#.......#',
      '#..........#..##.....#..###..#',
      '#..........#..##.....#..###..#',
      '#..........#..##.....#.......#',
      '#............................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 26, 0, [3, 10], [8, 10]),
        route('pingpong', 26, 0, [22, 3], [28, 3]),
        route('pingpong', 26, 0, [13, 4], [24, 4]),
      ),
      lanes(
        route('pingpong', 26, 0, [3, 1], [3, 7]),
        route('pingpong', 26, 0, [3, 9], [3, 14]),
        route('pingpong', 26, 0, [1, 7], [9, 7]),
      ),
    ],
    threats: [route('pingpong', 16, 0, [28, 11], [28, 14])],
  },
  {
    id: 'first-echo',
    name: { en: 'First Echo', zh: '初次回声' },
    start: [14, 6],
    charges: 9,
    trickle: 12,
    map: [
      '##############################',
      '#.....#..............#.......#',
      '#.....#..............#.......#',
      '#.....#...##....##...#.......#',
      '#............##...##.........#',
      '#.....#..............#.......#',
      '#.....#..............#.......#',
      '###.###..............###.#####',
      '#.....#..............#.......#',
      '#.....#...##....##...#.......#',
      '#............##...##.........#',
      '#.....#..............#.......#',
      '#.....#..............#.......#',
      '#.....#..............#.......#',
      '#.....#..............#.......#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 26, 0, [8, 2], [19, 2]),
        route('pingpong', 26, 0, [8, 5], [19, 5]),
        route('pingpong', 26, 0, [8, 12], [19, 12]),
      ),
      lanes(
        route('pingpong', 26, 0, [24, 2], [24, 13]),
        route('pingpong', 26, 0, [21, 4], [28, 4]),
        route('pingpong', 26, 0, [22, 11], [28, 11]),
      ),
    ],
    threats: [route('pingpong', 22, 0, [1, 10], [5, 10])],
  },
  {
    id: 'pillar-walk',
    name: { en: 'Pillar Walk', zh: '石柱漫步' },
    start: [1, 1],
    charges: 8,
    trickle: 14,
    map: [
      '##############################',
      '#..................#.........#',
      '#...##.....#.................#',
      '#...##.............#.........#',
      '#..........#.......#.........#',
      '#..........#.................#',
      '##.######.####.##.####.###.###',
      '#..........#.......#.........#',
      '#..........#.......#.........#',
      '#.....###....................#',
      '#.....###..#...##..#.........#',
      '#..............##..#.....##..#',
      '#..........#.......#.....##..#',
      '#..........#.......#.....##..#',
      '#..........#.................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 28, 0, [12, 12], [18, 12]),
        route('pingpong', 28, 0, [16, 1], [16, 5]),
        route('pingpong', 28, 0, [12, 7], [12, 14]),
      ),
      lanes(
        route('pingpong', 28, 0, [1, 10], [5, 10]),
        route('pingpong', 28, 0, [18, 1], [18, 5]),
        route('pingpong', 28, 0, [3, 9], [3, 14]),
      ),
      lanes(
        route('pingpong', 28, 0, [15, 2], [26, 2]),
        route('pingpong', 28, 0, [6, 1], [6, 5]),
        route('pingpong', 28, 0, [4, 13], [10, 13]),
      ),
    ],
    threats: [route('pingpong', 20, 0, [24, 9], [24, 14])],
  },
  {
    id: 'twin-halls',
    name: { en: 'Twin Halls', zh: '双厅' },
    start: [28, 14],
    charges: 9,
    trickle: 14,
    map: [
      '##############################',
      '#................#...........#',
      '#................#...........#',
      '#...................###......#',
      '#................#..###......#',
      '#................#...........#',
      '#............................#',
      '##.############.##.####.######',
      '#................#...........#',
      '#................#...........#',
      '#..##....................##..#',
      '#..##.....##.....#..###..##..#',
      '#..##.....##.....#..###......#',
      '#............................#',
      '#................#...........#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 30, 0, [18, 7], [18, 12]),
        route('pingpong', 30, 0, [18, 3], [18, 13]),
        route('pingpong', 30, 0, [24, 9], [24, 14]),
      ),
      lanes(
        route('pingpong', 30, 0, [7, 8], [7, 14]),
        route('pingpong', 30, 0, [5, 8], [5, 14]),
        route('pingpong', 30, 0, [5, 12], [9, 12]),
      ),
      lanes(
        route('pingpong', 30, 0, [16, 8], [16, 14]),
        route('pingpong', 30, 0, [18, 2], [25, 2]),
        route('pingpong', 30, 0, [7, 8], [7, 14]),
      ),
    ],
    threats: [route('pingpong', 20, 0, [5, 1], [5, 5])],
  },
  {
    id: 'crossed-tunnels',
    name: { en: 'Crossed Tunnels', zh: '交错隧道' },
    start: [25, 13],
    charges: 7,
    trickle: 20,
    map: [
      '##############################',
      '#.....#..........#...........#',
      '#.....#..........#...........#',
      '#.....#...####...#...#####...#',
      '#.........#..#.......#...#...#',
      '#.....#...#..#...#...#...#...#',
      '#.....#...####...#.......#...#',
      '###.#####........#####.###...#',
      '#.....#..........#...........#',
      '#.....#..####....#...........#',
      '#.....#..#..#....#...###.#####',
      '#............................#',
      '#.....#..#..#....#...#.......#',
      '#.....#..####....#...#.......#',
      '#.....#..........#...#.......#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 32, 0, [12, 11], [28, 11]),
        route('pingpong', 32, 0, [7, 2], [16, 2]),
        route('pingpong', 32, 0, [18, 2], [28, 2]),
      ),
      lanes(
        route('pingpong', 32, 0, [15, 1], [15, 11]),
        route('pingpong', 32, 0, [19, 1], [19, 6]),
        route('pingpong', 32, 0, [8, 1], [8, 6]),
      ),
      lanes(
        route('pingpong', 32, 1.2, [27, 1], [27, 9]),
        route('pingpong', 32, 1.2, [18, 8], [28, 8]),
        route('pingpong', 32, 1.2, [19, 8], [19, 14]),
      ),
    ],
    threats: [route('pingpong', 22, 0, [1, 13], [5, 13])],
  },
  {
    id: 'echo-chambers',
    name: { en: 'Echo Chambers', zh: '回声腔' },
    start: [1, 1],
    charges: 8,
    trickle: 16,
    map: [
      '##############################',
      '#.......#............#.......#',
      '#............................#',
      '#.......#............#.......#',
      '#.......#....................#',
      '#....................#.......#',
      '##.##.########.##.######.##.##',
      '#.......#............#.......#',
      '#.......#............#.......#',
      '#............................#',
      '#.......#............#..##...#',
      '#..###..#............#..##...#',
      '#..###........###....#..##...#',
      '#.......#.....###............#',
      '#.......#............#.......#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 32, 0, [15, 1], [15, 5]),
        route('pingpong', 32, 0, [28, 7], [28, 14]),
        route('pingpong', 32, 0, [1, 14], [7, 14]),
      ),
      lanes(
        route('pingpong', 32, 0, [12, 1], [12, 5]),
        route('pingpong', 32, 0, [16, 1], [16, 5]),
        route('pingpong', 32, 0, [9, 1], [9, 5]),
      ),
      lanes(
        route('pingpong', 32, 0, [13, 5], [19, 5]),
        route('pingpong', 32, 0, [10, 3], [20, 3]),
        route('pingpong', 32, 0, [7, 5], [14, 5]),
      ),
    ],
    threats: [
      route('pingpong', 20, 0, [24, 1], [27, 1]),
      route('pingpong', 20, 0, [11, 14], [14, 14]),
    ],
  },
  {
    id: 'loop-road',
    name: { en: 'Loop Road', zh: '环路' },
    start: [1, 14],
    charges: 9,
    trickle: 14,
    map: [
      '##############################',
      '#...........#................#',
      '#...........#................#',
      '#...........#.........##.....#',
      '#.##.............##...##.....#',
      '#.##........#....##..........#',
      '#...........#....##..........#',
      '#...........#................#',
      '#............................#',
      '####.#.############.######.###',
      '#............................#',
      '#...........#................#',
      '#...........#......##........#',
      '#..................##........#',
      '#...........#................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 34, 0, [23, 10], [23, 14]),
        route('pingpong', 34, 0, [13, 12], [18, 12]),
        route('pingpong', 34, 0, [15, 10], [15, 14]),
      ),
      lanes(
        route('pingpong', 34, 0, [9, 1], [9, 8]),
        route('loop', 34, 0, [1, 3], [4, 3], [4, 6], [1, 6]),
        route('loop', 34, 0, [18, 11], [21, 11], [21, 14], [18, 14]),
      ),
      lanes(
        route('loop', 34, 0, [1, 3], [4, 3], [4, 6], [1, 6]),
        route('pingpong', 34, 0, [18, 10], [18, 14]),
        route('pingpong', 34, 0, [3, 10], [3, 14]),
      ),
      lanes(
        route('pingpong', 34, 0, [7, 1], [7, 8]),
        route('pingpong', 34, 0, [16, 10], [16, 14]),
        route('pingpong', 34, 0, [1, 10], [1, 14]),
      ),
    ],
    threats: [route('pingpong', 24, 0, [19, 1], [19, 5])],
  },
  {
    id: 'quiet-hunters',
    name: { en: 'Quiet Hunters', zh: '静默猎手' },
    start: [1, 2],
    charges: 8,
    trickle: 16,
    map: [
      '##############################',
      '#.........#........#.........#',
      '#.....##......###........###.#',
      '#.....##..#...###..#.....###.#',
      '#.........#...###..#.........#',
      '#.........#........#.........#',
      '#............................#',
      '#.###.########.##.##.#####.###',
      '#.........#..................#',
      '#..................#.........#',
      '#.........#........#....##...#',
      '#.##......#........#....##...#',
      '#.##...............#....##...#',
      '#.##......#..................#',
      '#.........#........#.........#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 34, 1, [12, 8], [12, 14]),
        route('pingpong', 34, 1, [9, 1], [9, 6]),
        route('pingpong', 34, 1, [4, 13], [9, 13]),
      ),
      lanes(
        route('pingpong', 34, 1, [4, 1], [4, 6]),
        route('pingpong', 34, 1, [7, 8], [7, 14]),
        route('pingpong', 34, 1, [17, 5], [17, 11]),
      ),
      lanes(
        route('pingpong', 34, 1, [18, 8], [18, 14]),
        route('pingpong', 34, 1, [9, 8], [9, 14]),
        route('pingpong', 34, 1, [3, 1], [3, 6]),
      ),
    ],
    threats: [
      route('pingpong', 22, 0, [23, 4], [27, 4]),
      route('pingpong', 22, 0, [23, 14], [27, 14]),
    ],
  },
  {
    id: 'deep-hollow',
    name: { en: 'The Deep Hollow', zh: '深渊空洞' },
    start: [2, 2],
    charges: 6,
    trickle: 20,
    map: [
      '##############################',
      '#............#...............#',
      '#............#...............#',
      '#..####..........####........#',
      '#..#..#..........#..#........#',
      '#..####....####..####....##..#',
      '#..........#..#..............#',
      '######.....#..#.......####.###',
      '#..........####.......#......#',
      '#.....................#......#',
      '#..###...........###..#......#',
      '#..#.#...........#.#..####...#',
      '#..###....#####..###.........#',
      '#.........#...#..............#',
      '#.........#####..............#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('loop', 38, 0, [10, 4], [15, 4], [15, 9], [10, 9]),
        route('loop', 38, 0, [2, 2], [7, 2], [7, 6], [2, 6]),
        route('loop', 38, 0, [16, 2], [21, 2], [21, 6], [16, 6]),
      ),
      lanes(
        route('pingpong', 38, 0, [1, 9], [21, 9]),
        route('pingpong', 38, 0, [15, 6], [28, 6]),
        route('pingpong', 38, 0, [1, 6], [10, 6]),
      ),
      lanes(
        route('pingpong', 38, 0, [10, 3], [16, 3]),
        route('pingpong', 38, 0, [8, 3], [8, 6]),
        route('pingpong', 38, 0, [4, 2], [12, 2]),
      ),
      lanes(
        route('pingpong', 38, 1, [14, 1], [28, 1]),
        route('pingpong', 38, 1, [1, 1], [12, 1]),
        route('pingpong', 38, 1, [21, 3], [28, 3]),
      ),
    ],
    threats: [
      route('pingpong', 26, 0, [3, 13], [8, 13]),
      route('pingpong', 26, 0, [21, 14], [28, 14]),
    ],
  },
  {
    id: 'whisper-maze',
    name: { en: 'Whisper Maze', zh: '低语迷宫' },
    start: [1, 13],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#.........#.........#........#',
      '#..###..............#........#',
      '#..###....#..###.............#',
      '#..###....#..###....#........#',
      '#...................#........#',
      '#.........#..................#',
      '###.####.###.####.####.##.####',
      '#...................#........#',
      '#.........#.........#........#',
      '#.........#...##.............#',
      '#.........#...##....#........#',
      '#....###............#........#',
      '#....###..#.........#........#',
      '#.........#..................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 36, 0, [9, 8], [9, 14]),
        route('pingpong', 36, 0, [19, 8], [19, 14]),
        route('pingpong', 36, 0, [1, 14], [9, 14]),
      ),
      lanes(
        route('pingpong', 36, 0, [2, 6], [7, 6]),
        route('pingpong', 36, 0, [9, 1], [9, 6]),
        route('pingpong', 36, 0, [4, 8], [4, 14]),
      ),
      lanes(
        route('pingpong', 36, 0, [1, 9], [9, 9]),
        route('pingpong', 36, 0, [11, 8], [11, 13]),
        route('pingpong', 36, 0, [11, 1], [16, 1]),
      ),
      lanes(
        route('pingpong', 36, 0, [2, 5], [9, 5]),
        route('pingpong', 36, 0, [11, 13], [19, 13]),
        route('pingpong', 36, 0, [1, 10], [9, 10]),
      ),
    ],
    threats: [
      route('pingpong', 24, 0, [23, 1], [27, 1]),
      route('pingpong', 24, 0, [28, 10], [28, 13]),
    ],
  },
  {
    id: 'long-corridors',
    name: { en: 'Long Corridors', zh: '长廊' },
    start: [12, 1],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#..............#.............#',
      '#....##......................#',
      '#....##........#.............#',
      '#..............#.............#',
      '#............................#',
      '#####.######.#####.#########.#',
      '#..............#.............#',
      '#..............#.............#',
      '#......###.....#.....##......#',
      '#......###...........##......#',
      '#......###.....#.....##..##..#',
      '#.##.....................##..#',
      '#.##...........#.........##..#',
      '#..............#.............#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 36, 0, [2, 1], [2, 5]),
        route('loop', 36, 0, [4, 1], [7, 1], [7, 4], [4, 4]),
        route('pingpong', 36, 0, [19, 1], [19, 5]),
      ),
      lanes(
        route('pingpong', 36, 0, [23, 1], [23, 5]),
        route('pingpong', 36, 0, [9, 1], [9, 5]),
        route('loop', 36, 0, [4, 1], [7, 1], [7, 4], [4, 4]),
      ),
      lanes(
        route('pingpong', 36, 0, [17, 3], [22, 3]),
        route('pingpong', 36, 0, [7, 3], [14, 3]),
        route('pingpong', 36, 0, [16, 1], [27, 1]),
      ),
      lanes(
        route('pingpong', 36, 0, [7, 1], [7, 5]),
        route('pingpong', 36, 0, [16, 1], [21, 1]),
        route('pingpong', 36, 0, [8, 1], [8, 5]),
      ),
    ],
    threats: [
      route('pingpong', 25, 0, [23, 9], [26, 9]),
      route('pingpong', 25, 0, [1, 8], [1, 12]),
    ],
  },
  {
    id: 'crawler-crossing',
    name: { en: 'Crawler Crossing', zh: '爬虫路口' },
    start: [28, 7],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#.........#..................#',
      '#.........#...##.....#.......#',
      '#.............##.............#',
      '#..###....#..........#..##...#',
      '#..###....#..........#..##...#',
      '#....................#.......#',
      '#.........#..........#.......#',
      '#.###.######.####.######.#.###',
      '#.........#..........#.......#',
      '#....................#.......#',
      '#.........#..................#',
      '#....................#.......#',
      '#.........#..........#.......#',
      '#.........#..................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 36, 0, [17, 3], [17, 14]),
        route('pingpong', 36, 0, [22, 1], [22, 7]),
        route('pingpong', 36, 0, [17, 11], [28, 11]),
      ),
      lanes(
        route('pingpong', 36, 0, [14, 9], [14, 14]),
        route('pingpong', 36, 0, [11, 1], [11, 7]),
        route('pingpong', 36, 0, [19, 9], [19, 14]),
      ),
      lanes(
        route('pingpong', 36, 0, [19, 9], [19, 14]),
        route('pingpong', 36, 0, [11, 9], [17, 9]),
        route('pingpong', 36, 0, [23, 9], [23, 14]),
      ),
      lanes(
        route('pingpong', 36, 0, [13, 1], [13, 7]),
        route('pingpong', 36, 0, [12, 13], [19, 13]),
        route('pingpong', 36, 0, [16, 9], [16, 14]),
      ),
    ],
    threats: [route('pingpong', 22, 0, [2, 11], [2, 14]), route('pingpong', 22, 0, [2, 1], [5, 1])],
  },
  {
    id: 'stone-forest',
    name: { en: 'Stone Forest', zh: '石林' },
    start: [28, 4],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#.................#..........#',
      '#.........#.......#..........#',
      '#.........#...##.........##..#',
      '#...###...#...##..#......##..#',
      '#...###.......##..#..........#',
      '#.........#.......#..........#',
      '#.........#..................#',
      '##.#.######.###.######.####.##',
      '#............................#',
      '#.........#.......#..........#',
      '#.##..............#.....###..#',
      '#.##..##..#.......#.....###..#',
      '#.....##..#.......#..........#',
      '#.........#..................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 38, 0, [13, 9], [13, 14]),
        route('pingpong', 38, 0, [23, 9], [23, 14]),
        route('loop', 38, 0, [13, 2], [16, 2], [16, 6], [13, 6]),
      ),
      lanes(
        route('pingpong', 38, 0, [11, 2], [11, 13]),
        route('pingpong', 38, 0, [19, 6], [28, 6]),
        route('pingpong', 38, 0, [22, 1], [22, 11]),
      ),
      lanes(
        route('loop', 38, 0, [23, 10], [27, 10], [27, 13], [23, 13]),
        route('pingpong', 38, 0, [14, 9], [14, 14]),
        route('loop', 38, 0, [13, 2], [16, 2], [16, 6], [13, 6]),
      ),
      lanes(
        route('loop', 38, 0, [13, 2], [16, 2], [16, 6], [13, 6]),
        route('pingpong', 38, 0, [28, 1], [28, 7]),
        route('pingpong', 38, 0, [21, 9], [21, 14]),
      ),
    ],
    threats: [route('pingpong', 22, 0, [2, 14], [7, 14]), route('pingpong', 22, 0, [1, 1], [1, 4])],
  },
  {
    id: 'narrow-margins',
    name: { en: 'Narrow Margins', zh: '窄道' },
    start: [1, 1],
    charges: 8,
    trickle: 16,
    map: [
      '##############################',
      '#...................#........#',
      '#...###..#..........#........#',
      '#...###..#..........#...##...#',
      '#...###..#...###........##...#',
      '#........#...###....#........#',
      '#............###....#........#',
      '#........#...................#',
      '#........#..........#........#',
      '####.###.###.#.######.#.######',
      '#........#...................#',
      '#...................#........#',
      '#........#..###.....#........#',
      '#........#..###..............#',
      '#...................#........#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 38, 0, [16, 10], [16, 14]),
        route('pingpong', 38, 0, [10, 2], [19, 2]),
        route('pingpong', 38, 0, [19, 10], [19, 14]),
      ),
      lanes(
        route('pingpong', 38, 0, [1, 2], [1, 8]),
        route('pingpong', 38, 0, [4, 5], [4, 10]),
        route('pingpong', 38, 0, [11, 10], [11, 14]),
      ),
      lanes(
        route('pingpong', 38, 0, [1, 10], [1, 14]),
        route('pingpong', 38, 0, [3, 10], [3, 14]),
        route('pingpong', 38, 0, [2, 8], [8, 8]),
      ),
      lanes(
        route('pingpong', 38, 0, [15, 10], [15, 14]),
        route('pingpong', 38, 0, [3, 1], [3, 8]),
        route('pingpong', 38, 0, [4, 7], [4, 13]),
      ),
      lanes(
        route('pingpong', 38, 0, [4, 5], [4, 14]),
        route('pingpong', 38, 0, [1, 10], [1, 14]),
        route('pingpong', 38, 0, [16, 10], [16, 14]),
      ),
    ],
    threats: [
      route('pingpong', 26, 0, [26, 2], [26, 7]),
      route('pingpong', 26, 0, [25, 12], [28, 12]),
    ],
  },
  {
    id: 'thin-air',
    name: { en: 'Thin Air', zh: '稀薄之声' },
    start: [28, 4],
    charges: 6,
    trickle: 16,
    map: [
      '##############################',
      '#............................#',
      '#...........#................#',
      '#....##.....#..##..###.......#',
      '#....##.....#..##..###.......#',
      '#...........#................#',
      '#............................#',
      '####.##.#######.#.############',
      '#............................#',
      '#...........#................#',
      '#..............##............#',
      '#...........#..##........###.#',
      '#...........#..##........###.#',
      '#...........#............###.#',
      '#...........#................#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 38, 1, [1, 12], [11, 12]),
        route('pingpong', 38, 1, [14, 1], [14, 6]),
        route('pingpong', 38, 1, [12, 1], [17, 1]),
      ),
      lanes(
        route('pingpong', 38, 1, [16, 2], [24, 2]),
        route('pingpong', 38, 1, [6, 8], [6, 14]),
        route('pingpong', 38, 1, [2, 10], [8, 10]),
      ),
      lanes(
        route('pingpong', 38, 1, [25, 1], [25, 6]),
        route('pingpong', 38, 1, [1, 9], [11, 9]),
        route('pingpong', 38, 1, [22, 3], [28, 3]),
      ),
      lanes(
        route('pingpong', 38, 1, [18, 5], [28, 5]),
        route('pingpong', 38, 1, [23, 1], [23, 6]),
        route('pingpong', 38, 1, [13, 1], [13, 6]),
      ),
    ],
    threats: [
      route('pingpong', 24, 0, [28, 10], [28, 13]),
      route('pingpong', 24, 0, [8, 1], [8, 4]),
    ],
  },
  {
    id: 'roused-depths',
    name: { en: 'Roused Depths', zh: '惊醒深处' },
    start: [7, 14],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#..........#........#........#',
      '#....##....#..##.........###.#',
      '#....##.......##....#....###.#',
      '#..........#........#....###.#',
      '#............................#',
      '#..........#........#........#',
      '##.####.####.####.######.###.#',
      '#..........#........#........#',
      '#..........#.................#',
      '#.....###...........#........#',
      '#.....###..#........#.....##.#',
      '#.....###..#..............##.#',
      '#..........#........#........#',
      '#...................#........#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('pingpong', 40, 0, [3, 8], [3, 14]),
        route('loop', 40, 0, [24, 1], [28, 1], [28, 5], [24, 5]),
        route('pingpong', 40, 0, [16, 2], [22, 2]),
      ),
      lanes(
        route('pingpong', 40, 0, [1, 13], [10, 13]),
        route('pingpong', 40, 0, [12, 1], [19, 1]),
        route('loop', 40, 0, [24, 1], [28, 1], [28, 5], [24, 5]),
      ),
      lanes(
        route('loop', 40, 0, [5, 9], [9, 9], [9, 13], [5, 13]),
        route('pingpong', 40, 0, [12, 2], [12, 13]),
        route('pingpong', 40, 0, [13, 1], [13, 6]),
      ),
      lanes(
        route('pingpong', 40, 0, [15, 8], [15, 14]),
        route('loop', 40, 0, [24, 1], [28, 1], [28, 5], [24, 5]),
        route('pingpong', 40, 0, [3, 8], [3, 13]),
      ),
      lanes(
        route('pingpong', 40, 0, [19, 9], [19, 14]),
        route('loop', 40, 0, [5, 9], [9, 9], [9, 13], [5, 13]),
        route('loop', 40, 0, [24, 1], [28, 1], [28, 5], [24, 5]),
      ),
    ],
    threats: [
      route('pingpong', 22, 0, [24, 14], [27, 14]),
      route('pingpong', 22, 0, [1, 1], [6, 1]),
    ],
  },
  {
    id: 'last-beacon',
    name: { en: 'The Last Beacon', zh: '最后的信标' },
    start: [1, 14],
    charges: 7,
    trickle: 16,
    map: [
      '##############################',
      '#............................#',
      '#.........#...###..#.........#',
      '#.............###..#.........#',
      '#.........#..................#',
      '#.........#........#.........#',
      '####.##.###.####.####.####.###',
      '#..................#.........#',
      '#.........#........#.........#',
      '#..................#.........#',
      '#...###...#....##............#',
      '#...###...#....##..#...###...#',
      '#.........#....##..#...###...#',
      '#.........#..................#',
      '#.........#........#.........#',
      '##############################',
    ],
    drifters: [
      lanes(
        route('loop', 40, 0, [3, 9], [7, 9], [7, 12], [3, 12]),
        route('pingpong', 40, 0, [20, 7], [20, 14]),
        route('pingpong', 40, 0, [22, 7], [22, 14]),
      ),
      lanes(
        route('loop', 40, 0, [13, 1], [17, 1], [17, 4], [13, 4]),
        route('pingpong', 40, 0, [1, 13], [8, 13]),
        route('pingpong', 40, 0, [20, 7], [20, 14]),
      ),
      lanes(
        route('loop', 40, 0, [13, 1], [17, 1], [17, 4], [13, 4]),
        route('loop', 40, 0, [3, 9], [7, 9], [7, 12], [3, 12]),
        route('pingpong', 40, 0, [17, 1], [17, 5]),
      ),
      lanes(
        route('pingpong', 40, 0, [22, 7], [22, 14]),
        route('pingpong', 40, 0, [2, 7], [2, 14]),
        route('loop', 40, 0, [22, 10], [26, 10], [26, 13], [22, 13]),
      ),
      lanes(
        route('pingpong', 40, 0, [1, 14], [9, 14]),
        route('pingpong', 40, 0, [28, 7], [28, 14]),
        route('pingpong', 40, 0, [8, 7], [8, 14]),
      ),
    ],
    threats: [
      route('pingpong', 22, 0, [1, 2], [5, 2]),
      route('pingpong', 22, 0, [24, 3], [27, 3]),
      route('pingpong', 22, 0, [11, 14], [14, 14]),
    ],
  },
];

// Per cavern: charges at the start, and the seconds one free charge takes to return. The teaching
// caverns are generous on both.
export const SONAR_START = CAVERNS.map((c) => c.charges);
export const SONAR_TRICKLE = CAVERNS.map((c) => c.trickle);

// ------------------------------------------------------------------ geometry

export const solidAt = (map, c, r) => c < 0 || r < 0 || c >= COLS || r >= ROWS || map[r][c] === '#';
export const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor((y - TOP) / TILE)];
export const centerOf = (c, r) => [c * TILE + TILE / 2, TOP + r * TILE + TILE / 2];
const solidPx = (map, x, y) => solidAt(map, ...tileOf(x, y));

function boxBlocked(map, x, y, h) {
  return (
    solidPx(map, x - h, y - h) ||
    solidPx(map, x + h, y - h) ||
    solidPx(map, x - h, y + h) ||
    solidPx(map, x + h, y + h)
  );
}

const CORNER_ASSIST = 8; // px a box may be eased sideways to clear a wall corner it is clipping

// Eases a blocked box along the other axis when a free lane is within CORNER_ASSIST px.
function nudge(map, e, dx, dy, h) {
  const along = dx ? 'y' : 'x',
    move = Math.abs(dx || dy);
  for (let off = 1; off <= CORNER_ASSIST; off++) {
    for (const side of [1, -1]) {
      const px = e.x + dx + (dx ? 0 : side * off),
        py = e.y + dy + (dx ? side * off : 0);
      if (boxBlocked(map, px, py, h)) continue;
      e[along] += side * Math.min(move, off);
      return;
    }
  }
}

// Moves a box one axis at a time so it slides along walls and never enters a solid.
function slide(map, e, dx, dy, h) {
  if (!boxBlocked(map, e.x + dx, e.y, h)) e.x += dx;
  else if (dx) nudge(map, e, dx, 0, h);
  if (!boxBlocked(map, e.x, e.y + dy, h)) e.y += dy;
  else if (dy) nudge(map, e, 0, dy, h);
}

// True when no wall tile lies on the straight segment (sampled every 2 px).
export function lineClear(map, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay),
    n = Math.max(1, Math.ceil(d / 2));
  for (let i = 1; i <= n; i++) {
    if (solidPx(map, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
  }
  return true;
}

function castRay(map, x, y, angle, max) {
  const cx = Math.cos(angle),
    sy = Math.sin(angle);
  for (let d = 2; d <= max; d += 2) if (solidPx(map, x + cx * d, y + sy * d)) return d;
  return max;
}

// Tunnel distance (in tiles, 4-neighbour) from a tile; -1 when unreachable.
export function tunnelDistances(map, c0, r0) {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  if (solidAt(map, c0, r0)) return dist;
  dist[r0 * COLS + c0] = 0;
  const queue = [[c0, r0]];
  for (let q = 0; q < queue.length; q++) {
    const [c, r] = queue[q],
      d = dist[r * COLS + c];
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc,
        nr = r + dr;
      if (solidAt(map, nc, nr) || dist[nr * COLS + nc] >= 0) continue;
      dist[nr * COLS + nc] = d + 1;
      queue.push([nc, nr]);
    }
  }
  return dist;
}

// Tile centres leading downhill on a distance grid from (c, r) to the grid's origin.
export function pathDownhill(dist, c, r) {
  const out = [];
  let d = dist[r * COLS + c];
  while (d > 0) {
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc,
        nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || dist[nr * COLS + nc] !== d - 1) continue;
      c = nc;
      r = nr;
      break;
    }
    out.push(centerOf(c, r));
    d -= 1;
  }
  return out;
}

// ---------------------------------------------------------------- world setup

// Picks a lane variant, maybe runs it backwards, and starts the beetle somewhere along it.
function drawLane(spec, random) {
  const lane = spec.variants[Math.floor(random() * spec.variants.length)],
    pts = random() < 0.5 ? [...lane.pts].reverse() : lane.pts,
    legs = lane.mode === 'loop' ? pts.length : pts.length - 1,
    s0 = Math.floor(random() * legs),
    [a, b] = [pts[s0], pts[(s0 + 1) % pts.length]],
    t = random();
  return {
    lane,
    pts,
    start: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    next: (s0 + 1) % pts.length,
  };
}

function makeMover(spec, id, kind, random) {
  const drawn = spec.variants ? drawLane(spec, random) : null,
    lane = drawn ? drawn.lane : spec,
    pts = (drawn ? drawn.pts : lane.pts).map(([c, r]) => centerOf(c, r)),
    start = drawn ? centerOf(...drawn.start) : pts[0];
  return {
    id,
    kind,
    x: start[0],
    y: start[1],
    pts,
    mode: lane.mode,
    speed: lane.speed,
    pause: lane.pause,
    i: drawn ? drawn.next : 1,
    dir: 1,
    wait: 0,
    hx: 0,
    hy: 0,
    state: 'patrol',
    path: [],
    startle: 0,
    frozen: 0,
  };
}

function loadCavern(w, index) {
  const c = CAVERNS[index],
    [x, y] = centerOf(...c.start);
  w.cavern = index;
  w.map = c.map;
  w.p.x = x;
  w.p.y = y;
  w.p.inv = INVULN;
  w.p.pingCd = 0;
  w.p.pingCdMax = PING_CD;
  w.p.charges = c.charges;
  w.p.chargeT = 0;
  w.p.netT = 0;
  w.p.netCd = 0;
  w.drifters = c.drifters.map((s, n) => makeMover(s, `d${n}`, 'drifter', w.random));
  w.threats = c.threats.map((s, n) => makeMover(s, `t${n}`, 'threat', w.random));
  w.total = w.drifters.length;
  w.beacons = 0;
  w.marks = [];
  w.ring = null;
  w.lastPing = null;
  w.alarm = 0;
  w.msg = c.lesson ? { ...c.lesson } : null;
  w.msgT = c.lesson ? LESSON_TIME : 0;
  w.promptKey = 'start';
  w.promptT = 0;
  w.latch = { danger: 0, roused: 0 };
  w.dangerKey = null;
  w.dangerHold = null;
  w.dangerSince = null;
  w.escapeGoal = null;
}

export function createWorld(
  random = Math.random,
  { start = 0, select = false, unlock = () => {} } = {},
) {
  const w = {
    unlock,
    select: select ? { index: start, max: start } : null,
    random,
    phase: 'playing',
    tick: 0,
    acc: 0,
    hp: MAX_HP,
    score: 0,
    p: {
      x: 0,
      y: 0,
      face: 1,
      moving: false,
      inv: 0,
      pingCd: 0,
      pingCdMax: PING_CD,
      netT: 0,
      netCd: 0,
      netHit: false,
      hurtT: 0,
      deniedT: 0,
      charges: SONAR_START[0],
      chargeT: 0,
    },
    pend: { ping: false, net: false },
    latch: { danger: 0, roused: 0 },
    msg: null,
    msgT: 0,
    interlude: 0,
    events: [],
    motes: Array.from({ length: 14 }, () => [random() * 480, TOP + random() * (ROWS * TILE)]),
  };
  loadCavern(w, start);
  return w;
}

// ---------------------------------------------------------------- simulation

const say = (w, en, zh, event) => {
  w.msg = { en, zh };
  w.msgT = MSG_TIME;
  if (event) w.events.push(event);
};

function advanceRoute(e) {
  if (e.mode === 'loop') e.i = (e.i + 1) % e.pts.length;
  else {
    if (e.i + e.dir < 0 || e.i + e.dir >= e.pts.length) e.dir = -e.dir;
    e.i += e.dir;
  }
}

// Moves towards (tx, ty) at `speed`; returns true on arrival. Heading is the unit step taken.
function walkTo(e, tx, ty, speed, dt) {
  const dx = tx - e.x,
    dy = ty - e.y,
    d = Math.hypot(dx, dy),
    step = speed * dt;
  if (d <= step) {
    e.x = tx;
    e.y = ty;
    return true;
  }
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
  e.hx = dx / d;
  e.hy = dy / d;
  return false;
}

function patrol(e, dt) {
  if (e.frozen > 0) {
    e.frozen -= dt;
    return;
  }
  if (e.wait > 0) {
    e.wait -= dt;
    e.hx = e.hy = 0;
    return;
  }
  const [tx, ty] = e.pts[e.i];
  if (e.startle > 0) e.startle -= dt;
  if (!walkTo(e, tx, ty, e.speed * (e.startle > 0 ? STARTLE_MULT : 1), dt)) return;
  e.wait = e.pause;
  advanceRoute(e);
}

function sendBack(w, e, state = 'return') {
  const [c, r] = tileOf(e.x, e.y),
    [hc, hr] = tileOf(...e.pts[e.i]);
  e.path = pathDownhill(tunnelDistances(w.map, hc, hr), c, r);
  e.state = state;
}

function moveThreat(w, e, dt) {
  if (e.state === 'patrol') return patrol(e, dt);
  e.hx = e.hy = 0;
  if (e.state === 'search') {
    if (!isRoused(w)) e.wait -= dt;
    if (e.wait <= 0) sendBack(w, e);
    return;
  }
  if (e.path.length) {
    const alertMult = isRoused(w) ? ROUSED_MULT : ALERT_MULT,
      speed = e.speed * ({ alert: alertMult, recoil: RECOIL_MULT }[e.state] ?? 1);
    if (walkTo(e, e.path[0][0], e.path[0][1], speed, dt)) e.path.shift();
    return;
  }
  if (e.state === 'alert') {
    e.state = 'search';
    e.wait = SEARCH_TIME;
  } else e.state = 'patrol';
}

export const isRoused = (w) => w.alarm >= ALARM_MAX;

// Noise rule: every threat within NOISE_R px of tunnel distance of the ping hears it and walks to it.
// Once the cave is roused (alarm full) every threat hears it, however far, and keeps hunting the spot.
function hearPing(w, x, y) {
  const [pc, pr] = tileOf(x, y),
    dist = tunnelDistances(w.map, pc, pr);
  w.noiseDist = dist;
  for (const t of w.threats) {
    const [c, r] = tileOf(t.x, t.y),
      d = dist[r * COLS + c],
      deaf = d * TILE > NOISE_R && !isRoused(w);
    if (t.state === 'recoil' || d < 0 || deaf) continue;
    t.path = pathDownhill(dist, c, r);
    t.state = 'alert';
  }
}

function doPing(w) {
  if (w.p.pingCd > 0) {
    w.p.deniedT = DENIED_FLASH;
    return say(w, 'Sonar recharging', '声呐冷却中', 'denied');
  }
  if (w.p.charges < 1) {
    w.p.deniedT = DENIED_FLASH;
    return say(w, 'Sonar empty: net a beetle or wait', '声呐没电：捕获萤甲虫或等待', 'denied');
  }
  w.p.charges -= 1;
  const { x, y } = w.p;
  w.ring = {
    x,
    y,
    r: 0,
    seen: [],
    rays: Array.from({ length: RAYS }, (_, i) =>
      castRay(w.map, x, y, (i / RAYS) * Math.PI * 2, NOISE_R),
    ),
  };
  w.lastPing = { x, y, t: w.tick * STEP };
  w.alarm = Math.min(ALARM_CAP, w.alarm + ALARM_PER_PING);
  w.p.pingCdMax = isRoused(w) ? PING_CD_ROUSED : PING_CD;
  w.p.pingCd = w.p.pingCdMax;
  w.events.push('ping');
  if (isRoused(w)) say(w, 'The cave is roused!', '洞穴被惊动了！');
  hearPing(w, x, y);
}

function stampMark(w, e) {
  const mark = {
    id: e.id,
    kind: e.kind,
    x: e.x,
    y: e.y,
    dx: e.hx,
    dy: e.hy,
    age: 0,
    alerted: e.state === 'alert',
  };
  const at = w.marks.findIndex((m) => m.id === e.id);
  if (at >= 0) w.marks[at] = mark;
  else w.marks.push(mark);
}

function growRing(w) {
  const ring = w.ring;
  ring.r += RING_SPEED * STEP;
  if (ring.r >= NOISE_R) {
    w.ring = null;
    return;
  }
  for (const e of [...w.drifters, ...w.threats]) {
    if (ring.seen.includes(e.id)) continue;
    const d = Math.hypot(e.x - ring.x, e.y - ring.y);
    // Only an object the drawn ring front is crossing right now is revealed.
    if (d > ring.r || d <= ring.r - FRONT_WIDTH || d > REVEAL_R) continue;
    if (!lineClear(w.map, ring.x, ring.y, e.x, e.y)) continue;
    ring.seen.push(e.id);
    stampMark(w, e);
    if (e.kind === 'drifter') e.frozen = STUN_TIME;
  }
}

function swingNet(w) {
  const p = w.p;
  if (p.netCd > 0) return;
  p.netT = NET_TIME;
  p.netCd = NET_CD;
  p.netHit = false;
  w.events.push('net');
}

function scare(w, d, time) {
  d.startle = Math.max(d.startle, time);
  const towards = d.hx * (w.p.x - d.x) + d.hy * (w.p.y - d.y) > 0,
    back = d.i - d.dir;
  if (d.mode === 'pingpong' && towards && back >= 0 && back < d.pts.length) {
    d.i = back;
    d.dir = -d.dir;
  }
}

const sees = (w, d, r) =>
  Math.hypot(d.x - w.p.x, d.y - w.p.y) <= r && lineClear(w.map, w.p.x, w.p.y, d.x, d.y);

// A missed swing scares beetles in sight: they bolt, away from the player when their route allows.
function startleBeetles(w) {
  for (const d of w.drifters) if (sees(w, d, STARTLE_R)) scare(w, d, STARTLE_TIME);
}

function netCatch(w) {
  const p = w.p,
    caught = w.drifters.filter(
      (d) =>
        Math.hypot(d.x - p.x, d.y - p.y) <= NET_R &&
        lineClear(w.map, p.x, p.y, d.x, d.y) &&
        w.marks.some((m) => m.id === d.id),
    );
  if (!caught.length) return;
  p.netHit = true;
  for (const d of caught) {
    w.drifters.splice(w.drifters.indexOf(d), 1);
    w.marks = w.marks.filter((m) => m.id !== d.id);
    w.beacons += 1;
    w.p.charges = Math.min(SONAR_CAP, w.p.charges + 1); // a catch pays for a ping
    w.score += BEACON_SCORE;
    say(w, 'Beacon recovered!', '信标已回收！', 'beacon');
  }
}

function threatContact(w) {
  const p = w.p;
  if (p.inv > 0) return;
  const t = w.threats.find(
    (e) => e.state !== 'recoil' && Math.hypot(e.x - p.x, e.y - p.y) < CONTACT_R,
  );
  if (!t) return;
  w.hp -= 1;
  p.inv = INVULN;
  p.hurtT = 0.4;
  sendBack(w, t, 'recoil');
  const away = Math.hypot(p.x - t.x, p.y - t.y) || 1;
  slide(w.map, p, ((p.x - t.x) / away) * 10, ((p.y - t.y) / away) * 10, PLAYER_HALF);
  say(w, 'Ouch! -1 HP', '被抓到了！生命-1', 'hurt');
  if (w.hp <= 0) w.phase = 'lost';
}

function clearCavern(w) {
  w.score += CAVERN_SCORE;
  w.unlock(Math.min(CAVERNS.length, w.cavern + 2)); // the next cavern is saved as reached
  if (w.cavern === CAVERNS.length - 1) {
    w.score += w.hp * HP_SCORE;
    w.phase = 'won';
    return;
  }
  w.interlude = CLEAR_TIME;
  w.hp = Math.min(MAX_HP, w.hp + CLEAR_HEAL);
  const n = w.cavern + 1;
  say(w, `Cavern ${n} clear! +${CLEAR_HEAL} HP`, `洞穴${n}完成！生命+${CLEAR_HEAL}`, 'clear');
}

function movePlayer(w, held) {
  const p = w.p,
    ax = (held.right ? 1 : 0) - (held.left ? 1 : 0),
    ay = (held.down ? 1 : 0) - (held.up ? 1 : 0),
    len = Math.hypot(ax, ay);
  p.moving = len > 0;
  if (!p.moving) return;
  const k = (PLAYER_SPEED * STEP) / len;
  slide(w.map, p, ax * k, ay * k, PLAYER_HALF);
  if (ax) p.face = ax;
}

function timers(w) {
  const p = w.p;
  p.inv = Math.max(0, p.inv - STEP);
  p.hurtT = Math.max(0, p.hurtT - STEP);
  p.deniedT = Math.max(0, p.deniedT - STEP);
  p.chargeT = p.charges < SONAR_CAP ? p.chargeT + STEP : 0;
  if (p.chargeT >= SONAR_TRICKLE[w.cavern]) {
    p.charges += 1;
    p.chargeT = 0;
  }
  p.pingCd = Math.max(0, p.pingCd - STEP);
  p.netCd = Math.max(0, p.netCd - STEP);
  w.alarm = Math.max(0, w.alarm - STEP / ALARM_DRAIN);
  if (p.netT > 0) {
    p.netT -= STEP;
    if (p.netT <= 0 && !p.netHit) {
      say(w, 'Net missed', '网扑空了', 'miss');
      startleBeetles(w);
    }
  }
  w.msgT = Math.max(0, w.msgT - STEP);
  if (!w.msgT) w.msg = null;
  for (const m of w.marks) m.age += STEP;
  w.marks = w.marks.filter((m) => m.age < MARK_LIFE);
}

function tick(w, held) {
  w.tick += 1;
  if (w.interlude > 0) {
    w.pend.ping = w.pend.net = false; // nothing is queued across the pause between caverns
    w.interlude -= STEP;
    if (w.interlude <= 0) loadCavern(w, w.cavern + 1);
    return;
  }
  timers(w);
  if (w.pend.ping) doPing(w);
  if (w.pend.net) swingNet(w);
  w.pend.ping = w.pend.net = false;
  movePlayer(w, held);
  if (w.ring) growRing(w);
  for (const d of w.drifters) patrol(d, STEP);
  for (const t of w.threats) moveThreat(w, t, STEP);
  if (w.p.netT > 0) netCatch(w);
  if (!w.drifters.length) {
    clearCavern(w); // the net resolves before contact: a final catch beats a same-tick bite
    updatePrompt(w);
    return;
  }
  threatContact(w);
  updatePrompt(w);
}

function readHeld(input) {
  return {
    left: input.held('ArrowLeft', 'KeyA'),
    right: input.held('ArrowRight', 'KeyD'),
    up: input.held('ArrowUp', 'KeyW'),
    down: input.held('ArrowDown', 'KeyS'),
  };
}

const pressedAny = (input, ...codes) => codes.some((code) => input.pressed(code));

// The cavern chooser: nothing simulates until Space (or Enter) starts the shown cavern.
function stepSelect(w, input) {
  const sel = w.select,
    step =
      (pressedAny(input, 'ArrowRight', 'KeyD') ? 1 : 0) -
      (pressedAny(input, 'ArrowLeft', 'KeyA') ? 1 : 0) +
      SKIP_LEVELS *
        ((pressedAny(input, 'ArrowDown', 'KeyS') ? 1 : 0) -
          (pressedAny(input, 'ArrowUp', 'KeyW') ? 1 : 0)),
    next = clamp(sel.index + step, 0, sel.max);
  if (next !== sel.index) {
    sel.index = next;
    loadCavern(w, next); // the chosen cavern is shown behind the chooser
    w.events.push('select');
  }
  if (pressedAny(input, 'Space', 'Enter')) {
    loadCavern(w, sel.index);
    w.select = null;
    w.events.push('begin');
  }
}

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
  if (w.select) {
    w.events = [];
    stepSelect(w, input);
    return;
  }
  if (input.pressed('Space')) w.pend.ping = true;
  if (input.pressed('KeyX')) w.pend.net = true;
  w.events = [];
  w.acc += Math.min(dt, MAX_FRAME);
  const held = readHeld(input);
  while (w.acc + 1e-9 >= STEP && w.phase === 'playing') {
    w.acc -= STEP;
    tick(w, held);
  }
  if (Math.abs(w.acc) < 1e-9) w.acc = 0;
}

// ------------------------------------------------------------ readable state

export const PROMPTS = {
  select: ['Left/Right choose · Space starts', '左右选择洞穴 · 空格开始'],
  start: ['Space: ping sonar to find the glow beetles', '空格：发射声呐寻找萤甲虫'],
  ready: ['Space ping · X net · Arrows move', '空格声呐 · X捕网 · 方向键移动'],
  cooldown: ['Sonar recharging. Study the outlines', '声呐冷却中，观察轮廓'],
  net: ['Target in reach: press X to net it!', '目标在范围内：按X捕网！'],
  locate: [
    'Beetle here but unlocated: Space pings, then X',
    '萤甲虫在这里但未定位：先按空格，再按X',
  ],
  roused: [
    'Roused: stop pinging, walk away from your last ping',
    '惊动了：别发声呐，远离上次发射点',
  ],
  noise: ['Loud ping: move to another spot, then Space', '声呐很响：换个位置再按空格'],
  empty: ['No echoes here: walk to another room, then Space', '这里没有回声：换个房间再按空格'],
  dry: ['Sonar empty: net a beetle, or wait for a charge', '声呐没电：捕获萤甲虫或等待充能'],
};
const DIRS4 = {
  left: [-1, 0, '←', '左'],
  right: [1, 0, '→', '右'],
  up: [0, -1, '↑', '上'],
  down: [0, 1, '↓', '下'],
};
const SIDE_EN = { left: 'the left', right: 'the right', up: 'above', down: 'below' };
// Directional survival prompts, one per (side the tremor comes from, direction to move).
for (const from of Object.keys(DIRS4))
  for (const to of Object.keys(DIRS4)) {
    if (from === to) continue;
    PROMPTS[`danger_${from}_${to}`] = [
      `Tremor from ${SIDE_EN[from]}: move ${to} (${DIRS4[to][2]})`,
      `震动来自${DIRS4[from][3]}边：向${DIRS4[to][3]}移动（${DIRS4[to][2]}）`,
    ];
  }
// Chase prompts point at the nearest live outline: the side it is on and the key that nets it.
for (const to of Object.keys(DIRS4))
  PROMPTS[`chase_${to}`] = [
    `Beetle found (${DIRS4[to][2]}): walk to its outline, X to net`,
    `发现萤甲虫（${DIRS4[to][2]}）：走到轮廓处，按X捕网`,
  ];
export const isDangerKey = (key) => key.startsWith('danger_');

// Everything the lamp lights right now, as the player could see it on screen.
function litThings(w) {
  const p = w.p;
  return [...w.drifters, ...w.threats].filter(
    (e) => Math.hypot(e.x - p.x, e.y - p.y) <= LIGHT_R && lineClear(w.map, p.x, p.y, e.x, e.y),
  );
}

const RUMBLE_PATH = RUMBLE_R * 1.3; // tremors travel through the tunnels, not through solid rock

// Tunnel distances from the player's tile, cached per tile (walls never change inside a cavern).
function walkFrom(w) {
  const [c, r] = tileOf(w.p.x, w.p.y),
    key = `${w.cavern}:${c},${r}`;
  w.walkCache ??= new Map();
  if (!w.walkCache.has(key)) w.walkCache.set(key, tunnelDistances(w.map, c, r));
  return w.walkCache.get(key);
}

// Within tremor range by straight line and by walking distance.
function felt(w, x, y) {
  const p = w.p,
    [c, r] = tileOf(x, y),
    steps = walkFrom(w)[r * COLS + c];
  return Math.hypot(x - p.x, y - p.y) <= RUMBLE_R && steps >= 0 && steps * TILE <= RUMBLE_PATH;
}

// A threat within RUMBLE_R is felt as a tremor in the dark: only its bearing and nearness, never a position.
export function rumbleOf(w) {
  const p = w.p;
  let best = null;
  for (const t of w.threats) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (t.state !== 'recoil' && felt(w, t.x, t.y) && (!best || d < best.d)) best = { d, t };
  }
  if (!best) return null;
  // Only what the tremor draws: a bearing in 16 sectors and one of three strengths, never a distance.
  const sector = Math.PI / 8,
    level = best.d > (RUMBLE_R * 2) / 3 ? 1 : best.d > RUMBLE_R / 3 ? 2 : 3;
  return {
    bearing: Math.round(Math.atan2(best.t.y - p.y, best.t.x - p.x) / sector) * sector,
    strength: level / 3,
  };
}

// The prompt only speaks up for a felt threat that is hunting (alerted) or already close; a crawler
// merely patrolling at the edge of the tremor is shown by the ring alone.
const MENACE_R = 40;
const ESCAPE_HOLD = 2;
const ESCAPE_RUN = 40; // an escape arrow needs at least this much straight, walkable tunnel
const MAX_RUN = 160;
const ESCAPE_MIN_RUN = 12; // the arrow may reverse only when the way it points is closed
const ESCAPE_GOALS = 12; // best-scoring exits considered
function menacing(w, e, hunting) {
  return felt(w, e.x, e.y) && (hunting || Math.hypot(e.x - w.p.x, e.y - w.p.y) <= MENACE_R);
}

// Who threatens now: threats felt within the tremor radius, plus fresh outlines of threats nearby.
function dangerSources(w) {
  const p = w.p,
    out = w.threats
      .filter((t) => t.state !== 'recoil' && menacing(w, t, t.state === 'alert'))
      .map((t) => ({ x: t.x, y: t.y }));
  for (const m of w.marks)
    if (m.kind === 'threat' && m.age < 2.5 && menacing(w, m, m.alerted))
      out.push({ x: m.x, y: m.y });
  return out;
}

const DIR_OF = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

// Tunnel distances from any tile, cached for the cavern.
function distFrom(w, c, r) {
  const key = `${w.cavern}:${c},${r}`;
  w.walkCache ??= new Map();
  if (!w.walkCache.has(key)) w.walkCache.set(key, tunnelDistances(w.map, c, r));
  return w.walkCache.get(key);
}

// The first step of the best escape: a tile the player can reach well before any threat, as far from
// them as possible (so never a dead end), reached by a walkable run of at least 40 px.
function escapeStep(w, sources, minSteps) {
  const p = w.p,
    [pc, pr] = tileOf(p.x, p.y),
    mine = distFrom(w, pc, pr),
    theirs = sources.map((t) => distFrom(w, ...tileOf(t.x, t.y))),
    options = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const a = mine[r * COLS + c],
        b = Math.min(...theirs.map((d) => (d[r * COLS + c] < 0 ? 99 : d[r * COLS + c])));
      if (a >= minSteps && a <= 10 && b > a + 1)
        options.push({
          c,
          r,
          score: b - 0.5 * a + (w.escapeGoal?.c === c && w.escapeGoal.r === r ? 99 : 0),
        });
    }
  options.sort((x, y) => y.score - x.score);
  // The exit chosen first keeps being chosen while it stays safe to reach, so the arrow only turns at
  // corners of one path and never flips between two rooms.
  for (const { c, r } of options.slice(0, ESCAPE_GOALS)) {
    const toGoal = distFrom(w, c, r),
      here = toGoal[pr * COLS + pc],
      runs = [];
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = pc + dc,
        nr = pr + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || toGoal[nr * COLS + nc] !== here - 1)
        continue;
      // The arrow needs ESCAPE_RUN px of walkable tunnel, or all of it if the route turns sooner.
      let legs = 1;
      while (toGoal[(pr + dr * (legs + 1)) * COLS + pc + dc * (legs + 1)] === here - legs - 1)
        legs++;
      const run = freeRun(w, dc, dr);
      if (run >= Math.min(ESCAPE_RUN, legs * TILE - TILE / 2))
        runs.push({ run, name: DIR_OF[`${dc},${dr}`] });
    }
    if (!runs.length) continue;
    w.escapeGoal = { c, r };
    return runs.reduce((a, b) => (b.run > a.run ? b : a)).name;
  }
  return null;
}

// How far (px, sampled every 4) the player's box can walk in a straight line before a wall.
function freeRun(w, dc, dr) {
  const probe = { x: w.p.x, y: w.p.y },
    along = () => probe.x * dc + probe.y * dr;
  for (let run = 0; run < MAX_RUN; run += 4) {
    const before = along();
    // Easing sideways round a corner takes a few presses before the box moves on.
    for (let press = 0; press < 3 && along() - before < 4; press++)
      slide(w.map, probe, dc * 4, dr * 4, PLAYER_HALF);
    if (along() - before < 4) return run;
  }
  return MAX_RUN;
}

// The prompt's escape: toward an exit by the longest walkable run, held for ESCAPE_HOLD seconds so the
// line does not flip; after 3 s of danger it asks for a longer trip (leave the room).
function dangerKey(w, sources) {
  const now = w.tick * STEP,
    p = w.p,
    score = (dir) =>
      Math.min(
        ...sources.map((t) => Math.hypot(t.x - (p.x + dir[0] * 40), t.y - (p.y + dir[1] * 40))),
      ),
    free = (dir) =>
      !boxBlocked(w.map, p.x + dir[0] * 12, p.y + dir[1] * 12, PLAYER_HALF) &&
      !boxBlocked(w.map, p.x + dir[0] * 28, p.y + dir[1] * 28, PLAYER_HALF);
  const held = w.dangerHold && now < w.dangerHold.until ? w.dangerHold.to : null;
  let to = escapeStep(w, sources, w.dangerSince !== null && now - w.dangerSince > 3 ? 5 : 1);
  if (!to) {
    for (const name of Object.keys(DIRS4)) {
      const dir = DIRS4[name];
      if (free(dir) && (!to || score(dir) > score(DIRS4[to]))) to = name;
    }
    if (held && free(DIRS4[held])) to = held;
  }
  to ??= Object.keys(DIRS4).sort((a, b) => score(DIRS4[b]) - score(DIRS4[a]))[0];
  // No reversal inside the hold: the arrow may turn a corner, but it never flips to the opposite
  // direction while the way it points is still open.
  if (held && to === opposite(held) && freeRun(w, ...DIRS4[held]) >= ESCAPE_MIN_RUN) to = held;
  const near = sources.reduce((a, b) =>
      Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(b.x - p.x, b.y - p.y) ? a : b,
    ),
    dx = near.x - p.x,
    dy = near.y - p.y;
  let from = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  if (from === to) from = Object.keys(DIRS4).find((k) => k !== to && k !== opposite(to));
  return `danger_${from}_${to}`;
}
const opposite = (d) => ({ left: 'right', right: 'left', up: 'down', down: 'up' })[d];

function rawPrompt(w) {
  const p = w.p,
    lit = litThings(w),
    near = (e, r) => Math.hypot(e.x - p.x, e.y - p.y) <= r;
  const sources = dangerSources(w);
  if (sources.length) return dangerKey(w, sources);
  const close = lit.find((e) => e.kind === 'drifter' && near(e, NET_R + 8));
  if (close) return w.marks.some((m) => m.id === close.id) ? 'net' : 'locate';
  if (isRoused(w)) return 'roused';
  const outline = w.marks
    .filter((m) => m.kind === 'drifter')
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (outline) {
    const dx = outline.x - p.x,
      dy = outline.y - p.y;
    return `chase_${Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'}`;
  }
  const lp = w.lastPing;
  if (lp && w.tick * STEP - lp.t < 5 && Math.hypot(lp.x - p.x, lp.y - p.y) < 90) {
    const swept = !w.ring && !w.marks.some((m) => m.kind === 'drifter');
    return swept ? 'empty' : 'noise';
  }
  if (p.charges < 1) return 'dry';
  if (p.pingCd > 0) return 'cooldown';
  return w.lastPing ? 'ready' : 'start';
}

// Danger and roused stay up for LATCH_TIME after they last applied, so the line does not flicker.
export function desiredPrompt(w) {
  const raw = rawPrompt(w),
    now = w.tick * STEP;
  if (isDangerKey(raw)) return raw;
  if (w.latch.danger > now && w.dangerKey) return w.dangerKey;
  if (raw === 'roused' || (w.latch.roused > now && raw !== 'net')) return 'roused';
  return raw;
}

function updatePrompt(w) {
  w.promptT += STEP;
  const raw = rawPrompt(w),
    now = w.tick * STEP;
  if (isDangerKey(raw)) {
    w.latch.danger = now + LATCH_TIME;
    w.dangerKey = raw;
    w.dangerSince ??= now;
    const to = raw.split('_')[2];
    if (!w.dangerHold || now >= w.dangerHold.until || w.dangerHold.to !== to)
      w.dangerHold = { to, until: now + ESCAPE_HOLD };
  } else if (w.latch.danger <= now) {
    w.dangerSince = null;
    w.escapeGoal = null;
  }
  if (raw === 'roused') w.latch.roused = now + LATCH_TIME;
  const want = desiredPrompt(w);
  if (want !== w.promptKey && w.promptT >= PROMPT_HOLD) {
    w.promptKey = want;
    w.promptT = 0;
  }
}

const markView = (m) => ({ ...m, life: MARK_LIFE });
const liveView = (e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, dx: e.hx, dy: e.hy });

export function snapshot(w) {
  const [en, zh] = PROMPTS[w.select ? 'select' : w.promptKey],
    p = w.p,
    cave = CAVERNS[w.cavern],
    n = w.cavern + 1;
  const lead = w.msg || { en, zh };
  return {
    phase: w.phase,
    score: w.score,
    hp: w.hp,
    maxHp: MAX_HP,
    cavern: n,
    cavernCount: CAVERNS.length,
    cavernName: cave.name,
    select: w.select && {
      index: w.select.index + 1,
      reached: w.select.max + 1,
      total: CAVERNS.length,
    },
    beacons: w.beacons,
    beaconTotal: w.total,
    time: w.tick * STEP,
    interlude: Math.max(0, w.interlude),
    prompt: { key: w.select ? 'select' : w.promptKey, en, zh },
    message: w.msg && { ...w.msg },
    walls: [...w.map], // a copy: callers cannot edit the cavern
    player: {
      x: p.x,
      y: p.y,
      hw: PLAYER_HALF,
      face: p.face,
      moving: p.moving,
      invulnerable: p.inv,
      hurt: p.hurtT,
      pingCooldown: p.pingCd,
      pingCooldownMax: p.pingCdMax,
      pingDenied: p.deniedT > 0,
      sonarCharges: p.charges,
      sonarMax: SONAR_CAP,
      nextCharge: p.charges < SONAR_CAP ? SONAR_TRICKLE[w.cavern] - p.chargeT : 0,
      netActive: p.netT > 0,
      netCooldown: p.netCd,
      netCooldownMax: NET_CD,
    },
    ring: w.ring && {
      x: w.ring.x,
      y: w.ring.y,
      r: w.ring.r,
      revealR: REVEAL_R,
      noiseR: NOISE_R,
      rays: [...w.ring.rays],
    },
    lastPing: w.lastPing && { ...w.lastPing },
    alarm: {
      value: Math.min(ALARM_CAP, w.alarm),
      max: ALARM_CAP,
      rousedAt: ALARM_MAX,
      roused: isRoused(w),
      drainSeconds: ALARM_DRAIN,
    },
    rumble: rumbleOf(w),
    marks: w.marks.map(markView),
    lit: litThings(w).map(liveView),
    events: [...w.events],
    status: {
      en: `Cavern ${n}/${CAVERNS.length} · HP ${w.hp}/${MAX_HP} · Beacons ${w.beacons}/${w.total} · ${lead.en}`,
      zh: `洞穴${n}/${CAVERNS.length} · 生命 ${w.hp}/${MAX_HP} · 信标 ${w.beacons}/${w.total} · ${lead.zh}`,
    },
  };
}

const END_TEXT = {
  won: ['All beacons recovered from all twenty caverns!', '二十个洞穴的信标全部回收！'],
  lost: [
    'The crawlers caught you. Ping less where they can hear, and step away from your ping spot.',
    '爬虫抓住了你。别在它们听得到的地方频繁发射声呐，并离开发射点。',
  ],
};
const SOUND_FOR = {
  ping: 'move',
  net: 'shoot',
  beacon: 'coin',
  hurt: 'hit',
  clear: 'coin',
  select: 'move',
  begin: 'coin',
};

// The highest cavern the host has saved for this player (1-based); a missing or odd value means 1.
function reachedLevel(env) {
  const saved = Math.floor(Number(env.progress?.unlocked?.()));
  return Number.isFinite(saved) ? clamp(saved, 1, CAVERNS.length) : 1;
}

export function createGame(env) {
  const reached = reachedLevel(env),
    w = createWorld(env.random, {
      start: reached - 1,
      select: reached > 1,
      unlock: (level) => env.progress?.unlock?.(level),
    });
  let ended = false;
  return {
    update(dt, input) {
      if (ended) return;
      stepWorld(w, dt, input);
      for (const e of new Set(w.events)) if (SOUND_FOR[e]) env.sound(SOUND_FOR[e]);
      if (w.phase === 'playing') return;
      ended = true;
      const won = w.phase === 'won',
        [en, zh] = END_TEXT[w.phase];
      env.sound(won ? 'win' : 'lose');
      env.end({ won, score: w.score, message: env.t(en, zh) });
    },
    draw(ctx) {
      drawWorld(ctx, w, env);
    },
    getState() {
      return snapshot(w);
    },
  };
}

// --------------------------------------------------------------- rendering

const PLAYER = [
  '..hhhh..',
  '.hhvvhh.',
  '.hhvvhh.',
  '..hhhh..',
  '.bbbbbb.',
  'bbbyybbb',
  '.bbbbbb.',
  '.bb..bb.',
];
const DRIFTER = [
  '.g....g.',
  '..gggg..',
  '.gwwwwg.',
  'gwwyywwg',
  'gwwyywwg',
  '.gwwwwg.',
  '..g..g..',
  '.g....g.',
];
const THREAT = [
  'r..rr..r',
  '.rrrrrr.',
  'rrmrrmrr',
  'rrrrrrrr',
  'rrmrrmrr',
  '.rrrrrr.',
  'r.r..r.r',
  '.r....r.',
];
const PALETTE = {
  h: '#9fb4c8',
  v: '#37e6d2',
  b: '#3b6ea5',
  y: '#ffe27a',
  g: '#35d27a',
  w: '#1c7a54',
  r: '#c0304f',
  m: '#ffe0e8',
};
const FLASH = Object.fromEntries(Object.keys(PALETTE).map((k) => [k, '#ffffff']));
const SPRITES = { player: PLAYER, drifter: DRIFTER, threat: THREAT };
const OUTLINE = { drifter: '#6df2ff', threat: '#ff6b8a' };

function paintSprite(ctx, rows, x, y, palette) {
  rows.forEach((row, ry) =>
    [...row].forEach((c, rx) => {
      if (c === '.') return;
      ctx.fillStyle = palette[c];
      ctx.fillRect(Math.round(x + rx * 2), Math.round(y + ry * 2), 2, 2);
    }),
  );
}

// Hollow silhouette: only the sprite's edge pixels, so a memory never looks like a live body.
function outlineSprite(ctx, rows, x, y, color) {
  const on = (r, c) => rows[r]?.[c] !== undefined && rows[r][c] !== '.';
  ctx.fillStyle = color;
  rows.forEach((row, ry) =>
    [...row].forEach((c, rx) => {
      if (c === '.') return;
      if (on(ry - 1, rx) && on(ry + 1, rx) && on(ry, rx - 1) && on(ry, rx + 1)) return;
      ctx.fillRect(Math.round(x + rx * 2), Math.round(y + ry * 2), 2, 2);
    }),
  );
}

const hash = (c, r) => (Math.imul(c * 73856093, 1) ^ Math.imul(r * 19349663, 1)) >>> 0;

function drawCave(ctx, w) {
  background(ctx, '#05070d');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE,
        y = TOP + r * TILE,
        h = hash(c, r);
      if (!solidAt(w.map, c, r)) {
        ctx.fillStyle = h % 5 === 0 ? '#0d1420' : '#0a0f19';
        ctx.fillRect(x, y, TILE, TILE);
        continue;
      }
      ctx.fillStyle = h % 3 === 0 ? '#1d2836' : '#17212d';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#2f4258';
      if (!solidAt(w.map, c, r - 1)) ctx.fillRect(x, y, TILE, 2);
      if (!solidAt(w.map, c, r + 1)) ctx.fillRect(x, y + TILE - 2, TILE, 2);
      if (!solidAt(w.map, c - 1, r)) ctx.fillRect(x, y, 2, TILE);
      if (!solidAt(w.map, c + 1, r)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
      ctx.fillStyle = '#0f1620';
      ctx.fillRect(x + 4 + (h % 5), y + 5 + (h % 4), 3, 2);
    }
  }
  ctx.fillStyle = '#1a2a3a';
  for (const [x, y] of w.motes) ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
}

function drawLamp(ctx, p) {
  for (const [r, a] of [
    [LIGHT_R, 0.07],
    [LIGHT_R * 0.72, 0.09],
    [LIGHT_R * 0.44, 0.12],
  ]) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Tremor: a pulsing red dotted circle around the player with a marker toward the felt threat.
function drawRumble(ctx, p, rumble, tick) {
  const pulse = 0.35 + 0.35 * rumble.strength + (Math.floor(tick / 10) % 2 ? 0.15 : 0);
  ctx.fillStyle = '#ff4d5e';
  ctx.globalAlpha = pulse;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.fillRect(
      Math.round(p.x + Math.cos(a) * RUMBLE_R) - 1,
      Math.round(p.y + Math.sin(a) * RUMBLE_R) - 1,
      3,
      3,
    );
  }
  ctx.globalAlpha = 1;
  const bx = p.x + Math.cos(rumble.bearing) * RUMBLE_R,
    by = p.y + Math.sin(rumble.bearing) * RUMBLE_R;
  ctx.fillRect(Math.round(bx) - 4, Math.round(by) - 4, 8, 8);
}

function drawRing(ctx, ring) {
  const fade = 1 - ring.r / ring.noiseR;
  ring.rays.forEach((reach, i) => {
    if (ring.r > reach) return;
    const a = (i / ring.rays.length) * Math.PI * 2,
      bright = ring.r <= ring.revealR;
    if (!bright && i % 2) return; // the outer, noise-only ring is dashed
    ctx.globalAlpha = bright ? 0.35 + 0.65 * fade : 0.45 * fade + 0.1;
    ctx.fillStyle = bright ? '#6df2ff' : '#7a8fb0';
    ctx.fillRect(
      Math.round(ring.x + Math.cos(a) * ring.r) - 1,
      Math.round(ring.y + Math.sin(a) * ring.r) - 1,
      3,
      3,
    );
  });
  ctx.globalAlpha = 1;
}

function drawArrow(ctx, m, color) {
  if (!m.dx && !m.dy) return;
  const sx = m.x + m.dx * 11,
    sy = m.y + m.dy * 11;
  ctx.fillStyle = color;
  for (let k = 0; k < 4; k++)
    ctx.fillRect(Math.round(sx + m.dx * k * 3) - 1, Math.round(sy + m.dy * k * 3) - 1, 3, 3);
  ctx.fillRect(
    Math.round(sx + m.dx * 15 - m.dy * 3) - 1,
    Math.round(sy + m.dy * 15 + m.dx * 3) - 1,
    3,
    3,
  );
  ctx.fillRect(
    Math.round(sx + m.dx * 15 + m.dy * 3) - 1,
    Math.round(sy + m.dy * 15 - m.dx * 3) - 1,
    3,
    3,
  );
}

function drawMark(ctx, m) {
  const left = 1 - m.age / m.life;
  ctx.globalAlpha = 0.3 + 0.7 * left;
  outlineSprite(ctx, SPRITES[m.kind], m.x - 8, m.y - 8, OUTLINE[m.kind]);
  drawArrow(ctx, m, OUTLINE[m.kind]);
  ctx.fillStyle = OUTLINE[m.kind];
  ctx.fillRect(Math.round(m.x - 8), Math.round(m.y + 10), Math.max(1, Math.round(16 * left)), 2);
  ctx.globalAlpha = 1;
  if (m.alerted) text(ctx, '!', m.x - 3, m.y - 24, '#ffd76a', 14);
}

function drawPlayer(ctx, p, tick) {
  // The player is never hidden: while invulnerable the body flashes white instead.
  const flash = p.invulnerable > 0 && Math.floor(tick / 8) % 2 === 0;
  paintSprite(
    ctx,
    PLAYER,
    p.x - 8,
    p.y - 8 + (p.moving && Math.floor(tick / 12) % 2 ? 1 : 0),
    flash ? FLASH : PALETTE,
  );
  ctx.fillStyle = p.hurt > 0 ? '#ff4060' : '#37e6d2';
  ctx.fillRect(Math.round(p.x + p.face * 5) - 1, Math.round(p.y - 12), 3, 3);
  if (p.netActive) {
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, NET_R, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function meter(ctx, x, y, width, ratio, color) {
  ctx.fillStyle = '#26324a';
  ctx.fillRect(x, y, width, 10);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.round((width - 2) * clamp(ratio, 0, 1)), 8);
}

function drawHud(ctx, s, t) {
  const pl = s.player,
    ready = pl.pingCooldown <= 0;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, 480, TOP);
  ctx.fillRect(0, BOTTOM, 480, 320 - BOTTOM);
  text(ctx, `${t('Cave', '洞穴')} ${s.cavern}`, 6, 8, '#ffffff', 14);
  text(ctx, t('HP', '命'), 79, 8, '#ff9aa8', 14);
  for (let i = 0; i < s.maxHp; i++) {
    ctx.fillStyle = i < s.hp ? '#ff4d6d' : '#3a2230';
    ctx.fillRect(100 + i * 11, 9, 9, 10);
  }
  ctx.fillStyle = '#ffe27a'; // beacon diamond
  [
    [-2, 4],
    [-4, 8],
    [-6, 12],
    [-4, 8],
    [-2, 4],
  ].forEach(([off, wd], i) => ctx.fillRect(176 + off, 9 + i * 2, wd, 2));
  text(ctx, `${s.beacons}/${s.beaconTotal}`, 186, 8, '#ffe27a', 14);
  text(ctx, t('Sonar', '声呐'), 218, 8, ready ? '#6df2ff' : '#8a96b0', 14);
  for (let i = 0; i < pl.sonarMax; i++) {
    // One pip per charge, and a thin recharge line under them for the cooldown.
    ctx.fillStyle = i < pl.sonarCharges ? (ready ? '#6df2ff' : '#4f6fa0') : '#26324a';
    ctx.fillRect(264 + i * 4, 9, 3, 9);
  }
  ctx.fillStyle = '#26324a';
  ctx.fillRect(264, 20, 39, 2);
  ctx.fillStyle = ready ? '#6df2ff' : '#4f6fa0';
  ctx.fillRect(264, 20, Math.round(39 * clamp(1 - pl.pingCooldown / pl.pingCooldownMax, 0, 1)), 2);
  if (pl.pingDenied) {
    ctx.fillStyle = '#ff4d4d'; // refused press: red frame around the sonar pips
    for (const [x, y, w, h] of [
      [262, 7, 44, 2],
      [262, 23, 44, 2],
      [262, 7, 2, 18],
      [304, 7, 2, 18],
    ])
      ctx.fillRect(x, y, w, h);
  }
  text(ctx, t('Noise', '噪音'), 310, 8, s.alarm.roused ? '#ff6b6b' : '#b8c4e0', 14);
  for (let i = 0; i < s.alarm.max; i++) {
    ctx.fillStyle = '#26324a';
    ctx.fillRect(356 + i * 11, 9, 9, 10);
    ctx.fillStyle = s.alarm.roused ? '#ff4d4d' : '#ffb347';
    ctx.fillRect(356 + i * 11, 9, Math.round(9 * clamp(s.alarm.value - i, 0, 1)), 10);
  }
  text(ctx, t('Net', '网'), 402, 8, pl.netCooldown > 0 ? '#8a96b0' : '#ffe27a', 14);
  meter(ctx, 432, 10, 37, 1 - pl.netCooldown / pl.netCooldownMax, '#ffe27a');
  if (s.message) text(ctx, t(s.message.en, s.message.zh), 240, 289, '#ffd76a', 14, 'center');
  text(ctx, t(s.prompt.en, s.prompt.zh), 240, 304, '#dfe8ff', 14, 'center');
}

function drawChooser(ctx, s, t) {
  const sel = s.select;
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.72;
  ctx.fillRect(60, 84, 360, 126);
  ctx.globalAlpha = 1;
  text(ctx, t('Choose a cavern', '选择洞穴'), 240, 94, '#ffffff', 16, 'center');
  text(
    ctx,
    `${sel.index}/${sel.total}  ${t(s.cavernName.en, s.cavernName.zh)}`,
    240,
    122,
    '#6df2ff',
    16,
    'center',
  );
  text(
    ctx,
    t(`Saved progress: cavern ${sel.reached}`, `已保存进度：洞穴${sel.reached}`),
    240,
    150,
    '#ffe27a',
    14,
    'center',
  );
  text(
    ctx,
    t('Up/Down: jump 5 · Space: start', '上下：跳5个 · 空格：开始'),
    240,
    176,
    '#dfe8ff',
    14,
    'center',
  );
}

export function drawWorld(ctx, w, env) {
  const s = snapshot(w);
  drawCave(ctx, w);
  drawLamp(ctx, w.p);
  if (s.rumble) drawRumble(ctx, s.player, s.rumble, w.tick);
  if (s.ring) drawRing(ctx, s.ring);
  for (const m of s.marks) drawMark(ctx, m);
  for (const e of s.lit) paintSprite(ctx, SPRITES[e.kind], e.x - 8, e.y - 8, PALETTE);
  drawPlayer(ctx, s.player, w.tick);
  drawHud(ctx, s, env.t);
  if (s.select) drawChooser(ctx, s, env.t);
  if (s.interlude > 0) {
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 130, 480, 40);
    ctx.globalAlpha = 1;
    text(
      ctx,
      env.t(s.message?.en || 'Next cavern...', s.message?.zh || '前往下个洞穴…'),
      240,
      143,
      '#ffffff',
      16,
      'center',
    );
  }
}
