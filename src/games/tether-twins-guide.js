import { RULES, colX, rowY } from './tether-twins-rules.js';
import { pulseGo } from './tether-twins-world.js';
import { onPad } from './tether-twins-body.js';
import { TXT } from './tether-twins-text.js';

export const NAMES = Object.freeze([
  Object.freeze({ en: 'Red', zh: '红色' }),
  Object.freeze({ en: 'Blue', zh: '蓝色' }),
]);
const KEYS = Object.freeze([
  Object.freeze({ en: 'WASD', zh: 'WASD' }),
  Object.freeze({ en: 'Arrows', zh: '方向键' }),
]);

const reach = (r, x, y, d) => Math.hypot(r.x - x, r.y - y) <= d;

const targetOf = (step, w) => {
  if (step.kind === 'pad') return { x: w.pads[step.who].cx, y: w.pads[step.who].cy };
  return { x: colX(step.c), y: rowY(step.r) };
};

function stepDone(step, s, w) {
  switch (step.kind) {
    case 'walk':
    case 'wait': {
      const t = targetOf(step, w);
      if (!reach(s.robots[step.who], t.x, t.y, step.tol)) return false;
      if (step.kind === 'walk') return !step.wrap || s.wrapped;
      return pulseGo(w.room.pulse, step.group, s.clock);
    }
    case 'pad':
      return onPad(s.robots[step.who], w.pads[step.who]);
    case 'reel':
      return !!s.latched[step.gate];
    default:
      return s.len >= 0.9 * w.room.len;
  }
}

const holdBroken = (h, s) =>
  h.need === 'wrap' ? !(s.wrapped || Object.values(s.latched).some(Boolean)) : !s.open[h.need];

// A robot stands on its sweep marker but the cable has not wrapped the relay: the partner wandered off the
// side that makes the cable cross it, so send the partner back to its start spot.
function sweepRedirect(step, index, s, w) {
  if (!step.wrap || s.wrapped) return null;
  const t = targetOf(step, w);
  if (!reach(s.robots[step.who], t.x, t.y, step.tol)) return null;
  const other = 1 - step.who;
  const x = colX(w.room.start[other * 2]);
  const y = rowY(w.room.start[other * 2 + 1]);
  if (reach(s.robots[other], x, y, step.tol)) return null;
  return { index: `${index}b`, who: other, x, y, key: 'sweepBack', kind: 'walk' };
}

// Progress through a room's guide only moves forward (a hold can send it back), so the prompt
// never flickers when a robot wobbles near a threshold.
function objective(s, w) {
  const steps = w.room.steps;
  for (const h of w.room.holds)
    if (s.stage >= h.from && s.stage <= h.to && holdBroken(h, s)) {
      s.resume = { at: h.back, to: s.stage };
      s.stage = h.back;
    }
  // A robot that has left its pad (a pass-through, a nudge) must go back before the guide moves on.
  const lost = steps.findIndex((st, i) => i < s.stage && st.kind === 'pad' && !stepDone(st, s, w));
  if (lost >= 0) {
    s.resume = { at: lost, to: Math.max(s.stage, s.resume?.to ?? 0) };
    s.stage = lost;
  }
  while (s.stage < steps.length && stepDone(steps[s.stage], s, w)) {
    s.stage++;
    // Once the step a hold sent us back to is done again, carry on where the guide left off.
    if (s.resume && s.stage > s.resume.at) {
      s.stage = Math.max(s.stage, s.resume.to);
      s.resume = null;
    }
  }
  // With every step done both robots stand on their pads and the room is about to clear.
  const index = Math.min(s.stage, steps.length - 1);
  const step = steps[index];
  const redirect = sweepRedirect(step, index, s, w);
  if (redirect) return redirect;
  const t = step.kind === 'reel' || step.kind === 'pay' ? { x: 0, y: 0 } : targetOf(step, w);
  return { index, who: step.who ?? -1, x: t.x, y: t.y, key: step.key, kind: step.kind };
}

const tautPrompt = (s, solo) => ({
  who: -1,
  x: null,
  y: null,
  id: `${s.room}:taut`,
  en: solo ? 'Cable taut: hold G to pay out' : 'Cable taut: hold G (Red) / . (Blue) to pay out',
  zh: solo ? '电缆已绷紧：按住G放线' : '电缆已绷紧：红按住G／蓝按住.放线',
});

function winchPrompt(s, o, solo) {
  const [en, zh] = TXT[o.key];
  const reel = o.key === 'reel';
  return {
    who: -1,
    x: null,
    y: null,
    id: `${s.room}:${o.index}`,
    en: solo ? `Hold ${reel ? 'F' : 'G'}: ${en}` : `Hold ${reel ? 'F or ,' : 'G or .'}: ${en}`,
    zh: solo ? `按住${reel ? 'F' : 'G'}：${zh}` : `按住${reel ? 'F或,' : 'G或.'}：${zh}`,
  };
}

// A fully paid-out, taut cable stops a robot whose marker lies farther from its partner: the partner must come closer.
const leashed = (s, w, o) => {
  if (!s.taut || s.len < w.room.len - 5) return false;
  const me = s.robots[o.who];
  const partner = s.robots[1 - o.who];
  const to = (p) => Math.hypot(p.x - partner.x, p.y - partner.y);
  return to({ x: o.x, y: o.y }) > to(me);
};

function promptFor(s, w) {
  let o = objective(s, w);
  const solo = s.mode !== 2;
  // A reeled-in, taut cable is the only thing that can stop a robot short of its marker: say how to recover.
  if (o.who >= 0 && s.taut && s.len < w.room.len - 5) return tautPrompt(s, solo);
  if (o.who < 0) return winchPrompt(s, o, solo);
  if (leashed(s, w, o)) {
    const me = s.robots[o.who];
    o = { index: `leash${o.index}`, who: 1 - o.who, x: me.x, y: me.y, key: 'leash', kind: 'walk' };
  }
  const [en, zh] = TXT[o.key];
  const base = { who: o.who, x: o.x, y: o.y, wait: o.kind === 'wait' };
  const nm = NAMES[o.who];
  if (solo && s.active !== o.who)
    return {
      ...base,
      id: `${s.room}:${o.index}:x`,
      en: `Press X to control ${nm.en}`,
      zh: `按 X 切换到${nm.zh}`,
    };
  const k = KEYS[o.who];
  return {
    ...base,
    id: `${s.room}:${o.index}`,
    en: `${nm.en}${solo ? '' : ` (${k.en})`}: ${en}${solo ? ' (WASD)' : ''}`,
    zh: `${nm.zh}${solo ? '' : `（${k.zh}）`}：${zh}${solo ? '（WASD）' : ''}`,
  };
}

/** Show the current objective, but keep the previous one on screen for at least `promptHold` seconds. */
export function refreshPrompt(s, w) {
  const next = promptFor(s, w);
  if (!s.shown || (next.id !== s.shown.id && s.shownAge >= RULES.promptHold)) {
    s.shown = next;
    s.shownAge = 0;
  }
}
