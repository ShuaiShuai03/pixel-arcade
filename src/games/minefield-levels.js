// Data-driven survey fields: size, mines, terrain, and the special rules each one adds.
export const LEVEL_COUNT = 20;
const CELL_MAX = 28;
const CELL_MIN = 22;
const BOARD_MAX = { w: 336, h: 224 };
const BOARD_CENTER_X = 226;
const BOARD_TOP = 58;

// A terrain returns true where a tile is inactive rubble.
const TERRAINS = Object.freeze({
  open: () => false,
  corners: (x, y, w, h) => (x === 0 || x === w - 1) && (y === 0 || y === h - 1),
  gate: (x, y, w, h) =>
    (x === Math.floor(w / 2) - 1 || x === Math.floor(w / 2)) && Math.abs(y - Math.floor(h / 2)) > 1,
  pillars: (x, y, w, h) => x % 3 === 1 && y % 3 === 1 && x < w - 1 && y < h - 1,
  block: (x, y, w, h) => Math.abs(x - (w - 1) / 2) <= 1.5 && Math.abs(y - (h - 1) / 2) <= 1,
  diagonal: (x, y, w) => x === Math.floor((y * w) / 9) + 2 && y > 0 && y < 8,
  moat: (x, y, w, h) => y === Math.floor(h / 2) && x % 5 !== 1 && x % 5 !== 2 && x > 0 && x < w - 1,
});

const def = (name, zh, w, h, mines, terrain, rules, teach) =>
  Object.freeze({
    name: Object.freeze({ en: name, zh }),
    w,
    h,
    mines,
    terrain,
    sectors: rules.sectors ?? 0,
    hints: rules.hints ?? 0,
    flagLimit: rules.flagLimit ?? 0,
    probes: rules.probes ?? 0,
    teach: Object.freeze({ en: teach[0], zh: teach[1] }),
  });

export const LEVELS = Object.freeze([
  def('Camp Survey', '营地勘探', 6, 6, 4, 'open', { probes: 3 }, [
    'A number counts the mines in the 8 tiles around it.',
    '数字表示周围8格内的地雷数。',
  ]),
  def('Tent Row', '帐篷列', 7, 6, 6, 'open', { probes: 3 }, [
    'A 1 touching one covered tile marks a mine. F flags it.',
    '只挨着一个未揭开格的1，那格必有雷。按F插旗。',
  ]),
  def('Flag Lines', '旗线', 8, 6, 8, 'open', { probes: 3 }, [
    "Flag a number's mines, then C opens its other neighbors.",
    '标出数字周围的雷后，按C展开其余邻格。',
  ]),
  def('Quarry Edge', '采石场边', 8, 7, 8, 'corners', { probes: 3 }, [
    'Grey rubble is not a tile: it hides no mine and counts for nothing.',
    '灰色废石不是地块：没有雷，也不计入数字。',
  ]),
  def('Split Quarry', '裂隙采石场', 9, 8, 10, 'gate', { probes: 3 }, [
    'Rubble splits the yard. Only the open gate rows link both sides.',
    '废石把场地隔开，只有中间的通道连通两侧。',
  ]),
  def('Marked Start', '预标营地', 9, 8, 12, 'open', { probes: 2, hints: 3 }, [
    'Surveyors left some safe tiles open. Read their numbers first.',
    '勘探员已开好部分安全格，先读它们的数字。',
  ]),
  def('First Sectors', '初分区', 9, 7, 10, 'open', { probes: 2, sectors: 3 }, [
    'Each strip shows its own mine total. Compare it to your flags.',
    '每个分区上方显示该区雷数，与自己的判断对照。',
  ]),
  def('Pillar Yard', '立柱场', 10, 8, 12, 'pillars', { probes: 2 }, [
    'Pillars break up the grid: count only the active neighbors.',
    '立柱切碎了格子，只数有效的邻格。',
  ]),
  def('Flag Ration', '旗帜配给', 10, 8, 14, 'open', { probes: 2, flagLimit: 8 }, [
    'Flags are rationed, so mark only the mines you need.',
    '旗帜有数量上限，只标记真正需要的地雷。',
  ]),
  def('Sector Gate', '分区闸门', 11, 8, 12, 'gate', { probes: 2, sectors: 2 }, [
    'Two sectors share a narrow gate. Use both totals.',
    '两个分区共用一条窄门，请同时利用两个雷数。',
  ]),
  def('Central Block', '中央石堆', 10, 9, 13, 'block', { probes: 2, hints: 2 }, [
    'A rubble block sits in the middle. Work around its edge.',
    '中央有一块废石堆，沿着它的边缘推理。',
  ]),
  def('Diagonal Cut', '斜裂谷', 11, 9, 15, 'diagonal', { probes: 1 }, [
    'A diagonal rift cuts the field. Both banks link at its tips.',
    '斜裂谷贯穿场地，两岸在端点处相连。',
  ]),
  def('Three Strips', '三条带', 12, 8, 17, 'open', { probes: 1, sectors: 3, flagLimit: 10 }, [
    'Three sector totals and a flag ration. Plan your marks.',
    '三个分区雷数加上旗帜配给，请规划标记。',
  ]),
  def('Moat Crossing', '壕沟渡口', 12, 9, 17, 'moat', { probes: 1, hints: 2 }, [
    'A rubble moat has narrow fords. Cross where the numbers allow.',
    '废石壕沟只留窄窄的渡口，在数字允许处通过。',
  ]),
  def('Pillar Sectors', '立柱分区', 12, 9, 18, 'pillars', { probes: 1, sectors: 4 }, [
    'Pillars and four sector totals combine. Check every strip.',
    '立柱与四个分区雷数叠加，逐条核对。',
  ]),
  def('Tight Ration', '紧缩配给', 12, 9, 19, 'open', { probes: 1, hints: 3, flagLimit: 6 }, [
    'Only a few flags and a few open tiles. Think before marking.',
    '旗帜很少，预开的格子也少，标记前先想清楚。',
  ]),
  def('Broken Ridge', '断脊', 13, 9, 20, 'diagonal', { probes: 1, sectors: 3, hints: 2 }, [
    'A broken ridge, three sectors and some safe tiles to start.',
    '断裂的山脊、三个分区，以及几处预开的安全格。',
  ]),
  def('Deep Quarry', '深采石场', 13, 9, 19, 'gate', { probes: 0, hints: 3, flagLimit: 8 }, [
    'No probes now. Rely on proofs, and H explains them for free.',
    '不再有探针，请依靠推理；H可免费解释。',
  ]),
  def('Last Sectors', '末区', 14, 9, 21, 'pillars', { probes: 0, sectors: 4, hints: 3 }, [
    'Four sectors, pillars and no probes. Stay methodical.',
    '四个分区、立柱、没有探针，务必有条理。',
  ]),
  def('Summit', '山顶', 14, 10, 25, 'open', { probes: 0, sectors: 3, hints: 3, flagLimit: 12 }, [
    'The summit: every rule at once. Clear it to finish the survey.',
    '山顶：所有规则同时出现。清除它即完成勘探。',
  ]),
]);

export const levelOf = (n) => LEVELS[Math.min(LEVEL_COUNT, Math.max(1, Math.floor(n))) - 1];

/** Rule line appended to the teaching tip, built from the level data so it cannot drift. */
export function ruleLine(level) {
  const en = [],
    zh = [];
  if (level.hints) {
    en.push(`${level.hints} safe tiles pre-opened.`);
    zh.push(`预开${level.hints}处安全格。`);
  }
  if (level.flagLimit) {
    en.push(`Max ${level.flagLimit} flags.`);
    zh.push(`旗帜上限${level.flagLimit}。`);
  }
  if (level.sectors) {
    en.push(`${level.sectors} sector totals shown.`);
    zh.push(`显示${level.sectors}个分区雷数。`);
  }
  return { en: en.join(' '), zh: zh.join('') };
}

export function tipOf(level) {
  const rule = ruleLine(level);
  return {
    en: [level.teach.en, rule.en].filter(Boolean).join(' '),
    zh: [level.teach.zh, rule.zh].filter(Boolean).join(''),
  };
}

/** Everything the rules engine and renderer need for one field. */
export function planOf(n) {
  const level = levelOf(n),
    { w, h } = level,
    terrain = TERRAINS[level.terrain],
    mask = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask.push(!terrain(x, y, w, h));
  const cell = Math.min(CELL_MAX, Math.floor(BOARD_MAX.w / w), Math.floor(BOARD_MAX.h / h));
  const band = Math.ceil(w / (level.sectors || 1)),
    regions = [];
  for (let n2 = 0; n2 < level.sectors; n2++)
    regions.push({
      id: n2,
      name: { en: `Sector ${n2 + 1}`, zh: `${n2 + 1}区` },
      cells: mask.flatMap((v, i) => (v && Math.floor((i % w) / band) === n2 ? [i] : [])),
    });
  return {
    w,
    h,
    mask,
    count: level.mines,
    regions,
    hints: level.hints,
    flagLimit: level.flagLimit,
    probes: level.probes,
    layout: {
      x: Math.round(BOARD_CENTER_X - (w * cell) / 2),
      y: BOARD_TOP + Math.floor((BOARD_MAX.h - h * cell) / 2),
      cell: Math.max(CELL_MIN, cell),
    },
  };
}
