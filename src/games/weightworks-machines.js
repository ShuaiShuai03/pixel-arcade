// Machine data for Weightworks. A beam lists its pegs (`span: n` means -n..-1 and 1..n), its gate
// ('=' level, '<' tips left, '>' tips right), fixed masses [peg, mass], locked pegs, the peg it
// hangs from [beam, peg] and tippers [side, mass, beam, peg]. The tray lists masses; an object
// {m, rail, at} is a mass that slides only along beam `rail`, starting on peg `at`.
const machine = (name, tip, beams, tray, extra = {}) => ({ name, tip, beams, tray, ...extra });
export const MACHINE_DEFS = [
  machine(
    ['First Balance', '初识平衡'],
    ['A mass pulls with its weight times its distance', '砝码的拉力等于重量乘以距离'],
    [{ span: 3, gate: '=', fixed: [[-2, 3]] }],
    [2],
  ),
  machine(
    ['Two Masses', '两块砝码'],
    ['X rotates the tray: choose which mass goes next', '按 X 转动托盘，选择下一块砝码'],
    [{ span: 4, gate: '=', fixed: [[-4, 2]] }],
    [1, 4],
  ),
  machine(
    ['Lean Right', '向右倾'],
    [
      'Some gates want a tilt, not a level: heavier side down',
      '指示灯也可能要求倾斜而不是水平：较重的一侧要下沉',
    ],
    [
      { span: 3, gate: '>', fixed: [[-3, 3]] },
      { span: 3, gate: '=', fixed: [[-1, 1]] },
    ],
    [5, 4, 2],
    { budget: 6 },
  ),
  machine(
    ['Hanging Scale', '悬挂的天平'],
    [
      'A hanging beam passes its whole load to the peg it hangs from',
      '悬挂的横梁会把全部重量传给挂住它的孔',
    ],
    [
      { span: 3, gate: '=' },
      { span: 3, gate: '=', fixed: [[-3, 3]], hang: [0, 2] },
    ],
    [3, 1, 5],
    { budget: 6 },
  ),
  machine(
    ['Budget Scale', '限步天平'],
    [
      'Undo with Z gives the move back, so a mistake is cheap',
      '按 Z 撤销会返还步数，所以失误不吃亏',
    ],
    [
      { span: 3, gate: '=', fixed: [[2, 1]] },
      { span: 3, gate: '=', fixed: [[3, 1]], hang: [0, -2] },
    ],
    [4, 2, 3],
    { budget: 5 },
  ),
  machine(
    ['Locked Pegs', '锁住的孔'],
    ['A padlock marks a peg that cannot hold a mass', '挂锁标出不能挂砝码的孔'],
    [
      { span: 3, gate: '=', locked: [3] },
      { span: 3, gate: '=', fixed: [[-1, 3]], locked: [3, -2], hang: [0, -1] },
    ],
    [3, 6, 2],
    { budget: 5 },
  ),
  machine(
    ['Sliding Mass', '滑动砝码'],
    [
      'A blue-rail slider stays on its beam; moving it costs 2 moves',
      '蓝轨滑块只能在自己的横梁上，挪动它要花 2 步',
    ],
    [
      { span: 3, gate: '=', locked: [3] },
      { span: 3, gate: '=', fixed: [[-1, 5]], locked: [2], hang: [0, 1] },
    ],
    [{ m: 5, rail: 0, at: -3 }, 3, 2],
    { budget: 6 },
  ),
  machine(
    ['Tipper', '翻斗'],
    [
      'A tipper drops a mass on another beam when its own beam tips',
      '横梁向标记方向倾斜时，翻斗会把砝码扔到另一根横梁上',
    ],
    [
      { span: 3, gate: '<' },
      { span: 3, gate: '>', fixed: [[-2, 4]], hang: [0, 2], tips: [['R', 4, 0, 3]] },
    ],
    [4, 6, 2, 3],
    { budget: 6 },
  ),
  machine(
    ['Three Links', '三连环'],
    ['Beams can hang from beams that hang from beams', '横梁可以一层一层地挂下去'],
    [
      { span: 3, gate: '=' },
      { span: 3, gate: '=', locked: [1], hang: [0, 2] },
      { span: 3, gate: '=', fixed: [[1, 3]], hang: [1, 2] },
    ],
    [3, 1, 6, 4],
    { budget: 6 },
  ),
  machine(
    ['Held Fast', '牢牢锁住'],
    [
      'Locks and a sliding mass together: plan the slider first',
      '锁和滑动砝码同台：先安排滑动的那块',
    ],
    [
      { span: 3, gate: '<', locked: [-3, 3] },
      { span: 3, gate: '=', fixed: [[2, 5]], locked: [-3, 1], hang: [0, 1] },
    ],
    [{ m: 3, rail: 1, at: 3 }, 3, 5, 4],
    { budget: 7 },
  ),
  machine(
    ['Spilling Over', '倾泻'],
    [
      'Tilt gates and a tipper: which way must each beam lean?',
      '倾斜灯加翻斗：每根横梁该倒向哪边？',
    ],
    [
      {
        span: 4,
        gate: '>',
        fixed: [
          [1, 1],
          [4, 1],
        ],
      },
      {
        span: 3,
        gate: '>',
        fixed: [
          [1, 3],
          [-1, 5],
        ],
        locked: [3, -2],
        hang: [0, -1],
        tips: [['R', 4, 0, -3]],
      },
    ],
    [{ m: 1, rail: 0, at: -4 }, 3, 5, 2],
    { budget: 7 },
  ),
  machine(
    ['Three Beams', '三根横梁'],
    [
      "Count each beam's whole load, including what hangs below",
      '要算上每根横梁的全部负载，包括挂在下面的',
    ],
    [
      { span: 3, gate: '=', fixed: [[-2, 5]] },
      { span: 3, gate: '=', fixed: [[2, 5]], locked: [-3, 1], hang: [0, 2] },
      { span: 2, gate: '=', fixed: [[2, 2]], hang: [0, -3] },
    ],
    [5, 4, 2, 6, 3],
    { budget: 7 },
  ),
  machine(
    ['Lean Chain', '倾斜链'],
    [
      'One tilt gate among level ones: mind which way it leans',
      '水平灯中夹着一个倾斜灯：注意它偏向哪边',
    ],
    [
      { span: 3, gate: '=', fixed: [[-2, 2]], locked: [-3, 2] },
      { span: 3, gate: '>', fixed: [[2, 3]], locked: [1], hang: [0, -1] },
      {
        span: 2,
        gate: '=',
        fixed: [
          [2, 2],
          [-1, 5],
        ],
        hang: [1, -2],
      },
    ],
    [6, 1, 2, 5, 4],
    { budget: 7 },
  ),
  machine(
    ['Rail Rider', '轨上骑手'],
    [
      'Shifting a placed slider costs two moves: lift, then place',
      '挪动已挂的滑块要两步：先取下，再挂上',
    ],
    [
      { span: 2, gate: '=' },
      { span: 3, gate: '=', fixed: [[-3, 3]], locked: [1, -1], hang: [0, -1] },
      { span: 3, gate: '=', fixed: [[3, 1]], hang: [0, 2] },
    ],
    [{ m: 4, rail: 0, at: 1 }, 6, 2, 3, 1],
    { budget: 8 },
  ),
  machine(
    ['Long Reach', '长臂'],
    ['Far pegs give a mass more leverage: use the long beam', '越远的孔力矩越大：用好长横梁'],
    [
      {
        span: 4,
        gate: '=',
        fixed: [
          [-2, 1],
          [1, 2],
        ],
        locked: [3],
      },
      { span: 3, gate: '=', fixed: [[-1, 5]], hang: [0, 2] },
    ],
    [{ m: 5, rail: 1, at: 2 }, 5, 3, 2, 1],
    { budget: 8 },
  ),
  machine(
    ['Spill and Slide', '倾泻与滑动'],
    ['Tippers, hangs and sliders in one machine', '翻斗、悬挂和滑块同台登场'],
    [
      { span: 3, gate: '=', fixed: [[1, 3]] },
      { span: 3, gate: '=', fixed: [[1, 3]], locked: [2], hang: [0, -1] },
      { span: 2, gate: '>', locked: [1, -1], hang: [0, 3], tips: [['R', 3, 1, -1]] },
    ],
    [{ m: 3, rail: 0, at: -3 }, 1, 4, 3, 6],
    { budget: 8 },
  ),
  machine(
    ['Bolted Rail', '固定的滑轨'],
    ["Locks block the slider's way: check each peg", '锁挡住了滑块的路：逐孔检查'],
    [
      {
        span: 3,
        gate: '<',
        fixed: [
          [-2, 4],
          [-3, 4],
        ],
        locked: [3],
      },
      {
        span: 3,
        gate: '=',
        fixed: [
          [2, 3],
          [1, 1],
        ],
        hang: [0, 1],
      },
      { span: 2, gate: '=', fixed: [[-1, 1]], locked: [2], hang: [0, 2] },
    ],
    [{ m: 2, rail: 2, at: 1 }, 6, 2, 5, 3],
    { budget: 7 },
  ),
  machine(
    ['Twin Sliders', '双滑块'],
    [
      'Each slider stays on its own beam: check its reachable pegs',
      '每块滑块只能在自己的横梁上：看清它能到的孔',
    ],
    [
      { span: 2, gate: '>' },
      { span: 2, gate: '=', fixed: [[-1, 5]], locked: [-2], hang: [0, 1] },
      { span: 3, gate: '=', fixed: [[-3, 3]], locked: [3, -2], hang: [0, -1] },
    ],
    [{ m: 1, rail: 1, at: 2 }, { m: 3, rail: 0, at: -2 }, 4, 1, 2],
    { budget: 8 },
  ),
  machine(
    ['Cascade', '层叠'],
    ['A tipper at the bottom feeds the top: work upward', '底部的翻斗给顶部加料：自下而上推演'],
    [
      { span: 3, gate: '>', locked: [3] },
      {
        span: 3,
        gate: '=',
        fixed: [
          [-2, 1],
          [-3, 4],
        ],
        locked: [-1],
        hang: [0, -1],
      },
      { span: 2, gate: '=', locked: [-1], hang: [0, 1], tips: [['L', 2, 0, -3]] },
    ],
    [{ m: 2, rail: 1, at: 3 }, 3, 4, 5, 1, 2],
    { budget: 8 },
  ),
  machine(
    ['Counterpoise', '配重'],
    [
      'Two beams lean right, one hangs level: read each lamp',
      '两根横梁要偏右，一根要保持水平：看清每盏灯',
    ],
    [
      { span: 2, gate: '>', fixed: [[2, 5]], locked: [-1] },
      { span: 2, gate: '>', hang: [0, 1] },
      { span: 2, gate: '=', locked: [2], hang: [1, -2] },
    ],
    [{ m: 3, rail: 1, at: 2 }, { m: 4, rail: 2, at: -1 }, 2, 5, 4],
    { budget: 8 },
  ),
  machine(
    ['Brass Maze', '黄铜迷宫'],
    ['Sliders, tippers and hooks: all gates at once', '滑块、翻斗和挂钩：所有灯要同时亮'],
    [
      { span: 3, gate: '=', fixed: [[-1, 4]], locked: [-3] },
      { span: 2, gate: '=', hang: [0, -2] },
      { span: 2, gate: '>', locked: [1], hang: [1, -2], tips: [['R', 3, 1, 2]] },
    ],
    [{ m: 2, rail: 2, at: -2 }, { m: 6, rail: 0, at: 3 }, 5, 4, 3, 2],
    { budget: 9 },
  ),
  machine(
    ['Clockwork Scale', '发条天平'],
    ['A tipper adds weight only while its beam leans that way', '翻斗只在横梁倾向那边时才加重量'],
    [
      { span: 3, gate: '<' },
      {
        span: 2,
        gate: '=',
        fixed: [
          [1, 3],
          [2, 4],
        ],
        hang: [0, -2],
        tips: [['L', 3, 0, -3]],
      },
      { span: 2, gate: '=', locked: [-2], hang: [0, 3] },
    ],
    [{ m: 3, rail: 1, at: -2 }, { m: 5, rail: 2, at: 1 }, 1, 6, 4, 3],
    { budget: 9 },
  ),
  machine(
    ['Master Balance', '大师之衡'],
    ['Work out the hanging loads before placing anything', '先算出各处悬挂的负载，再动手'],
    [
      { span: 2, gate: '=' },
      { span: 2, gate: '=', fixed: [[2, 3]], hang: [0, 1] },
      { span: 3, gate: '<', fixed: [[-3, 1]], locked: [-1], hang: [0, -2] },
    ],
    [{ m: 4, rail: 1, at: 1 }, { m: 3, rail: 1, at: -1 }, 2, 3, 5, 1],
    { budget: 9 },
  ),
  machine(
    ['Weightworks', '天平工坊'],
    ['The last machine: every rule at once', '最后一台机器：所有规则同时出现'],
    [
      { span: 3, gate: '=' },
      { span: 2, gate: '<', locked: [-2], hang: [0, 3] },
      { span: 3, gate: '=', fixed: [[-1, 1]], locked: [-2], hang: [0, 2], tips: [['R', 4, 0, 1]] },
    ],
    [{ m: 3, rail: 2, at: 3 }, { m: 1, rail: 0, at: -2 }, 6, 4, 3, 5],
    { budget: 9 },
  ),
];
