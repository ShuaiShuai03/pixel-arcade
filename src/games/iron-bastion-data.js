// Iron Bastion data: arena geometry, enemy roles, ground themes and the battlefield table.
// Everything exported here is deeply frozen; the game copies what it needs to mutate.

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const R = 12; // tank body radius
export const SHELL_R = 2;
export const SHELL_MASS = 0.02;
export const HULL_MASS = 88; // an empty hull; every carried round adds SHELL_MASS
export const STEP = 1 / 240; // fixed simulation step, so every frame rate follows one trajectory
export const MAX_DT = 1 / 30;
export const BASE = Object.freeze({ x: 225, y: 282, w: 30, h: 26 });
export const BEACON = Object.freeze({ x: 240, y: 295 });
export const LANES = Object.freeze([50, 145, 240, 335, 430]);
export const SPAWN_Y = 60;
export const MAX_ARMOR = 4;
export const MAX_BEACON = 5;
export const MAX_KITS = 3;
export const START_KITS = 2;
export const PLAYER_START = Object.freeze({ x: 166, y: 284 });
// A magazine of shells that recharges slowly: bursts are fine, holding the trigger is not.
export const MAGAZINE = 4;
export const RECHARGE = 1.4; // shells per second
export const SHELL_COOLDOWN = 0.32;
export const AIM_DEAD_ZONE = 6; // a pointer this close to the tank centre leaves the turret alone
export const POINTER_ALIGNMENT = 0.06; // radians the turret may be off a pointer and still fire
export const FIRST_ARRIVAL = 0.5; // seconds before a field's first arrival, unless it says otherwise
export const TOP = 44; // the playfield starts below the HUD band
// Bounds of tank centres (min/max), of the floor (left/right/top/bottom) and of the shell walls.
export const ARENA = Object.freeze({
  left: 8,
  right: 472,
  top: TOP,
  bottom: 312,
  minX: 20,
  maxX: 460,
  minY: 56,
  maxY: 300,
  wallLeft: 10,
  wallRight: 470,
  wallTop: 46,
  wallBottom: 310,
});

// Enemy roles. Speeds are pixels per second before the field's own speed factor.
export const ROLES = deepFreeze({
  raider: { hp: 1, mass: 100, speed: 36, range: 150, cooldown: 1.8, chase: true, jink: false },
  gunner: { hp: 1, mass: 100, speed: 26, range: 220, cooldown: 1.8, chase: false, jink: false },
  heavy: { hp: 2, mass: 130, speed: 24, range: 150, cooldown: 2.3, chase: false, jink: false },
  scout: { hp: 1, mass: 90, speed: 48, range: 170, cooldown: 2.4, chase: false, jink: true },
});

// Ground themes: two floor tones, the central road and one accent. Drawing picks details by id.
export const THEMES = deepFreeze([
  { name: 'courtyard', floor: ['#39493e', '#455546'], road: '#4a544b', accent: '#9a9876' },
  { name: 'foundry', floor: ['#46453c', '#535047'], road: '#55564b', accent: '#a18d5d' },
  { name: 'siege', floor: ['#37434a', '#46525a'], road: '#46545b', accent: '#7f979c' },
  { name: 'desert', floor: ['#5a5238', '#6a6143'], road: '#6d6547', accent: '#c1ad74' },
  { name: 'frost', floor: ['#3f5559', '#4d666a'], road: '#58747a', accent: '#bfe0e2' },
  {
    name: 'night',
    floor: ['#2d3442', '#384050'],
    road: '#3b4455',
    accent: '#d69a6a',
  },
]);

// Cover layouts are 19 columns by 6 rows of 22 px tiles on a 24 px pitch.
//   column c sits at x = 12 + 24c, row r at y = 100 + 24r.  b brick (two hits)   s steel (solid)
const GRID_X = 12;
const GRID_Y = 100;
const PITCH = 24;
const TILE = 22;
export const COLS = 19;
export const ROWS = 6;

// Roster tokens: a role letter, a lane digit (0-4) and an optional + for one extra armor plate.
//   r raider   g gunner   h heavy   s scout
const ROLE_OF = { r: 'raider', g: 'gunner', h: 'heavy', s: 'scout' };

// Per field: name, bilingual tip, theme, cover, roster, ammo (shells per hit point), pressure.
//   speed scales enemy movement, rate scales their reload time (smaller is faster),
//   live is how many enemies may be on the field at once and gap the seconds between arrivals;
//   start (optional) is the seconds before the first arrival.
const DEFS = [
  {
    name: ['Courtyard', '庭院'],
    tip: ['Hold X, turn with Left/Right, fire with Space.', '按住X，左右转炮塔，空格开火。'],
    theme: 0,
    cover: [
      '...................',
      '.bb.............bb.',
      '.b...............b.',
      '....b.........b....',
      '...................',
      '...................',
    ],
    roster: 'r2 r1 r3 r2',
    ammo: 7.2,
    speed: 0.85,
    rate: 3.4,
    start: 13,
    live: 2,
    gap: 3.3,
  },
  {
    name: ['Gatehouse', '门楼'],
    tip: ['Gunners halt far off and shell the beacon.', '炮手会远远停下轰击信标。'],
    theme: 0,
    cover: [
      '...................',
      '..bbb.........bbb..',
      '...................',
      '.....b.......b.....',
      '...................',
      '.....b.......b.....',
    ],
    roster: 'g1 r3 g3 r2 g2',
    ammo: 6.6,
    speed: 0.86,
    rate: 1.8,
    start: 4,
    live: 2,
    gap: 3.3,
  },
  {
    name: ['Brickyard', '砖场'],
    tip: ['Brick breaks in two hits; steel never breaks.', '砖墙两发击碎，钢墙永不破损。'],
    theme: 0,
    cover: [
      '...................',
      '.bb.b.........b.bb.',
      '.bb.b.........b.bb.',
      '...................',
      '...ss.........ss...',
      '...................',
    ],
    roster: 'r1 g3 r3 g1 r2 g2',
    ammo: 6.0,
    speed: 0.87,
    rate: 1.28,
    live: 3,
    gap: 3.3,
  },
  {
    name: ['Foundry', '铸造厂'],
    tip: ['Heavy tanks take two hits and fire slowly.', '重型坦克要两发才能击毁，射速慢。'],
    theme: 1,
    cover: [
      '...................',
      '..s.bb.......bb.s..',
      '..s.............s..',
      '...................',
      '.b.b...........b.b.',
      '...................',
    ],
    roster: 'g0 r4 h2 r1 r3 h2',
    ammo: 5.5,
    speed: 0.88,
    rate: 1.27,
    live: 3,
    gap: 3.2,
  },
  {
    name: ['Weaver Lane', '蛇行巷'],
    tip: ['Scouts weave. Aim ahead of where they go.', '侦察车会蛇形走位，瞄向它前方。'],
    theme: 1,
    cover: [
      '...................',
      '...bb.........bb...',
      '...................',
      '.s...............s.',
      '...................',
      '.....b.......b.....',
    ],
    roster: 's1 s3 r2 s2 s0 s4',
    ammo: 5.5,
    speed: 0.88,
    rate: 1.27,
    live: 3,
    gap: 3.2,
  },
  {
    name: ['Supply Depot', '补给站'],
    tip: ['Every third kill drops a kit. H repairs.', '每击毁三辆会掉落维修包，按H维修。'],
    theme: 1,
    cover: [
      '...................',
      '.bbb...........bbb.',
      '...................',
      '..s.....b.b.....s..',
      '...................',
      '.bb.............bb.',
    ],
    roster: 'g0 g4 r1 r3 s2 h2',
    ammo: 5.3,
    speed: 0.89,
    rate: 1.26,
    live: 3,
    gap: 3.2,
  },
  {
    name: ['Crossroads', '十字路口'],
    tip: ['Steel splits the road. Watch both flanks.', '钢墙把道路分开，留意两翼。'],
    theme: 2,
    cover: [
      '...................',
      '....s.........s....',
      '....s...bbb...s....',
      '....s.........s....',
      '...................',
      '..bb...........bb..',
    ],
    roster: 'h2 s1 s3 g0 g4 r2',
    ammo: 5.0,
    speed: 0.9,
    rate: 1.25,
    live: 3,
    gap: 3.2,
  },
  {
    name: ['Culvert', '涵洞'],
    tip: ['Raiders chase your tank when it is close.', '你的坦克靠近时，突袭车会追上来。'],
    theme: 2,
    cover: [
      '...................',
      '.sss.b.......b.sss.',
      '.....b.......b.....',
      '...................',
      '..bb...........bb..',
      '...................',
    ],
    roster: 'r0 r4 r1 r3 g2 g2 s2',
    ammo: 5.0,
    speed: 0.91,
    rate: 1.24,
    live: 3,
    gap: 3.1,
  },
  {
    name: ['Orchard Wall', '果园墙'],
    tip: ['Break a brick gap to open a firing lane.', '打碎一块砖，开出一条射击通道。'],
    theme: 0,
    cover: [
      '...................',
      '.bbbbbb.....bbbbbb.',
      '.b...............b.',
      '...................',
      '.b.b.b.......b.b.b.',
      '...................',
    ],
    roster: 'h1 h3 g0 g4 s2 s2 r2',
    ammo: 4.8,
    speed: 0.92,
    rate: 1.23,
    live: 3,
    gap: 3.1,
  },
  {
    name: ['Rail Yard', '铁路场'],
    tip: ['Enemy shells can be shot down. Break volleys.', '敌方炮弹可以被击落，打断齐射。'],
    theme: 1,
    cover: [
      '...................',
      's.s.s.s.....s.s.s.s',
      '...................',
      '..b.b.b.....b.b.b..',
      '...................',
      '.....s.......s.....',
    ],
    roster: 's0 s4 s1 s3 h2 g2 r2 r2',
    ammo: 4.8,
    speed: 0.93,
    rate: 1.22,
    live: 3,
    gap: 3.1,
  },
  {
    name: ['Quarry', '采石场'],
    tip: ['Armored heavies take three hits. Save rounds.', '加厚的重型车要三发才击毁，省着打。'],
    theme: 3,
    cover: [
      '...................',
      '..ss.b.......b.ss..',
      '..s.............s..',
      '...bb.........bb...',
      '...................',
      '......b.....b......',
    ],
    roster: 'h2+ g0 g4 s1 s3 r2 r2',
    ammo: 4.6,
    speed: 0.94,
    rate: 1.21,
    live: 3,
    gap: 3.1,
  },
  {
    name: ['Salt Flats', '盐滩'],
    tip: ['Open ground and four gunners: kill them first.', '地势开阔，四辆炮手，先打掉他们。'],
    theme: 3,
    cover: [
      '...................',
      '...................',
      '.b...............b.',
      '...................',
      '......b.....b......',
      '...................',
    ],
    roster: 'g0 g1 g3 g4 s2 r2 r2 h2',
    ammo: 4.6,
    speed: 0.95,
    rate: 1.2,
    live: 3,
    gap: 3.1,
  },
  {
    name: ['Frostline', '霜线'],
    tip: ['Raiders open from both edges. Split your fire.', '突袭车从两侧边缘同时出击，分头应对。'],
    theme: 4,
    cover: [
      '...................',
      '.bb.s.........s.bb.',
      '.bb.............bb.',
      '...b...........b...',
      '...................',
      '..s.b.........b.s..',
    ],
    roster: 'r0 r4 s1 s3 h2+ g0 g4 r2',
    ammo: 4.4,
    speed: 0.95,
    rate: 1.2,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Ice Bridge', '冰桥'],
    tip: [
      'Two steel walls make three lanes. Clear one at a time.',
      '两道钢墙分出三条路，逐条清理。',
    ],
    theme: 4,
    cover: [
      '...................',
      '...ssss.....ssss...',
      '...................',
      '..bb...........bb..',
      '.........s.........',
      '...................',
    ],
    roster: 's0 s4 h2 g1 g3 r2 s2 h2',
    ammo: 4.3,
    speed: 0.96,
    rate: 1.19,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Broken Aqueduct', '断渠'],
    tip: ['Steel arches block shots. Wait for a clear line.', '钢拱会挡住炮弹，等视线畅通再开火。'],
    theme: 4,
    cover: [
      '...................',
      '..sss...bbb...sss..',
      '..s.............s..',
      '..s...b.....b...s..',
      '...................',
      '.....bb.....bb.....',
    ],
    roster: 'h1+ s0 s4 g0 g4 r2 s2 r1 r3',
    ammo: 4.3,
    speed: 0.97,
    rate: 1.18,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Smelter', '熔炼厂'],
    tip: ['Fast scouts and slow heavies arrive together.', '快速侦察车与慢速重型车同时到达。'],
    theme: 1,
    cover: [
      '...................',
      '.s.bb.s.....s.bb.s.',
      '..s.............s..',
      '...bb.........bb...',
      '.b...............b.',
      '...................',
    ],
    roster: 'h2+ s1 s3 h2 g0 g4 r2 s2 r1',
    ammo: 4.2,
    speed: 0.98,
    rate: 1.17,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Siege Line', '围攻防线'],
    tip: ['Dense brick screens the guns. Bore through it.', '密集砖墙遮住炮口，把它打穿。'],
    theme: 2,
    cover: [
      '...................',
      'bbbb.bb.....bb.bbbb',
      '..s.............s..',
      'bb.bb.........bb.bb',
      '...................',
      '..s.............s..',
    ],
    roster: 'g0 g4 g2 h2+ s1 s3 r1 r3 h2',
    ammo: 4.2,
    speed: 0.99,
    rate: 1.16,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Crater Field', '弹坑场'],
    tip: ['Scattered cover everywhere. Pick your lane.', '掩体零散分布，自己选射击线路。'],
    theme: 2,
    cover: [
      '...................',
      '..b.....s.s.....b..',
      '.....b.......b.....',
      '.s.......b.......s.',
      '....b.........b....',
      '.........s.........',
    ],
    roster: 's0 s2 s4 h2+ g1 g3 r2 r0 r4',
    ammo: 4.1,
    speed: 0.99,
    rate: 1.16,
    live: 3,
    gap: 3.0,
  },
  {
    name: ['Steel Maze', '钢铁迷宫'],
    tip: ['Steel walls steer enemies. Hit them at the turns.', '钢墙为敌人引路，在拐弯处截击。'],
    theme: 5,
    cover: [
      '...................',
      '.sss.b.......b.sss.',
      '.....s..bbb..s.....',
      '.ssss.........ssss.',
      '......s.....s......',
      '.bb.............bb.',
    ],
    roster: 'h2+ s0 s4 g0 g4 s1 s3 r2 h2 r2',
    ammo: 4.1,
    speed: 1.01,
    rate: 1.14,
    live: 3,
    gap: 2.9,
  },
  {
    name: ['Night Watch', '夜巡'],
    tip: ['Gunners and scouts together. Gunners first.', '炮手与侦察车同时出现，先打炮手。'],
    theme: 5,
    cover: [
      '...................',
      '..bb.s.......s.bb..',
      '..b.............b..',
      '.....bb.....bb.....',
      '.s...............s.',
      '...b...........b...',
    ],
    roster: 'g0 g4 g2 s1 s3 h2+ r2 h2 s2 r1 r3',
    ammo: 4.0,
    speed: 1.02,
    rate: 1.13,
    live: 3,
    gap: 2.9,
  },
  {
    name: ['Ember Pass', '余烬隘口'],
    tip: ['A tight pass: heavies lead, scouts flank.', '隘口狭窄，重型车领头，侦察车包抄。'],
    theme: 5,
    cover: [
      '...................',
      'sss.bb.......bb.sss',
      'ss...............ss',
      'ss.....b...b.....ss',
      '...................',
      '..bb...........bb..',
    ],
    roster: 'h2+ h2+ s0 s4 g2 g1 g3 s1 s3 r2 r2',
    ammo: 4.0,
    speed: 1.02,
    rate: 1.13,
    live: 3,
    gap: 2.9,
  },
  {
    name: ['Iron Gate', '铁闸'],
    tip: ['The gate holds three heavies. Use kits early.', '铁闸后有三辆重型车，尽早用维修包。'],
    theme: 5,
    cover: [
      '...................',
      '.ss.b.s.....s.b.ss.',
      '.ss.............ss.',
      '...b.b.......b.b...',
      '.s...............s.',
      '...................',
    ],
    roster: 'h2+ h1+ h3+ s0 s4 r2 r1 r3',
    ammo: 3.8,
    speed: 1.02,
    rate: 1.13,
    live: 3,
    gap: 2.9,
  },
  {
    name: ['Last Bulwark', '最后壁垒'],
    tip: ['Every kind of tank at once. Take them in order.', '所有车型同时出现，按顺序逐个击破。'],
    theme: 5,
    cover: [
      '...................',
      '.b.s.bb.....bb.s.b.',
      '.b.s...........s.b.',
      '...s.b.......b.s...',
      '...................',
      '..bb.s.......s.bb..',
    ],
    roster: 'h2+ s0 s4 g1 g3 h2+ s1 s3 r0 r4 g2',
    ammo: 3.8,
    speed: 1.02,
    rate: 1.13,
    live: 3,
    gap: 2.9,
  },
  {
    name: ['Bastion Prime', '堡垒核心'],
    tip: ['The last field. Spend rounds only on sure hits.', '最后一战，只在有把握时开火。'],
    theme: 5,
    cover: [
      '...................',
      '.ss.b.s.bbb.s.b.ss.',
      '.s...............s.',
      '...b.s.......s.b...',
      '.s.b...........b.s.',
      '...................',
    ],
    roster: 'h2+ h2+ s0 s4 s1 s3 r1 r2 g2 r3',
    ammo: 3.7,
    speed: 1.02,
    rate: 1.13,
    live: 3,
    gap: 2.9,
  },
];

function parseCover(n, rows) {
  if (rows.length !== ROWS || rows.some((row) => row.length !== COLS))
    throw new Error(`Field ${n} cover must be ${COLS}x${ROWS}`);
  const tiles = [];
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      if (ch !== 'b' && ch !== 's') throw new Error(`Field ${n} has unknown cover "${ch}"`);
      const x = GRID_X + c * PITCH,
        y = GRID_Y + r * PITCH;
      tiles.push({
        id: `${n}:${x}:${y}`,
        x,
        y,
        w: TILE,
        h: TILE,
        hp: ch === 's' ? null : 2,
        steel: ch === 's',
      });
    }),
  );
  // The beacon's own screen: three bricks in front and two bunkers beside it.
  for (const x of [204, 228, 252])
    tiles.push({ id: `${n}:${x}:256`, x, y: 256, w: TILE, h: TILE, hp: 2, steel: false });
  for (const x of [204, 256])
    tiles.push({ id: `${n}:bunker:${x}`, x, y: 282, w: 20, h: 26, hp: 2, steel: false });
  return tiles;
}

function parseRoster(n, text) {
  return text.split(' ').map((token) => {
    const match = /^([rghs])([0-4])(\+?)$/.exec(token);
    if (!match) throw new Error(`Field ${n} has a bad roster token "${token}"`);
    const role = ROLE_OF[match[1]];
    return { lane: Number(match[2]), role, hp: ROLES[role].hp + (match[3] ? 1 : 0) };
  });
}

function build(def, index) {
  const n = index + 1,
    roster = parseRoster(n, def.roster),
    hp = roster.reduce((sum, e) => sum + e.hp, 0);
  return {
    n,
    name: { en: def.name[0], zh: def.name[1] },
    tip: { en: def.tip[0], zh: def.tip[1] },
    theme: def.theme,
    tiles: parseCover(n, def.cover),
    roster,
    hp,
    ammo: Math.ceil(hp * def.ammo),
    speed: def.speed,
    rate: def.rate,
    live: def.live,
    gap: def.gap,
    start: def.start ?? FIRST_ARRIVAL,
  };
}

export const FIELDS = deepFreeze(DEFS.map(build));
export const FIELD_COUNT = FIELDS.length;
export const fieldOf = (n) => FIELDS[Math.max(1, Math.min(FIELD_COUNT, n)) - 1];
// Fresh, mutable cover for one field: bricks lose hit points as they are shot.
export const coverFor = (n) => fieldOf(n).tiles.map((t) => ({ ...t }));
