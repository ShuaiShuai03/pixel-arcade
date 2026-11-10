import { clamp } from '../shared/utils.js';
import {
  LEVELS,
  LEVEL_COUNT,
  R,
  STEP,
  allDocked,
  cloneWorld,
  depthOf,
  gateLevel,
  headOf,
  levelOf,
  newWorld,
  stepWorld,
  toggleGate,
  toggleValve,
  totalVolume,
  volumeError,
} from './tide-lock-world.js';
import {
  aground,
  createSearch,
  plan,
  progressOf,
  rollout,
  workDone,
  signature,
  waitDone,
} from './tide-lock-plan.js';
import { controlLayout, drawGame, menuCellAt } from './tide-lock-draw.js';
export * from './tide-lock-world.js';
export * from './tide-lock-plan.js';
export { textWidth, wrapText, controlLayout, menuCellAt } from './tide-lock-draw.js';

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));
export const meta = {
  id: 'tide-lock',
  name: { en: 'Tide Lock', zh: '潮汐船闸' },
  genre: 'puzzle',
  players: '1',
  touch: true,
  description: {
    en: 'Sail every cargo boat to its dock through 22 canal locks. Water only runs downhill through an open valve, at a speed set by the height difference, and a wide chamber drops less than a narrow one for the same volume. A gate opens only when the water on both sides is level, and a boat sails through only if both sides are at least as deep as its draught. Left and Right pick a valve, X picks a gate, Space opens or closes the selected one, and Enter resets the lock (press it twice once the water is moving; there is no undo, because the water and the tide cannot be rewound). You can also tap a valve or a gate, and tap it again to operate it. Water that leaves through the sea, a drain or over a wall is gone: in the later locks a reservoir holds just enough, so waste it and the line at the top tells you to reset. A boat left aground for three seconds damages the hull, again every three seconds until it floats, and three hulls are your whole fleet. In the first locks the line at the top names the next move; from lock 15 it only states the goal, and a yellow mark shows the water level the boat in hand needs. If no boat has moved for 75 seconds, the line gives the steps again.',
    zh: '通过 22 座运河船闸，把每艘货船送到自己的码头。开着的阀门只会让水从高处流向低处，速度取决于水位差；同样体积的水，宽的水池下降得比窄的少。只有两侧水位齐平时闸门才能打开，且两侧水深都不小于船的吃水，船才能驶过。左右键选择阀门，X 键选择闸门，空格键开关所选的一个，回车键重置本座船闸（水开始流动后需连按两次；不能撤销，因为水和潮汐无法倒流）。也可以直接点按阀门或闸门，再点一次即可操作。流入大海、排水口或溢出墙头的水就没有了：后面的船闸里水库的水刚好够用，浪费之后顶部的提示会让你重置。船搁浅三秒会损坏船体，之后每三秒再损坏一次，直到浮起，三条船体就是你的全部船队。前面的船闸里顶部一行会提示下一步；从第 15 座起它只说明目标，黄色标记显示当前这艘船需要的水位。如果 75 秒内没有船移动，顶部一行会重新给出步骤。',
  },
  keys: [
    { label: { en: 'Select a valve', zh: '选择阀门' }, keys: 'Left / Right' },
    { label: { en: 'Select a gate', zh: '选择闸门' }, keys: 'X' },
    { label: { en: 'Open or close the selection', zh: '开关所选项' }, keys: 'Space' },
    { label: { en: 'Reset the lock', zh: '重置本座船闸' }, keys: 'Enter' },
    { label: { en: 'Pause', zh: '暂停' }, keys: 'P' },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Valve -', '阀门-', 'left'],
    ['ArrowRight', 'Valve +', '阀门+', 'left'],
    ['KeyX', 'Gate', '闸门', 'right'],
    ['Space', 'Open', '开关', 'right'],
    ['Enter', 'Reset', '重置', 'right'],
  ]),
};

// --- Prompt ---------------------------------------------------------------------------------------

const planMemo = new Map();
const MEMO_LIMIT = 400;

// The planner's answer for world `w`, remembered per lock and situation so that the many runs of a
// test (and a restarted lock) do not search again. The memo is bounded: oldest entries go first.
function planFor(w, budget) {
  const key = `${w.c.index}|${signature(w, -1)}`;
  const known = planMemo.get(key);
  if (known && rollout(w, known.steps, 0, known.margin, known.lag)) return known;
  const found = plan(w, { budget });
  if (found && found !== 'unknown') {
    if (planMemo.size >= MEMO_LIMIT) planMemo.delete(planMemo.keys().next().value);
    planMemo.set(key, found);
  }
  return found;
}

const ARROW = { '-1': ['←', 'ArrowLeft'], 1: ['→', 'ArrowRight'] };

const needsGate = (w, j) =>
  w.c.boats.some((cb, k) => !w.boats[k].docked && cb.route[w.boats[k].step] === j);

function stepSatisfied(s, step) {
  const w = s.w;
  if (step.t === 'v') return w.vopen[step.k] === step.on;
  if (step.t === 'g') {
    if (step.close) return !w.gates[step.j].open;
    // The step is over once the boat is through and the gate has shut again.
    if (w.gates[step.j].open) return false;
    // Done once the boat is through, or when no boat needs this gate any more.
    return progressOf(w) > s.stepProgress || !needsGate(w, step.j);
  }
  if (step.ev) return waitDone(w, step);
  return w.time - s.stepStart >= step.time - 1e-9;
}

// Which node a wait is about, and whether it is filling or draining.
function waitSubject(s, step) {
  const w = s.w;
  const c = w.c;
  const net = c.nodes.map(() => 0);
  c.valves.forEach((v, k) => {
    const f = w.flows[k];
    if (!f) return;
    net[v.a] -= f;
    if (v.b >= 0) net[v.b] += f;
  });
  let j = c.gates.findIndex((g, n) => step.ev && step.ev.bit === 1 << n);
  if (j < 0) j = firstGate(s, s.plan.i);
  const pair = j >= 0 ? [c.gates[j].a, c.gates[j].b] : [];
  const pick = pair.filter((n) => !c.nodes[n].sea && Math.abs(net[n]) > 1e-9);
  if (pick.length) {
    const n = pick.reduce((a, b) => (Math.abs(net[a]) >= Math.abs(net[b]) ? a : b));
    return { node: n, rising: net[n] > 0, gate: j };
  }
  return { node: -1, rising: false, gate: j };
}

// The first gate the plan will still open at or after step `i`.
function firstGate(s, i) {
  const steps = s.plan?.steps || [];
  for (let n = i; n < steps.length; n++)
    if (steps[n].t === 'g' && !steps[n].close) return steps[n].j;
  return -1;
}

const tw = (en, zh) => ({ en, zh });

function describeWait(s, step) {
  const c = s.w.c;
  const who = waitSubject(s, step);
  const ev = step.ev;
  const boatBits = c.gates.length;
  if (ev && ev.bit >= 1 << boatBits && ev.bit < 1 << (boatBits + 3 * c.boats.length))
    return { key: 'sail', ...tw('Wait: the boat is sailing', '等待：船正在航行') };
  if (who.node >= 0) {
    const name = c.nodes[who.node].name;
    const rising = who.rising;
    return {
      key: `wait:${who.node}:${rising}`,
      ...tw(
        `Wait: ${name[0]} is ${rising ? 'filling' : 'draining'}`,
        `等待：${name[1]}正在${rising ? '注水' : '排水'}`,
      ),
    };
  }
  if (c.tidal) return { key: 'tide', ...tw('Wait: for the tide to turn', '等待：潮水转向') };
  return { key: 'level', ...tw('Wait: the water is levelling', '等待：水位正在齐平') };
}

function flowText(c, w, k) {
  const v = c.valves[k];
  const la = levelOf(w, v.a);
  const lb = v.b < 0 ? -99 : levelOf(w, v.b);
  const nm = (n, i) => c.nodes[n].name[i];
  if (v.pump) return tw(`lift ${nm(v.a, 0)} to ${nm(v.b, 0)}`, `把${nm(v.a, 1)}抽到${nm(v.b, 1)}`);
  if (v.b < 0) return tw(`drain ${nm(v.a, 0)}`, `排空${nm(v.a, 1)}`);
  const [hi, lo] = la >= lb ? [v.a, v.b] : [v.b, v.a];
  return tw(`${nm(hi, 0)} into ${nm(lo, 0)}`, `${nm(hi, 1)}注入${nm(lo, 1)}`);
}

// What the player must press next to reach control `target` and then operate it.
function controlPrompt(s, target, action, close = false) {
  const c = s.w.c;
  const sel = s.sel;
  const isValve = target.kind === 'valve';
  const part = isValve ? c.valves[target.i] : c.gates[target.i];
  const label = part.label;
  const zhLabel = part.labelZh;
  const here = sel.kind === target.kind && sel.i === target.i;
  if (here) {
    if (isValve) {
      const fx = flowText(c, s.w, target.i);
      return close
        ? {
            key: `close:v${target.i}`,
            press: 'Space',
            ...tw(`Space: close ${label} to hold the level`, `空格：关闭${zhLabel}，保持水位`),
          }
        : {
            key: `open:v${target.i}`,
            press: 'Space',
            ...tw(`Space: open ${label} (${fx.en})`, `空格：打开${zhLabel}（${fx.zh}）`),
          };
    }
    return close
      ? {
          key: `close:g${target.i}`,
          press: 'Space',
          ...tw(`Space: close gate ${label}`, `空格：关闭${zhLabel}`),
        }
      : {
          key: `open:g${target.i}`,
          press: 'Space',
          ...tw(`Space: open gate ${label}, the boat sails on`, `空格：打开${zhLabel}，船只驶过`),
        };
  }
  const where = `${sel.kind[0]}${sel.i}`;
  if (!isValve)
    return {
      key: `pick:g${target.i}:${where}`,
      press: 'KeyX',
      ...tw(`Press X to select gate ${label}`, `按 X 选择${zhLabel}`),
    };
  const gx = sel.kind === 'gate' ? c.gates[sel.i].x : 0;
  const dir =
    sel.kind === 'valve' ? Math.sign(target.i - sel.i) : c.valves[target.i].x <= gx ? -1 : 1;
  const [arrow, press] = ARROW[dir || 1];
  const verb = action === 'ready' ? ['Get ready: select', '准备：选择'] : ['Select', '选择'];
  return {
    key: `pick:v${target.i}:${where}`,
    press,
    ...tw(`${verb[0]} ${label} (${arrow})`, `${verb[1]}${zhLabel}（${arrow}）`),
  };
}

// True once a search has gone on long enough that the prompt owns up to having no hint: first as a
// watch prompt ('note'), and only after a long while more, or once the search rests, as a plain offer
// of the reset ('offer'). A claim of ruin needs a proof, or a boat that will surely be lost.
function isHintless(s) {
  if (s.nohint) return 'offer';
  const slices = s.search?.slices ?? 0;
  if (slices >= R.searchOfferSlices) return 'offer';
  return slices >= R.searchNoteSlices ? 'note' : false;
}

// A boat on the bottom makes its first four seconds (twenty looks) an emergency: the hull cannot wait.
const emergencyOf = (s) => Boolean(s.search) && s.groundTicks > 0 && s.groundTicks < 20;

// A sound proof of ruin that needs no search: without a pump or a river, water never ends up higher
// than the highest water now (or the top of the tide), so a dock whose floor plus the boat's draught
// is above that can never float it.
function provenHopeless(w) {
  const c = w.c;
  if (c.inflow || (c.energy > 0 && w.energy > 0 && c.valves.some((v) => v.pump))) return false;
  let top = -Infinity;
  c.nodes.forEach((n, i) => {
    top = Math.max(top, n.sea ? n.mid + n.amp : levelOf(w, i));
  });
  // (a boat already crossing into its dock gets there even while dragging the bottom)
  return c.boats.some(
    (b, k) =>
      !w.boats[k].docked && w.boats[k].cross?.to !== b.to && c.nodes[b.to].fl + b.d > top + 1e-9,
  );
}

const groundedBoats = (w) => w.boats.some((b) => !b.docked && b.ground >= 0.3);

// Would one or two toggles float every grounded boat within the hull's grace? Tried in the model
// over four seconds. Returns the toggles (valves first, then gates), [] when the water already
// floats them with no toggle at all (so no rescue is asked for, least of all undoing the last
// move), or null.
function findRescue(w0) {
  const c = w0.c;
  const acts = [
    ...c.valves.map((v, k) => ({ kind: 'valve', i: k })),
    ...c.gates.map((g, j) => ({ kind: 'gate', i: j })),
  ];
  const works = (list) => {
    const w = cloneWorld(w0);
    for (const a of list) {
      if (a.kind === 'valve') {
        if (toggleValve(w, a.i) === 'empty') return false;
      } else if (!['open', 'closed'].includes(toggleGate(w, a.i))) return false;
    }
    for (let n = 0; n < 4 * 10; n++) {
      stepWorld(w, 0.1);
      if (w.hit) return false;
      if (w.boats.every((b) => b.docked || b.ground === 0)) return true;
    }
    return false;
  };
  if (works([])) return [];
  for (const a of acts) if (works([a])) return [a];
  for (let i = 0; i < acts.length; i++)
    for (let j = i + 1; j < acts.length; j++)
      if (works([acts[i], acts[j]])) return [acts[i], acts[j]];
  return null;
}

// Left alone, will a hull be lost within four seconds?
function hullLost(w0) {
  const w = cloneWorld(w0);
  for (let n = 0; n < 4 * 10 && !w.hit; n++) stepWorld(w, 0.1);
  return w.hit;
}

function describe(s) {
  const w = s.w;
  const c = w.c;
  if (s.pending) return { key: 'clear', kind: 'watch', ...tw('Lock cleared!', '船闸通过！') };
  if (allDocked(w))
    return { key: 'docked', kind: 'watch', ...tw('All boats are docked!', '所有船只都已靠岸！') };
  if (s.stuck) {
    const warn = c.warn
      ? tw(c.warn[0], c.warn[1])
      : tw('Not enough water left. Reset the lock.', '水量不足，请重置本座船闸。');
    return { key: 'stuck', kind: 'press', press: 'Enter', ...warn, warn: true };
  }
  if (s.rescue) {
    const first = s.rescue[0];
    const open = first.kind === 'valve' ? w.vopen[first.i] : w.gates[first.i].open;
    return { kind: 'press', ...controlPrompt(s, first, first.kind, open) };
  }
  // no way to float the boat in time and no plan that takes the loss: the hull goes every three
  // seconds while the water stays, so the line asks for the reset that saves it. A plan may cost a
  // hull only while the fleet is whole: a hull is gone for good, a reset only costs time.
  if (s.lost && (!s.plan || s.lives < R.lives))
    return {
      key: 'stranded',
      kind: 'press',
      press: 'Enter',
      warn: true,
      ...tw(
        'Stranded: no time to float it. Press Enter to reset',
        '船搁浅了，来不及浮起：按回车重置',
      ),
    };
  if (isHintless(s) === 'offer')
    return {
      key: 'giveup',
      kind: 'press',
      press: 'Enter',
      ...tw('No hint after a long search: press Enter to reset', '找了很久仍无提示：按回车重置'),
    };
  if (isHintless(s))
    return {
      key: 'nohint',
      kind: 'watch',
      ...tw(
        'No hint yet: keep trying, or Enter resets the lock',
        '暂无提示：继续尝试，或按回车重置本座船闸',
      ),
    };
  if (s.search)
    return {
      key: 'think',
      kind: 'watch',
      ...tw('Wait: working out the next step', '等待：正在想下一步'),
    };
  const step = s.plan?.steps[s.plan.i];
  if (!step)
    return { key: 'sail', kind: 'watch', ...tw('Wait: the boat is sailing', '等待：船正在航行') };
  if (step.t === 'w') {
    const next = s.plan.steps[s.plan.i + 1];
    if (next && (next.t === 'v' || next.t === 'g')) {
      const target = next.t === 'v' ? { kind: 'valve', i: next.k } : { kind: 'gate', i: next.j };
      const here = s.sel.kind === target.kind && s.sel.i === target.i;
      if (!here) return { kind: 'press', ...controlPrompt(s, target, 'ready') };
    }
    return { kind: 'watch', ...describeWait(s, step) };
  }
  // a gate cannot be opened until the water is level: wait for it, whatever the plan expected
  if (step.t === 'g' && !step.close && !w.gates[step.j].open && !gateLevel(w, step.j))
    return { kind: 'watch', ...describeWait(s, { ev: { bit: 1 << step.j, value: true } }) };
  if (step.t === 'g' && !step.close && w.gates[step.j].open)
    return { key: 'sail', kind: 'watch', ...tw('Wait: the boat is sailing', '等待：船正在航行') };
  if (step.t === 'v')
    return { kind: 'press', ...controlPrompt(s, { kind: 'valve', i: step.k }, 'valve', !step.on) };
  return {
    kind: 'press',
    ...controlPrompt(s, { kind: 'gate', i: step.j }, 'gate', Boolean(step.close)),
  };
}

// The control and the water mark the picture should point at.
function guideOf(s, line) {
  const w = s.w;
  const c = w.c;
  const step = s.plan?.steps[s.plan.i];
  let ctrl = null;
  if (line.kind === 'press' && line.key !== 'stuck') {
    const m = /^(?:open|close|pick):?([vg])(\d+)/.exec(line.key);
    if (m) ctrl = { kind: m[1] === 'v' ? 'valve' : 'gate', i: Number(m[2]) };
  }
  const j = firstGate(s, s.plan?.i ?? 0);
  let mark = null;
  if (j >= 0 && step) {
    const g = c.gates[j];
    const who = step.t === 'w' ? waitSubject(s, step) : { node: -1 };
    const moving = who.node >= 0 ? who.node : ([g.a, g.b].find((n) => !c.nodes[n].sea) ?? g.a);
    const other = moving === g.a ? g.b : g.a;
    if (!c.nodes[moving].sea) mark = { node: moving, level: levelOf(w, other), gate: j };
  }
  return { ctrl, mark };
}

function usePlan(s, found) {
  s.plan = {
    steps: found.steps,
    i: 0,
    margin: found.margin ?? s.c.margin,
    lag: found.lag ?? R.lag,
  };
  s.stuck = false;
  s.search = null;
  s.stepProgress = progressOf(s.w);
  s.stepStart = s.w.time;
  s.retryTick = s.ticks + R.retryTicks;
}

// Only a finished search that found nothing proves that the water is gone.
function giveUp(s) {
  s.plan = null;
  s.search = null;
  s.stuck = true;
}

// Candidate ways back onto the authored solution: close everything first or not, wait out a tide
// phase or not, and rejoin at any step. They are tried a few at a time before any real search.
function repairCandidates(s) {
  const c = s.c;
  const shifts = c.tidal ? [0, 15, 30, 45] : [0];
  const closeAll = c.valves.map((v, k) => ({ t: 'v', k, on: false }));
  const out = [];
  for (const shift of shifts)
    for (const pre of [[], closeAll])
      for (let i = 0; i < c.solution.length; i++) {
        if (c.solution[i].t === 'w') continue; // rejoin at an action
        const wait = shift ? [{ t: 'w', ev: null, time: shift }] : [];
        out.push([...pre, ...wait, ...c.solution.slice(i)]);
      }
  return out;
}

// The first plan of a lock is made at once (it is usually remembered); later ones are repaired or
// searched a slice at a time, so no frame waits on a long search. A failing plan is never kept.
function startPlan(s, fresh = false) {
  if (!s.planned) {
    s.planned = true;
    // The authored solution answers at once; a search is only the fallback.
    const authored = s.c.solution;
    const found =
      authored.length && rollout(s.w, authored)
        ? { steps: authored, margin: s.c.margin, lag: R.lag }
        : planFor(s.w, R.planNodes);
    if (found && found !== 'unknown') usePlan(s, found);
    else giveUp(s);
    return;
  }
  s.plan = null;
  s.progressTick = s.ticks;
  const known = fresh ? null : planMemo.get(`${s.c.index}|${signature(s.w, -1)}`);
  if (known && rollout(s.w, known.steps, 0, known.margin, known.lag)) usePlan(s, known);
  else
    s.search = {
      // a boat on the bottom has no time for the calm searches: ask the hurried question first
      se: createSearch(s.w, groundedBoats(s.w) ? { margin: 0, lag: R.hurryLag } : {}),
      nodes: 0,
      repairs: fresh ? [] : repairCandidates(s),
      tried: 0,
    };
}

// The work of one search slice. An emergency searches on every tick instead of every other one, so
// it spends half as much per slice: a frame (up to four ticks) never holds more than two slices'
// work, and the search runs the same at any frame rate.
const sliceWork = (s) => (emergencyOf(s) ? R.searchWork / 2 : R.searchWork);

function advanceSearch(s) {
  const search = s.search;
  // first try to rejoin the authored solution: as many candidates as one slice's work allows
  if (search.tried < search.repairs.length) {
    const limit = workDone() + sliceWork(s);
    while (search.tried < search.repairs.length && workDone() < limit) {
      const steps = search.repairs[search.tried++];
      if (rollout(s.w, steps)) return usePlan(s, { steps, margin: s.c.margin, lag: R.lag });
    }
    return;
  }
  // (an emergency, a boat on the bottom, searches at once and on every tick: the hull cannot wait)
  const found = search.se.run(R.searchChunk, sliceWork(s));
  search.slices = (search.slices ?? 0) + 1;
  const again = (opts) => ({
    se: createSearch(s.w, opts),
    slices: search.slices,
    repairs: [],
    tried: 0,
  });
  if (found === 'pending') {
    // never "hopeless" for want of time: past the cap the search rests until the player acts
    if (search.slices >= R.searchCapSlices) {
      s.search = null;
      s.nohint = true;
    }
  } else if (found === null) {
    // No plan with spare depth and a calm hand: ask for none at all, then for a very quick hand,
    // before calling the lock hopeless.
    if (search.se.margin > 0) s.search = again({ margin: 0, lag: R.hurryLag });
    else if (search.se.lag > R.quickLag) s.search = again({ margin: 0, lag: R.quickLag });
    else giveUp(s);
  } else if (rollout(s.w, found.steps, 0, found.margin, found.lag)) usePlan(s, found);
  else s.search = again({});
}

// What the screen and getState() show. Up to lock 14 it is the planner's own line. From lock
// `R.goalFrom` on it states the goal or the problem, never the next control, key or action; the
// yellow water mark for the boat in hand stays.
const OWN_KEYS = new Set(['clear', 'docked', 'stuck', 'stranded', 'giveup', 'menu']);

// The boat the plan opens a gate for next, else the first afloat.
function plannedBoat(s) {
  const w = s.w;
  const j = firstGate(s, s.plan?.i ?? 0);
  const next =
    j < 0
      ? -1
      : s.c.boats.findIndex((cb, k) => !w.boats[k].docked && cb.route[w.boats[k].step] === j);
  return next >= 0 ? next : w.boats.findIndex((b) => !b.docked);
}

// The goal stays on one boat until it is docked, so the line does not flicker as the plan changes.
function goalBoat(s) {
  if (s.goalBoat < 0 || s.w.boats[s.goalBoat].docked) s.goalBoat = plannedBoat(s);
  return s.goalBoat;
}

function goalLine(s) {
  const k = goalBoat(s);
  const boat = s.c.boats[k];
  const up = s.c.nodes[boat.to].h0 > s.c.nodes[boat.from].h0;
  const name = s.c.nodes[boat.to].name;
  return {
    key: `goal:${k}`,
    kind: 'watch',
    ...tw(
      `${up ? 'Lift' : 'Lower'} boat ${k + 1} to the ${name[0]}`,
      `把${k + 1}号船${up ? '升' : '降'}到${name[1]}`,
    ),
  };
}

// A player who gets no boat to move for a long while is not left to guess: the lock then gives its
// steps as the early locks do, until the lock is left.
const goalOnly = (s) => s.c.index + 1 >= R.goalFrom && !s.assist;

const planServes = (s) => !s.rescue && plannedBoat(s) === s.goalBoat;

function publicLine(s) {
  const line = s.line;
  if (!line || s.menu || !goalOnly(s) || OWN_KEYS.has(line.key)) return line;
  const plain = s.rescue
    ? {
        key: 'aground',
        kind: 'watch',
        warn: true,
        ...tw('Aground! Fix the water level, or Enter resets', '搁浅了！调整水位，或按回车重置'),
      }
    : goalLine(s);
  // the water mark belongs to the boat the plan is serving, so it shows only while that is the goal
  const mark = planServes(s) ? (line.guide?.mark ?? null) : null;
  return { ...line, ...plain, press: null, guide: { ctrl: null, mark } };
}

function think(s, forced = false) {
  thinkStep(s, forced);
  if (!s.menu && (s.ticks - s.boatTick) * STEP >= R.assistTime) s.assist = true;
  s.shown = publicLine(s);
}

function thinkStep(s, forced) {
  const w = s.w;
  if (s.menu) {
    s.line = {
      key: 'menu',
      kind: 'press',
      press: 'Space',
      age: 0,
      seq: 0,
      guide: { ctrl: null, mark: null },
      ...tw('Pick a lock (Left/Right), then Space', '选择船闸（左右键），按空格进入'),
    };
    return;
  }
  if (s.pending || allDocked(w)) {
    s.line = { ...describe(s), age: 0, seq: s.actSeq, guide: { ctrl: null, mark: null } };
    return;
  }
  if (!forced && s.line && s.thinkCount < R.thinkTicks) return;
  s.thinkCount = 0;
  s.checks++;
  const cur = s.plan;
  while (cur && cur.i < cur.steps.length && stepSatisfied(s, cur.steps[cur.i])) {
    cur.i++;
    s.stepProgress = progressOf(w);
    s.stepStart = w.time;
    s.recheck = true;
    s.progressTick = s.ticks;
  }
  const prog = progressOf(w);
  if (prog !== s.lastProg) {
    s.lastProg = prog;
    s.progressTick = s.ticks;
    s.boatTick = s.ticks;
  }
  if (!s.stuck && provenHopeless(w)) giveUp(s);
  if (!s.search && !s.stuck && !s.nohint) {
    // A search is costly, so it waits until the player has stopped acting for a moment.
    const ready =
      s.ticks >= s.retryTick && (!cur || groundedBoats(w) || s.ticks - s.actTick >= R.idleTicks);
    let replan = !cur;
    // a plan that has stood still for a long time is not working, however good it looked
    // (only a wait can stall: a step that needs the player is not stuck, the player is just slow)
    const stp = cur?.steps[cur.i];
    if (stp?.t === 'g' && !stp.close) {
      // the same gate opened and shut again twice with no boat through: the plan is wrong
      if (s.tryStep !== stp) Object.assign(s, { tryStep: stp, tries: 0, wasOpen: false });
      const open = w.gates[stp.j].open;
      if (s.wasOpen && !open && progressOf(w) <= s.stepProgress) s.tries++;
      s.wasOpen = open;
    }
    const stalled =
      Boolean(cur) &&
      ((stp?.t === 'w' && s.ticks - s.progressTick > R.stallTicks) || (s.tries ?? 0) >= 2);
    if (cur && cur.i >= cur.steps.length) replan = !hasMovingBoat(w);
    else if (cur && ready && (s.recheck || s.checks % 30 === 0)) {
      // (a timed wait already under way only has its remaining time left to run; in the plan it
      // starts once the hand that made the last move has had its lag)
      const waited = Math.max(0, w.time - s.stepStart - cur.lag);
      replan = !rollout(w, cur.steps, cur.i, cur.margin, cur.lag, waited);
    }
    if (stalled) replan = true;
    if (ready) s.recheck = false;
    if (replan && (ready || stalled)) {
      s.tries = 0;
      startPlan(s, stalled);
    }
  }
  s.groundTicks = groundedBoats(w) ? s.groundTicks + 1 : 0;
  if (groundedBoats(w)) {
    if (s.ticks - s.rescueTick >= 30) {
      const rescue = findRescue(w);
      s.rescue = rescue?.length ? rescue : null;
      s.lost = !rescue && hullLost(w);
      s.rescueTick = s.ticks;
    }
  } else {
    s.rescue = null;
    s.lost = false;
  }
  const next = describe(s);
  const line = s.line;
  if (line && line.key === next.key) {
    s.line = { ...next, age: line.age, seq: line.seq, guide: guideOf(s, next) };
    return;
  }
  if (line && line.age < R.promptHold * 120 && line.seq === s.actSeq) return;
  s.line = { ...next, age: 0, seq: s.actSeq, guide: guideOf(s, next) };
}

const hasMovingBoat = (w) => w.boats.some((b) => b.cross);

// --- Game state ---------------------------------------------------------------------------------------

const say = (s, en, zh) => {
  s.msg = { en, zh, time: R.msgTime };
};

export function loadLock(s, index) {
  s.menu = null;
  s.level = index;
  s.c = LEVELS[index];
  s.w = newWorld(s.c);
  s.sel = { kind: 'valve', i: 0 };
  s.plan = null;
  s.stuck = false;
  s.line = null;
  s.winT = 0;
  s.pending = false;
  s.clock = 0;
  s.intro = R.introTime;
  s.thinkCount = 0;
  s.checks = 0;
  s.recheck = true;
  s.stepProgress = 0;
  s.stepStart = 0;
  s.docks = 0;
  s.planned = false;
  s.search = null;
  s.nohint = false;
  s.groundTicks = 0;
  s.rescue = null;
  s.lost = false;
  s.rescueTick = -1e9;
  s.progressTick = 0;
  s.boatTick = s.ticks;
  s.assist = false;
  s.goalBoat = -1;
  s.lastProg = 0;
  s.retryTick = 0;
  s.actTick = -1e9;
  s.resetArm = -1e9;
  s.v0 = totalVolume(s.w);
  s.layout = controlLayout(s.c);
  think(s, true);
}

// The progress store is a convenience: a store that throws must not stop the game.
function readUnlocked(progress) {
  try {
    const raw = Number(progress?.unlocked?.());
    return Number.isNaN(raw) ? 1 : clamp(Math.floor(raw), 1, LEVEL_COUNT);
  } catch {
    return 1;
  }
}

function saveUnlocked(progress, level) {
  try {
    progress?.unlock?.(level);
  } catch {
    // the lock is cleared all the same; only the saved place is lost
  }
}

export function newState(env = {}) {
  const s = {
    phase: 'playing',
    score: 0,
    acc: 0,
    ticks: 0,
    actSeq: 0,
    lives: R.lives,
    best: Array(LEVEL_COUNT).fill(0),
    msg: null,
    progress: env.progress || null,
    queued: [],
    stats: { cleared: 0, resets: 0, hulls: 0, spilled: 0 },
  };
  const unlocked = readUnlocked(s.progress);
  loadLock(s, 0);
  if (unlocked > 1) {
    s.menu = { sel: unlocked, unlocked };
    think(s);
  }
  return s;
}

// --- Controls -----------------------------------------------------------------------------------------

function controlAt(s, px, py) {
  const lay = s.layout;
  let best = null;
  let bestD = 54;
  const test = (kind, i, pts) =>
    pts.forEach(([x, y]) => {
      const d = Math.hypot(x - px, (y - py) * 0.7);
      if (d < bestD) {
        bestD = d;
        best = { kind, i };
      }
    });
  lay.gates.forEach((p, j) =>
    test('gate', j, [
      [p.x, p.y],
      [p.sx, p.sy],
    ]),
  );
  lay.valves.forEach((p, k) =>
    test('valve', k, [
      [p.x, p.y],
      [p.sx, p.sy],
    ]),
  );
  return best;
}

function toggleSelected(s, emit) {
  const w = s.w;
  // the water is not what the last rescue was worked out for: look again on the next tick
  s.rescueTick = -1e9;
  const { kind, i } = s.sel;
  if (kind === 'valve') {
    const r = toggleValve(w, i);
    if (r === 'empty')
      say(s, 'The battery is empty: the pump will not start.', '电量耗尽，水泵无法启动。');
    emit('move');
    return;
  }
  const r = toggleGate(w, i);
  if (r === 'uneven') {
    const g = s.c.gates[i];
    const diff = Math.abs(levelOf(w, g.a) - levelOf(w, g.b)).toFixed(1);
    say(
      s,
      `The water differs by ${diff} m: the gate stays shut.`,
      `两侧水位差 ${diff} 米，闸门打不开。`,
    );
    emit('hit');
  } else if (r === 'busy')
    say(s, 'A boat is passing: wait until it is through.', '船正在通过，请等它驶过。');
  else emit('coin');
}

function selectValve(s, dir) {
  const c = s.c;
  const n = c.valves.length;
  let i = s.sel.i;
  if (s.sel.kind === 'valve') i = clamp(i + dir, 0, n - 1);
  else {
    const gx = c.gates[i].x;
    const ok = c.valves
      .map((v, k) => k)
      .filter((k) => (dir < 0 ? c.valves[k].x <= gx : c.valves[k].x >= gx));
    if (ok.length) i = dir < 0 ? ok[ok.length - 1] : ok[0];
    else i = dir < 0 ? 0 : n - 1;
  }
  return { kind: 'valve', i };
}

function selectGate(s) {
  const c = s.c;
  if (s.sel.kind === 'gate') return { kind: 'gate', i: (s.sel.i + 1) % c.gates.length };
  const vx = c.valves[s.sel.i].x;
  let best = 0;
  c.gates.forEach((g, j) => {
    if (Math.abs(g.x - vx) < Math.abs(c.gates[best].x - vx)) best = j;
  });
  return { kind: 'gate', i: best };
}

export function resetLock(s, emit = () => {}, penalty = false) {
  loadLock(s, s.level);
  if (!penalty) s.stats.resets++;
  emit('move');
}

function act(s, input, emit) {
  const press = (...codes) => input.pressed(...codes);
  const was = s.sel;
  let touched = false;
  const dir = (press('ArrowRight', 'KeyD') ? 1 : 0) - (press('ArrowLeft', 'KeyA') ? 1 : 0);
  if (dir) {
    s.sel = selectValve(s, dir);
    touched = true;
  }
  if (press('KeyX')) {
    s.sel = selectGate(s);
    touched = true;
  }
  const ptr = input.pointer;
  if (ptr?.clicked) {
    const hit = controlAt(s, ptr.x, ptr.y);
    if (hit) {
      const same = hit.kind === s.sel.kind && hit.i === s.sel.i;
      s.sel = hit;
      if (same) toggleSelected(s, emit);
      touched = true;
    }
  }
  if (touched && (s.sel.kind !== was.kind || s.sel.i !== was.i)) emit('move');
  if (press('Space')) {
    toggleSelected(s, emit);
    touched = true;
  }
  if (press('Enter')) {
    // A reset throws the water away, so it needs a second press unless the lock is hopeless or fresh.
    const armed = s.ticks - s.resetArm <= R.resetArmTicks;
    const hintless = isHintless(s) || s.lost;
    if (s.stuck || hintless || s.clock < R.freshTime || armed) {
      resetLock(s, emit);
    } else {
      s.resetArm = s.ticks;
      say(s, 'Press Enter again to reset this lock.', '再按一次回车键重置本座船闸。');
    }
    s.actSeq++;
    return;
  }
  if (touched) {
    s.nohint = false;
    s.actTick = s.ticks;
    s.actSeq++;
    s.recheck = true;
    think(s, true);
  }
}

// Keys pressed while a cleared lock waits are kept (a few, in order) and played on the next lock.
const QUEUED_CODES = ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'KeyX', 'Space'];

function queuePresses(s, input, emit) {
  const codes = QUEUED_CODES.filter((code) => input.pressed(code));
  if (!codes.length || s.queued.length >= R.queueMax) return;
  s.queued.push(codes);
  emit('move');
}

function replayQueued(s, emit) {
  const queue = s.queued;
  s.queued = [];
  for (const codes of queue)
    act(
      s,
      { pressed: (...wanted) => wanted.some((code) => codes.includes(code)), pointer: null },
      emit,
    );
}

function menuInput(s, input, emit) {
  const m = s.menu;
  const cols = R.menuCols;
  const step =
    (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) - (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  const row =
    (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  let sel = clamp(m.sel + step + row * cols, 1, m.unlocked);
  let start = input.pressed('Space', 'Enter');
  const ptr = input.pointer;
  if (ptr?.clicked) {
    const cell = menuCellAt(ptr.x, ptr.y);
    if (cell >= 1 && cell <= m.unlocked) {
      start = start || cell === sel;
      sel = cell;
    }
  }
  if (sel !== m.sel) emit('move');
  m.sel = sel;
  if (start) {
    loadLock(s, sel - 1);
    emit('move');
  }
}

// --- Simulation ---------------------------------------------------------------------------------------

function clearLock(s, emit) {
  const left = Math.max(0, Math.round((s.c.par - s.clock) * R.scorePar));
  const gained = R.scoreClear + s.lives * R.scoreHull + left;
  s.best[s.level] = Math.max(s.best[s.level], gained);
  s.score = s.best.reduce((a, v) => a + v, 0);
  saveUnlocked(s.progress, Math.min(LEVEL_COUNT, s.level + 2));
  s.stats.cleared++;
  emit('coin');
  if (s.level === LEVEL_COUNT - 1) {
    s.phase = 'won';
    return;
  }
  s.pending = true;
  s.clearT = 0;
  say(s, `Lock ${s.level + 1} cleared! +${gained}`, `第 ${s.level + 1} 座船闸通过！+${gained}`);
  think(s, true);
}

function hullHit(s, emit) {
  s.stats.hulls++;
  s.lives--;
  emit('hit');
  if (s.lives <= 0) {
    s.phase = 'lost';
    return;
  }
  // A tug pulls the boat free; the water stays as it is, so the mistake still has to be put right.
  s.w.hit = false;
  s.w.boats.forEach((b) => {
    if (b.ground >= R.groundGrace) b.ground = 0;
  });
  say(s, 'A boat ran aground: the hull is damaged.', '船搁浅了：船体受损。');
}

function tick(s, emit) {
  const w = s.w;
  if (s.pending) {
    s.clearT += STEP;
    s.ticks++;
    s.msg && (s.msg.time -= STEP);
    if (s.clearT >= R.clearHold) {
      loadLock(s, s.level + 1);
      replayQueued(s, emit);
    }
    return;
  }
  const spilledBefore = w.led.spilled;
  stepWorld(w, STEP);
  s.ticks++;
  s.clock += STEP;
  s.thinkCount++;
  if (s.line) s.line.age++;
  s.stats.spilled += w.led.spilled - spilledBefore;
  if (s.intro > 0) s.intro -= STEP;
  if (s.msg && (s.msg.time -= STEP) <= 0) s.msg = null;
  const docked = w.boats.filter((b) => b.docked).length;
  if (docked > s.docks) emit('coin');
  s.docks = docked;
  if (w.hit) {
    hullHit(s, emit);
    return;
  }
  if (allDocked(w)) {
    s.winT += STEP;
    if (s.winT >= R.winHold) clearLock(s, emit);
  }
  if (s.thinkCount >= R.thinkTicks) think(s);
  // searching goes on only while the player is not acting: what they do changes the question
  // (a boat on the bottom cannot wait: it searches at once and every tick)
  if (
    s.search &&
    (emergencyOf(s) || (s.ticks % R.searchTicks === 0 && s.ticks - s.actTick >= R.searchIdleTicks))
  )
    advanceSearch(s);
}

export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > R.maxDt) return false;
  if (s.menu) {
    menuInput(s, input, emit);
    // the frame that starts a lock still counts its time, so every frame rate keeps one clock
    if (s.menu) return true;
  } else if (s.pending) queuePresses(s, input, emit);
  else act(s, input, emit);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, emit);
  return true;
}

export function createGame(env) {
  const s = newState(env);
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        const won = s.phase === 'won';
        emit(won ? 'win' : 'lose');
        env.end({
          won,
          score: s.score,
          message: won
            ? env.t(
                'Every lock is cleared. The whole fleet is home!',
                '所有船闸都已通过，整支船队平安到港！',
              )
            : env.t(
                'All three hulls are wrecked. The fleet is lost!',
                '三条船体都损毁了，船队覆没！',
              ),
        });
      }
    },
    draw(ctx) {
      drawGame(ctx, s, env);
    },
    getState() {
      return snapshotOf(s);
    },
  };
}

// --- Snapshot -----------------------------------------------------------------------------------------

export function snapshotOf(s) {
  const w = s.w;
  const c = s.c;
  const line = s.shown || { en: '', zh: '', kind: 'watch', press: null, key: '' };
  const label = (lang) =>
    s.menu
      ? line[lang]
      : `${lang === 'en' ? 'Lock' : '船闸'} ${s.level + 1}/${LEVEL_COUNT} ${c.name[lang === 'en' ? 0 : 1]} · ${line[lang]}`;
  const guide =
    s.menu || s.phase !== 'playing'
      ? { ctrl: null, mark: null }
      : line.guide || { ctrl: null, mark: null };
  return {
    phase: s.phase,
    score: s.score,
    level: s.level + 1,
    levels: LEVEL_COUNT,
    name: { en: c.name[0], zh: c.name[1] },
    tip: { en: c.tip[0], zh: c.tip[1] },
    par: c.par,
    time: s.clock,
    lives: s.lives,
    energy: w.energy,
    stuck: s.stuck,
    searching: Boolean(s.search),
    nohint: Boolean(isHintless(s)),
    pending: s.pending,
    assist: s.assist,
    menu: s.menu ? { ...s.menu } : null,
    selected: { kind: s.sel.kind, index: s.sel.i },
    prompt: { en: line.en, zh: line.zh, kind: line.kind, press: line.press || null, key: line.key },
    line: { en: line.en, zh: line.zh },
    guide: {
      control: guide.ctrl ? { ...guide.ctrl } : null,
      mark: guide.mark ? { ...guide.mark } : null,
    },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    nodes: c.nodes.map((n, i) => ({
      id: i,
      name: { en: n.name[0], zh: n.name[1] },
      sea: n.sea,
      level: levelOf(w, i),
      depth: depthOf(w, i),
      floor: n.fl,
      top: n.top,
      area: n.sea ? null : n.a,
      volume: n.sea ? null : w.vol[i],
      spilling: w.spilling[i],
      capacity: n.cap,
    })),
    valves: c.valves.map((v, k) => ({
      id: k,
      label: v.label,
      labelZh: v.labelZh,
      a: v.a,
      b: v.b,
      pump: v.pump,
      area: v.area,
      sill: v.sill,
      open: w.vopen[k],
      flow: w.flows[k],
      head: v.pump ? 0 : headOf(w, v.a, v.b, v.sill),
    })),
    gates: c.gates.map((g, j) => ({
      id: j,
      label: g.label,
      labelZh: g.labelZh,
      a: g.a,
      b: g.b,
      open: w.gates[j].open,
      progress: w.gates[j].p,
      busy: w.gates[j].busy,
      level: gateLevel(w, j),
    })),
    boats: c.boats.map((b, k) => ({
      id: k,
      node: w.boats[k].node,
      to: b.to,
      draught: b.d,
      x: w.boats[k].x,
      docked: w.boats[k].docked,
      crossing: Boolean(w.boats[k].cross),
      depth: depthOf(w, w.boats[k].node),
      aground: w.boats[k].ground,
    })),
    ledger: { ...w.led },
    volume: { total: totalVolume(w), start: s.v0, error: volumeError(w, s.v0) },
    docked: w.boats.filter((b) => b.docked).length,
    status: { en: label('en'), zh: label('zh') },
    stats: { ...s.stats },
  };
}
