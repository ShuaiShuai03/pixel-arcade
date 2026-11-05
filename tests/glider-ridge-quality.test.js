import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createGliderState,
  stepGlider,
  statusLine,
  COURSES,
  terrainAt,
} from '../src/games/glider-ridge.js';
import { harness, input, mockContext, seeded } from './harness.js';

// A human-like policy that reads ONLY the status line the game shows (the prompt text) and maps it
// to keys: flare cue -> Space, "hold Left"/"Keep turning" -> Left, "Steer Left/Right" -> that key,
// stall prompts -> nose down. It reacts 0.15-0.35 s late, decides at irregular 0.1-0.2 s intervals
// and uses on/off keys.
const keysFor = (text) => {
  const keys = [];
  if (/Hold Space to flare/.test(text)) keys.push('Space');
  if (/hold Left|Keep turning/i.test(text)) keys.push('ArrowLeft');
  if (/Steer Left/.test(text)) keys.push('ArrowLeft');
  if (/Steer Right/.test(text)) keys.push('ArrowRight');
  if (/hold Up/i.test(text)) keys.push('ArrowUp');
  if (/STALL|Lower the nose/.test(text)) keys.push('ArrowDown');
  return keys;
};

// Whole campaign through the public createGame API, driven by the prompt text only.
function flyCampaign(hz, lang = 'en') {
  const h = harness({ lang }),
    game = createGame(h.env),
    random = seeded(4242 + hz),
    history = [],
    landings = [],
    dt = 1 / hz;
  let previous = 'playing',
    seconds = 0,
    nextDecision = 0,
    keys = [];
  while (seconds < 1500) {
    const s = game.getState();
    history.push({ t: seconds, text: s.status.en });
    if (history.length > 20) history.shift();
    if (s.phase !== previous && (s.phase === 'landed' || s.phase === 'won')) {
      landings.push({ course: s.course, kind: s.landing.kind, points: s.landing.points });
    }
    previous = s.phase;
    if (s.phase === 'won' || s.phase === 'lost') break;
    if (seconds >= nextDecision) {
      const seen = [...history].reverse().find((o) => o.t <= seconds - (0.15 + random() * 0.2));
      keys = keysFor((seen ?? history[0]).text);
      nextDecision = seconds + 0.1 + random() * 0.1;
    }
    const waiting = s.phase === 'landed' || s.phase === 'crashed';
    game.update(dt, input(s.phase === 'playing' ? keys : [], waiting ? ['Space'] : []));
    seconds += dt;
  }
  return { game, h, landings, seconds };
}

for (const hz of [30, 60, 120]) {
  test(`glider quality: a legal public-input campaign wins all three ridges at ${hz} Hz`, () => {
    const { game, h, landings, seconds } = flyCampaign(hz);
    const s = game.getState();
    assert.equal(s.phase, 'won', `phase ${s.phase} after ${seconds.toFixed(0)} s`);
    assert.deepEqual(
      landings.map((l) => [l.course, l.kind]),
      [
        [0, 'safe'],
        [1, 'safe'],
        [2, 'safe'],
      ],
    );
    assert.ok(landings.every((l) => l.points >= 250));
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.equal(h.ends[0].score, s.score);
    assert.ok(s.score >= 1000, `score ${s.score}`);
    assert.ok(s.attemptsLeft >= 1);
    assert.ok(h.sounds.includes('coin') && h.sounds.includes('win'));
    assert.ok(seconds < 700, 'courses finish with the available altitude');
  });
}

test('glider quality: terminal win freezes state, ignores input and restart begins a fresh run', () => {
  const { game, h } = flyCampaign(60, 'zh');
  const frozen = structuredClone(game.getState());
  let reads = 0;
  const probe = {
    held: () => (reads++, true),
    pressed: () => (reads++, true),
    pointer: { x: 0, y: 0, down: true, clicked: true },
  };
  for (let i = 0; i < 600; i++) game.update(1 / 60, probe);
  assert.deepEqual(game.getState(), frozen);
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /\p{Script=Han}/u);
  game.draw(mockContext());
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.phase, 'playing');
  assert.equal(fresh.course, 0);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.attemptsLeft, 3);
});

test('glider quality: results agree at 30, 60 and 120 Hz for identical scripted input', () => {
  const script = (t) => {
    const keys = [];
    if (t > 4 && t < 6) keys.push('ArrowUp');
    if (t > 8 && t < 12) keys.push('ArrowLeft');
    if (t > 12 && t < 16) keys.push('ArrowRight');
    if (t > 18 && t < 19.5) keys.push('Space');
    if (t > 20 && t < 21) keys.push('ArrowDown');
    return keys;
  };
  const states = [30, 60, 120].map((hz) => {
    const game = createGame(harness().env);
    for (let i = 0; i < hz * 25; i++) game.update(1 / hz, input(script(i / hz + 0.5 / hz)));
    return game.getState();
  });
  for (const other of states.slice(1)) {
    for (const key of ['x', 'z', 'altitude', 'airspeed', 'verticalSpeed', 'alpha', 'bank']) {
      assert.ok(Math.abs(other.glider[key] - states[0].glider[key]) < 1e-6, key);
    }
    assert.ok(Math.abs(other.energy.dissipated - states[0].energy.dissipated) < 1e-6);
  }
});

test('glider quality: seeded random play stays finite, non-penetrating and ends at most once', () => {
  for (const seed of [3, 11, 29]) {
    const h = harness({ seed }),
      game = createGame(h.env),
      random = seeded(seed * 7 + 1),
      keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA'];
    let held = [],
      maxSize = 0;
    for (let i = 0; i < 60 * 600; i++) {
      if (i % 20 === 0) held = keys.filter(() => random() < 0.3);
      const dt = [1 / 30, 1 / 60, 1 / 120][Math.floor(random() * 3)];
      game.update(dt, input(held, random() < 0.05 ? ['Space'] : []));
      if (i % 97 === 0) {
        const s = game.getState(),
          c = COURSES[s.course];
        for (const v of [
          s.glider.x,
          s.glider.z,
          s.glider.altitude,
          s.glider.airspeed,
          s.energy.specific,
        ]) {
          assert.ok(Number.isFinite(v));
        }
        assert.ok(s.attemptsLeft >= 0 && s.attemptsLeft <= 3);
        assert.ok(s.gate >= 0 && s.gate <= c.gates.length);
        if (s.phase === 'playing')
          assert.ok(s.glider.altitude > terrainAt(c, s.glider.x, s.glider.z) - 1e-6);
        maxSize = Math.max(maxSize, JSON.stringify(s).length);
      }
    }
    assert.ok(h.ends.length <= 1);
    assert.ok(maxSize < 6000, `state size ${maxSize}`);
  }
});

function runTextPolicy(course, hz, seed) {
  const random = seeded(seed * 9973 + course * 31 + hz),
    s = createGliderState(course),
    history = [],
    changes = [];
  let now = 0,
    nextDecision = 0,
    nextSnapshot = 0,
    lowest = 3,
    keys = [];
  while (now < 420 && s.phase !== 'won' && s.phase !== 'lost' && s.course === course) {
    if (now >= nextSnapshot) {
      const text = statusLine(s).en.split(' · ').pop().replace(/\d+/g, 'N');
      if (text !== changes.at(-1)?.text) changes.push({ t: now, text });
      history.push({ t: now, text: statusLine(s).en });
      nextSnapshot = now + 0.05;
      if (history.length > 20) history.shift();
    }
    if (now >= nextDecision) {
      const delay = 0.15 + random() * 0.2,
        seen = [...history].reverse().find((o) => o.t <= now - delay) ?? history[0];
      keys = keysFor(seen.text);
      nextDecision = now + 0.1 + random() * 0.1;
    }
    lowest = Math.min(lowest, s.attempts);
    const waiting = s.phase === 'landed' || s.phase === 'crashed';
    stepGlider(s, 1 / hz, input(s.phase === 'playing' ? keys : [], waiting ? ['Space'] : []));
    now += 1 / hz;
  }
  return { s, now, changes, lost: 3 - lowest, finished: s.phase === 'won' || s.course > course };
}

for (const course of [0, 1, 2]) {
  for (const hz of [30, 60, 120]) {
    test(`glider quality: a delayed, jittery player obeying only the prompt text finishes ridge ${course + 1} at ${hz} Hz`, () => {
      const runs = Array.from({ length: 30 }, (_, i) => runTextPolicy(course, hz, i + 1)),
        wins = runs.filter((r) => r.finished).length,
        clean = runs.filter((r) => r.finished && r.lost === 0).length;
      assert.ok(clean >= 27, `only ${clean}/30 runs finished without losing an attempt`);
      assert.ok(
        wins >= 27,
        `${wins}/30 runs finished; failures ${runs.filter((r) => !r.finished).map((r) => r.s.landing?.reason ?? r.s.phase)}`,
      );
    });
  }
}

test('glider quality: the status line is localized and prefixed with progress', () => {
  const s = createGliderState(1);
  assert.match(statusLine(s).en, /^Course 2\/3 · Gate 1\/4 · Attempts 3 · /);
  assert.match(statusLine(s).zh, /赛道 2\/3/);
});

test('glider quality: prompts are stable: no rapid flicker and no flare/stall alternation', () => {
  const urgent = /STALL|Slow!|Course edge|Hold Space to flare/;
  for (const course of [0, 1, 2]) {
    for (let seed = 1; seed <= 6; seed++) {
      const { changes, s } = runTextPolicy(course, 60, seed),
        attempts = 4 - Math.min(3, s.attempts);
      for (let i = 1; i < changes.length; i++) {
        const gap = changes[i].t - changes[i - 1].t;
        if (!urgent.test(changes[i].text) && !urgent.test(changes[i - 1].text)) {
          assert.ok(
            gap >= 0.35,
            `"${changes[i - 1].text}" -> "${changes[i].text}" after ${gap.toFixed(2)} s`,
          );
        }
        const flipBack =
          i >= 2 &&
          changes[i].text === changes[i - 2].text &&
          /Hold Space to flare|Slow!/.test(changes[i - 1].text + changes[i].text) &&
          changes[i].t - changes[i - 2].t < 1.5;
        assert.ok(!flipBack, `flare/stall cue flicker at ${changes[i].t.toFixed(1)} s`);
      }
      const corrective = changes.filter((c) => /Too fast|STALL|Slow!/.test(c.text));
      for (let i = 2; i < corrective.length; i++) {
        assert.ok(
          corrective[i].t - corrective[i - 2].t >= 2 ||
            new Set(corrective.slice(i - 2, i + 1).map((c) => c.text)).size < 3,
          `cyclic corrective prompts at ${corrective[i].t.toFixed(1)} s`,
        );
      }
      const alternations = changes.filter(
        (c, i) =>
          i &&
          /Hold Space to flare/.test(c.text) &&
          !/Hold Space to flare/.test(changes[i - 1].text),
      );
      assert.ok(
        alternations.length <= 2 * attempts,
        `flare cue appeared ${alternations.length} times`,
      );
    }
  }
});
