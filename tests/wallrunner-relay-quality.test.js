import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, endMessage } from '../src/games/wallrunner-relay.js';
import { COURSES, LEVEL_COUNT } from '../src/games/wallrunner-relay-levels.js';
import { harness, input, mockContext, seeded } from './harness.js';

const COURSE_IDS = Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
const TEACHING_AND_COMBINATION = COURSE_IDS.slice(0, 15);
const MASTERY = COURSE_IDS.slice(15);
const FRAME_RATES = [30, 60, 120];
const DELAYS = [0.25, 0.35];
const CJK = /[㐀-鿿]/;

// ---------------------------------------------------------------------------------------------
// Harness: open any unlocked course the way a player does (course select, then Space).
// ---------------------------------------------------------------------------------------------
function memoryStore(value) {
  const store = {
    value,
    unlocks: [],
    unlocked: () => store.value,
    unlock(n) {
      store.unlocks.push(n);
      store.value = Math.max(store.value, n);
    },
  };
  return store;
}
function open(course, { lang = 'en', seed = 1, progress = memoryStore(course) } = {}) {
  const h = harness({ lang, seed }),
    g = createGame({ ...h.env, progress });
  if (course > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, progress };
}
const cleared = (s, course) => s.course > course || s.phase === 'won';
const passed = (s, course) => cleared(s, course) || s.phase === 'lost';

// ---------------------------------------------------------------------------------------------
// A reaction-limited player. It only reads getState(), sees it `delay` seconds late, estimates where
// it is now from the late snapshot plus the keys it has pressed since, and aims every jump with a
// few pixels of seeded error (`jitter`). It runs right, climbs chalk with X, mashes Space in pits,
// walks off short drops, and waits on relay pads until its energy is full.
// ---------------------------------------------------------------------------------------------
const GRAVITY = 900;
const RUN = 110;
const GROUND_ACCEL = 900;
const AIR_ACCEL = 450;
const FALL_SEEN = 290;
const SUBSTEPS = 4;
const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let z = Math.imul(seed ^ (seed >>> 15), seed | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
};
const chalkOn = (o, top, bottom) => o.chalk.L.some(([a, b]) => b > top + 4 && a < bottom - 4);
function makeBot({ delay, jitter = 0, lead = 3, seed = 1 }) {
  const rng = mulberry(seed),
    aim = new Map(),
    pressedRight = [],
    memory = { clock: 0, pausedUntil: 0 };
  const aimFor = (key) => {
    if (!aim.has(key)) aim.set(key, (rng() * 2 - 1) * jitter);
    return aim.get(key);
  };
  return function decide(S, dt) {
    const p = S.player,
      solids = S.solids,
      now = memory.clock,
      lag = Math.round(delay / dt),
      held = ['KeyX'],
      pressed = [];
    memory.clock += dt;
    let ex = p.x,
      speed = p.vx;
    const accel = (p.ground ? GROUND_ACCEL : AIR_ACCEL) * (dt / SUBSTEPS);
    for (let k = Math.max(0, pressedRight.length - lag); !p.running && k < pressedRight.length; k++)
      for (let i = 0; i < SUBSTEPS; i++) {
        speed += Math.max(-accel, Math.min(accel, (pressedRight[k] ? RUN : 0) - speed));
        ex += speed * (dt / SUBSTEPS);
      }
    for (const o of solids)
      if (o.x >= p.x + p.w - 1 && o.y < p.y + p.h - 2 && o.y + o.h > p.y)
        ex = Math.min(ex, o.x - p.w);
    const flying = !p.ground && !p.running,
      ey = flying
        ? p.y + p.vy * delay + 0.5 * GRAVITY * delay * delay
        : p.y + (p.running ? p.vy * delay : 0),
      feet = ey + p.h,
      front = ex + p.w,
      feetThen = p.y + p.h;
    if (!p.ground && p.y > FALL_SEEN && p.vy > 300) memory.pausedUntil = now + delay + 0.1;
    if (now < memory.pausedUntil) {
      pressedRight.push(false);
      return input([], []);
    }
    const roofs = solids.filter((o) => !o.boundary),
      sup = roofs
        .filter(
          (o) =>
            ex + p.w > o.x &&
            ex < o.x + o.w &&
            (p.ground ? Math.abs(o.y - feetThen) < 1 : o.y >= feetThen - 1 && o.y <= feet + 1),
        )
        .sort((a, b) => a.y - b.y)[0],
      landed = Boolean(sup) && !p.running,
      pad = S.pads.find(
        (q) =>
          ex + p.w / 2 + (speed * speed) / (2 * GROUND_ACCEL) >= q.x0 &&
          ex + p.w / 2 <= q.x1 &&
          Math.abs(q.y - feet) < 8,
      ),
      leftWall = solids.find((o) => o.x + o.w <= ex + 1 && o.x + o.w >= ex - 45 && o.y < feet - 4),
      rightWall = solids
        .filter((o) => o.x >= front - 1 && o.x <= front + 45 && o.y < feet - 4)
        .sort((a, b) => a.x - b.x)[0],
      inShaft =
        leftWall &&
        rightWall &&
        !p.running &&
        feet > rightWall.y + 2 &&
        !chalkOn(rightWall, ey, feet);
    let jump = false;
    if (inShaft) jump = !(pad && S.energy < 97) && S.energy > 12;
    else if (landed) {
      const edge = sup.x + sup.w,
        next = roofs.filter((o) => o.x >= edge - 0.5 && o.x > sup.x).sort((a, b) => a.x - b.x)[0];
      if (next) {
        const gap = next.x - edge,
          rise = sup.y - next.y,
          toEdge = edge - front,
          walkOff = p.w + RUN * Math.sqrt((2 * Math.max(0, -rise)) / GRAVITY) >= gap + 2;
        if (gap > 0.5)
          jump =
            speed >= RUN - 10 &&
            toEdge <= lead + aimFor(`${sup.x}:${S.lives}`) &&
            !(rise < 0 && walkOff);
        else if (rise > 0) jump = !chalkOn(next, sup.y - p.h, sup.y) && toEdge <= 30;
      }
    }
    const waiting = Boolean(pad) && S.energy < 97 && (landed || inShaft);
    if (waiting) jump = false;
    else held.push('ArrowRight');
    pressedRight.push(!waiting);
    if (jump) pressed.push('Space');
    return input(held, pressed);
  };
}
/** Plays one course with the bot; `lost` counts lives lost on the way. */
function playBot(course, { delay = 0, hz = 60, seconds = 100, ...aim } = {}) {
  const { g, h, progress } = open(course),
    decide = makeBot({ delay, ...aim }),
    lag = Math.round(delay * hz),
    history = [];
  let lost = 0,
    frames = 0;
  for (; frames < seconds * hz; frames++) {
    const now = g.getState();
    if (passed(now, course)) break;
    history.push(now);
    g.update(1 / hz, decide(history[Math.max(0, history.length - 1 - lag)], 1 / hz));
    lost += Number(g.getState().lives < now.lives);
  }
  const end = g.getState();
  return {
    cleared: passed(end, course) && end.phase !== 'lost',
    lost,
    seconds: frames / hz,
    g,
    h,
    progress,
  };
}
function sweep(courses, options) {
  let runs = 0,
    cleared = 0,
    lost = 0;
  for (const course of courses)
    for (const hz of FRAME_RATES)
      for (const delay of DELAYS)
        for (const seed of options.seeds) {
          const r = playBot(course, { delay, hz, jitter: 8, lead: 4, seed });
          runs++;
          cleared += Number(r.cleared);
          lost += r.lost;
        }
  return { runs, cleared, lost };
}

// ---------------------------------------------------------------------------------------------
// Course clears: scripted legal play, then the reaction-limited bot.
// ---------------------------------------------------------------------------------------------
test('every course has a scripted public-input clear without losing a life at 30, 60 and 120 Hz', () => {
  for (const course of COURSE_IDS)
    for (const hz of FRAME_RATES) {
      const r = playBot(course, { hz });
      assert.ok(r.cleared, `course ${course} @${hz}`);
      assert.equal(r.lost, 0, `course ${course} @${hz} lost a life`);
      if (course === LEVEL_COUNT) assert.equal(r.h.ends.length, 1);
    }
});

test('a reaction-limited bot (0.25 s and 0.35 s late) clears courses 1-15 at 30, 60 and 120 Hz', () => {
  const { runs, cleared, lost } = sweep(TEACHING_AND_COMBINATION, { seeds: [1] });
  assert.equal(cleared, runs);
  assert.ok(lost / runs < 1, `teaching and combination courses lose ${lost / runs} lives per run`);
});

test('the mastery tier (16-20) costs the bot at least one life per run yet it still clears most runs', () => {
  const { runs, cleared, lost } = sweep(MASTERY, { seeds: [1, 2, 3] });
  assert.ok(cleared / runs >= 0.85, `mastery clear rate ${cleared / runs}`);
  assert.ok(lost / runs >= 1, `mastery lives lost per run ${lost / runs}`);
});

// ---------------------------------------------------------------------------------------------
// Blind play: idle, mash, random keys and simple timed rhythms.
// ---------------------------------------------------------------------------------------------
const PERIODS = [0.3, 0.5, 0.75, 1, 1.5, 2, 3];
const rhythm = (period, alternate) => (frame, hz) => {
  const t = frame / hz,
    leg = Math.floor(t / period + 1e-9),
    first = Math.abs(t - leg * period) < 0.5 / hz,
    dir = alternate && leg % 2 ? 'ArrowLeft' : 'ArrowRight';
  return input([dir, 'KeyX'], first ? ['Space'] : []);
};
const randomKeys = (seed) => {
  const rng = seeded(seed);
  let keys = [];
  return (frame) => {
    if (frame % 12 === 0)
      keys = [['ArrowLeft'], ['ArrowRight', 'KeyX'], [], ['ArrowRight'], ['ArrowRight', 'KeyX']][
        Math.floor(rng() * 5)
      ];
    return input(keys, rng() < 0.2 ? ['Space'] : []);
  };
};
const POLICIES = [
  () => input(),
  () => input([], ['Space']),
  randomKeys(5),
  randomKeys(6),
  ...PERIODS.flatMap((p) => [rhythm(p, false), rhythm(p, true)]),
];
function blindWins(course, policy, hz = 60, seconds = 60) {
  const { g } = open(course);
  for (let frame = 0; frame < seconds * hz; frame++) {
    g.update(1 / hz, policy(frame, hz));
    if (frame % 30 === 0 && passed(g.getState(), course)) break;
  }
  return cleared(g.getState(), course);
}
test('an idle player is safe at the start of course 1 and blind play wins at most 25% from course 3', () => {
  const { g } = open(1);
  for (let i = 0; i < 60 * 12; i++) g.update(1 / 60, input());
  assert.equal(g.getState().lives, 5);
  assert.equal(g.getState().phase, 'playing');
  for (const course of COURSE_IDS) {
    const wins = POLICIES.filter((policy) => blindWins(course, policy)).length;
    assert.ok(
      !blindWins(course, POLICIES[0]) && !blindWins(course, POLICIES[1]),
      `course ${course}`,
    );
    if (course >= 3)
      assert.ok(
        wins / POLICIES.length <= 0.25,
        `course ${course} blind wins ${wins}/${POLICIES.length}`,
      );
  }
});

// ---------------------------------------------------------------------------------------------
// Frame rates, hostile values, physics.
// ---------------------------------------------------------------------------------------------
test('results agree between frame rates for the same timed inputs', () => {
  const states = FRAME_RATES.map((hz) => {
    const { g } = open(3);
    for (let frame = 0; frame < hz * 5; frame++) {
      const t = frame / hz,
        tap = [0.5, 1.2, 1.7].some((at) => Math.abs(t - at) < 0.5 / hz);
      g.update(1 / hz, input(['ArrowRight', 'KeyX'], tap ? ['Space'] : []));
    }
    return g.getState();
  });
  for (const s of states.slice(1)) {
    assert.ok(Math.abs(s.player.x - states[0].player.x) < 1e-6);
    assert.ok(Math.abs(s.player.y - states[0].player.y) < 1e-6);
    assert.ok(Math.abs(s.energy - states[0].energy) < 1e-6);
    assert.equal(s.lives, states[0].lives);
  }
});

test('hostile dt values never advance or corrupt the game', () => {
  const { g } = open(2),
    trap = { held: () => assert.fail('read'), pressed: () => assert.fail('read'), pointer: {} };
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 1e9, undefined, null, '1'])
    g.update(dt, dt === 1e9 ? input(['ArrowRight']) : trap);
  assert.equal(JSON.stringify(g.getState()), before);
  const play = open(1).g;
  for (const dt of [0.5, 1, 1.01, 5]) play.update(dt, input(['ArrowRight']));
  const s = play.getState();
  assert.ok(Number.isFinite(s.player.x) && s.player.x < 200);
});

test('hostile pointer values on the course select never throw or start a locked course', () => {
  for (const pointer of [
    undefined,
    null,
    {},
    { clicked: true },
    { clicked: true, x: NaN, y: NaN },
    { clicked: true, x: Infinity, y: -Infinity },
    { clicked: true, x: '50', y: '40' },
    { clicked: true, x: {}, y: [] },
    { clicked: true, x: 1e9, y: -1e9 },
    { clicked: true, x: 400, y: 200 },
  ]) {
    const { g } = open(3, { progress: memoryStore(3) });
    g.update(1 / 60, { held: () => false, pressed: () => false, pointer });
    const s = g.getState();
    assert.ok(s.menu === null || s.menu.cursor <= 3);
    g.draw(mockContext());
  }
});

function finiteDeep(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) finiteDeep(v, `${path}.${k}`);
}
test('random play stays finite, bounded and never overlaps a solid', () => {
  for (const course of [1, 3, 5, 9, 13, 17])
    for (const seed of [1, 2]) {
      const { g } = open(course),
        rng = seeded(seed * 17 + course),
        keys = randomKeys(seed);
      for (let frame = 0; frame < 60 * 20; frame++) {
        g.update(rng() < 0.05 ? 1 / 30 : 1 / 60, keys(frame));
        if (frame % 20) continue;
        const s = g.getState(),
          p = s.player;
        finiteDeep(s);
        assert.ok(p.y < 400 && p.x > -1);
        for (const o of s.solids)
          assert.ok(
            !(
              p.x + p.w > o.x + 1e-6 &&
              p.x < o.x + o.w - 1e-6 &&
              p.y + p.h > o.y + 1e-6 &&
              p.y < o.y + o.h - 1e-6
            ),
            `course ${course} overlaps a solid at ${p.x},${p.y}`,
          );
        if (s.phase !== 'playing') break;
      }
    }
});

// ---------------------------------------------------------------------------------------------
// Progress: select, continue, unlock on clear, broken stores.
// ---------------------------------------------------------------------------------------------
test('clearing a course unlocks the next one and a later visit continues from it', () => {
  const r = playBot(2, { hz: 60 });
  assert.ok(r.cleared);
  assert.deepEqual(r.progress.unlocks, [3]);
  assert.equal(r.progress.value, 3);
  const again = open(1, { progress: r.progress });
  assert.equal(again.g.getState().menu.cursor, 3);
  assert.equal(again.g.getState().unlocked, 3);
});

test('broken or hostile progress stores fall back to course 1 and never stop the game', () => {
  const clamp = (value) => ({ unlocked: () => value, unlock() {} });
  const expected = [
    [NaN, 1],
    ['x', 1],
    [null, 1],
    [undefined, 1],
    [-5, 1],
    [0, 1],
    [1e9, 20],
    [Infinity, 1],
    [3.7, 3],
    ['4', 4],
  ];
  for (const [value, cursor] of expected) {
    const { g } = open(1, { progress: clamp(value) }),
      s = g.getState();
    assert.equal(s.menu ? s.menu.cursor : 1, cursor, `value ${value}`);
    g.draw(mockContext());
  }
  const throwing = {
    unlocked: () => {
      throw new Error('storage disabled');
    },
    unlock: () => {
      throw new Error('storage disabled');
    },
  };
  const { g } = open(1, { progress: throwing });
  assert.equal(g.getState().menu, null);
  const noStore = createGame(harness().env);
  assert.equal(noStore.getState().menu, null);
  // Clearing a course with a throwing store still advances.
  const h = harness(),
    game = createGame({ ...h.env, progress: throwing }),
    decide = makeBot({ delay: 0 });
  for (let i = 0; i < 60 * 30 && game.getState().course === 1; i++)
    game.update(1 / 60, decide(game.getState(), 1 / 60));
  assert.equal(game.getState().course, 2);
});

test('the course select moves, refuses locked courses and starts the chosen course', () => {
  const { g, h } = open(1, { progress: memoryStore(7) });
  let s = g.getState();
  assert.equal(s.menu.cursor, 7);
  g.update(1 / 60, input([], ['ArrowLeft']));
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], ['ArrowRight', 'ArrowRight']));
  assert.equal(g.getState().menu.cursor, 7, 'the cursor stops at the last unlocked course');
  g.update(1 / 60, input([], ['ArrowUp']));
  assert.equal(g.getState().menu.cursor, 2);
  g.update(1 / 60, input([], ['ArrowDown']));
  assert.equal(g.getState().menu.cursor, 7);
  const sounds = h.sounds.length;
  g.update(1 / 60, input([], [], { x: 400, y: 190, clicked: true }));
  assert.equal(g.getState().menu.cursor, 7, 'a tap on a locked course changes nothing');
  assert.equal(h.sounds.at(-1), 'hit');
  assert.ok(h.sounds.length > sounds);
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.equal(g.getState().menu.cursor, 7, 'a tap between courses changes nothing');
  g.update(1 / 60, input([], [], { x: 20, y: 40, clicked: true }));
  s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.course, 1);
  const tap = open(1, { progress: memoryStore(7) });
  tap.g.update(1 / 60, input([], [], { x: 11 + 3 * 94 + 10, y: 28 + 10, clicked: true }));
  assert.equal(tap.g.getState().course, 4);
  const start = open(5);
  assert.equal(start.g.getState().course, 5);
});

// ---------------------------------------------------------------------------------------------
// Endings: one callback, localized text, frozen terminal state.
// ---------------------------------------------------------------------------------------------
test('winning and losing each report once, in both languages, then freeze', () => {
  for (const lang of ['en', 'zh']) {
    const lose = open(1, { lang });
    for (let i = 0; i < 60 * 40; i++) lose.g.update(1 / 60, input(['ArrowRight']));
    assert.equal(lose.h.ends.length, 1);
    assert.equal(lose.h.ends[0].won, false);
    assert.equal(
      lose.h.ends[0].message,
      lang === 'en' ? 'You fell between the rooftops.' : '你从屋顶间坠落了。',
    );
    assert.equal(lose.h.sounds.at(-1), 'lose');
    const frozen = JSON.stringify(lose.g.getState());
    for (let i = 0; i < 30; i++) lose.g.update(1 / 60, input(['ArrowLeft', 'KeyX'], ['Space']));
    assert.equal(JSON.stringify(lose.g.getState()), frozen);
    assert.equal(lose.h.ends.length, 1);

    const win = open(LEVEL_COUNT, { lang }),
      decide = makeBot({ delay: 0 });
    for (let i = 0; i < 60 * 100 && win.g.getState().phase === 'playing'; i++)
      win.g.update(1 / 60, decide(win.g.getState(), 1 / 60));
    assert.equal(win.h.ends.length, 1);
    assert.equal(win.h.ends[0].won, true);
    assert.equal(win.h.ends[0].score, win.g.getState().score);
    assert.match(win.h.ends[0].message, lang === 'en' ? /twenty courses/ : /二十条赛道/);
    assert.equal(win.h.sounds.at(-1), 'win');
    const done = JSON.stringify(win.g.getState());
    win.g.update(1 / 60, input(['ArrowRight'], ['Space']));
    assert.equal(JSON.stringify(win.g.getState()), done);
  }
  const t = (en, zh) => ({ en, zh });
  assert.match(endMessage(t, { phase: 'lost', cause: 'energy' }).en, /energy reserve/);
  assert.match(endMessage(t, { phase: 'lost', cause: 'energy' }).zh, /能量耗尽/);
  assert.match(endMessage(t, { phase: 'lost', cause: 'fall' }).en, /fell/);
});

// ---------------------------------------------------------------------------------------------
// Drawing: complete, bilingual, inside the canvas, and never over the runner.
// ---------------------------------------------------------------------------------------------
function textCanvas() {
  const ctx = mockContext(),
    drawn = [];
  ctx.fillText = (text, x, y) => {
    const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 12);
    drawn.push({ text: String(text), x, y, size, align: ctx.textAlign });
  };
  return { ctx, drawn };
}
const widthOf = (text, size) =>
  [...text].reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? size : size * 0.62), 0);
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(left >= 0 && left + w <= 480, `${label}: "${text}" spans ${left}..${left + w}`);
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
function assertLanguage(drawn, lang) {
  for (const { text } of drawn)
    if (lang === 'en') assert.doesNotMatch(text, CJK, `English screen shows "${text}"`);
    else assert.doesNotMatch(text, /[A-Za-z]{3,}/, `Chinese screen shows "${text}"`);
}
test('every opening frame shows its tip, fits the canvas, is localized and shows the first hazard', () => {
  for (const lang of ['en', 'zh'])
    for (const course of COURSE_IDS) {
      const { g } = open(course, { lang }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} course ${course}`);
      assertLanguage(drawn, lang);
      assert.ok(
        drawn.some((d) => d.text === COURSES[course - 1].tip[lang]),
        `tip ${lang} ${course}`,
      );
      assert.ok(drawn.some((d) => d.text.startsWith(`${course}/20 `)));
      const s = g.getState(),
        roofs = s.solids.filter((o) => !o.boundary);
      assert.ok(
        roofs[1].x <= s.camera.x + 240 - 4,
        `course ${course}: the first hazard is in view`,
      );
      assert.ok(roofs[0].x + roofs[0].w > s.camera.x && s.player.x >= s.camera.x);
    }
});

test('the course select, hud and every moving state fit in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const unlocked of [2, 9, LEVEL_COUNT]) {
      const { g } = open(1, { lang, progress: memoryStore(unlocked) }),
        { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select ${unlocked}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CHOOSE A COURSE' : '选择赛道')));
      assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'CLEARED' : '已通关')));
      assert.ok(
        drawn.some((d) => d.text === (lang === 'en' ? 'LOCKED' : '未解锁')) ||
          unlocked === LEVEL_COUNT,
      );
      assert.equal(g.getState().status[lang].includes(String(unlocked)), true);
    }
    for (const course of [3, 5, 6, 16]) {
      const { g } = open(course, { lang }),
        { ctx, drawn } = textCanvas(),
        decide = makeBot({ delay: 0.25, jitter: 8, lead: 4 }),
        history = [];
      for (let frame = 0; frame < 60 * 40; frame++) {
        const now = g.getState();
        if (passed(now, course)) break;
        history.push(now);
        g.update(1 / 60, decide(history[Math.max(0, history.length - 15)], 1 / 60));
        if (frame % 15 === 0) g.draw(ctx);
      }
      assertFits(drawn, `${lang} play ${course}`);
      assertLanguage(drawn, lang);
      assert.ok(drawn.some((d) => d.text.startsWith(lang === 'en' ? 'ENERGY' : '能量')));
    }
  }
});

test('no overlay ever covers the runner or the beacon during legal play', () => {
  for (const course of [1, 5, 12, 16, 20]) {
    const { g } = open(course),
      decide = makeBot({ delay: 0.25, jitter: 8, lead: 4 }),
      history = [];
    for (let frame = 0; frame < 60 * 60; frame++) {
      const now = g.getState();
      if (passed(now, course)) break;
      history.push(now);
      g.update(1 / 60, decide(history[Math.max(0, history.length - 15)], 1 / 60));
      if (frame % 6) continue;
      const s = g.getState(),
        top = (s.player.y - s.camera.y) * 2,
        bottom = (s.player.y + s.player.h - s.camera.y) * 2;
      assert.ok(top >= 44 && bottom <= 292, `course ${course} runner at ${top}..${bottom}`);
    }
  }
});

test('a flash, trail, banner and every runner pose draw without error', () => {
  const { g, h } = open(3),
    ctx = mockContext(),
    decide = makeBot({ delay: 0 });
  for (let frame = 0; frame < 60 * 30; frame++) {
    g.update(1 / 60, decide(g.getState(), 1 / 60));
    if (frame % 5 === 0) g.draw(ctx);
    if (g.getState().course > 3) break;
  }
  const { ctx: text, drawn } = textCanvas();
  g.update(1 / 60, input(['ArrowRight']));
  g.draw(text);
  for (let i = 0; i < 30; i++) g.update(1 / 60, input(['ArrowLeft']));
  g.draw(ctx);
  assert.ok(drawn.some((d) => d.text === 'COURSE CLEAR!'));
  assertFits(drawn, 'banner');
  // A fall paints the red flash; the end screen draws too.
  const lost = open(1);
  for (let i = 0; i < 60 * 40; i++) {
    lost.g.update(1 / 60, input(['ArrowRight']));
    if (i % 30 === 0) lost.g.draw(ctx);
  }
  lost.g.draw(ctx);
  assert.equal(h.ends.length, 0);
  assert.equal(lost.h.ends.length, 1);
});
