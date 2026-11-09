import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { catalog, featured, loadGame } from '../src/catalog.js';
import { harness, input, mockContext, seeded } from './harness.js';

function finiteTree(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must be finite`);
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
}
test('Pixel Parkour is listed first as a featured game with its own page and card picture', () => {
  assert.equal(featured[0].id, 'pixel-parkour');
  assert.ok(featured[0].name.en && featured[0].name.zh);
  for (const game of featured) {
    assert.ok(!catalog.some((g) => g.id === game.id), `${game.id} is not also a module`);
    assert.ok(['1', '1-2', '2'].includes(game.players));
    for (const path of [game.href, game.image])
      assert.ok(existsSync(new URL(`../${path.slice(2)}`, import.meta.url)), `${path} exists`);
  }
});
test('release contains forty-seven unique loadable games with bilingual instructions', async () => {
  assert.equal(catalog.length, 47);
  assert.equal(new Set(catalog.map((g) => g.id)).size, 47);
  for (const entry of catalog) {
    const { meta, createGame } = await loadGame(entry.id);
    assert.equal(meta.id, entry.id);
    assert.deepEqual(entry.name, meta.name, `${entry.id}: shelf and player names agree`);
    assert.equal(entry.genre, meta.genre);
    assert.equal(entry.players, meta.players);
    assert.equal(typeof createGame, 'function');
    for (const pair of [meta.name, meta.description, ...meta.keys.map((k) => k.label)]) {
      assert.ok(pair.en?.trim());
      assert.ok(pair.zh?.trim());
      assert.notEqual(pair.en, pair.zh);
    }
    assert.ok(['1', '1-2', '2'].includes(meta.players));
    assert.ok(Array.isArray(meta.touchControls));
    if (meta.multiplayerTouchControls) {
      assert.ok(meta.players.includes('2'));
      assert.ok(Array.isArray(meta.multiplayerTouchControls));
    }
    for (const control of [...meta.touchControls, ...(meta.multiplayerTouchControls || [])]) {
      assert.match(
        control.code,
        /^(Arrow(Left|Right|Up|Down)|Key[A-Z]|Space|Enter|Comma|Period|Shift(Left|Right))$/,
      );
      assert.ok(!['KeyR', 'KeyP', 'Escape'].includes(control.code));
      assert.ok(control.label.en && control.label.zh);
    }
  }
});
for (const entry of catalog)
  test(`${entry.id}: seeded mixed input remains finite, draws and terminates at most once`, async () => {
    const module = await loadGame(entry.id);
    for (const lang of ['en', 'zh'])
      for (const seed of [7, 41]) {
        const h = harness({
            seed,
            lang,
            mode: module.meta.players.includes('2') && seed === 41 ? 2 : 1,
          }),
          g = module.createGame(h.env),
          random = seeded(seed + 20),
          ctx = mockContext();
        const codes = [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'KeyA',
          'KeyD',
          'KeyW',
          'KeyS',
          'Space',
          'KeyJ',
          'KeyK',
          'Comma',
          'Period',
          'Enter',
          'KeyZ',
          'KeyF',
        ];
        let held = [];
        for (let frame = 0; frame < 900; frame++) {
          const fresh = frame % 15 === 0;
          if (fresh) held = codes.filter(() => random() < 0.12);
          const pointer = {
            x: Math.floor(random() * 480),
            y: Math.floor(random() * 320),
            down: frame % 10 === 0,
            clicked: frame % 45 === 0,
          };
          g.update(1 / 60, input(held, fresh ? held : [], pointer));
          if (frame % 120 === 0) {
            finiteTree(g.getState());
            g.draw(ctx);
          }
        }
        const state = g.getState();
        assert.ok(['playing', 'won', 'lost'].includes(state.phase));
        assert.ok(state.score >= 0);
        assert.ok(h.ends.length <= 1);
        if (state.phase !== 'playing') {
          assert.equal(h.ends.length, 1);
          const terminal = JSON.stringify(state);
          for (let i = 0; i < 60; i++) g.update(1 / 60, input(['Space'], ['Space']));
          assert.equal(JSON.stringify(g.getState()), terminal, 'terminal state must remain frozen');
        }
        const fresh = module.createGame(harness({ seed, lang }).env).getState();
        assert.equal(fresh.phase, 'playing');
      }
  });
