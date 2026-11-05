/* Load the locked miniquad build; no remote scripts or services. */
(() => {
  let lang = window.parkourInitialLanguage();
  let pendingLanguage = null;
  const copy = (en, zh) => lang === 'zh' ? zh : en;
  const loadButton = document.querySelector('#load-game');
  const status = document.querySelector('#load-status');
  let loading = false;
  let ready = false;
  function translate() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    for (const node of document.querySelectorAll('[data-en]')) node.textContent = node.dataset[lang];
    for (const node of document.querySelectorAll('[data-aria-en]')) node.setAttribute('aria-label', node.dataset[lang === 'en' ? 'ariaEn' : 'ariaZh']);
    const languageButton = document.querySelector('#language');
    languageButton.textContent = lang === 'en' ? '中文' : 'English';
    languageButton.setAttribute('lang', lang === 'en' ? 'zh-CN' : 'en');
    languageButton.setAttribute('aria-label', lang === 'en' ? '切换为中文' : 'Switch to English');
    canvas.setAttribute('aria-label', copy('Pixel Parkour game. Arrows move, jump and roll. Enter confirms; Escape pauses.', '像素跑酷游戏。方向键移动、跳跃和翻滚，回车确认，Esc 暂停。'));
  }
  translate();
  // Keep keyboard navigation available; miniquad otherwise consumes Tab.
  canvas.addEventListener('keydown', event => {
    if (event.code === 'Tab') event.stopImmediatePropagation();
  }, true);
  function applyLanguage(next) {
    if (next !== 'en' && next !== 'zh') return;
    lang = next;
    translate();
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url.href);
  }
  document.querySelector('#language').addEventListener('click', () => {
    const next = lang === 'en' ? 'zh' : 'en';
    applyLanguage(next);
    if (ready) wasm_exports.parkour_set_language(next === 'zh' ? 1 : 0);
    else pendingLanguage = next;
  });
  window.addEventListener('parkour-language-changed', event => {
    const next = event.detail?.lang;
    // A choice made while audio/assets initialize wins over the initial notification.
    if (pendingLanguage && pendingLanguage !== next) return;
    pendingLanguage = null;
    applyLanguage(next);
  });
  function unlockAudio() {
    if (typeof audio_context !== 'undefined' && audio_context?.state === 'suspended') audio_context.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (!ready) return;
      unlockAudio();
      wasm_exports.parkour_action(Number(button.dataset.action));
      canvas.focus({preventScroll:true});
    });
    button.addEventListener('click', event => {
      // Keyboard activation has detail 0; pointerdown already handled taps.
      if (event.detail === 0 && ready) {
        wasm_exports.parkour_action(Number(button.dataset.action));
        canvas.focus({preventScroll:true});
      }
    });
  }
  let fallbackFullscreen = false;
  const fullscreenRoot = document.querySelector('.game-shell');
  const isFullscreen = () => fallbackFullscreen || Boolean(document.fullscreenElement);
  function syncFullscreen() {
    fullscreenRoot.classList.toggle('is-fullscreen', fallbackFullscreen);
    document.body.classList.toggle('parkour-fullscreen', fallbackFullscreen);
    fullscreenRoot.setAttribute('data-fullscreen', fallbackFullscreen ? 'fallback' : document.fullscreenElement ? 'native' : 'off');
    const button = document.querySelector('#fullscreen');
    button.dataset.en = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
    button.dataset.zh = isFullscreen() ? '退出全屏' : '全屏';
    button.setAttribute('aria-pressed', String(isFullscreen()));
    translate();
    // CSS fullscreen changes the canvas dimensions without a browser resize event.
    window.dispatchEvent(new CustomEvent('resize'));
  }
  async function setFullscreen(enabled) {
    if (!enabled) {
      fallbackFullscreen = false;
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* Keep the exit control available. */ }
      }
    } else if (!isFullscreen()) {
      try {
        if (typeof fullscreenRoot.requestFullscreen !== 'function') throw new Error('Fullscreen API unavailable');
        await fullscreenRoot.requestFullscreen();
        fallbackFullscreen = !document.fullscreenElement;
      } catch {
        // Embedded browsers and mobile Safari can deny native fullscreen.
        fallbackFullscreen = true;
      }
    }
    syncFullscreen();
    canvas.focus({preventScroll:true});
  }
  document.querySelector('#fullscreen').addEventListener('click', () => setFullscreen(!isFullscreen()));
  window.addEventListener('parkour-fullscreen-request', event => setFullscreen(event.detail.enabled));
  document.addEventListener('keydown', event => {
    if (!fallbackFullscreen) return;
    if (event.code === 'Escape' || event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFullscreen(false);
    } else if (event.key === 'Tab' || event.code === 'Tab') {
      const controls = [...fullscreenRoot.querySelectorAll('canvas, button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({preventScroll:true});
      }
    }
  }, true);
  window.addEventListener('parkour-ready', () => {
    ready = true;
    if (pendingLanguage) wasm_exports.parkour_set_language(pendingLanguage === 'zh' ? 1 : 0);
    document.querySelector('#loading').hidden = true;
    canvas.focus({preventScroll:true});
  });
  const pauseForFocusLoss = () => { if (ready) wasm_exports.parkour_action(128); };
  canvas.addEventListener('blur', pauseForFocusLoss);
  window.addEventListener('blur', pauseForFocusLoss);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseForFocusLoss();
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) fallbackFullscreen = false;
    syncFullscreen();
  });
  window.addEventListener('pagehide', () => {
    if (typeof audio_context !== 'undefined') audio_context?.suspend().catch(() => {});
  });
  function fail(error) {
    ready = false;
    loading = false;
    document.querySelector('#loading').hidden = false;
    status.textContent = copy('The game could not load. Check your connection and WebGL support, then retry.', '游戏加载失败，请检查网络和 WebGL 支持后重试。');
    loadButton.textContent = copy('Retry', '重试');
    loadButton.disabled = false;
    console.error('Pixel Parkour failed to start:', error);
  }
  loadButton.addEventListener('click', async () => {
    if (loading || ready) return;
    loading = true;
    loadButton.disabled = true;
    status.textContent = copy('Loading the rail yard…', '正在加载铁道站场……');
    try {
      if (!window.WebAssembly) throw new Error('WebAssembly unavailable');
      const context = canvas.getContext('webgl');
      if (!context || !context.getExtension('OES_vertex_array_object') || !context.getExtension('WEBGL_depth_texture')) {
        throw new Error('Required WebGL extensions are unavailable');
      }
      const response = await fetch('pixel_parkour.wasm');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const module = await WebAssembly.compile(await response.arrayBuffer());
      register_plugins(plugins);
      importObject.env.sapp_is_fullscreen = () => isFullscreen() ? 1 : 0;
      for (const entry of WebAssembly.Module.imports(module)) {
        if (entry.kind !== 'function' || typeof importObject[entry.module]?.[entry.name] !== 'function') {
          throw new Error(`Missing WebAssembly import: ${entry.module}.${entry.name}`);
        }
      }
      const instance = await WebAssembly.instantiate(module, importObject);
      wasm_memory = instance.exports.memory;
      wasm_exports = instance.exports;
      if (wasm_exports.crate_version() !== version) throw new Error('miniquad loader version mismatch');
      init_plugins(plugins);
      wasm_exports.main();
    } catch (error) { fail(error); }
  });
})();
