import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  createGame,
  createWorld,
  stepWorld,
  snapshot,
  shapeHitsBody,
  promptFor,
  PLAYER,
  DASH_NOW,
  ATTACKS,
  LEVEL_COUNT,
  levelOf,
  ARENA,
  PLAY_TOP,
  PLAY_BOTTOM,
  BODY,
  PROMPTS,
  FIGHTERS,
  COURTS,
  drawCourtyard,
  drawFighter,
} from '../src/games/dash-duelist.js';
import { harness, input, mockContext, seeded } from './harness.js';

const TICK = 1 / 120;
const advance = (w, seconds, inp = input()) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) stepWorld(w, TICK, inp);
};
const fresh = (seed = 1, level = 1) => createWorld(seeded(seed), level);
const FIRST = levelOf(1).rival;
const W1 = FIRST.patterns[0].steps[0].windup;
// The same path the campaign uses: a duel is won and the next level begins.
function toLevel(w, n) {
  w.level = n - 1;
  w.r = null;
  w.between = TICK;
  stepWorld(w, TICK, input());
}
// Put the world at the moment just before the rival's next windup, with chosen positions.
function setup(w, { px = 200, py = 168, rx = 250, ry = 168, pattern = 0 } = {}) {
  Object.assign(w.p, { x: px, y: py });
  Object.assign(w.r, { x: rx, y: ry, state: 'idle', gapT: 0, patternIndex: pattern, stepIndex: 0 });
}
function untilState(w, state, limit = 6, inp = input()) {
  for (let i = 0; i < limit / TICK && w.r && w.r.state !== state; i++) stepWorld(w, TICK, inp);
  return w.r && w.r.state === state;
}
const holdOnly = (...held) => input(held);
// Words drawn under a fighter: the attack name (heavy ones prefixed with !!) or the OPEN mark.
const LABELS = new Set(
  ['OPEN', '破绽'].concat(
    Object.values(ATTACKS).flatMap(({ label: [en, zh], heavy }) =>
      heavy ? [`!! ${en.toUpperCase()}`, `!! ${zh}`] : [en.toUpperCase(), zh],
    ),
  ),
);

test('meta documents bilingual copy, keys and complete touch controls', () => {
  assert.equal(meta.id, 'dash-duelist');
  assert.equal(meta.genre, 'action');
  assert.equal(meta.players, '1');
  assert.deepEqual(meta.name, { en: 'Dash Duelist', zh: '瞬步决斗' });
  assert.ok(meta.description.en.length > 80 && /[一-鿿]/.test(meta.description.zh));
  const codes = meta.touchControls.map((c) => c.code).sort();
  assert.deepEqual(codes, ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyX', 'Space']);
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh && c.side);
  assert.deepEqual(
    meta.keys.map((k) => k.keys),
    ['WASD / Arrows', 'Space', 'X', 'Arrows / Space'],
  );
});

test('a new game starts immediately with a player, a first rival and full resources', () => {
  const h = harness();
  const s = createGame(h.env).getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.level, 1);
  assert.equal(s.levelCount, LEVEL_COUNT);
  assert.equal(s.menu, null);
  assert.equal(s.rival.id, 'reed');
  assert.equal(s.player.hp, PLAYER.maxHp);
  assert.equal(s.player.charges, PLAYER.maxCharges);
  assert.equal(s.player.h, 28);
  assert.equal(s.rival.h, 28);
  assert.equal(h.ends.length, 0);
});

test('invalid or huge dt is inert and does not consume input', () => {
  const game = createGame(harness().env);
  const before = JSON.stringify(game.getState());
  for (const dt of [0, -1 / 60, NaN, Infinity, -Infinity, 5, 1.0001]) {
    game.update(dt, input(['ArrowRight'], ['Space', 'KeyX']));
    assert.equal(JSON.stringify(game.getState()), before, `dt ${dt}`);
  }
  game.update(1 / 60, input([], ['Space']));
  assert.equal(game.getState().player.state, 'strike', 'the press was not consumed by invalid dt');
});

test('state is identical at 30, 60 and 120 Hz for input aligned to 1/30 s', () => {
  const script = (i) => {
    const held = [];
    if (i < 60) held.push('ArrowRight');
    else if (i < 90) held.push('ArrowDown', 'ArrowRight');
    const pressed = [];
    if (i === 70) pressed.push('KeyX');
    if (i === 100 || i === 140) pressed.push('Space');
    if (i === 120) pressed.push('KeyX');
    return { held, pressed };
  };
  const run = (hz) => {
    const game = createGame(harness({ seed: 9 }).env);
    const frames = [];
    for (let i = 0; i < 300; i++) {
      const { held, pressed } = script(i);
      for (let k = 0; k < hz / 30; k++) game.update(1 / hz, input(held, k === 0 ? pressed : []));
      frames.push(JSON.stringify(game.getState()));
    }
    return frames;
  };
  const base = run(30);
  assert.deepEqual(run(60), base);
  assert.deepEqual(run(120), base);
});

test('the player moves in eight directions at constant speed and stays inside the arena', () => {
  const w = fresh();
  setup(w, { rx: 430, ry: 260 });
  w.r.gapT = 99;
  const x0 = w.p.x;
  advance(w, 0.5, holdOnly('ArrowRight'));
  assert.ok(Math.abs(w.p.x - x0 - PLAYER.speed * 0.5) < 1);
  const y0 = w.p.y;
  advance(w, 0.5, holdOnly('KeyD', 'KeyS'));
  const diag = Math.hypot(w.p.x - (x0 + PLAYER.speed * 0.5), w.p.y - y0);
  assert.ok(Math.abs(diag - PLAYER.speed * 0.5) < 1);
  advance(w, 8, holdOnly('ArrowLeft', 'ArrowUp'));
  assert.equal(w.p.x, ARENA.x0);
  assert.equal(w.p.y, ARENA.y0);
  advance(w, 8, holdOnly('KeyA'));
  assert.equal(w.p.x, ARENA.x0);
});

test('fighters cannot walk through each other', () => {
  const w = fresh();
  setup(w, { px: 200, rx: 240 });
  w.r.gapT = 99;
  w.r.cfg = { ...w.r.cfg, trigger: 9999, speed: 0 };
  advance(w, 1, holdOnly('ArrowRight'));
  assert.ok(w.r.x - w.p.x >= 20 - 1e-6);
});

test('Space starts exactly one strike per press; holding keys never repeats actions', () => {
  const w = fresh();
  setup(w);
  w.r.gapT = 99;
  stepWorld(w, TICK, input(['Space', 'KeyX'], []));
  advance(w, 2, holdOnly('Space', 'KeyX'));
  assert.equal(w.p.state, 'free');
  assert.equal(w.p.charges >= 3 - 1e-9, true, 'holding X spends nothing');
  stepWorld(w, TICK, input(['Space'], ['Space']));
  assert.ok(w.events.includes('strike'));
  const strikes = [];
  for (let i = 0; i < 240; i++) {
    stepWorld(w, TICK, holdOnly('Space'));
    if (w.events.includes('strike')) strikes.push(i);
  }
  assert.deepEqual(strikes, [], 'a held Space does not chain strikes');
});

test('a pressed action during recovery is buffered briefly, then dropped', () => {
  const w = fresh();
  setup(w);
  w.r.gapT = 99;
  stepWorld(w, TICK, input([], ['Space']));
  const total = PLAYER.strikeStartup + PLAYER.strikeActive + PLAYER.strikeRecover;
  advance(w, total - PLAYER.buffer / 2 - 0.02);
  stepWorld(w, TICK, input([], ['Space']));
  let again = false;
  for (let i = 0; i < 60; i++) {
    stepWorld(w, TICK, input());
    again ||= w.events.includes('strike');
  }
  assert.ok(again, 'buffered strike fires when free');
  const w2 = fresh();
  setup(w2);
  w2.r.gapT = 99;
  stepWorld(w2, TICK, input([], ['Space']));
  advance(w2, 0.1);
  stepWorld(w2, TICK, input([], ['Space']));
  let fired = false;
  for (let i = 0; i < 120; i++) {
    stepWorld(w2, TICK, input());
    fired ||= w2.events.includes('strike');
  }
  assert.equal(fired, false, 'an early press expires instead of firing late');
});

// ----------------------------------------------------------- telegraphs

const STEP_CASES = [
  ['slash', 'reed', 1, { rx: 250 }],
  ['thrust', 'mira', 3, { rx: 280 }],
  ['sweep', 'kade', 7, { rx: 250 }],
  ['bigSweep', 'kade', 10, { rx: 250, pattern: 1 }],
  ['charge', 'mira', 5, { rx: 280 }],
];
for (const [name, id, level, pos] of STEP_CASES) {
  test(`${id}: ${name} telegraph commits and the drawn shape is exactly the hit area`, () => {
    const w = fresh();
    if (level > 1) toLevel(w, level);
    assert.equal(w.r.cfg.id, id);
    setup(w, { ...pos, px: pos.rx - 50 });
    assert.ok(untilState(w, 'windup'));
    const tg = snapshot(w).rival.telegraph;
    assert.equal(tg.committed, true);
    assert.ok(tg.windup >= 0.5);
    assert.equal(tg.shape, ATTACKS[name].shape);
    // walking away does not change the committed shape
    advance(w, 0.3, holdOnly('ArrowUp'));
    const later = snapshot(w).rival.telegraph;
    for (const k of ['shape', 'ox', 'oy', 'angle', 'r1', 'half', 'len', 'hw'])
      assert.equal(later[k], tg[k], k);
    assert.ok(later.remaining < tg.remaining);
    // judge the exact same shape: players inside it are hit at the start of the active window,
    // players outside are not, for a whole grid of positions
    let inside = 0,
      outside = 0;
    for (let gx = -110; gx <= 110; gx += 22)
      for (let gy = -110; gy <= 110; gy += 22) {
        const probe = fresh(1, w.level);
        probe.r = { ...w.r, atk: { ...w.r.atk }, state: 'windup' };
        probe.p.x = Math.min(ARENA.x1, Math.max(ARENA.x0, tg.ox + gx));
        probe.p.y = Math.min(ARENA.y1, Math.max(ARENA.y0, tg.oy + gy));
        if (Math.abs(probe.p.x - probe.r.x) < 20 && Math.abs(probe.p.y - probe.r.y) < 28) continue;
        const expected = shapeHitsBody(tg, probe.p);
        probe.r.atk.t = 0.001;
        probe.r.state = 'windup';
        advance(probe, 0.12);
        const hurt = probe.stats.damageTaken > 0;
        assert.equal(hurt, expected, `${id} offset ${gx},${gy}`);
        expected ? inside++ : outside++;
      }
    // the big ring covers nearly the whole arena, so almost every probe is inside it
    assert.ok(inside > 3 && (name === 'bigSweep' || outside > 20));
  });
}

test('a chained attack re-commits its direction to where the player stands at the second windup', () => {
  const w = fresh();
  toLevel(w, 6);
  setup(w, { px: 200, py: 168, rx: 240 });
  assert.ok(untilState(w, 'windup'));
  const first = w.r.atk.angle;
  Object.assign(w.p, { x: 240, y: 100 });
  for (let i = 0; i < 3 / TICK && w.r.stepIndex === 0; i++) stepWorld(w, TICK, input());
  assert.equal(w.r.state, 'windup', 'the second strike is telegraphed at once, no hidden gap');
  assert.notEqual(w.r.atk.angle, first);
  assert.equal(w.r.stepIndex, 1);
  assert.ok(snapshot(w).rival.telegraph, 'a shape is drawn whenever a strike prompt is shown');
});

test('the rival cycle gives the stated openings: windup, active, recovery, then a gap', () => {
  const w = fresh();
  setup(w);
  const seen = [];
  let last = '';
  for (let i = 0; i < 8 / TICK && seen.length < 6; i++) {
    stepWorld(w, TICK, input());
    if (w.r.state !== last) seen.push([w.r.state, w.time]);
    last = w.r.state;
    w.p.hitInv = 99;
  }
  assert.deepEqual(seen.map((s) => s[0]).slice(0, 5), [
    'idle',
    'windup',
    'active',
    'recover',
    'idle',
  ]);
  const dur = (i) => seen[i + 1][1] - seen[i][1];
  assert.ok(Math.abs(dur(1) - W1) < 0.02);
  assert.ok(Math.abs(dur(2) - ATTACKS.slash.active) < 0.02);
  assert.ok(Math.abs(dur(3) - FIRST.patterns[0].recover) < 0.02);
});

// --------------------------------------------------------- recovery windows

function inRange(w) {
  Object.assign(w.p, { x: 200, y: 168 });
  Object.assign(w.r, { x: 236, y: 168 });
}

test('strikes only hurt a rival in its recovery window; guarded strikes say so', () => {
  const w = fresh();
  setup(w, { px: 200, rx: 236 });
  w.r.gapT = 99;
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.3);
  assert.equal(w.r.hp, FIRST.hp, 'idle rival is guarded');
  assert.ok(snapshot(w).status.en.includes('Guarded'));
  assert.equal(snapshot(w).rival.vulnerable, false);
  // windup is guarded too
  const w2 = fresh();
  setup(w2, { px: 200, rx: 236 });
  assert.ok(untilState(w2, 'windup'));
  w2.p.hitInv = 99;
  stepWorld(w2, TICK, input([], ['Space']));
  advance(w2, 0.3);
  assert.equal(w2.r.hp, FIRST.hp);
  // recovery is open
  const w3 = fresh();
  setup(w3, { px: 200, rx: 236 });
  w3.r.state = 'recover';
  w3.r.t = 1.1;
  w3.r.atk = null;
  stepWorld(w3, TICK, input([], ['Space']));
  advance(w3, 0.25);
  assert.equal(w3.r.hp, FIRST.hp - 1);
  assert.equal(w3.stats.hits, 1);
  assert.ok(w3.score >= 50);
});

test('one swing hurts at most once and the opening has a stated length', () => {
  const w = fresh();
  setup(w, { px: 200, rx: 236 });
  assert.ok(untilState(w, 'recover'));
  const open = snapshot(w).rival;
  assert.equal(open.vulnerable, true);
  assert.ok(Math.abs(open.recoverRemaining - FIRST.patterns[0].recover) < 0.02);
  w.p.hitInv = 99;
  inRange(w);
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.4);
  assert.equal(w.r.hp, FIRST.hp - 1);
  advance(w, 5, input());
  assert.ok(w.r.state !== 'recover');
});

test('the opening closes: a strike after recovery ends is guarded', () => {
  const w = fresh();
  setup(w, { px: 200, rx: 236 });
  w.r.state = 'recover';
  w.r.t = 0.05;
  w.r.atk = null;
  w.r.cfg = { ...w.r.cfg, gap: 5 };
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.3);
  assert.equal(w.r.hp, FIRST.hp);
});

// --------------------------------------------------------------- dash

test('dash spends one of three charges, recharges visibly, and refuses at zero', () => {
  const w = fresh();
  setup(w, { rx: 400 });
  w.r.gapT = 99;
  w.r.cfg = { ...w.r.cfg, trigger: 9999, speed: 0 };
  stepWorld(w, TICK, input(['ArrowDown'], ['KeyX']));
  let s = snapshot(w);
  assert.equal(s.player.charges, 2);
  assert.ok(w.events.includes('dash'));
  advance(w, 0.5);
  s = snapshot(w);
  assert.equal(s.player.charges, 2);
  assert.ok(s.player.chargeProgress > 0.15 && s.player.chargeProgress < 0.35);
  w.p.charges = 0.5;
  stepWorld(w, TICK, input([], ['KeyX']));
  assert.ok(snapshot(w).status.en.includes('No dash charge'));
  assert.notEqual(w.p.state, 'dash');
  w.p.charges = 0;
  advance(w, PLAYER.rechargeTime + 0.05);
  assert.equal(snapshot(w).player.charges, 1);
  advance(w, 60);
  assert.equal(snapshot(w).player.charges, PLAYER.maxCharges);
});

test('dash moves the stated distance in the held direction, or backs away from the rival', () => {
  const w = fresh();
  setup(w, { px: 240, py: 160, rx: 300 });
  w.r.gapT = 99;
  w.r.cfg = { ...w.r.cfg, trigger: 9999, speed: 0 };
  const x0 = w.p.x;
  stepWorld(w, TICK, input(['ArrowLeft'], ['KeyX']));
  advance(w, PLAYER.dashTime + 0.05);
  assert.ok(Math.abs(x0 - w.p.x - PLAYER.dashSpeed * PLAYER.dashTime) < 6);
  const w2 = fresh();
  setup(w2, { px: 240, py: 160, rx: 300, ry: 160 });
  w2.r.gapT = 99;
  w2.r.cfg = { ...w2.r.cfg, trigger: 9999, speed: 0 };
  stepWorld(w2, TICK, input([], ['KeyX']));
  advance(w2, 0.4);
  assert.ok(w2.p.x < 240 - 50, 'backstep when no direction is held');
});

test('dash invulnerability is bounded: it blocks the hit inside the window and not after', () => {
  const make = () => {
    const w = fresh();
    setup(w, { px: 240, rx: 280 });
    assert.ok(untilState(w, 'windup'));
    return w;
  };
  // hit lands normally with no dash
  const hit = make();
  advance(hit, 1.2);
  assert.equal(hit.stats.damageTaken, 1);
  // dashing in place into the active window: no damage while invulnerable
  const safe = make();
  advance(safe, W1 - 0.1);
  safe.p.dashInv = PLAYER.dashInvuln;
  safe.p.state = 'free';
  advance(safe, 0.12);
  assert.equal(safe.stats.damageTaken, 0);
  assert.ok(safe.r.atk.dodged);
  // invulnerability that expires before the active window ends no longer protects
  const late = make();
  advance(late, W1 - 0.01);
  late.p.dashInv = 0.04;
  advance(late, 0.2);
  assert.equal(late.stats.damageTaken, 1);
  assert.ok(PLAYER.dashInvuln <= 0.4 && PLAYER.dashInvuln <= PLAYER.dashTime + 0.1);
});

test('dashing through a committed attack scores a dodge and takes no damage', () => {
  const w = fresh();
  setup(w, { px: 240, rx: 280 });
  assert.ok(untilState(w, 'windup'));
  advance(w, W1 - 0.1);
  const score = w.score;
  stepWorld(w, TICK, input(['ArrowDown'], ['KeyX']));
  advance(w, 0.4);
  assert.equal(w.stats.damageTaken, 0);
  assert.equal(w.stats.dodges, 1);
  assert.equal(w.score, score + 25);
});

test('a dash cannot pass through the rival', () => {
  const w = fresh();
  setup(w, { px: 240, py: 168, rx: 270, ry: 168 });
  w.r.gapT = 99;
  w.r.cfg = { ...w.r.cfg, trigger: 9999, speed: 0 };
  stepWorld(w, TICK, input(['ArrowRight'], ['KeyX']));
  advance(w, 0.4);
  assert.ok(w.p.x <= w.r.x - 20 + 1e-6);
});

// ------------------------------------------------ hit ordering and damage

test('hit stun and post-hit invulnerability limit damage to one hit per window', () => {
  const w = fresh();
  setup(w, { px: 240, rx: 280 });
  assert.ok(untilState(w, 'windup'));
  advance(w, 1.2);
  assert.equal(w.p.hp, PLAYER.maxHp - 1);
  assert.ok(w.p.hitInv <= PLAYER.hitInvuln);
  assert.ok(snapshot(w).status.en.includes('Hit! -1 HP'));
  assert.ok(snapshot(w).status.zh.includes('被击中'));
});

test('a hit is knocked back, stuns briefly and cancels the swing', () => {
  const w = fresh();
  setup(w, { px: 240, rx: 280 });
  assert.ok(untilState(w, 'windup'));
  stepWorld(w, TICK, input([], ['Space']));
  assert.equal(w.p.state, 'strike');
  advance(w, W1 + 0.01);
  assert.equal(w.p.state === 'stagger' || w.p.state === 'free', true);
  assert.ok(w.p.x < 240 || w.p.hitInv > 0);
});

test('an attacking rival is guarded and an open rival is harmless, so damage never trades in one tick', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const w = fresh(seed);
    const rnd = seeded(seed * 5);
    let prevHp = w.p.hp,
      prevRival = w.r.hp;
    for (let i = 0; i < 120 * 90 && w.phase === 'playing'; i++) {
      const held = rnd() < 0.5 ? ['ArrowLeft'] : ['ArrowRight', 'ArrowUp'];
      stepWorld(w, TICK, input(held, rnd() < 0.05 ? ['Space'] : []));
      if (!w.r) break;
      const playerHit = w.p.hp < prevHp,
        rivalHit = w.r.hp < prevRival;
      assert.ok(!(playerHit && rivalHit), 'no same-tick trade');
      if (rivalHit) assert.ok(['recover'].includes(w.r.state) || w.r.hp <= 0);
      prevHp = w.p.hp;
      prevRival = w.r.hp;
    }
  }
});

test('a lethal hit on the player ends the duel as a loss even if the rival is also on 1 HP', () => {
  const w = fresh();
  setup(w, { px: 240, rx: 280 });
  assert.ok(untilState(w, 'windup'));
  Object.assign(w.p, { hp: 1 });
  w.r.hp = 1;
  advance(w, 1.2);
  assert.equal(w.phase, 'lost');
  assert.equal(w.r.hp, 1, 'the dead player cannot also land a hit');
});

test('the player dies first when a lethal rival hit and a later strike would both happen', () => {
  const w = fresh();
  setup(w, { px: 240, rx: 280 });
  assert.ok(untilState(w, 'windup'));
  w.p.hp = 1;
  advance(w, 1.2);
  assert.equal(w.phase, 'lost');
  assert.equal(w.p.hp, 0);
  const frozen = JSON.stringify(snapshot(w));
  advance(w, 1, holdOnly('ArrowRight'));
  assert.equal(JSON.stringify(snapshot(w)), frozen);
});

// -------------------------------------------------------- campaign flow

function defeatCurrent(w) {
  const r = w.r;
  r.state = 'recover';
  r.t = 5;
  r.atk = null;
  r.hp = 1;
  Object.assign(w.p, { x: r.x - 36, y: r.y });
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.3);
}

test('winning a level restores HP and dashes, then the next level steps in', () => {
  const w = fresh();
  w.p.hp = 2;
  w.p.charges = 0;
  defeatCurrent(w);
  assert.equal(w.r, null);
  assert.ok(w.between > 0);
  const mid = snapshot(w);
  assert.equal(mid.rival, null);
  assert.equal(mid.prompt.en, PROMPTS.between[0]);
  assert.ok(mid.status.en.startsWith('Level 1/20 won'));
  assert.ok(w.score >= 300);
  advance(w, 1.7);
  assert.equal(w.level, 2);
  assert.equal(w.r.cfg.id, levelOf(2).rival.id);
  assert.equal(w.r.state, 'enter');
  assert.equal(w.p.hp, PLAYER.maxHp);
  assert.equal(w.p.charges, PLAYER.maxCharges);
  assert.equal(snapshot(w).prompt.en, PROMPTS.enter[0]);
  assert.equal(snapshot(w).tip.visible, true);
  assert.deepEqual(snapshot(w).levelName, levelOf(2).name);
  advance(w, 2.05);
  assert.notEqual(w.r.state, 'enter');
});

test('winning the final duel freezes the world and scores the remaining HP', () => {
  const w = fresh(1, LEVEL_COUNT);
  w.p.hp = 3;
  defeatCurrent(w);
  assert.equal(w.phase, 'won');
  assert.ok(w.score >= 300 + 100 * 3);
  const frozen = JSON.stringify(snapshot(w));
  advance(w, 2, input(['ArrowRight'], ['Space', 'KeyX']));
  assert.equal(JSON.stringify(snapshot(w)), frozen);
  assert.equal(snapshot(w).status.en.endsWith(PROMPTS.won[0]), true);
});

test('the opening closes after one clean hit, so one opening is worth one point of damage', () => {
  const w = fresh(1, 3);
  setup(w, { px: 200, rx: 236 });
  w.r.state = 'recover';
  w.r.t = 5;
  w.r.atk = null;
  w.p.hitInv = 99;
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.25);
  assert.equal(w.r.hp, levelOf(3).rival.hp - 1);
  advance(w, 0.1);
  assert.equal(snapshot(w).rival.vulnerable, false, 'the rival guards again');
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.6);
  assert.equal(w.r.hp, levelOf(3).rival.hp - 1);
});

test('a passive player loses fairly: one HP per rival hit, one terminal callback', () => {
  const h = harness({ seed: 2 });
  const game = createGame(h.env);
  const hpSeen = new Set();
  for (let i = 0; i < 60 * 120 && game.getState().phase === 'playing'; i++) {
    game.update(1 / 60, input());
    hpSeen.add(game.getState().player.hp);
  }
  assert.equal(game.getState().phase, 'lost');
  assert.deepEqual([...hpSeen].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  assert.ok(h.sounds.includes('lose'));
  assert.ok(game.getState().status.en.endsWith(PROMPTS.lost[0]));
});

// ----------------------------------------------------------- status text

test('status is a bilingual string with rival, HP, dash, transient events and a prompt', () => {
  const w = fresh();
  const s0 = snapshot(w);
  assert.equal(typeof s0.status.en, 'string');
  assert.equal(typeof s0.status.zh, 'string');
  assert.equal(s0.status.en, 'Level 1/20 · HP 5 · Dash 3 · Arrows move · Space strike · X dash');
  assert.ok(s0.status.zh.startsWith('第1/20关 · 生命 5 · 闪身 3'));
  setup(w, { px: 200, rx: 236 });
  assert.ok(untilState(w, 'windup'));
  const danger = snapshot(w);
  assert.match(danger.prompt.en, /^Slash from the (Left|Right|Up|Down)! Sidestep or X: dash$/);
  assert.match(danger.prompt.zh, /^斩击来自.+！侧移或按X闪身$/);
  w.p.charges = 0.2;
  w.r.state = 'idle';
  w.r.gapT = 0;
  assert.ok(untilState(w, 'windup'));
  assert.ok(snapshot(w).prompt.en.endsWith('No dash: sidestep!'));
  // transient messages appear and then clear
  w.r.state = 'recover';
  w.r.t = 5;
  w.r.atk = null;
  inRange(w);
  w.p.state = 'free';
  stepWorld(w, TICK, input([], ['Space']));
  advance(w, 0.2);
  assert.ok(snapshot(w).status.en.includes('Rival staggered! -1'));
  assert.ok(snapshot(w).status.zh.includes('对手踉跄'));
  assert.ok(snapshot(w).status.en.endsWith(PROMPTS.open[0]));
  advance(w, 1);
  assert.ok(!snapshot(w).status.en.includes('staggered'));
});

test('ring, lane and sector prompts name the source side and keys', () => {
  for (const [id, level, pattern, rx, re] of [
    ['mira', 3, 0, 280, /^Thrust from the \w+! Sidestep or X: dash$/],
    ['kade', 7, 0, 250, /^Ring sweep! Run out or X: dash$/],
    ['kade', 10, 1, 250, /^HEAVY ring sweep! Wait for the fill$/],
    ['mira', 5, 0, 280, /^HEAVY charge from the \w+! Wait for the fill$/],
    ['kade', 6, 0, 250, /^Cut from the \w+! Sidestep or X: dash$/],
  ]) {
    const w = fresh();
    toLevel(w, level);
    assert.equal(w.r.cfg.id, id);
    setup(w, { px: rx - 50, rx, pattern });
    assert.ok(untilState(w, 'windup'));
    assert.match(snapshot(w).prompt.en, re);
    assert.match(promptFor(w)[1], /斩击|劈砍|突刺|环形横扫|冲锋/);
  }
  for (const [px, py, side] of [
    [200, 168, 'Right'],
    [300, 168, 'Left'],
    [250, 100, 'Down'],
    [250, 230, 'Up'],
  ]) {
    const w = fresh();
    setup(w, { px, py, rx: 250, ry: 168 + (px === 250 ? (py < 168 ? 0 : 0) : 0) });
    if (px === 250) w.p.x = 250;
    assert.ok(untilState(w, 'windup'));
    const m = snapshot(w).prompt.en.match(/from the (\w+)/);
    assert.ok(m, snapshot(w).prompt.en);
    assert.ok(['Left', 'Right', 'Up', 'Down'].includes(m[1]), side);
  }
});

// ------------------------------------------------------------- rendering

function recordingContext() {
  const calls = { text: [], rects: [], fonts: new Set() };
  const base = mockContext();
  const ctx = new Proxy(base, {
    get(t, p) {
      if (p === 'fillText') return (str, x, y) => calls.text.push({ str, x, y, font: t.font });
      if (p === 'fillRect')
        return (x, y, w, h) => calls.rects.push({ x, y, w, h, fill: t.fillStyle });
      return t[p];
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
  return { ctx, calls };
}

test('draw works in early, telegraph, recovery, intermission and terminal states in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ seed: 3, lang });
    const game = createGame(h.env);
    const ctx = mockContext();
    game.draw(ctx);
    for (let i = 0; i < 60 * 40; i++) {
      game.update(
        1 / 60,
        input(i % 90 < 45 ? ['ArrowRight'] : ['ArrowLeft'], i % 50 === 0 ? ['Space'] : []),
      );
      if (i % 20 === 0) game.draw(ctx);
    }
    game.draw(ctx);
  }
});

test('text is 14-16 px, HUD text stays in the HUD bands and fighters stay between them', () => {
  const h = harness({ seed: 6 });
  const game = createGame(h.env);
  const { ctx, calls } = recordingContext();
  let sawTelegraph = false;
  for (let i = 0; i < 60 * 30; i++) {
    const s = game.getState();
    if (s.rival && s.rival.telegraph) sawTelegraph = true;
    game.update(
      1 / 60,
      input(i % 120 < 60 ? ['ArrowUp'] : ['ArrowDown'], i % 40 === 0 ? ['Space'] : []),
    );
    if (i % 15 === 0) game.draw(ctx);
    const b = [s.player, s.rival].filter(Boolean);
    for (const f of b) assert.ok(f.y - f.h / 2 >= PLAY_TOP && f.y + f.h / 2 <= PLAY_BOTTOM);
  }
  assert.ok(sawTelegraph);
  assert.ok(calls.text.length > 20);
  for (const t of calls.text) {
    const size = Number(/(\d+)px/.exec(t.font)[1]);
    assert.ok(size >= 14 && size <= 16, `${t.str} ${size}px`);
    const hud = t.y + size <= PLAY_TOP + 1 || t.y >= PLAY_BOTTOM;
    const banner = t.y >= PLAY_TOP && t.y + size <= ARENA.y0 - BODY.hh;
    const marker = t.str === '!' || t.str === '!!' || LABELS.has(t.str);
    assert.ok(hud || banner || marker, `${t.str} at y=${t.y}`);
    assert.ok(t.str.length * size * 0.62 <= 480 || t.y < PLAY_TOP, `${t.str} fits`);
  }
  // the bottom prompt (essential) never sits under the band edge or past the canvas
  const prompts = calls.text.filter((t) => t.y >= PLAY_BOTTOM);
  assert.ok(prompts.length > 0);
  for (const p of prompts) assert.ok(p.y + 16 <= 320);
  // sprite pixels are painted between the bands (fighter art 20x28 at 2x scale)
  const hudBandPaint = calls.rects.filter(
    (r) => r.w === 2 && r.h === 2 && (r.y < PLAY_TOP - 1 || r.y > PLAY_BOTTOM),
  );
  assert.equal(hudBandPaint.length, 0);
});

test('Chinese prompts and English prompts fit the canvas width', () => {
  const all = [...Object.values(PROMPTS)];
  for (const [en, zh] of all) {
    assert.ok(en.length * 16 * 0.62 <= 480, en);
    assert.ok(zh.length * 16 <= 480, zh);
  }
});

// ------------------------------------------------------- seeded stress

for (const hz of [30, 60, 120]) {
  test(`seeded random play at ${hz} Hz stays finite and bounded`, () => {
    for (let seed = 1; seed <= 8; seed++) {
      const h = harness({ seed });
      const game = createGame(h.env);
      const rnd = seeded(seed * 17);
      const codes = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
      ];
      let held = [];
      for (let i = 0; i < hz * 120; i++) {
        if (i % Math.round(hz / 6) === 0) {
          held = codes.filter(() => rnd() < 0.25);
        }
        const pressed = [];
        if (rnd() < 0.04) pressed.push('Space');
        if (rnd() < 0.02) pressed.push('KeyX');
        game.update(1 / hz, input(held, pressed));
        const s = game.getState();
        for (const v of [s.score, s.time, s.player.x, s.player.y, s.player.hp, s.player.charges])
          assert.ok(Number.isFinite(v));
        assert.ok(s.player.x >= ARENA.x0 && s.player.x <= ARENA.x1);
        assert.ok(s.player.y >= ARENA.y0 && s.player.y <= ARENA.y1);
        assert.ok(s.player.hp >= 0 && s.player.hp <= PLAYER.maxHp);
        assert.ok(s.player.charges >= 0 && s.player.charges <= PLAYER.maxCharges);
        if (s.rival) {
          assert.ok(s.rival.hp >= 0);
          assert.ok(s.rival.x >= ARENA.x0 && s.rival.x <= ARENA.x1);
        }
        if (s.phase !== 'playing') break;
      }
      assert.ok(h.ends.length <= 1);
    }
  });
}

test('sound events map to allowed host sounds', () => {
  const allowed = new Set(['coin', 'hit', 'shoot', 'win', 'lose', 'move']);
  const h = harness({ seed: 2 });
  const game = createGame(h.env);
  for (let i = 0; i < 60 * 60 && game.getState().phase === 'playing'; i++)
    game.update(1 / 60, input(['ArrowRight'], i % 30 === 0 ? ['Space', 'KeyX'] : []));
  assert.ok(h.sounds.length > 0);
  for (const s of h.sounds) assert.ok(allowed.has(s), s);
});

// ------------------------------------------------- presentation

const logCalls = () => {
  const log = [];
  const ctx = new Proxy(mockContext(), {
    get: (t, p) => (typeof t[p] === 'function' || !(p in t) ? (...a) => log.push([p, ...a]) : t[p]),
    set: (t, p, v) => {
      log.push(['set', p, v]);
      t[p] = v;
      return true;
    },
  });
  return { ctx, log: () => JSON.stringify(log) };
};

test('fighter art is 10x14 at 2x, matching the 20x28 collider, with a distinct silhouette each', () => {
  const masks = Object.entries(FIGHTERS).map(([id, f]) => {
    assert.equal(f.rows.length, 14, id);
    for (const row of f.rows) assert.equal(row.length, 10, id);
    return f.rows.map((r) => r.replace(/[^.]/g, '#')).join('/');
  });
  assert.equal(new Set(masks).size, masks.length);
  const s = snapshot(fresh());
  assert.deepEqual([s.player.w, s.player.h, s.rival.w, s.rival.h], [20, 28, 20, 28]);
});

test('each rival has its own weapon and every pose draws something different', () => {
  const draw = (kind, pose) => {
    const c = logCalls();
    drawFighter(c.ctx, kind, { x: 200, y: 150 }, 0, pose);
    return c.log();
  };
  for (const kind of ['player', 'reed', 'mira', 'kade']) {
    const poses = ['idle', 'windup', 'active', 'recover'].map((p) => draw(kind, p));
    assert.equal(new Set(poses).size, 4, `${kind} poses differ`);
  }
  const idle = ['reed', 'mira', 'kade'].map((k) => draw(k, 'active'));
  assert.equal(new Set(idle).size, 3);
  assert.ok(draw('mira', 'active').includes('closePath'), 'the spear has a head');
});

test('each tier fights in its own courtyard', () => {
  const courts = [1, 8, 15].map((n) => levelOf(n).court);
  assert.equal(new Set(courts).size, 3);
  const frames = courts.map((i) => {
    const c = logCalls();
    drawCourtyard(c.ctx, 0, i);
    return c.log();
  });
  assert.equal(COURTS.length, 3);
  assert.equal(new Set(frames).size, 3);
  assert.equal(new Set(COURTS.map((c) => c.floor.join())).size, 3);
});

test('the HUD labels the rival, you and the dash pips in both languages', () => {
  for (const [lang, labels] of [
    ['en', ['1/20 Reed', 'You', 'Dash']],
    ['zh', ['1/20 芦苇', '你', '闪身']],
  ]) {
    const game = createGame(harness({ lang }).env);
    const { ctx, calls } = recordingContext();
    game.draw(ctx);
    const drawn = calls.text.map((t) => t.str);
    for (const label of labels) assert.ok(drawn.includes(label), `${lang}: ${label}`);
  }
});

test('the dash hint in the danger prompt follows the live charge count', () => {
  const w = fresh();
  setup(w, { px: 200, rx: 236 });
  assert.ok(untilState(w, 'windup'));
  assert.ok(snapshot(w).status.en.includes('Dash 3'));
  assert.ok(snapshot(w).status.en.endsWith('or X: dash'));
  w.p.charges = 0.2;
  const s = snapshot(w);
  assert.ok(s.status.en.includes('Dash 0') && s.status.en.endsWith('No dash: sidestep!'));
  assert.ok(s.status.zh.includes('闪身 0') && s.status.zh.endsWith('无闪身：请侧移！'));
});

test('a strike prompt is only shown while its shape is drawn', () => {
  for (const seed of [1, 2, 3]) {
    const w = fresh(seed);
    toLevel(w, 10);
    w.p.hitInv = 1e9;
    for (let i = 0; i < 120 * 40; i++) {
      stepWorld(w, TICK, input(i % 200 < 100 ? ['ArrowLeft'] : ['ArrowRight']));
      const s = snapshot(w);
      const striking = /^(Slash|Cut|Thrust|Ring|HEAVY)/.test(s.prompt.en);
      assert.equal(striking, !!(s.rival && s.rival.telegraph), `${s.prompt.en} @${w.time}`);
    }
  }
});

test('heavy attacks cost 3 HP, are drawn as heavy, and a dash on sight carries out of the big ring', () => {
  for (const name of ['charge', 'bigSweep']) {
    assert.equal(ATTACKS[name].heavy, true);
    assert.ok(ATTACKS[name].windup >= 0.6, 'still a human-reactable telegraph');
  }
  // from the distance the rival strikes at, one dash on sight leaves the big ring
  const gap = ATTACKS.bigSweep.r1 + BODY.hw + BODY.hh - levelOf(10).rival.trigger;
  assert.ok(gap < PLAYER.dashSpeed * PLAYER.dashTime);
  const w = fresh();
  toLevel(w, 10);
  setup(w, { px: 200, rx: 250, pattern: 1 });
  assert.ok(untilState(w, 'windup'));
  const tg = snapshot(w).rival.telegraph;
  assert.equal(tg.heavy, true);
  const hp = w.p.hp;
  advance(w, 1.2);
  assert.equal(w.p.hp, hp - 3);
  assert.ok(snapshot(w).status.en.includes('Hit! -3 HP'));
  assert.ok(w.stats.damageTaken === 3);
  // a normal slash is not flagged heavy
  const n = fresh();
  setup(n, { px: 200, rx: 236 });
  assert.ok(untilState(n, 'windup'));
  assert.equal(snapshot(n).rival.telegraph.heavy, false);
});

test('without charges the heavy prompt says to run, in both languages', () => {
  const w = fresh();
  toLevel(w, 10);
  setup(w, { px: 200, rx: 250, pattern: 1 });
  w.p.charges = 0;
  assert.ok(untilState(w, 'windup'));
  const s = snapshot(w);
  assert.ok(s.prompt.en.endsWith('No dash: run!'));
  assert.ok(s.prompt.zh.endsWith('无闪身：快跑！'));
  assert.ok(s.prompt.en.length <= 46 && s.prompt.zh.length <= 26);
});

test('a run that never dashes cannot survive two heavy hits from Kade', () => {
  const w = fresh();
  toLevel(w, 10);
  setup(w, { px: 200, rx: 250, pattern: 1 });
  assert.ok(untilState(w, 'windup'));
  advance(w, 1.2);
  assert.equal(w.phase, 'playing');
  assert.equal(w.p.hp, PLAYER.maxHp - 3);
  w.p.hitInv = 0;
  Object.assign(w.r, { state: 'idle', gapT: 0, patternIndex: 1, atk: null });
  assert.ok(untilState(w, 'windup'));
  advance(w, 1.2);
  assert.equal(w.phase, 'lost');
});

test('a heavy shape says wait, then dash NOW, so even a slow press still covers the hit', () => {
  for (const [level, pattern, rx] of [
    [10, 1, 250],
    [5, 0, 280],
  ]) {
    for (const delay of [0.2, 0.25, 0.35, 0.42, 0.48]) {
      const w = fresh();
      toLevel(w, level);
      setup(w, { px: rx - 50, rx, pattern });
      assert.ok(untilState(w, 'windup'));
      const early = snapshot(w).prompt;
      assert.ok(early.en.endsWith('Wait for the fill') && early.zh.endsWith('等待填满'));
      let now = null;
      for (let i = 0; i < 2 / TICK && !now; i++) {
        stepWorld(w, TICK, input());
        if (snapshot(w).prompt.en.endsWith('X: dash NOW!')) now = snapshot(w).prompt;
      }
      assert.ok(now && now.zh.endsWith('现在按X闪身！'));
      assert.ok(Math.abs(w.r.atk.t - DASH_NOW) < 0.02, `flips at ${w.r.atk.t}`);
      const control = fresh();
      toLevel(control, level);
      setup(control, { px: rx - 50, rx, pattern });
      assert.ok(untilState(control, 'windup'));
      advance(control, 1.5);
      assert.equal(control.stats.damageTaken, 3, 'without a dash the shape lands');
      advance(w, delay);
      stepWorld(w, TICK, input([], ['KeyX']));
      advance(w, 1.2);
      assert.equal(w.stats.damageTaken, 0, `level ${level} pressed ${delay} s after the prompt`);
    }
  }
  const out = fresh();
  toLevel(out, 10);
  setup(out, { px: 200, rx: 250, pattern: 1 });
  assert.ok(untilState(out, 'windup'));
  advance(out, 0.95);
  assert.equal(snapshot(out).prompt.en, 'HEAVY ring sweep! X: dash NOW!');
});
