import { drawGame, drawMenu } from './bomb-garden-draw.js';
import { GARDENS, GARDEN_COUNT, DUEL_ARENA, ROLES } from './bomb-garden-gardens.js';
import {
  CELL,
  OX,
  OY,
  DIRS,
  FUSE,
  WET_FUSE,
  FRONT_STEP,
  ACTIVE,
  EMBER,
  BARREL_DELAY,
  BARREL_RANGE,
  PLAYER_SPEED,
  RADIUS,
  FLOOR,
  WALL,
  CRATE,
  BARREL,
  key,
  blastCells,
  blastReach,
  frontReach,
  walkingDistances,
  menuHit,
} from './bomb-garden-rules.js';

export { blastCells, GARDEN_COUNT };

export const meta = {
  id: 'bomb-garden',
  name: { en: 'Bomb Garden', zh: '炸弹花园' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: `Defeat every rival to clear a garden, then work through all ${GARDEN_COUNT} gardens. Bombs burst four ways; walls, crates and barrels stop jets, wet soil slows fuses and compost barrels chain. Pick any unlocked garden, progress is saved. Or duel a friend!`,
    zh: `击败所有对手即可清空一座花园，共${GARDEN_COUNT}座。炸弹向四个方向喷焰，墙壁、木箱和堆肥桶会挡住喷焰，湿地引信更慢，堆肥桶会连爆。可从已解锁的花园继续，进度自动保存；也可与好友对战！`,
  },
  touchControls: [
    { code: 'KeyA', side: 'left', label: { en: 'Left', zh: '左' } },
    { code: 'KeyD', side: 'left', label: { en: 'Right', zh: '右' } },
    { code: 'KeyW', side: 'left', label: { en: 'Up', zh: '上' } },
    { code: 'KeyS', side: 'left', label: { en: 'Down', zh: '下' } },
    { code: 'Space', side: 'right', label: { en: 'Bomb', zh: '炸弹' } },
  ],
  multiplayerTouchControls: [
    { code: 'KeyW', side: 'left', label: { en: 'P1 Up', zh: '1 上' } },
    { code: 'KeyA', side: 'left', label: { en: 'P1 Left', zh: '1 左' } },
    { code: 'KeyS', side: 'left', label: { en: 'P1 Down', zh: '1 下' } },
    { code: 'KeyD', side: 'left', label: { en: 'P1 Right', zh: '1 右' } },
    { code: 'Space', side: 'left', label: { en: 'P1 Bomb', zh: '1 炸弹' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'P2 Up', zh: '2 上' } },
    { code: 'ArrowLeft', side: 'right', label: { en: 'P2 Left', zh: '2 左' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'P2 Down', zh: '2 下' } },
    { code: 'ArrowRight', side: 'right', label: { en: 'P2 Right', zh: '2 右' } },
    { code: 'Enter', side: 'right', label: { en: 'P2 Bomb', zh: '2 炸弹' } },
  ],
  keys: [
    {
      label: { en: 'P1 move / bomb', zh: '玩家1 移动 / 炸弹' },
      keys: {
        en: 'WASD (solo: also arrows) / Space or J',
        zh: 'WASD（单人也可用方向键）/ 空格或 J',
      },
    },
    {
      label: { en: 'P2 move / bomb (duel)', zh: '玩家2 移动 / 炸弹（对战）' },
      keys: { en: 'Arrows / Enter or /', zh: '方向键 / 回车或 /' },
    },
    {
      label: { en: 'Garden select', zh: '选择花园' },
      keys: { en: 'Arrows or WASD / Space or Enter', zh: '方向键或 WASD / 空格或回车' },
    },
  ],
};

const MAX_HEARTS = 3,
  SOLO_TIME_BANNER = 4.5,
  DUEL_TIME_BANNER = 2.5,
  DUEL_TIME = 180,
  BASE_KIT = { range: 2, capacity: 1 },
  MENU_NOTE_TIME = 2,
  MAX_RANGE = 4,
  MAX_CAPACITY = 3;

/** The highest garden the host says is open; any trouble with the store means garden 1. */
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isNaN(n) ? 1 : Math.max(1, Math.min(GARDEN_COUNT, n));
  } catch {
    return 1;
  }
}

export function createGame(env) {
  const duel = env.mode === 2;
  let phase = 'playing',
    score = 0,
    level = 1,
    time = 0,
    elapsed = 0,
    transition = 0,
    respawn = 0,
    lives = MAX_HEARTS,
    nextId = 1,
    stageScore = 0,
    stageUpgrades = { ...BASE_KIT },
    menu = null,
    menuNote = null;
  let board,
    garden,
    players,
    enemies,
    bombs = [],
    flames = [],
    fronts = [],
    pickups = [],
    particles = [],
    wet = new Set(),
    drops = new Map(),
    banner = 0;
  const all = () => [...players, ...enemies];

  function saveUnlocked(n) {
    try {
      env.progress.unlock(n);
    } catch {
      // Progress is a convenience: a missing or broken store must not stop the game.
    }
  }
  function actor(x, y, id, role = 'player', pace = 1) {
    const rules = ROLES[role];
    return {
      x,
      y,
      px: x,
      py: y,
      id,
      ai: role !== 'player',
      role,
      alive: true,
      range: rules ? rules.range : BASE_KIT.range,
      capacity: BASE_KIT.capacity,
      speed: rules ? rules.speed : PLAYER_SPEED,
      direction: [0, 1],
      moving: null,
      moveClock: 0,
      anim: 0,
      thinkAt: elapsed,
      bombAt: elapsed + (2.5 + env.random()) * pace,
      arming: 0,
      pendingBomb: false,
      stamina: rules ? rules.stamina : 4,
      restUntil: 0,
      alarmAt: null,
    };
  }
  function newGarden() {
    garden = duel ? DUEL_ARENA : GARDENS[level - 1];
    time = duel ? DUEL_TIME : garden.time;
    bombs = [];
    flames = [];
    fronts = [];
    pickups = [];
    particles = [];
    banner = duel ? DUEL_TIME_BANNER : SOLO_TIME_BANNER;
    board = garden.board.map((row) => [...row]);
    wet = new Set(garden.wet);
    drops = new Map(garden.drops);
    players = [actor(...garden.start, 0)];
    if (duel) players.push(actor(...garden.start2, 1));
    else Object.assign(players[0], stageUpgrades);
    enemies = garden.foes.map(([x, y, role], i) => actor(x, y, i + 2, role, garden.pace));
  }
  newGarden();
  if (!duel) {
    const unlocked = readUnlocked(env.progress);
    if (unlocked > 1) menu = { cursor: unlocked, unlocked };
  }
  function finish(won, message) {
    if (phase !== 'playing') return;
    phase = won ? 'won' : 'lost';
    env.sound(won ? 'win' : 'lose');
    env.end({ won, score, message });
  }
  function occupied(x, y, a) {
    return all().some(
      (other) =>
        other !== a &&
        other.alive &&
        ((other.x === x && other.y === y) ||
          (other.moving && other.moving.x === x && other.moving.y === y)),
    );
  }
  function canMove(x, y, a, ignoreActors = false) {
    return (
      board[y]?.[x] === FLOOR &&
      !bombs.some((b) => b.x === x && b.y === y && !b.passIds.includes(a.id)) &&
      (!ignoreActors ? !occupied(x, y, a) : true)
    );
  }
  function plant(a) {
    if (
      !a.alive ||
      a.moving ||
      board[a.y][a.x] !== FLOOR ||
      bombs.some((b) => b.x === a.x && b.y === a.y) ||
      bombs.filter((b) => b.owner === a.id && !b.barrel).length >= a.capacity
    )
      return false;
    const fuse = wet.has(key(a.x, a.y)) ? WET_FUSE : FUSE;
    bombs.push({
      id: nextId++,
      x: a.x,
      y: a.y,
      range: a.range,
      at: activeAt(a.x, a.y) ? elapsed : elapsed + fuse,
      planted: elapsed,
      owner: a.id,
      passIds: [a.id],
      barrel: false,
    });
    a.pendingBomb = false;
    env.sound('shoot');
    return true;
  }
  function activeAt(x, y) {
    return flames.some((f) => f.until > elapsed + 1e-9 && f.x === x && f.y === y);
  }
  function burnCell(x, y, owners) {
    const existing = flames.find((f) => f.x === x && f.y === y && f.emberUntil > elapsed);
    if (existing) {
      if (existing.until <= elapsed + 1e-9) existing.owners = [];
      existing.until = Math.max(existing.until, elapsed + ACTIVE);
      existing.emberUntil = Math.max(existing.emberUntil, elapsed + ACTIVE + EMBER);
      existing.owners = [...new Set([...existing.owners, ...owners])];
    } else
      flames.push({
        x,
        y,
        until: elapsed + ACTIVE,
        emberUntil: elapsed + ACTIVE + EMBER,
        owners: [...owners],
      });
  }
  function breakCrate(x, y, owners) {
    board[y][x] = FLOOR;
    if (owners.includes(0)) score += 10;
    const upgrade = drops.get(key(x, y));
    // Authored upgrades are never lost: they sit on the ground until the gardener walks onto them.
    if (upgrade) pickups.push({ x, y, type: upgrade, protectedUntil: elapsed + ACTIVE });
    for (let n = 0; n < 5; n++)
      particles.push({
        x: OX + x * CELL + 15,
        y: OY + y * CELL + 15,
        vx: (env.random() - 0.5) * 70,
        vy: -env.random() * 70,
        life: 0.45,
      });
  }
  // Process a whole event timestamp against one terrain snapshot. Later fronts see opened cover.
  function processEvents() {
    let safety = 0;
    while (safety++ < 100) {
      const next = Math.min(...bombs.map((b) => b.at), ...fronts.map((f) => f.at));
      if (next > elapsed + 1e-9) break;
      const terrain = board.map((r) => [...r]),
        due = fronts.filter((f) => Math.abs(f.at - next) < 1e-8),
        roots = new Set(bombs.filter((b) => Math.abs(b.at - next) < 1e-8).map((b) => b.id)),
        hits = new Map();
      fronts = fronts.filter((f) => Math.abs(f.at - next) >= 1e-8);
      const hit = (x, y, owner) => {
        const k = key(x, y);
        if (!hits.has(k)) hits.set(k, { x, y, owners: [] });
        hits.get(k).owners.push(owner);
      };
      for (const f of due) {
        if (terrain[f.y]?.[f.x] === undefined || terrain[f.y][f.x] === WALL) continue;
        hit(f.x, f.y, f.owner);
        const charge = bombs.find((b) => b.x === f.x && b.y === f.y);
        if (charge) {
          roots.add(charge.id);
          continue;
        }
        if (terrain[f.y][f.x] === CRATE || terrain[f.y][f.x] === BARREL) continue;
        if (f.remaining > 1)
          fronts.push({
            ...f,
            x: f.x + f.dx,
            y: f.y + f.dy,
            remaining: f.remaining - 1,
            at: next + FRONT_STEP,
          });
      }
      const exploding = bombs.filter((b) => roots.has(b.id)).sort((a, b) => a.x - b.x || a.y - b.y);
      for (const b of exploding) {
        hit(b.x, b.y, b.owner);
        if (b.barrel) board[b.y][b.x] = FLOOR;
        for (const [dx, dy] of DIRS)
          fronts.push({
            x: b.x + dx,
            y: b.y + dy,
            dx,
            dy,
            remaining: b.range,
            at: next + FRONT_STEP,
            owner: b.owner,
          });
      }
      bombs = bombs.filter((b) => !roots.has(b.id));
      if (exploding.length) env.sound('hit');
      for (const { x, y, owners } of hits.values()) {
        burnCell(x, y, owners);
        if (terrain[y][x] === CRATE) breakCrate(x, y, owners);
        else if (
          terrain[y][x] === BARREL &&
          !bombs.some((b) => b.x === x && b.y === y) &&
          !exploding.some((b) => b.x === x && b.y === y)
        ) {
          bombs.push({
            id: nextId++,
            x,
            y,
            range: BARREL_RANGE,
            at: next + BARREL_DELAY,
            planted: next,
            owner: owners.includes(0) ? 0 : Math.min(...owners),
            passIds: [],
            barrel: true,
          });
        }
      }
    }
  }
  function dangerSet(a = null) {
    const cells = [];
    for (const b of bombs)
      if (!a || b.owner === a.id || b.at - elapsed < ROLES[a.role].caution)
        cells.push(...blastReach(board, b.x, b.y, b.range));
    for (const f of fronts) cells.push(...frontReach(board, f));
    for (const f of flames) if (f.until > elapsed) cells.push([f.x, f.y]);
    return new Set(cells.map(([x, y]) => key(x, y)));
  }
  function escape(a, danger, limit = 12) {
    const queue = [{ x: a.x, y: a.y, first: null, n: 0 }],
      seen = new Set([key(a.x, a.y)]);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p.first && !danger.has(key(p.x, p.y))) return p.first;
      if (p.n >= limit) continue;
      for (const [dx, dy] of DIRS) {
        const x = p.x + dx,
          y = p.y + dy,
          k = key(x, y);
        if (seen.has(k) || !canMove(x, y, a) || activeAt(x, y)) continue;
        seen.add(k);
        queue.push({ x, y, first: p.first || [dx, dy], n: p.n + 1 });
      }
    }
    return null;
  }
  function startMove(a, dx, dy) {
    if (!a.alive || a.moving || (!dx && !dy) || !canMove(a.x + dx, a.y + dy, a)) return false;
    a.direction = [dx, dy];
    a.moving = { x: a.x + dx, y: a.y + dy, progress: 0 };
    a.moveClock = a.speed;
    return true;
  }
  function enemyDecision(a) {
    if (!a.alive || a.moving) return;
    if (a.restUntil > elapsed) return;
    const role = ROLES[a.role];
    if (a.stamina === 0) a.stamina = role.stamina;
    const danger = dangerSet(a);
    if (danger.has(key(a.x, a.y))) {
      a.arming = 0;
      // A rival needs a moment to notice that it is standing in a blast before it runs.
      if (a.alarmAt === null) a.alarmAt = elapsed;
      const route = elapsed - a.alarmAt >= role.react ? escape(a, danger) : null;
      if (route) startMove(a, ...route);
      return;
    }
    a.alarmAt = null;
    const futureDanger = () =>
      new Set([...danger, ...blastReach(board, a.x, a.y, a.range).map(([x, y]) => key(x, y))]);
    const retreatLimit = Math.min(a.stamina, Math.floor((FUSE - 0.3) / a.speed));
    if (a.arming > 0) {
      if (elapsed < a.arming) return;
      const retreat = escape(a, futureDanger(), retreatLimit);
      const planted = retreat && plant(a);
      a.arming = 0;
      a.bombAt = elapsed + (role.gap + env.random() * 0.5) * garden.pace;
      if (planted) {
        startMove(a, ...retreat);
        return;
      }
    }
    const nearCrate = DIRS.some(([dx, dy]) => board[a.y + dy]?.[a.x + dx] >= CRATE);
    const attack = blastReach(board, a.x, a.y, a.range).some(([x, y]) =>
      players.some((p) => p.alive && p.x === x && p.y === y),
    );
    if (
      elapsed >= a.bombAt &&
      a.stamina === role.stamina &&
      (nearCrate || attack) &&
      escape(a, futureDanger(), retreatLimit)
    ) {
      a.arming = elapsed + 0.5;
      a.bombAt = elapsed + 4 * garden.pace;
      return;
    }
    if (elapsed < a.thinkAt) return;
    const options = DIRS.filter(
      ([dx, dy]) =>
        canMove(a.x + dx, a.y + dy, a) &&
        !danger.has(key(a.x + dx, a.y + dy)) &&
        !activeAt(a.x + dx, a.y + dy),
    );
    if (options.length) {
      if (a.role === 'scout') {
        // Scouts follow the real walking route to the gardener, so a pillar or wall cannot trap them.
        const route = walkingDistances(board, players[0].x, players[0].y);
        const away = (d) => route.get(key(a.x + d[0], a.y + d[1])) ?? Infinity;
        options.sort((u, v) => away(u) - away(v));
      }
      startMove(
        a,
        ...(a.role === 'scout' ? options[0] : options[Math.floor(env.random() * options.length)]),
      );
    }
    a.thinkAt = elapsed + 0.12;
  }
  function hitActors() {
    for (const a of all()) {
      if (!a.alive) continue;
      const hit = flames.find(
        (f) =>
          f.until > elapsed + 1e-9 &&
          Math.abs(a.px - f.x) < 0.5 + RADIUS &&
          Math.abs(a.py - f.y) < 0.5 + RADIUS,
      );
      if (hit) {
        a.alive = false;
        a.moving = null;
        if (a.ai) score += hit.owners.includes(0) ? 150 : 50;
        env.sound('hit');
        continue;
      }
      // Upgrades are for the gardener only: rivals never pick them up, so they stay put.
      if (!a.moving && !a.ai) {
        const pickup = pickups.find(
          (p) => p.x === a.x && p.y === a.y && p.protectedUntil < elapsed,
        );
        if (pickup) {
          if (pickup.type === 'range') a.range = Math.min(MAX_RANGE, a.range + 1);
          else a.capacity = Math.min(MAX_CAPACITY, a.capacity + 1);
          pickups = pickups.filter((p) => p !== pickup);
          if (a.id === 0) score += 25;
          env.sound('coin');
        }
      }
    }
  }
  function checkRound() {
    if (duel) {
      if (players.some((p) => !p.alive)) {
        const living = players.filter((p) => p.alive);
        finish(
          players[0].alive,
          living.length
            ? env.t(
                `Player ${living[0].id + 1} wins the garden!`,
                `玩家${living[0].id + 1}赢得花园对决！`,
              )
            : env.t('A double knockout! The garden is a draw.', '双双出局！花园对决平局。'),
        );
      }
    } else if (!players[0].alive) {
      lives--;
      score = stageScore;
      if (lives <= 0)
        finish(
          false,
          env.t(
            'Out of hearts. Leave an escape route before planting.',
            '生命耗尽。放置炸弹前请留下逃生路线。',
          ),
        );
      else respawn = 1.2;
    } else if (enemies.every((e) => !e.alive)) {
      transition = 1.3;
      score += Math.ceil(time) * 3;
      saveUnlocked(Math.min(GARDEN_COUNT, level + 1));
      env.sound('win');
    }
  }
  function playerIntent(i, input) {
    const a = players[i];
    let dx = 0,
      dy = 0;
    if (i === 0) {
      const alt = (code) => (duel ? [] : [code]);
      dx =
        Number(input.held('KeyD', ...alt('ArrowRight'))) -
        Number(input.held('KeyA', ...alt('ArrowLeft')));
      dy =
        Number(input.held('KeyS', ...alt('ArrowDown'))) -
        Number(input.held('KeyW', ...alt('ArrowUp')));
      if (input.pressed('Space', 'KeyJ')) a.pendingBomb = true;
    } else {
      dx = Number(input.held('ArrowRight')) - Number(input.held('ArrowLeft'));
      dy = Number(input.held('ArrowDown')) - Number(input.held('ArrowUp'));
      if (input.pressed('Enter', 'Slash')) a.pendingBomb = true;
    }
    if (!duel && input.pointer.clicked) {
      const vx = input.pointer.x - (OX + a.px * CELL + 15),
        vy = input.pointer.y - (OY + a.py * CELL + 15);
      if (Math.hypot(vx, vy) < 14) a.pendingBomb = true;
      else if (Math.abs(vx) > Math.abs(vy)) dx = Math.sign(vx);
      else dy = Math.sign(vy);
    }
    if (a.pendingBomb && !a.moving) {
      plant(a);
      a.pendingBomb = false;
    }
    if (!a.alive || a.moving || !(dx || dy)) return null;
    const step = [dx, dx ? 0 : dy];
    return { a, dx: step[0], dy: step[1], x: a.x + step[0], y: a.y + step[1] };
  }
  function advanceGarden() {
    if (level === GARDEN_COUNT) {
      finish(
        true,
        env.t(`All ${GARDEN_COUNT} gardens are clear!`, `${GARDEN_COUNT}座花园全部清空！`),
      );
      return;
    }
    stageUpgrades = { range: players[0].range, capacity: players[0].capacity };
    stageScore = score;
    level++;
    lives = Math.min(MAX_HEARTS, lives + 1);
    newGarden();
  }
  function tick(dt, input) {
    elapsed += dt;
    banner = Math.max(0, banner - dt);
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
    }
    particles = particles.filter((p) => p.life > 0).slice(-100);
    if (respawn > 0) {
      respawn = Math.max(0, respawn - dt);
      if (respawn === 0) newGarden();
      return;
    }
    if (transition > 0) {
      transition = Math.max(0, transition - dt);
      if (transition === 0) advanceGarden();
      return;
    }
    time -= dt;
    if (time <= 0) {
      finish(
        false,
        duel
          ? env.t('Time is up. The duel is a draw.', '时间到，双方平局。')
          : env.t('Time is up. Find a faster route.', '时间到，请寻找更快的路线。'),
      );
      return;
    }
    const intents = players.map((_, i) => playerIntent(i, input)).filter(Boolean);
    for (const intent of intents)
      if (intents.filter((i) => i.x === intent.x && i.y === intent.y).length === 1)
        startMove(intent.a, intent.dx, intent.dy);
    for (const a of enemies) enemyDecision(a);
    for (const a of all())
      if (a.alive && a.moving) {
        a.moving.progress = Math.min(1, a.moving.progress + dt / a.speed);
        const t = a.moving.progress;
        a.px = a.x + (a.moving.x - a.x) * t;
        a.py = a.y + (a.moving.y - a.y) * t;
        a.moveClock = Math.max(0, a.speed * (1 - t));
        a.anim = t;
        if (t >= 1 - 1e-9) {
          a.x = a.moving.x;
          a.y = a.moving.y;
          a.px = a.x;
          a.py = a.y;
          a.moving = null;
          a.moveClock = 0;
          if (a.ai) {
            a.stamina--;
            if (a.stamina <= 0) a.restUntil = elapsed + ROLES[a.role].rest;
          }
          if (a.pendingBomb) {
            plant(a);
            a.pendingBomb = false;
          }
        }
      }
    for (const b of bombs)
      b.passIds = b.passIds.filter((id) => {
        const a = all().find((p) => p.id === id);
        return a?.alive && Math.hypot(a.px - b.x, a.py - b.y) <= RADIUS + 0.32;
      });
    processEvents();
    flames = flames.filter((f) => f.emberUntil > elapsed);
    hitActors();
    checkRound();
  }
  function say(en, zh) {
    menuNote = { en, zh, left: MENU_NOTE_TIME };
  }
  // The garden select: arrows or WASD move the cursor, Space/Enter/J or a second tap starts.
  function menuStep(dt, input) {
    if (menuNote && (menuNote.left -= dt) <= 0) menuNote = null;
    const was = menu.cursor,
      pick = (neg, pos, size) =>
        Number(input.pressed(...pos)) * size - Number(input.pressed(...neg)) * size;
    const move =
      pick(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD'], 1) +
      pick(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS'], 6);
    menu.cursor = Math.max(1, Math.min(menu.unlocked, menu.cursor + move));
    if (menu.cursor !== was) env.sound('move');
    let start = input.pressed('Space', 'Enter', 'KeyJ');
    if (input.pointer.clicked) {
      const tapped = menuHit(input.pointer.x, input.pointer.y, GARDEN_COUNT);
      if (tapped > menu.unlocked)
        say(`Clear garden ${menu.unlocked} first.`, `请先通关第${menu.unlocked}座花园。`);
      else if (tapped === menu.cursor) start = true;
      else if (tapped) {
        menu.cursor = tapped;
        env.sound('move');
      }
    }
    if (!start) return;
    level = menu.cursor;
    menu = null;
    menuNote = null;
    newGarden();
  }
  function update(dt, input) {
    if (phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    if (menu) {
      menuStep(Math.min(dt, 1 / 30), input);
      return;
    }
    const count = Math.max(1, Math.ceil(Math.min(dt, 1 / 30) * 240)),
      sub = Math.min(dt, 1 / 30) / count;
    for (let i = 0; i < count && phase === 'playing'; i++)
      tick(
        sub,
        i === 0
          ? input
          : { ...input, pressed: () => false, pointer: { ...input.pointer, clicked: false } },
      );
  }
  const rivalsLeft = () => enemies.filter((e) => e.alive).length;
  const statusText = () => {
    if (duel)
      return {
        en: 'Local duel · Four-port charges · Last gardener standing',
        zh: '本地对战 · 四向喷焰炸弹 · 最后幸存者获胜',
      };
    if (menu)
      return {
        en: `Choose a garden (1-${menu.unlocked} open of ${GARDEN_COUNT}) · Space starts`,
        zh: `选择花园（已开放 1-${menu.unlocked} / 共${GARDEN_COUNT}座）· 空格开始`,
      };
    return {
      en: `Garden ${level}/${GARDEN_COUNT} · ${lives} hearts · ${rivalsLeft()} rivals`,
      zh: `花园 ${level}/${GARDEN_COUNT} · ${lives} 生命 · 剩余 ${rivalsLeft()} 个对手`,
    };
  };
  return {
    update,
    draw(ctx) {
      const view = {
        env,
        duel,
        level,
        garden,
        lives,
        time,
        elapsed,
        banner,
        transition,
        respawn,
        board,
        wet,
        drops,
        players,
        enemies,
        bombs,
        flames,
        fronts,
        pickups,
        particles,
        rivalsLeft: rivalsLeft(),
        menu,
        menuNote,
      };
      if (menu) drawMenu(ctx, view);
      else drawGame(ctx, view);
    },
    getState() {
      return {
        phase,
        score,
        level,
        time,
        totalLevels: duel ? 1 : GARDEN_COUNT,
        lives,
        respawn,
        transition,
        elapsed,
        menu: menu ? { ...menu } : null,
        garden: { en: garden.name.en, zh: garden.name.zh },
        tip: { ...garden.tip },
        news: [...garden.news],
        rivalsLeft: rivalsLeft(),
        danger: [...dangerSet()].map((k) => k.split(',').map(Number)),
        wetCells: [...wet].map((k) => k.split(',').map(Number)),
        board: board.map((row) => [...row]),
        players: players.map((p) => structuredClone(p)),
        enemies: enemies.map((p) => structuredClone(p)),
        bombs: bombs.map((b) => ({
          ...b,
          passIds: [...b.passIds],
          fuse: Math.max(0, b.at - elapsed),
        })),
        fronts: fronts.map((f) => ({ ...f })),
        flames: flames.map((f) => ({
          ...f,
          owners: [...f.owners],
          cells: [[f.x, f.y]],
          active: f.until > elapsed,
          life: Math.max(0, f.emberUntil - elapsed),
        })),
        pickups: pickups.map((p) => ({ ...p })),
        status: statusText(),
      };
    },
  };
}
