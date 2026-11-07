import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RULES, LEVEL_COUNT } from '../src/games/firefly-trail.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const CASUAL = [0.5, 0.8];
const SPEED = RULES.speed;

function begin(level, seed = 1, lang = 'en') {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

function steer(dx, dy, dead = 2) {
  const keys = [];
  if (dx > dead) keys.push('ArrowRight');
  else if (dx < -dead) keys.push('ArrowLeft');
  if (dy > dead) keys.push('ArrowDown');
  else if (dy < -dead) keys.push('ArrowUp');
  return keys;
}
function moved(keys, dt) {
  let dx = (keys.includes('ArrowRight') ? 1 : 0) - (keys.includes('ArrowLeft') ? 1 : 0);
  let dy = (keys.includes('ArrowDown') ? 1 : 0) - (keys.includes('ArrowUp') ? 1 : 0);
  if (dx && dy) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  return [dx * SPEED * dt, dy * SPEED * dt];
}

// A human-like player. It sees the drawn state (the guide dots, the prompt line, the moths) `lag`
// seconds late and never the future. It knows its own key presses, so it dead-reckons where the
// lantern is now, and it obeys the prompt line: walk, wait, press Space.
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
    distract = 0,
    log,
  } = {},
) {
  const { g, h } = begin(level, seed);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const jitter = delay === SLOW || delay === CASUAL ? 0.12 : 0.1;
  const history = [];
  let lastSeen = 0;
  let held = [];
  let t = 0;
  let holdOff = -1;
  let pending = null;
  let idleUntil = -1;
  const every = Math.max(1, Math.round(hz / 30));
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    if (!campaign && st.meadow !== level) break;
    const dt = jitterDt ? Math.min(1 / 30, (0.6 + rnd() * 0.8) / hz) : 1 / hz;
    history.push({ t, st, dt, keys: [] });
    if (history.length > 150) history.shift();
    let pressed = [];
    if (f % every === 0 && !st.menu) {
      const seenAt = Math.max(lastSeen, t - (base + (rnd() - 0.5) * jitter));
      lastSeen = seenAt;
      let k = history.length - 1;
      while (k > 0 && history[k].t > seenAt) k--;
      const obs = history[k].st;
      let ex = obs.player.x;
      let ey = obs.player.y;
      for (let j = k; j < history.length - 1; j++) {
        const [mx, my] = moved(history[j].keys, history[j].dt);
        ex += mx;
        ey += my;
      }
      held = [];
      if (pending && history[k].t >= pending.t) pending = null;
      const move = obs.line.move;
      const hint = obs.hint;
      let trailOn = obs.trail.on;
      if (pending?.kind === 'begin') trailOn = true;
      if (distract && t >= idleUntil && rnd() < distract) idleUntil = t + 0.6 + rnd() * 0.8;
      if (t < idleUntil || (pending && pending.kind === 'close') || obs.meadow !== st.meadow) {
        // distracted, or waiting for a close to show up
      } else if (
        move === 'space' &&
        t >= holdOff &&
        !pending &&
        // Only press where the cue was seen: a lantern that has since moved on keeps walking.
        Math.hypot(ex - obs.player.x, ey - obs.player.y) < 6
      ) {
        pressed = ['Space'];
        pending = { t, kind: trailOn ? 'close' : 'begin' };
        holdOff = t + base + 0.2;
      } else if (move === 'go' || (pending?.kind === 'begin' && hint)) {
        if (hint) {
          const ringAt = hint.route.findIndex(
            (p) => Math.abs(p.x - hint.ring.x) < 1e-6 && Math.abs(p.y - hint.ring.y) < 1e-6,
          );
          let route = hint.route;
          let from = 0;
          if (!trailOn && ringAt >= 0) route = route.slice(0, ringAt + 1);
          else if (trailOn && !obs.trail.on && ringAt >= 0) from = ringAt + 1;
          let i = from;
          while (i < route.length && Math.hypot(route[i].x - ex, route[i].y - ey) <= 8) i++;
          const atRing = !trailOn && i >= route.length;
          if (!atRing && i < route.length) held = steer(route[i].x - ex, route[i].y - ey);
        }
      }
      if (drop && rnd() < drop) held = held.slice(0, 1);
    }
    history.at(-1).keys = [...held];
    if (log) log(st, held, pressed, t, g);
    g.update(dt, input(held, pressed));
    t += dt;
  }
  return { s: g.getState(), ends: h.ends, sounds: h.sounds, t, level };
}

const cleared = (r) => r.s.meadow > r.level || r.s.phase === 'won';
const SEEDS = 10;

function meadowRates(delay, minWins, opts = {}) {
  const report = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    const why = [];
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = humanRun(seed + level * 100, hz, { level, delay, ...opts });
        if (cleared(r)) wins++;
        else
          why.push(
            `${hz}Hz/s${seed}:${r.s.phase}/l${r.s.lives}/c${r.s.stats.cuts}/t${Math.round(r.t)}`,
          );
      }
    report.push(`${level}:${wins}`);
    assert.ok(
      wins >= minWins,
      `meadow ${level}: only ${wins}/30 runs (${report.join(' ')}) ${why.join(' ')}`,
    );
  }
  return report;
}

test('a delayed player (0.15-0.35 s) using only the drawn state clears every meadow in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-meadow wins, fast: ${meadowRates(FAST, 27).join(' ')}`);
});

test('a slow player (0.4-0.6 s with jitter) clears every meadow in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-meadow wins, slow: ${meadowRates(SLOW, 24).join(' ')}`);
});

test('a casual player (0.5-0.8 s, now and then distracted, dropping keys) clears every meadow in at least 24 of 30 runs', () => {
  const report = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++)
      if (
        cleared(
          humanRun(seed + level * 31, 60, { level, delay: CASUAL, distract: 0.003, drop: 0.08 }),
        )
      )
        wins++;
    report.push(`${level}:${wins}`);
    assert.ok(wins >= 24, `meadow ${level}: casual ${wins}/30 (${report.join(' ')})`);
  }
  console.log(`per-meadow wins, casual: ${report.join(' ')}`);
});

test('frame-rate sweep: five meadows at each rate with 30 seeds, fast and slow players', () => {
  for (const level of [1, 5, 11, 17, 24])
    for (const hz of HZS)
      for (const [delay, min] of [
        [FAST, 27],
        [SLOW, 24],
      ]) {
        let wins = 0;
        for (let seed = 1; seed <= 30; seed++)
          if (cleared(humanRun(seed * 3 + level, hz, { level, delay }))) wins++;
        assert.ok(wins >= min, `meadow ${level} @${hz} Hz: ${wins}/30`);
      }
});

test('the whole 24-meadow campaign is won in at least 27 of 30 fast runs and 24 of 30 slow runs', () => {
  for (const [delay, min] of [
    [FAST, 27],
    [SLOW, 24],
  ]) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = humanRun(seed, 60, { campaign: true, seconds: 2400, delay });
      if (r.s.phase === 'won') {
        wins++;
        assert.equal(r.ends.length, 1);
        assert.equal(r.ends[0].won, true);
        assert.equal(r.sounds.filter((n) => n === 'win' || n === 'lose').length, 0);
      }
    }
    console.log(`campaign wins (${delay}): ${wins}/30`);
    assert.ok(wins >= min, `only ${wins}/30 campaigns won`);
  }
});

test('every meadow has a scripted legal solution: a zero-lag planner replays through public keys', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const keys = [];
    const r = humanRun(level, 60, {
      level,
      delay: [0, 0],
      log: (_st, held, pressed) => keys.push([[...held], [...pressed]]),
    });
    assert.ok(cleared(r), `meadow ${level} has no legal solution`);
    const { g } = begin(level, level + 100);
    for (const [held, pressed] of keys) g.update(1 / 60, input(held, pressed));
    const end = g.getState();
    assert.ok(end.meadow > level || end.phase === 'won', `replay of meadow ${level} failed`);
    assert.equal(end.stats.cuts + end.stats.hits, 0, `meadow ${level} solution is clean`);
  }
});

test('perturbed input (dropped keys, irregular frame times) still clears representative meadows', () => {
  const cases = [{ drop: 0.1 }, { drop: 0.25 }, { jitterDt: true }];
  for (const c of cases)
    for (const level of [1, 4, 6, 9, 13, 17, 21, 24]) {
      let wins = 0;
      const why = [];
      for (const hz of HZS)
        for (let seed = 1; seed <= 4; seed++) {
          const r = humanRun(seed, hz, { level, ...c });
          if (cleared(r)) wins++;
          else why.push(`${r.s.phase}/l${r.s.lives}/t${Math.round(r.t)}`);
        }
      assert.ok(wins >= 10, `${JSON.stringify(c)} meadow ${level}: ${wins}/12 ${why}`);
    }
});

// Lines that may replace the one on screen at once: a moth warning or "press Space".
const URGENT = /^(Press|Moth)/;

test('prompts name keys, are held at least half a second and rarely flip straight back', () => {
  let changes = 0;
  let flips = 0;
  let minHold = Infinity;
  for (const hz of HZS)
    for (const level of [1, 3, 4, 6, 8, 9, 11, 14, 16, 20, 24]) {
      let last = null;
      let before = null;
      let changedAt = 0;
      let meadow = 0;
      let events = '';
      const r = humanRun(level, hz, {
        level,
        log: (st, _k, _p, t) => {
          assert.ok(/Space|Arrows/.test(st.line.en), st.line.en);
          assert.ok(/空格|方向键/.test(st.line.zh), st.line.zh);
          assert.ok(st.line.en.length <= 40 && st.line.zh.length <= 22, st.line.en);
          const now = `${st.stats.loops}/${st.stats.cuts}/${st.stats.hits}/${st.trail.on}`;
          const forced = now !== events;
          events = now;
          if (st.meadow !== meadow) {
            meadow = st.meadow;
            last = null;
            before = null;
          }
          if (st.line.en === last) return;
          if (last !== null) {
            if (!URGENT.test(st.line.en) && !forced) {
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
      assert.ok(cleared(r), `meadow ${level} @${hz}`);
    }
  assert.ok(changes > 30 && minHold >= 0.5 - 1e-6, `${changes} changes`);
  assert.ok(flips / changes < 0.15, `${flips}/${changes} prompts flipped straight back`);
});

// A prompt follower that reads only the drawn line and the guide dots, with no delay at all (or a
// short one): it must never be steered into a moth or have its trail cut.
function promptFollower(level, hz, lag = 0) {
  const { g } = begin(level, 5);
  let lock = 0;
  let t = 0;
  const queue = [];
  for (; t < 400; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.meadow !== level) break;
    queue.push(st);
    const back = Math.round(lag * hz);
    const seen = queue.length > back ? queue[queue.length - 1 - back] : st;
    const held = [];
    const pressed = [];
    if (seen.line.move === 'go' && seen.hint)
      held.push(...steer(seen.hint.x - st.player.x, seen.hint.y - st.player.y));
    else if (seen.line.move === 'space' && lock <= 0) {
      pressed.push('Space');
      lock = 0.3 + lag;
    }
    lock -= 1 / hz;
    g.update(1 / hz, input(held, pressed));
  }
  const end = g.getState();
  return {
    ok: end.meadow > level || end.phase === 'won',
    hits: end.stats.hits,
    cuts: end.stats.cuts,
  };
}

test('a literal prompt follower that never looks at a moth is never led into a hit or a cut, at 0, 0.25 and 0.5 s of lag, in any meadow or frame rate', () => {
  for (const lag of [0, 0.25, 0.5])
    for (const hz of HZS)
      for (let level = 1; level <= LEVEL_COUNT; level++) {
        const r = promptFollower(level, hz, lag);
        assert.equal(
          r.hits + r.cuts,
          0,
          `meadow ${level} @${hz} Hz, lag ${lag}: led into ${r.hits} hit(s), ${r.cuts} cut(s)`,
        );
        // A follower half a second behind the stalker's lure is never hurt, but its repeated late
        // turns can spoil the lure until dawn; the dead-reckoning players above do finish it.
        if (!(level === 18 && lag >= 0.5))
          assert.ok(r.ok, `meadow ${level} @${hz} Hz, lag ${lag}: the follower did not finish`);
      }
});

// A literal prompt follower that honours every wait in full, after an idle start (reading the tip).
function literalRun(level, lag, idle) {
  const hz = 60;
  const { g } = begin(level, 5);
  const queue = [];
  let lock = 0;
  for (let t = 0; t < 200; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.meadow !== level) break;
    queue.push(st);
    const back = Math.round(lag * hz);
    const seen = queue.length > back ? queue[queue.length - 1 - back] : st;
    const held = [];
    const pressed = [];
    if (t >= idle && seen.line.move === 'go' && seen.hint)
      held.push(...steer(seen.hint.x - st.player.x, seen.hint.y - st.player.y));
    else if (t >= idle && seen.line.move === 'space' && lock <= 0) {
      pressed.push('Space');
      lock = 0.3 + lag;
    }
    lock -= 1 / hz;
    g.update(1 / hz, input(held, pressed));
  }
  const end = g.getState();
  return { ok: end.meadow > level || end.phase === 'won', dawnLeft: end.dawn };
}

test('a follower that honours every wait in full clears the long-wait meadows with at least 5 s of dawn to spare', () => {
  for (const level of [19, 23, 24]) {
    const spare = [];
    for (let seed = 0; seed < 30; seed++) {
      const r = literalRun(level, 0.03 + ((seed * 7) % 12) * 0.05, (seed * 0.9) % 9);
      assert.ok(r.ok, `meadow ${level} seed ${seed}: the dawn came first`);
      spare.push(r.dawnLeft);
    }
    spare.sort((a, b) => a - b);
    assert.ok(spare[Math.floor(spare.length * 0.1)] >= 5, `meadow ${level}: p90 spare ${spare[3]}`);
  }
});

// The same follower, dropped into the meadow after a random walk (the lantern may stand anywhere,
// for instance in the middle of a moth lane), once every moth is far away.
const MOTH_MEADOWS = [5, 6, 11, 13, 14, 15, 17, 18, 19, 21, 22, 24];

function followFromAnywhere(level, hz, lag, seed) {
  const { g } = begin(level, seed);
  const rnd = seeded(seed * 31 + level);
  const walkFor = rnd() * 25;
  let direction = ['ArrowRight'];
  for (let t = 0; t < walkFor; t += 1 / hz) {
    if (Math.floor(t * 2) !== Math.floor((t - 1 / hz) * 2))
      direction = [['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'][Math.floor(rnd() * 4)]];
    if (g.getState().phase !== 'playing' || g.getState().meadow !== level) return null;
    g.update(1 / hz, input(direction));
  }
  const calm = (st) =>
    st.moths.every(
      (m) =>
        Math.hypot(m.x - st.player.x, m.y - st.player.y) > 90 &&
        st.trail.points.every((p) => Math.hypot(m.x - p.x, m.y - p.y) > 70),
    );
  let st = g.getState();
  for (let n = 0; !calm(st) && n < hz * 30; n++) {
    g.update(1 / hz, input([]));
    st = g.getState();
  }
  if (st.phase !== 'playing' || !calm(st)) return null;
  const before = st.stats.hits + st.stats.cuts;
  const queue = [];
  let lock = 0;
  for (let t = 0; t < 120; t += 1 / hz) {
    const now = g.getState();
    if (now.phase !== 'playing' || now.meadow !== level) break;
    queue.push(now);
    const back = Math.round(lag * hz);
    const seen = queue.length > back ? queue[queue.length - 1 - back] : now;
    const held = [];
    const pressed = [];
    if (seen.line.move === 'go' && seen.hint)
      held.push(...steer(seen.hint.x - now.player.x, seen.hint.y - now.player.y));
    else if (seen.line.move === 'space' && lock <= 0) {
      pressed.push('Space');
      lock = 0.3 + lag;
    }
    lock -= 1 / hz;
    g.update(1 / hz, input(held, pressed));
  }
  const end = g.getState();
  return end.stats.hits + end.stats.cuts - before;
}

test('a prompt follower dropped in anywhere is never led into a sting or a cut at 0 and 0.25 s of lag, and almost never at 0.5 s', () => {
  const contact = { 0: 0, 0.25: 0, 0.5: 0 };
  const total = { 0: 0, 0.25: 0, 0.5: 0 };
  for (const level of MOTH_MEADOWS)
    for (const hz of [30, 120])
      for (const lag of [0, 0.25, 0.5])
        for (let seed = 1; seed <= 6; seed++) {
          const hurt = followFromAnywhere(level, hz, lag, seed);
          if (hurt === null) continue;
          total[lag]++;
          if (hurt > 0) contact[lag]++;
          if (lag < 0.5)
            assert.equal(
              hurt,
              0,
              `meadow ${level} @${hz} Hz, lag ${lag}, seed ${seed}: ${hurt} contact(s)`,
            );
        }
  console.log(`contacts from anywhere: ${JSON.stringify(contact)} of ${JSON.stringify(total)}`);
  assert.ok(
    contact[0.5] <= Math.ceil(total[0.5] * 0.03),
    `${contact[0.5]} of ${total[0.5]} at 0.5 s`,
  );
});

// How many times the drawn line changes within any one second, not counting changes the player's
// own action forced (a trail begun, closed, cut or a light lost).
function worstChurn(level, hz, lag) {
  const { g } = begin(level, 5);
  const queue = [];
  const changes = [];
  let lock = 0;
  let last = null;
  let events = '';
  for (let t = 0; t < 120; t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.meadow !== level) break;
    queue.push(st);
    const mark = `${st.stats.loops}/${st.stats.cuts}/${st.stats.hits}/${st.trail.on}`;
    const forced = mark !== events;
    events = mark;
    if (st.line.en !== last) {
      if (last !== null && !forced) changes.push(t);
      last = st.line.en;
    }
    const back = Math.round(lag * hz);
    const seen = queue.length > back ? queue[queue.length - 1 - back] : st;
    const held = [];
    const pressed = [];
    if (seen.line.move === 'go' && seen.hint)
      held.push(...steer(seen.hint.x - st.player.x, seen.hint.y - st.player.y));
    else if (seen.line.move === 'space' && lock <= 0) {
      pressed.push('Space');
      lock = 0.3 + lag;
    }
    lock -= 1 / hz;
    g.update(1 / hz, input(held, pressed));
  }
  let worst = 0;
  for (let i = 0; i < changes.length; i++) {
    let n = 0;
    for (let j = i; j < changes.length && changes[j] < changes[i] + 1; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

test('the prompt line changes at most three times in any second (four at half a second of lag), wait and back-away included', () => {
  // Holding a warning back to calm the line was tried and rejected: delaying a "wait" or a
  // "press Space" produced stings and cuts (and a hysteresis band deadlocked meadow 11).
  let worstAt = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const hz of [30, 120])
      for (const lag of [0, 0.25, 0.5]) {
        const worst = worstChurn(level, hz, lag);
        if (lag < 0.5) worstAt = Math.max(worstAt, worst);
        assert.ok(
          worst <= (lag >= 0.5 ? 4 : 3),
          `meadow ${level} @${hz} Hz, lag ${lag}: ${worst} changes in one second`,
        );
      }
  assert.ok(worstAt <= 3);
});

// Blind policies read no state at all.
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const CRUDE = {
  random: (rnd) => {
    let keys = [];
    let until = 0;
    return (t) => {
      if (t >= until) {
        until = t + 0.2 + rnd() * 0.3;
        keys = ARROWS.filter(() => rnd() < 0.3);
      }
      return [keys, rnd() < 0.08 ? ['Space'] : rnd() < 0.02 ? ['KeyX'] : []];
    };
  },
  mash: () => () => [[], ['Space']],
  holdspam: (rnd) => {
    const key = pick(rnd, ARROWS);
    return (t) => [[key], Math.floor(t * 10) !== Math.floor((t - 1 / 60) * 10) ? ['Space'] : []];
  },
  circle: (rnd) => {
    const side = 0.6 + rnd() * 2.9;
    const order =
      rnd() < 0.5
        ? ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']
        : ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
    let lastLeg = -1;
    return (t) => {
      const cycle = (t / side) | 0;
      const leg = cycle % 4;
      const press = cycle !== lastLeg && leg === 0 ? ['Space'] : [];
      if (cycle !== lastLeg && leg === 0 && t > 0.05) press.push('Space');
      lastLeg = cycle;
      return [[order[leg]], press];
    };
  },
  pulse: (rnd) => {
    let key = pick(rnd, ARROWS);
    let moving = true;
    let since = 0;
    return (t) => {
      let pressed = [];
      if (moving && t - since >= 0.7) {
        moving = false;
        since = t;
        pressed = ['Space'];
      } else if (!moving && t - since >= 0.3) {
        moving = true;
        since = t;
        key = pick(rnd, ARROWS);
      }
      return [moving ? [key] : [], pressed];
    };
  },
};

function crudeWins(name, level, runs, seconds) {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const { g } = begin(level, seed);
    const rnd = seeded(seed * 97 + level);
    const policy = CRUDE[name](rnd);
    let lastPressed = false;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.meadow !== level) break;
      const [held, pressed] = policy(t);
      // Mash presses on every frame: the host delivers one press per key-down.
      g.update(1 / 60, input(held, lastPressed && name === 'mash' ? [] : pressed));
      lastPressed = pressed.length > 0;
    }
    if (cleared({ s: g.getState(), level })) wins++;
  }
  return wins;
}

test('crude policies win at most half the runs in every meadow: random keys, mashing, spam, holding one way, circling and the pulse policy', () => {
  const report = [];
  for (const name of Object.keys(CRUDE)) {
    const row = [];
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const runs = 10;
      const wins = crudeWins(name, level, runs, 90);
      row.push(wins);
      assert.ok(wins <= 3, `${name} cleared meadow ${level} in ${wins}/${runs} runs`);
    }
    report.push(`${name.padEnd(10)} ${row.join(' ')}`);
  }
  console.log(`crude wins/10 in 90 s:\n${report.join('\n')}`);
});

test('the same crude policies stay at or under half with a 300 s budget (dawn, then the lights, run out)', () => {
  for (const name of Object.keys(CRUDE))
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const wins = crudeWins(name, level, 6, 300);
      assert.ok(wins <= 2, `${name} cleared meadow ${level} in ${wins}/6 long runs`);
    }
});

// A free-play bot that ignores the prompt and the guide completely. It watches the fireflies for a
// few seconds, boxes the cluster nearest to it (every firefly within `group` px of the nearest
// one) with a margin, walks the four corners, presses Space, and starts again whenever its trail
// is gone. `cautious` makes it stop when a moth, extrapolated linearly, would meet it.
function freeBot(
  level,
  { hz = 60, group = 110, margin = 34, cautious = true, observe = 6, limit = 0 } = {},
) {
  const { g } = begin(level, 1);
  const extent = {};
  let previous = null;
  let plan = null;
  let lockUntil = 0;
  for (let f = 0, t = 0; t < 140; f++, t += 1 / hz) {
    const st = g.getState();
    if (st.phase !== 'playing' || st.meadow !== level) break;
    const me = st.player;
    for (const fl of st.flies) {
      if (!fl.alive) continue;
      const e = (extent[fl.id] ||= { x0: fl.x, x1: fl.x, y0: fl.y, y1: fl.y });
      e.x0 = Math.min(e.x0, fl.x);
      e.x1 = Math.max(e.x1, fl.x);
      e.y0 = Math.min(e.y0, fl.y);
      e.y1 = Math.max(e.y1, fl.y);
    }
    const moths = st.moths.map((m, i) => ({
      ...m,
      vx: previous ? (m.x - previous[i].x) * hz : 0,
      vy: previous ? (m.y - previous[i].y) * hz : 0,
    }));
    previous = st.moths.map((m) => ({ x: m.x, y: m.y }));
    let held = [];
    let pressed = [];
    if (t >= observe) {
      if (!plan) {
        const alive = st.flies.filter((x) => x.alive);
        if (alive.length) {
          alive.sort(
            (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
          );
          const first = alive[0];
          // Either every firefly within `group` px, or (limit) greedily as many as keep the box
          // inside the light's reach.
          const mates = limit
            ? [first]
            : alive.filter((o) => Math.hypot(o.x - first.x, o.y - first.y) < group);
          if (limit)
            for (const o of alive.slice(1)) {
              const c = [...mates, o];
              const w =
                Math.max(...c.map((q) => extent[q.id].x1)) -
                Math.min(...c.map((q) => extent[q.id].x0));
              const h =
                Math.max(...c.map((q) => extent[q.id].y1)) -
                Math.min(...c.map((q) => extent[q.id].y0));
              if ((w + 2 * margin) * (h + 2 * margin) <= limit) mates.push(o);
            }
          const x0 = Math.max(14, Math.min(...mates.map((o) => extent[o.id].x0)) - margin);
          const x1 = Math.min(466, Math.max(...mates.map((o) => extent[o.id].x1)) + margin);
          const y0 = Math.max(38, Math.min(...mates.map((o) => extent[o.id].y0)) - margin);
          const y1 = Math.min(284, Math.max(...mates.map((o) => extent[o.id].y1)) + margin);
          plan = {
            pts: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ],
            i: 0,
            started: false,
          };
        }
      }
      if (plan && plan.started && !st.trail.on) plan = null;
      if (plan) {
        const target = plan.pts[Math.min(plan.i, 3)];
        if (plan.started && plan.i >= 4) {
          if (t >= lockUntil) {
            pressed = ['Space'];
            lockUntil = t + 0.3;
            plan = null;
          }
        } else if (Math.hypot(target.x - me.x, target.y - me.y) < 4) {
          if (!plan.started) {
            if (t >= lockUntil) {
              pressed = ['Space'];
              plan.started = true;
              plan.i = 1;
              lockUntil = t + 0.3;
            }
          } else plan.i++;
        } else {
          held = steer(target.x - me.x, target.y - me.y, 1.5);
          if (cautious) {
            const dx = (held.includes('ArrowRight') ? 1 : 0) - (held.includes('ArrowLeft') ? 1 : 0);
            const dy = (held.includes('ArrowDown') ? 1 : 0) - (held.includes('ArrowUp') ? 1 : 0);
            const k = dx && dy ? Math.SQRT1_2 : 1;
            let danger = false;
            for (const m of moths)
              for (let s = 0; s <= 1.6 && !danger; s += 0.1) {
                const px = me.x + dx * k * SPEED * s;
                const py = me.y + dy * k * SPEED * s;
                const mx = m.x + m.vx * s;
                const my = m.y + m.vy * s;
                if (Math.hypot(px - mx, py - my) < m.r + 5 + 16) danger = true;
                if (st.trail.on)
                  for (const q of st.trail.points)
                    if (Math.hypot(q.x - mx, q.y - my) < m.r + 14) danger = true;
              }
            if (danger) held = [];
          }
        }
      }
    }
    g.update(1 / hz, input(held, pressed));
  }
  const end = g.getState();
  return end.meadow > level || end.phase === 'won';
}

const FREE_BOTS = {
  'cautious box': {},
  'box without dodging': { cautious: false },
  'one giant loop': { group: 1000, margin: 24 },
  'big margin, no wait': { cautious: false, observe: 0, margin: 60 },
  'greedy box inside the limit': { limit: 8000, margin: 18, observe: 5 },
};

test('free-play bots that ignore the prompt and guide win at most half the runs on at least 15 meadows and on at most half of the late ones', () => {
  const report = [];
  for (const [name, options] of Object.entries(FREE_BOTS)) {
    let hard = 0;
    let lateWins = 0;
    const row = [];
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const wins = [30, 60].filter((hz) => freeBot(level, { hz, ...options })).length;
      row.push(wins);
      if (wins <= 1) hard++;
      if (level >= 9 && wins === 2) lateWins++;
    }
    report.push(`${name.padEnd(28)} ${row.join('')}`);
    // The greedy bot knows the light's reach, so it is only held to half of the late meadows.
    assert.ok(hard >= (options.limit ? 8 : 15), `${name}: only ${hard} meadows resist it`);
    assert.ok(lateWins <= 8, `${name} wins ${lateWins} of the 16 late meadows at both rates`);
  }
  console.log(`free-play wins out of 2 per meadow:\n${report.join('\n')}`);
});

test('the drawn prompt line names a key, matches the state and fits the bottom band', () => {
  const KEY = /Space|Arrows/;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 5, 9, 24]) {
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
                if (y === 306 && state.textAlign === 'center') seen.push(str);
              };
            return p in state ? state[p] : p in target ? target[p] : () => {};
          },
          set: (target, p, v) => ((state[p] = v), true),
        },
      );
      const { g } = begin(level, 7, lang);
      for (let f = 0; f < 600; f++) {
        seen.length = 0;
        g.draw(ctx);
        const st = g.getState();
        const line = st.line[lang];
        assert.equal(seen[0], line);
        assert.ok(KEY.test(st.line.en) && /空格|方向键/.test(st.line.zh));
        const width = [...line].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? 14 : 8.4), 0);
        assert.ok(width <= 400, `"${line}" is ${width}px wide`);
        g.update(1 / 60, input(f % 90 < 45 ? ['ArrowRight'] : ['ArrowDown']));
      }
    }
});
