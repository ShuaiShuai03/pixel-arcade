import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, createGame } from '../src/games/shield-sentinel.js';
import { harness, input, seeded } from './harness.js';

const DIRS = [
  ['ArrowRight'],
  ['ArrowRight', 'ArrowDown'],
  ['ArrowDown'],
  ['ArrowLeft', 'ArrowDown'],
  ['ArrowLeft'],
  ['ArrowLeft', 'ArrowUp'],
  ['ArrowUp'],
  ['ArrowRight', 'ArrowUp'],
];
const dirKeys = (angle) => DIRS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
const LIMITS = { x0: 52, x1: 428, y0: 90, y1: 256 };
const laneHalf = (dx, dy) =>
  Math.abs(dy) * 8 + Math.abs(dx) * 12 + 3 * (Math.abs(dx) + Math.abs(dy));

// Policy that only uses what the screen shows (telegraphs, shots, prompts), seen `delay` seconds late.
export function decide(s) {
  const p = s.sentinel;
  const lanes = [];
  for (const f of s.foes) {
    if (f.hp > 0 && f.charge?.kind === 'lance')
      lanes.push({ ox: f.x, oy: f.y, dx: f.charge.dirx, dy: f.charge.diry });
  }
  for (const sh of s.shots) {
    if (sh.kind === 'lance' && !sh.reflected) {
      const sp = Math.hypot(sh.vx, sh.vy);
      lanes.push({ ox: sh.x, oy: sh.y, dx: sh.vx / sp, dy: sh.vy / sp });
    }
  }
  for (const l of lanes) {
    const d = (p.x - l.ox) * -l.dy + (p.y - l.oy) * l.dx;
    const need = laneHalf(l.dx, l.dy) + 8;
    if (Math.abs(d) < need) {
      const room = (sign) => {
        const nx = Math.min(LIMITS.x1, Math.max(LIMITS.x0, p.x + sign * -l.dy * 60));
        const ny = Math.min(LIMITS.y1, Math.max(LIMITS.y0, p.y + sign * l.dx * 60));
        return Math.abs((nx - l.ox) * -l.dy + (ny - l.oy) * l.dx);
      };
      const sign = room(1) >= room(-1) ? 1 : -1;
      return { held: dirKeys(Math.atan2(sign * l.dx, sign * -l.dy)), pressed: [] };
    }
  }
  for (const f of s.foes) {
    const c = f.hp > 0 && f.charge;
    if (c?.kind === 'slam' && Math.hypot(p.x - c.lx, p.y - c.ly) < c.r + 16) {
      let best = null;
      DIRS.forEach((keys, i) => {
        const a = (i * Math.PI) / 4;
        const nx = Math.min(LIMITS.x1, Math.max(LIMITS.x0, p.x + Math.cos(a) * 70));
        const ny = Math.min(LIMITS.y1, Math.max(LIMITS.y0, p.y + Math.sin(a) * 70));
        const d = Math.hypot(nx - c.lx, ny - c.ly);
        if (!best || d > best.d) best = { d, keys };
      });
      return { held: best.keys, pressed: [] };
    }
  }
  const near = s.crawlers
    .filter((c) => c.portal <= 0)
    .map((c) => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) }))
    .filter((e) => e.d < 42)
    .sort((a, b) => a.d - b.d)[0];
  if (near) {
    const keys = dirKeys(Math.atan2(near.c.y - p.y, near.c.x - p.x));
    return { held: keys, pressed: ['KeyX'] };
  }
  const charging = s.foes.find(
    (f) => f.hp > 0 && (f.charge?.kind === 'orb' || f.charge?.kind === 'slug'),
  );
  const incoming = s.shots.find((sh) => !sh.reflected && (sh.kind === 'orb' || sh.kind === 'slug'));
  if (charging) {
    return {
      held: [...dirKeys(Math.atan2(charging.y - p.y, charging.x - p.x)), 'Space'],
      pressed: [],
    };
  }
  if (incoming) {
    return { held: [...dirKeys(Math.atan2(-incoming.vy, -incoming.vx)), 'Space'], pressed: [] };
  }
  return { held: [], pressed: [] };
}

export function playPolicy({ hz, seed, maxSeconds = 400 }) {
  const h = harness({ seed });
  const g = createGame(h.env);
  const rnd = seeded(seed * 7 + 3);
  const history = [];
  const dt = 1 / hz;
  let delay = 0.15 + rnd() * 0.2;
  let nextJitter = 0;
  const prompts = [];
  for (let t = 0; t < maxSeconds && h.ends.length === 0; t += dt) {
    const s = g.getState();
    history.push({ t, s });
    if (history.length > 80) history.shift();
    if (t >= nextJitter) {
      delay = 0.15 + rnd() * 0.2;
      nextJitter = t + 1 + rnd() * 2;
    }
    const seen = [...history].reverse().find((e) => e.t <= t - delay) || history[0];
    const a = decide(seen.s);
    if (!prompts.length || prompts.at(-1).key !== s.prompt.key)
      prompts.push({ key: s.prompt.key, t });
    g.update(dt, input(a.held, a.pressed));
  }
  return { h, g, prompts, seconds: g.getState().time };
}

const HZ = [30, 60, 120];

test('quality: a delayed, visible-information-only policy wins the whole campaign at every rate', () => {
  for (const hz of HZ) {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = playPolicy({ hz, seed });
      if (r.g.getState().phase === 'won') wins++;
      assert.equal(r.h.ends.length, 1);
    }
    assert.ok(wins >= 27, `${hz} Hz: ${wins}/30`);
  }
});

test('quality: prompts name keys, stay put long enough to read and never flip back and forth', () => {
  const dwell = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { prompts, g } = playPolicy({ hz: 60, seed });
    const end = g.getState().time;
    prompts.forEach((p, n) => {
      dwell.push({ key: p.key, d: (prompts[n + 1]?.t ?? end) - p.t });
      const back = prompts[n + 2];
      if (back && back.key === p.key) {
        assert.ok(back.t - p.t > 0.4, `${p.key} flips back within ${back.t - p.t}s`);
      }
    });
  }
  const shown = dwell.filter((e) => e.key !== 'idle');
  const brief = shown.filter((e) => e.d < 0.25).length;
  assert.ok(brief / shown.length <= 0.1, `${brief}/${shown.length} prompts shown under 0.25 s`);
  for (const key of ['orb', 'slug', 'crawler', 'intro', 'idle']) {
    assert.match(PROMPTS[key][0], /Space|X|Arrows/);
  }
});

test('quality: a player who never acts loses fairly, and every damage source was visible earlier', () => {
  const h = harness({ seed: 3 }),
    g = createGame(h.env);
  let lastWarning = -1;
  for (let i = 0; i < 60 * 300 && !h.ends.length; i++) {
    const before = g.getState();
    if (before.foes.some((f) => f.charge) || before.shots.length) lastWarning = before.time;
    g.update(1 / 60, input([]));
    const after = g.getState();
    if (after.hp < before.hp) assert.ok(lastWarning >= 0 && before.time - lastWarning < 5);
  }
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
});
