import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  shapeHitsBody,
  ARENA,
  PLAY_TOP,
  PLAY_BOTTOM,
} from '../src/games/dash-duelist.js';
import { harness, input, seeded } from './harness.js';

const DIRS8 = [
  ['ArrowRight'],
  ['ArrowLeft'],
  ['ArrowUp'],
  ['ArrowDown'],
  ['ArrowRight', 'ArrowUp'],
  ['ArrowRight', 'ArrowDown'],
  ['ArrowLeft', 'ArrowUp'],
  ['ArrowLeft', 'ArrowDown'],
];
const vec = (keys) => {
  const dx = (keys.includes('ArrowRight') ? 1 : 0) - (keys.includes('ArrowLeft') ? 1 : 0);
  const dy = (keys.includes('ArrowDown') ? 1 : 0) - (keys.includes('ArrowUp') ? 1 : 0);
  const n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
};
const inArena = (x, y) => [
  Math.min(Math.max(x, ARENA.x0), ARENA.x1),
  Math.min(Math.max(y, ARENA.y0), ARENA.y1),
];

// A walker cannot pass through the rival, so such escape routes are not real options.
const pathBlocked = (me, vx, vy, rv) =>
  [11, 22, 33, 44].some(
    (k) => Math.abs(me.x + vx * k - rv.x) < 20 && Math.abs(me.y + vy * k - rv.y) < 28,
  );
const FAR_KEYS = (dx, dy) => {
  const keys = [];
  if (dx > 5) keys.push('ArrowRight');
  if (dx < -5) keys.push('ArrowLeft');
  if (dy > 5) keys.push('ArrowDown');
  if (dy < -5) keys.push('ArrowUp');
  return keys;
};
// Circle the rival at the edge of its reach: committed attacks do not follow, so moving sideways
// keeps the player out of the shape while waiting for the OPEN mark.
function strafe(me, rv, memory) {
  const ux = me.x - rv.x,
    uy = me.y - rv.y,
    d = Math.hypot(ux, uy) || 1;
  const reach = { reed: 40, mira: 78, kade: 44 }[rv.id];
  memory.dir ??= 1;
  const step = (dir) => {
    const tx = (-uy / d) * dir * 14,
      ty = (ux / d) * dir * 14;
    return [me.x + tx, me.y + ty];
  };
  let [nx, ny] = step(memory.dir);
  if (nx < ARENA.x0 + 4 || nx > ARENA.x1 - 4 || ny < ARENA.y0 + 4 || ny > ARENA.y1 - 4) {
    memory.dir = -memory.dir;
    [nx, ny] = step(memory.dir);
  }
  return FAR_KEYS(
    nx - me.x - ((d - reach) / d) * ux * 0.5,
    ny - me.y - ((d - reach) / d) * uy * 0.5,
  );
}

// Decide from one (delayed) view of the screen: the drawn telegraph, fighter positions, charges and
// the visible OPEN state. Nothing hidden is read. `lagEstimate` is the player's own reaction delay.
function decide(s, now, memory, lagEstimate) {
  // The player always knows where their own character is; only the rival's moves are seen late.
  const me = now.player,
    rv = s.rival;
  if (!rv) return { keys: [], press: [] };
  const tg = rv.telegraph;
  if (tg && !tg.active) {
    const id = `${tg.ox}:${tg.oy}:${tg.angle}:${tg.windup}`;
    const inside = shapeHitsBody(tg, me);
    let best = null;
    if (inside)
      for (const keys of DIRS8) {
        const [vx, vy] = vec(keys);
        const [x, y] = inArena(me.x + vx * 44, me.y + vy * 44);
        const d = Math.hypot(x - rv.x, y - rv.y);
        if (!shapeHitsBody(tg, { x, y }) && !pathBlocked(me, vx, vy, rv) && (!best || d < best.d))
          best = { keys, d };
      }
    // A human commits to a dash time when the telegraph is first noticed (timing from the growing
    // outline) and then presses at that moment, not at the next glance.
    if (inside && !memory.noDash && memory.plan?.id !== id)
      memory.plan = {
        id,
        at: now.time + Math.max(0, tg.remaining - lagEstimate - 0.1),
        fired: false,
      };
    const press = [];
    // No walkable way out (a heavy shape): head for the rival so the dash carries us through to it.
    return { keys: best ? best.keys : FAR_KEYS(rv.x - me.x, rv.y - me.y), press };
  }
  if (tg && tg.active) return { keys: [], press: [] };
  if (rv.vulnerable) {
    const dx = rv.x - me.x,
      dy = rv.y - me.y;
    if (Math.hypot(dx, dy) < 32) return { keys: [], press: ['Space'] };
    const keys = [];
    if (dx > 6) keys.push('ArrowRight');
    if (dx < -6) keys.push('ArrowLeft');
    if (dy > 6) keys.push('ArrowDown');
    if (dy < -6) keys.push('ArrowUp');
    return { keys, press: [] };
  }
  return { keys: strafe(me, rv, memory), press: [] };
}

export function play({
  hz,
  seed,
  lag = [0.15, 0.2],
  dash = true,
  watch = () => {},
  maxSeconds = 600,
}) {
  const h = harness({ seed }),
    game = createGame(h.env),
    random = seeded(seed * 131 + hz),
    dt = 1 / hz,
    history = [],
    memory = { noDash: !dash };
  let t = 0,
    next = 0,
    keys = [],
    lastPress = -9;
  while (t < maxSeconds) {
    const s = game.getState();
    watch(s, t);
    history.push({ t, s });
    if (history.length > 120) history.shift();
    if (s.phase !== 'playing') break;
    let pressed = [];
    const plan = memory.plan;
    if (plan && !plan.fired && s.time >= plan.at) {
      plan.fired = true;
      if (s.player.charges > 0) pressed.push('KeyX');
    }
    if (t >= next) {
      next = t + 0.08 + random() * 0.08;
      const seen =
        [...history].reverse().find((o) => o.t <= t - (lag[0] + random() * lag[1])) ?? history[0];
      const d = decide(seen.s, s, memory, lag[0] + lag[1] / 2);
      keys = d.keys;
      if (d.press.length && t - lastPress > 0.25) {
        pressed = [...pressed, ...d.press];
        lastPress = t;
      }
    }
    game.update(dt, input(keys, pressed));
    t += dt;
  }
  return { game, h, seconds: t };
}

for (const [label, lag, need] of [
  ['0.15-0.35 s reaction', [0.15, 0.2], 27],
  ['0.4-0.6 s reaction', [0.4, 0.2], 24],
]) {
  for (const hz of [30, 60, 120]) {
    test(`visible-information policy with ${label} wins ${need}/30 at ${hz} Hz`, () => {
      let wins = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const { game, h } = play({ hz, seed, lag });
        if (game.getState().phase === 'won') {
          wins++;
          assert.equal(h.ends.length, 1);
        }
      }
      assert.ok(wins >= need, `${wins}/30`);
    });
  }
}

test('prompts name keys, stay within width, and hold for at least 0.5 s', () => {
  const lens = { en: 0, zh: 0 };
  for (const seed of [3, 4, 5]) {
    let last = null,
      since = 0;
    const norm = (text) => text.replace(/ ?(or X: dash|\(no dash\))$/, '');
    const checkHold = (p, t, s) => {
      if (last !== null && norm(p) !== norm(last.p)) {
        const held = t - last.t;
        const forced =
          last.rivalNumber !== s.rivalNumber ||
          s.phase !== 'playing' ||
          s.rival === null ||
          last.rival === null;
        assert.ok(forced || held >= 0.5 - 1e-6, `prompt "${last.p}" held ${held.toFixed(2)} s`);
        last = { p, t, rivalNumber: s.rivalNumber, rival: s.rival };
      } else if (last === null) last = { p, t, rivalNumber: s.rivalNumber, rival: s.rival };
      since = t;
    };
    play({
      hz: 60,
      seed,
      watch: (s, t) => {
        checkHold(s.prompt.en, t, s);
        lens.en = Math.max(lens.en, s.prompt.en.length);
        lens.zh = Math.max(lens.zh, s.prompt.zh.length);
        assert.ok(s.status.en.endsWith(s.prompt.en));
      },
    });
    assert.ok(since > 0);
  }
  assert.ok(lens.en <= 46, `en ${lens.en}`);
  assert.ok(lens.zh <= 26, `zh ${lens.zh}`);
});

test('telegraph windows are at least 0.5 s and fighters stay between the HUD bands', () => {
  let minWindup = 9;
  for (const seed of [1, 2, 3]) {
    play({
      hz: 60,
      seed,
      watch: (s) => {
        const tg = s.rival && s.rival.telegraph;
        if (tg) minWindup = Math.min(minWindup, tg.windup);
        for (const b of [s.player, s.rival]) {
          if (!b) continue;
          assert.ok(b.y - b.h / 2 >= PLAY_TOP && b.y + b.h / 2 <= PLAY_BOTTOM);
          assert.ok(b.h >= 28);
        }
      },
    });
  }
  assert.ok(minWindup >= 0.5, `${minWindup}`);
});

for (const hz of [30, 60, 120]) {
  test(`a sidestep-only policy (never presses X) does not clear the campaign reliably at ${hz} Hz`, () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { game } = play({ hz, seed, dash: false });
      const s = game.getState();
      if (s.phase === 'won') wins++;
    }
    assert.ok(wins <= 15, `${wins}/30 wins without dashing`);
  });
}
