import { background, drawPixelText as text } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'orbit-gardener',
  name: { en: 'Orbit Gardener', zh: '轨道园丁' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Your little ship rides concentric orbital lanes around a jewel planet. Hold Left or Right to orbit counter-clockwise or clockwise (you only move while a key is held). Gaps in the rings are transfer gates: press Up at a gate to move to the next lane out, Down to move in; anywhere else the ship cannot change lane. Fly over seeds to gather them, then stop at a bed of the same colour and shape and hold Space to plant. Beds accept only matching seeds, and some bloom open and closed (a check mark means open, a cross means closed). Drifting debris costs one of your three hull points and drops your seeds. Each garden also has a daylight bar: when it runs out it is dusk, and the hull fades by one point every 5 seconds. Run out of hull and the garden withers. Restore all 24 orbital gardens; your progress is saved.',
    zh: '你的小飞船在宝石行星外的同心轨道上航行。按住左方向键逆时针绕行，按住右方向键顺时针绕行（只有按住时才会移动）。环上的缺口是换轨门：在门处按上方向键移到外一圈，按下方向键移到内一圈，其他地方无法换轨。飞过种子即可收集，然后停在颜色和形状相同的花床上，按住空格种植。花床只接受匹配的种子，有些花床会开合（对勾表示开，叉号表示关）。漂移的碎片会扣掉三点船体中的一点并让你丢下种子。每座花园还有一条日光条：耗尽后天黑，船体每 5 秒衰减一点。船体耗尽花园就会枯萎。修复全部 24 座轨道花园，进度会被保存。',
  },
  keys: [
    { label: { en: 'Orbit left / right', zh: '向左 / 向右绕行' }, keys: 'Left / Right, A / D' },
    {
      label: { en: 'Transfer out / in at a gate', zh: '在门处向外 / 向内换轨' },
      keys: 'Up / Down, W / S',
    },
    { label: { en: 'Hold to plant', zh: '按住种植' }, keys: 'Space' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Orbit left', '向左绕行', 'left'],
    ['ArrowRight', 'Orbit right', '向右绕行', 'left'],
    ['ArrowUp', 'Out (gate)', '外移（门）', 'right'],
    ['ArrowDown', 'In (gate)', '内移（门）', 'right'],
    ['Space', 'Plant', '种植', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  cx: 240,
  cy: 158,
  lanes: Object.freeze([36, 62, 88, 114]),
  step: 1 / 120,
  maxDt: 0.1,
  actor: 16,
  speed: 84,
  hitDist: 15,
  pickReach: 14,
  bedReach: 10,
  plantTime: 1.3,
  hull: 3,
  grace: 1.0,
  invuln: 1.5,
  gateHalf: 0.5,
  promptHold: 0.5,
  introTime: 5,
  clearTime: 1.4,
  pressBuffer: 0.3,
  msgTime: 2.2,
  danger: 2,
  dangerPad: 10,
  seedLock: 1,
  duskDrain: 5,
  think: 6,
  plantScore: 100,
  clearScore: 300,
  hullScore: 50,
  top: 26,
  bottom: 290,
});
const { cx: CX, cy: CY, step: STEP } = RULES;
const TAU = Math.PI * 2;
const MENU_COLS = 8;
export const MESSAGE_CENTRE = 252;
export const MESSAGE_WIDTH = 340;
const DAYLIGHT_Y = 305;
const DAYLIGHT_BAR_X = 80;

const COLOR_NAMES = [
  ['ruby', '红宝石'],
  ['sapphire', '蓝宝石'],
  ['emerald', '祖母绿'],
  ['topaz', '黄玉'],
];
const COLORS = ['#ff4d6d', '#4aa8ff', '#4ee38a', '#ffd24a'];

const wrap = (a) => {
  const m = (((a + Math.PI) % TAU) + TAU) % TAU;
  return m - Math.PI;
};
const norm = (a) => ((a % TAU) + TAU) % TAU;
const rad = (d) => (d * Math.PI) / 180;
const laneR = (lane) => RULES.lanes[lane];
const posOf = (lane, a) => ({
  x: CX + laneR(lane) * Math.cos(a),
  y: CY + laneR(lane) * Math.sin(a),
});
// Does a target at relative angle d0 (moving by d1 - d0 this step) come within c of the origin?
const sweepHit = (d0, d1, c) => Math.min(d0, d1) <= c && Math.max(d0, d1) >= -c;

// --- Gardens ---
// [lane, degrees, ...]. seeds: [lane, deg, colour]; beds: [lane, deg, colour, [open, closed, phase]?];
// gates: [lower lane, deg, drift deg/s?] join the lane and the one outside it; debris: [lane, deg, px/s]
// (positive is clockwise). Angles run clockwise on screen from the right.
const G = (en, zh, tip, o) => ({
  name: { en, zh },
  tip,
  cap: 1,
  gates: [],
  debris: [],
  par: 40,
  ...o,
});
const GARDEN_DEFS = [
  G(
    'First Orbit',
    '初次绕行',
    ['Beat the daylight bar or the hull fades', '赶在日光条耗尽前完成，否则船体衰减'],
    {
      par: 15,
      lanes: 1,
      start: [0, 0],
      seeds: [[0, 180, 0]],
      beds: [[0, 300, 0]],
    },
  ),
  G(
    'Two Seeds',
    '两粒种子',
    ['Seeds go into beds: hold Space to plant', '种子放进花床：按住空格'],
    {
      par: 20,
      lanes: 1,
      start: [0, 0],
      seeds: [
        [0, 120, 0],
        [0, 250, 0],
      ],
      beds: [
        [0, 320, 0],
        [0, 60, 0],
      ],
    },
  ),
  G(
    'Gate Down',
    '向内换轨',
    ['Ring gaps are gates: press Down to go in', '环上缺口是门：按下方向键内移'],
    {
      par: 22,
      lanes: 2,
      start: [1, 0],
      gates: [[0, 90]],
      seeds: [[0, 200, 0]],
      beds: [[0, 320, 0]],
    },
  ),
  G('Gate Up', '向外换轨', ['At a gate, press Up to go outward', '在门处按上方向键外移'], {
    par: 22,
    lanes: 2,
    start: [0, 0],
    gates: [[0, 200]],
    seeds: [[0, 90, 0]],
    beds: [[1, 330, 0]],
  }),
  G('Pick a Gate', '选一道门', ['Several gates: pick the closer one', '有几道门：选近的那道'], {
    par: 25,
    lanes: 2,
    start: [0, 150],
    gates: [
      [0, 60],
      [0, 240],
    ],
    seeds: [[0, 330, 0]],
    beds: [[1, 150, 0]],
  }),
  G('Three Lanes', '三条轨道', ['Chain gates to cross several lanes', '连续换轨穿过多条轨道'], {
    par: 30,
    lanes: 3,
    start: [0, 0],
    gates: [
      [0, 90],
      [1, 270],
    ],
    seeds: [[1, 180, 0]],
    beds: [[2, 20, 0]],
  }),
  G(
    'Matching Colours',
    '颜色配对',
    ['A bed takes only its own colour/shape', '花床只收同色同形的种子'],
    {
      par: 40,
      lanes: 2,
      start: [0, 90],
      gates: [[0, 0]],
      seeds: [
        [0, 40, 0],
        [0, 220, 1],
      ],
      beds: [
        [1, 120, 1],
        [1, 300, 0],
      ],
    },
  ),
  G(
    'Three Jewels',
    '三色宝石',
    ['Three jewels, three beds: match each one', '三色宝石三个花床：逐一配对'],
    {
      par: 70,
      lanes: 3,
      start: [0, 90],
      gates: [
        [0, 180],
        [1, 0],
      ],
      seeds: [
        [0, 0, 2],
        [1, 90, 0],
        [1, 270, 1],
      ],
      beds: [
        [2, 45, 0],
        [2, 135, 1],
        [2, 225, 2],
      ],
    },
  ),
  G(
    'Drifting Rock',
    '漂移岩石',
    ['Debris orbits too: steer clear (3 hull)', '碎片也在绕行：躲开（3 点船体）'],
    {
      par: 30,
      lanes: 2,
      start: [1, 0],
      gates: [[0, 120]],
      debris: [[1, 150, -26]],
      seeds: [[1, 90, 0]],
      beds: [[0, 300, 0]],
    },
  ),
  G(
    'Rock Lanes',
    '碎石轨道',
    ['Rocks keep their speed: wait for a gap', '碎片速度不变：等空档再过'],
    {
      par: 35,
      lanes: 2,
      start: [0, 90],
      gates: [
        [0, 0],
        [0, 180],
      ],
      debris: [
        [0, 330, -32],
        [1, 80, 30],
        [1, 320, 30],
      ],
      seeds: [[1, 270, 0]],
      beds: [[0, 330, 0]],
    },
  ),
  G('Dodge Two', '躲开两块', ['Time each gate between the rocks', '在碎片之间把握换轨时机'], {
    par: 65,
    lanes: 3,
    start: [0, 0],
    gates: [
      [0, 45],
      [1, 225],
    ],
    debris: [
      [0, 200, -28],
      [1, 300, 30],
      [2, 100, 26],
    ],
    seeds: [
      [2, 300, 0],
      [1, 100, 0],
    ],
    beds: [
      [0, 240, 0],
      [2, 180, 0],
    ],
  }),
  G(
    'Sliding Gate',
    '滑动的门',
    ['A gate can drift: catch it as it passes', '门会漂移：趁它经过时换轨'],
    {
      par: 30,
      lanes: 2,
      start: [0, 90],
      gates: [[0, 0, -16]],
      seeds: [[0, 270, 0]],
      beds: [[1, 45, 0]],
    },
  ),
  G(
    'Two Drifting Gates',
    '双门漂移',
    ['Both gates drift: read their direction', '两道门都在漂移：看清方向'],
    {
      par: 50,
      lanes: 3,
      start: [0, 0],
      gates: [
        [0, 90, 14],
        [1, 270, -14],
      ],
      debris: [],
      seeds: [
        [1, 0, 0],
        [2, 180, 1],
      ],
      beds: [
        [2, 90, 0],
        [1, 200, 1],
      ],
    },
  ),
  G(
    'Blooming Bed',
    '开合花床',
    ['Beds open and close: plant while open', '花床时开时合：开着时种植'],
    {
      par: 35,
      lanes: 2,
      start: [0, 0],
      gates: [[0, 180]],
      seeds: [[0, 90, 0]],
      beds: [[1, 300, 0, [4, 3, 0]]],
    },
  ),
  G(
    'Two Blooms',
    '双重花期',
    ['Beds bloom out of step: watch the ring', '花床花期错开：留意光环'],
    {
      par: 40,
      lanes: 2,
      start: [1, 90],
      gates: [
        [0, 0],
        [0, 180],
      ],
      debris: [[0, 270, -30]],
      seeds: [
        [1, 0, 0],
        [0, 270, 1],
      ],
      beds: [
        [1, 180, 0, [4, 3, 1.5]],
        [0, 90, 1, [4, 3, 3]],
      ],
    },
  ),
  G('Roomy Hold', '宽敞货舱', ['The hold carries two seeds at once', '货舱一次能带两粒种子'], {
    par: 40,
    lanes: 2,
    cap: 2,
    start: [1, 0],
    gates: [[0, 90]],
    debris: [[0, 225, -30]],
    seeds: [
      [1, 120, 0],
      [1, 240, 1],
    ],
    beds: [
      [0, 30, 0],
      [0, 210, 1],
    ],
  }),
  G(
    'Rocks and Colours',
    '碎石与彩色',
    ['Match the colours while dodging rocks', '一边躲碎片一边配色'],
    {
      par: 75,
      lanes: 3,
      start: [1, 90],
      gates: [
        [0, 0],
        [1, 180],
      ],
      debris: [
        [1, 270, -26],
        [2, 0, 24],
      ],
      seeds: [
        [0, 180, 0],
        [2, 120, 1],
      ],
      beds: [
        [2, 300, 0],
        [0, 60, 1],
      ],
    },
  ),
  G(
    'Drift and Dodge',
    '漂移与闪避',
    ['Drifting gates and drifting rocks', '漂移的门与漂移的碎片'],
    {
      par: 80,
      lanes: 3,
      start: [2, 0],
      gates: [
        [0, 60, 12],
        [1, 240, -12],
      ],
      debris: [
        [0, 250, -30],
        [1, 100, 26],
      ],
      seeds: [
        [0, 0, 0],
        [1, 180, 1],
      ],
      beds: [
        [2, 180, 0],
        [2, 330, 1],
      ],
    },
  ),
  G(
    'Four Lanes',
    '四条轨道',
    ['Four lanes: plan the route through gates', '四条轨道：规划穿门路线'],
    {
      par: 58,
      lanes: 4,
      start: [0, 90],
      gates: [
        [0, 0],
        [1, 180],
        [2, 90],
      ],
      debris: [
        [1, 270, -42],
        [2, 120, 38],
        [3, 315, -36],
        [3, 255, -32],
      ],
      seeds: [
        [3, 270, 0],
        [1, 0, 1],
      ],
      beds: [
        [3, 0, 1],
        [2, 200, 0],
      ],
    },
  ),
  G(
    'Four Lane Rocks',
    '四轨碎石',
    ['Outer lanes are long: use rock gaps', '外圈很长：利用碎片间的空档'],
    {
      par: 56,
      lanes: 4,
      start: [0, 180],
      gates: [
        [0, 0],
        [1, 180],
        [2, 0],
      ],
      debris: [
        [0, 345, 37],
        [1, 60, -47],
        [2, 185, 42],
        [3, 40, 33],
      ],
      seeds: [
        [3, 270, 0],
        [1, 300, 1],
        [2, 100, 2],
      ],
      beds: [
        [3, 40, 2],
        [2, 320, 1],
        [0, 100, 0],
      ],
    },
  ),
  G(
    'Bloom Under Fire',
    '压力下的花期',
    ['Plant before the bed closes, mind rocks', '趁花床开着种下，留意碎片'],
    {
      par: 65,
      lanes: 3,
      start: [0, 90],
      gates: [
        [0, 90],
        [1, 270],
      ],
      debris: [
        [1, 275, -42],
        [2, 45, -38],
        [2, 5, -37],
        [0, 350, -38],
      ],
      seeds: [
        [0, 200, 0],
        [1, 100, 1],
      ],
      beds: [
        [2, 0, 0, [3.2, 3, 0]],
        [2, 180, 1, [3.2, 3, 2.4]],
      ],
    },
  ),
  G('Spinning Blooms', '旋转花期', ['Drifting gates, blooming beds', '漂移的门，开合的花床'], {
    par: 42,
    lanes: 3,
    start: [0, 0],
    gates: [
      [0, 45, 20],
      [1, 225, -20],
    ],
    debris: [
      [0, 180, -44],
      [1, 345, -39],
      [1, 285, -38],
    ],
    seeds: [
      [1, 0, 0],
      [0, 270, 1],
    ],
    beds: [
      [2, 90, 0, [3, 3, 0]],
      [1, 270, 1, [3, 3, 2]],
    ],
  }),
  G(
    'Overflowing Hold',
    '满载货舱',
    ['Fill the hold, then plant in any order', '装满货舱，再按任意顺序种植'],
    {
      par: 68,
      lanes: 4,
      cap: 2,
      start: [0, 90],
      gates: [
        [0, 0, 14],
        [1, 180, -14],
        [2, 90, 14],
      ],
      debris: [
        [2, 100, 44],
        [3, 355, 35],
        [1, 320, -45],
        [3, 85, 38],
      ],
      seeds: [
        [1, 90, 0],
        [2, 0, 1],
        [3, 180, 2],
        [3, 300, 0],
      ],
      beds: [
        [3, 90, 1, [3.2, 3, 0]],
        [2, 200, 2],
        [1, 300, 0],
        [0, 300, 0],
      ],
    },
  ),
  G(
    'Grand Orbit Garden',
    '轨道大花园',
    ['Everything at once: the grand garden', '一切齐上：修复大花园'],
    {
      par: 95,
      lanes: 4,
      cap: 2,
      start: [1, 0],
      gates: [
        [0, 0, 16],
        [1, 180, -16],
        [2, 60, 14],
      ],
      debris: [
        [0, 25, 43],
        [2, 55, -41],
        [3, 5, -36],
        [1, 120, 41],
      ],
      seeds: [
        [0, 100, 0],
        [1, 240, 1],
        [2, 0, 2],
        [3, 200, 3],
        [3, 330, 1],
      ],
      beds: [
        [3, 90, 3, [3.2, 3, 0]],
        [2, 180, 1, [3.2, 3, 1.5]],
        [1, 60, 0],
        [0, 300, 2],
        [3, 270, 1],
      ],
    },
  ),
];

function buildGarden(def) {
  return {
    name: def.name,
    tip: def.tip,
    laneCount: def.lanes,
    cap: def.cap,
    par: def.par,
    start: { lane: def.start[0], a: rad(def.start[1]) },
    seeds: def.seeds.map(([lane, d, color], id) => ({ id, lane, a: rad(d), color })),
    beds: def.beds.map(([lane, d, color, cycle], id) => ({
      id,
      lane,
      a: rad(d),
      color,
      cycle: cycle ? [...cycle] : null,
    })),
    gates: def.gates.map(([lo, d, spin = 0]) => ({
      lanes: [lo, lo + 1],
      a: rad(d),
      spin: rad(spin),
    })),
    debris: def.debris.map(([lane, d, v]) => ({ lane, a: rad(d), w: v / laneR(lane), v })),
  };
}
const GARDENS = GARDEN_DEFS.map(buildGarden);
export const GARDEN_COUNT = GARDENS.length;
export const LEVELS = GARDEN_DEFS.map((d) => JSON.parse(JSON.stringify(d)));

// --- Text ---

const dirWord = (dir) => (dir > 0 ? ['Right', '右'] : ['Left', '左']);
const TXT = {
  menu: ['Pick a garden: Arrows, then Space', '选择花园：方向键，然后按空格'],
  hold: ['Rock ahead! Release Left/Right', '前方有碎片！松开左 / 右方向键'],
  clear: ['Restored! Next garden: Arrows', '修复完成！下一园：方向键'],
  wait: ['Wait: the bed is closed (Space)', '等待：花床已关闭（空格）'],
  plant: ['Stop, then hold Space to plant', '停下，然后按住空格种植'],
  idle: ['Orbit with Left / Right', '用左 / 右方向键绕行'],
};

// When would a ship on `lane`, starting at angle a0 and holding `move` (-1, 0, 1), first come within
// reach of a rock? It stops after `stopPx` of travel. Returns the time, or null when it stays clear.
function firstRock(s, lane, a0, move, span, stopPx = Infinity) {
  const r = laneR(lane);
  const need = (RULES.hitDist + RULES.dangerPad) / r;
  for (let t = 0; t <= span + 1e-9; t += 0.05) {
    if (t < s.P.inv) continue;
    const a = a0 + (move * Math.min(RULES.speed * t, stopPx)) / r;
    for (const d of s.debris)
      if (d.lane === lane && Math.abs(wrap(d.a + d.w * t - a)) < need) return t;
  }
  return null;
}

// What the prompt asks for, as {t: text, move: the ship motion it asks for, stop: px of travel, span}.
function askFor(s) {
  const h = s.hint;
  const P = s.P;
  const delta = wrap(h.a - P.a);
  const px = Math.abs(delta) * laneR(P.lane);
  const sign = delta < 0 ? -1 : 1;
  const dir = dirWord(sign);
  const go = (en, zh, stop) => ({ t: [en, zh], move: sign, stop, span: RULES.danger });
  if (h.kind === 'gather')
    return go(
      `Hold ${dir[0]} to gather the seed`,
      `按住${dir[1]}方向键去拿种子`,
      px + RULES.pickReach,
    );
  if (h.kind === 'transfer') {
    if (Math.abs(delta) > RULES.gateHalf * 0.8)
      return go(`Hold ${dir[0]} to reach the gate`, `按住${dir[1]}方向键去门处`, px);
    const up = h.to > P.lane;
    const key = up ? ['Up', '上'] : ['Down', '下'];
    if (firstRock(s, h.to, P.a, 0, 0.9) !== null)
      return {
        t: [`Wait for the rock, then ${key[0]}`, `等待碎片过去，再按${key[1]}方向键`],
        move: 0,
        stop: 0,
        span: 0.9,
        urgent: true,
      };
    return {
      t: [
        `Press ${key[0]} to transfer ${up ? 'outward' : 'inward'}`,
        `按${key[1]}方向键向${up ? '外' : '内'}换轨`,
      ],
      move: 0,
      stop: 0,
      span: 0.3,
      urgent: true,
    };
  }
  if (px <= RULES.bedReach * 0.8)
    return h.open
      ? { t: TXT.plant, move: 0, stop: 0, span: RULES.plantTime + 0.4, urgent: true }
      : { t: TXT.wait, move: 0, stop: 0, span: RULES.danger, urgent: true };
  return go(`Hold ${dir[0]} to reach the bed`, `按住${dir[1]}方向键去花床`, px);
}

// The standing cue: the objective, or a rock warning that says what to hold. A rock warning looks at
// both what the objective asks and what the screen currently tells the player to do.
function cueFor(s) {
  if (s.menu) return { t: TXT.menu, move: 0 };
  if (s.clear > 0) return { t: TXT.clear, move: 0 };
  if (!s.hint) return { t: TXT.idle, move: 0 };
  const ask = askFor(s);
  const shown = s.line && !s.line.danger ? s.line.move : ask.move;
  const risky =
    firstRock(s, s.P.lane, s.P.a, ask.move, ask.span, ask.stop) !== null ||
    (shown !== ask.move && firstRock(s, s.P.lane, s.P.a, shown, RULES.danger) !== null);
  if (!risky) return { t: ask.t, move: ask.move, urgent: ask.urgent };
  // A stop (plant, wait, transfer) has no direction of its own, so both ways out are offered too.
  const way = ask.move || 1;
  const options = [0, way, -way];
  // Keep a warning's advice while it is still safe, so the line does not chatter between answers.
  const kept = s.line?.danger ? s.line.move : undefined;
  const score = (m) => firstRock(s, s.P.lane, s.P.a, m, RULES.danger * 2) ?? 9;
  // The safest answer is the one that stays clear longest; the one on screen keeps the job unless
  // another is clearly better, so the advice does not chatter.
  let move = options.reduce((best, m) => (score(m) > score(best) ? m : best), options[0]);
  if (kept !== undefined && score(kept) >= score(move) - 0.5) move = kept;
  const dir = dirWord(move);
  return {
    t: move ? [`Rock! Hold ${dir[0]} to dodge`, `碎片！按住${dir[1]}方向键躲开`] : TXT.hold,
    move,
    danger: true,
    urgent: true,
  };
}

// --- State ---

const seedAt = (g, s) => ({ ...g, taken: false, lock: 0, id: s.id });
function loadGarden(s, index) {
  const g = GARDENS[index];
  s.level = index;
  s.P = {
    lane: g.start.lane,
    a: g.start.a,
    dir: 0,
    inv: RULES.grace,
    carry: [],
    from: g.start.lane,
    tween: 0,
  };
  s.hull = RULES.hull;
  s.seeds = g.seeds.map((x) => seedAt(x, x));
  s.beds = g.beds.map((b) => ({ ...b, planted: false, prog: 0 }));
  s.gates = g.gates.map((x) => ({ ...x, lanes: [...x.lanes] }));
  s.debris = g.debris.map((x) => ({ ...x }));
  s.t = 0;
  s.par = g.par;
  s.dusk = 0;
  s.cue = { t: TXT.idle, move: 0 };
  s.clear = 0;
  s.nag = 0;
  s.hint = null;
  s.menu = null;
  s.msg = null;
  s.line = null;
  say(s, g.tip[0], g.tip[1], RULES.introTime);
  think(s);
  updateLine(s, true);
}

// Progress is a convenience: a missing or broken store must never stop the game.
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress?.unlocked?.()));
    return Number.isNaN(n) ? 1 : Math.min(GARDEN_COUNT, Math.max(1, n));
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, garden) {
  try {
    progress?.unlock?.(garden);
  } catch {
    // The next garden still loads; only the saved progress is lost.
  }
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    mode: env.mode || 1,
    acc: 0,
    ticks: 0,
    queued: 0,
    progress: env.progress || null,
    stats: { gathered: 0, planted: 0, transfers: 0, refused: 0, hits: 0, dusk: 0 },
  };
  const unlocked = readUnlocked(s.progress);
  loadGarden(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    s.cue = cueFor(s);
    updateLine(s, true);
  }
  return s;
}

function say(s, en, zh, time = RULES.msgTime) {
  s.msg = { en, zh, time };
}

function updateLine(s, forced = false) {
  const { t, move, danger, urgent } = s.cue;
  if (s.line && t[0] === s.line.en) return;
  // A rock warning or an arrival ("stop here") cuts in at once; the rest waits for half a second.
  if (s.line && !forced && !urgent && s.line.age < RULES.promptHold) return;
  s.line = { en: t[0], zh: t[1], age: 0, move, danger: !!danger };
}

// --- Hint: the next stop on the cheapest route (arc length plus gate crossings) ---

const arcPx = (lane, a, b) => Math.abs(wrap(a - b)) * laneR(lane);
const GATE_COST = 20;

function routeTo(s, target) {
  const nodes = [{ lane: s.P.lane, a: s.P.a, start: true }];
  s.gates.forEach((g, k) => g.lanes.forEach((lane) => nodes.push({ lane, a: g.a, gate: k })));
  const goal = nodes.push({ lane: target.lane, a: target.a, goal: true }) - 1;
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    nodes.forEach((_, i) => {
      if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    });
    if (u < 0 || u === goal) break;
    done[u] = true;
    nodes.forEach((n, v) => {
      if (done[v]) return;
      const m = nodes[u];
      let cost = Infinity;
      if (n.lane === m.lane) cost = arcPx(n.lane, n.a, m.a);
      else if (n.gate !== undefined && n.gate === m.gate) cost = GATE_COST;
      if (dist[u] + cost < dist[v]) {
        dist[v] = dist[u] + cost;
        prev[v] = u;
      }
    });
  }
  if (!Number.isFinite(dist[goal])) return null;
  const path = [goal];
  while (prev[path[0]] >= 0) path.unshift(prev[path[0]]);
  // The first gate crossing on the route is where the ship must stop; none means the target itself.
  for (let i = 0; i + 1 < path.length; i++) {
    const from = nodes[path[i]];
    const to = nodes[path[i + 1]];
    if (from.gate !== undefined && from.gate === to.gate)
      return { first: from, to: to.lane, cost: dist[goal] };
  }
  return { first: null, cost: dist[goal] };
}

// Seconds until a timed bed next opens or closes (0 for a bed that is always open).
const bedChange = (s, b) => {
  if (!b.cycle) return 0;
  const [open, closed, phase] = b.cycle;
  const at = (s.t + phase) % (open + closed);
  return at < open ? open - at : open + closed - at;
};
const bedOpen = (s, b) => !b.cycle || (s.t + b.cycle[2]) % (b.cycle[0] + b.cycle[1]) < b.cycle[0];

function pickTarget(s) {
  const g = GARDENS[s.level];
  const free = s.seeds.filter((x) => !x.taken);
  const have = new Set(s.P.carry.map((x) => x.color));
  const beds = s.beds.filter((b) => !b.planted && have.has(b.color));
  const goBeds = s.P.carry.length >= g.cap || free.length === 0;
  const pool = goBeds
    ? beds.map((b) => ({ ...b, kind: 'plant' }))
    : free.map((x) => ({ ...x, kind: 'gather' }));
  let best = null;
  for (const t of pool) {
    const r = routeTo(s, t);
    if (r && (!best || r.cost < best.r.cost)) best = { t, r };
  }
  return best;
}

function think(s) {
  setHint(s);
  s.cue = cueFor(s);
}

function setHint(s) {
  const best = pickTarget(s);
  if (!best) {
    s.hint = null;
    return;
  }
  const { t, r } = best;
  if (!r.first) {
    s.hint = {
      kind: t.kind,
      lane: t.lane,
      a: t.a,
      open: t.kind === 'plant' ? bedOpen(s, t) : true,
    };
    return;
  }
  s.hint = { kind: 'transfer', lane: r.first.lane, a: r.first.a, to: r.to, gate: r.first.gate };
}

// --- Rules ---

function gateAt(s, a, lane, up) {
  return s.gates.find(
    (g) => g.lanes[up ? 0 : 1] === lane && Math.abs(wrap(g.a - a)) <= RULES.gateHalf,
  );
}

function dropSeeds(s) {
  for (const c of s.P.carry) {
    const seed = s.seeds.find((x) => x.id === c.id);
    seed.taken = false;
    seed.lock = RULES.seedLock;
  }
  s.P.carry = [];
}

function hurt(s, emit) {
  s.hull--;
  s.stats.hits++;
  s.P.inv = RULES.invuln;
  const lost = s.P.carry.length > 0;
  dropSeeds(s);
  emit('hit');
  if (s.hull <= 0) {
    s.phase = 'lost';
    s.cause = 'debris';
    say(s, 'The garden withered', '花园枯萎了');
    return;
  }
  say(
    s,
    `Debris hit! Hull ${s.hull}${lost ? ', seeds dropped' : ''}`,
    `被碎片击中！船体 ${s.hull}${lost ? '，种子掉落' : ''}`,
  );
}

function transfer(s, up, emit, quiet = false) {
  const P = s.P;
  const gate = gateAt(s, P.a, P.lane, up);
  if (!gate) {
    if (quiet) return;
    s.stats.refused++;
    say(s, 'No gate here: transfer only at a gap', '这里没有门：只能在缺口处换轨');
    return;
  }
  P.from = P.lane;
  P.lane = gate.lanes[up ? 1 : 0];
  P.tween = 0.18;
  s.stats.transfers++;
  emit('move');
  const c = RULES.hitDist / laneR(P.lane);
  if (P.inv <= 0 && s.debris.some((d) => d.lane === P.lane && Math.abs(wrap(d.a - P.a)) < c))
    hurt(s, emit);
  think(s);
}

const pressedUpDown = (input) => ({
  up: input.pressed('ArrowUp', 'KeyW'),
  down: input.pressed('ArrowDown', 'KeyS'),
});

// A transfer pressed in the last moments of the clear screen waits for the next garden, where it is
// tried once; with no gate under the ship it is dropped without a complaint.
function queuePress(s, input) {
  const { up, down } = pressedUpDown(input);
  if (up !== down && s.clear <= RULES.pressBuffer) s.queued = up ? 1 : -1;
}

function act(s, input, emit) {
  const { up, down } = pressedUpDown(input);
  const queued = s.queued;
  s.queued = 0;
  if (up !== down) transfer(s, up, emit);
  else if (queued) transfer(s, queued > 0, emit, true);
}

function plantStep(s, space, dir, emit) {
  const P = s.P;
  const bed = s.beds
    .filter((b) => !b.planted && b.lane === P.lane && arcPx(P.lane, b.a, P.a) <= RULES.bedReach)
    .sort((a, b) => arcPx(P.lane, a.a, P.a) - arcPx(P.lane, b.a, P.a))[0];
  for (const b of s.beds) if (b !== bed) b.prog = 0;
  if (!bed) return;
  const seed = P.carry.find((x) => x.color === bed.color);
  if (!space || dir !== 0) {
    bed.prog = 0;
    return;
  }
  if (!seed) {
    bed.prog = 0;
    if (s.nag <= 0) {
      s.nag = 2;
      const [en, zh] = COLOR_NAMES[bed.color];
      say(
        s,
        `This bed needs ${/^[aeiou]/.test(en) ? 'an' : 'a'} ${en} seed`,
        `这个花床需要${zh}种子`,
      );
    }
    return;
  }
  if (!bedOpen(s, bed)) {
    bed.prog = 0;
    return;
  }
  bed.prog += STEP;
  if (bed.prog < RULES.plantTime) return;
  bed.planted = true;
  bed.prog = 0;
  P.carry = P.carry.filter((x) => x !== seed);
  s.score += RULES.plantScore;
  s.stats.planted++;
  emit('coin');
  think(s);
}

function finishGarden(s, emit) {
  s.clear = RULES.clearTime;
  s.score += RULES.clearScore + RULES.hullScore * s.hull;
  s.P.inv = RULES.clearTime + 1;
  s.P.dir = 0;
  const n = s.level + 1;
  saveUnlocked(s.progress, Math.min(GARDEN_COUNT, n + 1));
  say(s, 'Garden restored!', '花园已修复！', RULES.clearTime);
  emit('coin');
  s.cue = cueFor(s);
  updateLine(s, true);
}

// After the par time the light fades: the hull drains one point every few seconds. Returns false
// once the garden has withered.
function fade(s, emit) {
  if (s.dusk === 0)
    say(
      s,
      `Dusk! The hull fades every ${RULES.duskDrain} s`,
      `天黑了！船体每 ${RULES.duskDrain} 秒衰减一点`,
    );
  s.dusk += STEP;
  if (s.dusk < RULES.duskDrain) return true;
  s.dusk = 1e-9;
  s.hull--;
  s.stats.dusk++;
  emit('hit');
  if (s.hull > 0) {
    say(s, `The hull fades! Hull ${s.hull}`, `船体衰减了！船体 ${s.hull}`);
    return true;
  }
  s.phase = 'lost';
  s.cause = 'dusk';
  say(s, 'The garden withered', '花园枯萎了');
  return false;
}

function tick(s, dir, space, emit) {
  if (s.clear > 0) {
    s.clear -= STEP;
    s.P.tween = Math.max(0, s.P.tween - STEP);
    if (s.clear <= 0) {
      if (s.level === GARDEN_COUNT - 1) s.phase = 'won';
      else loadGarden(s, s.level + 1);
    } else updateLine(s);
    s.ticks++;
    return;
  }
  const P = s.P;
  const R = laneR(P.lane);
  const oldA = P.a;
  const dShip = (dir * RULES.speed * STEP) / R;
  P.dir = dir;
  P.a = norm(P.a + dShip);
  const before = s.debris.map((d) => d.a);
  for (const d of s.debris) d.a = norm(d.a + d.w * STEP);
  for (const g of s.gates) g.a = norm(g.a + g.spin * STEP);
  s.t += STEP;
  P.inv = Math.max(0, P.inv - STEP);
  P.tween = Math.max(0, P.tween - STEP);
  s.nag = Math.max(0, s.nag - STEP);
  for (const x of s.seeds) x.lock = Math.max(0, x.lock - STEP);
  if (s.t > s.par && !fade(s, emit)) return;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  // gather
  for (const x of s.seeds) {
    if (x.taken || x.lock > 0 || x.lane !== P.lane || P.carry.length >= GARDENS[s.level].cap)
      continue;
    const d0 = wrap(x.a - oldA);
    if (sweepHit(d0, d0 - dShip, RULES.pickReach / R)) {
      x.taken = true;
      P.carry.push({ id: x.id, color: x.color });
      s.stats.gathered++;
      emit('coin');
      think(s);
    }
  }
  // debris (swept: ship and rock both move this step)
  if (P.inv <= 0) {
    const c = RULES.hitDist / R;
    s.debris.forEach((d, i) => {
      if (d.lane !== P.lane || P.inv > 0) return;
      const d0 = wrap(before[i] - oldA);
      if (sweepHit(d0, d0 + d.w * STEP - dShip, c)) hurt(s, emit);
    });
    if (s.phase !== 'playing') return;
  }
  plantStep(s, space, dir, emit);
  if (s.beds.every((b) => b.planted)) finishGarden(s, emit);
  s.ticks++;
  if (s.line) s.line.age += STEP;
  if (s.ticks % RULES.think === 0) think(s);
  updateLine(s);
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = Math.max(1, Math.min(m.unlocked, m.sel + step + row * MENU_COLS));
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (input.pressed('Space', 'Enter')) {
    loadGarden(s, sel - 1);
    emit('move');
  }
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    return true;
  }
  if (s.clear > 0) queuePress(s, input);
  else act(s, input, emit);
  const dir =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  const space = input.held('Space');
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, space, emit);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase === 'playing' || ended) return;
      ended = true;
      if (s.phase === 'won') {
        emit('win');
        env.end({
          won: true,
          score: s.score,
          message: env.t('Every orbital garden is blooming!', '所有轨道花园都开花了！'),
        });
      } else {
        emit('lose');
        env.end({
          won: false,
          score: s.score,
          message:
            s.cause === 'dusk'
              ? env.t(
                  `Night fell on garden ${s.level + 1} before it was restored.`,
                  `第 ${s.level + 1} 座花园在修复前就天黑了。`,
                )
              : env.t(
                  `Debris wrecked the hull in garden ${s.level + 1}.`,
                  `第 ${s.level + 1} 座花园的船体被碎片撞毁。`,
                ),
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

const pt = (lane, a) => {
  const p = posOf(lane, a);
  return { x: p.x, y: p.y };
};

export function snapshotOf(s) {
  const g = GARDENS[s.level];
  const P = s.P;
  const finished = s.phase !== 'playing';
  const line = s.line || { en: s.cue.t[0], zh: s.cue.t[1] };
  const prompt = { en: s.cue.t[0], zh: s.cue.t[1] };
  const label = (lang) =>
    `${lang === 'en' ? 'Garden' : '花园'} ${s.level + 1}/${GARDEN_COUNT} ${g.name[lang]} · ${line[lang]} · ${lang === 'en' ? 'Hull' : '船体'} ${s.hull}`;
  const h = !finished && !s.menu && s.hint ? s.hint : null;
  return {
    phase: s.phase,
    score: s.score,
    time: s.ticks * STEP,
    garden: s.level + 1,
    gardens: GARDEN_COUNT,
    gardenName: { ...g.name },
    laneRadii: RULES.lanes.slice(0, g.laneCount),
    cap: g.cap,
    hull: s.hull,
    par: s.par,
    daylight: Math.max(0, s.par - s.t),
    dusk: s.t > s.par,
    player: {
      lane: P.lane,
      angle: P.a,
      dir: P.dir,
      ...pt(P.lane, P.a),
      rect: { x: posOf(P.lane, P.a).x - 8, y: posOf(P.lane, P.a).y - 8, w: 16, h: 16 },
      invulnerable: P.inv > 0,
      carrying: P.carry.map((c) => ({ ...c })),
    },
    seeds: s.seeds.map((x) => ({
      id: x.id,
      lane: x.lane,
      angle: x.a,
      color: x.color,
      taken: x.taken,
      lock: x.lock,
      ...pt(x.lane, x.a),
    })),
    beds: s.beds.map((b) => ({
      id: b.id,
      lane: b.lane,
      angle: b.a,
      color: b.color,
      planted: b.planted,
      open: bedOpen(s, b),
      timed: !!b.cycle,
      changesIn: bedChange(s, b),
      progress: b.prog / RULES.plantTime,
      ...pt(b.lane, b.a),
    })),
    gates: s.gates.map((x) => ({
      lanes: [...x.lanes],
      angle: x.a,
      spin: x.spin,
      half: RULES.gateHalf,
    })),
    debris: s.debris.map((d) => ({
      lane: d.lane,
      angle: d.a,
      omega: d.w,
      speed: d.v,
      ...pt(d.lane, d.a),
    })),
    hint: h
      ? {
          kind: h.kind,
          lane: h.lane,
          angle: h.a,
          x: posOf(h.lane, h.a).x,
          y: posOf(h.lane, h.a).y,
          open: h.open ?? true,
          to: h.to ?? null,
          gate: h.gate ?? null,
        }
      : null,
    prompt,
    line: { en: line.en, zh: line.zh },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats },
    hud: { top: [0, RULES.top], bottom: [RULES.bottom, 320] },
    status: finished
      ? s.phase === 'won'
        ? { en: `All gardens restored! Score ${s.score}`, zh: `全部花园已修复！得分 ${s.score}` }
        : { en: `The garden withered. Score ${s.score}`, zh: `花园枯萎了。得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function ringLine(ctx, r, color, width, dash = []) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(CX, CY, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
}
function shape(ctx, kind, x, y, r, fill, edge) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === 0) ctx.arc(x, y, r, 0, TAU);
  else if (kind === 1) {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y);
    ctx.lineTo(x, y + r + 1);
    ctx.lineTo(x - r - 1, y);
  } else if (kind === 2) {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y + r);
    ctx.lineTo(x - r - 1, y + r);
  } else ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const RING_STYLE = [
  ['#5ad6d0', 2, []],
  ['#7aa2ff', 2, [10, 5]],
  ['#c58bff', 3, [2, 6]],
  ['#ffb36b', 2, [14, 3, 2, 3]],
];

function drawRings(ctx, s) {
  const g = GARDENS[s.level];
  const spin = s.ticks * STEP * 0.4;
  disc(ctx, CX, CY, 24, '#1d6f8f');
  disc(ctx, CX, CY, 20, '#2fa6c4');
  ctx.fillStyle = '#9ff2ff';
  ctx.beginPath();
  ctx.moveTo(CX + Math.cos(spin) * 18, CY + Math.sin(spin) * 18);
  ctx.lineTo(CX + Math.cos(spin + 2) * 9, CY + Math.sin(spin + 2) * 9);
  ctx.lineTo(CX + Math.cos(spin + 4) * 9, CY + Math.sin(spin + 4) * 9);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < g.laneCount; i++) ringLine(ctx, laneR(i), ...RING_STYLE[i]);
}

// A drifting gate carries arrowheads along its lane: the way they point is the way it drifts, and a
// second arrowhead marks the quicker gates.
function driftArrows(ctx, gate, x, y) {
  const dir = Math.sign(gate.spin);
  const tx = -Math.sin(gate.a) * dir;
  const ty = Math.cos(gate.a) * dir;
  const count = Math.abs(gate.spin) > rad(12) ? 2 : 1;
  ctx.fillStyle = '#ffe066';
  for (let k = 0; k < count; k++) {
    const cx = x + tx * (k * 7 - 3);
    const cy = y + ty * (k * 7 - 3);
    ctx.beginPath();
    ctx.moveTo(cx + tx * 5, cy + ty * 5);
    ctx.lineTo(cx - tx * 3 - ty * 5, cy - ty * 3 + tx * 5);
    ctx.lineTo(cx - tx * 3 + ty * 5, cy - ty * 3 - tx * 5);
    ctx.closePath();
    ctx.fill();
  }
}

function drawGates(ctx, s) {
  for (const gate of s.gates) {
    const r0 = laneR(gate.lanes[0]);
    const r1 = laneR(gate.lanes[1]);
    const half = RULES.gateHalf;
    for (const r of [r0, r1]) {
      ctx.strokeStyle = '#0b0e17';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(CX, CY, r, gate.a - half, gate.a + half);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2;
    for (const side of [-half, half]) {
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(gate.a + side) * r0, CY + Math.sin(gate.a + side) * r0);
      ctx.lineTo(CX + Math.cos(gate.a + side) * r1, CY + Math.sin(gate.a + side) * r1);
      ctx.stroke();
    }
    const m = posOf(gate.lanes[0], gate.a);
    const o = posOf(gate.lanes[1], gate.a);
    ctx.strokeStyle = '#fff3a8';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(o.x, o.y);
    ctx.stroke();
    if (gate.spin) driftArrows(ctx, gate, (m.x + o.x) / 2, (m.y + o.y) / 2);
  }
}

// A check (open) or a cross (closed) on a dark chip, so the bed state never rests on colour alone.
function bedMark(ctx, x, y, open) {
  box(ctx, '#0b0e17', x - 6, y - 6, 12, 12);
  ctx.strokeStyle = open ? '#9dff9d' : '#ff8a6a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (open) {
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 1, y + 3);
    ctx.lineTo(x + 4, y - 3);
  } else {
    ctx.moveTo(x - 3, y - 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x - 3, y + 3);
  }
  ctx.stroke();
}

function drawBeds(ctx, s) {
  for (const b of s.beds) {
    const p = posOf(b.lane, b.a);
    const open = bedOpen(s, b);
    disc(ctx, p.x, p.y, 12, '#2a1a14');
    disc(ctx, p.x, p.y, 10, open ? '#6b4326' : '#3a2c26');
    if (b.cycle) {
      // The ring is a clock: it shrinks as the bed's current open or closed spell runs out. Open is a
      // solid green ring with a check mark; closed is a dashed orange ring with a cross.
      const phaseLen = b.cycle[open ? 0 : 1];
      ctx.strokeStyle = open ? '#9dff9d' : '#ff8a6a';
      ctx.lineWidth = 3;
      ctx.setLineDash(open ? [] : [3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, -Math.PI / 2, -Math.PI / 2 + TAU * (bedChange(s, b) / phaseLen));
      ctx.stroke();
      ctx.setLineDash([]);
      bedMark(ctx, p.x + 13, p.y - 13, open);
    }
    if (b.planted) {
      box(ctx, '#2e9b4d', p.x - 1, p.y - 2, 3, 10);
      shape(ctx, b.color, p.x, p.y - 6, 5, COLORS[b.color], '#ffffff');
    } else shape(ctx, b.color, p.x, p.y, 5, '#00000066', COLORS[b.color]);
    if (b.prog > 0)
      box(ctx, '#ffffff', p.x - 10, p.y + 14, Math.round((b.prog / RULES.plantTime) * 20), 3);
  }
}

function drawSeeds(ctx, s) {
  const bob = Math.sin(s.ticks * STEP * 5) * 1.5;
  for (const x of s.seeds) {
    if (x.taken) continue;
    const p = posOf(x.lane, x.a);
    ctx.globalAlpha = x.lock > 0 ? 0.35 : 1;
    shape(ctx, x.color, p.x, p.y + bob, 7, COLORS[x.color], '#10131f');
    ctx.globalAlpha = 1;
  }
}

function drawDebris(ctx, s) {
  for (const d of s.debris) {
    const p = posOf(d.lane, d.a);
    const dirn = d.w > 0 ? 1 : -1;
    for (let k = 1; k <= 3; k++) {
      const q = posOf(d.lane, d.a - dirn * k * 0.12);
      box(ctx, '#ff6a4a', q.x - 1, q.y - 1, 3, 3);
    }
    ctx.fillStyle = '#8b6d5c';
    ctx.strokeStyle = '#ff6a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 5 : 9;
      const a = (i * TAU) / 8 + s.ticks * STEP * dirn;
      ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    box(ctx, '#2b1d17', p.x - 2, p.y - 2, 4, 4);
  }
}

function drawShip(ctx, s) {
  const P = s.P;
  if (P.inv > 0 && Math.floor(s.ticks / 10) % 2 && s.clear <= 0) return;
  const lerp = P.tween > 0 ? P.tween / 0.18 : 0;
  const r = laneR(P.lane) * (1 - lerp) + laneR(P.from) * lerp;
  const x = CX + r * Math.cos(P.a);
  const y = CY + r * Math.sin(P.a);
  const heading = P.a + (P.dir < 0 ? -Math.PI / 2 : Math.PI / 2);
  P.carry.forEach((c, i) => {
    for (let k = 1; k <= 3; k++) {
      const q = posOf(P.lane, P.a - (P.dir || 1) * k * 0.1 * (i + 1));
      box(ctx, COLORS[c.color], q.x - 1, q.y - 1, 3, 3);
    }
  });
  ctx.fillStyle = '#f4f7ff';
  ctx.strokeStyle = '#0b0e17';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(heading) * 9, y + Math.sin(heading) * 9);
  ctx.lineTo(x + Math.cos(heading + 2.5) * 8, y + Math.sin(heading + 2.5) * 8);
  ctx.lineTo(x + Math.cos(heading - 2.5) * 8, y + Math.sin(heading - 2.5) * 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  disc(ctx, x, y, 3, P.dir ? '#ffb347' : '#4aa8ff');
  P.carry.forEach((c, i) =>
    shape(ctx, c.color, x + (i ? 8 : -8), y - 10, 3, COLORS[c.color], '#ffffff'),
  );
}

function drawHint(ctx, s) {
  const h = s.hint;
  if (!h) return;
  const p = posOf(s.P.lane, h.a);
  const pulse = 9 + (Math.floor(s.ticks / 15) % 2) * 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, pulse + 8, 0, TAU);
  ctx.stroke();
}

function drawHud(ctx, s, env) {
  box(ctx, '#0b0e17', 0, 0, 480, RULES.top);
  box(ctx, '#0b0e17', 0, RULES.bottom, 480, 320 - RULES.bottom);
  text(ctx, `${env.t('Garden', '花园')} ${s.level + 1}/${GARDEN_COUNT}`, 6, 6, '#8d9ac4', 14);
  const tone = s.line.danger ? '#ff8a6a' : s.hull < RULES.hull ? '#ffe066' : '#ffffff';
  text(ctx, env.t(s.line.en, s.line.zh), 240, 6, tone, 14, 'center');
  for (let i = 0; i < RULES.hull; i++)
    box(ctx, i < s.hull ? '#ff4d6d' : '#3a4258', 428 + i * 16, 8, 12, 10);
  const planted = s.beds.filter((b) => b.planted).length;
  text(ctx, `${env.t('Beds', '花床')} ${planted}/${s.beds.length}`, 6, 292, '#cfd6ea', 14);
  // Bottom messages are kept to MESSAGE_WIDTH so they never reach the bed count or the score.
  if (s.msg) text(ctx, env.t(s.msg.en, s.msg.zh), MESSAGE_CENTRE, 292, '#ffe066', 14, 'center');
  text(ctx, String(s.score), 474, 292, '#8d9ac4', 14, 'right');
  // Daylight: the time left before dusk starts to drain the hull. At dusk the bar becomes the next
  // hull point's countdown.
  const left = Math.max(0, s.par - s.t);
  const dusk = left <= 0;
  text(
    ctx,
    dusk ? env.t('Dusk', '天黑') : env.t('Daylight', '日光'),
    6,
    DAYLIGHT_Y,
    dusk ? '#ff8a6a' : '#ffd24a',
    14,
  );
  box(ctx, '#1b2133', DAYLIGHT_BAR_X, 310, 474 - DAYLIGHT_BAR_X, 6);
  box(
    ctx,
    dusk ? '#ff6a4a' : '#ffd24a',
    DAYLIGHT_BAR_X,
    310,
    Math.round((474 - DAYLIGHT_BAR_X) * (dusk ? 1 - s.dusk / RULES.duskDrain : left / s.par)),
    6,
  );
}

// A locked garden shows a padlock instead of its number, so it never reads as dim-but-open.
function padlock(ctx, x, y) {
  box(ctx, '#8d9ac4', x + 11, y + 6, 10, 2);
  box(ctx, '#8d9ac4', x + 11, y + 6, 2, 8);
  box(ctx, '#8d9ac4', x + 19, y + 6, 2, 8);
  box(ctx, '#8d9ac4', x + 9, y + 14, 14, 11);
  box(ctx, '#14171f', x + 15, y + 17, 2, 5);
}

function drawMenu(ctx, s, env) {
  background(ctx, '#0b0e17');
  text(ctx, env.t('ORBIT GARDENER', '轨道园丁'), 240, 22, '#ffe066', 16, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 1; i <= GARDEN_COUNT; i++) {
    const x = 60 + ((i - 1) % MENU_COLS) * 46;
    const y = 60 + Math.floor((i - 1) / MENU_COLS) * 44;
    const open = i <= unlocked;
    box(ctx, i === sel ? '#ffe066' : '#3a4258', x - 2, y - 2, 36, 36);
    box(ctx, open ? '#262c3e' : '#14171f', x, y, 32, 32);
    if (open) text(ctx, String(i), x + 16, y + 9, '#ffffff', 14, 'center');
    else padlock(ctx, x, y);
  }
  const g = GARDENS[sel - 1];
  text(
    ctx,
    `${sel}/${GARDEN_COUNT}  ${env.t(g.name.en, g.name.zh)}`,
    240,
    200,
    '#ffffff',
    16,
    'center',
  );
  text(ctx, env.t(...g.tip), 240, 230, '#8d9ac4', 14, 'center');
  text(ctx, env.t(...TXT.menu), 240, 270, '#cfd6ea', 14, 'center');
}

function drawGame(ctx, s, env) {
  if (s.menu) {
    drawMenu(ctx, s, env);
    return;
  }
  background(ctx, '#0b0e17');
  for (let i = 0; i < 40; i++)
    box(ctx, i % 3 ? '#2b3350' : '#4a5580', (i * 97) % 480, 28 + ((i * 53) % 260), 2, 2);
  drawRings(ctx, s);
  drawGates(ctx, s);
  drawBeds(ctx, s);
  drawSeeds(ctx, s);
  drawHint(ctx, s);
  drawDebris(ctx, s);
  drawShip(ctx, s);
  drawHud(ctx, s, env);
}
