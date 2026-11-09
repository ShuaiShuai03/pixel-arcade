// Neon Snake level table. Every level is data: walls, gates, underpasses, fruit beds and pace.
// Curve: 1-7 teach one idea each, 8-14 combine them, 15-20 are mastery tests.
export const COLS = 24;
export const ROWS = 14;
export const DEFAULT_READY = 2.4;
const HEADINGS = Object.freeze({
  R: Object.freeze({ x: 1, y: 0 }),
  L: Object.freeze({ x: -1, y: 0 }),
  U: Object.freeze({ x: 0, y: -1 }),
  D: Object.freeze({ x: 0, y: 1 }),
});
const text = (en, zh) => ({ en, zh });

// walls: [x, y, w, h] rectangles. gates: [x, y, group]; group 0 is open on the first phase.
// passes: [x, y] underpass cells set into a wall. start: [headX, headY, heading, length].
// beds: one entry per fruit, each a [x, y] cell or a list of alternative cells.
const DEFINITIONS = [
  {
    name: text('Meadow', '草地'),
    tip: text(
      'Steer with arrows or WASD. Eat every fruit; walls and stones end the run.',
      '用方向键或WASD转向，吃光所有果实；撞墙或石头会失败。',
    ),
    period: 0.26,
    ready: 4,
    walls: [
      [4, 3, 3, 1],
      [16, 10, 3, 1],
    ],
    start: [4, 7, 'R', 3],
    beds: [
      [12, 4],
      [19, 5],
      [14, 11],
      [5, 10],
    ],
  },
  {
    name: text('Stone Garden', '石头花园'),
    tip: text(
      'Stones are solid. Plan a clear route around them before you turn.',
      '石头无法通过，转向前先规划绕行路线。',
    ),
    period: 0.24,
    walls: [
      [6, 3, 1, 4],
      [12, 8, 1, 4],
      [17, 2, 1, 5],
      [8, 11, 4, 1],
      [19, 9, 3, 1],
    ],
    start: [3, 7, 'R', 4],
    beds: [
      [9, 5],
      [14, 10],
      [20, 4],
      [19, 12],
      [4, 11],
    ],
  },
  {
    name: text('Switchback', '折返小径'),
    tip: text(
      'Tap the next two turns early: they queue and fire in order.',
      '提前按下接下来的两次转向，它们会依次排队执行。',
    ),
    period: 0.2,
    walls: [
      [0, 4, 20, 1],
      [4, 9, 20, 1],
    ],
    start: [3, 2, 'R', 4],
    beds: [
      [18, 2],
      [4, 6],
      [2, 11],
      [20, 12],
      [19, 6],
    ],
  },
  {
    name: text('Focus Sprint', '专注冲刺'),
    tip: text(
      'Fast pace. Hold Space to slow down; release to refill Focus.',
      '速度很快。按住空格减速，松开恢复专注。',
    ),
    period: 0.14,
    theme: 1,
    walls: [
      [5, 2, 1, 3],
      [9, 8, 1, 4],
      [13, 2, 1, 5],
      [17, 7, 1, 5],
      [20, 3, 3, 1],
    ],
    start: [3, 7, 'R', 4],
    beds: [
      [7, 3],
      [11, 10],
      [15, 9],
      [19, 2],
      [21, 12],
    ],
  },
  {
    name: text('Ruin Gates', '遗迹闸门'),
    tip: text(
      'Gates A and B swap every 4 moves and stay open while you are inside.',
      '闸门A和B每四步交替开放，身体在闸门内时保持打开。',
    ),
    period: 0.2,
    theme: 1,
    walls: [
      [0, 6, 24, 1],
      [8, 2, 1, 2],
      [15, 9, 1, 2],
    ],
    gates: [
      [5, 6, 0],
      [18, 6, 1],
    ],
    start: [4, 10, 'R', 5],
    beds: [
      [
        [4, 2],
        [7, 2],
      ],
      [
        [18, 10],
        [20, 10],
      ],
      [
        [20, 2],
        [18, 3],
      ],
      [
        [4, 11],
        [7, 11],
      ],
      [
        [12, 2],
        [12, 4],
      ],
      [
        [20, 11],
        [21, 9],
      ],
    ],
  },
  {
    name: text('Underpass', '地下通道'),
    tip: text(
      'Underpasses are normal cells: go straight through to reach the far side.',
      '地下通道是普通格子：直行穿过即可到达另一侧。',
    ),
    period: 0.2,
    theme: 2,
    walls: [
      [11, 0, 1, 14],
      [6, 3, 2, 1],
      [7, 10, 2, 1],
      [16, 3, 2, 1],
      [16, 10, 2, 1],
    ],
    passes: [
      [11, 3],
      [11, 10],
    ],
    start: [5, 7, 'R', 5],
    beds: [
      [
        [18, 4],
        [19, 5],
      ],
      [
        [4, 4],
        [3, 3],
      ],
      [
        [18, 11],
        [20, 10],
      ],
      [
        [4, 10],
        [5, 11],
      ],
      [
        [20, 3],
        [18, 2],
      ],
      [
        [3, 2],
        [5, 4],
      ],
    ],
  },
  {
    name: text('Long Tail', '长长的尾巴'),
    tip: text(
      'A long body is a moving wall: loop wide and let the tail clear.',
      '长长的身体是移动的墙：绕大圈，让尾巴先离开。',
    ),
    period: 0.2,
    theme: 2,
    walls: [
      [5, 3, 2, 2],
      [11, 3, 2, 2],
      [17, 3, 2, 2],
      [5, 9, 2, 2],
      [11, 9, 2, 2],
      [17, 9, 2, 2],
    ],
    start: [14, 7, 'R', 12],
    beds: [
      [20, 10],
      [15, 2],
      [3, 11],
      [9, 6],
      [21, 5],
    ],
  },
  {
    name: text('Gate Hall', '闸门大厅'),
    tip: text(
      'Two gate walls run on one clock: pass the first, then time the second.',
      '两道闸门墙共用同一个节拍：先过第一道，再算好第二道。',
    ),
    period: 0.19,
    theme: 1,
    walls: [
      [0, 4, 24, 1],
      [0, 9, 24, 1],
    ],
    gates: [
      [4, 4, 0],
      [19, 4, 1],
      [4, 9, 1],
      [19, 9, 0],
    ],
    start: [4, 7, 'R', 5],
    beds: [
      [10, 2],
      [20, 11],
      [6, 7],
      [15, 2],
      [6, 11],
      [12, 7],
      [3, 2],
    ],
  },
  {
    name: text('Quick Gates', '快节奏闸门'),
    tip: text(
      'Gates now swap every 3 moves. Count your steps before you enter.',
      '闸门改为每三步交替，进入前先数好步数。',
    ),
    period: 0.19,
    theme: 1,
    gatePeriod: 3,
    walls: [[0, 6, 24, 1]],
    gates: [
      [3, 6, 0],
      [9, 6, 1],
      [15, 6, 0],
      [20, 6, 1],
    ],
    start: [5, 10, 'R', 6],
    beds: [
      [12, 2],
      [18, 10],
      [5, 3],
      [10, 11],
      [20, 3],
      [4, 12],
      [14, 4],
    ],
  },
  {
    name: text('Twin Tunnels', '双重隧道'),
    tip: text(
      'Fruit hops between three bands: cross both tunnel walls to reach it.',
      '果实在三个区域间跳转：需要穿过两道隧道墙。',
    ),
    period: 0.18,
    theme: 2,
    walls: [
      [7, 0, 1, 14],
      [16, 0, 1, 14],
    ],
    passes: [
      [7, 3],
      [7, 10],
      [16, 6],
      [16, 11],
    ],
    start: [3, 7, 'U', 6],
    beds: [
      [12, 7],
      [21, 4],
      [5, 11],
      [12, 2],
      [20, 11],
      [11, 12],
      [3, 3],
    ],
  },
  {
    name: text('Weave', '蛇形穿梭'),
    tip: text(
      'Teeth force a weave. Focus slows the snake so you can make each turn.',
      '尖齿墙迫使你来回穿梭；专注可减速，帮你完成每次转向。',
    ),
    period: 0.12,
    theme: 3,
    walls: [
      [4, 0, 1, 10],
      [8, 4, 1, 10],
      [12, 0, 1, 10],
      [16, 4, 1, 10],
      [20, 0, 1, 10],
    ],
    start: [2, 8, 'D', 7],
    beds: [
      [6, 8],
      [10, 5],
      [14, 8],
      [18, 5],
      [22, 8],
      [18, 9],
      [10, 12],
    ],
  },
  {
    name: text('Crossroads', '十字路口'),
    tip: text(
      'A tunnel wall splits left from right; gate walls split top from bottom.',
      '隧道墙分开左右两侧，闸门墙分开上下两侧。',
    ),
    period: 0.17,
    theme: 3,
    walls: [
      [11, 0, 1, 14],
      [0, 6, 24, 1],
    ],
    passes: [
      [11, 2],
      [11, 11],
    ],
    gates: [
      [3, 6, 1],
      [8, 6, 0],
      [15, 6, 0],
      [20, 6, 1],
    ],
    start: [7, 10, 'R', 8],
    beds: [
      [8, 3],
      [18, 3],
      [18, 10],
      [5, 11],
      [5, 3],
      [20, 10],
      [15, 4],
      [8, 11],
    ],
  },
  {
    name: text('Ring Road', '环形路'),
    tip: text(
      'Your body is long here. Keep to the ring and never cut inside your tail.',
      '身体很长。沿环形路前进，不要切进自己的尾巴里。',
    ),
    period: 0.17,
    theme: 3,
    walls: [[4, 3, 16, 8]],
    start: [15, 1, 'R', 14],
    beds: [
      [20, 1],
      [22, 7],
      [14, 12],
      [6, 12],
      [2, 6],
      [10, 2],
      [21, 12],
    ],
  },
  {
    name: text('Tick Tock', '滴答闸门'),
    tip: text(
      'Gates swap every 2 moves: line up your approach so you arrive on time.',
      '闸门每两步交替：调整接近路线，准时到达。',
    ),
    period: 0.18,
    theme: 1,
    gatePeriod: 2,
    walls: [[0, 6, 24, 1]],
    gates: [
      [3, 6, 0],
      [7, 6, 1],
      [11, 6, 0],
      [15, 6, 1],
      [19, 6, 0],
    ],
    start: [5, 10, 'R', 6],
    beds: [
      [10, 2],
      [16, 11],
      [4, 3],
      [20, 10],
      [14, 3],
      [6, 12],
      [21, 2],
      [11, 10],
    ],
  },
  {
    name: text('Rush Hour', '高峰时刻'),
    tip: text(
      'Fast pace and gates together: Focus buys time to read the clock.',
      '高速与闸门并存：专注为你争取看清节拍的时间。',
    ),
    period: 0.13,
    theme: 3,
    walls: [
      [0, 6, 24, 1],
      [9, 2, 1, 3],
      [14, 9, 1, 3],
    ],
    gates: [
      [5, 6, 0],
      [18, 6, 1],
    ],
    start: [7, 10, 'R', 8],
    beds: [
      [3, 2],
      [20, 11],
      [15, 2],
      [8, 11],
      [21, 3],
      [12, 12],
      [6, 2],
      [19, 10],
    ],
  },
  {
    name: text('Four Rooms', '四间花园'),
    tip: text(
      'Four rooms, tunnels and gates: plan the order of the doors ahead.',
      '四个房间，隧道加闸门：提前规划进门顺序。',
    ),
    period: 0.16,
    theme: 2,
    walls: [
      [11, 0, 2, 14],
      [0, 6, 24, 1],
    ],
    passes: [
      [11, 3],
      [12, 3],
      [11, 10],
      [12, 10],
    ],
    gates: [
      [5, 6, 0],
      [18, 6, 1],
    ],
    start: [7, 10, 'R', 8],
    beds: [
      [5, 3],
      [18, 3],
      [18, 10],
      [5, 11],
      [8, 1],
      [20, 1],
      [20, 12],
      [8, 12],
    ],
  },
  {
    name: text('Needle', '针线小径'),
    tip: text(
      'A one-cell path with a long body: queue each turn before the end.',
      '单格小径加长身体：在尽头之前就排好转向。',
    ),
    period: 0.15,
    theme: 3,
    walls: [
      [0, 1, 23, 1],
      [1, 3, 23, 1],
      [0, 5, 23, 1],
      [1, 7, 23, 1],
      [0, 9, 23, 1],
      [1, 11, 23, 1],
      [0, 13, 24, 1],
    ],
    start: [17, 0, 'R', 16],
    beds: [
      [20, 0],
      [10, 2],
      [15, 4],
      [6, 6],
      [18, 8],
      [5, 10],
      [14, 12],
    ],
  },
  {
    name: text('Clockwork', '发条花园'),
    tip: text(
      'A lattice of gates on a 3-move clock: choose a route and keep count.',
      '三步节拍的闸门格栅：选定路线并记步数。',
    ),
    period: 0.16,
    theme: 3,
    gatePeriod: 3,
    walls: [
      [0, 6, 24, 1],
      [11, 0, 1, 6],
      [11, 7, 1, 7],
    ],
    gates: [
      [4, 6, 0],
      [9, 6, 1],
      [14, 6, 0],
      [20, 6, 1],
      [11, 3, 1],
      [11, 10, 0],
    ],
    start: [7, 10, 'R', 8],
    beds: [
      [6, 3],
      [17, 2],
      [20, 10],
      [7, 11],
      [4, 2],
      [14, 11],
      [20, 3],
      [3, 12],
      [8, 2],
    ],
  },
  {
    name: text('Long Haul', '漫长旅程'),
    tip: text(
      'A very long body and ten fruit: keep room to turn around your tail.',
      '身体极长，要吃十颗果实：留出绕过尾巴的空间。',
    ),
    period: 0.17,
    theme: 2,
    walls: [
      [4, 3, 3, 2],
      [10, 3, 3, 2],
      [16, 3, 3, 2],
      [4, 9, 3, 2],
      [10, 9, 3, 2],
      [16, 9, 3, 2],
    ],
    start: [18, 7, 'R', 16],
    beds: [
      [2, 2],
      [21, 10],
      [14, 6],
      [2, 12],
      [21, 2],
      [8, 6],
      [14, 10],
      [8, 2],
      [22, 7],
      [1, 7],
    ],
  },
  {
    name: text('Grand Garden', '盛大花园'),
    tip: text(
      'Everything at once: tunnels, gates, stones and a long body.',
      '一切齐聚：隧道、闸门、石头和长长的身体。',
    ),
    period: 0.15,
    theme: 3,
    walls: [
      [11, 0, 1, 14],
      [12, 6, 12, 1],
      [4, 3, 2, 2],
      [4, 9, 2, 2],
      [8, 6, 1, 2],
    ],
    passes: [
      [11, 3],
      [11, 10],
    ],
    gates: [
      [15, 6, 0],
      [21, 6, 1],
    ],
    start: [1, 10, 'D', 11],
    beds: [
      [2, 2],
      [19, 3],
      [19, 11],
      [2, 12],
      [21, 2],
      [14, 12],
      [7, 6],
      [20, 12],
      [14, 2],
      [2, 7],
    ],
  },
];

const key = (p) => `${p.x},${p.y}`;
const cells = (x, y, w, h) =>
  Array.from({ length: w * h }, (_, i) => ({ x: x + (i % w), y: y + Math.floor(i / w) }));

function build(def, index) {
  const [hx, hy, heading, length] = def.start;
  const direction = HEADINGS[heading];
  const gates = (def.gates ?? []).map(([x, y, group]) =>
    Object.freeze({ x, y, group, label: group ? 'B' : 'A' }),
  );
  const passes = (def.passes ?? []).map(([x, y]) => Object.freeze({ x, y }));
  const open = new Set([...gates, ...passes].map(key));
  const seen = new Set();
  const rocks = def.walls
    .flatMap(([x, y, w, h]) => cells(x, y, w, h))
    .filter((p) => !open.has(key(p)) && !seen.has(key(p)) && seen.add(key(p)))
    .map((p) => Object.freeze(p));
  const snake = Array.from({ length }, (_, i) =>
    Object.freeze({ x: hx - direction.x * i, y: hy - direction.y * i }),
  );
  const beds = def.beds.map((bed) =>
    Object.freeze((Array.isArray(bed[0]) ? bed : [bed]).map(([x, y]) => Object.freeze({ x, y }))),
  );
  return Object.freeze({
    n: index + 1,
    name: Object.freeze(def.name),
    tip: Object.freeze(def.tip),
    theme: def.theme ?? 0,
    period: def.period,
    ready: def.ready ?? DEFAULT_READY,
    gatePeriod: def.gatePeriod ?? 4,
    rocks: Object.freeze(rocks),
    gates: Object.freeze(gates),
    passes: Object.freeze(passes),
    snake: Object.freeze(snake),
    direction,
    beds: Object.freeze(beds),
    target: beds.length,
  });
}

export const LEVELS = Object.freeze(DEFINITIONS.map(build));
export const LEVEL_COUNT = LEVELS.length;
