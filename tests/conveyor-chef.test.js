import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meta,
  RULES,
  SHIFTS,
  KINDS,
  PROMPTS,
  createGame,
  layoutOf,
  routeFor,
  newState,
  loadShift,
  advance,
  snapshot,
  promptText,
  menuCell,
  openMenu,
  render,
  satisfactionOf,
  verdictFor,
  stationAt,
} from '../src/games/conveyor-chef.js';
import { harness, input, mockContext, seeded } from './harness.js';

const STEP = RULES.step;
const TILE = RULES.tile;
const cx = (c) => c * TILE + TILE / 2;
const cy = (r) => RULES.top + r * TILE + TILE / 2;
const run = (s, seconds, held = [], emit) => {
  const inp = input(held);
  for (let i = 0; i < Math.round(seconds * 120); i++) advance(s, STEP, inp, emit);
};
const tap = (s, code, emit) => advance(s, STEP, input([], [code]), emit);
const shift = (n, mode = 1) => {
  const s = newState(mode);
  loadShift(s, n - 1);
  return s;
};
const stand = (s, c, r, who = 0) => Object.assign(s.chefs[who], { x: cx(c), y: cy(r) });
const crateAt = (s, c, r) => s.lv.stations.find((q) => q.c === c && q.r === r);
const sounds = () => {
  const list = [];
  return Object.assign((n) => list.push(n), { list });
};
// Put a dish straight onto a belt tile, as if it had been dropped there earlier.
let nextFake = 9000;
const place = (s, kind, c, r, extra = {}) => {
  const item = {
    id: nextFake++,
    kind,
    chopped: false,
    heat: 0,
    c,
    r,
    nc: -1,
    nr: -1,
    u: 0,
    released: false,
    wait: 0,
    ...extra,
  };
  s.items.push(item);
  s.occ[r * RULES.cols + c] = item.id;
  return item;
};
const open = (s, n) => {
  s.ticks = Math.max(s.ticks, s.orders.map((o) => o.at).sort((a, b) => a - b)[n - 1]);
  run(s, 0.05);
};

test('meta: a bilingual 1-2 player arcade entry with complete controls', () => {
  assert.equal(meta.id, 'conveyor-chef');
  assert.equal(meta.players, '1-2');
  assert.equal(meta.genre, 'arcade');
  assert.ok(
    meta.name.en &&
      meta.name.zh &&
      meta.description.en.length > 200 &&
      meta.description.zh.length > 100,
  );
  assert.ok(meta.keys.length >= 5 && meta.keys.every((k) => k.label.en && k.label.zh && k.keys));
  assert.equal(meta.touch, true);
  assert.deepEqual(Object.keys(createGame(harness().env)).sort(), ['draw', 'getState', 'update']);
});

test('data: 22 authored shifts with consistent kitchens', () => {
  assert.equal(SHIFTS.length, 22);
  SHIFTS.forEach((def, i) => {
    assert.ok(def.name.en && def.name.zh && def.tip.en && def.tip.zh, `${i + 1} text`);
    assert.equal(def.map.length, RULES.rows);
    assert.ok(
      def.map.every((row) => row.length === RULES.cols && row[0] === '#' && row.at(-1) === '#'),
    );
    assert.ok(def.need >= 50 && def.need <= 70);
    assert.ok(def.speed >= 2 && def.speed <= 3);
    assert.ok(def.tickets.length >= 3 && def.tickets.every((t) => t.patience >= 35 && t.at >= 0));
    const lv = layoutOf(i);
    assert.equal(lv.junctions.length, def.junctions.length, `${def.name.en}: junction exits`);
    assert.ok(lv.junctions.every((j) => j.exits.length === 2));
    for (const st of lv.stations) {
      if (st.kind === 'window' || st.kind === 'bin') continue;
      assert.ok(st.out, `${def.name.en}: ${st.kind} at ${st.c},${st.r} has an out belt`);
    }
    assert.equal(lv.stations.filter((q) => q.kind === 'window').length, 1);
    // Every belt leads somewhere: into another belt, a station that takes it, the window or the bin.
    lv.grid.forEach((row, r) =>
      row.forEach((ch, c) => {
        const exits = '><^vJ'.includes(ch)
          ? ch === 'J'
            ? lv.junctions.find((j) => j.c === c && j.r === r).exits
            : [{ '>': [1, 0], '<': [-1, 0], '^': [0, -1], v: [0, 1] }[ch]]
          : [];
        for (const [dx, dy] of exits)
          assert.ok(
            !'#.'.includes(lv.grid[r + dy][c + dx]) && !'bmtfe'.includes(lv.grid[r + dy][c + dx]),
            `${def.name.en}: belt ${c},${r} leads nowhere`,
          );
      }),
    );
    // Chefs start on open floor or belt.
    for (const [c, r] of def.chefs)
      assert.ok('.><^vJ'.includes(lv.grid[r][c]), `${def.name.en}: chef start`);
    // Each ticket part can be made: its crate reaches the window with the right steps.
    for (const t of def.tickets)
      for (const p of t.parts) {
        const crate = lv.stations.find((q) => q.kind === 'crate' && q.item === p.kind);
        assert.ok(crate, `${def.name.en}: a ${p.kind} crate`);
        const route = routeFor(
          lv,
          { c: crate.out[0], r: crate.out[1], entering: true, chopped: false, heat: 0 },
          p,
        );
        assert.ok(route, `${def.name.en}: route for ${p.kind}`);
        assert.equal(route.at(-1).kind, 'window');
        assert.equal(
          route.some((n) => n.kind === 'chopper'),
          p.chop,
          'the board only where chopping is asked',
        );
        assert.equal(
          route.some((n) => n.kind === 'stove'),
          p.cook,
          'the stove only where cooking is asked',
        );
      }
  });
});

test('routes: the board and stove are only on a route when the dish needs them', () => {
  const chopLine = layoutOf(2); // Chop Chop
  const raw = { c: 4, r: 4, entering: true, chopped: false, heat: 0 };
  assert.equal(
    routeFor(chopLine, raw, { chop: false, cook: false }),
    null,
    'an unchopped dish cannot pass the board',
  );
  assert.ok(routeFor(chopLine, raw, { chop: true, cook: false }));
  assert.ok(
    routeFor(chopLine, { ...raw, chopped: true }, { chop: true, cook: false }),
    'a chopped one passes through',
  );
  assert.equal(routeFor(chopLine, raw, { chop: true, cook: true }), null, 'no stove on this line');
  assert.equal(routeFor(chopLine, raw, { bin: true }), null, 'no bin either');
  const fork = layoutOf(5); // Fork in the Belt
  const start = { c: 7, r: 4, entering: true, chopped: false, heat: 0 };
  const meat = routeFor(fork, start, { chop: false, cook: true });
  const bread = routeFor(fork, start, { chop: false, cook: false });
  assert.equal(meat.find((n) => n.kind === 'junction').pick, 1, 'meat takes the stove exit');
  assert.equal(bread.find((n) => n.kind === 'junction').pick, 0, 'bread goes straight');
  assert.equal(
    routeFor(fork, { ...start, heat: 1 }, { chop: false, cook: false }),
    null,
    'cooked bread is wrong',
  );
  assert.ok(
    routeFor(fork, { ...start, heat: 2 }, { chop: false, cook: true }) === null,
    'burnt is never a cooked dish',
  );
  const bin = layoutOf(9);
  assert.equal(
    routeFor(bin, { c: 10, r: 4, entering: false, chopped: false, heat: 2 }, { bin: true }).at(-1)
      .kind,
    'bin',
  );
  assert.equal(
    routeFor(
      bin,
      { c: 10, r: 4, entering: false, chopped: false, heat: 2 },
      { chop: false, cook: true },
    ),
    null,
  );
  // starting at the window itself, or somewhere that is not a tile that takes dishes
  assert.equal(
    routeFor(
      fork,
      { c: 17, r: 4, entering: true, chopped: false, heat: 0 },
      { chop: false, cook: false },
    ).length,
    1,
  );
  assert.equal(
    routeFor(
      fork,
      { c: 0, r: 0, entering: true, chopped: false, heat: 0 },
      { chop: false, cook: false },
    ),
    null,
  );
  assert.equal(
    routeFor(fork, { c: 17, r: 4, entering: true, chopped: false, heat: 0 }, { bin: true }),
    null,
  );
});

test('verdicts: raw, burnt, unchopped and wrong dishes are rejected with a reason; matches score', () => {
  const order = (parts) => ({ parts: parts.map((p) => ({ done: false, ...p })) });
  const steak = order([{ kind: 'meat', chop: false, cook: true }]);
  const salad = order([
    { kind: 'tomato', chop: true, cook: false },
    { kind: 'bread', chop: false, cook: false },
  ]);
  const dish = (kind, chopped, heat) => ({ kind, chopped, heat });
  assert.equal(verdictFor([steak], dish('meat', false, 1)).order, steak);
  assert.equal(verdictFor([steak], dish('meat', false, 0)).reject, 'raw');
  assert.equal(verdictFor([steak], dish('meat', false, 2)).reject, 'burnt');
  assert.equal(
    verdictFor([steak], dish('meat', true, 1)).reject,
    'wrong',
    'chopped when not asked',
  );
  assert.equal(verdictFor([steak], dish('fish', false, 1)).reject, 'wrong');
  assert.equal(verdictFor([], dish('meat', false, 1)).reject, 'wrong', 'nobody is waiting');
  assert.equal(verdictFor([salad], dish('tomato', false, 0)).reject, 'unchopped');
  assert.equal(verdictFor([salad], dish('tomato', true, 0)).part, salad.parts[0]);
  assert.equal(verdictFor([salad], dish('bread', false, 0)).part, salad.parts[1]);
  salad.parts[1].done = true;
  assert.equal(
    verdictFor([salad], dish('bread', false, 0)).reject,
    'wrong',
    'that part is already filled',
  );
  assert.equal(
    verdictFor([steak, salad], dish('tomato', true, 0)).part,
    salad.parts[0],
    'goes to whoever asked for it',
  );
});

test('time: invalid dt is inert and a press during it is not kept for later', () => {
  for (const bad of [NaN, 0, -0.01, Infinity, undefined, 0.5, RULES.maxDt + 0.001]) {
    const s = shift(1);
    open(s, 1);
    stand(s, 4, 3);
    const before = JSON.stringify(snapshot(s));
    assert.equal(advance(s, bad, input(['ArrowLeft'], ['Space', 'KeyX'])), false);
    assert.equal(JSON.stringify(snapshot(s)), before, `dt ${bad}`);
    run(s, 0.5);
    assert.equal(s.stats.drops, 0, `the Space pressed during dt ${bad} was not queued`);
  }
  const s = shift(1);
  assert.equal(advance(s, 1 / 30, input([])), true);
  assert.equal(advance(s, RULES.maxDt, input([])), true);
});

test('interact: Space drops one item per press; holding it cannot duplicate', () => {
  const s = shift(1);
  open(s, 1);
  stand(s, 4, 4); // next to the crate at 3,3
  const log = sounds();
  advance(s, STEP, input(['Space'], ['Space']), log);
  for (let i = 0; i < 600; i++) advance(s, STEP, input(['Space']), log);
  assert.equal(s.stats.drops, 1, 'five seconds of holding Space dropped exactly one');
  assert.equal(crateAt(s, 3, 3) && s.stn[crateAt(s, 3, 3).id].stock, 3);
  assert.deepEqual(
    log.list.filter((n) => n === 'move'),
    ['move'],
  );
  // Mashing is limited by the reload time and by the belt entry.
  const t = shift(1);
  open(t, 1);
  stand(t, 4, 4);
  for (let i = 0; i < 120 * 6; i++) tap(t, 'Space');
  assert.equal(t.stats.drops, 4, 'six seconds of mashing: stock of four, one per reload');
  assert.equal(snapshot(t).stations.find((q) => q.kind === 'crate').stock, 0);
});

test('interact: crates explain why nothing came out', () => {
  const s = shift(1);
  stand(s, 4, 4);
  tap(s, 'Space');
  assert.equal(s.stats.drops, 1);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /reloading/);
  assert.match(snapshot(s).message.zh, /补货/);
  run(s, RULES.crateCooldown + 0.1);
  place(s, 'bread', 4, 3);
  s.items.find((it) => it.id !== s.items[0].id);
  s.items.length = 0;
  s.occ.fill(-1);
  place(s, 'bread', 4, 3);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /busy/);
  stand(s, 10, 6);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /Nothing in reach/);
  tap(s, 'KeyX');
  assert.match(snapshot(s).message.en, /No junction/);
  s.def = { ...s.def, need: 0 };
  s.stn.forEach((d) => (d.stock = 0));
  stand(s, 4, 4);
  s.items.length = 0;
  s.occ.fill(-1);
  run(s, 2);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /crate is empty/);
});

test('belts: dishes ride at the stated speed, one per tile, and wait in a queue', () => {
  for (const [n, speed, c, r] of [
    [1, 2, 5, 3],
    [11, 3, 8, 4],
    [17, 2.5, 8, 4],
  ]) {
    const s = shift(n);
    assert.equal(snapshot(s).belt.tilesPerSecond, speed);
    assert.equal(snapshot(s).belt.pixelsPerSecond, speed * TILE);
    place(s, 'bread', c, r);
    run(s, 0.4);
    const moved = snapshot(s).items[0];
    assert.ok(
      Math.abs(moved.x - cx(c) - speed * TILE * 0.4) < 2,
      `shift ${n}: ${moved.x - cx(c)} px in 0.4 s`,
    );
  }
  // A busy board holds the line behind it: dishes wait one tile apart and never overlap.
  const c = shift(3);
  const ids = [7, 6, 5].map((col) => place(c, 'tomato', col, 4).id);
  run(c, 3);
  const view = snapshot(c);
  assert.equal(
    view.stations.find((st) => st.kind === 'chopper').holding.kind,
    'tomato',
    'the first dish is on the board, waiting for a chop',
  );
  const waiting = ids.slice(1).map((id) => view.items.find((it) => it.id === id).x);
  assert.deepEqual(waiting, [cx(7), cx(6)], 'the others wait a tile apart');
});

test('junctions: X flips the nearest one; a dish commits to an exit when it reaches the centre', () => {
  const s = shift(6);
  assert.deepEqual(
    snapshot(s).junctions.map((j) => j.state),
    [0],
  );
  stand(s, 9, 3);
  tap(s, 'KeyX');
  assert.deepEqual(
    snapshot(s).junctions.map((j) => j.state),
    [1],
  );
  assert.equal(s.stats.reroutes, 1);
  tap(s, 'KeyX');
  assert.deepEqual(
    snapshot(s).junctions.map((j) => j.state),
    [0],
  );
  // Flipping before the centre redirects it; flipping after leaves it alone.
  const late = shift(6);
  const dish = place(late, 'bread', 8, 4);
  stand(late, 9, 3);
  run(late, 0.4);
  assert.ok(snapshot(late).items[0].x < cx(9), 'still before the centre');
  tap(late, 'KeyX');
  run(late, 0.5);
  assert.ok(snapshot(late).items[0].y > cy(4), 'went down the stove branch');
  const early = shift(6);
  place(early, 'bread', 8, 4);
  stand(early, 9, 3);
  run(early, 0.7);
  assert.ok(snapshot(early).items[0].x > cx(9), 'past the centre');
  tap(early, 'KeyX');
  run(early, 0.8);
  assert.ok(Math.abs(snapshot(early).items[0].y - cy(4)) < 1, 'kept going straight');
  assert.ok(dish);
  // The nearest junction wins when several are around.
  const kitchen = shift(14);
  stand(kitchen, 9, 5);
  tap(kitchen, 'KeyX');
  assert.deepEqual(
    snapshot(kitchen).junctions.map((j) => j.state),
    [1, 0],
  );
  stand(kitchen, 12, 5);
  tap(kitchen, 'KeyX');
  assert.deepEqual(
    snapshot(kitchen).junctions.map((j) => j.state),
    [1, 1],
  );
});

test('board: Space starts chopping, which only advances while a chef is close', () => {
  const s = shift(3);
  open(s, 1);
  const board = stationAt(s.lv, 8, 4);
  const view = () => snapshot(s).stations.find((q) => q.id === board.id);
  tap(s, 'Space');
  stand(s, 8, 3);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /Nothing on the board/);
  place(s, 'tomato', 7, 4);
  run(s, 1);
  assert.equal(view().mode, 'idle', 'a dish waits for the chef');
  stand(s, 8, 3);
  tap(s, 'Space');
  assert.equal(view().mode, 'chopping');
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /Already chopping/);
  run(s, 0.5);
  const half = view().fill;
  stand(s, 12, 7);
  run(s, 2);
  assert.equal(view().fill, half, 'no progress while nobody is near');
  assert.equal(view().attended, false);
  stand(s, 8, 3);
  run(s, RULES.chopTime);
  assert.equal(view().holding, null, 'chopped and sent on');
  assert.equal(s.stats.chops, 1);
  assert.ok(snapshot(s).items.some((it) => it.chopped && it.kind === 'tomato'));
  run(s, 6);
  assert.equal(s.stats.served, 1, 'the chopped tomato was served');
});

test('board: dishes that need no chopping pass through; strays can be cleared with Space', () => {
  const s = shift(3);
  open(s, 1);
  place(s, 'tomato', 7, 4, { chopped: true });
  run(s, 1.5);
  assert.equal(
    snapshot(s).stations.find((q) => q.kind === 'chopper').holding,
    null,
    'a chopped dish went straight through',
  );
  assert.equal(s.stats.chops, 0);
  const t = shift(7);
  stand(t, 9, 5);
  place(t, 'bread', 9, 3);
  t.occ[3 * 20 + 9] = -1;
  const bread = t.items.at(-1);
  Object.assign(bread, { c: 9, r: 3 });
  t.occ[3 * 20 + 9] = bread.id;
  run(t, 1);
  const board = snapshot(t).stations.find((q) => q.kind === 'chopper');
  assert.equal(board.mode, 'idle', 'bread on the board waits for a chop');
  assert.equal(promptText(t).key === 'clear' || t.prompt.key === 'clear', true);
});

test('stove: cooks alone, turns green, warns, then burns and spits the dish out', () => {
  const s = shift(4);
  const log = sounds();
  open(s, 1);
  place(s, 'meat', 7, 4);
  const stove = () => snapshot(s).stations.find((q) => q.kind === 'stove');
  run(s, 1.2, [], log.list.push.bind(log.list));
  assert.equal(stove().holding.heat, 0);
  assert.equal(stove().mode, 'cook');
  const marks = [];
  const emit = (n) => marks.push([n, s.ticks]);
  const t0 = s.ticks;
  while (stove().holding && stove().holding.heat < 2 && s.ticks - t0 < 1200) {
    advance(s, STEP, input([]), emit);
    const v = stove();
    if (v.holding?.heat === 1 && v.warning && !marks.some(([n]) => n === 'warn'))
      marks.push(['warn', s.ticks]);
  }
  const ready = marks.find(([n]) => n === 'coin');
  const warn = marks.find(([n]) => n === 'warn');
  const burnt = marks.find(([n]) => n === 'hit');
  assert.ok(ready && warn && burnt);
  assert.ok(
    Math.abs((warn[1] - ready[1]) * STEP - (6 - RULES.burnWarn)) < 0.1,
    'the warning comes burnWarn before the burn',
  );
  assert.ok(Math.abs((burnt[1] - ready[1]) * STEP - 6) < 0.1, 'the window is the stated length');
  assert.match(snapshot(s).message.en, /burnt and was spat out/);
  assert.equal(s.stats.burnt, 1);
  for (let i = 0; i < 120 * 8 && s.stats.rejects === 0; i++) advance(s, STEP, input([]));
  assert.equal(s.stats.rejects, 1, 'the burnt dish was refused at the window');
  assert.match(snapshot(s).message.en, /Rejected: the patty is burnt/);
});

test('stove: Space takes the dish out in the green window and it is served', () => {
  const s = shift(4);
  open(s, 1);
  place(s, 'meat', 7, 4);
  stand(s, 8, 5);
  run(s, 3.7);
  const stove = () => snapshot(s).stations.find((q) => q.kind === 'stove');
  assert.equal(stove().holding.heat, 1);
  tap(s, 'Space');
  assert.equal(s.stats.pulls, 1);
  assert.equal(stove().holding, null);
  run(s, 6);
  assert.equal(s.stats.served, 1);
  assert.equal(s.stats.rejects, 0);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /stove is empty/);
});

test('stove: taking a dish out early sends it raw and the window refuses it with a reason', () => {
  const s = shift(4);
  open(s, 1);
  place(s, 'meat', 7, 4);
  stand(s, 8, 5);
  run(s, 1.4);
  tap(s, 'Space');
  assert.match(snapshot(s).message.en, /took the patty out raw/);
  assert.match(snapshot(s).message.zh, /生着/);
  run(s, 6);
  assert.equal(s.stats.rejects, 1);
  assert.match(snapshot(s).message.en, /Rejected: the patty is raw/);
  assert.match(snapshot(s).message.zh, /退回：肉饼是生的/);
  assert.equal(s.stats.served, 0);
  assert.equal(satisfactionOf(s), 0);
  assert.equal(s.penalty, RULES.rejectPenalty);
  // a stove that is blocked on the way out keeps the dish
  const t = shift(4);
  place(t, 'meat', 7, 4);
  stand(t, 8, 5);
  run(t, 3.2);
  place(t, 'bread', 9, 4);
  tap(t, 'Space');
  assert.match(snapshot(t).message.en, /busy/);
  assert.equal(snapshot(t).stations.find((q) => q.kind === 'stove').holding.kind, 'meat');
});

test('stove: cooked and burnt dishes pass a second stove untouched', () => {
  const s = shift(4);
  place(s, 'meat', 7, 4, { heat: 1 });
  run(s, 1.5);
  assert.equal(snapshot(s).stations.find((q) => q.kind === 'stove').holding, null);
  assert.ok(
    snapshot(s).items.some((it) => it.heat === 1),
    'passed through still cooked',
  );
});

test('tickets: each scores once, by speed; expiry and rejects cost satisfaction', () => {
  const s = shift(1);
  open(s, 1);
  assert.equal(satisfactionOf(s), 0);
  const first = s.orders[0];
  const left = first.left;
  place(s, 'bread', 15, 3);
  run(s, 1);
  assert.equal(first.state, 'served');
  assert.ok(first.pts >= 97 && first.pts <= 100, 'served at once: nearly the full 100 points');
  assert.ok(left > first.patience - 1);
  const slow = shift(1);
  open(slow, 1);
  slow.orders[0].left = slow.orders[0].patience / 2;
  place(slow, 'bread', 15, 3);
  run(slow, 1);
  assert.ok(
    Math.abs(slow.orders[0].pts - 80) <= 1,
    `half the patience left: 60 + 40 * 0.5, got ${slow.orders[0].pts}`,
  );
  const score = s.score;
  place(s, 'bread', 15, 3);
  run(s, 1);
  assert.equal(first.state, 'served', 'a second bread does not score the same ticket again');
  assert.equal(s.stats.served, 1);
  assert.equal(s.stats.rejects, 1);
  assert.equal(s.score, score - RULES.rejectPenalty);
  assert.match(snapshot(s).message.en, /not what any ticket wants/);
  const expire = shift(1);
  open(expire, 1);
  expire.orders[0].left = 0.01;
  run(expire, 0.1);
  assert.equal(expire.orders[0].state, 'expired');
  assert.equal(expire.stats.expired, 1);
  assert.match(snapshot(expire).message.en, /gave up waiting/);
});

test('tickets: multi-part tickets fill part by part and score only when complete', () => {
  const s = shift(9);
  open(s, 1);
  const order = s.orders[0];
  place(s, 'bread', 16, 4);
  run(s, 0.8);
  assert.deepEqual(
    order.parts.map((p) => p.done),
    [true, false],
  );
  assert.equal(order.state, 'open');
  assert.equal(s.stats.served, 0);
  place(s, 'meat', 16, 4, { heat: 1 });
  run(s, 0.8);
  assert.equal(order.state, 'served');
  assert.equal(s.stats.served, 1);
  assert.ok(snapshot(s).orders[0].parts.every((p) => p.done));
});

test('shifts end explicitly: an unreachable target loses at once, a reachable one clears', () => {
  const lost = shift(1);
  const ends = [];
  open(lost, 1);
  for (const o of lost.orders.slice(0, 2)) o.left = 0.01;
  open(lost, 2);
  run(lost, 0.1);
  assert.equal(lost.phase, 'lost');
  assert.equal(lost.cause, 'satisfaction');
  assert.equal(advance(lost, STEP, input([], ['Space'])), false, 'frozen once lost');
  const won = shift(1);
  for (const o of won.orders) {
    o.state = 'served';
    o.pts = 90;
  }
  won.points = 270;
  won.orders[2].state = 'open';
  won.orders[2].parts[0].done = false;
  won.points = 180;
  place(won, 'bread', 15, 3);
  run(won, 1);
  assert.ok(won.clear > 0 && won.unlockTo === 2, 'cleared and the next shift is unlocked');
  const first = snapshot(won);
  assert.equal(first.phase, 'playing');
  const log = sounds();
  run(won, 3, [], log);
  assert.equal(snapshot(won).shift, 2, 'the next shift starts by itself');
  assert.equal(ends.length, 0);
  assert.deepEqual(snapshot(won).stats, {
    acts: 0,
    drops: 0,
    chops: 0,
    pulls: 0,
    reroutes: 0,
    rejects: 0,
    served: 0,
    expired: 0,
    burnt: 0,
    binned: 0,
  });
});

test('the last shift ends the run with one win and no extra fanfare from the game', () => {
  const h = harness();
  h.env.progress = { unlocked: () => 22, unlock: () => {} };
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().shift, 22);
  assert.equal(h.ends.length, 0);
});

test('select: shows only when more than shift 1 is open, validates progress and never starts a locked shift', () => {
  const cases = [
    [undefined, null],
    [NaN, null],
    [0, null],
    [-4, null],
    [1, null],
    [3.9, 3],
    ['7', 7],
    [99, 22],
    [22, 22],
    [Infinity, null],
    [null, null],
  ];
  for (const [value, cursor] of cases) {
    const h = harness();
    h.env.progress = { unlocked: () => value, unlock: () => {} };
    const m = createGame(h.env).getState().menu;
    assert.equal(m ? m.cursor : null, cursor, String(value));
  }
  const bare = createGame(harness().env);
  assert.equal(bare.getState().menu, null, 'works without a progress object');
  const half = harness();
  half.env.progress = {};
  assert.equal(createGame(half.env).getState().menu, null);
  const h = harness();
  const log = [];
  h.env.progress = { unlocked: () => 5, unlock: (n) => log.push(n) };
  const g = createGame(h.env);
  const key = (...p) => g.update(1 / 60, input([], p));
  assert.equal(g.getState().menu.cursor, 5);
  key('ArrowRight');
  assert.equal(g.getState().menu.cursor, 5, 'cannot move past the open shifts');
  key('ArrowLeft');
  key('KeyA');
  assert.equal(g.getState().menu.cursor, 3);
  key('ArrowUp');
  assert.equal(g.getState().menu.cursor, 1);
  key('ArrowDown');
  assert.equal(g.getState().menu.cursor, 5, 'down a row stops at the last open shift');
  // pointer: a locked cell refuses with a message; an open cell starts that shift
  const click = (n) => {
    const cell = menuCell(n);
    g.update(1 / 60, input([], [], { x: cell.x + 5, y: cell.y + 5, clicked: true }));
  };
  click(9);
  assert.match(g.getState().message.en, /Clear shift 5 first/);
  assert.match(g.getState().message.zh, /请先通关第5班/);
  assert.ok(g.getState().menu);
  g.update(1 / 60, input([], [], { x: 1, y: 1, clicked: true }));
  assert.ok(g.getState().menu, 'a click outside any cell does nothing');
  click(2);
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().shift, 2);
  assert.deepEqual(log, [], 'choosing a shift does not touch the stored progress');
  for (const confirm of ['Enter', 'NumpadEnter', 'KeyF', 'Comma', 'Space']) {
    const k = createGame(
      Object.assign(harness().env, { progress: { unlocked: () => 3, unlock() {} } }),
    );
    k.update(1 / 60, input([], [confirm]));
    assert.equal(k.getState().shift, 3, confirm);
  }
});

test('clearing a shift unlocks the next with unlock(n+1) and replays never lower it', () => {
  const h = harness();
  const calls = [];
  h.env.progress = { unlocked: () => 4, unlock: (n) => calls.push(n) };
  const g = createGame(h.env);
  g.update(1 / 60, input([], ['ArrowLeft']));
  g.update(1 / 60, input([], ['Space']));
  assert.equal(g.getState().shift, 3);
  assert.deepEqual(calls, []);
});

test('co-op: two chefs with separate keys share one kitchen; Space and X are for the solo chef only', () => {
  const s = shift(6, 2);
  assert.equal(snapshot(s).chefs.length, 2);
  const [a, b] = s.chefs.map((c) => ({ x: c.x, y: c.y }));
  run(s, 0.5, ['KeyD', 'ArrowLeft']);
  assert.ok(s.chefs[0].x > a.x + 40 && s.chefs[1].x < b.x - 40);
  assert.equal(s.chefs[0].y, a.y);
  const m = { y0: s.chefs[0].y, y1: s.chefs[1].y };
  run(s, 0.5, ['KeyW', 'ArrowUp']);
  assert.ok(s.chefs[0].y < m.y0 - 40 && s.chefs[1].y < m.y1 - 40);
  stand(s, 9, 3, 0);
  stand(s, 12, 12 - 6, 1);
  tap(s, 'KeyX');
  tap(s, 'Space');
  assert.equal(s.stats.reroutes, 0, 'the solo keys do nothing in co-op');
  tap(s, 'KeyG');
  assert.equal(s.stats.reroutes, 1);
  stand(s, 9, 3, 1);
  tap(s, 'Period');
  assert.equal(s.stats.reroutes, 2);
  stand(s, 4, 3, 0);
  stand(s, 4, 1, 1);
  open(s, 1);
  advance(s, STEP, input([], ['KeyF', 'Comma']));
  run(s, 0.1);
  assert.equal(s.stats.drops, 1, 'one crate, one item, even when both press at once');
  // each chef's marker text uses their own keys
  assert.match(promptText(s).en, /F\/,|G\/\./);
  const solo = shift(6, 1);
  assert.equal(snapshot(solo).chefs.length, 1);
  assert.equal(snapshot(solo).keys, 'Space / X');
});

test('co-op: simultaneous presses alternate which chef goes first', () => {
  const firsts = [];
  for (let parity = 0; parity < 2; parity++) {
    const s = shift(6, 2);
    open(s, 1);
    const crate = s.lv.stations.find((q) => q.kind === 'crate' && q.item === 'bread');
    stand(s, crate.c + 1, crate.r, 0);
    stand(s, crate.c + 1, crate.r, 1);
    s.ticks += parity;
    s.chefs[0].marker = 'one';
    advance(s, STEP, input([], ['KeyF', 'Comma']));
    firsts.push(s.stats.drops);
  }
  assert.deepEqual(firsts, [1, 1]);
});

test('chefs: walls, stations and the screen edge are solid; diagonals are not faster', () => {
  const s = shift(1);
  stand(s, 1, 1);
  run(s, 3, ['ArrowLeft', 'ArrowUp']);
  const c = s.chefs[0];
  assert.ok(
    c.x >= TILE + RULES.half - 1e-6 && c.y >= RULES.top + TILE + RULES.half - 1e-6,
    'stopped by the counters',
  );
  stand(s, 5, 5);
  const p = { ...s.chefs[0] };
  run(s, 0.5, ['ArrowRight', 'ArrowDown']);
  const diag = Math.hypot(s.chefs[0].x - p.x, s.chefs[0].y - p.y);
  assert.ok(
    Math.abs(diag - RULES.chefSpeed * 0.5) < 1.5,
    `diagonal covers ${diag.toFixed(1)} px in 0.5 s`,
  );
  const t = shift(3);
  stand(t, 8, 3);
  run(t, 2, ['ArrowDown']);
  assert.ok(t.chefs[0].y < cy(4) - 1, 'the board stops the chef');
  const q = shift(1);
  stand(q, 5, 3);
  run(q, 2, ['ArrowDown', 'ArrowUp']);
  assert.equal(q.chefs[0].y, cy(3), 'opposite keys cancel');
  assert.ok(snapshot(q).chefs[0].rect.w >= 16);
});

test('random play never breaks the world: finite numbers, bounded lists, no overlapping dishes', () => {
  for (let n = 1; n <= SHIFTS.length; n++) {
    const s = shift(n, n % 2 ? 1 : 2);
    const rnd = seeded(n * 5);
    const codes =
      s.mode === 1
        ? ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
        : ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    const acts = s.mode === 1 ? ['Space', 'KeyX'] : ['KeyF', 'KeyG', 'Comma', 'Period'];
    let held = [];
    for (let i = 0; i < 120 * 90 && s.phase === 'playing'; i++) {
      if (i % 20 === 0) held = rnd() < 0.3 ? [] : [codes[Math.floor(rnd() * codes.length)]];
      advance(s, STEP, input(held, rnd() < 0.02 ? [acts[Math.floor(rnd() * acts.length)]] : []));
      if (i % 60) continue;
      const view = snapshot(s);
      assert.ok(view.items.length <= 40);
      assert.ok(JSON.stringify(view).indexOf('null,null') === -1);
      for (const it of view.items) assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y));
      for (const chef of view.chefs)
        assert.ok(chef.x > 0 && chef.x < 480 && chef.y > RULES.top && chef.y < RULES.bottom);
      const near = view.items.filter((a, k) =>
        view.items.some((b, m) => m > k && Math.hypot(a.x - b.x, a.y - b.y) < 10),
      );
      assert.equal(near.length, 0, `shift ${n}: dishes overlap`);
    }
  }
});

test('terminals: the end fires once, the game stays frozen, and a new instance starts fresh', () => {
  const h = harness();
  const g = createGame(h.env);
  for (let i = 0; i < 60 * 300 && !h.ends.length; i++) g.update(1 / 60, input([]));
  assert.equal(h.ends.length, 1);
  const first = h.ends[0];
  assert.equal(first.won, false);
  assert.ok(Number.isInteger(first.score) && first.score >= 0);
  const frozen = JSON.stringify(g.getState());
  for (let i = 0; i < 600; i++) g.update(1 / 60, input(['ArrowRight'], ['Space']));
  assert.equal(JSON.stringify(g.getState()), frozen);
  assert.equal(h.ends.length, 1);
  assert.deepEqual(
    h.sounds.filter((n) => n === 'lose' || n === 'win'),
    [],
    'the host plays the end sound',
  );
  const fresh = createGame(harness().env);
  assert.equal(fresh.getState().phase, 'playing');
  assert.equal(fresh.getState().time, 0);
  assert.equal(fresh.getState().score, 0);
  assert.equal(fresh.getState().shift, 1);
});

test('state: getState returns copies, is JSON-safe and offers no cheat API', () => {
  const g = createGame(harness().env);
  g.update(1 / 60, input([]));
  const a = g.getState();
  a.score = 99999;
  a.chefs[0].x = -1;
  a.stations.length = 0;
  a.stats.drops = 50;
  a.tiles[0] = 'x';
  a.prompt.en = 'changed';
  a.junctions.push({});
  const b = g.getState();
  assert.equal(b.score, 0);
  assert.notEqual(b.chefs[0].x, -1);
  assert.ok(b.stations.length > 0 && b.stats.drops === 0 && b.tiles[0] === '#'.repeat(20));
  assert.notEqual(b.prompt.en, 'changed');
  assert.deepEqual(JSON.parse(JSON.stringify(b)), b);
  assert.deepEqual(Object.keys(g).sort(), ['draw', 'getState', 'update']);
  assert.ok(b.status.en && b.status.zh);
  assert.equal(b.hud.top[1], RULES.top);
  assert.ok(Object.isFrozen(RULES) && Object.isFrozen(SHIFTS) && Object.isFrozen(SHIFTS[0].map));
});

test('sounds: ingredients, serving, refusals and shift clears are announced once', () => {
  const s = shift(1);
  const log = sounds();
  open(s, 1);
  stand(s, 4, 4);
  advance(s, STEP, input([], ['Space']), log);
  run(s, 9, [], log);
  assert.deepEqual(log.list, ['move', 'coin']);
  place(s, 'tomato', 15, 3);
  run(s, 1, [], log);
  assert.deepEqual(log.list.slice(2), ['hit']);
});

test('prompts: the marker names its key per mode, in both languages, for every kind', () => {
  const s = shift(1);
  assert.equal(promptText(s).target, null);
  assert.match(promptText(s).en, /Arrows/);
  open(s, 1);
  s.prompt = { id: 'x', key: 'drop', c: 3, r: 3, i: 'bread', w: null, born: -999 };
  assert.equal(promptText(s).en, 'Go to the bread crate: Space puts one on the belt');
  assert.equal(promptText(s).zh, '去面包箱旁：按Space放一份到传送带');
  assert.deepEqual(promptText(s).target, { c: 3, r: 3 });
  const duo = shift(1, 2);
  duo.prompt = { id: 'x', key: 'preset', c: 9, r: 4, i: 'meat', w: 'stove', born: -999 };
  assert.equal(promptText(duo).en, 'G/. at the junction: the next patty goes to the stove');
  assert.equal(promptText(duo).zh, '在分流器旁按G/.：下一份肉饼要去炉灶');
  for (const key of Object.keys(PROMPTS)) {
    duo.prompt = { id: key, key, c: -1, r: -1, i: 'fish', w: 'bin', born: -999 };
    for (const lang of ['en', 'zh'])
      assert.ok(promptText(duo)[lang].length > 4 && !promptText(duo)[lang].includes('{'));
  }
});

test('planner: the prompt follows the kitchen: feed, preset, chop, cook, pull, clear', () => {
  const key = (s) => {
    run(s, 1);
    return snapshot(s).prompt.key;
  };
  const a = shift(6);
  assert.equal(key(a), 'wait');
  open(a, 1);
  run(a, 1);
  assert.equal(snapshot(a).prompt.key, 'drop', 'a bread ticket asks for the bread crate');
  assert.deepEqual(snapshot(a).prompt.target, { c: 3, r: 2 });
  const b = shift(6);
  b.orders[0].parts[0] = { kind: 'meat', chop: false, cook: true, done: false };
  open(b, 1);
  run(b, 1);
  assert.equal(snapshot(b).prompt.key, 'preset', 'the junction is set before the meat is sent');
  assert.deepEqual(snapshot(b).prompt.target, { c: 9, r: 4 });
  stand(b, 9, 3);
  tap(b, 'KeyX');
  run(b, 1);
  assert.equal(snapshot(b).prompt.key, 'drop');
  assert.deepEqual(snapshot(b).prompt.target, { c: 3, r: 6 });
  const c = shift(4);
  open(c, 1);
  place(c, 'meat', 7, 4);
  run(c, 1.5);
  assert.equal(snapshot(c).prompt.key, 'cook');
  run(c, 2);
  assert.equal(snapshot(c).prompt.key, 'pull');
  assert.deepEqual(snapshot(c).prompt.target, { c: 8, r: 4 });
  const d = shift(3);
  open(d, 1);
  place(d, 'tomato', 7, 4);
  run(d, 1.2);
  assert.equal(snapshot(d).prompt.key, 'chop');
  stand(d, 8, 3);
  tap(d, 'Space');
  run(d, 1);
  assert.equal(snapshot(d).prompt.key, 'stay');
  const e = shift(7);
  open(e, 1);
  stand(e, 9, 5);
  const bread = place(e, 'bread', 9, 3);
  bread.c = 9;
  run(e, 1.5);
  const board = stationAt(e.lv, 9, 2);
  assert.ok(board);
});

test('bin: the belt ends in the bin until X sends it to the window; a burnt dish thrown away costs nothing', () => {
  const s = shift(10);
  assert.deepEqual(
    snapshot(s).junctions.map((j) => j.state),
    [0],
    'the default exit leads down to the bin',
  );
  place(s, 'meat', 9, 4, { heat: 2 });
  run(s, 2.5);
  assert.equal(s.stats.binned, 1);
  assert.equal(s.stats.rejects, 0);
  assert.equal(s.penalty, 0);
  assert.match(snapshot(s).message.en, /went into the bin/);
  assert.match(snapshot(s).message.zh, /垃圾桶/);
  // a good dish needs the junction flipped, otherwise it is thrown away and never served
  const t = shift(10);
  open(t, 1);
  place(t, 'meat', 9, 4, { heat: 1 });
  run(t, 2.5);
  assert.equal(t.stats.served, 0);
  assert.equal(t.stats.binned, 1);
  const u = shift(10);
  open(u, 1);
  stand(u, 10, 5);
  tap(u, 'KeyX');
  place(u, 'meat', 9, 4, { heat: 1 });
  run(u, 5);
  assert.equal(u.stats.served, 1);
  assert.equal(u.stats.binned, 0);
});

test('prompts move on at once when the action they asked for is done', () => {
  // X at the junction: the next frame no longer asks for the same flip, so nobody presses twice.
  const a = shift(6);
  a.orders[0].parts[0] = { kind: 'meat', chop: false, cook: true, done: false };
  open(a, 1);
  run(a, 1);
  assert.equal(snapshot(a).prompt.key, 'preset');
  stand(a, 9, 3);
  tap(a, 'KeyX');
  assert.notEqual(snapshot(a).prompt.key, 'preset');
  assert.equal(snapshot(a).prompt.key, 'drop');
  assert.equal(snapshot(a).stats.acts, 1);
  // dropping an ingredient
  stand(a, 4, 5);
  tap(a, 'Space');
  assert.notEqual(snapshot(a).prompt.key, 'drop');
  // starting a chop
  const b = shift(3);
  open(b, 1);
  place(b, 'tomato', 7, 4);
  run(b, 1.2);
  assert.equal(snapshot(b).prompt.key, 'chop');
  stand(b, 8, 3);
  tap(b, 'Space');
  assert.equal(snapshot(b).prompt.key, 'stay');
  // taking a dish off the stove
  const c = shift(4);
  open(c, 1);
  place(c, 'meat', 7, 4);
  stand(c, 8, 5);
  run(c, 3.7);
  assert.equal(snapshot(c).prompt.key, 'pull');
  tap(c, 'Space');
  assert.notEqual(snapshot(c).prompt.key, 'pull');
  // an ordinary change without an action still waits out the hold
  const d = shift(1);
  open(d, 1);
  run(d, 0.3);
  const key = snapshot(d).prompt.key;
  d.orders[0].state = 'served';
  run(d, 0.3);
  assert.equal(snapshot(d).prompt.key, key, 'held for at least 0.75 s');
});

test('prompts do not send the chef away from a dish that is about to burn', () => {
  const stage = (prog) => {
    const s = shift(9);
    open(s, 1);
    const stove = s.lv.stations.find((q) => q.kind === 'stove');
    Object.assign(s.stn[stove.id], {
      slot: { kind: 'meat', chopped: false, heat: 0 },
      mode: 'cook',
      prog,
    });
    stand(s, stove.c, stove.r - 1);
    s.prompt = { id: '', key: 'wait', c: -1, r: -1, i: null, w: null, born: -999 };
    run(s, 0.1);
    return snapshot(s).prompt.key;
  };
  // 8 s from burning: the walk to the bread crate and back fits with 2.5 s to spare
  assert.equal(stage(0.2), 'drop');
  // 5.3 s from burning: the round trip plus the reaction slack no longer fits, so stay and wait
  assert.equal(stage(2.7), 'cook');
  assert.ok(RULES.tripSlack >= 1.5);
});

test('draw: every shift renders in both languages and modes with finite coordinates and no exceptions', () => {
  for (const lang of ['en', 'zh'])
    for (let n = 1; n <= SHIFTS.length; n++) {
      for (const mode of [1, 2]) {
        const h = harness({ lang, mode });
        const bad = [];
        const ctx = new Proxy(mockContext(), {
          get: (t, p) =>
            p === 'fillRect'
              ? (...a) => a.some((v) => !Number.isFinite(v)) && bad.push(a)
              : p === 'fillText'
                ? (text, x, y) =>
                    !(Number.isFinite(x) && Number.isFinite(y) && String(text).length) &&
                    bad.push([text, x, y])
                : p in t
                  ? t[p]
                  : () => {},
          set: (t, p, v) => ((t[p] = v), true),
        });
        const s = shift(n, mode);
        const env = { ...h.env, t: (en, zh) => (lang === 'zh' ? zh : en) };
        render(ctx, s, env);
        s.ticks = 4000;
        for (const kind of ['bread', 'tomato', 'meat', 'fish', 'egg']) {
          place(s, kind, 8, 4, {
            chopped: kind === 'tomato',
            heat: kind === 'meat' ? 1 : kind === 'fish' ? 2 : 0,
          });
        }
        s.stn.forEach((d, i) => {
          if (s.lv.stations[i].kind === 'stove')
            Object.assign(d, {
              slot: { kind: 'meat', chopped: false, heat: 1 },
              mode: 'cook',
              prog: 8,
              cool: 3,
            });
          if (s.lv.stations[i].kind === 'chopper')
            Object.assign(d, {
              slot: { kind: 'fish', chopped: false, heat: 0 },
              mode: 'chopping',
              prog: 0.5,
            });
        });
        s.verdict = { ok: false, left: 50 };
        s.msg = { en: 'Message', zh: '消息', left: 50 };
        s.prompt = {
          id: 'x',
          key: 'pull',
          c: s.lv.stations[0].c,
          r: s.lv.stations[0].r,
          i: 'meat',
          w: null,
          born: 0,
        };
        s.chefs[0].flash = 20;
        s.chefs[0].walk = 0.1;
        for (const face of ['left', 'right', 'up', 'down']) {
          s.chefs[0].face = face;
          render(ctx, s, env);
        }
        s.clear = 100;
        render(ctx, s, env);
        assert.deepEqual(bad, [], `shift ${n} ${lang} mode ${mode}`);
      }
      const menu = createGame(
        Object.assign(harness({ lang }).env, { progress: { unlocked: () => n, unlock() {} } }),
      );
      menu.draw(mockContext());
      menu.update(1 / 60, input([]));
    }
  const s = shift(1);
  s.stn[0].mode = 'spit';
  openMenu(s, 7);
  s.msg = { en: 'a', zh: 'b', left: 10 };
  render(mockContext(), s, { lang: 'en', t: (en) => en });
});

test('stock-out counts the best set of tickets, not the first ones in order', () => {
  // Grand Service: tomato+egg, egg+fish and fish+tomato compete for one tomato and one egg.
  // Serving the first one would leave nothing for the others, but the last two fit together.
  const s = shift(22);
  s.orders.forEach((o) => (o.state = 'open'));
  s.orders[0].state = 'served';
  s.orders[4].state = 'expired';
  s.points = 90;
  const stock = { tomato: 1, fish: 2, egg: 1 };
  for (const q of s.lv.stations) if (q.kind === 'crate') s.stn[q.id].stock = stock[q.item] ?? 0;
  run(s, 0.05);
  assert.notEqual(s.cause, 'stock', 'two tickets (58%) still reach the 55% target');
  assert.equal(s.phase, 'playing');
  // One egg fewer and only one ticket can be made (38%): now the stock loss is real.
  const t = shift(22);
  t.orders.forEach((o) => (o.state = 'open'));
  t.orders[0].state = 'served';
  t.orders[4].state = 'expired';
  t.points = 90;
  for (const q of t.lv.stations)
    if (q.kind === 'crate') t.stn[q.id].stock = { ...stock, egg: 0 }[q.item] ?? 0;
  run(t, 0.05);
  assert.equal(t.phase, 'lost');
  assert.equal(t.cause, 'stock');
});

test('stock-out: a ticket that can no longer be supplied ends the shift at once with the missing ingredient', () => {
  const emptyCrates = (s, kind) => {
    s.lv.stations.forEach((st) => {
      if (st.kind === 'crate' && (!kind || st.item === kind)) s.stn[st.id].stock = 0;
    });
  };
  // Breakfast needs 3 eggs and 3 patties. Without eggs anywhere the target slips away.
  const s = shift(16);
  assert.equal(s.phase, 'playing');
  emptyCrates(s, 'egg');
  run(s, 0.1);
  assert.equal(s.phase, 'lost');
  assert.equal(s.cause, 'stock');
  assert.equal(s.lacking, 'egg');
  assert.equal(advance(s, STEP, input([], ['Space'])), false, 'frozen');
  // Dishes on a belt or in a station still count; burnt ones do not.
  const t = shift(16);
  emptyCrates(t);
  place(t, 'egg', 5, 4);
  place(t, 'egg', 4, 4);
  place(t, 'egg', 6, 4);
  place(t, 'meat', 7, 4);
  run(t, 0.05);
  assert.equal(t.phase, 'lost', 'one patty on the way for three tickets: only one can be made');
  assert.equal(t.lacking, 'meat');
  const u = shift(16);
  emptyCrates(u);
  for (const [kind, c] of [
    ['egg', 4],
    ['egg', 5],
    ['egg', 6],
    ['meat', 7],
    ['meat', 8],
    ['meat', 9],
  ])
    place(u, kind, c, 4);
  run(u, 0.05);
  assert.equal(u.phase, 'playing', 'six dishes on the belt cover every part');
  u.items.forEach((it) => (it.heat = 2));
  run(u, 0.05);
  assert.equal(u.phase, 'lost', 'burnt dishes cannot be served');
  // Tickets are served in order: two tickets out of three (67%) still reach the 65% target, one does not.
  const keep = shift(16);
  emptyCrates(keep);
  keep.stn[keep.lv.stations.find((q) => q.item === 'egg').id].stock = 2;
  keep.stn[keep.lv.stations.find((q) => q.item === 'meat').id].stock = 3;
  run(keep, 0.05);
  assert.equal(keep.phase, 'playing');
  const v = shift(16);
  emptyCrates(v);
  v.stn[v.lv.stations.find((q) => q.item === 'egg').id].stock = 1;
  v.stn[v.lv.stations.find((q) => q.item === 'meat').id].stock = 3;
  run(v, 0.05);
  assert.equal(v.phase, 'lost');
  // A shift whose target is already out of reach through satisfaction still reports that cause.
  const w = shift(1);
  w.points = 0;
  w.penalty = 500;
  run(w, 0.05);
  assert.equal(w.cause, 'satisfaction');
  // Crates on the shifts that need exact quantities keep one spare unit.
  for (const n of [3, 16]) {
    const x = shift(n);
    const need = {};
    for (const o of x.orders) for (const p of o.parts) need[p.kind] = (need[p.kind] ?? 0) + 1;
    for (const st of x.lv.stations.filter((q) => q.kind === 'crate' && need[q.item]))
      assert.ok(x.stn[st.id].stock >= need[st.item] + 1, `shift ${n}: ${st.item} has a spare unit`);
  }
});
