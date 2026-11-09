// Result and banner wording, kept in one place so every message follows the language toggle.

/** The host-visible result line when a duel or the whole campaign ends. */
export function endMessage(env, { solo, draw, timedOut, index, stage, total }) {
  if (!solo) {
    return draw
      ? env.t('The duel ends in a draw.', '决斗以平局结束。')
      : env.t(`Player ${index + 1} wins the match!`, `玩家${index + 1}赢得比赛！`);
  }
  if (draw)
    return timedOut
      ? env.t(
          `Time ran out with you and ${stage.name.en} level on health. A draw counts as a loss.`,
          `时间耗尽，你与${stage.name.zh}生命相同。平局视为失败。`,
        )
      : env.t(
          `You and ${stage.name.en} fell together. A draw counts as a loss.`,
          `你与${stage.name.zh}同时倒下。平局视为失败。`,
        );
  if (index === 0)
    return env.t(
      `All ${total} champions defeated. The Ember Crown is yours!`,
      `${total}位冠军全部击败，余烬王冠属于你！`,
    );
  return env.t(
    `${stage.name.en} wins this duel. Watch the opening and try again.`,
    `${stage.name.zh}赢得本场对决。看准破绽，再试一次。`,
  );
}

/** The centre banner between duels; the banner is stored as data and worded at draw time. */
export function bannerText(banner, env) {
  if (banner.kind === 'stage') return env.t('CHAMPION DEFEATED', '冠军已击败');
  if (banner.kind === 'draw') return env.t('ROUND DRAW', '回合平局');
  return env.t(`PLAYER ${banner.player} TAKES THE ROUND`, `玩家${banner.player}赢得回合`);
}
