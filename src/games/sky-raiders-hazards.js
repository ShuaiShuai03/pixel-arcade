// Strike zones: a lane, a column, a grid of columns or both at once flash a warning, then fire.
// They are aimed at where the pilot is when the warning starts, so only moving out of the lit
// area avoids them; parking in one lane or one column is punished.
import { clamp } from '../shared/utils.js';
import { hitPlayer } from './sky-raiders-step.js';
import { hullRects } from './sky-raiders-sprites.js';
import { SECTORS } from './sky-raiders-sectors.js';

export const HAZARD_LIVE = 0.45;
const LANE_HEIGHT = 16;
const COLUMN_WIDTH = 44;
const GRID_WIDTH = 52;
const GRID_SPACING = 160;
const TOP = 48;
const BOTTOM = 304;
const AIM_JITTER = 24;
const LEAD = 0.8;

const laneAt = (y) => ({ x: 0, y: y - LANE_HEIGHT / 2, w: 480, h: LANE_HEIGHT });
const columnAt = (x, width = COLUMN_WIDTH) => ({
  x: x - width / 2,
  y: TOP,
  w: width,
  h: BOTTOM - TOP,
});

/** Zones are aimed where the pilot will be if they keep their present velocity until the strike. */
function zonesFor(kind, player, random, warn) {
  const jitter = () => (random() - 0.5) * AIM_JITTER,
    aheadX = clamp(player.x + player.vx * warn * LEAD, 28, 452),
    aheadY = clamp(player.y + player.vy * warn * LEAD, 80, 280),
    lane = () => laneAt(clamp(aheadY + jitter(), 80, 280)),
    column = () => columnAt(clamp(aheadX + jitter(), 28, 452));
  if (kind === 'lane') return [lane()];
  if (kind === 'column') return [column()];
  if (kind === 'cross') return [lane(), column()];
  // A grid always lands one column on the predicted position; the open aisles are the way out.
  const aimed = Math.floor(random() * 3);
  return [0, 1, 2].map((n) => columnAt(aheadX + (n - aimed) * GRID_SPACING, GRID_WIDTH));
}
export function spawnHazard(s, env, kind, warn) {
  s.hazards.push({
    id: s.nextId++,
    kind,
    rects: zonesFor(kind, s.player, env.random, warn),
    warn,
    warnTotal: warn,
    live: HAZARD_LIVE,
    struck: false,
  });
}
/** Start a strike whenever the sector's schedule says so. */
export function scheduleHazards(s, env, h) {
  const plan = SECTORS[s.level - 1].hazard;
  if (!plan) return;
  s.hazardClock -= h;
  if (s.hazardClock > 0) return;
  spawnHazard(s, env, plan.kinds[s.hazardCount % plan.kinds.length], plan.warn);
  s.hazardCount++;
  s.hazardClock = plan.every;
}
const touches = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** Advance warnings, damage a pilot caught in a live zone once, and drop spent strikes. */
export function stepHazards(s, env, h) {
  for (const hazard of s.hazards) {
    if (hazard.warn > 0) {
      hazard.warn = Math.max(0, hazard.warn - h);
      continue;
    }
    hazard.live -= h;
    if (hazard.struck) continue;
    const caught = hullRects(s.player).some((hull) =>
      hazard.rects.some((zone) => touches(hull, zone)),
    );
    if (caught && hitPlayer(s, env, 1, 'hazard')) hazard.struck = true;
  }
  s.hazards = s.hazards.filter((hazard) => hazard.live > 0);
}
