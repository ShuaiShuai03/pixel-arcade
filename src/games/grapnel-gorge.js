// Grapnel Gorge: swing across twenty canyon routes with a winch and a grappling hook.
import { clamp } from '../shared/utils.js';
import { PHYSICS, mechanicalEnergy } from './grapnel-gorge-math.js';
import { LEVEL_COUNT } from './grapnel-gorge-levels.js';
import {
  createGrapnelState,
  setRoute,
  available,
  hook,
  rescue,
  cutRope,
} from './grapnel-gorge-core.js';
import { stepPhysics, landingPreview } from './grapnel-gorge-step.js';
import { draw } from './grapnel-gorge-draw.js';
import { MENU_COLUMNS, menuTarget, drawSelect } from './grapnel-gorge-menu.js';

export {
  PHYSICS,
  mechanicalEnergy,
  anchorPose,
  pendulumStep,
  advanceTaut,
  captureRope,
  sweepCircle,
  segmentHit,
  movingRopeHit,
} from './grapnel-gorge-math.js';
export { routePlan, LEVELS, LEVEL_COUNT } from './grapnel-gorge-levels.js';
export { createGrapnelState, cutRope };

export const meta = {
  id: 'grapnel-gorge',
  name: { en: 'Grapnel Gorge', zh: '钩索峡谷' },
  genre: 'action',
  players: '1',
  touch: true,
  description: {
    en: 'Cross twenty canyon routes and land at each flag. Walk on stone; flight keeps its momentum. Space hooks the marked clear anchor 58–238 pixels away, or releases. Up powers the winch inward; Down pays rope out. Rest motionless on a cairn to recharge. X selects an anchor. Rock blocks hooks and cuts a touching rope. Z returns to the last cairn for one life. Enter travels after a clear. Relics are optional. Landing dots end in a check for safe stone or a cross for rock/water. Tap an anchor to aim. Pick up from your last route.',
    zh: '穿越二十条峡谷路线，在每个旗台着陆。石台上步行，腾空后保持惯性。空格连接58至238像素内高亮且无遮挡的锚点，或松开绳索。上键驱动绞盘收绳，下键放绳；在石台静止休息补充电量。X选择锚点。岩石阻挡钩索，也会切断接触它的绳索。Z消耗一条生命返回上一石台，通关后回车前进。遗物可选，松绳落点的对勾表示安全石台，叉号表示岩石或水面。点按锚点即可瞄准，并可从上次路线继续。',
  },
  keys: [
    {
      label: { en: 'Walk on stone (no air thrust)', zh: '石台上步行（空中无推力）' },
      keys: 'A D / ← →',
    },
    { label: { en: 'Hook / release', zh: '连接 / 松开' }, keys: 'Space' },
    { label: { en: 'Reel in / pay out', zh: '收绳 / 放绳' }, keys: 'W S / ↑ ↓' },
    { label: { en: 'Select available anchor', zh: '选择可用锚点' }, keys: 'X / tap anchor' },
    { label: { en: 'Rescue: one life', zh: '救援：消耗一条生命' }, keys: 'Z' },
    { label: { en: 'Travel after landing at flag', zh: '旗台着陆后前进' }, keys: 'Enter / tap' },
    {
      label: { en: 'Route select', zh: '路线选择' },
      keys: { en: 'Arrows + Space, or tap a route', zh: '方向键 + 空格，或点按路线' },
    },
  ],
  touchControls: [
    { code: 'ArrowLeft', side: 'left', label: { en: 'Walk left', zh: '向左步行' } },
    { code: 'ArrowRight', side: 'left', label: { en: 'Walk right', zh: '向右步行' } },
    { code: 'KeyX', side: 'left', label: { en: 'Target', zh: '选锚点' } },
    { code: 'Space', side: 'right', label: { en: 'Hook / release', zh: '连接 / 松开' } },
    { code: 'ArrowUp', side: 'right', label: { en: 'Reel in', zh: '收绳' } },
    { code: 'ArrowDown', side: 'right', label: { en: 'Pay out', zh: '放绳' } },
    { code: 'KeyZ', side: 'right', label: { en: 'Rescue −1 life', zh: '救援 −1生命' } },
    { code: 'Enter', side: 'right', label: { en: 'Next route', zh: '下一路线' } },
  ],
};

const MAX_PENDING = 8;
const TAP_RADIUS = 30;
const MAX_STEP_DT = 1 / 30;

function tapPoint(input) {
  const p = input.pointer;
  if (!p?.clicked) return null;
  const x = Number(p.x),
    y = Number(p.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function tappedAnchor(s, point) {
  let best = null,
    bestDistance = TAP_RADIUS;
  for (const a of available(s)) {
    const d = Math.hypot(a.x - point.x, a.y - point.y);
    if (a.eligible && d <= bestDistance) {
      best = a.id;
      bestDistance = d;
    }
  }
  return best;
}
/** Every discrete press this frame, in a fixed order, so simultaneous taps are never merged. */
function queueActions(s, input) {
  const actions = [];
  const tap = tapPoint(input),
    aimed = tap && tappedAnchor(s, tap);
  if (aimed !== null && aimed !== undefined && aimed !== false)
    actions.push({ type: 'aim', id: aimed });
  if (input.pressed('KeyX')) actions.push({ type: 'target' });
  if (input.pressed('Space')) actions.push({ type: 'hook' });
  if (input.pressed('KeyZ') && !s.recovering) actions.push({ type: 'rescue' });
  for (const action of actions) if (s.pending.length < MAX_PENDING) s.pending.push(action);
}
function runAction(s, action, env) {
  if (action.type === 'rescue') return rescue(s, env, 'rescue');
  if (action.type === 'hook') return hook(s, env);
  const list = available(s).filter((a) => a.eligible);
  if (!list.length) return;
  if (action.type === 'aim') {
    if (list.some((a) => a.id === action.id)) s.target = action.id;
    return;
  }
  const at = list.findIndex((a) => a.id === s.target);
  s.target = list[(at + 1) % list.length].id;
}
export function updateGrapnelState(s, dt, input, env) {
  if (s.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, MAX_STEP_DT);
  if (s.betweenRoutes) {
    if (input.pressed('Enter') || input.pointer?.clicked) setRoute(s, s.level + 1);
    return;
  }
  queueActions(s, input);
  const controls = {
    walk: Number(input.held('ArrowRight', 'KeyD')) - Number(input.held('ArrowLeft', 'KeyA')),
    reel: Number(input.held('ArrowDown', 'KeyS')) - Number(input.held('ArrowUp', 'KeyW')),
  };
  s.walkInput = controls.walk;
  s.accumulator += dt;
  while (s.accumulator + 1e-12 >= PHYSICS.step && s.phase === 'playing' && !s.betweenRoutes) {
    s.accumulator = Math.max(0, s.accumulator - PHYSICS.step);
    if (s.pending.length && !s.recovering) runAction(s, s.pending.shift(), env);
    if (s.phase !== 'playing') return;
    stepPhysics(s, PHYSICS.step, controls, env);
  }
  if (s.betweenRoutes) {
    s.accumulator = 0;
    s.pending = [];
  }
}
function readUnlocked(progress) {
  try {
    const n = Math.floor(Number(progress.unlocked()));
    return Number.isFinite(n) ? clamp(n, 1, LEVEL_COUNT) : 1;
  } catch {
    return 1;
  }
}
function saveUnlocked(progress, level) {
  try {
    progress.unlock(level);
  } catch {
    // Progress is a convenience: a broken store must not stop the game.
  }
}
export function createGame(env) {
  let s = createGrapnelState(1),
    unlocked = env.progress ? readUnlocked(env.progress) : 1,
    menu = unlocked > 1 ? { cursor: unlocked } : null;

  function menuStep(input) {
    const target = menuTarget(input, menu.cursor, unlocked);
    menu = { cursor: target.cursor };
    if (target.denied) env.sound('hit');
    else if (target.moved) env.sound('move');
    if (!target.start) return;
    s = createGrapnelState(menu.cursor);
    menu = null;
  }
  function update(dt, input) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (menu) return menuStep(input);
    updateGrapnelState(s, dt, input, env);
    if (!s.betweenRoutes) return;
    unlocked = Math.max(unlocked, s.level + 1);
    if (env.progress) saveUnlocked(env.progress, unlocked);
  }
  function status() {
    if (menu)
      return {
        en: `Choose a route · ${menu.cursor}/${LEVEL_COUNT}`,
        zh: `选择路线 · ${menu.cursor}/${LEVEL_COUNT}`,
      };
    const winch = Math.ceil((s.charge / PHYSICS.battery) * 100);
    return {
      en: `${s.route.name.en} ${s.level}/${LEVEL_COUNT} · ${s.lives} ${s.lives === 1 ? 'life' : 'lives'} · ${winch}% winch · ${s.notice.en}`,
      zh: `${s.route.name.zh} ${s.level}/${LEVEL_COUNT} · ${s.lives}生命 · 绞盘${winch}% · ${s.notice.zh}`,
    };
  }
  return {
    update,
    draw: (ctx) =>
      menu ? drawSelect(ctx, env, { cursor: menu.cursor, unlocked }) : draw(ctx, s, env),
    getState() {
      const state = structuredClone(s);
      delete state.pending;
      state.energy = (s.charge / PHYSICS.battery) * 100;
      state.anchors = available(s);
      state.platforms = structuredClone(s.route.pads);
      state.relics = s.route.relics.map((r) => ({ ...r, taken: s.collected.includes(r.id) }));
      state.landing = landingPreview(s);
      state.energyBalance =
        mechanicalEnergy(s.player) -
        s.energyBaseline -
        s.ledger.winch -
        s.ledger.anchor -
        s.ledger.ground +
        s.ledger.contactLoss +
        s.ledger.captureLoss -
        s.ledger.numerical;
      state.totalLevels = LEVEL_COUNT;
      state.unlocked = unlocked;
      state.menu = menu
        ? { cursor: menu.cursor, unlocked, total: LEVEL_COUNT, columns: MENU_COLUMNS }
        : null;
      state.status = status();
      return state;
    },
  };
}
