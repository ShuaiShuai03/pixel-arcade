import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, segHitsRect } from '../src/games/tether-twins.js';

const lineTouches = (a, b, r) => segHitsRect(a, b, r, 0.01);
import { harness, input, seeded } from './harness.js';

const HZS = [30, 60, 120];
const H = 11;
const MOVE_KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS'];

// A human-like player that sees only what the screen shows (prompt text, marker, drawn robots),
// reacts 0.15-0.35 s late, brakes by dead reckoning, presses X at most every 0.7 s, and can
// have its keys dropped or replaced to model slips.
function humanRun(
  seed,
  hz,
  { drop = 0, slip = 0, jitterDt = false, seconds = 240, log, delay = [0.15, 0.35] } = {},
) {
  const h = harness({ seed });
  const g = createGame(h.env);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const history = [];
  let held = [];
  let pressX = false;
  let lastX = -9;
  let slipUntil = 0;
  let slipKeys = [];
  let t = 0;
  const every = Math.max(1, Math.round(hz / 30));
  for (let f = 0; t < seconds; f++) {
    const st = g.getState();
    if (st.phase !== 'playing') break;
    history.push({ t, st });
    if (history.length > 80) history.shift();
    pressX = false;
    if (f % every === 0) {
      const d = base + (rnd() - 0.5) * 0.1;
      let k = history.length - 1;
      while (k > 0 && t - history[k].t < d) k--;
      const obs = history[k].st;
      held = [];
      const hint = obs.hint;
      if (hint && hint.who === 'any') held.push(/Hold F/.test(obs.prompt.en) ? 'KeyF' : 'KeyG');
      else if (hint && hint.who !== obs.active) {
        if (t - lastX > 0.7) {
          lastX = t;
          pressX = true;
        }
      } else if (hint) {
        const me = obs.robots.find((r) => r.id === obs.active);
        const px = me.x + me.vx * d * 0.9;
        const py = me.y + me.vy * d * 0.9;
        if (hint.x - px > 3) held.push('KeyD');
        else if (hint.x - px < -3) held.push('KeyA');
        if (hint.y - py > 3) held.push('KeyS');
        else if (hint.y - py < -3) held.push('KeyW');
      }
      if (drop && rnd() < drop) held = [];
      if (slip && t > slipUntil && rnd() < slip) {
        slipUntil = t + 0.2;
        slipKeys = [MOVE_KEYS[Math.floor(rnd() * 4)]];
      }
    }
    const keys = t < slipUntil ? slipKeys : held;
    if (log) log(st, keys, pressX, t);
    const dt = jitterDt ? Math.min(1 / 30, (0.6 + rnd() * 0.8) / hz) : 1 / hz;
    g.update(dt, input(keys, pressX ? ['KeyX'] : []));
    t += dt;
  }
  const s = g.getState();
  return { s, ends: h.ends };
}

test('a delayed, jittery player using only the screen wins solo at 30, 60 and 120 Hz in at least 27 of 30 seeds', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { s, ends } = humanRun(seed, hz);
      if (s.phase === 'won') {
        wins++;
        assert.equal(ends.length, 1);
      }
    }
    assert.ok(wins >= 27, `${hz} Hz: only ${wins}/30 runs won`);
  }
});

test('a slow-reacting player (0.4-0.6 s) still wins solo at 30, 60 and 120 Hz in at least 24 of 30 seeds', () => {
  for (const hz of HZS) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { s } = humanRun(seed, hz, { delay: [0.4, 0.6] });
      if (s.phase === 'won') wins++;
    }
    assert.ok(wins >= 24, `${hz} Hz: only ${wins}/30 slow runs won`);
  }
});

test('slow and fast players never leave a phantom bend on a wall corner', () => {
  const phantom = (st) => {
    const pts = st.cable.path;
    const onPost = (p) =>
      st.posts.some(
        (q) => (p.x === q.x || p.x === q.x + q.w) && (p.y === q.y || p.y === q.y + q.h),
      );
    for (let k = 1; k < pts.length - 1; k++) {
      if (onPost(pts[k])) continue;
      const a = pts[k - 1],
        b = pts[k + 1];
      const hit = st.solids.some((r) => {
        const t = (min, max, lo, hi) => !(max < lo || min > hi);
        return (
          t(Math.min(a.x, b.x), Math.max(a.x, b.x), r.x - 0.5, r.x + r.w + 0.5) &&
          t(Math.min(a.y, b.y), Math.max(a.y, b.y), r.y - 0.5, r.y + r.h + 0.5) &&
          lineTouches(a, b, r)
        );
      });
      if (!hit) return true;
    }
    return false;
  };
  for (const delay of [
    [0.15, 0.35],
    [0.4, 0.6],
  ])
    for (const hz of HZS)
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        humanRun(seed, hz, {
          delay,
          log: (st, _k, _x, t) =>
            assert.ok(!phantom(st), `phantom bend seed ${seed} ${hz}Hz t=${t.toFixed(2)}`),
        });
      }
});

test('perturbed input (dropped keys, slips, irregular frame times) still clears the campaign', () => {
  const cases = [
    { drop: 0.1 },
    { drop: 0.25 },
    { slip: 0.01 },
    { jitterDt: true },
    { drop: 0.1, slip: 0.005, jitterDt: true },
  ];
  for (const c of cases)
    for (const hz of HZS) {
      let wins = 0;
      for (let seed = 1; seed <= 12; seed++) if (humanRun(seed, hz, c).s.phase === 'won') wins++;
      assert.ok(wins >= 10, `${JSON.stringify(c)} @${hz}: ${wins}/12`);
    }
});

test('prompts name keys, are held for at least half a second and never oscillate', () => {
  for (const hz of HZS)
    for (const seed of [3, 9, 21]) {
      let last = null;
      let changedAt = 0;
      let key = '';
      const seen = new Set();
      humanRun(seed, hz, {
        log: (st, _keys, _x, t) => {
          const reset = `${st.room}/${st.stats.zaps}`;
          if (st.prompt.en !== last) {
            if (key === reset && last !== null)
              assert.ok(
                t - changedAt >= 0.5 - 1e-6,
                `prompt "${last}" changed after ${t - changedAt}s`,
              );
            last = st.prompt.en;
            changedAt = t;
            seen.add(last);
          }
          key = reset;
          assert.ok(
            /\b(WASD|Arrows|Press X|[Hh]old [FG])/.test(st.prompt.en),
            `prompt without a key: ${st.prompt.en}`,
          );
          assert.ok(/WASD|X|F|G|方向键/.test(st.prompt.zh), st.prompt.zh);
          assert.ok(st.prompt.en.length <= 50 && st.prompt.zh.length <= 30, st.prompt.en);
        },
      });
      assert.ok(seen.size >= 20, `only ${seen.size} distinct prompts seen`);
    }
});

test('the marker never leads a robot into a live strip or onto a hazard', () => {
  const overlaps = (r, hz) =>
    r.x < hz.x + hz.w - 0.5 &&
    r.x + r.w > hz.x + 0.5 &&
    r.y < hz.y + hz.h - 0.5 &&
    r.y + r.h > hz.y + 0.5;
  let checks = 0;
  for (const hz of HZS) {
    let lastHint = '';
    humanRun(5, hz, {
      log: (st) => {
        if (!st.hint || st.hint.x == null) return;
        const id = `${st.room}:${st.prompt.en}:${st.hint.x}:${st.hint.y}`;
        if (id === lastHint) return;
        lastHint = id;
        const me = st.robots.find((r) => r.id === st.hint.who) || st.robots[0];
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const x = me.x + ((st.hint.x - me.x) * i) / steps;
          const y = me.y + ((st.hint.y - me.y) * i) / steps;
          for (const h of st.hazards)
            assert.ok(
              !overlaps({ x: x - H, y: y - H, w: 22, h: 22 }, h),
              `marker path crosses a strip in room ${st.room}`,
            );
        }
        checks++;
      },
    });
  }
  assert.ok(checks > 40);
});

test('solo never needs simultaneous inputs from different hands: one key family at a time', () => {
  let frames = 0;
  humanRun(11, 60, {
    log: (_st, keys, pressX) => {
      frames++;
      const moves = keys.filter((k) => MOVE_KEYS.includes(k));
      const winch = keys.filter((k) => k === 'KeyF' || k === 'KeyG');
      assert.ok(moves.length <= 2 && !(moves.length && winch.length), `keys ${keys}`);
      assert.ok(winch.length <= 1);
      assert.ok(!(pressX && keys.length), 'X is pressed on its own');
    },
  });
  assert.ok(frames > 1000);
});

test('rooms teach, combine and master: three distinct rooms with their own mechanics', () => {
  const rooms = new Map();
  let relayLocked = false;
  const { s } = humanRun(2, 60, {
    log: (st) => {
      if (!rooms.has(st.room))
        rooms.set(st.room, {
          name: st.roomName.en,
          plates: st.plates.length,
          gates: Object.keys(st.gates).length,
          hazards: st.hazards.length,
          relays: st.posts.filter((p) => p.relay).length,
          posts: st.posts.length,
          spool: st.cable.spool,
        });
      relayLocked ||= st.posts.some((p) => p.latched);
    },
  });
  assert.equal(s.phase, 'won');
  assert.equal(rooms.size, 3);
  const [one, two, three] = [...rooms.values()];
  assert.equal(one.posts, 0);
  assert.ok(two.posts >= 1 && two.relays === 0 && two.hazards > one.hazards - 1);
  assert.ok(three.relays === 1 && three.gates === 2 && three.posts === 2);
  assert.equal(new Set([one.name, two.name, three.name]).size, 3);
  assert.ok(relayLocked);
});

test('layout stays readable on a 390x844 phone: text scales to at least 11 CSS px and fits the canvas', () => {
  const scale = 390 / 480;
  const calls = [];
  const state = { font: '' };
  const ctx = new Proxy(
    {
      measureText: (t) => ({ width: String(t).length * 8.4 }),
      canvas: { width: 480, height: 320 },
    },
    {
      get: (t, p) => {
        if (p === 'fillText')
          return (str, x, y) => calls.push({ str, x, y, font: state.font, align: state.textAlign });
        return p in state ? state[p] : p in t ? t[p] : () => {};
      },
      set: (t, p, v) => ((state[p] = v), true),
    },
  );
  for (const lang of ['en', 'zh']) {
    calls.length = 0;
    const g = createGame(harness({ lang }).env);
    for (let i = 0; i < 90; i++) g.update(1 / 60, input([]));
    g.draw(ctx);
    assert.ok(calls.length >= 3);
    for (const c of calls) {
      const px = Number(/(\d+)px/.exec(c.font)[1]);
      assert.ok(px * scale >= 11, `${px}px scales below 11`);
      const w = [...c.str].reduce((n, ch) => n + (/[一-鿿]/.test(ch) ? px : px * 0.6), 0);
      const left = c.align === 'center' ? c.x - w / 2 : c.x;
      assert.ok(left >= 0 && left + w <= 480, `"${c.str}" overflows (${left}..${left + w})`);
    }
  }
  // Touch routes: every keyboard action has a labelled button in both layouts.
  const solo = new Set(meta.touchControls.map((c) => c.code));
  for (const code of ['KeyX', 'KeyF', 'KeyG']) assert.ok(solo.has(code));
  assert.equal(meta.multiplayerTouchControls.length, 12);
});
