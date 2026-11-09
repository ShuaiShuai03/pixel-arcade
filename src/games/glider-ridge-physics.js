import { clamp } from '../shared/utils.js';
import {
  P,
  STEP,
  toward,
  terrainAt,
  liftCoefficient,
  speedState,
  G,
  WALL,
  MAX_DT,
  STALL_DROP,
  ELEV_UP,
  ELEV_DOWN,
  LAUNCH_SPEED,
  HOLD_SECONDS,
  MIN_SKIP_SECONDS,
  MESSAGE_SECONDS,
  TRIM_ALPHA,
  TRIM_SPEED,
  SPEED_STABILITY,
  FLARE_LOAD,
  FLARE_SINK_BASE,
  FLARE_SINK_GAIN,
  FLARE_K,
  HINT_STEP,
  BANK_PULL,
  GATE_SCORE,
} from './glider-ridge-world.js';
import { updateHints } from './glider-ridge-guidance.js';
import { COURSES } from './glider-ridge-levels.js';
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
    skipQueued: false,
    energy: { specific: 0, dissipated: 0, airGain: 0, last: null },
    events: [],
  };
  launch(s, c.start, -1);
  return s;
}
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
    say(s, 'All twenty ridges flown!', '二十条山脊全部飞完！');
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

function advance(s) {
  s.timer += STEP;
  const ready = s.timer >= HOLD_SECONDS || (s.skipQueued && s.timer >= MIN_SKIP_SECONDS);
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
  s.skipQueued = false;
  s.landing = null;
}

export function stepGlider(s, dt, input) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_DT || s.phase === 'won' || s.phase === 'lost')
    return;
  const held = (...k) => input.held(...k),
    ctl = {
      pitch: (held('ArrowUp', 'KeyW') ? 1 : 0) - (held('ArrowDown', 'KeyS') ? 1 : 0),
      steer: (held('ArrowLeft', 'KeyA') ? 1 : 0) - (held('ArrowRight', 'KeyD') ? 1 : 0),
      flare: Boolean(held('Space')),
    };
  // A confirm pressed during the pause is remembered until skipping is allowed, never dropped.
  if (s.phase !== 'playing' && input.pressed('Space', 'Enter')) s.skipQueued = true;
  s.acc += dt;
  const count = Math.floor(s.acc / STEP + 1e-9);
  if (count < 1) return;
  s.acc = Math.max(0, s.acc - count * STEP);
  for (let i = 0; i < count && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    s.time += STEP;
    if (s.message) {
      s.message.timer -= STEP;
      if (s.message.timer <= 0 && s.phase === 'playing') s.message = null;
    }
    if (s.phase !== 'playing') {
      advance(s);
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
