// Ember Knights campaign data: attack frame data, champion archetypes and the 20 duel stages.

// Rules shared by the duel, the champions' reading of the player and the tests.
export const RULES = {
  parryWindow: 0.18,
  parryCooldown: 0.5,
  parryStun: 1,
  guardLatch: 0.1,
  blockRecoil: 0.45,
  heavyRecoil: 0.6,
  chainWindow: 1.6,
  chainCost: 14,
  quickCost: 12,
  staminaRegen: 22,
  recoveryRegen: 6,
  windedAt: 60,
  windedPower: 0.5,
  roundPause: 1.8,
  maxRounds: 5,
};

export const BASE_MOVES = {
  light: {
    startup: 0.18,
    active: 0.16,
    recovery: 0.29,
    length: 28,
    damage: 10,
    guardCost: 15,
    knock: 65,
    cost: 12,
  },
  heavy: {
    startup: 0.44,
    active: 0.2,
    recovery: 0.66,
    length: 40,
    damage: 22,
    guardCost: 40,
    knock: 110,
    cost: 28,
  },
  thrust: {
    startup: 0.4,
    active: 0.14,
    recovery: 0.5,
    length: 44,
    damage: 13,
    guardCost: 21,
    knock: 80,
    cost: 16,
  },
};

/** Frame data for one attack: the base move, the champion's overrides, then the stage damage scale. */
export function attackSpec(type, moves = {}, damageScale = 1) {
  const spec = { ...BASE_MOVES[type], ...moves[type] };
  return { ...spec, damage: Math.round(spec.damage * damageScale) };
}

// A champion archetype fixes the weapon, the moves, the attack pattern and how it defends.
// `defense` lists reactions to a blow it sees coming; the first entries are the most likely.
const ARCHETYPES = {
  recruit: {
    gear: 'sword',
    accent: '#d29590',
    color: '#7b725d',
    preferred: 36,
    pattern: ['light', 'light', 'heavy'],
    defense: ['guard', 'parry'],
    moves: {
      light: { startup: 0.38, recovery: 0.65, damage: 9 },
      heavy: { startup: 0.65, recovery: 0.65, damage: 20 },
      thrust: { startup: 0.4, recovery: 0.65 },
    },
  },
  guard: {
    gear: 'shield',
    accent: '#d8a86a',
    color: '#947450',
    preferred: 44,
    pattern: ['guard', 'heavy', 'light', 'guard'],
    defense: ['guard', 'parry'],
    moves: {
      light: { startup: 0.4, recovery: 0.65, damage: 8 },
      heavy: { startup: 0.55, recovery: 0.65 },
      thrust: { startup: 0.4, recovery: 0.65 },
    },
  },
  duelist: {
    gear: 'saber',
    accent: '#c78aa8',
    color: '#8a637e',
    preferred: 40,
    lunge: true,
    pattern: ['feint', 'light', 'thrust', 'light'],
    defense: ['retreat', 'parry'],
    moves: {
      light: { startup: 0.38, recovery: 0.36, length: 31, damage: 8 },
      heavy: { startup: 0.5, recovery: 0.36, length: 43 },
      thrust: { startup: 0.4, recovery: 0.4, length: 47 },
    },
  },
  hammer: {
    gear: 'hammer',
    accent: '#ca8362',
    color: '#9e5847',
    preferred: 51,
    mass: 110,
    pattern: ['heavy', 'heavy', 'light'],
    defense: ['counter', 'parry', 'guard'],
    moves: {
      light: { startup: 0.38, recovery: 0.6, length: 32, damage: 12, knock: 75 },
      heavy: {
        startup: 0.7,
        recovery: 0.95,
        length: 44,
        damage: 26,
        knock: 135,
        armorAt: 0.2,
        poise: 1,
      },
      thrust: { startup: 0.38, recovery: 0.6, length: 32, damage: 12, knock: 75 },
    },
  },
  sentinel: {
    gear: 'spear',
    accent: '#8cbacb',
    color: '#557a90',
    preferred: 53,
    kite: true,
    pattern: ['guard', 'thrust', 'thrust', 'heavy'],
    defense: ['guard', 'retreat', 'parry'],
    moves: {
      light: { startup: 0.45, recovery: 0.62 },
      heavy: { startup: 0.58, recovery: 0.62 },
      thrust: { startup: 0.45, recovery: 0.62, length: 49 },
    },
  },
  regent: {
    gear: 'crown',
    accent: '#e0b060',
    color: '#a16e43',
    preferred: 44,
    pattern: ['light', 'heavy', 'guard', 'thrust', 'feint', 'heavy'],
    defense: ['parry', 'guard', 'retreat'],
    moves: {
      light: { startup: 0.38, recovery: 0.43, damage: 8 },
      heavy: { startup: 0.5, recovery: 0.66, armorAt: 0.12, poise: 1 },
      thrust: { startup: 0.4, recovery: 0.43 },
    },
  },
  berserker: {
    gear: 'axe',
    accent: '#e0725a',
    color: '#a8573d',
    preferred: 38,
    pattern: ['light', 'light', 'light', 'heavy'],
    defense: ['counter', 'parry', 'guard'],
    moves: {
      light: { startup: 0.38, recovery: 0.32, damage: 8, length: 30 },
      heavy: { startup: 0.55, recovery: 0.8, damage: 24, armorAt: 0.12, poise: 1 },
      thrust: { startup: 0.4, recovery: 0.32 },
    },
  },
  warden: {
    gear: 'sword',
    accent: '#9fb4d0',
    color: '#6b7f96',
    preferred: 46,
    pattern: ['guard', 'light', 'guard', 'heavy'],
    defense: ['parry', 'parry', 'guard'],
    moves: {
      light: { startup: 0.38, recovery: 0.5, damage: 8 },
      heavy: { startup: 0.55, recovery: 0.7 },
      thrust: { startup: 0.4, recovery: 0.5 },
    },
  },
  lancer: {
    gear: 'spear',
    accent: '#8cc9a8',
    color: '#5f8a77',
    preferred: 56,
    kite: true,
    pattern: ['thrust', 'thrust', 'guard', 'heavy'],
    defense: ['guard', 'retreat', 'parry'],
    moves: {
      light: { startup: 0.4, recovery: 0.5 },
      heavy: { startup: 0.6, recovery: 0.66 },
      thrust: { startup: 0.42, recovery: 0.55, length: 53, damage: 14 },
    },
  },
  bulwark: {
    gear: 'shield',
    accent: '#b4b4c6',
    color: '#8b8a99',
    preferred: 42,
    mass: 100,
    pattern: ['guard', 'guard', 'heavy', 'light'],
    defense: ['guard', 'guard', 'parry'],
    moves: {
      light: { startup: 0.4, recovery: 0.5, damage: 9, guardCost: 17 },
      heavy: { startup: 0.6, recovery: 0.7, damage: 24, guardCost: 46, armorAt: 0.12, poise: 2 },
      thrust: { startup: 0.4, recovery: 0.5 },
    },
  },
  dancer: {
    gear: 'saber',
    accent: '#e58aa5',
    color: '#b0607a',
    preferred: 38,
    lunge: true,
    pattern: ['feint', 'thrust', 'light', 'feint', 'light', 'thrust'],
    defense: ['retreat', 'parry'],
    moves: {
      light: { startup: 0.38, recovery: 0.34, length: 31, damage: 8 },
      heavy: { startup: 0.5, recovery: 0.4, length: 43 },
      thrust: { startup: 0.4, recovery: 0.38, length: 48 },
    },
  },
  marshal: {
    gear: 'hammer',
    accent: '#e09a62',
    color: '#b36b45',
    preferred: 52,
    mass: 110,
    pattern: ['heavy', 'guard', 'thrust', 'heavy', 'light'],
    defense: ['counter', 'parry', 'guard'],
    moves: {
      light: { startup: 0.4, recovery: 0.5, length: 32, damage: 12 },
      heavy: {
        startup: 0.62,
        recovery: 0.85,
        length: 44,
        damage: 26,
        knock: 135,
        armorAt: 0.12,
        poise: 2,
      },
      thrust: { startup: 0.4, recovery: 0.5, length: 46 },
    },
  },
};

const t = (en, zh) => ({ en, zh });
// Field order: id, archetype, name, arena, tier, then the tuning that rises through the campaign.
// reaction: seconds before the champion reacts to what it sees. react / punish / rhythm: the chance
// it defends a blow it sees, punishes a recovery it sees, or parries a repeated rhythm.
const ROWS = [
  {
    id: 'gate-recruit',
    who: 'recruit',
    name: t('Gate Recruit', '守门新兵'),
    arena: 'courtyard',
    tier: 'teach',
    lesson: t(
      'Quick (J) is fast, Heavy (K) hits hard. Strike during recovery.',
      '轻击(J)快，重击(K)重。趁收招时出手。',
    ),
    reaction: 0.42,
    react: 0.6,
    punish: 0.7,
    rhythm: 0.7,
    pace: 1.1,
    hp: 110,
    startupMin: 0.5,
  },
  {
    id: 'torch-squire',
    who: 'recruit',
    name: t('Torch Squire', '火把侍从'),
    arena: 'hall',
    tier: 'teach',
    lesson: t(
      'Hold Guard (S) when a blade swings in: blocks cost stamina only.',
      '剑锋袭来时按住举盾(S)：格挡只耗体力。',
    ),
    reaction: 0.4,
    react: 0.6,
    punish: 0.7,
    rhythm: 0.7,
    pace: 1,
    dmg: 1.1,
    poise: 1,
    hp: 110,
    startupMin: 0.5,
  },
  {
    id: 'copper-guard',
    who: 'guard',
    name: t('Copper Guard', '铜盾守卫'),
    arena: 'hall',
    tier: 'teach',
    lesson: t(
      'Guards shrug off quick pokes. Heavy blows (K) break a shield.',
      '举盾能挡轻击。重击(K)能击破盾牌。',
    ),
    reaction: 0.36,
    react: 0.65,
    punish: 0.7,
    rhythm: 0.75,
    pace: 1,
    poise: 1,
    hp: 140,
    startStamina: 60,
    startupMin: 0.5,
  },
  {
    id: 'ash-duelist',
    who: 'duelist',
    name: t('Ash Duelist', '灰烬剑客'),
    arena: 'garden',
    tier: 'teach',
    lesson: t(
      'Let the retreat finish, then meet the lunge with your guard.',
      '等后撤结束，用盾迎接突进。',
    ),
    reaction: 0.35,
    react: 0.65,
    punish: 0.75,
    rhythm: 0.75,
    pace: 0.85,
    poise: 1,
    hp: 130,
    startupMin: 0.5,
  },
  {
    id: 'forge-apprentice',
    who: 'hammer',
    name: t('Forge Apprentice', '炉火学徒'),
    arena: 'forge',
    tier: 'teach',
    lesson: t(
      'Tap Guard just before a blow lands to parry: one second of stun.',
      '落锤前一瞬轻按举盾可招架，敌人晕眩一秒。',
    ),
    reaction: 0.34,
    react: 0.7,
    punish: 0.75,
    rhythm: 0.8,
    pace: 1.2,
    hp: 120,
    poise: 2,
  },
  {
    id: 'rampart-watch',
    who: 'sentinel',
    name: t('Rampart Watch', '城垛哨兵'),
    arena: 'rampart',
    tier: 'teach',
    lesson: t(
      'Spears reach far. Block the thrust, then step in as it recovers.',
      '长枪攻击距离远。格挡突刺后趁收招近身。',
    ),
    reaction: 0.33,
    react: 0.7,
    punish: 0.75,
    rhythm: 0.8,
    pace: 0.95,
    poise: 2,
    hp: 130,
  },
  {
    id: 'shield-sergeant',
    who: 'guard',
    name: t('Shield Sergeant', '盾牌军士'),
    arena: 'cellar',
    tier: 'combo',
    lesson: t(
      'Chained swings tire you, and tired swings hit softer. Pause first.',
      '连续出手会疲惫，疲惫的挥击更轻。先停一停。',
    ),
    reaction: 0.32,
    react: 0.75,
    punish: 0.8,
    rhythm: 0.85,
    pace: 0.9,
    hp: 120,
    poise: 2,
  },
  {
    id: 'garden-fencer',
    who: 'duelist',
    name: t('Garden Fencer', '园林剑士'),
    arena: 'garden',
    tier: 'combo',
    lesson: t(
      'Do not chase a retreating fencer: it lunges as you close in.',
      '别追后撤的剑士：你靠近它就突进。',
    ),
    reaction: 0.31,
    react: 0.75,
    punish: 0.8,
    rhythm: 0.85,
    pace: 0.75,
    speed: 1.1,
    poise: 2,
  },
  {
    id: 'frost-sentinel',
    who: 'sentinel',
    name: t('Frost Sentinel', '寒霜哨兵'),
    arena: 'rampart',
    tier: 'combo',
    lesson: t(
      'Spear thrusts come in pairs. Guard both, then close in.',
      '长枪成对突刺。连挡两下，再近身。',
    ),
    reaction: 0.3,
    react: 0.8,
    punish: 0.8,
    rhythm: 0.85,
    pace: 0.8,
    poise: 2,
  },
  {
    id: 'forge-hammer',
    who: 'hammer',
    name: t('Forge Hammer', '熔炉重锤'),
    arena: 'forge',
    tier: 'combo',
    lesson: t(
      'A braced hammer resists quick pokes. Parry it, then punish.',
      '蓄势重锤不怕轻击。招架后再反击。',
    ),
    reaction: 0.3,
    react: 0.8,
    punish: 0.85,
    rhythm: 0.9,
    pace: 1,
    hp: 120,
    dmg: 1.1,
    poise: 2,
  },
  {
    id: 'cinder-berserker',
    who: 'berserker',
    name: t('Cinder Berserker', '灰烬狂战士'),
    arena: 'cellar',
    tier: 'combo',
    lesson: t(
      'He chains swings and tires. Guard the flurry, then strike back.',
      '他连续出手会疲劳。挡住连击再反击。',
    ),
    reaction: 0.29,
    react: 0.8,
    punish: 0.85,
    rhythm: 0.9,
    pace: 0.6,
    speed: 1.15,
    poise: 2,
    hp: 120,
  },
  {
    id: 'mirror-warden',
    who: 'warden',
    name: t('Mirror Warden', '镜厅典狱'),
    arena: 'hall',
    tier: 'combo',
    lesson: t(
      'It parries a repeated rhythm. Vary your timing and let it swing.',
      '它会招架重复的节奏。变换节拍，让它先出手。',
    ),
    reaction: 0.28,
    react: 0.85,
    punish: 0.85,
    rhythm: 0.9,
    pace: 0.95,
    poise: 3,
    hp: 120,
  },
  {
    id: 'lance-captain',
    who: 'lancer',
    name: t('Lance Captain', '长枪队长'),
    arena: 'bridge',
    tier: 'combo',
    lesson: t(
      'Two long thrusts, a guard, then a heavy. Parry the heavy.',
      '两记远刺，举盾，再接重击。招架那记重击。',
    ),
    reaction: 0.28,
    react: 0.85,
    punish: 0.9,
    rhythm: 0.9,
    pace: 0.8,
    hp: 120,
    poise: 3,
  },
  {
    id: 'furnace-warden',
    who: 'marshal',
    name: t('Furnace Warden', '熔炉典狱长'),
    arena: 'forge',
    tier: 'combo',
    lesson: t(
      'Armored swings cannot be interrupted. Guard or parry; never trade.',
      '披甲挥击无法打断。格挡或招架，别硬换。',
    ),
    reaction: 0.27,
    react: 0.85,
    punish: 0.9,
    rhythm: 0.95,
    pace: 1,
    hp: 130,
    poise: 3,
  },
  {
    id: 'ember-dancer',
    who: 'dancer',
    name: t('Ember Dancer', '余烬舞者'),
    arena: 'bridge',
    tier: 'master',
    lesson: t(
      'Quick feints and lunges. Keep your guard up and answer each lunge.',
      '快速佯攻与突进。保持举盾，逐一应对。',
    ),
    reaction: 0.26,
    react: 0.9,
    punish: 0.9,
    rhythm: 0.95,
    pace: 0.65,
    speed: 1.15,
    poise: 3,
    time: 50,
  },
  {
    id: 'iron-bulwark',
    who: 'bulwark',
    name: t('Iron Bulwark', '铁壁'),
    arena: 'cellar',
    tier: 'master',
    lesson: t(
      'Its guard rarely drops. Heavy blows wear it down: save stamina.',
      '它很少放下盾。重击能磨穿它：留好体力。',
    ),
    reaction: 0.26,
    react: 0.9,
    punish: 0.9,
    rhythm: 0.95,
    pace: 0.9,
    hp: 140,
    poise: 3,
  },
  {
    id: 'siege-marshal',
    who: 'marshal',
    name: t('Siege Marshal', '攻城元帅'),
    arena: 'rampart',
    tier: 'master',
    lesson: t(
      'Armored hammer blows behind a guard. Parry the heavy, then punish.',
      '披甲重锤藏在防守后。招架重击再反击。',
    ),
    reaction: 0.25,
    react: 0.9,
    punish: 0.95,
    rhythm: 1,
    pace: 0.8,
    hp: 140,
    dmg: 1.1,
    poise: 3,
  },
  {
    id: 'kiln-reaver',
    who: 'berserker',
    name: t('Kiln Reaver', '窑火掠夺者'),
    arena: 'forge',
    tier: 'master',
    lesson: t(
      'Relentless chains. Block, let his stamina drain, then hit heavy.',
      '攻势不断。格挡，等他体力耗尽，再用重击。',
    ),
    reaction: 0.24,
    react: 0.9,
    punish: 0.95,
    rhythm: 1,
    pace: 0.5,
    hp: 130,
    speed: 1.2,
    dmg: 1.1,
    poise: 3,
  },
  {
    id: 'pale-lancer',
    who: 'lancer',
    name: t('Pale Lancer', '苍白枪骑'),
    arena: 'bridge',
    tier: 'master',
    lesson: t(
      'Longest reach in the castle. Parry on its rhythm, then step inside.',
      '全城最远的射程。按节奏招架，再贴近。',
    ),
    reaction: 0.23,
    react: 0.95,
    punish: 0.95,
    rhythm: 1,
    pace: 0.7,
    hp: 150,
    dmg: 1.1,
    poise: 3,
  },
  {
    id: 'ember-regent',
    who: 'regent',
    name: t('Ember Regent', '余烬摄政'),
    arena: 'throne',
    tier: 'master',
    lesson: t(
      'Read each stance. Keep stamina for the next exchange.',
      '辨认每种架势，为下一轮交锋保留体力。',
    ),
    reaction: 0.22,
    react: 0.95,
    punish: 0.95,
    rhythm: 1,
    pace: 0.65,
    hp: 160,
    dmg: 1.1,
    speed: 1.1,
    poise: 3,
  },
];

const POISE_AT = 0.1;
const TOUGH_HP = 140;
export const TIER_LABEL = {
  teach: t('LESSON', '教学'),
  combo: t('COMBO', '连招'),
  master: t('MASTERY', '精通'),
};

// A stage's poise gives every move of the champion armor from early in its windup.
const withPoise = (moves, poise) =>
  Object.fromEntries(
    Object.entries(moves).map(([type, move]) => [
      type,
      poise > 0
        ? { ...move, armorAt: move.armorAt ?? POISE_AT, poise: Math.max(move.poise ?? 0, poise) }
        : move,
    ]),
  );

// Opening stages stretch every windup so slower players, children and touch players can read it.
const withFloor = (moves, floor) =>
  Object.fromEntries(
    Object.keys(BASE_MOVES).map((type) => {
      const move = attackSpec(type, moves);
      return [type, { ...moves[type], startup: Math.max(move.startup, floor) }];
    }),
  );

const resolve = (row) => {
  const archetype = ARCHETYPES[row.who];
  return {
    ...archetype,
    ...row,
    armoredHeavy: archetype.moves.heavy.armorAt !== undefined,
    moves: withPoise(withFloor(archetype.moves, row.startupMin ?? 0), row.poise ?? 0),
    style: row.who,
    hp: row.hp ?? 100,
    speed: row.speed ?? 1,
    dmg: row.dmg ?? 1,
    time: row.time ?? 60,
    startStamina: row.startStamina ?? 100,
    mass: archetype.mass ?? 80,
  };
};

export const STAGES = ROWS.map(resolve);
export const STAGE_COUNT = STAGES.length;

/** Short bilingual chips, shown only where a stage differs from the campaign's usual duel. */
export function stageTags(stage) {
  const tags = [];
  if (stage.hp >= TOUGH_HP) tags.push(t('TOUGH', '强韧'));
  if (stage.speed > 1) tags.push(t('SWIFT', '迅捷'));
  if (stage.dmg > 1) tags.push(t('FIERCE', '凶猛'));
  if (stage.time < 60) tags.push(t('SHORT CLOCK', '限时'));
  if (stage.startStamina < 100) tags.push(t('WINDED', '气喘'));
  if (stage.armoredHeavy) tags.push(t('ARMORED', '披甲'));
  if (stage.defense.filter((d) => d === 'parry').length * 2 > stage.defense.length)
    tags.push(t('READS RHYTHM', '读节奏'));
  return tags;
}
