import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'wallrunner-relay',
  name: { en: 'Wallrunner Relay', zh: '飞檐接力' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Run the rooftops through three courses and touch each beacon. Hold X against a chalk-marked wall to run up it: that spends energy and needs real wall contact. Space jumps, or kicks away from a non-slick wall for a bounded push. Energy refills only on glowing RELAY pads. Falling or running out of energy costs a life and returns you to your last relay pad.',
    zh: '穿越三条屋顶赛道，触碰每条赛道的终点信标。贴着白粉笔标记的墙按住X即可沿墙奔跑，这会消耗能量，并且必须真实贴墙。空格跳跃；贴着非湿滑的墙时空格会蹬离墙面，获得有限的反推力。能量只能在发光的接力台上恢复。坠落或能量耗尽会失去一条生命，并回到最近的接力台。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'A D / Left Right' },
    { label: { en: 'Jump; kick away from a wall', zh: '跳跃；贴墙时蹬墙' }, keys: 'Space' },
    { label: { en: 'Hold to run up a chalk wall', zh: '按住沿粉笔墙奔跑' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Jump / Kick', '跳跃 / 蹬墙', 'right'],
    ['KeyX', 'Wall-run (hold)', '沿墙跑（按住）', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Physics constants. Distances are pixels, time is seconds.
const STEP = 1 / 240;
const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
const EPS = 1e-6;
const TOUCH = 0.02;
const GRAVITY = 900;
const TERMINAL = 520;
const JUMP_SPEED = 330;
const RUN_SPEED = 110;
const GROUND_ACCEL = 900;
const AIR_ACCEL = 450;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const KICK_COST = 10;
const KICK_PUSH = 150;
const KICK_LIFT = 340;
const KICK_MAX_RISE = 300;
const KICK_COOLDOWN = 0.2;
const RUN_LOCK = 0.25;
const WALL_RUN_SPEED = 140;
const MOMENTUM_REF = 110;
const MOMENTUM_MIN = 0.35;
const MOMENTUM_DECAY = 0.25;
const MOMENTUM_FLOOR = 0.08;
const SLIDE_SPEED = 40;
const RUN_DRAIN = 16;
const CLING_DRAIN = 6;
const PAD_RATE = 25;
const MAX_ENERGY = 100;
const MARK_OVERLAP = 4;
const START_LIVES = 4;
const FALL_Y = 380;
const BOTTOM = 440;
const APPROACH_WINDOW = 0.18;
const PAD_SCORE = 50;
const COURSE_SCORE = 300;
const TRAIL_LIMIT = 40;
const ZOOM = 2;
const VIEW_W = 480 / ZOOM;
const VIEW_H = 320 / ZOOM;
const READY_TIME = 0.25;
const WALL_GRACE = 0.1;
const SAFE_TOP = 30; // world px of headroom kept below the HUD
const SAFE_BOTTOM = 138; // world px from the camera top to the lowest visible foot

// Authored courses. Each building: x, roof y, width, chalk marks and slick faces
// (side L = west face, R = east face; ranges are [y0, y1] world pixels), relay pads
// (x ranges on the roof) and the goal beacon.
const b = (x, top, w, o = {}) => ({
  x,
  y: top,
  w,
  h: BOTTOM - top,
  chalk: { L: o.L || [], R: o.R || [] },
  slick: { L: o.sL || [], R: o.sR || [] },
  pads: o.pads || [],
});
const COURSES = [
  {
    name: { en: 'Gutter Row', zh: '滴水檐巷' },
    hint: {
      en: 'Hold X on chalk. Space kicks bare walls.',
      zh: '粉笔墙按住X；空格可蹬无标记墙。',
    },
    sky: ['#0d1624', '#17283a', '#26414f'],
    brick: ['#4a3a3f', '#3b2f36', '#5a474b'],
    solids: [
      b(-60, -300, 60),
      b(0, 240, 200, { pads: [[24, 100]] }),
      b(240, 240, 100),
      b(400, 130, 160, { L: [[110, 240]], pads: [[490, 550]] }),
      b(620, 130, 80),
      b(700, 250, 44, { pads: [[700, 744]] }),
      b(744, 70, 116, { L: [[50, 150]] }),
      b(910, 70, 120),
      b(1030, -300, 60),
    ],
    goal: { x: 972, y: 40, w: 16, h: 30 },
    width: 1090,
  },
  {
    name: { en: 'Antenna Canyon', zh: '天线深谷' },
    hint: {
      en: 'Run chalk, then kick across the canyon.',
      zh: '先跑粉笔墙，再在峡谷间蹬墙。',
    },
    sky: ['#101524', '#1d2540', '#34385a'],
    brick: ['#3d4153', '#30334a', '#4d526a'],
    solids: [
      b(-60, -300, 60),
      b(0, 60, 100, { R: [[130, 250]] }),
      b(100, 250, 50, { pads: [[100, 150]] }),
      b(150, 60, 100, { L: [[40, 150]], pads: [[170, 235]] }),
      b(310, 60, 80),
      b(450, 80, 60, { pads: [[455, 505]] }),
      b(570, -90, 100, { L: [[-110, 40]] }),
      b(670, -300, 60),
    ],
    goal: { x: 620, y: -120, w: 16, h: 30 },
    width: 730,
  },
  {
    name: { en: 'Skyline Relay', zh: '云霄接力' },
    hint: {
      en: 'Slick walls shed kicks. Spend energy wisely.',
      zh: '湿滑墙无法蹬踏；合理使用能量。',
    },
    sky: ['#0a1018', '#142230', '#223a48'],
    brick: ['#38454d', '#2b363f', '#4a5a63'],
    solids: [
      b(-60, -300, 60),
      b(0, 40, 100, { R: [[170, 280]] }),
      b(100, 280, 50, { pads: [[100, 150]] }),
      b(150, 40, 100, { L: [[20, 150]], sL: [[200, 260]], pads: [[170, 235]] }),
      b(310, 40, 70),
      b(440, 60, 60, { pads: [[445, 495]] }),
      b(560, -150, 90, { L: [[-170, 40]], sL: [[60, 140]] }),
      b(650, -300, 60),
    ],
    goal: { x: 600, y: -180, w: 16, h: 30 },
    width: 710,
  },
];

export const getCourse = (course) => COURSES[course - 1];

const makePad = (courseIndex) => {
  const pads = [];
  COURSES[courseIndex].solids.forEach((s, solid) =>
    s.pads.forEach(([x0, x1]) => pads.push({ id: pads.length, solid, x0, x1, y: s.y })),
  );
  return pads;
};
const PADS = COURSES.map((_, i) => makePad(i));

function newPlayer() {
  return {
    x: 0,
    y: 0,
    w: 10,
    h: 18,
    vx: 0,
    vy: 0,
    ground: true,
    facing: 1,
    wall: 0,
    graceTime: 0,
    graceFace: '',
    graceSide: 0,
    graceSlick: false,
    wallSolid: -1,
    running: false,
    momentum: 0,
    charge: true,
    coyote: 0,
    jumpBuffer: 0,
    kickCooldown: 0,
    kickFace: '',
    runLock: 0,
    approach: 0,
    approachTimer: 0,
  };
}
function placeOnPad(s, padId) {
  const pad = PADS[s.course - 1][padId],
    p = s.player;
  Object.assign(p, newPlayer(), { facing: p.facing });
  p.x = (pad.x0 + pad.x1) / 2 - p.w / 2;
  p.y = pad.y - p.h;
  s.checkpoint = padId;
  s.focusY = pad.y;
  s.ready = READY_TIME;
}
function cameraBounds(course) {
  const roofs = course.solids.filter((x) => x.y > -250).map((x) => x.y);
  const highest = Math.min(...roofs, course.goal.y);
  return {
    minX: 0,
    maxX: Math.max(0, course.width - VIEW_W),
    minY: highest - 120,
    maxY: BOTTOM - VIEW_H,
  };
}
function snapCamera(s) {
  const t = cameraTarget(s);
  s.camera = { x: t.x, y: t.y };
}
function cameraTarget(s) {
  const k = cameraBounds(COURSES[s.course - 1]),
    p = s.player;
  return {
    x: clamp(
      p.x + p.w / 2 - VIEW_W / 2 + clamp(p.vx / RUN_SPEED, -1, 1) * 50 + p.facing * 14,
      k.minX,
      k.maxX,
    ),
    y: clamp(s.focusY - VIEW_H * 0.7, k.minY, k.maxY),
  };
}

export function createRunState(course = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    lives: START_LIVES,
    course,
    time: 0,
    energy: MAX_ENERGY,
    checkpoint: 0,
    padsSeen: [0],
    cause: '',
    spent: { run: 0, kick: 0 },
    refilled: 0,
    kicks: 0,
    jumps: 0,
    falls: 0,
    collapses: 0,
    courseTimes: [],
    courseClock: 0,
    banner: 0,
    focusY: 0,
    ready: 0,
    flash: 0,
    event: '',
    camera: { x: 0, y: 0 },
    trail: [],
    trailClock: 0,
    player: newPlayer(),
  };
  placeOnPad(s, 0);
  s.ready = 0;
  snapCamera(s);
  return s;
}

const overlapsY = (p, o) => p.y + p.h > o.y + EPS && p.y < o.y + o.h - EPS;
const overlapsX = (p, o) => p.x + p.w > o.x + EPS && p.x < o.x + o.w - EPS;
const solidsOf = (s) => COURSES[s.course - 1].solids;

function sweepX(p, dx, solids) {
  let x = p.x + dx,
    hit = -1;
  solids.forEach((o, i) => {
    if (!overlapsY(p, o)) return;
    if (dx > 0 && p.x + p.w <= o.x + EPS && x + p.w > o.x) {
      x = o.x - p.w;
      hit = i;
    } else if (dx < 0 && p.x >= o.x + o.w - EPS && x < o.x + o.w) {
      x = o.x + o.w;
      hit = i;
    }
  });
  return { x, hit };
}
function sweepY(p, dy, solids) {
  let y = p.y + dy,
    land = -1;
  solids.forEach((o, i) => {
    if (!overlapsX(p, o)) return;
    if (dy > 0 && p.y + p.h <= o.y + EPS && y + p.h > o.y) {
      y = o.y - p.h;
      land = i;
    }
  });
  return { y, land };
}
const supportIndex = (p, solids) =>
  solids.findIndex((o) => overlapsX(p, o) && Math.abs(p.y + p.h - o.y) <= EPS);
const inRanges = (p, ranges) =>
  ranges.some(([y0, y1]) => Math.min(p.y + p.h, y1) - Math.max(p.y, y0) >= MARK_OVERLAP);

// Finds the wall face touching the runner's side (if any) and its surface kind.
export function wallContact(p, solids) {
  for (let i = 0; i < solids.length; i++) {
    const o = solids[i];
    if (!overlapsY(p, o)) continue;
    const side =
      Math.abs(p.x + p.w - o.x) <= TOUCH ? 1 : Math.abs(p.x - (o.x + o.w)) <= TOUCH ? -1 : 0;
    if (!side) continue;
    const face = side > 0 ? 'L' : 'R',
      slick = inRanges(p, o.slick[face]);
    return {
      side,
      solid: i,
      face: `${i}${face}`,
      slick,
      chalk: !slick && inRanges(p, o.chalk[face]),
    };
  }
  return null;
}
export const padUnder = (s) => {
  const p = s.player;
  if (!p.ground) return null;
  const cx = p.x + p.w / 2;
  return (
    PADS[s.course - 1].find(
      (pad) => cx >= pad.x0 && cx <= pad.x1 && Math.abs(p.y + p.h - pad.y) <= EPS,
    ) || null
  );
};

function loseLife(s, cause) {
  s.lives -= 1;
  s.cause = cause;
  s.event = cause;
  s.flash = 0.6;
  if (cause === 'energy') s.collapses += 1;
  else s.falls += 1;
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  placeOnPad(s, s.checkpoint);
}

function finishCourse(s) {
  s.score += COURSE_SCORE + Math.floor(s.energy) * 2;
  s.courseTimes.push(Math.round(s.courseClock * 100) / 100);
  s.courseClock = 0;
  s.event = 'course';
  if (s.course >= COURSES.length) {
    s.phase = 'won';
    return;
  }
  s.course += 1;
  s.padsSeen = [0];
  s.banner = 2.5;
  placeOnPad(s, 0);
  snapCamera(s);
}

function applyJumpOrKick(s, wall) {
  const p = s.player;
  if (p.jumpBuffer <= 0) return;
  if (p.ground || p.coyote > 0) {
    p.vy = -JUMP_SPEED;
    p.ground = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.running = false;
    s.jumps += 1;
    s.event = 'jump';
    return;
  }
  const canKick =
    wall && !wall.slick && p.kickCooldown <= 0 && s.energy > KICK_COST && p.kickFace !== wall.face;
  if (!canKick) return;
  p.vx = -wall.side * KICK_PUSH;
  p.vy = Math.max(-KICK_MAX_RISE, p.vy - KICK_LIFT);
  p.facing = -wall.side;
  p.kickFace = wall.face;
  p.graceTime = 0;
  p.kickCooldown = KICK_COOLDOWN;
  p.runLock = RUN_LOCK;
  p.running = false;
  p.jumpBuffer = 0;
  s.energy -= KICK_COST;
  s.spent.kick += KICK_COST;
  s.kicks += 1;
  s.event = 'kick';
}

function updateWallRun(s, wall, cmd, h) {
  const p = s.player,
    want = cmd.run && wall?.chalk && p.runLock <= 0 && s.energy > 0 && cmd.axis !== -wall.side;
  if (!want) {
    p.running = false;
    return;
  }
  if (!p.running) {
    let m = 0;
    if (p.charge) {
      m = p.approachTimer > 0 ? clamp(p.approach / MOMENTUM_REF, MOMENTUM_MIN, 1) : MOMENTUM_MIN;
      p.charge = false;
    }
    p.momentum = Math.max(p.momentum, m);
    p.running = true;
    s.event = 'wallrun';
  }
  p.wall = wall.side;
  p.facing = wall.side;
  const powered = p.momentum > MOMENTUM_FLOOR,
    drain = Math.min(s.energy, (powered ? RUN_DRAIN : CLING_DRAIN) * h);
  s.energy -= drain;
  s.spent.run += drain;
}

function integrate(s, h, cmd) {
  const p = s.player,
    solids = solidsOf(s);
  if (p.running) {
    p.vx = 0;
    const target = p.momentum > MOMENTUM_FLOOR ? -WALL_RUN_SPEED * p.momentum : SLIDE_SPEED;
    p.vy = p.vy < target ? Math.min(target, p.vy + GRAVITY * h) : target;
  } else {
    const goal = cmd.axis * RUN_SPEED,
      accel = (p.ground ? GROUND_ACCEL : AIR_ACCEL) * h;
    p.vx += clamp(goal - p.vx, -accel, accel);
    p.vy = Math.min(TERMINAL, p.vy + GRAVITY * h);
  }
  const mx = sweepX(p, p.vx * h, solids);
  if (mx.hit >= 0) {
    if (p.approachTimer <= 0 || Math.abs(p.vx) >= p.approach) {
      p.approach = Math.abs(p.vx);
      p.approachTimer = APPROACH_WINDOW;
    }
    p.vx = 0;
  }
  p.x = mx.x;
  const my = sweepY(p, p.vy * h, solids);
  p.y = my.y;
  if (my.land >= 0) {
    p.vy = 0;
    p.ground = true;
  }
}

function tick(s, h, input) {
  const ready = s.ready > 0,
    cmd = ready ? { axis: 0, run: false } : input;
  const p = s.player,
    solids = solidsOf(s);
  s.time += h;
  s.courseClock += h;
  s.banner = Math.max(0, s.banner - h);
  s.ready = Math.max(0, s.ready - h);
  if (ready) p.jumpBuffer = 0;
  s.flash = Math.max(0, s.flash - h);
  p.coyote = Math.max(0, p.coyote - h);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - h);
  p.kickCooldown = Math.max(0, p.kickCooldown - h);
  p.runLock = Math.max(0, p.runLock - h);
  p.approachTimer = Math.max(0, p.approachTimer - h);
  if (cmd.axis) p.facing = cmd.axis;

  const supported = supportIndex(p, solids) >= 0;
  if (p.ground && !supported) p.coyote = COYOTE;
  p.ground = supported;
  if (p.ground) {
    p.charge = true;
    p.momentum = 0;
    p.kickFace = '';
    p.running = false;
  } else p.momentum = Math.max(0, p.momentum - MOMENTUM_DECAY * h);

  const wall = p.ground ? null : wallContact(p, solids);
  const groundWall = p.ground ? wallContact(p, solids) : null;
  if (wall) {
    Object.assign(p, {
      graceTime: WALL_GRACE,
      graceFace: wall.face,
      graceSide: wall.side,
      graceSlick: wall.slick,
    });
  } else p.graceTime = p.ground ? 0 : Math.max(0, p.graceTime - h);
  const kickWall =
    wall ||
    (p.graceTime > 0 ? { side: p.graceSide, face: p.graceFace, slick: p.graceSlick } : null);
  applyJumpOrKick(s, kickWall);
  updateWallRun(s, wall || groundWall, cmd, h);
  if (p.running && p.ground) p.ground = false;
  p.wall = wall ? wall.side : 0;
  integrate(s, h, cmd);

  const pad = padUnder(s);
  if (pad) {
    const gain = Math.min(MAX_ENERGY - s.energy, PAD_RATE * h);
    s.energy += gain;
    s.refilled += gain;
    if (!s.padsSeen.includes(pad.id)) {
      s.padsSeen.push(pad.id);
      s.score += PAD_SCORE;
      s.event = 'pad';
    }
    s.checkpoint = pad.id;
  } else if (s.energy <= 0) {
    loseLife(s, 'energy');
    return;
  }
  const goal = COURSES[s.course - 1].goal;
  if (overlapsX(p, goal) && overlapsY(p, goal)) {
    finishCourse(s);
    return;
  }
  if (p.y > FALL_Y) {
    loseLife(s, 'fall');
    return;
  }
}

function updateFocus(s) {
  const p = s.player,
    feet = p.y + p.h;
  if (p.running) s.focusY = feet - 30;
  else if (p.ground) s.focusY = feet;
  else if (feet > s.focusY + 45) s.focusY = feet - 45;
  else if (feet < s.focusY - 70) s.focusY = feet + 70;
}
function decorate(s, h) {
  updateFocus(s);
  const p = s.player,
    target = cameraTarget(s),
    k = 1 - Math.exp(-6 * h);
  s.camera.x += (target.x - s.camera.x) * k;
  s.camera.y += (target.y - s.camera.y) * k;
  s.camera.y = clamp(s.camera.y, p.y + p.h - SAFE_BOTTOM, p.y - SAFE_TOP);
  s.trailClock += h;
  const moving = (p.ground && Math.abs(p.vx) > 20) || p.running;
  if (moving && s.trailClock >= 0.05) {
    s.trailClock = 0;
    s.trail.push({
      x: p.x + p.w / 2,
      y: p.running ? p.y + p.h / 2 : p.y + p.h,
      life: 1,
      wall: p.wall,
    });
    if (s.trail.length > TRAIL_LIMIT) s.trail.shift();
  }
  s.trail.forEach((t) => (t.life -= h * 0.4));
  s.trail = s.trail.filter((t) => t.life > 0);
}

export function stepRun(s, dt, input) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
  const cmd = {
    axis: Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    run: Boolean(input.held('KeyX')),
  };
  if (input.pressed('Space')) s.player.jumpBuffer = JUMP_BUFFER;
  s.event = '';
  const frame = Math.min(dt, MAX_FRAME),
    n = Math.max(1, Math.ceil(frame / STEP - 1e-9)),
    h = frame / n;
  for (let i = 0; i < n && s.phase === 'playing'; i++) {
    tick(s, h, cmd);
    decorate(s, h);
  }
}

const STATE_NAMES = {
  run: { en: 'WALL-RUN', zh: '沿墙跑' },
  cling: { en: 'CLINGING', zh: '贴墙' },
  air: { en: 'AIRBORNE', zh: '空中' },
  ground: { en: 'RUNNING', zh: '地面' },
  pad: { en: 'RELAYING', zh: '接力补能' },
};
export function movementMode(s) {
  const p = s.player;
  if (p.running) return p.momentum > MOMENTUM_FLOOR ? 'run' : 'cling';
  if (padUnder(s)) return 'pad';
  return p.ground ? 'ground' : 'air';
}
function prompt(s) {
  const p = s.player,
    wall = wallContact(p, solidsOf(s)),
    t = (en, zh) => ({ en, zh });
  if (s.energy < 25 && !padUnder(s))
    return t('Low energy! Find a RELAY pad.', '能量不足！去找接力台。');
  if (padUnder(s)) return t('RELAY pad: energy refills here.', '接力台：在此恢复能量。');
  if (!p.ground && wall?.slick)
    return t('Slick wall: no run, no kick.', '湿滑墙：不能跑也不能蹬。');
  if (!p.ground && wall?.chalk) return t('Hold X to run up the chalk.', '按住X沿粉笔墙奔跑。');
  if (!p.ground && wall) {
    const ready = p.kickCooldown <= 0 && p.kickFace !== wall.face && s.energy > KICK_COST;
    return ready
      ? t('Space: kick away from the wall.', '空格：蹬离墙面。')
      : t('Kick spent here. Land or change wall.', '此墙已蹬过。落地或换一面墙。');
  }
  return COURSES[s.course - 1].hint;
}

export function createGame(env) {
  const s = createRunState();
  let ended = false;
  const finishRun = () => {
    if (ended || s.phase === 'playing') return;
    ended = true;
    const won = s.phase === 'won';
    env.sound(won ? 'win' : 'lose');
    env.end({
      won,
      score: s.score,
      message: won
        ? env.t('The relay is complete! All three courses cleared.', '接力完成！三条赛道全部通关。')
        : env.t(
            s.cause === 'energy'
              ? 'The energy reserve ran out. Refill at relay pads.'
              : 'You fell between the rooftops.',
            s.cause === 'energy' ? '能量耗尽了。请在接力台补充能量。' : '你从屋顶间坠落了。',
          ),
    });
  };
  return {
    update(dt, input) {
      if (s.phase !== 'playing' || ended) return;
      const course = s.course,
        lives = s.lives;
      stepRun(s, dt, input);
      if (s.lives < lives) env.sound('hit');
      else if (s.course > course) env.sound('coin');
      else if (s.event === 'jump' || s.event === 'kick') env.sound('move');
      else if (s.event === 'pad') env.sound('coin');
      finishRun();
    },
    draw(ctx) {
      drawRun(ctx, s, env);
    },
    getState() {
      const c = COURSES[s.course - 1],
        p = s.player;
      return {
        ...structuredClone(s),
        courseName: c.name,
        solids: c.solids.map((o) => structuredClone(o)),
        pads: PADS[s.course - 1].map((x) => ({ ...x })),
        goal: { ...c.goal },
        mode: movementMode(s),
        onPad: Boolean(padUnder(s)),
        wallContact: wallContact(p, c.solids),
        limits: {
          maxEnergy: MAX_ENERGY,
          kickCost: KICK_COST,
          jumpHeight: (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY),
          kickPush: KICK_PUSH,
          kickMaxRise: KICK_MAX_RISE,
        },
        status: {
          en: `Course ${s.course}/3 · Energy ${Math.ceil(s.energy)} · Lives ${s.lives} · ${STATE_NAMES[movementMode(s)].en}`,
          zh: `赛道${s.course}/3 · 能量${Math.ceil(s.energy)} · 生命${s.lives} · ${STATE_NAMES[movementMode(s)].zh}`,
        },
      };
    },
  };
}

const RUNNER = {
  idle: ['..hh...', '.hhhh..', '.hsss..', '..cc...', '.ccccc.', '.c.c...', '.b.b...', '.bb.bb.'],
  run1: ['..hh...', '.hhhh..', '.hsss..', '.cccc..', 'cc.cc..', '..bb...', '.b..b..', 'bb..bb.'],
  run2: ['..hh...', '.hhhh..', '.hsss..', '..ccc..', '.cc.cc.', '.bb.b..', '..bb...', '..b.bb.'],
  air: ['..hh...', '.hhhh..', '.hsss.c', 'cccccc.', '.cc.c..', '.bb.bb.', 'b....b.', '.......'],
  wall: ['.hh....', 'hhhh.c.', 'hsss.c.', '.ccccc.', '.ccc...', '.bb....', '.bbb...', '.b.b...'],
  kick: ['...hh..', '..hhhh.', '..hsss.', 'cccccc.', '.cc.c..', 'bb..bb.', 'b.....b', '.......'],
};
const RUNNER_COLORS = { h: '#2b2f4a', s: '#f2c9a0', c: '#e0614f', b: '#2d3a5a' };
const RUNNER_OUTLINE = { h: '#fff3c4', s: '#fff3c4', c: '#fff3c4', b: '#fff3c4' };
function flipRows(rows) {
  return rows.map((r) => [...r].reverse().join(''));
}

function drawSky(ctx, s, c) {
  const bands = c.sky;
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, i * 107, 480, 108);
  });
  const cam = s.camera;
  for (let layer = 0; layer < 2; layer++) {
    const par = layer ? 0.45 : 0.2,
      col = layer ? '#1c2a3a' : '#152233';
    for (let i = 0; i < 12; i++) {
      const w = 34 + ((i * 29 + layer * 13) % 30),
        hgt = 70 + ((i * 53 + layer * 31) % 90),
        x = ((i * 83 + layer * 41 - cam.x * par) % 1000) - 60,
        y = 330 - hgt - cam.y * par * 0.4;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, 420);
      ctx.fillStyle = layer ? '#f0c36a' : '#6d7f93';
      for (let wy = y + 8; wy < 320; wy += 14)
        for (let wx = x + 5; wx < x + w - 6; wx += 9) {
          if ((wx * 7 + wy * 3 + i) % 5 < 2) ctx.fillRect(wx, wy, 3, 4);
        }
    }
  }
}
function drawRain(ctx, s) {
  ctx.fillStyle = '#8fb3c9';
  for (let i = 0; i < 46; i++) {
    const x = (i * 97 + s.time * 60) % 500,
      y = (i * 61 + s.time * 330 + (i % 5) * 40) % 340;
    ctx.fillRect(x - 6, y - 6, 1, 6);
    ctx.fillRect(x - 3, y - 3, 1, 3);
  }
}
function drawBuilding(ctx, o, i, c, cam) {
  const x = Math.round(o.x - cam.x),
    y = Math.round(o.y - cam.y),
    h = Math.min(o.h, VIEW_H + 40 - Math.min(y, VIEW_H + 40));
  if (x > VIEW_W || x + o.w < 0 || y > VIEW_H + 10) return;
  ctx.fillStyle = c.brick[1];
  ctx.fillRect(x, y, o.w, h);
  ctx.fillStyle = c.brick[0];
  for (let by = y + 4; by < y + h; by += 8) {
    const off = ((by - y) / 8) % 2 ? 6 : 0;
    for (let bx = x + off; bx < x + o.w; bx += 12) ctx.fillRect(bx, by, 10, 3);
  }
  ctx.fillStyle = c.brick[2];
  ctx.fillRect(x - 2, y, o.w + 4, 5);
  ctx.fillStyle = '#0e1620';
  ctx.fillRect(x - 2, y + 5, o.w + 4, 2);
  ctx.fillStyle = '#9fc7d6';
  for (let wx = x + 8; wx < x + o.w - 10 && o.y > -100; wx += 22) ctx.fillRect(wx, y + 20, 5, 1);
  if (i % 2 === 0 && o.w > 50 && o.y > -100) {
    ctx.fillStyle = '#26303a';
    ctx.fillRect(x + o.w - 14, y - 9, 8, 9);
    ctx.fillStyle = '#4a5864';
    ctx.fillRect(x + o.w - 15, y - 11, 10, 3);
  } else if (o.w > 40 && o.y > -100) {
    ctx.fillStyle = '#7d8a96';
    ctx.fillRect(x + 8, y - 22, 1, 22);
    ctx.fillRect(x + 4, y - 18, 9, 1);
    ctx.fillRect(x + 5, y - 13, 7, 1);
  }
}
function drawFaces(ctx, o, cam, time) {
  const draw = (side, ranges, kind) =>
    ranges.forEach(([y0, y1]) => {
      const fx = Math.round((side === 'L' ? o.x : o.x + o.w) - cam.x),
        ex = side === 'L' ? fx - 4 : fx,
        top = Math.round(y0 - cam.y),
        len = y1 - y0;
      if (kind === 'chalk') {
        const cx = side === 'L' ? fx - 4 : fx + 3;
        ctx.fillStyle = 'rgba(20,28,40,0.55)';
        ctx.fillRect(cx - 3, top, 7, len);
        ctx.fillStyle = '#fffdf0';
        ctx.fillRect(side === 'L' ? fx - 2 : fx, top, 2, len);
        for (let k = 8; k < len + 6; k += 12) {
          const cy = top + len - k;
          ctx.fillRect(cx - 3, cy + 3, 2, 2);
          ctx.fillRect(cx - 2, cy + 2, 2, 2);
          ctx.fillRect(cx - 1, cy + 1, 3, 2);
          ctx.fillRect(cx + 1, cy + 2, 2, 2);
          ctx.fillRect(cx + 2, cy + 3, 2, 2);
        }
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(cx - 3, top - 2, 7, 2);
      } else {
        ctx.fillStyle = '#4fa3a5';
        ctx.fillRect(ex, top, 4, len);
        ctx.fillStyle = '#b4eef0';
        for (let k = 0; k < len; k += 16)
          ctx.fillRect(ex + (side === 'L' ? 0 : 2), top + ((k + time * 40) % len), 2, 4);
      }
    });
  draw('L', o.chalk.L, 'chalk');
  draw('R', o.chalk.R, 'chalk');
  draw('L', o.slick.L, 'slick');
  draw('R', o.slick.R, 'slick');
}
function drawPads(ctx, s, cam, active) {
  PADS[s.course - 1].forEach((pad) => {
    const x = Math.round(pad.x0 - cam.x),
      y = Math.round(pad.y - cam.y),
      w = pad.x1 - pad.x0,
      on = active && active.id === pad.id,
      seen = s.padsSeen.includes(pad.id);
    ctx.fillStyle = on ? '#ffd27a' : seen ? '#f0a04b' : '#c97a3c';
    ctx.fillRect(x, y - 3, w, 3);
    ctx.fillStyle = '#6a3a22';
    ctx.fillRect(x, y - 1, w, 1);
    ctx.fillStyle = on ? '#fff2c2' : '#ffd8a0';
    for (let k = 4; k < w - 4; k += 8) ctx.fillRect(x + k, y - 3, 4, 1);
    if (on) {
      const glow = 3 + Math.floor(Math.abs(Math.sin(s.time * 6)) * 4);
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(x, y - 3 - glow, w, 1);
      ctx.fillRect(x + 2, y - 5 - glow, w - 4, 1);
    }
  });
}
function drawPadLabels(ctx, s, active, env) {
  const cam = s.camera;
  PADS[s.course - 1].forEach((pad) => {
    const cx = ((pad.x0 + pad.x1) / 2 - cam.x) * ZOOM,
      sy = (pad.y - cam.y) * ZOOM + 6,
      on = active && active.id === pad.id;
    if (cx < 20 || cx > 460 || sy < 44 || sy > 290) return;
    text(ctx, env.t('RELAY', '接力'), cx, sy, on ? '#ffe9ab' : '#f0b36a', 14, 'center');
  });
}
function drawGoal(ctx, g, cam, time) {
  const x = Math.round(g.x - cam.x),
    y = Math.round(g.y - cam.y);
  ctx.fillStyle = '#8b97a3';
  ctx.fillRect(x + 7, y, 2, g.h);
  const wave = Math.round(Math.sin(time * 5) * 2);
  ctx.fillStyle = '#6fe0b8';
  ctx.fillRect(x + 9, y + 1, 12, 8);
  ctx.fillRect(x + 21, y + 2 + wave, 3, 6);
  ctx.fillStyle = '#e9fff5';
  ctx.fillRect(x + 11, y + 3, 4, 2);
  ctx.fillStyle = 'rgba(111,224,184,0.25)';
  ctx.fillRect(x - 2, y - 4, 24, 4);
}
function drawRunner(ctx, s, cam) {
  const p = s.player,
    mode = movementMode(s),
    frame = Math.floor(s.time * 10) % 2;
  let rows = RUNNER.idle;
  if (mode === 'run' || mode === 'cling') rows = RUNNER.wall;
  else if (!p.ground) rows = s.event === 'kick' || p.kickCooldown > 0.05 ? RUNNER.kick : RUNNER.air;
  else if (Math.abs(p.vx) > 20) rows = frame ? RUNNER.run1 : RUNNER.run2;
  const face = mode === 'run' || mode === 'cling' ? p.wall : p.facing;
  const x = Math.round(p.x - cam.x - 2),
    y = Math.round(p.y - cam.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 18, 10, 2);
  const shown = face < 0 ? flipRows(rows) : rows;
  [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].forEach(([dx, dy]) => pixelSprite(ctx, shown, x + dx, y + dy + 2, 2, RUNNER_OUTLINE));
  pixelSprite(ctx, shown, x, y + 2, 2, RUNNER_COLORS);
  if (mode === 'run') {
    ctx.fillStyle = '#cfe8f5';
    ctx.fillRect(Math.round(p.x - cam.x + (p.wall > 0 ? 10 : -2)), y + 18 + (frame ? 2 : 0), 2, 3);
  }
}
function drawTrail(ctx, s, cam) {
  s.trail.forEach((t) => {
    ctx.fillStyle = t.life > 0.6 ? '#e8f6ff' : t.life > 0.3 ? '#a6cde0' : '#6a92aa';
    const x = Math.round(t.x - cam.x),
      y = Math.round(t.y - cam.y);
    if (t.wall) {
      ctx.fillRect(x - 1, y - 2, 3, 4);
      ctx.fillRect(x + (t.wall > 0 ? 2 : -3), y - 1, 1, 2);
    } else {
      ctx.fillRect(x - 2, y - 2, 4, 2);
      ctx.fillRect(x - 1, y, 2, 1);
    }
  });
}
function drawHud(ctx, s, env) {
  const c = COURSES[s.course - 1];
  ctx.fillStyle = 'rgba(8,13,22,0.82)';
  ctx.fillRect(0, 0, 480, 40);
  text(ctx, `${s.course}/3 ${env.t(c.name.en, c.name.zh)}`, 8, 3, '#d8ecf2', 14);
  text(
    ctx,
    `${env.t('LIVES', '生命')} ${'♥'.repeat(Math.max(0, s.lives))}`,
    472,
    3,
    '#ff9a8a',
    14,
    'right',
  );
  const low = s.energy < 25;
  text(ctx, env.t('ENERGY', '能量'), 8, 21, low ? '#ff8a7a' : '#ffe08a', 14);
  const bx = env === null ? 0 : env.lang === 'zh' ? 56 : 80;
  ctx.fillStyle = '#1a2431';
  ctx.fillRect(bx, 23, 204, 12);
  ctx.fillStyle = low ? '#e0584a' : '#f4c24a';
  ctx.fillRect(bx + 2, 25, Math.round((s.energy / MAX_ENERGY) * 200), 8);
  ctx.fillStyle = '#fff6d0';
  for (let k = 1; k < 4; k++) ctx.fillRect(bx + 2 + k * 50, 25, 1, 8);
  text(ctx, String(Math.ceil(s.energy)), bx + 212, 21, low ? '#ff8a7a' : '#ffe08a', 14);
  text(
    ctx,
    `${env.t('PADS', '接力台')} ${s.padsSeen.length}/${PADS[s.course - 1].length}`,
    472,
    21,
    '#f0b36a',
    14,
    'right',
  );
}
function drawRun(ctx, s, env) {
  const c = COURSES[s.course - 1],
    cam = s.camera,
    pad = padUnder(s);
  background(ctx, c.sky[0]);
  drawSky(ctx, s, c);
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  c.solids.forEach((o, i) => drawBuilding(ctx, o, i, c, cam));
  c.solids.forEach((o) => drawFaces(ctx, o, cam, s.time));
  drawPads(ctx, s, cam, pad);
  drawGoal(ctx, c.goal, cam, s.time);
  drawTrail(ctx, s, cam);
  drawRunner(ctx, s, cam);
  ctx.restore();
  drawPadLabels(ctx, s, pad, env);
  drawRain(ctx, s);
  if (s.flash > 0) {
    ctx.fillStyle = `rgba(255,120,100,${(s.flash * 0.5).toFixed(2)})`;
    ctx.fillRect(0, 0, 480, 320);
  }
  drawHud(ctx, s, env);
  const msg = prompt(s);
  ctx.fillStyle = 'rgba(8,13,22,0.78)';
  ctx.fillRect(0, 296, 480, 24);
  text(ctx, env.t(msg.en, msg.zh), 240, 300, '#d8ecf2', 14, 'center');
  if (s.banner > 0) {
    ctx.fillStyle = 'rgba(8,13,22,0.8)';
    ctx.fillRect(60, 120, 360, 56);
    text(ctx, env.t('COURSE CLEAR', '赛道完成'), 240, 126, '#6fe0b8', 16, 'center');
    text(ctx, `${s.course}/3 ${env.t(c.name.en, c.name.zh)}`, 240, 148, '#d8ecf2', 14, 'center');
  }
}
