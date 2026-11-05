import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../src/shared/simulation.js';

test('simulation advances equally on 30, 60, 120 and 144 Hz displays', () => {
  for (const hz of [30, 60, 120, 144]) {
    const clock = new SimulationClock();
    let steps = 0;
    let time = 0;
    for (let frame = 0; frame < hz; frame++)
      clock.advance(1 / hz, (dt) => {
        steps++;
        time += dt;
      });
    assert.equal(steps, 120, `${hz} Hz`);
    assert.ok(Math.abs(time - 1) < 1e-10);
  }
});

test('a long stall has a bounded catch-up and never produces a large physics step', () => {
  const clock = new SimulationClock();
  const steps = [];
  clock.advance(8, (dt) => steps.push(dt));
  assert.equal(steps.length, 12);
  assert.ok(steps.every((dt) => dt === 1 / 120));
  clock.advance(0, () => assert.fail('no remaining stall backlog'));
});

test('reset discards time from the previous run or pause', () => {
  const clock = new SimulationClock();
  clock.advance(1 / 240, () => assert.fail('not enough elapsed time'));
  clock.reset();
  clock.advance(1 / 240, () => assert.fail('previous time was discarded'));
  let steps = 0;
  clock.advance(1 / 240, () => steps++);
  assert.equal(steps, 1);
});

test('ending a game stops catch-up immediately and discards remaining time', () => {
  const clock = new SimulationClock();
  let steps = 0;
  clock.advance(1 / 30, () => {
    steps++;
    return false;
  });
  assert.equal(steps, 1);
  clock.advance(0, () => assert.fail('no time leaks into another run'));
});

test('invalid elapsed values cannot poison subsequent updates', () => {
  const clock = new SimulationClock();
  for (const elapsed of [-1, NaN, Infinity])
    clock.advance(elapsed, () => assert.fail('invalid elapsed time'));
  let steps = 0;
  clock.advance(1 / 60, () => steps++);
  assert.equal(steps, 2);
});
