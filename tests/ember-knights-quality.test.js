import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, STAGE_COUNT } from '../src/games/ember-knights.js';
import {
  STAGES,
  RULES,
  TIER_LABEL,
  BASE_MOVES,
  attackSpec,
  stageTags,
} from '../src/games/ember-knights-stages.js';
import { ARENAS } from '../src/games/ember-knights-arenas.js';
import { createBrain } from '../src/games/ember-knights-ai.js';
import { MENU_COLUMNS, menuCell } from '../src/games/ember-knights-menu.js';
import { endMessage, bannerText } from '../src/games/ember-knights-text.js';
import { harness, input, mockContext, seeded } from './harness.js';

// ---------------------------------------------------------------------------------------------
// Players. Every policy sees only getState(), the same public snapshot the host and a person see.
// A policy returns the keys it holds this frame.
// ---------------------------------------------------------------------------------------------
const STAGE_NUMBERS = Array.from({ length: STAGE_COUNT }, (_, i) => i + 1);
const MASH_SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const HUMAN_SEEDS = [1, 2, 3, 4, 5];
const HUMAN_REACTIONS = [0.25, 0.3, 0.35];
const HZS = [30, 60, 120];
const MAX_DUEL_SECONDS = 75;

function openStage(
  stage,
  { seed = 1, lang = 'en', mode = 1, progress = undefined, start = true } = {},
) {
  const h = harness({ seed, lang, mode });
  let unlocked = stage;
  h.env.progress =
    progress === undefined
      ? { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) }
      : progress;
  const g = createGame(h.env);
  if (stage > 1 && h.env.progress && start) g.update(1 / 60, input([], ['Space']));
  return { g, h };
}

const towards = (s) => (s.fighters[1].x > s.fighters[0].x ? 'KeyD' : 'KeyA');
const gap = (s) => Math.abs(s.fighters[1].x - s.fighters[0].x);
const POLICIES = {
  idle: () => [],
  turtle: () => ['KeyS'],
  mashQuick: (s) => (gap(s) > 34 ? ['KeyJ', towards(s)] : ['KeyJ']),
  mashAll: (s) => (gap(s) > 34 ? ['KeyJ', 'KeyK', towards(s)] : ['KeyJ', 'KeyK']),
  mashAllGuard: (s, c) => {
    const keys = POLICIES.mashAll(s, c);
    return Math.floor(c.n / (c.hz / 5)) % 2 ? [...keys, 'KeyS'] : keys;
  },
  randomKeys: (s, c) => {
    if (c.n % Math.round(c.hz / 3) === 0)
      c.mem.held = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK'].filter(() => c.R() < 0.3);
    return c.mem.held ?? [];
  },
};

/**
 * A person with a reaction time. It reads the opponent `reaction` seconds late, knows its own
 * blocks at once, guards a swing it has seen (tapping late enough to parry a slow one), holds
 * the guard through a flurry, answers a block or parry with a counter and punishes a recovery.
 * `variant` removes one skill so the tests can show that each skill is needed.
 */
function humanBot(reaction, variant = {}) {
  return (s, c) => {
    const past = c.hist[Math.max(0, c.hist.length - 1 - Math.round(reaction * c.hz))];
    const a = s.fighters[0],
      foe = past.fighters[1],
      swing = foe.attack,
      t = c.n / c.hz,
      m = c.mem,
      dist = Math.abs(foe.x - a.x),
      toward = foe.x > a.x ? 'KeyD' : 'KeyA';
    m.idleSince ??= 0;
    m.blocks ??= 0;
    m.parries ??= 0;
    if (a.blocks > m.blocks) {
      m.counter = s.parries > m.parries && !variant.noHeavy ? 'KeyK' : 'KeyJ';
      m.counterUntil = t + 0.25;
    }
    m.blocks = a.blocks;
    m.parries = s.parries;
    if (a.attack || a.stun > 0 || a.guardBreak > 0) {
      m.idleSince = t;
      return [];
    }
    if (m.counter && t < m.counterUntil) {
      if (dist >= 54) return [toward];
      if (a.stamina >= (m.counter === 'KeyK' ? 28 : 12)) {
        const key = m.counter;
        m.counter = null;
        m.idleSince = t;
        return [key];
      }
    }
    if (swing) m.idleSince = t;
    if (swing && swing.phase !== 'recovery' && dist < swing.length + 42) {
      const left = swing.startup - (swing.age + reaction),
        endLeft = swing.startup + swing.active - (swing.age + reaction);
      if (variant.noGuard) return [];
      if (swing.type !== 'heavy') m.guardUntil = t + Math.max(0, endLeft) + 0.5;
      if (variant.noParry && endLeft > -0.06) return ['KeyS'];
      if ((left <= 0.12 && endLeft > -0.06) || t < (m.guardUntil ?? 0)) return ['KeyS'];
      return [];
    }
    if (!variant.noGuard && t < (m.guardUntil ?? 0) && dist < 80) return ['KeyS'];
    const recovery = swing
      ? swing.phase === 'recovery'
        ? swing.startup + swing.active + swing.recovery - swing.age - reaction
        : 0
      : Math.max(foe.stun, foe.guardBreak) - reaction;
    if (recovery > 0.24 && a.stamina >= 20) {
      if (dist < 54)
        return [recovery > 0.5 && a.stamina >= 30 && !variant.noHeavy ? 'KeyK' : 'KeyJ'];
      if (dist < 90) return [toward];
    }
    if (!variant.noHeavy && foe.blocking && foe.stamina < 45 && dist < 54 && a.stamina >= 40)
      return ['KeyK'];
    if (dist > 66) return [toward];
    if (!swing && t - m.idleSince > 3 && dist < 54 && a.stamina >= 60) {
      m.idleSince = t;
      return ['KeyJ'];
    }
    return [];
  };
}

// Plays one duel of the campaign from the stage select, stopping when it is decided.
function duel(stage, policy, { seed = 1, hz = 60 } = {}) {
  const { g, h } = openStage(stage, { seed });
  const c = { n: 0, hz, hist: [], mem: {}, R: seeded(seed * 31 + 7) };
  let s = g.getState();
  for (let n = 0; n < hz * MAX_DUEL_SECONDS; n++) {
    s = g.getState();
    if (s.phase !== 'playing' || s.roundPause > 0) break;
    c.n = n;
    c.hist.push(s);
    if (c.hist.length > hz) c.hist.shift();
    g.update(1 / hz, input(policy(s, c)));
  }
  s = g.getState();
  const cleared =
    s.phase === 'won' || (s.roundPause > 0 && s.fighters[0].health > s.fighters[1].health);
  return { g, h, s, cleared };
}
const rate = (stage, policy, seeds, opts) =>
  seeds.filter((seed) => duel(stage, policy, { seed, ...opts }).cleared).length / seeds.length;

// ---------------------------------------------------------------------------------------------
// The campaign data: at least 20 distinct, bilingual, rising stages with accurate lessons.
// ---------------------------------------------------------------------------------------------
const CJK = /[一-鿿]/;

test('the campaign has at least 20 distinct stages with bilingual names and lessons', () => {
  assert.ok(STAGE_COUNT >= 20);
  assert.equal(new Set(STAGES.map((s) => s.id)).size, STAGE_COUNT);
  assert.equal(new Set(STAGES.map((s) => s.name.en)).size, STAGE_COUNT, 'every champion is named');
  for (const stage of STAGES) {
    for (const text of [stage.name, stage.lesson]) {
      assert.ok(text.en.length > 3 && !CJK.test(text.en), `${stage.id} English`);
      assert.ok(CJK.test(text.zh), `${stage.id} Chinese`);
    }
  }
  assert.ok(new Set(STAGES.map((s) => s.arena)).size >= 6, 'six or more arenas');
  assert.ok(new Set(STAGES.map((s) => s.who)).size >= 10, 'ten or more champion styles');
  for (const stage of STAGES) assert.ok(ARENAS.includes(stage.arena), stage.arena);
});

test('the campaign teaches first, combines next and ends in mastery, with a rising curve', () => {
  const tiers = STAGES.map((s) => s.tier);
  assert.deepEqual([...new Set(tiers)], ['teach', 'combo', 'master']);
  assert.deepEqual(
    tiers,
    [...tiers].sort(
      (x, y) => ['teach', 'combo', 'master'].indexOf(x) - ['teach', 'combo', 'master'].indexOf(y),
    ),
  );
  assert.ok(tiers.filter((t) => t === 'teach').length >= 5);
  assert.ok(tiers.filter((t) => t === 'combo').length >= 5);
  assert.ok(tiers.filter((t) => t === 'master').length >= 5);
  for (const key of ['react', 'punish', 'rhythm', 'poise'])
    for (let i = 1; i < STAGE_COUNT; i++)
      assert.ok(
        (STAGES[i][key] ?? 0) >= (STAGES[i - 1][key] ?? 0),
        `${key} rises at stage ${i + 1}`,
      );
  for (let i = 1; i < STAGE_COUNT; i++)
    assert.ok(STAGES[i].reaction <= STAGES[i - 1].reaction, `reaction shrinks at stage ${i + 1}`);
  const first = STAGES[0],
    last = STAGES[STAGE_COUNT - 1];
  assert.ok(last.hp > first.hp && last.reaction < first.reaction && last.poise >= 3);
  assert.ok(
    STAGES.slice(0, 3).every((s) => (s.poise ?? 0) <= 1),
    'the opening is gentle',
  );
});

test('every champion blow can be read: windups outlast a 0.35 s human reaction', () => {
  for (const stage of STAGES)
    for (const type of ['light', 'heavy', 'thrust']) {
      const move = attackSpec(type, stage.moves, stage.dmg);
      assert.ok(move.startup >= 0.38, `${stage.id} ${type} startup ${move.startup}`);
      assert.ok(move.damage > 0 && move.damage <= 30);
    }
  assert.ok(BASE_MOVES.light.startup < 0.2, 'the player quick attack stays fast');
});

// Each lesson names a skill; the stage must really ask for it.
const reach = (s) => attackSpec('thrust', s.moves).length;
const LESSONS = {
  'gate-recruit': [/Quick/, /Heavy/, /轻击/, /重击/, (s) => s.moves.light.recovery >= 0.6],
  'torch-squire': [/Guard/, /stamina/, /举盾/, /体力/, (s) => s.defense.includes('guard')],
  'copper-guard': [
    /Heavy/,
    /shield/,
    /重击/,
    /盾/,
    (s) => s.startStamina < 100 && s.pattern.includes('guard'),
  ],
  'ash-duelist': [
    /retreat/,
    /lunge/,
    /后撤/,
    /突进/,
    (s) => s.lunge && s.pattern.includes('feint') && s.pattern.includes('thrust'),
  ],
  'forge-apprentice': [
    /parry/,
    /second/,
    /招架/,
    /一秒/,
    (s) => s.gear === 'hammer' && s.moves.heavy.armorAt !== undefined && RULES.parryStun === 1,
  ],
  'rampart-watch': [
    /Spear/,
    /thrust/,
    /长枪/,
    /突刺/,
    (s) => s.gear === 'spear' && reach(s) > BASE_MOVES.thrust.length,
  ],
  'shield-sergeant': [
    /Chained/,
    /tired swings hit softer/,
    /连续/,
    /疲惫/,
    () => RULES.chainCost > 0 && RULES.windedPower < 1,
  ],
  'garden-fencer': [
    /retreating/,
    /lunges/,
    /后撤/,
    /突进/,
    (s) => s.lunge && s.pattern.includes('feint'),
  ],
  'frost-sentinel': [
    /pairs/,
    /thrusts/,
    /成对/,
    /突刺/,
    (s) => s.pattern.join().includes('thrust,thrust'),
  ],
  'forge-hammer': [
    /braced/,
    /Parry/,
    /蓄势/,
    /招架/,
    (s) => s.moves.heavy.armorAt !== undefined && s.moves.heavy.recovery >= 0.9,
  ],
  'cinder-berserker': [
    /chains/,
    /tires/,
    /连续/,
    /疲劳/,
    (s) => s.pattern.filter((p) => p === 'light').length >= 3,
  ],
  'mirror-warden': [
    /rhythm/,
    /timing/,
    /节奏/,
    /节拍/,
    (s) => s.rhythm >= 0.8 && s.defense.includes('parry'),
  ],
  'lance-captain': [
    /thrusts/,
    /Parry the heavy/,
    /远刺/,
    /招架/,
    (s) => s.pattern.join().startsWith('thrust,thrust,guard,heavy'),
  ],
  'furnace-warden': [
    /Armored/,
    /interrupted/,
    /披甲/,
    /打断/,
    (s) => s.poise >= 3 && s.moves.heavy.poise >= 3,
  ],
  'ember-dancer': [
    /feints/,
    /lunge/,
    /佯攻/,
    /突进/,
    (s) => s.lunge && s.speed > 1 && s.pattern.includes('feint'),
  ],
  'iron-bulwark': [
    /guard/,
    /Heavy/,
    /盾/,
    /重击/,
    (s) => s.pattern.slice(0, 2).join() === 'guard,guard' && s.hp > 100,
  ],
  'siege-marshal': [
    /Armored/,
    /Parry the heavy/,
    /披甲/,
    /招架/,
    (s) => s.gear === 'hammer' && s.moves.heavy.poise >= 2,
  ],
  'kiln-reaver': [
    /chains/,
    /heavy/,
    /攻势/,
    /重击/,
    (s) => s.pattern.filter((p) => p === 'light').length >= 3 && s.speed > 1,
  ],
  'pale-lancer': [
    /reach/,
    /rhythm/,
    /射程/,
    /节奏/,
    (s) => reach(s) === Math.max(...STAGES.map(reach)),
  ],
  'ember-regent': [/stance/, /stamina/, /架势/, /体力/, (s) => new Set(s.pattern).size >= 5],
};
test('every lesson is accurate: its words match the skill and the stage really asks for it', () => {
  assert.deepEqual(Object.keys(LESSONS).sort(), STAGES.map((s) => s.id).sort());
  for (const stage of STAGES) {
    const [en1, en2, zh1, zh2, holds] = LESSONS[stage.id];
    assert.match(stage.lesson.en, en1, stage.id);
    assert.match(stage.lesson.en, en2, stage.id);
    assert.match(stage.lesson.zh, zh1, stage.id);
    assert.match(stage.lesson.zh, zh2, stage.id);
    assert.ok(holds(stage), `${stage.id} does what its lesson says`);
  }
});

test('stage tags only mark what differs: none on stage 1, each on at most half the stages', () => {
  assert.deepEqual(stageTags(STAGES[0]), []);
  const counts = {};
  for (const stage of STAGES)
    for (const tag of stageTags(stage)) counts[tag.en] = (counts[tag.en] ?? 0) + 1;
  for (const [name, n] of Object.entries(counts))
    assert.ok(n <= STAGE_COUNT / 2, `${name} is on ${n} stages`);
  assert.ok(counts['READS RHYTHM'] >= 1);
});

test('stage tags and tier labels are bilingual and describe the numbers', () => {
  for (const tier of Object.values(TIER_LABEL)) assert.ok(tier.en && CJK.test(tier.zh));
  const seen = new Set();
  for (const stage of STAGES) {
    for (const tag of stageTags(stage)) {
      assert.ok(tag.en && CJK.test(tag.zh));
      seen.add(tag.en);
    }
    assert.equal(
      stageTags(stage).some((t) => t.en === 'TOUGH'),
      stage.hp >= 140,
    );
    assert.equal(
      stageTags(stage).some((t) => t.en === 'ARMORED'),
      stage.armoredHeavy,
    );
    assert.equal(
      stageTags(stage).some((t) => t.en === 'SHORT CLOCK'),
      stage.time < 60,
    );
    assert.equal(
      stageTags(stage).some((t) => t.en === 'WINDED'),
      stage.startStamina < 100,
    );
  }
  for (const name of [
    'TOUGH',
    'SWIFT',
    'FIERCE',
    'SHORT CLOCK',
    'WINDED',
    'ARMORED',
    'READS RHYTHM',
  ])
    assert.ok(seen.has(name), `${name} appears in the campaign`);
});

// ---------------------------------------------------------------------------------------------
// The reviewer's finding: one held key must not beat the campaign.
// ---------------------------------------------------------------------------------------------
test('holding Quick and advancing wins at most 25% overall and 50% on any stage', () => {
  const rates = STAGE_NUMBERS.map((stage) => rate(stage, POLICIES.mashQuick, MASH_SEEDS));
  const overall = rates.reduce((x, y) => x + y, 0) / rates.length;
  assert.ok(overall <= 0.25, `overall ${overall.toFixed(2)}`);
  rates.forEach((r, i) => assert.ok(r <= 0.5, `stage ${i + 1}: ${r}`));
});
for (const name of ['idle', 'turtle', 'randomKeys', 'mashAll', 'mashAllGuard'])
  test(`${name} wins at most 25% on any stage from stage 3 on`, () => {
    const seeds = name === 'idle' || name === 'turtle' ? MASH_SEEDS.slice(0, 4) : MASH_SEEDS;
    for (const stage of STAGE_NUMBERS.slice(2)) {
      const r = rate(stage, POLICIES[name], seeds);
      assert.ok(r <= 0.25, `stage ${stage}: ${r}`);
    }
  });
test('the early stages are gentler but still do not fall to a held key', () => {
  for (const stage of [1, 2]) {
    assert.ok(rate(stage, POLICIES.idle, [1, 2, 3]) === 0);
    assert.ok(rate(stage, POLICIES.turtle, [1, 2, 3]) === 0);
    assert.ok(rate(stage, POLICIES.randomKeys, MASH_SEEDS) <= 0.5);
  }
});

// ---------------------------------------------------------------------------------------------
// Fairness: a person with a 0.25 to 0.35 s reaction can clear every stage, at every frame rate.
// ---------------------------------------------------------------------------------------------
for (const hz of HZS)
  for (const reaction of [0.25, 0.35])
    test(`a ${reaction} s human bot clears every stage at ${hz} Hz`, () => {
      const bot = humanBot(reaction);
      let wins = 0,
        total = 0;
      for (const stage of STAGE_NUMBERS) {
        const r = rate(stage, bot, HUMAN_SEEDS, { hz });
        assert.ok(r >= 0.6, `stage ${stage} (${STAGES[stage - 1].id}): ${r}`);
        wins += r * HUMAN_SEEDS.length;
        total += HUMAN_SEEDS.length;
      }
      assert.ok(wins / total >= 0.9, `overall ${(wins / total).toFixed(2)}`);
    });

test('parry, guarding and heavy blows are really needed', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const mean = (variant, stages) =>
    stages.reduce((sum, s) => sum + rate(s, humanBot(0.3, variant), seeds), 0) / stages.length;
  assert.ok(mean({}, [5, 10, 14, 17, 19]) >= 0.9, 'the full skill set clears the armored stages');
  // Never guarding loses everywhere.
  const blind = STAGE_NUMBERS.map((stage) => rate(stage, humanBot(0.3, { noGuard: true }), seeds));
  assert.ok(Math.max(...blind) <= 0.4, `worst stage ${Math.max(...blind)}`);
  assert.ok(blind.reduce((x, y) => x + y, 0) / blind.length <= 0.1, 'never guarding loses');
  // Blocking without ever parrying fails the braced and armored stages.
  assert.ok(mean({ noParry: true }, [5, 10, 14, 17]) <= 0.75, 'block-only play falls short');
  // Never using Heavy cannot break the armored guards.
  assert.ok(mean({ noHeavy: true }, [5, 10, 14, 17, 19]) <= 0.2, 'quick-only play falls short');
});

// ---------------------------------------------------------------------------------------------
// The champion's brain: a real reaction delay, a defence, a punish and a riposte.
// ---------------------------------------------------------------------------------------------
const body = (extra = {}) => ({
  attack: null,
  actionLock: 0,
  stun: 0,
  guardBreak: 0,
  stamina: 100,
  blocking: false,
  blocks: 0,
  x: 250,
  ...extra,
});
const heavySwing = (age) => ({
  type: 'heavy',
  age,
  startup: 0.44,
  active: 0.2,
  recovery: 0.66,
  length: 40,
});

test('each champion reacts to a visible windup only after its own reaction delay', () => {
  for (const stage of STAGES) {
    const brain = createBrain({ ...stage, react: 1, rhythm: 0 }, () => 0.01),
      me = body(),
      foe = body({ x: 205 });
    let reactedAt = null;
    for (let n = 1; n < 120 && reactedAt === null; n++) {
      foe.attack = heavySwing(n / 120);
      brain.control(me, foe, 1 / 120);
      if (brain.state().plan) reactedAt = n / 120;
    }
    assert.ok(reactedAt !== null, `${stage.id} reacts`);
    assert.ok(reactedAt >= stage.reaction - 0.02, `${stage.id} reacted at ${reactedAt}`);
    assert.ok(reactedAt <= stage.reaction + 0.05, `${stage.id} reacted at ${reactedAt}`);
  }
});
test('a champion with react 0 never defends, and one with react 1 parries or guards a slow heavy', () => {
  const stage = STAGES[9];
  const run = (react) => {
    const brain = createBrain(
      { ...stage, react, rhythm: 0, pattern: ['feint'], pace: 9 },
      () => 0.5,
    );
    const me = body(),
      foe = body({ x: 205 });
    const plans = new Set();
    for (let n = 1; n < 90; n++) {
      foe.attack = heavySwing(n / 120);
      const out = brain.control(me, foe, 1 / 120);
      if (brain.state().plan) plans.add(brain.state().plan);
      if (out.guard) plans.add('guarding');
    }
    return plans;
  };
  assert.equal([...run(0)].filter((p) => p !== 'retreat').length, 0);
  assert.ok(run(1).has('parry') || run(1).has('guard'));
});
test('a champion punishes a stunned player, answers a block at once and parries then strikes', () => {
  const stage = { ...STAGES[2], punish: 1, react: 0, rhythm: 0, pattern: ['guard'], pace: 99 };
  const brain = createBrain(stage, () => 0);
  const me = body(),
    foe = body({ x: 215 });
  let strike = null;
  for (let n = 1; n < 200 && !strike; n++) {
    foe.stun = 1.2 - n / 120;
    brain.control(me, foe, 1 / 120);
    if (brain.state().plan === 'strike') strike = n / 120;
  }
  assert.ok(strike !== null, 'a long stun is punished');
  assert.ok(strike >= stage.reaction - 0.02, 'but only after the reaction delay');
  const answer = createBrain(
    { ...STAGES[STAGE_COUNT - 1], punish: 1, pattern: ['guard'], pace: 99 },
    () => 0,
  );
  const me2 = body({ blocks: 0 }),
    foe2 = body({ x: 215, stun: 0.45 });
  answer.control(me2, foe2, 1 / 120);
  me2.blocks = 1;
  answer.control(me2, foe2, 1 / 120);
  assert.equal(answer.state().plan, 'strike', 'a block is answered at once');
});
test('a champion does not strike into a player who can swing back, unless it is armored', () => {
  const armoredStage = STAGES[STAGE_COUNT - 1];
  const plainStage = STAGES[3];
  const trial = (stage) => {
    const brain = createBrain(
      { ...stage, pace: 0.05, pattern: ['light'], react: 0, punish: 0 },
      () => 0.9,
    );
    const me = body(),
      foe = body({
        x: 215,
        attack: { ...heavySwing(0.1), type: 'light', startup: 0.18, recovery: 0.29 },
      });
    let struck = false;
    for (let n = 0; n < 160 && !struck; n++) {
      brain.control(me, foe, 1 / 120);
      struck = brain.state().plan === 'strike';
      if (n === 10) foe.attack = null;
    }
    return struck;
  };
  assert.equal(trial(plainStage), false);
  assert.equal(trial(armoredStage), true);
});

// ---------------------------------------------------------------------------------------------
// Every stage can be won and lost, ends exactly once, and the end state is frozen.
// ---------------------------------------------------------------------------------------------
for (const stage of STAGES) {
  const n = STAGES.indexOf(stage) + 1;
  test(`stage ${n} ${stage.id}: a scripted legal clear exists and idle play loses`, () => {
    let cleared = null;
    for (const seed of HUMAN_SEEDS) {
      const r = duel(n, humanBot(0.3), { seed });
      if (r.cleared) {
        cleared = r;
        break;
      }
    }
    assert.ok(cleared, 'the human bot clears the stage');
    assert.ok(
      (cleared.s.fighters[0].health > 0 && cleared.s.fighters[1].health === 0) ||
        cleared.s.remaining === 0,
    );
    const lost = openStage(n, { lang: n % 2 ? 'en' : 'zh' });
    for (let k = 0; k < 120 * 90 && lost.g.getState().phase === 'playing'; k++)
      lost.g.update(1 / 120, input());
    const end = lost.g.getState();
    assert.equal(end.phase, 'lost');
    assert.equal(lost.h.ends.length, 1);
    assert.equal(lost.h.ends[0].won, false);
    assert.equal(end.winner, 2);
    const name = n % 2 ? stage.name.en : stage.name.zh;
    assert.ok(lost.h.ends[0].message.includes(name), lost.h.ends[0].message);
    for (let k = 0; k < 60; k++) lost.g.update(1 / 60, input(['KeyD', 'KeyJ', 'KeyK'], ['KeyJ']));
    assert.deepEqual(lost.g.getState(), end, 'the terminal state is frozen');
    assert.equal(lost.h.ends.length, 1);
  });
}

for (const hz of HZS)
  test(`the whole campaign is won in one run at ${hz} Hz, ending once with a frozen state`, () => {
    const h = harness({ seed: 1 }),
      g = createGame(h.env),
      c = { n: 0, hz, hist: [], mem: {}, R: seeded(5) },
      bot = humanBot(0.3),
      stagesSeen = new Set();
    for (let n = 0; n < hz * 60 * 40 && g.getState().phase === 'playing'; n++) {
      const s = g.getState();
      stagesSeen.add(s.stage);
      c.n = n;
      c.hist.push(s);
      if (c.hist.length > hz) c.hist.shift();
      g.update(1 / hz, input(bot(s, c)));
    }
    const end = g.getState();
    assert.equal(end.phase, 'won');
    assert.equal(end.stage, STAGE_COUNT);
    assert.equal(stagesSeen.size, STAGE_COUNT);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].won, true);
    assert.ok(h.ends[0].score > 0 && h.ends[0].score === end.score);
    assert.match(h.ends[0].message, new RegExp(String(STAGE_COUNT)));
    for (let k = 0; k < 60; k++) g.update(1 / hz, input(['KeyD', 'KeyJ']));
    assert.deepEqual(g.getState(), end);
    assert.equal(h.ends.length, 1);
  });

test('a solo draw is a clear loss; the wording follows how it happened, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const env = { t: (en, zh) => (lang === 'zh' ? zh : en) };
    const draw = (extra) =>
      endMessage(env, { solo: true, draw: true, index: 1, stage: STAGES[0], total: 20, ...extra });
    const timed = draw({ timedOut: true }),
      mutual = draw({ timedOut: false });
    assert.match(
      timed,
      lang === 'en'
        ? /Time ran out with you and Gate Recruit level on health/
        : /时间耗尽，你与守门新兵生命相同/,
    );
    assert.match(
      mutual,
      lang === 'en' ? /You and Gate Recruit fell together/ : /你与守门新兵同时倒下/,
    );
    for (const m of [timed, mutual])
      assert.match(m, lang === 'en' ? /draw counts as a loss/ : /平局视为失败/);
    assert.doesNotMatch(mutual, /Time ran out|时间耗尽/);
    const versus = endMessage(env, {
      solo: false,
      draw: true,
      index: 0,
      stage: STAGES[0],
      total: 20,
    });
    assert.match(versus, lang === 'en' ? /draw/ : /平局/);
  }
});
test('the first stages stretch every windup to 0.5 s so slower players can read them', () => {
  for (const stage of STAGES.slice(0, 4))
    for (const type of ['light', 'heavy', 'thrust'])
      assert.ok(attackSpec(type, stage.moves).startup >= 0.5, `${stage.id} ${type}`);
});
test('a slow 0.45 s lesson-following bot learns the opening: stages 1 to 4 are clearable', () => {
  for (const hz of [30, 60, 120])
    for (const stage of [1, 2, 3, 4]) {
      const r = rate(stage, humanBot(0.45), HUMAN_SEEDS, { hz });
      assert.ok(r >= 0.5, `stage ${stage} at ${hz} Hz: ${r}`);
    }
});
test('tired swings are announced: the stamina bar turns and the action line says TIRED', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ mode: 2, lang }).env),
      { ctx, drawn } = textCanvas();
    for (let n = 0; n < 100; n++) g.update(1 / 60, input(['KeyJ']));
    for (let n = 0; n < 40; n++) g.update(1 / 60, input());
    assert.ok(g.getState().fighters[0].stamina < RULES.windedAt);
    g.draw(ctx);
    assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'TIRED' : '疲惫')));
    assertFits(drawn, `${lang} tired`);
  }
  assert.match(meta.description.en, /tired swings hit softer/);
  assert.match(meta.description.zh, /疲惫/);
});
test('the banner is data and follows a language toggle between draws', () => {
  const g = openStage(1).g;
  g.draw(mockContext());
  const banner = { kind: 'round', player: 2 };
  const en = { t: (e) => e },
    zh = { t: (_e, z) => z };
  assert.match(bannerText(banner, en), /PLAYER 2/);
  assert.match(bannerText(banner, zh), /玩家2/);
  assert.match(bannerText({ kind: 'stage' }, zh), /冠军/);
  assert.match(bannerText({ kind: 'draw' }, en), /DRAW/);
  assert.equal(typeof g.getState().status.en, 'string');
});

// ---------------------------------------------------------------------------------------------
// Determinism across frame rates and across languages.
// ---------------------------------------------------------------------------------------------
const SCRIPT = [
  [['KeyD'], 1.4],
  [['KeyD', 'KeyJ'], 0.7],
  [['KeyS'], 0.6],
  [[], 0.4],
  [['KeyK'], 0.5],
  [['KeyA', 'KeyW'], 0.5],
  [['KeyJ'], 2],
  [['KeyS', 'KeyD'], 1],
];
function runScript(stage, hz, lang = 'en') {
  const { g } = openStage(stage, { seed: 9, lang });
  for (const [keys, seconds] of SCRIPT)
    for (let n = 0; n < Math.round(seconds * hz); n++) g.update(1 / hz, input(keys));
  return g.getState();
}
for (const stage of [1, 6, 12, 20])
  test(`stage ${stage} plays out identically at 30, 60 and 120 Hz and in both languages`, () => {
    const base = runScript(stage, 120);
    for (const hz of [30, 60]) {
      const s = runScript(stage, hz);
      assert.equal(s.phase, base.phase);
      assert.equal(s.stage, base.stage);
      assert.equal(s.parries, base.parries);
      for (let i = 0; i < 2; i++) {
        assert.ok(Math.abs(s.fighters[i].x - base.fighters[i].x) < 1e-3, `x ${hz}`);
        assert.ok(Math.abs(s.fighters[i].health - base.fighters[i].health) < 1e-6, `hp ${hz}`);
        assert.ok(Math.abs(s.fighters[i].stamina - base.fighters[i].stamina) < 1e-3, `st ${hz}`);
      }
    }
    const zh = runScript(stage, 60, 'zh');
    assert.deepEqual(
      zh.fighters.map((f) => f.health),
      runScript(stage, 60, 'en').fighters.map((f) => f.health),
    );
  });
test('two-player play is mirror symmetric and identical at every frame rate', () => {
  const run = (hz) => {
    const g = createGame(harness({ mode: 2 }).env);
    const plan = [
      [['KeyD', 'ArrowLeft'], 1],
      [['KeyJ', 'Comma'], 0.8],
      [['KeyS', 'ArrowDown'], 0.5],
      [['KeyK', 'Period'], 0.8],
      [['KeyD', 'ArrowLeft', 'KeyJ', 'Comma'], 1.5],
    ];
    for (const [keys, seconds] of plan)
      for (let n = 0; n < Math.round(seconds * hz); n++) g.update(1 / hz, input(keys));
    return g.getState();
  };
  const base = run(120);
  for (const hz of [30, 60]) {
    const s = run(hz);
    assert.ok(Math.abs(s.fighters[0].x - base.fighters[0].x) < 1e-3);
    assert.equal(s.fighters[0].health, base.fighters[0].health);
  }
  const [a, b] = base.fighters;
  assert.ok(Math.abs(a.x - (480 - b.x)) < 1e-6, 'positions mirror');
  assert.equal(a.health, b.health);
  assert.ok(Math.abs(a.stamina - b.stamina) < 1e-6);
});

// ---------------------------------------------------------------------------------------------
// Text: complete in both languages and inside the 480 x 320 canvas.
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
  [...text].reduce(
    (sum, ch) => sum + (CJK.test(ch) || /[（）：，。！·]/.test(ch) ? size : size * 0.62),
    0,
  );
function assertFits(drawn, label) {
  for (const { text, x, y, size, align } of drawn) {
    const w = widthOf(text, size),
      left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    assert.ok(
      left >= 0 && left + w <= 480,
      `${label}: "${text}" spans ${left.toFixed(0)}..${(left + w).toFixed(0)}`,
    );
    assert.ok(y >= 0 && y + size <= 320, `${label}: "${text}" at y ${y}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${label}: "${text}"`);
  }
}
test('every stage screen is complete in English and Chinese and fits the canvas', () => {
  let strings = 0;
  for (const lang of ['en', 'zh'])
    for (const stage of STAGE_NUMBERS) {
      const { g } = openStage(stage, { lang, seed: stage });
      const { ctx, drawn } = textCanvas();
      const c = { n: 0, hz: 60, hist: [], mem: {}, R: seeded(stage) };
      for (let n = 0; n < 60 * 14 && g.getState().phase === 'playing'; n++) {
        const s = g.getState();
        c.n = n;
        g.update(1 / 60, input(POLICIES.mashAllGuard(s, c)));
        if (n % 20 === 0) g.draw(ctx);
      }
      assertFits(drawn, `${lang} stage ${stage}`);
      for (const { text } of drawn) {
        strings++;
        if (lang === 'en') assert.ok(!CJK.test(text), `English screen shows "${text}"`);
        else assert.ok(!/[A-Za-z]{3,}/.test(text), `Chinese screen shows "${text}"`);
      }
    }
  assert.ok(strings > 2000);
});
test('the stage select, banners and the two-player screens fit and are localized', () => {
  for (const lang of ['en', 'zh']) {
    for (const stage of [2, 7, 13, 20]) {
      const { g } = openStage(stage, { lang, start: false });
      const { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assert.ok(g.getState().menu, 'select screen is showing');
      assertFits(drawn, `${lang} select ${stage}`);
      assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'CHOOSE A DUEL' : '选择决斗')));
      assert.ok(
        drawn.some((d) => d.text.includes(lang === 'en' ? 'LOCKED' : '未解锁')) || stage === 20,
      );
    }
    const h = harness({ mode: 2, lang }),
      g = createGame(h.env);
    const { ctx, drawn } = textCanvas();
    for (let n = 0; n < 120 * 40 && g.getState().roundPause === 0; n++)
      g.update(1 / 60, input(['KeyJ', 'KeyD']));
    g.draw(ctx);
    assert.ok(g.getState().roundPause > 0, 'a round banner is showing');
    assertFits(drawn, `${lang} two-player banner`);
    assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'TAKES THE ROUND' : '赢得回合')));
    const solo = openStage(1, { lang });
    const sc = textCanvas();
    const bot = humanBot(0.3),
      c = { n: 0, hz: 60, hist: [], mem: {}, R: seeded(1) };
    for (let n = 0; n < 60 * 60 && solo.g.getState().roundPause === 0; n++) {
      const s = solo.g.getState();
      c.n = n;
      c.hist.push(s);
      if (c.hist.length > 60) c.hist.shift();
      solo.g.update(1 / 60, input(bot(s, c)));
    }
    solo.g.draw(sc.ctx);
    assertFits(sc.drawn, `${lang} champion banner`);
    assert.ok(
      sc.drawn.some((d) => d.text.includes(lang === 'en' ? 'NEXT CHAMPION' : '下一位冠军')),
    );
  }
});
test('host-facing text is complete in both languages', () => {
  for (const key of ['name', 'description']) assert.ok(meta[key].en && CJK.test(meta[key].zh), key);
  for (const entry of meta.keys)
    assert.ok(entry.label.en && CJK.test(entry.label.zh) && entry.keys);
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en) && /选关/.test(k.label.zh)));
  for (const lang of ['en', 'zh']) {
    const s = openStage(9, { lang }).g.getState();
    assert.ok(s.status.en && CJK.test(s.status.zh));
    assert.ok(!CJK.test(s.status.en));
    const m2 = createGame(harness({ mode: 2, lang }).env).getState();
    assert.match(m2.status.en, /First to 2/);
    assert.match(m2.status.zh, /先赢2回合/);
  }
});

// ---------------------------------------------------------------------------------------------
// Controls: touch covers every action, in both modes and in the stage select.
// ---------------------------------------------------------------------------------------------
test('touch controls reach every solo action: move, jump, guard, quick and heavy', () => {
  const codes = meta.touchControls.map((b) => b.code);
  assert.deepEqual(new Set(codes), new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']));
  for (const b of meta.touchControls)
    assert.ok(['left', 'right'].includes(b.side) && b.label.en && CJK.test(b.label.zh));
  const effects = {
    KeyA: (f) => f.vx < 0,
    KeyD: (f) => f.vx > 0,
    KeyW: (f) => f.vy < 0,
    KeyS: (f) => f.blocking,
    KeyJ: (f) => f.attack?.type === 'light',
    KeyK: (f) => f.attack?.type === 'heavy',
  };
  for (const code of codes) {
    const g = createGame(harness().env);
    g.update(1 / 60, input([code], [code]));
    assert.ok(effects[code](g.getState().fighters[0]), code);
  }
});
test('touch controls cover both players in two-player mode, one set per side', () => {
  const layout = meta.multiplayerTouchControls;
  assert.equal(layout.length, 12);
  assert.deepEqual(
    new Set(layout.filter((b) => b.side === 'left').map((b) => b.code)),
    new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK']),
  );
  assert.deepEqual(
    new Set(layout.filter((b) => b.side === 'right').map((b) => b.code)),
    new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Comma', 'Period']),
  );
  for (const b of layout) assert.ok(b.label.en && CJK.test(b.label.zh));
  const g = createGame(harness({ mode: 2 }).env);
  for (const code of layout.map((b) => b.code)) g.update(1 / 60, input([code], [code]));
  const [a, b] = g.getState().fighters;
  assert.ok(a.attack || a.blocking || a.vx !== 0 || b.attack || b.blocking || b.vx !== 0);
});
test('the stage select can be driven from the touch buttons alone', () => {
  const { g } = openStage(8, { start: false });
  assert.equal(g.getState().menu.cursor, 8, 'continue opens on the newest stage');
  g.update(1 / 60, input([], ['KeyA']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['KeyW']));
  assert.equal(g.getState().menu.cursor, 2, 'up moves a row');
  g.update(1 / 60, input([], ['KeyS']));
  assert.equal(g.getState().menu.cursor, 7);
  g.update(1 / 60, input([], ['KeyD']));
  assert.equal(g.getState().menu.cursor, 8);
  g.update(1 / 60, input([], ['KeyD']));
  assert.equal(g.getState().menu.cursor, 8, 'locked stages cannot be reached');
  g.update(1 / 60, input([], ['KeyA']));
  g.update(1 / 60, input([], ['KeyJ']));
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.stage, 7);
  assert.equal(s.fighters[1].maxHealth, STAGES[6].hp);
});

// ---------------------------------------------------------------------------------------------
// Stage select and progress.
// ---------------------------------------------------------------------------------------------
test('there is no select screen on a first visit and playing starts at stage 1', () => {
  assert.equal(createGame(harness().env).getState().menu, null);
  const first = openStage(1);
  assert.equal(first.g.getState().stage, 1);
  assert.equal(first.g.getState().menu, null);
  assert.equal(openStage(1, { progress: null }).g.getState().menu, null);
});
test('clearing a stage unlocks the next one and a new run offers to continue there', () => {
  let unlocked = 1;
  const progress = { unlocked: () => unlocked, unlock: (n) => (unlocked = Math.max(unlocked, n)) };
  const h = harness();
  h.env.progress = progress;
  let g = createGame(h.env);
  const c = { n: 0, hz: 60, hist: [], mem: {}, R: seeded(3) },
    bot = humanBot(0.3);
  for (let n = 0; n < 60 * 80 && g.getState().roundPause === 0; n++) {
    const s = g.getState();
    c.n = n;
    c.hist.push(s);
    if (c.hist.length > 60) c.hist.shift();
    g.update(1 / 60, input(bot(s, c)));
  }
  assert.equal(unlocked, 2, 'clearing stage 1 unlocks stage 2');
  assert.equal(g.getState().unlocked, 2);
  g = createGame(Object.assign(harness().env, { progress }));
  assert.equal(g.getState().menu.cursor, 2);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().stage, 2);
  assert.equal(g.getState().menu, null);
});
test('progress only ever rises and the last stage never unlocks a stage that does not exist', () => {
  const writes = [];
  const progress = { unlocked: () => 5, unlock: (n) => writes.push(n) };
  const { g } = openStage(5, { progress, start: false });
  assert.equal(g.getState().menu.cursor, 5);
  const last = openStage(STAGE_COUNT, {
    progress: { unlocked: () => STAGE_COUNT, unlock: (n) => writes.push(n) },
  });
  last.g.update(1 / 60, input([], ['Space']));
  const c = { n: 0, hz: 60, hist: [], mem: {}, R: seeded(1) },
    bot = humanBot(0.3);
  let n = 0;
  while (n++ < 60 * 80 && last.g.getState().phase === 'playing') {
    const s = last.g.getState();
    c.n = n;
    c.hist.push(s);
    if (c.hist.length > 60) c.hist.shift();
    last.g.update(1 / 60, input(bot(s, c)));
  }
  assert.ok(writes.every((w) => w <= STAGE_COUNT && w >= 1));
  assert.ok(writes.every((w) => Number.isInteger(w)));
});
test('the select screen opens on the saved stage, clamps it, and ignores a broken store', () => {
  const stores = [
    [() => 9, 9],
    [() => 999, STAGE_COUNT],
    [() => 0, null],
    [() => -4, null],
    [() => NaN, null],
    [() => 'abc', null],
    [() => '6', 6],
    [() => 3.9, 3],
    [() => null, null],
    [() => undefined, null],
    [() => ({}), null],
    [
      () => {
        throw new Error('storage blocked');
      },
      null,
    ],
  ];
  for (const [read, expected] of stores) {
    const h = harness();
    h.env.progress = { unlocked: read, unlock: () => {} };
    const g = createGame(h.env);
    const menu = g.getState().menu;
    if (expected === null || expected === 1) assert.equal(menu, null, String(read));
    else assert.equal(menu.cursor, expected, String(read));
    g.update(1 / 60, input([], ['Space']));
    g.update(1 / 60, input(['KeyD']));
    assert.equal(g.getState().menu, null);
    assert.ok(Number.isFinite(g.getState().fighters[0].x));
  }
  assert.ok(
    createGame(Object.assign(harness().env, { progress: {} })).getState().menu === null,
    'a store with no methods',
  );
});
test('a store that throws on save does not stop a cleared stage from moving on', () => {
  const h = harness();
  h.env.progress = {
    unlocked: () => {
      throw new Error('no read');
    },
    unlock: () => {
      throw new Error('no write');
    },
  };
  const g = createGame(h.env),
    c = { n: 0, hz: 60, hist: [], mem: {}, R: seeded(2) },
    bot = humanBot(0.3);
  for (let n = 0; n < 60 * 80 && g.getState().roundPause === 0; n++) {
    const s = g.getState();
    c.n = n;
    c.hist.push(s);
    if (c.hist.length > 60) c.hist.shift();
    g.update(1 / 60, input(bot(s, c)));
  }
  assert.ok(g.getState().roundPause > 0, 'stage 1 was cleared');
  for (let n = 0; n < 60 * 3; n++) g.update(1 / 60, input());
  assert.equal(g.getState().stage, 2);
  assert.equal(g.getState().phase, 'playing');
  assert.equal(g.getState().unlocked, 2, 'the in-game record still advances');
});
test('tapping a stage on the select screen starts it; a locked stage only complains', () => {
  const { g, h } = openStage(6, { start: false });
  const tap = (n) => {
    const q = menuCell(n);
    g.update(
      1 / 60,
      input([], [], { x: q.x + q.w / 2, y: q.y + q.h / 2, clicked: true, down: true }),
    );
  };
  tap(9);
  assert.ok(g.getState().menu, 'locked: still choosing');
  assert.equal(h.sounds.at(-1), 'hit');
  assert.equal(g.getState().menu.cursor, 6);
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.ok(g.getState().menu, 'a tap outside every cell does nothing');
  tap(4);
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().stage, 4);
  assert.ok(MENU_COLUMNS >= 4);
});
test('the last stage reads FINAL, never NEXT, and the select hint mentions tapping', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    h.env.progress = { unlocked: () => STAGE_COUNT, unlock: () => {} };
    const { ctx, drawn } = textCanvas();
    createGame(h.env).draw(ctx);
    assert.ok(drawn.some((d) => d.text === (lang === 'en' ? 'FINAL' : '最终战')));
    assert.ok(!drawn.some((d) => d.text === (lang === 'en' ? 'NEXT' : '下一场')));
    assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'tap a duel' : '点按关卡')));
  }
  assert.ok(meta.keys.some((k) => /tap/.test(k.label.en) && /点按/.test(k.label.zh)));
});
test('every select cell can be drawn locked, cleared and next, in both languages', () => {
  for (const lang of ['en', 'zh'])
    for (const cursor of [1, 10, 20]) {
      const h = harness({ lang });
      h.env.progress = { unlocked: () => 12, unlock: () => {} };
      const g = createGame(h.env);
      for (let n = 12; n > cursor; n--) g.update(1 / 60, input([], ['KeyA']));
      for (let n = 12; n < cursor; n++) g.update(1 / 60, input([], ['KeyD']));
      const { ctx, drawn } = textCanvas();
      g.draw(ctx);
      assertFits(drawn, `${lang} select cursor ${g.getState().menu.cursor}`);
      assert.ok(drawn.some((d) => d.text.includes(lang === 'en' ? 'NEXT' : '下一场')));
    }
});

// ---------------------------------------------------------------------------------------------
// Two-player mode: its own rules, nothing from the campaign.
// ---------------------------------------------------------------------------------------------
test('two-player mode ignores the campaign: no champion, no tags, no progress and score 0', () => {
  const writes = [];
  const h = harness({ mode: 2 });
  h.env.progress = { unlocked: () => 15, unlock: (n) => writes.push(n) };
  const g = createGame(h.env);
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.ai, null);
  assert.equal(s.stage, 1);
  assert.deepEqual(
    s.fighters.map((f) => f.maxHealth),
    [100, 100],
  );
  const { ctx, drawn } = textCanvas();
  g.draw(ctx);
  assert.ok(!drawn.some((d) => /TOUGH|SWIFT|ARMORED|MASTERY|LESSON/.test(d.text)));
  assert.ok(drawn.some((d) => /PARRY/.test(d.text)));
  assert.deepEqual(writes, []);
  // P2 on the arrow keys fights back like a player, with no brain steering.
  const before = g.getState().fighters[1].x;
  for (let n = 0; n < 60; n++) g.update(1 / 60, input(['ArrowRight']));
  assert.ok(g.getState().fighters[1].x > before);
});

// ---------------------------------------------------------------------------------------------
// Fuzz: random legal inputs never break an invariant, solo or two-player.
// ---------------------------------------------------------------------------------------------
const ALL_KEYS = [
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'KeyJ',
  'KeyK',
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Comma',
  'Period',
];
function checkInvariants(s, mode, previous) {
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s), 'JSON safe');
  assert.ok(JSON.stringify(s).length < 20000, 'snapshot stays small');
  assert.ok(Number.isFinite(s.score) && s.score >= 0);
  if (mode === 2) assert.equal(s.score, 0);
  else if (previous) assert.ok(s.score >= previous.score, 'score never falls');
  assert.ok(['playing', 'won', 'lost'].includes(s.phase));
  assert.ok(s.particles <= 100);
  assert.ok(s.remaining >= 0 && Number.isFinite(s.remaining));
  assert.ok(s.wins.every((w) => w >= 0 && w <= 2));
  assert.ok(s.stage >= 1 && s.stage <= STAGE_COUNT);
  for (const f of s.fighters) {
    for (const key of ['x', 'y', 'vx', 'vy', 'health', 'stamina', 'stun', 'parry', 'guardBreak'])
      assert.ok(Number.isFinite(f[key]), key);
    assert.ok(f.health >= 0 && f.health <= f.maxHealth);
    assert.ok(f.stamina >= 0 && f.stamina <= 100);
    assert.ok(f.x - f.w / 2 >= 12 - 1e-5 && f.x + f.w / 2 <= 468 + 1e-5);
    assert.ok(f.y <= 260 + 1e-5);
    assert.ok(f.chain >= 0 && f.blocks >= 0);
    assert.ok(
      f.support === null || typeof f.support === 'string',
      'support is a string id, never 0',
    );
  }
  const [a, b] = s.fighters;
  const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x),
    overlapY = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h);
  assert.ok(overlapX < 1e-5 || overlapY < 1e-5, 'solid fighters never share space');
}
function fuzz(stage, mode, seed) {
  const h = harness({ mode, seed });
  h.env.progress = { unlocked: () => stage, unlock: () => {} };
  const g = createGame(h.env),
    R = seeded(seed * 17 + stage);
  let held = [],
    previous = null,
    ended = null;
  if (mode === 1 && stage > 1) g.update(1 / 60, input([], ['Enter']));
  for (let n = 0; n < 60 * 120; n++) {
    if (n % 5 === 0) held = ALL_KEYS.filter(() => R() < 0.22);
    const pressed = ALL_KEYS.filter(() => R() < 0.05);
    const dt = [1 / 30, 1 / 60, 1 / 120, 0.02, 0.05][Math.floor(R() * 5)];
    g.update(dt, input(held, pressed));
    const s = g.getState();
    checkInvariants(s, mode, previous);
    if (ended) assert.deepEqual(s, ended, 'frozen after the end');
    else if (s.phase !== 'playing') ended = s;
    if (n % 90 === 0) g.draw(mockContext());
    previous = s;
  }
  assert.ok(h.ends.length <= 1);
  assert.equal(h.ends.length, ended ? 1 : 0);
}
for (const stage of [1, 4, 9, 14, 20])
  for (const seed of [3, 41])
    test(`fuzz: solo stage ${stage} seed ${seed} keeps every invariant`, () =>
      fuzz(stage, 1, seed));
for (const seed of [3, 41, 97, 123])
  test(`fuzz: two-player seed ${seed} keeps every invariant`, () => fuzz(1, 2, seed));

test('time that is not a positive finite number changes nothing, in a duel and in the select', () => {
  const { g } = openStage(5, { start: false });
  const before = g.getState();
  for (const dt of [NaN, Infinity, -1, 0, undefined]) g.update(dt, input(['KeyD'], ['Space']));
  assert.deepEqual(g.getState(), before);
  g.update(1 / 60, input([], ['Space']));
  const playing = g.getState();
  for (const dt of [NaN, Infinity, -1, 0]) g.update(dt, input(['KeyD', 'KeyJ']));
  assert.deepEqual(g.getState(), playing);
});
