// Wallrunner Relay course table. Every course is data: a list of roofs read left to right.
//   [gap, rise, width, ...marks]   gap: empty pixels after the previous roof, rise: how much
//   higher this roof is than the last (negative = lower), width: roof width. Marks:
//   pad[:x0:x1]          relay pad over the roof (offsets from the roof's left edge)
//   chalkW[:a:b]  chalkE[:a:b]   chalk on the west / east face, a..b pixels below the roof
//   slickW[:a:b]  slickE[:a:b]   slick face (no wall-run, no kick)
//   slickB:a:b           slick on the left boundary wall, a..b pixels below the first roof
//   goal                 the beacon stands on this roof
export const BOTTOM = 440;
const BASE_ROOF = 240;
const CHALK_TOPOUT = -24; // chalk runs past the roof edge so the runner tops out cleanly
const PAD_INSET = 2;
const BOUNDARY_RISE = 160;
const BOUNDARY_WIDTH = 60;
const BEACON = { w: 16, h: 30 };

const nums = (bits) => bits.map(Number);
function buildSolids(parts) {
  const roofs = [],
    boundarySlick = [];
  let x = 0,
    y = BASE_ROOF;
  for (const [gap, rise, w, ...marks] of parts) {
    x += gap;
    y -= rise;
    const roof = {
      x,
      y,
      w,
      h: BOTTOM - y,
      chalk: { L: [], R: [] },
      slick: { L: [], R: [] },
      pads: [],
    };
    for (const mark of marks) {
      const [kind, ...args] = mark.split(':'),
        [a, b] = nums(args),
        face = kind.endsWith('W') ? 'L' : 'R',
        low = rise > 0 ? rise + (gap > 0 ? 60 : 0) : 60;
      if (kind === 'pad') roof.pads.push([x + (a ?? PAD_INSET), x + (b ?? w - PAD_INSET)]);
      else if (kind.startsWith('chalk'))
        roof.chalk[face].push([y + (a ?? CHALK_TOPOUT), y + (b ?? low)]);
      else if (kind === 'slickB') boundarySlick.push([y + a, y + b]);
      else if (kind.startsWith('slick')) roof.slick[face].push([y + a, y + b]);
      else if (kind === 'goal')
        roof.goal = { x: x + w / 2 - BEACON.w / 2, y: y - BEACON.h, ...BEACON };
    }
    roofs.push(roof);
    x += w;
  }
  const high = Math.min(...roofs.map((r) => r.y)) - BOUNDARY_RISE,
    wall = (wx, slickR = []) => ({
      x: wx,
      y: high,
      w: BOUNDARY_WIDTH,
      h: BOTTOM - high,
      boundary: true,
      chalk: { L: [], R: [] },
      slick: { L: [], R: slickR },
      pads: [],
    });
  return {
    solids: [wall(-BOUNDARY_WIDTH, boundarySlick), ...roofs.map(({ goal, ...r }) => r), wall(x)],
    goal: roofs.find((r) => r.goal).goal,
    width: x + BOUNDARY_WIDTH,
  };
}
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => typeof v === 'object' && v && deepFreeze(v));
  return Object.freeze(o);
};
const course = (en, zh, tipEn, tipZh, look, parts) =>
  deepFreeze({ name: { en, zh }, tip: { en: tipEn, zh: tipZh }, look, ...buildSolids(parts) });

export const LOOKS = deepFreeze([
  { sky: ['#0d1624', '#17283a', '#26414f'], brick: ['#4a3a3f', '#3b2f36', '#5a474b'] },
  { sky: ['#101524', '#1d2540', '#34385a'], brick: ['#3d4153', '#30334a', '#4d526a'] },
  { sky: ['#0a1018', '#142230', '#223a48'], brick: ['#38454d', '#2b363f', '#4a5a63'] },
]);

// Teaching (1-5), combination (6-15) and mastery (16-20) curve. Tips match what each course does.
export const COURSES = deepFreeze([
  course(
    'Gutter Row',
    '滴水檐巷',
    'Hold Right and tap Space to jump the gaps.',
    '按住右键前进，按空格跳过缺口。',
    0,
    [
      [0, 0, 200, 'pad'],
      [34, 0, 110],
      [42, 0, 100],
      [46, 0, 100, 'pad'],
      [50, 0, 130],
      [50, 0, 150, 'goal'],
    ],
  ),
  course(
    'Stepping Stones',
    '阶梯屋顶',
    'Jump up onto higher roofs. Pads refill energy.',
    '跳上更高的屋顶，接力台可补充能量。',
    0,
    [
      [0, 0, 160, 'pad'],
      [40, 30, 90],
      [46, -20, 80],
      [52, 40, 80],
      [48, 0, 90, 'pad'],
      [54, -30, 80],
      [56, 25, 80],
      [58, 0, 100, 'pad'],
      [50, 0, 140, 'goal'],
    ],
  ),
  course(
    'Chalk Wall',
    '粉笔墙',
    'Run at a chalk wall and hold X to climb it.',
    '冲向粉笔墙，按住X向上攀爬。',
    0,
    [
      [0, 0, 160, 'pad'],
      [46, 0, 100],
      [0, 100, 110, 'chalkW'],
      [52, -60, 100],
      [58, 0, 90],
      [60, 0, 100, 'pad'],
      [0, 90, 120, 'chalkW'],
      [52, 0, 60],
      [50, 0, 130, 'goal'],
    ],
  ),
  course(
    'Tall Climb',
    '高墙攀登',
    'Climbing costs energy. Refill on RELAY pads.',
    '攀爬消耗能量，到接力台补充。',
    0,
    [
      [0, 0, 140, 'pad'],
      [0, 200, 130, 'chalkW', 'pad'],
      [48, 0, 90],
      [54, -120, 100, 'pad'],
      [0, 160, 120, 'chalkW'],
      [56, -40, 80],
      [50, 0, 120, 'goal'],
    ],
  ),
  course(
    'Kick Shaft',
    '蹬墙竖井',
    'Space on a wall kicks you across; kick the next wall.',
    '贴墙按空格蹬向对面，落到对面墙再蹬。',
    1,
    [
      [0, 0, 26, 'pad'],
      [0, 150, 100, 'pad'],
      [50, 0, 100],
      [56, 0, 110, 'goal'],
    ],
  ),
  course(
    'Slick Ledge',
    '湿滑檐角',
    'Slick upper wall: no kick. Kick low, then run chalk.',
    '上段湿滑不能蹬：低处蹬墙，再跑粉笔墙。',
    1,
    [
      [0, 0, 26, 'pad', 'slickB:-150:-70'],
      [0, 150, 100, 'chalkW:-24:50', 'pad'],
      [52, 0, 90],
      [58, -20, 90, 'goal'],
    ],
  ),
  course(
    'Rain Gutters',
    '雨檐短跳',
    'Short roofs: jump at the edge, land, jump again.',
    '屋顶很短：在边缘起跳，落地再跳。',
    1,
    [
      [0, 0, 100, 'pad'],
      [40, 0, 40],
      [42, 10, 36],
      [44, -10, 40],
      [46, 0, 36, 'pad'],
      [48, 10, 40],
      [50, 0, 32],
      [52, 0, 40, 'pad'],
      [54, 0, 100, 'goal'],
    ],
  ),
  course(
    'Antenna Canyon',
    '天线深谷',
    'Two chalk climbs. Rest on the pad between them.',
    '两次粉笔墙攀爬，中间在接力台休息。',
    1,
    [
      [0, 0, 120, 'pad'],
      [0, 170, 90, 'chalkW'],
      [56, -60, 60],
      [58, 0, 50, 'pad'],
      [0, 130, 100, 'chalkW'],
      [56, 0, 70],
      [60, 0, 100, 'goal'],
    ],
  ),
  course(
    'Stair Shafts',
    '双层竖井',
    'Kick across, then kick the next wall. Pad between.',
    '蹬向对面，再蹬对面墙；中间有接力台补能。',
    1,
    [
      [0, 0, 26, 'pad'],
      [0, 110, 150, 'pad:20:110'],
      [0, -110, 26, 'pad'],
      [0, 110, 100, 'pad'],
      [54, 0, 90],
      [58, 0, 110, 'goal'],
    ],
  ),
  course(
    'Wide Gaps',
    '宽缺口',
    'Wide gaps: jump right at the roof edge.',
    '缺口很宽：在屋檐边缘起跳。',
    2,
    [
      [0, 0, 140, 'pad'],
      [62, 0, 60],
      [64, 10, 60],
      [66, 0, 60],
      [60, -20, 80, 'pad'],
      [64, 0, 60],
      [68, 10, 60],
      [58, 0, 120, 'goal'],
    ],
  ),
  course(
    'Chalk Staircase',
    '粉笔阶梯',
    'Chalk steps up, then drops. Keep your speed.',
    '粉笔台阶向上，随后下落，保持速度。',
    2,
    [
      [0, 0, 120, 'pad'],
      [0, 70, 40, 'chalkW'],
      [0, 70, 40, 'chalkW'],
      [0, 70, 40, 'chalkW'],
      [0, 70, 70, 'chalkW', 'pad'],
      [60, -90, 60],
      [60, -60, 60],
      [56, 0, 120, 'goal'],
    ],
  ),
  course(
    'Pit Climb',
    '深坑攀登',
    'Kick across the pit, then run the chalk above.',
    '在深坑两墙间蹬跃，再跑上方粉笔墙。',
    2,
    [
      [0, 0, 26, 'pad'],
      [0, 190, 100, 'chalkW:-24:80', 'pad'],
      [60, 0, 80],
      [62, -10, 80],
      [60, 0, 120, 'goal'],
    ],
  ),
  course(
    'Drop Zone',
    '坠落区',
    'Walk off short ledges to drop; jump the last gaps.',
    '从短檐走下去；最后的缺口要起跳。',
    2,
    [
      [0, 200, 110, 'pad'],
      [24, -80, 50],
      [22, -70, 50],
      [26, -40, 60, 'pad'],
      [0, 120, 40, 'chalkW'],
      [26, -60, 50],
      [26, -60, 60, 'pad'],
      [68, 0, 40],
      [70, 0, 40],
      [64, 0, 110, 'goal'],
    ],
  ),
  course(
    'Relay Marathon',
    '接力马拉松',
    'A long route: climb, hop, climb. Rest on each pad.',
    '漫长路线：攀爬、跳跃、再攀爬，逐台休息。',
    2,
    [
      [0, 0, 120, 'pad'],
      [0, 150, 90, 'chalkW', 'pad'],
      [60, -20, 70],
      [62, 0, 60],
      [0, 150, 90, 'chalkW', 'pad'],
      [60, 0, 60],
      [64, 10, 50],
      [0, 100, 80, 'chalkW', 'pad'],
      [60, 0, 120, 'goal'],
    ],
  ),
  course(
    'Needle Roofs',
    '针尖屋顶',
    'Narrow roofs, long gaps. Jump at the very edge.',
    '屋顶窄、缺口长，在最边缘起跳。',
    0,
    [
      [0, 0, 100, 'pad'],
      [66, 0, 34],
      [68, 10, 30],
      [66, -10, 34],
      [68, 0, 30, 'pad'],
      [66, 10, 34],
      [70, 0, 30],
      [68, -10, 34],
      [66, 0, 40, 'pad'],
      [66, 0, 100, 'goal'],
    ],
  ),
  course(
    'Slick Spire',
    '湿滑尖塔',
    'Slick upper left wall: kick low, run chalk high.',
    '左壁上段湿滑：低处蹬墙，高处跑粉笔。',
    0,
    [
      [0, 0, 26, 'pad', 'slickB:-250:-110'],
      [0, 250, 100, 'chalkW:-24:110', 'pad'],
      [72, 0, 34],
      [70, 10, 34],
      [74, 0, 100, 'pad'],
      [74, 0, 34],
      [71, 10, 34],
      [74, 0, 100, 'goal'],
    ],
  ),
  course(
    'Thin Air',
    '稀薄高空',
    'Small steps up and wide gaps. Rest on the pads.',
    '小台阶向上，缺口宽，在接力台休息。',
    0,
    [
      [0, 0, 100, 'pad'],
      [67, 20, 34],
      [67, 20, 100, 'pad'],
      [60, 0, 34],
      [71, 10, 100, 'pad'],
      [74, 0, 34],
      [71, 10, 34],
      [74, 0, 100, 'goal'],
    ],
  ),
  course(
    'Storm Line',
    '风暴线',
    'Chalk, drops and long gaps. Mind your energy.',
    '粉笔墙、下落和长缺口，留意能量。',
    0,
    [
      [0, 0, 100, 'pad'],
      [0, 160, 80, 'chalkW'],
      [64, -100, 40],
      [74, 0, 36],
      [0, 100, 100, 'chalkW', 'pad'],
      [66, -60, 34],
      [74, 0, 34],
      [71, 10, 34],
      [74, 0, 100, 'pad'],
      [72, 0, 34],
      [70, 0, 100, 'goal'],
    ],
  ),
  course(
    'Final Relay',
    '终章接力',
    'Climb and long gaps. Pad up before each one.',
    '攀爬加长缺口，每一段之前先补满能量。',
    0,
    [
      [0, 0, 100, 'pad'],
      [0, 150, 100, 'chalkW', 'pad'],
      [66, -40, 36],
      [74, 0, 34],
      [71, 10, 34],
      [0, 140, 100, 'chalkW', 'pad'],
      [66, -30, 34],
      [74, 0, 30],
      [72, 0, 34],
      [70, 10, 100, 'pad'],
      [64, 0, 110, 'goal'],
    ],
  ),
  course(
    'Gauntlet',
    '极限试炼',
    'Everything at once. Fill up on the pad first.',
    '一切同时出现，先在接力台补满能量。',
    0,
    [
      [0, 0, 100, 'pad'],
      [72, 0, 34],
      [70, 10, 34],
      [0, 120, 100, 'chalkW', 'pad'],
      [74, 0, 34],
      [64, 20, 34],
      [72, -10, 100, 'pad'],
      [74, 0, 34],
      [0, 140, 50, 'chalkW'],
      [77, -20, 34],
      [74, 0, 100, 'goal'],
    ],
  ),
]);
export const LEVEL_COUNT = COURSES.length;
export const getCourse = (n) => COURSES[n - 1];

export const PADS = deepFreeze(
  COURSES.map((c) => {
    const pads = [];
    c.solids.forEach((s, solid) =>
      s.pads.forEach(([x0, x1]) => pads.push({ id: pads.length, solid, x0, x1, y: s.y })),
    );
    return pads;
  }),
);
