// Meteor Drift sector table: every sector is data.
//   S stone   I ice   F iron   V volatile   (capital = large rock, lowercase = medium rock)
// Stone splits in two, ice in three, iron takes two hits per large piece, volatile lights a fuse
// and blasts into four small pieces. `pace` adds to the rocks' drift speed in pixels per second.
import { clamp } from '../shared/utils.js';
import { WIDTH, HEIGHT, torusDistance } from './meteor-drift-math.js';
import { radius, energyDensity, splitCount, childSize } from './meteor-drift-physics.js';

const ROCKS = Object.freeze({
  S: Object.freeze({ kind: 'stone', size: 3 }),
  I: Object.freeze({ kind: 'ice', size: 3 }),
  F: Object.freeze({ kind: 'iron', size: 3 }),
  V: Object.freeze({ kind: 'volatile', size: 3 }),
  s: Object.freeze({ kind: 'stone', size: 2 }),
  i: Object.freeze({ kind: 'ice', size: 2 }),
  f: Object.freeze({ kind: 'iron', size: 2 }),
  v: Object.freeze({ kind: 'volatile', size: 2 }),
});
const BASE_SPEED = 25;
const SPEED_SPREAD = 16;
// Rounds supplied per hit needed: small, quick or numerous fragments are harder to hit.
const AMMO_PER_HIT = Object.freeze({ stone: 2.6, iron: 2.6, ice: 3, volatile: 3.6 });
const MIN_AMMO = 40;
// Rocks appear in the open middle band, clear of the HUD and the opening tip.
const SPAWN = Object.freeze({ left: 24, right: WIDTH - 24, top: 70, bottom: 232 });
// The last sectors supply fewer rounds per hit: spend them on aimed shots.
const SCARCE = 0.85;
// Volatile fragments and the medium swarm are hard to hit: 30% more rounds.
const GENEROUS = 1.3;
const SAFE_RADIUS = 105;
const ROCK_GAP = 57;
const SPAWN_ATTEMPTS = 100;

/** The fewest hits that clear a rock and every fragment it leaves. */
export function hitsToClear(kind, size, top = true) {
  const hp = kind === 'iron' && (top || size > 1) ? 2 : 1;
  if (size <= 1) return hp;
  return hp + splitCount(kind) * hitsToClear(kind, childSize(kind, size), false);
}
const sector = (en, zh, tipEn, tipZh, rocks, pace = 0, supplyScale = 1) => {
  const hits = [...rocks].reduce((sum, c) => sum + hitsToClear(ROCKS[c].kind, ROCKS[c].size), 0),
    supply = [...rocks].reduce(
      (sum, c) => sum + hitsToClear(ROCKS[c].kind, ROCKS[c].size) * AMMO_PER_HIT[ROCKS[c].kind],
      0,
    );
  return Object.freeze({
    name: Object.freeze({ en, zh }),
    tip: Object.freeze({ en: tipEn, zh: tipZh }),
    rocks,
    pace,
    hits,
    ammo: Math.max(MIN_AMMO, Math.ceil(supply * supplyScale)),
  });
};

export const LEVELS = Object.freeze([
  // Teaching: one idea per sector.
  sector(
    'First Flight',
    '初次飞行',
    'Turn with Left and Right, fire with Space. Each hit splits a rock: clear every piece. Your shield holds for a few seconds.',
    '左右键转向，空格射击。每次命中都会让陨石裂开，清空所有碎片。开局有数秒护盾。',
    'SS',
  ),
  sector(
    'Drifting',
    '惯性滑行',
    'Thrust (Up) keeps pushing you after you let go. Hold Down to brake before you drift into a rock.',
    '推进（上键）松手后仍会继续滑行。撞上陨石之前按住下键制动。',
    'SSS',
  ),
  sector(
    'Fragments',
    '碎石',
    'Rocks split twice before they turn to dust. Shots fade after a short flight and ammunition is limited, so close in and aim.',
    '陨石会裂开两次才化为尘埃。子弹飞不远，弹药也有限，请靠近并瞄准。',
    'SSSS',
  ),
  sector(
    'Ice',
    '冰晶',
    'Ice splits into three pieces and bursts outward with trapped gas. Shoot it from a distance.',
    '冰晶会裂成三块，并因内部气体向外迸射。请在远处射击。',
    'II',
  ),
  sector(
    'Ice Field',
    '冰原',
    'Three icy rocks make a lot of fragments. Brake and keep turning toward the next piece.',
    '三块冰晶会产生大量碎片。制动后持续转向下一块目标。',
    'III',
    4,
  ),
  sector(
    'Iron',
    '铁质',
    'Iron takes two hits. Shift fires a charged burst that deals double damage, then recharges for seven seconds.',
    '铁质陨石需要击中两次。Shift 发射蓄能弹，伤害翻倍，七秒后再次就绪。',
    'FF',
  ),
  sector(
    'Iron Belt',
    '铁带',
    'Three iron rocks. Save the Shift burst for the biggest piece in your way.',
    '三块铁质陨石。把 Shift 蓄能弹留给挡路的最大一块。',
    'FFF',
    4,
  ),
  sector(
    'Volatile',
    '易爆',
    'Volatile rocks light a fuse when hit, then blast into four pieces. Back away, or use the Shift burst to skip the fuse.',
    '易爆陨石被击中后会点燃引信，随后炸成四块。请后退，或用 Shift 蓄能弹跳过引信。',
    'VV',
    0,
    GENEROUS,
  ),
  sector(
    'Fuse Line',
    '引信线',
    'Three volatile rocks. Shoot one, then turn away from the blast while its fuse burns.',
    '三块易爆陨石。击中一块后，趁引信燃烧转向别处。',
    'VVV',
    4,
    GENEROUS,
  ),
  // Combination: two or more materials.
  sector(
    'Stone and Ice',
    '岩石与冰晶',
    'Stone and ice drift together. Clear the ice first: it throws the most pieces.',
    '岩石与冰晶一起漂移。先打冰晶，它碎得最多。',
    'SSII',
  ),
  sector(
    'Stone and Iron',
    '岩石与铁质',
    'Stone breaks easily; iron does not. Use plain rounds on the stone and the Shift burst on the iron.',
    '岩石易碎，铁质不易。岩石用普通弹，铁质用 Shift 蓄能弹。',
    'SSFF',
  ),
  sector(
    'Ice and Iron',
    '冰晶与铁质',
    'Ice scatters and iron shrugs off single shots. Keep moving between the two.',
    '冰晶四散，铁质能扛住单发子弹。在两者之间保持移动。',
    'IIFF',
    6,
  ),
  sector(
    'Cold Fire',
    '冷焰',
    'Ice and volatile rocks together. A volatile blast can push icy fragments straight at you.',
    '冰晶和易爆陨石同在。爆炸可能把冰碎片推向你。',
    'IIVV',
    6,
  ),
  sector(
    'Hot Iron',
    '炽热铁块',
    'Iron and volatile rocks together. Burst the iron, and let the volatile fuses burn from afar.',
    '铁质与易爆陨石同在。用蓄能弹打铁质，在远处让易爆引信燃烧。',
    'FFVV',
    6,
  ),
  sector(
    'Every Material',
    '四种矿石',
    'One of each: stone, ice, iron and volatile. Choose your order before you fire.',
    '岩石、冰晶、铁质、易爆各一块。开火前先想好顺序。',
    'SIFV',
    8,
  ),
  sector(
    'Crowded Belt',
    '拥挤陨石带',
    'Five large rocks of four kinds. Brake often so that you can steer between the fragments.',
    '五块大陨石，四种材质。经常制动，才能在碎片之间转向。',
    'SSIFV',
    8,
  ),
  // Mastery: speed, volume and mixed fragments.
  sector(
    'Fast Belt',
    '高速带',
    'Every rock moves much faster. Lead your shots and do not drift: brake early.',
    '所有陨石都快得多。射击要提前量，不要乱漂，早点制动。',
    'SIFV',
    20,
  ),
  sector(
    'Swarm',
    '陨石群',
    'Nine medium rocks of four kinds. Each needs fewer hits, but there are many to track.',
    '九块中型陨石，四种材质。每块所需命中较少，但要盯住的目标很多。',
    'ssiiffvvs',
    12,
    GENEROUS,
  ),
  sector(
    'Powder Keg',
    '火药桶',
    'Four volatile rocks at once. Keep a wide gap between you and any lit fuse.',
    '四块易爆陨石同时出现。与燃着引信的陨石保持足够距离。',
    'VVVV',
    10,
  ),
  sector(
    'Iron Storm',
    '铁暴',
    'Four iron rocks and one ice rock. Spend Shift bursts wisely: they recharge slowly.',
    '四块铁质陨石和一块冰晶。慎用 Shift 蓄能弹，它恢复得很慢。',
    'FFFFI',
    10,
    SCARCE,
  ),
  sector(
    'Grand Mix',
    '大混战',
    'Six large rocks of all four kinds. Clear one corner at a time and keep your ammunition for the end.',
    '六块大陨石，四种材质齐全。一次清理一个角落，把弹药留到最后。',
    'SSIIFV',
    10,
    SCARCE,
  ),
  sector(
    'The Gauntlet',
    '终极考验',
    'Six fast large rocks of every kind. Brake, aim, burst and survive.',
    '六块高速大陨石，材质齐全。制动、瞄准、蓄能、活下来。',
    'SIIFFV',
    18,
    SCARCE,
  ),
]);
export const LEVEL_COUNT = LEVELS.length;
export const clampLevel = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
};

function spawnPoint(random, placed, avoid) {
  let best = null,
    bestGap = -Infinity;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const candidate = {
      x: SPAWN.left + random() * (SPAWN.right - SPAWN.left),
      y: SPAWN.top + random() * (SPAWN.bottom - SPAWN.top),
    };
    const gap = Math.min(
      torusDistance(candidate, avoid) - SAFE_RADIUS,
      ...placed.map((r) => torusDistance(candidate, r) - ROCK_GAP),
    );
    if (gap > 0) return candidate;
    if (gap > bestGap) [best, bestGap] = [candidate, gap];
  }
  // Crowded field: settle for the roomiest point tried.
  return best;
}
/** The opening rocks of a sector, away from `avoid` (the pilot) and from each other. */
export function makeRocks(level, random, avoid = { x: WIDTH / 2, y: HEIGHT / 2 }) {
  const spec = LEVELS[clampLevel(level) - 1],
    rocks = [];
  for (const letter of spec.rocks) {
    const { kind, size } = ROCKS[letter],
      point = spawnPoint(random, rocks, avoid),
      heading = random() * Math.PI * 2,
      speed = BASE_SPEED + random() * SPEED_SPREAD + spec.pace,
      mass = radius(size) ** 2;
    rocks.push({
      ...point,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      size,
      radius: radius(size),
      mass,
      kind,
      storedEnergy: mass * energyDensity(kind),
      hp: kind === 'iron' ? 2 : 1,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 1.3,
    });
  }
  return rocks;
}
