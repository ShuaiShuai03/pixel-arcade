import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

function bridge({ stored = null, blocked = false, search = '' } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const data = new Map(stored === null ? [] : [['pixel-parkour.save.v1', stored]]);
  const context = {
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URLSearchParams,
    wasm_memory: memory,
    location: { search, href: 'https://example.test/parkour/' },
    localStorage: {
      getItem: (k) => {
        if (blocked) throw Error('blocked');
        return data.get(k) ?? null;
      },
      setItem: (k, v) => {
        if (blocked) throw Error('blocked');
        data.set(k, v);
      },
    },
    window: { dispatchEvent() {} },
    CustomEvent: class {
      constructor(type, detail) {
        this.type = type;
        this.detail = detail;
      }
    },
    miniquad_add_plugin: (p) => {
      context.plugin = p;
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../public/parkour/bridge.js', import.meta.url), 'utf8'),
    context,
  );
  const imports = { env: {} };
  context.plugin.register_plugin(imports);
  return { imports: imports.env, memory, data, context };
}

test('parkour bridge reads and writes UTF-8 save text without network', () => {
  const b = bridge({ stored: 'coins=42\nlang=zh\n' });
  const len = b.imports.parkour_save_length();
  assert.equal(len, 17);
  assert.equal(b.imports.parkour_save_read(100, len), len);
  assert.equal(
    new TextDecoder().decode(new Uint8Array(b.memory.buffer, 100, len)),
    'coins=42\nlang=zh\n',
  );
  const next = new TextEncoder().encode('best=123\n');
  new Uint8Array(b.memory.buffer, 200, next.length).set(next);
  assert.equal(b.imports.parkour_save_write(200, next.length), 1);
  assert.equal(b.data.get('pixel-parkour.save.v1'), 'best=123\n');
});
test('parkour bridge gracefully falls back when browser storage is blocked', () => {
  const b = bridge({ blocked: true });
  assert.equal(b.imports.parkour_save_length(), 0);
  assert.equal(b.imports.parkour_save_write(0, 3), 0);
});
test('parkour language is limited to English and Chinese', () => {
  assert.equal(bridge({ search: '?lang=zh' }).imports.parkour_language(), 1);
  assert.equal(bridge({ search: '?lang=en' }).imports.parkour_language(), 0);
  assert.equal(bridge({ search: '?lang=fr' }).imports.parkour_language(), -1);
});
test('parkour bridge rejects oversized save data and out-of-range wasm pointers', () => {
  const b = bridge({ stored: 'x'.repeat(70000) });
  assert.equal(b.imports.parkour_save_length(), 0);
  assert.equal(b.imports.parkour_save_read(65000, 1000), 0);
  assert.equal(b.imports.parkour_save_write(65000, 1000), 0);
  assert.equal(b.imports.parkour_save_write(0, 70000), 0);
});

test('parkour WebAssembly links every import against the shipped versioned JavaScript', async () => {
  const canvas = {
    focus() {},
    getContext() {
      return {};
    },
  };
  const context = vm.createContext({
    document: { querySelector: () => canvas },
    window: {},
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URLSearchParams,
    location: { search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    WebAssembly,
    Map,
    CustomEvent: class {},
  });
  for (const file of ['gl.js', 'audio.js', 'bridge.js']) {
    vm.runInContext(
      readFileSync(new URL(`../public/parkour/${file}`, import.meta.url), 'utf8'),
      context,
      { filename: file },
    );
  }
  vm.runInContext('register_plugins(plugins)', context);
  const module = await WebAssembly.compile(
    readFileSync(new URL('../public/parkour/pixel_parkour.wasm', import.meta.url)),
  );
  const missing = WebAssembly.Module.imports(module).filter(
    (item) => typeof context.importObject[item.module]?.[item.name] !== 'function',
  );
  assert.deepEqual(missing, []);
  assert.ok(
    WebAssembly.Module.imports(module).some((item) => item.name === 'sapp_is_fullscreen'),
    'WASM observes real wrapper/native fullscreen state',
  );
  const instance = await WebAssembly.instantiate(module, context.importObject);
  assert.equal(instance.exports.crate_version(), 2);
  assert.equal(instance.exports.macroquad_audio_crate_version(), 1);
  assert.equal(instance.exports.parkour_browser_crate_version(), 1);
  assert.equal(typeof instance.exports.parkour_action, 'function');
  assert.equal(typeof instance.exports.parkour_set_language, 'function');
  assert.equal(typeof instance.exports.main, 'function');
  assert.ok(instance.exports.memory instanceof WebAssembly.Memory);
});

function wrapper({ search = '', stored = null, fullscreenMode = 'native' } = {}) {
  const classes = () => {
    const values = new Set();
    return {
      contains: (name) => values.has(name),
      toggle(name, on) {
        if (on) values.add(name);
        else values.delete(name);
      },
    };
  };
  class Element {
    constructor(dataset = {}) {
      this.dataset = dataset;
      this.classList = classes();
      this.listeners = {};
      this.attributes = {};
      this.textContent = '';
      this.hidden = false;
      this.disabled = false;
    }
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    }
    emit(type, event = {}) {
      for (const handler of this.listeners[type] ?? []) handler(event);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    focus() {}
    requestFullscreen() {
      if (fullscreenMode === 'denied') return Promise.reject(new Error('User activation required'));
      document.fullscreenElement = this;
      return Promise.resolve();
    }
  }
  const language = new Element();
  const status = new Element({ en: 'Ready', zh: '就绪' });
  const load = new Element({ en: 'Enter', zh: '进入' });
  const cover = new Element();
  const fullscreen = new Element({ en: 'Fullscreen', zh: '全屏' });
  const shell = new Element();
  if (fullscreenMode === 'unavailable') shell.requestFullscreen = undefined;
  const movement = new Element({ ariaEn: 'Movement controls', ariaZh: '移动控制' });
  const left = new Element({ action: '4', ariaEn: 'Move left', ariaZh: '向左移动' });
  const canvas = new Element();
  const nodes = {
    '#language': language,
    '#load-status': status,
    '#load-game': load,
    '#loading': cover,
    '#fullscreen': fullscreen,
    '.game-shell': shell,
  };
  const document = {
    documentElement: { lang: 'en' },
    body: { classList: classes() },
    fullscreenElement: null,
    hidden: false,
    listeners: {},
    querySelector: (key) => nodes[key],
    querySelectorAll: (selector) =>
      selector === '[data-en]'
        ? [status, load, fullscreen]
        : selector === '[data-aria-en]'
          ? [movement, left]
          : selector === '[data-action]'
            ? [left]
            : [],
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    },
    exitFullscreen() {
      this.fullscreenElement = null;
      return Promise.resolve();
    },
  };
  let url = new URL(`https://example.test/pixel-arcade/public/parkour/index.html${search}#game`);
  const location = {
    get search() {
      return url.search;
    },
    get href() {
      return url.href;
    },
    set href(_) {
      throw Error('Unexpected page navigation');
    },
  };
  const actions = [],
    languages = [],
    events = [];
  const window = {
    listeners: {},
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const handler of this.listeners[event.type] ?? []) handler(event);
    },
  };
  const context = {
    document,
    window,
    canvas,
    location,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: { getItem: () => stored, setItem() {} },
    history: {
      replaceState(_, __, value) {
        url = new URL(value, url);
      },
    },
    miniquad_add_plugin() {},
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    wasm_exports: {
      parkour_action: (code) => actions.push(code),
      parkour_set_language: (code) => languages.push(code),
    },
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(new URL('../public/parkour/bridge.js', import.meta.url), 'utf8'),
    context,
  );
  vm.runInContext(
    readFileSync(new URL('../public/parkour/parkour.js', import.meta.url), 'utf8'),
    context,
  );
  return {
    document,
    window,
    language,
    fullscreen,
    shell,
    canvas,
    left,
    movement,
    actions,
    languages,
    context,
    location,
  };
}

test('wrapper initial language agrees with a saved Chinese native setting', () => {
  const w = wrapper({ stored: 'coins=12\nlang=zh\n' });
  assert.equal(w.document.documentElement.lang, 'zh-CN');
  assert.equal(w.language.textContent, 'English');
  assert.equal(w.language.attributes.lang, 'en');
  assert.equal(w.movement.attributes['aria-label'], '移动控制');
  assert.equal(w.left.attributes['aria-label'], '向左移动');
});
test('wrapper switches live language through the queue without navigating or restarting', () => {
  const w = wrapper();
  w.window.dispatchEvent(new w.context.CustomEvent('parkour-ready'));
  w.language.emit('click');
  assert.deepEqual(w.languages, [1]);
  assert.equal(w.document.documentElement.lang, 'zh-CN');
  assert.match(w.location.href, /lang=zh/);
  assert.equal(w.language.attributes.lang, 'en');
  w.window.dispatchEvent(
    new w.context.CustomEvent('parkour-language-changed', { detail: { lang: 'en' } }),
  );
  assert.equal(w.document.documentElement.lang, 'en');
  assert.match(w.location.href, /lang=en/);
  assert.equal(w.language.attributes.lang, 'zh-CN');
});
test('focus departures queue pause-only and fullscreen includes controls', async () => {
  const w = wrapper();
  w.window.dispatchEvent(new w.context.CustomEvent('parkour-ready'));
  w.canvas.emit('blur');
  w.window.dispatchEvent(new w.context.CustomEvent('blur'));
  assert.deepEqual(w.actions, [128, 128]);
  await w.fullscreen.listeners.click[0]();
  assert.equal(w.document.fullscreenElement, w.shell);
});

test('native fullscreen request uses the same shell containing touch controls', async () => {
  const w = wrapper();
  await w.window.listeners['parkour-fullscreen-request'][0](
    new w.context.CustomEvent('parkour-fullscreen-request', { detail: { enabled: true } }),
  );
  assert.equal(w.document.fullscreenElement, w.shell);
  await w.window.listeners['parkour-fullscreen-request'][0](
    new w.context.CustomEvent('parkour-fullscreen-request', { detail: { enabled: false } }),
  );
  assert.equal(w.document.fullscreenElement, null);
});
test('explicit query language wins over saved language and invalid native events are ignored', () => {
  const w = wrapper({ search: '?lang=en', stored: 'lang=zh\n' });
  assert.equal(w.document.documentElement.lang, 'en');
  w.window.dispatchEvent(
    new w.context.CustomEvent('parkour-language-changed', { detail: { lang: 'fr' } }),
  );
  assert.equal(w.document.documentElement.lang, 'en');
});

for (const fullscreenMode of ['denied', 'unavailable']) {
  test(`fullscreen ${fullscreenMode} enters CSS fallback and exits by button`, async () => {
    const w = wrapper({ fullscreenMode });
    await w.fullscreen.listeners.click[0]();
    assert.equal(w.shell.classList.contains('is-fullscreen'), true);
    assert.equal(w.document.body.classList.contains('parkour-fullscreen'), true);
    assert.equal(w.fullscreen.textContent, 'Exit fullscreen');
    assert.equal(w.fullscreen.attributes['aria-pressed'], 'true');
    assert.equal(w.document.fullscreenElement, null);
    await w.fullscreen.listeners.click[0]();
    assert.equal(w.shell.classList.contains('is-fullscreen'), false);
    assert.equal(w.document.body.classList.contains('parkour-fullscreen'), false);
    assert.equal(w.fullscreen.textContent, 'Fullscreen');
  });
}
test('fallback Escape exits without sending the same key into gameplay', async () => {
  const w = wrapper({ fullscreenMode: 'denied' });
  await w.fullscreen.listeners.click[0]();
  let prevented = false,
    stopped = false;
  for (const handler of w.document.listeners.keydown)
    handler({
      code: 'Escape',
      preventDefault() {
        prevented = true;
      },
      stopImmediatePropagation() {
        stopped = true;
      },
    });
  assert.equal(w.shell.classList.contains('is-fullscreen'), false);
  assert.ok(prevented && stopped);
});
test('native request and language change preserve fallback and translate its exit label', async () => {
  const w = wrapper({ fullscreenMode: 'unavailable' });
  await w.window.listeners['parkour-fullscreen-request'][0](
    new w.context.CustomEvent('parkour-fullscreen-request', { detail: { enabled: true } }),
  );
  w.window.dispatchEvent(
    new w.context.CustomEvent('parkour-language-changed', { detail: { lang: 'zh' } }),
  );
  assert.equal(w.shell.classList.contains('is-fullscreen'), true);
  assert.equal(w.fullscreen.textContent, '退出全屏');
  await w.window.listeners['parkour-fullscreen-request'][0](
    new w.context.CustomEvent('parkour-fullscreen-request', { detail: { enabled: false } }),
  );
  assert.equal(w.shell.classList.contains('is-fullscreen'), false);
  assert.equal(w.fullscreen.textContent, '全屏');
});

test('parkour build provenance matches every current vendored input and shipped artifact', () => {
  const info = JSON.parse(
    readFileSync(new URL('../public/parkour/build-info.json', import.meta.url), 'utf8'),
  );
  const source = new URL('../vendor/pixel-parkour/', import.meta.url);
  const list = (directory, prefix = '') =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? list(new URL(entry.name + '/', directory), prefix + entry.name + '/')
        : entry.isFile() && entry.name.endsWith('.rs')
          ? [prefix + entry.name]
          : [],
    );
  const files = [
    'Cargo.toml',
    'Cargo.lock',
    '.cargo/config.toml',
    'SOURCE.json',
    'tools/gen_cjk.py',
    ...list(new URL('src/', source), 'src/'),
  ].sort();
  assert.deepEqual(Object.keys(info.sourceFilesSha256), files);
  const digest = (data) => createHash('sha256').update(data).digest('hex');
  for (const file of files)
    assert.equal(info.sourceFilesSha256[file], digest(readFileSync(new URL(file, source))), file);
  assert.equal(
    info.sourceTreeSha256,
    digest(files.map((file) => `${file}\0${info.sourceFilesSha256[file]}\n`).join('')),
  );
  assert.equal(
    info.buildScriptSha256,
    digest(readFileSync(new URL('../tools/build-parkour.mjs', import.meta.url))),
  );
  for (const [file, hash] of Object.entries(info.sha256))
    assert.equal(
      hash,
      digest(readFileSync(new URL('../public/parkour/' + file, import.meta.url))),
      file,
    );
  assert.equal(info.source.revision, 'a5d147ce782cb8618d03c41a9740e63d77ef5f94');
});
