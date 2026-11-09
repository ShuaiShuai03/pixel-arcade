// Bilingual wording: goals, progress, end messages, status line and text wrapping.
import { LEVELS, LEVEL_COUNT } from './blockfall-levels.js';
import { rubbleLeft, piecesLeft } from './blockfall-rules.js';

const GOALS = Object.freeze({
  lines: (n) => [`CLEAR ${n} LINES`, `消除${n}行`],
  burst: (n) => [`${n} LINES AT ONCE`, `一次消除${n}行`],
  rubble: () => ['REMOVE × RUBBLE', '清除×碎砖'],
});
const REASONS = Object.freeze({
  roof: [
    'The well reached the roof.',
    '方块已堆到井顶。',
    'Restart, or use Retry District before the next top-out.',
    '可重新开始；下次封顶前可用重试城区恢复。',
  ],
  supply: [
    'The pieces ran out before the goal.',
    '方块用完了，目标尚未完成。',
    'Restart, or use Retry District next time.',
    '可重新开始；下次可用重试城区恢复。',
  ],
});

/** [en, zh] goal label for a level. */
export const goalLabel = (level) => GOALS[level.goal.kind](level.goal.n);
/** [en, zh] progress label for the HUD. */
export function progressLabel(s) {
  const goal = LEVELS[s.level - 1].goal;
  if (goal.kind === 'lines')
    return [
      `${Math.min(goal.n, s.levelLines)} / ${goal.n}`,
      `${Math.min(goal.n, s.levelLines)} / ${goal.n}`,
    ];
  if (goal.kind === 'rubble') return [`${rubbleLeft(s.board)} LEFT`, `剩余${rubbleLeft(s.board)}`];
  return [`I → SHAFT`, `长条→竖井`];
}
export function endMessage(s, env) {
  if (s.phase === 'won')
    return env.t(
      `All ${LEVEL_COUNT} districts powered. The city is shining!`,
      `${LEVEL_COUNT}个城区全部供电，整座城市亮起来了！`,
    );
  const [en, zh, enTip, zhTip] = REASONS[s.reason];
  return env.t(`District ${s.level}: ${en} ${enTip}`, `第${s.level}区：${zh}${zhTip}`);
}
export function statusText(s, menu) {
  if (menu) {
    const chosen = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a district · ${menu.cursor}/${LEVEL_COUNT} ${chosen.name.en}`,
      zh: `选择城区 · ${menu.cursor}/${LEVEL_COUNT} ${chosen.name.zh}`,
    };
  }
  const level = LEVELS[s.level - 1],
    goal = goalLabel(level),
    left = piecesLeft(s),
    note = s.rearm
      ? ['Release controls to ready the district.', '请松开操作键，准备本城区。']
      : [level.tip.en, level.tip.zh];
  return {
    en: `District ${s.level}/${LEVEL_COUNT} ${level.name.en} · ${goal[0]}${left === null ? '' : ` · ${left} pieces left`} · ${note[0]}`,
    zh: `城区${s.level}/${LEVEL_COUNT} ${level.name.zh} · ${goal[1]}${left === null ? '' : ` · 剩余${left}块`} · ${note[1]}`,
  };
}
const wide = (ch) => ch.charCodeAt(0) > 0x2e7f;
/** Estimated pixel width of a bold monospace string at the given font size. */
export const textWidth = (str, size) =>
  [...str].reduce((w, ch) => w + (wide(ch) ? size : size * 0.62), 0);
/** Breaks text into lines no wider than `width`, at spaces for English and anywhere for Chinese. */
export function wrapText(str, width, size) {
  const lines = [];
  let line = '';
  for (const word of str.split(/(?<=\s)/)) {
    for (const piece of textWidth(word, size) > width ? [...word] : [word]) {
      if (line && textWidth(line + piece, size) > width) {
        lines.push(line.trimEnd());
        line = '';
      }
      line += piece;
    }
  }
  return line ? [...lines, line.trimEnd()] : lines;
}
