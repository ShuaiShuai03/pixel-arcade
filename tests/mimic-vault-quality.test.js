import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RULES, ROOM_COUNT } from '../src/games/mimic-vault.js';
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const ACTION_KEY = [
  [/Press Space/, 'Space'],
  [/Press X/, 'KeyX'],
  [/[Pp]ress Z/, 'KeyZ'],
];

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

// A human-like player that sees only what the screen shows: the prompt text, the marker and the
// drawn actors. It reacts `delay` seconds late, brakes by dead reckoning, answers every distinct
// instruction once (and again only after three seconds), and can drop keys or slip.
function humanRun(
  seed,
  hz,
  {
    level = 1,
    delay = FAST,
    drop = 0,
    slip = 0,
    jitterDt = false,
    seconds = 160,
    campaign = false,
    wander = false,
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
  let slipUntil = 0;
  let slipKeys = [];
  let t = 0;
  const every = Math.max(1, Math.round(hz / 30));
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    if (!campaign && st.room !== level) break;
    const dt = jitterDt ? Math.min(1 / 30, (0.6 + rnd() * 0.8) / hz) : 1 / hz;
    history.push({ t, st, dt, keys: null });
    if (history.length > 90) history.shift();
    let pressed = [];
    if (f % every === 0) {
      // Perception never runs backwards: what I have already seen I do not un-see.
      const seenAt = Math.max(lastSeen, t - (base + (rnd() - 0.5) * jitter));
      lastSeen = seenAt;
      let k = history.length - 1;
      while (k > 0 && history[k].t > seenAt) k--;
      const d = t - history[k].t;
      const obs = history[k].st;
      held = [];
      const prompt = obs.prompt.en;
      const action = ACTION_KEY.find(([re]) => re.test(prompt));
      if (action) {
        if (acted.text !== prompt || t - acted.t > 3) {
          acted = { text: prompt, t };
          pressed = [action[1]];
          if (wander && /stop recording/.test(prompt)) {
            // Step off the plate right after stopping, before sending the echo.
            slipUntil = t + 0.4;
            slipKeys = [MOVE_KEYS[Math.floor(rnd() * 4)]];
          }
        }
      } else if (obs.hint) {
        // Dead reckoning: where I saw myself, plus what my own keys have done since.
        let x = obs.player.x;
        let y = obs.player.y;
        for (let j = k; j < history.length - 1; j++) {
          const { keys: used, dt: span } = history[j];
          const mx = (used.includes('ArrowRight') ? 1 : 0) - (used.includes('ArrowLeft') ? 1 : 0);
          const my = (used.includes('ArrowDown') ? 1 : 0) - (used.includes('ArrowUp') ? 1 : 0);
          const scale = mx && my ? Math.SQRT1_2 : 1;
          x += mx * RULES.speed * scale * span;
          y += my * RULES.speed * scale * span;
        }
        if (obs.hint.x - x > 3) held.push('ArrowRight');
        else if (obs.hint.x - x < -3) held.push('ArrowLeft');
        if (obs.hint.y - y > 3) held.push('ArrowDown');
        else if (obs.hint.y - y < -3) held.push('ArrowUp');
      }
      if (drop && rnd() < drop) held = [];
      if (slip && t > slipUntil && rnd() < slip) {
        slipUntil = t + 0.2;
        slipKeys = [MOVE_KEYS[Math.floor(rnd() * 4)]];
      }
    }
    const keys = t < slipUntil ? slipKeys : held;
    history.at(-1).keys = keys;
    if (log) log(st, keys, pressed, t, g);
    g.update(dt, input(keys, pressed));
    t += dt;
  }
  return { s: g.getState(), ends: h.ends, t, level };
}

const cleared = (r) => r.s.room > r.level || r.s.phase === 'won';
const SEEDS = 10; // x 3 frame rates = 30 runs per room and reaction speed

function roomRates(delay, minWins) {
  const report = [];
  for (let level = 1; level <= ROOM_COUNT; level++) {
    let wins = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++)
        if (cleared(humanRun(seed + level * 100, hz, { level, delay }))) wins++;
    report.push(`${level}:${wins}`);
    assert.ok(
      wins >= minWins,
      `room ${level}: only ${wins}/30 runs cleared it (${report.join(' ')})`,
    );
  }
  return report;
}

test('a delayed player (0.15-0.35 s) using only the screen clears every room in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  const report = roomRates(FAST, 27);
  console.log(`per-room wins, fast reactions: ${report.join(' ')}`);
});

test('a slow player (0.4-0.6 s with jitter) clears every room in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  const report = roomRates(SLOW, 24);
  console.log(`per-room wins, slow reactions: ${report.join(' ')}`);
});

test('the whole 22-room campaign is won in at least 27 of 30 runs at each frame rate', () => {
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

test('the slow player also finishes the campaign in at least 24 of 30 runs at 60 Hz', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++)
    if (humanRun(seed, 60, { campaign: true, seconds: 2000, delay: SLOW }).s.phase === 'won')
      wins++;
  console.log(`slow campaign wins at 60 Hz: ${wins}/30`);
  assert.ok(wins >= 24, `only ${wins}/30 slow campaigns won`);
});

test('perturbed input (dropped keys, slips, irregular frame times) still clears representative rooms', () => {
  const cases = [{ drop: 0.1 }, { drop: 0.25 }, { slip: 0.003 }, { jitterDt: true }];
  for (const c of cases)
    for (const level of [1, 4, 5, 9, 13, 21, 22]) {
      let wins = 0;
      for (const hz of HZS)
        for (let seed = 1; seed <= 4; seed++)
          if (cleared(humanRun(seed, hz, { level, ...c }))) wins++;
      assert.ok(wins >= 10, `${JSON.stringify(c)} room ${level}: ${wins}/12`);
    }
});

test('prompts name keys, are held at least half a second, rarely flip back and never lead into a dead state', () => {
  let changes = 0;
  let flips = 0;
  let minHold = Infinity;
  for (const hz of HZS)
    for (const level of [1, 4, 6, 9, 13, 19, 21, 22]) {
      let last = null;
      let before = null;
      let changedAt = 0;
      let room = 0;
      const r = humanRun(level, hz, {
        level,
        log: (st, _k, _p, t) => {
          assert.ok(
            /Space|\bX\b|\bZ\b|Arrows|Stand still/.test(st.prompt.en),
            `prompt without a key: ${st.prompt.en}`,
          );
          assert.ok(/空格|X|Z|方向键|站着别动/.test(st.prompt.zh), st.prompt.zh);
          assert.ok(st.prompt.en.length <= 50 && st.prompt.zh.length <= 30, st.prompt.en);
          if (st.room !== room) {
            room = st.room;
            last = null;
            before = null;
          }
          if (st.prompt.en === last) return;
          if (last !== null) {
            minHold = Math.min(minHold, t - changedAt);
            assert.ok(t - changedAt >= 0.5 - 1e-6, `"${last}" changed after ${t - changedAt}s`);
            changes++;
            if (st.prompt.en === before) flips++;
          }
          before = last;
          last = st.prompt.en;
          changedAt = t;
        },
      });
      assert.ok(cleared(r), `level ${level} @${hz}`);
    }
  assert.ok(changes > 60 && minHold >= 0.5 - 1e-6);
  assert.ok(flips / changes < 0.15, `${flips}/${changes} prompts flipped straight back`);
});

test('the marker never points into a wall or a closed door', () => {
  let checks = 0;
  for (const level of [2, 3, 11, 20, 21]) {
    humanRun(3, 60, {
      level,
      log: (st) => {
        if (!st.hint) return;
        const inside = (a) =>
          st.walls.some((w) => a.x > w.x && a.x < w.x + w.w && a.y > w.y && a.y < w.y + w.h);
        assert.ok(!inside(st.hint) && !inside(st.hint.goal), `marker in a wall in room ${level}`);
        for (const d of st.doors)
          if (!d.open)
            for (const c of d.cells)
              assert.ok(
                !(
                  st.hint.x > c.x &&
                  st.hint.x < c.x + c.w &&
                  st.hint.y > c.y &&
                  st.hint.y < c.y + c.h
                ),
                'marker inside a closed door',
              );
        checks++;
      },
    });
  }
  assert.ok(checks > 500);
});

test('crude policies never win: random input, mashing the action keys, never recording, only recording', () => {
  const keys = [...MOVE_KEYS, 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const policies = {
    random: (rnd) => ({ held: [keys[Math.floor(rnd() * keys.length)]], pressed: [] }),
    mash: (rnd) => ({
      held: [keys[Math.floor(rnd() * keys.length)]],
      pressed: rnd() < 0.05 ? [['Space', 'KeyX', 'KeyZ'][Math.floor(rnd() * 3)]] : [],
    }),
    neverRecord: (rnd) => ({
      held: [keys[Math.floor(rnd() * keys.length)]],
      pressed: rnd() < 0.05 ? [['KeyX', 'KeyZ'][Math.floor(rnd() * 2)]] : [],
    }),
    onlyRecord: (rnd) => ({
      held: [MOVE_KEYS[Math.floor(rnd() * 4)]],
      pressed: rnd() < 0.03 ? ['Space'] : [],
    }),
  };
  for (const [name, policy] of Object.entries(policies))
    for (let level = 1; level <= ROOM_COUNT; level += 3) {
      const { g, h } = begin(level, 5);
      const rnd = seeded(level * 13 + name.length);
      let held = [];
      for (let i = 0; i < 20000; i++) {
        if (i % 12 === 0) held = policy(rnd).held;
        g.update(1 / 60, input(held, i % 12 === 0 ? policy(rnd).pressed : []));
      }
      const s = g.getState();
      assert.ok(s.room === level && s.phase === 'playing', `${name} escaped room ${level}`);
      assert.equal(h.ends.length, 0);
    }
});

test('timed doors give humane windows and pair doors stay open long enough to cross', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    const { g } = begin(level, 1);
    for (const d of g.getState().doors) {
      // Rooms 15-22 size their windows to the walk (see the mastery test); the rest are generous.
      if (level >= 15) continue;
      if (d.needs.length > 1) assert.ok(d.hold >= 8, `pair door ${d.id} in room ${level}`);
      if (d.hold) assert.ok(d.hold >= 6, `timed door ${d.id} in room ${level}`);
    }
  }
  assert.ok(RULES.maxRec >= 10);
});

test('F1: a player who steps off the plate after recording still clears every room', () => {
  for (let level = 1; level <= ROOM_COUNT; level++) {
    let wins = 0;
    for (const hz of HZS)
      for (let seed = 1; seed <= 4; seed++)
        if (cleared(humanRun(seed + level, hz, { level, wander: true }))) wins++;
    assert.ok(wins >= 11, `room ${level}: only ${wins}/12 wandering runs cleared it`);
  }
});

test('F2: the drawn top line names a key, holds at least half a second without input and never overflows', () => {
  const KEY = /Space|\bX\b|\bZ\b|Arrows|Stand still|空格|方向键|站着别动/;
  let changes = 0;
  for (const lang of ['en', 'zh'])
    for (const level of [1, 4, 6, 9, 21])
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
                  if (y === 6 && state.textAlign === 'center') seen.push(str);
                };
              return p in state ? state[p] : p in target ? target[p] : () => {};
            },
            set: (target, p, v) => ((state[p] = v), true),
          },
        );
        let last = null;
        let lastAt = 0;
        let lastRoom = 0;
        let continue_ = false;
        let prevPressed = false;
        const { g, h } = (() => {
          const b = begin(level, 7, lang);
          return b;
        })();
        const rnd = seeded(level * 3 + hz);
        let held = [];
        for (let f = 0, t = 0; t < 70; f++, t += 1 / hz) {
          const st = g.getState();
          if (st.room !== level) break;
          seen.length = 0;
          g.draw(ctx);
          if (st.menu) {
            assert.ok(KEY.test(st.line.en) && KEY.test(st.line.zh));
            last = null;
            continue_ = true;
          } else continue_ = false;
          const line = continue_ ? st.line[lang] : seen[0];
          assert.ok(line && KEY.test(line), `line without a key: "${line}"`);
          const w = [...line].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? 14 : 8.4), 0);
          assert.ok(w <= 400, `"${line}" is ${w}px wide and would meet the room counter`);
          assert.equal(line, lang === 'en' ? st.line.en : st.line.zh);
          if (line !== last) {
            if (last !== null && st.room === lastRoom && !prevPressed) {
              assert.ok(
                t - lastAt >= 0.5 - 1e-6,
                `"${last}" -> "${line}" after ${t - lastAt}s without input (${lang} room ${level} @${hz} t=${t.toFixed(2)})`,
              );
              changes++;
            }
            last = line;
            // A press takes effect at the start of the previous update, one frame before it is drawn.
            lastAt = prevPressed ? t - 1 / hz : t;
          }
          lastRoom = st.room;
          // A scripted, slightly chaotic player: presses now and then, wanders in between.
          if (f % Math.round(hz / 10) === 0)
            held = rnd() < 0.3 ? [] : [MOVE_KEYS[Math.floor(rnd() * 4)]];
          const pressed =
            f % hz === 0 && rnd() < 0.7 ? [['Space', 'KeyX', 'KeyZ'][Math.floor(rnd() * 3)]] : [];
          prevPressed = pressed.length > 0;
          g.update(1 / hz, input(held, pressed));
          void h;
        }
      }
  assert.ok(changes > 20, `only ${changes} unforced changes observed`);
});
