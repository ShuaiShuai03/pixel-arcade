import { HALF, RULES, STEP, colX, rowY } from './tether-twins-rules.js';
import { overlap, pulseLive, segHitsRect, worldOf } from './tether-twins-world.js';
import { ROOM_COUNT } from './tether-twins-rooms.js';
import { lengthOf, onPad, pointsOf, robotRect, solidsOf } from './tether-twins-body.js';
import { cableClear, updateCable } from './tether-twins-cable.js';
import { NAMES, refreshPrompt } from './tether-twins-guide.js';

const clampRoom = (n) => Math.min(ROOM_COUNT - 1, Math.max(0, Math.floor(Number(n)) || 0));

export function newState(env = {}, room = 0) {
  const s = {
    phase: 'playing',
    score: 0,
    cells: RULES.cells,
    room: 0,
    active: 0,
    mode: env.mode === 2 ? 2 : 1,
    ticks: 0,
    acc: 0,
    msg: null,
    zap: null,
    shown: null,
    shownAge: 0,
    paid: {},
    stats: { zaps: 0, snags: 0, rooms: 0 },
  };
  loadRoom(s, clampRoom(room));
  return s;
}

export function loadRoom(s, index, { tip = true } = {}) {
  const w = worldOf(index);
  s.room = index;
  s.robots = [0, 2].map((i) => ({
    x: colX(w.room.start[i]),
    y: rowY(w.room.start[i + 1]),
    vx: 0,
    vy: 0,
  }));
  s.len = w.room.len;
  s.bends = [];
  s.sides = [];
  s.open = {};
  s.latched = {};
  s.lit = w.plates.map(() => false);
  s.freeze = 0;
  s.clock = 0;
  s.tipLeft = tip ? RULES.tipTime : 0;
  s.stage = 0;
  s.resume = null;
  s.wrapped = false;
  s.taut = false;
  for (const id of Object.keys(w.gates)) s.open[id] = false;
  s.shown = null;
  refreshPrompt(s, w);
}

// --- Movement ---

function readCommand(input, s) {
  const axis = (neg, pos) => (input.held(...pos) ? 1 : 0) - (input.held(...neg) ? 1 : 0);
  const dirs =
    s.mode === 2
      ? [
          { dx: axis(['KeyA'], ['KeyD']), dy: axis(['KeyW'], ['KeyS']) },
          { dx: axis(['ArrowLeft'], ['ArrowRight']), dy: axis(['ArrowUp'], ['ArrowDown']) },
        ]
      : [0, 1].map((i) =>
          i === s.active
            ? {
                dx: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
                dy: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
              }
            : { dx: 0, dy: 0 },
        );
  const reel = (input.held('KeyF', 'Comma') ? 1 : 0) - (input.held('KeyG', 'Period') ? 1 : 0);
  return { dirs, reel };
}

// Corner assist: a robot that clips a wall corner by a few pixels is eased around it.
const CORNER = 4;
function slide(robot, dx, dy, solids, other) {
  const blockers = other ? [...solids, other] : solids;
  for (const axis of ['x', 'y']) {
    const d = axis === 'x' ? dx : dy;
    if (!d) continue;
    const side = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'w' : 'h';
    const sideSize = axis === 'x' ? 'h' : 'w';
    const start = robot[axis];
    robot[axis] += d;
    const hit = blockers.find((b) => overlap(robotRect(robot), b, -1e-6));
    if (!hit) continue;
    // Stop at the blocker's face, but never move farther than the requested step.
    const edge = d > 0 ? hit[axis] - HALF : hit[axis] + hit[size] + HALF;
    robot[axis] =
      d > 0
        ? Math.min(start + d, Math.max(start, edge))
        : Math.max(start + d, Math.min(start, edge));
    robot['v' + axis] = 0;
    const depth = Math.min(
      robot[side] + HALF - hit[side],
      hit[side] + hit[sideSize] - (robot[side] - HALF),
    );
    if (depth <= 0 || depth > CORNER) continue;
    const away = robot[side] < hit[side] + hit[sideSize] / 2 ? -1 : 1;
    const saved = robot[side];
    robot[side] += away * Math.min(depth, Math.abs(d) * 1.5);
    if (blockers.some((b) => overlap(robotRect(robot), b, -1e-6))) robot[side] = saved;
  }
}

const unit = (from, to) => {
  const d = Math.hypot(from.x - to.x, from.y - to.y) || 1;
  return { x: (from.x - to.x) / d, y: (from.y - to.y) / d };
};

// Remove only the velocity that would stretch the cable; the energy is dissipated, never added.
function limitTension(s, pts, path) {
  const slack = s.len - path;
  const dirs = [unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2])];
  const out = s.robots.map((r, i) => Math.max(0, r.vx * dirs[i].x + r.vy * dirs[i].y));
  const want = (out[0] + out[1]) * STEP;
  if (want <= 1e-12 || want <= slack) return;
  const keep = Math.max(0, slack) / want;
  s.robots.forEach((r, i) => {
    const cut = out[i] * (1 - keep);
    r.vx -= cut * dirs[i].x;
    r.vy -= cut * dirs[i].y;
  });
}

// Second-order tangential drift is removed by pulling both robots symmetrically along their segments.
function pullIn(s, w, solids) {
  for (let pass = 0; pass < 4; pass++) {
    const pts = pointsOf(s, w);
    const excess = lengthOf(pts) - s.len;
    if (excess <= 1e-7) return;
    const dirs = [unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2])];
    s.robots.forEach((r, i) => {
      const o = s.robots[1 - i];
      slide(r, (-dirs[i].x * excess) / 2, (-dirs[i].y * excess) / 2, solids, robotRect(o));
    });
  }
}

function moveRobots(s, w, cmd) {
  const before = s.robots.map((r) => ({ ...r }));
  const snapshot = { bends: [...s.bends], sides: [...s.sides] };
  // Winch: reeling in can only take up slack; paying out never moves a robot.
  const pts0 = pointsOf(s, w);
  const path0 = lengthOf(pts0);
  if (cmd.reel > 0) s.len = Math.max(RULES.minLen, path0, s.len - RULES.reel * STEP);
  if (cmd.reel < 0) s.len = Math.min(w.room.len, s.len + RULES.reel * STEP);
  // Accelerate toward the commanded velocity.
  s.robots.forEach((r, i) => {
    const d = cmd.dirs[i];
    const norm = d.dx && d.dy ? Math.SQRT1_2 : 1;
    const da = RULES.accel * STEP;
    r.vx += Math.max(-da, Math.min(da, d.dx * norm * RULES.speed - r.vx));
    r.vy += Math.max(-da, Math.min(da, d.dy * norm * RULES.speed - r.vy));
    const speed = Math.hypot(r.vx, r.vy);
    if (speed > RULES.speed) {
      r.vx *= RULES.speed / speed;
      r.vy *= RULES.speed / speed;
    }
  });
  limitTension(s, pts0, path0);
  const solids = solidsOf(s, w);
  // Robots resolve one after the other against the partner's current position; the order alternates.
  for (const i of s.ticks % 2 ? [1, 0] : [0, 1]) {
    const r = s.robots[i];
    slide(r, r.vx * STEP, r.vy * STEP, solids, robotRect(s.robots[1 - i]));
  }
  // Wrap points belong to fixed walls and posts, so a gate's state never decides a wrap.
  updateCable(s, w, before, solidsOf(s, w, false));
  pullIn(s, w, solids);
  const pts = pointsOf(s, w);
  if (!cableClear(pts, solids) || lengthOf(pts) > s.len + RULES.stretchTol) {
    // The cable would be dragged through a wall (or stretched): it snags and nothing moves.
    s.robots.forEach((r, i) => Object.assign(r, before[i], { vx: 0, vy: 0 }));
    s.bends = snapshot.bends;
    s.sides = snapshot.sides;
    s.stats.snags++;
  }
}

// --- Hazards, switches, pads ---

const say = (s, en, zh) => {
  s.msg = { en, zh, left: RULES.msgTime };
};

/** The strips that currently zap: static ones always, flashing ones only in their live phase. */
function liveHazards(w, clock) {
  return w.hazards.filter((h) => h.group < 0 || pulseLive(w.room.pulse, h.group, clock));
}

function checkHazards(s, w, emit) {
  // Both robots are tested the same way; a simultaneous touch costs one cell and names both.
  const live = liveHazards(w, s.clock);
  const hits = [0, 1].filter((i) => live.some((h) => overlap(robotRect(s.robots[i]), h, -0.5)));
  if (!hits.length) return false;
  s.cells--;
  s.stats.zaps++;
  const [first] = hits;
  s.zap = { x: s.robots[first].x, y: s.robots[first].y, who: hits, left: 0.6 };
  emit('hit');
  if (s.cells <= 0) {
    s.phase = 'lost';
    return true;
  }
  const zap = s.zap;
  loadRoom(s, s.room, { tip: false });
  s.zap = zap;
  s.freeze = RULES.freeze;
  const name = (lang) =>
    hits.length > 1 ? (lang === 'en' ? 'Both robots' : '两个机器人') : NAMES[first][lang];
  say(
    s,
    `${name('en')} hit a live strip. Room reset, ${s.cells} ${s.cells === 1 ? 'cell' : 'cells'} left`,
    `${name('zh')}碰到带电条。房间重置，剩余${s.cells}格电量`,
  );
  return true;
}

function updateSwitches(s, w, emit) {
  const pts = pointsOf(s, w);
  const touches = (r, g = 0) => {
    for (let i = 1; i < pts.length; i++) if (segHitsRect(pts[i - 1], pts[i], r, g)) return true;
    return false;
  };
  const powered = {};
  w.plates.forEach((p, i) => {
    s.lit[i] = touches(p);
    if (s.lit[i]) powered[p.gate] = true;
  });
  const taut = lengthOf(pts) >= s.len - RULES.tautEps;
  s.taut = taut;
  s.wrapped = s.bends.some((b) => w.pegs[b].post >= w.relayFirst);
  w.posts.forEach((p, i) => {
    if (i < w.relayFirst || s.latched[p.gate] || !taut) return;
    if (s.bends.some((b) => w.pegs[b].post === i)) {
      s.latched[p.gate] = true;
      const keep = s.bends.map((b) => w.pegs[b].post !== i);
      s.sides = s.sides.filter((_, k) => keep[k]);
      s.bends = s.bends.filter((_, k) => keep[k]);
      emit('coin');
      say(s, `Relay locked: gate ${p.gate} stays open`, `继电器已锁定：闸门${p.gate}保持开启`);
    }
  });
  for (const [id, cells] of Object.entries(w.gates)) {
    const held =
      s.open[id] &&
      cells.some(
        (c) =>
          s.robots.some((r) => overlap(robotRect(r), c, RULES.gateGrow)) ||
          touches(c, RULES.gateGrow),
      );
    const next = !!(powered[id] || s.latched[id] || held);
    if (next && !s.open[id]) {
      emit('move');
      if (!s.paid[`${s.room}${id}`]) {
        s.paid[`${s.room}${id}`] = true;
        s.score += RULES.gateScore;
        if (!s.latched[id]) say(s, `Gate ${id} opens`, `闸门${id}开启`);
      }
    }
    s.open[id] = next;
  }
}

const padsReached = (s, w) => s.robots.every((r, i) => onPad(r, w.pads[i]));

function clearRoom(s, emit) {
  s.score += RULES.roomScore + RULES.cellScore * s.cells;
  s.stats.rooms++;
  if (s.room + 1 >= ROOM_COUNT) {
    s.phase = 'won';
    return;
  }
  emit('coin');
  const index = s.room + 1;
  const had = s.cells;
  s.cells = Math.min(RULES.cells, s.cells + 1);
  loadRoom(s, index);
  s.active = 0;
  say(
    s,
    `Room ${index} clear! ${had === s.cells ? '' : 'A cell recharges. '}Next room`,
    `第${index}间完成！${had === s.cells ? '' : '回复一格电量。'}进入下一间`,
  );
}

function tick(s, cmd, emit) {
  const w = worldOf(s.room);
  s.ticks++;
  s.clock += STEP;
  s.shownAge += STEP;
  if (s.tipLeft > 0) s.tipLeft = Math.max(0, s.tipLeft - STEP);
  if (s.msg && (s.msg.left -= STEP) <= 0) s.msg = null;
  if (s.zap && (s.zap.left -= STEP) <= 0) s.zap = null;
  if (s.freeze > 0) {
    s.freeze = Math.max(0, s.freeze - STEP);
    refreshPrompt(s, w);
    return;
  }
  moveRobots(s, w, cmd);
  if (checkHazards(s, w, emit)) return;
  updateSwitches(s, w, emit);
  if (padsReached(s, w)) clearRoom(s, emit);
  else refreshPrompt(s, w);
}

// --- Public update loop ---

const STILL = { dx: 0, dy: 0 };
const IDLE_COMMAND = { dirs: [STILL, STILL], reel: 0 };

/** Advance by `dt` seconds. Returns false (and changes nothing) for a bad dt or a finished run. */
export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (s.mode !== 2 && input.pressed('KeyX')) {
    s.active = 1 - s.active;
    emit('move');
    say(s, `Now controlling ${NAMES[s.active].en}`, `现在控制${NAMES[s.active].zh}`);
  }
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  // The command is read per tick so a mid-update room change or freeze end behaves the same at any frame rate.
  for (let n = 0; n < steps && s.phase === 'playing'; n++)
    tick(s, s.freeze > 0 ? IDLE_COMMAND : readCommand(input, s), emit);
  return true;
}
