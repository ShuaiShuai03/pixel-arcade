import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_COUNT,
  LEVELS,
  COMPILED,
  PRESS,
  RULES,
  buildSchedule,
  createGame,
  runPrompted,
  safeSchedule,
  selectStep,
} from '../src/games/traffic-conductor.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt line, the
// selected junction, the signals, the queues, the pedestrians, the siren banner and the clock. They
// press only public keys.
// ---------------------------------------------------------------------------------------------
// The default run samples a few seeds per level so the suite stays quick (about a minute).
// TC_FULL=1 runs the full gates: 30 seeds for the followers and 40 for every depth probe.
const FULL = process.env.TC_FULL === '1';
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const MAX_SECONDS = 200;
const CODE = {
  U: 'ArrowUp',
  R: 'ArrowRight',
  D: 'ArrowDown',
  L: 'ArrowLeft',
  S: 'Space',
  X: 'KeyX',
};
const ARROWS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const WIN = (st, level) => st.level > level || st.phase === 'won';

function open(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// A literal prompt follower: it presses the key the prompt named `lag` seconds ago, once per
// prompt (it repeats only if the prompt is still there after 1.5 s), at most every 0.12 s.
function follower(lag) {
  const hist = [];
  let last = { text: null, t: -9 };
  let lastPress = -9;
  return (st, t) => {
    hist.push({ t, p: st.prompt });
    if (hist.length > 400) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const p = hist[k].p;
    if (!p || p.kind === 'watch' || !p.press || t - lastPress < 0.12) return [];
    if (p.en === last.text && t - last.t < 1.5) return [];
    last = { text: p.en, t };
    lastPress = t;
    return [p.press];
  };
}

// The most naive follower: presses whatever the prompt says every 0.2 s while it is on screen.
function naiveFollower(lag) {
  const hist = [];
  let lastPress = -9;
  return (st, t) => {
    hist.push({ t, p: st.prompt });
    if (hist.length > 400) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const p = hist[k].p;
    if (!p || p.kind === 'watch' || !p.press || t - lastPress < 0.2) return [];
    lastPress = t;
    return [p.press];
  };
}

function play({ level, seed = 1, hz = 60, lang = 'en', decide, onFrame }) {
  const { g, h } = open(level, { seed, lang });
  let strikes = 0;
  let left = 0;
  let t = 0;
  let st = g.getState();
  for (let f = 0; t < MAX_SECONDS; f++) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    strikes = Math.max(strikes, st.strikes);
    left = st.timeLeft;
    const keys = decide(st, t, f);
    onFrame?.(st, t, keys, g);
    g.update(1 / hz, input([], keys));
    t += 1 / hz;
  }
  st = g.getState();
  if (st.level === level) strikes = Math.max(strikes, st.strikes);
  return { st, t, strikes, left, cleared: WIN(st, level), g, h };
}
const rate = (n, total) => `${n}/${total}`;
const lagFor = (range, seed) => range[0] + seeded(seed * 7919 + 13)() * (range[1] - range[0]);

// ---------------------------------------------------------------------------------------------
// Players that do not read the prompt. Those with `blind` look at the screen only to notice the
// end of the level, which keeps the runs fast.
// ---------------------------------------------------------------------------------------------
const blind = (fn) => Object.assign(fn, { blind: true });
const PLAYERS = {
  mash: (seed) => {
    const r = seeded(seed + 5);
    return blind((st, t, f) =>
      f % 3 === 0 ? [r() < 0.7 ? 'Space' : r() < 0.5 ? 'KeyX' : ARROWS[Math.floor(r() * 4)]] : [],
    );
  },
  random: (seed) => {
    const r = seeded(seed + 9);
    const pool = ['Space', 'Space', 'KeyX', ...ARROWS];
    let next = 0.5;
    return blind((st, t) => {
      if (t < next) return [];
      next = t + 0.3 + r() * 1.2;
      return [pool[Math.floor(r() * pool.length)]];
    });
  },
  // Space once every N seconds, the first press at t = N.
  ...Object.fromEntries(
    [6, 10].map((n) => [
      `every${n}`,
      () => {
        let next = n;
        return blind((st, t) => (t < next ? [] : ((next += n), ['Space'])));
      },
    ]),
  ),
  cycle5: () => blind((st, t) => (t > 0.1 && t % 5 < 1 / 30 ? ['Space'] : [])),
  cycle12: () => blind((st, t) => (t > 0.1 && t % 12 < 1 / 30 ? ['Space'] : [])),
  cycle20: () => blind((st, t) => (t > 0.1 && t % 20 < 1 / 30 ? ['Space'] : [])),
  xspam: () => blind((st, t, f) => (f % 15 === 0 ? ['KeyX'] : [])),
};

// "Give the green to the longest queue": a deliberately sensible player that ignores the prompt.
function greedy() {
  let lastAct = -9;
  return (st, t) => {
    if (t - lastAct < 0.5) return [];
    let best = null;
    for (const J of st.junctions) {
      if (J.stage !== 'green' || (J.minGreenLeft ?? 0) > 0) continue;
      const green = new Set(J.signals.filter((s) => s.light === 'green').map((s) => s.dir));
      let cur = 0;
      let other = 0;
      for (const v of st.vehicles)
        if (v.where === 'lane' && v.junction === J.id && v.speed < 6 && v.approach)
          green.has(v.approach) ? (cur += 1) : (other += 1);
      const ped = st.pedestrians.some(
        (p) => p.junction === J.id && p.state === 'wait' && p.wait > 12,
      );
      const need = other - cur;
      if ((ped || need > 0) && (!best || need > best.need)) best = { J, need, ped };
    }
    if (!best) return [];
    if (best.J.id !== st.selected) {
      lastAct = t - 0.35;
      return [best.J.id > st.selected ? 'ArrowRight' : 'ArrowLeft'];
    }
    lastAct = t;
    return [best.ped ? 'KeyX' : 'Space'];
  };
}

// "Give the green to whoever has waited longest": the other sensible player.
function longestWait() {
  let lastAct = -9;
  return (st, t) => {
    if (t - lastAct < 0.5) return [];
    let best = null;
    for (const J of st.junctions) {
      if (J.stage !== 'green' || (J.minGreenLeft ?? 0) > 0) continue;
      const green = new Set(J.signals.filter((s) => s.light === 'green').map((s) => s.dir));
      let cur = 0;
      let other = 0;
      for (const v of st.vehicles) {
        if (v.where !== 'lane' || v.junction !== J.id || v.speed >= 6 || !v.approach) continue;
        if (green.has(v.approach)) cur = Math.max(cur, v.wait);
        else other = Math.max(other, v.wait);
      }
      const ped = st.pedestrians.some(
        (p) => p.junction === J.id && p.state === 'wait' && p.wait > 12,
      );
      const need = other - cur;
      if ((ped || need > 1) && (!best || need > best.need)) best = { J, need, ped };
    }
    if (!best) return [];
    if (best.J.id !== st.selected) {
      lastAct = t - 0.35;
      return [best.J.id > st.selected ? 'ArrowRight' : 'ArrowLeft'];
    }
    lastAct = t;
    return [best.ped ? 'KeyX' : 'Space'];
  };
}

// The scout reads the board and ignores the prompt: it gives the green to the heavier road, serves a
// siren's road first, calls the pedestrians before their sign runs out and rotates a green that
// has run long. It sees a snapshot that is `lag` seconds old, presses at most every 0.2 s and never
// acts on a snapshot older than its own last press.
const LOAD = { car: 1, bus: 2, truck: 1.5, amb: 10 };
const SCOUT = { ratio: 1.8, slack: 2, idle: 0.35, starve: 0.55, maxGreen: 22, pedFrac: 0.35 };
const GREEN_HOLD = RULES.minGreen + RULES.yellow + RULES.allRed + 2;
const SIREN_LEAD = RULES.yellow + RULES.allRed + 1.5;

function armLoads(st, j) {
  const arms = [0, 1, 2, 3].map(() => ({ load: 0, count: 0, items: [] }));
  for (const v of st.vehicles) {
    const d = 'NESW'.indexOf(v.approach);
    if (v.junction !== j || v.where !== 'lane' || d < 0) continue;
    arms[d].count++;
    arms[d].load += LOAD[v.kind] * (1 + Math.min(v.wait, 40) / 10);
    arms[d].items.push(v);
  }
  return arms;
}

function scoutWant(st, JW, t, memo) {
  if (JW.stage !== 'green') memo.green.delete(JW.id);
  if (JW.stage !== 'green' || JW.minGreenLeft > 0) return null;
  if (!memo.green.has(JW.id)) memo.green.set(JW.id, t);
  const arms = armLoads(st, JW.id);
  const present = JW.signals.map((s) => 'NESW'.indexOf(s.dir));
  const green = present.filter((d) => JW.signals[present.indexOf(d)].light === 'green');
  const red = present.filter((d) => !green.includes(d));
  let next = red;
  if (JW.phases > 2) {
    const after = [1, 2, 3, 4].map((k) => ((green[0] ?? 0) + k) % 4);
    const pick = after.find((d) => present.includes(d) && arms[d].count > 0);
    next = pick === undefined ? red.slice(0, 1) : [pick];
  }
  const sum = (ds) => ds.reduce((n, d) => n + arms[d].load, 0);
  const here = sum(green);
  const there = sum(next);
  const lead = SIREN_LEAD + (st.junctions.length > 1 ? 2 : 0);
  const sirens = st.alerts.filter((a) => a.jn === JW.id);
  if (sirens.some((a) => green.includes(a.d) && a.eta < GREEN_HOLD + 0.7 * arms[a.d].count))
    return null;
  if (sirens.some((a) => !green.includes(a.d) && a.eta <= lead + 0.7 * arms[a.d].count + 2.5))
    return { key: 'Space', urgency: 1000 };
  const waiting = st.pedestrians.filter((p) => p.junction === JW.id && p.state === 'wait');
  const oldest = Math.max(0, ...waiting.map((p) => p.wait));
  if (waiting.length && oldest >= st.pedLimit - RULES.pedLead) return { key: 'KeyX', urgency: 500 };
  const starving = next.some((d) =>
    arms[d].items.some(
      (v) => v.wait >= SCOUT.starve * (v.kind === 'bus' ? st.busWaitLimit : st.waitLimit),
    ),
  );
  const long = t - memo.green.get(JW.id) > SCOUT.maxGreen;
  const switchNow =
    there >= 0.5 &&
    (here < SCOUT.idle || there > SCOUT.ratio * here + SCOUT.slack || starving || long);
  if (!switchNow) return null;
  const pedOk = t - (memo.ped.get(JW.id) ?? -99) >= RULES.pedGap;
  if (pedOk && waiting.length && (oldest >= SCOUT.pedFrac * st.pedLimit || waiting.length >= 4))
    return { key: 'KeyX', urgency: 200 };
  return { key: 'Space', urgency: starving ? 100 : there - here };
}

function scout(lag) {
  const hist = [];
  const memo = { green: new Map(), ped: new Map(), pressed: -9 };
  return (now, t) => {
    hist.push({ t, st: now });
    if (hist.length > 400) hist.shift();
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > t - lag) k--;
    const { st, t: seenAt } = hist[k];
    if (st.menu || t - memo.pressed < 0.2 || seenAt <= memo.pressed + 0.02) return [];
    const wants = st.junctions.map((JW) => scoutWant(st, JW, t, memo));
    let target = st.selected;
    let urgency = 0;
    wants.forEach((w, j) => {
      if (w && w.urgency > urgency) [target, urgency] = [j, w.urgency];
    });
    if (urgency === 0) return [];
    let key = wants[target].key;
    if (target !== st.selected) {
      const step = selectStep(st.junctions, st.selected, target);
      if (step < 0) return [];
      key = PRESS[step];
    } else if (key === 'KeyX') memo.ped.set(target, t);
    memo.pressed = t;
    return [key];
  };
}

// A fixed-time plan tuned for one level: phase 0 stays green `a` s, phase 1 `b` s (the split
// plans alternate the same way), the second junction starts `off` s late, and the plan calls the
// pedestrians once someone has waited `xe` s (0: never).
function fixedPlan(a, b, off, xe) {
  const since = {};
  return (st, t) => {
    let best = null;
    for (const J of st.junctions) {
      if (J.stage !== 'green' || J.minGreenLeft > 0) {
        since[J.id] = undefined;
        continue;
      }
      const key = `${J.phase}:${J.stage}`;
      if (since[J.id]?.key !== key) since[J.id] = { key, t };
      const wanted = J.phase % 2 === 0 ? a : b;
      if (t >= (J.id === 1 ? off : 0) + 0.1 && t - since[J.id].t >= wanted && !best)
        best = { J, flip: true };
      const waiting = st.pedestrians.some((p) => p.junction === J.id && p.wait > xe);
      if (xe > 0 && waiting && !best) best = { J, flip: false };
    }
    if (!best) return [];
    if (best.J.id !== st.selected) return [best.J.id > st.selected ? 'ArrowRight' : 'ArrowLeft'];
    return [best.flip ? 'Space' : 'KeyX'];
  };
}
// The best fixed plan found for each level by searching 4 seeds (see the hand-off report).
const TUNED = [
  null,
  null,
  [6, 13, 0, 0],
  [18, 18, 0, 0],
  [13, 4, 0, 0],
  [9, 13, 0, 0],
  [4, 4, 0, 0],
  [4, 6, 0, 0],
  [4, 9, 0, 16],
  [4, 6, 0, 0],
  [4, 4, 0, 0],
  [4, 4, 0, 16],
  [4, 4, 0, 0],
  [4, 6, 0, 0],
  [4, 13, 6, 0],
  [18, 9, 0, 0],
  [6, 6, 0, 0],
  [4, 9, 0, 0],
  [4, 6, 6, 0],
  [6, 6, 0, 0],
];

function runPolicy(level, seed, decide, hz = 30) {
  const { g } = open(level, { seed });
  const dt = 1 / hz;
  let t = 0;
  for (let f = 0; t < MAX_SECONDS; f++) {
    const st = decide.blind && f % 30 !== 0 ? null : g.getState();
    if (st && (st.phase !== 'playing' || st.level !== level)) return WIN(st, level);
    g.update(dt, input([], decide(st, t, f)));
    t += dt;
  }
  return false;
}
function wins(level, make, seeds, first = 1) {
  let n = 0;
  for (let s = first; s < first + seeds; s++) if (runPolicy(level, s, make(s))) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Scripted solutions: one per level, frame/key pairs at 60 Hz after the level opens.
// ---------------------------------------------------------------------------------------------
const SOLUTIONS = [
  '266S 766S 1266S 1766S',
  '230S 730S 1230S 1730S 2230S',
  '362S 862S 2262S 2762S 3262S',
  '380S 1438S 2196S 3122S',
  '386S 1438S 2052S 2552S 3094S 3594S',
  '242S 742S 1398S 2210S 2746S 3246S',
  '164S 1096S 1596S 2096S 2596S 3516S',
  '866S 1366X 1980S 2558X 3682S',
  '320S 958X 1716S 2246S 2914X 3528S',
  '290S 1222S 2040S 2540S 3178S',
  '164S 874S 1374S 1874S 2374S',
  '314S 1156X 1770S 2336X 3226S',
  '284S 784S 1860S 2360S 2860S 3360S 4208S',
  '254S 292R 300S 1382L 1390S 1614R 1622S 2044L 2052S 2366R 2374S 2550L 2558S 3106R 3114S 3290L 3298S 3612R 3620S 3796L 3804S',
  '296R 304S 438L 446S 1438S 1656R 1664S 1954L 1962S 2252R 2260S 2760S 2798L 2806S 3258R 3266S 3406L 3414S',
  '212S 538R 546S 1022L 1030S 1122R 1130S 1528L 1536S 1946R 1954S 2724L 2732S 3232S 3522R 3530S 3748L 3756S 4046R 4054S',
  '158R 166S 294L 302S 664R 672S 800L 808S 1170R 1178S 1306L 1314S 1760R 1768S 1890L 1898S 2266R 2274S 2774S 2932L 2940S 3272R 3280S 3438L 3446S 3946S 4032R 4040S 4444L 4452S 4538R 4546S 5046S 5084L 5092S 5550R 5558S',
  '224R 232S 312L 320S 796R 804S 890L 898S 1536X 1664R 1672X 2286S 2438L 2446S 2784R 2792S 3142L 3150S 3290R 3298S 3648L 3656S 3874R 3882X',
  '242S 280R 288S 740L 748S 816R 824S 1336L 1344S 1844S 1990R 1998S 2648S 2950L 2958S 3176R 3184S 3474L 3482S 3970R 3978S 3986L 3994S',
  '176S 310R 318S 818S 1108L 1116S 1688R 1696X 1734L 1742X 2314R 2322S 2360L 2368S 3144S 3182R 3190S 3642L 3650S 4090R 4098X 4148L 4156S 4656X 4712R 4720S 5220S 5270L 5278S 5748R 5756S',
];

const parse = (script) =>
  script.split(' ').map((tok) => ({ frame: Number.parseInt(tok, 10), key: CODE[tok.slice(-1)] }));

function replay(level, hz = 60) {
  const { g } = open(level);
  const events = parse(SOLUTIONS[level - 1]);
  let strikes = 0;
  let st = g.getState();
  for (let i = 0; i / hz < MAX_SECONDS; i++) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    strikes = Math.max(strikes, st.strikes);
    const keys = events.filter((e) => Math.round((e.frame * hz) / 60) === i).map((e) => e.key);
    g.update(1 / hz, input([], keys));
  }
  st = g.getState();
  return { st, strikes, cleared: WIN(st, level) };
}

test('quality: there is one scripted solution per level, in order, on even frames', () => {
  assert.equal(SOLUTIONS.length, LEVEL_COUNT);
  assert.ok(LEVEL_COUNT >= 20 && LEVELS.length === LEVEL_COUNT);
  SOLUTIONS.forEach((script, i) => {
    const frames = parse(script).map((e) => e.frame);
    assert.ok(frames.length >= 3, `level ${i + 1} has keys`);
    assert.ok(
      frames.every((f, n) => n === 0 || f > frames[n - 1]),
      `level ${i + 1} is ordered`,
    );
    assert.ok(
      frames.every((f) => f % 2 === 0),
      `level ${i + 1} fits every step rate`,
    );
  });
});

test('quality: every level is cleared with no strike by its scripted solution (60 Hz; 30 and 120 Hz sampled)', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const rates = [60, ...(level % 4 === 1 ? [30, 120] : [])];
    for (const hz of rates) {
      const r = replay(level, hz);
      assert.ok(r.cleared, `level ${level} at ${hz} Hz ended ${r.st.phase} on level ${r.st.level}`);
      assert.equal(r.strikes, 0, `level ${level} at ${hz} Hz cost strikes`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Prompt followers. Shifts 1-13 name the next key; from shift 14 the line only names the problem.
// ---------------------------------------------------------------------------------------------
const levelsWhere = (guide) => COMPILED.filter((L) => L.guide === guide).map((L) => L.index + 1);
const EXACT = levelsWhere('exact');
const HINT = levelsWhere('hint');

test('quality: shifts 1-13 name the key and shifts 14-20 only name the problem', () => {
  assert.deepEqual(
    EXACT,
    Array.from({ length: 13 }, (_, i) => i + 1),
  );
  assert.deepEqual(HINT, [14, 15, 16, 17, 18, 19, 20]);
  for (const level of [3, 8, 13, ...HINT]) {
    const kinds = new Set();
    const presses = new Set();
    play({
      level,
      hz: 30,
      decide: scout(0.3),
      onFrame: (st) => {
        if (!st.prompt) return;
        kinds.add(st.prompt.kind);
        presses.add(st.prompt.press);
        if (st.prompt.kind === 'hint') {
          assert.ok(!/\b(press|space|select)\b/i.test(st.prompt.en), st.prompt.en);
          assert.ok(!/按|选择/.test(st.prompt.zh), st.prompt.zh);
        }
      },
    });
    if (HINT.includes(level)) {
      assert.ok(kinds.has('hint'), `level ${level} shows hints`);
      assert.ok(!kinds.has('phase') && !kinds.has('select') && !kinds.has('ped'), `level ${level}`);
      assert.deepEqual([...presses], [null], `level ${level} names no key`);
    } else {
      assert.ok(kinds.has('phase'), `level ${level} names the move`);
      assert.ok(!kinds.has('hint'));
    }
  }
});

test('quality: a literal prompt follower at lag 0 and 0.25 s clears the teaching shifts and cannot win the mastery shifts', () => {
  for (const lag of [0, 0.25]) {
    let cleared = 0;
    let strikes = 0;
    const failed = [];
    for (const level of EXACT) {
      const r = play({ level, seed: 1, decide: follower(lag) });
      if (r.cleared) cleared++;
      else failed.push(level);
      strikes += r.strikes;
    }
    assert.ok(
      cleared >= EXACT.length - 2,
      `lag ${lag}: ${rate(cleared, EXACT.length)}, failed ${failed}`,
    );
    assert.ok(strikes <= 5, `lag ${lag}: ${strikes} prompt-led strikes`);
  }
  // Without a key on the screen the follower has nothing to press, so it wins no mastery shift.
  for (const level of HINT)
    assert.equal(play({ level, hz: 30, decide: follower(0.1) }).cleared, false, `level ${level}`);
});

test('quality: the follower also clears the Chinese interface and a naive repeat-the-key follower', () => {
  for (const level of [3, 8, 12]) {
    const zh = play({ level, lang: 'zh', hz: 30, decide: follower(0.2) });
    assert.ok(zh.cleared, `zh level ${level}`);
  }
  let cleared = 0;
  for (const level of EXACT)
    if (play({ level, hz: 30, decide: naiveFollower(0.25) }).cleared) cleared++;
  assert.ok(cleared >= EXACT.length - 3, `naive follower cleared ${cleared}/${EXACT.length}`);
});

// Sampled seeds keep the suite fast; the hand-off reports the full 30-seed numbers.
const SAMPLE = FULL ? 30 : 6;
const FAST_MIN = FULL ? 24 : SAMPLE - 2;
const SLOW_MIN = FULL ? 22 : SAMPLE - 2;
for (const [name, range, min] of [
  ['fast followers (0.15-0.35 s)', FAST, FAST_MIN],
  ['slow followers (0.4-0.6 s)', SLOW, SLOW_MIN],
])
  test(`quality: ${name} clear the required share of runs on every teaching shift`, () => {
    const low = [];
    for (const level of EXACT) {
      let n = 0;
      for (let seed = 1; seed <= SAMPLE; seed++)
        if (play({ level, seed, hz: 30, decide: follower(lagFor(range, seed)) }).cleared) n++;
      if (n < min) low.push(`level ${level}: ${rate(n, SAMPLE)}`);
    }
    assert.deepEqual(low, []);
  });

test('quality: the prompt is held for at least half a second and never flickers', () => {
  for (const level of [1, 6, 9, 14, 20]) {
    let key = null;
    let since = 0;
    let pressedBefore = true;
    const changes = [];
    play({
      level,
      hz: 60,
      decide: level >= 14 ? scout(0.2) : follower(0.2),
      onFrame: (st, t, keys) => {
        const p = st.prompt;
        const now = p ? `${p.kind}|${p.en}` : null;
        if (now !== key) {
          const held = t - since;
          if (key && held < 0.49 && !pressedBefore) changes.push(`${held.toFixed(2)}s ${key}`);
          key = now;
          since = t;
        }
        pressedBefore = keys.length > 0;
      },
    });
    assert.deepEqual(changes, [], `level ${level} prompt flickered`);
  }
});

// ---------------------------------------------------------------------------------------------
// Fairness: a player who reads only the board, with no help from the prompt
// ---------------------------------------------------------------------------------------------
const SCOUT_SEEDS = FULL ? 12 : 8;
const sweep = (lag, seeds, hz = 30) =>
  COMPILED.map((L) => {
    const runs = [];
    for (let seed = 1; seed <= seeds; seed++)
      runs.push(play({ level: L.index + 1, seed, hz, decide: scout(lag) }));
    const won = runs.filter((r) => r.cleared);
    return {
      level: L.index + 1,
      rate: won.length / seeds,
      strikes: runs.reduce((n, r) => n + r.strikes, 0) / seeds,
      left: won.reduce((n, r) => n + r.left, 0) / Math.max(1, won.length),
    };
  });
const mean = (rows, field) => rows.reduce((n, r) => n + r[field], 0) / rows.length;

test('quality: a scout that ignores the prompt clears at least 75% of runs on every shift at 0.35 s and 0.25 s reaction time', () => {
  const rows = sweep(0.35, SCOUT_SEEDS);
  const low = rows.filter((r) => r.rate < 0.75).map((r) => `L${r.level} ${r.rate.toFixed(2)}`);
  assert.deepEqual(low, []);
  const quick = sweep(0.25, FULL ? 12 : 4).filter((r) => r.rate < 0.75);
  assert.deepEqual(
    quick.map((r) => `L${r.level} ${r.rate.toFixed(2)}`),
    [],
  );
  // The mastery shifts leave the scout less spare time than the combination shifts do.
  const combo = rows.filter((r) => r.level >= 8 && r.level <= 13);
  const mastery = rows.filter((r) => r.level >= 15);
  assert.ok(
    mean(combo, 'left') - mean(mastery, 'left') >= 1.5,
    `spare time: combination ${mean(combo, 'left').toFixed(1)} s, mastery ${mean(mastery, 'left').toFixed(1)} s`,
  );
});

test('quality: every authored schedule is itself a clean run for the controller, so the fallback is safe', () => {
  const checks = [
    [0.6, 30],
    [0, 60],
    [0.3, 120],
  ];
  for (const L of COMPILED) {
    const sched = buildSchedule(L, seeded(L.seed));
    for (const [lag, hz] of checks) {
      const s = runPrompted(L, sched, lag, hz);
      assert.ok(
        s.phase === 'cleared' && s.strikes === 0 && s.w.t <= L.time - L.spare,
        `level ${L.index + 1} at lag ${lag}, ${hz} Hz ended ${s.phase} with ${s.strikes} strikes`,
      );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Depth: crude players lose, a tuned fixed plan is not enough, a sensible player is not enough
// ---------------------------------------------------------------------------------------------
test('quality: standing idle never wins a level', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++)
    assert.equal(
      wins(level, () => blind(() => []), 2),
      0,
      `level ${level}`,
    );
});

const PROBE = FULL ? 40 : 12;
test('quality: from level 3 on, mashing, random keys, fixed-time cycling and X spam win at most a quarter of runs', () => {
  const rows = {};
  for (let level = 3; level <= LEVEL_COUNT; level++)
    for (const [name, make] of Object.entries(PLAYERS)) {
      const n = wins(level, make, PROBE);
      if (n > PROBE / 4) (rows[name] ??= []).push(`L${level} ${rate(n, PROBE)}`);
    }
  assert.deepEqual(rows, {});
});

test('quality: a fixed plan tuned per level beats at most half the levels from level 3 and at most 2 of levels 14-20', () => {
  const n = FULL ? 40 : 6;
  const beaten = [];
  for (let level = 3; level <= LEVEL_COUNT; level++) {
    const [a, b, off, xe] = TUNED[level - 1];
    if (wins(level, () => fixedPlan(a, b, off, xe), n) * 2 >= n) beaten.push(level);
  }
  assert.ok(beaten.length <= 9, `tuned plans beat levels ${beaten}`);
  assert.ok(beaten.filter((l) => l >= 14).length <= 2, `tuned plans beat levels ${beaten}`);
});

test('quality: the longest-queue and longest-wait players each win at most half the levels and none of the last third', () => {
  const n = FULL ? 40 : 4;
  for (const [name, make] of Object.entries({ queue: greedy, wait: longestWait })) {
    const beaten = [];
    for (let level = 1; level <= LEVEL_COUNT; level++)
      if (wins(level, make, n) * 2 > n) beaten.push(level);
    assert.ok(beaten.length <= LEVEL_COUNT / 2, `${name} beat levels ${beaten}`);
    assert.deepEqual(
      beaten.filter((l) => l > Math.ceil((LEVEL_COUNT * 2) / 3)),
      [],
      `${name} beat a level in the last third`,
    );
  }
});

test('quality: random draws pass the load-time check on every level, so the authored schedule is only a fallback', () => {
  const tries = FULL ? 16 : 8;
  const fallbacks = [];
  COMPILED.forEach((L, i) => {
    const authored = JSON.stringify(buildSchedule(L, seeded(L.seed)));
    let n = 0;
    for (let s = 1; s <= tries; s++)
      if (JSON.stringify(safeSchedule(L, seeded(s))) === authored) n++;
    // At most 3 draws in 8 may end on the authored schedule.
    if (n > tries * 0.375) fallbacks.push(`L${i + 1} ${rate(n, tries)}`);
  });
  assert.deepEqual(fallbacks, []);
});

test('quality: the early levels teach and the finale is harder than the first level', () => {
  assert.ok(wins(1, PLAYERS.mash, 4) >= 3);
  assert.equal(wins(LEVEL_COUNT, PLAYERS.mash, 4), 0);
  assert.ok(LEVELS[LEVEL_COUNT - 1].time > LEVELS[0].time);
  assert.ok(RULES.lives === 3);
});
