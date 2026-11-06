import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES,
  STAGES,
  PADS,
  PROMPTS,
  createGame,
  newState,
  loadStage,
  advance,
  snapshot,
  bestPad,
} from '../src/games/frost-forge.js';
import { harness, input, mockContext, seeded } from './harness.js';

// Human-like policies. They read only what the screen shows (positions, temperature numbers and
// gauges, pad temperatures, printed windows, the prompt) and see it `delay` seconds late. They
// act in macros (hold a key, tap a key) and wait for their own action to finish before looking.
const TILE = RULES.tile,
  TOP = RULES.top,
  STEP = RULES.step;
const KEY = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' };
const TOOL = { off: 0, torch: 1, frost: 2 };

const tileOf = (x, y) => ({ c: Math.floor(x / TILE), r: Math.floor((y - TOP) / TILE) });
const tc = (c) => c * TILE + TILE / 2;
const tr = (r) => TOP + r * TILE + TILE / 2;
const blocked = (s, c, r) => '#E'.includes(s.tiles[r]?.[c] ?? '#');

function route(s, goal) {
  const from = tileOf(s.player.x, s.player.y);
  const to = tileOf(goal.x, goal.y);
  const key = (c, r) => `${c},${r}`;
  const seen = new Map([[key(from.c, from.r), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.c === to.c && cur.r === to.r) {
      const path = [];
      let at = cur;
      while (seen.get(key(at.c, at.r))) {
        path.unshift(at);
        at = seen.get(key(at.c, at.r));
      }
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const n = { c: cur.c + dx, r: cur.r + dy };
      if (blocked(s, n.c, n.r) || seen.has(key(n.c, n.r))) continue;
      seen.set(key(n.c, n.r), cur);
      queue.push(n);
    }
  }
  return null;
}

function groundRows(s) {
  return s.ground.map((row) => row.split(','));
}

// How long to hold a key so that the slide ends at `end` (px along the axis).
function plan(s, axis, sign, end) {
  const rows = groundRows(s);
  let x = s.player.x,
    y = s.player.y,
    v = 0;
  const cls = (px, py) => {
    const t = tileOf(px, py);
    return rows[t.r]?.[t.c] ?? 'dry';
  };
  for (let n = 0; n < 600; n++) {
    const g = RULES.ground[cls(x, y)];
    const pos = axis === 'x' ? x : y;
    const brake = (v * v) / (2 * g.fric);
    if (sign * (end - pos) <= brake + 0.5) return { dur: n * STEP, stop: v / g.fric };
    v = Math.min(RULES.maxSpeed, v + g.accel * STEP);
    if (axis === 'x') x += sign * v * STEP;
    else y += sign * v * STEP;
  }
  return { dur: 600 * STEP, stop: 1 };
}

// Walk toward a goal point; returns an action, or 'arrived'.
function walk(s, goal) {
  const p = s.player;
  if (Math.hypot(goal.x - p.x, goal.y - p.y) <= goal.tol) return 'arrived';
  const path = route(s, goal);
  let axis, sign, end;
  const here = tileOf(p.x, p.y);
  if (!path || !path.length) {
    const ax = Math.abs(goal.x - p.x) >= Math.abs(goal.y - p.y);
    axis = ax ? 'x' : 'y';
    sign = Math.sign(goal[axis] - p[axis]);
    end = goal[axis];
  } else {
    const dx = path[0].c - here.c,
      dy = path[0].r - here.r;
    let i = 0;
    while (path[i + 1] && path[i + 1].c - path[i].c === dx && path[i + 1].r - path[i].r === dy) i++;
    axis = dx ? 'x' : 'y';
    sign = dx || dy;
    const last = path[i];
    const isLast = i === path.length - 1;
    end = axis === 'x' ? tc(last.c) : tr(last.r);
    if (isLast) end = goal[axis];
    // Line up with the lane first when a wall beside it would clip the player's box.
    const cross = axis === 'x' ? 'y' : 'x';
    const lane = axis === 'x' ? tr(here.r) : tc(here.c);
    const off = p[cross] - lane;
    const side = Math.sign(off);
    const pinched = [here, ...path.slice(0, i + 1)].some((q) =>
      axis === 'x' ? blocked(s, q.c, q.r + side) : blocked(s, q.c + side, q.r),
    );
    if (Math.abs(off) > 3 && pinched) {
      axis = cross;
      sign = -side;
      end = lane;
    }
  }
  if (sign === 0 || sign * (end - p[axis]) < 3) {
    // fix the cross axis
    const o = axis === 'x' ? 'y' : 'x';
    const sg = Math.sign(goal[o] - p[o]);
    if (!sg || Math.abs(goal[o] - p[o]) < 3) return 'arrived';
    axis = o;
    sign = sg;
    end = goal[o];
  }
  const { dur, stop } = plan(s, axis, sign, end);
  const dx = axis === 'x' ? sign : 0,
    dy = axis === 'y' ? sign : 0;
  return { hold: KEY[`${dx},${dy}`], dur: Math.max(dur, 0.03), settle: stop + 0.12 };
}

const win = (s, c) => {
  const k = s.sockets.find((q) => q.kind === c.kind);
  return k;
};

function toolPresses(cur, want) {
  return (TOOL[want] - TOOL[cur] + 3) % 3;
}

// Smart, visible-information policy.
const hurt = (p) => p.glove >= RULES.warnHot || p.glove <= RULES.warnCold;
function smart(s) {
  if (s.phase !== 'playing' || s.player.speed > 4) return null;
  const p = s.player;
  const held = s.comps.find((c) => c.held);
  const pending = s.comps.filter((c) => !c.done);
  const off = () => (p.tool !== 'off' ? { presses: toolPresses(p.tool, 'off') } : null);
  if (!pending.length) return { wait: 0.2 };
  if (held) {
    const k = win(s, held);
    if (hurt(p)) return { presses: 1, key: 'Space' }; // the gloves say so: drop it
    const w = k.hi - k.lo;
    if (held.temp >= k.lo && held.temp <= k.hi) {
      const goal = { x: k.x - TILE, y: k.y, tol: 8 };
      const m = walk(s, goal);
      if (m !== 'arrived') return p.tool !== 'off' ? off() : m;
      if (k.ice > 0)
        return p.tool === 'torch' ? { wait: 0.1 } : { presses: toolPresses(p.tool, 'torch') };
      return p.tool !== 'off' ? off() : { press: 'Space' };
    }
    const gap = held.temp < k.lo ? k.lo - held.temp : held.temp - k.hi;
    const need = held.temp < k.lo ? 'torch' : 'frost';
    if (gap <= 45 || !padFor(s, held)) {
      const near = held.temp < k.lo ? held.temp >= k.lo + 0.3 * w : held.temp <= k.hi - 0.3 * w;
      if (near && p.tool !== 'off') return off();
      if (p.tool !== need) return { presses: toolPresses(p.tool, need) };
      return { wait: 0.1 };
    }
    if (p.tool !== 'off') return off();
    const pad = padFor(s, held);
    const m = walk(s, { x: pad.x, y: pad.y, tol: 7 });
    return m === 'arrived' ? { press: 'Space' } : m;
  }
  if (hurt(p)) return { wait: 0.2 };
  const ready = pending.find((c) => c.takeReady);
  const stray = pending.filter((c) => !onGood(s, c) && !c.ready);
  const target = ready || stray.sort((a, b) => dist(a, p) - dist(b, p))[0];
  if (!target) return p.tool !== 'off' ? off() : { wait: 0.15 };
  if (target.temp > 115 || target.temp < -62) {
    // too extreme to carry: condition it with the tool first
    const need = target.temp > 0 ? 'frost' : 'torch';
    const m = walk(s, { x: target.x, y: target.y, tol: 14 });
    if (m !== 'arrived') return m;
    if (p.tool !== need) return { presses: toolPresses(p.tool, need) };
    return { wait: 0.1 };
  }
  if (p.tool !== 'off' && Math.hypot(target.x - p.x, target.y - p.y) > 20) return off();
  const m = walk(s, { x: target.x, y: target.y, tol: 14 });
  if (m !== 'arrived') return m;
  if (p.tool !== 'off') return off();
  return { press: 'Space' };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sameTile = (o, q) => tileOf(o.x, o.y).c === q.c && tileOf(o.x, o.y).r === q.r;
function padFor(s, c) {
  const k = win(s, c);
  const mid = (k.lo + k.hi) / 2;
  const list = s.pads.filter(
    (q) =>
      (c.temp < k.lo ? q.temp >= k.lo : c.temp > k.hi ? q.temp <= k.hi : false) &&
      !s.comps.some((o) => o !== c && !o.held && !o.done && sameTile(o, q)),
  );
  list.sort(
    (a, b) =>
      Math.abs(a.temp - mid) - Math.abs(b.temp - mid) || dist(a, s.player) - dist(b, s.player),
  );
  return list[0];
}
function onGood(s, c) {
  const t = tileOf(c.x, c.y);
  const pad = s.pads.find((q) => q.c === t.c && q.r === t.r);
  if (!pad) return false;
  const k = win(s, c);
  return c.temp < k.lo ? pad.temp >= k.lo : c.temp > k.hi ? pad.temp <= k.hi : true;
}

function crude(s) {
  if (s.phase !== 'playing' || s.player.speed > 4) return null;
  const p = s.player;
  const held = s.comps.find((c) => c.held);
  if (!held) {
    const t = s.comps.filter((c) => !c.done).sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (!t) return { wait: 0.2 };
    const m = walk(s, { x: t.x, y: t.y, tol: 14 });
    return m === 'arrived' ? { press: 'Space' } : m;
  }
  const k = win(s, held);
  const m = walk(s, { x: k.x - TILE, y: k.y, tol: 8 });
  return m === 'arrived' ? { press: 'Space' } : m;
}

// A host stub for the level-based contract: unlocked() is the highest open workshop (1-based) and
// unlock(n) raises it, never lowers it; every call is logged.
const progressStub = (unlocked) => {
  const log = { unlocked, calls: [] };
  return {
    log,
    progress: {
      unlocked: () => log.unlocked,
      unlock: (n) => {
        log.calls.push(n);
        log.unlocked = Math.max(log.unlocked, n);
      },
    },
  };
};
const index = (name) => STAGES.findIndex((st) => st.name.en === name);
const budgetOf = (st) =>
  Math.log((RULES.engineStart - RULES.frost) / (RULES.seize - RULES.frost)) / st.frostRate;

// Plays workshop `workshop` (1-based) from the select screen until it is cleared, the run ends or
// maxSeconds pass. `took` is the playing time of that workshop.
function play({
  hz,
  seed,
  delayRange = [0.15, 0.35],
  maxSeconds = 400,
  lang = 'en',
  pick = smart,
  make,
  onFrame,
  workshop = 1,
  stopAfter = !make,
} = {}) {
  const h = harness({ seed, lang });
  const stub = progressStub(workshop);
  h.env.progress = stub.progress;
  const g = make ? make(h.env) : createGame(h.env);
  const rnd = seeded(seed * 7 + 3);
  const dt = 1 / hz;
  const history = [];
  let act = null,
    busyUntil = 0;
  let delay = delayRange[0] + rnd() * (delayRange[1] - delayRange[0]);
  let jitterAt = 0;
  const prompts = [];
  let began = null;
  let clearedAt = null;
  for (let t = 0; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    if (!s.menu && began === null) began = s.time;
    if (stopAfter && !s.menu && s.stage > workshop) {
      clearedAt = s.time;
      break;
    }
    history.push({ t, s });
    onFrame?.(s);
    if (history.length > 100) history.shift();
    if (!prompts.length || prompts.at(-1).id !== s.prompt.key)
      prompts.push({ id: s.prompt.key, t });
    if (t >= jitterAt) {
      delay = delayRange[0] + rnd() * (delayRange[1] - delayRange[0]);
      jitterAt = t + 1 + rnd() * 2;
    }
    if (act && t >= act.until) act = null;
    if (!act && t >= busyUntil) {
      const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
      if (seen.t >= busyUntil - 1e-9) {
        const c = seen.s.menu ? { press: 'Space' } : pick(seen.s);
        if (c?.hold) {
          act = { keys: [c.hold], taps: [], until: t + c.dur };
          busyUntil = t + c.dur + c.settle;
        } else if (c?.press) {
          act = { keys: [], taps: [[t, c.press]], until: t + dt * 0.5 };
          busyUntil = t + 0.12;
        } else if (c?.presses) {
          const code = c.key || 'KeyX';
          act = {
            keys: [],
            taps: Array.from({ length: c.presses }, (_, i) => [t + i * 0.12, code]),
            until: t + c.presses * 0.12,
          };
          busyUntil = t + c.presses * 0.12 + 0.05;
        } else if (c?.wait) busyUntil = t + c.wait;
        else if (c === null) busyUntil = t + 0.05;
      }
    }
    const pressed = act ? act.taps.filter(([at]) => at <= t + 1e-9).map(([, k]) => k) : [];
    if (act) act.taps = act.taps.filter(([at]) => at > t + 1e-9);
    g.update(dt, input(act?.keys ?? [], pressed));
  }
  const final = g.getState();
  const cleared = clearedAt !== null || final.phase === 'won';
  return { h, g, stub, prompts, cleared, final, took: (clearedAt ?? final.time) - (began ?? 0) };
}

// A prompt-literal human: it acts on the prompt key and the part the prompt names, goes to the pad
// the prompt names (the nearest free one), drops only when the prompt says the gloves hurt, and
// reads temperatures and pad labels off the screen. X is pressed only when the prompt says so.
const PART_NAME = /Gear|Valve|Coil|Piston/;
const PAD_WORD = { furnace: 'F', chiller: 'C', 'warm plate': 'W' };
const bareSpot = (s) =>
  s.tiles
    .flatMap((row, r) =>
      [...row]
        .map((ch, c) => ({ ch, x: c * 24 + 12, y: 28 + r * 24 + 12 }))
        .filter((q) => q.ch === '.'),
    )
    .filter((q) => s.pads.every((p) => Math.hypot(p.x - q.x, p.y - q.y) >= 50))
    .sort((a, b) => dist(a, s.player) - dist(b, s.player))[0];
function goThen(s, goal, press = 'Space') {
  const m = walk(s, goal);
  return m === 'arrived' ? { press } : m;
}
function namedPad(s) {
  const word = Object.keys(PAD_WORD).find((w) => s.prompt.en.includes(w));
  const list = s.pads.filter((p) => p.ch === PAD_WORD[word]);
  const free = list.filter((p) => !s.comps.some((o) => !o.held && !o.done && sameTile(o, p)));
  return (free.length && (!headStraight || list.length > 1) ? free : list).sort(
    (a, b) => dist(a, s.player) - dist(b, s.player),
  )[0];
}
let useTool = true;
// A sloppy reader: walks to the only pad of the named kind even when another part already lies on
// it, and stops anywhere within 15 px of it.
let headStraight = false;
function literal(s) {
  if (s.phase !== 'playing' || s.player.speed > 4) return null;
  const key = s.prompt.key;
  const held = s.comps.find((c) => c.held);
  const named = PART_NAME.exec(s.prompt.en)?.[0]?.toLowerCase();
  const target = s.comps.find((c) => !c.done && !c.held && c.kind === named);
  if (key === 'warnHot' || key === 'warnCold') return { presses: 1, key: 'Space' };
  if (key === 'thaw' && held) {
    const k = s.sockets.find((q) => q.kind === held.kind);
    const m = walk(s, { x: k.x - TILE, y: k.y, tol: 8 });
    if (m !== 'arrived') return m;
    return s.player.tool === 'torch' || !useTool ? { wait: 0.1 } : { presses: 1, key: 'KeyX' };
  }
  if (key === 'install' && held) {
    const k = s.sockets.find((q) => q.kind === held.kind);
    return goThen(s, { x: k.x - TILE, y: k.y, tol: 8 });
  }
  if (held && (key === 'floorHot' || key === 'floorCold' || key === 'padBusy')) {
    const spot = bareSpot(s);
    return goThen(s, { x: spot.x, y: spot.y, tol: 6 });
  }
  if (held && ['tooHot', 'tooCold', 'partHot', 'partCold', 'take', 'bring'].includes(key)) {
    const pad = namedPad(s);
    return pad ? goThen(s, { x: pad.x, y: pad.y, tol: headStraight ? 15 : 7 }) : { wait: 0.1 };
  }
  if (held || !target) return { wait: 0.1 };
  const wanted = key === 'take' ? target.takeReady : ['bring', 'lift'].includes(key);
  return wanted ? goThen(s, { x: target.x, y: target.y, tol: 14 }) : { wait: 0.1 };
}

// ---------------------------------------------------------------------------------------------
// One scripted legal solution per workshop. Tokens: `gear@F` carries the gear to the nearest free
// furnace (F), chiller (C) or warm plate (W) and leaves it there; `gear!` waits until the gear is
// ready to take, takes it, walks to its socket, torches the socket if it is frozen and installs.
// ---------------------------------------------------------------------------------------------
const SOLUTIONS = [
  'gear@F gear!', // 1 Cold Start
  'valve@C valve!', // 2 Chill Out
  'gear@F valve@C gear! valve!', // 3 Hot and Cold
  'gear@F gear!', // 4 Slick Floor
  'gear@F gear!', // 5 Frozen Socket (the torch is part of `!`)
  'coil@W coil!', // 6 Warm Plate
  'gear@F valve@C gear! valve!', // 7 Ice Rink
  'gear@F valve@C gear! valve!', // 8 Ice Hall
  'coil@W gear@F coil! gear!', // 9 Warm Pair
  'valve@C valve!', // 10 Wall Run
  'coil@W valve@C coil! valve!', // 11 Pillar Yard
  'gear@F valve@C coil@W gear! valve! coil!', // 12 Triple Play
  'gear@F valve@C gear! piston@F valve! piston!', // 13 One Furnace: the piston waits its turn
  'gear@F valve@C gear! valve!', // 14 Long Haul
  'coil@W gear@F coil! piston@W gear! piston!', // 15 Plate Share: the piston waits its turn
  'gear@F valve@C coil@W gear! valve! coil!', // 16 Deep Freeze
  'gear@F valve@C coil@W gear! valve! coil!', // 17 Cold Chain
  'gear@F valve@C coil@W piston@F gear! valve! coil! piston!', // 18 Four Square (two furnaces)
  'gear@F valve@C coil@W gear! piston@F valve! coil! piston!', // 19 Juggler
  'gear@F valve@C coil@W gear! piston@F valve! coil! piston!', // 20 Snap Freeze
  'gear@F valve@C coil@W gear! piston@F valve! coil! piston!', // 21 Glacier
  'gear@F valve@C coil@W gear! piston@F valve! coil! piston!', // 22 Master Forge
];

function runScript(workshop, hz = 60) {
  const h = harness({ seed: workshop });
  const stub = progressStub(workshop);
  h.env.progress = stub.progress;
  const g = createGame(h.env);
  const dt = 1 / hz;
  const step = (keys = [], pressed = []) => g.update(dt, input(keys, pressed));
  const state = () => g.getState();
  const wait = (seconds) => {
    for (let i = 0; i < seconds * hz; i++) step();
  };
  const settle = () => {
    for (let n = 0; n < hz * 6 && state().player.speed > 4; n++) step();
  };
  const goTo = (goal) => {
    for (let n = 0; n < 80; n++) {
      const m = walk(state(), goal);
      if (m === 'arrived') return settle();
      for (let i = 0; i < Math.round(m.dur * hz); i++) step([m.hold]);
      settle();
    }
    assert.fail(`stuck on the way to ${JSON.stringify(goal)}`);
  };
  const comp = (kind) => state().comps.find((c) => c.kind === kind);
  if (state().menu) step([], ['Space']);
  assert.equal(state().menu, null);
  assert.equal(state().stage, workshop);
  for (const token of SOLUTIONS[workshop - 1].split(' ')) {
    const [kind, op] = token.split(/(?=[@!])/);
    const before = comp(kind);
    goTo({ x: before.x, y: before.y, tol: 14 });
    if (op[0] === '@') {
      step([], ['Space']);
      assert.ok(comp(kind).held, `${token}: picked up`);
      const taken = (q) => state().comps.some((o) => !o.held && !o.done && sameTile(o, q));
      const pads = state()
        .pads.filter((p) => p.ch === op[1] && !taken(p))
        .sort((a, b) => dist(a, state().player) - dist(b, state().player));
      assert.ok(pads.length, `${token}: a free pad exists`);
      goTo({ ...pads[0], tol: 7 });
      step([], ['Space']);
      assert.ok(!comp(kind).held && sameTile(comp(kind), pads[0]), `${token}: on the pad`);
      continue;
    }
    for (let n = 0; n < 600 && !comp(kind).takeReady; n++) wait(0.1);
    assert.ok(comp(kind).takeReady, `${token}: ready in time`);
    const at = comp(kind);
    goTo({ x: at.x, y: at.y, tol: 14 });
    step([], ['Space']);
    assert.ok(comp(kind).held, `${token}: taken`);
    const k = state().sockets.find((q) => q.kind === kind);
    goTo({ x: k.x - TILE, y: k.y, tol: 8 });
    if (k.ice > 0) {
      step([], ['KeyX']);
      assert.equal(state().player.tool, 'torch');
      for (let n = 0; n < 200 && state().player.tool === 'torch'; n++) wait(0.1);
    }
    step([], ['Space']);
    assert.ok(comp(kind).done, `${token}: installed`);
  }
  for (let n = 0; n < 600 && state().stage === workshop && state().phase === 'playing'; n++)
    wait(0.1);
  return { g, h, stub, final: state() };
}

const HZ = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
// Workshops sampled with 30 runs per rate: the first, an ice-and-socket one, the old three-part
// capstone and the last.
const SAMPLED = [1, 8, 16, 22].map((n) => n - 1);
const rate = (workshop, hz, delayRange, seeds, pick = literal) => {
  let won = 0;
  let slowest = 0;
  let lowest = RULES.hpMax;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = play({
      hz,
      seed,
      delayRange,
      pick,
      workshop,
      maxSeconds: 260,
      onFrame: (s) => {
        lowest = Math.min(lowest, s.hp);
      },
    });
    if (r.cleared) {
      won++;
      slowest = Math.max(slowest, r.took);
    }
  }
  return { won, slowest, lowest };
};

test('quality: every workshop has a scripted legal solution that clears it without a scratch', () => {
  assert.equal(SOLUTIONS.length, STAGES.length);
  STAGES.forEach((st, i) => {
    const r = runScript(i + 1);
    const s = r.final;
    const last = i === STAGES.length - 1;
    assert.equal(s.phase, last ? 'won' : 'playing', st.name.en);
    if (!last) assert.equal(s.stage, i + 2, `${st.name.en} cleared into the next workshop`);
    assert.equal(s.stats.rejects, 0, `${st.name.en}: no refusals`);
    assert.equal(s.stats.burns, 0);
    assert.equal(s.hp, RULES.hpMax);
    assert.equal(s.stats.installs, st.sockets.length);
    assert.equal(s.stats.tools, st.sockets.filter((k) => k.ice > 0).length, 'X only to thaw');
    assert.equal(r.stub.log.unlocked, Math.min(STAGES.length, i + 2), 'the next one is unlocked');
    assert.deepEqual(r.stub.log.calls, last ? [] : [i + 2]);
    assert.equal(r.h.ends.length, last ? 1 : 0);
  });
});

test('quality: scripted solutions hold at 30 and 120 Hz too, and leave a fair slice of the clock', () => {
  for (const hz of [30, 120]) {
    for (const i of [0, 7, 15, 21]) {
      const r = runScript(i + 1, hz);
      assert.equal(r.final.stats.rejects, 0, `${STAGES[i].name.en} at ${hz} Hz`);
      assert.ok(r.final.stage > i + 1 || r.final.phase === 'won');
    }
  }
  STAGES.forEach((st, i) => {
    const used = (() => {
      const r = runScript(i + 1);
      return r.final.time;
    })();
    assert.ok(
      used < budgetOf(st) * 0.7,
      `${st.name.en}: ${used.toFixed(0)} of ${budgetOf(st).toFixed(0)} s`,
    );
  });
});

test('quality: a prompt-literal human with 0.4-0.6 s reactions clears every workshop at every rate', () => {
  const ratios = [];
  STAGES.forEach((st, i) => {
    for (const hz of HZ) {
      const sampled = SAMPLED.includes(i);
      const seeds = sampled ? 30 : 6;
      const r = rate(i + 1, hz, SLOW, seeds);
      assert.ok(r.won >= (sampled ? 24 : 6), `${st.name.en} ${hz} Hz: ${r.won}/${seeds}`);
      assert.equal(r.lowest, RULES.hpMax, 'the prompts keep the hands safe');
      ratios.push(r.slowest / budgetOf(st));
    }
  });
  // The slowest successful run never needs more than 72% of the clock; lone-part workshops far less.
  ratios.forEach((v) => assert.ok(v <= 0.72, `${v}`));
  assert.ok(Math.max(...ratios.slice(0, 6)) <= 0.45, 'the first workshops are generous');
  assert.ok(Math.max(...ratios.slice(-15)) > 0.6, 'the clock tightens towards mastery');
});

test('quality: faster 0.15-0.35 s reactions clear them too, 27 of 30 on the sampled workshops', () => {
  STAGES.forEach((st, i) => {
    for (const hz of HZ) {
      const sampled = SAMPLED.includes(i);
      const seeds = sampled ? 30 : 3;
      const r = rate(i + 1, hz, FAST, seeds);
      assert.ok(r.won >= (sampled ? 27 : 3), `${st.name.en} ${hz} Hz: ${r.won}/${seeds}`);
    }
  });
});

test('quality: a visible-information policy that also conditions parts with the tool clears all of them', () => {
  STAGES.forEach((st, i) => {
    for (const hz of HZ) {
      const r = rate(i + 1, hz, FAST, 2, smart);
      assert.equal(r.won, 2, `${st.name.en} ${hz} Hz`);
    }
  });
});

test('quality: grabbing and installing without heating or cooling cannot clear any workshop', () => {
  STAGES.forEach((st, i) => {
    for (const hz of HZ) {
      const r = play({
        hz,
        seed: 1,
        delayRange: FAST,
        pick: crude,
        workshop: i + 1,
        maxSeconds: 150,
      });
      assert.equal(r.cleared, false, `${st.name.en} ${hz} Hz`);
    }
  });
  const r = play({ hz: 60, seed: 1, delayRange: FAST, pick: crude, workshop: 1 });
  const s = r.g.getState();
  assert.equal(s.stage, 1, 'never gets past the first engine');
  assert.ok(s.stats.rejects >= 3, 'the socket kept refusing the room-temperature part');
  assert.equal(s.cause, 'engine');
});

test('quality: X is a real verb: a prompt follower that never presses it fails every frozen workshop', () => {
  useTool = false;
  const frozen = [];
  try {
    STAGES.forEach((st, i) => {
      const hasIce = st.sockets.some((k) => k.ice > 0);
      for (const hz of HZ) {
        const r = play({
          hz,
          seed: 2,
          delayRange: SLOW,
          pick: literal,
          workshop: i + 1,
          maxSeconds: 200,
        });
        if (hasIce) {
          assert.equal(r.cleared, false, `${st.name.en} ${hz} Hz`);
          assert.equal(r.final.stats.tools, 0);
          assert.equal(r.final.cause, 'engine');
        } else if (hz === 60) assert.equal(r.cleared, true, `${st.name.en} needs no tool`);
      }
      if (hasIce) frozen.push(i + 1);
    });
  } finally {
    useTool = true;
  }
  assert.deepEqual(frozen, [5, 8, 14, 16, 17, 20, 21, 22]);
  const r = play({ hz: 60, seed: 1, delayRange: SLOW, pick: literal, workshop: 5 });
  assert.equal(r.cleared, true);
  assert.equal(r.final.stats.tools, 1, 'one press lit the torch; it shut itself off');
});

test('quality: the whole campaign, played in order, unlocks every workshop and ends in one win', () => {
  const r = play({
    hz: 60,
    seed: 5,
    delayRange: SLOW,
    pick: literal,
    maxSeconds: 3000,
    stopAfter: false,
  });
  const s = r.g.getState();
  assert.equal(s.phase, 'won');
  assert.equal(r.h.ends.length, 1);
  assert.equal(r.h.ends[0].won, true);
  assert.deepEqual(
    r.stub.log.calls,
    Array.from({ length: STAGES.length - 1 }, (_, i) => i + 2),
    'each clear unlocks exactly the next workshop',
  );
  assert.equal(s.hp, RULES.hpMax);
  assert.equal(
    s.stats.installs,
    STAGES.reduce((n, st) => n + st.sockets.length, 0),
  );
  assert.ok(r.h.sounds.filter((n) => n === 'win').length >= STAGES.length);
});

test('quality: coming back later offers the select screen and continues from the unlocked workshop', () => {
  const resume = play({ hz: 60, seed: 3, delayRange: FAST, workshop: 9 });
  assert.equal(resume.cleared, true);
  assert.equal(resume.stub.log.unlocked, 10);
  // Replaying an old workshop never lowers what the host stored.
  const replay = play({ hz: 60, seed: 3, delayRange: FAST, workshop: 4, pick: literal });
  assert.equal(replay.stub.log.unlocked, 5);
  const h = harness({ seed: 1 });
  const stub = progressStub(12);
  h.env.progress = stub.progress;
  const g = createGame(h.env);
  assert.equal(g.getState().menu.cursor, 12);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().stage, 10);
  assert.deepEqual(stub.log.calls, [], 'starting does not touch the stored progress');
});

// A random settled state: parts anywhere on the floor or pads at any temperature the tools can
// reach, random tool mode and glove temperature.
function settledState(index, seed, span = [-90, 180], gloves = true) {
  const rnd = seeded(seed * 31 + index);
  const s = newState();
  loadStage(s, index);
  s.hp = RULES.hpMax;
  const free = [];
  s.grid.forEach((row, r) => row.forEach((ch, c) => '.iFCW'.includes(ch) && free.push([c, r])));
  const spot = () => free[Math.floor(rnd() * free.length)];
  for (const c of s.comps) {
    const [col, row] = spot();
    Object.assign(c, {
      x: col * 24 + 12,
      y: 28 + row * 24 + 12,
      T: span[0] + rnd() * (span[1] - span[0]),
    });
  }
  const [pc, pr] = spot();
  const tool = Math.floor(rnd() * 3);
  Object.assign(s.player, {
    x: pc * 24 + 12,
    y: 28 + pr * 24 + 12,
    tool: gloves ? tool : 0,
    glove: gloves ? -10 + rnd() * 60 : RULES.body,
  });
  return s;
}

function finishFrom(s, seed, keepWarm, pick = smart, delayRange = FAST) {
  const make = (env) => ({
    update(dt, inp) {
      if (keepWarm) s.engine = Math.max(s.engine, RULES.engineStart);
      advance(s, dt, inp, env.sound);
      if ((s.clear > 0 || s.phase !== 'playing') && !env.done) {
        env.done = true;
        env.end({ won: s.phase !== 'lost', score: s.score, message: '' });
      }
    },
    getState: () => snapshot(s),
  });
  play({ hz: 60, seed, delayRange, make, maxSeconds: 400, pick });
  return s.clear > 0 || s.phase === 'won';
}

test('quality: from any settled state a part can always be brought into its window', () => {
  let total = 0;
  for (let index = 0; index < STAGES.length; index++) {
    for (let seed = 1; seed <= 4; seed++) {
      total++;
      assert.ok(
        finishFrom(settledState(index, seed), seed, true),
        `workshop ${index + 1} seed ${seed}`,
      );
    }
  }
  assert.equal(total, STAGES.length * 4);
});

test('quality: even scattered at random extremes, most repairs still beat the engine clock', () => {
  let cleared = 0;
  let total = 0;
  for (let index = 0; index < STAGES.length; index++) {
    for (let seed = 1; seed <= 4; seed++) {
      total++;
      if (finishFrom(settledState(index, seed), seed, false)) cleared++;
    }
  }
  assert.ok(cleared >= total * 0.75, `${cleared}/${total}`);
});

test('quality: a part parked on any pad at its settled extreme is recovered by following the prompts', () => {
  let total = 0;
  STAGES.forEach((st, index) => {
    st.sockets.forEach((k, part) => {
      for (const pad of st.pads) {
        total++;
        const s = newState();
        loadStage(s, index);
        const comp = s.comps[part];
        Object.assign(comp, {
          x: pad[1] * 24 + 12,
          y: 28 + pad[2] * 24 + 12,
          T: PADS[pad[0]].temp,
        });
        Object.assign(s.player, {
          x: pad[1] * 24 + 12,
          y: 28 + (pad[2] + (pad[2] === 1 ? 1 : -1)) * 24 + 12,
        });
        assert.ok(
          finishFrom(s, total, true, literal),
          `${st.name.en}: ${comp.kind} parked on ${pad[0]}`,
        );
        assert.equal(s.hp, RULES.hpMax, 'recovered without losing HP');
      }
    });
  });
  assert.ok(total > 100, `${total} parking cases`);
});

test('quality: no hazard comes without a warning, and an attentive policy never gets hurt', () => {
  for (const [workshop, seed] of [
    [1, 1],
    [8, 2],
    [16, 3],
    [22, 4],
  ]) {
    let lowest = RULES.hpMax;
    const r = play({
      hz: 60,
      seed,
      delayRange: FAST,
      workshop,
      onFrame: (s) => {
        lowest = Math.min(lowest, s.hp);
      },
    });
    assert.equal(r.cleared, true);
    assert.equal(lowest, RULES.hpMax);
  }
});

test('quality: prompts name their keys, hold for 0.5 s and describe the real situation', () => {
  const dwell = [];
  let checked = 0;
  let lastKey = '';
  for (const [workshop, seed] of [
    [1, 1],
    [6, 2],
    [8, 3],
    [13, 4],
    [19, 5],
    [22, 6],
  ]) {
    const { prompts, g } = play({
      hz: 60,
      seed,
      delayRange: FAST,
      workshop,
      onFrame: (s) => {
        const key = s.prompt.key;
        const held = s.comps.find((c) => c.held);
        const pending = s.comps.filter((c) => !c.done);
        checked++;
        if (key !== lastKey) {
          // The moment a prompt appears it describes the real situation.
          if (key === 'install') assert.ok(held?.ready);
          if (key === 'take') assert.ok(pending.some((c) => c.takeReady) && !held);
          if (key === 'tooCold' || key === 'tooHot') assert.ok(held && !held.ready);
          if (key === 'bring' || key === 'wait') assert.ok(!held && pending.length);
          if (key === 'warnHot' || key === 'warnCold') assert.ok(hurt(s.player));
          if (key === 'partHot' || key === 'partCold') assert.ok(held && !hurt(s.player));
          lastKey = key;
        }
        if (!s.menu) {
          assert.match(s.status.en, /seizes in \d+s/, 'the time limit is always displayed');
          assert.match(s.status.zh, /\d+秒后卡死/);
        }
      },
    });
    const end = g.getState().time;
    prompts.forEach((p, n) => dwell.push({ key: p.id, d: (prompts[n + 1]?.t ?? end) - p.t }));
    prompts.forEach((p, n) => {
      const back = prompts[n + 2];
      if (back && back.id === p.id) assert.ok(back.t - p.t > 0.5, `${p.id} flips back`);
    });
  }
  const shown = dwell.filter((e) => !['cleared', 'menu'].includes(e.key));
  const brief = shown.filter((e) => e.d < 0.5).length;
  assert.ok(brief / shown.length <= 0.05, `${brief}/${shown.length} prompts under 0.5 s`);
  assert.ok(checked > 3000);
  for (const key of Object.keys(PROMPTS)) assert.ok(PROMPTS[key][1]);
});

test('quality: a player who never acts loses fairly, with the countdown running from the start', () => {
  for (const hz of HZ) {
    const h = harness({ seed: 3 });
    const g = createGame(h.env);
    const start = g.getState();
    assert.ok(start.engine.eta > 100, 'a long first countdown');
    let damage = false;
    for (let i = 0; i < hz * 300 && !h.ends.length; i++) {
      g.update(1 / hz, input([]));
      damage ||= g.getState().hp < start.hp;
    }
    assert.equal(damage, false, 'no damage without picking anything up');
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.ok(Math.abs(g.getState().time - start.engine.eta) < 0.3);
  }
});

test('quality: actors sit between the HUD bands, are large and distinct, and text is 14-16 px', () => {
  for (const lang of ['en', 'zh']) {
    for (const workshop of [1, 12, 22]) {
      const fonts = [];
      const ctx = new Proxy(mockContext(), {
        set: (t, p, v) => {
          if (p === 'font') fonts.push(Number(/(\d+)px/.exec(v)[1]));
          t[p] = v;
          return true;
        },
        get: (t, p) => (p in t ? t[p] : () => {}),
      });
      let rects = 0;
      const r = play({
        hz: 60,
        seed: 4,
        lang,
        workshop,
        onFrame: (s) => {
          const [, top] = s.hud.top;
          const [bottom] = s.hud.bottom;
          for (const q of [s.player.rect, ...s.comps.map((c) => c.rect)]) {
            rects++;
            assert.ok(q.w >= 16 && q.h >= 16);
            if (!s.comps.some((c) => c.held && c.rect === q))
              assert.ok(q.y >= top && q.y + q.h <= bottom, JSON.stringify(q));
          }
        },
      });
      r.g.draw(ctx);
      assert.ok(rects > 500);
      assert.ok(fonts.length > 5 && Math.min(...fonts) >= 14 && Math.max(...fonts) <= 16, lang);
    }
  }
});

test('quality: every pad shows its temperature and the workshops use all three kinds of pad', () => {
  const kinds = new Set(STAGES.flatMap((st) => st.pads.map(([ch]) => ch)));
  assert.deepEqual([...kinds].sort(), ['C', 'F', 'W']);
  for (const ch of 'FCW') assert.ok(Number.isFinite(PADS[ch].temp) && PADS[ch].k > 0);
  const pads = STAGES.map((st) => st.pads.map(([ch]) => ch).join(''));
  assert.equal(pads[0], 'FC');
  assert.ok(new Set(pads).size >= 5, 'pad sets vary');
  const layouts = new Set(STAGES.map((st) => JSON.stringify([st.pads, st.walls, st.ice])));
  assert.equal(layouts.size, STAGES.length, 'no two workshops share a layout');
});

test('quality: taking the part the instant the "ready" prompt appears still installs on arrival', () => {
  const s = newState();
  Object.assign(s.comps[0], { x: 84, y: 88, T: 12 });
  Object.assign(s.player, { x: 84, y: 100 });
  const idle = input([]);
  while (s.prompt.key !== 'take') advance(s, 1 / 120, idle);
  for (let i = 0; i < 60; i++) advance(s, 1 / 120, idle); // 0.5 s reaction
  advance(s, 1 / 120, input([], ['Space']));
  assert.equal(s.comps[0].held, true);
  while (s.player.x < 368) advance(s, 1 / 120, input(['ArrowRight']));
  while (s.player.y < 156) advance(s, 1 / 120, input(['ArrowDown']));
  for (let i = 0; i < 30; i++) advance(s, 1 / 120, idle);
  advance(s, 1 / 120, input([], ['Space']));
  assert.equal(s.sockets[0].done, true, `arrived at ${s.comps[0].T}`);
  assert.equal(s.stats.rejects, 0);
});

test('quality: a carried part is drawn and simulated with the player, not where it was lifted', () => {
  const s = newState();
  Object.assign(s.comps[0], { x: 84, y: 88, T: 90 });
  Object.assign(s.player, { x: 84, y: 100 });
  advance(s, 1 / 120, input([], ['Space']));
  for (let i = 0; i < 240; i++) advance(s, 1 / 120, input(['ArrowRight']));
  const state = snapshot(s);
  assert.ok(state.player.x > 150);
  assert.equal(state.comps[0].x, state.player.x);
  assert.equal(state.comps[0].y, state.player.y);
  assert.ok(state.comps[0].temp > 80, 'a carried part loses only a few degrees');
});

test('quality: the tool matters: a gear grabbed too hot is refused until frost spray fixes it', () => {
  const s = newState();
  Object.assign(s.comps[0], { T: 118, held: true });
  Object.assign(s.player, { x: 372, y: 160, glove: 30 });
  advance(s, 1 / 120, input([], ['Space']));
  assert.equal(s.sockets[0].done, false);
  assert.equal(s.stats.rejects, 1);
  advance(s, 1 / 120, input([], ['KeyX']));
  assert.equal(snapshot(s).player.tool, 'torch');
  advance(s, 1 / 120, input([], ['KeyX']));
  assert.equal(snapshot(s).player.tool, 'frost');
  for (let i = 0; i < 120 * 5 && s.comps[0].T > 100; i++) advance(s, 1 / 120, input([]));
  advance(s, 1 / 120, input([], ['Space']));
  assert.equal(s.sockets[0].done, true, 'frost spray brings it back into the window');
});

test('quality: taking a part the moment the prompt says so and walking at once still installs it', () => {
  let cases = 0;
  STAGES.forEach((st, index) => {
    st.sockets.forEach((k, part) => {
      for (const reaction of [0, 0.6]) {
        const s = newState();
        loadStage(s, index);
        s.sockets.forEach((q) => (q.ice = 0)); // this test is about carrying, not thawing
        const comp = s.comps[part];
        const pad = snapshot(s).pads.find((p) => p.ch === bestPad(s, comp).ch);
        Object.assign(comp, { x: pad.x, y: pad.y, T: 12 });
        Object.assign(s.player, { x: pad.x, y: pad.y + (pad.r === 1 ? 24 : -24) });
        const idle = input([]);
        for (let i = 0; i < 120 * 60 && !snapshot(s).comps[part].takeReady; i++)
          advance(s, STEP, idle);
        assert.ok(snapshot(s).comps[part].takeReady, 'the part reaches its take band');
        for (let i = 0; i < reaction * 120; i++) advance(s, STEP, idle);
        advance(s, STEP, input([], ['Space']));
        assert.equal(s.comps[part].held, true);
        const goal = { x: k.c * 24 - 12, y: 28 + k.r * 24 + 12, tol: 8 };
        for (let n = 0; n < 60; n++) {
          const m = walk(snapshot(s), goal);
          if (m === 'arrived') break;
          for (let i = 0; i < m.dur * 120; i++) advance(s, STEP, input([m.hold]));
          while (Math.hypot(s.player.vx, s.player.vy) > 4) advance(s, STEP, idle);
        }
        for (let i = 0; i < 60; i++) advance(s, STEP, idle); // 0.5 s to press Space
        advance(s, STEP, input([], ['Space']));
        assert.equal(
          s.sockets[part].done,
          true,
          `${st.name.en} ${k.kind} reaction ${reaction}: T ${s.comps[part].T} at ${s.player.x},${s.player.y}`,
        );
        cases++;
      }
    });
  });
  assert.equal(cases, STAGES.reduce((n, st) => n + st.sockets.length, 0) * 2);
});

test('quality: two similarly distant ready parts never make a 0.5 s reader oscillate', () => {
  const at = (c, r) => ({ x: c * 24 + 12, y: 28 + r * 24 + 12 });
  for (const y of [120, 150, 180]) {
    const s = newState();
    loadStage(s, index('Ice Rink'));
    const [gear, valve] = s.comps;
    Object.assign(gear, { ...at(3, 2), T: 105 });
    Object.assign(valve, { ...at(3, 7), T: -52 });
    Object.assign(s.player, { x: 84, y });
    let flips = 0;
    let last = '';
    const ok = finishFrom(
      s,
      1,
      true,
      (v) => {
        if (v.prompt.id !== last) flips++;
        last = v.prompt.id;
        return literal(v);
      },
      [0.5, 0.5],
    );
    assert.ok(ok, `player at y ${y}`);
    assert.ok(flips <= 12, `${flips} prompt changes`);
  }
});

test('quality: from random settled states a 0.5 s prompt follower finishes almost every time', () => {
  let cleared = 0;
  let total = 0;
  for (let i = 0; i < STAGES.length; i++)
    for (let seed = 1; seed <= 6; seed++) {
      total++;
      if (finishFrom(settledState(i, seed, [-55, 125], false), seed, true, literal, [0.5, 0.5]))
        cleared++;
    }
  assert.ok(cleared >= total * 0.97, `${cleared}/${total}`);
});

test("quality: two parts lying on each other's pads are sorted out by following the prompts", () => {
  const s = newState();
  loadStage(s, index('Hot and Cold'));
  const [gear, valve] = s.comps;
  Object.assign(gear, { x: 3 * 24 + 12, y: 28 + 7 * 24 + 12, T: -30 });
  Object.assign(valve, { x: 3 * 24 + 12, y: 28 + 2 * 24 + 12, T: 60 });
  Object.assign(s.player, { x: 8 * 24 + 12, y: 28 + 5 * 24 + 12 });
  for (let i = 0; i < 100; i++) advance(s, STEP, input([]));
  assert.notEqual(s.prompt.key, 'wait', 'nobody is on a good pad');
  assert.equal(s.prompt.key, 'bring');
  assert.ok(finishFrom(s, 2, true, literal, [0.5, 0.5]));
  assert.equal(s.hp, RULES.hpMax);
});

test('quality: with two strays and nothing ready, a 0.5 s reader never oscillates between them', () => {
  const at = (c, r) => ({ x: c * 24 + 12, y: 28 + r * 24 + 12 });
  const flipsFor = (valveAt, playerAt, seed) => {
    const s = newState();
    loadStage(s, index('One Furnace'));
    const [gear, piston, valve] = s.comps;
    Object.assign(gear, { ...at(3, 7), T: -52 }); // the gear lies on the chiller: a stray
    Object.assign(piston, { ...at(3, 3), T: 99 }); // ready on the furnace
    Object.assign(valve, { ...at(...valveAt), T: 12 });
    Object.assign(s.player, at(...playerAt));
    let flips = 0;
    let last = '';
    const ok = finishFrom(
      s,
      seed,
      false,
      (v) => {
        if (v.prompt.id !== last) flips++;
        last = v.prompt.id;
        return literal(v);
      },
      [0.5, 0.5],
    );
    return { ok, flips };
  };
  let worst = 0;
  [
    [
      [5, 6],
      [10, 5],
    ],
    [
      [7, 7],
      [10, 5],
    ],
    [
      [9, 4],
      [8, 5],
    ],
    [
      [6, 8],
      [11, 6],
    ],
    [
      [11, 7],
      [6, 5],
    ],
  ].forEach(([valveAt, playerAt], i) => {
    const r = flipsFor(valveAt, playerAt, i + 1);
    assert.ok(r.ok, `cleared before the engine seized: valve ${valveAt} player ${playerAt}`);
    worst = Math.max(worst, r.flips);
  });
  assert.ok(worst <= 20, `${worst} prompt changes`);
});

test('quality: a pinned sweep case where two strays used to trade places is cleared at 0.5 and 0.3 s', () => {
  for (const delay of [
    [0.5, 0.5],
    [0.3, 0.3],
  ]) {
    const s = settledState(index('Long Haul'), 60, [12, 12], false);
    assert.ok(finishFrom(s, 20, false, literal, delay), `delay ${delay[0]}`);
  }
});

test('quality: random layouts of strays at room temperature are cleared by a 0.5 s and a 0.3 s reader', () => {
  let cleared = 0;
  let total = 0;
  for (const delay of [
    [0.5, 0.5],
    [0.3, 0.3],
  ])
    STAGES.forEach((st, i) => {
      if (st.sockets.length < 2) return;
      for (let seed = 1; seed <= 3; seed++) {
        total++;
        const s = settledState(i, seed + 40, [12, 12], false);
        if (finishFrom(s, seed, false, literal, delay)) cleared++;
      }
    });
  assert.ok(cleared >= total * 0.97, `${cleared}/${total}`);
});

// Every way of laying the Four Square parts out on its pads (or on the floor): the adjacent
// chiller and warm plate must never swallow each other's parts.
function padPermutations() {
  const base = newState();
  loadStage(base, index('Four Square'));
  const pads = snapshot(base).pads;
  const all = [];
  const rec = (picked, used) => {
    if (picked.length === 4) return all.push(picked);
    for (const o of [...pads.keys(), -1])
      if (o < 0 || !used.has(o)) rec([...picked, o], o < 0 ? used : new Set([...used, o]));
  };
  rec([], new Set());
  return { pads, all };
}

test('quality: adjacent wrong pads never trap a part: the stray-first livelock layout clears', () => {
  const { pads } = padPermutations();
  const at = (p) => ({ x: p.x, y: p.y, T: PADS[p.ch].temp });
  const wp = pads.find((p) => p.ch === 'W');
  const cp = pads.find((p) => p.ch === 'C');
  const fp = pads.find((p) => p.ch === 'F');
  assert.equal(Math.hypot(wp.x - cp.x, wp.y - cp.y), 24, 'the two pads are adjacent');
  const s = newState();
  loadStage(s, index('Four Square'));
  const [gear, valve, coil, piston] = s.comps;
  Object.assign(valve, at(wp)); // the valve lies on the warm plate
  Object.assign(coil, at(cp)); // the coil lies on the chiller
  Object.assign(piston, at(fp));
  Object.assign(gear, { x: 9 * 24 + 12, y: 28 + 4 * 24 + 12, T: 12 });
  Object.assign(s.player, { x: 10 * 24 + 12, y: 28 + 5 * 24 + 12 });
  headStraight = true;
  try {
    assert.ok(finishFrom(s, 3, false, literal, [0.3, 0.3]));
  } finally {
    headStraight = false;
  }
});

test('quality: every layout of the four parts on the pads or the floor is sorted out at 0.3 s', () => {
  const { pads, all } = padPermutations();
  assert.ok(all.length > 150);
  const plain = newState();
  loadStage(plain, index('Four Square'));
  const bare = plain.grid.flatMap((row, r) =>
    [...row].flatMap((ch, c) =>
      ch === '.' &&
      c >= 2 &&
      c <= 14 &&
      pads.every((p) => Math.hypot(p.x - (c * 24 + 12), p.y - (28 + r * 24 + 12)) >= 40)
        ? [{ x: c * 24 + 12, y: 28 + r * 24 + 12 }]
        : [],
    ),
  );
  let cleared = 0;
  const failed = [];
  headStraight = true;
  all.forEach((assign, n) => {
    const s = newState();
    loadStage(s, index('Four Square'));
    s.comps.forEach((c, i) => {
      const p = pads[assign[i]];
      if (p) Object.assign(c, { x: p.x, y: p.y, T: PADS[p.ch].temp });
      else Object.assign(c, { ...bare[(i * 7 + n * 3) % bare.length], T: 12 });
    });
    Object.assign(s.player, { x: 10 * 24 + 12, y: 28 + 5 * 24 + 12 });
    if (finishFrom(s, n + 1, false, literal, [0.3, 0.3])) cleared++;
    else failed.push(assign.join());
  });
  headStraight = false;
  assert.deepEqual(failed, []);
  assert.equal(cleared, all.length);
});
