import { clamp } from '../shared/utils.js';
import {
  BASH_COST,
  BASH_CD,
  BASH_ACTIVE,
  BASH_HALF,
  BASH_R,
  BLOCK_COST,
  BLOCK_FLASH,
  BODY,
  BROKEN_TIME,
  CHARGE,
  CRAWLER_PORTAL,
  CRAWLER_STUN,
  DRAIN,
  EXPOSE_TIME,
  FIRST_DELAY,
  INTRO_TIME,
  INVULN,
  LANCE_SPEED,
  MAX_ACCEPTED_DT,
  MAX_ENERGY,
  MAX_FRAME,
  MAX_FX,
  MAX_HP,
  MIN_RAISE,
  RECHARGE,
  RECHARGE_DELAY,
  REFLECT_BOOST,
  SHIELD_HALF,
  SHIELD_R,
  SHIELD_THICK,
  SHOT_BOUNDS,
  SHOT_DAMAGE,
  SHOT_R,
  SLAM_R,
  SPEED,
  STEP,
  WALK,
  angleBetween,
  circleHitsBox,
  inArc,
  reflect,
  segmentBoxEntry,
  shieldContact,
} from './shield-sentinel-geometry.js';
import { LEVEL_COUNT, levelNumber, levelOf } from './shield-sentinel-levels.js';

const BASH_BUFFER = 0.25; // a bash tapped slightly early (or between ticks) still fires
const HEAL_PER_LEVEL = 2;

const newFoe = (w, spec) => ({
  id: w.nextId++,
  ...spec,
  pattern: [...spec.pattern],
  maxHp: spec.hp,
  k: 0,
  charge: null,
  exposed: 0,
  flash: 0,
});

export function createWorld(random = Math.random, level = 1) {
  const w = {
    phase: 'playing',
    tick: 0,
    acc: 0,
    score: 0,
    hp: MAX_HP,
    level: 1,
    introT: 0,
    levelT: 0,
    nextId: 1,
    random,
    events: [],
    bashBuf: 0,
    shieldLatch: false,
    p: {
      x: 240,
      y: 190,
      face: -Math.PI / 2,
      shieldUp: false,
      energy: MAX_ENERGY,
      broken: 0,
      delay: 0,
      bashT: 0,
      bashCd: 0,
      inv: 0,
      blockT: 0,
    },
    foes: [],
    crawlers: [],
    shots: [],
    fx: [],
    atk: { wait: FIRST_DELAY, step: 0 },
    spawned: 0,
  };
  startLevel(w, level);
  return w;
}

export function startLevel(w, n) {
  const cfg = levelOf(n);
  w.level = levelNumber(n);
  w.introT = INTRO_TIME;
  w.levelT = 0;
  w.spawned = 0;
  w.foes = cfg.foes.map((spec) => newFoe(w, spec));
  w.crawlers = [];
  w.shots = [];
  w.atk = { wait: FIRST_DELAY, step: 0 };
}

const addFx = (w, kind, x, y, life = 0.35) => {
  w.fx.push({ kind, x, y, t: 0, life });
  if (w.fx.length > MAX_FX) w.fx.shift();
};

function hurt(w, damage, source) {
  const p = w.p;
  if (p.inv > 0) return false;
  w.hp = Math.max(0, w.hp - damage);
  p.inv = INVULN;
  w.events.push('hit');
  addFx(w, 'hurt', p.x, p.y);
  if (source === 'slam') {
    p.energy = 0;
    p.broken = BROKEN_TIME;
    p.shieldUp = false;
  }
  if (w.hp <= 0) w.phase = 'lost';
  return true;
}

export const shieldIsUp = (p) => p.shieldUp && p.broken <= 0;

function updatePlayer(w, inp) {
  const p = w.p;
  const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
    dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;
  const wasUp = p.shieldUp;
  p.inv = Math.max(0, p.inv - STEP);
  p.blockT = Math.max(0, p.blockT - STEP);
  p.bashT = Math.max(0, p.bashT - STEP);
  p.bashCd = Math.max(0, p.bashCd - STEP);
  p.broken = Math.max(0, p.broken - STEP);
  p.shieldUp = inp.shield && p.broken <= 0 && (wasUp || p.energy >= MIN_RAISE);
  if (p.shieldUp && !wasUp) w.events.push('raise');
  if (moving) p.face = Math.atan2(dy, dx);
  if (moving && !p.shieldUp) {
    const len = Math.hypot(dx, dy);
    p.x = clamp(p.x + (dx / len) * SPEED * STEP, WALK.x0, WALK.x1);
    p.y = clamp(p.y + (dy / len) * SPEED * STEP, WALK.y0, WALK.y1);
  }
  if (p.shieldUp) {
    p.energy = Math.max(0, p.energy - DRAIN * STEP);
    p.delay = RECHARGE_DELAY;
    if (p.energy <= 0) breakShield(w);
  } else {
    p.delay = Math.max(0, p.delay - STEP);
    if (p.delay <= 0 && p.broken <= 0) p.energy = Math.min(MAX_ENERGY, p.energy + RECHARGE * STEP);
  }
  w.bashBuf = Math.max(0, w.bashBuf - STEP);
  if (w.bashBuf > 0 && !p.shieldUp && p.bashCd <= 0 && p.energy >= BASH_COST) {
    w.bashBuf = 0;
    p.energy -= BASH_COST;
    p.delay = RECHARGE_DELAY;
    p.bashT = BASH_ACTIVE;
    p.bashCd = BASH_CD;
    w.events.push('bash');
  }
}

function breakShield(w) {
  w.p.shieldUp = false;
  w.p.energy = 0;
  w.p.broken = BROKEN_TIME;
  addFx(w, 'shatter', w.p.x, w.p.y, 0.5);
}

const aliveFoes = (w) => w.foes.filter((f) => f.hp > 0);

function launch(w, foe, charge) {
  const kind = charge.kind,
    cfg = levelOf(w.level),
    p = w.p;
  const dx = p.x - foe.x,
    dy = p.y - foe.y,
    len = Math.hypot(dx, dy) || 1;
  const speed = kind === 'orb' ? cfg.orbSpeed : kind === 'slug' ? cfg.slugSpeed : LANCE_SPEED;
  const dir = kind === 'lance' ? { x: charge.dirx, y: charge.diry } : { x: dx / len, y: dy / len };
  w.shots.push({
    id: w.nextId++,
    kind,
    x: foe.x,
    y: foe.y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    r: SHOT_R[kind],
    owner: 'foe',
    reflected: false,
    hit: [],
  });
  w.events.push('shoot');
}

function resolveSlam(w, foe, c) {
  addFx(w, 'slam', c.lx, c.ly, 0.5);
  w.events.push('slam');
  foe.exposed = EXPOSE_TIME;
  if (circleHitsBox(c.lx, c.ly, SLAM_R, w.p.x, w.p.y, BODY.hw, BODY.hh)) hurt(w, 2, 'slam');
}

function updateAttacks(w) {
  const cfg = levelOf(w.level),
    alive = aliveFoes(w);
  for (const f of alive) {
    f.exposed = Math.max(0, f.exposed - STEP);
    f.flash = Math.max(0, f.flash - STEP);
  }
  const active = alive.find((f) => f.charge);
  if (active) {
    const c = active.charge;
    c.t += STEP;
    if (c.t + 1e-9 < c.dur) return;
    active.charge = null;
    w.atk.wait = cfg.rest;
    if (c.kind === 'slam') resolveSlam(w, active, c);
    else launch(w, active, c);
    return;
  }
  if (w.shots.length > 0) return;
  w.atk.wait = Math.max(0, w.atk.wait - STEP);
  if (w.atk.wait > 0 || alive.length === 0) return;
  const foe = alive[w.atk.step++ % alive.length];
  const kind = foe.pattern[foe.k++ % foe.pattern.length];
  const dx = w.p.x - foe.x,
    dy = w.p.y - foe.y,
    len = Math.hypot(dx, dy) || 1;
  foe.charge = {
    kind,
    t: 0,
    dur: CHARGE[kind],
    lx: w.p.x,
    ly: w.p.y,
    dirx: dx / len,
    diry: dy / len,
  };
  if (kind === 'slam') foe.charge.r = SLAM_R;
}

function updateCrawlers(w) {
  const cfg = levelOf(w.level),
    p = w.p;
  w.levelT += STEP;
  const due = cfg.crawlers[w.spawned];
  if (due !== undefined && w.levelT >= due && w.crawlers.length < cfg.maxCrawlers) {
    w.spawned++;
    let x = w.random() < 0.5 ? WALK.x0 : WALK.x1;
    if (Math.abs(x - p.x) < 80) x = WALK.x0 + WALK.x1 - x;
    const y = 120 + Math.floor(w.random() * 130);
    w.crawlers.push({ id: w.nextId++, x, y, hw: 6, hh: 5, portal: CRAWLER_PORTAL, stun: 0 });
  }
  const kept = [];
  for (const c of w.crawlers) {
    const dx = c.x - p.x,
      dy = c.y - p.y,
      dist = Math.hypot(dx, dy);
    if (c.portal > 0) {
      c.portal = Math.max(0, c.portal - STEP);
      kept.push(c);
      continue;
    }
    if (p.bashT > 0 && dist <= BASH_R && angleBetween(Math.atan2(dy, dx), p.face) <= BASH_HALF) {
      w.score += 25;
      w.events.push('coin');
      addFx(w, 'puff', c.x, c.y);
      continue;
    }
    if (c.stun > 0) c.stun = Math.max(0, c.stun - STEP);
    else {
      const tx = p.x - c.x,
        ty = p.y - c.y,
        len = Math.hypot(tx, ty) || 1;
      c.x += (tx / len) * cfg.crawlerSpeed * STEP;
      c.y += (ty / len) * cfg.crawlerSpeed * STEP;
    }
    const nx = c.x - p.x,
      ny = c.y - p.y;
    if (shieldIsUp(p) && Math.hypot(nx, ny) < SHIELD_R + 8 && inArc(nx, ny, p.face)) {
      const len = Math.hypot(nx, ny) || 1;
      c.x = p.x + (nx / len) * (SHIELD_R + 12);
      c.y = p.y + (ny / len) * (SHIELD_R + 12);
      c.stun = CRAWLER_STUN;
      p.energy = Math.max(0, p.energy - 5);
      w.events.push('block');
      p.blockT = BLOCK_FLASH;
      addFx(w, 'spark', c.x, c.y, 0.2);
      if (p.energy <= 0) breakShield(w);
    } else if (Math.abs(nx) < BODY.hw + c.hw && Math.abs(ny) < BODY.hh + c.hh) {
      hurt(w, 1, 'crawler');
      addFx(w, 'puff', c.x, c.y);
      continue;
    }
    kept.push(c);
  }
  w.crawlers = kept;
}

function killFoe(w, foe) {
  w.score += 200;
  w.events.push('coin');
  addFx(w, 'puff', foe.x, foe.y, 0.5);
  if (foe.charge) {
    foe.charge = null;
    w.atk.wait = levelOf(w.level).rest;
  }
}

// Collect the earliest event of each shot for this tick, then apply them in time order.
function shotEvent(w, s, x1, y1) {
  const p = w.p;
  if (s.owner === 'foe') {
    const body = segmentBoxEntry(s.x, s.y, x1, y1, p.x, p.y, BODY.hw + s.r, BODY.hh + s.r);
    const block =
      s.kind !== 'lance' && shieldIsUp(p)
        ? shieldContact(p.x, p.y, p.face, s.x, s.y, x1, y1, s.r)
        : null;
    if (block && (body === null || block.t <= body))
      return { t: block.t, s, type: 'block', ...block };
    return body === null ? null : { t: body, s, type: 'body' };
  }
  let best = null;
  for (const target of [...aliveFoes(w), ...w.crawlers.filter((c) => c.portal <= 0)]) {
    if (s.hit.includes(target.id)) continue;
    const t = segmentBoxEntry(
      s.x,
      s.y,
      x1,
      y1,
      target.x,
      target.y,
      target.hw + s.r,
      target.hh + s.r,
    );
    if (t !== null && (best === null || t < best.t)) best = { t, s, type: 'target', target };
  }
  return best;
}

function applyShotEvent(w, e) {
  const { s } = e;
  if (e.type === 'body') {
    s.dead = true;
    hurt(w, SHOT_DAMAGE[s.kind], s.kind);
  } else if (e.type === 'block') {
    w.p.energy = Math.max(0, w.p.energy - BLOCK_COST);
    w.events.push('block');
    w.p.blockT = BLOCK_FLASH;
    addFx(w, 'spark', w.p.x + e.hx, w.p.y + e.hy, 0.25);
    if (s.kind === 'slug') s.dead = true;
    else {
      const v = reflect(s.vx, s.vy, e.nx, e.ny);
      s.vx = v.vx * REFLECT_BOOST;
      s.vy = v.vy * REFLECT_BOOST;
      s.owner = 'player';
      s.reflected = true;
      s.x = w.p.x + e.hx;
      s.y = w.p.y + e.hy;
      s.held = true;
    }
    if (w.p.energy <= 0) breakShield(w);
  } else {
    const target = e.target;
    s.hit.push(target.id);
    w.score += 50;
    w.events.push('coin');
    target.flash = 0.15;
    if (target.type === undefined) {
      target.hp = 0;
      target.dead = true;
      w.score += 25;
      addFx(w, 'puff', target.x, target.y);
    } else {
      target.hp = Math.max(0, target.hp - (target.exposed > 0 ? 2 : 1));
      if (target.hp <= 0) killFoe(w, target);
    }
  }
}

function updateShots(w) {
  const events = [];
  for (const s of w.shots) {
    const x1 = s.x + s.vx * STEP,
      y1 = s.y + s.vy * STEP;
    s.nx = x1;
    s.ny = y1;
    const e = shotEvent(w, s, x1, y1);
    if (e) events.push(e);
  }
  events.sort((a, b) => a.t - b.t || a.s.id - b.s.id);
  for (const e of events) {
    if (w.phase !== 'playing') break;
    if (e.s.dead || (e.type === 'target' && e.target.hp <= 0 && e.target.type !== undefined))
      continue;
    if (e.type === 'target' && e.target.dead) continue;
    applyShotEvent(w, e);
  }
  w.crawlers = w.crawlers.filter((c) => !c.dead);
  for (const s of w.shots) {
    if (s.held) s.held = false;
    else {
      s.x = s.nx;
      s.y = s.ny;
    }
  }
  w.shots = w.shots.filter(
    (s) =>
      !s.dead &&
      s.x >= SHOT_BOUNDS.x0 &&
      s.x <= SHOT_BOUNDS.x1 &&
      s.y >= SHOT_BOUNDS.y0 &&
      s.y <= SHOT_BOUNDS.y1,
  );
  for (const s of w.shots) (delete s.nx, delete s.ny);
}

function clearLevel(w) {
  w.score += 300;
  w.events.push('win');
  if (w.level >= LEVEL_COUNT) {
    w.score += 1000 + w.hp * 100;
    w.phase = 'won';
    return;
  }
  w.hp = Math.min(MAX_HP, w.hp + HEAL_PER_LEVEL);
  w.events.push('level');
  startLevel(w, w.level + 1);
}

function tick(w, inp) {
  w.tick++;
  for (const f of w.fx) f.t += STEP;
  w.fx = w.fx.filter((f) => f.t < f.life);
  updatePlayer(w, inp);
  if (w.introT > 0) {
    w.introT = Math.max(0, w.introT - STEP);
    return;
  }
  updateAttacks(w);
  updateCrawlers(w);
  updateShots(w);
  if (w.phase === 'playing' && aliveFoes(w).length === 0) clearLevel(w);
}

// A shield key that was already down when the level began only counts once it has been released.
function readInput(w, input) {
  const shield = input.held('Space');
  if (!shield) w.shieldLatch = false;
  return {
    left: input.held('ArrowLeft', 'KeyA'),
    right: input.held('ArrowRight', 'KeyD'),
    up: input.held('ArrowUp', 'KeyW'),
    down: input.held('ArrowDown', 'KeyS'),
    shield: shield && !w.shieldLatch,
  };
}

export function stepWorld(w, dt, input) {
  if (w.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > MAX_ACCEPTED_DT) return;
  if (input.pressed('KeyX')) w.bashBuf = BASH_BUFFER;
  const total = w.acc + Math.min(dt, MAX_FRAME);
  w.events = [];
  w.acc = total;
  while (w.acc + 1e-9 >= STEP && w.phase === 'playing') {
    w.acc -= STEP;
    tick(w, readInput(w, input));
  }
  if (Math.abs(w.acc) < 1e-9) w.acc = 0;
}

// ---------------------------------------------------------- readable state

export const PROMPTS = {
  intro: ['Arrows move · hold Space: shield · X: bash', '方向键移动 · 按住空格举盾 · X重击'],
  lance: ["RED LANE: step aside, shield can't stop it", '红色通道：侧移躲开，盾挡不住'],
  slam: ['PURPLE CIRCLE: run out of it!', '紫圈：快跑出去！'],
  crawler: ['Crawler close: face it, tap X to bash', '爬虫逼近：面向它，按X重击'],
  orb: ['Face the cyan orb, hold Space: reflect!', '面向青色光球，按住空格反射！'],
  slug: ['Face the orange slug, hold Space: block', '面向橙色弹，按住空格挡下'],
  broken: ['Shield broken: wait for it to recharge', '护盾破碎：等待恢复'],
  idle: ['Aim with Arrows, hold Space to shield', '方向键瞄准，按住空格举盾'],
};

export function promptKey(w) {
  if (w.introT > 0) return 'intro';
  const charges = w.foes.filter((f) => f.hp > 0 && f.charge).map((f) => f.charge.kind);
  const shots = w.shots.filter((s) => s.owner === 'foe').map((s) => s.kind);
  if (charges.includes('lance') || shots.includes('lance')) return 'lance';
  if (charges.includes('slam')) return 'slam';
  if (w.crawlers.some((c) => c.portal <= 0 && Math.hypot(c.x - w.p.x, c.y - w.p.y) < 70))
    return 'crawler';
  const threat = [...charges, ...shots].includes('orb')
    ? 'orb'
    : [...charges, ...shots].includes('slug')
      ? 'slug'
      : null;
  if (w.p.broken > 0) return 'broken';
  return threat || 'idle';
}

export function snapshot(w) {
  const key = promptKey(w),
    p = w.p,
    cfg = levelOf(w.level);
  const [en, zh] = PROMPTS[key];
  const boss = w.foes.find((f) => f.type === 'guardian');
  const label = boss
    ? { en: `Guardian ${boss.hp}/${boss.maxHp}`, zh: `巨像 ${boss.hp}/${boss.maxHp}` }
    : { en: `Level ${w.level}/${LEVEL_COUNT}`, zh: `第${w.level}/${LEVEL_COUNT}关` };
  return {
    phase: w.phase,
    score: w.score,
    hp: w.hp,
    maxHp: MAX_HP,
    level: w.level,
    levelCount: LEVEL_COUNT,
    levelName: cfg.name,
    tip: cfg.tip,
    guardianLevel: cfg.guardian,
    time: w.tick * STEP,
    introLeft: w.introT,
    prompt: { key, en, zh },
    sentinel: {
      x: p.x,
      y: p.y,
      hw: BODY.hw,
      hh: BODY.hh,
      face: p.face,
      shieldUp: shieldIsUp(p),
      arc: { r: SHIELD_R, thickness: SHIELD_THICK, half: SHIELD_HALF, facing: p.face },
      energy: p.energy,
      broken: p.broken,
      bashActive: p.bashT > 0,
      bashCooldown: p.bashCd,
      bashCost: BASH_COST,
      invulnerable: p.inv,
      blockFlash: p.blockT,
    },
    foes: w.foes.map((f) => structuredClone(f)),
    crawlers: w.crawlers.map((c) => ({ ...c })),
    shots: w.shots.map((s) => ({ ...s, hit: [...s.hit] })),
    events: [...w.events],
    status: {
      en: `${label.en} · HP ${w.hp} · ${en}`,
      zh: `${label.zh} · 生命 ${w.hp} · ${zh}`,
    },
  };
}
