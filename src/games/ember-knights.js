import { clamp } from '../shared/utils.js';
import {
  FLOOR,
  GRAVITY,
  STEP,
  EPS,
  approach,
  advanceDuelBodies,
  resolveBodyContact,
  resolveStrike,
  resistsInterrupt,
  weaponPose,
  phaseOf,
} from './ember-knights-physics.js';
import { STAGES, STAGE_COUNT, RULES, attackSpec } from './ember-knights-stages.js';
import { createBrain } from './ember-knights-ai.js';
import { drawScene } from './ember-knights-draw.js';
import { endMessage } from './ember-knights-text.js';
import { MENU_COLUMNS, menuTarget } from './ember-knights-menu.js';

export { advanceDuelBodies, resolveBodyContact, resolveStrike, weaponPose, STAGE_COUNT };

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
    en: `Duel ${STAGE_COUNT} castle champions in a campaign that teaches guard, parry and guard-breaking, or duel a friend first to two rounds. Champions watch your moves and answer them, so wait for their swing: block or parry it, then punish the recovery. Chained swings cost more stamina and tired swings hit softer, heavy blows break tired guards, and progress is saved with a stage select.`,
    zh: `在${STAGE_COUNT}场城堡决斗中学习举盾、招架与破防，或与好友先赢两回合。冠军会观察并回应你的动作，所以要等它出手：格挡或招架，再抓住收招反击。连续出手更耗体力且疲惫时挥击减弱，重击能破除疲劳防御，进度会保存并可选择关卡。`,
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
    {
      label: { en: 'Stage select: move / start / or tap', zh: '选关：移动 / 开始 / 或点按' },
      keys: 'A D W S / J or Space',
    },
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

const SPARK_LIMIT = 100;
const PLAYER_PROFILE = {
  style: 'player',
  gear: 'sword',
  mass: 80,
  moves: {},
  dmg: 1,
  hp: 100,
  speed: 1,
  lunge: false,
  startStamina: 100,
};
const TIMERS = [
  'stun',
  'flash',
  'parry',
  'parryCooldown',
  'guardBreak',
  'actionLock',
  'chainTimer',
  'guardLatch',
];

function fighter(id, x, face, profile = PLAYER_PROFILE) {
  return {
    id,
    x,
    y: FLOOR,
    w: 24,
    h: 40,
    vx: 0,
    vy: 0,
    mass: profile.mass,
    grounded: true,
    support: 'floor',
    face,
    guardFace: face,
    style: profile.style,
    gear: profile.gear,
    accent: profile.accent ?? null,
    moves: profile.moves,
    dmg: profile.dmg,
    speed: profile.speed,
    lunge: Boolean(profile.lunge),
    maxHealth: profile.hp,
    health: profile.hp,
    stamina: profile.startStamina,
    blocking: false,
    parry: 0,
    parryCooldown: 0,
    guardBreak: 0,
    guardLatch: 0,
    stun: 0,
    attack: null,
    actionLock: 0,
    chain: 0,
    chainTimer: 0,
    blocks: 0,
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
  const { moves, ...rest } = f;
  return {
    ...rest,
    attack: f.attack
      ? {
          ...f.attack,
          previousPose: f.attack.previousPose ? structuredClone(f.attack.previousPose) : null,
        }
      : null,
  };
}

function readControls(input, index) {
  const keys =
    index === 0
      ? {
          left: 'KeyA',
          right: 'KeyD',
          jump: 'KeyW',
          guard: 'KeyS',
          light: ['KeyJ', 'Space'],
          heavy: 'KeyK',
        }
      : {
          left: 'ArrowLeft',
          right: 'ArrowRight',
          jump: 'ArrowUp',
          guard: 'ArrowDown',
          light: ['Comma'],
          heavy: 'Period',
        };
  const guardTap = input.pressed(keys.guard);
  return {
    move: Number(input.held(keys.right)) - Number(input.held(keys.left)),
    jump: input.held(keys.jump),
    jumpPress: input.pressed(keys.jump),
    guard: input.held(keys.guard) || guardTap,
    guardTap,
    // A press that was released before the next update still counts for this tick.
    light: input.held(...keys.light) || input.pressed(...keys.light),
    heavy: input.held(keys.heavy) || input.pressed(keys.heavy),
    thrust: false,
  };
}

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, STAGE_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the duel.
  }
}

export function createGame(env) {
  const solo = env.mode !== 2;
  let phase = 'playing',
    score = 0,
    stage = 1,
    round = 1,
    remaining = 60,
    elapsed = 0,
    roundPause = 0,
    winner = 0,
    parries = 0,
    banner = null,
    sparks = [],
    menu = null,
    fighters = [],
    brain = null,
    unlocked = 1;
  const wins = [0, 0];
  const champion = () => STAGES[stage - 1];

  function startDuel() {
    const latches = fighters.map((f) => ({
      jumpWasDown: f.jumpWasDown,
      guardWasDown: f.guardWasDown,
    }));
    const c = champion();
    fighters = [fighter(0, 130, 1), fighter(1, 350, -1, solo ? c : PLAYER_PROFILE)];
    for (let i = 0; i < latches.length; i++) Object.assign(fighters[i], latches[i]);
    remaining = solo ? c.time : 60;
    brain = solo ? createBrain(c, env.random) : null;
  }
  if (solo && env.progress) unlocked = readUnlocked(env.progress);
  if (unlocked > 1) menu = { cursor: unlocked };
  startDuel();

  function finish(index, draw = false) {
    if (phase !== 'playing') return;
    winner = draw ? 0 : index + 1;
    phase = !draw && index === 0 ? 'won' : 'lost';
    env.sound(phase === 'won' ? 'win' : 'lose');
    const message = endMessage(env, {
      solo,
      draw,
      timedOut: remaining === 0,
      index,
      stage: champion(),
      total: STAGE_COUNT,
    });
    env.end({ won: phase === 'won', score: solo ? score : 0, message });
  }
  function closeRound(index) {
    if (roundPause > 0 || phase !== 'playing') return;
    if (solo) {
      if (index !== 0) return finish(1, index < 0);
      score += 500 + Math.ceil(Math.max(0, remaining)) * 5 + Math.round(fighters[0].health * 3);
      unlocked = Math.max(unlocked, Math.min(STAGE_COUNT, stage + 1));
      if (env.progress) saveUnlocked(env.progress, unlocked);
      if (stage === STAGE_COUNT) return finish(0);
      banner = { kind: 'stage' };
    } else {
      if (index >= 0) wins[index]++;
      if (wins[index] >= 2) return finish(index);
      if (round === RULES.maxRounds) return finish(wins[0] > wins[1] ? 0 : 1, wins[0] === wins[1]);
      banner = index < 0 ? { kind: 'draw' } : { kind: 'round', player: index + 1 };
    }
    roundPause = RULES.roundPause;
    env.sound('win');
  }

  function beginAttack(f, type) {
    if (f.attack || f.actionLock > EPS || f.stun > 0 || f.blocking || f.guardBreak > 0) return;
    const spec = attackSpec(type, f.moves, f.dmg),
      chain = f.chainTimer > 0 ? f.chain : 0,
      cost = spec.cost + chain * RULES.chainCost;
    if (f.stamina < cost) return;
    f.stamina -= cost;
    // A tired swing hits softer: full power needs stamina to spare after the swing is paid for.
    const power =
      RULES.windedPower + (1 - RULES.windedPower) * clamp(f.stamina / RULES.windedAt, 0, 1);
    spec.damage = Math.round(spec.damage * power);
    f.chain = chain + 1;
    f.chainTimer = RULES.chainWindow;
    f.actionLock = spec.startup + spec.active + spec.recovery;
    f.attack = {
      ...spec,
      type,
      power,
      face: f.face,
      age: 0,
      phase: 'windup',
      hit: false,
      previousPose: null,
    };
    env.sound('shoot');
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
    if (sparks.length > SPARK_LIMIT) sparks.splice(0, sparks.length - SPARK_LIMIT);
  }

  function steerFighter(f, other, c, dt) {
    f.previousX = f.x;
    f.previousY = f.y;
    for (const name of TIMERS) f[name] = Math.max(0, f[name] - dt);
    if (f.attack) {
      f.attack.previousPose = f.attack.phase === 'active' ? weaponPose(f) : null;
      f.attack.age += dt;
      f.attack.phase = phaseOf(f.attack);
      if (f.attack.age >= f.attack.startup + f.attack.active + f.attack.recovery) f.attack = null;
    }
    if (!f.attack && !f.guardWasDown) f.face = other.x >= f.x ? 1 : -1;
    const guardEdge = c.guard && !f.guardWasDown;
    if (c.guardTap) f.guardLatch = RULES.guardLatch;
    if (guardEdge && f.stun === 0 && !f.attack && f.guardBreak === 0 && f.stamina >= 12) {
      f.guardFace = f.face;
      if (f.parryCooldown === 0) {
        f.parry = RULES.parryWindow;
        f.parryCooldown = RULES.parryCooldown;
      }
    }
    f.blocking =
      (c.guard || f.guardLatch > 0) &&
      !f.attack &&
      f.stun === 0 &&
      f.guardBreak === 0 &&
      f.stamina > 0 &&
      f.grounded;
    if (f.blocking) f.face = f.guardFace;
    f.stamina = clamp(
      f.stamina +
        (f.blocking
          ? -3
          : !f.attack
            ? RULES.staminaRegen
            : f.attack.phase === 'recovery'
              ? RULES.recoveryRegen
              : 0) *
          dt,
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
    const lunging = f.lunge && f.attack?.type === 'thrust' && f.attack.phase === 'active';
    const speed = f.blocking
      ? 38
      : f.attack
        ? lunging
          ? 135
          : f.attack.phase === 'recovery'
            ? 75
            : 40
        : 105 * f.speed;
    const target = f.stun > 0 ? 0 : c.move * speed,
      acceleration = f.grounded ? (c.move && f.stun === 0 ? 950 : 850) : 380;
    f.vx = approach(f.vx, target, acceleration * dt);
    if (c.heavy) beginAttack(f, 'heavy');
    else if (c.thrust) beginAttack(f, 'thrust');
    else if (c.light) beginAttack(f, 'light');
    f.jumpWasDown = Boolean(c.jump);
    f.guardWasDown = Boolean(c.guard);
  }

  function applyHit(i, result, attack, cancel) {
    const f = fighters[i],
      target = fighters[1 - i];
    attack.hit = true;
    let damage = result.damage,
      knock = result.blocked ? 24 : result.knock;
    if (result.parried) {
      damage = 0;
      f.stun = Math.max(f.stun, RULES.parryStun);
      target.stamina = Math.min(100, target.stamina + 9);
      target.parry = 0;
      knock = 85;
      cancel.add(i);
      target.blocks++;
      parries++;
      if (solo && i === 1) score += 15;
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
        // A blocked swing recoils: the defender gets a clear window to answer.
        f.stun = Math.max(f.stun, attack.type === 'heavy' ? RULES.heavyRecoil : RULES.blockRecoil);
        target.blocks++;
      }
    } else {
      target.stun = Math.max(target.stun, attack.type === 'heavy' ? 0.3 : 0.18);
      if (!resistsInterrupt(target, attack)) cancel.add(1 - i);
    }
    target.health = Math.max(0, target.health - damage);
    target.flash = 0.14;
    const impulse = target.mass * knock;
    f.vx -= (attack.face * impulse) / f.mass;
    target.vx += (attack.face * impulse) / target.mass;
    if (solo && i === 0) score += damage * 5;
    burst(target, result.blocked);
    env.sound('hit');
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
        if (solo) stage++;
        startDuel();
      }
      return;
    }
    remaining = Math.max(0, remaining - dt);
    const commands = [
      readControls(input, 0),
      solo ? brain.control(fighters[1], fighters[0], dt) : readControls(input, 1),
    ];
    for (let i = 0; i < 2; i++) steerFighter(fighters[i], fighters[1 - i], commands[i], dt);
    advanceDuelBodies(fighters, dt);
    // Eligibility is collected before damage, stun or attack cancellation. Equal
    // contact times trade fairly; an earlier impact can still interrupt startup.
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const result = resolveStrike(fighters[i], fighters[1 - i]);
      if (result.hit) hits.push({ i, result, attack: fighters[i].attack });
    }
    const cancel = new Set();
    for (const { i, result, attack } of hits) applyHit(i, result, attack, cancel);
    for (const index of cancel) fighters[index].attack = null;
    const [a, b] = fighters;
    if (a.health <= 0 || b.health <= 0 || remaining === 0)
      closeRound(a.health === b.health ? -1 : a.health > b.health ? 0 : 1);
  }

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    stage = menu.cursor;
    menu = null;
    startDuel();
  }

  function statusText() {
    const c = champion();
    if (menu)
      return {
        en: `Choose a duel · ${menu.cursor}/${STAGE_COUNT} ${STAGES[menu.cursor - 1].name.en}`,
        zh: `选择决斗 · ${menu.cursor}/${STAGE_COUNT} ${STAGES[menu.cursor - 1].name.zh}`,
      };
    if (!solo)
      return {
        en: `Round ${round} · ${wins[0]} : ${wins[1]} · First to 2`,
        zh: `回合 ${round} · ${wins[0]} : ${wins[1]} · 先赢2回合`,
      };
    return {
      en: `${stage}/${STAGE_COUNT} ${c.name.en} · Guard timing and stamina`,
      zh: `${stage}/${STAGE_COUNT} ${c.name.zh} · 把握举盾时机，管理体力`,
    };
  }

  return {
    update(dt, input) {
      if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) {
        menuStep(input);
        return;
      }
      // Whole 1/120 s steps keep 30, 60 and 120 Hz runs identical; a held key sees every step,
      // a fresh press only the first.
      const frame = Math.min(dt, 1 / 30),
        whole = Math.floor(frame / STEP + 1e-9),
        tail = frame - whole * STEP,
        latched = { ...input, pressed: () => false };
      for (let n = 0; n < whole && phase === 'playing'; n++) tick(STEP, n === 0 ? input : latched);
      if (tail > EPS && phase === 'playing') tick(tail, whole === 0 ? input : latched);
    },
    draw(ctx) {
      drawScene(
        ctx,
        {
          phase,
          score: solo ? score : 0,
          stage,
          round,
          remaining,
          elapsed,
          roundPause,
          wins,
          winner,
          banner,
          fighters,
          sparks,
          champion: champion(),
          menu,
          unlocked,
        },
        env,
      );
    },
    getState() {
      const c = champion();
      return {
        phase,
        score: solo ? score : 0,
        stage,
        totalStages: STAGE_COUNT,
        stageId: c.id,
        tier: c.tier,
        unlocked,
        menu: menu
          ? { cursor: menu.cursor, unlocked, total: STAGE_COUNT, columns: MENU_COLUMNS }
          : null,
        round,
        remaining,
        roundPause,
        winner,
        wins: [...wins],
        parries,
        opponent: solo ? c.style : 'player',
        ai: brain ? brain.state() : null,
        fighters: fighters.map(snapshotFighter),
        particles: sparks.length,
        status: statusText(),
      };
    },
  };
}
