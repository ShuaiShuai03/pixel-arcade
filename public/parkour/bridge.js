/* Browser-only services for the vendored Pixel Parkour port. */
(() => {
  const key = 'pixel-parkour.save.v1';
  const maxBytes = 65536;
  window.parkourInitialLanguage = () => {
    const explicit = new URLSearchParams(location.search).get('lang');
    if (explicit === 'en' || explicit === 'zh') return explicit;
    try {
      const stored = localStorage.getItem(key) || '';
      const match = stored.match(/(?:^|\n)\s*lang\s*=\s*(en|zh)\s*(?:\n|$)/);
      if (match) return match[1];
    } catch { /* Browser storage can be unavailable. */ }
    return 'en';
  };
  let pending = new Uint8Array();
  const range = (ptr, len) => Number.isInteger(ptr) && Number.isInteger(len) && ptr >= 0 && len >= 0 && len <= maxBytes && ptr + len <= wasm_memory.buffer.byteLength;
  miniquad_add_plugin({
    name: 'parkour_browser', version: 1,
    register_plugin(imports) {
      imports.env.parkour_save_length = () => {
        try { pending = new TextEncoder().encode(localStorage.getItem(key) || ''); }
        catch { pending = new Uint8Array(); }
        if (pending.length > maxBytes) pending = new Uint8Array();
        return pending.length;
      };
      imports.env.parkour_save_read = (ptr, len) => {
        if (!range(ptr, len) || len < pending.length) return 0;
        new Uint8Array(wasm_memory.buffer, ptr, pending.length).set(pending);
        return pending.length;
      };
      imports.env.parkour_save_write = (ptr, len) => {
        if (!range(ptr, len)) return 0;
        try {
          localStorage.setItem(key, new TextDecoder().decode(new Uint8Array(wasm_memory.buffer, ptr, len)));
          return 1;
        } catch { return 0; }
      };
      imports.env.parkour_language = () => {
        const value = new URLSearchParams(location.search).get('lang');
        return value === 'zh' ? 1 : value === 'en' ? 0 : -1;
      };
      imports.env.parkour_language_changed = code => {
        if (code === 0 || code === 1) {
          window.dispatchEvent(new CustomEvent('parkour-language-changed', {detail: {lang: code === 1 ? 'zh' : 'en'}}));
        }
      };
      // Both the page button and native Settings/F11 use the complete game shell.
      imports.env.sapp_set_fullscreen = enabled => window.dispatchEvent(new CustomEvent('parkour-fullscreen-request', {detail: {enabled: !!enabled}}));
      imports.env.sapp_is_fullscreen = () => document.fullscreenElement ? 1 : 0;
      imports.env.parkour_ready = () => window.dispatchEvent(new CustomEvent('parkour-ready'));
      imports.env.parkour_exit = () => { location.href = '../../index.html#games'; };
    }
  });
})();
