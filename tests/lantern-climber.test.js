import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, meta } from '../src/games/lantern-climber.js';
import { harness, input, mockContext } from './harness.js';
test('lantern: zero and invalid time preserve the complete state without reading actions', () => {
  const h = harness(),
    g = createGame(h.env),
    before = structuredClone(g.getState());
  let reads = 0;
  const controls = {
    held() {
      reads++;
      return true;
    },
    pressed() {
      reads++;
      return true;
    },
    pointer: { clicked: false },
  };
  for (const dt of [0, -1, NaN, Infinity]) g.update(dt, controls);
  assert.deepEqual(g.getState(), before);
  assert.equal(reads, 0);
  assert.equal(h.sounds.length, 0);
  assert.equal(h.ends.length, 0);
});
test('lantern: horizontal control uses finite acceleration and opposing commands are neutral', () => {
  const g = createGame(harness().env),
    before = g.getState();
  g.update(1 / 120, input(['ArrowRight']));
  assert.ok(g.getState().player.vx > 0 && g.getState().player.vx < 40);
  const h = createGame(harness().env);
  h.update(1 / 120, input(['ArrowLeft', 'ArrowRight']));
  assert.equal(h.getState().player.vx, 0);
  assert.equal(h.getState().player.x, before.player.x);
});
test('lantern: releasing jump does not delete airborne momentum', () => {
  const a = createGame(harness().env),
    b = createGame(harness().env);
  a.update(1 / 120, input(['Space'], ['Space']));
  b.update(1 / 120, input(['Space'], ['Space']));
  for (let n = 0; n < 12; n++) {
    a.update(1 / 120, input(['Space']));
    b.update(1 / 120, input());
  }
  assert.ok(Math.abs(a.getState().player.vy - b.getState().player.vy) < 1e-7);
  assert.ok(Math.abs(a.getState().player.y - b.getState().player.y) < 1e-7);
});
test('lantern: stamina, light and relight/grip/climb controls are inspectable and bilingual', () => {
  const s = createGame(harness().env).getState();
  assert.ok(Number.isFinite(s.stamina) && s.stamina > 0);
  assert.ok(Number.isFinite(s.light) && s.light > 0);
  assert.ok(s.rails.length > 0);
  assert.equal(meta.name.zh, '提灯攀登');
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyZ', 'KeyX']) {
    const c = meta.touchControls.find((c) => c.code === code);
    assert.ok(c, code);
    assert.ok(c.label.en);
    assert.match(c.label.zh, /\p{Script=Han}/u);
  }
});
test('lantern: initial drawing and fresh restart preserve initial gameplay', () => {
  const g = createGame(harness({ lang: 'zh' }).env),
    before = structuredClone(g.getState());
  g.draw(mockContext());
  assert.deepEqual(g.getState(), before);
  g.update(1 / 120, input(['ArrowRight']));
  const fresh = createGame(harness().env).getState();
  assert.equal(fresh.lives, before.lives);
  assert.equal(fresh.score, 0);
  assert.equal(fresh.checkpoint, 0);
});

function routePilot() {
  let target = 1,
    railExited = false;
  const serviced = new Set();
  return (s) => {
    const p = s.player,
      held = [],
      pressed = [];
    if (s.respawn > 0) return input();
    let axis = 0;
    const steer = (goal, vmax = 520) => {
      const error = goal - p.x;
      if (Math.abs(error) < 3) return Math.abs(p.vx) > 14 ? -Math.sign(p.vx) : 0;
      if (error * p.vx > 0 && Math.abs(error) < (p.vx * p.vx) / (2 * vmax) + 3)
        return -Math.sign(p.vx);
      return Math.sign(error);
    };
    if (p.ground !== null) {
      target = p.ground + 1;
      railExited = false;
      const l = s.ledges[p.ground];
      if (target > 18) return input();
      if (s.stamina < 80 || (l.shrine && !serviced.has(l.id))) {
        axis = 0;
        if (s.resting) {
          if (l.shrine) {
            pressed.push('KeyX');
            serviced.add(l.id);
          }
          if (s.stamina >= 95) serviced.add(l.id);
        }
        if (s.stamina < 95 || (l.shrine && !serviced.has(l.id)))
          return input(axis ? [axis > 0 ? 'ArrowRight' : 'ArrowLeft'] : [], pressed);
      }
      const next = s.ledges[target],
        right = next.x + next.w / 2 > l.x + l.w / 2,
        edge = right ? l.x + l.w - p.w - 3 : l.x + 3;
      axis = right ? 1 : -1;
      if ((right ? p.x >= edge - 14 : p.x <= edge + 14) && p.vx * axis > 70) pressed.push('Space');
    } else if (target === 14 && !railExited) {
      held.push('KeyZ', 'ArrowUp');
      if (p.grip !== null) {
        if (p.y + p.h <= s.ledges[14].y - 26) {
          railExited = true;
          held.length = 0;
          axis = -1;
        } else axis = 0;
      } else axis = -1;
    } else {
      const l = s.ledges[target],
        from = s.ledges[Math.max(0, target - 1)],
        right = l.x + l.w / 2 > from.x + from.w / 2,
        goal = l.x + (l.w - p.w) * (right ? 0.35 : 0.65) + l.vx * 0.15;
      axis = steer(goal);
    }
    if (p.ground === 13 && target === 14) held.push('KeyZ', 'ArrowUp');
    if (axis) held.push(axis > 0 ? 'ArrowRight' : 'ArrowLeft');
    return input(held, pressed);
  };
}
for (const hz of [30, 60, 120])
  test(`lantern: legal keys reach all three summits including the required rail (${hz}Hz)`, (t) => {
    const h = harness(),
      g = createGame(h.env),
      pilot = routePilot();
    let gripped = false;
    for (let n = 0; n < hz * 120 && g.getState().phase === 'playing'; n++) {
      const s = g.getState();
      gripped ||= s.player.grip !== null;
      g.update(1 / hz, pilot(s));
      if (n % (hz * 2) === 0) g.draw(mockContext());
    }
    const s = g.getState();
    t.diagnostic(
      JSON.stringify({
        phase: s.phase,
        ground: s.player.ground,
        pos: [s.player.x, s.player.y],
        lit: s.ledges.filter((l) => l.lit).map((l) => l.id),
        lives: s.lives,
        stamina: s.stamina,
        light: s.light,
        time: s.time,
      }),
    );
    assert.equal(s.phase, 'won');
    assert.equal(s.beacons, 3);
    assert.equal(s.lives, 4);
    assert.equal(s.score, 1800);
    assert.equal(s.ledges.filter((l) => l.lit).length, 19);
    assert.ok(gripped);
    assert.equal(h.ends.length, 1);
    const final = structuredClone(g.getState());
    g.update(1 / 30, input(['KeyZ', 'ArrowUp'], ['Space', 'KeyX']));
    assert.deepEqual(g.getState(), final);
    assert.equal(h.ends.length, 1);
    g.draw(mockContext());
  });
