export function seeded(seed = 1) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function harness({ seed = 1, mode = 1, lang = 'en' } = {}) {
  const ends = [];
  const sounds = [];
  return {
    ends,
    sounds,
    env: {
      width: 480,
      height: 320,
      mode,
      lang,
      random: seeded(seed),
      t: (en, zh) => (lang === 'zh' ? zh : en),
      sound: (n) => sounds.push(n),
      end: (r) => ends.push(r),
    },
  };
}
export function input(held = [], pressed = [], pointer = {}) {
  return {
    held: (...c) => c.some((k) => held.includes(k)),
    pressed: (...c) => c.some((k) => pressed.includes(k)),
    pointer: { x: -1, y: -1, down: false, clicked: false, ...pointer },
  };
}
export function mockContext() {
  return new Proxy(
    {
      measureText: (t) => ({ width: String(t).length * 7 }),
      canvas: { width: 480, height: 320 },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    },
    {
      get: (target, p) => (p in target ? target[p] : () => {}),
      set: (t, p, v) => ((t[p] = v), true),
    },
  );
}
