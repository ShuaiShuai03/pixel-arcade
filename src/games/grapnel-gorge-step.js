// Fixed-step physics and the landing preview.
import {
  PHYSICS,
  G,
  R,
  EPS,
  sq,
  dot,
  roots,
  tension,
  mechanicalEnergy,
  anchorPose,
  captureRope,
  contactVelocity,
  sweepCircle,
  movingRopeHit,
} from './grapnel-gorge-math.js';
import { LEVEL_COUNT } from './grapnel-gorge-levels.js';
import {
  support,
  addWork,
  notify,
  setRate,
  rescue,
  finish,
  cutRope,
} from './grapnel-gorge-core.js';
import {
  prepareWall,
  prepareCorner,
  prepareArc,
  predict,
  cornerPose,
  curvedContact,
} from './grapnel-gorge-contact.js';
import { clamp } from '../shared/utils.js';

function curvedRelicEntry(s, h, relic, guess) {
  const gap = (t) => {
    const p = predict(s, t).player;
    return Math.hypot(p.x - relic.x, p.y - relic.y) - (R + 8);
  };
  if (gap(0) <= 0) return 0;
  const times = [guess * h, ...Array.from({ length: 8 }, (_, i) => ((i + 1) * h) / 8)].sort(
    (a, b) => a - b,
  );
  let lo = 0;
  for (const end of times) {
    if (end < lo) continue;
    if (gap(end) <= 0) {
      let hi = end;
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    lo = end;
  }
  return null;
}
function crossingTime(fn, h) {
  let lo = 0,
    hi = h;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) > 0) hi = mid;
    else lo = mid;
  }
  return hi;
}
function captureNow(s) {
  const r = s.rope,
    a = anchorPose(s.route.anchors[r.id], s.routeTime),
    dx = s.player.x - a.x,
    dy = s.player.y - a.y,
    d = Math.hypot(dx, dy),
    radial = ((s.player.vx - a.vx) * dx + (s.player.vy - a.vy) * dy) / d;
  if (d < r.length - 1e-6 || radial < r.rate - EPS) return false;
  if (support(s) && !r.rate && !a.vx && !a.vy && Math.abs(s.player.vx) < EPS) return false;
  let result = captureRope(s.player, a, r.length, r.rate);
  if (result.winchWork > s.charge + EPS) {
    r.rate = 0;
    result = captureRope(s.player, a, r.length, 0);
    notify(
      s,
      'Winch stalled under load. Rest to recharge; release and rescue remain available.',
      '绞盘负载过大，请休息充电；仍可松绳或救援。',
    );
  }
  Object.assign(s.player, result.player);
  s.rope = { ...r, ...result.rope };
  addWork(s, result);
  if (s.rope.taut && s.player.vy < -EPS) s.player.ground = false;
  return s.rope.taut || result.captureLoss > EPS;
}
const PENETRATION_EPS = 1e-6;
/**
 * Contact resolution of last resort: a constraint (a taut rope under a moving anchor) can carry
 * the circle a hair into a face between two sweep tests. Push it back out along the face normal,
 * drop the inward velocity and book the potential-energy change as numerical work.
 */
function resolvePenetration(s) {
  for (const rect of s.route.solids) {
    const p = s.player,
      cx = clamp(p.x, rect.x, rect.x + rect.w),
      cy = clamp(p.y, rect.y, rect.y + rect.h),
      d = Math.hypot(p.x - cx, p.y - cy);
    if (d >= R - PENETRATION_EPS || (d === 0 && rect.h <= 0)) continue;
    const inside = d === 0,
      nx = inside ? 0 : (p.x - cx) / d,
      ny = inside ? -1 : (p.y - cy) / d,
      before = mechanicalEnergy(p);
    p.x = cx + nx * R;
    p.y = inside ? rect.y - R : cy + ny * R;
    const inward = p.vx * nx + p.vy * ny;
    if (inward < 0) {
      p.vx -= inward * nx;
      p.vy -= inward * ny;
    }
    s.ledger.numerical += mechanicalEnergy(p) - before;
    if (s.rope) {
      s.rope.taut = false;
      s.rope.tension = 0;
      delete s.rope.wall;
      delete s.rope.corner;
    }
  }
}
const MAX_STALLED_EVENTS = 24;
const STALL_SPAN = 1e-6;
export function stepPhysics(s, h, controls, env) {
  if (s.recovering > 0) {
    s.recovering = Math.max(0, s.recovering - h);
    s.time += h;
    s.routeTime += h;
    return;
  }
  const floor = support(s);
  s.player.ground = !!floor;
  if (floor) {
    const target = controls.walk * PHYSICS.walkSpeed,
      before = s.player.vx;
    s.player.vx += clamp(target - s.player.vx, -PHYSICS.walkForce * h, PHYSICS.walkForce * h);
    s.ledger.ground += (sq(s.player.vx) - sq(before)) / 2;
    if (Math.abs(s.player.vx) < 5 && (!s.rope || !s.rope.taut))
      s.charge = Math.min(PHYSICS.battery, s.charge + PHYSICS.battery * 0.25 * h);
    if (s.rope?.taut) {
      s.rope.taut = false;
      s.rope.tension = 0;
      delete s.rope.wall;
      delete s.rope.corner;
    }
  }
  setRate(s, controls.reel * PHYSICS.reelSpeed);
  let remaining = h,
    stalled = 0;
  while (remaining > 1e-10 && s.phase === 'playing' && !s.betweenRoutes) {
    if (stalled > MAX_STALLED_EVENTS) {
      // Wedged between two surfaces: contacts keep firing at zero time. Come to rest.
      s.player.vx = 0;
      s.player.vy = 0;
      s.time += remaining;
      s.routeTime += remaining;
      break;
    }
    resolvePenetration(s);
    prepareWall(s);
    prepareCorner(s);
    if (s.rope && !s.rope.taut) captureNow(s);
    if (s.rope?.taut) {
      const a = anchorPose(s.route.anchors[s.rope.id], s.routeTime);
      if (tension(s.rope.theta, s.rope.omega, s.rope.length, a) < -EPS) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
    }
    prepareArc(s);
    let span = remaining;
    if (s.rope?.rate < 0) span = Math.min(span, (s.rope.length - PHYSICS.minLength) / -s.rope.rate);
    if (s.rope?.rate > 0) span = Math.min(span, (PHYSICS.maxLength - s.rope.length) / s.rope.rate);
    while (
      s.rope?.corner &&
      !cornerPose(s.rope, s.route.anchors[s.rope.id], s.routeTime, span) &&
      span > 1e-10
    )
      span /= 2;
    if (span <= 1e-10) {
      setRate(s, 0);
      continue;
    }
    const horizon = span;
    let next = predict(s, horizon),
      kind = span < remaining - 1e-10 ? 'length' : null,
      hit = null;
    const pick = (time, type, info) => {
      if (time < span - 1e-10 || (!kind && Math.abs(time - span) < 1e-10)) {
        span = Math.max(0, time);
        kind = type;
        hit = info;
      }
    };
    if (s.rope?.taut && next.tensionEnd < 0)
      pick(
        crossingTime((t) => -predict(s, t).tensionEnd, horizon),
        'slack',
        null,
      );
    if (s.rope?.taut && next.winchWork > s.charge + EPS)
      pick(
        crossingTime((t) => predict(s, t).winchWork - s.charge, horizon),
        'battery',
        null,
      );
    if (s.rope?.wall) {
      const wall = s.rope.wall;
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'wall-end',
          null,
        );
      if (next.player.y < wall.minY)
        pick(
          crossingTime((t) => wall.minY - predict(s, t).player.y, horizon),
          'wall-end',
          null,
        );
      if (next.player.y > wall.maxY)
        pick(
          crossingTime((t) => predict(s, t).player.y - wall.maxY, horizon),
          'wall-end',
          null,
        );
    }
    if (s.contactArc) {
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'arc-end',
          null,
        );
      if (next.arcX < 0)
        pick(
          crossingTime((t) => -predict(s, t).arcX, horizon),
          'arc-end',
          null,
        );
      if (next.arcY < 0)
        pick(
          crossingTime((t) => -predict(s, t).arcY, horizon),
          'arc-end',
          null,
        );
    }
    if (s.rope?.corner) {
      if (next.reactionEnd < 0)
        pick(
          crossingTime((t) => -predict(s, t).reactionEnd, horizon),
          'corner-end',
          null,
        );
      if (next.quadrantX < 0)
        pick(
          crossingTime((t) => -predict(s, t).quadrantX, horizon),
          'corner-end',
          null,
        );
      if (next.quadrantY < 0)
        pick(
          crossingTime((t) => -predict(s, t).quadrantY, horizon),
          'corner-end',
          null,
        );
    }
    const from = { ...s.player };
    for (const rect of s.route.solids) {
      if (s.contactArc?.rect === rect || s.rope?.corner?.rect === rect) continue;
      const c = sweepCircle(from, next.player, R, rect);
      if (c) {
        const exact = curvedContact(s, horizon, rect, c);
        if (exact) pick(exact.time, 'solid', exact.contact);
      }
    }
    if (next.player.y >= PHYSICS.water - R && from.y < PHYSICS.water - R) {
      const at = crossingTime((t) => predict(s, t).player.y - (PHYSICS.water - R), horizon);
      pick(at, 'water', null);
    }
    if (s.rope && !s.rope.taut) {
      const r = s.rope,
        distance = (t) => {
          const p = predict(s, t).player,
            a = anchorPose(s.route.anchors[r.id], s.routeTime + t);
          return Math.hypot(p.x - a.x, p.y - a.y) - (r.length + r.rate * t);
        };
      if (distance(horizon) > EPS) pick(crossingTime(distance, horizon), 'capture', null);
    }
    if (s.rope) {
      const a0 = anchorPose(s.route.anchors[s.rope.id], s.routeTime),
        a1 = anchorPose(s.route.anchors[s.rope.id], s.routeTime + horizon),
        obstruction = movingRopeHit(a0, from, a1, next.player, s.route.solids);
      if (obstruction) pick(obstruction.at * horizon, 'cut', obstruction);
    }
    for (const relic of s.route.relics)
      if (!s.collected.includes(relic.id)) {
        const d = { x: next.player.x - from.x, y: next.player.y - from.y },
          o = { x: from.x - relic.x, y: from.y - relic.y };
        const times = roots(dot(d, d), 2 * dot(o, d), dot(o, o) - sq(R + 8)).filter(
          (t) => t >= 0 && t <= 1,
        );
        if (dot(o, o) <= sq(R + 8)) pick(0, 'relic', relic);
        else if (times.length) {
          const exact = curvedRelicEntry(s, horizon, relic, times[0]);
          if (exact !== null) pick(exact, 'relic', relic);
        }
      }
    next = predict(s, span);
    Object.assign(s.player, next.player);
    if (s.rope && next.rope) s.rope = next.rope;
    addWork(s, next);
    s.time += span;
    s.routeTime += span;
    stalled = span < STALL_SPAN ? stalled + 1 : 0;
    remaining -= span;
    if (kind === 'solid') {
      const contacts = s.route.solids
        .map((rect) => sweepCircle(from, s.player, R, rect))
        .filter((c) => c && c.at >= 1 - 1e-5);
      if (!contacts.length) contacts.push(hit);
      const v = contactVelocity(s.player.vx, s.player.vy, contacts),
        before = (sq(s.player.vx) + sq(s.player.vy)) / 2;
      s.player.vx = v.x;
      s.player.vy = v.y;
      s.ledger.contactLoss += Math.max(0, before - (sq(v.x) + sq(v.y)) / 2);
      if (s.rope) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
      s.player.ground = !!support(s);
      if (s.player.ground) {
        const pad = support(s);
        if (!s.visited.includes(pad.id)) {
          s.visited.push(pad.id);
          s.checkpoint = pad.id;
          if (!pad.exit) {
            s.score += 100;
            env.sound('coin');
            notify(
              s,
              'Cairn reached. Stop to recharge; choose the next anchor.',
              '已到达石台，停下充电并选择下一个锚点。',
            );
          }
        }
        if (pad.exit) {
          s.score += 500;
          s.completed.push(s.route.id);
          s.rope = null;
          s.lastEvent = 'clear';
          if (s.level === LEVEL_COUNT) {
            finish(s, env, true);
            return;
          } else {
            env.sound('win');
            s.betweenRoutes = true;
            notify(
              s,
              'Route clear. Enter travels to the next reach.',
              '本路线已通过，回车前往下一段峡谷。',
            );
          }
        }
      }
    } else if (kind === 'corner-end') {
      if (s.rope) delete s.rope.corner;
    } else if (kind === 'arc-end') {
      s.contactArc = null;
    } else if (kind === 'wall-end') {
      if (s.rope) delete s.rope.wall;
      delete s.rope.corner;
    } else if (kind === 'length') setRate(s, 0);
    else if (kind === 'capture') captureNow(s);
    else if (kind === 'slack') {
      if (s.rope) {
        s.rope.taut = false;
        s.rope.tension = 0;
        delete s.rope.wall;
        delete s.rope.corner;
      }
    } else if (kind === 'battery') {
      s.charge = 0;
      setRate(s, 0);
      notify(
        s,
        'Winch depleted. Pay out, release, or rescue; cairns recharge it.',
        '绞盘电量耗尽，可放绳、松开或救援，石台可充电。',
      );
    } else if (kind === 'cut') cutRope(s, env, hit);
    else if (kind === 'water') {
      rescue(s, env);
      if (s.phase === 'playing') {
        s.recovering = Math.max(0, s.recovering - remaining);
        s.time += remaining;
        s.routeTime += remaining;
      }
      return;
    } else if (kind === 'relic') {
      s.collected.push(hit.id);
      s.score += 250;
      s.lastEvent = 'relic';
      s.flash = { x: hit.x, y: hit.y, time: 0.5, type: 'relic' };
      env.sound('coin');
    }
    if (!kind) break;
  }
  s.player.ground = !!support(s);
  if (s.flash) {
    s.flash.time -= h;
    if (s.flash.time <= 0) s.flash = null;
  }
}
export function landingPreview(s) {
  const points = [],
    p = s.player;
  for (let t = 0.08; t <= 1.5; t += 0.08) {
    const q = { x: p.x + p.vx * t, y: p.y + p.vy * t + (G * t * t) / 2 };
    const from = points[points.length - 1] || p;
    let nearest = null;
    for (const rect of s.route.solids) {
      const hit = sweepCircle(from, q, R, rect);
      if (hit && (!nearest || hit.at < nearest.at)) nearest = hit;
    }
    if (nearest) {
      points.push({
        x: from.x + (q.x - from.x) * nearest.at,
        y: from.y + (q.y - from.y) * nearest.at,
        landing: nearest.ny < -0.9 && nearest.rect.kind === 'cairn',
        blocked: true,
      });
      break;
    }
    if (q.y > PHYSICS.water - R || q.x < 12 || q.x > 468) {
      points.push({ ...q, water: true });
      break;
    }
    points.push(q);
  }
  return points;
}
