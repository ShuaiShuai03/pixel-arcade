import { parseBoard, deepFreeze } from './circuit-weaver-engine.js';

// Circuit Weaver boards. Token key: . empty, I straight, L corner, T tee (digit = start rotation,
// ! = locked), + cross, X bridge, S9E source of 9 V facing east, K3W lamp wanting 3 V facing west.
// --- Boards ---
const board = (name, tip, rows, extra = {}) => ({ name, tip, rows, ...extra });

const BOARD_DEFS = [
  // BEGIN BOARDS
  board(
    ['First Spark', '第一道火花'],
    ['Turn the wire so current reaches the lamp', '转动导线，让电流通到灯'],
    ['. . . . .', 'S3E I1 I0 I1 K3W', '. . . . .'],
    { sealed: false },
  ),
  board(
    ['Corner Turn', '拐个弯'],
    ['Bends turn too; open ends are allowed here', '弯头也能转；这里允许有断头'],
    ['. S3E I0 L2 .', '. . . I1 .', '. . . L2 K3W'],
    { sealed: false },
  ),
  board(
    ['Two Lamps', '双灯'],
    ['A tee splits current; open ends are allowed here', '三通能分流；这里允许有断头'],
    ['. . . . . . K5S', 'S5E L1 . . . L2 L0', '. I1 . . . I0 .', '. L0 I1 I1 I0 T2 K5W'],
    { sealed: false },
  ),
  board(
    ['Seal It', '封好端口'],
    ['A bend aimed at a wall is an open end', '对着墙的弯头就是断头'],
    ['K9S . . . . . .', 'I0 . . . . . .', 'L1 L2 K9E L3 . . .', '. L3 I1 T3 I1 I1 S9W'],
  ),
  board(
    ['Decoy Loop', '诱饵环'],
    ['Spare tiles carry no current: leave them be', '多余的块不通电，别管它们'],
    ['T2 . T3 . I0 . K3S', '. . . L3 . L1 L1', 'L2 . . . L0 T3 K3W', 'S3E I1 I0 I0 L0 . .'],
  ),
  board(
    ['Two Rails', '双轨'],
    ['Open ends are fine, but 3 V must never touch 9 V', '断头没关系，但 3 V 绝不能碰 9 V'],
    ['. . L1 T1 I1 I1 L1', '. . I0 L3 I0 S3W S9N', '. K9E T2 I1 . . .', '. K3E T3 L3 . . .'],
    { sealed: false },
  ),
  board(
    ['Over and Under', '桥上桥下'],
    ['Open ends are fine; a bridge crosses without touching', '断头没关系；桥接块交叉而不相连'],
    [
      '. . . . . . .',
      '. L0 T0 I1 L3 K3S .',
      '. K9N T3 T2 X L1 .',
      'S3E I0 L1 . S9N . .',
      '. . . . . . .',
    ],
    { sealed: false },
  ),
  board(
    ['Bolted Down', '螺栓固定'],
    ['Locked tiles will not turn: route around them', '锁定的块不能转，绕开它们'],
    [
      '. . . . L3 I1 I0 S5W',
      '. . . L2 L3! . . .',
      '. . L2 L1 . . . .',
      '. . I0! . . . . .',
      'K5E I1! T0 I0 I1 K5W . .',
    ],
  ),
  board(
    ['Three Lamps', '三灯齐亮'],
    ['One source, three lamps', '一个电源，三盏灯'],
    [
      '. K9S K9E T3 I0 L1 .',
      '. T0 I0 L3 . I0 .',
      '. I1 . . . I1 T0',
      'K9E L2 . . . S9N .',
      'I1 . T0 . . . .',
    ],
  ),
  board(
    ['First Fuse', '第一根保险丝'],
    ['Turns are limited: a blown fuse resets the board', '转动次数有限，烧断会重置电路板'],
    ['S9E L0 K3S . . . .', '. I1 L3 I0 L1 L1 K9W', '. L2 I1 L1 S3N I0 .', '. . . L1 I0 L2 .'],
    { budget: 18 },
  ),
  board(
    ['Voltage Split', '电压分流'],
    ['Open ends are fine; keep 3 V and 9 V apart', '断头没关系；让 3 V 和 9 V 分开'],
    [
      '. . . S9E L0 . .',
      '. . K3E T0 T0 L1 .',
      '. . . L2 L2 T0 .',
      '. . K3E I0 T1 X S3W',
      '. . . . . L1 K9W',
    ],
    { sealed: false, budget: 20 },
  ),
  board(
    ['Long Way Round', '绕远路'],
    ['Locked tiles force a detour', '锁定的块逼你绕路'],
    [
      '. . . . . . . S5S .',
      '. . K5S . . L1! I0 L2 .',
      '. . I0 . . I0! . . .',
      '. . I1 . L0 L1 . . .',
      'K5E I1! T3 I0 L1 . . . .',
    ],
    { budget: 13 },
  ),
  board(
    ['Spare Parts', '多余零件'],
    ['Seven spare tiles, and some are traps', '七个多余零件，有些是陷阱'],
    [
      '. . . . L1 . S5S .',
      'I1 . . . T2 . I1 .',
      '. I0 . L2 . L2 L0 .',
      '. L3 I1 I1 I1 T1 I0 L2',
      '. K5N . I1 . I1 . K5N',
    ],
    { budget: 16 },
  ),
  board(
    ['Double Bridge', '双重桥接'],
    ['Open ends are fine; two crossings, one budget', '断头没关系；两处交叉，一份预算'],
    [
      '. S3S . . . . . .',
      'K9E X I0 I0 L1 . . .',
      '. L3 T1 L0 I0 . . .',
      'K9E T1 T3 X T0 I0 S9W .',
      '. . . K3N . . . .',
    ],
    { sealed: false, budget: 16 },
  ),
  board(
    ['Mixed Mains', '三种电压'],
    ['Open ends are fine; keep all three voltages apart', '断头没关系；三种电压要分开'],
    [
      '. . . L0 K5W . . .',
      'S5E I1 I0 L0 S3S . . .',
      '. . . T1 T2 L1 S9W .',
      '. . L0 X T1 L0 . .',
      'K9E I0 L1 K3N . . . .',
    ],
    { sealed: false, budget: 18 },
  ),
  board(
    ['Narrow Margin', '窄边'],
    ['Open ends are fine; only two spare turns', '断头没关系；只多两次转动'],
    [
      '. . . . . . .',
      '. . S3S L3 I0 I1 S9W',
      '. L2 T2 I1 . . .',
      '. T1 T0 T0 . . .',
      '. K3N K9N K9N . . .',
    ],
    { sealed: false, budget: 16 },
  ),
  board(
    ['Cross Talk', '串线'],
    ['Four lamps, two voltages, bridges and locks', '四盏灯，两种电压，桥与锁'],
    [
      '. K9S . . . S3S . K9S',
      '. L2 I1! L0 L0 T3 L0 I1',
      'L0 I0 I0 X L0 L1 X L1',
      'K3N . . T1 I1 L1 L2 L1',
      '. . . S9N . . . I0!',
      '. . . . . . . K3N',
    ],
    { budget: 24 },
  ),
  board(
    ['Labyrinth', '迷宫'],
    ['One source, four lamps, many decoys', '一个电源，四盏灯，许多诱饵'],
    [
      '. . . . . L2 I0 L1 .',
      '. T3 . . L2 T2 K9W K9N .',
      'T0 . . . T3 I1 K9W . .',
      '. . . . I1 . . . .',
      'L2 . . . I1 . . . .',
      'L1 L2 I0 S9E T2 I1 I0 I0 K9W',
    ],
    { budget: 20 },
  ),
  board(
    ['Locked Lattice', '锁定格栅'],
    ['Seven locks and a tight budget', '七把锁和紧张的预算'],
    [
      'K3S . . . . . K9S .',
      'L0! I1 L2! . . . I0! .',
      '. . L1 L3 L1 S3W I0! .',
      '. . . T3 L0 L2 L1 .',
      '. S9E I1 X I1 L3! . .',
      'K3E I1! I0 L3! . . . .',
    ],
    { budget: 19 },
  ),
  board(
    ['Four Volts', '四种电压'],
    ['Four voltages, four lamps: each wants its own', '四种电压，四盏灯：各用各的电'],
    [
      'K3S . . . . . . . .',
      'L2 L2 K9E I0 I1 I1 I1 I1 S9W',
      '. L2 L1 L0 I0 K5W . . .',
      'S12E L1 L3 X L1 . L1 I0 L0',
      'S5E X I1 L2 L2 I0 X L0 I1',
      '. L0 I0 I0 I1 I1 L2 S3N K12N',
    ],
    { budget: 26 },
  ),
  board(
    ['Tight Weave', '紧密编织'],
    ['Three crossings with two spare turns', '三处交叉，只多两次转动'],
    [
      '. . . S3S . . . . .',
      '. K9E I1 X L2 . . . .',
      'K9S . L2 T1 X I0 I0 I1 K3W',
      'I0 L3 L1 L0 T1 I1 L2 . .',
      'L2 X I1 L3 . . S9N . .',
      '. K3N . . . . . . .',
    ],
    { budget: 20 },
  ),
  board(
    ['Grand Grid', '大格板'],
    ['Three voltages, six lamps', '三种电压，六盏灯'],
    [
      '. . L1 K3W L0 I0 K5W K9S K9S',
      'S3E I1 T0 L3 I1 . L0 T1 L0',
      '. T2 L0 X T0 I0 X I0 K5W',
      '. . I1 L2 L0 L0 L0 . .',
      'T2 S5E L1 S9E X L0 T2 T1 .',
      '. . . . K3N . . . .',
    ],
    { budget: 32 },
  ),
  board(
    ['Master Weave', '大师织法'],
    ['Locks, bridges, decoys and one spare turn', '锁、桥、诱饵，只多一次转动'],
    [
      '. S5S K9S . . . . . .',
      '. L0 X I0 I0 I1 I0 I1 L0',
      'K3E L0 T2 I1! I1 I0 I1 S9W I1',
      'L1! X L2 . . S3S I1 L0 L0',
      'K9N L0! I1! T0 I0 L1 . I0 L1',
      '. T1 . K3N . . . K5N .',
    ],
    { budget: 23 },
  ),
  board(
    ['Final Fuse', '最后的保险丝'],
    ['The whole workshop on one board', '整座工坊在一块板上'],
    [
      '. K5E L1 S3S L1 I0 I0 L0 .',
      '. . L1 X X I1! S5W L1 S12W',
      '. I1 L0 X L2 . L2 K9W T1',
      '. L2 L1 T2 K3W . T0 I1 K9W',
      'S9E X L1 L2 I1 K3W I1 . .',
      '. K12N L3 I0 I0 I1! L2 . T2',
    ],
    { budget: 35 },
  ),
  // END BOARDS
];

export const BOARDS = deepFreeze(BOARD_DEFS.map(parseBoard));
export const BOARD_COUNT = BOARDS.length;
