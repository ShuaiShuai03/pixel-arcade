// Sector data: enemy mix, carrier variant, hazard schedule and scenery for every sector.
// The curve teaches one idea at a time (tiers), combines them next and ends in mastery.
import { SECTOR_TEXT } from './sky-raiders-text.js';

const KIND_CODES = { s: 'scout', k: 'skimmer', g: 'gunship', n: 'sniper', b: 'bomber' };
/** Per-kind body, drift, rate and score. `pattern` is the volley the kind fires. */
export const KINDS = {
  scout: {
    shape: 'scout',
    mass: 50,
    hp: 2,
    speed: 46,
    sway: 0,
    swing: 0,
    pattern: 'aim',
    score: 100,
  },
  skimmer: {
    shape: 'skimmer',
    mass: 50,
    hp: 2,
    speed: 46,
    sway: 80,
    swing: 1.25,
    pattern: 'burst',
    score: 100,
  },
  gunship: {
    shape: 'gunship',
    mass: 100,
    hp: 5,
    speed: 31,
    sway: 35,
    swing: 0.6,
    pattern: 'fan',
    score: 180,
  },
  sniper: {
    shape: 'sniper',
    mass: 40,
    hp: 2,
    speed: 40,
    sway: 25,
    swing: 0.9,
    pattern: 'lead',
    score: 140,
  },
  bomber: {
    shape: 'bomber',
    mass: 90,
    hp: 4,
    speed: 30,
    sway: 0,
    swing: 0,
    pattern: 'comb',
    score: 180,
  },
};

// Each row: id, tier, scenery, [sky, cloud, light], enemy codes, carrier, hazard.
// carrier: [shape, pattern cycle, core hp, turret hp, fire-interval scale]
// hazard: the strike kinds, cycled in order; timing tightens with the sector index.
const ROWS = [
  [
    'cloudbreak',
    'teach',
    'cloud',
    ['#162c42', '#26465d', '#31556a'],
    'sssgsg',
    ['carrier', ['fan'], 24, 0, 1],
    null,
  ],
  [
    'copper-coast',
    'teach',
    'coast',
    ['#293e52', '#6a5a56', '#474a4a'],
    'kskgks',
    ['carrier', ['burst'], 26, 0, 1],
    null,
  ],
  [
    'storm-channel',
    'teach',
    'storm',
    ['#232f4c', '#425778', '#4a5e7b'],
    'gksgksg',
    ['carrier', ['gap'], 28, 0, 1],
    ['lane'],
  ],
  [
    'dune-run',
    'teach',
    'desert',
    ['#3d3a3c', '#7a6552', '#a58a62'],
    'snsknsg',
    ['wasp', ['lead'], 28, 0, 1],
    ['lane'],
  ],
  [
    'night-convoy',
    'teach',
    'convoy',
    ['#14273c', '#344c62', '#243c50'],
    'gskgkgs',
    ['carrier', ['turrets'], 30, 9, 1],
    ['column', 'lane'],
  ],
  [
    'frost-field',
    'teach',
    'aurora',
    ['#1a2c3f', '#4a6a7e', '#5fa0a4'],
    'sbsbkb',
    ['wasp', ['comb'], 30, 0, 1],
    ['lane', 'column'],
  ],
  [
    'cinder-gate',
    'teach',
    'cinder',
    ['#352f45', '#74525c', '#49394b'],
    'kgsgkg',
    ['carrier', ['beam'], 32, 0, 1],
    ['column', 'lane'],
  ],
  [
    'reef-patrol',
    'teach',
    'reef',
    ['#17394a', '#2f6671', '#3a8d8a'],
    'nkbgsnkb',
    ['dread', ['ring'], 32, 0, 0.95],
    ['lane', 'column'],
  ],
  [
    'foundry-belt',
    'combo',
    'foundry',
    ['#2c2630', '#5b4a4d', '#7d5a48'],
    'sbgsbgsb',
    ['carrier', ['turrets', 'comb'], 34, 10, 0.95],
    ['grid', 'lane'],
  ],
  [
    'emerald-canopy',
    'combo',
    'forest',
    ['#15332f', '#2d5a49', '#3f7a58'],
    'nknkgnks',
    ['wasp', ['lead', 'burst'], 34, 0, 0.92],
    ['column', 'lane'],
  ],
  [
    'neon-harbor',
    'combo',
    'city',
    ['#1c2142', '#3a3f6e', '#d89a5a'],
    'gbgbsgbn',
    ['dread', ['ring', 'fan'], 36, 0, 0.9],
    ['grid', 'lane'],
  ],
  [
    'ash-storm',
    'combo',
    'storm',
    ['#2d2a33', '#5a5360', '#6f6672'],
    'gnkgnkgb',
    ['carrier', ['turrets', 'burst', 'beam'], 36, 10, 0.9],
    ['cross'],
  ],
  [
    'glacier-pass',
    'combo',
    'aurora',
    ['#16304a', '#5a8098', '#8fd0cf'],
    'nsnsbnsn',
    ['wasp', ['gap', 'lead'], 38, 0, 0.88],
    ['grid', 'lane', 'column'],
  ],
  [
    'sunken-fleet',
    'combo',
    'reef',
    ['#102c3a', '#1f5560', '#c98c66'],
    'bgbgkbgn',
    ['dread', ['comb', 'ring'], 38, 0, 0.88],
    ['grid', 'cross'],
  ],
  [
    'mesa-gauntlet',
    'combo',
    'desert',
    ['#3a2d36', '#8a5f55', '#c28b5c'],
    'nkgbsnkgb',
    ['carrier', ['turrets', 'lead', 'beam'], 40, 11, 0.86],
    ['cross', 'lane'],
  ],
  [
    'iron-skyway',
    'combo',
    'foundry',
    ['#222a38', '#48566a', '#8f6b4a'],
    'gbgngbgn',
    ['dread', ['ring', 'burst', 'turrets'], 40, 11, 0.85],
    ['grid', 'cross', 'lane'],
  ],
  [
    'crimson-dusk',
    'master',
    'cloud',
    ['#3b2538', '#7a4452', '#c0715c'],
    'nnsbkgnb',
    ['wasp', ['lead', 'comb', 'fan'], 42, 0, 0.82],
    ['lane', 'column', 'grid'],
  ],
  [
    'asteroid-belt',
    'master',
    'space',
    ['#0f1428', '#37405e', '#6b7390'],
    'bnbnkgbn',
    ['carrier', ['ring', 'beam', 'burst'], 42, 0, 0.8],
    ['cross', 'grid'],
  ],
  [
    'thunder-citadel',
    'master',
    'citadel',
    ['#232a44', '#4a5a7e', '#5d6a8c'],
    'gnbgnbgn',
    ['dread', ['turrets', 'comb', 'beam'], 44, 12, 0.78],
    ['column', 'cross', 'lane'],
  ],
  [
    'magma-rift',
    'master',
    'cinder',
    ['#3a2230', '#8a4a44', '#5a3042'],
    'kgnbgnkb',
    ['wasp', ['burst', 'lead', 'ring'], 44, 0, 0.76],
    ['cross', 'grid'],
  ],
  [
    'midnight-metropolis',
    'master',
    'city',
    ['#10162c', '#2c3558', '#e0b060'],
    'gbnbgnbn',
    ['dread', ['ring', 'comb', 'turrets'], 46, 12, 0.74],
    ['grid', 'lane', 'cross'],
  ],
  [
    'void-approach',
    'master',
    'space',
    ['#120f2a', '#3a2f5e', '#8a6fb0'],
    'nbnbgnbg',
    ['carrier', ['lead', 'ring', 'beam', 'comb'], 46, 0, 0.72],
    ['cross', 'grid', 'column'],
  ],
  [
    'admirals-wake',
    'master',
    'convoy',
    ['#0f2638', '#2f4a66', '#1d3a52'],
    'gnbgbnbgn',
    ['dread', ['turrets', 'lead', 'comb', 'beam'], 48, 13, 0.7],
    ['cross', 'lane', 'grid'],
  ],
  [
    'regent-carrier',
    'master',
    'citadel',
    ['#302c49', '#635575', '#3d3756'],
    'gnbkgnbkgn',
    ['dread', ['turrets', 'ring', 'comb', 'lead', 'beam'], 50, 14, 0.68],
    ['cross', 'grid', 'lane', 'column'],
  ],
];

/** Tags describing what a sector asks of the pilot, derived from its actual configuration. */
function focusOf(kinds, carrier, hazard) {
  const tags = new Set();
  const byKind = {
    scout: 'aim',
    skimmer: 'burst',
    gunship: 'fan',
    sniper: 'lead',
    bomber: 'curtain',
  };
  for (const kind of kinds) tags.add(byKind[kind]);
  const byPattern = {
    fan: 'fan',
    gap: 'fan',
    burst: 'burst',
    lead: 'lead',
    comb: 'curtain',
    ring: 'ring',
    beam: 'stream',
    turrets: 'turrets',
  };
  for (const pattern of carrier.pattern) tags.add(byPattern[pattern]);
  for (const kind of hazard?.kinds ?? []) {
    tags.add(kind);
    if (kind === 'cross') ['lane', 'column'].forEach((part) => tags.add(part));
  }
  return [...tags];
}

export const SECTORS = ROWS.map(([id, tier, scene, palette, codes, boss, strike], index) => {
  const kinds = [...codes].map((code) => KIND_CODES[code]),
    [shape, pattern, core, turrets, rate] = boss,
    carrier = { shape, pattern, core, turrets, rate },
    hazard = strike
      ? {
          kinds: strike,
          first: Math.max(3.2, 4.6 - index * 0.06),
          every: Math.max(3.4, 5.4 - index * 0.09),
          warn: Math.max(1.05, 1.3 - index * 0.011),
        }
      : null,
    [name, lesson] = SECTOR_TEXT[index];
  return {
    id,
    tier,
    scene,
    palette,
    kinds,
    carrier,
    hazard,
    rate: Math.max(0.55, 1 - index * 0.02),
    pace: 1 + index * 0.01,
    focus: focusOf(kinds, carrier, hazard),
    en: name.en,
    zh: name.zh,
    lesson,
  };
});
export const SECTOR_COUNT = SECTORS.length;
/** Starting weapon level when a sector is entered: later sectors begin better armed. */
export const sectorPower = (level) => (level < 5 ? 1 : level < 11 ? 2 : 3);
