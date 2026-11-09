import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

const touch = (list) => list.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'snowball-siege',
  name: { en: 'Snowball Siege', zh: '雪球攻城' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Clear 30 single-screen floors of the Cinder Keep, alone or with a friend (two players share the screen, with their own lives and keys). Throw snow: four hits pack an enemy into a snowball, but a half-coated enemy thaws and breaks free. Walk into a snowball to roll it: it defeats everything it touches, bounces off walls and heroes and breaks on the fourth hit, and shoves other snowballs into motion for chain bonuses. Jump up through planks, press Down + Jump to drop through them, grab fruit and power-ups, finish before the Ember Wraith hunts you, and beat three bosses with snowballs made from their minions.',
    zh: '清除烬石要塞的30层单屏关卡，可单人或双人同屏合作（各自的生命和按键）。投雪：命中四次把敌人裹成雪球，但只裹一半的敌人会融化脱身。走向雪球就能把它推动：滚动的雪球会击败路上的一切，撞墙或撞到英雄会反弹，第四次撞击时碎裂，还会撞动其他雪球形成连锁加分。可以从木板下方跳上去，按下加跳跃穿过木板；拾取水果和增益道具，赶在余烬幽灵出现前通关，并用三名首领召唤的小怪做成雪球来击败它们。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / ← →' },
    { label: { en: 'Jump (hold = higher)', zh: '跳跃（按住更高）' }, keys: 'W / ↑ / ␣' },
    { label: { en: 'Drop through a plank', zh: '穿过木板下落' }, keys: 'S / ↓ + W / ↑' },
    {
      label: {
        en: 'Throw snow (hold to repeat); next to a snowball it kicks it',
        zh: '投雪（按住连发）；贴着雪球时会踢它',
      },
      keys: 'X / J',
    },
    { label: { en: 'Roll a snowball', zh: '推动雪球' }, keys: '← →' },
    {
      label: {
        en: 'Two players: P1 move / jump / drop / snow',
        zh: '双人：P1 移动 / 跳 / 下落 / 投雪',
      },
      keys: 'A D / W / S / F',
    },
    {
      label: {
        en: 'Two players: P2 move / jump / drop / snow',
        zh: '双人：P2 移动 / 跳 / 下落 / 投雪',
      },
      keys: '← → / ↑ / ↓ / ,',
    },
    {
      label: { en: 'Pick a floor (start screen)', zh: '选择楼层（开始界面）' },
      keys: '← → ↑ ↓ + ␣',
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowUp', 'Jump', '跳', 'right'],
    ['KeyX', 'Snow', '投雪', 'right'],
  ]),
  multiplayerTouchControls: touch([
    ['KeyA', 'A', 'A', 'left'],
    ['KeyD', 'D', 'D', 'left'],
    ['KeyW', 'Jump', '跳', 'left'],
    ['KeyS', 'Down', '下', 'left'],
    ['KeyF', 'Snow', '投雪', 'left'],
    ['ArrowLeft', '◀', '◀', 'right'],
    ['ArrowRight', '▶', '▶', 'right'],
    ['ArrowUp', 'Jump', '跳', 'right'],
    ['ArrowDown', 'Down', '下', 'right'],
    ['Comma', 'Snow', '投雪', 'right'],
  ]),
};

// Every rule number lives here. Units: pixels, seconds, px/s, px/s^2. The simulation advances in
// fixed ticks of 1/120 s whatever the frame rate, so 30/60/120 Hz runs agree.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 28, // y of the first tile row; the HUD band above acts as the ceiling
  step: 1 / 120,
  maxDt: 0.1, // longer frames are refused (inert) rather than run in slow motion
  gravity: 1500, // px/s^2 for the hero, enemies, balls and pickups
  maxFall: 560, // terminal speed, px/s (4.7 px per tick: never skips a 24 px tile)
  heroW: 16,
  heroH: 20,
  run: 110, // top speed
  accelGround: 1100,
  accelAir: 800, // deliberate air control
  fricGround: 1400, // deceleration with no direction held
  fricAir: 300,
  jumpSpeed: 520, // apex = jumpSpeed^2 / (2 gravity) = 90.1 px (3.75 tiles) while the key is held
  cutMul: 3, // gravity multiplier while rising with the key released: apex 30.0 px
  coyote: 0.08, // may still jump this long after leaving a ledge
  buffer: 0.08, // a jump pressed this early before landing still fires
  dropTime: 0.22, // planks are ignored this long after Down + Jump
  shotSpeed: 260,
  shotRange: 108, // px a shot flies before it fizzles
  shotCooldown: 0.22,
  shotBuffer: 0.1,
  shotW: 10,
  shotH: 8,
  snowFull: 4, // snow level at which an enemy becomes a snowball (stages 0..3 then ball)
  thawDelay: 1.0, // seconds after the last hit before snow starts to melt
  thawRate: 0.5, // snow levels lost per second afterwards
  slowPerSnow: 0.2, // a free enemy moves at (1 - 0.2 snow) of its speed
  ballSize: 22,
  ballFoot: 8, // a ball stands on what lies under its middle 8 px, so it tips off ledges
  ballRoll: 180, // px/s given by a push, and the speed kept on flat ground (no friction)
  ballRest: 6.0, // a resting ball holds its enemy this long
  ballWobble: 1.5, // the last stretch of that, drawn as a visible wobble
  ballBounces: 4, // the ball shatters on its 4th wall hit
  ballKeep: 0.9, // speed kept after a wall (or boss) hit: energy never rises
  ballBreakSnow: 2, // snow left on an enemy that breaks out of a resting ball
  lives: 5,
  maxLives: 9,
  invuln: 3.0,
  intro: 1.0, // enemies hold still and are harmless while a floor is introduced
  clearTime: 1.6,
  hurryWarn: 6, // seconds of warning before the wraith appears
  wraithSpeed: 50, // slower than the hero's 110
  wraithRecoil: 2.5,
  pickupLife: 10,
  powerTime: 15,
  shieldTime: 5,
  speedBoost: 1.25,
  rangeBoost: 1.5,
  promptHold: 0.6,
  extraLives: [10000, 25000, 45000, 70000, 100000],
});

const { tile: T, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
const FIELD_BOTTOM = TOP + ROWS * T;
const EPS = 1e-6;
const SOLID = '#';
const PLANK = '=';
const VENT = 'v';

const freeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v));
  return Object.freeze(o);
};
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const approach = (v, target, delta) =>
  v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const shrink = (r, m) => ({ x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m });
const cx = (r) => r.x + r.w / 2;
const cy = (r) => r.y + r.h / 2;
const rectOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
export const LETTERS = 'FROST';

// Heroes still in play (a player with no lives left is out), and the one nearest to a point.
const players = (s) => [s.hero, s.hero2].filter((h) => h && !h.out);
function nearest(s, o) {
  const list = players(s);
  if (!list.length) return s.hero;
  return list.reduce((a, b) => (Math.abs(cx(b) - cx(o)) < Math.abs(cx(a) - cx(o)) ? b : a));
}
const livesKey = (h) => (h.idx ? 'lives2' : 'lives');

// ---------------------------------------------------------------------------------------------
// Swept collision against the tile grid. Moves are clamped to the first blocking tile edge, so a
// move of any length cannot tunnel. '#' is solid, '=' is a plank that only stops a body falling
// onto it from above, 'v' is a vent grate: solid for walkers, open for snowballs.
// ---------------------------------------------------------------------------------------------

export function tileAt(grid, c, r) {
  if (c < 0 || c >= COLS) return SOLID;
  if (r < 0 || r >= ROWS) return '.';
  return grid[r][c];
}
const blockedAs = (ch, vent) => ch === SOLID || (ch === VENT && !vent);

// Moves the body horizontally. Returns true when a wall stopped it (the body is then flush to it).
export function sweepX(grid, b, dx, vent = false) {
  if (!dx || Number.isNaN(dx)) return false;
  const r0 = Math.floor((b.y - TOP + EPS) / T);
  const r1 = Math.floor((b.y - TOP + b.h - EPS) / T);
  const dir = dx > 0 ? 1 : -1;
  const lead = dx > 0 ? b.x + b.w : b.x;
  let c = dx > 0 ? Math.ceil((lead - EPS) / T) : Math.floor((lead + EPS) / T) - 1;
  for (; ; c += dir) {
    const edge = dx > 0 ? c * T : (c + 1) * T;
    if ((edge - lead) * dir > Math.abs(dx) + EPS) break;
    for (let r = r0; r <= r1; r++) {
      if (!blockedAs(tileAt(grid, c, r), vent)) continue;
      b.x = dx > 0 ? edge - b.w : edge;
      return true;
    }
  }
  b.x += dx;
  return false;
}

// Moves the body vertically. Returns 1 when it landed on solid ground, 2 on a plank, -1 when it
// hit a ceiling, 0 when it moved freely. `plank:false` lets it fall through planks; `inset` narrows
// the footprint (snowballs balance on their middle).
export function sweepY(grid, b, dy, o = {}) {
  if (!dy || Number.isNaN(dy)) return 0;
  const vent = !!o.vent;
  const planks = o.plank !== false;
  const inset = o.inset || 0;
  const c0 = Math.floor((b.x + inset + EPS) / T);
  const c1 = Math.floor((b.x + b.w - inset - EPS) / T);
  if (dy > 0) {
    const lead = b.y + b.h;
    for (let r = Math.ceil((lead - TOP - EPS) / T); ; r++) {
      const edge = TOP + r * T;
      if (edge - lead > dy + EPS) break;
      let plank = false;
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(grid, c, r);
        if (blockedAs(ch, vent)) {
          b.y = edge - b.h;
          return 1;
        }
        if (ch === PLANK && planks) plank = true;
      }
      if (plank) {
        b.y = edge - b.h;
        return 2;
      }
    }
    b.y += dy;
    return 0;
  }
  const lead = b.y;
  for (let r = Math.floor((lead - TOP + EPS) / T) - 1; r >= 0; r--) {
    const edge = TOP + (r + 1) * T;
    if (lead - edge > -dy + EPS) break;
    for (let c = c0; c <= c1; c++) {
      if (!blockedAs(tileAt(grid, c, r), vent)) continue;
      b.y = edge;
      return -1;
    }
  }
  if (b.y + dy < TOP) {
    b.y = TOP;
    return -1;
  }
  b.y += dy;
  return 0;
}

// A horizontal shot box travelling from x0 to x1 at height y: the box it sweeps through.
export function sweptBox(x0, x1, y, w, h) {
  return { x: Math.min(x0, x1), y, w: Math.abs(x1 - x0) + w, h };
}

// Floors: 20 columns by 11 rows. # wall, = plank (stand on it, jump up through it, drop through it
// with Down + Jump), v vent grate (solid for creatures, open for snowballs). Letters are spawns:
// @ hero, w walker, j jumper, f flyer, t thrower, B boss; each stands in the cell above its floor.
const FOE_LETTER = { w: 'walker', j: 'jumper', f: 'flyer', t: 'thrower' };
export const FLOORS = freeze([
  {
    name: { en: 'First Steps', zh: '第一步' },
    idea: 'jump',
    hurry: 120,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..w...........w...#',
      '#=======....=======#',
      '#..................#',
      '#........@.........#',
      '####################',
    ],
  },
  {
    name: { en: 'Snow Day', zh: '雪日' },
    idea: 'throw',
    hurry: 120,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........##........#',
      '#.w..@...##......w.#',
      '####################',
    ],
  },
  {
    name: { en: 'Snowman', zh: '雪人' },
    idea: 'ball',
    hurry: 145,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...w..........w...#',
      '#.======....======.#',
      '#..................#',
      '#..@......w........#',
      '####################',
    ],
  },
  {
    name: { en: 'Trapdoor', zh: '活板门' },
    idea: 'drop',
    hurry: 145,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..@..w........w...#',
      '#.=======..=======.#',
      '#..................#',
      '#..................#',
      '#====..........====#',
      '#..................#',
      '#........w.........#',
      '####################',
    ],
  },
  {
    name: { en: 'Bank Shot', zh: '反弹球' },
    idea: 'wall',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...w..........w...#',
      '#.======.##.======.#',
      '#........##........#',
      '#....@...##.....w..#',
      '####################',
    ],
  },
  {
    name: { en: 'Chain Reaction', zh: '连锁反应' },
    idea: 'chain',
    hurry: 195,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#...w..........w...#',
      '#.=====......=====.#',
      '#..................#',
      '#.@........w.w.w.w.#',
      '####################',
    ],
  },
  {
    name: { en: 'Hopscotch', zh: '跳房子' },
    idea: 'hopper',
    hurry: 145,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#........w.........#',
      '#.....========.....#',
      '#..................#',
      '#...w..........w...#',
      '#.======....======.#',
      '#..................#',
      '#..@........j......#',
      '####################',
    ],
  },
  {
    name: { en: 'Moth Alley', zh: '蛾子小巷' },
    idea: 'moth',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..wf..............#',
      '#======......======#',
      '#..................#',
      '#..w......@.....w..#',
      '####################',
    ],
  },
  {
    name: { en: 'Soot Stack', zh: '煤灰堆' },
    idea: 'imp',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#.......t..........#',
      '#.....========.....#',
      '#..................#',
      '#...............t..#',
      '#=======....=======#',
      '#..................#',
      '#..w.....@......w..#',
      '####################',
    ],
  },
  {
    name: { en: 'Kiln Golem', zh: '窑炉巨像' },
    idea: 'golem',
    hurry: 0,
    boss: 'golem',
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#....==========....#',
      '#..................#',
      '#..@...............#',
      '#=======....=======#',
      '#..................#',
      '#.............B....#',
      '####################',
    ],
  },
  {
    name: { en: 'Fruit Basket', zh: '水果篮' },
    idea: 'pickup',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#.......w..........#',
      '#....==========....#',
      '#..................#',
      '#...w..........j...#',
      '#======......======#',
      '#..................#',
      '#.@.......w........#',
      '####################',
    ],
  },
  {
    name: { en: 'Hurry Up', zh: '抓紧时间' },
    idea: 'hurry',
    hurry: 55,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..w...............#',
      '#======......======#',
      '#........##........#',
      '#.w...@..##.....w..#',
      '####################',
    ],
  },
  {
    name: { en: 'Grate Expectations', zh: '排气格栅' },
    idea: 'vent',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..w.....f......j..#',
      '#=====........=====#',
      '#..................#',
      '#..w.....@.........#',
      '#######vvvvvv#######',
    ],
  },
  {
    name: { en: 'Low Ceiling', zh: '低矮天花板' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#........t.........#',
      '#==================#',
      '#..................#',
      '#....j........w....#',
      '#..======..======..#',
      '#..................#',
      '#..w.....@.......w.#',
      '####################',
    ],
  },
  {
    name: { en: 'Moth Maze', zh: '蛾阵' },
    idea: 'free',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#...f..............#',
      '#========..========#',
      '#..................#',
      '#........f.........#',
      '#....==========....#',
      '#..................#',
      '#..w.....@.......w.#',
      '####################',
    ],
  },
  {
    name: { en: 'Imp Alley', zh: '小鬼巷' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#........t.........#',
      '#...============...#',
      '#..................#',
      '#..w............t..#',
      '#=====........=====#',
      '#..................#',
      '#....w...@....w....#',
      '####################',
    ],
  },
  {
    name: { en: 'Hopper Hill', zh: '跳蛙坡' },
    idea: 'free',
    hurry: 170,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#.....j........j...#',
      '#...======...=====.#',
      '#..................#',
      '#..j............w..#',
      '#=====......=======#',
      '#..................#',
      '#........@.........#',
      '####################',
    ],
  },
  {
    name: { en: 'Crossfire', zh: '交叉火力' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#........f.........#',
      '#....==========....#',
      '#..................#',
      '#..t............j..#',
      '#======......======#',
      '#..................#',
      '#...w....w.....@...#',
      '####################',
    ],
  },
  {
    name: { en: 'Glacier Gauntlet', zh: '冰川试炼' },
    idea: 'free',
    hurry: 145,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#....t.............#',
      '#..======..======..#',
      '#..................#',
      '#...............j..#',
      '#=====........=====#',
      '#........##........#',
      '#..w.....##.@......#',
      '####################',
    ],
  },
  {
    name: { en: 'Lantern Wyrm', zh: '灯笼飞蛇' },
    idea: 'wyrm',
    hurry: 0,
    boss: 'wyrm',
    rows: [
      '#..................#',
      '#........B.........#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#=====........=====#',
      '#..................#',
      '#....@.............#',
      '####################',
    ],
  },
  {
    name: { en: 'Rooftop Run', zh: '屋顶奔跑' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..w............j..#',
      '#======......======#',
      '#..................#',
      '#.......w..........#',
      '#...==============.#',
      '#..................#',
      '#................t.#',
      '#======......======#',
      '#..................#',
      '#........@.....w...#',
      '####################',
    ],
  },
  {
    name: { en: 'Pit Stop', zh: '深坑' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#...............w..#',
      '#.=======..=======.#',
      '#..................#',
      '#..................#',
      '#=====..====..=====#',
      '#..................#',
      '#..w.......@....jw.#',
      '#####vv######vv#####',
    ],
  },
  {
    name: { en: 'Snowdrift', zh: '雪堆' },
    idea: 'free',
    hurry: 170,
    rows: [
      '#..................#',
      '#....==========....#',
      '#..................#',
      '#..j............w..#',
      '#=======....=======#',
      '#..................#',
      '#...w...........w..#',
      '#.=======..=======.#',
      '#..................#',
      '#........@.........#',
      '#vvv############vvv#',
    ],
  },
  {
    name: { en: 'Furnace Row', zh: '熔炉街' },
    idea: 'free',
    hurry: 270,
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#....w.......f.....#',
      '#..======..======..#',
      '#..................#',
      '#..w....w...j....t.#',
      '#==================#',
      '#..................#',
      '#.j......w.......@.#',
      '####################',
    ],
  },
  {
    name: { en: 'Ash Cascade', zh: '灰烬瀑布' },
    idea: 'free',
    hurry: 170,
    rows: [
      '#..w...........j...#',
      '#.=======..=======.#',
      '#..................#',
      '#.......w..........#',
      '#..=============...#',
      '#..................#',
      '#..t...............#',
      '#======......======#',
      '#..................#',
      '#...............@..#',
      '########vvvv########',
    ],
  },
  {
    name: { en: 'Spark Circuit', zh: '火花回路' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#.....t............#',
      '#...============...#',
      '#..................#',
      '#..j............j..#',
      '#======......======#',
      '#..................#',
      '#...w..........w...#',
      '#.======....======.#',
      '#..................#',
      '#.....@............#',
      '########vvvv########',
    ],
  },
  {
    name: { en: 'Thaw Trap', zh: '解冻陷阱' },
    idea: 'free',
    hurry: 220,
    rows: [
      '#........w.........#',
      '#.....========.....#',
      '#..................#',
      '#...t..........t...#',
      '#.=======..=======.#',
      '#..................#',
      '#.....j..f.........#',
      '#....==========....#',
      '#..................#',
      '#........@.........#',
      '##vv############vv##',
    ],
  },
  {
    name: { en: 'Ember Ladder', zh: '余烬阶梯' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#........w.........#',
      '#......======......#',
      '#..................#',
      '#....j.........w...#',
      '#..==============..#',
      '#..................#',
      '#..w.............w.#',
      '#======......======#',
      '#..................#',
      '#........@.........#',
      '####################',
    ],
  },
  {
    name: { en: 'Last Light', zh: '最后的灯火' },
    idea: 'free',
    hurry: 195,
    rows: [
      '#..t...............#',
      '#.=======..=======.#',
      '#..................#',
      '#.............w....#',
      '#..==============..#',
      '#..................#',
      '#..w............w..#',
      '#=====........=====#',
      '#..................#',
      '#.........@........#',
      '#######vvvvvv#######',
    ],
  },
  {
    name: { en: 'Furnace Queen', zh: '熔炉女王' },
    idea: 'queen',
    hurry: 0,
    boss: 'queen',
    rows: [
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#....==========....#',
      '#..................#',
      '#..................#',
      '#=======....=======#',
      '#..................#',
      '#.@......B.........#',
      '####################',
    ],
  },
]);

// ---------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------

export const FOES = freeze({
  walker: { w: 18, h: 18, speed: 32, score: 100, name: { en: 'Cinder Grub', zh: '烬虫' } },
  jumper: { w: 18, h: 18, speed: 40, score: 150, name: { en: 'Spark Hopper', zh: '火花跳蛙' } },
  flyer: { w: 22, h: 16, speed: 38, score: 200, name: { en: 'Ember Moth', zh: '余烬蛾' } },
  thrower: { w: 18, h: 20, speed: 24, score: 250, name: { en: 'Soot Imp', zh: '煤灰小鬼' } },
});
export const FRUIT = freeze([
  { id: 'cherry', value: 100 },
  { id: 'pear', value: 200 },
  { id: 'plum', value: 300 },
  { id: 'star', value: 500 },
]);
export const POWERS = freeze(['speed', 'range', 'power', 'shield']);
export const POWER_INFO = freeze({
  speed: {
    name: { en: 'Speed up', zh: '加速' },
    en: `Speed up: run 25% faster for ${RULES.powerTime} s or until you are hurt`,
    zh: `加速：跑得更快，持续${RULES.powerTime}秒或直到被击中`,
  },
  range: {
    name: { en: 'Long shot', zh: '远射' },
    en: `Long shot: snow flies 50% farther for ${RULES.powerTime} s or until hurt`,
    zh: `远射：雪球飞得更远，持续${RULES.powerTime}秒或直到被击中`,
  },
  power: {
    name: { en: 'Heavy snow', zh: '重雪' },
    en: `Heavy snow: two layers per hit for ${RULES.powerTime} s or until hurt`,
    zh: `重雪：每发加两层，持续${RULES.powerTime}秒或直到被击中`,
  },
  shield: {
    name: { en: 'Shield', zh: '护盾' },
    en: `Shield: harmless for ${RULES.shieldTime} seconds`,
    zh: `护盾：${RULES.shieldTime}秒内不受伤`,
  },
});
export const BOSSES = freeze({
  golem: { w: 46, h: 56, hp: 4, name: { en: 'Kiln Golem', zh: '窑炉巨像' } },
  wyrm: { w: 54, h: 30, hp: 4, name: { en: 'Lantern Wyrm', zh: '灯笼飞蛇' } },
  queen: { w: 44, h: 52, hp: 4, name: { en: 'Furnace Queen', zh: '熔炉女王' } },
});
const BOSS_SCORE = 3000;
const HURT_MARGIN = 3; // hero and foe boxes shrink this much for touch damage
const BOSS_HIT_GAP = 1.4; // a boss ignores further snowballs for this long after one lands
const MINION_CAP = 2;
const THROWER_STUN = 2.5; // seconds before an imp whose windup was snowed out may try again
const JUMPER_CROUCH = 0.6; // seconds a hopper crouches before it leaps
const TURN_PAUSE = 1.5; // seconds a walker waits at each turn-around
const SPAWN_WARN = 0.7;

const say = (s, en, zh, secs = 2.5) => {
  s.msg = { en, zh, left: Math.round(secs / STEP) };
};
const learn = (s, id) => {
  s.learned[id] = true;
};

function makeFoe(s, kind, x, y, extra = {}) {
  const d = FOES[kind];
  return {
    id: s.nextId++,
    kind,
    x: x - d.w / 2,
    y: y - d.h,
    w: d.w,
    h: d.h,
    vx: 0,
    vy: 0,
    dir: s.rng() < 0.5 ? -1 : 1,
    snow: 0,
    sinceHit: 99,
    grounded: false,
    state: kind === 'jumper' ? 'idle' : kind === 'flyer' ? 'fly' : 'walk',
    timer: kind === 'jumper' ? 0.9 : kind === 'thrower' ? 1.6 : 0,
    lane: y - d.h / 2,
    phase: (s.nextId % 5) * 1.3,
    flash: 0,
    ...extra,
  };
}

function makeHero(start, idx = 0) {
  const side = start.c < 17 ? 22 : -22;
  return {
    idx,
    out: false,
    restFeet: TOP + (start.r + 1) * T,
    pj: false,
    pt: false,
    x: start.c * T + (T - RULES.heroW) / 2 + (idx ? side : 0),
    y: TOP + (start.r + 1) * T - RULES.heroH,
    w: RULES.heroW,
    h: RULES.heroH,
    vx: 0,
    vy: 0,
    face: 1,
    grounded: true,
    ground: 1,
    coyote: 0,
    buf: 0,
    dropT: 0,
    cd: 0,
    shotBuf: 0,
    invuln: 0,
    power: { speed: 0, range: 0, power: 0, shield: 0 },
  };
}

export function loadFloor(s, index) {
  const def = FLOORS[index];
  const grid = [];
  const foes = [];
  let start = null;
  let boss = null;
  def.rows.forEach((row, r) => {
    let out = '';
    [...row].forEach((ch, c) => {
      if (ch === '@') start = { c, r };
      else if (ch === 'B') boss = { c, r };
      else if (FOE_LETTER[ch]) foes.push({ kind: FOE_LETTER[ch], c, r });
      out += '@wjftB'.includes(ch) ? '.' : ch;
    });
    grid.push(out);
  });
  s.floor = index;
  s.grid = grid;
  s.start = start;
  const keep = (old, fresh) => ({
    ...fresh,
    power: old ? old.power : fresh.power,
    out: old ? old.out : false,
  });
  s.hero = keep(s.hero, makeHero(start, 0));
  s.hero2 = s.coop ? keep(s.hero2, makeHero(start, 1)) : null;
  s.enemies = foes.map((f) => {
    const x = f.c * T + T / 2;
    const y = TOP + (f.r + 1) * T;
    return makeFoe(s, f.kind, x, f.kind === 'flyer' ? y - T / 2 + FOES.flyer.h / 2 : y);
  });
  s.balls = [];
  s.shots = [];
  s.hz = [];
  s.marks = [];
  s.pickups = [];
  s.pops = [];
  s.fx = [];
  s.chains = {};
  s.wraith = null;
  s.boss = boss ? makeBoss(s, def.boss, boss) : null;
  s.floorTime = 0;
  s.intro = RULES.intro;
  s.clear = 0;
  s.dying = 0;
  s.learned = {};
  s.lastChain = 0;
  s.floorBest = 0;
  s.hurryState = 'none';
  s.msg = null;
  s.prompt = { id: '', key: 'seek', subject: null, age: 0 };
  s.waitTime = 0;
  setPrompt(s, true);
}

export function newState(rng = Math.random, mode = 1) {
  const s = {
    rng,
    coop: mode === 2,
    lives2: mode === 2 ? RULES.lives : 0,
    letters: 0,
    seenPower: {},
    hero2: null,
    phase: 'playing',
    cause: null,
    score: 0,
    lives: RULES.lives,
    extra: 0,
    ticks: 0,
    acc: 0,
    nextId: 1,
    menu: null,
    menuClock: 0,
    unlockTo: 0,
    hero: null,
    stats: {
      defeated: 0,
      bestChain: 0,
      chainClears: 0,
      shots: 0,
      pickups: 0,
      hurt: 0,
      shattered: 0,
    },
  };
  loadFloor(s, 0);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Scoring, chains and drops
// ---------------------------------------------------------------------------------------------

function addScore(s, n, emit) {
  s.score += n;
  while (s.extra < RULES.extraLives.length && s.score >= RULES.extraLives[s.extra]) {
    s.extra++;
    giveLife(s, players(s).sort((a, b) => s[livesKey(a)] - s[livesKey(b)])[0], emit);
  }
}

function giveLife(s, h, emit) {
  if (!h || s[livesKey(h)] >= RULES.maxLives) return;
  s[livesKey(h)]++;
  say(s, 'Extra life!', '获得一条命！');
  emit('coin');
}

function pop(s, x, y, label) {
  if (s.pops.length < 12) s.pops.push({ x, y, label, left: 0.9 });
}
function burst(s, x, y, color, n = 6) {
  for (let i = 0; i < n && s.fx.length < 90; i++) {
    const a = (i / n) * Math.PI * 2 + s.ticks * 0.1;
    s.fx.push({ x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 40, color, left: 0.5 });
  }
}

function newChain(s) {
  const id = s.nextId++;
  s.chains[id] = { n: 0 };
  return id;
}

function dropPickup(s, x, y, n) {
  const p = s.rng();
  const kind = p < 0.28 ? POWERS[Math.floor(s.rng() * POWERS.length)] : null;
  const fruit = FRUIT[Math.min(FRUIT.length, n) - 1];
  if (!kind && s.rng() < 0.15) {
    s.pickups.push({
      id: s.nextId++,
      x: x - 7,
      y: y - 7,
      w: 14,
      h: 14,
      vy: -150,
      kind: 'letter',
      letter: LETTERS[s.letters],
      power: false,
      value: 0,
      life: RULES.pickupLife,
    });
    return;
  }
  s.pickups.push({
    id: s.nextId++,
    x: x - 7,
    y: y - 7,
    w: 14,
    h: 14,
    vy: -150,
    kind: kind ?? fruit.id,
    power: !!kind,
    value: kind ? 0 : fruit.value,
    life: RULES.pickupLife,
  });
}

// An enemy is defeated exactly once; `chain` is the id of the chain of snowballs that did it.
function defeatFoe(s, foe, chain, x, y, emit) {
  if (foe.scored) return;
  foe.scored = true;
  const ch = s.chains[chain] ?? (s.chains[chain] = { n: 0 });
  ch.n++;
  s.lastChain = ch.n;
  if (ch.n >= 2) learn(s, 'chain');
  s.floorBest = Math.max(s.floorBest, ch.n);
  s.stats.defeated++;
  s.stats.bestChain = Math.max(s.stats.bestChain, ch.n);
  const points = FOES[foe.kind].score * Math.min(8, ch.n);
  addScore(s, points, emit);
  pop(s, x, y, ch.n > 1 ? `${points} x${ch.n}` : `${points}`);
  burst(s, x, y, '#ffd35a');
  dropPickup(s, x, y, ch.n);
  emit('hit');
}

function snowHit(s, e, gain, emit) {
  e.snow = Math.min(RULES.snowFull, e.snow + gain);
  e.sinceHit = 0;
  e.flash = 0.12;
  emit('hit');
  if (e.snow < RULES.snowFull) return;
  e.dead = true;
  const ball = {
    id: s.nextId++,
    x: e.x + (e.w - RULES.ballSize) / 2,
    y: e.y + e.h - RULES.ballSize,
    w: RULES.ballSize,
    h: RULES.ballSize,
    vx: 0,
    vy: e.vy > 0 ? e.vy : 0,
    mode: 'rest',
    life: RULES.ballRest,
    bounces: 0,
    chain: 0,
    grounded: false,
    occupant: { id: e.id, kind: e.kind, minion: !!e.minion },
    roll: 0,
  };
  clearOfWalls(s.grid, ball);
  s.balls.push(ball);
  burst(s, cx(e), cy(e), '#ffffff', 5);
}

// True when the box overlaps wall tiles (vents count as open for snowballs).
function inWall(grid, b, vent = true) {
  const c0 = Math.floor(b.x / T);
  const c1 = Math.floor((b.x + b.w - EPS) / T);
  const r0 = Math.floor((b.y - TOP) / T);
  const r1 = Math.floor((b.y + b.h - TOP - EPS) / T);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) if (blockedAs(tileAt(grid, c, r), vent)) return true;
  return false;
}

// Moves a freshly placed body sideways to the nearest spot clear of walls (or reports failure).
function clearOfWalls(grid, b) {
  for (let d = 0; d <= 24; d += 1) {
    for (const side of [1, -1]) {
      const probe = { ...b, x: b.x + side * d };
      if (!inWall(grid, probe)) {
        b.x = probe.x;
        return true;
      }
    }
  }
  return false;
}

// A rolling snowball is launched: its occupant is defeated and the ball keeps going.
function launch(s, b, dir, chain, emit) {
  b.mode = 'roll';
  b.vx = dir * RULES.ballRoll;
  b.bounces = 0;
  b.life = RULES.ballRest;
  b.chain = chain || newChain(s);
  s.pushes = (s.pushes || 0) + 1;
  learn(s, 'push');
  if (b.occupant) {
    const occ = b.occupant;
    b.occupant = null;
    defeatFoe(s, occ, b.chain, cx(b), cy(b), emit);
  }
  emit('move');
}

function shatter(s, b, emit) {
  b.dead = true;
  s.stats.shattered++;
  burst(s, cx(b), cy(b), '#e8f6ff', 8);
  emit('hit');
}

// ---------------------------------------------------------------------------------------------
// The hero
// ---------------------------------------------------------------------------------------------

// The throw key also kicks a snowball resting right in front of the hero.
function kickAhead(s, h, emit) {
  const reach = { x: h.face > 0 ? h.x + h.w - 2 : h.x - 8, y: h.y, w: 10, h: h.h };
  const ball = s.balls.find((b) => b.mode === 'rest' && overlap(b, reach));
  if (!ball) return false;
  launch(s, ball, h.face, 0, emit);
  return true;
}

function fireShot(s, h, emit) {
  h.cd = RULES.shotCooldown;
  h.shotBuf = 0;
  if (kickAhead(s, h, emit)) return;
  const speed = RULES.shotSpeed;
  const muzzle = {
    x: h.face > 0 ? h.x + h.w : h.x - RULES.shotW,
    y: cy(h) - RULES.shotH / 2 - 2,
    w: RULES.shotW,
    h: RULES.shotH,
  };
  if (inWall(s.grid, muzzle, true)) {
    burst(s, muzzle.x, muzzle.y, '#e8f6ff', 3);
    return;
  }
  const range = RULES.shotRange * (h.power.range > 0 ? RULES.rangeBoost : 1);
  s.shots.push({
    id: s.nextId++,
    owner: h.idx,
    x: h.face > 0 ? h.x + h.w : h.x - RULES.shotW,
    y: cy(h) - RULES.shotH / 2 - 2,
    w: RULES.shotW,
    h: RULES.shotH,
    vx: h.face * speed,
    life: range / speed,
    gain: h.power.power > 0 ? 2 : 1,
  });
  s.stats.shots++;
  learn(s, 'throw');
  emit('shoot');
}

function heroTick(s, h, ctl, emit) {
  const P = RULES;
  h.invuln = Math.max(0, h.invuln - STEP);
  for (const k of POWERS) h.power[k] = Math.max(0, h.power[k] - STEP);
  h.cd = Math.max(0, h.cd - STEP);
  h.dropT = Math.max(0, h.dropT - STEP);
  h.shotBuf = Math.max(0, h.shotBuf - STEP);
  h.buf = Math.max(0, h.buf - STEP);
  if (h.pj) h.buf = P.buffer;
  if (h.pt) h.shotBuf = P.shotBuffer;
  h.pj = h.pt = false;
  h.coyote = h.grounded ? P.coyote : Math.max(0, h.coyote - STEP);

  if (h.buf > 0 && h.coyote > 0) {
    h.buf = h.coyote = 0;
    if (ctl.down && h.grounded && h.ground === 2) {
      h.dropT = P.dropTime;
      learn(s, 'drop');
    } else {
      h.vy = -P.jumpSpeed;
      learn(s, 'jump');
      emit('move');
    }
    h.grounded = false;
  }

  const top = P.run * (h.power.speed > 0 ? P.speedBoost : 1);
  if (ctl.dir) {
    h.vx = approach(h.vx, ctl.dir * top, (h.grounded ? P.accelGround : P.accelAir) * STEP);
    h.face = ctl.dir;
  } else h.vx = approach(h.vx, 0, (h.grounded ? P.fricGround : P.fricAir) * STEP);

  const g = P.gravity * (h.vy < 0 && !ctl.jump ? P.cutMul : 1);
  const vy1 = Math.min(P.maxFall, h.vy + g * STEP);
  const x0 = h.x;
  if (sweepX(s.grid, h, h.vx * STEP)) h.vx = 0;
  // Partners cannot walk through each other (harmless: they simply stop, or hop over).
  const mate = players(s).find((o) => o !== h);
  if (
    mate &&
    !overlap({ ...h, x: x0 }, mate) &&
    overlap(h, mate) &&
    Math.min(h.y + h.h, mate.y + mate.h) - Math.max(h.y, mate.y) > 4
  ) {
    h.x = x0;
    h.vx = 0;
  }
  const hit = sweepY(s.grid, h, ((h.vy + vy1) / 2) * STEP, { plank: h.dropT <= 0 });
  h.grounded = hit > 0;
  if (hit > 0) {
    h.ground = hit;
    h.restFeet = h.y + h.h;
  }
  h.vy = hit !== 0 ? 0 : vy1;

  if ((ctl.throwHeld || h.shotBuf > 0) && h.cd <= 0) fireShot(s, h, emit);
}

// Walking into a resting snowball rolls it away from you.
function pushBalls(s, h, ctl, emit) {
  if (!ctl.dir) return;
  for (const b of s.balls) {
    if (b.mode !== 'rest' || sign(cx(b) - cx(h)) !== ctl.dir) continue;
    const reach = { x: b.x - 1, y: b.y, w: b.w + 2, h: b.h };
    const vertical = Math.min(h.y + h.h, b.y + b.h) - Math.max(h.y, b.y);
    if (overlap(h, reach) && vertical >= 6) launch(s, b, ctl.dir, 0, emit);
  }
}

// ---------------------------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------------------------

const slowOf = (e) => 1 - RULES.slowPerSnow * e.snow;

function fall(s, b, opts = {}) {
  const vy1 = Math.min(RULES.maxFall, b.vy + RULES.gravity * STEP);
  const hit = sweepY(s.grid, b, ((b.vy + vy1) / 2) * STEP, opts);
  b.grounded = hit > 0;
  b.vy = hit !== 0 ? 0 : vy1;
  return hit;
}

function hasFloorAhead(s, e) {
  const probe = e.dir > 0 ? e.x + e.w + 2 : e.x - 2;
  const row = Math.floor((e.y + e.h - TOP + 2) / T);
  const ch = tileAt(s.grid, Math.floor(probe / T), row);
  return ch === SOLID || ch === PLANK || ch === VENT;
}

// A resting snowball is a solid object for walkers and bosses: they stop and turn around at it.
function ballBlocks(s, e, dx) {
  const probe = { x: e.x + dx, y: e.y, w: e.w, h: e.h };
  return s.balls.some((b) => !b.dead && b.mode === 'rest' && overlap(probe, b) && !overlap(e, b));
}

function patrol(s, e, speed) {
  // Walkers stop for a moment at every turn-around, a readable beat before they come back.
  if (e.pause > 0) {
    e.pause -= STEP;
    e.vx = 0;
    fall(s, e);
    return;
  }
  const turn = () => {
    e.dir = -e.dir;
    e.pause = TURN_PAUSE;
  };
  if (e.grounded && !hasFloorAhead(s, e)) return turn();
  e.vx = e.dir * speed;
  if (ballBlocks(s, e, e.vx * STEP)) turn();
  else if (sweepX(s.grid, e, e.vx * STEP)) turn();
  fall(s, e);
}

function lob(s, from, toX, toY, flight, kind = 'ember') {
  const g = 600;
  const vx = Math.max(-190, Math.min(190, (toX - from.x) / flight));
  const vy = (toY - from.y - 0.5 * g * flight * flight) / flight;
  s.hz.push({ kind, x: from.x - 5, y: from.y - 5, w: 10, h: 10, vx, vy, g, life: 3 });
}

function foeTick(s, e) {
  e.sinceHit += STEP;
  e.flash = Math.max(0, e.flash - STEP);
  if (e.snow > 0 && e.sinceHit > RULES.thawDelay)
    e.snow = Math.max(0, e.snow - RULES.thawRate * STEP);
  const k = slowOf(e);
  const hero = nearest(s, e);
  if (e.kind === 'walker') patrol(s, e, FOES.walker.speed * k);
  else if (e.kind === 'flyer') {
    e.phase += STEP * 2.6 * k;
    e.vx = e.dir * FOES.flyer.speed * k;
    if (sweepX(s.grid, e, e.vx * STEP)) e.dir = -e.dir;
    const ty = e.lane - e.h / 2 + Math.sin(e.phase) * 12;
    sweepY(s.grid, e, ty - e.y, { plank: false });
  } else if (e.kind === 'jumper') {
    if (e.state === 'air') {
      if (sweepX(s.grid, e, e.vx * STEP)) e.vx = 0;
      if (fall(s, e) > 0) {
        e.state = 'idle';
        e.vx = 0;
        e.timer = 1.6 + s.rng() * 0.9;
      }
    } else {
      e.timer -= STEP * k;
      fall(s, e);
      if (e.state === 'idle' && e.timer <= 0) {
        e.state = 'crouch';
        e.timer = JUMPER_CROUCH;
      } else if (e.state === 'crouch' && e.timer <= 0) {
        const away = cx(hero) - cx(e);
        e.dir = Math.abs(away) > 12 ? sign(away) : e.dir;
        const climb = hero.y + 24 < e.y && Math.abs(away) < 130;
        e.vy = -(climb ? 520 : 300) * (0.6 + 0.4 * k);
        e.vx = e.dir * FOES.jumper.speed * k;
        e.grounded = false;
        e.state = 'air';
      }
    }
  } else if (e.kind === 'thrower') {
    e.timer -= STEP;
    // Snow on an imp puts out its windup: hit it before it throws and it stays harmless.
    if (e.snow > 0 && e.state === 'windup') {
      e.state = 'walk';
      e.timer = THROWER_STUN;
    }
    if (e.state === 'walk') {
      patrol(s, e, FOES.thrower.speed * k);
      const seen = Math.abs(cy(hero) - cy(e)) < 40 && Math.abs(cx(hero) - cx(e)) < 220;
      if (seen && e.timer <= 0 && e.grounded && e.snow <= 0) {
        e.state = 'windup';
        e.timer = 1.0;
        e.dir = sign(cx(hero) - cx(e)) || e.dir;
        e.aim = { x: cx(hero), y: hero.y + hero.h / 2 };
      }
    } else {
      fall(s, e);
      if (e.state === 'windup' && e.timer <= 0) {
        lob(s, { x: cx(e) + e.dir * 8, y: e.y + 4 }, e.aim.x, e.aim.y, 0.9);
        e.state = 'recover';
        e.timer = 0.4;
      } else if (e.state === 'recover' && e.timer <= 0) {
        e.state = 'walk';
        e.timer = 2.8;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Snowballs
// ---------------------------------------------------------------------------------------------

const BALL_INSET = (RULES.ballSize - RULES.ballFoot) / 2;

function breakOut(s, b) {
  b.dead = true;
  if (!b.occupant) return;
  const o = b.occupant;
  const e = makeFoe(s, o.kind, cx(b), b.y + b.h, { id: o.id, minion: o.minion });
  e.snow = RULES.ballBreakSnow;
  e.sinceHit = 0;
  e.dir = s.rng() < 0.5 ? -1 : 1;
  e.grounded = false;
  s.enemies.push(e);
  burst(s, cx(b), cy(b), '#e8f6ff', 6);
}

function ballTick(s, b, emit) {
  if (inWall(s.grid, b) && !clearOfWalls(s.grid, b)) return void (b.dead = true);
  if (b.mode === 'rest') {
    b.life -= STEP;
    if (b.life <= 0) return b.occupant ? breakOut(s, b) : (b.dead = true);
  }
  const wall = sweepX(s.grid, b, b.vx * STEP, true);
  fall(s, b, { vent: true, inset: BALL_INSET });
  if (b.y > FIELD_BOTTOM + 4) {
    b.dead = true;
    if (b.occupant) defeatFoe(s, b.occupant, newChain(s), cx(b), FIELD_BOTTOM - 8, emit);
    return;
  }
  if (!wall || b.mode !== 'roll') return;
  b.bounces++;
  learn(s, 'bounce');
  if (b.bounces >= RULES.ballBounces) shatter(s, b, emit);
  else b.vx = -b.vx * RULES.ballKeep;
}

// Equal-mass elastic contacts: a rolling ball that meets a resting one hands over all its speed
// and stops, so momentum and energy are conserved; two rolling balls trade velocities.
function ballPairs(s, emit) {
  const list = s.balls;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.dead || b.dead || (a.mode === 'rest' && b.mode === 'rest') || !overlap(a, b)) continue;
      const closing = (b.vx - a.vx) * sign(cx(b) - cx(a)) < 0;
      if (!closing) continue;
      const [mover, target] = a.mode === 'roll' ? [a, b] : [b, a];
      if (target.mode === 'rest') {
        const dir = sign(mover.vx);
        launch(s, target, dir, mover.chain, emit);
        target.vx = mover.vx;
        mover.vx = 0;
        mover.mode = 'rest';
        mover.life = RULES.ballRest;
      } else [a.vx, b.vx] = [b.vx, a.vx];
    }
  }
}

function ballContacts(s, emit) {
  for (const b of s.balls) {
    if (b.dead || b.mode !== 'roll') continue;
    // A hero is a solid bumper: a ball rolling into one bounces off it (and counts the bounce).
    for (const h of players(s)) {
      const vertical = Math.min(h.y + h.h, b.y + b.h) - Math.max(h.y, b.y);
      if (vertical < 6 || !overlap(b, h) || sign(cx(h) - cx(b)) !== sign(b.vx)) continue;
      b.vx = -b.vx * RULES.ballKeep;
      b.x = b.vx > 0 ? h.x + h.w : h.x - b.w;
      b.bounces++;
      learn(s, 'bounce');
      // pinned between a hero and a wall there is no room left: the ball breaks instead of sinking in
      if (b.bounces >= RULES.ballBounces || inWall(s.grid, b)) shatter(s, b, emit);
      break;
    }
    if (b.dead) continue;
    for (const e of s.enemies) {
      if (!e.dead && overlap(shrink(b, 1), e)) {
        e.dead = true;
        defeatFoe(s, e, b.chain, cx(e), cy(e), emit);
      }
    }
    const boss = s.boss;
    if (boss && !b.dead && boss.state !== 'dying' && overlap(shrink(b, 1), boss))
      bossStruck(s, boss, b, emit);
  }
}

// ---------------------------------------------------------------------------------------------
// Hazards, pickups, the pursuer
// ---------------------------------------------------------------------------------------------

function hazardTick(s) {
  for (const z of s.hz) {
    z.life -= STEP;
    if (z.kind === 'wave') {
      if (sweepX(s.grid, z, z.vx * STEP) || z.life <= 0) z.dead = true;
      continue;
    }
    if (z.g) {
      const vy1 = z.vy + z.g * STEP;
      z.y += ((z.vy + vy1) / 2) * STEP;
      z.vy = vy1;
    } else z.y += z.vy * STEP;
    z.x += z.vx * STEP;
    const ch = tileAt(s.grid, Math.floor((z.x + z.w / 2) / T), Math.floor((z.y + z.h - TOP) / T));
    const solid = ch === SOLID || ch === VENT || (ch === PLANK && z.vy > 0 && z.y + z.h - TOP > 0);
    if (z.life <= 0 || solid || z.y > FIELD_BOTTOM || z.x < 0 || z.x > 480) z.dead = true;
  }
}

function pickupTick(s) {
  for (const p of s.pickups) {
    p.life -= STEP;
    if (p.life <= 0) p.dead = true;
    const vy1 = Math.min(RULES.maxFall, p.vy + RULES.gravity * STEP);
    const hit = sweepY(s.grid, p, ((p.vy + vy1) / 2) * STEP);
    p.vy = hit !== 0 ? 0 : vy1;
    if (p.y > FIELD_BOTTOM) p.dead = true;
  }
}

function collect(s, p, h, emit) {
  p.dead = true;
  s.stats.pickups++;
  learn(s, 'pickup');
  emit('coin');
  if (p.kind === 'letter') {
    addScore(s, 150, emit);
    pop(s, p.x, p.y, p.letter);
    if (++s.letters >= LETTERS.length) {
      s.letters = 0;
      giveLife(s, h, emit);
    }
    return;
  }
  if (!p.power) {
    addScore(s, p.value, emit);
    pop(s, p.x, p.y, `${p.value}`);
    return;
  }
  addScore(s, 100, emit);
  h.power[p.kind] = p.kind === 'shield' ? RULES.shieldTime : RULES.powerTime;
  pop(s, p.x, p.y, POWER_INFO[p.kind].name);
  if (!s.seenPower[p.kind]) {
    s.seenPower[p.kind] = true;
    say(s, POWER_INFO[p.kind].en, POWER_INFO[p.kind].zh, 4);
  }
}

export const hurryAt = (s) => FLOORS[s.floor].hurry;

function hurryTick(s) {
  const at = hurryAt(s);
  if (!at || s.boss) return;
  if (s.floorTime >= at + RULES.hurryWarn) {
    if (!s.wraith) {
      const h = nearest(s, s.hero);
      s.wraith = { x: cx(h) > 240 ? 10 : 448, y: TOP + 4, w: 22, h: 22, recoil: 0 };
      s.hurryState = 'chase';
      learn(s, 'wraith');
    }
  } else if (s.floorTime >= at) s.hurryState = 'warn';
  const w = s.wraith;
  if (!w) return;
  const h = nearest(s, w);
  w.recoil = Math.max(0, w.recoil - STEP);
  const dx = cx(h) - cx(w);
  const dy = cy(h) - cy(w);
  const d = Math.hypot(dx, dy) || 1;
  const v = RULES.wraithSpeed * (w.recoil > 0 ? -1 : 1) * STEP;
  w.x = Math.max(0, Math.min(480 - w.w, w.x + (dx / d) * v));
  w.y = Math.max(TOP, Math.min(FIELD_BOTTOM - w.h, w.y + (dy / d) * v));
}

// ---------------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------------

function shotTick(s, emit) {
  for (const sh of s.shots) {
    const x0 = sh.x;
    const box = rectOf(sh);
    const blocked = sweepX(s.grid, box, sh.vx * STEP, true);
    const reach = sweptBox(x0, box.x, sh.y, sh.w, sh.h);
    const dir = sign(sh.vx);
    let best = null;
    let bestAt = Infinity;
    const consider = (target, kind) => {
      if (target.dead || !overlap(reach, target)) return;
      const at = (dir > 0 ? target.x - x0 : x0 - (target.x + target.w)) || 0;
      if (at < bestAt) [best, bestAt] = [{ target, kind }, at];
    };
    for (const e of s.enemies) consider(e, 'foe');
    for (const b of s.balls) if (b.mode === 'rest') consider(b, 'ball');
    for (const z of s.hz) if (z.kind === 'ember') consider(z, 'ember');
    if (s.boss && s.boss.state !== 'dying') consider(s.boss, 'boss');
    sh.life -= STEP;
    if (best) {
      sh.dead = true;
      const t = best.target;
      if (best.kind === 'foe') snowHit(s, t, sh.gain, emit);
      else if (best.kind === 'ball') t.life = RULES.ballRest;
      else if (best.kind === 'ember') {
        t.dead = true;
        addScore(s, 20, emit);
        burst(s, cx(t), cy(t), '#8fd8ff', 4);
      } else t.flash = 0.12;
    } else if (blocked || sh.life <= 0) {
      sh.dead = true;
      burst(s, box.x, sh.y, '#e8f6ff', 3);
    } else sh.x = box.x;
  }
}

// ---------------------------------------------------------------------------------------------
// Bosses. Only rolling snowballs hurt them (1 per hit, then BOSS_HIT_GAP of immunity); shots only
// make them flash. Each boss has three phases by remaining health and telegraphs every attack.
// ---------------------------------------------------------------------------------------------

const ANCHORS = [3.5 * T, 9.5 * T, 16.5 * T]; // the Furnace Queen's three spots
const WYRM_LANE = TOP + 8;
const phaseOf = (b) => (b.hp > (b.hpMax * 2) / 3 ? 1 : b.hp > b.hpMax / 3 ? 2 : 3);

function makeBoss(s, kind, at) {
  const d = BOSSES[kind];
  const bottom = TOP + (at.r + 1) * T;
  return {
    kind,
    x: at.c * T + T / 2 - d.w / 2,
    y: kind === 'wyrm' ? WYRM_LANE : bottom - d.h,
    w: d.w,
    h: d.h,
    vx: 0,
    vy: 0,
    dir: -1,
    hp: d.hp,
    hpMax: d.hp,
    phase: 1,
    state: kind === 'queen' ? 'idle' : kind === 'wyrm' ? 'sweep' : 'walk',
    timer: 0,
    cd: 4,
    spawnT: 2,
    invuln: 0,
    flash: 0,
    grounded: false,
    beam: false,
    n: 0,
    anchor: 1,
  };
}

const minionCount = (s) =>
  s.enemies.filter((e) => e.minion && !e.dead).length +
  s.balls.filter((b) => b.occupant?.minion && !b.dead).length +
  s.marks.filter((m) => m.kind === 'vent').length;

// Minions drop from the vent on the side away from the hero, so they never land on top of them.
const farVent = (s) => {
  const list = players(s);
  const mean = list.reduce((a, h) => a + cx(h), 0) / Math.max(1, list.length);
  return mean < 240 ? 17.5 * T : 2.5 * T;
};

function queueMinion(s, kind, x) {
  s.marks.push({ kind: 'vent', x, w: 24, left: SPAWN_WARN, foe: kind });
}

function marksTick(s) {
  for (const m of s.marks) {
    m.left -= STEP;
    if (m.left > 0) continue;
    m.dead = true;
    if (m.kind === 'vent') s.enemies.push(makeFoe(s, m.foe, m.x, TOP + 30, { minion: true }));
    else if (m.kind === 'rain')
      s.hz.push({
        kind: 'ember',
        x: m.x - 6,
        y: TOP,
        w: 12,
        h: 20,
        vx: 0,
        vy: 260,
        g: 0,
        life: 2.5,
      });
  }
  s.marks = s.marks.filter((m) => !m.dead);
}

function bossStruck(s, boss, b, emit) {
  const dir = sign(cx(b) - cx(boss)) || 1;
  b.vx = dir * Math.abs(b.vx) * RULES.ballKeep;
  b.x = dir > 0 ? boss.x + boss.w : boss.x - b.w;
  if (inWall(s.grid, b)) b.bounces = RULES.ballBounces - 1;
  b.bounces++;
  if (b.bounces >= RULES.ballBounces) shatter(s, b, emit);
  if (boss.invuln > 0) return;
  boss.hp--;
  boss.invuln = BOSS_HIT_GAP;
  boss.flash = 0.4;
  addScore(s, 500, emit);
  pop(s, cx(boss), boss.y, '500');
  burst(s, cx(boss), cy(boss), '#fff2a8', 8);
  emit('hit');
  if (boss.hp <= 0) {
    boss.state = 'dying';
    boss.timer = 1.4;
    s.hz = [];
    s.marks = [];
    for (const e of s.enemies) e.dead = true;
    for (const x of s.balls) if (x.occupant) x.dead = true;
    return;
  }
  boss.state = 'hurt';
  boss.timer = 1.0;
  boss.beam = false;
  const phase = phaseOf(boss);
  if (phase !== boss.phase) {
    boss.phase = phase;
    say(s, `${BOSSES[boss.kind].name.en} is angry!`, `${BOSSES[boss.kind].name.zh}发怒了！`);
  }
}

function golemTick(s, b) {
  const spd = [30, 42, 56][b.phase - 1];
  b.timer -= STEP;
  if (b.state === 'walk') {
    if (b.grounded && !hasFloorAhead(s, b)) b.dir = -b.dir;
    b.vx = b.dir * spd;
    if (ballBlocks(s, b, b.vx * STEP)) b.dir = -b.dir;
    else if (sweepX(s.grid, b, b.vx * STEP)) b.dir = -b.dir;
    b.cd -= STEP;
    if (b.cd <= 0) [b.state, b.timer] = ['windup', 1.2];
  } else if (b.timer <= 0) {
    if (b.state === 'windup') {
      const base = b.y + b.h - 12;
      for (const d of [-1, 1])
        s.hz.push({
          kind: 'wave',
          x: cx(b) - 7 + d * 24,
          y: base,
          w: 14,
          h: 12,
          vx: d * (b.phase === 3 ? 90 : 80),
          vy: 0,
          life: 6,
        });
      [b.state, b.timer] = ['rest', 0.6];
    } else {
      b.state = 'walk';
      b.cd = [4.4, 3.6, 2.8][b.phase - 1];
    }
  }
  fall(s, b);
  b.spawnT -= STEP;
  if (b.spawnT <= 0 && minionCount(s) < MINION_CAP) {
    queueMinion(s, 'walker', farVent(s));
    b.spawnT = [7, 6, 5][b.phase - 1];
  }
}

function wyrmTick(s, b) {
  const spd = [70, 90, 110][b.phase - 1];
  b.timer -= STEP;
  b.spawnT -= STEP;
  if (b.spawnT <= 0 && minionCount(s) < 1) {
    queueMinion(s, 'walker', farVent(s));
    b.spawnT = 5;
  }
  const hero = nearest(s, b);
  if (b.state === 'sweep') {
    b.vx = b.dir * spd;
    if (sweepX(s.grid, b, b.vx * STEP)) b.dir = -b.dir;
    sweepY(s.grid, b, WYRM_LANE - b.y, { plank: false });
    b.cd -= STEP;
    if (b.cd <= 0) [b.state, b.timer, b.beam] = ['mark', 1.9, false];
  } else if (b.state === 'mark') {
    if (b.timer > 0.7) {
      // It dives at a hero standing on the floor; a hero sheltering on a plank is ignored and the
      // dive lands on the far side of the arena instead.
      const onFloor = hero.y + hero.h >= FIELD_BOTTOM - T - 1;
      const target = onFloor ? cx(hero) : cx(hero) < 240 ? 360 : 120;
      sweepX(s.grid, b, Math.max(-70 * STEP, Math.min(70 * STEP, target - cx(b))));
    } else b.beam = true;
    if (b.timer <= 0) [b.state, b.vy] = ['dive', 380];
  } else if (b.state === 'dive') {
    if (sweepY(s.grid, b, b.vy * STEP, { plank: false }) > 0) {
      [b.state, b.timer, b.beam] = ['dazed', [6.5, 6, 5.5][b.phase - 1], false];
      burst(s, cx(b), b.y + b.h, '#ffd35a', 8);
    }
  } else if (b.state === 'dazed' || b.state === 'hurt') {
    if (b.timer <= 0) b.state = 'rise';
  } else if (b.state === 'rise') {
    sweepY(s.grid, b, -120 * STEP, { plank: false });
    if (b.y <= WYRM_LANE + 0.5) {
      b.state = 'sweep';
      b.cd = [4, 3.2, 2.4][b.phase - 1];
    }
  }
}

function queenTick(s, b) {
  b.timer -= STEP;
  if (b.state === 'idle') {
    b.cd -= STEP;
    if (b.cd > 0) return;
    b.n++;
    const cap = MINION_CAP + (b.phase > 2 ? 1 : 0);
    if (b.n % 2 === 1 && minionCount(s) < cap) {
      queueMinion(s, 'jumper', farVent(s));
      b.cd = 1.6;
      return;
    }
    const offsets = b.phase === 1 ? [0, 70] : b.phase === 2 ? [0, 80] : [-80, 0, 80];
    for (const hero of players(s)) {
      for (const o of offsets) {
        const x = Math.max(30, Math.min(450, cx(hero) + o));
        if (s.marks.some((m) => m.kind === 'rain' && Math.abs(m.x - x) < 8)) continue;
        s.marks.push({ kind: 'rain', x, w: 16, left: 2.4, y: surfaceBelow(s, x) });
      }
    }
    [b.state, b.timer] = ['flare', 2.4];
  } else if (b.timer <= 0) {
    if (b.state === 'flare') [b.state, b.cd] = ['idle', [4.0, 3.4, 2.8][b.phase - 1]];
    else if (b.state === 'hurt') [b.state, b.timer] = ['vanish', 0.4];
    else if (b.state === 'vanish') {
      const next = (b.anchor + 1 + Math.floor(s.rng() * 2)) % ANCHORS.length;
      b.anchor = next;
      b.x = ANCHORS[next] - b.w / 2;
      [b.state, b.timer] = ['appear', 0.5];
    } else if (b.state === 'appear') [b.state, b.cd] = ['idle', 1.4];
  }
}

// First solid or plank surface below the top of the screen at x (where a falling ember stops).
function surfaceBelow(s, x) {
  const c = Math.floor(x / T);
  for (let r = 0; r < ROWS; r++) if (tileAt(s.grid, c, r) !== '.') return TOP + r * T;
  return FIELD_BOTTOM;
}

function bossTick(s) {
  const b = s.boss;
  b.invuln = Math.max(0, b.invuln - STEP);
  b.flash = Math.max(0, b.flash - STEP);
  if (b.state === 'dying') {
    b.timer -= STEP;
    return;
  }
  if (b.kind === 'golem') golemTick(s, b);
  else if (b.kind === 'wyrm') wyrmTick(s, b);
  else queenTick(s, b);
}

export const bossHarms = (b) =>
  !['dazed', 'hurt', 'dying', 'vanish', 'appear', 'rise'].includes(b.state);

// ---------------------------------------------------------------------------------------------
// Damage, clearing, the tick
// ---------------------------------------------------------------------------------------------

function finish(s, phase, cause, emit) {
  s.phase = phase;
  s.cause = cause;
  emit(phase === 'won' ? 'win' : 'lose');
}

function respawn(s, h) {
  const fresh = makeHero(s.start, h.idx);
  const next = { ...fresh, invuln: RULES.invuln, face: h.face };
  if (h.idx) s.hero2 = next;
  else s.hero = next;
  s.shots = s.shots.filter((q) => q.owner !== h.idx);
}

function hurtHero(s, h, emit) {
  if (h.invuln > 0 || h.power.shield > 0) return false;
  s[livesKey(h)]--;
  s.stats.hurt++;
  emit('hit');
  if (s[livesKey(h)] <= 0) {
    h.out = true;
    if (!players(s).length) {
      finish(s, 'lost', 'lives', emit);
      return true;
    }
    say(s, `Out: P${h.idx + 1}`, `P${h.idx + 1} 出局`);
    return true;
  }
  respawn(s, h);
  say(s, 'Ouch! Back to the start.', '哎呀！回到起点。');
  return true;
}

function contacts(s, emit) {
  if (s.intro > 0) return;
  for (const h of players(s)) {
    if (s.phase !== 'playing') return;
    const box = shrink(h, HURT_MARGIN);
    let hit =
      s.enemies.some((e) => !e.dead && overlap(box, shrink(e, 2))) ||
      s.hz.some((z) => !z.dead && overlap(box, z)) ||
      (s.boss && bossHarms(s.boss) && overlap(box, shrink(s.boss, 4)));
    if (s.wraith && overlap(box, shrink(s.wraith, 3))) {
      s.wraith.recoil = RULES.wraithRecoil;
      hit = true;
    }
    if (hit && hurtHero(s, h, emit)) continue;
    const now = h.idx ? s.hero2 : s.hero;
    for (const p of s.pickups) if (!p.dead && overlap(now, p)) collect(s, p, now, emit);
  }
}

const foesLeft = (s) =>
  s.enemies.filter((e) => !e.dead).length +
  s.balls.filter((b) => !b.dead && b.occupant).length +
  s.marks.filter((m) => m.kind === 'vent').length;

function clearFloor(s, emit) {
  const chain = s.lastChain;
  let bonus = 500;
  if (chain >= 3) {
    bonus += 500 * (chain - 2);
    s.stats.chainClears++;
  }
  addScore(s, bonus, emit);
  for (const p of s.pickups) if (!p.dead) collect(s, p, players(s)[0] ?? s.hero, emit);
  s.pickups = [];
  s.wraith = null;
  s.hz = [];
  s.marks = [];
  s.clear = Math.round(RULES.clearTime / STEP);
  setPrompt(s, true);
  s.unlockTo = Math.min(FLOORS.length, s.floor + 2);
  say(
    s,
    chain >= 3 ? `Floor clear! Chain x${chain} bonus ${bonus}` : `Floor clear! Bonus ${bonus}`,
    chain >= 3 ? `过关！连锁x${chain} 奖励${bonus}` : `过关！奖励${bonus}`,
    RULES.clearTime,
  );
  emit('coin');
}

function tickFx(s) {
  for (const f of s.fx) {
    f.left -= STEP;
    f.x += f.vx * STEP;
    f.y += f.vy * STEP;
    f.vy += 400 * STEP;
  }
  s.fx = s.fx.filter((f) => f.left > 0);
  for (const p of s.pops) {
    p.left -= STEP;
    p.y -= 20 * STEP;
  }
  s.pops = s.pops.filter((p) => p.left > 0);
}

function sweepDead(s) {
  s.enemies = s.enemies.filter((e) => !e.dead);
  s.balls = s.balls.filter((b) => !b.dead);
  s.shots = s.shots.filter((x) => !x.dead);
  s.hz = s.hz.filter((z) => !z.dead);
  s.pickups = s.pickups.filter((p) => !p.dead);
}

function tick(s, ctl, emit) {
  s.ticks++;
  if (s.msg && --s.msg.left <= 0) s.msg = null;
  tickFx(s);
  if (s.clear > 0) {
    for (const h of [s.hero, s.hero2]) if (h) h.pj = h.pt = false;
    if (--s.clear === 0) loadFloor(s, s.floor + 1);
    else setPrompt(s);
    return;
  }
  for (const h of players(s)) {
    heroTick(s, h, ctl[h.idx], emit);
    pushBalls(s, h, ctl[h.idx], emit);
  }
  shotTick(s, emit);
  const live = s.intro <= 0;
  if (!live) s.intro -= STEP;
  else {
    s.floorTime += STEP;
    hurryTick(s);
    for (const e of s.enemies) if (!e.dead) foeTick(s, e);
    if (s.boss) bossTick(s);
    marksTick(s);
    hazardTick(s);
  }
  for (const b of s.balls) if (!b.dead) ballTick(s, b, emit);
  ballPairs(s, emit);
  ballContacts(s, emit);
  for (const e of s.enemies) if (e.dead) e.vx = 0;
  pickupTick(s);
  contacts(s, emit);
  sweepDead(s);
  if (s.phase !== 'playing') return;
  if (s.boss) {
    if (s.boss.state === 'dying' && s.boss.timer <= 0) {
      if (s.floor === FLOORS.length - 1) {
        addScore(s, BOSS_SCORE + (s.lives + s.lives2) * 1000, emit);
        finish(s, 'won', null, emit);
      } else {
        s.boss = null;
        clearFloor(s, emit);
      }
    }
  } else if (s.intro <= 0 && foesLeft(s) === 0) clearFloor(s, emit);
  setPrompt(s);
}

const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['ArrowUp', 'KeyW', 'Space'],
  down: ['ArrowDown', 'KeyS'],
  throw: ['KeyX', 'KeyJ'],
};
// Two players share the keyboard: P1 on WASD + F, P2 on the arrows + comma. Neither set leaks.
const COOP_KEYS = [
  { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW'], down: ['KeyS'], throw: ['KeyF', 'KeyG'] },
  {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    jump: ['ArrowUp'],
    down: ['ArrowDown'],
    throw: ['Comma', 'Period'],
  },
];
const axis = (input, neg, pos) => Number(input.held(...pos)) - Number(input.held(...neg));

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.menu) {
    menuStep(s, dt, input, emit);
    return true;
  }
  const keys = s.coop ? COOP_KEYS : [SOLO_KEYS];
  const ctl = keys.map((k, i) => {
    const h = i ? s.hero2 : s.hero;
    if (h && input.pressed(...k.jump)) h.pj = true;
    if (h && input.pressed(...k.throw)) h.pt = true;
    return {
      dir: axis(input, k.left, k.right),
      jump: input.held(...k.jump),
      down: input.held(...k.down),
      throwHeld: input.held(...k.throw),
    };
  });
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, ctl, emit);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Floor select
// ---------------------------------------------------------------------------------------------

const MENU = { cols: 6, w: 68, h: 40, gap: 8, x0: 16, y0: 38 };
export const menuCell = (n) => {
  const i = n - 1;
  return {
    x: MENU.x0 + (i % MENU.cols) * (MENU.w + MENU.gap),
    y: MENU.y0 + Math.floor(i / MENU.cols) * (MENU.h + MENU.gap),
    w: MENU.w,
    h: MENU.h,
  };
};
const menuHit = (pointer) =>
  FLOORS.findIndex((_, i) => {
    const q = menuCell(i + 1);
    return pointer.x >= q.x && pointer.x < q.x + q.w && pointer.y >= q.y && pointer.y < q.y + q.h;
  }) + 1;

// The select screen only opens when there is something to choose: more than floor 1 is open.
export function openMenu(s, unlocked) {
  s.menu = { cursor: unlocked, unlocked };
  s.msg = null;
  setPrompt(s, true);
}

function menuStep(s, dt, input, emit) {
  const m = s.menu;
  s.menuClock += dt;
  if (s.msg && (s.msg.left -= dt / STEP) <= 0) s.msg = null;
  const was = m.cursor;
  const pick = (neg, pos, size) =>
    Number(input.pressed(...pos)) * size - Number(input.pressed(...neg)) * size;
  const move =
    pick(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD'], 1) +
    pick(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS'], MENU.cols);
  m.cursor = Math.max(1, Math.min(m.unlocked, m.cursor + move));
  if (m.cursor !== was) emit('move');
  const tapped = input.pointer?.clicked ? menuHit(input.pointer) : 0;
  if (tapped > m.unlocked) {
    emit('hit');
    say(s, `Clear floor ${m.unlocked} first.`, `先通关第${m.unlocked}层。`);
  } else if (tapped) m.cursor = tapped;
  if (tapped <= m.unlocked && (tapped || input.pressed('Space', 'Enter', 'NumpadEnter'))) {
    loadFloor(s, m.cursor - 1);
    s.menu = null;
    setPrompt(s, true);
    emit('move');
  }
}

// ---------------------------------------------------------------------------------------------
// Prompts: one short line that names the keys for the thing to do next.
// ---------------------------------------------------------------------------------------------

export const PROMPTS = freeze({
  menu: ['Arrows + Space, or tap a floor to start', '方向键+空格，或直接点按楼层开始'],
  cleared: ['Floor clear! Next floor soon', '过关！即将进入下一层'],
  warn: ['Hurry! Ember Wraith in {n}s', '快！余烬幽灵{n}秒后出现'],
  chase: ['Wraith hunts you: finish or run', '幽灵在追你：快通关或躲开'],
  wobble: ['Snowball wobbling: walk into it!', '雪球在晃动：快走过去推它！'],
  stunned: ['Wyrm stunned: roll a ball into it', '飞蛇晕了：推雪球撞它'],
  mark: ['Wyrm dives soon: run sideways!', '飞蛇要俯冲：快向旁边跑！'],
  windup: ['Golem stomps: climb or jump waves', '巨像要跺地：爬上去或跳过冲击波'],
  rain: ['Fire falls on marked columns: dodge', '标记的列会落火：快躲开'],
  jump: ['{jump}: jump up through planks', '{jump}：从木板下跳上去'],
  throw: ['{throw}: throw snow, 4 hits = snowball', '{throw}：投雪，命中4次成雪球'],
  ball: ['Walk into a snowball to roll it', '走向雪球就能把它推走'],
  drop: ['Down + Jump: drop through a plank', '按下 + 跳跃：穿过木板下落'],
  wall: ['Rolling balls bounce, then break on the 4th hit', '滚动的雪球会反弹，第4次撞击时碎裂'],
  chain: ['Roll a ball into a ball for chains', '让雪球撞雪球可连锁加分'],
  hopper: ['Hoppers crouch first: snow them then', '跳蛙起跳前会蹲下：趁机投雪'],
  moth: ['Moths bob in a lane: throw when level', '蛾子上下飘：对齐时投雪'],
  imp: ['Imps raise an arm before lobbing fire', '小鬼抛火前会举手：快躲开'],
  pickup: ['Grab fruit and power-ups they drop', '拾取敌人掉落的水果和道具'],
  hurry: ['Linger and the Ember Wraith comes', '磨蹭的话余烬幽灵会来'],
  vent: ['Vents drop snowballs out of the floor', '格栅会让雪球掉出地板'],
  golem: ['Roll its minions into the Kiln Golem', '把小怪做成雪球撞向窑炉巨像'],
  wyrm: ['Roll a ball into the Wyrm when stunned', '飞蛇晕倒时用雪球撞它'],
  queen: ['Dodge the fire, roll balls at the Queen', '躲开火雨，用雪球撞女王'],
  finish: ['Keep throwing {dir} before the snow thaws!', '趁雪没融化继续朝{dir}投雪！'],
  keep: ['Hold the ball: snow it until the Wyrm falls', '先别推：给雪球补雪，等飞蛇晕倒'],
  push: ['Walk {dir} into the snowball to roll it', '朝{dir}走进雪球就能把它推走'],
  seek: ['Face {dir} and throw: {throw}', '朝{dir}投雪：{throw}'],
  goUnder: ["Walk {dir} under the foe's plank: A D", '朝{dir}走到敌人所在木板的下方：A D'],
  overhead: ['Foe overhead: step {dir} first', '头顶有敌人：先往{dir}挪'],
  blocked: ['Wall toward {dir}: jump over, then throw', '{dir}侧有墙：先跳过去再投雪'],
  stepOff: ['Walk off {dir} toward the foe', '朝{dir}走下去，靠近敌人'],
  waitWalk: ['Wait for it to walk away, then jump', '等它走开再跳'],
  back: ['Too close: step {dir} back, then throw: {throw}', '太近了：向{dir}后退再投雪：{throw}'],
  approach: ['Walk {dir} to the foe, then throw: {throw}', '朝{dir}走近敌人再投雪：{throw}'],
  fruit: ['Grab the fruit and power-ups', '拾取水果和道具'],
  dodge: ['Fire coming: step {dir} away', '火球来了：向{dir}躲开'],
  air: ['Land first, then read the next hint', '先落地，再看下一条提示'],
});

// Ideas stop being shown once the player has done the thing (or after IDEA_SECONDS).
const IDEA_EVENT = {
  jump: 'jump',
  throw: 'throw',
  ball: 'push',
  drop: 'drop',
  wall: 'bounce',
  chain: 'chain',
  pickup: 'pickup',
};
const IDEA_SECONDS = { pickup: 4 };
const IDEA_DEFAULT = 6;

// The plank row whose underside the hero could still jump through from here (or -1).
function plankAbove(s, h) {
  const feet = h.y + h.h;
  const top = Math.floor((h.y - TOP) / T);
  for (const x of [cx(h), h.x + 2, h.x + h.w - 2]) {
    const c = Math.floor(x / T);
    for (let r = top; r >= Math.max(0, top - 4); r--) {
      const surface = TOP + r * T;
      if (tileAt(s.grid, c, r) === PLANK && surface < h.y && feet - surface <= 84) return r;
    }
  }
  return -1;
}

// Seconds of waiting before the advice escalates to walking away or jumping from a clear end.
const WAIT_ESCALATE = 2;
const ENDS_JUMP_GAP = 44;
const WALKER_ENDS_GAP = 100;
// A jumper mid-hop above its plank still counts as standing on it.
const HOP_REACH = 70;
// A flyer bobbing this close to a plank's height is in the way of a jump up through it.
const FLYER_BAND = 40;
const DODGE_ROOM = 40;
const WAIT_HOLD = 0.6;

// How far a foe on the level below must be from the drop point before dropping is shown as safe.
const DROP_CLEAR = 80;
const DROP_CLEAR_STUCK = 40;
// A hopper that is crouching or in mid-hop can cover this much extra ground in a moment.
const LEAP_EXTRA = 50;
const RUN_INSET = 12;
const OVERHEAD_ROOM = 34;
const leaping = (e) => e.kind === 'jumper' && ['crouch', 'air'].includes(e.state);

// True when a walker on a lower level is about to pass the edge the hero would step off.
function dropSpotBusy(foes, s, h, feet, dir, clear = DROP_CLEAR) {
  const row = Math.floor((feet - TOP) / T);
  let edge = cx(h);
  while (edge > 0 && edge < 480 && '#=v'.includes(tileAt(s.grid, Math.floor(edge / T), row)))
    edge += 6 * dir;
  return foes.some((e) => e.y + e.h - feet > 14 && Math.abs(cx(e) - edge) < clear);
}

// Step-by-step advice toward the nearest enemy that can actually be reached from where the hero is.
function guide(s, foes = s.enemies) {
  const live = players(s)[0] ?? s.hero;
  // Advice is given from where the hero last stood, so a jump in progress does not flip the prompt.
  const h = { x: live.x, y: live.restFeet - live.h, w: live.w, h: live.h };
  const feet = live.restFeet;
  const cost = (e) => Math.abs(cx(e) - cx(h)) + 2 * Math.abs(e.y + e.h - feet);
  const best = [...foes].sort((p, q) => cost(p) - cost(q))[0];
  // Keep advising about the same foe unless another is clearly nearer, so the prompt cannot flip-flop.
  const kept = foes.find((e) => e.id === s.guideFoe);
  const foe = kept && best && cost(kept) <= cost(best) * 1.4 + 24 ? kept : best;
  s.guideFoe = foe ? foe.id : null;
  s.guideDir = foe ? sign(cx(foe) - cx(h)) || 1 : 1;
  if (!foe) return 'seek';
  const dy = foe.y + foe.h - feet;
  const flyer = foe.kind === 'flyer';
  // A hopper turns toward the hero only when it jumps, so it always counts as coming.
  const coming = (e) => sign(e.dir) === sign(cx(h) - cx(e));
  const onPlankHere = tileAt(s.grid, Math.floor(cx(h) / T), Math.floor((feet - TOP) / T)) === PLANK;
  if (Math.abs(dy) <= 14 || (flyer && Math.abs(cy(foe) - cy(h)) < 28)) {
    const gap = Math.abs(cx(foe) - cx(h));
    const behind = cx(h) - 64 * sign(cx(foe) - cx(h));
    const room = '#=v'.includes(
      tileAt(s.grid, Math.floor(behind / T), Math.floor((feet - TOP) / T)),
    );
    let clear = room;
    for (let x = cx(h); clear && Math.abs(x - behind) > 12; x -= 12 * sign(cx(foe) - cx(h)))
      for (let rr = Math.floor((h.y - TOP) / T); rr <= Math.floor((feet - TOP - 1) / T); rr++)
        if ('#v'.includes(tileAt(s.grid, Math.floor(x / T), rr))) clear = false;
    // A wall at body height between hero and foe stops both walking and shots.
    const e0 = foe;
    const bodyTop = Math.floor((h.y - TOP) / T);
    const bodyBottom = Math.floor((feet - TOP - 1) / T);
    for (let x = cx(h); Math.abs(x - cx(foe)) > 12 && !flyer; x += 12 * sign(cx(foe) - cx(h)))
      for (let rr = bodyTop; rr <= bodyBottom; rr++)
        if ('#v'.includes(tileAt(s.grid, Math.floor(x / T), rr))) {
          // Hop over only when the foe is distant and not waiting right where the hero would land.
          const side = sign(cx(foe) - cx(h));
          const landing = (Math.floor(x / T) + (side > 0 ? 1 : 0)) * T;
          return gap >= 130 && Math.abs(cx(foe) - landing) >= 72 ? 'blocked' : 'waitWalk';
        }
    const pinned = foes.some(
      (e) =>
        e !== foe &&
        Math.abs(e.y + e.h - feet) <= 14 &&
        Math.abs(cx(e) - cx(h)) < 120 &&
        sign(cx(e) - cx(h)) !== sign(cx(foe) - cx(h)),
    );
    // Dropping off a plank to get away from an imp or a hopper only trades one problem for another.
    const keepsDistance = foe.kind === 'thrower' || foe.kind === 'jumper';
    if (gap < 66 && (coming(foe) || gap < 36) && !flyer && clear && !pinned) {
      s.guideDir = -s.guideDir;
      return 'back';
    }
    if (gap < 66 && coming(foe) && !flyer && !keepsDistance && !clear && !pinned && onPlankHere)
      return 'drop';
    if (gap <= 130) return 'seek';
    // Only send the player along a surface that actually reaches the foe; otherwise step down.
    const row = Math.floor((feet - TOP) / T);
    const way = sign(cx(foe) - cx(h));
    for (let x = cx(h); Math.abs(x - cx(foe)) > 12; x += 12 * way)
      if (!'#=v'.includes(tileAt(s.grid, Math.floor(x / T), row))) {
        // A gap in the way: walk up to its edge when the foe is then within throwing range.
        const edge = x - 12 * way;
        if (Math.abs(edge - cx(h)) > 12 && Math.abs(cx(foe) - edge) <= 130) return 'approach';
        return onPlankHere ? 'drop' : 'stepOff';
      }
    return 'approach';
  }
  if (!flyer) {
    // A wall at body height between hero and the foe's column blocks the walk to its plank too.
    const bt = Math.floor((h.y - TOP) / T);
    const bb = Math.floor((feet - TOP - 1) / T);
    for (let x = cx(h); Math.abs(x - cx(foe)) > 12; x += 12 * sign(cx(foe) - cx(h)))
      for (let rr = bt; rr <= bb; rr++)
        if ('#v'.includes(tileAt(s.grid, Math.floor(x / T), rr))) return 'blocked';
  }
  // After a long wait the drop is allowed with less room, so a patrol under it cannot hold the hero forever.
  const dropClear = (s.waitTime ?? 0) >= WAIT_ESCALATE ? DROP_CLEAR_STUCK : DROP_CLEAR;
  if (dy > 14) {
    const below = (x) => foes.some((e) => e.y + e.h - feet > 14 && Math.abs(cx(e) - x) < dropClear);
    if (onPlankHere) return below(cx(h)) ? 'waitWalk' : 'drop';
    // Step off toward the foe when that landing is free, otherwise off the other side.
    const toward = sign(cx(foe) - cx(h)) || 1;
    if (!dropSpotBusy(foes, s, h, feet, toward, dropClear)) return 'stepOff';
    if (!dropSpotBusy(foes, s, h, feet, -toward, dropClear)) {
      s.guideDir = -toward;
      return 'stepOff';
    }
    return 'waitWalk';
  }
  const row = plankAbove(s, h);
  const runOf = (rw, c) => {
    let a = c;
    let b = c;
    while (tileAt(s.grid, a - 1, rw) === PLANK) a--;
    while (tileAt(s.grid, b + 1, rw) === PLANK) b++;
    return [a, b];
  };
  const foeRow = Math.floor((foe.y + foe.h - TOP) / T);
  const foeCol = Math.floor(cx(foe) / T);
  const foeRun = tileAt(s.grid, foeCol, foeRow) === PLANK ? runOf(foeRow, foeCol) : null;
  const waiting = ['overhead', 'waitWalk'].includes(s.prompt.key) && s.prompt.age < 2.5 / STEP;
  if (row < 0) {
    if (waiting && Math.abs(cx(foe) - cx(h)) < 150) return 'waitWalk';
    // No plank is in jump reach here: head for the spot with one that lies closest to the foe.
    let best = null;
    for (let c = 0; c < 20; c++)
      for (let r = 0; r < 10; r++) {
        const rise = feet - (TOP + r * T);
        if (tileAt(s.grid, c, r) === PLANK && rise > 30 && rise <= 84) {
          const d = Math.abs(c * T + T / 2 - cx(foe)) + 1.0 * Math.abs(c * T + T / 2 - cx(h));
          if (best === null || d < best.d) best = { d, x: c * T + T / 2 };
        }
      }
    if (best) s.guideDir = sign(best.x - cx(h)) || s.guideDir;
    return 'goUnder';
  }
  const top = TOP + row * T;
  const myCol = [cx(h), h.x + 2, h.x + h.w - 2]
    .map((x) => Math.floor(x / T))
    .find((c) => tileAt(s.grid, c, row) === PLANK);
  const myRun = runOf(row, myCol);
  // The plank overhead must be the one the foe stands on, not another at the same height.
  if (foeRun && foeRow === row && foeRun[0] !== myRun[0]) return 'goUnder';
  const onPlank = foes.filter(
    (e) =>
      (Math.abs(e.y + e.h - top) < 3 ||
        (e.kind === 'jumper' && top - (e.y + e.h) > 0 && top - (e.y + e.h) < HOP_REACH) ||
        (e.kind === 'flyer' && Math.abs(e.y + e.h - top) < FLYER_BAND)) &&
      Math.floor(cx(e) / T) >= myRun[0] &&
      Math.floor(cx(e) / T) <= myRun[1],
  );
  const gapTo = (e) => Math.abs(cx(e) - cx(h));
  const close = onPlank.filter((e) => gapTo(e) < 56).sort((p, q) => gapTo(p) - gapTo(q))[0];
  // After a long wait the advice changes: walk away toward the far end, or jump from the end.
  const stuck = (s.waitTime ?? 0) >= WAIT_ESCALATE;
  // A thrower standing still never walks away, so waiting for it is pointless.
  const unsafe = onPlank.filter(
    (e) =>
      !(e.kind === 'thrower' && e.vx === 0) &&
      gapTo(e) >= 56 &&
      gapTo(e) < (e.vx !== 0 && coming(e) ? 100 : 60) + (leaping(e) ? LEAP_EXTRA : 0),
  );
  const threat = close ?? unsafe.sort((p, q) => gapTo(p) - gapTo(q))[0];
  // A jump from the very end of a plank run clips its edge: step in a little first.
  const jumpOrStepIn = () => {
    const left = cx(h) - myRun[0] * T;
    const right = (myRun[1] + 1) * T - cx(h);
    if (Math.min(left, right) >= RUN_INSET) return 'jump';
    s.guideDir = left < right ? 1 : -1;
    return 'goUnder';
  };
  if (!threat) return jumpOrStepIn();
  // Step away from the foe while staying under its plank and on solid footing; at the end, wait.
  const away = sign(cx(h) - cx(threat)) || 1;
  const edge = (lo, hi) => (away > 0 ? hi - cx(h) : cx(h) - lo);
  const supportRow = Math.floor((feet - TOP) / T);
  const [sa, sb] = onPlankHere ? runOf(supportRow, Math.floor(cx(h) / T)) : [0, 19];
  const roomIn = (dir) =>
    Math.min(
      dir > 0 ? (myRun[1] + 1) * T - cx(h) : cx(h) - myRun[0] * T,
      dir > 0 ? (sb + 1) * T - cx(h) : cx(h) - sa * T,
    );
  const room = roomIn(away);
  // A walker only paces back and forth, so a jump next to it waits for a wider gap than for other foes.
  const endsGap = threat.kind === 'walker' ? WALKER_ENDS_GAP : ENDS_JUMP_GAP;
  if (close || stuck) {
    // Once the hero has been sent under a motionless foe to the far end, keep going until clear of it.
    if (stuck && s.prompt.key === 'goUnder' && threat.vx === 0 && s.prompt.dir) {
      const way = s.prompt.dir;
      const beyond = (cx(h) - cx(threat)) * way > 0 && gapTo(threat) >= endsGap;
      if (beyond) return jumpOrStepIn();
      if (roomIn(way) >= OVERHEAD_ROOM) {
        s.guideDir = way;
        return 'goUnder';
      }
    }
    if (room >= (s.prompt.key === 'waitWalk' && !stuck ? 56 : OVERHEAD_ROOM)) {
      s.guideDir = away;
      return 'overhead';
    }
    // Cornered at the end of the run: the patrol turns back, so a jump from a clear end is allowed.
    if (threat.kind === 'thrower' && threat.vx === 0)
      return gapTo(threat) >= ENDS_JUMP_GAP ? 'jump' : 'goUnder';
    if (stuck && gapTo(threat) >= endsGap) return jumpOrStepIn();
    if (stuck && threat.vx === 0) {
      // A foe that will not move and no room to step away: go under it to the far end of the run.
      s.guideDir = -away;
      return 'goUnder';
    }
    return 'waitWalk';
  }
  return 'waitWalk';
}

// Where a flying ember will cross height y (null when it never does).
function emberLanding(z, y) {
  const g = z.g || 0;
  const y0 = z.y + z.h / 2;
  let t;
  if (g === 0) t = z.vy > 0 ? (y - y0) / z.vy : -1;
  else {
    const disc = z.vy * z.vy - 2 * g * (y0 - y);
    t = disc < 0 ? -1 : (-z.vy + Math.sqrt(disc)) / g;
  }
  return t < 0 ? null : z.x + z.w / 2 + z.vx * t;
}

function wantPrompt(s) {
  if (s.menu) return 'menu';
  if (s.clear > 0 || s.phase !== 'playing') return 'cleared';
  if (s.hurryState === 'chase') return 'chase';
  if (s.hurryState === 'warn') return 'warn';
  const b = s.boss;
  if (b && b.state !== 'dying') {
    if (b.kind === 'wyrm' && b.state === 'dazed') return 'stunned';
    if (b.kind === 'wyrm' && b.state === 'mark') return 'mark';
    if (b.kind === 'golem' && b.state === 'windup') return 'windup';
    if (b.kind === 'queen' && b.state === 'flare') return 'rain';
  }
  if (s.balls.some((x) => x.mode === 'rest' && x.life < RULES.ballWobble)) return 'wobble';
  const me = players(s)[0] ?? s.hero;
  // Incoming fire: say which way to step. A lob lands where the hero stood when the imp began to
  // wind up, so the warning names a direction that leaves that spot and stays on the platform.
  const hit = (x) => Math.abs(x - cx(me)) < DODGE_ROOM;
  const landings = [
    ...s.hz.filter((z) => z.kind === 'ember').map((z) => emberLanding(z, cy(me))),
  ].filter((x) => x !== null && hit(x));
  if (landings.length) {
    const spot = landings[0];
    const row = Math.floor((me.restFeet - TOP) / T);
    const roomToward = (dir) => {
      let x = cx(me);
      while (x > 0 && x < 480 && '#=v'.includes(tileAt(s.grid, Math.floor((x + 6 * dir) / T), row)))
        x += 6 * dir;
      return Math.abs(x - cx(me));
    };
    const away = sign(cx(me) - spot) || (cx(me) < 240 ? 1 : -1);
    const dir =
      roomToward(away) >= DODGE_ROOM
        ? away
        : roomToward(-away) >= DODGE_ROOM + Math.abs(spot - cx(me))
          ? -away
          : 0;
    if (dir) {
      s.guideDir = dir;
      return 'dodge';
    }
  }
  // Advice is about where the hero stands, so nothing is said while the hero is in the air.
  if (!me.grounded && s.intro <= 0) return 'air';
  const idea = FLOORS[s.floor].idea;
  if (idea === 'wall' && !s.learned.bounce && s.balls.some((x) => x.mode === 'roll')) return 'wall';
  if (idea === 'hurry' && s.hurryState === 'none' && s.floorTime > hurryAt(s) - 12) return 'hurry';
  const limit = IDEA_SECONDS[idea] ?? IDEA_DEFAULT;
  if (idea !== 'free' && s.floorTime < limit && !s.learned[IDEA_EVENT[idea]]) {
    const g = idea === 'jump' || idea === 'throw' ? guide(s) : idea;
    const gd = s.enemies.length ? guide(s) : null;
    if (gd && ['back', 'blocked'].includes(gd)) return gd;
    // Floor ideas wait while a foe on the hero's own level needs dealing with.
    if (gd === 'seek' && idea !== 'jump' && idea !== 'throw') return 'seek';
    if (idea === 'jump' && ['goUnder', 'jump', 'overhead', 'waitWalk'].includes(g)) return g;
    if (idea === 'throw' && g === 'seek') return 'throw';
    if (idea !== 'jump' && idea !== 'throw') return idea;
  }
  const thawing = s.enemies.filter((e) => e.snow > 0 && e.sinceHit < RULES.thawDelay);
  if (thawing.length) {
    if (guide(s) === 'back') return 'back';
    // The arrow points at the snowed foe that is about to thaw, not at the nearest live one.
    const nearest = thawing.sort((p, q) => Math.abs(cx(p) - cx(me)) - Math.abs(cx(q) - cx(me)))[0];
    s.guideDir = sign(cx(nearest) - cx(me)) || 1;
    return 'finish';
  }
  if (b?.kind === 'wyrm' && b.state !== 'dazed' && s.balls.some((x) => x.mode === 'rest'))
    return 'keep';
  const resting = s.balls.filter((x) => x.mode === 'rest');
  if (resting.length) {
    // Pushing only makes sense for a ball on the hero's own level while no foe needs dealing with.
    const near = resting.some((x) => Math.abs(x.y + x.h - me.restFeet) < 16);
    const g = s.enemies.length ? guide(s) : null;
    const pressed = s.enemies.some(
      (e) => Math.abs(e.y + e.h - me.restFeet) <= 14 && Math.abs(cx(e) - cx(me)) <= 130,
    );
    // A ball standing between the hero and the foe soaks up every throw: roll it into the foe.
    const target = s.enemies.find((e) => e.id === s.guideFoe);
    const inTheWay =
      g === 'seek' &&
      target &&
      resting.some(
        (x) =>
          Math.abs(x.y + x.h - me.restFeet) < 16 &&
          (cx(x) - cx(me)) * (cx(x) - cx(target)) < 0 &&
          Math.abs(cx(x) - cx(me)) < Math.abs(cx(target) - cx(me)),
      );
    if (inTheWay) return 'push';
    if (s.enemies.length ? near && !pressed && g !== 'back' && g !== 'seek' : near || b)
      return 'push';
    if (!s.enemies.length && !b) {
      // With no foe left the ball is the target: get to its level first.
      const ball = resting.sort((p, q) => Math.abs(cx(p) - cx(me)) - Math.abs(cx(q) - cx(me)))[0];
      const route = guide(s, [{ ...ball, id: -1, kind: 'ball', vx: 0, dir: 0 }]);
      return ['seek', 'approach', 'back'].includes(route) ? 'push' : route;
    }
  }
  if (s.enemies.length) return guide(s);
  if (s.pickups.length) return 'fruit';
  return b ? FLOORS[s.floor].idea : 'seek';
}

export function setPrompt(s, force = false) {
  const key = wantPrompt(s);
  // Waiting keys build up the wait; a walk toward a better spot does not end a wait that already ran long.
  const waiting = ['waitWalk', 'overhead', 'stepOff'].includes(key);
  const continuing = key === 'goUnder' && (s.waitTime ?? 0) >= WAIT_ESCALATE;
  if (key !== 'air') s.waitTime = waiting || continuing ? (s.waitTime ?? 0) + STEP : 0;
  s.prompt.age++;
  // Landing on a new level changes the situation completely: the old advice is dropped at once.
  const level = (players(s)[0] ?? s.hero).restFeet;
  if (
    key !== s.prompt.key &&
    ['overhead', 'jump'].includes(s.prompt.key) &&
    s.prompt.level !== undefined &&
    s.prompt.level !== level
  )
    force = true;
  // Leaving the ground or landing changes the advice at once, so a late reader never sees a stale jump.
  if (key !== s.prompt.key && (key === 'air' || s.prompt.key === 'air')) force = true;
  if (key === s.prompt.key && !force) {
    // A shown arrow is kept for the hold time, so it cannot flip while a player is walking by it.
    if (
      s.guideDir !== s.prompt.dir &&
      s.prompt.age - s.prompt.dirAt >= Math.round(RULES.promptHold / STEP)
    ) {
      s.prompt.dir = s.guideDir;
      s.prompt.dirAt = s.prompt.age;
    }
    return;
  }
  // A warning to wait stays up a little longer before it may flip back to 'jump'.
  const hold =
    key === 'jump' && ['overhead', 'waitWalk'].includes(s.prompt.key)
      ? WAIT_HOLD
      : RULES.promptHold;
  if (!force && s.prompt.age < Math.round(hold / STEP)) return;
  s.prompt = { id: key, key, subject: null, age: 0, level, dir: s.guideDir, dirAt: 0 };
}

// Key names shown in prompts follow the mode: one player uses every key, two players split them.
const KEY_NAMES = {
  solo: {
    en: { jump: 'W / Up / Space', throw: 'X or J' },
    zh: { jump: 'W/上/空格', throw: 'X或J' },
  },
  coop: { en: { jump: 'W / ↑', throw: 'F / ,' }, zh: { jump: 'W/↑', throw: 'F / ,' } },
};
export const fillKeys = (text, coop, lang) =>
  text.replace(/\{(jump|throw)\}/g, (_, k) => KEY_NAMES[coop ? 'coop' : 'solo'][lang][k]);

export function promptText(s) {
  const { key } = s.prompt;
  const left = Math.max(0, Math.ceil(FLOORS[s.floor].hurry + RULES.hurryWarn - s.floorTime));
  const me = players(s)[0] ?? s.hero;
  const ball = s.balls
    .filter((b) => b.mode === 'rest')
    .sort((p, q) => Math.abs(cx(p) - cx(me)) - Math.abs(cx(q) - cx(me)))[0];
  const arrow =
    key === 'push'
      ? ball && cx(ball) < cx(me)
        ? '←'
        : '→'
      : (s.prompt.dir ?? s.guideDir ?? 1) < 0
        ? '←'
        : '→';
  const fill = (i) =>
    fillKeys(PROMPTS[key][i].replace('{n}', left).replace('{dir}', arrow), s.coop, i ? 'zh' : 'en');
  return { key, en: fill(0), zh: fill(1) };
}

const livesText = (s) =>
  s.coop ? `P1 ${Math.max(0, s.lives)} P2 ${Math.max(0, s.lives2)}` : `${Math.max(0, s.lives)}`;

function buildStatus(s, prompt) {
  if (s.menu) {
    const { unlocked } = s.menu;
    return {
      en: `Snowball Siege · ${unlocked}/${FLOORS.length} floors open · ${prompt.en}`,
      zh: `雪球攻城 · 已开放 ${unlocked}/${FLOORS.length} 层 · ${prompt.zh}`,
    };
  }
  const note = (lang) => (s.msg ? `${s.msg[lang]} · ` : '');
  return {
    en: `Floor ${s.floor + 1}/${FLOORS.length} · Lives ${livesText(s)} · Foes ${foesLeft(s)} · ${note('en')}${prompt.en}`,
    zh: `第 ${s.floor + 1}/${FLOORS.length} 层 · 生命 ${livesText(s)} · 敌人 ${foesLeft(s)} · ${note('zh')}${prompt.zh}`,
  };
}

const copyRect = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
export const stageOf = (e) => Math.max(0, Math.min(RULES.snowFull, Math.ceil(e.snow - 1e-9)));

const heroView = (h) => ({
  ...copyRect(h),
  rect: copyRect(h),
  vx: h.vx,
  vy: h.vy,
  face: h.face,
  grounded: h.grounded,
  onPlank: h.grounded && h.ground === 2,
  invuln: h.invuln,
  cooldown: h.cd,
  powers: { ...h.power },
  out: h.out,
});

export function snapshot(s) {
  const prompt = promptText(s);
  const h = s.hero;
  const def = FLOORS[s.floor];
  const at = def.hurry;
  return {
    phase: s.phase,
    cause: s.cause,
    score: s.score,
    time: s.ticks * STEP,
    floor: s.floor + 1,
    floorCount: FLOORS.length,
    floorName: { ...def.name },
    idea: def.idea,
    floorTime: s.floorTime,
    intro: s.intro > 0,
    cleared: s.clear > 0,
    menu: s.menu ? { ...s.menu, total: FLOORS.length } : null,
    lives: s.lives,
    lives2: s.lives2,
    coop: s.coop,
    letters: s.letters,
    livesMax: RULES.maxLives,
    tiles: s.grid.slice(),
    hero: {
      ...copyRect(h),
      rect: copyRect(h),
      vx: h.vx,
      vy: h.vy,
      face: h.face,
      grounded: h.grounded,
      onPlank: h.grounded && h.ground === 2,
      invuln: h.invuln,
      cooldown: h.cd,
      powers: { ...h.power },
      out: h.out,
    },
    hero2: s.hero2 ? heroView(s.hero2) : null,
    foes: s.enemies.map((e) => ({
      id: e.id,
      kind: e.kind,
      ...copyRect(e),
      rect: copyRect(e),
      vx: e.vx,
      vy: e.vy,
      dir: e.dir,
      snow: e.snow,
      stage: stageOf(e),
      state: e.state,
      minion: !!e.minion,
    })),
    balls: s.balls.map((b) => ({
      id: b.id,
      ...copyRect(b),
      rect: copyRect(b),
      vx: b.vx,
      vy: b.vy,
      mode: b.mode,
      bounces: b.bounces,
      bouncesLeft: RULES.ballBounces - b.bounces,
      life: b.life,
      wobbling: b.mode === 'rest' && b.life < RULES.ballWobble,
      holds: b.occupant ? b.occupant.kind : null,
    })),
    shots: s.shots.map((x) => ({ ...copyRect(x), vx: x.vx })),
    hazards: s.hz.map((z) => ({ kind: z.kind, ...copyRect(z), vx: z.vx, vy: z.vy, g: z.g || 0 })),
    marks: s.marks.map((m) => ({ kind: m.kind, x: m.x, w: m.w, left: m.left, y: m.y ?? null })),
    pickups: s.pickups.map((p) => ({
      id: p.id,
      kind: p.kind,
      power: p.power,
      value: p.value,
      ...copyRect(p),
    })),
    boss: s.boss
      ? {
          kind: s.boss.kind,
          name: { ...BOSSES[s.boss.kind].name },
          ...copyRect(s.boss),
          rect: copyRect(s.boss),
          hp: s.boss.hp,
          hpMax: s.boss.hpMax,
          phase: s.boss.phase,
          state: s.boss.state,
          timer: s.boss.timer,
          beam: s.boss.beam,
          invuln: s.boss.invuln,
          harmful: bossHarms(s.boss),
        }
      : null,
    wraith: s.wraith ? { ...copyRect(s.wraith), recoil: s.wraith.recoil } : null,
    hurry: {
      state: s.hurryState,
      at,
      left: at ? Math.max(0, at - s.floorTime) : null,
      wraithIn: at ? Math.max(0, at + RULES.hurryWarn - s.floorTime) : null,
    },
    chain: { last: s.lastChain, best: s.floorBest },
    hud: { top: [0, TOP], bottom: [FIELD_BOTTOM, 320] },
    prompt,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    stats: { ...s.stats },
    status: buildStatus(s, prompt),
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering (pixel art, 480 x 320). Everything drawn matches what the rules use.
// ---------------------------------------------------------------------------------------------

const THEMES = [
  { bg: '#0d1d33', far: '#14304f', stone: '#41618c', hi: '#86abd6', lo: '#2a4366' },
  { bg: '#1c1236', far: '#2a1b4f', stone: '#5a4a8c', hi: '#a592d6', lo: '#3a2d66' },
  { bg: '#2a110f', far: '#44201a', stone: '#8c4a3d', hi: '#d68a72', lo: '#5e2f27' },
];
const PAL = {
  h: '#e2574c',
  w: '#f4f8ff',
  s: '#f2c6a0',
  e: '#1b2233',
  b: '#3a7bd5',
  B: '#2a5aa5',
  o: '#ff9f1c',
  m: '#ffd9a0',
  k: '#2b2f45',
  r: '#b8372c',
  y: '#ffe45e',
  g: '#4fd1a5',
  G: '#2c8f72',
  p: '#8a5cd6',
  O: '#ff6a2b',
  c: '#6a3a2a',
  n: '#9a9fb0',
};
const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const flipRows = (rows) => rows.map((r) => [...r].reverse().join(''));
const PAL2 = { ...PAL, h: '#3fae6a', b: '#c0518a', B: '#8f3a68', o: '#ffe45e' };
const art = (ctx, rows, x, y, flip = false, scale = 2, pal = PAL) =>
  pixelSprite(ctx, flip ? flipRows(rows) : rows, x, y, scale, pal);

const HERO = {
  idle: [
    '..hhhh..',
    '.hhhhhh.',
    '.wwwwww.',
    '.sesses.',
    '..ssss..',
    '.oooooo.',
    'mbbbbbbm',
    '.bbbbbb.',
    '.bbBBbb.',
    '.kk..kk.',
  ],
  run: [
    '..hhhh..',
    '.hhhhhh.',
    '.wwwwww.',
    '.sesses.',
    '..ssss..',
    '.oooooo.',
    'mbbbbbbm',
    '.bbbbbb.',
    '.bbBBbb.',
    '..kkkk..',
  ],
  jump: [
    'm.hhhh.m',
    'mhhhhhhm',
    '.wwwwww.',
    '.sesses.',
    '..ssss..',
    '.oooooo.',
    '.bbbbbb.',
    '.bbbbbb.',
    '.bBBBBb.',
    '.kk..kk.',
  ],
  throw: [
    '..hhhh..',
    '.hhhhhh.',
    '.wwwwww.',
    '.sesses.',
    '..ssss..',
    '.oooooo.',
    '.bbbbbbm',
    '.bbbbbbm',
    '.bbBBbb.',
    '.kk..kk.',
  ],
};
const SPRITE = {
  walker: [
    '...rrr...',
    '.rrrrrrr.',
    'rrryrryrr',
    'rrrrrrrrr',
    'rorrorror',
    'rrrrrrrrr',
    '.rrrrrrr.',
    '.k.k.k.k.',
    'k.k...k.k',
  ],
  jumper: [
    'y..yyy..y',
    '.yyyyyyy.',
    '.ggggggg.',
    'gkgggggkg',
    'ggggggggg',
    '.GGGGGGG.',
    'gg.ggg.gg',
    'g.G...G.g',
    'GG.....GG',
  ],
  crouch: [
    '.........',
    '.........',
    'y..yyy..y',
    '.yyyyyyy.',
    'gkgggggkg',
    'ggggggggg',
    'GGGGGGGGG',
    'GG.GGG.GG',
    'GGG...GGG',
  ],
  thrower: [
    'r.......r',
    'rr.kkk.rr',
    '.kkkkkkk.',
    '.kykkkyk.',
    '.kkkkkkk.',
    '..kkkkk..',
    '.kkkkkkk.',
    '.kkkkkkk.',
    '..kk.kk..',
    '..kk.kk..',
  ],
  throwerUp: [
    'r.....O.r',
    'rr.kkOO.r',
    '.kkkkkkO.',
    '.kykkkyk.',
    '.kkkkkkk.',
    '..kkkkk..',
    '.kkkkkkk.',
    '.kkkkkkk.',
    '..kk.kk..',
    '..kk.kk..',
  ],
  flyer: [
    'o.........o',
    'oo..kkk..oo',
    'orooo.ooor.',
    'ooorrkrroo.',
    '.ooooko.oo.',
    '..oo.k.oo..',
    '.....k.....',
    '...........',
  ],
  flyerDown: [
    '...........',
    '..oo.k.oo..',
    '.ooooko.oo.',
    'ooorrkrroo.',
    'orooo.ooor.',
    'oo..kkk..oo',
    'o.........o',
    '...........',
  ],
};
const HEART = ['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];

function drawTiles(ctx, s, theme) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = s.grid[r][c];
      const x = c * T;
      const y = TOP + r * T;
      if (ch === SOLID) {
        rect(ctx, theme.stone, x, y, T, T);
        rect(ctx, theme.hi, x, y, T, 3);
        rect(ctx, theme.lo, x, y + T - 3, T, 3);
        rect(ctx, theme.lo, x + 11, y + 3, 2, T - 6);
        rect(ctx, theme.lo, x, y + 11, T, 2);
      } else if (ch === PLANK) {
        rect(ctx, '#7a4f2b', x, y, T, 8);
        rect(ctx, '#d9a066', x, y, T, 3);
        rect(ctx, '#4a2f19', x + 11, y + 3, 2, 5);
        rect(ctx, '#3a2512', x, y + 8, T, 2);
        rect(ctx, '#4a2f19', x + 4, y + 10, 3, 5);
        rect(ctx, '#4a2f19', x + T - 7, y + 10, 3, 5);
      } else if (ch === VENT) {
        rect(ctx, '#1a1e2b', x, y, T, T);
        for (let i = 0; i < 4; i++) rect(ctx, '#7d889f', x + 2 + i * 6, y + 2, 3, T - 4);
        rect(ctx, '#aab4c8', x, y, T, 2);
      }
    }
  }
}

function drawBackdrop(ctx, s, theme, f) {
  background(ctx, theme.bg);
  for (let i = 0; i < 5; i++) {
    const x = i * 110 - 20;
    rect(ctx, theme.far, x, 150 + (i % 2) * 22, 90, 140);
    rect(ctx, theme.far, x + 10, 128 + (i % 2) * 22, 22, 24);
    rect(ctx, theme.bg, x + 36, 170 + (i % 2) * 22, 12, 16);
  }
  for (let i = 0; i < 26; i++) {
    const x = (i * 83 + f * (0.1 + (i % 3) * 0.05)) % 480;
    const y = (i * 47 + f * (0.3 + (i % 4) * 0.1)) % 264;
    rect(ctx, '#d6e6f7', x, TOP + y, 2, 2);
  }
}

function drawSnowCoat(ctx, e) {
  const stage = stageOf(e);
  if (!stage) return;
  const cover = [0, 0.3, 0.55, 0.8][stage];
  rect(ctx, '#f4f8ff', e.x + 1, e.y, e.w - 2, Math.max(3, e.h * cover));
  rect(ctx, '#cfe3f5', e.x + 3, e.y + Math.max(3, e.h * cover) - 2, e.w - 6, 3);
  if (stage >= 2) rect(ctx, '#f4f8ff', e.x, e.y + e.h * cover - 6, 4, 7);
  if (stage >= 3) rect(ctx, '#f4f8ff', e.x + e.w - 4, e.y + e.h * cover - 6, 4, 7);
}

function drawFoe(ctx, e, f) {
  const flip = e.dir < 0;
  const x = e.x;
  const y = e.y;
  if (e.kind === 'walker') art(ctx, SPRITE.walker, x, y + (Math.floor(f / 14) % 2), flip);
  else if (e.kind === 'jumper') {
    if (e.state === 'crouch') art(ctx, SPRITE.crouch, x, y, flip);
    else art(ctx, SPRITE.jumper, x, y, flip);
  } else if (e.kind === 'flyer')
    art(ctx, Math.floor(f / 8) % 2 ? SPRITE.flyer : SPRITE.flyerDown, x, y, flip);
  else art(ctx, e.state === 'windup' ? SPRITE.throwerUp : SPRITE.thrower, x, y, flip);
  if (e.state === 'windup' || e.state === 'crouch')
    rect(ctx, f % 16 < 8 ? '#ffe45e' : '#ff6a2b', x + e.w / 2 - 3, y - 7, 6, 4);
  drawSnowCoat(ctx, e);
  if (e.flash > 0) rect(ctx, '#ffffff', x + 2, y + 2, e.w - 4, 4);
}

function drawBall(ctx, b, f) {
  const wobble =
    b.mode === 'rest' && b.life < RULES.ballWobble ? Math.round(Math.sin(f * 0.55) * 2.5) : 0;
  const x = b.x + wobble;
  const rad = b.w / 2;
  for (let r = 0; r < b.h; r++) {
    const dy = r + 0.5 - rad;
    const half = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    rect(ctx, '#f4f8ff', x + rad - half, b.y + r, half * 2, 1);
  }
  rect(ctx, '#cfe3f5', x + 6, b.y + b.h - 5, 12, 3);
  rect(ctx, '#ffffff', x + 4, b.y + 4, 5, 3);
  if (b.occupant) {
    const color = { walker: '#ff6a2b', jumper: '#4fd1a5', flyer: '#ff9f1c', thrower: '#6c7390' }[
      b.occupant.kind
    ];
    rect(ctx, color, x + 6, b.y + 8, 3, 3);
    rect(ctx, color, x + 13, b.y + 8, 3, 3);
  }
  if (b.mode === 'roll') {
    const turn = Math.floor(b.x / 6) % 2;
    rect(ctx, '#aac9e6', x + 10 + turn * 3, b.y + 6, 2, 10);
  }
  if (b.mode === 'rest' && b.life < RULES.ballWobble) rect(ctx, '#ff9f1c', x + 9, b.y - 6, 4, 4);
}

const POWER_COLOR = { speed: '#4fd1ff', range: '#6bd66b', power: '#ff6a5a', shield: '#8f9cff' };

function drawHero(ctx, h, f) {
  if (h.out) return;
  if (h.invuln > 0 && Math.floor(f / 6) % 2) return;
  const sprite = !h.grounded
    ? HERO.jump
    : h.cd > RULES.shotCooldown - 0.14
      ? HERO.throw
      : Math.abs(h.vx) > 20 && Math.floor(f / 10) % 2
        ? HERO.run
        : HERO.idle;
  art(ctx, sprite, h.x, h.y, h.face < 0, 2, h.idx ? PAL2 : PAL);
  POWERS.filter((k) => h.power[k] > 0).forEach((k, i) =>
    rect(ctx, POWER_COLOR[k], h.x + i * 5, h.y - 6, 4, 4),
  );
  if (h.power.shield > 0) {
    rect(ctx, '#8fd8ff', h.x - 3, h.y - 3, h.w + 6, 2);
    rect(ctx, '#8fd8ff', h.x - 3, h.y + h.h + 1, h.w + 6, 2);
    rect(ctx, '#8fd8ff', h.x - 3, h.y - 3, 2, h.h + 6);
    rect(ctx, '#8fd8ff', h.x + h.w + 1, h.y - 3, 2, h.h + 6);
  }
}

function drawPickup(ctx, p, f) {
  const bob = p.life < 3 && Math.floor(f / 6) % 2 ? -99 : 0;
  const x = p.x;
  const y = p.y + bob;
  if (p.kind === 'letter') {
    rect(ctx, '#10162a', x - 1, y - 1, 16, 16);
    rect(ctx, '#ffe45e', x, y, 14, 14);
    text(ctx, p.letter, x + 7, y - 1, '#1b1020', 14, 'center');
    return;
  }
  if (p.power) {
    const color = { speed: '#4fd1ff', range: '#6bd66b', power: '#ff6a5a', shield: '#8f9cff' }[
      p.kind
    ];
    rect(ctx, '#10162a', x - 1, y - 1, 16, 16);
    rect(ctx, color, x, y, 14, 14);
    if (p.kind === 'speed') [3, 8].forEach((o) => rect(ctx, '#ffffff', x + o, y + 3, 3, 8));
    else if (p.kind === 'range') rect(ctx, '#ffffff', x + 2, y + 6, 10, 3);
    else if (p.kind === 'power')
      (rect(ctx, '#ffffff', x + 5, y + 2, 4, 10), rect(ctx, '#ffffff', x + 2, y + 5, 10, 4));
    else {
      rect(ctx, '#ffffff', x + 3, y + 3, 8, 2);
      rect(ctx, '#ffffff', x + 3, y + 9, 8, 2);
      rect(ctx, '#ffffff', x + 3, y + 3, 2, 8);
      rect(ctx, '#ffffff', x + 9, y + 3, 2, 8);
    }
    return;
  }
  if (p.kind === 'cherry') {
    rect(ctx, '#e2433a', x + 1, y + 6, 6, 6);
    rect(ctx, '#e2433a', x + 8, y + 7, 6, 6);
    rect(ctx, '#4fa05a', x + 6, y, 2, 7);
  } else if (p.kind === 'pear') {
    rect(ctx, '#9fd13a', x + 4, y + 2, 6, 5);
    rect(ctx, '#9fd13a', x + 2, y + 7, 10, 6);
    rect(ctx, '#6a4a2a', x + 7, y, 2, 3);
  } else if (p.kind === 'plum') {
    rect(ctx, '#8a4fd6', x + 1, y + 2, 12, 11);
    rect(ctx, '#c7a6f0', x + 3, y + 4, 3, 3);
  } else {
    rect(ctx, '#ffe45e', x + 5, y, 4, 14);
    rect(ctx, '#ffe45e', x, y + 5, 14, 4);
    rect(ctx, '#ffffff', x + 5, y + 5, 4, 4);
  }
}

function drawHazard(ctx, z, f) {
  if (z.kind === 'wave') {
    rect(ctx, '#ff6a2b', z.x, z.y + 4, z.w, z.h - 4);
    rect(ctx, '#ffe45e', z.x + 3, z.y, 4, 8);
    rect(ctx, '#ffe45e', z.x + 9, z.y + 2, 3, 6);
    return;
  }
  rect(ctx, '#ff6a2b', z.x, z.y, z.w, z.h);
  rect(ctx, '#ffe45e', z.x + 2, z.y + 2, z.w - 4, z.h - 4);
  if (f % 6 < 3) rect(ctx, '#ffffff', z.x + 3, z.y + 3, 3, 3);
}

export function drawBoss(ctx, b, f) {
  if (b.invuln > 0 && b.state !== 'dying' && Math.floor(f / 5) % 2) return;
  const lit = b.flash > 0;
  const body = lit ? '#ffffff' : null;
  const x = b.x;
  const y = b.y;
  if (b.kind === 'golem') {
    const up = b.state === 'windup';
    rect(ctx, body ?? '#5a3a34', x + 4, y + 10, b.w - 8, b.h - 10);
    rect(ctx, body ?? '#7a5148', x + 8, y, b.w - 16, 16);
    rect(ctx, body ?? '#3a2420', x + 2, y + b.h - 8, 16, 8);
    rect(ctx, body ?? '#3a2420', x + b.w - 18, y + b.h - 8, 16, 8);
    rect(ctx, up ? '#ffe45e' : '#ff6a2b', x + 12, y + 26, b.w - 24, 14);
    rect(ctx, '#ffe45e', x + 13, y + 5, 6, 5);
    rect(ctx, '#ffe45e', x + b.w - 19, y + 5, 6, 5);
    rect(ctx, '#2a1a17', x + 20, y, 6, 6);
    rect(ctx, body ?? '#7a5148', x, y + (up ? 0 : 16), 8, up ? 20 : 26);
    rect(ctx, body ?? '#7a5148', x + b.w - 8, y + (up ? 0 : 16), 8, up ? 20 : 26);
    if (up && f % 8 < 4) rect(ctx, '#ff6a2b', x + 6, y + 8, b.w - 12, 4);
  } else if (b.kind === 'wyrm') {
    rect(ctx, body ?? '#7a2f66', x, y + 6, b.w, 18);
    rect(ctx, body ?? '#a8479a', x + 4, y + 2, b.w - 8, 8);
    rect(ctx, '#ffe45e', x + (b.dir > 0 ? b.w - 16 : 4), y + 8, 12, 10);
    rect(ctx, '#1b1020', x + (b.dir > 0 ? b.w - 10 : 8), y + 10, 4, 4);
    for (let i = 0; i < 4; i++)
      rect(ctx, body ?? '#5a1f4c', x + 6 + i * 12, y + 22 + (i % 2) * 4, 8, 6);
    rect(ctx, '#ff9f1c', x + b.w / 2 - 5, y - 10, 10, 12);
    rect(ctx, '#ffe45e', x + b.w / 2 - 3, y - 8, 6, 8);
    if (b.state === 'dazed')
      for (let i = 0; i < 3; i++)
        rect(ctx, '#ffe45e', x + 8 + i * 16 + (f % 12), y - 6 - (i % 2) * 4, 4, 4);
    if (b.beam) {
      rect(
        ctx,
        f % 8 < 4 ? '#ff4a3a' : '#ffb04a',
        x + b.w / 2 - 2,
        y + b.h,
        4,
        FIELD_BOTTOM - T - (y + b.h),
      );
      rect(ctx, '#ff4a3a', x + 2, FIELD_BOTTOM - T - 4, b.w - 4, 4);
    }
  } else {
    const alpha = b.state === 'vanish' || b.state === 'appear';
    if (alpha && f % 4 < 2) return;
    rect(ctx, body ?? '#8a2f44', x + 6, y + 18, b.w - 12, b.h - 18);
    rect(ctx, body ?? '#f2c6a0', x + 12, y + 8, b.w - 24, 12);
    rect(ctx, '#ffe45e', x + 8, y, b.w - 16, 8);
    [0, 1, 2].forEach((i) => rect(ctx, '#ffe45e', x + 8 + i * 12, y - 6, 6, 6));
    rect(ctx, '#ff6a2b', x + 2, y + 6 + (f % 10 < 5 ? 0 : 3), 8, 20);
    rect(ctx, '#ff6a2b', x + b.w - 10, y + 6 + (f % 10 < 5 ? 3 : 0), 8, 20);
    rect(ctx, '#1b1020', x + 16, y + 12, 3, 3);
    rect(ctx, '#1b1020', x + b.w - 19, y + 12, 3, 3);
    if (b.state === 'flare')
      rect(ctx, f % 8 < 4 ? '#ffe45e' : '#ff6a2b', x + 4, y + 30, b.w - 8, 6);
  }
}

function drawWraith(ctx, w, f) {
  const k = f % 12 < 6 ? 0 : 2;
  rect(ctx, '#ff4a3a', w.x + 2, w.y + 4 + k, 18, 18 - k);
  rect(ctx, '#ff9f1c', w.x + 5, w.y + 8, 12, 10);
  rect(ctx, '#ffe45e', w.x + 8, w.y + 11, 6, 5);
  rect(ctx, '#1b1020', w.x + 6, w.y + 6, 3, 3);
  rect(ctx, '#1b1020', w.x + 13, w.y + 6, 3, 3);
  rect(ctx, '#ff4a3a', w.x + 4, w.y, 3, 6);
  rect(ctx, '#ff4a3a', w.x + 15, w.y + k, 3, 6);
}

function bossBar(ctx, b) {
  rect(ctx, '#3a2230', 200, 8, 160, 12);
  rect(
    ctx,
    b.hp * 3 <= b.hpMax ? '#ff5a5a' : '#ff9f1c',
    202,
    10,
    Math.max(0, ((160 - 4) * b.hp) / b.hpMax),
    8,
  );
  rect(ctx, '#ffffff', 200, 8, 160, 1);
  for (let i = 1; i < b.hpMax; i++) rect(ctx, '#3a2230', 200 + (160 * i) / b.hpMax, 8, 1, 12);
  rect(ctx, '#e8f1ff', 190, 10, 6, 8);
  rect(ctx, '#e8f1ff', 187, 12, 12, 4);
}

function drawBands(ctx, s, snap, env) {
  const t = env.t;
  const put = (str, x, y, color, align = 'left') => text(ctx, str, x, y, color, 14, align);
  rect(ctx, '#0b111b', 0, 0, 480, TOP);
  rect(ctx, '#0b111b', 0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  rect(ctx, '#3b4a63', 0, TOP - 1, 480, 1);
  rect(ctx, '#3b4a63', 0, FIELD_BOTTOM, 480, 1);
  put(
    t(`Floor ${s.floor + 1}/${FLOORS.length}`, `第${s.floor + 1}/${FLOORS.length}层`),
    6,
    6,
    '#e8f1ff',
  );
  const heart = (x, n, label) => {
    art(ctx, HEART, x, 8, false, 2);
    put(`${label}${Math.max(0, n)}`, x + 16, 6, n > 0 ? '#e8f1ff' : '#ff9a8a');
  };
  heart(102, s.lives, s.coop ? '1:' : 'x');
  if (s.coop) heart(146, s.lives2, '2:');
  put(t(`Score ${s.score}`, `分数 ${s.score}`), 474, 6, '#ffe9a8', 'right');
  if (s.boss) bossBar(ctx, s.boss);
  else if (s.hurryState !== 'none') {
    const wait = s.hurryState === 'warn';
    const color = s.ticks % 30 < 18 ? '#ff6a5a' : '#ffd35a';
    put(wait ? t('HURRY!', '快点！') : t('WRAITH!', '幽灵！'), 238, 6, color, 'center');
  }
  put(snap.prompt[env.lang], 6, FIELD_BOTTOM + 7, '#ffe9a8');
  for (let i = 0; i < LETTERS.length; i++) {
    const got = i < s.letters;
    const x = 398 + i * 16;
    rect(ctx, got ? '#ffe45e' : '#3b4a63', x, FIELD_BOTTOM + 5, 15, 18);
    rect(ctx, '#0b111b', x + 1, FIELD_BOTTOM + 6, 13, 16);
    text(ctx, LETTERS[i], x + 7.5, FIELD_BOTTOM + 6, got ? '#ffe45e' : '#56657f', 14, 'center');
  }
}

function drawOverlays(ctx, s, env) {
  const t = env.t;
  if (s.intro > 0) {
    const name = FLOORS[s.floor].name;
    rect(ctx, '#0b111bcc', 80, 118, 320, 40);
    text(
      ctx,
      t(`Floor ${s.floor + 1}: ${name.en}`, `第${s.floor + 1}层：${name.zh}`),
      240,
      130,
      '#ffffff',
      16,
      'center',
    );
  }
  if (s.msg) {
    rect(ctx, '#0b111bcc', 40, 80, 400, 22);
    text(ctx, s.msg[env.lang], 240, 84, '#9fe3b0', 14, 'center');
  }
  for (const p of s.pops)
    text(
      ctx,
      typeof p.label === 'string' ? p.label : p.label[env.lang],
      p.x,
      p.y,
      '#fff2a8',
      14,
      'center',
    );
}

function drawMenu(ctx, s, env) {
  const { cursor, unlocked } = s.menu;
  const f = Math.floor(s.menuClock * 60);
  background(ctx, '#0d1624');
  rect(ctx, '#0b111b', 0, 0, 480, TOP);
  rect(ctx, '#3b4a63', 0, TOP - 1, 480, 1);
  text(ctx, env.t('Snowball Siege: choose a floor', '雪球攻城：选择楼层'), 6, 6, '#e8f1ff', 14);
  FLOORS.forEach((def, i) => {
    const n = i + 1;
    const q = menuCell(n);
    const open = n <= unlocked;
    rect(ctx, n === cursor ? '#ffe9a8' : '#3b4a63', q.x, q.y, q.w, q.h);
    rect(ctx, open ? '#1d2a40' : '#121a28', q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    if (open && n < unlocked) rect(ctx, '#58d68d', q.x + 2, q.y + 2, q.w - 4, 4);
    if (n === unlocked && f % 60 < 40) rect(ctx, '#ffb347', q.x + 2, q.y + 2, q.w - 4, 4);
    text(ctx, `${n}`, q.x + q.w / 2, q.y + 10, open ? '#ffffff' : '#56657f', 16, 'center');
    if (def.boss) {
      rect(ctx, open ? '#ff6a5a' : '#56657f', q.x + q.w / 2 - 6, q.y + q.h - 12, 12, 6);
      rect(ctx, '#0b111b', q.x + q.w / 2 - 4, q.y + q.h - 10, 3, 2);
      rect(ctx, '#0b111b', q.x + q.w / 2 + 1, q.y + q.h - 10, 3, 2);
    } else if (!open) rect(ctx, '#56657f', q.x + q.w / 2 - 5, q.y + q.h - 12, 10, 6);
  });
  rect(ctx, '#0b111b', 0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  rect(ctx, '#3b4a63', 0, FIELD_BOTTOM, 480, 1);
  const name = FLOORS[cursor - 1].name;
  text(
    ctx,
    env.t(`${cursor}. ${name.en}`, `${cursor}. ${name.zh}`),
    6,
    FIELD_BOTTOM,
    '#ffe9a8',
    14,
  );
  text(ctx, snapshot(s).prompt[env.lang], 6, FIELD_BOTTOM + 14, '#bfe9ff', 14);
  if (s.msg) text(ctx, s.msg[env.lang], 474, FIELD_BOTTOM, '#ff9a8a', 14, 'right');
}

export function render(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  const f = s.ticks / 2;
  const theme = THEMES[Math.min(2, Math.floor(s.floor / 10))];
  drawBackdrop(ctx, s, theme, f);
  drawTiles(ctx, s, theme);
  for (const m of s.marks) {
    if (m.kind === 'rain') {
      rect(ctx, f % 6 < 3 ? '#ff6a2b' : '#ffe45e', m.x - 8, TOP, 16, 3);
      for (let y = TOP; y < m.y; y += 10) rect(ctx, 'rgba(255,106,43,0.45)', m.x - 1, y, 2, 6);
      rect(ctx, '#ff4a3a', m.x - 10, m.y - 4, 20, 4);
    } else rect(ctx, f % 6 < 3 ? '#ffe45e' : '#ff6a2b', m.x - 12, TOP + 2, 24, 6);
  }
  for (const p of s.pickups) drawPickup(ctx, p, f);
  for (const b of s.balls) drawBall(ctx, b, f);
  for (const e of s.enemies) drawFoe(ctx, e, f);
  if (s.boss) drawBoss(ctx, s.boss, f);
  for (const z of s.hz) drawHazard(ctx, z, f);
  drawHero(ctx, s.hero, f);
  if (s.hero2) drawHero(ctx, s.hero2, f);
  for (const sh of s.shots) {
    rect(ctx, '#ffffff', sh.x + 1, sh.y, sh.w - 2, sh.h);
    rect(ctx, '#cfe3f5', sh.x, sh.y + 2, sh.w, sh.h - 4);
  }
  if (s.wraith) drawWraith(ctx, s.wraith, f);
  for (const q of s.fx) rect(ctx, q.color, q.x, q.y, 3, 3);
  drawBands(ctx, s, snapshot(s), env);
  drawOverlays(ctx, s, env);
}

// ---------------------------------------------------------------------------------------------
// Public game
// ---------------------------------------------------------------------------------------------

// Progress is a convenience: a broken store must never stop the game.
function readUnlocked(progress) {
  try {
    return progress?.unlocked?.();
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, floor) {
  try {
    progress?.unlock?.(floor);
  } catch {
    // keep playing; the floor simply is not remembered
  }
}

export function createGame(env) {
  const s = newState(env.random, env.mode === 2 ? 2 : 1);
  s.menuClock = 0;
  let unlocked = Math.max(1, Math.min(FLOORS.length, Math.floor(readUnlocked(env.progress)) || 1));
  if (unlocked > 1) openMenu(s, unlocked);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.unlockTo > unlocked) {
        unlocked = s.unlockTo;
        saveUnlocked(env.progress, unlocked);
      }
      if (s.phase === 'playing' || ended) return;
      ended = true;
      const won = s.phase === 'won';
      env.end({
        won,
        score: Math.round(s.score),
        message: won
          ? env.t(
              'The Furnace Queen falls and the Cinder Keep goes quiet. Siege won!',
              '熔炉女王倒下了，烬石要塞重归寂静。攻城成功！',
            )
          : env.t(
              `Out of lives on floor ${s.floor + 1}. Roll more snowballs, dodge more fire.`,
              `在第${s.floor + 1}层耗尽了生命。多推雪球，多躲火焰。`,
            ),
      });
    },
    draw(ctx) {
      render(ctx, s, env);
    },
    getState() {
      return snapshot(s);
    },
  };
}
