import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPreferences,
  savePreferences,
  recordResult,
  filterGames,
  normalizeHash,
  createTranslator,
  formatControlKeys,
} from '../src/shared/platform.js';
const games = [
  { id: 'a', name: { en: 'Snowball', zh: '雪球' }, genre: 'action', players: '1-2' },
  { id: 'b', name: { en: 'Blocks', zh: '方块' }, genre: 'puzzle', players: '1' },
];
test('search works in either supported language and filters local multiplayer', () => {
  assert.equal(filterGames(games, '雪球', 'all').length, 1);
  assert.equal(filterGames(games, '', 'duo')[0].id, 'a');
  assert.equal(filterGames(games, 'blocks', 'action').length, 0);
});
test('unavailable or damaged local storage does not prevent play', () => {
  assert.equal(
    readPreferences({
      getItem() {
        throw Error();
      },
    }).lang,
    'en',
  );
  assert.equal(readPreferences({ getItem: () => '{' }).lang, 'en');
  assert.doesNotThrow(() =>
    savePreferences(
      {
        setItem() {
          throw Error();
        },
      },
      {},
    ),
  );
});
test('preferences reject unexpected language, settings and scores', () => {
  const p = readPreferences({
    getItem: () =>
      JSON.stringify({
        lang: 'ja',
        sound: 'yes',
        scores: { a: -5, b: 12, c: '100', d: Infinity },
        recent: ['a', 3],
      }),
  });
  assert.equal(p.lang, 'en');
  assert.equal(p.sound, false);
  assert.deepEqual(p.scores, { b: 12 });
  assert.deepEqual(p.recent, ['a']);
});
test('scores retain personal best and recent list is unique and bounded', () => {
  let p = readPreferences();
  for (let i = 0; i < 12; i++) p = recordResult(p, String(i), i);
  p = recordResult(p, '11', 2);
  assert.equal(p.scores['11'], 11);
  assert.equal(p.recent.length, 8);
  assert.equal(p.recent[0], '11');
});
test('route parser accepts only declared safe ids', () => {
  assert.equal(normalizeHash('#play/a', games), 'a');
  assert.equal(normalizeHash('#play/../../../x', games), null);
  assert.equal(normalizeHash('#games', games), null);
});
test('captured game results retain both translations across a language change', () => {
  let lang = 'en';
  const translator = createTranslator(() => lang);
  const message = translator.capture(translator.t('Player 2 wins', '玩家2获胜'));
  lang = 'zh';
  assert.equal(message[lang], '玩家2获胜');
  assert.equal(translator.t('Play again', '再玩一次'), '再玩一次');
  for (let i = 0; i < 100; i++) translator.t(String(i), `值${i}`);
  assert.deepEqual(message, { en: 'Player 2 wins', zh: '玩家2获胜' });
  assert.deepEqual(translator.capture('Untranslated'), { en: 'Untranslated', zh: 'Untranslated' });
});

test('Chinese control hints translate actions while preserving physical key identifiers', () => {
  assert.equal(formatControlKeys('Left / Right or A / D; drag', 'zh'), '← / → 或 A / D; 拖动');
  assert.equal(
    formatControlKeys('Space / Up / click / Tap arrows', 'zh'),
    '空格 / ↑ / 点击 / 轻触 方向键',
  );
  assert.equal(formatControlKeys('Arrows / WASD', 'en'), 'Arrows / WASD');
  assert.equal(formatControlKeys({ en: 'solo: ↑ / ↓', zh: '单人：↑ / ↓' }, 'zh'), '单人：↑ / ↓');
});
