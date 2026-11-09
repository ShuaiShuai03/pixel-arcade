// Memory Grove wording: the one-line prompt, and line breaking for long tips.
import { LEVELS } from './memory-grove-levels.js';

const WIDE_GLYPH = /[　-〿一-鿿＀-￯]/;
const glyphWidth = (ch, size) => (WIDE_GLYPH.test(ch) ? size : size * 0.62);

/** Greedy line breaking by monospace advance width; Latin text breaks at spaces. */
export function wrapText(text, size, maxWidth) {
  const lines = [];
  let line = '',
    width = 0,
    lastSpace = -1;
  for (const ch of text) {
    const w = glyphWidth(ch, size);
    if (width + w > maxWidth && line) {
      const cut = lastSpace > 0 ? lastSpace : line.length;
      lines.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
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

const FEEDBACK = Object.freeze({
  order: ['A later pair: follow the numbered list', '这组在后面：请按编号列表配对'],
  mismatch: ['Different symbols: remember their places', '图案不同：记住它们的位置'],
  'echo-slip': ['Wrong card: the cues will play again', '翻错了：提示会重新播放'],
  'echo-ok': ['Right card! Keep the order going', '翻对了！继续按顺序'],
  match: ['Match! Well remembered', '配对成功！记得真准'],
  already: ['Choose another card', '请选择另一张牌'],
  relaxed: ['RELAXED: no clock, leaves still count', '休闲模式：不计时，叶子仍然有效'],
  timed: ['TIMED: the clock runs between turns', '计时模式：翻牌之间计时'],
  'no-clock': ['This clearing has no clock', '这片空地没有计时'],
});
const HINT = Object.freeze({
  pairs: ['Turn two cards with the same symbol', '翻开两张相同图案的牌'],
  route: [
    'Match the symbol marked NEXT, then the one after',
    '先配对标有“下一个”的图案，再依次继续',
  ],
  triples: ['Turn three cards with the same symbol', '翻开三张相同图案的牌'],
});

/** The single line shown under the board for the current moment. */
export function promptText(s, t) {
  if (s.phase === 'won') return t('THE GROVE IS RESTORED', '森林已经修复');
  if (s.phase === 'lost') return t('THE GROVE SLEEPS: VISIT AGAIN', '森林睡着了：重新探访');
  if (s.mode === 'level-clear')
    return t('CLEARING RESTORED: NEXT WHEN READY', '空地已修复：准备好后继续');
  if (s.mode === 'preview')
    return t('Study the cards: Space or a tap skips', '记住这些牌：空格键或点按跳过');
  if (s.mode === 'listen') return t('Get ready to watch the cues', '准备观看提示');
  if (s.mode === 'cue-on' || s.mode === 'cue-gap')
    return t(
      `WATCH cue ${s.echo.step + 1} of ${s.echo.length}`,
      `观看第 ${s.echo.step + 1} / ${s.echo.length} 个提示`,
    );
  const note = FEEDBACK[s.feedback];
  if (s.feedbackTime > 0 && note) return t(...note);
  if (s.feedback === 'welcome' && s.feedbackTime > 0) {
    const { tip } = LEVELS[s.level - 1];
    return t(tip.en, tip.zh);
  }
  if (s.mode !== 'ready') return t('Remember the symbols: clock paused', '记住这些图案：计时暂停');
  if (s.rule === 'echo')
    return t(
      `REPEAT ${s.echo.input + 1} of ${s.echo.length}`,
      `重复第 ${s.echo.input + 1} / ${s.echo.length} 个`,
    );
  return t(...HINT[s.rule]);
}
