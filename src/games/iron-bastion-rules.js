// Iron Bastion shared rules: toasts, sparks, kills and the single terminal result.
import { FIELD_COUNT } from './iron-bastion-data.js';

const MAX_PARTICLES = 120;
const KILL_SCORE = 100;
const FIELDS_PER_TIER = 8;

export function toast(s, en, zh) {
  s.toast = { en, zh, time: 2 };
}

export function sparks(s, x, y, kind) {
  for (let n = 0; n < 6; n++)
    s.particles.push({
      x,
      y,
      vx: Math.cos((n * Math.PI) / 3) * 50,
      vy: Math.sin((n * Math.PI) / 3) * 50,
      life: 0.3,
      kind,
    });
  if (s.particles.length > MAX_PARTICLES) s.particles.splice(0, s.particles.length - MAX_PARTICLES);
}

// A destroyed tank scores only when the player's shell did it; every third wreck drops a kit.
export function destroy(s, tank, byPlayer, env) {
  s.defeated++;
  if (byPlayer) s.score += KILL_SCORE * (1 + Math.floor((s.field - 1) / FIELDS_PER_TIER));
  sparks(s, tank.x, tank.y, 'tank');
  env.sound('coin');
  if (s.defeated % 3 === 0)
    s.pickups.push({ id: `kit:${s.defeated}`, x: tank.x, y: tank.y, kind: 'kit' });
}

export function finish(s, env, won) {
  if (s.phase !== 'playing') return;
  s.phase = won ? 'won' : 'lost';
  env.sound(won ? 'win' : 'lose');
  const lostBeacon = s.baseHealth === 0,
    outOfRounds = s.player.rounds === 0;
  env.end({
    won,
    score: s.score,
    message: env.t(
      won
        ? `All ${FIELD_COUNT} battlefields secured. The beacon stands!`
        : lostBeacon
          ? `The beacon fell on field ${s.field}. Keep its brick shield and repair nearby.`
          : outOfRounds
            ? `Out of rounds on field ${s.field}. Fire only at clear targets.`
            : `Tank armor gone on field ${s.field}. Brake, shoot down shells and use kits.`,
      won
        ? `${FIELD_COUNT}座战场全部守住，信标屹立不倒！`
        : lostBeacon
          ? `信标在第${s.field}战场被摧毁。保护砖墙掩体，靠近维修。`
          : outOfRounds
            ? `第${s.field}战场弹药耗尽，只打看得清的目标。`
            : `第${s.field}战场装甲耗尽。刹车、击落炮弹并使用维修包。`,
    ),
  });
}
