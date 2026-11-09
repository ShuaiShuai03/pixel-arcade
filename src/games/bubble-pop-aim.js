// Aim geometry: ray events, wall bounces, guided capture plans and the public aim preview.
import { clamp } from '../shared/utils.js';
import {
  LEFT,
  RIGHT,
  ROOF,
  ROWS,
  SHOT_Y,
  R,
  TAU,
  EPS,
  COLS,
  bubblePoint,
  blockedSocket,
  neighbors,
  slots,
} from './bubble-pop-rules.js';
const point = bubblePoint;
const wrapAngle = (a) => ((a % TAU) + TAU) % TAU;
export function solidCells(s) {
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < slots(r); c++)
      if (s.board[r][c] >= 0)
        cells.push({ ...point(r, c, s.ceiling), row: r, col: c, kind: 'bubble' });
  for (const p of s.obstacles)
    cells.push({ ...point(p.row, p.col, s.ceiling), row: p.row, col: p.col, kind: 'peg' });
  return cells;
}
function segmentClear(a, b, objects, s) {
  if (
    Math.min(a.x, b.x) < LEFT - EPS ||
    Math.max(a.x, b.x) > RIGHT + EPS ||
    Math.min(a.y, b.y) < ROOF + s.ceiling - EPS
  )
    return false;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  for (const o of objects) {
    const t = length ? clamp(((o.x - a.x) * dx + (o.y - a.y) * dy) / length, 0, 1) : 0;
    if (Math.hypot(a.x + dx * t - o.x, a.y + dy * t - o.y) < R * 2 - EPS) return false;
  }
  return true;
}
function onArc(angle, from, span) {
  return (span >= 0 ? wrapAngle(angle - from) : wrapAngle(from - angle)) <= Math.abs(span) + 1e-7;
}
function arcClear(arc, objects, s) {
  const angles = [arc.from, arc.from + arc.span];
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
    if (onArc(a, arc.from, arc.span)) angles.push(a);
  const samples = angles.map((a) => ({
    x: arc.cx + 24 * Math.cos(a),
    y: arc.cy + 24 * Math.sin(a),
  }));
  if (samples.some((p) => p.x < LEFT - EPS || p.x > RIGHT + EPS || p.y < ROOF + s.ceiling - EPS))
    return false;
  for (const o of objects) {
    if (Math.hypot(o.x - arc.cx, o.y - arc.cy) < EPS) continue;
    const angle = Math.atan2(o.y - arc.cy, o.x - arc.cx);
    let distance = Math.min(
      ...[arc.from, arc.from + arc.span].map((a) =>
        Math.hypot(arc.cx + 24 * Math.cos(a) - o.x, arc.cy + 24 * Math.sin(a) - o.y),
      ),
    );
    if (onArc(angle, arc.from, arc.span))
      distance = Math.min(distance, Math.abs(Math.hypot(o.x - arc.cx, o.y - arc.cy) - 24));
    if (distance < 24 - EPS) return false;
  }
  return true;
}
export function capturePlan(s, b, event, objects = solidCells(s)) {
  const candidateMap = new Map();
  const add = (r, c) => {
    if (!blockedSocket(s, r, c)) candidateMap.set(`${r},${c}`, [r, c]);
  };
  if (event.roof) for (let c = 0; c < COLS; c++) add(0, c);
  for (const contact of event.contacts)
    for (const [r, c] of neighbors(contact.row, contact.col)) add(r, c);
  const plans = [];
  for (const [row, col] of candidateMap.values()) {
    const target = point(row, col, s.ceiling),
      direct = Math.hypot(target.x - b.x, target.y - b.y);
    if (segmentClear(b, target, objects, s))
      plans.push({
        row,
        col,
        target,
        segments: [{ kind: 'line', from: { x: b.x, y: b.y }, to: target, length: direct }],
        length: direct,
      });
    for (const contact of event.contacts) {
      if (Math.abs(Math.hypot(target.x - contact.x, target.y - contact.y) - 24) > EPS) continue;
      const from = Math.atan2(b.y - contact.y, b.x - contact.x),
        to = Math.atan2(target.y - contact.y, target.x - contact.x),
        short = ((to - from + Math.PI * 3) % TAU) - Math.PI;
      for (const span of [short, short >= 0 ? short - TAU : short + TAU]) {
        if (Math.abs(span) > Math.PI * 1.99) continue;
        const arc = {
          kind: 'arc',
          cx: contact.x,
          cy: contact.y,
          radius: 24,
          from,
          span,
          length: Math.abs(span) * 24,
        };
        if (arcClear(arc, objects, s))
          plans.push({ row, col, target, segments: [arc], length: arc.length });
      }
    }
  }
  plans.sort(
    (a, bp) =>
      a.length - bp.length ||
      Math.abs(a.target.x - b.x - b.vx * 0.01) - Math.abs(bp.target.x - b.x - b.vx * 0.01) ||
      a.row - bp.row ||
      a.col - bp.col,
  );
  return plans[0] || null;
}
export function nextEvent(s, b) {
  let time = Infinity,
    wall = false,
    roof = false,
    contacts = [];
  const add = (t, kind, object = null) => {
    if (!Number.isFinite(t) || t < -1e-8) return;
    t = Math.max(0, t);
    if (t < time - 1e-8) {
      time = t;
      wall = false;
      roof = false;
      contacts = [];
    }
    if (Math.abs(t - time) <= 1e-8) {
      if (kind === 'wall') wall = true;
      else if (kind === 'roof') roof = true;
      else contacts.push(object);
    }
  };
  if (b.vx < 0) add((LEFT - b.x) / b.vx, 'wall');
  else if (b.vx > 0) add((RIGHT - b.x) / b.vx, 'wall');
  if (b.vy < 0) add((ROOF + s.ceiling - b.y) / b.vy, 'roof');
  const speed = b.vx * b.vx + b.vy * b.vy,
    objects = solidCells(s);
  for (const o of objects) {
    const dx = b.x - o.x,
      dy = b.y - o.y,
      dot = dx * b.vx + dy * b.vy,
      c = dx * dx + dy * dy - 24 * 24;
    if (speed < 1e-12 || dot >= -1e-9) continue;
    const discriminant = dot * dot - speed * c;
    if (discriminant >= 0) add((-dot - Math.sqrt(discriminant)) / speed, 'bubble', o);
  }
  return { time, wall, roof, contacts, objects };
}
export function trace(s, angle) {
  const b = { x: 240, y: SHOT_Y, vx: Math.cos(angle) * 350, vy: Math.sin(angle) * 350 },
    segments = [];
  for (let n = 0; n < 20; n++) {
    const event = nextEvent(s, b);
    if (!Number.isFinite(event.time)) return { segments, plan: null };
    const from = { x: b.x, y: b.y };
    b.x += b.vx * event.time;
    b.y += b.vy * event.time;
    segments.push({ from, to: { x: b.x, y: b.y } });
    if (event.roof || event.contacts.length)
      return {
        segments,
        plan: capturePlan(s, b, event, event.objects),
        contact: { x: b.x, y: b.y },
        event,
      };
    b.x = clamp(b.x, LEFT, RIGHT);
    b.vx = -b.vx;
  }
  return { segments, plan: null };
}
