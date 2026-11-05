import { drawPixelText, background } from '../shared/utils.js';
export const meta = {
  id: 'meteor-drift',
  name: { en: 'Meteor Drift', zh: '陨石漂流' },
  genre: 'arcade',
  players: '1',
  touch: true,
  touchControls: [
    { code: 'ArrowLeft', label: { en: 'Turn left', zh: '左转' } },
    { code: 'ArrowRight', label: { en: 'Turn right', zh: '右转' } },
    { code: 'ArrowUp', label: { en: 'Thrust', zh: '推进' } },
    { code: 'Space', label: { en: 'Fire', zh: '射击' } },
  ],
  description: {
    en: 'Thrust, turn, and blast drifting asteroids. Clear five sectors while conserving your three ships.',
    zh: '推进、转向并击碎漂流陨石。用三艘飞船清理五个星区。',
  },
  keys: [
    { label: { en: 'Turn', zh: '转向' }, keys: 'Left / Right or A / D' },
    { label: { en: 'Thrust', zh: '推进' }, keys: 'Up / W' },
    { label: { en: 'Fire', zh: '射击' }, keys: 'Space / Z' },
  ],
};
export const wrap = (v, max) => ((v % max) + max) % max;
const radius = (size) => (size === 3 ? 26 : size === 2 ? 16 : 8);
function torusDistance(a, b) {
  const dx = Math.abs(a.x - b.x),
    dy = Math.abs(a.y - b.y);
  return Math.hypot(Math.min(dx, 480 - dx), Math.min(dy, 320 - dy));
}
export function makeRocks(wave, random) {
  const rocks = [];
  for (let i = 0; i < 3 + wave; i++) {
    const edge = i % 4;
    let x, y;
    if (edge === 0) {
      x = random() * 480;
      y = 15;
    } else if (edge === 1) {
      x = 465;
      y = random() * 320;
    } else if (edge === 2) {
      x = random() * 480;
      y = 305;
    } else {
      x = 15;
      y = random() * 320;
    }
    const a = random() * Math.PI * 2,
      speed = 24 + random() * 20 + wave * 6;
    rocks.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 3,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 1.3,
    });
  }
  return rocks;
}
export function createMeteorState(random) {
  return {
    phase: 'playing',
    score: 0,
    wave: 1,
    lives: 3,
    ship: { x: 240, y: 160, vx: 0, vy: 0, angle: -Math.PI / 2 },
    rocks: makeRocks(1, random),
    shots: [],
    particles: [],
    invulnerable: 2,
    fireCooldown: 0,
    time: 0,
    thrusting: false,
  };
}
export function stepMeteors(s, dt, input, random) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.fireCooldown -= dt;
  const turn =
    (input.held('ArrowRight', 'KeyD') ? 1 : 0) - (input.held('ArrowLeft', 'KeyA') ? 1 : 0);
  s.ship.angle += turn * 3.4 * dt;
  s.thrusting = input.held('ArrowUp', 'KeyW');
  if (s.thrusting) {
    s.ship.vx += Math.cos(s.ship.angle) * 150 * dt;
    s.ship.vy += Math.sin(s.ship.angle) * 150 * dt;
  }
  const speed = Math.hypot(s.ship.vx, s.ship.vy);
  if (speed > 210) {
    s.ship.vx = (s.ship.vx / speed) * 210;
    s.ship.vy = (s.ship.vy / speed) * 210;
  }
  s.ship.vx *= Math.pow(0.99, dt * 60);
  s.ship.vy *= Math.pow(0.99, dt * 60);
  s.ship.x = wrap(s.ship.x + s.ship.vx * dt, 480);
  s.ship.y = wrap(s.ship.y + s.ship.vy * dt, 320);
  if (input.held('Space', 'KeyZ') && s.fireCooldown <= 0) {
    s.shots.push({
      x: wrap(s.ship.x + Math.cos(s.ship.angle) * 13, 480),
      y: wrap(s.ship.y + Math.sin(s.ship.angle) * 13, 320),
      vx: Math.cos(s.ship.angle) * 350 + s.ship.vx * 0.3,
      vy: Math.sin(s.ship.angle) * 350 + s.ship.vy * 0.3,
      life: 1.3,
    });
    s.fireCooldown = 0.18;
  }
  for (const r of s.rocks) {
    r.x = wrap(r.x + r.vx * dt, 480);
    r.y = wrap(r.y + r.vy * dt, 320);
    r.angle += r.spin * dt;
  }
  const debris = [];
  for (const shot of s.shots) {
    shot.x = wrap(shot.x + shot.vx * dt, 480);
    shot.y = wrap(shot.y + shot.vy * dt, 320);
    shot.life -= dt;
    if (shot.life <= 0) continue;
    for (const r of s.rocks) {
      if (r.dead || torusDistance(shot, r) > radius(r.size)) continue;
      r.dead = true;
      shot.life = 0;
      s.score += r.size === 3 ? 40 : r.size === 2 ? 80 : 120;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        s.particles.push({ x: r.x, y: r.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.5 });
      }
      if (r.size > 1)
        for (let i = 0; i < 2; i++) {
          const a = random() * Math.PI * 2,
            velocity = 55 + s.wave * 9;
          debris.push({
            x: r.x,
            y: r.y,
            vx: Math.cos(a) * velocity,
            vy: Math.sin(a) * velocity,
            size: r.size - 1,
            angle: random() * Math.PI * 2,
            spin: (random() - 0.5) * 2,
          });
        }
      break;
    }
  }
  s.shots = s.shots.filter((b) => b.life > 0);
  s.rocks = s.rocks.filter((r) => !r.dead).concat(debris);
  if (s.invulnerable <= 0 && s.rocks.some((r) => torusDistance(r, s.ship) < radius(r.size) + 8)) {
    s.lives--;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      s.particles.push({
        x: s.ship.x,
        y: s.ship.y,
        vx: Math.cos(a) * 80,
        vy: Math.sin(a) * 80,
        life: 0.6,
      });
    }
    if (s.lives <= 0) s.phase = 'lost';
    else {
      s.ship = { x: 240, y: 160, vx: 0, vy: 0, angle: -Math.PI / 2 };
      s.invulnerable = 2.5;
    }
  }
  for (const p of s.particles) {
    p.x = wrap(p.x + p.vx * dt, 480);
    p.y = wrap(p.y + p.vy * dt, 320);
    p.life -= dt;
  }
  s.particles = s.particles.filter((p) => p.life > 0).slice(-100);
  if (s.rocks.length === 0 && s.phase === 'playing') {
    s.score += 500;
    if (s.wave === 5) s.phase = 'won';
    else {
      s.wave++;
      s.rocks = makeRocks(s.wave, random);
      s.invulnerable = Math.max(s.invulnerable, 2);
      s.shots = [];
    }
  }
}
function drawRock(ctx, r) {
  const rad = radius(r.size),
    unit = r.size === 3 ? 5 : r.size === 2 ? 4 : 3;
  for (let y = -rad; y <= rad; y += unit)
    for (let x = -rad; x <= rad; x += unit) {
      const a = Math.atan2(y, x),
        edge = rad * (0.88 + 0.11 * Math.sin(a * 5 + r.angle));
      if (x * x + y * y > edge * edge) continue;
      ctx.fillStyle = x + y < -rad * 0.25 ? '#bfa787' : x + y > rad * 0.4 ? '#5c625f' : '#8b8b78';
      ctx.fillRect(Math.round(r.x + x), Math.round(r.y + y), unit, unit);
    }
  ctx.fillStyle = '#565f5b';
  ctx.fillRect(Math.round(r.x - rad * 0.35), Math.round(r.y - rad * 0.2), unit * 2, unit);
}
function drawShip(ctx, ship, thrust, time) {
  const cos = Math.cos(ship.angle),
    sin = Math.sin(ship.angle);
  const local = (x, y) => ({ x: ship.x + x * cos - y * sin, y: ship.y + x * sin + y * cos });
  for (let y = -8; y <= 8; y += 3)
    for (let x = -8; x <= 13; x += 3) {
      if (x > 12 - Math.abs(y) * 1.7 || x < -6 + Math.abs(y) * 0.1) continue;
      const p = local(x, y);
      ctx.fillStyle = Math.abs(y) < 3 ? '#f6efca' : '#8cd7d7';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
    }
  if (thrust) {
    for (let i = 0; i < 3; i++) {
      const p = local(-12 - i * 3, i % 2 ? 2 : -2);
      ctx.fillStyle = i === 0 ? '#ffd173' : '#ed8155';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3 + (Math.floor(time * 20) % 2));
    }
  }
}
function wrappedPositions(entity, extent) {
  const xs = [entity.x],
    ys = [entity.y];
  if (entity.x < extent) xs.push(entity.x + 480);
  if (entity.x > 480 - extent) xs.push(entity.x - 480);
  if (entity.y < extent) ys.push(entity.y + 320);
  if (entity.y > 320 - extent) ys.push(entity.y - 320);
  return xs.flatMap((x) => ys.map((y) => ({ ...entity, x, y })));
}
export function drawWrappedRock(ctx, rock) {
  for (const copy of wrappedPositions(rock, radius(rock.size))) drawRock(ctx, copy);
}
export function drawWrappedShip(ctx, ship, thrust, time) {
  for (const copy of wrappedPositions(ship, 23)) drawShip(ctx, copy, thrust, time);
}
export function createGame(env) {
  const s = createMeteorState(env.random);
  let ended = false,
    lastScore = 0,
    lastLives = 3;
  return {
    update(dt, input) {
      const bullets = s.shots.length;
      stepMeteors(s, dt, input, env.random);
      if (s.shots.length > bullets) env.sound('shoot');
      if (s.score > lastScore) env.sound('hit');
      if (s.lives < lastLives) env.sound('hit');
      lastScore = s.score;
      lastLives = s.lives;
      if (s.phase !== 'playing' && !ended) {
        ended = true;
        env.sound(s.phase === 'won' ? 'win' : 'lose');
        env.end({
          won: s.phase === 'won',
          score: s.score,
          message:
            s.phase === 'won'
              ? env.t(
                  'Five sectors secured. Welcome home, pilot.',
                  '五个星区已清理。欢迎归航，飞行员。',
                )
              : env.t('Your fleet is gone. Plot a new course.', '舰队损失殆尽，重新规划航线吧。'),
        });
      }
    },
    draw(ctx) {
      background(ctx, '#0b1727');
      for (let i = 0; i < 110; i++) {
        ctx.fillStyle = i % 8 ? '#2d4054' : '#9eafbd';
        ctx.fillRect((i * 113) % 480, (i * 67) % 320, i % 8 ? 1 : 2, 1);
      }
      ctx.fillStyle = '#152d3b';
      for (let y = -50; y < 45; y += 4)
        for (let x = -48; x < 48; x += 4)
          if (x * x + y * y < 44 * 44) ctx.fillRect(415 + x, 285 + y, 4, 4);
      ctx.fillStyle = '#1e3a44';
      ctx.fillRect(401, 270, 40, 8);
      ctx.fillRect(385, 287, 46, 5);
      for (const r of s.rocks) drawWrappedRock(ctx, r);
      ctx.fillStyle = '#f4dfa4';
      for (const b of s.shots) ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4);
      for (const p of s.particles) {
        ctx.fillStyle = p.life > 0.3 ? '#ffc47d' : '#bf7459';
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      }
      if (s.invulnerable <= 0 || Math.floor(s.time * 10) % 2 === 0)
        drawWrappedShip(ctx, s.ship, s.thrusting, s.time);
      ctx.fillStyle = '#0b1727d9';
      ctx.fillRect(0, 0, 480, 31);
      drawPixelText(ctx, env.t('SECTOR', '星区') + ' ' + s.wave + '/5', 12, 10, '#a5cecf', 12);
      drawPixelText(ctx, env.t('SHIPS', '飞船') + ' ' + s.lives, 468, 10, '#f1cc8a', 12, 'right');
      if (s.time < 4)
        drawPixelText(
          ctx,
          env.t('TURN  +  THRUST  +  FIRE', '转向  +  推进  +  射击'),
          240,
          298,
          '#cbd8ce',
          11,
          'center',
        );
    },
    getState: () => ({
      ...structuredClone(s),
      status: {
        en: `Sector ${s.wave}/5 · ${s.lives} ships`,
        zh: `星区 ${s.wave}/5 · ${s.lives} 艘飞船`,
      },
    }),
  };
}
