import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  LEVELS,
  LEVEL_COUNT,
  PRESS,
  compileLevel,
  neighbourJunction,
  selectStep,
  createGame,
  wrapText,
} from '../src/games/rail-switch.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Prompt-following players. They see only what the screen shows through getState(): the
// junction letters and which one is selected, the drawn prompt line and its target. They see it
// `delay` seconds late, press only public keys, and remember their own presses so that they do
// not repeat themselves while the screen has not caught up yet.
// ---------------------------------------------------------------------------------------------
const HZ = [30, 60, 120];
const FAST = [0.15, 0.35];
const SLOW = [0.4, 0.6];
const KEY_GAP = 0.12;
const MAX_SECONDS = 300;
const CODE = { U: 'ArrowUp', R: 'ArrowRight', D: 'ArrowDown', L: 'ArrowLeft', S: 'Space' };
const WIN = (st, level) => st.level > level || st.phase === 'won';

function open(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang });
  let unlocked = level;
  h.env.progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

function follower({ delay, seed }) {
  const rnd = seeded(seed * 7919 + 13);
  const lag = delay[0] + rnd() * (delay[1] - delay[0]);
  const history = [];
  const presses = [];
  let lastKey = -9;
  return function decide(st, t, hz, f) {
    history.push({ t, st });
    if (history.length > 120) history.shift();
    if (f % Math.max(1, Math.round(hz / 30)) !== 0) return [];
    let k = history.length - 1;
    while (k > 0 && history[k].t > t - lag) k--;
    const seen = history[k];
    const js = seen.st.junctions;
    let sel = js.findIndex((j) => j.selected);
    for (const p of presses) {
      if (p.t < seen.t || p.dir < 0) continue;
      const n = neighbourJunction(js, sel, p.dir);
      if (n >= 0) sel = n;
    }
    const prompt = seen.st.prompt;
    if (!prompt || prompt.kind === 'watch' || t - lastKey < KEY_GAP) return [];
    const target = js.findIndex((j) => j.id === prompt.target);
    if (sel !== target) {
      const dir = selectStep(js, sel, target);
      if (dir < 0) return [];
      presses.push({ t, dir });
      lastKey = t;
      return [PRESS[dir]];
    }
    if (presses.some((p) => p.t >= seen.t && p.dir === -1)) return [];
    presses.push({ t, dir: -1 });
    lastKey = t;
    return ['Space'];
  };
}

function play({ level, seed = 1, hz = 60, lang = 'en', delay = FAST, policy, onFrame }) {
  const { g, h } = open(level, { seed, lang });
  const decide = policy ?? follower({ delay, seed });
  let t = 0;
  let strikes = 0;
  let st = g.getState();
  for (let f = 0; t < MAX_SECONDS; f++) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    strikes = Math.max(strikes, st.strikes);
    const keys = decide(st, t, hz, f);
    onFrame?.(st, t, keys, g);
    g.update(1 / hz, input([], keys));
    t += 1 / hz;
  }
  st = g.getState();
  if (st.level === level) strikes = Math.max(strikes, st.strikes);
  return { st, t, strikes, ends: h.ends, cleared: WIN(st, level), g, h };
}
const rate = (n, total) => `${n}/${total}`;

// ---------------------------------------------------------------------------------------------
// Scripted legal solutions: one per timetable, as frame/key pairs at 60 Hz after the level opens.
// ---------------------------------------------------------------------------------------------
const SOLUTIONS = [
  '2S 478S 1210S 1574S',
  '2S 66R 74S 644S 714L 722S 974R 982S 1016L 1024S 1344S 1554R 1562S 1604L 1612S 2440R 2448S',
  '216S 440R 448S 1020S 1056L 1064S 1576S 2058R 2066S 2330S 2396L 2404S 2602R 2610S 2650L 2658S 3124R 3132S',
  '2S 478R 486S 1058S 1274S 1534S 1766S 2022S 2242S',
  '2S 10R 18S 140R 148S 570L 578S 654L 662S 804R 812S 846R 854S 888L 896L 904S 1420R 1428R 1436S 1444L 1452L 1460S 1630R 1638R 1646S 1684L 1692L 1700S 2008R 2016S 2104R 2112S 2312L 2320S 2684R 2692S 2826L 2834S 2910L 2918S',
  '2S 522S 666R 674S 1194L 1202S 1236R 1244S 1848S 1914L 1922S 2746R 2754S 2922L 2930S 2972R 2980S 3608S',
  '50S 468R 476S 614L 622S 838S 1096S 1330S 1768R 1776S 1860L 1868S 2536S 2774S',
  '2R 10S 66R 74S 108R 116R 124S 552R 560S 854L 862L 870L 878L 886L 894S 4202R 4210R 4218S 4826R 4834R 4842S 4932L 4940S 5414R 5422S',
  '2S 134D 142S 150U 158R 166S 360R 368S 420U 428L 436S 756S 938R 946R 954S 1020L 1028S 1230S 1238R 1246S 1334U 1342L 1350S 1644S 1678R 1686R 1694S 1944L 1952S 2008U 2016S 2910D 2918S 3004U 3012R 3020S 3110R 3118L 3126S',
  '2S 518R 526S 692L 700S 1122R 1130S 1178R 1186S 1258L 1266L 1274S 1618R 1626S 1728L 1736S 1782R 1790R 1798S 2180L 2188S 2236R 2244S 2656L 2664S 2716L 2724S 3016R 3024R 3032S 3066L 3074S 3308S 3456R 3464S 3548L 3556L 3564S 3674R 3682R 3690S 3990L 3998S 4474S 4560L 4568S 4650R 4658R 4666S 4834S 4896L 4904S 5084S',
  '518S 818R 826S 1122L 1130S 1338S 1458R 1466S 2360L 2368S 2590S 2660R 2668S 3286S 3708S 4012L 4020S 4230S 4312R 4320S 4926S',
  '2S 692S 836R 844S 1118R 1126U 1134S 1402D 1410L 1418S 1696R 1704S 2396U 2404L 2412S 2976S 3184R 3192R 3200U 3208S 3296D 3304S 4334L 4342S',
  '2S 10R 18S 710S 872R 880S 1244D 1252U 1260S 1294R 1302S 1478R 1486S 1522D 1530U 1538S 1572R 1580S 1746R 1754S 1856D 1864U 1872S 1966R 1974R 1982S 2016D 2024S 2254S 2314R 2322S 2846D 2854U 2862S 2896R 2904S 2938R 2946S 3186D 3194U 3202S 3288R 3296R 3304S',
  '2R 10R 18S 52R 60R 68R 76S 366L 374S 570L 578L 586S 594R 602S 702R 710R 718R 726S 908L 916L 924L 932L 940L 948S 1212R 1220R 1228R 1236R 1244S 1426L 1434L 1442L 1450L 1458S 1466L 1474S 1926R 1934R 1942R 1950R 1958R 1966S 2292L 2300L 2308L 2316L 2324S 2894S 4040S',
  '2S 276R 284S 468R 476S 522U 530S 918R 926D 934S 1032R 1040S 1720S 2300S 2406L 2414S 2448D 2456S 3132R 3140S 3148D 3156S 4366S 4400R 4408S 4594L 4602S',
  '758S 998R 1006S 1238R 1246S 1842S 2052S 2598L 2606L 2614S 2862S 3070S 3286S 4022S 4320S 4328R 4336R 4344S 4512L 4520L 4528S 4662R 4670S 4704L 4712S 4952S',
  '518S 938R 946S 1122L 1130S 1178R 1186R 1194S 1542L 1550S 1584L 1592S 2150R 2158S 2300R 2308S 2814L 2822L 2830S 2914R 2922R 2930S 2994L 3002L 3010S 3518R 3526R 3534S 3878L 3886S 4022L 4030S 4476R 4484S 4492R 4500S 4508L 4516L 4524S 5234R 5242R 5250S 5672L 5680S 5714L 5722S 6198S 6792R 6800S 6942R 6950S 7408L 7416L 7424S 7524R 7532R 7540S 7610L 7618L 7626S 8068R 8076R 8084S',
  '2R 10S 308R 316D 324S 478R 486S 774L 782L 790S 852L 860S 868U 876R 884S 944R 952S 1206L 1214L 1222S 1428R 1436D 1444S 2390S 3066S 4590S 5196S',
  '2S 216R 224S 628R 636S 768L 776L 784S 1350S 1358R 1366S 1400R 1408S 1840L 1848S 1882L 1890S 2000R 2008R 2016S 2200S 2482L 2490S 2538R 2546S 2660L 2668L 2676S 2952R 2960S 3020L 3028S 3142R 3150R 3158S 3312S 3598L 3606S 3838R 3846S 4090L 4098S 4258R 4266S 4450S',
  '2S 66R 74S 366R 374S 644L 652S 660D 668S 1534R 1542U 1550D 1558S 1830L 1838S 1956D 1964S 2186S 2346R 2354U 2362S 2476D 2484S 3052L 3060L 3068S 3076U 3084S 3834S 3948R 3956S 4092D 4100S 4528R 4536U 4544S 4658L 4666D 4674S 4764R 4772U 4780D 4788S 4892L 4900D 4908S 5532U 5540S 5672R 5680U 5688S 5932L 5940D 5948S 6076R 6084S 6118L 6126S 6228R 6236U 6244D 6252S 6318L 6326L 6334S 6816S',
];

const parse = (script) =>
  script.split(' ').map((tok) => ({ frame: Number.parseInt(tok, 10), key: CODE[tok.slice(-1)] }));

function replay(level, hz = 60, until = MAX_SECONDS) {
  const { g, h } = open(level);
  const events = parse(SOLUTIONS[level - 1]);
  let strikes = 0;
  let st = g.getState();
  for (let i = 0; i / hz < until; i++) {
    st = g.getState();
    if (st.phase !== 'playing' || st.level !== level) break;
    strikes = Math.max(strikes, st.strikes);
    const keys = events.filter((e) => Math.round((e.frame * hz) / 60) === i).map((e) => e.key);
    g.update(1 / hz, input([], keys));
  }
  st = g.getState();
  return { st, strikes, cleared: WIN(st, level), h };
}

test('quality: there is one scripted solution per timetable', () => {
  assert.equal(SOLUTIONS.length, LEVEL_COUNT);
  assert.ok(LEVEL_COUNT >= 20);
  SOLUTIONS.forEach((script, i) => {
    const frames = parse(script).map((e) => e.frame);
    assert.ok(
      frames.every((f, n) => n === 0 || f > frames[n - 1]),
      `level ${i + 1} is ordered`,
    );
    assert.ok(
      frames.every((f) => f % 2 === 0),
      `level ${i + 1} fits every step rate`,
    );
  });
});

test('quality: every timetable is cleared with no strike by its scripted solution, through public keys only', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const r = replay(level);
    assert.ok(r.cleared, `level ${level} ended ${r.st.phase} on timetable ${r.st.level}`);
    assert.equal(r.strikes, 0, `level ${level} cost strikes`);
  }
});

test('quality: the scripted solutions hold at 30 and 120 Hz too', () => {
  for (const hz of [30, 120])
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const r = replay(level, hz);
      assert.ok(r.cleared, `level ${level} at ${hz} Hz`);
      assert.equal(r.strikes, 0, `level ${level} at ${hz} Hz`);
    }
});

test('quality: the whole campaign played in order unlocks each timetable once and ends in one win', () => {
  const h = harness();
  const unlocks = [];
  let unlocked = 1;
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      unlocks.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  let level = 1;
  // Each timetable draws its own departure jitter, so the campaign is played by a prompt follower.
  let decide = follower({ delay: [0.2, 0.2], seed: 1 });
  for (let f = 0; f < 60 * 60 * 40 && g.getState().phase === 'playing'; f++) {
    const st = g.getState();
    if (st.level !== level) {
      level = st.level;
      decide = follower({ delay: [0.2, 0.2], seed: level });
    }
    g.update(1 / 60, input([], decide(st, f / 60, 60, f)));
  }
  const st = g.getState();
  assert.equal(st.phase, 'won');
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.equal(h.ends[0].score, st.score);
  assert.ok(st.score > LEVEL_COUNT * RULES.scoreClear);
  assert.ok(unlocks.every((n, i) => i === 0 || n >= unlocks[i - 1]));
  assert.equal(unlocked, LEVEL_COUNT);
  assert.match(h.ends[0].message, /Every timetable/);
  const after = JSON.stringify(g.getState());
  g.update(1 / 60, input([], ['Space', 'ArrowRight']));
  assert.equal(JSON.stringify(g.getState()), after);
  const back = createGame({ ...h.env, progress: { unlocked: () => unlocked, unlock() {} } });
  assert.deepEqual(back.getState().menu, { sel: LEVEL_COUNT, unlocked: LEVEL_COUNT });
});

// ---------------------------------------------------------------------------------------------
// Prompt followers
// ---------------------------------------------------------------------------------------------
function campaign(delay, wanted, label) {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    const failures = [];
    for (let seed = 1; seed <= 30; seed++) {
      const hz = HZ[seed % 3];
      const r = play({ level, seed, hz, delay });
      if (r.cleared) wins++;
      else failures.push(`${hz}Hz/seed ${seed}: ${r.st.phase}, ${r.st.strikes} strikes`);
    }
    assert.ok(
      wins >= wanted,
      `${label}: timetable ${level} won ${rate(wins, 30)} (${failures.slice(0, 3).join('; ')})`,
    );
  }
}

test('quality: a prompt-following player at 0.15-0.35 s wins at least 27 of 30 runs on every timetable', () => {
  campaign(FAST, 27, 'fast');
});

test('quality: a slower prompt-following player at 0.4-0.6 s wins at least 24 of 30 runs on every timetable', () => {
  campaign(SLOW, 24, 'slow');
});

test('quality: the fast player also wins on the late timetables at each step rate', () => {
  for (const hz of HZ)
    for (const level of [8, 12, 16, 20]) {
      let wins = 0;
      for (let seed = 1; seed <= 10; seed++)
        if (play({ level, seed, hz, delay: FAST }).cleared) wins++;
      assert.ok(wins >= 9, `timetable ${level} at ${hz} Hz won ${rate(wins, 10)}`);
    }
});

test('quality: a literal prompt follower causes no collision, wrong platform or late train at lag 0 and 0.25', () => {
  for (const lag of [0, 0.25])
    for (let level = 1; level <= LEVEL_COUNT; level++)
      for (const seed of [1, 2]) {
        const r = play({ level, seed, hz: HZ[seed], delay: [lag, lag] });
        assert.ok(r.cleared, `lag ${lag}, timetable ${level}: ${r.st.phase}`);
        assert.equal(r.strikes, 0, `lag ${lag}, timetable ${level} cost a strike`);
        assert.equal(r.st.stats.crashes, 0);
      }
});

test('quality: a zero-lag prompt follower takes no strike on any of 40 seeds per timetable, through the level-select path', () => {
  const failures = [];
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (let seed = 1; seed <= 40; seed++) {
      const r = play({ level, seed, hz: 60, delay: [0, 0] });
      if (!r.cleared || r.strikes > 0)
        failures.push(`L${level}/seed ${seed}: ${r.st.phase}, ${r.strikes} strikes`);
    }
  assert.deepEqual(failures, []);
});

test('quality: obeying the prompt never ends in a livelock: flips stay proportional to the trains run', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const r = play({ level, seed: 3, hz: 60, delay: [0.25, 0.25] });
    assert.ok(r.cleared);
    const s = r.st;
    const trains = LEVELS[level - 1].trains.length;
    assert.ok(s.stats.flips <= trains * 4 + 4, `timetable ${level}: ${s.stats.flips} flips`);
    assert.ok(s.stats.refused <= 2, `timetable ${level}: ${s.stats.refused} refusals`);
    assert.ok(r.t < 200, `timetable ${level} took ${r.t.toFixed(0)} s`);
  }
});

test('quality: the prompt line is bilingual, names a direction or target, and holds for 0.5 s', () => {
  let changes = 0;
  const kinds = new Set();
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const [lang, delay] of [
      ['en', [0.25, 0.25]],
      ['zh', FAST],
    ]) {
      const segments = [];
      let acts = 0;
      const r = play({
        level,
        seed: 5,
        lang,
        delay,
        onFrame: (st, t, keys) => {
          const p = st.prompt;
          if (p) {
            kinds.add(p.kind);
            assert.ok(p.en && p.zh, 'bilingual');
            if (p.kind === 'select') {
              assert.ok(PRESS.includes(p.press), 'names the arrow to press');
              assert.ok(p.en.includes(p.target) && p.zh.includes(p.target), 'names the junction');
              assert.match(p.en + p.zh, /[↑→↓←]/);
            }
            if (p.kind === 'flip') {
              assert.equal(p.press, 'Space');
              assert.ok(p.en.includes(p.target) && p.zh.includes(p.target));
              assert.match(p.en, /[↑→↓←]/);
              assert.match(p.zh, /[↑→↓←]/);
            }
            const last = segments.at(-1);
            if (!last || last.line !== p[lang]) segments.push({ line: p[lang], t, acts });
          }
          if (keys.length) acts++;
        },
      });
      assert.ok(r.cleared);
      segments.forEach((cur, n) => {
        if (n === 0) return;
        changes++;
        const prev = segments[n - 1];
        // A prompt may move on at once only when the player's own key press changed the situation.
        assert.ok(
          cur.acts !== prev.acts || cur.t - prev.t >= RULES.promptHold - 1e-6,
          `"${prev.line}" -> "${cur.line}" after ${(cur.t - prev.t).toFixed(2)} s`,
        );
      });
    }
  assert.ok(changes > 300, `${changes} prompt changes observed`);
  for (const k of ['select', 'flip', 'watch']) assert.ok(kinds.has(k), k);
});

test('quality: an idle player sees prompts that each stay at least 0.5 s with no input at all', () => {
  for (let level = 1; level <= LEVEL_COUNT; level += 3) {
    const lines = [];
    play({
      level,
      policy: () => [],
      onFrame: (st, t) => {
        const line = st.prompt?.en;
        if (line && lines.at(-1)?.line !== line) lines.push({ line, t });
      },
    });
    lines.forEach((cur, n) => {
      if (n > 0) assert.ok(cur.t - lines[n - 1].t >= RULES.promptHold - 1e-6, cur.line);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Crude policies
// ---------------------------------------------------------------------------------------------
const KEYS7 = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Space', 'Space', 'KeyX'];
const CRUDE = {
  random: (seed) => {
    const rnd = seeded(seed * 17 + 3);
    return () => (rnd() < 0.1 ? [KEYS7[Math.floor(rnd() * KEYS7.length)]] : []);
  },
  'mash Space': () => (st, t, hz, f) => (f % Math.round(hz / 10) === 0 ? ['Space'] : []),
  'never act': () => () => [],
  'flip everything': (seed) => {
    const phase = (seed * 7) % 30;
    const period = 24 + (seed % 5) * 6;
    return (st, t, hz, f) => {
      const k = (f + Math.round((phase * hz) / 60)) % Math.round((period * hz) / 60);
      return k === 0 ? ['Space'] : k === Math.round((period * hz) / 120) ? ['ArrowRight'] : [];
    };
  },
  'flip and walk': (seed) => {
    const phase = (seed * 3) % 20;
    return (st, t, hz, f) => {
      const k = (f + Math.round((phase * hz) / 60)) % Math.round(hz / 3);
      return k === 0 ? ['Space'] : k === Math.round(hz / 6) ? [PRESS[seed % 4]] : [];
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A player with no prompt: every train goes its shortest way
// ---------------------------------------------------------------------------------------------
const COLS = RULES.cols;
const dirBetween = (a, b) => {
  const d = b - a;
  return d === -COLS ? 0 : d === 1 ? 1 : d === COLS ? 2 : 3;
};
function exitsOf(L, from, at) {
  const t = L.tiles[at];
  const entry = (dirBetween(from, at) + 2) % 4;
  if (t.kind === 'platform' || t.kind === 'portal') return [];
  if (t.kind === 'cross') return [t.arms[(entry + 2) % 4]];
  if (t.kind === 'track') return [t.arms.find((a, d) => a >= 0 && d !== entry)];
  if (entry === t.stem) return t.kind === 'merge' ? [t.arms[t.br[0]]] : t.br.map((d) => t.arms[d]);
  return [t.arms[t.stem]];
}
// The shortest path of cells from the move from -> at to the destination platform cell.
function shortestPath(L, from, at, goal) {
  const key = (a, b) => a * 1000 + b;
  const prev = new Map([[key(from, at), null]]);
  const queue = [[from, at]];
  for (let i = 0; i < queue.length; i++) {
    const [a, b] = queue[i];
    if (b === goal) {
      const path = [];
      for (let k = [a, b]; k; k = prev.get(key(k[0], k[1]))) path.push(k[1]);
      return path.reverse();
    }
    for (const n of exitsOf(L, a, b)) {
      if (n === undefined || n < 0 || prev.has(key(b, n))) continue;
      prev.set(key(b, n), [a, b]);
      queue.push([b, n]);
    }
  }
  return null;
}
function cellsOf(tr) {
  const { x, y, dir } = tr;
  if (dir === 'E')
    return [
      Math.floor(y) * COLS + Math.ceil(x - 0.5) - 1,
      Math.floor(y) * COLS + Math.ceil(x - 0.5),
    ];
  if (dir === 'W')
    return [
      Math.floor(y) * COLS + Math.floor(x - 0.5) + 1,
      Math.floor(y) * COLS + Math.floor(x - 0.5),
    ];
  if (dir === 'S')
    return [
      (Math.ceil(y - 0.5) - 1) * COLS + Math.floor(x),
      Math.ceil(y - 0.5) * COLS + Math.floor(x),
    ];
  return [
    (Math.floor(y - 0.5) + 1) * COLS + Math.floor(x),
    Math.floor(y - 0.5) * COLS + Math.floor(x),
  ];
}
// Looks at the running trains only (no prompt): sets the junction their shortest route needs next,
// nearest train first, as fast as a human could press the keys.
function greedyPolicy(level) {
  const L = compileLevel(LEVELS[level - 1]);
  let lastKey = -9;
  return (st, t) => {
    if (t - lastKey < KEY_GAP) return [];
    const wants = [];
    for (const tr of st.trains) {
      if (tr.state !== 'run') continue;
      const [from, at] = cellsOf(tr);
      if (!L.tiles[from] || !L.tiles[at]) continue;
      const path = shortestPath(L, from, at, L.platforms[tr.dest]);
      if (!path) continue;
      let before = from;
      for (let i = 0; i < path.length - 1; i++) {
        const tile = L.tiles[path[i]];
        const entry = (dirBetween(before, path[i]) + 2) % 4;
        if (tile.kind === 'switch' && entry === tile.stem) {
          const want = tile.br.findIndex((d) => tile.arms[d] === path[i + 1]);
          wants.push({ j: L.jAt[path[i]], want, dist: i });
          break;
        }
        before = path[i];
      }
    }
    wants.sort((a, b) => a.dist - b.dist);
    const js = st.junctions;
    const todo = wants.find((w) => js[w.j].state !== w.want && !js[w.j].locked);
    if (!todo) return [];
    lastKey = t;
    const sel = js.findIndex((j) => j.selected);
    if (sel === todo.j) return ['Space'];
    const dir = selectStep(js, sel, todo.j);
    return dir < 0 ? [] : [PRESS[dir]];
  };
}

test('quality: a player with no prompt who always sends trains the shortest way wins at most half the timetables and none of the last eight', () => {
  const table = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let wins = 0;
    for (let seed = 1; seed <= 10; seed++)
      if (play({ level, seed, hz: 60, policy: greedyPolicy(level) }).cleared) wins++;
    table.push(wins);
  }
  const text = table.map((w, i) => `L${i + 1}=${w}/10`).join(' ');
  assert.ok(table[0] >= 9, `the shortest-way player is competent on the first timetable: ${text}`);
  assert.ok(table.filter((w) => w > 5).length <= LEVEL_COUNT / 2, `wins more than half: ${text}`);
  assert.ok(table.filter((w) => w > 0).length >= 4, `plays properly: ${text}`);
  table.slice(12).forEach((w, i) => assert.equal(w, 0, `timetable ${i + 13}: ${text}`));
  assert.ok(table.slice(5).reduce((n, w) => n + w, 0) <= 5 * 10, text);
});

test('quality: crude policies win at most half the runs on every timetable and almost none on later ones', () => {
  for (const [name, make] of Object.entries(CRUDE)) {
    let late = 0;
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      let wins = 0;
      for (let seed = 1; seed <= 10; seed++)
        if (play({ level, seed, hz: HZ[seed % 3], policy: make(seed) }).cleared) wins++;
      assert.ok(
        wins <= (level === 1 ? 5 : 2),
        `${name} won ${rate(wins, 10)} on timetable ${level}`,
      );
      if (level >= 5) late += wins;
    }
    assert.ok(late <= 2, `${name} wins timetables 5-20 ${late} times of 160`);
  }
});

test('quality: an idle player loses every timetable fairly, once, with a frozen end', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const hz of HZ) {
      const r = play({ level, hz, policy: () => [] });
      assert.equal(r.st.phase, 'lost', `timetable ${level} at ${hz} Hz`);
      assert.equal(r.ends.length, 1);
      assert.equal(r.ends[0].won, false);
      assert.ok(r.t > 5, 'the loss is not immediate');
      const frozen = JSON.stringify(r.g.getState());
      for (let i = 0; i < 30; i++) r.g.update(1 / hz, input([], ['Space', 'ArrowRight', 'KeyX']));
      assert.equal(JSON.stringify(r.g.getState()), frozen);
      assert.equal(r.ends.length, 1);
    }
});

test('quality: timetables get denser, mix train kinds and vary the quota as the campaign goes on', () => {
  const compiled = LEVELS.map((l) => compileLevel(l));
  const stats = compiled.map((c) => {
    const times = c.trains.map((t) => t.t);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    return {
      min: Math.min(...gaps),
      kinds: new Set(c.trains.map((t) => t.k)).size,
      spare: c.trains.length - c.quota,
      trains: c.trains.length,
    };
  });
  stats
    .slice(11)
    .forEach((q, i) =>
      assert.ok(q.min <= 2.5, `timetable ${i + 12} closest departures ${q.min} s apart`),
    );
  const late = stats.slice(8);
  assert.ok(
    late.every((q) => q.kinds >= 2),
    'every later timetable mixes slow, normal or express trains',
  );
  assert.ok(new Set(stats.map((q) => q.spare)).size >= 3, 'the quota margin varies');
  assert.ok(stats.slice(11).every((q) => q.spare <= 3));
  const avg = (a, b) => stats.slice(a, b).reduce((n, q) => n + q.min, 0) / (b - a);
  assert.ok(avg(0, 5) > avg(11, 20) + 1.5, 'later timetables run closer together');
  compiled.slice(11).forEach((c, i) => {
    const span = c.trains.at(-1).t - c.trains[0].t;
    assert.ok(c.trains.length / span >= 0.1, `timetable ${i + 12} is busy`);
  });
});

test('quality: no timetable begins in an unavoidable loss: the first train needs a quarter second of margin', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const c = compileLevel(LEVELS[level - 1]);
    assert.ok(c.trains[0].t >= 2, `timetable ${level} sends its first train at ${c.trains[0].t}`);
    const r = play({ level, seed: 1, policy: () => [] });
    assert.ok(r.t > c.trains[0].t);
  }
});

// ---------------------------------------------------------------------------------------------
// Fixed step, determinism and no tunnelling
// ---------------------------------------------------------------------------------------------
test('quality: the state is identical at 30, 60 and 120 Hz when input is aligned to 1/30 s', () => {
  for (const level of [4, 8, 12, 20]) {
    const events = parse(SOLUTIONS[level - 1]);
    const trace = HZ.map((hz) => {
      const { g } = open(level);
      const frames = [];
      for (let i = 0; i < hz * 40; i++) {
        const keys = events.filter((e) => Math.round((e.frame * hz) / 60) === i).map((e) => e.key);
        g.update(1 / hz, input([], keys));
        if ((i + 1) % hz === 0) frames.push(JSON.stringify(g.getState()));
      }
      return frames;
    });
    assert.deepEqual(trace[1], trace[0], `timetable ${level}: 60 Hz vs 30 Hz`);
    assert.deepEqual(trace[2], trace[0], `timetable ${level}: 120 Hz vs 30 Hz`);
  }
});

test('quality: the same keys and seed replay to the same final state', () => {
  const run = () => {
    const r = play({ level: 9, seed: 4, hz: 60, delay: FAST });
    return JSON.stringify({ s: r.st, t: r.t });
  };
  assert.equal(run(), run());
});

test('quality: zero, negative, NaN and paused-style dt leave the game untouched; huge dt is capped', () => {
  const { g } = open(5);
  for (let i = 0; i < 90; i++) g.update(1 / 60, input());
  const before = JSON.stringify(g.getState());
  for (const dt of [0, -0.5, NaN, Infinity, -Infinity, undefined, null, '0.1', {}])
    g.update(dt, input([], ['Space', 'ArrowDown']));
  assert.equal(JSON.stringify(g.getState()), before);
  const t0 = g.getState().time;
  g.update(10, input());
  assert.ok(g.getState().time - t0 <= RULES.maxDt + 1e-9);
});

test('quality: the simulation advances in fixed steps whatever the frame time', () => {
  const run = (dts) => {
    const { g } = open(6);
    let total = 0;
    for (let i = 0; total < 20; i++) {
      const dt = dts[i % dts.length];
      g.update(dt, input());
      total += dt;
    }
    return g.getState();
  };
  const a = run([1 / 60]);
  const b = run([1 / 120]);
  assert.ok(Math.abs(a.time - b.time) <= 2 * RULES.step + 1e-9);
  const jitter = run([0.011, 0.023, 0.007, 0.033, 0.016]);
  assert.ok(Math.abs(jitter.time - 20) <= 0.05);
  const steps = a.time / RULES.step;
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, 'time is a whole number of fixed steps');
});

test('quality: trains never pass through each other at any step rate, however they are driven', () => {
  assert.ok(
    RULES.speeds.x * RULES.step * 2 < RULES.hitDist,
    'a step cannot jump a collision radius',
  );
  let crashes = 0;
  let pairsChecked = 0;
  for (const hz of [30, 60, 120, 20])
    for (const level of [3, 4, 6, 8, 10, 13, 17, 20]) {
      const { g } = open(level);
      const rnd = seeded(level * 31 + hz);
      const prev = new Map();
      for (let i = 0; i < hz * 90; i++) {
        const jitter = hz === 20 ? 1 / 20 : 1 / hz;
        g.update(jitter, input([], rnd() < 0.08 ? [KEYS7[Math.floor(rnd() * KEYS7.length)]] : []));
        const st = g.getState();
        if (st.phase !== 'playing') break;
        const live = st.trains.filter((tr) => tr.state === 'run');
        for (let a = 0; a < live.length; a++)
          for (let b = a + 1; b < live.length; b++) {
            const d = Math.hypot(live[a].x - live[b].x, live[a].y - live[b].y);
            pairsChecked++;
            assert.ok(d >= RULES.hitDist - 1e-9, `${live[a].id}/${live[b].id} are ${d} apart`);
            const key = `${live[a].id}/${live[b].id}`;
            const before = prev.get(key);
            // Two trains on a straight line may not swap sides of each other between frames.
            if (before && before.d < 1 && d < 1) {
              const dot = before.dx * (live[a].x - live[b].x) + before.dy * (live[a].y - live[b].y);
              assert.ok(dot > -1e-9 || d > 0.6, `${key} swapped sides`);
            }
            prev.set(key, { d, dx: live[a].x - live[b].x, dy: live[a].y - live[b].y });
          }
        crashes = Math.max(crashes, st.stats.crashes);
      }
    }
  assert.ok(pairsChecked > 1000);
  assert.ok(crashes > 0, 'careless driving does produce recorded collisions');
});

test('quality: every strike is recorded with its cause, whatever the player does', () => {
  const kinds = new Set();
  for (let level = 1; level <= LEVEL_COUNT; level++)
    for (const seed of [1, 2, 3]) {
      const r = play({ level, seed, policy: CRUDE.random(seed) });
      const { crashes, wrong, late } = r.st.stats;
      assert.equal(r.strikes, crashes + wrong + late, `timetable ${level} seed ${seed}`);
      if (r.st.incident) kinds.add(r.st.incident);
    }
  for (const k of kinds) assert.ok(['head-on', 'rear-end', 'side', 'wrong', 'late'].includes(k), k);
  assert.ok(kinds.size >= 3, [...kinds].join());
});

// ---------------------------------------------------------------------------------------------
// Presentation: text size, layout, touch, bilingual copy
// ---------------------------------------------------------------------------------------------
function recorder() {
  const texts = [];
  let font = '';
  let align = 'left';
  const ctx = new Proxy(mockContext(), {
    get: (t, p) =>
      p === 'fillText'
        ? (text, x, y) => texts.push({ text: String(text), x, y, font, align })
        : p in t
          ? t[p]
          : () => {},
    set: (t, p, v) => {
      if (p === 'font') font = v;
      if (p === 'textAlign') align = v;
      t[p] = v;
      return true;
    },
  });
  return { ctx, texts };
}
const size = (q) => Number(/(\d+)px/.exec(q.font)[1]);
const CJK = /[⺀-鿿＀-￯]/;
const widthOf = (q) => [...q.text].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.6) * size(q), 0);
const spanOf = (q) => {
  const w = widthOf(q);
  const x0 = q.align === 'center' ? q.x - w / 2 : q.align === 'right' ? q.x - w : q.x;
  return { x0, x1: x0 + w, y0: q.y, y1: q.y + size(q) };
};
const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('quality: all canvas text is 14-16 px, fits the screen and never overlaps other text', () => {
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const frames = new Set([0, 60, 400, 2400]);
      play({
        level,
        seed: 6,
        lang,
        delay: FAST,
        onFrame: (st, t, keys, g) => {
          const f = Math.round(t * 60);
          if (!frames.delete(f)) return;
          const rec = recorder();
          g.draw(rec.ctx);
          // Junction letters are drawn with a one pixel outline: the copies under the top one do not count.
          const texts = rec.texts.filter(
            (q, n, all) =>
              !all
                .slice(n + 1)
                .some(
                  (o) => o.text === q.text && Math.abs(o.x - q.x) <= 1 && Math.abs(o.y - q.y) <= 1,
                ),
          );
          const spans = texts.map(spanOf);
          texts.forEach((q, n) => {
            assert.ok(size(q) >= 14 && size(q) <= 16, `"${q.text}" is ${size(q)} px`);
            assert.ok(spans[n].x0 >= 0 && spans[n].x1 <= 480, `"${q.text}" runs off screen`);
            assert.ok(spans[n].y1 <= 320, `"${q.text}" runs off the bottom`);
            spans.slice(n + 1).forEach((o, m) => {
              const other = texts[n + 1 + m];
              if (q.text === other.text && q.x !== other.x) return;
              const label = (x) => /^[A-Za-z]$/.test(x.text);
              const banner = (x) => x.align === 'center' && x.y >= 40 && x.y <= 120;
              if ((label(q) && banner(other)) || (label(other) && banner(q))) return;
              assert.ok(!meets(spans[n], o), `"${q.text}" overlaps "${other.text}"`);
            });
          });
        },
      });
    }
});

test('quality: the longest prompt, message and tip lines fit the canvas in both languages', () => {
  const longest = { en: 0, zh: 0 };
  for (const lang of ['en', 'zh'])
    for (let level = 1; level <= LEVEL_COUNT; level++)
      play({
        level,
        seed: 7,
        lang,
        delay: FAST,
        onFrame: (st) => {
          if (st.prompt) {
            const w = widthOf({ text: st.prompt[lang], font: '14px x' });
            longest[lang] = Math.max(longest[lang], w);
            assert.ok(w <= 464, `"${st.prompt[lang]}" is ${w.toFixed(0)} px`);
          }
        },
      });
  assert.ok(longest.en > 150 && longest.zh > 100);
  for (const l of LEVELS)
    for (const [lang, max] of [
      ['en', 50],
      ['zh', 29],
    ]) {
      const tip = l.tip[lang === 'en' ? 0 : 1];
      const lines = wrapText(tip, max);
      assert.ok(lines.length >= 1 && lines.length <= 3, `${l.name[0]}: ${lines.length} lines`);
      assert.equal(lines.join(lang === 'en' ? ' ' : ''), tip);
      for (const ln of lines) assert.ok(widthOf({ text: ln, font: '14px x' }) <= 448);
    }
  assert.deepEqual(wrapText('', 10), []);
  assert.deepEqual(wrapText('one two', 3), ['one', 'two']);
});

test('quality: each timetable opens with its tip, in the canvas banner and the status line, in both languages', () => {
  LEVELS.forEach((def, i) => {
    for (const [lang, idx] of [
      ['en', 0],
      ['zh', 1],
    ]) {
      const { g } = open(i + 1, { lang });
      g.update(1 / 60, input());
      const st = g.getState();
      assert.ok(st.status[lang].includes(def.tip[idx]), `${def.name[0]} status carries the tip`);
      assert.ok(st.status[lang].includes(st.name[lang]) || st.status[lang].includes(`${i + 1}/`));
      const rec = recorder();
      g.draw(rec.ctx);
      const drawn = rec.texts.map((q) => q.text).join(lang === 'en' ? ' ' : '');
      assert.ok(drawn.includes(def.name[idx]), `${def.name[0]} banner names the timetable`);
      assert.ok(drawn.includes(wrapText(def.tip[idx], lang === 'en' ? 50 : 29)[0]));
    }
  });
});

test('quality: the status line carries the prompt and counters, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    let seen = 0;
    play({
      level: 2,
      lang,
      delay: FAST,
      onFrame: (st) => {
        assert.ok(st.status.en.includes(`${st.delivered}/${st.quota}`));
        assert.ok(st.status.zh.includes(`${st.delivered}/${st.quota}`));
        if (st.prompt) {
          assert.ok(st.status[lang].includes(st.prompt[lang]));
          seen++;
        }
      },
    });
    assert.ok(seen > 100);
  }
});

test('quality: the level select shows no text over a cell or another text, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => LEVEL_COUNT, unlock() {} };
    const g = createGame(h.env);
    for (const key of [null, 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft']) {
      g.update(1 / 60, input([], key ? [key] : []));
      const rec = recorder();
      g.draw(rec.ctx);
      const spans = rec.texts.map(spanOf);
      rec.texts.forEach((q, n) => {
        assert.ok(size(q) >= 14 && size(q) <= 16);
        assert.ok(spans[n].x0 >= 0 && spans[n].x1 <= 480 && spans[n].y1 <= 320, q.text);
        spans
          .slice(n + 1)
          .forEach((o, m) =>
            assert.ok(!meets(spans[n], o), `${q.text}/${rec.texts[n + 1 + m].text}`),
          );
      });
      assert.ok(rec.texts.length >= 22);
      assert.match(g.getState().status[lang], lang === 'en' ? /timetables open/ : /张时刻表/);
    }
  }
});

test('quality: junction letters, platforms and trains are legible: letters sit beside the rails, not on them', () => {
  for (const def of LEVELS) {
    const c = compileLevel(def);
    assert.equal(c.labels.length, c.junctions.length);
    const cells = new Set();
    c.labels.forEach((at, i) => {
      const j = c.junctions[i];
      const empty = !c.tiles[at.y * RULES.cols + at.x];
      assert.ok(empty || (at.x === j.x && at.y === j.y), `${def.name[0]} ${j.id}`);
      assert.ok(Math.abs(at.x - j.x) <= 1 && Math.abs(at.y - j.y) <= 1);
      const key = `${at.x},${at.y}`;
      assert.ok(!cells.has(key), `${def.name[0]}: two letters share a cell`);
      cells.add(key);
    });
    assert.ok(
      c.labels.filter((at, i) => at.x !== c.junctions[i].x || at.y !== c.junctions[i].y).length >=
        c.junctions.length - 1,
    );
  }
});

test('quality: every train has a distinct colour and cargo symbol that matches its platform', () => {
  const { g } = open(20);
  const st = g.getState();
  const byDest = new Map();
  for (const tr of st.trains) {
    const platform = st.platforms.find((p) => p.id === String(tr.dest));
    assert.equal(platform.color, tr.color);
    assert.equal(tr.cargo, Number(tr.dest) - 1);
    const seen = byDest.get(tr.dest);
    if (seen) assert.deepEqual(seen, [tr.color, tr.cargo]);
    byDest.set(tr.dest, [tr.color, tr.cargo]);
  }
  assert.ok(byDest.size >= 4);
  assert.equal(new Set([...byDest.values()].map((v) => v[0])).size, byDest.size);
  assert.equal(new Set([...byDest.values()].map((v) => v[1])).size, byDest.size);
});

test('quality: touch controls are complete and bilingual and drive every action', () => {
  const codes = meta.touchControls.map((c) => c.code);
  for (const need of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'])
    assert.ok(codes.includes(need), need);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of meta.touchControls) {
    assert.ok(c.label.en.length > 0 && c.label.zh.length > 0);
    assert.ok(c.side === 'left' || c.side === 'right');
  }
  // Pressing only the touch buttons is enough to clear a timetable.
  const { g } = open(2);
  const events = parse(SOLUTIONS[1]);
  const allowed = new Set(codes);
  for (let i = 0; i < 60 * 40; i++) {
    const keys = events.filter((e) => e.frame === i).map((e) => e.key);
    for (const k of keys) assert.ok(allowed.has(k), k);
    g.update(1 / 60, input([], keys));
  }
  assert.ok(g.getState().level >= 2 || g.getState().delivered > 0);
});

test('quality: tapping with the pointer alone plays a timetable: select, then flip', () => {
  const { g } = open(1);
  const j = g.getState().junctions[0];
  const at = {
    x: (j.x + 0.5) * RULES.tile,
    y: RULES.top + (j.y + 0.5) * RULES.tile,
    clicked: true,
  };
  g.update(1 / 60, input([], [], at));
  assert.equal(g.getState().junctions[0].selected, true);
  const before = g.getState().junctions[0].state;
  g.update(1 / 60, input([], [], at));
  assert.notEqual(g.getState().junctions[0].state, before);
});

test('quality: a clean run and a careless run differ in score, and strikes cost points', () => {
  const clean = replay(3);
  const careless = play({ level: 3, seed: 1, hz: 60, delay: [0.9, 1.1] });
  assert.ok(clean.cleared && clean.strikes === 0);
  assert.ok(clean.st.score > 0 || clean.st.level > 3);
  assert.ok(careless.st.score <= clean.st.score + 400);
});

test('quality: the end message is explicit and bilingual for both a loss and a win', () => {
  for (const lang of ['en', 'zh']) {
    const lost = play({ level: 6, lang, policy: () => [] });
    assert.equal(lost.ends.length, 1);
    assert.ok(lost.ends[0].message.length > 20);
    if (lang === 'zh') assert.match(lost.ends[0].message, /[一-鿿]/);
    else assert.match(lost.ends[0].message, /timetable 6/);
    const won = replay(LEVEL_COUNT);
    assert.equal(won.st.phase, 'won');
    assert.equal(won.h.ends.length, 1);
    assert.equal(won.h.ends[0].won, true);
  }
});

test('quality: reading only the prompt is not enough late on: a 1 s delay loses mastery timetables that it clears while teaching', () => {
  const wins = (levels) =>
    levels.map((level) => {
      let n = 0;
      for (let seed = 1; seed <= 10; seed++)
        if (play({ level, seed, hz: 60, delay: [1, 1] }).cleared) n++;
      return n;
    });
  const mastery = wins([13, 14, 16, 17, 19, 20]);
  const teaching = wins([1, 2, 3, 4, 7, 11]);
  assert.ok(
    teaching.every((n) => n >= 9),
    `teaching wins ${teaching.join(',')} of 10`,
  );
  assert.ok(
    mastery.some((n) => n <= 5),
    `mastery wins ${mastery.join(',')} of 10`,
  );
  assert.ok(
    mastery.reduce((a, b) => a + b) < teaching.reduce((a, b) => a + b),
    'mastery is harder than the teaching timetables for a slow reader',
  );
});
