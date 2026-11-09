import {
  parseMachine,
  evaluate,
  solveMachine,
  startOf,
  nextInTray,
  stepCursor,
  startCursor,
  advise,
  adviceLine,
  PLAIN,
} from './weightworks-engine.js';
import { MACHINE_DEFS } from './weightworks-machines.js';
import { drawGame, hitTest, menuCellAt } from './weightworks-draw.js';

export {
  parseMachine,
  evaluate,
  solveMachine,
  startOf,
  nextInTray,
  stepCursor,
  advise,
  adviceLine,
  costsFrom,
  gateHolds,
} from './weightworks-engine.js';
export { GEO, layoutOf, cellRect, hitTest, menuCellAt } from './weightworks-draw.js';

export const RULES = Object.freeze({
  step: 1 / 120, // fixed simulation step, seconds
  maxDt: 0.1,
  maxTilt: 0.09, // needle angle at full tilt, radians
  tiltFloor: 0.45, // a needle never leans less than this share of full tilt
  tauFull: 12, // torque that tips a beam fully
  spring: 140,
  damping: 12,
  restAngle: 0.004,
  restSpeed: 0.03,
  winHold: 0.6, // all needles at rest this long before a machine is judged solved
  loseGrace: 6, // out of moves and unsolved: this long (at rest) to undo before the run is lost
  clearPause: 1.8,
  historyMax: 400,
  movesMax: 999,
  msgTime: 1.6,
  clearScore: 100,
  extraMovePenalty: 8,
  minMachineScore: 20,
  menuCols: 6,
});
const R = RULES;
const STEP = R.step;

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value))
    Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};
export const MACHINES = deepFreeze(MACHINE_DEFS.map(parseMachine));
export const MACHINE_COUNT = MACHINES.length;

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));
export const meta = {
  id: 'weightworks',
  name: { en: 'Weightworks', zh: '天平工坊' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: `A wooden workshop of balance machines. Each beam has pegs at set distances from its pivot, and a mass pulls with its weight times its distance, so a light mass far out can outweigh a heavy one near the pivot. Place the masses from the tray until every gate lamp is lit at the same time: some beams must hang level, others must tip left or right. Beams can hang from the pegs of other beams and pass on their whole load, some pegs are locked, some masses slide only along their own beam, and tippers drop a mass onto another beam when a beam tips. Most machines allow only a few moves; undo refunds them and a glowing hint names the next one. Balance all ${MACHINE_COUNT} machines; progress is saved.`,
    zh: `一间满是天平机器的木工坊。每根横梁在到支点的固定距离上有若干挂孔，砝码的力矩是质量乘以距离，所以远处的轻砝码可以压过近处的重砝码。把托盘里的砝码挂到孔上，让所有指示灯同时亮起：有的横梁要保持水平，有的要偏向左或右。横梁可以挂在别的横梁的孔上并传递全部重量，有的孔被锁住，有的砝码只能沿自己的横梁滑动，翻斗会在某根横梁倾斜时把砝码扔到另一根横梁上。多数机器只给少量步数，撤销会返还步数，发光提示会告诉你下一步。平衡全部 ${MACHINE_COUNT} 台机器，进度会被保存。`,
  },
  keys: [
    {
      label: { en: 'Move the cursor over pegs and the tray', zh: '在挂孔和托盘上移动光标' },
      keys: 'Arrows / WASD',
    },
    {
      label: { en: 'Place the next mass or pick one up', zh: '挂上下一块砝码或取下砝码' },
      keys: 'Space',
    },
    { label: { en: 'Rotate the tray to the next mass', zh: '转动托盘选择下一块砝码' }, keys: 'X' },
    { label: { en: 'Undo the last move', zh: '撤销上一步' }, keys: 'Z' },
    { label: { en: 'Reset this machine', zh: '重置本机器' }, keys: 'Q' },
    {
      label: {
        en: 'Tap a peg to select it, tap again to place or pick; tap a tray mass to choose it',
        zh: '点一下挂孔选中，再点一下挂上或取下；点托盘里的砝码选择它',
      },
      keys: { en: 'Tap', zh: '点按' },
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['Space', 'Pick/Place', '拿放', 'right'],
    ['KeyX', 'Tray', '托盘', 'right'],
    ['KeyZ', 'Undo', '撤销', 'right'],
    ['KeyQ', 'Reset', '重置', 'right'],
  ]),
};

// --- Game state -------------------------------------------------------------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isNaN(n) ? 1 : clamp(n, 1, MACHINE_COUNT);
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}

const movesLeftOf = (s) => (s.mach.budget === null ? Infinity : s.mach.budget - s.moves);
const say = (s, en, zh) => {
  s.msg = { en, zh, time: R.msgTime };
};

const needleTarget = (tau) =>
  Math.sign(tau) *
  R.maxTilt *
  (R.tiltFloor + (1 - R.tiltFloor) * Math.min(1, Math.abs(tau) / R.tauFull));

function recompute(s) {
  s.ev = evaluate(s.mach, s.where);
  s.rest = 0;
  s.grace = 0;
  s.resolved = false;
  s.atRest = s.mach.beams.map(() => false);
  s.lamps = s.lamps.map((on, i) => on && s.ev.ok[i]);
  refresh(s);
}

// Seconds left to undo once every move is spent and the machine is still unsolved, else null.
function graceLeftOf(s) {
  const spent =
    !s.menu && !s.cleared && s.phase === 'playing' && !s.ev.solved && movesLeftOf(s) <= 0;
  return spent ? Math.max(0, R.loseGrace - s.grace) : null;
}

function refresh(s) {
  s.graceLeft = graceLeftOf(s);
  let adv = { kind: 'none' };
  let words;
  if (s.menu) words = PLAIN.menu;
  else if (s.phase === 'won') words = PLAIN.won;
  else if (s.phase === 'lost') words = PLAIN.lost;
  else if (s.cleared) words = PLAIN.cleared;
  else {
    adv = advise(s.mach, s.where, s.sel, s.cur, movesLeftOf(s), s.history.length > 0);
    words = adviceLine(adv);
  }
  s.line = { en: words[0], zh: words[1] };
  s.hint = {
    kind: adv.kind,
    row: adv.row ?? null,
    col: adv.col ?? null,
    beam: adv.beam ?? null,
    pos: adv.pos ?? null,
    dir: adv.dir ?? null,
    steps: adv.steps ?? 0,
    weight: adv.weight ?? null,
    mass: adv.mass ?? null,
    presses: adv.presses ?? 0,
    key: adv.key ?? (adv.kind === 'undo' ? 'KeyZ' : null),
  };
}

function loadMachine(s, index) {
  s.index = index;
  s.mach = MACHINES[index];
  s.where = startOf(s.mach);
  s.sel = nextInTray(s.where, -1);
  s.cur = startCursor(s.mach);
  s.moves = 0;
  s.history = [];
  s.cleared = false;
  s.clearT = 0;
  s.msg = null;
  s.ev = evaluate(s.mach, s.where);
  s.needles = s.ev.tau.map((t) => ({ a: needleTarget(t), w: 0 }));
  s.atRest = s.mach.beams.map(() => true);
  s.lamps = s.ev.ok.map(Boolean);
  s.rest = 0;
  s.grace = 0;
  s.resolved = false;
  refresh(s);
}

function newState(env) {
  const s = {
    phase: 'playing',
    score: 0,
    menu: null,
    ended: false,
    restarts: 0,
    undos: 0,
    sparks: [],
    clock: 0,
    acc: 0,
    progress: env.progress || null,
  };
  const unlocked = s.progress ? readUnlocked(s.progress) : 1;
  loadMachine(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    refresh(s);
  }
  return s;
}

function finish(s, env, won, message) {
  if (s.ended) return;
  s.ended = true;
  env.end({ won, score: s.score, message });
}

function clearMachine(s, env) {
  const extra = Math.max(0, s.moves - solveMachine(s.mach).optimal);
  s.score += Math.max(R.minMachineScore, R.clearScore - R.extraMovePenalty * extra);
  saveUnlocked(s.progress, Math.min(MACHINE_COUNT, s.index + 2));
  s.cleared = true;
  env.sound('win');
  if (s.index + 1 >= MACHINE_COUNT) {
    s.phase = 'won';
    finish(
      s,
      env,
      true,
      env.t('Every machine is balanced. The workshop is yours!', '全部机器已平衡，工坊归你了！'),
    );
  }
  refresh(s);
}

function loseRun(s, env) {
  s.phase = 'lost';
  env.sound('lose');
  finish(
    s,
    env,
    false,
    env.t(
      `Out of moves on machine ${s.index + 1}. Try it again.`,
      `第 ${s.index + 1} 台机器的步数用完了，再试一次。`,
    ),
  );
  refresh(s);
}

function spark(s, x, y, color) {
  for (let i = 0; i < 6 && s.sparks.length < 80; i++) {
    const a = (i / 6) * Math.PI * 2;
    s.sparks.push({ x, y, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, life: 0.4, color });
  }
}

// --- Simulation -----------------------------------------------------------------------------------
function stepNeedles(s, env) {
  s.mach.beams.forEach((b, i) => {
    const n = s.needles[i];
    const target = needleTarget(s.ev.tau[i]);
    n.w += (R.spring * (target - n.a) - R.damping * n.w) * STEP;
    n.a += n.w * STEP;
    s.atRest[i] = Math.abs(n.a - target) < R.restAngle && Math.abs(n.w) < R.restSpeed;
    const lit = s.ev.ok[i] && s.atRest[i];
    if (lit && !s.lamps[i]) {
      env.sound('coin');
      spark(s, 458, 50 + i * 60, '#6dfcaa');
    }
    s.lamps[i] = lit;
  });
}

function stepSim(s, env) {
  s.clock += STEP;
  s.sparks = s.sparks
    .map((p) => ({ ...p, x: p.x + p.vx * STEP, y: p.y + p.vy * STEP, life: p.life - STEP }))
    .filter((p) => p.life > 0);
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  if (s.cleared) {
    s.clearT += STEP;
    if (s.phase === 'playing' && s.clearT >= R.clearPause) loadMachine(s, s.index + 1);
    return;
  }
  stepNeedles(s, env);
  s.rest = s.atRest.every(Boolean) ? s.rest + STEP : 0;
  if (s.ev.solved) {
    if (!s.resolved && s.rest >= R.winHold) {
      s.resolved = true;
      clearMachine(s, env);
    }
    return;
  }
  if (movesLeftOf(s) > 0) return;
  if (s.rest > 0) s.grace += STEP;
  s.graceLeft = graceLeftOf(s);
  if (s.grace >= R.loseGrace) loseRun(s, env);
}

// --- Player actions -----------------------------------------------------------------------------
const WHY = {
  fixed: ['A fixed mass is bolted here', '这里固定着一块砝码'],
  locked: ['This peg is locked', '这个孔被锁住了'],
  hook: ['A beam hangs from this peg', '有一根横梁挂在这个孔上'],
  target: ['A tipper drops its mass here', '翻斗会把砝码扔到这里'],
};

function deny(s, env, en, zh) {
  say(s, en, zh);
  env.sound('hit');
}

function commit(s, env, where, sel) {
  s.history.push({ where: s.where, sel: s.sel, moves: s.moves, cur: s.cur });
  if (s.history.length > R.historyMax) s.history.shift();
  s.where = where;
  s.sel = sel;
  s.moves = Math.min(R.movesMax, s.moves + 1);
  env.sound('move');
  recompute(s);
}

function actOnPeg(s, env) {
  const b = s.mach.beams[s.cur.row];
  const id = b.slots[s.cur.col];
  const held = s.where.indexOf(id);
  if (!s.mach.usable[id] && held < 0) {
    const [en, zh] = WHY[s.mach.why[id]];
    return deny(s, env, en, zh);
  }
  if (movesLeftOf(s) <= 0)
    return deny(s, env, 'No moves left: undo with Z', '没有剩余步数：按 Z 撤销');
  if (held >= 0) {
    const where = s.where.map((slot, w) => (w === held ? -1 : slot));
    return commit(s, env, where, held);
  }
  if (s.sel < 0) return deny(s, env, 'The tray is empty', '托盘是空的');
  const { rail } = s.mach.weights[s.sel];
  if (rail >= 0 && rail !== b.index)
    return deny(
      s,
      env,
      `This mass slides only on beam ${'ABC'[rail]}`,
      `这块砝码只能在 ${'ABC'[rail]} 梁上滑动`,
    );
  const where = s.where.map((slot, w) => (w === s.sel ? id : slot));
  return commit(s, env, where, nextInTray(where, s.sel));
}

function selectMass(s, env, w) {
  if (s.where[w] >= 0)
    return deny(s, env, 'That mass is already on a beam', '这块砝码已经挂在横梁上了');
  s.sel = w;
  env.sound('move');
  return refresh(s);
}

function act(s, env) {
  if (s.cur.row === s.mach.beams.length) return selectMass(s, env, s.cur.col);
  return actOnPeg(s, env);
}

function rotateTray(s, env) {
  if (s.sel < 0) return deny(s, env, 'The tray is empty', '托盘是空的');
  const next = nextInTray(s.where, s.sel);
  if (next === s.sel) return undefined;
  s.sel = next;
  env.sound('move');
  return refresh(s);
}

function undoMove(s, env) {
  const last = s.history.pop();
  if (!last) {
    say(s, 'Nothing to undo', '没有可撤销的操作');
    return;
  }
  s.where = last.where;
  s.sel = last.sel;
  s.moves = last.moves;
  s.cur = last.cur;
  s.undos++;
  env.sound('move');
  recompute(s);
}

function restartMachine(s, env) {
  const { index } = s;
  const restarts = s.restarts + 1;
  const undos = s.undos;
  loadMachine(s, index);
  s.restarts = restarts;
  s.undos = undos;
  say(s, 'Machine reset', '机器已重置');
  env.sound('move');
}

function moveCursor(s, env, input) {
  const dx =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const dy =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  if ((dx === 0) === (dy === 0)) return; // idle, opposite keys or a diagonal press
  const dir = dx !== 0 ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
  const cur = stepCursor(s.mach, s.cur, dir, s.sel);
  if (cur === s.cur || (cur.row === s.cur.row && cur.col === s.cur.col)) return;
  s.cur = cur;
  env.sound('move');
  refresh(s);
}

function tap(s, env, p) {
  const hit = hitTest(s.mach, p.x, p.y);
  if (!hit) return;
  const nb = s.mach.beams.length;
  if (hit.row === nb) return selectMass(s, env, hit.col);
  if (hit.row === s.cur.row && hit.col === s.cur.col) return act(s, env);
  s.cur = { ...hit, mem: s.mach.beams[hit.row].pegs[hit.col] };
  env.sound('move');
  return refresh(s);
}

function playInput(s, env, input) {
  const p = input.pointer;
  if (p?.clicked) tap(s, env, p);
  moveCursor(s, env, input);
  if (input.pressed('KeyQ')) return restartMachine(s, env);
  if (input.pressed('KeyZ')) undoMove(s, env);
  if (input.pressed('Space')) act(s, env);
  if (input.pressed('KeyX')) rotateTray(s, env);
  return undefined;
}

function menuInput(s, env, input) {
  const m = s.menu;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  const sel = clamp(m.sel + step + row * R.menuCols, 1, m.unlocked);
  if (sel !== m.sel) env.sound('move');
  m.sel = sel;
  let go = false;
  const p = input.pointer;
  if (p?.clicked) {
    const hit = menuCellAt(p.x, p.y, MACHINE_COUNT);
    if (hit >= 1 && hit <= m.unlocked) {
      go = hit === m.sel;
      m.sel = hit;
    }
  }
  if (go || input.pressed('Space', 'Enter')) {
    loadMachine(s, m.sel - 1);
    s.menu = null;
    refresh(s);
    env.sound('move');
  }
}

function frameInput(s, env, input) {
  if (s.menu) return menuInput(s, env, input);
  if (s.cleared) {
    if (input.pressed('Space', 'Enter') && s.phase === 'playing') loadMachine(s, s.index + 1);
    return undefined;
  }
  return playInput(s, env, input);
}

// --- Snapshot -----------------------------------------------------------------------------------
function statusFor(s) {
  if (s.menu) return { en: s.line.en, zh: s.line.zh };
  const lamps = s.lamps.filter(Boolean).length;
  const budget = s.mach.budget === null ? '' : `/${s.mach.budget}`;
  const n = s.mach.beams.length;
  return {
    en: `Machine ${s.index + 1}/${MACHINE_COUNT} · Moves ${s.moves}${budget} · Gates ${lamps}/${n} · ${s.line.en}`,
    zh: `第 ${s.index + 1}/${MACHINE_COUNT} 台 · 步数 ${s.moves}${budget} · 指示灯 ${lamps}/${n} · ${s.line.zh}`,
  };
}

function boardOf(s) {
  return s.mach.beams.map((b) =>
    b.pegs
      .map((_, col) => {
        const id = b.slots[col];
        const w = s.where.indexOf(id);
        if (w >= 0) return String(s.mach.weights[w].m);
        return s.mach.usable[id] ? '.' : '#';
      })
      .join(' '),
  );
}

function snapshot(s) {
  const m = s.mach;
  return {
    phase: s.phase,
    score: s.score,
    level: s.index + 1,
    levelCount: MACHINE_COUNT,
    name: { ...m.name },
    tip: { ...m.tip },
    board: boardOf(s),
    beams: m.beams.map((b, i) => ({
      label: b.label,
      gate: b.gate,
      pegs: [...b.pegs],
      tau: s.ev.tau[i],
      mass: s.ev.mass[i],
      tilt: s.ev.tilt[i],
      ok: s.ev.ok[i],
      lamp: s.lamps[i],
      angle: s.needles[i].a,
    })),
    weights: m.weights.map((w, i) => ({ mass: w.m, rail: w.rail, where: s.where[i] })),
    sel: s.sel,
    cursor: { row: s.cur.row, col: s.cur.col },
    moves: s.moves,
    budget: m.budget,
    movesLeft: m.budget === null ? null : m.budget - s.moves,
    optimal: solveMachine(m).optimal,
    solved: s.ev.solved,
    cleared: s.cleared,
    resting: s.atRest.every(Boolean),
    graceLeft: s.graceLeft,
    undos: s.undos,
    restarts: s.restarts,
    menu: s.menu ? { ...s.menu } : null,
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    line: { ...s.line },
    prompt: { en: s.line.en, zh: s.line.zh, id: s.hint.kind },
    hint: { ...s.hint },
    status: statusFor(s),
  };
}

// --- Game ---------------------------------------------------------------------------------------
export function createGame(env) {
  const s = newState(env);
  const lang = env.lang === 'zh' ? 'zh' : 'en';
  return {
    update(dt, input) {
      if (!Number.isFinite(dt) || dt <= 0 || s.phase !== 'playing') return;
      frameInput(s, env, input);
      s.acc += Math.min(dt, R.maxDt);
      while (s.acc >= STEP - 1e-9 && s.phase === 'playing') {
        s.acc -= STEP;
        if (!s.menu) stepSim(s, env);
      }
    },
    draw(ctx) {
      drawGame(ctx, s, lang, MACHINE_COUNT);
    },
    getState() {
      return snapshot(s);
    },
  };
}
