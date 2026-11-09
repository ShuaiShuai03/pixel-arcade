// Status lines shown under the chamber: the dock prompt and the chamber's tip.
import { COURIER_ROOMS, LEVEL_COUNT } from './gravity-courier-rooms.js';
import { carried, courierDockCue, room } from './gravity-courier-physics.js';

const DOCK_LABELS = (cue) => ({
  align: ['ALIGN WITH THE PAD', '请对准装卸台'],
  field: ['POINT FIELD TOWARD THE PAD', '将动力场朝向装卸台'],
  land: ['BRAKE BEFORE RAIL CONTACT', '先制动 · 再贴靠装卸轨道'],
  slow: [
    `SLOW TO DOCK · H-SPEED ${Math.round(cue.horizontalSpeed)}`,
    `减速后装卸 · 横向速度${Math.round(cue.horizontalSpeed)}`,
  ],
  deliver: ['READY · X TO HAND OFF', '已就绪 · X交付'],
  collect: ['READY · X TO COLLECT', '已就绪 · X收取'],
  repack: ['READY · X TO REPACK', '已就绪 · X重新包装'],
  'no-spare': ['NO SPARES · PROTECT THIS PACK', '没有备用包装 · 保护当前包裹'],
  loaded: ['LOADED · HEAD TO DELIVERY', '已装载 · 前往终点'],
});
export function prompt(s, env) {
  if (s.phase === 'won') return env.t('ALL SHIPMENTS DELIVERED', '所有邮件全部送达');
  if (s.phase === 'lost') return env.t('NO SPARES · SHIFT ENDED', '备用包装耗尽 · 任务结束');
  if (s.mode === 'clear') return env.t('DELIVERED · X FOR NEXT CHAMBER', '已送达 · X前往下一舱');
  if (s.mode === 'repack')
    return env.t('REPACKING · ONE SPARE USED', '重新包装中 · 使用一个备用包装');
  const cue = courierDockCue(s);
  if (cue.near) return env.t(...DOCK_LABELS(cue)[cue.reason]);
  if (s.parcel.integrity === 0) return env.t('BROKEN · RETURN TO SOURCE', '包裹破损 · 返回起点');
  if (s.feedbackTime > 0 && s.feedback === 'damaged') {
    const normals = s.impacts.at(-1)?.normals || [],
      horizontal = normals.some((n) => n.x),
      vertical = normals.some((n) => n.y);
    return horizontal && vertical
      ? env.t('HARD CORNER · BRAKE BOTH AXES', '转角冲击 · 两个方向都需制动')
      : horizontal
        ? env.t('WALL IMPACT · COUNTER-THRUST TO BRAKE', '撞到隔板 · 反向推进制动')
        : env.t('HARD LANDING · REVERSE FIELD EARLIER', '着陆冲击 · 提前反转动力场');
  }
  if (!carried(s)) return env.t('SOURCE PAD · STOP · X TO COLLECT', '起点装卸台 · 停稳后X收取');
  return env.t('CARRYING · HEAD FOR THE DELIVER PAD', '运送中 · 前往终点装卸台');
}
export function lowerHint(s, env) {
  if (s.phase !== 'playing')
    return env.t('A/D THRUST · SPACE FIELD · X HANDLE', 'A/D推进 · 空格动力场 · X装卸');
  const cue = courierDockCue(s);
  if (cue.reason === 'slow')
    return env.t('RELEASE / COUNTER-THRUST · DOCK NEEDS ≤8', '松开或反向推进 · 装卸需横向速度≤8');
  if (cue.reason === 'field')
    return env.t('SPACE REVERSES ACCELERATION', '空格反转加速度 · 动量保持连续');
  if (cue.reason === 'land')
    return env.t(
      'BRAKE FIRST · FIELD INTO RAIL AFTER CONTACT',
      '先降低纵向速度 · 贴靠后再将动力场朝向轨道',
    );
  if (s.parcel.integrity === 0)
    return env.t('X AT SOURCE USES ONE SPARE PACK', '在起点按X使用一个备用包装');
  if (cue.reason === 'collect') return env.t(...room(s).tip);
  if (cue.ready) return env.t('A/D THRUST / BRAKE · SPACE FIELD', 'A/D推进和制动 · 空格反转动力场');
  return env.t(...room(s).tip);
}
export function statusText(s, menu) {
  if (menu)
    return {
      en: `Choose a chamber · ${menu.cursor}/${LEVEL_COUNT} ${COURIER_ROOMS[menu.cursor - 1].name[0]}`,
      zh: `选择舱室 · ${menu.cursor}/${LEVEL_COUNT} ${COURIER_ROOMS[menu.cursor - 1].name[1]}`,
    };
  return {
    en: `Chamber ${s.level}/${LEVEL_COUNT} · ${prompt(s, { t: (en) => en })}`,
    zh: `舱室 ${s.level}/${LEVEL_COUNT} · ${prompt(s, { t: (_, zh) => zh })}`,
  };
}
