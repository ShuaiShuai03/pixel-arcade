import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as platform from '../src/shared/platform.js';
import { InputState } from '../src/shared/input.js';
import { SimulationClock } from '../src/shared/simulation.js';
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
    const classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
      toggle(value, force) {
        const active = force ?? !classes.has(value);
        if (active) classes.add(value);
        else classes.delete(value);
        return active;
      },
    };
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
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 480, height: 320 };
  }
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
async function fixture({ manual = false, observe = true, touchControls = [] } = {}) {
  const elements = new Map(),
    window = new Element(),
    frames = [],
    writes = new Map(),
    requests = [],
    instances = [],
    observed = new Map();
  let observeCallback;
  class Observer {
    constructor(callback) {
      observeCallback = callback;
    }
    observe(target) {
      observed.set(target.dataset.game, target);
    }
    unobserve(target) {
      observed.delete(target.dataset.game);
    }
    disconnect() {
      observed.clear();
    }
  }
  let now = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id === 'game-canvas' ? 'canvas' : 'div'));
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    querySelector: element,
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
        meta: { ...meta, description: { en: 'Move', zh: '移动' }, keys: [], touchControls },
        createGame(env) {
          const game = {
            id: meta.id,
            score: 0,
            phase: 'playing',
            updates: [],
            update(dt, input) {
              this.updates.push({
                dt,
                left: input.held('ArrowLeft'),
                right: input.held('ArrowRight'),
                press: input.pressed('ArrowLeft'),
                pointer: { ...input.pointer },
              });
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
    'SimulationClock',
    'ArcadeAudio',
    'drawWorld',
    'window',
    'document',
    'performance',
    'location',
    'requestAnimationFrame',
    'IntersectionObserver',
  ];
  const values = [
    catalog,
    loadGame,
    copy,
    ...Object.values(platform),
    InputState,
    SimulationClock,
    Audio,
    () => {},
    window,
    document,
    { now: () => now },
    location,
    (fn) => frames.push(fn),
    observe ? Observer : undefined,
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
    intersect(id) {
      observeCallback([{ target: observed.get(id), isIntersecting: true }]);
    },
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

test('a press survives a frame without a physics tick and fires only once during catch-up', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const live = f.instances.at(-1);
  await f.key('ArrowLeft');
  f.tick(2);
  assert.equal(live.updates.length, 0);
  f.tick(32);
  assert.equal(live.updates.length, 4);
  assert.deepEqual(
    live.updates.map((step) => step.press),
    [true, false, false, false],
  );
});

test('language changes release controls whose touch buttons are replaced', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const live = f.instances.at(-1);
  await f.key('ArrowLeft');
  await f.click('language-toggle');
  f.tick();
  assert.equal(live.updates.at(-1).left, false);
});

test('the shelf loads only visible previews and navigation shares their in-flight load', async () => {
  const f = await fixture({ manual: true, observe: true });
  assert.equal(f.requests.length, 0, 'offscreen games should not load at startup');
  f.intersect('alpha');
  assert.deepEqual(
    f.requests.map((request) => request.id),
    ['alpha'],
  );
  const navigation = f.go('alpha');
  assert.equal(f.requests.length, 1, 'navigation reuses the preview request');
  f.requests[0].resolve();
  await navigation;
  assert.equal(f.element('play-title').textContent, 'alpha');
});

test('a failed preview load can be retried by opening the game', async () => {
  const f = await fixture({ manual: true, observe: true });
  f.intersect('alpha');
  f.requests[0].reject(new Error('offline'));
  await new Promise((resolve) => setImmediate(resolve));
  const navigation = f.go('alpha');
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve();
  await navigation;
  assert.equal(f.element('game-canvas').dataset.phase, 'ready');
});

test('secondary touches cannot steer or release the active canvas gesture', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const canvas = f.element('game-canvas');
  const first = { pointerId: 10, pointerType: 'touch', clientX: 120, clientY: 100, button: 0 };
  const second = { pointerId: 11, pointerType: 'touch', clientX: 330, clientY: 210, button: 0 };
  await canvas.emit('pointerdown', first);
  await canvas.emit('pointerdown', second);
  await canvas.emit('pointermove', second);
  await canvas.emit('pointerup', second);
  f.tick();
  const pointer = f.instances.at(-1).updates.at(-1).pointer;
  assert.equal(pointer.down, true);
  assert.equal(pointer.x, 120);
  await canvas.emit('pointerup', first);
  f.tick();
  assert.equal(f.instances.at(-1).updates.at(-1).pointer.down, false);
});

test('right click does not fire a canvas action', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  await f.element('game-canvas').emit('pointerdown', {
    pointerId: 1,
    button: 2,
    clientX: 200,
    clientY: 100,
  });
  f.tick();
  const pointer = f.instances.at(-1).updates.at(-1).pointer;
  assert.equal(pointer.down, false);
  assert.equal(pointer.clicked, false);
});

test('unsupported fullscreen expands the player and Escape restores its normal layout', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  await f.click('fullscreen-button');
  assert.equal(f.element('.machine').classList.contains('full-window'), true);
  assert.equal(f.element('fullscreen-button').attributes.get('aria-label'), 'Exit full screen');
  await f.key('Escape');
  assert.equal(f.element('.machine').classList.contains('full-window'), false);
  assert.equal(f.element('game-canvas').dataset.phase, 'playing');
  assert.equal(f.element('fullscreen-button').attributes.get('aria-pressed'), 'false');
});

test('denied fullscreen falls back and navigation restores the page', async () => {
  const f = await fixture();
  await f.go('alpha');
  f.element('.machine').requestFullscreen = async () => {
    throw Error('denied');
  };
  await f.click('fullscreen-button');
  assert.equal(f.element('.machine').classList.contains('full-window'), true);
  await f.click('language-toggle');
  assert.equal(f.element('fullscreen-button').attributes.get('aria-label'), '退出全屏');
  await f.go('beta');
  assert.equal(f.element('.machine').classList.contains('full-window'), false);
  assert.equal(f.document.body.classList.contains('full-window-open'), false);
});

test('fullscreen returns keyboard focus to an active game when entering and leaving', async () => {
  const f = await fixture();
  await f.go('alpha');
  await f.click('start-button');
  const canvas = f.element('game-canvas');
  const button = f.element('fullscreen-button');
  canvas.focus = () => {
    f.document.activeElement = canvas;
  };
  for (const entering of [true, false]) {
    f.document.activeElement = button;
    await f.click('fullscreen-button');
    assert.equal(f.document.activeElement, canvas);
    assert.equal(f.element('.machine').classList.contains('full-window'), entering);
  }
});

test('opposite touch groups retain independent pointer ownership', async () => {
  const f = await fixture({
    touchControls: [
      { code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } },
      { code: 'ArrowRight', side: 'right', label: { en: 'Right', zh: '右' } },
    ],
  });
  await f.go('alpha');
  await f.click('start-button');
  const groups = f.element('touch-controls').children;
  assert.equal(groups[0].className, 'touch-group touch-left');
  assert.equal(groups[1].className, 'touch-group touch-right');
  const left = groups[0].children[0],
    right = groups[1].children[0];
  await left.emit('pointerdown', { pointerId: 10 });
  await right.emit('pointerdown', { pointerId: 11 });
  f.tick();
  assert.equal(f.instances.at(-1).updates.at(-1).left, true);
  assert.equal(f.instances.at(-1).updates.at(-1).right, true);
  await left.emit('pointerup', { pointerId: 10 });
  f.tick();
  assert.equal(f.instances.at(-1).updates.at(-1).left, false);
  assert.equal(f.instances.at(-1).updates.at(-1).right, true);
});

test('keyboard activation of a touch control produces one deliberate action', async () => {
  const f = await fixture({
    touchControls: [{ code: 'ArrowLeft', side: 'left', label: { en: 'Left', zh: '左' } }],
  });
  await f.go('alpha');
  await f.click('start-button');
  const button = f.element('touch-controls').children[0].children[0];
  await button.emit('click', { detail: 0 });
  f.tick(10);
  assert.equal(f.instances.at(-1).updates.at(-1).left, true);
  assert.equal(f.instances.at(-1).updates.at(-1).press, true);
  f.tick(10);
  assert.equal(f.instances.at(-1).updates.at(-1).left, false);
  assert.equal(f.instances.at(-1).updates.at(-1).press, false);
});
