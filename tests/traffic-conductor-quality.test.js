import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_COUNT,
  LEVELS,
  COMPILED,
  RULES,
  buildSchedule,
  createGame,
  safeSchedule,
} from '../src/games/traffic-conductor.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt line, the
// selected junction, the signals, the queues, the pedestrians and the clock. They press only
// public keys.
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
  let t = 0;
  let st = g.getState();
  for (let f = 0; t < MAX_SECONDS; f++) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    strikes = Math.max(strikes, st.strikes);
    const keys = decide(st, t, f);
    onFrame?.(st, t, keys, g);
    g.update(1 / hz, input([], keys));
    t += 1 / hz;
  }
  st = g.getState();
  if (st.level === level) strikes = Math.max(strikes, st.strikes);
  return { st, t, strikes, cleared: WIN(st, level), g, h };
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
  '374S 430R 438S 908L 916S 1044R 1052S 1522L 1530S 1568R 1576S 2076S 2576S 2668L 2676S 3176S',
  '254R 262S 300L 308S 886R 894S 1052L 1060S 1560S 1598R 1606S 2130L 2138S 2218R 2226S 2726S 2764L 2772S 3224R 3232S 3360L 3368S 3730R 3738S',
  '194R 202S 246L 254S 706R 714S 752L 760S 1404R 1412S 1450L 1458S 1910R 1918S 1956L 1964S 2416R 2424S 2462L 2470S 2922R 2930S 3172L 3180S 3428R 3436S 3678L 3686S 3934R 3942S 4184L 4192S 4482R 4490S 4708L 4716S 5048R 5056S',
  '344S 454R 462S 962S 1018L 1026S 1610R 1618X 2070L 2078X 2236R 2244S 2696L 2704S 3204S 3314R 3322S 3918S 3956L 3964X',
  '230S 274R 282S 1064L 1072S 1194R 1202S 1576L 1584S 1700R 1708S 2208S 2336L 2344S 2706R 2714S 3214S 3318L 3326S 3712R 3720S',
  '230S 316R 324S 944L 952S 1170R 1208S 1708X 2010L 2018X 2326R 2334S 2636L 2644S 3150R 3158X 3400L 3408S 3776R 3784S 4284L 4292S 4468R 4476S 4802L 4840X 4974R 4982S',
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
// Prompt followers
// ---------------------------------------------------------------------------------------------
test('quality: a literal prompt follower at lag 0 and 0.25 s clears at least 18 of 20 levels, with no prompt-led strike', () => {
  for (const lag of [0, 0.25]) {
    let cleared = 0;
    let strikes = 0;
    const failed = [];
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const r = play({ level, seed: 1, decide: follower(lag) });
      if (r.cleared) cleared++;
      else failed.push(level);
      strikes += r.strikes;
    }
    assert.ok(cleared >= 18, `lag ${lag}: ${rate(cleared, LEVEL_COUNT)}, failed ${failed}`);
    assert.equal(strikes, 0, `lag ${lag}: prompt-led strikes`);
  }
});

test('quality: the follower also clears the Chinese interface and a naive repeat-the-key follower', () => {
  for (const level of [3, 8, 14, 19]) {
    const zh = play({ level, lang: 'zh', hz: 30, decide: follower(0.2) });
    assert.ok(zh.cleared && zh.strikes === 0, `zh level ${level}`);
  }
  let cleared = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++)
    if (play({ level, hz: 30, decide: naiveFollower(0.25) }).cleared) cleared++;
  assert.ok(cleared >= 17, `naive follower cleared ${cleared}/20`);
});

// Sampled seeds keep the suite fast; the hand-off reports the full 30-seed numbers.
const SAMPLE = FULL ? 30 : 6;
const FAST_MIN = FULL ? 27 : SAMPLE - 1;
const SLOW_MIN = FULL ? 24 : SAMPLE - 1;
test('quality: fast followers (0.15-0.35 s) clear the required share of runs on every level', () => {
  const low = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let n = 0;
    for (let seed = 1; seed <= SAMPLE; seed++)
      if (play({ level, seed, hz: 30, decide: follower(lagFor(FAST, seed)) }).cleared) n++;
    if (n < FAST_MIN) low.push(`level ${level}: ${rate(n, SAMPLE)}`);
  }
  assert.deepEqual(low, []);
});

test('quality: slow followers (0.4-0.6 s) clear the required share of runs on every level', () => {
  const low = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let n = 0;
    for (let seed = 1; seed <= SAMPLE; seed++)
      if (play({ level, seed, hz: 30, decide: follower(lagFor(SLOW, seed)) }).cleared) n++;
    if (n < SLOW_MIN) low.push(`level ${level}: ${rate(n, SAMPLE)}`);
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
      decide: follower(0.2),
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
