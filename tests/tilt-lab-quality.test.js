import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RULES, LAB_COUNT, LABS, planRoute } from '../src/games/tilt-lab.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const SEEDS = 10;
const KEY = { '→': 'ArrowRight', '←': 'ArrowLeft', '↑': 'ArrowUp', '↓': 'ArrowDown' };

function begin(level, seed = 1, lang = 'en') {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

const ARROW_OF = { R: '→', L: '←', U: '↑', D: '↓' };

// From lab 15 the prompt no longer names the roll until a fall or a stall, so a follower there reads
// the board itself: it takes the first roll of the shortest route from where the marble rests and,
// like any player, keeps holding that arrow until the board has tilted far enough.
function reader() {
  let commit = null;
  return (st) => {
    const sign = { R: 1, L: -1, D: 1, U: -1 };
    const along = (dir) => sign[dir] * (dir === 'R' || dir === 'L' ? st.tilt.x : st.tilt.y);
    if (st.prompt.id === 'hold' && commit && along(commit) < RULES.goTilt)
      return `Tilt ${ARROW_OF[commit]}: keep going`;
    if (st.prompt.id !== 'read') {
      commit = null;
      return st.line.en;
    }
    const open = st.gates.reduce((m, g) => (g.open ? m | (1 << g.id) : m), 0);
    const plan = planRoute(
      LABS[st.level - 1],
      Math.floor(st.marble.x / RULES.cell),
      Math.floor((st.marble.y - RULES.top) / RULES.cell),
      open,
    );
    commit = plan ? plan.dir : null;
    return plan ? `Tilt ${ARROW_OF[plan.dir]}: read the board` : st.line.en;
  };
}

// The keys a player does for the prompt they read: an arrow to tilt that way, Space to level, else none.
function keysFor(line) {
  const tilt = /^Tilt ([←→↑↓])/.exec(line);
  if (tilt) return [KEY[tilt[1]]];
  if (/\(Space\)/.test(line)) return ['Space'];
  return [];
}

// A literal player. It reads only the prompt line the host shows (getState().line) `delay`
// seconds late, with jitter, and presses exactly what the line says. It sees nothing else.
function humanRun(level, hz, { delay = FAST, seed = 1, seconds = 240, jitter = 0.1, log } = {}) {
  const { g, h } = begin(level, seed);
  const lineFor = reader();
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const history = [];
  let falls = 0;
  let t = 0;
  for (; t < seconds; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    falls = st.falls;
    history.push({ t, line: lineFor(st) });
    if (history.length > 400) history.shift();
    const seenAt = t - Math.max(0, base + (rnd() - 0.5) * jitter);
    let k = history.length - 1;
    while (k > 0 && history[k].t > seenAt) k--;
    const held = keysFor(history[k].line);
    if (log) log(st, held, t);
    g.update(1 / hz, input(held, []));
  }
  const st = g.getState();
  return {
    st,
    t,
    falls: Math.max(falls, st.falls),
    cleared: st.level > level || st.phase === 'won',
    h,
  };
}

function rates(delay, minWins) {
  const report = [];
  for (let level = 1; level <= LAB_COUNT; level++) {
    let wins = 0;
    const why = [];
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = humanRun(level, hz, { delay, seed: seed + level * 100 });
        if (r.cleared) wins++;
        else why.push(`${hz}Hz/s${seed}:${r.st.phase}/f${r.falls}/t${Math.round(r.t)}`);
      }
    report.push(`${level}:${wins}`);
    assert.ok(wins >= minWins, `lab ${level}: ${wins}/30 (${report.join(' ')}) ${why.join(' ')}`);
  }
  return report;
}

test('a prompt-following player (0.15-0.35 s lag) clears every lab in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-lab wins, fast: ${rates(FAST, 27).join(' ')}`);
});

test('a slow prompt-following player (0.4-0.6 s lag) clears every lab in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-lab wins, slow: ${rates(SLOW, 24).join(' ')}`);
});

test('a literal follower at lag 0 never loses a marble, at lag 0.25 s rarely does and at 0.5 s loses at most 1 run in 12', () => {
  let lost25 = 0;
  let runs25 = 0;
  let lost50 = 0;
  let runs50 = 0;
  let bumps = 0;
  for (let level = 1; level <= LAB_COUNT; level++)
    for (const hz of HZS) {
      const r = humanRun(level, hz, { delay: [0, 0], jitter: 0, seed: level });
      assert.ok(r.cleared, `lab ${level} @${hz} Hz: lag 0 did not clear`);
      assert.equal(r.falls, 0, `lab ${level} @${hz} Hz: lag 0 lost a marble`);
      for (let seed = 1; seed <= 5; seed++) {
        const q = humanRun(level, hz, { delay: [0.25, 0.25], jitter: 0, seed: seed + level * 10 });
        runs25++;
        if (q.falls > 0) lost25++;
        assert.ok(q.cleared, `lab ${level} @${hz} Hz seed ${seed}: lag 0.25 did not clear`);
      }
      for (let seed = 1; seed <= 4; seed++) {
        const q = humanRun(level, hz, { delay: [0.5, 0.5], jitter: 0, seed: seed + level * 10 });
        runs50++;
        if (q.falls > 0) lost50++;
        bumps += q.st.stats.blocks;
        assert.ok(q.cleared, `lab ${level} @${hz} Hz seed ${seed}: lag 0.5 did not clear`);
      }
    }
  console.log(
    `lag 0.25 s: ${lost25}/${runs25} runs lost a marble; lag 0.5 s: ${lost50}/${runs50}, ${bumps} block bumps`,
  );
  assert.ok(lost25 / runs25 <= 0.05, `${lost25}/${runs25} runs lost a marble at lag 0.25 s`);
  assert.ok(lost50 / runs50 <= 1 / 12, `${lost50}/${runs50} runs lost a marble at lag 0.5 s`);
});

test('crossing guards and the pendulum: a follower 0.5 s late never loses a marble or bumps a block', () => {
  for (const level of [11, 16])
    for (const hz of HZS)
      for (let seed = 1; seed <= 20; seed++) {
        const r = humanRun(level, hz, { delay: [0.5, 0.5], jitter: 0, seed });
        assert.ok(r.cleared, `lab ${level} @${hz} Hz seed ${seed}`);
        assert.equal(r.falls, 0, `lab ${level} @${hz} Hz seed ${seed} lost a marble`);
        assert.equal(r.st.stats.blocks, 0, `lab ${level} @${hz} Hz seed ${seed} bumped a block`);
      }
});

test('the prompt never leads a literal follower to a hole or a livelock: lives stay full and every clear is timely', () => {
  for (let level = 1; level <= LAB_COUNT; level++) {
    const r = humanRun(level, 60, { delay: [0.3, 0.3], jitter: 0, seed: level });
    assert.equal(r.st.lives === RULES.lives || r.st.level > level || r.st.phase === 'won', true);
    assert.ok(r.cleared, `lab ${level} not cleared (${r.st.phase}, ${Math.round(r.t)} s)`);
    assert.ok(r.t < 8 * (r.st.par || 1) + 120, `lab ${level} took ${r.t}s`);
  }
});

test('every prompt line is held at least half a second, names a direction or an action and fits the canvas', () => {
  let changes = 0;
  let minHold = Infinity;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 3, 5, 9, 11, 13, 16, 17, 18, 22])
      for (const hz of [30, 120]) {
        const { g } = begin(level, level, lang);
        const lineFor = reader();
        let last = null;
        let changedAt = 0;
        let falls = 0;
        for (let f = 0, t = 0; t < 120; f++, t += 1 / hz) {
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
          if (st.falls !== falls) {
            falls = st.falls;
            last = null; // a fall reloads the line
          }
          if (line !== last) {
            // The verdict on a lab (cleared) or a run (lost) is never held back.
            if (last !== null && st.prompt.id !== 'cleared' && st.prompt.id !== 'lost') {
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
          g.update(1 / hz, input(keysFor(lineFor(st)), []));
        }
      }
  assert.ok(changes > 40, `only ${changes} prompt changes observed`);
  assert.ok(minHold >= 0.5 - 1e-6);
});

test('the guide arrow always agrees with the tilt the prompt asks for', () => {
  const map = { '→': 'R', '←': 'L', '↑': 'U', '↓': 'D' };
  let checked = 0;
  for (let level = 1; level <= LAB_COUNT; level++) {
    const { g } = begin(level, 3);
    const lineFor = reader();
    for (let i = 0; i < 60 * 90; i++) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      const m = /^Tilt ([←→↑↓])/.exec(st.line.en);
      if (m) {
        assert.ok(st.guide, `lab ${level}: a tilt prompt without a guide`);
        assert.equal(st.guide.dir, map[m[1]]);
        checked++;
      }
      g.update(1 / 60, input(keysFor(lineFor(st)), []));
    }
  }
  assert.ok(checked > 1000);
});

test('crude policies fail: per lab, no policy beats 50% from lab 3 on or 25% from lab 5 on, and idle never wins', () => {
  const K = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
  const policies = {
    idle: { make: () => () => [] },
    mash: { make: () => (t) => (Math.floor(t * 8) % 2 ? ['Space'] : []) },
    holdRight: { make: () => () => ['ArrowRight'] },
    holdLeft: { make: () => () => ['ArrowLeft'] },
    holdUp: { make: () => () => ['ArrowUp'] },
    holdDown: { make: () => () => ['ArrowDown'] },
    diagonal: { make: () => () => ['ArrowRight', 'ArrowDown'] },
    cycle: { make: () => (t) => [K[Math.floor(t / 2.5) % 4]] },
    cycleFast: { make: () => (t) => [K[Math.floor(t / 0.7) % 4]] },
    cycleSpace: {
      make: () => (t) => (Math.floor(t / 2.5) % 5 === 4 ? ['Space'] : [K[Math.floor(t / 2.5) % 5]]),
    },
    // Heads for the socket along the larger axis and levels when close: the naive human.
    towardGoal: {
      seeds: 1, // deterministic: the game has no randomness of its own
      make: (seed, g) => {
        let keys = [];
        let next = 0;
        return (t) => {
          if (t < next) return keys;
          next = t + 0.1;
          const s = g.getState();
          const dx = s.goal.x - s.marble.x;
          const dy = s.goal.y - s.marble.y;
          if (Math.hypot(dx, dy) < 40) keys = ['Space'];
          else if (Math.abs(dx) > Math.abs(dy)) keys = [dx > 0 ? 'ArrowRight' : 'ArrowLeft'];
          else keys = [dy > 0 ? 'ArrowDown' : 'ArrowUp'];
          return keys;
        };
      },
    },
    random: {
      seeds: 40,
      make: (seed) => {
        const r = seeded(seed);
        let until = 0;
        let keys = [];
        return (t) => {
          if (t >= until) {
            until = t + 0.2 + r() * 1.2;
            keys = K.filter(() => r() < 0.3);
            if (r() < 0.15) keys = ['Space'];
          }
          return keys;
        };
      },
    },
    randomSlow: {
      seeds: 40,
      seconds: 240,
      make: (seed) => {
        const r = seeded(seed);
        let until = 0;
        let keys = [];
        return (t) => {
          if (t >= until) {
            until = t + 0.5 + r() * 2;
            keys = [K[Math.floor(r() * 4)]];
            if (r() < 0.25) keys = ['Space'];
          }
          return keys;
        };
      },
    },
    randomTap: {
      seeds: 40,
      seconds: 90,
      make: (seed) => {
        const r = seeded(seed);
        let until = 0;
        let keys = [];
        return (t) => {
          if (t >= until) {
            until = t + 0.05 + r() * 0.4;
            keys = r() < 0.5 ? [K[Math.floor(r() * 4)]] : r() < 0.5 ? ['Space'] : [];
          }
          return keys;
        };
      },
    },
  };
  const table = [];
  for (const [name, { make, seeds = 1, seconds = 120 }] of Object.entries(policies)) {
    const wins = [];
    for (let level = 1; level <= LAB_COUNT; level++) {
      let won = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const { g, h } = begin(level, seed);
        const policy = make(seed * 31 + level, g);
        // 30 Hz steps; the game state is only looked at twice a second to see whether it is over.
        for (let f = 0; f < seconds * 30; f++) {
          if (f % 15 === 0) {
            const st = g.getState();
            if (st.phase !== 'playing' || st.level !== level) break;
          }
          g.update(1 / 30, input(policy(f / 30), []));
        }
        const st = g.getState();
        if (st.level > level || st.phase === 'won') won++;
        assert.ok(h.ends.length <= 1);
      }
      wins.push(won);
      const rate = won / seeds;
      if (level >= 3) assert.ok(rate <= 0.5, `${name} clears lab ${level} in ${won}/${seeds} runs`);
      if (level >= 5)
        assert.ok(rate <= 0.25, `${name} clears lab ${level} in ${won}/${seeds} runs`);
      if (name === 'idle') assert.equal(won, 0, `idle won lab ${level}`);
    }
    table.push(`${name.padEnd(10)} ${wins.map((w, i) => `${i + 1}:${w}`).join(' ')} (of ${seeds})`);
  }
  console.log(`crude policies, wins per lab:\n  ${table.join('\n  ')}`);
});

test('the same key schedule gives the identical outcome at 30, 60 and 120 Hz on every lab', () => {
  const keysets = [
    ['ArrowRight'],
    ['ArrowDown'],
    ['Space'],
    ['ArrowLeft', 'ArrowUp'],
    [],
    ['ArrowRight', 'ArrowDown'],
  ];
  for (let level = 1; level <= LAB_COUNT; level++) {
    const run = (hz) => {
      const { g } = begin(level, 4);
      const rnd = seeded(level * 17);
      for (let slot = 0; slot < 90; slot++) {
        const keys = keysets[Math.floor(rnd() * keysets.length)];
        for (let i = 0; i < hz / 6; i++) g.update(1 / hz, input(keys, []));
      }
      return g.getState();
    };
    const a = run(30);
    assert.deepEqual(run(60), a, `lab ${level} @60`);
    assert.deepEqual(run(120), a, `lab ${level} @120`);
  }
});

test('jittered frame times (down to half a frame) still give a stable, finite and bounded game', () => {
  for (const level of [2, 11, 16, 22]) {
    const { g } = begin(level, 2);
    const lineFor = reader();
    const rnd = seeded(level);
    let keys = [];
    for (let i = 0; i < 4000; i++) {
      if (i % 40 === 0) keys = keysFor(lineFor(g.getState()));
      const dt = (0.5 + rnd() * 1.5) / 60;
      g.update(dt, input(keys, []));
      const st = g.getState();
      if (st.phase !== 'playing') break;
      assert.ok(Number.isFinite(st.marble.x) && Number.isFinite(st.marble.y));
      assert.ok(st.marble.speed <= RULES.maxSpeed + 1e-6);
    }
  }
});

// A follower that makes a small cross-axis error on every roll: it taps the perpendicular arrow
// for a random fraction of a degree of tilt (up to `error`) once the marble is moving.
function noisyRun(level, hz, seed, error) {
  const { g } = begin(level, seed);
  const lineFor = reader();
  const rnd = seeded(seed * 17 + level);
  const history = [];
  let lastLine = '';
  let taps = 0;
  let tapKey = null;
  for (let t = 0; t < 200; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    history.push({ t, line: lineFor(st) });
    if (history.length > 100) history.shift();
    let k = history.length - 1;
    while (k > 0 && history[k].t > t - 0.25) k--;
    const line = history[k].line;
    let held = keysFor(line);
    const roll = /^Tilt ([←→↑↓])/.exec(line);
    if (roll && line !== lastLine) {
      const horizontal = roll[1] === '→' || roll[1] === '←';
      const bias = (rnd() * 2 - 1) * error;
      taps = Math.round(Math.abs(bias) / (RULES.tiltRate / hz));
      tapKey = horizontal
        ? bias > 0
          ? 'ArrowDown'
          : 'ArrowUp'
        : bias > 0
          ? 'ArrowRight'
          : 'ArrowLeft';
    }
    if (taps > 0 && st.marble.speed > 30) {
      held = [...held, tapKey];
      taps--;
    }
    lastLine = line;
    g.update(1 / hz, input(held, []));
  }
  const end = g.getState();
  return { cleared: end.level > level || end.phase === 'won', falls: end.falls };
}

test('every bridge lab can be crossed by a follower who adds up to 0.5 degrees of random cross-tilt on each roll', () => {
  const bridges = ['Narrow Bridge', 'Dune Bridge', 'Ice Bridge', 'Spiral Stair'];
  const report = [];
  for (const name of bridges) {
    const level = LABS.findIndex((b) => b.name[0] === name) + 1;
    assert.ok(level > 0, name);
    let wins = 0;
    let runs = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= 20; seed++) {
        runs++;
        if (noisyRun(level, hz, seed, 0.5).cleared) wins++;
      }
    report.push(`${name}: ${wins}/${runs}`);
    assert.ok(
      wins / runs >= 0.9,
      `${name}: only ${wins}/${runs} crossings with 0.5 degrees of cross-tilt noise`,
    );
  }
  console.log(`bridge crossings with cross-tilt noise: ${report.join(', ')}`);
});

test('mastery labs hide the route yet stay fair: a reader clears them, and a prompt-only player is helped after a stall', () => {
  for (let level = RULES.guideFrom; level <= LAB_COUNT; level++) {
    const { g } = begin(level, 2);
    const lineFor = reader();
    let sawHidden = false;
    let readerKeys = [];
    let t = 0;
    for (; t < 150; t += 1 / 60) {
      const st = g.getState();
      if (st.level !== level || st.phase !== 'playing') break;
      if (st.prompt.id === 'read') {
        sawHidden = true;
        assert.equal(st.guide, null);
        assert.equal(st.routeHint, false);
      }
      readerKeys = keysFor(lineFor(st));
      g.update(1 / 60, input(readerKeys, []));
    }
    const end = g.getState();
    assert.ok(sawHidden, `lab ${level}: the route was never hidden`);
    assert.ok(end.level > level || end.phase === 'won', `lab ${level}: a reader did not clear`);

    // A player who only follows the written prompt waits out the stall, then follows the arrow.
    const literal = begin(level, 2).g;
    let cleared = false;
    for (let f = 0; f < 60 * 240 && !cleared; f++) {
      const st = literal.getState();
      cleared = st.level > level || st.phase === 'won';
      if (!cleared) literal.update(1 / 60, input(keysFor(st.line.en), []));
    }
    assert.ok(cleared, `lab ${level}: the prompt-only player never got help`);
  }
});
