// The bottom-band prompt and the status line: what to do next, in both languages.
import { GROW_TICKS, RULES, isIdle, plantAt, secs, stageOf } from './vine-warden-core.js';
import { isBare } from './vine-warden-route.js';

export const PROMPTS = Object.freeze({
  tip: Object.freeze(['', '']),
  plant: Object.freeze(['Space: plant on soil beside the path', '空格：在虫道旁的泥土上播种']),
  harvestNone: Object.freeze(['No seeds: X harvests a grown plant', '没有种子：X收获盛开的植物']),
  bare: Object.freeze(['A bare lane! Space plants beside it', '有条道没设防！空格在旁边播种']),
  harvestIdle: Object.freeze([
    'No seeds: X harvests an unused full bloom',
    '没有种子：X收获没用过的满格盛开植物',
  ]),
  harvestSpent: Object.freeze([
    'No seeds: X harvests the grey spent plant',
    '没有种子：X收获灰色枯萎的植物',
  ]),
  harvestFull: Object.freeze([
    'Soil is full: X harvests a grown plant',
    '泥土已满：X收获盛开的植物',
  ]),
  hold: Object.freeze(['Roots hold pests: wait, then X harvests', '根正抓着害虫：稍等，再按X收获']),
  wait: Object.freeze(['Plants are growing: bloom in {n}s', '植物成长中：{n}秒后盛开']),
  saved: Object.freeze(['Level cleared! Next garden in {n}s', '本关通关！{n}秒后进入下一关']),
  won: Object.freeze(['All twenty gardens are safe!', '二十个花圃都守住了！']),
  lost: Object.freeze(['The garden bloom was overrun', '花圃之心被害虫占领了']),
});

function promptKey(s) {
  if (s.phase !== 'playing') return s.phase;
  if (s.clear > 0) return 'saved';
  if (s.levelTicks < RULES.tipTicks && !s.plants.length) return 'tip';
  const grown = s.plants.some((p) => stageOf(p) === 3 && p.grip === null);
  if (s.seeds > 0 && s.usefulSoil.some((t) => !plantAt(s, t.c, t.r))) {
    return s.invaders.some((v) => isBare(s, v)) ? 'bare' : 'plant';
  }
  if (grown) {
    if (s.seeds > 0) return 'harvestFull';
    if (s.plants.some(isIdle)) return 'harvestIdle';
    return s.plants.some((p) => p.charges <= 0 && p.grip === null) ? 'harvestSpent' : 'harvestNone';
  }
  return s.plants.some((p) => stageOf(p) < 3) ? 'wait' : 'hold';
}

// A harvest prompt promises a plant that X can take right now; it is replaced the moment that
// stops being true, even inside the usual 0.6 s display time.
function harvestPromiseKept(s, key) {
  const free = s.plants.filter((p) => stageOf(p) === 3 && p.grip === null);
  if (key === 'harvestFull') return s.seeds > 0 && free.length > 0;
  if (s.seeds > 0) return false;
  if (key === 'harvestNone') return free.length > 0;
  if (key === 'harvestSpent') return free.some((p) => p.charges <= 0);
  return free.some(isIdle);
}

export function refreshPrompt(s) {
  const key = promptKey(s);
  const urgent = s.phase !== 'playing' || key === 'saved' || key === 'tip';
  if (key === s.shownKey) return;
  const broken = s.shownKey.startsWith('harvest') && !harvestPromiseKept(s, s.shownKey);
  if (urgent || broken || s.ticks - s.shownSince >= RULES.promptHoldTicks) {
    s.shownKey = key;
    s.shownSince = s.ticks;
  }
}

export function promptText(s) {
  const stale = s.shownKey.startsWith('harvest') && !harvestPromiseKept(s, s.shownKey);
  const key = stale ? promptKey(s) : s.shownKey;
  if (key === 'tip') return { key, en: s.def.tip.en, zh: s.def.tip.zh };
  const soonest = Math.min(
    ...s.plants.filter((p) => stageOf(p) < 3).map((p) => GROW_TICKS - p.age),
    Infinity,
  );
  const n = key === 'saved' ? secs(s.clear) : Number.isFinite(soonest) ? secs(soonest) : 0;
  const [en, zh] = PROMPTS[key];
  return { key, en: en.replace('{n}', n), zh: zh.replace('{n}', n) };
}

export function buildStatus(s, prompt, total) {
  const note = (lang) => (s.message ? `${s.message[lang]} · ` : '');
  const health = Math.max(0, s.health);
  return {
    en: `Level ${s.level}/${total} · Seeds ${s.seeds} · Health ${health} · ${note('en')}${prompt.en}`,
    zh: `第 ${s.level}/${total} 关 · 种子 ${s.seeds} · 生命 ${health} · ${note('zh')}${prompt.zh}`,
  };
}
