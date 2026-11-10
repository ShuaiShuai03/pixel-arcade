// What the player is told: crack warnings, the one-line prompt, the objective marker and status.
import {
  DIGGABLE,
  DUG,
  RULES,
  STEP,
  centerOf,
  digWouldCrack,
  findSpans,
  followers,
  fuseTicks,
  inGrid,
  onLift,
  waitingBy,
} from './burrow-rescue-map.js';
import { LEVEL_COUNT } from './burrow-rescue-levels.js';

export function warnings(s) {
  return findSpans(s.grid)
    .filter((sp) => sp.unstable)
    .map((sp) => {
      const elapsed = s.crack[`${sp.r},${sp.c0}`] || 0;
      return {
        r: sp.r,
        c0: sp.c0,
        c1: sp.c1,
        loose: sp.loose,
        elapsed: elapsed * STEP,
        remaining: Math.max(0, (fuseTicks(s) - elapsed) * STEP),
      };
    });
}

const P = (en, zh, quiet = false) => ({ en, zh, quiet });
function promptFor(s, warns) {
  if (s.phase === 'won') return P('All miners are safe!', '所有矿工都获救了！');
  if (s.phase === 'lost') return P('No lives left', '生命耗尽');
  const p = s.player;
  const here = warns.find((w) => w.r === p.r && p.c >= w.c0 && p.c <= w.c1);
  if (here) {
    const secs = Math.ceil(here.remaining);
    if (s.beams > 0 && DUG.includes(s.grid[p.r][p.c]))
      return P(`Cracks! X: brace here (${secs}s)`, `裂缝！按X加支架（${secs}秒）`);
    return P(`Cracks! Leave the tunnel (${secs}s)`, `裂缝！离开隧道（${secs}秒）`);
  }
  // Low air is actionable, so it outranks a crack that is somewhere else.
  if (s.oxygen < RULES.lowAir && p.r > 0)
    return P('Low air! Climb to the surface', '氧气不足！回到地面');
  if (warns.length) return P('Cracks nearby: stay clear', '附近有裂缝：请远离');
  if (waitingBy(s, 1).length) return P('X: wake the miner', '按X唤醒矿工');
  const fol = followers(s);
  const stuck = fol.some((m) => m.blocked);
  if (fol.length && !stuck && onLift(s))
    return P('Stay on the lift: miners coming', '留在升降梯上等矿工');
  if (stuck) return P('Miner stuck: dig a path to them', '矿工被困：为他挖通道');
  {
    const tc = p.c + p.facing.dx;
    const tr = p.r + p.facing.dy;
    const ch = inGrid(tc, tr) ? s.grid[tr][tc] : ' ';
    if (ch === 'R') return P("Rock can't be dug: go around", '岩石挖不动：绕过去');
    if (DIGGABLE.includes(ch)) {
      if (digWouldCrack(s, tc, tr)) {
        const canBeam = DUG.includes(s.grid[p.r][p.c]) && !digWouldCrack(s, tc, tr, p);
        if (canBeam) {
          return s.beams > 0
            ? P('X: place a beam, then Space', '先按X放支架，再按空格')
            : P('No beams: restock at the lift', '没有支架：去升降梯补充');
        }
        return P('Space: dig (ceiling will crack)', '空格：挖掘（顶部会开裂）');
      }
      return ch === 'B'
        ? P('Space: clear the rubble', '空格：清理碎石')
        : P('Space: dig', '空格：挖掘');
    }
  }
  if (p.dig > 0 && !fol.length) return P('Space: dig', '空格：挖掘');
  if (p.r === 0 && s.oxygen < 60 && !fol.length)
    return P('Fresh air: wait here to refill', '地面空气清新：在此等待补氧', true);
  if (fol.length) return P('Lead the miners to the lift', '带矿工回到升降梯', true);
  return P('Face earth, press Space to dig', '面向泥土，按空格挖掘', true);
}

// A dig instruction stays on screen for 1 s after you pause between tiles, so it never flickers.
const STICKY_TICKS = 120;
const STICKY_STEP = 6; // the prompt is sampled every 6 ticks
export function rememberDigPrompt(s) {
  if (s.sticky) s.sticky.ticks--;
  if (s.phase !== 'playing' || s.ticks % STICKY_STEP) return;
  const now = promptFor(s, warnings(s));
  if (/^Space: (dig|clear)/.test(now.en))
    s.sticky = { en: now.en, zh: now.zh, ticks: STICKY_TICKS };
}
export function shownPrompt(s, warns) {
  const now = promptFor(s, warns);
  return now.quiet && s.sticky?.ticks > 0 ? { en: s.sticky.en, zh: s.sticky.zh } : now;
}

export function objectiveOf(s) {
  const fol = followers(s).length > 0;
  let target = s.lift;
  if (!fol) {
    target = waitingBy(s, Infinity)[0] || target;
  }
  const { x, y } = centerOf(target.c, target.r);
  return { kind: target === s.lift ? 'lift' : 'miner', c: target.c, r: target.r, x, y };
}

export function buildStatus(s, prompt) {
  const total = s.miners.length;
  const saved = s.miners.filter((m) => m.state === 'rescued').length;
  const oxy = Math.ceil(s.oxygen);
  // Event messages (life lost, rescue) are spoken too, so they are never canvas-only.
  const note = (lang) => (s.message ? `${s.message[lang]} · ` : '');
  return {
    en: `Level ${s.level + 1}/${LEVEL_COUNT} · Miners ${saved}/${total} · Oxygen ${oxy} · ${note('en')}${prompt.en}`,
    zh: `关卡 ${s.level + 1}/${LEVEL_COUNT} · 矿工 ${saved}/${total} · 氧气 ${oxy} · ${note('zh')}${prompt.zh}`,
  };
}
