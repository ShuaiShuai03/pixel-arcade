import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, SECTIONS } from '../src/games/raft-rush.js';
import { harness, input, seeded } from './harness.js';

const HUD_TOP = 28,
  HUD_BOTTOM = 292;

// A human-like player that reads only the on-screen prompt (the last part of the status line).
// It sees the screen 0.15-0.35 s late, re-decides every 0.1-0.2 s, and can skip decisions.
const keysFor = (prompt) => {
  const keys = [];
  if (/\bUp\b/.test(prompt)) keys.push('ArrowUp');
  if (/\bDown\b/.test(prompt)) keys.push('ArrowDown');
  if (/\bLeft\b/.test(prompt)) keys.push('ArrowLeft');
  if (/\bRight\b/.test(prompt)) keys.push('ArrowRight');
  if (/\bX\b/.test(prompt)) keys.push('KeyX');
  return keys;
};
const promptOf = (status) => status.split(' · ').pop();

function play({ hz, seed, skip = 0, opening = [], lag = [0.15, 0.2], watch = () => {} }) {
  const h = harness({ seed }),
    game = createGame(h.env),
    random = seeded(seed * 97 + hz),
    dt = 1 / hz,
    history = [];
  let t = 0,
    next = 0,
    keys = [],
    lastStroke = -9;
  while (t < 900) {
    const s = game.getState();
    watch(s, t);
    history.push({ t, text: promptOf(s.status.en) });
    if (history.length > 80) history.shift();
    if (s.phase !== 'playing') break;
    let pressed = [];
    if (opening.length && t < opening[0]) {
      keys = opening[1];
    } else if (t >= next) {
      next = t + 0.1 + random() * 0.1;
      if (random() >= skip) {
        const seen =
          [...history].reverse().find((o) => o.t <= t - (lag[0] + random() * lag[1])) ?? history[0];
        keys = keysFor(seen.text);
        if (/\bSpace\b/.test(seen.text) && t - lastStroke > 0.5) {
          pressed = ['Space'];
          lastStroke = t;
        }
      }
    }
    game.update(dt, input(keys, pressed));
    t += dt;
  }
  return { game, h, seconds: t };
}

for (const hz of [30, 60, 120]) {
  test(`prompt-only play wins at least 27 of 30 seeded runs at ${hz} Hz`, () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { game, h } = play({ hz, seed });
      if (game.getState().phase === 'won') {
        wins++;
        assert.equal(h.ends.length, 1);
        assert.equal(h.ends[0].won, true);
      }
    }
    assert.ok(wins >= 27, `${wins}/30`);
  });
}

test('perturbed input (dropped decisions, wrong start) still reaches the finish', () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const hz = [30, 60, 120][seed % 3];
    const { game } = play({ hz, seed, skip: 0.25, opening: [4, ['ArrowUp']] });
    if (game.getState().phase === 'won') wins++;
  }
  assert.ok(wins >= 24, `${wins}/30`);
});

test('a missed flag is recoverable by following the prompt', () => {
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { game } = play({ hz: 60, seed, opening: [14, ['ArrowDown', 'ArrowRight']] });
    if (game.getState().phase === 'won') wins++;
  }
  assert.ok(wins >= 9, `${wins}/10`);
});

test('slower players (0.4-0.6 s lag) win at least 27 of 30 runs at every rate with few hits', () => {
  for (const hz of [30, 60, 120]) {
    let wins = 0,
      hullLost = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { game } = play({ hz, seed, lag: [0.4, 0.2] });
      const s = game.getState();
      if (s.phase === 'won') {
        wins++;
        hullLost += 3 - s.hull;
      }
    }
    assert.ok(wins >= 27, `${hz} Hz: ${wins}/30`);
    assert.ok(hullLost / wins <= 1.5, `${hz} Hz: hull lost per win ${hullLost / wins}`);
  }
});

test('prompts name keys, stay readable and hold steady for 0.6 s except at dock and damage events', () => {
  for (const seed of [5, 6, 7]) {
    const seen = new Set(),
      last = { text: '', t: 0, hull: 3 };
    const watch = (s, t) => {
      const p = promptOf(s.status.en);
      seen.add(p);
      assert.ok(p.length <= 30, p);
      assert.equal(typeof s.status.zh, 'string');
      if (p !== last.text) {
        const urgent = s.hull < last.hull || /hold still|\bX\b/.test(`${p} ${last.text}`);
        const fresh = last.text === '' || t - last.t >= 0.6 - 1e-6 || last.t === 0;
        assert.ok(fresh || urgent, `"${last.text}" -> "${p}" after ${(t - last.t).toFixed(2)} s`);
        Object.assign(last, { text: p, t });
      }
      last.hull = s.hull;
    };
    play({ hz: 60, seed, watch });
    for (const word of ['Up', 'Down', 'Right', 'X', 'hold still', 'Arrows steer to the flags']) {
      assert.ok(
        [...seen].some((p) => p.includes(word)),
        word,
      );
    }
  }
});

test('camera keeps the raft clear of the HUD bands with look-ahead downstream', () => {
  const check = (s) => {
    const sx = s.player.x - s.camera.x,
      sec = SECTIONS[s.section];
    const atEnd = s.camera.x + 480 >= sec.length - 40;
    assert.ok(sx - s.player.r >= -0.01 && (sx < 330 || atEnd), `screen x ${sx}`);
    assert.ok(
      s.player.y - s.player.r >= HUD_TOP && s.player.y + s.player.r <= HUD_BOTTOM,
      `y ${s.player.y}`,
    );
    const visibleAhead = s.camera.x + 480 - s.player.x;
    assert.ok(visibleAhead >= 230 || atEnd, `ahead ${visibleAhead}`);
    assert.ok(s.camera.x >= 0);
  };
  play({ hz: 60, seed: 2, watch: check });
  for (const seed of [11, 12, 13]) {
    const g = createGame(harness({ seed }).env),
      rnd = seeded(seed);
    let held = [];
    for (let i = 0; i < 60 * 90; i++) {
      if (i % 25 === 0)
        held = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'KeyX'].filter(
          () => rnd() < 0.35,
        );
      g.update(1 / 60, input(held, i % 50 === 0 ? ['Space'] : []));
      check(g.getState());
    }
  }
});

test('the raft is large and the sections differ in length, current and hazards', () => {
  const s = createGame(harness().env).getState();
  assert.ok(s.player.r * 2 >= 24);
  const lengths = SECTIONS.map((x) => x.length);
  assert.ok(lengths[0] < lengths[1] && lengths[1] < lengths[2]);
  assert.ok(
    SECTIONS[0].fields.length === 0 &&
      SECTIONS[1].fields.length > 0 &&
      SECTIONS[2].fields.length > 2,
  );
  assert.ok(SECTIONS.every((x) => x.rocks.length >= 4 && x.eddies.length >= 1));
});
