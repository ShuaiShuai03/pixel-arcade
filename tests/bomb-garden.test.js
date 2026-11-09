import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta, blastCells, GARDEN_COUNT } from '../src/games/bomb-garden.js';
import {
  GARDENS,
  DUEL_ARENA,
  ROLES,
  FEATURES,
  parseGarden,
} from '../src/games/bomb-garden-gardens.js';
import {
  COLS,
  ROWS,
  FUSE,
  WET_FUSE,
  BARREL_DELAY,
  OX,
  OY,
  CELL,
  blastPlan,
  blastReach,
  frontReach,
  walkingDistances,
  menuCell,
  menuHit,
} from '../src/games/bomb-garden-rules.js';
import { harness, input, mockContext } from './harness.js';

const key = (x, y) => `${x},${y}`;
const step = (g, n, h = [], p = []) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, input(h, i ? [] : p));
};
const CJK = /[一-鿿]/;
const cellKey = key;

/** A game that behaves like the host: garden `level` is unlocked and, above 1, chosen from the select. */
function openAt(level, { seed = 1, lang = 'en' } = {}) {
  const h = harness({ seed, lang }),
    calls = [];
  let unlocked = level;
  h.env.progress = {
    unlocked: () => unlocked,
    unlock: (n) => {
      calls.push(n);
      unlocked = Math.max(unlocked, n);
    },
  };
  const g = createGame(h.env);
  if (level > 1) g.update(1 / 60, input([], ['Space']));
  return { g, h, calls };
}
const withStore = (progress, opts) => {
  const h = harness(opts);
  if (progress !== undefined) h.env.progress = progress;
  return { h, g: createGame(h.env) };
};

// --- rules ---------------------------------------------------------------------------------------
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

test('bomb: a barrel is hit and stops the jet, and its own range-2 cross chains into more barrels', () => {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  board[4][4] = 3; // first barrel
  board[4][6] = 3; // second barrel, inside the first one's cross
  board[2][4] = 2; // a crate shields everything behind it from the barrel's northern jet
  board[1][4] = 2;
  const plan = blastPlan(board, 2, 4, 2);
  assert.deepEqual(plan.cells, [
    [2, 4],
    [1, 4],
    [0, 4],
    [2, 5],
    [2, 6],
    [2, 3],
    [2, 2],
    [3, 4],
    [4, 4],
  ]);
  const chained = new Set(plan.chained.map(([x, y]) => key(x, y)));
  for (const c of ['4,3', '4,5', '4,6', '5,4', '6,4', '7,4', '8,4', '6,3', '6,5', '6,2', '6,6'])
    assert.ok(chained.has(c), `chained ${c}`);
  assert.ok(!chained.has('4,1'), 'the crate at 4,2 stops the barrel jet');
  assert.ok(!chained.has('3,4'), 'cells the direct cross already burns are not listed twice');
  assert.equal(blastReach(board, 2, 4, 2).length, plan.cells.length + plan.chained.length);
  const before = JSON.stringify(board);
  blastPlan(board, 2, 4, 2);
  assert.equal(JSON.stringify(board), before, 'planning never mutates the board');
});

test('bomb: crates an earlier barrel jet breaks no longer shield the barrels that follow it', () => {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  board[4][2] = 3; // barrel one, hit by the bomb
  board[3][2] = 3; // barrel two, north of barrel one
  board[3][3] = 3; // barrel three, east of barrel two
  board[4][3] = 2; // a crate east of barrel one and south of barrel three
  const plan = blastPlan(board, 0, 4, 2);
  const chained = new Set(plan.chained.map(([x, y]) => key(x, y)));
  assert.ok(chained.has('3,4'), 'barrel one breaks the crate');
  assert.ok(
    chained.has('3,5'),
    'so barrel three, which goes off later, burns past where the crate stood',
  );
  assert.ok(chained.has('2,1') && chained.has('1,3'), 'barrel two adds its own cross');
  board[4][3] = 1; // with a wall there nothing passes
  assert.ok(!blastPlan(board, 0, 4, 2).chained.some(([x, y]) => x === 3 && y === 5));
});

test('bomb: jets in flight also reach the barrels on their path', () => {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  board[4][5] = 3;
  const cells = frontReach(board, { x: 3, y: 4, dx: 1, dy: 0, remaining: 4 }).map(([x, y]) =>
    key(x, y),
  );
  assert.deepEqual(cells.slice(0, 2), ['3,4', '4,4']);
  assert.ok(cells.includes('5,4') && cells.includes('5,2') && cells.includes('7,4'));
  assert.ok(
    !cells.includes('6,4') || cells.includes('7,4'),
    'the front stops at the barrel itself',
  );
  board[4][4] = 1;
  assert.deepEqual(frontReach(board, { x: 3, y: 4, dx: 1, dy: 0, remaining: 4 }), [[3, 4]]);
});

test('bomb: walking distances follow floor only and menu tiles are hit exactly', () => {
  const board = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 2, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  const d = walkingDistances(board, 1, 1);
  assert.equal(d.get('3,3'), 4);
  assert.equal(d.get('3,1'), undefined, 'a crate blocks the walk');
  assert.equal(d.get('2,2'), undefined);
  const first = menuCell(1),
    second = menuCell(2);
  assert.equal(menuHit(first.x, first.y, 22), 1);
  assert.equal(menuHit(first.x + first.w - 1, first.y + first.h - 1, 22), 1);
  assert.equal(menuHit(second.x, second.y, 22), 2);
  assert.equal(menuHit(first.x + first.w + 1, first.y + 1, 22), 0, 'the gap between tiles');
  assert.equal(menuHit(menuCell(7).x + 3, menuCell(7).y + 3, 22), 7);
  assert.equal(menuHit(menuCell(5).x + 3, menuCell(5).y + 3, 4), 0, 'beyond the garden count');
  assert.equal(menuHit(-5, -5, 22), 0);
});

// --- data ----------------------------------------------------------------------------------------
test('bomb: at least twenty distinct, bilingual gardens are authored as data', () => {
  assert.ok(GARDEN_COUNT >= 20 && GARDEN_COUNT === GARDENS.length);
  assert.equal(new Set(GARDENS.map((g) => g.id)).size, GARDEN_COUNT);
  assert.equal(
    new Set(GARDENS.map((g) => g.rows.join(''))).size,
    GARDEN_COUNT,
    'no two layouts match',
  );
  for (const g of GARDENS) {
    assert.ok(/^[A-Za-z' ]+$/.test(g.name.en) && CJK.test(g.name.zh), g.id);
    assert.ok(
      g.tip.en.length > 20 && g.tip.en.length <= 74,
      `${g.id} EN tip is ${g.tip.en.length} chars`,
    );
    assert.ok(
      CJK.test(g.tip.zh) && g.tip.zh.length <= 44,
      `${g.id} ZH tip is ${g.tip.zh.length} chars`,
    );
    assert.ok(g.time >= 150 && g.time <= 240 && g.pace >= 0.5 && g.pace <= 1.5, g.id);
    assert.ok(g.foes.length >= 1 && g.foes.length <= 4 && g.crates >= 8, g.id);
    assert.equal(g.board.length, ROWS);
    assert.ok(g.board.every((row) => row.length === COLS));
  }
});

test('bomb: every garden is fair: the start has an escape, every floor is reachable and rivals begin far away', () => {
  for (const [i, g] of GARDENS.entries()) {
    const board = g.board.map((row) => [...row]);
    // Cells reachable once every crate and barrel is gone: no sealed pockets, every rival reachable.
    const open = board.map((row) => row.map((c) => (c === 1 ? 1 : 0)));
    const reach = walkingDistances(open, 1, 1);
    assert.equal(
      reach.size,
      open.flat().filter((c) => c === 0).length,
      `${g.id} has a sealed pocket`,
    );
    for (const [x, y] of g.foes) {
      assert.equal(board[y][x], 0, `${g.id} rival starts on floor`);
      assert.ok(reach.get(key(x, y)) >= 6, `${g.id} rival at ${x},${y} starts too close`);
      const room = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => board[y + dy][x + dx] === 0);
      assert.ok(room.length >= 2, `${g.id} rival at ${x},${y} starts boxed in`);
      assert.ok(
        !g.drops.some(([k]) => walkingDistances(open, x, y).get(k) <= 2),
        `${g.id} an upgrade crate sits next to a rival spawn`,
      );
    }
    // A bomb dropped at the start can be outrun: a walk through free cells leaves its cross.
    const cross = new Set(blastCells(board, 1, 1, 2).map(([x, y]) => key(x, y)));
    const free = walkingDistances(board, 1, 1);
    const exits = [...free.entries()].filter(([k, n]) => !cross.has(k) && n <= 8);
    assert.ok(exits.length > 0, `${g.id} start is a trap (garden ${i + 1})`);
    assert.ok(board[1][2] === 0 && board[2][1] === 0, `${g.id} start cells are open`);
  }
});

test('bomb: features arrive one at a time, in order, and each garden tip names what is new', () => {
  const seen = new Set(),
    order = [];
  const featuresOf = (g) =>
    new Set([
      ...(g.drops.length ? ['upgrade'] : []),
      ...g.foes.map((f) => f[2]).filter((r) => r !== 'bomber'),
      ...(g.board.some((row, y) =>
        row.some(
          (c, x) =>
            c === 1 &&
            x > 0 &&
            y > 0 &&
            x < COLS - 1 &&
            y < ROWS - 1 &&
            !(x % 2 === 0 && y % 2 === 0),
        ),
      )
        ? ['wall']
        : []),
      ...(g.wet.length ? ['wet'] : []),
      ...(g.barrels ? ['barrel'] : []),
    ]);
  const words = {
    basics: [/bomb/i, /炸弹/],
    upgrade: [/upgrade/i, /升级/],
    scout: [/scout/i, /斥候/],
    wall: [/wall/i, /墙/],
    warden: [/warden/i, /守卫/],
    wet: [/wet/i, /湿地/],
    barrel: [/barrel/i, /堆肥桶/],
  };
  GARDENS.forEach((g, i) => {
    const fresh = [...featuresOf(g)].filter((f) => !seen.has(f)).sort();
    const expected = (i === 0 ? ['basics'] : []).concat(fresh).sort();
    assert.deepEqual([...g.news].sort(), expected, `${g.id} introduces ${expected}`);
    assert.ok(g.news.length <= 1, `${g.id} introduces more than one thing`);
    for (const f of g.news) {
      assert.ok(FEATURES.includes(f));
      assert.match(g.tip.en, words[f][0], `${g.id} EN tip names ${f}`);
      assert.match(g.tip.zh, words[f][1], `${g.id} ZH tip names ${f}`);
      order.push(f);
    }
    fresh.forEach((f) => seen.add(f));
  });
  assert.deepEqual(order, FEATURES, 'crates, upgrades, scouts, walls, wardens, wet soil, barrels');
  assert.ok(
    GARDENS.findIndex((g) => g.news.includes('barrel')) >= 6,
    'barrels come after the first rivals',
  );
});

test('bomb: tips state only facts the rules back up', () => {
  const allowedSeconds = (g) => new Set([FUSE, WET_FUSE, BARREL_DELAY, g.time]);
  for (const g of GARDENS) {
    for (const m of g.tip.en.matchAll(/(\d+(?:\.\d+)?) ?s\b/g))
      assert.ok(allowedSeconds(g).has(Number(m[1])), `${g.id} tip claims ${m[0]}`);
    for (const m of g.tip.zh.matchAll(/(\d+(?:\.\d+)?)秒/g))
      assert.ok(allowedSeconds(g).has(Number(m[1])), `${g.id} ZH tip claims ${m[0]}`);
    for (const role of Object.values(ROLES)) {
      if (g.tip.en.includes(`(${role.letter.en})`))
        assert.ok(g.tip.en.includes(role.name.en + 's') || g.tip.en.includes(role.name.en), g.id);
      if (g.tip.zh.includes(`（${role.letter.zh}）`))
        assert.ok(g.tip.zh.includes(role.name.zh), g.id);
    }
    if (/wet/i.test(g.tip.en)) assert.ok(g.wet.length > 0, `${g.id} talks about wet soil`);
    if (/barrel/i.test(g.tip.en)) assert.ok(g.barrels > 0, `${g.id} talks about barrels`);
    const ten = g.tip.en.match(/\b(Two|Three|Four|Ten) /);
    if (/Ten barrels/.test(g.tip.en)) assert.equal(g.barrels, 10);
    if (/Two wardens/.test(g.tip.en))
      assert.equal(g.foes.filter((f) => f[2] === 'warden').length, 2);
    if (/Two scouts/.test(g.tip.en)) assert.equal(g.foes.filter((f) => f[2] === 'scout').length, 2);
    if (/Four rivals/.test(g.tip.en)) assert.equal(g.foes.length, 4);
    if (/Only 150 s/.test(g.tip.en)) assert.equal(g.time, 150);
    assert.ok(ten === null || ten[1].length > 2);
  }
  assert.equal(ROLES.warden.range, 3, 'the warden tip says jets reach 3 cells');
  assert.equal(ROLES.warden.stamina, 3, 'and that wardens rest after 3 steps');
  assert.equal(BARREL_DELAY, 0.18);
  assert.ok(FUSE === 2.4 && WET_FUSE === 3);
});

test('bomb: malformed gardens are rejected with a clear message', () => {
  const good = GARDENS[0];
  const edit = (change) => parseGarden({ ...good, rows: change(good.rows) });
  const row = (n, f) => (rows) => rows.map((r, y) => (y === n ? f(r) : r));
  assert.throws(() => edit((r) => r.slice(1)), /needs 9 rows/);
  assert.throws(() => edit(row(3, (r) => r + '.')), /row 3 is ragged/);
  assert.throws(() => edit(row(3, (r) => r.replace('.', '?'))), /unknown symbol "\?"/);
  assert.throws(() => edit(row(0, (r) => '.' + r.slice(1))), /0,0 must be a wall/);
  assert.throws(() => edit(row(2, (r) => r.slice(0, 2) + '.' + r.slice(3))), /2,2 must be a wall/);
  assert.throws(() => edit(row(1, (r) => r.replace('@', '.'))), /gardener starts at 1,1/);
  assert.throws(() => edit(row(1, (r) => r.replace('@.', '.@'))), /gardener starts at 1,1/);
  assert.throws(() => parseGarden({ ...good, pace: 0.1 }), /pace must be between/);
  assert.throws(() => parseGarden({ ...good, pace: undefined }), /pace must be between/);
  const parsed = parseGarden(good);
  assert.ok(
    Object.isFrozen(parsed) && Object.isFrozen(parsed.board) && Object.isFrozen(parsed.foes),
  );
  assert.equal(parsed.crates, good.crates);
  assert.equal(DUEL_ARENA.start2.join(), '13,7');
});

test('bomb: the duel arena is point-symmetric with both starts open', () => {
  const b = DUEL_ARENA.board;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      assert.equal(b[y][x], b[ROWS - 1 - y][COLS - 1 - x], `${x},${y}`);
  assert.deepEqual(DUEL_ARENA.start, [1, 1]);
  assert.equal(DUEL_ARENA.foes.length, 0);
  assert.equal(DUEL_ARENA.wet.length + DUEL_ARENA.drops.length + DUEL_ARENA.barrels, 0);
  const s = createGame(harness({ mode: 2 }).env).getState();
  assert.equal(s.totalLevels, 1);
  assert.equal(s.garden.en, 'Symmetric Duel Arena');
});

// --- meta ----------------------------------------------------------------------------------------
test('bomb: the description says what clears a garden and how many there are; keys and touch cover every action', () => {
  assert.match(meta.description.en, new RegExp(`Defeat every rival.*all ${GARDEN_COUNT} gardens`));
  assert.match(meta.description.zh, new RegExp(`击败所有对手.*共${GARDEN_COUNT}座`));
  assert.ok(!/six|六/i.test(meta.description.en + meta.description.zh));
  for (const word of ['walls', 'crates', 'barrels', 'wet', 'progress is saved'])
    assert.ok(meta.description.en.includes(word), word);
  assert.ok(meta.description.zh.includes('进度自动保存') && meta.description.zh.includes('堆肥桶'));
  const solo = meta.touchControls.map((c) => c.code).sort();
  assert.deepEqual(solo, ['KeyA', 'KeyD', 'KeyS', 'KeyW', 'Space']);
  assert.ok(
    meta.touchControls.every(
      (c) => (c.side === 'left' || c.side === 'right') && c.label.en && c.label.zh,
    ),
  );
  assert.equal(meta.multiplayerTouchControls.length, 10);
  assert.ok(meta.keys.every((k) => k.label.en && k.label.zh && k.keys.en && k.keys.zh));
  assert.ok(meta.keys.some((k) => /select/i.test(k.label.en) && k.keys.zh.includes('空格')));
  assert.equal(meta.id, 'bomb-garden');
  assert.equal(meta.players, '1-2');
});

test('bomb: the HUD names barrels among the things that stop jets, in both languages', () => {
  for (const [lang, text] of [
    ['en', 'WALLS / CRATES / BARRELS STOP JETS'],
    ['zh', '墙壁 / 木箱 / 堆肥桶可挡喷焰'],
  ])
    for (const mode of [1, 2]) {
      const words = [],
        ctx = mockContext();
      ctx.fillText = (t) => words.push(String(t));
      createGame(harness({ mode, lang }).env).draw(ctx);
      assert.ok(words.includes(text), `${lang} mode ${mode}`);
    }
});

// --- progress and the garden select ----------------------------------------------------------------
test('bomb: progress is read safely: no store, junk values and a throwing store all start at garden 1', () => {
  const throwing = {
    unlocked() {
      throw new Error('storage blocked');
    },
    unlock() {
      throw new Error('storage blocked');
    },
  };
  const variants = [
    undefined,
    null,
    {},
    { unlocked: () => 'x', unlock() {} },
    { unlocked: () => NaN, unlock() {} },
    { unlocked: () => 0, unlock() {} },
    { unlocked: () => -4, unlock() {} },
    { unlocked: () => -Infinity, unlock() {} },
    { unlocked: () => null, unlock() {} },
    { unlocked: () => undefined, unlock() {} },
    { unlocked: () => ({}), unlock() {} },
    { unlocked: () => 1, unlock() {} },
    { unlocked: 7 },
    throwing,
  ];
  for (const progress of variants) {
    const { g } = withStore(progress);
    const s = g.getState();
    assert.equal(s.menu, null, JSON.stringify(progress));
    assert.equal(s.level, 1);
    step(g, 30);
    assert.ok(g.getState().elapsed > 0, 'the game runs straight away');
  }
});

test('bomb: a saved progress opens the select at the highest unlocked garden, clamped to the last', () => {
  for (const [saved, cursor] of [
    [5, 5],
    ['6', 6],
    [3.9, 3],
    [GARDEN_COUNT, GARDEN_COUNT],
    [999, GARDEN_COUNT],
    [Infinity, GARDEN_COUNT],
    [true, 1],
  ]) {
    const { g } = withStore({ unlocked: () => saved, unlock() {} });
    const m = g.getState().menu;
    if (cursor === 1) assert.equal(m, null, String(saved));
    else assert.deepEqual(m, { cursor, unlocked: cursor }, String(saved));
  }
});

test('bomb: the duel never reads or writes progress and has no select', () => {
  const calls = [];
  const { g } = withStore(
    {
      unlocked: () => (calls.push('read'), 9),
      unlock: () => calls.push('write'),
    },
    { mode: 2 },
  );
  step(g, 120);
  assert.equal(g.getState().menu, null);
  assert.deepEqual(calls, []);
});

test('bomb: the select moves with arrows and WASD, clamps, and the clock does not run while choosing', () => {
  const { g } = withStore({ unlocked: () => 8, unlock() {} });
  const press = (...codes) => g.update(1 / 60, input([], codes));
  const cursor = () => g.getState().menu.cursor;
  assert.equal(cursor(), 8);
  press('ArrowLeft');
  assert.equal(cursor(), 7);
  press('KeyA');
  assert.equal(cursor(), 6);
  press('ArrowRight');
  press('ArrowRight');
  press('ArrowRight');
  assert.equal(cursor(), 8, 'clamped at the highest unlocked garden');
  press('ArrowUp');
  assert.equal(cursor(), 2, 'a row up is six gardens back');
  press('ArrowUp');
  assert.equal(cursor(), 1, 'and clamps at garden 1');
  press('KeyS');
  assert.equal(cursor(), 7);
  press('KeyW', 'KeyD');
  assert.equal(cursor(), 2);
  step(g, 240, ['KeyD']);
  assert.equal(g.getState().elapsed, 0);
  assert.equal(g.getState().time, GARDENS[0].time, 'the garden clock waits');
  assert.match(g.getState().status.en, /Choose a garden/);
  assert.match(g.getState().status.zh, /选择花园/);
  g.update(NaN, input([], ['Space']));
  g.update(-1, input([], ['Space']));
  assert.ok(g.getState().menu, 'bad frame times are ignored in the select too');
  press('Enter');
  const s = g.getState();
  assert.equal(s.menu, null);
  assert.equal(s.level, 2);
  assert.equal(s.lives, 3);
  assert.equal(s.score, 0);
  assert.equal(s.garden.en, GARDENS[1].name.en);
  assert.deepEqual(s.tip, GARDENS[1].tip);
});

test('bomb: Space, Enter and J each start the chosen garden', () => {
  for (const code of ['Space', 'Enter', 'KeyJ']) {
    const { g } = withStore({ unlocked: () => 4, unlock() {} });
    g.update(1 / 60, input([], ['ArrowLeft']));
    g.update(1 / 60, input([], [code]));
    assert.equal(g.getState().level, 3, code);
    assert.equal(g.getState().menu, null);
  }
});

test('bomb: the select by tap: first tap chooses, second starts, locked tiles explain, gaps are ignored', () => {
  const { g } = withStore({ unlocked: () => 5, unlock() {} });
  const tap = (n, dx = 8, dy = 8) => {
    const q = menuCell(n);
    g.update(1 / 60, input([], [], { x: q.x + dx, y: q.y + dy, clicked: true, down: true }));
  };
  tap(2);
  assert.equal(g.getState().menu.cursor, 2);
  tap(9);
  assert.equal(g.getState().menu.cursor, 2, 'a locked garden cannot be chosen');
  const note = [];
  const ctx = mockContext();
  ctx.fillText = (t) => note.push(String(t));
  g.draw(ctx);
  assert.ok(note.some((t) => t.includes('Clear garden 5 first.')));
  step(g, 130);
  const later = [];
  ctx.fillText = (t) => later.push(String(t));
  g.draw(ctx);
  assert.ok(!later.some((t) => t.includes('Clear garden 5 first.')), 'the note fades');
  g.update(1 / 60, input([], [], { x: 2, y: 2, clicked: true }));
  assert.equal(g.getState().menu.cursor, 2, 'outside every tile');
  const q = menuCell(1);
  g.update(1 / 60, input([], [], { x: q.x + q.w + 2, y: q.y + 4, clicked: true }));
  assert.equal(g.getState().menu.cursor, 2, 'between two tiles');
  tap(2);
  assert.equal(g.getState().menu, null);
  assert.equal(g.getState().level, 2);
});

test('bomb: the select and every garden draw in both languages without text outside the canvas', () => {
  for (const lang of ['en', 'zh']) {
    const { g } = withStore({ unlocked: () => GARDEN_COUNT, unlock() {} }, { lang });
    const words = [];
    const ctx = mockContext();
    ctx.fillText = (t) => words.push(String(t));
    g.draw(ctx);
    assert.ok(words.some((w) => w.includes(lang === 'en' ? 'CHOOSE A GARDEN' : '选择花园')));
    assert.ok(words.includes(String(GARDEN_COUNT)));
    assert.ok(words.some((w) => w.includes(GARDENS[GARDEN_COUNT - 1].tip[lang])));
    for (let n = 1; n <= GARDEN_COUNT; n++) {
      const { g: game } = openAt(n, { lang });
      game.draw(mockContext());
      step(game, 400);
      game.draw(mockContext());
    }
  }
});

// --- core rules in play ------------------------------------------------------------------------------
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
  assert.equal(h.ends[0].won, false);
  assert.match(h.ends[0].message, /Out of hearts/);
  assert.equal(createGame(h.env).getState().bombs.length, 0);
});

test('bomb: walls stop walking and movement respects repeat cadence', () => {
  const g = createGame(harness().env);
  step(g, 90, ['ArrowLeft']);
  assert.equal(g.getState().players[0].x, 1);
  step(g, 12, ['ArrowRight']);
  assert.ok(g.getState().players[0].x >= 2);
});

test('bomb: the garden clock ends a solo run with a loss and one callback, in both languages', () => {
  for (const [lang, message] of [
    ['en', 'Time is up. Find a faster route.'],
    ['zh', '时间到，请寻找更快的路线。'],
  ]) {
    const h = harness({ lang, seed: 2 }),
      g = createGame(h.env);
    for (let i = 0; i < 30 * (GARDENS[0].time + 3) && g.getState().phase === 'playing'; i++)
      g.update(1 / 30, input());
    const s = g.getState();
    assert.equal(s.phase, 'lost', lang);
    assert.equal(s.lives, 3, 'a time-out is not a lost heart');
    assert.deepEqual(h.ends, [{ won: false, score: 0, message }]);
    const frozen = JSON.stringify(s);
    step(g, 60, ['KeyD'], ['Space']);
    assert.equal(JSON.stringify(g.getState()), frozen);
    assert.equal(h.ends.length, 1);
  }
});

test('bomb: a duel that runs out of time is a draw, reported once, in both languages', () => {
  for (const [lang, message] of [
    ['en', 'Time is up. The duel is a draw.'],
    ['zh', '时间到，双方平局。'],
  ]) {
    const h = harness({ mode: 2, lang }),
      g = createGame(h.env);
    for (let i = 0; i < 30 * 185 && g.getState().phase === 'playing'; i++)
      g.update(1 / 30, input());
    assert.equal(g.getState().phase, 'lost');
    assert.deepEqual(h.ends, [{ won: false, score: 0, message }]);
    assert.ok(g.getState().players.every((p) => p.alive));
  }
});

test('bomb: a duel win for either player names the winner; only Player 1 is reported as a win', () => {
  // The host has one win flag, so (like Paddle Duel and Ember Knights) a Player 2 win is won:false
  // and the message carries the result.
  for (const [lang, p1, p2] of [
    ['en', 'Player 1 wins the garden!', 'Player 2 wins the garden!'],
    ['zh', '玩家1赢得花园对决！', '玩家2赢得花园对决！'],
  ]) {
    const first = harness({ mode: 2, lang }),
      a = createGame(first.env);
    a.update(1 / 120, input([], ['Enter'])); // Player 2 blows themself up
    for (let i = 0; i < 400 && a.getState().phase === 'playing'; i++) a.update(1 / 120, input());
    assert.equal(a.getState().phase, 'won');
    assert.deepEqual(
      a.getState().players.map((p) => p.alive),
      [true, false],
    );
    assert.deepEqual(first.ends, [{ won: true, score: 0, message: p1 }]);
    assert.ok(first.sounds.includes('win'));
    const second = harness({ mode: 2, lang }),
      b = createGame(second.env);
    b.update(1 / 120, input([], ['Space'])); // Player 1 blows themself up
    for (let i = 0; i < 400 && b.getState().phase === 'playing'; i++) b.update(1 / 120, input());
    assert.equal(b.getState().phase, 'lost');
    assert.deepEqual(
      b.getState().players.map((p) => p.alive),
      [false, true],
    );
    assert.deepEqual(second.ends, [{ won: false, score: 0, message: p2 }]);
    assert.ok(second.sounds.includes('lose'));
  }
});

test('bomb: pointer taps step the gardener in all four directions and a tap on them plants', () => {
  const g = createGame(harness().env);
  const tapAt = (x, y) => g.update(1 / 120, input([], [], { x, y, clicked: true, down: true }));
  const centre = () => {
    const p = g.getState().players[0];
    return [OX + p.px * CELL + 15, OY + p.py * CELL + 15];
  };
  const settle = () => {
    for (let i = 0; i < 40; i++) g.update(1 / 120, input());
  };
  let [cx, cy] = centre();
  tapAt(cx + 60, cy + 3); // east
  settle();
  assert.deepEqual([g.getState().players[0].x, g.getState().players[0].y], [2, 1]);
  [cx, cy] = centre();
  tapAt(cx + 3, cy + 50); // south: the vertical branch
  settle();
  assert.deepEqual(
    [g.getState().players[0].x, g.getState().players[0].y],
    [2, 1],
    '2,2 is a pillar',
  );
  [cx, cy] = centre();
  tapAt(cx - 60, cy - 3); // west
  settle();
  tapAt(...centre().map((v, i) => v + (i ? 50 : 3))); // south again from 1,1
  settle();
  assert.deepEqual([g.getState().players[0].x, g.getState().players[0].y], [1, 2]);
  [cx, cy] = centre();
  tapAt(cx + 2, cy - 55); // north: the other vertical sign
  settle();
  assert.deepEqual([g.getState().players[0].x, g.getState().players[0].y], [1, 1]);
  [cx, cy] = centre();
  tapAt(cx + 1, cy + 1);
  assert.equal(g.getState().bombs.length, 1);
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
  s.tip.en = 'changed';
  s.news.push('x');
  const actual = g.getState();
  assert(!actual.flames[0].owners.includes(999));
  assert.notEqual(actual.players[0].direction[0], 99);
  assert.equal(actual.board[0][0], 1);
  assert.notEqual(actual.tip.en, 'changed');
});

test('bomb: bombs on wet soil burn 3 s, dry soil 2.4 s, and the banner no longer promises one fuse', () => {
  const dry = openAt(8).g;
  walkTo(dry, 0, 3, 3);
  dry.update(1 / 120, input([], ['Space']));
  assert.ok(Math.abs(dry.getState().bombs[0].fuse - FUSE) < 0.02);
  const wet = openAt(8).g;
  walkTo(wet, 0, 4, 3);
  assert.ok(wet.getState().wetCells.some(([x, y]) => x === 4 && y === 3));
  wet.update(1 / 120, input([], ['Space']));
  assert.ok(Math.abs(wet.getState().bombs[0].fuse - WET_FUSE) < 0.02);
  for (const lang of ['en', 'zh']) {
    const { g } = openAt(8, { lang }),
      words = [],
      ctx = mockContext();
    ctx.fillText = (t) => words.push(String(t));
    g.draw(ctx);
    assert.ok(!words.some((w) => /2\.4s FUSE|2\.4秒引信/.test(w)), 'no fixed fuse claim');
    assert.ok(words.includes(GARDENS[7].tip[lang]));
  }
  const duel = [],
    ctx = mockContext();
  ctx.fillText = (t) => duel.push(String(t));
  createGame(harness({ mode: 2 }).env).draw(ctx);
  assert.ok(
    duel.some((w) => w.includes('2.4s FUSE')),
    'the dry duel arena says 2.4 s',
  );
});

test('bomb: authored upgrades are guaranteed: a later blast burns their cell but never destroys them', () => {
  const { g } = openAt(2);
  walkTo(g, 0, 2, 1);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 1, 2);
  while (g.getState().bombs.length) g.update(1 / 120, input());
  for (let i = 0; i < 200; i++) g.update(1 / 120, input());
  const dropped = () => g.getState().pickups.filter((p) => p.x === 4 && p.y === 1);
  assert.equal(dropped().length, 1, 'the range upgrade is on the ground');
  assert.equal(dropped()[0].type, 'range');
  walkTo(g, 0, 2, 1);
  g.update(1 / 120, input([], ['Space']));
  walkTo(g, 0, 1, 2);
  const burned = new Set();
  while (
    g.getState().bombs.length ||
    g.getState().fronts.length ||
    g.getState().flames.some((f) => f.active)
  ) {
    g.update(1 / 120, input());
    for (const f of g.getState().flames) burned.add(key(f.x, f.y));
  }
  assert.ok(burned.has('4,1'), 'the second blast really crossed the upgrade');
  assert.equal(dropped().length, 1, 'the upgrade survived');
  walkTo(g, 0, 4, 1);
  const s = g.getState();
  assert.equal(s.players[0].range, 3);
  assert.equal(s.pickups.length, 0);
  assert.ok(s.score >= 25);
});

test('bomb: a barrel hit by a jet explodes 0.18 s later with range 2, and its whole cross is previewed', () => {
  const { g } = openAt(11);
  walkTo(g, 0, 3, 3);
  g.update(1 / 120, input([], ['Space']));
  const planted = g.getState();
  const plan = blastPlan(planted.board, 3, 3, planted.players[0].range);
  const expected = new Set([...plan.cells, ...plan.chained].map(([x, y]) => key(x, y)));
  assert.ok(plan.chained.length >= 8, 'two barrels add two crosses');
  assert.deepEqual(new Set(planted.danger.map(([x, y]) => key(x, y))), expected);
  for (const c of ['5,2', '5,4', '5,6', '3,5'])
    assert.ok(expected.has(c), `${c} is in the preview`);
  // The picture: direct cells in the pale jet colour, barrel cells in orange.
  const marks = new Map(),
    ctx = mockContext();
  ctx.fillRect = (x, y, w, h) => {
    if (w === 6 && h === 6) marks.set(`${x},${y}`, ctx.fillStyle);
  };
  g.draw(ctx);
  for (const [x, y] of plan.chained)
    assert.ok(
      /^#ff7a4f/.test(marks.get(`${OX + x * CELL + 12},${OY + y * CELL + 12}`)),
      `orange at ${x},${y}`,
    );
  for (const [x, y] of plan.cells)
    assert.ok(
      /^#(f3c878|ffc677)/.test(marks.get(`${OX + x * CELL + 12},${OY + y * CELL + 12}`)),
      `jet at ${x},${y}`,
    );
  walkTo(g, 0, 1, 2);
  const burned = new Set();
  let barrelBomb = null;
  while (
    g.getState().bombs.length ||
    g.getState().fronts.length ||
    g.getState().flames.some((f) => f.active)
  ) {
    g.update(1 / 240, input());
    const s = g.getState();
    barrelBomb ??= s.bombs.find((b) => b.barrel);
    for (const f of s.flames) burned.add(key(f.x, f.y));
  }
  assert.ok(barrelBomb && barrelBomb.range === 2 && barrelBomb.fuse <= BARREL_DELAY + 1e-6);
  assert.ok(
    barrelBomb.fuse > BARREL_DELAY - 0.03,
    'it starts the 0.18 s count when the jet arrives',
  );
  for (const c of expected) assert.ok(burned.has(c), `${c} burned`);
  for (const c of burned) assert.ok(expected.has(c), `${c} burned outside the preview`);
  const left = g.getState().board;
  assert.equal(left[4][3] + left[3][5] + left[5][5], 0, 'all three barrels in the chain are gone');
  assert.equal(left[3][9], 3, 'the barrels out of reach are not');
});

test('bomb: a travelling jet sets off another charge, and both jets stop at the same crate', () => {
  const g = createGame(harness({ mode: 2 }).env);
  walkTo(g, 1, 5, 1); // Player 2 plants first, at 5,1
  g.update(1 / 120, input([], ['Enter']));
  walkTo(g, 1, 8, 1);
  walkTo(g, 0, 3, 1); // Player 1's charge at 3,1 reaches 5,1 along row 1
  g.update(1 / 120, input([], ['Space']));
  const own = g.getState().bombs.find((b) => b.owner === 0).at;
  walkTo(g, 0, 2, 3);
  const burned = new Set();
  let sooner = Infinity;
  while (
    g.getState().bombs.length ||
    g.getState().fronts.length ||
    g.getState().flames.some((f) => f.active)
  ) {
    g.update(1 / 240, input());
    const s = g.getState();
    for (const f of s.flames) burned.add(key(f.x, f.y));
    if (!s.bombs.some((b) => b.owner === 0)) sooner = Math.min(sooner, s.elapsed);
  }
  assert.ok(sooner < own - 0.2, 'the second charge went off early, set off by the first jet');
  assert.ok(burned.has('5,2') && burned.has('4,1') && burned.has('3,1'));
  assert.ok(!burned.has('5,4'), 'the crate at 5,3 shielded the cell behind it from every jet');
  assert.equal(g.getState().board[3][5], 0, 'and the crate itself broke');
  assert.equal(g.getState().phase, 'playing');
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
    assert(
      !words.some((s) =>
        s.includes(lang === 'en' ? `GARDEN 1/${GARDEN_COUNT}` : `花园 1/${GARDEN_COUNT}`),
      ),
    );
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
