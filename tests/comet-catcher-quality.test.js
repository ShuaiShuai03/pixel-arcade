import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RULES, LEVEL_COUNT } from '../src/games/comet-catcher.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const SEEDS = 10; // x 3 frame rates = 30 runs per contract and reaction speed
const MASTERY_FROM = 16; // contracts 16-22 are the mastery tier: they ask for tighter execution

function begin(level, seed, lang = 'en') {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => (unlocked = Math.max(unlocked, n)),
  };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// A human-like player that sees only the drawn state: the prompt line, the marker and the net.
// It reacts `delay` seconds late, estimates its own net position and tilt by dead reckoning,
// answers each distinct prompt once (and again only after three seconds), and can drop keys.
function humanRun(
  seed,
  hz,
  {
    level = 1,
    delay = FAST,
    drop = 0,
    jitterDt = false,
    seconds = 150,
    campaign = false,
    noTilt = false,
    ignoreClose = 0,
    log,
  } = {},
) {
  const { g, h } = begin(level, seed);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const jitter = delay === SLOW ? 0.12 : 0.1;
  const history = [];
  let held = [];
  let acted = { text: '', t: -9 };
  let lastSeen = 0;
  let t = 0;
  const every = Math.max(1, Math.round(hz / 30));
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    if (!campaign && st.level !== level) break;
    const dt = jitterDt ? Math.min(1 / 30, (0.6 + rnd() * 0.8) / hz) : 1 / hz;
    history.push({ t, st, dt, keys: null });
    if (history.length > 120) history.shift();
    let pressed = [];
    if (f % every === 0) {
      const seenAt = Math.max(lastSeen, t - (base + (rnd() - 0.5) * jitter));
      lastSeen = seenAt;
      let k = history.length - 1;
      while (k > 0 && history[k].t > seenAt) k--;
      const obs = history[k].st;
      held = [];
      const tag = /^\[(Space|X|Arrows)\]/.exec(obs.line.en)?.[1];
      const press = tag === 'Space' ? 'Space' : tag === 'X' ? 'KeyX' : null;
      if (
        press &&
        !(press === 'Space' && ignoreClose && /Close/.test(obs.line.en) && rnd() < ignoreClose)
      ) {
        if (acted.text !== obs.line.en || t - acted.t > 3) {
          acted = { text: obs.line.en, t };
          pressed = [press];
        }
      } else if (obs.guide && obs.guide.kind !== 'cool') {
        // Dead reckoning: where I saw the net, plus what my own keys have done since.
        let x = obs.net.x;
        let tilt = obs.net.tilt;
        for (let j = k; j < history.length - 1; j++) {
          const { keys: used, dt: span } = history[j];
          x +=
            ((used.includes('ArrowRight') ? 1 : 0) - (used.includes('ArrowLeft') ? 1 : 0)) *
            RULES.netSpeed *
            span;
          tilt +=
            ((used.includes('ArrowDown') ? 1 : 0) - (used.includes('ArrowUp') ? 1 : 0)) *
            RULES.tiltRate *
            span;
        }
        x = Math.max(RULES.netMin, Math.min(RULES.netMax, x));
        if (obs.guide.x - x > 3) held.push('ArrowRight');
        else if (obs.guide.x - x < -3) held.push('ArrowLeft');
        if (!noTilt) {
          if (obs.guide.tilt - tilt > 4) held.push('ArrowDown');
          else if (obs.guide.tilt - tilt < -4) held.push('ArrowUp');
        }
      }
      if (drop && rnd() < drop) held = [];
    }
    history.at(-1).keys = held;
    if (log) log(st, held, pressed, t, g);
    g.update(dt, input(held, pressed));
    t += dt;
  }
  return { s: g.getState(), ends: h.ends, t, level };
}

const cleared = (r) => r.s.level > r.level || r.s.phase === 'won';

// `minWins` is a number, or { early, mastery } for different floors in contracts 1-15 and 16-22.
function contractRates(delay, minWins, opts = {}) {
  const report = [];
  const wins = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let won = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++)
        if (cleared(humanRun(seed + level * 100, hz, { level, delay, ...opts }))) won++;
    report.push(`${level}:${won}`);
    wins.push(won);
    const floor =
      typeof minWins === 'number' ? minWins : minWins[level < MASTERY_FROM ? 'early' : 'mastery'];
    assert.ok(
      won >= floor,
      `contract ${level}: only ${won}/30 runs cleared it (${report.join(' ')})`,
    );
  }
  return { report, wins };
}
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const earlyMean = (wins) => mean(wins.slice(0, MASTERY_FROM - 1));
const masteryMean = (wins) => mean(wins.slice(MASTERY_FROM - 1));

test('a delayed player (0.15-0.35 s) using the prompt and marker clears every contract in at least 25 of 30 runs at 30, 60 and 120 Hz', () => {
  const { report } = contractRates(FAST, 25);
  console.log(`per-contract wins, fast reactions: ${report.join(' ')}`);
});

test('a slow player (0.4-0.6 s with jitter) clears contracts 1-15 in at least 24 of 30 runs, and the mastery tier is measurably harder for them', () => {
  const { report, wins } = contractRates(SLOW, { early: 24, mastery: 3 });
  console.log(`per-contract wins, slow reactions: ${report.join(' ')}`);
  assert.ok(
    masteryMean(wins) <= earlyMean(wins) - 5,
    `mastery ${masteryMean(wins)} vs earlier ${earlyMean(wins)}`,
  );
});

test('the whole 22-contract campaign is won in at least 27 of 30 runs at each frame rate', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = humanRun(seed, hz, { campaign: true, seconds: 1500 });
      if (r.s.phase === 'won') {
        wins++;
        assert.equal(r.ends.length, 1);
        assert.equal(r.ends[0].won, true);
      }
    }
    console.log(`campaign wins at ${hz} Hz: ${wins}/30`);
    assert.ok(wins >= 27, `${hz} Hz: only ${wins}/30 campaigns won`);
  }
});

test('the slow player still reaches the mastery tier (contract 16) in at least 24 of 30 campaigns at 60 Hz', () => {
  let reached = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = humanRun(seed, 60, { campaign: true, seconds: 2000, delay: SLOW });
    if (r.s.level >= MASTERY_FROM || r.s.phase === 'won') reached++;
  }
  console.log(`slow campaigns reaching contract ${MASTERY_FROM} at 60 Hz: ${reached}/30`);
  assert.ok(reached >= 24, `only ${reached}/30 slow campaigns reached the mastery tier`);
});

test('a scripted legal solution (an instant reader) clears every contract at every rate without a failed attempt', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const hz of HZS) {
      const r = humanRun(level, hz, { level, delay: [0, 0] });
      assert.ok(cleared(r), `contract ${level} @${hz}`);
      assert.equal(r.s.tries, 3, `contract ${level} @${hz} cost a try`);
    }
});

test('a casual player (slow, drops keys, half the time ignores the cooling prompt) clears contracts 1-15 in at least 24 of 30 runs', () => {
  const casual = [0.3, 0.7];
  contractRates(casual, { early: 24, mastery: 3 }, { drop: 0.1, ignoreClose: 0.5 });
});

test('perturbed input (dropped keys, irregular frame times) still clears representative contracts', () => {
  const cases = [{ drop: 0.1 }, { drop: 0.25 }, { jitterDt: true }];
  for (const c of cases)
    for (const level of [1, 3, 6, 9, 13, 17, 20, 22]) {
      let wins = 0;
      for (const hz of HZS)
        for (let seed = 1; seed <= 4; seed++)
          if (cleared(humanRun(seed, hz, { level, ...c }))) wins++;
      const floor = level < MASTERY_FROM ? 10 : 4; // mastery asks for tighter execution
      assert.ok(wins >= floor, `${JSON.stringify(c)} contract ${level}: ${wins}/12`);
    }
});

test('prompts name keys, are held at least half a second, rarely flip back and never cost an attempt', () => {
  let changes = 0;
  let flips = 0;
  let minHold = Infinity;
  for (const hz of HZS)
    for (const level of [1, 3, 5, 6, 9, 12, 14, 18, 20, 22]) {
      let last = null;
      let before = null;
      let changedAt = 0;
      let current = 0;
      const r = humanRun(level, hz, {
        level,
        log: (st, _k, _p, t) => {
          assert.ok(/^\[(Arrows|Space|X)\]|^Stand still/.test(st.line.en), `no key: ${st.line.en}`);
          assert.ok(/^\[(方向键|空格|X)\]|^站着别动/.test(st.line.zh), st.line.zh);
          assert.ok(st.line.en.length <= 50 && st.line.zh.length <= 30, st.line.en);
          assert.equal(st.status.en.endsWith(st.line.en), true);
          if (st.level !== current) {
            current = st.level;
            last = null;
            before = null;
          }
          if (st.line.en === last) return;
          if (last !== null) {
            minHold = Math.min(minHold, t - changedAt);
            assert.ok(t - changedAt >= 0.5 - 1e-6, `"${last}" changed after ${t - changedAt}s`);
            changes++;
            if (st.line.en === before) flips++;
          }
          before = last;
          last = st.line.en;
          changedAt = t;
        },
      });
      assert.ok(cleared(r), `contract ${level} @${hz}`);
      assert.equal(r.s.stats.fails, 0);
    }
  assert.ok(changes > 100 && minHold >= 0.5 - 1e-6, `${changes} changes, min hold ${minHold}`);
  assert.ok(flips / changes < 0.15, `${flips}/${changes} prompts flipped straight back`);
});

test('crude policies fail: random keys, mashing Space and X, never tilting, spamming the action keys', () => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
  const policies = {
    random: (rnd) => ({ held: [keys[Math.floor(rnd() * keys.length)]], pressed: [] }),
    mash: (rnd) => ({
      held: [keys[Math.floor(rnd() * keys.length)]],
      pressed: rnd() < 0.1 ? [rnd() < 0.5 ? 'Space' : 'KeyX'] : [],
    }),
    spam: (rnd) => ({ held: [], pressed: [rnd() < 0.5 ? 'Space' : 'KeyX'] }),
  };
  for (const [name, policy] of Object.entries(policies)) {
    let won = 0;
    let total = 0;
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const { g, h } = begin(level, 5);
      const rnd = seeded(level * 13 + name.length);
      let held = [];
      for (
        let i = 0;
        i < 9000 && g.getState().level === level && g.getState().phase === 'playing';
        i++
      ) {
        let pressed = [];
        if (i % 12 === 0) {
          const next = policy(rnd);
          held = next.held;
          pressed = next.pressed;
        }
        g.update(1 / 60, input(held, pressed));
      }
      const s = g.getState();
      total++;
      if (s.level > level || s.phase === 'won') won++;
      assert.ok(h.ends.length <= 1);
    }
    assert.ok(won / total <= 0.5, `${name} cleared ${won}/${total}`);
    console.log(`crude policy ${name}: ${won}/${total}`);
  }
  let clearedNoTilt = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    for (const hz of [60])
      for (let seed = 1; seed <= 5; seed++)
        if (cleared(humanRun(seed, hz, { level, noTilt: true }))) wins++;
    if (wins >= 3) clearedNoTilt++;
  }
  console.log(`never tilting clears ${clearedNoTilt}/${LEVEL_COUNT} contracts`);
  assert.ok(clearedNoTilt / LEVEL_COUNT <= 0.5, `${clearedNoTilt} contracts need no tilt`);
});

test('the drawn top line names a key, holds at least half a second without input and fits the canvas', () => {
  const KEY = /^\[(Arrows|Space|X)\]|^Stand still|^\[(方向键|空格|X)\]|^站着别动/;
  let changes = 0;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 6, 9, 22])
      for (const hz of [30, 120]) {
        const seen = [];
        const state = {};
        const ctx = new Proxy(
          {
            measureText: (v) => ({ width: String(v).length * 8.4 }),
            canvas: { width: 480, height: 320 },
          },
          {
            get: (target, p) => {
              if (p === 'fillText')
                return (str, x, y) => {
                  if (y === 24 && state.textAlign === 'center') seen.push(str);
                };
              return p in state ? state[p] : p in target ? target[p] : () => {};
            },
            set: (target, p, v) => ((state[p] = v), true),
          },
        );
        const { g } = begin(level, 7, lang);
        let last = null;
        let lastAt = 0;
        let tries = 3;
        for (let f = 0, t = 0; t < 40; f++, t += 1 / hz) {
          const st = g.getState();
          if (st.level !== level) break;
          if (st.tries !== tries) {
            tries = st.tries; // a failed contract reloads with a fresh line
            last = null;
          }
          seen.length = 0;
          g.draw(ctx);
          const line = seen[0];
          assert.ok(line && KEY.test(line), `line without a key: "${line}"`);
          const w = [...line].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? 14 : 8.4), 0);
          assert.ok(w <= 440, `"${line}" is ${w}px wide`);
          assert.equal(line, st.line[lang]);
          if (line !== last) {
            if (last !== null) {
              assert.ok(t - lastAt >= 0.5 - 1e-6, `"${last}" -> "${line}" after ${t - lastAt}s`);
              changes++;
            }
            last = line;
            lastAt = t;
          }
          g.update(1 / hz, input(f % 3 ? [] : ['ArrowRight'], f % (hz * 2) === 7 ? ['Space'] : []));
        }
      }
  assert.ok(changes > 8, `only ${changes} line changes observed`);
});
