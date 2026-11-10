import { clamp, background, drawPixelText as text } from '../shared/utils.js';

export const meta = {
  id: 'magnet-marauder',
  name: { en: 'Magnet Marauder', zh: '磁力奇兵' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: "Clear 25 foundry chambers with a polarity magnet, picking up where you left off. Hold Space to pull loose metal into an orbit around you (the blue ring shows how far the pull reaches). Face an enemy until the red bracket locks on, then press X: one orbiting piece is repelled at the locked enemy (X does nothing without a lock). Armored enemies shrug off slow metal and only crack under fast, glowing metal; orbiting or resting metal never hurts anything. Walking enemies only block you; only a charger's dash hurts you, and only inside its red lane. Protect the machinery: enemies strike it after a red wind-up, and your own fast metal damages it too. Wrecking any machine, or losing all your HP, ends the run.",
    zh: '用极性磁铁清空25间铸造车间，可从上次进度继续。按住空格，将散落金属吸入身边轨道（蓝色圆环表示吸力范围）。面向敌人直到红色准星锁定，再按X：一块环绕的金属会被排斥射向被锁定的敌人（没有锁定时X无效）。装甲敌人不怕慢速金属，只有高速发光的金属才能击裂它们；环绕或静止的金属不会伤人。行走的敌人只会挡路；只有冲锋者的冲刺会伤到你，而且只在它的红色通道内。请保护机器：敌人会在红色预警后攻击机器，你自己的高速金属也会损坏它。任何一台机器被毁，或生命耗尽，都会结束本局。',
  },
  keys: [
    { label: { en: 'Move / face an enemy', zh: '移动 / 面向敌人' }, keys: 'WASD / Arrows' },
    { label: { en: 'Hold to attract metal into orbit', zh: '按住吸引金属入轨' }, keys: 'Space' },
    { label: { en: 'Repel orbiting metal at the target', zh: '排斥环绕金属射向目标' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Attract (hold)', '吸引（按住）', 'right'],
    ['KeyX', 'Repel', '排斥', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
export const PLAY_TOP = 30; // canvas rows above are the HUD band
export const PLAY_BOTTOM = 294; // canvas rows below are the prompt band
export const ARENA = { x0: 16, y0: 38, x1: 464, y1: 286 };

// Magnet and metal tuning. Nothing here is hidden: the field radius is drawn on screen.
export const FIELD_R = 150; // the pull and push never reach beyond this distance
export const DEAD_R = 30; // no pull inside this ring, so metal settles instead of ramming the magnet
export const CAPTURE_R = 46; // slow metal inside this ring joins the orbit
export const ORBIT_R = 34;
export const MAX_HELD = 4;
export const ATTRACT_VMAX = 90; // the pull alone is slower than anything that hurts armor or machinery
export const REPEL_V = 300; // launch speed of a light plate; heavy slabs get 0.8 of it
export const ARMOR_V = 150; // relative speed needed to crack armor (metal glows above it)
export const MACHINE_V = 100; // fragile machinery is damaged above this relative speed
const ORBIT_W = 2.4; // rad/s
const ATTRACT_A = 480; // peak pull acceleration at the magnet, falling linearly to 0 at FIELD_R
const FRICTION = 50; // floor drag, px/s^2
const IMPACT_STEP = 60; // each extra step of speed adds one damage
const MAX_DAMAGE = 4;
const RESTITUTION_WALL = 0.5;
const RESTITUTION_BODY = 0.35;
const REST_V = 25;

const SPEED = 95;
export const MAX_HP = 4;
export const MACHINE_HP = 14;
export const INVULN = 1.2;
const SKIN = 0.01;
const TOUCH_CLEAR = 2;
const TOUCH_GAP = 2.5;
export const REPEL_CD = 0.5;
const REPEL_LOCK = 0.35;
const HOLD_MAX_V = 300;
const RADIAL_V = 120;
const AIM_CONE = (24 * Math.PI) / 180;
const AIM_KEEP = (55 * Math.PI) / 180; // a locked target stays locked while within this wider cone
const AIM_RANGE = 210;
const AIM_GRACE = 0.5;
const SPAWN_TIME = 0.8;
export const CLEAR_TIME = 2.2;
const MSG_TIME = 1.3;
const MSG_MIN = 0.7;
const EVENT_KEEP = 36; // ticks an event stays in the snapshot (0.3 s)
const MAX_FX = 40;
const DASH_V = 230;
const DASH_TIME = 0.9;
export const CHARGE_RANGE = 140;
const KNOCKBACK = 22;

export const FOES = {
  brute: { hp: 2, hw: 12, hh: 12, speed: 28, wind: 1.5, rest: 2.2, dmg: 1 },
  charger: { hp: 3, hw: 11, hh: 11, speed: 36, wind: 1.6, rest: 2.6, dmg: 2 },
};
export const METALS = {
  plate: { hw: 8, mass: 1, launch: REPEL_V },
  slab: { hw: 11, mass: 2, launch: REPEL_V * 0.8 },
};

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const FRAME = [
  box(0, 30, 480, 38),
  box(0, 286, 480, 294),
  box(0, 30, 16, 294),
  box(464, 30, 480, 294),
];

const plate = (x, y) => ({ kind: 'plate', x, y });
const slab = (x, y) => ({ kind: 'slab', x, y });
const brute = (x, y, after = 0) => ({ type: 'brute', x, y, after });
const charger = (x, y, after = 0) => ({ type: 'charger', x, y, after });
const pillar = (x, y, w = 24, h = 24) => box(x, y, x + w, y + h);

// 25 chambers, one new idea at a time, then combinations, then mastery. `tip` is shown on entry.
// Each room starts the player far from the loose metal (a depot beside the machinery), so the first
// job is always to fetch metal. `flip` mirrors the room left to right. `after` = foes that must
// fall before this one steps out (reinforcement steps).
export const CHAMBERS = [
  {
    name: { en: 'First Pull', zh: '初次吸附' },
    tip: ['Walk to the metal and hold Space: it orbits you', '走近金属并按住空格：它会环绕你'],
    start: { x: 436, y: 262 },
    pillars: [],
    machines: [[56, 162]],
    metals: [plate(100, 110), plate(110, 214), plate(135, 162)],
    foes: [brute(330, 80)],
  },
  {
    name: { en: 'Foundry Floor', zh: '铸造车间' },
    tip: ['Face a foe till the bracket locks, then X', '面向敌人直到红框锁定，再按X'],
    start: { x: 436, y: 62 },
    pillars: [box(228, 60, 252, 84)],
    machines: [[56, 162]],
    metals: [plate(100, 110), plate(110, 214), plate(135, 162)],
    foes: [brute(330, 230), brute(330, 200, 1)],
  },
  {
    name: { en: 'Brutes at the Gate', zh: '门前蛮兵' },
    tip: ['Brutes smash a machine after a red wind-up', '蛮兵红色预警后会砸毁机器'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [],
    machines: [[56, 162]],
    metals: [plate(100, 100), plate(100, 224), plate(135, 162)],
    foes: [brute(300, 100), brute(300, 140)],
  },
  {
    name: { en: 'Blocked Line', zh: '射线受阻' },
    tip: ['Grey slash: line blocked. Sidestep, then X', '灰色斜线：射线被挡。先横移再按X'],
    start: { x: 436, y: 262 },
    pillars: [box(224, 100, 256, 224)],
    machines: [[56, 162]],
    metals: [plate(90, 240), plate(110, 262), plate(135, 246)],
    foes: [brute(340, 110), brute(340, 140, 1)],
  },
  {
    name: { en: 'Behind the Machine', zh: '机器背后' },
    tip: ['Machines block your line too: step around', '机器也会挡住射线：绕开再射'],
    start: { x: 436, y: 62 },
    pillars: [],
    machines: [[130, 162]],
    metals: [plate(60, 100), plate(60, 224), plate(85, 62), plate(85, 264)],
    foes: [brute(340, 200), brute(340, 230, 1)],
  },
  {
    name: { en: 'Charger Lane', zh: '冲锋通道' },
    tip: ['Chargers dash down the red lane: step aside', '冲锋者沿红色通道冲刺：快躲开'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [],
    machines: [[56, 162]],
    metals: [plate(100, 110), plate(110, 214), plate(135, 162)],
    foes: [charger(330, 162)],
  },
  {
    name: { en: 'Pillar Alley', zh: '立柱小巷' },
    tip: ['Pillars stop a dash and hide foes behind them', '立柱会挡住冲刺，也会遮住敌人'],
    start: { x: 436, y: 262 },
    pillars: [pillar(160, 90, 24, 40), pillar(160, 194, 24, 40), pillar(300, 60, 24, 40)],
    machines: [[56, 162]],
    metals: [plate(100, 60), plate(100, 264), plate(130, 162), plate(125, 110)],
    foes: [charger(340, 100), brute(340, 130)],
  },
  {
    name: { en: 'Heavy Slab', zh: '沉重铁块' },
    tip: ['Slabs are heavy: slow to pull, slower to fly', '铁块很重：吸得慢，飞得也慢'],
    start: { x: 436, y: 62 },
    pillars: [],
    machines: [[56, 162]],
    metals: [slab(110, 162), slab(100, 100), plate(100, 224)],
    foes: [brute(330, 200), brute(330, 230, 1)],
  },
  {
    name: { en: 'Two Machines', zh: '双机并立' },
    tip: ['Two machines: stop whichever foe is closer', '两台机器：先拦下更近的敌人'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [plate(100, 162), plate(125, 60), plate(125, 264), plate(145, 162)],
    foes: [brute(330, 96), brute(330, 140)],
  },
  {
    name: { en: 'Reserves', zh: '后备援军' },
    tip: ['New foes step out as others fall', '一个敌人倒下，下一个才会出现'],
    start: { x: 436, y: 262 },
    pillars: [box(228, 60, 252, 84)],
    machines: [[56, 162]],
    metals: [plate(100, 110), plate(100, 214), plate(135, 162), plate(120, 60)],
    foes: [brute(330, 100), brute(330, 130, 1), brute(330, 160, 2)],
  },
  {
    name: { en: 'Staggered Machines', zh: '错落机器' },
    tip: ['One machine deeper in the room: watch both', '一台机器在更深处：两边都要看'],
    start: { x: 436, y: 62 },
    pillars: [],
    machines: [
      [56, 100],
      [150, 236],
    ],
    metals: [plate(100, 150), plate(100, 60), plate(90, 190), plate(135, 110)],
    foes: [brute(330, 200), brute(330, 250, 1), brute(330, 175, 2)],
  },
  {
    name: { en: 'Slag Gallery', zh: '熔渣长廊' },
    tip: ['Chargers first: they strike fastest', '先对付冲锋者：它们出手最快'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [box(250, 96, 274, 124), box(250, 200, 274, 228)],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [plate(100, 60), plate(100, 264), plate(135, 130), slab(130, 196)],
    foes: [charger(340, 90), brute(340, 130), charger(340, 162, 2)],
  },
  {
    name: { en: 'Charger Pair', zh: '双冲锋者' },
    tip: ['Two lanes can cross: leave both before you aim', '两条通道可能交叉：先离开再瞄准'],
    start: { x: 436, y: 62 },
    pillars: [box(228, 140, 252, 184)],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [plate(100, 60), plate(100, 264), plate(135, 110), plate(135, 214), slab(110, 162)],
    foes: [charger(340, 190), charger(340, 250)],
  },
  {
    name: { en: 'Pillar Maze', zh: '立柱迷宫' },
    tip: ['Use the gaps: walk round a pillar for a clear line', '利用缝隙：绕过立柱找开阔射线'],
    start: { x: 436, y: 262 },
    pillars: [
      pillar(200, 80, 24, 40),
      pillar(200, 204, 24, 40),
      pillar(280, 142, 24, 40),
      pillar(360, 80, 24, 40),
      pillar(360, 204, 24, 40),
    ],
    machines: [[56, 162]],
    metals: [plate(100, 60), plate(100, 264), plate(135, 162), plate(110, 110), plate(110, 214)],
    foes: [brute(320, 70), charger(320, 110), brute(320, 162, 2)],
  },
  {
    name: { en: 'Three Machines', zh: '三机阵列' },
    tip: ['Three machines: the red wind-up shows the target', '三台机器：红色预警会指明目标'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [],
    machines: [
      [56, 80],
      [56, 244],
      [150, 162],
    ],
    metals: [plate(95, 120), plate(95, 204), plate(110, 60), plate(110, 264), plate(75, 162)],
    foes: [brute(330, 62), brute(330, 100, 1), brute(330, 162, 2)],
  },
  {
    name: { en: 'Slab Gate', zh: '铁块闸门' },
    tip: ['Slabs fly slower: throw them from closer in', '铁块飞得慢：靠近些再射'],
    start: { x: 436, y: 262 },
    pillars: [box(200, 80, 224, 130), box(200, 194, 224, 244)],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [slab(110, 90), slab(110, 234), slab(140, 162), plate(95, 60), plate(95, 264)],
    foes: [charger(330, 100), charger(330, 70, 1), brute(330, 130, 1)],
  },
  {
    name: { en: 'Reactor Forge', zh: '反应炉锻房' },
    tempo: 0.6,
    plating: 1,
    tip: ['Mastery: foes are faster and tougher now', '精通之路：敌人更快、更硬了'],
    start: { x: 436, y: 262 },
    pillars: [box(224, 138, 256, 186)],
    machines: [
      [56, 100],
      [56, 228],
    ],
    metals: [plate(95, 60), plate(95, 264), plate(130, 130), plate(130, 196), slab(110, 162)],
    foes: [charger(330, 60), brute(330, 130), charger(330, 160, 2), brute(330, 110, 3)],
  },
  {
    name: { en: 'Long Shift', zh: '漫长轮班' },
    tempo: 0.6,
    plating: 1,
    tip: ['Five foes in turn: keep metal in orbit', '五个敌人轮番登场：保持轨道上有金属'],
    flip: true,
    start: { x: 436, y: 62 },
    pillars: [box(228, 60, 252, 84), box(228, 240, 252, 264)],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [plate(100, 162), plate(130, 100), plate(130, 224), plate(95, 60), plate(95, 264)],
    foes: [
      brute(330, 230),
      brute(330, 250),
      charger(330, 200, 1),
      brute(330, 230, 2),
      charger(330, 210, 4),
    ],
  },
  {
    name: { en: 'Gap Hall', zh: '缺口长厅' },
    tempo: 0.6,
    plating: 2,
    tip: ['Walls block throws: aim through the gaps', '墙会挡住射线：从缺口处瞄准'],
    start: { x: 436, y: 262 },
    pillars: [
      box(180, 100, 240, 112),
      box(270, 100, 330, 112),
      box(180, 212, 240, 224),
      box(270, 212, 330, 224),
    ],
    machines: [[56, 162]],
    metals: [plate(100, 110), plate(100, 214), plate(135, 162), plate(110, 60)],
    foes: [brute(370, 100), charger(370, 70, 1), brute(370, 130, 2)],
  },
  {
    name: { en: 'Cross Pillars', zh: '十字立柱' },
    tempo: 0.6,
    plating: 1,
    tip: ['Pillars hide foes and machines from your aim', '立柱会遮住敌人，也会挡住瞄准'],
    start: { x: 436, y: 62 },
    pillars: [pillar(150, 150), pillar(306, 150), pillar(228, 110), pillar(228, 190)],
    machines: [
      [56, 100],
      [56, 224],
    ],
    metals: [plate(95, 162), plate(100, 60), plate(100, 264), plate(130, 110), slab(110, 215)],
    foes: [brute(340, 230), charger(340, 260, 1), brute(365, 200, 2), charger(340, 250, 3)],
  },
  {
    name: { en: 'Twin Gallery', zh: '双子长廊' },
    tempo: 0.65,
    plating: 1,
    tip: ['Mastery: two machines, steady hands', '精通之路：两台机器，沉着应对'],
    flip: true,
    start: { x: 436, y: 262 },
    pillars: [pillar(200, 110, 24, 50), pillar(300, 176, 24, 50)],
    machines: [
      [56, 96],
      [56, 228],
    ],
    metals: [plate(100, 162), plate(125, 60), plate(125, 264), plate(140, 120), slab(110, 195)],
    foes: [
      charger(340, 90),
      brute(340, 70),
      charger(340, 110, 1),
      brute(340, 130, 2),
      brute(340, 162, 3),
    ],
  },
  {
    name: { en: 'Triple Charge', zh: '三重冲锋' },
    tempo: 0.5,
    plating: 2,
    tip: ['Mastery: three chargers, three lanes', '精通之路：三个冲锋者，三条通道'],
    start: { x: 436, y: 262 },
    pillars: [box(250, 110, 274, 134), box(250, 190, 274, 214)],
    machines: [
      [56, 80],
      [56, 244],
      [150, 162],
    ],
    metals: [plate(95, 120), plate(95, 204), plate(110, 60), plate(110, 264), plate(75, 162)],
    foes: [charger(340, 62), charger(340, 110, 1), charger(340, 150, 2)],
  },
  {
    name: { en: 'Pressure', zh: '步步紧逼' },
    tempo: 0.6,
    plating: 1,
    tip: ['Mastery: waves of foes keep coming', '精通之路：敌人一波接一波'],
    flip: true,
    start: { x: 436, y: 62 },
    pillars: [pillar(230, 100), pillar(230, 200)],
    machines: [
      [56, 96],
      [56, 228],
      [150, 162],
    ],
    metals: [plate(95, 162), plate(100, 60), plate(100, 264), plate(125, 120), plate(125, 204)],
    foes: [
      brute(330, 230),
      brute(330, 262, 1),
      charger(330, 230, 2),
      brute(330, 262, 3),
      charger(330, 262, 4),
    ],
  },
  {
    name: { en: 'Heavy Duty', zh: '重型作业' },
    tempo: 0.55,
    plating: 1,
    tip: ['Mastery: slabs hit hard, so plan every throw', '精通之路：铁块威力大，谋定而后射'],
    start: { x: 436, y: 262 },
    pillars: [box(250, 100, 274, 124), box(250, 200, 274, 224)],
    machines: [
      [56, 100],
      [56, 224],
    ],
    metals: [slab(110, 162), slab(100, 70), slab(100, 255), slab(135, 120), plate(135, 204)],
    foes: [
      brute(340, 62),
      charger(340, 110),
      brute(340, 62, 1),
      brute(340, 130, 2),
      charger(340, 62, 3),
    ],
  },
  {
    name: { en: 'Final Foundry', zh: '终极铸造厂' },
    tempo: 0.55,
    plating: 1,
    tip: ['Final chamber: use everything you have learned', '最终车间：运用你学到的一切'],
    start: { x: 436, y: 262 },
    pillars: [pillar(250, 100, 24, 40), pillar(250, 190, 24, 40)],
    machines: [
      [56, 100],
      [56, 224],
      [150, 162],
    ],
    metals: [
      plate(95, 60),
      plate(95, 264),
      plate(95, 162),
      plate(130, 110),
      slab(130, 214),
      slab(110, 162),
    ],
    foes: [
      brute(340, 62),
      charger(340, 110, 1),
      brute(340, 62, 2),
      brute(340, 130, 3),
      charger(340, 62, 4),
      charger(340, 110, 5),
      brute(340, 162, 6),
    ],
  },
];
export const CHAMBER_COUNT = CHAMBERS.length;

// ------------------------------------------------------------------ geometry

const grow = (b, r) => box(b.x0 - r, b.y0 - r, b.x1 + r, b.y1 + r);
const boxOf = (e) => box(e.x - e.hw, e.y - e.hh, e.x + e.hw, e.y + e.hh);
const overlaps = (e, b) =>
  e.x - e.hw < b.x1 && e.x + e.hw > b.x0 && e.y - e.hh < b.y1 && e.y + e.hh > b.y0;
const gapBetween = (a, b) =>
  Math.max(0, Math.abs(a.x - b.x) - a.hw - b.hw, Math.abs(a.y - b.y) - a.hh - b.hh);
const inside = (x, y, b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;

// First entry of the moving point (x,y)+(dx,dy)*t, 0<=t<=1, into box b. Null if it starts
// inside, is moving away, or never reaches the box.
export function sweepBox(x, y, dx, dy, b) {
  let tmin = -Infinity,
    tmax = Infinity,
    nx = 0,
    ny = 0;
  for (const axis of [0, 1]) {
    const p = axis ? y : x,
      d = axis ? dy : dx,
      lo = axis ? b.y0 : b.x0,
      hi = axis ? b.y1 : b.x1;
    if (d === 0) {
      if (p <= lo || p >= hi) return null;
      continue;
    }
    let t1 = (lo - p) / d,
      t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      nx = axis ? 0 : -Math.sign(d);
      ny = axis ? -Math.sign(d) : 0;
    }
    tmax = Math.min(tmax, t2);
  }
  if (tmin > tmax || tmin < 0 || tmin > 1) return null;
  return { t: tmin, nx, ny };
}
const segmentHits = (x0, y0, x1, y1, b) =>
  inside(x0, y0, b) || sweepBox(x0, y0, x1 - x0, y1 - y0, b) !== null;

const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? [x / n, y / n] : [0, 0];
};

// ------------------------------------------------------------------ world

const SOUND_FOR = {
  repel: 'shoot',
  attract: 'move',
  hit: 'hit',
  clink: 'coin',
  machine: 'hit',
  hurt: 'hit',
  kill: 'coin',
  clear: 'win',
};

export function createWorld(random = Math.random, first = 0) {
  const w = {
    random,
    acc: 0,
    tick: 0,
    phase: 'playing',
    score: 0,
    nextId: 1,
    sounds: [],
    cleared: 0,
    repelQueued: false,
  };
  loadChamber(w, first);
  return w;
}

export function loadChamber(w, index) {
  const c = CHAMBERS[index];
  const side = c.flip ? -1 : 1; // a flipped room is mirrored left to right
  const mx = (x) => (c.flip ? 480 - x : x);
  const mirrorBox = (b) =>
    box(Math.min(mx(b.x0), mx(b.x1)), b.y0, Math.max(mx(b.x0), mx(b.x1)), b.y1);
  w.chamber = index;
  w.tempo = c.tempo ?? 1;
  w.plating = c.plating ?? 0;
  w.walls = [...FRAME, ...c.pillars.map(mirrorBox)];
  w.p = {
    x: mx(c.start.x),
    y: c.start.y,
    hw: 9,
    hh: 9,
    fx: -side,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: MAX_HP,
    inv: 0,
    lock: 0,
    cd: 0,
    pulse: 0,
    space: false,
    attracting: false,
  };
  w.machines = c.machines.map((m, k) => ({
    id: `m${k}`,
    x: mx(m[0]),
    y: m[1],
    hw: 12,
    hh: 12,
    hp: MACHINE_HP,
    flash: 0,
  }));
  w.metals = c.metals.map((m, k) => ({
    id: `s${k}`,
    kind: m.kind,
    x: mx(m.x),
    y: m.y,
    hw: METALS[m.kind].hw,
    hh: METALS[m.kind].hw,
    mass: METALS[m.kind].mass,
    vx: 0,
    vy: 0,
    held: false,
    ang: 0,
    r: 0,
    touch: {},
  }));
  w.foes = [];
  w.pending = c.foes.map((f) => ({
    ...f,
    x: mx(f.x),
    y: clamp(f.y + (w.random() - 0.5) * 60, 60, 262),
  }));
  w.defeated = 0;
  w.clearT = 0;
  w.events = [];
  w.msg = null;
  w.advice = null;
  w.laneWarn = false;
  w.attack = null;
  w.pendingMsg = null;
  w.fx = [];
  w.aim = null;
  w.aimGrace = 0;
  w.aimBlocked = false;
  w.blockedIds = [];
  spawnPending(w);
  say(w, ...c.tip);
}

const DOOR_SHIFTS = [0, 40, -40, 80, -80, 120, -120];

// A foe never steps out onto the player: it uses the nearest free spot along its doorway instead.
function doorSpot(w, spec) {
  const base = FOES[spec.type];
  const free = (y) => {
    const e = { x: spec.x, y, hw: base.hw, hh: base.hh };
    return gapBetween(e, w.p) > TOUCH_GAP && !w.walls.some((b) => overlaps(e, b));
  };
  const y = DOOR_SHIFTS.map((d) => clamp(spec.y + d, 60, 262)).find(free);
  return y === undefined ? spec.y : y;
}

export function spawnPending(w) {
  const ready = w.pending.filter((f) => f.after <= w.defeated);
  w.pending = w.pending.filter((f) => f.after > w.defeated);
  for (const spec of ready) {
    const base = FOES[spec.type];
    w.foes.push({
      id: `f${w.nextId++}`,
      type: spec.type,
      x: spec.x,
      y: doorSpot(w, spec),
      hw: base.hw,
      hh: base.hh,
      hp: base.hp + w.plating,
      maxHp: base.hp + w.plating,
      walkSpeed: base.speed / w.tempo,
      windTime: base.wind * w.tempo,
      restTime: base.rest * w.tempo,
      vx: 0,
      vy: 0,
      state: 'walk',
      t: 0,
      dirx: -1,
      diry: 0,
      target: null,
      spawnT: SPAWN_TIME,
      stun: 0,
      flash: 0,
      detour: 0,
    });
  }
}

const emit = (w, name) => {
  w.events.push({ name, tick: w.tick });
  if (SOUND_FOR[name]) w.sounds.push(SOUND_FOR[name]);
};
// A queued event replaces the shown one as soon as the shown one has had its dwell. This also runs
// at the end of a tick, so a replaced event can never reappear for a tick once a warning ends.
function promoteMessage(w) {
  if (w.pendingMsg && !w.laneWarn && (!w.msg || w.msg.age >= MSG_MIN)) {
    w.msg = { ...w.pendingMsg, t: MSG_TIME, age: 0 };
    w.pendingMsg = null;
  }
}
// Event messages stay readable for MSG_MIN before a newer one replaces it; the newest waits its turn.
// Two condition-bound lines sit beside them and are never delayed by them: the red-lane warning
// (live while the player is inside a live lane) and X advice (live while its cause remains).
const say = (w, en, zh) => {
  if (!w.msg) w.msg = { en, zh, t: MSG_TIME, age: 0 };
  else w.pendingMsg = { en, zh };
};
const attackWarning = (n) => ({
  en: `Machine ${n} under attack!`,
  zh: `${n}号机器遭到攻击！`,
});
const LANE_WARNING = { en: 'RED LANE: step out of the line!', zh: '红色通道：快离开冲锋路线！' };
function burst(w, x, y, color, n) {
  for (let i = 0; i < n && w.fx.length < MAX_FX; i++) {
    const a = w.random() * Math.PI * 2,
      s = 30 + w.random() * 70;
    w.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.35, color });
  }
}

// Solids for the player (and orbiting metal) include foes; solids for a foe include the player.
const blockersFor = (w, forFoe = false) => [
  ...w.walls,
  ...w.machines.map(boxOf),
  ...(forFoe ? [boxOf(w.p)] : w.foes.map(boxOf)),
];

// Axis-separated move; returns which axes were blocked.
function moveBody(e, dx, dy, blockers) {
  let bx = false,
    by = false;
  e.x += dx;
  if (blockers.some((b) => overlaps(e, b))) {
    e.x -= dx;
    bx = true;
  }
  e.y += dy;
  if (blockers.some((b) => overlaps(e, b))) {
    e.y -= dy;
    by = true;
  }
  return { bx, by };
}

// ------------------------------------------------------------------ metal

function targetsFor(w, m) {
  const list = w.walls.map((b) => ({ kind: 'wall', box: grow(b, m.hw) }));
  for (const k of w.machines)
    list.push({ kind: 'machine', key: k.id, ref: k, box: grow(boxOf(k), m.hw) });
  for (const f of w.foes) {
    if (f.spawnT <= 0) list.push({ kind: 'foe', key: f.id, ref: f, box: grow(boxOf(f), m.hw) });
  }
  return list;
}

// Push metal out of anything it overlaps (a foe walked into it); no damage, no velocity change.
function separate(m, targets) {
  const solids = targets.filter((t) => t.kind !== 'foe');
  for (const t of targets) {
    if (!inside(m.x, m.y, t.box)) continue;
    const b = t.box;
    const pushes = [
      [m.x - b.x0, -1, 0],
      [b.x1 - m.x, 1, 0],
      [m.y - b.y0, 0, -1],
      [b.y1 - m.y, 0, 1],
    ].sort((a, c) => a[0] - c[0]);
    // Prefer the shortest push that does not squeeze the piece into a wall or machine.
    const at = ([depth, nx, ny]) => [m.x + nx * (depth + SKIN), m.y + ny * (depth + SKIN)];
    const free = pushes.find((push) => {
      const [x, y] = at(push);
      return !solids.some((o) => o !== t && inside(x, y, o.box));
    });
    [m.x, m.y] = at(free ?? pushes[0]);
    if (t.key) m.touch[t.key] = true;
  }
}

export const impactDamage = (speed, mass) =>
  Math.min(MAX_DAMAGE, 1 + Math.floor((speed - ARMOR_V) / IMPACT_STEP) + (mass - 1));

function damageFoe(w, f, amount) {
  f.hp -= amount;
  f.flash = 0.25;
  f.stun = 0.4;
  if (f.state === 'dash') {
    f.state = 'dizzy';
    f.t = 1;
  }
  w.score += 10 * amount;
  burst(w, f.x, f.y, '#ffb347', 8);
  if (f.hp > 0) {
    emit(w, 'hit');
    say(w, `Armor cracked -${amount}`, `装甲碎裂 -${amount}`);
    return;
  }
  w.foes = w.foes.filter((e) => e !== f);
  if (w.aim === f.id) w.aim = null;
  w.defeated += 1;
  w.score += 100;
  burst(w, f.x, f.y, '#ff6b35', 14);
  emit(w, 'kill');
  say(w, 'Enemy down!', '敌人倒下了！');
}

function damageMachine(w, k, amount, own) {
  k.hp = Math.max(0, k.hp - amount);
  w.blame = own ? 'own' : 'enemy';
  const n = w.machines.indexOf(k) + 1;
  k.flash = 0.4;
  burst(w, k.x, k.y, '#ffe066', 8);
  emit(w, 'machine');
  say(
    w,
    own
      ? `Your metal hit machine ${n}! ${k.hp}/${MACHINE_HP}`
      : `Machine ${n} hit! ${k.hp}/${MACHINE_HP}`,
    own
      ? `你的金属撞到了${n}号机器！${k.hp}/${MACHINE_HP}`
      : `${n}号机器被击中！${k.hp}/${MACHINE_HP}`,
  );
}

function bounce(m, nx, ny, ovx, ovy, e) {
  const rvx = m.vx - ovx,
    rvy = m.vy - ovy;
  const along = rvx * nx + rvy * ny;
  if (along >= 0) return;
  const k = -(1 + e) * along;
  m.vx += nx * k;
  m.vy += ny * k;
}

function respond(w, m, hit) {
  const { nx, ny, target: t } = hit;
  if (t.kind === 'wall') {
    const along = -(m.vx * nx + m.vy * ny);
    bounce(m, nx, ny, 0, 0, along < REST_V ? 0 : RESTITUTION_WALL);
    return;
  }
  const ref = t.ref;
  const ovx = t.kind === 'foe' ? ref.vx : 0,
    ovy = t.kind === 'foe' ? ref.vy : 0;
  const approach = -((m.vx - ovx) * nx + (m.vy - ovy) * ny);
  const fresh = !m.touch[t.key];
  m.touch[t.key] = true;
  bounce(m, nx, ny, ovx, ovy, RESTITUTION_BODY);
  if (!fresh) return;
  if (t.kind === 'machine') {
    if (approach >= MACHINE_V)
      damageMachine(w, ref, 1 + (m.mass - 1) * (approach >= ARMOR_V ? 1 : 0), true);
  } else if (approach >= ARMOR_V) {
    damageFoe(w, ref, impactDamage(approach, m.mass));
  } else if (approach >= 30) {
    emit(w, 'clink');
    say(w, 'Too slow: armor needs fast metal', '太慢了：装甲需要高速金属');
  }
}

function moveMetal(w, m) {
  let left = 1;
  for (let i = 0; i < 4 && left > 1e-6 && (m.vx || m.vy); i++) {
    const dx = m.vx * STEP * left,
      dy = m.vy * STEP * left;
    let best = null;
    for (const target of targetsFor(w, m)) {
      const h = sweepBox(m.x, m.y, dx, dy, target.box);
      if (h && (!best || h.t < best.t)) best = { ...h, target };
    }
    if (!best) {
      m.x += dx;
      m.y += dy;
      return;
    }
    m.x += dx * best.t + best.nx * SKIN;
    m.y += dy * best.t + best.ny * SKIN;
    left *= 1 - best.t;
    respond(w, m, best);
  }
}

// Metal in a slow orbit is carried by the magnet. It is blocked by solids but never hurts.
function stepHeld(w, m) {
  const p = w.p;
  m.ang += ORBIT_W * STEP;
  m.r += clamp(ORBIT_R - m.r, -RADIAL_V * STEP, RADIAL_V * STEP);
  const wx = p.x + Math.cos(m.ang) * m.r - m.x,
    wy = p.y + Math.sin(m.ang) * m.r - m.y;
  const [ux, uy] = unit(wx, wy);
  const gap = Math.hypot(wx, wy);
  const step = Math.min(gap, HOLD_MAX_V * STEP);
  const blockers = blockersFor(w).map((b) => grow(b, m.hw));
  const probe = { x: m.x, y: m.y, hw: 0, hh: 0 };
  moveBody(probe, ux * step, uy * step, blockers);
  m.x = probe.x;
  m.y = probe.y;
  m.vx = -Math.sin(m.ang) * m.r * ORBIT_W;
  m.vy = Math.cos(m.ang) * m.r * ORBIT_W;
}

function stepLoose(w, m, attracting, heldCount) {
  const p = w.p;
  separate(m, targetsFor(w, m));
  const dx = p.x - m.x,
    dy = p.y - m.y,
    d = Math.hypot(dx, dy);
  const speed = Math.hypot(m.vx, m.vy);
  if (attracting && speed < ARMOR_V) {
    if (d < CAPTURE_R && heldCount < MAX_HELD) {
      m.held = true;
      emit(w, 'attract');
      m.ang = Math.atan2(m.y - p.y, m.x - p.x);
      m.r = d;
      return true;
    }
    if (d < FIELD_R && d > DEAD_R) {
      const a = (ATTRACT_A * (1 - d / FIELD_R)) / m.mass;
      m.vx += (dx / d) * a * STEP;
      m.vy += (dy / d) * a * STEP;
      const s = Math.hypot(m.vx, m.vy);
      const cap = Math.max(speed, ATTRACT_VMAX);
      if (s > cap) {
        m.vx *= cap / s;
        m.vy *= cap / s;
      }
    }
  }
  const s = Math.hypot(m.vx, m.vy);
  if (s > 0) {
    const k = Math.max(0, s - FRICTION * STEP) / s;
    m.vx *= k;
    m.vy *= k;
  }
  moveMetal(w, m);
  return false;
}

function refreshTouch(w, m) {
  for (const key of Object.keys(m.touch)) {
    const other = w.machines.find((k) => k.id === key) || w.foes.find((f) => f.id === key);
    if (!other || gapBetween(m, other) > TOUCH_CLEAR) delete m.touch[key];
  }
}

// ------------------------------------------------------------------ aiming and repel

function findAim(w) {
  const p = w.p;
  const solids = [...w.walls.map((b) => grow(b, 4)), ...w.machines.map((k) => grow(boxOf(k), 8))];
  let best = null,
    drifted = null,
    kept = false;
  w.blockedIds = [];
  for (const f of w.foes) {
    if (f.spawnT > 0) continue;
    const dx = f.x - p.x,
      dy = f.y - p.y,
      d = Math.hypot(dx, dy);
    const off = Math.acos(clamp((dx * p.fx + dy * p.fy) / d, -1, 1));
    const locked = f.id === w.aim;
    const blocked = solids.some((b) => segmentHits(p.x, p.y, f.x, f.y, b));
    if (d > AIM_RANGE || off > (locked ? AIM_KEEP : AIM_CONE)) {
      if (locked && !blocked) drifted = f;
      continue;
    }
    if (blocked) w.blockedIds.push(f.id);
    else if (locked) kept = true;
    else if (!best || off < best.off) best = { f, off };
  }
  w.aimBlocked = w.blockedIds.length > 0;
  if (kept) w.aimGrace = AIM_GRACE;
  else if (best) {
    w.aim = best.f.id;
    w.aimGrace = AIM_GRACE;
  } else if (drifted && !w.aimBlocked && w.aimGrace > 0) {
    // a lock that just drifted out of the cone lingers briefly so the prompt does not flicker
    w.aimGrace -= STEP;
  } else w.aim = null;
}

function launchHeld(w, target) {
  const p = w.p;
  const dir = unit(target.x - p.x, target.y - p.y);
  // The orbiting piece nearest to the aimed direction leaves first; the rest stay in orbit.
  const m = w.metals
    .filter((e) => e.held)
    .reduce((best, e) => {
      const [ex, ey] = unit(e.x - p.x, e.y - p.y);
      const score = ex * dir[0] + ey * dir[1];
      return !best || score > best.score ? { e, score } : best;
    }, null).e;
  const launch = METALS[m.kind].launch;
  const lead = Math.hypot(target.x - m.x, target.y - m.y) / launch;
  const [ux, uy] = unit(target.x + target.vx * lead - m.x, target.y + target.vy * lead - m.y);
  m.held = false;
  m.vx = ux * launch;
  m.vy = uy * launch;
}

function repel(w) {
  const p = w.p;
  const target = w.foes.find((f) => f.id === w.aim);
  const refusal = !w.metals.some((m) => m.held)
    ? ['empty', 'Nothing in orbit: hold Space to pull metal in', '轨道上没有金属：按住空格吸引']
    : !target
      ? w.aimBlocked
        ? ['blocked', 'Line of fire blocked: sidestep, then X', '射线被挡住：先横向移动，再按X']
        : [
            'nolock',
            'No lock-on: face an enemy until the bracket shows',
            '没有锁定：面向敌人直到出现准星',
          ]
      : null;
  if (refusal) {
    const [kind, en, zh] = refusal;
    w.advice = { kind, en, zh, t: MSG_TIME };
    p.cd = 0.3;
    return;
  }
  launchHeld(w, target);
  p.cd = REPEL_CD;
  p.lock = REPEL_LOCK;
  p.pulse = 0.3;
  emit(w, 'repel');
}

// ------------------------------------------------------------------ player and foes

function hurtPlayer(w, from) {
  const p = w.p;
  p.hp -= 1;
  p.inv = INVULN;
  emit(w, 'hurt');
  say(w, `Hit! HP ${Math.max(0, p.hp)}`, `受伤了！生命 ${Math.max(0, p.hp)}`);
  burst(w, p.x, p.y, '#ff4d4d', 6);
  const [ux, uy] = unit(p.x - from.x, p.y - from.y);
  const blockers = blockersFor(w);
  for (let i = 0; i < KNOCKBACK; i++) moveBody(p, ux, uy, blockers);
}

function stepPlayer(w, inp) {
  const p = w.p;
  p.inv = Math.max(0, p.inv - STEP);
  p.lock = Math.max(0, p.lock - STEP);
  p.cd = Math.max(0, p.cd - STEP);
  p.pulse = Math.max(0, p.pulse - STEP);
  const [ux, uy] = unit(
    (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
    (inp.down ? 1 : 0) - (inp.up ? 1 : 0),
  );
  if (ux || uy) {
    p.fx = ux;
    p.fy = uy;
  }
  p.vx = ux * SPEED;
  p.vy = uy * SPEED;
  moveBody(p, p.vx * STEP, p.vy * STEP, blockersFor(w));
  p.space = inp.space;
  p.attracting = inp.space && p.lock <= 0;
}

const nearestMachine = (w, f) =>
  w.machines.reduce(
    (best, k) =>
      !best || Math.hypot(k.x - f.x, k.y - f.y) < Math.hypot(best.x - f.x, best.y - f.y) ? k : best,
    null,
  );

// A chamber's `tempo` (below 1 = faster) scales how long its foes telegraph and rest.
const windOf = (f) => f.windTime ?? FOES[f.type].wind;
const restOf = (f) => f.restTime ?? FOES[f.type].rest;
function enterWind(f, k) {
  f.state = 'wind';
  f.t = windOf(f);
  [f.dirx, f.diry] = unit(k.x - f.x, k.y - f.y);
}

function stepFoe(w, f) {
  f.flash = Math.max(0, f.flash - STEP);
  f.vx = f.vy = 0;
  if (f.spawnT > 0) {
    f.spawnT = Math.max(0, f.spawnT - STEP);
    return;
  }
  if (f.stun > 0) {
    f.stun = Math.max(0, f.stun - STEP);
    if (f.stun === 0 && f.state === 'wind') f.t = windOf(f);
    return;
  }
  const base = FOES[f.type];
  const k = nearestMachine(w, f);
  f.target = k.id;
  const blockers = blockersFor(w, true);
  const walk = (ux, uy, speed) => {
    f.vx = ux * speed;
    f.vy = uy * speed;
    const { bx, by } = moveBody(f, f.vx * STEP, f.vy * STEP, blockers);
    if (!bx && !by) f.detour = 0;
    else if (bx !== by) {
      // Slide around an obstacle at full speed instead of creeping along its face.
      f.detour ||= (bx ? k.y - f.y : k.x - f.x) >= 0 ? 1 : -1;
      moveBody(f, by ? f.detour * speed * STEP : 0, bx ? f.detour * speed * STEP : 0, blockers);
    }
  };
  f.t = Math.max(0, f.t - STEP);
  if (f.state === 'walk') {
    const [ux, uy] = unit(k.x - f.x, k.y - f.y);
    const dist = Math.hypot(k.x - f.x, k.y - f.y);
    if (f.type === 'brute' ? gapBetween(f, k) <= 3 : dist <= CHARGE_RANGE) enterWind(f, k);
    else walk(ux, uy, f.walkSpeed ?? base.speed);
  } else if (f.state === 'wind') {
    if (f.t > 0) return;
    if (f.type === 'charger') {
      f.state = 'dash';
      f.t = DASH_TIME;
    } else {
      damageMachine(w, k, base.dmg, false);
      f.state = 'rest';
      f.t = restOf(f);
    }
  } else if (f.state === 'dash') {
    const { bx, by } = moveBody(
      f,
      f.dirx * DASH_V * STEP,
      f.diry * DASH_V * STEP,
      blockersFor(w, true),
    );
    f.vx = f.dirx * DASH_V;
    f.vy = f.diry * DASH_V;
    const rammed = w.machines.find((m) => gapBetween(f, m) <= 2);
    if (rammed) damageMachine(w, rammed, base.dmg, false);
    if (rammed || bx || by || f.t === 0) {
      f.state = 'dizzy';
      f.t = restOf(f);
    }
  } else if (f.state === 'dizzy') {
    if (f.t === 0) {
      f.state = 'back';
      f.t = 1;
    }
  } else if (f.state === 'back') {
    const [ux, uy] = unit(f.x - k.x, f.y - k.y);
    walk(ux, uy, 60);
    if (f.t === 0) f.state = 'walk';
  } else if (f.t === 0) {
    // brute rests after a strike, then winds up again
    enterWind(f, k);
  }
}

// Only a telegraphed charge hurts the player; walking foes merely block.
const isHostile = (f) => f.spawnT <= 0 && f.stun <= 0 && f.state === 'dash';

// ------------------------------------------------------------------ prompts

// One standing instruction that is always true, so it can never lag or contradict the screen.
// Situational warnings (red lanes, hits, clears) arrive as short event messages instead.
export const PROMPTS = {
  play: [
    'Hold Space: pull · face foe, X: throw · dodge red',
    '按住空格吸金属·面向敌人按X射出·躲开红色通道',
  ],
};

// The drawn lane, the red-lane warning and the dash hit test share one shape: the strip swept by the
// charger's box plus the player's box (axis-aligned boxes are wider on a diagonal).
export const laneHalf = (f, playerHw = 9) =>
  (f.hw + playerHw + TOUCH_GAP) * (Math.abs(f.dirx) + Math.abs(f.diry));
export const laneLength = (f, playerHw = 9) => DASH_V * DASH_TIME + f.hw + playerHw + TOUCH_GAP;
export function inLane(p, f) {
  if (f.type !== 'charger' || f.state !== 'wind') return false;
  const rx = p.x - f.x,
    ry = p.y - f.y;
  const along = rx * f.dirx + ry * f.diry,
    side = Math.abs(-rx * f.diry + ry * f.dirx);
  return along > -f.hw && along < laneLength(f, p.hw) && side < laneHalf(f, p.hw);
}

// ------------------------------------------------------------------ simulation

export const END_TEXT = {
  won: [
    `All ${CHAMBER_COUNT} chambers cleared: the foundry is yours!`,
    `${CHAMBER_COUNT}间车间全部清空：铸造厂是你的了！`,
  ],
  machineEnemy: [
    'Enemies wrecked the machinery. Hit them before their wind-up ends.',
    '敌人毁掉了机器。请在它们蓄力结束前击中它们。',
  ],
  machineOwn: [
    'Your metal wrecked the machinery. Check the line of fire before you throw.',
    '你的金属毁掉了机器。投掷前请确认射线上没有机器。',
  ],
  body: [
    'The Marauder was crushed. Back away from enemies and charge lanes.',
    '奇兵被击倒了。请远离敌人和冲锋通道。',
  ],
};

function finish(w, kind) {
  w.phase = kind === 'won' ? 'won' : 'lost';
  w.endKind = kind;
  emit(w, w.phase === 'won' ? 'win' : 'lose');
}

function tick(w, inp) {
  w.tick++;
  w.events = w.events.filter((e) => w.tick - e.tick < EVENT_KEEP);
  // an event's dwell clock is paused while a lane warning hides it
  if (w.msg && !w.laneWarn) {
    const t = w.msg.t - STEP;
    w.msg = t > 0 ? { ...w.msg, t, age: w.msg.age + STEP } : null;
  }
  promoteMessage(w);
  w.fx = w.fx
    .map((e) => ({ ...e, x: e.x + e.vx * STEP, y: e.y + e.vy * STEP, t: e.t - STEP }))
    .filter((e) => e.t > 0);
  for (const k of w.machines) k.flash = Math.max(0, k.flash - STEP);
  stepPlayer(w, inp);
  findAim(w);
  if (inp.repel && w.p.cd <= 0) repel(w);
  for (const f of [...w.foes]) {
    const hostile = isHostile(f);
    stepFoe(w, f);
    if (hostile && w.p.inv <= 0 && gapBetween(w.p, f) <= TOUCH_GAP) hurtPlayer(w, f);
  }
  const attracting = w.p.attracting && w.p.lock <= 0;
  let heldCount = w.metals.filter((m) => m.held).length;
  for (const m of w.metals) {
    if (m.held && !w.p.space) m.held = false;
    if (m.held) stepHeld(w, m);
    else if (stepLoose(w, m, attracting, heldCount)) heldCount++;
    refreshTouch(w, m);
  }
  w.laneWarn = w.foes.some((f) => inLane(w.p, f));
  // live exactly while some foe's wind-up is aimed at a machine
  const striker = w.foes.find((f) => f.state === 'wind' && f.spawnT <= 0);
  w.attack = striker ? w.machines.find((k) => k.id === striker.target) : null;
  const a = w.advice;
  if (a) {
    const over =
      a.kind === 'empty'
        ? w.metals.some((m) => m.held)
        : a.kind === 'blocked'
          ? !w.aimBlocked || w.aim
          : w.aim;
    w.advice = a.t - STEP > 0 && !over ? { ...a, t: a.t - STEP } : null;
  }
  if (w.machines.some((k) => k.hp <= 0))
    return finish(w, w.blame === 'own' ? 'machineOwn' : 'machineEnemy');
  if (w.p.hp <= 0) return finish(w, 'body');
  spawnPending(w);
  if (w.clearT > 0) {
    w.clearT = Math.max(0, w.clearT - STEP);
    if (w.clearT === 0) loadChamber(w, w.chamber + 1);
  } else if (!w.foes.length && !w.pending.length) {
    w.score += 200 + 25 * w.machines.reduce((s, k) => s + k.hp, 0);
    w.cleared = w.chamber + 1;
    if (w.chamber === CHAMBER_COUNT - 1) return finish(w, 'won');
    w.clearT = CLEAR_TIME;
    emit(w, 'clear');
    say(w, 'Chamber clear!', '车间已清空！');
  }
  promoteMessage(w);
}

const readInput = (input, repel) => ({
  left: input.held('ArrowLeft', 'KeyA'),
  right: input.held('ArrowRight', 'KeyD'),
  up: input.held('ArrowUp', 'KeyW'),
  down: input.held('ArrowDown', 'KeyS'),
  space: input.held('Space'),
  repel,
});

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
  w.acc += Math.min(dt, MAX_FRAME);
  w.sounds = [];
  // A press made in a frame that runs no tick (a very fast display) waits for the next tick.
  if (input.pressed('KeyX')) w.repelQueued = true;
  while (w.acc + 1e-9 >= STEP && w.phase === 'playing') {
    w.acc -= STEP;
    tick(w, readInput(input, Boolean(w.repelQueued)));
    w.repelQueued = false;
  }
  if (Math.abs(w.acc) < 1e-9) w.acc = 0;
}

// ------------------------------------------------------------------ snapshot

export function snapshot(w) {
  const p = w.p;
  const [en, zh] = PROMPTS.play;
  const heldN = w.metals.filter((m) => m.held).length;
  const worst = Math.min(...w.machines.map((k) => k.hp));
  // lane > a fresh event (its 0.7 s dwell) > machine under attack > older event > advice
  const attack = w.attack ? attackWarning(w.machines.indexOf(w.attack) + 1) : null;
  const fresh = w.msg && w.msg.age < MSG_MIN;
  const [msg, messageKind] = w.laneWarn
    ? [LANE_WARNING, 'lane']
    : fresh
      ? [w.msg, 'event']
      : attack
        ? [attack, 'attack']
        : w.msg
          ? [w.msg, 'event']
          : [w.advice, 'advice'];
  return {
    phase: w.phase,
    score: w.score,
    time: w.tick * STEP,
    chamber: w.chamber + 1,
    chamberCount: CHAMBER_COUNT,
    chamberName: { ...CHAMBERS[w.chamber].name },
    hp: Math.max(0, p.hp),
    maxHp: MAX_HP,
    reserve: w.pending.length,
    held: heldN,
    prompt: { key: 'play', en, zh },
    message: msg ? { en: msg.en, zh: msg.zh } : null,
    messageKind: msg ? messageKind : null,
    player: {
      x: p.x,
      y: p.y,
      hw: p.hw,
      hh: p.hh,
      face: { x: p.fx, y: p.fy },
      polarity: p.lock > 0 ? 'repel' : p.attracting ? 'attract' : 'idle',
      repelCooldown: p.cd,
      invulnerable: p.inv,
    },
    field: { radius: FIELD_R, deadZone: DEAD_R, captureRadius: CAPTURE_R, orbitRadius: ORBIT_R },
    armorSpeed: ARMOR_V,
    aim: w.aim,
    aimBlocked: w.aimBlocked,
    blockedFoes: [...w.blockedIds],
    metals: w.metals.map(({ touch, ...m }) => {
      const speed = Math.hypot(m.vx, m.vy);
      return { ...m, speed, fast: !m.held && speed >= ARMOR_V, contacts: Object.keys(touch) };
    }),
    foes: w.foes.map((f) => ({
      ...f,
      windLeft: f.state === 'wind' ? f.t : 0,
      lane:
        f.type === 'charger' && f.state === 'wind'
          ? { x: f.dirx, y: f.diry, length: laneLength(f), half: laneHalf(f) }
          : null,
      spawning: f.spawnT > 0,
      stunned: f.stun > 0,
    })),
    machines: w.machines.map((k) => ({ ...k, maxHp: MACHINE_HP })),
    walls: w.walls.map((b) => ({ ...b })),
    events: w.events.map((e) => e.name),
    status: {
      en: `Chamber ${w.chamber + 1}/${CHAMBER_COUNT} · Weakest machine ${worst}/${MACHINE_HP} · HP ${Math.max(0, p.hp)} · ${msg ? msg.en + ' · ' : ''}${en}`,
      zh: `第${w.chamber + 1}/${CHAMBER_COUNT}间 · 最弱机器 ${worst}/${MACHINE_HP} · 生命 ${Math.max(0, p.hp)} · ${msg ? msg.zh + ' · ' : ''}${zh}`,
    },
  };
}

// ------------------------------------------------------------------ chamber select

export const MENU = { cols: 9, cellW: 44, cellH: 34, gap: 6, x0: 18, y0: 50 };
const MENU_STEPS = [
  [['ArrowLeft', 'KeyA'], -1],
  [['ArrowRight', 'KeyD'], 1],
  [['ArrowUp', 'KeyW'], -MENU.cols],
  [['ArrowDown', 'KeyS'], MENU.cols],
];
const cellBox = (i) => ({
  x: MENU.x0 + (i % MENU.cols) * (MENU.cellW + MENU.gap),
  y: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.cellH + MENU.gap),
});

// Pure menu step: arrows move the highlight within the unlocked chambers, Space/X or a click starts.
export function menuStep(menu, input) {
  const pointer = input.pointer || {};
  if (pointer.clicked) {
    for (let i = 0; i < menu.unlocked; i++) {
      const c = cellBox(i);
      const hit =
        pointer.x >= c.x &&
        pointer.x < c.x + MENU.cellW &&
        pointer.y >= c.y &&
        pointer.y < c.y + MENU.cellH;
      if (hit) return { ...menu, sel: i, open: false };
    }
  }
  if (input.pressed('Space', 'KeyX', 'Enter')) return { ...menu, open: false };
  const move = MENU_STEPS.reduce((sum, [keys, d]) => sum + (input.pressed(...keys) ? d : 0), 0);
  return { ...menu, sel: clamp(menu.sel + move, 0, menu.unlocked - 1) };
}

// Progress is a convenience: a broken store must not stop the game.
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress?.unlocked?.() ?? 1));
    return Number.isFinite(n) ? clamp(n, 1, CHAMBER_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, chamber) {
  try {
    progress?.unlock?.(chamber);
  } catch {
    // Ignored on purpose: see readUnlocked.
  }
}

export function createGame(env) {
  const unlocked = readUnlocked(env.progress);
  const w = createWorld(env.random);
  // Only offer a choice when there is something to choose.
  let menu = { open: unlocked > 1, sel: unlocked - 1, unlocked };
  let reported = 0;
  let ended = false;
  const startPlay = () => {
    if (menu.sel > 0) loadChamber(w, menu.sel);
  };
  return {
    update(dt, input) {
      if (ended) return;
      if (menu.open) {
        menu = menuStep(menu, input);
        if (!menu.open) startPlay();
        return;
      }
      stepWorld(w, dt, input);
      for (const s of w.sounds) env.sound(s);
      if (w.cleared > reported) {
        reported = w.cleared;
        saveUnlocked(env.progress, Math.min(CHAMBER_COUNT, reported + 1));
      }
      if (w.phase === 'playing') return;
      ended = true;
      const won = w.phase === 'won',
        [en, zh] = END_TEXT[w.endKind];
      env.sound(won ? 'win' : 'lose');
      env.end({ won, score: w.score, message: env.t(en, zh) });
    },
    draw(ctx) {
      if (menu.open) drawMenu(ctx, menu, env);
      else drawWorld(ctx, w, env);
    },
    getState() {
      const s = snapshot(w);
      return menu.open
        ? { ...s, phase: 'menu', menu: { ...menu, chamber: menu.sel + 1, count: CHAMBER_COUNT } }
        : { ...s, menu: null };
    },
  };
}

// ------------------------------------------------------------------ drawing

const C = {
  floor: '#2a2d33',
  floorLine: '#34383f',
  wall: '#4a4e57',
  wallDark: '#2c2f36',
  rivet: '#7b808b',
  glow: '#ff7a1a',
  north: '#e04646',
  south: '#3d7bff',
  steel: '#aab2bf',
  steelDark: '#6d7480',
  hud: '#14161a',
};
const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const ring = (ctx, color, x, y, r, width = 1, dash = []) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
};

function drawFloor(ctx, w) {
  background(ctx, C.floor);
  for (let x = ARENA.x0; x < ARENA.x1; x += 32)
    rect(ctx, C.floorLine, x, ARENA.y0, 1, ARENA.y1 - ARENA.y0);
  for (let y = ARENA.y0; y < ARENA.y1; y += 32)
    rect(ctx, C.floorLine, ARENA.x0, y, ARENA.x1 - ARENA.x0, 1);
  rect(ctx, '#3a2a1a', ARENA.x0, ARENA.y1 - 4, ARENA.x1 - ARENA.x0, 4);
  rect(ctx, C.glow, ARENA.x0, ARENA.y1 - 2, ARENA.x1 - ARENA.x0, 1);
  for (const b of w.walls) {
    rect(ctx, C.wall, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    rect(ctx, C.wallDark, b.x0, b.y1 - 3, b.x1 - b.x0, 3);
    for (let x = b.x0 + 4; x < b.x1 - 2; x += 16) rect(ctx, C.rivet, x, b.y0 + 2, 2, 2);
  }
}

function drawMachine(ctx, k) {
  const hurt = k.hp <= 2;
  rect(ctx, '#1d2a22', k.x - 12, k.y - 12, 24, 24);
  rect(ctx, k.flash > 0 ? '#ffffff' : '#3f8f5b', k.x - 10, k.y - 10, 20, 20);
  rect(ctx, hurt ? '#ff4d4d' : '#9cffb5', k.x - 6, k.y - 6, 12, 4);
  rect(ctx, '#ffe066', k.x - 6, k.y + 2, 4, 4);
  rect(ctx, '#ffe066', k.x + 2, k.y + 2, 4, 4);
  if (hurt) {
    rect(ctx, '#111', k.x - 2, k.y - 12, 2, 10);
    rect(ctx, '#777', k.x + 3, k.y - 18, 4, 4);
  }
  rect(ctx, '#444', k.x - 12, k.y - 17, 24, 3);
  rect(
    ctx,
    k.hp <= 4 ? '#ff6b6b' : '#9cffb5',
    k.x - 12,
    k.y - 17,
    Math.ceil((k.hp / MACHINE_HP) * 24),
    3,
  );
}

function drawMetal(ctx, m) {
  const s = m.hw * 2;
  if (!m.held && Math.hypot(m.vx, m.vy) >= ARMOR_V) {
    const [ux, uy] = unit(m.vx, m.vy);
    for (let i = 1; i <= 3; i++)
      rect(ctx, i === 1 ? '#ffd27a' : '#ff7a1a', m.x - ux * i * 7 - 3, m.y - uy * i * 7 - 3, 6, 6);
    ring(ctx, '#ffb347', m.x, m.y, m.hw + 4, 2);
  }
  rect(ctx, C.steelDark, m.x - m.hw, m.y - m.hw, s, s);
  rect(ctx, C.steel, m.x - m.hw + 2, m.y - m.hw + 2, s - 4, s - 4);
  rect(ctx, C.north, m.x - m.hw + 2, m.y - 2, Math.floor((s - 4) / 2), 4);
  rect(ctx, C.south, m.x + 0, m.y - 2, Math.floor((s - 4) / 2), 4);
  if (m.kind === 'slab')
    for (let i = 0; i < 3; i++) rect(ctx, '#333', m.x - m.hw + 3 + i * 6, m.y + m.hw - 6, 3, 3);
  if (m.held) ring(ctx, C.south, m.x, m.y, m.hw + 2, 1, [2, 2]);
}

function drawFoe(ctx, f, time, aimed, blocked) {
  const spawn = f.spawnT > 0;
  if (spawn && Math.floor(time * 12) % 2) return;
  const wind = f.state === 'wind';
  const body = f.flash > 0 ? '#ffffff' : f.type === 'brute' ? '#7a5a48' : '#8a3d3d';
  const x = f.x - f.hw,
    y = f.y - f.hh;
  if (f.type === 'charger' && wind) {
    ctx.fillStyle = Math.floor(time * 10) % 2 ? 'rgba(255,60,60,0.35)' : 'rgba(255,60,60,0.2)';
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(Math.atan2(f.diry, f.dirx));
    ctx.fillRect(0, -laneHalf(f), laneLength(f), laneHalf(f) * 2);
    ctx.restore();
  }
  rect(ctx, '#222', x - 1, y - 1, f.hw * 2 + 2, f.hh * 2 + 2);
  rect(ctx, body, x, y, f.hw * 2, f.hh * 2);
  rect(ctx, '#b9b2a6', x + 2, y + 2, f.hw * 2 - 4, 5);
  rect(ctx, '#b9b2a6', x + 2, y + f.hh * 2 - 7, f.hw * 2 - 4, 5);
  rect(ctx, wind ? '#ff2d2d' : '#ffb347', f.x - 6, f.y - 2, 12, 4);
  if (f.type === 'charger') {
    const dx = f.state === 'wind' || f.state === 'dash' ? f.dirx : -1;
    rect(ctx, '#d8d8d8', f.x + dx * (f.hw + 1) - 3, f.y - 3, 6, 6);
  } else {
    rect(ctx, '#555', x - 3, y + 6, 4, 10);
    rect(ctx, '#555', x + f.hw * 2 - 1, y + 6, 4, 10);
  }
  if (wind) {
    ring(ctx, '#ff2d2d', f.x, f.y, f.hw + 6 + (Math.floor(time * 10) % 2) * 2, 2);
    rect(ctx, '#ff2d2d', f.x - 2, y - 14, 4, 8);
    rect(ctx, '#ff2d2d', f.x - 2, y - 4, 4, 3);
  }
  if (f.state === 'dizzy')
    for (let i = 0; i < 3; i++) rect(ctx, '#ffe066', f.x - 10 + i * 8, y - 8, 4, 4);
  if (blocked) {
    // grey bracket with a slash: the foe is in range and in front, but the line of fire is blocked
    ctx.strokeStyle = '#b8bcc4';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(f.x - f.hw - 7, f.y - f.hh - 7, f.hw * 2 + 14, f.hh * 2 + 14);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(f.x - f.hw - 7, f.y + f.hh + 7);
    ctx.lineTo(f.x + f.hw + 7, f.y - f.hh - 7);
    ctx.stroke();
  }
  if (aimed) {
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(f.x - f.hw - 7, f.y - f.hh - 7, f.hw * 2 + 14, f.hh * 2 + 14);
    ctx.setLineDash([]);
  }
  for (let i = 0; i < f.maxHp; i++)
    rect(ctx, i < f.hp ? '#ff9f43' : '#444', f.x - f.maxHp * 3 + i * 6, y - 5, 5, 3);
}

function drawPlayer(ctx, p, state, time) {
  const flicker = state.player.invulnerable > 0 && Math.floor(time * 16) % 2;
  if (flicker) return;
  const x = p.x - 9,
    y = p.y - 9;
  rect(ctx, '#15181d', x - 1, y - 1, 20, 20);
  rect(ctx, '#6a7384', x, y + 6, 18, 12);
  rect(ctx, '#3b414d', x + 5, y + 10, 8, 8);
  rect(ctx, C.north, x, y, 5, 8);
  rect(ctx, C.south, x + 13, y, 5, 8);
  rect(ctx, '#e8f0ff', x, y, 5, 2);
  rect(ctx, '#e8f0ff', x + 13, y, 5, 2);
  rect(ctx, '#ffe066', x + 6, y + 8, 6, 3);
  const f = state.player.face;
  rect(ctx, '#ffffff', p.x + f.x * 13 - 2, p.y + f.y * 13 - 2, 4, 4);
}

function drawField(ctx, s, time) {
  const p = s.player;
  const mode = p.polarity;
  const color = mode === 'repel' ? C.north : C.south;
  const alpha = mode === 'idle' ? 0.25 : 0.7;
  ctx.globalAlpha = alpha;
  ring(ctx, color, p.x, p.y, s.field.radius, 1, [4, 4]);
  if (mode !== 'idle') {
    for (const f of [0.34, 0.67]) ring(ctx, color, p.x, p.y, s.field.radius * f, 1, [2, 6]);
    const pulse = mode === 'repel' ? (time * 3) % 1 : 1 - ((time * 2) % 1);
    ring(ctx, color, p.x, p.y, s.field.radius * Math.max(0.15, pulse), 2);
  }
  ctx.globalAlpha = 1;
  ring(ctx, '#667', p.x, p.y, s.field.orbitRadius, 1, [1, 5]);
}

function drawHud(ctx, s, env) {
  rect(ctx, C.hud, 0, 0, 480, PLAY_TOP);
  rect(ctx, C.hud, 0, PLAY_BOTTOM, 480, 320 - PLAY_BOTTOM);
  text(
    ctx,
    env.t(`Chamber ${s.chamber}/${s.chamberCount}`, `第${s.chamber}/${s.chamberCount}间`),
    8,
    8,
    '#fff',
    14,
  );
  text(ctx, env.t('HP', '生命'), 126, 8, '#fff', 14);
  for (let i = 0; i < s.maxHp; i++) rect(ctx, i < s.hp ? C.north : '#444', 162 + i * 14, 9, 10, 12);
  const worst = Math.min(...s.machines.map((k) => k.hp));
  text(
    ctx,
    env.t(`Weakest ${worst}/${MACHINE_HP}`, `最弱机器 ${worst}/${MACHINE_HP}`),
    226,
    8,
    worst <= 2 ? '#ff6b6b' : '#9cffb5',
    14,
  );
  const left = s.foes.length + s.reserve;
  text(ctx, env.t(`Foes ${left}`, `敌人 ${left}`), 340, 8, '#ffb347', 14);
  text(ctx, String(Math.floor(s.score)), 472, 8, '#ffe066', 14, 'right');
  const line = s.message || s.prompt;
  text(ctx, env.t(line.en, line.zh), 240, 301, s.message ? '#ffe066' : '#fff', 14, 'center');
}

export function drawWorld(ctx, w, env) {
  const s = snapshot(w);
  const time = s.time;
  drawFloor(ctx, w);
  for (const k of w.machines) drawMachine(ctx, k);
  drawField(ctx, s, time);
  for (const e of w.fx) rect(ctx, e.color, e.x - 2, e.y - 2, 4, 4);
  for (const f of w.foes)
    drawFoe(ctx, f, time, f.id === w.aim, w.blockedIds.includes(f.id) && f.id !== w.aim);
  for (const m of w.metals) drawMetal(ctx, m);
  drawPlayer(ctx, w.p, s, time);
  drawHud(ctx, s, env);
}

function drawMenu(ctx, menu, env) {
  background(ctx, C.hud);
  const name = CHAMBERS[menu.sel].name;
  text(ctx, env.t('Choose a chamber', '选择车间'), 240, 18, '#ffe066', 16, 'center');
  for (let i = 0; i < CHAMBER_COUNT; i++) {
    const c = cellBox(i),
      open = i < menu.unlocked,
      chosen = i === menu.sel;
    rect(ctx, chosen ? '#ffe066' : '#444a55', c.x, c.y, MENU.cellW, MENU.cellH);
    rect(ctx, open ? '#2e3a4a' : '#1d2026', c.x + 2, c.y + 2, MENU.cellW - 4, MENU.cellH - 4);
    const cleared = i < menu.unlocked - 1;
    const color = !open ? '#6b717c' : cleared ? '#9cffb5' : '#fff';
    text(ctx, String(i + 1), c.x + MENU.cellW / 2, c.y + 10, color, 16, 'center');
    // Shape as well as colour: a cleared chamber has a long green bar, the current one a short white bar.
    if (cleared) rect(ctx, '#9cffb5', c.x + 6, c.y + MENU.cellH - 9, MENU.cellW - 12, 3);
    else if (open) rect(ctx, '#fff', c.x + MENU.cellW / 2 - 7, c.y + MENU.cellH - 9, 14, 3);
  }
  text(
    ctx,
    env.t(`Chamber ${menu.sel + 1}: ${name.en}`, `第${menu.sel + 1}间：${name.zh}`),
    240,
    190,
    '#fff',
    16,
    'center',
  );
  text(
    ctx,
    env.t('Arrows: choose · Space or X: start', '方向键选择 · 空格或X开始'),
    240,
    222,
    '#aab2bf',
    14,
    'center',
  );
}
