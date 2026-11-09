// The 20 districts. Rows are listed top to bottom and sit on the floor of the well:
// '.' empty, '#' plain rubble, 'x' marked rubble. `queue` fixes a limited piece supply.
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};
const shaft = (count, row) => Array(count).fill(row);

export const LEVELS = deepFreeze([
  {
    name: { en: 'Foundation', zh: '基础区' },
    tip: {
      en: 'Fill a whole row to clear it. Space drops a piece at once.',
      zh: '填满一整行即可消除。空格键可瞬间落下。',
    },
    goal: { kind: 'lines', n: 4 },
    interval: 0.8,
    rows: [],
  },
  {
    name: { en: 'Side Gap', zh: '侧边缺口' },
    tip: {
      en: 'Slide a square into the two-wide gap on the left.',
      zh: '把方块推进左边两格宽的缺口。',
    },
    goal: { kind: 'lines', n: 4 },
    interval: 0.76,
    rows: ['..########', '..########'],
  },
  {
    name: { en: 'Power Shaft', zh: '电力竖井' },
    tip: {
      en: 'Keep the right shaft empty. A vertical I clears all four rows.',
      zh: '保持右侧竖井为空，竖直长条一次消除四行。',
    },
    goal: { kind: 'burst', n: 4 },
    interval: 0.72,
    rows: shaft(4, '#########.'),
  },
  {
    name: { en: 'Rubble Row', zh: '碎砖行' },
    tip: {
      en: 'Clear the rows that hold the marked rubble by filling the right gap.',
      zh: '填满右侧缺口，消除带标记碎砖的行。',
    },
    goal: { kind: 'rubble' },
    interval: 0.7,
    rows: shaft(2, 'xxxxxxx...'),
  },
  {
    name: { en: 'Hold Practice', zh: '暂存练习' },
    tip: {
      en: 'Press C to keep a piece, such as the I for the four-wide gap, for later.',
      zh: '按C暂存方块，例如留着长条填四格宽的缺口。',
    },
    goal: { kind: 'lines', n: 5 },
    interval: 0.66,
    rows: ['##....####'],
  },
  {
    name: { en: 'Short Supply', zh: '限量方块' },
    tip: {
      en: 'Only a few pieces come. Fill the right block with them.',
      zh: '方块数量有限，用它们填满右侧缺口。',
    },
    goal: { kind: 'lines', n: 3 },
    interval: 0.64,
    rows: shaft(3, '######....'),
    queue: 'JLTOOISZ',
  },
  {
    name: { en: 'Dig Down', zh: '向下挖掘' },
    tip: {
      en: 'Each marked row has one gap. Drop a piece into it to clear the row.',
      zh: '每个标记行只有一个缺口，落入方块即可消除。',
    },
    goal: { kind: 'rubble' },
    interval: 0.6,
    rows: ['xxxxxxxx.x', 'xxxx.xxxxx', 'x.xxxxxxxx'],
  },
  {
    name: { en: 'Twin Shafts', zh: '双井' },
    tip: {
      en: 'Both side columns are open. Fill each with an I, then clear six lines.',
      zh: '两侧竖井都是空的，各放一个长条，共消除六行。',
    },
    goal: { kind: 'lines', n: 6 },
    interval: 0.56,
    rows: shaft(4, '.########.'),
  },
  {
    name: { en: 'Rubble Wall', zh: '碎砖墙' },
    tip: {
      en: 'The marked wall has a stepped gap. Fill it from the bottom up.',
      zh: '标记碎砖墙有阶梯缺口，从下往上填满。',
    },
    goal: { kind: 'rubble' },
    interval: 0.52,
    rows: ['xxxxxxxx..', 'xxxxxxx...', 'xxxxxx....', 'xxxxxxx...', 'xxxxxxxx..'],
  },
  {
    name: { en: 'Quad Run', zh: '四连行' },
    tip: {
      en: 'The left shaft is six deep. One vertical I clears four rows at once.',
      zh: '左侧竖井深六格，一个竖直长条一次消除四行。',
    },
    goal: { kind: 'burst', n: 4 },
    interval: 0.5,
    rows: shaft(6, '.#########'),
  },
  {
    name: { en: 'Tight Queue', zh: '紧凑队列' },
    tip: {
      en: 'Both edge shafts need filling, and only eleven pieces will come.',
      zh: '两侧缺口都要填满，且只有十一个方块。',
    },
    goal: { kind: 'lines', n: 4 },
    interval: 0.48,
    rows: shaft(4, '..######..'),
    queue: 'OJLOTISZOIL',
  },
  {
    name: { en: 'Triple Strike', zh: '三连击' },
    tip: {
      en: 'Clear three rows with one piece down the second column.',
      zh: '用一个方块沿第二列一次消除三行。',
    },
    goal: { kind: 'burst', n: 3 },
    interval: 0.46,
    rows: shaft(3, '#.########'),
  },
  {
    name: { en: 'Cheese Tower', zh: '奶酪塔' },
    tip: {
      en: 'Six marked rows, one gap each. Work from the top down.',
      zh: '六个标记行，每行一个缺口，从上往下处理。',
    },
    goal: { kind: 'rubble' },
    interval: 0.44,
    rows: ['xxxxxx.xxx', 'xxx.xxxxxx', 'xxxxxxxxx.', 'x.xxxxxxxx', 'xxxxx.xxxx', 'xxxxxxx.xx'],
  },
  {
    name: { en: 'Supply Run', zh: '补给线' },
    tip: {
      en: 'Five lines with a fixed supply. Do not waste a piece.',
      zh: '固定方块数量内消除五行，不要浪费方块。',
    },
    goal: { kind: 'lines', n: 5 },
    interval: 0.42,
    rows: shaft(5, '#####.....'),
    queue: 'OOIIJLTSZOLJT',
  },
  {
    name: { en: 'Deep Well', zh: '深井' },
    tip: {
      en: 'Shaft in the fourth column, seven rows deep. Wait for an I.',
      zh: '第四列的竖井深七格，等待长条出现。',
    },
    goal: { kind: 'burst', n: 4 },
    interval: 0.4,
    rows: shaft(7, '###.######'),
  },
  {
    name: { en: 'Heavy Cheese', zh: '重奶酪' },
    tip: {
      en: 'Eight marked rows with a gap each. Stay low and keep digging.',
      zh: '八个标记行各有一个缺口，保持低位持续挖掘。',
    },
    goal: { kind: 'rubble' },
    interval: 0.38,
    rows: [
      'xxxxxxx.xx',
      'xx.xxxxxxx',
      'xxxxxxxxx.',
      'xxxx.xxxxx',
      '.xxxxxxxxx',
      'xxxxxx.xxx',
      'xxxxxxxx.x',
      'xxx.xxxxxx',
    ],
  },
  {
    name: { en: 'Scarce Supply', zh: '稀缺补给' },
    tip: {
      en: 'Six lines from a short fixed supply. Plan every piece.',
      zh: '用有限的固定方块消除六行，规划每一块。',
    },
    goal: { kind: 'lines', n: 6 },
    interval: 0.36,
    rows: shaft(6, '####......'),
    queue: 'OOOIIJLTSZOLJTI',
  },
  {
    name: { en: 'Rubble Pit', zh: '碎砖坑' },
    tip: {
      en: 'Fill the pit and the notch above it to clear all the marked rubble.',
      zh: '填满碎砖坑和上方的缺口，清除所有标记碎砖。',
    },
    goal: { kind: 'rubble' },
    interval: 0.34,
    rows: ['xxxxxxxx..', 'xxxxxx....', 'xxxxxxxxx.', 'xxx....xxx'],
  },
  {
    name: { en: 'Blitz', zh: '闪电建设' },
    tip: {
      en: 'Ten lines at high speed. Hold and the ghost outline help.',
      zh: '高速消除十行，善用暂存和落点影子。',
    },
    goal: { kind: 'lines', n: 10 },
    interval: 0.3,
    rows: ['#.########', '##.#######'],
  },
  {
    name: { en: 'Grand Power', zh: '盛大供电' },
    tip: {
      en: 'An eight-row wall with one shaft. Stack beside it and wait for an I.',
      zh: '八行高墙只留一个竖井，在旁边堆叠，等待长条。',
    },
    goal: { kind: 'burst', n: 4 },
    interval: 0.3,
    rows: shaft(8, '#######.##'),
  },
]);
export const LEVEL_COUNT = LEVELS.length;
const CELL_VALUE = Object.freeze({ '.': 0, '#': 9, x: 8 });
export function levelBoard(level) {
  const board = Array.from({ length: 20 }, () => Array(10).fill(0));
  level.rows.forEach((row, i) => {
    const y = 20 - level.rows.length + i;
    for (let x = 0; x < 10; x++) board[y][x] = CELL_VALUE[row[x]];
  });
  return board;
}
