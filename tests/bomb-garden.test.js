import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, blastCells, resolveBlastChain } from '../src/games/bomb-garden.js';
import { harness, input, mockContext } from './harness.js';
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
test('bomb: blasts stop at walls and include first crate', () => {
  const b = Array.from({ length: 5 }, () => Array(5).fill(0));
  b[2][3] = 1;
  b[1][2] = 2;
  assert.deepEqual(blastCells(b, 2, 2, 3), [
    [2, 2],
    [1, 2],
    [0, 2],
    [2, 3],
    [2, 4],
    [2, 1],
  ]);
});
test('bomb: safe spawn, two local players and bilingual instructions', () => {
  const g = createGame(harness({ mode: 2 }).env);
  const s = g.getState();
  assert.equal(s.board[s.players[0].y][s.players[0].x], 0);
  assert.equal(s.players.length, 2);
  assert.ok(meta.description.zh);
  g.draw(mockContext());
});
test('bomb: planted bombs break crates once and holding the key never duplicates them', () => {
  const h = harness(),
    g = createGame(h.env);
  step(g, 9, ['ArrowRight']);
  step(g, 1, ['Space'], ['Space']);
  assert.equal(g.getState().bombs.filter((b) => b.owner === 0).length, 1);
  step(g, 9, ['ArrowLeft', 'Space']);
  step(g, 9, ['ArrowDown', 'Space']);
  step(g, 150, ['Space']);
  assert.equal(g.getState().bombs.filter((b) => b.owner === 0).length, 0);
  assert.equal(g.getState().board[1][4], 0);
  assert(g.getState().score >= 10);
});
test('bomb: self-blast resolves death once and restart resets arena', () => {
  const h = harness();
  const g = createGame(h.env);
  step(g, 1, [], ['Space']);
  step(g, 180);
  assert.equal(g.getState().lives, 2);
  step(g, 90);
  step(g, 1, [], ['Space']);
  step(g, 270);
  step(g, 1, [], ['Space']);
  step(g, 180);
  assert.equal(g.getState().phase, 'lost');
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().bombs.length, 0);
});
test('bomb: walls stop walking and movement respects repeat cadence', () => {
  const g = createGame(harness().env);
  step(g, 90, ['ArrowLeft']);
  assert.equal(g.getState().players[0].x, 1);
  step(g, 12, ['ArrowRight']);
  assert.ok(g.getState().players[0].x >= 2);
});

const gardenDirections = [
  [-1, 0, 'KeyA'],
  [1, 0, 'KeyD'],
  [0, -1, 'KeyW'],
  [0, 1, 'KeyS'],
];
const cellKey = (x, y) => `${x},${y}`;
function gardenInput(state) {
  const p = state.players[0];
  if (p.moving || state.respawn > 0 || state.transition > 0) return input();
  const future = state.fronts.flatMap((f) => {
    const cells = [];
    for (let n = 0; n < f.remaining; n++) {
      const x = f.x + f.dx * n,
        y = f.y + f.dy * n;
      if (state.board[y]?.[x] === undefined || state.board[y][x] === 1) break;
      cells.push([x, y]);
      if (state.board[y][x] >= 2) break;
    }
    return cells;
  });
  const flames = new Set(
    [...state.flames.filter((f) => f.active).flatMap((f) => f.cells), ...future].map(([x, y]) =>
      cellKey(x, y),
    ),
  );
  const danger = new Set([
    ...state.bombs
      .flatMap((b) => blastCells(state.board, b.x, b.y, b.range))
      .map(([x, y]) => cellKey(x, y)),
    ...flames,
  ]);
  const passable = (x, y) =>
    state.board[y]?.[x] === 0 &&
    !flames.has(cellKey(x, y)) &&
    !state.bombs.some((b) => b.x === x && b.y === y) &&
    !state.enemies.some((e) => e.alive && e.x === x && e.y === y);
  function escape(sx, sy, dangerous) {
    const queue = [{ x: sx, y: sy, path: [] }];
    const seen = new Set([cellKey(sx, sy)]);
    for (let at = 0; at < queue.length; at++) {
      const n = queue[at];
      if (n.path.length > 0 && !dangerous.has(cellKey(n.x, n.y))) return n.path;
      if (n.path.length >= 9) continue;
      for (const [dx, dy, code] of gardenDirections) {
        const x = n.x + dx,
          y = n.y + dy,
          key = cellKey(x, y);
        if (passable(x, y) && !seen.has(key)) {
          seen.add(key);
          queue.push({ x, y, path: [...n.path, code] });
        }
      }
    }
    return null;
  }
  if (danger.has(cellKey(p.x, p.y))) {
    const path = escape(p.x, p.y, danger);
    return input(path?.length ? [path[0]] : []);
  }
  if (state.fronts.length || state.flames.some((f) => f.active)) return input();
  const collect = [{ x: p.x, y: p.y, path: [] }],
    visited = new Set([cellKey(p.x, p.y)]);
  for (let i = 0; i < collect.length; i++) {
    const n = collect[i];
    if (n.path.length && state.pickups.some((q) => q.x === n.x && q.y === n.y))
      return input([n.path[0]]);
    for (const [dx, dy, code] of gardenDirections) {
      const x = n.x + dx,
        y = n.y + dy,
        k = cellKey(x, y);
      if (passable(x, y) && !danger.has(k) && !visited.has(k)) {
        visited.add(k);
        collect.push({ x, y, path: [...n.path, code] });
      }
    }
  }
  function worthwhilePlant(x, y) {
    const ray = blastCells(state.board, x, y, p.range);
    if (
      !ray.some(
        ([a, b]) =>
          state.board[b][a] >= 2 ||
          state.enemies.some(
            (e) =>
              e.alive && e.x === a && e.y === b && Math.abs(e.x - x) + Math.abs(e.y - y) <= p.range,
          ),
      )
    )
      return null;
    return escape(x, y, new Set([...danger, ...ray.map(([a, b]) => cellKey(a, b))]));
  }
  const exit =
    state.bombs.filter((b) => b.owner === 0).length < p.capacity ? worthwhilePlant(p.x, p.y) : null;
  if (exit) return input([exit[0]], ['Space']);
  const queue = [{ x: p.x, y: p.y, path: [] }];
  const seen = new Set([cellKey(p.x, p.y)]);
  for (let at = 0; at < queue.length; at++) {
    const n = queue[at];
    if (n.path.length && worthwhilePlant(n.x, n.y)) return input([n.path[0]]);
    for (const [dx, dy, code] of gardenDirections) {
      const x = n.x + dx,
        y = n.y + dy,
        key = cellKey(x, y);
      if (passable(x, y) && !seen.has(key) && !danger.has(key)) {
        seen.add(key);
        queue.push({ x, y, path: [...n.path, code] });
      }
    }
  }
  return input();
}

test('bomb: legal planting and recovery clear six authored gardens at 30, 60 and 120 Hz', () => {
  for (const seed of [1, 3])
    for (const hz of [30, 60, 120]) {
      const h = harness({ seed }),
        game = createGame(h.env),
        layouts = new Map();
      let sawWet = false,
        sawBarrel = false,
        sawRest = false;
      for (let frame = 0; frame < hz * 1200 && game.getState().phase === 'playing'; frame++) {
        const s = game.getState();
        if (!layouts.has(s.level))
          layouts.set(s.level, {
            board: s.board,
            wet: s.wetCells,
            barrels: s.board.flat().filter((x) => x === 3).length,
          });
        sawWet ||= s.bombs.some(
          (b) => b.fuse > 2.4 && s.wetCells.some(([x, y]) => x === b.x && y === b.y),
        );
        sawBarrel ||= s.bombs.some((b) => b.barrel && b.fuse <= 0.18 + 1e-7);
        sawRest ||= s.enemies.some((e) => e.restUntil > s.elapsed);
        if (frame % hz === 0) {
          game.draw(mockContext());
          for (const a of [...s.players, ...s.enemies].filter((a) => a.alive))
            for (const dx of [-0.27, 0.27])
              for (const dy of [-0.27, 0.27])
                assert.equal(s.board[Math.floor(a.py + dy + 0.5)][Math.floor(a.px + dx + 0.5)], 0);
        }
        game.update(1 / hz, gardenInput(s));
      }
      const final = game.getState();
      assert.equal(final.phase, 'won', `seed ${seed} at ${hz}Hz`);
      assert.equal(final.level, 6);
      assert(final.players[0].alive);
      assert(final.score > 1500);
      assert.equal(h.ends.length, 1);
      assert.equal(layouts.size, 6);
      assert.equal(new Set([...layouts.values()].map((s) => JSON.stringify(s.board))).size, 6);
      assert(layouts.get(2).wet.length > 0);
      assert(layouts.get(3).barrels > 0);
      assert(sawWet && sawBarrel && sawRest);
      for (const layout of layouts.values()) {
        const queue = [[1, 1]],
          seen = new Set(['1,1']);
        for (let i = 0; i < queue.length; i++)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const x = queue[i][0] + dx,
              y = queue[i][1] + dy,
              k = cellKey(x, y);
            if (layout.board[y]?.[x] !== undefined && layout.board[y][x] !== 1 && !seen.has(k)) {
              seen.add(k);
              queue.push([x, y]);
            }
          }
        assert.equal(
          seen.size,
          layout.board.flat().filter((c) => c !== 1).length,
          'Every authored floor becomes reachable after breakables are cleared',
        );
      }
      step(game, 60);
      assert.deepEqual(game.getState(), final);
    }
});

test('bomb: chained explosions see the same blocking crates until the whole chain resolves', () => {
  const board = Array.from({ length: 7 }, () => Array(7).fill(0));
  board[3][3] = 2;
  const bombs = [
    { id: 1, x: 1, y: 3, range: 4 },
    { id: 2, x: 1, y: 1, range: 4 },
    { id: 3, x: 3, y: 1, range: 4 },
  ];
  const result = resolveBlastChain(board, bombs, [1, 2]);
  assert.equal(result.exploded.length, 3);
  assert.equal(board[3][3], 2, 'pure blast planner never mutates the board');
  assert.ok(
    !result.cells.some(([x, y]) => x === 3 && y === 4),
    'destroyed crate still shields the cell behind it for this chain',
  );
});
test('bomb: six designed gardens expose readable roles and finite blast previews', () => {
  const g = createGame(harness().env),
    s = g.getState();
  assert.equal(s.totalLevels, 6);
  assert.ok(s.garden.en);
  assert.ok(s.enemies.every((e) => e.role));
  g.update(1 / 60, input([], ['Space']));
  assert.ok(g.getState().danger.length > 0);
  g.draw(mockContext());
});

test('bomb: physical occupancy follows the visible move rather than jumping a cell', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input(['KeyD']));
  const p = g.getState().players[0];
  assert.equal(p.x, 1);
  assert(p.px > 1 && p.px < 2);
  assert.equal(p.py, 1);
  assert(p.moving);
});
test('bomb: planting during a stride waits for a physical cell center', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input(['KeyD']));
  g.update(1 / 120, input(['KeyD'], ['Space']));
  assert.equal(g.getState().bombs.length, 0);
  for (let i = 0; i < 30 && !g.getState().bombs.length; i++) g.update(1 / 120, input());
  assert.equal(g.getState().bombs.length, 1);
  assert.equal(g.getState().bombs[0].x, 2);
});
test('bomb: creator pass-through is revoked after leaving the physical charge', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input([], ['Space']));
  assert(g.getState().bombs[0].passIds.includes(0));
  for (let i = 0; i < 30; i++) g.update(1 / 120, input(['KeyD']));
  assert(!g.getState().bombs[0].passIds.includes(0));
  for (let i = 0; i < 45; i++) g.update(1 / 120, input(['KeyA']));
  assert(g.getState().players[0].px >= 2 - 1e-8);
});
test('bomb: duel supplies complete independent touch controls', () => {
  assert(meta.touchControls.every((c) => c.side));
  assert(meta.multiplayerTouchControls.some((c) => c.code === 'Space' && c.side === 'left'));
  assert(meta.multiplayerTouchControls.some((c) => c.code === 'Enter' && c.side === 'right'));
  assert.equal(meta.multiplayerTouchControls.length, 10);
});

function walkTo(game, index, tx, ty, hz = 120) {
  const codes =
    index === 0
      ? { L: 'KeyA', R: 'KeyD', U: 'KeyW', D: 'KeyS' }
      : { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };
  for (let steps = 0; steps < 300; steps++) {
    const s = game.getState(),
      p = s.players[index];
    if (!p.alive || s.phase !== 'playing') throw new Error('Journey ended before arrival');
    if (p.moving) {
      game.update(1 / hz, input());
      continue;
    }
    if (p.x === tx && p.y === ty) return;
    const queue = [{ x: p.x, y: p.y, first: null }],
      seen = new Set([cellKey(p.x, p.y)]);
    let direction = null;
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (n.x === tx && n.y === ty) {
        direction = n.first;
        break;
      }
      for (const [dx, dy, name] of [
        [-1, 0, 'L'],
        [1, 0, 'R'],
        [0, -1, 'U'],
        [0, 1, 'D'],
      ]) {
        const x = n.x + dx,
          y = n.y + dy,
          k = cellKey(x, y);
        if (
          seen.has(k) ||
          s.board[y]?.[x] !== 0 ||
          s.bombs.some((b) => b.x === x && b.y === y) ||
          s.players.some(
            (q) =>
              q.id !== p.id &&
              q.alive &&
              ((q.x === x && q.y === y) || (q.moving?.x === x && q.moving?.y === y)),
          )
        )
          continue;
        seen.add(k);
        queue.push({ x, y, first: n.first || codes[name] });
      }
    }
    assert(direction, `A floor route exists to ${tx},${ty}`);
    game.update(1 / hz, input([direction]));
  }
  assert.fail(`Walk to ${tx},${ty} exceeded its budget`);
}

test('bomb: simultaneous empty-cell contention, swaps and reservations never overlap players', () => {
  const g = createGame(harness({ mode: 2 }).env);
  walkTo(g, 0, 2, 1);
  walkTo(g, 1, 4, 1);
  g.update(1 / 120, input(['KeyD', 'ArrowLeft']));
  let s = g.getState();
  assert.equal(s.players[0].px, 2);
  assert.equal(s.players[1].px, 4);
  assert(s.players.every((p) => !p.moving));
  g.update(1 / 120, input(['KeyD']));
  g.update(1 / 120, input(['ArrowLeft']));
  for (let i = 0; i < 25; i++) {
    s = g.getState();
    assert(
      Math.hypot(s.players[0].px - s.players[1].px, s.players[0].py - s.players[1].py) >= 1 - 1e-8,
    );
    g.update(1 / 120, input());
  }
  walkTo(g, 1, 4, 1);
  s = g.getState();
  assert.equal(s.players[0].x, 3);
  assert.equal(s.players[1].x, 4);
  g.update(1 / 120, input(['KeyD', 'ArrowLeft']));
  s = g.getState();
  assert(s.players.every((p) => !p.moving));
});
test('bomb: equal-time roots share cover, independent of which player occupies each side', () => {
  const results = [];
  for (const swap of [false, true]) {
    const g = createGame(harness({ mode: 2 }).env);
    walkTo(g, 0, ...(swap ? [3, 3] : [5, 1]));
    walkTo(g, 1, ...(swap ? [5, 1] : [3, 3]));
    g.update(1 / 120, input([], ['Space', 'Enter']));
    walkTo(g, swap ? 1 : 0, 7, 2);
    walkTo(g, swap ? 0 : 1, 4, 5);
    const burned = new Set();
    for (let i = 0; i < 330; i++) {
      g.update(1 / 120, input());
      for (const f of g.getState().flames) burned.add(cellKey(f.x, f.y));
    }
    const s = g.getState();
    assert.equal(s.board[3][5], 0);
    assert(!burned.has('5,4'));
    assert(!burned.has('6,3'));
    assert(s.players.every((p) => p.alive));
    results.push([...burned].sort());
  }
  assert.deepEqual(results[0], results[1]);
});
test('bomb: a travelling jet detonates a later charge before its own fuse', () => {
  const g = createGame(harness({ mode: 2 }).env);
  walkTo(g, 0, 3, 1);
  walkTo(g, 1, 5, 1);
  g.update(1 / 120, input([], ['Space']));
  for (let i = 0; i < 30; i++) g.update(1 / 120, input());
  g.update(1 / 120, input([], ['Enter']));
  const later = g.getState().bombs.find((b) => b.owner === 1).at;
  walkTo(g, 0, 4, 3);
  walkTo(g, 1, 7, 2);
  while (g.getState().bombs.some((b) => b.owner === 1)) g.update(1 / 120, input());
  assert(g.getState().elapsed < later - 0.1);
  assert(g.getState().players.every((p) => p.alive));
});
test('bomb: simultaneous self blasts produce one genuine duel draw', () => {
  const h = harness({ mode: 2 }),
    g = createGame(h.env);
  g.update(1 / 120, input([], ['Space', 'Enter']));
  for (let i = 0; i < 330; i++) g.update(1 / 120, input());
  assert(g.getState().players.every((p) => !p.alive));
  assert.equal(h.ends.length, 1);
  assert.match(h.ends[0].message, /draw/i);
  const terminal = g.getState();
  step(g, 30, ['KeyD'], ['Space']);
  assert.deepEqual(g.getState(), terminal);
});
test('bomb: harmless ember contact cannot deal damage after its active interval', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 3, 2);
  for (let i = 0; i < 400; i++) {
    const f = g.getState().flames.find((f) => f.x === 3 && f.y === 1);
    if (f && !f.active) break;
    g.update(1 / 120, input());
  }
  assert(g.getState().flames.some((f) => f.x === 3 && f.y === 1 && !f.active));
  walkTo(g, 0, 3, 1);
  assert(g.getState().players[0].alive);
  assert(g.getState().flames.some((f) => f.x === 3 && f.y === 1 && !f.active));
});
test('bomb: late sidestepping cannot escape flames while the physical body still overlaps', () => {
  const g = createGame(harness({ mode: 2 }).env);
  walkTo(g, 0, 2, 1);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 1, 1);
  while (g.getState().bombs[0].fuse > 0.02) g.update(1 / 120, input());
  for (let i = 0; i < 12 && g.getState().phase === 'playing'; i++)
    g.update(1 / 120, input(['KeyS']));
  assert.equal(g.getState().players[0].alive, false);
  assert(g.getState().players[0].py < 1.78);
});
test('bomb: fuses and continuous strides agree at 30,60,120 Hz', () => {
  const states = [30, 60, 120].map((hz) => {
    const g = createGame(harness({ mode: 2 }).env);
    g.update(1 / 240, input([], ['Space']));
    for (let i = 0; i < hz; i++) g.update(1 / hz, input(['KeyD']));
    return g.getState();
  });
  for (const s of states) {
    assert(Math.abs(s.bombs[0].fuse - 1.4) < 1e-7);
    assert(Math.abs(s.players[0].py - 1) < 1e-8);
  }
  for (const s of states) assert(Math.abs(s.players[0].px - states[0].players[0].px) < 1e-7);
});

test('bomb: a new flame does not inherit ownership from already harmless embers', () => {
  const g = createGame(harness({ mode: 2 }).env);
  walkTo(g, 0, 3, 1);
  walkTo(g, 1, 7, 1);
  g.update(1 / 120, input([], ['Space']));
  for (let i = 0; i < 48; i++) g.update(1 / 120, input());
  g.update(1 / 120, input([], ['Enter']));
  walkTo(g, 0, 4, 3);
  walkTo(g, 1, 9, 2);
  let flame;
  for (let i = 0; i < 400; i++) {
    g.update(1 / 120, input());
    flame = g
      .getState()
      .flames.find((f) => f.x === 5 && f.y === 1 && f.active && f.owners.includes(1));
    if (flame) break;
  }
  assert(flame);
  assert.deepEqual(flame.owners, [1]);
});

test('bomb: duel HUD identifies both independent inventories without a campaign heading', () => {
  for (const lang of ['en', 'zh']) {
    const g = createGame(harness({ mode: 2, lang }).env),
      words = [];
    const ctx = mockContext();
    ctx.fillText = (text) => words.push(String(text));
    g.draw(ctx);
    assert(words.some((s) => s.includes(lang === 'en' ? 'DUEL' : '对决')));
    assert(
      words.some((s) => s.includes(lang === 'en' ? 'P1 RANGE 2 BOMBS 1' : '玩家1 火力2 炸弹1')),
    );
    assert(
      words.some((s) => s.includes(lang === 'en' ? 'P2 RANGE 2 BOMBS 1' : '玩家2 火力2 炸弹1')),
    );
    assert(!words.some((s) => s.includes(lang === 'en' ? 'GARDEN 1/6' : '花园 1/6')));
  }
});

test('bomb: a retry restores a safe physical start without farming upgrades or score', () => {
  const g = createGame(harness({ seed: 4 }).env),
    initial = g.getState();
  g.update(1 / 120, input([], ['Space']));
  while (g.getState().lives === 3) g.update(1 / 120, input());
  assert.equal(g.getState().lives, 2);
  while (g.getState().respawn > 0) g.update(1 / 120, input());
  const fresh = g.getState();
  assert.deepEqual(fresh.board, initial.board);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.players[0].px, 1);
  assert.equal(fresh.players[0].py, 1);
  assert.equal(fresh.players[0].range, 2);
  assert.equal(fresh.bombs.length, 0);
  assert.equal(fresh.flames.length, 0);
  assert.equal(fresh.fronts.length, 0);
  walkTo(g, 0, 3, 2);
  assert(fresh.players[0].alive);
});
test('bomb: front travel time is visible and inactive charges never damage on contact', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 3, 2);
  while (g.getState().bombs.length) g.update(1 / 240, input());
  let s = g.getState();
  assert.equal(s.flames.length, 1);
  assert.equal(s.fronts.length, 4);
  assert(s.players.every((p) => p.alive));
  for (let i = 0; i < 5; i++) g.update(1 / 240, input());
  s = g.getState();
  assert.equal(s.flames.length, 1);
  for (let i = 0; i < 7; i++) g.update(1 / 240, input());
  s = g.getState();
  assert(s.flames.length > 1);
  assert(!s.flames.some((f) => f.x === 3 && f.y === 1));
});
test('bomb: all public state including flame owners is detached from the running world', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 3, 2);
  while (g.getState().bombs.length) g.update(1 / 240, input());
  const s = g.getState();
  s.flames[0].owners.push(999);
  s.players[0].direction[0] = 99;
  s.board[0][0] = 0;
  const actual = g.getState();
  assert(!actual.flames[0].owners.includes(999));
  assert.notEqual(actual.players[0].direction[0], 99);
  assert.equal(actual.board[0][0], 1);
});
test('bomb: pointer and touch-equivalent actions have the same movement and bomb rules', () => {
  const g = createGame(harness({ mode: 2 }).env);
  g.update(1 / 120, input(['KeyD', 'ArrowLeft']));
  assert(g.getState().players[0].moving);
  assert(g.getState().players[1].moving);
  const p = createGame(harness().env);
  p.update(1 / 120, input([], [], { x: 90, y: 87, clicked: true, down: true }));
  while (p.getState().players[0].moving) p.update(1 / 120, input());
  assert.equal(p.getState().players[0].x, 2);
  p.update(1 / 120, input([], [], { x: 90, y: 87, clicked: true, down: true }));
  assert.equal(p.getState().bombs.length, 1);
});
test('bomb: invalid time is ignored and seeded prolonged play stays finite and bounded', () => {
  const g = createGame(harness({ seed: 11 }).env),
    initial = g.getState();
  for (const dt of [0, -1, NaN, Infinity]) g.update(dt, input(['KeyD'], ['Space']));
  assert.deepEqual(g.getState(), initial);
  for (let i = 0; i < 12000 && g.getState().phase === 'playing'; i++) {
    const key = ['KeyD', 'KeyS', 'KeyA', 'KeyW'][Math.floor(i / 90) % 4];
    g.update(1 / 60, input([key], i % 150 === 0 ? ['Space'] : []));
    if (i % 120 === 0) {
      const s = g.getState(),
        finite = (v) => {
          if (typeof v === 'number') assert(Number.isFinite(v));
          else if (v && typeof v === 'object') for (const child of Object.values(v)) finite(child);
        };
      finite(s);
      assert(s.bombs.length < 12);
      assert(s.fronts.length < 80);
      assert(s.flames.length < 120);
    }
  }
});
