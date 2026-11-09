import { drawPixelText, pixelSprite, background } from '../shared/utils.js';
import { FLOOR, isArmored, weaponPose } from './ember-knights-physics.js';
import { STAGES, STAGE_COUNT, TIER_LABEL, RULES, stageTags } from './ember-knights-stages.js';
import { drawArena } from './ember-knights-arenas.js';
import { menuCell } from './ember-knights-menu.js';
import { bannerText } from './ember-knights-text.js';

const BODY = [
  '....aaaa....',
  '...aaaaaa...',
  '..aaaaaaaa..',
  '..abbccbaa..',
  '..abbbbbaa..',
  '...aaaaaa...',
  '....dddd....',
  '..dddddddd..',
  '.dddeeedddd.',
  '.dddeeedddd.',
  '.dddeeedddd.',
  '..dddddddd..',
  '...dddddd...',
  '...dd..dd...',
  '...dd..dd...',
  '...dd..dd...',
  '...dd..dd...',
  '..fff..fff..',
  '..fff..fff..',
  '..fff..fff..',
];
function drawFighter(ctx, f, index, time) {
  const x = Math.round(f.x),
    y = Math.round(f.y),
    palette = index === 0 ? '#67d6c1' : (f.accent ?? '#e9a166');
  ctx.fillStyle = '#14233277';
  ctx.fillRect(x - 14, FLOOR, 28, 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(f.face, 1);
  pixelSprite(ctx, BODY, -12, -40, 2, {
    a: f.flash > 0 ? '#fff5d8' : '#c5cbd0',
    b: '#263545',
    c: '#e6b985',
    d: f.flash > 0 ? '#fff5d8' : palette,
    e: '#597477',
    f: '#263442',
  });
  if (Math.abs(f.vx) > 12 && f.grounded) {
    ctx.fillStyle = '#263442';
    ctx.fillRect(Math.floor(time * 12) % 2 ? -8 : 2, -3, 6, 3);
  }
  if (!f.grounded) {
    ctx.fillStyle = palette;
    ctx.fillRect(-7, -9, 5, 3);
    ctx.fillRect(3, -13, 5, 3);
  }
  if (f.gear === 'crown') {
    ctx.fillStyle = '#efcb77';
    ctx.fillRect(-7, -42, 15, 3);
    for (let n = 0; n < 3; n++) ctx.fillRect(-6 + n * 5, -46, 3, 5);
  }
  if (f.gear === 'hammer') {
    ctx.fillStyle = isArmored(f) ? '#ddc9a2' : '#7b554e';
    ctx.fillRect(-12, -29, 6, 12);
    ctx.fillRect(7, -29, 5, 12);
  }
  if (f.gear === 'saber') {
    ctx.fillStyle = '#815769';
    ctx.fillRect(-11, -29, 4, 21);
    ctx.fillStyle = '#d9c0a6';
    ctx.fillRect(-5, -35, 10, 2);
  }
  if (f.gear === 'axe') {
    ctx.fillStyle = '#7b4a3d';
    ctx.fillRect(-11, -30, 5, 14);
    ctx.fillStyle = '#c9c3b5';
    ctx.fillRect(-13, -32, 4, 5);
  }
  if (f.gear === 'spear') {
    ctx.fillStyle = '#829fae';
    ctx.fillRect(-10, -31, 4, 11);
    ctx.fillRect(7, -31, 4, 11);
    ctx.fillStyle = '#d6e3d2';
    ctx.fillRect(-2, -40, 4, 4);
  }
  if (f.gear === 'shield') {
    ctx.fillStyle = '#e1bb76';
    ctx.fillRect(-5, -28, 10, 3);
    ctx.fillRect(-2, -29, 4, 12);
  }
  if (f.attack?.phase === 'windup') {
    ctx.fillStyle = palette;
    ctx.fillRect(7, -33, 4, 9);
  }
  if (f.attack?.phase === 'active') {
    ctx.fillStyle = palette;
    ctx.fillRect(6, -28, 6, 5);
  }
  if (f.attack?.phase === 'recovery' || (!f.attack && f.actionLock > 0)) {
    ctx.fillStyle = palette;
    ctx.fillRect(6, -24, 4, 11);
  }
  if (f.blocking) {
    ctx.fillStyle = f.parry > 0 ? '#d6fffa' : '#d7b574';
    ctx.fillRect(7, -38, 5, 34);
    ctx.fillStyle = '#66869a';
    ctx.fillRect(8, -35, 3, 27);
    ctx.fillStyle = '#dfcb9f';
    ctx.fillRect(7, -23, 5, 3);
  }
  ctx.restore();
  const pose = weaponPose(f);
  ctx.strokeStyle = palette;
  ctx.lineWidth = 4;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(f.x + f.face * 4, f.y - 29);
  ctx.lineTo(pose.base.x, pose.base.y);
  ctx.stroke();
  if (f.attack?.previousPose && pose.active) {
    ctx.strokeStyle = '#f5d79a66';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(f.attack.previousPose.tip.x, f.attack.previousPose.tip.y);
    ctx.lineTo(pose.tip.x, pose.tip.y);
    ctx.stroke();
  }
  ctx.strokeStyle = pose.active ? '#fff1c7' : '#aebfce';
  ctx.lineWidth = pose.radius * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pose.base.x, pose.base.y);
  ctx.lineTo(pose.tip.x, pose.tip.y);
  ctx.stroke();
  if (f.gear === 'axe' && f.attack) {
    ctx.fillStyle = '#c9c3b5';
    ctx.fillRect(pose.tip.x - 4, pose.tip.y - 4, 8, 4);
  }
  if (f.gear === 'hammer' && f.attack) {
    ctx.fillStyle = '#b7c0c6';
    ctx.fillRect(pose.tip.x - 4, pose.tip.y - 3, 8, 6);
    ctx.fillStyle = '#e1d4ab';
    ctx.fillRect(pose.tip.x - 3, pose.tip.y - 3, 6, 2);
  }
  if (f.gear === 'spear' && f.attack) {
    ctx.fillStyle = '#e9e0ba';
    ctx.fillRect(pose.tip.x - 2, pose.tip.y - 2, 4, 4);
  }
  if (f.attack?.phase === 'windup') {
    ctx.fillStyle = f.attack.type === 'heavy' ? '#ffba77' : '#efe0b3';
    ctx.fillRect(x - 2, y - 53, 4, 7);
    ctx.fillRect(x - 2, y - 44, 4, 2);
  }
  if (f.guardBreak > 0) drawPixelText(ctx, '!', x, y - 59, '#ffb18e', 14, 'center');
}

function actionLabel(f, env) {
  if (f.guardBreak > 0) return env.t('GUARD BROKEN', '防御破除');
  if (f.parry > 0) return env.t('PARRY READY', '可招架');
  if (isArmored(f)) return env.t('ARMORED SWING', '披甲挥击');
  if (f.attack?.phase === 'windup') return env.t('WINDUP', '攻击前摇');
  if (f.attack?.phase === 'active') return env.t('STRIKE', '挥击中');
  if (f.attack?.phase === 'recovery' || (!f.attack && f.actionLock > 0))
    return env.t('RECOVERY', '攻击收招');
  if (f.blocking) return env.t('GUARDING', '举盾防御');
  if (f.stamina < 12) return env.t('RECOVER STAMINA', '恢复体力');
  if (f.stamina < RULES.windedAt) return env.t('TIRED · SOFT SWINGS', '疲惫 · 挥击减弱');
  return env.t('READY', '准备');
}
function drawBars(ctx, f, i, env, champion) {
  const x = i === 0 ? 12 : 288;
  drawPixelText(
    ctx,
    i === 1 && env.mode !== 2
      ? env.t(champion.name.en, champion.name.zh)
      : env.t(`PLAYER ${i + 1}`, `玩家${i + 1}`),
    x,
    8,
    '#e7e5d4',
    11,
  );
  drawPixelText(ctx, `${env.t('HEALTH', '生命')} ${Math.ceil(f.health)}`, x, 22, '#d5dfd8', 10);
  drawPixelText(
    ctx,
    `${env.t('STAMINA', '体力')} ${Math.floor(f.stamina)}`,
    x + 180,
    22,
    '#e5c985',
    10,
    'right',
  );
  ctx.fillStyle = '#3b4555';
  ctx.fillRect(x, 34, 180, 9);
  ctx.fillStyle = i === 0 ? '#67d6c1' : '#dfa287';
  ctx.fillRect(x, 34, (180 * f.health) / f.maxHealth, 9);
  ctx.fillStyle = '#3b4555';
  ctx.fillRect(x, 47, 180, 5);
  ctx.fillStyle = f.guardBreak > 0 || f.stamina < RULES.windedAt ? '#ef956d' : '#d5bd76';
  ctx.fillRect(x, 47, (180 * f.stamina) / 100, 5);
  drawPixelText(ctx, actionLabel(f, env), x, 57, '#bfcbcf', 10);
}
function drawHud(ctx, s, env) {
  ctx.fillStyle = '#151f2e';
  ctx.fillRect(0, 0, 480, 70);
  s.fighters.forEach((f, i) => drawBars(ctx, f, i, env, s.champion));
  drawPixelText(ctx, String(Math.ceil(s.remaining)), 240, 24, '#f0dfb4', 20, 'center');
  drawPixelText(
    ctx,
    env.mode === 2 ? `${s.wins[0]} : ${s.wins[1]}` : `${s.stage}/${STAGE_COUNT}`,
    240,
    52,
    '#d5c9a8',
    11,
    'center',
  );
  if (env.mode !== 2) {
    const tags = [TIER_LABEL[s.champion.tier], ...stageTags(s.champion)]
      .map((tag) => env.t(tag.en, tag.zh))
      .join(' · ');
    drawPixelText(ctx, tags, 240, 74, '#e8d9b0', 10, 'center');
  }
  ctx.fillStyle = '#162132df';
  ctx.fillRect(0, 301, 480, 19);
  drawPixelText(
    ctx,
    env.mode === 2
      ? env.t(
          'HOLD ATTACK · TAP GUARD TO PARRY · RELEASE TO RECOVER',
          '按住攻击 · 轻按举盾招架 · 松盾恢复体力',
        )
      : env.t(s.champion.lesson.en, s.champion.lesson.zh),
    240,
    305,
    '#d0d9cc',
    10,
    'center',
  );
}
function drawBanner(ctx, s, env) {
  ctx.fillStyle = '#111f30ed';
  ctx.fillRect(42, 125, 396, 61);
  drawPixelText(ctx, bannerText(s.banner, env), 240, 138, '#f0d394', 16, 'center');
  drawPixelText(
    ctx,
    env.mode === 2 ? env.t('NEXT ROUND', '下一回合') : env.t('NEXT CHAMPION', '下一位冠军'),
    240,
    164,
    '#c0d3d4',
    10,
    'center',
  );
}

function drawMenu(ctx, s, env) {
  background(ctx, '#141c2b');
  drawPixelText(
    ctx,
    env.t('EMBER KNIGHTS · CHOOSE A DUEL', '余烬骑士 · 选择决斗'),
    240,
    8,
    '#f0d394',
    14,
    'center',
  );
  STAGES.forEach((stage, i) => {
    const n = i + 1,
      q = menuCell(n),
      open = n <= s.unlocked,
      chosen = n === s.menu.cursor;
    ctx.fillStyle = chosen ? '#ffe9a8' : '#3b4a63';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = open ? '#1d2a40' : '#101722';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
    ctx.fillStyle = open ? stage.accent : '#3b4455';
    ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, 4);
    drawPixelText(
      ctx,
      String(n),
      q.x + q.w / 2,
      q.y + 10,
      open ? '#ffffff' : '#56657f',
      14,
      'center',
    );
    if (n < s.unlocked)
      drawPixelText(ctx, env.t('CLEAR', '已通'), q.x + q.w / 2, q.y + 28, '#7fd6a0', 9, 'center');
    else if (!open)
      drawPixelText(
        ctx,
        env.t('LOCKED', '未解锁'),
        q.x + q.w / 2,
        q.y + 28,
        '#56657f',
        9,
        'center',
      );
    else {
      // The saved record cannot say whether the last duel was won, so it is never called "next".
      const label = n === STAGE_COUNT ? env.t('FINAL', '最终战') : env.t('NEXT', '下一场');
      drawPixelText(ctx, label, q.x + q.w / 2, q.y + 28, '#ffb347', 9, 'center');
    }
  });
  const c = STAGES[s.menu.cursor - 1];
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, 252, 480, 68);
  const tier = TIER_LABEL[c.tier];
  drawPixelText(
    ctx,
    `${s.menu.cursor}. ${env.t(c.name.en, c.name.zh)} · ${env.t(tier.en, tier.zh)}`,
    12,
    256,
    '#f0d394',
    12,
  );
  drawPixelText(ctx, env.t(c.lesson.en, c.lesson.zh), 240, 274, '#d0d9cc', 10, 'center');
  drawPixelText(
    ctx,
    env.t(
      'A D W S: pick · J / Space: start · or tap a duel',
      'A D W S 选择 · J / 空格 开始 · 或点按关卡',
    ),
    240,
    300,
    '#9fb3c8',
    10,
    'center',
  );
}

export function drawScene(ctx, s, env) {
  if (s.menu) return drawMenu(ctx, s, env);
  drawArena(ctx, s.champion, s.elapsed);
  s.fighters.forEach((f, i) => drawFighter(ctx, f, i, s.elapsed));
  for (const p of s.sparks) {
    ctx.fillStyle = p.blocked ? '#bcf5ff' : '#ffcf8a';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
  }
  drawHud(ctx, s, env);
  if (s.roundPause > 0) drawBanner(ctx, s, env);
}
