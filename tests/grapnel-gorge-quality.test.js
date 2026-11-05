import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/games/grapnel-gorge.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('Grapnel zero and invalid time freeze the whole snapshot without reading input', () => {
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
    const g = createGame(harness().env),
      before = g.getState();
    let reads = 0;
    g.update(dt, {
      held() {
        reads++;
        return true;
      },
      pressed() {
        reads++;
        return true;
      },
      get pointer() {
        reads++;
        throw Error('input read');
      },
    });
    assert.equal(reads, 0);
    assert.deepEqual(g.getState(), before);
  }
});
test('Grapnel compatible stationary rope and ground support do not create rest creep', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['Space']));
  const before = g.getState();
  for (let n = 0; n < 120; n++) g.update(1 / 240, input());
  const after = g.getState();
  assert.ok(Math.abs(after.player.x - before.player.x) < 1e-6);
  assert.ok(Math.abs(after.player.vx) < 1e-6);
});
test('Grapnel detached flight has no unexplained horizontal input thrust', () => {
  const make = () => {
    const g = createGame(harness().env);
    for (let n = 0; n < 240 && g.getState().player.ground; n++)
      g.update(1 / 120, input(['ArrowRight']));
    return g;
  };
  const a = make(),
    b = make();
  assert.equal(a.getState().player.ground, false);
  a.update(1 / 120, input(['ArrowRight']));
  b.update(1 / 120, input());
  assert.equal(a.getState().player.vx, b.getState().player.vx);
});
test('Grapnel exposes an explicit distinct-route travel boundary rather than x labels', () => {
  const s = createGame(harness().env).getState();
  assert.equal(s.level, 1);
  assert.equal(s.betweenRoutes, false);
  assert.ok(s.route.name.en && s.route.name.zh);
  assert.ok(s.route.id);
});

function legalCampaign(hz = 120, lang = 'en', offset = 10) {
  const h = harness({ lang }),
    g = createGame(h.env);
  let callbackSnapshot;
  h.env.end = (r) => {
    h.ends.push(r);
    callbackSnapshot = g.getState();
  };
  let coast = false;
  const releases = [],
    clears = [];
  for (let frame = 0; frame < hz * 40 && g.getState().phase === 'playing'; frame++) {
    const s = g.getState();
    let held = [],
      pressed = [];
    if (s.betweenRoutes) g.draw(mockContext());
    if (s.betweenRoutes) {
      clears.push(s.level);
      const before = g.getState();
      g.update(1 / hz, input(['ArrowRight'], ['Space']));
      assert.deepEqual(g.getState(), before);
      pressed = ['Enter'];
      coast = false;
    } else if (!s.recovering) {
      if (s.player.ground) coast = false;
      const next = s.route.pads.find((p) => !s.visited.includes(p.id)),
        anchor = s.checkpoint > 0 ? 1 : 0;
      if (coast) {
      } else if (s.player.ground && s.checkpoint > 0 && s.player.x < (s.level === 2 ? 262 : 277))
        held = ['ArrowRight'];
      else if (!s.rope) {
        if (s.anchors.find((a) => a.id === anchor)?.eligible)
          pressed = [s.target !== anchor ? 'KeyX' : 'Space'];
        else if (s.player.ground) held = ['ArrowRight'];
      } else {
        if (s.rope.length > 105) held = ['ArrowUp'];
        if (s.player.ground) held.push('ArrowRight');
        const landing = s.landing.at(-1);
        if (
          landing?.landing &&
          landing.x > next.x + offset &&
          landing.x < next.x + next.w - 8 &&
          s.player.vx > 20
        ) {
          pressed = ['Space'];
          coast = true;
          releases.push({
            level: s.level,
            checkpoint: s.checkpoint,
            x: s.player.x,
            y: s.player.y,
            time: s.time,
          });
        }
      }
    }
    g.update(1 / hz, input(held, pressed));
  }
  const s = g.getState();
  assert.equal(s.phase, 'won', `${hz}Hz ${lang}: ${s.status.en}`);
  assert.equal(s.lives, 5);
  assert.equal(s.score, 1700 + 250 * s.collected.length);
  assert.deepEqual(clears, [1, 2]);
  assert.equal(releases.length, 5);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, true);
  assert.deepEqual(s, callbackSnapshot);
  return { g, h, s, releases };
}

test('Grapnel five legal swings complete all distinct routes at 30/60/120Hz in EN and ZH', () => {
  for (const hz of [30, 60, 120])
    for (const lang of ['en', 'zh']) {
      const { g, s } = legalCampaign(hz, lang);
      assert.deepEqual(s.completed, ['copper-arch', 'split-spire', 'rail-of-winds']);
      assert.ok(Math.abs(s.energyBalance) < 0.02);
      g.draw(mockContext());
      const before = g.getState();
      for (let n = 0; n < 10; n++)
        g.update(1 / hz, input(['ArrowRight', 'ArrowUp'], ['Space', 'KeyZ', 'Enter']));
      assert.deepEqual(g.getState(), before);
    }
});
test('Grapnel the same winch input schedule replays identically at each render rate', () => {
  const states = [];
  for (const hz of [30, 60, 120]) {
    const g = createGame(harness().env);
    for (let n = 0; n < hz * 2; n++) g.update(1 / hz, input(['ArrowUp'], n === 0 ? ['Space'] : []));
    states.push(g.getState());
  }
  for (const s of states.slice(1)) {
    assert.deepEqual(s.player, states[0].player);
    assert.deepEqual(s.rope, states[0].rope);
    assert.deepEqual(s.ledger, states[0].ledger);
    assert.equal(s.time, states[0].time);
  }
});
test('Grapnel generous visible landing windows support later legal releases', () => {
  for (const offset of [12, 18, 24]) {
    const { s } = legalCampaign(60, 'en', offset);
    assert.equal(s.lives, 5);
  }
});
test('Grapnel ordinary unhooked falls consume lives and reach a once-only frozen loss', () => {
  const h = harness(),
    g = createGame(h.env);
  for (let n = 0; n < 120 * 25 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, input(['ArrowRight']));
  const s = g.getState();
  assert.equal(s.phase, 'lost');
  assert.equal(s.lives, 0);
  assert.equal(h.ends.length, 1);
  assert.equal(h.ends[0].won, false);
  g.draw(mockContext());
  const before = g.getState();
  for (let n = 0; n < 30; n++) g.update(1 / 30, input(['ArrowUp'], ['Space', 'KeyZ']));
  assert.deepEqual(g.getState(), before);
  assert.equal(h.ends.length, 1);
  assert.equal(createGame(h.env).getState().lives, 5);
});
test('Grapnel rescue costs one life, restores a safe rest and discards recovery-period actions', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['KeyZ']));
  let s = g.getState();
  assert.equal(s.lives, 4);
  assert.equal(s.checkpoint, 0);
  assert.equal(s.player.ground, true);
  assert.equal(s.energy, 100);
  for (let n = 0; n < 30; n++) g.update(1 / 120, input([], ['Space']));
  for (let n = 0; n < 60; n++) g.update(1 / 120, input());
  s = g.getState();
  assert.equal(s.rope, null);
  assert.equal(s.lives, 4);
  assert.equal(s.recovering, 0);
  assert.equal(s.player.ground, true);
});
test('Grapnel a normal early release can land back on its cairn and recharge', () => {
  const g = createGame(harness().env);
  g.update(1 / 120, input([], ['Space']));
  for (let n = 0; n < 60; n++) g.update(1 / 120, input(['ArrowUp']));
  assert.ok(g.getState().energy < 100);
  g.update(1 / 120, input([], ['Space']));
  for (let n = 0; n < 180; n++) g.update(1 / 120, input());
  const s = g.getState();
  assert.equal(s.lives, 5);
  assert.equal(s.player.ground, true);
  assert.equal(s.energy, 100);
  const x = s.player.x;
  for (let n = 0; n < 120; n++) g.update(1 / 120, input());
  assert.equal(g.getState().player.x, x);
  g.draw(mockContext());
});
test('Grapnel holding a hook button does not repeat discrete actions, and opposing axes cancel', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 120; n++)
    g.update(1 / 120, input(['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']));
  const s = g.getState();
  assert.equal(s.rope, null);
  assert.equal(s.player.x, 62);
  assert.equal(s.energy, 100);
  g.update(1 / 120, input(['Space'], ['Space']));
  assert.ok(g.getState().rope);
  for (let n = 0; n < 120; n++) g.update(1 / 120, input(['Space']));
  assert.ok(g.getState().rope);
});
test('Grapnel a supported expedition has no hidden deadline', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 30 * 245; n++) g.update(1 / 30, input());
  const s = g.getState();
  assert.equal(s.phase, 'playing');
  assert.equal(s.lives, 5);
  assert.equal(s.player.x, 62);
  assert.equal(s.player.ground, true);
  assert.ok(s.time > 244);
});
test('Grapnel seeded mixed input traces remain finite with bounded state and legal resources', () => {
  for (const seed of [1, 9, 42, 177]) {
    const h = harness({ seed }),
      g = createGame(h.env),
      r = seeded(seed);
    for (let n = 0; n < 4000; n++) {
      const held = [];
      if (r() < 0.35) held.push(r() < 0.5 ? 'ArrowRight' : 'ArrowLeft');
      if (r() < 0.65) held.push(r() < 0.6 ? 'ArrowUp' : 'ArrowDown');
      const pressed = r() < 0.035 ? [r() < 0.75 ? 'Space' : 'KeyX'] : [];
      g.update([1 / 30, 1 / 60, 1 / 120][n % 3], input(held, pressed));
      const s = g.getState();
      for (const value of [
        s.player.x,
        s.player.y,
        s.player.vx,
        s.player.vy,
        s.time,
        s.energy,
        s.energyBalance,
      ])
        assert.ok(Number.isFinite(value), `${seed}/${n}`);
      assert.ok(s.energy >= -1e-8 && s.energy <= 100 + 1e-8);
      assert.ok(s.lives >= 0 && s.lives <= 5);
      assert.ok(s.collected.length <= 3 && s.completed.length <= 3 && s.visited.length <= 3);
      if (s.rope) {
        assert.ok(s.rope.length >= 58 - 1e-6 && s.rope.length <= 238 + 1e-6);
        assert.ok(s.rope.tension >= -1e-6);
        const a = s.anchors.find((a) => a.id === s.rope.id);
        assert.ok(Math.hypot(s.player.x - a.x, s.player.y - a.y) <= s.rope.length + 1e-5);
      }
      assert.ok(h.ends.length <= 1);
      if (n % 250 === 0) g.draw(mockContext());
    }
  }
});

test('Grapnel a visible optional copper relic is reachable through legal swinging', () => {
  const g = createGame(harness().env);
  for (let n = 0; n < 120 * 8 && !g.getState().collected.includes('copper-seal'); n++) {
    const s = g.getState();
    g.update(
      1 / 120,
      input(['ArrowRight', ...(s.rope?.length > 90 ? ['ArrowUp'] : [])], n === 0 ? ['Space'] : []),
    );
  }
  const s = g.getState();
  assert.ok(s.collected.includes('copper-seal'));
  assert.equal(s.score, 250);
  assert.equal(s.lives, 5);
  for (let n = 0; n < 120 * 4; n++) g.update(1 / 120, input());
  assert.equal(g.getState().collected.filter((id) => id === 'copper-seal').length, 1);
});
test('Grapnel a fresh restart restores every initial route/resource and returns independent snapshots', () => {
  const h = harness(),
    g = createGame(h.env),
    initial = g.getState();
  g.update(1 / 120, input([], ['KeyZ']));
  for (let n = 0; n < 50; n++) g.update(1 / 120, input());
  g.update(1 / 120, input([], ['Space']));
  const fresh = createGame(h.env);
  assert.deepEqual(fresh.getState(), initial);
  const copy = fresh.getState();
  copy.player.x = 999;
  copy.route.solids[0].x = 999;
  copy.anchors[0].x = 999;
  assert.deepEqual(fresh.getState(), initial);
});

test('Grapnel the final rescue freezes the callback snapshot before simultaneous held movement', () => {
  const h = harness();
  let g, atEnd;
  h.env.end = (r) => {
    h.ends.push(r);
    atEnd = g.getState();
  };
  g = createGame(h.env);
  for (let n = 0; n < 4; n++) {
    g.update(1 / 120, input([], ['KeyZ']));
    for (let t = 0; t < 50; t++) g.update(1 / 120, input());
  }
  g.update(1 / 30, input(['ArrowRight', 'ArrowUp'], ['KeyZ']));
  assert.equal(g.getState().phase, 'lost');
  assert.deepEqual(g.getState(), atEnd);
  assert.equal(h.ends.length, 1);
});
test('Grapnel water loss freezes exactly at its once-only callback snapshot', () => {
  const h = harness();
  let g, atEnd;
  h.env.end = (r) => {
    h.ends.push(r);
    atEnd = g.getState();
  };
  g = createGame(h.env);
  for (let n = 0; n < 120 * 25 && g.getState().phase === 'playing'; n++)
    g.update(1 / 120, input(['ArrowRight']));
  assert.equal(g.getState().phase, 'lost');
  assert.deepEqual(g.getState(), atEnd);
  assert.equal(h.ends.length, 1);
});
