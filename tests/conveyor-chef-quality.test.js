import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  SHIFTS,
  KINDS,
  PROMPTS,
  createGame,
  menuCell,
} from '../src/games/conveyor-chef.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Human-like policies. They see only what the screen shows (the map, belts, items, stations and
// their bars, the junction arrows, the ticket rail, the drawn prompt and its marker) and see it
// `delay` seconds late. They act in macros (walk a planned route, tap a key) and dead-reckon: they
// do not look again until their own macro has finished, and they never repeat the same key on the
// same marker within a cooldown, because the prompt may still show for a moment after they act.
// ---------------------------------------------------------------------------------------------
const TILE = RULES.tile;
const TOP = RULES.top;
const HZ = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const WALKABLE = '.><^vJ';
const ARROW = { right: 'ArrowRight', left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp' };
const WASD = { right: 'KeyD', left: 'KeyA', down: 'KeyS', up: 'KeyW' };
const KEYSETS = {
  solo: { move: ARROW, act: 'Space', route: 'KeyX' },
  p1: { move: WASD, act: 'KeyF', route: 'KeyG' },
  p2: { move: ARROW, act: 'Comma', route: 'Period' },
};
const CODE = {
  drop: 'act',
  chop: 'act',
  clear: 'act',
  pull: 'act',
  reroute: 'route',
  preset: 'route',
};

const tc = (c) => c * TILE + TILE / 2;
const tr = (r) => TOP + r * TILE + TILE / 2;
const tileOf = (x, y) => ({ c: Math.floor(x / TILE), r: Math.floor((y - TOP) / TILE) });
const walkable = (s, c, r) => WALKABLE.includes(s.tiles[r]?.[c] ?? '#');
const dist2 = (a, b) => Math.hypot(tc(a.c) - tc(b.c), tr(a.r) - tr(b.r));

function bfs(s, from, goal) {
  const key = (c, r) => `${c},${r}`;
  const prev = new Map([[key(from.c, from.r), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (goal(cur)) {
      const path = [];
      for (let at = cur; prev.get(key(at.c, at.r)); at = prev.get(key(at.c, at.r)))
        path.unshift(at);
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const next = { c: cur.c + dx, r: cur.r + dy };
      if (!walkable(s, next.c, next.r) || prev.has(key(next.c, next.r))) continue;
      prev.set(key(next.c, next.r), cur);
      queue.push(next);
    }
  }
  return null;
}

// Walking segments [{dir, dur}] to a spot within `near` px of the target where the target is the
// strictly nearest thing of its kind (what Space or X would act on). [] when already there.
function walkTo(s, chef, target, near = 34.5) {
  const here = { c: target.c, r: target.r };
  if (Math.hypot(chef.x - tc(here.c), chef.y - tr(here.r)) <= near - 3) {
    const rival = rivalsOf(s, target).some(
      (q) =>
        Math.hypot(chef.x - tc(q.c), chef.y - tr(q.r)) <=
        Math.hypot(chef.x - tc(here.c), chef.y - tr(here.r)) + 1e-6,
    );
    if (!rival) return [];
  }
  const rivals = rivalsOf(s, target);
  const path = bfs(s, tileOf(chef.x, chef.y), (n) => {
    const d = dist2(n, here);
    return d <= near - 3 && !rivals.some((q) => dist2(n, q) <= d + 1e-6);
  });
  if (!path) return null;
  const segs = [];
  let x = chef.x;
  let y = chef.y;
  for (const p of path) {
    for (const axis of ['x', 'y']) {
      const goal = axis === 'x' ? tc(p.c) : tr(p.r);
      const delta = goal - (axis === 'x' ? x : y);
      if (Math.abs(delta) < 0.5) continue;
      const dir = axis === 'x' ? (delta > 0 ? 'right' : 'left') : delta > 0 ? 'down' : 'up';
      const last = segs.at(-1);
      if (last && last.dir === dir) last.dist += Math.abs(delta);
      else segs.push({ dir, dist: Math.abs(delta) });
      if (axis === 'x') x = goal;
      else y = goal;
    }
  }
  return segs.map((sg) => ({ dir: sg.dir, dur: sg.dist / RULES.chefSpeed }));
}
function rivalsOf(s, target) {
  const onTarget = s.junctions.some((j) => j.c === target.c && j.r === target.r);
  const list = onTarget
    ? s.junctions
    : s.stations.filter((q) => ['crate', 'chopper', 'stove'].includes(q.kind));
  return list.filter((q) => q.c !== target.c || q.r !== target.r);
}

function follower({ cooldown = 1.3 } = {}) {
  const last = new Map();
  return function pick(s, t, who = 0) {
    if (s.menu) return { press: 'act' };
    const p = s.prompt;
    if (!p.target) return { wait: 0.1 };
    const segs = walkTo(s, s.chefs[who], p.target);
    if (segs === null) return { wait: 0.2 };
    if (segs.length) return { walk: segs };
    const kind = CODE[p.key];
    if (!kind) return { wait: 0.1 };
    const id = `${p.key}:${p.target.c},${p.target.r}`;
    if (last.has(id) && t - last.get(id) < cooldown) return { wait: 0.1 };
    last.set(id, t);
    return { press: kind };
  };
}

// In co-op the chefs split the work: one feeds and steers, the other chops and cooks.
const onlyFor = (keys, pick) => (s, t, who) =>
  s.menu || keys.includes(s.prompt.key) ? pick(s, t, who) : { wait: 0.1 };
const FEEDER = ['drop', 'preset', 'reroute'];
const COOK = ['chop', 'clear', 'stay', 'cook', 'pull'];

// Plays one shift (1-based) from the select screen until it is cleared (the next shift is shown),
// the run ends, or maxSeconds pass. `pickers` drives one chef each (index = chef).
function play({
  level,
  hz = 60,
  seed = 1,
  delayRange = FAST,
  maxSeconds = 400,
  mode = 1,
  lang = 'en',
  pickers = [follower()],
  keysets = mode === 2 ? [KEYSETS.p1, KEYSETS.p2] : [KEYSETS.solo],
  stopAtClear = true,
  unlocked = level,
  onFrame,
  make,
} = {}) {
  const h = harness({ seed, mode, lang });
  const log = { unlocked, calls: [] };
  h.env.progress = {
    unlocked: () => log.unlocked,
    unlock: (n) => {
      log.calls.push(n);
      log.unlocked = Math.max(log.unlocked, n);
    },
  };
  const g = make ? make(h.env) : createGame(h.env);
  for (let i = unlocked; i > level; i--) g.update(1 / 60, input([], ['ArrowLeft']));
  const rnd = seeded(seed * 7 + 3);
  const dt = 1 / hz;
  const history = [];
  const drivers = pickers.map(() => ({ act: null, busy: 0, delay: delayRange[0], jitterAt: 0 }));
  let clearedAt = null;
  for (let t = 0; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    if (stopAtClear && !s.menu && s.shift > level) {
      clearedAt = s.time;
      break;
    }
    history.push({ t, s });
    if (history.length > 400) history.shift();
    onFrame?.(s, t, g);
    const held = [];
    const pressed = [];
    pickers.forEach((pick, who) => {
      const d = drivers[who];
      const keys = keysets[who];
      if (t >= d.jitterAt) {
        d.delay = delayRange[0] + rnd() * (delayRange[1] - delayRange[0]);
        d.jitterAt = t + 1 + rnd() * 2;
      }
      if (d.act && t >= d.act.until) d.act = null;
      if (!d.act && t >= d.busy) {
        const seen = [...history].reverse().find((e) => e.t <= t - d.delay) || history[0];
        if (seen.t >= d.busy - 1e-9) {
          const c = pick(seen.s, t, who);
          if (c.walk) {
            let at = t;
            const segs = c.walk.map((sg) => {
              const o = { key: keys.move[sg.dir], from: at, dur: sg.dur };
              at += sg.dur;
              return o;
            });
            d.act = { segs, until: at, taps: [] };
            d.busy = at + 0.05;
          } else if (c.press) {
            d.act = { segs: [], taps: [keys[c.press]], until: t + dt * 0.5 };
            d.busy = t + 0.15;
          } else d.busy = t + (c.wait || 0.1);
        }
      }
      if (d.act) {
        const seg = d.act.segs.find(
          (sg) => t >= sg.from - 1e-9 && t < sg.from + Math.max(sg.dur, dt * 0.5) - 1e-9,
        );
        if (seg) held.push(seg.key);
        pressed.push(...d.act.taps);
        d.act.taps = [];
      }
    });
    g.update(dt, input(held, pressed));
  }
  const final = g.getState();
  const cleared = clearedAt !== null || final.phase === 'won';
  return { h, g, log, cleared, final, took: clearedAt ?? final.time };
}

const rate = (level, hz, delayRange, seeds, extra = {}) => {
  let won = 0;
  let lowest = 100;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = play({ level, hz, seed, delayRange, ...extra });
    if (r.cleared) {
      won++;
      lowest = Math.min(lowest, r.final.satisfaction);
    }
  }
  return { won, lowest };
};

// ---------------------------------------------------------------------------------------------
// One scripted legal solution per shift, played through public input only. Tokens:
//   drop@c,r  walk to the crate at tile (c,r), wait until it has reloaded, press Space
//   flip@c,r  walk to the junction and press X
//   chop@c,r  wait for a dish on the board, press Space, stay until it has been chopped
//   pull@c,r  wait until the dish on the stove is ready (green), press Space
//   wait@s    stand still for s seconds
// ---------------------------------------------------------------------------------------------
const SOLUTIONS = [
  'wait@3.0 drop@3,3 wait@10.0 drop@3,3 wait@12.2 drop@3,3 wait@8.8', // 1 First Plate
  'wait@3.0 drop@3,6 wait@6.0 drop@3,2 wait@9.8 drop@3,6 wait@8.6 drop@3,2 wait@9.8', // 2 Right Crate
  'wait@3.0 drop@3,4 wait@1.8 chop@8,4 wait@6.0 drop@3,4 wait@1.8 chop@8,4 wait@7.6 drop@3,4 wait@1.8 chop@8,4 wait@6.2', // 3 Chop Chop
  'wait@3.0 drop@3,4 wait@4.8 pull@8,4 wait@6.6 drop@3,4 wait@4.8 pull@8,4 wait@8.2 drop@3,4 wait@4.8 pull@8,4 wait@6.2', // 4 Sizzle
  'wait@3.0 drop@3,6 wait@6.2 pull@8,3 drop@3,6 wait@6.2 pull@8,3 drop@3,6 wait@6.4 pull@8,3 drop@3,6 wait@6.2 pull@8,3 wait@6.2', // 5 Mind the Pan
  'wait@3.0 drop@3,2 wait@5.0 flip@9,4 drop@3,6 wait@7.2 pull@9,6 flip@9,4 drop@3,2 wait@3.2 flip@9,4 drop@3,6 wait@6.4 drop@3,6 pull@9,6 wait@5.4 pull@9,6 wait@6.8', // 6 Fork in the Belt
  'wait@3.0 drop@3,2 wait@5.0 flip@9,4 drop@3,6 wait@4.2 chop@9,2 drop@3,6 wait@4.4 chop@9,2 flip@9,4 drop@3,2 wait@3.6 flip@9,4 drop@3,6 wait@4.2 chop@9,2 wait@6.8', // 7 Board Branch
  'wait@3.0 drop@3,4 wait@1.8 chop@8,4 wait@3.8 pull@11,4 wait@4.6 drop@3,4 wait@1.8 chop@8,4 wait@3.8 pull@11,4 wait@5.4 drop@3,4 wait@1.8 chop@8,4 wait@3.8 pull@11,4 wait@4.8', // 8 Surf Line
  'wait@3.0 drop@3,2 wait@3.4 flip@9,4 drop@3,6 wait@6.4 drop@3,6 pull@9,6 wait@1.6 flip@9,4 drop@3,2 pull@9,6 wait@8.0 drop@3,2 wait@3.2 flip@9,4 drop@3,6 wait@7.4 pull@9,6 wait@6.8', // 9 Sandwich
  'wait@3.0 flip@10,4 drop@3,4 wait@4.8 pull@8,4 drop@3,4 wait@4.8 pull@8,4 wait@2.0 drop@3,4 wait@4.8 pull@8,4 wait@2.0 drop@3,4 wait@4.8 pull@8,4 wait@6.2', // 10 The Bin
  'wait@3.0 flip@9,4 drop@3,6 wait@2.6 chop@9,2 flip@9,4 drop@3,2 wait@2.0 flip@9,4 drop@3,6 wait@2.0 flip@9,4 chop@9,2 drop@3,2 wait@2.0 flip@9,4 drop@3,6 wait@0.8 drop@3,6 wait@1.0 chop@9,2 chop@9,2 wait@5.2', // 11 Express Lane
  'wait@3.0 flip@9,4 drop@3,6 wait@5.0 flip@9,4 pull@9,6 drop@3,2 wait@3.4 flip@9,4 drop@3,6 wait@3.4 flip@9,4 wait@1.6 pull@9,6 drop@3,2 wait@3.4 flip@9,4 drop@3,6 wait@1.8 drop@3,6 wait@4.6 pull@9,6 wait@2.8 pull@9,6 wait@6.8', // 12 Rush Hour
  'wait@3.0 flip@9,4 drop@3,2 wait@3.4 flip@9,4 chop@11,6 drop@3,6 wait@3.4 flip@9,4 wait@1.6 pull@11,4 drop@3,2 wait@3.4 flip@9,4 chop@11,6 drop@3,6 wait@0.8 drop@3,6 wait@5.6 pull@11,4 wait@2.8 pull@11,4 flip@9,4 drop@3,2 wait@5.2 chop@11,6 wait@5.8', // 13 Two Lines
  'wait@3.0 drop@3,2 wait@5.0 flip@9,4 drop@2,4 wait@3.8 chop@9,2 wait@1.8 flip@9,4 flip@12,4 drop@3,6 wait@4.8 flip@9,4 wait@1.6 pull@12,6 flip@12,4 drop@2,4 wait@3.0 flip@9,4 chop@9,2 drop@3,2 wait@4.8 flip@12,4 drop@3,6 wait@8.8 pull@12,6 wait@5.2', // 14 Full Kitchen
  'wait@3.0 drop@3,4 wait@1.8 flip@8,4 chop@10,4 drop@3,2 wait@0.2 pull@12,4 wait@8.4 flip@8,4 drop@3,4 wait@1.8 flip@8,4 chop@10,4 drop@3,2 wait@0.8 pull@12,4 wait@8.4 flip@8,4 drop@3,4 wait@1.8 flip@8,4 chop@10,4 drop@3,2 wait@0.8 pull@12,4 wait@9.0', // 15 Surf and Sandwich
  'wait@3.0 drop@3,2 drop@3,6 wait@5.4 pull@10,4 wait@2.8 pull@10,4 wait@8.2 drop@3,2 drop@3,6 wait@5.4 pull@10,4 wait@2.8 pull@10,4 wait@8.0 drop@3,2 drop@3,6 wait@5.4 pull@10,4 wait@2.8 pull@10,4 wait@5.2', // 16 Breakfast
  'wait@3.0 flip@9,4 drop@3,6 wait@6.4 pull@9,6 wait@1.0 flip@9,4 drop@3,2 wait@7.8 flip@9,4 drop@3,6 wait@6.2 pull@9,6 flip@9,4 drop@3,2 wait@6.8 flip@9,4 drop@3,6 wait@6.2 pull@9,6 wait@12.2', // 17 Long Haul
  'wait@3.0 drop@3,2 wait@3.4 flip@9,4 drop@2,4 drop@2,4 wait@2.6 chop@9,2 chop@9,2 wait@1.8 flip@9,4 flip@12,4 drop@3,6 drop@3,6 wait@7.6 pull@12,6 wait@2.8 pull@12,6 wait@5.2', // 18 Crowd Control
  'wait@3.0 flip@9,4 drop@3,6 wait@3.4 flip@9,4 wait@2.6 pull@11,6 drop@3,2 wait@3.2 drop@3,2 wait@0.2 chop@11,4 chop@11,4 flip@9,4 drop@3,6 drop@3,6 wait@3.4 flip@9,4 wait@1.4 pull@11,6 wait@2.8 pull@11,6 drop@3,2 wait@4.2 chop@11,4 wait@4.8', // 19 Board and Pan
  'wait@3.0 drop@3,2 wait@3.4 flip@9,4 drop@2,4 wait@3.8 chop@9,2 wait@1.8 flip@9,4 flip@12,4 drop@3,6 drop@3,6 wait@7.6 pull@12,6 wait@2.8 pull@12,6 flip@12,4 drop@3,2 wait@3.2 flip@9,4 drop@2,4 drop@2,4 wait@2.6 chop@9,2 chop@9,2 flip@9,4 drop@3,2 wait@4.8 flip@12,4 drop@3,6 wait@8.8 pull@12,6 wait@5.2', // 20 Feast
  'wait@3.0 flip@12,4 flip@9,4 drop@2,4 wait@3.8 chop@9,2 wait@5.8 pull@12,6 drop@2,4 wait@3.8 chop@9,2 wait@1.8 flip@9,4 flip@12,4 wait@1.6 pull@12,6 drop@3,2 wait@4.8 flip@12,4 drop@3,6 wait@3.4 flip@9,4 wait@3.0 pull@12,6 drop@2,4 drop@2,4 wait@2.6 chop@9,2 chop@9,2 wait@3.4 pull@12,6 wait@2.8 pull@12,6 flip@12,4 flip@9,4 drop@3,2 wait@9.8', // 21 Master Fish
  'wait@3.0 flip@12,4 flip@9,4 drop@2,4 wait@3.8 chop@9,2 flip@9,4 drop@3,6 wait@2.2 pull@12,6 flip@12,4 wait@2.8 pull@12,6 flip@9,4 drop@3,2 wait@4.4 chop@9,2 wait@1.8 flip@9,4 flip@12,4 drop@3,6 wait@3.2 flip@9,4 drop@2,4 wait@0.8 pull@12,6 chop@9,2 drop@2,4 wait@3.2 pull@12,6 chop@9,2 flip@9,4 drop@3,6 wait@2.2 pull@12,6 flip@12,4 wait@2.8 pull@12,6 flip@9,4 drop@3,2 drop@3,2 wait@3.0 chop@9,2 chop@9,2 wait@6.8', // 22 Grand Service
];

function scriptRunner(level, hz = 60) {
  const h = harness({ seed: level });
  const log = { unlocked: level, calls: [] };
  h.env.progress = {
    unlocked: () => log.unlocked,
    unlock: (n) => {
      log.calls.push(n);
      log.unlocked = Math.max(log.unlocked, n);
    },
  };
  const g = createGame(h.env);
  const dt = 1 / hz;
  const state = () => g.getState();
  const run = { g, h, log, cleared: state(), state };
  const step = (keys = [], pressed = []) => {
    g.update(dt, input(keys, pressed));
    if (state().shift === level && !state().menu) run.cleared = state();
  };
  const idle = (seconds) => {
    for (let i = 0; i < Math.round(seconds * hz); i++) step();
  };
  const goTo = (target) => {
    for (let n = 0; n < 40; n++) {
      const segs = walkTo(state(), state().chefs[0], target);
      assert.ok(segs, `a way to ${JSON.stringify(target)}`);
      if (!segs.length) return;
      for (const sg of segs)
        for (let i = 0; i < Math.round(sg.dur * hz); i++) step([ARROW[sg.dir]]);
    }
    assert.fail(`stuck on the way to ${JSON.stringify(target)}`);
  };
  const waitFor = (cond, what, limit = 40) => {
    for (let n = 0; n < limit * 10 && !cond(); n++) idle(0.1);
    assert.ok(cond(), `waited for ${what}`);
  };
  const at = (c, r) => state().stations.find((q) => q.c === c && q.r === r);
  if (state().menu) step([], ['Space']);
  assert.equal(state().shift, level);
  run.exec = (token) => {
    const [op, where] = token.split('@');
    if (op === 'wait') return idle(Number(where));
    const [c, r] = where.split(',').map(Number);
    goTo({ c, r });
    if (op === 'drop') {
      const before = state().stats.drops;
      const kind = at(c, r).item;
      // Only send what a ticket still asks for and nothing is already on its way to.
      const wanted = () => {
        const s = state();
        const asked = s.orders
          .filter((o) => o.state === 'open')
          .flatMap((o) => o.parts)
          .filter((p) => !p.done && p.kind === kind).length;
        const onWay =
          s.items.filter((it) => it.kind === kind).length +
          s.stations.filter((q) => q.holding?.kind === kind).length;
        return asked > onWay;
      };
      waitFor(() => !at(c, r).reload && wanted(), `${token}: a ticket asking for it`);
      step([], ['Space']);
      assert.equal(state().stats.drops, before + 1, `${token}: one item on the belt`);
    } else if (op === 'flip') {
      const before = state().stats.reroutes;
      // Switch only when every dish upstream has gone past, so nothing is sent the wrong way.
      const upstream = (it) =>
        it.x < tc(c) - 2 || (Math.abs(it.x - tc(c)) <= 2 && Math.abs(it.y - tr(r)) <= 2);
      waitFor(() => !state().items.some(upstream), `${token}: the belt before it is clear`);
      step([], ['KeyX']);
      assert.equal(state().stats.reroutes, before + 1, token);
    } else if (op === 'chop') {
      waitFor(() => at(c, r).holding && at(c, r).mode === 'idle', `${token}: a dish on the board`);
      step([], ['Space']);
      assert.equal(at(c, r).mode, 'chopping', token);
      waitFor(() => at(c, r).mode !== 'chopping', `${token}: chopped`, 10);
    } else {
      const before = state().stats.pulls;
      waitFor(() => at(c, r).holding?.heat === 1, `${token}: ready`);
      step([], ['Space']);
      assert.equal(state().stats.pulls, before + 1, token);
    }
    idle(0.8); // the prompt line catches up before the next look
  };
  run.finish = () =>
    waitFor(() => state().shift > level || state().phase !== 'playing', 'the shift to finish', 60);
  run.idle = idle;
  return run;
}

function runScript(level, hz = 60) {
  const run = scriptRunner(level, hz);
  for (const token of SOLUTIONS[level - 1].split(' ')) run.exec(token);
  run.finish();
  return { ...run, final: run.state() };
}

// ---------------------------------------------------------------------------------------------
// Crude policies: no eyes at all.
// ---------------------------------------------------------------------------------------------
const MOVES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const every = (t, dt, period) => Math.floor(t / period) !== Math.floor((t - dt) / period);
const spam = (t, dt) => (every(t, dt, 0.12) ? [Math.floor(t / 0.12) % 2 ? 'Space' : 'KeyX'] : []);
const CRUDE = {
  random: (rnd) => {
    let held = [];
    let until = 0;
    return (t) => {
      if (t >= until) {
        until = t + 0.1 + rnd() * 0.3;
        held = rnd() < 0.2 ? [] : [MOVES[Math.floor(rnd() * 4)]];
        if (rnd() < 0.4) held.push(MOVES[Math.floor(rnd() * 4)]);
      }
      return { held, pressed: [rnd() < 0.08 && 'Space', rnd() < 0.05 && 'KeyX'].filter(Boolean) };
    };
  },
  'mash both': () => (t) => ({ held: [], pressed: Math.floor(t * 10) % 2 ? ['Space'] : ['KeyX'] }),
  'mash Space': () => (t, dt) => ({ held: [], pressed: every(t, dt, 0.12) ? ['Space'] : [] }),
  'hold left + spam': () => (t, dt) => ({ held: ['ArrowLeft'], pressed: spam(t, dt) }),
  'hold right + spam': () => (t, dt) => ({ held: ['ArrowRight'], pressed: spam(t, dt) }),
  'hold up + spam': () => (t, dt) => ({ held: ['ArrowUp'], pressed: spam(t, dt) }),
  'hold down + spam': () => (t, dt) => ({ held: ['ArrowDown'], pressed: spam(t, dt) }),
  'blind stop-and-go pulse': (rnd) => {
    const move = 0.2 + rnd() * 0.6;
    const rest = 0.1 + rnd() * 0.3;
    const tail = 0.1 + rnd() * 0.3;
    const order = [0, 1, 2, 3].sort(() => rnd() - 0.5);
    const period = move + rest + tail;
    return (t, dt) => {
      const k = Math.floor(t / period);
      const phase = t - k * period;
      const crossed = (edge) => phase - dt < edge && phase >= edge;
      return {
        held: phase < move ? [MOVES[order[k % 4]]] : [],
        pressed: [
          crossed(move + rest) && 'Space',
          crossed(move + rest + tail * 0.5) && 'KeyX',
        ].filter(Boolean),
      };
    };
  },
};

// A blind, map-aware tour: it knows where every crate, board, stove and junction is, walks to each
// in turn and taps Space (X at junctions, sometimes X beside the stations too), without ever
// looking at tickets, dishes or prompts.
const tour = ({ dwell, withX = false, shuffle = false }) => {
  return (rnd) => {
    let targets = null;
    let i = 0;
    let dwelling = 0;
    let since = 0;
    let cached = { key: '', path: null };
    return (t, dt, s) => {
      targets ??= [
        ...s.stations.filter((q) => ['crate', 'chopper', 'stove'].includes(q.kind)),
        ...s.junctions.map((j) => ({ ...j, kind: 'junction' })),
      ];
      if (shuffle && i === 0 && dwelling === 0 && t === 0) targets.sort(() => rnd() - 0.5);
      const goal = targets[i % targets.length];
      const me = s.chefs[0];
      if (Math.hypot(me.x - tc(goal.c), me.y - tr(goal.r)) <= 30) {
        since += dt;
        dwelling += dt;
        const pressed = [];
        if (since >= 0.3) {
          since = 0;
          pressed.push(goal.kind === 'junction' ? 'KeyX' : 'Space');
          if (withX && goal.kind !== 'junction' && rnd() < 0.3) pressed.push('KeyX');
        }
        if (dwelling >= dwell) {
          dwelling = 0;
          i++;
        }
        return { held: [], pressed };
      }
      const here = tileOf(me.x, me.y);
      const key = `${here.c},${here.r}>${goal.c},${goal.r}`;
      if (cached.key !== key) cached = { key, path: bfs(s, here, (n) => dist2(n, goal) <= 28) };
      const path = cached.path;
      if (!path) {
        i++;
        return { held: [], pressed: [] };
      }
      const next = path[0] ?? tileOf(me.x, me.y);
      const dx = tc(next.c) - me.x;
      const dy = tr(next.r) - me.y;
      const held =
        Math.abs(dx) > 2
          ? [dx > 0 ? 'ArrowRight' : 'ArrowLeft']
          : Math.abs(dy) > 2
            ? [dy > 0 ? 'ArrowDown' : 'ArrowUp']
            : [];
      return { held, pressed: [] };
    };
  };
};
const TOURS = {
  'tour 1.5 s': tour({ dwell: 1.5 }),
  'tour 3 s + X': tour({ dwell: 3, withX: true }),
  'tour 6 s shuffled': tour({ dwell: 6, withX: true, shuffle: true }),
  'tour 0.8 s shuffled': tour({ dwell: 0.8, withX: true, shuffle: true }),
};
Object.assign(CRUDE, TOURS);

function playCrude(level, name, seed, hz = 60) {
  const h = harness({ seed });
  h.env.progress = { unlocked: () => level, unlock() {} };
  const g = createGame(h.env);
  const dt = 1 / hz;
  const policy = CRUDE[name](seeded(seed * 13 + 5));
  if (g.getState().menu) g.update(dt, input([], ['Space']));
  for (let t = 0; t < 400 && h.ends.length === 0; t += dt) {
    if (g.getState().shift > level) return true;
    const { held, pressed } = policy(t, dt, name in TOURS ? g.getState() : null);
    g.update(dt, input(held, pressed));
  }
  return g.getState().phase === 'won';
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------------------------
function recorder() {
  const texts = [];
  const rects = [];
  let font = '';
  let align = 'left';
  let fill = '';
  const ctx = new Proxy(mockContext(), {
    get: (t, p) =>
      p === 'fillText'
        ? (text, x, y) => texts.push({ text: String(text), x, y, font, align })
        : p === 'fillRect'
          ? (x, y, w, h) => rects.push({ x, y, w, h, fill })
          : p in t
            ? t[p]
            : () => {},
    set: (t, p, v) => {
      if (p === 'font') font = v;
      if (p === 'textAlign') align = v;
      if (p === 'fillStyle') fill = v;
      t[p] = v;
      return true;
    },
  });
  return { ctx, texts, rects };
}
const size = (q) => Number(/(\d+)px/.exec(q.font)[1]);
const CJK = /[⺀-鿿＀-￯]/;
// A conservative width: 0.6 em per Latin character, one em per Chinese character.
const widthOf = (q) => [...q.text].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.6) * size(q), 0);
function box(q) {
  const w = widthOf(q);
  const x0 = q.align === 'center' ? q.x - w / 2 : q.align === 'right' ? q.x - w : q.x;
  return { x0, x1: x0 + w, y0: q.y, y1: q.y + size(q) };
}
const meets = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const FIRST_IDEA = [
  ['drop'],
  ['drop'],
  ['chop'],
  ['pull'],
  ['pull'],
  ['reroute', 'preset'],
  ['chop', 'reroute', 'preset'],
  ['chop', 'pull'],
  ['pull', 'reroute', 'preset'],
  ['preset', 'reroute'],
  ['chop', 'preset'],
  ['pull', 'preset'],
  ['chop', 'pull', 'preset'],
  ['chop', 'pull', 'preset'],
  ['chop', 'pull', 'preset'],
  ['pull'],
  ['pull'],
  ['chop', 'pull'],
  ['chop', 'pull', 'preset'],
  ['chop', 'pull'],
  ['chop', 'pull'],
  ['chop', 'pull'],
];

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------
test('quality: every shift has a scripted legal solution that clears it cleanly through public input', () => {
  assert.equal(SOLUTIONS.length, SHIFTS.length);
  SHIFTS.forEach((def, i) => {
    const r = runScript(i + 1);
    const last = i === SHIFTS.length - 1;
    assert.equal(r.final.phase, last ? 'won' : 'playing', def.name.en);
    assert.equal(
      r.final.shift,
      last ? SHIFTS.length : i + 2,
      `${def.name.en} cleared into the next shift`,
    );
    assert.ok(r.cleared.satisfaction >= def.need, `${def.name.en}: ${r.cleared.satisfaction}%`);
    assert.equal(r.cleared.stats.rejects, 0, `${def.name.en}: no refusals`);
    assert.equal(r.cleared.stats.burnt, 0);
    assert.equal(r.cleared.stats.expired, 0);
    assert.deepEqual(r.log.calls, last ? [] : [i + 2], 'unlock(n+1) on clear');
    assert.equal(r.h.ends.length, last ? 1 : 0);
  });
});

test('quality: scripted solutions hold at 30 and 120 Hz too', () => {
  for (const hz of [30, 120]) {
    for (const i of [0, 5, 13, 16, 21]) {
      const r = runScript(i + 1, hz);
      assert.equal(r.cleared.stats.rejects, 0, `${SHIFTS[i].name.en} at ${hz} Hz`);
      assert.ok(r.final.shift > i + 1 || r.final.phase === 'won');
    }
  }
});

test('quality: solo station reach times are feasible: every station is a short walk from the others', () => {
  SHIFTS.forEach((def, i) => {
    const h = harness({ seed: 1 });
    h.env.progress = { unlocked: () => i + 1, unlock() {} };
    const g = createGame(h.env);
    if (g.getState().menu) g.update(1 / 60, input([], ['Space']));
    const s = g.getState();
    const targets = [
      ...s.stations.filter((q) => ['crate', 'chopper', 'stove'].includes(q.kind)),
      ...s.junctions,
    ];
    const seconds = (from, to) => {
      const segs = walkTo(s, from, to);
      assert.ok(segs, `${def.name.en}: a way to ${to.c},${to.r}`);
      return segs.reduce((n, sg) => n + sg.dur, 0);
    };
    const spot = (q) => {
      // Stand where a policy would, by following the planned walk.
      const chef = { ...s.chefs[0] };
      for (const sg of walkTo(s, s.chefs[0], q) ?? []) {
        const d = sg.dur * RULES.chefSpeed;
        if (sg.dir === 'right') chef.x += d;
        if (sg.dir === 'left') chef.x -= d;
        if (sg.dir === 'down') chef.y += d;
        if (sg.dir === 'up') chef.y -= d;
      }
      return chef;
    };
    for (const q of targets)
      assert.ok(seconds(s.chefs[0], q) <= 6, `${def.name.en}: start to ${q.kind} ${q.c},${q.r}`);
    const window = def.window ?? RULES.cookWindow;
    for (const stove of s.stations.filter((q) => q.kind === 'stove'))
      for (const q of targets) {
        const trip = seconds(spot(q), stove);
        assert.ok(
          trip <= 4.5 && trip < RULES.cookTime + window - 1,
          `${def.name.en}: ${q.kind} -> stove ${trip.toFixed(1)} s`,
        );
      }
    // Every ticket part has a crate with enough stock, and a shift never needs more than 5 open tickets.
    const need = {};
    for (const tk of def.tickets) for (const p of tk.parts) need[p.kind] = (need[p.kind] ?? 0) + 1;
    for (const [kind, n] of Object.entries(need)) {
      const crate = s.stations.find((q) => q.kind === 'crate' && q.item === kind);
      assert.ok(
        crate && crate.stock >= n,
        `${def.name.en}: ${kind} stock ${crate?.stock} for ${n}`,
      );
    }
    assert.ok(
      def.tickets.every(
        (tk) =>
          def.tickets.filter((o) => o.at <= tk.at && o.at + o.patience > tk.at).length <=
          RULES.maxOpen,
      ),
    );
  });
});

test('quality: a prompt-and-drawn-state policy at 0.15-0.35 s wins at least 27 of 30 on every shift at 60 Hz', () => {
  SHIFTS.forEach((def, i) => {
    const r = rate(i + 1, 60, FAST, 30);
    assert.ok(r.won >= 27, `${def.name.en}: ${r.won}/30`);
  });
});

test('quality: the same policy wins at least 27 of 30 at 30 and 120 Hz on five shifts', () => {
  for (const hz of [30, 120])
    for (const i of [0, 5, 13, 16, 21]) {
      const r = rate(i + 1, hz, FAST, 30);
      assert.ok(r.won >= 27, `${SHIFTS[i].name.en} at ${hz} Hz: ${r.won}/30`);
    }
});

test('quality: a slower 0.4-0.6 s policy with jitter wins at least 24 of 30 on every shift at 60 Hz', () => {
  SHIFTS.forEach((def, i) => {
    const r = rate(i + 1, 60, SLOW, 30);
    assert.ok(r.won >= 24, `${def.name.en}: ${r.won}/30`);
  });
});

test('quality: the slower policy also wins at least 24 of 30 at 30 and 120 Hz on five shifts', () => {
  for (const hz of [30, 120])
    for (const i of [0, 5, 13, 16, 21]) {
      const r = rate(i + 1, hz, SLOW, 30);
      assert.ok(r.won >= 24, `${SHIFTS[i].name.en} at ${hz} Hz: ${r.won}/30`);
    }
});

test('quality: a casual player (0.5-0.8 s, now and then distracted) wins at least 24 of 30 on every shift', () => {
  SHIFTS.forEach((def, i) => {
    let won = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const inner = follower({ cooldown: 1.5 });
      const rnd = seeded(seed * 17 + 1);
      const casual = (s, t, who) => (rnd() < 0.06 ? { wait: 0.6 + rnd() * 0.8 } : inner(s, t, who));
      if (play({ level: i + 1, seed, delayRange: [0.5, 0.8], pickers: [casual] }).cleared) won++;
    }
    assert.ok(won >= 24, `${def.name.en}: ${won}/30`);
  });
});

test('quality: random keys, mashing, hold-and-spam, a blind pulse and blind station tours each win at most half the runs on every shift', () => {
  SHIFTS.forEach((def, i) => {
    for (const name of Object.keys(CRUDE)) {
      const seeds = name in TOURS ? 12 : 30;
      let won = 0;
      for (let seed = 1; seed <= seeds && won <= seeds / 2; seed++)
        if (playCrude(i + 1, name, seed, 30)) won++;
      assert.ok(won <= seeds / 2, `${def.name.en}: ${name} won ${won}/${seeds}`);
    }
  });
});

test('quality: following the prompts never costs a refusal, a burnt dish or a lost customer, even for slow readers', () => {
  const bands = [
    ['fast', FAST, [30, 60, 120], 5],
    ['slow', SLOW, [30, 60, 120], 5],
    ['very slow', [0.7, 1.0], [60], 3],
  ];
  SHIFTS.forEach((def, i) => {
    for (const [name, delayRange, rates, seeds] of bands)
      for (const hz of rates)
        for (let seed = 1; seed <= seeds; seed++) {
          let worst = null;
          const r = play({
            level: i + 1,
            hz,
            seed,
            delayRange,
            onFrame: (s) => {
              worst = s;
            },
          });
          assert.ok(r.cleared, `${def.name.en} ${name} ${hz} Hz seed ${seed}`);
          assert.deepEqual(
            [worst.stats.rejects, worst.stats.burnt, worst.stats.expired],
            [0, 0, 0],
            `${def.name.en}: ${name} reader at ${hz} Hz, seed ${seed}`,
          );
        }
  });
});

test('quality: X is central: a follower that never presses it fails every shift that has a junction', () => {
  const withJunctions = SHIFTS.map((def, i) => [def, i + 1]).filter(
    ([def]) => def.junctions.length,
  );
  assert.ok(withJunctions.length >= 15);
  for (const [def, level] of withJunctions)
    for (let seed = 1; seed <= 3; seed++) {
      const inner = follower();
      const noX = (s, t, who) => {
        const c = inner(s, t, who);
        return c.press === 'route' ? { wait: 0.2 } : c;
      };
      const r = play({ level, seed, delayRange: FAST, pickers: [noX], maxSeconds: 300 });
      assert.equal(r.cleared, false, `${def.name.en}: seed ${seed} cleared without X`);
      assert.equal(r.final.stats.reroutes, 0);
    }
  // the bin shift is served through its junction: the belt ends in the bin until X is pressed
  assert.deepEqual(SHIFTS[9].junctions, ['v>']);
});

test('quality: the drawn prompt line names keys, holds for 0.5 s, rarely flips back and teaches each idea', () => {
  let changes = 0;
  let flips = 0;
  for (const [index, seed, lang] of [
    [0, 1, 'en'],
    [2, 2, 'zh'],
    [3, 3, 'en'],
    [5, 4, 'zh'],
    [8, 5, 'en'],
    [13, 6, 'zh'],
    [16, 7, 'en'],
    [19, 8, 'zh'],
    [21, 9, 'en'],
  ]) {
    const lines = [];
    const keys = new Set();
    let drawn = null;
    const r = play({
      level: index + 1,
      seed,
      lang,
      delayRange: FAST,
      onFrame: (s, t, g) => {
        const rec = recorder();
        g.draw(rec.ctx);
        if (s.menu) {
          drawn = null;
          return;
        }
        const line = rec.texts[0].text;
        assert.equal(line, s.prompt[lang], 'the first thing drawn is the prompt line');
        assert.match(line, /Space|X|F\/,|G\/\.|方向键|Arrows/, `prompt line names a key: ${line}`);
        assert.ok(widthOf({ ...rec.texts[0] }) <= 464, `"${line}" fits`);
        keys.add(s.prompt.key);
        if (line !== drawn) {
          lines.push({ line, t, acts: s.stats.acts });
          drawn = line;
        }
      },
    });
    assert.ok(r.cleared);
    lines.forEach((cur, n) => {
      if (n === 0) return;
      changes++;
      // A prompt that has just been obeyed may move on at once; any other change waits 0.5 s.
      assert.ok(
        cur.acts !== lines[n - 1].acts || cur.t - lines[n - 1].t >= 0.5 - 1e-6,
        `"${lines[n - 1].line}" -> "${cur.line}" after ${(cur.t - lines[n - 1].t).toFixed(2)} s`,
      );
      if (n >= 2 && lines[n - 2].line === cur.line) flips++;
    });
    assert.ok(
      FIRST_IDEA[index].some((k) => keys.has(k)),
      `${SHIFTS[index].name.en} teaches ${FIRST_IDEA[index]}: saw ${[...keys]}`,
    );
  }
  assert.ok(changes > 60, `${changes} prompt changes observed`);
  assert.ok(flips / changes < 0.15, `${flips}/${changes} flipped back`);
  for (const key of Object.keys(PROMPTS)) {
    assert.ok(PROMPTS[key][0] && PROMPTS[key][1], `${key} is bilingual`);
    assert.match(
      PROMPTS[key][0] + PROMPTS[key][1],
      /\{A\}|\{R\}|Arrows|方向键/,
      `${key} names a key`,
    );
  }
});

test('quality: each shift opens with its tip in the status line, in both languages', () => {
  SHIFTS.forEach((def, i) => {
    for (const lang of ['en', 'zh']) {
      const h = harness({ lang });
      h.env.progress = { unlocked: () => i + 1, unlock() {} };
      const g = createGame(h.env);
      if (g.getState().menu) g.update(1 / 60, input([], ['Space']));
      g.update(1 / 60, input([]));
      const s = g.getState();
      assert.ok(s.status[lang].includes(def.tip[lang]), `${def.name.en}: ${s.status[lang]}`);
      assert.match(s.status.en, new RegExp(`Shift ${i + 1}/${SHIFTS.length}`));
      assert.match(s.status.zh, new RegExp(`第 ${i + 1}/${SHIFTS.length} 班`));
      assert.match(s.status.en, /Belt \d(\.\d)? tiles\/s/);
    }
  });
});

test('quality: the shift select shows no text over a cell or another text, in English and Chinese', () => {
  for (const lang of ['en', 'zh'])
    for (const unlocked of [2, 9, 22])
      for (const cursor of [1, Math.min(7, unlocked), unlocked]) {
        const h = harness({ lang });
        h.env.progress = { unlocked: () => unlocked, unlock() {} };
        const g = createGame(h.env);
        for (let i = unlocked; i > cursor; i--) g.update(1 / 60, input([], ['ArrowLeft']));
        const rec = recorder();
        g.draw(rec.ctx);
        const s = g.getState();
        assert.equal(s.menu.cursor, cursor);
        const boxes = rec.texts.map(box);
        boxes.forEach((b, n) => {
          assert.ok(
            b.x0 >= 0 && b.x1 <= 480 && b.y0 >= 0 && b.y1 <= 320,
            `"${rec.texts[n].text}" on screen`,
          );
          boxes
            .slice(n + 1)
            .forEach((o, m) =>
              assert.ok(
                !meets(b, o),
                `"${rec.texts[n].text}" overlaps "${rec.texts[n + 1 + m].text}"`,
              ),
            );
        });
        SHIFTS.forEach((_, k) => {
          const cell = menuCell(k + 1);
          const inside = boxes.filter(
            (b) =>
              b.x0 < cell.x + cell.w && b.x1 > cell.x && b.y0 < cell.y + cell.h && b.y1 > cell.y,
          );
          assert.ok(inside.length <= 1, `cell ${k + 1} holds at most its number`);
          for (const b of inside) {
            assert.ok(
              b.x0 >= cell.x &&
                b.x1 <= cell.x + cell.w &&
                b.y0 >= cell.y &&
                b.y1 <= cell.y + cell.h,
            );
            assert.ok(rec.texts[boxes.indexOf(b)].text === String(k + 1));
          }
        });
        assert.equal(rec.texts[0].text, s.prompt[lang]);
        assert.ok(rec.texts.every((q) => size(q) >= 14 && size(q) <= 16));
      }
});

test('quality: HUD bands do not overlap, text is 14-16 px, and chefs, stations and dishes are 16 px or more', () => {
  for (const lang of ['en', 'zh'])
    for (const level of [1, 6, 14, 22]) {
      const rec = recorder();
      let frames = 0;
      const r = play({
        level,
        lang,
        seed: 4,
        delayRange: FAST,
        onFrame: (s, t, g) => {
          if (s.menu) return;
          const [, top] = s.hud.top;
          const [bottom] = s.hud.bottom;
          for (const q of [...s.chefs, ...s.items, ...s.stations]) {
            assert.ok(q.rect.w >= 16 && q.rect.h >= 16);
            assert.ok(q.rect.y >= top && q.rect.y + q.rect.h <= bottom, JSON.stringify(q.rect));
          }
          if (frames++ % 90 === 0) {
            rec.texts.length = 0;
            g.draw(rec.ctx);
            const bands = rec.texts.filter(
              (q) => q.text !== (lang === 'en' ? 'SHIFT CLEARED!' : '班次完成！'),
            );
            const boxes = bands.map(box);
            boxes.forEach((b, n) => {
              assert.ok(
                b.x0 >= 0 && b.x1 <= 480,
                `"${bands[n].text}" is ${b.x1.toFixed(0)} px wide`,
              );
              assert.ok(
                b.y1 <= 20 || (b.y0 >= bottom && b.y1 <= 320),
                `"${bands[n].text}" sits in a band`,
              );
              boxes.slice(n + 1).forEach((o) => assert.ok(!meets(b, o)));
            });
            assert.ok(rec.texts.every((q) => size(q) >= 14 && size(q) <= 16));
          }
        },
      });
      assert.ok(r.cleared && frames > 1000);
    }
});

test('quality: touch controls are complete and bilingual, solo and co-op', () => {
  const need = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'];
  assert.deepEqual(meta.touchControls.map((b) => b.code).sort(), [...need].sort());
  const coop = [
    'KeyA',
    'KeyW',
    'KeyS',
    'KeyD',
    'KeyF',
    'KeyG',
    ...need.slice(0, 4),
    'Comma',
    'Period',
  ];
  assert.deepEqual(meta.multiplayerTouchControls.map((b) => b.code).sort(), coop.sort());
  for (const b of [...meta.touchControls, ...meta.multiplayerTouchControls]) {
    assert.ok(b.label.en && b.label.zh && ['left', 'right'].includes(b.side));
  }
  const p1 = ['KeyA', 'KeyW', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];
  for (const b of meta.multiplayerTouchControls)
    assert.equal(b.side, p1.includes(b.code) ? 'left' : 'right');
  assert.equal(meta.players, '1-2');
  assert.equal(meta.genre, 'arcade');
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh && k.keys);
});

test('quality: the whole campaign played in order unlocks each shift once and ends in one win', () => {
  const r = play({ level: 1, seed: 5, delayRange: FAST, maxSeconds: 4000, stopAtClear: false });
  assert.equal(r.final.phase, 'won');
  assert.equal(r.h.ends.length, 1);
  assert.equal(r.h.ends[0].won, true);
  assert.ok(r.h.ends[0].score > 0 && r.h.ends[0].message.length > 0);
  assert.deepEqual(
    r.log.calls,
    Array.from({ length: SHIFTS.length - 1 }, (_, i) => i + 2),
  );
  assert.equal(
    r.h.sounds.filter((n) => n === 'win').length,
    SHIFTS.length - 1,
    'one fanfare per cleared shift, none for the terminal',
  );
  assert.equal(r.h.sounds.filter((n) => n === 'lose').length, 0);
});

test('quality: coming back later offers the select screen and continues from the unlocked shift', () => {
  const resume = play({ level: 9, seed: 3, delayRange: FAST });
  assert.equal(resume.cleared, true);
  assert.equal(resume.log.unlocked, 10);
  const replay = play({ level: 4, unlocked: 9, seed: 3, delayRange: FAST });
  assert.equal(replay.cleared, true);
  assert.equal(replay.log.unlocked, 9, 'replaying never lowers what the host stored');
  assert.deepEqual(replay.log.calls, [5]);
});

test('quality: wasting ingredients ends the shift at once with an explicit out-of-stock reason', () => {
  for (const [lang, expected] of [
    ['en', /^Out of eggs: shift 16 can no longer reach 65%\./],
    ['zh', /^鸡蛋用完了：第16班已无法达到65%/],
  ]) {
    const waste = (s, t, who) => {
      if (s.menu) return { press: 'act' };
      if (s.stats.drops >= 5) return { wait: 0.2 };
      const crate = s.stations.find((q) => q.kind === 'crate' && q.item === 'egg');
      const segs = walkTo(s, s.chefs[who], crate);
      return segs?.length ? { walk: segs } : { press: 'act' };
    };
    let emptyAt = null;
    const r = play({
      level: 16,
      lang,
      seed: 2,
      delayRange: FAST,
      pickers: [waste],
      maxSeconds: 120,
      onFrame: (s, t) => {
        if (
          emptyAt === null &&
          s.stations.some((q) => q.kind === 'crate' && q.item === 'egg' && q.stock === 0)
        )
          emptyAt = t;
      },
    });
    assert.equal(r.final.phase, 'lost');
    assert.equal(r.final.cause, 'stock');
    assert.equal(r.h.ends.length, 1);
    assert.match(r.h.ends[0].message, expected);
    assert.ok(
      r.final.time < emptyAt + 15,
      `lost ${r.final.time.toFixed(0)} s, crate empty at ${emptyAt?.toFixed(0)} s`,
    );
  }
});

test('quality: a player who never acts loses fairly at every frame rate, once, and the end stays frozen', () => {
  const ends = [];
  for (const hz of HZ) {
    const h = harness({ seed: 3 });
    const g = createGame(h.env);
    let opened = 0;
    for (let i = 0; i < hz * 400 && !h.ends.length; i++) {
      g.update(1 / hz, input([]));
      opened = Math.max(opened, g.getState().orders.filter((o) => o.state === 'open').length);
    }
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, /Shift 1 failed/);
    const frozen = JSON.stringify(g.getState());
    for (let i = 0; i < 300; i++) g.update(1 / hz, input(['ArrowLeft'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(g.getState()), frozen);
    assert.equal(h.ends.length, 1);
    assert.equal(g.getState().phase, 'lost');
    assert.equal(g.getState().cause, 'satisfaction');
    assert.deepEqual(
      h.sounds.filter((n) => n === 'win' || n === 'lose'),
      [],
    );
    ends.push(g.getState().time);
  }
  assert.ok(
    ends.every((t) => Math.abs(t - ends[0]) < 0.05),
    `the same moment at every rate: ${ends}`,
  );
});

test('quality: the state is identical at 30, 60 and 120 Hz when input is aligned to 1/30 s', () => {
  for (const level of [1, 6, 14]) {
    const snaps = HZ.map((hz) => {
      const h = harness({ seed: 9 });
      h.env.progress = { unlocked: () => level, unlock() {} };
      const g = createGame(h.env);
      if (g.getState().menu) g.update(1 / 30, input([], ['Space']));
      const rnd = seeded(level * 31 + 7);
      for (let slot = 0; slot < 30 * 70; slot++) {
        const held = rnd() < 0.7 ? [MOVES[Math.floor(rnd() * 4)]] : [];
        const pressed = [rnd() < 0.2 && 'Space', rnd() < 0.12 && 'KeyX'].filter(Boolean);
        const per = hz / 30;
        for (let k = 0; k < per; k++) g.update(1 / hz, input(held, k === 0 ? pressed : []));
      }
      return JSON.stringify(g.getState());
    });
    assert.equal(snaps[1], snaps[0], `shift ${level}: 60 Hz matches 30 Hz`);
    assert.equal(snaps[2], snaps[0], `shift ${level}: 120 Hz matches 30 Hz`);
  }
});

test('quality: co-op: each chef can clear a shift alone with their own keys, and two chefs together do too', () => {
  const alone = (who) => {
    const idle = () => ({ wait: 0.2 });
    const pickers = who === 0 ? [follower(), idle] : [idle, follower()];
    return play({ level: 6, mode: 2, seed: 2, delayRange: FAST, pickers });
  };
  for (const who of [0, 1]) {
    const r = alone(who);
    assert.ok(r.cleared, `chef ${who + 1} alone`);
  }
  for (const level of [6, 14, 22]) {
    const r = play({
      level,
      mode: 2,
      seed: 3,
      delayRange: FAST,
      pickers: [onlyFor(FEEDER, follower()), onlyFor(COOK, follower())],
    });
    assert.ok(r.cleared, `two chefs, shift ${level}`);
    assert.equal(r.final.mode, 2);
  }
});

test('quality: the final-shift win and the failure message are explicit and bilingual', () => {
  const r = play({ level: 22, seed: 1, delayRange: FAST, stopAtClear: false, lang: 'zh' });
  assert.equal(r.final.phase, 'won');
  assert.match(r.h.ends[0].message, /[一-鿿]/);
  const lost = harness({ lang: 'zh' });
  const g = createGame(lost.env);
  for (let i = 0; i < 60 * 300 && !lost.ends.length; i++) g.update(1 / 60, input([]));
  assert.match(lost.ends[0].message, /第1班失败：满意度已无法达到\d+%/);
});

test('quality: every kind of ingredient is used and the campaign introduces each station in turn', () => {
  const kinds = new Set(
    SHIFTS.flatMap((d) => d.tickets.flatMap((t) => t.parts.map((p) => p.kind))),
  );
  assert.deepEqual([...kinds].sort(), Object.keys(KINDS).sort());
  const first = (ch) => SHIFTS.findIndex((d) => d.map.some((row) => row.includes(ch))) + 1;
  assert.ok(
    first('C') > 1 && first('S') > first('C') && first('J') > first('S'),
    'board, stove, junction in order',
  );
  assert.ok(first('X') > first('J'), 'the bin comes after junctions');
  assert.ok(
    SHIFTS.some((d) => d.tickets.some((t) => t.parts.length === 3)),
    'three-part tickets exist',
  );
  assert.ok(new Set(SHIFTS.map((d) => d.speed)).size >= 3, 'belt speeds vary');
  assert.equal(new Set(SHIFTS.map((d) => d.name.en)).size, SHIFTS.length);
});
