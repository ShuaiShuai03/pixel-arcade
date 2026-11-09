// Courier rules: state, handling actions, buffered inputs and the fixed-step integrator.
import { COURIER_ROOMS, LEVEL_COUNT } from './gravity-courier-rooms.js';
import {
  DOCK_RADIUS,
  DOCK_SPEED,
  EPS,
  GEOM,
  carried,
  nextMotionEvent,
  room,
  trajectory,
} from './gravity-courier-physics.js';

const SPARES = 3,
  FLIP_COOLDOWN = 0.24,
  FLIP_BUFFER = FLIP_COOLDOWN,
  HANDOFF_BUFFER = 0.25,
  REPACK_TIME = 0.7,
  MAX_FRAME = 1 / 30,
  SUBSTEPS_PER_SECOND = 240,
  MAX_EVENTS = 100;
const axisOf = (input) =>
  Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA'));

export function createCourierState(level = 1) {
  const r = COURIER_ROOMS[level - 1];
  return {
    phase: 'playing',
    mode: 'flying',
    level,
    score: 0,
    time: 0,
    gravity: r.source.side,
    player: { x: r.source.x, y: r.source.y, w: 20, h: 24, vx: 0, vy: 0 },
    parcel: {
      status: 'stored',
      integrity: r.integrity,
      maxIntegrity: r.integrity,
      safeSpeed: r.safeSpeed,
      mass: r.mass,
    },
    spares: SPARES,
    deliveries: 0,
    repacks: 0,
    flips: 0,
    flipReadyAt: 0,
    flipIntent: null,
    interactIntent: null,
    repackLeft: 0,
    impacts: [],
    feedback: 'welcome',
    feedbackTime: 4,
    flash: 0,
  };
}
function say(s, kind, time = 2) {
  s.feedback = kind;
  s.feedbackTime = time;
}
function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.mode = 'terminal';
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: won
      ? env.t('Every fragile shipment delivered!', '所有易碎邮件均已送达！')
      : env.t(
          'No spare packaging remains. Start a new courier shift.',
          '备用包装已用完。请开始新的信使任务。',
        ),
  });
}
function impact(s, hits, before, env) {
  const x = hits.some((h) => h.nx),
    y = hits.some((h) => h.ny),
    speed = Math.hypot(x ? before.vx : 0, y ? before.vy : 0);
  let damage = 0;
  if (carried(s) && s.parcel.integrity > 0 && speed > s.parcel.safeSpeed + GEOM) {
    damage = 1 + Number(speed > 2 * s.parcel.safeSpeed + GEOM);
    s.parcel.integrity = Math.max(0, s.parcel.integrity - damage);
    s.flash = 0.45;
    say(s, s.parcel.integrity ? 'damaged' : 'broken', 3);
    env.sound('hit');
  }
  if (speed > EPS)
    s.impacts.push({
      time: s.time,
      speed,
      damage,
      normals: hits.map((h) => ({ x: h.nx, y: h.ny })),
      integrity: s.parcel.integrity,
    });
  s.impacts = s.impacts.slice(-16);
  if (damage && s.parcel.integrity === 0 && s.spares === 0) finish(s, env, false);
}
function atPad(s, pad) {
  const p = s.player;
  return (
    Math.abs(p.x - pad.x) <= DOCK_RADIUS &&
    Math.abs(p.y - pad.y) <= GEOM &&
    Math.abs(p.vx) <= DOCK_SPEED &&
    Math.abs(p.vy) <= EPS &&
    s.gravity === pad.side
  );
}
function interact(s, env) {
  const r = room(s),
    p = s.player;
  if (carried(s) && atPad(s, r.destination)) {
    if (!s.parcel.integrity) {
      say(s, 'return', 3);
      s.interactIntent = null;
      return;
    }
    s.parcel.status = 'delivered';
    s.score += 300 + s.parcel.integrity * 60;
    s.deliveries++;
    s.interactIntent = null;
    s.flipIntent = null;
    p.vx = 0;
    p.vy = 0;
    env.sound('win');
    if (s.level === LEVEL_COUNT) finish(s, env, true);
    else {
      s.mode = 'clear';
      say(s, 'clear', 4);
    }
    return;
  }
  if (atPad(s, r.source)) {
    if (s.parcel.status === 'stored') {
      p.vx /= 1 + s.parcel.mass;
      s.parcel.status = 'carried';
      s.interactIntent = null;
      say(s, 'carrying', 3);
      env.sound('coin');
    } else if (carried(s) && s.parcel.integrity < s.parcel.maxIntegrity) {
      if (!s.spares) {
        say(s, 'no-spare', 3);
        s.interactIntent = null;
        if (!s.parcel.integrity) finish(s, env, false);
        return;
      }
      s.spares--;
      s.mode = 'repack';
      s.repackLeft = REPACK_TIME;
      s.interactIntent = null;
      s.flipIntent = null;
      say(s, 'repack');
      env.sound('move');
    } else {
      s.interactIntent = null;
      say(s, 'loaded');
    }
  }
}
function actions(s, env) {
  if (s.mode !== 'flying') return;
  if (s.interactIntent !== null) {
    if (s.time <= s.interactIntent + EPS) interact(s, env);
    else {
      s.interactIntent = null;
      say(s, 'pad');
    }
  }
  if (s.mode !== 'flying') return;
  if (s.flipIntent !== null) {
    if (s.time > s.flipIntent + EPS) s.flipIntent = null;
    else if (s.time >= s.flipReadyAt - EPS) {
      s.gravity *= -1;
      s.flipReadyAt = s.time + FLIP_COOLDOWN;
      s.flipIntent = null;
      s.flips++;
      say(s, 'flip', 1);
      env.sound('move');
      if (s.interactIntent !== null && s.time <= s.interactIntent + EPS) interact(s, env);
    }
  }
}
function inputFrame(s, input, env) {
  if (s.mode === 'clear') {
    if (input.pressed('KeyX', 'Enter')) nextRoom(s, env);
    return;
  }
  if (s.mode !== 'flying' && s.mode !== 'repack') return;
  if (input.pressed('Space', 'KeyW', 'ArrowUp')) {
    const wait = s.mode === 'repack' ? s.repackLeft : 0;
    s.flipIntent = s.time + wait + FLIP_BUFFER;
  }
  if (s.mode !== 'flying') return;
  if (input.pressed('KeyX', 'Enter')) s.interactIntent = s.time + HANDOFF_BUFFER;
  actions(s, env);
}
function advance(s, t) {
  s.time += t;
  s.feedbackTime = Math.max(0, s.feedbackTime - t);
  s.flash = Math.max(0, s.flash - t);
}
function nextRoom(s, env) {
  const { score, time, deliveries, repacks, flips } = s;
  Object.assign(s, createCourierState(s.level + 1), { score, time, deliveries, repacks, flips });
  env.sound('move');
}
function integrate(s, dt, input, env) {
  let left = dt,
    events = 0;
  while (left > EPS && s.phase === 'playing') {
    if (++events > MAX_EVENTS) throw new Error('Courier event loop failed to make progress');
    if (s.mode === 'clear') {
      advance(s, left);
      return;
    }
    actions(s, env);
    if (s.phase !== 'playing') return;
    const axis = s.mode === 'repack' ? 0 : axisOf(input),
      tr = trajectory(s, axis);
    let limit = left;
    for (const t of [s.flipIntent, s.interactIntent, s.flipIntent !== null ? s.flipReadyAt : null])
      if (t !== null && t > s.time + EPS) limit = Math.min(limit, t - s.time);
    if (s.mode === 'repack') limit = Math.min(limit, s.repackLeft);
    const event = nextMotionEvent(s, tr, limit),
      t = event.time,
      q = tr.at(t);
    Object.assign(s.player, { x: q.x, y: q.y, vx: q.vx, vy: q.vy });
    advance(s, t);
    left -= t;
    if (s.mode === 'repack') {
      s.repackLeft -= t;
      if (s.repackLeft <= EPS) {
        s.repackLeft = 0;
        s.parcel.integrity = s.parcel.maxIntegrity;
        s.repacks++;
        s.mode = 'flying';
        say(s, 'repacked', 2);
        env.sound('coin');
      }
    }
    if (event.hits.length) {
      const before = { vx: s.player.vx, vy: s.player.vy };
      for (const hit of event.hits) {
        s.player[hit.dimension] = hit.value;
        if (hit.nx) s.player.vx = 0;
        if (hit.ny) s.player.vy = 0;
      }
      impact(s, event.hits, before, env);
    }
    if (s.flipIntent !== null && s.time >= s.flipIntent - EPS && s.time < s.flipReadyAt - EPS)
      s.flipIntent = null;
    if (s.interactIntent !== null && s.time >= s.interactIntent - EPS) {
      actions(s, env);
      s.interactIntent = null;
    }
    if (s.phase === 'playing') actions(s, env);
  }
}
export function stepCourier(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  inputFrame(s, input, env);
  if (s.phase !== 'playing') return;
  const duration = Math.min(dt, MAX_FRAME),
    count = Math.max(1, Math.ceil(duration * SUBSTEPS_PER_SECOND - EPS));
  for (let i = 0; i < count && s.phase === 'playing'; i++)
    integrate(s, duration / count, input, env);
}
