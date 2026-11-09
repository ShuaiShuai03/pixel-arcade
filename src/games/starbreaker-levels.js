// Starbreaker field table: every layout is data. Rows are eight cells wide.
//   .  empty      a  plain (1 hit)   b  armoured (2 hits)   c  heavy (3 hits)
//   R  reactor (1 hit; destroying it damages every nearby brick and chains into other reactors)
//   <  >  drifting plain brick, sliding left / right      {  }  drifting armoured brick
// A drifting row holds only drifting bricks that share one direction, so rows never collide.
import { clamp } from '../shared/utils.js';

const CELLS = Object.freeze({
  a: Object.freeze({ hp: 1, kind: 'normal', drift: 0 }),
  b: Object.freeze({ hp: 2, kind: 'normal', drift: 0 }),
  c: Object.freeze({ hp: 3, kind: 'normal', drift: 0 }),
  R: Object.freeze({ hp: 1, kind: 'reactor', drift: 0 }),
  '<': Object.freeze({ hp: 1, kind: 'normal', drift: -1 }),
  '>': Object.freeze({ hp: 1, kind: 'normal', drift: 1 }),
  '{': Object.freeze({ hp: 2, kind: 'normal', drift: -1 }),
  '}': Object.freeze({ hp: 2, kind: 'normal', drift: 1 }),
});
const FIELD_TOP = 58;
const BRICK_HEIGHT = 14;
const COLUMN_PITCH = 48;
const FIRST_COLUMN = 48;
const DEFAULT_WIDTH = 42;
const DEFAULT_ROW_PITCH = 21;
export const DRIFT_AMPLITUDE = 18;
export const DRIFT_RATE = 0.65;

const field = (en, zh, tipEn, tipZh, rows, layout = {}) =>
  Object.freeze({
    name: Object.freeze({ en, zh }),
    tip: Object.freeze({ en: tipEn, zh: tipZh }),
    rows: Object.freeze(rows),
    width: layout.width ?? DEFAULT_WIDTH,
    rowPitch: layout.rowPitch ?? DEFAULT_ROW_PITCH,
    stagger: layout.stagger ?? 0,
  });
const OFFSET = { width: 36, rowPitch: 25, stagger: 9 };

export const LEVELS = Object.freeze([
  // Teaching: one idea per field.
  field(
    'First Contact',
    '初次接触',
    "Break every brick. Hit the ball with the paddle's edge to send it sideways. A training net saves your first two misses.",
    '击碎所有砖块。用球拍边缘接球，可把球打向侧面。训练网会挡住前两次漏球。',
    ['aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa'],
  ),
  field(
    'Open Lanes',
    '空隙通道',
    'Gaps let the ball slip behind the bricks and keep bouncing there. Aim shots through them.',
    '缺口能让球钻到砖块后面反复弹跳，瞄准缺口发球。',
    ['a.a.a.a.', '.a.a.a.a', 'a.a.a.a.'],
  ),
  field(
    'Armour',
    '装甲砖',
    'Bricks marked with a bar are armoured and need two hits.',
    '带横条的砖有装甲，需要击中两次。',
    ['bbbbbbbb', 'aaaaaaaa', 'aaaaaaaa'],
  ),
  field(
    'Corridors',
    '狭窄通道',
    'Narrow corridors: bank the ball off a side wall to reach the bricks at the back.',
    '狭窄通道：借侧墙反弹，才能打到后排砖块。',
    ['a..aa..a', 'a..aa..a', 'a..aa..a', 'a..aa..a'],
  ),
  field(
    'Reactor',
    '反应堆',
    'A glowing cross is a reactor. Destroying it damages every brick close to it.',
    '发光十字砖是反应堆，被击毁时会损伤附近所有砖块。',
    ['aaaaaaaa', 'aaaRaaaa', 'aaaaaaaa', 'aaaaaaaa'],
  ),
  field(
    'Drifters',
    '漂移砖',
    'Drifting bricks slide sideways and push the ball. Time shots for where they will be.',
    '漂移砖会左右滑动并推动小球，要预判它们的位置。',
    ['>>>>>>>>', '<<<<<<<<', 'aaaaaaaa'],
  ),
  field(
    'Safety Catch',
    '紧急接球',
    'Down arms a catch for 3 s: if the ball then meets the paddle it sticks, so you can aim. You hold 3.',
    '按下键备好接球（3秒）：此时球碰到球拍会被吸住，方便瞄准。共有 3 次。',
    ['...aa...', '..aaaa..', '.aabbaa.', '..aaaa..'],
  ),
  // Combination: the taught ideas meet.
  field(
    'Armoured Weave',
    '装甲编织',
    'Armoured and plain bricks alternate. Clear the plain ones first to open lanes.',
    '装甲砖与普通砖交错。先打掉普通砖来开辟通路。',
    ['babababa', 'abababab', 'babababa'],
  ),
  field(
    'The Fuse',
    '导火索',
    'A reactor sets off the reactors beside it in a chain. Dig through the armour to the fuse.',
    '反应堆会引爆相邻的反应堆形成连锁，先打穿装甲到达引信。',
    ['bbbbbbbb', 'bbbbbbbb', 'aRRRRRRa', 'aaaaaaaa'],
  ),
  field(
    'Heavy Drift',
    '重型漂移',
    'An armoured drifting row sweeps over plain rows. The two moving rows run in opposite directions.',
    '装甲漂移排在普通砖上方滑动，两排移动方向相反。',
    ['}}}}}}}}', 'aaaaaaaa', '<<<<<<<<', 'aaaaaaaa'],
  ),
  field(
    'Fortress',
    '堡垒',
    'A shell of armour hides the core. Breach it, then bounce shots inside.',
    '装甲外壳守着核心。先打穿外壳，再把球打进里面。',
    ['bbbbbbbb', 'ba.aa.ab', 'b.a..a.b', 'bbbbbbbb'],
  ),
  field(
    'Offset Rows',
    '错位砖排',
    'Offset rows leave narrow slots. Reactors in the middle crack the layers around them.',
    '错位的砖排留下窄缝，中间的反应堆能震裂周围砖层。',
    ['bbbbbbbb', 'aaaaaaaa', 'aaRaaRaa', 'aaaaaaaa', 'aaaaaaaa'],
    OFFSET,
  ),
  field(
    'Crosswind',
    '横风',
    'Four drifting rows slide in alternating directions. Every shot is a moving target.',
    '四排漂移砖交替朝相反方向滑动，每一发都是移动靶。',
    ['>>>>>>>>', '<<<<<<<<', '>>>>>>>>', '<<<<<<<<'],
  ),
  field(
    'Reactor Maze',
    '反应堆迷宫',
    'Reactors sit at the edges and the centre. Choose which to set off to open the armour.',
    '边缘和中央都有反应堆，选择引爆哪个来打开装甲。',
    ['R..bb..R', 'aabbbbaa', 'a.aRRa.a', 'aaaaaaaa'],
  ),
  // Mastery: dense armour, chains and moving walls together.
  field(
    'Diamond Core',
    '菱形核心',
    'Triple-hit crowns cap a diamond. Its core reactors crack the armour from inside.',
    '三层装甲的顶冠封住菱形，核心反应堆能从内部震裂装甲。',
    ['...cc...', '..bbbb..', '.bbRRbb.', '..bbbb..', '...cc...'],
  ),
  field(
    'The Cage',
    '牢笼',
    'Armour walls in a cage. Detonate the corner reactors to crack it from within.',
    '装甲围成牢笼，引爆角落的反应堆可从内部震裂它。',
    ['cbbbbbbc', 'bR....Rb', 'b..cc..b', 'bR....Rb', 'cbbbbbbc'],
  ),
  field(
    'Rolling Tide',
    '潮汐',
    'Armoured drifting rows hide among plain ones. Strike as a row turns back.',
    '装甲漂移排夹在普通排之间，趁其折返时出击。',
    ['}}}}}}}}', '<<<<<<<<', '{{{{{{{{', '>>>>>>>>'],
  ),
  field(
    'Chain Gallery',
    '连锁长廊',
    'Reactors line up in columns: one blast can chain down a whole column.',
    '反应堆上下对齐，一次爆炸能沿整列连锁。',
    ['bRbbbbRb', 'aaaaaaaa', 'bRaaaaRb', 'aaaaaaaa', 'aaaaaaaa'],
    OFFSET,
  ),
  field(
    'Gauntlet',
    '闯关通道',
    'Armoured towers leave narrow lanes. A catch holds the ball while you position the paddle.',
    '装甲高塔只留窄道。接球能吸住球，让你先摆好球拍。',
    ['bb.cc.bb', 'b..cc..b', 'bR.bb.Rb', 'a.a..a.a', 'aa....aa'],
  ),
  field(
    'Starbreaker',
    '星砖破坏者',
    'Everything at once: armour, reactors and two drifting rows. Break the star!',
    '一切齐聚：装甲、反应堆和两排漂移砖。击破这颗星！',
    ['cbbRRbbc', '}}}}}}}}', 'bRaaaaRb', '{{{{{{{{', 'aabccbaa'],
  ),
]);
export const LEVEL_COUNT = LEVELS.length;
export const clampLevel = (level) => clamp(Math.floor(Number(level)) || 1, 1, LEVEL_COUNT);

/** Build the bricks of one field (1-based). Always a fresh, mutable list. */
export function makeBricks(level) {
  const spec = LEVELS[clampLevel(level) - 1],
    bricks = [];
  spec.rows.forEach((row, r) =>
    [...row].forEach((ch, col) => {
      const cell = CELLS[ch];
      if (!cell) return;
      const x = FIRST_COLUMN + col * COLUMN_PITCH + (r % 2 ? spec.stagger : 0);
      bricks.push({
        x,
        y: FIELD_TOP + r * spec.rowPitch,
        baseX: x,
        w: spec.width,
        h: BRICK_HEIGHT,
        hp: cell.hp,
        maxHp: cell.hp,
        color: r % 4,
        kind: cell.kind,
        drift: cell.drift,
      });
    }),
  );
  return bricks;
}
