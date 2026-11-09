// The champion's brain. It sees the player through a reaction delay, so quick blows land before it
// can answer. It reads stamina to know when the player can swing again, defends what it sees
// coming, ripostes a block or parry at once and only attacks when the player cannot punish it.
import { phaseOf } from './ember-knights-physics.js';
import { RULES, attackSpec } from './ember-knights-stages.js';

const MEMORY = 1;
const PRESSURE_WINDOW = 1.6;
const GUARD_RANGE = 130;
const GUARD_LEAD = 0.25;
const GUARD_LATE = 0.45;
const GUARD_HOLD_LIMIT = 0.9;
const QUICK_STARTUP = 0.18;
const PARRY_LEAD = 0.07;
const PARRY_HOLD = 0.3;
const PARRY_FELT = 0.6;
const STANCE = 0.8;
const SAFE_ARMOR = 0.2;
const SAFE_POISE = 2;
const SAFETY = 0.05;
const BLIND_MARGIN = 0.05;
const PATIENCE = [1, 2.6];
const PUNISH_MARGIN = 0.03;
const PUNISH_RANGE = 62;
const REACH_PAD = 38;
const ANSWER_WINDOW = 0.3;
const STUN_JUMP = 0.2;
const WEIGHT = { light: 1, thrust: 2, heavy: 3 };
const IDLE = { t: -1, attack: null, blocking: false, stun: 0, guardBreak: 0, stamina: 100 };

function summarize(f, t) {
  const a = f.attack;
  return {
    t,
    attack: a && {
      type: a.type,
      phase: phaseOf(a),
      age: a.age,
      startup: a.startup,
      active: a.active,
      total: a.startup + a.active + a.recovery,
      length: a.length,
    },
    blocking: f.blocking,
    stun: f.stun,
    guardBreak: f.guardBreak,
    stamina: f.stamina,
  };
}

export function createBrain(stage, random) {
  const moves = stage.moves;
  const memory = [];
  let t = 0,
    clock = 0.8,
    index = 0,
    plan = null,
    previous = null,
    stance = 0,
    starts = [],
    chainCount = 0,
    pending = null,
    guarded = -1,
    blocks = 0,
    punished = true,
    restedAt = 0,
    patience = PATIENCE[0],
    mode = 'approach';

  const setPlan = (next) => {
    if (next.kind === 'strike') rest();
    plan = next;
    mode = next.kind;
  };
  const rest = () => {
    restedAt = t;
    patience = PATIENCE[0] + random() * (PATIENCE[1] - PATIENCE[0]);
  };
  const jitter = () => (random() - 0.5) * 0.04;
  const seenNow = () => {
    let seen = IDLE;
    for (const entry of memory) if (entry.t <= t - stage.reaction) seen = entry;
    return seen;
  };
  const total = (type) => {
    const m = attackSpec(type, moves);
    return m.startup + m.active + m.recovery;
  };
  const armored = (type) => moves[type].armorAt <= SAFE_ARMOR && moves[type].poise >= SAFE_POISE;

  /** Seconds until the player can start another quick swing, from what the player shows. */
  function readyIn(view, lag) {
    const a = view.attack,
      busy = Math.max(a ? a.total - a.age - lag : 0, view.stun - lag, view.guardBreak - lag, 0),
      last = starts[starts.length - 1],
      stamina = Math.min(100, view.stamina + (a ? RULES.recoveryRegen * busy : 0));
    const wait = (cost) => busy + Math.max(0, (cost - stamina) / RULES.staminaRegen);
    const chained = last && t + wait(RULES.quickCost) - last.t < RULES.chainWindow ? chainCount : 0,
      cost = RULES.quickCost + RULES.chainCost * chained;
    return wait(cost);
  }

  /** Picks a defence for a blow it saw; slow heavy blows are parried whenever the delay allows. */
  function pickDefense(a) {
    const options = stage.defense.filter(
      (name) => name !== 'counter' || (armored('heavy') && WEIGHT[a.type] <= moves.heavy.poise),
    );
    const parryable = a.startup - stage.reaction >= PARRY_LEAD && options.includes('parry');
    if (a.type === 'heavy' && parryable) return 'parry';
    return options[Math.floor(random() * options.length)] ?? 'guard';
  }

  /** Answers a blow it saw coming; returns whether it chose a defence. */
  function defend({ start, a }, dist) {
    const hitAt = start + a.startup,
      endAt = hitAt + a.active;
    if (dist > a.length + REACH_PAD || random() >= stage.react) return false;
    const choice = pickDefense(a);
    if (choice === 'counter') {
      setPlan({ kind: 'strike', at: t, type: 'heavy' });
    } else if (choice === 'retreat') {
      setPlan({ kind: 'retreat', until: Math.max(t + 0.25, hitAt + 0.1) });
    } else if (choice === 'parry') {
      setPlan({ kind: 'parry', at: Math.max(t, hitAt - PARRY_LEAD + jitter()) });
    } else {
      setPlan({ kind: 'guard', until: Math.max(t + 0.35, endAt + 0.15) });
    }
    stance = t + STANCE;
    return true;
  }

  /** While the player keeps swinging, guards or parries where the next swing will land. */
  function anticipate(seen, dist) {
    const last = starts[starts.length - 1];
    if (!last || t - last.t > PRESSURE_WINDOW || dist > GUARD_RANGE) return;
    const wait = readyIn(seen, t - seen.t),
      hitAt = t + wait + QUICK_STARTUP;
    if (wait > GUARD_LEAD + QUICK_STARTUP || last.t === guarded) return;
    guarded = last.t;
    if (random() >= stage.rhythm) return;
    const choice = stage.defense[Math.floor(random() * stage.defense.length)];
    if (choice === 'parry')
      setPlan({ kind: 'parry', at: Math.max(t, hitAt - PARRY_LEAD + jitter()) });
    else setPlan({ kind: 'guard', until: Math.min(hitAt + GUARD_LATE, t + GUARD_HOLD_LIMIT) });
    stance = t + STANCE;
  }

  function watch(seen) {
    const a = seen.attack,
      was = previous;
    previous = seen;
    // A fresh stun or broken guard is a new opening to answer.
    if (was && (seen.stun > was.stun + STUN_JUMP || seen.guardBreak > was.guardBreak + STUN_JUMP))
      punished = false;
    if (!a || (was?.attack && a.age >= was.attack.age)) return;
    const start = seen.t - a.age,
      last = starts[starts.length - 1];
    chainCount = last && start - last.t < RULES.chainWindow ? chainCount + 1 : 1;
    starts = [...starts, { t: start, startup: a.startup, total: a.total }].slice(-3);
    pending = { start, a };
    punished = false;
    rest();
  }

  function react(seen, dist) {
    if (pending && t - pending.start > pending.a.startup + pending.a.active + ANSWER_WINDOW)
      pending = null;
    if (pending) {
      const answered = pending;
      pending = null;
      if (defend(answered, dist)) return;
    }
    anticipate(seen, dist);
  }

  /** True when the player cannot answer a move of this type before it finishes. */
  function safe(type, readyWait) {
    return armored(type) || total(type) + SAFETY <= readyWait + QUICK_STARTUP;
  }

  function punish(seen, dist) {
    if (punished) return;
    const lag = t - seen.t,
      a = seen.attack;
    let left = 0;
    if (a?.phase === 'recovery') left = a.total - a.age - lag;
    else if (seen.stun > 0 || seen.guardBreak > 0)
      left = Math.max(seen.stun, seen.guardBreak) - lag;
    if (left <= 0 || dist > PUNISH_RANGE) return;
    punished = true;
    if (random() >= stage.punish) return;
    const heavy = left >= attackSpec('heavy', moves).startup + PUNISH_MARGIN,
      light = left >= attackSpec('light', moves).startup + PUNISH_MARGIN;
    if (heavy || light) setPlan({ kind: 'strike', at: t, type: heavy ? 'heavy' : 'light' });
  }

  /** A parry or block is felt at once, so the answer does not wait out the reaction delay. */
  function riposte(me, foe, dist) {
    const parried = plan?.kind === 'parry' && foe.stun > PARRY_FELT,
      blocked = me.blocks > blocks;
    blocks = me.blocks;
    if (!parried && !blocked) return;
    plan = null;
    punished = true;
    if (dist > PUNISH_RANGE || random() >= stage.punish) return;
    const view = summarize(foe, t),
      busy = Math.max(foe.stun, view.attack ? view.attack.total - view.attack.age : 0),
      open = parried ? foe.stun : busy,
      wait = readyIn(view, 0);
    for (const type of ['heavy', 'light']) {
      const move = attackSpec(type, moves);
      if (move.startup + PUNISH_MARGIN <= open && (parried || safe(type, wait))) {
        setPlan({ kind: 'strike', at: t, type });
        stance = 0;
        return;
      }
    }
  }

  function offense(seen, dist) {
    if (clock > 0 || t < stance) return;
    const action = stage.pattern[index++ % stage.pattern.length];
    clock = stage.pace + random() * 0.15;
    if (action === 'guard') return setPlan({ kind: 'guard', until: t + 0.9 });
    if (action === 'feint') return setPlan({ kind: 'retreat', until: t + 0.45 });
    const lag = t - seen.t,
      wait = readyIn(seen, lag),
      last = starts[starts.length - 1],
      pressured = last && t - last.t < PRESSURE_WINDOW;
    // An armed player nearby may already have started a swing the champion cannot yet see.
    const blind = dist <= GUARD_RANGE && wait <= lag + BLIND_MARGIN && t - restedAt < patience;
    const exposed = (pressured || blind) && !safe(action, wait);
    if (dist >= stage.preferred + 20 || exposed) {
      index--;
      clock = exposed ? 0.12 : 0.15;
      return;
    }
    const type = seen.blocking && action === 'light' ? 'heavy' : action;
    setPlan({ kind: 'strike', at: t, type });
  }

  function movement(me, foe, dist) {
    const toward = Math.sign(foe.x - me.x) || 1;
    if (plan?.kind === 'retreat') return -toward;
    if (plan?.kind === 'guard' || plan?.kind === 'parry') return 0;
    if (stage.lunge && me.attack?.phase === 'recovery') return -toward;
    if (stage.kite && dist < stage.preferred - 18) return -toward;
    return dist > stage.preferred ? toward : 0;
  }

  function planControls(me) {
    const out = { guard: false, light: false, heavy: false, thrust: false };
    if (!plan) return out;
    if (plan.kind === 'guard') out.guard = t < plan.until && me.stamina > 0;
    else if (plan.kind === 'parry') {
      if (t >= plan.at) {
        plan.until ||= t + PARRY_HOLD;
        out.guard = t < plan.until;
      }
    } else if (plan.kind === 'strike') out[plan.type] = true;
    return out;
  }

  function expire(me) {
    if (!plan) return;
    const done =
      (plan.kind === 'strike' && (me.attack || t > plan.at + 0.1)) ||
      ((plan.kind === 'guard' || plan.kind === 'retreat') && t >= plan.until) ||
      (plan.kind === 'parry' && plan.until && t >= plan.until);
    if (done) {
      plan = null;
      mode = 'approach';
    }
  }

  return {
    control(me, foe, dt) {
      t += dt;
      clock = Math.max(0, clock - dt);
      memory.push(summarize(foe, t));
      while (memory.length && memory[0].t < t - MEMORY) memory.shift();
      const free = !me.attack && me.actionLock <= 1e-7 && me.stun <= 0 && me.guardBreak <= 0,
        dist = Math.abs(foe.x - me.x),
        seen = seenNow();
      expire(me);
      riposte(me, foe, dist);
      watch(seen);
      if (free && (!plan || plan.kind === 'guard')) react(seen, dist);
      if (free && !plan) {
        punish(seen, dist);
        if (!plan) offense(seen, dist);
      }
      const out = planControls(me);
      return { ...out, move: movement(me, foe, dist), jump: false, jumpPress: false };
    },
    state: () => ({ mode, clock, index, plan: plan ? plan.kind : null }),
  };
}
