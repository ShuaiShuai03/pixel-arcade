// Level data for Orbit Invaders: formations, enemy roles, boss patterns, bunkers and lessons.
// Levels 1-7 teach one idea each, 8-14 combine them and 15-20 are mastery tests.
const freeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

/** Per-role hit points, bounty and the volley a front-rank enemy of that role fires. */
export const ROLES = freeze({
  scout: { hp: 1, score: 100, fire: 'drop' },
  diver: { hp: 1, score: 150, fire: 'dive' },
  artillery: { hp: 2, score: 175, fire: 'aim' },
  gunner: { hp: 2, score: 175, fire: 'fan' },
  warden: { hp: 3, score: 200, fire: 'pair' },
  commander: { score: 1500, fire: 'boss' },
});
const ROLE_CODES = { S: 'scout', D: 'diver', A: 'artillery', G: 'gunner', W: 'warden' };
export const FAN_SPREAD = Object.freeze([-48, 0, 48]);
export const PAIR_OFFSETS = Object.freeze([-8, 8]);

const spread = (speeds, vy, delay) =>
  speeds.map((vx) => ({ vx, vy, offset: Math.round(vx / 3), delay }));
/** Boss patterns: three phases (healthy, hurt, desperate), each a warned volley and a gap. */
export const BOSSES = freeze({
  siege: {
    hp: 24,
    phases: [
      { gap: 1.8, shots: spread([-50, 0, 50], 145, 0.75) },
      {
        gap: 1.8,
        shots: [
          { vx: 0, vy: 165, aim: true, heavy: true, delay: 0.8 },
          { vx: -65, vy: 155, offset: -24, delay: 1 },
          { vx: 65, vy: 155, offset: 24, delay: 1 },
        ],
      },
      { gap: 1.65, shots: spread([-70, -35, 0, 35, 70], 175, 0.7) },
    ],
  },
  bulwark: {
    hp: 26,
    phases: [
      { gap: 1.9, shots: spread([-80, -40, 0, 40, 80], 150, 0.8) },
      {
        gap: 1.8,
        shots: [
          { vx: 0, vy: 160, aim: true, heavy: true, offset: -22, delay: 0.8 },
          { vx: 0, vy: 160, aim: true, heavy: true, offset: 22, delay: 0.95 },
          { vx: 0, vy: 150, delay: 0.8 },
        ],
      },
      { gap: 1.6, shots: spread([-135, -90, -45, 0, 45, 90, 135], 165, 0.7) },
    ],
  },
  rain: {
    hp: 30,
    phases: [
      {
        gap: 1.7,
        shots: spread([0, 0, 0, 0], 150, 0.75).map((s, i) => ({ ...s, offset: -30 + i * 20 })),
      },
      {
        gap: 1.7,
        shots: [
          { vx: 0, vy: 170, aim: true, lead: true, heavy: true, delay: 0.8 },
          ...spread([-60, 60], 160, 1),
        ],
      },
      { gap: 1.5, shots: spread([-135, -90, -45, 0, 45, 90, 135], 170, 0.7) },
    ],
  },
  dread: {
    hp: 30,
    phases: [
      { gap: 1.7, shots: spread([-80, -40, 0, 40, 80], 160, 0.7) },
      {
        gap: 1.8,
        shots: [
          { vx: 0, vy: 165, aim: true, lead: true, heavy: true, offset: -24, delay: 0.75 },
          { vx: 0, vy: 165, aim: true, lead: true, heavy: true, offset: 24, delay: 0.9 },
          ...spread([-70, 70], 160, 0.9),
        ],
      },
      {
        gap: 1.7,
        shots: [
          { vx: 0, vy: 165, aim: true, lead: true, heavy: true, delay: 0.8 },
          ...spread([-100, -66, -33, 33, 66, 100], 165, 0.8),
        ],
      },
    ],
  },
});

const STD_BUNKERS = [55, 165, 275, 385];
const THREE_BUNKERS = [90, 240, 390];
const lvl = (name, tip, tier, rest) => ({ name, tip, tier, ...rest });
const text = (en, zh) => ({ en, zh });
const BASE = {
  dx: 45,
  top: 62,
  volley: 1,
  dive: 0,
  lead: false,
  aimShare: 0,
  armor: 0,
  worn: 0,
  intro: 2.6,
};

const RAW = [
  lvl(
    text('Scout March', '侦察行军'),
    text(
      'Rounds fall straight down. Sidestep them and shoot through the gaps.',
      '炮弹笔直落下。横向躲开，并从空隙射击。',
    ),
    'teach',
    {
      rows: ['SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS'],
      speed: 20,
      gap: 1.6,
      vy: 115,
      bunkers: STD_BUNKERS,
      time: 110,
      intro: 4.5,
    },
  ),
  lvl(
    text('Cover Slots', '掩体射孔'),
    text(
      'Bunkers block both sides. Shoot a slot through one or use a gap.',
      '掩体会挡住双方炮弹：打出射孔，或从空隙射击。',
    ),
    'teach',
    {
      rows: ['SSSSSSS', 'SSSSSSS', 'SSSSSSS'],
      dx: 50,
      speed: 22,
      gap: 1.3,
      vy: 125,
      bunkers: STD_BUNKERS,
      time: 105,
    },
  ),
  lvl(
    text('Diving Wings', '俯冲之翼'),
    text(
      'A boxed diver is attacking: leave the marked spot and dodge its shot.',
      '框住的俯冲机即将攻击：离开标记位置并躲开它的炮弹。',
    ),
    'teach',
    {
      armor: 1,
      volley: 2,
      aimShare: 0.5,
      rows: ['SSSSSS', 'SSSSSS', 'D.DD.D'],
      dx: 58,
      speed: 23,
      gap: 0.8,
      vy: 160,
      dive: 5,
      bunkers: STD_BUNKERS,
      time: 100,
    },
  ),
  lvl(
    text('Crossfire Battery', '交叉炮阵'),
    text(
      'Artillery aims where you stand. Move after its warning appears.',
      '炮兵瞄准你所在的位置：预警出现后立刻移动。',
    ),
    'teach',
    {
      worn: 0,
      armor: 2,
      volley: 2,
      aimShare: 1,
      rows: ['AAAAA', 'SSSS', 'D.D.D'],
      dx: 80,
      speed: 23,
      gap: 0.85,
      vy: 160,
      dive: 6,
      bunkers: THREE_BUNKERS,
      time: 105,
    },
  ),
  lvl(
    text('Guard Drill', '护板演练'),
    text(
      'Rounds come in pairs. Press Shift for a plate that stops three hits.',
      '炮弹成对落下。按Shift展开可挡三发的护板。',
    ),
    'teach',
    {
      armor: 1,
      aimShare: 0.25,
      rows: ['SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS'],
      speed: 22,
      gap: 0.9,
      volley: 2,
      vy: 160,
      bunkers: STD_BUNKERS,
      time: 105,
    },
  ),
  lvl(
    text('Fan Gunners', '扇形炮手'),
    text(
      'Gunners fire a three-round fan. Stand between the rays or under cover.',
      '炮手发射三发扇形弹：站在射线之间或掩体之下。',
    ),
    'teach',
    {
      armor: 0,
      volley: 2,
      aimShare: 0.6,
      rows: ['GGGGG', 'SSSSSS', 'SS..SS'],
      dx: 64,
      speed: 24,
      gap: 0.9,
      vy: 135,
      bunkers: STD_BUNKERS,
      time: 150,
    },
  ),
  lvl(
    text('Siege Frigate', '围攻旗舰'),
    text(
      'Shoot the frigate between volleys; it fires harder as it weakens.',
      '趁间隙攻击旗舰；它受损后火力会增强。',
    ),
    'teach',
    {
      rows: ['SSS..SSS'],
      dx: 38,
      top: 105,
      boss: 'siege',
      speed: 17,
      gap: 1.8,
      vy: 140,
      bunkers: STD_BUNKERS,
      time: 130,
    },
  ),
  lvl(
    text('Twin Wardens', '双弹守卫'),
    text(
      'Armored wardens fire side-by-side pairs and take three hits.',
      '装甲守卫并排发射双弹，需要三发击毁。',
    ),
    'combo',
    {
      volley: 2,
      aimShare: 0.4,
      rows: ['WWWW', 'SSSSSS', 'SSSSSS'],
      dx: 70,
      speed: 19,
      gap: 0.9,
      vy: 140,
      bunkers: STD_BUNKERS,
      time: 110,
    },
  ),
  lvl(
    text('Lead Shot', '预判射击'),
    text(
      'Aimed rounds now lead your motion: reverse once the warning shows.',
      '瞄准弹会预判你的移动：预警出现后立刻反向。',
    ),
    'combo',
    {
      worn: 0,
      armor: 2,
      volley: 2,
      aimShare: 0.5,
      rows: ['AAAAA', 'SSSSSS', 'D.DD.D'],
      dx: 70,
      speed: 25,
      gap: 0.8,
      vy: 145,
      dive: 5,
      lead: true,
      bunkers: THREE_BUNKERS,
      time: 110,
    },
  ),
  lvl(
    text('Dive and Fan', '俯冲与扇射'),
    text(
      'Divers fire as they swoop while gunners fan out. Watch both.',
      '俯冲机边冲边射，炮手同时散射。两边都要留意。',
    ),
    'combo',
    {
      armor: 1,
      volley: 2,
      aimShare: 0.6,
      rows: ['GGGGG', 'SSSSSS', 'D.DD.D'],
      dx: 64,
      speed: 26,
      gap: 0.95,
      vy: 140,
      dive: 3.5,
      lead: true,
      bunkers: STD_BUNKERS,
      time: 160,
    },
  ),
  lvl(
    text('Thin Cover', '稀疏掩体'),
    text(
      'Cover is thin. Shelter under a bunker and step out to fire.',
      '掩体稀少：躲在掩体下，探出身开火。',
    ),
    'combo',
    {
      armor: 1,
      aimShare: 0.4,
      rows: ['GSSSSSSG', 'SSSSSSSS'],
      speed: 26,
      gap: 1.0,
      volley: 2,
      vy: 145,
      bunkers: THREE_BUNKERS,
      time: 140,
    },
  ),
  lvl(
    text('Fan Frigate', '扇幕旗舰'),
    text(
      'Its fans widen as it weakens. Slip between the rays and fire back.',
      '它受损后扇形弹会变宽：钻过射线之间并还击。',
    ),
    'combo',
    {
      rows: ['GGG..GGG'],
      dx: 38,
      top: 105,
      boss: 'bulwark',
      speed: 17,
      gap: 1.8,
      vy: 150,
      bunkers: THREE_BUNKERS,
      time: 190,
    },
  ),
  lvl(
    text('Heavy Rain', '重炮骤雨'),
    text(
      'Six batteries lead their shots. Cover is worn: keep moving.',
      '六座炮阵会预判射击，掩体已受损：保持移动。',
    ),
    'combo',
    {
      armor: 1,
      aimShare: 0.4,
      rows: ['AAAAAA', 'SSSSSS', 'SSSSSS'],
      dx: 64,
      speed: 24,
      gap: 0.95,
      volley: 2,
      vy: 150,
      lead: true,
      bunkers: THREE_BUNKERS,
      worn: 3,
      time: 115,
    },
  ),
  lvl(
    text('Pincer', '钳形攻势'),
    text(
      'Wardens pin you while divers swoop from the side. Use Shift early.',
      '守卫牵制你，俯冲机从侧面扑来。尽早使用Shift。',
    ),
    'combo',
    {
      armor: 1,
      aimShare: 1,
      rows: ['WWWWW', 'DDDDD', 'SSSSS'],
      dx: 70,
      speed: 27,
      gap: 1.0,
      vy: 150,
      dive: 3.5,
      lead: true,
      bunkers: THREE_BUNKERS,
      time: 115,
    },
  ),
  lvl(
    text('Warden Wall', '守卫火墙'),
    text(
      'A wall of pairs and fans. Break the front rank before it drops.',
      '成对弹与扇形弹组成火墙：在编队下压前先击破前排。',
    ),
    'master',
    {
      aimShare: 0.4,
      rows: ['WWWWWW', 'GGGGGG', 'SSSSSS'],
      dx: 64,
      speed: 24,
      gap: 0.95,
      volley: 2,
      vy: 150,
      bunkers: THREE_BUNKERS,
      time: 120,
    },
  ),
  lvl(
    text('Dive Storm', '俯冲风暴'),
    text(
      'Divers swoop every few seconds with led shots. Never stand still.',
      '俯冲机不断扑来并预判射击：不要原地不动。',
    ),
    'master',
    {
      armor: 1,
      aimShare: 0.7,
      rows: ['AAAAAAA', 'DDDDDDD', 'SSSSSSS'],
      dx: 55,
      speed: 28,
      gap: 1.1,
      volley: 3,
      vy: 150,
      dive: 3,
      lead: true,
      bunkers: THREE_BUNKERS,
      time: 120,
    },
  ),
  lvl(
    text('Bare Orbit', '空旷轨道'),
    text(
      'Two bunkers only. Plan a safe route between them before you fire.',
      '只有两座掩体：开火前先规划两者之间的安全路线。',
    ),
    'master',
    {
      aimShare: 0.5,
      rows: ['SSSSSSSS', 'GSSSSSSG', 'AAAAAAAA'],
      speed: 25,
      gap: 0.9,
      volley: 2,
      vy: 150,
      lead: true,
      bunkers: [140, 340],
      time: 125,
    },
  ),
  lvl(
    text('Rain Dreadnought', '弹幕战舰'),
    text(
      'Its wall of rounds leaves wide edges. Step beyond the wall.',
      '弹幕墙两侧留有空档：移出弹幕墙的宽度。',
    ),
    'master',
    {
      rows: ['AAA..AAA'],
      dx: 38,
      top: 105,
      boss: 'rain',
      speed: 17,
      gap: 1.7,
      vy: 150,
      bunkers: THREE_BUNKERS,
      time: 170,
    },
  ),
  lvl(
    text('Gauntlet', '火线试炼'),
    text(
      'Every enemy type at once. Hit the heavy hitters first and guard well.',
      '所有敌人同时出击：优先击毁重火力单位，并用好护板。',
    ),
    'master',
    {
      aimShare: 0.4,
      rows: ['WGAAGW', 'SDSSDS', 'SSSSSS'],
      dx: 64,
      speed: 29,
      gap: 0.9,
      volley: 2,
      vy: 150,
      dive: 3.5,
      lead: true,
      bunkers: THREE_BUNKERS,
      worn: 2,
      time: 125,
    },
  ),
  lvl(
    text("Orbit's End", '轨道终局'),
    text(
      'The final dreadnought uses every pattern. Read each warning.',
      '最终战舰会用上所有弹幕：看清每一次预警。',
    ),
    'master',
    {
      rows: ['WGD..DGW'],
      dx: 38,
      top: 105,
      boss: 'dread',
      speed: 17,
      gap: 1.5,
      vy: 160,
      bunkers: THREE_BUNKERS,
      time: 200,
    },
  ),
];

export const LEVELS = freeze(RAW.map((level) => ({ ...BASE, ...level })));
export const LEVEL_COUNT = LEVELS.length;
export const TIER_NAME = freeze({
  teach: text('Teaching', '教学'),
  combo: text('Combination', '组合'),
  master: text('Mastery', '精通'),
});

/** The level definition for a 1-based number; out-of-range numbers use the nearest level. */
export function levelOf(number) {
  const index = Math.floor(Number(number)) - 1;
  return LEVELS[Number.isFinite(index) ? Math.min(LEVEL_COUNT - 1, Math.max(0, index)) : 0];
}
/** Phase index (0 healthy, 1 hurt, 2 desperate) for a boss from its remaining hit points. */
export function bossPhase(boss) {
  return boss.hp > (boss.maxHp * 2) / 3 ? 0 : boss.hp > boss.maxHp / 3 ? 1 : 2;
}

/** The enemy fleet of a level, laid out from its row strings (S scout, D diver, A artillery, G gunner, W warden; '.' is a gap). */
export function makeFleet(number) {
  const level = levelOf(number),
    fleet = [];
  const add = (x, y, role, type, hp) =>
    fleet.push({
      id: number * 100 + fleet.length + 1,
      x,
      y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      type,
      role,
      mode: 'formation',
      homeY: y,
      slotX: x - 240,
      slotY: y - 60,
      flash: 0,
    });
  if (level.boss) add(240, 65, 'commander', 3, BOSSES[level.boss].hp);
  level.rows.forEach((row, r) =>
    [...row].forEach((code, c) => {
      const role = ROLE_CODES[code];
      if (role)
        add(
          240 + (c - (row.length - 1) / 2) * level.dx,
          level.top + r * 29,
          role,
          r,
          ROLES[role].hp + (ROLES[role].fire === 'drop' || role === 'diver' ? level.armor : 0),
        );
    }),
  );
  return fleet;
}
const RUSH_CAP = 5;
/** Sweep speed of a level's fleet, rising a little as the fleet thins out. */
export const fleetSpeed = (level, remaining, total) =>
  level.speed + Math.min(RUSH_CAP, Math.max(0, Math.floor(total / 2) - remaining) * 0.65);
/** The last ships fire at half rate, so a lone survivor can be chased down. */
export const STRAGGLERS = 2;

/** Host-visible end message for a finished run. */
export function endMessage(env, { won, reason }) {
  if (won)
    return env.t(
      `All ${LEVEL_COUNT} encounters cleared. The colony stands!`,
      `${LEVEL_COUNT}场战斗全部通关，殖民地守住了！`,
    );
  if (reason === 'time')
    return env.t(
      'Time ran out before the fleet was stopped. Clear the formation sooner.',
      '时间耗尽，敌方编队仍未被击退。请更快清除编队。',
    );
  if (reason === 'breach')
    return env.t('The formation crossed the defense line.', '敌方编队越过了防线。');
  return env.t(
    'Turret lost. Cover and guard timing can save the next crew.',
    '炮台损毁。利用掩体和护板时机保护下一组乘员。',
  );
}
