export const SECTIONS = [
  {
    en: 'Moonlit Atrium',
    zh: '月光前庭',
    hint: {
      en: 'Run to an edge, then jump across. Rest at the braziers.',
      zh: '靠近边缘起跳，跨向下一石台；可在火盆处休息。',
    },
    sky: '#171d37',
    stone: '#777f9b',
  },
  {
    en: 'Cable Gallery',
    zh: '缆索长廊',
    hint: {
      en: 'Gaps widen and decks sway. Mind your Grip and lamp.',
      zh: '间隙变宽、石台摆动；留意体力与灯油。',
    },
    sky: '#1d2541',
    stone: '#7f8aa8',
  },
  {
    en: 'Broken Spire',
    zh: '断裂尖塔',
    hint: {
      en: 'Braziers are far apart. Pace your lamp and Grip.',
      zh: '火盆相隔很远；合理分配灯油与体力。',
    },
    sky: '#2a2541',
    stone: '#9a89a1',
  },
];
export const HINTS = {
  rail: { en: 'Grip the rail, then climb', zh: '抓住扶轨，再向上攀爬' },
  rest: { en: 'Rest to full Grip before this rail', zh: '上轨前先休息，把体力补满' },
  deck: { en: 'Time your jump to the swaying deck', zh: '看准摆动石台的节奏再起跳' },
  lamp: { en: 'Lamp low: relight at a brazier (X)', zh: '灯油不足：到火盆旁按X补油' },
};
export const BEACONS = [6, 12, 18];
export const SHRINES = [0, 3, 6, 9, 13, 18];
// Lower ledge of each step that is too high to jump and must be climbed on a rail.
export const RAIL_STEPS = [5, 9, 13, 17];
export const LIGHT_DRAIN = [1.3, 2, 2.5];
export const LEDGE_COUNT = 19;
const RAIL_X = 194,
  FLOOR_Y = 282,
  RAIL_REACH_BELOW = 28,
  RAIL_REACH_ABOVE = 62,
  JITTER = 4;
// Rise from ledge i to ledge i + 1.
const RISE = [48, 48, 48, 48, 50, 100, 50, 50, 52, 140, 52, 52, 54, 175, 54, 54, 54, 215];
const WIDTH = [
  120, 120, 116, 114, 112, 110, 110, 100, 94, 100, 96, 84, 100, 100, 86, 76, 70, 92, 96,
];
// Even ledges list their right edge, odd ledges their left edge.
const EDGE = [
  186, 216, 184, 218, 184, 220, 190, 226, 190, 220, 190, 232, 190, 220, 190, 226, 182, 220, 190,
];
// Swaying decks: amplitude in px, spring constant, and a group that shares a phase.
const SWAY = {
  4: { amp: 18, k: 1.1, group: 0 },
  7: { amp: 22, k: 1.2, group: 1 },
  8: { amp: 28, k: 1.2, group: 1 },
  11: { amp: 24, k: 1.8, group: 2 },
  15: { amp: 22, k: 2.3, group: 3 },
  16: { amp: 22, k: 2.3, group: 3 },
};
const fixedEdge = (id) => RAIL_STEPS.includes(id) || RAIL_STEPS.includes(id - 1);
export function createLayout(random = null) {
  const draw = () => (random ? random() : 0.5),
    signs = [];
  let y = FLOOR_Y;
  const ledges = Array.from({ length: LEDGE_COUNT }, (_, id) => {
    const wobble = Math.round((draw() - 0.5) * 2 * JITTER),
      grow = Math.round((draw() - 0.5) * 2 * JITTER),
      free = !fixedEdge(id) && id > 2,
      w = WIDTH[id] + (free ? grow : 0),
      edge = EDGE[id] + (free ? wobble : 0),
      x = id % 2 ? edge : edge - w,
      sway = SWAY[id],
      here = y;
    if (sway && signs[sway.group] === undefined) signs[sway.group] = draw() < 0.5 ? -1 : 1;
    const amp = sway ? sway.amp * (0.9 + 0.2 * draw()) : 0;
    y -= RISE[id] ?? 0;
    return {
      id,
      x,
      y: here,
      w,
      h: 8,
      home: x,
      vx: sway ? signs[sway.group] * amp * Math.sqrt(sway.k) : 0,
      ax: 0,
      moving: Boolean(sway),
      k: sway?.k ?? 0,
      shrine: SHRINES.includes(id),
      beacon: BEACONS.includes(id),
      lit: id === 0,
    };
  });
  const rails = RAIL_STEPS.map((low, id) => {
    const top = ledges[low + 1].y - RAIL_REACH_ABOVE;
    return { id, x: RAIL_X, y: top, h: ledges[low].y + RAIL_REACH_BELOW - top };
  });
  return { ledges, rails };
}
export function stepHint(s) {
  const here = s.ledges[s.at],
    next = s.ledges[Math.min(s.at + 1, LEDGE_COUNT - 1)];
  if (s.light < 25) return HINTS.lamp;
  if (RAIL_STEPS.includes(s.at) || s.player.grip !== null)
    return s.stamina < 85 && s.player.grip === null ? HINTS.rest : HINTS.rail;
  if (here.moving || next.moving) return HINTS.deck;
  return SECTIONS[s.level - 1].hint;
}
