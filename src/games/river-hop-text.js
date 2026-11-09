// Player-facing text: the canvas cue, the host status line and tip wrapping.
import { LEVELS, LEVEL_COUNT } from './river-hop-levels.js';

const WIDE_GLYPH = /[　-〿一-鿿＀-￯]/;
const glyphWidth = (ch, size) => (WIDE_GLYPH.test(ch) ? size : size * 0.62);
/** Greedy line breaking by the monospace advance width; Latin text breaks at spaces. */
export function wrapText(text, size, maxWidth) {
  const lines = [];
  let line = '',
    width = 0,
    lastSpace = -1;
  for (const ch of text) {
    const w = glyphWidth(ch, size);
    if (width + w > maxWidth && line) {
      if (lastSpace > 0) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
      } else {
        lines.push(line);
        line = '';
      }
      width = [...line].reduce((sum, c) => sum + glyphWidth(c, size), 0);
      lastSpace = -1;
    }
    if (ch === ' ') lastSpace = line.length;
    line += ch;
    width += w;
  }
  if (line) lines.push(line);
  return lines;
}
export function riverPrompt(s) {
  if (s.transition > 0)
    return {
      en: 'Four frogs safe. Preparing the next crossing.',
      zh: '四只青蛙已到家，正在准备下一渡口。',
    };
  if (s.spawnDelay > 0 || s.needsRelease)
    return {
      en: 'Release direction keys to ready the next frog.',
      zh: '请松开方向键，准备下一只青蛙。',
    };
  if (s.feedback?.type === 'edge')
    return {
      en: 'At the edge: hop inward. Other directions remain available.',
      zh: '已到边界：请向内跳跃，其他方向仍然可用。',
    };
  if (s.feedback?.type === 'occupied')
    return {
      en: 'Filled pad: wait for a deck below, hop Down, then choose a free home.',
      zh: '荷叶已住满：等待下方浮台，向下跳回河面，再选择空家园。',
    };
  return LEVELS[s.level - 1].tip;
}
export function riverCue(s) {
  if (s.transition > 0) return { en: 'FOUR SAFE', zh: '四只青蛙已到家' };
  if (s.spawnDelay > 0) {
    if (s.frog.pose === 'rescued') return { en: 'HOME! RELEASE KEYS', zh: '到家了！请松开方向键' };
    return s.lastCause === 'water'
      ? { en: 'SPLASH · RELEASE', zh: '落水 · 请松开方向键' }
      : s.lastCause === 'traffic'
        ? { en: 'TRAFFIC · RELEASE', zh: '撞车 · 请松开方向键' }
        : { en: 'TIME UP · RELEASE', zh: '超时 · 请松开方向键' };
  }
  if (s.needsRelease) return { en: 'RELEASE DIRECTIONS', zh: '请松开方向键' };
  if (s.feedback?.type === 'edge') return { en: 'EDGE · HOP INWARD', zh: '边界 · 向内跳跃' };
  if (s.feedback?.type === 'occupied')
    return { en: 'FILLED · SAFE TO LEAVE', zh: '已住满 · 可安全离开' };
  return LEVELS[s.level - 1].cue;
}

const seconds = (s) => Math.ceil(Math.max(0, s.timeLeft));
/** The host status line: detailed lessons live here so the canvas stays uncluttered. */
export function statusText(s, menu) {
  if (menu) {
    const { name } = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a crossing · ${menu.cursor}/${LEVEL_COUNT} ${name.en}`,
      zh: `选择渡口 · ${menu.cursor}/${LEVEL_COUNT} ${name.zh}`,
    };
  }
  const prompt = riverPrompt(s);
  return {
    en: `Crossing ${s.level}/${LEVEL_COUNT} · Homes ${s.homes.length}/4 · ${s.lives} frogs · ${seconds(s)}s · ${prompt.en}`,
    zh: `渡口 ${s.level}/${LEVEL_COUNT} · 家园 ${s.homes.length}/4 · ${s.lives}只青蛙 · ${seconds(s)}秒 · ${prompt.zh}`,
  };
}
