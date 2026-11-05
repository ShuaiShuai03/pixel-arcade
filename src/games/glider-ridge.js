import { clamp, background, drawPixelText as text } from '../shared/utils.js';

export const meta = {
  id: 'glider-ridge',
  name: { en: 'Glider Ridge', zh: '滑翔山脊' },
  genre: 'sports',
  players: '1',
  touch: true,
  description: {
    en: 'Fly a motorless fabric glider through three ridge courses. Gates must be passed in order, then land on the marked pad. Pitch trades altitude for speed; pull too far and the wing stalls. Thermals and ridge lift are the only energy sources, crosswinds push you sideways, and a flare slows you for touchdown. A hard landing or terrain strike costs one of three attempts per course.',
    zh: '驾驶无动力织物滑翔翼飞越三条山脊赛道：依次穿过检查门，再降落在标记的着陆台上。俯仰可用高度换速度，拉得过猛机翼会失速。只有热气流和山脊上升气流能补充能量，侧风会把你吹偏，拉平可在触地前减速。硬着陆或撞山会消耗该赛道三次机会之一。',
  },
  keys: [
    { label: { en: 'Pitch: nose up / nose down', zh: '俯仰：抬头 / 低头' }, keys: 'Up Down / W S' },
    {
      label: { en: 'Bank and steer left / right', zh: '向左 / 向右倾斜转向' },
      keys: 'Left Right / A D',
    },
    {
      label: { en: 'Hold to flare (slow for landing)', zh: '按住拉平（着陆减速）' },
      keys: 'Space',
    },
  ],
  touchControls: [
    ['ArrowUp', 'Nose up', '抬头', 'left'],
    ['ArrowDown', 'Nose down', '低头', 'left'],
    ['ArrowLeft', 'Bank left', '左倾', 'right'],
    ['ArrowRight', 'Bank right', '右倾', 'right'],
    ['Space', 'Flare', '拉平', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

export const PHYSICS = Object.freeze({
  step: 1 / 240,
  gravity: 9.8,
  liftDrag: 0.0235,
  liftSlope: 5,
  criticalAlpha: 0.26,
  maxLift: 1.3,
  stalledLift: 0.62,
  parasiteDrag: 0.05,
  inducedDrag: 0.06,
  trimAlpha: 0.1,
  flareAlpha: 0.235,
  maxBank: 0.85,
  safeSink: 7,
  safeSpeed: 26,
  perfectSink: 1.8,
  perfectSpeed: 19.5,
  attempts: 3,
});
const P = PHYSICS;
const STEP = P.step,
  G = P.gravity,
  WALL = 9999,
  MAX_DT = 0.1,
  GATE_LOW = 45,
  GATE_HIGH = 80,
  STALL_DROP = 0.08,
  ELEV_UP = 0.2,
  ELEV_DOWN = 0.1,
  LAUNCH_SPEED = 24,
  HOLD_SECONDS = 2.2,
  MIN_SKIP_SECONDS = 0.8,
  MESSAGE_SECONDS = 2.4,
  FLARE_WINDOW = 14,
  TRIM_ALPHA = 0.144,
  TRIM_SPEED = 24,
  SPEED_STABILITY = 0.006,
  FLARE_LOAD = 1.15,
  FLARE_SINK_BASE = 0.8,
  FLARE_SINK_GAIN = 0.12,
  FLARE_K = 0.05,
  FLARE_LEVEL = 0.3,
  FLARE_HEADING = 0.6,
  REDO_AIM = 0.5,
  REDO_STEER = 0.2,
  DESCEND_GATE_GAP = 250,
  DESCEND_KEEP_GAP = 150,
  DESCEND_MIN_AGL = 90,
  CIRCLE_MIN_AGL = 60,
  FAST_ALPHA_MAX = 0.2,
  FAST_COOLDOWN = 2.5,
  FAST_ON = 27,
  FAST_OFF = 24,
  EDGE_Z = 70,
  EDGE_X = 120,
  EDGE_CLEAR = 40,
  FLARE_CLEAR = 30,
  HINT_STEP = 0.1,
  HINT_DWELL = 0.4,
  STEER_BAND = 0.16,
  STEER_END = 0.06,
  URGENT = ['stall', 'warn', 'edge', 'flare'],
  MISSED_BEHIND = 15,
  BANK_PULL = 0.05,
  GATE_SCORE = 100;
const ridge = (x0, x1, w, depth) => ({ x0, x1, w, depth });
const thermal = (x, z, rx, rz, w, top) => ({ x, z, rx, rz, w, top });
const gate = (x, z, h, hw, lo = GATE_LOW, hi = GATE_HIGH) => ({ x, z, h, hw, lo, hi });
const COURSE_DATA = [
  {
    name: { en: 'Warm-up Spur', zh: '热身山脊' },
    brief: {
      en: 'Ride ridge lift, land on the meadow.',
      zh: '借山脊上升气流，降落到草甸。',
    },
    xmin: -200,
    xmax: 2040,
    half: 260,
    snow: 230,
    palette: ['#f4b7a0', '#f7d6a8', '#9fc7da'],
    terrain: [
      [-200, 1500],
      [-60, 330],
      [40, 300],
      [220, 200],
      [420, 150],
      [560, 175],
      [700, 235],
      [760, 240],
      [900, 150],
      [1100, 90],
      [1330, 80],
      [1480, 160],
      [2000, 160],
      [2040, 1500],
    ],
    start: { x: 0, z: 0, h: 345 },
    gates: [gate(330, 0, 290, 80), gate(800, 0, 285, 80), gate(1180, 0, 225, 80)],
    zone: { x0: 1500, x1: 1900, z: 0, hw: 70 },
    wind: [{ x0: -200, x1: 1800, wx: -3, wz: 0 }],
    ridges: [ridge(770, 960, 5, 110)],
    thermals: [thermal(520, 60, 125, 125, 10, 430)],
    socks: [200, 700, 1300],
  },
  {
    name: { en: 'Saddle Crossing', zh: '鞍部穿越' },
    brief: {
      en: 'Use thermals; crab into the wind.',
      zh: '热气流补高度；侧风需修正航向。',
    },
    xmin: -200,
    xmax: 2680,
    half: 260,
    snow: 260,
    palette: ['#9fb8e0', '#cfe3f2', '#e6e2c8'],
    terrain: [
      [-200, 1500],
      [-60, 360],
      [60, 330],
      [300, 230],
      [560, 200],
      [800, 280],
      [1000, 210],
      [1400, 170],
      [1600, 230],
      [1700, 160],
      [1800, 100],
      [1920, 95],
      [2030, 170],
      [2600, 170],
      [2680, 1500],
    ],
    start: { x: 0, z: 0, h: 380 },
    gates: [
      gate(420, 0, 320, 70),
      gate(900, 20, 340, 70),
      gate(1400, -20, 300, 70),
      gate(1700, 0, 248, 70),
    ],
    zone: { x0: 2040, x1: 2500, z: 0, hw: 55 },
    wind: [{ x0: 790, x1: 1060, wx: -2, wz: 7 }],
    ridges: [],
    thermals: [thermal(640, 60, 125, 125, 8, 520), thermal(1180, 60, 125, 125, 8, 520)],
    socks: [200, 900, 1500, 2000],
  },
  {
    name: { en: 'Needle Crest', zh: '针峰山脊' },
    brief: {
      en: 'Lee sink, gusts, a small shelf pad.',
      zh: '背风下沉、阵侧风，着陆台很小。',
    },
    xmin: -200,
    xmax: 3030,
    half: 260,
    snow: 200,
    palette: ['#c9a0d8', '#f1c6a0', '#7fa6c8'],
    terrain: [
      [-200, 1500],
      [-60, 420],
      [80, 380],
      [350, 300],
      [700, 360],
      [900, 280],
      [1300, 260],
      [1500, 200],
      [1750, 200],
      [1900, 170],
      [2000, 80],
      [2150, 75],
      [2320, 150],
      [2950, 150],
      [3030, 1500],
    ],
    start: { x: 0, z: 0, h: 440 },
    gates: [
      gate(400, 0, 400, 60),
      gate(950, -25, 380, 60),
      gate(1450, 25, 300, 60),
      gate(1800, 0, 245, 60),
      gate(2050, 0, 221, 60),
    ],
    zone: { x0: 2320, x1: 2800, z: 0, hw: 45 },
    wind: [
      { x0: 820, x1: 1000, wx: -3, wz: -8 },
      { x0: 1380, x1: 1520, wx: -3, wz: 8 },
      { x0: 1790, x1: 1990, wx: -3, wz: -7 },
    ],
    ridges: [ridge(640, 820, -2, 140), ridge(1220, 1400, -2, 140)],
    thermals: [thermal(560, 60, 125, 125, 8, 640), thermal(1100, 45, 125, 125, 8, 700)],
    socks: [150, 900, 1450, 1900, 2350],
  },
];
export const COURSES = COURSE_DATA;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const toward = (v, target, rate) => v + clamp(target - v, -rate, rate);

export function terrainAt(c, x, z = 0) {
  if (x < c.xmin || x > c.xmax || Math.abs(z) > c.half) return WALL;
  const t = c.terrain;
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, h0] = t[i - 1],
        [x1, h1] = t[i];
      return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}
const zoneWeight = (x, x0, x1, edge = 40) => smooth((x - x0) / edge) * smooth((x1 - x) / edge);
export function windAt(c, x, z, h) {
  const w = { x: 0, z: 0, h: 0 };
  for (const zone of c.wind) {
    const k = zoneWeight(x, zone.x0, zone.x1, 60);
    w.x += zone.wx * k;
    w.z += zone.wz * k;
  }
  for (const r of c.ridges) {
    const agl = h - terrainAt(c, x, 0);
    w.h += r.w * zoneWeight(x, r.x0, r.x1, 30) * clamp(1 - agl / r.depth, 0, 1) ** 2;
  }
  for (const t of c.thermals) {
    const r2 = ((x - t.x) / t.rx) ** 2 + ((z - t.z) / t.rz) ** 2;
    if (r2 < 1 && h < t.top) w.h += t.w * (1 - r2 * r2) * clamp((t.top - h) / 40, 0, 1);
  }
  return w;
}
export const liftCoefficient = (alpha, stalled) => {
  const cl = clamp(P.liftSlope * alpha, -1.5, P.maxLift);
  return stalled ? Math.min(cl, P.stalledLift) : cl;
};

function launch(s, spawn, gateIndex) {
  const speed = LAUNCH_SPEED,
    glide = -0.1;
  Object.assign(s, {
    x: spawn.x,
    z: spawn.z,
    h: spawn.h,
    vx: speed * Math.cos(glide),
    vz: 0,
    vh: speed * Math.sin(glide),
    heading: 0,
    alpha: P.trimAlpha,
    elev: 0,
    bank: 0,
    stalled: false,
    stallWarn: false,
    flare: false,
    gate: gateIndex + 1,
    acc: 0,
    hintClock: 0,
    hint: { circle: null, flare: false, edge: false, fast: false, id: null, since: 0 },
  });
  s.camX = s.x - 200;
  s.camH = s.h;
  s.energy.last = null;
}
export function createGliderState(courseIndex = 0, score = 0) {
  const c = COURSES[courseIndex];
  const s = {
    phase: 'playing',
    course: courseIndex,
    score,
    attempts: P.attempts,
    time: 0,
    timer: 0,
    gate: 0,
    checkpoint: -1,
    gatesMissed: 0,
    crashes: 0,
    landing: null,
    message: null,
    energy: { specific: 0, dissipated: 0, airGain: 0, last: null },
    events: [],
  };
  launch(s, c.start, -1);
  return s;
}
const speedState = (s) => {
  const c = COURSES[s.course],
    w = windAt(c, s.x, s.z, s.h),
    air = { x: s.vx - w.x, z: s.vz - w.z, h: s.vh - w.h };
  return { c, w, air, speed: Math.hypot(air.x, air.z, air.h) };
};
const say = (s, en, zh) => {
  s.message = { en, zh, timer: MESSAGE_SECONDS };
};
const emit = (s, name) => s.events.push(name);

function flightStep(s, ctl) {
  const { c, w, air } = speedState(s);
  let ax = air.x,
    az = air.z,
    ah = air.h,
    V = Math.hypot(ax, az, ah);
  if (V < 1e-3) {
    ah = -1e-3;
    V = 1e-3;
  }
  const horizontal = Math.hypot(ax, az),
    psi = horizontal > 1e-6 ? Math.atan2(az, ax) : s.heading,
    gamma = Math.atan2(ah, horizontal),
    energyStart = G * s.h + 0.5 * V * V;
  if (s.energy.last !== null) s.energy.airGain += energyStart - s.energy.last;
  s.heading = psi;
  s.elev = toward(
    s.elev,
    ctl.pitch,
    (ctl.pitch === 0 || ctl.pitch * s.elev < 0 ? 2.5 : 1.4) * STEP,
  );
  s.bank = toward(s.bank, ctl.steer * P.maxBank, 1.6 * STEP);
  s.flare = ctl.flare;
  let command =
    TRIM_ALPHA +
    SPEED_STABILITY * (V - TRIM_SPEED) +
    (s.elev > 0 ? s.elev * ELEV_UP : s.elev * ELEV_DOWN);
  command += BANK_PULL * Math.min(1, Math.abs(s.bank) / P.maxBank);
  if (ctl.flare) {
    // Flare law: back-pressure follows a sink-rate schedule that shrinks toward the ground.
    const agl = Math.max(0, s.h - terrainAt(c, s.x, s.z)),
      target = -(FLARE_SINK_BASE + FLARE_SINK_GAIN * agl),
      limit = Math.min(
        P.flareAlpha,
        Math.max(P.trimAlpha, (FLARE_LOAD * G) / (P.liftDrag * V * V * P.liftSlope)),
      );
    command = clamp(P.trimAlpha + FLARE_K * (target - s.vh), P.trimAlpha, limit);
  }
  if (s.stalled) command -= STALL_DROP;
  const tau = 0.35 * clamp(22 / V, 0.6, 3);
  s.alpha += (command - s.alpha) * (1 - Math.exp(-STEP / tau));
  if (s.alpha > P.criticalAlpha) s.stalled = true;
  else if (s.alpha < P.criticalAlpha * 0.75) s.stalled = false;
  s.stallWarn = !s.stalled && !ctl.flare && s.alpha > P.criticalAlpha * 0.86;
  const cl = liftCoefficient(s.alpha, s.stalled),
    cd =
      P.parasiteDrag +
      P.inducedDrag * cl * cl +
      (ctl.flare ? 0.05 : 0) +
      (s.stalled ? 0.04 + 0.9 * Math.sin(s.alpha) ** 2 : 0),
    q = P.liftDrag * V * V,
    cg = Math.cos(gamma),
    sg = Math.sin(gamma),
    cp = Math.cos(psi),
    sp = Math.sin(psi),
    cb = Math.cos(s.bank),
    sb = Math.sin(s.bank),
    lift = q * cl;
  const ah0 = ah;
  ah -= (G * STEP) / 2;
  const kicked = Math.hypot(ax, az, ah);
  ax += (cb * -sg * cp + sb * -sp) * lift * STEP;
  az += (cb * -sg * sp + sb * cp) * lift * STEP;
  ah += cb * cg * lift * STEP;
  const turned = Math.hypot(ax, az, ah) || 1;
  ax *= kicked / turned;
  az *= kicked / turned;
  ah *= kicked / turned;
  const slowed = Math.max(0, kicked - q * cd * STEP),
    ratio = kicked > 0 ? slowed / kicked : 0;
  ax *= ratio;
  az *= ratio;
  ah *= ratio;
  s.energy.dissipated += 0.5 * (kicked * kicked - slowed * slowed);
  s.x += (ax + w.x) * STEP;
  s.z += (az + w.z) * STEP;
  ah -= (G * STEP) / 2;
  s.h += ((ah + ah0) / 2 + w.h) * STEP;
  s.vx = ax + w.x;
  s.vz = az + w.z;
  s.vh = ah + w.h;
  const energyEnd = G * s.h + 0.5 * (ax * ax + az * az + ah * ah);
  s.energy.airGain += energyEnd - energyStart + 0.5 * (kicked * kicked - slowed * slowed);
  s.energy.last = energyEnd;
  s.energy.specific = energyEnd;
  s.pitch = Math.atan2(ah, Math.hypot(ax, az)) + s.alpha;
  return c;
}

function crossGate(s, c, prevX, prevZ, prevH) {
  const g = c.gates[s.gate];
  if (!g) return;
  const crossed = (prevX < g.x && s.x >= g.x) || (prevX > g.x && s.x <= g.x);
  if (!crossed) return;
  const t = (g.x - prevX) / (s.x - prevX),
    z = prevZ + (s.z - prevZ) * t,
    h = prevH + (s.h - prevH) * t;
  const lateral = Math.abs(z - g.z) <= g.hw,
    low = h < g.h - g.lo,
    high = h > g.h + g.hi;
  if (lateral && !low && !high) {
    s.score += GATE_SCORE;
    s.checkpoint = s.gate;
    s.gate++;
    say(s, `Gate ${s.gate}/${c.gates.length} passed`, `第 ${s.gate}/${c.gates.length} 门通过`);
    emit(s, 'gate');
    return;
  }
  s.gatesMissed++;
  if (!lateral) say(s, 'Missed gate: off line', '漏门：偏离航线');
  else if (low) say(s, 'Missed gate: too low', '漏门：高度太低');
  else say(s, 'Missed gate: too high', '漏门：高度太高');
  emit(s, 'miss');
}

const finishAttempt = (s, kind, en, zh) => {
  s.crashes++;
  s.attempts--;
  s.landing = { ...s.landing, kind, points: 0 };
  s.message = { en, zh, timer: HOLD_SECONDS };
  emit(s, 'crash');
  s.phase = s.attempts > 0 ? 'crashed' : 'lost';
  s.timer = 0;
  if (s.phase === 'lost') emit(s, 'lose');
};

function touchdown(s, c, ground) {
  const slope = (terrainAt(c, s.x + 1, s.z) - terrainAt(c, s.x - 1, s.z)) / 2,
    norm = Math.sqrt(1 + slope * slope),
    sink = Math.max(0, -(-slope * s.vx + s.vh) / norm),
    gs = Math.hypot(s.vx, s.vz),
    zone = c.zone,
    inZone = s.x >= zone.x0 && s.x <= zone.x1 && Math.abs(s.z - zone.z) <= zone.hw;
  s.h = ground < WALL ? ground : s.h;
  s.landing = { x: s.x, z: s.z, sink, speed: gs, stalled: s.stalled, inZone, kind: '', points: 0 };
  if (ground >= WALL) {
    return finishAttempt(s, 'wall', 'Ridge wall strike', '撞上山壁');
  }
  const reason =
    sink > P.safeSink
      ? ['sink', 'Hard landing: sinking too fast', '硬着陆：下沉太快']
      : gs > P.safeSpeed
        ? ['speed', 'Hard landing: touched down too fast', '硬着陆：触地速度太快']
        : s.stalled
          ? ['stall', 'Hard landing: wing stalled', '硬着陆：机翼失速']
          : Math.abs(slope) > 0.25
            ? ['slope', 'Hard landing: steep slope', '硬着陆：坡面太陡']
            : null;
  if (reason) {
    s.landing.reason = reason[0];
    return finishAttempt(s, 'hard', reason[1], reason[2]);
  }
  if (!inZone) {
    return finishAttempt(s, 'outlanding', 'Outlanding: miss the pad', '野外迫降：偏离着陆台');
  }
  if (s.gate < c.gates.length) {
    return finishAttempt(
      s,
      'incomplete',
      `Gate ${s.gate + 1} was skipped`,
      `第 ${s.gate + 1} 门漏掉了`,
    );
  }
  const mid = (zone.x0 + zone.x1) / 2,
    off = Math.min(
      1,
      Math.hypot((s.x - mid) / ((zone.x1 - zone.x0) / 2), (s.z - zone.z) / zone.hw),
    ),
    positionPoints = Math.round(150 * (1 - off)),
    softPoints = Math.round(150 * clamp((P.safeSink - sink) / (P.safeSink - P.perfectSink), 0, 1)),
    points = 200 + positionPoints + softPoints + 50 * s.attempts;
  s.score += points;
  s.landing.kind = 'safe';
  s.landing.points = points;
  s.landing.perfect = sink <= P.perfectSink && gs <= P.perfectSpeed;
  s.timer = 0;
  s.vx = s.vz = s.vh = 0;
  if (s.course === COURSES.length - 1) {
    s.phase = 'won';
    say(s, 'All three ridges flown!', '三条山脊全部飞完！');
    emit(s, 'win');
  } else {
    s.phase = 'landed';
    say(s, `Pad touched: +${points}`, `准确着陆：+${points}`);
    emit(s, 'coin');
  }
}

function updateCamera(s) {
  const lerp = 1 - Math.exp(-4 * STEP);
  s.camX += (s.x + 0.6 * s.vx - 200 - s.camX) * lerp;
  s.camH += (s.h - s.camH) * lerp;
}

function advance(s, ctl) {
  s.timer += STEP;
  const ready = s.timer >= HOLD_SECONDS || (ctl.confirm && s.timer >= MIN_SKIP_SECONDS);
  if (!ready) return;
  if (s.phase === 'landed') {
    const next = createGliderState(s.course + 1, s.score);
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, next);
    return emit(s, 'move');
  }
  const gateIndex = s.checkpoint,
    spawn =
      gateIndex < 0
        ? COURSES[s.course].start
        : {
            ...COURSES[s.course].gates[gateIndex],
            x: COURSES[s.course].gates[gateIndex].x + 3,
            h: COURSES[s.course].gates[gateIndex].h,
          };
  launch(s, spawn, gateIndex);
  s.phase = 'playing';
  s.timer = 0;
  s.landing = null;
}

export function stepGlider(s, dt, input) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_DT || s.phase === 'won' || s.phase === 'lost')
    return;
  s.acc += dt;
  const count = Math.floor(s.acc / STEP + 1e-9);
  if (count < 1) return;
  s.acc = Math.max(0, s.acc - count * STEP);
  const held = (...k) => input.held(...k),
    ctl = {
      pitch: (held('ArrowUp', 'KeyW') ? 1 : 0) - (held('ArrowDown', 'KeyS') ? 1 : 0),
      steer: (held('ArrowLeft', 'KeyA') ? 1 : 0) - (held('ArrowRight', 'KeyD') ? 1 : 0),
      flare: Boolean(held('Space')),
      confirm: Boolean(input.pressed('Space', 'Enter')),
    };
  for (let i = 0; i < count && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    s.time += STEP;
    if (s.message) {
      s.message.timer -= STEP;
      if (s.message.timer <= 0 && s.phase === 'playing') s.message = null;
    }
    if (s.phase !== 'playing') {
      advance(s, i === 0 ? ctl : { confirm: false });
      continue;
    }
    const px = s.x,
      pz = s.z,
      ph = s.h,
      c = flightStep(s, ctl);
    crossGate(s, c, px, pz, ph);
    s.hintClock += STEP;
    if (s.hintClock >= HINT_STEP - 1e-9) {
      s.hintClock = 0;
      updateHints(s);
    }
    const ground = terrainAt(c, s.x, s.z);
    if (s.h <= ground) touchdown(s, c, ground);
    else updateCamera(s);
  }
}

export function createGame(env) {
  const s = createGliderState(0);
  let ended = false;
  return {
    update(dt, input) {
      stepGlider(s, dt, input);
      for (const name of s.events.splice(0)) {
        if (name === 'gate' || name === 'coin' || name === 'win' || name === 'lose')
          env.sound(name);
        else if (name === 'crash') env.sound('hit');
        else if (name === 'move') env.sound('move');
      }
      if ((s.phase === 'won' || s.phase === 'lost') && !ended) {
        ended = true;
        const won = s.phase === 'won';
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t('All three ridges flown with precise landings!', '三条山脊飞行完成，着陆精准！')
            : env.t(
                'Out of attempts. Fly smoother and use the lift.',
                '机会用完了。飞得更平稳，并利用好上升气流。',
              ),
        });
      }
    },
    draw(ctx) {
      drawGlider(ctx, s, env);
    },
    getState: () => describe(s),
  };
}

const PLAN_GLIDE = 8.5,
  PLAN_SPEED = 24,
  WINDOW_MARGIN = 12,
  CLIMB_MARGIN = 15,
  LIFT_NEAR = 30,
  CIRCLE_GAP = 120,
  PATH_CLEAR = 14,
  PATH_HIGH = 30,
  PATH_LOW = -15,
  PATH_AIM = 60,
  PATH_SLOPE = 10,
  TERRAIN_MARGIN = 30,
  DIVE_CLEARANCE = 70;
// Everything the player is shown about the next target: its line, the altitude needed to
// glide to it, the lift marker to use, and the flare cue. Pure; it only reads state and course.
// The glide-path line drawn in front of the pad: stay near it, then flare inside the cue window.
export const glidePath = (c, x) =>
  terrainAt(c, c.zone.x0 + 5, 0) + PATH_CLEAR + Math.max(0, c.zone.x0 + PATH_AIM - x) / PATH_SLOPE;
const sinkLossTo = (c, from, to) =>
  c.ridges.reduce(
    (sum, r) =>
      r.w < 0
        ? sum +
          (Math.abs(r.w) * Math.max(0, Math.min(r.x1, to) - Math.max(r.x0, from))) / PLAN_SPEED
        : sum,
    0,
  );
export function guidance(s, c) {
  const next = c.gates[s.gate],
    zone = c.zone,
    target = next
      ? {
          kind: 'gate',
          x: next.x,
          z: next.z,
          hw: next.hw,
          low: next.h - next.lo,
          high: next.h + next.hi,
        }
      : {
          kind: 'pad',
          x: zone.x0 + 20,
          z: zone.z,
          hw: zone.hw,
          low: terrainAt(c, zone.x0 + 5, 0) + 8,
          high: terrainAt(c, zone.x0 + 5, 0) + 45,
        },
    dist = target.x - s.x,
    ahead = Math.max(0, dist);
  let sinkLoss = 0;
  for (const r of c.ridges) {
    if (r.w < 0)
      sinkLoss +=
        (Math.abs(r.w) * Math.max(0, Math.min(r.x1, target.x) - Math.max(r.x0, s.x))) / PLAN_SPEED;
  }
  let clearance = Infinity,
    crest = -Infinity;
  for (let x = s.x + 25; x < target.x + 25 && x <= c.xmax; x += 25) {
    const ground = terrainAt(c, x, 0);
    crest = Math.max(crest, ground);
    clearance = Math.min(clearance, s.h - (x - s.x) / PLAN_GLIDE - sinkLossTo(c, s.x, x) - ground);
  }
  const predicted = s.h - ahead / PLAN_GLIDE - sinkLoss,
    lower = target.low + WINDOW_MARGIN,
    upper = target.high - WINDOW_MARGIN,
    nearLift = c.thermals.some((th) => Math.abs(s.x - th.x) < th.rx + CIRCLE_GAP),
    pathError = s.h - glidePath(c, s.x),
    cue = !next
      ? pathError > PATH_HIGH && !nearLift
        ? 'high'
        : pathError < PATH_LOW
          ? 'low'
          : 'ok'
      : predicted < lower || clearance < TERRAIN_MARGIN
        ? 'low'
        : predicted > upper && s.h - crest > DIVE_CLEARANCE && !nearLift
          ? 'high'
          : 'ok',
    lift = next
      ? c.thermals.find((th) => th.x + th.rx > s.x && th.x < target.x && s.h < th.top - 40)
      : null,
    agl = s.h - terrainAt(c, s.x, s.z);
  return {
    kind: target.kind,
    x: target.x,
    z: target.z,
    hw: target.hw,
    distance: dist,
    lateral: target.z - s.z,
    window: { low: target.low, high: target.high },
    need: Math.ceil(
      Math.max(lower + ahead / PLAN_GLIDE + sinkLoss, crest + TERRAIN_MARGIN) + CLIMB_MARGIN,
    ),
    cue,
    excess: next ? predicted - upper : pathError - PATH_HIGH,
    lift: lift
      ? {
          x: lift.x,
          z: lift.z,
          dx: lift.x - s.x,
          dz: lift.z - s.z,
          inside: ((s.x - lift.x) / lift.rx) ** 2 + ((s.z - lift.z) / lift.rz) ** 2 < 1,
        }
      : null,
    flare:
      !next &&
      s.x >= zone.x0 - 30 &&
      s.x <= zone.x1 &&
      agl <= FLARE_WINDOW &&
      Math.abs(s.bank) < FLARE_LEVEL &&
      Math.abs(s.heading) < FLARE_HEADING,
  };
}
export function statusLine(s) {
  return statusText(s, COURSES[s.course]);
}
function statusText(s, c) {
  const g = { stalled: s.stalled, stallWarning: s.stallWarn, agl: s.h - terrainAt(c, s.x, s.z) },
    gate = Math.min(s.gate + 1, c.gates.length),
    line = (zh) => {
      const say = (en, cn) => (zh ? cn : en);
      return say(
        `Course ${s.course + 1}/${COURSES.length} · Gate ${gate}/${c.gates.length} · Attempts ${s.attempts} · ${prompt(s, g, c, { t: say })}`,
        `赛道 ${s.course + 1}/${COURSES.length} · 检查门 ${gate}/${c.gates.length} · 机会 ${s.attempts} · ${prompt(s, g, c, { t: say })}`,
      );
    };
  return { en: line(false), zh: line(true) };
}
export function describe(s) {
  const { c, w, air, speed } = speedState(s),
    ground = terrainAt(c, s.x, s.z);
  return {
    ...structuredClone({ ...s, events: [] }),
    status: statusText(s, c),
    cues: guidance(s, c),
    courseName: c.name,
    courses: COURSES.length,
    gates: c.gates.map((g, i) => ({ ...g, passed: i < s.gate })),
    zone: { ...c.zone },
    glider: {
      x: s.x,
      z: s.z,
      altitude: s.h,
      agl: s.h - Math.min(ground, s.h),
      airspeed: speed,
      groundSpeed: Math.hypot(s.vx, s.vz),
      verticalSpeed: s.vh,
      airVertical: air.h,
      alpha: s.alpha,
      pitch: s.pitch ?? s.alpha,
      bank: s.bank,
      heading: s.heading,
      stalled: s.stalled,
      stallWarning: s.stallWarn,
      flare: s.flare,
    },
    wind: w,
    stalled: s.stalled,
    attemptsLeft: s.attempts,
  };
}

const VIEW_Y = 150;
const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const label = (ctx, str, x, y, color = '#fff', size = 14, align = 'left') => {
  text(ctx, str, x + 1, y + 1, '#0b1020', size, align);
  text(ctx, str, x, y, color, size, align);
};
const hash = (n) => (Math.imul(n | 0, 2654435761) >>> 0) / 4294967296;
const skyline = (x, seed, amp) =>
  amp *
  (0.55 +
    0.3 * Math.sin(x * 0.011 + seed) +
    0.22 * Math.sin(x * 0.031 + seed * 2.3) +
    0.1 * Math.sin(x * 0.083 + seed * 5));
const view = (s) => ({ sx: (x) => x - s.camX, sy: (h) => VIEW_Y - (h - s.camH) });
const groundTop = (c, x) => terrainAt(c, clamp(x, c.xmin, c.xmax), 0);

function drawSky(ctx, s, c) {
  const [horizon, mid, top] = c.palette;
  const bands = [top, top, mid, mid, horizon, horizon];
  bands.forEach((color, i) => rect(ctx, color, 0, i * 54, 480, 54));
  rect(ctx, '#fff6d8', 380, 28, 18, 18);
  rect(ctx, '#ffe9a8', 376, 32, 26, 10);
  const layers = [
    { k: 0.08, base: 205, amp: 80, color: '#8da3c4', snow: true },
    { k: 0.2, base: 235, amp: 70, color: '#6f86ab', snow: true },
    { k: 0.4, base: 262, amp: 55, color: '#4e6a7d', snow: false },
  ];
  layers.forEach((layer, i) => {
    const shift = s.camX * layer.k - s.camH * layer.k * 0.3;
    for (let px = 0; px < 480; px += 2) {
      const top = layer.base - skyline(px + shift, i * 3.1, layer.amp);
      rect(ctx, layer.color, px, top, 2, 320 - top);
      if (layer.snow && top < layer.base - layer.amp * 0.55) rect(ctx, '#f4f7fb', px, top, 2, 3);
    }
  });
  for (let n = 0; n < 5; n++) {
    const cx = ((n * 173 - s.camX * 0.12) % 560) - 40;
    rect(ctx, '#ffffffcc', cx, 40 + n * 14, 44, 5);
    rect(ctx, '#ffffffcc', cx + 10, 36 + n * 14, 26, 5);
  }
}

function drawTerrain(ctx, s, c) {
  const { sx, sy } = view(s);
  for (let px = 0; px < 480; px += 2) {
    const x = s.camX + px,
      top = sy(groundTop(c, x)),
      outside = x < c.xmin || x > c.xmax,
      snowy = groundTop(c, x) > c.snow;
    if (top > 320) continue;
    const y = Math.max(top, 0);
    rect(ctx, outside ? '#3b3a46' : '#5d5148', px, y, 2, 320 - y);
    rect(ctx, snowy ? '#eef3f7' : '#4f7d3b', px, y, 2, 4);
    rect(ctx, snowy ? '#c8d6e4' : '#3d6630', px, y + 4, 2, 3);
    if ((Math.floor(x / 2) + Math.floor(top / 6)) % 9 === 0) rect(ctx, '#7b6c60', px, y + 12, 2, 3);
    if (Math.floor(x) % 14 === 0) rect(ctx, '#473e38', px, y + 22, 2, 5);
  }
  for (let x = Math.floor(s.camX / 9) * 9; x < s.camX + 490; x += 9) {
    const n = hash(x);
    const ground = groundTop(c, x);
    const inPad = x > c.zone.x0 - 20 && x < c.zone.x1 + 20;
    if (n > 0.45 || ground > c.snow - 25 || x < c.xmin || x > c.xmax || inPad) continue;
    const bx = sx(x),
      by = sy(ground),
      tall = 10 + Math.floor(n * 22);
    rect(ctx, '#4a3326', bx, by - 3, 2, 4);
    for (let row = 0; row < 3; row++) {
      const w = 12 - row * 3;
      rect(
        ctx,
        row % 2 ? '#2f5a34' : '#26492c',
        bx + 1 - w / 2,
        by - 4 - row * (tall / 3),
        w,
        tall / 3 + 1,
      );
    }
  }
}

function drawLiftAir(ctx, s, c, glider) {
  const { sx, sy } = view(s),
    pulse = (s.time * 24) % 24;
  for (const r of c.ridges) {
    const sink = r.w < 0;
    for (let x = r.x0; x <= r.x1; x += 30) {
      for (let k = 0; k < 4; k++) {
        const agl = (k * r.depth) / 4 + (sink ? 12 - pulse : pulse) * 1.5;
        const h = groundTop(c, x) + (((agl % r.depth) + r.depth) % r.depth),
          px = sx(x),
          py = sy(h);
        if (px < -10 || px > 490) continue;
        const arrow = sink ? '#8a63b8' : '#7fe8ee',
          dir = sink ? 1 : -1;
        rect(ctx, arrow, px, py, 2, 8);
        rect(ctx, arrow, px - 3, py + (sink ? 5 : 0), 8, 2);
        rect(ctx, arrow, px - 1, py + dir * 0 + (sink ? 7 : -1), 4, 2);
      }
    }
  }
  for (const t of c.thermals) {
    const near = clamp(1 - Math.abs(glider.z - t.z) / (t.rz * 3), 0.25, 1),
      alpha = Math.round(near * 200)
        .toString(16)
        .padStart(2, '0');
    for (let k = -2; k <= 2; k++) {
      const x = t.x + (k * t.rx) / 2.6;
      for (let h = groundTop(c, x) + 6; h < t.top; h += 7) {
        const wiggle = Math.sin(h * 0.09 + s.time * 3 + k) * 5,
          py = sy(h + ((s.time * 40) % 7));
        if (py < -8 || py > 328) continue;
        rect(ctx, (k % 2 ? '#ffb347' : '#ffd96b') + alpha, sx(x) + wiggle, py, 3, 5);
      }
    }
    const top = sy(t.top);
    rect(ctx, '#fffaf0', sx(t.x) - 24, top - 8, 48, 8);
    rect(ctx, '#ffffff', sx(t.x) - 14, top - 14, 28, 8);
    rect(ctx, '#dfe8f3', sx(t.x) - 24, top - 2, 48, 3);
  }
}

function drawSocks(ctx, s, c) {
  const { sx, sy } = view(s);
  for (const x of c.socks) {
    const w = windAt(c, x, 0, groundTop(c, x) + 20),
      speed = Math.hypot(w.x, w.z),
      by = sy(groundTop(c, x)),
      px = sx(x);
    if (px < -50 || px > 530) continue;
    rect(ctx, '#d8d8d8', px, by - 30, 2, 30);
    const flow = Math.abs(w.x) >= Math.abs(w.z) ? Math.sign(w.x || -1) : 0,
      len = clamp(Math.round(speed * 2.2), 6, 26),
      droop = Math.round((1 - clamp(speed / 9, 0, 1)) * 8);
    for (let i = 0; i < 4; i++) {
      const seg = (len / 4) * i,
        flutter = Math.round(Math.sin(s.time * 8 + i) * (speed > 2 ? 1 : 0));
      const gx =
        flow === 0
          ? px + 2 + seg * 0.4 * (w.z < 0 ? -1 : 1)
          : px + (flow > 0 ? 2 + seg : -seg - len / 4);
      const gy = by - 30 + flutter + (flow === 0 ? seg * 0.7 : (droop * i) / 3);
      rect(ctx, i % 2 ? '#f4f4f4' : '#e0482e', gx, gy, Math.ceil(len / 4), 5 - i * 0.5);
    }
  }
}

function drawPadAndGates(ctx, s, c) {
  const { sx, sy } = view(s),
    z = c.zone,
    padTop = sy(groundTop(c, z.x0 + 2)),
    x0 = sx(z.x0),
    x1 = sx(z.x1);
  if (x1 > -20 && x0 < 500) {
    rect(ctx, '#e5cf62', x0, padTop - 2, x1 - x0, 4);
    for (let x = z.x0; x < z.x1; x += 16)
      rect(ctx, x % 32 ? '#d33a2f' : '#ffffff', sx(x), padTop - 1, 8, 2);
    const mid = sx((z.x0 + z.x1) / 2);
    rect(ctx, '#d33a2f', mid - 6, padTop - 4, 12, 2);
    rect(ctx, '#ffffff', mid - 3, padTop - 4, 6, 2);
    [x0, x1].forEach((fx) => {
      rect(ctx, '#f2f2f2', fx, padTop - 18, 2, 18);
      rect(ctx, '#ff5d3a', fx + 2, padTop - 18, 9, 6);
    });
  }
  c.gates.forEach((g, i) => {
    const px = sx(g.x),
      top = sy(g.h + g.hi),
      bottom = sy(g.h - g.lo),
      next = i === s.gate,
      color =
        i < s.gate
          ? '#5fd38a'
          : next
            ? Math.floor(s.time * 4) % 2
              ? '#ffe45e'
              : '#ffbf3b'
            : '#9aa7c2';
    if (px < -30 || px > 510) return;
    rect(ctx, color, px - 1, top, 3, bottom - top);
    rect(ctx, color, px - 9, top, 18, 3);
    rect(ctx, color, px - 9, bottom - 3, 18, 3);
    rect(ctx, '#2b3552', px - 1, bottom, 3, Math.max(0, sy(groundTop(c, g.x)) - bottom));
    for (let y = top + 4; y < bottom - 4; y += 6) rect(ctx, color + '88', px - 7, y, 14, 2);
    label(ctx, String(i + 1), px, top - 18, color, 14, 'center');
    if (next && Math.abs(g.z) > 4)
      label(ctx, g.z > 0 ? '<' : '>', px, top + 2, '#ffffff', 14, 'center');
  });
}

function drawWing(ctx, s, p) {
  const face = Math.cos(s.heading) >= 0 ? 1 : -1,
    bank = Math.abs(Math.sin(s.bank)),
    thick = 3 + Math.round(bank * 8),
    flutter = s.stallWarn || s.stalled ? Math.round(Math.sin(s.time * 60) * 2) : 0;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y + flutter));
  ctx.rotate(-(s.pitch ?? s.alpha) * face);
  ctx.scale(face, 1);
  rect(ctx, '#2a2336', -15, -12 - thick / 2, 31, 2);
  for (let i = 0; i < 8; i++) {
    const color = ['#e8442b', '#ffffff', '#f5a623', '#ffffff'][i % 4];
    rect(ctx, color, -14 + i * 4, -11 - thick / 2, 4, thick);
  }
  rect(ctx, '#b3261e', 14, -11 - thick / 2, 3, thick);
  rect(ctx, '#2a2336', -2, -9, 1, 9);
  rect(ctx, '#2a2336', 2, -9, 1, 9);
  rect(ctx, '#f3d4a4', 1, -1, 5, 4);
  rect(ctx, '#d8d8d8', 0, -3, 6, 3);
  rect(ctx, '#2f6fb0', -1, 3, 5, 6);
  rect(ctx, '#222a3a', -1, 9, 3, 4);
  rect(ctx, '#222a3a', 3, 9, 3, 3);
  if (s.flare) rect(ctx, '#ffffff', -17, -12, 3, 2);
  ctx.restore();
}

function drawHud(ctx, s, g, c, env) {
  const t = env.t;
  rect(ctx, '#0b1020cc', 4, 4, 124, 70);
  const sign = g.verticalSpeed >= 0 ? '+' : '';
  const lines = [
    [t(`AIR ${Math.round(g.airspeed)}`, `空速 ${Math.round(g.airspeed)}`), '#fff'],
    [
      t(`VS ${sign}${g.verticalSpeed.toFixed(1)}`, `升降 ${sign}${g.verticalSpeed.toFixed(1)}`),
      g.verticalSpeed >= 0 ? '#7ff0a8' : '#ffb3a0',
    ],
    [
      t(`ALT ${Math.round(g.altitude)}`, `高度 ${Math.round(g.altitude)}`),
      g.agl < 25 ? '#ffd36b' : '#fff',
    ],
  ];
  lines.forEach(([str, color], i) => text(ctx, str, 10, 7 + i * 18, color, 16));
  const ratio = clamp(s.alpha / PHYSICS.criticalAlpha, 0, 1.2);
  rect(ctx, '#222a3a', 10, 63, 112, 6);
  rect(
    ctx,
    ratio > 1 || s.stalled ? '#e8442b' : ratio > 0.86 ? '#ffd36b' : '#5fd38a',
    10,
    63,
    Math.round((112 * ratio) / 1.2),
    6,
  );
  rect(ctx, '#ffffff', 10 + Math.round(112 / 1.2), 61, 1, 10);
  label(ctx, c.name[env.lang === 'zh' ? 'zh' : 'en'], 474, 6, '#fff', 14, 'right');
  label(
    ctx,
    t(
      `Gate ${Math.min(s.gate + 1, c.gates.length)}/${c.gates.length}`,
      `检查门 ${Math.min(s.gate + 1, c.gates.length)}/${c.gates.length}`,
    ),
    474,
    22,
    '#ffe45e',
    14,
    'right',
  );
  for (let i = 0; i < PHYSICS.attempts; i++)
    rect(ctx, i < s.attempts ? '#ff6b6b' : '#3a3f55', 438 + i * 12, 40, 9, 9);
  label(ctx, t(`Score ${s.score}`, `得分 ${s.score}`), 474, 52, '#fff', 14, 'right');
}

function drawPlan(ctx, s, c) {
  const X = 340,
    Y = 252,
    W = 134,
    H = 64,
    range = 520,
    back = 90;
  rect(ctx, '#0b1020dd', X - 2, Y - 2, W + 4, H + 4);
  const px = (x) => X + ((x - (s.x - back)) / range) * W,
    pz = (z) => Y + H / 2 - (z / c.half) * (H / 2);
  rect(ctx, '#7c5a4a', X, Y, W, 2);
  rect(ctx, '#7c5a4a', X, Y + H - 2, W, 2);
  rect(ctx, '#2a3a52', X, Y + 2, W, H - 4);
  const zone = c.zone;
  rect(
    ctx,
    '#e5cf62',
    clamp(px(zone.x0), X, X + W),
    pz(zone.z + zone.hw),
    clamp(px(zone.x1), X, X + W) - clamp(px(zone.x0), X, X + W),
    (zone.hw / c.half) * H,
  );
  for (const t of c.thermals) {
    const cx = px(t.x);
    if (cx > X - 6 && cx < X + W + 6) {
      rect(ctx, '#ffb347', cx - 5, pz(t.z) - 4, 10, 8);
      rect(ctx, '#ffd96b', cx - 3, pz(t.z) - 6, 6, 12);
    }
  }
  c.gates.forEach((g, i) => {
    const gx = px(g.x);
    if (gx < X || gx > X + W) return;
    rect(
      ctx,
      i < s.gate ? '#5fd38a' : i === s.gate ? '#ffe45e' : '#9aa7c2',
      gx,
      pz(g.z + g.hw),
      2,
      (g.hw / c.half) * H * 2,
    );
  });
  const wz = (s.wind ?? windAt(c, s.x, s.z, s.h)).z,
    len = Math.round(clamp(Math.abs(wz) * 2, 0, 24));
  if (len > 2) {
    const base = Y + H / 2 + (wz > 0 ? len / 2 : -len / 2);
    rect(ctx, '#9fd8ff', X + 6, Math.min(base, base - Math.sign(wz) * len), 2, len);
    rect(ctx, '#9fd8ff', X + 3, wz > 0 ? base - len - 1 : base + len - 1, 8, 2);
  }
  const gx = px(s.x),
    gz = pz(s.z);
  rect(ctx, '#ffffff', gx - 2, gz - 2, 5, 5);
  rect(
    ctx,
    '#ff5d3a',
    gx + Math.round(Math.cos(s.heading) * 6) - 1,
    gz - Math.round(Math.sin(s.heading) * 6) - 1,
    3,
    3,
  );
}

function bannerFor(s, c, env) {
  const t = env.t;
  const zh = env.lang === 'zh',
    auto = Math.max(0, Math.ceil(HOLD_SECONDS - s.timer));
  if (s.phase === 'won')
    return [t('ALL RIDGES FLOWN', '全部山脊完成'), t(`Final score ${s.score}`, `总分 ${s.score}`)];
  if (s.phase === 'lost')
    return [t('OUT OF ATTEMPTS', '机会用完'), s.message ? s.message[zh ? 'zh' : 'en'] : ''];
  if (s.phase === 'landed')
    return [
      t('COURSE COMPLETE', '赛道完成'),
      t(`Space: next ridge (auto in ${auto} s)`, `空格：下一条山脊（${auto} 秒后自动）`),
    ];
  if (s.phase === 'crashed')
    return [
      s.message ? s.message[zh ? 'zh' : 'en'] : '',
      t(`Space: relaunch (auto in ${auto} s)`, `空格：重新起飞（${auto} 秒后自动）`),
    ];
  return null;
}

const nearEdge = (s, c, margin = 0) =>
  Math.abs(s.z) > c.half - EDGE_Z - margin ||
  s.x < c.xmin + EDGE_X + margin ||
  s.x > c.xmax - EDGE_X - margin;

// Memory-free reading of the situation; updateHints keeps the latches that stop cues flickering.
function freshHint(s, cues, c) {
  const atLift =
    cues.kind === 'gate' && cues.cue === 'low' && cues.lift?.inside && cues.lift.dx < LIFT_NEAR;
  return {
    circle: atLift
      ? 'climb'
      : cues.cue === 'high' && !cues.flare && descendOk(s, cues, c)
        ? 'descend'
        : null,
    redo: cues.kind === 'gate' && cues.distance < -MISSED_BEHIND ? 'west' : null,
    flare: cues.flare,
    edge: nearEdge(s, c),
    steer: steerOf(s, cues),
  };
}
const descendOk = (s, cues, c) =>
  cues.kind === 'gate'
    ? cues.distance > DESCEND_GATE_GAP
    : s.h - terrainAt(c, s.x, s.z) > DESCEND_MIN_AGL;
// Steering prompts start beyond a wide band and stay until the nose is nearly right (no flip-flop).
const steerLatch = (s, cues, current) => {
  const error = clamp(cues.lateral / 200, -0.3, 0.3) - s.heading;
  if (current === 'steerL') return error > STEER_END ? 'steerL' : null;
  if (current === 'steerR') return error < -STEER_END ? 'steerR' : null;
  return error > STEER_BAND ? 'steerL' : error < -STEER_BAND ? 'steerR' : null;
};
const steerOf = (s, cues) => steerLatch(s, cues, null);
function hintId(s, cues, c, hint) {
  if (s.stalled) return 'stall';
  if (s.stallWarn) return 'warn';
  if (hint.edge) return 'edge';
  if (hint.redo)
    return hint.redo === 'west'
      ? 'redoTurn'
      : hint.redo === 'back'
        ? hint.bearing > REDO_STEER
          ? 'steerL'
          : hint.bearing < -REDO_STEER
            ? 'steerR'
            : 'redoBack'
        : 'redoEast';
  if (hint.flare) return 'flare';
  if (cues.kind === 'pad' && hint.fast) return 'fast';
  if (cues.kind === 'pad' && (s.x < c.zone.x0 - 30 || s.x > c.zone.x1))
    return hint.steer ?? 'padGlide';
  if (hint.circle) {
    if (hint.turn) return 'turn';
    if (hint.circle === 'climb') return 'climb';
    return cues.kind === 'pad' ? 'descendPad' : 'descend';
  }
  if (hint.steer) return hint.steer;
  if (cues.kind === 'pad') return 'padLow';
  if (cues.cue === 'low') return cues.lift ? 'toLift' : 'find';
  return 'gate';
}
function updateHints(s) {
  const c = COURSES[s.course],
    cues = guidance(s, c),
    h = s.hint,
    ground = terrainAt(c, s.x, s.z),
    facing = Math.abs(s.heading) < 0.35;
  h.edge = nearEdge(s, c, h.edge ? EDGE_CLEAR : 0);
  if (cues.flare) h.flare = true;
  else if (cues.kind !== 'pad' || s.h - ground > FLARE_CLEAR) h.flare = false;
  const speed = speedState(s).speed;
  if (s.stalled || s.stallWarn || s.alpha > FAST_ALPHA_MAX) h.fastBlock = s.time + FAST_COOLDOWN;
  h.fast =
    cues.kind === 'pad' &&
    !h.flare &&
    s.time >= (h.fastBlock ?? 0) &&
    (speed > FAST_ON || (h.fast && speed >= FAST_OFF));
  const fresh = freshHint(s, cues, c);
  if (cues.kind !== 'gate' && h.redo !== 'east') h.redo = null;
  else if (!h.redo && fresh.redo) h.redo = 'west';
  const redoGate = c.gates[h.redoGate ?? s.gate];
  h.bearing = redoGate ? wrap(Math.atan2(redoGate.z - s.z, redoGate.x - s.x) - s.heading) : 0;
  if (h.redo === 'west' && Math.abs(h.bearing) < REDO_AIM) {
    h.redo = 'back';
    h.redoGate = s.gate;
  } else if (h.redo === 'back' && s.gate !== h.redoGate) h.redo = 'east';
  else if (h.redo === 'east' && facing) h.redo = null;
  if (h.redo) h.circle = null;
  else if (h.flare) h.circle = null;
  else if (!h.circle) h.circle = fresh.circle;
  else {
    const climbing = h.circle === 'climb',
      keep =
        cues.kind === 'gate' ? cues.distance > DESCEND_KEEP_GAP : s.h - ground > CIRCLE_MIN_AGL,
      done = climbing ? cues.cue !== 'low' : cues.excess < -10 || !keep;
    h.turn = done && !facing;
    if (done && facing) h.circle = null;
    else if (climbing && cues.kind === 'gate' && !cues.lift) h.circle = null;
  }
  if (!h.circle) h.turn = false;
  h.steer = steerLatch(s, cues, h.steer);
  const id = hintId(s, cues, c, h);
  if (id !== h.id) {
    const urgent = URGENT.includes(id) || URGENT.includes(h.id);
    if (h.id === null || urgent || s.time - h.since >= HINT_DWELL) {
      h.id = id;
      h.since = s.time;
    }
  }
}

function prompt(s, g, c, env) {
  const t = env.t,
    cues = guidance(s, c),
    id = s.hint?.id ?? hintId(s, cues, c, { ...freshHint(s, cues, c), turn: false });
  const texts = {
    stall: t('STALL: push the nose down', '失速：压低机头'),
    warn: t('Slow! Lower the nose', '太慢！压低机头'),
    edge: t('Course edge: Hold Left: turn back', '赛道边缘：按住左键转回'),
    redoTurn: t(
      `Gate ${s.gate + 1} missed: Hold Left: turn back`,
      `第 ${s.gate + 1} 门漏过：按住左键转回`,
    ),
    redoBack: t(`Fly back through gate ${s.gate + 1}`, `飞回穿过第 ${s.gate + 1} 门`),
    redoEast: t('Hold Left: turn to face right', '按住左键转到朝右'),
    flare: t('Hold Space to flare', '按住空格拉平'),
    padGlide: t('Glide to the pad', '滑向着陆台'),
    turn: t('Keep turning until facing right', '继续转到朝右'),
    climb: t(`Hold Left: climb to ALT ${cues.need}`, `按住左键盘旋爬升至${cues.need}`),
    descend: t('Too high: hold Left to circle down', '太高：按住左键盘旋降高'),
    descendPad: t('Above the path: hold Left to circle', '高于下滑线：按住左键盘旋'),
    steerL: t('Steer Left to hold the line', '向左修正航线'),
    steerR: t('Steer Right to hold the line', '向右修正航线'),
    fast: t('Too fast: hold Up', '太快：按住上键'),
    padLow: t('Glide lower, flare near ground', '再降低，近地再拉平'),
    toLift: t('Fly to LIFT, then hold Left', '飞到升力处再按住左键'),
    find: t('Find lift: thermal or ridge', '寻找上升气流'),
    gate: t(`Fly through gate ${s.gate + 1}`, `穿过第 ${s.gate + 1} 门`),
  };
  return texts[id];
}

function edgeArrow(ctx, color, x, y, dir) {
  for (let i = 0; i < 7; i++) rect(ctx, color, dir > 0 ? x - i : x + i, y - i, 1, 2 * i + 1);
}

function drawGuidance(ctx, s, c, env) {
  const { sx, sy } = view(s),
    cues = guidance(s, c),
    t = env.t;
  for (const th of c.thermals) {
    const px = sx(th.x),
      half = Math.round(th.rx * 0.45),
      chosen = cues.lift && cues.lift.x === th.x,
      color = chosen ? '#fff27a' : '#ffd36bcc';
    if (px < -th.rx || px > 480 + th.rx) continue;
    for (let h = terrainAt(c, th.x, 0) + 4; h < th.top; h += 10) {
      const y = sy(h);
      if (y < 0 || y > 320) continue;
      rect(ctx, color, px - half, y, 3, 6);
      rect(ctx, color, px + half, y, 3, 6);
    }
    const labelY = clamp(sy(Math.min(th.top - 15, s.camH + 95)), 100, 220);
    if (px > 30 && px < 450)
      label(ctx, t('LIFT', '升力'), px, labelY, chosen ? '#fff27a' : '#ffd36b', 14, 'center');
  }
  if (cues.lift && cues.cue === 'low') {
    const px = sx(cues.lift.x);
    if (px > 478) {
      edgeArrow(ctx, '#fff27a', 474, 120, 1);
      label(
        ctx,
        t(`LIFT ${Math.round(cues.lift.dx)}`, `升力 ${Math.round(cues.lift.dx)}`),
        464,
        112,
        '#fff27a',
        14,
        'right',
      );
    } else if (px < 2) {
      edgeArrow(ctx, '#fff27a', 6, 120, -1);
      label(ctx, t('LIFT behind', '升力在后'), 14, 112, '#fff27a', 14, 'left');
    }
  }
  if (cues.kind === 'gate' && cues.cue === 'low') {
    const y = clamp(sy(cues.need), 84, 292);
    for (let x = 140; x < 470; x += 12) rect(ctx, '#7fe8ee', x, y, 6, 2);
    label(ctx, t(`ALT ${cues.need}`, `高度 ${cues.need}`), 470, y - 17, '#7fe8ee', 14, 'right');
  }
  if (cues.kind === 'pad') {
    for (let x = c.zone.x0 - 700; x < c.zone.x0 + PATH_AIM; x += 14) {
      const px = sx(x);
      if (px > -4 && px < 484) rect(ctx, '#7fe8ee', px, sy(glidePath(c, x)), 7, 2);
    }
  }
  const gx = sx(cues.x);
  if (cues.kind === 'gate' && (gx > 478 || gx < 2)) {
    const y = clamp(sy(cues.window.low + (cues.window.high - cues.window.low) / 2), 150, 232),
      ahead = gx > 0;
    edgeArrow(ctx, '#ffe45e', ahead ? 474 : 6, y, ahead ? 1 : -1);
    label(
      ctx,
      `${s.gate + 1}: ${Math.round(Math.abs(cues.distance))}`,
      ahead ? 464 : 14,
      y - 8,
      '#ffe45e',
      14,
      ahead ? 'right' : 'left',
    );
  }
}

export function drawGlider(ctx, s, env) {
  const c = COURSES[s.course],
    g = describe(s).glider,
    { sx, sy } = view(s),
    zh = env.lang === 'zh';
  background(ctx, '#101b2d');
  drawSky(ctx, s, c);
  drawTerrain(ctx, s, c);
  drawLiftAir(ctx, s, c, g);
  drawSocks(ctx, s, c);
  drawPadAndGates(ctx, s, c);
  drawGuidance(ctx, s, c, env);
  drawWing(ctx, s, { x: sx(s.x), y: sy(s.h) });
  drawHud(ctx, s, g, c, env);
  drawPlan(ctx, s, c);
  if (g.stalled || g.stallWarning) {
    if (Math.floor(s.time * 6) % 2 === 0)
      label(ctx, env.t('STALL!', '失速！'), 240, 36, '#ff6b5a', 16, 'center');
  }
  if (s.phase === 'playing') {
    const intro = s.time < 6 && !g.stalled && !g.stallWarning;
    label(ctx, intro ? c.brief[zh ? 'zh' : 'en'] : prompt(s, g, c, env), 8, 298, '#ffffff', 14);
    if (s.message) label(ctx, s.message[zh ? 'zh' : 'en'], 240, 80, '#ffffff', 16, 'center');
  } else {
    const banner = bannerFor(s, c, env);
    rect(ctx, '#0b1020dd', 60, 176, 360, 70);
    label(ctx, banner[0], 240, 184, '#ffe45e', 16, 'center');
    label(ctx, banner[1], 240, 208, '#ffffff', 14, 'center');
    if (s.landing && s.landing.kind)
      label(
        ctx,
        env.t(
          `Sink ${s.landing.sink.toFixed(1)} m/s  Speed ${Math.round(s.landing.speed)}`,
          `下沉 ${s.landing.sink.toFixed(1)}  速度 ${Math.round(s.landing.speed)}`,
        ),
        240,
        228,
        '#9fd8ff',
        14,
        'center',
      );
  }
}
