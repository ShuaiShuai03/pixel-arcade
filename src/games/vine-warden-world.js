// Simulation: the gardener, the plants and the pests, stepped in fixed 1/120 s ticks.
import {
  GROW_TICKS,
  INVADERS,
  RULES,
  STEP,
  facingOf,
  isLive,
  plantAt,
  reaches,
  rootTilesAt,
  secs,
  stageOf,
  tileAt,
  tileCenter,
} from './vine-warden-core.js';
import { LEVELS, LEVEL_COUNT } from './vine-warden-levels.js';
import { claims, nextStep } from './vine-warden-route.js';
import { refreshPrompt } from './vine-warden-prompts.js';

function say(s, en, zh) {
  s.message = { en, zh, ttl: RULES.messageTicks };
}

function addFx(s, x, y, color, count) {
  for (let i = 0; i < count && s.fx.length < 48; i++) {
    const a = ((s.ticks + i * 5) % 12) * (Math.PI / 6);
    s.fx.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30 - 10, life: 36, color });
  }
}

/** Start level `level` (1-based) fresh; the score, tick clock and statistics carry over. */
export function loadLevel(s, level) {
  const def = LEVELS[level - 1];
  s.level = level;
  s.def = def;
  s.grid = def.map.map((row) => [...row]);
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
    seeds: def.seeds,
    health: def.health,
    levelTicks: 0,
    spawned: 0,
    resolved: 0,
    invaders: [],
    plants: [],
    clear: 0,
    heartFlash: 0,
    rootVer: 0,
    routes: null,
    shownKey: 'tip',
    shownSince: s.ticks,
    player: {
      c: def.start.c,
      r: def.start.r,
      from: { ...def.start },
      left: 0,
      facing: { dx: 1, dy: 0 },
      turn: 0,
      act: 0,
    },
    latch: { plant: 0, harvest: 0 },
    fx: [],
  });
  say(s, `Level ${level}: ${def.name.en}`, `第${level}关：${def.name.zh}`);
}

export function newState(level = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    ticks: 0,
    acc: 0,
    nextId: 1,
    message: null,
    stats: { planted: 0, harvested: 0, caught: 0, leaked: 0 },
  };
  loadLevel(s, level);
  return s;
}

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
  if (p.left > 0 && --p.left > 0) return;
  // A tapped direction turns the gardener first, so Space or X in the same frame act on it.
  const turning = (dir.dx || dir.dy) && (dir.dx !== p.facing.dx || dir.dy !== p.facing.dy);
  if (turning) {
    p.facing = { dx: dir.dx, dy: dir.dy };
    p.turn = RULES.turnTicks;
  }
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

function spawnPests(s) {
  const due = s.def.spawns[s.spawned];
  if (!due || s.levelTicks < due[0] * 120) return;
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

function finishLevel(s, emit) {
  s.score += RULES.levelScore + RULES.healthScore * s.health;
  if (s.level === LEVEL_COUNT) {
    s.phase = 'won';
    return;
  }
  s.clear = RULES.clearTicks;
  say(s, `Level ${s.level} cleared!`, `第${s.level}关通关！`);
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
  s.levelTicks++;
  if (s.message && --s.message.ttl <= 0) s.message = null;
  if (s.heartFlash > 0) s.heartFlash--;
  s.latch.plant = Math.max(0, s.latch.plant - 1);
  s.latch.harvest = Math.max(0, s.latch.harvest - 1);
  growPlants(s);
  tickPlayer(s, dir, emit);
  if (s.clear > 0) {
    if (--s.clear === 0) loadLevel(s, s.level + 1);
  } else {
    spawnPests(s);
    s.invaders.forEach((v) => tickPest(s, v, emit));
    s.invaders = s.invaders.filter((v) => !v.dead);
    if (s.health <= 0) s.phase = 'lost';
    else if (s.spawned === s.def.spawns.length && !s.invaders.length) finishLevel(s, emit);
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

// Advance by `dt` seconds (a long hitch is capped at maxDt). Returns false and consumes nothing
// for an invalid dt or a finished game.
export function advance(s, dt, input, emit = () => {}) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return false;
  if (input.pressed('Space')) s.latch.plant = RULES.bufferTicks;
  if (input.pressed('KeyX')) s.latch.harvest = RULES.bufferTicks;
  const dir = readDir(input, s.player.facing);
  s.acc += Math.min(dt, RULES.maxDt);
  const steps = Math.floor(s.acc / STEP + 1e-6);
  s.acc = Math.max(0, s.acc - steps * STEP);
  for (let n = 0; n < steps && s.phase === 'playing'; n++) tick(s, dir, emit);
  return true;
}
