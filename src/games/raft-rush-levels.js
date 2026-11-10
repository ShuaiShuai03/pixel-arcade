import { clamp } from '../shared/utils.js';

export const LEVEL_COUNT = 20;
export const START_X = 70;
export const WALL_PAD = 30;
const FIELD_RAMP = 40;
const SAMPLE = 60;
const BANK_WIDEN = 8;
const DOCK_TAIL = 30;
const DEFAULT_DOCK_LENGTH = 130;
const DEFAULT_RAMP = 120;
const DEFAULT_IMPACT = 100;
const EDDY_RADIUS = 50;
const SPAN_SKIP = 8;
const MAX_PLUG = 40;
const WAVE = [0, -1, 1, -0.7, 0.8, -1, 0.6, -0.5];

// Distances are pixels, speeds px/s. Compact rows: flags [x, dy], rocks [x, dy, r], gates [x, gap, dy],
// fields [x0, x1, vx, vy], eddies [x, dy, strength, direction]. dy is measured from the river centre.
// `spare` is how many flags may be missed; `pockets` are [x, speed] flow keys; `ramp` is the length over
// which the water slows into the dock, `dockLength` the width of the dock marker and `impact` the
// bump speed above which the hull is damaged.
const LEVEL_DATA = [
  {
    name: ['Calm Mill', '平静磨坊'],
    tip: [
      'Arrows steer. Take 3 of 4 flags, then stop in the dock.',
      '方向键转向。收 4 面旗中的 3 面，再停进码头。',
    ],
    length: 1400,
    speed: 40,
    half: 82,
    bend: 14,
    flags: [
      [300, -34],
      [600, 36],
      [900, -32],
      [1150, 34],
    ],
    rocks: [[800, 60, 16]],
  },
  {
    name: ['Brake Dock', '刹停码头'],
    tip: [
      'Fast water reaches the dock. Hold X to brake there.',
      '急流直通码头。在码头前按住 X 刹停。',
    ],
    length: 1500,
    speed: 62,
    half: 80,
    bend: 20,
    dockLength: 100,
    ramp: 20,
    flags: [
      [300, -32],
      [650, 36],
      [1000, -32],
      [1250, 32],
    ],
    rocks: [
      [520, -50, 16],
      [900, 54, 16],
    ],
  },
  {
    name: ['Rock Gates', '岩石门'],
    tip: [
      'Steer through the gaps between rocks to reach the flags.',
      '穿过岩石之间的缺口去拿旗帜。',
    ],
    length: 1700,
    speed: 46,
    half: 84,
    bend: 20,
    gates: [
      [450, 108, 22],
      [850, 104, -22],
      [1250, 100, 22],
    ],
    flags: [
      [300, -36],
      [450, 40],
      [850, -40],
      [1250, 40],
      [1480, -34],
    ],
  },
  {
    name: ['Weir Crossing', '堰口逆流'],
    tip: [
      'A back-current slows you. Tap Space for a strong stroke.',
      '逆流会拖慢木筏。点按空格用力划桨冲过去。',
    ],
    length: 1800,
    speed: 42,
    half: 82,
    bend: 18,
    fields: [[700, 940, -118, 0]],
    flags: [
      [300, -34],
      [560, 36],
      [1100, -34],
      [1350, 36],
      [1550, -32],
    ],
    rocks: [[420, -58, 15]],
  },
  {
    name: ['Side Currents', '横向水流'],
    tip: [
      'Side currents shove the raft. Steer against them.',
      '横向水流会推偏木筏。逆着水流修正方向。',
    ],
    length: 1900,
    speed: 48,
    half: 84,
    bend: 22,
    fields: [
      [520, 800, 0, -34],
      [1100, 1400, 0, 36],
    ],
    flags: [
      [320, 36],
      [680, 44],
      [1000, -36],
      [1280, -44],
      [1560, 34],
    ],
    rocks: [[900, 52, 15]],
  },
  {
    name: ['Whirlpools', '漩涡'],
    tip: [
      'Whirlpools spin the water. Ride the swirl or go around.',
      '漩涡会带着水打转。顺着旋流或绕开它。',
    ],
    length: 1900,
    speed: 52,
    half: 84,
    bend: 20,
    eddies: [
      [640, -34, 38, 1],
      [1250, 40, 38, -1],
    ],
    flags: [
      [330, 38],
      [560, 36],
      [1000, -38],
      [1200, -40],
      [1560, 36],
    ],
    rocks: [[900, 50, 15]],
  },
  {
    name: ['Narrow Gates', '窄门'],
    tip: ['Gaps alternate high and low. Line up early.', '缺口一高一低交替出现。提前对准位置。'],
    length: 2000,
    speed: 54,
    half: 82,
    bend: 26,
    gates: [
      [500, 90, -24],
      [880, 88, 24],
      [1260, 86, -24],
      [1640, 84, 24],
    ],
    flags: [
      [330, 36],
      [500, -46],
      [880, 46],
      [1260, -46],
      [1640, 46],
    ],
  },
  {
    name: ['Switchback', '回弯河道'],
    tip: ['The river snakes. Flags sit on alternate sides.', '河道蜿蜒，旗帜分在两侧交替排列。'],
    length: 2200,
    speed: 56,
    half: 66,
    bend: 44,
    flags: [
      [330, -30],
      [720, 32],
      [1120, -32],
      [1520, 32],
      [1900, -30],
    ],
    rocks: [
      [560, 36, 14],
      [1320, -36, 14],
    ],
  },
  {
    name: ['Fast Water', '急流险滩'],
    tip: [
      'Fast water: steer early. Paddling into rocks costs hull.',
      '水流很快：尽早转向。划桨撞岩会损伤船体。',
    ],
    length: 2200,
    speed: 80,
    half: 82,
    bend: 26,
    rocks: [
      [400, -42, 15],
      [660, 46, 16],
      [920, -38, 16],
      [1180, 42, 16],
      [1460, -34, 15],
      [1720, 38, 16],
    ],
    flags: [
      [320, 40],
      [780, -44],
      [1300, 46],
      [1580, -44],
      [1900, 38],
    ],
  },
  {
    name: ['Gate Currents', '门前横流'],
    tip: [
      'Side currents push you off the gates. Hold your line.',
      '横向水流会把你推离缺口。稳住航线。',
    ],
    length: 2300,
    speed: 58,
    half: 82,
    bend: 24,
    gates: [
      [520, 98, 24],
      [1000, 94, -24],
      [1500, 92, 24],
    ],
    fields: [
      [620, 900, 0, -30],
      [1100, 1400, 0, 32],
    ],
    flags: [
      [340, -38],
      [520, 40],
      [1000, -40],
      [1500, 40],
      [1860, -36],
    ],
  },
  {
    name: ['Late Brake', '临门急刹'],
    tip: [
      'The water stays fast almost to the dock. Brake with X.',
      '水流直到码头前才变缓。用 X 刹住木筏。',
    ],
    length: 2100,
    speed: 84,
    half: 80,
    bend: 22,
    dockLength: 56,
    ramp: 10,
    gates: [
      [520, 100, 22],
      [940, 96, -22],
      [1360, 96, 22],
    ],
    flags: [
      [340, -38],
      [520, 38],
      [940, -42],
      [1360, 38],
      [1700, -36],
    ],
  },
  {
    name: ['Weir Gates', '堰后石门'],
    tip: ['Stroke over the back-current, then thread the gates.', '先划过逆流，再穿过石门。'],
    length: 2400,
    speed: 46,
    half: 82,
    bend: 22,
    fields: [[800, 1040, -122, 0]],
    gates: [
      [1300, 98, -24],
      [1700, 94, 24],
    ],
    flags: [
      [330, 38],
      [620, -40],
      [1200, 38],
      [1300, -46],
      [1700, 48],
      [2000, -36],
    ],
  },
  {
    name: ['Whirl Slalom', '漩涡绕行'],
    tip: [
      'Whirlpools sit beside the gates. Use or dodge the spin.',
      '漩涡就在石门旁边。借力或避开旋流。',
    ],
    length: 2500,
    speed: 60,
    half: 84,
    bend: 20,
    eddies: [
      [700, -30, 40, 1],
      [1300, 36, 40, -1],
      [1900, -30, 40, 1],
    ],
    gates: [
      [560, 100, 26],
      [1160, 96, -26],
      [1760, 94, 26],
    ],
    flags: [
      [340, -38],
      [560, 44],
      [1000, 40],
      [1160, -44],
      [1600, -40],
      [1760, 46],
    ],
  },
  {
    name: ['Zigzag Gates', '之字石门'],
    tip: [
      'Six gates swing high and low. Plan each turn ahead.',
      '六道石门忽高忽低。提前规划每次转向。',
    ],
    length: 2500,
    speed: 62,
    half: 78,
    bend: 30,
    gates: [
      [480, 84, -28],
      [800, 82, 28],
      [1120, 82, -28],
      [1440, 80, 28],
      [1760, 80, -28],
      [2080, 78, 28],
    ],
    flags: [
      [340, 36],
      [480, -50],
      [800, 50],
      [1120, -50],
      [1440, 50],
      [1760, -50],
      [2080, 50],
    ],
  },
  {
    name: ['Stamina Run', '体力长途'],
    tip: [
      'Three back-currents in a row. Space strokes cost stamina.',
      '连续三段逆流。空格划桨消耗体力。',
    ],
    length: 2900,
    speed: 46,
    half: 82,
    bend: 22,
    fields: [
      [700, 930, -120, 0],
      [1450, 1690, -124, 0],
      [2200, 2440, -128, 0],
    ],
    gates: [[1100, 100, -24]],
    flags: [
      [340, 38],
      [560, -40],
      [1100, -44],
      [1300, 38],
      [1960, -40],
      [2650, 38],
    ],
  },
  {
    name: ['Razor Gates', '利刃石门'],
    tip: [
      'Mastery: light bumps hurt. Tight gates, miss no flag.',
      '精通：轻碰也会受伤。窄门密布，旗帜不可漏。',
    ],
    length: 2500,
    speed: 104,
    half: 78,
    bend: 28,
    spare: 0,
    impact: 60,
    gates: [
      [500, 60, -32],
      [750, 60, 32],
      [1000, 60, -32],
      [1250, 60, 32],
      [1500, 60, -32],
      [1750, 60, 32],
      [2000, 60, -32],
    ],
    flags: [
      [340, 36],
      [500, -40],
      [750, 40],
      [1000, -40],
      [1250, 40],
      [1500, -40],
      [1750, 40],
      [2000, -40],
    ],
  },
  {
    name: ['Storm Switchback', '风暴回弯'],
    tip: [
      'Mastery: sharp bends and side currents. Every flag counts.',
      '精通：急弯加侧流，每面旗帜都要拿。',
    ],
    length: 2600,
    speed: 100,
    half: 60,
    bend: 50,
    spare: 0,
    impact: 60,
    fields: [
      [700, 960, 0, -36],
      [1500, 1760, 0, 38],
    ],
    gates: [
      [1100, 62, 14],
      [1900, 60, -14],
    ],
    flags: [
      [360, -32],
      [760, 32],
      [1100, 30],
      [1500, -32],
      [1900, -30],
      [2200, 32],
    ],
    rocks: [[560, 30, 13]],
  },
  {
    name: ['Maelstrom', '大漩涡'],
    tip: [
      'Mastery: strong whirlpools beside tight gates. Hold the line.',
      '精通：强漩涡紧挨窄门。稳住航线。',
    ],
    length: 2700,
    speed: 98,
    half: 82,
    bend: 24,
    spare: 0,
    impact: 56,
    eddies: [
      [760, -34, 58, 1],
      [1360, 36, 58, -1],
      [1960, -34, 58, 1],
    ],
    gates: [
      [600, 60, 26],
      [1200, 60, -26],
      [1800, 60, 26],
    ],
    flags: [
      [380, -40],
      [600, 44],
      [1000, 40],
      [1200, -44],
      [1600, -40],
      [1800, 44],
    ],
  },
  {
    name: ['Falls Run', '瀑口冲刺'],
    tip: [
      'Mastery: stroke over two back-currents, brake at the dock.',
      '精通：划过两段逆流，再刹进窄码头。',
    ],
    length: 2800,
    speed: 100,
    half: 80,
    bend: 24,
    spare: 0,
    dockLength: 60,
    ramp: 10,
    impact: 56,
    fields: [
      [900, 1050, -170, 0],
      [1700, 1850, -174, 0],
    ],
    gates: [
      [600, 60, 26],
      [1400, 60, -26],
      [2200, 60, 26],
    ],
    flags: [
      [380, -40],
      [600, 44],
      [1400, -44],
      [2200, 44],
      [2450, -40],
    ],
  },
  {
    name: ['Thunder Gorge', '雷鸣峡谷'],
    tip: [
      'Finale: whirlpools, back-currents and gates. Light bumps hurt.',
      '终章：漩涡、逆流和石门齐上阵。轻碰也会受伤。',
    ],
    length: 3100,
    speed: 104,
    half: 76,
    bend: 32,
    spare: 0,
    dockLength: 56,
    ramp: 10,
    impact: 52,
    eddies: [
      [760, -30, 56, 1],
      [2060, 34, 56, -1],
    ],
    fields: [
      [1100, 1250, -176, 0],
      [2500, 2720, 0, 36],
    ],
    gates: [
      [560, 60, 28],
      [960, 60, -28],
      [1560, 60, 28],
      [1900, 58, -28],
      [2300, 58, 28],
    ],
    flags: [
      [380, -38],
      [560, 40],
      [960, -36],
      [1560, 36],
      [1900, -36],
      [2300, 38],
    ],
  },
];

const lerpKeys = (keys, x) => {
  if (x <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const a = keys[i - 1],
        b = keys[i],
        u = (x - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((v, k) => v + (b[k + 1] - v) * u);
    }
  }
  return keys[keys.length - 1].slice(1);
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const jag = (i) => ((i * 7919) % 11) - 5;

function riverPath(length, half, bend) {
  const keys = [[0, 160, half + BANK_WIDEN]];
  for (let i = 1; i * 400 < length - 300; i++) keys.push([i * 400, 160 + bend * WAVE[i % 8], half]);
  keys.push([length, 160, half + BANK_WIDEN]);
  return keys;
}

function flowKeys(d, dockStart) {
  const ramp = d.ramp ?? DEFAULT_RAMP,
    keys = [
      [0, d.speed * 0.7],
      [200, d.speed],
      [dockStart - ramp, d.speed],
      [dockStart, 6],
      [d.length, 0],
    ];
  return keys;
}

// A gate is a gap between two boulders that each reach back to their bank, so no side channel remains.
function gateRocks([x, gap, dy], half) {
  const top = dy - gap / 2,
    bottom = dy + gap / 2,
    plugs = [];
  const spanTop = top + half,
    spanBottom = half - bottom;
  if (spanTop > SPAN_SKIP) {
    const r = Math.min(MAX_PLUG, spanTop / 2 + 3);
    plugs.push({ x, dy: top - r + 3, r });
  }
  if (spanBottom > SPAN_SKIP) {
    const r = Math.min(MAX_PLUG, spanBottom / 2 + 3);
    plugs.push({ x, dy: bottom + r - 3, r });
  }
  return plugs;
}

function buildLevel(d, index) {
  const path = riverPath(d.length, d.half, d.bend),
    centre = (x) => {
      const [cy, half] = lerpKeys(path, x);
      return { cy, half };
    },
    top = [],
    bottom = [];
  for (let i = 0, x = -WALL_PAD; x < d.length; i++, x += SAMPLE) {
    const { cy, half } = centre(x);
    top.push([x, cy - half + jag(i) * 0.8]);
    bottom.push([x, cy + half - jag(i + 3) * 0.8]);
  }
  const end = centre(d.length);
  top.push([d.length, end.cy - end.half]);
  bottom.push([d.length, end.cy + end.half]);
  const segs = [],
    add = (ax, ay, bx, by, sign) => {
      const len = Math.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, nx: (-(by - ay) / len) * sign, ny: ((bx - ax) / len) * sign });
    };
  for (let i = 1; i < top.length; i++) add(...top[i - 1], ...top[i], 1);
  for (let i = 1; i < bottom.length; i++) add(...bottom[i - 1], ...bottom[i], -1);
  add(d.length, bottom[bottom.length - 1][1], d.length, top[top.length - 1][1], -1);
  add(0, centre(0).cy - centre(0).half, 0, centre(0).cy + centre(0).half, -1);
  const at = (x, dy) => ({ x, y: centre(x).cy + dy }),
    dockLength = d.dockLength ?? DEFAULT_DOCK_LENGTH,
    dock = { x0: d.length - DOCK_TAIL - dockLength, x1: d.length - DOCK_TAIL },
    flags = d.flags.map(([x, dy]) => at(x, dy)),
    rocks = [
      ...(d.rocks ?? []).map(([x, dy, r]) => ({ ...at(x, dy), r })),
      ...(d.gates ?? []).flatMap((g) =>
        gateRocks(g, d.half).map((r) => ({ ...at(r.x, r.dy), r: r.r })),
      ),
    ],
    gates = (d.gates ?? []).map(([x, gap, dy]) => ({
      x,
      y0: centre(x).cy + dy - gap / 2,
      y1: centre(x).cy + dy + gap / 2,
    }));
  return {
    level: index + 1,
    name: { en: d.name[0], zh: d.name[1] },
    tip: { en: d.tip[0], zh: d.tip[1] },
    length: d.length,
    path,
    flow: flowKeys(d, dock.x0),
    need: flags.length - (d.spare ?? 1),
    safeImpact: d.impact ?? DEFAULT_IMPACT,
    centre,
    top,
    bottom,
    segs,
    rocks,
    gates,
    flags,
    fields: (d.fields ?? []).map(([x0, x1, vx, vy]) => ({ x0, x1, vx, vy })),
    eddies: (d.eddies ?? []).map(([x, dy, s, dir]) => ({ ...at(x, dy), r: EDDY_RADIUS, s, dir })),
    dock,
  };
}

export const LEVELS = deepFreeze(LEVEL_DATA.map(buildLevel));

// Water velocity at a point: base flow (fastest mid-river) plus cross-current fields plus eddies.
export function currentAt(level, x, y) {
  const { cy, half } = level.centre(x),
    off = clamp((y - cy) / half, -1, 1);
  let vx = lerpKeys(level.flow, x)[0] * (1 - 0.4 * off * off),
    vy = 0;
  for (const f of level.fields) {
    const w = clamp(Math.min(x - f.x0, f.x1 - x) / FIELD_RAMP, 0, 1);
    vx += f.vx * w;
    vy += f.vy * w;
  }
  for (const e of level.eddies) {
    const dx = x - e.x,
      dy = y - e.y,
      d = Math.hypot(dx, dy);
    if (d < e.r && d > 1e-6) {
      const k = (1 - d / e.r) * e.s * e.dir;
      vx += (-dy / d) * k;
      vy += (dx / d) * k;
    }
  }
  return { vx, vy };
}
