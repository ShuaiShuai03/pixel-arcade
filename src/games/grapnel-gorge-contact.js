// Wall, corner and arc contact models plus the one-step predictor.
import {
  G,
  R,
  EPS,
  sq,
  dot,
  cross,
  anchorPose,
  advanceTaut,
  circleGap,
  mechanicalEnergy,
  pendulumStep,
} from './grapnel-gorge-math.js';
import { clamp } from '../shared/utils.js';
import { setRate, addWork, support } from './grapnel-gorge-core.js';

function wallPose(rope, anchor, time, h) {
  const a = anchorPose(anchor, time + h),
    length = rope.length + rope.rate * h,
    dx = rope.wall.x - a.x;
  const dy = rope.wall.sign * Math.sqrt(length * length - dx * dx),
    nx = dx / length,
    ny = dy / length;
  const vy = a.vy + (length * rope.rate + dx * a.vx) / dy;
  const tangential2 = Math.max(0, a.vx * a.vx + sq(vy - a.vy) - rope.rate * rope.rate);
  const ay = (nx * a.ax + ny * a.ay - tangential2 / length) / ny;
  const force = (G - ay) / ny,
    reaction = (force * nx) / rope.wall.nx;
  return {
    player: { x: rope.wall.x, y: a.y + dy, vx: 0, vy, ground: false },
    theta: Math.atan2(nx, ny),
    omega: (-a.vx * ny - (vy - a.vy) * nx) / length,
    length,
    a,
    force,
    reaction,
  };
}
function advanceWall(rope, anchor, time, h) {
  const nodes = [
    wallPose(rope, anchor, time, 0),
    wallPose(rope, anchor, time, h / 2),
    wallPose(rope, anchor, time, h),
  ];
  let anchorWork = 0,
    winchWork = 0;
  for (let i = 0; i < 3; i++) {
    const n = nodes[i],
      weight = i === 1 ? 4 : 1;
    anchorWork +=
      (-n.force * (n.a.vx * Math.sin(n.theta) + n.a.vy * Math.cos(n.theta)) * weight * h) / 6;
    winchWork += (-n.force * rope.rate * weight * h) / 6;
  }
  const last = nodes[2];
  return {
    player: last.player,
    rope: {
      ...rope,
      theta: last.theta,
      omega: last.omega,
      length: last.length,
      x: last.a.x,
      y: last.a.y,
      tension: Math.max(0, last.force),
    },
    anchorWork,
    winchWork,
    numerical:
      mechanicalEnergy(last.player) - mechanicalEnergy(nodes[0].player) - anchorWork - winchWork,
    tensionStart: nodes[0].force,
    tensionEnd: last.force,
    reactionEnd: last.reaction,
  };
}
export function prepareWall(s) {
  const rope = s.rope;
  if (!rope) return;
  delete rope.wall;
  const a = anchorPose(s.route.anchors[rope.id], s.routeTime),
    distance = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  if (distance < rope.length - 1e-6) return;
  for (const rect of s.route.solids) {
    if (s.player.y < rect.y - EPS || s.player.y > rect.y + rect.h + EPS) continue;
    const nx =
      Math.abs(s.player.x - (rect.x + rect.w + R)) < 1e-7
        ? 1
        : Math.abs(s.player.x - (rect.x - R)) < 1e-7
          ? -1
          : 0;
    if (!nx || s.player.vx * nx > EPS) continue;
    if (
      (s.player.y <= rect.y + EPS && s.player.vy < 0) ||
      (s.player.y >= rect.y + rect.h - EPS && s.player.vy > 0)
    )
      continue;
    const wall = {
      x: s.player.x,
      nx,
      sign: Math.sign(s.player.y - a.y) || 1,
      minY: rect.y,
      maxY: rect.y + rect.h,
    };
    const model = wallPose({ ...rope, wall }, s.route.anchors[rope.id], s.routeTime, 0);
    if (!Number.isFinite(model.force) || model.force < 0 || model.reaction < 0) continue;
    if (model.force <= EPS || model.reaction <= EPS) {
      const future = wallPose({ ...rope, wall }, s.route.anchors[rope.id], s.routeTime, 1e-6);
      if (
        (model.force <= EPS && future.force < 0) ||
        (model.reaction <= EPS && future.reaction < 0)
      )
        continue;
    }
    const n = { x: (s.player.x - a.x) / rope.length, y: (s.player.y - a.y) / rope.length },
      dv = { x: -s.player.vx, y: model.player.vy - s.player.vy };
    const pull = -dv.y / n.y,
      reaction = (dv.x + pull * n.x) / nx;
    if (pull < -EPS || reaction < -EPS) continue;
    const winchWork = -pull * rope.rate;
    if (winchWork > s.charge + EPS) {
      setRate(s, 0);
      return prepareWall(s);
    }
    s.player.vx = 0;
    s.player.vy = model.player.vy;
    addWork(s, {
      anchorWork: -pull * (a.vx * n.x + a.vy * n.y),
      winchWork,
      captureLoss: (dv.x * dv.x + dv.y * dv.y) / 2,
    });
    Object.assign(rope, {
      wall,
      theta: model.theta,
      omega: model.omega,
      tension: Math.max(0, model.force),
      taut: true,
    });
    return;
  }
}
export function cornerPose(rope, anchor, time, h) {
  const corner = rope.corner,
    a = anchorPose(anchor, time + h),
    length = rope.length + rope.rate * h;
  const dx = a.x - corner.x,
    dy = a.y - corner.y,
    d = Math.hypot(dx, dy),
    ux = dx / d,
    uy = dy / d;
  const along = (R * R - length * length + d * d) / (2 * d),
    height2 = R * R - along * along;
  if (height2 <= 0) return null;
  const across = corner.branch * Math.sqrt(height2),
    x = corner.x + along * ux - across * uy,
    y = corner.y + along * uy + across * ux;
  const nc = { x: (x - corner.x) / R, y: (y - corner.y) / R },
    nr = { x: (x - a.x) / length, y: (y - a.y) / length },
    tangent = { x: nc.y, y: -nc.x },
    denominator = dot(nr, tangent);
  if (Math.abs(denominator) < 1e-10) return null;
  const speed = (rope.rate + nr.x * a.vx + nr.y * a.vy) / denominator,
    vx = tangent.x * speed,
    vy = tangent.y * speed;
  const relative2 = sq(vx - a.vx) + sq(vy - a.vy) - rope.rate * rope.rate;
  const tangentialAcceleration =
    (nr.x * a.ax + nr.y * a.ay - relative2 / length + (dot(nr, nc) * speed * speed) / R) /
    denominator;
  const acceleration = {
    x: tangent.x * tangentialAcceleration - (nc.x * speed * speed) / R,
    y: tangent.y * tangentialAcceleration - (nc.y * speed * speed) / R,
  };
  const balance = { x: -acceleration.x, y: G - acceleration.y },
    det = cross(nr, nc);
  const force = cross(balance, nc) / det,
    reaction = -cross(nr, balance) / det;
  return {
    player: { x, y, vx, vy, ground: false },
    a,
    length,
    nr,
    nc,
    force,
    reaction,
    theta: Math.atan2(nr.x, nr.y),
    omega: ((vx - a.vx) * nr.y - (vy - a.vy) * nr.x) / length,
    quadrantX: nc.x * corner.sx,
    quadrantY: nc.y * corner.sy,
  };
}
function advanceCorner(rope, anchor, time, h) {
  const nodes = [
    cornerPose(rope, anchor, time, 0),
    cornerPose(rope, anchor, time, h / 2),
    cornerPose(rope, anchor, time, h),
  ];
  if (nodes.some((n) => !n)) return null;
  let anchorWork = 0,
    winchWork = 0;
  for (let i = 0; i < 3; i++) {
    const n = nodes[i],
      weight = i === 1 ? 4 : 1;
    anchorWork += (-n.force * (n.a.vx * n.nr.x + n.a.vy * n.nr.y) * weight * h) / 6;
    winchWork += (-n.force * rope.rate * weight * h) / 6;
  }
  const last = nodes[2];
  return {
    player: last.player,
    rope: {
      ...rope,
      x: last.a.x,
      y: last.a.y,
      length: last.length,
      theta: last.theta,
      omega: last.omega,
      tension: Math.max(0, last.force),
    },
    anchorWork,
    winchWork,
    numerical:
      mechanicalEnergy(last.player) - mechanicalEnergy(nodes[0].player) - anchorWork - winchWork,
    tensionStart: nodes[0].force,
    tensionEnd: last.force,
    reactionEnd: last.reaction,
    quadrantX: last.quadrantX,
    quadrantY: last.quadrantY,
  };
}
export function prepareCorner(s) {
  const rope = s.rope;
  if (!rope) return;
  delete rope.corner;
  const a = anchorPose(s.route.anchors[rope.id], s.routeTime);
  if (Math.hypot(s.player.x - a.x, s.player.y - a.y) < rope.length - 1e-6) return;
  for (const rect of s.route.solids)
    for (const [x, y, sx, sy] of [
      [rect.x, rect.y, -1, -1],
      [rect.x + rect.w, rect.y, 1, -1],
      [rect.x, rect.y + rect.h, -1, 1],
      [rect.x + rect.w, rect.y + rect.h, 1, 1],
    ]) {
      const dx = s.player.x - x,
        dy = s.player.y - y,
        d = Math.hypot(dx, dy);
      if (
        Math.abs(d - R) > 1e-6 ||
        dx * sx < -EPS ||
        dy * sy < -EPS ||
        (s.player.vx * dx + s.player.vy * dy) / d > 1e-7
      )
        continue;
      if (
        (dx * sx <= EPS && s.player.vx * sx < -EPS) ||
        (dy * sy <= EPS && s.player.vy * sy < -EPS)
      )
        continue;
      const u = {
        x: (a.x - x) / Math.hypot(a.x - x, a.y - y),
        y: (a.y - y) / Math.hypot(a.x - x, a.y - y),
      };
      const corner = { x, y, sx, sy, branch: Math.sign(cross(u, { x: dx, y: dy })) || 1, rect };
      const model = cornerPose({ ...rope, corner }, s.route.anchors[rope.id], s.routeTime, 0);
      if (!model || model.force < 0 || model.reaction < 0) continue;
      if (model.force <= EPS || model.reaction <= EPS) {
        const future = cornerPose({ ...rope, corner }, s.route.anchors[rope.id], s.routeTime, 1e-6);
        if (
          future &&
          ((model.force <= EPS && future.force < 0) ||
            (model.reaction <= EPS && future.reaction < 0))
        )
          continue;
      }
      const dv = { x: model.player.vx - s.player.vx, y: model.player.vy - s.player.vy },
        det = cross(model.nr, model.nc);
      const pull = -cross(dv, model.nc) / det,
        reaction = cross(model.nr, dv) / det;
      if (pull < -EPS || reaction < -EPS) continue;
      const winchWork = -pull * rope.rate;
      if (winchWork > s.charge + EPS) {
        setRate(s, 0);
        return prepareCorner(s);
      }
      s.player.vx = model.player.vx;
      s.player.vy = model.player.vy;
      addWork(s, {
        anchorWork: -pull * (a.vx * model.nr.x + a.vy * model.nr.y),
        winchWork,
        captureLoss: (dv.x * dv.x + dv.y * dv.y) / 2,
      });
      delete rope.wall;
      Object.assign(rope, {
        corner,
        theta: model.theta,
        omega: model.omega,
        tension: Math.max(0, model.force),
        taut: true,
      });
      return;
    }
}
export function prepareArc(s) {
  s.contactArc = null;
  if (s.rope?.taut || support(s)) return;
  for (const rect of s.route.solids)
    for (const [x, y, sx, sy] of [
      [rect.x, rect.y, -1, -1],
      [rect.x + rect.w, rect.y, 1, -1],
      [rect.x, rect.y + rect.h, -1, 1],
      [rect.x + rect.w, rect.y + rect.h, 1, 1],
    ]) {
      const dx = s.player.x - x,
        dy = s.player.y - y,
        d = Math.hypot(dx, dy);
      if (Math.abs(d - R) > 1e-6 || dx * sx < -EPS || dy * sy < -EPS) continue;
      const nx = dx / d,
        ny = dy / d,
        normalSpeed = s.player.vx * nx + s.player.vy * ny;
      if (normalSpeed > 1e-7) continue;
      if (
        (dx * sx <= EPS && s.player.vx * sx < -EPS) ||
        (dy * sy <= EPS && s.player.vy * sy < -EPS)
      )
        continue;
      const omega = (s.player.vx * ny - s.player.vy * nx) / R,
        reaction = -G * ny - R * omega * omega;
      if (reaction < -1e-7 || (reaction <= 1e-6 && 3 * G * omega * nx < 0)) continue;
      if (normalSpeed < 0) {
        s.ledger.contactLoss += (normalSpeed * normalSpeed) / 2;
        s.player.vx -= normalSpeed * nx;
        s.player.vy -= normalSpeed * ny;
      }
      s.contactArc = { x, y, sx, sy, theta: Math.atan2(nx, ny), omega, rect };
      return;
    }
}
function advanceArc(s, h) {
  const arc = s.contactArc,
    q = pendulumStep(arc.theta, arc.omega, R, h),
    nx = Math.sin(q.theta),
    ny = Math.cos(q.theta);
  const player = {
    x: arc.x + R * nx,
    y: arc.y + R * ny,
    vx: R * q.omega * ny,
    vy: -R * q.omega * nx,
    ground: false,
  };
  const reaction = -G * ny - R * q.omega * q.omega;
  const rope = s.rope
    ? {
        ...s.rope,
        length: s.rope.length + s.rope.rate * h,
        ...anchorPose(s.route.anchors[s.rope.id], s.routeTime + h),
        tension: 0,
      }
    : null;
  return {
    player,
    rope,
    anchorWork: 0,
    winchWork: 0,
    numerical: mechanicalEnergy(player) - mechanicalEnergy(s.player),
    reactionEnd: reaction,
    arcX: nx * arc.sx,
    arcY: ny * arc.sy,
  };
}
export function predict(s, h) {
  const p = s.player;
  if (s.rope?.taut && s.rope.corner)
    return advanceCorner(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  if (s.contactArc) return advanceArc(s, h);
  if (s.rope?.wall) return advanceWall(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  if (s.rope?.taut) return advanceTaut(s.rope, s.route.anchors[s.rope.id], s.routeTime, h);
  const grounded = support(s),
    ay = grounded ? 0 : G;
  return {
    player: {
      x: p.x + p.vx * h,
      y: p.y + p.vy * h + (ay * h * h) / 2,
      vx: p.vx,
      vy: p.vy + ay * h,
      ground: !!grounded,
    },
    rope: s.rope ? { ...s.rope, length: s.rope.length + s.rope.rate * h } : null,
    anchorWork: 0,
    winchWork: 0,
    numerical: 0,
  };
}
export function curvedContact(s, h, rect, approximate) {
  const initial = circleGap(s.player, rect);
  const normalVelocity = s.player.vx * approximate.nx + s.player.vy * approximate.ny;
  if (initial <= 1e-9 && approximate.at < 1e-8 && normalVelocity < -1e-7)
    return { time: 0, contact: approximate };
  const times = [
    approximate.at * h,
    ...Array.from({ length: 8 }, (_, i) => ((i + 1) * h) / 8),
  ].sort((a, b) => a - b);
  let lo = 0;
  for (const end of times) {
    if (end < lo || end <= 1e-12) continue;
    const gap = circleGap(predict(s, end).player, rect);
    if (initial <= 1e-9 && normalVelocity >= -1e-7 && gap > -1e-9) {
      lo = end;
      continue;
    }
    if (gap <= 0) {
      let hi = end;
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2;
        if (circleGap(predict(s, mid).player, rect) > 0) lo = mid;
        else hi = mid;
      }
      const p = predict(s, hi).player,
        x = clamp(p.x, rect.x, rect.x + rect.w),
        y = clamp(p.y, rect.y, rect.y + rect.h),
        d = Math.hypot(p.x - x, p.y - y);
      return { time: hi, contact: { ...approximate, nx: (p.x - x) / d, ny: (p.y - y) / d } };
    }
    lo = end;
  }
  return null;
}
