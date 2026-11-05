import { clamp, drawPixelText, pixelSprite, background } from '../shared/utils.js';

const CONTROL_1 = [
  ['KeyA', 'Left', '左'],
  ['KeyD', 'Right', '右'],
  ['KeyW', 'Jump', '跳跃'],
  ['KeyS', 'Guard', '举盾'],
  ['KeyJ', 'Quick', '轻击'],
  ['KeyK', 'Heavy', '重击'],
];
const CONTROL_2 = [
  ['ArrowLeft', 'Left', '左'],
  ['ArrowRight', 'Right', '右'],
  ['ArrowUp', 'Jump', '跳跃'],
  ['ArrowDown', 'Guard', '举盾'],
  ['Comma', 'Quick', '轻击'],
  ['Period', 'Heavy', '重击'],
];
export const meta = {
  id: 'ember-knights',
  name: { en: 'Ember Knights', zh: '余烬骑士' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Defeat six castle champions, or duel a friend first to two rounds. Hold Quick or Heavy to repeat deliberate swings. Raise Guard just before contact to parry; heavy blows break tired guards. Release Guard to recover stamina. Jumps have a fixed arc.',
    zh: '击败六位城堡冠军，或与好友先赢两回合。按住轻击或重击可连续挥击。接触前举盾可招架；重击能破除疲劳防御。松开举盾恢复体力，跳跃为固定弧线。',
  },
  keys: [
    {
      label: {
        en: 'P1 move / fixed jump / guard (tap to parry)',
        zh: '玩家1 移动 / 定高跳跃 / 举盾（轻按招架）',
      },
      keys: 'A D / W / S',
    },
    { label: { en: 'P1 hold quick / heavy', zh: '玩家1 按住轻击 / 重击' }, keys: 'J or Space / K' },
    {
      label: { en: 'P2 move / fixed jump / guard', zh: '玩家2 移动 / 定高跳跃 / 举盾' },
      keys: '← → / ↑ / ↓',
    },
    { label: { en: 'P2 hold quick / heavy', zh: '玩家2 按住轻击 / 重击' }, keys: ', / .' },
  ],
  touchControls: CONTROL_1.map(([code, en, zh], i) => ({
    code,
    side: i < 3 ? 'left' : 'right',
    label: { en, zh },
  })),
  multiplayerTouchControls: [
    ...CONTROL_1.map(([code, en, zh]) => ({
      code,
      side: 'left',
      label: { en: `1 ${en}`, zh: `1 ${zh}` },
    })),
    ...CONTROL_2.map(([code, en, zh]) => ({
      code,
      side: 'right',
      label: { en: `2 ${en}`, zh: `2 ${zh}` },
    })),
  ],
};

const FLOOR = 260,
  LEFT = 12,
  RIGHT = 468,
  GRAVITY = 680,
  STEP = 1 / 120,
  EPS = 1e-7;
const approach = (value, target, amount) =>
  value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const rect = (f) => ({ x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h });
const phaseOf = (a) =>
  a.age < a.startup ? 'windup' : a.age < a.startup + a.active ? 'active' : 'recovery';
const CHAMPIONS = [
  {
    en: 'Gate Recruit',
    zh: '守门新兵',
    style: 'recruit',
    arena: 'courtyard',
    color: '#7b725d',
    gear: 'sword',
    pace: 0.9,
    preferred: 36,
    pattern: ['light', 'light', 'heavy'],
    lesson: {
      en: 'Watch the raised blade; strike during recovery.',
      zh: '看清举剑前摇，抓住收招反击。',
    },
  },
  {
    en: 'Copper Guard',
    zh: '铜盾守卫',
    style: 'guard',
    arena: 'hall',
    color: '#947450',
    gear: 'shield',
    pace: 1.0,
    preferred: 44,
    pattern: ['guard', 'heavy', 'light', 'guard'],
    lesson: {
      en: 'Heavy blows drain the shield. Do not attack a fresh parry.',
      zh: '用重击消耗盾牌体力，避开刚举盾的招架。',
    },
  },
  {
    en: 'Ash Duelist',
    zh: '灰烬剑客',
    style: 'duelist',
    arena: 'garden',
    color: '#8a637e',
    gear: 'saber',
    pace: 0.75,
    preferred: 40,
    pattern: ['feint', 'light', 'thrust', 'light'],
    lesson: {
      en: 'Let the retreat finish, then meet the lunge with your guard.',
      zh: '等后撤结束，用盾迎接突进。',
    },
  },
  {
    en: 'Forge Hammer',
    zh: '熔炉重锤',
    style: 'hammer',
    arena: 'forge',
    color: '#9e5847',
    gear: 'hammer',
    pace: 1.15,
    preferred: 51,
    pattern: ['heavy', 'heavy', 'light'],
    lesson: {
      en: 'A braced hammer resists quick interrupts. Parry, then punish recovery.',
      zh: '蓄势重锤抵抗轻击打断，招架后抓住收招反击。',
    },
  },
  {
    en: 'Frost Sentinel',
    zh: '寒霜哨兵',
    style: 'sentinel',
    arena: 'rampart',
    color: '#557a90',
    gear: 'spear',
    pace: 0.85,
    preferred: 53,
    pattern: ['guard', 'thrust', 'thrust', 'heavy'],
    lesson: {
      en: 'The spear reaches far. Jump across or guard, then close in.',
      zh: '长枪攻击距离远，跳过或格挡后近身。',
    },
  },
  {
    en: 'Ember Regent',
    zh: '余烬摄政',
    style: 'regent',
    arena: 'throne',
    color: '#a16e43',
    gear: 'crown',
    pace: 0.65,
    preferred: 44,
    pattern: ['light', 'heavy', 'guard', 'thrust', 'feint', 'heavy'],
    lesson: {
      en: 'Read each stance. Keep stamina for the next exchange.',
      zh: '辨认每种架势，为下一轮交锋保留体力。',
    },
  },
];

function constrainedInverseMass(f, normal) {
  if (
    (normal.x < 0 && f.x - f.w / 2 <= LEFT + EPS) ||
    (normal.x > 0 && f.x + f.w / 2 >= RIGHT - EPS)
  )
    return 0;
  if (normal.y > 0 && f.y >= FLOOR - EPS) return 0;
  return 1 / (f.mass ?? 80);
}
/** Inelastic body contact cannot cause damage or create kinetic energy. */
export function resolveBodyContact(a, b, { nx, ny }) {
  const closing = -((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  if (closing <= EPS) return 0;
  const ia = constrainedInverseMass(a, { x: nx, y: ny }),
    ib = constrainedInverseMass(b, { x: -nx, y: -ny });
  if (ia + ib <= 0) return 0;
  const impulse = closing / (ia + ib);
  a.vx += nx * impulse * ia;
  a.vy += ny * impulse * ia;
  b.vx -= nx * impulse * ib;
  b.vy -= ny * impulse * ib;
  return impulse;
}
function sweepBodies(a, b, dt) {
  const dx = a.x - b.x,
    dy = a.y - a.h / 2 - (b.y - b.h / 2);
  let enter = 0,
    exit = dt,
    normal = null,
    smallest = Infinity,
    overlapNormal = null;
  for (const [distance, velocity, radius, nx, ny] of [
    [dx, a.vx - b.vx, (a.w + b.w) / 2, 1, 0],
    [dy, a.vy - b.vy, (a.h + b.h) / 2, 0, 1],
  ]) {
    const depth = radius - Math.abs(distance);
    if (depth < smallest) {
      smallest = depth;
      overlapNormal = { nx: nx * (distance >= 0 ? 1 : -1), ny: ny * (distance >= 0 ? 1 : -1) };
    }
    if (Math.abs(velocity) < EPS) {
      if (Math.abs(distance) > radius + EPS) return null;
      continue;
    }
    const t1 = (-radius - distance) / velocity,
      t2 = (radius - distance) / velocity,
      near = Math.min(t1, t2),
      far = Math.max(t1, t2);
    if (near > enter) {
      enter = near;
      const sign = distance + velocity * near >= 0 ? 1 : -1;
      normal = { nx: nx * sign, ny: ny * sign };
    }
    exit = Math.min(exit, far);
    if (enter > exit + EPS) return null;
  }
  if (exit < -EPS || enter > dt + EPS) return null;
  normal ??= overlapNormal;
  if (
    enter <= EPS &&
    smallest <= EPS &&
    (a.vx - b.vx) * normal.nx + (a.vy - b.vy) * normal.ny >= -EPS
  )
    return null;
  return {
    ...normal,
    time: Math.max(0, enter),
    penetration: enter <= EPS ? Math.max(0, smallest) : 0,
  };
}
function refreshSupport(f, bodies) {
  if (f.y >= FLOOR - EPS && f.vy >= 0) {
    f.y = FLOOR;
    f.vy = 0;
    f.grounded = true;
    f.support = 'floor';
    return;
  }
  const support = bodies.find(
    (b) =>
      b !== f &&
      b.grounded &&
      Math.abs(f.y - (b.y - b.h)) < 1e-5 &&
      Math.abs(f.x - b.x) < (f.w + b.w) / 2 - EPS,
  );
  if (support && f.vy >= 0) {
    f.vy = 0;
    f.grounded = true;
    f.support = support.id;
  } else {
    f.grounded = false;
    f.support = null;
  }
}
function moveBodiesLinear(bodies, dt) {
  let remaining = dt;
  for (let n = 0; n < 12 && remaining > EPS; n++) {
    let event = null,
      time = remaining + 1;
    for (let i = 0; i < bodies.length; i++) {
      const f = bodies[i];
      if (f.vx < 0) {
        const t = (LEFT + f.w / 2 - f.x) / f.vx;
        if (t >= -EPS && t < time) {
          event = { type: 'left', i };
          time = Math.max(0, t);
        }
      }
      if (f.vx > 0) {
        const t = (RIGHT - f.w / 2 - f.x) / f.vx;
        if (t >= -EPS && t < time) {
          event = { type: 'right', i };
          time = Math.max(0, t);
        }
      }
      if (f.vy > 0) {
        const t = (FLOOR - f.y) / f.vy;
        if (t >= -EPS && t < time) {
          event = { type: 'floor', i };
          time = Math.max(0, t);
        }
      }
      for (let j = i + 1; j < bodies.length; j++) {
        const hit = sweepBodies(f, bodies[j], remaining);
        if (hit && hit.time < time) {
          event = { type: 'body', i, j, hit };
          time = hit.time;
        }
      }
    }
    const travel = event ? Math.min(remaining, time) : remaining;
    for (const f of bodies) {
      f.x += f.vx * travel;
      f.y += f.vy * travel;
    }
    remaining -= travel;
    if (!event || time > travel + EPS) break;
    const f = bodies[event.i];
    if (event.type === 'floor') {
      f.y = FLOOR;
      f.vy = 0;
      f.grounded = true;
      f.support = 'floor';
    } else if (event.type === 'left' || event.type === 'right') {
      f.x = event.type === 'left' ? LEFT + f.w / 2 : RIGHT - f.w / 2;
      f.vx = 0;
    } else {
      const other = bodies[event.j],
        hit = event.hit;
      if (hit.penetration > EPS) {
        const ia = constrainedInverseMass(f, { x: hit.nx, y: hit.ny }),
          ib = constrainedInverseMass(other, { x: -hit.nx, y: -hit.ny }),
          sum = ia + ib;
        if (sum) {
          f.x += (hit.nx * hit.penetration * ia) / sum;
          f.y += (hit.ny * hit.penetration * ia) / sum;
          other.x -= (hit.nx * hit.penetration * ib) / sum;
          other.y -= (hit.ny * hit.penetration * ib) / sum;
        }
      }
      resolveBodyContact(f, other, hit);
      if (hit.ny < 0 && other.grounded && Math.abs(f.vy) < EPS) {
        f.grounded = true;
        f.support = other.id;
      }
      if (hit.ny > 0 && f.grounded && Math.abs(other.vy) < EPS) {
        other.grounded = true;
        other.support = f.id;
      }
    }
  }
  // With only two bodies, an anchored resting contact is solved directly above.
  // Any remaining time contains no unprocessed high-speed approach.
  if (remaining > EPS)
    for (const f of bodies) {
      f.x += f.vx * remaining;
      f.y += f.vy * remaining;
    }
}
/** Velocity-Verlet gravity, swept bodies, and solid floor/wall support. */
export function advanceDuelBodies(bodies, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  let remaining = dt;
  while (remaining > EPS) {
    const h = Math.min(STEP, remaining);
    for (const f of bodies) {
      refreshSupport(f, bodies);
      if (!f.grounded) f.vy += (GRAVITY * h) / 2;
    }
    moveBodiesLinear(bodies, h);
    for (const f of bodies) {
      refreshSupport(f, bodies);
      if (!f.grounded) f.vy += (GRAVITY * h) / 2;
    }
    remaining -= h;
  }
}

function attackSpec(type, style) {
  let spec =
    type === 'heavy'
      ? {
          startup: 0.44,
          active: 0.2,
          recovery: 0.66,
          length: 40,
          damage: 22,
          guardCost: 40,
          knock: 110,
          cost: 28,
        }
      : type === 'thrust'
        ? {
            startup: 0.4,
            active: 0.14,
            recovery: 0.5,
            length: 44,
            damage: 13,
            guardCost: 21,
            knock: 80,
            cost: 16,
          }
        : {
            startup: 0.18,
            active: 0.16,
            recovery: 0.29,
            length: 28,
            damage: 10,
            guardCost: 15,
            knock: 65,
            cost: 12,
          };
  if (style === 'recruit')
    spec = {
      ...spec,
      startup: type === 'heavy' ? 0.65 : 0.37,
      recovery: 0.65,
      damage: type === 'heavy' ? 20 : 9,
    };
  if (style === 'guard') spec = { ...spec, startup: type === 'heavy' ? 0.55 : 0.3, recovery: 0.65 };
  if (style === 'duelist')
    spec = {
      ...spec,
      startup: type === 'heavy' ? 0.5 : 0.26,
      recovery: type === 'thrust' ? 0.4 : 0.36,
      length: spec.length + 3,
    };
  if (style === 'hammer')
    spec = {
      ...spec,
      startup: type === 'heavy' ? 0.7 : 0.38,
      recovery: type === 'heavy' ? 0.95 : 0.6,
      length: type === 'heavy' ? 44 : 32,
      damage: type === 'heavy' ? 26 : 12,
      knock: type === 'heavy' ? 135 : 75,
    };
  if (style === 'sentinel')
    spec = {
      ...spec,
      startup: type === 'heavy' ? 0.58 : 0.45,
      recovery: 0.62,
      length: type === 'thrust' ? 49 : spec.length,
    };
  if (style === 'regent')
    spec = {
      ...spec,
      startup: type === 'heavy' ? 0.5 : type === 'thrust' ? 0.4 : 0.28,
      recovery: type === 'heavy' ? 0.66 : 0.43,
    };
  return spec;
}
/** The renderer and damage test use exactly the same moving weapon segment. */
export function weaponPose(f, attack = f.attack) {
  const face = attack?.face ?? f.face,
    phase = attack ? phaseOf(attack) : 'idle';
  const handHeight =
    attack?.type === 'heavy' && phase === 'windup' ? 29 : phase === 'recovery' ? 23 : 25;
  const base = { x: f.x + face * 8, y: f.y - handHeight };
  let angle = -1.32,
    length = f.gear === 'spear' ? 34 : 23,
    active = false,
    radius = 1.5,
    tipRadius = 1.5;
  if (attack) {
    const phase = phaseOf(attack);
    length = attack.length;
    active = phase === 'active';
    const t =
      phase === 'windup'
        ? clamp(attack.age / attack.startup, 0, 1)
        : phase === 'active'
          ? clamp((attack.age - attack.startup) / attack.active, 0, 1)
          : clamp((attack.age - attack.startup - attack.active) / attack.recovery, 0, 1);
    if (attack.type === 'heavy')
      angle =
        phase === 'windup'
          ? -2.1 + t * 0.9
          : phase === 'active'
            ? -1.2 + t * 1.95
            : 0.75 - t * 2.07;
    else if (attack.type === 'thrust')
      angle =
        phase === 'windup'
          ? -0.8 + t * 0.65
          : phase === 'active'
            ? -0.15 + t * 0.3
            : 0.15 - t * 1.47;
    else
      angle = phase === 'windup' ? -1.4 + t : phase === 'active' ? -0.4 + t * 0.8 : 0.4 - t * 1.72;
    if (f.gear === 'hammer') {
      radius = 1.5;
      tipRadius = 5;
    }
    if (f.gear === 'spear') {
      radius = 1.2;
      tipRadius = 3;
    }
  }
  return {
    base,
    tip: { x: base.x + face * Math.cos(angle) * length, y: base.y + Math.sin(angle) * length },
    active,
    radius,
    tipRadius,
  };
}
function segmentRect(a, b, r) {
  let enter = 0,
    exit = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, r.x, r.x + r.w],
    [a.y, b.y - a.y, r.y, r.y + r.h],
  ]) {
    if (Math.abs(delta) < EPS) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const t1 = (min - origin) / delta,
      t2 = (max - origin) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  return true;
}
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function capsuleRect(a, b, radius, r) {
  if (segmentRect(a, b, r)) return true;
  for (const p of [a, b])
    if (Math.hypot(p.x - clamp(p.x, r.x, r.x + r.w), p.y - clamp(p.y, r.y, r.y + r.h)) <= radius)
      return true;
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ].some((p) => pointSegmentDistance(p, a, b) <= radius);
}
export function resolveStrike(attacker, target) {
  const attack = attacker.attack;
  if (!attack || attack.hit || phaseOf(attack) !== 'active')
    return { hit: false, damage: 0, knock: 0 };
  const pose = weaponPose(attacker),
    body = rect(target);
  let hit =
    capsuleRect(pose.base, pose.tip, pose.radius, body) ||
    capsuleRect(pose.tip, pose.tip, pose.tipRadius, body);
  if (!hit && attack.previousPose) {
    const previous = attack.previousPose,
      dx = target.x - (target.previousX ?? target.x),
      dy = target.y - (target.previousY ?? target.y);
    const tip = { x: pose.tip.x - dx, y: pose.tip.y - dy };
    hit = capsuleRect(
      previous.tip,
      tip,
      Math.max(pose.radius, pose.tipRadius),
      rect({ ...target, x: target.previousX ?? target.x, y: target.previousY ?? target.y }),
    );
  }
  if (!hit) return { hit: false, damage: 0, knock: 0 };
  const blocked =
    target.blocking && (target.guardFace ?? target.face) * (attacker.x - target.x) >= -3;
  return {
    hit: true,
    blocked,
    parried: blocked && target.parry > 0,
    damage: blocked ? 0 : attack.damage,
    knock: attack.knock,
    guardCost: attack.guardCost,
  };
}
function committedHammer(f) {
  return (
    f.style === 'hammer' &&
    f.attack?.type === 'heavy' &&
    (f.attack.phase === 'active' || (f.attack.phase === 'windup' && f.attack.age >= 0.3))
  );
}

function fighter(id, x, face, style = 'player', gear = 'sword') {
  return {
    id,
    x,
    y: FLOOR,
    w: 24,
    h: 40,
    vx: 0,
    vy: 0,
    mass: style === 'hammer' ? 110 : 80,
    grounded: true,
    support: 'floor',
    face,
    guardFace: face,
    style,
    gear,
    health: 100,
    stamina: 100,
    blocking: false,
    parry: 0,
    parryCooldown: 0,
    guardBreak: 0,
    stun: 0,
    attack: null,
    actionLock: 0,
    flash: 0,
    coyote: 0.08,
    jumpBuffer: 0,
    jumpWasDown: false,
    guardWasDown: false,
    previousX: x,
    previousY: FLOOR,
  };
}
function snapshotFighter(f) {
  return {
    ...f,
    attack: f.attack
      ? {
          ...f.attack,
          previousPose: f.attack.previousPose ? structuredClone(f.attack.previousPose) : null,
        }
      : null,
  };
}

export function createGame(env) {
  let phase = 'playing',
    score = 0,
    stage = 1,
    round = 1,
    remaining = 60,
    elapsed = 0,
    roundPause = 0,
    winner = 0,
    parries = 0,
    banner = '',
    sparks = [];
  let fighters = [],
    wins = [0, 0],
    ai = { clock: 0.8, index: 0, mode: 'approach', modeTime: 0 };
  const champion = () => CHAMPIONS[stage - 1];
  function startDuel() {
    const latches = fighters.map((f) => ({
      jumpWasDown: f.jumpWasDown,
      guardWasDown: f.guardWasDown,
    }));
    fighters = [
      fighter(0, 130, 1),
      fighter(
        1,
        350,
        -1,
        env.mode === 2 ? 'player' : champion().style,
        env.mode === 2 ? 'sword' : champion().gear,
      ),
    ];
    for (let i = 0; i < latches.length; i++) Object.assign(fighters[i], latches[i]);
    remaining = 60;
    ai = { clock: 0.8, index: 0, mode: 'approach', modeTime: 0 };
  }
  startDuel();
  function finish(index, draw = false) {
    if (phase !== 'playing') return;
    winner = draw ? 0 : index + 1;
    phase = !draw && index === 0 ? 'won' : 'lost';
    env.sound(phase === 'won' ? 'win' : 'lose');
    env.end({
      won: phase === 'won',
      score,
      message: draw
        ? env.t('The duel ends in a draw.', '决斗以平局结束。')
        : env.mode !== 2 && index === 0
          ? env.t(
              'All six champions defeated. The Ember Crown is yours!',
              '六位冠军全部击败，余烬王冠属于你！',
            )
          : env.mode !== 2
            ? env.t(
                `${champion().en} wins this duel. Watch the opening and try again.`,
                `${champion().zh}赢得本场对决。看准破绽，再试一次。`,
              )
            : env.t(`Player ${index + 1} wins the match!`, `玩家${index + 1}赢得比赛！`),
    });
  }
  function closeRound(index) {
    if (roundPause > 0 || phase !== 'playing') return;
    if (index === 0)
      score += 500 + Math.ceil(Math.max(0, remaining)) * 5 + Math.round(fighters[0].health * 3);
    if (env.mode !== 2) {
      if (index !== 0) {
        finish(1, index < 0);
        return;
      }
      if (stage === 6) {
        finish(0);
        return;
      }
      banner = env.t('CHAMPION DEFEATED', '冠军已击败');
    } else {
      if (index >= 0) wins[index]++;
      if (wins[index] >= 2) {
        finish(index);
        return;
      }
      if (round === 5) {
        finish(wins[0] > wins[1] ? 0 : 1, wins[0] === wins[1]);
        return;
      }
      banner =
        index < 0
          ? env.t('ROUND DRAW', '回合平局')
          : env.t(`PLAYER ${index + 1} TAKES THE ROUND`, `玩家${index + 1}赢得回合`);
    }
    roundPause = 1.8;
    env.sound('win');
  }
  function beginAttack(f, type) {
    if (f.attack || f.actionLock > EPS || f.stun > 0 || f.blocking || f.guardBreak > 0) return;
    const spec = attackSpec(type, f.style);
    if (f.stamina < spec.cost) return;
    f.stamina -= spec.cost;
    f.actionLock = spec.startup + spec.active + spec.recovery;
    f.attack = {
      ...spec,
      type,
      face: f.face,
      age: 0,
      phase: 'windup',
      hit: false,
      previousPose: null,
    };
    env.sound('shoot');
  }
  function aiControl(dt) {
    const [a, b] = fighters,
      c = champion(),
      distance = Math.abs(a.x - b.x),
      toward = Math.sign(a.x - b.x) || -1;
    ai.clock = Math.max(0, ai.clock - dt);
    ai.modeTime = Math.max(0, ai.modeTime - dt);
    if (ai.modeTime <= 0 && ['guard', 'feint'].includes(ai.mode)) ai.mode = 'approach';
    if (!b.attack && b.actionLock <= EPS && b.stun <= 0 && ai.clock <= 0) {
      const action = c.pattern[ai.index++ % c.pattern.length];
      ai.clock = c.pace + env.random() * 0.15;
      if (action === 'guard' || action === 'feint') {
        ai.mode = action;
        ai.modeTime = action === 'guard' ? 0.9 : 0.45;
      } else if (distance < c.preferred + 20) {
        ai.mode = action;
        ai.modeTime = 0.2;
      } else {
        ai.index--;
        ai.clock = 0.15;
        ai.mode = 'approach';
      }
    }
    const retreat =
      ai.mode === 'feint' || (c.style === 'duelist' && b.attack?.phase === 'recovery');
    const move = retreat ? -toward : distance > c.preferred ? toward : 0;
    const attack =
      ai.mode === 'light' || ai.mode === 'heavy' || ai.mode === 'thrust' ? ai.mode : null;
    return {
      move,
      guard: ai.mode === 'guard',
      jump: false,
      jumpPress: false,
      light: attack === 'light',
      heavy: attack === 'heavy',
      thrust: attack === 'thrust',
    };
  }
  function readControls(input, index) {
    return index === 0
      ? {
          move: Number(input.held('KeyD')) - Number(input.held('KeyA')),
          jump: input.held('KeyW'),
          jumpPress: input.pressed('KeyW'),
          guard: input.held('KeyS'),
          light: input.held('KeyJ', 'Space'),
          heavy: input.held('KeyK'),
        }
      : {
          move: Number(input.held('ArrowRight')) - Number(input.held('ArrowLeft')),
          jump: input.held('ArrowUp'),
          jumpPress: input.pressed('ArrowUp'),
          guard: input.held('ArrowDown'),
          light: input.held('Comma'),
          heavy: input.held('Period'),
        };
  }
  function burst(f, blocked) {
    for (let n = 0; n < 9; n++)
      sparks.push({
        x: f.x,
        y: f.y - 24,
        vx: (env.random() - 0.5) * 150,
        vy: -env.random() * 120,
        life: 0.26,
        blocked,
      });
    if (sparks.length > 100) sparks.splice(0, sparks.length - 100);
  }
  function tick(dt, input) {
    elapsed += dt;
    sparks = sparks.filter((p) => (p.life -= dt) > 0);
    for (const p of sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += GRAVITY * dt;
    }
    if (roundPause > 0) {
      roundPause = Math.max(0, roundPause - dt);
      if (roundPause === 0) {
        round++;
        if (env.mode !== 2) stage++;
        startDuel();
      }
      return;
    }
    remaining = Math.max(0, remaining - dt);
    const commands = [
      readControls(input, 0),
      env.mode === 2 ? readControls(input, 1) : aiControl(dt),
    ];
    for (let i = 0; i < 2; i++) {
      const f = fighters[i],
        other = fighters[1 - i],
        c = commands[i];
      f.previousX = f.x;
      f.previousY = f.y;
      for (const name of ['stun', 'flash', 'parry', 'parryCooldown', 'guardBreak', 'actionLock'])
        f[name] = Math.max(0, f[name] - dt);
      if (f.attack) {
        f.attack.previousPose = f.attack.phase === 'active' ? weaponPose(f) : null;
        f.attack.age += dt;
        f.attack.phase = phaseOf(f.attack);
        if (f.attack.age >= f.attack.startup + f.attack.active + f.attack.recovery) f.attack = null;
      }
      if (!f.attack && !f.guardWasDown) f.face = other.x >= f.x ? 1 : -1;
      const guardEdge = c.guard && !f.guardWasDown;
      if (guardEdge && f.stun === 0 && !f.attack && f.guardBreak === 0 && f.stamina >= 12) {
        f.guardFace = f.face;
        if (f.parryCooldown === 0) {
          f.parry = 0.18;
          f.parryCooldown = 0.5;
        }
      }
      f.blocking =
        c.guard && !f.attack && f.stun === 0 && f.guardBreak === 0 && f.stamina > 0 && f.grounded;
      if (f.blocking) f.face = f.guardFace;
      f.stamina = clamp(
        f.stamina + (f.blocking ? -3 : !f.attack ? 22 : f.attack.phase === 'recovery' ? 6 : 0) * dt,
        0,
        100,
      );
      f.jumpBuffer =
        c.jumpPress || (c.jump && !f.jumpWasDown) ? 0.12 : Math.max(0, f.jumpBuffer - dt);
      f.coyote = f.grounded ? 0.08 : Math.max(0, f.coyote - dt);
      if (f.jumpBuffer > 0 && f.coyote > 0 && !f.blocking && !f.attack && f.stun === 0) {
        f.vy = -260;
        f.grounded = false;
        f.support = null;
        f.jumpBuffer = 0;
        f.coyote = 0;
        env.sound('move');
      }
      const lunge =
        f.style === 'duelist' && f.attack?.type === 'thrust' && f.attack.phase === 'active';
      const speed = f.blocking
        ? 38
        : f.attack
          ? lunge
            ? 135
            : f.attack.phase === 'recovery'
              ? 75
              : 40
          : 105;
      const target = f.stun > 0 ? 0 : c.move * speed,
        acceleration = f.grounded ? (c.move && f.stun === 0 ? 950 : 850) : 380;
      f.vx = approach(f.vx, target, acceleration * dt);
      if (c.heavy) beginAttack(f, 'heavy');
      else if (c.thrust) beginAttack(f, 'thrust');
      else if (c.light) beginAttack(f, 'light');
      if (i === 1 && env.mode !== 2 && f.attack) ai.mode = 'approach';
      f.jumpWasDown = !!c.jump;
      f.guardWasDown = !!c.guard;
    }
    advanceDuelBodies(fighters, dt);
    // Eligibility is collected before damage, stun or attack cancellation. Equal
    // contact times trade fairly; an earlier impact can still interrupt startup.
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const result = resolveStrike(fighters[i], fighters[1 - i]);
      if (result.hit) hits.push({ i, result, attack: fighters[i].attack });
    }
    const cancel = new Set();
    for (const { i, result, attack } of hits) {
      const f = fighters[i],
        target = fighters[1 - i];
      attack.hit = true;
      let damage = result.damage,
        knock = result.blocked ? 24 : result.knock;
      if (result.parried) {
        damage = 0;
        f.stun = Math.max(f.stun, 0.5);
        target.stamina = Math.min(100, target.stamina + 9);
        target.parry = 0;
        knock = 85;
        cancel.add(i);
        if (i === 1) {
          parries++;
          score += 15;
        }
      } else if (result.blocked) {
        if (target.stamina < result.guardCost) {
          target.stamina = 0;
          target.guardBreak = 1.1;
          target.blocking = false;
          target.stun = Math.max(target.stun, 0.65);
          damage = attack.damage;
          knock = result.knock;
          cancel.add(1 - i);
        } else {
          target.stamina -= result.guardCost;
          target.stun = Math.max(target.stun, 0.06);
        }
      } else {
        target.stun = Math.max(target.stun, attack.type === 'heavy' ? 0.3 : 0.18);
        if (!(attack.type === 'light' && committedHammer(target))) cancel.add(1 - i);
      }
      target.health = Math.max(0, target.health - damage);
      target.flash = 0.14;
      const impulse = target.mass * knock;
      f.vx -= (attack.face * impulse) / f.mass;
      target.vx += (attack.face * impulse) / target.mass;
      if (i === 0) score += damage * 5;
      burst(target, result.blocked);
      env.sound('hit');
    }
    for (const index of cancel) fighters[index].attack = null;
    const [a, b] = fighters;
    if (a.health <= 0 || b.health <= 0 || remaining === 0)
      closeRound(a.health === b.health ? -1 : a.health > b.health ? 0 : 1);
  }
  return {
    update(dt, input) {
      if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      let rest = Math.min(dt, 1 / 30),
        first = true;
      while (rest > EPS && phase === 'playing') {
        const h = Math.min(STEP, rest);
        tick(h, first ? input : { ...input, pressed: () => false });
        first = false;
        rest -= h;
      }
    },
    draw(ctx) {
      drawScene(
        ctx,
        {
          phase,
          score,
          stage,
          round,
          remaining,
          elapsed,
          roundPause,
          wins,
          winner,
          parries,
          banner,
          fighters,
          sparks,
          champion: champion(),
        },
        env,
      );
    },
    getState() {
      return {
        phase,
        score,
        stage,
        totalStages: 6,
        round,
        remaining,
        roundPause,
        winner,
        wins: [...wins],
        parries,
        opponent: champion().style,
        ai: { ...ai },
        fighters: fighters.map(snapshotFighter),
        particles: sparks.length,
        status: {
          en:
            env.mode === 2
              ? `Round ${round} · ${wins[0]} : ${wins[1]} · First to 2`
              : `${stage}/6 ${champion().en} · Guard timing and stamina`,
          zh:
            env.mode === 2
              ? `回合 ${round} · ${wins[0]} : ${wins[1]} · 先赢2回合`
              : `${stage}/6 ${champion().zh} · 把握举盾时机，管理体力`,
        },
      };
    },
  };
}

const BODY = [
  '....aaaa....',
  '...aaaaaa...',
  '..aaaaaaaa..',
  '..abbccbaa..',
  '..abbbbbaa..',
  '...aaaaaa...',
  '....dddd....',
  '..dddddddd..',
  '.dddeeedddd.',
  '.dddeeedddd.',
  '.dddeeedddd.',
  '..dddddddd..',
  '...dddddd...',
  '...dd..dd...',
  '...dd..dd...',
  '...dd..dd...',
  '...dd..dd...',
  '..fff..fff..',
  '..fff..fff..',
  '..fff..fff..',
];
function drawArena(ctx, arena, time) {
  background(ctx, '#222938');
  ctx.fillStyle = arena.color;
  ctx.fillRect(0, 70, 480, 157);
  for (let y = 76; y < 223; y += 20) {
    ctx.fillStyle = '#18243833';
    ctx.fillRect(0, y, 480, 1);
    for (let x = (Math.floor(y / 20) % 2) * 25; x < 480; x += 50) ctx.fillRect(x, y, 1, 20);
  }
  if (arena.arena === 'courtyard' || arena.arena === 'rampart') {
    ctx.fillStyle = arena.arena === 'rampart' ? '#b8d2cf88' : '#e9bd7c88';
    ctx.fillRect(317, 90, 34, 29);
    ctx.fillRect(321, 86, 26, 37);
    ctx.fillStyle = '#283744';
    for (let x = 0; x < 480; x += 48) {
      ctx.fillRect(x, 180 - (x % 31), 35, 58 + (x % 31));
      ctx.fillRect(x + 2, 170 - (x % 31), 8, 13);
      ctx.fillRect(x + 25, 170 - (x % 31), 8, 13);
    }
  } else if (arena.arena === 'forge') {
    ctx.fillStyle = '#302831';
    ctx.fillRect(167, 132, 147, 112);
    ctx.fillStyle = '#ad613d';
    ctx.fillRect(185, 158, 110, 76);
    ctx.fillStyle = '#e5ac55';
    for (let n = 0; n < 7; n++) ctx.fillRect(191 + n * 14, 181 + Math.sin(time * 5 + n) * 6, 9, 52);
    ctx.fillStyle = '#3a3540';
    ctx.fillRect(177, 203, 125, 7);
    ctx.fillRect(237, 151, 7, 85);
  } else if (arena.arena === 'garden') {
    ctx.fillStyle = '#304337';
    for (const x of [72, 391]) {
      ctx.fillRect(x, 119, 7, 120);
      for (let n = 0; n < 5; n++) ctx.fillRect(x - 18 + (n % 2) * 6, 137 + n * 17, 40, 9);
    }
    ctx.fillStyle = '#b699a15e';
    ctx.fillRect(176, 107, 123, 87);
    ctx.fillStyle = '#4d3f5255';
    ctx.fillRect(184, 114, 107, 80);
  } else {
    for (const x of [67, 220, 373]) {
      ctx.fillStyle = '#28333e88';
      ctx.fillRect(x, 94, 40, 111);
      ctx.fillRect(x + 7, 85, 26, 124);
      ctx.fillStyle = '#c7b98e44';
      ctx.fillRect(x + 18, 100, 4, 99);
      ctx.fillRect(x + 5, 135, 30, 4);
    }
    if (arena.arena === 'throne') {
      ctx.fillStyle = '#7f5e434f';
      ctx.fillRect(193, 174, 95, 65);
      ctx.fillRect(211, 153, 59, 90);
      ctx.fillStyle = '#d1b57755';
      ctx.fillRect(235, 162, 9, 57);
      ctx.fillRect(218, 181, 43, 7);
    }
  }
  for (const x of [17, 441]) {
    ctx.fillStyle = '#5c5c67';
    ctx.fillRect(x, 90, 22, 169);
    ctx.fillRect(x - 3, 88, 28, 8);
    ctx.fillStyle = '#a67851';
    ctx.fillRect(x + 4, 141, 14, 6);
    ctx.fillStyle = '#ffc275';
    ctx.fillRect(x + 7, 126 + Math.floor(Math.sin(time * 9 + x) * 2), 7, 16);
    ctx.fillStyle = '#ffe3a2';
    ctx.fillRect(x + 9, 130, 3, 11);
  }
  ctx.fillStyle = '#6f737c';
  ctx.fillRect(0, FLOOR, 480, 7);
  ctx.fillStyle = '#383f4d';
  ctx.fillRect(0, FLOOR + 7, 480, 53);
  for (let y = 271; y < 320; y += 15)
    for (let x = (y % 2) * 22; x < 480; x += 44) {
      ctx.strokeStyle = '#505a66';
      ctx.strokeRect(x, y, 43, 14);
    }
}
function drawFighter(ctx, f, index, time) {
  const x = Math.round(f.x),
    y = Math.round(f.y),
    palette =
      index === 0
        ? '#67d6c1'
        : f.style === 'player'
          ? '#e9a166'
          : f.style === 'hammer'
            ? '#ca8362'
            : f.style === 'sentinel'
              ? '#8cbacb'
              : '#d29590';
  ctx.fillStyle = '#14233277';
  ctx.fillRect(x - 14, FLOOR, 28, 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(f.face, 1);
  pixelSprite(ctx, BODY, -12, -40, 2, {
    a: f.flash > 0 ? '#fff5d8' : '#c5cbd0',
    b: '#263545',
    c: '#e6b985',
    d: f.flash > 0 ? '#fff5d8' : palette,
    e: '#597477',
    f: '#263442',
  });
  if (Math.abs(f.vx) > 12 && f.grounded) {
    ctx.fillStyle = '#263442';
    ctx.fillRect(Math.floor(time * 12) % 2 ? -8 : 2, -3, 6, 3);
  }
  if (!f.grounded) {
    ctx.fillStyle = palette;
    ctx.fillRect(-7, -9, 5, 3);
    ctx.fillRect(3, -13, 5, 3);
  }
  if (f.gear === 'crown') {
    ctx.fillStyle = '#efcb77';
    ctx.fillRect(-7, -42, 15, 3);
    for (let n = 0; n < 3; n++) ctx.fillRect(-6 + n * 5, -46, 3, 5);
  }
  if (f.gear === 'hammer') {
    ctx.fillStyle = committedHammer(f) ? '#ddc9a2' : '#7b554e';
    ctx.fillRect(-12, -29, 6, 12);
    ctx.fillRect(7, -29, 5, 12);
  }
  if (f.gear === 'saber') {
    ctx.fillStyle = '#815769';
    ctx.fillRect(-11, -29, 4, 21);
    ctx.fillStyle = '#d9c0a6';
    ctx.fillRect(-5, -35, 10, 2);
  }
  if (f.gear === 'spear') {
    ctx.fillStyle = '#829fae';
    ctx.fillRect(-10, -31, 4, 11);
    ctx.fillRect(7, -31, 4, 11);
    ctx.fillStyle = '#d6e3d2';
    ctx.fillRect(-2, -40, 4, 4);
  }
  if (f.gear === 'shield') {
    ctx.fillStyle = '#e1bb76';
    ctx.fillRect(-5, -28, 10, 3);
    ctx.fillRect(-2, -29, 4, 12);
  }
  if (f.attack?.phase === 'windup') {
    ctx.fillStyle = palette;
    ctx.fillRect(7, -33, 4, 9);
  }
  if (f.attack?.phase === 'active') {
    ctx.fillStyle = palette;
    ctx.fillRect(6, -28, 6, 5);
  }
  if (f.attack?.phase === 'recovery' || (!f.attack && f.actionLock > 0)) {
    ctx.fillStyle = palette;
    ctx.fillRect(6, -24, 4, 11);
  }
  if (f.blocking) {
    ctx.fillStyle = f.parry > 0 ? '#d6fffa' : '#d7b574';
    ctx.fillRect(7, -38, 5, 34);
    ctx.fillStyle = '#66869a';
    ctx.fillRect(8, -35, 3, 27);
    ctx.fillStyle = '#dfcb9f';
    ctx.fillRect(7, -23, 5, 3);
  }
  ctx.restore();
  const pose = weaponPose(f);
  ctx.strokeStyle = palette;
  ctx.lineWidth = 4;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(f.x + f.face * 4, f.y - 29);
  ctx.lineTo(pose.base.x, pose.base.y);
  ctx.stroke();
  if (f.attack?.previousPose && pose.active) {
    ctx.strokeStyle = '#f5d79a66';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(f.attack.previousPose.tip.x, f.attack.previousPose.tip.y);
    ctx.lineTo(pose.tip.x, pose.tip.y);
    ctx.stroke();
  }
  ctx.strokeStyle = pose.active ? '#fff1c7' : '#aebfce';
  ctx.lineWidth = pose.radius * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pose.base.x, pose.base.y);
  ctx.lineTo(pose.tip.x, pose.tip.y);
  ctx.stroke();
  if (f.gear === 'hammer' && f.attack) {
    ctx.fillStyle = '#b7c0c6';
    ctx.fillRect(pose.tip.x - 4, pose.tip.y - 3, 8, 6);
    ctx.fillStyle = '#e1d4ab';
    ctx.fillRect(pose.tip.x - 3, pose.tip.y - 3, 6, 2);
  }
  if (f.gear === 'spear' && f.attack) {
    ctx.fillStyle = '#e9e0ba';
    ctx.fillRect(pose.tip.x - 2, pose.tip.y - 2, 4, 4);
  }
  if (f.attack?.phase === 'windup') {
    ctx.fillStyle = f.attack.type === 'heavy' ? '#ffba77' : '#efe0b3';
    ctx.fillRect(x - 2, y - 53, 4, 7);
    ctx.fillRect(x - 2, y - 44, 4, 2);
  }
  if (f.guardBreak > 0) drawPixelText(ctx, '!', x, y - 59, '#ffb18e', 14, 'center');
}
function drawScene(ctx, s, env) {
  drawArena(ctx, s.champion, s.elapsed);
  for (let i = 0; i < 2; i++) drawFighter(ctx, s.fighters[i], i, s.elapsed);
  for (const p of s.sparks) {
    ctx.fillStyle = p.blocked ? '#bcf5ff' : '#ffcf8a';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
  }
  ctx.fillStyle = '#151f2e';
  ctx.fillRect(0, 0, 480, 70);
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i],
      x = i === 0 ? 12 : 288;
    drawPixelText(
      ctx,
      i === 1 && env.mode !== 2
        ? env.t(s.champion.en, s.champion.zh)
        : env.t(`PLAYER ${i + 1}`, `玩家${i + 1}`),
      x,
      8,
      '#e7e5d4',
      11,
    );
    drawPixelText(ctx, `${env.t('HEALTH', '生命')} ${Math.ceil(f.health)}`, x, 22, '#d5dfd8', 10);
    drawPixelText(
      ctx,
      `${env.t('STAMINA', '体力')} ${Math.floor(f.stamina)}`,
      x + 180,
      22,
      '#e5c985',
      10,
      'right',
    );
    ctx.fillStyle = '#3b4555';
    ctx.fillRect(x, 34, 180, 9);
    ctx.fillStyle = i === 0 ? '#67d6c1' : '#dfa287';
    ctx.fillRect(x, 34, (180 * f.health) / 100, 9);
    ctx.fillStyle = '#3b4555';
    ctx.fillRect(x, 47, 180, 5);
    ctx.fillStyle = f.guardBreak > 0 ? '#ef956d' : '#d5bd76';
    ctx.fillRect(x, 47, (180 * f.stamina) / 100, 5);
    const action =
      f.guardBreak > 0
        ? env.t('GUARD BROKEN', '防御破除')
        : f.parry > 0
          ? env.t('PARRY READY', '可招架')
          : committedHammer(f)
            ? env.t('BRACED HAMMER', '重锤蓄势')
            : f.attack?.phase === 'windup'
              ? env.t('WINDUP', '攻击前摇')
              : f.attack?.phase === 'active'
                ? env.t('STRIKE', '挥击中')
                : f.attack?.phase === 'recovery' || (!f.attack && f.actionLock > 0)
                  ? env.t('RECOVERY', '攻击收招')
                  : f.blocking
                    ? env.t('GUARDING', '举盾防御')
                    : f.stamina < 12
                      ? env.t('RECOVER STAMINA', '恢复体力')
                      : env.t('READY', '准备');
    drawPixelText(ctx, action, x, 57, '#bfcbcf', 10);
  }
  drawPixelText(ctx, String(Math.ceil(s.remaining)), 240, 24, '#f0dfb4', 20, 'center');
  drawPixelText(
    ctx,
    env.mode === 2 ? `${s.wins[0]} : ${s.wins[1]}` : `${s.stage}/6`,
    240,
    52,
    '#d5c9a8',
    11,
    'center',
  );
  ctx.fillStyle = '#162132df';
  ctx.fillRect(0, 301, 480, 19);
  drawPixelText(
    ctx,
    env.mode === 2
      ? env.t(
          'HOLD ATTACK · TAP GUARD TO PARRY · RELEASE TO RECOVER',
          '按住攻击 · 轻按举盾招架 · 松盾恢复体力',
        )
      : env.t(s.champion.lesson.en, s.champion.lesson.zh),
    240,
    305,
    '#d0d9cc',
    10,
    'center',
  );
  if (s.roundPause > 0) {
    ctx.fillStyle = '#111f30ed';
    ctx.fillRect(42, 125, 396, 61);
    drawPixelText(ctx, s.banner, 240, 138, '#f0d394', 16, 'center');
    drawPixelText(
      ctx,
      env.mode === 2 ? env.t('NEXT ROUND', '下一回合') : env.t('NEXT CHAMPION', '下一位冠军'),
      240,
      164,
      '#c0d3d4',
      10,
      'center',
    );
  }
}
