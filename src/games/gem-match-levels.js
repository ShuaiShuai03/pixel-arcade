// Twenty conservatory gardens. Each goal list must be met inside the move budget:
// score (points earned in this garden), collect (one gem kind) and soil (a count of marked beds).
import { SIZE } from './gem-match-rules.js';

export const GEM_NAMES = Object.freeze([
  Object.freeze({ en: 'Rose', zh: '玫瑰' }),
  Object.freeze({ en: 'Leaf', zh: '绿叶' }),
  Object.freeze({ en: 'Sun', zh: '向日葵' }),
  Object.freeze({ en: 'Dew', zh: '露珠' }),
  Object.freeze({ en: 'Iris', zh: '鸢尾' }),
  Object.freeze({ en: 'Acorn', zh: '橡果' }),
]);
const ROSE = 0,
  LEAF = 1,
  SUN = 2,
  DEW = 3;
const score = (target) => Object.freeze({ kind: 'score', target });
const collect = (color, target) => Object.freeze({ kind: 'collect', color, target });
const soil = (target) => Object.freeze({ kind: 'soil', target });
const NO_BEDS = Object.freeze(Array(SIZE).fill('.......'));
const garden = (en, zh, moves, kinds, beds, goals, tipEn, tipZh) =>
  Object.freeze({
    name: Object.freeze({ en, zh }),
    tip: Object.freeze({ en: tipEn, zh: tipZh }),
    moves,
    kinds,
    beds: Object.freeze(beds),
    goals: Object.freeze(goals),
  });

export const LEVELS = Object.freeze([
  garden(
    'Seedling Bed',
    '育苗床',
    20,
    4,
    NO_BEDS,
    [score(1500)],
    'Swap two neighbouring gems to line up three. Score 1500 points in 20 moves.',
    '交换相邻宝石，连成三个。20步内得到1500分。',
  ),
  garden(
    'Leaf Basket',
    '绿叶篮',
    20,
    4,
    NO_BEDS,
    [collect(LEAF, 20)],
    'Matched leaves go in the basket. Gather 20 leaves in 20 moves.',
    '消除的绿叶会放进篮子。20步内收集20片绿叶。',
  ),
  garden(
    'First Soil',
    '初垦土壤',
    30,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1.....'],
    [soil(10)],
    "Brown beds wear corner marks in a gem's colour. Match that gem on a bed to clear it: 10 beds in 30 moves.",
    '棕色土壤四角的颜色表示所需宝石。在土壤上连成该色即可翻土：30步内清除10块。',
  ),
  garden(
    'Sun Corner',
    '向阳角',
    33,
    4,
    NO_BEDS,
    [collect(SUN, 63)],
    'Only sunflowers count now. Gather 63 in 33 moves; cascades help.',
    '这一关只算向日葵。33步内收集63朵，连锁会有帮助。',
  ),
  garden(
    'Bloom Run',
    '繁花冲刺',
    32,
    4,
    NO_BEDS,
    [score(9000)],
    'Falling gems chain into new matches. Score 9000 points in 32 moves.',
    '落下的宝石会连锁出新的连线。32步内得到9000分。',
  ),
  garden(
    'Mixed Beds',
    '杂色苗圃',
    31,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1.....'],
    [soil(10)],
    'Every bed wants its own colour, so choose lines carefully. Clear 10 beds in 31 moves.',
    '每块土壤需要各自的颜色，仔细选择连线。31步内清除10块。',
  ),
  garden(
    'Dew Harvest',
    '露珠丰收',
    34,
    4,
    NO_BEDS,
    [collect(DEW, 66)],
    'Dew drops only. Gather 66 in 34 moves; long lines and chains pay off.',
    '这一关只算露珠。34步内收集66颗，长线和连锁最划算。',
  ),
  garden(
    'Soil and Bloom',
    '土壤与花开',
    30,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.13....'],
    [soil(11), score(3800)],
    'Two goals at once: clear 11 beds and score 3800 points in 30 moves.',
    '两个目标同时进行：30步内清除11块土壤并得到3800分。',
  ),
  garden(
    'Leaf and Bloom',
    '叶与花',
    32,
    4,
    NO_BEDS,
    [collect(LEAF, 51), score(7500)],
    'Gather 51 leaves and score 7500 points in 32 moves.',
    '32步内收集51片绿叶并得到7500分。',
  ),
  garden(
    'Terrace Beds',
    '梯田苗圃',
    24,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1313..'],
    [soil(12), collect(DEW, 18)],
    'Clear 12 beds and gather 18 dew drops in 24 moves.',
    '24步内清除12块土壤并收集18颗露珠。',
  ),
  garden(
    'Leaf and Soil',
    '叶与土',
    26,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.13....'],
    [soil(9), collect(LEAF, 39)],
    'Clear 9 beds and gather 39 leaves in 26 moves.',
    '26步内清除9块土壤并收集39片绿叶。',
  ),
  garden(
    'High Bloom',
    '盛开高峰',
    33,
    4,
    NO_BEDS,
    [score(10500), collect(SUN, 30)],
    'Plan your cascades: score 10500 points and gather 30 sunflowers in 33 moves.',
    '规划连锁：33步内得到10500分并收集30朵向日葵。',
  ),
  garden(
    'Deep Beds',
    '深层苗圃',
    34,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.13....'],
    [soil(11), score(5200)],
    'Two bed clusters: clear 11 beds and score 5200 points in 34 moves.',
    '两处苗圃：34步内清除11块土壤并得到5200分。',
  ),
  garden(
    'Rose Harvest',
    '玫瑰丰收',
    30,
    4,
    NO_BEDS,
    [collect(ROSE, 54), score(6800)],
    'Gather 54 roses and score 6800 points in 30 moves.',
    '30步内收集54朵玫瑰并得到6800分。',
  ),
  garden(
    'Bloom and Soil',
    '花开垦土',
    21,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1313..'],
    [soil(10), score(4500)],
    'Clear 10 beds and score 4500 points in 21 moves.',
    '21步内清除10块土壤并得到4500分。',
  ),
  garden(
    'Rich Soil',
    '沃土方阵',
    21,
    4,
    ['.......', '.......', '.......', '.31313.', '.02020.', '.13131.', '.20202.'],
    [soil(15)],
    'A big block of beds: clear 15 of them in 21 moves.',
    '一大片土壤：21步内清除其中15块。',
  ),
  garden(
    'Specimen Rush',
    '标本冲刺',
    27,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1.....'],
    [soil(8), collect(SUN, 39), score(5200)],
    'Three goals: clear 8 beds, gather 39 sunflowers and score 5200 points in 27 moves.',
    '三个目标：27步内清除8块土壤、收集39朵向日葵并得到5200分。',
  ),
  garden(
    'Grand Bloom',
    '盛大花会',
    26,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.13....'],
    [soil(9), score(7500)],
    'Clear 9 beds and score 7500 points in 26 moves.',
    '26步内清除9块土壤并得到7500分。',
  ),
  garden(
    'Thick Terrace',
    '厚土梯田',
    19,
    4,
    ['.......', '.......', '.......', '.31313.', '.02020.', '.13131.', '.2020..'],
    [soil(14), collect(DEW, 18)],
    'Clear 14 beds and gather 18 dew drops in 19 moves.',
    '19步内清除14块土壤并收集18颗露珠。',
  ),
  garden(
    'Grand Conservatory',
    '大温室',
    27,
    4,
    ['.......', '.......', '.......', '.......', '.31313.', '.02020.', '.1313..'],
    [soil(10), collect(ROSE, 21), score(6000)],
    'Three goals: clear 10 beds, gather 21 roses and score 6000 points in 27 moves.',
    '三个目标：27步内清除10块土壤、收集21朵玫瑰并得到6000分。',
  ),
]);
export const LEVEL_COUNT = LEVELS.length;

const BARE = -1;
/** Soil grid for a garden: BARE ('.') or the gem kind (digit) that clears the bed. */
export const soilGrid = (level) =>
  level.beds.map((row) => [...row].map((c) => (c === '.' ? BARE : Number(c))));
export const bedCount = (grid) => grid.flat().filter((v) => v !== BARE).length;

/** Progress towards every goal of a garden, from the visible state. */
export function levelObjective(level, s) {
  const bedsLeft = bedCount(s.soil),
    bedsTotal = bedCount(soilGrid(level));
  const goals = level.goals.map((g) => {
    if (g.kind === 'score') return { ...g, progress: s.levelScore };
    if (g.kind === 'collect') return { ...g, progress: s.collected[g.color] };
    return { ...g, progress: bedsTotal - bedsLeft };
  });
  return { goals, done: goals.every((g) => g.progress >= g.target) };
}
