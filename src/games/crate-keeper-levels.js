// Crate Keeper level data: twenty original warehouses, each with its push-optimal par from the solver.
const pair = ([en, zh]) => Object.freeze([en, zh]);

export const LEVELS = Object.freeze([
  Object.freeze(['#######', '#     #', '# @$. #', '#     #', '#######']),
  Object.freeze(['######', '#   .#', '#@ $ #', '#  ###', '######']),
  Object.freeze(['#######', '## .  #', '##$#  #', '#     #', '#@    #', '#######']),
  Object.freeze(['#######', '#.$  .#', '# ##$##', '# @   #', '#     #', '#######']),
  Object.freeze(['#######', '#.#   #', '#   $##', '# #$. #', '#  @  #', '#######']),
  Object.freeze(['#######', '#   . #', '# $$  #', '#. #  #', '# #@  #', '#######']),
  Object.freeze(['########', '#    # #', '# #$.. #', '## $ # #', '#+$    #', '########']),
  Object.freeze(['########', '#    ###', '#   #@##', '#. $$$.#', '#    . #', '########']),
  Object.freeze([
    '########',
    '##@#   #',
    '# $ #* #',
    '# .$   #',
    '## #.  #',
    '#      #',
    '########',
  ]),
  Object.freeze([
    '########',
    '#  $. .#',
    '#   #$ #',
    '#   #@##',
    '#    $ #',
    '#    . #',
    '########',
  ]),
  Object.freeze([
    '########',
    '# * *  #',
    '#@$    #',
    '#.## $ #',
    '#   #  #',
    '# # # .#',
    '########',
  ]),
  Object.freeze([
    '########',
    '#.$  . #',
    '# #.$ ##',
    '#   $###',
    '#  # #*#',
    '# @    #',
    '########',
  ]),
  Object.freeze([
    '########',
    '#  .@  #',
    '##$# $ #',
    '# $.# ##',
    '#.$    #',
    '# .    #',
    '########',
  ]),
  Object.freeze([
    '########',
    '#.   ###',
    '#  #$  #',
    '# $ . .#',
    '# $#.$ #',
    '# @ # ##',
    '########',
  ]),
  Object.freeze([
    '#########',
    '#.@    .#',
    '#$    #*#',
    '# #$### #',
    '# $ $  ##',
    '#..     #',
    '#########',
  ]),
  Object.freeze([
    '#########',
    '#   # . #',
    '#   **+ #',
    '# $   $ #',
    '# .$ ## #',
    '## ##   #',
    '#########',
  ]),
  Object.freeze([
    '#########',
    '##@ #   #',
    '##$$#  ##',
    '#   #. .#',
    '# .$$$  #',
    '## ..   #',
    '#########',
  ]),
  Object.freeze([
    '#########',
    '#   # + #',
    '#.# #$* #',
    '#$    $##',
    '#  ..$  #',
    '##      #',
    '#########',
  ]),
  Object.freeze([
    '#########',
    '##      #',
    '## # .$ #',
    '#+# $$ ##',
    '#  *.   #',
    '#  $. ###',
    '#########',
  ]),
  Object.freeze([
    '#########',
    '#    .  #',
    '# $$ #  #',
    '##$ ##  #',
    '#.  $  $#',
    '#  #..@.#',
    '#########',
  ]),
]);
export const LEVEL_COUNT = LEVELS.length;
/** Fewest pushes for each level, proven by the breadth-first solver in the tests. */
export const PAR_PUSHES = Object.freeze([
  1, 4, 6, 9, 9, 10, 13, 13, 15, 16, 17, 19, 20, 22, 24, 24, 26, 26, 27, 31,
]);
const WALKS_PER_PUSH = 5;
const ROOM_BASE = 600;
const ROOM_PER_PUSH = 40;
const MOVE_PENALTY = 10;
const MIN_ROOM_SCORE = 100;
/** Room score: worth more for longer rooms, trimmed by moves beyond about five steps per par push. */
export function roomScore(level, moves) {
  const par = PAR_PUSHES[level - 1],
    extra = Math.max(0, moves - WALKS_PER_PUSH * par);
  return Math.max(MIN_ROOM_SCORE, ROOM_BASE + ROOM_PER_PUSH * par - MOVE_PENALTY * extra);
}
export const TITLES = Object.freeze(
  [
    ['Receiving dock', '收货码头'],
    ['Side door', '侧门通道'],
    ['Narrow gap', '狭窄豁口'],
    ['Twin freight', '双箱货运'],
    ['Clear lane', '畅通通道'],
    ['Tight corners', '狭窄转角'],
    ['Triple load', '三箱装载'],
    ['Loading row', '装卸排'],
    ['Spare dock', '占位货位'],
    ['Long haul', '长途搬运'],
    ['Overflow bay', '溢出货仓'],
    ['Four corners', '四角货仓'],
    ['Back aisle', '后侧过道'],
    ['Cramped hold', '拥挤货舱'],
    ['Full house', '满载仓库'],
    ['Stacked bay', '堆叠货仓'],
    ['Cold storage', '冷藏仓库'],
    ['Night shift', '夜班仓库'],
    ['Grand depot', '大型货栈'],
    ['Final inspection', '终极检验'],
  ].map(pair),
);
export const LESSONS = Object.freeze(
  [
    ['Stand behind the crate and push it onto the dock.', '站在箱子后面，把它推到货位。'],
    [
      'A wall blocks the direct push: shove the crate aside first.',
      '墙挡住直推：先把箱子推向一旁，再绕行。',
    ],
    [
      'The crate starts in a narrow gap: push it out to open floor.',
      '箱子卡在窄口：先把它推到空地上。',
    ],
    [
      'Two crates, two docks: decide which crate fills which dock.',
      '两只箱子两个货位：先想好各自去哪个货位。',
    ],
    [
      'Two crates: leave a lane so you can get behind each one.',
      '两只箱子：留出通道，才能绕到每只箱子后面。',
    ],
    [
      'Two crates, tight walls: a crate marked ! is stuck. Undo.',
      '两只箱子，墙壁紧凑：标有！的箱子已卡死，请撤销。',
    ],
    [
      'Three crates, three docks: check each route before pushing.',
      '三只箱子三个货位：推之前先检查每条路线。',
    ],
    ['Three crates: keep room to walk around each one.', '三只箱子：给每只箱子留出绕行的空间。'],
    [
      'A crate starts on a dock but may need to leave it.',
      '有箱子一开始就在货位上，但可能得先让开。',
    ],
    ['Three crates and a long route: look two pushes ahead.', '三只箱子，路线很长：多想两步再推。'],
    [
      'Four crates, two already docked: both may need to move.',
      '四只箱子，两只已在货位：它们可能都得移开。',
    ],
    ['Four crates: the hint (H) shows only the next step.', '四只箱子：提示键（H）只给出下一步。'],
    ['Four crates: if you are stuck, undo (Z) is free.', '四只箱子：卡住时可随时撤销（Z）。'],
    [
      'Four crates in a cramped room: one push can block the aisle.',
      '四只箱子，空间拥挤：一推就可能堵住过道。',
    ],
    [
      'Five crates, five docks: make sure every crate has a way in.',
      '五只箱子五个货位：确认每只箱子都有路可进。',
    ],
    [
      'Five crates, two already docked: moving them may free the aisle.',
      '五只箱子，两只已在货位：移开它们可能腾出通道。',
    ],
    [
      'Five crates and no head start: plan the order of deliveries.',
      '五只箱子，没有现成入位：规划好送货顺序。',
    ],
    ['Five crates: the docked one may need to step aside.', '五只箱子：已入位的那只可能得先让开。'],
    [
      'A long job, five crates: undo is free, so test your ideas.',
      '五只箱子的长活：撤销不扣分，放手试想法。',
    ],
    [
      'Final room: five crates. Take it one dock at a time.',
      '最后一间：五只箱子。一个货位一个货位地来。',
    ],
  ].map(pair),
);
