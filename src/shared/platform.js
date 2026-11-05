const STORAGE_KEY = 'pixel-arcade-v1';
export function readPreferences(storage) {
  let value;
  try {
    value = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
  } catch {
    value = {};
  }
  if (!value || typeof value !== 'object') value = {};
  const scores = Object.fromEntries(
    Object.entries(value.scores || {}).filter(
      ([k, v]) => /^[a-z0-9-]+$/.test(k) && Number.isFinite(v) && v >= 0,
    ),
  );
  return {
    lang: value.lang === 'zh' ? 'zh' : 'en',
    sound: value.sound === true,
    scores,
    recent: Array.isArray(value.recent)
      ? value.recent.filter((v) => typeof v === 'string' && /^[a-z0-9-]+$/.test(v)).slice(0, 8)
      : [],
  };
}
export function savePreferences(storage, preferences) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* Play remains available when browser storage is disabled. */
  }
}
export function recordResult(preferences, id, score) {
  return {
    ...preferences,
    scores: {
      ...preferences.scores,
      [id]: Math.max(
        preferences.scores[id] || 0,
        Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0,
      ),
    },
    recent: [id, ...preferences.recent.filter((v) => v !== id)].slice(0, 8),
  };
}
export function filterGames(games, query, filter) {
  const q = query.toLowerCase().trim();
  return games.filter(
    (g) =>
      (filter === 'all' || (filter === 'duo' && g.players.includes('2')) || g.genre === filter) &&
      `${g.name.en} ${g.name.zh}`.toLowerCase().includes(q),
  );
}
export function normalizeHash(hash, games) {
  const id = hash.startsWith('#play/') ? hash.slice(6) : null;
  return games.some((g) => g.id === id) ? id : null;
}
export function createTranslator(getLanguage) {
  const recent = new Map();
  return {
    t(en, zh) {
      const value = getLanguage() === 'zh' ? zh : en;
      recent.set(value, { en, zh });
      if (recent.size > 64) recent.delete(recent.keys().next().value);
      return value;
    },
    capture(value) {
      return recent.get(value) || { en: value, zh: value };
    },
  };
}

export function formatControlKeys(keys, language) {
  if (typeof keys === 'object') return keys[language];
  if (language === 'en') return keys;
  const names = {
    'arrow keys': '方向键',
    arrows: '方向键',
    space: '空格',
    enter: '回车',
    click: '点击',
    pointer: '指针',
    mouse: '鼠标',
    left: '←',
    right: '→',
    up: '↑',
    down: '↓',
    tap: '轻触',
    drag: '拖动',
    or: '或',
  };
  return keys.replace(
    /\b(Arrow keys|Arrows|Space|Enter|Click|Pointer|Mouse|Left|Right|Up|Down|Tap|drag|or)\b/gi,
    (name) => names[name.toLowerCase()],
  );
}
