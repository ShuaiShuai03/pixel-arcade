import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGame,
  createGrapnelState,
  updateGrapnelState,
  cutRope,
  LEVELS,
  LEVEL_COUNT,
  PHYSICS,
  meta,
  routePlan,
} from '../src/games/grapnel-gorge.js';
import { MENU_COLUMNS, menuCell, menuTarget, wrapText } from '../src/games/grapnel-gorge-menu.js';
import { InputState } from '../src/shared/input.js';
import { harness, input, mockContext, seeded } from './harness.js';

const LEVEL_NUMBERS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const TEACHING = LEVEL_NUMBERS.slice(0, 7);
const MASTERY = LEVEL_NUMBERS.slice(14);
const BLIND_LEVELS = LEVEL_NUMBERS.filter((n) => n >= 3);
const CJK = /[　-〿一-鿿＀-￯]/;
const CANVAS = { width: 480, height: 320 };
const GLYPH = 0.62;
const R = PHYSICS.radius;

// ---------------------------------------------------------------------------------------------
// Players. Every policy below sees only getState(), the same snapshot a person and the host get.
// ---------------------------------------------------------------------------------------------
const memoryStore = (start = 1) => {
  const store = { value: start, saved: [] };
  store.unlocked = () => store.value;
  store.unlock = (n) => {
    store.saved.push(n);
    store.value = Math.max(store.value, n);
  };
  return store;
};
function startAt(level, { lang = 'en', seed = 1, store = memoryStore(level) } = {}) {
  const h = harness({ lang, seed });
  h.env.progress = store;
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, store };
}
const finished = (s) => s.betweenRoutes || s.phase === 'won';

/**
 * A reaction-limited climber. It reads a snapshot that is `delay` seconds old (plus a little human
 * jitter), walks to a start point near the cairn's front edge and stops, hooks the anchor ahead,
 * reels in, and releases as soon as the landing dots end in a check on the next cairn. It makes
 * no prediction: the dots it sees are as old as its eyes.
 */
function climb(
  level,
  { delay = 0.25, hz = 60, seed = 1, maxT = 60, lang = 'en', store: shared } = {},
) {
  const { g, h, store } = startAt(level, { lang, seed, store: shared }),
    R = seeded(seed * 7919 + level),
    dt = 1 / hz,
    hist = [];
  const lag = delay > 0 ? delay + (R() - 0.5) * 0.08 : 0;
  const hookMargin = 16 + R() * 45;
  let margin = hookMargin,
    t = 0,
    cuts = 0,
    last = g.getState(),
    held = new Set(),
    nextAt = 0,
    ropeSince = null,
    lastPad = 0,
    latch = false,
    walkStart = null,
    walkX = 0,
    idleSince = 0;
  const at = (time) => {
    let i = 0;
    while (i + 1 < hist.length && hist[i + 1].t <= time) i++;
    return hist[i].s;
  };
  while (t < maxT) {
    const s = g.getState();
    if (s.lastEvent === 'cut' && last.lastEvent !== 'cut') cuts++;
    last = s;
    hist.push({ t, s });
    while (hist.length > 2 && hist[1].t <= t - lag - 0.25) hist.shift();
    if (finished(s) || s.phase !== 'playing') break;
    const pressed = new Set(),
      o = at(t - lag);
    if (s.recovering <= 0 && o.recovering <= 0 && t >= nextAt) {
      const pl = o.player,
        pad = o.platforms.find(
          (p) => pl.x >= p.x - 1 && pl.x <= p.x + p.w + 1 && Math.abs(pl.y + R_ - p.y) < 1.5,
        ),
        wait = () => (nextAt = t + lag + 0.12);
      if (pad) lastPad = pad.id;
      if (o.rope) {
        if (ropeSince === null) ropeSince = t;
        held.add('ArrowUp');
        const dots = o.landing.at(-1);
        const safe =
          dots?.landing &&
          o.platforms.some((p) => dots.x >= p.x && dots.x <= p.x + p.w && p.id > lastPad);
        if (safe || t - ropeSince > 7) {
          pressed.add('Space');
          held.delete('ArrowUp');
          ropeSince = null;
          wait();
        }
      } else {
        held.delete('ArrowUp');
        if (pad) {
          let ex = pl.x + pl.vx * lag;
          if (held.has('ArrowRight')) {
            if (walkStart === null) {
              walkStart = t;
              walkX = pl.x;
            }
            const w = t - walkStart;
            ex = walkX + (w > 0.167 ? PHYSICS.walkSpeed * (w - 0.083) : 390 * w * w);
          } else walkStart = null;
          if (!latch && ex < pad.x + pad.w - margin) {
            held.add('ArrowRight');
            if (walkStart === null) {
              walkStart = t;
              walkX = pl.x;
            }
          } else {
            held.delete('ArrowRight');
            latch = true;
          }
          const clear = o.anchors.filter((a) => a.eligible);
          if (latch && Math.abs(pl.vx) < 20 && clear.length) {
            const pick = clear.sort(
              (a, b) => Math.abs(a.x - pl.x - 70) - Math.abs(b.x - pl.x - 70),
            )[0];
            pressed.add(o.target !== pick.id ? 'KeyX' : 'Space');
            if (o.target === pick.id) {
              ropeSince = t;
              latch = false;
            }
            wait();
          } else if (latch && !clear.length && Math.abs(pl.vx) < 20) {
            if (margin > 12) {
              margin = Math.max(12, margin - 15);
              latch = false;
              wait();
            } else if (t - idleSince > 6) {
              pressed.add('KeyZ');
              idleSince = t;
            }
          }
        } else {
          held.delete('ArrowRight');
          const clear = o.anchors.filter((a) => a.eligible),
            dots = o.landing.at(-1);
          if (clear.length && !dots?.landing && pl.vy > -30) {
            pressed.add(o.target !== clear[0].id ? 'KeyX' : 'Space');
            if (o.target === clear[0].id) ropeSince = t;
            wait();
          }
        }
      }
    }
    g.update(dt, input([...held], [...pressed]));
    t += dt;
  }
  const s = g.getState();
  return { g, h, store, s, cleared: finished(s), lives: s.lives, time: t, cuts };
}
const R_ = PHYSICS.radius;

// Blind players: none of them looks at the game.
const PERIODS = [0.6, 1, 1.5, 2.2];
const edge = (t, period, dt) => Math.floor((t + dt) / period) !== Math.floor(t / period);
function blindPolicy(name, seed) {
  const r = seeded(seed);
  if (name === 'idle') return () => ({ held: [], pressed: [] });
  if (name === 'mash')
    return () => {
      const keys = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Space',
        'KeyX',
        'KeyZ',
        'Enter',
      ];
      return { held: keys.filter(() => r() < 0.5), pressed: keys.filter(() => r() < 0.5) };
    };
  if (name === 'sparse') {
    let held = [],
      tick = 0;
    return () => {
      if (tick++ % 15 === 0)
        held = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => r() < 0.3);
      const pressed = [];
      if (r() < 0.06) pressed.push('Space');
      if (r() < 0.03) pressed.push('KeyX');
      if (r() < 0.004) pressed.push('KeyZ');
      return { held, pressed };
    };
  }
  const [kind, period] = name.split(':'),
    P = Number(period);
  if (kind === 'alt')
    return (t) => ({
      held: [Math.floor(t / P) % 2 ? 'ArrowLeft' : 'ArrowRight', 'ArrowUp'],
      pressed: t > 0.01 && edge(t, P, 1 / 30) ? ['Space'] : [],
    });
  if (kind === 'walk')
    return (t) => ({
      held: [Math.floor(t / P) % 2 ? 'ArrowLeft' : 'ArrowRight'],
      pressed: t > 0.01 && edge(t, P, 1 / 30) ? ['Space'] : [],
    });
  return (t) => ({ held: ['ArrowUp'], pressed: edge(t, P, 1 / 30) ? ['Space'] : [] });
}
const BLIND_PLAYERS = [
  'idle',
  'mash',
  'sparse',
  ...PERIODS.map((p) => `alt:${p}`),
  'walk:1',
  ...[1.3, 2, 3].map((p) => `hook:${p}`),
];
function blindWins(level, name, seed = 1, seconds = 40) {
  const { g } = startAt(level, { seed }),
    policy = blindPolicy(name, seed),
    hz = 30;
  for (let t = 0; t < seconds; t += 1 / hz) {
    const s = g.getState();
    if (finished(s)) return true;
    if (s.phase !== 'playing') return false;
    const step = policy(t);
    g.update(1 / hz, input(step.held, step.pressed));
  }
  return finished(g.getState());
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers: a recording canvas context.
// ---------------------------------------------------------------------------------------------
function recorder() {
  const calls = [];
  let origin = { x: 0, y: 0 },
    saved = [],
    font = 12,
    align = 'left';
  const target = {
    measureText: (t) => ({ width: String(t).length * 7 }),
    canvas: CANVAS,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    save: () => saved.push(origin),
    restore: () => (origin = saved.pop() ?? { x: 0, y: 0 }),
    translate: (x, y) => (origin = { x: origin.x + x, y: origin.y + y }),
  };
  return {
    calls,
    ctx: new Proxy(target, {
      get: (t, p) =>
        p in t
          ? t[p]
          : (...args) => {
              calls.push({ name: p, args, origin, font, align });
            },
      set: (t, p, v) => {
        if (p === 'font') font = Number(/(\d+)px/.exec(v)?.[1] ?? 12);
        if (p === 'textAlign') align = v;
        t[p] = v;
        return true;
      },
    }),
  };
}
const textWidth = (text, size) =>
  [...text].reduce((sum, ch) => sum + (CJK.test(ch) ? size : size * GLYPH), 0);
function assertTextFits(calls, label) {
  for (const c of calls.filter((k) => k.name === 'fillText')) {
    const [text, x, y] = c.args,
      w = textWidth(String(text), c.font),
      left = c.align === 'center' ? x - w / 2 : c.align === 'right' ? x - w : x;
    assert.ok(
      left >= 0 && left + w <= CANVAS.width,
      `${label}: "${text}" spans ${left}..${left + w}`,
    );
    assert.ok(y >= 0 && y + c.font <= CANVAS.height, `${label}: "${text}" at y=${y}`);
  }
}
function playerBox(calls) {
  const i = calls.findIndex((c) => c.name === 'arc' && c.args[2] === R && c.args[0] === 0);
  if (i < 0) return null;
  const { x, y } = calls[i].origin;
  return { index: i, x, y };
}

// ---------------------------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------------------------
test('there are at least 20 frozen, distinct, bilingual routes', () => {
  assert.ok(LEVEL_COUNT >= 20);
  assert.equal(LEVELS.length, LEVEL_COUNT);
  assert.ok(
    Object.isFrozen(LEVELS) && LEVELS.every((l) => Object.isFrozen(l) && Object.isFrozen(l.pads)),
  );
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVEL_COUNT);
  const layouts = LEVELS.map((l) => JSON.stringify([l.pads, l.anchors, l.rocks]));
  assert.equal(new Set(layouts).size, LEVEL_COUNT);
  const relics = LEVELS.flatMap((l) => l.relics.map((r) => r.id));
  assert.equal(new Set(relics).size, relics.length);
  for (const l of LEVELS) {
    for (const text of [l.name, l.lesson]) assert.ok(text.en.length > 3 && CJK.test(text.zh), l.id);
    assert.ok([0, 1, 2].includes(l.theme));
  }
});
test('every route is legal geometry: ordered cairns, a flag, anchors in range, no wedge slots', () => {
  for (const l of LEVELS) {
    const plan = routePlan(LEVELS.indexOf(l) + 1);
    assert.ok(l.pads.at(-1).exit && l.pads.filter((p) => p.exit).length === 1, l.id);
    l.pads.forEach((p, i) => {
      assert.equal(p.id, i);
      assert.ok(p.y >= 120 && p.y <= 270 && p.x >= 12 && p.x + p.w <= 468, `${l.id} pad ${i}`);
      if (i) assert.ok(p.x - (l.pads[i - 1].x + l.pads[i - 1].w) >= 60, `${l.id} gap ${i}`);
    });
    assert.equal(l.pads[0].x, 12);
    assert.ok(l.pads[0].w >= 90, 'a start cairn wide enough to walk on');
    for (const a of l.anchors) {
      const swing = Math.max(a.amplitudeY, 0);
      assert.ok(a.y - swing >= 66 && a.y + swing <= 200, `${l.id} anchor ${a.id}`);
      assert.ok(
        a.x - a.amplitudeX >= 40 && a.x + a.amplitudeX <= 440,
        `${l.id} anchor ${a.id} rail`,
      );
    }
    // No two solid faces may leave a slot narrower than the climber: it would wedge her.
    const solids = plan.solids.filter((r) => r.kind !== 'rail');
    for (const a of solids)
      for (const b of solids) {
        if (a === b || a.y + a.h <= b.y || b.y + b.h <= a.y) continue;
        const slot = b.x - (a.x + a.w);
        assert.ok(slot <= 0 || slot > 2 * R + 2 || slot === 0, `${l.id} slot ${slot}`);
      }
    for (const r of l.relics) {
      assert.ok(r.x > 30 && r.x < 450 && r.y > 70 && r.y < 280, `${l.id} relic`);
      assert.ok(
        plan.solids.every(
          (s) =>
            Math.hypot(
              r.x - Math.max(s.x, Math.min(r.x, s.x + s.w)),
              r.y - Math.max(s.y, Math.min(r.y, s.y + s.h)),
            ) > 15,
        ),
        `${l.id} relic inside rock`,
      );
    }
  }
});
test('the curve teaches first, combines next and ends on mastery routes', () => {
  const moving = (l) => l.anchors.some((a) => a.amplitudeX || a.amplitudeY);
  const narrow = (l) => Math.min(...l.pads.slice(1).map((p) => p.w));
  const gap = (l) => Math.max(...l.pads.slice(1).map((p, i) => p.x - (l.pads[i].x + l.pads[i].w)));
  const mean = (list, f) => list.reduce((s, l) => s + f(l), 0) / list.length;
  const teach = LEVELS.slice(0, 7),
    combine = LEVELS.slice(7, 14),
    master = LEVELS.slice(14);
  assert.equal(LEVELS[0].pads.length, 2);
  assert.ok(!moving(LEVELS[0]) && !LEVELS[0].rocks.length && LEVELS[0].anchors.length === 1);
  assert.ok(teach.filter(moving).length <= 1, 'one mechanic at a time while teaching');
  assert.ok(
    combine.filter(moving).length >= 2 && combine.filter((l) => l.rocks.length).length >= 2,
  );
  assert.ok(master.filter(moving).length >= 4 && master.filter((l) => l.rocks.length).length >= 2);
  assert.ok(mean(master, narrow) < mean(teach, narrow) - 15, 'mastery cairns are narrower');
  assert.ok(mean(master, gap) > mean(teach, gap), 'mastery gaps are longer');
});
test('each tip describes what its route really does', () => {
  for (const l of LEVELS) {
    const { en, zh } = l.lesson,
      moving = l.anchors.some((a) => a.amplitudeX || a.amplitudeY),
      narrow = Math.min(...l.pads.slice(1).map((p) => p.w)) <= 66,
      rises = l.pads.at(-1).y < l.pads[0].y - 20,
      falls = l.pads.at(-1).y > l.pads[0].y + 20,
      longest = Math.max(...l.pads.slice(1).map((p, i) => p.x - (l.pads[i].x + l.pads[i].w)));
    assert.equal(/rock/i.test(en), l.rocks.length > 0, `${l.id} rock (EN)`);
    assert.equal(/岩石/.test(zh), l.rocks.length > 0, `${l.id} rock (ZH)`);
    if (moving) {
      assert.ok(/rail|sway|rise and fall|fast anchors/i.test(en), `${l.id} moving (EN)`);
      assert.ok(/轨道|摆动|升降|移动/.test(zh), `${l.id} moving (ZH)`);
    } else {
      assert.ok(!/rail|sway|fast anchors/i.test(en) && !/轨道|摆动/.test(zh), `${l.id} static`);
    }
    if (/narrow/i.test(en)) assert.ok(narrow, `${l.id} says narrow`);
    if (/窄/.test(zh)) assert.ok(narrow, `${l.id} says 窄`);
    if (/higher|climb|rising/i.test(en)) assert.ok(rises, `${l.id} says it climbs`);
    if (/(each cairn is|)lower than/i.test(en)) assert.ok(falls, `${l.id} says it falls`);
    if (/long gap|very long|long swing/i.test(en)) assert.ok(longest >= 190, `${l.id} long gap`);
    if (/several anchors/i.test(en))
      assert.ok(l.anchors.length > l.pads.length - 1, `${l.id} anchors`);
    if (/middle cairn/i.test(en)) assert.ok(l.pads.length >= 3, `${l.id} middle cairn`);
    if (/two rocks/i.test(en)) assert.equal(l.rocks.length, 2, `${l.id} two rocks`);
  }
});
test('relic pickups and rails are consistent with the plan the game plays', () => {
  for (const n of LEVEL_NUMBERS) {
    const plan = routePlan(n);
    assert.equal(plan.rails ?? undefined, undefined);
    assert.equal(plan.solids.filter((s) => s.kind === 'rail').length, plan.anchors.length);
    assert.equal(plan.solids.filter((s) => s.kind === 'cairn').length, plan.pads.length);
    plan.pads[0].w = 1;
    assert.notEqual(LEVELS[n - 1].pads[0].w, 1, 'plans are copies');
  }
});

// ---------------------------------------------------------------------------------------------
// Opening, select and continue
// ---------------------------------------------------------------------------------------------
test('a new player gets a readable opening and an idle player cannot lose level 1', () => {
  const { g } = startAt(1);
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.player.ground, true);
  assert.equal(s.notice.en, LEVELS[0].lesson.en);
  for (let n = 0; n < 60 * 90; n++) g.update(1 / 60, input());
  const after = g.getState();
  assert.equal(after.lives, PHYSICS.lives);
  assert.equal(after.phase, 'playing');
  assert.equal(after.player.x, s.player.x);
});
test('every route opens with the player standing on a cairn and no hazard in reach', () => {
  for (const n of LEVEL_NUMBERS) {
    const { g } = startAt(n),
      s = g.getState(),
      pad = s.route.pads[0];
    assert.equal(s.level, n);
    assert.equal(s.lives, PHYSICS.lives);
    assert.ok(s.player.x > pad.x + 20 && s.player.x < pad.x + pad.w - 20);
    assert.ok(
      s.anchors.some((a) => a.eligible) || n > 1,
      'level 1 offers a hookable anchor at once',
    );
    for (let k = 0; k < 120 * 4; k++) g.update(1 / 120, input());
    assert.equal(g.getState().lives, PHYSICS.lives);
  }
});
test('select and continue: arrows, Enter or a tap pick a cleared route; locked cells refuse', () => {
  const store = memoryStore(6),
    { g, h } = startAt(1, { store });
  assert.ok(g.getState().menu);
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 5);
  g.update(1 / 60, input([], ['ArrowRight', 'ArrowRight', 'ArrowRight']));
  assert.ok(g.getState().menu.cursor <= 6);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 6, 'the cursor stops at the highest unlocked route');
  const locked = menuCell(10);
  const sounds = h.sounds.length;
  g.update(1 / 60, input([], [], { x: locked.x + 5, y: locked.y + 5, clicked: true }));
  assert.ok(g.getState().menu, 'a locked cell does not start');
  assert.ok(h.sounds.length > sounds, 'and it answers with a sound');
  const cell = menuCell(3);
  g.update(1 / 60, input([], [], { x: cell.x + 4, y: cell.y + 4, clicked: true }));
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 3);
  const second = startAt(1, { store: memoryStore(4) });
  second.g.update(1 / 60, input([], ['ArrowLeft']));
  second.g.update(1 / 60, input([], ['Enter']));
  assert.equal(second.g.getState().level, 3);
  assert.equal(menuTarget(input([], ['Space']), 2, 5).start, true);
});
test('clearing a route unlocks the next one and a new session continues from it', () => {
  const store = memoryStore(1),
    first = startAt(1, { store });
  first.g.update(1 / 60, input());
  assert.equal(first.g.getState().menu, null, 'unlocked 1 starts at once');
  // Clear route 1 in a session that shares the store.
  const { g } = climb(1, { store });
  assert.ok(g.getState().betweenRoutes);
  assert.deepEqual(store.saved.slice(-1), [2]);
  assert.equal(store.value, 2);
  assert.equal(g.getState().unlocked, 2);
  const again = startAt(1, { store });
  assert.equal(again.g.getState().menu.cursor, 2);
});
test('broken, throwing and junk progress stores are clamped and never stop the game', () => {
  const junk = [
    NaN,
    Infinity,
    -Infinity,
    -5,
    0,
    0.4,
    7.9,
    '7',
    'x',
    null,
    undefined,
    {},
    [],
    1e9,
    true,
  ];
  for (const value of junk) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock() {} };
    const g = createGame(h.env),
      s = g.getState();
    const expected = Number.isFinite(Math.floor(Number(value))) ? Math.floor(Number(value)) : 1;
    const clamped = Math.min(LEVEL_COUNT, Math.max(1, expected));
    assert.equal(s.unlocked, clamped, String(value));
    if (clamped > 1) assert.equal(s.menu.cursor, clamped);
    g.draw(mockContext());
  }
  for (const progress of [
    {
      unlocked: () => {
        throw Error('read');
      },
      unlock() {},
    },
    {
      unlocked: () => 3,
      unlock() {
        throw Error('write');
      },
    },
    {},
    { unlocked: 5 },
  ]) {
    const h = harness();
    h.env.progress = progress;
    const g = createGame(h.env);
    assert.doesNotThrow(() => {
      for (let n = 0; n < 60; n++) g.update(1 / 60, input([], n === 30 ? ['Space'] : []));
      g.draw(mockContext());
    });
  }
  // A store whose write throws must not stop a route clear.
  const throwing = {
    unlocked: () => 1,
    unlock() {
      throw Error('full');
    },
  };
  const run = climb(1, { store: throwing });
  assert.ok(run.cleared, 'a failing write does not stop a route clear');
  assert.equal(run.s.unlocked, 2, 'and the session still moves on');
});

// ---------------------------------------------------------------------------------------------
// Clears
// ---------------------------------------------------------------------------------------------
test('a scripted legal clear exists for every route through the select screen', () => {
  for (const n of LEVEL_NUMBERS) {
    const run = climb(n, { delay: 0, hz: 60 });
    assert.ok(run.cleared, `route ${n} (${LEVELS[n - 1].id}): ${run.s.status.en}`);
    assert.ok(run.lives >= 1, `route ${n} lives ${run.lives}`);
    assert.equal(run.s.completed.at(-1), LEVELS[n - 1].id);
    if (n < LEVEL_COUNT) assert.ok(run.store.saved.includes(n + 1));
  }
});
const lostLives = (runs) =>
  runs.reduce((sum, r) => sum + (r.cleared ? PHYSICS.lives - r.lives : 0), 0) / runs.length;
test('a reaction-limited climber that reads only getState clears the routes at 30, 60 and 120 Hz', () => {
  const quick = [];
  for (const n of LEVEL_NUMBERS)
    for (const hz of [30, 60, 120])
      for (const seed of [1, 2]) quick.push({ n, ...climb(n, { delay: 0.25, hz, seed }) });
  const cleared = quick.filter((r) => r.cleared).length;
  assert.ok(cleared / quick.length >= 0.95, `0.25 s: ${cleared}/${quick.length} runs cleared`);
  for (const n of LEVEL_NUMBERS.filter((x) => x <= 14))
    assert.ok(
      quick.filter((r) => r.n === n).every((r) => r.cleared || n === 9),
      `route ${n}`,
    );
  const slow = MASTERY.flatMap((n) =>
    [60, 120].flatMap((hz) =>
      [1, 2, 3].map((seed) => ({ n, ...climb(n, { delay: 0.35, hz, seed }) })),
    ),
  );
  const cleared35 = slow.filter((r) => r.cleared).length;
  assert.ok(
    cleared35 / slow.length >= 0.85,
    `0.35 s mastery: ${cleared35}/${slow.length} runs cleared`,
  );
  const teaching = quick.filter((r) => TEACHING.includes(r.n));
  assert.ok(
    lostLives(slow) > lostLives(teaching) + 0.15,
    `lives lost: teaching ${lostLives(teaching)}, mastery ${lostLives(slow)}`,
  );
  assert.ok(lostLives(slow) >= 0.3, `mastery lives lost ${lostLives(slow)}`);
});
test('idle, mash and timed key patterns win at most 25% of any route from route 3', () => {
  for (const n of BLIND_LEVELS) {
    let wins = 0;
    for (const name of BLIND_PLAYERS) if (blindWins(n, name)) wins++;
    assert.ok(
      wins / BLIND_PLAYERS.length <= 0.25,
      `route ${n}: ${wins}/${BLIND_PLAYERS.length} blind wins`,
    );
  }
});
test('rope swings, rock cuts and falls leave finite state under mixed seeded input on every route', () => {
  for (const n of LEVEL_NUMBERS) {
    const seed = n * 13 + 5,
      { g, h } = startAt(n, { seed }),
      r = seeded(seed);
    for (let k = 0; k < 900; k++) {
      const held = [];
      if (r() < 0.35) held.push(r() < 0.5 ? 'ArrowRight' : 'ArrowLeft');
      if (r() < 0.65) held.push(r() < 0.6 ? 'ArrowUp' : 'ArrowDown');
      const pressed = r() < 0.04 ? [r() < 0.75 ? 'Space' : 'KeyX'] : [];
      g.update([1 / 30, 1 / 60, 1 / 120][k % 3], input(held, pressed));
      const s = g.getState();
      for (const value of [
        s.player.x,
        s.player.y,
        s.player.vx,
        s.player.vy,
        s.time,
        s.energy,
        s.energyBalance,
      ])
        assert.ok(Number.isFinite(value), `${n}/${k}`);
      assert.ok(s.energy >= -1e-8 && s.energy <= 100 + 1e-8);
      assert.ok(s.lives >= 0 && s.lives <= PHYSICS.lives);
      if (s.rope) {
        assert.ok(
          s.rope.length >= PHYSICS.minLength - 1e-6 && s.rope.length <= PHYSICS.maxLength + 1e-6,
        );
        const a = s.anchors.find((x) => x.id === s.rope.id);
        assert.ok(Math.hypot(s.player.x - a.x, s.player.y - a.y) <= s.rope.length + 1e-5);
      }
      assert.ok(h.ends.length <= 1);
      if (k % 300 === 0) g.draw(mockContext());
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Frame rates and hostile input
// ---------------------------------------------------------------------------------------------
test('the same inputs give the same swing at 30, 60 and 120 Hz', () => {
  const script = (tick) => ({
    held: [tick < 5 ? 'ArrowRight' : '', tick >= 8 && tick < 70 ? 'ArrowUp' : ''].filter(Boolean),
    pressed: tick === 8 || tick === 70 ? ['Space'] : [],
  });
  for (const n of [1, 4, 9, 11, 16]) {
    const snaps = [30, 60, 120].map((hz) => {
      const { g } = startAt(n),
        step = hz / 30;
      for (let tick = 0; tick < 150; tick++) {
        const { held, pressed } = script(tick);
        for (let k = 0; k < step; k++) g.update(1 / hz, input(held, k === 0 ? pressed : []));
      }
      const s = g.getState();
      return {
        player: s.player,
        rope: s.rope,
        time: s.time,
        lives: s.lives,
        charge: s.charge,
        score: s.score,
      };
    });
    assert.deepEqual(snaps[1], snaps[0], `route ${n} 60 Hz`);
    assert.deepEqual(snaps[2], snaps[0], `route ${n} 120 Hz`);
  }
});
test('hostile dt and pointer values never corrupt play, the select screen or the clear screen', () => {
  const dts = [NaN, Infinity, -Infinity, -1, 0, 1e9, '0.016', null, undefined, {}, [], 1e-12];
  const pointers = [
    undefined,
    null,
    {},
    { x: NaN, y: NaN, clicked: true },
    { x: 'a', y: {}, clicked: true },
    { x: Infinity, y: -Infinity, clicked: true },
    { x: 1e12, y: -1e12, clicked: true },
    { x: 100, y: 100, clicked: 'yes' },
  ];
  const finiteState = (s) => {
    for (const v of [s.time, s.player.x, s.player.y, s.player.vx, s.player.vy, s.energy])
      assert.ok(Number.isFinite(v));
  };
  for (const level of [1, 7]) {
    const { g } = startAt(level);
    for (const dt of dts)
      for (const pointer of pointers) {
        const before = g.getState().time;
        const keys = {
          held: () => true,
          pressed: (...c) => c.includes('KeyX'),
          pointer,
        };
        assert.doesNotThrow(() => g.update(dt, keys));
        const s = g.getState();
        if (!Number.isFinite(dt) || dt <= 0) assert.equal(s.time, before);
        if (s.phase === 'playing' && !s.menu) finiteState(s);
        g.draw(mockContext());
      }
  }
  // the select screen and the clear screen
  const menu = startAt(1, { store: memoryStore(9) });
  for (const pointer of pointers)
    assert.doesNotThrow(() =>
      menu.g.update(1 / 60, { held: () => false, pressed: () => false, pointer }),
    );
  const run = climb(1, {});
  const clear = run.g;
  assert.ok(run.cleared);
  for (const pointer of pointers) {
    const before = clear.getState();
    assert.doesNotThrow(() =>
      clear.update(NaN, { held: () => false, pressed: () => false, pointer }),
    );
    assert.deepEqual(clear.getState(), before);
  }
});

// ---------------------------------------------------------------------------------------------
// Ends
// ---------------------------------------------------------------------------------------------
function loseAllLives(g) {
  for (let n = 0; n < 60 * 20 && g.getState().phase === 'playing'; n++)
    g.update(1 / 60, input([], ['KeyZ']));
}
test('every loss gives one bilingual message, one env.end and a frozen terminal state', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h } = startAt(3, { lang });
    let atEnd;
    h.env.end = (r) => {
      h.ends.push(r);
      atEnd = g.getState();
    };
    loseAllLives(g);
    const s = g.getState();
    assert.equal(s.phase, 'lost');
    assert.equal(s.lives, 0);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, false);
    assert.match(h.ends[0].message, lang === 'en' ? /No rescue lives remain/ : /救援生命已耗尽/);
    assert.equal(CJK.test(h.ends[0].message), lang === 'zh');
    assert.deepEqual(s, atEnd);
    g.draw(mockContext());
    for (let k = 0; k < 90; k++)
      g.update(1 / 30, input(['ArrowRight', 'ArrowUp'], ['Space', 'KeyZ', 'Enter', 'KeyX']));
    assert.deepEqual(g.getState(), s);
    assert.equal(h.ends.length, 1);
  }
  const fresh = startAt(1);
  assert.equal(fresh.g.getState().lives, PHYSICS.lives);
});
test('falling into the water loses a life and the last fall ends the route exactly once', () => {
  const { g, h } = startAt(2);
  for (let n = 0; n < 60 * 40 && g.getState().phase === 'playing'; n++)
    g.update(1 / 60, input(['ArrowRight']));
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(g.getState().lives, 0);
});
test('clearing the last route ends the game once, with a bilingual message and a frozen state', () => {
  for (const lang of ['en', 'zh']) {
    const { g, h, s, cleared } = climb(LEVEL_COUNT, { delay: 0.25, lang, seed: 2 });
    assert.ok(cleared && s.phase === 'won', s.status.en);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.match(
      h.ends[0].message,
      lang === 'en' ? /All twenty canyon routes crossed/ : /二十条峡谷路线全部穿越/,
    );
    assert.equal(h.ends[0].score, s.score);
    const frozen = g.getState();
    for (let k = 0; k < 60; k++)
      g.update(1 / 30, input(['ArrowRight'], ['Enter', 'Space', 'KeyZ']));
    g.draw(mockContext());
    assert.deepEqual(g.getState(), frozen);
    assert.equal(h.ends.length, 1);
  }
});
test('the final rescue freezes the callback snapshot before simultaneous held movement', () => {
  const { g, h } = startAt(1);
  let atEnd;
  h.env.end = (r) => {
    h.ends.push(r);
    atEnd = g.getState();
  };
  for (let n = 0; n < 4; n++) {
    g.update(1 / 120, input([], ['KeyZ']));
    for (let t = 0; t < 50; t++) g.update(1 / 120, input());
  }
  g.update(1 / 30, input(['ArrowRight', 'ArrowUp'], ['KeyZ']));
  assert.equal(g.getState().phase, 'lost');
  assert.deepEqual(g.getState(), atEnd);
  assert.equal(h.ends.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Input that must not be dropped
// ---------------------------------------------------------------------------------------------
test('a tap during the rescue pause is kept and acts as soon as the climber can move', () => {
  const { g } = startAt(1);
  g.update(1 / 120, input([], ['KeyZ']));
  assert.ok(g.getState().recovering > 0);
  g.update(1 / 120, input([], ['Space']));
  assert.equal(g.getState().rope, null, 'not hooked while the pause lasts');
  for (let n = 0; n < 60; n++) g.update(1 / 120, input());
  const s = g.getState();
  assert.equal(s.recovering, 0);
  assert.ok(s.rope, 'the tap made during the pause hooked afterwards');
  assert.equal(s.lives, PHYSICS.lives - 1);
});
test('a rescue pressed during the rescue pause does not spend a second life', () => {
  const { g } = startAt(1);
  g.update(1 / 120, input([], ['KeyZ']));
  for (let n = 0; n < 10; n++) g.update(1 / 120, input([], ['KeyZ']));
  for (let n = 0; n < 80; n++) g.update(1 / 120, input());
  assert.equal(g.getState().lives, PHYSICS.lives - 1);
});
test('X and Space pressed in the same frame both act, in that order', () => {
  const { g } = startAt(7);
  const before = g.getState();
  const eligible = before.anchors.filter((a) => a.eligible);
  assert.ok(eligible.length >= 2, 'route 7 offers a choice of anchors');
  const cycled =
    eligible[(eligible.findIndex((a) => a.id === before.target) + 1) % eligible.length];
  g.update(1 / 60, input([], ['KeyX', 'Space']));
  const after = g.getState();
  assert.ok(after.rope);
  assert.equal(after.rope.id, cycled.id, 'X moved the aim first, then Space hooked it');
});
test('tapping an anchor on the canvas aims at it; a tap on empty rock does nothing', () => {
  const { g } = startAt(7);
  const s = g.getState(),
    wanted = s.anchors.filter((a) => a.eligible).find((a) => a.id !== s.target);
  assert.ok(wanted);
  g.update(1 / 60, input([], [], { x: wanted.x + 6, y: wanted.y + 4, clicked: true }));
  assert.equal(g.getState().target, wanted.id);
  const other = g
    .getState()
    .anchors.filter((a) => a.eligible)
    .find((a) => a.id !== wanted.id);
  g.update(1 / 60, input([], [], { x: 5, y: 5, clicked: true }));
  assert.equal(g.getState().target, wanted.id, 'a stray tap keeps the aim');
  g.update(1 / 60, input([], [], { x: other.x, y: other.y, clicked: true }));
  assert.equal(g.getState().target, other.id);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().rope.id, other.id);
});
test('Enter and a tap both leave the clear screen, and neither is wasted on the first frame', () => {
  for (const advance of [input([], ['Enter']), input([], [], { x: 3, y: 3, clicked: true })]) {
    const { g } = startAt(1);
    const run = climb(1, {});
    assert.ok(run.cleared);
    run.g.update(1 / 60, input(['ArrowRight'], ['Space', 'KeyZ']));
    assert.equal(run.g.getState().betweenRoutes, true, 'other keys do not leave the clear screen');
    run.g.update(1 / 60, advance);
    assert.equal(run.g.getState().level, 2);
    assert.equal(run.g.getState().betweenRoutes, false);
    assert.equal(g.getState().level, 1);
  }
});
test('holding Space does not repeat the hook, and opposing directions cancel', () => {
  const { g } = startAt(1);
  for (let n = 0; n < 120; n++)
    g.update(1 / 120, input(['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']));
  const s = g.getState();
  assert.equal(s.rope, null);
  assert.equal(s.player.x, 62);
  g.update(1 / 120, input(['Space'], ['Space']));
  assert.ok(g.getState().rope);
  for (let n = 0; n < 120; n++) g.update(1 / 120, input(['Space']));
  assert.ok(g.getState().rope);
});
test('the real InputState turns touch buttons into every action the game offers', () => {
  const codes = new Set(meta.touchControls.map((t) => t.code));
  for (const code of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'KeyX',
    'KeyZ',
    'Enter',
  ])
    assert.ok(codes.has(code), code);
  for (const t of meta.touchControls)
    assert.ok(t.label.en && t.label.zh && ['left', 'right'].includes(t.side));
  const { g } = startAt(7);
  const pad = new InputState();
  pad.pulse('KeyX');
  g.update(1 / 60, pad);
  pad.flush();
  pad.down('Space', 'touch-hook');
  g.update(1 / 60, pad);
  assert.ok(g.getState().rope, 'a touch tap on the hook button hooks');
  pad.flush();
  g.update(1 / 60, pad);
  assert.ok(g.getState().rope, 'a held touch button does not release');
  pad.up('touch-hook');
  pad.pulse('KeyZ');
  g.update(1 / 60, pad);
  assert.equal(g.getState().lives, PHYSICS.lives - 1);
  assert.ok(meta.keys.every((k) => k.label.en && k.label.zh));
});
test('a rescue costs one life, restores a safe rest and a depleted climber can still rescue', () => {
  const { g } = startAt(1);
  g.update(1 / 120, input([], ['KeyZ']));
  const s = g.getState();
  assert.equal(s.lives, PHYSICS.lives - 1);
  assert.equal(s.checkpoint, 0);
  assert.equal(s.player.ground, true);
  assert.equal(s.energy, 100);
  for (let n = 0; n < 120; n++) g.update(1 / 120, input());
  assert.equal(g.getState().recovering, 0);
});
test('zero and invalid time freeze the whole snapshot without reading input', () => {
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
    const { g } = startAt(1),
      before = g.getState();
    let reads = 0;
    g.update(dt, {
      held() {
        reads++;
        return true;
      },
      pressed() {
        reads++;
        return true;
      },
      get pointer() {
        reads++;
        throw Error('input read');
      },
    });
    assert.equal(reads, 0);
    assert.deepEqual(g.getState(), before);
  }
});
test('resting on a cairn and flying with no rope add no sideways thrust', () => {
  const { g } = startAt(1);
  g.update(1 / 120, input([], ['Space']));
  const before = g.getState();
  for (let n = 0; n < 120; n++) g.update(1 / 240, input());
  assert.ok(Math.abs(g.getState().player.x - before.player.x) < 1e-6);
  const make = () => {
    const { g: game } = startAt(1);
    for (let n = 0; n < 240 && game.getState().player.ground; n++)
      game.update(1 / 120, input(['ArrowRight']));
    return game;
  };
  const a = make(),
    b = make();
  a.update(1 / 120, input(['ArrowRight']));
  b.update(1 / 120, input());
  assert.equal(a.getState().player.vx, b.getState().player.vx);
});
test('a fresh game restores every initial resource and returns independent snapshots', () => {
  const { g, h } = startAt(1),
    initial = g.getState();
  g.update(1 / 120, input([], ['KeyZ']));
  for (let n = 0; n < 50; n++) g.update(1 / 120, input());
  const fresh = createGame(h.env);
  assert.deepEqual(fresh.getState(), initial);
  const copy = fresh.getState();
  copy.player.x = 999;
  copy.route.solids[0].x = 999;
  copy.anchors[0].x = 999;
  assert.deepEqual(fresh.getState(), initial);
});
test('a wedge between two surfaces comes to rest instead of looping forever', () => {
  const s = createGrapnelState(1);
  const slotLeft = { x: 440, y: 150, w: 20, h: 200, kind: 'cairn' };
  s.route = {
    id: 'wedge',
    name: { en: 'Wedge', zh: '楔' },
    lesson: { en: 'x', zh: 'x' },
    anchors: [],
    pads: [],
    relics: [],
    solids: [slotLeft, { x: 468, y: 30, w: 12, h: 300, kind: 'wall' }],
  };
  s.player = { x: 461, y: 100, vx: 0, vy: 0, ground: false };
  const h = harness();
  const started = Date.now();
  for (let n = 0; n < 240; n++) updateGrapnelState(s, 1 / 60, input(), h.env);
  assert.ok(Date.now() - started < 3000, 'finishes promptly');
  assert.ok(Number.isFinite(s.player.y) && s.time > 3.9);
});

// ---------------------------------------------------------------------------------------------
// What is on screen
// ---------------------------------------------------------------------------------------------
function allNotices() {
  const found = [];
  for (const file of ['core', 'step', 'contact']) {
    const source = readFileSync(
      new URL(`../src/games/grapnel-gorge-${file}.js`, import.meta.url),
      'utf8',
    );
    for (const m of source.matchAll(/notify\(\s*s,\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'/g))
      found.push({ en: m[1], zh: m[2] });
  }
  return found;
}
test('every notice, tip and route name fits the HUD in both languages', () => {
  const notices = allNotices();
  assert.ok(notices.length >= 10);
  for (const n of notices) {
    assert.ok(wrapText(n.en, 11, 464).length <= 2, n.en);
    assert.ok(wrapText(n.zh, 11, 464).length <= 2, n.zh);
  }
  for (const l of LEVELS) {
    assert.ok(wrapText(l.lesson.en, 11, 464).length <= 2, l.id);
    assert.ok(wrapText(l.lesson.zh, 11, 464).length <= 2, l.id);
    assert.ok(textWidth(`20/20 ${l.name.en}`, 11) < 200, l.id);
    assert.ok(textWidth(`20/20 ${l.name.zh}`, 11) < 200, l.id);
  }
});
test('every screen of every route fits the canvas and is localized', () => {
  for (const lang of ['en', 'zh']) {
    for (const n of LEVEL_NUMBERS) {
      const { g } = startAt(n, { lang }),
        rec = recorder();
      g.draw(rec.ctx);
      assertTextFits(rec.calls, `route ${n} ${lang}`);
      const text = rec.calls
        .filter((c) => c.name === 'fillText')
        .map((c) => c.args[0])
        .join(' ');
      assert.equal(CJK.test(text), lang === 'zh', `route ${n} ${lang} localisation`);
      g.update(1 / 60, input([], ['Space']));
      const hooked = recorder();
      g.draw(hooked.ctx);
      assertTextFits(hooked.calls, `route ${n} ${lang} hooked`);
    }
    for (const unlocked of [2, 9, 20]) {
      const store = memoryStore(unlocked),
        { g } = startAt(1, { lang, store }),
        rec = recorder();
      g.draw(rec.ctx);
      assertTextFits(rec.calls, `select ${unlocked} ${lang}`);
      for (let k = 0; k < unlocked; k++) g.update(1 / 60, input([], ['ArrowRight']));
      const moved = recorder();
      g.draw(moved.ctx);
      assertTextFits(moved.calls, `select cursor ${lang}`);
    }
    const run = climb(1, { lang });
    const clear = recorder();
    run.g.draw(clear.ctx);
    assertTextFits(clear.calls, `clear ${lang}`);
  }
});
test('no overlay is drawn over the climber on any route, pause or clear screen', () => {
  const states = [];
  for (const n of LEVEL_NUMBERS) {
    const { g } = startAt(n);
    states.push([`start ${n}`, g]);
    const hooked = startAt(n).g;
    hooked.update(1 / 60, input([], ['Space']));
    for (let k = 0; k < 30; k++) hooked.update(1 / 60, input(['ArrowUp']));
    states.push([`hooked ${n}`, hooked]);
    const rescued = startAt(n).g;
    rescued.update(1 / 60, input([], ['KeyZ']));
    states.push([`rescued ${n}`, rescued]);
  }
  states.push(['cleared', climb(1, {}).g]);
  for (const [label, g] of states) {
    const rec = recorder();
    g.draw(rec.ctx);
    const body = playerBox(rec.calls);
    assert.ok(body, `${label}: the climber is drawn`);
    for (const c of rec.calls.slice(body.index + 1)) {
      if (c.name !== 'fillRect' || c.origin.x || c.origin.y) continue;
      const [x, y, w, h] = c.args;
      const hides = x < body.x + R && x + w > body.x - R && y < body.y + R && y + h > body.y - R;
      assert.ok(!hides, `${label}: a panel is drawn over the climber`);
    }
  }
});
test('anchor and landing cues carry shape as well as colour', () => {
  const { g } = startAt(7),
    rec = recorder();
  g.draw(rec.ctx);
  const strokes = rec.calls.filter((c) => c.name === 'strokeRect').length;
  assert.ok(strokes >= 4, 'each anchor has a frame');
  assert.ok(rec.calls.some((c) => c.name === 'fill') && rec.calls.some((c) => c.name === 'lineTo'));
  g.update(1 / 60, input([], ['Space']));
  const roped = recorder();
  g.draw(roped.ctx);
  assert.ok(
    roped.calls.some((c) => c.name === 'setLineDash'),
    'a slack rope is dashed',
  );
});

test('hooking from a cairn needs a still climber; a walking tap is refused with a message', () => {
  const { g, h } = startAt(3);
  g.update(1 / 60, input(['ArrowRight'], ['Space']));
  let s = g.getState();
  assert.equal(s.rope, null);
  assert.match(s.notice.en, /Stand still/);
  assert.match(s.notice.zh, /站稳/);
  assert.ok(h.sounds.includes('hit'));
  for (let n = 0; n < 40; n++) g.update(1 / 60, input());
  g.update(1 / 60, input([], ['Space']));
  assert.ok(g.getState().rope, 'a still climber hooks');
});
test('a climber that fell below the cairns cannot hook and must be rescued', () => {
  const s = createGrapnelState(3);
  const low = Math.max(...s.route.pads.map((p) => p.y)) + 20;
  s.player = { x: 200, y: low, vx: 0, vy: 0, ground: false };
  const h = harness();
  updateGrapnelState(s, 1 / 120, input([], ['Space']), h.env);
  assert.equal(s.rope, null);
  assert.match(s.notice.en, /Too low/);
});
test('a rock snaps the rope and costs a life, a cairn only cuts it', () => {
  const rock = createGrapnelState(2);
  const cairn = createGrapnelState(2);
  const h = harness();
  for (const [s, kind] of [
    [rock, 'overhang'],
    [cairn, 'cairn'],
  ]) {
    s.rope = { id: 0 };
    cutRope(s, h.env, { x: 100, y: 100, rect: { kind } });
  }
  assert.equal(rock.lives, PHYSICS.lives - 1);
  assert.equal(cairn.lives, PHYSICS.lives);
  assert.match(rock.notice.en, /costs? a life|cost a life/);
  const last = createGrapnelState(2);
  last.lives = 1;
  cutRope(last, h.env, { x: 1, y: 1, rect: { kind: 'overhang' } });
  assert.equal(last.phase, 'lost');
  assert.equal(h.ends.length, 1);
});
test('hooking while standing under a moving anchor never sinks the climber into the cairn', () => {
  const gap = (p, r) =>
    Math.hypot(
      p.x - Math.max(r.x, Math.min(r.x + r.w, p.x)),
      p.y - Math.max(r.y, Math.min(r.y + r.h, p.y)),
    ) - R;
  for (const n of [4, 15, 16, 18, 19]) {
    const solids = routePlan(n).solids,
      h = harness();
    for (let x = 30; x < 100; x += 14)
      for (const hookAt of [0.05, 0.31, 0.7, 1.1, 1.9, 2.6]) {
        const s = createGrapnelState(n),
          pad = s.route.pads[0];
        s.player = { x, y: pad.y - R, vx: 0, vy: 0, ground: true };
        let worst = 0;
        for (let i = 0; i < 60 * 3; i++) {
          updateGrapnelState(
            s,
            1 / 60,
            input([], i === Math.round(hookAt * 60) ? ['Space'] : []),
            h.env,
          );
          for (const r of solids) worst = Math.max(worst, -gap(s.player, r));
        }
        assert.ok(worst < 0.01, `route ${n} x ${x} hook ${hookAt}: sank ${worst}`);
        assert.equal(s.lives, PHYSICS.lives);
        assert.ok(Math.abs(s.ledger.numerical) < 5, 'numerical work stays booked and small');
      }
  }
});
