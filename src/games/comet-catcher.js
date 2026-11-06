import { background, drawPixelText as text } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'comet-catcher',
  name: { en: 'Comet Catcher', zh: '彗星捕手' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Slide a catching net along the observatory roof and tilt it to meet falling comets face-on: a comet is caught only if it arrives within 30 degrees of the net axis and slower than 215 px/s relative to the net. The net holds a limited load and warns before it is full, so press X over a bin to unload. Hot comets must cool before a bin accepts them: press Space to close the net, which cools three times as fast as an open one. Each contract needs a set number of comets in the right bins. Clear all 22 contracts; progress is saved.',
    zh: '在天文台屋顶上移动并倾斜接网，让网口正对坠落的彗星：只有与网轴夹角不超过 30 度、相对速度不超过 215 像素/秒的彗星才能被接住。接网容量有限，快满时会预警，请在收集箱上方按 X 卸货。热彗星必须冷却后才会被收集箱接收：按空格合上接网，冷却速度是敞开时的三倍。每份合同要求把规定数量的彗星送进正确的收集箱。完成全部 22 份合同，进度会被保存。',
  },
  keys: [
    { label: { en: 'Slide the net', zh: '移动接网' }, keys: 'A D / Left Right' },
    { label: { en: 'Tilt the net', zh: '倾斜接网' }, keys: 'W S / Up Down' },
    { label: { en: 'Open or close the net', zh: '打开 / 合上接网' }, keys: 'Space' },
    { label: { en: 'Unload into a bin', zh: '向收集箱卸货' }, keys: 'X' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Tilt L', '左倾', 'left'],
    ['ArrowDown', 'Tilt R', '右倾', 'left'],
    ['Space', 'Open/Close', '开/合', 'right'],
    ['KeyX', 'Unload', '卸货', 'right'],
  ]),
};

// Rules are exported read-only so tests, prompts, markers and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 0.1,
  top: 44,
  bottom: 298,
  ground: 274,
  spawnY: 56,
  netY: 236,
  gravity: 60, // px/s^2, plus the contract's wind
  netSpeed: 120, // px/s while a slide key is held
  tiltRate: 80, // deg/s while a tilt key is held
  maxTilt: 60,
  netMin: 40,
  netMax: 440,
  half: 32, // half the mouth width
  cone: 30, // deg between the net axis and the comet's relative velocity
  absorb: 215, // px/s, fastest relative normal speed the net absorbs
  restitution: 0.45,
  restSpeed: 20, // a spent comet landing slower than this stops bouncing
  flatTilt: 2, // below this tilt a resting comet settles into dust instead of sliding
  rollMax: 4, // a comet that cannot slide off settles after this long
  repose: 40, // deg: an open net tilted further spills its load
  spillEvery: 0.5,
  guideTilt: 38,
  radar: 4.6,
  safeHeat: 45, // bins only accept loads at or below this
  scorchHeat: 80, // a load hotter than this burns the net
  scorchDiv: 40, // integrity lost per second = (heat - scorchHeat) / scorchDiv
  coolClosed: 30, // heat/s while the net is closed
  coolOpen: 10, // heat/s while it is open
  ambient: 20,
  integrity: 8,
  binW: 64,
  reach: 24, // net centre within this of a bin centre can unload
  radius: [8, 10, 12],
  warnAt: 0.75,
  think: 6,
  promptHold: 0.5,
  msgTime: 1.8,
  introTime: 3.6,
  freeze: 0.8,
  grace: 20,
  tries: 3,
  unitScore: 10,
  clearScore: 100,
  cleanScore: 50,
});
const R = RULES;
const STEP = R.step;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MENU_COLS = 11;
const COLOR_FILL = ['#58d8ff', '#ff5fd2', '#ffd447'];
const LIFT = 0.001; // a bounced comet sits just above the mesh plane
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// --- Contracts (authored data) ---

const bin = (x, need, accept = {}) => ({ x, need, ...accept });
const accepts = (b, c) =>
  (!b.colors || b.colors.includes(c.color)) && (!b.sizes || b.sizes.includes(c.size));
const cyc = (list, i) => list[i % list.length];

// A shower lists where each comet crosses the net line; its launch point follows from the physics.
function shower(
  { t0 = 0.6, gap = 3, xs, vx = [0], vy = [20], size = [1], color = [0], heat = [20] },
  wind,
) {
  let t = t0;
  return xs.map((tx, i) => {
    const c = {
      id: i,
      t: Math.round(t * 1000) / 1000,
      tx,
      vx: cyc(vx, i),
      vy: cyc(vy, i),
      size: cyc(size, i),
      color: cyc(color, i),
      heat: cyc(heat, i),
    };
    t += Array.isArray(gap) ? cyc(gap, i) : gap;
    const g = R.gravity;
    const dy = R.netY - R.spawnY;
    c.T = (-c.vy + Math.sqrt(c.vy * c.vy + 2 * g * dy)) / g;
    const launch = (vx) => tx - vx * c.T - 0.5 * wind * c.T * c.T;
    const inside = (x) => x >= 16 && x <= 464;
    // A slant that would launch off-screen is mirrored, so the comet still drifts toward the roof.
    if (!inside(launch(c.vx)) && inside(launch(-c.vx))) c.vx = -c.vx;
    c.x0 = launch(c.vx);
    c.vxA = c.vx + wind * c.T;
    c.vyA = c.vy + g * c.T;
    c.arrive = c.t + c.T;
    c.mass = c.size;
    return c;
  });
}

const L = (name, tip, cap, wind, bins, spec) => ({ name, tip, cap, wind, bins, spec });
const SLANT = [120, -120];
const LEVEL_DEFS = [
  L(
    ['First Light', '初见星光'],
    ['[Arrows] Catch comets, then press X at the bin', '[方向键] 接住彗星，到收集箱按 X 卸货'],
    4,
    0,
    [bin(240, 3)],
    { xs: [240, 160, 320, 210, 270], gap: 3 },
  ),
  L(
    ['Wide Sky', '广阔天空'],
    ['[Arrows] The sky is wide: follow the marker', '[方向键] 天空很宽，跟着落点标记走'],
    6,
    0,
    [bin(240, 5)],
    { xs: [90, 390, 200, 320, 140, 350, 240], gap: 3 },
  ),
  L(
    ['Lean In', '倾身相迎'],
    ['[Arrows] Tilt the net to face slanted comets', '[方向键] 倾斜网口，迎向斜飞的彗星'],
    6,
    0,
    [bin(240, 4)],
    { xs: [300, 200, 330, 150, 280, 200], vx: SLANT, gap: 3 },
  ),
  L(
    ['Crossfire', '交叉火力'],
    ['[Arrows] Lean left or right to meet each comet', '[方向键] 向左或向右倾斜，迎接每颗彗星'],
    6,
    0,
    [bin(240, 6)],
    { xs: [300, 180, 240, 330, 150, 240, 310, 170], vx: [120, -120, 0], gap: 3 },
  ),
  L(
    ['Heavy Load', '沉重负荷'],
    ['[Arrows] Big comets fill the net: unload in time', '[方向键] 大彗星很占地方，及时卸货'],
    4,
    0,
    [bin(240, 6)],
    { xs: [150, 300, 220, 330, 120, 260, 200, 340], size: [2, 1, 3, 1, 2, 2, 1, 2], gap: 3.2 },
  ),
  L(
    ['Warm Rocks', '温热岩石'],
    ['[Arrows] Hot comets: close the net to cool them', '[方向键] 彗星很烫：合上接网来降温'],
    6,
    0,
    [bin(240, 4)],
    { xs: [200, 300, 150, 320, 240, 180], heat: [90], gap: 3.6 },
  ),
  L(
    ['Blazing Trail', '烈焰尾迹'],
    ['[Arrows] Very hot: cool it before it scorches', '[方向键] 极烫：先降温，免得烧坏接网'],
    6,
    0,
    [bin(240, 4)],
    { xs: [300, 190, 240, 320, 160, 240], vx: [120, -120, 0], heat: [110], gap: 4 },
  ),
  L(
    ['Hot Haul', '烫手货运'],
    ['[Arrows] Cool the load while you carry it', '[方向键] 一边搬运一边给货物降温'],
    4,
    0,
    [bin(240, 5)],
    { xs: [150, 300, 220, 330, 180, 270, 240], size: [2, 1], heat: [80], gap: 3.6 },
  ),
  L(
    ['Two Colours', '双色分拣'],
    ['[Arrows] Each bin takes one colour: sort them', '[方向键] 每个收集箱只收一种颜色'],
    6,
    0,
    [bin(130, 3, { colors: [0] }), bin(350, 3, { colors: [1] })],
    { xs: [130, 350, 240, 110, 370, 200, 290, 160], color: [0, 1, 1, 0], gap: 3.2 },
  ),
  L(
    ['Big and Small', '大小有别'],
    ['[Arrows] Small and big comets use different bins', '[方向键] 大小不同的彗星进不同的箱'],
    6,
    0,
    [bin(130, 3, { sizes: [1] }), bin(350, 3, { sizes: [2, 3] })],
    { xs: [140, 340, 230, 120, 360, 200, 300, 170], size: [1, 2, 3, 1], gap: 3.2 },
  ),
  L(
    ['Sorted Slant', '斜飞分拣'],
    ['[Arrows] Sort by colour while you tilt', '[方向键] 边倾斜边按颜色分拣'],
    6,
    0,
    [bin(130, 3, { colors: [0] }), bin(350, 3, { colors: [1] })],
    { xs: [300, 200, 330, 150, 290, 200, 320, 160], color: [0, 1, 1, 0], vx: SLANT, gap: 3.2 },
  ),
  L(
    ['Gentle Breeze', '微风拂过'],
    ['[Arrows] Wind bends comets: follow the marker', '[方向键] 风会让彗星拐弯，跟着标记走'],
    6,
    40,
    [bin(240, 5)],
    { xs: [200, 300, 150, 330, 240, 120, 360], vx: [30, 40, 0], gap: 3.2 },
  ),
  L(
    ['Crosswind', '横风'],
    ['[Arrows] The wind has turned: trust the marker', '[方向键] 风向变了，相信落点标记'],
    6,
    -45,
    [bin(240, 5)],
    { xs: [320, 200, 260, 140, 340, 220, 180, 300], vx: [-35, -25, -35, -25], gap: 3.2 },
  ),
  L(
    ['Hot Colours', '热色分拣'],
    ['[Arrows] Hot and coloured: cool, then sort', '[方向键] 又烫又有色：先降温再分拣'],
    6,
    0,
    [bin(130, 3, { colors: [0] }), bin(350, 3, { colors: [1] })],
    {
      xs: [130, 350, 230, 110, 370, 210, 290, 170],
      color: [0, 1, 1, 0],
      vx: [0, 100, -100],
      heat: [80, 20],
      gap: 4,
    },
  ),
  L(
    ['Mixed Shower', '混合流星雨'],
    ['[Arrows] Three colours and sizes: stay calm', '[方向键] 三种颜色和大小，保持冷静'],
    5,
    0,
    [bin(100, 2, { colors: [0] }), bin(240, 2, { colors: [1] }), bin(380, 2, { colors: [2] })],
    {
      xs: [110, 370, 260, 130, 350, 220, 100, 380, 220],
      color: [0, 2, 1],
      size: [1, 2],
      vx: [0, 110, -110],
      heat: [20, 80, 20],
      gap: 3.4,
    },
  ),
  L(
    ['Heavy Rain', '倾盆流星'],
    ['[Arrows] A dense shower: unload when it fills', '[方向键] 流星密集：快满就卸货'],
    6,
    0,
    [bin(240, 8)],
    {
      xs: [140, 330, 200, 280, 120, 360, 220, 300, 160, 340, 290],
      size: [1, 2],
      vx: [0, 120, -120],
      gap: 2.4,
    },
  ),
  L(
    ['Storm Front', '风暴锋面'],
    ['[Arrows] Storm and fire: cool before you sort', '[方向键] 风暴加火焰：先降温再分拣'],
    6,
    40,
    [bin(130, 3, { colors: [0] }), bin(350, 3, { colors: [1] })],
    {
      xs: [180, 330, 260, 140, 350, 220, 300, 160, 340],
      color: [0, 1, 1, 0],
      vx: [30, 40, 20, 0],
      heat: [20, 80],
      gap: 4,
    },
  ),
  L(
    ['Sorting Office', '分拣中心'],
    ['[Arrows] Three bins, three colours, angled comets', '[方向键] 三个箱子三种颜色，彗星斜飞'],
    5,
    0,
    [bin(100, 3, { colors: [0] }), bin(240, 3, { colors: [1] }), bin(380, 3, { colors: [2] })],
    {
      xs: [300, 180, 250, 330, 160, 240, 310, 170, 260, 320, 150, 230],
      color: [0, 1, 2],
      vx: [120, -120, 0],
      gap: 3.2,
    },
  ),
  L(
    ['Furnace Night', '熔炉之夜'],
    ['[Arrows] Heavy and hot: carry it closed', '[方向键] 又重又烫：合上接网搬运'],
    5,
    -30,
    [bin(160, 3, { sizes: [1, 2] }), bin(320, 2, { sizes: [3] })],
    {
      xs: [250, 170, 300, 200, 330, 230, 180, 310],
      size: [3, 1, 2, 3, 1, 2],
      vx: [-50, -60, -40],
      heat: [100, 70],
      gap: 4.2,
    },
  ),
  L(
    ['Long Exposure', '长时间曝光'],
    ['[Arrows] Wind, fire and colour together', '[方向键] 风、火与颜色同时出现'],
    6,
    35,
    [bin(100, 3, { colors: [0] }), bin(240, 3, { colors: [1] }), bin(380, 3, { colors: [2] })],
    {
      xs: [250, 330, 190, 300, 140, 360, 220, 280, 170, 340, 210, 310],
      color: [0, 1, 2],
      vx: [40, 30, 10],
      heat: [20, 85],
      gap: 3.8,
    },
  ),
  L(
    ['Meteor Rush', '流星疾冲'],
    ['[Arrows] Fast and dense: keep sliding', '[方向键] 又快又密：不停地移动'],
    6,
    30,
    [bin(160, 5, { sizes: [1] }), bin(320, 4, { sizes: [2, 3] })],
    {
      xs: [120, 320, 220, 360, 160, 300, 200, 340, 140, 280, 240, 380],
      size: [1, 2, 1, 3],
      vx: [70, -70, 70, -70],
      vy: [20, 50],
      gap: 3,
    },
  ),
  L(
    ['Grand Observatory', '大天文台'],
    ['[Arrows] The grand contract: use everything', '[方向键] 终极合同：运用你学到的一切'],
    8,
    -35,
    [bin(100, 4, { colors: [0] }), bin(240, 4, { colors: [1] }), bin(380, 4, { colors: [2] })],
    {
      xs: [270, 190, 330, 150, 300, 220, 340, 170, 290, 210, 320, 160, 280, 200, 350, 180],
      color: [0, 1, 2],
      size: [1, 2, 1],
      vx: [-40, -30, -10],
      heat: [20, 85, 20, 20],
      gap: 3.6,
    },
  ),
];

function buildLevel(def) {
  const spec = { ...def.spec };
  const sched = shower(spec, def.wind);
  for (const c of sched) {
    const owners = def.bins.map((b, i) => (accepts(b, c) ? i : -1)).filter((i) => i >= 0);
    c.bin = owners.length === 1 ? owners[0] : -1;
  }
  return Object.freeze({
    name: def.name,
    tip: def.tip,
    cap: def.cap,
    wind: def.wind,
    bins: Object.freeze(def.bins.map((b) => Object.freeze(b))),
    sched: Object.freeze(sched.map((c) => Object.freeze(c))),
  });
}
export const LEVELS = LEVEL_DEFS.map(buildLevel);
export const LEVEL_COUNT = LEVELS.length;

// --- Pure physics ---

const poseOf = (x, tilt) => {
  const a = tilt * RAD;
  return { cx: x, tx: Math.cos(a), ty: Math.sin(a), nx: Math.sin(a), ny: -Math.cos(a) };
};
const localOf = (p, pose) => {
  const dx = p.x - pose.cx;
  const dy = p.y - R.netY;
  return { u: dx * pose.tx + dy * pose.ty, d: dx * pose.nx + dy * pose.ny };
};

// Swept test of a comet's centre against the net mouth: it crosses from the open side (d > 0) to
// the closed side (d <= 0) of the mouth plane inside the mouth width. Valid for any step length.
export function mouthCrossing(p0, p1, net0, net1) {
  const a = localOf(p0, poseOf(net0.x, net0.tilt));
  const b = localOf(p1, poseOf(net1.x, net1.tilt));
  if (!(a.d > 0 && b.d <= 0)) return null;
  const f = a.d / (a.d - b.d);
  const u = a.u + f * (b.u - a.u);
  return Math.abs(u) <= R.half ? { f, u } : null;
}

// The stated catch rule, from the comet velocity relative to the net.
export function judgeCatch(relVx, relVy, tilt) {
  const n = poseOf(0, tilt);
  const approach = -(relVx * n.nx + relVy * n.ny);
  const speed = Math.hypot(relVx, relVy);
  const angle = approach > 0 ? Math.acos(clamp(approach / speed, -1, 1)) * DEG : 180;
  if (angle > R.cone) return { ok: false, reason: 'angle', angle, approach };
  if (approach > R.absorb) return { ok: false, reason: 'fast', angle, approach };
  return { ok: true, reason: 'ok', angle, approach };
}

// Closed-form landing prediction for the marker; the simulation integrates the same motion exactly.
export function predictCrossing(c, wind) {
  const dy = R.netY - c.y;
  if (dy <= 0 || c.vy < 0) return null;
  const g = R.gravity;
  const t = (-c.vy + Math.sqrt(c.vy * c.vy + 2 * g * dy)) / g;
  return { t, x: c.x + c.vx * t + 0.5 * wind * t * t, vx: c.vx + wind * t, vy: c.vy + g * t };
}

export const guideTiltFor = (vx, vy) =>
  clamp(Math.asin(clamp(-vx / Math.hypot(vx, vy), -1, 1)) * DEG, -R.guideTilt, R.guideTilt);

// --- State ---

const radiusOf = (c) => R.radius[c.size - 1];
const loadOf = (net) => net.items.reduce((n, i) => n + i.mass, 0);
const hottestOf = (net) => net.items.reduce((h, i) => Math.max(h, i.heat), 0);

function loadLevel(s, index) {
  const lv = LEVELS[index];
  s.level = index;
  s.net = {
    x: 240,
    vx: 0,
    tilt: 0,
    open: true,
    items: [],
    integrity: R.integrity,
    wobble: 0,
    spillT: 0,
  };
  s.comets = [];
  s.next = 0;
  s.clock = 0;
  s.tail = 0;
  s.delivered = lv.bins.map(() => 0);
  s.gained = 0;
  s.lost = 0;
  s.trip = false;
  s.freeze = 0;
  s.menu = null;
  s.msg = null;
  s.line = null;
  s.splashes = [];
  s.plan = null;
  say(s, lv.tip[0], lv.tip[1], R.introTime);
  think(s);
  updateLine(s);
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    acc: 0,
    ticks: 0,
    tries: R.tries,
    progress: env.progress || null,
    best: Array(LEVEL_COUNT).fill(0),
    stats: { caught: 0, delivered: 0, lost: 0, bounced: 0, spilled: 0, unloads: 0, fails: 0 },
  };
  const raw = Number(s.progress?.unlocked?.());
  const unlocked = Number.isFinite(raw) ? clamp(Math.floor(raw), 1, LEVEL_COUNT) : 1;
  loadLevel(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    updateLine(s);
  }
  return s;
}

const say = (s, en, zh, time = R.msgTime) => {
  s.msg = { en, zh, time };
};

// --- Advice: the prompt, the marker and the single next thing to do ---

const PROMPTS = {
  catch: ['[Arrows] Slide under the marker, tilt to match', '[方向键] 移到标记下方，倾斜到位'],
  idle: ['[Arrows] Watch the sky for the next comet', '[方向键] 留意天空中的下一颗彗星'],
  near: ['[Arrows] Net nearly full: take only what fits', '[方向键] 接网快满了：只接装得下的'],
  open: ['[Space] Open the net to catch again', '[空格] 打开接网，继续接彗星'],
  close: ['[Space] Close the net to cool the load', '[空格] 合上接网，给货物降温'],
  coolgo: ['[Arrows] Cooling: get under the next marker', '[方向键] 降温中：先去下一个标记'],
  bin: ['[Arrows] Carry the load over its bin', '[方向键] 把货物运到对应的收集箱上'],
  binfull: ['[Arrows] Net nearly full: carry it to its bin', '[方向键] 接网快满了：运到收集箱'],
  cool: ['Stand still: cooling, then press X', '站着别动：降温后按 X'],
  unload: ['[X] Unload into this bin', '[X] 向这个收集箱卸货'],
  level: ['[Arrows] Level the net before it spills', '[方向键] 摆正接网，免得货物洒出'],
  menu: ['[Arrows] Pick a contract, then press Space', '[方向键] 选择合同，然后按空格'],
};

function wantedList(s) {
  const lv = LEVELS[s.level];
  const net = s.net;
  const need = lv.bins.map((b, i) => b.need - s.delivered[i]);
  for (const it of net.items) {
    const b = lv.bins.findIndex((bin2) => accepts(bin2, it));
    need[b]--;
  }
  const entries = [];
  for (const c of s.comets) {
    if (c.fate !== 'air' || c.spent || c.y >= R.netY - 4) continue;
    const p = predictCrossing(c, lv.wind);
    if (p)
      entries.push({
        at: s.clock + p.t,
        c,
        p,
        mass: c.size,
        bin: lv.bins.findIndex((b) => accepts(b, c)),
      });
  }
  for (let i = s.next; i < lv.sched.length; i++) {
    const c = lv.sched[i];
    entries.push({
      at: c.arrive,
      c: null,
      p: { t: c.arrive - s.clock, x: c.tx, vx: c.vxA, vy: c.vyA },
      mass: c.mass,
      bin: c.bin,
    });
  }
  entries.sort((a, b) => a.at - b.at);
  return entries.filter((e) => need[e.bin]-- > 0);
}

function think(s) {
  if (s.menu) return;
  const lv = LEVELS[s.level];
  const net = s.net;
  const items = net.items;
  const load = loadOf(net);
  const hot = hottestOf(net);
  const wanted = wantedList(s);
  const first = wanted[0];
  const nextIn = first ? first.at - s.clock : Infinity;
  // The roof radar marks a coming comet's landing spot a little before it appears.
  const seen = wanted.filter((w) => w.c || w.at - s.clock <= R.radar);
  const fitting = seen.find((w) => w.mass <= lv.cap - load);
  const blocked = seen.length > 0 && !fitting;
  const full = load >= lv.cap;
  const near = load >= R.warnAt * lv.cap;
  const coolT = Math.max(0, hot - R.scorchHeat) / R.coolClosed;
  const holdBin = (b) => lv.bins[b];
  const binsFor = items
    .map((i) => lv.bins.findIndex((b) => accepts(b, i)))
    .filter((b, i, a) => a.indexOf(b) === i);
  let target = null;
  if (binsFor.length) {
    const dist = (b) => Math.abs(holdBin(b).x - net.x);
    const cool = (b) => (items.some((i) => accepts(holdBin(b), i) && i.heat <= R.safeHeat) ? 0 : 1);
    target = binsFor.slice().sort((a, b) => cool(a) - cool(b) || dist(a) - dist(b) || a - b)[0];
  }
  if (!items.length) s.trip = false;
  else if (!s.trip && target !== null) {
    const trip = (2 * Math.abs(holdBin(target).x - net.x)) / R.netSpeed + 3 + hot / R.coolClosed;
    s.trip = !first || blocked || full || nextIn >= trip;
  }
  let id = 'idle';
  let guide = null;
  const aim = fitting
    ? { x: fitting.p.x, tilt: guideTiltFor(fitting.p.vx, fitting.p.vy), early: !fitting.c }
    : null;
  if (items.length && net.open && Math.abs(net.tilt) > R.repose - 0.5) {
    id = 'level';
    guide = { kind: 'level', x: net.x, tilt: 0 };
  } else if (s.trip && target !== null) {
    const b = holdBin(target);
    const accItems = items.filter((i) => accepts(b, i));
    const hotHere = accItems.some((i) => i.heat > R.safeHeat);
    if (net.open && (hotHere || hot > R.scorchHeat)) {
      id = 'close';
      guide = { kind: 'close', x: b.x, tilt: 0, bin: true };
    } else if (Math.abs(net.x - b.x) > R.reach - 4) {
      id = near || full ? 'binfull' : 'bin';
      guide = { kind: 'bin', x: b.x, tilt: 0, bin: true };
    } else if (hotHere) {
      id = 'cool';
      guide = { kind: 'cool', x: net.x, tilt: net.tilt };
    } else {
      id = 'unload';
      guide = { kind: 'unload', x: b.x, tilt: 0, bin: true };
    }
  } else if (net.open && hot > R.scorchHeat && nextIn >= coolT + 2.6) {
    id = 'close';
    guide = { kind: 'close', ...(aim || { x: net.x, tilt: 0 }) };
  } else if (!net.open) {
    const staying = hot > R.scorchHeat && nextIn > 3.2;
    id = staying ? 'coolgo' : 'open';
    guide = { kind: id, ...(aim || { x: net.x, tilt: 0 }) };
  } else if (aim) {
    id = near ? 'near' : 'catch';
    guide = { kind: 'catch', ...aim, mass: fitting.mass };
  } else {
    guide = { kind: 'idle', x: net.x, tilt: 0 };
  }
  s.plan = { id, guide, load, near, full, hot };
}

function lineCandidate(s) {
  if (s.menu) return PROMPTS.menu;
  if (s.msg) return [s.msg.en, s.msg.zh];
  return PROMPTS[s.plan.id];
}
function updateLine(s) {
  const next = lineCandidate(s);
  if (s.line && next[0] === s.line.en) return;
  if (s.line && s.line.age < R.promptHold) return;
  s.line = { en: next[0], zh: next[1], age: 0 };
}

// --- Simulation ---

function spawn(s, c) {
  s.comets.push({
    id: c.id,
    x: c.x0,
    y: R.spawnY,
    vx: c.vx,
    vy: c.vy,
    size: c.size,
    mass: c.mass,
    color: c.color,
    heat: c.heat,
    fate: 'air',
    spent: false,
    spilled: false,
    age: 0,
  });
}

function resolveLoss(s, c) {
  c.fate = 'lost';
  s.lost++;
  s.stats.lost++;
  s.splashes.push({ x: c.x, age: 0, hot: c.heat > R.safeHeat });
}

function catchComet(s, c, emit) {
  const net = s.net;
  c.fate = 'net';
  net.items.push({ id: c.id, size: c.size, mass: c.mass, color: c.color, heat: c.heat });
  net.wobble = 1;
  s.stats.caught++;
  emit('move');
}

function reflectOffNet(c, cross, relVx, relVy, net) {
  const n = poseOf(net.x, net.tilt);
  const dot = relVx * n.nx + relVy * n.ny;
  const rvx = relVx - (1 + R.restitution) * dot * n.nx;
  const rvy = relVy - (1 + R.restitution) * dot * n.ny;
  c.x = n.cx + cross.u * n.tx + LIFT * n.nx;
  c.y = R.netY + cross.u * n.ty + LIFT * n.ny;
  c.vx = rvx + net.vx;
  c.vy = rvy;
  net.wobble = 0.6;
  return -dot;
}

const REFUSALS = {
  angle: ['[Arrows] Missed: tilt the net to face the comet', '[方向键] 没接住：倾斜网口正对彗星'],
  fast: ['[Arrows] Too fast: let the net move with it', '[方向键] 太快了：让接网顺势移动'],
  full: ['[X] The net is full: unload before catching', '[X] 接网已满：先卸货再接'],
  closed: ['[Space] The net is closed: open it to catch', '[空格] 接网合着：打开才能接'],
};

// A refused comet bounces off the mesh and is spent: it can never be caught or scored.
function bounce(s, c, cross, relVx, relVy, net, reason, emit) {
  reflectOffNet(c, cross, relVx, relVy, net);
  c.spent = true;
  s.stats.bounced++;
  emit('hit');
  say(s, ...REFUSALS[reason]);
}

// A spent comet that falls back onto the net bounces again, losing energy each time. Once it lands
// slowly it either settles into dust on a level net or slides along the mesh under gravity, so it
// never passes through the net and never gains energy.
function rebound(c, cross, relVx, relVy, net, emit) {
  const n = poseOf(net.x, net.tilt);
  if (-(relVx * n.nx + relVy * n.ny) >= R.restSpeed) {
    if (reflectOffNet(c, cross, relVx, relVy, net) > 40) emit('hit');
    return true;
  }
  if (Math.abs(net.tilt) < R.flatTilt) return false;
  c.rolling = { u: cross.u, vt: relVx * n.tx + relVy * n.ty, age: 0 };
  c.vx = net.vx + c.rolling.vt * n.tx;
  c.vy = c.rolling.vt * n.ty;
  c.x = n.cx + cross.u * n.tx + LIFT * n.nx;
  c.y = R.netY + cross.u * n.ty + LIFT * n.ny;
  return true;
}

// One step of a comet sliding on the mesh: gravity along the slope, the surface carries it
// continuously, and it leaves over the rim with the velocity it has there.
function rollStep(c, net) {
  const r = c.rolling;
  const n = poseOf(net.x, net.tilt);
  r.vt += R.gravity * n.ty * STEP;
  r.u += r.vt * STEP;
  r.age += STEP;
  c.x = n.cx + r.u * n.tx + LIFT * n.nx;
  c.y = R.netY + r.u * n.ty + LIFT * n.ny;
  c.vx = net.vx + r.vt * n.tx;
  c.vy = r.vt * n.ty;
  if (Math.abs(r.u) > R.half + radiusOf(c)) c.rolling = null;
  return c.rolling === null || r.age <= R.rollMax;
}

function stepComets(s, prevNet, emit) {
  const lv = LEVELS[s.level];
  const net = s.net;
  const live = [];
  for (const c of s.comets) {
    if (c.rolling) {
      if (rollStep(c, net)) live.push(c);
      else resolveLoss(s, c);
      continue;
    }
    const p0 = { x: c.x, y: c.y };
    c.x += c.vx * STEP + 0.5 * lv.wind * STEP * STEP;
    c.y += c.vy * STEP + 0.5 * R.gravity * STEP * STEP;
    c.vx += lv.wind * STEP;
    c.vy += R.gravity * STEP;
    c.age += STEP;
    const cross = c.fate === 'air' ? mouthCrossing(p0, c, prevNet, net) : null;
    // Velocity relative to the net at the instant of contact, not at the end of the step.
    const back = cross ? (1 - cross.f) * STEP : 0;
    const rvx = c.vx - lv.wind * back - net.vx;
    const rvy = c.vy - R.gravity * back;
    if (cross && c.spent) {
      if (!rebound(c, cross, rvx, rvy, net, emit)) {
        resolveLoss(s, c);
        continue;
      }
      if (c.rolling) {
        live.push(c);
        continue;
      }
    } else if (cross) {
      const verdict = judgeCatch(rvx, rvy, net.tilt);
      let reason = verdict.reason;
      if (verdict.ok) {
        if (!net.open) reason = 'closed';
        else if (loadOf(net) + c.mass > lv.cap) reason = 'full';
      }
      if (reason === 'ok') {
        catchComet(s, c, emit);
        continue;
      }
      bounce(s, c, cross, rvx, rvy, net, reason, emit);
    }
    if (c.y >= R.ground || c.x < -40 || c.x > 520) {
      resolveLoss(s, c);
      continue;
    }
    live.push(c);
  }
  s.comets = live;
}

function stepNet(s, emit) {
  const net = s.net;
  const rate = net.open ? R.coolOpen : R.coolClosed;
  for (const it of net.items) it.heat = Math.max(R.ambient, it.heat - rate * STEP);
  const hot = hottestOf(net);
  if (hot > R.scorchHeat) net.integrity -= ((hot - R.scorchHeat) / R.scorchDiv) * STEP;
  net.wobble = Math.max(0, net.wobble - STEP * 2);
  if (net.open && net.items.length && Math.abs(net.tilt) > R.repose) {
    net.spillT += STEP;
    if (net.spillT >= R.spillEvery) {
      net.spillT = 0;
      const it = net.items.shift();
      const side = Math.sign(net.tilt);
      s.comets.push({
        id: it.id,
        x: net.x + side * R.half,
        y: R.netY - 4,
        vx: net.vx + side * 40,
        vy: 0,
        size: it.size,
        mass: it.mass,
        color: it.color,
        heat: it.heat,
        fate: 'air',
        spent: false,
        spilled: true,
        age: 0,
      });
      s.stats.spilled++;
      say(s, '[Arrows] The net tipped too far and spilled', '[方向键] 接网倾斜过头，货物洒了');
      emit('hit');
    }
  } else net.spillT = 0;
}

function failContract(s, why, emit) {
  s.stats.fails++;
  s.tries--;
  if (s.tries <= 0) {
    s.phase = 'lost';
    return;
  }
  emit('lose');
  const level = s.level;
  loadLevel(s, level);
  const word = {
    burnt: ['Net burnt out', '接网烧毁了'],
    impossible: ['Too many lost', '丢失太多'],
    timeout: ['Out of time', '时间耗尽'],
  }[why];
  say(
    s,
    `[Arrows] ${word[0]}: ${s.tries === 1 ? '1 try' : `${s.tries} tries`} left`,
    `[方向键] ${word[1]}：还剩 ${s.tries} 次`,
    R.introTime,
  );
  updateLine(s);
}

function feasible(s) {
  const lv = LEVELS[s.level];
  const have = s.delivered.slice();
  for (const it of s.net.items) have[lv.bins.findIndex((b) => accepts(b, it))]++;
  for (const c of s.comets)
    if (c.fate === 'air' && !c.spent && c.y < R.netY + 30)
      have[lv.bins.findIndex((b) => accepts(b, c))]++;
  for (let i = s.next; i < lv.sched.length; i++) have[lv.sched[i].bin]++;
  return lv.bins.every((b, i) => have[i] >= b.need);
}

function clearLevel(s, emit) {
  const bonus = R.clearScore + (s.lost === 0 ? R.cleanScore : 0);
  s.best[s.level] = Math.max(s.best[s.level], s.gained + bonus);
  s.score = s.best.reduce((a, b) => a + b, 0);
  s.progress?.unlock?.(Math.min(LEVEL_COUNT, s.level + 2));
  s.tries = R.tries;
  emit('coin');
  if (s.level === LEVEL_COUNT - 1) {
    s.phase = 'won';
    return;
  }
  loadLevel(s, s.level + 1);
  s.freeze = R.freeze;
  const intro = s.msg;
  say(s, '[Arrows] Contract fulfilled!', '[方向键] 合同完成！', R.freeze);
  s.msg.next = intro;
  updateLine(s);
}

function unload(s, emit) {
  const lv = LEVELS[s.level];
  const net = s.net;
  const b = lv.bins.findIndex((bn) => Math.abs(bn.x - net.x) <= R.reach);
  if (b < 0) return say(s, '[Arrows] Move over a bin first', '[方向键] 先移到收集箱上方');
  const mine = net.items.filter((i) => accepts(lv.bins[b], i));
  if (!mine.length)
    return say(s, '[Arrows] This bin takes other comets', '[方向键] 这个箱子收的是别的彗星');
  const ready = mine.filter((i) => i.heat <= R.safeHeat);
  if (!ready.length)
    return say(
      s,
      '[Space] Too hot to unload: close the net, wait',
      '[空格] 太烫了：合上接网等一等',
    );
  for (const it of ready) {
    s.delivered[b]++;
    s.gained += it.mass * R.unitScore;
    s.stats.delivered++;
  }
  net.items = net.items.filter((i) => !ready.includes(i));
  s.stats.unloads++;
  s.trip = false;
  emit('coin');
  say(s, `[Arrows] Delivered ${ready.length}`, `[方向键] 已送达 ${ready.length} 颗`, 1.2);
  if (lv.bins.every((bn, i) => s.delivered[i] >= bn.need)) clearLevel(s, emit);
}

function act(s, input, emit) {
  if (input.pressed('Space')) {
    s.net.open = !s.net.open;
    emit('move');
  }
  if (input.pressed('KeyX')) unload(s, emit);
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
  if (input.pressed('Space', 'Enter', 'KeyX')) {
    loadLevel(s, sel - 1);
    emit('move');
  }
}

function tick(s, keys, emit) {
  const lv = LEVELS[s.level];
  const net = s.net;
  if (s.freeze > 0) {
    s.freeze = Math.max(0, s.freeze - STEP);
    keys = { dx: 0, dt: 0 };
  }
  const prevNet = { x: net.x, tilt: net.tilt };
  net.x = clamp(net.x + keys.dx * R.netSpeed * STEP, R.netMin, R.netMax);
  net.vx = (net.x - prevNet.x) / STEP;
  net.tilt = clamp(net.tilt + keys.dt * R.tiltRate * STEP, -R.maxTilt, R.maxTilt);
  s.clock += STEP;
  stepComets(s, prevNet, emit);
  stepNet(s, emit);
  while (s.next < lv.sched.length && lv.sched[s.next].t <= s.clock + 1e-9)
    spawn(s, lv.sched[s.next++]);
  s.splashes = s.splashes.filter((p) => (p.age += STEP) < 0.5);
  s.ticks++;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = s.msg.next || null;
  if (s.line) s.line.age += STEP;
  const airborne = s.comets.some((c) => c.fate === 'air' && !c.spent && c.y < R.netY + 30);
  s.tail = s.next >= lv.sched.length && !airborne ? s.tail + STEP : 0;
  if (net.integrity <= 0) return failContract(s, 'burnt', emit);
  if (s.ticks % R.think === 0) {
    think(s);
    if (!feasible(s)) return failContract(s, 'impossible', emit);
  }
  if (s.tail > R.grace) return failContract(s, 'timeout', emit);
  updateLine(s);
}

const keysOf = (input) => ({
  dx: (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0),
  dt: (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0),
});

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > R.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    return true;
  }
  if (s.freeze <= 0) act(s, input, emit);
  const keys = keysOf(input);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, keys, emit);
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
            ? env.t(
                'Every contract is fulfilled. The sky is safe!',
                '所有合同都已完成，天空安然无恙！',
              )
            : env.t(
                'The observatory ran out of attempts. Try again!',
                '天文台的尝试次数用完了，再试一次！',
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

const cometView = (c, wind) => {
  const land = c.fate === 'air' && !c.spent ? predictCrossing(c, wind) : null;
  return {
    id: c.id,
    x: c.x,
    y: c.y,
    vx: c.vx,
    vy: c.vy,
    r: R.radius[c.size - 1],
    size: c.size,
    mass: c.mass,
    color: c.color,
    heat: c.heat,
    spent: c.spent,
    spilled: c.spilled,
    land: land ? { x: land.x, t: land.t } : null,
  };
};

export function snapshotOf(s) {
  const lv = LEVELS[s.level];
  const net = s.net;
  const finished = s.phase !== 'playing';
  const load = loadOf(net);
  const prompt = s.menu ? PROMPTS.menu : s.plan.id && PROMPTS[s.plan.id];
  const line = s.line || { en: prompt[0], zh: prompt[1] };
  const label = (lang) =>
    `${lang === 'en' ? 'Contract' : '合同'} ${s.level + 1}/${LEVEL_COUNT} ${lv.name[lang === 'en' ? 0 : 1]} · ${line[lang]}`;
  const warn = load >= lv.cap ? 2 : load >= R.warnAt * lv.cap ? 1 : 0;
  return {
    phase: s.phase,
    score: s.score + (s.phase === 'won' ? 0 : Math.max(0, s.gained - s.best[s.level])),
    time: s.ticks * STEP,
    level: s.level + 1,
    levels: LEVEL_COUNT,
    levelName: { en: lv.name[0], zh: lv.name[1] },
    tries: s.tries,
    wind: lv.wind,
    net: {
      x: net.x,
      y: R.netY,
      vx: net.vx,
      tilt: net.tilt,
      open: net.open,
      load,
      cap: lv.cap,
      warn,
      items: net.items.map((i) => ({ ...i })),
      hottest: hottestOf(net),
      integrity: net.integrity,
      spilling: net.spillT > 0,
    },
    comets: s.comets.map((c) => cometView(c, lv.wind)),
    bins: lv.bins.map((b, i) => ({
      id: i,
      x: b.x,
      w: R.binW,
      colors: b.colors ? [...b.colors] : null,
      sizes: b.sizes ? [...b.sizes] : null,
      need: b.need,
      delivered: s.delivered[i],
    })),
    pending: lv.sched.length - s.next,
    timeLeft: s.tail > 0 ? Math.max(0, R.grace - s.tail) : null,
    guide: !finished && !s.menu && s.plan ? { ...s.plan.guide } : null,
    prompt: { en: prompt[0], zh: prompt[1] },
    line: { en: line.en, zh: line.zh },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    menu: s.menu ? { ...s.menu } : null,
    stats: { ...s.stats, lost: s.lost },
    hud: { top: [0, R.top], bottom: [R.bottom, 320] },
    status: finished
      ? s.phase === 'won'
        ? { en: `All contracts fulfilled! Score ${s.score}`, zh: `全部合同完成！得分 ${s.score}` }
        : { en: `Contract failed. Score ${s.score}`, zh: `合同失败。得分 ${s.score}` }
      : { en: label('en'), zh: label('zh') },
  };
}

// --- Drawing ---

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const heatColor = (h) => (h > R.scorchHeat ? '#ff4b2b' : h > R.safeHeat ? '#ff9a3c' : '#d8f4ff');

function drawSky(ctx, s) {
  background(ctx, '#070b1f');
  for (let i = 0; i < 46; i++) {
    const x = (i * 97 + 31) % 480;
    const y = R.top + ((i * 53 + 11) % 200);
    box(ctx, i % 5 === 0 ? '#ffffff' : '#6d7fb8', x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  box(ctx, '#0d1633', 0, 150, 480, 124);
  box(ctx, '#111d44', 0, 200, 480, 74);
  const wind = LEVELS[s.level].wind;
  for (let i = 0; i < 4 && wind; i++) {
    const x =
      (((((s.ticks * Math.sign(wind) * Math.abs(wind)) / 120 + i * 130) % 520) + 520) % 520) - 20;
    box(ctx, '#2b3a72', x, 90 + i * 34, 18, 2);
  }
}

function drawRoof(ctx, s) {
  box(ctx, '#2a2233', 0, R.ground, 480, R.bottom - R.ground);
  box(ctx, '#473a55', 0, R.ground, 480, 4);
  for (let x = 0; x < 480; x += 24) box(ctx, '#1d1726', x, R.ground + 10, 22, 2);
  // Telescope dome and tube on the roof, behind the bins.
  box(ctx, '#3a3f66', 400, 246, 56, 28);
  box(ctx, '#565e94', 404, 238, 48, 8);
  box(ctx, '#7a86c8', 410, 222, 36, 16);
  box(ctx, '#232845', 424, 226, 10, 6);
  box(ctx, '#7a86c8', 448, 212, 22, 8);
  // Wind pennant.
  const wind = LEVELS[s.level].wind;
  box(ctx, '#bfc6e8', 22, 232, 2, 42);
  const len = Math.round(Math.abs(wind) / 4) + 4;
  box(ctx, '#ff9a3c', wind < 0 ? 24 - len : 24, 234, len, 6);
}

function drawBins(ctx, s) {
  const lv = LEVELS[s.level];
  lv.bins.forEach((b, i) => {
    const x = b.x - R.binW / 2;
    box(ctx, '#171322', x - 2, 258, R.binW + 4, 40);
    box(ctx, '#5b4b73', x, 262, R.binW, 36);
    box(ctx, '#2c2438', x + 4, 266, R.binW - 8, 28);
    const sel = Math.abs(s.net.x - b.x) <= R.reach;
    if (sel) box(ctx, '#ffe066', x, 258, R.binW, 3);
    (b.colors || []).forEach((c, k) => drawGlyph(ctx, c, x + 8 + k * 14, 266, COLOR_FILL[c]));
    (b.sizes || []).forEach((z, k) =>
      box(ctx, '#d8dcff', x + 8 + k * 10, 274 - (4 + z * 2), 4 + z * 2, 4 + z * 2),
    );
    const plain = !b.colors && !b.sizes;
    text(
      ctx,
      `${s.delivered[i]}/${b.need}`,
      plain ? b.x : b.x + 28,
      279,
      s.delivered[i] >= b.need ? '#7dff9c' : '#ffffff',
      14,
      plain ? 'center' : 'right',
    );
  });
}

function drawGlyph(ctx, color, x, y, fill) {
  if (color === 0) box(ctx, fill, x + 2, y + 2, 6, 6);
  else if (color === 1) {
    box(ctx, fill, x + 4, y, 2, 3);
    box(ctx, fill, x + 2, y + 3, 6, 3);
    box(ctx, fill, x, y + 6, 10, 3);
  } else {
    box(ctx, fill, x + 4, y, 2, 10);
    box(ctx, fill, x, y + 4, 10, 2);
    box(ctx, fill, x + 2, y + 2, 6, 6);
  }
}

function drawComet(ctx, c) {
  const speed = Math.hypot(c.vx, c.vy) || 1;
  const r = radiusOf(c);
  const hotFill = heatColor(c.heat);
  for (let k = 1; k <= 8; k++) {
    const d = k * 5;
    const w = Math.max(2, r * 2 - k * 2);
    box(
      ctx,
      k < 4 ? hotFill : '#4a5fb8',
      c.x - (c.vx / speed) * d - w / 2,
      c.y - (c.vy / speed) * d - w / 2,
      w,
      w,
    );
  }
  if (c.spent) ctx.globalAlpha = 0.5;
  box(ctx, '#0a0f24', c.x - r - 2, c.y - r - 2, r * 2 + 4, r * 2 + 4);
  box(ctx, COLOR_FILL[c.color], c.x - r, c.y - r, r * 2, r * 2);
  box(ctx, '#16204a', c.x - r + 3, c.y - r + 3, r * 2 - 6, r * 2 - 6);
  drawGlyph(ctx, c.color, c.x - 5, c.y - 5, COLOR_FILL[c.color]);
  if (c.heat > R.safeHeat) {
    box(ctx, hotFill, c.x - r, c.y - r, r * 2, 2);
    box(ctx, hotFill, c.x - r, c.y + r - 2, r * 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawGuide(ctx, s) {
  const g = s.plan?.guide;
  if (!g || g.x === undefined) return;
  if (g.bin) {
    // An arrow over the bin the load belongs in.
    box(ctx, '#7dff9c', g.x - 8, 242, 16, 3);
    box(ctx, '#7dff9c', g.x - 5, 245, 10, 3);
    box(ctx, '#7dff9c', g.x - 2, 248, 4, 3);
    return;
  }
  if (!['catch', 'close', 'coolgo', 'open'].includes(g.kind)) return;
  const x = g.x;
  // The roof radar shows a comet that has not appeared yet as a dim blip.
  const color = g.early ? '#3f9a66' : '#7dff9c';
  box(ctx, color, x - 20, R.netY - 28, 40, 2);
  box(ctx, color, x - 20, R.netY - 28, 2, 6);
  box(ctx, color, x + 18, R.netY - 28, 2, 6);
  const a = g.tilt * RAD;
  for (let k = -3; k <= 3; k++)
    box(ctx, color, x + Math.cos(a) * k * 6 - 1, R.netY - 40 + Math.sin(a) * k * 6, 3, 3);
  box(ctx, color, x - 1, R.ground - 6, 3, 6);
}

function drawNet(ctx, s) {
  const net = s.net;
  const lv = LEVELS[s.level];
  const pose = poseOf(net.x, net.tilt);
  const sag = 4 + (loadOf(net) / lv.cap) * 14 + net.wobble * 5 * Math.sin(s.ticks * 0.6);
  const at = (u, d) => ({
    x: net.x + u * pose.tx - d * pose.nx,
    y: R.netY + u * pose.ty - d * pose.ny,
  });
  const warn = loadOf(net) >= R.warnAt * lv.cap;
  const blink = warn && Math.floor(s.ticks / 20) % 2 === 0;
  const rim = blink ? '#ff4b2b' : net.open ? '#e8ecff' : '#7dd3ff';
  for (let u = -R.half; u <= R.half; u += 4) {
    const k = 1 - (u / R.half) ** 2;
    const p = at(u, sag * k);
    box(ctx, blink ? '#ff8a6a' : '#a98cff', p.x - 1, p.y - 1, 3, 3);
    if (u % 16 === 0) {
      const q = at(u, 0);
      box(ctx, '#6d57c9', (p.x + q.x) / 2 - 1, (p.y + q.y) / 2 - 1, 2, 2);
    }
  }
  net.items.forEach((it, k) => {
    const p = at(-R.half + 12 + (k % 5) * 10, sag * 0.8 - 4 - Math.floor(k / 5) * 8);
    box(ctx, COLOR_FILL[it.color], p.x - 3, p.y - 3, 7, 7);
    if (it.heat > R.safeHeat) box(ctx, heatColor(it.heat), p.x - 1, p.y - 1, 3, 3);
  });
  for (const e of [-R.half, R.half]) {
    const p = at(e, 0);
    box(ctx, rim, p.x - 3, p.y - 3, 6, 6);
  }
  if (!net.open)
    for (let u = -R.half; u <= R.half; u += 3) box(ctx, rim, at(u, 0).x, at(u, 0).y - 1, 3, 3);
  box(ctx, '#ffe066', net.x - 3, R.netY + 24, 6, 6);
}

function drawHud(ctx, s, env) {
  const lv = LEVELS[s.level];
  box(ctx, '#070b1f', 0, 0, 480, R.top);
  text(ctx, `${env.t('Contract', '合同')} ${s.level + 1}/${LEVEL_COUNT}`, 6, 3, '#9fb0ec', 14);
  text(ctx, env.t(...lv.name), 474, 3, '#9fb0ec', 14, 'right');
  if (s.tail > 0)
    text(
      ctx,
      `${env.t('Time', '时间')} ${Math.ceil(R.grace - s.tail)}`,
      240,
      3,
      '#ffb347',
      14,
      'center',
    );
  const line = env.t(s.line.en, s.line.zh);
  text(ctx, line, 240, 24, s.msg ? '#ffe066' : '#ffffff', 14, 'center');
  box(ctx, '#070b1f', 0, R.bottom, 480, 320 - R.bottom);
  const net = s.net;
  const load = loadOf(net);
  const warn = load >= R.warnAt * lv.cap;
  const heat = Math.round(hottestOf(net));
  text(
    ctx,
    `${env.t('Load', '载荷')} ${load}/${lv.cap}${warn ? '!' : ''}`,
    6,
    302,
    warn ? '#ff8a6a' : '#cfd6ea',
    14,
  );
  text(
    ctx,
    `${env.t('Heat', '热度')} ${heat}`,
    130,
    302,
    heat > R.safeHeat ? '#ff9a3c' : '#cfd6ea',
    14,
  );
  text(
    ctx,
    `${env.t('Net', '网')} ${Math.max(0, Math.ceil(net.integrity))}/${R.integrity}`,
    236,
    302,
    '#cfd6ea',
    14,
  );
  text(ctx, `${env.t('Tries', '机会')} ${s.tries}`, 474, 302, '#cfd6ea', 14, 'right');
}

function drawMenu(ctx, s, env) {
  background(ctx, '#070b1f');
  text(ctx, env.t('COMET CATCHER', '彗星捕手'), 240, 14, '#ffe066', 16, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const x = 20 + ((i - 1) % MENU_COLS) * 40;
    const y = 60 + Math.floor((i - 1) / MENU_COLS) * 44;
    const open = i <= unlocked;
    box(ctx, i === sel ? '#ffe066' : '#3a4258', x - 2, y - 2, 36, 36);
    box(ctx, open ? '#262c3e' : '#14171f', x, y, 32, 32);
    text(ctx, String(i), x + 16, y + 9, open ? '#ffffff' : '#555d75', 14, 'center');
  }
  const lv = LEVELS[sel - 1];
  text(ctx, `${sel}/${LEVEL_COUNT}  ${env.t(...lv.name)}`, 240, 170, '#ffffff', 16, 'center');
  text(ctx, env.t(...lv.tip), 240, 200, '#8d9ac4', 14, 'center');
  text(ctx, env.t(...PROMPTS.menu), 240, 270, '#cfd6ea', 14, 'center');
}

function drawGame(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  drawSky(ctx, s);
  drawRoof(ctx, s);
  drawBins(ctx, s);
  drawGuide(ctx, s);
  for (const p of s.splashes)
    box(ctx, p.hot ? '#ff9a3c' : '#8d9ac4', p.x - 6 - p.age * 20, R.ground - 3, 12 + p.age * 40, 3);
  for (const c of s.comets) drawComet(ctx, c);
  drawNet(ctx, s);
  drawHud(ctx, s, env);
}
