import {
  ARENA,
  BODY,
  DEG,
  STEP,
  angleTo,
  deepFreeze,
  distTo,
  separate,
  shapeHitsBody,
  slide,
} from './dash-duelist-geometry.js';
import {
  HEAVY_DAMAGE,
  LEVEL_COUNT,
  RIVAL_NAMES,
  levelNumber,
  levelOf,
} from './dash-duelist-levels.js';

const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
export const PLAYER = Object.freeze({
  speed: 110,
  maxHp: 5,
  strikeStartup: 0.08,
  strikeActive: 0.1,
  strikeRecover: 0.3,
  strikeRange: 40,
  strikeHalf: 60 * DEG,
  stagger: 0.25,
  hitInvuln: 0.9,
  knockback: 16,
  dashTime: 0.32,
  dashSpeed: 230,
  dashInvuln: 0.4,
  maxCharges: 3,
  rechargeTime: 2.2,
  buffer: 0.25,
});
const P = PLAYER;
const MSG_SECONDS = 0.9;
const BETWEEN_SECONDS = 1.6;
export const ENTER_SECONDS = 2;
export const TIP_SECONDS = 5;
// A heavy shape says "dash NOW" this long before it fires. The dash protects for 0.4 s, so a
// press 0.2-0.5 s after that word (a fast or a slow player) still covers the 0.1 s hit.
export const DASH_NOW = 0.5;
const FIRST_GAP = 0.6;
const GAP_JITTER = 0.5;
const FLINCH_SECONDS = 0.2;
const RIVAL_KNOCKBACK = 8;
export const FX_SECONDS = 0.35;
const SCORE_HIT = 50;
const SCORE_DODGE = 25;
const SCORE_LEVEL = 300;
const SCORE_HP = 100;
const MAX_FX = 24;
const START = Object.freeze({ x: 100, y: 168 });

const DIRS = {
  Left: ['Left', '左侧'],
  Right: ['Right', '右侧'],
  Up: ['Up', '上方'],
  Down: ['Down', '下方'],
};
const sourceSide = (angle) => {
  const dx = -Math.cos(angle),
    dy = -Math.sin(angle);
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'Left' : 'Right';
  return dy < 0 ? 'Up' : 'Down';
};

export const PROMPTS = deepFreeze({
  enter: ['Arrows move · Space strike · X dash', '方向键移动 · 空格出招 · X闪身'],
  idle: ['Keep your distance · wait for the windup', '保持距离 · 等待对手起手'],
  open: ['OPEN! Close in and press Space', '破绽！贴近并按空格出招'],
  between: ['Duel won! HP restored, next level comes', '决斗获胜！生命恢复，进入下一关'],
  won: [`Victory! All ${LEVEL_COUNT} duels are won`, `胜利！${LEVEL_COUNT}场决斗全部获胜`],
  lost: ['Defeated. Press Restart to duel again', '落败。点击重新开始再战'],
});
export function dangerPrompt(step, angle, charges, remaining) {
  const dash = charges >= 1,
    ring = step.shape === 'ring',
    heavy = !!step.heavy;
  const side = ring ? ['', ''] : DIRS[sourceSide(angle)];
  const tail = heavy
    ? dash
      ? remaining > DASH_NOW
        ? ['Wait for the fill', '等待填满']
        : ['X: dash NOW!', '现在按X闪身！']
      : ['No dash: run!', '无闪身：快跑！']
    : dash
      ? [
          ring ? 'Run out or X: dash' : 'Sidestep or X: dash',
          ring ? '跑出圈外或按X闪身' : '侧移或按X闪身',
        ]
      : [
          ring ? 'No dash: run out!' : 'No dash: sidestep!',
          ring ? '无闪身：跑出圈外！' : '无闪身：请侧移！',
        ];
  const head = [
    `${heavy ? 'HEAVY ' : ''}${step.label[0]}${ring ? '' : ` from the ${side[0]}`}!`,
    `${heavy ? '重击' : ''}${step.label[1]}${ring ? '' : `来自${side[1]}`}！`,
  ];
  return [`${head[0]} ${tail[0]}`, `${head[1]}${tail[1]}`];
}

// ----------------------------------------------------------------- world

export function createWorld(random, level = 1) {
  const w = {
    random,
    time: 0,
    acc: 0,
    phase: 'playing',
    score: 0,
    level: levelNumber(level),
    levelT: 0,
    between: 0,
    events: [],
    msg: null,
    fx: [],
    buf: null,
    defeated: null,
    p: {
      x: START.x,
      y: START.y,
      hp: P.maxHp,
      charges: P.maxCharges,
      state: 'free',
      t: 0,
      face: 0,
      strike: null,
      dash: null,
      dashInv: 0,
      hitInv: 0,
    },
    r: null,
    stats: { hits: 0, dodges: 0, damageTaken: 0 },
  };
  spawnRival(w);
  return w;
}

function spawnRival(w) {
  const cfg = levelOf(w.level).rival;
  const fromRight = w.p.x < (ARENA.x0 + ARENA.x1) / 2;
  w.levelT = 0;
  w.r = {
    cfg,
    x: fromRight ? ARENA.x1 - 8 : ARENA.x0 + 8,
    y: START.y,
    hp: cfg.hp,
    state: 'enter',
    t: ENTER_SECONDS,
    gapT: FIRST_GAP,
    patternIndex: 0,
    stepIndex: 0,
    atk: null,
    flinch: 0,
  };
}

const pushFx = (w, kind, x, y) => {
  w.fx.push({ kind, x, y, t: FX_SECONDS });
  if (w.fx.length > MAX_FX) w.fx.shift();
};
const say = (w, en, zh) => {
  w.msg = { en, zh, t: MSG_SECONDS };
};

export const playerInvulnerable = (p) => p.dashInv > 0 || p.hitInv > 0;
export const chargeCount = (p) => Math.floor(p.charges + 1e-9);

// ---- player

function startStrike(w, aim) {
  const p = w.p;
  p.state = 'strike';
  p.strike = {
    t: 0,
    shape: 'sector',
    ox: p.x,
    oy: p.y,
    angle: aim,
    r1: P.strikeRange,
    half: P.strikeHalf,
    hit: false,
    clanged: false,
  };
  w.events.push('strike');
}

function startDash(w, inp) {
  const p = w.p;
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
    dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (!dx && !dy) {
    const away = w.r ? angleTo(w.r, p) : Math.PI;
    dx = Math.cos(away);
    dy = Math.sin(away);
  }
  const len = Math.hypot(dx, dy);
  p.charges -= 1;
  p.state = 'dash';
  p.dash = { t: P.dashTime, dx: dx / len, dy: dy / len };
  p.dashInv = P.dashInvuln;
  w.events.push('dash');
}

function takeAction(w, action, inp) {
  if (action === 'strike') return startStrike(w, w.r ? angleTo(w.p, w.r) : 0);
  if (chargeCount(w.p) < 1) {
    say(w, 'No dash charge', '没有闪身次数');
    return;
  }
  startDash(w, inp);
}

function playerTick(w, inp) {
  const p = w.p,
    r = w.r;
  p.charges = Math.min(P.maxCharges, p.charges + STEP / P.rechargeTime);
  p.dashInv = Math.max(0, p.dashInv - STEP);
  p.hitInv = Math.max(0, p.hitInv - STEP);
  if (r) p.face = angleTo(p, r);
  const wanted = inp.dash ? 'dash' : inp.strike ? 'strike' : null;
  if (wanted) w.buf = { action: wanted, t: P.buffer };
  else if (w.buf) {
    w.buf.t -= STEP;
    if (w.buf.t <= 0) w.buf = null;
  }
  if (p.state === 'stagger') {
    p.t -= STEP;
    if (p.t <= 0) p.state = 'free';
  } else if (p.state === 'dash') {
    p.dash.t -= STEP;
    slide(p, r, p.dash.dx * P.dashSpeed * STEP, p.dash.dy * P.dashSpeed * STEP);
    if (p.dash.t <= 0) {
      p.state = 'free';
      p.dash = null;
    }
  } else if (p.state === 'strike') {
    p.strike.t += STEP;
    if (p.strike.t >= P.strikeStartup + P.strikeActive + P.strikeRecover) {
      p.state = 'free';
      p.strike = null;
    }
  }
  if (p.state !== 'free') return;
  if (w.buf) {
    const action = w.buf.action;
    w.buf = null;
    takeAction(w, action, inp);
    if (p.state !== 'free') return;
  }
  const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
    dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  slide(p, r, (dx / len) * P.speed * STEP, (dy / len) * P.speed * STEP);
}

export const strikeActive = (s) => s.t >= P.strikeStartup && s.t < P.strikeStartup + P.strikeActive;

// ---- rival

function startStep(w) {
  const r = w.r,
    pattern = r.cfg.patterns[r.patternIndex],
    step = pattern.steps[r.stepIndex];
  r.atk = {
    step,
    shape: step.shape,
    ox: r.x,
    oy: r.y,
    angle: angleTo(r, w.p),
    r1: step.r1,
    half: step.half,
    len: step.len,
    hw: step.hw,
    t: step.windup,
    hit: false,
    dodged: false,
    lunged: 0,
  };
  r.state = 'windup';
  w.events.push('windup');
}

function finishStep(w) {
  const r = w.r,
    pattern = r.cfg.patterns[r.patternIndex],
    a = r.atk;
  if (a.dodged && !a.hit) {
    w.score += SCORE_DODGE;
    w.stats.dodges++;
    say(w, 'Dash dodge! +25', '闪身躲开！+25');
    w.events.push('dodge');
  }
  if (r.stepIndex + 1 < pattern.steps.length) {
    r.stepIndex++;
    startStep(w);
    return;
  }
  r.state = 'recover';
  r.t = pattern.recover;
  r.atk = null;
  w.events.push('open');
}

function rivalTick(w) {
  const r = w.r,
    p = w.p;
  r.flinch = Math.max(0, r.flinch - STEP);
  if (r.state === 'enter') {
    r.t -= STEP;
    if (r.t <= 0) r.state = 'idle';
  } else if (r.state === 'idle') {
    r.gapT -= STEP;
    if (distTo(r, p) > r.cfg.trigger) {
      const a = angleTo(r, p);
      slide(r, p, Math.cos(a) * r.cfg.speed * STEP, Math.sin(a) * r.cfg.speed * STEP);
    } else if (r.gapT <= 0) {
      r.stepIndex = 0;
      startStep(w);
    }
  } else if (r.state === 'windup') {
    r.atk.t -= STEP;
    if (r.atk.t <= 0) {
      r.state = 'active';
      r.atk.t = r.atk.step.active;
    }
  } else if (r.state === 'active') {
    const a = r.atk;
    a.t -= STEP;
    if (a.step.lunge) {
      const move = Math.min(a.step.lunge - a.lunged, (a.step.lunge / a.step.active) * STEP);
      slide(r, p, Math.cos(a.angle) * move, Math.sin(a.angle) * move);
      a.lunged += move;
    }
    if (a.t <= 0) finishStep(w);
  } else if (r.state === 'recover') {
    r.t -= STEP;
    if (r.t <= 0) {
      r.patternIndex = (r.patternIndex + 1) % r.cfg.patterns.length;
      r.state = 'idle';
      r.gapT = r.cfg.gap + w.random() * GAP_JITTER;
    }
  }
}

export const rivalVulnerable = (r) => !!r && r.state === 'recover';

// ---- hit resolution

function resolveHits(w) {
  const { p, r } = w;
  // Every candidate is judged against the state at the start of this resolution, then applied
  // together, so neither side wins a tie because of evaluation order.
  const s = p.state === 'strike' && strikeActive(p.strike) && !p.strike.hit ? p.strike : null;
  const canHurt = rivalVulnerable(r);
  const strikeTouches = !!s && shapeHitsBody(s, r);
  const a = r.state === 'active' ? r.atk : null;
  let rivalLands = false;
  if (a && !a.hit && shapeHitsBody(a, p)) {
    if (p.dashInv > 0) a.dodged = true;
    else rivalLands = p.hitInv <= 0;
  }
  if (strikeTouches && !canHurt && !s.clanged) {
    s.clanged = true;
    say(w, 'Guarded! Wait for OPEN', '被格挡！等待破绽');
    w.events.push('guard');
    pushFx(w, 'clang', r.x, r.y - 4);
  }
  if (rivalLands) {
    a.hit = true;
    const dmg = a.step.heavy ? HEAVY_DAMAGE : 1;
    p.hp -= dmg;
    p.hitInv = P.hitInvuln;
    p.state = 'stagger';
    p.t = P.stagger;
    p.strike = null;
    w.stats.damageTaken += dmg;
    const away = angleTo(r, p);
    slide(p, r, Math.cos(away) * P.knockback, Math.sin(away) * P.knockback);
    say(w, `Hit! -${dmg} HP`, `被击中！-${dmg} 生命`);
    w.events.push('hurt');
    pushFx(w, 'hurt', p.x, p.y);
  }
  if (strikeTouches && canHurt) {
    s.hit = true;
    r.hp -= 1;
    r.flinch = FLINCH_SECONDS;
    r.t = Math.min(r.t, FLINCH_SECONDS); // the opening closes after one clean hit
    w.score += SCORE_HIT;
    w.stats.hits++;
    const away = angleTo(p, r);
    slide(r, p, Math.cos(away) * RIVAL_KNOCKBACK, Math.sin(away) * RIVAL_KNOCKBACK);
    say(w, 'Rival staggered! -1', '对手踉跄！-1');
    w.events.push('stagger');
    pushFx(w, 'spark', r.x, r.y);
  }
  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = 'lost';
  } else if (r.hp <= 0) defeatRival(w);
}

function defeatRival(w) {
  const r = w.r;
  w.score += SCORE_LEVEL + SCORE_HP * w.p.hp;
  w.events.push('defeat');
  if (w.level >= LEVEL_COUNT) {
    w.phase = 'won';
    return;
  }
  w.between = BETWEEN_SECONDS;
  w.defeated = { x: r.x, y: r.y, cfg: r.cfg };
  w.r = null;
  w.msg = null;
}

function nextLevel(w) {
  w.between = 0;
  w.level++;
  w.defeated = null;
  w.buf = null;
  w.p.hp = P.maxHp;
  w.p.charges = P.maxCharges;
  w.events.push('level');
  spawnRival(w);
}

function tick(w, inp) {
  w.time += STEP;
  w.levelT += STEP;
  w.fx = w.fx.filter((f) => (f.t -= STEP) > 0);
  if (w.msg && (w.msg.t -= STEP) <= 0) w.msg = null;
  if (w.between > 0) {
    w.between -= STEP;
    if (w.between <= 1e-9) nextLevel(w);
  }
  playerTick(w, inp);
  if (!w.r) return;
  rivalTick(w);
  separate(w.p, w.r);
  resolveHits(w);
}

const readInput = (input, first) => ({
  left: input.held('ArrowLeft', 'KeyA'),
  right: input.held('ArrowRight', 'KeyD'),
  up: input.held('ArrowUp', 'KeyW'),
  down: input.held('ArrowDown', 'KeyS'),
  strike: first && input.pressed('Space'),
  dash: first && input.pressed('KeyX'),
});

/** Only a finite, positive frame time of at most one second is a real frame. */
export const validDt = (dt) => Number.isFinite(dt) && dt > 0 && dt <= MAX_ACCEPTED_DT;

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !validDt(dt)) return;
  w.events = [];
  w.acc += Math.min(dt, MAX_FRAME);
  let first = true;
  while (w.acc + 1e-9 >= STEP && w.phase === 'playing') {
    w.acc -= STEP;
    tick(w, readInput(input, first));
    first = false;
  }
  if (Math.abs(w.acc) < 1e-9) w.acc = 0;
}

// ------------------------------------------------------- readable state

export function promptFor(w) {
  if (w.phase === 'won' || w.phase === 'lost') return PROMPTS[w.phase];
  const r = w.r;
  if (!r) return PROMPTS.between;
  if (r.state === 'enter') return PROMPTS.enter;
  if (r.state === 'windup' || r.state === 'active')
    return dangerPrompt(
      r.atk.step,
      r.atk.angle,
      chargeCount(w.p),
      r.state === 'active' ? 0 : r.atk.t,
    );
  if (r.state === 'recover') return PROMPTS.open;
  return PROMPTS.idle;
}

function statusFor(w) {
  const [pEn, pZh] = promptFor(w);
  const lead = w.r
    ? [`Level ${w.level}/${LEVEL_COUNT}`, `第${w.level}/${LEVEL_COUNT}关`]
    : [`Level ${w.level}/${LEVEL_COUNT} won`, `第${w.level}/${LEVEL_COUNT}关获胜`];
  const dash = chargeCount(w.p);
  const en = [lead[0], `HP ${w.p.hp}`, `Dash ${dash}`],
    zh = [lead[1], `生命 ${w.p.hp}`, `闪身 ${dash}`];
  if (w.msg) {
    en.push(w.msg.en);
    zh.push(w.msg.zh);
  }
  en.push(pEn);
  zh.push(pZh);
  return { en: en.join(' · '), zh: zh.join(' · ') };
}

const rect = (b) => ({ x: b.x, y: b.y, w: BODY.hw * 2, h: BODY.hh * 2 });
const shapeInfo = (a) => ({
  shape: a.shape,
  ox: a.ox,
  oy: a.oy,
  angle: a.angle,
  r1: a.r1,
  half: a.half,
  len: a.len,
  hw: a.hw,
});

export const tipVisible = (w) => w.levelT < TIP_SECONDS && w.r !== null;

export function snapshot(w) {
  const p = w.p,
    r = w.r,
    cfg = levelOf(w.level);
  const atk = r && (r.state === 'windup' || r.state === 'active') ? r.atk : null;
  const prompt = promptFor(w);
  return {
    phase: w.phase,
    time: w.time,
    score: w.score,
    status: statusFor(w),
    prompt: { en: prompt[0], zh: prompt[1] },
    level: w.level,
    levelCount: LEVEL_COUNT,
    levelName: { ...cfg.name },
    tip: { ...cfg.tip, visible: tipVisible(w) },
    between: w.between,
    stats: { ...w.stats },
    player: {
      ...rect(p),
      hp: p.hp,
      maxHp: P.maxHp,
      state: p.state,
      charges: chargeCount(p),
      chargeProgress: p.charges - Math.floor(p.charges + 1e-9),
      invulnerable: playerInvulnerable(p),
      dashInvulnRemaining: p.dashInv,
      hitInvulnRemaining: p.hitInv,
      strike: p.strike ? { ...shapeInfo(p.strike), active: strikeActive(p.strike) } : null,
    },
    rival: r && {
      ...rect(r),
      id: r.cfg.id,
      name: { ...RIVAL_NAMES[r.cfg.id] },
      hp: r.hp,
      maxHp: r.cfg.hp,
      state: r.state,
      vulnerable: rivalVulnerable(r),
      recoverRemaining: r.state === 'recover' ? r.t : 0,
      telegraph: atk && {
        ...shapeInfo(atk),
        committed: true,
        heavy: !!atk.step.heavy,
        label: { en: atk.step.label[0], zh: atk.step.label[1] },
        active: r.state === 'active',
        remaining: atk.t,
        windup: atk.step.windup,
        progress: r.state === 'active' ? 1 : 1 - atk.t / atk.step.windup,
      },
    },
  };
}
