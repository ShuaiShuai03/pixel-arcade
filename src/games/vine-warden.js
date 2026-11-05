import { background, drawPixelText as text, pixelSprite } from '../shared/utils.js';

export const meta = {
  id: 'vine-warden',
  name: { en: 'Vine Warden', zh: '藤蔓守卫' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Guard three greenhouse plots from creeping pests. You carry no weapon: plant seeds with Space on brown soil beside the pest path. A plant needs 6 seconds to grow (seed, sprout, bud, bloom) and only a full bloom has live roots, shown as orange hatched tiles. Roots hold a pest and bite it once every 0.8 seconds; each bloom has 4 bites. Press X facing a bloom to harvest it: 2 seeds back (1 once its bites are spent), so seeds never run out. Weevils sense live roots and take another lane when they can. Every pest that reaches the garden bloom costs 1 of 5 plot health.',
    zh: '守护三个温室花圃，抵御爬行的害虫。你没有武器：按空格键把种子种在虫道旁的棕色泥土上。植物需要6秒成长（种子、幼苗、花苞、盛开），只有盛开的植物才有活跃的根，根会显示为橙色斜纹地砖。根会抓住害虫，每0.8秒咬一口，每株盛开的植物有4口。面对盛开的植物按X收获：返还2颗种子（根的次数用完后返还1颗），所以种子永远不会耗尽。象鼻虫能察觉活跃的根，有路可绕时会改走另一条道。每只抵达花圃之心的害虫会扣1点（共5点）花圃生命。',
  },
  keys: [
    {
      label: { en: 'Walk / turn (tap to turn)', zh: '移动 / 转向（轻点转向）' },
      keys: 'WASD / Arrows',
    },
    { label: { en: 'Plant a seed on soil you face', zh: '在面前的泥土上播种' }, keys: 'Space' },
    { label: { en: 'Harvest the plant you face', zh: '收获面前的植物' }, keys: 'X' },
  ],
  touchControls: [
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['Space', 'Plant', '播种', 'right'],
    ['KeyX', 'Harvest', '收获', 'right'],
  ].map(([code, en, zh, side]) => ({ code, side, label: { en, zh } })),
};

// Times are ticks of 1/120 s. Rules are exported so tests and the HUD agree on the numbers.
export const RULES = Object.freeze({
  tile: 24,
  cols: 20,
  rows: 11,
  top: 28,
  step: 1 / 120,
  maxDt: 0.1,
  moveTicks: 18, // one tile in 0.15 s
  turnTicks: 12, // a key held less than 0.1 s only turns the gardener
  bufferTicks: 30,
  stageTicks: 240, // seed, sprout and bud last 2 s each: a bloom opens 6 s after planting
  charges: 4, // bites per bloom
  biteTicks: 96, // 0.8 s between bites
  reach: 1, // roots cover the 3x3 tiles around the plant
  seedCap: 6,
  harvestFull: 2,
  harvestSpent: 1,
  avoidCost: 4, // extra route cost a wary pest adds for each live-root tile
  avoidCap: 12, // a detour never costs a wary pest more than this, so two rooted lanes tie
  clearTicks: 360,
  messageTicks: 240,
  promptHoldTicks: 72,
  catchScore: 100,
  plotScore: 300,
  healthScore: 100,
});
const { tile: TILE, cols: COLS, rows: ROWS, top: TOP, step: STEP } = RULES;
const FIELD_BOTTOM = TOP + ROWS * TILE;
const GROW_TICKS = RULES.stageTicks * 3;
const SPRITE = 22;
const DIRS = [
  [1, 0],
  [0, 1],
  [0, -1],
  [-1, 0],
];

export const INVADERS = {
  beetle: { hp: 2, ticks: 72, wary: false, name: { en: 'Beetle', zh: '甲虫' } },
  weevil: { hp: 3, ticks: 60, wary: true, name: { en: 'Weevil', zh: '象鼻虫' } },
  hopper: { hp: 2, ticks: 30, wary: false, name: { en: 'Hopper', zh: '跳虫' } },
};

// '#' foliage wall, 'w' wooden walkway (gardener only), 's' soil (plantable), '.' pest path,
// 'G' pest gate, 'h' garden bloom (the pests' goal).
const wave = (start, gap, kinds, gates) =>
  kinds.map((kind, i) => [start + i * gap, gates[i % gates.length], kind]);
const B = 'beetle';
const W = 'weevil';
const H = 'hopper';
export const PLOTS = [
  {
    name: { en: 'Seedling Row', zh: '育苗畦' },
    seeds: 3,
    health: 5,
    start: { c: 6, r: 5 },
    spawns: wave(8, 6, [B, B, B, B, B, B, B, B], [0]),
    map: [
      '####################',
      '#wwwwwwwwwwwwwwwwww#',
      '#wwwssssssswwwwwwww#',
      'G............wwwwww#',
      '#wwwssssssww.wwwwww#',
      '#wwwwwwwwwss.sswwww#',
      '#wwwwwwwwwss.sssssw#',
      '#wwwwwwwwwww.......h',
      '#wwwwwwwwwwwwsssssw#',
      '#wwwwwwwwwwwwwwwwww#',
      '####################',
    ],
  },
  {
    name: { en: 'Twin Lanes', zh: '双车道' },
    seeds: 3,
    health: 5,
    start: { c: 9, r: 5 },
    spawns: wave(8, 5, [B, W, B, W, W, B, W, W, B, W], [0]),
    map: [
      '####################',
      '#wwwwwsssssssswwwww#',
      '#www............www#',
      '#www.ssssssssss.www#',
      '#www.wwwwwwwwww.www#',
      'G....wwwwwwwwww....h',
      '#www.wwwwwwwwww.www#',
      '#www.ssssssssss.www#',
      '#www............www#',
      '#wwwwwsssssssswwwww#',
      '####################',
    ],
  },
  {
    name: { en: 'Greenhouse Crossing', zh: '温室十字口' },
    seeds: 5,
    health: 5,
    start: { c: 6, r: 5 },
    spawns: wave(8, 5, [B, H, W, B, W, H, B, W, H, W, B, H, W, W], [0, 1]),
    map: [
      '####################',
      '#wwwwwwwwwwwwwwwwww#',
      'G........wwwwwwwwww#',
      '#wssswww.ww.....www#',
      '#wwwwwww.ww.sss.www#',
      '#wwwwwww...........h',
      '#wwwwwww.sswssswwww#',
      '#wssswww.wwwwwwwwww#',
      'G........wwwwwwwwww#',
      '#wwwwwwwwwwwwwwwwww#',
      '####################',
    ],
  },
];

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
const tileAt = (s, c, r) => (inGrid(c, r) ? s.grid[r][c] : '#');
const isPath = (ch) => ch === '.' || ch === 'G' || ch === 'h';
const plantAt = (s, c, r) => s.plants.find((p) => p.c === c && p.r === r);
const reaches = (p, c, r) => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= RULES.reach;
const stageOf = (p) => Math.min(3, Math.floor(p.age / RULES.stageTicks));
const isLive = (p) => stageOf(p) === 3 && p.charges > 0;
// A bloom that has bloomed for 15 s without a single bite is idle: no pest uses its lane.
const IDLE_TICKS = 1800;
const isIdle = (p) =>
  isLive(p) && p.charges === RULES.charges && p.grip === null && p.bloomTicks >= IDLE_TICKS;
const tileCenter = (c, r) => ({ x: c * TILE + TILE / 2, y: TOP + r * TILE + TILE / 2 });
const facingOf = (p) => ({ c: p.c + p.facing.dx, r: p.r + p.facing.dy });
const secs = (ticks) => Math.ceil((ticks - 1e-9) * STEP);
const tilesAround = (c, r) => {
  const out = [];
  for (let dr = -RULES.reach; dr <= RULES.reach; dr++)
    for (let dc = -RULES.reach; dc <= RULES.reach; dc++) out.push({ c: c + dc, r: r + dr });
  return out;
};
// Path tiles a plant at (c, r) would cover once it blooms (the heart tile is never rooted).
const rootTilesAt = (s, c, r) =>
  tilesAround(c, r).filter((t) => '.G'.includes(tileAt(s, t.c, t.r)));

export function loadPlot(s, index) {
  const plot = PLOTS[index];
  s.plot = index;
  s.grid = plot.map.map((row) => [...row]);
  s.gates = [];
  s.heart = { c: 0, r: 0 };
  s.usefulSoil = [];
  s.grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (ch === 'G') s.gates.push({ c, r });
      if (ch === 'h') s.heart = { c, r };
      if (ch === 's' && rootTilesAt(s, c, r).length) s.usefulSoil.push({ c, r });
    }),
  );
  Object.assign(s, {
    seeds: plot.seeds,
    health: plot.health,
    plotTicks: 0,
    spawned: 0,
    resolved: 0,
    invaders: [],
    plants: [],
    clear: 0,
    heartFlash: 0,
    rootVer: 0,
    routes: null,
    shownKey: `intro${index + 1}`,
    shownSince: s.ticks,
    player: {
      c: plot.start.c,
      r: plot.start.r,
      from: { ...plot.start },
      left: 0,
      facing: { dx: 1, dy: 0 },
      turn: 0,
      act: 0,
      hurt: 0,
    },
    latch: { plant: 0, harvest: 0 },
    fx: [],
  });
  say(s, `Plot ${index + 1}: ${plot.name.en}`, `花圃${index + 1}：${plot.name.zh}`);
}

export function newState() {
  const s = {
    phase: 'playing',
    score: 0,
    ticks: 0,
    acc: 0,
    nextId: 1,
    message: null,
    stats: { planted: 0, harvested: 0, caught: 0, leaked: 0 },
  };
  loadPlot(s, 0);
  return s;
}

function say(s, en, zh) {
  s.message = { en, zh, ttl: RULES.messageTicks };
}

function addFx(s, x, y, color, count) {
  for (let i = 0; i < count && s.fx.length < 48; i++) {
    const a = ((s.ticks + i * 5) % 12) * (Math.PI / 6);
    s.fx.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30 - 10, life: 36, color });
  }
}

// ---------------------------------------------------------------------------
// Pest routing: shortest path to the bloom; wary pests pay extra for live-root tiles.
// ---------------------------------------------------------------------------

function routeField(s, wary) {
  if (!s.routes || s.routes.ver !== s.rootVer) {
    const zone = new Set();
    s.plants
      .filter(isLive)
      .forEach((p) => rootTilesAt(s, p.c, p.r).forEach((t) => zone.add(t.r * COLS + t.c)));
    s.routes = { ver: s.rootVer, zone, fields: {} };
  }
  const key = wary ? 'wary' : 'plain';
  if (!s.routes.fields[key]) {
    const cost = (c, r) => 1 + (wary && s.routes.zone.has(r * COLS + c) ? RULES.avoidCost : 0);
    const dist = new Array(COLS * ROWS).fill(Infinity);
    dist[s.heart.r * COLS + s.heart.c] = 0;
    const queue = [s.heart];
    for (let head = 0; head < queue.length; head++) {
      const { c, r } = queue[head];
      for (const [dx, dy] of DIRS) {
        const nc = c + dx;
        const nr = r + dy;
        if (!isPath(tileAt(s, nc, nr))) continue;
        const d = dist[r * COLS + c] + cost(c, r);
        if (d < dist[nr * COLS + nc]) {
          dist[nr * COLS + nc] = d;
          queue.push({ c: nc, r: nr });
        }
      }
    }
    s.routes.fields[key] = { dist, cost };
  }
  return s.routes.fields[key];
}

function nextStep(s, v) {
  const wary = INVADERS[v.kind].wary;
  const plain = routeField(s, false);
  const { dist, cost } = routeField(s, wary);
  // Ties between two rooted lanes alternate by weevil id, so one lane cannot hoard every weevil.
  const order = wary && v.id % 2 ? [...DIRS].reverse() : DIRS;
  let best = null;
  for (const allowBack of [false, true]) {
    for (const [dx, dy] of order) {
      const c = v.c + dx;
      const r = v.r + dy;
      const at = r * COLS + c;
      if (!isPath(tileAt(s, c, r)) || dist[at] === Infinity) continue;
      if (!allowBack && v.prev && v.prev.c === c && v.prev.r === r) continue;
      const total = Math.min(cost(c, r) + dist[at], 1 + plain.dist[at] + RULES.avoidCap);
      if (!best || total < best.total) best = { c, r, total };
    }
    if (best) return best;
  }
  return null;
}

const claims = (u, c, r) => (u.c === c && u.r === r) || (u.left > 0 && u.tc === c && u.tr === r);

// ---------------------------------------------------------------------------
// Plants, gardener actions
// ---------------------------------------------------------------------------

function plantSeed(s, emit) {
  const { c, r } = facingOf(s.player);
  if (tileAt(s, c, r) !== 's')
    return say(s, 'Seeds only grow on brown soil', '种子只能种在棕色泥土上');
  if (plantAt(s, c, r)) return say(s, 'A plant is already there', '这里已经有植物了');
  if (s.seeds <= 0)
    return say(s, 'No seeds: harvest a bloom with X', '没有种子：用X收获盛开的植物');
  s.seeds--;
  s.plants.push({
    id: s.nextId++,
    c,
    r,
    age: 0,
    bloomTicks: 0,
    charges: RULES.charges,
    grip: null,
  });
  s.stats.planted++;
  s.player.act = 14;
  const at = tileCenter(c, r);
  addFx(s, at.x, at.y, '#c8e87a', 6);
  say(s, 'Planted! It blooms in 6s', '已播种！6秒后盛开');
  emit('move');
}

function harvest(s, emit) {
  const { c, r } = facingOf(s.player);
  const plant = plantAt(s, c, r);
  if (!plant) return say(s, 'Nothing to harvest there', '这里没有可收获的植物');
  if (stageOf(plant) < 3) {
    const left = secs(GROW_TICKS - plant.age);
    return say(s, `Still growing: ${left}s left`, `还在成长：剩${left}秒`);
  }
  if (plant.grip !== null) return say(s, 'Its roots are holding a pest', '它的根正抓着害虫');
  const gain = plant.charges > 0 ? RULES.harvestFull : RULES.harvestSpent;
  if (s.seeds + gain > RULES.seedCap)
    return say(s, `Seed pouch full (${RULES.seedCap})`, `种子袋已满（${RULES.seedCap}）`);
  if (plant.charges > 0) s.rootVer++;
  s.plants.splice(s.plants.indexOf(plant), 1);
  s.seeds += gain;
  s.stats.harvested++;
  s.player.act = 14;
  const at = tileCenter(c, r);
  addFx(s, at.x, at.y, '#ffd24a', 8);
  say(s, `Harvested +${gain} ${gain === 1 ? 'seed' : 'seeds'}`, `收获 +${gain} 颗种子`);
  emit('coin');
}

function tickPlayer(s, dir, emit) {
  const p = s.player;
  if (p.act > 0) p.act--;
  if (p.hurt > 0) p.hurt--;
  if (p.left > 0 && --p.left > 0) return;
  if (s.latch.plant > 0) {
    s.latch.plant = 0;
    plantSeed(s, emit);
  }
  if (s.latch.harvest > 0) {
    s.latch.harvest = 0;
    harvest(s, emit);
  }
  if (!dir.dx && !dir.dy) {
    p.turn = 0;
    return;
  }
  if (dir.dx !== p.facing.dx || dir.dy !== p.facing.dy) {
    p.facing = { dx: dir.dx, dy: dir.dy };
    p.turn = RULES.turnTicks;
  }
  if (p.turn > 0) {
    p.turn--;
    return;
  }
  const { c, r } = facingOf(p);
  const ch = tileAt(s, c, r);
  if (ch === '#' || ch === 'h' || plantAt(s, c, r)) return;
  p.from = { c: p.c, r: p.r };
  p.c = c;
  p.r = r;
  p.left = RULES.moveTicks;
}

function growPlants(s) {
  for (const p of s.plants) {
    if (p.age >= GROW_TICKS) {
      p.bloomTicks++;
      continue;
    }
    p.age++;
    if (p.age === GROW_TICKS) {
      s.rootVer++;
      const at = tileCenter(p.c, p.r);
      addFx(s, at.x, at.y, '#ff9ab8', 6);
    }
  }
}

// ---------------------------------------------------------------------------
// Pests
// ---------------------------------------------------------------------------

function spawnPests(s) {
  const plot = PLOTS[s.plot];
  const due = plot.spawns[s.spawned];
  if (!due || s.plotTicks < due[0] * 120) return;
  const gate = s.gates[due[1]];
  if (s.invaders.some((u) => claims(u, gate.c, gate.r))) return;
  s.spawned++;
  s.invaders.push({
    id: s.nextId++,
    kind: due[2],
    c: gate.c,
    r: gate.r,
    tc: gate.c,
    tr: gate.r,
    left: 0,
    hp: INVADERS[due[2]].hp,
    held: null,
    bite: 0,
    plan: null,
    prev: null,
    dead: false,
  });
}

function reachHeart(s, v, emit) {
  v.dead = true;
  s.resolved++;
  s.health--;
  s.stats.leaked++;
  s.heartFlash = 40;
  const at = tileCenter(s.heart.c, s.heart.r);
  addFx(s, at.x, at.y, '#ff5a3c', 8);
  const name = INVADERS[v.kind].name;
  say(
    s,
    `${name.en} reached the bloom! Health ${Math.max(0, s.health)}`,
    `${name.zh}到达花心！生命 ${Math.max(0, s.health)}`,
  );
  emit('hit');
}

function biteHeld(s, v, emit) {
  const plant = s.plants.find((p) => p.id === v.held);
  v.hp--;
  plant.charges--;
  v.bite = RULES.biteTicks;
  const at = tileCenter(v.c, v.r);
  addFx(s, at.x, at.y, '#e8602a', 4);
  emit('hit');
  if (v.hp <= 0) {
    v.dead = true;
    plant.grip = null;
    s.resolved++;
    s.score += RULES.catchScore;
    s.stats.caught++;
    say(
      s,
      `${INVADERS[v.kind].name.en} caught! +${RULES.catchScore}`,
      `${INVADERS[v.kind].name.zh}被抓住！+${RULES.catchScore}`,
    );
    addFx(s, at.x, at.y, '#ffe36a', 8);
  }
  if (plant.charges <= 0) {
    plant.grip = null;
    v.held = null;
    v.plan = null;
    s.rootVer++;
    if (!v.dead) say(s, 'Roots spent: harvest with X', '根已用完：用X收获');
  }
}

function tickPest(s, v, emit) {
  if (v.left > 0) {
    if (--v.left > 0) return;
    v.prev = { c: v.c, r: v.r };
    v.c = v.tc;
    v.r = v.tr;
    if (tileAt(s, v.c, v.r) === 'h') return reachHeart(s, v, emit);
  }
  if (v.held === null) {
    const plant = s.plants.find((p) => isLive(p) && p.grip === null && reaches(p, v.c, v.r));
    if (plant) {
      plant.grip = v.id;
      v.held = plant.id;
      v.bite = RULES.biteTicks;
      v.plan = null;
    }
  }
  if (v.held !== null) {
    if (--v.bite <= 0) biteHeld(s, v, emit);
    return;
  }
  v.plan = v.plan || nextStep(s, v);
  if (!v.plan || s.invaders.some((u) => u !== v && claims(u, v.plan.c, v.plan.r))) return;
  v.tc = v.plan.c;
  v.tr = v.plan.r;
  v.left = INVADERS[v.kind].ticks;
  v.plan = null;
}

function finishPlot(s, emit) {
  s.score += RULES.plotScore + RULES.healthScore * s.health;
  if (s.plot === PLOTS.length - 1) {
    s.phase = 'won';
    return;
  }
  s.clear = RULES.clearTicks;
  say(s, `Plot ${s.plot + 1} saved!`, `花圃${s.plot + 1}守住了！`);
  emit('win');
}

function updateFx(s) {
  for (const f of s.fx) {
    f.x += f.vx * STEP;
    f.y += f.vy * STEP;
    f.vy += 60 * STEP;
    f.life--;
  }
  s.fx = s.fx.filter((f) => f.life > 0);
}

function tick(s, dir, emit) {
  s.ticks++;
  s.plotTicks++;
  if (s.message && --s.message.ttl <= 0) s.message = null;
  if (s.heartFlash > 0) s.heartFlash--;
  s.latch.plant = Math.max(0, s.latch.plant - 1);
  s.latch.harvest = Math.max(0, s.latch.harvest - 1);
  growPlants(s);
  tickPlayer(s, dir, emit);
  if (s.clear > 0) {
    if (--s.clear === 0) loadPlot(s, s.plot + 1);
  } else {
    spawnPests(s);
    s.invaders.forEach((v) => tickPest(s, v, emit));
    s.invaders = s.invaders.filter((v) => !v.dead);
    if (s.health <= 0) s.phase = 'lost';
    else if (s.spawned === PLOTS[s.plot].spawns.length && !s.invaders.length) finishPlot(s, emit);
  }
  updateFx(s);
  if (s.ticks % 6 === 0) refreshPrompt(s);
}

function readDir(input, facing) {
  const dx = (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  const dy = (input.held('ArrowDown', 'KeyS') ? 1 : 0) - (input.held('ArrowUp', 'KeyW') ? 1 : 0);
  if (dx && dy) return facing.dy === dy && !facing.dx ? { dx: 0, dy } : { dx, dy: 0 };
  return { dx, dy };
}

// Advance by `dt` seconds. Returns false (and consumes nothing) for an invalid dt.
export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0 || dt > RULES.maxDt) return false;
  if (input.pressed('Space')) s.latch.plant = RULES.bufferTicks;
  if (input.pressed('KeyX')) s.latch.harvest = RULES.bufferTicks;
  const dir = readDir(input, s.player.facing);
  s.acc += dt;
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, emit);
  return true;
}

// ---------------------------------------------------------------------------
// Prompts and status
// ---------------------------------------------------------------------------

export const PROMPTS = {
  intro1: ['Space plants beside the path; X harvests', '空格在虫道旁播种；X收获'],
  intro2: ['Cover both lanes: Space plants, X harvests', '两条道都种：空格播种，X收获'],
  intro3: ['Two gates: Space plants, X harvests seeds', '两个入口：空格播种，X收获种子'],
  plant: ['Space: plant on soil beside the path', '空格：在虫道旁的泥土上播种'],
  harvestNone: ['No seeds: X harvests a grown plant', '没有种子：X收获盛开的植物'],
  bare: ['A bare lane! Space plants beside it', '有条道没设防！空格在旁边播种'],
  harvestIdle: ['No seeds: X harvests an unused full bloom', '没有种子：X收获没用过的满格盛开植物'],
  harvestSpent: ['No seeds: X harvests the grey spent plant', '没有种子：X收获灰色枯萎的植物'],
  harvestFull: ['Soil is full: X harvests a grown plant', '泥土已满：X收获盛开的植物'],
  hold: ['Roots hold pests: wait, then X harvests', '根正抓着害虫：稍等，再按X收获'],
  wait: ['Plants are growing: bloom in {n}s', '植物成长中：{n}秒后盛开'],
  saved: ['Plot saved! Next garden in {n}s', '花圃守住了！{n}秒后进入下一块'],
  won: ['All three plots are safe!', '三个花圃都守住了！'],
  lost: ['The garden bloom was overrun', '花圃之心被害虫占领了'],
};

// The tiles a pest will cross on its way to the bloom, following its own routing rule.
function pestRoute(s, v) {
  if (v.rc && v.rc.ver === s.rootVer && v.rc.c === v.c && v.rc.r === v.r) return v.rc.route;
  const route = [];
  let at = { id: v.id, kind: v.kind, c: v.c, r: v.r, prev: v.prev };
  for (let n = 0; n < COLS * ROWS; n++) {
    const step = nextStep(s, at);
    if (!step) break;
    route.push({ c: step.c, r: step.r });
    if (tileAt(s, step.c, step.r) === 'h') break;
    at = { ...at, c: step.c, r: step.r, prev: { c: at.c, r: at.r } };
  }
  v.rc = { ver: s.rootVer, c: v.c, r: v.r, route };
  return route;
}
const covered = (s, t) => s.plants.some((p) => p.charges > 0 && reaches(p, t.c, t.r));
const isBare = (s, v) => !pestRoute(s, v).some((t) => covered(s, t));

function promptKey(s) {
  if (s.phase !== 'playing') return s.phase;
  if (s.clear > 0) return 'saved';
  if (s.plotTicks < 6 * 120 && !s.plants.length) return `intro${s.plot + 1}`;
  const grown = s.plants.some((p) => stageOf(p) === 3 && p.grip === null);
  if (s.seeds > 0 && s.usefulSoil.some((t) => !plantAt(s, t.c, t.r))) {
    return s.invaders.some((v) => isBare(s, v)) ? 'bare' : 'plant';
  }
  if (grown) {
    if (s.seeds > 0) return 'harvestFull';
    if (s.plants.some(isIdle)) return 'harvestIdle';
    return s.plants.some((p) => p.charges <= 0 && p.grip === null) ? 'harvestSpent' : 'harvestNone';
  }
  return s.plants.some((p) => stageOf(p) < 3) ? 'wait' : 'hold';
}

// A harvest prompt promises a plant that X can take right now; it is replaced the moment that
// stops being true, even inside the usual 0.6 s display time.
function harvestPromiseKept(s, key) {
  const free = s.plants.filter((p) => stageOf(p) === 3 && p.grip === null);
  if (key === 'harvestFull') return s.seeds > 0 && free.length > 0;
  if (s.seeds > 0) return false;
  if (key === 'harvestNone') return free.length > 0;
  if (key === 'harvestSpent') return free.some((p) => p.charges <= 0);
  return free.some(isIdle);
}

function refreshPrompt(s) {
  const key = promptKey(s);
  const urgent = s.phase !== 'playing' || key === 'saved' || key.startsWith('intro');
  if (key === s.shownKey) return;
  const broken = s.shownKey.startsWith('harvest') && !harvestPromiseKept(s, s.shownKey);
  if (urgent || broken || s.ticks - s.shownSince >= RULES.promptHoldTicks) {
    s.shownKey = key;
    s.shownSince = s.ticks;
  }
}

function promptText(s) {
  const stale = s.shownKey.startsWith('harvest') && !harvestPromiseKept(s, s.shownKey);
  const key = stale ? promptKey(s) : s.shownKey;
  const soonest = Math.min(
    ...s.plants.filter((p) => stageOf(p) < 3).map((p) => GROW_TICKS - p.age),
    Infinity,
  );
  const n = key === 'saved' ? secs(s.clear) : Number.isFinite(soonest) ? secs(soonest) : 0;
  const [en, zh] = PROMPTS[key];
  return { key, en: en.replace('{n}', n), zh: zh.replace('{n}', n) };
}

function buildStatus(s, prompt) {
  const note = (lang) => (s.message ? `${s.message[lang]} · ` : '');
  return {
    en: `Plot ${s.plot + 1}/3 · Seeds ${s.seeds} · Health ${Math.max(0, s.health)} · ${note('en')}${prompt.en}`,
    zh: `花圃 ${s.plot + 1}/3 · 种子 ${s.seeds} · 生命 ${Math.max(0, s.health)} · ${note('zh')}${prompt.zh}`,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pal = (list) => Object.fromEntries(list.split(' ').map((c, i) => ['abcdefghijklm'[i], c]));
const mirror = (rows) => rows.map((row) => [...row].reverse().join(''));
const keyed = (list) => Object.fromEntries(list.split(' ').map((e) => [e[0], e.slice(1)]));
const sheet = (str) => str.trim().split(/\s+/);
const PLANT_PAL = keyed(
  'y#ffd24a r#e0405a R#8f1b3a p#ff9ab8 w#fff4d8 g#3fae4a G#1f7a35 l#9fe463 b#7a4a28 B#4a2c16 s#8d8a6a',
);
const PLANT_ROWS = [
  sheet(`........... ........... ........... ........... ........... .....y.....
         ....bbb.... ...bbBbb... ..bbbbbbb.. .bbBbbbBbb. .BBBBBBBBB.`),
  sheet(`........... ........... ........... ..ll...ll.. .llgl.lgll. ..lgGgGgl..
         ...lgGgl... .....g..... .....G..... ...bbGbb... ..bbbbbbb..`),
  sheet(`.....r..... ....rRr.... ....rpr.... .....R..... .ll..G..ll. .lgl.G.lgl.
         ..lgGgGgl.. ...lgGgl... .....G..... ...bbGbb... ..bbbbbbb..`),
  sheet(`...yyyyy... ..yrrrrry.. .yrrpppRry. .yrpwwwprR. .yrrpppRry. ..yrrRRry..
         ...yyGyy... ..lgGGGgl.. .lgGgGgGgl. ..bbbGbbb.. .bbbbbbbbb.`),
];
const WITHERED_ROWS = sheet(`........... ........... .....s..... ....sss.... ...s.s.s... ..s..s..s..
  .....s..... .....s..... ....bsb.... ...bbbbb... ..bbbbbbb..`);
// Positional palettes: letters a, b, c, ... map to the listed colours in order.
const PEST_PAL = {
  beetle: pal('#2b1a3a #4a3a5a #8a46b8 #d19cf5 #ffffff'),
  weevil: pal('#6a3a14 #e8812c #a8541a #ffcf7a #ffffff #4a2a10'),
  hopper: pal('#9ff0ee #4fb7c2 #ffffff #202020 #ffe36a'),
};
const PEST_ROWS = {
  beetle: sheet(`.a.......a. ..a.bbb.a.. ...bebeb... ..cccdccc.. .ccdcccdcc. acccdcdccca
    .ccdcccdcc. acccdcdccca .ccccccccc. ..cccdccc.. ...a...a...`),
  weevil: sheet(`........... ...bbbbb... ..bcbbbcb.. .bbbdbdbbb. fbbcbbbcbbf .bbbbbbbbb.
    fbbcbbbcbbf .bbbbbbbbb. ..bbbbbbb.. ...eaaae... .....a.....`),
  hopper: sheet(`.c.......c. ..c.aaa.c.. ...adada... ..aaaaaaa.. .abaaaaaba. .aaaacaaaa.
    .abaaaaaba. e.aaaaaaa.e ee.aaaaa.ee ee.......ee e.........e`),
};
const PLAYER_PAL = keyed('h#e8c050 H#b8452c s#f0c19c e#1d1d1d a#3a9a54 o#2f6fb3 b#5a3a24 t#d8d8e0');
const PLAYER_IDLE = sheet(`..hhhhhhh.. .hhhHHHhhh. hhhhhhhhhhh ...sssss... ...seses... ...sssss...
  ..oaaaaao.. .sooaaaoos. ..ooaaaoo.. ...oo.oo... ...bb.bb...`);
const PLAYER_STEP = [...PLAYER_IDLE.slice(0, 9), '..oo...oo..', '..bb...bb..'];
const PLAYER_ACT = [
  ...PLAYER_IDLE.slice(0, 6),
  '.soaaaaaos.',
  't.ooaaaoo..',
  '.t.ooaoo...',
  '...oo.oo...',
  '...bb.bb...',
];

const hash = (a, b, c = 0) =>
  (Math.imul(a + 7, 73856093) ^ Math.imul(b + 3, 19349663) ^ Math.imul(c + 1, 83492791)) >>> 0;

function leaf(ctx, x, y, size, dark, light) {
  ctx.fillStyle = dark;
  ctx.fillRect(x + size * 0.25, y, size * 0.5, size);
  ctx.fillRect(x, y + size * 0.25, size, size * 0.5);
  ctx.fillStyle = light;
  ctx.fillRect(x + size * 0.45, y + 2, 2, size - 4);
}

function drawWall(ctx, c, r, x, y) {
  ctx.fillStyle = '#0f3a2c';
  ctx.fillRect(x, y, TILE, TILE);
  const layers = [
    ['#14583d', '#2f8a58', 18],
    ['#1b7a4a', '#58c274', 14],
    ['#2aa05a', '#a6e86a', 10],
  ];
  layers.forEach(([dark, light, size], n) => {
    for (let i = 0; i < 2; i++) {
      const h = hash(c, r, n * 2 + i);
      leaf(
        ctx,
        x + (h % (TILE - size + 6)) - 3,
        y + ((h >> 8) % (TILE - size + 6)) - 3,
        size,
        dark,
        light,
      );
    }
  });
}

function drawFloor(ctx, ch, c, r, x, y) {
  const h = hash(c, r);
  if (ch === 's') {
    ctx.fillStyle = '#5b3a22';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#44291a';
    ctx.fillRect(x + 1, y + 7, TILE - 2, 2);
    ctx.fillRect(x + 1, y + 16, TILE - 2, 2);
    ctx.fillStyle = '#7d5532';
    ctx.fillRect(x + 4 + (h % 8), y + 3, 2, 2);
    ctx.fillRect(x + 12 + ((h >> 4) % 8), y + 20, 2, 2);
    ctx.fillStyle = '#7ad46a';
    ctx.fillRect(x + 10, y + 11, 4, 2);
    ctx.fillRect(x + 11, y + 10, 2, 4);
  } else if (ch === 'w') {
    ctx.fillStyle = '#9a7648';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7d5c36';
    ctx.fillRect(x, y + 11, TILE, 2);
    ctx.fillRect(x + (h % 2 ? 7 : 15), y, 2, 11);
    ctx.fillRect(x + (h % 2 ? 16 : 6), y + 13, 2, 11);
  } else {
    ctx.fillStyle = '#cdb98a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#b09c6e';
    ctx.fillRect(x + (h % 16) + 2, y + ((h >> 5) % 16) + 2, 3, 2);
    ctx.fillStyle = '#e6d8b0';
    ctx.fillRect(x + ((h >> 9) % 16) + 2, y + ((h >> 3) % 16) + 3, 2, 2);
  }
}

function drawGate(ctx, x, y) {
  ctx.fillStyle = '#1a0f12';
  ctx.fillRect(x + 6, y + 2, 18, 20);
  ctx.fillStyle = '#6a3a24';
  ctx.fillRect(x + 4, y, 4, 24);
  ctx.fillStyle = '#e84a4a';
  ctx.fillRect(x + 12, y + 9, 3, 3);
  ctx.fillRect(x + 18, y + 9, 3, 3);
}

function drawHeart(ctx, x, y, flash, tick) {
  ctx.fillStyle = flash ? '#ff5a3c' : '#2a7a3a';
  ctx.fillRect(x + 8, y + 12, 8, 12);
  const cx = x + 12;
  const cy = y + 10 + (Math.floor(tick / 30) % 2);
  ctx.fillStyle = flash ? '#ffd0c0' : '#ff7aa8';
  [
    [-7, 0],
    [7, 0],
    [0, -7],
    [0, 7],
  ].forEach(([dx, dy]) => ctx.fillRect(cx + dx - 4, cy + dy - 4, 8, 8));
  ctx.fillStyle = '#ffd24a';
  ctx.fillRect(cx - 5, cy - 5, 10, 10);
  ctx.fillStyle = '#fff4d8';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);
}

function drawRootTiles(ctx, s, plant, stage) {
  const live = plant.charges > 0;
  rootTilesAt(s, plant.c, plant.r).forEach((t) => {
    const x = t.c * TILE;
    const y = TOP + t.r * TILE;
    if (stage === 3 && live) {
      ctx.fillStyle = 'rgba(226,96,32,0.45)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a2a10';
      for (let k = -TILE; k < TILE; k += 8) {
        for (let d = 0; d < TILE; d += 3) {
          const px = x + k + d;
          if (px >= x && px < x + TILE) ctx.fillRect(px, y + d, 2, 2);
        }
      }
    } else if (stage >= 1 && stage < 3) {
      const pulse = stage === 2 && Math.floor(s.ticks / 24) % 2 === 0;
      ctx.fillStyle = pulse ? '#ffd24a' : 'rgba(255,210,74,0.55)';
      for (let k = 0; k < TILE; k += 6) {
        ctx.fillRect(x + k, y, 3, 2);
        ctx.fillRect(x + k, y + TILE - 2, 3, 2);
        ctx.fillRect(x, y + k, 2, 3);
        ctx.fillRect(x + TILE - 2, y + k, 2, 3);
      }
    }
  });
}

function drawPlant(ctx, s, p) {
  const stage = stageOf(p);
  const x = p.c * TILE;
  const y = TOP + p.r * TILE;
  const spent = stage === 3 && p.charges <= 0;
  pixelSprite(ctx, spent ? WITHERED_ROWS : PLANT_ROWS[stage], x + 1, y + 1, 2, PLANT_PAL);
  if (stage < 3) {
    for (let i = 0; i < 3; i++) {
      const fill = Math.max(0, Math.min(1, (p.age - i * RULES.stageTicks) / RULES.stageTicks));
      ctx.fillStyle = '#20301f';
      ctx.fillRect(x + 3 + i * 6, y + 1, 5, 3);
      ctx.fillStyle = '#ffe36a';
      ctx.fillRect(x + 3 + i * 6, y + 1, Math.round(5 * fill), 3);
    }
  } else if (!spent) {
    for (let i = 0; i < RULES.charges; i++) {
      ctx.fillStyle = i < p.charges ? (isIdle(p) ? '#9ad7ff' : '#ff8a3c') : '#4a2c16';
      ctx.fillRect(x + 4 + i * 5, y + 20, 3, 3);
    }
  }
  if (p.grip !== null) {
    ctx.fillStyle = '#7a2a10';
    tilesAround(p.c, p.r).forEach((t, n) =>
      ctx.fillRect(t.c * TILE + 4 + (n % 3) * 6, TOP + t.r * TILE + 10, 3, 6),
    );
  }
}

function pestPos(v) {
  const a = tileCenter(v.c, v.r);
  if (v.left <= 0) return a;
  const k = 1 - v.left / INVADERS[v.kind].ticks;
  const b = tileCenter(v.tc, v.tr);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

function drawPest(ctx, v, tick) {
  const pos = pestPos(v);
  const left = v.tc < v.c;
  const rows = left ? mirror(PEST_ROWS[v.kind]) : PEST_ROWS[v.kind];
  const hop =
    v.kind === 'hopper' && v.left > 0
      ? -Math.round(Math.sin((v.left / INVADERS.hopper.ticks) * Math.PI) * 5)
      : 0;
  const wob = v.left > 0 && Math.floor(tick / 8) % 2 ? 1 : 0;
  pixelSprite(ctx, rows, pos.x - SPRITE / 2, pos.y - SPRITE / 2 + hop + wob, 2, PEST_PAL[v.kind]);
  const total = INVADERS[v.kind].hp;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < v.hp ? '#ff4d6d' : '#3a1a24';
    ctx.fillRect(pos.x - total * 3 + i * 6, pos.y - SPRITE / 2 - 4, 5, 3);
  }
}

function playerPos(p) {
  const a = tileCenter(p.from.c, p.from.r);
  const b = tileCenter(p.c, p.r);
  const k = p.left > 0 ? 1 - p.left / RULES.moveTicks : 1;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

function drawPlayer(ctx, s) {
  const p = s.player;
  const pos = playerPos(p);
  const rows =
    p.act > 0 ? PLAYER_ACT : p.left > 0 && Math.floor(p.left / 5) % 2 ? PLAYER_STEP : PLAYER_IDLE;
  const bob = p.left <= 0 && Math.floor(s.ticks / 40) % 2 ? 1 : 0;
  pixelSprite(
    ctx,
    p.facing.dx < 0 ? mirror(rows) : rows,
    pos.x - SPRITE / 2,
    pos.y - SPRITE / 2 + bob,
    2,
    PLAYER_PAL,
  );
}

function targetKind(s) {
  const { c, r } = facingOf(s.player);
  const plant = plantAt(s, c, r);
  if (plant) return stageOf(plant) === 3 && plant.grip === null ? 'harvest' : 'busy';
  if (tileAt(s, c, r) === 's') return s.seeds > 0 ? 'plant' : 'busy';
  return 'none';
}

// Chevrons on the road ahead of a pest that no root covers: that is where to plant.
function drawBareRoutes(ctx, s) {
  s.invaders.forEach((v) => {
    if (!isBare(s, v)) return;
    const pulse = Math.floor(s.ticks / 20) % 2;
    let from = { c: v.c, r: v.r };
    pestRoute(s, v).forEach((t, n) => {
      const { x, y } = tileCenter(t.c, t.r);
      const dx = t.c - from.c;
      const dy = t.r - from.r;
      from = t;
      if (n > 12 || tileAt(s, t.c, t.r) === 'h') return;
      ctx.fillStyle = pulse ? '#ff6a5a' : '#ffb09a';
      ctx.fillRect(x - 2 + dx * 3, y - 2 + dy * 3, 4, 4);
      ctx.fillRect(x - 2 - dx * 2 + dy * 4, y - 2 - dy * 2 + dx * 4, 3, 3);
      ctx.fillRect(x - 2 - dx * 2 - dy * 4, y - 2 - dy * 2 - dx * 4, 3, 3);
    });
  });
}

function drawCursor(ctx, s) {
  const { c, r } = facingOf(s.player);
  if (!inGrid(c, r)) return;
  const color = { plant: '#7cff8a', harvest: '#ffd24a', busy: '#ff9a5a', none: '#c0c8d0' }[
    targetKind(s)
  ];
  const x = c * TILE;
  const y = TOP + r * TILE;
  ctx.fillStyle = color;
  [
    [0, 0, 1, 1],
    [TILE - 6, 0, -1, 1],
    [0, TILE - 6, 1, -1],
    [TILE - 6, TILE - 6, -1, -1],
  ].forEach(([ox, oy]) => {
    ctx.fillRect(x + ox, y + oy, 6, 2);
    ctx.fillRect(x + ox, y + oy, 2, 6);
  });
}

function drawFoliageFront(ctx) {
  [
    [0, 0],
    [1, 0],
  ].forEach(([, n]) => {
    for (let c = 0; c < COLS; c++) {
      const h = hash(c, n, 9);
      leaf(ctx, c * TILE + (h % 8) - 4, TOP + ((h >> 6) % 6) - 8 + n * 4, 16, '#12683f', '#3fae6a');
      leaf(
        ctx,
        c * TILE + ((h >> 3) % 8),
        FIELD_BOTTOM - 14 - ((h >> 9) % 6),
        16,
        '#12683f',
        '#3fae6a',
      );
    }
  });
}

function drawHud(ctx, s, env, prompt) {
  ctx.fillStyle = '#0a1812';
  ctx.fillRect(0, 0, 480, TOP);
  ctx.fillRect(0, FIELD_BOTTOM, 480, 320 - FIELD_BOTTOM);
  text(ctx, `${env.t('Plot', '花圃')} ${s.plot + 1}/3`, 6, 6, '#ffe36a', 14);
  text(ctx, `${env.t('Seeds', '种子')} ${s.seeds}`, 92, 6, '#c8e87a', 14);
  text(ctx, env.t('Health', '生命'), 168, 6, '#ff9ab8', 14);
  const maxHealth = PLOTS[s.plot].health;
  for (let i = 0; i < maxHealth; i++) {
    ctx.fillStyle = i < s.health ? '#ff4d6d' : '#3a2a30';
    ctx.fillRect(220 + i * 12, 8, 9, 9);
  }
  const left = PLOTS[s.plot].spawns.length - s.resolved;
  text(ctx, `${env.t('Pests', '害虫')} ${left}`, 292, 6, '#d19cf5', 14);
  const due = PLOTS[s.plot].spawns[s.spawned];
  const next =
    s.clear > 0
      ? ''
      : due
        ? `${env.t('Next', '下一只')} ${Math.max(0, Math.ceil(due[0] - s.plotTicks * STEP))}s`
        : env.t('Last one', '最后一只');
  text(ctx, next, 384, 6, '#9ad7ff', 14);
  text(ctx, env.t(prompt.en, prompt.zh), 240, FIELD_BOTTOM + 6, '#f4f4f4', 16, 'center');
}

function drawBanner(ctx, s, env) {
  if (!s.message) return;
  ctx.fillStyle = 'rgba(8,24,16,0.8)';
  ctx.fillRect(40, TOP + 4, 400, 20);
  text(ctx, env.t(s.message.en, s.message.zh), 240, TOP + 7, '#ffffff', 14, 'center');
}

export function render(ctx, s, env) {
  background(ctx, '#0a1812');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = s.grid[r][c];
      const x = c * TILE;
      const y = TOP + r * TILE;
      if (ch === '#') drawWall(ctx, c, r, x, y);
      else {
        drawFloor(ctx, ch === 'G' || ch === 'h' ? '.' : ch, c, r, x, y);
        if (ch === 'G') drawGate(ctx, x, y);
        if (ch === 'h') drawHeart(ctx, x, y, s.heartFlash > 0, s.ticks);
      }
    }
  }
  s.plants.forEach((p) => drawRootTiles(ctx, s, p, stageOf(p)));
  drawBareRoutes(ctx, s);
  drawCursor(ctx, s);
  s.plants.forEach((p) => drawPlant(ctx, s, p));
  s.invaders.forEach((v) => drawPest(ctx, v, s.ticks));
  drawPlayer(ctx, s);
  s.fx.forEach((f) => {
    ctx.fillStyle = f.color;
    ctx.fillRect(Math.round(f.x), Math.round(f.y), 3, 3);
  });
  drawFoliageFront(ctx);
  drawBanner(ctx, s, env);
  drawHud(ctx, s, env, promptText(s));
}

// ---------------------------------------------------------------------------
// Public game
// ---------------------------------------------------------------------------

export function createGame(env) {
  const s = newState();
  let ended = false;
  const emit = (name) => env.sound(name);
  return {
    update(dt, input) {
      advance(s, dt, input, emit);
      if (s.phase === 'playing' || ended) return;
      ended = true;
      const won = s.phase === 'won';
      refreshPrompt(s);
      env.sound(won ? 'win' : 'lose');
      env.end({
        won,
        score: s.score,
        message: won
          ? env.t(
              'All three plots are safe. The greenhouse thrives!',
              '三个花圃都守住了，温室生机勃勃！',
            )
          : env.t(
              'Pests overran the garden bloom. Keep blooms ready on the path.',
              '害虫占领了花圃之心。记得让盛开的植物守住虫道。',
            ),
      });
    },
    draw(ctx) {
      render(ctx, s, env);
    },
    getState() {
      const prompt = promptText(s);
      const p = s.player;
      const pp = playerPos(p);
      const rect = (pos) => ({
        x: pos.x - SPRITE / 2,
        y: pos.y - SPRITE / 2,
        w: SPRITE,
        h: SPRITE,
      });
      const target = facingOf(p);
      return {
        phase: s.phase,
        score: s.score,
        time: s.ticks * STEP,
        plot: s.plot + 1,
        plotName: PLOTS[s.plot].name,
        seeds: s.seeds,
        seedCap: RULES.seedCap,
        health: Math.max(0, s.health),
        healthMax: PLOTS[s.plot].health,
        tiles: s.grid.map((row) => row.join('')),
        heart: {
          ...s.heart,
          rect: { x: s.heart.c * TILE, y: TOP + s.heart.r * TILE, w: TILE, h: TILE },
        },
        gates: s.gates.map((g) => ({ ...g })),
        plants: s.plants.map((q) => ({
          id: q.id,
          c: q.c,
          r: q.r,
          stage: stageOf(q),
          age: q.age * STEP,
          readyIn: Math.max(0, (GROW_TICKS - q.age) * STEP),
          charges: q.charges,
          live: isLive(q),
          idle: isIdle(q),
          spent: stageOf(q) === 3 && q.charges <= 0,
          busy: q.grip !== null,
          rootTiles: rootTilesAt(s, q.c, q.r),
          rect: { x: q.c * TILE, y: TOP + q.r * TILE, w: TILE, h: TILE },
        })),
        pests: s.invaders.map((v) => {
          const pos = pestPos(v);
          return {
            id: v.id,
            kind: v.kind,
            c: v.c,
            r: v.r,
            x: pos.x,
            y: pos.y,
            hp: v.hp,
            held: v.held !== null,
            bare: isBare(s, v),
            route: pestRoute(s, v).map((t) => ({ ...t })),
            rect: rect(pos),
          };
        }),
        pestsLeft: PLOTS[s.plot].spawns.length - s.resolved,
        nextPestIn: PLOTS[s.plot].spawns[s.spawned]
          ? Math.max(0, PLOTS[s.plot].spawns[s.spawned][0] - s.plotTicks * STEP)
          : null,
        player: {
          c: p.c,
          r: p.r,
          x: pp.x,
          y: pp.y,
          moving: p.left > 0,
          facing: { ...p.facing },
          target: { ...target, action: targetKind(s) },
          rect: rect(pp),
        },
        hud: { top: [0, TOP], bottom: [FIELD_BOTTOM, 320] },
        prompt,
        message: s.message ? { en: s.message.en, zh: s.message.zh } : null,
        stats: { ...s.stats },
        status: buildStatus(s, prompt),
      };
    },
  };
}
