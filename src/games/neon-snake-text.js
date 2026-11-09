// Bilingual wording for results, Focus state and the status line.
import { LEVELS, LEVEL_COUNT } from './neon-snake-levels.js';

const REASONS = Object.freeze({
  edge: ['Garden edge reached — turn before the border.', '到达花园边缘，请提前转向。'],
  stone: ['A garden obstacle blocked the route.', '花园障碍格挡住了路线。'],
  gate: [
    'The gate was closed — circle until the other gate opens.',
    '闸门关闭，请绕行等待另一闸门开放。',
  ],
  body: ['The body had not cleared that cell.', '身体尚未离开该格。'],
});

/** Message for env.end: the level reached plus either the win line or the cause of the crash. */
export function endMessage(s, env) {
  if (s.phase === 'won')
    return env.t(`All ${LEVEL_COUNT} levels harvested!`, `${LEVEL_COUNT}个关卡全部收获完成！`);
  const [en, zh] = REASONS[s.crash.reason];
  return env.t(`Level ${s.level}: ${en}`, `第${s.level}关：${zh}`);
}

export function focusLabel(s) {
  if (s.betweenGardens) return ['Travel refills', '前往时补满'];
  if (s.focusLocked) return ['Release Focus', '松开专注键'];
  if (s.braking) return ['Focus active', '专注生效中'];
  return s.brake < 0.1 ? ['Charge to 10%', '恢复到10%'] : ['Focus ready', '专注可用'];
}

export function statusText(s, menu) {
  if (menu) {
    const chosen = LEVELS[menu.cursor - 1];
    return {
      en: `Choose a level · ${menu.cursor}/${LEVEL_COUNT} ${chosen.name.en}`,
      zh: `选择关卡 · ${menu.cursor}/${LEVEL_COUNT} ${chosen.name.zh}`,
    };
  }
  const level = LEVELS[s.level - 1],
    focus = focusLabel(s);
  const hint = s.betweenGardens ? ['Enter to travel', '回车前往下一关'] : null;
  return {
    en: `${level.name.en} ${s.level}/${LEVEL_COUNT} · ${s.stageFruit}/${level.target} fruit · Length ${s.snake.length} · ${s.calm ? 'Calm' : 'Normal'} pace · ${focus[0]} · ${hint ? hint[0] : level.tip.en}`,
    zh: `${level.name.zh} ${s.level}/${LEVEL_COUNT} · ${s.stageFruit}/${level.target}果实 · 长度${s.snake.length} · ${s.calm ? '舒缓' : '标准'}速度 · ${focus[1]} · ${hint ? hint[1] : level.tip.zh}`,
  };
}
