import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createSnakeState, stepSnake, spawnFood } from '../src/games/neon-snake.js';
import { harness, input, mockContext, seeded } from './harness.js';
test('snake turns without reversing and eats food', () => {
  const s = createSnakeState(seeded(1));
  s.food = { x: 9, y: 7 };
  stepSnake(s, { x: 1, y: 0 }, seeded(2));
  assert.equal(s.score, 100);
  assert.equal(s.snake.length, 5);
  assert.equal(s.eaten, 1);
  stepSnake(s, { x: -1, y: 0 }, seeded(2));
  assert.equal(s.snake[0].x, 10);
});
test('snake loses against walls, own body and obstacles', () => {
  for (const kind of ['wall', 'body', 'rock']) {
    const s = createSnakeState(seeded(1));
    s.snake =
      kind === 'wall'
        ? [{ x: 23, y: 7 }]
        : [
            { x: 8, y: 7 },
            { x: 9, y: 7 },
            { x: 9, y: 8 },
            { x: 8, y: 8 },
          ];
    s.food = { x: 2, y: 2 };
    if (kind === 'rock') {
      s.snake = [{ x: 8, y: 7 }];
      s.rocks = [{ x: 9, y: 7 }];
    }
    stepSnake(s, { x: 1, y: 0 }, seeded(2));
    assert.equal(s.phase, 'lost');
  }
});
test('snake can enter a vacating tail and wins after eighteen fruit', () => {
  const s = createSnakeState(seeded(3));
  s.snake = [
    { x: 8, y: 7 },
    { x: 8, y: 8 },
    { x: 9, y: 8 },
    { x: 9, y: 7 },
  ];
  s.food = { x: 2, y: 2 };
  stepSnake(s, { x: 1, y: 0 }, seeded(1));
  assert.equal(s.phase, 'playing');
  s.eaten = 17;
  s.food = { x: 10, y: 7 };
  stepSnake(s, { x: 1, y: 0 }, seeded(1));
  assert.equal(s.phase, 'won');
  assert.equal(s.eaten, 18);
});
test('snake food avoids occupied cells and stage walls', () => {
  const s = createSnakeState(seeded(4));
  for (let i = 0; i < 100; i++) {
    const f = spawnFood(s, seeded(i));
    assert(![...s.snake, ...s.rocks].some((p) => p.x === f.x && p.y === f.y));
  }
  s.eaten = 5;
  s.food = { x: 9, y: 7 };
  stepSnake(s, { x: 1, y: 0 }, seeded(1));
  assert.equal(s.level, 2);
  assert(s.rocks.length > 0);
});
test('snake game draws, terminates once, and restarts cleanly in both languages', () => {
  for (const lang of ['en', 'zh']) {
    const h = harness({ lang });
    const g = createGame(h.env);
    g.draw(mockContext());
    g.update(0.15, input([], ['ArrowUp']));
    for (let i = 0; i < 500; i++) g.update(1 / 30, input());
    assert.equal(g.getState().phase, 'lost');
    assert.equal(h.ends.length, 1);
    assert.equal(createGame(h.env).getState().score, 0);
  }
});

test('legal keyboard play clears all three snake gardens on two seeds', () => {
  const directions = [
    [1, 0, 'ArrowRight'],
    [-1, 0, 'ArrowLeft'],
    [0, 1, 'ArrowDown'],
    [0, -1, 'ArrowUp'],
  ];
  function route(s) {
    const blocked = new Set([...s.rocks, ...s.snake.slice(1, -1)].map((p) => `${p.x},${p.y}`));
    const queue = [{ ...s.snake[0], key: null }],
      seen = new Set([`${s.snake[0].x},${s.snake[0].y}`]);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p.x === s.food.x && p.y === s.food.y) return p.key;
      for (const [dx, dy, key] of directions) {
        if (!p.key && dx === -s.direction.x && dy === -s.direction.y) continue;
        const x = p.x + dx,
          y = p.y + dy,
          id = `${x},${y}`;
        if (x < 0 || x >= 24 || y < 0 || y >= 14 || blocked.has(id) || seen.has(id)) continue;
        seen.add(id);
        queue.push({ x, y, key: p.key ?? key });
      }
    }
    return null;
  }
  for (const seed of [1, 42]) {
    const h = harness({ seed }),
      g = createGame(h.env);
    let frames = 0;
    while (g.getState().phase === 'playing' && frames++ < 10000) {
      const key = route(g.getState());
      assert(key, 'A route to the next fruit exists');
      g.update(1 / 30, input([], [key]));
    }
    assert.equal(g.getState().phase, 'won');
    assert.equal(g.getState().eaten, 18);
    assert.equal(h.ends.length, 1);
    assert(h.ends[0].won);
  }
});
