import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createClimbState, stepClimb, meta } from '../src/games/lantern-climber.js';
import {
  HINTS,
  LIGHT_DRAIN,
  RAIL_STEPS,
  SECTIONS,
  SHRINES,
  stepHint,
} from '../src/games/lantern-climber-layout.js';
import { harness, input, mockContext, seeded } from './harness.js';
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

const JUMP_HEIGHT = (324 * 324) / (2 * 800);
// Precise legal-key pilot: jumps plain steps, grips the rail for every step too high to jump.
function routePilot() {
  let last = 0,
    prevJump = false;
  return (s) => {
    const p = s.player,
      held = [],
      pressed = [];
    if (s.respawn > 0) return input();
    if (p.ground !== null) last = p.ground;
    const from = s.ledges[last],
      to = s.ledges[Math.min(18, last + 1)],
      cx = p.x + p.w / 2;
    let jump = false;
    if (p.ground !== null) {
      if (s.light < 75 && s.canRelight) pressed.push('KeyX');
      if (s.stamina < 98 && s.resting) return input([], pressed);
      const railStep = RAIL_STEPS.includes(last),
        goal = railStep ? s.rails[0].x : to.x + to.w / 2,
        dir = Math.sign(goal - (from.x + from.w / 2)) || 1,
        edge = dir > 0 ? p.x + p.w >= from.x + from.w - 4 : p.x <= from.x + 4;
      held.push(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (railStep) held.push('KeyZ');
      jump = edge;
    } else if (RAIL_STEPS.includes(last)) {
      if (p.grip !== null || Math.abs(cx - s.rails[0].x) < 30) {
        held.push('KeyZ');
        held.push(p.y + p.h > to.y - 6 ? 'ArrowUp' : 'ArrowLeft');
      } else held.push(cx < s.rails[0].x ? 'ArrowRight' : 'ArrowLeft');
    } else {
      const center = to.x + to.w / 2;
      if (cx < center - 20) held.push('ArrowRight');
      else if (cx > center + 20) held.push('ArrowLeft');
    }
    if (jump && !prevJump) pressed.push('Space');
    prevJump = jump;
    return input(held, pressed);
  };
}
function playRoute(seed, hz, seconds = 240) {
  const h = harness({ seed }),
    g = createGame(h.env),
    pilot = routePilot(),
    gripped = new Set();
  let lowestStamina = 100,
    lowestLight = 100;
  for (let n = 0; n < hz * seconds && g.getState().phase === 'playing'; n++) {
    const s = g.getState();
    if (s.player.grip !== null) gripped.add(s.player.grip);
    lowestStamina = Math.min(lowestStamina, s.stamina);
    lowestLight = Math.min(lowestLight, s.light);
    g.update(1 / hz, pilot(s));
    if (n % (hz * 2) === 0) g.draw(mockContext());
  }
  return { h, g, gripped, lowestStamina, lowestLight, state: g.getState() };
}
for (const hz of [30, 60, 120])
  test(`lantern: legal keys reach all three summits and use every required rail (${hz}Hz)`, () => {
    const { h, g, gripped, state } = playRoute(1, hz);
    assert.equal(state.phase, 'won');
    assert.equal(state.beacons, 3);
    assert.equal(state.ledges.filter((l) => l.lit).length, 19);
    assert.equal(state.score, 1800);
    assert.deepEqual([...gripped].sort(), [0, 1, 2, 3]);
    assert.equal(h.ends.length, 1);
    const final = structuredClone(g.getState());
    g.update(1 / 30, input(['KeyZ', 'ArrowUp'], ['Space', 'KeyX']));
    assert.deepEqual(g.getState(), final);
    assert.equal(h.ends.length, 1);
    g.draw(mockContext());
  });
test('lantern: every seeded tower stays solvable by the same legal route', () => {
  for (const seed of [2, 3, 5, 8, 13, 21]) {
    const { state } = playRoute(seed, 60);
    assert.equal(state.phase, 'won', `seed ${seed}`);
  }
});
test('lantern: the ramp brings narrower ledges, wider gaps, faster decks and more required rails', () => {
  const s = createClimbState(),
    thirds = [s.ledges.slice(0, 7), s.ledges.slice(7, 13), s.ledges.slice(13)],
    meanWidth = (list) => list.reduce((sum, l) => sum + l.w, 0) / list.length,
    gap = (a, b) => (a.id % 2 ? a.x - (b.x + b.w) : b.x - (a.x + a.w)),
    maxGap = (list) =>
      Math.max(
        ...list.slice(1).map((l, i) => (RAIL_STEPS.includes(list[i].id) ? 0 : gap(list[i], l))),
      ),
    peakSpeed = (list) => Math.max(...list.map((l) => Math.abs(l.vx))),
    peakDrift = (list) =>
      Math.max(...list.map((l) => (l.moving ? Math.abs(l.vx) / Math.sqrt(l.k) : 0)));
  assert.ok(
    meanWidth(thirds[0]) > meanWidth(thirds[1]) && meanWidth(thirds[1]) > meanWidth(thirds[2]),
  );
  assert.ok(maxGap(thirds[0]) < maxGap(thirds[1]) && maxGap(thirds[1]) < maxGap(thirds[2]));
  assert.ok(
    peakSpeed(thirds[0]) < peakSpeed(thirds[1]) && peakSpeed(thirds[1]) < peakSpeed(thirds[2]),
  );
  assert.ok(peakDrift(thirds[0]) < peakDrift(thirds[1]));
  assert.equal(thirds[0].filter((l) => l.moving).length, 1);
  const risesFor = (ids) => ids.map((id) => s.ledges[id].y - s.ledges[id + 1].y);
  assert.deepEqual(
    risesFor(RAIL_STEPS).map((rise, i, all) => i === 0 || rise > all[i - 1]),
    [true, true, true, true],
  );
  assert.equal(RAIL_STEPS.filter((id) => id < 6).length, 1);
  assert.equal(RAIL_STEPS.filter((id) => id >= 6 && id < 12).length, 1);
  assert.equal(RAIL_STEPS.filter((id) => id >= 12).length, 2);
  assert.ok(LIGHT_DRAIN[0] < LIGHT_DRAIN[1] && LIGHT_DRAIN[1] < LIGHT_DRAIN[2]);
});
test('lantern: each railed step is too high to jump and needs Grip, plain steps are jumpable', () => {
  const s = createClimbState();
  assert.equal(s.rails.length, RAIL_STEPS.length);
  for (const [i, id] of RAIL_STEPS.entries()) {
    const low = s.ledges[id],
      high = s.ledges[id + 1],
      rail = s.rails[i];
    assert.ok(low.y - high.y > JUMP_HEIGHT + 8);
    assert.ok(rail.y < high.y && rail.y + rail.h > low.y);
    const jumper = createClimbState();
    Object.assign(jumper.player, { x: low.x + 40, y: low.y - 22, vx: 0, vy: 0, ground: id });
    jumper.edge = id;
    let highest = Infinity;
    for (let n = 0; n < 960; n++) {
      stepClimb(jumper, 1 / 240, input([], n % 120 === 0 ? ['Space'] : []));
      highest = Math.min(highest, jumper.player.y);
    }
    assert.ok(highest > low.y - 22 - JUMP_HEIGHT - 0.1);
    assert.ok(highest + 22 > high.y);
    assert.equal(jumper.player.ground, id);
  }
  for (let id = 0; id < 18; id++)
    if (!RAIL_STEPS.includes(id)) assert.ok(s.ledges[id].y - s.ledges[id + 1].y < JUMP_HEIGHT - 8);
});
test('lantern: grip stamina decides the tall climbs and lamp fuel decides the long stretch', () => {
  const climb = (stamina) => {
    const s = createClimbState(),
      id = RAIL_STEPS[3],
      low = s.ledges[id],
      rail = s.rails[3];
    Object.assign(s.player, { x: rail.x - 7, y: low.y - 30, vx: 0, vy: 0, ground: null });
    s.stamina = stamina;
    s.checkpoint = 13;
    s.at = id;
    let top = false;
    for (let n = 0; n < 240 * 12 && s.lives === 4 && !top; n++) {
      stepClimb(s, 1 / 240, input(['KeyZ', 'ArrowUp']));
      top = s.player.y + 22 < s.ledges[id + 1].y - 6;
    }
    return { s, top };
  };
  const full = climb(100);
  assert.ok(full.top);
  assert.ok(full.s.stamina < 40 && full.s.stamina > 0);
  const tired = climb(55);
  assert.equal(tired.top, false);
  assert.ok(tired.s.lives < 4 || tired.s.player.grip === null);
  const idle = createClimbState();
  Object.assign(idle.player, {
    x: idle.ledges[13].x + 30,
    y: idle.ledges[13].y - 22,
    ground: 13,
  });
  idle.checkpoint = 13;
  idle.level = 3;
  const brazierFree = idle.ledges.slice(14, 18).every((l) => !l.shrine);
  assert.ok(brazierFree && SHRINES.includes(13) && !SHRINES.includes(15));
  for (let n = 0; n < 240 * 36 && idle.lives === 4; n++) stepClimb(idle, 1 / 240, input());
  assert.ok(idle.light < 15 && idle.lives === 4);
  for (let n = 0; n < 240 * 6 && idle.lives === 4; n++) stepClimb(idle, 1 / 240, input());
  assert.equal(idle.lastCause, 'light');
  assert.equal(idle.lives, 3);
});
test('lantern: the route pilot is pushed near empty on both meters', () => {
  const { lowestStamina, lowestLight } = playRoute(1, 60);
  assert.ok(lowestStamina < 40, `stamina ${lowestStamina}`);
  assert.ok(lowestLight < 60, `lamp ${lowestLight}`);
});
test('lantern: tower variation is deterministic per seed, differs between seeds and keeps rails fixed', () => {
  const layout = (seed) => {
    const g = createGame(harness({ seed }).env);
    return g.getState();
  };
  const a = layout(7),
    b = layout(7),
    c = layout(8),
    base = createClimbState();
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    a.ledges.map((l) => [l.x, l.w, l.vx]),
    c.ledges.map((l) => [l.x, l.w, l.vx]),
  );
  assert.deepEqual(a.rails, base.rails);
  assert.deepEqual(createClimbState().ledges, base.ledges);
  const random = seeded(99);
  for (let n = 0; n < 40; n++) {
    const t = createClimbState(random);
    assert.equal(t.ledges.length, 19);
    for (const l of t.ledges) {
      assert.ok(l.x >= 40 && l.x + l.w <= 400);
      assert.ok(l.w >= 66);
      assert.equal(l.moving, base.ledges[l.id].moving);
      assert.equal(l.y, base.ledges[l.id].y);
    }
    for (const id of RAIL_STEPS) {
      assert.equal(t.ledges[id].x, base.ledges[id].x);
      assert.equal(t.ledges[id + 1].x + t.ledges[id + 1].w, 190);
    }
    const sway = (id) => Math.abs(t.ledges[id].vx) / Math.sqrt(t.ledges[id].k);
    assert.ok(sway(8) > 20 && sway(8) < 36);
    assert.equal(Math.sign(t.ledges[7].vx), Math.sign(t.ledges[8].vx));
  }
  const g1 = harness({ seed: 4 }),
    g2 = harness({ seed: 4 }),
    p1 = createGame(g1.env),
    p2 = createGame(g2.env);
  for (let n = 0; n < 600; n++) {
    const controls = input(
      n % 90 < 45 ? ['ArrowRight'] : ['ArrowLeft'],
      n % 50 === 0 ? ['Space'] : [],
    );
    p1.update(1 / 60, controls);
    p2.update(1 / 60, controls);
  }
  assert.deepEqual(p1.getState(), p2.getState());
});
test('lantern: touch labels do not promise a grip that Up and Down do not give', () => {
  const label = (code) => meta.touchControls.find((c) => c.code === code).label;
  assert.equal(label('ArrowUp').en, 'Climb ↑');
  assert.equal(label('ArrowDown').en, 'Climb ↓');
  assert.equal(label('ArrowUp').zh, '上爬↑');
  assert.equal(label('ArrowDown').zh, '下爬↓');
  for (const code of ['ArrowUp', 'ArrowDown']) {
    assert.doesNotMatch(label(code).en, /grip/i);
    assert.doesNotMatch(label(code).zh, /抓握/);
  }
  assert.equal(label('KeyZ').en, 'Hold Grip');
  assert.match(label('KeyZ').zh, /抓握/);
  assert.match(meta.description.en, /On touch, hold Grip with one thumb and Climb with the other/);
  assert.match(meta.description.zh, /触屏时一指按住抓握，另一指按上爬\/下爬/);
  const gripKey = meta.keys.find((k) => k.keys.includes('Z'));
  assert.match(gripKey.label.en, /touch: Grip \+ Climb/);
  assert.match(gripKey.label.zh, /触屏：抓握＋上爬/);
  const hold = (keys) => {
    const s = createClimbState(),
      low = s.ledges[13],
      rail = s.rails[2];
    Object.assign(s.player, { x: rail.x - 7, y: low.y - 40, vx: 0, vy: 0, ground: null });
    s.edge = null;
    for (let n = 0; n < 60; n++) stepClimb(s, 1 / 60, input(keys));
    return s.player.grip;
  };
  assert.equal(hold(['ArrowUp']), null);
  assert.equal(hold(['ArrowUp', 'KeyZ']), 2);
});
function drawnText(lang, mutate) {
  const h = harness({ lang }),
    g = createGame(h.env),
    ctx = mockContext(),
    texts = [];
  ctx.fillText = (text, x, y) =>
    texts.push({ text, x, y, size: Number(/(\d+)px/.exec(ctx.font)[1]) });
  mutate?.(g);
  g.draw(ctx);
  return texts;
}
test('lantern: the current section hint is drawn on the canvas in both languages and fits', () => {
  const en = drawnText('en'),
    zh = drawnText('zh');
  const hintEn = en.find((t) => t.y === 45),
    hintZh = zh.find((t) => t.y === 45);
  assert.equal(hintEn.text, SECTIONS[0].hint.en);
  assert.equal(hintZh.text, SECTIONS[0].hint.zh);
  for (const list of [en, zh])
    for (const t of list) {
      const wide = /\p{Script=Han}|[↑↓↕＋]/u.test(t.text) ? 1 : 0.62;
      const width = [...t.text].length * t.size * (wide || 0.62);
      const left = t.x - (t.x === 240 || t.x === 470 ? width / (t.x === 240 ? 2 : 1) : 0);
      assert.ok(width <= 470, t.text);
      assert.ok(t.x === 470 || t.x === 240 || t.x + width <= 480 || t.text === '↕', t.text);
      assert.ok(left >= 0, t.text);
    }
  for (const hint of [...SECTIONS.map((s) => s.hint), ...Object.values(HINTS)]) {
    assert.ok(hint.en.length * 12 * 0.62 <= 460, hint.en);
    assert.ok([...hint.zh].length * 12 <= 460, hint.zh);
    assert.match(hint.zh, /\p{Script=Han}/u);
  }
});
test('lantern: the hint follows the situation: rail, rest, deck, lamp and section', () => {
  const at = (id, change = () => {}) => {
    const s = createClimbState();
    s.at = id;
    s.level = Math.min(3, 1 + Math.floor(id / 6));
    change(s);
    return stepHint(s);
  };
  assert.equal(at(5), HINTS.rail);
  assert.equal(
    at(5, (s) => (s.stamina = 40)),
    HINTS.rest,
  );
  assert.equal(
    at(5, (s) => ((s.stamina = 40), (s.player.grip = 0))),
    HINTS.rail,
  );
  assert.equal(
    at(3, (s) => (s.player.grip = 0)),
    HINTS.rail,
  );
  assert.equal(at(6), HINTS.deck);
  assert.equal(at(10), HINTS.deck);
  assert.equal(at(1), SECTIONS[0].hint);
  assert.equal(
    at(13, (s) => (s.light = 20)),
    HINTS.lamp,
  );
  assert.equal(at(12), SECTIONS[2].hint);
  const texts = drawnText('en', (g) => {
    const s = g.getState();
    assert.equal(s.status.en.includes(SECTIONS[0].hint.en), true);
  });
  assert.ok(texts.length > 4);
  const railed = drawnText('zh', () => {});
  assert.ok(railed.length > 4);
});
