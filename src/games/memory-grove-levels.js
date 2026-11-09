// Memory Grove level data: twenty clearings built from four rules on a teaching, combination
// and mastery curve. Every timing a player must read lives here, so levels stay plain data.
const BOARD = Object.freeze({ cx: 240, cy: 160, maxW: 250, maxH: 200, maxCell: 64 });
const GROUP = Object.freeze({ pairs: 2, route: 2, triples: 3, echo: 1 });

export const RULE_NAMES = Object.freeze({
  pairs: Object.freeze({ en: 'PAIRS', zh: '相同配对' }),
  route: Object.freeze({ en: 'LANTERNS', zh: '灯笼顺序' }),
  triples: Object.freeze({ en: 'TRIPLES', zh: '三张一组' }),
  echo: Object.freeze({ en: 'ECHO', zh: '回声顺序' }),
});
export const SHORTEST_CUE = 0.5;
export const SHORTEST_SHOW = 0.9;

/** Card rectangles for a grid: square cells centred on the board, a 3 px gutter around each card. */
function layoutFor(cols, rows) {
  const cell = Math.min(
    BOARD.maxCell,
    Math.floor(BOARD.maxW / cols),
    Math.floor(BOARD.maxH / rows),
  );
  const x0 = BOARD.cx - (cols * cell) / 2,
    y0 = BOARD.cy - (rows * cell) / 2 + 6;
  const cards = Array.from({ length: cols * rows }, (_, i) =>
    Object.freeze({
      x: x0 + (i % cols) * cell + 3,
      y: y0 + Math.floor(i / cols) * cell + 3,
      w: cell - 6,
      h: cell - 6,
    }),
  );
  return Object.freeze({ cols, rows, cell, cards: Object.freeze(cards) });
}
function bilingual(en, zh) {
  return Object.freeze({ en, zh });
}
/**
 * spec: [rule, cols, rows, symbols, name, tip, options].
 * preview = seconds every card is shown first; show = seconds a wrong turn stays open;
 * lives = mistakes allowed plus one (null: never lose); clock = decision seconds (0: no clock);
 * echo = {from, to, cue, gap}: sequence lengths and the seconds a cue lights and rests.
 */
function level([rule, cols, rows, symbols, name, tip, options]) {
  const group = GROUP[rule],
    count = cols * rows;
  const def = {
    rule,
    group,
    symbols,
    count,
    layout: layoutFor(cols, rows),
    preview: 0,
    show: 1.3,
    lives: null,
    clock: 0,
    echo: null,
    ...options,
    name: bilingual(...name),
    tip: bilingual(...tip),
  };
  if (def.echo) def.echo = Object.freeze({ ...def.echo });
  return Object.freeze(def);
}

export const LEVELS = Object.freeze(
  [
    // Teaching 1-7: one idea at a time, long previews, forgiving lives.
    [
      'pairs',
      3,
      2,
      3,
      ['Fern Pair', '蕨叶初见'],
      [
        'Study the cards, then turn two with the same symbol. Mistakes cost nothing here.',
        '先看清卡片，再翻开两张相同图案。这里出错不会受罚。',
      ],
      { preview: 3 },
    ],
    [
      'pairs',
      4,
      2,
      4,
      ['Acorn Row', '橡果一排'],
      [
        'Four pairs. A wrong turn stays open for a moment so you can learn where things are.',
        '四对图案。翻错的牌会停留片刻，帮你记住位置。',
      ],
      { preview: 3, show: 1.5 },
    ],
    [
      'pairs',
      4,
      3,
      6,
      ['Fern Clearing', '蕨叶空地'],
      [
        'Six pairs and seven leaves: each wrong pair costs one. Look first, then match.',
        '六对图案，七片叶子。每次配错扣一片，先看再配。',
      ],
      { preview: 4, lives: 7 },
    ],
    [
      'route',
      3,
      2,
      3,
      ['First Lantern', '第一盏灯'],
      [
        'Match the symbols in the numbered lantern order shown on the right.',
        '按右侧编号的灯笼顺序，依次配对图案。',
      ],
      { preview: 3, lives: 3 },
    ],
    [
      'route',
      4,
      2,
      4,
      ['Lantern Pair', '双灯小径'],
      [
        'Four lanterns, no preview. Only the next symbol in the list counts.',
        '四盏灯，没有预览。只有列表里的下一个图案才算数。',
      ],
      { lives: 8, show: 1.4 },
    ],
    [
      'echo',
      3,
      2,
      6,
      ['First Echo', '第一声回声'],
      [
        'Watch the cards light one by one, then turn them in the same order.',
        '看卡片依次亮起，然后按相同的顺序翻开它们。',
      ],
      { lives: 4, echo: { from: 3, to: 3, cue: 0.9, gap: 0.3 } },
    ],
    [
      'triples',
      3,
      3,
      3,
      ['Three Moss', '三叶苔藓'],
      [
        'Find three cards with the same symbol. A group of three is checked together.',
        '找出三张相同图案的卡片，三张一起判定。',
      ],
      { preview: 4, lives: 5 },
    ],
    // Combination 8-14: previews shrink, clocks appear, rules alternate.
    [
      'pairs',
      4,
      3,
      6,
      ['Quick Ferns', '快手蕨叶'],
      [
        'Six pairs again, now with a decision clock that stops while cards are open.',
        '又是六对图案，加入思考计时；卡片翻开时计时暂停。',
      ],
      { preview: 2, lives: 8, clock: 70, show: 1.2 },
    ],
    [
      'route',
      5,
      2,
      5,
      ['Lantern Walk', '灯笼漫步'],
      [
        'Five lanterns in order. A short preview shows the cards once.',
        '五盏灯按顺序点亮。短暂预览只展示一次牌面。',
      ],
      { preview: 3, lives: 8, show: 1.2 },
    ],
    [
      'echo',
      4,
      3,
      8,
      ['Growing Echo', '渐长的回声'],
      [
        'The echo grows from three cues to five. A slip replays the same cues.',
        '回声从三声增长到五声。出错后会重播同样的提示。',
      ],
      { lives: 4, echo: { from: 3, to: 5, cue: 0.75, gap: 0.25 } },
    ],
    [
      'triples',
      4,
      3,
      4,
      ['Moss Quartet', '四丛苔藓'],
      [
        'Four triples. Wrong groups stay open briefly; leaves are limited.',
        '四组三张。配错的牌会短暂停留，叶子数量有限。',
      ],
      { preview: 3, lives: 8, show: 1.2 },
    ],
    [
      'pairs',
      5,
      4,
      10,
      ['Wide Glade', '宽阔林地'],
      [
        'Ten pairs on a wide board. Plan your search and watch the clock.',
        '十对图案，棋盘更大。规划好翻牌，留意计时。',
      ],
      { preview: 6, lives: 12, clock: 120, show: 1.1 },
    ],
    [
      'route',
      4,
      3,
      6,
      ['Lantern Bend', '灯笼弯道'],
      [
        'Six lanterns with no preview and a clock. Remember every card you uncover.',
        '六盏灯，没有预览，带计时。记住每张翻开过的牌。',
      ],
      { lives: 12, clock: 90, show: 1.1 },
    ],
    [
      'echo',
      4,
      3,
      8,
      ['Quick Echo', '急促回声'],
      [
        'Faster cues, four to six long. Each lit card shows its number in the order.',
        '更快的提示，长度从四到六。亮起的卡片会显示顺序编号。',
      ],
      { lives: 4, echo: { from: 4, to: 6, cue: 0.65, gap: 0.22 } },
    ],
    // Mastery 15-20: no previews, bigger boards, shorter windows.
    [
      'triples',
      5,
      3,
      5,
      ['Moss Council', '苔藓议会'],
      [
        'Five triples and no preview. A clock runs between turns.',
        '五组三张，没有预览。翻牌之间计时。',
      ],
      { lives: 10, clock: 95, show: 1.1 },
    ],
    [
      'route',
      4,
      4,
      8,
      ['Long Lantern Trail', '漫长灯径'],
      [
        'Eight lanterns on sixteen cards: follow the list and remember what you see.',
        '十六张牌上的八盏灯：跟随列表，记住看到的牌。',
      ],
      { preview: 6, lives: 21, clock: 140, show: 1.2 },
    ],
    [
      'echo',
      5,
      3,
      10,
      ['Deep Echo', '深谷回声'],
      ['A fifteen-card echo grows from four to seven cues.', '十五张牌的回声，从四声增长到七声。'],
      { lives: 4, echo: { from: 4, to: 7, cue: 0.55, gap: 0.2 } },
    ],
    [
      'pairs',
      5,
      4,
      10,
      ['Hidden Glade', '隐秘林地'],
      [
        'Ten pairs, no preview, and wrong turns close fast. Trust your notes.',
        '十对图案，无预览，配错的牌很快合上。相信你的记忆。',
      ],
      { lives: 12, clock: 120, show: 0.9 },
    ],
    [
      'triples',
      6,
      3,
      6,
      ['Grand Triples', '三重盛会'],
      [
        'Six triples across eighteen cards with a clock and short reveals.',
        '十八张牌上的六组三张，带计时，翻开时间很短。',
      ],
      { lives: 12, clock: 130, show: 0.9 },
    ],
    [
      'echo',
      6,
      3,
      10,
      ['Grove Echo', '森林回声'],
      [
        'The longest echo: five growing to eight cues on eighteen cards.',
        '最长的回声：十八张牌，从五声增长到八声。',
      ],
      { lives: 4, echo: { from: 5, to: 8, cue: 0.5, gap: 0.2 } },
    ],
  ].map(level),
);
export const LEVEL_COUNT = LEVELS.length;
/** 0 teaching, 1 combination, 2 mastery: drives the scenery. */
export const levelBand = (n) => (n < 8 ? 0 : n < 15 ? 1 : 2);
