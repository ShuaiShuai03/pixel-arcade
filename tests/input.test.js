import test from 'node:test';
import assert from 'node:assert/strict';
import { InputState } from '../src/shared/input.js';
test('keys distinguish held and one-frame press even on repeat', () => {
  const i = new InputState();
  i.down('Space');
  assert.ok(i.held('Space'));
  assert.ok(i.pressed('Space'));
  i.flush();
  i.down('Space');
  assert.ok(i.held('Space'));
  assert.equal(i.pressed('Space'), false);
  i.up('Space');
  assert.equal(i.held('Space'), false);
});
test('touch and keyboard ownership cannot release each other', () => {
  const i = new InputState();
  i.down('ArrowLeft', 'keyboard');
  i.down('ArrowLeft', 'touch-1');
  i.up('touch-1');
  assert.ok(i.held('ArrowLeft'));
  i.clear();
  assert.equal(i.held('ArrowLeft'), false);
});
test('clearing input on blur releases pointer and presses', () => {
  const i = new InputState();
  i.pointer = { x: 5, y: 7, down: true, clicked: true };
  i.down('KeyA');
  i.clear();
  assert.equal(i.pointer.down, false);
  assert.equal(i.pointer.clicked, false);
  assert.equal(i.pressed('KeyA'), false);
});
