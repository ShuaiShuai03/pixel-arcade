import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  createRunState,
  getCourse,
  meta,
  padUnder,
  stepRun,
  wallContact,
} from '../src/games/wallrunner-relay.js';
import { COURSES, LEVEL_COUNT, PADS } from '../src/games/wallrunner-relay-levels.js';
import { harness, input } from './harness.js';

const DT = 1 / 60;
const CJK = /[㐀-鿿]/;
const run = (s, seconds, held = [], pressed = []) => {
  for (let i = 0; i < Math.round(seconds / DT); i++)
    stepRun(s, DT, input(held, i === 0 ? pressed : []));
};
// Put the runner on a roof of a course, `offset` pixels from its left edge, standing still.
function stand(course, solid, offset, energy = 100) {
  const s = createRunState(course),
    roof = getCourse(course).solids[solid];
  Object.assign(s.player, {
    x: roof.x + offset,
    y: roof.y - s.player.h,
    vx: 0,
    vy: 0,
    ground: true,
  });
  s.energy = energy;
  return s;
}
const firstWith = (course, test) => getCourse(course).solids.findIndex(test);
const chalkWall = (course) => firstWith(course, (o) => o.chalk.L.length > 0);
const slickWall = (course) => firstWith(course, (o) => o.slick.R.length > 0);

test('metadata is bilingual and every action has a touch control', () => {
  assert.equal(meta.id, 'wallrunner-relay');
  assert.ok(meta.name.en && meta.name.zh && meta.description.en && meta.description.zh);
  assert.match(meta.description.en, /twenty courses/);
  const codes = meta.touchControls.map((c) => c.code);
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyX']) assert.ok(codes.includes(code));
  for (const c of meta.touchControls) assert.ok(c.label.en && c.label.zh);
  for (const k of meta.keys) assert.ok(k.label.en && k.label.zh);
});

test('the course table has at least twenty frozen, distinct, well-formed courses', () => {
  assert.ok(LEVEL_COUNT >= 20 && COURSES.length === LEVEL_COUNT);
  assert.ok(Object.isFrozen(COURSES) && Object.isFrozen(COURSES[0].solids[1].chalk));
  const signatures = new Set();
  COURSES.forEach((course, i) => {
    assert.ok(
      course.name.en && course.name.zh && course.tip.en && course.tip.zh,
      `course ${i + 1}`,
    );
    assert.doesNotMatch(course.tip.en, CJK);
    assert.match(course.tip.zh, CJK);
    signatures.add(JSON.stringify(course.solids));
    const roofs = course.solids.filter((o) => !o.boundary);
    assert.ok(course.solids[0].boundary && course.solids.at(-1).boundary);
    for (const o of roofs) {
      for (const side of ['L', 'R'])
        for (const [y0, y1] of [...o.chalk[side], ...o.slick[side]])
          assert.ok(y0 < y1 && y1 > o.y, 'a mark lies on an exposed face');
      for (const [x0, x1] of o.pads) assert.ok(x0 >= o.x && x1 <= o.x + o.w);
    }
    const roof = roofs.find(
      (o) => course.goal.x >= o.x && course.goal.x + course.goal.w <= o.x + o.w,
    );
    assert.equal(roof.y, course.goal.y + course.goal.h, 'the beacon stands on a roof');
    assert.ok(PADS[i].length >= 1 && PADS[i][0].solid === 1, 'every course starts on a relay pad');
  });
  assert.equal(signatures.size, COURSES.length);
});

test('zero, negative, NaN, infinite and huge dt never advance state or read input', () => {
  const s = createRunState(1),
    before = JSON.stringify(s),
    trap = {
      held: () => assert.fail('input read'),
      pressed: () => assert.fail('input read'),
    };
  for (const dt of [0, -1, NaN, Infinity, 1.01, 1e9, undefined, '1']) stepRun(s, dt, trap);
  assert.equal(JSON.stringify(s), before);
});

test('a long frame is capped to 1/30 second and sub-steps stay stable', () => {
  const a = createRunState(1),
    b = createRunState(1);
  stepRun(a, 0.9, input(['ArrowRight']));
  stepRun(b, 1 / 30, input(['ArrowRight']));
  assert.equal(a.player.x, b.player.x);
  assert.ok(Math.abs(a.time - 1 / 30) < 1e-9);
});

test('horizontal control accelerates to a finite speed and opposite keys cancel', () => {
  const s = createRunState(1);
  run(s, 0.5, ['ArrowRight']);
  assert.equal(s.player.vx, 110);
  const x = s.player.x;
  run(s, 0.3, ['ArrowLeft', 'ArrowRight']);
  assert.equal(s.player.vx, 0);
  assert.ok(s.player.x - x < 8);
});

test('a jump fires once per press and peaks at the published height', () => {
  const s = createRunState(1);
  const ground = s.player.y;
  let top = ground;
  stepRun(s, DT, input([], ['Space']));
  for (let i = 0; i < 60; i++) {
    stepRun(s, DT, input(['Space']));
    top = Math.min(top, s.player.y);
  }
  assert.equal(s.jumps, 1);
  assert.ok(Math.abs(ground - top - 330 ** 2 / 1800) < 1.5);
  const g = createGame(harness().env);
  assert.ok(Math.abs(g.getState().limits.jumpHeight - 330 ** 2 / 1800) < 1e-9);
});

test('the jump buffer fires on landing and coyote time allows a late jump once', () => {
  const s = createRunState(1);
  run(s, 0.1, [], ['Space']);
  run(s, 1);
  assert.equal(s.player.ground, true);
  assert.equal(s.jumps, 1);
  // Press just before landing: the buffered press jumps exactly once on touchdown.
  const t = stand(1, 1, 10);
  t.player.y -= 5;
  t.player.ground = false;
  stepRun(t, DT, input([], ['Space']));
  assert.equal(t.jumps, 0);
  run(t, 0.2);
  assert.equal(t.jumps, 1);
  // Walk off a roof edge: a jump within the coyote window works, a later one does not.
  const edge = getCourse(1).solids[1];
  const late = stand(1, 1, edge.w - 10);
  run(late, 0.35, ['ArrowRight']);
  assert.equal(late.player.ground, false);
  stepRun(late, DT, input(['ArrowRight'], ['Space']));
  assert.equal(late.jumps, 0);
  const soon = stand(1, 1, edge.w - 12);
  let i = 0;
  while (soon.player.ground && i++ < 120) stepRun(soon, DT, input(['ArrowRight']));
  stepRun(soon, DT, input(['ArrowRight'], ['Space']));
  assert.equal(soon.jumps, 1);
});

test('falling at terminal speed lands on the roof instead of tunnelling', () => {
  const s = stand(1, 1, 50),
    roof = getCourse(1).solids[1].y;
  s.player.y = roof - 300;
  s.player.ground = false;
  for (let i = 0; i < 240 && !s.player.ground; i++) {
    stepRun(s, 1 / 30, input());
    assert.ok(s.player.y + s.player.h <= roof + 1e-9);
  }
  assert.equal(s.player.y + s.player.h, roof);
  assert.equal(s.lives, 5);
});

test('walls are solid: running into a roof end or a tall wall never overlaps it', () => {
  const s = stand(3, 2, 10),
    wall = getCourse(3).solids[chalkWall(3)];
  run(s, 2, ['ArrowRight']);
  assert.ok(s.player.x + s.player.w <= wall.x + 1e-9);
  const boundary = createRunState(1);
  run(boundary, 1, ['ArrowLeft']);
  assert.equal(boundary.player.x, 0);
});

test('wall-run needs X, real chalk contact and no push away from the wall', () => {
  const wall = chalkWall(3),
    at = () => stand(3, wall - 1, 20);
  const plain = at();
  run(plain, 1, ['ArrowRight']);
  assert.equal(plain.player.running, false);
  const away = at();
  run(away, 0.95, ['ArrowRight', 'KeyX']);
  assert.equal(away.player.running, true);
  assert.ok(away.player.y < getCourse(3).solids[wall - 1].y - 40);
  const pushed = at();
  run(pushed, 0.6, ['ArrowLeft', 'KeyX']);
  assert.equal(pushed.player.running, false);
  const bare = stand(4, 2, 70);
  run(bare, 0.3, ['ArrowRight', 'KeyX']);
  assert.equal(bare.player.running, false);
});

test('a wall-run tops out on the roof, costs energy and ends with a grounded runner', () => {
  const wall = chalkWall(3),
    s = stand(3, wall - 1, 20);
  for (let i = 0; i < 240 && !(s.spent.run > 5 && s.player.ground); i++)
    stepRun(s, DT, input(['ArrowRight', 'KeyX']));
  assert.equal(s.player.ground, true);
  assert.equal(s.player.y + s.player.h, getCourse(3).solids[wall].y);
  assert.ok(s.spent.run > 5 && s.energy < 100);
});

test('energy drains with wall-runs and kicks, and refills only on relay pads', () => {
  const s = stand(3, chalkWall(3) - 1, 20);
  run(s, 1.2, ['ArrowRight', 'KeyX']);
  const spent = s.energy;
  assert.ok(spent < 100);
  assert.equal(s.refilled, 0);
  run(s, 0.5, ['ArrowRight']);
  assert.equal(s.energy, spent, 'standing on an ordinary roof refills nothing');
  const pad = stand(1, 1, 50, 40);
  assert.ok(padUnder(pad));
  run(pad, 1, []);
  assert.ok(Math.abs(pad.energy - 65) < 1);
  assert.ok(pad.refilled > 24);
  run(pad, 5, []);
  assert.equal(pad.energy, 100);
});

test('kicks need contact, cost energy, push a bounded amount and lock the same face until landing', () => {
  const s = createRunState(5);
  stepRun(s, DT, input(['ArrowRight'], ['Space']));
  let guard = 0;
  while (!wallContact(s.player, getCourse(5).solids) && guard++ < 60)
    stepRun(s, DT, input(['ArrowRight']));
  assert.ok(wallContact(s.player, getCourse(5).solids));
  const energy = s.energy;
  stepRun(s, DT, input(['ArrowRight'], ['Space']));
  assert.equal(s.kicks, 1);
  assert.equal(s.energy, energy - 10);
  assert.ok(Math.abs(s.player.vx) <= 150 && s.player.vy >= -300);
  assert.ok(s.player.vx < 0, 'the kick pushes away from the wall');
  // The same face is refused until the runner lands; a free-air press does nothing.
  const wall = getCourse(5).solids[2];
  run(s, 0.1);
  Object.assign(s.player, { x: wall.x - s.player.w, vx: 0, vy: 0 });
  stepRun(s, DT, input(['ArrowRight'], ['Space']));
  assert.equal(s.kicks, 1);
  const free = createRunState(1);
  stepRun(free, DT, input([], ['Space']));
  stepRun(free, DT, input([], ['Space']));
  assert.equal(free.kicks, 0);
});

test('slick faces refuse both kicks and wall-runs, and kicks need more energy than their cost', () => {
  const wall = getCourse(6).solids[slickWall(6)],
    s = createRunState(6);
  // Hang in the pit against the slick east face of the left boundary wall.
  Object.assign(s.player, {
    x: wall.x + wall.w,
    y: wall.slick.R[0][0] + 10,
    vx: 0,
    vy: 0,
    ground: false,
  });
  assert.equal(wallContact(s.player, getCourse(6).solids).slick, true);
  stepRun(s, DT, input(['ArrowLeft', 'KeyX'], ['Space']));
  assert.equal(s.kicks, 0);
  assert.equal(s.player.running, false);
  const weak = createRunState(5);
  Object.assign(weak.player, { x: 16, y: 150, vx: 0, vy: 0, ground: false });
  weak.energy = 10;
  assert.ok(wallContact(weak.player, getCourse(5).solids));
  stepRun(weak, DT, input(['ArrowRight'], ['Space']));
  assert.equal(weak.kicks, 0);
  weak.energy = 11;
  stepRun(weak, DT, input(['ArrowRight'], ['Space']));
  assert.equal(weak.kicks, 1);
});

test('exhausting energy off a pad costs a life and returns to the last pad without free energy', () => {
  const s = stand(1, 2, 20, 0);
  run(s, 0.1);
  assert.equal(s.lives, 4);
  assert.equal(s.cause, 'energy');
  assert.equal(s.collapses, 1);
  assert.equal(s.checkpoint, 0);
  assert.ok(s.energy < 5, 'no free refill');
  assert.equal(padUnder(s)?.id, 0);
});

test('falling costs a life, respawns on the last pad and pads score once', () => {
  const s = createRunState(2);
  run(s, 0.2);
  assert.equal(s.score, 0, 'the start pad is not scored twice');
  const second = PADS[1][1];
  Object.assign(s.player, { x: (second.x0 + second.x1) / 2, y: second.y - s.player.h });
  run(s, 0.2);
  assert.equal(s.score, 50);
  assert.equal(s.checkpoint, 1);
  run(s, 0.5);
  assert.equal(s.score, 50, 'a pad scores once');
  s.player.y = 390;
  stepRun(s, DT, input());
  assert.equal(s.lives, 4);
  assert.equal(s.falls, 1);
  assert.equal(s.cause, 'fall');
  assert.equal(padUnder(s)?.id, 1, 'respawn on the last pad touched');
});

test('input is never dropped around a respawn or a new course', () => {
  const s = createRunState(1);
  s.player.y = 390;
  s.player.ground = false;
  stepRun(s, DT, input(['ArrowRight'], ['Space']));
  assert.equal(s.lives, 4);
  stepRun(s, DT, input(['ArrowRight']));
  assert.equal(s.jumps, 1, 'a press on the respawn frame still jumps');
  assert.ok(s.player.vx > 0);
  const n = createRunState(1);
  const goal = n.player;
  Object.assign(goal, { x: getCourse(1).goal.x, y: getCourse(1).goal.y });
  stepRun(n, DT, input(['ArrowRight'], ['Space']));
  assert.equal(n.course, 2);
  stepRun(n, DT, input(['ArrowRight']));
  assert.equal(n.jumps, 1);
});

test('touching the beacon clears the course, resets lives and energy and starts the next course', () => {
  const s = createRunState(3);
  s.lives = 2;
  s.energy = 40;
  s.player.x = getCourse(3).goal.x;
  s.player.y = getCourse(3).goal.y;
  stepRun(s, DT, input());
  assert.equal(s.course, 4);
  assert.equal(s.lives, 5);
  assert.equal(s.energy, 100);
  assert.ok(s.banner > 0 && s.courseTimes.length === 1 && s.score >= 300 + 80);
  assert.deepEqual(s.padsSeen, [0]);
  const last = createRunState(LEVEL_COUNT);
  last.player.x = getCourse(LEVEL_COUNT).goal.x;
  last.player.y = getCourse(LEVEL_COUNT).goal.y;
  stepRun(last, DT, input());
  assert.equal(last.phase, 'won');
});

test('losing the last life ends the run, freezes state and ignores input', () => {
  const s = createRunState(1);
  s.lives = 1;
  s.player.y = 390;
  stepRun(s, DT, input());
  assert.equal(s.phase, 'lost');
  const frozen = JSON.stringify(s);
  stepRun(s, DT, input(['ArrowRight'], ['Space']));
  assert.equal(JSON.stringify(s), frozen);
});

test('snapshots are JSON-safe, detached from internals and describe the course', () => {
  const g = createGame(harness().env),
    snap = g.getState();
  assert.equal(JSON.parse(JSON.stringify(snap)).course, 1);
  snap.player.x = 1e6;
  snap.solids[1].x = 1e6;
  snap.pads.length = 0;
  const again = g.getState();
  assert.ok(again.player.x < 100 && again.solids[1].x === 0 && again.pads.length === 2);
  assert.equal(again.totalLevels, 20);
  assert.equal(again.tip.en, COURSES[0].tip.en);
  assert.match(again.status.en, /Course 1\/20/);
  assert.match(again.status.zh, /赛道1\/20/);
  assert.equal(again.mode, 'pad');
  assert.equal(again.onPad, true);
});
