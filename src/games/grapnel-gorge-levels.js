// Grapnel Gorge route table: every route is data (pads, anchors, rocks, relics, tip).
// Pads are cairns you can stand on (the last one holds the flag). Anchors may slide on a rail.
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};
const anchor = (id, x, y, extras = {}) => ({
  id,
  x,
  y,
  amplitudeX: 0,
  amplitudeY: 0,
  frequency: 0,
  phase: 0,
  ...extras,
});
const pad = (id, x, y, w, exit = false) => ({ id, x, y, w, ...(exit ? { exit: true } : {}) });
const overhang = (x, w, h) => ({ x, y: 36, w, h, kind: 'overhang' });
const route = (id, theme, en, zh, tipEn, tipZh, parts) => ({
  id,
  theme,
  name: { en, zh },
  lesson: { en: tipEn, zh: tipZh },
  rocks: [],
  relics: [],
  ...parts,
});

export const LEVELS = deepFreeze([
  route(
    'copper-arch',
    0,
    'Copper Arch',
    '赤铜拱',
    'Hook with Space, hold Up to reel in, and release when the dots end in a check on the flag cairn.',
    '按空格钩索，按住上键收绳，落点出现对勾时再按空格松开，落上旗台。',
    {
      pads: [pad(0, 12, 252, 116), pad(1, 280, 252, 188, true)],
      anchors: [anchor(0, 207, 80)],
      relics: [{ id: 'copper-arch-relic', x: 287, y: 198 }],
    },
  ),
  route(
    'split-spire',
    1,
    'Split Spire',
    '双塔隘口',
    'Rock blocks hooks and snaps any rope that touches it, which costs a life. Rest on the middle cairn between swings.',
    '岩石会阻挡钩索，也会扯断碰到它的绳索，并消耗一条生命。两次摆荡之间在中间石台休息。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 208, 252, 76), pad(2, 376, 252, 92, true)],
      anchors: [anchor(0, 162, 84), anchor(1, 330, 80)],
      rocks: [overhang(179, 26, 67)],
      relics: [{ id: 'split-spire-relic', x: 215, y: 204 }],
    },
  ),
  route(
    'stepping-stones',
    2,
    'Stepping Stones',
    '阶梯石台',
    'Each cairn is higher than the last: reel in as you swing to gain height.',
    '每座石台都比前一座更高：摆荡时收绳以获得高度。',
    {
      pads: [pad(0, 12, 252, 97), pad(1, 223, 230, 63), pad(2, 382, 213, 86, true)],
      anchors: [anchor(0, 172, 98), anchor(1, 332, 95)],
      relics: [{ id: 'stepping-stones-relic', x: 235, y: 200 }],
    },
  ),
  route(
    'skyrail-crossing',
    0,
    'Skyrail Crossing',
    '天轨横渡',
    'Rail motors slide the anchors; arrows show their direction. Hook, then wait for a check.',
    '轨道电机会移动锚点，箭头表示方向。钩住后等对勾出现再松开。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 214, 252, 66), pad(2, 380, 240, 70, true)],
      anchors: [
        anchor(0, 165, 86, { amplitudeX: 20, frequency: 0.8 }),
        anchor(1, 330, 84, { amplitudeY: 12, frequency: 0.7, phase: 0.6 }),
      ],
      relics: [{ id: 'skyrail-crossing-relic', x: 230, y: 210 }],
    },
  ),
  route(
    'long-reach',
    1,
    'Long Reach',
    '远道',
    'One long gap: reel in as you swing and release high so the dots end on the far cairn.',
    '一段很长的缺口：摆荡时收绳，在高处松开，让落点停在远处石台。',
    {
      pads: [pad(0, 12, 252, 117), pad(1, 321, 222, 70, true)],
      anchors: [anchor(0, 246, 74)],
      relics: [{ id: 'long-reach-relic', x: 299, y: 151 }],
    },
  ),
  route(
    'stone-teeth',
    2,
    'Stone Teeth',
    '石牙',
    'A rock snaps any rope that touches it and costs a life. Release before the swing carries the rope into stone.',
    '岩石会扯断碰到它的绳索并消耗一条生命。在摆荡把绳索带进岩石之前松开。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 216, 246, 66), pad(2, 382, 240, 86, true)],
      anchors: [anchor(0, 166, 84), anchor(1, 332, 80)],
      rocks: [overhang(350, 22, 84)],
      relics: [{ id: 'stone-teeth-relic', x: 222, y: 199 }],
    },
  ),
  route(
    'twin-hooks',
    0,
    'Twin Hooks',
    '双钩',
    'Several anchors reach each gap. Press X or tap one to choose; a lower anchor swings faster.',
    '每段缺口有多个锚点可用。按X或点按锚点来选择；较低的锚点摆得更快。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 212, 246, 66), pad(2, 374, 238, 70, true)],
      anchors: [anchor(0, 164, 84), anchor(1, 326, 80), anchor(2, 170, 160), anchor(3, 330, 170)],
      relics: [{ id: 'twin-hooks-relic', x: 220, y: 200 }],
    },
  ),
  route(
    'rail-lift',
    1,
    'Rail Lift',
    '升降轨',
    'These anchors rise and fall on their rails. Arrows show which way they move.',
    '这些锚点沿轨道升降，箭头表示移动方向。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 214, 248, 58), pad(2, 368, 240, 62, true)],
      anchors: [
        anchor(0, 165, 90, { amplitudeY: 14, frequency: 0.7, phase: 1 }),
        anchor(1, 320, 86, { amplitudeY: 16, frequency: 0.9, phase: 2.5 }),
      ],
      relics: [{ id: 'rail-lift-relic', x: 231, y: 198 }],
    },
  ),
  route(
    'gate-run',
    2,
    'Gate Run',
    '岩门疾行',
    'Two rocks hang across the canyon. Rocks block hooks and snap ropes at the cost of a life, so pick a clear anchor.',
    '两块岩石悬在峡谷上方。岩石会阻挡钩索，扯断绳索还会消耗一条生命，请选择无遮挡的锚点。',
    {
      pads: [pad(0, 12, 251, 103), pad(1, 237, 250, 58), pad(2, 379, 225, 62, true)],
      anchors: [anchor(0, 175, 96), anchor(1, 337, 84)],
      rocks: [overhang(232, 24, 118), overhang(398, 20, 118)],
      relics: [{ id: 'gate-run-relic', x: 239, y: 199 }],
    },
  ),
  route(
    'narrow-ledge',
    0,
    'Narrow Ledge',
    '窄崖',
    'The cairns here are narrow. Release as soon as the dots end in a check.',
    '这里的石台很窄。落点一出现对勾就松开。',
    {
      pads: [pad(0, 12, 244, 108), pad(1, 232, 238, 58), pad(2, 396, 232, 72, true)],
      anchors: [anchor(0, 176, 86), anchor(1, 343, 82)],
      relics: [{ id: 'narrow-ledge-relic', x: 234, y: 192 }],
    },
  ),
  route(
    'sway-bridge',
    1,
    'Sway Bridge',
    '摆动栈桥',
    'Anchors sway left and right on their rails. Hook, then release on a check.',
    '锚点沿轨道左右摆动。钩住后，在出现对勾时松开。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 216, 246, 58), pad(2, 374, 238, 62, true)],
      anchors: [
        anchor(0, 166, 88, { amplitudeX: 26, frequency: 1, phase: 0.3 }),
        anchor(1, 324, 84, { amplitudeX: 24, frequency: 1.1, phase: 2 }),
      ],
      relics: [{ id: 'sway-bridge-relic', x: 235, y: 151 }],
    },
  ),
  route(
    'rising-stair',
    2,
    'Rising Stair',
    '登天阶',
    'A steeper climb: each cairn rises about 20 pixels. Reel in as you swing.',
    '更陡的攀升：每座石台约升高20像素。摆荡时收绳。',
    {
      pads: [pad(0, 12, 248, 104), pad(1, 228, 228, 58), pad(2, 398, 206, 70, true)],
      anchors: [anchor(0, 172, 90), anchor(1, 342, 88)],
      relics: [{ id: 'rising-stair-relic', x: 241, y: 196 }],
    },
  ),
  route(
    'drop-down',
    0,
    'Drop Down',
    '垂降',
    'Each cairn is lower than the last, so the landing dots reach it sooner.',
    '每座石台都比前一座更低，落点会更早到达。',
    {
      pads: [pad(0, 12, 200, 106), pad(1, 226, 218, 58), pad(2, 384, 234, 62, true)],
      anchors: [anchor(0, 172, 84), anchor(1, 334, 90)],
      relics: [{ id: 'drop-down-relic', x: 219, y: 165 }],
    },
  ),
  route(
    'zigzag-steps',
    1,
    'Zigzag Steps',
    '之字阶',
    'Up, then down, past a hanging rock. Watch the landing dots before you let go.',
    '先上后下，还要绕过悬挂的岩石。松开前先看落点。',
    {
      pads: [pad(0, 12, 240, 100), pad(1, 232, 222, 58), pad(2, 408, 236, 60, true)],
      anchors: [anchor(0, 172, 82), anchor(1, 349, 86)],
      rocks: [overhang(241, 23, 92)],
      relics: [{ id: 'zigzag-steps-relic', x: 242, y: 187 }],
    },
  ),
  route(
    'rail-maze',
    2,
    'Rail Maze',
    '轨道迷径',
    'Narrow cairns and anchors that rise and fall on their rails. Time your hook.',
    '石台很窄，锚点沿轨道升降。把握好钩索的时机。',
    {
      pads: [pad(0, 12, 236, 100), pad(1, 213, 242, 50), pad(2, 387, 224, 48, true)],
      anchors: [
        anchor(0, 163, 94, { amplitudeX: 36, frequency: 1.3, phase: 0.8 }),
        anchor(1, 325, 90, { amplitudeY: 20, frequency: 1.4, phase: 4.4 }),
      ],
      relics: [{ id: 'rail-maze-relic', x: 208, y: 183 }],
    },
  ),
  route(
    'needle-reach',
    0,
    'Needle Reach',
    '针尖远渡',
    'Two big swings to narrow cairns, with anchors swaying and bobbing on their rails.',
    '两次通往窄石台的长距离摆荡，锚点在轨道上摆动并升降。',
    {
      pads: [pad(0, 12, 252, 96), pad(1, 232, 242, 46), pad(2, 402, 232, 44, true)],
      anchors: [
        anchor(0, 170, 92, { amplitudeX: 40, frequency: 1.4, phase: 0.5 }),
        anchor(1, 340, 88, { amplitudeY: 22, frequency: 1.3, phase: 2 }),
      ],
      relics: [{ id: 'needle-reach-relic', x: 229, y: 214 }],
    },
  ),
  route(
    'hollow-gate',
    1,
    'Hollow Gate',
    '空心岩门',
    'Two rocks, one right over the middle cairn, and swaying anchors: release before a rope touches stone.',
    '两块岩石，其中一块正压在中间石台上方，锚点还在摆动：在绳索碰到岩石前松开。',
    {
      pads: [pad(0, 12, 252, 104), pad(1, 224, 246, 46), pad(2, 382, 238, 44, true)],
      anchors: [
        anchor(0, 170, 84, { amplitudeX: 30, frequency: 1.2, phase: 2 }),
        anchor(1, 326, 82, { amplitudeY: 16, frequency: 1.3, phase: 1 }),
      ],
      rocks: [overhang(218, 21, 95), overhang(356, 22, 84)],
      relics: [{ id: 'hollow-gate-relic', x: 205, y: 188 }],
    },
  ),
  route(
    'windswept-span',
    2,
    'Windswept Span',
    '风掠长桥',
    'A very long gap and an anchor that rises and falls on its rail.',
    '缺口很长，锚点沿轨道升降。',
    {
      pads: [pad(0, 12, 252, 95), pad(1, 311, 244, 44, true)],
      anchors: [anchor(0, 233, 94, { amplitudeY: 24, frequency: 1.2, phase: 1.7 })],
      relics: [{ id: 'windswept-span-relic', x: 335, y: 130 }],
    },
  ),
  route(
    'twin-rails',
    0,
    'Twin Rails',
    '双轨',
    'Fast rails and narrow cairns: one anchor rises and falls, the other sways.',
    '轨道很快，石台很窄：一个锚点升降，另一个左右摆动。',
    {
      pads: [pad(0, 12, 250, 99), pad(1, 229, 240, 48), pad(2, 395, 228, 46, true)],
      anchors: [
        anchor(0, 170, 84, { amplitudeX: 38, frequency: 1.5, phase: 2.7 }),
        anchor(1, 336, 92, { amplitudeY: 22, frequency: 1.4, phase: 2.9 }),
      ],
      relics: [{ id: 'twin-rails-relic', x: 230, y: 190 }],
    },
  ),
  route(
    'summit-run',
    1,
    'Summit Run',
    '峰顶疾行',
    'Fast anchors, narrow cairns and a hanging rock. Use everything you have learned.',
    '快速移动的锚点、窄石台和悬挂的岩石。运用你学到的一切。',
    {
      pads: [pad(0, 12, 256, 96), pad(1, 208, 242, 50), pad(2, 362, 226, 48, true)],
      anchors: [
        anchor(0, 158, 81, { amplitudeX: 34, frequency: 1.25, phase: 4.5 }),
        anchor(1, 310, 90, { amplitudeY: 20, frequency: 1.4, phase: 5.4 }),
      ],
      rocks: [overhang(262, 22, 70)],
      relics: [{ id: 'summit-run-relic', x: 320, y: 169 }],
    },
  ),
]);
export const LEVEL_COUNT = LEVELS.length;

const FRAME = [
  { x: 0, y: 0, w: 480, h: 36, kind: 'ceiling' },
  { x: 0, y: 30, w: 12, h: 300, kind: 'wall' },
  { x: 468, y: 30, w: 12, h: 300, kind: 'wall' },
];
/** A mutable copy of one route, with rails, rocks and cairn bodies merged into `solids`. */
export function routePlan(level) {
  const plan = structuredClone(LEVELS[level - 1]);
  const rails = plan.anchors.map((a) => ({
    x: a.x - a.amplitudeX - 18,
    y: 47,
    w: 36 + 2 * a.amplitudeX,
    h: 8,
    kind: 'rail',
    anchor: a.id,
  }));
  plan.solids = [
    ...structuredClone(FRAME),
    ...rails,
    ...plan.rocks,
    ...plan.pads.map((p) => ({ ...p, h: 400 - p.y, kind: 'cairn' })),
  ];
  return plan;
}
