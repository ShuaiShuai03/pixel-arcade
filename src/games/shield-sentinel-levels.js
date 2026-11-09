// Shield Sentinel level table: every encounter is data.
//   rest        seconds between one attack ending and the next one starting
//   crawlers    seconds after the intro at which a crawler climbs out of a portal
//   foes        turrets (one reflected orb per hit point) and guardians
const TURRET_BOX = { hw: 10, hh: 10 };
const GUARDIAN_BOX = { hw: 22, hh: 16 };
const FULL_PATTERN = ['orb', 'slug', 'orb', 'lance', 'slam', 'orb', 'orb'];

const turret = (x, y, hp, pattern) =>
  Object.freeze({
    type: 'turret',
    x,
    y,
    hp,
    pattern: Object.freeze(pattern),
    ...TURRET_BOX,
  });
const guardian = (hp, pattern) =>
  Object.freeze({
    type: 'guardian',
    x: 240,
    y: 52,
    hp,
    pattern: Object.freeze(pattern),
    ...GUARDIAN_BOX,
  });

const level = (tier, en, zh, tipEn, tipZh, rules, foes) =>
  Object.freeze({
    tier,
    name: Object.freeze({ en, zh }),
    tip: Object.freeze({ en: tipEn, zh: tipZh }),
    rest: rules.rest,
    orbSpeed: rules.orb,
    slugSpeed: rules.slug ?? rules.orb - 10,
    crawlerSpeed: rules.crawlerSpeed ?? 0,
    crawlers: Object.freeze(rules.crawlers ?? []),
    maxCrawlers: rules.maxCrawlers ?? 3,
    guardian: foes.some((f) => f.type === 'guardian'),
    foes: Object.freeze(foes),
  });

export const LEVELS = Object.freeze([
  // Teaching: one new idea at a time.
  level(
    'teach',
    'First Reflection',
    '第一次反射',
    'Hold Space to raise your shield toward the cyan orb. It bounces back and cracks the turret.',
    '朝青色光球按住空格举盾，光球会弹回并击裂炮台。',
    { rest: 1.4, orb: 120 },
    [turret(110, 46, 1, ['orb'])],
  ),
  level(
    'teach',
    'Two Turrets',
    '双炮台',
    'Hold Space and press the arrows to face the charging turret. Each reflected orb cracks it once.',
    '按住空格并用方向键面向正在充能的炮台。每个被反射的光球击裂它一次。',
    { rest: 1.2, orb: 135 },
    [turret(90, 46, 2, ['orb']), turret(390, 46, 2, ['orb'])],
  ),
  level(
    'teach',
    'Orange Slugs',
    '橙色弹',
    'Orange slugs are only blocked, never reflected. Cyan orbs still bounce back.',
    '橙色弹只能被挡下，不会反射。青色光球仍会弹回。',
    { rest: 1.1, orb: 140, slug: 135 },
    [turret(90, 46, 2, ['slug', 'orb']), turret(390, 46, 2, ['orb', 'slug'])],
  ),
  level(
    'teach',
    'Crawler Hatch',
    '爬虫舱口',
    'Crawlers climb out of purple portals. Face one and tap X to bash it, or hold it off with the shield.',
    '爬虫从紫色传送门爬出。面向它按X重击，或用盾顶住它。',
    { rest: 1.1, orb: 140, crawlerSpeed: 42, crawlers: [3, 7, 11, 15, 19] },
    [turret(150, 46, 2, ['orb']), turret(464, 170, 2, ['orb'])],
  ),
  level(
    'teach',
    'Red Lanes',
    '红色通道',
    "A red lane is a lance: the shield can't stop it. Step sideways out of the lane before it fires.",
    '红色通道是长矛，盾挡不住。在它发射前侧移离开通道。',
    { rest: 1.0, orb: 145 },
    [turret(90, 46, 2, ['orb', 'lance']), turret(390, 46, 2, ['orb', 'orb', 'lance'])],
  ),
  level(
    'teach',
    'Wall Turrets',
    '墙边炮台',
    'Turrets also guard the side walls. Watch which one is charging and turn to face it.',
    '侧墙上也有炮台。留意哪一个在充能，并转向它。',
    { rest: 1.0, orb: 145, slug: 135 },
    [
      turret(16, 170, 2, ['orb', 'slug']),
      turret(240, 46, 1, ['orb']),
      turret(464, 170, 2, ['slug', 'orb']),
    ],
  ),
  level(
    'teach',
    'Stone Warden',
    '石砌看守',
    'A purple circle is a slam: run out. It breaks your shield but cracks the warden, so orbs hit twice.',
    '紫圈是重击：快跑出圆圈。重击会击碎你的盾，但会震裂看守，此时反射的光球造成双倍伤害。',
    { rest: 0.9, orb: 150, slug: 140 },
    [guardian(8, ['orb', 'slam', 'orb', 'orb', 'slam', 'orb', 'orb'])],
  ),
  // Combination: the ideas arrive together.
  level(
    'combo',
    'Crossfire',
    '交叉火力',
    'Turrets on the roof and both walls take turns. After each shot, turn to the next one that charges.',
    '屋顶和两侧墙上的炮台轮流开火，几乎不停歇。每发之后转向下一个充能的炮台。',
    { rest: 0.6, orb: 150, slug: 140 },
    [
      turret(16, 170, 2, ['orb', 'slug']),
      turret(240, 46, 2, ['orb', 'orb', 'slug']),
      turret(464, 170, 2, ['slug', 'orb']),
    ],
  ),
  level(
    'combo',
    'Pincer',
    '钳形攻势',
    'Turrets, lances and crawlers at once. Deal with whatever is closest first.',
    '炮台、长矛和爬虫同时来袭。先处理最近的威胁。',
    { rest: 0.8, orb: 160, slug: 145, crawlerSpeed: 42, crawlers: [6, 16, 28] },
    [
      turret(60, 46, 2, ['orb', 'lance']),
      turret(240, 46, 2, ['orb', 'slug']),
      turret(420, 46, 2, ['orb', 'lance']),
    ],
  ),
  level(
    'combo',
    'Gate Guardian',
    '门前守卫',
    'The Guardian fires orbs, slugs and lances. Reflect orbs, then run from the slam to crack it open.',
    '守卫会发射光球、橙色弹和长矛。反射光球，并躲开重击来震裂它。',
    { rest: 0.7, orb: 160, slug: 145, crawlerSpeed: 40, crawlers: [10, 24] },
    [guardian(6, FULL_PATTERN)],
  ),
  level(
    'combo',
    'Lance Alley',
    '长矛小巷',
    'Lances come from three turrets. After each lance, face the next orb before it lands.',
    '三座炮台都会射出长矛。每次躲开长矛后，在光球落下前转向它。',
    { rest: 0.8, orb: 160 },
    [
      turret(60, 46, 2, ['orb', 'lance']),
      turret(240, 46, 2, ['lance', 'orb']),
      turret(420, 46, 2, ['orb', 'lance']),
    ],
  ),
  level(
    'combo',
    'Crawler Pit',
    '爬虫坑',
    'Crawlers keep coming. Bash the ones that reach you and keep the shield for incoming shots.',
    '爬虫源源不断。重击逼近的爬虫，把盾留给来袭的弹。',
    { rest: 0.9, orb: 150, slug: 140, crawlerSpeed: 46, crawlers: [3, 8, 13, 18, 24] },
    [turret(110, 46, 2, ['orb', 'slug', 'lance']), turret(370, 46, 2, ['slug', 'orb'])],
  ),
  level(
    'combo',
    'Slug Wall',
    '弹幕墙',
    'Four turrets fire slugs and orbs. Block slugs, reflect orbs, and lower the shield between shots.',
    '四座炮台发射橙色弹和光球。挡下橙色弹，反射光球，并在两发之间放下盾。',
    { rest: 0.4, orb: 165, slug: 150 },
    [
      turret(70, 46, 2, ['slug', 'orb']),
      turret(410, 46, 2, ['orb', 'slug']),
      turret(16, 170, 2, ['orb', 'slug']),
      turret(464, 170, 2, ['slug', 'orb']),
    ],
  ),
  level(
    'combo',
    'Second Warden',
    '第二位看守',
    'A faster Warden with crawlers. Bash them, dodge the slam, reflect orbs while it is cracked.',
    '看守出手更快，还会放出爬虫。击退爬虫，躲开重击，并在它碎裂时反射光球。',
    { rest: 0.6, orb: 170, slug: 150, crawlerSpeed: 44, crawlers: [8, 20] },
    [guardian(7, FULL_PATTERN)],
  ),
  // Mastery: speed, volume and crossing threats.
  level(
    'master',
    'Fast Orbs',
    '疾速光球',
    'Orbs fly much faster. Face each turret as soon as its ring starts to shrink.',
    '光球飞得快得多。炮台的圆环一开始收缩，就转向它。',
    { rest: 0.4, orb: 220, slug: 190, crawlerSpeed: 60, crawlers: [6, 12, 18] },
    [
      turret(80, 46, 2, ['orb', 'slug']),
      turret(240, 46, 2, ['orb', 'orb', 'slug']),
      turret(400, 46, 2, ['slug', 'orb']),
    ],
  ),
  level(
    'master',
    'Siege',
    '围攻',
    'Turrets take turns. Lower the shield to step out of a lance lane: you cannot move while it is up.',
    '墙边和屋顶的炮台轮流开火。侧移躲长矛前先放下盾：举盾时无法移动。',
    { rest: 0.3, orb: 200, slug: 175, crawlerSpeed: 66, crawlers: [5, 10, 15, 20, 25] },
    [
      turret(60, 46, 2, ['orb', 'lance']),
      turret(420, 46, 2, ['orb', 'slug']),
      turret(16, 170, 2, ['orb', 'slug']),
      turret(464, 170, 2, ['orb', 'lance']),
    ],
  ),
  level(
    'master',
    'Swarm',
    '虫群',
    'Seven crawlers swarm in while the turrets keep firing. Bash them early, never let a crowd form.',
    '七只爬虫涌来，炮台仍在开火。尽早重击，别让它们聚成一群。',
    {
      rest: 0.7,
      orb: 175,
      slug: 160,
      crawlerSpeed: 56,
      maxCrawlers: 3,
      crawlers: [2, 5, 8, 11, 14, 17, 20],
    },
    [
      turret(120, 46, 2, ['orb', 'slug', 'orb', 'lance']),
      turret(464, 170, 2, ['orb', 'orb', 'lance']),
    ],
  ),
  level(
    'master',
    'Iron Warden',
    '铁甲看守',
    'A faster Warden barely pauses. Reflect orbs, block slugs, run from the slam and bash crawlers.',
    '更快的看守几乎不停手。反射光球，挡下橙色弹，躲开重击并击退爬虫。',
    { rest: 0.3, orb: 210, slug: 185, crawlerSpeed: 66, crawlers: [5, 11, 17, 24] },
    [guardian(8, FULL_PATTERN)],
  ),
  level(
    'master',
    'Gauntlet',
    '试炼长廊',
    'Five turrets, every shot type and crawlers. Read the telegraphs and keep the shield bar alive.',
    '五座炮台、所有弹种和爬虫。读懂预警，别让盾能量耗尽。',
    { rest: 0.3, orb: 210, slug: 185, crawlerSpeed: 70, crawlers: [6, 11, 16, 21, 26] },
    [
      turret(50, 46, 2, ['orb', 'lance']),
      turret(145, 46, 2, ['slug', 'orb']),
      turret(240, 46, 2, ['orb', 'orb', 'slug']),
      turret(335, 46, 2, ['orb', 'slug']),
      turret(430, 46, 2, ['lance', 'orb']),
    ],
  ),
  level(
    'master',
    'Grand Guardian',
    '终极巨像',
    'The final Guardian fires almost without pause. Every skill at once: reflect, block, dodge, bash.',
    '最终巨像几乎不停歇地攻击。反射、格挡、闪避、重击，一起上。',
    { rest: 0.3, orb: 215, slug: 190, crawlerSpeed: 62, crawlers: [6, 12, 19, 26, 33] },
    [guardian(10, ['orb', 'orb', 'slug', 'lance', 'slam', 'orb', 'slug', 'orb'])],
  ),
]);

export const LEVEL_COUNT = LEVELS.length;

/** A 1-based level number; junk and out-of-range values clamp into the table. */
export function levelNumber(n) {
  const k = Math.floor(Number(n));
  return Number.isFinite(k) ? Math.min(LEVEL_COUNT, Math.max(1, k)) : 1;
}
export const levelOf = (n) => LEVELS[levelNumber(n) - 1];
