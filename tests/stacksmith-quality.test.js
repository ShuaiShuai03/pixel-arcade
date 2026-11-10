import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, KINDS, LEVELS, RULES } from '../src/games/stacksmith.js';
import { harness, input, seeded } from './harness.js';

const COUNT = LEVELS.length;
const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const SEEDS = 10;

function begin(level, seed = 1, lang = 'en') {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// The keys a player presses for the prompt line they read.
function keysFor(line) {
  if (/^Move →/.test(line)) return ['ArrowRight'];
  if (/^Move ←/.test(line)) return ['ArrowLeft'];
  if (/^Press Space/.test(line)) return ['Space'];
  if (/^Press X/.test(line)) return ['KeyX'];
  return [];
}

const isOutline = (level) => LEVELS[level - 1].aim === 'outline';

// What a player who has matched the loads to their outlines does on an outline job. The prompt names no
// direction there, so this player steers toward the planned spot from what they see (the hook, the
// trolley and the preview), eases off near it, and drops once the prompt says the load is calm.
function outlineKeys(level, seen, lag = 0) {
  if (!seen.hook) return [];
  const [kind, x] =
    LEVELS[level - 1].plan[Math.min(seen.plan.step, LEVELS[level - 1].plan.length - 1)];
  if (seen.hook.kind !== kind && seen.swapsLeft > 0 && seen.queue[0] === kind) return ['KeyX'];
  // where the hook hangs when the trolley stands still (the wind leans it), and what the preview says
  const rest = seen.crane.x + RULES.rope * Math.sin(Math.atan(seen.wind / RULES.gravity));
  const e = x - rest;
  const settled = Math.abs(e) <= 2 && Math.abs(seen.crane.v) < 1;
  if (settled) {
    // the player knows how late they are and leads the moving preview by that much
    const lands = (seen.guide.landing ? seen.guide.landing.x : seen.hook.x) + seen.hook.vx * lag;
    return seen.prompt.id === 'aim' && Math.abs(lands - x) <= 3 ? ['Space'] : [];
  }
  const toward = Math.sign(seen.crane.v) === Math.sign(e);
  const cap = Math.max(RULES.creepSpeed, RULES.creepGain * Math.abs(e));
  // a key lifted now still carries the trolley on for the player's own lag plus the braking distance
  const reach =
    Math.abs(seen.crane.v) * lag + (seen.crane.v * seen.crane.v) / (2 * RULES.trolleyBrake);
  const braking = toward && reach >= Math.abs(e);
  if (Math.abs(e) > 1.5 && !braking && (!toward || Math.abs(seen.crane.v) < cap))
    return [e > 0 ? 'ArrowRight' : 'ArrowLeft'];
  return [];
}

// A literal player. It reads only what the host shows `delay` seconds late, with jitter that never runs
// backwards: the prompt line, and on outline jobs also the hook and the trolley. It presses what it reads.
function humanRun(
  level,
  hz,
  { delay = FAST, seed = 1, seconds = 600, jitter = 0.1, wobble = null } = {},
) {
  const { g, h } = begin(level, seed);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const idle = rnd() * 12;
  const history = [];
  let tries = RULES.tries;
  let t = 0;
  let extra = null;
  let latest = 0;
  for (; t < seconds; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    tries = st.tries;
    history.push({ t, line: st.line.en, st });
    if (history.length > 500) history.shift();
    latest = Math.max(latest, t - Math.max(0, base + (rnd() - 0.5) * jitter));
    let k = history.length - 1;
    while (k > 0 && history[k].t > latest) k--;
    // the player starts reading the screen at a random moment, so every phase of the swing and sea is met
    let held =
      t < idle
        ? []
        : isOutline(level)
          ? outlineKeys(level, history[k].st, base)
          : keysFor(history[k].line);
    if (wobble) {
      // finger noise: a stray tap of the wrong arrow now and then, and a hand that lifts early
      if (extra && t < extra.until) held = [...held, extra.key];
      else if (rnd() < wobble / hz)
        extra = { key: rnd() < 0.5 ? 'ArrowLeft' : 'ArrowRight', until: t + 0.08 };
      if (held.length === 1 && held[0].startsWith('Arrow') && rnd() < wobble / hz) held = [];
    }
    g.update(1 / hz, input(held, []));
  }
  const st = g.getState();
  return {
    st,
    t,
    h,
    tries: Math.min(tries, st.tries),
    cleared: st.level > level || st.phase === 'won',
  };
}

function rates(delay, minWins) {
  const report = [];
  for (let level = 1; level <= COUNT; level++) {
    let wins = 0;
    const why = [];
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = humanRun(level, hz, { delay, seed: seed + level * 100 });
        if (r.cleared) wins++;
        else why.push(`${hz}Hz/s${seed}:${r.st.phase}/t${Math.round(r.t)}`);
      }
    report.push(`${level}:${wins}`);
    assert.ok(wins >= minWins, `job ${level}: ${wins}/30 (${report.join(' ')}) ${why.join(' ')}`);
  }
  return report;
}

test('a prompt-following player (0.15-0.35 s lag) clears every job in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-job wins, fast: ${rates(FAST, 27).join(' ')}`);
});

test('a slow prompt-following player (0.4-0.6 s lag) clears every job in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-job wins, slow: ${rates(SLOW, 24).join(' ')}`);
});

test('a literal follower at lag 0 and at 0.25 s clears every job on the first try in at least 18 of 20 runs', () => {
  const report = [];
  for (let level = 1; level <= COUNT; level++)
    for (const lag of [0, 0.25]) {
      let clean = 0;
      let runs = 0;
      for (const hz of HZS)
        for (let seed = 1; seed <= (hz === 60 ? 7 : 7); seed++) {
          const r = humanRun(level, hz, { delay: [lag, lag], jitter: 0, seed: seed + level * 31 });
          runs++;
          if (r.cleared && r.tries === RULES.tries) clean++;
          if (lag === 0)
            assert.ok(
              r.cleared && r.tries === RULES.tries,
              `job ${level} @${hz} Hz lag 0 lost a try`,
            );
        }
      report.push(`${level}@${lag}:${clean}/${runs}`);
      assert.ok(clean >= 18, `job ${level} lag ${lag}: ${clean}/${runs} (${report.join(' ')})`);
    }
  console.log(`first-try clears: ${report.join(' ')}`);
});

test('a follower 0.5 s late still clears every marked job, at least 5 in 6 runs of each outline job, and loses a try in at most 1 run in 12', () => {
  let lost = 0;
  let runs = 0;
  for (let level = 1; level <= COUNT; level++) {
    let wins = 0;
    let n = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= 4; seed++) {
        const r = humanRun(level, hz, { delay: [0.5, 0.5], jitter: 0, seed: seed + level * 17 });
        runs++;
        n++;
        if (r.cleared) wins++;
        else if (!isOutline(level)) assert.fail(`job ${level} @${hz} Hz seed ${seed}`);
        if (r.tries < RULES.tries) lost++;
      }
    // outline jobs have no marker to hold the trolley still for the player, so a slow hand may miss a swell
    assert.ok(wins / n >= (isOutline(level) ? 5 / 6 : 1), `job ${level}: ${wins}/${n}`);
  }
  console.log(`lag 0.5 s: ${lost}/${runs} runs lost a try`);
  assert.ok(lost / runs <= 1 / 12, `${lost}/${runs} runs lost a try at lag 0.5 s`);
});

test('the prompt never leads a literal follower into a failure or a livelock: every clear is timely', () => {
  for (let level = 1; level <= COUNT; level++) {
    const r = humanRun(level, 60, { delay: [0.3, 0.3], jitter: 0, seed: level });
    assert.ok(r.cleared);
    assert.equal(r.tries, RULES.tries);
    assert.ok(r.t < 14 * LEVELS[level - 1].plan.length + 40, `job ${level} took ${r.t}s`);
  }
});

test('input noise: stray arrow taps and early lifts (about one per two seconds) still leave 90% of jobs clearable', () => {
  let wins = 0;
  let runs = 0;
  for (let level = 1; level <= COUNT; level++)
    for (let seed = 1; seed <= 4; seed++) {
      runs++;
      if (humanRun(level, 60, { delay: [0.2, 0.3], seed: seed + level * 9, wobble: 0.5 }).cleared)
        wins++;
    }
  console.log(`noisy followers: ${wins}/${runs}`);
  assert.ok(wins / runs >= 0.9, `${wins}/${runs}`);
});

test('every prompt line is held at least half a second, names an action or a state and fits the canvas', () => {
  let changes = 0;
  let minHold = Infinity;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 3, 5, 7, 10, 14, 17, 19, 22])
      for (const hz of [30, 120]) {
        const { g } = begin(level, level, lang);
        let last = null;
        let changedAt = 0;
        let tries = RULES.tries;
        let acts = 0;
        for (let t = 0; t < 150; t += 1 / hz) {
          const st = g.getState();
          if (st.level !== level || st.phase !== 'playing') break;
          const line = st.line.en;
          assert.ok(st.line.zh && /[一-鿿]/.test(st.line.zh), st.line.zh);
          assert.ok(line.length <= 50, line);
          const width = [...st.line.zh].reduce(
            (n, ch) => n + (/[一-鿿！？，：（）]/.test(ch) ? 14 : 8),
            0,
          );
          assert.ok(width <= 440 && line.length * 8.4 <= 440, `"${line}" too wide`);
          assert.ok(st.status[lang].endsWith(st.line[lang]));
          assert.ok(
            !/\d/.test(line.replace('Press X', '').replace('3 seconds', '')),
            `no changing digits: ${line}`,
          );
          // a release or swap makes the old instruction obsolete, so it is replaced at once
          if (
            st.tries !== tries ||
            st.mode !== 'play' ||
            st.stats.drops + st.stats.swaps !== acts
          ) {
            tries = st.tries;
            acts = st.stats.drops + st.stats.swaps;
            last = null;
          }
          if (line !== last) {
            if (last !== null) {
              minHold = Math.min(minHold, t - changedAt);
              assert.ok(
                t - changedAt >= 0.5 - 1e-6,
                `"${last}" -> "${line}" after ${t - changedAt}s`,
              );
              changes++;
            }
            last = line;
            changedAt = t;
          }
          g.update(1 / hz, input(isOutline(level) ? outlineKeys(level, st) : keysFor(line), []));
        }
      }
  assert.ok(changes > 100, `only ${changes} prompt changes observed`);
  assert.ok(minHold >= 0.5 - 1e-6);
});

test('the drop guide always agrees with the prompt: arrow direction, mark position and predicted landing (outline jobs show none)', () => {
  let checked = 0;
  for (let level = 1; level <= COUNT; level++) {
    const { g } = begin(level, 3);
    const rough = Boolean(LEVELS[level - 1].wind || LEVELS[level - 1].sea);
    for (let i = 0; i < 60 * 70; i++) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      // right after a release the old line is held for its minimum time while the hook is empty
      if (st.hook && isOutline(level)) {
        // outline jobs name no spot: no x, no arrow, but the preview is always on
        assert.equal(st.guide.x, null, `job ${level}: ${st.line.en}`);
        assert.equal(st.guide.dir, 0);
        assert.ok(st.guide.landing && Number.isFinite(st.guide.landing.x), `job ${level} landing`);
        checked++;
      } else if (st.hook && /^(Move|Press Space|Let the swing)/.test(st.line.en)) {
        assert.ok(
          st.guide && Number.isFinite(st.guide.x),
          `job ${level}: ${st.line.en} without a guide`,
        );
        assert.ok(st.guide.x >= RULES.trolleyMin && st.guide.x <= RULES.trolleyMax);
        const drop = /^Press Space/.test(st.line.en);
        if (drop || !rough)
          assert.ok(
            st.guide.landing && Number.isFinite(st.guide.landing.x),
            `job ${level} landing`,
          );
        else
          assert.equal(
            st.guide.landing,
            null,
            `job ${level}: landing leaks outside the drop state`,
          );
        checked++;
      }
      const m = st.hook && /^Move ([←→])/.exec(st.line.en);
      if (m) assert.equal(st.guide.dir, m[1] === '→' ? 1 : -1);
      if (st.hook && /^Press Space/.test(st.line.en))
        assert.ok(Math.abs(st.guide.landing.x - st.guide.x) < 10);
      g.update(1 / 60, input(isOutline(level) ? outlineKeys(level, st) : keysFor(st.line.en), []));
    }
  }
  assert.ok(checked > 3000);
});

// --- Depth ---

const K = ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX'];
const aimAt = (g, pick) => () => {
  const s = g.getState();
  if (!s.hook) return [];
  const tx = pick(s);
  const d = tx - s.hook.x;
  if (Math.abs(d) > 3) return [d > 0 ? 'ArrowRight' : 'ArrowLeft'];
  return Math.abs(s.hook.vx) < 5 && s.quiet ? ['Space'] : [];
};
const centreOfMass = (s) =>
  s.bodies.length
    ? s.bodies.reduce((a, b) => a + b.x * b.mass, 0) / s.bodies.reduce((a, b) => a + b.mass, 0)
    : 240;

const POLICIES = {
  idle: { make: () => () => [], seconds: 40 },
  mash: { make: () => (t) => (Math.floor(t * 8) % 2 ? ['Space'] : []) },
  holdRight: { make: () => () => ['ArrowRight'], seconds: 40 },
  holdLeft: { make: () => () => ['ArrowLeft'], seconds: 40 },
  holdRightMash: { make: () => (t) => ['ArrowRight', ...(Math.floor(t * 4) % 2 ? ['Space'] : [])] },
  sweep: {
    make: () => (t) => [
      Math.floor(t / 3) % 2 ? 'ArrowLeft' : 'ArrowRight',
      ...(Math.floor(t * 2) % 3 === 0 ? ['Space'] : []),
    ],
  },
  randomKeys: {
    seeds: 30,
    make: (seed) => {
      const r = seeded(seed);
      let until = 0;
      let keys = [];
      return (t) => {
        if (t >= until) {
          until = t + 0.2 + r() * 1.2;
          keys = K.filter(() => r() < 0.3);
        }
        return keys;
      };
    },
  },
  randomTap: {
    seeds: 30,
    make: (seed) => {
      const r = seeded(seed);
      let until = 0;
      let keys = [];
      return (t) => {
        if (t >= until) {
          until = t + 0.05 + r() * 0.4;
          keys = r() < 0.5 ? [K[Math.floor(r() * 4)]] : [];
        }
        return keys;
      };
    },
  },
  // Aims at a random spot, waits for calm, drops: patient but blind.
  randomSpot: {
    seeds: 20,
    make: (seed, g) => {
      const r = seeded(seed);
      let tx = 150 + r() * 180;
      let had = false;
      return () => {
        const s = g.getState();
        if (!s.hook) {
          had = false;
          return [];
        }
        if (!had) {
          tx = 150 + r() * 180;
          had = true;
        }
        return aimAt(g, () => tx)();
      };
    },
  },
};
// The naive expert: drop when the load is centred over the stack (or the quay centre when there is none).
const SMART = {
  centredMass: (g) => aimAt(g, centreOfMass),
  centredTop: (g) =>
    aimAt(g, (s) => (s.bodies.length ? s.bodies.reduce((a, b) => (b.y < a.y ? b : a)).x : 240)),
  centredQuay: (g) => aimAt(g, () => 240),
  centredHere: (g) => {
    let home = null;
    return () => {
      const s = g.getState();
      if (home === null && s.hook) home = s.hook.x;
      return aimAt(g, (st) => (st.bodies.length ? centreOfMass(st) : home))();
    };
  },
};

test('crude policies fail: from job 3 on none clears more than 25% of runs, and idle never wins', () => {
  const table = [];
  for (const [name, { make, seeds = 1, seconds }] of Object.entries(POLICIES)) {
    const wins = [];
    for (let level = 1; level <= COUNT; level++) {
      let won = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const fresh = begin(level, seed);
        const policy = make(seed * 31 + level, fresh.g);
        const ok = (() => {
          for (let f = 0; f < (seconds || 200) * 30; f++) {
            if (f % 15 === 0) {
              const st = fresh.g.getState();
              if (st.phase !== 'playing' || st.level !== level) break;
            }
            fresh.g.update(1 / 30, input(policy(f / 30), []));
          }
          const st = fresh.g.getState();
          return st.level > level || st.phase === 'won';
        })();
        if (ok) won++;
      }
      wins.push(won);
      if (level >= 3)
        assert.ok(won / seeds <= 0.25, `${name} clears job ${level} in ${won}/${seeds} runs`);
      if (name === 'idle') assert.equal(won, 0, `idle won job ${level}`);
    }
    table.push(`${name.padEnd(13)} ${wins.map((w, i) => `${i + 1}:${w}`).join(' ')} (of ${seeds})`);
  }
  console.log(`crude policies, wins per job:\n  ${table.join('\n  ')}`);
});

test('the "centre it over the stack" heuristic wins at most half the jobs and none of the last third', () => {
  const lastThird = COUNT - Math.floor(COUNT / 3);
  const table = [];
  for (const [name, make] of Object.entries(SMART)) {
    const won = [];
    for (let level = 1; level <= COUNT; level++) {
      const { g } = begin(level, 1);
      const policy = make(g);
      for (let f = 0; f < 240 * 30; f++) {
        if (f % 15 === 0) {
          const st = g.getState();
          if (st.phase !== 'playing' || st.level !== level) break;
        }
        g.update(1 / 30, input(policy(f / 30), []));
      }
      const st = g.getState();
      if (st.level > level || st.phase === 'won') won.push(level);
    }
    table.push(`${name}: ${won.join(',') || 'none'}`);
    assert.ok(won.length <= COUNT / 2, `${name} wins ${won.length} of ${COUNT}`);
    assert.ok(
      won.every((l) => l < lastThird),
      `${name} wins a job in the last third: ${won}`,
    );
  }
  console.log(`smart heuristics win: ${table.join(' | ')}`);
});

// No-prompt readers of the drawn silhouette only: lowest unmet goal first, steer, wait for calm, drop.
function silhouettePolicy(variant, g, r) {
  const tol = 2 + r() * 3;
  const slow = 3 + r() * 4;
  const target = (st) => {
    const unmet = st.goals.filter((x) => !x.met);
    if (!unmet.length) return 240;
    const centre = (x) => x.x + x.w / 2;
    const near = (a, b) => Math.abs(centre(a) - st.hook.x) - Math.abs(centre(b) - st.hook.x);
    if (variant === 'near') return centre([...unmet].sort(near)[0]);
    const floor = Math.max(...unmet.map((x) => x.y + x.h));
    const low = unmet.filter((x) => x.y + x.h >= floor - 1);
    if (variant === 'fit') {
      const w = KINDS[st.hook.kind].w;
      low.sort((a, b) => Math.abs(a.w - w) - Math.abs(b.w - w) || near(a, b));
    } else low.sort(near);
    return centre(low[0]);
  };
  return () => {
    const st = g.getState();
    if (!st.hook || st.mode !== 'play') return [];
    const tx = target(st);
    if (Math.abs(tx - st.hook.x) < tol && Math.abs(st.hook.vx) < slow)
      return st.quiet ? ['Space'] : [];
    const ex = tx - st.crane.x;
    return Math.abs(ex) > 1.5 ? [ex > 0 ? 'ArrowRight' : 'ArrowLeft'] : [];
  };
}

test('policies that read only the drawn silhouette (lowest goal first, best-fitting width, nearest goal) clear at most 11 jobs and at most one of the last third', () => {
  const lastThird = COUNT - Math.floor(COUNT / 3);
  for (const variant of ['col', 'fit', 'near']) {
    const row = [];
    const strong = [];
    for (let level = 1; level <= COUNT; level++) {
      let won = 0;
      const runs = 10;
      for (let seed = 1; seed <= runs; seed++) {
        const { g } = begin(level, seed);
        const policy = silhouettePolicy(variant, g, seeded(seed * 97 + level * 13));
        for (let f = 0; f < 300 * 30; f++) {
          if (f % 15 === 0) {
            const st = g.getState();
            if (st.phase !== 'playing' || st.level !== level) break;
          }
          g.update(1 / 30, input(policy(), []));
        }
        const st = g.getState();
        if (st.level > level || st.phase === 'won') won++;
      }
      row.push(`${level}:${won * 10}`);
      if (won >= runs / 2) strong.push(level);
    }
    console.log(`${variant}: ${row.join(' ')} | >=50%: ${strong.length}`);
    assert.ok(strong.length <= 11, `${variant} clears ${strong.length} jobs: ${strong}`);
    // the outlines are now the load's own footprint, so a width-matching reader may get one late job
    assert.ok(
      strong.filter((l) => l >= lastThird).length <= 1,
      `${variant} clears late jobs: ${strong}`,
    );
  }
});

// K2: a kind-matching reader of the drawn silhouette. It sees the pictured kind in every unmet goal, knows
// what is already supported, places the hooked load on a supported goal of its own kind, swaps when the
// next load would fit, dumps loads that have no goal, and releases on the hook's own position once calm.
function kindMatcher(g, r) {
  const tol = 2 + r() * 2.5;
  const slow = 3 + r() * 3;
  const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1;
  let swapAt = -Infinity;
  return (f) => {
    const st = g.getState();
    if (!st.hook || st.mode !== 'play') return [];
    const tops = st.statics.map((b) => Math.min(...b.verts.map((v) => v[1])));
    const unmet = st.goals.filter((x) => !x.met);
    const supported = (x) => {
      const bottom = x.y + x.h;
      if (tops.some((y) => Math.abs(y - bottom) < 1)) return true;
      return st.goals
        .filter((o) => o !== x && o.y >= bottom - 1 && overlap(o, x))
        .every((o) => o.met);
    };
    const pick = (list) =>
      [...list].sort(
        (a, b) => b.y + b.h - (a.y + a.h) || Math.abs(a.x - st.hook.x) - Math.abs(b.x - st.hook.x),
      )[0];
    const ok = unmet.filter(supported);
    const hook = st.hook.kind;
    let aim;
    const mine = ok.filter((x) => x.kind === hook);
    if (mine.length) aim = pick(mine);
    else if (st.swapsLeft > 0 && st.queue.length && ok.some((x) => x.kind === st.queue[0]))
      aim = 'swap';
    else if (!unmet.some((x) => x.kind === hook)) aim = { x: 140, w: 0 };
    else if (st.swapsLeft > 0 && st.queue.length) aim = 'swap';
    else aim = pick(unmet.filter((x) => x.kind === hook));
    if (aim === 'swap') return f - swapAt > 60 ? ((swapAt = f), ['KeyX']) : [];
    const tx = aim.x + aim.w / 2;
    if (Math.abs(tx - st.hook.x) < tol && Math.abs(st.hook.vx) < slow && st.quiet) return ['Space'];
    const ex = tx - st.crane.x;
    return Math.abs(ex) > 1.5 ? [ex > 0 ? 'ArrowRight' : 'ArrowLeft'] : [];
  };
}

test('a kind-matching reader of the silhouette (support-aware, swapping, dumping spares) clears at most half the jobs and at most 4 of the last 8', () => {
  const won = [];
  const row = [];
  for (let level = 1; level <= COUNT; level++) {
    let wins = 0;
    const runs = 8;
    for (let seed = 1; seed <= runs; seed++) {
      const { g } = begin(level, seed);
      const policy = kindMatcher(g, seeded(seed * 53 + level));
      const idle = Math.floor(seeded(seed + level)() * 5 * 60);
      for (let f = 0; f < 300 * 60; f++) {
        if (f % 60 === 0) {
          const st = g.getState();
          if (st.phase !== 'playing' || st.level !== level) break;
        }
        g.update(1 / 60, input(f < idle ? [] : policy(f), []));
      }
      const st = g.getState();
      if (st.level > level || st.phase === 'won') wins++;
    }
    row.push(`${level}:${Math.round((100 * wins) / runs)}`);
    if (wins >= runs / 2) won.push(level);
  }
  console.log(`kind matcher: ${row.join(' ')} | >=50%: ${won.length}`);
  assert.ok(won.length <= COUNT / 2, `K2 clears ${won.length} jobs: ${won}`);
  assert.ok(won.filter((l) => l > COUNT - 8).length <= 4, `K2 clears too many late jobs: ${won}`);
});

// --- Timing, determinism and robustness ---

test('the same key schedule gives the identical outcome at 30, 60 and 120 Hz on every job', () => {
  const keysets = [
    ['ArrowRight'],
    ['ArrowLeft'],
    ['Space'],
    ['KeyX'],
    [],
    ['ArrowRight', 'Space'],
    ['ArrowLeft'],
  ];
  for (let level = 1; level <= COUNT; level++) {
    const run = (hz) => {
      const { g } = begin(level, 4);
      const rnd = seeded(level * 17);
      for (let slot = 0; slot < 120; slot++) {
        const keys = keysets[Math.floor(rnd() * keysets.length)];
        for (let i = 0; i < hz / 6; i++) g.update(1 / hz, input(keys, []));
      }
      return g.getState();
    };
    const a = run(30);
    assert.deepEqual(run(60), a, `job ${level} @60`);
    assert.deepEqual(run(120), a, `job ${level} @120`);
  }
});

test('a followed run is also identical at 30, 60 and 120 Hz when the player reacts on the same schedule', () => {
  for (const level of [1, 6, 12, 20]) {
    const outcome = (hz) => {
      const { g } = begin(level, 8);
      let line = '';
      for (let slot = 0; slot < 6 * 60; slot++) {
        if (slot % 3 === 0) line = g.getState().line.en;
        for (let i = 0; i < hz / 6; i++) g.update(1 / hz, input(keysFor(line), []));
      }
      const st = g.getState();
      return [st.level, st.stats, st.bodies.length, st.loadsLeft];
    };
    assert.deepEqual(outcome(30), outcome(120));
    assert.deepEqual(outcome(60), outcome(120));
  }
});

test('jittered frame times (down to half a frame) still give a stable, finite and bounded game', () => {
  for (const level of [2, 6, 12, 20, 22]) {
    const { g } = begin(level, 2);
    const rnd = seeded(level);
    let keys = [];
    for (let i = 0; i < 6000; i++) {
      const st = g.getState();
      if (i % 40 === 0) keys = keysFor(st.line.en);
      g.update((0.5 + rnd() * 1.5) / 60, input(keys, []));
      if (st.phase !== 'playing') break;
      assert.ok(Number.isFinite(st.crane.x) && Number.isFinite(st.crane.theta));
      assert.ok(Math.abs(st.crane.theta) < 1.2);
      assert.ok(st.crane.x >= RULES.trolleyMin && st.crane.x <= RULES.trolleyMax);
      for (const b of st.bodies) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.angle));
        assert.ok(Math.hypot(b.vx, b.vy) <= 920, `speed ${b.vx},${b.vy}`);
      }
    }
  }
});

test('real play never lets a load tunnel through the quay or sink into another: bodies stay above the quay and apart', () => {
  for (const level of [1, 6, 9, 15, 21]) {
    const { g } = begin(level, 5);
    for (let i = 0; i < 60 * 90; i++) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      for (const b of st.bodies) {
        if (b.x > RULES.quayLeft && b.x < RULES.quayRight)
          assert.ok(
            Math.max(...b.verts.map((v) => v[1])) <= RULES.quayTop + 1.5,
            `level ${level}: a load is inside the quay`,
          );
      }
      g.update(1 / 60, input(keysFor(st.line.en), []));
    }
  }
});

test('the game is robust to junk input: random keys and pointers for thousands of frames never throw or corrupt the state', () => {
  const codes = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyA',
    'KeyD',
    'Space',
    'KeyX',
    'Enter',
    'KeyZ',
  ];
  for (const level of [1, 8, 22]) {
    const { g, h } = begin(level, 3);
    const rnd = seeded(level + 100);
    let held = [];
    for (let f = 0; f < 4000; f++) {
      if (f % 20 === 0) held = codes.filter(() => rnd() < 0.2);
      g.update(
        rnd() < 0.02 ? 0 : 1 / 60,
        input(held, f % 20 === 0 ? held : [], {
          x: rnd() * 480,
          y: rnd() * 320,
          down: true,
          clicked: f % 90 === 0,
        }),
      );
    }
    const st = g.getState();
    assert.ok(['playing', 'won', 'lost'].includes(st.phase));
    assert.ok(h.ends.length <= 1);
    assert.ok(st.tries >= 0 && st.loadsLeft >= 0 && st.swapsLeft >= 0);
  }
});
