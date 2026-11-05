import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as platform from '../src/shared/platform.js';
import { InputState } from '../src/shared/input.js';
import { copy } from '../src/i18n.js';

const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(
  /^import[\s\S]*?;\s*/gm,
  '',
);
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.hidden = false;
    this.value = '';
    this.dataset = {};
    this._textContent = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { add() {}, remove() {} };
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(value) {
    this._textContent = String(value ?? '');
  }
  addEventListener(name, fn) {
    const list = this.listeners.get(name) || [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  async emit(name, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    return Promise.all((this.listeners.get(name) || []).map((fn) => fn(event)));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    this.children.push(...children);
  }
  focus() {}
  scrollIntoView() {}
  setPointerCapture() {}
  getContext() {
    return new Proxy(
      { measureText: (text) => ({ width: String(text).length * 6 }) },
      {
        get: (target, property) => (property in target ? target[property] : () => {}),
        set: (target, property, value) => {
          target[property] = value;
          return true;
        },
      },
    );
  }
}
class Audio {
  unlock() {}
  play() {}
  setEnabled() {}
}
async function fixture({ manual = false } = {}) {
  const elements = new Map(),
    window = new Element(),
    frames = [],
    writes = new Map(),
    requests = [],
    instances = [];
  let now = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id === 'game-canvas' ? 'canvas' : 'div'));
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    querySelector: () => new Element(),
    createElement: (tag) => new Element(tag),
    body: new Element(),
    documentElement: new Element(),
    addEventListener() {},
  };
  window.localStorage = {
    getItem: (key) => writes.get(key) || null,
    setItem: (key, value) => writes.set(key, value),
  };
  window.scrollTo = () => {};
  const catalog = ['alpha', 'beta'].map((id) => ({
    id,
    name: { en: id, zh: `中文${id}` },
    genre: 'arcade',
    players: '1',
    color: '#000',
  }));
  const modules = Object.fromEntries(
    catalog.map((meta) => [
      meta.id,
      {
        meta: { ...meta, description: { en: 'Move', zh: '移动' }, keys: [] },
        createGame(env) {
          const game = {
            id: meta.id,
            score: 0,
            phase: 'playing',
            updates: [],
            update(dt, input) {
              this.updates.push({ dt, left: input.held('ArrowLeft') });
            },
            draw() {},
            getState() {
              return {
                phase: this.phase,
                score: this.score,
                status: { en: 'Playing', zh: '游戏中' },
              };
            },
            finish() {
              this.phase = 'lost';
              env.end({
                won: false,
                score: this.score,
                message: env.t('English result', '中文结果'),
              });
            },
          };
          instances.push(game);
          return game;
        },
      },
    ]),
  );
  const loadGame = (id) =>
    manual
      ? new Promise((resolve, reject) =>
          requests.push({ id, resolve: () => resolve(modules[id]), reject }),
        )
      : Promise.resolve(modules[id]);
  const location = { hash: '#home' };
  const names = [
    'catalog',
    'loadGame',
    'copy',
    ...Object.keys(platform),
    'InputState',
    'ArcadeAudio',
    'drawWorld',
    'window',
    'document',
    'performance',
    'location',
    'requestAnimationFrame',
  ];
  const values = [
    catalog,
    loadGame,
    copy,
    ...Object.values(platform),
    InputState,
    Audio,
    () => {},
    window,
    document,
    { now: () => now },
    location,
    (fn) => frames.push(fn),
  ];
  // Execute the real entrypoint with isolated browser and game dependencies.
  new Function(...names, source)(...values);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return {
    element,
    instances,
    requests,
    writes,
    window,
    document,
    async go(id) {
      location.hash = `#play/${id}`;
      return window.emit('hashchange');
    },
    click: (id) => element(id).emit('click'),
    key: (code) => window.emit('keydown', { code, target: element('game-canvas'), repeat: false }),
    tick(milliseconds = 16) {
      now += milliseconds;
      frames.splice(0).forEach((fn) => fn(now));
    },
  };
}
test('keyboard and button restart retain best and create fresh games', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  let live = f.instances.at(-1);
  live.score = 123;
  await f.key('KeyR');
  assert.notEqual(f.instances.at(-1), live);
  assert.equal(JSON.parse(f.writes.get('pixel-arcade-v1')).scores.alpha, 123);
  live = f.instances.at(-1);
  live.score = 456;
  await f.click('restart-button');
  assert.equal(JSON.parse(f.writes.get('pixel-arcade-v1')).scores.alpha, 456);
  assert.equal(f.instances.at(-1).score, 0);
});
test('finished result follows language changes without losing score', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const live = f.instances.at(-1);
  live.score = 42;
  live.finish();
  assert.equal(f.element('overlay-message').textContent, 'English result');
  await f.click('language-toggle');
  assert.equal(f.document.documentElement.lang, 'zh-CN');
  assert.equal(f.element('overlay-message').textContent, '中文结果');
  assert.equal(f.element('score-value').textContent, '42');
  assert.equal(f.element('game-canvas').dataset.phase, 'lost');
});
test('pause updates HUD immediately and resume preserves the run', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const live = f.instances.at(-1);
  live.score = 19;
  f.tick();
  const steps = live.updates.length;
  await f.click('pause-button');
  assert.equal(f.element('game-status').textContent, 'Paused');
  f.tick();
  assert.equal(live.updates.length, steps);
  await f.click('start-button');
  f.tick();
  assert.equal(f.instances.at(-1), live);
  assert.equal(f.element('score-value').textContent, '19');
  assert.equal(f.element('game-canvas').dataset.phase, 'playing');
});
test('blur releases held keys and long frames are capped', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const live = f.instances.at(-1);
  await f.key('ArrowLeft');
  f.tick(1000);
  assert.equal(live.updates.at(-1).left, true);
  assert.ok(live.updates.at(-1).dt <= 1 / 30);
  await f.window.emit('blur');
  assert.equal(f.element('game-canvas').dataset.phase, 'paused');
  await f.click('start-button');
  f.tick();
  assert.equal(live.updates.at(-1).left, false);
});
test('late module resolution cannot overwrite a newer route', async () => {
  const f = await fixture({ manual: true });
  const old = f.go('alpha'),
    oldRequest = f.requests.at(-1),
    latest = f.go('beta'),
    latestRequest = f.requests.at(-1);
  assert.equal(latestRequest.id, 'beta');
  latestRequest.resolve();
  await latest;
  assert.equal(f.element('play-title').textContent, 'beta');
  oldRequest.resolve();
  await old;
  assert.equal(f.element('play-title').textContent, 'beta');
  assert.equal(f.element('game-canvas').dataset.phase, 'ready');
});
