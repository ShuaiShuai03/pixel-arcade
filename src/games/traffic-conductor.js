import { background, drawPixelText as text, clamp } from '../shared/utils.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'traffic-conductor',
  name: { en: 'Traffic Conductor', zh: '路口指挥官' },
  genre: 'arcade',
  players: '1',
  touch: true,
  description: {
    en: 'Run the signals of 20 busy junctions. Cars, buses and trucks arrive from every road and show their turn indicators; you decide who gets the green. Arrow keys select a junction, Space moves its signal to the next phase (green, then yellow and a short all-red, so conflicting greens can never happen) and X calls a pedestrian phase that stops all traffic while people cross the zebra. A vehicle enters the junction only on green and only when its conflict zones are clear. Deliver the quota before the clock runs out. Every vehicle, bus, ambulance and pedestrian has a wait limit: break it, let a queue spill off the map or let the junction gridlock and you take a strike, and the third strike ends the shift. Each strike is explained on screen, and the line at the bottom always names the next move. Later levels add protected turns, school crossings, bus priority, ambulances and two linked junctions where a green wave pays off. You can also tap a junction: once to select it, again to advance its signal, or tap a zebra to call pedestrians.',
    zh: '指挥 20 个繁忙路口的信号灯。小汽车、公交车和卡车从各条道路驶来，并打出转向灯，由你决定谁先放行。方向键选择路口，空格键让信号进入下一相位（先绿灯，再黄灯和短暂全红，不会出现冲突绿灯），X 键呼叫行人相位，让所有车辆停下、行人通过斑马线。车辆只有在绿灯且冲突区空闲时才会驶入路口。在时间用完之前放行足够数量的车辆。每辆车、公交车、救护车和行人都有等待上限：超过上限、排队溢出地图或路口堵死都会记一次失误，第三次失误则本班失败。每次失误都会在屏幕上说明原因，底部一行始终提示下一步操作。后面的关卡会加入保护性转弯、学生过街、公交优先、救护车，以及两个联动路口的绿波。也可以直接点按路口：点一次选中，再点一次切换信号，点斑马线则呼叫行人。',
  },
  keys: [
    { label: { en: 'Select a junction', zh: '选择路口' }, keys: 'Arrows / WASD' },
    { label: { en: 'Next signal phase', zh: '信号进入下一相位' }, keys: 'Space' },
    { label: { en: 'Call pedestrians', zh: '呼叫行人' }, keys: 'X' },
    { label: { en: 'Pause', zh: '暂停' }, keys: 'P' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Signal', '信号', 'right'],
    ['KeyX', 'Walk', '行人', 'right'],
  ]),
};

// Rules are exposed read-only so tests, prompts and the HUD agree on the numbers.
export const RULES = Object.freeze({
  step: 1 / 120,
  maxDt: 1 / 30,
  width: 480,
  top: 28,
  bottom: 292,
  stop: 30,
  boxHalf: 22,
  laneOff: 11,
  outLen: 56,
  armMax: 175,
  yellow: 3,
  allRed: 1.2,
  minGreen: 4,
  pedWalk: 4.5,
  pedFlash: 1.5,
  pedLate: 1.5,
  pedCross: 4.5,
  claimRange: 36,
  strikeGap: 3,
  gap: 4,
  react: 0.25,
  brake: 90,
  comfort: 60,
  patience: 3,
  lives: 3,
  spillGrace: 2,
  strikeCool: 4,
  gridlock: 20,
  promptHold: 0.5,
  introTime: 4.5,
  msgTime: 2.5,
  clearTime: 2.5,
  horizon: 6,
  lookahead: 130,
  maxGreen: 22,
  menuCols: 5,
  scoreVehicle: 10,
  scoreClear: 200,
  scoreStrike: 100,
  thinkTicks: 12,
  margin: 0.9,
  spillWarn: 52,
  ambPrio: 100,
  alertEta: 16,
  preempt: 12,
  pedLead: 14,
  pedGap: 14,
});
const STEP = RULES.step;
const seeded = (seed) => () => {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const OUT = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIR_EN = ['north', 'east', 'south', 'west'];
const DIR_ZH = ['北', '东', '南', '西'];
const ARROW = ['↑', '→', '↓', '←'];
export const PRESS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const EXIT_TURN = { S: 2, L: 1, R: 3 };

export const TYPES = Object.freeze({
  car: { len: 12, wid: 7, vmax: 58, acc: 52, weight: 1 },
  bus: { len: 24, wid: 8, vmax: 46, acc: 30, weight: 2 },
  truck: { len: 28, wid: 8, vmax: 42, acc: 22, weight: 1.5 },
  amb: { len: 16, wid: 8, vmax: 84, acc: 80, weight: 10 },
});
const TURN_CAP = { S: 99, L: 30, R: 24 };

// --- Geometry (pure) ---

const rightOf = (h) => [-h[1], h[0]];
const exitDir = (d, m) => (d + EXIT_TURN[m]) % 4;
const quadrant = (x, y) => (y < 0 ? (x < 0 ? 0 : 1) : x >= 0 ? 2 : 3);

const pathCache = new Map();
// The path of a movement relative to the junction centre, with the conflict zones (quadrants of
// the box) it crosses and the arc length at which it enters and leaves each of them.
export function pathOf(d, m) {
  const key = d * 4 + 'SLR'.indexOf(m);
  if (pathCache.has(key)) return pathCache.get(key);
  const h = [-OUT[d][0], -OUT[d][1]];
  const e = exitDir(d, m);
  const he = OUT[e];
  const r0 = rightOf(h);
  const r1 = rightOf(he);
  const E = [
    OUT[d][0] * RULES.stop + r0[0] * RULES.laneOff,
    OUT[d][1] * RULES.stop + r0[1] * RULES.laneOff,
  ];
  const X = [
    he[0] * RULES.stop + r1[0] * RULES.laneOff,
    he[1] * RULES.stop + r1[1] * RULES.laneOff,
  ];
  let pts = [E, X];
  if (m !== 'S') {
    const c = h[0] === 0 ? [E[0], X[1]] : [X[0], E[1]];
    pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      pts.push([
        (1 - u) * (1 - u) * E[0] + 2 * u * (1 - u) * c[0] + u * u * X[0],
        (1 - u) * (1 - u) * E[1] + 2 * u * (1 - u) * c[1] + u * u * X[1],
      ]);
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1];
  const path = { d, m, e, pts, cum, len, h, he, zones: [], zone: [null, null, null, null] };
  for (let p = 0; p <= len; p += 0.5) {
    const q = pointOnPath(path, p);
    if (Math.abs(q.x) > RULES.boxHalf || Math.abs(q.y) > RULES.boxHalf) continue;
    const z = quadrant(q.x, q.y);
    if (!path.zone[z]) {
      path.zone[z] = { z, a: p, b: p };
      path.zones.push(path.zone[z]);
    } else path.zone[z].b = p;
  }
  path.zones[path.zones.length - 1].b = len;
  pathCache.set(key, path);
  return path;
}

// Point and heading at arc length p, extended straight before the start and after the end.
export function pointOnPath(path, p) {
  const { pts, cum } = path;
  if (p <= 0) {
    const a = pts[0];
    return { x: a[0] + path.h[0] * p, y: a[1] + path.h[1] * p, hx: path.h[0], hy: path.h[1] };
  }
  if (p >= path.len) {
    const a = pts[pts.length - 1];
    const q = p - path.len;
    return { x: a[0] + path.he[0] * q, y: a[1] + path.he[1] * q, hx: path.he[0], hy: path.he[1] };
  }
  let i = 1;
  while (cum[i] < p) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const f = (p - cum[i - 1]) / (cum[i] - cum[i - 1]);
  const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return {
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    hx: (b[0] - a[0]) / seg,
    hy: (b[1] - a[1]) / seg,
  };
}
export const zonesConflict = (a, b) => a.zones.some((za) => b.zone[za.z]);

// --- Signal plans ---

const PLANS = {
  two: [
    { label: ['north-south', '南北向'], allow: ['SLR', '', 'SLR', ''] },
    { label: ['east-west', '东西向'], allow: ['', 'SLR', '', 'SLR'] },
  ],
  split: [
    { label: ['north approach', '北向进口'], allow: ['SLR', '', '', ''] },
    { label: ['east approach', '东向进口'], allow: ['', 'SLR', '', ''] },
    { label: ['south approach', '南向进口'], allow: ['', '', 'SLR', ''] },
    { label: ['west approach', '西向进口'], allow: ['', '', '', 'SLR'] },
  ],
};

// --- Level compilation (pure, exported for tests) ---

const LAYOUTS = {
  single: { spots: [[240, 160]], names: [['', '']], links: [] },
  row2: {
    spots: [
      [150, 160],
      [330, 160],
    ],
    names: [
      ['west', '西侧'],
      ['east', '东侧'],
    ],
    links: [[0, 1]],
  },
};

function edgeLength(cx, cy, d) {
  const room = [
    cy - RULES.stop - RULES.top,
    RULES.width - (cx + RULES.stop),
    RULES.bottom - (cy + RULES.stop),
    cx - RULES.stop,
  ][d];
  return Math.min(room, RULES.armMax);
}

// Start of a lane that leaves junction J towards direction e, `back` pixels beyond its stop point.
function laneStart(J, e, back, inbound = false) {
  const r = rightOf(OUT[e]).map((n) => (inbound ? -n : n));
  return [
    J.x + OUT[e][0] * (RULES.stop + back) + r[0] * RULES.laneOff,
    J.y + OUT[e][1] * (RULES.stop + back) + r[1] * RULES.laneOff,
  ];
}

export function compileLevel(def, index = 0) {
  const layout = LAYOUTS[def.layout];
  const lanes = [];
  const add = (lane) => lanes.push({ ...lane, id: lanes.length }) - 1;
  const junctions = layout.spots.map(([x, y], j) => ({
    x,
    y,
    j,
    arms: [...'NESW'].map((c) => (def.arms?.[j] ?? 'NESW').includes(c)),
    plan: PLANS[Array.isArray(def.plan) ? def.plan[j] : def.plan],
    name: layout.names[j],
    inLane: [-1, -1, -1, -1],
    outLane: [-1, -1, -1, -1],
  }));
  // A link is a pair of lanes between the east side of one junction and the west side of the next.
  for (const [a, b] of layout.links) {
    const A = junctions[a];
    const B = junctions[b];
    const span = B.x - A.x - 2 * RULES.stop;
    const eastward = laneStart(A, 1, 0);
    const westward = laneStart(B, 3, 0);
    const fwd = add({
      kind: 'in',
      jn: b,
      dir: 3,
      len: span,
      sx: eastward[0],
      sy: eastward[1],
      hx: 1,
      hy: 0,
      src: a,
    });
    const back = add({
      kind: 'in',
      jn: a,
      dir: 1,
      len: span,
      sx: westward[0],
      sy: westward[1],
      hx: -1,
      hy: 0,
      src: b,
    });
    A.outLane[1] = fwd;
    B.inLane[3] = fwd;
    B.outLane[3] = back;
    A.inLane[1] = back;
  }
  for (const J of junctions) {
    for (let d = 0; d < 4; d++) {
      if (!J.arms[d] || J.inLane[d] >= 0) continue;
      const len = Math.min(edgeLength(J.x, J.y, d), def.cap?.[`${J.j}${'NESW'[d]}`] ?? Infinity);
      const s = laneStart(J, d, len, true);
      J.inLane[d] = add({
        kind: 'in',
        jn: J.j,
        dir: d,
        len,
        sx: s[0],
        sy: s[1],
        hx: -OUT[d][0],
        hy: -OUT[d][1],
        src: -1,
      });
      const o = laneStart(J, d, 0);
      J.outLane[d] = add({
        kind: 'out',
        jn: -1,
        dir: d,
        len: RULES.outLen,
        sx: o[0],
        sy: o[1],
        hx: OUT[d][0],
        hy: OUT[d][1],
        src: J.j,
      });
    }
  }
  return {
    index,
    def,
    name: def.name,
    tip: def.tip,
    time: def.time,
    junctions,
    lanes,
    maxWait: def.maxWait,
    busWait: def.busWait ?? def.maxWait,
    pedMax: def.pedMax ?? 30,
    emgWait: def.emgWait ?? 4,
    frac: def.frac,
    seed: def.seed ?? index + 1,
  };
}

const pick = (random, weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
};

function movesFor(L, random, lane) {
  const moves = [];
  let cur = lane;
  for (let hop = 0; hop < 2; hop++) {
    const J = L.junctions[cur.jn];
    const turns = L.def.turns?.[J.j] ?? L.def.turns?.[0] ?? [0.7, 0.15, 0.15];
    const w = ['S', 'L', 'R'].map((m, i) => (J.outLane[exitDir(cur.dir, m)] >= 0 ? turns[i] : 0));
    const m = ['S', 'L', 'R'][w.every((x) => x === 0) ? 0 : pick(random, w)];
    moves.push(m);
    const next = L.lanes[J.outLane[exitDir(cur.dir, m)]];
    if (!next || next.kind !== 'in') break;
    cur = next;
  }
  return moves;
}

const KIND_ORDER = ['car', 'bus', 'truck'];
// An ambulance goes straight on when it can, else it takes the first turn the junction offers.
const ambMoves = (L, lane) => [
  ['S', 'R', 'L'].find((m) => L.junctions[lane.jn].outLane[exitDir(lane.dir, m)] >= 0) ?? 'S',
];

// The seeded arrivals of one run: vehicles per edge lane, ambulances and pedestrians.
export function buildSchedule(L, random) {
  const def = L.def;
  const cars = [];
  const tail = def.tail ?? 12;
  const edgeKeys = [];
  L.junctions.forEach((J) => {
    for (let d = 0; d < 4; d++)
      if (J.arms[d] && L.lanes[J.inLane[d]].src < 0) edgeKeys.push([`${J.j}${'NESW'[d]}`, d]);
  });
  // Pulses are demand surges whose start time and road axis are drawn per run, so no fixed
  // signal plan can be right for all of them.
  const surges = [...(def.surge ?? [])];
  for (const pu of def.pulses ?? []) {
    const from = pu.at[0] + random() * (pu.at[1] - pu.at[0]);
    const axis = pu.axes === 'any' ? (random() < 0.5 ? 'EW' : 'NS') : pu.axes;
    const lanes =
      axis === 'lane'
        ? [edgeKeys[Math.floor(random() * edgeKeys.length)][0]]
        : edgeKeys.filter(([, d]) => (axis === 'NS' ? d % 2 === 0 : d % 2 === 1)).map(([k]) => k);
    surges.push({ from, to: from + pu.len, mult: pu.mult, lanes });
  }
  L.junctions.forEach((J) => {
    for (let d = 0; d < 4; d++) {
      const lane = L.lanes[J.inLane[d]];
      const base = def.rates?.[J.j]?.[d] ?? 0;
      if (!lane || lane.src >= 0 || base <= 0) continue;
      let t = 0.5 + random() * 2.5;
      const key = `${J.j}${'NESW'[d]}`;
      while (t < L.time - tail) {
        const surge = surges.reduce(
          (m, s) =>
            t >= s.from && t < s.to && (!s.lanes || s.lanes.includes(key)) ? m * s.mult : m,
          1,
        );
        const head = 60 / (base * surge);
        const group = def.platoon ? 2 + Math.floor(random() * def.platoon) : 1;
        for (let g = 0; g < group && t < L.time - tail; g++) {
          const k = KIND_ORDER[pick(random, def.mix ?? [1, 0, 0])];
          cars.push({
            t: Math.round(t * 100) / 100,
            lane: lane.id,
            k,
            moves: movesFor(L, random, lane),
          });
          t += def.platoon ? 0.95 + random() * 0.4 : Math.max(1.1, head * (0.5 + random()));
        }
        if (def.platoon) t += Math.max(0, head * group * (0.6 + random() * 0.8) - group * 1.1);
      }
    }
  });
  for (const [t, jn, arm] of def.emerg ?? []) {
    // An arm of -1 means the ambulance comes from any road of that junction.
    const open = edgeKeys.filter(([k]) => k[0] === String(jn)).map(([, d]) => d);
    const d = arm >= 0 ? arm : open[Math.floor(random() * open.length)];
    const lane = L.lanes[L.junctions[jn].inLane[d]];
    cars.push({
      t: Math.round((t + (random() - 0.5) * 2 * (def.ambJitter ?? 2)) * 100) / 100,
      lane: lane.id,
      k: 'amb',
      moves: [...ambMoves(L, lane), 'S'],
    });
  }
  cars.sort((a, b) => a.t - b.t || a.lane - b.lane);
  cars.forEach((c, i) => (c.id = i));
  const peds = [];
  for (const p of def.peds ?? []) {
    const J = L.junctions[p.jn];
    const spots = [0, 1, 2, 3].filter((d) => J.arms[d]);
    const one = (t) =>
      peds.push({
        t: Math.round(t * 100) / 100,
        jn: p.jn,
        d: spots[Math.floor(random() * spots.length)],
      });
    if (p.rate > 0)
      for (let t = 2 + random() * 6; t < L.time - tail; t += (60 / p.rate) * (0.5 + random()))
        one(t);
    for (const [at, n] of p.bursts ?? []) {
      const start = at + (random() - 0.5) * 2 * (def.pedJitter ?? 0);
      for (let i = 0; i < n; i++) one(start + random() * 3);
    }
  }
  peds.sort((a, b) => a.t - b.t);
  peds.forEach((p, i) => (p.id = i));
  return { cars, peds, quota: Math.max(1, Math.ceil(cars.length * def.frac)) };
}

// --- World simulation (shared by the game and by the controller's look-ahead) ---

const stoppedSpeed = 4;

export function newWorld(L, sched) {
  const lanes = L.lanes.map((d) => ({ ...d, vs: [], boxQ: [] }));
  return {
    L,
    t: 0,
    lanes,
    juncs: L.junctions.map((J) => ({
      J,
      j: J.j,
      box: [],
      sig: { ph: 0, stage: 'green', t: RULES.minGreen, next: 0, after: 0, lastPed: -99 },
    })),
    pending: sched.cars.map((c) => ({ ...c, late: 0 })),
    pi: 0,
    due: [],
    pedQ: sched.peds,
    qi: 0,
    peds: [],
    vehicles: [],
    quota: sched.quota,
    total: sched.cars.length,
    delivered: 0,
    delaySum: 0,
    longest: 0,
    lost: 0,
    pedsServed: 0,
    longestPed: 0,
    maxRel: 0,
    lastStrike: -99,
    nextId: 0,
  };
}

export const laneOf = (w, jn, d) => w.lanes[w.L.junctions[jn].inLane[d]];
export function lightOf(JW, d, m) {
  const sg = JW.sig;
  if (sg.stage !== 'green' && sg.stage !== 'yellow') return 'R';
  if (!JW.J.plan[sg.ph].allow[d].includes(m)) return 'R';
  return sg.stage === 'green' ? 'G' : 'Y';
}
const exitLaneOf = (w, JW, path) => w.lanes[JW.J.outLane[path.e]];
const rearOf = (lane) => lane.vs[lane.vs.length - 1];
const safeSpeed = (x, vl) => {
  const bt = RULES.brake * RULES.react;
  return -bt + Math.sqrt(bt * bt + vl * vl + 2 * RULES.brake * Math.max(0, x));
};

function trySpawn(w, c) {
  const lane = w.lanes[c.lane];
  const rear = rearOf(lane);
  if (rear && rear.pos - rear.len < 3) return false;
  const T = TYPES[c.k];
  const v = {
    id: c.id,
    k: c.k,
    ...T,
    lane,
    where: 'lane',
    pos: 0,
    p: 0,
    v: T.vmax * 0.8,
    moves: c.moves,
    mi: 0,
    wait: 0,
    born: w.t,
    struck: false,
    commit: false,
    gapWait: 0,
    inLane: null,
    path: null,
  };
  lane.vs.push(v);
  w.vehicles.push(v);
  return true;
}

// Which phase Space moves to: the next one in the cycle that has someone waiting for it.
export function demandOf(w, JW, phase) {
  const P = JW.J.plan[phase];
  for (let d = 0; d < 4; d++) {
    const lane = laneOf(w, JW.j, d);
    if (!lane) continue;
    for (const v of lane.vs)
      if (P.allow[d].includes(v.moves[v.mi]) && lane.len - v.pos < RULES.lookahead) return true;
  }
  return false;
}
export function nextPhase(w, JW) {
  const n = JW.J.plan.length;
  // Emergency preemption: with an ambulance close, the signal jumps straight to its road.
  const urgent = ambulances(w, JW).find(
    (a) => a.eta < RULES.preempt && !serves(JW.J.plan[JW.sig.ph], a.d, a.m),
  );
  if (urgent) return JW.J.plan.findIndex((P) => serves(P, urgent.d, urgent.m));
  for (let k = 1; k < n; k++) {
    const p = (JW.sig.ph + k) % n;
    if (demandOf(w, JW, p)) return p;
  }
  return (JW.sig.ph + 1) % n;
}
export const pedsWaiting = (w, j) => w.peds.filter((p) => p.jn === j && p.st === 'wait');
const boxEmpty = (JW) => JW.box.length === 0;

function updateSignal(w, JW, dt) {
  const sg = JW.sig;
  sg.t += dt;
  if (sg.stage === 'yellow' && sg.t >= RULES.yellow) {
    sg.stage = 'red';
    sg.t = 0;
  } else if (sg.stage === 'red' && sg.t >= RULES.allRed) {
    if (sg.next === 'ped') {
      if (!boxEmpty(JW)) return;
      sg.stage = 'ped';
      sg.t = 0;
      sg.lastPed = w.t;
      for (const p of w.peds) if (p.jn === JW.j && p.st === 'wait') beginCross(w, p);
    } else {
      sg.stage = 'green';
      sg.ph = sg.next;
      sg.t = 0;
    }
  } else if (sg.stage === 'ped' && sg.t >= RULES.pedWalk + RULES.pedFlash) {
    // The interrupted green resumes where it left off, so X is never a free phase change.
    sg.stage = 'green';
    sg.ph = sg.after;
    sg.t = RULES.minGreen;
  }
}

function beginCross(w, p) {
  p.st = 'cross';
  p.tc = 0;
  w.longestPed = Math.max(w.longestPed, w.t - p.t0);
}

// Start moving the signal on towards `target` (a phase index or 'ped'); false when not allowed now.
export function advanceSignal(w, JW) {
  const sg = JW.sig;
  if (sg.stage !== 'green' || sg.t < RULES.minGreen) return false;
  sg.next = nextPhase(w, JW);
  sg.stage = 'yellow';
  sg.t = 0;
  return true;
}
export function callPedestrians(w, JW) {
  const sg = JW.sig;
  if (sg.stage !== 'green' || sg.t < RULES.minGreen || !pedsWaiting(w, JW.j).length) return false;
  sg.next = 'ped';
  sg.after = sg.ph;
  sg.stage = 'yellow';
  sg.t = 0;
  return true;
}

// Whether the head of an approach may cross its stop line now.
function mayEnter(w, JW, lane, v) {
  const light = lightOf(JW, lane.dir, v.moves[v.mi]);
  if (light !== 'G' && !v.commit) return { go: false, blocked: false };
  const path = v.path;
  for (const o of JW.box) {
    if (o.inLane === lane) continue;
    for (const z of path.zones) {
      const oz = o.path.zone[z.z];
      if (oz && o.p - o.len < oz.b + 1.5) return { go: false, blocked: true };
    }
  }
  if (!v.commit) {
    for (let d = 0; d < 4; d++) {
      const other = laneOf(w, JW.j, d);
      const h = other && other !== lane ? other.vs[0] : null;
      if (!h || (h.gapWait < RULES.patience && !h.prio)) continue;
      if (h.gapWait + (h.prio ?? 0) <= v.gapWait + (v.prio ?? 0)) continue;
      if (zonesConflict(h.path, path)) return { go: false, blocked: true };
    }
  }
  const rear = rearOf(exitLaneOf(w, JW, path));
  if (rear && rear.pos - rear.len < v.len + RULES.gap) return { go: false, blocked: false };
  return { go: true, blocked: false };
}

const hasAmbulanceNear = (lane) => {
  const n = Math.min(4, lane.vs.length);
  for (let i = 0; i < n; i++) if (lane.vs[i].k === 'amb') return true;
  return false;
};
const byClaim = (a, b) =>
  b.v.prio - a.v.prio || b.v.gapWait - a.v.gapWait || a.dist - b.dist || a.lane.dir - b.lane.dir;

function prepareHeads(w, dt) {
  for (const JW of w.juncs) {
    const heads = [];
    for (let d = 0; d < 4; d++) {
      const lane = laneOf(w, JW.j, d);
      if (!lane) continue;
      const vs = lane.vs;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (v.pathMi !== v.mi || !v.path) {
          v.path = pathOf(lane.dir, v.moves[v.mi]);
          v.pathMi = v.mi;
        }
        const dist = lane.len - v.pos;
        const light = lightOf(JW, lane.dir, v.moves[v.mi]);
        // A vehicle that cannot stop is committed through the yellow only; it never enters on red.
        if (light === 'G') v.commit = dist <= (v.v * v.v) / (2 * RULES.comfort) + 1 && v.v > 8;
        else if (light === 'R') v.commit = false;
        v.go = false;
        if (i === 0) {
          // The head of a queue with an ambulance close behind it goes before conflicting heads.
          v.prio = hasAmbulanceNear(lane) ? RULES.ambPrio : 0;
          heads.push({ v, lane, dist, light, r: mayEnter(w, JW, lane, v) });
        }
      }
    }
    // Heads that could cross the line together are admitted one conflict-free set at a time: the
    // longest-waiting first, then the nearest, then the lower road, so the outcome never depends
    // on iteration order and two conflicting vehicles can never enter on the same tick.
    if (heads.length > 1) heads.sort(byClaim);
    const claimed = [];
    for (const { v, dist, light, r } of heads) {
      let go = r.go;
      let blocked = r.blocked;
      if (go && dist < RULES.claimRange) {
        let clash = false;
        for (let c = 0; c < claimed.length && !clash; c++)
          clash = zonesConflict(claimed[c].path, v.path);
        if (clash) {
          go = false;
          blocked = true;
        } else claimed.push(v);
      }
      v.go = go;
      if (blocked && v.v < 6 && dist < 6) v.gapWait += dt;
      else if (!blocked) v.gapWait = 0;
      v.stuck = light === 'G' && !go && v.v < 4 ? v.stuck + dt : 0;
    }
  }
}

// `g1`/`g2` are the gaps to the (up to two) vehicles or obstacles ahead and `l1`/`l2` their speeds;
// Infinity means there is none.
function drive(v, dt, g1, l1, g2, l2, lineDist) {
  let vn = Math.min(v.v + v.acc * dt, v.vmax);
  const cap = TURN_CAP[v.moves[v.mi]];
  if (cap < v.vmax && (v.where === 'box' || lineDist < 24))
    vn = Math.min(vn, Math.max(cap, v.v - 100 * dt));
  let room = Infinity;
  if (g1 !== Infinity) {
    vn = Math.min(vn, safeSpeed(g1 - RULES.gap, l1));
    room = Math.max(0, g1 - 1);
  }
  if (g2 !== Infinity) {
    vn = Math.min(vn, safeSpeed(g2 - RULES.gap, l2));
    room = Math.min(room, Math.max(0, g2 - 1));
  }
  if (lineDist !== Infinity && !v.go) {
    vn = Math.min(vn, safeSpeed(lineDist - 0.5, 0));
    room = Math.min(room, lineDist);
  }
  vn = Math.max(0, vn);
  const move = Math.min(vn * dt, room);
  v.nv = move / dt;
  v.np = move;
}

function computeMotion(w, dt) {
  for (const lane of w.lanes) {
    const vs = lane.vs;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      let g1 = Infinity;
      let l1 = 0;
      let g2 = Infinity;
      let l2 = 0;
      let lineDist = Infinity;
      if (i > 0) {
        const a = vs[i - 1];
        g1 = a.pos - a.len - v.pos;
        l1 = a.v;
      } else if (lane.kind === 'in') {
        const q = lane.boxQ[lane.boxQ.length - 1];
        if (q) {
          g1 = q.p - q.len - (v.pos - lane.len);
          l1 = q.v;
        }
      }
      if (i === 0 && lane.kind === 'in') {
        lineDist = lane.len - v.pos;
        const rear = rearOf(exitLaneOf(w, w.juncs[lane.jn], v.path));
        if (rear) {
          g2 = rear.pos - rear.len + v.path.len - (v.pos - lane.len);
          l2 = rear.v;
        }
      }
      drive(v, dt, g1, l1, g2, l2, lineDist);
    }
  }
  for (const JW of w.juncs) {
    for (const v of JW.box) {
      let g1 = Infinity;
      let l1 = 0;
      let g2 = Infinity;
      let l2 = 0;
      const q = v.inLane.boxQ;
      const k = q.indexOf(v);
      if (k > 0) {
        const a = q[k - 1];
        g1 = a.p - a.len - v.p;
        l1 = a.v;
      }
      const rear = rearOf(exitLaneOf(w, JW, v.path));
      if (rear) {
        g2 = rear.pos - rear.len + v.path.len - v.p;
        l2 = rear.v;
      }
      drive(v, dt, g1, l1, g2, l2, Infinity);
    }
  }
}

function applyMotion(w, log) {
  for (const lane of w.lanes) {
    for (const v of lane.vs) {
      v.pos += v.np;
      v.v = v.nv;
    }
  }
  for (const JW of w.juncs) {
    for (const v of JW.box) {
      v.p += v.np;
      v.v = v.nv;
    }
  }
  for (const JW of w.juncs) {
    for (let d = 0; d < 4; d++) {
      const lane = laneOf(w, JW.j, d);
      const v = lane?.vs[0];
      if (!v || v.pos < lane.len) continue;
      lane.vs.shift();
      v.where = 'box';
      v.p = v.pos - lane.len;
      v.inLane = lane;
      v.gapWait = 0;
      lane.boxQ.push(v);
      JW.box.push(v);
    }
    for (const v of [...JW.box]) {
      if (v.p - v.len < v.path.len) continue;
      JW.box.splice(JW.box.indexOf(v), 1);
      v.inLane.boxQ.splice(v.inLane.boxQ.indexOf(v), 1);
      const X = exitLaneOf(w, JW, v.path);
      v.where = 'lane';
      v.lane = X;
      v.pos = v.p - v.path.len;
      v.commit = false;
      X.vs.push(v);
      if (X.kind === 'in') v.mi++;
    }
  }
  for (const lane of w.lanes) {
    if (lane.kind !== 'out') continue;
    while (lane.vs.length && lane.vs[0].pos - lane.vs[0].len > lane.len) {
      const v = lane.vs.shift();
      w.vehicles.splice(w.vehicles.indexOf(v), 1);
      w.delivered++;
      w.delaySum += v.wait;
      w.longest = Math.max(w.longest, v.wait);
      log.push({ k: 'deliver', id: v.id, kind: v.k });
    }
  }
}

const waitLimit = (L, v) => (v.k === 'amb' ? L.emgWait : v.k === 'bus' ? L.busWait : L.maxWait);

function checkStrikes(w, dt, log) {
  const L = w.L;
  // Strikes are spaced out so a pile-up of late vehicles cannot end the shift in one instant;
  // an ambulance held up is the exception.
  for (const lane of w.lanes) {
    if (lane.kind !== 'in') continue;
    for (const v of lane.vs) {
      if (v.v < stoppedSpeed) v.wait += dt;
      const limit = waitLimit(L, v);
      if (v.wait > w.longest) w.longest = v.wait;
      if (v.wait / limit > w.maxRel) w.maxRel = v.wait / limit;
      if (!v.struck && v.wait > limit && (v.k === 'amb' || w.t - w.lastStrike >= RULES.strikeGap)) {
        v.struck = true;
        w.lastStrike = w.t;
        log.push({ k: 'wait', id: v.id, kind: v.k, jn: lane.jn, d: lane.dir });
      } else if (
        !v.gridStruck &&
        v.stuck > RULES.gridlock &&
        w.t - w.lastStrike >= RULES.strikeGap
      ) {
        v.gridStruck = true;
        w.lastStrike = w.t;
        log.push({ k: 'gridlock', id: v.id, kind: v.k, jn: lane.jn, d: lane.dir });
      }
    }
  }
  let gone = false;
  for (const p of w.peds) {
    if (p.st === 'wait') {
      w.maxRel = Math.max(w.maxRel, (w.t - p.t0) / L.pedMax);
      if (w.t - p.t0 > L.pedMax && w.t - w.lastStrike >= RULES.strikeGap) {
        p.st = 'gone';
        gone = true;
        w.lastStrike = w.t;
        log.push({ k: 'ped', jn: p.jn, d: p.d });
      }
    } else if (p.st === 'cross') {
      p.tc += dt;
      if (p.tc >= RULES.pedCross) {
        p.st = 'gone';
        gone = true;
        w.pedsServed++;
      }
    }
  }
  if (gone) w.peds = w.peds.filter((p) => p.st !== 'gone');
}

export function stepWorld(w, dt, log) {
  w.t += dt;
  while (w.pi < w.pending.length && w.pending[w.pi].t <= w.t) w.due.push(w.pending[w.pi++]);
  if (w.due.length) {
    w.due = w.due.filter((c) => {
      if (trySpawn(w, c)) return false;
      c.late += dt;
      if (c.late < RULES.spillGrace) return true;
      w.lost++;
      const lane = w.lanes[c.lane];
      if (w.t - w.lastStrike >= RULES.strikeCool) {
        w.lastStrike = w.t;
        log.push({ k: 'spill', jn: lane.jn, d: lane.dir });
      }
      return false;
    });
  }
  while (w.qi < w.pedQ.length && w.pedQ[w.qi].t <= w.t) {
    const q = w.pedQ[w.qi++];
    const JW = w.juncs[q.jn];
    const walking = JW.sig.stage === 'ped' && JW.sig.t < RULES.pedLate;
    const p = { id: q.id, jn: q.jn, d: q.d, t0: w.t, st: 'wait', tc: 0 };
    w.peds.push(p);
    if (walking) beginCross(w, p);
  }
  for (const JW of w.juncs) updateSignal(w, JW, dt);
  prepareHeads(w, dt);
  computeMotion(w, dt);
  applyMotion(w, log);
  checkStrikes(w, dt, log);
}

// --- The controller behind the on-screen prompt (also used to validate every schedule) ---

const serves = (P, d, m) => P.allow[d].includes(m);

// Arrivals not yet on the road (waiting for room, or due within `span` seconds), with their due time.
function upcoming(w, span) {
  const out = w.due.map((c) => ({ c, at: w.t }));
  for (let i = w.pi; i < w.pending.length && w.pending[i].t <= w.t + span; i++)
    out.push({ c: w.pending[i], at: w.pending[i].t });
  return out;
}

function pressure(w, JW, phase) {
  const P = JW.J.plan[phase];
  let sum = 0;
  for (let d = 0; d < 4; d++) {
    const lane = laneOf(w, JW.j, d);
    if (!lane) continue;
    for (const v of lane.vs) {
      if (!serves(P, d, v.moves[v.mi])) continue;
      const near = v.v < 6 || (lane.len - v.pos) / v.vmax <= RULES.horizon;
      if (near) sum += v.weight * (1 + Math.min(v.wait, 40) / 10);
    }
  }
  for (const { c, at } of upcoming(w, RULES.horizon + 4)) {
    const lane = w.lanes[c.lane];
    if (lane.jn !== JW.j || !serves(P, lane.dir, c.moves[0])) continue;
    if (at - w.t + lane.len / (TYPES[c.k].vmax * 0.8) <= RULES.horizon)
      sum += TYPES[c.k].weight * 0.6;
  }
  return sum;
}

// Every junction an ambulance will reach, with the time it needs to get there.
function ambHops(w, lane, mi, moves, eta, ahead) {
  const hops = [];
  let m = moves[mi] ?? 'S';
  for (let hop = 0; hop < 3; hop++) {
    hops.push({ jn: lane.jn, d: lane.dir, m, eta, queue: ahead });
    const X = w.lanes[w.L.junctions[lane.jn].outLane[exitDir(lane.dir, m)]];
    if (X.kind !== 'in') break;
    eta += (pathOf(lane.dir, m).len + X.len) / TYPES.amb.vmax;
    ahead = X.vs.length;
    lane = X;
    mi++;
    m = moves[mi] ?? 'S';
  }
  return hops;
}

// Ambulances heading for this junction: live ones that have not crossed, and ones about to appear.
export function ambulances(w, JW) {
  const out = [];
  const take = (hops) => {
    for (const h of hops) if (h.jn === JW.j) out.push(h);
  };
  for (const lane of w.lanes) {
    lane.vs.forEach((v, i) => {
      if (v.k === 'amb' && lane.kind === 'in')
        take(ambHops(w, lane, v.mi, v.moves, (lane.len - v.pos) / v.vmax, i));
    });
  }
  for (const JX of w.juncs)
    for (const v of JX.box) {
      const X = exitLaneOf(w, JX, v.path);
      if (v.k === 'amb' && X.kind === 'in')
        take(ambHops(w, X, v.mi + 1, v.moves, (v.path.len - v.p + X.len) / v.vmax, X.vs.length));
    }
  for (const { c, at } of upcoming(w, RULES.alertEta + 4)) {
    const lane = w.lanes[c.lane];
    if (c.k === 'amb')
      take(ambHops(w, lane, 0, c.moves, at - w.t + lane.len / TYPES.amb.vmax, lane.vs.length));
  }
  return out;
}

// What this junction's signal should do now: null to hold, else {kind, to, urgency, why}.
export function wantFor(w, JW) {
  const sg = JW.sig;
  if (sg.stage !== 'green' || sg.t < RULES.minGreen) return null;
  const L = w.L;
  const plan = JW.J.plan;
  const cur = sg.ph;
  const nxt = nextPhase(w, JW);
  const waiting = pedsWaiting(w, JW.j);
  const oldest = waiting.length ? w.t - Math.min(...waiting.map((p) => p.t0)) : 0;
  const lead = RULES.yellow + RULES.allRed + 1.5 + (w.juncs.length > 1 ? 2 : 0);
  const amb = ambulances(w, JW);
  // Never leave a phase an ambulance is about to need: the way back costs a full minimum green.
  const hold = RULES.minGreen + RULES.yellow + RULES.allRed + 2;
  if (amb.some((a) => serves(plan[cur], a.d, a.m) && a.eta < hold + 0.7 * a.queue)) return null;
  const urgent = amb.find(
    (a) => !serves(plan[cur], a.d, a.m) && a.eta <= lead + 0.7 * a.queue + 2.5,
  );
  if (urgent) return { kind: 'phase', to: nxt, urgency: 1000, amb: urgent.d };
  const pedForce = waiting.length > 0 && oldest >= L.pedMax - RULES.pedLead;
  if (pedForce) return { kind: 'ped', to: 'ped', urgency: 500 };
  const pc = pressure(w, JW, cur);
  const pn = pressure(w, JW, nxt);
  const starving = (() => {
    for (let d = 0; d < 4; d++) {
      const lane = laneOf(w, JW.j, d);
      if (!lane) continue;
      const rear = rearOf(lane);
      const nearEdge =
        rear &&
        rear.v < 6 &&
        rear.pos - rear.len < Math.min(RULES.spillWarn, lane.len * 0.3) &&
        lane.len < RULES.armMax;
      if (
        lane.vs.some(
          (v) =>
            serves(plan[nxt], d, v.moves[v.mi]) &&
            (v.wait >= 0.55 * waitLimit(L, v) || (nearEdge && v === rear)),
        )
      )
        return true;
    }
    return false;
  })();
  const sw = pn >= 0.5 && (pc < 0.35 || pn > 1.35 * pc + 1.2 || starving || sg.t > RULES.maxGreen);
  if (!sw) return null;
  const pedOk = w.t - sg.lastPed >= RULES.pedGap;
  if (pedOk && waiting.length && (oldest >= 0.35 * L.pedMax || waiting.length >= 4))
    return { kind: 'ped', to: 'ped', urgency: 200 };
  return { kind: 'phase', to: nxt, urgency: starving ? 100 : pn - pc };
}

export function bestWant(w) {
  let best = null;
  for (const JW of w.juncs) {
    const x = wantFor(w, JW);
    if (x && (!best || x.urgency > best.want.urgency)) best = { j: JW.j, want: x };
  }
  return best;
}

// --- Play state ---

const STRIKE_TEXT = (s, e) => {
  const where = (jn, d) => {
    const J = s.L.junctions[jn];
    const nm =
      s.L.junctions.length > 1 ? [` (${J.name[0]} junction)`, `（${J.name[1]}路口）`] : ['', ''];
    return [`${DIR_EN[d]} road${nm[0]}`, `${DIR_ZH[d]}向道路${nm[1]}`];
  };
  if (e.k === 'wait') {
    const [en, zh] = where(e.jn, e.d);
    const lim = e.kind === 'bus' ? s.L.busWait : e.kind === 'amb' ? s.L.emgWait : s.L.maxWait;
    const who = {
      car: ['A car', '一辆小汽车'],
      truck: ['A truck', '一辆卡车'],
      bus: ['A bus', '一辆公交车'],
      amb: ['The ambulance', '救护车'],
    }[e.kind];
    return e.kind === 'amb'
      ? [
          `The ambulance waited over ${lim} s on the ${en}: shift over!`,
          `救护车在${zh}等待超过 ${lim} 秒，本班结束！`,
        ]
      : [
          `Strike! ${who[0]} waited over ${lim} s on the ${en}`,
          `失误！${who[1]}在${zh}等待超过 ${lim} 秒`,
        ];
  }
  if (e.k === 'spill') {
    const [en, zh] = where(e.jn, e.d);
    return [
      `Strike! The queue spilled off the map on the ${en}`,
      `失误！${zh}的队伍排出了地图边缘`,
    ];
  }
  if (e.k === 'gridlock') {
    const [en, zh] = where(e.jn, e.d);
    return [
      `Strike! Gridlock: a vehicle on the ${en} could not move for ${RULES.gridlock} s`,
      `失误！路口堵死：${zh}上的车辆 ${RULES.gridlock} 秒无法通行`,
    ];
  }
  const [en, zh] = where(e.jn, e.d);
  return [
    `Strike! Pedestrians waited over ${s.L.pedMax} s at the ${en}`,
    `失误！行人在${zh}的斑马线等待超过 ${s.L.pedMax} 秒`,
  ];
};

export function newPlay(L, sched) {
  return {
    L,
    sched,
    w: newWorld(L, sched),
    phase: 'playing',
    cause: null,
    sel: 0,
    acc: 0,
    strikes: 0,
    score: 0,
    line: null,
    actSeq: 0,
    last: null,
    ambulanceDown: false,
    msg: {
      en: `Level ${L.index + 1}: ${L.name[0]}`,
      zh: `第 ${L.index + 1} 关：${L.name[1]}`,
      tip: L.tip,
      age: 0,
      dur: RULES.introTime,
    },
    stats: {
      strikes: { wait: 0, spill: 0, ped: 0, gridlock: 0 },
      refused: 0,
      signals: 0,
      calls: 0,
    },
    flash: [],
    think: 0,
  };
}

function say(s, en, zh, dur = RULES.msgTime) {
  s.msg = { en, zh, tip: null, age: 0, dur };
}

function endPlay(s, phase, cause) {
  s.phase = phase;
  s.cause = cause;
}

function playTick(s, emit) {
  const log = [];
  stepWorld(s.w, STEP, log);
  for (const e of log) {
    if (e.k === 'deliver') {
      s.score += e.kind === 'bus' ? 25 : e.kind === 'amb' ? 50 : RULES.scoreVehicle;
      emit('coin');
    } else {
      s.strikes = e.k === 'wait' && e.kind === 'amb' ? RULES.lives : s.strikes + 1;
      s.stats.strikes[e.k]++;
      s.last = e.k;
      s.ambulanceDown = e.k === 'wait' && e.kind === 'amb';
      const [en, zh] = STRIKE_TEXT(s, e);
      s.msg = { en, zh, tip: null, age: 0, dur: RULES.msgTime + 1 };
      s.flash.push({ jn: e.jn, d: e.d, age: 0 });
      emit('hit');
    }
  }
  for (const f of s.flash) f.age += STEP;
  s.flash = s.flash.filter((f) => f.age < 1.5);
  const w = s.w;
  if (s.phase !== 'playing') return;
  if (s.strikes >= RULES.lives) endPlay(s, 'lost', s.ambulanceDown ? 'ambulance' : 'strikes');
  else if (w.delivered >= w.quota) endPlay(s, 'cleared', null);
  else if (w.t >= s.L.time) endPlay(s, 'lost', 'time');
  else if (w.delivered + w.vehicles.length + w.due.length + (w.pending.length - w.pi) < w.quota)
    endPlay(s, 'lost', 'quota');
}

// Neighbouring junction in a direction (0 north .. 3 west), or -1.
export function neighbour(js, from, dir) {
  let best = -1;
  let bestD = Infinity;
  js.forEach((J, i) => {
    const dx = J.x - js[from].x;
    const dy = J.y - js[from].y;
    const along = dx * OUT[dir][0] + dy * OUT[dir][1];
    const across = Math.abs(dx * OUT[dir][1] + dy * OUT[dir][0]);
    if (i !== from && along > 0 && across < along && along < bestD) {
      best = i;
      bestD = along;
    }
  });
  return best;
}
export function selectStep(js, from, to) {
  for (let d = 0; d < 4; d++) if (neighbour(js, from, d) === to) return d;
  return -1;
}

function selectJunction(s, to, emit) {
  if (to < 0 || to === s.sel) return;
  s.sel = to;
  s.actSeq++;
  emit('move');
}

function act(s, input, emit) {
  const js = s.L.junctions;
  const keys = [
    ['ArrowUp', 'KeyW', 0],
    ['ArrowRight', 'KeyD', 1],
    ['ArrowDown', 'KeyS', 2],
    ['ArrowLeft', 'KeyA', 3],
  ];
  for (const [a, b, d] of keys)
    if (input.pressed(a, b)) selectJunction(s, neighbour(js, s.sel, d), emit);
  let space = input.pressed('Space', 'Enter');
  let ped = input.pressed('KeyX');
  const p = input.pointer;
  if (p?.clicked) {
    const hit = js.findIndex((J) => Math.abs(p.x - J.x) < 66 && Math.abs(p.y - J.y) < 66);
    if (hit >= 0 && hit !== s.sel) selectJunction(s, hit, emit);
    else if (hit >= 0) {
      const dx = Math.abs(p.x - js[hit].x);
      const dy = Math.abs(p.y - js[hit].y);
      const onZebra = (dx > 21 && dx < 33 && dy < 22) || (dy > 21 && dy < 33 && dx < 22);
      if (onZebra) ped = true;
      else space = true;
    }
  }
  const JW = s.w.juncs[s.sel];
  if (space) {
    s.actSeq++;
    if (advanceSignal(s.w, JW)) {
      s.stats.signals++;
      emit('move');
    } else {
      s.stats.refused++;
      const sg = JW.sig;
      if (sg.stage === 'green') {
        const left = Math.ceil(RULES.minGreen - sg.t);
        say(
          s,
          `Hold on: a green lasts at least ${RULES.minGreen} s (${left} more)`,
          `稍等：绿灯至少持续 ${RULES.minGreen} 秒（还需 ${left} 秒）`,
          1.2,
        );
      } else say(s, 'The signal is already changing', '信号灯正在切换', 1.2);
    }
  }
  if (ped) {
    s.actSeq++;
    if (callPedestrians(s.w, JW)) {
      s.stats.calls++;
      emit('move');
    } else {
      s.stats.refused++;
      if (!pedsWaiting(s.w, JW.j).length)
        say(s, 'Nobody is waiting to cross here', '这里没有等待过街的行人', 1.2);
      else say(s, 'Wait for the green to settle first', '请等绿灯稳定后再呼叫', 1.2);
    }
  }
}

// --- The prompt line ---

const labelOf = (J, p, lang) => J.plan[p].label[lang];

function describe(s) {
  const w = s.w;
  const js = s.L.junctions;
  const multi = js.length > 1;
  const best = bestWant(w);
  if (!best) {
    const JW = w.juncs[s.sel];
    const p = JW.sig.ph;
    if (JW.sig.stage !== 'green')
      return {
        key: `watch:${s.sel}:${JW.sig.stage}`,
        kind: 'watch',
        target: null,
        press: null,
        en:
          JW.sig.stage === 'ped'
            ? 'Pedestrians are crossing - the cars wait'
            : 'The signal is changing - wait for the green',
        zh: JW.sig.stage === 'ped' ? '行人正在过街，车辆等待' : '信号正在切换，请等待绿灯',
        dirs: [],
      };
    return {
      key: `watch:${s.sel}:${JW.sig.stage}:${p}`,
      kind: 'watch',
      target: null,
      press: null,
      en: `Signals are set - watch the ${labelOf(JW.J, p, 0)} traffic`,
      zh: `信号已就位，留意${labelOf(JW.J, p, 1)}车流`,
      dirs: [],
    };
  }
  const { j, want } = best;
  const J = js[j];
  const to = want.to;
  let en;
  let zh;
  let dirs;
  if (want.kind === 'ped') {
    en = 'X: stop the cars and let the pedestrians cross';
    zh = 'X：拦停车辆，让行人过街';
    dirs = [0, 1, 2, 3].filter((d) => J.arms[d]);
  } else {
    dirs = [0, 1, 2, 3].filter((d) => J.plan[to].allow[d]);
    if (want.amb !== undefined) {
      en = `Space: clear the way for the ambulance from the ${DIR_EN[want.amb]}`;
      zh = `空格：为${DIR_ZH[want.amb]}侧来的救护车让路`;
    } else {
      en = `Space: let the ${J.plan[to].label[0]} queue go`;
      zh = `空格：放行${J.plan[to].label[1]}车流`;
    }
  }
  const key = `${want.kind}:${j}:${w.juncs[j].sig.ph}:${to}`;
  if (s.sel !== j) {
    const step = selectStep(js, s.sel, j);
    const name = js[j].name;
    return {
      key: `select:${j}:${step}:${key}`,
      kind: 'select',
      target: multi ? name[0] : null,
      press: PRESS[step],
      en: `Select the ${name[0]} junction (${ARROW[step]}), then ${en}`,
      zh: `先选择${name[1]}路口（${ARROW[step]}），再按${zh}`,
      dirs,
      junction: j,
    };
  }
  return {
    key,
    kind: want.kind,
    target: multi ? J.name[0] : null,
    press: want.kind === 'ped' ? 'KeyX' : 'Space',
    en: `Press ${en}`,
    zh: `按${zh}`,
    dirs,
    junction: j,
  };
}

// The prompt is re-evaluated every `thinkTicks` simulation steps, so frame rate never changes
// when the controller looks at the road.
function advise(s, dt, steps) {
  const cur = s.line;
  s.think += steps;
  if (cur && s.think < RULES.thinkTicks && cur.seq === s.actSeq) {
    cur.age += dt;
    return;
  }
  s.think = 0;
  const next = describe(s);
  if (cur && cur.key === next.key) {
    cur.age += dt;
    return;
  }
  if (cur && cur.age < RULES.promptHold && cur.seq === s.actSeq) {
    cur.age += dt;
    return;
  }
  s.line = { ...next, age: 0, seq: s.actSeq };
}

// Advances one shift by dt seconds of the fixed-step simulation.
export function advancePlay(s, dt, input, emit) {
  if (s.phase !== 'playing') return;
  act(s, input, emit);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) playTick(s, emit);
  s.msg.age += dt;
  if (s.phase === 'playing') advise(s, dt, steps);
}

export const pressedOf = (keys) => ({
  pressed: (...codes) => codes.some((c) => keys.includes(c)),
  held: () => false,
  pointer: null,
});

// A literal prompt follower: presses the key named by the prompt it saw `lag` seconds ago.
export function autoplay(lag) {
  const hist = [];
  let last = { key: null, t: -9 };
  let lastPress = -9;
  return (s, t) => {
    hist.push({
      t,
      line: s.line ? { key: s.line.key, press: s.line.press, kind: s.line.kind } : null,
    });
    if (hist.length > 400) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const line = hist[k].line;
    if (!line || line.kind === 'watch' || !line.press || t - lastPress < 0.12) return [];
    if (line.key === last.key && t - last.t < 1.5) return [];
    last = { key: line.key, t };
    lastPress = t;
    return [line.press];
  };
}

// Plays a whole shift with the follower; the schedule check at load uses this.
export function runPrompted(L, sched, lag, hz = 60) {
  const s = newPlay(L, sched);
  const follow = autoplay(lag);
  for (let f = 0; s.phase === 'playing' && f < (L.time + 2) * hz; f++)
    advancePlay(s, 1 / hz, pressedOf(follow(s, f / hz)), () => {});
  return s;
}

// Reaction lag (s) and frame rate (Hz) of the followers every schedule must survive.
const CHECK_RUNS = [
  [0.6, 30],
  [0, 30],
  [0.5, 60],
  [0.3, 60],
  [0, 60],
  [0.6, 120],
  [0.3, 120],
  [0.5, 120],
];
const cleanRun = (L, sched, [lag, hz]) => {
  const s = runPrompted(L, sched, lag, hz);
  return (
    s.phase === 'cleared' && s.strikes === 0 && s.w.t <= L.time - 3 && s.w.maxRel <= RULES.margin
  );
};

// Validated schedules by level and seed. A schedule depends only on the level and one draw from
// env.random, so every game with that draw shares it and the check runs once.
const scheduleCache = new Map();
const CACHE_LIMIT = 600;

// A seeded schedule the controller clears with no strike at quick, middling and slow followers;
// the authored seed's schedule when none of the draws does. One draw from `random` picks the
// whole sequence of candidates.
export function safeSchedule(L, random, tries = 16) {
  const seed = Math.floor(random() * 4294967296) >>> 0;
  const key = `${L.index}:${seed}`;
  const hit = scheduleCache.get(key);
  if (hit) return hit;
  const next = seeded(seed);
  let found = null;
  for (let n = 0; n < tries && !found; n++) {
    const sched = buildSchedule(L, next);
    if (CHECK_RUNS.every((run) => cleanRun(L, sched, run))) found = sched;
  }
  const sched = found ?? buildSchedule(L, seeded(L.seed));
  if (scheduleCache.size >= CACHE_LIMIT) scheduleCache.clear();
  scheduleCache.set(key, sched);
  return sched;
}

// --- Campaign state: level select, level changes and the final win ---

function savedLevel(progress) {
  try {
    return Math.floor(Number(progress.unlocked()));
  } catch {
    return NaN;
  }
}
function saveLevel(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}

export function newState(env = {}, levels = BUILT) {
  const g = {
    levels,
    phase: 'playing',
    score: 0,
    banked: 0,
    cause: null,
    menu: null,
    clear: 0,
    cleared: 0,
    progress: env.progress || null,
    random: typeof env.random === 'function' ? env.random : () => 0.5,
    play: null,
    level: 0,
  };
  const raw = savedLevel(g.progress);
  const unlocked = Number.isNaN(raw) ? 1 : clamp(raw, 1, levels.length);
  loadLevel(g, 0);
  if (unlocked > 1) g.menu = { sel: unlocked, unlocked };
  return g;
}

function loadLevel(g, index) {
  const L = g.levels[index];
  g.level = index;
  g.play = newPlay(L, safeSchedule(L, g.random));
}

function menuInput(g, input, emit) {
  const m = g.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * RULES.menuCols, 1, m.unlocked);
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  const p = input.pointer;
  if (p?.clicked) {
    const hit = menuCellAt(p.x, p.y);
    if (hit >= 1 && hit <= m.unlocked) {
      if (hit === m.sel) m.go = true;
      m.sel = hit;
    }
  }
  if (input.pressed('Space', 'Enter') || m.go) {
    loadLevel(g, m.sel - 1);
    g.menu = null;
    emit('move');
  }
}

export const MENU = Object.freeze({ x: 60, y: 62, w: 72, h: 44 });
function menuCellAt(px, py) {
  const col = Math.floor((px - MENU.x) / MENU.w);
  const row = Math.floor((py - MENU.y) / MENU.h);
  if (col < 0 || col >= RULES.menuCols || row < 0 || px < MENU.x || py < MENU.y) return -1;
  return row * RULES.menuCols + col + 1;
}

function finishLevel(g, emit) {
  const s = g.play;
  const w = s.w;
  const delay = w.delivered ? w.delaySum / w.delivered : 0;
  const bonus =
    RULES.scoreClear +
    (RULES.lives - s.strikes) * RULES.scoreStrike +
    Math.round(Math.max(0, 20 - delay) * 5);
  g.banked += s.score + bonus;
  g.score = g.banked;
  g.cleared++;
  saveLevel(g.progress, Math.min(g.levels.length, g.level + 2));
  emit('win');
  if (g.level + 1 >= g.levels.length) {
    g.phase = 'won';
    return;
  }
  g.clear = RULES.clearTime;
  say(s, 'Shift cleared!', '本班完成！', RULES.clearTime);
}

export function advance(g, dt, input, emit = () => {}) {
  if (g.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return false;
  dt = Math.min(dt, RULES.maxDt);
  if (g.menu) {
    menuInput(g, input, emit);
    return true;
  }
  if (g.clear > 0) {
    g.clear -= dt;
    g.play.msg.age += dt;
    if (g.clear <= 0) loadLevel(g, g.level + 1);
    return true;
  }
  advancePlay(g.play, dt, input, emit);
  g.score = g.banked + g.play.score;
  if (g.play.phase === 'cleared') finishLevel(g, emit);
  else if (g.play.phase === 'lost') {
    g.phase = 'lost';
    g.cause = g.play.cause;
  }
  return true;
}

const LOSS_TEXT = {
  ambulance: (n) => [
    `An ambulance was held up on shift ${n}: you are relieved of duty.`,
    `第 ${n} 班救护车被耽误，你被换下岗位。`,
  ],
  strikes: (n) => [
    `Three strikes on shift ${n}: you are relieved of duty.`,
    `第 ${n} 班发生三次失误，你被换下岗位。`,
  ],
  time: (n) => [
    `Time ran out on shift ${n} before the quota was met.`,
    `第 ${n} 班时间用完，未达到放行数量。`,
  ],
  quota: (n) => [
    `Too many vehicles were lost on shift ${n} to reach the quota.`,
    `第 ${n} 班流失的车辆太多，已无法达到放行数量。`,
  ],
};

export function createGame(env) {
  const g = newState(env);
  let ended = false;
  return {
    update(dt, input) {
      // The host plays the win and lose sounds itself, so the final update stays silent.
      const heard = [];
      advance(g, dt, input, (name) => heard.push(name));
      if (g.phase === 'playing') {
        for (const name of heard) env.sound(name);
        return;
      }
      if (ended) return;
      ended = true;
      const [en, zh] =
        g.phase === 'won'
          ? [
              'Every junction is running smoothly - well conducted!',
              '所有路口运转顺畅，指挥得漂亮！',
            ]
          : LOSS_TEXT[g.cause](g.level + 1);
      env.end({ won: g.phase === 'won', score: g.score, message: env.t(en, zh) });
    },
    draw(ctx) {
      drawGame(ctx, g, env);
    },
    getState() {
      return snapshotOf(g);
    },
  };
}

// --- Snapshot ---

export function vehiclePose(w, v) {
  if (v.where === 'box') {
    const JW = w.juncs[v.inLane.jn];
    const q = pointOnPath(v.path, v.p - v.len / 2);
    return { x: JW.J.x + q.x, y: JW.J.y + q.y, hx: q.hx, hy: q.hy };
  }
  const lane = v.lane;
  const c = v.pos - v.len / 2;
  return { x: lane.sx + lane.hx * c, y: lane.sy + lane.hy * c, hx: lane.hx, hy: lane.hy };
}
const round1 = (n) => Math.round(n * 10) / 10;
const headingName = (hx, hy) =>
  Math.abs(hx) > Math.abs(hy) ? (hx > 0 ? 'E' : 'W') : hy > 0 ? 'S' : 'N';

function approachLight(JW, d) {
  const lights = ['S', 'L', 'R'].map((m) => lightOf(JW, d, m));
  return lights.includes('G') ? 'green' : lights.includes('Y') ? 'yellow' : 'red';
}

function alertsOf(w) {
  const out = [];
  for (const JW of w.juncs)
    for (const a of ambulances(w, JW))
      if (a.eta < RULES.alertEta)
        out.push({ jn: JW.j, d: a.d, eta: Math.max(0, Math.ceil(a.eta)) });
  return out;
}

export function statusLabel(g, lang) {
  const s = g.play;
  const w = s.w;
  const left = Math.max(0, Math.ceil(s.L.time - w.t));
  return lang === 'en'
    ? `Shift ${g.level + 1}/${g.levels.length}  Out ${Math.min(w.delivered, w.quota)}/${w.quota}  Strikes ${s.strikes}/${RULES.lives}  Time ${left}s`
    : `第 ${g.level + 1}/${g.levels.length} 班  放行 ${Math.min(w.delivered, w.quota)}/${w.quota}  失误 ${s.strikes}/${RULES.lives}  剩余 ${left} 秒`;
}

export function snapshotOf(g) {
  const s = g.play;
  const w = s.w;
  const L = s.L;
  const finished = g.phase !== 'playing';
  const line = s.line
    ? {
        kind: s.line.kind,
        key: s.line.key,
        target: s.line.target,
        press: s.line.press,
        en: s.line.en,
        zh: s.line.zh,
        dirs: [...s.line.dirs],
      }
    : null;
  const tip = s.msg.tip && s.msg.age < s.msg.dur ? s.msg.tip : null;
  return {
    phase: g.phase,
    score: g.score,
    level: g.level + 1,
    levelCount: g.levels.length,
    name: { en: L.name[0], zh: L.name[1] },
    time: w.t,
    timeLimit: L.time,
    timeLeft: Math.max(0, L.time - w.t),
    delivered: Math.min(w.delivered, w.quota),
    quota: w.quota,
    strikes: s.strikes,
    lives: RULES.lives,
    spare: Math.max(0, RULES.lives - s.strikes),
    lost: w.lost,
    avgDelay: round1(w.delivered ? w.delaySum / w.delivered : 0),
    longestWait: round1(w.longest),
    waitLimit: L.maxWait,
    busWaitLimit: L.busWait,
    pedLimit: L.pedMax,
    selected: s.sel,
    junctions: w.juncs.map((JW) => ({
      id: JW.j,
      name: { en: JW.J.name[0], zh: JW.J.name[1] },
      x: JW.J.x,
      y: JW.J.y,
      selected: JW.j === s.sel,
      stage: JW.sig.stage,
      phase: JW.sig.ph,
      phaseLabel: { en: JW.J.plan[JW.sig.ph].label[0], zh: JW.J.plan[JW.sig.ph].label[1] },
      phases: JW.J.plan.length,
      minGreenLeft:
        JW.sig.stage === 'green'
          ? Math.ceil(Math.max(0, RULES.minGreen - JW.sig.t) * 10) / 10
          : null,
      signals: [0, 1, 2, 3]
        .filter((d) => JW.J.arms[d])
        .map((d) => ({ dir: 'NESW'[d], light: approachLight(JW, d) })),
      pedsWaiting: pedsWaiting(w, JW.j).length,
      boxVehicles: JW.box.length,
    })),
    vehicles: w.vehicles.map((v) => {
      const pose = vehiclePose(w, v);
      return {
        id: v.id,
        kind: v.k,
        x: round1(pose.x),
        y: round1(pose.y),
        heading: headingName(pose.hx, pose.hy),
        length: v.len,
        speed: round1(v.v),
        wait: round1(v.wait),
        move: v.moves[v.mi],
        where: v.where,
        junction: v.where === 'box' ? v.inLane.jn : v.lane.jn,
        approach: 'NESW'[(v.where === 'box' ? v.inLane : v.lane).dir],
        zones:
          v.where === 'box'
            ? v.path.zones.filter((z) => v.p - v.len < z.b + 1.5).map((z) => z.z)
            : [],
      };
    }),
    pedestrians: w.peds.map((p) => ({
      id: p.id,
      junction: p.jn,
      dir: 'NESW'[p.d],
      state: p.st,
      wait: round1(w.t - p.t0),
    })),
    alerts: alertsOf(w),
    prompt: line,
    line,
    message: s.msg.age < s.msg.dur ? { en: s.msg.en, zh: s.msg.zh } : null,
    tip: tip ? { en: tip[0], zh: tip[1] } : null,
    incident: s.last,
    clearing: g.clear > 0,
    menu: g.menu ? { sel: g.menu.sel, unlocked: g.menu.unlocked } : null,
    stats: { ...s.stats, strikes: { ...s.stats.strikes }, pedsServed: w.pedsServed },
    hud: { top: [0, RULES.top], bottom: [RULES.bottom, 320] },
    status: finished
      ? g.phase === 'won'
        ? {
            en: `Every junction is running! Score ${g.score}`,
            zh: `所有路口都运转顺畅！得分 ${g.score}`,
          }
        : { en: `Relieved of duty. Score ${g.score}`, zh: `被换下岗位。得分 ${g.score}` }
      : g.menu
        ? {
            en: `Traffic Conductor · ${g.menu.unlocked}/${g.levels.length} shifts open · Arrows choose, Space starts`,
            zh: `路口指挥官 · 已开放 ${g.menu.unlocked}/${g.levels.length} 班 · 方向键选择，空格开始`,
          }
        : {
            en: [statusLabel(g, 'en'), tip?.[0], s.line?.en].filter(Boolean).join(' · '),
            zh: [statusLabel(g, 'zh'), tip?.[1], s.line?.zh].filter(Boolean).join(' · '),
          },
  };
}

// --- Drawing ---

const FONT = 12;
const WRAP_EN = 56;
const WRAP_ZH = 34;
const BANNER_LINE = 14;
const CAR_COLORS = [
  '#e5484d',
  '#4c8dff',
  '#f2c94c',
  '#3fb950',
  '#a678f0',
  '#f0883e',
  '#d0d6e0',
  '#26c6da',
];

const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// Greedy word wrap: Latin text breaks at spaces, Chinese text after `max` characters.
export function wrapText(str, max) {
  const lines = [];
  let cur = '';
  for (const word of /[　-鿿]/.test(str)
    ? str.match(new RegExp(`.{1,${max}}`, 'gu'))
    : str.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  return cur ? [...lines, cur] : lines;
}

function drawRoads(ctx, w) {
  const L = w.L;
  for (const J of L.junctions) {
    for (let d = 0; d < 4; d++) {
      if (!J.arms[d]) continue;
      const lane = L.lanes[J.inLane[d]];
      const reach = RULES.stop + (lane.src >= 0 ? lane.len : lane.len + 4);
      const ex = J.x + OUT[d][0] * reach;
      const ey = J.y + OUT[d][1] * reach;
      const x0 = Math.min(J.x, ex) - (d % 2 ? 0 : RULES.boxHalf);
      const y0 = Math.min(J.y, ey) - (d % 2 ? RULES.boxHalf : 0);
      box(ctx, '#383e48', x0, y0, d % 2 ? Math.abs(ex - J.x) : 44, d % 2 ? 44 : Math.abs(ey - J.y));
    }
    box(ctx, '#343a44', J.x - 22, J.y - 22, 44, 44);
  }
  for (const J of L.junctions) {
    for (let d = 0; d < 4; d++) {
      if (!J.arms[d]) continue;
      const lane = L.lanes[J.inLane[d]];
      const h = [-OUT[d][0], -OUT[d][1]];
      const r = rightOf(h);
      const reach = RULES.stop + lane.len;
      for (let a = RULES.boxHalf + 6; a < reach; a += 12) {
        const px = J.x + OUT[d][0] * a;
        const py = J.y + OUT[d][1] * a;
        box(
          ctx,
          '#e0b84a',
          px - (d % 2 ? 3 : 1),
          py - (d % 2 ? 1 : 3),
          d % 2 ? 6 : 2,
          d % 2 ? 2 : 6,
        );
      }
      for (let k = -20; k <= 20; k += 6) {
        const px = J.x + OUT[d][0] * 26 + rightOf(OUT[d])[0] * k;
        const py = J.y + OUT[d][1] * 26 + rightOf(OUT[d])[1] * k;
        box(
          ctx,
          '#e6e9ef',
          px - (d % 2 ? 4 : 1),
          py - (d % 2 ? 1 : 4),
          d % 2 ? 8 : 3,
          d % 2 ? 3 : 8,
        );
      }
      const sx = J.x + OUT[d][0] * 31 + r[0] * 11;
      const sy = J.y + OUT[d][1] * 31 + r[1] * 11;
      box(
        ctx,
        '#ffffff',
        sx - (d % 2 ? 1 : 10),
        sy - (d % 2 ? 10 : 1),
        d % 2 ? 2 : 20,
        d % 2 ? 20 : 2,
      );
    }
  }
}

const LAMP = { red: '#ff5a5f', yellow: '#ffd23f', green: '#3ddc84' };
function drawSignals(ctx, w) {
  for (const JW of w.juncs) {
    for (let d = 0; d < 4; d++) {
      if (!JW.J.arms[d]) continue;
      const h = [-OUT[d][0], -OUT[d][1]];
      const r = rightOf(h);
      const x = JW.J.x + OUT[d][0] * 33 + r[0] * 27;
      const y = JW.J.y + OUT[d][1] * 33 + r[1] * 27;
      const light = approachLight(JW, d);
      box(ctx, '#0b0f16', x - 3, y - 6, 6, 12);
      ['red', 'yellow', 'green'].forEach((c, i) =>
        box(ctx, light === c ? LAMP[c] : '#2b323d', x - 2, y - 5 + i * 4, 4, 3),
      );
    }
  }
}

function paintVehicle(ctx, v, pose, tick, color) {
  ctx.save();
  ctx.translate(Math.round(pose.x), Math.round(pose.y));
  ctx.rotate(Math.atan2(pose.hy, pose.hx));
  const l = v.len;
  const wd = v.wid;
  const hx = l / 2;
  const hy = wd / 2;
  if (v.k === 'bus') {
    box(ctx, '#f2994a', -hx, -hy, l, wd);
    for (let i = -hx + 3; i < hx - 4; i += 4) box(ctx, '#bfe3ff', i, -hy + 1, 2, wd - 2);
    box(ctx, '#2d3748', hx - 3, -hy + 1, 2, wd - 2);
  } else if (v.k === 'truck') {
    box(ctx, '#7a8798', -hx, -hy, l - 8, wd);
    box(ctx, '#c0392b', hx - 8, -hy, 8, wd);
    box(ctx, '#bfe3ff', hx - 3, -hy + 1, 2, wd - 2);
  } else if (v.k === 'amb') {
    box(ctx, '#f4f7fb', -hx, -hy, l, wd);
    box(ctx, '#e5484d', -2, -1, 5, 2);
    box(ctx, '#e5484d', 0, -3, 1, 6);
    box(ctx, tick % 8 < 4 ? '#ff3b3b' : '#3b82ff', -hx + 1, -hy, 3, 2);
    box(ctx, tick % 8 < 4 ? '#3b82ff' : '#ff3b3b', -hx + 1, hy - 2, 3, 2);
    box(ctx, '#2d3748', hx - 3, -hy + 1, 2, wd - 2);
  } else {
    box(ctx, color, -hx, -hy, l, wd);
    box(ctx, '#bfe3ff', hx - 5, -hy + 1, 3, wd - 2);
    box(ctx, '#2d3748', -hx + 2, -hy + 1, 2, wd - 2);
  }
  box(ctx, '#fff3b0', hx - 1, -hy, 1, 1);
  box(ctx, '#fff3b0', hx - 1, hy - 1, 1, 1);
  const m = v.moves[v.mi];
  if (m !== 'S' && tick % 10 < 6) {
    const side = m === 'L' ? -hy : hy - 2;
    box(ctx, '#ffa63d', hx - 2, side, 2, 2);
    box(ctx, '#ffa63d', -hx, side, 2, 2);
  }
  ctx.restore();
}

function drawVehicles(ctx, w, tick) {
  for (const v of w.vehicles) {
    const pose = vehiclePose(w, v);
    paintVehicle(ctx, v, pose, tick, CAR_COLORS[v.id % CAR_COLORS.length]);
    const limit = waitLimit(w.L, v);
    if (v.wait > 3) {
      const f = clamp(v.wait / limit, 0, 1);
      box(ctx, '#0b0f16', pose.x - 7, pose.y - 11, 14, 3);
      box(
        ctx,
        f < 0.5 ? '#3ddc84' : f < 0.8 ? '#ffd23f' : '#ff5a5f',
        pose.x - 6,
        pose.y - 10,
        Math.max(1, Math.round(12 * f)),
        1,
      );
    }
  }
}

function crosswalkSpot(J, d, side) {
  const r = rightOf(OUT[d]);
  const k = side ? 25 : -25;
  return [J.x + OUT[d][0] * 26 + r[0] * k, J.y + OUT[d][1] * 26 + r[1] * k];
}

function drawPeds(ctx, w, tick) {
  const best = {};
  for (const p of w.peds) {
    const J = w.L.junctions[p.jn];
    const a = crosswalkSpot(J, p.d, p.id % 2);
    const b = crosswalkSpot(J, p.d, (p.id + 1) % 2);
    const f = p.st === 'cross' ? clamp(p.tc / RULES.pedCross, 0, 1) : 0;
    const x = a[0] + (b[0] - a[0]) * f;
    const y = a[1] + (b[1] - a[1]) * f;
    box(ctx, '#ffd9a8', x - 1, y - 4, 2, 2);
    box(
      ctx,
      p.id % 3 === 0 ? '#ff7ab6' : p.id % 3 === 1 ? '#7ad7ff' : '#b8ff7a',
      x - 1,
      y - 2,
      2,
      3,
    );
    box(ctx, '#d0d6e0', x - 1 + (tick % 6 < 3 ? 0 : 1), y + 1, 1, 2);
    if (p.st === 'wait') {
      const key = `${p.jn}${p.d}`;
      best[key] = Math.min(best[key] ?? Infinity, w.L.pedMax - (w.t - p.t0));
    }
  }
  for (const [key, left] of Object.entries(best)) {
    const J = w.L.junctions[Number(key[0])];
    const d = Number(key[1]);
    const r = rightOf(OUT[d]);
    const x = J.x + OUT[d][0] * 26 + r[0] * -32;
    const y = J.y + OUT[d][1] * 26 + r[1] * -32;
    box(ctx, '#0b0f16', x - 7, y - 5, 14, 10);
    text(
      ctx,
      String(Math.max(0, Math.ceil(left))),
      x,
      y - 4,
      left < 10 ? '#ff5a5f' : '#ffd23f',
      8,
      'center',
    );
  }
  for (const JW of w.juncs) {
    if (JW.sig.stage !== 'ped') continue;
    const left = Math.max(0, Math.ceil(RULES.pedWalk + RULES.pedFlash - JW.sig.t));
    text(
      ctx,
      left <= RULES.pedFlash ? `${left}` : 'WALK',
      JW.J.x,
      JW.J.y - 4,
      '#3ddc84',
      8,
      'center',
    );
  }
}

function drawHighlight(ctx, s, tick) {
  const line = s.line;
  if (!line || line.kind === 'watch' || tick % 16 > 10) return;
  const js = s.L.junctions;
  const J = js[line.junction];
  if (line.kind === 'select') {
    box(ctx, '#4dd0e1', J.x - 24, J.y - 24, 48, 2);
    box(ctx, '#4dd0e1', J.x - 24, J.y + 22, 48, 2);
    box(ctx, '#4dd0e1', J.x - 24, J.y - 24, 2, 48);
    box(ctx, '#4dd0e1', J.x + 22, J.y - 24, 2, 48);
    return;
  }
  for (const d of line.dirs) {
    const h = [-OUT[d][0], -OUT[d][1]];
    const r = rightOf(h);
    const cx = J.x + OUT[d][0] * 40 + r[0] * 11;
    const cy = J.y + OUT[d][1] * 40 + r[1] * 11;
    const along = d % 2 ? [20, 12] : [12, 20];
    const fat = line.kind === 'ped' ? (d % 2 ? [4, 24] : [24, 4]) : along;
    box(ctx, '#4dd0e1', cx - fat[0], cy - fat[1], fat[0] * 2, 2);
    box(ctx, '#4dd0e1', cx - fat[0], cy + fat[1], fat[0] * 2, 2);
  }
}

function drawHud(ctx, g, env) {
  const s = g.play;
  const w = s.w;
  box(ctx, '#0d1420', 0, 0, 480, RULES.top);
  const name = env.t(s.L.name[0], s.L.name[1]);
  text(ctx, env.t(`${g.level + 1}. ${name}`, `${g.level + 1}. ${name}`), 6, 3, '#ffffff', 11);
  text(
    ctx,
    env.t(
      `Out ${Math.min(w.delivered, w.quota)}/${w.quota}`,
      `放行 ${Math.min(w.delivered, w.quota)}/${w.quota}`,
    ),
    250,
    3,
    '#3ddc84',
    11,
  );
  const left = Math.max(0, Math.ceil(s.L.time - w.t));
  text(
    ctx,
    `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
    330,
    3,
    left < 10 ? '#ff5a5f' : '#9fb0c8',
    11,
  );
  for (let i = 0; i < RULES.lives; i++)
    box(ctx, i < s.strikes ? '#e5484d' : '#2d3748', 394 + i * 14, 4, 10, 10);
  text(ctx, env.t(`Strikes`, `失误`), 388, 3, '#9fb0c8', 11, 'right');
  const delay = w.delivered ? w.delaySum / w.delivered : 0;
  text(
    ctx,
    env.t(
      `Avg delay ${delay.toFixed(1)}s  Longest wait ${w.longest.toFixed(0)}/${s.L.maxWait}s`,
      `平均延误 ${delay.toFixed(1)} 秒  最长等待 ${w.longest.toFixed(0)}/${s.L.maxWait} 秒`,
    ),
    6,
    16,
    '#9fb0c8',
    10,
  );
  box(ctx, '#0d1420', 0, RULES.bottom, 480, 320 - RULES.bottom);
  const line = s.line;
  if (line) {
    const lines = wrapText(env.t(line.en, line.zh), env.t(WRAP_EN, WRAP_ZH));
    lines
      .slice(0, 2)
      .forEach((ln, i) =>
        text(
          ctx,
          ln,
          240,
          RULES.bottom + 3 + i * 13,
          line.kind === 'watch' ? '#9fb0c8' : '#ffffff',
          FONT,
          'center',
        ),
      );
  }
}

function drawMenu(ctx, g, env) {
  background(ctx, '#101b2d');
  text(ctx, env.t('Choose a shift', '选择班次'), 240, 16, '#ffffff', 16, 'center');
  g.levels.forEach((L, i) => {
    const col = i % RULES.menuCols;
    const row = Math.floor(i / RULES.menuCols);
    const open = i < g.menu.unlocked;
    const x = MENU.x + col * MENU.w;
    const y = MENU.y + row * MENU.h;
    box(ctx, i + 1 === g.menu.sel ? '#f2c94c' : '#1f3a5a', x, y, MENU.w - 6, MENU.h - 6);
    box(ctx, open ? '#1f3a5a' : '#1a2230', x + 2, y + 2, MENU.w - 10, MENU.h - 10);
    text(
      ctx,
      String(i + 1),
      x + (MENU.w - 6) / 2,
      y + 11,
      open ? '#ffffff' : '#4a5568',
      14,
      'center',
    );
  });
  const L = g.levels[g.menu.sel - 1];
  text(ctx, env.t(L.name[0], L.name[1]), 240, 246, '#f2c94c', 13, 'center');
  text(
    ctx,
    env.t('Arrows choose, Space starts', '方向键选择，空格开始'),
    240,
    276,
    '#9fb0c8',
    12,
    'center',
  );
}

export function drawGame(ctx, g, env) {
  if (g.menu) {
    drawMenu(ctx, g, env);
    return;
  }
  const s = g.play;
  const w = s.w;
  background(ctx, '#1c2a22');
  const tick = Math.floor(w.t * 20);
  drawRoads(ctx, w);
  drawSignals(ctx, w);
  const sel = s.L.junctions[s.sel];
  for (const [dx, dy] of [
    [-26, -26],
    [24, -26],
    [-26, 24],
    [24, 24],
  ])
    box(ctx, '#f2c94c', sel.x + dx, sel.y + dy, 2, 2);
  drawVehicles(ctx, w, tick);
  drawPeds(ctx, w, tick);
  drawHighlight(ctx, s, tick);
  for (const f of s.flash) {
    const J = s.L.junctions[f.jn];
    if (J && tick % 6 < 4) box(ctx, '#ff5a5f', J.x - 24, J.y - 24, 48, 2);
  }
  drawHud(ctx, g, env);
  const alerts = alertsOf(w);
  if (alerts.length) {
    const a = alerts[0];
    const J = s.L.junctions[a.jn];
    const where =
      s.L.junctions.length > 1
        ? env.t(` at the ${J.name[0]} junction`, `（${J.name[1]}路口）`)
        : '';
    const msg = env.t(
      `Ambulance from the ${DIR_EN[a.d]}${where} in ${a.eta} s`,
      `救护车从${DIR_ZH[a.d]}侧驶来${where}，还有 ${a.eta} 秒`,
    );
    box(ctx, tick % 8 < 4 ? '#7a1f24' : '#1f3a7a', 90, 29, 300, 13);
    text(ctx, msg, 240, 30, '#ffffff', 10, 'center');
  }
  if (s.msg.age < s.msg.dur || g.clear > 0) {
    const width = env.t(WRAP_EN, WRAP_ZH);
    const head = wrapText(env.t(s.msg.en, s.msg.zh), width);
    const tip = s.msg.tip ? wrapText(env.t(s.msg.tip[0], s.msg.tip[1]), width) : [];
    box(ctx, '#0d1420', 16, 46, 448, 6 + (head.length + tip.length) * BANNER_LINE);
    head.forEach((ln, i) => text(ctx, ln, 240, 49 + i * BANNER_LINE, '#ffffff', FONT, 'center'));
    tip.forEach((ln, i) =>
      text(ctx, ln, 240, 49 + (head.length + i) * BANNER_LINE, '#9fb0c8', FONT, 'center'),
    );
  }
}

// LEVELS-BEGIN
// Level data is authored; each run draws a seeded schedule that the controller is checked against.
const T = (en, zh) => [en, zh];
export const LEVELS = [
  {
    name: T('Quiet Crossroads', '清静的十字路口'),
    tip: T(
      'Space gives the other road the green. Let a queue clear, then switch.',
      '按空格让另一条路通行。放完一队车再切换。',
    ),
    layout: 'single',
    plan: 'two',
    time: 50,
    rates: [[8, 8, 8, 8]],
    turns: [[1, 0, 0]],
    mix: [1, 0, 0],
    maxWait: 30,
    frac: 0.8,
    seed: 1,
  },
  {
    name: T('Four Ways', '四向路口'),
    tip: T('Cars now turn: the blinker shows which way they go.', '车辆开始转弯，转向灯显示去向。'),
    layout: 'single',
    plan: 'two',
    time: 55,
    rates: [[10, 10, 10, 10]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [1, 0, 0],
    maxWait: 26,
    frac: 0.8,
    seed: 2,
  },
  {
    name: T('Main Street', '主干道'),
    tip: T(
      'Traffic surges on one road at a time, and a siren may sound: give the busy road its green and clear the way for ambulances.',
      '车流会涌向某一条路，还可能响起警笛：给繁忙的路放行，并为救护车让路。',
    ),
    layout: 'single',
    plan: 'two',
    time: 62,
    rates: [[5, 5, 5, 5]],
    turns: [[0.75, 0.12, 0.13]],
    mix: [1, 0, 0],
    maxWait: 32,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 26, mult: 5, axes: 'any' }],
    tail: 12,
    emerg: [
      [16, 0, -1],
      [34, 0, -1],
      [52, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 6,
  },
  {
    name: T('Short Arms', '短引道'),
    tip: T(
      'The north and south roads are short: a long queue spills off the map. Ambulances need a clear road.',
      '南北向引道很短，排长了会溢出地图。救护车需要畅通的道路。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [1, 0, 0],
    cap: { '0N': 60, '0S': 60 },
    maxWait: 30,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 26, mult: 5, axes: 'any' }],
    tail: 12,
    emerg: [
      [18, 0, -1],
      [36, 0, -1],
      [54, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 9,
  },
  {
    name: T('Left Turn Gap', '左转的空档'),
    tip: T(
      'A left-turner waits for a gap in the oncoming cars and blocks the lane behind it.',
      '左转车要等对向车流的空档，会堵住后面的车。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[5, 5, 5, 5]],
    turns: [[0.5, 0.4, 0.1]],
    mix: [1, 0, 0],
    maxWait: 34,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 24, mult: 3, axes: 'any' }],
    emerg: [
      [24, 0, -1],
      [46, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 3,
  },
  {
    name: T('T-Junction', 'T 形路口'),
    tip: T(
      'Three roads meet here: the east road crosses the main road and its left turns cut across two streams. Ambulances need a clear road.',
      '三条路交汇：东侧道路汇入主路，左转要穿过两股车流。救护车需要畅通的道路。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[7, 8, 7, 0]],
    turns: [[0.4, 0.4, 0.2]],
    mix: [1, 0, 0],
    maxWait: 30,
    frac: 0.88,
    emerg: [
      [20, 0, -1],
      [40, 0, -1],
      [58, 0, -1],
    ],
    emgWait: 3.5,
    arms: ['NES'],
    ambJitter: 5,
    pulses: [{ at: [6, 16], len: 26, mult: 4, axes: 'any' }],
    seed: 3,
  },
  {
    name: T('Mixed Fleet', '混合车队'),
    tip: T(
      'Buses and trucks are long and slow to start: they take more of the green.',
      '公交车和卡车又长又慢，占用更多绿灯。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [0.6, 0.2, 0.2],
    maxWait: 34,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 24, mult: 3, axes: 'any' }],
    emerg: [
      [16, 0, -1],
      [34, 0, -1],
      [52, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 4,
  },
  {
    name: T('Zebra Crossing', '斑马线'),
    tip: T(
      'Press X to stop all traffic for pedestrians. Watch the countdown signs.',
      '按 X 拦停所有车辆让行人过街，留意倒计时牌。',
    ),
    layout: 'single',
    plan: 'two',
    time: 75,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [1, 0, 0],
    peds: [{ jn: 0, rate: 5 }],
    pedMax: 38,
    maxWait: 44,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 24, mult: 2.5, axes: 'any' }],
    emerg: [
      [17, 0, -1],
      [37, 0, -1],
      [57, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 4,
    seed: 5,
  },
  {
    name: T('School Run', '放学时刻'),
    tip: T(
      'Crowds of pupils gather at once. Walk them across before the signs hit zero.',
      '学生成群到来，倒计时归零前让他们过街。',
    ),
    layout: 'single',
    plan: 'two',
    time: 75,
    rates: [[7, 7, 7, 7]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [1, 0, 0],
    peds: [
      {
        jn: 0,
        rate: 0,
        bursts: [
          [10, 5],
          [34, 5],
          [58, 5],
        ],
      },
    ],
    pedMax: 30,
    maxWait: 36,
    frac: 0.8,
    pedJitter: 6,
    pulses: [{ at: [6, 16], len: 24, mult: 2, axes: 'any' }],
    emerg: [
      [22, 0, -1],
      [48, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 28,
  },
  {
    name: T('Bus Priority', '公交优先'),
    tip: T(
      'Buses carry many riders and may not wait long. Give them the green early.',
      '公交车载客多，不能久等，要尽早放行。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [0.55, 0.45, 0],
    maxWait: 34,
    busWait: 18,
    frac: 0.92,
    pulses: [{ at: [6, 16], len: 28, mult: 3.5, axes: 'any' }],
    emerg: [
      [22, 0, -1],
      [48, 0, -1],
    ],
    ambJitter: 5,
    emgWait: 3,
    seed: 3,
  },
  {
    name: T('Ambulance', '救护车'),
    tip: T(
      'A siren alert counts down. Clear the queue on its road before it arrives.',
      '警报倒计时，要在它到达前清空那条路的队伍。',
    ),
    layout: 'single',
    plan: 'two',
    time: 66,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [0.85, 0.15, 0],
    emerg: [
      [14, 0, -1],
      [30, 0, -1],
      [50, 0, -1],
    ],
    emgWait: 3,
    maxWait: 28,
    frac: 0.85,
    ambJitter: 5,
    pulses: [{ at: [6, 16], len: 24, mult: 3, axes: 'any' }],
    seed: 4,
  },
  {
    name: T('Siren Alley', '警笛巷'),
    tip: T(
      'Ambulances, a zebra and a bus lane: keep everyone inside their wait limit.',
      '救护车、斑马线和公交车齐上阵，别让任何人超时。',
    ),
    layout: 'single',
    plan: 'two',
    time: 75,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [0.8, 0.12, 0.08],
    emerg: [
      [15, 0, -1],
      [33, 0, -1],
      [51, 0, -1],
      [67, 0, -1],
    ],
    peds: [{ jn: 0, rate: 4 }],
    pedMax: 26,
    emgWait: 5,
    busWait: 24,
    maxWait: 40,
    frac: 0.8,
    ambJitter: 5,
    pulses: [{ at: [6, 16], len: 22, mult: 2.5, axes: 'any' }],
    seed: 7,
  },
  {
    name: T('Rush Hour', '早高峰'),
    tip: T(
      'Traffic surges east-west first, then north-south. Follow the wave.',
      '车流先涌向东西向，再涌向南北向，跟着浪潮调度。',
    ),
    layout: 'single',
    plan: 'two',
    time: 78,
    rates: [[5, 5, 5, 5]],
    turns: [[0.7, 0.15, 0.15]],
    mix: [0.8, 0.1, 0.1],
    surge: [],
    maxWait: 32,
    frac: 0.92,
    emerg: [
      [22, 0, -1],
      [48, 0, -1],
    ],
    emgWait: 5,
    pulses: [
      { at: [4, 10], len: 24, mult: 4, axes: 'any' },
      { at: [38, 46], len: 24, mult: 4, axes: 'any' },
    ],
    ambJitter: 5,
    seed: 23,
  },
  {
    name: T('Two Junctions', '双路口'),
    tip: T(
      'Arrows select a junction. Cars leaving one junction arrive at the next.',
      '用方向键选择路口，驶出一个路口的车会到达下一个路口。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 70,
    rates: [
      [6, 0, 6, 9],
      [6, 9, 6, 0],
    ],
    turns: [[0.8, 0.1, 0.1]],
    mix: [1, 0, 0],
    maxWait: 34,
    frac: 0.85,
    emerg: [
      [18, 0, -1],
      [34, 1, -1],
      [52, 0, -1],
    ],
    emgWait: 5,
    ambJitter: 5,
    pulses: [{ at: [8, 20], len: 22, mult: 2, axes: 'any' }],
    seed: 1,
  },
  {
    name: T('Green Wave', '绿波'),
    tip: T(
      'Cars travel in platoons. Open the next junction just as a platoon arrives.',
      '车辆成队行驶，车队到达时恰好放行下一个路口。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 75,
    rates: [
      [4, 0, 4, 12],
      [4, 12, 4, 0],
    ],
    platoon: 3,
    turns: [[0.88, 0.06, 0.06]],
    mix: [0.8, 0.2, 0],
    maxWait: 32,
    frac: 0.85,
    emerg: [
      [24, 0, -1],
      [40, 1, -1],
      [58, 0, -1],
    ],
    emgWait: 5,
    ambJitter: 5,
    seed: 5,
  },
  {
    name: T('Spillback', '排队回溢'),
    tip: T(
      'Do not feed a full link: a vehicle only enters when there is room to clear the box.',
      '路段排满时不要再放行：车辆必须有空间驶出路口才会进入。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 75,
    rates: [
      [6, 0, 6, 9],
      [6, 9, 6, 0],
    ],
    turns: [[0.8, 0.1, 0.1]],
    mix: [0.8, 0.1, 0.1],
    cap: { '0N': 70, '0S': 70, '1N': 70, '1S': 70 },
    maxWait: 34,
    frac: 0.85,
    emerg: [
      [28, 1, -1],
      [44, 0, -1],
      [58, 1, -1],
    ],
    emgWait: 5,
    ambJitter: 5,
    pulses: [{ at: [8, 20], len: 22, mult: 2, axes: 'any' }],
    seed: 1,
  },
  {
    name: T('Linked Lefts', '联动左转'),
    tip: T(
      'Both junctions run a phase per road. Plan the order across the link.',
      '两个路口都按单条道路分相位，要统筹联动顺序。',
    ),
    layout: 'row2',
    plan: ['split', 'split'],
    time: 100,
    rates: [
      [4, 0, 4, 6],
      [4, 6, 4, 0],
    ],
    turns: [[0.55, 0.3, 0.15]],
    mix: [0.8, 0.2, 0],
    maxWait: 64,
    frac: 0.78,
    emerg: [
      [24, 1, -1],
      [46, 0, -1],
      [68, 1, -1],
    ],
    emgWait: 4.5,
    busWait: 56,
    ambJitter: 6,
    seed: 40,
  },
  {
    name: T('Market Day', '集市日'),
    tip: T(
      'Shoppers cross both junctions while buses keep to their timetable.',
      '购物的人流穿过两个路口，公交车还要准点。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 80,
    rates: [
      [4, 0, 4, 6],
      [4, 6, 4, 0],
    ],
    turns: [[0.75, 0.12, 0.13]],
    mix: [0.75, 0.2, 0.05],
    peds: [
      { jn: 0, rate: 2 },
      { jn: 1, rate: 2 },
    ],
    pedMax: 44,
    busWait: 32,
    maxWait: 44,
    frac: 0.8,
    emerg: [
      [24, 1, -1],
      [44, 0, -1],
      [64, 1, -1],
    ],
    emgWait: 5,
    ambJitter: 5,
    pulses: [{ at: [8, 20], len: 22, mult: 2, axes: 'any' }],
    seed: 15,
  },
  {
    name: T('Emergency Corridor', '救援通道'),
    tip: T(
      'Ambulances cross both junctions. Open the whole corridor for them.',
      '救护车要连续穿过两个路口，把整条通道打开。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 80,
    rates: [
      [5, 0, 5, 7],
      [5, 7, 5, 0],
    ],
    turns: [[0.8, 0.1, 0.1]],
    mix: [0.7, 0.2, 0.1],
    emerg: [
      [16, 0, -1],
      [34, 1, -1],
      [52, 0, -1],
      [68, 1, -1],
    ],
    emgWait: 5,
    busWait: 20,
    maxWait: 32,
    frac: 0.85,
    ambJitter: 5,
    pulses: [{ at: [8, 20], len: 22, mult: 2, axes: 'any' }],
    seed: 8,
  },
  {
    name: T('Grand Rush Hour', '大高峰'),
    tip: T(
      'Surges, buses, ambulances and pupils across two junctions. Conduct it all.',
      '车流高峰、公交车、救护车和学生同时出现，全部交给你。',
    ),
    layout: 'row2',
    plan: 'two',
    time: 100,
    rates: [
      [4, 0, 4, 7],
      [4, 7, 4, 0],
    ],
    turns: [[0.72, 0.14, 0.14]],
    mix: [0.65, 0.2, 0.15],
    surge: [],
    emerg: [
      [24, 0, -1],
      [48, 1, -1],
      [72, 0, -1],
    ],
    peds: [
      { jn: 0, rate: 2 },
      { jn: 1, rate: 2 },
    ],
    pedMax: 46,
    emgWait: 6,
    busWait: 38,
    maxWait: 72,
    frac: 0.74,
    ambJitter: 5,
    pulses: [
      { at: [6, 16], len: 22, mult: 2, axes: 'any' },
      { at: [46, 56], len: 22, mult: 2, axes: 'any' },
    ],
    seed: 1,
  },
];
// LEVELS-END
const BUILT = LEVELS.map((def, i) => compileLevel(def, i));
export const LEVEL_COUNT = BUILT.length;
export const COMPILED = BUILT;
