import { clamp, background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'dash-duelist',
  name: { en: 'Dash Duelist', zh: '瞬步决斗' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Win three duels in a stone courtyard. A rival that raises its weapon paints a red danger shape on the floor and cannot change it: step out of the shape or press X to dash through it. After every attack the rival is open for a moment, and only then does Space strike hurt it, so wait for the yellow OPEN mark, close in and cut. Dash is a short burst that cannot be hit for a fraction of a second and uses one of three charges that refill slowly. Reed swings a wide slash, Mira thrusts down a narrow lane, and Warden Kade chains slashes and a ring sweep.',
    zh: '在石砌庭院中连胜三场决斗。对手举起武器时，地面会出现红色危险区域，且无法再改变：走出区域，或按X闪身穿过。每次攻击之后对手都会露出破绽，只有此时空格出招才能伤到它，所以请等黄色“破绽”标记出现，再贴近砍出。闪身是短促冲刺，短暂内无法被击中，消耗三个会缓慢恢复的冲刺次数之一。芦苇挥出宽阔斩击，米拉沿窄道突刺，守卫凯德连续斩击并发出环形横扫。',
  },
  keys: [
    { label: { en: 'Move', zh: '移动' }, keys: 'WASD / Arrows' },
    {
      label: { en: 'Strike (only hurts an open rival)', zh: '出招（只能伤到露出破绽的对手）' },
      keys: 'Space',
    },
    {
      label: { en: 'Dash (brief invulnerability, 3 charges)', zh: '闪身（短暂无敌，3 次）' },
      keys: 'X',
    },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Strike', '出招', 'right'],
    ['KeyX', 'Dash', '闪身', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Units: pixels and seconds. The simulation always advances in fixed 1/120 s ticks.
export const STEP = 1 / 120;
const MAX_FRAME = 1 / 30;
const MAX_ACCEPTED_DT = 1;
export const PLAY_TOP = 30; // canvas rows above are the HUD band
export const PLAY_BOTTOM = 292; // canvas rows below are the prompt band
export const ARENA = { x0: 40, x1: 440, y0: 70, y1: 262 }; // limits for fighter centres
export const BODY = { hw: 10, hh: 14 }; // matches the 20x28 sprites (10x14 art at 2x)
const DEG = Math.PI / 180;
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
  dashInvuln: 0.3,
  maxCharges: 3,
  rechargeTime: 2.2,
  buffer: 0.15,
  healAfterRival: 2,
});
const P = PLAYER;
const MSG_SECONDS = 0.9;
const BETWEEN_SECONDS = 1.6;
const ENTER_SECONDS = 1.0;
const FIRST_GAP = 0.6;
const FLINCH_SECONDS = 0.2;
const RIVAL_KNOCKBACK = 8;
const FX_SECONDS = 0.35;
const SCORE_HIT = 50;
const SCORE_DODGE = 25;
const SCORE_RIVAL = 300;
const SCORE_HP = 100;
const MAX_FX = 24;

// Attack shapes are fixed in the world when the windup starts: what is drawn is what hits.
export const ATTACKS = Object.freeze({
  slash: {
    shape: 'sector',
    label: ['Slash', '斩击'],
    windup: 0.9,
    active: 0.14,
    r1: 58,
    half: 55 * DEG,
  },
  slashOpen: {
    shape: 'sector',
    label: ['Slash', '斩击'],
    windup: 0.9,
    active: 0.14,
    r1: 60,
    half: 45 * DEG,
  },
  slashFollow: {
    shape: 'sector',
    label: ['Slash', '斩击'],
    windup: 1.0,
    active: 0.14,
    r1: 60,
    half: 45 * DEG,
  },
  thrust: {
    shape: 'lane',
    label: ['Thrust', '突刺'],
    windup: 0.8,
    active: 0.16,
    len: 100,
    hw: 11,
    lunge: 36,
  },
  thrustFollow: {
    shape: 'lane',
    label: ['Thrust', '突刺'],
    windup: 0.9,
    active: 0.16,
    len: 100,
    hw: 11,
    lunge: 36,
  },
  sweep: {
    shape: 'ring',
    label: ['Ring sweep', '环形横扫'],
    windup: 1.1,
    active: 0.16,
    r1: 56,
    half: Math.PI,
  },
  // Heavy attacks cost 3 HP and cover more ground than walking can leave in time: dash through them.
  charge: {
    shape: 'lane',
    label: ['charge', '冲锋'],
    heavy: true,
    windup: 0.9,
    active: 0.1,
    len: 190,
    hw: 46,
    lunge: 120,
  },
  bigSweep: {
    shape: 'ring',
    label: ['ring sweep', '环形横扫'],
    heavy: true,
    windup: 0.9,
    active: 0.1,
    r1: 130,
    half: Math.PI,
  },
});
const HEAVY_DAMAGE = 3;

export const RIVALS = Object.freeze([
  {
    id: 'reed',
    name: { en: 'Reed', zh: '芦苇' },
    hp: 3,
    speed: 78,
    trigger: 46,
    gap: 0.9,
    patterns: [{ steps: ['slash'], recover: 1.1 }],
  },
  {
    id: 'mira',
    name: { en: 'Mira', zh: '米拉' },
    hp: 4,
    speed: 88,
    trigger: 84,
    gap: 0.75,
    patterns: [
      { steps: ['thrust'], recover: 0.95 },
      { steps: ['thrust', 'thrustFollow'], recover: 0.95 },
      { steps: ['charge'], recover: 1.2 },
    ],
  },
  {
    id: 'kade',
    name: { en: 'Kade', zh: '凯德' },
    hp: 5,
    speed: 96,
    trigger: 50,
    gap: 0.7,
    patterns: [
      { steps: ['slashOpen', 'slashFollow'], recover: 0.9 },
      { steps: ['bigSweep'], recover: 1.2 },
      { steps: ['sweep'], recover: 1.0 },
      { steps: ['bigSweep'], recover: 1.2 },
    ],
  },
]);
export const RIVAL_COUNT = RIVALS.length;

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

export const PROMPTS = {
  enter: ['Arrows move · Space strike · X dash', '方向键移动 · 空格出招 · X闪身'],
  idle: ['Keep your distance · wait for the windup', '保持距离 · 等待对手起手'],
  open: ['OPEN! Close in and press Space', '破绽！贴近并按空格出招'],
  between: ['Rival down! HP restored, next rival comes', '对手倒下！生命恢复，下一位登场'],
  won: ['Victory! All three rivals are down', '胜利！三位对手全部倒下'],
  lost: ['Defeated. Press Restart to duel again', '落败。点击重新开始再战'],
};
function dangerPrompt(step, angle, charges) {
  const dash = charges >= 1,
    ring = step.shape === 'ring',
    heavy = !!step.heavy;
  const side = ring ? ['', ''] : DIRS[sourceSide(angle)];
  const tail = heavy
    ? dash
      ? ['X: dash through!', '按X闪身穿过！']
      : ['No dash: run if you can!', '无闪身：尽力跑开！']
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

// ------------------------------------------------------------------ geometry

const shapeContains = (s, x, y) => {
  const dx = x - s.ox,
    dy = y - s.oy;
  if (s.shape === 'lane') {
    const c = Math.cos(s.angle),
      n = Math.sin(s.angle);
    const along = dx * c + dy * n,
      across = -dx * n + dy * c;
    return along >= 0 && along <= s.len && Math.abs(across) <= s.hw;
  }
  if (dx * dx + dy * dy > s.r1 * s.r1) return false;
  if (s.shape === 'ring') return true;
  let d = Math.atan2(dy, dx) - s.angle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= s.half;
};
// Fighters are the 16x24 rectangles drawn on screen; a hit means any part of one lies in the shape.
const sampleAxis = (half) => Array.from({ length: half + 1 }, (_, i) => i * 2 - half);
const SAMPLE_X = sampleAxis(BODY.hw);
const SAMPLE_Y = sampleAxis(BODY.hh);
export function shapeHitsBody(s, b) {
  for (const sx of SAMPLE_X)
    for (const sy of SAMPLE_Y) if (shapeContains(s, b.x + sx, b.y + sy)) return true;
  return false;
}
const bodiesOverlap = (a, b) =>
  Math.abs(a.x - b.x) < BODY.hw * 2 && Math.abs(a.y - b.y) < BODY.hh * 2;
const clampBody = (b) => {
  b.x = clamp(b.x, ARENA.x0, ARENA.x1);
  b.y = clamp(b.y, ARENA.y0, ARENA.y1);
};
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const distTo = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function separate(w) {
  const { p, r } = w;
  if (!bodiesOverlap(p, r)) return;
  const penX = BODY.hw * 2 - Math.abs(p.x - r.x),
    penY = BODY.hh * 2 - Math.abs(p.y - r.y);
  if (penX <= penY) p.x += (p.x >= r.x ? 1 : -1) * penX;
  else p.y += (p.y >= r.y ? 1 : -1) * penY;
  clampBody(p);
}

// Move a body along a vector but never into the other body.
function slide(body, other, dx, dy) {
  const keep = { x: body.x, y: body.y };
  body.x += dx;
  clampBody(body);
  if (other && bodiesOverlap(body, other)) body.x = keep.x;
  body.y += dy;
  clampBody(body);
  if (other && bodiesOverlap(body, other)) body.y = keep.y;
}

// ----------------------------------------------------------------- world

export function createWorld(random) {
  const w = {
    random,
    time: 0,
    acc: 0,
    phase: 'playing',
    score: 0,
    rivalIndex: 0,
    between: 0,
    events: [],
    msg: null,
    fx: [],
    buf: null,
    defeated: null,
    p: {
      x: 100,
      y: 168,
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
  const cfg = RIVALS[w.rivalIndex];
  const fromRight = w.p.x < (ARENA.x0 + ARENA.x1) / 2;
  w.r = {
    cfg,
    x: fromRight ? ARENA.x1 - 8 : ARENA.x0 + 8,
    y: 168,
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

const strikeActive = (s) => s.t >= P.strikeStartup && s.t < P.strikeStartup + P.strikeActive;

// ---- rival

function startStep(w) {
  const r = w.r,
    pattern = r.cfg.patterns[r.patternIndex],
    step = ATTACKS[pattern.steps[r.stepIndex]];
  const angle = angleTo(r, w.p);
  r.atk = {
    step,
    shape: step.shape,
    ox: r.x,
    oy: r.y,
    angle,
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
      r.gapT = r.cfg.gap + w.random() * 0.2;
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
  w.score += SCORE_RIVAL + SCORE_HP * w.p.hp;
  w.events.push('defeat');
  if (w.rivalIndex + 1 >= RIVAL_COUNT) {
    w.phase = 'won';
    return;
  }
  w.p.hp = Math.min(P.maxHp, w.p.hp + P.healAfterRival);
  w.p.charges = P.maxCharges;
  w.between = BETWEEN_SECONDS;
  w.defeated = { x: r.x, y: r.y, cfg: r.cfg };
  w.r = null;
  w.msg = null;
}

function tick(w, inp) {
  w.time += STEP;
  w.fx = w.fx.filter((f) => (f.t -= STEP) > 0);
  if (w.msg && (w.msg.t -= STEP) <= 0) w.msg = null;
  if (w.between > 0) {
    w.between -= STEP;
    if (w.between <= 1e-9) {
      w.between = 0;
      w.rivalIndex++;
      w.defeated = null;
      spawnRival(w);
    }
  }
  playerTick(w, inp);
  if (!w.r) return;
  rivalTick(w);
  separate(w);
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

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
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
    return dangerPrompt(r.atk.step, r.atk.angle, chargeCount(w.p));
  if (r.state === 'recover') return PROMPTS.open;
  return PROMPTS.idle;
}

function statusFor(w) {
  const [pEn, pZh] = promptFor(w);
  const n = w.rivalIndex + 1;
  const lead = w.r
    ? [`Rival ${n}/${RIVAL_COUNT}`, `对手 ${n}/${RIVAL_COUNT}`]
    : [`Rival ${n}/${RIVAL_COUNT} down`, `对手 ${n}/${RIVAL_COUNT} 倒下`];
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

export function snapshot(w) {
  const p = w.p,
    r = w.r;
  const atk = r && (r.state === 'windup' || r.state === 'active') ? r.atk : null;
  const prompt = promptFor(w);
  return {
    phase: w.phase,
    time: w.time,
    score: w.score,
    status: statusFor(w),
    prompt: { en: prompt[0], zh: prompt[1] },
    rivalNumber: w.rivalIndex + 1,
    rivalsTotal: RIVAL_COUNT,
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
      name: { ...r.cfg.name },
      hp: r.hp,
      maxHp: r.cfg.hp,
      state: r.state,
      vulnerable: rivalVulnerable(r),
      recoverRemaining: r.state === 'recover' ? r.t : 0,
      telegraph: atk && {
        ...shapeInfo(atk),
        committed: true,
        heavy: !!atk.step.heavy,
        active: r.state === 'active',
        remaining: atk.t,
        windup: atk.step.windup,
        progress: r.state === 'active' ? 1 : 1 - atk.t / atk.step.windup,
      },
    },
  };
}

const SOUND_FOR = {
  strike: 'shoot',
  dash: 'move',
  hurt: 'hit',
  guard: 'hit',
  stagger: 'coin',
  dodge: 'coin',
  defeat: 'coin',
};
const END_TEXT = {
  won: [
    'Three rivals defeated. You are the courtyard champion!',
    '三位对手尽数击败，你是庭院冠军！',
  ],
  lost: [
    'You fell in the courtyard. Read the windups and try again.',
    '你倒在了庭院中。看清起手，再试一次。',
  ],
};

export function createGame(env) {
  const w = createWorld(env.random);
  let ended = false;
  return {
    update(dt, input) {
      if (ended) return;
      stepWorld(w, dt, input);
      for (const e of new Set(w.events)) if (SOUND_FOR[e]) env.sound(SOUND_FOR[e]);
      if (w.phase === 'playing') return;
      ended = true;
      const won = w.phase === 'won',
        [en, zh] = END_TEXT[w.phase];
      env.sound(won ? 'win' : 'lose');
      env.end({ won, score: w.score, message: env.t(en, zh) });
    },
    draw(ctx) {
      drawWorld(ctx, w, env);
    },
    getState() {
      return snapshot(w);
    },
  };
}

// --------------------------------------------------------------- rendering

const C = {
  danger: '#ff3b4a',
  dangerFill: 'rgba(255,59,74,',
  heavy: '#ff3bd0',
  heavyFill: 'rgba(255,59,208,',
  strike: '#e8f4ff',
  open: '#ffd76a',
  hp: '#ff6b81',
  dash: '#37e6d2',
};
const sprite = (packed) => packed.split('|');
// 10x14 art drawn at 2x: exactly the 20x28 collider. Silhouettes: topknot, plumed hat, horned helm.
// prettier-ignore
export const FIGHTERS = {
  player: {
    rows: sprite('...gggg...|..gssssg.g|..s0ss0s..|...ssss...|..cccccc..|.ccwwwwcc.|.cccwwccc.|.cccccccc.|..cccccc..|..cddddc..|..cd..dc..|..dd..dd..|..dd..dd..|.ddd..ddd.'),
    palette: { g: '#ffd76a', s: '#f1c9a0', 0: '#1a1a2e', c: '#3d8bff', w: '#e8f4ff', d: '#1b2a5a' },
  },
  reed: {
    rows: sprite('....bb....|...bbbb...|...bssb...|...s0s0...|....ss....|...gggg...|..gggggg..|..gg..gg..|...gggg...|...gddg...|...gddg...|...d..d...|...d..d...|..dd..dd..'),
    palette: { b: '#58b368', s: '#f1c9a0', 0: '#1a1a2e', g: '#8fd08a', d: '#2d5a3a' },
  },
  mira: {
    rows: sprite('....pp....|...hhhh...|..hhhhhh..|...ssss...|..s0ss0s..|...tttt...|..tttttt..|..ttwwtt..|..tttttt..|..tttttt..|..ttddtt..|..ttddtt..|...d..d...|..dd..dd..'),
    palette: {p: '#ff9a3c', h: '#6aa8ff', s: '#f1c9a0', 0: '#1a1a2e', t: '#4a78d8', w: '#dce8ff', d: '#243a78' },
  },
  kade: {
    rows: sprite('h..hhhh..h|hh.hhhh.hh|.hhhhhhhh.|..hvvvvh..|..hhhhhh..|aaaaaaaaaa|aaccccccaa|aaccccccaa|aaaaaaaaaa|.aaaddaaa.|.aaaddaaa.|..add.dda.|..dd..dd..|.ddd..ddd.'),
    palette: { h: '#b9a6d8', v: '#ff3b4a', a: '#7a4cc0', c: '#ffd76a', d: '#35214f' },
  },
};
const HEART = sprite('.h.h.|hhhhh|.hhh.|..h..');
// Weapons differ per rival: one blade, a long spear with a head, twin blades.
const ARMS = {
  player: { len: 18, spread: [0] },
  reed: { len: 22, spread: [0] },
  mira: { len: 36, spread: [0], head: true },
  kade: { len: 18, spread: [-0.45, 0.45] },
};
const POSE_ANGLE = { idle: 0.9, windup: 2.7, active: 0, recover: 1.6 };

export const COURTS = [
  { floor: ['#2a3040', '#2e3547'], mortar: '#1d222f', wall: '#4a5470', accent: '#8fd08a' },
  { floor: ['#352b31', '#3a2f36'], mortar: '#241b21', wall: '#6a4a55', accent: '#e0553f' },
  { floor: ['#262337', '#2b2840'], mortar: '#181626', wall: '#4d4272', accent: '#ff9a3c' },
];
const pillar = (ctx, x, y, c, t) => {
  ctx.fillStyle = c.wall;
  ctx.fillRect(x - 7, y - 6, 14, 22);
  ctx.fillStyle = '#9aa3c4';
  ctx.fillRect(x - 9, y - 8, 18, 4);
  ctx.fillStyle = c.accent; // lantern flame
  ctx.fillRect(x - 3, y - 4 + (Math.floor(t * 4 + x) % 2), 6, 5);
};

// Calm, low-contrast courtyards so the red telegraphs stay the loudest thing on the floor.
export function drawCourtyard(ctx, t, index) {
  const c = COURTS[index];
  background(ctx, c.mortar);
  for (let row = 0, y = PLAY_TOP; y < PLAY_BOTTOM; row++, y += 24)
    for (let i = 0, x = -(row % 2) * 24; x < 480; i++, x += 48) {
      ctx.fillStyle = c.floor[(row + i) & 1];
      ctx.fillRect(x + 1, y + 1, 46, 22);
    }
  ctx.fillStyle = c.mortar;
  ctx.fillRect(0, PLAY_TOP, 480, 14);
  ctx.fillRect(0, 278, 480, PLAY_BOTTOM - 278);
  ctx.fillRect(0, PLAY_TOP, 24, 262);
  ctx.fillRect(456, PLAY_TOP, 24, 262);
  ctx.fillStyle = c.wall;
  ctx.fillRect(0, 34, 480, 10);
  ctx.fillRect(0, 278, 480, 8);
  ctx.strokeStyle = '#6a7394';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 44, 432, 234);
  for (const [x, y] of [
    [10, 52],
    [470, 52],
    [10, 262],
    [470, 262],
  ])
    pillar(ctx, x, y, c, t);
  if (index === 0) {
    ctx.fillStyle = '#5b3a24'; // old tree in the left margin
    ctx.fillRect(9, 150, 6, 30);
    ctx.fillStyle = '#2f7a43';
    ctx.fillRect(2, 112, 20, 14);
    ctx.fillRect(4, 124, 18, 24);
  } else if (index === 1) {
    for (const x of [96, 240, 384]) {
      ctx.fillStyle = c.accent; // hanging banners
      ctx.fillRect(x, 30, 16, 14);
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(x + 6, 30, 4, 12);
    }
  } else {
    for (const y of [150, 190]) {
      ctx.fillStyle = '#3a3150'; // braziers on the side walls
      ctx.fillRect(458, y, 16, 10);
      ctx.fillStyle = c.accent;
      ctx.fillRect(462, y - 8 + (Math.floor(t * 6 + y) % 3), 8, 8);
    }
  }
}

function pathShape(ctx, s) {
  ctx.beginPath();
  if (s.shape === 'lane') {
    const c = Math.cos(s.angle),
      n = Math.sin(s.angle);
    const pt = (a, b) => [s.ox + a * c - b * n, s.oy + a * n + b * c];
    [pt(0, -s.hw), pt(s.len - 10, -s.hw), pt(s.len, 0), pt(s.len - 10, s.hw), pt(0, s.hw)].forEach(
      ([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)),
    );
    ctx.closePath();
  } else if (s.shape === 'ring') {
    ctx.arc(s.ox, s.oy, s.r1, 0, Math.PI * 2);
  } else {
    ctx.moveTo(s.ox, s.oy);
    ctx.arc(s.ox, s.oy, s.r1, s.angle - s.half, s.angle + s.half);
    ctx.closePath();
  }
}

function drawTelegraph(ctx, r) {
  const a = r.atk,
    active = r.state === 'active';
  const progress = active ? 1 : 1 - a.t / a.step.windup;
  const heavy = !!a.step.heavy;
  pathShape(ctx, a);
  ctx.fillStyle = active
    ? 'rgba(255,255,255,0.8)'
    : `${heavy ? C.heavyFill : C.dangerFill}${0.1 + 0.4 * progress})`;
  ctx.fill();
  ctx.strokeStyle = heavy ? C.heavy : C.danger;
  ctx.lineWidth = heavy ? 6 : 3;
  ctx.setLineDash(active ? [] : heavy ? [14, 5] : [6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (heavy) {
    // heavy shapes get a second, white inner line so they differ by shape and weight, not colour only
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (!active) {
    // a growing inner copy of the same shape shows how close the strike is
    ctx.save();
    ctx.translate(a.ox, a.oy);
    ctx.scale(progress, progress);
    ctx.translate(-a.ox, -a.oy);
    pathShape(ctx, a);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawStrike(ctx, p) {
  const s = p.strike;
  if (!s) return;
  if (strikeActive(s)) {
    pathShape(ctx, s);
    ctx.fillStyle = 'rgba(232,244,255,0.55)';
    ctx.fill();
    ctx.strokeStyle = C.strike;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (s.t < P.strikeStartup) {
    ctx.strokeStyle = C.strike;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(s.angle + 1.2) * 22, p.y + Math.sin(s.angle + 1.2) * 22);
    ctx.stroke();
  }
}

function drawArms(ctx, kind, b, aim, pose) {
  const arm = ARMS[kind],
    len = pose === 'recover' ? arm.len * 0.6 : arm.len;
  const hx = b.x + Math.cos(aim) * 8,
    hy = b.y + Math.sin(aim) * 8 + 2;
  ctx.lineWidth = 3;
  for (const sp of arm.spread) {
    const a = aim + POSE_ANGLE[pose] + sp,
      tx = hx + Math.cos(a) * len,
      ty = hy + Math.sin(a) * len;
    ctx.strokeStyle = '#dbe4f5';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (arm.head) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * 8, ty + Math.sin(a) * 8);
      ctx.lineTo(tx - Math.sin(a) * 4, ty + Math.cos(a) * 4);
      ctx.lineTo(tx + Math.sin(a) * 4, ty - Math.cos(a) * 4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// pose: idle guard, windup (leans back, weapon raised), active (weapon forward), recover (slumped).
export function drawFighter(ctx, kind, b, aim, pose = 'idle', flash = false) {
  const lean = pose === 'windup' ? -3 : 0,
    dy = pose === 'recover' ? 3 : 0;
  if (flash) ctx.globalAlpha = 0.45;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(b.x - 10, b.y + 12, 20, 4);
  const ox = Math.round(Math.cos(aim) * lean),
    oy = Math.round(Math.sin(aim) * lean);
  pixelSprite(
    ctx,
    FIGHTERS[kind].rows,
    b.x - 10 + ox,
    b.y - 14 + dy + oy,
    2,
    FIGHTERS[kind].palette,
  );
  ctx.globalAlpha = 1;
  drawArms(ctx, kind, { x: b.x + ox, y: b.y + dy + oy }, aim, pose);
}

function drawRival(ctx, r, p, t) {
  const aiming = r.state === 'windup' || r.state === 'active';
  const aim = r.atk ? r.atk.angle : angleTo(r, p);
  const pose = aiming ? r.state : r.state === 'recover' ? 'recover' : 'idle';
  ctx.save();
  if (r.flinch > 0) ctx.translate(Math.sin(t * 90) * 2, 0);
  drawFighter(ctx, r.cfg.id, r, aim, pose);
  ctx.restore();
  const top = r.y - 40;
  if (aiming) {
    const heavy = r.atk.step.heavy;
    ctx.fillStyle = heavy ? C.heavy : C.danger;
    ctx.beginPath();
    ctx.moveTo(r.x, top - 2);
    ctx.lineTo(r.x + 9, top + 14);
    ctx.lineTo(r.x - 9, top + 14);
    ctx.closePath();
    ctx.fill();
    text(ctx, heavy ? '!!' : '!', r.x, top + 1, '#fff', 14, 'center');
  } else if (r.state === 'recover') {
    const bob = Math.sin(t * 8) * 2;
    ctx.fillStyle = C.open;
    ctx.strokeStyle = '#3a2a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, top - 4 + bob);
    ctx.lineTo(r.x + 9, top + 6 + bob);
    ctx.lineTo(r.x, top + 16 + bob);
    ctx.lineTo(r.x - 9, top + 6 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = C.open;
    ctx.strokeRect(r.x - 12, r.y - 16, 24, 32);
  }
}

function drawFx(ctx, fx) {
  for (const f of fx) {
    const k = 1 - f.t / FX_SECONDS;
    ctx.strokeStyle = f.kind === 'hurt' ? C.hp : f.kind === 'clang' ? '#fff' : C.open;
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(a) * (6 + k * 6), f.y + Math.sin(a) * (6 + k * 6));
      ctx.lineTo(f.x + Math.cos(a) * (12 + k * 14), f.y + Math.sin(a) * (12 + k * 14));
      ctx.stroke();
    }
  }
}

function drawHud(ctx, w, env) {
  const p = w.p,
    cfg = RIVALS[w.rivalIndex];
  ctx.fillStyle = '#0b0d16';
  ctx.fillRect(0, 0, 480, PLAY_TOP);
  ctx.fillRect(0, PLAY_BOTTOM, 480, 320 - PLAY_BOTTOM);
  text(
    ctx,
    `${w.rivalIndex + 1}/${RIVAL_COUNT} ${env.t(cfg.name.en, cfg.name.zh)}`,
    6,
    7,
    '#ffb36b',
    14,
  );
  const rivalHp = w.r ? w.r.hp : 0;
  for (let i = 0; i < cfg.hp; i++) {
    ctx.fillStyle = i < rivalHp ? '#ff9a3c' : '#3a2a2a';
    ctx.fillRect(86 + i * 13, 8, 10, 13);
  }
  text(ctx, env.t('You', '你'), 168, 7, '#ff9aaa', 14);
  for (let i = 0; i < P.maxHp; i++)
    pixelSprite(ctx, HEART, 202 + i * 16, 9, 3, { h: i < p.hp ? C.hp : '#4a3038' });
  // dash charges, with a visible recharge fill on the next empty slot
  const full = chargeCount(p),
    frac = p.charges - Math.floor(p.charges + 1e-9);
  text(ctx, env.t('Dash', '闪身'), 300, 7, '#9fe9e0', 14);
  for (let i = 0; i < P.maxCharges; i++) {
    const x = 346 + i * 24;
    ctx.fillStyle = '#18323a';
    ctx.fillRect(x, 8, 20, 13);
    ctx.fillStyle = C.dash;
    if (i < full) ctx.fillRect(x, 8, 20, 13);
    else if (i === full) ctx.fillRect(x, 8, Math.round(20 * frac), 13);
    ctx.strokeStyle = '#9fe9e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 8.5, 19, 12);
  }
  const [en, zh] = promptFor(w);
  const danger = w.r && ['windup', 'active'].includes(w.r.state);
  const color = danger ? '#ff8a96' : w.r && w.r.state === 'recover' ? C.open : '#e8f4ff';
  text(ctx, env.t(en, zh), 240, 298, color, 16, 'center');
  if (w.msg) text(ctx, env.t(w.msg.en, w.msg.zh), 240, 32, '#fff', 14, 'center');
}

function drawWorld(ctx, w, env) {
  const t = w.time,
    p = w.p,
    r = w.r;
  drawCourtyard(ctx, t, Math.min(w.rivalIndex, RIVAL_COUNT - 1));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PLAY_TOP, 480, PLAY_BOTTOM - PLAY_TOP);
  ctx.clip();
  if (r && r.atk && (r.state === 'windup' || r.state === 'active')) drawTelegraph(ctx, r);
  if (r) drawRival(ctx, r, p, t);
  else if (w.defeated) {
    ctx.globalAlpha = 0.5;
    drawFighter(
      ctx,
      w.defeated.cfg.id,
      { x: w.defeated.x, y: w.defeated.y + 6 },
      Math.PI,
      'recover',
    );
    ctx.globalAlpha = 1;
  }
  const swing = !p.strike
    ? 'idle'
    : strikeActive(p.strike)
      ? 'active'
      : p.strike.t < P.strikeStartup
        ? 'windup'
        : 'recover';
  const blink = p.hitInv > 0 && Math.floor(p.hitInv * 14) % 2 === 0;
  drawFighter(ctx, 'player', p, p.strike ? p.strike.angle : p.face, swing, blink);
  if (p.dashInv > 0) {
    ctx.strokeStyle = C.dash;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 12, p.y - 16, 24, 32);
  }
  drawStrike(ctx, p);
  drawFx(ctx, w.fx);
  ctx.restore();
  drawHud(ctx, w, env);
}
