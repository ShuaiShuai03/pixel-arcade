// The twenty chambers: teaching 1-6, combination 7-14, mastery 15-20. Pure data, frozen.
const TOP = 64,
  BOTTOM = 264,
  CEILING_EDGE = 52,
  FLOOR_EDGE = 276,
  WALL_WIDTH = 24;
const FIELD_LEFT = 24,
  FIELD_RIGHT = 456;

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};
/** A wall hanging from the ceiling: the flyer passes underneath. */
const hang = (x, h) => ({ x, y: CEILING_EDGE, w: WALL_WIDTH, h });
/** A post rising from the floor: the flyer passes over the top. */
const post = (x, h) => ({ x, y: FLOOR_EDGE - h, w: WALL_WIDTH, h });
/** Two blocks leaving a window whose body room runs from `from` to `to`. */
const windowWall = (x, from, to) => [
  { x, y: CEILING_EDGE, w: WALL_WIDTH, h: from - CEILING_EDGE },
  { x, y: to, w: WALL_WIDTH, h: FLOOR_EDGE - to },
];
const pad = (x, side) => ({ x, y: side > 0 ? BOTTOM : TOP, side });
const uniform = (g) => [{ from: FIELD_LEFT, to: FIELD_RIGHT, g }];
const bands = (...cuts) =>
  cuts.map(([to, g], i) => ({ from: i ? cuts[i - 1][0] : FIELD_LEFT, to, g }));
const room = (name, tip, rest) => ({
  name,
  tip,
  walls: [],
  zones: uniform(180),
  integrity: 3,
  safeSpeed: 115,
  mass: 0.65,
  ...rest,
});

export const COURIER_ROOMS = deepFreeze([
  room(
    ['Polarity Post', '极性邮站'],
    ['Reverse the field near halfway to brake', '接近半程时反转动力场制动'],
    { source: pad(64, 1), destination: pad(416, -1) },
  ),
  room(
    ['Floor Dock', '地面装卸台'],
    ['Counter-thrust with A/D to stop on the pad', '用A/D反向推进，在装卸台上停稳'],
    { source: pad(64, 1), destination: pad(400, 1) },
  ),
  room(
    ['Ceiling Pickup', '顶部取件'],
    ['Point the field at the pad you want to land on', '让动力场朝向要降落的装卸台'],
    { source: pad(64, -1), destination: pad(416, 1) },
  ),
  room(
    ['First Post', '第一根立柱'],
    ['Fly over the post, then brake onto the pad', '飞越立柱，再制动降落到装卸台'],
    { walls: [post(228, 100)], source: pad(64, 1), destination: pad(410, 1) },
  ),
  room(
    ['Hanging Wall', '悬挂隔板'],
    ['Pass under the hanging wall, then climb', '从悬挂隔板下方通过，再向上爬升'],
    { walls: [hang(232, 120)], source: pad(64, 1), destination: pad(410, -1) },
  ),
  room(
    ['Two Gates', '双重闸门'],
    ['Go under the first gate and over the second', '从第一道闸门下方、第二道上方通过'],
    {
      walls: [hang(156, 144), post(290, 120)],
      source: pad(64, 1),
      destination: pad(416, 1),
    },
  ),
  room(
    ['Field Step', '场强阶梯'],
    ['The field is weaker right of the dashed line', '虚线右侧动力场较弱，制动更慢'],
    { zones: bands([240, 180], [FIELD_RIGHT, 110]), source: pad(64, 1), destination: pad(416, -1) },
  ),
  room(
    ['Strong Side', '强场一侧'],
    ['The field is stronger right of the dashed line', '虚线右侧动力场更强，需提前反转'],
    { zones: bands([250, 130], [FIELD_RIGHT, 240]), source: pad(64, -1), destination: pad(416, 1) },
  ),
  room(
    ['Heavy Parcel', '沉重包裹'],
    ['A heavy parcel turns slowly: brake sideways early', '沉重包裹转向迟缓，提前横向制动'],
    {
      walls: [post(240, 90)],
      zones: uniform(160),
      mass: 1.2,
      source: pad(64, 1),
      destination: pad(410, -1),
    },
  ),
  room(
    ['Glass Parcel', '玻璃包裹'],
    ['Glass breaks above speed 90: land gently', '玻璃包裹速度超过90会破损：轻柔降落'],
    {
      zones: uniform(150),
      integrity: 2,
      safeSpeed: 90,
      source: pad(64, 1),
      destination: pad(416, -1),
    },
  ),
  room(
    ['Middle Window', '中部窗口'],
    ['Cross the wall through its middle window', '从隔板中部的窗口穿过'],
    {
      walls: windowWall(240, 128, 228),
      source: pad(64, 1),
      destination: pad(410, 1),
    },
  ),
  room(
    ['Zigzag', '之字形通道'],
    ['Go over, under, then over: reverse in each gap', '依次越过、穿下、再越过：每个间隙都要换向'],
    {
      walls: [post(120, 100), hang(220, 100), post(320, 100)],
      source: pad(64, 1),
      destination: pad(416, 1),
    },
  ),
  room(
    ['Thin Field', '稀薄力场'],
    ['The field is weak: slow to start, slow to stop', '动力场很弱：起步慢，停得也慢'],
    {
      walls: [post(250, 120)],
      zones: uniform(90),
      source: pad(64, 1),
      destination: pad(416, -1),
    },
  ),
  room(
    ['Glass Coil Relay', '玻璃邮件中继'],
    ['Three field strengths and fragile glass', '三种场强，包裹易碎'],
    {
      walls: [
        { x: 164, y: 180, w: 24, h: 96 },
        { x: 300, y: 52, w: 24, h: 108 },
      ],
      zones: bands([180, 150], [310, 90], [FIELD_RIGHT, 240]),
      integrity: 2,
      safeSpeed: 90,
      mass: 0.8,
      source: pad(64, 1),
      destination: pad(416, -1),
    },
  ),
  room(
    ['Glass Gates', '玻璃闸门'],
    ['Alternate low and high lanes through four gates', '依次穿过四道闸门，高低通道交替'],
    {
      walls: [hang(120, 130), post(190, 130), hang(260, 130), post(330, 130)],
      zones: uniform(170),
      integrity: 2,
      safeSpeed: 100,
      source: pad(64, 1),
      destination: pad(420, -1),
    },
  ),
  room(
    ['Strong Windows', '强场窗口'],
    ['Field 180 is strong: hold your height in three windows', '场强180很强：保持高度穿过三个窗口'],
    {
      walls: [
        ...windowWall(140, 86, 164),
        ...windowWall(250, 166, 244),
        ...windowWall(360, 96, 174),
      ],
      zones: uniform(180),
      safeSpeed: 100,
      source: pad(64, -1),
      destination: pad(420, 1),
    },
  ),
  room(
    ['One Hit Only', '只能撞一次'],
    ['One hit breaks it: brake before every wall', '一次撞击即破损：每道隔板前都要制动'],
    {
      walls: [hang(120, 120), post(190, 120), ...windowWall(270, 136, 214), hang(350, 120)],
      zones: uniform(170),
      integrity: 1,
      safeSpeed: 100,
      source: pad(64, 1),
      destination: pad(420, 1),
    },
  ),
  room(
    ['Heavy Coil', '重载线圈'],
    ['Heavy glass crosses strong and weak fields', '沉重的玻璃包裹穿越强弱不同的场区'],
    {
      walls: [post(130, 110), hang(220, 120), ...windowWall(345, 136, 214)],
      zones: bands([190, 160], [320, 100], [FIELD_RIGHT, 180]),
      integrity: 2,
      safeSpeed: 105,
      mass: 1,
      source: pad(64, -1),
      destination: pad(420, 1),
    },
  ),
  room(
    ['Window Steps', '窗口阶梯'],
    ['Four windows step up and down: change height', '四个窗口高低错落：每个间隙都要调整高度'],
    {
      walls: [
        ...windowWall(110, 76, 144),
        ...windowWall(190, 126, 194),
        ...windowWall(270, 176, 244),
        ...windowWall(350, 116, 184),
      ],
      zones: uniform(160),
      integrity: 2,
      safeSpeed: 100,
      source: pad(64, 1),
      destination: pad(420, -1),
    },
  ),
  room(
    ['Master Courier', '信使大师'],
    ['Everything at once: walls, windows, fields, glass', '综合挑战：隔板、窗口、场区与易碎玻璃'],
    {
      walls: [hang(110, 120), post(184, 120), ...windowWall(258, 132, 212), hang(332, 120)],
      zones: bands([160, 140], [300, 180], [FIELD_RIGHT, 110]),
      integrity: 2,
      safeSpeed: 100,
      mass: 0.8,
      source: pad(64, -1),
      destination: pad(430, -1),
    },
  ),
]);
export const LEVEL_COUNT = COURIER_ROOMS.length;
export const clampLevel = (n) => {
  const level = Math.floor(Number(n));
  return Number.isFinite(level) ? Math.min(LEVEL_COUNT, Math.max(1, level)) : 1;
};
