import { DEG } from './dash-duelist-geometry.js';

// Attack shapes are fixed in the world when the windup starts: what is drawn is what hits.
// Heavy attacks cost 3 HP and cover more ground than walking can leave in time: dash through them.
export const ATTACKS = Object.freeze({
  slash: Object.freeze({
    shape: 'sector',
    label: Object.freeze(['Slash', '斩击']),
    windup: 0.9,
    active: 0.14,
    r1: 58,
    half: 55 * DEG,
  }),
  cut: Object.freeze({
    shape: 'sector',
    label: Object.freeze(['Cut', '劈砍']),
    windup: 0.9,
    active: 0.14,
    r1: 60,
    half: 45 * DEG,
  }),
  thrust: Object.freeze({
    shape: 'lane',
    label: Object.freeze(['Thrust', '突刺']),
    windup: 0.8,
    active: 0.16,
    len: 100,
    hw: 11,
    lunge: 36,
  }),
  sweep: Object.freeze({
    shape: 'ring',
    label: Object.freeze(['Ring sweep', '环形横扫']),
    windup: 1.1,
    active: 0.16,
    r1: 56,
    half: Math.PI,
  }),
  charge: Object.freeze({
    shape: 'lane',
    label: Object.freeze(['charge', '冲锋']),
    heavy: true,
    windup: 0.9,
    active: 0.1,
    len: 190,
    hw: 38,
    lunge: 120,
  }),
  bigSweep: Object.freeze({
    shape: 'ring',
    label: Object.freeze(['ring sweep', '环形横扫']),
    heavy: true,
    windup: 0.9,
    active: 0.1,
    r1: 95,
    half: Math.PI,
  }),
});
export const HEAVY_DAMAGE = 3;

export const RIVAL_NAMES = Object.freeze({
  reed: Object.freeze({ en: 'Reed', zh: '芦苇' }),
  mira: Object.freeze({ en: 'Mira', zh: '米拉' }),
  kade: Object.freeze({ en: 'Kade', zh: '凯德' }),
});

const step = (name, windup) => Object.freeze({ ...ATTACKS[name], windup });
const pattern = (recover, ...steps) => Object.freeze({ steps: Object.freeze(steps), recover });

// One duel per level. The rival id picks the fighter art and the weapon.
//   trigger  distance at which the rival stops walking and starts its next attack
//   gap      pause before an attack (plus up to GAP_JITTER of seeded random)
//   recover  seconds the rival stays OPEN after a pattern: the only time a strike hurts
const level = (tier, court, name, tip, rival, ...patterns) =>
  Object.freeze({
    tier,
    court,
    name: Object.freeze({ en: name[0], zh: name[1] }),
    tip: Object.freeze({ en: tip[0], zh: tip[1] }),
    rival: Object.freeze({ ...rival, patterns: Object.freeze(patterns) }),
  });

export const LEVELS = Object.freeze([
  // Teaching: one new idea at a time.
  level(
    'teach',
    0,
    ['First Cut', '初次交锋'],
    [
      'Step out of the red shape, then press Space when OPEN shows. Each opening allows one hit.',
      '走出红色区域，出现“破绽”时按空格。每次破绽只能击中一次。',
    ],
    { id: 'reed', hp: 2, speed: 70, trigger: 46, gap: 1.2 },
    pattern(1.5, step('slash', 1.1)),
  ),
  level(
    'teach',
    0,
    ['Dash Through', '闪身穿过'],
    [
      'Press X to dash: nothing can hit you for 0.4 s. Time it just before a shape fires. 3 dashes, slow refill.',
      '按X闪身：约0.4秒内无法被击中。在区域生效前一刻按下。共3次，缓慢恢复。',
    ],
    { id: 'reed', hp: 3, speed: 76, trigger: 46, gap: 1 },
    pattern(1.3, step('slash', 1)),
  ),
  level(
    'teach',
    0,
    ['Narrow Lane', '狭窄通道'],
    [
      'Mira thrusts down a thin lane from far away. Step sideways out of the lane or dash through it.',
      '米拉从远处沿窄道突刺。向侧面走出通道，或闪身穿过。',
    ],
    { id: 'mira', hp: 6, speed: 80, trigger: 84, gap: 1 },
    pattern(1.1, step('thrust', 0.9)),
  ),
  level(
    'teach',
    0,
    ['Double Thrust', '双重突刺'],
    [
      'Some thrusts come twice. The second lane aims at where you stand when it appears.',
      '有些突刺会连发两次。第二条通道瞄准它出现时你所在的位置。',
    ],
    { id: 'mira', hp: 6, speed: 84, trigger: 84, gap: 0.9 },
    pattern(1, step('thrust', 0.9), step('thrust', 0.9)),
    pattern(1, step('thrust', 0.9)),
  ),
  level(
    'teach',
    0,
    ['Heavy Charge', '重击冲锋'],
    [
      'A magenta !! shape is heavy (3 HP) and very wide. Dash at the last moment, or start walking early.',
      '洋红色!!区域是重击（3点生命）且很宽。在最后一刻闪身，或提前起步走开。',
    ],
    { id: 'mira', hp: 6, speed: 84, trigger: 84, gap: 0.9 },
    pattern(1.4, step('charge', 1)),
    pattern(1, step('thrust', 0.9)),
  ),
  level(
    'teach',
    0,
    ['Chained Cuts', '连续劈砍'],
    [
      'Kade cuts twice in a row. Leave the first shape, then leave the second one that appears.',
      '凯德会连续劈砍两次。先离开第一个区域，再离开随后出现的第二个。',
    ],
    { id: 'kade', hp: 6, speed: 90, trigger: 50, gap: 0.9 },
    pattern(1, step('cut', 0.95), step('cut', 1)),
  ),
  level(
    'teach',
    0,
    ['Ring Sweep', '环形横扫'],
    [
      'A ring hits all around Kade. Run out of the circle, or dash through it. His double cuts still come.',
      '圆环会打到凯德周围一圈。跑出圆圈或闪身穿过。他的双重劈砍仍会出现。',
    ],
    { id: 'kade', hp: 7, speed: 92, trigger: 50, gap: 0.9 },
    pattern(1.1, step('sweep', 1.1)),
    pattern(1, step('cut', 0.95), step('cut', 1)),
  ),
  // Combination: the ideas arrive together.
  level(
    'combo',
    1,
    ['Slash and Sweep', '斩击接横扫'],
    [
      'Reed sometimes follows a slash with a ring sweep. After the first shape, another one may come.',
      '芦苇有时会在斩击之后接环形横扫。第一个区域之后可能还有下一个。',
    ],
    { id: 'reed', hp: 7, speed: 86, trigger: 48, gap: 0.9 },
    pattern(1.1, step('slash', 0.9), step('sweep', 1.05)),
    pattern(1, step('slash', 0.9)),
  ),
  level(
    'combo',
    1,
    ['Lane and Cut', '突刺接劈砍'],
    [
      'Mira thrusts and then cuts. A heavy charge may also come: keep a dash ready for it.',
      '米拉突刺后会接着劈砍，也可能发出重击冲锋：为它留一次闪身。',
    ],
    { id: 'mira', hp: 7, speed: 88, trigger: 84, gap: 0.85 },
    pattern(1, step('thrust', 0.85), step('cut', 0.85)),
    pattern(1.3, step('charge', 1)),
  ),
  level(
    'combo',
    1,
    ['Big Sweep', '巨型横扫'],
    [
      'Kade mixes cuts and rings with a big heavy ring (!!). Dash it at the last moment or lose 3 HP.',
      '凯德把劈砍和圆环与大型重击圆环（!!）混在一起。在最后一刻闪身，否则扣3点生命。',
    ],
    { id: 'kade', hp: 7, speed: 92, trigger: 50, gap: 0.8 },
    pattern(1, step('cut', 0.85), step('cut', 0.85)),
    pattern(1.3, step('bigSweep', 1)),
    pattern(1.1, step('sweep', 1.0)),
  ),
  level(
    'combo',
    1,
    ['Triple Slash', '三连斩'],
    [
      'Reed can slash three times in a row. Keep moving: each shape aims at where you are when it appears.',
      '芦苇可能连斩三次。保持移动：每个区域都瞄准它出现时你的位置。',
    ],
    { id: 'reed', hp: 8, speed: 92, trigger: 48, gap: 0.8 },
    pattern(1.2, step('slash', 0.8), step('slash', 0.8), step('slash', 0.8)),
    pattern(1, step('slash', 0.8)),
  ),
  level(
    'combo',
    1,
    ['Lance Line', '长枪连击'],
    [
      'Mira chains two thrusts into a heavy charge. Sidestep the thrusts and save a dash for the charge.',
      '米拉把两次突刺接上重击冲锋。侧移躲开突刺，把闪身留给冲锋。',
    ],
    { id: 'mira', hp: 8, speed: 92, trigger: 84, gap: 0.8 },
    pattern(1.2, step('thrust', 0.8), step('thrust', 0.8), step('charge', 0.95)),
    pattern(1, step('thrust', 0.8), step('thrust', 0.8)),
  ),
  level(
    'combo',
    1,
    ['Cut and Ring', '劈砍接圆环'],
    [
      'Kade cuts, then sweeps a ring. Step out of the cut, then leave the ring or dash through it.',
      '凯德先劈砍再扫出圆环。先走出劈砍区域，再跑出圆圈或闪身穿过。',
    ],
    { id: 'kade', hp: 8, speed: 96, trigger: 50, gap: 0.8 },
    pattern(1.5, step('cut', 0.8), step('sweep', 0.95)),
    pattern(1.5, step('bigSweep', 1)),
  ),
  level(
    'combo',
    1,
    ['Heavy Ladder', '重击阶梯'],
    [
      'Mira ends a thrust with a heavy charge. With only 5 HP, never take two heavy hits.',
      '米拉在突刺之后接重击冲锋。你只有5点生命，别吃下两次重击。',
    ],
    { id: 'mira', hp: 8, speed: 96, trigger: 84, gap: 0.75 },
    pattern(1.1, step('thrust', 0.75), step('charge', 0.95)),
    pattern(1, step('thrust', 0.75), step('thrust', 0.75)),
  ),
  // Mastery: faster windups, shorter openings and longer chains.
  level(
    'master',
    2,
    ['Quick Reed', '疾风芦苇'],
    [
      'Reed is faster and chains three shapes with short windups. Sidestep early; dash when there is no time.',
      '芦苇更快，连出三个起手很短的区域。尽早侧移，来不及时再闪身。',
    ],
    { id: 'reed', hp: 8, speed: 100, trigger: 48, gap: 0.7 },
    pattern(1.5, step('slash', 0.6), step('slash', 0.6), step('sweep', 0.7)),
    pattern(1.5, step('slash', 0.6), step('slash', 0.6)),
  ),
  level(
    'master',
    2,
    ['Mira Unleashed', '米拉全力'],
    [
      'Mira chains four thrusts and cuts, and a charge ends with a quick thrust. Read each shape as it appears.',
      '米拉连出四个突刺与劈砍，冲锋之后还会快速突刺。看清每个出现的区域。',
    ],
    { id: 'mira', hp: 8, speed: 100, trigger: 84, gap: 0.7 },
    pattern(1.2, step('thrust', 0.55), step('cut', 0.55), step('thrust', 0.55), step('cut', 0.55)),
    pattern(1.2, step('charge', 0.9), step('thrust', 0.55)),
  ),
  level(
    'master',
    2,
    ['Kade Awakened', '凯德觉醒'],
    [
      'Kade chains cuts with a ring; a big ring ends with a quick cut. Spend dashes wisely.',
      '凯德把劈砍接上圆环，巨环之后还有快速劈砍。省着用闪身：恢复很慢。',
    ],
    { id: 'kade', hp: 8, speed: 104, trigger: 50, gap: 0.7 },
    pattern(1.5, step('cut', 0.55), step('cut', 0.55), step('sweep', 0.65), step('cut', 0.55)),
    pattern(1.5, step('bigSweep', 0.9), step('cut', 0.55)),
  ),
  level(
    'master',
    2,
    ['Twin Heavies', '双重重击'],
    [
      'Two heavy charges cost 6 HP: dash each at the last moment. Fast triple thrusts need sidesteps.',
      '连续两次重击冲锋会扣6点生命：每次都在最后一刻闪身。快速三连突刺要靠侧移。',
    ],
    { id: 'mira', hp: 8, speed: 104, trigger: 84, gap: 0.7 },
    pattern(1.4, step('charge', 1), step('charge', 1)),
    pattern(1.2, step('thrust', 0.6), step('thrust', 0.6), step('thrust', 0.6)),
  ),
  level(
    'master',
    2,
    ['Whirlwind', '旋风'],
    [
      'Kade never stops: cut-ring-cut chains, a big ring and triple cuts. Save your dashes for the rings.',
      '凯德攻势不停：劈砍-圆环-劈砍连招、巨环和三连劈。把闪身留给圆环。',
    ],
    { id: 'kade', hp: 8, speed: 108, trigger: 50, gap: 0.6 },
    pattern(1.5, step('cut', 0.55), step('sweep', 0.65), step('cut', 0.55)),
    pattern(1.5, step('bigSweep', 0.9), step('cut', 0.55)),
    pattern(1.5, step('cut', 0.55), step('cut', 0.55), step('cut', 0.55)),
  ),
  level(
    'master',
    2,
    ['Grand Duel', '终极决斗'],
    [
      'Last duel: sidestep what you can, dash heavy shapes at the last moment, strike when OPEN.',
      '最后的决斗：能侧移就侧移，重击在最后一刻闪身，破绽时出招。',
    ],
    { id: 'kade', hp: 8, speed: 110, trigger: 52, gap: 0.6 },
    pattern(1.2, step('cut', 0.65), step('cut', 0.65), step('sweep', 0.8)),
    pattern(1.2, step('bigSweep', 0.9), step('cut', 0.7), step('cut', 0.7)),
    pattern(1.2, step('sweep', 0.8), step('cut', 0.7), step('cut', 0.7)),
  ),
]);
export const LEVEL_COUNT = LEVELS.length;

export const levelNumber = (n) => {
  const k = Math.floor(Number(n));
  return Number.isFinite(k) ? Math.min(LEVEL_COUNT, Math.max(1, k)) : 1;
};
export const levelOf = (n) => LEVELS[levelNumber(n) - 1];
