import { clamp } from '../shared/utils.js';
import {
  AIM_DEAD_ZONE,
  BEACON,
  FIELD_COUNT,
  HULL_MASS,
  MAGAZINE,
  MAX_ARMOR,
  MAX_BEACON,
  MAX_DT,
  MAX_KITS,
  POINTER_ALIGNMENT,
  PLAYER_START,
  R,
  RECHARGE,
  SHELL_COOLDOWN,
  SHELL_MASS,
  SHELL_R,
  START_KITS,
  STEP,
  TOP,
  coverFor,
  deepFreeze,
  fieldOf,
} from './iron-bastion-data.js';
import { spawn, stepEnemies } from './iron-bastion-ai.js';
import { drawBastion } from './iron-bastion-draw.js';
import { menuStep } from './iron-bastion-menu.js';
import {
  circleHitsRect,
  drive,
  fireShell,
  resolveTankContacts,
  stepShells,
  turn,
  wrap,
} from './iron-bastion-physics.js';
import { finish, toast } from './iron-bastion-rules.js';

export const meta = deepFreeze({
  id: 'iron-bastion',
  name: { en: 'Iron Bastion', zh: '钢铁堡垒' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: `Defend the beacon across ${FIELD_COUNT} battlefields, from a quiet Courtyard to Bastion Prime. Move and fire, break brick (steel is solid) and shoot down enemy shells. Hold X to brake and turn the turret with Left/Right; touch the field to aim and fire. Rounds are limited and the cannon holds a four-shell magazine that recharges slowly, so aim every shot. Scouts weave, gunners shell from far off and heavies soak hits. H uses a repair kit: +2 armor and +1 nearby beacon. Pick a field from the level select; progress is saved.`,
    zh: `保卫信标，闯过${FIELD_COUNT}座战场，从宁静的庭院一直打到堡垒核心。移动射击，击碎砖墙（钢墙不可摧毁），并击落敌方炮弹。按住X刹车，左右键转动炮塔；触按场地瞄准射击。弹药有限，炮膛只装四发并缓慢回充，务必瞄准再打。侦察车会蛇形走位，炮手远程轰击，重型车能挨多发。按H使用维修包：装甲+2，附近信标+1。可在关卡选择中挑选战场，进度会被保存。`,
  },
  keys: [
    { label: { en: 'Drive and face', zh: '行驶 / 朝向' }, keys: 'WASD / Arrows' },
    { label: { en: 'Fire', zh: '射击' }, keys: 'Space / J' },
    { label: { en: 'Hold brake; Left/Right aim', zh: '按住刹车；左右瞄准' }, keys: 'X / K' },
    { label: { en: 'Repair kit', zh: '维修包' }, keys: 'H / E' },
    {
      label: { en: 'Level select: choose and start', zh: '关卡选择：选定并开始' },
      keys: 'Arrows + Space',
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'ArrowUp', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'ArrowDown', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'Space', side: 'right', label: { en: 'Fire', zh: '射击' } },
    { code: 'KeyX', side: 'right', label: { en: 'Brake/Aim', zh: '刹车瞄准' } },
    { code: 'KeyH', side: 'right', label: { en: 'Repair', zh: '维修' } },
  ],
});

const TRANSITION_TIME = 2;
const TOAST_TIME = 4;
const KIT_REACH = 22;
const REPAIR_REACH = 75;
const KIT_ARMOR = 2;
const BUILD_CLEARANCE = 18;
const KIT_CLEARANCE = 10;
const BRAKE_TURN_RATE = 2.8;
const DRIVE_SPEED = 88;
const FIELD_CLEAR_BONUS = 100;
const CANVAS_W = 480;
const CANVAS_H = 320;

const newPlayer = (rounds) => ({
  id: 'player',
  x: PLAYER_START.x,
  y: PLAYER_START.y,
  r: R,
  mass: HULL_MASS + rounds * SHELL_MASS,
  rounds,
  charge: MAGAZINE,
  vx: 0,
  vy: 0,
  angle: -Math.PI / 2,
  omega: 0,
  turret: -Math.PI / 2,
  turretOmega: 0,
  bearing: -Math.PI / 2,
  cooldown: 0,
  flash: 0,
  muzzle: 0,
});

// Resets everything that belongs to one battlefield; the tank and its stores stay as they are.
function loadField(s, n) {
  const field = fieldOf(n);
  s.field = n;
  s.toSpawn = field.roster.length;
  s.spawned = 0;
  s.spawnClock = field.start;
  s.pendingSpawn = null;
  s.clearing = false;
  s.transition = 0;
  s.tiles = coverFor(n);
  s.enemies = [];
  s.bullets = [];
  s.rubble = [];
  s.toast = {
    en: `${field.name.en}: ${field.tip.en}`,
    zh: `${field.name.zh}：${field.tip.zh}`,
    time: TOAST_TIME,
  };
}

export function createBastionState(first = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    field: first,
    lives: MAX_ARMOR,
    baseHealth: MAX_BEACON,
    time: 0,
    acc: 0,
    menuClock: 0,
    spawned: 0,
    toSpawn: 0,
    spawnClock: 0,
    pendingSpawn: null,
    transition: 0,
    clearing: false,
    kits: START_KITS,
    defeated: 0,
    shellId: 0,
    unlocked: first,
    pointerHeld: false,
    menu: null,
    constructionSkipped: [],
    tiles: [],
    enemies: [],
    bullets: [],
    pickups: [],
    particles: [],
    rubble: [],
    toast: { en: '', zh: '', time: 0 },
    player: newPlayer(fieldOf(first).ammo),
  };
  loadField(s, first);
  return s;
}

function repair(s, env) {
  const near = Math.hypot(s.player.x - BEACON.x, s.player.y - BEACON.y) <= REPAIR_REACH,
    armor = s.lives < MAX_ARMOR,
    beacon = near && s.baseHealth < MAX_BEACON;
  if (s.kits === 0) {
    toast(s, 'No repair kits — collect a marked supply', '没有维修包，收集标记补给');
    return;
  }
  if (!armor && !beacon) {
    const hurt = s.baseHealth < MAX_BEACON;
    toast(
      s,
      hurt ? 'Approach the beacon to repair it' : 'Armor and beacon full — kit saved',
      hurt ? '靠近信标才能维修' : '装甲和信标完好，保留维修包',
    );
    return;
  }
  s.kits--;
  s.lives = Math.min(MAX_ARMOR, s.lives + KIT_ARMOR);
  if (near) s.baseHealth = Math.min(MAX_BEACON, s.baseHealth + 1);
  toast(s, 'Kit used: armor +2, nearby beacon +1', '使用维修包：装甲+2，附近信标+1');
  env.sound('coin');
}

// Engineers rearm the tank for the next field, rebuild its cover around the tank without
// walling it in, and add one armor, one beacon point and one kit.
function advanceField(s) {
  const p = s.player,
    field = fieldOf(s.field + 1),
    oldMass = p.mass;
  p.mass += (field.ammo - p.rounds) * SHELL_MASS;
  p.vx *= oldMass / p.mass;
  p.vy *= oldMass / p.mass;
  p.rounds = field.ammo;
  p.charge = MAGAZINE;
  loadField(s, field.n);
  s.constructionSkipped = [];
  s.tiles = s.tiles.filter((t) => {
    const blocked =
      circleHitsRect(p.x, p.y, R + BUILD_CLEARANCE, t) ||
      s.pickups.some((k) => circleHitsRect(k.x, k.y, R + KIT_CLEARANCE, t));
    if (blocked) s.constructionSkipped.push({ ...t });
    return !blocked;
  });
  s.baseHealth = Math.min(MAX_BEACON, s.baseHealth + 1);
  s.lives = Math.min(MAX_ARMOR, s.lives + 1);
  s.kits = Math.min(MAX_KITS, s.kits + 1);
}

// A skipped tile returns as soon as no tank, shell or arrival is near its slot, so standing on
// a slot only delays the cover and never deletes it.
const REBUILD_SHELL_MARGIN = SHELL_R + 2;
function rebuildCover(s) {
  if (s.constructionSkipped.length === 0) return;
  const free = (t) =>
    ![s.player, ...s.enemies].some((a) => circleHitsRect(a.x, a.y, R + BUILD_CLEARANCE, t)) &&
    !s.bullets.some((b) => circleHitsRect(b.x, b.y, REBUILD_SHELL_MARGIN, t)) &&
    !(s.pendingSpawn && circleHitsRect(s.pendingSpawn.x, s.pendingSpawn.y, R + BUILD_CLEARANCE, t));
  const ready = s.constructionSkipped.filter(free);
  if (ready.length === 0) return;
  s.tiles = [...s.tiles, ...ready];
  s.constructionSkipped = s.constructionSkipped.filter((t) => !ready.includes(t));
}

// Progress is a convenience: a broken or missing store must never stop the game.
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isNaN(n) ? 1 : clamp(n, 1, FIELD_COUNT);
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, n) {
  try {
    progress.unlock(n);
  } catch {
    // The field simply is not remembered.
  }
}

// A pointer counts only inside the canvas and below the HUD; anything else is ignored.
function readPointer(i) {
  const q = i.pointer ?? {},
    x = Number(q.x),
    y = Number(q.y);
  return q.down && x >= 0 && x <= CANVAS_W && y >= TOP && y <= CANVAS_H ? { x, y } : null;
}

function clearCheck(s, env) {
  if (s.spawned === s.toSpawn && s.enemies.length === 0 && !s.pendingSpawn) s.clearing = true;
  if (s.player.rounds === 0 && s.bullets.length === 0 && !s.clearing) {
    finish(s, env, false);
    return;
  }
  if (!s.clearing || s.bullets.length > 0) return;
  s.score += s.baseHealth * FIELD_CLEAR_BONUS;
  s.unlocked = Math.max(s.unlocked, Math.min(FIELD_COUNT, s.field + 1));
  saveUnlocked(env.progress, s.unlocked);
  if (s.field === FIELD_COUNT) {
    finish(s, env, true);
    return;
  }
  s.transition = TRANSITION_TIME;
  toast(
    s,
    'Cease fire: engineers add +1 armor / beacon / kit',
    '停火整备：工程队补充装甲／信标／维修包各+1',
  );
  env.sound('win');
}

// The player's cannon: a pointer aims where it points (and holds still on the tank itself) and
// fires only once the turret has settled on it; the keyboard turns the turret by hand while braking.
// Returns whether a pointer shot is lined up.
function steerTurret(p, ctl, h) {
  if (!ctl.pointer) {
    // Braking turns the turret by hand, driving points it along the heading, otherwise it holds.
    const driving = !ctl.park && (ctl.ix !== 0 || ctl.iy !== 0);
    turn(
      p,
      'turret',
      'turretOmega',
      driving ? p.bearing : p.turret,
      h,
      ctl.park ? ctl.ix * BRAKE_TURN_RATE : null,
    );
    return false;
  }
  const dx = ctl.pointer.x - p.x,
    dy = ctl.pointer.y - p.y,
    onTank = Math.hypot(dx, dy) < AIM_DEAD_ZONE,
    target = onTank ? p.turret : Math.atan2(dy, dx);
  turn(p, 'turret', 'turretOmega', target, h);
  return onTank || Math.abs(wrap(target - p.turret)) < POINTER_ALIGNMENT;
}

function substep(s, h, ctl, env) {
  const field = fieldOf(s.field),
    p = s.player;
  s.time += h;
  s.toast.time = Math.max(0, s.toast.time - h);
  s.particles = s.particles.filter((q) => (q.life -= h) > 0);
  for (const q of s.particles) {
    q.x += q.vx * h;
    q.y += q.vy * h;
  }
  const starts = new Map([s.player, ...s.enemies].map((a) => [a.id, { x: a.x, y: a.y }]));
  p.cooldown = Math.max(0, p.cooldown - h);
  p.flash = Math.max(0, p.flash - h);
  p.muzzle = Math.max(0, p.muzzle - h);
  p.charge = Math.min(MAGAZINE, p.charge + RECHARGE * h);
  if (!ctl.park && (ctl.ix || ctl.iy)) p.bearing = Math.atan2(ctl.iy, ctl.ix);
  const lined = steerTurret(p, ctl, h);
  if (
    !s.transition &&
    !s.clearing &&
    (ctl.fire || lined) &&
    p.cooldown === 0 &&
    p.charge >= 1 &&
    fireShell(s, p, 'player', env)
  ) {
    p.charge -= 1;
    p.cooldown = SHELL_COOLDOWN;
  }
  drive(p, p.bearing, !ctl.park && (ctl.ix !== 0 || ctl.iy !== 0), h, DRIVE_SPEED);
  if (s.transition > 0) {
    s.transition = Math.max(0, s.transition - h);
    resolveTankContacts(s);
    if (s.transition === 0) advanceField(s);
    return;
  }
  rebuildCover(s);
  spawn(s, h, env, field);
  stepEnemies(s, h, env, field);
  resolveTankContacts(s);
  stepShells(s, h, env, starts);
  if (s.phase !== 'playing') return;
  s.pickups = s.pickups.filter((k) => {
    if (s.kits >= MAX_KITS || Math.hypot(k.x - p.x, k.y - p.y) > KIT_REACH) return true;
    s.kits++;
    toast(s, 'Repair kit collected', '已收集维修包');
    env.sound('coin');
    return false;
  });
  clearCheck(s, env);
}

export function stepBastion(s, dt, i, env) {
  if (s.phase !== 'playing') return;
  const frame = Number.isFinite(dt) ? clamp(dt, 0, MAX_DT) : 0;
  if (s.menu) {
    s.menuClock += frame;
    const chosen = menuStep(s.menu, i);
    if (chosen) {
      s.menu = null;
      s.pointerHeld = Boolean(i.pointer?.down);
      s.player = newPlayer(fieldOf(chosen).ammo);
      loadField(s, chosen);
    }
    return;
  }
  if (frame === 0) return;
  if (i.pressed('KeyH', 'KeyE')) repair(s, env);
  s.pointerHeld = s.pointerHeld && Boolean(i.pointer?.down);
  const ctl = {
    ix: Number(i.held('ArrowRight', 'KeyD')) - Number(i.held('ArrowLeft', 'KeyA')),
    iy: Number(i.held('ArrowDown', 'KeyS')) - Number(i.held('ArrowUp', 'KeyW')),
    park: i.held('KeyX', 'KeyK'),
    fire: i.held('Space', 'KeyJ'),
    pointer: s.pointerHeld ? null : readPointer(i),
  };
  // A fixed 1/240 s step makes every frame rate follow the same trajectory.
  s.acc += frame;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let tick = 0; tick < steps && s.phase === 'playing'; tick++) substep(s, STEP, ctl, env);
}

function statusOf(s) {
  if (s.menu)
    return {
      en: `Iron Bastion · choose a field · ${s.menu.unlocked}/${FIELD_COUNT} open · field ${s.menu.cursor}`,
      zh: `钢铁堡垒 · 选择战场 · 已开放 ${s.menu.unlocked}/${FIELD_COUNT} · 第${s.menu.cursor}战场`,
    };
  const field = fieldOf(s.field);
  return {
    en: `${field.name.en} ${s.field}/${FIELD_COUNT} · Armor ${s.lives}/${MAX_ARMOR} · Beacon ${s.baseHealth}/${MAX_BEACON} · ${s.kits} repair ${s.kits === 1 ? 'kit' : 'kits'} · ${s.player.rounds} rounds`,
    zh: `${field.name.zh} ${s.field}/${FIELD_COUNT} · 装甲 ${s.lives}/${MAX_ARMOR} · 信标 ${s.baseHealth}/${MAX_BEACON} · ${s.kits}维修包 · ${s.player.rounds}发炮弹`,
  };
}

export function createGame(env) {
  const s = createBastionState(1),
    unlocked = readUnlocked(env.progress);
  s.unlocked = unlocked;
  if (unlocked > 1) s.menu = { cursor: unlocked, unlocked, locked: 0 };
  return {
    update: (dt, i) => stepBastion(s, dt, i, env),
    draw: (ctx) => drawBastion(ctx, s, env),
    getState: () => ({ ...structuredClone(s), status: statusOf(s) }),
  };
}
