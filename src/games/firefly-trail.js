import { background, drawPixelText as text, clamp } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'firefly-trail',
  name: { en: 'Firefly Trail', zh: '萤火轨迹' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Walk a little lantern freely across moonlit meadows. Press Space to start a glowing trail, circle the fireflies and press Space again to close the loop: every firefly inside the closed shape is caught. The trail fades after a few seconds, and if you cross your own trail the loop closes there at once. A closing line that would cross the trail is refused, and in later meadows a loop wider than the light reaches fizzles. Moths cut any trail they touch and sting the lantern, and each costs one of your three lights, so wait for them to pass. Fill each meadow quota before dawn across 24 meadows.',
    zh: '提着小灯笼在月夜草地上自由行走。按空格开始一条发光的光迹，绕住萤火虫，再按一次空格封圈：封闭图形内的萤火虫全部被捕获。光迹几秒后会渐隐，如果你的路线穿过自己的光迹，圈会当场闭合；会与光迹交叉的封圈线会被拒绝，后期草地里超过光照范围的大圈会失效。飞蛾碰到光迹会把它切断，碰到灯笼会蜇伤你，每次都会损失三盏灯中的一盏，请等它们飞过。在黎明前完成 24 片草地的捕捉数量。',
  },
  keys: [
    { label: { en: 'Move freely', zh: '自由移动' }, keys: 'Arrows / WASD' },
    { label: { en: 'Begin / close the trail', zh: '开始 / 封闭光迹' }, keys: 'Space' },
    { label: { en: 'Cancel the trail', zh: '取消光迹' }, keys: 'X' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Trail', '光迹', 'right'],
    ['KeyX', 'Cancel', '取消', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 0.1,
  speed: 72,
  field: Object.freeze({ x0: 10, y0: 34, x1: 470, y1: 288 }),
  top: 30,
  bottom: 290,
  playerR: 5,
  sample: 4,
  minArea: 500,
  wide: 26000,
  lives: 3,
  invuln: 1.5,
  clearTime: 1.4,
  promptHold: 0.5,
  introTime: 5,
  msgTime: 2.2,
  reach: 24,
  reachEnd: 10,
  startReach: 12,
  thinkTicks: 12,
  lookStep: 0.075,
  cutLook: 1.5,
  cutMargin: 3,
  aheadLook: 1,
  aheadMargin: 2,
  closeSlack: 0.5,
  maxLook: 12,
  stillLook: 2,
  fleeStep: 70,
  reluredAfter: 3,
  startDelays: Object.freeze([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
  pace: 0.9,
  marginPlayer: 16,
  marginTrail: 15,
  catchScore: 100,
  comboScore: 50,
  clearScore: 200,
  lifeScore: 50,
  cleanScore: 100,
  menuCols: 8,
});
const STEP = RULES.step;
const TAU = Math.PI * 2;

// --- Geometry (pure, exported for tests) ---

const pt = (a) => ({ x: a[0], y: a[1] });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Where segment ab meets segment cd, or null. Parallel segments never "cross".
export function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const qx = d.x - c.x;
  const qy = d.y - c.y;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * qy - (c.y - a.y) * qx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry, t, u };
}

export function segmentDistance(a, b, c, d) {
  if (segmentIntersection(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

// Even-odd ray casting: the containment test that decides every capture.
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

// Area actually enclosed under the even-odd rule (the rule that decides captures), so a figure-8
// counts both lobes instead of cancelling them out.
export function coveredArea(poly) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const step = 3;
  let n = 0;
  for (let y = y0 + step / 2; y < Math.max(...ys); y += step)
    for (let x = x0 + step / 2; x < Math.max(...xs); x += step)
      if (pointInPolygon({ x, y }, poly)) n++;
  return n * step * step;
}

// The light reaches only so far: a loop whose bounding box is larger than the meadow's limit
// fizzles, however it is shaped (and however much of its tail has faded).
// The box of everything the trail ever covered counts too, so waiting for the tail to fade
// cannot shrink a wide loop.
export function spreadArea(poly, laid = null) {
  const xs = poly.map((p) => p.x).concat(laid ? [laid.x0, laid.x1] : []);
  const ys = poly.map((p) => p.y).concat(laid ? [laid.y0, laid.y1] : []);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

export function polygonArea(poly) {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(sum) / 2;
}

// --- Motion: every firefly and moth follows a closed-form path of the clock ---

function makeMotion(spec) {
  if (Array.isArray(spec)) {
    const fixed = pt(spec);
    return () => fixed;
  }
  if (spec.c) {
    const [cx, cy] = spec.c;
    return (t) => {
      const a = (spec.ph || 0) + spec.w * t;
      return { x: cx + spec.r * Math.cos(a), y: cy + spec.r * Math.sin(a) };
    };
  }
  const pts = spec.pts.map(pt);
  const ring = spec.loop ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < ring.length; i++)
    cum.push(cum[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y));
  const total = cum[cum.length - 1];
  const period = spec.loop ? total : 2 * total;
  return (t) => {
    let d = (((spec.v * (t + (spec.ph || 0))) % period) + period) % period;
    if (d > total) d = period - d;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return {
      x: ring[i - 1].x + (ring[i].x - ring[i - 1].x) * f,
      y: ring[i - 1].y + (ring[i].y - ring[i - 1].y) * f,
    };
  };
}

function homeOf(spec) {
  if (Array.isArray(spec)) return pt(spec);
  if (spec.c) return pt(spec.c);
  const xs = spec.pts.map((p) => p[0]);
  const ys = spec.pts.map((p) => p[1]);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

// --- Meadows (data) ---

const box = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const orbit = (cx, cy, r, w, ph = 0) => ({ c: [cx, cy], r, w, ph });
const lane = (a, b, v, ph = 0) => ({ pts: [a, b], v, ph });
const moth = (kind, motion) => ({ kind, ...motion });
const flower = (x, y, r = 15) => ({ x, y, r });
const stalker = (a, b, v) => ({ kind: 3, lane: [a, b], v });
const START = [44, 262];

const MEADOWS = [
  {
    name: ['First Light', '第一缕光'],
    tip: ['Space starts a trail. Circle it, Space closes.', '空格开始光迹，绕住它，再按空格封圈。'],
    quota: 1,
    dawn: 70,
    fade: 20,
    flies: [[300, 140]],
    plans: [{ pts: box(256, 100, 344, 180) }],
  },
  {
    name: ['Fading Trail', '渐隐的光迹'],
    tip: ['The trail fades in 6.5 s. Close it in time.', '光迹 6.5 秒后渐隐，及时封圈。'],
    quota: 1,
    dawn: 60,
    fade: 6.5,
    flies: [[330, 150]],
    plans: [{ pts: box(290, 118, 370, 182) }],
  },
  {
    name: ['Two Fireflies', '两只萤火虫'],
    tip: ['The quota counts fireflies: one loop each is fine.', '数量是萤火虫只数：一只一圈也行。'],
    quota: 2,
    dawn: 80,
    fade: 9,
    flies: [
      [250, 200],
      [400, 100],
    ],
    plans: [{ pts: box(205, 160, 295, 240) }, { pts: box(350, 64, 450, 136) }],
  },
  {
    name: ['Cross to Close', '交叉成圈'],
    tip: ['Cross your own trail: the loop closes right there.', '穿过自己的光迹，圈当场闭合。'],
    quota: 1,
    dawn: 70,
    fade: 8,
    flies: [[305, 165]],
    plans: [
      {
        pts: [
          [220, 120],
          [340, 120],
          [340, 210],
          [270, 210],
          [270, 90],
        ],
        cross: true,
      },
    ],
  },
  {
    name: ['Meet the Moth', '遇见飞蛾'],
    tip: ['Moths sting. Wait for one to pass, then cross.', '飞蛾会蜇人。等它飞过再穿越。'],
    quota: 1,
    dawn: 80,
    fade: 12,
    flies: [[360, 150]],
    moths: [moth(0, lane([190, 70], [190, 270], 50))],
    plans: [{ pts: box(310, 108, 410, 192) }],
  },
  {
    name: ['Moths Cut Trails', '飞蛾切断光迹'],
    tip: ['A moth that touches the trail cuts it. Wait first.', '飞蛾碰到光迹会切断它，先等一等。'],
    quota: 1,
    dawn: 90,
    fade: 12,
    flies: [[330, 150]],
    moths: [moth(0, lane([330, 40], [330, 160], 22))],
    plans: [{ pts: box(300, 120, 360, 180) }],
  },
  {
    name: ['Many in One', '一圈多只'],
    tip: ['One loop can catch several fireflies, with a bonus.', '一个圈可捕获多只，还有奖励。'],
    quota: 3,
    dawn: 70,
    fade: 9,
    flies: [
      [300, 130],
      [340, 160],
      [310, 190],
    ],
    plans: [{ pts: box(262, 98, 382, 226) }],
  },
  {
    name: ['Drifting Light', '漂移的光'],
    tip: [
      'Fireflies drift. Circle the whole area they roam.',
      '萤火虫会漂移，圈住它们的整片活动区。',
    ],
    quota: 1,
    dawn: 80,
    fade: 10,
    flies: [orbit(320, 160, 40, 1.2)],
    plans: [{ pts: box(250, 90, 390, 230) }],
  },
  {
    name: ['Flower Beds', '花丛'],
    tip: ['Flowers block the way. Follow the dots around.', '花丛挡路，沿着光点绕过去。'],
    quota: 2,
    dawn: 60,
    wide: 7200,
    fade: 8,
    flies: [
      [330, 150],
      [400, 195],
    ],
    blocks: [
      flower(150, 250, 14),
      flower(150, 215, 14),
      flower(150, 180, 14),
      flower(350, 254, 14),
    ],
    plans: [{ via: [[110, 140]], pts: box(290, 118, 370, 182) }, { pts: box(360, 160, 440, 224) }],
  },
  {
    name: ['Dawn Is Coming', '黎明将至'],
    tip: ['Dawn timer running: catch 4 before it hits zero.', '黎明倒计时：归零前捕获 4 只。'],
    quota: 4,
    dawn: 46,
    wide: 7200,
    fade: 8,
    flies: [
      [160, 105],
      [225, 155],
      [425, 85],
      [415, 235],
    ],
    plans: [
      { pts: box(122, 72, 198, 140) },
      { pts: box(188, 122, 264, 190) },
      { pts: box(385, 53, 465, 117) },
      { pts: box(375, 203, 455, 267) },
    ],
  },
  {
    name: ['Two Lanes', '双航线'],
    tip: [
      'Wide loops fizzle. Keep them small; mind moths.',
      '太大的圈会失效：圈要小，还要留意飞蛾。',
    ],
    quota: 2,
    dawn: 50,
    wide: 7200,
    fade: 6,
    flies: [
      [330, 200],
      [410, 170],
    ],
    moths: [moth(0, lane([130, 150], [130, 280], 30)), moth(0, lane([250, 60], [250, 200], 35, 1))],
    plans: [{ pts: box(290, 168, 370, 232) }, { pts: box(372, 138, 452, 202) }],
  },
  {
    name: ['Drifting Pair', '漂移的一对'],
    tip: ['Both fireflies drift. Give each its own loop.', '两只都在漂移，给每只单独画一个圈。'],
    quota: 2,
    dawn: 28,
    wide: 7200,
    fade: 5,
    flies: [lane([300, 105], [300, 125], 8), lane([365, 175], [385, 175], 10, 1)],
    moths: [moth(0, lane([200, 60], [200, 280], 40))],
    plans: [{ pts: box(262, 77, 338, 153) }, { pts: box(337, 141, 413, 209) }],
  },
  {
    name: ['Hawk Moth', '鹰蛾'],
    tip: [
      'The hawk moth is fast. Wait at its lane, then dash.',
      '鹰蛾很快，在航线前等待再冲过去。',
    ],
    quota: 2,
    dawn: 32,
    wide: 7200,
    fade: 5,
    flies: [
      [365, 70],
      [440, 112],
    ],
    moths: [moth(1, lane([100, 170], [460, 170], 100))],
    plans: [{ pts: box(325, 40, 405, 104) }, { pts: box(400, 82, 466, 142) }],
  },
  {
    name: ['Fade and Moth', '渐隐与飞蛾'],
    tip: [
      'Short trail, moth lane: cross it, then close fast.',
      '光迹短又有飞蛾航线：穿过后快封圈。',
    ],
    quota: 2,
    dawn: 48,
    wide: 7200,
    fade: 6.5,
    flies: [
      [330, 180],
      [395, 140],
    ],
    moths: [moth(0, lane([330, 50], [330, 190], 20))],
    plans: [{ pts: box(360, 108, 430, 172) }, { pts: box(300, 150, 360, 210) }],
  },
  {
    name: ['Cross and Moth', '交叉与飞蛾'],
    tip: ['Close by crossing, and time your walk past the moth.', '交叉成圈，并抓准时机走过飞蛾。'],
    quota: 2,
    dawn: 46,
    wide: 7200,
    fade: 6,
    flies: [
      [295, 155],
      [370, 190],
    ],
    moths: [moth(0, lane([130, 120], [130, 285], 30))],
    plans: [
      {
        pts: [
          [200, 195],
          [325, 195],
          [325, 115],
          [265, 115],
          [265, 225],
        ],
        cross: true,
      },
      { pts: box(335, 160, 405, 224) },
    ],
  },
  {
    name: ['Flower Maze', '花丛迷宫'],
    tip: [
      'Thread the flowers: four small loops catch all four.',
      '穿过花丛，四个小圈捕获全部四只。',
    ],
    quota: 4,
    dawn: 68,
    wide: 7200,
    fade: 5,
    flies: [
      [335, 155],
      [365, 80],
      [390, 240],
      [450, 175],
    ],
    blocks: [
      flower(170, 70),
      flower(170, 105),
      flower(170, 140),
      flower(170, 175),
      flower(170, 210),
      flower(300, 245, 14),
    ],
    moths: [moth(0, lane([260, 60], [260, 280], 40))],
    plans: [
      { via: [[240, 250]], pts: box(327, 48, 403, 112) },
      { pts: box(297, 123, 373, 187) },
      { pts: box(352, 208, 428, 268) },
      { pts: box(412, 143, 466, 207) },
    ],
  },
  {
    name: ['Moth Ring', '飞蛾环'],
    tip: ['The emperor moth circles. Slip past when it is far.', '帝王蛾在盘旋，趁它远时溜过去。'],
    quota: 2,
    dawn: 46,
    wide: 7200,
    fade: 6,
    flies: [
      [310, 140],
      [370, 205],
    ],
    moths: [moth(2, orbit(340, 170, 80, 0.5))],
    plans: [{ pts: box(270, 106, 350, 174) }, { pts: box(330, 172, 410, 238) }],
  },
  {
    name: ['The Stalker', '尾随者'],
    tip: [
      'A stalker shadows you along its lane. Lure it first.',
      '尾随者沿航线跟着你：先引开它，再冲过去。',
    ],
    quota: 2,
    dawn: 40,
    wide: 7200,
    fade: 6,
    flies: [
      [360, 110],
      [410, 160],
    ],
    moths: [moth(3, stalker([250, 50], [250, 280], 36))],
    plans: [
      {
        via: [
          [190, 282],
          [190, 70],
          [300, 70],
        ],
        pts: box(320, 78, 400, 142),
      },
      { pts: box(372, 128, 448, 192) },
    ],
  },
  {
    name: ['Three Lights', '三盏光'],
    tip: [
      'Four loops, a moth lane, a timer. Plan the order.',
      '四个圈、飞蛾航线和倒计时，想好顺序。',
    ],
    quota: 4,
    dawn: 64,
    wide: 7200,
    fade: 5,
    flies: [
      [140, 105],
      [200, 160],
      [340, 90],
      [400, 220],
    ],
    moths: [moth(0, lane([340, 40], [340, 260], 28))],
    plans: [
      { pts: box(102, 73, 178, 137) },
      { pts: box(162, 128, 238, 192) },
      { pts: box(300, 56, 380, 124) },
      { pts: box(360, 186, 440, 254) },
    ],
  },
  {
    name: ['Tangled Garden', '纠缠的花园'],
    tip: [
      'Flowers, a drifter and a moth lane in one garden.',
      '一座花园里有花丛、漂移者和飞蛾航线。',
    ],
    quota: 2,
    dawn: 44,
    wide: 7200,
    fade: 5.5,
    flies: [orbit(340, 170, 18, 1.0), [410, 120]],
    blocks: [flower(150, 150), flower(150, 190), flower(150, 230)],
    moths: [moth(3, stalker([240, 50], [240, 280], 34))],
    plans: [
      {
        via: [
          [200, 272],
          [200, 70],
          [290, 70],
        ],
        pts: box(302, 130, 378, 208),
      },
      { pts: box(375, 86, 455, 150) },
    ],
  },
  {
    name: ['Two Hawks', '双鹰蛾'],
    tip: [
      'Two hawk moths sweep the meadow. Dash between them.',
      '两只鹰蛾扫过草地，在它们之间冲刺。',
    ],
    quota: 2,
    dawn: 32,
    wide: 7200,
    fade: 7,
    flies: [
      [230, 150],
      [300, 150],
    ],
    moths: [moth(1, lane([60, 90], [460, 90], 100)), moth(1, lane([60, 210], [460, 210], 100, 2))],
    plans: [{ pts: box(190, 130, 266, 170) }, { pts: box(264, 130, 340, 170) }],
  },
  {
    name: ['Crossed Loops', '交叉双圈'],
    tip: ['Crossing loops, a stalker and a fading trail.', '交叉圈、尾随者和渐隐的光迹。'],
    quota: 3,
    dawn: 48,
    wide: 7200,
    fade: 6.5,
    flies: [
      [140, 165],
      [190, 240],
      [370, 100],
    ],
    moths: [moth(3, stalker([270, 50], [270, 280], 26))],
    plans: [
      {
        pts: [
          [80, 135],
          [170, 135],
          [170, 195],
          [115, 195],
          [115, 105],
        ],
        cross: true,
      },
      { pts: box(150, 208, 230, 268) },
      {
        via: [
          [200, 255],
          [200, 60],
        ],
        pts: [
          [305, 70],
          [400, 70],
          [400, 130],
          [345, 130],
          [345, 40],
        ],
        cross: true,
      },
    ],
  },
  {
    name: ['Big Meadow', '广阔草地'],
    tip: ['Six fireflies, all needed. Choose your loops well.', '六只萤火虫全都要，想好怎么画圈。'],
    quota: 6,
    dawn: 110,
    wide: 7200,
    fade: 5,
    flies: [
      [115, 95],
      [175, 145],
      [320, 75],
      [385, 125],
      [330, 215],
      [425, 250],
    ],
    moths: [moth(3, stalker([250, 50], [250, 280], 34)), moth(0, lane([335, 40], [335, 270], 28))],
    plans: [
      { pts: box(77, 63, 153, 127) },
      { pts: box(137, 113, 213, 177) },
      {
        via: [
          [200, 272],
          [200, 60],
        ],
        pts: box(282, 43, 358, 107),
      },
      { pts: box(347, 93, 423, 157) },
      { pts: box(292, 183, 368, 247) },
      { pts: box(387, 218, 463, 275) },
    ],
  },
  {
    name: ['Midnight Glade', '午夜林间'],
    tip: [
      'Everything at once: flowers, drifters and two moths.',
      '全部登场：花丛、漂移者和两只飞蛾。',
    ],
    quota: 4,
    dawn: 76,
    wide: 7200,
    fade: 5.5,
    flies: [orbit(330, 160, 18, 1.1), [170, 110], [420, 230], lane([390, 100], [420, 100], 15)],
    blocks: [flower(170, 205), flower(170, 245), flower(60, 120, 14)],
    moths: [moth(2, orbit(330, 160, 95, 0.4)), moth(1, lane([60, 44], [460, 44], 90))],
    plans: [
      { via: [[100, 110]], pts: box(130, 74, 210, 146) },
      { pts: box(292, 122, 368, 200) },
      { pts: box(380, 196, 460, 264) },
      { pts: box(354, 72, 456, 130) },
    ],
  },
];

export const LEVELS = MEADOWS.map((m) => JSON.parse(JSON.stringify(m)));
export const LEVEL_COUNT = MEADOWS.length;

// The authored route of a loop: walk the via points, reach the ring, then trace the corners.
// The polygon it closes is the corner list, or the part of a crossing route that the final leg
// cuts off.
function planPolygon(pts, cross) {
  if (!cross) return pts;
  const last = pts.length - 1;
  const cuts = (k) =>
    k < last - 2 && segmentIntersection(pts[last - 1], pts[last], pts[k], pts[k + 1]);
  const i = pts.findIndex((_, k) => cuts(k));
  const hit = cuts(i);
  return [{ x: hit.x, y: hit.y }, ...pts.slice(i + 1, last)];
}

// Moth hit radii match the drawn bodies (the sprites reach about r + 2 px).
const MOTH_R = [9, 9, 13, 10];

// Kind 3 is the stalker: it patrols nothing, it shadows the lantern along a fixed lane at a
// fixed speed, so it can be out-run and lured but never out-waited.
function buildMoth(spec) {
  if (spec.kind !== 3)
    return { kind: spec.kind, r: MOTH_R[spec.kind], at: makeMotion(spec), spec, hunt: null };
  const [a, b] = spec.lane.map(pt);
  const len = dist(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { kind: 3, r: MOTH_R[3], at: () => mid, spec, hunt: { a, b, len, v: spec.v } };
}
const laneU = (h, q) =>
  clamp(((q.x - h.a.x) * (h.b.x - h.a.x) + (q.y - h.a.y) * (h.b.y - h.a.y)) / h.len, 0, h.len);
const laneAt = (h, u) => ({
  x: h.a.x + ((h.b.x - h.a.x) * u) / h.len,
  y: h.a.y + ((h.b.y - h.a.y) * u) / h.len,
});

function buildMeadow(def) {
  return {
    ...def,
    start: pt(def.start || START),
    wide: def.wide || RULES.wide,
    blocks: def.blocks || [],
    flies: def.flies.map((spec, id) => ({ id, at: makeMotion(spec), home: homeOf(spec) })),
    moths: (def.moths || []).map((spec) => buildMoth(spec)),
    plans: def.plans.map((plan) => {
      const via = (plan.via || []).map(pt);
      const pts = plan.pts.map(pt);
      return {
        route: [...via, ...pts],
        ring: via.length,
        cross: !!plan.cross,
        poly: planPolygon(pts, !!plan.cross),
      };
    }),
  };
}
const BUILT = MEADOWS.map(buildMeadow);

// --- State ---

const TXT = {
  walk: ['Arrows: walk to the gold ring', '方向键：走到金色圆环', 'go'],
  start: ['Press Space to start the trail', '按空格开始光迹', 'space'],
  trace: ['Arrows: follow the dots', '方向键：沿着光点走', 'go'],
  cross: ['Arrows: cross your own trail', '方向键：穿过自己的光迹', 'go'],
  close: ['Press Space to close the loop', '按空格封圈', 'space'],
  wait: ['Moth near! Release the Arrows', '飞蛾靠近！松开方向键', 'wait'],
  flee: ['Moth close! Back away with the Arrows', '飞蛾太近！用方向键后退', 'go'],
  cut: ['Moth cuts trail! Space closes, X cancels', '飞蛾要切断光迹！空格封圈，X取消', 'wait'],
  free: ['Arrows draw, Space closes, X cancels', '方向键画线，空格封圈，X取消', 'free'],
  idle: ['Arrows: go to a firefly, Space starts', '方向键靠近萤火虫，空格开始', 'free'],
  clear: ['Well done! Arrows keep moving', '做得好！方向键继续走', 'idle'],
  menu: ['Arrows choose, Space plays', '方向键选择，空格开始', 'menu'],
};
const URGENT = new Set(['start', 'close', 'wait', 'flee', 'cut']);
const DANGER = new Set(['wait', 'flee', 'cut']);

const say = (s, en, zh, time = RULES.msgTime) => {
  s.msg = { en, zh, time };
};

function loadMeadow(s, index) {
  const L = BUILT[index];
  s.level = index;
  s.L = L;
  s.p = { x: L.start.x, y: L.start.y, moving: false, dx: 0, dy: 0 };
  s.t = 0;
  s.lives = RULES.lives;
  s.inv = RULES.invuln;
  s.caught = 0;
  s.trail = { on: false, pts: [] };
  s.flies = L.flies.map((f) => ({ id: f.id, alive: true, ...f.at(0) }));
  s.moths = L.moths.map((m) => ({
    ...m.at(0),
    px: m.at(0).x,
    py: m.at(0).y,
    u: m.hunt ? m.hunt.len / 2 : 0,
  }));
  s.meadowTrouble = 0;
  s.clear = 0;
  s.flash = null;
  s.mark = null;
  s.menu = null;
  s.plan = null;
  s.line = null;
  resetPlan(s);
  say(s, L.tip[0], L.tip[1], RULES.introTime);
  think(s, true);
}

// Progress is a convenience: a store that throws or answers nonsense must not stop the game.
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress?.unlocked?.()));
    return Number.isNaN(n) ? 1 : clamp(n, 1, LEVEL_COUNT);
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, level) {
  try {
    progress?.unlock?.(level);
  } catch {
    // A broken store only costs the saved progress.
  }
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    mode: env.mode || 1,
    acc: 0,
    ticks: 0,
    refresh: false,
    queued: false,
    msg: null,
    progress: env.progress || null,
    stats: { loops: 0, caught: 0, cuts: 0, hits: 0, refused: 0, cancels: 0 },
  };
  const unlocked = readUnlocked(s.progress);
  loadMeadow(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    think(s, true);
  }
  return s;
}

// --- Guide: which authored loop is next, and how far along it the lantern is ---

function resetPlan(s) {
  s.plan = null;
  const alive = s.flies.filter((f) => f.alive);
  const loop = s.L.plans.findIndex((pl) =>
    alive.some((f) => pointInPolygon(s.L.flies[f.id].home, pl.poly)),
  );
  if (loop >= 0) s.plan = { loop, idx: 0 };
  followPlan(s);
}

function followPlan(s) {
  if (!s.plan) return;
  const { route, ring } = s.L.plans[s.plan.loop];
  if (s.trail.on) {
    // Corners count a little early (a lantern that reacts late still turns in time); the last
    // point of a route has to be reached for real, because a crossing loop closes on the way to it.
    const reached = (k) =>
      dist(s.p, route[k]) <= (k === route.length - 1 ? RULES.reachEnd : RULES.reach);
    while (s.plan.idx < route.length && reached(s.plan.idx)) s.plan.idx++;
    return;
  }
  while (s.plan.idx < ring && dist(s.p, route[s.plan.idx]) <= RULES.reach) s.plan.idx++;
}

function hintOf(s) {
  if (!s.plan) return null;
  const pl = s.L.plans[s.plan.loop];
  const { idx } = s.plan;
  const n = pl.route.length;
  let kind;
  if (!s.trail.on)
    kind = dist(s.p, pl.route[pl.ring]) <= RULES.startReach && idx >= pl.ring ? 'start' : 'walk';
  else if (idx >= n) kind = 'close';
  else kind = pl.cross && idx === n - 1 ? 'cross' : 'trace';
  const target = pl.route[Math.min(idx, n - 1)];
  return {
    kind,
    target,
    remaining: pl.route.slice(idx),
    ring: pl.route[pl.ring],
    loop: s.plan.loop,
    index: idx,
  };
}

// --- Look-ahead: would the lantern or its trail meet a moth while following the guide? ---

const routeLength = (route) => route.reduce((n, q, i) => (i ? n + dist(route[i - 1], q) : 0), 0);

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function along(poly, d) {
  let i = 1;
  let left = d;
  while (i < poly.length - 1 && left > dist(poly[i - 1], poly[i])) {
    left -= dist(poly[i - 1], poly[i]);
    i++;
  }
  const len = dist(poly[i - 1], poly[i]);
  const f = len === 0 ? 0 : Math.min(1, left / len);
  return {
    x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * f,
    y: poly[i - 1].y + (poly[i].y - poly[i - 1].y) * f,
  };
}

// The point of the stretch of poly between distances from and to that is nearest m, when that is
// closer than reach; otherwise null.
function laidNear(poly, from, to, m, reach) {
  let at = 0;
  for (let i = 1; i < poly.length; i++) {
    const len = dist(poly[i - 1], poly[i]);
    const lo = Math.max(at, from);
    const hi = Math.min(at + len, to);
    if (hi > lo) {
      const a = along(poly, lo);
      const b = along(poly, hi);
      if (pointSegmentDistance(m, a, b) < reach) return closestOnSegment(m, a, b);
    }
    at += len;
  }
  return null;
}

function mothsClear(s, poly, trailFrom, delay, horizon, doneAt = Infinity, pace = RULES.pace) {
  const total = routeLength(poly);
  const old = s.trail.on ? s.trail.pts.filter((_, i) => i % 3 === 0) : [];
  const chase = s.moths.map((m) => m.u);
  let before = 0;
  for (let tau = 0; tau <= horizon; tau += RULES.lookStep) {
    const d = Math.min(total, RULES.speed * pace * Math.max(0, tau - delay));
    const q = along(poly, d);
    for (const [i, m] of s.L.moths.entries()) {
      let at;
      if (m.hunt) {
        const step = m.hunt.v * (tau - before);
        chase[i] += clamp(laneU(m.hunt, q) - chase[i], -step, step);
        at = laneAt(m.hunt, chase[i]);
      } else at = m.at(s.t + tau);
      if (dist(at, q) < m.r + RULES.playerR + RULES.marginPlayer) return false;
      const reach = m.r + RULES.marginTrail;
      if (d > trailFrom && laidNear(poly, trailFrom, d, at, reach)) return false;
      if (tau <= doneAt)
        for (let k = 1; k < old.length; k++)
          if (pointSegmentDistance(at, old[k - 1], old[k]) < reach) return false;
    }
    before = tau;
  }
  return true;
}

// Returns true when following the guide is safe for a lantern that may start moving after any
// of the usual reaction delays.
// The lantern is steered with eight directions, so a leg is walked either as the straight line of
// the drawn dots or diagonal first. The look-ahead has to hold for both ways of walking it.
function walkings(poly) {
  const ways = [poly.map((p, i) => ({ p, i }))];
  for (const diagonalFirst of [true]) {
    const out = [{ p: poly[0], i: 0 }];
    for (let k = 1; k < poly.length; k++) {
      const a = poly[k - 1];
      const dx = poly[k].x - a.x;
      const dy = poly[k].y - a.y;
      const m = Math.min(Math.abs(dx), Math.abs(dy));
      const sx = Math.sign(dx) * m;
      const sy = Math.sign(dy) * m;
      const mid = diagonalFirst
        ? { x: a.x + sx, y: a.y + sy }
        : { x: poly[k].x - sx, y: poly[k].y - sy };
      out.push({ p: mid, i: -1 }, { p: poly[k], i: k });
    }
    ways.push(out);
  }
  return ways;
}

function guideSafe(s, hint) {
  // With a stalker about, getting to the start of the lure is judged on its own: the lure run is
  // judged from there, once the stalker has had the chance to be drawn down the lane.
  const lure =
    !s.trail.on &&
    hint.index === 0 &&
    s.L.plans[hint.loop].ring > 1 &&
    s.L.moths.some((m) => m.hunt);
  const base = lure ? [s.p, hint.remaining[0]] : [s.p, ...hint.remaining];
  const ringAt = lure ? -1 : s.trail.on ? 0 : s.L.plans[hint.loop].ring - hint.index + 1;
  // Once the lantern is under way the plan is judged at full speed: only a lantern that stops and
  // starts has to be given the slack.
  const delays = s.p.moving ? [0] : RULES.startDelays;
  // A lantern that is standing may be slow to start, but once it moves it moves at full speed: the
  // standing verdict covers both, so it cannot flip to "wait" the moment the lantern sets off.
  const paces = s.p.moving ? [1] : [RULES.pace, 1];
  return walkings(base).every((way) => {
    const poly = way.map((w) => w.p);
    const ringIn = way.findIndex((w) => w.i === ringAt);
    let trailFrom = lure ? Infinity : 0;
    for (let i = 1; i <= ringIn; i++) trailFrom += dist(poly[i - 1], poly[i]);
    const length = routeLength(poly);
    return paces.every((pace) => {
      const horizon = Math.min(RULES.maxLook, length / (RULES.speed * pace) + 0.6);
      return delays.every((delay) =>
        mothsClear(
          s,
          poly,
          trailFrom,
          delay,
          horizon,
          delay + length / (RULES.speed * pace) + 0.3,
          pace,
        ),
      );
    });
  });
}

function stillSafe(s) {
  return mothsClear(s, [s.p, s.p], Infinity, 0, RULES.stillLook);
}

// Is a moth about to touch the trail that is already laid, or the stretch the lantern would lay by
// following the route (when one is given)? A stalker is taken to come for the lantern where it
// stands. Returns where on the trail the moth will meet it and when, so the warning can point there.
function trailThreat(s, route = null) {
  if (!s.trail.on) return null;
  const laid = [...s.trail.pts, { x: s.p.x, y: s.p.y, t: s.t }];
  const chase = s.moths.map((m) => m.u);
  let before = 0;
  for (let tau = 0; tau <= RULES.cutLook; tau += RULES.lookStep) {
    for (const [i, m] of s.L.moths.entries()) {
      let at;
      if (m.hunt) {
        const step = m.hunt.v * (tau - before);
        chase[i] += clamp(laneU(m.hunt, s.p) - chase[i], -step, step);
        at = laneAt(m.hunt, chase[i]);
      } else at = m.at(s.t + tau);
      const reach = m.r + RULES.cutMargin;
      for (let k = 1; k < laid.length; k++) {
        // A stretch that will have faded by then cannot be cut.
        if (s.t + tau - laid[k - 1].t > s.L.fade) continue;
        if (pointSegmentDistance(at, laid[k - 1], laid[k]) < reach)
          return { ...closestOnSegment(at, laid[k - 1], laid[k]), at: tau, laid: true };
      }
      // The stretch the lantern would lay is judged closer to the moth and not as far ahead: it is
      // only a forecast of a walk that may never happen.
      const ahead =
        route &&
        s.p.moving &&
        tau <= RULES.aheadLook &&
        laidNear(route, 0, RULES.speed * tau, at, m.r + RULES.aheadMargin);
      if (ahead) return { ...ahead, at: tau, laid: false };
    }
    before = tau;
  }
  return null;
}

// When neither walking on nor standing still is safe, back away: the eight directions are tried
// and the one that stays clear of every moth, furthest from the nearest one, becomes the target.
function fleeTarget(s) {
  const f = RULES.field;
  let best = null;
  for (let a = 0; a < 8; a++) {
    const q = {
      x: clamp(s.p.x + Math.round(Math.cos((a * Math.PI) / 4)) * RULES.fleeStep, f.x0, f.x1),
      y: clamp(s.p.y + Math.round(Math.sin((a * Math.PI) / 4)) * RULES.fleeStep, f.y0, f.y1),
    };
    if (
      dist(q, s.p) < 10 ||
      !mothsClear(s, [s.p, q], s.trail.on ? 0 : Infinity, 0, RULES.stillLook)
    )
      continue;
    const gap = Math.min(...s.moths.map((m) => dist(m, q)));
    if (!best || gap > best.gap) best = { q, gap };
  }
  return best?.q ?? null;
}

// A trail a moth is about to cross is not saved by walking on, unless the loop is nearly done:
// closing it or cancelling it spares the light. A lantern that can finish the route well before the
// moth arrives is left to do so.
function cutCue(s, otherwise, route = null) {
  const hit = trailThreat(s, route);
  const finishes =
    hit?.laid && route && routeLength(route) / RULES.speed + RULES.closeSlack < hit.at;
  s.cutAt = hit && !finishes ? hit : null;
  return s.cutAt ? 'cut' : otherwise;
}

function cueOf(s) {
  s.flee = null;
  s.cutAt = null;
  if (s.menu) return 'menu';
  if (s.clear > 0) return 'clear';
  const hint = hintOf(s);
  if (!hint) {
    // Free play: nothing to follow, but a moth bearing down on the lantern still gets a warning.
    if (s.L.moths.length && !stillSafe(s)) {
      s.flee = fleeTarget(s);
      if (s.flee) return 'flee';
    }
    return s.trail.on ? cutCue(s, 'free') : 'idle';
  }
  if (hint.kind === 'close') return 'close';
  if (!s.L.moths.length || guideSafe(s, hint)) return hint.kind;
  if (stillSafe(s)) {
    // A stalker that has parked beside the way spoils the lure: go back and draw it away again.
    if (
      s.waited >= RULES.reluredAfter &&
      !s.trail.on &&
      s.plan.idx > 0 &&
      s.L.moths.some((m) => m.hunt)
    )
      s.plan.idx = 0;
    return 'wait';
  }
  s.flee = fleeTarget(s);
  return s.flee ? 'flee' : cutCue(s, hint.kind, [s.p, ...hint.remaining]);
}

// What the guide shows: the authored route, or the retreat point while the prompt says to back away.
function shownHint(s) {
  if (s.line?.key === 'flee' && s.flee)
    return {
      kind: 'flee',
      target: s.flee,
      remaining: [s.flee],
      ring: s.flee,
      loop: -1,
      index: 0,
    };
  return hintOf(s);
}

// The drawn prompt line: a new line replaces the old one at once only when it is urgent or the
// player's own action changed the situation; otherwise the old line stays for half a second.
function think(s, forced = false) {
  const retreat = s.flee;
  const key = cueOf(s);
  s.waited = key === 'wait' ? (s.waited || 0) + RULES.thinkTicks * STEP : 0;
  const [en, zh, move] = TXT[key];
  if (s.line && s.line.en === en) return;
  // A line on screen keeps its half second unless the newcomer is urgent. "Wait" and "back away"
  // are both urgent, but must not trade places faster than they can be read or followed. A held
  // retreat line keeps its retreat spot.
  const swap = DANGER.has(s.line?.key) && DANGER.has(key);
  const held = !forced && s.line && s.line.age < RULES.promptHold && (swap || !URGENT.has(key));
  if (held) {
    s.flee = s.line.key === 'flee' ? retreat : null;
    return;
  }
  s.line = { en, zh, move, age: 0, key, fresh: true };
}

// --- Trail ---

const trailPoints = (s) => [
  ...s.trail.pts.map((q) => ({ x: q.x, y: q.y })),
  { x: s.p.x, y: s.p.y },
];

// May Space close the trail right now? Returns the polygon when it can.
export function closeCheck(s) {
  const poly = trailPoints(s);
  const head = poly[poly.length - 1];
  for (let i = 1; i < poly.length - 2; i++) {
    const hit = segmentIntersection(head, poly[0], poly[i], poly[i + 1]);
    // A hit at the head itself is just the trail's own last stretch, not a crossing.
    if (hit && hit.t > 1e-6) return { ok: false, reason: 'cross', x: hit.x, y: hit.y, poly };
  }
  // The shoelace sum is exact for a loop that does not cross itself, which is every loop here
  // (a crossing closes the loop on the spot); the costly even-odd count is only for slivers.
  if (polygonArea(poly) < RULES.minArea && coveredArea(poly) < RULES.minArea)
    return { ok: false, reason: 'small', poly };
  if (spreadArea(poly, s.trail.box) > s.L.wide) return { ok: false, reason: 'wide', poly };
  return { ok: true, poly };
}

function capture(s, poly, emit) {
  const got = s.flies.filter((f) => f.alive && pointInPolygon(f, poly));
  for (const f of got) f.alive = false;
  s.flash = { poly, age: 0, n: got.length };
  s.trail = { on: false, pts: [] };
  s.stats.loops++;
  if (got.length) {
    s.caught += got.length;
    s.stats.caught += got.length;
    s.score += got.length * RULES.catchScore + (got.length - 1) * RULES.comboScore;
    say(s, `Caught ${got.length}!`, `捕获了 ${got.length} 只！`);
    emit('coin');
  } else say(s, 'Nothing inside that loop', '圈里没有萤火虫');
  resetPlan(s);
  if (s.caught >= s.L.quota) finishMeadow(s);
  think(s, true);
}

function finishMeadow(s) {
  const left = Math.max(0, Math.floor(s.L.dawn - s.t));
  s.clear = RULES.clearTime;
  const clean = s.meadowTrouble === 0 ? RULES.cleanScore : 0;
  s.score += RULES.clearScore + RULES.lifeScore * s.lives + left * 2 + clean;
  s.inv = RULES.clearTime + 1;
  saveUnlocked(s.progress, Math.min(LEVEL_COUNT, s.level + 2));
  say(s, 'Meadow clear!', '草地完成！', RULES.clearTime);
}

function cutTrail(s, at, emit) {
  s.trail = { on: false, pts: [] };
  s.mark = { x: at.x, y: at.y, age: 0, kind: 'cut' };
  s.stats.cuts++;
  s.meadowTrouble++;
  resetPlan(s);
  emit('hit');
}

function act(s, input, emit) {
  // A Space pressed during the clear banner waits for the next meadow.
  const space = s.queued || input.pressed('Space');
  s.queued = false;
  if (input.pressed('KeyX') && s.trail.on) {
    s.trail = { on: false, pts: [] };
    s.stats.cancels++;
    say(s, 'Trail cancelled', '光迹已取消');
    resetPlan(s);
    think(s, true);
  }
  if (!space) return;
  if (!s.trail.on) {
    s.trail = {
      on: true,
      pts: [{ x: s.p.x, y: s.p.y, t: s.t }],
      box: { x0: s.p.x, y0: s.p.y, x1: s.p.x, y1: s.p.y },
    };
    const pl = s.plan && s.L.plans[s.plan.loop];
    if (pl && s.plan.idx >= pl.ring && dist(s.p, pl.route[pl.ring]) <= RULES.startReach * 1.5)
      s.plan.idx = pl.ring + 1;
    else s.plan = null;
    followPlan(s);
    emit('move');
    think(s, true);
    return;
  }
  const check = closeCheck(s);
  if (check.ok) return capture(s, check.poly, emit);
  s.stats.refused++;
  if (check.reason === 'wide') {
    // The light spreads too thin: the trail is spent and nothing is caught.
    s.flash = { poly: check.poly, age: 0, n: 0 };
    s.trail = { on: false, pts: [] };
    say(s, 'Too wide: the light fizzles', '圈太大了：光散开了');
    resetPlan(s);
    think(s, true);
  } else if (check.reason === 'cross') {
    s.mark = { x: check.x, y: check.y, age: 0, kind: 'refuse' };
    say(s, 'The closing line would cross the trail', '封圈线会与光迹交叉');
  } else say(s, 'That loop is too small', '这个圈太小了');
  emit('move');
}

// --- Fixed step ---

function movePlayer(s, dx, dy) {
  const p = s.p;
  const k = dx && dy ? Math.SQRT1_2 : 1;
  p.dx = dx;
  p.dy = dy;
  p.moving = !!(dx || dy);
  let x = p.x + dx * k * RULES.speed * STEP;
  let y = p.y + dy * k * RULES.speed * STEP;
  const f = RULES.field;
  // Push out of every flower, repeating until no overlap is left (a pinch between two flowers
  // cannot be satisfied, so then the lantern simply stays where it was).
  for (let pass = 0; pass < 8; pass++) {
    let clean = true;
    for (const b of s.L.blocks) {
      const gap = b.r + RULES.playerR;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < gap - 1e-9) {
        clean = false;
        x = d === 0 ? b.x + gap : b.x + ((x - b.x) * gap) / d;
        y = d === 0 ? b.y : b.y + ((y - b.y) * gap) / d;
      }
    }
    x = clamp(x, f.x0, f.x1);
    y = clamp(y, f.y0, f.y1);
    if (clean) break;
  }
  if (s.L.blocks.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + RULES.playerR - 1e-6)) {
    x = p.x;
    y = p.y;
  }
  p.x = x;
  p.y = y;
}

function growTrail(s, from, emit) {
  const tr = s.trail;
  const last = tr.pts[tr.pts.length - 1];
  const n = tr.pts.length;
  // Own-trail rule: the newest step crossing an older stretch closes the loop at the crossing.
  for (let i = 0; i < n - 2; i++) {
    const hit = segmentIntersection(from, s.p, tr.pts[i], tr.pts[i + 1]);
    if (!hit) continue;
    const poly = [
      { x: hit.x, y: hit.y },
      ...tr.pts.slice(i + 1).map((q) => ({ x: q.x, y: q.y })),
      { x: from.x, y: from.y },
    ];
    if (polygonArea(poly) < RULES.minArea && coveredArea(poly) < RULES.minArea) continue;
    if (spreadArea(poly) > s.L.wide) {
      // Crossing here would close a loop the light cannot fill: say so, and carry on.
      s.mark = { x: hit.x, y: hit.y, age: 0, kind: 'refuse' };
      say(s, 'Too wide to close here', '这里的圈太大，不能闭合');
      continue;
    }
    s.mark = { x: hit.x, y: hit.y, age: 0, kind: 'cross' };
    capture(s, poly, emit);
    return;
  }
  const box = (tr.box ||= { x0: last.x, y0: last.y, x1: last.x, y1: last.y });
  box.x0 = Math.min(box.x0, s.p.x);
  box.y0 = Math.min(box.y0, s.p.y);
  box.x1 = Math.max(box.x1, s.p.x);
  box.y1 = Math.max(box.y1, s.p.y);
  if (dist(last, s.p) >= RULES.sample) tr.pts.push({ x: s.p.x, y: s.p.y, t: s.t });
  while (tr.pts.length > 1 && s.t - tr.pts[0].t > s.L.fade) tr.pts.shift();
}

function loseLight(s, en, zh) {
  s.lives--;
  s.inv = RULES.invuln;
  say(s, `${en} ${s.lives} left`, `${zh}还剩 ${s.lives} 盏`);
  if (s.lives <= 0) {
    s.phase = 'lost';
    s.cause = 'moth';
  }
}

function mothsTouch(s, from, emit) {
  s.moths.forEach((m, i) => {
    const r = s.L.moths[i].r;
    const sweep = [
      { x: m.px, y: m.py },
      { x: m.x, y: m.y },
    ];
    if (s.trail.on) {
      const line = trailPoints(s);
      for (let k = 1; k < line.length; k++) {
        const a = line[k - 1];
        const b = line[k];
        if (
          Math.max(a.x, b.x) + r < Math.min(sweep[0].x, sweep[1].x) ||
          Math.min(a.x, b.x) - r > Math.max(sweep[0].x, sweep[1].x) ||
          Math.max(a.y, b.y) + r < Math.min(sweep[0].y, sweep[1].y) ||
          Math.min(a.y, b.y) - r > Math.max(sweep[0].y, sweep[1].y)
        )
          continue;
        if (segmentDistance(sweep[0], sweep[1], a, b) <= r) {
          cutTrail(s, sweep[1], emit);
          // A cut costs a light too, unless the lantern is still shielded by a recent sting.
          if (s.inv <= 0) loseLight(s, 'A moth cut your trail!', '飞蛾切断了光迹！');
          else say(s, 'A moth cut your trail!', '飞蛾切断了光迹！');
          think(s, true);
          break;
        }
      }
    }
    if (s.inv <= 0 && segmentDistance(sweep[0], sweep[1], from, s.p) <= r + RULES.playerR) {
      s.stats.hits++;
      s.meadowTrouble++;
      if (s.trail.on) cutTrail(s, s.p, emit);
      else emit('hit');
      loseLight(s, 'A moth stung you!', '被飞蛾蜇了！');
      think(s, true);
    }
  });
}

function tick(s, dx, dy, emit) {
  s.ticks++;
  if (s.clear > 0) {
    s.clear -= STEP;
    s.inv = Math.max(0, s.inv - STEP);
    if (s.clear <= 0) {
      if (s.level === LEVEL_COUNT - 1) s.phase = 'won';
      else loadMeadow(s, s.level + 1);
    }
    return;
  }
  s.t += STEP;
  s.inv = Math.max(0, s.inv - STEP);
  s.moths.forEach((m, i) => {
    m.px = m.x;
    m.py = m.y;
    const spec = s.L.moths[i];
    if (spec.hunt) {
      const step = spec.hunt.v * STEP;
      m.u += clamp(laneU(spec.hunt, s.p) - m.u, -step, step);
      Object.assign(m, laneAt(spec.hunt, m.u));
    } else Object.assign(m, spec.at(s.t));
  });
  for (const f of s.flies) if (f.alive) Object.assign(f, s.L.flies[f.id].at(s.t));
  const from = { x: s.p.x, y: s.p.y };
  movePlayer(s, dx, dy);
  if (s.trail.on) growTrail(s, from, emit);
  followPlan(s);
  if (s.phase === 'playing' && s.clear <= 0) mothsTouch(s, from, emit);
  if (s.flash && (s.flash.age += STEP) > 0.7) s.flash = null;
  if (s.mark && (s.mark.age += STEP) > 1) s.mark = null;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.line) s.line.age += STEP;
  if (s.phase === 'playing' && s.clear <= 0 && s.t >= s.L.dawn) {
    s.phase = 'lost';
    s.cause = 'dawn';
  }
  if (s.ticks % RULES.thinkTicks === 0) think(s);
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * RULES.menuCols, 1, m.unlocked);
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (input.pressed('Space', 'Enter')) {
    loadMeadow(s, sel - 1);
    emit('move');
  }
}

const NO_INPUT = Object.freeze({ held: () => false, pressed: () => false });

export function advance(s, dt, pad, emit = () => {}) {
  const input = pad ?? NO_INPUT;
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    presented(s);
    return true;
  }
  if (s.clear > 0) s.queued ||= input.pressed('Space');
  else act(s, input, emit);
  const dx = (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  const dy = (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++)
    tick(s, s.clear > 0 ? 0 : dx, s.clear > 0 ? 0 : dy, emit);
  presented(s);
  return true;
}

// A prompt line counts its half-second hold from the end of the update that first shows it.
function presented(s) {
  if (!s.line?.fresh) return;
  s.line.fresh = false;
  s.line.age = 0;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  return {
    update(dt, input) {
      // The host plays the win and lose sounds itself, so the final update stays silent.
      const heard = [];
      advance(s, dt, input, (name) => heard.push(name));
      if (s.phase === 'playing') {
        for (const name of heard) env.sound(name);
        return;
      }
      if (ended) return;
      ended = true;
      env.end({
        won: s.phase === 'won',
        score: s.score,
        message:
          s.phase === 'won'
            ? env.t('Every meadow is glowing with caught light!', '所有草地都亮起了捕获的光！')
            : s.cause === 'dawn'
              ? env.t(
                  `Dawn broke over meadow ${s.level + 1} before the quota was met.`,
                  `第 ${s.level + 1} 片草地还没完成，天就亮了。`,
                )
              : env.t(
                  `The moths put out your lantern in meadow ${s.level + 1}.`,
                  `第 ${s.level + 1} 片草地里，飞蛾扑灭了你的灯笼。`,
                ),
      });
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

const xy = (a) => ({ x: a.x, y: a.y });

export function snapshotOf(s) {
  const L = s.L;
  const finished = s.phase !== 'playing';
  const hint = !finished && !s.menu && s.clear <= 0 ? shownHint(s) : null;
  const left = Math.max(0, L.dawn - s.t);
  const line = s.line;
  const label = (lang) => {
    const i = lang === 'en' ? 0 : 1;
    return lang === 'en'
      ? `Meadow ${s.level + 1}/${LEVEL_COUNT} ${L.name[i]} · ${line[lang]} · Fireflies ${s.caught}/${L.quota}`
      : `草地 ${s.level + 1}/${LEVEL_COUNT} ${L.name[i]} · ${line[lang]} · 萤火虫 ${s.caught}/${L.quota}`;
  };
  const oldest = s.trail.pts[0];
  return {
    phase: s.phase,
    score: s.score,
    time: s.t,
    meadow: s.level + 1,
    meadows: LEVEL_COUNT,
    meadowName: { en: L.name[0], zh: L.name[1] },
    quota: L.quota,
    maxArea: L.wide,
    caught: s.caught,
    lives: s.lives,
    dawn: left,
    fade: L.fade,
    player: {
      x: s.p.x,
      y: s.p.y,
      moving: s.p.moving,
      invulnerable: s.inv > 0,
      rect: { x: s.p.x - 8, y: s.p.y - 8, w: 16, h: 16 },
    },
    trail: {
      on: s.trail.on,
      points: s.trail.pts.map((q) => ({ x: q.x, y: q.y, age: s.t - q.t })),
      life: oldest ? Math.max(0, L.fade - (s.t - oldest.t)) : null,
      threat: s.line?.key === 'cut' && s.cutAt ? xy(s.cutAt) : null,
    },
    flies: s.flies.map((f) => ({ id: f.id, alive: f.alive, x: f.x, y: f.y })),
    moths: s.moths.map((m, i) => ({ kind: L.moths[i].kind, r: L.moths[i].r, x: m.x, y: m.y })),
    blocks: L.blocks.map((b) => ({ ...b })),
    hint: hint
      ? {
          kind: hint.kind,
          x: hint.target.x,
          y: hint.target.y,
          ring: xy(hint.ring),
          route: hint.remaining.map(xy),
          loop: hint.loop,
          index: hint.index,
        }
      : null,
    prompt: line ? { en: line.en, zh: line.zh, move: line.move } : null,
    line: line ? { en: line.en, zh: line.zh, move: line.move } : null,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
    hud: { top: [0, RULES.top], bottom: [RULES.bottom, 320] },
    status: finished
      ? s.phase === 'won'
        ? { en: `Every meadow is glowing! Score ${s.score}`, zh: `所有草地都亮了！得分 ${s.score}` }
        : { en: `The night ended. Score ${s.score}`, zh: `夜晚结束了。得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const box2 = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
function disc(ctx, x, y, r, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}
function line(ctx, pts, color, width, dash = [], alpha = 1) {
  if (pts.length < 2) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
function polygon(ctx, pts, color, alpha, rule = 'nonzero') {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill(rule);
  ctx.globalAlpha = 1;
}

const DECOR = BUILT.map((_, level) => {
  let seed = level * 7919 + 17;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 46 }, () => ({
    x: 14 + next() * 452,
    y: 38 + next() * 246,
    kind: Math.floor(next() * 4),
  }));
});
const PETALS = ['#8fb4ff', '#ff9ec4', '#ffe08a', '#c6a3ff'];

function drawField(ctx, s) {
  background(ctx, '#0a1424');
  box2(ctx, '#10281c', 0, RULES.top, 480, RULES.bottom - RULES.top);
  for (const d of DECOR[s.level]) {
    box2(ctx, '#1a4a2c', d.x, d.y, 2, 5);
    box2(ctx, '#1a4a2c', d.x + 3, d.y + 2, 2, 3);
    if (d.kind) box2(ctx, PETALS[d.kind], d.x - 1, d.y - 3, 4, 3);
  }
}
function drawLanes(ctx, s) {
  for (const m of s.L.moths) {
    if (m.spec.c) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#8c78b0';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(m.spec.c[0], m.spec.c[1], m.spec.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else line(ctx, (m.spec.lane || m.spec.pts).map(pt), '#8c78b0', 1, [3, 6], 0.35);
  }
}
function drawBlock(ctx, b, t) {
  box2(ctx, '#1f5a34', b.x - 2, b.y, 4, b.r + 6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + t * 0.2;
    disc(
      ctx,
      b.x + Math.cos(a) * b.r * 0.62,
      b.y + Math.sin(a) * b.r * 0.62,
      b.r * 0.46,
      k % 2 ? '#ff9ec4' : '#ffd0e4',
    );
  }
  disc(ctx, b.x, b.y, b.r * 0.38, '#ffd24a');
}
function drawGuide(ctx, s) {
  const h = !s.menu && s.clear <= 0 ? shownHint(s) : null;
  if (!h) return;
  const pulse = 0.6 + 0.4 * Math.sin(s.ticks * 0.08);
  const route = [{ x: s.p.x, y: s.p.y }, ...h.remaining];
  line(ctx, route, '#9fe8ff', 2, [3, 5], 0.8);
  if (h.kind !== 'close') {
    disc(ctx, h.target.x, h.target.y, 5 + 2 * pulse, '#9fe8ff', 0.9);
    if (!s.trail.on) {
      ctx.strokeStyle = '#ffd36e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.ring.x, h.ring.y, 11 + 2 * pulse, 0, TAU);
      ctx.stroke();
    }
  } else disc(ctx, h.ring.x, h.ring.y, 7 + 2 * pulse, '#7dffa0', 0.6);
}
function drawTrail(ctx, s) {
  const pts = trailPoints(s);
  const fade = s.L.fade;
  for (let i = 1; i < pts.length; i++) {
    const age = s.t - s.trail.pts[i - 1].t;
    const f = clamp(1 - age / fade, 0, 1);
    line(ctx, [pts[i - 1], pts[i]], f > 0.5 ? '#ffb347' : '#a8531c', 3, [], f);
  }
  if (!s.trail.on) return;
  // Where a moth is about to cut the trail: a pulsing red ring with a bar through it.
  if (s.line?.key === 'cut' && s.cutAt) {
    const r = 7 + 3 * (0.5 + 0.5 * Math.sin(s.ticks * 0.25));
    ctx.strokeStyle = '#ff5d5d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.cutAt.x, s.cutAt.y, r, 0, TAU);
    ctx.stroke();
    box2(ctx, '#ff5d5d', s.cutAt.x - 1, s.cutAt.y - 3, 2, 4);
    box2(ctx, '#ff5d5d', s.cutAt.x - 1, s.cutAt.y + 2, 2, 2);
  }
  const check = closeCheck(s);
  const color = check.ok
    ? '#7dffa0'
    : check.reason === 'cross'
      ? '#ff5d5d'
      : check.reason === 'wide'
        ? '#ffa04a'
        : '#8a8a8a';
  line(ctx, [pts[pts.length - 1], pts[0]], color, 2, [4, 4], 0.9);
  // The verdict also has a shape, not only a colour: a tick, an X (below) or three dots.
  const mx = (pts[pts.length - 1].x + pts[0].x) / 2;
  const my = (pts[pts.length - 1].y + pts[0].y) / 2;
  if (check.ok)
    line(
      ctx,
      [
        { x: mx - 5, y: my },
        { x: mx - 1, y: my + 4 },
        { x: mx + 6, y: my - 5 },
      ],
      color,
      2,
    );
  else if (check.reason === 'small')
    for (const k of [-6, 0, 6]) box2(ctx, color, mx + k - 1, my - 1, 3, 3);
  else if (check.reason === 'wide')
    for (const k of [-8, 8]) {
      line(
        ctx,
        [
          { x: mx + k, y: my - 5 },
          { x: mx + k, y: my + 5 },
        ],
        color,
        2,
      );
      line(
        ctx,
        [
          { x: mx + k * 0.2, y: my },
          { x: mx + k, y: my },
        ],
        color,
        2,
      );
    }
  if (check.reason === 'cross') {
    line(
      ctx,
      [
        { x: check.x - 5, y: check.y - 5 },
        { x: check.x + 5, y: check.y + 5 },
      ],
      '#ff5d5d',
      2,
    );
    line(
      ctx,
      [
        { x: check.x - 5, y: check.y + 5 },
        { x: check.x + 5, y: check.y - 5 },
      ],
      '#ff5d5d',
      2,
    );
  }
}
function drawFly(ctx, f, t) {
  const flap = Math.floor(t * 9 + f.id) % 2;
  disc(ctx, f.x, f.y, 11, '#d8ff5a', 0.18 + 0.1 * Math.sin(t * 5 + f.id));
  box2(ctx, '#bfe8ff', f.x - 7, f.y - 7 - flap * 2, 5, 6);
  box2(ctx, '#bfe8ff', f.x + 2, f.y - 7 - flap * 2, 5, 6);
  box2(ctx, '#2d2a20', f.x - 3, f.y - 5, 6, 5);
  box2(ctx, '#d8ff5a', f.x - 3, f.y, 6, 7);
  box2(ctx, '#fffbd0', f.x - 1, f.y + 2, 2, 3);
}
function drawMoth(ctx, m, t) {
  const flap = Math.sin(t * 16);
  const w = 6 + flap;
  if (m.kind === 0) {
    disc(ctx, m.x - w, m.y, 5, '#9a8fb8');
    disc(ctx, m.x + w, m.y, 5, '#9a8fb8');
    box2(ctx, '#e8dfc8', m.x - 1.5, m.y - 7, 3, 14);
  } else if (m.kind === 1) {
    for (const side of [-1, 1])
      polygon(
        ctx,
        [
          { x: m.x, y: m.y - 2 },
          { x: m.x + side * w * 1.5, y: m.y + 6 },
          { x: m.x + side * w * 0.4, y: m.y + 1 },
        ],
        '#d4603f',
        1,
      );
    box2(ctx, '#3a1e14', m.x - 1.5, m.y - 8, 3, 17);
  } else if (m.kind === 2) {
    disc(ctx, m.x - w, m.y, 8, '#6b4a8c');
    disc(ctx, m.x + w, m.y, 8, '#6b4a8c');
    disc(ctx, m.x - w, m.y, 3, '#ffe08a');
    disc(ctx, m.x + w, m.y, 3, '#ffe08a');
    box2(ctx, '#2b1a3a', m.x - 2, m.y - 10, 4, 20);
  } else {
    for (const side of [-1, 1])
      polygon(
        ctx,
        [
          { x: m.x, y: m.y - 7 },
          { x: m.x + side * (w + 6), y: m.y + 5 },
          { x: m.x + side * 2, y: m.y + 2 },
        ],
        '#2f5f66',
        1,
      );
    box2(ctx, '#142a2e', m.x - 2, m.y - 8, 4, 18);
    box2(ctx, '#ff5d5d', m.x - 3, m.y - 5, 2, 2);
    box2(ctx, '#ff5d5d', m.x + 1, m.y - 5, 2, 2);
  }
}
function drawLantern(ctx, s) {
  if (s.inv > 0 && Math.floor(s.ticks / 12) % 2 && s.clear <= 0) return;
  const { x, y } = s.p;
  disc(ctx, x, y, 16, '#ffd36e', s.trail.on ? 0.3 + 0.1 * Math.sin(s.ticks * 0.15) : 0.18);
  box2(ctx, '#5a3b1e', x - 3, y - 9, 6, 2);
  box2(ctx, '#5a3b1e', x - 6, y - 7, 12, 14);
  box2(ctx, s.p.moving ? '#fff0a8' : '#ffd36e', x - 4, y - 5, 8, 10);
  if (s.p.moving) box2(ctx, '#ffb347', x - 1 + (Math.floor(s.ticks / 6) % 2) * 2, y - 8, 2, 3);
}
function drawFeedback(ctx, s) {
  if (s.flash)
    polygon(
      ctx,
      s.flash.poly,
      s.flash.n ? '#ffe9a0' : '#9aa0b0',
      0.35 * (1 - s.flash.age / 0.7),
      'evenodd',
    );
  const m = s.mark;
  if (!m) return;
  const c = m.kind === 'cut' ? '#ff5d5d' : m.kind === 'refuse' ? '#ffa04a' : '#7dffa0';
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(m.x, m.y, 6 + m.age * 24, 0, TAU);
  ctx.stroke();
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.ceil(t % 60) % 60).padStart(2, '0')}`;

function drawHud(ctx, s, env) {
  box2(ctx, '#0d1830', 0, 0, 480, RULES.top);
  box2(ctx, '#0d1830', 0, RULES.bottom, 480, 320 - RULES.bottom);
  const L = s.L;
  const left = Math.max(0, L.dawn - s.t);
  text(
    ctx,
    env.t(`Meadow ${s.level + 1}/${LEVEL_COUNT}`, `草地 ${s.level + 1}/${LEVEL_COUNT}`),
    8,
    8,
    '#fff',
    14,
  );
  text(
    ctx,
    env.t(`Fireflies ${s.caught}/${L.quota}`, `萤火虫 ${s.caught}/${L.quota}`),
    124,
    8,
    '#d8ff5a',
    14,
  );
  text(
    ctx,
    env.t(`Dawn ${mmss(left)}`, `黎明 ${mmss(left)}`),
    252,
    8,
    left < 10 ? '#ff7d7d' : '#9fe8ff',
    14,
  );
  for (let i = 0; i < RULES.lives; i++) {
    const on = i < s.lives;
    box2(ctx, on ? '#ffd36e' : '#3a3a48', 392 + i * 26, 7, 12, 14);
    box2(ctx, on ? '#5a3b1e' : '#242430', 395 + i * 26, 4, 6, 3);
  }
  if (s.trail.on && s.trail.pts.length)
    box2(
      ctx,
      '#ffb347',
      0,
      RULES.top - 3,
      Math.round(480 * clamp(1 - (s.t - s.trail.pts[0].t) / L.fade, 0, 1)),
      3,
    );
  if (s.msg) text(ctx, env.t(s.msg.en, s.msg.zh), 240, 292, '#ffe9a0', 14, 'center');
  const prompt = s.line ? env.t(s.line.en, s.line.zh) : '';
  text(
    ctx,
    prompt,
    240,
    306,
    s.line?.key === 'wait' || s.line?.key === 'cut' ? '#ff9d7d' : '#ffffff',
    14,
    'center',
  );
}

const MENU = { x: 16, y: 66, w: 44, h: 36, dx: 56, dy: 46 };
export const MENU_LAYOUT = Object.freeze({ ...MENU, cols: RULES.menuCols, count: LEVEL_COUNT });
function drawMenu(ctx, s, env) {
  ctx.globalAlpha = 0.9;
  box2(ctx, '#0a1424', 0, RULES.top, 480, RULES.bottom - RULES.top);
  ctx.globalAlpha = 1;
  text(ctx, env.t('Choose a meadow', '选择草地'), 240, 40, '#ffe9a0', 16, 'center');
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const col = (i - 1) % RULES.menuCols;
    const row = Math.floor((i - 1) / RULES.menuCols);
    const x = MENU.x + col * MENU.dx;
    const y = MENU.y + row * MENU.dy;
    const open = i <= s.menu.unlocked;
    box2(
      ctx,
      i === s.menu.sel ? '#ffd36e' : open ? '#1f3a5a' : '#1a2230',
      x - 2,
      y - 2,
      MENU.w + 4,
      MENU.h + 4,
    );
    box2(ctx, open ? '#102a44' : '#10161f', x, y, MENU.w, MENU.h);
    text(ctx, String(i), x + MENU.w / 2, y + 11, open ? '#fff' : '#555e70', 14, 'center');
  }
  const pick = BUILT[s.menu.sel - 1];
  const name = env.t(pick.name[0], pick.name[1]);
  text(
    ctx,
    env.t(`Meadow ${s.menu.sel}: ${name}`, `草地 ${s.menu.sel}：${name}`),
    240,
    216,
    '#fff',
    16,
    'center',
  );
  text(
    ctx,
    env.t('Space plays this meadow', '按空格进入此草地'),
    240,
    244,
    '#9fe8ff',
    14,
    'center',
  );
}

export function drawGame(ctx, s, env) {
  drawField(ctx, s);
  drawLanes(ctx, s);
  drawGuide(ctx, s);
  for (const b of s.L.blocks) drawBlock(ctx, b, s.t);
  drawTrail(ctx, s);
  for (const f of s.flies) if (f.alive) drawFly(ctx, f, s.t);
  s.moths.forEach((m, i) => drawMoth(ctx, { ...m, kind: s.L.moths[i].kind }, s.t));
  drawLantern(ctx, s);
  drawFeedback(ctx, s);
  drawHud(ctx, s, env);
  if (s.menu) drawMenu(ctx, s, env);
  if (s.phase !== 'playing') {
    ctx.globalAlpha = 0.5;
    box2(ctx, '#000', 0, RULES.top, 480, RULES.bottom - RULES.top);
    ctx.globalAlpha = 1;
  }
}
