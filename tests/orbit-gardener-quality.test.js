import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RULES, GARDEN_COUNT } from '../src/games/orbit-gardener.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const R = (lane) => RULES.lanes[lane];

function begin(level, seed, lang = 'en') {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// Would a ship holding `dir` for `span` seconds from the estimated state touch a rock?
function safeFor(est, dir, span, margin = 9) {
  const lane = est.lane;
  const need = (RULES.hitDist + margin) / R(lane);
  for (let t = 0; t <= span + 1e-9; t += 1 / 30) {
    const a = est.a + (dir * RULES.speed * t) / R(lane);
    for (const d of est.debris)
      if (d.lane === lane && Math.abs(wrap(d.a + d.omega * t - a)) < need) return false;
  }
  return true;
}
function timeToHit(est, dir) {
  for (let t = 0; t <= 2; t += 1 / 30) if (!safeFor(est, dir, t, 4)) return t;
  return 3;
}

// The bot follows the route marker (hint) and the drawn rocks; it does not read the prompt text.
// A human-like player: sees only the drawn state (marker, rocks, gates) `delay` seconds late, and
// moves by dead reckoning from its own key presses. It dodges rocks it can see coming.
function humanRun(
  seed,
  hz,
  {
    level = 1,
    delay = FAST,
    seconds = 140,
    campaign = false,
    drop = 0,
    jitterDt = false,
    log,
  } = {},
) {
  const { g, h } = begin(level, seed);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const jitter = delay === SLOW ? 0.12 : 0.1;
  const history = [];
  let lastSeen = 0;
  let held = [];
  let t = 0;
  let holdOff = -1;
  const every = Math.max(1, Math.round(hz / 30));
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    if (!campaign && st.garden !== level) break;
    const dt = jitterDt ? Math.min(1 / 30, (0.6 + rnd() * 0.8) / hz) : 1 / hz;
    history.push({ t, st, dt, keys: [] });
    if (history.length > 120) history.shift();
    let pressed = [];
    if (f % every === 0 && !st.menu) {
      const seenAt = Math.max(lastSeen, t - (base + (rnd() - 0.5) * jitter));
      lastSeen = seenAt;
      let k = history.length - 1;
      while (k > 0 && history[k].t > seenAt) k--;
      const obs = history[k].st;
      const age = t - history[k].t;
      // Dead reckoning of my own motion since the observation.
      let a = obs.player.angle;
      let moved = false;
      for (let j = k; j < history.length - 1; j++) {
        const ks = history[j].keys;
        const dir = (ks.includes('ArrowRight') ? 1 : 0) - (ks.includes('ArrowLeft') ? 1 : 0);
        a += (dir * RULES.speed * history[j].dt) / R(obs.player.lane);
        if (ks.includes('ArrowUp') || ks.includes('ArrowDown')) moved = true;
      }
      // Drift rates are not in the picture: like a person, the bot estimates them from two
      // observations at least a quarter of a second apart (and assumes nothing moves until then).
      let old = k;
      while (old > 0 && history[k].t - history[old].t < 0.25) old--;
      const gap = history[k].t - history[old].t;
      const before = history[old].st;
      const rate = (now, was) =>
        gap >= 0.25 && before.garden === obs.garden ? wrap(now - was) / gap : 0;
      const spinOf = (i) => rate(obs.gates[i].angle, before.gates[i]?.angle ?? obs.gates[i].angle);
      const est = {
        lane: obs.player.lane,
        a,
        debris: obs.debris.map((d, i) => {
          const omega = rate(d.angle, before.debris[i]?.angle ?? d.angle);
          return { ...d, omega, a: d.angle + omega * age };
        }),
      };
      held = [];
      const hint = obs.hint;
      if (hint && !moved && t >= holdOff && obs.player.lane === hint.lane) {
        let target = hint.angle;
        if (hint.kind === 'transfer') target += spinOf(hint.gate) * age;
        const delta = wrap(target - est.a);
        const px = Math.abs(delta) * R(est.lane);
        const want = Math.sign(delta);
        const tolerance = hint.kind === 'transfer' ? 8 : 3;
        const mid = ((RULES.speed * 1) / hz) * 0.6;
        if (px <= Math.max(mid, tolerance) && hint.kind !== 'gather') {
          if (hint.kind === 'transfer') {
            const up = hint.to > est.lane;
            const to = { lane: hint.to, a: est.a, debris: est.debris };
            if (safeFor(to, 0, 0.7) && safeFor(est, 0, 0.1)) {
              pressed = [up ? 'ArrowUp' : 'ArrowDown'];
              holdOff = t + base + 0.1;
            } else {
              const dir = [0, want, -want].find((d) => safeFor(est, d, 0.6)) ?? 0;
              if (dir) held = [dir > 0 ? 'ArrowRight' : 'ArrowLeft'];
            }
          } else if (hint.open && safeFor(est, 0, RULES.plantTime + 0.5)) held = ['Space'];
          else if (!safeFor(est, 0, 0.6)) {
            const dir = [want, -want, 1, -1].find((d) => d && safeFor(est, d, 0.6)) || 1;
            held = [dir > 0 ? 'ArrowRight' : 'ArrowLeft'];
          }
        } else {
          // Pick the way round that stays clear of the rocks all the way to the stop (the long way
          // when a rock sits on the short one); otherwise fall back to the next safe moment.
          const short = px / RULES.speed;
          const long = ((TAU - Math.abs(delta)) * R(est.lane)) / RULES.speed;
          const ways = [
            [want, short],
            [-want, long],
          ].filter(([d, span]) => safeFor(est, d, Math.min(span, 10), 9));
          const options = [want, 0, -want];
          let dir = ways.length ? ways.sort((x, y) => x[1] - y[1])[0][0] : undefined;
          if (dir === undefined) dir = options.find((d) => safeFor(est, d, 0.8));
          if (dir === undefined)
            dir = options.sort((x, y) => timeToHit(est, y) - timeToHit(est, x))[0];
          if (dir) held = [dir > 0 ? 'ArrowRight' : 'ArrowLeft'];
        }
      }
      if (drop && rnd() < drop) held = held.filter((k) => k === 'Space'); // a movement key slips; a held Space does not
    }
    const keys = held;
    history.at(-1).keys = [...keys, ...pressed];
    if (log) log(st, keys, pressed, t, g);
    g.update(dt, input(keys, pressed));
    t += dt;
  }
  return { s: g.getState(), ends: h.ends, sounds: h.sounds, t, level };
}

// Lines that may replace the one on screen at once: a rock warning, or arriving where to stop.
const URGENT = /^(Rock|Press|Stop|Wait)/;
const cleared = (r) => r.s.garden > r.level || r.s.phase === 'won';
const SEEDS = 10;

function gardenRates(delay, minWins) {
  const report = [];
  for (let level = 1; level <= GARDEN_COUNT; level++) {
    let wins = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++)
        if (cleared(humanRun(seed + level * 100, hz, { level, delay }))) wins++;
    report.push(`${level}:${wins}`);
    assert.ok(wins >= minWins, `garden ${level}: only ${wins}/30 runs (${report.join(' ')})`);
  }
  return report;
}

test('a delayed player (0.15-0.35 s) using only the drawn state clears every garden in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-garden wins, fast: ${gardenRates(FAST, 27).join(' ')}`);
});

test('a slow player (0.4-0.6 s with jitter) clears every garden in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-garden wins, slow: ${gardenRates(SLOW, 24).join(' ')}`);
});

test('the whole 24-garden campaign is won in at least 27 of 30 runs at each frame rate', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = humanRun(seed, hz, { campaign: true, seconds: 1500 });
      if (r.s.phase === 'won') {
        wins++;
        assert.equal(r.ends.length, 1);
        assert.equal(r.ends[0].won, true);
        assert.equal(r.sounds.filter((n) => n === 'win').length, 1, 'one win jingle');
      }
    }
    console.log(`campaign wins at ${hz} Hz: ${wins}/30`);
    assert.ok(wins >= 27, `${hz} Hz: only ${wins}/30 campaigns won`);
  }
});

test('the slow player also finishes the campaign in at least 24 of 30 runs at 60 Hz', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++)
    if (humanRun(seed, 60, { campaign: true, seconds: 2000, delay: SLOW }).s.phase === 'won')
      wins++;
  console.log(`slow campaign wins at 60 Hz: ${wins}/30`);
  assert.ok(wins >= 24, `only ${wins}/30 slow campaigns won`);
});

test('every garden has a scripted legal solution: a zero-delay planner replays it through public keys', () => {
  for (let level = 1; level <= GARDEN_COUNT; level++) {
    const keys = [];
    const r = humanRun(level, 60, {
      level,
      delay: [0, 0],
      log: (_st, held, pressed) => keys.push([[...held], [...pressed]]),
    });
    assert.ok(cleared(r), `garden ${level} has no legal solution`);
    // Replay the recorded keys on a fresh instance: the same inputs give the same clear.
    const { g } = begin(level, level + 100);
    for (const [held, pressed] of keys) g.update(1 / 60, input(held, pressed));
    const end = g.getState();
    assert.ok(end.garden > level || end.phase === 'won', `replay of garden ${level} failed`);
    assert.ok(keys.length < 60 * 80, `garden ${level} solution is ${keys.length} frames`);
  }
});

test('perturbed input (dropped keys, irregular frame times) still clears representative gardens', () => {
  const cases = [{ drop: 0.1 }, { drop: 0.25 }, { jitterDt: true }];
  for (const c of cases)
    for (const level of [1, 3, 9, 13, 17, 20, 23, 24]) {
      let wins = 0;
      const why = [];
      for (const hz of HZS)
        for (let seed = 1; seed <= 4; seed++) {
          const r = humanRun(seed, hz, { level, ...c });
          if (cleared(r)) wins++;
          else why.push(`${r.s.phase}/h${r.s.hull}/t${Math.round(r.t)}`);
        }
      // The mastery gardens run to a tighter par, so a quarter of the steering keys dropped may cost
      // one run in four (at least 9 of 12) there; every earlier garden keeps 10 of 12.
      const need = level >= 19 ? 9 : 10;
      assert.ok(wins >= need, `${JSON.stringify(c)} garden ${level}: ${wins}/12 ${why}`);
    }
});

test('prompts name keys, are held at least half a second and rarely flip straight back', () => {
  let changes = 0;
  let flips = 0;
  let minHold = Infinity;
  for (const hz of HZS)
    for (const level of [1, 3, 4, 7, 9, 12, 14, 16, 20, 24]) {
      let last = null;
      let before = null;
      let changedAt = 0;
      let garden = 0;
      const r = humanRun(level, hz, {
        level,
        log: (st, _k, _p, t) => {
          assert.ok(/Space|Arrows|Up|Down|Left|Right/.test(st.line.en), st.line.en);
          assert.ok(/空格|方向键/.test(st.line.zh), st.line.zh);
          assert.ok(st.line.en.length <= 32 && st.line.zh.length <= 20, st.line.en);
          if (st.garden !== garden) {
            garden = st.garden;
            last = null;
            before = null;
          }
          if (st.line.en === last) return;
          if (last !== null) {
            // Rock warnings and "stop here" arrivals cut in at once; every other change waits.
            if (!URGENT.test(st.line.en)) {
              minHold = Math.min(minHold, t - changedAt);
              assert.ok(t - changedAt >= 0.5 - 1e-6, `"${last}" changed after ${t - changedAt}s`);
            }
            changes++;
            if (st.line.en === before) flips++;
          }
          before = last;
          last = st.line.en;
          changedAt = t;
        },
      });
      assert.ok(cleared(r), `garden ${level} @${hz}`);
    }
  assert.ok(changes > 30 && minHold >= 0.5 - 1e-6, `${changes} changes`);
  assert.ok(flips / changes < 0.15, `${flips}/${changes} prompts flipped straight back`);
});

// Blind policies read no state at all. `pulse` is the reviewer's pulse policy: hold a random
// direction, stop and hold Space, press Up or Down at random while stopped.
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
function pulsePolicy(moveFor, holdFor) {
  return (rnd) => {
    let key = pick(rnd, ['ArrowLeft', 'ArrowRight']);
    let phase = 'move';
    let since = 0;
    return (t) => {
      let pressed = [];
      if (phase === 'move' && t - since >= moveFor) {
        phase = 'hold';
        since = t;
        pressed = [pick(rnd, ['ArrowUp', 'ArrowDown'])];
      } else if (phase === 'hold' && t - since >= holdFor) {
        phase = 'move';
        since = t;
        key = pick(rnd, ['ArrowLeft', 'ArrowRight']);
      }
      return { held: phase === 'move' ? [key] : ['Space'], pressed };
    };
  };
}
const stepped = (make) => (rnd) => {
  let cur = { held: [], pressed: [] };
  let n = 0;
  return () => {
    if (n++ % 12 === 0) cur = make(rnd);
    else cur = { held: cur.held, pressed: [] };
    return cur;
  };
};
const CRUDE = {
  random: stepped((rnd) => ({ held: [pick(rnd, ARROWS)], pressed: [] })),
  mash: stepped((rnd) => ({
    held: [pick(rnd, ARROWS), 'Space'],
    pressed: rnd() < 0.5 ? [pick(rnd, ARROWS)] : [],
  })),
  holdRight: stepped((rnd) => ({
    held: ['ArrowRight', 'Space'],
    pressed: [rnd() < 0.5 ? 'ArrowUp' : 'ArrowDown'],
  })),
  spaceOnly: stepped((rnd) => ({
    held: ['Space'],
    pressed: rnd() < 0.5 ? [pick(rnd, ARROWS)] : [],
  })),
  pulse: (rnd) => {
    const next = pulsePolicy(0.4, 1.1)(rnd);
    return (_n, t) => next(t);
  },
  pulseLong: (rnd) => {
    const next = pulsePolicy(0.4, 1.5)(rnd);
    return (_n, t) => next(t);
  },
  pulseShort: (rnd) => {
    const next = pulsePolicy(0.2, 1.4)(rnd);
    return (_n, t) => next(t);
  },
};

function crudeWins(name, level, runs, seconds) {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const { g } = begin(level, seed);
    const next = CRUDE[name](seeded(seed * 31 + level));
    for (let i = 0; i < 60 * seconds; i++) {
      const cur = next(i, i / 60);
      g.update(1 / 60, input(cur.held, cur.pressed));
      if (i % 30 === 0) {
        const s = g.getState();
        if (s.garden !== level || s.phase !== 'playing') break;
      }
    }
    if (g.getState().garden > level || g.getState().phase === 'won') wins++;
  }
  return wins;
}

test('crude policies win at most half the runs in every garden: random keys, mashing, spam, holding one way and the pulse policy', () => {
  const report = [];
  for (const name of Object.keys(CRUDE)) {
    const row = [];
    for (let level = 1; level <= GARDEN_COUNT; level++) {
      const runs = 10;
      const wins = crudeWins(name, level, runs, 90);
      row.push(wins);
      assert.ok(wins <= runs / 2, `${name} cleared garden ${level} in ${wins}/${runs} runs`);
    }
    report.push(`${name.padEnd(10)} ${row.join(' ')}`);
  }
  console.log(`crude wins/10 in 90 s:\n${report.join('\n')}`);
});

test('the same crude policies stay at or under half with a 300 s budget (the daylight, then the hull, runs out)', () => {
  for (const name of ['mash', 'pulse', 'pulseLong', 'pulseShort'])
    for (let level = 1; level <= GARDEN_COUNT; level++) {
      const wins = crudeWins(name, level, 10, 300);
      assert.ok(wins <= 5, `${name} cleared garden ${level} in ${wins}/10 runs with 300 s`);
    }
});

// A zero-skill follower of the route marker: it walks to the marker, presses what the marker's
// kind needs and never looks at a rock.
function markerFollower(level, hz = 60) {
  const { g } = begin(level, 1);
  let i = 0;
  for (; i < hz * 200; i++) {
    const st = g.getState();
    if (st.garden !== level || st.phase !== 'playing') break;
    const h = st.hint;
    let held = [];
    let pressed = [];
    if (h) {
      const d = wrap(h.angle - st.player.angle);
      if (Math.abs(d) * R(st.player.lane) > 3) held = [d > 0 ? 'ArrowRight' : 'ArrowLeft'];
      else if (h.kind === 'transfer') pressed = [h.to > st.player.lane ? 'ArrowUp' : 'ArrowDown'];
      else held = ['Space'];
    }
    g.update(1 / hz, input(held, pressed));
  }
  const st = g.getState();
  return { ok: st.garden > level || st.phase === 'won', hits: st.stats.hits };
}

test('a zero-skill marker follower is hurt in the gardens that have rocks: at most half the campaign clears with no hits', () => {
  let clean = 0;
  const hurt = [];
  for (let level = 1; level <= GARDEN_COUNT; level++) {
    const r = markerFollower(level);
    if (r.ok && r.hits === 0) clean++;
    else hurt.push(level);
  }
  console.log(`marker follower: ${clean}/24 clean clears; hurt in ${hurt.join(' ')}`);
  assert.ok(clean <= 12, `${clean} gardens clear for free`);
  for (const level of [9, 10, 11, 15, 16, 17, 19, 20, 22, 23, 24])
    assert.ok(markerFollower(level).hits > 0, `garden ${level} costs the marker follower nothing`);
});

// A literal prompt follower obeys the line on screen word for word and never looks at a rock.
function promptFollower(level, hz = 60, seconds = 150) {
  const { g } = begin(level, 1);
  let acted = { en: '', t: -9 };
  let t = 0;
  for (let f = 0; t < seconds; f++, t += 1 / hz) {
    const st = g.getState();
    if (st.garden !== level || st.phase !== 'playing') break;
    const en = st.line.en;
    let held = [];
    let pressed = [];
    let m;
    if ((m = /^(?:Rock! )?Hold (Left|Right)/.exec(en))) held = [`Arrow${m[1]}`];
    else if (/^Rock ahead|^Wait/.test(en)) held = [];
    else if ((m = /^Press (Up|Down)/.exec(en))) {
      if (acted.en !== en || t - acted.t > 1) {
        acted = { en, t };
        pressed = [`Arrow${m[1]}`];
      }
    } else if (/hold Space/.test(en)) held = ['Space'];
    g.update(1 / hz, input(held, pressed));
  }
  const st = g.getState();
  return { ok: st.garden > level || st.phase === 'won', hits: st.stats.hits, t };
}

test('F2: a literal prompt follower that never looks at a rock is never led into a hit, in any garden or frame rate', () => {
  for (const hz of HZS)
    for (let level = 1; level <= GARDEN_COUNT; level++) {
      const r = promptFollower(level, hz);
      assert.equal(r.hits, 0, `garden ${level} @${hz}: the prompt led into ${r.hits} hit(s)`);
      assert.ok(r.ok, `garden ${level} @${hz}: the literal follower did not finish`);
    }
});

test('the drawn top line names a key, holds half a second without input and fits beside the counters', () => {
  const KEY = /Space|Arrows|Up|Down|Left|Right|空格|方向键/;
  let changes = 0;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 9, 20, 24])
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
                return (str, _x, y) => {
                  if (y === 6 && state.textAlign === 'center') seen.push(str);
                };
              return p in state ? state[p] : p in target ? target[p] : () => {};
            },
            set: (target, p, v) => ((state[p] = v), true),
          },
        );
        const { g } = begin(level, 7, lang);
        const rnd = seeded(level * 3 + hz);
        let last = null;
        let lastAt = 0;
        let held = [];
        let prevPressed = false;
        for (let f = 0, t = 0; t < 40; f++, t += 1 / hz) {
          const st = g.getState();
          if (st.garden !== level) break;
          seen.length = 0;
          g.draw(ctx);
          const line = st.menu ? st.line[lang] : seen[0];
          assert.ok(line && KEY.test(line), `line without a key: "${line}"`);
          const w = [...line].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? 14 : 8.4), 0);
          assert.ok(w <= 270, `"${line}" is ${w}px wide`);
          assert.equal(line, st.line[lang]);
          if (line !== last) {
            if (last !== null && !prevPressed && !URGENT.test(st.line.en)) {
              assert.ok(t - lastAt >= 0.5 - 1e-6, `"${last}" -> "${line}" after ${t - lastAt}s`);
              changes++;
            }
            last = line;
            lastAt = prevPressed ? t - 1 / hz : t;
          }
          if (f % Math.round(hz / 5) === 0)
            held = rnd() < 0.3 ? [] : [rnd() < 0.5 ? 'ArrowLeft' : 'ArrowRight'];
          const pressed =
            f % hz === 0 && rnd() < 0.5 ? [rnd() < 0.5 ? 'ArrowUp' : 'ArrowDown'] : [];
          prevPressed = pressed.length > 0;
          g.update(1 / hz, input(held, pressed));
        }
      }
  assert.ok(changes > 10, `only ${changes} unforced changes observed`);
});
