import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS,
  LEVEL_COUNT,
  RULES,
  advance,
  createGame,
  newState,
  snapshotOf,
  textWidth,
} from '../src/games/tide-lock.js';
import { harness, input, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every player sees only what the screen shows through getState(): the prompt, the water
// levels, the valves, the gates and the boats. They press only public keys.
// ---------------------------------------------------------------------------------------------
const HZS = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const SEEDS = 10;
const LAST_THIRD = Math.ceil((LEVEL_COUNT * 2) / 3 + 1e-9);
const WIN = (st, level) => st.level > level || st.phase === 'won';
const KEYS = ['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'Enter'];

// The game with the planner's own line added to the snapshot as `hint`. From lock 15 on the shown
// prompt names the goal only, so the follower below, which is told every step, reads `hint`: it
// stands for a player who knows the solution and proves each lock is fair to play step by step.
// Only newState, advance and snapshotOf are used.
function plannerGame(env) {
  const s = newState(env);
  let ended = false;
  return {
    update(dt, inp) {
      advance(s, dt, inp, env.sound);
      if (s.phase === 'playing' || ended) return;
      ended = true;
      env.sound(s.phase === 'won' ? 'win' : 'lose');
      env.end({ won: s.phase === 'won', score: s.score, message: s.phase });
    },
    getState() {
      const { en, zh, kind, press, key } = s.line;
      return { ...snapshotOf(s), hint: { en, zh, kind, press: press || null, key } };
    },
  };
}

function begin(level, seed = 1, lang = 'en', { hinted = true } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = hinted ? plannerGame(h.env) : createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

// A literal prompt follower: it presses the key the prompt named `lag` seconds ago, once per prompt
// (it repeats only if the same prompt is still there after 1.5 s), at most every 0.12 s.
function follower(lagOf) {
  const hist = [];
  let last = { key: null, t: -9 };
  let lastPress = -9;
  let hintless = null;
  return (st, t) => {
    hist.push({ t, p: st.hint });
    if (hist.length > 600) hist.shift();
    // a literal player who has stared at "No hint yet" for 20 s presses Enter, as the line says
    if (st.hint.key === 'nohint') hintless ??= t;
    else hintless = null;
    if (hintless !== null && t - hintless >= 20) {
      hintless = null;
      lastPress = t;
      return ['Enter'];
    }
    const seenAt = t - Math.max(0, lagOf());
    let k = hist.length - 1;
    while (k > 0 && hist[k].t > seenAt) k--;
    const p = hist[k].p;
    if (!p || p.kind === 'watch' || !p.press || t - lastPress < 0.12) return [];
    if (p.key === last.key && t - last.t < 1.5) return [];
    last = { key: p.key, t };
    lastPress = t;
    return [p.press];
  };
}

// delay: a lag range (seconds) drawn once per run, with some jitter on every glance.
function humanRun(
  level,
  hz,
  { delay = FAST, seed = 1, lang = 'en', seconds = 240, jitter = 0.1, onFrame, before } = {},
) {
  const { g, h } = begin(level, seed, lang);
  const rnd = seeded(seed * 7919 + 13);
  const base = delay[0] + rnd() * (delay[1] - delay[0]);
  const decide = follower(() => base + (rnd() - 0.5) * jitter);
  let hull = RULES.lives;
  let stuckSeen = false;
  let t = 0;
  let st = g.getState();
  for (; t < seconds; t += 1 / hz) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    hull = Math.min(hull, st.lives);
    stuckSeen = stuckSeen || st.stuck;
    const keys = before?.(st, t) ?? decide(st, t);
    onFrame?.(st, t, keys);
    g.update(1 / hz, input([], keys));
  }
  st = g.getState();
  return { st, t, hull, stuckSeen, cleared: WIN(st, level), g, h };
}

const rate = (n, total) => `${n}/${total}`;

function rates(delay, minWins, lang = 'en') {
  const report = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    const why = [];
    for (const hz of HZS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = humanRun(level, hz, { delay, seed: seed + level * 100, lang });
        if (r.cleared) wins++;
        else why.push(`${hz}Hz/s${seed}:${r.st.phase}/hull${r.hull}`);
      }
    report.push(`${level}:${wins}`);
    assert.ok(
      wins >= minWins,
      `lock ${level}: ${rate(wins, 30)} (${report.join(' ')}) ${why.join(' ')}`,
    );
  }
  return report;
}

test('quality: a prompt-following player (0.15-0.35 s lag) clears every lock in at least 27 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-lock wins, fast: ${rates(FAST, 27).join(' ')}`);
});

test('quality: a slow prompt-following player (0.4-0.6 s lag) clears every lock in at least 24 of 30 runs at 30, 60 and 120 Hz', () => {
  console.log(`per-lock wins, slow: ${rates(SLOW, 24).join(' ')}`);
});

test('quality: a literal follower at lag 0, 0.25 and 0.5 s clears every lock with every hull intact and is never told the water is wasted', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const lag of [0, 0.25, 0.5])
      for (const hz of lag === 0 ? HZS : [60]) {
        const r = humanRun(level, hz, { delay: [lag, lag], jitter: 0, seed: level });
        const where = `lock ${level} lag ${lag} @${hz} Hz`;
        assert.ok(r.cleared, `${where} did not clear (${r.st.phase})`);
        assert.equal(r.hull, RULES.lives, `${where} lost a hull`);
        assert.equal(r.stuckSeen, false, `${where} was led into wasted water`);
        assert.ok(r.t < 4 * LEVELS[level - 1].par + 60, `${where} took ${r.t} s`);
      }
});

test('quality: the Chinese interface plays exactly like the English one', () => {
  for (const level of [1, 6, 11, 16, 20, 22]) {
    const a = humanRun(level, 60, { delay: [0.25, 0.25], jitter: 0, seed: 3, lang: 'en' });
    const b = humanRun(level, 60, { delay: [0.25, 0.25], jitter: 0, seed: 3, lang: 'zh' });
    assert.ok(a.cleared && b.cleared, `lock ${level}`);
    assert.equal(a.t, b.t, `lock ${level}: the two languages took different times`);
  }
});

// Deliberate mistakes: a burst of stray valve and gate presses, then the follower reads the prompt again.
const MISTAKES = [
  'ArrowRight',
  'Space',
  'ArrowRight',
  'Space',
  'ArrowRight',
  'Space',
  'ArrowRight',
  'Space',
  'KeyX',
  'Space',
  'KeyX',
  'Space',
  'ArrowLeft',
  'Space',
  'ArrowLeft',
  'Space',
];

test('quality: the prompt recovers from deliberate mistakes on every lock, resetting the lock when the water is gone', () => {
  const failures = [];
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const hz of [30, 120])
      for (let seed = 1; seed <= 2; seed++) {
        const rnd = seeded(seed * 31 + level);
        const t0 = 3 + rnd() * 10;
        const picks = Array.from(
          { length: 6 },
          () => MISTAKES[Math.floor(rnd() * MISTAKES.length)],
        );
        const lag = seeded(seed + level)() < 0.5 ? 0.25 : 0.45;
        const decide = follower(() => lag);
        const r = humanRun(level, hz, {
          seed,
          seconds: 360,
          before: (st, t) => {
            const k = Math.floor((t - t0) / 0.15);
            if (t < t0 || k >= picks.length) return decide(st, t);
            return Math.floor((t - 1 / hz - t0) / 0.15) !== k ? [picks[k]] : [];
          },
        });
        if (!r.cleared) failures.push(`lock ${level} @${hz} Hz seed ${seed}: ${r.st.phase}`);
        assert.notEqual(r.st.phase, 'lost', `lock ${level} @${hz} Hz seed ${seed} lost the fleet`);
      }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------
const CJK = /[一-鿿]/;
const PRESS_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'Enter']);

function labelOf(st, guide) {
  return guide.kind === 'valve' ? st.valves[guide.index ?? guide.i].label : st.gates[guide.i].label;
}

// From RULES.goalFrom on the shown line states the goal or the problem: it never names a control, a
// key, an arrow or an action, and nothing is highlighted but the water mark.
const NAMES_A_CONTROL = /\b[VGP]\d\b|\bSpace\b|\bpress\b|\bselect\b|\bopen\b|\bclose\b|\bX\b|[←→]/i;
const NAMES_A_CONTROL_ZH = /[阀闸泵]\d|空格|[←→]|按 X|打开|关闭|选择/;
const GOAL_KEYS = /^(goal:\d|aground|clear|docked|stuck|stranded|giveup|menu)$/;
function checkGoalPrompt(st) {
  const p = st.prompt;
  assert.match(p.key, GOAL_KEYS, `lock ${st.level}: unexpected key ${p.key}`);
  if (/^(stuck|stranded|giveup)$/.test(p.key)) return;
  assert.equal(p.kind, 'watch');
  assert.equal(p.press, null);
  assert.equal(st.guide.control, null);
  assert.ok(!NAMES_A_CONTROL.test(p.en), `lock ${st.level}: "${p.en}" names a control`);
  assert.ok(!NAMES_A_CONTROL_ZH.test(p.zh), `lock ${st.level}: "${p.zh}" names a control`);
}

function checkPrompt(st, lang) {
  const p = st.prompt;
  assert.ok(p.en && p.zh, 'a prompt without both languages');
  assert.ok(CJK.test(p.zh), `no Chinese in "${p.zh}"`);
  assert.ok(!CJK.test(p.en), `Chinese in "${p.en}"`);
  assert.deepEqual(st.line, { en: p.en, zh: p.zh });
  assert.ok(st.status[lang].endsWith(p.line ?? st.line[lang]));
  assert.ok(p.en.length * 8.4 <= 440, `"${p.en}" is too wide`);
  assert.ok(textWidth(p.zh, 14) <= 440, `"${p.zh}" is too wide`);
  const bare = p.en.replace(/\b[VGP]\d+\b|\b(?:Lock|Basin|Step|Dock|boat) \d\b/g, '');
  assert.ok(!/\d/.test(bare), `digits in the prompt "${p.en}" would flicker`);
  assert.ok(!/\b[VGP]\d/.test(p.zh), `Latin control label in "${p.zh}"`);
  if (st.level >= RULES.goalFrom) return checkGoalPrompt(st);
  if (p.kind === 'watch') return assert.equal(p.press, null);
  assert.ok(PRESS_KEYS.has(p.press), `unknown key ${p.press}`);
  if (['stuck', 'stranded', 'giveup'].includes(p.key)) {
    // the reset prompts: a proof of ruin, a hull that cannot be saved, or a long search with no hint
    assert.equal(p.press, 'Enter');
    assert.ok(
      /Enter|reset/i.test(p.en) && /回车|重置/.test(p.zh),
      `"${p.en}" does not name the reset`,
    );
    return;
  }
  const m = /^(open|close|pick):?([vg])(\d+)/.exec(p.key);
  assert.ok(m, `unexpected prompt key ${p.key}`);
  const [, verb, kind, index] = m;
  if (verb === 'pick' && kind === 'v') {
    const arrow = p.press === 'ArrowLeft' ? '←' : '→';
    assert.ok(p.en.includes(arrow) && p.zh.includes(arrow), `arrow disagrees with "${p.en}"`);
    assert.ok(['ArrowLeft', 'ArrowRight'].includes(p.press));
  } else if (verb === 'pick') {
    assert.equal(p.press, 'KeyX');
    assert.ok(/ X /.test(p.en) && p.zh.includes('X'), `"${p.en}" does not name X`);
  } else {
    assert.equal(p.press, 'Space');
    assert.ok(/^Space/.test(p.en) && p.zh.startsWith('空格'), `"${p.en}" does not name Space`);
  }
  const target = kind === 'v' ? st.valves[Number(index)] : st.gates[Number(index)];
  assert.ok(
    p.en.includes(target.label) && p.zh.includes(target.labelZh),
    `"${p.en}" misses ${target.label}`,
  );
  if (verb !== 'pick') {
    // the highlight is on the control the text names, and that control is selected
    assert.deepEqual(st.guide.control, { kind: kind === 'v' ? 'valve' : 'gate', i: Number(index) });
    assert.deepEqual(st.selected, { kind: kind === 'v' ? 'valve' : 'gate', index: Number(index) });
  } else if (st.guide.control) {
    assert.equal(labelOf(st, st.guide.control), target.label);
  }
}

test('quality: every prompt is held half a second unless the player acts, names its key, control and arrow, and agrees in both languages', () => {
  let changes = 0;
  let minHold = Infinity;
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVEL_COUNT; level++)
      for (const hz of lang === 'en' ? [30, 120] : [60]) {
        let last = null;
        let changedAt = 0;
        let pressedSince = false;
        const decide = follower(() => 0.25);
        const r = humanRun(level, hz, {
          seed: level,
          lang,
          before: (st, t) => {
            checkPrompt(st, lang);
            if (st.prompt.key !== last) {
              if (last !== null && !pressedSince) {
                minHold = Math.min(minHold, t - changedAt);
                assert.ok(
                  t - changedAt >= RULES.promptHold - 1 / hz - 1e-6,
                  `lock ${level}: "${last}" -> "${st.prompt.key}" after ${t - changedAt} s without a key`,
                );
              }
              if (last !== null) changes++;
              last = st.prompt.key;
              changedAt = t;
              pressedSince = false;
            }
            const keys = decide(st, t);
            if (keys.length) pressedSince = true;
            return keys;
          },
        });
        assert.ok(r.cleared, `lock ${level} @${hz} Hz ${lang}`);
      }
  assert.ok(changes > 400, `only ${changes} prompt changes observed`);
  assert.ok(minHold >= RULES.promptHold - 1 / 30 - 1e-6, `shortest unprompted hold ${minHold}`);
});

test('quality: the water mark sits on the level of the far side of the next gate and never on the sea', () => {
  let marks = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const decide = follower(() => 0.25);
    humanRun(level, 60, {
      seed: level,
      before: (st, t) => {
        const mark = st.guide.mark;
        if (mark) {
          marks++;
          const gate = st.gates[mark.gate];
          const other = mark.node === gate.a ? gate.b : gate.a;
          assert.ok(
            Math.abs(mark.level - st.nodes[other].level) < 0.5,
            `lock ${level}: mark off the far side`,
          );
          assert.ok(!st.nodes[mark.node].sea, 'the mark is on the sea');
        }
        return decide(st, t);
      },
    });
  }
  assert.ok(marks > 1000, `only ${marks} frames with a mark`);
});

// ---------------------------------------------------------------------------------------------
// Players that do not read the prompt
// ---------------------------------------------------------------------------------------------
const POLICY_KEYS = ['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'Space'];
const blind = (fn) => Object.assign(fn, { blind: true });
const POLICIES = {
  idle: { seeds: 1, make: () => blind(() => []) },
  mash: { seeds: 1, make: () => blind((st, t, f) => (f % 6 === 0 ? ['Space'] : [])) },
  every6: {
    seeds: 1,
    seconds: 30,
    make: () => {
      let next = 6;
      return blind((st, t) => (t >= next ? ((next += 6), ['Space']) : []));
    },
  },
  every10: {
    seeds: 1,
    seconds: 40,
    make: () => {
      let next = 10;
      return blind((st, t) => (t >= next ? ((next += 10), ['Space']) : []));
    },
  },
  sweep: {
    // X, Space, then each valve in turn, one press every 1.2 s
    seeds: 1,
    make: () => {
      const seq = [
        'KeyX',
        'Space',
        'ArrowLeft',
        'Space',
        'ArrowRight',
        'Space',
        'ArrowRight',
        'Space',
      ];
      let next = 0;
      let i = 0;
      return blind((st, t) => (t >= next ? ((next += 1.2), [seq[i++ % seq.length]]) : []));
    },
  },
  random: {
    seeds: 40,
    seconds: 40,
    make: (seed) => {
      const r = seeded(seed + 9);
      let next = 0.5;
      return blind((st, t) => {
        if (t < next) return [];
        next = t + 0.3 + r() * 1.2;
        return [POLICY_KEYS[Math.floor(r() * POLICY_KEYS.length)]];
      });
    },
  },
};

// "Open the valve toward the boat's next chamber until level, then open the gate": a sensible player
// who looks at the screen but ignores the prompt and never closes anything.
function smartPlayer() {
  let next = 0;
  return (st, t) => {
    if (t < next) return [];
    next = t + 0.35;
    const boat = st.boats.find((b) => !b.docked && !b.crossing);
    if (!boat) return [];
    const dir = Math.sign(boat.to - boat.node);
    const a = dir > 0 ? boat.node : boat.node - 1;
    const gate = st.gates.find((g) => g.a === a && g.b === a + 1);
    if (!gate) return [];
    const sel = st.selected;
    const goTo = (kind, i) => {
      if (sel.kind === kind && sel.index === i) return ['Space'];
      if (kind === 'gate') return ['KeyX'];
      if (sel.kind === 'gate') return [st.valves[i].a <= gate.a ? 'ArrowLeft' : 'ArrowRight'];
      return [i < sel.index ? 'ArrowLeft' : 'ArrowRight'];
    };
    const deep = st.nodes[a].depth >= boat.draught && st.nodes[a + 1].depth >= boat.draught;
    if (gate.level && deep) return gate.open ? [] : goTo('gate', gate.id);
    const direct = st.valves.find(
      (v) => (v.a === a && v.b === a + 1) || (v.a === a + 1 && v.b === a),
    );
    if (direct) return direct.open ? [] : goTo('valve', direct.id);
    const near = st.valves.find(
      (v) => !v.open && !v.pump && v.b >= 0 && [v.a, v.b].some((n) => n === a || n === a + 1),
    );
    return near ? goTo('valve', near.id) : [];
  };
}

function playPolicy(level, make, seed, { hz = 30, seconds = 120 } = {}) {
  const { g, h } = begin(level, seed, 'en', { hinted: false });
  const decide = make(seed, g);
  for (let f = 0; f < seconds * hz; f++) {
    // the screen is only looked at twice a second to see whether the lock is over
    if (f % (hz / 2) === 0) {
      const st = g.getState();
      if (st.phase !== 'playing' || st.level !== level) break;
    }
    const st = decide.blind ? null : g.getState();
    g.update(1 / hz, input([], decide(st, f / hz, f)));
  }
  const st = g.getState();
  assert.ok(h.ends.length <= 1);
  return WIN(st, level);
}

test('quality: from lock 3 on, idling, mashing, timed toggling, sweeping and random keys each clear at most a quarter of runs; idle never wins', () => {
  const table = [];
  for (const [name, { make, seeds, seconds }] of Object.entries(POLICIES)) {
    const wins = [];
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      let won = 0;
      for (let seed = 1; seed <= seeds; seed++)
        if (playPolicy(level, make, seed, { seconds })) won++;
      wins.push(`${level}:${won}`);
      if (level >= 3)
        assert.ok(won / seeds <= 0.25, `${name} clears lock ${level} in ${won}/${seeds} runs`);
      if (name === 'idle') assert.equal(won, 0, `idle won lock ${level}`);
    }
    table.push(`${name.padEnd(8)} (of ${seeds}) ${wins.join(' ')}`);
  }
  console.log(`crude policies, wins per lock:\n  ${table.join('\n  ')}`);
});

// Board-reading player for Tide Lock. It sees only getState() (the water, the valves, the gates, the
// boats and the goal line), `lag` seconds late, and presses public keys. It ignores prompt.press.
// It plays like a careful person who knows how locks work: serve the boat that is closest to ready,
// level its chamber against the far side of the gate from the lowest source above (or the highest
// sink below, so the water is saved), shut the valves, open the gate, and wait for the tide when a
// boat needs more water than the sea has.
function boardReader() {
  let lastSea = null;
  const NEAR = 0.22; // the gate opens within 0.3 m; stop a little before it

  return function decide(o) {
    if (o.phase !== 'playing' || o.pending || o.menu) return null;
    const pk = o.prompt?.key;
    if (o.stuck || pk === 'stuck' || pk === 'stranded' || pk === 'giveup') return 'Enter';
    const { nodes, valves, gates, boats } = o;
    const lvl = (i) => nodes[i].level;
    const dep = (i) => nodes[i].depth;
    const live = boats.filter((b) => !b.docked);
    const seaNode = nodes.find((n) => n.sea);
    const seaFalling = lastSea !== null && seaNode && seaNode.level < lastSea - 1e-9;
    lastSea = seaNode ? seaNode.level : null;
    if (!live.length || live.some((b) => b.crossing)) return null;

    const atNode = (n) => live.filter((b) => b.node === n).length;
    const minDepth = (n) => {
      let m = 0;
      for (const b of live) if (b.node === n || b.to === n) m = Math.max(m, b.draught + 0.05);
      return m;
    };

    // --- pick the boat to serve: the one whose gate needs the least change in the water
    const tasks = [];
    for (const b of live) {
      const dir = Math.sign(b.to - b.node);
      const a = dir > 0 ? b.node : b.node - 1;
      const gate = gates.find((g) => g.a === a && g.b === a + 1);
      if (!gate) continue;
      const n1 = b.node;
      const n2 = dir > 0 ? a + 1 : a;
      const full = atNode(n2) >= (nodes[n2].capacity ?? 9);
      // a boat already inside a one-boat chamber goes first: nobody else fits
      const cost = full
        ? Infinity
        : Math.abs(lvl(n1) - lvl(n2)) - (nodes[n1].capacity <= 1 ? 5 : 0);
      tasks.push({ b, gate, n1, n2, cost });
    }
    tasks.sort((p, q) => p.cost - q.cost || p.b.id - q.b.id);
    const task = tasks.find((t) => Number.isFinite(t.cost)) ?? tasks[0];
    if (!task) return null;
    const { b, gate, n1, n2 } = task;

    // --- the chamber whose level we change: one too shallow for the boat, else the smaller side
    const sides = [n1, n2].filter((n) => !nodes[n].sea);
    if (!sides.length) return null;
    const shallow = sides.find((n) => dep(n) < b.draught + 0.05);
    let m = sides[0];
    if (sides.length === 2) m = nodes[n1].area < nodes[n2].area ? n1 : n2;
    if (shallow !== undefined) m = shallow;
    const other = m === n1 ? n2 : n1;
    const need = nodes[m].floor + b.draught + 0.12;
    const T = shallow !== undefined ? Math.max(lvl(other), need) : lvl(other);
    const diff = T - lvl(m);
    const raise = diff > 0;

    // where would m settle if it were joined to o2?
    const settle = (o2) => {
      if (nodes[o2].sea) return lvl(o2);
      const am = nodes[m].area;
      const ao = nodes[o2].area;
      const vol = am * (lvl(m) - nodes[m].floor) + ao * (lvl(o2) - nodes[o2].floor);
      return (vol + am * nodes[m].floor + ao * nodes[o2].floor) / (am + ao);
    };
    const joins = (n) =>
      valves
        .filter((v) => !v.pump && v.b >= 0 && (v.a === n || v.b === n))
        .map((v) => ({ v, o2: v.a === n ? v.b : v.a }));

    // the valves that raise `n` from the lowest source above it; a source too poor to give the boat
    // its depth is fed in turn, and when none is above `n` the neighbours are asked to be fed
    const feedFor = (n, seen) => {
      const sources = joins(n).filter(
        ({ o2 }) =>
          !seen.has(o2) &&
          lvl(o2) > lvl(n) + 0.04 &&
          (nodes[o2].sea || dep(o2) > minDepth(o2) + 0.03),
      );
      sources.sort((p, q) => lvl(p.o2) - lvl(q.o2));
      const pick = sources.find(({ v }) => v.open) ?? sources[0];
      if (pick) {
        const out = [pick.v];
        if (!nodes[pick.o2].sea && settle(pick.o2) < need)
          out.push(...feedFor(pick.o2, new Set([...seen, n])));
        return out;
      }
      for (const { v, o2 } of joins(n)) {
        if (seen.has(o2) || nodes[o2].sea) continue;
        const sub = feedFor(o2, new Set([...seen, n]));
        if (sub.length) return [v, ...sub];
      }
      return [];
    };

    // --- which valves should be open to bring m to T
    let want = [];
    const holdUntil = shallow !== undefined ? need + 0.05 : T;
    if (Math.abs(diff) > NEAR || (shallow !== undefined && lvl(m) < holdUntil)) {
      if (raise) {
        want = feedFor(m, new Set());
        const first = want[0];
        if (first && !nodes[first.a === m ? first.b : first.a].sea) {
          const o2 = first.a === m ? first.b : first.a;
          if (dep(o2) <= minDepth(o2) + 0.02) want = [];
        }
      } else {
        const opts = joins(m).filter(({ o2 }) => lvl(o2) < lvl(m) - 0.04);
        const ok = opts.filter(({ o2 }) =>
          nodes[o2].sea
            ? dep(o2) >= minDepth(m) + (seaFalling ? 0.3 : 0)
            : lvl(o2) < nodes[o2].top - 0.3,
        );
        // lower into a chamber before the sea (it keeps the water); the valve is shut as soon as the
        // gate can open, so a sink below the target does no harm
        const pool = ok;
        pool.sort(
          (p, q) => Number(nodes[p.o2].sea) - Number(nodes[q.o2].sea) || lvl(q.o2) - lvl(p.o2),
        );
        const pick = pool.find(({ v }) => v.open) ?? pool[0];
        if (pick) {
          want = [pick.v];
          const o2 = pick.o2;
          if (!nodes[o2].sea && lvl(o2) >= nodes[o2].top - 0.2) want = [];
        }
      }
    } else {
      // near enough: keep a sea feed open to trap the tide while it is still rising
      const sea = joins(m).find(({ v, o2 }) => nodes[o2].sea && v.open && raise && diff > 0.04);
      if (sea) want = [sea.v];
    }
    // look ahead along the route: a chamber the boat must reach but that is still too shallow for it
    // is fed from the chamber being filled (so the tide, when it is high, fills both at once)
    if (want.length) {
      const dir = Math.sign(b.to - n1);
      const fed = new Set([m, ...want.map((v) => (v.a === m ? v.b : v.a))]);
      for (let q = n2 + dir; dir && q * dir <= b.to * dir; q += dir) {
        if (nodes[q].sea || lvl(q) >= nodes[q].floor + b.draught + 0.1) continue;
        const feed = joins(q).find(({ o2 }) => fed.has(o2) && lvl(o2) > lvl(q) + 0.04);
        if (feed) want.push(feed.v);
      }
    }
    const wantIds = new Set(want.map((v) => v.id));

    // --- toggles needed, in order of priority
    const gateOpenNow = gates.some((g) => g.open && g.progress > 0);
    const toggles = [];
    for (const v of valves)
      if (v.open && !wantIds.has(v.id)) toggles.push({ kind: 'valve', i: v.id, pri: 0 });
    for (const v of want)
      if (!v.open && !gateOpenNow) toggles.push({ kind: 'valve', i: v.id, pri: 1 });
    if (Math.abs(diff) <= NEAR && !gate.open) {
      const good = gate.level && dep(n1) >= b.draught + 0.03 && dep(n2) >= b.draught + 0.03;
      if (good) toggles.push({ kind: 'gate', i: gate.id, pri: 2 });
    }
    if (!toggles.length) return null;
    toggles.sort((p, q) => p.pri - q.pri);
    const target = toggles[0];
    const sel = o.selected;
    if (target.kind === 'gate') {
      if (sel.kind === 'gate') return sel.index === target.i ? 'Space' : 'KeyX';
      return 'KeyX';
    }
    if (sel.kind === 'valve') {
      if (sel.index === target.i) return 'Space';
      return target.i > sel.index ? 'ArrowRight' : 'ArrowLeft';
    }
    const v = valves[target.i];
    const centre = (v.b >= 0 ? v.a + v.b : v.a * 2) / 2;
    const gc = gates[sel.index].a + 0.5;
    return centre >= gc ? 'ArrowRight' : 'ArrowLeft';
  };
}

// Plays one lock like a person who reads the board: the reader sees the snapshot `lag` seconds late
// and may press a key only every lag + 0.1 s (plus a little jitter), so a stale view is never acted
// on twice. It reports how the lock went.
function boardRun(level, { lag, hz, seed }) {
  const { g } = begin(level, seed, 'en', { hinted: false });
  const rnd = seeded(seed * 31 + level);
  const decide = boardReader();
  const lagFrames = Math.round(lag * hz);
  const seen = [];
  let minMargin = Infinity;
  let presses = 0;
  let nextAt = 0;
  let st = g.getState();
  for (let f = 0; f < 300 * hz; f++) {
    st = g.getState();
    seen.push(st);
    if (seen.length > lagFrames + 1) seen.shift();
    if (st.phase !== 'playing' || st.level !== level) break;
    for (const b of st.boats)
      if (!b.docked && !b.crossing) minMargin = Math.min(minMargin, b.depth - b.draught);
    const t = f / hz;
    let keys = [];
    if (t >= nextAt) {
      const key = decide(seen[0]);
      if (key) {
        keys = [key];
        presses++;
        nextAt = t + lag + 0.1 + rnd() * 0.1;
      }
    }
    g.update(1 / hz, input([], keys));
  }
  st = g.getState();
  return {
    cleared: WIN(st, level),
    presses,
    minMargin,
    hulls: st.stats.hulls,
    resets: st.stats.resets,
  };
}

const TIERS = [
  ['teaching', 1, 7],
  ['combination', 8, 14],
  ['mastery', 15, 22],
];

test('quality: a player who reads the board (no prompt keys, 0.35 s lag) clears every lock in at least 75% of runs, and the mastery locks cost more', () => {
  const runs = [
    { lag: 0.35, hz: 60, seed: 1 },
    { lag: 0.35, hz: 60, seed: 2 },
    { lag: 0.35, hz: 30, seed: 3 },
    { lag: 0.25, hz: 60, seed: 4 },
  ];
  const table = [];
  const tier = Object.fromEntries(
    TIERS.map(([name]) => [name, { presses: [], margins: [], hulls: 0 }]),
  );
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const results = runs.map((r) => boardRun(level, r));
    const wins = results.filter((r) => r.cleared);
    table.push(`${level}:${wins.length}`);
    assert.ok(
      wins.length / runs.length >= 0.75,
      `lock ${level}: ${wins.length}/${runs.length} (${table.join(' ')})`,
    );
    const [name] = TIERS.find(([, lo, hi]) => level >= lo && level <= hi);
    for (const r of wins) {
      tier[name].presses.push(r.presses);
      tier[name].margins.push(r.minMargin);
      tier[name].hulls += r.hulls;
    }
  }
  const mean = (list) => list.reduce((a, v) => a + v, 0) / list.length;
  const line = TIERS.map(
    ([name]) =>
      `${name}: ${mean(tier[name].presses).toFixed(1)} presses, margin ${mean(tier[name].margins).toFixed(2)} m, ${tier[name].hulls} hulls`,
  ).join('; ');
  console.log(`board reader per lock wins: ${table.join(' ')}\n  ${line}`);
  const { teaching, mastery } = tier;
  assert.ok(mean(mastery.presses) > 2 * mean(teaching.presses), line);
  assert.ok(mean(mastery.margins) < mean(teaching.margins), line);
});

// A second, stronger screen reader (it closes valves that are not serving, raises shallow chambers
// from any higher valve or the pump, and rotates boats): it plays one lock for `limit` seconds.
function readerWins(level, limit = 50, supplierFirst = false) {
  const { g } = begin(level, 1, 'en', { hinted: false });
  let t = 0;
  const done = () => {
    const st = g.getState();
    return st.phase !== 'playing' || st.level !== level;
  };
  const adv = (keys) => {
    if (done() || t >= limit) return false;
    g.update(1 / 60, input([], keys));
    t += 1 / 60;
    return true;
  };
  const press = (k) => adv([k]) && adv([]);
  const wait = (sec) => {
    for (let i = 0; i < Math.round(sec * 60); i++) if (!adv([])) return false;
    return true;
  };
  const select = (kind, idx) => {
    for (let n = 0; n < 40; n++) {
      const sel = g.getState().selected;
      if (sel.kind === kind && sel.index === idx) return true;
      if (kind === 'gate') press('KeyX');
      else press(sel.kind === 'valve' && idx < sel.index ? 'ArrowLeft' : 'ArrowRight');
    }
    return false;
  };
  const toggle = (kind, idx) => select(kind, idx) && press('Space');
  while (!done() && t < limit) {
    if (!wait(0.3)) break;
    const st = g.getState();
    const todo = st.boats.filter((b) => !b.docked);
    if (!todo.length) continue;
    const order = todo.slice();
    order.push(...order.splice(0, Math.floor(t / 60) % order.length));
    const occ = (n, self) =>
      st.boats.filter((b, k) => k !== self && !b.crossing && b.node === n).length;
    let pick = null;
    for (const b of order) {
      if (b.crossing) continue;
      const nxt = b.node + Math.sign(b.to - b.node);
      if (occ(nxt, b.id) >= st.nodes[nxt].capacity) continue;
      const gate = st.gates.find((q) => Math.min(q.a, q.b) === Math.min(b.node, nxt));
      pick = { b, a: b.node, nxt, gate };
      break;
    }
    const closeAll = () =>
      st.valves.forEach((v) => g.getState().valves[v.id].open && toggle('valve', v.id));
    if (!pick) {
      if (!st.boats.some((b) => b.crossing)) closeAll();
      continue;
    }
    const { b, a, nxt, gate } = pick;
    const d = b.draught + 0.03;
    if (gate.open) continue;
    const na = st.nodes[a];
    const nb = st.nodes[nxt];
    if (na.depth >= d && nb.depth >= d && Math.abs(na.level - nb.level) <= 0.27) {
      closeAll();
      toggle('gate', gate.id);
      wait(1);
      continue;
    }
    const raise = na.depth < d ? a : nb.depth < d ? nxt : -2;
    const hi = na.level > nb.level ? a : nxt;
    const lo = hi === a ? nxt : a;
    const cands = [];
    st.valves.forEach((v, k) => {
      if (v.pump) {
        if (raise >= 0 && v.b === raise && st.energy > 0 && !v.open) cands.push({ k, score: 3 });
        return;
      }
      const src = v.head > 0.03 ? v.a : v.head < -0.03 ? v.b : null;
      if (src === null) return;
      const dst = src === v.a ? v.b : v.a;
      let score = 0;
      if (raise >= 0) {
        if (dst === raise) score = 2 + (src === (raise === a ? nxt : a) ? 1 : 0);
      } else if (src === hi && dst === lo) score = 4;
      else if (src === hi && dst !== -1) score = 1.5;
      else if (dst === lo) score = 1.4;
      else if (src === hi) score = 1;
      if (score > 0) cands.push({ k, score: score + 0.1 * v.area });
    });
    if (supplierFirst && raise >= 0 && !cands.length) {
      // "if the target is too shallow, raise its supplier first", down any chain of neighbours
      const lvl = (n) => st.nodes[n].level;
      const supply = (node, seen) => {
        if (seen.has(node)) return null;
        seen.add(node);
        for (const v of st.valves) {
          if (v.pump) {
            if (v.b === node && st.energy > 0) return v.id;
            continue;
          }
          const other = v.a === node ? v.b : v.b === node ? v.a : null;
          if (other !== null && other >= 0 && lvl(other) > lvl(node) + 0.03) return v.id;
        }
        for (const v of st.valves) {
          const other = v.pump ? null : v.a === node ? v.b : v.b === node ? v.a : null;
          if (other === null || other < 0) continue;
          const r = supply(other, seen);
          if (r !== null) return r;
        }
        return null;
      };
      const k = supply(raise, new Set());
      if (k !== null) cands.push({ k, score: 2 });
    }
    cands.sort((x, y) => y.score - x.score);
    const open = st.valves.filter((v) => v.open);
    if (open.some((v) => cands.some((c) => c.k === v.id))) continue;
    open.filter((v) => !cands.some((c) => c.k === v.id)).forEach((v) => toggle('valve', v.id));
    if (cands[0] && !g.getState().valves[cands[0].k].open) toggle('valve', cands[0].k);
  }
  const st = g.getState();
  return WIN(st, level);
}

test('quality: the screen-reading players who ignore the prompt win at most half the locks and none of the last third', () => {
  const simple = [];
  for (let level = 1; level <= LEVEL_COUNT; level++)
    if (playPolicy(level, () => smartPlayer(), 1, { seconds: 60 })) simple.push(level);
  // The strong readers (and the supplier-first one) are played on locks 11 to 22: the first ten
  // locks are the most they can ever win, which is under half of 22, so none may win from lock 11 on.
  const strong = [];
  const supplier = [];
  for (let level = 11; level <= LEVEL_COUNT; level++) {
    // each lock meets one of the two readers here; the reviewer's depth script plays both on all
    if (level % 2 === 0 ? readerWins(level, 30) : readerWins(level, 30, true))
      (level % 2 === 0 ? strong : supplier).push(level);
  }
  console.log(
    `simple reader wins locks: ${simple.join(' ')}\nstrong reader wins locks from 11: ${strong.join(' ') || 'none'}\nsupplier-first reader wins locks from 11: ${supplier.join(' ') || 'none'}`,
  );
  assert.ok(simple.length <= LEVEL_COUNT / 2, `wins ${simple.length} locks`);
  assert.deepEqual(
    simple.filter((l) => l >= LAST_THIRD),
    [],
  );
  assert.ok(10 <= LEVEL_COUNT / 2);
  assert.deepEqual(strong, []);
  assert.deepEqual(supplier, []);
});

// The player opens a handful of valves, then reads the prompt again: the prompt must find its way
// back, resetting the lock when the water is gone, and never stay on a stale line.
test('quality: after opening every valve at a random moment the prompt recovers on every lock', () => {
  const failures = [];
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const seed of [2]) {
      const rnd = seeded(seed * 977 + level);
      const sab = 1 + rnd() * 8;
      const script = [];
      for (let i = 0; i < 8; i++) script.push('ArrowLeft');
      for (let i = 0; i < 8; i++) script.push('Space', 'ArrowRight');
      const decide = follower(() => 0.25);
      let lastPress = -9;
      const r = humanRun(level, 60, {
        seed,
        seconds: 300,
        before: (st, t) => {
          if (t >= sab && script.length) {
            if (t - lastPress < 0.15) return [];
            lastPress = t;
            return [script.shift()];
          }
          return decide(st, t);
        },
      });
      if (!r.cleared)
        failures.push(`lock ${level} seed ${seed}: ${r.st.phase} "${r.st.prompt.en}"`);
    }
  assert.deepEqual(failures, []);
});

// A player who dawdles: nothing is touched for a while (a tide moves on, a plan would go stale),
// then the prompt is followed. Every lock must still be cleared, with no wasted-water message
// that is not true. (Lock 11 has a tide clock: a boat left at sea for a minute is stranded.)
test('quality: after idling 7 to 60 s at the start, following the prompt still clears every lock', () => {
  const failures = [];
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const idle of [7, 25, 60]) {
      if (level === 11 && idle > 40) continue;
      const decide = follower(() => 0.25);
      let stuckSeen = false;
      const r = humanRun(level, 60, {
        seed: level,
        seconds: 400,
        before: (st, t) => {
          if (t < idle) {
            stuckSeen = stuckSeen || st.stuck;
            return [];
          }
          return decide(st, t);
        },
      });
      if (!r.cleared)
        failures.push(`lock ${level} idle ${idle}: ${r.st.phase} "${r.st.prompt.en}"`);
      assert.equal(stuckSeen, false, `lock ${level}: idling was called hopeless`);
    }
  assert.deepEqual(failures, []);
});

test('quality: a fresh lock is never called hopeless while it sits untouched, and a plan that stands still is replaced', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const { g } = begin(level, 1);
    let stuck = false;
    for (let f = 0; f < 60 * 45; f++) {
      g.update(1 / 60, input());
      if (f % 60 === 0) stuck = stuck || g.getState().stuck;
      if (g.getState().phase !== 'playing') break;
    }
    assert.equal(stuck, false, `lock ${level} was called hopeless untouched`);
  }
});

// Bursts of stray keys on the busy locks, then the prompt is read at lag 0, 0.25 and 0.5 s:
// whatever state the burst leaves, the prompt must lead to a cleared lock (or ask for a reset).
test('quality: after a burst of stray keys on locks 12 to 18 the prompt never loops', () => {
  const failures = [];
  for (let level = 12; level <= 18; level++)
    for (const lag of [0, 0.5])
      for (let seed = 1; seed <= 2; seed++) {
        const rnd = seeded(seed * 977 + level);
        const t0 = 1 + rnd() * 25;
        const burst = Array.from(
          { length: 3 + Math.floor(rnd() * 6) },
          () => KEYS[Math.floor(rnd() * 4)],
        );
        const decide = follower(() => lag);
        let sent = 0;
        let nextAt = t0;
        const r = humanRun(level, 60, {
          seed,
          seconds: 300,
          before: (st, t) => {
            if (t >= t0 && sent < burst.length) {
              if (t < nextAt) return [];
              nextAt = t + 0.15;
              return [burst[sent++]];
            }
            return decide(st, t);
          },
        });
        if (!r.cleared) failures.push(`lock ${level} lag ${lag} seed ${seed}: ${r.st.phase}`);
      }
  assert.deepEqual(failures, []);
});

test('quality: the early locks teach, the middle locks add one idea each, and no lock is a copy of another', () => {
  const names = new Set(LEVELS.map((l) => l.name[0]));
  assert.equal(names.size, LEVEL_COUNT);
  assert.ok(LEVELS[0].par < LEVELS[LEVEL_COUNT - 1].par);
  assert.ok(LEVELS.slice(0, 2).every((l) => l.valves.length === 1 && l.gates.length === 1));
  assert.ok(LEVELS.some((l) => l.tidal));
  assert.ok(LEVELS.some((l) => l.energy > 0));
  assert.ok(LEVELS.some((l) => l.boats.length >= 3));
  assert.ok(LEVELS.some((l) => l.boats.some((b) => b.d >= 1.7)));
  assert.ok(LEVELS.some((l) => l.nodes.some((n) => n.top < 5.4)));
  assert.ok(
    LEVELS.some((l) => l.boats.some((b) => b.to < b.from) && l.boats.some((b) => b.to > b.from)),
  );
});

// ---------------------------------------------------------------------------------------------
// Determinism and robustness
// ---------------------------------------------------------------------------------------------
test('quality: the same key schedule gives the identical state at 30, 60 and 120 Hz on every lock', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const run = (hz) => {
      const { g } = begin(level, 4);
      const rnd = seeded(level * 17);
      const marks = [];
      for (let slot = 0; slot < 240; slot++) {
        const pick = Math.floor(rnd() * 9);
        const key = pick < KEYS.length - 1 ? [KEYS[pick]] : [];
        for (let i = 0; i < hz / 6; i++) g.update(1 / hz, input([], i === 0 ? key : []));
        if (slot % 60 === 59) marks.push(g.getState());
      }
      return marks;
    };
    const a = run(30);
    assert.deepEqual(run(60), a, `lock ${level} @60`);
    assert.deepEqual(run(120), a, `lock ${level} @120`);
  }
});

test('quality: jittered frame times (down to half a frame) still give a stable, finite and bounded game', () => {
  for (const level of [2, 6, 11, 16, 20, 22]) {
    const { g } = begin(level, 2);
    const rnd = seeded(level);
    const decide = follower(() => 0.2);
    let t = 0;
    for (let i = 0; i < 5000; i++) {
      const st = g.getState();
      if (st.phase !== 'playing') break;
      const dt = (0.5 + rnd() * 1.5) / 60;
      t += dt;
      g.update(dt, input([], decide(st, t)));
      for (const n of st.nodes) {
        assert.ok(Number.isFinite(n.level) && Number.isFinite(n.depth));
        assert.ok(n.sea || (n.volume >= -1e-9 && n.level <= n.top + 1e-9));
      }
      assert.ok(Math.abs(st.volume.error) < 1e-9);
      assert.ok(st.boats.every((b) => Number.isFinite(b.x)));
    }
  }
});

test('quality: HUD, status and counters always match the real state', () => {
  for (const level of [1, 5, 9, 13, 18, 22]) {
    humanRun(level, 60, {
      seed: level,
      before: (st, t) => {
        assert.ok(st.lives >= 0 && st.lives <= RULES.lives);
        assert.ok(st.docked >= 0 && st.docked <= st.boats.length);
        assert.equal(st.docked, st.boats.filter((b) => b.docked).length);
        assert.ok(st.score >= 0 && Number.isFinite(st.score));
        assert.ok(st.time >= 0 && Number.isFinite(st.time));
        if (/cleared/i.test(st.line.en)) assert.equal(st.pending, true);
        if (st.pending) assert.equal(st.docked, st.boats.length);
        return follower(() => 0.25)(st, t);
      },
    });
  }
});
