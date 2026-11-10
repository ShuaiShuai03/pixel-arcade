import { clamp } from '../shared/utils.js';
import { RULES } from './tether-twins-rules.js';
import { ROOMS, ROOM_COUNT } from './tether-twins-rooms.js';
import { advance, loadRoom, newState } from './tether-twins-sim.js';
import { snapshotOf } from './tether-twins-snapshot.js';
import { drawGame } from './tether-twins-draw.js';
import { MENU_COLUMNS, drawSelect, menuTarget } from './tether-twins-menu.js';
import { segHitsRect } from './tether-twins-world.js';

export { RULES, advance, loadRoom, newState, segHitsRect, snapshotOf };

const touch = (rows) => rows.map(([code, en, zh, side]) => ({ code, side, label: { en, zh } }));

export const meta = {
  id: 'tether-twins',
  name: { en: 'Tether Twins', zh: '牵绳双子' },
  genre: 'action',
  players: '1-2',
  touch: true,
  description: {
    en: 'Two linked robots share one insulated cable of fixed length. The cable bends around posts and wall corners, never stretches and never crosses a wall. Plates light while the cable lies across them, gates open while powered, and tension relays latch when the cable is wrapped round them and pulled TAUT. Live strips zap a robot that touches them, and flashing strips are safe only while dark. Put both robots on their pads in all twenty rooms; pick any unlocked room and continue where you left off. Solo: X switches the active robot, the partner holds still. Co-op: one player each.',
    zh: '两个相连的机器人共用一根固定长度的绝缘电缆。电缆会绕过立柱和墙角，不会拉长，也不会穿墙。电缆压过电板时电板亮起，通电时闸门开启；电缆绕在张力继电柱上并拉紧时，继电器锁定。带电条会电击接触它的机器人，闪烁的电条只有熄灭时才安全。在二十个房间中让两个机器人都站上各自的终点板；可选择任一已解锁房间，并从上次进度继续。单人：按 X 切换当前机器人，另一个保持不动。双人：各控制一个。',
  },
  keys: [
    { label: { en: 'Red (P1) move', zh: '红色（玩家一）移动' }, keys: 'W A S D' },
    { label: { en: 'Red reel in / pay out', zh: '红色 收线 / 放线' }, keys: 'F / G' },
    { label: { en: 'Blue (P2) move', zh: '蓝色（玩家二）移动' }, keys: '↑ ← ↓ →' },
    { label: { en: 'Blue reel in / pay out', zh: '蓝色 收线 / 放线' }, keys: ', / .' },
    { label: { en: 'Solo: switch robot', zh: '单人：切换机器人' }, keys: 'X' },
    {
      label: { en: 'Room select', zh: '选择房间' },
      keys: { en: 'Arrows + Space / X, or tap a room', zh: '方向键 + 空格 / X，或点按房间' },
    },
  ],
  touchControls: touch([
    ['ArrowLeft', 'Left', '左', 'left'],
    ['ArrowUp', 'Up', '上', 'left'],
    ['ArrowDown', 'Down', '下', 'left'],
    ['ArrowRight', 'Right', '右', 'left'],
    ['KeyX', 'Switch', '切换', 'right'],
    ['KeyF', 'Reel in', '收线', 'right'],
    ['KeyG', 'Pay out', '放线', 'right'],
  ]),
  multiplayerTouchControls: touch([
    ['KeyA', 'A', 'A', 'left'],
    ['KeyW', 'W', 'W', 'left'],
    ['KeyS', 'S', 'S', 'left'],
    ['KeyD', 'D', 'D', 'left'],
    ['KeyF', 'Reel', '收', 'left'],
    ['KeyG', 'Pay', '放', 'left'],
    ['ArrowLeft', '◀', '◀', 'right'],
    ['ArrowUp', '▲', '▲', 'right'],
    ['ArrowDown', '▼', '▼', 'right'],
    ['ArrowRight', '▶', '▶', 'right'],
    ['Comma', 'Reel', '收', 'right'],
    ['Period', 'Pay', '放', 'right'],
  ]),
};

const readUnlocked = (progress) => {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, ROOM_COUNT) : 1;
  } catch {
    return 1;
  }
};
const saveUnlocked = (progress, level) => {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
};

export const END_TEXT = Object.freeze({
  won: Object.freeze([
    'All twenty rooms are wired. The twins are home!',
    '二十个房间全部接通，双子顺利回家！',
  ]),
  lost: Object.freeze([
    'The cells ran dry. Keep the robots off live strips and try again.',
    '电量耗尽。让机器人远离带电条，再试一次。',
  ]),
});

export function createGame(env) {
  let unlocked = env.progress ? readUnlocked(env.progress) : 1;
  let menu = unlocked > 1 ? { cursor: unlocked } : null;
  let startLevel = 1;
  let s = newState(env, 0);
  let ended = false;
  const emit = (name) => env.sound(name);

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) emit('hit');
    else if (target.moved) emit('move');
    if (!target.start) return;
    startLevel = menu.cursor;
    s = newState(env, startLevel - 1);
    menu = null;
  }
  function recordProgress() {
    // Clearing a room unlocks the next one; the last room unlocks only itself.
    const next = Math.min(ROOM_COUNT, startLevel + s.stats.rooms);
    if (next <= unlocked) return;
    unlocked = next;
    if (env.progress) saveUnlocked(env.progress, next);
  }
  function finish() {
    ended = true;
    const won = s.phase === 'won';
    emit(won ? 'win' : 'lose');
    env.end({ won, score: s.score, message: env.t(...END_TEXT[s.phase]) });
  }
  return {
    update(dt, input) {
      if (ended || !Number.isFinite(dt) || dt <= 0) return;
      if (menu) return menuStep(input);
      const cleared = s.stats.rooms;
      advance(s, dt, input, emit);
      if (s.stats.rooms > cleared) recordProgress();
      if (s.phase !== 'playing') finish();
    },
    draw(ctx) {
      if (menu) drawSelect(ctx, env, { cursor: menu.cursor, unlocked });
      else drawGame(ctx, s, env);
    },
    getState() {
      const snap = snapshotOf(s);
      const total = ROOM_COUNT;
      return {
        ...snap,
        totalLevels: total,
        unlocked,
        menu: menu ? { cursor: menu.cursor, unlocked, total, columns: MENU_COLUMNS } : null,
        status: menu
          ? {
              en: `Choose a room · ${menu.cursor}/${total} ${ROOMS[menu.cursor - 1].name.en}`,
              zh: `选择房间 · ${menu.cursor}/${total} ${ROOMS[menu.cursor - 1].name.zh}`,
            }
          : snap.status,
      };
    },
  };
}
