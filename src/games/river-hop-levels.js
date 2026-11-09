// Crossing data: every level is a table of seven lanes (three water rows, four road rows).
import { clamp } from '../shared/utils.js';

export const WIDTH = 480;
export const TOP = 34;
export const ROW = 28;
export const LANE_ROWS = Object.freeze([1, 2, 3, 5, 6, 7, 8]);
export const FERRY_PERIOD = 10;
export const TURTLE_CYCLE = 8;
export const TURTLE_WARN = 5.4;
export const TURTLE_DIVE = 6.6;

const freezeAll = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(freezeAll);
  return Object.freeze(value);
};
// [kind, deck width, spacing, speed px/s, offset] - kind: log, turtle, ferry, car, none.
const L = (kind, w, spacing, speed, offset = 0) => ({ kind, w, spacing, speed, offset });
const NONE = L('none', 0, 0, 0);
const LANE_KINDS = Object.freeze({
  log: 'logs',
  turtle: 'turtles',
  car: 'traffic',
  none: 'traffic',
});
const FERRY = L('ferry', 180, 0, 0);

const LOGS = (w, spacing, speed, offset) => L('log', w, spacing, speed, offset);
const TURTLES = (w, spacing, speed, offset) => L('turtle', w, spacing, speed, offset);
const CAR = (w, spacing, speed, offset) => L('car', w, spacing, speed, offset);
const level = (name, cue, tip, theme, lanes) => ({ name, cue, tip, theme, lanes });

/** Teaching 1-7, combination 8-14, mastery 15-20. Lane order: rows 1, 2, 3, 5, 6, 7, 8. */
export const LEVELS = freezeAll([
  level(
    { en: 'Meadow Ford', zh: '草地浅滩' },
    { en: 'WAIT FOR A GAP', zh: '等车道空隙' },
    {
      en: 'Tap Up once per hop. Cross the road in a gap, then land both feet on a log.',
      zh: '每次轻点上方向键跳一次；趁车道空隙过马路，双脚落在木台上。',
    },
    0,
    [
      LOGS(150, 190, 20, 20),
      LOGS(150, 190, -22, 70),
      LOGS(160, 190, 18, 10),
      NONE,
      NONE,
      CAR(40, 280, -36, 40),
      CAR(44, 300, 30, 160),
    ],
  ),
  level(
    { en: 'Slow Lanes', zh: '慢速车道' },
    { en: 'REST ON THE GRASS', zh: '草地可以休息' },
    {
      en: 'Three road lanes now. Wait on the grass for a gap; the middle strip is a safe rest.',
      zh: '现在有三条车道。在草地等空隙；中间的草带可以安全休息。',
    },
    0,
    [
      LOGS(150, 190, 22, 90),
      LOGS(150, 190, -24, 30),
      LOGS(150, 190, 20, 130),
      NONE,
      CAR(40, 260, 30, 60),
      CAR(44, 250, -38, 150),
      CAR(40, 240, 34, 20),
    ],
  ),
  level(
    { en: 'Four Lanes', zh: '四条车道' },
    { en: 'WATCH EVERY LANE', zh: '留意每条车道' },
    {
      en: 'All four lanes are busy. Cars are taller than your hop, so wait for a clear run.',
      zh: '四条车道都有车。车比你的跳跃更高，要等一段畅通的路再过。',
    },
    1,
    [
      LOGS(130, 190, 26, 40),
      LOGS(130, 190, -28, 100),
      LOGS(140, 190, 24, 150),
      CAR(44, 250, -40, 100),
      CAR(48, 260, 34, 20),
      CAR(44, 240, -42, 150),
      CAR(48, 250, 38, 70),
    ],
  ),
  level(
    { en: 'Striped Turtles', zh: '条纹乌龟' },
    { en: '↓ STRIPES: DIVE', zh: '↓ 条纹：即将潜水' },
    {
      en: 'Striped turtles with a down arrow dive soon. Hop on, then move on before they sink.',
      zh: '带↓的条纹乌龟马上要潜水。跳上去，在它们下沉前继续前进。',
    },
    1,
    [
      LOGS(150, 190, 22, 40),
      LOGS(150, 190, -24, 100),
      TURTLES(110, 190, 26, 30),
      NONE,
      CAR(44, 260, 34, 60),
      CAR(44, 250, -40, 140),
      CAR(44, 250, 36, 20),
    ],
  ),
  level(
    { en: 'Dive Drill', zh: '潜水练习' },
    { en: '↓ MEANS LEAVE NOW', zh: '↓ 表示马上离开' },
    {
      en: 'The middle water row has turtles. Wait for a safe moment, then hop through the row.',
      zh: '中间水道有乌龟。等到安全时机，再一路跳过这一行。',
    },
    1,
    [
      LOGS(150, 190, 24, 70),
      TURTLES(110, 190, -28, 100),
      LOGS(150, 190, 26, 20),
      NONE,
      CAR(44, 260, -36, 40),
      CAR(48, 250, 40, 120),
      CAR(44, 250, -34, 180),
    ],
  ),
  level(
    { en: 'Cable Ferry', zh: '缆绳渡船' },
    { en: 'RIDE, THEN HOP UP', zh: '搭船靠岸再上跳' },
    {
      en: 'The top water row is a cable ferry that turns around. Ride it toward a free pad, then hop up.',
      zh: '最上方水道是会往返的缆绳渡船。搭船靠近空荷叶，再向上跳回家。',
    },
    2,
    [
      FERRY,
      LOGS(150, 190, -24, 100),
      LOGS(150, 190, 22, 30),
      NONE,
      CAR(44, 260, 36, 60),
      CAR(44, 250, -40, 140),
      CAR(44, 250, 34, 20),
    ],
  ),
  level(
    { en: 'Rush Hour', zh: '高峰时段' },
    { en: 'TRUCKS ARE LONG', zh: '卡车更长' },
    {
      en: 'Faster cars and long trucks. Gaps are shorter, so pick a clear run and keep hopping.',
      zh: '车更快，还有长卡车。空隙更短，选好畅通的时机再连续跳过。',
    },
    2,
    [
      LOGS(130, 190, 28, 40),
      LOGS(130, 190, -30, 100),
      LOGS(130, 190, 26, 150),
      CAR(76, 300, -46, 100),
      CAR(44, 230, 52, 20),
      CAR(76, 300, -50, 150),
      CAR(44, 230, 48, 70),
    ],
  ),
  level(
    { en: 'Mixed Marsh', zh: '混合沼泽' },
    { en: 'LOGS AND TURTLES', zh: '木头与乌龟' },
    {
      en: 'Logs and striped turtles share the river. Trucks mix with cars on the road.',
      zh: '木头和条纹乌龟共用河道，公路上卡车和小车混行。',
    },
    3,
    [
      LOGS(120, 190, -26, 20),
      TURTLES(96, 180, 30, 70),
      LOGS(130, 190, 28, 120),
      CAR(44, 230, -44, 40),
      CAR(76, 300, 40, 130),
      CAR(44, 220, -50, 180),
      CAR(44, 240, 44, 90),
    ],
  ),
  level(
    { en: 'Ferry Marsh', zh: '渡船沼泽' },
    { en: 'FERRY, THEN TURTLES', zh: '先渡船后乌龟' },
    {
      en: 'The ferry takes the top row and turtles carry the bottom row. Time each hop.',
      zh: '最上方是渡船，最下方是乌龟。每一跳都要掌握好时机。',
    },
    3,
    [
      FERRY,
      LOGS(130, 190, -26, 60),
      TURTLES(110, 190, 28, 20),
      CAR(44, 230, 44, 100),
      CAR(48, 240, -46, 30),
      CAR(44, 230, 48, 150),
      CAR(48, 240, -42, 80),
    ],
  ),
  level(
    { en: 'Long Haul', zh: '长途货运' },
    { en: 'LONG GAPS, LONG WAITS', zh: '空隙长，等待也长' },
    {
      en: 'Slow convoys with long trucks and longer gaps. Be patient and cross in the open.',
      zh: '长卡车组成慢车队，空隙更长。耐心等待，在空档中通过。',
    },
    0,
    [
      LOGS(110, 180, 30, 30),
      LOGS(110, 180, -32, 100),
      LOGS(110, 180, 28, 60),
      CAR(96, 360, -34, 100),
      CAR(96, 340, 30, 20),
      CAR(96, 360, -36, 200),
      CAR(96, 340, 32, 140),
    ],
  ),
  level(
    { en: 'Twin Turtles', zh: '双层乌龟' },
    { en: 'BOTH ROWS DIVE', zh: '两行同时潜水' },
    {
      en: 'Two turtle rows dive together. Cross both while the stripes are calm.',
      zh: '两行乌龟会同时潜水。趁条纹平静时一口气跳过两行。',
    },
    1,
    [
      LOGS(120, 190, 24, 100),
      TURTLES(100, 180, -30, 40),
      TURTLES(100, 180, 26, 90),
      CAR(44, 230, -46, 40),
      CAR(48, 240, 42, 110),
      CAR(44, 230, -48, 160),
      CAR(48, 240, 40, 30),
    ],
  ),
  level(
    { en: 'Ferry Rush', zh: '渡船冲刺' },
    { en: 'FERRY AND FAST CARS', zh: '渡船与快车' },
    {
      en: 'Fast cars below and a cable ferry above. Cross the road, then catch the ferry.',
      zh: '下方快车，上方缆绳渡船。先过马路，再赶上渡船。',
    },
    2,
    [
      FERRY,
      LOGS(110, 190, 34, 50),
      LOGS(110, 190, -36, 100),
      CAR(44, 210, -60, 40),
      CAR(44, 210, 64, 100),
      CAR(44, 210, -62, 160),
      CAR(44, 210, 60, 30),
    ],
  ),
  level(
    { en: 'Narrow Logs', zh: '窄木台' },
    { en: 'AIM FOR THE MIDDLE', zh: '对准木台中央' },
    {
      en: 'These logs are short, so land near the middle of one. Both feet need wood.',
      zh: '木头很短，要落在中央附近。双脚都需要踩到木头。',
    },
    3,
    [
      LOGS(76, 150, 36, 40),
      LOGS(76, 150, -38, 100),
      LOGS(76, 150, 34, 70),
      CAR(44, 230, -50, 40),
      CAR(48, 240, 46, 120),
      CAR(44, 230, -52, 180),
      CAR(48, 240, 44, 70),
    ],
  ),
  level(
    { en: 'Convoy', zh: '车队' },
    { en: 'TURTLES UNDER TRUCKS', zh: '卡车与乌龟' },
    {
      en: 'Long truck convoys on the road and turtles on the middle row. Plan the whole run.',
      zh: '公路上是长卡车车队，中间水道是乌龟。要先规划好整段路线。',
    },
    0,
    [
      LOGS(100, 180, 36, 80),
      TURTLES(90, 170, -36, 30),
      LOGS(100, 180, 32, 120),
      CAR(100, 330, -46, 60),
      CAR(44, 220, 58, 140),
      CAR(100, 330, -48, 160),
      CAR(44, 220, 56, 10),
    ],
  ),
  level(
    { en: 'Speed Run', zh: '极速渡口' },
    { en: 'EVERYTHING IS FASTER', zh: '一切都更快' },
    {
      en: 'Everything moves faster. Decide early and hop with a steady rhythm.',
      zh: '一切都更快了。尽早决定，保持稳定的节奏连续跳跃。',
    },
    1,
    [
      LOGS(100, 180, 48, 20),
      LOGS(100, 180, -50, 90),
      LOGS(100, 180, 46, 140),
      CAR(44, 190, -72, 60),
      CAR(48, 200, 76, 160),
      CAR(44, 190, -74, 100),
      CAR(48, 200, 70, 20),
    ],
  ),
  level(
    { en: 'Turtle Gauntlet', zh: '乌龟关卡' },
    { en: 'TURTLES ON TWO ROWS', zh: '两行乌龟' },
    {
      en: 'Turtles on the top and bottom rows with a log between. Keep an eye on the arrows.',
      zh: '最上和最下行是乌龟，中间是木头。留意潜水箭头。',
    },
    2,
    [
      TURTLES(80, 160, -36, 30),
      LOGS(90, 160, 40, 90),
      TURTLES(80, 160, 34, 60),
      CAR(44, 200, -58, 80),
      CAR(48, 210, 56, 20),
      CAR(44, 200, -60, 150),
      CAR(48, 210, 54, 110),
    ],
  ),
  level(
    { en: 'Ferry Gauntlet', zh: '渡船关卡' },
    { en: 'FERRY OVER TURTLES', zh: '渡船加乌龟' },
    {
      en: 'Ferry on top, turtles in the middle and fast trucks below. Chain your hops.',
      zh: '上方渡船，中间乌龟，下方是快速卡车。把每一跳连起来。',
    },
    3,
    [
      FERRY,
      TURTLES(80, 160, -38, 70),
      LOGS(90, 160, 36, 130),
      CAR(76, 250, -58, 100),
      CAR(44, 190, 66, 30),
      CAR(76, 250, -60, 200),
      CAR(44, 190, 64, 120),
    ],
  ),
  level(
    { en: 'Dense Traffic', zh: '拥挤车流' },
    { en: 'SHORT GAPS', zh: '空隙很短' },
    {
      en: 'Traffic is dense, with short gaps in every lane. Wait for a clear run and move together.',
      zh: '车流拥挤，每条车道的空隙都很短。等到畅通时机再一气呵成。',
    },
    0,
    [
      LOGS(100, 170, 40, 20),
      LOGS(100, 170, -42, 100),
      LOGS(100, 170, 38, 150),
      CAR(40, 175, -58, 100),
      CAR(40, 175, 60, 30),
      CAR(40, 175, -58, 20),
      CAR(40, 175, 60, 140),
    ],
  ),
  level(
    { en: 'Narrow and Fast', zh: '又窄又快' },
    { en: 'SMALL DECKS, FAST FLOW', zh: '窄台快流' },
    {
      en: 'Short logs and turtles move fast. Land near the middle of each deck.',
      zh: '短木头和乌龟移动很快。要落在每个浮台的中间附近。',
    },
    1,
    [
      LOGS(70, 140, 46, 40),
      TURTLES(72, 140, -44, 100),
      LOGS(70, 140, 44, 70),
      CAR(44, 190, -66, 40),
      CAR(48, 200, 64, 120),
      CAR(44, 190, -68, 180),
      CAR(48, 200, 62, 70),
    ],
  ),
  level(
    { en: 'Grand Crossing', zh: '大渡口' },
    { en: 'EVERYTHING AT ONCE', zh: '全部挑战' },
    {
      en: 'The ferry, striped turtles, short logs and dense trucks all at once. Stay calm.',
      zh: '渡船、条纹乌龟、短木头和密集卡车同时出现。保持冷静。',
    },
    2,
    [
      FERRY,
      TURTLES(80, 150, -40, 40),
      LOGS(70, 140, 42, 90),
      CAR(76, 230, -60, 100),
      CAR(44, 180, 64, 30),
      CAR(76, 230, -62, 200),
      CAR(44, 180, 62, 120),
    ],
  ),
]);
export const LEVEL_COUNT = LEVELS.length;
export const clampLevel = (n) => clamp(Math.floor(Number(n)) || 1, 1, LEVEL_COUNT);

const ferryBounds = (w) => ({ lo: 24, hi: WIDTH - 24 - w });
export const ferryX = (lane, t) =>
  lane.ferry.center + lane.ferry.amp * Math.sin((t * 2 * Math.PI) / lane.ferry.period);
export const ferryV = (lane, t) =>
  ((lane.ferry.amp * 2 * Math.PI) / lane.ferry.period) *
  Math.cos((t * 2 * Math.PI) / lane.ferry.period);

/** Fresh mutable lanes for one level (the level table itself stays frozen). */
export function riverLanes(level) {
  return LEVELS[clampLevel(level) - 1].lanes.map((spec, i) => {
    const row = LANE_ROWS[i],
      water = row < 4,
      { kind, w } = spec;
    if (kind === 'ferry') {
      const { lo, hi } = ferryBounds(w),
        ferry = { center: (lo + hi) / 2, amp: (hi - lo) / 2, period: FERRY_PERIOD },
        lane = { row, water, kind, speed: 0, span: 0, cycle: 0, ferry, objects: [] };
      lane.objects = [{ id: `${row}:0`, x: ferryX(lane, 0), w }];
      return lane;
    }
    const count = spec.spacing ? Math.ceil((WIDTH + 2 * w + 48) / spec.spacing) : 0;
    return {
      row,
      water,
      kind: LANE_KINDS[kind],
      speed: spec.speed,
      span: count * spec.spacing,
      cycle: kind === 'turtle' ? TURTLE_CYCLE : 0,
      objects: Array.from({ length: count }, (_, n) => ({
        id: `${row}:${n}`,
        x: n * spec.spacing + spec.offset - w,
        w,
      })),
    };
  });
}
