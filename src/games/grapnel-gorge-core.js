// Route state, hooking, rescue and winch rules.
import { PHYSICS, R, EPS, anchorPose, segmentHit, mechanicalEnergy } from './grapnel-gorge-math.js';
import { routePlan } from './grapnel-gorge-levels.js';

export function support(s) {
  return (
    s.route.pads.find(
      (p) =>
        s.player.x >= p.x - EPS &&
        s.player.x <= p.x + p.w + EPS &&
        Math.abs(s.player.y + R - p.y) < 1e-5 &&
        s.player.vy >= -EPS,
    ) || null
  );
}
function freshLedger() {
  return { winch: 0, anchor: 0, ground: 0, contactLoss: 0, captureLoss: 0, numerical: 0, spent: 0 };
}
export function setRoute(s, level) {
  s.level = level;
  s.lives = PHYSICS.lives;
  s.route = routePlan(level);
  s.routeTime = 0;
  s.rope = null;
  s.contactArc = null;
  s.target = 0;
  s.checkpoint = 0;
  s.visited = [0];
  s.betweenRoutes = false;
  s.recovering = 0;
  s.charge = PHYSICS.battery;
  s.flash = null;
  s.ledger = freshLedger();
  s.player = { x: 62, y: s.route.pads[0].y - R, vx: 0, vy: 0, ground: true };
  s.energyBaseline = mechanicalEnergy(s.player);
  s.notice = s.route.lesson;
  s.lastEvent = 'route';
  s.walkInput = 0;
}
export function createGrapnelState(level = 1) {
  const s = {
    phase: 'playing',
    score: 0,
    lives: PHYSICS.lives,
    level,
    time: 0,
    accumulator: 0,
    pending: [],
    collected: [],
    completed: [],
  };
  setRoute(s, level);
  return s;
}
export function notify(s, en, zh) {
  s.notice = { en, zh };
}
export function available(s) {
  return s.route.anchors.map((a) => {
    const p = anchorPose(a, s.routeTime),
      distance = Math.hypot(p.x - s.player.x, p.y - s.player.y);
    const blocked = s.route.solids.find((r) => segmentHit(p, s.player, r, 0.75));
    return {
      ...p,
      distance,
      eligible:
        distance >= PHYSICS.minLength &&
        distance <= PHYSICS.hookRange &&
        p.y < s.player.y - 12 &&
        !blocked,
      blocked: !!blocked,
      moving: !!(a.amplitudeX || a.amplitudeY),
    };
  });
}
export function selected(s) {
  const list = available(s);
  return (
    list.find((a) => a.id === s.target && a.eligible) ||
    list
      .filter((a) => a.eligible)
      .sort((a, b) => Math.abs(a.x - s.player.x - 70) - Math.abs(b.x - s.player.x - 70))[0] ||
    null
  );
}
export function addWork(s, result) {
  s.ledger.anchor += result.anchorWork || 0;
  s.ledger.winch += result.winchWork || 0;
  s.ledger.captureLoss += result.captureLoss || 0;
  s.ledger.numerical += result.numerical || 0;
  const spent = Math.max(0, result.winchWork || 0);
  s.ledger.spent += spent;
  s.charge = Math.max(0, s.charge - spent);
}
export function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  s.lastEvent = won ? 'win' : 'loss';
  s.accumulator = 0;
  s.pending = [];
  env.sound(won ? 'win' : 'lose');
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? 'All twenty canyon routes crossed. Your swings carried you home!'
        : 'No rescue lives remain on this route. A fresh try restores all five.',
      won
        ? '二十条峡谷路线全部穿越，平安归来！'
        : '本路线的救援生命已耗尽，重新挑战会恢复五条生命。',
    ),
  });
}
export function rescue(s, env, reason = 'fall') {
  s.lives--;
  // A fall invalidates taps aimed at the old situation; an explicit rescue keeps later taps.
  if (reason === 'fall') s.pending = [];
  s.lastEvent = reason;
  s.rope = null;
  s.contactArc = null;
  if (!s.lives) {
    finish(s, env, false);
    return;
  }
  const pad = s.route.pads.find((p) => p.id === s.checkpoint),
    x = pad.x + pad.w / 2;
  s.player = { x, y: pad.y - R, vx: 0, vy: 0, ground: true };
  s.charge = PHYSICS.battery;
  s.recovering = 0.35;
  s.ledger = freshLedger();
  s.energyBaseline = mechanicalEnergy(s.player);
  s.flash = { x, y: pad.y - 15, time: 0.6, type: 'rescue' };
  notify(
    s,
    'Rescued to the last cairn. One life spent; winch recharged.',
    '已返回上一石台，消耗一条生命，绞盘已充电。',
  );
  env.sound('hit');
}
export function cutRope(s, env, hit) {
  s.rope = null;
  s.flash = { x: hit.x, y: hit.y, time: 0.65, type: 'cut' };
  s.lastEvent = 'cut';
  env.sound('hit');
  // A hanging rock snaps the rope for good; touching a cairn only cuts it.
  if (hit.rect.kind === 'overhang') {
    s.lives--;
    if (!s.lives) return finish(s, env, false);
    notify(
      s,
      'Rock snapped the rope and cost a life. Momentum remains: hook a clear anchor or press Z.',
      '岩石扯断了绳索，消耗一条生命。惯性仍保留：连接无遮挡锚点，或按Z救援。',
    );
    return;
  }
  notify(
    s,
    'Stone cut the rope. Momentum remains: hook a clear anchor or press Z.',
    '岩壁切断了绳索。惯性仍保留：连接无遮挡锚点，或按Z救援。',
  );
}
const HOOK_STILL_SPEED = 30;
// Below the lowest cairn top plus this margin the canyon wall is too far from any anchor to hook.
const HOOK_LOW_MARGIN = 12;
export function hook(s, env) {
  if (s.rope) {
    s.rope = null;
    s.lastEvent = 'release';
    notify(
      s,
      'Released: your velocity carries you. Dots show the ballistic landing.',
      '已松绳，速度保持，点线显示抛物落点。',
    );
    env.sound('move');
    return;
  }
  if (s.player.ground && (s.walkInput !== 0 || Math.abs(s.player.vx) > HOOK_STILL_SPEED)) {
    notify(
      s,
      'Stand still to hook: let go of Left and Right, then press Space.',
      '站稳后才能钩索：松开左右键，再按空格。',
    );
    env.sound('hit');
    return;
  }
  if (
    !s.player.ground &&
    s.player.y > Math.max(...s.route.pads.map((p) => p.y)) - R + HOOK_LOW_MARGIN
  ) {
    notify(
      s,
      'Too low to hook: you fell below the cairns. Press Z to be rescued.',
      '位置太低，无法钩索：已落到石台下方，请按Z救援。',
    );
    env.sound('hit');
    return;
  }
  const a = selected(s);
  if (!a) {
    notify(
      s,
      'No clear marked anchor above within 238 px. Walk closer or change your approach.',
      '上方238像素内没有无遮挡锚点，请靠近或改变路线。',
    );
    return;
  }
  const length = Math.hypot(s.player.x - a.x, s.player.y - a.y);
  s.target = a.id;
  s.rope = {
    id: a.id,
    x: a.x,
    y: a.y,
    length,
    rate: 0,
    theta: Math.atan2(s.player.x - a.x, s.player.y - a.y),
    omega: 0,
    tension: 0,
    taut: false,
  };
  s.lastEvent = 'hook';
  notify(
    s,
    'Hook secured. Up reels; Down pays out; Space releases.',
    '钩索已固定。上键收绳，下键放绳，空格松开。',
  );
  env.sound('shoot');
}
export function setRate(s, rate) {
  const rope = s.rope;
  if (!rope) return;
  if (
    (rope.length <= PHYSICS.minLength + EPS && rate < 0) ||
    (rope.length >= PHYSICS.maxLength - EPS && rate > 0)
  )
    rate = 0;
  if (rate < 0 && s.charge <= EPS) rate = 0;
  if (rope.rate === rate) return;
  if (rope.taut && rate > rope.rate) {
    // A cable may pull inward, never push outward. Relaxing its moving
    // maximum-length boundary releases tension and preserves world velocity.
    rope.rate = rate;
    rope.taut = false;
    rope.tension = 0;
    delete rope.wall;
    delete rope.corner;
    return;
  }

  if (rope.taut) {
    const a = anchorPose(s.route.anchors[rope.id], s.routeTime),
      n = { x: Math.sin(rope.theta), y: Math.cos(rope.theta) };
    const winchWork = (rate * rate - rope.rate * rope.rate) / 2;
    if (winchWork > s.charge + EPS) {
      rate = 0;
      notify(
        s,
        'Winch needs charge: rest on a cairn. Paying out and release still work.',
        '绞盘需要充电，请在石台休息；放绳和松开仍可用。',
      );
      if (rope.rate === 0) return;
    }
    const actualDelta = rate - rope.rate,
      work = (rate * rate - rope.rate * rope.rate) / 2;
    s.player.vx += actualDelta * n.x;
    s.player.vy += actualDelta * n.y;
    addWork(s, {
      anchorWork: actualDelta * (a.vx * n.x + a.vy * n.y),
      winchWork: work,
    });
    if (s.player.vy < -EPS) s.player.ground = false;
  }
  rope.rate = rate;
}
