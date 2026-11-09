import { clamp } from '../shared/utils.js';
import { COURSES, PADS, BOTTOM } from './wallrunner-relay-levels.js';

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
const KICK_COOLDOWN = 0.1;
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
const START_LIVES = 5;
const FALL_Y = 380;
const APPROACH_WINDOW = 0.18;
const PAD_SCORE = 50;
const COURSE_SCORE = 300;
const TRAIL_LIMIT = 40;
export const ZOOM = 2;
export const VIEW_W = 480 / ZOOM;
export const VIEW_H = 320 / ZOOM;
const WALL_GRACE = 0.1;
const SAFE_TOP = 30; // world px of headroom kept below the HUD
const SAFE_BOTTOM = 138; // world px from the camera top to the lowest visible foot

export const LIMITS = Object.freeze({
  maxEnergy: MAX_ENERGY,
  kickCost: KICK_COST,
  startLives: START_LIVES,
  jumpHeight: (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY),
  kickPush: KICK_PUSH,
  kickMaxRise: KICK_MAX_RISE,
});

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
  // A jump pressed on the frame of a respawn is kept: no input is lost to a reset.
  Object.assign(p, newPlayer(), { facing: p.facing, jumpBuffer: p.jumpBuffer });
  p.x = (pad.x0 + pad.x1) / 2 - p.w / 2;
  p.y = pad.y - p.h;
  s.checkpoint = padId;
  s.focusY = pad.y;
}
function cameraBounds(course) {
  const roofs = course.solids.filter((x) => !x.boundary).map((x) => x.y);
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
    flash: 0,
    event: '',
    camera: { x: 0, y: 0 },
    trail: [],
    trailClock: 0,
    player: newPlayer(),
  };
  placeOnPad(s, 0);
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
  s.lives = START_LIVES;
  s.energy = MAX_ENERGY;
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
      // Speed into the wall: the recorded bump, or the current speed when contact began a hair early.
      const speed = Math.max(p.approachTimer > 0 ? p.approach : 0, Math.abs(p.vx));
      m = clamp(speed / MOMENTUM_REF, MOMENTUM_MIN, 1);
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
  const cmd = input,
    p = s.player,
    solids = solidsOf(s);
  s.time += h;
  s.courseClock += h;
  s.banner = Math.max(0, s.banner - h);
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

export function movementMode(s) {
  const p = s.player;
  if (p.running) return p.momentum > MOMENTUM_FLOOR ? 'run' : 'cling';
  if (padUnder(s)) return 'pad';
  return p.ground ? 'ground' : 'air';
}
