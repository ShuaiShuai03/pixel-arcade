import { clamp } from '../shared/utils.js';
import {
  PLAN_GLIDE,
  wrap,
  terrainAt,
  speedState,
  FLARE_WINDOW,
  FLARE_LEVEL,
  FLARE_HEADING,
  REDO_AIM,
  REDO_STEER,
  DESCEND_GATE_GAP,
  DESCEND_KEEP_GAP,
  DESCEND_MIN_AGL,
  CIRCLE_MIN_AGL,
  FAST_ALPHA_MAX,
  FAST_COOLDOWN,
  FAST_ON,
  FAST_OFF,
  EDGE_Z,
  EDGE_X,
  EDGE_CLEAR,
  FLARE_CLEAR,
  HINT_DWELL,
  STEER_BAND,
  STEER_END,
  URGENT,
  MISSED_BEHIND,
  PLAN_SPEED,
  WINDOW_MARGIN,
  CLIMB_MARGIN,
  LIFT_NEAR,
  CIRCLE_GAP,
  PATH_CLEAR,
  PATH_HIGH,
  PATH_LOW,
  PATH_AIM,
  PATH_SLOPE,
  TERRAIN_MARGIN,
  DIVE_CLEARANCE,
} from './glider-ridge-world.js';
import { COURSES } from './glider-ridge-levels.js';
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
export function statusText(s, c) {
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

export const nearEdge = (s, c, margin = 0) =>
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
export function updateHints(s) {
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

export function prompt(s, g, c, env) {
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
