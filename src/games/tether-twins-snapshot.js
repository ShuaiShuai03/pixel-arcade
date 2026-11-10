import { RULES, TOP } from './tether-twins-rules.js';
import { pulseChange, pulseGo, pulseLive, pulseWarn, worldOf } from './tether-twins-world.js';
import { ROOM_COUNT } from './tether-twins-rooms.js';
import { lengthOf, onPad, pointsOf, robotRect, solidsOf } from './tether-twins-body.js';
import { NAMES } from './tether-twins-guide.js';

const hazardView = (w, h, clock) => {
  if (h.group < 0) return { x: h.x, y: h.y, w: h.w, h: h.h, pulse: false, live: true };
  const p = w.room.pulse;
  return {
    x: h.x,
    y: h.y,
    w: h.w,
    h: h.h,
    pulse: true,
    live: pulseLive(p, h.group, clock),
    warn: pulseWarn(p, h.group, clock),
    go: pulseGo(p, h.group, clock),
    change: pulseChange(p, h.group, clock),
  };
};

function statusOf(s, w, shownText) {
  const who = s.mode === 2 ? { en: 'Both', zh: '双人' } : NAMES[s.active];
  const label = (lang) =>
    `${lang === 'en' ? 'Room' : '房间'} ${s.room + 1}/${ROOM_COUNT} · ${lang === 'en' ? 'Active' : '当前'}: ${who[lang]} · ${shownText[lang]}`;
  if (s.phase === 'playing') return { en: label('en'), zh: label('zh') };
  const end = {
    won: { en: 'All rooms wired!', zh: '全部接通！' },
    lost: { en: 'Cells empty', zh: '电量耗尽' },
  }[s.phase];
  return { en: `${end.en} Score ${s.score}`, zh: `${end.zh} 得分 ${s.score}` };
}

/** What the player may see on screen, as plain JSON: the only input a bot or test gets. */
export function snapshotOf(s) {
  const w = worldOf(s.room);
  const pts = pointsOf(s, w);
  const path = lengthOf(pts);
  const shown = s.shown;
  const tip = s.tipLeft > 0 ? w.room.tip : null;
  const shownText = s.msg || tip || shown;
  return {
    phase: s.phase,
    score: s.score,
    cells: s.cells,
    time: s.ticks * RULES.step,
    clock: s.clock,
    mode: s.mode,
    room: s.room + 1,
    rooms: ROOM_COUNT,
    roomName: w.room.name,
    tip: w.room.tip,
    active: s.mode === 2 ? 'both' : s.active === 0 ? 'red' : 'blue',
    robots: s.robots.map((r, i) => ({
      id: i === 0 ? 'red' : 'blue',
      x: r.x,
      y: r.y,
      vx: r.vx,
      vy: r.vy,
      rect: robotRect(r),
      onPad: onPad(r, w.pads[i]),
    })),
    cable: {
      path: pts.map((p) => ({ x: p.x, y: p.y })),
      bends: [...s.bends],
      length: path,
      max: s.len,
      spool: w.room.len,
      slack: Math.max(0, s.len - path),
      tension: s.len > 0 ? Math.min(1, path / s.len) : 1,
      taut: path >= s.len - RULES.tautEps,
    },
    gates: Object.fromEntries(
      Object.entries(w.gates).map(([id, c]) => [
        id,
        { open: !!s.open[id], cells: c.map((x) => ({ ...x })) },
      ]),
    ),
    plates: w.plates.map((p, i) => ({ ...p, lit: !!s.lit[i] })),
    posts: w.posts.map((p, i) => ({
      ...p,
      relay: i >= w.relayFirst,
      latched: !!(p.gate && s.latched[p.gate]),
    })),
    hazards: w.hazards.map((h) => hazardView(w, h, s.clock)),
    solids: solidsOf(s, w).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    pads: w.pads.map((p) => ({ ...p })),
    hint:
      s.phase === 'playing'
        ? {
            who: shown.who < 0 ? 'any' : shown.who === 0 ? 'red' : 'blue',
            x: shown.x,
            y: shown.y,
            wait: !!shown.wait,
          }
        : null,
    prompt: { en: shown.en, zh: shown.zh },
    message: s.msg ? { en: s.msg.en, zh: s.msg.zh } : null,
    zap: s.zap ? { x: s.zap.x, y: s.zap.y, who: [...s.zap.who] } : null,
    stats: { ...s.stats },
    hud: { top: [0, TOP], bottom: [RULES.bottom, 320] },
    status: statusOf(s, w, shownText),
  };
}
